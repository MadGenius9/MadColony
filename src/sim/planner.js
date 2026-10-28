// The colony planner: turns goals + the survival policy into demands, resolves each demand through the
// content graph (stock -> in-flight production -> recipes/stations -> gatherable nodes -> crops), and
// starts projects (homes, stations, fields, stockpile growth). It never moves a colonist itself; it
// publishes `g.plan` (wants, bills, clear list, equipment needs, goal explanations) for job givers.
import { huntableNear, farHuntable, meatOnHand, MEAT_PER_PERSON } from './animals.js';
import { staffing, educationSummary } from './education.js';
import { isAdult as isAdultP, BIRTH, mayDoWork } from './people.js';
import { storageStatus, hubName } from './storage.js';
import { medicalSummary } from './medical.js';
import { isDown as isDownC } from './health.js';
import { needStation, needHousing, needUtility, countsOf } from './civic/needs.js';
import { commitIntents, cachedBlock } from './civic/commit.js';
import { intentsOf } from './civic/intents.js';
import { PLAN_INTERVAL } from './constants.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR, NEAR_RADIUS } from './constants.js';
import { canRipen } from './farming.js';
import { heatSeason } from './heat.js';
import { isWaterNode, waterNetworks } from './water.js';
import { GOAL_TYPES, goalIsOngoing, describeGoal } from './goals.js';
import { createProject, findSite, assignHome, addSlotPart, partsOf, homeFurnished, tileUsable } from './construction.js';
import { networks, powerAt, settlementLoad, busyStationsOf, fuelLoaded, isBroken } from './power.js';
import { parseTemplate, slotCandidates } from './content/templates.js';
import { cropNutritionRate, fieldTileCount, findFieldSite, createField } from './farming.js';
import { fieldCells } from './game.js';
import { isUnlocked, requiredTechs, planResearch, settlementOf, milestoneStatus, eligibleTechs, techInScenario } from './research.js';
import { marketRules } from './markets.js';
import { legRemaining, relationPeek, relationStatus } from './villages.js';
import { LOD, stagger, planOffset } from './lod.js';
import { travelRules, reachTest, nodesInReach, SLOW_WORK } from './ai/trips.js';

export function emptyPlan() {
  return {
    tick: -1, wants: {}, bills: [], clear: new Map(), equipNeeds: [], seedReserve: {}, goalInfo: {}, notes: [],
    blockers: {}, trace: {}, foodDays: 0, growingDays: 0, stock: {}, mealCount: 0, bedsBuilt: 0, anyFood: true, stockFull: false,
    stations: {}, housingNote: '', mealNote: '', foodNote: '', huntNote: '', techWanted: new Set(), research: null, renovation: null, tradeNeeds: {}, landNeeds: {}, surplus: {},
  };
}

export function roleOf(g, c) {
  let best = null, lv = -1;
  for (const wt of g.reg.idx.toolWorkTypes) {
    if (c.workOff?.[wt]) continue;
    const d = g.reg.get('workType', wt);
    const l = d?.skill ? (c.skills[d.skill] || 0) : 0;
    if (l > lv) { lv = l; best = wt; }
  }
  return best;
}

const iname = (g, id) => g.reg.get('item', id)?.name || id;

/** Best tool for a work type that this settlement has or can make right now. */
export function bestAvailableTool(g, sid, wt, stock = {}) {
  let best = null;
  for (const it of g.reg.all('item')) {
    const b = it.equipment?.slot === 'tool' ? it.equipment.workBoost?.[wt] : 0;
    if (!b) continue;
    const makeable = (g.reg.idx.recipesFor[it.id] || []).some((r) => isUnlocked(g, sid, 'recipe', r.id));
    if (!makeable && !(stock[it.id] > 0)) continue;
    if (!best || b > best.boost) best = { item: it.id, boost: b };
  }
  return best?.item || null;
}
/** Rough fighting power of a weapon: damage per tick, scaled by accuracy and reach. */
export function weaponScore(def) {
  const e = def?.equipment;
  if (!e || e.slot !== 'weapon') return 0;
  return (e.damage || 5) * (e.accuracy ?? 0.75) * 60 / (e.cooldown || 45) * (1 + (e.range || 1.5) / 10);
}
const canGet = (g, sid, item, stock) => stock[item] > 0 || (g.reg.idx.recipesFor[item] || []).some((r) => isUnlocked(g, sid, 'recipe', r.id));
export function bestAvailableWeapon(g, sid, stock = {}) {
  const ws = g.reg.all('item').filter((it) => it.equipment?.slot === 'weapon' && canGet(g, sid, it.id, stock)
    && (!it.equipment.ammo || canGet(g, sid, it.equipment.ammo, stock)));
  ws.sort((a, b) => weaponScore(b) - weaponScore(a) || (a.id < b.id ? -1 : 1));
  return ws[0]?.id || null;
}

/** Plan every settlement. g.plans[sid] is each settlement's plan; g.plan is the player's (for the UI).
 *  Big worlds call it every tick with dueOnly = true and each village is planned on its own schedule, so the
 *  cost is spread over the ticks: the player's village every PLAN_INTERVAL ticks (as on classic worlds, and
 *  also when g.planDirty), a full AI village every PLAN_INTERVAL ticks at its own offset, an abstract
 *  village (lod.js) every LOD.checkEvery ticks at its stagger; any village without a plan, or listed in
 *  g.replanSids (completeTech, a switch to full detail, gathering rights), at once. Villages in
 *  g.replanLater (a switch to abstract; the abstract villages after loading a save without saved plans)
 *  plan at their own slot (planOffset) or at their next abstract hour (lod.js), whichever comes first, so
 *  the work is spread over the ticks; until then they keep the plan they have (none after such a load).
 *  Saves since format 7 carry the plans and these requests (plancodec.js), so saving changes nothing. */
export function runPlanner(g, dueOnly = false) {
  const s = g.s;
  if (!s.center) return;
  const ids = Object.keys(s.settlements || {});
  if (!ids.length) ids.push(s.playerSettlement || 't1');
  const prev = g.plans || {};
  const plans = dueOnly ? prev : {};
  const all = !dueOnly;
  const player = s.playerSettlement;
  const dirty = g.planDirty;
  const asked = g.replanSids; // villages that asked for a new plan (a finished tech, a level switch, rights)
  g.replanSids = null;
  const later = g.replanLater; // big worlds: villages that replan at their own slot or abstract hour (spread out)
  if (dueOnly) g.planDirty = false; // (classic worlds clear it in Game.tick); planning may set it again
  // Settlements take turns going first (fairness for shared ground near borders); deterministic by tick.
  const k = Math.floor(s.tick / PLAN_INTERVAL) % ids.length;
  for (const sid of [...ids.slice(k), ...ids.slice(0, k)]) {
    let due;
    if (asked?.has(sid)) due = true;
    else if (later?.has(sid)) due = s.tick % PLAN_INTERVAL === planOffset(sid, PLAN_INTERVAL);
    else if (!prev[sid] || !g.big) due = true;
    else if (s.settlements?.[sid]?.detail === 'abstract') due = s.tick % LOD.checkEvery === stagger(sid) % LOD.checkEvery;
    else if (all) due = true;
    else if (sid === player) due = s.tick % PLAN_INTERVAL === 0 || dirty;
    else due = s.tick % PLAN_INTERVAL === planOffset(sid, PLAN_INTERVAL);
    if (s.settlements?.[sid]?.fallen) { plans[sid] = emptyPlan(); later?.delete(sid); continue; } // a ruin plans nothing (fallen.js)
    if (due) { plans[sid] = planSettlement(g, sid); later?.delete(sid); }
    else if (!dueOnly && prev[sid]) plans[sid] = prev[sid];
  }
  g.plans = plans;
  g.plan = plans[s.playerSettlement] || plans[ids[0]] || emptyPlan();
}

/** Big worlds: plan one village now (an abstract village whose hour comes before its planning slot). */
export function planNow(g, sid) {
  (g.plans ||= {})[sid] = g.s.settlements?.[sid]?.fallen ? emptyPlan() : planSettlement(g, sid); // ruins plan nothing (fallen.js)
  g.replanLater?.delete(sid);
}

