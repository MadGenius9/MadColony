// Level of detail (Phase 1, slice 3). On big worlds, villages far from the player's view run "abstract":
// their colonists are not ticked one by one; instead, once per game hour, the village's people eat, rest
// and work in aggregate with the same rules and the same item functions as the jobs (createItems, consume,
// takeFromStack, placeItems, with the same ledger reasons). Classic worlds (!g.big) never switch.
// See docs/proposals/phase-1-big-world.md, "Slice 3, detailed interface".
//
// Cost (big worlds only; classic worlds return at once):
// - every tick: one pass over the village ids (war with the player, attacks by full villages, from a set
//   built once per tick from state.military), and the caravans only when there are some;
// - the switching check every 600 ticks (and on the first tick): O(villages), plus endJob and a walk home
//   (a spiral of at most 41x41 tiles) for each colonist of a village that goes abstract;
// - one abstract hour per abstract village per 100 ticks: one pass over s.colonists, s.structures, s.projects
//   and s.fields to find the village's own (there is no per-settlement index yet); its stacks from its
//   stockpile tiles and the 41x41 tiles round its centre; nodes from the chunk index (g.nodesNear, cached
//   per item for the hour); g.promisedQty once per item per hour (it walks the active trade legs and the
//   colonists); and adults x tasks, each availability check O(the village's stacks of that item).
// Measured on Colossal (seed 7): about 0.25 ms per tick in total with 30 villages.
import { MOVE_TICKS, TICKS_PER_DAY } from './constants.js';
import { octile, rings } from './util.js';
import { endJob } from './ai/ai.js';
import { workSpeed, practice } from './ai/jobs.js';
import { GROUND_REST_RATE } from './ai/needs.js';
import { tickHealth, isDown } from './health.js';
import { isAdult, mayDoWork, needsCare } from './people.js';
import { isEnemy, orderOf } from './combat.js';
import { spreadContact } from './illness.js';
import { completeStructure, completeRenovation, materialsComplete, partEligible, workOrderOf } from './construction.js';
import { completeTech, settlementOf } from './research.js';
import { legRemaining, deliverLeg } from './villages.js';
import { tapHasWater, isWaterNode } from './water.js';
import { fieldCells } from './game.js';
import { planNow } from './planner.js';

export { deliverLeg }; // shared by the trade job and caravans

export const LOD = {
  checkEvery: 600, checkAt: 300, nearRadius: 64, minHoldTicks: 2400, hour: 100,
  firstCheck: 1, // big worlds also check on their first tick, so far villages never start out in full
  // Work-time share per task. For construct, bills, farm and gather it scales work speed: the part of a
  // worker's time at full detail that is real work rather than walking to the site, fetching ingredients,
  // queueing for a station or hauling the yield home (construction carrying trips and the walk to a node
  // are charged separately, by distance). For research it caps the ticks per worker-hour spent at the
  // desk: full-detail colonists research at full speed but rarely, since research has low urgency.
  // Measured: Colossal Living world, 12 villages (10 profiles), seeds 7 and 11, 10 game days from tick 0;
  // each village once held at full detail and once abstract; totals over the 11 AI villages, abstract/full:
  //   seed 7:  gathered 1.05, crafted 1.12, construction used 1.02, harvested 1.03, sown 1.06, research 0.87
  //   seed 11: gathered 1.04, crafted 1.11, construction used 1.03, harvested 1.22, sown 1.18, research 0.92
  //   (food eaten 1.13 / 1.22; seed 11's full run includes a village whose people collapsed from thirst).
  share: { research: 0.085, construct: 0.7, bills: 0.73, farm: 0.8, gather: 0.57 },
};
const STACK_RADIUS = 20; // tiles round the centre searched for the village's goods (items overflow up to here)
const SHORT = 1e-9;

const hash = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
/** Stable per-village offset (0..99) so abstract villages don't all run in the same tick. */
export const stagger = (sid) => hash(sid) % LOD.hour;
/** Big worlds: the tick (mod PLAN_INTERVAL) on which a full AI village is planned, so villages don't all
 *  plan in the same tick. */
export const planOffset = (sid, interval) => hash('plan:' + sid) % interval;

export function detailOf(g, sid) { return g.s.settlements?.[sid]?.detail === 'abstract' ? 'abstract' : 'full'; }
export const isAbstract = (g, sid) => g.s.settlements?.[sid]?.detail === 'abstract';

const playerOf = (g) => g.s.playerSettlement;
const centerOf = (g, sid) => settlementOf(g, sid)?.center || g.s.center;
const nameOf = (g, sid) => settlementOf(g, sid)?.name || sid;
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Why a village should be at full detail, or null (abstract). */
function fullReason(g, sid) {
  const player = playerOf(g);
  if (sid === player) return "it is the player's village";
  const c = centerOf(g, sid), p = centerOf(g, player);
  if (c && p && Math.hypot(c.x - p.x, c.y - p.y) <= LOD.nearRadius) return 'it is near the player';
  if (g.s.watch === sid) return 'the player is watching it';
  if (isEnemy(g, sid, player)) return 'it is at war with the player';
  if (attackedByFull(g, sid)) return 'it is under attack';
  return null;
}
/** Is a village simulated in full ordering an attack on sid? (Being attacked, not merely being at war, so
 *  promotions don't chain through alliances of enemies.) */
