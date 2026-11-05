// Phase 18 slice 3: distant (abstract) villages plan at a slot spread over the whole planning cycle, still once a
// cycle and still on one of their own hours (docs/proposals/phase-18-sim-plan.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from './cloud-helpers.js';
import { LOD, stagger, abstractPlanSlot } from '../src/sim/lod.js';

test('the slot is one of the village\'s own hours, anywhere in the cycle, and spreads villages out', () => {
  const ids = Array.from({ length: 60 }, (_, k) => `t${k + 1}`);
  const per = new Map();
  for (const sid of ids) {
    const slot = abstractPlanSlot(sid);
    assert.ok(Number.isInteger(slot) && slot >= 0 && slot < LOD.checkEvery, `${sid}: ${slot}`);
    assert.equal(slot % LOD.hour, stagger(sid), 'on its own hour');
    per.set(slot, (per.get(slot) || 0) + 1);
  }
  const hours = new Set(ids.map((sid) => Math.floor(abstractPlanSlot(sid) / LOD.hour)));
  assert.ok(hours.size >= 4, `villages use ${hours.size} of the cycle's ${LOD.checkEvery / LOD.hour} hours`);
  assert.ok(Math.max(...per.values()) <= 3, 'no slot crowded');
});

test('on a big world every distant village plans once a cycle, at its slot', () => {
  const g = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast' });
  g.step(LOD.checkEvery + 10); // every village has a plan and the level-of-detail check has run
  const planned = new Map();
  for (let t = 0; t < LOD.checkEvery; t++) {
    g.tick();
    for (const [sid, p] of Object.entries(g.plans || {})) {
      if (p?.tick !== g.s.tick || g.s.settlements[sid]?.detail !== 'abstract') continue;
      (planned.get(sid) || planned.set(sid, []).get(sid)).push(g.s.tick);
    }
  }
  const abs = Object.keys(g.s.settlements).filter((sid) => g.s.settlements[sid].detail === 'abstract' && !g.s.settlements[sid].fallen);
  assert.ok(abs.length >= 3, `distant villages: ${abs.length}`);
  for (const sid of abs) {
    const ticks = planned.get(sid) || [];
    assert.equal(ticks.length, 1, `${sid} planned at ${JSON.stringify(ticks)}`);
    assert.equal(ticks[0] % LOD.checkEvery, abstractPlanSlot(sid));
  }
});