function planSettlement(g, sid) {
  const reg = g.reg, s = g.s, pol = g.policyFor(sid);
  const player = s.playerSettlement || sid;
  const isPlayer = sid === player;
  const own = (e) => (e?.settlement || player) === sid;
  const center = settlementOf(g, sid)?.center || s.center;
  const cols = g.owned('colonists', sid).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); // id order, as g.colonists()
  const n = cols.length;
  const P = emptyPlan();
  P.tick = s.tick;
  P.sid = sid;
  const prevWanted = g.plans?.[sid]?.techWanted || new Set();
  const block = (goalId, msg) => {
    const k = goalId || '_colony';
    P.blockers[k] ||= [];
    if (!P.blockers[k].includes(msg)) P.blockers[k].push(msg);
  };
  // Step-by-step explanation of how each goal is being pursued (shown in the goal inspector).
  const trace = (goalId, depth, text, state) => {
    if (!goalId) return;
    const t = (P.trace[goalId] ||= []);
    if (t.length < 40) t.push({ depth, text, state });
  };
  P.waits = {};
  const wait = (goalId, msg) => {
    const k = goalId || '_colony';
    P.waits[k] ||= [];
    if (!P.waits[k].includes(msg)) P.waits[k].push(msg);
  };

  // ---- Inventory snapshot ----
  const pool = {};
  // Travel rules (trips.js), full-detail villages only (abstract ones gather by their own rule, lod.js).
  const T = settlementOf(g, sid)?.detail === 'abstract' ? null : travelRules(g);
  const reach = T ? reachTest(g, sid) : null;
  for (const st of g.owned('stacks', sid)) {
    if (!own(st)) continue; // other settlements' goods are never counted or used
    P.stock[st.item] = (P.stock[st.item] || 0) + st.qty;
    if (reach && !reach(st.x, st.y)) continue; // big worlds: left too far from home to count on (trips.js)
    const a = st.qty - g.reservedQty(st.id); // (goods promised to trades are taken off just below)
    if (a > 0) pool[st.item] = (pool[st.item] || 0) + a;
  }
  for (const c of cols) {
    // Items merely being moved to the stockpile are still available.
    if (c.job?.type === 'haul' && c.job.dest.kind === 'stock') {
      for (const r of c.job.res) if (r.k === 'q' && s.stacks[r.key]) pool[s.stacks[r.key].item] = (pool[s.stacks[r.key].item] || 0) + r.qty;
    }
    if (c.carry && c.job?.type === 'haul' && c.job.dest.kind === 'stock') {
      pool[c.carry.item] = (pool[c.carry.item] || 0) + c.carry.qty;
      P.stock[c.carry.item] = (P.stock[c.carry.item] || 0) + c.carry.qty;
    }
  }
  // Goods promised to active trades are spoken for.
  for (const t of g.activeTrades()) t.legs.forEach((l, k) => { if (l.from === sid) pool[l.item] = Math.max(0, (pool[l.item] || 0) - Math.max(0, legRemaining(g, t, k).remaining)); });
  P.available = { ...pool }; // what this plan may count on: own goods, minus job reservations and trade promises
  // Seeds that must stay in storage: one per unsown field tile.
  for (const f of g.owned('fields', sid)) {
    const crop = reg.get('crop', f.crop);
    if (!crop || !own(f)) continue;
    let unsown = 0;
    for (const [x, y] of fieldCells(f)) if (!g.cropAt(x, y)) unsown++;
    P.seedReserve[crop.seed] = (P.seedReserve[crop.seed] || 0) + unsown;
  }
  for (const [it, q] of Object.entries(P.seedReserve)) pool[it] = Math.max(0, (pool[it] || 0) - q);

  // In-flight production (counted so the colony does not over-produce).
  const inflight = {};
  const addIn = (it, q) => { if (q > 0) inflight[it] = (inflight[it] || 0) + q; };
  for (const c of cols) {
    const j = c.job;
    if (!j) continue;
    if (j.type === 'craft') { const r = reg.get('recipe', j.recipe); for (const o of r?.outputs || []) addIn(o.item, o.qty); }
    if (j.type === 'gather') {
      const node = s.nodes[j.nodeId];
      const d = node && g.nodeDef(node);
      if (d) for (const y of d.yields) addIn(y.item, y.qty * Math.max(0, Math.min(j.maxChunks - (j.done || 0), node.chunks)));
    }
    if (j.type === 'harvest') {
      for (const id of j.cropIds.slice(j.i)) { const cr = s.crops[id]; const d = cr && reg.get('crop', cr.def); for (const h of d?.harvest || []) addIn(h.item, h.qty); }
    }
  }

  // ---- Food accounting ----
  const hunger = reg.all('need').find((x) => x.behavior === 'core:eat');
  const needPerDay = n * (hunger?.decayPerDay ?? 1);
  let foodNutr = 0;
  for (const [it, q] of Object.entries(P.stock)) {
    const nu = reg.get('item', it)?.nutrition || 0;
    if (nu) foodNutr += Math.max(0, q - (P.seedReserve[it] || 0)) * nu;
    if (reg.itemHasTag(it, 'core:meal')) P.mealCount += q;
  }
  let growNutr = 0;
  for (const cr of Object.values(s.crops)) {
    if (!own(s.fields[cr.fieldId])) continue;
    const d = reg.get('crop', cr.def);
    if (d) for (const h of d.harvest) growNutr += h.qty * (reg.get('item', h.item)?.nutrition || 0);
  }
  P.foodDays = needPerDay > 0 ? foodNutr / needPerDay : 99;
  P.growingDays = needPerDay > 0 ? growNutr / needPerDay : 0;
  P.anyFood = foodNutr > 0;

  // ---- Goal context ----
  const ctx = {
    demands: [], spares: [], roleTools: {},
    housingTarget: n, housingUrgency: 1.0, housingGoal: null,
    mealTarget: Math.ceil((pol.mealsPerColonist ?? 2) * n), mealUrgency: 0.9, mealGoal: null,
    foodDays: pol.foodDays ?? 3, foodUrgency: 0.55, foodGoal: null,
    guards: null, buildCounts: [], eraGoals: [],
    armAll: !!pol.armColonists || Object.keys(s.settlements || {}).some((o) => o !== sid && relationStatus(relationPeek(g, sid, o)) === 'hostile'), armUrgency: 0.5, armGoal: null,
  };
  if (isPlayer) for (const goal of s.goals) if (goal.status === 'active') GOAL_TYPES[goal.type]?.apply(g, goal, ctx); // player goals steer the player's settlement
  // Era drive (scenario data `eraDrive`; the Living and vast worlds, never classic scenarios): a village with no
  // player era goal works toward the next era on its own (the last era as the target, so milestones of each next
  // era in turn), at the data's urgency, once it has stood afterDays. A player's era goal wins. Its projects say
  // "Advancing to the next era".
  const drive = s.scenarioId && g.reg.get('scenario', s.scenarioId)?.eraDrive;
  if (drive && !ctx.eraGoals.length && s.tick - (settlementOf(g, sid)?.founded ?? 0) >= (drive.afterDays ?? 0) * TICKS_PER_DAY) {
    let last = null;
    for (const e of reg.idx.eras) if (!last || e.order > last.order) last = e;
    if (last) ctx.eraGoals.push({ era: last.id, urgency: drive.urgency ?? 0.3, goal: null, drive: true });
  }
  // Room to grow (only where the scenario founds villages during play, founding.js): a village under its
  // population cap with food to spare keeps `growBeds` spare beds, so families can have children (people.js
  // births need a free bed) and a crowded village can later send settlers out. Classic scenarios: off.
  // It starts once the village has stood for growAfterDays (a new village first houses its own people).
  const fnd = s.scenarioId && g.reg.get('scenario', s.scenarioId)?.founding;
  const growBeds = fnd?.growBeds;
  const settled = s.tick - (settlementOf(g, sid)?.founded ?? 0) >= (fnd?.growAfterDays ?? 5) * TICKS_PER_DAY;
  if (growBeds > 0 && settled) {
    const cap = pol.maxPopulation ?? BIRTH.defaultCap;
    if (n < cap && P.foodDays >= BIRTH.minFoodDays) {
      const want = Math.min(cap, n + growBeds);
      if (want > ctx.housingTarget) { ctx.housingTarget = want; ctx.housingWhy = `Room to grow: ${n} of ${cap} people and food for ${Math.floor(P.foodDays)} days`; if (!cols.some((c) => !c.homeId)) ctx.housingUrgency = Math.min(ctx.housingUrgency, 0.6); }
    }
  }
  const homeless = cols.filter((c) => !c.homeId).length;

  // ---- Demands ----
  const D = ctx.demands;
  for (const p of g.owned('projects', sid)) {
    if (p.status !== 'active' || !own(p)) continue;
    if (p.kind === 'home') {
      const home = s.homes[p.homeId];
      p.urgency = home?.complete ? 0.35 : ctx.housingUrgency + (homeless > 0 ? 0.3 : 0);
    }
    for (const st of partsOf(g, p)) {
      if (st.built) continue;
      for (const cost of g.bDef(st).cost) {
        const need = cost.qty - (st.delivered[cost.item] || 0) - g.incoming(st.id, cost.item);
        if (need > 0) D.push({ item: cost.item, qty: need, urgency: p.urgency, why: p.why || `Build ${p.name}`, goal: p.kind === 'home' ? ctx.housingGoal : p.goal });
      }
    }
  }
  D.push({ tag: 'core:meal', qty: ctx.mealTarget, urgency: P.mealCount < n ? 1.6 : ctx.mealUrgency, why: ctx.mealGoal ? `Goal: keep ${ctx.mealTarget} meals` : 'Keep prepared meals on hand', goal: ctx.mealGoal, meals: true });
  // Guards (goal "arm N guards"): those already carrying the weapon first, then by id; foreign residents never.
  const guardIds = new Set();
  if (ctx.guards) {
    const pool = cols.slice().sort((a, b) => (b.equip.weapon?.item === ctx.guards.item) - (a.equip.weapon?.item === ctx.guards.item) || (a.id < b.id ? -1 : 1));
    for (const c of pool.slice(0, ctx.guards.count)) guardIds.add(c.id);
  }
  // Hunting (Phase 8, animals.js / hunt.js): while a huntable herd is near the village and meat is short, its two
  // best hunters (by skill, then id) get a weapon if they have none; the reason is shown (P.huntNote).
  const ctr = s.settlements?.[sid]?.center || s.center, hunterIds = new Set();
  const herdsNear = !ctr || !s.animals ? [] : s.settlements?.[sid]?.detail === 'abstract' ? farHuntable(g, ctr.x, ctr.y, 40, sid) : huntableNear(g, ctr.x, ctr.y, 60); // distant villages hunt far herds (lod.js); full ones near or far
  const meatShort = meatOnHand(g, P) < MEAT_PER_PERSON * Math.max(2, cols.length);
  if (herdsNear.length && meatShort) {
    const pool = cols.filter((c) => isAdultP(g, c) && !c.workOff?.['core:hunt']).sort((a, b) => (b.skills['core:hunting'] || 0) - (a.skills['core:hunting'] || 0) || (a.id < b.id ? -1 : 1));
    for (const c of pool.slice(0, 2)) hunterIds.add(c.id);
  }
  const raid = herdsNear.find((t) => t.raid);
  P.huntNote = raid ? `Hunting down the ${raid.d.plural || raid.d.name} that attacked the village (${Math.round(raid.dist)} tiles away)` : !herdsNear.length ? 'No herd near enough to hunt' : !meatShort ? 'Enough meat for now' : `Hunting ${herdsNear[0].d.plural || herdsNear[0].d.name} (a herd of ${herdsNear[0].h.n}, ${Math.round(herdsNear[0].dist)} tiles away)`;
  for (const c of cols) {
    if (!isAdultP(g, c)) continue; // children get no tools or weapons
    const role = roleOf(g, c);
    const rt = role && ctx.roleTools[role];
    let tool = rt ? rt.item : (pol.equipTools && role ? bestAvailableTool(g, sid, role, P.stock) : null);
    // Someone with no tool at all gets the best tool that can be made from what is in stock right now
    // (e.g. stone while iron is scarce); the usual upgrade to the best tool follows later.
    if (tool && !rt && !c.equip.tool && !toolReadyNow(g, sid, tool, P.stock)) tool = stopgapTool(g, sid, role, P.stock) || tool;
    const fetching = (slot, item) => c.job?.type === 'equip' && c.job.slot === slot && s.stacks[c.job.stackId]?.item === item;
    if (tool && c.equip.tool?.item !== tool && !fetching('tool', tool)) {
      D.push({ item: tool, qty: 1, urgency: rt ? rt.urgency : 0.5, why: rt ? `Goal: ${describeGoal(g, s.goals.find((x) => x.id === rt.goal))}` : `A ${iname(g, tool)} for ${c.name}`, goal: rt?.goal, equipFor: c.id, slot: 'tool' });
    }
    const guardItem = guardIds.has(c.id) ? ctx.guards.item : null;
    if (guardItem && c.equip.weapon?.item !== guardItem && !fetching('weapon', guardItem)) {
      D.push({ item: guardItem, qty: 1, urgency: ctx.guards.urgency, why: `Goal: ${describeGoal(g, s.goals.find((x) => x.id === ctx.guards.goal))}`, goal: ctx.guards.goal, equipFor: c.id, slot: 'weapon' });
    } else if (ctx.armAll && !guardItem) {
      const wid = bestAvailableWeapon(g, sid, P.stock);
      const w = wid && reg.get('item', wid);
      // Unarmed people get the best weapon we can make; armed ones trade up once it is in stock.
      const better = w && c.equip.weapon && weaponScore(w) > weaponScore(reg.get('item', c.equip.weapon.item)) * 1.15 && (P.stock[w.id] || 0) > 0;
      if (w && (!c.equip.weapon || better) && !fetching('weapon', w.id)) D.push({ item: w.id, qty: 1, urgency: ctx.armUrgency, why: ctx.armGoal ? 'Goal: arm every colonist' : 'Arm the colonists', goal: ctx.armGoal, equipFor: c.id, slot: 'weapon' });
    }
    if (hunterIds.has(c.id) && !c.equip.weapon && !guardItem && !ctx.armAll) {
      const wid = bestAvailableWeapon(g, sid, P.stock);
      if (wid && !fetching('weapon', wid)) D.push({ item: wid, qty: 1, urgency: 0.5, why: `A ${iname(g, wid)} for ${c.name} to hunt with`, equipFor: c.id, slot: 'weapon' });
    }
  }
  for (const sp of ctx.spares) D.push(sp);
  // Carcasses spoil: their meat (or hide) is wanted at once, so they are butchered (Phase 8).
  for (const [it, q] of Object.entries(P.stock)) {
    if (q <= 0 || !reg.get('item', it)?.tags?.includes('core:carcass')) continue;
    const r = reg.all('recipe').find((x) => x.fromStock && x.inputs.some((e) => e.item === it));
    const out = r?.outputs[0];
    if (out) D.push({ item: out.item, qty: (P.stock[out.item] || 0) + q * out.qty, urgency: 0.9, why: `Butcher the ${reg.get('item', it).name.toLowerCase()} before it spoils`, recipe: r.id, maxRuns: q });
  }
  for (const [it, q] of Object.entries(pol.stock || {})) if (reg.get('item', it)) D.push({ item: it, qty: q, urgency: 0.25, why: 'Keep a basic stockpile' });
  // Ammunition for everyone carrying a ranged weapon.
  const ammoNeed = {};
  for (const c of cols) { const eq = c.equip.weapon && reg.get('item', c.equip.weapon.item)?.equipment; if (eq?.ammo) ammoNeed[eq.ammo] = (ammoNeed[eq.ammo] || 0) + 12; }
  for (const [it, q] of Object.entries(ammoNeed)) D.push({ item: it, qty: q, urgency: 0.35, why: 'Ammunition for armed colonists' });
  planLighting(g, P, sid);
  planPlumbing(g, P, sid);
  planHeating(g, P, sid, D);
  planMedical(g, P, sid, D, cols);
  planEducation(g, P, sid);
  planBuildTargets(g, P, sid, ctx, block);
  planMarket(g, P, sid);
  planPower(g, P, sid, D);
  planWater(g, P, sid, cols);

  // ---- Research (settlement layer: what to study, whether it may run now, its materials) ----
  P.techWanted = new Set();
  const savedWanted = P.techWanted;
  P.techWanted = prevWanted;
  planResearch(g, P, sid, { cols, demands: D, ensureStation: (bid, u, why) => ensureStation(g, P, bid, u, why, sid) });
  P.techWanted = savedWanted;
  for (const t of P.heatTechs || []) P.techWanted.add(t); // heating before winter
  for (const t of P.medTechs || []) P.techWanted.add(t); // medicine once there are infections
  for (const t of P.eduTechs || []) P.techWanted.add(t); // a school once there are children; a college when staff are short
  for (const t of P.goalTechs || []) P.techWanted.add(t); // research a goal is waiting for (era goals)
  for (const t of P.tradeTechs || []) P.techWanted.add(t); // a market, once the village has met many others
  P.techWanted.urgent = new Set([...(P.goalTechs || []), ...(P.eduTechs || [])]); // goals, and schooling for waiting children, come first (never in fields switched Off)

  // ---- Resolution ----
  const alloc = (it, q) => { const a = Math.max(0, Math.min(q, pool[it] || 0)); pool[it] = (pool[it] || 0) - a; return a; };
  const allocTag = (tag, q) => { let got = 0; for (const it of reg.itemsWithTag(tag)) { if (got >= q) break; got += alloc(it, q - got); } return got; };
  const takeIn = (it, q) => { const a = Math.max(0, Math.min(q, inflight[it] || 0)); inflight[it] = (inflight[it] || 0) - a; return a; };
  const takeInTag = (tag, q) => { let got = 0; for (const it of reg.itemsWithTag(tag)) { if (got >= q) break; got += takeIn(it, q - got); } return got; };
  const billMap = new Map();
  const readyRuns = new Map(), machineRuns = new Map(); // sizing: recipe -> runs ready to work; station -> all its machines can run
  const addBill = (r, runs, urgency, why, goal) => {
    const b = billMap.get(r.id);
    if (b) { b.remaining += runs; b.urgency = Math.max(b.urgency, urgency); }
    else billMap.set(r.id, { recipe: r.id, remaining: runs, urgency, why, goal });
    if (b && goal && !b.goal) b.goal = goal;
  };
  const addWant = (it, q, urgency, why, goal) => {
    const w = P.wants[it];
    if (w) { w.remaining += q; if (urgency > w.urgency) { w.urgency = urgency; w.why = why; if (goal) w.goal = goal; } }
    else P.wants[it] = { remaining: q, urgency, why, goal };
  };
  const reachCache = new Map();
  const reachableNode = (defIds) => {
    const k = defIds.join('|');
    if (reachCache.has(k)) return reachCache.get(k);
    const set = new Set(defIds);
    let ok = false;
    // Only resources on this settlement's own land count (its colonists may not gather elsewhere).
    // Big worlds: only within the village's gathering radius (the same chunks its colonists search).
    // Travel rules (trips.js): only within maxWalk tiles' walk of the centre, as the gatherers do.
    const byDef = g.big ? null : g.nodesByDef();
    const pool = g.big ? (reach && nodesInReach(g, sid, set)) || g.nodesNear(center.x, center.y, NEAR_RADIUS, set) : defIds.flatMap((d) => byDef.get(d) || []);
    for (const nd of pool) {
      if (nd.empty || !g.gatherOk(sid, nd)) continue;
      if (reach && !reach(nd.x, nd.y, (g.nodeDef(nd)?.work || 0) * SLOW_WORK)) continue; // one chunk's trip
      if (g.reachableFrom(center.x, center.y, nd.x, nd.y, g.nodeDef(nd).passable ? 'on' : 'adj')) { ok = true; break; }
    }
    if (!ok) ok = (g.big ? pool : Object.values(s.nodes)).some((nd) => set.has(nd.def) && nd.empty && !nd.young && g.gatherOk(sid, nd) && (!reach || reach(nd.x, nd.y, (g.nodeDef(nd)?.work || 0) * SLOW_WORK))) ? 'regrowing' : false;
    reachCache.set(k, ok);
    return ok;
  };

  // A powered workstation (one that some recipe uses) other than `bid` that is under construction, or that
  // this plan has already asked for (not one that is blocked, e.g. with no site); null when there is none.
  // Only reached in the electric era. A machine held back this way is listed in P.machineWaits (industry.js).
  const isMachineStation = (b) => reg.get('building', b)?.power?.use > 0 && reg.all('recipe').some((r) => r.station === b);
  const machineUnderWay = (bid) => {
    for (const [b, e] of countsOf(g, P, sid)) if (b !== bid && e.inflight > 0 && isMachineStation(b)) return b;
    for (const [b, e] of Object.entries(P.stations)) if (b !== bid && e.state !== 'built' && e.state !== 'blocked' && isMachineStation(b)) return b;
    return null;
  };

  const resolve = (spec, short, urgency, why, goal, depth, seen) => {
    const key = spec.item || '#' + spec.tag;
    const label = spec.item ? iname(g, spec.item) : spec.tag.split(':')[1].replace(/_/g, ' ');
    if (depth > 6 || seen.has(key)) { block(goal, `Production chain for ${label} is circular or too deep`); return; }
    const seen2 = new Set(seen); seen2.add(key);
    let allRecipes = spec.item ? (reg.idx.recipesFor[spec.item] || []) : reg.recipesForTag(spec.tag);
    // Recipes that only use up goods on hand (`fromStock`: butchering a carcass) serve only a want that names them
    // (Phase 8): meat is raw food, but a village short of food forages and farms, it does not plan to butcher deer.
    allRecipes = spec.recipe ? allRecipes.filter((r) => r.id === spec.recipe) : allRecipes.filter((r) => !r.fromStock);
    // Fallback recipes (quarrying) are used only while the item cannot be gathered on reachable land.
    if (allRecipes.some((r) => r.fallback)) {
      const nodeIds = spec.item ? (reg.idx.nodesFor[spec.item] || []).map((n) => n.id) : [];
      if (nodeIds.length && reachableNode(nodeIds)) allRecipes = allRecipes.filter((r) => !r.fallback);
      else if (nodeIds.length) {
        P.landNeeds[spec.item] = { nodes: nodeIds, qty: (P.landNeeds[spec.item]?.qty || 0) + short }; // neighbours may grant rights meanwhile
        for (const r of allRecipes) if (r.fallback && !isUnlocked(g, sid, 'recipe', r.id)) requiredTechs(g, 'recipe', r.id).forEach((t) => P.techWanted.add(t));
      }
    }
    const recipes = allRecipes.filter((r) => isUnlocked(g, sid, 'recipe', r.id));
    // Record demand for powered machines (even locked ones) so the UI can say why one is or isn't built.
    for (const x of allRecipes) {
      if (!reg.get('building', x.station)?.power?.use) continue;
      const m = ((P.machineDemand ||= {})[x.station] ||= { recipes: [], why });
      if (!m.recipes.includes(x.name)) m.recipes.push(x.name);
    }
    if (allRecipes.length && !recipes.length && !(spec.item ? (reg.idx.nodesFor[spec.item] || []).length : false)) {
      const techs = [...new Set(allRecipes.flatMap((r) => requiredTechs(g, 'recipe', r.id)))];
      techs.forEach((t) => P.techWanted.add(t));
      if (spec.item) P.tradeNeeds[spec.item] = (P.tradeNeeds[spec.item] || 0) + short; // a neighbour might have it
      const tn = techs.map((t) => reg.get('tech', t)?.name || t).join(' or ');
      block(goal, `Making ${label} requires research: ${tn}`);
      trace(goal, depth + 1, `${label}: requires research (${tn})`, 'blocked');
      return;
    }
    if (recipes.length) {
      const built = (r) => (countsOf(g, P, sid).get(r.station)?.built || 0) > 0;
      // A powered machine can run when it has power now, or when its own network has a working (built,
      // not broken) generator and there is fuel in stock to load it. Without that, work stays by hand.
      const fuelInStock = reg.itemsWithTag('core:fuel').some((it) => (P.stock[it] || 0) > 0);
      const canRun = (y) => { const pw = powerAt(g, y); return pw.ratio > 0 || !!(pw.net && fuelInStock && pw.net.generators?.some((x) => x.built && !isBroken(x))); };
      const machinesOf = (bid) => g.owned('structures', sid).filter((y) => y.built && y.def === bid && own(y));
      const usable = (x) => built(x) && (!reg.get('building', x.station)?.power?.use || machinesOf(x.station).some(canRun));
      let r = recipes.find(usable) || recipes.find((x) => !reg.get('building', x.station)?.power?.use) || recipes[0];
      // A faster powered machine is used once it is built and can run. Until then work goes on by hand
      // while the machine (and a generator for it) is built in the background.
      const genOK = reg.all('building').some((b) => b.power?.output > 0 && isUnlocked(g, sid, 'building', b.id) && reg.all('template').some((t) => (t.provides || []).includes(b.id) && templateUnlocked(g, sid, t)));
      const faster = recipes.filter((x) => x.work < r.work && reg.get('building', x.station)?.power?.use).sort((a, b) => a.work - b.work);
      let machine = null;
      for (const x of faster) {
        const sts = machinesOf(x.station);
        if (sts.some(canRun)) { machine = x; break; }
        if (!sts.length && genOK && isUnlocked(g, sid, 'building', x.station) && reg.all('template').some((t) => (t.provides || []).includes(x.station) && templateUnlocked(g, sid, t))) {
          // One new machine at a time: while another powered workstation is being built (or was asked for in
          // this plan), this one waits, so iron and machine parts go to the machine that was started first.
          const other = machineUnderWay(x.station);
          if (other) { (P.machineWaits ||= {})[x.station] = other; trace(goal, depth + 1, `A ${reg.get('building', x.station).name} would be faster: waiting until the ${reg.get('building', other).name} is built`, 'wait'); break; }
          ensureStation(g, P, x.station, Math.min(urgency, 0.35), `${depth > 0 ? why : `${label} for ${why}`}: faster on a ${reg.get('building', x.station).name} (${x.name})`, sid);
          break;
        }
      }
      if (machine) r = machine;
      const out = r.outputs.find((o) => (spec.item ? o.item === spec.item : reg.itemHasTag(o.item, spec.tag)));
      const runs = Math.min(Math.ceil(short / out.qty), spec.maxRuns ?? Infinity);
      addBill(r, runs, urgency, machine ? `${why}; made on the ${reg.get('building', r.station).name} (faster)` : why, goal);
      const st = ensureStation(g, P, r.station, urgency, why, sid);
      const stName = g.reg.get('building', r.station).name;
      trace(goal, depth + 1, `Make ${runs}× "${r.name}" (${short} ${label} short)`, 'working');
      if (st.state === 'blocked') { block(goal, st.reason); trace(goal, depth + 2, `Needs a ${stName}: ${st.reason}`, 'blocked'); }
      else if (st.state === 'building' || st.state === 'planned') {
        wait(goal, `Waiting for the ${stName} to be built`);
        const parts = st.project ? partsOf(g, st.project) : [];
        trace(goal, depth + 2, st.project ? `Needs a ${stName}: being built as part of ${st.project.name} (${parts.filter((x) => x.built).length}/${parts.length} parts)` : `Needs a ${stName}: ${st.reason}`, 'wait');
      } else trace(goal, depth + 2, `${stName} is ready`, 'ok');
      if (st.project && goal && !st.project.goal) st.project.goal = goal;
      // Sizing (planMachineCount): the runs of a machine recipe whose ingredients are in stock, being made now, or
      // made from such ingredients by the recipes this plan bills for them (resolve returns how many units of
      // what it was asked for can be worked that way; gathering does not count), and whether every built
      // machine of its kind can run.
      const powered = reg.get('building', r.station)?.power?.use > 0;
      let ready = runs;
      if (powered && !machineRuns.has(r.station)) machineRuns.set(r.station, machinesOf(r.station).every(canRun));
      for (const inp of r.inputs) {
        const q = inp.qty * runs;
        const ispec = inp.item ? { item: inp.item } : { tag: inp.tag };
        let s2 = q - (inp.item ? alloc(inp.item, q) : allocTag(inp.tag, q));
        if (s2 > 0) s2 -= inp.item ? takeIn(inp.item, s2) : takeInTag(inp.tag, s2);
        trace(goal, depth + 2, `Ingredient: ${q} ${inp.item ? iname(g, inp.item) : inp.tag.split(':')[1].replace(/_/g, ' ')}${s2 > 0 ? ` (${s2} still to obtain)` : ' (available)'}`, s2 > 0 ? 'missing' : 'ok');
        const made = s2 > 0 ? Math.min(s2, resolve(ispec, s2, urgency * 0.97, `${r.name} needs ${inp.item ? iname(g, inp.item) : inp.tag.split(':')[1].replace(/_/g, ' ')}`, goal, depth + 1, seen2) || 0) : 0;
        ready = Math.min(ready, Math.floor((q - s2 + made) / inp.qty));
      }
      if (powered && ready > 0) readyRuns.set(r.id, (readyRuns.get(r.id) || 0) + ready);
      return ready * out.qty;
    }
    const items = spec.item ? [spec.item] : reg.itemsWithTag(spec.tag);
    let any = false;
    for (const it of items) {
      const nodes = reg.idx.nodesFor[it] || [];
      if (nodes.length) {
        any = true;
        addWant(it, short, urgency, why, goal);
        const ok = reachableNode(nodes.map((x) => x.id));
        const where = nodes.map((x) => x.name).join(' / ');
        const within = reach ? ` within a round trip on foot (at most ${Math.round(T.maxWalk)} tiles' walk)` : '';
        if (!ok) { P.landNeeds[it] = { nodes: nodes.map((x) => x.id), qty: (P.landNeeds[it]?.qty || 0) + short }; P.tradeNeeds[it] = (P.tradeNeeds[it] || 0) + short; block(goal, `No reachable ${where} left${within} for ${iname(g, it)}`); trace(goal, depth + 1, `Gather ${short} ${iname(g, it)}: no reachable ${where}${within}`, 'blocked'); }
        else trace(goal, depth + 1, `Gather ${short} ${iname(g, it)} from ${where}${ok === 'regrowing' ? ' (waiting for regrowth)' : ''}`, ok === 'regrowing' ? 'wait' : 'working');
      }
      if ((reg.idx.cropsFor[it] || []).length) { any = true; P.farmPressure = (P.farmPressure || 0) + short; trace(goal, depth + 1, `Grow ${iname(g, it)} in the fields`, 'working'); }
    }
    if (!any) { if (spec.item) P.tradeNeeds[spec.item] = (P.tradeNeeds[spec.item] || 0) + short; block(goal, `Nothing in the loaded content produces ${label}`); trace(goal, depth + 1, `Nothing produces ${label}`, 'blocked'); }
  };

  D.sort((a, b) => b.urgency - a.urgency);
  for (const d of D) {
    const have = d.tag ? allocTag(d.tag, d.qty) : alloc(d.item, d.qty);
    if (d.equipFor && have >= 1) P.equipNeeds.push({ cid: d.equipFor, item: d.item, slot: d.slot, why: d.why });
    let short = d.qty - have;
    const dl = d.item ? iname(g, d.item) : d.tag.split(':')[1].replace(/_/g, ' ');
    trace(d.goal, 0, `${d.qty} ${dl}: ${have} available`, short > 0 ? 'missing' : 'ok');
    if (short > 0) {
      const inf = d.tag ? takeInTag(d.tag, short) : takeIn(d.item, short);
      if (inf > 0) trace(d.goal, 1, `${inf} already being made or gathered`, 'working');
      short -= inf;
    }
    if (short > 0) resolve(d.tag ? { tag: d.tag } : { item: d.item, ...(d.recipe ? { recipe: d.recipe, maxRuns: d.maxRuns } : {}) }, short, d.urgency, d.why, d.goal, 0, new Set());
  }
  P.bills = [...billMap.values()].sort((a, b) => b.urgency - a.urgency);
  // ---- Machine count sized to demand (Phase 3 slice 3): a 2nd or 3rd machine when work keeps waiting ----
  planMachineCount(g, P, sid, cols, machineUnderWay, readyRuns, machineRuns);
  // What this settlement can spare: stock left after every demand, minus a safety buffer (tools excluded).
  const keepExtra = settlementOf(g, sid)?.trade?.keepExtra ?? 15;
  for (const [it, q] of Object.entries(pool)) {
    const d = reg.get('item', it);
    if (!d || d.equipment) continue;
    const spare = Math.floor(q - keepExtra);
    if (spare > 0) P.surplus[it] = spare;
  }
  // Meals are maintained continuously, so make sure a cooking station exists before stock runs low.
  const mealRecipes = reg.recipesForTag('core:meal').filter((r) => isUnlocked(g, sid, 'recipe', r.id));
  if (mealRecipes.length && n > 0) {
    const st = ensureStation(g, P, mealRecipes[0].station, ctx.mealUrgency, 'Keep prepared meals on hand', sid);
    if (st.state === 'blocked') block(ctx.mealGoal, st.reason);
  }

  // Winter: when the growing season is about to end, keep enough food to last until the next harvest.
  const lean = leanSeason(g, sid);
  P.lean = lean;
  if (lean && lean.startsIn <= 5) {
    const need = Math.min(20, Math.ceil(lean.days * 0.7));
    if (need > ctx.foodDays) ctx.foodDays = need;
  }
  // Food reserve: forage while crops grow, and push for more farmland.
  const targetNutr = needPerDay * ctx.foodDays;
  const shortNutr = targetNutr - foodNutr - growNutr * 0.6;
  if (shortNutr > 0) {
    const urg = P.foodDays < 1.5 ? 1.3 : ctx.foodUrgency;
    for (const it of reg.itemsWithTag('core:raw_food')) {
      const nu = reg.get('item', it)?.nutrition || 0.1;
      if ((reg.idx.nodesFor[it] || []).length) addWant(it, Math.ceil(shortNutr / nu), urg, ctx.foodGoal ? `Goal: food for ${ctx.foodDays} days` : lean && lean.startsIn <= 5 ? `Laying in food for the winter (${ctx.foodDays} days)` : 'Food reserve is low');
    }
  }
  // Avoid endless overproduction: stop sowing new crops when stored + growing food is far above target.
  P.foodDaysTarget = ctx.foodDays;
  P.sowAllowed = P.foodDays + P.growingDays * 0.6 < Math.max(ctx.foodDays * 2.5, ctx.foodDays + 4);
  P.foodNote = `Stored food lasts ${P.foodDays.toFixed(1)} days; crops in the ground add ${P.growingDays.toFixed(1)}. ${fieldTileCount(g)} field tiles.`;

  // ---- Meals note ----
  const mealBill = P.bills.find((b) => reg.get('recipe', b.recipe)?.outputs.some((o) => reg.itemHasTag(o.item, 'core:meal')));
  if (P.mealCount >= ctx.mealTarget) P.mealNote = 'Meal stock is at target.';
  else if (mealBill) {
    const r = reg.get('recipe', mealBill.recipe);
    const stn = P.stations[r.station];
    const raw = reg.itemsWithTag('core:raw_food').reduce((a, it) => a + Math.max(0, (P.stock[it] || 0) - (P.seedReserve[it] || 0)), 0);
    if (stn?.state !== 'built') P.mealNote = `Needs a ${reg.get('building', r.station).name} first (${stn?.state === 'building' ? 'being built' : stn?.reason || 'no site'}).`;
    else if (raw < r.inputs[0].qty) P.mealNote = `Cooking is waiting for raw food: ${raw} usable (seed stock is protected), ${r.inputs[0].qty} per batch. Foraging and farming.`;
    else P.mealNote = `${mealBill.remaining} batch(es) of "${r.name}" queued.`;
  }

  // ---- Housing ----
  planHousing(g, P, ctx, cols, block, sid);
  // ---- Decor / optional furniture ----
  if (pol.fillDecorSlots) planDecor(g, P, pool, sid);
  // ---- Renovation (cosmetic/durable upgrades, only with surplus) ----
  planRenovation(g, P, pool, sid, cols);
  // ---- Farmland ----
  planFields(g, P, ctx, needPerDay, block, sid);
  // ---- Stockpile growth (every settlement grows its own zone) ----
  planStockpile(g, P, sid);
  // ---- Civic commitment: housing and workstation intents become projects (at most one per plan) ----
  commitIntents(g, P, sid, { templateUnlocked, templateCost, homeCapacity: homeCap });
  for (const it of intentsOf(P).values()) {
    if (it.blocked && it.need > 0) for (const src of it.sources) if (src.goal || src.forGoal) block(src.goal || src.forGoal, it.blocked.reason);
    if (it.kind === 'home' && it.blocked && it.need > 0 && it.blocked.kind !== 'wait' && !ctx.housingGoal) block(null, it.blocked.reason);
    for (const src of it.sources) if (src.forGoal && P.buildInfo[src.forGoal]) P.buildInfo[src.forGoal] = { built: it.completed, inflight: it.inFlight, need: it.need, count: it.target };
  }

  // ---- Things in the way of sites and fields ----
  for (const p of g.owned('projects', sid)) {
    if (p.status !== 'active' || !own(p)) continue;
    for (const [x, y] of p.cells) {
      const nd = g.nodeAt(x, y);
      if (nd) P.clear.set(nd.id, { urgency: (p.urgency ?? 1) + 0.3, why: `Clearing the site for ${p.name}` });
    }
  }
  for (const f of g.owned('fields', sid)) {
    if (!own(f)) continue;
    for (const [x, y] of fieldCells(f)) {
      const nd = g.nodeAt(x, y);
      if (nd && !P.clear.has(nd.id)) P.clear.set(nd.id, { urgency: 0.9, why: 'Clearing farmland' });
    }
  }

  // ---- Goals (player settlement) ----
  for (const goal of isPlayer ? s.goals : []) {
    const t = GOAL_TYPES[goal.type];
    if (!t) { P.goalInfo[goal.id] = { progress: 0, text: `Unknown goal type "${goal.type}" (from a missing mod?)`, blockers: [] }; continue; }
    let info;
    try { info = t.evaluate(g, goal, P); } catch (e) { info = { progress: 0, text: `Cannot evaluate: ${e.message}` }; }
    info.blockers = goal.status === 'active' && !info.done ? (P.blockers[goal.id] || []) : [];
    info.waits = goal.status === 'active' && !info.done ? (P.waits[goal.id] || []) : [];
    if (goal.status === 'active' && info.done && !goalIsOngoing(goal)) {
      goal.status = 'complete';
      goal.completedTick = s.tick;
      g.log(`Goal achieved: ${describeGoal(g, goal)}.`, 'good');
    }
    P.goalInfo[goal.id] = info;
  }
  P.colonyBlockers = P.blockers._colony || [];
  P.notes.push(...(P.waits._colony || []));
  void center;
  return P;
}

