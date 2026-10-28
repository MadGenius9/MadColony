// Colonist decision making: needs first, then equipment, then the best-scoring work, then idling.
// Jobs are sticky: a colonist only re-decides when its job finishes, fails, or an urgent need interrupts.
import { EDUCATION_DRIVERS } from '../education.js';
import { needsCare, mayDoWork } from '../people.js';
import { MEDICAL_DRIVERS } from '../medical.js';
import { BURIAL_DRIVERS } from '../burial.js';
import { octile } from '../util.js';
import { DRIVERS, newJob, dropCarry, skillLevel } from './jobs.js';
import { NEED_BEHAVIORS } from './needs.js';
import { GIVERS, equipCandidate } from './givers.js';
import { tickHealth, isDown, hpOf, maybeAccident, HEALTH } from '../health.js';
import { COMBAT_DRIVERS, COMBAT_JOBS, combatDecision } from '../combat.js';
import { tripChecker, farFromHome } from './trips.js';
import { fireDanger } from '../fire.js';
import { FIRE_DRIVERS } from '../firefight.js';
import { HUNT_DRIVERS } from '../hunt.js';

Object.assign(DRIVERS, COMBAT_DRIVERS, MEDICAL_DRIVERS, EDUCATION_DRIVERS, BURIAL_DRIVERS, FIRE_DRIVERS, HUNT_DRIVERS);

export function tickColonist(g, c) {
  for (const def of g.reg.all('need')) NEED_BEHAVIORS[def.behavior]?.tick(g, c, def);
  tickHealth(g, c);
  if (isDown(c)) { // collapsed: lies where they fell until health returns; others bring food and tend them
    if (c.job) endJob(g, c, null, 'Collapsed');
    c.mv = null;
    c.sleeping = true;
    c.status.goal = 'Recovering';
    c.status.action = `Collapsed (health ${hpOf(c)}%), waiting for care`;
    return;
  }
  if (c.health?.wasDown) { c.health.wasDown = false; c.sleeping = false; }
  if (needsCare(g, c)) { // an infant: stays in bed; the family brings food and water (tending)
    if (c.job) endJob(g, c, null, 'Too young');
    c.mv = null; c.sleeping = true;
    const bed = c.bedId && g.s.structures[c.bedId];
    if (bed?.built && !c.carriedBy) { c.x = bed.x; c.y = bed.y; }
    c.status.goal = 'Growing up'; c.status.action = 'Cared for by the family';
    return;
  }
  // Threats first: fight, flee or march according to the settlement's orders.
  const cj = combatDecision(g, c) || (g.s.disasters ? fireDanger(g, c) : null); // fire: fire.js (Phase 5b)
  if (cj) { if (c.job) endJob(g, c, null, `Danger: ${cj.why}`); startJob(g, c, cj); }

  if (c.job) {
    const why = interruptReason(g, c);
    if (why) {
      g.s.stats.interrupts++;
      endJob(g, c, null, why);
      // Interrupts happen only on a step's last tick (interruptReason): the step finishes now, as travel()
      // would finish it, so the colonist decides at once from the tile it has reached.
      if (c.mv) c.mv = null;
    }
  }
  if (!c.job) {
    if (c.idle > 0 && !c.mv) c.idle--;
    else if (!c.mv) decide(g, c);
  }
  if (c.job) runJob(g, c);
  else if (c.mv) { c.mv.t++; if (c.mv.t >= c.mv.dur) c.mv = null; }
}

// How pressing a need is: the same order decide() uses to pick which need to see to first (lower = sooner).
const needOrder = (c, def) => (c.needs[def.id] ?? 1) - def.seekBelow;
// A need job only gives way to another need this much more pressing, so two needs never take turns.
const NEED_SWITCH_MARGIN = 0.1;
// After a colonist found no way to satisfy an urgent need, the job it took instead is not interrupted for that
// need again for this many ticks (otherwise it would drop and retake the same job at every step).
const UNMET_RETRY = 600;
// Critical: so low that even a carrier drops its load (need def `criticalBelow`, default half of urgentBelow).
const critical = (c, def) => (c.needs[def.id] ?? 1) < (def.criticalBelow ?? def.urgentBelow / 2);
// Big worlds: hunger that is merely wanted (below seekBelow) counts as pressing for a colonist far from home
// (trips.js farFromHome), so it heads back to eat while the food still lasts the walk (food is kept at home).
// Not for journeys that are meant to be far (scouting, delivering to another village).
const JOURNEYS = new Set(['scout', 'trade']);
const farHungry = (g, c, def, b) => def.behavior === 'core:eat' && !c.job?.need && !JOURNEYS.has(c.job?.type) && b.wants(g, c, def) && farFromHome(g, c);
const pressing = (g, c, def, b) => b.urgent(g, c, def) || farHungry(g, c, def, b);
// Carrying a patient or goods on a delivery leg: the leg is finished first unless a need is critical, so
// cargo is not left at the roadside (and nobody is dropped halfway to the clinic).
const carrying = (c, job) => !!c.carry || ((job.type === 'rescue' || job.type === 'bury') && job.stage === 'carry') || (job.type === 'tend' && !!job.water);

