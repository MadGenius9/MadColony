// Phase 6, slice 3: rebellion (docs/proposals/phase-6-government.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload } from './cloud-helpers.js';
import { grievancesOf, grievanceScore, tickRebellion, REBEL } from '../src/sim/rebellion.js';
import { formKingdom } from '../src/sim/kingdoms.js';
import { relationOf } from '../src/sim/villages.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

const setup = () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  runDays(g, 1);
  const [a, b] = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
  if (!g.s.settlements[a].kingdom) formKingdom(g, a, b);
  const kid = g.s.settlements[a].kingdom, cap = g.s.kingdoms[kid].capital, m = cap === a ? b : a;
  return { g, kid, cap, m };
};

test('rebellion: grievances are listed from what the game records; under the threshold nothing happens', () => {
  const { g, kid, m } = setup();
  assert.equal(grievanceScore(grievancesOf(g, m)), 0);
  g.s.settlements[m].tithePaid = [g.s.tick - 2 * TICKS_PER_DAY];
  g.s.settlements[m].unrest = g.s.tick;
  const list = grievancesOf(g, m);
  assert.deepEqual(list.map((x) => x.why), ['1 tithe in 30 days', 'unrest']);
  assert.equal(grievanceScore(list), 3);
  tickRebellion(g);
  assert.equal(g.s.settlements[m].kingdom, kid, 'below the threshold: it stays');
});

test('rebellion: over the threshold the member rises, with its reasons; relations fall; not again within 20 days', () => {
  const { g, kid, cap, m } = setup();
  const st = g.s.settlements[m];
  st.tithePaid = [1, 2, 3].map((d) => g.s.tick - d * TICKS_PER_DAY);
  st.unrest = g.s.tick;
  const before = relationOf(g, m, cap).value;
  assert.ok(grievanceScore(grievancesOf(g, m)) >= REBEL.threshold);
  tickRebellion(g);
  assert.equal(st.kingdom, undefined, 'it left the kingdom');
  const e = g.s.log.find((x) => x.kind === 'core:rebellion');
  assert.match(e.msg, /rose against .*: 3 tithes in 30 days, unrest/);
  assert.ok(relationOf(g, m, cap).value < before);
  assert.equal(g.s.kingdoms[kid]?.rebelled ?? g.s.tick, g.s.tick);
  const r = reload(g);
  runDays(g, 1); runDays(r, 1);
  assert.equal(stateText(r), stateText(g));
});

test('rebellion: the player\'s village never rises on its own; the capital never does', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  runDays(g, 1);
  const me = g.s.playerSettlement, a = Object.keys(g.s.settlements).find((k) => g.s.settlements[k].ai);
  formKingdom(g, a, me);
  const kid = g.s.settlements[a].kingdom;
  assert.equal(g.s.settlements[me].kingdom, kid, 'the player\'s village is a member');
  const st = g.s.settlements[me];
  st.tithePaid = [1, 2, 3].map((d) => g.s.tick - d * TICKS_PER_DAY); st.unrest = g.s.tick;
  assert.ok(grievanceScore(grievancesOf(g, me)) >= REBEL.threshold, 'its grievances are shown');
  tickRebellion(g);
  assert.equal(st.kingdom, kid, 'but it does not rise');
  assert.deepEqual(grievancesOf(g, a), [], 'the capital has no grievances');
});