/**
 * Adapter for every planner step that needs a building to exist (recipes, meals, research, power, water,
 * medical, ...): it records a station intent (target: at least one) and reports the building's state.
 * Nothing is built here; civic commitment (src/sim/civic/commit.js) starts the project later in the plan.
 * States: 'built', 'building' (a project is under way), 'planned' (waiting its turn), 'blocked' (reason).
 */
function ensureStation(g, P, bid, urgency, why, sid, target = 1, kind = 'recipe') {
  const it = needStation(g, P, sid, bid, target, urgency, { kind, why }, templateUnlocked);
  if (target > 1) { const k = it.sources.length - 1; if (k > 0) it.sources.unshift(...it.sources.splice(k, 1)); } // sizing: its reason names the project
  const prev = P.stations[bid];
  if (prev) { if (prev.project) prev.project.urgency = Math.max(prev.project.urgency ?? 0, urgency + 0.2); return prev; } // once per plan
  const res = stationState(g, P, sid, it, urgency);
  P.stations[bid] = res;
  return res;
}
function stationState(g, P, sid, it, urgency) {
  if (it.completed > 0) return { state: 'built' };
  const s = g.s, own = (e) => (e?.settlement || s.playerSettlement) === sid;
  const proj = g.owned('projects', sid).find((p) => p.status === 'active' && own(p) && p.parts.some((id) => s.structures[id]?.def === it.building && !s.structures[id].built));
  if (proj) { proj.urgency = Math.max(proj.urgency ?? 0, urgency + 0.2); return { state: 'building', project: proj }; }
  if (it.blocked) return { state: 'blocked', reason: it.blocked.reason };
  const cached = cachedBlock(g, sid, it);
  if (cached) return { state: 'blocked', reason: cached.reason };
  return { state: 'planned', reason: 'planned, waiting its turn to be laid out' };
}

