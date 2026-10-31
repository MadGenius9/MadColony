// Burial and mourning (Phase 5, slice 1b). Someone who dies in a village simulated in full leaves a body
// (s.bodies, not an item) where they fell. A carer of their village (the Care work type, giver core:bury)
// carries it to the village graveyard and buries it there: a Grave (building core:grave, built at once, no
// materials) with the name on it. The graveyard grows from the first grave: later graves go next to it, else to
// the nearest free tile round the village centre (BURIAL.yardFrom..yardTo tiles out, on the village's land).
// A body nobody buries within BURIAL.layAfterDays is laid to rest by the village anyway (a grave without the
// walk); a village simulated at a distance buries its dead at once. With no free tile the dead are laid to rest
// without a grave (logged).
// Mourning: close family of the dead (people sharing their home, their parents and children) grieve for
// BURIAL.griefDays: work at BURIAL.griefWork speed (c.grief, read by jobs.js workSpeed). There is no other effect (no mood system).
// No random numbers are drawn. Everything is saved (save format 16).
import { TICKS_PER_DAY, TICKS_PER_HOUR } from './constants.js';
import { isDown } from './health.js';
import { newJob, travel } from './ai/jobs.js';
import { rings, octile } from './util.js';
import { contactRules } from './contact.js';
import { settlementOf } from './research.js';

export const BURIAL = { work: 120, layAfterDays: 3, griefDays: 2, griefWork: 0.85, yardFrom: 8, yardTo: 30, nearGrave: 4 };
export const GRAVE = 'core:grave';

const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sidOf = (g, c) => c.settlementId || g.s.playerSettlement;

/** Is (x, y) free for a grave of `sid`? Open buildable ground with nothing on it, on land sid may build on, reachable
 *  on foot from the village centre. Read-only. */
function graveFree(g, sid, x, y, home) {
  if (!g.inB(x, y)) return false;
  const t = g.terrainAt(x, y);
  if (!t.passable || !t.buildable) return false;
  const i = g.i(x, y);
  if (g.structIdAt(i) || g.footIdAt(i) || g.zoneAt(i) || g.nodeIdAt(i) || g.stackIdAt(i) || g.cropIdAt(i)) return false;
  if (!g.claimOk(sid, x, y)) return false;
  if (home !== undefined && g.regionOf(x, y) !== home) return false;
  return !g.isReserved(`grave:${x},${y}`, null);
}

/** The tile for the next grave of `sid`, or null (read-only, no random numbers): next to the graveyard's first grave,
 *  else the nearest free tile BURIAL.yardFrom..yardTo tiles from the centre, in ring order. */
export function graveTile(g, sid) {
  const st = g.s.settlements?.[sid];
  const c = st?.center || g.s.center;
  if (!c) return null;
  const home = g.regionOf(c.x, c.y);
  const ok = (x, y) => graveFree(g, sid, x, y, home);
  if (st?.graveyard) for (const [x, y] of rings(st.graveyard.x, st.graveyard.y, BURIAL.nearGrave)) if (ok(x, y)) return { x, y };
  for (const [x, y] of rings(c.x, c.y, BURIAL.yardTo)) {
    if (Math.max(Math.abs(x - c.x), Math.abs(y - c.y)) < BURIAL.yardFrom) continue;
    if (ok(x, y)) return { x, y };
  }
  return null;
}

/** Put a grave for the dead `cid` of `sid` at (x, y), or lay them to rest without one when (x, y) is null. */
function layToRest(g, sid, cid, at, by = null) {
  const s = g.s, d = s.dead?.[cid], name = d?.name || 'someone';
  const village = s.settlements?.[sid]?.name || '';
  if (!at || !g.reg.get('building', GRAVE)) {
    if (d) d.buried = s.tick;
    g.log(`${name} was laid to rest${village ? ` by the people of ${village}` : ''} without a grave (no free ground).`, 'info');
    return null;
  }
  const def = g.reg.get('building', GRAVE);
  const st = g.addStructure(GRAVE, at.x, at.y, { settlement: sid, built: true, progress: def.work, grave: { cid, name, tick: s.tick } });
  g.builtRev = (g.builtRev || 0) + 1;
  g.markDirty(at.x, at.y);
  const set = s.settlements?.[sid];
  if (set && !set.graveyard) set.graveyard = { x: at.x, y: at.y };
  if (d) { d.buried = s.tick; d.graveId = st.id; }
  g.log(by ? `${by.name} buried ${name}.` : `${name} was buried${village ? ` by the people of ${village}` : ''}.`, 'info');
  return st;
}

/** death.js killColonist: the dead leave a body (full detail) or are buried at once (distant villages). */
export function afterDeath(g, c, rec) {
  const s = g.s, sid = rec.settlementId;
  if (s.settlements?.[sid]?.detail === 'abstract') { layToRest(g, sid, c.id, graveTile(g, sid)); return; }
  const id = g.newId('body');
  (s.bodies ||= {})[id] = { id, cid: c.id, settlementId: sid, x: rec.x, y: rec.y, tick: s.tick };
}

/** death.js killColonist: close family grieve. Before the dead's home place is freed. */
export function mourn(g, c) {
  const s = g.s, until = s.tick + BURIAL.griefDays * TICKS_PER_DAY;
  for (const o of Object.values(s.colonists).sort((a, b) => byId(a.id, b.id))) {
    if (o === c) continue;
    const family = (c.homeId && o.homeId === c.homeId) || c.parents?.includes(o.id) || o.parents?.includes(c.id);
    if (!family) continue;
    o.grief = { until, for: c.name, work: BURIAL.griefWork }; // jobs.js workSpeed reads it; health.js drops it once over
  }
}

