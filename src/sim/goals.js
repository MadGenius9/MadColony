// Player goal types. A goal never assigns work directly: `apply` raises colony targets that the planner
// turns into demands; `evaluate` reports progress and explains what is missing.
import { homeFurnished, cancelProject } from './construction.js';
import { roleOf } from './planner.js';
import { milestoneStatus } from './research.js';

const PRIORITY_MULT = { 1: 0.75, 2: 1, 3: 1.4 };
export const prioMult = (goal) => PRIORITY_MULT[goal.priority ?? 2] ?? 1;

const itemName = (g, id) => g.reg.get('item', id)?.name || id;
/** Goals belong to the player's settlement: only its colonists count. */
const mine = (g) => g.colonists().filter((c) => (c.settlementId || g.s.playerSettlement) === g.s.playerSettlement);

export const GOAL_TYPES = {
  'core:furnished_homes': {
    name: 'Give every colonist a furnished home',
    kind: 'once',
    params: [],
    apply(g, goal, ctx) { ctx.housingUrgency = Math.max(ctx.housingUrgency, 1.3 * prioMult(goal)); ctx.housingGoal = goal.id; },
    evaluate(g, goal, plan) {
      const cols = mine(g);
      const ok = cols.filter((c) => c.homeId && homeFurnished(g, g.s.homes[c.homeId]));
      const text = `${ok.length}/${cols.length} colonists have a furnished home`;
      return { progress: cols.length ? ok.length / cols.length : 1, done: ok.length === cols.length, text, detail: plan.housingNote };
    },
  },
  'core:maintain_meals': {
    name: 'Maintain prepared meals',
    kind: 'ongoing',
    params: [{ key: 'count', label: 'Meals', type: 'int', default: 20, min: 1, max: 500 }],
    apply(g, goal, ctx) {
      if (goal.params.count > ctx.mealTarget) { ctx.mealTarget = goal.params.count; ctx.mealGoal = goal.id; ctx.mealUrgency = 1.0 * prioMult(goal); }
    },
    evaluate(g, goal, plan) {
      const have = plan.mealCount;
      return { progress: Math.min(1, have / goal.params.count), done: have >= goal.params.count, text: `${have}/${goal.params.count} prepared meals in storage`, detail: plan.mealNote };
    },
  },
  'core:food_days': {
    name: 'Maintain enough food for N days',
    kind: 'ongoing',
    params: [{ key: 'days', label: 'Days', type: 'int', default: 5, min: 1, max: 60 }],
    apply(g, goal, ctx) {
      if (goal.params.days > ctx.foodDays) { ctx.foodDays = goal.params.days; ctx.foodGoal = goal.id; ctx.foodUrgency = 0.8 * prioMult(goal); }
    },
    evaluate(g, goal, plan) {
      const d = plan.foodDays;
      return { progress: Math.min(1, d / goal.params.days), done: d >= goal.params.days, text: `${d.toFixed(1)} of ${goal.params.days} days of food stored (${plan.growingDays.toFixed(1)} more growing)`, detail: plan.foodNote };
    },
  },
  'core:stockpile': {
    name: 'Stockpile a resource',
    kind: 'once',
    params: [
      { key: 'item', label: 'Item', type: 'item', default: 'core:wood' },
      { key: 'count', label: 'Amount', type: 'int', default: 100, min: 1, max: 5000 },
      { key: 'ongoing', label: 'Keep it topped up', type: 'bool', default: false },
    ],
    isOngoing: (goal) => !!goal.params.ongoing,
    apply(g, goal, ctx) {
      ctx.demands.push({ item: goal.params.item, qty: goal.params.count, urgency: 0.55 * prioMult(goal), why: `Goal: stockpile ${goal.params.count} ${itemName(g, goal.params.item)}`, goal: goal.id, stockGoal: true });
    },
    evaluate(g, goal, plan) {
      const have = plan.stock[goal.params.item] || 0;
      return { progress: Math.min(1, have / goal.params.count), done: have >= goal.params.count, text: `${have}/${goal.params.count} ${itemName(g, goal.params.item)} stored` };
    },
  },
  'core:expand_housing': {
    name: 'Expand housing capacity',
    kind: 'once',
    params: [{ key: 'extra', label: 'Spare beds', type: 'int', default: 2, min: 1, max: 20 }],
    apply(g, goal, ctx) {
      const target = mine(g).length + goal.params.extra;
      if (target > ctx.housingTarget) { ctx.housingTarget = target; ctx.housingGoal = goal.id; ctx.housingUrgency = Math.max(ctx.housingUrgency, 0.9 * prioMult(goal)); }
    },
    evaluate(g, goal, plan) {
      const target = mine(g).length + goal.params.extra;
      return { progress: Math.min(1, plan.bedsBuilt / target), done: plan.bedsBuilt >= target, text: `${plan.bedsBuilt}/${target} beds in finished homes`, detail: plan.housingNote };
    },
  },
  'core:equip_role': {
    name: 'Equip every worker of a type with a tool',
    kind: 'ongoing',
    params: [
      { key: 'workType', label: 'Workers', type: 'workType', default: 'core:mine' },
      { key: 'item', label: 'Tool', type: 'item', default: 'core:stone_pickaxe' },
    ],
    apply(g, goal, ctx) { ctx.roleTools[goal.params.workType] = { item: goal.params.item, urgency: 0.95 * prioMult(goal), goal: goal.id }; },
    evaluate(g, goal) {
      const wt = g.reg.get('workType', goal.params.workType)?.name || goal.params.workType;
      const workers = mine(g).filter((c) => roleOf(g, c) === goal.params.workType);
      const ok = workers.filter((c) => c.equip.tool?.item === goal.params.item);
      if (!workers.length) return { progress: 1, done: true, text: `No colonist currently specialises in ${wt}` };
      return { progress: ok.length / workers.length, done: ok.length === workers.length, text: `${ok.length}/${workers.length} ${wt} specialists carry a ${itemName(g, goal.params.item)}` };
    },
  },
  'core:spare_items': {
    name: 'Keep spare items in storage',
    kind: 'ongoing',
    params: [
      { key: 'item', label: 'Item', type: 'item', default: 'core:stone_axe' },
      { key: 'count', label: 'Spares', type: 'int', default: 2, min: 1, max: 100 },
    ],
    apply(g, goal, ctx) {
      ctx.spares.push({ item: goal.params.item, qty: goal.params.count, urgency: 0.6 * prioMult(goal), why: `Goal: keep ${goal.params.count} spare ${itemName(g, goal.params.item)}`, goal: goal.id });
    },
    evaluate(g, goal, plan) {
      const have = plan.stock[goal.params.item] || 0;
      return { progress: Math.min(1, have / goal.params.count), done: have >= goal.params.count, text: `${have}/${goal.params.count} spare ${itemName(g, goal.params.item)} in storage` };
    },
  },
  'core:build_count': {
    name: 'Build a number of a building',
    kind: 'once',
    params: [
      { key: 'building', label: 'Building', type: 'building', default: 'core:workbench' },
      { key: 'count', label: 'How many in total', type: 'int', default: 2, min: 1, max: 50 },
    ],
    apply(g, goal, ctx) { ctx.buildCounts.push({ building: goal.params.building, count: goal.params.count, urgency: 0.75 * prioMult(goal), goal: goal.id }); },
    evaluate(g, goal, plan) {
      const b = plan.buildInfo?.[goal.id] || countBuildings(g, g.s.playerSettlement, goal.params.building);
      const name = g.reg.get('building', goal.params.building)?.name || goal.params.building;
      return { progress: Math.min(1, b.built / goal.params.count), done: b.built >= goal.params.count, text: `${b.built}/${goal.params.count} ${name} completed${b.inflight ? ` · ${b.inflight} under construction` : ''}` };
    },
  },
  'core:advance_era': {
    name: 'Advance to an era',
    kind: 'once',
    params: [{ key: 'era', label: 'Era', type: 'era', default: '' }],
    apply(g, goal, ctx) { ctx.eraGoals.push({ era: goal.params.era, urgency: 0.75 * prioMult(goal), goal: goal.id }); },
    evaluate(g, goal) {
      const sid = g.s.playerSettlement;
      const r = g.s.settlements[sid].research;
      const order = (id) => g.reg.get('era', id)?.order ?? -1;
      const target = g.reg.get('era', goal.params.era);
      if (!target) return { progress: 0, done: false, text: `Unknown era "${goal.params.era}"` };
      if (order(r.era) >= target.order) return { progress: 1, done: true, text: `${target.name} reached` };
      const next = g.reg.idx.eras.find((e) => e.order === order(r.era) + 1);
      const ms = milestoneStatus(g, sid, next);
      const met = ms.filter((m) => m.ok).length;
      const steps = target.order - order(r.era);
      return { progress: ms.length ? (met / ms.length) / steps : 0, done: false, text: `Next: ${next.name} — ${met}/${ms.length} milestones: ${ms.map((m) => `${m.text} (${Math.min(m.have, m.need)}/${m.need})`).join('; ')}${steps > 1 ? ` · then ${steps - 1} more era(s)` : ''}` };
    },
  },
  'core:arm_guards': {
    name: 'Arm guards with a weapon',
    kind: 'ongoing',
    params: [
      { key: 'count', label: 'Guards', type: 'int', default: 2, min: 1, max: 50 },
      { key: 'item', label: 'Weapon', type: 'item', default: 'core:spear', filter: 'weapon' },
    ],
    apply(g, goal, ctx) { ctx.guards = { count: goal.params.count, item: goal.params.item, urgency: 0.8 * prioMult(goal), goal: goal.id }; },
    evaluate(g, goal) {
      const n = Math.min(goal.params.count, mine(g).length);
      const ok = Math.min(n, mine(g).filter((c) => c.equip.weapon?.item === goal.params.item).length);
      return { progress: n ? ok / n : 1, done: ok >= n, text: `${ok}/${n} guards carry a ${itemName(g, goal.params.item)}` };
    },
  },
  'core:arm_colonists': {
    name: 'Arm every colonist',
    kind: 'ongoing',
    params: [],
    apply(g, goal, ctx) { ctx.armAll = true; ctx.armUrgency = 0.7 * prioMult(goal); ctx.armGoal = goal.id; },
    evaluate(g) {
      const cols = mine(g);
      const ok = cols.filter((c) => c.equip.weapon);
      return { progress: cols.length ? ok.length / cols.length : 1, done: ok.length === cols.length, text: `${ok.length}/${cols.length} colonists carry a weapon` };
    },
  },
};

