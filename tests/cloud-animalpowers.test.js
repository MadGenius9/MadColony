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
  assert.match(previewCommand(g, 'animals', { x: g.s.center.x, y: g.s.center.y, species: 'core:deer', count: 4 }).reason, /this world has no animals/);
  assert.match(previewCommand(g, 'peaceful', { on: true }).reason, /this world has no animals/);
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

// ---------------- slice 2: real needs ----------------
/** Vast, Sandbox, a day old; and a chunk (by its middle tile) far from villages passing ok(counts of a species). */
function vastFar(test) {
  const g = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast', sandbox: true });
  runDays(g, 1);
  const centres = Object.values(g.s.settlements).map((v) => v.center).filter(Boolean);
  for (let cy = 1; cy < g.CH - 1; cy++) for (let cx = 1; cx < g.CW - 1; cx++) {
    const x = cx * 32 + 16, y = cy * 32 + 16, t = g.terrainAt(x, y);
    if (!t.passable || t.drinkable || centres.some((c) => Math.hypot(c.x - x, c.y - y) < 100)) continue;
    if (!test(g, cy * g.CW + cx, x, y)) continue;
    for (let k = 0; k < 64; k++) { const px = x + (k % 8) - 4, py = y + Math.floor(k / 8) - 4; if (g.isPassable(px, py) && !g.terrainAt(px, py).drinkable) return { g, x: px, y: py }; } // an open tile there (not a tree)
  }
  return { g };
}

test('8b needs: horses sent where none of their ground is lose some and move off toward it', () => {
  const { g, x, y } = vastFar((g, c, x, y) => {
    const Hb = g._anHab, si = Hb.index.get('core:wild_horse'), cx = c % g.CW, cy = (c - cx) / g.CW;
    if (Hb.counts[si][c] !== 0) return false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (Hb.counts[si][(cy + dy) * g.CW + cx + dx] > 300) return true; // their ground next door
    return false;
  });
  assert.ok(x !== undefined, 'a chunk with no horse ground beside one with plenty');
  assert.equal(issueCommand(g, 'animals', { x, y, species: 'core:wild_horse', count: 15 }).ok, true);
  g.tick();
  const h = Object.values(g.s.animals.herds).find((e) => e.origin === 'divine');
  assert.match(previewCommand(g, 'animals', { x, y, species: 'core:wild_horse', count: 2 }).preview.warnings[0], /there is none of it here: they will wander off to find it/);
  runDays(g, 3);
  const now = g.s.animals.herds[h.id];
  const Hb = g._anHab, si = Hb.index.get('core:wild_horse');
  assert.ok(!now || Hb.counts[si][Math.floor(now.y / 32) * g.CW + Math.floor(now.x / 32)] > 0, 'it found its ground (or faded)');
  assert.ok(animalCensus(g).ok, animalCensus(g).problems.join('; '));
  // Held there (it cannot move): it loses some every day.
  issueCommand(g, 'animals', { x, y, species: 'core:wild_horse', count: 15 });
  g.tick();
  const held = Object.values(g.s.animals.herds).filter((e) => e.origin === 'divine').sort((a, b) => b.sent - a.sent)[0];
  const lost0 = g.s.animals.ledger['core:wild_horse'].died.lost || 0;
  for (let d = 0; d < 3; d++) { held.next = g.s.tick + 1e6; runDays(g, 1); }
  assert.ok((g.s.animals.ledger['core:wild_horse'].died.lost || 0) > lost0, 'held off its ground, some are lost');
  assert.ok(g.s.animals.herds[held.id] === undefined || g.s.animals.herds[held.id].n < 15);
  assert.ok(animalCensus(g).ok, animalCensus(g).problems.join('; '));
});

test('8b needs: 60 deer sent into one patch thin out and spread', () => {
  const { g, x, y } = vastFar((g, c) => { const Hb = g._anHab, si = Hb.index.get('core:deer'); return Hb.counts[si][c] > 600; });
  assert.ok(x !== undefined, 'a chunk of deer ground far from villages');
  for (let k = 0; k < 5; k++) assert.equal(issueCommand(g, 'animals', { x, y, species: 'core:deer', count: 12 }).ok, true);
  g.tick();
  const sent = Object.values(g.s.animals.herds).filter((e) => e.origin === 'divine').map((e) => e.id);
  assert.equal(sent.length, 5);
  const p = previewCommand(g, 'animals', { x, y, species: 'core:deer', count: 12 });
  assert.ok(p.preview.warnings.some((w) => /too many, some will die or move on/.test(w)), p.preview.warnings.join(' | '));
  runDays(g, 4);
  const chunk = (h) => Math.floor(h.y / 32) * g.CW + Math.floor(h.x / 32), c0 = Math.floor(y / 32) * g.CW + Math.floor(x / 32);
  const left = Object.values(g.s.animals.herds).filter((h) => h.sp === 'core:deer' && chunk(h) === c0).reduce((n, h) => n + h.n, 0);
  assert.ok(left < 60, `fewer deer in that chunk (${left})`);
  assert.ok(animalCensus(g).ok, animalCensus(g).problems.join('; '));
  // Held there (they cannot move): the crowd thins.
  for (let k = 0; k < 5; k++) issueCommand(g, 'animals', { x, y, species: 'core:deer', count: 12 });
  g.tick();
  const held = Object.values(g.s.animals.herds).filter((e) => e.origin === 'divine' && e.sent === g.s.tick);
  for (let d = 0; d < 3; d++) { for (const h of held) h.next = g.s.tick + 1e6; runDays(g, 1); }
  assert.ok((g.s.animals.ledger['core:deer'].died.crowded || 0) >= 1, 'held in a crowd, some die');
  assert.ok(animalCensus(g).ok, animalCensus(g).problems.join('; '));
});

