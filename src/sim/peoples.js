// Peoples and traits (docs/proposals/phase-peoples-and-traits.md). Every colonist has a `people` (content type
// `people`) and up to two `traits` (type `trait`); every settlement has one `people` (villages keep to one).
// - Assignment is by hash of the seed and the colonist's id, never g.rng, so adding it moves no existing draw,
//   and an old save given traits on load (migrate.js) gets the same ones a new game would.
// - modsOf(g, c) gives a colonist's combined effects (people and traits) for the hot paths (work speed, need
//   decay, health, combat). It is a derived cache keyed by the colonist object and checked against its
//   people and traits array, so code that changes traits must give the colonist a NEW array.
// - Worlds whose content has no peoples (a mod without them) leave the fields off; every effect is then 1.

export const MAX_TRAITS = 2;

function rand(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const sorted = new WeakMap(); // reg -> { peoples, traits } sorted by id (the draws do not depend on load order)
function lists(reg) {
  let L = sorted.get(reg);
  if (!L) {
    const peoples = [...reg.all('people')].sort(byId), traits = [...reg.all('trait')].sort(byId);
    L = { peoples, traits, def: (peoples.find((p) => p.default) || peoples[0])?.id ?? null };
    sorted.set(reg, L);
  }
  return L;
}

/** The people of classic colonists and old saves (null when the content has no peoples). */
export function defaultPeople(g) { return lists(g.reg).def; }

/** A people id that exists in this game's content, else the default. */
export function knownPeople(g, id) { return id && g.reg.get('people', id) ? id : defaultPeople(g); }

/** A settlement's people (its own, else the default). */
export function peopleOfSettlement(g, sid) { return knownPeople(g, g.s.settlements[sid]?.people); }

/** Do traits a and b clash (the same, or opposites)? */
function clash(reg, a, b) {
  if (a === b) return true;
  return reg.get('trait', a)?.opposite === b || reg.get('trait', b)?.opposite === a;
}

/** Add trait t to list (a new array) unless it clashes or the list is full. */
export function withTrait(reg, list, t) {
  if (list.length >= MAX_TRAITS || list.some((x) => clash(reg, x, t))) return list;
  return [...list, t];
}

/** Draw a trait by weight from those that fit `have` (r: a hash stream). */
function drawOne(reg, have, r) {
  const fit = lists(reg).traits.filter((t) => t.weight > 0 && !have.some((x) => clash(reg, x, t.id)));
  const total = fit.reduce((a, t) => a + t.weight, 0);
  if (!(total > 0)) return null;
  let v = r() * total;
  for (const t of fit) { v -= t.weight; if (v < 0) return t.id; }
  return fit[fit.length - 1].id;
}

/** The traits of a new person of `people` (no parents): how many by the people's traitOdds, each by weight. */
export function drawTraits(g, key, people) {
  const reg = g.reg, r = rand(`${key}:traits`);
  const odds = reg.get('people', people)?.traitOdds || [40, 45, 15];
  const sum = odds[0] + odds[1] + odds[2];
  const v = r() * (sum || 1);
  const n = v < odds[0] ? 0 : v < odds[0] + odds[1] ? 1 : 2;
  let out = [];
  for (let i = 0; i < n; i++) { const t = drawOne(reg, out, r); if (t) out = withTrait(reg, out, t); }
  return out;
}

/** A newborn's traits: each parent trait passes on at its `inherit` chance (one hash per trait, so the draws of
 *  one trait do not depend on the others), then a small chance of a new one. */
export function inheritTraits(g, key, parents, people) {
  const reg = g.reg;
  let out = [];
  const from = [];
  for (const p of parents) for (const t of p?.traits || []) if (reg.get('trait', t) && !from.includes(t)) from.push(t);
  from.sort();
  for (const t of from) if (rand(`${key}:inherit:${t}`)() < (reg.get('trait', t).inherit ?? 0.4)) out = withTrait(reg, out, t);
  const r = rand(`${key}:newtrait`);
  if (r() < NEW_TRAIT) { const t = drawOne(reg, out, r); if (t) out = withTrait(reg, out, t); }
  return out;
}
export const NEW_TRAIT = 0.08;

/** Give a new colonist record its people and traits (no-op when the content has no peoples). */
export function settleFolk(g, c, people) {
  const p = knownPeople(g, people);
  if (!p) return c;
  c.people = p;
  c.traits = drawTraits(g, `${g.s.seed}:${c.id}`, p);
  return c;
}

const ONE = Object.freeze({ work: 1, workBy: Object.freeze({}), walk: 1, learn: 1, tend: 1, needs: Object.freeze({}), illnessChance: 1, illnessStrength: 1, heal: 1, cold: 0, fightHp: null, wolfHp: null, flee: null, party: null, trade: 0 });
const cache = new WeakMap(); // colonist -> { p, t, reg, m }

/** A colonist's combined effects (see the trait type's doc). Multipliers multiply, cold and trade add; the
 *  thresholds (fightHp, wolfHp, flee) and party come from the traits (the last listed wins; at most two). */
export function modsOf(g, c) {
  if (!c || (!c.people && !c.traits?.length)) return ONE;
  const e = cache.get(c);
  if (e && e.p === c.people && e.t === c.traits && e.reg === g.reg) return e.m;
  const m = { work: 1, workBy: {}, walk: 1, learn: 1, tend: 1, needs: {}, illnessChance: 1, illnessStrength: 1, heal: 1, cold: 0, fightHp: null, wolfHp: null, flee: null, party: null, trade: 0 };
  const P = c.people && g.reg.get('people', c.people);
  if (P) {
    for (const [k, v] of Object.entries(P.work || {})) m.workBy[k] = (m.workBy[k] ?? 1) * v;
    for (const [k, v] of Object.entries(P.needs || {})) m.needs[k] = (m.needs[k] ?? 1) * v;
    m.walk *= P.walk ?? 1;
    m.cold += P.cold ?? 0;
  }
  for (const t of c.traits || []) {
    const x = g.reg.get('trait', t)?.effects;
    if (!x) continue;
    for (const k of ['work', 'walk', 'learn', 'tend', 'illnessChance', 'illnessStrength', 'heal']) if (x[k] !== undefined) m[k] *= x[k];
    for (const [k, v] of Object.entries(x.workBy || {})) m.workBy[k] = (m.workBy[k] ?? 1) * v;
    for (const [k, v] of Object.entries(x.needs || {})) m.needs[k] = (m.needs[k] ?? 1) * v;
    m.cold += x.cold ?? 0;
    m.trade += x.trade ?? 0;
    for (const k of ['fightHp', 'wolfHp', 'flee', 'party']) if (x[k] !== undefined) m[k] = x[k];
  }
  cache.set(c, { p: c.people, t: c.traits, reg: g.reg, m });
  return m;
}

/** Living colonists counted by people (null key: no people). */
export function countByPeople(g) {
  const out = {};
  for (const c of Object.values(g.s.colonists)) { const k = c.people ?? 'none'; out[k] = (out[k] || 0) + 1; }
  return out;
}
