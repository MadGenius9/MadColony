// Running water (Phase 4, slice 3). Pumps, water towers, taps and pipes form water networks: members of
// the same settlement connect when they stand on orthogonally neighbouring tiles. Electric pumps (they need
// power) fill the network's storage; each drink at a tap takes one unit. Pumps draw power only while their
// network has room. Networks are derived from the buildings and never saved; the water held in storage
// (`st.water`) is saved. Water networks are separate from power networks.
import { powerAt, isBroken, busyHooks } from './power.js';
import { TICKS_PER_HOUR } from './constants.js';

export const WATER_TICK = 10;
const ownerOf = (g, st) => st.settlement || g.s.playerSettlement;
const W = (g, st) => g.bDef(st)?.water;
/** Is this building part of a water network (pump, storage, tap or pipe)? A plain well is not. */
export const isWaterNode = (def) => !!(def?.water && (def.water.pump || def.water.storage || def.water.tap || def.water.pipe));

// Network layout (which buildings are joined) is worked out per settlement and kept in g._wnet until that
// settlement's water buildings change: one is added, removed or rebuilt as another kind (the
// structsWhere('waterNode') list is replaced, game.js structsChanged; a settlement is redone when its own
// list holds other buildings or any of them now has another def, since a renovated building stays the same
// object), or one is finished (builtRev; only settlements whose built flags differ are redone).
// Each layout is one breadth-first pass over its own nodes (O(nodes)). The water held (stored, and capacity,
// which counts finished towers) is read fresh whenever waterNetworks builds its result, which, as before, is
// kept for the rest of the tick (g._water).
// Same networks, in the same order (by lowest id), with the same members in the same order as one
// breadth-first scan over all water buildings sorted by id.

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Connected water networks of one settlement's nodes (sorted by id): [{ start, members, pumps, stores, taps }]. */
function waterComponents(g, nodes) {
  const at = new Map(nodes.map((st) => [st.x + ',' + st.y, st]));
  const seen = new Set();
  const comps = [];
  for (const start of nodes) {
    if (seen.has(start)) continue;
    const members = [];
    const queue = [start];
    seen.add(start);
    for (let qi = 0; qi < queue.length; qi++) {
      const a = queue[qi];
      members.push(a);
      for (const [dx, dy] of DIRS) {
        const b = at.get((a.x + dx) + ',' + (a.y + dy));
        if (!b || seen.has(b)) continue;
        seen.add(b); queue.push(b);
      }
    }
    comps.push({ start, members, pumps: members.filter((st) => W(g, st).pump), stores: members.filter((st) => W(g, st).storage), taps: members.filter((st) => W(g, st).tap) });
  }
  return comps;
}

/** The cached layout of all water networks: { all: [component], comp: Map id -> index }. Shared: never change it. */
function waterLayout(g, includePlanned) {
  const list = g.structsWhere('waterNode', (st) => isWaterNode(g.bDef(st)));
  const ps = g.s.playerSettlement;
  let C = g._wnet;
  if (!C || C.list !== list || C.ps !== ps) {
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
    C = g._wnet = { list, ps, sids, key: null, merged: [null, null] };
  }
  const key = `${g.structRev || 0}|${g.builtRev || 0}`;
  if (C.key !== key) {
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
      if (includePlanned) all.push(...(e.planned ||= waterComponents(g, e.nodes)));
      else all.push(...(e.built ||= waterComponents(g, e.nodes.filter((st) => st.built))));
    }
    all.sort((a, b) => byId(a.start, b.start));
    const comp = new Map();
    all.forEach((net, i) => { for (const st of net.members) comp.set(st.id, i); });
    C.merged[w] = { all, comp };
  }
  return C.merged[w];
}

/** Connected water networks of finished buildings (or blueprints too, for planning). */
export function waterNetworks(g, includePlanned = false) {
  const key = `${g.s.tick}:${includePlanned}`;
  if (!includePlanned && g._water?.key === key) return g._water;
  const { all, comp } = waterLayout(g, includePlanned);
  const nets = all.map((t, id) => {
    const net = { id, sid: ownerOf(g, t.start), members: t.members, pumps: t.pumps, stores: t.stores, taps: t.taps };
    net.capacity = net.stores.reduce((a, st) => a + (st.built ? W(g, st).storage : 0), 0);
    net.stored = net.stores.reduce((a, st) => a + (st.water || 0), 0);
    return net;
  });
  const res = { key, nets, comp };
  if (!includePlanned) g._water = res;
  return res;
}

/** Pumps running now and a plain-language problem, if any (asks the power network, so kept separate). */
export function waterStatus(g, net) {
  const working = net.pumps.filter((st) => st.built && !isBroken(st) && powerAt(g, st).ratio > 0);
  const reason = !net.pumps.length ? 'Not connected to a pump (lay pipes to one)'
    : !net.capacity ? 'No water tower to hold the water'
    : !working.length ? (net.pumps.every((p) => isBroken(p)) ? 'The pump has broken down' : 'The pump has no power')
    : net.stored < 1 ? 'Filling up' : '';
  return { working, reason };
}

/** The water network a building belongs to (finished buildings only), or null. */
export function waterNetOf(g, st) {
  const N = waterNetworks(g);
  const id = N.comp.get(st.id);
  return id === undefined ? null : N.nets[id];
}

/** Can someone drink at this tap right now? */
export function tapHasWater(g, st) { const n = waterNetOf(g, st); return !!n && n.stored >= 1; }

/** Take one unit of water from a tap's network. Returns false if it is dry. */
export function drawWater(g, tap, qty = 1) {
  const n = waterNetOf(g, tap);
  if (!n || n.stored < qty) return false;
  let left = qty;
  for (const st of n.stores) {
    const take = Math.min(left, st.water || 0);
    st.water = Math.round(((st.water || 0) - take) * 1000) / 1000;
    left -= take;
    if (left <= 0) break;
  }
  g._water = null;
  return true;
}

/** Pumps fill their network's storage while powered. */
export function tickWater(g) {
  if (g.s.tick % WATER_TICK) return;
  const { nets } = waterNetworks(g);
  for (const net of nets) {
    if (!net.capacity) continue;
    const { working } = waterStatus(g, net);
    if (!working.length) continue;
    let add = working.reduce((a, st) => a + W(g, st).pump * powerAt(g, st).ratio, 0) * WATER_TICK / TICKS_PER_HOUR;
    for (const st of net.stores) {
      if (!st.built || add <= 0) continue;
      const room = W(g, st).storage - (st.water || 0);
      const put = Math.min(room, add);
      if (put > 0) { st.water = Math.round(((st.water || 0) + put) * 1000) / 1000; add -= put; }
    }
  }
  g._water = null;
}

// Pumps draw power only while their network has room for more water.
busyHooks.push((g, st) => {
  const w = W(g, st);
  if (!w?.pump) return undefined;
  const n = waterNetOf(g, st);
  return !!n && n.capacity > 0 && n.stored < n.capacity - 0.001;
});
