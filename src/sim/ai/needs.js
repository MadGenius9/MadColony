// Need behaviours referenced by need defs (`behavior`). Each: tick (decay), wants, urgent, makeJob.
import { tapHasWater, isWaterNode } from '../water.js';
import { TICKS_PER_DAY, MOVE_TICKS } from '../constants.js';
import { octile } from '../util.js';
import { newJob } from './jobs.js';
import { modsOf } from '../peoples.js';
import { rationOf, hoursOf, LONG_NIGHT_SEEK } from '../civlaws.js';

export const GROUND_REST_RATE = 2.4;

/** One tick of decay for a core:eat or core:drink need. While really asleep (a sleep job; not collapsed, cared
 *  for or carried to a medical bed) it decays at `sleepDecayMult` times its rate (default 1). */
export function decayNeed(c, def, g = null) {
  const mult = (c.sleeping && c.job?.type === 'sleep' ? (def.sleepDecayMult ?? 1) : 1) * (g ? (modsOf(g, c).needs[def.id] ?? 1) * (def.behavior === 'core:eat' ? rationOf(g, c) : 1) : 1); // people and traits (peoples.js); rationing (civlaws.js)
  c.needs[def.id] = Math.max(0, (c.needs[def.id] ?? 1) - (def.decayPerDay * mult) / TICKS_PER_DAY);
}

// Walking estimate for bedTooFar: ticks per tile of straight-line distance, allowing for diagonals, rough
// ground and detours (MOVE_TICKS 4 on flat ground).
const WALK_TICKS_PER_TILE = 2 * MOVE_TICKS;

/** Whether a bed at (x, y) is too far to walk to for sleep: farther than the energy need's `maxBedDistance`
 *  tiles (straight line) and either the colonist is already exhausted (below urgentBelow) or the estimated
 *  walk takes longer than its energy lasts. Without `maxBedDistance` no bed is ever too far. O(1). */
export function bedTooFar(c, def, x, y) {
  if (def.maxBedDistance === undefined) return false;
  const d = octile(c.x, c.y, x, y);
  if (d <= def.maxBedDistance) return false;
  const e = c.needs[def.id] ?? 1;
  if (e < def.urgentBelow) return true;
  const lasts = def.decayPerDay > 0 ? ((e - 0.01) * TICKS_PER_DAY) / def.decayPerDay : Infinity;
  return d * WALK_TICKS_PER_TILE > lasts;
}

/** A spot to sleep on the ground near the colonist, off any building site or stockpile. */
function groundSpot(g, c) {
  let spot = { x: c.x, y: c.y };
  if (g.footAt(c.x, c.y) || g.isStockpile(c.x, c.y)) {
    for (let r = 1; r < 8 && spot.x === c.x && spot.y === c.y; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = c.x + dx, y = c.y + dy;
        if (spot.x !== c.x || spot.y !== c.y) break;
        if (g.inB(x, y) && g.isPassable(x, y) && !g.footAt(x, y) && !g.isStockpile(x, y) && g.canReach(c, x, y, 'on')) spot = { x, y };
      }
    }
  }
  return spot;
}

export function findFood(g, c) { return g.readOnly(() => findFoodIn(g, c)); } // read-only: trade holds once (game.js)
function findFoodIn(g, c) {
  // Prefer prepared meals, then raw food that is not reserved as seed.
  const reg = g.reg;
  const reserve = g.planOf(c).seedReserve || {};
  const totals = {};
  for (const st of g.mineList('stacks', c)) if (g.mine(st, c)) totals[st.item] = (totals[st.item] || 0) + g.availQty(st.id);
  let best = null, bestScore = Infinity;
  const fav = c.people ? reg.get('people', c.people)?.food : null; // the people's favourite food (peoples.js)
  for (const st of g.mineList('stacks', c)) {
    if (!g.mine(st, c)) continue; // never eat another settlement's food
    const d = reg.get('item', st.item);
    if (!d?.nutrition) continue;
    if (g.availQty(st.id) < 1) continue;
    const isMeal = d.tags?.includes('core:meal');
    if (!isMeal && (totals[st.item] - (reserve[st.item] || 0)) < 1) continue; // seed protection
    if (!g.canReach(c, st.x, st.y, 'on')) continue;
    const score = octile(c.x, c.y, st.x, st.y) + (isMeal ? 0 : 40) - (d.spoilPerDay ? 30 : 0) - (st.item === fav ? 25 : 0); // eat what spoils first (Phase 8), then the favourite
    if (score < bestScore) { bestScore = score; best = st; }
  }
  return best;
}

