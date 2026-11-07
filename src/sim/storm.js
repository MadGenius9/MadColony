// Tornadoes (Phase 5b, slice 5). World state: `s.disasters.storms` (id -> storm), made by the tornado power.
// A storm { x, y, d, n, next, until, key, hit } stands on tile (x, y) heading in direction d (0..7: east, then
// clockwise in 45 degree steps). Every wrath.tornado.step ticks it moves one tile; before each move it may turn one step
// left or right (wander). Draws are hashes of (key, step); no trigonometry, so a storm's path is the same on every
// machine and the preview can show it exactly (stormPath).
// On each step, on the tiles within `radius` of it:
// - trees and plants are torn up: what a felled one gives (its yields x chunks, none if it is bare) is created
//   ('divine') and thrown downwind; crops are destroyed;
// - goods on the ground are thrown downwind, `throw` [lo, hi] tiles (moved, not counted again: ruin.js moveStack);
// - built parts at least `light` wooden (fire.js buildingFlammable) are torn down with chance `destroy` (their goods
//   fall to the ground and their village rebuilds them: ruin.js); stone stands;
// - people are hurt once per storm (wound severity `wound`).
// A storm dies away after `hours`, or when it leaves the map. At most `maxStorms` at once.
// Wood from trees on land nobody holds goes to the player's village (as goods created without an owner do).
// Cost: one sort of the colonists and O(radius² x colonists) job checks per storm step; nothing while none blows.
import { destroyStructures, destroyNode, destroyCrop, moveStack } from './ruin.js';
import { injure } from './health.js';
import { godRulesOf } from './god.js';
import { buildingFlammable, disasters } from './fire.js';

export const STORM_DEFAULTS = Object.freeze({ step: 10, hours: 4, radius: 1, wander: 0.4, destroy: 0.5, light: 0.5, wound: [10, 40], throw: [2, 5], maxStorms: 3 });
export const stormRules = (g) => ({ ...STORM_DEFAULTS, ...(godRulesOf(g)?.wrath?.tornado || {}) });
export const DIRS8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

const hash = (str) => {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};
export const stormDraw = (key) => hash(key) / 4294967296;
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Number of steps a storm takes. */
export const stormSteps = (T) => Math.max(1, Math.round((T.hours * 100) / T.step));

/** The direction a storm heads after step n (it may turn one step left or right). */
function turn(d, key, n, T) {
  const u = stormDraw(`${key}:turn:${n}`);
  if (u < T.wander / 2) return (d + 7) % 8;
  if (u < T.wander) return (d + 1) % 8;
  return d;
}

/** The tiles a storm from (x, y) heading d will stand on, in order, until it dies away or leaves the map. Read-only. */
export function stormPath(g, x, y, d, key, T = stormRules(g)) {
  const out = [];
  for (let n = 0; n < stormSteps(T) && g.inB(x, y); n++) {
    out.push([x, y]);
    d = turn(d, key, n, T);
    x += DIRS8[d][0]; y += DIRS8[d][1];
  }
  return out;
}

/** Start a storm (the tornado power; its id comes from the command id). Returns it. */
export function startStorm(g, x, y, d, key, cmdId) {
  const D = disasters(g), T = stormRules(g);
  D.storms ||= {};
  const id = `t${cmdId}`;
  const st = { id, x, y, d, n: 0, next: g.s.tick, until: g.s.tick + stormSteps(T) * T.step, key, hit: [] };
  D.storms[id] = st;
  return st;
}

export const stormCount = (g) => Object.keys(g.s.disasters?.storms || {}).length;