function attackedByFull(g, sid) {
  const m = g.s.military;
  if (!m) return false;
  if (!g._lodAtk || g._lodAtk.tick !== g.s.tick) { // targets of full villages' attacks, once per tick
    const set = new Set();
    for (const o of Object.keys(m)) { const ord = orderOf(g, o); if (ord.order === 'attack' && ord.target && !isAbstract(g, o)) set.add(ord.target + '<' + o); }
    g._lodAtk = { tick: g.s.tick, set, targets: new Set([...set].map((k) => k.split('<')[0])) };
  }
  if (!g._lodAtk.targets.has(sid)) return false;
  for (const k of g._lodAtk.set) { const [t, o] = k.split('<'); if (t === sid && o !== sid) return true; }
  return false;
}
/** Promote at once, ignoring the hold: a war with the player, or an attack by a village simulated in full. */
function urgentFull(g, sid) {
  if (isEnemy(g, sid, playerOf(g))) return 'it is at war with the player';
  if (attackedByFull(g, sid)) return 'it is under attack';
  return null;
}
export function wantDetail(g, sid) { return fullReason(g, sid) ? 'full' : 'abstract'; }

/** The village the player is watching (explicit player input, applied at the next LOD check). */
export function setWatch(g, sid) {
  if (sid && g.s.settlements?.[sid]) g.s.watch = sid;
  else delete g.s.watch;
}

/** Switch a village's level of detail now. Going abstract ends every job of its colonists (carried goods
 *  are dropped, reservations released); going full needs nothing, everything is already real. */
export function setDetail(g, sid, level, why = '') {
  const st = settlementOf(g, sid);
  if (!st || (level !== 'full' && level !== 'abstract')) return;
  if (level === 'abstract') {
    const cols = Object.values(g.s.colonists).filter((x) => (x.settlementId || playerOf(g)) === sid).sort(byId);
    for (const c of cols) {
      endJob(g, c, null, 'The village is far from view');
      c.mv = null; c.path = null; c.sleeping = false; c.idle = 0;
      c.status.goal = 'Living at home'; c.status.action = 'The village is far from view: it is simulated by the hour';
    }
    goHome(g, sid, cols);
    st.abs ||= { craft: {}, gather: {} };
  }
  st.detail = level;
  st.detailSince = g.s.tick;
  // Big worlds: a village going full plans on the next tick; one going abstract keeps its plan and replans at
  // its own slot or abstract hour (planner.js replanLater), so many switches at once do not all plan in one tick.
  if (level === 'full') { (g.replanSids ||= new Set()).add(sid); g.replanLater?.delete(sid); }
  else (g.replanLater ||= new Set()).add(sid);
  g.log(level === 'abstract' ? `${st.name} is now simulated at a distance${why ? ` (${why})` : ''}.` : `${st.name} is simulated in full detail${why ? ` (${why})` : ''}.`, 'info');
  g.planDirty = true;
}

/** Everyone goes home: each colonist (id order) to the nearest free walkable tile round the village centre
 *  (spiral order), never onto another colonist, a building site or ground cut off from the centre, so nobody
 *  stays frozen on another village's land or mid-road. Who finds no such tile stays where they are. */
function goHome(g, sid, cols) {
  if (!cols.length) return;
  const c0 = centerOf(g, sid);
  const home = g.regionOf(c0.x, c0.y);
  const taken = new Set();
  for (const o of Object.values(g.s.colonists)) if ((o.settlementId || playerOf(g)) !== sid) taken.add(o.x + ',' + o.y);
  // Patients stay in their medical bed, and infants and sleepers in their own bed (moved onto it if they
  // were lifted off it); those tiles are kept for them before anyone else is placed.
  const stay = new Set();
  for (const c of cols) {
    const med = c.medBedId && g.s.structures[c.medBedId];
    const bed = c.bedId && g.s.structures[c.bedId];
    const spot = med?.built ? med : bed?.built && ((c.x === bed.x && c.y === bed.y) || needsCare(g, c)) ? bed : null;
    if (!spot) continue;
    c.x = spot.x; c.y = spot.y;
    taken.add(c.x + ',' + c.y); stay.add(c.id);
  }
  for (const c of cols) {
    if (stay.has(c.id)) continue;
    for (const [x, y] of rings(c0.x, c0.y, STACK_RADIUS)) {
      const k = x + ',' + y;
      if (!g.inB(x, y) || taken.has(k) || !g.isPassable(x, y)) continue;
      const foot = g.footAt(x, y);
      if (foot && foot.status === 'active') continue;
      const b = g.structAt(x, y);
      if (b && !b.built) continue;
      if (home >= 0 && g.regionAt(g.i(x, y)) !== home) continue;
      c.x = x; c.y = y; taken.add(k);
      break;
    }
  }
}

function sortedVillageIds(g) {
  const n = Object.keys(g.s.settlements || {}).length;
  if (!g._lodIds || g._lodIds.n !== n) g._lodIds = { n, ids: Object.keys(g.s.settlements || {}).sort() };
  return g._lodIds.ids;
}