function interruptReason(g, c) {
  const job = c.job;
  if (COMBAT_JOBS.has(job.type)) return null; // needs wait while fighting or fleeing
  // A colonist mid-step finishes the step first. travel() starts the next step in the same tick the last one
  // ends, so the check runs on the step's last tick (when travel() would otherwise start the next one).
  if (c.mv && c.mv.t + 1 < c.mv.dur) return null;
  for (const def of g.reg.all('need')) {
    const b = NEED_BEHAVIORS[def.behavior];
    if (!b || !pressing(g, c, def, b)) continue;
    if (job.unmet?.[def.id] !== undefined && g.s.tick - job.unmet[def.id] < UNMET_RETRY) continue;
    if (def.behavior === 'core:eat' && !g.planOf(c).anyFood) continue; // nothing to eat; keep working
    if (job.need) {
      // Already satisfying a need: only while still on the way to it (never mid-meal, mid-drink or asleep;
      // a sleeper wakes for hunger in the sleep driver), and only for a need clearly more pressing than the
      // one being satisfied (the same order decide() uses, with a margin so two needs never take turns).
      if (job.need === def.id || job.stage !== 'go') continue;
      const cur = g.reg.get('need', job.need);
      // Critical needs come first, as in decideInner's order: a job for a critical need is never interrupted
      // by a need that is not critical, and a critical need interrupts a job for one that is not.
      if (cur && critical(c, cur) !== critical(c, def)) { if (critical(c, cur)) continue; }
      else if (cur && needOrder(c, def) >= needOrder(c, cur) - NEED_SWITCH_MARGIN) continue;
      return `Interrupted: ${def.name} is more urgent`;
    }
    if (carrying(c, job) && !critical(c, def)) continue; // finish this leg first
    if (!b.urgent(g, c, def)) return `Interrupted: ${def.name} is low and home is far`;
    return critical(c, def) && carrying(c, job) ? `Interrupted: ${def.name} is critical` : `Interrupted: ${def.name} is urgent`;
  }
  return null;
}

export function runJob(g, c) {
  const job = c.job;
  const drv = DRIVERS[job.type];
  if (!drv) { endJob(g, c, 'Unknown job type'); return; }
  let r;
  try { r = drv.tick(g, c, job); }
  catch (e) { r = { fail: `Internal error: ${e.message}` }; if (g.debugThrow) throw e; }
  if (r === 'done') endJob(g, c, null);
  else if (r && r.fail) endJob(g, c, r.fail, null, r.cooldown);
}

/** End the current job: run cleanup, release reservations, drop what is carried, record failures. */
export function endJob(g, c, failReason, interruptWhy, cooldown) {
  if (!c.job) return;
  // Whatever is dropped or returned here still belongs to this colonist's settlement,
  // even when the job is ended from outside the colonist's own turn (tests, loading, UI).
  const prevActor = g.actor;
  g.actor = c.settlementId || g.s.playerSettlement;
  try { endJobInner(g, c, failReason, interruptWhy, cooldown); } finally { g.actor = prevActor; }
}