/** Game.tick (while s.disasters.storms exists): each storm due takes one step, in id order. */
export function tickStorms(g) {
  const D = g.s.disasters;
  if (!D?.storms) return;
  const T = stormRules(g);
  for (const id of Object.keys(D.storms).sort()) {
    const st = D.storms[id];
    if (g.s.tick >= st.until || !g.inB(st.x, st.y)) { endStorm(g, id); continue; }
    if (g.s.tick < st.next) continue;
    blow(g, st, T);
    st.d = turn(st.d, st.key, st.n, T);
    st.x += DIRS8[st.d][0]; st.y += DIRS8[st.d][1];
    st.n++;
    st.next = g.s.tick + T.step;
  }
  if (!Object.keys(D.storms).length) delete D.storms;
}

function endStorm(g, id) {
  const st = g.s.disasters.storms[id];
  delete g.s.disasters.storms[id];
  g.log(`The tornado has died away${st.hit.length ? ` (${st.hit.length} hurt)` : ''}.`, 'info');
}

/** One step of a storm at its tile. */
function blow(g, st, T) {
  const s = g.s, r = T.radius, [dx, dy] = DIRS8[st.d], key = `${st.key}:${st.n}`;
  const far = (k) => Math.round(T.throw[0] + (T.throw[1] - T.throw[0]) * stormDraw(`${key}:throw:${k}`));
  const downwind = (x, y, k) => { const f = far(k); return [Math.min(g.W - 1, Math.max(0, x + dx * f)), Math.min(g.H - 1, Math.max(0, y + dy * f))]; };
  const torn = [], thrown = [], people = Object.values(s.colonists).sort(byId); // sorted once per step
  // The goods to throw, first: wood felled in this step is not thrown again in it.
  for (let y = st.y - r; y <= st.y + r; y++) for (let x = st.x - r; x <= st.x + r; x++) {
    if (!g.inB(x, y)) continue;
    const i = g.i(x, y), sk = g.stackIdAt(i);
    if (sk) thrown.push([sk, x, y, i]);
  }
  for (let y = st.y - r; y <= st.y + r; y++) for (let x = st.x - r; x <= st.x + r; x++) {
    if (!g.inB(x, y)) continue;
    const i = g.i(x, y);
    const nid = g.nodeIdAt(i), n = nid && s.nodes[nid], nd = n && g.nodeDef(n);
    if (n && (nd?.flammable || 0) > 0) { // a tree or plant (rocks stay)
      const yields = n.empty ? [] : (nd.yields || []).map((e) => ({ item: e.item, qty: e.qty * (n.chunks || 1) }));
      destroyNode(g, nid, people);
      const [tx, ty] = downwind(x, y, `n${i}`), prev = g.actor;
      g.actor = g.territoryAt(x, y) || null;
      try { for (const e of yields) if (e.qty > 0 && g.reg.has('item', e.item)) g.createItems(e.item, e.qty, tx, ty, 'divine'); } finally { g.actor = prev; }
    }
    const cr = g.cropIdAt(i);
    if (cr) destroyCrop(g, cr);
    const b = g.structAt(x, y);
    if (b?.built && !b.grave && buildingFlammable(g, g.bDef(b)) >= T.light && stormDraw(`${key}:b:${b.id}`) < T.destroy) torn.push(b.id);
  }
  for (const [sk, x, y, i] of thrown) { const [tx, ty] = downwind(x, y, `s${i}`); moveStack(g, sk, tx, ty, people); }
  const hit = new Set(st.hit);
  for (const c of people) {
    if (!s.colonists[c.id]) continue;
    if (hit.has(c.id) || g._dying?.has(c.id)) continue;
    if (Math.max(Math.abs(Math.round(c.x) - st.x), Math.abs(Math.round(c.y) - st.y)) > r) continue;
    injure(g, c, 'wound', T.wound[0] + (T.wound[1] - T.wound[0]) * stormDraw(`${st.key}:w:${c.id}`), 'Hurt by the tornado', false, (c.settlementId || s.playerSettlement) === s.playerSettlement ? 'warn' : 'info');
    st.hit.push(c.id);
  }
  if (torn.length) destroyStructures(g, torn, { reason: null, why: 'The tornado tore it down' });
}