/** A template is usable when it and every building it always places are unlocked. */
export function templateUnlocked(g, sid, t) {
  if (!isUnlocked(g, sid, 'template', t.id)) return false;
  return parseTemplate(t).cells.every((c) => !c.spec?.build || isUnlocked(g, sid, 'building', c.spec.build));
}

function templateCost(g, t) {
  let total = 0;
  for (const c of parseTemplate(t).cells) {
    const bid = c.spec?.build || (c.spec?.slot && !c.spec.optional ? slotCandidates(g.reg, c.spec.slot)[0]?.id : null);
    const b = bid && g.reg.get('building', bid);
    if (b) for (const k of b.cost) total += k.qty;
  }
  return total;
}

function planHousing(g, P, ctx, cols, block, sid) {
  const s = g.s, pol = g.policyFor(sid), reg = g.reg;
  const own = (e) => (e?.settlement || s.playerSettlement) === sid;
  const homes = g.owned('homes', sid).filter(own);
  // Fill free beds in finished homes first.
  for (const h of homes) if (h.complete && h.owners.length < h.capacity && cols.some((c) => !c.homeId)) assignHome(g, h);
  const planned = homes.reduce((a, h) => a + h.capacity, 0);
  P.bedsBuilt = homes.filter((h) => h.complete).reduce((a, h) => a + partsOf(g, s.projects[h.projectId]).filter((st) => st.built && g.bDef(st)?.bed).length, 0);
  const target = Math.max(ctx.housingTarget, cols.length);
  const activeHomes = g.owned('projects', sid).filter((p) => p.kind === 'home' && own(p) && p.status === 'active' && !s.homes[p.homeId]?.complete);
  const notes = [];
  for (const p of activeHomes) {
    const parts = partsOf(g, p);
    const missing = {};
    for (const st of parts) if (!st.built) for (const c of g.bDef(st).cost) {
      const m = c.qty - (st.delivered[c.item] || 0);
      if (m > 0) missing[c.item] = (missing[c.item] || 0) + m;
    }
    const miss = Object.entries(missing).map(([it, q]) => `${q} ${iname(g, it)}`).join(', ');
    notes.push(`${p.name}: ${parts.filter((x) => x.built).length}/${parts.length} parts built${miss ? `; still needs ${miss}` : ''}`);
  }
  // Decide only: the housing intent is committed with the other civic intents at the end of the plan.
  const hi = needHousing(g, P, sid, ctx, cols, pol.maxActiveProjects ?? 2);
  if (planned < target && hi.blocked?.kind === 'wait') notes.push(hi.blocked.reason);
  if (ctx.housingGoal) for (const note of notes) (P.trace[ctx.housingGoal] ||= []).push({ depth: 0, text: note, state: 'working' });
  for (const p of activeHomes) if (!p.goal && ctx.housingGoal) p.goal = ctx.housingGoal;
  const cap = homes.reduce((a, h) => a + (h.complete ? h.capacity : 0), 0);
  P.housingNote = `${cap} beds in finished homes for ${cols.length} colonists. ${notes.join('. ')}`.trim();
  const furnished = cols.filter((c) => c.homeId && homeFurnished(g, s.homes[c.homeId])).length;
  P.furnishedCount = furnished;
}

function homeCap(g, t) { return t.capacity ?? parseTemplate(t).cells.filter((c) => c.spec?.slot === 'core:bed').length; }

function planDecor(g, P, pool, sid) {
  const s = g.s, reg = g.reg;
  const own = (e) => (e?.settlement || s.playerSettlement) === sid;
  // Only decorate when no home is still being built (homes first).
  const busy = g.owned('projects', sid).some((p) => p.kind === 'home' && own(p) && p.status === 'active' && !s.homes[p.homeId]?.complete);
  if (busy) return;
  for (const p of g.owned('projects', sid)) {
    if (p.kind !== 'home' || !own(p) || !s.homes[p.homeId]?.complete || p.status !== 'complete' || p.renovating) continue;
    for (const slot of p.slots || []) {
      if (slot.filled && s.structures[slot.filled]) continue;
      if (g.structAt(slot.x, slot.y)) continue;
      // stockedOnly pieces (plank furniture) only while their whole cost is in stock; then they come first.
      const cands = slotCandidates(reg, slot.tag).filter((b) => isUnlocked(g, sid, 'building', b.id) && (b.stockedOnly
        ? b.cost.every((c) => (pool[c.item] || 0) >= c.qty)
        : b.cost.every((c) => (pool[c.item] || 0) > 0 || (reg.idx.recipesFor[c.item] || []).length || (reg.idx.nodesFor[c.item] || []).length)));
      if (!cands.length) continue;
      cands.sort((a, b) => (b.stockedOnly ? 1 : 0) - (a.stockedOnly ? 1 : 0) || (b.furnishing?.score || 0) - (a.furnishing?.score || 0));
      const b = cands[0];
      addSlotPart(g, p, slot, b.id);
      p.urgency = 0.35;
      p.why = `Furnishing the ${p.name}`;
      g.log(`The colonists decided to add a ${b.name} to the ${p.name}.`, 'build');
      return; // one at a time
    }
  }
}