export const NEED_BEHAVIORS = {
  'core:eat': {
    tick(g, c, def) {
      if (c.job?.type === 'eat' && c.job.stage === 'eat') return;
      decayNeed(c, def, g);
    },
    wants(g, c, def) { return c.needs[def.id] < def.seekBelow; },
    urgent(g, c, def) { return c.needs[def.id] < def.urgentBelow; },
    makeJob(g, c, def, quiet = false) {
      const st = findFood(g, c);
      if (!st && quiet) return null;
      if (!st) { c.status.blocker = `Hungry, but there is no reachable food`; c.status.blockerTick = g.s.tick; c.status.blockerCtx = { type: 'eat' }; g.log(`${c.name} is hungry but can't find food.`, 'warn', `nofood:${c.id}`, 1200); return null; }
      const job = newJob('eat', { stackId: st.id, stage: 'go' }, { need: def.id, why: `Need: ${def.name}`, label: `Eat ${g.reg.get('item', st.item).name}`, targetKey: null });
      if (!g.reserveQty(job, st.id, 1)) return null;
      return job;
    },
  },
  'core:sleep': {
    tick(g, c, def) {
      if (c.sleeping) return; // the sleep job restores energy
      c.needs[def.id] = Math.max(0, (c.needs[def.id] ?? 1) - (def.decayPerDay * (modsOf(g, c).needs[def.id] ?? 1)) / TICKS_PER_DAY);
    },
    wants(g, c, def) {
      const v = c.needs[def.id];
      if (v < def.seekBelow) return true;
      if (!g.isNight()) return false;
      const night = hoursOf(g, c.settlementId || g.s.playerSettlement) === 'long' ? Math.min(LONG_NIGHT_SEEK, def.nightSeekBelow ?? def.seekBelow) : (def.nightSeekBelow ?? def.seekBelow); // long hours: up later (civlaws.js)
      return v < night;
    },
    urgent(g, c, def) { return c.needs[def.id] < def.urgentBelow; },
    makeJob(g, c, def) {
      // A bed farther than `maxBedDistance` tiles is not walked to when the colonist would arrive exhausted
      // (bedTooFar): it sleeps rough nearby instead and keeps its own bed.
      const tooFar = (st) => bedTooFar(c, def, st.x, st.y);
      let far = false;
      const tryBed = (st) => {
        if (!st || !st.built) return null;
        if (tooFar(st)) { far = true; return null; }
        if (!g.canReach(c, st.x, st.y, 'on')) return null;
        const job = newJob('sleep', { bedId: st.id, x: st.x, y: st.y, stage: 'go', rate: g.bDef(st).bed.restRate }, { need: def.id, why: `Need: ${def.name}`, label: 'Sleep in bed' });
        return g.reserveExcl(job, 'bed:' + st.id, c.id) ? job : null;
      };
      let job = c.bedId ? tryBed(g.s.structures[c.bedId]) : null;
      if (!job) {
        // Free beds of the settlement in list order; tryBed skips one too far (straight line) before any path check.
        for (const st of g.mineList('structures', c)) {
          if (!st.built || !g.bDef(st)?.bed || (st.owner && g.s.colonists[st.owner]) || !g.mine(st, c)) continue;
          if (g.isReserved('bed:' + st.id, c.id)) continue;
          job = tryBed(st);
          if (job) break;
        }
      }
      if (!job) {
        const spot = groundSpot(g, c);
        job = far
          ? newJob('sleep', { bedId: null, x: spot.x, y: spot.y, stage: 'go', rate: GROUND_REST_RATE, rough: true }, { need: def.id, why: `Need: ${def.name} (bed too far to reach)`, label: 'Sleep rough (bed too far)' })
          : newJob('sleep', { bedId: null, x: spot.x, y: spot.y, stage: 'go', rate: GROUND_REST_RATE }, { need: def.id, why: `Need: ${def.name}`, label: 'Sleep on the ground' });
      }
      return job;
    },
  },
  'core:drink': {
    tick(g, c, def) { decayNeed(c, def, g); },
    wants(g, c, def) { return (c.needs[def.id] ?? 1) < def.seekBelow; },
    urgent(g, c, def) { return (c.needs[def.id] ?? 1) < def.urgentBelow; },
    makeJob(g, c, def, quiet = false) {
      const src = findWater(g, c);
      if (!src && quiet) return null;
      if (!src) {
        c.status.blocker = 'Thirsty, but there is no reachable water'; c.status.blockerTick = g.s.tick; c.status.blockerCtx = { type: 'drink' };
        g.log(`${c.name} is thirsty but can't reach any water.`, 'warn', `nowater:${c.id}`, 1200);
        return null;
      }
      return newJob('drink', { x: src.x, y: src.y, wellId: src.wellId || null, tapId: src.tapId || null, clean: src.clean, stage: 'go' },
        { need: def.id, why: `Need: ${def.name}`, label: src.wellId ? 'Drink at the well' : 'Drink from the lake' });
    },
  },
  'core:shelter': {
    tick(g, c, def) {
      const home = c.homeId && g.s.homes[c.homeId];
      const v = c.needs[def.id] ?? 0.5;
      if (home?.complete) c.needs[def.id] = Math.min(1, v + (2 * def.decayPerDay) / TICKS_PER_DAY);
      else c.needs[def.id] = Math.max(0, v - def.decayPerDay / TICKS_PER_DAY);
    },
    wants() { return false; },
    urgent() { return false; },
    makeJob() { return null; },
  },
};

