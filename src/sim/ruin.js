// Destruction by disasters and god powers (Phase 5b, slice 1). Nothing else removes finished buildings, so this
// module keeps everything that refers to one consistent:
// - destroyStructure: the jobs that use it end first (their reservations go, carried goods are dropped, a station's
//   buffered ingredients go back on the ground while the station still stands); the goods it holds (materials
//   delivered, buffers, fuel and supplies) are burned, crushed or dropped; beds and medical beds are freed; it is
//   removed; a part of a home or workshop comes back as an unbuilt part of the same project (same building, same
//   tile), so the village's builders rebuild it with the usual construction (the home is not complete, so gives no
//   shelter, until then); decor slots are left to the planner as before; its village plans afresh at once (saved
//   plans may hold only existing buildings).
// - destroyNode, destroyStack, destroyCrop: the same for trees and rocks, goods on the ground, and crops.
// Items destroyed are consumed with the given ledger reason ('divine' for what a power destroys, 'fire' for what
// burns); nothing is created here. No random numbers are drawn.
import { endJob } from './ai/ai.js';
import { planNow } from './planner.js';

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Does this job use the structure `id` (as its station, bed, desk, site, cabinet, well or tap)? */
function jobUses(job, id) {
  if (!job) return false;
  for (const [k, v] of Object.entries(job)) {
    if (k === 'res') continue;
    if (v === id && /Id$|^sid$/.test(k)) return true;
    if (v && typeof v === 'object' && !Array.isArray(v) && (v.sid === id || v.stationId === id || v.cabinetId === id)) return true;
  }
  return false;
}

/** Items a structure holds, as [{ item, qty, dur? }] (the same as Game.census counts). */
function heldItems(st) {
  const out = [];
  for (const [item, qty] of Object.entries(st.delivered || {})) if (qty > 0) out.push({ item, qty });
  for (const [item, qty] of Object.entries(st.reno?.delivered || {})) if (qty > 0) out.push({ item, qty });
  for (const b of st.buffer || []) if (b.qty > 0) out.push({ item: b.item, qty: b.qty, dur: b.dur });
  for (const f of st.fuel || []) if (f.qty > 0) out.push({ item: f.item, qty: f.qty });
  return out;
}

/** Items destroyed: out of existence through the ledger (`reason`), or (reason null) put on the ground. */
function lose(g, owner, items, x, y, reason) {
  const prev = g.actor;
  g.actor = owner;
  try {
    for (const e of items) {
      if (reason) g.consume(e.item, e.qty, reason);
      else g.placeItems(e.item, e.qty, x, y, e.dur);
    }
  } finally { g.actor = prev; }
}

/**
 * Destroy a structure (built or not). opts.reason: the ledger reason for the goods it holds ('fire', 'divine'), or
 * null to drop them on the ground; opts.why: the words for the log and for the jobs that end; opts.repair (default
 * true): a project part comes back unbuilt. opts.replan (default true). Returns the replacement part or null.
 * O(colonists + the structure's items) once.
 */
export function destroyStructure(g, id, opts = {}) {
  const s = g.s, st = s.structures[id];
  if (!st) return null;
  const owner = st.settlement || s.playerSettlement, why = opts.why || 'It was destroyed';
  // Jobs that use it end while it still stands (a station's buffer goes back on the ground in their cleanup).
  for (const c of Object.values(s.colonists).sort(byId)) if (jobUses(c.job, id)) endJob(g, c, null, why);
  lose(g, owner, heldItems(st), st.x, st.y, opts.reason === undefined ? null : opts.reason);
  st.delivered = {}; if (st.reno) st.reno.delivered = {}; st.buffer = []; st.fuel = [];
  // Beds and medical beds.
  for (const c of Object.values(s.colonists).sort(byId)) {
    if (c.bedId === id) c.bedId = null;
    if (c.medBedId === id) c.medBedId = null;
  }
  const def = g.bDef(st), p = st.projectId && s.projects[st.projectId];
  const slot = p?.slots?.find((x) => x.filled === id);
  g.removeStructure(id);
  let part = null;
  if (p && opts.repair !== false) {
    p.parts = p.parts.filter((x) => x !== id);
    if (slot) delete slot.filled; // decor: the planner fills the slot again (planDecor)
    else if (def) {
      part = g.addStructure(def.id, st.x, st.y, { projectId: p.id, rot: st.rot, order: st.order ?? 1, settlement: owner });
      p.parts.push(part.id);
      p.status = 'active';
      if (p.homeId && s.homes[p.homeId]) s.homes[p.homeId].complete = false; // until it is rebuilt (completeStructure)
      g.markDirty(st.x, st.y);
    }
  }
  if (opts.replan !== false) replan(g, [owner]);
  return part;
}

/** A fresh plan at once for each village (id order), so no saved plan holds what was destroyed. */
export function replan(g, sids) {
  for (const sid of [...new Set(sids)].sort()) {
    if (!g.s.settlements?.[sid]) continue;
    planNow(g, sid);
    if (sid === g.s.playerSettlement) g.plan = g.plans[sid];
  }
}

/** Destroy a resource node (a tree, rock or bush). Jobs gathering it fail softly ("the target is gone"). */
export function destroyNode(g, id) {
  if (!g.s.nodes[id]) return false;
  for (const c of Object.values(g.s.colonists).sort(byId)) if (c.job?.nodeId === id) endJob(g, c, null, 'It was destroyed');
  g.removeNode(id);
  return true;
}

/** Destroy a stack of goods on the ground, through the ledger (`reason`). Jobs that reserved or target it end first.
 *  Returns the quantity destroyed. */
export function destroyStack(g, id, reason) {
  const st = g.s.stacks[id];
  if (!st) return 0;
  for (const c of Object.values(g.s.colonists).sort(byId)) if (c.job && (c.job.stackId === id || c.job.res?.some((r) => r.key === id))) endJob(g, c, null, 'The goods were destroyed');
  const taken = g.s.stacks[id] ? g.takeFromStack(id, g.s.stacks[id].qty) : null;
  if (taken) g.consume(taken.item, taken.qty, reason);
  return taken?.qty || 0;
}

/** Destroy a crop (its seed was consumed when sown; nothing to count). */
export function destroyCrop(g, id) {
  if (!g.s.crops[id]) return false;
  for (const c of Object.values(g.s.colonists).sort(byId)) if (c.job?.cropId === id) endJob(g, c, null, 'The crop was destroyed');
  g.removeCrop(id);
  return true;
}