function planFields(g, P, ctx, needPerDay, block, sid) {
  const s = g.s, reg = g.reg, pol = g.policyFor(sid);
  const own = (e) => (e?.settlement || s.playerSettlement) === sid;
  const crops = reg.all('crop').filter((c) => (P.stock[c.seed] || 0) > 0 || g.owned('fields', sid).some((f) => own(f) && f.crop === c.id));
  if (!crops.length) { if (needPerDay > 0) P.notes.push('No seeds of any crop: relying on wild food.'); return; }
  P.sowOk = Object.fromEntries(reg.all('crop').map((c) => [c.id, canRipen(g, c)]));
  const rate = crops.reduce((a, c) => a + cropNutritionRate(g, c), 0) / crops.length;
  if (rate <= 0) return;
  let desired = Math.ceil((needPerDay * 1.3) / rate) * (1 + Math.max(0, ctx.foodDays - 3) * 0.12);
  if ((P.farmPressure || 0) > 0 && P.foodDays < ctx.foodDays) desired *= 1.15;
  desired = Math.min(desired, pol.maxFieldTiles ?? 80);
  const current = g.owned('fields', sid).filter(own).reduce((a, f) => a + f.w * f.h, 0);
  P.fieldTarget = Math.round(desired);
  if (current >= desired) return;
  const [w, h] = pol.fieldSize || [4, 4];
  const tiles = (cid) => g.owned('fields', sid).filter((f) => own(f) && f.crop === cid).reduce((a, f) => a + f.w * f.h, 0);
  const withSeed = crops.filter((c) => (P.stock[c.seed] || 0) >= 4 && P.sowOk[c.id]);
  if (!withSeed.length) return;
  withSeed.sort((a, b) => tiles(a.id) - tiles(b.id));
  const crop = withSeed[0];
  const site = findFieldSite(g, w, h, crop, settlementOf(g, sid)?.center, sid);
  if (!site) { block(ctx.foodGoal, 'No free fertile land near the colony for more fields'); return; }
  createField(g, crop, site, w, h, sid);
}

/** The coming lean season, if any: { startsIn, days } — when sowing stops paying off, and how long until
 *  the first harvest after it. Checked a day at a time over the year ahead, for the crops this settlement has. */
function leanSeason(g, sid) {
  const crops = g.reg.all('crop').filter((c) => g.owned('fields', sid).some((f) => (f.settlement || g.s.playerSettlement) === sid && f.crop === c.id));
  if (!crops.length) return null;
  const k = Math.floor(g.s.tick / (TICKS_PER_DAY / 2)) + ':' + crops.map((c) => c.id).join(',');
  if (g._lean?.[sid]?.k === k) return g._lean[sid].v;
  const t0 = Math.floor(g.s.tick / (TICKS_PER_DAY / 2)) * (TICKS_PER_DAY / 2); // from the window's start, so saves continue identically
  const ok = (d) => crops.some((c) => canRipen(g, c, t0 + d * TICKS_PER_DAY));
  let v = null;
  for (let d = 0; d <= 10; d++) {
    if (ok(d)) continue;
    let e = d;
    while (e < d + 40 && !ok(e)) e++;
    const grow = Math.min(...crops.map((c) => c.growDays));
    v = { startsIn: d, days: e - d + grow + Math.max(0, -d) };
    break;
  }
  (g._lean ||= {})[sid] = { k, v };
  return v;
}

function planStockpile(g, P, sid) {
  const s = g.s, pol = g.policyFor(sid);
  P.storage = storageStatus(g, sid);
  const pile = g.stockpileOf(sid);
  const center = settlementOf(g, sid)?.center || s.center;
  let free = 0;
  if (!pile.length) return;
  for (const k of pile) {
    const [x, y] = k.split(',').map(Number);
    if (!g.stackAt(x, y) && !g.isReserved(`tile:${x},${y}`)) free++;
  }
  if (free >= (pol.stockpileMinFree ?? 4) && !P.stockFull) return;
  const have = new Set(pile);
  const cands = [];
  for (const k of pile) {
    const [x, y] = k.split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, nk = `${nx},${ny}`;
      if (have.has(nk) || !g.inB(nx, ny)) continue;
      const t = g.terrainAt(nx, ny);
      const i = g.i(nx, ny);
      if (!t.passable || !t.buildable || g.nodeIdAt(i) || g.structIdAt(i) || g.footIdAt(i) || g.zoneAt(i) || g.fieldAt(nx, ny) || g.cropAt(nx, ny)) continue;
      // keep door fronts clear
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ex, ey]) => { const d = g.structAt(nx + ex, ny + ey); return d && g.bDef(d)?.category === 'door'; })) continue;
      let nearSite = false;
      for (let ey = -1; ey <= 1; ey++) for (let ex = -1; ex <= 1; ex++) if (g.inB(nx + ex, ny + ey) && g.footIdAt(g.i(nx + ex, ny + ey))) nearSite = true;
      const area = sid === s.playerSettlement ? s.allowedArea : null; // the player's settlement area applies to the hub too
      if (area && (nx < area.x0 || ny < area.y0 || nx > area.x1 || ny > area.y1)) continue;
      if (nearSite || !g.claimOk(sid, nx, ny)) continue;
      have.add(nk);
      cands.push({ k: nk, x: nx, y: ny, d: Math.abs(nx - center.x) + Math.abs(ny - center.y) });
    }
  }
  cands.sort((a, b) => a.d - b.d || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)); // not localeCompare: its order depends on the machine locale
  const add = cands.slice(0, 6);
  if (!add.length) { P.notes.push('The stockpile is full and has no room to grow.'); return; }
  for (const c of add) { pile.push(c.k); g.setZone(g.i(c.x, c.y), 'S:' + sid); }
  if (sid === s.playerSettlement) g.log(`The ${hubName(g, sid)} were extended by ${add.length} tiles.`, 'info', 'stockgrow', 300);
}

/**
 * Autonomous renovation: once a building's upgrade target is researched and the settlement has a clear
 * surplus, finished homes are upgraded part by part (e.g. log walls -> stone walls). Each part stays built
 * and standing while it is renovated, so residents, furniture, doors and shelter are never disturbed.
 * Renovation is low priority and pauses whenever food or housing need attention.
 */
function planRenovation(g, P, pool, sid, cols) {
  const s = g.s, reg = g.reg, pol = g.policyFor(sid);
  if (pol.renovate === false) return;
  const own = (e) => (e?.settlement || s.playerSettlement) === sid;
  const projects = g.owned('projects', sid).filter((p) => own(p) && p.kind === 'home');
  // Progress report for whatever is being renovated.
  const active = projects.filter((p) => p.renovating);
  for (const p of active) {
    const parts = partsOf(g, p).filter((st) => st.reno);
    if (!parts.length) { p.renovating = false; g.log(`Renovation of the ${p.name} is finished.`, 'build'); continue; }
    const total = p.renoTotal || parts.length;
    P.renovation = { project: p.id, name: p.name, done: total - parts.length, total };
    for (const st of parts) {
      const to = reg.get('building', st.reno.to);
      for (const c of to?.cost || []) {
        const need = c.qty - (st.reno.delivered[c.item] || 0) - g.incoming(st.id, c.item);
        if (need > 0 && (pool[c.item] || 0) > 0) { /* hauling handles it; nothing to gather specially */ }
      }
    }
  }
  if (active.length) return;
  // Start a new renovation only with a real surplus and nothing essential going on.
  const minFood = pol.renovateMinFoodDays ?? 3;
  if (P.foodDays < minFood) return;
  if (cols.some((c) => !c.homeId)) return;
  const busy = g.owned('projects', sid).some((p) => own(p) && p.status === 'active');
  if (busy) return;
  for (const p of projects) {
    if (p.status !== 'complete') continue;
    const cands = partsOf(g, p).filter((st) => st.built && !st.reno && g.bDef(st)?.upgrade && isUnlocked(g, sid, 'building', g.bDef(st).upgrade.to));
    if (!cands.length) continue;
    // Surplus: enough of every material for the whole job, plus the settlement's basic stock target.
    const need = {};
    for (const st of cands) for (const c of reg.get('building', g.bDef(st).upgrade.to).cost) need[c.item] = (need[c.item] || 0) + c.qty;
    const ok = Object.entries(need).every(([it, q]) => (pool[it] || 0) >= q + (pol.stock?.[it] || 0) * 0.5);
    if (!ok) {
      const miss = Object.entries(need).map(([it, q]) => `${q} ${iname(g, it)}`).join(', ');
      P.notes.push(`Stockpiling for a renovation of the ${p.name} (${cands.length} parts): needs a surplus of ${miss}.`);
      // Gather toward the surplus slowly (lowest urgency, never ahead of food or housing).
      for (const [it, q] of Object.entries(need)) {
        const short = q + Math.ceil((pol.stock?.[it] || 0) * 0.5) - (pool[it] || 0);
        if (short <= 0 || !(reg.idx.nodesFor[it] || []).length) continue;
        const w = P.wants[it];
        if (w) w.remaining += short; else P.wants[it] = { remaining: short, urgency: 0.15, why: `Stockpiling for renovating the ${p.name}` };
      }
      return;
    }
    for (const st of cands) st.reno = { to: g.bDef(st).upgrade.to, delivered: {}, progress: 0 };
    p.renovating = true; p.renoTotal = cands.length; p.renoStarted = s.tick;
    p.why = `Renovating the ${p.name}`;
    g.log(`The colonists decided to renovate the ${p.name}: ${cands.length} parts will be rebuilt as ${reg.get('building', cands[0].reno.to)?.name}.`, 'build');
    return;
  }
}

