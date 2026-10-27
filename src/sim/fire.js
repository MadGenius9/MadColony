// Fire (Phase 5b, slice 2). World state, not village state: `s.disasters.fires` (tile index -> tick it caught fire)
// and `s.disasters.scorched` (tile index -> tick it burned out), made when the first fire starts.
// Every FIRE.step ticks (data: godRules.wrath.fire), in tile order:
// - each burning tile may light each of its 8 neighbours with chance spread x the neighbour's flammability (the most
//   flammable thing on it: a building, a tree or plant, a crop, goods, else the ground; terrains, nodes, buildings
//   and items carry `flammable` in data; water and bare rock do not burn; scorched tiles do not burn again for
//   scorchDays), while fewer than maxTiles burn world-wide;
// - people on or beside a burning tile get burns (ongoing), and people within 2 tiles run from it (flee job, ai.js);
// - a tile burns for burnTicks (a third of that for bare ground) and then burns out: what stood on it is gone
//   (buildings through ruin.js, which brings home parts back as building sites; goods consumed as 'fire') and it
//   is scorched (no terrain change: on big worlds a terrain change rebuilds the whole-map water and territory data).
// Distant villages burn by the same rules (their people stand round the centre; nobody flees there).
// Draws are hashes (seed, tile, tick). Cost: O(burning tiles) per step, plus one pass over the colonists while
// anything burns.
import { destroyStructure, destroyNode, destroyStack, destroyCrop, replan } from './ruin.js';
import { injure } from './health.js';
import { newJob } from './ai/jobs.js';
import { godRulesOf } from './god.js';
import { weatherAtTile, weatherRules } from './weather.js';

export const FIRE_DEFAULTS = Object.freeze({ step: 25, spread: 0.3, burnTicks: 300, maxTiles: 600, burnPerStep: 3, scorchDays: 30, cropFlammable: 0.6 });
export const fireRules = (g) => ({ ...FIRE_DEFAULTS, ...(godRulesOf(g)?.wrath?.fire || {}) });

const hash = (str) => {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};
const draw = (key) => hash(key) / 4294967296;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

/** The disasters state, made on first use. */
export function disasters(g) {
  return (g.s.disasters ||= { fires: {}, scorched: {} });
}
export const isBurning = (g, i) => !!g.s.disasters?.fires && Object.hasOwn(g.s.disasters.fires, i);

/** How flammable a building definition is: its own `flammable`, else the share of flammable materials in its cost. */
export function buildingFlammable(g, def) {
  if (!def) return 0;
  if (def.flammable !== undefined) return def.flammable;
  let all = 0, f = 0;
  for (const c of def.cost || []) { all += c.qty; f += c.qty * (g.reg.get('item', c.item)?.flammable || 0); }
  return all ? f / all : 0;
}

/** How flammable tile i is now (0 = it cannot burn), and whether it has fuel beyond the ground. */
export function tileFlammable(g, i, F = fireRules(g)) {
  const D = g.s.disasters;
  if (D?.scorched && Object.hasOwn(D.scorched, i) && g.s.tick - D.scorched[i] < F.scorchDays * 2400) return { f: 0, fuel: false };
  const x = i % g.W, y = (i - x) / g.W;
  let f = 0, fuel = false;
  const st = g.structAt(x, y);
  if (st) { const v = buildingFlammable(g, g.bDef(st)); if (v > 0) { f = Math.max(f, v); fuel = true; } }
  const n = g.nodeAt(x, y);
  if (n) { const v = g.nodeDef(n)?.flammable || 0; if (v > 0) { f = Math.max(f, v); fuel = true; } }
  if (g.cropAt(x, y)) { f = Math.max(f, F.cropFlammable); fuel = true; }
  const sk = g.stackAt(x, y);
  if (sk) { const v = g.reg.get('item', sk.item)?.flammable || 0; if (v > 0) { f = Math.max(f, v); fuel = true; } }
  f = Math.max(f, g.terrainAt(x, y)?.flammable || 0);
  return { f, fuel };
}

/** Set tile i on fire now (if it can burn or `force`). Returns true when it caught. */
export function ignite(g, i, force = false) {
  const D = disasters(g);
  if (Object.hasOwn(D.fires, i)) return false;
  if (D.weather && weatherAtTile(g, i) === 'rain') return false; // nothing catches fire in the rain (weather.js)
  if (!force && tileFlammable(g, i).f <= 0) return false;
  if (Object.keys(D.fires).length >= fireRules(g).maxTiles) return false;
  D.fires[i] = g.s.tick;
  return true;
}

/** Colonists by tile index (one pass), for the fire step. */
function byTile(g) {
  const m = new Map();
  for (const c of Object.values(g.s.colonists).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const i = Math.round(c.y) * g.W + Math.round(c.x);
    if (!m.has(i)) m.set(i, []);
    m.get(i).push(c);
  }
  return m;
}

