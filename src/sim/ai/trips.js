// Trip budgets on big worlds: how far a colonist walks for work, judged by the walk over terrain (not the
// straight line) from its village centre, and whether its food, water and rest last the trip.
//
// Data (opt-in): the scenario's or the AI profile's `travel` (the scenario's wins; keys left out take
// TRAVEL_DEFAULTS). Without it there are no trip limits (core: only the vast world sets it):
//   maxWalk      nodes farther than this many tiles' walk from the centre, or so far that even a fed,
//                watered and rested colonist could not walk there and back with one chunk's work before a
//                need turns urgent (reachTest), are not gathered, and the planner counts them as out of
//                reach (so quarrying, trade or markets take over); stacks out of reach are not counted as
//                available by the planner
//   checkBeyond  work whose far end is within this walk of the centre is never checked (the village itself)
//   farFromHome  beyond this walk from the centre a working colonist goes to eat as soon as it is hungry
//                (the need's seekBelow), not only when hunger is urgent, and an idle one walks home
//   walkTicks    ticks per tile of walk in the estimates (default MOVE_TICKS x 1.15 for paths round obstacles)
//   workTicks    ticks allowed for the work out there in a trip budget, when the task does not say (tripCheck)
// The colonist side (ai.js): a work task whose trip does not fit is skipped, with the reason as the idle
// reason; food or water is topped up first when that would make it fit; a far node that fits only one chunk
// is worked for one chunk. Classic worlds (!g.big) and games without `travel` are untouched: every function
// here answers "no limit".
//
// Costs: the walk field is one bounded Dijkstra over the (2R+1)^2 tiles round a village centre
// (R = maxWalk + 8, about 66,000 tiles), built on first use per full-detail village and map revision, derived
// and never saved (at most FIELD_CACHE kept). Lookups are O(1); a trip check is O(needs). Abstract villages
// never call these (the planner skips them for abstract villages; they have no colonists walking about).
import { MOVE_TICKS, TICKS_PER_DAY, CHUNK } from '../constants.js';
import { localDistanceField } from '../path.js';
import { octile } from '../util.js';

// Gathering work out there is allowed for at this multiple of the node's work per chunk (a slow or tired
// worker's pace), in trip budgets and in reachTest.
export const SLOW_WORK = 1.6;
export const TRAVEL_DEFAULTS = Object.freeze({ maxWalk: 120, checkBeyond: 30, farFromHome: 30, walkTicks: MOVE_TICKS * 1.15, workTicks: 150 });
const FIELD_PAD = 8;
const TOP_UP_BELOW = 0.9; // a need is topped up before a long walk only from below this
const FIELD_CACHE = 64; // walk fields kept at once, least recently used dropped first (about 260 KB each at maxWalk 120)
const MAX_FIELD_R = 408; // the walk field's radius is never more than this (maxWalk is at most 400 in the data)
// reachTest (the planner's "can this be gathered at all?") budgets from needs at this level, not full: a
// colonist setting out is rarely quite full, so the planner turns to quarrying or trade a little early.
const REACH_FROM = 0.9;

/** The travel rules for this game: null (no trip limits) on classic worlds and unless the scenario or the AI
 *  profile defines `travel` (opt-in; the scenario's wins); else its values over TRAVEL_DEFAULTS. */
export function travelRules(g) {
  if (!g.big) return null;
  const t = g.reg.get('scenario', g.s.scenarioId)?.travel ?? g.prof?.travel ?? null;
  if (g._travel && g._travel.src === t) return g._travel.r;
  const r = t ? { ...TRAVEL_DEFAULTS, ...t } : null;
  g._travel = { src: t, r };
  return r;
}

const centreOf = (g, sid) => g.s.settlements?.[sid]?.center || null;

/** The walk field round a village centre (derived cache, per settlement, centre and map revision). */
function homeField(g, sid, T) {
  const ctr = centreOf(g, sid);
  if (!ctr) return null;
  const R = Math.min(MAX_FIELD_R, Math.ceil(T.maxWalk) + FIELD_PAD), rev = g.s.map.rev || 0;
  const cache = (g._homeWalk ||= new Map());
  const e = cache.get(sid);
  if (e && e.rev === rev && e.cx === ctr.x && e.cy === ctr.y && e.R === R) {
    if (cache.size > 1) { cache.delete(sid); cache.set(sid, e); } // most recently used last
    return e.F;
  }
  const F = localDistanceField(g, ctr.x, ctr.y, R, R);
  cache.delete(sid);
  cache.set(sid, { rev, cx: ctr.x, cy: ctr.y, R, F });
  if (cache.size > FIELD_CACHE) cache.delete(cache.keys().next().value); // memory bound; the fields are pure functions of the terrain
  return F;
}

const fieldAt = (F, x, y) => {
  const lx = x - F.x0, ly = y - F.y0;
  return lx < 0 || ly < 0 || lx >= F.w || ly >= F.h ? Infinity : F.dist[ly * F.w + lx];
};

/** Tiles' walk over terrain from village `sid`'s centre to (x, y): Infinity beyond maxWalk + 8 or where the
 *  terrain cannot be walked; null on classic worlds or when the village has no walk field. O(1) after the
 *  field is built. */
