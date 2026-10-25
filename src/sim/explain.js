// Plain-language explanations for the inspectors: why work is blocked, what prerequisite is missing,
// and what the colony is doing about it. Pure functions of game state (testable in Node).
import { describeTarget } from './ai/ai.js';
import { describeGoal } from './goals.js';
import { materialsComplete, partsOf } from './construction.js';
import { BLOCK_COOLDOWN } from './constants.js';

const iname = (g, id) => g.reg.get('item', id)?.name || id;
const names = (list) => (list.length ? list.map((c) => c.name).join(', ') : '');

/** Who is currently doing work that serves this goal (tagged jobs), with what they're doing. */
function helpers(g, goalId) {
  return g.colonists().filter((c) => c.job && c.job.goal === goalId);
}

function jobsMatching(g, pred) { return g.colonists().filter((c) => (c.settlementId || g.s.playerSettlement) === g.s.playerSettlement && c.job && pred(c.job, c)); }

/** What the colony is doing to obtain an item right now. */
export function activityFor(g, item) {
  const parts = [];
  const gather = jobsMatching(g, (j) => j.type === 'gather' && g.s.nodes[j.nodeId] && g.nodeDef(g.s.nodes[j.nodeId])?.yields.some((y) => y.item === item));
  if (gather.length) parts.push(`${names(gather)} gathering it`);
  const craft = jobsMatching(g, (j) => j.type === 'craft' && g.reg.get('recipe', j.recipe)?.outputs.some((o) => o.item === item));
  if (craft.length) parts.push(`${names(craft)} making it`);
  const harvest = jobsMatching(g, (j) => j.type === 'harvest' && j.cropIds.some((id) => g.reg.get('crop', g.s.crops[id]?.def)?.harvest.some((h) => h.item === item)));
  if (harvest.length) parts.push(`${names(harvest)} harvesting it`);
  const w = g.plan.wants[item];
  if (!parts.length && w?.remaining > 0) parts.push(`looking for someone free to gather ${Math.ceil(w.remaining)} more`);
  const bill = g.plan.bills.find((b) => g.reg.get('recipe', b.recipe)?.outputs.some((o) => o.item === item) && b.remaining > 0);
  if (!craft.length && bill) parts.push(`${bill.remaining} batch(es) of "${g.reg.get('recipe', bill.recipe)?.name}" queued`);
  return parts.join('; ');
}

export function explainGoal(g, goal) {
  const P = g.plan;
  const info = P.goalInfo[goal.id] || {};
  const steps = (P.trace[goal.id] || []).slice(0, 14);
  const missing = steps.filter((s) => s.state === 'missing' || s.state === 'blocked').map((s) => s.text).slice(0, 4);
  const blockers = info.blockers || [];
  const who = helpers(g, goal.id);
  let doing;
  if (goal.status === 'complete') doing = 'Goal reached.';
  else if (who.length) doing = who.map((c) => `${c.name}: ${c.status.action}`).join('; ');
  else if (info.done) doing = 'Target met; watching stock levels.';
  else if (blockers.length) doing = 'Waiting: the blockers above must be resolved first (no one can work on it yet).';
  else if (steps.some((s) => s.state === 'working' || s.state === 'wait')) doing = 'Planned work is queued; colonists will pick it up as they finish more urgent jobs (food and housing come first).';
  else doing = info.detail || 'Planning…';
  return { title: describeGoal(g, goal), steps, missing, blockers, doing, helpers: who.map((c) => c.name) };
}

const RECENT = 1200;

