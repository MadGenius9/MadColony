// Contagious illness (Phase 5, slice 3). Illnesses are data (content type `illness`); outbreaks and spread are a
// scenario rule (`scenario.illness`), on only where a scenario turns it on (the Vast and Living worlds).
// - A sick colonist has an injury of kind "sickness" ({ illness, until }) whose severity grows by the illness's
//   growPerHour until `until` (its course, `days`), then it heals like any injury and the colonist is immune for
//   immunityDays. A doctor's medicine (the existing treat job: medical.js treatmentNeeds) slows the growth to
//   treatedGrowth; care (tending, a bed) slows it to CARE_GROWTH; each case is 0.75-1.25 as strong (hardiness).
//   Deadly only through severity: at 0% health death.js applies. Grey fever kills some of the untended.
// - Daily (day start), per village in id order: an outbreak may start when nobody there is ill
//   (outbreakPerDay, more when people outnumber beds: crowding), not before graceDays; the illness is picked by
//   weight. Then each contagious colonist may pass it on to each susceptible one of the same village (contagion;
//   villageShare of that for people who do not share their home).
// - Between villages along real contacts (spreadContact): a hand delivery (the carrier meets the buyers), a
//   caravan arriving, traders visiting; each side may pass it to the other with the illness's `travel` chance (times
//   the share of contagious people for villages). Founders carry their illness with them.
// Draws are hashes of (seed, ids, day or tick): no random numbers from the game's stream. Rules run on real
// colonist records, so distant villages fall ill and spread illness like full ones (no doctors walk there, so no
// treatment). Everything is saved on the colonists (save format 17).
// - Plague (Phase 5b, the plague power): an illness marked `plague` in data also spreads where the scenario has no
//   illness rules, while anyone has it: s.disasters.plague.until (the end of the last case's course) says so in
//   O(1); the spread then uses PLAGUE_SPREAD (no outbreaks).
import { TICKS_PER_DAY } from './constants.js';
import { cared } from './health.js';
import { lawIs } from './worldlaws.js';
import { modsOf } from './peoples.js';

const CARE_GROWTH = 0.8; // an illness grows this much slower while the sick are cared for
const PLAGUE_SPREAD = Object.freeze({ outbreakPerDay: 0, villageShare: 0.3, kinds: [] });

/** Is a plague running its course somewhere (the plague power)? O(1). */
export const plagueActive = (g) => (g.s.disasters?.plague?.until ?? -1) > g.s.tick;
/** The rules spread works by: the Endless plague law's, else the scenario's, else the plague's while one runs,
 *  else null. */
const spreadRules = (g) => (lawIs(g, 'core:plague', 'endless') ? endlessRules(g) : null) || illnessRules(g) || (plagueActive(g) ? PLAGUE_SPREAD : null);
/** The Endless plague law (worldlaws.js): a plague illness breaks out in each village about every 10 days. */
export const ENDLESS_PLAGUE = Object.freeze({ outbreakPerDay: 0.1, villageShare: 0.3, spare: 3 });
/** The most a plague case grows to in a spared village (health stays at 40% or more from it). */
const SPARED_MAX = 60;
function endlessRules(g) {
  const kinds = g.reg.all('illness').filter((d) => d.plague).map((d) => ({ illness: d.id, weight: 1 })).sort((a, b) => (a.illness < b.illness ? -1 : 1));
  return kinds.length ? { ...ENDLESS_PLAGUE, kinds } : null;
}
/** Standing (not collapsed) people among `people`. */
const standingOf = (people) => people.reduce((n, p) => n + (p.health?.down ? 0 : 1), 0);

/** The scenario's illness rules, or null. */
export function illnessRules(g) {
  if (g._illRules === undefined || g._illRulesFor !== g.s.scenarioId) {
    g._illRules = g.reg.get('scenario', g.s.scenarioId)?.illness || null;
    g._illRulesFor = g.s.scenarioId;
  }
  return g._illRules;
}

const hash = (str) => {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};
const draw = (key) => hash(key) / 4294967296;
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The illness a colonist has now (still in its course), as its injury entry, or null. */
export function sicknessOf(c) {
  for (const i of c.health?.injuries || []) if (i.kind === 'sickness' && !i.over) return i;
  return null;
}
/** Can pass it on: ill and still in the course. */
export const contagious = (g, c) => { const i = sicknessOf(c); return !!i && g.s.tick < i.until; };
/** Could catch `ill` now: not ill already and not immune to it. */
export const susceptible = (g, c, ill) => !sicknessOf(c) && !((c.immune?.[ill.id] ?? -1) > g.s.tick);

