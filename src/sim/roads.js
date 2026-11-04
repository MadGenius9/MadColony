// Roads (Phase 7, docs/proposals/phase-7-roads.md). A road is a one-tile, walkable building (data: a building with
// `road: { step }`); a step onto a built road takes `step` of a plain step (game.js stepCost, read by the walking
// step). Roads change no terrain, so path searches, the walkable areas and the water maps never see them (an earlier
// version made the tile a road terrain: every road laid made the whole-map water field be worked out again, 41% of a
// World run's time with 1,200 roads). Roads are laid where people already walk, so their paths use them anyway.
import { findPath } from './path.js';
import { createProject, tileUsable } from './construction.js';
import { hasPact, completedTradesBetween } from './villages.js';
import { TICKS_PER_DAY } from './constants.js';
import { isUnlocked } from './research.js';

// ---------- handcarts (slice 4) ----------
// A handcart is an item with `equipment: { slot: 'cart', carry, offRoad }`, researched and made at the workbench
// (data, roads.json). A hauler with one carries `carry` times the usual load (game.js carryLimit; still at most a
// stack), and each load picked up wears it by one; a loaded step off a road takes `offRoad` times as long (game.js
// stepCost), so carts pay where there are roads. Loose goods lie in small piles, so a hauler with a cart taking a
// pile to the stockpile also picks up up to CART.stops more piles of the same item within CART.reach tiles of it
// (moreLoads; each reserved), as long as the load and the room where it goes allow (haul job `more`). The cart and
// its load are the colonist's (census, inventoryOf):
// nothing is duplicated. A full-detail village of at least CART.minPeople adults wants a cart for every
// CART.perPeople adults; they go first to those who already have one, then by id.
export const CART = Object.freeze({ minPeople: 8, perPeople: 6, urgency: 0.3, reach: 6, stops: 3 });

/** A hauler with a cart takes stack st to the stockpile in job: reserve up to `left` more of its item from other
 *  loose piles near it (job.more [{ stackId, qty }], nearest first, then by id). Piles with a durability are left. */
export function moreLoads(g, job, st, left, c) {
  if (left <= 0 || st.dur !== undefined) return;
  const near = [];
  for (const x of g.stacksByItem().get(st.item) || []) {
    if (x === st || x.dur !== undefined || Math.max(Math.abs(x.x - st.x), Math.abs(x.y - st.y)) > CART.reach) continue;
    if (!g.mine(x, c) || (g.isStockpile(x.x, x.y) && !g.footIdAt(g.i(x.x, x.y))) || g.isBlocked('stack:' + x.id) || g.availQty(x.id) <= 0) continue;
    near.push(x);
  }
  near.sort((a, b) => Math.max(Math.abs(a.x - st.x), Math.abs(a.y - st.y)) - Math.max(Math.abs(b.x - st.x), Math.abs(b.y - st.y)) || (a.id < b.id ? -1 : 1));
  for (const x of near) {
    if (left <= 0 || (job.more ||= []).length >= CART.stops) break;
    if (!g.canReach(c, x.x, x.y, 'on')) continue;
    const q = Math.min(left, g.availQty(x.id));
    if (!g.reserveQty(job, x.id, q)) continue;
    job.more.push({ stackId: x.id, qty: q });
    left -= q;
  }
  if (!job.more?.length) delete job.more;
}

/** The equipment of c's cart (carry, offRoad, durability), or null. */
export const cartOf = (g, c) => { const e = c?.equip?.cart; return e ? g.reg.get('item', e.item)?.equipment || null : null; };

/** A load was picked up with a cart: it wears by one, and is gone at zero. */
export function wearCart(g, c) {
  const e = c.equip.cart;
  e.dur = (e.dur ?? 1) - 1;
  if (e.dur > 0) return;
  const name = g.reg.get('item', e.item)?.name || e.item;
  g.consume(e.item, 1, 'wear');
  c.equip.cart = null;
  g.log(`${c.name}'s ${name} wore out.`, 'warn');
}

/** The cart village sid can make (an unlocked recipe) or has in stock that carries the most, or null. */
export function bestCart(g, sid, stock = {}) {
  let best = null;
  for (const it of g.reg.all('item')) {
    if (it.equipment?.slot !== 'cart') continue;
    if (!(stock[it.id] > 0) && !(g.reg.idx.recipesFor[it.id] || []).some((r) => isUnlocked(g, sid, 'recipe', r.id))) continue;
    if (!best || (it.equipment.carry || 1) > (best.equipment.carry || 1)) best = it;
  }
  return best;
}

