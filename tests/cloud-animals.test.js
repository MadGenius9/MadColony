// Phase 8, slice 1: species and far herds (animals.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame, conservationErrors } from './cloud-helpers.js';
import { herdCensus, animalSpecies, foldHerdForTest } from '../src/sim/animals.js';
import { issueCommand } from '../src/sim/god.js';
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

test('review fix: meteors near herds, then a save and load: the game continues identically', () => {
  const run = (cut) => {
    let g = newGame({ seed: 4242, sandbox: true });
    runDays(g, 2);
    for (const h of Object.values(g.s.animals.herds).slice(0, 4)) issueCommand(g, 'meteor', { x: h.x, y: h.y, confirm: true });
    g.tick();
    if (cut) g = reload(g);
    runDays(g, 30);
    return g;
  };
  assert.equal(stateText(run(true)), stateText(run(false)));
});

// ---------------- slice 2: near animals ----------------
/** A classic game with a deer herd and a wolf pack placed by hand beside the village (both become near). */
function wildGame() {
  const g = newGame({ seed: 4242 });
  g.tick();
  const c = g.s.settlements[g.s.playerSettlement].center, A = g.s.animals;
  for (const id of Object.keys(A.herds)) delete A.herds[id];
  const spot = (dx, dy) => { for (let r = 0; r < 10; r++) for (let k = -r; k <= r; k++) { const x = c.x + dx + k, y = c.y + dy + r; if (g.isPassable(x, y)) return { x, y }; } return { x: c.x, y: c.y }; };
  const day = Math.floor(g.s.tick / 2400);
  const deer = spot(-14, 8), wolf = spot(-20, 8);
  A.herds.h900 = { id: 'h900', sp: 'core:deer', x: deer.x, y: deer.y, n: 8, day, year: 0, next: g.s.tick, fed: day };
  A.herds.h901 = { id: 'h901', sp: 'core:wolf', x: wolf.x, y: wolf.y, n: 4, day, year: 0, next: g.s.tick, fed: day - 1 };
  A.next = 902;
  g._anIdx = null;
  return g;
}

test('near herds become animals and fold back with the same count; animals never block tiles', () => {
  const g = wildGame();
  while (g.s.tick % 600 !== 451) g.tick();
  const A = g.s.animals;
  assert.ok(A.herds.h900.near !== undefined, 'the deer are near');
  assert.equal(Object.values(A.list).filter((a) => a.herd === 'h900').length, 8);
  g.step(200);
  for (const a of Object.values(A.list)) assert.ok(g.isPassable(a.x, a.y), 'on walkable ground');
  assert.equal(stateText(reload(g)), stateText(g));
  // Folded back (as when people are far): the count is the living animals, the centre one of them.
  const live = Object.values(A.list).filter((a) => a.herd === 'h900');
  foldHerdForTest(g, 'h900');
  assert.equal(A.herds.h900.n, live.length);
  assert.ok(live.some((a) => a.x === A.herds.h900.x && a.y === A.herds.h900.y));
  assert.equal(Object.values(A.list || {}).filter((a) => a.herd === 'h900').length, 0);
  assert.equal(stateText(reload(g)), stateText(g));
});

test('grazers flee from people; wolves chase and kill deer near the village; all saved identically', () => {
  const run = (cut) => {
    let g = wildGame();
    while (g.s.tick % 600 !== 451) g.tick();
    const c = g.colonists()[0], deer = Object.values(g.s.animals.list).find((a) => a.herd === 'h900');
    c.x = deer.x + 2; c.y = deer.y; c.mv = null;
    let fled = false;
    for (let t = 0; t < 30; t++) { g.tick(); if (g.s.animals.herds.h900?.alarm > g.s.tick) fled = true; }
    assert.ok(fled, 'the herd ran from a person close by');
    for (let d = 0; d < 3; d++) { g.step(800); if (cut) g = reload(g); }
    return g;
  };
  const g = run(false);
  const deer = g.s.animals.herds.h900, pack = g.s.animals.herds.h901;
  assert.ok(!deer || deer.n < 8, 'the pack killed deer');
  assert.ok(pack && pack.fed >= Math.floor(g.s.tick / 2400) - 2, 'the pack ate in the last days');
  assert.equal(stateText(run(true)), stateText(g));
});

test('review fixes: two packs on one deer kill it once; a removed species takes its animals with it', () => {
  const g = wildGame();
  while (g.s.tick % 600 !== 451) g.tick();
  const A = g.s.animals;
  // A second pack beside the first: whatever they kill, the deer's count always matches its animals.
  const w = Object.values(A.list).find((a) => a.herd === 'h901');
  A.herds.h902 = { ...A.herds.h901, id: 'h902', n: 1 }; A.next = 903;
  A.list[`a${A.na}`] = { id: `a${A.na}`, herd: 'h902', x: w.x, y: w.y, hp: 40 }; A.na++;
  g._anNear = null; g._anIdx = null;
  for (let t = 0; t < 1200; t++) {
    g.tick();
    const h = A.herds.h900, live = Object.values(A.list || {}).filter((a) => a.herd === 'h900').length;
    if (h) assert.equal(live, h.n, 'the count is its animals');
    assert.ok(Object.values(A.list || {}).every((a) => A.herds[a.herd]?.near !== undefined), 'no animal without its herd');
  }
  assert.doesNotThrow(() => loadGame(g.reg, serializeGame(g)));
  // A species whose mod is gone: its herds and their animals go on load; the game saves again.
  const mods = readAllMods(), core = mods.find((m) => m.manifest.id === 'core');
  core.files['content/animals.json'].animal = core.files['content/animals.json'].animal.filter((d) => d.id !== 'core:wolf');
  const registry = buildRegistry(mods, ['core']).registry;
  const h = loadGame(registry, serializeGame(g));
  assert.ok(!Object.values(h.s.animals.herds).some((x) => x.sp === 'core:wolf'), 'the packs are gone');
  assert.ok(Object.values(h.s.animals.list || {}).every((a) => h.s.animals.herds[a.herd]), 'and their animals');
  h.tick();
  assert.doesNotThrow(() => loadGame(registry, serializeGame(h)));
});
