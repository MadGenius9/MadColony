// Civic need evaluation: turns a settlement's situation into intents. No side effects on the world:
// nothing is planned here, no random numbers are drawn.
import { makeIntent, intentsOf, addSource } from './intents.js';
import { isUnlocked, requiredTechs, settlementOf } from '../research.js';

/** Completed and in-progress buildings of one kind for a settlement. Only completed ones count toward targets. */
export function countBuildings(g, sid, bid) {
  let built = 0, inflight = 0;
  for (const st of Object.values(g.s.structures)) {
    if (st.def !== bid || (st.settlement || g.s.playerSettlement) !== sid) continue;
    if (st.built) built++;
    else if (g.s.projects[st.projectId]?.status === 'active') inflight++;
  }
  return { built, inflight };
}

/** Completed and in-progress counts for every building kind of a settlement, in one pass (cached per plan). */
export function buildingCounts(g, sid) {
  const m = new Map();
  // Big worlds: the settlement's own structures (ownership index, game.js: the same structures in the same order
  // as a scan of every structure), so a plan costs O(its own structures), not O(the world's). Classic worlds
  // keep the scan (tests there may place structures directly).
  for (const st of g.big ? g.ownIndex('structures').get(sid)?.values() || [] : Object.values(g.s.structures)) {
    if ((st.settlement || g.s.playerSettlement) !== sid) continue;
    let e = m.get(st.def); if (!e) m.set(st.def, (e = { built: 0, inflight: 0 }));
    if (st.built) e.built++;
    else if (g.s.projects[st.projectId]?.status === 'active') e.inflight++;
  }
  return m;
}
export const countsOf = (g, P, sid) => (P._counts ||= buildingCounts(g, sid));

/** A template that places this building, usable by this settlement (template and all its fixed parts unlocked). */
export function templatesProviding(g, sid, bid, templateUnlocked) {
  return g.reg.all('template').filter((t) => (t.provides || []).includes(bid) && templateUnlocked(g, sid, t));
}

/**
 * Record a station need (a building that must exist, `target` of them in total) and return its intent with
 * counts, dependencies and any blocker that can be known without a site search.
 */
export function needStation(g, P, sid, bid, target, priority, source, templateUnlocked) {
  const id = 'station:' + bid;
  const all = intentsOf(P);
  let it = all.get(id);
  if (!it) {
    it = makeIntent(id, sid, 'station', bid);
    all.set(id, it);
  }
  const before = it.target;
  addSource(it, source, target, priority);
  if (!it.fresh) { refreshStation(g, it, sid, templateUnlocked, countsOf(g, P, sid)); it.fresh = true; } // counts and blockers once per plan
  else if (it.target !== before) it.need = Math.max(0, it.target - it.completed - it.inFlight);
  return it;
}

function refreshStation(g, it, sid, templateUnlocked, counts) {
  const reg = g.reg, bid = it.building;
  const def = reg.get('building', bid);
  const name = def?.name || bid;
  const c = counts.get(bid) || { built: 0, inflight: 0 };
  it.completed = c.built; it.inFlight = c.inflight;
  it.need = Math.max(0, it.target - c.built - c.inflight);
  it.dependencies = [];
  it.blocked = null;
  if (!def) { it.blocked = { kind: 'template', reason: `Unknown building "${bid}"` }; return; }
  if (!isUnlocked(g, sid, 'building', bid)) {
    const techs = requiredTechs(g, 'building', bid);
    const r = settlementOf(g, sid)?.research;
    const open = techs.filter((t) => (r?.priorities?.[reg.get('tech', t)?.field] ?? 2) > 0);
    it.dependencies.push({ kind: 'research', ref: techs, ok: false, why: techs.map((t) => reg.get('tech', t)?.name).join(' or ') });
    it.blocked = open.length
      ? { kind: 'research', reason: `A ${name} requires research: ${techs.map((t) => reg.get('tech', t)?.name).join(' or ')}`, techs: open }
      : { kind: 'research', reason: `A ${name} needs research in a field you switched Off (${[...new Set(techs.map((t) => reg.get('techField', reg.get('tech', t)?.field)?.name))].join(', ')})`, techs: [] };
    return;
  }
  const tpls = templatesProviding(g, sid, bid, templateUnlocked);
  it.dependencies.push({ kind: 'template', ref: tpls.map((t) => t.id), ok: tpls.length > 0 });
  if (!tpls.length) it.blocked = { kind: 'template', reason: `No building template provides a ${name}` };
}

/** The housing intent: enough beds (planned or built) for everyone plus any goal target. */
export function needHousing(g, P, sid, ctx, cols, maxActive) {
  const s = g.s;
  const own = (e) => (e?.settlement || s.playerSettlement) === sid;
  const homes = g.owned('homes', sid).filter(own);
  const planned = homes.reduce((a, h) => a + h.capacity, 0);
  const complete = homes.filter((h) => h.complete).reduce((a, h) => a + h.capacity, 0);
  const target = Math.max(ctx.housingTarget, cols.length);
  const active = g.owned('projects', sid).filter((p) => p.kind === 'home' && own(p) && p.status === 'active' && !s.homes[p.homeId]?.complete);
  const it = makeIntent('housing', sid, 'home');
  addSource(it, { kind: ctx.housingGoal ? 'goal' : 'population', why: ctx.housingGoal ? 'Goal: a furnished home for everyone' : ctx.housingWhy && target > cols.length ? ctx.housingWhy : 'Housing for homeless colonists', goal: ctx.housingGoal }, target, ctx.housingUrgency);
  it.completed = complete;
  it.inFlight = planned - complete;
  it.need = Math.max(0, target - planned); // in beds
  if (it.need > 0 && active.length >= maxActive) it.blocked = { kind: 'wait', reason: 'Finishing current homes before starting more' };
  intentsOf(P).set(it.id, it);
  return it;
}

/**
 * Record a utility need: one more `building` (placed with `template`) near the first of `near` that has a
 * free spot. `near` holds only targets nothing serves yet, in the order to serve them. `inFlight` counts
 * the ones planned or under construction, `completed` the finished ones. With `oneAtATime`, no new one is
 * wanted while any is unbuilt (lamps); otherwise one per unserved target (taps). The site search happens at
 * commitment (sites.js nearSite), so nothing in the world is touched here and no random numbers are drawn.
 */
export function needUtility(g, P, sid, { key, building, template, near, completed = 0, inFlight = 0, oneAtATime = false, cover = 0, priority = 0.4, label, why, log }) {
  const it = makeIntent('utility:' + key, sid, 'utility', building);
  Object.assign(it, { template, near, cover, oneAtATime, label, whyText: why, logText: log, sig: near.map((n) => `${n.x},${n.y}`).join(';') });
  const want = oneAtATime ? (inFlight > 0 ? 0 : Math.min(1, near.length)) : near.length;
  addSource(it, { kind: 'service', why: near.length ? fillName(why, near[0].name) : `${label} wherever one is needed` }, completed + inFlight + want, priority);
  it.completed = completed;
  it.inFlight = inFlight;
  it.need = want;
  intentsOf(P).set(it.id, it);
  return it;
}

/** Replace {name} in a utility's reason or log text. */
export const fillName = (text, name) => String(text).split('{name}').join(name);
