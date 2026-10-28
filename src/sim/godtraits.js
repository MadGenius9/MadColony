// The god power 'trait' (Peoples and traits; the owner's answer 6): give one person a trait, or take one away.
//   args { colonistId, trait, mode: 'give' | 'remove' }
// - give: the person must not have it. A trait's opposite, if they have it, is replaced; otherwise they need a
//   free place (at most two traits, peoples.js MAX_TRAITS).
// - remove: the person must have it.
// Costs r.costs.trait favour (default 15; free in Sandbox, as every power). Nothing is created, so nothing goes
// through the ledger. The traits array is replaced, never changed in place (peoples.js modsOf caches by it).
import { registerPower } from './god.js';
import { MAX_TRAITS } from './peoples.js';

const BAD_KEYS = ['__proto__', 'constructor', 'prototype'];

function target(g, a) {
  const k = Object.keys(a).find((x) => !['colonistId', 'trait', 'mode'].includes(x));
  if (k) return { reason: `a trait takes only colonistId, trait and mode (not "${String(k).slice(0, 40)}")` };
  const id = a.colonistId;
  if (typeof id !== 'string' || BAD_KEYS.includes(id) || !Object.hasOwn(g.s.colonists, id)) return { reason: 'there is no such person' };
  const t = typeof a.trait === 'string' ? g.reg.get('trait', a.trait) : null;
  if (!t) return { reason: `there is no trait "${String(a.trait).slice(0, 40)}"` };
  if (a.mode !== 'give' && a.mode !== 'remove') return { reason: 'mode is "give" or "remove"' };
  return { c: g.s.colonists[id], t };
}

/** The traits after the change and what it replaces: { after, replaced } or { reason }. Read-only. */
function plan(g, a) {
  const x = target(g, a);
  if (x.reason) return x;
  const { c, t } = x, have = c.traits || [];
  if (a.mode === 'remove') {
    if (!have.includes(t.id)) return { reason: `${c.name} is not ${t.name.toLowerCase()}` };
    return { c, t, after: have.filter((y) => y !== t.id), replaced: null };
  }
  if (have.includes(t.id)) return { reason: `${c.name} is ${t.name.toLowerCase()} already` };
  const opp = have.find((y) => y === t.opposite || g.reg.get('trait', y)?.opposite === t.id) || null;
  const keep = have.filter((y) => y !== opp);
  if (keep.length >= MAX_TRAITS) return { reason: `${c.name} already has ${MAX_TRAITS} traits; take one away first` };
  return { c, t, after: [...keep, t.id], replaced: opp };
}

const nameOf = (g, id) => g.reg.get('trait', id)?.name || id;

registerPower('trait', {
  validate(g, a) { return plan(g, a).reason || null; },
  cost: (g, a, r) => r.costs.trait ?? 15,
  preview(g, a) {
    const p = plan(g, a);
    const what = a.mode === 'remove' ? `${p.c.name} is no longer ${p.t.name.toLowerCase()}`
      : `${p.c.name} becomes ${p.t.name.toLowerCase()}${p.replaced ? ` (no longer ${nameOf(g, p.replaced).toLowerCase()})` : ''}`;
    return { colonistId: p.c.id, trait: p.t.id, mode: a.mode, replaced: p.replaced, traits: p.after, about: p.t.about, effect: `${what}: ${p.t.about}` };
  },
  apply(g, cmd) {
    const p = plan(g, cmd.args);
    p.c.traits = p.after; // a new array (peoples.js caches by it)
    const msg = cmd.args.mode === 'remove' ? `By divine will ${p.c.name} is no longer ${p.t.name.toLowerCase()}.`
      : `By divine will ${p.c.name} became ${p.t.name.toLowerCase()}${p.replaced ? ` and is no longer ${nameOf(g, p.replaced).toLowerCase()}` : ''}.`;
    return { msg, colonistId: p.c.id, traits: p.after };
  },
});
