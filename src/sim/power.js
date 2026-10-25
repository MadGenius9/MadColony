// Electric power (Phase 3). Buildings with a `power` definition form networks: two powered buildings
// of the same settlement are connected when they are within reach of each other (the larger reach of
// the two). Generators burn fuel from their own store, but only while a connected machine is being
// worked, so nothing is wasted. Each network compares supply with demand; machines slow down when
// power is short and pause (without losing ingredients or progress) when there is none.
//
// Batteries (`power.store` capacity, `power.charge` rate per tick; Phase 3 slice 4) store a running
// network's surplus and give it back when the generators fall short or stop: a network whose
// batteries hold charge runs even with no generator burning. Charging happens only while a machine on
// the network is in use, so an idle generator never burns fuel just to fill a battery.
//
// Networks are derived from the buildings every few ticks and never saved. What is saved: each
// generator's fuel store (`st.fuel`, items still in existence), the burn time left on the unit
// being burned (`st.burn`) and each battery's stored energy (`st.charge`, power × ticks; save
// format 14, absent means empty). Stored energy is not an item: it is outside the census.

import { TICKS_PER_HOUR } from './constants.js';

export const POWER_TICK = 10; // recompute and burn every this many ticks
export const isBroken = (st) => (st.condition ?? 100) <= 0;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const ownerOf = (g, st) => st.settlement || g.s.playerSettlement;

/** The fuel store spec of a building: generators (power.fuel) and fuel heaters (heat.fuel). */
export const fuelSpec = (def) => def?.power?.fuel || def?.heat?.fuel || def?.supplies || null; // supplies: a medicine cabinet's store
/** Total fuel units loaded in a generator. */
export const fuelLoaded = (st) => (st.fuel || []).reduce((a, f) => a + f.qty, 0);

/** Is someone actually working at this powered machine right now? */
/** Other systems can say when their powered buildings are in use (return true/false, or undefined to pass). */
export const busyHooks = [];
/** `busy` (optional): the set of station ids being worked now, from busyStations(), so a whole network is
 *  checked with one pass over the colonists instead of one pass per machine. */
export function machineBusy(g, st, busy = null) {
  const def = g.bDef(st);
  for (const h of busyHooks) { const r = h(g, st); if (r !== undefined) return r; }
  if (def?.light && def.power?.use) { const h = g.hour; return h >= 21 || h < 5; } // electric lights draw power after dark
  if (busy) return busy.has(st.id);
  for (const c of Object.values(g.s.colonists)) if (c.job?.stationId === st.id && c.job.stage === 'work' && !c.mv) return true;
  return false;
}
/** Ids of the stations someone is working at right now (one pass over the colonists). */
export function busyStations(g) {
  const busy = new Set();
  for (const c of Object.values(g.s.colonists)) if (c.job?.stationId !== undefined && c.job.stage === 'work' && !c.mv) busy.add(c.job.stationId);
  return busy;
}

// ---------- networks (derived, never saved) ----------
// Powered buildings only connect within one settlement, so the networks are worked out per settlement and
// kept in g._pnet until that settlement's powered buildings change: one is added, removed or rebuilt as
// another kind (the structsWhere('power') list is replaced, game.js structsChanged; a settlement is redone
// when its own list holds other buildings or any of them now has another def, since a renovated building
// stays the same object), or one is finished (builtRev; then only settlements whose built flags differ are
// redone). A settlement's networks are found with a grid of buckets as wide as its longest reach, so it costs
// about O(its nodes), not O(N²) world-wide.
// The result is exactly what a breadth-first search over all powered buildings sorted by id gives: the same
// networks, in the same order (by their lowest id), with the same members and links in the same order.

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Connected components of one settlement's nodes (sorted by id): [{ start, members, links }]. */
function components(g, nodes) {
  const reach = (st) => g.bDef(st).power.reach || 0;
  const n = nodes.length;
  const R = nodes.reduce((a, st) => Math.max(a, reach(st)), 0);
  const S = Math.max(1, Math.ceil(R)); // bucket size
  const span = Math.ceil((R + 0.01) / S); // buckets to look at on each side
  const rank = new Map(), buckets = new Map();
  const bk = (bx, by) => by * 1048576 + bx;
  nodes.forEach((st, i) => {
    rank.set(st, i);
    const k = bk(Math.floor(st.x / S), Math.floor(st.y / S));
    let a = buckets.get(k); if (!a) buckets.set(k, (a = []));
    a.push(st);
  });
  const seen = new Uint8Array(n);
  const comps = [];
  for (let s0 = 0; s0 < n; s0++) {
    if (seen[s0]) continue;
    const start = nodes[s0];
    const net = { start, members: [], links: [] };
    comps.push(net);
    const queue = [start];
    seen[s0] = 1;
    for (let qi = 0; qi < queue.length; qi++) {
      const a = queue[qi];
      net.members.push(a);
      const bx = Math.floor(a.x / S), by = Math.floor(a.y / S);
      const found = [];
      for (let y = by - span; y <= by + span; y++) for (let x = bx - span; x <= bx + span; x++) {
        const list = buckets.get(bk(x, y));
        if (!list) continue;
        for (const b of list) {
          const j = rank.get(b);
          if (seen[j]) continue;
          if (dist(a, b) <= Math.max(reach(a), reach(b)) + 0.01) found.push(j);
        }
      }
      found.sort((p, q) => p - q); // the order of the old scan over all nodes sorted by id
      for (const j of found) { seen[j] = 1; queue.push(nodes[j]); net.links.push([a, nodes[j]]); }
    }
  }
  return comps;
}

