// Job givers: scan the world for concrete, reachable, unreserved work of one kind.
// Each candidate has a location, an urgency, and make() which reserves what it needs and returns a job
// (or null if a reservation failed). Candidates are scored by ai.js.
import { EDUCATION_GIVERS } from '../education.js';
import { categoryScore, neededNearby } from '../storage.js';
import { MEDICAL_GIVERS } from '../medical.js';
import { octile, clamp } from '../util.js';
import { newJob } from './jobs.js';
import { materialsComplete, partEligible, interactionSpot, workOrderOf } from '../construction.js';
import { settlementOf } from '../research.js';
import { legRemaining, relationPeek } from '../villages.js';
import { contactRules, tradeLegFar, caravanReach } from '../contact.js';
import { TICKS_PER_DAY, NEAR_RADIUS } from '../constants.js';
import { fuelLoaded, fuelSpec } from '../power.js';
import { heatSeason, refuelSpot } from '../heat.js';
import { isDown, careNeed } from '../health.js';
import { findFood, findWater } from './needs.js';
import { fieldCells } from '../game.js';
import { reachTest, nodesInReach, SLOW_WORK } from './trips.js';
import { BURIAL_GIVERS } from '../burial.js';
import { droughtAt } from '../weatherat.js';
import { HUNT_GIVERS } from '../hunt.js';
import { SLAY_GIVERS } from '../slay.js';

/** Contact games: a leg to a far village goes by caravan (contact.js), which loads only goods on the stockpile or
 *  near the centre (lod.js caravanReach). If those cannot cover what is still owed, one colonist at a time per
 *  leg brings the nearest other stack of it to the stockpile (a haul job; nothing moves without a carrier). */
function farLegHaul(g, c, t, idx, leg, wt, out) {
  const { remaining } = legRemaining(g, t, idx);
  if (remaining <= 0) return;
  const sid = c.settlementId || g.s.playerSettlement, key = `farhaul:${t.id}:${idx}`;
  if (g.isReserved(key, c.id)) return;
  let seen = 0, best = null, bd = Infinity;
  for (const st of g.stacksByItem().get(leg.item) || []) {
    if (!g.tradeable(st) || !g.mine(st, c)) continue;
    const a = g.availQty(st.id, true);
    if (a <= 0) continue;
    if (caravanReach(g, sid, st)) { seen += a; continue; }
    if (!g.canReach(c, st.x, st.y, 'on')) continue;
    const d = octile(c.x, c.y, st.x, st.y);
    if (d < bd) { bd = d; best = st; }
  }
  if (!best || seen >= remaining) return;
  const st = best, def = g.reg.get('item', st.item), to = settlementOf(g, leg.to)?.name || leg.to;
  out.push({
    x: st.x, y: st.y, urgency: 0.9, label: `Haul ${def?.name} for the caravan`,
    make: () => {
      const dest = findStockDest(g, st.item, st.x, st.y, st.dur, c);
      if (!dest) { g.planOf(c).stockFull = true; return null; }
      const qty = Math.min(remaining - seen, g.availQty(st.id, true), g.carryLimit(st.item), dest.room);
      if (qty <= 0) return null;
      const job = newJob('haul', { stackId: st.id, item: st.item, qty, stage: 'src', dest: { kind: 'stock', x: dest.x, y: dest.y } },
        { why: `Goods for the caravan to ${to}`, label: `Haul ${def?.name} to the stockpile for the caravan to ${to}`, targetKey: key, workType: wt.id });
      if (!g.reserveQty(job, st.id, qty, true)) return null; // trade-held goods: this leg's own
      if (!g.reserveExcl(job, key, c.id)) { g.release(job); return null; }
      if (!g.reserveExcl(job, `tile:${dest.x},${dest.y}`, c.id)) { g.release(job); return null; }
      return job;
    },
  });
}

function findStockDest(g, item, fx, fy, dur, c) {
  let best = null, bestScore = Infinity;
  const sid = c?.settlementId || g.s.playerSettlement;
  for (const k of g.stockpileOf(sid)) { // only our own stockpile
    const [x, y] = k.split(',').map(Number);
    if (g.isReserved(`tile:${x},${y}`)) continue;
    if (!g.isPassable(x, y) || g.footIdAt(g.i(x, y))) continue;
    const st = g.stackAt(x, y);
    let room;
    if (st) { if (!g.mine(st, c)) continue; room = g.stackRoom(st, item, dur); if (room <= 0) continue; }
    else room = g.reg.get('item', item)?.stackLimit ?? 1;
    const score = octile(fx, fy, x, y) - (st ? 4 : 0) + (st ? 0 : categoryScore(g, item, x, y, sid) * 2); // new piles go next to their category
    if (score < bestScore) { bestScore = score; best = { x, y, room }; }
  }
  return best;
}

