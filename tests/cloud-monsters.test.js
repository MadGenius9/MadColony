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

// ---------------- slice 2: near monsters ----------------
import { sendMonster } from '../src/sim/monsters.js';
import { causeText } from '../src/sim/death.js';

/** A classic game a few days old with its own lair gone (so only the monsters a test sends are about). */
function quiet(days = 1) {
  const g = newGame({ seed: 4242 });
  runDays(g, days);
  const M = g.s.monsters;
  for (const m of Object.values(M.list)) killMonster(g, m.id, 'test');
  for (const l of Object.values(M.lairs)) l.cleared = true;
  return g;
}
const untilHour = (g, h) => { while (Math.floor(g.hour) !== h) g.tick(); };
const woundsOf = (c, kind) => (c.health?.injuries || []).filter((i) => i.kind === kind).length;

test('8c near: a Thornback tramples fields at dawn; it gores someone by its den; saves replay', () => {
  const g = quiet(6);
  const crops = Object.values(g.s.crops);
  assert.ok(crops.length > 3, 'fields are growing');
  const f = crops.sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  untilHour(g, 4);
  const m = sendMonster(g, 'core:thornback', f.x + 6, f.y);
  assert.ok(m.near !== undefined, 'near the village at once');
  const before = Object.keys(g.s.crops).length;
  const b = reload(g);
  for (let t = 0; t < 400; t++) { g.tick(); b.tick(); }
  assert.ok(Object.keys(g.s.crops).length < before, `crops trampled (${before} -> ${Object.keys(g.s.crops).length})`);
  assert.ok(g.s.log.some((e) => /A Thornback trampled crops/.test(e.msg)));
  assert.equal(stateText(b), stateText(g), 'a load mid-trampling plays on identically');
  const c = g.colonists()[0], lair = g.s.monsters.lairs[m.lair];
  for (let t = 0; t < 300 && !woundsOf(c, 'gore'); t++) { c.x = lair.x + 3; c.y = lair.y; c.mv = null; c.path = null; g.tick(); }
  assert.ok(woundsOf(c, 'gore') > 0, 'gored by its den');
  assert.equal(causeText('gore'), 'was gored by a Thornback');
  assert.deepEqual(conservationErrors(g), []);
  assert.ok(monsterCensus(g).ok);
});

test('8c near: a Gloomstalker takes a lone person outdoors at night, not two together; by day it goes home', () => {
  const g = quiet(1);
  untilHour(g, 22);
  const [a, b, c] = g.colonists();
  const m = sendMonster(g, 'core:gloomstalker', Math.round(a.x) + 8, Math.round(a.y));
  const pin = () => { for (const p of [a, b, c]) { p.mv = null; p.path = null; } a.x = m.x - 5; a.y = m.y; b.x = a.x; b.y = a.y + 1; c.x = m.x + 12; c.y = m.y + 12; };
  for (let t = 0; t < 200; t++) { pin(); g.tick(); }
  assert.equal(woundsOf(a, 'maul') + woundsOf(b, 'maul'), 0, 'two together are left alone');
  let hit = false;
  const spot = { x: m.x - 4, y: m.y }; // she stands still, alone; the others far off
  for (let t = 0; t < 400 && !hit; t++) { a.mv = null; a.path = null; a.x = spot.x; a.y = spot.y; b.x = spot.x + 20; b.y = spot.y + 20; c.x = spot.x + 24; c.y = spot.y + 20; g.tick(); hit = woundsOf(a, 'maul') > 0; }
  assert.ok(hit, 'a lone person outdoors at night is attacked');
  untilHour(g, 10);
  for (let t = 0; t < 600; t++) g.tick();
  const lair = g.s.monsters.lairs[m.lair];
  assert.ok(Math.hypot(m.x - lair.x, m.y - lair.y) <= 2, 'back at its lair by day');
  assert.ok(monsterCensus(g).ok);
});

test('8c near: a Barkmaw tears down a wooden part (its goods stay counted); fire burns it', () => {
  const g = quiet(8);
  const wooden = Object.values(g.s.structures).filter((st) => st.built && (g.bDef(st)?.cost || []).some((e) => e.item === 'core:wood')).sort((x, y) => (x.id < y.id ? -1 : 1));
  assert.ok(wooden.length, 'something wooden is built');
  const t = wooden[0];
  const m = sendMonster(g, 'core:barkmaw', t.x + 2, t.y);
  const built = () => Object.values(g.s.structures).filter((st) => st.built).length, had = built();
  let torn = false;
  for (let k = 0; k < 600 && !torn; k++) { g.tick(); torn = g.s.log.some((e) => /A Barkmaw tore down/.test(e.msg)); }
  assert.ok(torn, 'a wooden part nearby was torn down');
  assert.ok(built() < had, 'one fewer built part');
  assert.deepEqual(conservationErrors(g), [], 'its goods stay counted');
  // Fire: stand it in a burning tile.
  g.s.disasters ||= { fires: {}, scorched: {} };
  for (let k = 0; k < 200 && g.s.monsters.list[m.id]; k++) { g.s.disasters.fires[g.i(m.x, m.y)] = { t: g.s.tick }; g.tick(); }
  assert.equal(g.s.monsters.list[m.id], undefined, 'it burned');
  assert.equal(g.s.monsters.ledger['core:barkmaw'].died.burned, 1);
  assert.ok(monsterCensus(g).ok);
});

test('8c near: a village of 3 or fewer is never hurt (people and buildings), as the owner asked', () => {
  const g = quiet(8);
  const people = g.colonists().sort((x, y) => (x.id < y.id ? -1 : 1));
  for (const c of people.slice(3)) { delete g.s.colonists[c.id]; }
  g._own = null;
  const wooden = Object.values(g.s.structures).filter((st) => st.built && (g.bDef(st)?.cost || []).some((e) => e.item === 'core:wood'));
  const t = wooden[0];
  sendMonster(g, 'core:barkmaw', t.x + 1, t.y);
  const c = people[0];
  for (let k = 0; k < 600; k++) { c.x = t.x + 2; c.y = t.y; c.mv = null; c.path = null; g.tick(); }
  assert.ok(g.s.structures[t.id]?.built, 'its buildings stand');
  assert.equal(woundsOf(c, 'crush'), 0, 'its people are not hurt');
});