/** The planner's wants for carts (planner.js): one demand per adult who should get one (equipFor, slot 'cart'). */
export function cartWants(g, sid, adults, stock) {
  if (g.s.settlements?.[sid]?.detail === 'abstract' || adults.length < CART.minPeople) return [];
  const cart = bestCart(g, sid, stock);
  if (!cart) return [];
  const pool = adults.filter((c) => !c.workOff?.['core:haul']).sort((a, b) => (!!b.equip.cart) - (!!a.equip.cart) || (a.id < b.id ? -1 : 1));
  const out = [];
  for (const c of pool.slice(0, Math.floor(adults.length / CART.perPeople))) {
    if (c.equip.cart || (c.job?.type === 'equip' && c.job.slot === 'cart')) continue;
    out.push({ item: cart.id, qty: 1, urgency: CART.urgency, why: `A ${cart.name.toLowerCase()} for ${c.name} to haul with`, equipFor: c.id, slot: 'cart' });
  }
  return out;
}

/** Built road tiles of village sid (for plans and the UI). */
export const roadsOf = (g, sid) => g.owned('structures', sid).filter((b) => b.built && g.bDef(b)?.road);

// ---------- foot traffic and the first roads (slice 2) ----------
// Each full-detail village counts its people walking, by cell of ROAD.cell x ROAD.cell tiles, every ROAD.sample
// ticks (settlement.traffic { "cx,cy": n }, saved, at most ROAD.cells cells), decaying by ROAD.decay a day. A village
// lays roads, ROAD.segment tiles at a time, along the path from its centre toward its busiest cell at least
// ROAD.far tiles away, once that cell reaches ROAD.busy; one batch at a time, at most ROAD.max road tiles.

// minPeople: a village smaller than this lays no roads (a small colony's stone and work matter more elsewhere: in
// the classic 5-person game roads delayed the modern era by 8 days).
export const ROAD = Object.freeze({ cell: 4, sample: 10, cells: 400, decay: 0.9, busy: 40, far: 8, segment: 8, max: 120, minPeople: 8 });

/** Every ROAD.sample ticks (game.js): walking people of full-detail villages add to their village's traffic. */
export function countTraffic(g) {
  const s = g.s;
  for (const c of g.colonistList()) {
    if (!c.mv) continue;
    const sid = c.settlementId || s.playerSettlement, st = s.settlements?.[sid];
    if (!st || st.fallen || st.detail === 'abstract') continue;
    const k = `${Math.floor(c.x / ROAD.cell)},${Math.floor(c.y / ROAD.cell)}`;
    const T = (st.traffic ||= {});
    if (T[k] === undefined && Object.keys(T).length >= ROAD.cells) continue; // full: only cells already counted grow
    T[k] = (T[k] || 0) + 1;
  }
}

/** Daily (game.js DAILY_JOBS): traffic fades. */
export function fadeTraffic(g) {
  for (const sid of Object.keys(g.s.settlements || {}).sort()) {
    const st = g.s.settlements[sid];
    if (!st.traffic) continue;
    for (const k of Object.keys(st.traffic)) { const v = Math.floor(st.traffic[k] * ROAD.decay); if (v > 0) st.traffic[k] = v; else delete st.traffic[k]; }
    if (!Object.keys(st.traffic).length) delete st.traffic;
  }
}

const roadOpen = (g, x, y, sid) => g.inB(x, y) && tileUsable(g, x, y, sid) && g.terrainAt(x, y).buildable && !g.structIdAt(g.i(x, y)) && !g.nodeAt(x, y) && !g.fieldAt(x, y) && !g.cropAt(x, y) && !g.stackAt(x, y) && !g.zoneAt(g.i(x, y));

/** The planner (planner.js planSettlement): maybe lay the next stretch of road. Returns the tiles started, or 0. */
export function planRoads(g, P, sid) {
  const s = g.s, st = s.settlements?.[sid];
  if (!st || st.fallen) return 0;
  const tpl = g.reg.get('template', 'core:road_run');
  if (!tpl) return 0;
  const mine = g.owned('structures', sid).filter((b) => g.bDef(b)?.road);
  if (mine.some((b) => !b.built) || mine.length >= ROAD.max) return 0; // one stretch at a time; a cap
  return planLocalRoad(g, sid, st, tpl, mine) || planTradeRoad(g, sid, st, tpl, mine);
}

function planLocalRoad(g, sid, st, tpl, mine) {
  const s = g.s, T = st.traffic;
  if (!T || g.owned('colonists', sid).length < ROAD.minPeople) return 0;
  const c = st.center || s.center;
  let best = null;
  for (const k of Object.keys(T).sort()) {
    const [cx, cy] = k.split(',').map(Number), x = cx * ROAD.cell + 1, y = cy * ROAD.cell + 1;
    if (Math.hypot(x - c.x, y - c.y) < ROAD.far || T[k] < ROAD.busy) continue;
    if (!best || T[k] > best.n) best = { k, n: T[k], x, y };
  }
  if (!best) return 0;
  const path = findPath(g, c.x, c.y, best.x, best.y, 'adj', 20000);
  if (!path?.length) return 0;
  const tiles = [];
  for (const p of path) {
    if (tiles.length >= Math.min(ROAD.segment, ROAD.max - mine.length)) break;
    if (roadOpen(g, p.x, p.y, sid)) tiles.push(p);
  }
  if (!tiles.length) return 0;
  for (const p of tiles) createProject(g, tpl, { x: p.x, y: p.y, rot: 0 }, { urgency: 0.3, why: 'Road', owner: sid });
  g.log(`The colonists of ${st.name} are laying a road (${tiles.length} section${tiles.length === 1 ? '' : 's'}) where they walk most (${best.n} walkers counted there).`, 'build', null, 0, { kind: 'core:road', sids: [sid], at: tiles[0] });
  return tiles.length;
}