export function walkFromHome(g, sid, x, y) {
  const T = travelRules(g);
  if (!T) return null;
  const F = homeField(g, sid, T);
  return F ? fieldAt(F, x, y) : null;
}

/** A test for the village's reach for work, for many points at once: (x, y, work?) => true when (x, y) is at
 *  most maxWalk tiles' walk from the centre and a round trip from home there, with `work` ticks of work
 *  (default workTicks), that a rested, fed and watered colonist can make (tripCheck from home with every
 *  need at REACH_FROM). null when there is no limit (no travel rules, or no walk field). Each test is O(needs). */
export function reachTest(g, sid) {
  const T = travelRules(g);
  if (!T) return null;
  const F = homeField(g, sid, T);
  if (!F) return null;
  const ww = g.waterWalk().dist, W = g.W;
  const checks = [];
  for (const def of g.reg.all('need')) {
    if (def.behavior === 'core:eat' || def.behavior === 'core:sleep') checks.push({ water: false, max: lastsFrom(def, REACH_FROM) });
    else if (def.behavior === 'core:drink') checks.push({ water: true, max: lastsFrom(def, REACH_FROM) });
  }
  return (x, y, work = T.workTicks) => {
    const w = fieldAt(F, x, y);
    if (!(w <= T.maxWalk)) return false;
    if (w <= T.checkBeyond) return true;
    for (const k of checks) {
      let back = w;
      if (k.water) { const v = ww[y * W + x]; if (v < w) back = v; }
      if ((w + back) * T.walkTicks + work > k.max) return false;
    }
    return true;
  };
}

/** Is (x, y) within the village's reach for work (reachTest)? Always true on classic worlds. */
export function withinReach(g, sid, x, y) {
  const t = reachTest(g, sid);
  return !t || t(x, y);
}

/** Big worlds: the nodes of the given kinds (a Set of def ids) within maxWalk tiles' walk of the village
 *  centre, in g.nodesNear's order (chunk rows top to bottom, columns left to right, then index order).
 *  Chunks that cannot hold such a node (farther than maxWalk in a straight line) are skipped. null when
 *  there is no walk field (the caller keeps the old chunk box). Cost: the nodes in those chunks. */
export function nodesInReach(g, sid, defs) {
  const T = travelRules(g);
  const F = T && homeField(g, sid, T);
  const ctr = centreOf(g, sid);
  if (!F || !ctr) return null;
  const r = Math.ceil(T.maxWalk), out = [];
  const x0 = Math.max(0, Math.floor((ctr.x - r) / CHUNK)), x1 = Math.min(g.CW - 1, Math.floor((ctr.x + r) / CHUNK));
  const y0 = Math.max(0, Math.floor((ctr.y - r) / CHUNK)), y1 = Math.min(g.CH - 1, Math.floor((ctr.y + r) / CHUNK));
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    const m = g.cNodes[cy * g.CW + cx];
    if (!m) continue;
    // nearest point of the chunk to the centre, in a straight line (a walk is never shorter)
    const nx = Math.max(cx * CHUNK, Math.min(ctr.x, cx * CHUNK + CHUNK - 1)), ny = Math.max(cy * CHUNK, Math.min(ctr.y, cy * CHUNK + CHUNK - 1));
    if (octile(ctr.x, ctr.y, nx, ny) > T.maxWalk) continue;
    for (const [def, a] of m) if (!defs || defs.has(def)) for (const n of a) if (fieldAt(F, n.x, n.y) <= T.maxWalk) out.push(n);
  }
  return out;
}

const sidOf = (g, c) => c.settlementId || g.s.playerSettlement;

/** Is the colonist farther than farFromHome's walk from its village centre (big worlds only)? */
export function farFromHome(g, c) {
  const w = walkFromHome(g, sidOf(g, c), c.x, c.y);
  return w !== null && w > travelRules(g).farFromHome;
}

/** Walk estimate from the colonist to (x, y), given the walk from home to there (wt) and to the colonist (wc):
 *  never less than the straight line, nor than the difference of the two walks from home. */
function walkTo(c, x, y, wt, wc) {
  const o = octile(c.x, c.y, x, y);
  return Number.isFinite(wc) ? Math.max(o, Math.abs(wt - wc)) : o;
}

/** Ticks until need `def` falls from v to its urgentBelow (0 if already below): a trip must bring the colonist
 *  back to where the need is met before then (it heads back sooner: farFromHome, and it is not sent out
 *  once the need is below seekBelow, as decide() sees to wanted needs first). */
function lastsFrom(def, v) {
  return def.decayPerDay > 0 ? Math.max(0, ((v - def.urgentBelow) * TICKS_PER_DAY) / def.decayPerDay) : Infinity;
}
/** Ticks until the colonist's need `def` falls to its urgentBelow, from its value now or from `from`. */
const lasts = (c, def, from) => lastsFrom(def, from ?? c.needs[def.id] ?? 1);

