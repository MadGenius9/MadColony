// Lasting injuries and surgery (Phase 5, slice 4): a deep wound (severity >= MED.scarAt) that heals without surgery
// leaves a lasting injury that slows some work; surgery (dressing it in a medical bed) mends it by chance from skill.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame, TICKS_PER_DAY } from './cloud-helpers.js';
import { injure } from '../src/sim/health.js';
import { MED, LASTING, scarFrom, lastingFactor, surgery } from '../src/sim/medical.js';
import { workSpeed } from '../src/sim/ai/jobs.js';

test('deep wounds are marked; small ones are not', () => {
  const g = newGame({ seed: 4242 });
  const c = g.colonists()[0];
  assert.equal(injure(g, c, 'wound', MED.scarAt - 1, 'A cut').deep, undefined);
  assert.equal(injure(g, c, 'wound', MED.scarAt, 'A deep cut').deep, true);
  assert.equal(injure(g, c, 'malnutrition', 40, 'Starving', true).deep, undefined, 'conditions are never deep');
});

test('a deep wound that heals without surgery leaves a lasting injury that slows work', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const c = g.colonists()[0];
  injure(g, c, 'wound', 40, 'Gored by a boar');
  runDays(g, 4);
  assert.equal(c.health.injuries.length, 0, 'the wound has healed');
  assert.equal(c.lasting?.length, 1, 'it left a lasting injury');
  const L = LASTING.find((l) => l.kind === c.lasting[0].kind);
  const [wt, f] = Object.entries(L.work)[0];
  assert.equal(lastingFactor(c, wt), f);
  const keep = c.lasting; c.lasting = undefined;
  const healthy = workSpeed(g, c, wt, null);
  c.lasting = keep;
  assert.ok(Math.abs(workSpeed(g, c, wt, null) - healthy * f) < 1e-9);
  assert.equal(lastingFactor(c, 'core:care'), 1, 'other work is not slowed');
  assert.ok(g.s.log.some((e) => /healed badly/.test(e.msg)));
});

test('a mended wound (surgery) leaves nothing; the same lasting injury is not added twice', () => {
  const g = newGame({ seed: 4242 });
  const c = g.colonists()[0];
  const a = injure(g, c, 'wound', 50, 'Hit');
  a.mended = true;
  assert.equal(scarFrom(g, c, a), null);
  const b = injure(g, c, 'wound', 50, 'Hit again');
  assert.ok(scarFrom(g, c, b));
  assert.equal(scarFrom(g, c, { ...b }), null, 'once per kind');
});

test('saves: lasting injuries load back identically; malformed ones are refused', () => {
  let g = newGame({ seed: 4242 });
  runDays(g, 1);
  injure(g, g.colonists()[1], 'wound', 45, 'Hit by a falling log');
  const a = newGame({ seed: 4242 }); runDays(a, 1); injure(a, a.colonists()[1], 'wound', 45, 'Hit by a falling log');
  runDays(a, 3);
  g.step(TICKS_PER_DAY); g = reload(g); g.step(2 * TICKS_PER_DAY);
  assert.equal(stateText(a), stateText(g));
  const bad = JSON.parse(serializeGame(a));
  const id = Object.keys(bad.state.colonists).find((k) => bad.state.colonists[k].lasting);
  assert.ok(id, 'someone has a lasting injury');
  bad.state.colonists[id].lasting = [{ kind: 5 }];
  assert.throws(() => loadGame(a.reg, JSON.stringify(bad)), /lasting/);
});

test('surgery mends by chance from the doctor\'s skill, the same way every time', () => {
  const g = newGame({ seed: 4242 });
  const [doc, p] = g.colonists();
  doc.skills['core:medicine'] = 10; // chance 0.95
  let mended = 0;
  for (let k = 0; k < 40; k++) { const i = injure(g, p, 'wound', 40, `Cut ${k}`); surgery(g, doc, p, i); mended += i.mended ? 1 : 0; }
  assert.ok(mended >= 32, `a skilled surgeon mends most wounds (${mended}/40)`);
  doc.skills['core:medicine'] = 0; // chance 0.45
  let low = 0;
  for (let k = 0; k < 40; k++) { const i = injure(g, p, 'wound', 40, `Gash ${k}`); surgery(g, doc, p, i); low += i.mended ? 1 : 0; }
  assert.ok(low < mended, `an unskilled one fewer (${low}/40)`);
  assert.ok(g.s.log.some((e) => /operated on/.test(e.msg)));
});
