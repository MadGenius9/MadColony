// Civilization laws (docs/proposals/civilization-laws.md): every village keeps a code of laws (content type
// `civLaw`, data mods/core/content/civlaws.json). Each law has options; the first is its default (today's game).
// - State: settlement.code = { law: option } and settlement.codeSince = { law: tick }, holding only laws away
//   from their default (absent: every law at its default, so a village without laws saves as before).
// - Kingdom laws (civLaw.kingdom): a member follows its capital's code for them; it is read from the capital,
//   so joining, leaving and a new capital need no copying.
// - civLawOf(g, sid, law) is O(1) for the hot paths.
// - setCivLaw changes one law of one village: validated, at most once per law every CHANGE_DAYS days (the
//   owner's answer 2), with the reason logged and the village's plan redone. Like the player's other settings
//   (policy, attack orders) it is a direct call: the saved state keeps games deterministic.
// - Leanings: a village's people and profile lean to options (their `code`); new villages start with them.
import { TICKS_PER_DAY } from './constants.js';

export const CHANGE_DAYS = 5;

const kingdomOf = (g, sid) => { const k = g.s.settlements?.[sid]?.kingdom; return k ? g.s.kingdoms?.[k] : null; };

/** The settlement whose code holds law `id` for village sid: its capital's for a kingdom law, else its own. */
export function lawHolder(g, sid, id) {
  if (!g.reg.get('civLaw', id)?.kingdom) return sid;
  const k = kingdomOf(g, sid);
  return k?.capital && k.capital !== sid && g.s.settlements[k.capital] ? k.capital : sid;
}

/** The option of law `id` in force in village sid (its kingdom's for a kingdom law); the default if none. */
export function civLawOf(g, sid, id) {
  const holder = lawHolder(g, sid, id);
  return g.s.settlements?.[holder]?.code?.[id] ?? g.reg.get('civLaw', id)?.options?.[0]?.id ?? null;
}

/** Is law `id` at `option` in village sid? */
export const civLawIs = (g, sid, id, option) => civLawOf(g, sid, id) === option;

/** The laws of village sid away from their default: [{ id, name, option, optionName, since, byKingdom }]. */
export function codeOf(g, sid) {
  const out = [];
  for (const L of [...g.reg.all('civLaw')].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const o = civLawOf(g, sid, L.id);
    if (o === L.options[0].id) continue;
    const holder = lawHolder(g, sid, L.id);
    out.push({ id: L.id, name: L.name, option: o, optionName: L.options.find((x) => x.id === o)?.name || o, since: g.s.settlements[holder]?.codeSince?.[L.id] ?? null, byKingdom: holder !== sid ? holder : null });
  }
  return out;
}

// ---- effects (slice 2: daily life)
/** Long hours: the energy at which people seek their beds at night (instead of the need's nightSeekBelow). */
export const LONG_NIGHT_SEEK = 0.4;
/** Rationing: hunger falls this much as fast, and work goes this much as fast. */
export const RATION = Object.freeze({ hunger: 0.8, work: 0.9 });
/** Child labour: the work children may also do. */
export const CHILD_WORK = Object.freeze(['core:haul', 'core:farm']);
const sidOfC = (g, c) => c.settlementId || g.s.playerSettlement;
/** The hunger multiplier of colonist c's village (rationing), 1 without it. */
export const rationOf = (g, c) => (civLawIs(g, sidOfC(g, c), 'core:rationing', 'rationed') ? RATION.hunger : 1);
/** Village sid's work-hours law: 'normal', 'long' or 'curfew'. */
export const hoursOf = (g, sid) => civLawOf(g, sid, 'core:work_hours') || 'normal';

// ---- effects (slice 3: land and arms)
/** Restricted hunting: hunts only while the village has under this many days of food. */
export const HUNT_RESTRICT_DAYS = 3;
/** Protected forests: no grown tree within this many tiles of the village centre is felled. */
export const PROTECT_R = 12;
/** May village sid hunt for meat now (foodDays: its planner's)? A pack that attacked it is hunted anyway. */
export function huntAllowed(g, sid, foodDays) {
  const h = civLawOf(g, sid, 'core:hunting');
  return h === 'banned' ? false : h === 'restricted' ? (foodDays ?? 99) < HUNT_RESTRICT_DAYS : true;
}
/** Is node n a grown tree that village sid's Protected forests law keeps from felling? O(1). */
export function treeProtected(g, sid, n) {
  if (!n || n.young || civLawOf(g, sid, 'core:forests') !== 'protected') return false;
  if (g.nodeDef(n)?.workType !== 'core:chop') return false;
  const c = g.s.settlements?.[sid]?.center || g.s.center;
  return (n.x - c.x) ** 2 + (n.y - c.y) ** 2 <= PROTECT_R * PROTECT_R;
}