export const GIVERS = {
  'core:gather_nodes': {
    find(g, c, params, wt) {
      const out = [];
      const plan = g.planOf(c);
      // Cheap first pass per kind of node: only kinds worked by this work type that yield something wanted
      // (nodes in the way of a site are always considered). Same order as before.
      const kindOk = new Map();
      const wantedKind = (def) => {
        let v = kindOk.get(def.id);
        if (v === undefined) { v = def.workType === wt.id && (!params.tag || !!def.tags?.includes(params.tag)) && def.yields.some((y) => (plan.wants[y.item]?.remaining || 0) > 0); kindOk.set(def.id, v); }
        return v;
      };
      const kindOf = new Map(); // def id -> def if worth looking at, else null
      // Big worlds: only nodes near the village centre (by chunk), plus anything in the way of a site.
      // With the travel rules (trips.js): the nodes within maxWalk tiles' walk instead, and of those only the
      // ones a fed, watered and rested colonist could walk to and back from home in time (reachTest).
      let source = null;
      const mySid = c.settlementId || g.s.playerSettlement;
      const reach = g.big ? reachTest(g, mySid) : null;
      if (g.big) {
        const defs = new Set(g.reg.all('node').filter((d) => d.workType === wt.id).map((d) => d.id));
        const ctr = g.s.settlements?.[mySid]?.center || g.s.center;
        source = (reach && nodesInReach(g, mySid, defs)) || g.nodesNear(ctr.x, ctr.y, NEAR_RADIUS, defs);
        if (plan.clear.size) { const seen = new Set(source.map((n) => n.id)); for (const id of plan.clear.keys()) { const n = g.s.nodes[id]; if (n && !seen.has(id)) source.push(n); } }
      }
      for (const node of source || Object.values(g.s.nodes)) {
        let def = kindOf.get(node.def);
        if (def === undefined) { const d = g.reg.get('node', node.def); def = d && d.workType === wt.id ? d : null; kindOf.set(node.def, def); }
        if (!def) continue;
        const clr = plan.clear.size ? plan.clear.get(node.id) : undefined;
        if (!clr && !wantedKind(def)) continue;
        if (node.empty && !clr) continue; // regrowing; but plants in the way of a site still get cleared
        if (params.tag && !def.tags?.includes(params.tag)) continue;
        const key = 'node:' + node.id;
        if (g.isReserved(key, c.id) || g.isBlocked(key)) continue;
        const claim = g.footAt(node.x, node.y) || g.fieldAt(node.x, node.y);
        if (claim && !g.mine(claim, c)) continue; // on another settlement's land
        if (!g.gatherOk(mySid, node)) continue; // another settlement's land, unless it granted gathering rights
        let urg = -1, why = '', max = 1, wantItem = null, goal = null;
        if (clr) { urg = clr.urgency; why = clr.why; max = 99; }
        for (const y of def.yields) {
          const w = plan.wants[y.item];
          if (w && w.remaining > 0 && w.urgency > urg) {
            urg = w.urgency; why = w.why; wantItem = y.item; goal = w.goal || null;
            max = clamp(Math.ceil(w.remaining / y.qty), 1, 3);
          }
        }
        if (urg < 0) continue;
        if (reach && !clr && !reach(node.x, node.y, def.work * SLOW_WORK)) continue; // big worlds: too far a walk from home (for one chunk)
        if (!g.canReach(c, node.x, node.y, def.passable ? 'on' : 'adj')) continue;
        out.push({
          // trip budget (trips.js): the walk to the node and the work there (chunks at a slow worker's pace); a
          // far node that only fits one chunk is worked for one chunk (limit)
          x: node.x, y: node.y, urgency: urg, label: `${wt.name}: ${def.name}`,
          far: { x: node.x, y: node.y, work: def.work * Math.min(max, node.chunks || 1) * SLOW_WORK, unit: def.work * SLOW_WORK, limit: (n) => { max = Math.min(max, n); } },
          make: () => {
            const job = newJob('gather', { nodeId: node.id, maxChunks: max, done: 0, prog: 0, clear: !!clr }, { why, label: `${wt.name}: ${def.name}`, targetKey: key, workType: wt.id, goal });
            if (!g.reserveExcl(job, key, c.id)) return null;
            if (wantItem) {
              const y = def.yields.find((yy) => yy.item === wantItem);
              plan.wants[wantItem].remaining -= y.qty * Math.min(max, node.chunks);
            }
            return job;
          },
        });
      }
      return out;
    },
  },

  'core:haul_stockpile': {
    find(g, c, params, wt) {
      const out = [];
      for (const st of g.mineList('stacks', c)) {
        if (!g.mine(st, c)) continue;
        const onFoot = !!g.footIdAt(g.i(st.x, st.y));
        if (g.isStockpile(st.x, st.y) && !onFoot) continue;
        const avail = g.availQty(st.id);
        if (avail <= 0) continue;
        const key = 'stack:' + st.id;
        if (g.isBlocked(key)) continue;
        if (!g.canReach(c, st.x, st.y, 'on')) continue;
        const def = g.reg.get('item', st.item);
        const onField = !!g.fieldAt(st.x, st.y);
        if (!onFoot && !onField && neededNearby(g, st, c.settlementId || g.s.playerSettlement)) continue; // a building site next to it needs it: no detour via the hub
        // The more goods lie around waiting, the more storage hauling matters (so busy villages still tidy up).
        const pressure = Math.min(0.6, (g.planOf(c).storage?.waitingStacks || 0) * 0.03);
        const urgency = (onFoot || onField ? 1.2 : def?.nutrition ? 0.6 : 0.4) + pressure;
        out.push({
          x: st.x, y: st.y, far: { x: st.x, y: st.y, carry: true }, urgency, label: `Haul ${def?.name}`,
          make: () => {
            const dest = findStockDest(g, st.item, st.x, st.y, st.dur, c);
            if (!dest) { g.planOf(c).stockFull = true; g.blockTarget(key, 'Stockpile is full', 200); return null; }
            const qty = Math.min(avail, g.carryLimit(st.item), dest.room);
            const job = newJob('haul', { stackId: st.id, item: st.item, qty, stage: 'src', dest: { kind: 'stock', x: dest.x, y: dest.y } },
              { why: onFoot ? 'Clearing a building site' : onField ? 'Clearing a field' : 'Keeping the colony tidy', label: `Haul ${def?.name} to stockpile`, targetKey: key, workType: wt.id });
            if (!g.reserveQty(job, st.id, qty)) return null;
            if (!g.reserveExcl(job, `tile:${dest.x},${dest.y}`, c.id)) { g.release(job); return null; }
            return job;
          },
        });
      }
      return out;
    },
  },

  'core:haul_sites': {
    find(g, c, params, wt) {
      const out = [];
      const byItem = g.stacksByItem();
      for (const p of g.mineList('projects', c)) {
        if ((p.status !== 'active' && !p.renovating) || !g.mine(p, c)) continue;
        for (const sid of p.parts) {
          const site = g.s.structures[sid];
          const wo = site && workOrderOf(g, site);
          if (!wo?.def) continue;
          const key = 'site:' + sid;
          if (g.isBlocked(key)) continue;
          if (!g.reachableFrom(c.x, c.y, site.x, site.y, 'adj')) continue;
          const def = wo.def;
          for (const cost of def.cost) {
            const need = cost.qty - (wo.delivered[cost.item] || 0) - g.incoming(sid, cost.item);
            if (need <= 0) continue;
            let best = null, bestD = Infinity;
            for (const st of byItem.get(cost.item) || []) {
              if (st.dur !== undefined || !g.mine(st, c) || g.availQty(st.id) <= 0) continue; // ownership first: availQty (trade holds) is the costly test
              if (g.footIdAt(g.i(st.x, st.y)) === p.id && !g.isStockpile(st.x, st.y)) continue;
              const d = octile(c.x, c.y, st.x, st.y) + octile(st.x, st.y, site.x, site.y);
              if (d < bestD && g.canReach(c, st.x, st.y, 'on')) { bestD = d; best = st; }
            }
            if (!best) continue;
            const stack = best;
            // Delivering materials that already exist beats gathering more of them.
            const urgency = wo.reno ? 0.3 : (p.urgency ?? 1) + 0.5 + (site.order === 0 ? 0.15 : site.order === 1 ? 0.1 : 0);
            out.push({
              x: stack.x, y: stack.y, far: { x: stack.x, y: stack.y, carry: true }, dist: bestD * 0.6, urgency, label: `Deliver ${g.reg.get('item', cost.item)?.name} to ${def.name}`,
              make: () => {
                const qty = Math.min(need, g.availQty(stack.id), g.carryLimit(cost.item));
                if (qty <= 0) return null;
                const job = newJob('haul', { stackId: stack.id, item: cost.item, qty, stage: 'src', dest: { kind: 'site', sid } },
                  { why: p.why || `Build ${p.name}`, label: `Deliver ${g.reg.get('item', cost.item)?.name} to ${def.name}`, targetKey: key, workType: wt.id, goal: p.goal });
                if (!g.reserveQty(job, stack.id, qty)) return null;
                g.reserveIncoming(job, sid, cost.item, qty);
                return job;
              },
            });
          }
        }
      }
      return out;
    },
  },

  'core:construct': {
    find(g, c, params, wt) {
      const out = [];
      for (const p of g.mineList('projects', c)) {
        if ((p.status !== 'active' && !p.renovating) || !g.mine(p, c)) continue;
        for (const sid of p.parts) {
          const st = g.s.structures[sid];
          if (!st || (st.built && !st.reno)) continue;
          const key = 'build:' + sid;
          if (g.isReserved(key, c.id) || g.isBlocked(key)) continue;
          if (!materialsComplete(g, st)) continue;
          if (!st.built && !partEligible(g, st)) continue;
          if (!st.built && (g.nodeAt(st.x, st.y) || g.stackAt(st.x, st.y))) continue;
          if (!g.canReach(c, st.x, st.y, 'adj')) continue;
          const def = g.bDef(st);
          const reno = st.built && st.reno;
          out.push({
            x: st.x, y: st.y, urgency: reno ? 0.3 : (p.urgency ?? 1) + 0.2, label: reno ? `Renovate ${def.name}` : `Build ${def.name}`,
            make: () => {
              const job = newJob('construct', { sid }, { why: p.why || `Build ${p.name}`, label: reno ? `Renovate ${def.name} into ${g.reg.get('building', st.reno.to)?.name} (${p.name})` : `Build ${def.name} (${p.name})`, targetKey: key, workType: wt.id, goal: p.goal });
              return g.reserveExcl(job, key, c.id) ? job : null;
            },
          });
        }
      }
      return out;
    },
  },

  'core:sow': {
    find(g, c, params, wt) {
      const out = [];
      const plan = g.planOf(c);
      if (plan.sowAllowed === false) return out; // plenty of food: let fields rest
      const byItem = g.stacksByItem();
      for (const f of g.mineList('fields', c)) {
        const crop = g.reg.get('crop', f.crop);
        if (!crop || !g.mine(f, c)) continue;
        if (plan.sowOk && plan.sowOk[crop.id] === false) continue; // it would not ripen before frost
        const free = [];
        for (const [x, y] of fieldCells(f)) {
          if (g.cropAt(x, y) || g.nodeAt(x, y) || g.stackAt(x, y)) continue;
          if (g.isReserved(`sow:${x},${y}`, c.id)) continue;
          if (droughtAt(g, x, y)) continue; // waiting out the drought (weather.js)
          if (g.terrainAt(x, y).fertility < (crop.minFertility ?? 0.5)) continue;
          free.push([x, y]);
        }
        if (!free.length) continue;
        let seed = null, sd = Infinity;
        for (const st of byItem.get(crop.seed) || []) {
          if (!g.mine(st, c) || g.availQty(st.id) <= 0 || !g.canReach(c, st.x, st.y, 'on')) continue;
          const d = octile(c.x, c.y, st.x, st.y);
          if (d < sd) { sd = d; seed = st; }
        }
        if (!seed) continue;
        const first = free[0];
        if (!g.canReach(c, first[0], first[1], 'on')) continue;
        const seedStack = seed;
        out.push({
          x: first[0], y: first[1], dist: sd, urgency: 1.0 + (plan.foodDays < 2 ? 0.5 : 0), label: `Sow ${crop.name}`,
          make: () => {
            const n = Math.min(8, free.length, g.availQty(seedStack.id));
            if (n <= 0) return null;
            free.sort((a, b) => octile(first[0], first[1], a[0], a[1]) - octile(first[0], first[1], b[0], b[1]));
            const tiles = free.slice(0, n);
            const job = newJob('sow', { fieldId: f.id, crop: crop.id, tiles, seedStack: seedStack.id, qty: n, stage: 'seed', ti: 0 },
              { why: 'Farming for future meals', label: `Sow ${crop.name}`, targetKey: 'field:' + f.id, workType: wt.id });
            if (!g.reserveQty(job, seedStack.id, n)) return null;
            for (const [x, y] of tiles) g.reserveExcl(job, `sow:${x},${y}`, c.id);
            return job;
          },
        });
      }
      return out;
    },
  },

  'core:harvest': {
    find(g, c, params, wt) {
      const out = [];
      const ripe = Object.values(g.s.crops).filter((cr) => cr.growth >= 1 && g.mine(g.s.fields[cr.fieldId] || {}, c) && !g.isReserved('crop:' + cr.id, c.id));
      const used = new Set();
      for (const cr of ripe) {
        if (used.has(cr.id)) continue;
        if (!g.canReach(c, cr.x, cr.y, 'on')) continue;
        const group = ripe.filter((o) => !used.has(o.id) && octile(o.x, o.y, cr.x, cr.y) <= 3).slice(0, 6);
        group.forEach((o) => used.add(o.id));
        const def = g.reg.get('crop', cr.def);
        out.push({
          x: cr.x, y: cr.y, urgency: 1.3, label: `Harvest ${def?.name}`,
          make: () => {
            const job = newJob('harvest', { cropIds: group.map((o) => o.id), i: 0 }, { why: 'Bringing in the harvest', label: `Harvest ${def?.name}`, targetKey: 'crop:' + cr.id, workType: wt.id });
            for (const o of group) if (!g.reserveExcl(job, 'crop:' + o.id, c.id)) { g.release(job); return null; }
            return job;
          },
        });
      }
      return out;
    },
  },

  // Keep our generators fuelled: carry fuel (items with the generator's fuel tag) into any generator
  // that is below 60% full. Longer-burning fuel is preferred when the walk is similar.
  // Service worn machinery: bring the repair materials, then work until the building is like new.
  // Worn (below 60%) buildings are serviced routinely; broken ones (0%) urgently.
  'core:maintain': {
    find(g, c, params, wt) {
      const out = [];
      // This village's buildings that need servicing at all, in Object.values order (game.js ownedWhere).
      for (const st of g.ownedWhere('maintained', (b) => !!g.bDef(b)?.maintenance, c.settlementId || g.s.playerSettlement)) {
        if (!st.built || !g.mine(st, c)) continue;
        const def = g.bDef(st);
        const m = def?.maintenance;
        if (!m || (st.condition ?? 100) >= 60) continue;
        const key = 'maint:' + st.id;
        if (g.isReserved(key, c.id)) continue;
        const spot = interactionSpot(g, st);
        if (!g.canReach(c, spot.x, spot.y, 'on')) continue;
        // One reachable stack for each repair material.
        const picks = [];
        for (const cost of m.cost || []) {
          let best = null, bd = Infinity;
          for (const stk of g.stacksByItem().get(cost.item) || []) {
            if (stk.dur !== undefined || !g.mine(stk, c) || g.availQty(stk.id) < cost.qty || !g.canReach(c, stk.x, stk.y, 'on')) continue;
            const d = octile(c.x, c.y, stk.x, stk.y);
            if (d < bd) { bd = d; best = stk; }
          }
          if (!best) break;
          picks.push({ stackId: best.id, item: cost.item, qty: cost.qty });
        }
        if (picks.length < (m.cost || []).length) continue;
        const broken = (st.condition ?? 100) <= 0;
        out.push({
          x: spot.x, y: spot.y, far: farthestPick(g, spot, picks), urgency: broken ? 1.25 : 0.7, label: broken ? 'Repair a broken machine' : 'Service a machine',
          make: () => {
            const job = newJob('maintain', { stationId: st.id, inputs: picks.map((p) => ({ ...p })), idx: 0, stage: 'fetch' },
              { why: broken ? `The ${def.name} has broken down` : `The ${def.name} is wearing out (${Math.round(st.condition ?? 100)}%)`, label: `${broken ? 'Repair' : 'Service'} the ${def.name}`, targetKey: key, workType: wt.id });
            for (const p of picks) if (!g.reserveQty(job, p.stackId, p.qty)) { g.release(job); return null; }
            g.reserveExcl(job, key, c.id);
            return job;
          },
        });
      }
      return out;
    },
  },
  // Care for colonists who have collapsed: bring food if they are hungry, and dress their wounds.
  'core:tend': {
    find(g, c, params, wt) {
      const out = [];
      if (isDown(c)) return out;
      const mySid = c.settlementId || g.s.playerSettlement;
      // Contact scenarios (contact.tendRange): no one walks out to a patient far from home (a scout who
      // collapsed on a long walk would pull carer after carer away from the village).
      const tendRange = contactRules(g)?.tendRange, home = tendRange !== undefined ? settlementOf(g, mySid)?.center : null;
      for (const p of Object.values(g.s.colonists)) {
        if (p.id === c.id || (p.settlementId || g.s.playerSettlement) !== mySid) continue;
        if (home && octile(home.x, home.y, p.x, p.y) > tendRange) continue;
        const need = careNeed(g, p);
        if (!need) continue;
        const key = 'tend:' + p.id;
        if (g.isReserved(key, c.id) || !g.canReach(c, p.x, p.y, 'adj')) continue;
        const thirst = g.reg.all('need').find((n) => n.behavior === 'core:drink');
        const thirsty = thirst && (p.needs[thirst.id] ?? 1) < 0.5;
        const hunger = g.reg.all('need').find((n) => n.behavior === 'core:eat');
        const hungry = hunger && (p.needs[hunger.id] ?? 1) < 0.5;
        const food = hungry ? findFood(g, c) : null;
        const water = thirsty ? findWater(g, c) : null;
        out.push({
          x: p.x, y: p.y, urgency: need === 2 ? 1.8 : 1.4, label: (isDown(p) ? 'Care for ' : 'Feed ') + p.name,
          make: () => {
            const job = newJob('tend', { patientId: p.id, stackId: food ? food.id : null, wx: water?.x, wy: water?.y, stage: water ? 'water' : food ? 'food' : 'go' },
              { why: isDown(p) ? p.name + ' has collapsed' : p.name + ' is too young to fend for themselves', label: water ? 'Bring water to ' + p.name : food ? 'Bring food to ' + p.name : 'Tend ' + p.name, targetKey: key, workType: wt.id });
            if (food && !g.reserveQty(job, food.id, 1)) return null;
            g.reserveExcl(job, key, c.id);
            return job;
          },
        });
      }
      return out;
    },
  },
  'core:refuel': {
    find(g, c, params, wt) {
      const out = [];
      // This village's buildings with a fuel store, in Object.values order (game.js ownedWhere).
      for (const st of g.ownedWhere('fuelStore', (b) => !!fuelSpec(g.bDef(b)), c.settlementId || g.s.playerSettlement)) {
        if (!st.built || !g.mine(st, c)) continue;
        const pw = { fuel: fuelSpec(g.bDef(st)) };
        if (!pw.fuel) continue;
        if (g.bDef(st).heat && !heatSeason(g)) continue; // hearths are only stocked when it is cold or getting cold
        const key = 'refuel:' + st.id;
        if (g.isReserved(key, c.id)) continue;
        const loaded = fuelLoaded(st);
        if (loaded >= pw.fuel.capacity * 0.6) continue;
        const room = pw.fuel.capacity - loaded;
        const spot = refuelSpot(g, st);
        if (!spot || !g.canReach(c, spot.x, spot.y, 'on')) continue;
        let best = null, bs = Infinity;
        for (const it of g.reg.itemsWithTag(pw.fuel.tag)) {
          const fv = g.reg.get('item', it)?.fuel || 1;
          for (const stk of g.stacksByItem().get(it) || []) {
            if (stk.dur !== undefined || !g.mine(stk, c) || g.availQty(stk.id) <= 0 || !g.canReach(c, stk.x, stk.y, 'on')) continue;
            const score = octile(c.x, c.y, stk.x, stk.y) + octile(stk.x, stk.y, spot.x, spot.y) - fv * 6;
            if (score < bs) { bs = score; best = stk; }
          }
        }
        if (!best) continue;
        const stack = best;
        out.push({
          x: stack.x, y: stack.y, far: { x: stack.x, y: stack.y, carry: true }, urgency: loaded === 0 ? 1.1 : 0.8, label: `${g.bDef(st).supplies ? 'Stock' : 'Refuel'} the ${g.bDef(st).name}`,
          make: () => {
            const qty = Math.min(room, g.availQty(stack.id), g.carryLimit(stack.item));
            if (qty <= 0) return null;
            const iname = g.reg.get('item', stack.item)?.name || stack.item;
            const job = newJob('refuel', { stationId: st.id, stackId: stack.id, item: stack.item, qty, stage: 'src' },
              { why: 'Keep the generator fuelled', label: `Refuel the ${g.bDef(st).name} (${qty} ${iname})`, targetKey: key, workType: wt.id });
            if (!g.reserveQty(job, stack.id, qty)) return null;
            g.reserveExcl(job, key, c.id);
            return job;
          },
        });
      }
      return out;
    },
  },
  // Scouting: on larger maps neighbours may never cross paths. A settlement that has not met a neighbour
  // sends one colonist (at most every two days) to walk to the edge of that neighbour's village.
  'core:scout': {
    find(g, c, params, wt) {
      const sid = c.settlementId || g.s.playerSettlement;
      const st = settlementOf(g, sid);
      if (!st?.center || g.s.tick < TICKS_PER_DAY * 1.5 || g.s.tick - (st.lastScout ?? -1e9) < TICKS_PER_DAY * 2) return [];
      // Contact scenarios (contact.js): scouts on foot go only to villages within scoutRange of home (farther
      // ones are met by explorers), and only when fed, watered and rested (scoutNeeds).
      const CR = contactRules(g);
      if (CR?.scoutNeeds !== undefined) {
        for (const nd of g.reg.all('need')) if ((nd.behavior === 'core:eat' || nd.behavior === 'core:drink' || nd.behavior === 'core:sleep') && (c.needs[nd.id] ?? 1) <= CR.scoutNeeds) return [];
      }
      if (g.colonists().some((o) => o.settlementId === sid && o.job?.type === 'scout')) return [];
      const unmet = Object.values(g.s.settlements).filter((o) => o.id !== sid && o.center && !relationPeek(g, sid, o.id).contact
        && (CR?.scoutRange === undefined || octile(st.center.x, st.center.y, o.center.x, o.center.y) <= CR.scoutRange))
        .sort((a, b) => Math.hypot(a.center.x - st.center.x, a.center.y - st.center.y) - Math.hypot(b.center.x - st.center.x, b.center.y - st.center.y));
      for (const o of unmet) {
        // a reachable spot about 9 tiles from their centre, on our side
        const dx = st.center.x - o.center.x, dy = st.center.y - o.center.y, d = Math.hypot(dx, dy) || 1;
        let spot = null;
        for (let r = 9; r >= 5 && !spot; r--) for (let k = -2; k <= 2 && !spot; k++) {
          const x = Math.round(o.center.x + (dx / d) * r - (dy / d) * k), y = Math.round(o.center.y + (dy / d) * r + (dx / d) * k);
          if (g.inB(x, y) && g.isPassable(x, y) && g.canReach(c, x, y, 'on')) spot = { x, y };
        }
        if (!spot) continue;
        return [{ x: c.x, y: c.y, urgency: 0.6, label: `Scout toward ${o.name}`, make: () => {
          st.lastScout = g.s.tick;
          return newJob('scout', { x: spot.x, y: spot.y, to: o.id }, { why: `Find the neighbouring village (${o.name})`, label: `Scout toward ${o.name}`, workType: wt.id });
        } }];
      }
      return [];
    },
  },
  'core:trade_deliver': {
    find(g, c, params, wt) {
      const out = [];
      const sid = c.settlementId || g.s.playerSettlement;
      const walk = contactRules(g)?.tradeWalkRange; // contact scenarios: legs to far villages go by caravan (contact.js)
      for (const t of Object.values(g.s.trades || {})) {
        if (t.status !== 'active') continue;
        t.legs.forEach((leg, idx) => {
          if (leg.from !== sid) return;
          if (walk !== undefined && tradeLegFar(g, leg, walk)) { farLegHaul(g, c, t, idx, leg, wt, out); return; }
          const { remaining } = legRemaining(g, t, idx);
          if (remaining <= 0) return;
          // Our own goods of that kind, closest first.
          let best = null, bd = Infinity;
          for (const st of g.stacksByItem().get(leg.item) || []) {
            if (!g.tradeable(st) || !g.mine(st, c) || g.availQty(st.id, true) <= 0 || !g.canReach(c, st.x, st.y, 'on')) continue;
            const d = octile(c.x, c.y, st.x, st.y);
            if (d < bd) { bd = d; best = st; }
          }
          if (!best) return;
          const pile = g.stockpileOf(leg.to);
          if (!pile.length) return;
          const stack = best;
          out.push({
            // a promise with a deadline: more urgent the closer the deadline gets
            x: stack.x, y: stack.y, urgency: 0.9 + 2 * Math.max(0, Math.min(1, 1 - (t.deadline - g.s.tick) / Math.max(1, t.deadline - t.created))), label: 'Deliver traded goods',
            make: () => {
              const qty = Math.min(remaining, g.availQty(stack.id, true), g.carryLimit(leg.item));
              if (qty <= 0) return null;
              // Destination: a free (or same-item, same-owner) tile in the other settlement's stockpile.
              let dest = null, dd = Infinity;
              for (const k of pile) {
                const [x, y] = k.split(',').map(Number);
                if (g.isReserved('tile:' + x + ',' + y)) continue;
                const there = g.stackAt(x, y);
                if (there && !(there.item === leg.item && (there.settlement || g.s.playerSettlement) === leg.to)) continue;
                const d = octile(stack.x, stack.y, x, y);
                if (d < dd) { dd = d; dest = { x, y }; }
              }
              if (!dest) { const [x, y] = pile[0].split(',').map(Number); dest = { x, y }; }
              if (!g.canReach(c, dest.x, dest.y, 'on')) return null;
              const name = settlementOf(g, leg.to)?.name;
              const job = newJob('trade', { tradeId: t.id, leg: idx, stackId: stack.id, item: leg.item, qty, to: leg.to, stage: 'src', dest },
                { why: 'Trade with ' + name, label: 'Deliver ' + qty + ' ' + g.reg.get('item', leg.item)?.name + ' to ' + name, targetKey: 'trade:' + t.id + ':' + idx + ':' + c.id, workType: wt.id });
              if (!g.reserveQty(job, stack.id, qty, true)) return null;
              g.reserveExcl(job, 'tile:' + dest.x + ',' + dest.y, c.id);
              return job;
            },
          });
        });
      }
      return out;
    },
  },

  'core:research': {
    find(g, c, params, wt) {
      const out = [];
      const plan = g.planOf(c);
      const R = plan.research;
      if (!R?.allowed || !R.tech) return out;
      const st0 = settlementOf(g, c.settlementId || g.s.playerSettlement);
      const tech = g.reg.get('tech', R.tech);
      if (!st0 || !tech) return out;
      if ((st0.research.priorities?.[tech.field] ?? 2) <= 0 || st0.research.done.includes(tech.id)) return out; // switched Off since the last plan
      const busy = [...(g.big ? g.mineList('colonists', c) : g.colonists())].filter((o) => o.id !== c.id && o.job?.type === 'research' && o.settlementId === c.settlementId).length;
      if (busy >= (g.policyFor(c.settlementId).maxResearchers ?? 2)) return out;
      for (const station of g.mineList('structures', c)) {
        if (!station.built || !g.bDef(station)?.research || !g.mine(station, c)) continue;
        const skey = 'station:' + station.id;
        if (g.isReserved(skey, c.id) || g.isBlocked(skey)) continue;
        const spot = interactionSpot(g, station);
        if (!g.canReach(c, spot.x, spot.y, 'on')) continue;
        const paid = !!st0.research.paid[tech.id] || !(tech.cost || []).length;
        const picks = paid ? [] : pickIngredients(g, c, { inputs: tech.cost.map((k) => ({ item: k.item, qty: k.qty })) }, spot);
        if (!picks) { plan.research.why ||= `Waiting for materials: ${tech.cost.map((k) => `${k.qty} ${g.reg.get('item', k.item)?.name}`).join(', ')}`; continue; }
        out.push({
          x: spot.x, y: spot.y, far: farthestPick(g, spot, picks), urgency: 0.35, label: `Research ${tech.name}`,
          make: () => {
            const job = newJob('research', { stationId: station.id, tech: tech.id, inputs: picks, idx: 0, stage: picks.length ? 'fetch' : 'work', session: 0 },
              { why: `Research: ${tech.name}`, label: `Research ${tech.name}`, targetKey: skey, workType: wt.id });
            if (!g.reserveExcl(job, skey, c.id)) return null;
            for (const p of picks) if (!g.reserveQty(job, p.stackId, p.qty)) { g.release(job); return null; }
            return job;
          },
        });
        break;
      }
      return out;
    },
  },

  'core:bills': {
    find(g, c, params, wt) {
      const out = [];
      for (const bill of g.planOf(c).bills) {
        const rec = g.reg.get('recipe', bill.recipe);
        if (!rec || rec.workType !== wt.id || bill.remaining <= 0) continue;
        if (rec.minSkill && (c.skills[rec.skill] || 0) < rec.minSkill) continue;
        // This village's stations of the recipe's kind, in Object.values order (game.js ownedWhere).
        for (const station of g.ownedWhere('def:' + rec.station, (b) => b.def === rec.station, c.settlementId || g.s.playerSettlement)) {
          if (!station.built || station.def !== rec.station || !g.mine(station, c)) continue;
          const skey = 'station:' + station.id;
          if (g.isReserved(skey, c.id) || g.isBlocked(skey)) continue;
          const spot = interactionSpot(g, station);
          if (!g.canReach(c, spot.x, spot.y, 'on')) continue;
          const picks = pickIngredients(g, c, rec, spot);
          if (!picks) { bill.missing = true; continue; }
          out.push({
            x: spot.x, y: spot.y, far: farthestPick(g, spot, picks), urgency: bill.urgency, label: rec.name,
            make: () => {
              const job = newJob('craft', { recipe: rec.id, stationId: station.id, inputs: picks, idx: 0, stage: 'fetch', prog: 0 },
                { why: bill.why, label: `${rec.name} at ${g.bDef(station).name}`, targetKey: skey, workType: wt.id, goal: bill.goal });
              if (!g.reserveExcl(job, skey, c.id)) return null;
              for (const p of picks) if (!g.reserveQty(job, p.stackId, p.qty)) { g.release(job); return null; }
              bill.remaining--;
              return job;
            },
          });
          break; // one station per bill per colonist is enough
        }
      }
      return out;
    },
  },
};

