// Markets (Phase 2, slice 4). A market stall (the scenario's `market.building`, core:market) serves the villages
// whose centres are within `market.reach` tiles of its village's centre and that have met its village (the
// market's own village included). Once a day each market sets a price for every item that villages in its
// reach want or can spare:
//   supply = what they can spare (their plans' surplus: the planner's stock after every need and a safety
//            buffer; distant, abstract villages plan too, from their own goods);
//   demand = what they want (the plans' wants, or the hard trade needs where larger);
//   target = value x clamp((demand + k) / (supply + k), minFactor, maxFactor);
//   the price moves `step` of the way to the target, rounded to 0.01 (at least 0.01 a day while it differs),
//   and is never below 0.01; items whose value is 0 get no price.
// When both sides of a trade are in reach of a market, trade valuation (villages.js value with the pair) uses
// the price of the market nearest to the first side (ties: the lower id) instead of the item's fixed value.
// Trades stay physical trade legs: prices change only how much is asked and offered; nothing is created.
//
// Rules are data (`scenario.market`, merged over MARKET_DEFAULTS). The trade-routes tech that unlocks the
// building has `scenarioFeature: "market"`, so it is never researched where the scenario has no market block
// (all classic scenarios): no market is built there and classic worlds are unchanged. A market built anyway
// (a test, a mod) works with the defaults.
//
// State (save format 9): s.markets[sid] = { prices: { item: p }, supply: { item: n }, demand: { item: n }, updated }
// for each village with a built market, written by the daily update only once a market exists (absent in
// worlds that never had one). Which markets exist and whom they reach are read from the state each time
// (built structures, centres, contact), never cached across ticks, so a loaded game prices exactly as the
// game that was saved. No random numbers.
//
// Cost: nothing per tick. updateMarkets (daily): O(markets x villages) for the reach, plus O(villages in reach
// x items in their plans) per market. marketFor: O(markets) per call (the built-market list is the cached
// structsWhere list); planTrades looks it up once per pair. With no market in the world every call returns
// at once.
// Distant (abstract) villages: they feed supply and demand through their plans like any other, trade at the
// prices, and research and build markets through the ordinary planner and abstract construction (lod.js).

export const MARKET_DEFAULTS = Object.freeze({
  building: 'core:market', reach: 120, k: 4, minFactor: 0.5, maxFactor: 2, step: 0.25, minContacts: 2, researchContacts: 3, urgency: 0.3,
});

const EMPTY = Object.freeze([]);
const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const round2 = (x) => Math.round(x * 100) / 100;

/** The scenario's market rules, over the defaults. */
export function marketRules(g) {
  const m = g.reg.get('scenario', g.s.scenarioId)?.market;
  return m ? { ...MARKET_DEFAULTS, ...m } : MARKET_DEFAULTS;
}
/** Does this scenario turn markets on (villages research and build them)? */
export const marketsOn = (g) => !!g.reg.get('scenario', g.s.scenarioId)?.market;

/** An item's fixed trade value (the price without a market). */
export const baseValue = (g, item) => g.reg.get('item', item)?.value ?? 1;

const isControlled = (g, item) => !!g.reg.get('item', item)?.tags?.includes('core:controlled');
const centerOf = (g, sid) => g.s.settlements?.[sid]?.center;
const met = (g, a, b) => a === b || !!g.s.relations?.[a < b ? `${a}|${b}` : `${b}|${a}`]?.contact;
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

/** Settlement ids that have a built market, sorted. Read-only. */
export function marketsList(g) {
  const bid = marketRules(g).building;
  const list = g.structsWhere('market:' + bid, (st) => st.def === bid);
  if (!list.length) return EMPTY;
  const out = new Set();
  for (const st of list) {
    if (!st.built) continue;
    const sid = st.settlement || g.s.playerSettlement;
    if (g.s.settlements?.[sid]) out.add(sid);
  }
  return out.size ? [...out].sort(byStr) : EMPTY;
}

/** Is `sid` in reach of the market in `m`: within reach of its centre, and has met its village? In contact
 *  games with market.landReach (Phase 2b slice 6, the vast world), also a village it has met on the same
 *  landmass (contact.js land chunks) within landReach. */
