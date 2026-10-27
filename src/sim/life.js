// Cold and old age (Phase 5, slice 2). Both are scenario rules (`scenario.life`), on only where a scenario turns them
// on (the Vast and Living worlds), so other games run exactly as before.
// - Cold: below `cold.below` °C where a colonist is they get the ongoing condition "hypothermia", `cold.perHour`
//   severity an hour per degree under it; it heals only once they are warm. In a room it is the room's temperature
//   plus `cold.shelter` (walls, bedding); outdoors only the exposed feel it: people asleep or collapsed, and the
//   homeless. People up and about outdoors keep warm. Anyone exposed near a fire gets the shelter too. In a village simulated at a distance (its people stand round
//   the centre, lod.js) a finished home counts as shelter and only the homeless feel the outdoor cold. The homeless
//   near a fire (`cold.fires`, built, within `cold.fireRadius`; in a distant village: any of its fires) get the
//   shelter too. Founding waits while the coming `cold.foundWaitDays` days fall below the cold line (founding.js).
//   Health rules run in tickHealth, so full and distant villages freeze alike; a death from it is "froze to death".
// - Old age: adults' ages count game years (people.js). From `aging.elderAge` they work at `aging.elderWork`
//   speed; from `aging.deathAge` each day brings a chance of a peaceful death, `aging.perYear` a year at deathAge
//   and `aging.perYearStep` more for each year past it. The draw is a hash of (seed, colonist, day): no random
//   numbers from the game's stream. New adults of no known age are `aging.startAges` [lo, hi] years old (by id).
import { TICKS_PER_DAY } from './constants.js';
import { tempAt, roomAt, outdoorTemp, climateOf, coldestAhead } from './heat.js';

/** The scenario's life rules, or null. */
export function lifeRules(g) {
  if (g._lifeRules === undefined || g._lifeRulesFor !== g.s.scenarioId) {
    g._lifeRules = g.reg.get('scenario', g.s.scenarioId)?.life || null;
    g._lifeRulesFor = g.s.scenarioId;
  }
  return g._lifeRules;
}

// FNV-1a, then a 32-bit finaliser (MurmurHash3 fmix32): without it, keys that differ only in the last digit (the day)
// give almost the same value, so daily draws would hardly change from one day to the next.
const hash = (str) => {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};

/** tickHealth: how much colder than the cold rule it is where `c` stands (°C under it), or 0. */
export function coldUnder(g, c) {
  const R = lifeRules(g)?.cold;
  if (!R) return 0;
  // Not freezing outdoors: nobody is cold (rooms drift toward the outdoors, so they are warmer or close to it).
  // The outdoor temperature once per tick (derived).
  if (g._outT?.tick !== g.s.tick) g._outT = { tick: g.s.tick, t: outdoorTemp(g) };
  if (g._outT.t >= R.below) return 0;
  const s = g.s, home = c.homeId ? s.homes[c.homeId] : null;
  let t;
  const sid = c.settlementId || s.playerSettlement, abstract = s.settlements?.[sid]?.detail === 'abstract';
  const x = Math.round(c.x), y = Math.round(c.y);
  if (abstract) {
    if (home?.complete) return 0;
    t = g._outT.t;
    if (t < R.below && byFire(g, sid, R, null)) t += R.shelter ?? 0;
  } else if (roomAt(g, x, y)) t = tempAt(g, x, y) + (R.shelter ?? 0);
  else if (home && !c.sleeping && !c.health?.down) return 0; // up and about: they keep warm
  else {
    t = g._outT.t;
    if (t < R.below && byFire(g, sid, R, { x, y })) t += R.shelter ?? 0; // anyone exposed by a fire is sheltered
  }
  return t < R.below ? R.below - t : 0;
}

/** Is there a built fire of `sid` (cold.fires) within cold.fireRadius of `at` (any, when at is null)? O(its buildings). */
function byFire(g, sid, R, at) {
  const fires = R.fires;
  if (!fires?.length) return false;
  const r = R.fireRadius ?? 5;
  for (const b of g.owned('structures', sid)) {
    if (!b.built || !fires.includes(b.def)) continue;
    if (!at || Math.max(Math.abs(b.x - at.x), Math.abs(b.y - at.y)) <= r) return true;
  }
  return false;
}

/** founding.js canFound: why settlers wait for warmer weather, or null. */
export function coldWait(g) {
  const R = lifeRules(g)?.cold;
  if (!R?.foundWaitDays) return null;
  return coldestAhead(g, R.foundWaitDays) < R.below ? `the coming days are freezing; settlers wait for warmer weather` : null;
}

/** Age in game years of an adult with a known age, else null. */
const yearDaysOf = (g) => (g._yearDays ??= climateOf(g).yearDays || 30); // derived, per game (the world's climate)

export function ageYears(g, c) {
  if (c.ageYears === undefined || c.ageYears === null) return null;
  const yearDays = yearDaysOf(g);
  return c.ageYears + Math.max(0, g.s.tick - (c.ageTick ?? g.s.tick)) / (yearDays * TICKS_PER_DAY);
}

/** Work speed of the old (jobs.js workSpeed). O(1); 1 without aging rules. */
export function elderFactor(g, c) {
  const A = lifeRules(g)?.aging;
  if (!A) return 1;
  const y = ageYears(g, c);
  return y !== null && y >= A.elderAge ? A.elderWork : 1;
}

/** people.js ensureAdult: the age of a new adult of unknown age, by id, or null (then the old rule applies). */
export function startAge(g, id) {
  const A = lifeRules(g)?.aging;
  if (!A?.startAges) return null;
  const [lo, hi] = A.startAges;
  return lo + (hash(`${g.s.seed}:age:${id}`) % (hi - lo + 1));
}

/** Daily (day start): the old may die of old age. Marks them for processDeaths (death.js) with the cause. */
export function tickAging(g) {
  const A = lifeRules(g)?.aging;
  if (!A) return;
  const s = g.s, day = Math.floor(s.tick / TICKS_PER_DAY), yearDays = yearDaysOf(g);
  for (const id of Object.keys(s.colonists).sort()) {
    const y = ageYears(g, s.colonists[id]);
    if (y === null || y < A.deathAge) continue;
    const perYear = Math.min(0.99, A.perYear + A.perYearStep * Math.floor(y - A.deathAge));
    const perDay = 1 - Math.pow(1 - perYear, 1 / yearDays);
    if (hash(`${s.seed}:old:${id}:${day}`) / 4294967296 < perDay && !g._dying?.has(id)) (g._dying ||= new Map()).set(id, 'old_age');
  }
}