/**
 * Connected components of powered buildings. `includePlanned` also counts blueprints (the planner uses
 * this to decide where poles are still needed); the simulation only counts finished buildings.
 * Returns { nets: [{ id, sid, members, links }], comp: Map id -> net index }; members, links and comp are
 * shared with the cache, so callers must not change them.
 */
export function networks(g, includePlanned = false) {
  const list = g.structsWhere('power', (st) => !!g.bDef(st)?.power);
  const ps = g.s.playerSettlement;
  let C = g._pnet;
  if (!C || C.list !== list || C.ps !== ps) {
    // The powered buildings changed: regroup them by settlement, keeping the cached networks of any
    // settlement whose own list is the same as before.
    const bySid = new Map();
    for (const st of list) { const k = ownerOf(g, st); let a = bySid.get(k); if (!a) bySid.set(k, (a = [])); a.push(st); }
    const sids = new Map();
    for (const [sid, nodes] of bySid) {
      nodes.sort(byId);
      const old = C?.ps === ps ? C.sids.get(sid) : null;
      const defs = nodes.map((st) => st.def).join('|'); // a renovated building is the same object with a new def
      const same = old && old.defs === defs && old.nodes.length === nodes.length && old.nodes.every((st, i) => st === nodes[i]);
      sids.set(sid, same ? old : { nodes, defs, builtSig: null, built: null, planned: null });
    }
    C = g._pnet = { list, ps, sids, key: null, merged: [null, null] };
  }
  const key = `${g.structRev || 0}|${g.builtRev || 0}`;
  if (C.key !== key) {
    // Something was added or finished somewhere: redo only the settlements whose finished set changed.
    for (const e of C.sids.values()) {
      let sig = '';
      for (const st of e.nodes) sig += st.built ? '1' : '0';
      if (sig !== e.builtSig) { e.builtSig = sig; e.built = null; C.merged[0] = null; }
    }
    C.key = key;
  }
  const w = includePlanned ? 1 : 0;
  if (!C.merged[w]) {
    const all = [];
    for (const e of C.sids.values()) {
      if (includePlanned) all.push(...(e.planned ||= components(g, e.nodes)));
      else all.push(...(e.built ||= components(g, e.nodes.filter((st) => st.built))));
    }
    all.sort((a, b) => byId(a.start, b.start)); // networks in order of their lowest id, as one sorted scan finds them
    const comp = new Map();
    all.forEach((net, i) => { for (const st of net.members) comp.set(st.id, i); });
    C.merged[w] = { all, comp };
  }
  const { all, comp } = C.merged[w];
  return { nets: all.map((net, i) => ({ id: i, sid: ownerOf(g, net.start), members: net.members, links: net.links })), comp };
}

/** A battery's stored energy (power × ticks); absent or malformed means empty. */
export const chargeOf = (st) => Math.max(0, Number(st.charge) || 0);
const round3 = (x) => Math.round(x * 1000) / 1000; // stored as condition is: no float drift in saves

