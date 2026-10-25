// Crop growth, wild regrowth, and autonomous field planning.
import { TICKS_PER_DAY } from './constants.js';
import { clamp, octile } from './util.js';
import { fieldCells } from './game.js';
import { seasonalTemp, outdoorTemp, climateOf } from './heat.js';

export const CROP = { minTemp: 5, frost: -3, fullAt: 3 }; // full growth this many °C above minTemp

/** Growth speed from the season (0..1) for a crop at a given seasonal temperature. */
export function seasonGrowth(def, t) {
  const min = def.minTemp ?? CROP.minTemp;
  return clamp((t - min) / CROP.fullAt, 0, 1);
}
/** Would a crop sown now ripen before frost? Looks ahead through the seasons (day/night swing included). */
export function canRipen(g, def, from = g.s.tick) {
  const swing = climateOf(g).daySwing;
  let growth = 0;
  for (let d = 0; d < 60; d += 0.25) {
    const t = from + d * TICKS_PER_DAY, st = seasonalTemp(g, t);
    if (st - swing < (def.frost ?? CROP.frost)) return false; // a frost night comes first
    growth += (0.25 / def.growDays) * seasonGrowth(def, st);
    if (growth >= 1) return true;
  }
  return false;
}
/** Wild plants regrow more slowly in the cold (0.2 in deep winter .. 1). */
export const wildGrowth = (g) => clamp((seasonalTemp(g) + 2) / 10, 0.2, 1);

export function tickFarming(g, dt) {
  const season = seasonalTemp(g); // the same for every crop this tick
  for (const cr of Object.values(g.s.crops)) {
    if (cr.growth >= 1) continue;
    const def = g.reg.get('crop', cr.def);
    if (!def) continue;
    const fert = clamp(g.terrainAt(cr.x, cr.y).fertility, 0.4, 1.6);
    cr.growth = Math.min(1, cr.growth + (dt / (def.growDays * TICKS_PER_DAY)) * fert * seasonGrowth(def, season));
    if (cr.growth >= 1) g.log(`${def.name} are ready to harvest.`, 'food', `ripe:${def.id}`, 600);
  }
  if (g.s.tick % 50 === 0) {
    // Hard frost kills plants that are not ripe yet (the seed is lost; the field is sown again in spring).
    const now = outdoorTemp(g);
    const killed = {};
    for (const cr of Object.values(g.s.crops)) {
      if (cr.growth >= 1) continue;
      const def = g.reg.get('crop', cr.def);
      if (!def || now >= (def.frost ?? CROP.frost)) continue;
      g.removeCrop(cr.id);
      killed[def.name] = (killed[def.name] || 0) + 1;
    }
    for (const [name, n] of Object.entries(killed)) g.log(`Frost killed ${n} young ${name}.`, 'warn', `frost:${name}`, 2400);
    const wild = wildGrowth(g);
    const empty = g.emptyNodes(); // picked plants only (each regrows on its own, so the order does not matter)
    for (const n of [...empty.values()]) {
      if (!n.empty || g.s.nodes[n.id] !== n) { empty.delete(n.id); continue; }
      const def = g.nodeDef(n);
      n.regrow = (n.regrow || 0) + (50 * wild) / ((def?.regrowDays || 1) * TICKS_PER_DAY);
      if (n.regrow >= 1) { n.empty = false; n.regrow = 0; n.chunks = def.chunks; empty.delete(n.id); }
    }
  }
}

/** Expected nutrition per plot per day for a crop. */
export function cropNutritionRate(g, crop) {
  let n = 0;
  for (const h of crop.harvest) n += h.qty * (g.reg.get('item', h.item)?.nutrition || 0);
  return Math.max(0, n - (g.reg.get('item', crop.seed)?.nutrition || 0)) / crop.growDays;
}

export function fieldTileCount(g) {
  let n = 0;
  for (const f of Object.values(g.s.fields)) n += f.w * f.h;
  return n;
}

/** Find a rectangle of fertile, free land near the colony for a new field. */
export function findFieldSite(g, w, h, crop, center, sid) {
  const c0 = center || g.s.center;
  const cx = c0.x, cy = c0.y;
  const homeRegion = g.regionOf(cx, cy);
  const owner = sid || g.s.playerSettlement;
  const a = owner === g.s.playerSettlement ? g.s.allowedArea : null;
  let best = null;
  for (let r = 3; r <= 22; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x0 = cx + dx, y0 = cy + dy;
      let ok = true, penalty = 0, reach = false;
      for (let y = y0; y < y0 + h && ok; y++) for (let x = x0; x < x0 + w && ok; x++) {
        if (x < 1 || y < 1 || x >= g.W - 1 || y >= g.H - 1) { ok = false; break; }
        if (a && (x < a.x0 || y < a.y0 || x > a.x1 || y > a.y1)) { ok = false; break; }
        if (!g.claimOk(owner, x, y)) { ok = false; break; }
        const t = g.terrainAt(x, y);
        if (!t.passable || !t.buildable || t.fertility < (crop.minFertility ?? 0.5)) { ok = false; break; }
        const i = g.i(x, y);
        if (g.structIdAt(i) || g.footIdAt(i) || g.zoneAt(i)) { ok = false; break; }
        // keep a gap next to building sites so their walls stay walkable
        for (let ey = -1; ey <= 1; ey++) for (let ex = -1; ex <= 1; ex++) {
          if (g.inB(x + ex, y + ey) && g.footIdAt(g.i(x + ex, y + ey))) ok = false;
        }
        const n = g.nodeAt(x, y);
        if (n) {
          const d = g.nodeDef(n);
          const cost = (d?.work || 0) * (n.chunks || 1);
          if (cost > 400) { ok = false; break; }
          penalty += cost / 60;
        }
        penalty -= (t.fertility - 1) * 2;
        if (g.regionAt(i) === homeRegion) reach = true;
      }
      if (!ok || !reach) continue;
      const score = octile(cx, cy, x0 + w / 2, y0 + h / 2) + penalty;
      if (!best || score < best.score) best = { x: x0, y: y0, score };
    }
    if (best && r > best.score + 3) break;
  }
  return best;
}

export function createField(g, crop, site, w, h, owner) {
  const id = g.newId('f');
  const f = { id, settlement: owner || g.s.playerSettlement, crop: crop.id, x: site.x, y: site.y, w, h, created: g.s.tick };
  g.s.fields[id] = f;
  g.ownAdd('fields', f);
  for (const [x, y] of fieldCells(f)) g.setZone(g.i(x, y), id);
  g.log(`The colonists marked out a ${w}x${h} field for ${crop.name}.`, 'food');
  return f;
}