/** Called from Game.tick before colonists are ticked. */
export function tickLOD(g) {
  if (!g.big) return;
  const s = g.s, player = playerOf(g);
  const ids = sortedVillageIds(g);
  // Switching.
  if (s.tick % LOD.checkEvery === LOD.checkAt || s.tick === LOD.firstCheck) {
    for (const sid of ids) {
      if (sid === player) continue;
      const st = s.settlements[sid];
      const why = fullReason(g, sid);
      const want = why ? 'full' : 'abstract';
      if (want === detailOf(g, sid)) continue;
      const young = st.detailSince !== undefined && s.tick - st.detailSince < LOD.minHoldTicks;
      if (young && !(want === 'full' && urgentFull(g, sid))) continue;
      setDetail(g, sid, want, why || 'it is far from the player');
    }
  } else {
    // A war with the player, or an attack by a full village, promotes at once, ignoring the hold.
    for (const sid of ids) {
      if (sid === player || !isAbstract(g, sid)) continue;
      const why = urgentFull(g, sid);
      if (why) setDetail(g, sid, 'full', why);
    }
  }
  // Abstract hours, staggered by village.
  const h = s.tick % LOD.hour;
  for (const sid of ids) if (isAbstract(g, sid) && stagger(sid) === h) abstractHour(g, sid);
  // Caravans.
  if (s.caravans) tickCaravans(g);
}

// ---------------------------------------------------------------- the village's goods
/** The village's own stacks: on its stockpile and on the tiles round its centre, in id order. New stacks
 *  made during the hour are picked up from the ids allocated since (stack ids come from s.nextId).
 *  Availability is counted here, once per hour, instead of through g.availQty (whose trade holds walk
 *  every trade leg and every colonist on each call): a stack's units minus job reservations, and per item
 *  the village's total minus what it has promised to active trades (g.promisedQty, once per item per hour). */
function villageStore(g, sid) {
  const player = playerOf(g);
  const ctr = centerOf(g, sid);
  const seen = new Set();
  const list = [];
  const add = (st) => { if (st && !seen.has(st.id) && (st.settlement || player) === sid) { seen.add(st.id); list.push(st); } };
  for (const k of g.stockpileOf(sid)) { const [x, y] = k.split(',').map(Number); if (g.inB(x, y)) add(g.stackAt(x, y)); }
  for (const [x, y] of rings(ctr.x, ctr.y, STACK_RADIUS)) if (g.inB(x, y)) add(g.stackAt(x, y));
  list.sort(byId);
  let mark = g.s.nextId;
  const promised = new Map();
  const anyTrades = g.activeTrades().length > 0;
  const store = {
    /** Live stacks in id order. */
    stacks() {
      if (g.s.nextId !== mark) {
        for (let n = mark; n < g.s.nextId; n++) add(g.s.stacks['s' + n]);
        mark = g.s.nextId;
        list.sort(byId);
      }
      let k = 0;
      for (const st of list) if (g.s.stacks[st.id] === st) list[k++] = st;
      list.length = k;
      return list;
    },
    /** Units of a stack not reserved by a job. */
    avail(st) { return g.s.stacks[st.id] === st ? Math.max(0, st.qty - g.reservedQty(st.id)) : 0; },
    /** Units of an item (without wear) the village may use for itself: not reserved, not promised to trades. */
    free(item) {
      let n = 0;
      for (const st of store.stacks()) if (st.item === item && st.dur === undefined) n += store.avail(st);
      if (anyTrades) {
        if (!promised.has(item)) promised.set(item, g.promisedQty(sid, item));
        n -= promised.get(item);
      }
      return Math.max(0, n);
    },
  };
  return store;
}

/** Choose the stacks for a list of inputs ({item} or {tag}, qty) without taking anything: stacks in id
 *  order, never below the seed reserve or into goods promised to trades. Returns [{st, qty}] or null. */
function planInputs(g, store, inputs, reserve) {
  const usable = new Map();
  const use = (it) => { if (!usable.has(it)) usable.set(it, store.free(it) - (reserve[it] || 0)); return usable.get(it); };
  const fromStack = new Map();
  const plan = [];
  for (const inp of inputs) {
    let need = inp.qty;
    for (const st of store.stacks()) {
      if (need <= 0) break;
      if (st.dur !== undefined || (inp.item ? st.item !== inp.item : !g.reg.itemHasTag(st.item, inp.tag))) continue;
      const q = Math.min(need, store.avail(st) - (fromStack.get(st.id) || 0), use(st.item));
      if (q <= 0) continue;
      plan.push({ st, qty: q });
      fromStack.set(st.id, (fromStack.get(st.id) || 0) + q);
      usable.set(st.item, use(st.item) - q);
      need -= q;
    }
    if (need > 0) return null;
  }
  return plan;
}
/** Take planned inputs (all of them are there: planInputs just checked). Returns [{item, qty}] taken. */
function takePlanned(g, plan) {
  const out = [];
  for (const { st, qty } of plan) {
    const got = g.takeFromStack(st.id, qty);
    const o = out.find((x) => x.item === got.item);
    if (o) o.qty += got.qty; else out.push({ item: got.item, qty: got.qty });
  }
  return out;
}