function endJobInner(g, c, failReason, interruptWhy, cooldown) {
  const job = c.job;
  try { DRIVERS[job.type]?.cleanup?.(g, c, job, failReason); } catch { /* cleanup must not crash the sim */ }
  g.release(job);
  if (c.carry && !(job.type === 'eat' && job.stage === 'eat' && !failReason && !interruptWhy)) dropCarry(g, c);
  c.sleeping = false;
  c.path = null;
  c.lastWork = job.workType || c.lastWork;
  if (job.workType) c.workCount[job.workType] = (c.workCount[job.workType] || 0) + 1;
  c.job = null;
  if (!failReason && !interruptWhy) maybeAccident(g, c, job);
  if (failReason) {
    g.s.stats.jobFailures++;
    c.status.blocker = failReason;
    c.status.blockerTick = g.s.tick;
    // Context for explanations: what the failed job was about.
    c.status.blockerCtx = { type: job.type, targetKey: job.targetKey || null, sid: job.sid || job.dest?.sid || null, stationId: job.stationId || null, recipe: job.recipe || null, item: job.item || null, goal: job.goal || null };
    if (job.targetKey) g.blockTarget(job.targetKey, failReason, cooldown);
    g.log(`${c.name} stopped "${job.label}": ${failReason}.`, 'warn', `fail:${c.id}:${job.targetKey || job.type}`, 1200);
  } else if (interruptWhy) {
    c.status.blocker = interruptWhy;
    c.status.blockerTick = g.s.tick;
  }
}

function startJob(g, c, job) {
  c.job = job;
  job.started = g.s.tick;
  job.settlement = c.settlementId || g.s.playerSettlement;
  c.status.goal = job.why || job.label;
  c.status.action = job.label;
  c.status.target = describeTarget(g, job);
  if (job.type !== 'wander') c.status.idleReason = null; // wandering IS being idle; keep the reason
  c.idle = 0;
}

export function describeTarget(g, job) {
  const at = (x, y) => ` at (${x},${y})`;
  switch (job.type) {
    case 'gather': { const n = g.s.nodes[job.nodeId]; return n ? `${g.nodeDef(n).name}${at(n.x, n.y)}` : ''; }
    case 'construct': { const st = g.s.structures[job.sid]; return st ? `${g.bDef(st).name}${at(st.x, st.y)}` : ''; }
    case 'haul': {
      const item = g.reg.get('item', job.item)?.name;
      if (job.dest.kind === 'site') { const st = g.s.structures[job.dest.sid]; return `${job.qty} ${item} → ${st ? g.bDef(st).name + at(st.x, st.y) : 'site'}`; }
      return `${job.qty} ${item} → stockpile${at(job.dest.x, job.dest.y)}`;
    }
    case 'craft': { const st = g.s.structures[job.stationId]; return st ? `${g.bDef(st).name}${at(st.x, st.y)}` : ''; }
    case 'sow': return `${job.tiles.length} tiles of ${g.reg.get('crop', job.crop)?.name}`;
    case 'harvest': return `${job.cropIds.length} plants`;
    case 'eat': { const st = g.s.stacks[job.stackId]; return st ? `${g.reg.get('item', st.item)?.name}${at(st.x, st.y)}` : ''; }
    case 'sleep': return job.bedId ? `Bed${at(job.x, job.y)}` : `Ground${at(job.x, job.y)}`;
    case 'equip': { const st = g.s.stacks[job.stackId]; return st ? `${g.reg.get('item', st.item)?.name}${at(st.x, st.y)}` : ''; }
    case 'wander': return `(${job.x},${job.y})`;
    default: return '';
  }
}

export function decide(g, c) {
  const tried = new Set();
  decideInner(g, c, tried);
  // Urgent needs that got no job (no reachable food or water, or a need that is urgent without being
  // wanted, possible in mods): the job taken instead remembers them, so it is not interrupted for them again
  // at every step (interruptReason, UNMET_RETRY). Needs merely outranked by the need being seen to now are
  // not recorded: they may still interrupt it on the way (NEED_SWITCH_MARGIN).
  if (!c.job) return;
  for (const def of g.reg.all('need')) {
    const b = NEED_BEHAVIORS[def.behavior];
    if (def.id === c.job.need || !b || !pressing(g, c, def, b)) continue;
    if (c.job.need && !tried.has(def.id) && b.wants(g, c, def)) continue; // outranked, not unmet
    (c.job.unmet ||= {})[def.id] = g.s.tick;
  }
}