function inReach(g, m, sid, reach, landReach, landOf = null) {
  const cm = centerOf(g, m), c = centerOf(g, sid);
  if (!cm || !c || !met(g, m, sid)) return false;
  const d = dist(cm, c);
  if (d <= reach) return true;
  if (!(landReach !== undefined && !!g.s.contact && d <= landReach)) return false;
  if (!landOf) return g.sameLandmass(m, sid);
  const lm = landOf(m);
  return lm >= 0 && lm === landOf(sid); // = sameLandmass (contact.js landmassOf)
}
/** Each village's landmass, looked up once (for a pass over many pairs in which the map does not change). */
function landMemo(g) {
  const memo = new Map();
  return (sid) => { let v = memo.get(sid); if (v === undefined) memo.set(sid, (v = g.landmassOf(sid))); return v; };
}

/** Villages the market in `marketSid` serves (its own included), sorted. Read-only. */
export function marketReach(g, marketSid) {
  const { reach, landReach } = marketRules(g);
  if (!centerOf(g, marketSid)) return [];
  return Object.keys(g.s.settlements || {}).sort(byStr).filter((sid) => inReach(g, marketSid, sid, reach, landReach));
}

/** The market serving both `a` and `b`: of the markets whose reach holds both, the nearest to `a` (centre
 *  distance; ties: the lexically lower id). null when there is none. Read-only. */
export function marketFor(g, a, b) {
  const list = marketsList(g);
  if (!list.length || !a || !b) return null;
  const { reach, landReach } = marketRules(g);
  const ca = centerOf(g, a);
  let best = null, bd = Infinity;
  for (const m of list) {
    if (!inReach(g, m, a, reach, landReach) || !inReach(g, m, b, reach, landReach)) continue;
    const d = dist(centerOf(g, m), ca);
    if (d < bd) { bd = d; best = m; } // list is sorted, so a tie keeps the lexically lower id
  }
  return best;
}

/** marketFor for many pairs in one pass (planTrades): returns (a, b) => marketFor(g, a, b), with the markets
 *  each village is in reach of worked out once per village (inReach is read-only, so asking it for every
 *  market gives the same answers). Only for a pass in which markets, contacts and centres do not change. */
export function marketPicker(g) {
  const list = marketsList(g);
  if (!list.length) return () => null;
  const { reach, landReach } = marketRules(g);
  const memo = new Map(), landOf = landMemo(g);
  const reachOf = (sid) => {
    let set = memo.get(sid);
    if (!set) { set = new Set(); for (const m of list) if (inReach(g, m, sid, reach, landReach, landOf)) set.add(m); memo.set(sid, set); }
    return set;
  };
  return (a, b) => {
    if (!a || !b) return null;
    const ra = reachOf(a), rb = reachOf(b);
    if (!ra.size || !rb.size) return null;
    const ca = centerOf(g, a);
    let best = null, bd = Infinity;
    for (const m of list) {
      if (!ra.has(m) || !rb.has(m)) continue;
      const d = dist(centerOf(g, m), ca);
      if (d < bd) { bd = d; best = m; } // list is sorted, so a tie keeps the lexically lower id
    }
    return best;
  };
}

/** The price of `item` at the market in `marketSid` (its value until the market has priced it). */
export function priceOf(g, marketSid, itemId) {
  const p = g.s.markets?.[marketSid]?.prices?.[itemId];
  return typeof p === 'number' && Number.isFinite(p) ? p : baseValue(g, itemId);
}

/** Target price of an item from its supply and demand. */
function targetOf(g, rules, item, supply, demand) {
  const f = Math.min(rules.maxFactor, Math.max(rules.minFactor, (demand + rules.k) / (supply + rules.k)));
  return baseValue(g, item) * f;
}

/** Why a price is where it is, in words. */
function causeOf(supply, demand, factor) {
  if (factor > 1.05) return `scarce: ${demand} wanted in reach, ${supply ? `only ${supply}` : 'none'} spare`;
  if (factor < 0.95) return `plentiful: ${supply} spare in reach, ${demand ? `only ${demand}` : 'none'} wanted`;
  return `balanced: ${supply} spare, ${demand} wanted in reach`;
}

/** The market's prices, read-only: { [item]: { price, base, supply, demand, target, trend ('up' | 'down' |
 *  'steady': where the price is heading), cause } }, items sorted. Empty until the market's first daily update. */