/**
 * Network state for the current tick: supply, demand, ratio and a plain-language reason when short.
 * Per network: generators, consumers, batteries (sorted by id), running (generators with fuel), output (what the
 * running generators give), discharge (what the batteries holding any charge can give per tick: the sum of
 * their `charge` rates), supply = output + discharge, demand (busy machines), ratio = supply / demand (capped
 * at 1), stored / storeMax (energy held / capacity, power × ticks), flow (energy into (+) or out of (−) the
 * batteries on the next power tick, as tickPower applies it) and flows ([battery, delta] in id order).
 * Whether a battery can give power depends only on "charge > 0" at the start of the tick, so every caller in
 * a tick sees the same ratio.
 */
export function powerState(g) {
  if (g._power && g._power.tick === g.s.tick) return g._power;
  const { nets, comp } = networks(g);
  const busy = busyStations(g);
  for (const net of nets) {
    net.generators = net.members.filter((st) => g.bDef(st).power.output > 0);
    net.consumers = net.members.filter((st) => g.bDef(st).power.use > 0);
    net.batteries = net.members.filter((st) => g.bDef(st).power.store > 0).sort(byId);
    net.running = net.generators.filter((st) => !isBroken(st) && ((st.burn || 0) > 0 || fuelLoaded(st) > 0));
    net.output = net.running.reduce((a, st) => a + g.bDef(st).power.output, 0);
    // A distant (abstract) village keeps its batteries' charge as is: they neither charge nor give power (lod.js).
    const held = g.s.settlements?.[net.sid]?.detail === 'abstract';
    net.stored = 0; net.storeMax = 0; net.discharge = 0;
    for (const st of net.batteries) {
      const pw = g.bDef(st).power, c = chargeOf(st);
      net.stored += c; net.storeMax += pw.store;
      if (c > 0 && !held) net.discharge += pw.charge;
    }
    net.stored = round3(net.stored);
    net.supply = net.output + net.discharge;
    net.busy = net.consumers.filter((st) => !isBroken(st) && machineBusy(g, st, busy));
    net.demand = net.busy.reduce((a, st) => a + g.bDef(st).power.use, 0);
    net.ratio = net.demand <= 0 ? 1 : Math.min(1, net.supply / net.demand);
    // Battery flow on the next power tick: only while machines are in use (idle generators burn nothing, so they
    // charge nothing). A surplus fills the batteries in id order, each at most its rate and its room; a shortfall
    // is drawn in id order, each at most its rate and what it holds.
    net.flows = []; net.flow = 0;
    if (net.demand > 0 && net.batteries.length && !held) {
      let left = (net.output - net.demand) * POWER_TICK;
      for (const st of net.batteries) {
        if (!left) break;
        const pw = g.bDef(st).power, c = chargeOf(st);
        const d = left > 0 ? Math.min(pw.charge * POWER_TICK, Math.max(0, pw.store - c), left) : -Math.min(pw.charge * POWER_TICK, c, -left);
        if (d > 0 || d < 0) { net.flows.push([st, d]); net.flow += d; left -= d; }
      }
      net.flow = round3(net.flow);
    }
    const onBatteries = `Running on batteries (${Math.floor(net.stored)} left)`;
    net.reason = !net.running.length && net.discharge > 0
      ? net.demand <= 0 ? `Batteries hold ${Math.floor(net.stored)}; nothing needs power` : `${onBatteries}: ${!net.generators.length ? 'not connected to a generator' : net.generators.every(isBroken) ? 'the generator has broken down' : 'the generator is out of fuel'}`
      : !net.generators.length ? 'Not connected to a generator'
      : !net.running.length ? (net.generators.every(isBroken) ? 'The generator has broken down and needs repair' : 'The generator is out of fuel')
      : net.demand > net.supply ? `Overloaded: machines need ${net.demand}, generators give ${net.output}${net.discharge ? ` and batteries ${net.discharge}` : ''}`
      : net.demand > net.output ? `${onBatteries}: machines need ${net.demand}, generators give ${net.output}`
      : '';
  }
  g._power = { tick: g.s.tick, nets, comp };
  return g._power;
}

/** Ids of the stations one settlement's own colonists are working at right now (as busyStations, one settlement). */
export function busyStationsOf(g, sid) {
  const busy = new Set();
  for (const c of g.owned('colonists', sid)) if (c.job?.stationId !== undefined && c.job.stage === 'work' && !c.mv) busy.add(c.job.stationId);
  return busy;
}