// Before going to sleep (when not yet exhausted): a need with `beforeSleepBelow` that is below it but not yet
// wanted is topped up first (e.g. a drink before bed), so it does not run out during the night. Needs already
// wanted are in decide()'s list anyway. The job says why ("... before bed").
function beforeSleepJob(g, c, wanted, sleepDef) {
  const far = sleepDef.maxBedDistance; // a top-up farther away (straight line) than a bed may be is skipped
  for (const def of g.reg.all('need')) {
    if (def.beforeSleepBelow === undefined || (c.needs[def.id] ?? 1) >= def.beforeSleepBelow) continue;
    if (wanted.some((n) => n.def === def)) continue;
    const job = NEED_BEHAVIORS[def.behavior]?.makeJob(g, c, def, true);
    if (!job) continue;
    const at = job.x !== undefined ? job : g.s.stacks[job.stackId]; // drink spot, or the food stack
    if (far !== undefined && at && octile(c.x, c.y, at.x, at.y) > far) { g.release(job); continue; }
    job.label = `${job.label} before bed`;
    job.why = `Topping up ${def.name} before bed`;
    return job;
  }
  return null;
}

function decideInner(g, c, tried) {
  // 1. Needs
  const needs = g.reg.all('need')
    .map((def) => ({ def, b: NEED_BEHAVIORS[def.behavior] }))
    .filter((n) => n.b?.wants(g, c, n.def))
    // Critical needs first (e.g. an exhausted colonist sleeps before a drink it merely wants), then by needOrder.
    .sort((a, b) => (critical(c, b.def) - critical(c, a.def)) || ((c.needs[a.def.id] - a.def.seekBelow) - (c.needs[b.def.id] - b.def.seekBelow)));
  for (const n of needs) {
    // Top up first only while still well rested enough for it (at least twice urgentBelow).
    if (n.def.behavior === 'core:sleep' && (c.needs[n.def.id] ?? 1) >= 2 * n.def.urgentBelow) {
      const top = beforeSleepJob(g, c, needs, n.def);
      if (top) { startJob(g, c, top); return; }
    }
    const job = n.b.makeJob(g, c, n.def);
    if (job) { startJob(g, c, job); return; }
    tried.add(n.def.id);
  }
  // 1b. Injured: rest in a bed until health is good again (only with a bed to rest in).
  if (hpOf(c) < HEALTH.restBelow) {
    const energy = g.reg.all('need').find((n) => n.behavior === 'core:sleep');
    const job = energy && NEED_BEHAVIORS[energy.behavior].makeJob(g, c, energy);
    if (job?.bedId) {
      job.recover = true; job.label = 'Rest to recover'; job.why = `Injured (health ${hpOf(c)}%): resting in bed`;
      startJob(g, c, job);
      return;
    }
    if (job) g.release(job);
  }
  // 2. Step off building sites so walls can go up.
  const foot = g.footAt(c.x, c.y);
  if (foot && foot.status === 'active') {
    const st = g.structAt(c.x, c.y);
    if (st && !st.built && !g.bDef(st).passable) { if (wanderOff(g, c, 'Stepping off a building site')) return; }
  }
  // 3. Equipment the planner wants us to carry
  const eq = equipCandidate(g, c);
  if (eq) { startJob(g, c, eq); return; }
  // 4. Work
  const work = tryWork(g, c);
  if (work === true) return;
  // 5. Nothing to do
  c.status.goal = 'No useful work right now';
  const off = g.reg.all('workType').filter((w) => c.workOff?.[w.id]).map((w) => w.name);
  c.status.idleReason = work?.tooFar && !c.lastScan?.found
    ? `${work.tooFar} open task(s) are too far from home for now (${work.why})`
    : c.lastScan?.found
      ? `All ${c.lastScan.found} open task(s) are already taken by others or could not be reserved${work?.tooFar ? ` (${work.tooFar} more too far from home for now)` : ''}`
      : `The colony has no open task this colonist can reach${off.length ? ` (forbidden work: ${off.join(', ')})` : ''}`;
  // Big worlds: nothing to do out here, far from home (trips.js), so walk back rather than idle about.
  if (farFromHome(g, c) && headHome(g, c)) return;
  if (!wanderOff(g, c, 'Idle')) c.status.action = 'Idle';
  c.idle = 40;
}

/** Walk back to the village centre (or the first reachable stockpile tile), as an idle walk. */
function headHome(g, c) {
  const st = g.s.settlements?.[c.settlementId || g.s.playerSettlement];
  if (!st?.center) return false;
  const spots = [st.center, ...(st.stockpile || []).slice(0, 8).map((k) => { const [x, y] = k.split(',').map(Number); return { x, y }; })];
  for (const p of spots) {
    if (!g.inB(p.x, p.y) || !g.isPassable(p.x, p.y) || !g.canReach(c, p.x, p.y, 'on')) continue;
    const why = 'Nothing to do out here: heading home';
    startJob(g, c, newJob('wander', { x: p.x, y: p.y, stage: 'go', wait: 30, reason: why }, { why, label: 'Head home' }));
    return true;
  }
  return false;
}

