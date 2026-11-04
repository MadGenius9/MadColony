// Forestry (docs/proposals/forestry.md): villages plant trees. A full-detail village short of grown wood trees near
// its centre (fewer than FOREST.min within FOREST.reach) lays out a grove (`settlement.grove { x, y, w, h, def,
// since, why }`, format 45), and its woodcutters plant young trees on every other tile of it (giver
// core:plant_trees, job 'plant'), while it has fewer than FOREST.min + FOREST.extra grown and young ones near. A
// young tree grows up in its `sproutDays` (farming.js, regrow.js). Planting costs work and waiting; no item is
// made or used.
import { sprout, canSprout } from './regrow.js';
import { newJob, travel, workSpeed, practice } from './ai/jobs.js';
import { mayDoWork } from './people.js';
import { octile } from './util.js';

export const FOREST = Object.freeze({ min: 20, extra: 10, reach: 24, w: 7, h: 5, from: 8, to: 22, gap: 2, work: 80 });

/** The wood tree a village would plant: a node tagged core:tree that yields wood (the one listed first). */
export function woodTree(g) {
  return g.reg.all('node').find((d) => d.tags?.includes('core:tree') && d.yields?.some((y) => y.item === 'core:wood')) || null;
}

/** Trees of `def` within FOREST.reach of village sid's centre: { grown, young }. */
export function treesNear(g, sid, def) {
  const c = g.s.settlements?.[sid]?.center;
  if (!c) return { grown: 0, young: 0 };
  const C = (g._treesNear ||= { key: '', by: new Map() }); // per tick and node change (nodeRev), village and kind (derived)
  const now = `${g.s.tick}|${g.nodeRev || 0}`;
  if (C.key !== now) { C.key = now; C.by.clear(); }
  const k = `${sid}|${def}`;
  if (C.by.has(k)) return C.by.get(k);
  let grown = 0, young = 0;
  for (const n of g.nodesNear(c.x, c.y, FOREST.reach, new Set([def]))) {
    if (Math.max(Math.abs(n.x - c.x), Math.abs(n.y - c.y)) > FOREST.reach) continue;
    if (n.young) young++; else grown++;
  }
  C.by.set(k, { grown, young });
  return C.by.get(k);
}

/** The grove's planting spots: every other tile (a chequer), in order. */
export function groveSpots(gr) {
  const out = [];
  for (let y = gr.y; y < gr.y + gr.h; y++) for (let x = gr.x; x < gr.x + gr.w; x++) if ((x + y) % 2 === 0) out.push({ x, y });
  return out;
}

/** Find room for a grove near village sid: { x, y, why } or null. */
function groveSite(g, sid) {
  const c = g.s.settlements[sid].center, homeRegion = g.regionOf(c.x, c.y);
  let best = null;
  for (let r = FOREST.from; r <= FOREST.to && !best; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x0 = c.x + dx, y0 = c.y + dy;
      let ok = true, reach = false;
      for (let y = y0 - FOREST.gap; y < y0 + FOREST.h + FOREST.gap && ok; y++) for (let x = x0 - FOREST.gap; x < x0 + FOREST.w + FOREST.gap && ok; x++) {
        if (!g.inB(x, y)) { ok = false; break; }
        const i = g.i(x, y), inside = x >= x0 && x < x0 + FOREST.w && y >= y0 && y < y0 + FOREST.h;
        if (g.structIdAt(i) || g.footIdAt(i) || g.zoneAt(i)) { ok = false; break; } // clear of the village's things
        if (!inside) continue;
        const t = g.terrainAt(x, y);
        if (!t.passable || !t.buildable || !g.claimOk(sid, x, y)) { ok = false; break; }
        if (g.regionAt(i) === homeRegion) reach = true;
      }
      if (!ok || !reach) continue;
      const d = octile(c.x, c.y, x0 + FOREST.w / 2, y0 + FOREST.h / 2);
      if (!best || d < best.d) best = { x: x0, y: y0, d };
    }
  }
  return best && { x: best.x, y: best.y, why: `the nearest open ground for trees, ${Math.round(best.d)} tiles from the centre` };
}

