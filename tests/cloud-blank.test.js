// World shaping, slice 3: the Blank world scenarios (no people at the start; the owner's answer 2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame, conservationErrors } from './cloud-helpers.js';
import { issueCommand, previewCommand } from '../src/sim/god.js';
import { peopleCensus } from '../src/sim/godspawn.js';

/** The first spot (rings round the landing spot, every other tile) where `count` settlers may found a village. */
function foundSpot(g, from = g.s.center, count = 5) {
  for (let r = 0; r < 120; r += 2) for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const a = { x: from.x + dx, y: from.y + dy, count, mode: 'found' };
    if (g.inB(a.x, a.y) && previewCommand(g, 'spawn', a).ok) return a;
  }
  return null;
}

test('blank: a generated world with no people runs, saves and loads; the first village founded is yours, a second is an AI village', () => {
  const g = newGame({ seed: 7, scenario: 'core:blank_generated', size: 'vast', sandbox: true });
  assert.equal(g.s.playerSettlement, null);
  assert.equal(Object.keys(g.s.settlements).length, 0);
  assert.equal(Object.keys(g.s.colonists).length, 0);
  assert.ok(Object.values(g.s.nodes).some((n) => n.def === 'core:pine'), 'the land is made: forests');
  runDays(g, 2);
  assert.ok(Object.keys(g.s.animals?.herds || {}).length > 0 && Object.keys(g.s.monsters?.lairs || {}).length > 0, 'animals and monsters live there');
  const b = loadGame(g.reg, serializeGame(g));
  runDays(g, 1); runDays(b, 1);
  assert.equal(stateText(b), stateText(g), 'an empty world saves and loads');
  const a = foundSpot(g);
  assert.ok(a, 'a spot to found the first village');
  assert.match(previewCommand(g, 'spawn', a).preview.effect, /your village/);
  issueCommand(g, 'spawn', a);
  g.tick();
  const sid = g.s.playerSettlement, v = g.s.settlements[sid];
  assert.ok(sid && v, 'the player has a village now');
  assert.equal(v.ai, undefined, 'it is not an AI village');
  assert.notEqual(v.detail, 'abstract', 'at full detail');
  assert.equal(g.owned('colonists', sid).length, 5);
  const far = foundSpot(g, { x: a.x + 60, y: a.y });
  assert.ok(far, 'a second spot');
  issueCommand(g, 'spawn', far);
  g.tick();
  const other = Object.keys(g.s.settlements).find((k) => k !== sid);
  assert.equal(g.s.settlements[other].ai, true, 'the second village is run by the AI');
  assert.equal(g.s.playerSettlement, sid, 'the player keeps the first');
  runDays(g, 3);
  const c = reload(g);
  runDays(g, 1); runDays(c, 1);
  assert.equal(stateText(c), stateText(g), 'identical after a load with villages');
  assert.ok(peopleCensus(g, 0).ok, JSON.stringify(peopleCensus(g, 0).problems));
  assert.deepEqual(conservationErrors(g), []);
});

test('blank: the ocean world is mostly water; a meteor before anyone lives there still leaves a valid save; land raised from the sea can be settled', () => {
  const g = newGame({ seed: 7, scenario: 'core:blank_ocean', size: 'vast', sandbox: true });
  let land = 0, all = 0;
  for (let y = 0; y < g.H; y += 8) for (let x = 0; x < g.W; x += 8) { all++; const t = g.terrainAt(x, y); if (t.passable && !t.drinkable) land++; }
  assert.ok(land / all < 0.2, `mostly water (${Math.round((100 * land) / all)}% land)`);
  g.tick();
  const c = g.s.center;
  let hit = null;
  for (let r = 0; r < 60 && !hit; r++) for (let dx = -r; dx <= r && !hit; dx++) { const x = c.x + dx, y = c.y + r; if (g.inB(x, y) && g.isPassable(x, y) && previewCommand(g, 'meteor', { x, y, confirm: true }).ok) hit = { x, y }; }
  if (hit) { assert.equal(issueCommand(g, 'meteor', { ...hit, confirm: true }).ok, true); g.tick(); }
  const text = serializeGame(g);
  assert.doesNotThrow(() => loadGame(g.reg, text), 'the save is valid with ownerless goods and no village');
  // Raise an island out of the sea, then found a village on it.
  let sea = null;
  for (let y = 40; y < g.H - 40 && !sea; y += 16) for (let x = 40; x < g.W - 40 && !sea; x += 16) {
    let wet = true;
    for (let dy = -10; dy <= 10 && wet; dy += 5) for (let dx = -10; dx <= 10 && wet; dx += 5) if (!g.terrainAt(x + dx, y + dy).drinkable && g.terrainAt(x + dx, y + dy).id !== 'core:deep_water') wet = false;
    if (wet) sea = { x, y };
  }
  assert.ok(sea, 'open sea');
  const dry = () => { const t = g.terrainAt(sea.x, sea.y); return t.passable && !t.drinkable && t.id !== 'core:shallows'; };
  for (let k = 0; k < 6 && !dry(); k++) { issueCommand(g, 'shape', { brush: 'raise', ...sea, r: 8 }); g.tick(); } // until it is dry land
  assert.ok(g.terrainAt(sea.x, sea.y).passable && !g.terrainAt(sea.x, sea.y).drinkable, `an island rose (${g.terrainAt(sea.x, sea.y).id})`);
  const a = foundSpot(g, sea, 3);
  assert.ok(a, 'settlers may found a village on the new island');
  issueCommand(g, 'spawn', a);
  g.tick();
  assert.ok(g.s.playerSettlement, 'the player\'s village');
  runDays(g, 1);
  assert.deepEqual(conservationErrors(g), []);
});
