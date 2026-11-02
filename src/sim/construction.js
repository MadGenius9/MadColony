// Autonomous construction: choosing templates and sites, creating blueprints, build order,
// completion, homes and bed ownership.
import { parseTemplate, rotateCell, rotateVec, rotatedSize, slotCandidates, templateCapacity } from './content/templates.js';
import { octile } from './util.js';
import { isUnlocked } from './research.js';
import { peopleOfSettlement } from './peoples.js';

const ORDER = { door: 0, furniture: 1, station: 1, wall: 2 };

/** What still has to be delivered to a structure: its own cost while a blueprint, or its upgrade's cost while renovating. */
export function workOrderOf(g, st) {
  if (!st.built) return { def: g.bDef(st), delivered: st.delivered, reno: false };
  if (st.reno) return { def: g.reg.get('building', st.reno.to), delivered: st.reno.delivered, reno: true };
  return null;
}
export function materialsComplete(g, st) {
  const w = workOrderOf(g, st);
  if (!w?.def) return false;
  return w.def.cost.every((c) => (w.delivered[c.item] || 0) >= c.qty);
}

export function interactionSpot(g, st) {
  const def = g.bDef(st);
  if (!def?.interaction) return { x: st.x, y: st.y + 1 };
  const [dx, dy] = rotateVec(def.interaction[0], def.interaction[1], st.rot || 0);
  return { x: st.x + dx, y: st.y + dy };
}

export function partsOf(g, p) { return p.parts.map((id) => g.s.structures[id]).filter(Boolean); }

/** Template cells placed at (x, y) with rotation. Each: {x, y, spec, ch}. */
export function placedCells(tpl, x, y, rot) {
  const { w, h, cells } = parseTemplate(tpl);
  return cells.map((c) => {
    const [rx, ry] = rotateCell(c.cx, c.cy, w, h, rot);
    return { x: x + rx, y: y + ry, spec: c.spec, ch: c.ch };
  });
}

function nodeClearCost(g, n) {
  const d = g.nodeDef(n);
  return d ? d.work * (n.chunks || 1) : 0;
}

/** Is this tile usable for a new project? Returns {ok, penalty}. */
export function tileUsable(g, x, y, sid) {
  if (x < 1 || y < 1 || x >= g.W - 1 || y >= g.H - 1) return null;
  const t = g.terrainAt(x, y);
  if (!t.passable || !t.buildable) return null;
  const i = g.i(x, y);
  if (g.structIdAt(i) || g.footIdAt(i) || g.zoneAt(i)) return null;
  const owner = sid || g.s.playerSettlement;
  const a = owner === g.s.playerSettlement ? g.s.allowedArea : null; // the settlement area is the player's setting
  if (a && (x < a.x0 || y < a.y0 || x > a.x1 || y > a.y1)) return null;
  if (!g.claimOk(owner, x, y)) return null; // never build on another settlement's land
  const n = g.nodeAt(x, y);
  if (n) {
    const cost = nodeClearCost(g, n);
    if (cost > 400) return null; // don't build on boulders
    return { penalty: cost / 80 };
  }
  return { penalty: 0 };
}