/** The planner (planner.js): keep P.forestNote; lay out a grove when the village is short of trees. */
export function planForestry(g, P, sid) {
  delete P.forestNote;
  const st = g.s.settlements?.[sid];
  const def = woodTree(g);
  if (!st || st.detail === 'abstract' || !def || !st.center) return;
  const n = treesNear(g, sid, def.id);
  if (st.grove) {
    if (n.grown + n.young < FOREST.min + FOREST.extra) P.forestNote = `Planting ${def.name.toLowerCase()}s in the grove: ${n.grown} grown and ${n.young} young within ${FOREST.reach} tiles`;
    return;
  }
  if (n.grown >= FOREST.min) return;
  const site = groveSite(g, sid);
  if (!site) { P.forestNote = `Only ${n.grown} ${def.name.toLowerCase()}s left within ${FOREST.reach} tiles, and no open ground for a grove`; return; }
  st.grove = { x: site.x, y: site.y, w: FOREST.w, h: FOREST.h, def: def.id, since: g.s.tick, why: site.why };
  P.forestNote = `Laid out a grove: only ${n.grown} ${def.name.toLowerCase()}s left within ${FOREST.reach} tiles`;
  g.log(`The colonists of ${st.name} are planting a grove: only ${n.grown} ${def.name.toLowerCase()}s are left within ${FOREST.reach} tiles of the village.`, 'build', null, 0, { kind: 'core:grove', sids: [sid], at: { x: site.x, y: site.y } });
}

export const FOREST_GIVERS = {
  'core:plant_trees': {
    find(g, c, params, wt) {
      const sid = c.settlementId || g.s.playerSettlement, gr = g.s.settlements?.[sid]?.grove;
      if (!gr || !g.reg.has('node', gr.def) || !mayDoWork(g, c, wt.id)) return [];
      const n = treesNear(g, sid, gr.def);
      if (n.grown + n.young >= FOREST.min + FOREST.extra) return [];
      const out = [];
      for (const p of groveSpots(gr)) {
        const i = g.i(p.x, p.y), key = `plant:${i}`;
        if (g.isReserved(key, c.id) || g.isBlocked(key) || !canSprout(g, i, gr.def)) continue;
        out.push({ x: p.x, y: p.y, urgency: 0.45, label: `Plant a ${g.reg.get('node', gr.def).name.toLowerCase()}`, make() {
          const job = newJob('plant', { x: p.x, y: p.y, def: gr.def, done: 0 }, { why: 'Trees for the village\'s wood', label: `Plant a ${g.reg.get('node', gr.def).name.toLowerCase()}`, workType: wt.id, targetKey: key });
          return g.reserveExcl(job, key, c.id) ? job : null;
        } });
        if (out.length >= 3) break; // the nearest few are enough to choose from
      }
      return out;
    },
  },
};

export const FOREST_DRIVERS = {
  plant: {
    valid(g, c, j) { return g.reg.has('node', j.def); },
    tick(g, c, j) {
      const i = g.i(j.x, j.y);
      if (!canSprout(g, i, j.def)) return { fail: 'The spot is taken', cooldown: 600 };
      const r = travel(g, c, j, j.x, j.y, 'adj', 'the grove');
      if (r !== true) return r === false ? 'running' : r;
      c.status.action = 'Planting a tree';
      j.done += workSpeed(g, c, 'core:chop', 'core:woodcutting');
      if (j.done < FOREST.work) return 'running';
      practice(g, c, 'core:chop', 'core:woodcutting');
      if (!canSprout(g, i, j.def)) return { fail: 'The spot is taken', cooldown: 600 };
      sprout(g, j.def, i);
      return 'done';
    },
  },
};