/** For the trip budget (trips.js) of a fetch-and-work job: the picked stack farthest from the work spot in a
 *  straight line (or the spot itself), and in `extra` the walk of the other fetching trips (there and back
 *  from the spot, in a straight line, for each other pick: one pick is one trip). The goods are carried back
 *  (carry: no stop for a drink on the way back). */
function farthestPick(g, spot, picks) {
  let far = spot, fd = -1, sum = 0;
  for (const p of picks) {
    const st = g.s.stacks[p.stackId];
    if (!st) continue;
    const d = octile(spot.x, spot.y, st.x, st.y);
    sum += d;
    if (d > fd) { fd = d; far = st; }
  }
  return { x: far.x, y: far.y, extra: fd > 0 ? 2 * (sum - fd) : 0, carry: true };
}

/** Choose concrete stacks for a recipe's inputs (respecting reservations and seed reserves). */
export function pickIngredients(g, c, rec, spot) { return g.readOnly(() => pickIngredientsIn(g, c, rec, spot)); } // read-only: trade holds once (game.js)
function pickIngredientsIn(g, c, rec, spot) {
  const reserve = { ...(g.planOf(c).seedReserve || {}) };
  const totals = {};
  for (const st of g.mineList('stacks', c)) if (g.mine(st, c)) totals[st.item] = (totals[st.item] || 0) + g.availQty(st.id);
  const usable = {};
  for (const [it, q] of Object.entries(totals)) usable[it] = q - (reserve[it] || 0);
  const taken = new Map(); // stackId -> qty taken in this pick
  const picks = [];
  for (const inp of rec.inputs) {
    let need = inp.qty;
    const cands = [];
    for (const st of g.mineList('stacks', c)) {
      if (st.dur !== undefined || !g.mine(st, c)) continue;
      if (inp.item ? st.item !== inp.item : !g.reg.itemHasTag(st.item, inp.tag)) continue;
      const a = g.availQty(st.id) - (taken.get(st.id) || 0);
      if (a <= 0 || (usable[st.item] || 0) <= 0) continue;
      if (!g.canReach(c, st.x, st.y, 'on')) continue;
      cands.push({ st, a, d: octile(spot.x, spot.y, st.x, st.y) });
    }
    // What spoils goes first (Phase 8, spoil.js); otherwise the nearest (the same order as before).
    const rot = (it) => g.reg.get('item', it)?.spoilPerDay || 0;
    cands.sort((a, b) => rot(b.st.item) - rot(a.st.item) || a.d - b.d);
    for (const { st, a } of cands) {
      // One pick is one trip: a stack bigger than a colonist can carry is fetched in several trips.
      let left = a;
      while (need > 0 && left > 0 && (usable[st.item] || 0) > 0) {
        const q = Math.min(need, left, usable[st.item], g.carryLimit(st.item));
        if (q <= 0) break;
        picks.push({ stackId: st.id, item: st.item, qty: q });
        taken.set(st.id, (taken.get(st.id) || 0) + q);
        usable[st.item] -= q;
        need -= q; left -= q;
      }
      if (need <= 0) break;
    }
    if (need > 0) return null;
  }
  return picks;
}