// ---------------------------------------------------------------- one abstract hour
/** One game hour of an abstract village: needs and health, labour, caravans (in this order). */
export function abstractHour(g, sid) {
  const st = settlementOf(g, sid);
  if (!st) return;
  if (g.replanLater?.has(sid)) planNow(g, sid); // its hour comes before its planning slot (planner.js)
  const prevActor = g.actor;
  g.actor = sid;
  try {
    st.abs ||= { craft: {}, gather: {} };
    st.abs.craft ||= {}; st.abs.gather ||= {};
    const player = playerOf(g);
    const cols = g.owned('colonists', sid).sort(byId);
    const store = villageStore(g, sid);
    const own = (e) => (e?.settlement || player) === sid;
    const structs = g.owned('structures', sid).sort(byId);
    hourNeeds(g, sid, cols, store, structs);
    hourLabour(g, sid, cols, store, structs, own);
    hourCaravans(g, sid, store);
  } finally { g.actor = prevActor; }
}

function hasWater(g, sid, structs) {
  for (const b of structs) {
    if (!b.built) continue;
    const def = g.bDef(b);
    if (!def?.water) continue;
    if (def.water.tap ? tapHasWater(g, b) : !isWaterNode(def)) return true;
  }
  // A drinkable shore within walking reach of the centre: the same rule the planner uses at full detail
  // (game.js waterOnFoot, WATER_REACH_WALK), so a village does not change its mind when it changes detail.
  const c = centerOf(g, sid);
  return !!c && g.waterOnFoot(c.x, c.y).reachable;
}

function hourNeeds(g, sid, cols, store, structs) {
  const reg = g.reg;
  const hour = Math.floor(g.hour);
  const night = hour >= 22 || hour < 6;
  const water = hasWater(g, sid, structs);
  const reserve = g.plans?.[sid]?.seedReserve || {};
  const energyDef = reg.all('need').find((n) => n.behavior === 'core:sleep');
  for (const c of cols) {
    // Asleep this hour: at night, or by day when worn out (below seekBelow), as a detailed colonist would go
    // to rest then; otherwise energy would drift to zero for anyone resting only on the ground at night.
    // Such an hour is not taken out of hourLabour: the work shares (LOD.share) were measured against full-detail
    // colonists over the whole working day, rest included, so the time is already allowed for there (taking it
    // out again cut abstract production in tests/lod-rates.test.js, seed 7, from -21% to -26%).
    const asleep = night || (!!energyDef && (c.needs[energyDef.id] ?? 1) < energyDef.seekBelow);
    for (const def of reg.all('need')) {
      const drop = (def.decayPerDay / 24) * (asleep && (def.behavior === 'core:eat' || def.behavior === 'core:drink') ? (def.sleepDecayMult ?? 1) : 1);
      const v = c.needs[def.id] ?? 1;
      if (def.behavior === 'core:drink') c.needs[def.id] = water ? 1 : Math.max(0, v - drop);
      else if (def.behavior === 'core:shelter') {
        const home = c.homeId && g.s.homes[c.homeId];
        const v0 = c.needs[def.id] ?? 0.5;
        c.needs[def.id] = home?.complete ? Math.min(1, v0 + 2 * drop) : Math.max(0, v0 - drop);
      } else if (def.behavior === 'core:sleep') {
        // At night they sleep: in their bed, or on the ground at the ground rate (as the sleep job does).
        const bed = c.bedId && g.s.structures[c.bedId];
        const rate = (bed?.built && g.bDef(bed)?.bed?.restRate) || GROUND_REST_RATE;
        if (asleep) c.needs[def.id] = Math.min(1, v + (rate * 100) / TICKS_PER_DAY);
        else c.needs[def.id] = Math.max(0, v - drop);
      } else c.needs[def.id] = Math.max(0, v - drop); // core:eat and anything else that decays
    }
    const hunger = reg.all('need').find((n) => n.behavior === 'core:eat');
    if (hunger && c.needs[hunger.id] < hunger.seekBelow) {
      for (let k = 0; k < 3 && c.needs[hunger.id] < 0.75; k++) {
        const food = pickFood(g, store, reserve);
        if (!food) break;
        const d = reg.get('item', food.item);
        const got = g.takeFromStack(food.id, 1);
        if (!got || got.qty < 1) break;
        g.consume(got.item, 1, 'eat');
        c.needs[hunger.id] = Math.min(1, c.needs[hunger.id] + (d?.nutrition || 0));
      }
    }
    // Health runs on a 25-tick step; an hour is four of those steps.
    for (let k = 0; k < 4; k++) tickHealth(g, c, true);
  }
}

/** Like findFood: prepared meals first, then raw food above the seed reserve; stacks in id order. */
function pickFood(g, store, reserve) {
  const reg = g.reg;
  const free = new Map();
  const freeOf = (it) => { if (!free.has(it)) free.set(it, store.free(it)); return free.get(it); };
  let raw = null;
  for (const st of store.stacks()) {
    const d = reg.get('item', st.item);
    if (!d?.nutrition || st.dur !== undefined || store.avail(st) < 1 || freeOf(st.item) < 1) continue;
    if (d.tags?.includes('core:meal')) return st;
    if (!raw && freeOf(st.item) - (reserve[st.item] || 0) >= 1) raw = st;
  }
  return raw;
}

// ---------------------------------------------------------------- labour
function hourLabour(g, sid, cols, store, structs, own) {
  const hour = Math.floor(g.hour);
  if (hour < 6 || hour >= 21) return;
  const P = g.plans?.[sid];
  if (!P) return;
  const workers = cols.filter((c) => isAdult(g, c) && !isDown(c));
  if (!workers.length) return;
  const A = settlementOf(g, sid).abs.gather;
  for (const id of Object.keys(A)) if (!g.s.nodes[id]) delete A[id]; // work on a node that is gone is lost, as for a job
  const ctx = makeContext(g, sid, store, structs, own, P);
  const tasks = [taskResearch, taskConstruct, taskBills, taskFarm, taskGather];
  for (const c of workers) {
    let time = LOD.hour;
    for (const task of tasks) {
      if (time <= SHORT) break;
      time -= task(g, ctx, c, time);
    }
  }
}