export function goalIsOngoing(goal) {
  const t = GOAL_TYPES[goal.type];
  if (!t) return false;
  return t.isOngoing ? t.isOngoing(goal) : t.kind === 'ongoing';
}

export function addGoal(g, type, params = {}, priority = 2) {
  const t = GOAL_TYPES[type];
  if (!t) throw new Error(`Unknown goal type ${type}`);
  const p = {};
  for (const spec of t.params) p[spec.key] = params[spec.key] ?? spec.default;
  const goal = { id: g.newId('g'), type, params: p, priority, status: 'active', created: g.s.tick };
  g.s.goals.push(goal);
  g.log(`New goal: ${describeGoal(g, goal)}.`, 'goal');
  g.planDirty = true;
  return goal;
}

export function describeGoal(g, goal) {
  const t = GOAL_TYPES[goal.type];
  if (!t) return `Unknown goal (${goal.type})`;
  const p = goal.params || {};
  switch (goal.type) {
    case 'core:maintain_meals': return `Maintain at least ${p.count} prepared meals`;
    case 'core:food_days': return `Maintain enough food for ${p.days} days`;
    case 'core:stockpile': return `${p.ongoing ? 'Keep' : 'Stockpile'} ${p.count} ${itemName(g, p.item)}`;
    case 'core:expand_housing': return `Expand housing: ${p.extra} spare beds`;
    case 'core:equip_role': return `Equip every ${g.reg.get('workType', p.workType)?.name || p.workType} worker with a ${itemName(g, p.item)}`;
    case 'core:spare_items': return `Keep ${p.count} spare ${itemName(g, p.item)}`;
    case 'core:build_count': return `Build ${p.count} ${g.reg.get('building', p.building)?.name || p.building}${p.count === 1 ? '' : ' in total'}`;
    case 'core:advance_era': return `Advance to ${g.reg.get('era', p.era)?.name || p.era}`;
    case 'core:arm_guards': return `Arm ${p.count} guard${p.count === 1 ? '' : 's'} with a ${itemName(g, p.item)}`;
    default: return t.name;
  }
}

