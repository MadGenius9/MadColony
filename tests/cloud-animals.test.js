// Phase 8, slice 1: species and far herds (animals.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame, conservationErrors } from './cloud-helpers.js';
import { herdCensus, animalSpecies } from '../src/sim/animals.js';
import { readAllMods } from '../tools/fsmods.js';
import { buildRegistry } from '../src/sim/content/modloader.js';

test('every game has herds, placed on their ground away from villages; the world itself is unchanged', () => {
  const g = newGame({ seed: 4242 });
  const nodes = JSON.stringify(g.s.nodes);
  g.tick();
  const herds = Object.values(g.s.animals.herds);
  assert.ok(herds.length > 0, 'herds placed');
  for (const h of herds) {
    const d = g.reg.get('animal', h.sp);
    assert.ok(d.terrains.includes(g.terrainAt(g.i(h.x, h.y))), 'on its ground');
    assert.ok(h.n >= d.herd[0] && h.n <= d.herd[1], 'a herd of its size');
    for (const v of Object.values(g.s.settlements)) assert.ok(Math.hypot(v.center.x - h.x, v.center.y - h.y) >= 24, 'away from villages');
  }
  assert.equal(JSON.stringify(g.s.nodes), nodes, 'placing herds changes nothing else');
});

test('herds live through a year: they move, breed in spring, lose some in winter, stay within limits; saves identical', () => {
  const run = (cut) => {
    let g = newGame({ seed: 4242 });
    for (let d = 1; d <= 40; d++) { runDays(g, 1); if (cut.includes(d)) g = reload(g); }
    return g;
  };
  const g = run([]);
  const c = herdCensus(g);
  assert.ok(c['core:deer']?.animals > 0, 'deer survive a year');
  for (const h of Object.values(g.s.animals.herds)) assert.ok(h.n >= 2 && h.n <= g.reg.get('animal', h.sp).herd[1] * 1.5, 'herd sizes within limits');
  assert.equal(stateText(run([7, 25])), stateText(g), 'save and load mid-year: identical');
  assert.deepEqual(conservationErrors(g), []);
});

test('a scenario can turn animals off; a malformed herd is refused; an older save gets herds at the next tick', () => {
  const mods = readAllMods(), core = mods.find((m) => m.manifest.id === 'core');
  for (const sc of core.files['content/setup.json'].scenario) if (sc.id === 'core:standard') sc.animals = { species: [] };
  const registry = buildRegistry(mods, ['core']).registry;
  const off = newGame({ seed: 4242, registry, scenario: 'core:standard' });
  runDays(off, 1);
  assert.equal(animalSpecies(off).length, 0);
  assert.equal(off.s.animals, undefined);
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const text = serializeGame(g);
  const bad = JSON.parse(text);
  Object.values(bad.state.animals.herds)[0].n = -3;
  assert.throws(() => loadGame(g.reg, JSON.stringify(bad)), /herd/);
  const old = JSON.parse(text);
  old.saveFormat = 26; delete old.state.animals;
  const h = loadGame(g.reg, JSON.stringify(old));
  assert.equal(h.s.animals, undefined);
  h.tick();
  assert.ok(Object.keys(h.s.animals.herds).length > 0, 'herds placed at the next tick');
});

test('far herds on the Vast world: packs eat deer, herds stay on their landmass, numbers stay bounded', () => {
  const g = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast' });
  runDays(g, 1);
  const start = herdCensus(g);
  assert.ok(start['core:wolf']?.herds > 0 && start['core:deer']?.herds > 0 && start['core:wild_horse']?.herds > 0, JSON.stringify(start));
  runDays(g, 20);
  const now = herdCensus(g);
  for (const sp of Object.keys(start)) {
    assert.ok(now[sp]?.animals > 0, `${sp} survive`);
    assert.ok(now[sp].animals < start[sp].animals * 2.5, `${sp} do not explode`);
  }
});