function makeContext(g, sid, store, structs, own, P) {
  const reg = g.reg;
  const st = settlementOf(g, sid);
  return {
    sid, st, store, structs, own, P, reg,
    center: centerOf(g, sid),
    researchers: 0,
    haulDebt: 0, // ticks of an unfinished carry, owed by the next construction worker this hour
    reserve: P.seedReserve || {},
    projects: g.owned('projects', sid).filter((p) => p.status === 'active' || p.renovating).sort(byId),
    fields: g.owned('fields', sid).sort(byId),
    nodeCands: new Map(),
  };
}

/** g.wouldTrap for a wall this hour, remembered while nothing it depends on has changed: walkability
 *  (g.passRev; a check puts it back as it was), structures added, removed or finished (structRev, builtRev).
 *  Nobody moves during a village's hour, so the answer is the same. */
function trapsSomeone(g, ctx, st) {
  const key = () => `${g.passRev || 0}|${g.structRev || 0}|${g.builtRev || 0}`;
  const memo = (ctx.trapMemo ||= new Map());
  const e = memo.get(st.id);
  if (e && e.key === key()) return e.v;
  const v = g.wouldTrap(st.x, st.y, ctx.sid);
  memo.set(st.id, { key: key(), v });
  return v;
}

/** Work `time` ticks at `speed` toward `left` work: returns [time used, work done, finished]. */
function spend(time, speed, left) {
  if (speed <= 0) return [0, 0, false];
  const need = left / speed;
  if (need <= time + SHORT) return [Math.min(time, need), left, true];
  return [time, time * speed, false];
}
const can = (g, c, wt) => !c.workOff?.[wt] && mayDoWork(g, c, wt);
function practiceFor(g, c, wt, skill, ticks, share = 1) {
  const n = Math.round(ticks * share); // only the ticks really spent working
  for (let k = 0; k < n; k++) practice(g, c, wt, skill);
}
/** Create items at the village (its stockpile first), owned by the village. */
const makeItems = (g, ctx, item, qty, reason, dur) => g.createItems(item, qty, ctx.center.x, ctx.center.y, reason, dur, true);

// Research: the plan's current tech, at a built research station, costs paid (from stock when possible).
function taskResearch(g, ctx, c, time) {
  const R = ctx.P.research;
  if (!R?.allowed || !R.tech) return 0;
  const wt = 'core:research';
  if (!can(g, c, wt)) return 0;
  if (ctx.researchers >= (g.policyFor(ctx.sid).maxResearchers ?? 2)) return 0;
  const tech = g.reg.get('tech', R.tech);
  const Rs = ctx.st.research;
  if (!tech || Rs.done.includes(tech.id) || (Rs.priorities?.[tech.field] ?? 2) <= 0) return 0;
  if (Rs.current && Rs.current !== tech.id) return 0;
  const station = ctx.structs.find((b) => b.built && g.bDef(b)?.research);
  if (!station) return 0;
  if (!Rs.paid[tech.id] && (tech.cost || []).length) {
    const plan = planInputs(g, ctx.store, tech.cost.map((k) => ({ item: k.item, qty: k.qty })), ctx.reserve);
    if (!plan) return 0;
    for (const got of takePlanned(g, plan)) g.consume(got.item, got.qty, 'research');
    Rs.paid[tech.id] = true;
  }
  const speed = workSpeed(g, c, wt, 'core:research') * (g.bDef(station).research?.speed || 1);
  const left = tech.research - (Rs.progress[tech.id] || 0);
  if (left <= 0) { completeTech(g, ctx.sid, tech.id); return 0; }
  ctx.researchers++;
  // Research share is a cap on time, not speed: at full detail researchers sit at the desk at full speed,
  // but research loses most hours to more urgent work; the rest of the hour goes to the next tasks.
  const [used, work, done] = spend(Math.min(time, LOD.hour * LOD.share.research), speed, left);
  Rs.progress[tech.id] = done ? tech.research : (Rs.progress[tech.id] || 0) + work;
  practiceFor(g, c, wt, 'core:research', used);
  if (done) completeTech(g, ctx.sid, tech.id);
  return used;
}