/** Burn out tile i: what stands on it is destroyed, the tile is scorched. Returns the owners of destroyed buildings. */
function burnOut(g, i) {
  const x = i % g.W, y = (i - x) / g.W, owners = [];
  const st = g.structAt(x, y);
  if (st && buildingFlammable(g, g.bDef(st)) > 0) { owners.push(st.settlement || g.s.playerSettlement); destroyStructure(g, st.id, { reason: 'fire', why: 'Burned down', replan: false }); }
  const n = g.nodeAt(x, y);
  if (n && (g.nodeDef(n)?.flammable || 0) > 0) destroyNode(g, n.id);
  const cr = g.cropAt(x, y);
  if (cr) destroyCrop(g, cr.id);
  const sk = g.stackAt(x, y);
  if (sk && (g.reg.get('item', sk.item)?.flammable || 0) > 0) destroyStack(g, sk.id, 'fire');
  const D = g.s.disasters;
  delete D.fires[i];
  D.scorched[i] = g.s.tick;
  return owners;
}

/** Game.tick: the fire step (nothing while nothing burns). */
export function tickFire(g) {
  const D = g.s.disasters;
  if (!D) return;
  const F = fireRules(g);
  if (g.s.tick % F.step) return;
  const s = g.s, W = g.W, H = g.H;
  // Scorch marks fade (their tiles can burn again).
  for (const k of Object.keys(D.scorched)) if (s.tick - D.scorched[k] >= F.scorchDays * 2400) delete D.scorched[k];
  const keys = Object.keys(D.fires).map(Number).sort((a, b) => a - b);
  if (!keys.length) return;
  const people = byTile(g);
  const catching = new Set(), out = [], burned = new Set(), wx = !!D.weather, dry = wx ? weatherRules(g).drought.spread : 1;
  const rained = [];
  let count = keys.length;
  for (const i of keys) {
    const x = i % W, y = (i - x) / W, since = D.fires[i];
    if (wx && weatherAtTile(g, i) === 'rain') { rained.push(i); continue; } // put out by the rain (below)
    for (let d = 0; d < 8; d++) {
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (Object.hasOwn(D.fires, j) || catching.has(j) || count >= F.maxTiles) continue;
      const t = tileFlammable(g, j, F);
      if (t.f <= 0) continue;
      const k = wx ? weatherAtTile(g, j) : null;
      if (k === 'rain') continue;
      if (draw(`${s.seed}:fire:${j}:${i}:${s.tick}`) < F.spread * t.f * (k === 'drought' ? dry : 1)) { catching.add(j); count++; }
    }
    // Burns for people on it or beside it (once a step each).
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const c of people.get((y + dy) * W + (x + dx)) || []) {
        if (burned.has(c.id) || !s.colonists[c.id]) continue;
        burned.add(c.id);
        injure(g, c, 'burn', F.burnPerStep, 'Caught in a fire', true, (c.settlementId || s.playerSettlement) === s.playerSettlement ? 'warn' : 'info');
      }
    }
    const { fuel } = tileFlammable(g, i, F);
    if (s.tick - since >= (fuel ? F.burnTicks : F.burnTicks / 3)) out.push(i);
  }
  for (const j of [...catching].sort((a, b) => a - b)) D.fires[j] = s.tick;
  for (const i of rained) { delete D.fires[i]; D.scorched[i] = s.tick; } // out: what stands there is left
  const owners = [];
  for (const i of out) owners.push(...burnOut(g, i));
  replan(g, owners);
  if (keys.length && !Object.keys(D.fires).length) g.log('The fire has burned out.', 'info', 'fire-out', 2400);
}

/** ai.js tickColonist (only while something burns): a flee job away from a fire within 2 tiles, or null. */
export function fireDanger(g, c) {
  const D = g.s.disasters;
  if (!D || !c || c.job?.type === 'flee' || c.health?.down) return null;
  if ((g.s.tick + c.id.length * 7) % 5) return null;
  const x = Math.round(c.x), y = Math.round(c.y), W = g.W;
  let fx = 0, fy = 0, n = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Object.hasOwn(D.fires, (y + dy) * W + (x + dx))) { fx += dx; fy += dy; n++; }
  if (!n) return null;
  const len = Math.hypot(fx, fy) || 1;
  let tx = Math.round(x - (fx / len) * 8), ty = Math.round(y - (fy / len) * 8);
  tx = Math.max(0, Math.min(g.W - 1, tx)); ty = Math.max(0, Math.min(g.H - 1, ty));
  if (!g.isPassable(tx, ty)) { const h = g.s.settlements?.[c.settlementId]?.center || g.s.center; tx = h.x; ty = h.y; }
  return newJob('flee', { x: tx, y: ty, why: 'Running from the fire' }, { why: 'Fire nearby', label: 'Run from the fire' });
}