/** Equipment the planner wants this colonist to pick up. */
export function equipCandidate(g, c) {
  for (const need of g.planOf(c).equipNeeds) {
    if (need.cid !== c.id) continue;
    let best = null, bd = Infinity;
    g.readOnly(() => { // the search is read-only: trade holds once (game.js)
      for (const st of g.stacksByItem().get(need.item) || []) {
        if (!g.mine(st, c) || g.availQty(st.id) < 1 || !g.canReach(c, st.x, st.y, 'on')) continue;
        const d = octile(c.x, c.y, st.x, st.y) - (st.dur || 0) / 1000;
        if (d < bd) { bd = d; best = st; }
      }
    });
    if (!best) continue;
    const job = newJob('equip', { stackId: best.id, slot: need.slot }, { why: need.why, label: `Equip ${g.reg.get('item', need.item)?.name}` });
    if (g.reserveQty(job, best.id, 1)) return job;
  }
  return null;
}

Object.assign(GIVERS, MEDICAL_GIVERS); // rescue and treatment (medical.js)
Object.assign(GIVERS, EDUCATION_GIVERS); // school, teaching and college (education.js)
Object.assign(GIVERS, BURIAL_GIVERS); // carrying the dead to the graveyard (burial.js)
Object.assign(GIVERS, HUNT_GIVERS); // hunting (hunt.js, Phase 8)
Object.assign(GIVERS, SLAY_GIVERS); // hunt parties against monsters, clearing lairs (slay.js, Phase 8c)