// ---- effects (slice 4: outside)
/** Are villages a and b kept apart by closed borders (either side's; villages of one kingdom never are)? */
export function bordersClosed(g, a, b) {
  const ka = g.s.settlements?.[a]?.kingdom;
  if (ka && ka === g.s.settlements?.[b]?.kingdom) return false;
  return civLawIs(g, a, 'core:borders', 'closed') || civLawIs(g, b, 'core:borders', 'closed');
}
/** The Justice law's factor on smuggling attention and seizures in village sid: harsh 2, lenient 0.5. */
export const justiceOf = (g, sid) => { const j = civLawOf(g, sid, 'core:justice'); return j === 'harsh' ? 2 : j === 'lenient' ? 0.5 : 1; };
/** The tithe: every TITHE.days days a member sends this share of its spare goods to its capital. */
export const TITHE = Object.freeze({ days: 10, share: 0.1, max: 200 });

/** The mood of an option (data; for the Mood phase), 0 when unknown. */
export function optionMood(g, id, option) { return g.reg.get('civLaw', id)?.options?.find((x) => x.id === option)?.mood ?? 0; }

/** Why law `id` of village sid cannot be set to `option` now, or null. opts.force skips the waiting time. */
export function civLawProblem(g, sid, id, option, opts = {}) {
  const st = g.s.settlements?.[sid];
  if (!st || st.fallen) return 'there is no such village';
  const L = g.reg.get('civLaw', id);
  if (!L) return `there is no law "${String(id).slice(0, 40)}"`;
  if (!L.options.some((x) => x.id === option)) return `${L.name} is one of: ${L.options.map((x) => x.id).join(', ')}`;
  const holder = lawHolder(g, sid, id);
  if (holder !== sid) return `${L.name} is set by ${g.s.settlements[holder].name}, the capital of ${kingdomOf(g, sid)?.name || 'the kingdom'}`;
  if (civLawOf(g, sid, id) === option) return `${L.name} is ${L.options.find((x) => x.id === option).name.toLowerCase()} already`;
  const since = st.codeSince?.[id];
  if (!opts.force && since !== undefined && g.s.tick - since < CHANGE_DAYS * TICKS_PER_DAY) {
    const left = Math.ceil((since + CHANGE_DAYS * TICKS_PER_DAY - g.s.tick) / TICKS_PER_DAY);
    return `${L.name} was changed less than ${CHANGE_DAYS} days ago (wait ${left} more day${left === 1 ? '' : 's'})`;
  }
  return null;
}

/** Set law `id` of village sid to `option` (why: the reason, logged). Returns { ok, message }. */
export function setCivLaw(g, sid, id, option, why = '', opts = {}) {
  const p = civLawProblem(g, sid, id, option, opts);
  if (p) return { ok: false, message: p };
  const st = g.s.settlements[sid], L = g.reg.get('civLaw', id), O = L.options.find((x) => x.id === option);
  if (option === L.options[0].id) {
    if (st.code) delete st.code[id];
    if (st.code && !Object.keys(st.code).length) delete st.code;
  } else (st.code ||= {})[id] = option;
  (st.codeSince ||= {})[id] = g.s.tick; // kept at the default too: the waiting time applies to every change
  g.planDirty = true;
  (g.replanSids ||= new Set()).add(sid);
  if (!opts.quiet) {
    const mine = sid === g.s.playerSettlement;
    const eid = g.log(`${st.name} ${option === L.options[0].id ? `ended its ${L.name.toLowerCase()} law` : `passed a law: ${L.name}, ${O.name.toLowerCase()}`}${why ? ` (${why})` : ''}.`, mine ? 'good' : 'info', null, 0, { kind: 'core:law', sids: [sid], cause: opts.cause });
    if (eid && option !== L.options[0].id) (st.codeEv ||= {})[id] = eid; // the line that set it (chronicle.js)
  }
  if (option === L.options[0].id && st.codeEv) { delete st.codeEv[id]; if (!Object.keys(st.codeEv).length) delete st.codeEv; }
  return { ok: true, message: `${L.name}: ${O.name}.` };
}

/** The options village sid leans to: its profile's code, then its people's (data). */
export function leaningsOf(g, sid) {
  const st = g.s.settlements?.[sid];
  const prof = st?.profile ? g.reg.get('villageProfile', st.profile) : null;
  const folk = st?.people ? g.reg.get('people', st.people) : null;
  return { ...(folk?.code || {}), ...(prof?.code || {}) };
}

/** A new village's code (world start, divine): its leanings, set quietly; no waiting time is recorded. */
export function startCode(g, sid) {
  const st = g.s.settlements[sid];
  if (!st || sid === g.s.playerSettlement) return; // the player chooses their own laws
  for (const [id, option] of Object.entries(leaningsOf(g, sid)).sort()) {
    const L = g.reg.get('civLaw', id);
    if (!L || !L.options.some((x) => x.id === option) || option === L.options[0].id) continue;
    (st.code ||= {})[id] = option;
  }
}

/** Load (save.js): drop laws and options the loaded content does not know. */
export function mendCode(reg, s) {
  for (const st of Object.values(s.settlements || {})) {
    for (const [k, v] of Object.entries(st.code || {})) {
      const L = reg.get('civLaw', k);
      if (!L || !L.options.some((x) => x.id === v) || L.options[0].id === v) delete st.code[k];
    }
    if (st.code && !Object.keys(st.code).length) delete st.code;
    for (const k of Object.keys(st.codeSince || {})) if (!reg.get('civLaw', k)) delete st.codeSince[k];
    if (st.codeSince && !Object.keys(st.codeSince).length) delete st.codeSince;
  }
}
