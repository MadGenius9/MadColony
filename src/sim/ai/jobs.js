// Job drivers: each job is plain serializable data advanced one tick at a time by its driver.
// Drivers return 'running', 'done', or { fail: reason, cooldown? }.
import { qualSpeed } from '../education.js';
import { relationPeek } from '../villages.js';
import { sleepWarmth, refuelSpot } from '../heat.js';
import { fuelSpec } from '../power.js';
import { drawWater } from '../water.js';
import { lightFactor } from '../light.js';
import { MOVE_TICKS } from '../constants.js';
import { findPath, atGoal } from '../path.js';
import { completeStructure, completeRenovation, materialsComplete, interactionSpot, workOrderOf } from '../construction.js';
import { completeTech, settlementOf } from '../research.js';
import { deliverLeg } from '../villages.js';
import { powerAt } from '../power.js';
import { isDown, hpOf, workFactor, HEALTH, injure } from '../health.js';
import { TICKS_PER_HOUR } from '../constants.js';
import { NEED_BEHAVIORS, GROUND_REST_RATE, bedTooFar } from './needs.js';
import { energyLastsWalkHome } from './trips.js';
import { blessingOf } from '../god.js';

const UNTREATED_ILLNESS = 0.03; // chance per drink of untreated water
const POWER_WAIT = 300; // ticks a colonist waits at an unpowered machine before giving up for now

export function newJob(type, data, meta = {}) {
  return { type, ...data, res: [], why: meta.why || '', label: meta.label || type, need: meta.need || null, targetKey: meta.targetKey || null, workType: meta.workType || null, goal: meta.goal || null };
}

// ---- shared helpers ----
export function skillLevel(c, skill) { return skill ? (c.skills[skill] || 0) : 4; }

export function workSpeed(g, c, workType, skill) {
  let sp = 0.55 + 0.09 * skillLevel(c, skill);
  const tool = c.equip.tool;
  if (tool && workType) {
    const b = g.reg.get('item', tool.item)?.equipment?.workBoost?.[workType];
    if (b) sp *= b;
  }
  if ((c.needs['core:hunger'] ?? 1) <= 0) sp *= 0.5;
  sp *= workFactor(c); // injured colonists work more slowly
  if ((c.needs['core:energy'] ?? 1) <= 0.03) sp *= 0.5;
  sp *= lightFactor(g, c.x, c.y); // working in the dark is slower
  if (workType) sp *= qualSpeed(g, c, workType); // a qualification for this work makes it faster (never required)
  if (g.s.god) { const b = blessingOf(g, c.settlementId || g.s.playerSettlement); if (b) sp *= b.work; } // a divine blessing (godboons.js); skipped at once without s.god
  return sp;
}

export function practice(g, c, workType, skill) {
  if (skill) {
    c.xp[skill] = (c.xp[skill] || 0) + 1;
    const lv = c.skills[skill] || 0;
    if (lv < 10 && c.xp[skill] >= 600 + lv * 300) {
      c.xp[skill] = 0; c.skills[skill] = lv + 1;
      g.log(`${c.name} improved ${g.reg.get('skill', skill)?.name} to ${lv + 1}.`, 'good');
    }
  }
  const tool = c.equip.tool;
  if (tool && workType && g.reg.get('item', tool.item)?.equipment?.workBoost?.[workType]) {
    tool.dur = (tool.dur ?? 1) - 1;
    if (tool.dur <= 0) {
      const name = g.reg.get('item', tool.item)?.name || tool.item;
      g.consume(tool.item, 1, 'wear');
      c.equip.tool = null;
      g.log(`${c.name}'s ${name} wore out.`, 'warn');
    }
  }
}

/** Move toward a target. Returns true on arrival, false while walking, or {fail}. */
export function travel(g, c, job, tx, ty, mode, what) {
  if (c.mv) {
    c.mv.t++;
    if (c.mv.t < c.mv.dur) return false;
    c.mv = null;
  }
  if (atGoal(c.x, c.y, tx, ty, mode, g)) { c.path = null; return true; }
  const goalKey = `${tx},${ty},${mode}`;
  if (!c.path || !c.path.length || c.pathGoal !== goalKey) {
    // Big worlds: a reachable goal behind a ridge can need far more than the classic 30000-node search
    // (seed 11 Colossal: ~60000 from a scouting trip home), which used to read as "No path" for good. The
    // region check first (O(1)) means the larger search is only spent on goals that can be reached; goals
    // stood next to ('adj'/'near') get a smaller cap, since every neighbour may be an unstandable site.
    let cap = 30000;
    if (g.big) {
      const reach = mode === 'near' ? g.reachableFrom(c.x, c.y, tx, ty, 'on') || g.reachableFrom(c.x, c.y, tx, ty, 'adj') : g.reachableFrom(c.x, c.y, tx, ty, mode);
      if (!reach) return { fail: `No path to ${what || 'target'} at (${tx},${ty})`, cooldown: 900 };
      cap = mode === 'on' ? Math.max(30000, (g.W * g.H) >> 1) : 60000;
    }
    const p = findPath(g, c.x, c.y, tx, ty, mode, cap);
    if (!p) return { fail: `No path to ${what || 'target'} at (${tx},${ty})`, cooldown: 900 };
    c.path = p; c.pathGoal = goalKey;
    if (p.length === 0) return true;
  }
  const n = c.path[0];
  if (!g.isPassable(n.x, n.y) || (n.x !== c.x && n.y !== c.y && (!g.isPassable(n.x, c.y) || !g.isPassable(c.x, n.y)))) {
    // Something was built in the way: replan from here.
    c.path = null;
    job.replans = (job.replans || 0) + 1;
    g.s.stats.replans++;
    if (job.replans > 6) return { fail: `Route to ${what || 'target'} keeps getting blocked`, cooldown: 600 };
    return false;
  }
  c.path.shift();
  const diag = n.x !== c.x && n.y !== c.y;
  c.mv = { fx: c.x, fy: c.y, t: 0, dur: Math.max(1, Math.round(MOVE_TICKS * (diag ? 1.41 : 1) * g.moveCost(n.x, n.y))) };
  c.x = n.x; c.y = n.y;
  return false;
}

