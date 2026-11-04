// Spreading the hourly and daily peaks (docs/proposals/spread-the-peaks.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload } from './cloud-helpers.js';
import { moodSlot, moodTarget } from '../src/sim/mood.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../src/sim/constants.js';

test('spread: each person\'s mood steps once an hour, at their own tick of it', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const c = g.colonists()[0], slot = moodSlot(c.id);
  assert.ok(slot >= 0 && slot < TICKS_PER_HOUR);
  while (g.s.tick % TICKS_PER_HOUR !== 0) g.tick();
  const steps = [];
  for (let t = 0; t < 2 * TICKS_PER_HOUR; t++) {
    c.mood = moodTarget(g, c) - 40; // far from its target: every step shows
    const before = c.mood;
    g.tick(); // advances the tick, then does its work
    if (c.mood !== before) steps.push(g.s.tick % TICKS_PER_HOUR);
  }
  assert.deepEqual(steps, [slot, slot], 'twice in two hours, at its slot');
});

test('spread: the day-start jobs run one a tick, in order, once a day', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  runDays(g, 1);
  const seen = [];
  while (g.s.tick % TICKS_PER_DAY !== TICKS_PER_DAY - 1) g.tick(); // the next tick is the day's first
  g._dayTimes = {};
  for (let t = 0; t < 30; t++) { // 23 day-start jobs since Phase 10 and forestry (one a tick): all within the first 30 ticks
    const before = Object.keys(g._dayTimes).length;
    g.tick();
    const keys = Object.keys(g._dayTimes);
    if (keys.length > before) seen.push([g.s.tick % TICKS_PER_DAY, keys.at(-1)]);
  }
  assert.deepEqual(seen.slice(0, 3), [[0, 'tickFounding'], [1, 'tickKingdoms'], [2, 'tickTithes']]);
  assert.ok(seen.every(([t], i) => i === 0 || t > seen[i - 1][0]), 'one a tick, in order');
  assert.ok(seen.at(-1)[0] < 30);
  const once = { ...g._dayTimes };
  for (let t = 0; t < TICKS_PER_DAY - 40; t++) g.tick();
  assert.deepEqual(Object.keys(g._dayTimes), Object.keys(once), 'nothing more the rest of the day');
});

test('spread: saving in the middle of the hour and of the day-start jobs loads the same game', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  runDays(g, 1);
  while (g.s.tick % TICKS_PER_DAY !== 5) g.tick(); // inside the day-start jobs
  const r = reload(g);
  for (let t = 0; t < 150; t++) { g.tick(); r.tick(); } // through them and half an hour on
  assert.equal(stateText(r), stateText(g));
  const r2 = reload(g);
  runDays(g, 1); runDays(r2, 1);
  assert.equal(stateText(r2), stateText(g));
});