// ---------------- slice 3: peaceful animals ----------------
/** A classic game with only a hungry wolf pack by the village (near), and a deer herd beside it if `deer`. */
function packGame(deer = false) {
  const g = newGame({ seed: 4242 });
  g.tick();
  const c = g.s.settlements[g.s.playerSettlement].center, A = g.s.animals, day = Math.floor(g.s.tick / 2400);
  for (const id of Object.keys(A.herds)) delete A.herds[id];
  A.ledger = {}; // the test's herds are its start
  A.herds.h901 = { id: 'h901', sp: 'core:wolf', x: c.x - 18, y: c.y + 6, n: 4, day, year: 0, next: g.s.tick, fed: day - 1 };
  A.ledger['core:wolf'] = { start: 4, born: 0, sent: 0, died: {} };
  if (deer) { A.herds.h902 = { id: 'h902', sp: 'core:deer', x: c.x - 22, y: c.y + 10, n: 8, day, year: 0, next: g.s.tick + 1e6, fed: day }; /* it stays until the near check */ A.ledger['core:deer'] = { start: 8, born: 0, sent: 0, died: {} }; }
  A.next = 903; g._anIdx = null;
  while (g.s.tick % 600 !== 451) g.tick();
  return g;
}
const bitesOf = (c) => (c.health?.injuries || []).filter((i) => i.kind === 'bite').length;

test('8b peaceful: a hungry pack leaves a lone person alone, still kills deer; switched off, it attacks; saves replay', () => {
  const g = packGame(true);
  const p = previewCommand(g, 'peaceful', { on: true });
  assert.equal(p.ok, true, p.reason);
  assert.equal(p.preview.cost, 0);
  assert.match(previewCommand(g, 'peaceful', { on: false }).reason, /wild already/);
  issueCommand(g, 'peaceful', { on: true });
  g.tick();
  assert.equal(g.s.animals.peaceful, true);
  assert.ok(g.s.log.some((e) => /calmed the wild/.test(e.msg)));
  const c = g.colonists()[0];
  const put = (x) => { const w = Object.values(x.s.animals.list).find((a) => a.herd === 'h901'), p = x.s.colonists[c.id]; if (w) { p.x = w.x + 4; p.y = w.y; p.mv = null; p.path = null; } };
  put(g);
  const b = reload(g);
  let ran = false;
  for (let t = 0; t < 2400; t++) { if (t % 100 === 0) { put(g); put(b); } g.tick(); b.tick(); if (c.job?.type === 'flee' && c.job.wolf) ran = true; }
  assert.equal(bitesOf(c), 0, 'nobody bitten while peaceful');
  assert.equal(ran, false, 'nobody runs from a peaceful pack');
  assert.ok((g.s.animals.ledger['core:deer'].died.prey || 0) >= 1, 'the pack still hunts deer');
  assert.equal(stateText(b), stateText(g), 'a load while peaceful plays on identically');
  assert.ok(animalCensus(g).ok, animalCensus(g).problems.join('; '));
  // Wild again, with no deer left near: a hungry pack goes for her (outside winter, prey comes before people).
  const A = g.s.animals;
  delete A.herds.h902;
  for (const [id, a] of Object.entries(A.list)) if (a.herd === 'h902') delete A.list[id];
  g._anIdx = null; g._anNear = null; g._anBeasts = null;
  issueCommand(g, 'peaceful', { on: false });
  g.tick();
  assert.equal(g.s.animals.peaceful, undefined);
  const h = g.s.animals.herds.h901;
  for (let t = 0; t < 2400 && !bitesOf(c); t++) { if (t % 100 === 0) { const a = Object.values(g.s.animals.list || {}).find((x) => x.herd === 'h901'); if (a) { c.x = a.x + 3; c.y = a.y; c.mv = null; c.path = null; } h.fed = Math.floor(g.s.tick / 2400) - 1; } g.tick(); }
  assert.ok(bitesOf(c) > 0, 'bitten once the wild is wild again');
  assert.deepEqual(conservationErrors(g), []);
});

test('8b review: horses sent two chunks from any of their ground walk back to it', () => {
  const { g, x, y } = vastFar((g, c) => {
    const Hb = g._anHab, si = Hb.index.get('core:wild_horse'), cx = c % g.CW, cy = (c - cx) / g.CW;
    let ring1 = 0, ring2 = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const n = Hb.counts[si][(cy + dy) * g.CW + cx + dx] || 0;
      if (Math.max(Math.abs(dx), Math.abs(dy)) <= 1) ring1 += n; else ring2 += n;
    }
    return ring1 === 0 && ring2 > 100;
  });
  assert.ok(x !== undefined, 'a chunk with no horse ground in the 3x3 round it, some within 2 chunks');
  issueCommand(g, 'animals', { x, y, species: 'core:wild_horse', count: 15 });
  g.tick();
  const h = Object.values(g.s.animals.herds).find((e) => e.origin === 'divine');
  runDays(g, 4);
  const now = g.s.animals.herds[h.id], Hb = g._anHab, si = Hb.index.get('core:wild_horse');
  assert.ok(now, 'the herd lives');
  assert.ok(Hb.counts[si][Math.floor(now.y / 32) * g.CW + Math.floor(now.x / 32)] > 0, 'it reached its ground');
  assert.ok(animalCensus(g).ok, animalCensus(g).problems.join('; '));
});