/** Find a good spot for a template near the colony center. Returns {x, y, rot, score} or null. */
export function findSite(g, tpl, opts = {}) {
  const { w, h } = parseTemplate(tpl);
  const c0 = opts.center || g.s.center;
  const cx = c0.x, cy = c0.y;
  const R = opts.radius || 26;
  const homeRegion = g.regionOf(cx, cy);
  let best = null, evaluated = 0;
  const rots = [0, 1, 2, 3];
  // Each tile's usability is looked up once per search (the same answer tileUsable gives every time:
  // nothing changes during the search), and each rotation's cell layout is built once.
  const M = Math.max(w, h) + 2, bx = cx - R - M, by = cy - R - M, side = 2 * (R + M) + 1;
  const usableAt = new Float64Array(side * side).fill(NaN); // NaN = not looked up yet, -1 = unusable
  const usable = (x, y) => {
    const lx = x - bx, ly = y - by;
    if (lx < 0 || ly < 0 || lx >= side || ly >= side) { const t = tileUsable(g, x, y, opts.sid); return t ? t.penalty : -1; }
    const k = ly * side + lx;
    let u = usableAt[k];
    if (u !== u) { const t = tileUsable(g, x, y, opts.sid); u = usableAt[k] = t ? t.penalty : -1; }
    return u;
  };
  const layout = rots.map((rot) => placedCells(tpl, 0, 0, rot));
  // Per rotation: the tiles round the footprint that must stay free (8-neighbours of its cells that are not
  // cells themselves), and the cells probed for a connection (entrances, or every cell if there are none).
  const ring = layout.map((cells) => {
    const own = new Set(cells.map((c) => `${c.x},${c.y}`)), seen = new Set(), out = [];
    for (const c of cells) for (let ey = -1; ey <= 1; ey++) for (let ex = -1; ex <= 1; ex++) {
      const k = `${c.x + ex},${c.y + ey}`;
      if (own.has(k) || seen.has(k)) continue;
      seen.add(k); out.push([c.x + ex, c.y + ey]);
    }
    return out;
  });
  const probe = layout.map((cells) => { const e = cells.filter((c) => c.spec?.clear); return e.length ? e : cells; });
  for (let r = 2; r <= R; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      for (const rot of rots) {
        const [rw, rh] = rotatedSize(w, h, rot);
        const x0 = cx + dx - (rw >> 1), y0 = cy + dy - (rh >> 1);
        let penalty = 0, ok = true;
        for (const c of layout[rot]) {
          const u = usable(x0 + c.x, y0 + c.y);
          if (u < 0) { ok = false; break; }
          penalty += u;
        }
        if (!ok) continue;
        // Keep a one-tile walking gap around other buildings/sites.
        for (const [ex, ey] of ring[rot]) {
          const nx = x0 + ex, ny = y0 + ey;
          if (!g.inB(nx, ny)) continue;
          const ii = g.i(nx, ny);
          if (g.footIdAt(ii) || g.structIdAt(ii)) { ok = false; break; }
        }
        if (!ok) continue;
        // Entrances (clear / floor cells on the template edge, and door fronts) must connect to the colony.
        if (!probe[rot].some((c) => g.regionOf(x0 + c.x, y0 + c.y) === homeRegion || g.nodeAt(x0 + c.x, y0 + c.y))) continue;
        const mx = x0 + rw / 2, my = y0 + rh / 2;
        const score = octile(cx, cy, mx, my) + penalty * 1.5 + (opts.rng ? opts.rng.next() * 1.5 : 0);
        evaluated++;
        if (!best || score < best.score) best = { x: x0, y: y0, rot, score };
      }
    }
    if (best && evaluated > 0 && r > best.score + 3) break;
  }
  return best;
}

/** Goods a new project may count on for stockedOnly pieces: the owner's stacks minus what jobs have reserved
 *  and minus what other active projects still need delivered (their undelivered, not yet incoming costs). */
function freeStock(g, owner, projectId) {
  const free = {};
  for (const st of g.owned('stacks', owner)) free[st.item] = (free[st.item] || 0) + Math.max(0, st.qty - g.reservedQty(st.id));
  for (const p of g.owned('projects', owner)) {
    if (p.status !== 'active' || p.id === projectId) continue;
    for (const st of partsOf(g, p)) {
      if (st.built) continue;
      for (const c of g.bDef(st)?.cost || []) {
        const need = c.qty - (st.delivered?.[c.item] || 0) - g.incoming(st.id, c.item);
        if (need > 0 && free[c.item]) free[c.item] = Math.max(0, free[c.item] - need);
      }
    }
  }
  return free;
}

export function chooseSlot(g, tag, pool, owner, n = 1, spare = null) {
  const cands = slotCandidates(g.reg, tag).filter((b) => isUnlocked(g, owner, 'building', b.id));
  if (!cands.length) return null;
  // A data alternative (stockedOnly, e.g. plank furniture) is used only when its whole cost for all `n`
  // pieces of this project is free in stock (spare(): net of reservations, other projects and the pieces
  // already chosen for this project), and then it comes first (best furnishing, then load order). It is
  // never required. The free stock is worked out only when such a piece is unlocked for the slot.
  let alt = null, free = null;
  for (const b of cands) {
    if (!b.stockedOnly) continue;
    free ||= spare ? spare() : { ...pool };
    if (!b.cost.every((c) => (free[c.item] || 0) >= c.qty * n)) continue;
    if (!alt || (b.furnishing?.score || 0) > (alt.furnishing?.score || 0)) alt = b;
  }
  if (alt) { for (const c of alt.cost) free[c.item] -= c.qty * n; return alt; }
  // The village's people may prefer a building for this slot (peoples.json prefer, e.g. Cragborn stone walls):
  // taken when unlocked and the whole cost for all n pieces is in the pool.
  const pref = g.reg.get('people', peopleOfSettlement(g, owner))?.prefer?.[tag];
  const pb = pref && cands.find((b) => b.id === pref);
  if (pb && pb.cost.every((c) => (pool[c.item] || 0) >= c.qty * n)) return pb;
  // Prefer what the colony can afford right now, then furnishing score, then load order.
  let best = null, bestScore = -Infinity;
  const regular = cands.some((b) => !b.stockedOnly);
  for (const b of cands) {
    if (b.stockedOnly && regular) continue;
    let afford = Infinity;
    for (const c of b.cost) afford = Math.min(afford, (pool[c.item] || 0) / c.qty);
    const score = Math.min(afford, 50) * 2 + (b.furnishing?.score || 0);
    if (score > bestScore) { bestScore = score; best = b; }
  }
  return best;
}