/** The most loaded of one settlement's networks right now: { demand, supply, capacity }, or null when none
 *  of its machines is in use on a network with a generator running. demand: what the busy machines use, as in
 *  powerState, except light-only consumers (lamps light at any ratio above 0, so they never need more
 *  generators); supply: the running generators' output; capacity: the output of every built generator on the
 *  network, broken or out of fuel included, so a breakdown or an empty fuel store never reads as a lack of
 *  generators. The network with the lowest capacity / demand wins. Looks only at that settlement's networks
 *  and colonists and caches nothing (the planner's load samples, planner.js samplePower). */
export function settlementLoad(g, sid) {
  const busy = busyStationsOf(g, sid);
  let worst = null;
  for (const net of networks(g).nets) {
    if (net.sid !== sid) continue;
    let demand = 0, supply = 0, capacity = 0;
    for (const st of net.members) {
      const def = g.bDef(st), pw = def.power;
      if (pw.use > 0 && !def.light && !isBroken(st) && machineBusy(g, st, busy)) demand += pw.use;
      if (pw.output > 0) {
        capacity += pw.output;
        if (!isBroken(st) && ((st.burn || 0) > 0 || fuelLoaded(st) > 0)) supply += pw.output;
      }
    }
    if (demand > 0 && supply > 0 && (!worst || capacity / demand < worst.capacity / worst.demand)) worst = { demand, supply, capacity };
  }
  return worst;
}

/** Power available to one building: { ratio 0..1, reason, net }. Unpowered buildings get ratio 1. */
export function powerAt(g, st) {
  const def = g.bDef(st);
  if (!def?.power?.use) return { ratio: 1, reason: '', net: null };
  if (!st.built) return { ratio: 0, reason: 'Not built yet', net: null };
  if (isBroken(st)) return { ratio: 0, reason: 'Broken down: waiting for repair', net: null };
  const P = powerState(g);
  const net = P.nets[P.comp.get(st.id)];
  if (!net) return { ratio: 0, reason: 'Not connected to a generator', net: null };
  if (!net.generators.length && !(net.discharge > 0)) return { ratio: 0, reason: 'Not connected to a generator (build power poles to reach one)', net };
  if (!net.running.length && !(net.discharge > 0)) return { ratio: 0, reason: net.reason, net };
  // Supply is shared by the machines in use; an idle machine would get the full share if it started.
  const demand = net.demand + (machineBusy(g, st) ? 0 : def.power.use);
  return { ratio: demand <= 0 ? 1 : Math.min(1, net.supply / demand), reason: net.reason, net };
}

/** Burn fuel in generators whose network has machines in use (fuel is consumed one unit at a time), and move the
 *  network's battery flow (powerState: surplus in, shortfall out). Cost per power tick: O(powered structures +
 *  colonists) per settlement, plus O(batteries) per network. */
export function tickPower(g) {
  if (g.s.tick % POWER_TICK) return;
  const P = powerState(g);
  for (const net of P.nets) {
    if (net.demand <= 0) continue; // nothing running: generators idle and burn nothing
    const wear = (st) => {
      const m = g.bDef(st).maintenance;
      if (!m) return;
      const before = st.condition ?? 100;
      st.condition = Math.max(0, Math.round((before - (m.wearPerHour * POWER_TICK) / TICKS_PER_HOUR) * 1000) / 1000);
      if (before > 0 && st.condition <= 0) g.log(`The ${g.bDef(st).name} has broken down and needs repair.`, 'warn');
    };
    for (const st of net.busy) if (net.supply > 0) wear(st);
    for (const st of net.generators) {
      if (isBroken(st)) continue;
      const pw = g.bDef(st).power;
      if ((st.burn || 0) <= 0) {
        const f = (st.fuel || []).find((x) => x.qty > 0);
        if (!f) continue;
        f.qty -= 1;
        st.fuel = st.fuel.filter((x) => x.qty > 0);
        g.consume(f.item, 1, 'burned as fuel');
        st.burn = Math.round((pw.fuel?.burnTicks || 400) * (g.reg.get('item', f.item)?.fuel || 1));
      }
      st.burn = Math.max(0, (st.burn || 0) - POWER_TICK);
      wear(st);
    }
    for (const [st, d] of net.flows) st.charge = round3(Math.max(0, Math.min(g.bDef(st).power.store, chargeOf(st) + d)));
  }
  g._power = null;
}
