// Rebuild reservations from colonists' saved jobs. Reservations are derived data: if a job's targets
// no longer exist or can't be re-reserved, the job is cancelled safely (carried items are dropped).
import { DRIVERS } from './ai/jobs.js';

export function reconcile(g) {
  g.excl.clear(); g.qtyRes.clear(); g.incRes.clear();
  const reset = [];
  for (const c of g.colonists()) {
    const j = c.job;
    if (!j) continue;
    const saved = j.res || [];
    j.res = [];
    const drv = DRIVERS[j.type];
    let ok = !!drv;
    try { if (ok && drv.valid) ok = drv.valid(g, c, j); } catch { ok = false; }
    if (ok) for (const r of saved) if (!g.reapply(j, r, c.id)) { ok = false; break; }
    if (!ok) {
      g.release(j);
      try { drv?.cleanup?.(g, c, j); } catch { /* ignore */ }
      if (c.carry) { const pa = g.actor; g.actor = c.settlementId || null; g.placeItems(c.carry.item, c.carry.qty, c.x, c.y, c.carry.dur); g.actor = pa; c.carry = null; }
      c.job = null; c.sleeping = false; c.path = null; c.mv = null;
      reset.push(c.name);
    }
  }
  // Patients: a carrier who is no longer carrying them, or a medical bed that is gone.
  for (const c of Object.values(g.s.colonists)) {
    if (c.carriedBy) { const k = g.s.colonists[c.carriedBy]; if (k?.job?.type !== 'rescue' || k.job.patientId !== c.id) c.carriedBy = null; }
    if (c.medBedId && !g.s.structures[c.medBedId]?.built) c.medBedId = null;
  }
  // Station buffers whose owning job no longer exists go back on the ground.
  for (const st of Object.values(g.s.structures)) {
    if (!st.buffer?.length) continue;
    const keep = [];
    for (const b of st.buffer) {
      const owner = g.s.colonists[b.job];
      if (['craft', 'research', 'maintain'].includes(owner?.job?.type) && owner.job.stationId === st.id) keep.push(b);
      else g.placeItems(b.item, b.qty, st.x, st.y + 1, b.dur);
    }
    st.buffer = keep;
  }
  if (reset.length) g.log(`Reset ${reset.length} interrupted job(s) after loading (${reset.join(', ')}).`, 'info');
  return reset;
}