/** `c` falls ill with `ill` (how: the words for the log). Returns the injury, or null when they cannot catch it. */
export function infect(g, c, ill, how) {
  if (!ill || !susceptible(g, c, ill) || lawIs(g, 'core:plague', 'none')) return null; // the Plague law "none": nobody falls ill
  const s = g.s;
  c.health ||= { injuries: [] };
  const inj = { id: g.newId('inj'), kind: 'sickness', illness: ill.id, severity: 1, cause: ill.name, tick: s.tick, until: s.tick + Math.round(ill.days * TICKS_PER_DAY) };
  c.health.injuries.push(inj);
  if (ill.plague) { s.disasters ||= { fires: {}, scorched: {} }; const P = (s.disasters.plague ||= { until: 0 }); P.until = Math.max(P.until, inj.until); }
  s.stats.illness ||= { cases: 0, outbreaks: 0 };
  s.stats.illness.cases++;
  const village = s.settlements?.[c.settlementId]?.name;
  const mine = (c.settlementId || s.playerSettlement) === s.playerSettlement;
  g.log(`${c.name}${village ? ` of ${village}` : ''} fell ill with ${ill.name.toLowerCase()} (${how}).`, mine ? 'warn' : 'info'); // others' cases are routine
  return inj;
}

/** tickHealth, each step: the course of an illness. Grows until it is over; then immunity. */
export function tickSickness(g, c, frac) {
  for (const i of c.health?.injuries || []) {
    if (i.kind !== 'sickness' || i.over) continue;
    const ill = g.reg.get('illness', i.illness);
    if (!ill || g.s.tick >= i.until) {
      i.over = true;
      if (ill) (c.immune ||= {})[ill.id] = g.s.tick + Math.round(ill.immunityDays * TICKS_PER_DAY);
      continue;
    }
    // Each case has its own strength (0.75-1.25 by hash: some are hardier), and care (tending, a bed, a medical bed;
    // in a distant village others on their feet) slows it to CARE_GROWTH.
    const hardy = (0.75 + 0.5 * draw(`${g.s.seed}:hardy:${i.id}`)) * modsOf(g, c).illnessStrength; // hardy and sickly people (peoples.js)
    const care = cared(g, c) || (c.sleeping && !!c.job?.bedId) ? CARE_GROWTH : 1;
    const grow = ill.growPerHour * frac * hardy * care * (i.treated ? ill.treatedGrowth : 1);
    i.severity = Math.min(100, Math.round((i.severity + grow) * 10000) / 10000);
    // The Endless plague law never wipes a village out (the owner's answer 6): in a village of SPARE or fewer
    // living, a plague case stops short of deadly.
    if (ill.plague && i.severity > SPARED_MAX && lawIs(g, 'core:plague', 'endless') && g.owned('colonists', c.settlementId || g.s.playerSettlement).length <= ENDLESS_PLAGUE.spare) i.severity = SPARED_MAX;
  }
}

/** People per bed over 1, as a share of the people (0 when everyone has a bed). */
function crowding(g, sid, people) {
  let beds = 0;
  for (const b of g.owned('structures', sid)) if (b.built && g.bDef(b)?.bed && !g.bDef(b)?.medical) beds++;
  return people > beds ? (people - beds) / people : 0;
}

/** Pick an illness of the scenario's list by weight with a draw in [0, 1). */
function pick(g, R, u) {
  const list = R.kinds.filter((k) => g.reg.get('illness', k.illness));
  const total = list.reduce((a, k) => a + k.weight, 0);
  let x = u * total;
  for (const k of list) { x -= k.weight; if (x < 0) return g.reg.get('illness', k.illness); }
  return list.length ? g.reg.get('illness', list[list.length - 1].illness) : null;
}