function tryWork(g, c) {
  const prof = g.prof;
  const cands = [];
  let tooFar = 0, tooFarWhy = '', topUp = null;
  const trips = tripChecker(g, c); // big worlds: this colonist's trip budget (trips.js); null on classic worlds
  // The search is read-only (make() reserves later): trade holds are worked out once for it (game.js readOnly).
  g.readOnly(() => {
    for (const wt of g.reg.all('workType')) {
      if (c.workOff?.[wt.id] || !mayDoWork(g, c, wt.id)) continue; // children: only work their stage allows
      const weight = (prof.workWeights?.[wt.id] ?? 1) * wt.priority;
      if (weight <= 0) continue;
      const lv = skillLevel(c, wt.skill);
      const skillF = 1 + (lv - 4) * (prof.skillWeight ?? 0.06);
      let toolF = 1;
      if (c.equip.tool && g.reg.get('item', c.equip.tool.item)?.equipment?.workBoost?.[wt.id]) toolF = 1.25;
      const same = c.lastWork === wt.id ? 1 + (prof.sameWorkBonus ?? 0.15) : 1;
      for (const gv of wt.givers) {
        const giver = GIVERS[gv.giver];
        if (!giver) continue;
        for (const cand of giver.find(g, c, gv.params || {}, wt)) {
          let d = cand.dist ?? octile(c.x, c.y, cand.x, cand.y);
          // Big worlds: a trip whose far end is well away from home must fit the colonist's food and water
          // (trips.js); out there the walk, not the straight line, is what counts.
          const trip = cand.far && trips ? trips.cand(cand.far) : null;
          if (trip) {
            if (trip.why) {
              tooFar++; tooFarWhy ||= `${cand.label}: ${trip.why}`;
              const sc = weight * (1 + cand.urgency) * skillF * toolF * same / (1 + trip.d * (prof.distanceWeight ?? 0.05));
              if (trip.topUp && (!topUp || sc > topUp.score)) topUp = { score: sc, needs: trip.topUp, label: cand.label };
              continue;
            }
            if (cand.dist === undefined && cand.far.x === cand.x && cand.far.y === cand.y) d = trip.d;
          }
          const score = weight * (1 + cand.urgency) * skillF * toolF * same / (1 + d * (prof.distanceWeight ?? 0.05));
          cands.push({ score, cand });
        }
      }
    }
  });
  cands.sort((a, b) => b.score - a.score);
  c.lastScan = { found: cands.length, tick: g.s.tick };
  for (let k = 0; k < Math.min(cands.length, 10); k++) {
    const job = cands[k].cand.make();
    if (job) { startJob(g, c, job); return true; }
  }
  if (topUp && startTopUp(g, c, topUp)) return true;
  return tooFar ? { tooFar, why: tooFarWhy } : false;
}

// Big worlds (trips.js): with nothing to do near home but a task too far for the food or water the colonist
// has now, it eats or drinks first (if there is food or water to be had), so the trip fits afterwards.
function startTopUp(g, c, t) {
  for (const def of t.needs) {
    const job = NEED_BEHAVIORS[def.behavior]?.makeJob(g, c, def, true);
    if (!job) continue;
    // No food wasted: eat only if the whole meal fits (the need is below 1 minus its nutrition).
    const food = job.stackId && g.s.stacks[job.stackId];
    const nu = food ? g.reg.get('item', food.item)?.nutrition || 0 : 0;
    if (nu && (c.needs[def.id] ?? 1) > 1 - nu) { g.release(job); continue; }
    job.label = `${job.label} before a long walk`;
    job.why = `Topping up ${def.name} before a long walk (${t.label})`;
    startJob(g, c, job);
    return true;
  }
  return false;
}

function wanderOff(g, c, reason) {
  for (let tries = 0; tries < 12; tries++) {
    const x = c.x + g.rng.int(9) - 4, y = c.y + g.rng.int(9) - 4;
    if (!g.inB(x, y) || !g.isPassable(x, y) || g.footAt(x, y) || g.fieldAt(x, y)) continue;
    if (!g.canReach(c, x, y, 'on')) continue;
    startJob(g, c, newJob('wander', { x, y, stage: 'go', wait: 30 + g.rng.int(40), reason }, { why: reason, label: reason }));
    return true;
  }
  return false;
}