export function explainColonist(g, c) {
  const out = {
    goal: c.status.goal || '-', action: c.status.action || 'Idle', target: c.job ? (c.status.target || describeTarget(g, c.job)) : '',
    blocker: null, blockerTick: null, prerequisite: null, resolution: null,
  };
  const recent = c.status.blocker && g.s.tick - (Number(c.status.blockerTick) || 0) < RECENT;
  if (recent) { out.blocker = c.status.blocker; out.blockerTick = c.status.blockerTick; }

  // Current job context (even when not failed).
  const j = c.job;
  if (j?.goal) {
    const goal = g.s.goals.find((x) => x.id === j.goal);
    if (goal) out.goal = `${out.goal} (for goal: ${describeGoal(g, goal)})`;
  }
  if (j?.type === 'construct') {
    const st = g.s.structures[j.sid];
    if (st && !materialsComplete(g, st)) out.prerequisite = 'Materials delivered to the site';
  }

  if (!recent) {
    if ((!j || j.type === 'wander') && c.status.idleReason) {
      out.blocker = null;
      out.prerequisite = 'Open work this colonist may do';
      out.resolution = c.status.idleReason;
    }
    return out;
  }

  const r = c.status.blocker;
  const ctx = c.status.blockerCtx || {};
  const cool = ctx.targetKey && g.s.blocked?.[ctx.targetKey];
  const coolTxt = cool && cool.until > g.s.tick ? ` Everyone skips that target for ${Math.ceil((cool.until - g.s.tick) / 100)} more in-game hour(s), then retries.` : '';
  if (/hungry/i.test(r) || ctx.type === 'eat') {
    out.prerequisite = 'Reachable food (seed stock is protected and not eaten)';
    const raw = g.reg.itemsWithTag('core:raw_food');
    const acts = [...raw.map((it) => activityFor(g, it)), ...g.reg.itemsWithTag('core:meal').map((it) => activityFor(g, it))].filter(Boolean);
    out.resolution = acts.length ? acts.join('; ') : `No food work is possible right now: ${(g.plan.colonyBlockers || []).join('; ') || 'nothing edible is reachable'}.`;
  } else if (/No path|blocked|Route/i.test(r)) {
    out.prerequisite = 'A clear walking route to the target';
    out.resolution = `Chose other work instead.${coolTxt}`;
  } else if (/Materials not delivered/i.test(r)) {
    const st = g.s.structures[ctx.sid];
    const miss = st ? g.bDef(st).cost.map((k) => ({ item: k.item, n: k.qty - (st.delivered[k.item] || 0) })).filter((m) => m.n > 0) : [];
    out.prerequisite = miss.length ? `Materials at the site: ${miss.map((m) => `${m.n} ${iname(g, m.item)}`).join(', ')}` : 'Materials at the site';
    const haulers = jobsMatching(g, (jj) => jj.type === 'haul' && jj.dest?.sid === ctx.sid);
    out.resolution = haulers.length ? `${names(haulers)} delivering materials` : miss.map((m) => activityFor(g, m.item)).filter(Boolean).join('; ') || 'Materials will be hauled when available';
  } else if (/Site is blocked/i.test(r)) {
    out.prerequisite = 'A clear building site';
    out.resolution = 'Loose items and plants on the site are being hauled away or cleared (high priority).';
  } else if (/standing on the site/i.test(r)) {
    out.prerequisite = 'Nobody standing on the building tile';
    out.resolution = 'Idle colonists step off building sites automatically; the wall is retried shortly.';
  } else if (/seal off/i.test(r)) {
    out.prerequisite = 'Everyone outside, and unfinished parts still reachable';
    out.resolution = `Construction order waits until finishing the wall cannot trap anyone.${coolTxt}`;
  } else if (/Stockpile is full/i.test(r)) {
    out.prerequisite = 'Free stockpile space';
    out.resolution = (g.plan.notes || []).find((n) => /stockpile/i.test(n)) || 'The stockpile is extended automatically when it runs out of room.';
  } else if (/Ingredient|Not enough|disappeared/i.test(r)) {
    const rec = g.reg.get('recipe', ctx.recipe);
    out.prerequisite = rec ? `Ingredients for "${rec.name}"` : 'Ingredients';
    out.resolution = rec ? rec.inputs.map((inp) => (inp.item ? activityFor(g, inp.item) : '')).filter(Boolean).join('; ') || 'Ingredients are re-planned every few seconds.' : 'Re-planning.';
  } else if (/station is gone|target is gone|is no longer there/i.test(r)) {
    out.prerequisite = 'The target still existing';
    out.resolution = 'Someone else used or removed it first; the colonist picked other work.';
  } else {
    out.resolution = `Will retry after a short pause.${coolTxt}`;
  }
  if (ctx.goal) {
    const goal = g.s.goals.find((x) => x.id === ctx.goal);
    if (goal) out.resolution += ` (Goal: ${describeGoal(g, goal)})`;
  }
  return out;
}

export { partsOf };