/**
 * Trip budget for a work task whose farthest point is (x, y). Returns null near home (the far end within
 * checkBeyond's walk of the centre: nothing is checked), else { d, why }: d is the walk estimate from the
 * colonist to there (for scoring, instead of the straight line) and why a reason to skip the task, or null
 * if it may be taken. A task is skipped when, for one of the colonist's needs, the walk there and on to
 * where that need is met (home for food and sleep, the nearest drinking water for water), plus the work
 * itself, takes longer than the need lasts before it becomes urgent (its urgentBelow),
 * unless the task is hardly later than going there straight away (on the way: the walk round and the work
 * within checkBeyond's walk). `extra` is more walking the task needs (other fetching trips), `work` the
 * ticks of work out there (default the travel rules' workTicks; none for the on-the-way test). Tasks beyond
 * the walk field (maxWalk + 8) are always skipped. topUp lists the food and water needs to see to first
 * when that would make the trip fit (null if it would not). O(1).
 */
export function tripCheck(g, c, x, y, extra = 0, work = undefined) {
  const t = tripChecker(g, c);
  return t ? t.at(x, y, extra, work, false) : null;
}

/**
 * The trip budget of one colonist, worked out once for many tasks (ai.js tryWork): null on classic worlds or
 * without a walk field, else { at(x, y, extra, work, carry), cand(far) }. at is tripCheck (carry: goods are
 * carried home from there, so water on the way does not count). cand takes a tryWork candidate's far
 * { x, y, extra?, work?, unit?, limit?, carry? }: a task of several units of work out there (gathering
 * chunks) that does not fit is tried again with one unit, and if that fits, far.limit(1) makes the job do only
 * that much. Each check is O(needs).
 */
export function tripChecker(g, c) {
  const T = travelRules(g);
  if (!T) return null;
  const sid = sidOf(g, c);
  const F = homeField(g, sid, T);
  if (!F) return null;
  const wc = fieldAt(F, c.x, c.y);
  const ww = g.waterWalk().dist, wwC = ww[g.i(c.x, c.y)];
  const needs = [];
  for (const def of g.reg.all('need')) {
    const water = def.behavior === 'core:drink';
    if (!water && def.behavior !== 'core:eat' && def.behavior !== 'core:sleep') continue;
    needs.push({ def, water, now: lasts(c, def), full: lasts(c, def, 1), low: (c.needs[def.id] ?? 1) < TOP_UP_BELOW, direct: water ? Math.min(wwC, wc) : wc });
  }
  const slack = T.checkBeyond * T.walkTicks;
  const at = (x, y, extra, work, carry) => {
    const wt = fieldAt(F, x, y);
    if (wt <= T.checkBeyond) return null;
    if (!Number.isFinite(wt)) return { d: octile(c.x, c.y, x, y), why: 'too far from home to walk to', topUp: null };
    const there = walkTo(c, x, y, wt, wc);
    const wk = work ?? T.workTicks;
    let why = null, topUp = [];
    for (const n of needs) {
      let back = wt;
      if (n.water && !carry) { const w = ww[y * g.W + x]; if (w < wt) back = w; } // carrying goods home: no stop for a drink
      const need = (there + back + extra) * T.walkTicks + wk;
      if (need <= n.now) continue;
      // On the way anyway: hardly later than going straight back (the walk round and the work within the slack).
      if (Number.isFinite(n.direct) && (there + back + extra - n.direct) * T.walkTicks + (work ?? 0) <= slack) continue;
      why ||= `${n.def.name.toLowerCase()} would not last the walk there and back to ${n.water ? 'water' : 'home'}`;
      // Food and water can be topped up before setting out, if a full need would last the trip.
      if (topUp && n.def.behavior !== 'core:sleep' && n.low && need <= n.full) topUp.push(n.def);
      else topUp = null;
    }
    return { d: there, why, topUp: why && topUp?.length ? topUp : null };
  };
  const cand = (far) => {
    const t = at(far.x, far.y, far.extra || 0, far.work, !!far.carry);
    if (!t?.why || !far.unit || !far.limit || !(far.work > far.unit)) return t;
    const one = at(far.x, far.y, far.extra || 0, far.unit, !!far.carry);
    if (one.why) return t;
    far.limit(1);
    return one;
  };
  return { at, cand };
}

/** Sleeping out (big worlds): does the sleeper's energy last the walk home to food (the walk field's estimate,
 *  or the straight line beyond it)? Always true on classic worlds and near home (within farFromHome). O(1). */
export function energyLastsWalkHome(g, c, energy) {
  const T = travelRules(g);
  if (!T) return true;
  const sid = sidOf(g, c);
  let w = walkFromHome(g, sid, c.x, c.y);
  if (w === null || w <= T.farFromHome) return true;
  if (!Number.isFinite(w)) { const ctr = centreOf(g, sid); w = ctr ? octile(c.x, c.y, ctr.x, ctr.y) * 1.5 : 0; }
  const e = c.needs[energy.id] ?? 1;
  const left = energy.decayPerDay > 0 ? ((e - 0.01) * TICKS_PER_DAY) / energy.decayPerDay : Infinity;
  return w * T.walkTicks <= left;
}
