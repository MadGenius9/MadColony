// Villages simulated at a distance treat their sick and wounded from their own supplies, as a doctor there would
// (medical.js treatFar, from lod.js abstractHour; Phase 16 balance, 2026-11-06). Before, they never used the medicine
// they held, and an epidemic killed there what it did not kill in villages simulated in full.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, conservationErrors } from './cloud-helpers.js';
import { infect } from '../src/sim/illness.js';
import { abstractHour } from '../src/sim/lod.js';

function distantSick() {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', size: 'medium', villages: 2 });
  const a = Object.keys(g.s.settlements).find((x) => g.s.settlements[x].ai);
  const st = g.s.settlements[a];
  st.detail = 'abstract'; // as a distant village: nobody walks there
  const c = g.owned('colonists', a)[0];
  const inj = infect(g, c, g.reg.get('illness', 'core:grey_fever'), 'a test');
  assert.ok(inj, 'fell ill');
  return { g, a, st, c, inj };
}
const medicine = (g, sid) => Object.values(g.s.stacks).filter((s) => s.item === 'core:medicine' && s.settlement === sid).reduce((n, s) => n + s.qty, 0);

test('a distant village treats its sick with the medicine it holds, one dose a case', () => {
  const { g, a, st, inj } = distantSick();
  g.ledgerAdd('created', 'core:medicine', 2, 'test');
  g.placeItems('core:medicine', 2, st.center.x, st.center.y);
  for (const s of Object.values(g.s.stacks)) if (s.item === 'core:medicine') s.settlement = a;
  assert.equal(medicine(g, a), 2);
  abstractHour(g, a);
  assert.equal(inj.treated, true, 'treated');
  assert.equal(medicine(g, a), 1, 'one dose used');
  abstractHour(g, a);
  assert.equal(medicine(g, a), 1, 'no second dose for a treated case');
  assert.deepEqual(conservationErrors(g), []);
});

test('without medicine nobody is treated, and nothing is made up', () => {
  const { g, a, inj } = distantSick();
  abstractHour(g, a);
  assert.ok(!inj.treated);
  assert.deepEqual(conservationErrors(g), []);
});