/** Daily (day start): outbreaks and spread within each village. O(villages + sick × village size). */
export function tickIllness(g) {
  if (g.s.disasters?.plague && !plagueActive(g)) delete g.s.disasters.plague; // the plague has run its course
  const R = spreadRules(g);
  if (!R || lawIs(g, 'core:plague', 'none')) return;
  const s = g.s, day = Math.floor(s.tick / TICKS_PER_DAY);
  for (const sid of Object.keys(s.settlements || {}).sort()) {
    const people = g.owned('colonists', sid).sort(byId);
    if (!people.length) continue;
    if (R.spare && standingOf(people) <= R.spare) continue; // the Endless plague spares a village of 3 or fewer standing (the owner's answer 6)
    const sick = people.filter((p) => contagious(g, p));
    if (!sick.length && R.outbreakPerDay > 0 && day >= (R.graceDays ?? 0)) {
      const crowd = crowding(g, sid, people.length);
      const chance = R.outbreakPerDay * (1 + (R.crowding ?? 0) * crowd);
      if (draw(`${s.seed}:outbreak:${sid}:${day}`) < chance) {
        const ill = pick(g, R, draw(`${s.seed}:outbreak-kind:${sid}:${day}`));
        const who = people[Math.floor(draw(`${s.seed}:outbreak-who:${sid}:${day}`) * people.length)];
        const why = R.spare ? 'the Endless plague law' : crowd > 0 ? 'crowded homes' : 'an outbreak';
        if (infect(g, who, ill, why)) { s.stats.illness.outbreaks++; g.log(`${ill.name} broke out in ${s.settlements[sid].name}${R.spare ? ' (the Endless plague law)' : crowd > 0 ? ' (crowded homes)' : ''}.`, 'warn', null, 0, { kind: 'core:outbreak', sids: [sid], cids: [who.id] }); }
      }
      continue;
    }
    for (const p of sick) {
      const ill = g.reg.get('illness', sicknessOf(p).illness);
      if (!ill) continue;
      for (const o of people) {
        if (o === p || !susceptible(g, o, ill)) continue;
        const home = p.homeId && o.homeId === p.homeId;
        const chance = ill.contagion * (home ? 1 : (R.villageShare ?? 0.3)) * modsOf(g, o).illnessChance; // sickly people catch it more (peoples.js)
        if (draw(`${s.seed}:spread:${p.id}:${o.id}:${day}`) < chance) infect(g, o, ill, `caught it from ${p.name}${modsOf(g, o).illnessChance > 1 ? ' (sickly)' : ''}`);
      }
    }
  }
}

/** The most common illness among the contagious people of `sid` and their share, or null. */
function villageIllness(g, sid) {
  const people = g.owned('colonists', sid);
  if (!people.length) return null;
  const n = new Map();
  let sick = 0;
  for (const p of people) { const i = contagious(g, p) && sicknessOf(p); if (i) { sick++; n.set(i.illness, (n.get(i.illness) || 0) + 1); } }
  if (!sick) return null;
  const id = [...n.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
  const ill = g.reg.get('illness', id);
  return ill ? { ill, share: sick / people.length } : null;
}

/** One susceptible colonist of `sid` for `ill`, picked by draw, or null. */
function someone(g, sid, ill, u) {
  const list = g.owned('colonists', sid).filter((p) => susceptible(g, p, ill)).sort(byId);
  return list.length ? list[Math.floor(u * list.length)] : null;
}

/** Villages a and b met (`how`: "a caravan from A", "traders from A", "goods carried from A"): illness may pass
 *  both ways. `carrier`: the colonist of a who walked into b (hand deliveries); they are the one who meets b's
 *  people. O(the two villages' people). Nothing without illness rules. */
export function spreadContact(g, a, b, how, carrier = null) {
  if (!spreadRules(g) || !a || !b || a === b) return;
  const s = g.s, key = `${s.seed}:travel:${a}:${b}:${s.tick}:${carrier ? carrier.id : how}`;
  // a -> b
  if (carrier) {
    const i = contagious(g, carrier) && sicknessOf(carrier), ill = i && g.reg.get('illness', i.illness);
    if (ill && draw(key + ':ab') < ill.travel) { const t = someone(g, b, ill, draw(key + ':abw')); if (t) infect(g, t, ill, `from ${carrier.name} of ${s.settlements[a]?.name}, who brought goods`); }
  } else {
    const v = villageIllness(g, a);
    if (v && draw(key + ':ab') < v.ill.travel * v.share) { const t = someone(g, b, v.ill, draw(key + ':abw')); if (t) infect(g, t, v.ill, `brought by ${how}`); }
  }
  // b -> a
  const v = villageIllness(g, b);
  if (v && draw(key + ':ba') < v.ill.travel * v.share) {
    const t = carrier ? (susceptible(g, carrier, v.ill) ? carrier : null) : someone(g, a, v.ill, draw(key + ':baw'));
    if (t) infect(g, t, v.ill, `caught in ${s.settlements[b]?.name}`);
  }
}
