// Animal pens (Phase 9, slice 3; docs/proposals/phase-9-livestock.md). A pen is a project built from a template of
// kind `pen` (data: a ring of fences with a gate round open ground). Fences are a building category of their own,
// so heat.js never takes a pen for a room. The project is the pen: `project.pen = { sp }` names the species it is
// for. A pen is closed when every fence and the gate stand built; until then nobody brings an animal in.
// A full-detail village of at least PEN.minPeople lays out one pen, for the tameable species (data: `tame`) whose
// herd is nearest within PEN.reach tiles, once it has PEN.wood wood; the reason and the pen's state are shown
// (P.penNote).
import { createProject, findSite } from './construction.js';
import { herdsWithin } from './animals.js';
import { settlementOf } from './research.js';
import { siteDay } from './forestry.js';

export const PEN = Object.freeze({ minPeople: 6, reach: 60, wood: 30, radius: 26, homeGap: 6 });

/** The pens of village sid (projects of a pen template), in id order. */
export const pensOf = (g, sid) => g.owned('projects', sid).filter((p) => p.pen && p.status !== 'cancelled' && g.reg.get('template', p.templateId)?.kind === 'pen'); // a pen destroyed (ruin.js) is no pen

/** How far pen p is from closed: { closed, missing } (fence sections and the gate not standing built). */
export function penState(g, p) {
  const missing = p.parts.filter((id) => !g.s.structures[id]?.built).length;
  return { closed: missing === 0 && p.parts.length > 0, missing };
}

/** The nearest herd of a tameable species within PEN.reach of (x, y): { h, d, dist }, or null. */
export function tameableNear(g, x, y) {
  let best = null;
  for (const h of herdsWithin(g, x, y, PEN.reach)) {
    const d = g.reg.get('animal', h.sp);
    if (!d?.tame || h.n < 2) continue;
    const dist = Math.hypot(h.x - x, h.y - y);
    if (dist <= PEN.reach && (!best || dist < best.dist || (dist === best.dist && h.id < best.h.id))) best = { h, d, dist };
  }
  return best;
}

/** The planner (planner.js): keep P.penNote, and lay out a first pen when the village is ready for one. */
export function planPens(g, P, sid, cols) {
  delete P.penNote; // set below only when there is something to say (a key in every plan would change every save)
  const st = settlementOf(g, sid);
  if (!st || st.detail === 'abstract' || !g.s.animals || cols.length < PEN.minPeople) return;
  const pen = pensOf(g, sid)[0];
  if (pen) {
    const k = penState(g, pen), name = g.reg.get('animal', pen.pen.sp)?.tame?.plural || pen.pen.sp;
    P.penNote = k.closed ? `The pen for ${name} is ready` : `The pen for ${name} is not closed yet: ${k.missing} section${k.missing === 1 ? '' : 's'} to build`;
    return;
  }
  const ctr = st.center || g.s.center;
  const near = tameableNear(g, ctr.x, ctr.y);
  if (!near) { P.penNote = 'No herd to tame near the village'; return; }
  const what = `${near.d.tame.plural} (a herd of ${near.h.n} ${near.d.plural || near.d.name}, ${Math.round(near.dist)} tiles away)`;
  if ((P.stock['core:wood'] || 0) < PEN.wood) { P.penNote = `Waiting for ${PEN.wood} wood to build a pen for ${what}`; return; }
  if (!siteDay(g, sid)) { P.penNote = `Looking for room for a pen for ${what}`; return; } // the site search, one day in three (forestry.js siteDay)
  const tpl = g.reg.all('template').find((t) => t.kind === 'pen');
  const homes = g.owned('projects', sid).filter((x) => g.reg.get('template', x.templateId)?.kind === 'home').map((x) => ({ x: x.x, y: x.y }));
  const site = tpl && findSite(g, tpl, { center: ctr, sid, radius: PEN.radius, keepFrom: { points: homes, gap: PEN.homeGap, cost: 2, what: 'the homes' } }); // animals are kept away from homes
  if (!site) { P.penNote = `No room for a pen for ${what}`; return; }
  const p = createProject(g, tpl, site, { urgency: 0.35, why: `A pen for ${what}`, owner: sid });
  p.pen = { sp: near.h.sp };
  P.penNote = `Building a pen for ${what}`;
  g.log(`The colonists of ${st.name} are building a pen for ${near.d.tame.plural}: a herd of ${near.h.n} ${near.d.plural || near.d.name} lives ${Math.round(near.dist)} tiles away.`, 'build', null, 0, { kind: 'core:pen', sids: [sid], at: { x: site.x, y: site.y } });
}
