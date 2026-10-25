// Research and eras, per settlement. Technologies only unlock content; they never create anything.
// Settlement planning picks the next technology (within the player's field priorities) and makes sure
// a research station exists; colonists then do the research as ordinary jobs.

export const PRIORITY_LABEL = { 0: 'Off', 1: 'Low', 2: 'Normal', 3: 'High' };
const DEFAULT_PRIORITY = { 'core:utilities': 1, 'core:defense': 1 };

export function newResearchState(reg) {
  const priorities = {};
  for (const f of reg.all('techField')) priorities[f.id] = DEFAULT_PRIORITY[f.id] ?? 2;
  return { done: [], progress: {}, paid: {}, current: null, reason: '', era: reg.idx.eras[0]?.id || null, priorities, completed: [] };
}

/** Make sure a settlement record has every field the current content needs (new fields, new tech fields). */
export function ensureSettlement(reg, s, st) {
  st.research ||= newResearchState(reg);
  const r = st.research;
  r.done ||= []; r.progress ||= {}; r.paid ||= {}; r.priorities ||= {}; r.completed ||= [];
  for (const f of reg.all('techField')) if (r.priorities[f.id] === undefined) r.priorities[f.id] = DEFAULT_PRIORITY[f.id] ?? 2;
  if (!r.era || !reg.get('era', r.era)) r.era = reg.idx.eras[0]?.id || null;
  st.center ||= s.center;
  return st;
}

export const settlementOf = (g, sid) => g.s.settlements?.[sid];

/** Is a recipe/building/template available to this settlement? Content no technology unlocks is always available. */
export function isUnlocked(g, sid, type, id) {
  const techs = g.reg.idx.lockedBy?.[type]?.[id];
  if (!techs?.length) return true;
  const done = settlementOf(g, sid)?.research?.done || [];
  return techs.some((t) => done.includes(t));
}
export function requiredTechs(g, type, id) { return g.reg.idx.lockedBy?.[type]?.[id] || []; }

const eraOrder = (g, eraId) => g.reg.get('era', eraId)?.order ?? 0;

/** A technology with a `scenarioFeature` (e.g. trade routes: "market") exists only in scenarios that turn that
 *  feature on (a scenario block of that name); elsewhere it is never researched. */
export function techInScenario(g, t) {
  return !t?.scenarioFeature || !!g.reg.get('scenario', g.s.scenarioId)?.[t.scenarioFeature];
}

export function eligibleTechs(g, sid) {
  const r = settlementOf(g, sid)?.research;
  if (!r) return [];
  const cur = eraOrder(g, r.era);
  return g.reg.all('tech').filter((t) => !r.done.includes(t.id)
    && eraOrder(g, t.era) <= cur
    && (t.prerequisites || []).every((p) => r.done.includes(p))
    && techInScenario(g, t));
}

/**
 * Choose what to research: highest field priority first; within a priority, technologies that unblock
 * something the settlement is currently trying to do, then the cheapest. Returns {tech, reason} or null.
 */
export function chooseTech(g, sid, wanted = new Set()) {
  const r = settlementOf(g, sid).research;
  const cands = eligibleTechs(g, sid).filter((t) => (r.priorities[t.field] ?? 2) > 0);
  if (!cands.length) return null;
  const fieldName = (t) => g.reg.get('techField', t.field)?.name || t.field;
  const urgent = wanted.urgent || new Set();
  cands.sort((a, b) => (urgent.has(b.id) ? 1 : 0) - (urgent.has(a.id) ? 1 : 0)
    || (r.priorities[b.field] ?? 2) - (r.priorities[a.field] ?? 2)
    || (wanted.has(b.id) ? 1 : 0) - (wanted.has(a.id) ? 1 : 0)
    || (a.research - (r.progress[a.id] || 0)) - (b.research - (r.progress[b.id] || 0))
    || (a.id < b.id ? -1 : 1));
  const t = cands[0];
  const p = PRIORITY_LABEL[r.priorities[t.field] ?? 2];
  const why = urgent.has(t.id) ? 'a goal needs it' : wanted.has(t.id) ? 'it unlocks something the settlement is waiting for' : (r.progress[t.id] ? 'work on it has already started' : 'it is the quickest available');
  return { tech: t.id, reason: `${fieldName(t)} is ${p} priority, and ${why}.` };
}

export function milestoneStatus(g, sid, era) {
  const st = settlementOf(g, sid);
  const r = st.research;
  const out = [];
  for (const m of era.milestones || []) {
    let have = 0;
    if (m.type === 'techs') have = r.done.filter((id) => { const t = g.reg.get('tech', id); return t && (!m.era || t.era === m.era) && (!m.field || t.field === m.field); }).length;
    else if (m.type === 'buildings') have = g.owned('structures', sid).filter((b) => b.built && b.def === m.building && (b.settlement || g.s.playerSettlement) === sid).length;
    else if (m.type === 'colonists') have = g.owned('colonists', sid).filter((c) => c.settlementId === sid).length;
    const text = m.text || `${m.type} ${m.count}`;
    out.push({ text, have, need: m.count, ok: have >= m.count });
  }
  return out;
}

