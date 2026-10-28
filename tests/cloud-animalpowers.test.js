// Phase 8b: god powers that send animals (docs/proposals/phase-8b-animal-powers.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, conservationErrors } from './cloud-helpers.js';
import { issueCommand, previewCommand, favourNow } from '../src/sim/god.js';
import { animalCensus, herdCensus } from '../src/sim/animals.js';
import { readAllMods } from '../tools/fsmods.js';
import { buildRegistry } from '../src/sim/content/modloader.js';

/** A game a day old (herds placed). */
const ready = (opts = {}) => { const g = newGame({ seed: 4242, ...opts }); runDays(g, 1); return g; };

/** The first tile (row by row) passing ok, at least `from` tiles from the village centre (or at most, if negative). */
function tileWhere(g, ok, from = 0) {
  const c = g.s.center;
  for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
    const d = Math.hypot(x - c.x, y - c.y);
    if ((from >= 0 ? d >= from : d <= -from) && ok(g.terrainAt(x, y), x, y)) return { x, y };
  }
  return null;
}
const dryLand = (t) => t.passable && !t.drinkable;

test('8b animals: refused for water, off the map, unknown species, bad counts, extra keys, and join with no herd near', () => {
  const g = ready();
  const land = tileWhere(g, dryLand, -12), water = tileWhere(g, (t) => t.drinkable);
  const r = (a) => previewCommand(g, 'animals', a).reason;
  assert.match(r({ x: -1, y: 0, species: 'core:deer', count: 4 }), /tile on the map/);
  if (water) assert.match(r({ ...water, species: 'core:deer', count: 4 }), /dry land/);
  assert.match(r({ ...land, species: 'core:dragon', count: 4 }), /no such animal/);
  assert.match(r({ ...land, species: 'core:deer', count: 1 }), /send 2 to 12 deer/);
  assert.match(r({ ...land, species: 'core:deer', count: 13 }), /send 2 to 12/);
  assert.match(r({ ...land, species: 'core:deer', count: 4, mode: 'swarm' }), /mode/);
  assert.match(r({ ...land, species: 'core:deer', count: 4, colour: 'red' }), /only x, y, species/);
  for (const h of Object.values(g.s.animals.herds)) if (h.sp === 'core:wild_horse') delete g.s.animals.herds[h.id];
  g._anIdx = null;
  assert.match(r({ ...land, species: 'core:wild_horse', count: 1, mode: 'join' }), /no herd of wild horses within 12/);
});

test('8b animals: a scenario with animals off refuses the power', () => {
  const mods = readAllMods(), core = mods.find((m) => m.manifest.id === 'core');
  for (const sc of core.files['content/setup.json'].scenario) if (sc.id === 'core:standard') sc.animals = { species: [] };
  const g = newGame({ seed: 4242, registry: buildRegistry(mods, ['core']).registry, scenario: 'core:standard' });
  runDays(g, 1);
  assert.match(previewCommand(g, 'animals', { x: g.s.center.x, y: g.s.center.y, species: 'core:deer', count: 4 }).reason, /no such animal/);
});

test('8b animals: a herd sent near the village arrives as animals, costs favour, is counted as sent; saves replay identically', () => {
  const g = ready();
  const at = tileWhere(g, (t) => dryLand(t) && t.id === 'core:grass', -20) || tileWhere(g, dryLand, -20);
  const before = favourNow(g), herds = Object.keys(g.s.animals.herds).length;
  const p = previewCommand(g, 'animals', { ...at, species: 'core:deer', count: 6 });
  assert.equal(p.ok, true, p.reason);
  assert.equal(p.preview.cost, 12, 'deer cost 2 a head');
  assert.match(p.preview.effect, /6 deer appear at/);
  assert.equal(p.preview.near, true);
  assert.equal(issueCommand(g, 'animals', { ...at, species: 'core:deer', count: 6 }).ok, true);
  const queued = reload(g); // saved with the command waiting
  g.tick(); queued.tick();
  assert.equal(stateText(queued), stateText(g), 'the queued command replays identically after a load');
  const h = Object.values(g.s.animals.herds).find((x) => x.origin === 'divine');
  assert.ok(h, 'a herd sent by the gods');
  assert.equal(Object.keys(g.s.animals.herds).length, herds + 1);
  assert.deepEqual([h.sp, h.x, h.y, h.n, h.sent], ['core:deer', at.x, at.y, 6, g.s.tick]);
  assert.ok(h.near !== undefined, 'near the village: animals at once');
  assert.equal(Object.values(g.s.animals.list).filter((a) => a.herd === h.id).length, 6);
  assert.equal(g.s.animals.ledger['core:deer'].sent, 6);
  assert.ok(Math.abs(favourNow(g) - (before - 12)) < 1e-6, 'favour charged');
  assert.ok(g.s.log.some((e) => /The gods sent 6 deer near your village/.test(e.msg)), 'logged');
  const b = reload(g);
  runDays(g, 2); runDays(b, 2);
  assert.equal(stateText(b), stateText(g), 'a load after the send plays on identically');
  const c = animalCensus(g);
  assert.ok(c.ok, c.problems.join('; '));
  assert.deepEqual(conservationErrors(g), []);
});