// Construction: clear what the plan wants cleared, then active projects in id order, parts in build order.
function taskConstruct(g, ctx, c, time) {
  let used = 0;
  used += clearNodes(g, ctx, c, time - used);
  if (time - used <= SHORT || !can(g, c, 'core:construct')) return used;
  if (ctx.haulDebt > 0) { const d = Math.min(ctx.haulDebt, time - used); ctx.haulDebt -= d; used += d; } // the rest of a long carry
  if (time - used <= SHORT) return used;
  for (const p of ctx.projects) {
    if ((p.status !== 'active' && !p.renovating)) continue;
    for (const id of p.parts) {
      if (time - used <= SHORT) return used;
      const st = g.s.structures[id];
      if (!st || (st.built && !st.reno)) continue;
      if (!st.built && !partEligible(g, st)) continue;
      const wo = workOrderOf(g, st);
      if (!wo?.def) continue;
      // Materials: carried from the village's stacks onto the site (they stay in the census as delivered).
      // Each trip costs the walk there and back, as hauling does at full detail; a trip longer than what is
      // left of this worker's hour is finished by the next construction worker (ctx.haulDebt).
      for (const cost of wo.def.cost) {
        for (const s of ctx.store.stacks()) {
          if (s.item !== cost.item || s.dur !== undefined) continue;
          while (time - used > SHORT) {
            const need = cost.qty - (wo.delivered[cost.item] || 0);
            const q = Math.min(need, ctx.store.avail(s), ctx.store.free(cost.item), g.carryLimit(cost.item));
            if (q <= 0 || g.s.stacks[s.id] !== s) break;
            const trip = 2 * Math.max(1, octile(s.x, s.y, st.x, st.y)) * MOVE_TICKS;
            const u = Math.min(trip, time - used);
            used += u; ctx.haulDebt += trip - u;
            const got = g.takeFromStack(s.id, q);
            wo.delivered[cost.item] = (wo.delivered[cost.item] || 0) + got.qty;
          }
          if (cost.qty - (wo.delivered[cost.item] || 0) <= 0 || time - used <= SHORT) break;
        }
      }
      if (!materialsComplete(g, st)) continue;
      if (st.built) { // renovation
        const to = wo.def;
        const speed = workSpeed(g, c, 'core:construct', to.skill) * LOD.share.construct;
        const [u, work, done] = spend(time - used, speed, to.work - (st.reno.progress || 0));
        st.reno.progress = done ? to.work : (st.reno.progress || 0) + work;
        practiceFor(g, c, 'core:construct', to.skill, u, LOD.share.construct);
        used += u;
        if (done) completeRenovation(g, st, null);
        continue;
      }
      const def = wo.def;
      if (g.nodeAt(st.x, st.y)) continue; // cleared first (the plan lists it)
      const loose = g.stackAt(st.x, st.y);
      if (loose) { // goods lying on the site are moved to the village's store
        if (!ctx.own(loose) || g.reservedQty(loose.id) > 0) continue;
        const got = g.takeFromStack(loose.id, loose.qty);
        g.placeItems(got.item, got.qty, ctx.center.x, ctx.center.y, got.dur, true);
        if (g.stackAt(st.x, st.y)) continue;
      }
      const speed = workSpeed(g, c, 'core:construct', def.skill) * LOD.share.construct;
      const left = def.work - (st.progress || 0);
      const [u, work, done] = spend(time - used, speed, left);
      if (done && !def.passable && (g.colonistAt(st.x, st.y) || trapsSomeone(g, ctx, st))) continue; // can't finish it now
      st.progress = done ? def.work : (st.progress || 0) + work;
      practiceFor(g, c, 'core:construct', def.skill, u, LOD.share.construct);
      used += u;
      if (done) completeStructure(g, st, null);
    }
  }
  return used;
}

/** Work a node to the end of its chunks (or one chunk); yields created at the village. Returns time used. */
function workNode(g, ctx, c, node, time, clear, onChunk, share = LOD.share.gather) {
  const def = g.nodeDef(node);
  const wtDef = g.reg.get('workType', def.workType);
  const speed = workSpeed(g, c, def.workType, wtDef?.skill) * share;
  const A = ctx.st.abs.gather;
  // Walking: at full detail a gatherer walks out to the node and its yield is carried home, so each chunk
  // also costs about the distance in walking ticks (out and back, shared by the chunks of a trip). It is
  // charged as extra work on the chunk, so far nodes cost more than near ones.
  const chunkWork = def.work + Math.max(1, octile(ctx.center.x, ctx.center.y, node.x, node.y)) * MOVE_TICKS;
  let used = 0;
  while (time - used > SHORT && g.s.nodes[node.id] === node && !(node.empty && !clear)) {
    const [u, work, done] = spend(time - used, speed, chunkWork - (A[node.id] || 0));
    used += u;
    practiceFor(g, c, def.workType, wtDef?.skill, u, share);
    if (!done) { A[node.id] = (A[node.id] || 0) + work; break; }
    delete A[node.id];
    if (node.empty) { g.removeNode(node.id); break; } // clearing an already-picked plant
    for (const y of def.yields) makeItems(g, ctx, y.item, y.qty, 'gather');
    onChunk?.(def);
    node.chunks--;
    if (node.chunks <= 0) {
      if (def.regrowDays && !clear) g.nodeEmptied(node);
      else g.removeNode(node.id);
      break;
    }
    if (onChunk && onChunk.stop?.()) break;
  }
  return used;
}

function clearNodes(g, ctx, c, time) {
  const clr = ctx.P.clear;
  if (!clr?.size) return 0;
  let used = 0;
  for (const id of clr.keys()) {
    if (time - used <= SHORT) break;
    const node = g.s.nodes[id];
    if (!node || g.isReserved('node:' + id)) continue; // someone (another village's gatherer) is working it
    const def = g.nodeDef(node);
    if (!def || !can(g, c, def.workType) || !g.gatherOk(ctx.sid, node)) continue;
    used += workNode(g, ctx, c, node, time - used, true, null, LOD.share.construct);
  }
  return used;
}

