// Phase 7, slice 1: roads as a terrain laid by work (docs/proposals/phase-7-roads.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame, conservationErrors } from './cloud-helpers.js';
import { completeStructure } from '../src/sim/construction.js';
import { roadsOf } from '../src/sim/roads.js';
import { findPath } from '../src/sim/path.js';

/** A straight row of open ground near the village centre, with even ground (move cost 1) on it and in the row
 *  above (so only a road makes the row cheaper): [{ x, y }] of length n, or null. */
function openRow(g, n) {
  const c = g.s.settlements[g.s.playerSettlement].center;
  for (let dy = 4; dy < 20; dy++) for (let dx = -10; dx < 10; dx++) {
    const row = Array.from({ length: n }, (_, k) => ({ x: c.x + dx + k, y: c.y + dy }));
    const open = (x, y) => g.inB(x, y) && g.isPassable(x, y) && g.terrainAt(x, y).buildable && g.moveCost(x, y) === 1 && !g.structAt(x, y) && !g.nodeAt(x, y) && !g.cropAt(x, y) && !g.zoneAt(g.i(x, y));
    if (row.every((p) => open(p.x, p.y) && open(p.x, p.y - 1))) return row;
  }
  return null;
}

test('roads: a built road turns its tile into road (cheaper to walk); removing it brings the old ground back', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const [p] = openRow(g, 1);
  const old = g.terrainAt(p.x, p.y).id, cost = g.moveCost(p.x, p.y);
  const st = g.addStructure('core:road', p.x, p.y, { settlement: g.s.playerSettlement });
  assert.equal(g.terrainAt(p.x, p.y).id, old, 'nothing until it is built');
  g.ledgerAdd('created', 'core:stone', 1, 'test'); // the stone it is built from (kept in the ledger)
  st.delivered = { 'core:stone': 1 };
  completeStructure(g, st, null);
  assert.equal(g.terrainAt(p.x, p.y).id, 'core:dirt_road');
  assert.equal(st.under, old);
  assert.ok(g.moveCost(p.x, p.y) < cost, 'cheaper to walk');
  assert.ok(g.isPassable(p.x, p.y));
  assert.equal(roadsOf(g, g.s.playerSettlement).length, 1);
  g.removeStructure(st.id);
  assert.equal(g.terrainAt(p.x, p.y).id, old, 'the old ground is back');
  assert.deepEqual(conservationErrors(g), []);
});

test('roads: paths prefer a road; a road saves and loads; old saves load', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const row = openRow(g, 8);
  assert.ok(row, 'open ground for a road');
  const a = row[0], b = row.at(-1);
  const onRoad = (path) => (path || []).filter((p) => row.some((q) => q.x === p.x && q.y === p.y)).length;
  const n0 = onRoad(findPath(g, a.x, a.y - 1, b.x, b.y - 1)); // tiles of the future road it uses before the road
  for (const p of row) { const st = g.addStructure('core:road', p.x, p.y, { settlement: g.s.playerSettlement, built: false }); g.ledgerAdd('created', 'core:stone', 1, 'test'); st.delivered = { 'core:stone': 1 }; completeStructure(g, st, null); }
  assert.ok(row.every((p) => g.terrainAt(p.x, p.y).id === 'core:dirt_road'));
  // From the tile above one end to the tile above the other: the straight way is the row above; with the road
  // (0.6 a step against 1) the path steps down onto it.
  const pathAbove = () => findPath(g, a.x, a.y - 1, b.x, b.y - 1);
  assert.ok(g.isPassable(a.x, a.y - 1) && g.isPassable(b.x, b.y - 1));
  const n1 = onRoad(pathAbove());
  assert.ok(n1 >= row.length - 3, `the path follows the road (${n1} of ${row.length} tiles)`);
  assert.ok(n0 <= 2, `before the road the path keeps to the row above (${n0} tiles of the row)`);
  assert.ok(n1 > n0, `the road draws it down (${n0} -> ${n1})`);
  const r = reload(g);
  assert.equal(stateText(r), stateText(g));
  assert.ok(row.every((p) => r.terrainAt(p.x, p.y).id === 'core:dirt_road'), 'the road is saved');
  runDays(g, 1); runDays(r, 1);
  assert.equal(stateText(r), stateText(g));
  const old = JSON.parse(serializeGame(g));
  for (const st of Object.values(old.state.structures)) delete st.under;
  old.saveFormat = 38;
  assert.ok(loadGame(g.reg, JSON.stringify(old)));
  const bad = JSON.parse(serializeGame(g));
  Object.values(bad.state.structures).find((s) => s.under).under = 5;
  assert.throws(() => loadGame(g.reg, JSON.stringify(bad)), /road/);
});