// ---- Sizing (Phase 3 slice 3): machine and generator counts sized to sustained demand ----
// Data per building: machineHours (hours of work one machine is counted on to do per day) and
// maxMachines (the most of that kind a settlement builds). The rolling records live in the plan
// (P.sizing, plain data, saved with the plans) and are carried from one plan to the next; nothing is ever
// removed. Abstract (distant) villages size machines from their bills like any other village (they have no
// live jobs, so the "machines busy" condition is skipped for them), but never generators: their load is not
// simulated until Phase 3 slice 6, so no overload is ever sampled for them.
export const SIZING = {
  machineHours: 8, // default building.machineHours
  maxMachines: 3, // default building.maxMachines (machines and generators alike)
  sustainTicks: TICKS_PER_DAY, // workable demand above the machines' capacity at every plan for this long...
  busyTicks: 6 * TICKS_PER_HOUR, // ...while all machines of the kind were seen busy for this long, before another
  lowRatio: 0.9, // a power sample is "overloaded" when the generators' capacity < lowRatio × demand
  lowTicks: 6 * TICKS_PER_HOUR, // ...and another generator is wanted after this much overload (most of a working day)
  window: TICKS_PER_DAY, // ...within the last day
  workersPerMachine: 2, // machines that share a kind of work: at most one per this many people who may do it
  machinePriority: 0.35, // intent priority of an extra machine (when sizing is its only reason)
  generatorPriority: 0.6, // intent priority of an extra generator (when sizing is its only reason)
};
/** Work types of the recipes made at a powered machine station (empty for other buildings). */
const machineWorkTypes = (reg, bid) => new Set(reg.get('building', bid)?.power?.use > 0 ? reg.all('recipe').filter((r) => r.station === bid).map((r) => r.workType) : []);
const ordinal = (n) => n + ((n % 100 >= 11 && n % 100 <= 13) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const usableTick = (v, tick) => Number.isFinite(v) && v <= tick; // a tick from a loaded record that can be used

/** Ask for one more of a station for sizing. When the station intent had no other reason to want more than are
 *  completed, its priority is the sizing priority (not the bills' urgency, which can beat homes). */
function sizingStation(g, P, sid, bid, completed, priority, why) {
  const before = intentsOf(P).get('station:' + bid)?.target ?? 0;
  const r = ensureStation(g, P, bid, priority, why, sid, completed + 1, 'sizing');
  const it = intentsOf(P).get('station:' + bid);
  if (it && before <= completed) it.priority = priority;
  return r;
}

/** More machines of a kind when the workable runs of this plan's bills for it (ingredients in stock or being
 *  made, every machine of the kind able to run) are more than its machines do in a day, at every plan for
 *  SIZING.sustainTicks, while all its machines were seen busy for SIZING.busyTicks (sampled once per plan
 *  interval). Target: ceil(work / work one machine does a day), at most maxMachines, and at most one machine
 *  (of all kinds sharing the work type) per SIZING.workersPerMachine people who may do the work; one new
 *  machine at a time (also across kinds: it waits while another machine is under way). Cost: O(bills +
 *  colonists + building kinds × recipes) per plan, only when a powered machine has bills. */
function planMachineCount(g, P, sid, cols, machineUnderWay, readyRuns, machineRuns) {
  const reg = g.reg, s = g.s;
  const prev = g.plans?.[sid]?.sizing?.machines;
  const kinds = new Map(); // station -> work, runs, what is made, urgency, work type (in bill order)
  for (const b of P.bills) {
    const r = reg.get('recipe', b.recipe);
    if (!r || !(reg.get('building', r.station)?.power?.use > 0)) continue;
    const runs = Math.min(b.remaining, readyRuns.get(r.id) || 0); // runs waiting for ingredients do not count
    if (runs <= 0) continue;
    let e = kinds.get(r.station);
    if (!e) kinds.set(r.station, (e = { work: 0, runs: 0, items: new Map(), urgency: 0, wt: r.workType }));
    e.work += r.work * runs;
    e.runs += runs;
    e.urgency = Math.max(e.urgency, b.urgency);
    const nm = iname(g, r.outputs[0].item).toLowerCase();
    e.items.set(nm, (e.items.get(nm) || 0) + runs);
  }
  if (!kinds.size) return;
  const counts = countsOf(g, P, sid);
  const abstract = s.settlements?.[sid]?.detail === 'abstract';
  let busySet = null;
  const out = {};
  for (const [bid, e] of kinds) {
    const def = reg.get('building', bid);
    const c = counts.get(bid) || { built: 0, inflight: 0 };
    if (!c.built) continue; // the first machine comes from resolve()
    const old = prev?.[bid] && typeof prev[bid] === 'object' ? prev[bid] : null;
    // A machine that cannot run (no power, broken, no fuel) is no reason for another: the record waits.
    if (machineRuns.get(bid) === false) { if (old) out[bid] = { ...old, state: 'paused' }; continue; }
    const perDay = (def.machineHours ?? SIZING.machineHours) * TICKS_PER_HOUR; // work units at normal speed
    // People who may do the work, shared with the other machines that use the same kind of work.
    const workers = cols.filter((x) => !x.workOff?.[e.wt] && mayDoWork(g, x, e.wt)).length;
    let others = 0;
    for (const [k, n] of counts) if (k !== bid && n.built + n.inflight > 0 && machineWorkTypes(reg, k).has(e.wt)) others += n.built + n.inflight;
    const most = Math.min(def.maxMachines ?? SIZING.maxMachines, Math.max(1, Math.ceil(workers / SIZING.workersPerMachine) - others));
    const want = Math.max(1, Math.min(most, Math.ceil(e.work / perDay)));
    const have = c.built + c.inflight;
    if (want <= have) continue; // enough: the record lapses, so demand must build up again before another
    const nm = def.name.toLowerCase();
    const what = [...e.items].map(([n, q], i) => (i ? `${q} of ${n}` : `${q} run${q === 1 ? '' : 's'} of ${n}`)).join(' and ');
    const why = `${ordinal(have + 1)} ${nm}: ${what} wait (one ${nm} does ${Math.max(1, Math.floor((perDay * e.runs) / e.work))} a day)`;
    // While one is being built the record restarts, so the next one needs a full window with the new machine.
    const fresh = c.inflight > 0 || !usableTick(old?.since, s.tick);
    const since = fresh ? s.tick : old.since;
    let busy = fresh || !Number.isFinite(old?.busy) ? 0 : Math.max(0, old.busy);
    let last = fresh || !usableTick(old?.last, s.tick) ? -Infinity : old.last;
    if (s.tick - last >= PLAN_INTERVAL) {
      // Busy sample: every built machine of the kind is being worked right now.
      busySet ||= busyStationsOf(g, sid);
      const mine = g.owned('structures', sid).filter((y) => y.built && y.def === bid && (y.settlement || s.playerSettlement) === sid);
      if (mine.length && mine.every((y) => busySet.has(y.id))) busy += PLAN_INTERVAL;
      last = s.tick;
    }
    const rec = (out[bid] = { since, busy, last, want, have, why, state: c.inflight ? 'building' : 'pending' });
    if (c.inflight || s.tick - since < SIZING.sustainTicks || (!abstract && busy < SIZING.busyTicks)) continue;
    const other = machineUnderWay(bid);
    if (other) { rec.state = 'waiting'; rec.waitFor = other; continue; }
    rec.state = 'wanted';
    sizingStation(g, P, sid, bid, c.built, Math.min(e.urgency, SIZING.machinePriority), why);
  }
  if (Object.keys(out).length) (P.sizing ||= {}).machines = out;
}

/** One power sample per plan interval for the settlement's most loaded network; only overloaded ones are kept
 *  ([tick, demand, capacity]: a generator running and the built generators' capacity below SIZING.lowRatio ×
 *  demand; a broken or unfuelled generator still counts as capacity), and only those of the last
 *  SIZING.window. Cost per plan: O(the settlement's colonists and powered buildings + networks), nothing
 *  cached (power.js settlementLoad). */
function samplePower(g, P, sid, gensBuilt) {
  const s = g.s;
  const prev = g.plans?.[sid]?.sizing?.power;
  const last = usableTick(prev?.last, s.tick) ? prev.last : -Infinity;
  // A generator was added (or lost): the load is measured afresh. (A loaded save's record is checked.)
  const ok = (x) => Array.isArray(x) && x.length === 3 && x.every(Number.isFinite) && x[0] <= s.tick && x[0] > s.tick - SIZING.window;
  let samples = prev?.gens === gensBuilt && Array.isArray(prev.samples) ? prev.samples.filter(ok) : [];
  let lastTick = last;
  if (s.tick - last >= PLAN_INTERVAL) {
    const worst = settlementLoad(g, sid);
    if (worst && worst.capacity < SIZING.lowRatio * worst.demand) samples = [...samples, [s.tick, worst.demand, worst.capacity]];
    lastTick = s.tick;
  }
  const rec = { last: lastTick, gens: gensBuilt, samples, state: samples.length ? 'pending' : 'enough' };
  (P.sizing ||= {}).power = rec;
  return rec;
}

// ---- Power (Phase 3): generators for machines, pole lines to connect them, fuel to run them ----
function planPower(g, P, sid, D) {
  const s = g.s, reg = g.reg;
  const own = (e) => (e?.settlement || s.playerSettlement) === sid;
  const powered = g.owned('structures', sid).filter((st) => own(st) && g.bDef(st)?.power);
  const machines = powered.filter((st) => g.bDef(st).power.use > 0);
  const gens = powered.filter((st) => g.bDef(st).power.output > 0);
  // Keep every generator's fuel store topped up (fuel only burns while a machine is in use).
  for (const st of gens) {
    const pw = g.bDef(st).power;
    if (!pw.fuel) continue;
    const need = pw.fuel.capacity - fuelLoaded(st);
    if (need > 0) D.push({ tag: pw.fuel.tag, qty: need, urgency: 0.6, why: `Fuel for the ${g.bDef(st).name}` });
  }
  for (const st of powered) {
    const m = g.bDef(st).maintenance;
    if (st.built && m && (st.condition ?? 100) < 60) for (const c of m.cost || []) D.push({ item: c.item, qty: c.qty, urgency: (st.condition ?? 100) <= 0 ? 1.1 : 0.65, why: `Service the ${g.bDef(st).name}` });
  }
  if (!machines.length) return;
  P.powerNote = '';
  if (!gens.length) {
    const genDef = reg.all('building').find((b) => b.power?.output > 0 && isUnlocked(g, sid, 'building', b.id));
    if (genDef) {
      const r = ensureStation(g, P, genDef.id, 0.8, `Power for the ${g.bDef(machines[0]).name}`, sid);
      if (r.state === 'blocked') P.powerNote = r.reason;
    } else P.powerNote = 'No generator can be built yet (research Electricity)';
    return;
  }
  const load = samplePower(g, P, sid, gens.filter((x) => x.built).length);
  const poleDef = reg.all('building').find((b) => b.power?.reach > 0 && !b.power.output && !b.power.use && !b.power.store && isUnlocked(g, sid, 'building', b.id));
  const poleTpl = poleDef && reg.all('template').find((t) => Object.values(t.legend).some((l) => l.build === poleDef.id) && templateUnlocked(g, sid, t));
  const { nets, comp } = networks(g, true);
  for (const m of machines) {
    const net = nets[comp.get(m.id)];
    if (net.members.some((x) => g.bDef(x).power.output > 0)) continue; // connected (or will be once built)
    if (!poleTpl) { P.powerNote = `The ${g.bDef(m).name} is not connected and power poles cannot be built yet`; return; }
    const gen = gens.slice().sort((a, b) => Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y))[0];
    const laid = layPoles(g, sid, net.members, gen, poleDef, poleTpl, m);
    if (laid < 0) P.powerNote = `No room for power poles between the ${g.bDef(gen).name} and the ${g.bDef(m).name}`;
    return; // one line per plan; the next plan sees the new blueprints
  }
  // A generator on a network without machines (an extra one, sized below) is wired to the nearest machine.
  for (const gen of gens) {
    const net = nets[comp.get(gen.id)];
    if (!net || net.members.some((x) => g.bDef(x).power.use > 0)) continue;
    if (!poleTpl) { P.powerNote = `The ${g.bDef(gen).name} is not connected and power poles cannot be built yet`; return; }
    const m = machines.slice().sort((a, b) => Math.hypot(a.x - gen.x, a.y - gen.y) - Math.hypot(b.x - gen.x, b.y - gen.y))[0];
    const laid = layPoles(g, sid, net.members, m, poleDef, poleTpl, gen);
    if (laid < 0) P.powerNote = `No room for power poles between the ${g.bDef(gen).name} and the ${g.bDef(m).name}`;
    return;
  }
  // A battery bank on a network without a generator (placed out of reach, or its generator gone) is wired to the
  // nearest generator.
  for (const b of powered) {
    if (!(g.bDef(b).power.store > 0)) continue;
    const net = nets[comp.get(b.id)];
    if (!net || net.members.some((x) => g.bDef(x).power.output > 0)) continue;
    if (!poleTpl) { P.powerNote = `The ${g.bDef(b).name} is not connected and power poles cannot be built yet`; return; }
    const gen = gens.slice().sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y))[0];
    const laid = layPoles(g, sid, net.members, gen, poleDef, poleTpl, b);
    if (laid < 0) P.powerNote = `No room for power poles between the ${g.bDef(gen).name} and the ${g.bDef(b).name}`;
    return;
  }
  planGenerators(g, P, sid, gens, load);
  planBatteries(g, P, sid, gens, powered);
}

/** Power storage: once a battery bank can be built, put one beside a built generator of each network that has
 *  none (one at a time; placed within reach of the generator, else wired by the loop above). Batteries store the
 *  generators' surplus while machines run and cover shortfalls (power.js). */
function planBatteries(g, P, sid, gens, powered) {
  const reg = g.reg;
  const batDef = reg.all('building').find((b) => b.power?.store > 0 && isUnlocked(g, sid, 'building', b.id));
  if (!batDef) return;
  const tpl = reg.all('template').find((t) => Object.values(t.legend).some((l) => l.build === batDef.id) && templateUnlocked(g, sid, t));
  if (!tpl) return;
  const bats = powered.filter((st) => g.bDef(st).power.store > 0);
  const unbuilt = bats.filter((st) => !st.built).length;
  const near = [];
  if (!unbuilt) {
    const { nets, comp } = networks(g, true);
    const done = new Set();
    for (const gen of gens) {
      if (!gen.built) continue;
      const i = comp.get(gen.id);
      if (i === undefined || done.has(i)) continue;
      done.add(i);
      if (nets[i].members.some((x) => g.bDef(x).power.store > 0)) continue;
      near.push({ x: gen.x, y: gen.y, r: 3, pen: 2, name: `the ${g.bDef(gen).name}` });
    }
  }
  needUtility(g, P, sid, {
    key: 'battery', building: batDef.id, template: tpl.id, near, oneAtATime: true,
    completed: bats.length - unbuilt, inFlight: unbuilt, label: `a ${batDef.name.toLowerCase()}`,
    why: `${batDef.name}: stores ${batDef.power.store} for shortfalls at {name}`, log: `The colonists are setting up a ${batDef.name.toLowerCase()} by {name}.`,
  });
}

/** Another generator when the generators' capacity was below SIZING.lowRatio × demand for SIZING.lowTicks of the
 *  last day (short spikes and machines that run only now and then do not count; lamps are left out of the
 *  demand, as they light at any power above 0); one at a time, at most maxMachines. The reason names the
 *  demand and supply (capacity) of the latest overloaded sample. The state is kept in P.sizing.power for the
 *  machine panel (industry.js machineStatus). */
function planGenerators(g, P, sid, gens, load) {
  const reg = g.reg;
  const low = load.samples;
  const genDef = reg.get('building', gens[0].def);
  load.most = genDef.maxMachines ?? SIZING.maxMachines;
  if (gens.some((x) => !x.built)) { load.state = 'building'; return; } // one at a time
  if (low.length * PLAN_INTERVAL < SIZING.lowTicks) return;
  const [, d, sup] = low[low.length - 1];
  if (gens.length >= load.most) {
    load.state = 'most';
    P.powerNote = `Machines need more power (demand ${d}, supply ${sup}), but ${gens.length} generators is the most this colony builds`;
    return;
  }
  const why = `${ordinal(gens.length + 1)} ${genDef.name.toLowerCase()}: demand ${d}, supply ${sup} (overloaded ${Math.round((low.length * PLAN_INTERVAL) / TICKS_PER_HOUR)} of the last 24 hours)`;
  load.state = 'wanted';
  load.why = why;
  const r = sizingStation(g, P, sid, genDef.id, gens.length, SIZING.generatorPriority, why);
  if (r.state === 'blocked') P.powerNote = r.reason;
}

/** Electric lighting: once lamps can be built, put a lamp beside each workplace (and the stockpile) that no
 *  light reaches; the power planner then builds a generator if needed and wires it up. One lamp at a time. */
function planLighting(g, P, sid) {
  const s = g.s, reg = g.reg;
  const own = (e) => (e?.settlement || s.playerSettlement) === sid;
  const lampDef = reg.all('building').find((b) => b.light && b.power?.use && isUnlocked(g, sid, 'building', b.id));
  if (!lampDef) return;
  const tpl = reg.all('template').find((t) => Object.values(t.legend).some((l) => l.build === lampDef.id) && templateUnlocked(g, sid, t));
  if (!tpl) return;
  const structs = g.owned('structures', sid).filter(own);
  if (!reg.all('building').some((b) => b.power?.output > 0 && isUnlocked(g, sid, 'building', b.id))) return; // lamps need a generator we can build
  // Lamps waiting to be built or wired come first: one new lamp at a time (an unbuilt lamp is in flight).
  const lamps = structs.filter((st) => g.bDef(st)?.light && g.bDef(st).power?.use);
  const unbuilt = lamps.filter((st) => !st.built).length;
  const near = [];
  if (!unbuilt) {
    const lights = structs.filter((st) => g.bDef(st)?.light);
    const covered = (x, y) => lights.some((l) => (l.x - x) ** 2 + (l.y - y) ** 2 <= g.bDef(l).light.radius ** 2);
    const spots = structs.filter((st) => st.built && g.bDef(st)?.category === 'station').map((st) => ({ x: st.x, y: st.y, name: g.bDef(st).name }));
    const pile = settlementOf(g, sid)?.center;
    if (pile) spots.push({ x: pile.x, y: pile.y, name: 'stockpile' });
    // Search 3 tiles round each unlit target, in this order; a spot right beside it costs 2 (not in the way).
    for (const t of spots) if (!covered(t.x, t.y)) near.push({ x: t.x, y: t.y, r: 3, pen: 2, name: `the ${t.name}` });
  }
  // Decide only: civic commitment (src/sim/civic/commit.js) finds the spot and starts the project.
  needUtility(g, P, sid, {
    key: 'lamp', building: lampDef.id, template: tpl.id, near, oneAtATime: true, cover: lampDef.light.radius,
    completed: lamps.length - unbuilt, inFlight: unbuilt, label: `${/^[aeiou]/i.test(lampDef.name) ? 'an' : 'a'} ${lampDef.name.toLowerCase()}`,
    why: 'Light for {name} after dark', log: 'The colonists are putting up an electric lamp by {name}.',
  });
}

