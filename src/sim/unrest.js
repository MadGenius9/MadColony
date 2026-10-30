// Unrest (Mood, slice 3; docs/proposals/mood.md, the owner's answers 3 and 4). Daily, after the law reviews:
// - A village is in unrest while at least UNREST.share of its adults are unhappy (mood.js); settlement.unrest is
//   the tick it began (saved). After UNREST.days days of it:
//   - an AI village repeals its most disliked law that no situation calls for (not a militia at war, not
//     rationing while food is short; civreview.js decides those), and the clock starts again;
//   - the player's village gets a warning in the log naming the commonest reasons (its laws are never forced);
//   - one miserable family may leave for the nearest village of its own people with free beds for all of them
//     (peoples keep apart), carrying nothing: their jobs end (carried goods are dropped as their village's),
//     beds and home are given up, and they become the other village's people. At most one family a village
//     every UNREST.days days.
// Everything is a pure function of the state and hash-free (no draws): O(villages + people) a day.
import { TICKS_PER_DAY } from './constants.js';
import { MOOD, thoughtsOf, villageFacts } from './mood.js';
import { isAdult } from './people.js';
import { civLawOf, setCivLaw, lawHolder } from './civlaws.js';
import { familiesOf } from './founding.js';
import { endJob } from './ai/ai.js';
import { isEnemy } from './combat.js';
import { peopleOfSettlement } from './peoples.js';

export const UNREST = Object.freeze({ share: 0.5, days: 5, minAdults: 2 });

const optionMood = (g, id, o) => g.reg.get('civLaw', id)?.options?.find((x) => x.id === o)?.mood ?? 0;

/** Is village sid in unrest now (the share of unhappy adults)? { unhappy, adults, on }. */
export function unrestOf(g, sid) {
  const adults = g.owned('colonists', sid).filter((c) => isAdult(g, c));
  const unhappy = adults.filter((c) => (c.mood ?? 0) <= MOOD.unhappy).length;
  return { unhappy, adults: adults.length, on: adults.length >= UNREST.minAdults && unhappy >= UNREST.share * adults.length };
}

/** The law an AI village in unrest repeals: its most disliked option (below the default's mood) that it holds
 *  itself and no situation calls for. null when none. */
function lawToRepeal(g, sid) {
  const atWar = Object.keys(g.s.settlements).some((o) => o !== sid && isEnemy(g, sid, o));
  const foodDays = g.plans?.[sid]?.foodDays ?? 99;
  let best = null, worst = 0;
  for (const L of [...g.reg.all('civLaw')].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (lawHolder(g, sid, L.id) !== sid) continue;
    const o = civLawOf(g, sid, L.id), def = L.options[0].id;
    if (o === def) continue;
    if ((L.id === 'core:conscription' && atWar) || (L.id === 'core:rationing' && foodDays < 5)) continue; // still needed
    const d = optionMood(g, L.id, o) - optionMood(g, L.id, def);
    if (d < worst) { worst = d; best = L; }
  }
  return best;
}

/** The commonest bad thoughts of village sid's unhappy adults (names, at most 3). */
function reasons(g, sid) {
  const V = villageFacts(g, sid)[sid], count = new Map();
  for (const c of g.owned('colonists', sid)) {
    if (!isAdult(g, c) || (c.mood ?? 0) > MOOD.unhappy) continue;
    for (const t of thoughtsOf(g, c, V)) if (t.value < 0) count.set(t.name, (count.get(t.name) || 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(([n]) => n.toLowerCase());
}

/** Free beds in village sid (built beds with no living owner). */
function freeBeds(g, sid) {
  let n = 0;
  for (const b of g.owned('structures', sid)) if (b.built && g.bDef(b)?.bed && !g.bDef(b).medical && !(b.owner && g.s.colonists[b.owner])) n++;
  return n;
}

/** One miserable family of village sid leaves for the nearest village of its people with room. Returns the move or null. */
function leave(g, sid) {
  const s = g.s, folk = peopleOfSettlement(g, sid), here = s.settlements[sid].center || s.center;
  const fam = familiesOf(g, sid).fams
    .filter((f) => f.adults.every((c) => (c.mood ?? 0) <= MOOD.miserable) && [...f.adults, ...f.kids].every((c) => !c.health?.down && !c.carriedBy && !c.medBedId))
    .sort((a, b) => (a.adults[0].id < b.adults[0].id ? -1 : 1))[0];
  if (!fam) return null;
  const size = fam.adults.length + fam.kids.length;
  let to = null, bd = Infinity;
  for (const o of Object.keys(s.settlements).sort()) {
    const v = s.settlements[o];
    if (o === sid || v.fallen || !v.center || peopleOfSettlement(g, o) !== folk || isEnemy(g, sid, o) || freeBeds(g, o) < size) continue;
    const d = Math.hypot(v.center.x - here.x, v.center.y - here.y);
    if (d < bd) { bd = d; to = o; }
  }
  if (!to) return null;
  const v = s.settlements[to];
  for (const c of [...fam.adults, ...fam.kids]) {
    if (c.job) endJob(g, c, null, `Leaving for ${v.name}`); // carried goods are dropped as their village's
    const bed = c.bedId && s.structures[c.bedId];
    if (bed && bed.owner === c.id) delete bed.owner;
    const home = c.homeId && s.homes[c.homeId];
    if (home) home.owners = (home.owners || []).filter((x) => x !== c.id);
    c.bedId = null; c.homeId = null; c.medBedId = null;
    c.settlementId = to; c.color = v.color;
    c.x = v.center.x; c.y = v.center.y; c.mv = null; c.path = null; c.sleeping = false; c.idle = 0;
    c.status = { goal: `Settling in ${v.name}`, action: `Left ${s.settlements[sid].name}, miserable`, target: '', blocker: '' };
  }
  g.ownReset('colonists');
  g.planDirty = true;
  (g.replanSids ||= new Set()).add(sid).add(to);
  return { to, n: size, name: fam.adults[0].name };
}

/** Daily (game.js, after the law reviews). */
export function tickUnrest(g) {
  const s = g.s;
  for (const sid of Object.keys(s.settlements || {}).sort()) {
    const st = s.settlements[sid];
    if (st.fallen) continue;
    const u = unrestOf(g, sid);
    if (!u.on) { delete st.unrest; continue; }
    st.unrest ??= s.tick;
    if (s.tick - st.unrest < UNREST.days * TICKS_PER_DAY) continue;
    st.unrest = s.tick; // the clock starts again after each outcome
    const why = reasons(g, sid).join(', ');
    let uev = null; // this pass's unrest line (chronicle.js)
    if (sid === s.playerSettlement) uev = g.log(`Unrest in ${st.name}: ${u.unhappy} of ${u.adults} are unhappy${why ? ` (${why})` : ''}.`, 'warn', null, 0, { kind: 'core:unrest', sids: [sid] });
    else {
      const L = lawToRepeal(g, sid);
      if (L) {
        const r = setCivLaw(g, sid, L.id, L.options[0].id, 'unrest', { quiet: true });
        if (r.ok) uev = g.log(`Unrest in ${st.name}: the ${L.name.toLowerCase()} law was repealed${why ? ` (${why})` : ''}.`, 'info', null, 0, { kind: 'core:unrest', sids: [sid] });
      }
    }
    const m = leave(g, sid);
    if (m) g.log(`${m.name}'s family (${m.n}) left ${st.name} for ${s.settlements[m.to].name}, miserable.`, sid === s.playerSettlement || m.to === s.playerSettlement ? 'warn' : 'info', null, 0, { kind: 'core:family_left', sids: [sid, m.to], cause: uev || undefined });
  }
}
