// Factory and machine visibility (read-only). For every powered machine that is a recipe station, explain
// whether it is built and, if not, the first thing holding it back: research, demand, a generator, space.
// Fuel and materials are shown too but never block (they are gathered once work starts). Nothing here
// changes the plan: a machine is only built when something the colony is making would use it (the planner
// decides in `resolve`, planner.js); it is never forced.
import { isUnlocked, requiredTechs, settlementOf, eligibleTechs, milestoneStatus, PRIORITY_LABEL } from './research.js';
import { templateUnlocked, SIZING } from './planner.js';
import { PLAN_INTERVAL, TICKS_PER_HOUR } from './constants.js';
import { buildingCounts } from './civic/needs.js';
import { powerAt, chargeOf } from './power.js';

/** Buildings that use power and are the station of at least one recipe. */
export function machineStations(g) {
  const stations = new Set(g.reg.all('recipe').map((r) => r.station));
  return g.reg.all('building').filter((b) => b.power?.use > 0 && stations.has(b.id));
}

const techName = (g, t) => g.reg.get('tech', t)?.name || t;

/** Why a technology is not done yet, in words. */
export function researchReason(g, sid, techs) {
  const r = settlementOf(g, sid)?.research;
  const t = g.reg.get('tech', techs[0]);
  if (!r || !t) return `Needs research: ${techs.map((x) => techName(g, x)).join(' or ') || 'unknown'}`;
  if (r.current === t.id) return `Researching ${t.name} now (${Math.floor((100 * (r.progress[t.id] || 0)) / t.research)}%)`;
  // Follow the first missing prerequisite down to the technology that is actually holding things up.
  const chain = [t];
  for (let cur = t, n = 0; n < 12; n++) {
    const miss = (cur.prerequisites || []).find((p) => !r.done.includes(p));
    if (!miss || !g.reg.get('tech', miss)) break;
    cur = g.reg.get('tech', miss); chain.push(cur);
  }
  const root = chain[chain.length - 1];
  const path = `Needs research ${chain.map((x) => x.name).join(' ← ')}`;
  if (r.current === root.id) {
    // Research cannot start until its materials are paid; say what is missing and why.
    const P = g.plans?.[sid] || g.plan, stock = P?.stock || {};
    const short = r.paid?.[root.id] ? [] : (root.cost || []).filter((k) => (stock[k.item] || 0) < k.qty);
    if (short.length) return `${path}: ${root.name} waits for ${short.map((k) => { const why = supplyReason(g, sid, P, k.item); return `${k.qty - (stock[k.item] || 0)} ${itemName(g, k.item)}${why ? ` (${why})` : ''}`; }).join(', ')} before it can start`;
    return `${path}: researching ${root.name} now (${Math.floor((100 * (r.progress[root.id] || 0)) / root.research)}%)`;
  }
  const rootField = g.reg.get('techField', root.field)?.name || root.field;
  const off = chain.find((x) => (r.priorities[x.field] ?? 2) === 0);
  if (off) return `${path}, but the ${g.reg.get('techField', off.field)?.name || off.field} field is switched Off`;
  if (!eligibleTechs(g, sid).some((x) => x.id === root.id) && (root.prerequisites || []).every((p) => r.done.includes(p))) {
    const era = g.reg.get('era', root.era);
    const todo = eraBlockers(g, sid, root.era);
    return `${path}, which needs the ${era?.name || root.era} era${todo.length ? ` (still to do: ${todo.join('; ')})` : ''}`;
  }
  return `${path} (${rootField} is ${PRIORITY_LABEL[r.priorities[root.field] ?? 2]} priority; waiting its turn)`;
}

