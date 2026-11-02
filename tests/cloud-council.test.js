// Phase 6, slice 2: the village council (docs/proposals/phase-6-government.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame } from './cloud-helpers.js';
import { councilReview, councilAdvice, COUNCIL } from '../src/sim/council.js';
import { addMemory } from '../src/sim/memories.js';
import { chainOf } from '../src/sim/chronicle.js';

const setup = () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  runDays(g, 1);
  const [a, b] = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
  return { g, a, b };
};

test('council: a famine remembered raises the food reserve, with the reason and its cause; bounded', () => {
  const { g, a, b } = setup();
  const base = g.policyFor(a).foodDays;
  const profilePolicy = JSON.stringify(g.reg.get('villageProfile', g.s.settlements[a].profile)?.policy);
  const ev = g.log('A famine.', 'info', null, 0, { kind: 'core:memory', sids: [a] });
  addMemory(g, a, 'core:famine_survived', ev);
  g.plans[a].foodDays = 6;
  const steps = councilReview(g, a);
  assert.equal(steps.length >= 1, true);
  assert.equal(g.policyFor(a).foodDays, base + 1);
  const line = g.s.log.find((e) => e.kind === 'core:policy');
  assert.match(line.msg, /The council of .* decided to keep food for \d+ days \(was \d+\): they remember the famine/);
  assert.equal(line.cause, ev);
  assert.ok(chainOf(g, line.id).back.some((x) => x.event.id === ev));
  // The profile's own policy is untouched, and so is another village of it.
  assert.equal(JSON.stringify(g.reg.get('villageProfile', g.s.settlements[a].profile)?.policy), profilePolicy);
  assert.notEqual(g.s.settlements[b].policy, g.s.settlements[a].policy);
  for (let i = 0; i < 20; i++) councilReview(g, a);
  assert.equal(g.policyFor(a).foodDays, COUNCIL.food.max, 'never above the bound');
});

test('council: plenty twice in a row brings the reserve back down toward the profile\'s', () => {
  const { g, a } = setup();
  g.plans[a].foodDays = 1;
  councilReview(g, a); // short: up one
  const up = g.policyFor(a).foodDays;
  g.plans[a].foodDays = 2 * up + 5;
  councilReview(g, a);
  assert.equal(g.policyFor(a).foodDays, up, 'one review of plenty: not yet');
  const n = g.s.log.length;
  councilReview(g, a);
  assert.equal(g.policyFor(a).foodDays, up - 1, 'two in a row: down one');
  assert.ok(g.s.log.slice(n).some((e) => /keep food for .*: food has been plentiful/.test(e.msg)), 'with its reason');
});

test('council: buildings waiting for wood raise the wood kept in store; the player\'s village only gets advice', () => {
  const { g, a } = setup();
  const t0 = g.policyFor(a).stock?.['core:wood'];
  assert.ok(t0 > 0, 'the profile keeps some wood');
  // An unfinished building of a that needs more wood than it holds.
  const p = Object.values(g.s.projects).find((x) => (x.owner || x.settlement) === a) || null;
  const site = g.s.settlements[a].center;
  const st = g.addStructure('core:log_wall', site.x + 5, site.y + 5, { settlement: a });
  g.s.projects.pX = { id: 'pX', status: 'active', parts: [st.id], settlement: a, owner: a };
  g.ownReset?.('projects');
  g.plans[a].stock = { ...(g.plans[a].stock || {}), 'core:wood': 0 };
  g.plans[a].foodDays = 6;
  const steps = councilReview(g, a);
  assert.ok(steps.some((x) => x.item === 'core:wood' && x.to > x.from), JSON.stringify(steps));
  assert.ok(g.policyFor(a).stock['core:wood'] > t0);
  // The player's village: advice, never a change.
  const me = g.s.playerSettlement, before = JSON.stringify(g.s.settlements[me].policy);
  g.plans[me].foodDays = 1;
  assert.ok(councilAdvice(g, me).some((x) => x.key === 'foodDays'));
  assert.deepEqual(councilReview(g, me), []);
  assert.equal(JSON.stringify(g.s.settlements[me].policy), before);
  assert.ok(p === null || p);
});

test('council: saves and loads; bad council state is refused', () => {
  const { g, a } = setup();
  g.plans[a].foodDays = 1;
  councilReview(g, a);
  const r = reload(g);
  runDays(g, 2); runDays(r, 2);
  assert.equal(stateText(r), stateText(g));
  const bad = JSON.parse(serializeGame(g));
  bad.state.settlements[a].council = { plentyFood: -1 };
  assert.throws(() => loadGame(g.reg, JSON.stringify(bad)), /council/);
});