/**
 * Goal-driven construction and era progress. Era goals become subgoals from the era's own milestone data:
 * missing buildings become building targets, missing research becomes wanted research (never in a field
 * the player switched Off), and anything the colony cannot do on its own is reported as a blocker.
 * Building targets count completed buildings toward the target and in-flight ones against duplicates:
 * need = target - completed - under construction; at most one new project per plan.
 */
function planBuildTargets(g, P, sid, ctx, block) {
  const s = g.s, reg = g.reg;
  const r = settlementOf(g, sid)?.research;
  P.buildInfo = {};
  P.goalTechs = [];
  P.eraInfo = {};
  const targets = [...ctx.buildCounts];
  const outer = block;
  for (const eg of ctx.eraGoals) {
    // The era drive (no player goal) reports nothing as a blocker: what it cannot do waits quietly.
    block = eg.drive ? () => {} : outer;
    const target = reg.get('era', eg.era);
    if (!target || !r) { block(eg.goal, `Unknown era "${eg.era}"`); continue; }
    const cur = reg.get('era', r.era)?.order ?? 0;
    if (cur >= target.order) continue;
    // The next era by its place in the era list (as research.js checkEra advances); none: nothing to work toward.
    const eras = reg.idx.eras, ci = eras.findIndex((e) => e.id === r.era);
    const next = ci >= 0 ? eras[ci + 1] : eras.find((e) => e.order > cur);
    if (!next) continue;
    const info = { era: next.id, milestones: [] };
    for (const m of milestoneStatus(g, sid, next).map((x, i) => ({ ...x, def: { ...next.milestones[i] } }))) {
      info.milestones.push(m);
      if (m.ok) continue;
      if (m.def.type === 'buildings') targets.push({ building: m.def.building, count: m.def.count, urgency: eg.urgency, goal: eg.goal, era: true, ...(eg.drive ? { drive: true } : {}) });
      else if (m.def.type === 'techs') {
        const pool = reg.all('tech').filter((t) => !r.done.includes(t.id) && techInScenario(g, t) && (!m.def.era || t.era === m.def.era) && (!m.def.field || t.field === m.def.field));
        const open = pool.filter((t) => (r.priorities[t.field] ?? 2) > 0);
        const elig = new Set(eligibleTechs(g, sid).map((t) => t.id));
        const now = open.filter((t) => elig.has(t.id));
        P.goalTechs.push(...now.map((t) => t.id));
        if (!open.length && pool.length) {
          const off = [...new Set(pool.map((t) => reg.get('techField', t.field)?.name || t.field))].join(', ');
          block(eg.goal, `${m.text}: the remaining research is in fields you switched Off (${off}). Turn one on in the research panel to continue.`);
        } else if (!pool.length) block(eg.goal, `${m.text}: not enough technologies exist for this milestone`);
        else if (!now.length) block(eg.goal, `${m.text}: waiting for prerequisites of the remaining research`);
      } else if (m.def.type === 'colonists') block(eg.goal, `${m.text}: ${m.have}/${m.need} settlers. New settlers do not arrive on their own yet, so this needs more people from the scenario or a mod.`);
      else block(eg.goal, `${m.text}: the colony cannot work toward this milestone type on its own`);
    }
    P.eraInfo[eg.drive ? '_drive' : eg.goal] = info;
  }
  block = outer;
  // Each building target becomes (part of) a station intent; the largest target wins. Completed buildings count
  // toward it, ones under way count against duplicates. Projects are started by civic commitment later.
  for (const t of targets) {
    const src = t.drive ? { kind: 'milestone', why: 'Advancing to the next era' } : { kind: t.era ? 'milestone' : 'goal', why: 'goal', goal: t.goal, forGoal: t.goal };
    const it = needStation(g, P, sid, t.building, t.count, t.urgency, src, templateUnlocked);
    if (it.blocked?.kind === 'research') { P.goalTechs.push(...(it.blocked.techs || [])); if (!t.drive) block(t.goal, it.blocked.reason); }
    else if (it.blocked && !t.drive) block(t.goal, it.blocked.reason);
    P.buildInfo[t.drive ? '_drive' : t.goal] = { built: it.completed, inflight: it.inFlight, need: it.need, count: it.target };
    // Push the projects already under way.
    for (const p of g.owned('projects', sid)) if (p.status === 'active' && (p.settlement || s.playerSettlement) === sid && p.parts.some((id) => s.structures[id]?.def === t.building && !s.structures[id].built)) p.urgency = Math.max(p.urgency ?? 0, t.urgency + 0.2);
  }
}


/** Education: a school once there are children (or infants who soon will be), a lecture hall when the
 *  settlement lacks qualified staff that a course could provide; research for either when needed (never in
 *  a field switched Off). Both become ordinary station intents. */
function planEducation(g, P, sid) {
  const reg = g.reg, s = g.s;
  P.eduTechs = [];
  const r = settlementOf(g, sid)?.research;
  const open = (bid) => requiredTechs(g, 'building', bid).filter((t) => (r?.priorities?.[reg.get('tech', t)?.field] ?? 2) > 0);
  const role = (x) => reg.all('building').find((b) => b.education?.role === x);
  const kids = g.owned('colonists', sid).filter((c) => (c.settlementId || s.playerSettlement) === sid && reg.get('lifeStage', c.stage)?.untilDays !== undefined && !(c.quals || []).includes('core:schooled'));
  const teacher = role('teacher');
  if (kids.length && teacher) {
    if (isUnlocked(g, sid, 'building', teacher.id)) ensureStation(g, P, teacher.id, 0.6, 'A school for the children', sid);
    else P.eduTechs.push(...open(teacher.id));
  }
  const lectern = role('lectern');
  const short = staffing(g, sid).filter((x) => x.short > 0 && reg.get('qualification', x.qual)?.course);
  if (short.length && lectern) {
    if (isUnlocked(g, sid, 'building', lectern.id)) ensureStation(g, P, lectern.id, 0.45, `Training: the colony lacks a ${short[0].name}`, sid);
    else if (r?.done?.some((t) => (reg.get('tech', t)?.unlocks?.buildings || []).includes(teacher?.id))) P.eduTechs.push(...open(lectern.id));
  }
  P.education = educationSummary(g, sid);
}

/** Markets (markets.js): a village that knows how to build the scenario's market building and has met at
 *  least market.minContacts villages (not hostile) builds one (one per village), with the reason shown on the
 *  project; one that has met at least market.researchContacts wants the research for it (never in a field
 *  switched Off, and only where the scenario turns markets on). Nothing at all where the building is locked
 *  and its research cannot be done here (classic scenarios), so their plans are unchanged. O(villages). */
function planMarket(g, P, sid) {
  const reg = g.reg, rules = marketRules(g), bid = rules.building;
  if (!reg.get('building', bid)) return;
  const unlocked = isUnlocked(g, sid, 'building', bid);
  const r = settlementOf(g, sid)?.research;
  const techs = unlocked ? [] : requiredTechs(g, 'building', bid).filter((t) => techInScenario(g, reg.get('tech', t)) && (r?.priorities?.[reg.get('tech', t)?.field] ?? 2) > 0);
  if (!unlocked && !techs.length) return;
  let n = 0;
  for (const o of Object.keys(g.s.settlements || {})) {
    if (o === sid) continue;
    const rel = relationPeek(g, sid, o);
    if (rel.contact && relationStatus(rel) !== 'hostile') n++;
  }
  if (unlocked) {
    if (n >= rules.minContacts) {
      const st = ensureStation(g, P, bid, rules.urgency, `Trades with ${n} neighbour${n === 1 ? '' : 's'}`, sid); // the project shows "Market stall: Trades with n neighbours"
      P.marketNote = `Market: trades with ${n} neighbour${n === 1 ? '' : 's'}${st.state === 'built' ? '' : st.state === 'blocked' ? ` (${st.reason})` : st.state === 'building' ? ' (being built)' : ' (planned)'}`;
    }
  } else if (n >= rules.researchContacts) P.tradeTechs = techs;
}

/** Medical care: keep bandages (and medicine once it can be made) in stock, a clinic once there are
 *  patients or the colony has grown, a hospital ward when collapsed patients wait for a bed, and research
 *  medicine when infections appear (never in a field that is switched Off). */
function planMedical(g, P, sid, D, cols) {
  const reg = g.reg, s = g.s;
  const M = medicalSummary(g, sid);
  P.medical = M;
  const can = (item) => (reg.idx.recipesFor[item] || []).some((r) => isUnlocked(g, sid, 'recipe', r.id));
  const infections = M.needs.filter((n) => n.need === 'medicine').length;
  const wounds = M.needs.filter((n) => n.need === 'bandage').length;
  if (reg.get('item', 'core:bandage') && can('core:bandage')) D.push({ item: 'core:bandage', qty: 3 + cols.length, urgency: wounds && !M.bandages ? 0.9 : 0.3, why: wounds && !M.bandages ? 'Bandages for the wounded' : 'Bandages in stock' });
  if (reg.get('item', 'core:medicine') && can('core:medicine')) D.push({ item: 'core:medicine', qty: 4, urgency: infections && !M.medicine ? 1.0 : 0.25, why: infections && !M.medicine ? 'Medicine for an infection' : 'Medicine in stock' });
  // Research: herbal medicine once someone is infected or collapsed.
  P.medTechs = [];
  const r = settlementOf(g, sid)?.research;
  if ((infections || M.down) && r && reg.get('item', 'core:medicine') && !can('core:medicine')) {
    for (const rc of reg.idx.recipesFor['core:medicine'] || []) for (const t of requiredTechs(g, 'recipe', rc.id)) if ((r.priorities[reg.get('tech', t)?.field] ?? 2) > 0) P.medTechs.push(t);
  }
  // A clinic: once unlocked, when there are patients or five or more people.
  const cabinet = reg.all('building').find((b) => b.supplies && isUnlocked(g, sid, 'building', b.id));
  if (cabinet && (M.patients.length || cols.length >= 5)) {
    const st = ensureStation(g, P, cabinet.id, M.patients.length ? 0.8 : 0.35, M.patients.length ? 'Care for the sick and injured' : 'A clinic for the growing colony', sid);
    if (st.state === 'blocked') P.medNote = st.reason;
  }
  // A hospital ward: collapsed patients waiting while every medical bed is taken (demand, not time).
  s.medicalWait ||= {};
  const waiting = M.patients.some((c) => isDownC(c) && !c.medBedId) && M.beds > 0 && M.freeBeds === 0;
  s.medicalWait[sid] = waiting ? (s.medicalWait[sid] || 0) + 1 : Math.max(0, (s.medicalWait[sid] || 0) - 1);
  const ward = reg.all('building').find((b) => b.medical && b.medical.heal > 2 && isUnlocked(g, sid, 'building', b.id));
  if (ward && s.medicalWait[sid] > 20) ensureStation(g, P, ward.id, 0.7, 'More beds: patients are waiting', sid);
}

/** Heating: when the cold is coming, put a heater in every finished home that has none (an electric heater
 *  once a generator exists, otherwise a hearth) in a free decor slot, and keep hearths stocked with fuel. */
function planHeating(g, P, sid, D) {
  const s = g.s, reg = g.reg;
  // Winter within about a week and nothing to heat with yet: research what unlocks a heater.
  if (heatSeason(g, 6) && !reg.all('building').some((b) => b.heat && b.slotTags?.length && isUnlocked(g, sid, 'building', b.id))) {
    P.heatTechs = [...new Set(reg.all('building').filter((b) => b.heat && b.slotTags?.length).flatMap((b) => requiredTechs(g, 'building', b.id)))];
    P.heatNote = 'Winter is coming and nothing can heat the homes yet: researching it';
  }
  if (!heatSeason(g)) return;
  const own = (e) => (e?.settlement || s.playerSettlement) === sid;
  for (const st of g.owned('structures', sid)) {
    const f = st.built && own(st) && reg.get('building', st.def)?.heat?.fuel;
    if (f) { const need = f.capacity - fuelLoaded(st); if (need > 0) D.push({ tag: f.tag, qty: need, urgency: 0.55, why: `Fuel for the ${reg.get('building', st.def).name}` }); }
  }
  const heaters = reg.all('building').filter((b) => b.heat && b.slotTags?.length && isUnlocked(g, sid, 'building', b.id));
  if (!heaters.length) return;
  const hasGen = g.owned('structures', sid).some((st) => own(st) && st.built && reg.get('building', st.def)?.power?.output > 0);
  heaters.sort((a, b) => ((b.power?.use && hasGen) ? 1 : 0) - ((a.power?.use && hasGen) ? 1 : 0) || (a.power?.use ? 1 : 0) - (b.power?.use ? 1 : 0));
  for (const p of g.owned('projects', sid)) {
    if (p.kind !== 'home' || !own(p) || !s.homes[p.homeId]?.complete) continue;
    if (p.renovating && !partsOf(g, p).some((st) => st.reno)) p.renovating = false; // finished (even with renovation switched off)
    if (p.renovating) continue;
    if (partsOf(g, p).some((st) => reg.get('building', st.def)?.heat || reg.get('building', st.reno?.to)?.heat)) continue;
    for (const slot of p.slots || []) {
      if ((slot.filled && s.structures[slot.filled]) || g.structAt(slot.x, slot.y)) continue;
      const b = heaters.find((d) => d.slotTags.includes(slot.tag));
      if (!b) continue;
      addSlotPart(g, p, slot, b.id);
      if (p.status === 'complete') p.status = 'active';
      p.urgency = 0.7;
      p.why = `Heating the ${p.name} for the cold`;
      g.log(`Cold weather is coming: the colonists will put a ${b.name} in the ${p.name}.`, 'build');
      return; // one at a time
    }
    // No free spot: rebuild a piece of decor (say, a lantern) as a heater, in place.
    const swap = partsOf(g, p).find((st) => st.built && !st.reno && reg.get('building', st.def)?.slotTags?.some((t) => heaters.some((d) => d.slotTags.includes(t))) && !reg.get('building', st.def)?.heat);
    if (swap) {
      const tag = reg.get('building', swap.def).slotTags.find((t) => heaters.some((d) => d.slotTags.includes(t)));
      const b = heaters.find((d) => d.slotTags.includes(tag));
      swap.reno = { to: b.id, delivered: {}, progress: 0 };
      p.renovating = true; p.renoTotal = 1; p.renoStarted = s.tick;
      p.why = `Heating the ${p.name} for the cold`;
      g.log(`Cold weather is coming: the colonists will rebuild the ${reg.get('building', swap.def).name} in the ${p.name} as a ${b.name}.`, 'build');
      return;
    }
    P.heatNote = `The ${p.name} has no free spot for a heater`;
  }
}