/** Unmet milestones of every era up to and including `eraId` that the settlement has not reached. */
function eraBlockers(g, sid, eraId) {
  const r = settlementOf(g, sid).research;
  const order = (id) => g.reg.get('era', id)?.order ?? 0;
  const out = [];
  for (const era of g.reg.idx.eras) {
    if (order(era.id) <= order(r.era) || order(era.id) > order(eraId)) continue;
    for (const m of milestoneStatus(g, sid, era) || []) if (!m.ok) out.push(`${m.text} (${m.have}/${m.need})`);
  }
  return out;
}

/**
 * Why an item is short, following its production chain a few steps: a missing station, a missing input,
 * or nothing left to gather on the settlement's land. '' when it is simply on its way.
 */
export function supplyReason(g, sid, P, item, depth = 0) {
  const reg = g.reg, stock = P?.stock || {};
  if (depth > 3) return '';
  const land = P?.landNeeds?.[item];
  const counts = buildingCounts(g, sid);
  if (land) {
    const base = `no ${[...new Set(land.nodes.map((n) => reg.get('node', n)?.name || n))].join(' or ')} left on your land`;
    const fb = (reg.idx.recipesFor[item] || []).filter((r) => r.fallback);
    const fbOk = fb.filter((r) => isUnlocked(g, sid, 'recipe', r.id));
    if (!fb.length) return `${base}: ask a neighbour for gathering rights, or trade for ${itemName(g, item)}`;
    if (!fbOk.length) return `${base}: research ${[...new Set(fb.flatMap((r) => requiredTechs(g, 'recipe', r.id)))].map((t) => techName(g, t)).join(' or ')} to make it, or get gathering rights or trade`;
    const run = fbOk.find((r) => (counts.get(r.station)?.built || 0) > 0);
    if (!run) return `${base}: the ${reg.get('building', fbOk[0].station)?.name || fbOk[0].station} is not built yet`;
  }
  const rs = (reg.idx.recipesFor[item] || []).filter((r) => isUnlocked(g, sid, 'recipe', r.id));
  if (!rs.length) return (reg.idx.nodesFor?.[item] || []).length ? '' : (reg.idx.recipesFor[item] || []).length ? 'its recipe needs research' : `cannot be made here: trade for ${itemName(g, item)}`;
  const r = rs.find((x) => (counts.get(x.station)?.built || 0) > 0);
  if (!r) return `the ${reg.get('building', rs[0].station)?.name || rs[0].station} is not built yet`;
  for (const inp of r.inputs) {
    if (!inp.item || (stock[inp.item] || 0) >= inp.qty) continue;
    const why = supplyReason(g, sid, P, inp.item, depth + 1);
    if (why) return `${r.name} needs ${itemName(g, inp.item)}: ${why}`;
  }
  return '';
}

const itemName = (g, id) => g.reg.get('item', id)?.name || id;

/**
 * Status of every machine for a settlement: [{ id, name, state, headline, steps: [{ key, ok, text }], built, inflight }].
 * States: 'running', 'unpowered', 'building', 'planned', 'blocked', 'idle' (not needed now), 'locked' (research).
 */
