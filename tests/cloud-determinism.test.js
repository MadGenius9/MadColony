// Determinism: the same seed gives the same game, and a game saved and loaded continues exactly like the game
// that was never saved (ROADMAP "Rules for every phase"; README "Saves").
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, firstDifference, serializeGame, loadGame, TICKS_PER_DAY } from './cloud-helpers.js';

/** Run `days` straight, and again with a save and load after `saveAt` days; both must end identical. */
function continuesIdentically(opts, saveAt, days) {
  const a = newGame(opts);
  runDays(a, days);
  let b = newGame(opts);
  runDays(b, saveAt);
  b = reload(b);
  runDays(b, days - saveAt);
  const ta = stateText(a), tb = stateText(b);
  assert.equal(firstDifference(ta, tb), null, 'the first state key that differs');
  assert.equal(ta, tb);
  return a;
}

test('same seed, same game: two fresh runs of the classic colony are identical after 3 days', () => {
  const a = newGame({ seed: 4242 }), b = newGame({ seed: 4242 });
  runDays(a, 3); runDays(b, 3);
  assert.equal(stateText(a), stateText(b));
});

test('different seeds give different games', () => {
  const a = newGame({ seed: 1 }), b = newGame({ seed: 2 });
  runDays(a, 1); runDays(b, 1);
  assert.notEqual(stateText(a), stateText(b));
});

test('saving never changes the running game, and a save loads back to the same save', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 2);
  const before = serializeGame(g);
  assert.equal(serializeGame(g), before, 'saving twice gives the same text');
  const g2 = loadGame(g.reg, before);
  assert.equal(stateText(g2), stateText(g));
});

test('classic colony: saved on day 4, continues identically to day 8', () => {
  const g = continuesIdentically({ seed: 4242 }, 4, 8);
  assert.ok(g.s.tick === 8 * TICKS_PER_DAY);
});

test('neighbours scenario: saved on day 3, continues identically to day 6', () => {
  continuesIdentically({ seed: 7, scenario: 'core:neighbours', size: 'medium', villages: 2 }, 3, 6);
});

test('a save made mid-day (not at a day boundary) continues identically', () => {
  const opts = { seed: 99 };
  const a = newGame(opts);
  a.step(Math.round(2.37 * TICKS_PER_DAY));
  let b = newGame(opts);
  b.step(Math.round(1.11 * TICKS_PER_DAY));
  b = reload(b);
  b.step(Math.round(2.37 * TICKS_PER_DAY) - Math.round(1.11 * TICKS_PER_DAY));
  assert.equal(stateText(a), stateText(b));
});

test('save, load, save, load: two loads in a row still continue identically', () => {
  const opts = { seed: 5 };
  const a = newGame(opts);
  runDays(a, 4);
  let b = newGame(opts);
  runDays(b, 1); b = reload(b);
  runDays(b, 2); b = reload(b);
  runDays(b, 1);
  assert.equal(stateText(a), stateText(b));
});