/** Game.tick, hourly while there are bodies: bodies left too long, or of a village now simulated at a distance (or
 *  gone), are laid to rest by the village. In id order. */
export function tickBurial(g) {
  const s = g.s;
  if (!s.bodies || s.tick % TICKS_PER_HOUR) return;
  for (const id of Object.keys(s.bodies).sort(byId)) {
    const b = s.bodies[id];
    if (b.carriedBy && s.colonists[b.carriedBy]?.job?.bodyId === id) continue; // on the way to the graveyard
    const abstract = s.settlements?.[b.settlementId]?.detail === 'abstract';
    if (!abstract && s.tick - b.tick < BURIAL.layAfterDays * TICKS_PER_DAY) continue;
    delete s.bodies[id];
    layToRest(g, b.settlementId, b.cid, graveTile(g, b.settlementId));
  }
  if (!Object.keys(s.bodies).length) delete s.bodies;
}

function go(g, c, j, x, y, mode, what) {
  const r = travel(g, c, j, x, y, mode, what);
  if (r === true) return 'arrived';
  if (r === false) return 'moving';
  return r;
}

export const BURIAL_GIVERS = {
  // Carry a body of the village to the graveyard and bury it: the nearest body offered (one at a time). As with
  // tending (givers.js core:tend), in contact games nobody walks out to a body beyond contact.tendRange of the
  // village centre (it is laid to rest by the village after the waiting days); the trip budget (trips.js) applies.
  'core:bury': {
    find(g, c, params, wt) {
      const s = g.s;
      if (!s.bodies || isDown(c)) return [];
      const sid = sidOf(g, c), out = [];
      const tendRange = contactRules(g)?.tendRange, centre = tendRange !== undefined ? settlementOf(g, sid)?.center : null;
      let best = null, bd = Infinity;
      for (const id of Object.keys(s.bodies).sort(byId)) {
        const b = s.bodies[id];
        if (b.settlementId !== sid || b.carriedBy) continue;
        if (centre && octile(centre.x, centre.y, b.x, b.y) > tendRange) continue;
        const key = 'body:' + id;
        if (g.isReserved(key, c.id) || g.isBlocked(key)) continue;
        const d = octile(c.x, c.y, b.x, b.y);
        if (d < bd && g.canReach(c, b.x, b.y, 'adj')) { best = b; bd = d; }
      }
      if (best) {
        const b = best, id = b.id, key = 'body:' + id;
        const at = graveTile(g, sid);
        if (!at || !g.canReach(c, at.x, at.y, 'on')) return out;
        const name = s.dead?.[b.cid]?.name || 'the dead';
        out.push({
          x: b.x, y: b.y, far: { x: b.x, y: b.y, carry: true }, urgency: 0.9, label: `Bury ${name}`,
          make: () => {
            const job = newJob('bury', { bodyId: id, gx: at.x, gy: at.y, stage: 'go' }, { why: `${name} died`, label: `Bury ${name}`, targetKey: key, workType: wt.id });
            if (!g.reserveExcl(job, key, c.id)) return null;
            if (!g.reserveExcl(job, `grave:${at.x},${at.y}`, c.id)) { g.release(job); return null; }
            return job;
          },
        });
      }
      return out;
    },
  },
};

export const BURIAL_DRIVERS = {
  bury: {
    valid(g, c, j) { return !!g.s.bodies?.[j.bodyId]; },
    tick(g, c, j) {
      const b = g.s.bodies?.[j.bodyId];
      if (!b) return 'done';
      const name = g.s.dead?.[b.cid]?.name || 'the dead';
      if (j.stage === 'go') {
        const r = go(g, c, j, b.x, b.y, 'adj', name);
        if (r === 'moving') { c.status.action = `Going to ${name}'s body`; return 'running'; }
        if (r !== 'arrived') return r;
        b.carriedBy = c.id; j.stage = 'carry';
      }
      if (j.stage === 'carry') {
        const r = go(g, c, j, j.gx, j.gy, 'on', 'the graveyard');
        b.x = Math.round(c.x); b.y = Math.round(c.y);
        if (r === 'moving') { c.status.action = `Carrying ${name} to the graveyard`; return 'running'; }
        if (r !== 'arrived') { delete b.carriedBy; return r; }
        j.stage = 'dig'; j.prog = 0;
      }
      j.prog = (j.prog || 0) + 1;
      c.status.action = `Burying ${name}`;
      if (j.prog < BURIAL.work) return 'running';
      g.release(j, (x) => x.key === `grave:${j.gx},${j.gy}`);
      const sid = b.settlementId;
      const at = graveFree(g, sid, j.gx, j.gy, undefined) ? { x: j.gx, y: j.gy } : graveTile(g, sid);
      delete g.s.bodies[j.bodyId];
      if (!Object.keys(g.s.bodies).length) delete g.s.bodies;
      layToRest(g, sid, b.cid, at, c);
      return 'done';
    },
    cleanup(g, c, j) {
      const b = g.s.bodies?.[j.bodyId];
      if (b && b.carriedBy === c.id) { delete b.carriedBy; b.x = Math.round(c.x); b.y = Math.round(c.y); }
    },
  },
};