/** Ids in the order they were made ('b913' before 'b1172'). */
const byIdNum = (x, y) => x.id.length - y.id.length || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
const ordinal = (n) => n + ((n % 100 >= 11 && n % 100 <= 13) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

/** Machine count against demand (planner.js planMachineCount): '; 3rd wanted: …', ', enough', ... */
function sizingText(g, b, c, rec) {
  const most = b.maxMachines ?? SIZING.maxMachines;
  if (!rec) return c.built > 1 ? (c.built >= most ? ` (the most: ${most})` : ', enough') : '';
  const nth = ordinal(rec.have + 1);
  if (rec.state === 'wanted') return `; ${nth} wanted: ${rec.why}`;
  if (rec.state === 'building') return `; ${ordinal(rec.have)} being built`;
  if (rec.state === 'waiting') return `; ${nth} waits until the ${g.reg.get('building', rec.waitFor)?.name || rec.waitFor} is built (one new machine at a time): ${rec.why}`;
  if (rec.state === 'paused') return `; ${nth} on hold while the machines cannot run: ${rec.why}`;
  const busy = Math.round((rec.busy || 0) / TICKS_PER_HOUR), need = Math.round(SIZING.busyTicks / TICKS_PER_HOUR);
  return `; ${nth} wanted if this lasts a day with the machines busy ${need} hours (${busy} so far): ${rec.why}`;
}

/** Generator count against load (planner.js samplePower, planGenerators), as one more line of the machine list. */
function generatorStatus(g, sid, P, counts, own) {
  const rec = P?.sizing?.power;
  if (!rec) return null;
  const gen = g.ownedWhere('power', (st) => !!g.bDef(st)?.power, sid).find((st) => own(st) && g.bDef(st)?.power?.output > 0);
  if (!gen) return null;
  const def = g.bDef(gen);
  const c = counts.get(def.id) || { built: 0, inflight: 0 };
  const hours = Math.round(((rec.samples?.length || 0) * PLAN_INTERVAL) / TICKS_PER_HOUR), after = Math.round(SIZING.lowTicks / TICKS_PER_HOUR);
  const most = def.maxMachines ?? SIZING.maxMachines;
  const load = `overloaded ${hours} of the last 24 hours (another is wanted after ${after})`;
  const steps = [{ key: 'load', ok: hours < after, text: `Machines ${load}` }];
  const it = P?.intents?.get?.('station:' + def.id);
  if (it?.blocked && it.blocked.kind !== 'research' && it.need > 0) steps.push({ key: 'site', ok: false, text: it.blocked.reason });
  const n = `${c.built} built`;
  let headline;
  if (rec.state === 'wanted') headline = `${n}; ${ordinal(c.built + 1)} wanted: ${rec.why}`;
  else if (rec.state === 'building' || c.inflight) headline = `${n}; ${ordinal(c.built + 1)} being built`;
  else if (rec.state === 'most' || (hours && c.built >= most)) headline = `${n} (the most: ${most}); ${load}`;
  else if (hours) headline = `${n}; ${load}`;
  else headline = `${n}, enough`;
  const blocked = steps.some((x) => x.key === 'site');
  if (blocked) headline += ` · ${steps.find((x) => x.key === 'site').text}`;
  return { id: def.id, name: def.name, kind: 'generator', state: blocked ? 'blocked' : 'running', headline, steps, built: c.built, inflight: c.inflight };
}

export function machineStatus(g, sid, P = g.plans?.[sid] || g.plan) {
  const reg = g.reg, stock = P?.stock || {};
  const counts = buildingCounts(g, sid);
  const own = (e) => (e?.settlement || g.s.playerSettlement) === sid;
  const out = [];
  for (const b of machineStations(g)) {
    const steps = [];
    const c = counts.get(b.id) || { built: 0, inflight: 0 };
    const tpls = reg.all('template').filter((t) => (t.provides || []).includes(b.id));
    const recipes = reg.all('recipe').filter((r) => r.station === b.id);
    // 1. Research.
    const bUnlocked = isUnlocked(g, sid, 'building', b.id);
    if (bUnlocked && tpls.some((t) => templateUnlocked(g, sid, t))) steps.push({ key: 'research', ok: true, text: 'Researched' });
    else if (!tpls.length) steps.push({ key: 'research', ok: false, text: 'No building plan places it' });
    else {
      const techs = bUnlocked ? [...new Set(tpls.flatMap((t) => requiredTechs(g, 'template', t.id)))] : requiredTechs(g, 'building', b.id);
      steps.push({ key: 'research', ok: false, text: researchReason(g, sid, techs) });
    }
    // 2. Demand: something the colony is making now could use it.
    const dem = P?.machineDemand?.[b.id];
    const makes = recipes.map((r) => r.outputs.map((o) => itemName(g, o.item)).join(', ')).join('; ');
    steps.push(dem ? { key: 'demand', ok: true, text: `Wanted for: ${dem.recipes.join(', ')} (${dem.why})` }
      : { key: 'demand', ok: false, text: `Not needed now: nothing the colony is making uses it (it makes ${makes})` });
    // 3. A generator.
    const genBuilt = g.ownedWhere('power', (st) => !!g.bDef(st)?.power, sid).some((st) => own(st) && st.built && g.bDef(st)?.power?.output > 0);
    const genDefs = reg.all('building').filter((x) => x.power?.output > 0);
    const genOK = genBuilt || genDefs.some((x) => isUnlocked(g, sid, 'building', x.id) && reg.all('template').some((t) => (t.provides || []).includes(x.id) && templateUnlocked(g, sid, t)));
    steps.push({ key: 'generator', ok: genOK, text: genBuilt ? 'A generator is built' : genOK ? 'A generator can be built' : `No generator can be built yet${genDefs[0] ? ': ' + researchReason(g, sid, requiredTechs(g, 'building', genDefs[0].id)).replace(/^Needs research /, 'research ') : ''}` });
    // 4. Fuel (informational: the generator is fed by the normal hauling).
    const fuels = reg.itemsWithTag('core:fuel').filter((it) => (stock[it] || 0) > 0);
    steps.push({ key: 'fuel', ok: fuels.length > 0, text: fuels.length ? `Fuel in stock: ${fuels.map((f) => `${stock[f]} ${itemName(g, f)}`).join(', ')}` : 'No fuel in stock' });
    // 5. Materials for the machine itself (informational: gathered once a project starts).
    const missing = (b.cost || []).filter((k) => (stock[k.item] || 0) < k.qty).map((k) => `${k.qty - (stock[k.item] || 0)} ${itemName(g, k.item)}`);
    steps.push({ key: 'materials', ok: !missing.length, text: missing.length ? `Materials still to gather: ${missing.join(', ')}` : 'Materials in stock' });
    // 6. Space (a failed site search, from the civic intent).
    const it = P?.intents?.get?.('station:' + b.id);
    if (it?.blocked && it.blocked.kind !== 'research') steps.push({ key: 'site', ok: false, text: it.blocked.reason });
    // 7. One new machine at a time (planner.js resolve): another powered workstation is being built first.
    const waitFor = !c.built && !c.inflight && P?.machineWaits?.[b.id];
    if (waitFor) steps.push({ key: 'wait', ok: false, text: `Waiting until the ${reg.get('building', waitFor)?.name || waitFor} is built (one new machine at a time)` });
    // Overall state: the first blocking step decides.
    let state, headline;
    if (c.built) {
      const st = g.ownedWhere('def:' + b.id, (x) => x.def === b.id, sid).find((x) => own(x) && x.built && x.def === b.id);
      const pw = powerAt(g, st);
      state = pw.ratio > 0 ? 'running' : 'unpowered';
      const why = P?.powerNote || pw.reason || 'not running';
      headline = (c.built > 1 ? `${c.built} built` : 'Built') + sizingText(g, b, c, P?.sizing?.machines?.[b.id]) + (pw.ratio > 0 ? (pw.ratio < 1 ? ` · power ${Math.round(pw.ratio * 100)}%` : ' · powered') : ` · no power: ${why}`);
      steps.push({ key: 'power', ok: pw.ratio > 0, text: pw.ratio > 0 ? 'Powered' : why });
      // Why each extra machine of this kind was built (the reason of the project that placed it).
      const all = g.ownedWhere('def:' + b.id, (x) => x.def === b.id, sid).filter((x) => own(x) && x.def === b.id).sort(byIdNum);
      all.slice(1).forEach((x, i) => steps.push({ key: 'count', ok: true, text: `${g.s.projects[x.projectId]?.why || `${ordinal(i + 2)} ${b.name.toLowerCase()}`}${x.built ? '' : ' (being built)'}` }));
    } else if (c.inflight) {
      const proj = g.owned('projects', sid).find((p) => p.status === 'active' && own(p) && p.parts.some((id) => g.s.structures[id]?.def === b.id && !g.s.structures[id].built));
      const parts = proj ? proj.parts.map((id) => g.s.structures[id]).filter(Boolean) : [];
      state = 'building';
      headline = proj ? `Being built: ${proj.name} (${parts.filter((x) => x.built).length}/${parts.length} parts)` : 'Being built';
      // What the machine itself is still waiting for, and whether anything can make it.
      const short = (b.cost || []).filter((k) => (stock[k.item] || 0) < k.qty);
      if (short.length) {
        const why = short.map((k) => {
          const rs = (reg.idx.recipesFor[k.item] || []).filter((r) => isUnlocked(g, sid, 'recipe', r.id));
          const made = rs.find((r) => (counts.get(r.station)?.built || 0) > 0);
          const src = !rs.length ? '' : made ? ` (made at the ${reg.get('building', made.station)?.name})` : ` (the ${reg.get('building', rs[0].station)?.name} is not built yet)`;
          return `${k.qty - (stock[k.item] || 0)} ${itemName(g, k.item)}${src}`;
        });
        headline += ` · waiting for ${why.join(', ')}`;
      }
    } else {
      const first = steps.find((x) => !x.ok && x.key !== 'materials' && x.key !== 'fuel');
      if (!first) { state = 'planned'; headline = 'Planned: waiting its turn to be laid out'; }
      else { state = first.key === 'research' ? 'locked' : first.key === 'demand' ? 'idle' : first.key === 'wait' ? 'planned' : 'blocked'; headline = first.text; }
    }
    out.push({ id: b.id, name: b.name, state, headline, steps, built: c.built, inflight: c.inflight });
  }
  // Generators last (after the machines, which keep their order): how many, and whether another is wanted.
  const gs = out.length ? generatorStatus(g, sid, P, counts, own) : null;
  if (gs) out.push(gs);
  const bs = gs ? batteryStatus(g, sid, P, counts, own) : null;
  if (bs) out.push(bs);
  return out;
}

/** Battery banks (power storage), after the generator line, once one can be built: how many, what they hold, and
 *  whether one is wanted (planner.js planBatteries: one beside the generator of each network that has none). */
function batteryStatus(g, sid, P, counts, own) {
  const def = g.reg.all('building').find((b) => b.power?.store > 0 && isUnlocked(g, sid, 'building', b.id));
  if (!def) return null;
  const c = counts.get(def.id) || { built: 0, inflight: 0 };
  const bats = g.ownedWhere('power', (st) => !!g.bDef(st)?.power, sid).filter((st) => own(st) && st.built && g.bDef(st).power.store > 0);
  const stored = Math.floor(bats.reduce((a, st) => a + chargeOf(st), 0)), cap = bats.reduce((a, st) => a + g.bDef(st).power.store, 0);
  const it = P?.intents?.get?.('utility:battery');
  const steps = [{ key: 'store', ok: true, text: `${def.name}: stores ${def.power.store} for shortfalls (gives up to ${def.power.charge} power while the generators fall short or stop)` }];
  if (it?.blocked && it.need > 0) steps.push({ key: 'site', ok: false, text: it.blocked.reason });
  let headline = `${c.built} built`;
  if (c.built) headline += `; ${stored}/${cap} stored`;
  if (c.inflight) headline += `; ${c.built ? 'another' : 'one'} being built`;
  else if (it?.need > 0) headline += `; ${c.built ? 'another' : 'one'} wanted: ${it.sources?.[0]?.why || 'beside a generator'}`;
  const blocked = steps.some((x) => x.key === 'site');
  if (blocked) headline += ` · ${steps.find((x) => x.key === 'site').text}`;
  return { id: def.id, name: def.name, kind: 'battery', state: blocked ? 'blocked' : c.built ? 'running' : 'planned', headline, steps, built: c.built, inflight: c.inflight };
}