/** Shorthand used by drivers: travel and translate the result. */
function go(g, c, job, x, y, mode, what) {
  const r = travel(g, c, job, x, y, mode, what);
  if (r === true) return 'arrived';
  if (r === false) { c.status.action = `Walking to ${what}`; return 'moving'; }
  return r; // {fail}
}

function dropCarry(g, c) {
  if (!c.carry) return;
  g.placeItems(c.carry.item, c.carry.qty, c.x, c.y, c.carry.dur);
  c.carry = null;
}
export { dropCarry };

const pct = (a, b) => `${Math.min(100, Math.floor((100 * a) / b))}%`;

/** On the way to a bed: once the bed is too far to reach before exhaustion (needs.js bedTooFar: more than the
 *  need's `maxBedDistance` tiles away and the energy will not last the walk), lie down here instead (sleeping
 *  rough). The bed stays the colonist's own (c.bedId); only this night's reservation is let go. Waits for the current step to end and
 *  for a tile that is not a building site or stockpile. */
function roughIfBedTooFar(g, c, j) {
  const energy = g.reg.get('need', j.need);
  if (!energy || !bedTooFar(c, energy, j.x, j.y)) return;
  if ((c.mv && c.mv.t + 1 < c.mv.dur) || g.footAt(c.x, c.y) || g.isStockpile(c.x, c.y)) return;
  g.release(j, (r) => r.key === 'bed:' + j.bedId);
  j.bedId = null; j.x = c.x; j.y = c.y; j.rate = GROUND_REST_RATE; j.rough = true;
  j.label = 'Sleep rough (bed too far)'; j.why = `Need: ${energy.name} (bed too far to reach)`;
  c.status.goal = j.why; c.path = null;
}

