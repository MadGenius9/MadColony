// Civic intents: why a settlement wants something built. An intent is derived afresh on every plan from the
// settlement's needs (population, recipes, goals, era milestones); nothing about it is saved except the
// blocker cache in state.civic. Intents are only *decisions*: the existing construction projects, hauling
// and build jobs carry them out (src/sim/construction.js, src/sim/ai/givers.js).
//
// {
//   id         stable key: 'housing', 'station:<building id>' or 'utility:<lamp|tap>'
//   sid        settlement
//   kind       'home' | 'station' | 'utility'
//   building   building id for stations and utilities (null for homes)
//   target     how many are wanted in total (completed ones count toward it)
//   completed  how many are finished
//   inFlight   how many are planned or under construction (counted against duplicates, not toward targets)
//   need       max(0, target − completed − inFlight)
//   priority   highest urgency among its sources
//   sources    [{ kind: 'population'|'goal'|'milestone'|'recipe'|'service', why, goal? }]
//   dependencies [{ kind: 'research'|'template'|'space'|'material', ref, ok, why }]
//   blocked    null, or { kind: 'research'|'template'|'space'|'wait', reason } — shown to the player
// }
// Utilities (lamps, taps) are single buildings placed *near* something that lacks one. They also carry:
//   template   template id to place
//   near       [{ x, y, r, name, pen }] targets in the order they should be served (search radius r,
//              penalty pen for a spot right beside the target); the first target with a free spot is used
//   cover      a new utility serves every remaining target within this distance (tiles)
//   label      'an electric lamp', for blocker reasons; whyText / logText: project reason and log line,
//              with {name} replaced by the target served
//   sig        the targets' positions, so a cached 'no free spot' is dropped when the targets change
// Utilities always come after homes and stations in commitment order (orderedIntents).

export function makeIntent(id, sid, kind, building = null) {
  return { id, sid, kind, building, target: 0, completed: 0, inFlight: 0, need: 0, priority: 0, sources: [], dependencies: [], blocked: null, goal: null, forGoal: null };
}

/** The intents of one plan, keyed by id (kept on the plan as P.intents). */
export function intentsOf(P) { return (P.intents ||= new Map()); }

/** Add a reason for an intent; the largest target and the highest priority win. */
export function addSource(intent, src, target, priority) {
  intent.sources.push(src);
  intent.target = Math.max(intent.target, target);
  if (priority > intent.priority) intent.priority = priority;
  if (src.goal && !intent.goal) intent.goal = src.goal;
  if (src.forGoal && !intent.forGoal) intent.forGoal = src.forGoal;
}

const rank = (it) => (it.kind === 'utility' ? 1 : 0); // utilities (lamps, taps) go last

/** Intents in commitment order: homes and stations before utilities, then highest priority first, then by id (stable across runs). */
export function orderedIntents(P) {
  return [...intentsOf(P).values()].sort((a, b) => rank(a) - rank(b) || b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