// Bills: at a built station of the village, when all inputs are on hand.
function taskBills(g, ctx, c, time) {
  let used = 0;
  const A = ctx.st.abs.craft;
  for (const bill of ctx.P.bills || []) {
    while (time - used > SHORT && bill.remaining > 0) {
      const rec = g.reg.get('recipe', bill.recipe);
      if (!rec || !can(g, c, rec.workType)) break;
      if (rec.minSkill && (c.skills[rec.skill] || 0) < rec.minSkill) break;
      if (!ctx.structs.some((b) => b.built && b.def === rec.station)) break;
      const plan = planInputs(g, ctx.store, rec.inputs, ctx.reserve);
      if (!plan) break;
      const speed = workSpeed(g, c, rec.workType, rec.skill) * LOD.share.bills;
      const [u, work, done] = spend(time - used, speed, rec.work - (A[rec.id] || 0));
      used += u;
      practiceFor(g, c, rec.workType, rec.skill, u, LOD.share.bills);
      if (!done) { A[rec.id] = (A[rec.id] || 0) + work; break; }
      delete A[rec.id];
      for (const got of takePlanned(g, plan)) g.consume(got.item, got.qty, 'craft');
      for (const o of rec.outputs) {
        const eq = g.reg.get('item', o.item)?.equipment;
        if (eq) for (let k = 0; k < o.qty; k++) makeItems(g, ctx, o.item, 1, 'craft', eq.durability);
        else makeItems(g, ctx, o.item, o.qty, 'craft');
      }
      bill.remaining--;
    }
    if (time - used <= SHORT) break;
  }
  return used;
}

// Farming: harvest ripe crops, then sow empty tiles (when the plan allows sowing).
function taskFarm(g, ctx, c, time) {
  const wt = 'core:farm', skill = 'core:farming';
  if (!can(g, c, wt) || !ctx.fields.length) return 0;
  const speed = workSpeed(g, c, wt, skill) * LOD.share.farm;
  if (speed <= 0) return 0;
  let used = 0;
  for (const f of ctx.fields) {
    if (!g.s.fields[f.id]) continue;
    for (const [x, y] of fieldCells(f)) {
      const cr = g.cropAt(x, y);
      if (!cr || cr.growth < 1) continue;
      const def = g.reg.get('crop', cr.def);
      if (!def) continue;
      const need = (def.harvestWork || 30) / speed;
      if (need > time - used + SHORT) return used; // not enough time left for a whole plant this hour
      used += need;
      practiceFor(g, c, wt, skill, need, LOD.share.farm);
      g.removeCrop(cr.id);
      for (const h of def.harvest) makeItems(g, ctx, h.item, h.qty, 'harvest');
    }
  }
  if (ctx.P.sowAllowed === false) return used;
  for (const f of ctx.fields) {
    const crop = g.reg.get('crop', f.crop);
    if (!crop || !g.s.fields[f.id] || ctx.P.sowOk?.[crop.id] === false) continue;
    for (const [x, y] of fieldCells(f)) {
      if (g.cropAt(x, y) || g.nodeAt(x, y) || g.stackAt(x, y) || g.fieldAt(x, y)?.id !== f.id) continue;
      if (g.terrainAt(x, y).fertility < (crop.minFertility ?? 0.5)) continue;
      const seed = ctx.store.free(crop.seed) >= 1 && ctx.store.stacks().find((s) => s.item === crop.seed && s.dur === undefined && ctx.store.avail(s) >= 1);
      if (!seed) break;
      const need = (crop.sowWork || 25) / speed;
      if (need > time - used + SHORT) return used;
      used += need;
      practiceFor(g, c, wt, skill, need, LOD.share.farm);
      const got = g.takeFromStack(seed.id, 1);
      g.consume(got.item, 1, 'sow');
      g.addCrop(crop.id, x, y, f.id);
    }
  }
  return used;
}

// Gathering: the plan's wants, most urgent first, from the nearest suitable node on the village's land.
function taskGather(g, ctx, c, time) {
  const wants = Object.entries(ctx.P.wants || {}).filter(([, w]) => w.remaining > 0)
    .sort(([a, x], [b, y]) => y.urgency - x.urgency || (a < b ? -1 : a > b ? 1 : 0));
  let used = 0;
  for (const [item, w] of wants) {
    for (const node of nodeCandidates(g, ctx, item)) {
      if (time - used <= SHORT || w.remaining <= 0) break;
      if (g.s.nodes[node.id] !== node || node.empty || g.isReserved('node:' + node.id)) continue;
      const def = g.nodeDef(node);
      if (!can(g, c, def.workType)) continue;
      const y = def.yields.find((yy) => yy.item === item);
      const onChunk = () => { w.remaining -= y.qty; };
      onChunk.stop = () => w.remaining <= 0;
      used += workNode(g, ctx, c, node, time - used, false, onChunk);
    }
    if (time - used <= SHORT) break;
  }
  return used;
}

