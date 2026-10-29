// World laws (docs/proposals/world-laws.md): switches the gods set during play (content type `worldLaw`, data
// mods/core/content/laws.json). Each law has values; the first is its default (no law).
// - State: s.worldLaws = { set: { law: value }, since: { law: tick } }, holding only laws away from their default
//   (absent: no laws, so a game without laws saves exactly as before). Peaceful animals keeps its own flag,
//   s.animals.peaceful (Phase 8b); this module reads and writes it as the law core:peaceful_animals.
// - The god power 'law' { law, value } (free; the owner's answer 2) sets one law at the next tick, like every
//   command, so loads and replays give the same game.
// - Hot paths read lawIs(g, id, value): one property lookup, nothing when no laws are set.
// - Systems that must act when a law changes (the age freeze) register a hook with onLawChange.
import { registerPower } from './god.js';

export const PEACEFUL = 'core:peaceful_animals';
const HOOKS = new Map();

/** Register fn(g, from, to) to run when law `id` changes (in apply, just before the change, so lawOf and
 *  lawSince still give the old value). */
export function onLawChange(id, fn) { HOOKS.set(id, fn); }

/** The default value of law `id` (its first), or null for an unknown law. */
export function lawDefault(g, id) { return g.reg.get('worldLaw', id)?.values?.[0]?.id ?? null; }

/** The current value of law `id`. */
export function lawOf(g, id) {
  if (id === PEACEFUL) return g.s.animals?.peaceful ? 'on' : 'off';
  return g.s.worldLaws?.set?.[id] ?? lawDefault(g, id);
}

/** Is law `id` at `value` now? O(1); false for a default value unless no law is set at all (use lawOf then). */
export function lawIs(g, id, value) {
  if (id === PEACEFUL) return (value === 'on') === !!g.s.animals?.peaceful;
  return g.s.worldLaws?.set?.[id] === value;
}

/** The Fast growth law: births, crops, wild regrowth, forest spread and founding come this many times as fast. */
export const FAST_GROWTH = 2;
/** 2 under the Fast growth law, else 1 (O(1)). */
export const growthOf = (g) => (g.s.worldLaws?.set?.['core:fast_growth'] === 'on' ? FAST_GROWTH : 1);

/** The tick law `id` took its current value, or null (at its default). */
export function lawSince(g, id) { return g.s.worldLaws?.since?.[id] ?? null; }

/** Every law away from its default: [{ id, name, value, valueName, since }], by id. */
export function activeLaws(g) {
  const out = [];
  for (const L of [...g.reg.all('worldLaw')].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const v = lawOf(g, L.id);
    if (v === L.values[0].id) continue;
    out.push({ id: L.id, name: L.name, value: v, valueName: L.values.find((x) => x.id === v)?.name || v, since: lawSince(g, L.id) });
  }
  return out;
}

function check(g, a) {
  const k = Object.keys(a).find((x) => x !== 'law' && x !== 'value');
  if (k) return { reason: `a law takes only law and value (not "${String(k).slice(0, 40)}")` };
  const L = typeof a.law === 'string' ? g.reg.get('worldLaw', a.law) : null;
  if (!L) return { reason: `there is no world law "${String(a.law).slice(0, 40)}"` };
  const V = L.values.find((x) => x.id === a.value);
  if (!V) return { reason: `${L.name} is one of: ${L.values.map((x) => x.id).join(', ')}` };
  if (L.id === PEACEFUL && !g.s.animals) return { reason: 'the wild has not settled yet (wait a moment)' };
  const from = lawOf(g, L.id);
  if (from === V.id) return { reason: `${L.name} is ${V.name.toLowerCase()} already` };
  return { L, V, from };
}

registerPower('law', {
  validate: (g, a) => check(g, a).reason || null,
  cost: () => 0,
  preview(g, a) {
    const { L, V, from } = check(g, a);
    return { law: L.id, value: V.id, from, effect: `${L.name}: ${V.name}. ${V.about || ''}`.trim() };
  },
  apply(g, cmd) {
    const { L, V, from } = check(g, cmd.args);
    const s = g.s, def = L.values[0].id;
    HOOKS.get(L.id)?.(g, from, V.id); // before the change: hooks see the old value and its start (lawSince)
    if (L.id === PEACEFUL) { if (V.id === 'on') s.animals.peaceful = true; else delete s.animals.peaceful; }
    else {
      s.worldLaws ||= { set: {}, since: {} };
      s.worldLaws.set ||= {}; s.worldLaws.since ||= {};
      if (V.id === def) { delete s.worldLaws.set[L.id]; delete s.worldLaws.since[L.id]; }
      else { s.worldLaws.set[L.id] = V.id; s.worldLaws.since[L.id] = s.tick; }
      if (!Object.keys(s.worldLaws.set).length) delete s.worldLaws;
    }
    return { msg: `World law: ${L.name} is now ${V.name.toLowerCase()}.${V.about ? ` ${V.about}` : ''}`, law: L.id, value: V.id };
  },
});

/** Load (save.js): drop laws and values the loaded content does not know. */
export function mendLaws(reg, s) {
  const W = s.worldLaws;
  if (!W) return;
  for (const [k, v] of Object.entries(W.set || {})) {
    const L = reg.get('worldLaw', k);
    if (!L || !L.values.some((x) => x.id === v) || L.values[0].id === v) { delete W.set[k]; if (W.since) delete W.since[k]; }
  }
  for (const k of Object.keys(W.since || {})) if (!W.set?.[k]) delete W.since[k];
  if (!Object.keys(W.set || {}).length) delete s.worldLaws;
}
