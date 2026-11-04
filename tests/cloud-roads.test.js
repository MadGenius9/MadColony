// Phase 7, slice 1: roads as a terrain laid by work (docs/proposals/phase-7-roads.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame, conservationErrors } from './cloud-helpers.js';
import { completeStructure } from '../src/sim/construction.js';
import { roadsOf } from '../src/sim/roads.js';
import { findPath } from '../src/sim/path.js';
import { relationOf } from '../src/sim/villages.js';

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

test('roads: a step onto a built road is quicker; the ground stays as it was; removing the road ends it', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const [p] = openRow(g, 1);
  const old = g.terrainAt(p.x, p.y).id, cost = g.stepCost(p.x, p.y), rev = g.s.map.rev;
  const st = g.addStructure('core:road', p.x, p.y, { settlement: g.s.playerSettlement });
  assert.equal(g.stepCost(p.x, p.y), cost, 'nothing until it is built');
  g.ledgerAdd('created', 'core:stone', 1, 'test'); // the stone it is built from (kept in the ledger)
  st.delivered = { 'core:stone': 1 };
  completeStructure(g, st, null);
  assert.equal(g.stepCost(p.x, p.y), 0.6, 'quicker to walk');
  assert.equal(g.terrainAt(p.x, p.y).id, old, 'the ground is unchanged');
  assert.equal(g.s.map.rev, rev, 'no terrain change (the water maps and paths are not redone)');
  assert.equal(g.moveCost(p.x, p.y), cost, 'path searches weigh it as before');
  assert.ok(g.isPassable(p.x, p.y));
  assert.equal(roadsOf(g, g.s.playerSettlement).length, 1);
  g.removeStructure(st.id);
  assert.equal(g.stepCost(p.x, p.y), cost, 'gone: a plain step again');
  assert.deepEqual(conservationErrors(g), []);
});

test('roads: paths are the same with roads; roads save and load; old saves load', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const row = openRow(g, 8);
  assert.ok(row, 'open ground for a road');
  const a = row[0], b = row.at(-1);
  const before = JSON.stringify(findPath(g, a.x, a.y - 1, b.x, b.y - 1));
  for (const p of row) { const st = g.addStructure('core:road', p.x, p.y, { settlement: g.s.playerSettlement, built: false }); g.ledgerAdd('created', 'core:stone', 1, 'test'); st.delivered = { 'core:stone': 1 }; completeStructure(g, st, null); }
  assert.ok(row.every((p) => g.stepCost(p.x, p.y) === 0.6));
  assert.equal(JSON.stringify(findPath(g, a.x, a.y - 1, b.x, b.y - 1)), before, 'the same path');
  const r = reload(g);
  assert.equal(stateText(r), stateText(g));
  assert.ok(row.every((p) => r.stepCost(p.x, p.y) === 0.6), 'the road is saved');
  runDays(g, 1); runDays(r, 1);
  assert.equal(stateText(r), stateText(g));
  const old = JSON.parse(serializeGame(g));
  for (const st of Object.values(old.state.settlements)) delete st.traffic;
  old.saveFormat = 38;
  assert.ok(loadGame(g.reg, JSON.stringify(old)));
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

// ---- slice 3: trade roads
import { TRADE_ROAD } from '../src/sim/roads.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

test('roads: villages with a trade pact and trades between them lay their part of a road toward each other', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  runDays(g, 2);
  const [a, b] = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
  const rel = relationOf(g, a, b);
  rel.contact = true;
  const key = [a, b].sort().join('|');
  const plan = () => { for (let d = 0; d < TRADE_ROAD.everyDays; d++) { const n = planRoads(g, g.plans[a], a); if (n) return n; g.s.tick += TICKS_PER_DAY; } return 0; };
  // No pact: nothing.
  rel.tradesDone = TRADE_ROAD.trades;
  assert.equal(plan(), 0, 'no pact, no trade road');
  // A pact but too few trades: nothing.
  (g.s.treaties ||= {})[key] = { kind: 'tradePact', a: [a, b].sort()[0], b: [a, b].sort()[1], since: g.s.tick, lastTrade: g.s.tick };
  rel.tradesDone = TRADE_ROAD.trades - 1;
  assert.equal(plan(), 0, 'too few trades');
  // A pact and enough trades: a stretch, on its own land, with the reason.
  rel.tradesDone = TRADE_ROAD.trades;
  const n = plan();
  assert.ok(n > 0, 'a stretch of trade road');
  const roads = Object.values(g.s.structures).filter((x) => x.def === 'core:road' && x.settlement === a);
  assert.equal(roads.length, n);
  assert.ok(roads.every((x) => g.claimOk(a, x.x, x.y)), 'on its own land');
  const line = g.s.log.at(-1);
  assert.equal(line.kind, 'core:road');
  assert.deepEqual(line.sids, [a, b].sort());
  assert.match(line.msg, /laying a road toward .* \(\d+ sections?; a trade pact, \d+ trades\)/);
  assert.ok(g.owned('colonists', a).length < 8, 'no minimum of people for a trade road');
});

test('roads: a caravan along a road arrives sooner (distant villages travel abstractly)', async () => {
  const { roadShare, caravanRoadTicks } = await import('../src/sim/roads.js');
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const row = openRow(g, 8);
  assert.ok(row, 'open ground');
  const a = row[0], b = row.at(-1);
  assert.deepEqual(roadShare(g, a, b), { share: 0, step: 1 }, 'no road: as before');
  assert.equal(caravanRoadTicks(g, a, b, 1000), 1000);
  for (const p of row) { const st = g.addStructure('core:road', p.x, p.y, { settlement: g.s.playerSettlement, built: false }); g.ledgerAdd('created', 'core:stone', 1, 'test'); st.delivered = { 'core:stone': 1 }; completeStructure(g, st, null); }
  const r = roadShare(g, a, b);
  assert.equal(r.share, 1, 'all along the road');
  assert.equal(caravanRoadTicks(g, a, b, 1000), 600, 'a road step: 0.6 of the time');
  assert.deepEqual(conservationErrors(g), []);
});
