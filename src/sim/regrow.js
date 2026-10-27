// Regrowth (Phase 5b, slice 6d). Two rules:
// - Scars heal, in every game: a tree or plant (a node with `flammable` above 0) destroyed by a fire, a meteor or a
//   tornado leaves a seed in `s.disasters.seeds` (tile -> { def, at }). From `at` (fire: when the scorch mark fades;
//   else seedDays later) it sprouts at the next hour if the tile is free: a young node (empty, `young`), which
//   grows up like a picked plant regrows (farming.js), in the node's `sproutDays` (data). A seed whose tile is
//   built on, zoned or turned to bare ground is dropped; one still blocked sproutTries days later too.
// - Forests spread, where the scenario says (`scenario.nature.spread`, the Vast and Living worlds): every hour a
//   24th of each listed kind's nodes (by their place in the world's list) has its daily chance `perDay` to drop a
//   seed on a tile within `radius` on the same ground, free, with no building, building site or zone (stockpile,
//   field) within CLEAR tiles (village grounds stay open), with at least `minNear`
//   (default 3: forests refill, lone trees do not spread over open land) and fewer than `maxNear` of its kind within
//   2 tiles; the seed sprouts a day or so later, at an hour of its own. Classic games have no spread.
// Draws are hashes of (seed, node or tile, day); nothing while there are no seeds and no spread rule.
// Cost: O(seeds + nodes of the spreading kinds / 24) an hour.
import { TICKS_PER_DAY } from './constants.js';

export const REGROW_DEFAULTS = Object.freeze({ seedDays: 10, sproutTries: 30, sproutDays: 10 });
const NEAR = 2, CLEAR = 3;

const hash = (str) => {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};
const draw = (key) => hash(key) / 4294967296;
/** A fast draw in [0, 1) from whole numbers (the hourly spread check runs for thousands of nodes). */
const mix = (a, b, c) => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2f);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

/** The scenario's nature rules ({ spread: [...] }), or null. */
export function natureRules(g) {
  if (g._natRulesFor !== g.s.scenarioId) { g._natRules = g.reg.get('scenario', g.s.scenarioId)?.nature || null; g._natRulesFor = g.s.scenarioId; }
  return g._natRules;
}

/** ruin.js destroyNode: a plant destroyed by a disaster leaves a seed that sprouts after `days` (default seedDays). */
export function leaveSeed(g, n, days = null) {
  if (!((g.nodeDef(n)?.flammable || 0) > 0)) return; // rocks do not regrow
  const s = g.s;
  s.disasters ||= { fires: {}, scorched: {} };
  const seeds = (s.disasters.seeds ||= {});
  seeds[g.i(n.x, n.y)] = { def: n.def, at: s.tick + Math.round((days ?? REGROW_DEFAULTS.seedDays) * TICKS_PER_DAY) };
}

/** Why tile i cannot hold a new plant now: 'never' (built, zoned, bare or water), 'busy' (for now), or null. */
function blocked(g, i) {
  const x = i % g.W, y = (i - x) / g.W, t = g.terrainAt(x, y);
  if (!t.passable || t.drinkable || t.id === 'core:crater') return 'never';
  if (g.structIdAt(i) || g.footIdAt(i) || g.zoneAt(i)) return 'never';
  if (g.nodeIdAt(i) || g.cropIdAt(i) || g.stackIdAt(i)) return 'busy';
  const D = g.s.disasters;
  if (D && (Object.hasOwn(D.fires, i) || Object.hasOwn(D.scorched, i))) return 'busy';
  return null;
}

/** Is there a building, building site or zone within CLEAR tiles of (x, y)? */
function villageNear(g, x, y) {
  for (let yy = y - CLEAR; yy <= y + CLEAR; yy++) for (let xx = x - CLEAR; xx <= x + CLEAR; xx++) {
    if (!g.inB(xx, yy)) continue;
    const j = g.i(xx, yy);
    if (g.structIdAt(j) || g.footIdAt(j) || g.zoneAt(j)) return true;
  }
  return false;
}

/** A young node of `def` on tile i. */
function sprout(g, def, i) {
  const n = g.addNode(def, i % g.W, (i - (i % g.W)) / g.W);
  n.young = true; n.chunks = 0;
  g.nodeEmptied(n);
  return n;
}

/** Game.tick, once an hour (only while there are seeds or a spread rule). */
export function tickRegrowth(g) {
  const s = g.s, day = Math.floor(s.tick / TICKS_PER_DAY), hour = Math.floor((s.tick % TICKS_PER_DAY) / 100);
  // Seeds due (burned, crushed or torn-up plants; seeds of spreading forests): each hour, so new plants (which block
  // the way: walkable areas and paths there are worked out again) come a few at a time.
  const seeds = s.disasters?.seeds;
  if (seeds) {
    let n = 0;
    for (const k of Object.keys(seeds).sort((a, b) => a - b)) {
      const e = seeds[k], i = Number(k);
      if (s.tick < e.at) continue;
      const why = g.reg.has('node', e.def) ? blocked(g, i) : 'never';
      if (!why) { sprout(g, e.def, i); n++; delete seeds[k]; } else if (why === 'never' || s.tick >= e.at + REGROW_DEFAULTS.sproutTries * TICKS_PER_DAY) delete seeds[k];
    }
    if (!Object.keys(seeds).length) delete s.disasters.seeds;
    if (n) g.log(`${n} young plant${n === 1 ? '' : 's'} sprouted on burned and broken ground.`, 'info', 'sprout', 2400);
  }
  // Forests spread (scenario rule).
  const R = natureRules(g)?.spread;
  if (!R?.length) return;
  const byDef = g.nodesByDef(), seedNum = hash(`${s.seed}:spread`);
  for (const rule of R) {
    const list = byDef.get(rule.node) || [];
    for (let k = hour; k < list.length; k += 24) {
      const p = list[k];
      if (p.young || !s.nodes[p.id]) continue;
      if (mix(seedNum, Number(p.id.slice(1)) | 0, day) >= rule.perDay) continue;
      const key = `${s.seed}:spread:${p.id}:${day}`;
      const r = rule.radius, dx = Math.floor(draw(key + ':x') * (2 * r + 1)) - r, dy = Math.floor(draw(key + ':y') * (2 * r + 1)) - r;
      const x = p.x + dx, y = p.y + dy;
      if ((!dx && !dy) || !g.inB(x, y)) continue;
      const i = g.i(x, y);
      if (g.terrainAt(i) !== g.terrainAt(g.i(p.x, p.y)) || blocked(g, i) || villageNear(g, x, y)) continue;
      let near = 0;
      for (let yy = y - NEAR; yy <= y + NEAR; yy++) for (let xx = x - NEAR; xx <= x + NEAR; xx++) if (g.inB(xx, yy) && g.nodeAt(xx, yy)?.def === rule.node) near++;
      if (near >= rule.maxNear || near < (rule.minNear ?? 3)) continue;
      s.disasters ||= { fires: {}, scorched: {} };
      const sd = (s.disasters.seeds ||= {});
      if (!Object.hasOwn(sd, i)) sd[i] = { def: rule.node, at: s.tick + TICKS_PER_DAY + 100 * Math.floor(draw(key + ':h') * 24) };
    }
  }
}