// ---- drivers ----
export const DRIVERS = {
  // Haul a stack to the stockpile or to a construction site.
  haul: {
    valid(g, c, j) { return j.stage === 'dst' ? !!c.carry : !!g.s.stacks[j.stackId]; },
    tick(g, c, j) {
      const itemName = g.reg.get('item', j.item)?.name || j.item;
      if (j.stage === 'src') {
        const st = g.s.stacks[j.stackId];
        if (!st) return { fail: `${itemName} is no longer there` };
        const r = go(g, c, j, st.x, st.y, 'on', itemName);
        if (r !== 'arrived') return r === 'moving' ? 'running' : r;
        g.release(j, (x) => x.k === 'q' && x.key === j.stackId);
        const got = g.takeFromStack(j.stackId, j.qty);
        if (!got || got.qty <= 0) return { fail: `${itemName} is no longer there` };
        c.carry = got;
        j.stage = 'dst';
        return 'running';
      }
      if (!c.carry) return 'done';
      if (j.dest.kind === 'stock') {
        const r = go(g, c, j, j.dest.x, j.dest.y, 'on', 'the stockpile');
        if (r !== 'arrived') return r === 'moving' ? 'running' : r;
        c.status.action = `Storing ${itemName}`;
        const st = g.stackAt(c.x, c.y);
        if (g.stockpileOwnerAt(c.x, c.y) === (c.settlementId || g.s.playerSettlement) && (!st || g.stackRoom(st, c.carry.item, c.carry.dur) > 0)) {
          if (st) {
            const put = Math.min(g.stackRoom(st, c.carry.item, c.carry.dur), c.carry.qty);
            st.qty += put; c.carry.qty -= put;
            if (c.carry.qty <= 0) c.carry = null;
          } else {
            g.addStack(c.carry.item, Math.min(c.carry.qty, g.reg.get('item', c.carry.item).stackLimit), c.x, c.y, c.carry.dur);
            c.carry.qty -= Math.min(c.carry.qty, g.reg.get('item', c.carry.item).stackLimit);
            if (c.carry.qty <= 0) c.carry = null;
          }
        }
        dropCarry(g, c);
        return 'done';
      }
      // construction or renovation site
      const site = g.s.structures[j.dest.sid];
      const wo = site && workOrderOf(g, site);
      if (!wo?.def) { dropCarry(g, c); return 'done'; }
      const r = go(g, c, j, site.x, site.y, 'adj', g.bDef(site)?.name || 'site');
      if (r !== 'arrived') return r === 'moving' ? 'running' : r;
      const cost = wo.def.cost.find((x) => x.item === c.carry.item);
      const need = cost ? cost.qty - (wo.delivered[c.carry.item] || 0) : 0;
      const put = Math.max(0, Math.min(need, c.carry.qty));
      if (put > 0) { wo.delivered[c.carry.item] = (wo.delivered[c.carry.item] || 0) + put; c.carry.qty -= put; }
      if (c.carry.qty <= 0) c.carry = null;
      dropCarry(g, c);
      return 'done';
    },
  },

  // Work a resource node (chop, mine, forage, clear).
  gather: {
    valid(g, c, j) { return !!g.s.nodes[j.nodeId]; },
    tick(g, c, j) {
      const node = g.s.nodes[j.nodeId];
      if (!node || (node.empty && !j.clear)) return j.done > 0 ? 'done' : { fail: 'The target is gone' };
      const def = g.nodeDef(node);
      const r = go(g, c, j, node.x, node.y, def.passable ? 'near' : 'adj', def.name);
      if (r !== 'arrived') return r === 'moving' ? 'running' : r;
      j.prog = (j.prog || 0) + workSpeed(g, c, def.workType, g.reg.get('workType', def.workType)?.skill);
      practice(g, c, def.workType, g.reg.get('workType', def.workType)?.skill);
      c.status.action = `${g.reg.get('workType', def.workType)?.name || 'Working'}: ${def.name} (${pct(j.prog, def.work)})`;
      if (j.prog < def.work) return 'running';
      j.prog = 0;
      if (node.empty) { g.removeNode(node.id); return 'done'; } // clearing an already-picked plant
      for (const y of def.yields) g.createItems(y.item, y.qty, node.x, node.y, 'gather');
      node.chunks--;
      j.done = (j.done || 0) + 1;
      if (node.chunks <= 0) {
        if (def.regrowDays && !j.clear) g.nodeEmptied(node);
        else g.removeNode(node.id);
        return 'done';
      }
      return j.done >= j.maxChunks ? 'done' : 'running';
    },
  },

  // Build a blueprint.
  construct: {
    valid(g, c, j) { const st = g.s.structures[j.sid]; return !!st && (!st.built || !!st.reno); },
    tick(g, c, j) {
      const st = g.s.structures[j.sid];
      if (!st || (st.built && !st.reno)) return 'done';
      if (st.built && st.reno) {
        // Renovation: the old part keeps standing (and sheltering) until the new one is finished.
        const to = g.reg.get('building', st.reno.to);
        const r = go(g, c, j, st.x, st.y, 'adj', g.bDef(st).name);
        if (r !== 'arrived') return r === 'moving' ? 'running' : r;
        if (!materialsComplete(g, st)) return { fail: 'Materials not delivered yet', cooldown: 120 };
        st.reno.progress = (st.reno.progress || 0) + workSpeed(g, c, 'core:construct', to.skill);
        practice(g, c, 'core:construct', to.skill);
        c.status.action = `Renovating into ${to.name} (${pct(st.reno.progress, to.work)})`;
        if (st.reno.progress < to.work) return 'running';
        completeRenovation(g, st, c);
        return 'done';
      }
      const def = g.bDef(st);
      const r = go(g, c, j, st.x, st.y, 'adj', def.name);
      if (r !== 'arrived') return r === 'moving' ? 'running' : r;
      if (!materialsComplete(g, st)) return { fail: 'Materials not delivered yet', cooldown: 120 };
      if (g.nodeAt(st.x, st.y) || g.stackAt(st.x, st.y)) return { fail: 'Site is blocked by items or plants', cooldown: 200 };
      if (!def.passable && g.colonistAt(st.x, st.y, c.id)) {
        j.wait = (j.wait || 0) + 1;
        c.status.action = `Waiting for someone to step off the ${def.name} site`;
        return j.wait > 120 ? { fail: 'Someone is standing on the site', cooldown: 150 } : 'running';
      }
      j.prog = (st.progress || 0) + workSpeed(g, c, 'core:construct', def.skill);
      practice(g, c, 'core:construct', def.skill);
      if (j.prog >= def.work) {
        // Big worlds: the builder's settlement (wouldTrapFor: only people and sites that can reach their centre
        // now count), so one villager stranded in a sealed pocket far away does not stop every completion.
        if (!def.passable && g.wouldTrap(st.x, st.y, g.big ? (st.settlement || g.s.playerSettlement) : null)) {
          return { fail: `Finishing this ${def.name} now would seal off an area`, cooldown: 300 };
        }
        st.progress = def.work;
        completeStructure(g, st, c);
        return 'done';
      }
      st.progress = j.prog;
      c.status.action = `Building ${def.name} (${pct(st.progress, def.work)})`;
      return 'running';
    },
  },

  // Fetch ingredients to a station, then work the recipe.
  craft: {
    valid(g, c, j) { return !!g.s.structures[j.stationId]?.built && !!g.reg.get('recipe', j.recipe); },
    tick(g, c, j) {
      const station = g.s.structures[j.stationId];
      const rec = g.reg.get('recipe', j.recipe);
      if (!station || !station.built || !rec) return { fail: 'The work station is gone' };
      const spot = interactionSpot(g, station);
      if (j.stage === 'fetch') {
        if (j.idx >= j.inputs.length) { j.stage = 'work'; return 'running'; }
        const inp = j.inputs[j.idx];
        const itemName = g.reg.get('item', inp.item)?.name || inp.item;
        if (!c.carry) {
          const st = g.s.stacks[inp.stackId];
          if (!st) return { fail: `Ingredient ${itemName} disappeared` };
          const r = go(g, c, j, st.x, st.y, 'on', itemName);
          if (r !== 'arrived') return r === 'moving' ? 'running' : r;
          g.release(j, (x) => x.k === 'q' && x.key === inp.stackId && x.qty === inp.qty, true); // just this trip's share
          const got = g.takeFromStack(inp.stackId, inp.qty);
          if (!got || got.qty < inp.qty) { if (got) { c.carry = got; } return { fail: `Not enough ${itemName} left` }; }
          c.carry = got;
          return 'running';
        }
        const r = go(g, c, j, spot.x, spot.y, 'on', g.bDef(station).name);
        if (r !== 'arrived') return r === 'moving' ? 'running' : r;
        station.buffer = station.buffer || [];
        station.buffer.push({ ...c.carry, job: c.id });
        c.carry = null;
        j.idx++;
        return 'running';
      }
      const r = go(g, c, j, spot.x, spot.y, 'on', g.bDef(station).name);
      if (r !== 'arrived') return r === 'moving' ? 'running' : r;
      // Resume progress kept on the machine by whoever was interrupted before (e.g. by a power cut).
      if (j.prog === undefined && station.saved?.recipe === rec.id) { j.prog = station.saved.prog; delete station.saved; }
      const pw = powerAt(g, station);
      if (pw.ratio <= 0) {
        j.waited = (j.waited || 0) + 1;
        c.status.action = `${rec.name} (${pct(j.prog || 0, rec.work)}): waiting for power`;
        c.status.blocker = `No power: ${pw.reason}`;
        c.status.blockerTick = g.s.tick;
        if (j.waited < POWER_WAIT) return 'running';
        return { fail: `No power: ${pw.reason}`, cooldown: 600 };
      }
      j.waited = 0;
      j.prog = (j.prog || 0) + workSpeed(g, c, rec.workType, rec.skill) * pw.ratio;
      practice(g, c, rec.workType, rec.skill);
      c.status.action = `${rec.name} (${pct(j.prog, rec.work)})${pw.ratio < 1 ? ` at ${Math.round(pw.ratio * 100)}% power` : ''}`;
      if (j.prog < rec.work) return 'running';
      const mine = (station.buffer || []).filter((b) => b.job === c.id);
      for (const b of mine) g.consume(b.item, b.qty, 'craft');
      station.buffer = (station.buffer || []).filter((b) => b.job !== c.id);
      for (const o of rec.outputs) {
        const eq = g.reg.get('item', o.item)?.equipment;
        if (eq) for (let k = 0; k < o.qty; k++) g.createItems(o.item, 1, spot.x, spot.y, 'craft', eq.durability);
        else g.createItems(o.item, o.qty, spot.x, spot.y, 'craft');
      }
      const outName = rec.outputs.map((o) => `${o.qty} ${g.reg.get('item', o.item)?.name}`).join(', ');
      g.log(`${c.name} finished "${rec.name}" (${outName}).`, rec.workType === 'core:cook' ? 'food' : 'craft');
      return 'done';
    },
    cleanup(g, c, j) {
      const station = g.s.structures[j.stationId];
      // Unfinished work is kept on the station for whoever comes back to this recipe.
      const rec = g.reg.get('recipe', j.recipe);
      if (station && rec && j.stage === 'work' && j.prog > 0 && j.prog < rec.work) station.saved = { recipe: rec.id, prog: Math.floor(j.prog) };
      if (!station?.buffer) return;
      const mine = station.buffer.filter((b) => b.job === c.id);
      station.buffer = station.buffer.filter((b) => b.job !== c.id);
      const spot = interactionSpot(g, station);
      for (const b of mine) g.placeItems(b.item, b.qty, spot.x, spot.y, b.dur);
    },
  },

  // Research at a station: bring the material cost once, then work in sessions. Progress is kept on the
  // settlement, so interruptions never lose it; materials are consumed exactly once (when paid).
  research: {
    valid(g, c, j) { return !!g.s.structures[j.stationId]?.built && !!g.reg.get('tech', j.tech); },
    tick(g, c, j) {
      const station = g.s.structures[j.stationId];
      const tech = g.reg.get('tech', j.tech);
      const st0 = settlementOf(g, c.settlementId || g.s.playerSettlement);
      if (!station?.built || !tech || !st0) return { fail: 'The research station is gone' };
      const R = st0.research;
      if (R.done.includes(tech.id)) return 'done';
      // The player's research policy wins at once: a field switched Off stops advancing (progress is kept).
      if ((R.priorities?.[tech.field] ?? 2) <= 0) return { fail: `${g.reg.get('techField', tech.field)?.name || tech.field} research is switched off`, cooldown: 300 };
      if (R.current && R.current !== tech.id) return 'done'; // the settlement moved on to another project
      const spot = interactionSpot(g, station);
      if (j.stage === 'fetch') {
        if (j.idx >= j.inputs.length) {
          // All materials are at the desk: they are used up now, once.
          if (!R.paid[tech.id]) {
            const mine = (station.buffer || []).filter((b) => b.job === c.id);
            for (const b of mine) g.consume(b.item, b.qty, 'research');
            station.buffer = (station.buffer || []).filter((b) => b.job !== c.id);
            R.paid[tech.id] = true;
          }
          j.stage = 'work';
          return 'running';
        }
        const inp = j.inputs[j.idx];
        const itemName = g.reg.get('item', inp.item)?.name || inp.item;
        if (!c.carry) {
          const st = g.s.stacks[inp.stackId];
          if (!st) return { fail: `Ingredient ${itemName} disappeared` };
          const r = go(g, c, j, st.x, st.y, 'on', itemName);
          if (r !== 'arrived') return r === 'moving' ? 'running' : r;
          g.release(j, (x) => x.k === 'q' && x.key === inp.stackId && x.qty === inp.qty, true);
          const got = g.takeFromStack(inp.stackId, inp.qty);
          if (!got || got.qty < inp.qty) { if (got) c.carry = got; return { fail: `Not enough ${itemName} left` }; }
          c.carry = got;
          return 'running';
        }
        const r = go(g, c, j, spot.x, spot.y, 'on', g.bDef(station).name);
        if (r !== 'arrived') return r === 'moving' ? 'running' : r;
        station.buffer = station.buffer || [];
        station.buffer.push({ ...c.carry, job: c.id });
        c.carry = null;
        j.idx++;
        return 'running';
      }
      const r = go(g, c, j, spot.x, spot.y, 'on', g.bDef(station).name);
      if (r !== 'arrived') return r === 'moving' ? 'running' : r;
      if (!R.paid[tech.id] && (tech.cost || []).length) return { fail: 'Research materials were not delivered', cooldown: 200 };
      const speed = workSpeed(g, c, 'core:research', 'core:research') * (g.bDef(station).research?.speed || 1);
      R.progress[tech.id] = (R.progress[tech.id] || 0) + speed;
      practice(g, c, 'core:research', 'core:research');
      j.session = (j.session || 0) + 1;
      c.status.action = `Researching ${tech.name} (${pct(R.progress[tech.id], tech.research)})`;
      if (R.progress[tech.id] >= tech.research) { completeTech(g, c.settlementId || g.s.playerSettlement, tech.id); return 'done'; }
      return j.session >= 400 ? 'done' : 'running'; // a work session; needs are re-checked between sessions
    },
    cleanup(g, c, j) {
      const station = g.s.structures[j.stationId];
      if (!station?.buffer) return;
      const mine = station.buffer.filter((b) => b.job === c.id);
      station.buffer = station.buffer.filter((b) => b.job !== c.id);
      const spot = interactionSpot(g, station);
      for (const b of mine) g.placeItems(b.item, b.qty, spot.x, spot.y, b.dur);
    },
  },

  // Carry traded goods to the other settlement. Until delivery they stay ours (if dropped they are still
  // ours); on delivery they are placed on the other stockpile and become theirs. Nothing is created or destroyed.
  // Bring repair materials to a worn building (into its buffer), then work; materials are consumed and the
  // building's condition returns to 100%. Interrupted? The materials go back on the ground (cleanup).
  maintain: {
    valid(g, c, j) { return !!g.s.structures[j.stationId]?.built; },
    tick(g, c, j) {
      const st = g.s.structures[j.stationId];
      if (!st?.built) return { fail: 'The building is gone' };
      const def = g.bDef(st), m = def.maintenance;
      const spot = interactionSpot(g, st);
      if (j.stage === 'fetch') {
        if (j.idx >= j.inputs.length) { j.stage = 'work'; return 'running'; }
        const inp = j.inputs[j.idx];
        const itemName = g.reg.get('item', inp.item)?.name || inp.item;
        if (!c.carry) {
          const stk = g.s.stacks[inp.stackId];
          if (!stk) return { fail: `${itemName} disappeared` };
          const r = go(g, c, j, stk.x, stk.y, 'on', itemName);
          if (r !== 'arrived') return r === 'moving' ? 'running' : r;
          g.release(j, (x) => x.k === 'q' && x.key === inp.stackId && x.qty === inp.qty, true);
          const got = g.takeFromStack(inp.stackId, inp.qty);
          if (!got || got.qty < inp.qty) { if (got) c.carry = got; return { fail: `Not enough ${itemName} left` }; }
          c.carry = got;
          return 'running';
        }
        const r = go(g, c, j, spot.x, spot.y, 'on', def.name);
        if (r !== 'arrived') return r === 'moving' ? 'running' : r;
        st.buffer = st.buffer || [];
        st.buffer.push({ ...c.carry, job: c.id });
        c.carry = null;
        j.idx++;
        return 'running';
      }
      const r = go(g, c, j, spot.x, spot.y, 'on', def.name);
      if (r !== 'arrived') return r === 'moving' ? 'running' : r;
      j.prog = (j.prog || 0) + workSpeed(g, c, 'core:construct', def.skill);
      practice(g, c, 'core:construct', def.skill);
      c.status.action = `Servicing the ${def.name} (${pct(j.prog, m.work)})`;
      if (j.prog < m.work) return 'running';
      for (const b of (st.buffer || []).filter((x) => x.job === c.id)) g.consume(b.item, b.qty, 'maintenance');
      st.buffer = (st.buffer || []).filter((x) => x.job !== c.id);
      const wasBroken = (st.condition ?? 100) <= 0;
      st.condition = 100;
      g._power = null;
      g.log(`${c.name} ${wasBroken ? 'repaired' : 'serviced'} the ${def.name}.`, 'build');
      return 'done';
    },
    cleanup(g, c, j) {
      const st = g.s.structures[j.stationId];
      if (!st?.buffer) return;
      const mine = st.buffer.filter((b) => b.job === c.id);
      st.buffer = st.buffer.filter((b) => b.job !== c.id);
      const spot = interactionSpot(g, st);
      for (const b of mine) g.placeItems(b.item, b.qty, spot.x, spot.y, b.dur);
    },
  },
  // Drink at a well or a lake shore. Untreated lake water sometimes upsets the stomach.
  drink: {
    tick(g, c, j) {
      if (j.stage === 'go') {
        const r = go(g, c, j, j.x, j.y, 'on', j.tapId ? 'the tap' : j.wellId ? 'the well' : 'the water');
        if (r !== 'arrived') return r === 'moving' ? 'running' : r;
        if (j.tapId) { // running water: quick, but the network must still have some
          const tap = g.s.structures[j.tapId];
          if (!tap || !drawWater(g, tap)) return { fail: 'The tap ran dry' };
        }
        j.stage = 'drink'; j.prog = 0;
      }
      j.prog++;
      c.status.action = j.tapId ? 'Drinking at the tap' : j.wellId ? 'Drinking at the well' : 'Drinking from the lake';
      if (j.prog < (j.tapId ? 10 : 30)) return 'running';
      const thirst = g.reg.all('need').find((n) => n.behavior === 'core:drink');
      if (thirst) c.needs[thirst.id] = 1;
      if (!j.clean && g.rng.next() < UNTREATED_ILLNESS) injure(g, c, 'illness', 6 + g.rng.next() * 10, 'Upset stomach from untreated lake water');
      return 'done';
    },
  },
  // Feed and tend a colonist who has collapsed. Tended wounds heal faster for a while.
  tend: {
    valid(g, c, j) { const p = g.s.colonists[j.patientId]; return !!p && (isDown(p) || !!g.reg.get('lifeStage', p.stage)?.needsCare); },
    tick(g, c, j) {
      const p = g.s.colonists[j.patientId];
      if (!p || !(isDown(p) || g.reg.get('lifeStage', p.stage)?.needsCare)) return 'done';
      if (j.stage === 'water') { // fetch a drink first
        const r = go(g, c, j, j.wx, j.wy, 'on', 'water');
        if (r !== 'arrived') return r === 'moving' ? 'running' : r;
        j.water = true; j.stage = j.stackId ? 'food' : 'go';
        return 'running';
      }
      if (j.stage === 'food') {
        const st = g.s.stacks[j.stackId];
        if (!st) { j.stage = 'go'; return 'running'; }
        const r = go(g, c, j, st.x, st.y, 'on', g.reg.get('item', st.item)?.name);
        if (r !== 'arrived') return r === 'moving' ? 'running' : r;
        g.release(j, (x) => x.k === 'q');
        const got = g.takeFromStack(j.stackId, 1);
        if (got) c.carry = got;
        j.stage = 'go';
        return 'running';
      }
      const r = go(g, c, j, p.x, p.y, 'adj', p.name);
      if (r !== 'arrived') return r === 'moving' ? 'running' : r;
      j.prog = (j.prog || 0) + 1;
      c.status.action = (c.carry ? 'Feeding ' : 'Tending ') + p.name;
      if (j.prog < 60) return 'running';
      if (c.carry) {
        const d = g.reg.get('item', c.carry.item);
        const hunger = g.reg.all('need').find((n) => n.behavior === 'core:eat');
        if (hunger && d?.nutrition) p.needs[hunger.id] = Math.min(1, (p.needs[hunger.id] ?? 0) + d.nutrition);
        g.consume(c.carry.item, 1, 'eat');
        c.carry = null;
      }
      if (j.water) { const thirst = g.reg.all('need').find((n) => n.behavior === 'core:drink'); if (thirst) p.needs[thirst.id] = 1; }
      p.health ||= { injuries: [] };
      p.health.tendedUntil = g.s.tick + HEALTH.tendHours * TICKS_PER_HOUR;
      g.log(c.name + ' tended ' + p.name + '.', 'info', 'tend:' + p.id, 600);
      return 'done';
    },
  },
  // Carry fuel into a generator's store. The fuel stays in existence (counted in the census) until the
  // generator burns it, one unit at a time, while a connected machine is in use.
  refuel: {
    valid(g, c, j) { const st = g.s.structures[j.stationId]; return !!st?.built && (j.stage === 'dst' ? !!c.carry : !!g.s.stacks[j.stackId]); },
    tick(g, c, j) {
      const st = g.s.structures[j.stationId];
      if (!st?.built) return { fail: `The ${g.reg.get('building', st?.def)?.name || 'building'} is gone` };
      const itemName = g.reg.get('item', j.item)?.name || j.item;
      if (j.stage === 'src') {
        const stk = g.s.stacks[j.stackId];
        if (!stk) return { fail: itemName + ' is no longer there' };
        const r = go(g, c, j, stk.x, stk.y, 'on', itemName);
        if (r !== 'arrived') return r === 'moving' ? 'running' : r;
        g.release(j, (x) => x.k === 'q' && x.key === j.stackId);
        const got = g.takeFromStack(j.stackId, j.qty);
        if (!got || got.qty <= 0) return { fail: itemName + ' is no longer there' };
        c.carry = got; j.qty = got.qty; j.stage = 'dst';
        return 'running';
      }
      if (!c.carry) return 'done';
      const spot = refuelSpot(g, st) || interactionSpot(g, st);
      const r = go(g, c, j, spot.x, spot.y, 'on', g.bDef(st).name);
      if (r !== 'arrived') return r === 'moving' ? 'running' : r;
      const pw = { fuel: fuelSpec(g.bDef(st)) };
      const room = Math.max(0, (pw?.fuel?.capacity || 0) - (st.fuel || []).reduce((a, f) => a + f.qty, 0));
      const put = Math.min(room, c.carry.qty);
      if (put > 0) {
        st.fuel = st.fuel || [];
        const f = st.fuel.find((x) => x.item === c.carry.item);
        if (f) f.qty += put; else st.fuel.push({ item: c.carry.item, qty: put });
        c.carry.qty -= put;
      }
      if (c.carry.qty <= 0) c.carry = null; // anything left over is dropped by endJob (still ours)
      c.status.action = `Loaded ${put} ${itemName} into the ${g.bDef(st).name}`;
      return 'done';
    },
  },
  trade: {
    valid(g, c, j) { const t = g.s.trades?.[j.tradeId]; return !!t && t.status === 'active' && (j.stage === 'dst' ? !!c.carry : !!g.s.stacks[j.stackId]); },
    tick(g, c, j) {
      const t = g.s.trades?.[j.tradeId];
      if (!t || t.status !== 'active') return 'done'; // carried goods are dropped (still ours) by endJob
      const itemName = g.reg.get('item', j.item)?.name || j.item;
      if (j.stage === 'src') {
        const st = g.s.stacks[j.stackId];
        if (!st) return { fail: itemName + ' is no longer there' };
        const r = go(g, c, j, st.x, st.y, 'on', itemName);
        if (r !== 'arrived') return r === 'moving' ? 'running' : r;
        g.release(j, (x) => x.k === 'q' && x.key === j.stackId);
        const got = g.takeFromStack(j.stackId, j.qty);
        if (!got || got.qty <= 0) return { fail: itemName + ' is no longer there' };
        c.carry = got; j.qty = got.qty; j.stage = 'dst';
        return 'running';
      }
      if (!c.carry) return 'done';
      const r = go(g, c, j, j.dest.x, j.dest.y, 'on', settlementOf(g, j.to)?.name || 'the other village');
      if (r !== 'arrived') return r === 'moving' ? 'running' : r;
      const { item, qty, dur } = c.carry;
      c.carry = null;
      c.status.action = 'Delivered ' + qty + ' ' + itemName;
      deliverLeg(g, t, j.leg, item, qty, c.x, c.y, dur); // ownership passes to the receiving settlement here
      return 'done';
    },
  },

  sow: {
    valid(g, c, j) { return !!g.s.fields[j.fieldId]; },
    tick(g, c, j) {
      const field = g.s.fields[j.fieldId];
      const crop = g.reg.get('crop', j.crop);
      if (!field || !crop) return { fail: 'The field is gone' };
      if (j.stage === 'seed') {
        const st = g.s.stacks[j.seedStack];
        if (!st) return { fail: 'Seeds disappeared' };
        const r = go(g, c, j, st.x, st.y, 'on', 'seeds');
        if (r !== 'arrived') return r === 'moving' ? 'running' : r;
        g.release(j, (x) => x.k === 'q' && x.key === j.seedStack);
        const got = g.takeFromStack(j.seedStack, j.qty);
        if (!got || got.qty <= 0) return { fail: 'Seeds disappeared' };
        c.carry = got;
        j.stage = 'plant'; j.ti = 0;
        return 'running';
      }
      if (!c.carry || c.carry.qty <= 0 || j.ti >= j.tiles.length) { c.carry = c.carry?.qty > 0 ? c.carry : null; return 'done'; }
      const [x, y] = j.tiles[j.ti];
      if (g.cropAt(x, y) || g.nodeAt(x, y) || g.stackAt(x, y) || g.fieldAt(x, y)?.id !== field.id) {
        g.release(j, (r) => r.k === 'x' && r.key === `sow:${x},${y}`);
        j.ti++; j.prog = 0; return 'running';
      }
      const r = go(g, c, j, x, y, 'on', 'the field');
      if (r !== 'arrived') return r === 'moving' ? 'running' : r;
      j.prog = (j.prog || 0) + workSpeed(g, c, 'core:farm', 'core:farming');
      practice(g, c, 'core:farm', 'core:farming');
      c.status.action = `Sowing ${crop.name} (${j.ti + 1}/${j.tiles.length})`;
      if (j.prog < (crop.sowWork || 25)) return 'running';
      c.carry.qty -= 1;
      g.consume(c.carry.item, 1, 'sow');
      if (c.carry.qty <= 0) c.carry = null;
      g.addCrop(crop.id, x, y, field.id);
      g.release(j, (rr) => rr.k === 'x' && rr.key === `sow:${x},${y}`);
      j.ti++; j.prog = 0;
      return 'running';
    },
  },

  harvest: {
    valid(g, c, j) { return j.cropIds.some((id) => g.s.crops[id]); },
    tick(g, c, j) {
      while (j.i < j.cropIds.length && !g.s.crops[j.cropIds[j.i]]) j.i++;
      if (j.i >= j.cropIds.length) return 'done';
      const crop = g.s.crops[j.cropIds[j.i]];
      const def = g.reg.get('crop', crop.def);
      const r = go(g, c, j, crop.x, crop.y, 'on', def.name);
      if (r !== 'arrived') return r === 'moving' ? 'running' : r;
      j.prog = (j.prog || 0) + workSpeed(g, c, 'core:farm', 'core:farming');
      practice(g, c, 'core:farm', 'core:farming');
      c.status.action = `Harvesting ${def.name} (${j.i + 1}/${j.cropIds.length})`;
      if (j.prog < (def.harvestWork || 30)) return 'running';
      g.removeCrop(crop.id);
      for (const h of def.harvest) g.createItems(h.item, h.qty, crop.x, crop.y, 'harvest');
      g.release(j, (rr) => rr.k === 'x' && rr.key === `crop:${crop.id}`);
      j.i++; j.prog = 0;
      return 'running';
    },
  },

  eat: {
    valid(g, c, j) { return j.stage === 'eat' ? !!c.carry : !!g.s.stacks[j.stackId]; },
    tick(g, c, j) {
      if (j.stage === 'go') {
        const st = g.s.stacks[j.stackId];
        if (!st) return { fail: 'The food is gone', cooldown: 30 };
        const r = go(g, c, j, st.x, st.y, 'on', g.reg.get('item', st.item).name);
        if (r !== 'arrived') return r === 'moving' ? 'running' : r;
        g.release(j);
        const got = g.takeFromStack(j.stackId, 1);
        if (!got || got.qty < 1) return { fail: 'The food is gone', cooldown: 30 };
        c.carry = got;
        j.stage = 'eat'; j.prog = 0;
        return 'running';
      }
      if (!c.carry) return 'done';
      j.prog++;
      const d = g.reg.get('item', c.carry.item);
      c.status.action = `Eating ${d?.name}`;
      if (j.prog < 40) return 'running';
      const hunger = g.reg.all('need').find((n) => n.behavior === 'core:eat');
      if (hunger) c.needs[hunger.id] = Math.min(1, (c.needs[hunger.id] ?? 0) + (d?.nutrition || 0));
      g.consume(c.carry.item, 1, 'eat');
      c.carry = null;
      return 'done';
    },
  },

  sleep: {
    tick(g, c, j) {
      if (j.stage === 'go') {
        if (j.bedId && !j.recover) roughIfBedTooFar(g, c, j);
        const r = go(g, c, j, j.x, j.y, 'on', j.bedId ? 'bed' : 'a sleeping spot');
        if (r !== 'arrived') return r === 'moving' ? 'running' : r;
        j.stage = 'sleep';
      }
      c.sleeping = true;
      const needs = g.reg.all('need');
      const energy = needs.find((n) => n.behavior === 'core:sleep');
      const hunger = needs.find((n) => n.behavior === 'core:eat');
      if (!energy) return 'done';
      c.needs[energy.id] = Math.min(1, (c.needs[energy.id] ?? 0) + (j.rate * sleepWarmth(g, c)) / 2400); // the cold makes for poor sleep
      c.status.action = j.recover ? `Resting to recover (health ${hpOf(c)}%)` : j.bedId ? 'Sleeping in bed' : j.rough ? 'Sleeping rough (bed too far)' : 'Sleeping on the ground';
      if (j.recover) { if (hpOf(c) >= HEALTH.restUntil) return 'done'; }
      else if (c.needs[energy.id] >= 0.99) return 'done';
      if (c.needs[energy.id] > 0.3) {
        // Hunger wakes the sleeper below its urgentBelow; any other need below its criticalBelow (default
        // urgentBelow / 2). Not for a need already found unmeetable when this sleep began (decide() records it
        // in j.unmet), so a night without food or water does not wake and re-sleep at every tick.
        // Big worlds, far from home (trips.js): hunger wakes the sleeper only once its energy lasts the walk
        // home to the food; until then it sleeps on (waking now would mean collapsing on the way).
        if (hunger && c.needs[hunger.id] < hunger.urgentBelow && j.unmet?.[hunger.id] === undefined) {
          if (energyLastsWalkHome(g, c, energy)) {
            c.status.blocker = `Woke up: ${hunger.name} is critical`; c.status.blockerTick = g.s.tick;
            return 'done';
          }
          c.status.action = 'Sleeping on: too tired to walk home to food';
        }
        for (const def of needs) {
          if (def === energy || def === hunger || j.unmet?.[def.id] !== undefined) continue;
          if (!NEED_BEHAVIORS[def.behavior]?.wants(g, c, def)) continue;
          if ((c.needs[def.id] ?? 1) < (def.criticalBelow ?? def.urgentBelow / 2)) { c.status.blocker = `Woke up: ${def.name} is critical`; c.status.blockerTick = g.s.tick; return 'done'; }
        }
      }
      return 'running';
    },
    cleanup(g, c) { c.sleeping = false; },
  },

  equip: {
    valid(g, c, j) { return !!g.s.stacks[j.stackId]; },
    tick(g, c, j) {
      const st = g.s.stacks[j.stackId];
      if (!st) return { fail: 'The equipment is gone', cooldown: 60 };
      const name = g.reg.get('item', st.item)?.name;
      const r = go(g, c, j, st.x, st.y, 'on', name);
      if (r !== 'arrived') return r === 'moving' ? 'running' : r;
      g.release(j);
      const got = g.takeFromStack(j.stackId, 1);
      if (!got) return { fail: 'The equipment is gone' };
      const old = c.equip[j.slot];
      if (old) g.placeItems(old.item, 1, c.x, c.y, old.dur);
      c.equip[j.slot] = { item: got.item, dur: got.dur ?? g.reg.get('item', got.item)?.equipment?.durability ?? 1 };
      g.log(`${c.name} equipped a ${name}.`, 'craft');
      return 'done';
    },
  },

  // Walk toward a neighbouring village until its people are met (contact is detected by the village layer).
  scout: {
    tick(g, c, j) {
      const sid = c.settlementId || g.s.playerSettlement;
      if (relationPeek(g, sid, j.to).contact) return 'done';
      const r = go(g, c, j, j.x, j.y, 'on', 'the neighbours');
      if (r === 'moving') { c.status.action = `Scouting toward ${g.s.settlements[j.to]?.name || 'the neighbours'}`; return 'running'; }
      if (r !== 'arrived') return r;
      j.wait = (j.wait || 0) + 1; // linger a little so the village layer notices
      c.status.action = `Looking for the people of ${g.s.settlements[j.to]?.name || 'the village'}`;
      return j.wait > 120 ? 'done' : 'running';
    },
  },
  wander: {
    tick(g, c, j) {
      if (j.stage === 'go') {
        const r = go(g, c, j, j.x, j.y, 'on', 'a quiet spot');
        if (r === 'moving') { c.status.action = j.reason || 'Wandering'; return 'running'; }
        if (r !== 'arrived') return 'done';
        j.stage = 'wait';
      }
      c.status.action = j.reason || 'Idle';
      return --j.wait > 0 ? 'running' : 'done';
    },
  },
};
