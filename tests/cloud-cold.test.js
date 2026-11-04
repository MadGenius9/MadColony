// Cold storage: cold slows spoiling (from the Ideas parking lot, 2026-11-04; src/sim/spoil.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, conservationErrors } from './cloud-helpers.js';
import { issueCommand } from '../src/sim/god.js';
import { coldFactor, keptAt, tickSpoil, COLD } from '../src/sim/spoil.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

test('cold: goods spoil at a tenth of their rate frozen, at four tenths when cool, else as before', () => {
  assert.equal(coldFactor(-5), COLD.frozen);
  assert.equal(coldFactor(COLD.freeze), COLD.frozen);
  assert.equal(coldFactor(5), COLD.cooled);
  assert.equal(coldFactor(COLD.cool + 0.1), 1);
});

test('cold: meat left out keeps far longer in an endless winter than in an endless summer', () => {
  const left = (season) => {
    const g = newGame({ seed: 4242, sandbox: true });
    runDays(g, 1);
    const r = issueCommand(g, 'law', { law: 'core:season', value: season }); assert.equal(r.ok, true, r.reason); g.tick();
    const c = g.s.settlements[g.s.playerSettlement].center;
    // A spot away from the village, outdoors, where nobody takes it: the spoiling is counted on it alone.
    const x = c.x + 18, y = c.y + 18;
    g.ledgerAdd('created', 'core:venison', 60, 'test');
    const st = g.addStack('core:venison', 60, x, y);
    assert.equal(g.s.stacks[st.id]?.qty ?? st.qty, 60);
    for (let d = 0; d < 6; d++) { g.s.tick += TICKS_PER_DAY; tickSpoil(g); }
    assert.deepEqual(conservationErrors(g), []);
    return { qty: g.s.stacks[st.id]?.qty || 0, temp: keptAt(g, x, y) };
  };
  const w = left('winter'), s = left('summer');
  assert.ok(w.temp <= COLD.freeze && s.temp > COLD.cool, `winter ${w.temp} °C, summer ${s.temp} °C`);
  assert.ok(w.qty > s.qty + 15, `kept in winter ${w.qty}, in summer ${s.qty}`);
});
