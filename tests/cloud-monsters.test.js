// Phase 8c: wild monsters (docs/proposals/phase-8c-wild-monsters.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame, conservationErrors } from './cloud-helpers.js';
import { monsterSummary, monsterCensus, killMonster, monsterSpecies } from '../src/sim/monsters.js';
import { readAllMods } from '../tools/fsmods.js';
import { buildRegistry } from '../src/sim/content/modloader.js';

const centres = (g) => { const c = Object.values(g.s.settlements).filter((v) => v.center && !v.fallen).map((v) => v.center); return c.length ? c : [g.s.center]; };
const nearest = (g, o) => Math.min(...centres(g).map((c) => Math.hypot(c.x - o.x, c.y - o.y)));

test('8c lairs: a classic game has one Thornback lair as far from the village as the map allows', () => {
  const g = newGame({ seed: 4242 });
  g.tick();
  const lairs = Object.values(g.s.monsters.lairs);
  assert.equal(lairs.length, 1);
  assert.equal(lairs[0].sp, 'core:thornback');
  assert.ok(nearest(g, lairs[0]) >= 20, `at least 20 tiles away (${Math.round(nearest(g, lairs[0]))})`);
  const m = g.s.monsters.list[lairs[0].monster];
  assert.ok(m && m.lair === lairs[0].id && m.hp === g.reg.get('monster', m.sp).health, 'its monster is home');
  assert.ok(monsterCensus(g).ok);
  assert.equal(g.s.monsters.ledger['core:thornback'].start, 1);
});

test('8c lairs: on the Vast world every species has lairs on its ground, 80+ tiles from villages and apart; they roam near home', () => {
  const g = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast' });
  g.tick();
  const sum = monsterSummary(g), M = g.s.monsters;
  for (const sp of ['core:thornback', 'core:gloomstalker', 'core:barkmaw']) assert.ok(sum[sp]?.lairs >= 1, `${sp}: ${JSON.stringify(sum)}`);
  const lairs = Object.values(M.lairs);
  for (const l of lairs) {
    const d = g.reg.get('monster', l.sp);
    assert.ok(nearest(g, l) >= 80, `${l.id} far from villages`);
    assert.ok(d.terrains.includes(g.terrainAt(l.x, l.y).id), `${l.id} on its ground`);
    for (const o of lairs) if (o !== l) assert.ok(Math.hypot(o.x - l.x, o.y - l.y) >= 64, 'lairs two chunks apart');
  }
  runDays(g, 4);
  for (const m of Object.values(M.list)) {
    const l = M.lairs[m.lair], d = g.reg.get('monster', m.sp);
    assert.ok(Math.max(Math.abs(m.x - l.x), Math.abs(m.y - l.y)) <= d.roam * 32, `${m.id} stays within ${d.roam} chunks of its lair`);
    assert.ok(d.terrains.includes(g.terrainAt(m.x, m.y).id), `${m.id} on its ground`);
  }
  const b = reload(g);
  runDays(g, 3); runDays(b, 3);
  assert.equal(stateText(b), stateText(g), 'a save and load plays on identically');
  for (const m of Object.values(M.list)) if (Math.floor(g.s.tick / 2400) % 2 === 0) assert.deepEqual([m.x, m.y], [M.lairs[m.lair].x, M.lairs[m.lair].y], 'home every other day');
  assert.ok(monsterCensus(g).ok, monsterCensus(g).problems.join('; '));
});

test('8c lairs: a slain monster is counted; its lair grows another after 60 days, a cleared one never', () => {
  const g = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast' });
  g.tick();
  const M = g.s.monsters, [a, b] = Object.values(M.list).sort((x, y) => (x.id < y.id ? -1 : 1));
  killMonster(g, a.id, 'slain'); killMonster(g, b.id, 'slain');
  M.lairs[b.lair].cleared = true;
  assert.equal(M.lairs[a.lair].monster, null);
  assert.ok(monsterCensus(g).ok, monsterCensus(g).problems.join('; '));
  M.lairs[a.lair].since = g.s.tick - 60 * 2400; // empty for 60 days by the next daily check
  runDays(g, 1);
  const again = M.lairs[a.lair].monster;
  assert.ok(again && M.list[again], 'a new monster at the old lair');
  assert.equal(M.lairs[b.lair].monster, null, 'a cleared lair stays empty');
  assert.equal(M.ledger[a.sp].born, 1);
  assert.ok(g.s.log.some((e) => /A new .* has come to an old lair/.test(e.msg)));
  assert.ok(monsterCensus(g).ok, monsterCensus(g).problems.join('; '));
});

test('8c saves: a malformed monster is refused; an older save gets lairs at the next tick; a scenario can turn them off', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const text = serializeGame(g);
  const bad = JSON.parse(text);
  Object.values(bad.state.monsters.list)[0].hp = -5;
  assert.throws(() => loadGame(g.reg, JSON.stringify(bad)), /monster/);
  const old = JSON.parse(text);
  old.saveFormat = 28; delete old.state.monsters;
  const h = loadGame(g.reg, JSON.stringify(old));
  assert.equal(h.s.monsters, undefined);
  h.tick();
  assert.equal(Object.keys(h.s.monsters.lairs).length, 1);
  const mods = readAllMods(), core = mods.find((m) => m.manifest.id === 'core');
  for (const sc of core.files['content/setup.json'].scenario) if (sc.id === 'core:standard') sc.monsters = { species: [] };
  const off = newGame({ seed: 4242, registry: buildRegistry(mods, ['core']).registry, scenario: 'core:standard' });
  runDays(off, 1);
  assert.equal(monsterSpecies(off).length, 0);
  assert.equal(off.s.monsters, undefined);
  assert.deepEqual(conservationErrors(g), []);
});
