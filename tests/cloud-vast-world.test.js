// The vast world scenario (Phase 2b): planet worlds, settlements far apart on one landmass, organic territory,
// contact over distance, level of detail, and save/load continuity on a big world.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, firstDifference, conservationErrors, closestPair } from './cloud-helpers.js';
import { sameLandmass, metPairs, discoveredCount } from '../src/sim/contact.js';
import { landInfo } from '../src/sim/territory.js';

const VAST = { seed: 7, scenario: 'core:vast_world', size: 'vast' };
let g, areas0, areas3;

before(() => {
  g = newGame(VAST);
  runDays(g, 1);
  areas0 = Object.keys(g.s.settlements).map((sid) => landInfo(g, sid).area);
  runDays(g, 2);
  areas3 = Object.keys(g.s.settlements).map((sid) => landInfo(g, sid).area);
  runDays(g, 3); // day 6
});

test('Vast preset: a 1536×1152 planet with the player and 6 AI villages', () => {
  assert.equal(g.W, 1536);
  assert.equal(g.H, 1152);
  assert.equal(g.big, true);
  const st = Object.values(g.s.settlements);
  assert.equal(st.length, 7);
  assert.equal(st.filter((x) => x.ai).length, 6);
  assert.ok(g.s.settlements[g.s.playerSettlement], 'the player has a village');
});

test('starting villages are far apart (spacing max(120, 0.1 × √(W×H))) and share one landmass', () => {
  const spacing = Math.max(120, Math.round(0.1 * Math.sqrt(g.W * g.H)));
  assert.equal(spacing, 133);
  assert.ok(closestPair(g) >= spacing, `closest pair ${closestPair(g).toFixed(1)} >= ${spacing}`);
  const p = g.s.playerSettlement;
  for (const sid of Object.keys(g.s.settlements)) assert.ok(sameLandmass(g, p, sid), `${sid} is on the player's landmass`);
});

test('organic territory: every village has land, and it grows outward day by day', () => {
  assert.ok(areas0.every((a) => a > 0), `land on day 1: ${areas0}`);
  for (let i = 0; i < areas0.length; i++) assert.ok(areas3[i] > areas0[i], `village ${i} grew: ${areas0[i]} → ${areas3[i]}`);
});

test('contact over distance: explorers discover land and some villages meet by day 6', () => {
  const ids = Object.keys(g.s.settlements);
  assert.ok(ids.every((sid) => discoveredCount(g, sid) > 9), 'every village discovered more than its first sight');
  const m = metPairs(g);
  assert.ok(m.pairs >= 1, `pairs met: ${m.pairs}`);
  assert.equal(m.byCause.unknown, 0, 'every meeting has a recorded cause');
  assert.ok(g.s.contact.met.explorers >= 1, 'at least one meeting came from explorers');
});

test('level of detail: far villages run abstract, the player runs in full', () => {
  const st = Object.values(g.s.settlements);
  assert.notEqual(g.s.settlements[g.s.playerSettlement].detail, 'abstract');
  assert.ok(st.some((x) => x.detail === 'abstract'), 'some far village is simulated at a distance');
});

test('conservation holds on the vast world after 6 days', () => {
  assert.deepEqual(conservationErrors(g), []);
});

test('vast world saved on day 6 continues identically for 2 more days', () => {
  let b = reload(g);
  runDays(g, 2);
  runDays(b, 2);
  const ta = stateText(g), tb = stateText(b);
  assert.equal(firstDifference(ta, tb), null);
  assert.equal(ta, tb);
});

test('World preset (2048×1536): the default scenario places 7 villages at least 177 tiles apart', () => {
  const w = newGame({ seed: 7, scenario: 'core:vast_world' });
  assert.equal(w.W, 2048);
  assert.equal(w.H, 1536);
  assert.equal(Object.keys(w.s.settlements).length, 7);
  assert.ok(closestPair(w) >= 177, `closest pair ${closestPair(w).toFixed(1)}`);
});