export function createProject(g, tpl, site, meta = {}) {
  const s = g.s;
  const id = g.newId('j');
  const cells = placedCells(tpl, site.x, site.y, site.rot);
  const owner = meta.owner || s.playerSettlement;
  const pool = {}; // the builder's own goods only (not other villages')
  for (const st of g.owned('stacks', owner)) pool[st.item] = (pool[st.item] || 0) + st.qty;
  const wallChoice = {};
  let spare = null;
  const spareStock = () => (spare ||= freeStock(g, owner, id)); // shared by all slot kinds of this project
  const project = {
    id, settlement: owner, templateId: tpl.id, name: tpl.name, kind: tpl.kind, x: site.x, y: site.y, rot: site.rot,
    cells: cells.map((c) => [c.x, c.y, c.ch]), parts: [], status: 'active', urgency: meta.urgency ?? 1,
    why: meta.why || '', created: s.tick, homeId: null, slots: [],
  };
  s.projects[id] = project;
  g.ownAdd('projects', project);
  for (const c of cells) {
    g.setFootId(g.i(c.x, c.y), id);
    let bid = null;
    if (c.spec?.build) bid = c.spec.build;
    else if (c.spec?.slot) {
      if (c.spec.optional) { project.slots.push({ x: c.x, y: c.y, tag: c.spec.slot }); continue; }
      wallChoice[c.spec.slot] ||= chooseSlot(g, c.spec.slot, pool, owner, cells.filter((x) => x.spec?.slot === c.spec.slot && !x.spec.optional).length, spareStock)?.id;
      bid = wallChoice[c.spec.slot];
    }
    if (!bid) continue;
    const def = g.reg.get('building', bid);
    const st = g.addStructure(bid, c.x, c.y, { projectId: id, rot: site.rot, order: ORDER[def.category] ?? 1, settlement: owner });
    project.parts.push(st.id);
  }
  if (tpl.kind === 'home') {
    const hid = g.newId('h');
    s.homes[hid] = { id: hid, settlement: owner, projectId: id, name: tpl.name, capacity: templateCapacity(g.reg, tpl), owners: [], complete: false };
    g.ownAdd('homes', s.homes[hid]);
    project.homeId = hid;
  }
  g.markDirtyCells(project.cells);
  return project;
}

/** Add a decor/optional furniture blueprint to an existing project slot. */
export function addSlotPart(g, project, slot, bid) {
  const def = g.reg.get('building', bid);
  const st = g.addStructure(bid, slot.x, slot.y, { projectId: project.id, rot: project.rot, order: ORDER[def.category] ?? 1, settlement: project.settlement });
  project.parts.push(st.id);
  slot.filled = st.id;
  project.status = 'active';
  g.markDirty(st.x, st.y);
  return st;
}

/** Can this blueprint be worked on now (build order respected)? */
export function partEligible(g, st) {
  const p = g.s.projects[st.projectId];
  if (!p) return true;
  const order = st.order ?? 1;
  for (const id of p.parts) {
    const o = g.s.structures[id];
    if (o && !o.built && (o.order ?? 1) < order) return false;
  }
  if (order >= 2) {
    // Walls go up last, after the footprint is clear of plants and loose items.
    for (const [x, y] of p.cells) if (g.nodeAt(x, y)) return false;
  }
  return true;
}