export function priceTable(g, marketSid) {
  const rec = g.s.markets?.[marketSid];
  const out = {};
  if (!rec) return out;
  const rules = marketRules(g);
  const items = new Set([...Object.keys(rec.prices || {}), ...Object.keys(rec.supply || {}), ...Object.keys(rec.demand || {})]);
  for (const it of [...items].sort(byStr)) {
    const supply = rec.supply?.[it] || 0, demand = rec.demand?.[it] || 0, base = baseValue(g, it);
    const price = priceOf(g, marketSid, it);
    const target = round2(targetOf(g, rules, it, supply, demand));
    const trend = target > price ? 'up' : target < price ? 'down' : 'steady';
    out[it] = { price, base, supply, demand, target, trend, cause: causeOf(supply, demand, base > 0 ? target / base : 1) };
  }
  return out;
}

/** Spare stock and wants of the villages in reach, summed per item (controlled goods left out: AI villages
 *  never trade them). Plans are read, never made. */
function supplyDemand(g, reach) {
  const supply = {}, demand = {};
  for (const sid of reach) {
    const P = g.plans?.[sid];
    if (!P) continue;
    for (const it of Object.keys(P.surplus || {}).sort(byStr)) {
      const q = Math.floor(P.surplus[it] || 0);
      if (q > 0 && !isControlled(g, it)) supply[it] = (supply[it] || 0) + q;
    }
    const wantItems = new Set([...Object.keys(P.wants || {}), ...Object.keys(P.tradeNeeds || {})]);
    for (const it of [...wantItems].sort(byStr)) {
      const q = Math.ceil(Math.max(P.wants?.[it]?.remaining || 0, P.tradeNeeds?.[it] || 0));
      if (q > 0 && !isControlled(g, it)) demand[it] = (demand[it] || 0) + q;
    }
  }
  return { supply, demand };
}

/** One step of a price toward its target: `step` of the way, rounded to 0.01, and at least 0.01 while it
 *  differs from the (rounded) target, so it always arrives. Never below MIN_PRICE (prices are > 0). */
const MIN_PRICE = 0.01;
function stepPrice(p0, target, step) {
  const t = Math.max(MIN_PRICE, round2(target));
  let p = round2(p0 + step * (target - p0));
  if (p === p0 && p0 !== t) p = round2(p0 + (t > p0 ? 0.01 : -0.01));
  return Math.max(MIN_PRICE, p);
}

/** Daily: every market (sorted) sets its prices from the supply and demand in its reach. Records of markets
 *  that are gone are removed. Writes s.markets only once a market exists. */
export function updateMarkets(g) {
  const s = g.s;
  const list = marketsList(g);
  if (!list.length && !s.markets) return;
  if (s.markets) for (const k of Object.keys(s.markets).sort(byStr)) if (!list.includes(k)) delete s.markets[k];
  if (!list.length) { if (s.markets && !Object.keys(s.markets).length) delete s.markets; return; }
  const rules = marketRules(g);
  s.markets ||= {};
  // Every market's reach (marketReach), with the settlement ids sorted once and each village's landmass
  // looked up once: the same lists.
  const ids = Object.keys(s.settlements || {}).sort(byStr), landOf = landMemo(g), { reach, landReach } = rules;
  const reachOfM = (m) => (centerOf(g, m) ? ids.filter((sid) => inReach(g, m, sid, reach, landReach, landOf)) : []);
  for (const m of list) {
    const { supply, demand } = supplyDemand(g, reachOfM(m));
    const old = s.markets[m]?.prices || {};
    const items = new Set([...Object.keys(old), ...Object.keys(supply), ...Object.keys(demand)]);
    const prices = {};
    for (const it of [...items].sort(byStr)) {
      const base = baseValue(g, it);
      if (!(base > 0)) continue; // worthless goods have no price
      const p0 = typeof old[it] === 'number' && Number.isFinite(old[it]) ? old[it] : base;
      const p = stepPrice(p0, targetOf(g, rules, it, supply[it] || 0, demand[it] || 0), rules.step);
      if (!supply[it] && !demand[it] && p === Math.max(MIN_PRICE, round2(base))) continue; // back at its value and nobody trades it: dropped
      prices[it] = p;
    }
    s.markets[m] = { prices, supply, demand, updated: s.tick };
  }
}
