// The village council (Phase 6, docs/proposals/phase-6-government.md, slice 2): every COUNCIL.days days an AI
// village's council may move its policy (settlement.policy, read by the planner through policyFor) one step within
// bounds, each step with a recorded reason, only from what the game already measures:
//   foodDays (the food reserve): up after a famine (its memory, memories.js) or with food under 2 days at the
//     review; down toward the profile's value after two reviews in a row with food over twice the reserve.
//   stock of wood and stone: up (x1.5, at most 3x the profile's) while unfinished buildings wait for more of it
//     than the village holds; down toward the profile's after two reviews in a row holding over twice the target.
// The player's village is never changed: councilAdvice says what its council would do (for the UI). State:
// settlement.policy (replaced, never edited in place: it may be the profile's own object), settlement.council
// { plentyFood, plentyStock: { item: n } } (consecutive reviews of plenty). Save format 38 (with leaders).
import { TICKS_PER_DAY } from './constants.js';

export const COUNCIL = Object.freeze({ days: 10, food: { min: 2, max: 10, short: 2 }, stock: { items: ['core:wood', 'core:stone'], up: 1.5, max: 3 } });
const hash = (str) => { let h = 2166136261; for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const baseOf = (g, sid) => g.reg.get('villageProfile', g.s.settlements[sid]?.profile)?.policy || g.policy || {};

/** What the unfinished buildings of village sid still need, by item (cost less delivered). */
function stillNeeded(g, sid) {
  const out = {};
  for (const p of g.owned('projects', sid)) {
    if (p.status !== 'active') continue;
    for (const id of p.parts || []) {
      const st = g.s.structures[id];
      if (!st || st.built) continue;
      for (const k of g.bDef(st)?.cost || []) out[k.item] = (out[k.item] || 0) + Math.max(0, k.qty - (st.delivered?.[k.item] || 0));
    }
  }
  return out;
}

/** The council's steps for village sid now: [{ key, item?, from, to, why, cause? }] (nothing applied). */
export function councilAdvice(g, sid) {
  const s = g.s, st = s.settlements[sid];
  if (!st || st.fallen) return [];
  const pol = g.policyFor(sid), base = baseOf(g, sid), P = g.plans?.[sid], C = st.council || {};
  const out = [];
  // Food reserve.
  const F = COUNCIL.food, cur = pol.foodDays ?? 3, have = P?.foodDays;
  const famine = (st.memories || []).filter((m) => m.kind === 'core:famine_survived').at(-1);
  if ((famine || (have !== undefined && have < F.short)) && cur < F.max) out.push({ key: 'foodDays', from: cur, to: cur + 1, why: famine ? 'they remember the famine' : `food for only ${Math.round(have * 10) / 10} days`, cause: famine?.ev });
  else if (have !== undefined && have > 2 * cur && cur > Math.max(F.min, base.foodDays ?? 3) && (C.plentyFood || 0) >= 1) out.push({ key: 'foodDays', from: cur, to: cur - 1, why: 'food has been plentiful' });
  // Wood and stone.
  const need = stillNeeded(g, sid), stock = P?.stock || {};
  for (const it of COUNCIL.stock.items) {
    const b = base.stock?.[it], t = pol.stock?.[it];
    if (!b || t === undefined) continue;
    const held = stock[it] || 0, name = (g.reg.get('item', it)?.name || it).toLowerCase();
    if ((need[it] || 0) > held && t < b * COUNCIL.stock.max) out.push({ key: 'stock', item: it, from: t, to: Math.min(Math.round(b * COUNCIL.stock.max), Math.round(t * COUNCIL.stock.up)), why: `buildings wait for ${name}` });
    else if (held > 2 * t && t > b && (C.plentyStock?.[it] || 0) >= 1) out.push({ key: 'stock', item: it, from: t, to: Math.max(b, Math.round(t / COUNCIL.stock.up)), why: `plenty of ${name} in store` });
  }
  return out;
}

/** Daily (game.js DAILY_JOBS): the villages whose review day it is (every COUNCIL.days days, at their own offset). */
export function tickCouncil(g) {
  const s = g.s, day = Math.floor(s.tick / TICKS_PER_DAY);
  for (const sid of Object.keys(s.settlements || {}).sort()) {
    const st = s.settlements[sid];
    if (!st.ai || st.fallen || sid === s.playerSettlement || (day + ((hash(sid) + 5) % COUNCIL.days)) % COUNCIL.days) continue;
    councilReview(g, sid);
  }
}

/** One council review of AI village sid (tickCouncil on its day; tests). Returns the steps taken. */
export function councilReview(g, sid) {
  {
    const s = g.s, st = s.settlements[sid];
    if (!st || !st.ai || st.fallen || sid === s.playerSettlement) return [];
    const P = g.plans?.[sid], pol = g.policyFor(sid), steps = councilAdvice(g, sid);
    // Plenty, counted over consecutive reviews (a step down needs two in a row).
    const C = { ...(st.council || {}) };
    C.plentyFood = P?.foodDays !== undefined && P.foodDays > 2 * (pol.foodDays ?? 3) ? (C.plentyFood || 0) + 1 : 0;
    const ps = {};
    for (const it of COUNCIL.stock.items) { const t = pol.stock?.[it]; if (t !== undefined && (P?.stock?.[it] || 0) > 2 * t) ps[it] = (C.plentyStock?.[it] || 0) + 1; }
    if (Object.keys(ps).length) C.plentyStock = ps; else delete C.plentyStock;
    if (!C.plentyFood) delete C.plentyFood;
    const keep = () => { if (C.plentyStock && !Object.keys(C.plentyStock).length) delete C.plentyStock; if (Object.keys(C).length) st.council = C; else delete st.council; };
    if (!steps.length) { keep(); return []; }
    let next = { ...(st.policy || {}) };
    for (const x of steps) {
      if (x.key === 'foodDays') next = { ...next, foodDays: x.to };
      else next = { ...next, stock: { ...(next.stock || {}), [x.item]: x.to } };
      if (x.to < x.from) { if (x.key === 'foodDays') delete C.plentyFood; else if (C.plentyStock) delete C.plentyStock[x.item]; }
      const what = x.key === 'foodDays' ? `keep food for ${x.to} days (was ${x.from})` : `keep ${x.to} ${(g.reg.get('item', x.item)?.name || x.item).toLowerCase()} in store (was ${x.from})`;
      g.log(`The council of ${st.name} decided to ${what}: ${x.why}.`, 'info', null, 0, { kind: 'core:policy', sids: [sid], cause: x.cause });
    }
    st.policy = next;
    keep();
    (g.replanSids ||= new Set()).add(sid);
    return steps;
  }
}