test('8b animals: single animals join the nearest herd of their kind (near: they appear as animals)', () => {
  const g = ready();
  const h = Object.values(g.s.animals.herds).filter((x) => x.sp === 'core:deer').sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  const n = h.n, animals = (id) => Object.values(g.s.animals.list || {}).filter((a) => a.herd === id).length, had = animals(h.id);
  const p = previewCommand(g, 'animals', { x: h.x, y: h.y, species: 'core:deer', count: 2, mode: 'join' });
  assert.equal(p.ok, true, p.reason);
  assert.match(p.preview.effect, new RegExp(`2 deer join the herd of ${n} nearby \\(${n + 2}\\)`));
  issueCommand(g, 'animals', { x: h.x, y: h.y, species: 'core:deer', count: 2, mode: 'join' });
  g.tick();
  assert.equal(g.s.animals.herds[h.id].n, n + 2);
  if (h.near !== undefined) assert.equal(animals(h.id), had + 2, 'two more animals by the herd');
  assert.ok(animalCensus(g).ok);
});

test('8b animals: wolves sent near a village need confirm and name it; deer and far wolves do not', () => {
  const g = ready();
  const at = tileWhere(g, dryLand, -20);
  const p = previewCommand(g, 'animals', { ...at, species: 'core:wolf', count: 4 });
  assert.equal(p.ok, false);
  assert.equal(p.needsConfirm, true);
  assert.ok(p.preview.warnings.some((w) => /Wolves will hunt near your village/.test(w)), p.preview.warnings.join(' | '));
  assert.equal(p.preview.cost, 16, 'wolves cost 4 a head');
  assert.equal(issueCommand(g, 'animals', { ...at, species: 'core:wolf', count: 4, confirm: true }).ok, true);
  assert.equal(previewCommand(g, 'animals', { ...at, species: 'core:deer', count: 4 }).ok, true, 'deer need no confirm');
  g.tick();
  assert.ok(Object.values(g.s.animals.herds).some((h) => h.origin === 'divine' && h.sp === 'core:wolf' && h.n === 4));
});

test('8b animals: on the Vast world a herd sent far from every village stays a count and lives by the far rules', () => {
  const g = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast', sandbox: true });
  runDays(g, 1);
  const centres = Object.values(g.s.settlements).map((v) => v.center).filter(Boolean);
  let at = null;
  for (let y = 0; y < g.H && !at; y += 7) for (let x = 0; x < g.W && !at; x += 7) {
    const t = g.terrainAt(x, y);
    if (t.id === 'core:grass' && centres.every((c) => Math.hypot(c.x - x, c.y - y) > 80)) at = { x, y };
  }
  assert.ok(at, 'open grass far from every village');
  const p = previewCommand(g, 'animals', { ...at, species: 'core:wolf', count: 5 });
  assert.equal(p.ok, true, `far wolves need no confirm (${p.reason})`);
  assert.equal(p.preview.cost, 0, 'Sandbox is free');
  issueCommand(g, 'animals', { ...at, species: 'core:wild_horse', count: 10 });
  g.tick();
  const h = Object.values(g.s.animals.herds).find((x) => x.origin === 'divine');
  assert.equal(h.near, undefined, 'far: a count, not animals');
  const census = herdCensus(g);
  runDays(g, 3);
  assert.ok(animalCensus(g).ok, animalCensus(g).problems.join('; '));
  assert.ok(census['core:wild_horse'].animals > 0);
});