/** Nearest place to drink: a well of our own (clean) or a lake shore (untreated). Wells win ties of up to
 *  8 tiles, since their water is safe. Returns { x, y, wellId?, clean } or null. */
export function findWater(g, c) {
  const cands = [];
  for (const st of g.mineList('structures', c)) {
    if (!st.built || !g.bDef(st)?.water || !g.mine(st, c)) continue;
    const def = g.bDef(st), ix = def.interaction || [0, 1];
    if (def.water.tap) { if (!tapHasWater(g, st)) continue; }
    else if (isWaterNode(def)) continue; // pumps, towers and pipes are not drinking points
    const x = st.x + ix[0], y = st.y + ix[1];
    cands.push({ x, y, wellId: def.water.tap ? null : st.id, tapId: def.water.tap ? st.id : null, clean: def.water.clean !== false, d: octile(c.x, c.y, x, y) - (def.water.tap ? 12 : 8) });
  }
  // Big worlds: the shore nearest on foot (walking distance over terrain, path.js), not in a straight line,
  // which behind a ridge can be a day's walk; also avoids sorting thousands of shore tiles per drink.
  const sh = g.big ? g.shoreOnFoot(c.x, c.y) : null;
  if (sh) cands.push({ x: sh.x, y: sh.y, clean: false, d: sh.walk });
  else for (const s of g.drinkSpots()) cands.push({ x: s.x, y: s.y, clean: false, d: octile(c.x, c.y, s.x, s.y) });
  cands.sort((a, b) => a.d - b.d);
  for (const k of cands.slice(0, 12)) if (g.canReach(c, k.x, k.y, 'on')) return k;
  return null;
}
