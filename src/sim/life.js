// Cold and old age (Phase 5, slice 2). Both are scenario rules (`scenario.life`), on only where a scenario turns them
// on (the Vast and Living worlds), so other games run exactly as before.
// - Cold: below `cold.below` °C where a colonist is (their room, else outdoors: heat.js tempAt) they get the ongoing
//   condition "hypothermia", `cold.perHour` severity an hour per degree under it; it heals only once they are warm.
//   Health rules run in tickHealth, so full and distant villages freeze alike; a death from it is "froze to death".
// - Old age: adults' ages count game years (people.js). From `aging.elderAge` they work at `aging.elderWork`
//   speed; from `aging.deathAge` each day brings a chance of a peaceful death, `aging.perYear` a year at deathAge
//   and `aging.perYearStep` more for each year past it. The draw is a hash of (seed, colonist, day): no random
//   numbers from the game's stream. New adults of no known age are `aging.startAges` [lo, hi] years old (by id).
import { TICKS_PER_DAY } from './constants.js';
import { tempAt, climateOf } from './heat.js';

/** The scenario's life rules, or null. */
export function lifeRules(g) {
  if (g._lifeRules === undefined || g._lifeRulesFor !== g.s.scenarioId) {
    g._lifeRules = g.reg.get('scenario', g.s.scenarioId)?.life || null;
    g._lifeRulesFor = g.s.scenarioId;
  }
  return g._lifeRules;
}

const hash = (str) => { let h = 2166136261; for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

/** tickHealth: how much colder than the cold rule it is where `c` stands (°C under it), or 0. */
export function coldUnder(g, c) {
  const R = lifeRules(g)?.cold;
  if (!R) return 0;
  const t = tempAt(g, Math.round(c.x), Math.round(c.y));
  return t < R.below ? R.below - t : 0;
}

/** Age in game years of an adult with a known age, else null. */
export function ageYears(g, c) {
  if (c.ageYears === undefined || c.ageYears === null) return null;
  const yearDays = climateOf(g).yearDays || 30;
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
  return lo + (hash('age:' + id) % (hi - lo + 1));
}

/** Daily (day start): the old may die of old age. Marks them for processDeaths (death.js) with the cause. */
export function tickAging(g) {
  const A = lifeRules(g)?.aging;
  if (!A) return;
  const s = g.s, day = Math.floor(s.tick / TICKS_PER_DAY), yearDays = climateOf(g).yearDays || 30;
  for (const id of Object.keys(s.colonists).sort()) {
    const y = ageYears(g, s.colonists[id]);
    if (y === null || y < A.deathAge) continue;
    const perYear = Math.min(0.99, A.perYear + A.perYearStep * Math.floor(y - A.deathAge));
    const perDay = 1 - Math.pow(1 - perYear, 1 / yearDays);
    if (hash(`${s.seed}:old:${id}:${day}`) / 4294967296 < perDay) (g._dying ||= new Map()).set(id, 'old_age');
  }
}
