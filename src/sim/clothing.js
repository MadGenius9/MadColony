// Clothing (Phase 9, slice 1; docs/proposals/phase-9-livestock.md). A garment is an item with
// `equipment: { slot: 'body', warmth, durability }`, worn in the colonist's optional `equip.body` (absent: none).
// Its warmth (°C) moves the cold line down for its wearer (life.js coldUnder). Each hour the wearer would be cold
// without it wears it by one (health.js); worn out, it leaves the ledger as worn. In scenarios with cold rules, a
// full-detail village wants a garment for each bare adult once the next CLOTHING.days days get within
// CLOTHING.ahead °C of the cold line: as many as its stock can make (no demand for hides it cannot get), the
// homeless first, then by id.
import { lifeRules } from './life.js';
import { coldestAhead } from './heat.js';
import { isUnlocked } from './research.js';

export const CLOTHING = Object.freeze({ ahead: 4, days: 3, urgency: 0.45 });

/** The warmth (°C) of c's garment, or 0. */
export function warmthOf(g, c) {
  const e = c?.equip?.body;
  return e ? g.reg.get('item', e.item)?.equipment?.warmth || 0 : 0;
}

/** health.js, each step of `frac` hours: c's garment is keeping out the cold, so it wears. */
export function wearBody(g, c, frac) {
  const e = c.equip.body;
  e.dur = Math.round(((e.dur ?? 1) - frac) * 1000) / 1000;
  if (e.dur > 0) return;
  const name = g.reg.get('item', e.item)?.name || e.item;
  g.consume(e.item, 1, 'wear');
  c.equip.body = null;
  g.log(`${c.name}'s ${name.toLowerCase()} wore out.`, 'warn');
}

/** How many of `item` village sid has or can make from its stock now, through unlocked recipes (two steps deep). */
function obtainable(g, sid, item, stock, depth = 2) {
  let best = 0;
  if (depth > 0) for (const r of g.reg.idx.recipesFor[item] || []) {
    if (!isUnlocked(g, sid, 'recipe', r.id) || r.inputs.some((i) => !i.item)) continue;
    const runs = Math.min(...r.inputs.map((i) => Math.floor(obtainable(g, sid, i.item, stock, depth - 1) / i.qty)));
    best = Math.max(best, runs * (r.outputs.find((o) => o.item === item)?.qty || 0));
  }
  return (stock[item] || 0) + best;
}

/** The warmest garment village sid can have now, with how many it can have: { item, n }, or null. */
export function bestGarment(g, sid, stock = {}) {
  let best = null;
  for (const it of g.reg.all('item')) {
    if (it.equipment?.slot !== 'body') continue;
    const n = obtainable(g, sid, it.id, stock);
    if (n > 0 && (!best || (it.equipment.warmth || 0) > (best.item.equipment.warmth || 0))) best = { item: it, n };
  }
  return best;
}

/** The planner's wants for garments (planner.js): one demand per adult who should get one (equipFor, slot 'body'). */
export function garmentWants(g, sid, adults, stock) {
  const R = lifeRules(g)?.cold;
  if (!R || !adults.length || g.s.settlements?.[sid]?.detail === 'abstract') return [];
  if (g._coldAhead?.tick !== g.s.tick) g._coldAhead = { tick: g.s.tick, t: coldestAhead(g, CLOTHING.days) }; // once a tick (derived)
  if (g._coldAhead.t >= R.below + CLOTHING.ahead) return []; // the coming days are mild
  const bare = adults.filter((c) => !c.equip.body && !(c.job?.type === 'equip' && c.job.slot === 'body'));
  if (!bare.length) return [];
  const best = bestGarment(g, sid, stock);
  if (!best) return [];
  bare.sort((a, b) => (!!a.homeId) - (!!b.homeId) || (a.id < b.id ? -1 : 1));
  const name = best.item.name.toLowerCase();
  return bare.slice(0, best.n).map((c) => ({ item: best.item.id, qty: 1, urgency: CLOTHING.urgency, why: `A ${name} for ${c.name} against the cold`, equipFor: c.id, slot: 'body' }));
}
