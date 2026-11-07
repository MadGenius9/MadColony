// The scale target (docs/proposals/scale-target.md): loops that went over everyone in the world for one village's
// people now use the village's index; these check they see the same people in the same order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays } from './cloud-helpers.js';
import { legRemaining } from '../src/sim/villages.js';

test('scale: g.villagers(sid) is the village\'s people in the order Object.values gives them, also after moves', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  runDays(g, 1);
  const [a, b] = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
  // Move someone from a to b (as a leaving family does): the index appends them, Object.values does not.
  const mover = g.owned('colonists', a)[0];
  g.ownDel('colonists', mover); mover.settlementId = b; g.ownAdd('colonists', mover);
  for (const sid of Object.keys(g.s.settlements)) {
    const old = Object.values(g.s.colonists).filter((c) => (c.settlementId || g.s.playerSettlement) === sid).map((c) => c.id);
    assert.deepEqual(g.villagers(sid).map((c) => c.id), old, sid);
  }
});

test('scale: a trade leg counts what its carriers hold, from the sending village', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  runDays(g, 1);
  const [a, b] = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
  const t = { id: 'trX', seller: a, buyer: b, legs: [{ from: a, to: b, item: 'core:wood', qty: 10, delivered: 2 }], status: 'active' };
  (g.s.trades ||= {})[t.id] = t;
  const c = g.owned('colonists', a)[0];
  const keep = c.job;
  c.job = { type: 'trade', tradeId: t.id, leg: 0, qty: 3 };
  assert.deepEqual(legRemaining(g, t, 0), { remaining: 5, inTransit: 3 });
  c.job = keep;
  assert.deepEqual(legRemaining(g, t, 0), { remaining: 8, inTransit: 0 });
  delete g.s.trades[t.id];
});