/** Advance eras while the next era's milestones are all met (milestones only, never time). */
export function checkEra(g, sid) {
  const r = settlementOf(g, sid).research;
  const eras = g.reg.idx.eras;
  let i = eras.findIndex((e) => e.id === r.era);
  while (i >= 0 && i + 1 < eras.length) {
    const next = eras[i + 1];
    const ms = milestoneStatus(g, sid, next);
    if (!ms.length || !ms.every((m) => m.ok)) break;
    r.era = next.id;
    i++;
    g.log(`${settlementOf(g, sid).name} has entered a new era: ${next.name}.`, 'research');
  }
}

export function completeTech(g, sid, techId) {
  const st = settlementOf(g, sid);
  const r = st.research;
  if (r.done.includes(techId)) return;
  r.done.push(techId);
  r.completed.push({ tech: techId, tick: g.s.tick });
  if (r.current === techId) { r.current = null; r.reason = ''; }
  const t = g.reg.get('tech', techId);
  const u = t?.unlocks || {};
  const names = [
    ...(u.recipes || []).map((id) => g.reg.get('recipe', id)?.name),
    ...(u.buildings || []).map((id) => g.reg.get('building', id)?.name),
    ...(u.templates || []).map((id) => g.reg.get('template', id)?.name),
  ].filter((n, i, all) => n && all.indexOf(n) === i); // a building and its template often share a name: listed once
  g.log(`Research complete: ${t?.name || techId}. Now possible: ${names.join(', ')}.`, 'research');
  checkEra(g, sid);
  g.planDirty = true;
  (g.replanSids ||= new Set()).add(sid); // big worlds: this village plans on the next tick
}

/** Called by the settlement planner. Decides the current tech, whether research may run now, and demands. */
export function planResearch(g, P, sid, ctx) {
  const st = settlementOf(g, sid);
  if (!st) return;
  const r = st.research;
  const pol = g.policyFor(sid);
  checkEra(g, sid);
  // Keep the current tech unless it became ineligible (or its field was switched off).
  const elig = eligibleTechs(g, sid);
  if (r.current && (!elig.some((t) => t.id === r.current) || (r.priorities[g.reg.get('tech', r.current)?.field] ?? 2) === 0)) r.current = null;
  const wanted = P.techWanted || new Set();
  if (r.current && (!wanted.has(r.current) || (wanted.urgent?.size && !wanted.urgent.has(r.current)))) {
    // Something the settlement needs is waiting on research: switch to it (progress on the old tech is kept).
    const cur = g.reg.get('tech', r.current);
    const better = chooseTech(g, sid, wanted);
    if (better && wanted.has(better.tech) && (wanted.urgent?.has(better.tech) || (r.priorities[g.reg.get('tech', better.tech).field] ?? 2) >= (r.priorities[cur?.field] ?? 2))) {
      g.log(`Researchers switched from ${cur?.name} to ${g.reg.get('tech', better.tech)?.name}: ${better.reason}`, 'research', `switch:${sid}:${better.tech}`, 2400);
      r.current = null;
    }
  } else if (r.current && wanted.has(r.current) && !/waiting for/.test(r.reason)) {
    const t = g.reg.get('tech', r.current);
    r.reason = `${g.reg.get('techField', t.field)?.name} is ${PRIORITY_LABEL[r.priorities[t.field] ?? 2]} priority, and it unlocks something the settlement is waiting for.`;
  }
  if (!r.current) {
    const pick = chooseTech(g, sid, wanted);
    if (pick) { r.current = pick.tech; r.reason = pick.reason; g.log(`Researchers chose ${g.reg.get('tech', pick.tech)?.name}: ${pick.reason}`, 'research', `pick:${sid}:${pick.tech}`, 2400); }
    else r.reason = elig.length ? 'All available fields are switched off.' : 'Nothing left to research in this era yet.';
  }
  const minFood = pol.researchMinFoodDays ?? 1.5;
  const homeless = ctx.cols.some((c) => !c.homeId);
  const housingActive = g.owned('projects', sid).some((p) => p.kind === 'home' && p.status === 'active' && (p.settlement || g.s.playerSettlement) === sid && !g.s.homes[p.homeId]?.complete);
  let allowed = !!r.current, why = '';
  if (!r.current) why = r.reason;
  else if (P.foodDays < minFood) { allowed = false; why = `Paused: food reserve is ${P.foodDays.toFixed(1)} days (needs ${minFood}).`; }
  else if (homeless && !housingActive) { allowed = false; why = 'Paused: settlers still need homes.'; }
  const stations = g.reg.idx.researchStations;
  P.research = { tech: r.current, allowed, why, reason: r.reason, stationState: null };
  if (r.current && stations.length && !(homeless && housingActive && P.foodDays < minFood)) {
    // A research station is a normal construction project, behind food and housing in urgency.
    const res = ctx.ensureStation(stations[0], 0.45, 'Research');
    P.research.stationState = res.state;
    if (res.state === 'blocked') P.research.why ||= res.reason;
  }
  // Material cost of the current tech is gathered like any other demand (low urgency).
  const t = r.current && g.reg.get('tech', r.current);
  if (t && !r.paid[t.id]) for (const c of t.cost || []) ctx.demands.push({ item: c.item, qty: c.qty, urgency: 0.4, why: `Research: ${t.name}` });
}

export function researchSummary(g, sid) {
  const st = settlementOf(g, sid);
  if (!st?.research) return null;
  const r = st.research;
  const t = r.current && g.reg.get('tech', r.current);
  return {
    era: g.reg.get('era', r.era)?.name || '-',
    current: t ? `${t.name} (${Math.floor(100 * Math.min(1, (r.progress[t.id] || 0) / t.research))}%)` : 'nothing',
  };
}