// ---- slice 2: foot traffic and the first roads
import { countTraffic, fadeTraffic, planRoads, ROAD } from '../src/sim/roads.js';

test('roads: walking people are counted by cell; the counts fade; distant villages are not counted', () => {
  const g = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast' });
  runDays(g, 2);
  const me = g.s.playerSettlement, far = Object.keys(g.s.settlements).find((k) => g.s.settlements[k].detail === 'abstract');
  assert.ok(Object.keys(g.s.settlements[me].traffic || {}).length > 0, 'the player\'s village counted its walkers');
  if (far) assert.equal(g.s.settlements[far].traffic, undefined, 'a distant village counts nothing');
  const T = g.s.settlements[me].traffic, k = Object.keys(T)[0], v = T[k];
  fadeTraffic(g);
  assert.equal(g.s.settlements[me].traffic[k] ?? 0, Math.floor(v * ROAD.decay));
  assert.ok(Object.keys(T).length <= ROAD.cells);
});

test('roads: a village lays a stretch of road toward its busiest cell, with its reason; one stretch at a time', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const sid = g.s.playerSettlement, st = g.s.settlements[sid], c = st.center;
  // A busy cell a little way off (as if many walked there).
  const k = `${Math.floor((c.x + 14) / ROAD.cell)},${Math.floor(c.y / ROAD.cell)}`;
  st.traffic = { [k]: ROAD.busy + 10 };
  // A small village lays no roads.
  assert.ok(g.owned('colonists', sid).length < ROAD.minPeople);
  assert.equal(planRoads(g, g.plans[sid], sid), 0, 'too few people for roads');
  // Enough people (copies of the first, standing at home): it does.
  const src = g.owned('colonists', sid)[0];
  while (g.owned('colonists', sid).length < ROAD.minPeople) { const id = 'c' + g.s.nextId++; const cp = JSON.parse(JSON.stringify(src)); Object.assign(cp, { id, job: null, mv: null, homeId: null, bedId: null, carry: null, equip: { tool: null, weapon: null } }); g.s.colonists[id] = cp; g.ownAdd('colonists', cp); }
  const n = planRoads(g, g.plans[sid], sid);
  assert.ok(n > 0 && n <= ROAD.segment, `a stretch started (${n})`);
  const line = g.s.log.at(-1);
  assert.equal(line.kind, 'core:road');
  assert.match(line.msg, /laying a road \(\d+ sections?\) where they walk most \(\d+ walkers counted there\)/);
  const roads = Object.values(g.s.structures).filter((b) => b.def === 'core:road');
  assert.equal(roads.length, n);
  assert.equal(planRoads(g, g.plans[sid], sid), 0, 'not another while this one is unbuilt');
  // Below the threshold: nothing.
  for (const b of roads) g.removeStructure(b.id);
  st.traffic = { [k]: ROAD.busy - 1 };
  assert.equal(planRoads(g, g.plans[sid], sid), 0);
  // Saves and loads; bad counts are refused.
  st.traffic = { [k]: 12 };
  const r = reload(g);
  assert.deepEqual(r.s.settlements[sid].traffic, st.traffic);
  const bad = JSON.parse(serializeGame(g));
  bad.state.settlements[sid].traffic = { nonsense: 3 };
  assert.throws(() => loadGame(g.reg, JSON.stringify(bad)), /traffic/);
  assert.ok(typeof countTraffic === 'function');
});