/** Running water (after Plumbing): a pump and a water tower, a tap by the stockpile and by each finished
 *  home, and pipes joining them. One step per plan; the power planner wires the pump to a generator. */
function planPlumbing(g, P, sid) {
  const s = g.s, reg = g.reg;
  const own = (e) => (e?.settlement || s.playerSettlement) === sid;
  const pick = (role) => reg.all('building').find((b) => b.water?.[role] && isUnlocked(g, sid, 'building', b.id));
  const pumpD = pick('pump'), towerD = pick('storage'), tapD = pick('tap'), pipeD = pick('pipe');
  if (!pumpD || !towerD || !tapD || !pipeD) return;
  const tplFor = (d) => reg.all('template').find((t) => Object.values(t.legend).some((l) => l.build === d.id) && templateUnlocked(g, sid, t));
  const structs = g.owned('structures', sid).filter(own);
  const of = (d) => structs.filter((st) => st.def === d.id);
  if (!of(pumpD).length) { const r = ensureStation(g, P, pumpD.id, 0.45, 'Running water: a pump', sid); if (r.state === 'blocked') P.waterNote = r.reason; return; }
  if (!of(towerD).length) { const r = ensureStation(g, P, towerD.id, 0.45, 'Running water: a water tower', sid); if (r.state === 'blocked') P.waterNote = r.reason; return; }
  // Taps: by the stockpile and by each finished home (at most 4), where none is close.
  const targets = [];
  const center = settlementOf(g, sid)?.center;
  if (center) targets.push({ x: center.x, y: center.y, name: 'the stockpile' });
  for (const h of Object.values(s.homes || {})) {
    if (!own(h) || !h.complete || targets.length >= 4) continue;
    const parts = (s.projects[h.projectId]?.parts || []).map((id) => s.structures[id]).filter(Boolean);
    if (parts.length) targets.push({ x: Math.round(parts.reduce((a, p) => a + p.x, 0) / parts.length), y: Math.round(parts.reduce((a, p) => a + p.y, 0) / parts.length), name: h.name });
  }
  const taps = of(tapD);
  const tapTpl = tplFor(tapD);
  if (tapTpl) {
    // Targets with no tap (built or planned) within 8 tiles, in order; search 8 tiles round each (near enough
    // to be handy, wide enough for crowded centres); a spot right beside the target costs 3.
    const near = targets.filter((t) => !taps.some((x) => Math.hypot(x.x - t.x, x.y - t.y) <= 8)).map((t) => ({ x: t.x, y: t.y, r: 8, pen: 3, name: t.name }));
    const unbuilt = taps.filter((x) => !x.built).length;
    // Decide only: civic commitment (src/sim/civic/commit.js) finds the spot and starts the project.
    needUtility(g, P, sid, {
      key: 'tap', building: tapD.id, template: tapTpl.id, near, cover: 8, completed: taps.length - unbuilt, inFlight: unbuilt,
      label: `a ${tapD.name.toLowerCase()}`, why: 'Running water by {name}', log: 'The colonists are putting in a water tap by {name}.',
    });
    // Pipes go on regardless: taps now wait for the shared civic slot, and pipes must not wait behind them.
  }
  // Pipes: join every tap and tower to the pump's network.
  const pipeTpl = tplFor(pipeD);
  if (!pipeTpl) return;
  const { nets } = waterNetworks(g, true);
  const mine = nets.filter((n) => n.sid === sid);
  const main = mine.find((n) => n.members.some((st) => g.bDef(st).water.pump));
  if (!main) return;
  for (const net of mine) {
    if (net === main || !net.members.some((st) => g.bDef(st).water.tap || g.bDef(st).water.storage)) continue;
    const path = pipePath(g, sid, net.members, main.members);
    if (!path) { P.waterNote = 'No room to lay a water pipe'; continue; }
    for (const p of path) createProject(g, pipeTpl, { x: p.x, y: p.y, rot: 0 }, { urgency: 0.4, why: 'Water pipe', owner: sid });
    g.log(`The colonists are laying a water pipe (${path.length} section${path.length > 1 ? 's' : ''}).`, 'build');
    return;
  }
}

/** Shortest run of free tiles joining two groups of water buildings (orthogonal steps), or null.
 *  Breadth-first from the first group's neighbours, at most 4000 tiles dequeued. Tiles are keyed by index and
 *  each tile's freedom is asked once per search (nothing changes during it): the same search and path as
 *  asking every time. Tiles off the map are never free (nor goals), so they are never keyed. */
function pipePath(g, sid, from, to) {
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const W = g.W, H = g.H, key = (x, y) => y * W + x, onMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const goal = new Set();
  for (const m of to) for (const [dx, dy] of N4) if (onMap(m.x + dx, m.y + dy)) goal.add(key(m.x + dx, m.y + dy));
  // Pipes are walkable and small: besides open ground they may cross empty stockpile tiles and the floor in
  // front of workplaces (never inside homes).
  const freeAt = (x, y) => {
    if (tileUsable(g, x, y, sid)) return !g.nodeAt(x, y) && !g.fieldAt(x, y) && !g.cropAt(x, y);
    if (x < 1 || y < 1 || x >= g.W - 1 || y >= g.H - 1) return false;
    const i = g.i(x, y), t = g.terrainAt(x, y);
    if (!t.passable || !t.buildable || g.structIdAt(i) || g.nodeAt(x, y) || g.fieldAt(x, y) || g.cropAt(x, y) || g.stackAt(x, y) || !g.claimOk(sid, x, y)) return false;
    const foot = g.footIdAt(i) && g.s.projects[g.footIdAt(i)];
    if (foot && foot.kind === 'home') return false;
    return !!(g.zoneAt(i) || foot);
  };
  const known = new Map(); // tile key -> free?
  const free = (k, x, y) => { let v = known.get(k); if (v === undefined) known.set(k, (v = freeAt(x, y))); return v; };
  const prev = new Map(), queue = [];
  for (const m of from) for (const [dx, dy] of N4) {
    const x = m.x + dx, y = m.y + dy;
    if (!onMap(x, y)) continue;
    const k = key(x, y);
    if (prev.has(k) || !free(k, x, y)) continue;
    prev.set(k, -1); queue.push({ x, y });
  }
  for (let qi = 0; qi < queue.length && qi < 4000; qi++) {
    const c = queue[qi], ck = key(c.x, c.y);
    if (goal.has(ck)) {
      const path = [];
      for (let k = ck; k >= 0; k = prev.get(k)) path.push({ x: k % W, y: (k - (k % W)) / W });
      return path.reverse();
    }
    for (const [dx, dy] of N4) {
      const x = c.x + dx, y = c.y + dy;
      if (!onMap(x, y)) continue;
      const k = key(x, y);
      if (prev.has(k) || !free(k, x, y)) continue;
      prev.set(k, ck); queue.push({ x, y });
    }
  }
  return null;
}

/**
 * Lay power-pole blueprints joining a machine's network to the generator's. A bounded, deterministic search:
 * usable pole spots (pole + clear tile below) inside the box around both networks, linked when within reach;
 * the shortest chain of poles from any member of the machine's network to any member of the generator's.
 * Returns the number of poles placed (-1 when there is no room).
 */
function layPoles(g, sid, members, gen, poleDef, tpl, machine) {
  const reachOf = (st) => g.bDef(st)?.power?.reach || 0;
  const R = poleDef.power.reach;
  const { nets, comp } = networks(g, true);
  const targets = nets[comp.get(gen.id)]?.members || [gen];
  const all = [...members, ...targets];
  const pad = Math.ceil(R);
  const x0 = Math.max(1, Math.min(...all.map((m) => m.x)) - pad), x1 = Math.min(g.W - 2, Math.max(...all.map((m) => m.x)) + pad);
  const y0 = Math.max(1, Math.min(...all.map((m) => m.y)) - pad), y1 = Math.min(g.H - 3, Math.max(...all.map((m) => m.y)) + pad);
  const ok = (xx, yy) => tileUsable(g, xx, yy, sid) && !g.nodeAt(xx, yy) && !g.fieldAt(xx, yy) && !g.cropAt(xx, yy);
  const spots = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (ok(x, y) && ok(x, y + 1)) spots.push({ x, y, pole: true });
  if (spots.length > 2500) spots.length = 2500; // bound the search
  const reachT = (n, t) => Math.hypot(n.x - t.x, n.y - t.y) <= Math.max(n.pole ? R : reachOf(n), reachOf(t)) + 0.01;
  const done = (n) => targets.some((t) => reachT(n, t));
  if (members.some(done)) return 0;
  const prev = new Map(), queue = [];
  for (const m of members) { prev.set(m, null); queue.push(m); }
  let end = null;
  for (let qi = 0; qi < queue.length && !end; qi++) {
    const n = queue[qi];
    const span = Math.max(n.pole ? R : reachOf(n), R);
    for (const sp of spots) {
      if (prev.has(sp) || Math.hypot(n.x - sp.x, n.y - sp.y) > span + 0.01) continue;
      prev.set(sp, n); queue.push(sp);
      if (done(sp)) { end = sp; break; }
    }
  }
  if (!end) return -1;
  const chain = [];
  for (let k = end; k && k.pole; k = prev.get(k)) chain.push(k);
  for (const p of chain.reverse()) createProject(g, tpl, { x: p.x, y: p.y, rot: 0 }, { urgency: 0.75, why: `Power line to the ${g.bDef(machine).name}`, owner: sid });
  if (chain.length) g.log(`The colonists are laying a power line to the ${g.bDef(machine).name} (${chain.length} pole${chain.length > 1 ? 's' : ''}).`, 'build');
  return chain.length;
}

/** Can this tool be had now: one in stock, or an unlocked recipe whose ingredients are all in stock? */
function toolReadyNow(g, sid, item, stock) {
  if ((stock[item] || 0) > 0) return true;
  return (g.reg.idx.recipesFor[item] || []).some((r) => isUnlocked(g, sid, 'recipe', r.id)
    && r.inputs.every((i) => (i.item ? stock[i.item] || 0 : g.reg.itemsWithTag(i.tag).reduce((a, it) => a + (stock[it] || 0), 0)) >= i.qty));
}
/** The best tool for a work type that can be had right now, or null. */
function stopgapTool(g, sid, wt, stock) {
  let best = null;
  for (const it of g.reg.all('item')) {
    const b = it.equipment?.slot === 'tool' ? it.equipment.workBoost?.[wt] : 0;
    if (b && toolReadyNow(g, sid, it.id, stock) && (!best || b > best.b)) best = { id: it.id, b };
  }
  return best?.id || null;
}

// ---- Water (Phase 4): one well per settlement; urgently when there is no lake nearby ----
function planWater(g, P, sid, cols) {
  const s = g.s, reg = g.reg;
  if (!reg.all('need').some((n) => n.behavior === 'core:drink') || !cols.length) return;
  const own = (e) => (e?.settlement || s.playerSettlement) === sid;
  const wellDef = reg.all('building').find((b) => b.water && !isWaterNode(b) && isUnlocked(g, sid, 'building', b.id));
  if (!wellDef) return;
  const wells = g.owned('structures', sid).filter((st) => own(st) && st.def === wellDef.id);
  if (wells.some((w) => w.built)) return; // already have one: nothing to decide
  const center = settlementOf(g, sid)?.center || s.center;
  let lake = Infinity, reachable = false;
  if (g.big && g.inB(center.x, center.y)) {
    // Big worlds: walking distance over terrain (a lake behind a ridge is not "near"); same rule as lod.js.
    const w = g.waterOnFoot(center.x, center.y);
    lake = w.walk; reachable = w.reachable;
  } else for (const p of g.drinkSpots()) {
    const d = Math.hypot(p.x - center.x, p.y - center.y);
    if (d < lake) lake = d;
    if (!reachable && d < 40 && g.reachableFrom(center.x, center.y, p.x, p.y, 'on')) reachable = true;
  }
  // Survival first: with no water anyone can reach, the well outranks everything else being built.
  if (wells.some((w) => w.built)) return;
  if (wells.length) {
    if (!reachable) for (const w of wells) { const p = s.projects[w.projectId]; if (p) p.urgency = Math.max(p.urgency ?? 0, 2.6); }
    return;
  }
  const urgency = !reachable ? 2.4 : lake > 14 ? 1.3 : 0.45;
  const why = !reachable ? 'No water within reach: a well is urgent' : lake > 14 ? 'The nearest water is far away: dig a well' : 'Clean drinking water close to home';
  ensureStation(g, P, wellDef.id, urgency, why, sid);
}