export { countBuildings } from './civic/needs.js';
import { countBuildings } from './civic/needs.js';

/** Pause or resume a goal. Paused goals steer nothing; their projects stay but lose the goal's urgency. */
export function setGoalPaused(g, id, paused) {
  const goal = g.s.goals.find((x) => x.id === id);
  if (!goal || goal.status === 'complete') return false;
  goal.status = paused ? 'paused' : 'active';
  g.planDirty = true;
  g.log(`Goal ${paused ? 'paused' : 'resumed'}: ${describeGoal(g, goal)}.`, 'goal');
  return true;
}

/** Remove a goal. Construction it started that has not begun (no materials delivered, nothing built) is cancelled. */
export function removeGoal(g, id) {
  const goal = g.s.goals.find((x) => x.id === id);
  if (!goal) return false;
  g.s.goals = g.s.goals.filter((x) => x.id !== id);
  for (const p of Object.values(g.s.projects)) {
    if (p.forGoal !== id || p.status !== 'active') continue;
    const parts = p.parts.map((pid) => g.s.structures[pid]).filter(Boolean);
    const started = parts.some((st) => st.built || (st.progress || 0) > 0 || Object.values(st.delivered || {}).some((q) => q > 0));
    if (!started) cancelProject(g, p, 'its goal was removed');
    else p.forGoal = null; // already under way: finish it rather than waste the work
  }
  g.planDirty = true;
  g.log(`Goal removed: ${describeGoal(g, goal)}.`, 'goal');
  return true;
}