/** Nodes yielding `item` that the village may gather, nearest to its centre first (cached for the hour). */
function nodeCandidates(g, ctx, item) {
  let list = ctx.nodeCands.get(item);
  if (list) return list;
  const defs = new Set((g.reg.idx.nodesFor[item] || []).map((d) => d.id));
  const { x: cx, y: cy } = ctx.center;
  const r2 = LOD.nearRadius * LOD.nearRadius;
  list = [];
  if (defs.size) {
    for (const n of g.nodesNear(cx, cy, LOD.nearRadius, defs)) {
      if (n.empty || (n.x - cx) ** 2 + (n.y - cy) ** 2 > r2 || !g.gatherOk(ctx.sid, n)) continue;
      const claim = g.footAt(n.x, n.y) || g.fieldAt(n.x, n.y);
      if (claim && !ctx.own(claim)) continue;
      if (!g.reachableFrom(cx, cy, n.x, n.y, g.nodeDef(n)?.passable ? 'on' : 'adj')) continue;
      list.push({ n, d: octile(cx, cy, n.x, n.y) });
    }
    list.sort((a, b) => a.d - b.d || (a.n.id < b.n.id ? -1 : a.n.id > b.n.id ? 1 : 0));
    list = list.map((e) => e.n);
  }
  ctx.nodeCands.set(item, list);
  return list;
}

// ---------------------------------------------------------------- caravans
/** Goods for trade legs this village owes leave its stacks in caravans (`only`: just the legs it accepts). */
function hourCaravans(g, sid, store, only = null) {
  const trades = g.activeTrades().filter((t) => t.status === 'active').sort(byId); // the cached list: the same trades
  for (const t of trades) {
    t.legs.forEach((leg, k) => {
      if (leg.from !== sid || (only && !only(leg))) return;
      let left = legRemaining(g, t, k).remaining;
      if (left <= 0) return;
      const to = centerOf(g, leg.to), from = centerOf(g, sid);
      if (!to || !from) return;
      let plain = 0;
      for (const st of store.stacks()) {
        if (left <= 0) break;
        if (st.item !== leg.item || !g.tradeable(st)) continue;
        const q = Math.min(left, store.avail(st));
        if (q <= 0) continue;
        const got = g.takeFromStack(st.id, q);
        left -= got.qty;
        if (got.dur !== undefined) addCaravan(g, t, k, sid, leg.to, got.item, got.qty, got.dur, from, to);
        else plain += got.qty;
      }
      if (plain > 0) addCaravan(g, t, k, sid, leg.to, leg.item, plain, undefined, from, to);
    });
  }
}

/** Contact scenarios (contact.js): a full-detail village sends goods for legs to far villages (`isFar(leg)`) by
 *  caravan too, the same way an abstract village does, instead of a colonist walking them there. */
export function sendFarCaravans(g, sid, isFar) { hourCaravans(g, sid, villageStore(g, sid), isFar); }

/** Ticks a caravan takes from a to b (centres). */
export const caravanTicks = (a, b) => Math.max(1, Math.ceil(octile(a.x, a.y, b.x, b.y) * MOVE_TICKS * 1.25));
/** Can a caravan of village sid load this stack (villageStore: its stockpile, or within STACK_RADIUS of its centre)? */
export function caravanReach(g, sid, st) {
  if ((st.settlement || playerOf(g)) !== sid) return false;
  if (g.stockpileOwnerAt(st.x, st.y) === sid) return true;
  const c = centerOf(g, sid);
  return !!c && Math.max(Math.abs(st.x - c.x), Math.abs(st.y - c.y)) <= STACK_RADIUS;
}

function addCaravan(g, t, leg, from, to, item, qty, dur, a, b) {
  const s = g.s;
  s.caravans ||= {};
  const id = g.newId('v');
  const eta = s.tick + caravanTicks(a, b);
  s.caravans[id] = { id, trade: t.id, leg, from, to, item, qty, ...(dur !== undefined ? { dur } : {}), x: a.x, y: a.y, tx: b.x, ty: b.y, depart: s.tick, eta };
  g.log(`A caravan from ${nameOf(g, from)} set out for ${nameOf(g, to)} with ${qty} ${g.reg.get('item', item)?.name || item}.`, 'trade', `caravan:${t.id}:${leg}`, 600);
}

function tickCaravans(g) {
  const s = g.s;
  const ids = Object.keys(s.caravans);
  if (!ids.length) return;
  for (const id of ids.sort()) {
    const cv = s.caravans[id];
    if (!cv || cv.eta > s.tick) continue;
    delete s.caravans[id];
    const t = s.trades?.[cv.trade];
    if (t && t.status === 'active' && t.legs[cv.leg]) {
      deliverLeg(g, t, cv.leg, cv.item, cv.qty, cv.tx, cv.ty, cv.dur, true);
      spreadContact(g, cv.from, cv.to, `a caravan from ${nameOf(g, cv.from)}`); // illness may travel with it (illness.js)
      g.log(`A caravan from ${nameOf(g, cv.from)} delivered ${cv.qty} ${g.reg.get('item', cv.item)?.name || cv.item} to ${nameOf(g, cv.to)}.`, 'trade', `caravanin:${cv.trade}:${cv.leg}`, 600);
    } else {
      // The deal is off: the goods go back home (still the seller's).
      const home = centerOf(g, cv.from);
      const prev = g.actor;
      g.actor = cv.from;
      try { g.placeItems(cv.item, cv.qty, home.x, home.y, cv.dur, true); } finally { g.actor = prev; }
    }
  }
}

/** Units of an item in caravans that a village sent (for inventories). */
export function caravanGoods(g, sid) {
  const out = {};
  for (const cv of Object.values(g.s.caravans || {})) if (cv.from === sid) out[cv.item] = (out[cv.item] || 0) + cv.qty;
  return out;
}
