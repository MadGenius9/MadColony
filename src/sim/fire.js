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
// - Firefighting (slice 6c): a burning tile within `threat` tiles of a village's burnable built part, field or
//   stockpile threatens that village; its awake, able adults (health above half, not fleeing a fight) within
//   `fightReach` go next to the nearest threatening tile and beat it out (`fightWork` ticks, twice as fast with a
//   well, pump or water within `fightWater` tiles: they carry water), and the tile goes out (scorched; what stands
//   there is kept). They do not flee; they take the usual burns beside a fire. A distant village puts out each tile
//   threatening it with chance `distantPut` per fire step (nobody walks there).
// Distant villages burn by the same rules (their people stand round the centre; nobody flees there).
// Draws are hashes (seed, tile, tick). Cost: O(burning tiles) per step, plus one pass over the colonists while
// anything burns.
import { destroyStructure, destroyNode, destroyStack, destroyCrop, replan } from './ruin.js';
import { injure } from './health.js';
import { newJob } from './ai/jobs.js';
import { stageOf } from './people.js';
import { hpOf } from './health.js';
import { godRulesOf } from './god.js';
import { weatherAtTile, weatherRules } from './weather.js';

export const FIRE_DEFAULTS = Object.freeze({ step: 25, spread: 0.3, burnTicks: 300, maxTiles: 600, burnPerStep: 3, scorchDays: 30, cropFlammable: 0.6, threat: 3, fightReach: 30, fightWork: 50, fightWater: 15, distantPut: 0.35 });
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
  if (n && (g.nodeDef(n)?.flammable || 0) > 0) destroyNode(g, n.id, null, fireRules(g).scorchDays); // regrows once the scorch fades
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
  // Distant villages put out the fires that threaten them (by chance; nobody walks there).
  const T = threats(g, F);
  for (const [sid, list] of T) {
    if (s.settlements?.[sid]?.detail !== 'abstract') continue;
    for (const i of list) if (Object.hasOwn(D.fires, i) && draw(`${s.seed}:putout:${sid}:${i}:${s.tick}`) < F.distantPut) putOut(g, i);
  }
  const owners = [];
  for (const i of out) owners.push(...burnOut(g, i));
  replan(g, owners);
  if (keys.length && !Object.keys(D.fires).length) g.log('The fire has burned out.', 'info', 'fire-out', 2400);
}

/** Put out burning tile i (left scorched; what stands there is kept). */
export function putOut(g, i) {
  const D = g.s.disasters;
  if (!D || !Object.hasOwn(D.fires, i)) return false;
  delete D.fires[i];
  D.scorched[i] = g.s.tick;
  return true;
}

/** Burning tiles that threaten each village: sid -> sorted tile list (derived: at most once a tick, from the state
 *  as it is then, so a loaded game builds the same; never saved). O(burning tiles × threat²). */
function threats(g, F = fireRules(g)) {
  const D = g.s.disasters, step = g.s.tick;
  if (g._fireThreat?.step === step && g._fireThreat.D === D) return g._fireThreat.by;
  const by = new Map(), r = F.threat;
  for (const i of Object.keys(D?.fires || {}).map(Number).sort((a, b) => a - b)) {
    const x = i % g.W, y = (i - x) / g.W, seen = new Set();
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (!g.inB(xx, yy)) continue;
      const j = g.i(xx, yy);
      let sid = null;
      const st = g.structAt(xx, yy);
      if (st?.built && buildingFlammable(g, g.bDef(st)) > 0) sid = st.settlement || g.s.playerSettlement;
      else {
        const z = g.zoneAt(j);
        if (z) sid = z.startsWith('S:') ? z.slice(2) : (g.s.fields[z]?.settlement || g.s.playerSettlement);
      }
      if (sid && !seen.has(sid)) { seen.add(sid); if (!by.has(sid)) by.set(sid, []); by.get(sid).push(i); }
    }
  }
  g._fireThreat = { step, D, by };
  return by;
}

/** Is there water within r tiles of (x, y): a built well or pump (a building with `water`), or drinkable ground? */
function waterNear(g, x, y, r) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const xx = x + dx, yy = y + dy;
    if (!g.inB(xx, yy)) continue;
    if (g.terrainAt(xx, yy).drinkable) return true;
    const st = g.structAt(xx, yy);
    if (st?.built && g.bDef(st)?.water) return true;
  }
  return false;
}

const COMBAT = new Set(['fight', 'flee', 'arm']); // combat.js COMBAT_JOBS (not imported: an import cycle)

/** Can c fight a fire now? An awake adult of a full-detail village, on its feet, health above half, not fighting,
 *  not seeing to a need or carrying someone or something, and with no need below its seek line (else the needs
 *  interrupt would end the firefight at once and the fire would end the meal: they would take turns). */
function canFight(g, c) {
  if (c.sleeping || c.health?.down || hpOf(c) <= 50 || c.carriedBy || c.carry) return false;
  const j = c.job;
  if (j && (COMBAT.has(j.type) || j.need || j.stage === 'carry' || j.water)) return false;
  for (const def of g.reg.all('need')) if ((c.needs[def.id] ?? 1) < def.seekBelow) return false;
  const st = stageOf(g, c);
  if (st && st.untilDays !== undefined) return false; // children do not
  return g.s.settlements?.[c.settlementId || g.s.playerSettlement]?.detail !== 'abstract';
}

/** A firefighting job for c: the nearest tile threatening its village within fightReach, or null. */
function fightFire(g, c, F) {
  if (!F.fightReach) return null; // fightReach 0: firefighting is off
  const list = threats(g, F).get(c.settlementId || g.s.playerSettlement);
  if (!list?.length || !canFight(g, c)) return null;
  let best = -1, bd = Infinity;
  for (const i of list) {
    if (!Object.hasOwn(g.s.disasters.fires, i) || g.isBlocked(`fire:${i}`)) continue; // no way there lately
    const x = i % g.W, y = (i - x) / g.W, d = Math.max(Math.abs(x - c.x), Math.abs(y - c.y));
    if (d <= F.fightReach && d < bd) { bd = d; best = i; }
  }
  if (best < 0) return null;
  const x = best % g.W, y = (best - x) / g.W;
  return newJob('firefight', { tile: best, x, y, water: waterNear(g, x, y, F.fightWater), prog: 0 }, { why: 'A fire threatens the village', label: 'Fight the fire', targetKey: `fire:${best}` });
}

/** ai.js tickColonist (only while something burns): fight a fire that threatens the village (firefighting), else
 *  a flee job away from a fire within 2 tiles, else null. */
export function fireDanger(g, c) {
  const D = g.s.disasters;
  if (!D || !c || c.job?.type === 'flee' || c.job?.type === 'firefight' || c.job?.type === 'fight' || c.job?.type === 'arm' || c.health?.down) return null;
  if ((g.s.tick + c.id.length * 7) % 5) return null;
  if (!Object.keys(D.fires).length) return null;
  const fight = fightFire(g, c, fireRules(g));
  if (fight) return fight;
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