// ---------- trade roads (slice 3) ----------
// A village with a trade pact and at least TRADE_ROAD.trades completed trades with a partner within TRADE_ROAD.range
// tiles lays its own part of a road toward it (toward one partner only, the one it trades with most): up to ROAD.segment tiles a stretch, on its own land, starting from its
// centre. No minimum of people (a trade road serves both villages). Looked at on one day in TRADE_ROAD.everyDays
// (by village, from the tick: no saved state), as the long path search is not cheap.
export const TRADE_ROAD = Object.freeze({ trades: 3, range: 160, everyDays: 3, nodes: 60000 });
const hash = (str) => { let h = 2166136261; for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

function planTradeRoad(g, sid, st, tpl, mine) {
  const s = g.s, day = Math.floor(s.tick / TICKS_PER_DAY);
  if ((day + (hash(sid) % TRADE_ROAD.everyDays)) % TRADE_ROAD.everyDays) return 0;
  const c = st.center || s.center;
  // Toward one partner only: the one it has traded with most (ties: the lower id), so roads do not fan out to every
  // pact partner (a World run laid 2,000 road tiles in 175 days that way).
  let pick = null;
  for (const o of Object.keys(s.settlements).sort()) {
    const ot = s.settlements[o];
    if (o === sid || ot.fallen || !ot.center || !hasPact(g, sid, o)) continue;
    const n = completedTradesBetween(g, sid, o);
    if (n < TRADE_ROAD.trades || Math.hypot(ot.center.x - c.x, ot.center.y - c.y) > TRADE_ROAD.range) continue;
    if (!pick || n > pick.n) pick = { o, n };
  }
  for (const o of pick ? [pick.o] : []) {
    const ot = s.settlements[o];
    const path = findPath(g, c.x, c.y, ot.center.x, ot.center.y, 'adj', TRADE_ROAD.nodes);
    if (!path?.length) continue;
    const tiles = [];
    for (const p of path) {
      if (tiles.length >= Math.min(ROAD.segment, ROAD.max - mine.length)) break;
      if (g.claimOk(sid, p.x, p.y) && roadOpen(g, p.x, p.y, sid)) tiles.push(p);
    }
    if (!tiles.length) continue;
    for (const p of tiles) createProject(g, tpl, { x: p.x, y: p.y, rot: 0 }, { urgency: 0.3, why: 'Trade road', owner: sid });
    const n = completedTradesBetween(g, sid, o);
    g.log(`The colonists of ${st.name} are laying a road toward ${ot.name} (${tiles.length} section${tiles.length === 1 ? '' : 's'}; a trade pact, ${n} trades).`, 'build', null, 0, { kind: 'core:road', sids: [sid, o], at: tiles[0] });
    return tiles.length;
  }
  return 0;
}

// ---------- caravans on roads (slice 3's open point, 2026-11-04) ----------
// A distant caravan travels abstractly (lod.js), its time fixed when it sets out from the straight distance. The
// share of that line, sampled every CARAVAN_ROAD.every tiles, that runs within CARAVAN_ROAD.near tiles of a built
// road shortens it as a road step does: time × (1 − share × (1 − step)).
export const CARAVAN_ROAD = Object.freeze({ every: 2, near: 2 });

/** How much of the straight way from a to b lies along built roads (0 to 1), and the road's step: { share, step }. */
export function roadShare(g, a, b) {
  const len = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  if (len < 1) return { share: 0, step: 1 };
  let on = 0, n = 0, step = 1;
  for (let k = 0; k <= len; k += CARAVAN_ROAD.every) {
    const x = Math.round(a.x + ((b.x - a.x) * k) / len), y = Math.round(a.y + ((b.y - a.y) * k) / len);
    n++;
    let hit = null;
    for (let dy = -CARAVAN_ROAD.near; dy <= CARAVAN_ROAD.near && !hit; dy++) for (let dx = -CARAVAN_ROAD.near; dx <= CARAVAN_ROAD.near && !hit; dx++) {
      if (!g.inB(x + dx, y + dy)) continue;
      const id = g.structIdAt(g.i(x + dx, y + dy)), st = id && g.s.structures[id];
      if (st?.built && g.bDef(st)?.road) hit = g.bDef(st).road;
    }
    if (hit) { on++; step = Math.min(step, hit.step); }
  }
  return { share: on / n, step };
}

/** Caravan ticks from a to b given roads on the way (lod.js). */
export function caravanRoadTicks(g, a, b, ticks) {
  const r = roadShare(g, a, b);
  return r.share > 0 ? Math.max(1, Math.round(ticks * (1 - r.share * (1 - r.step)))) : ticks;
}