export function completeStructure(g, st, c) {
  const def = g.bDef(st);
  st.built = true;
  g.builtRev = (g.builtRev || 0) + 1; // derived: lod.js trap memo
  for (const cost of def.cost) {
    const have = st.delivered[cost.item] || 0;
    g.consume(cost.item, Math.min(have, cost.qty), 'construct');
    const extra = have - cost.qty;
    if (extra > 0) g.placeItems(cost.item, extra, st.x, st.y);
  }
  st.delivered = {};
  g.markDirty(st.x, st.y);
  const p = g.s.projects[st.projectId];
  if (!p) return;
  if (def.category === 'station' || def.category === 'furniture') {
    g.log(`${c ? c.name : 'Someone'} built a ${def.name}${p.kind === 'home' ? ` in the ${p.name}` : ''}.`, 'build', `built:${p.id}:${def.id}`, 60);
  }
  if (partsOf(g, p).every((x) => x.built)) {
    p.status = 'complete';
    if (!p.finishedTick) {
      p.finishedTick = g.s.tick;
      g.log(`${p.name} is finished.`, 'good');
    }
    if (p.homeId) {
      const home = g.s.homes[p.homeId];
      if (!home.complete) { home.complete = true; assignHome(g, home); }
    }
  }
}

/** Finish renovating one part: the new materials are used, and the part becomes the upgraded building in place. */
export function completeRenovation(g, st, c) {
  const to = g.reg.get('building', st.reno.to);
  const from = g.bDef(st);
  for (const cost of to.cost) {
    const have = st.reno.delivered[cost.item] || 0;
    g.consume(cost.item, Math.min(have, cost.qty), 'construct');
    const extra = have - cost.qty;
    if (extra > 0) g.placeItems(cost.item, extra, st.x, st.y);
  }
  for (const [it, q] of Object.entries(st.reno.delivered)) if (!to.cost.some((k) => k.item === it) && q > 0) g.placeItems(it, q, st.x, st.y);
  (st.renovatedFrom ||= []).push(st.def); // history, for accounting and the inspector
  const oldDef = st.def;
  st.def = to.id;
  g.structRev = (g.structRev || 0) + 1;
  g.structRedefined(st, oldDef); // it is another building now: the lists by building kind it left or joined are rebuilt (game.js structsWhere)
  st.progress = to.work;
  delete st.reno;
  const p = g.s.projects[st.projectId];
  g.log(`${c ? c.name : 'Someone'} rebuilt a ${from?.name} as a ${to.name}${p ? ` (${p.name})` : ''}.`, 'build', `reno:${p?.id}`, 300);
}

export function homeBeds(g, home) {
  const p = g.s.projects[home.projectId];
  return p ? partsOf(g, p).filter((st) => g.bDef(st)?.bed) : [];
}

export function assignHome(g, home) {
  const beds = homeBeds(g, home).filter((b) => b.built);
  const sid = home.settlement || g.s.playerSettlement;
  const homeless = g.colonists().filter((c) => !c.homeId && (c.settlementId || g.s.playerSettlement) === sid);
  const names = [];
  for (const bed of beds) {
    if (bed.owner && g.s.colonists[bed.owner]) continue;
    const c = homeless.shift();
    if (!c) break;
    bed.owner = c.id;
    c.bedId = bed.id;
    c.homeId = home.id;
    home.owners.push(c.id);
    names.push(c.name);
  }
  if (names.length) g.log(`${names.join(' & ')} moved into the ${home.name}.`, 'good');
}

/** Is a home "furnished": complete with every required bed/table/chair built? */
export function homeFurnished(g, home) {
  if (!home?.complete) return false;
  const p = g.s.projects[home.projectId];
  const parts = partsOf(g, p);
  const has = (tag) => parts.some((st) => st.built && g.bDef(st)?.slotTags?.includes(tag));
  return has('core:bed') && has('core:table') && has('core:chair');
}

export function cancelProject(g, p, reason) {
  for (const st of partsOf(g, p)) {
    if (st.built) continue;
    for (const [item, qty] of Object.entries(st.delivered)) if (qty > 0) g.placeItems(item, qty, st.x, st.y);
    st.delivered = {};
    g.removeStructure(st.id);
  }
  p.parts = p.parts.filter((id) => g.s.structures[id]);
  p.status = p.parts.length ? 'complete' : 'cancelled';
  for (const [x, y] of p.cells) if (g.footIdAt(g.i(x, y)) === p.id && p.status === 'cancelled') g.setFootId(g.i(x, y), null);
  if (p.homeId && p.status === 'cancelled' && g.s.homes[p.homeId]) { g.ownDel('homes', g.s.homes[p.homeId]); delete g.s.homes[p.homeId]; }
  g.log(`${p.name} was cancelled: ${reason}`, 'warn');
  g.markDirtyCells(p.cells);
}
