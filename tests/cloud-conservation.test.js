// Conservation after long runs: every item that exists is accounted for by the ledger (created − consumed),
// reservations equal what jobs hold, and no need or position turns into NaN (ROADMAP "Rules for every phase").
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, conservationErrors, reservationErrors, badNumbers, reload } from './cloud-helpers.js';

function checkEvery(g, days, every, label) {
  runDays(g, days, (d) => {
    if (d % every) return;
    assert.deepEqual(conservationErrors(g), [], `${label}: ledger and census agree on day ${d}`);
    assert.deepEqual(reservationErrors(g), [], `${label}: reservations match the jobs on day ${d}`);
    assert.deepEqual(badNumbers(g), [], `${label}: needs and positions are numbers on day ${d}`);
  });
}

test('classic colony, 30 days: ledger, reservations and numbers hold every 5 days', () => {
  const g = newGame({ seed: 4242 });
  checkEvery(g, 30, 5, 'classic');
  const L = g.s.ledger.byReason;
  assert.ok(L['created:gather'] && L['consumed:construct'] && L['consumed:eat'], 'the colony gathered, built and ate');
  assert.equal(g.colonists().length >= 5, true, 'nobody vanished');
});

test('neighbours scenario, 15 days: conservation holds with trade between villages', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', size: 'medium', villages: 2 });
  checkEvery(g, 15, 5, 'neighbours');
  assert.ok(Object.keys(g.s.settlements).length >= 3);
});

test('conservation still holds after a save and load in the middle of a run', () => {
  let g = newGame({ seed: 11 });
  runDays(g, 6);
  g = reload(g);
  checkEvery(g, 6, 3, 'after load');
});

test('the ledger counts every item kind the census finds, and nothing is negative', () => {
  const g = newGame({ seed: 3 });
  runDays(g, 10);
  const census = g.census(), L = g.s.ledger;
  for (const [it, n] of Object.entries(census)) {
    assert.ok(n > 0, `${it} count is positive`);
    assert.ok((L.created[it] || 0) >= n, `${it} was created at least as often as it exists`);
  }
  for (const s of Object.values(g.s.stacks)) assert.ok(Number.isInteger(s.qty) && s.qty > 0, `stack ${s.id} has a positive whole quantity`);
});
