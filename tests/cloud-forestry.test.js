// Forestry: villages plant trees (docs/proposals/forestry.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame, conservationErrors } from './cloud-helpers.js';
import { FOREST, treesNear, woodTree, groveSpots } from '../src/sim/forestry.js';
import { planNow } from '../src/sim/planner.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

/** The classic colony with all but `keep` grown pines within reach of its centre taken away (as if felled). */
function stripped(keep = 5) {
  const g = newGame({ seed: 4242 });
  runDays(g, 2);
  const sid = g.s.playerSettlement, c = g.s.settlements[sid].center, def = woodTree(g).id;
  const near = Object.values(g.s.nodes).filter((n) => n.def === def && Math.max(Math.abs(n.x - c.x), Math.abs(n.y - c.y)) <= FOREST.reach).sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const n of near.slice(keep)) g.removeNode(n.id);
  return { g, sid, def };
}

test('forestry: a village short of trees lays out a grove, with its reason; one with enough does not', () => {
  const rich = newGame({ seed: 4242 });
  runDays(rich, 2);
  if (treesNear(rich, rich.s.playerSettlement, woodTree(rich).id).grown >= FOREST.min) assert.equal(rich.s.settlements[rich.s.playerSettlement].grove, undefined, 'enough trees: no grove');
  const { g, sid } = stripped();
  planNow(g, sid);
  const gr = g.s.settlements[sid].grove;
  assert.ok(gr, 'a grove');
  assert.match(gr.why, /^the nearest open ground for trees, \d+ tiles from the centre$/);
  assert.match(g.plans[sid].forestNote, /grove/);
  assert.ok(g.s.log.some((e) => e.kind === 'core:grove'));
  assert.ok([Math.floor((FOREST.w * FOREST.h) / 2), Math.ceil((FOREST.w * FOREST.h) / 2)].includes(groveSpots(gr).length), 'every other tile');
});

test('forestry: woodcutters plant young trees in the grove, which grow up; nothing is made from nothing', () => {
  const { g, sid, def } = stripped();
  const young0 = treesNear(g, sid, def).young;
  let planted = 0;
  for (let d = 0; d < 6 && planted < 4; d++) { g.step(TICKS_PER_DAY); planted = treesNear(g, sid, def).young - young0; }
  const gr = g.s.settlements[sid].grove;
  assert.ok(gr, 'a grove');
  const inGrove = Object.values(g.s.nodes).filter((n) => n.def === def && n.x >= gr.x && n.x < gr.x + gr.w && n.y >= gr.y && n.y < gr.y + gr.h);
  assert.ok(inGrove.length >= 4, `young trees planted in the grove (${inGrove.length})`);
  assert.ok(inGrove.filter((n) => n.young).every((n) => (n.x + n.y) % 2 === 0), 'planted on every other tile');
  assert.deepEqual(conservationErrors(g), []);
  const r = reload(g);
  assert.equal(stateText(r), stateText(g));
  g.step(500); r.step(500);
  assert.equal(stateText(r), stateText(g), 'the same after 500 ticks');
  g.step(35 * TICKS_PER_DAY); // sproutDays (20), slower in the cold
  assert.ok(Object.values(g.s.nodes).some((n) => n.def === def && !n.young && n.x >= gr.x && n.x < gr.x + gr.w && n.y >= gr.y && n.y < gr.y + gr.h), 'grown up');
});

test('forestry: a grove is saved; a bad one is refused; old saves have none', () => {
  const { g, sid } = stripped();
  planNow(g, sid);
  const bad = JSON.parse(serializeGame(g));
  bad.state.settlements[sid].grove.w = 'wide';
  assert.throws(() => loadGame(g.reg, JSON.stringify(bad)), /invalid grove/);
  const old = JSON.parse(serializeGame(newGame({ seed: 4242 })));
  old.saveFormat = 44;
  assert.equal(loadGame(g.reg, JSON.stringify(old)).s.settlements[sid].grove, undefined);
});

test('forestry: a distant village plants in its grove in aggregate, two young trees a day, up to the limit', async () => {
  const { tickGroves, hourOf } = await import('../src/sim/forestry.js');
  // At the village's own hour of the day (tickGroves plants for the villages whose hour it is).
  const atHour = (g, sid) => { const day = Math.floor(g.s.tick / TICKS_PER_DAY) + 1; g.s.tick = day * TICKS_PER_DAY + hourOf(sid) * 100 + 90; };
  const { g, sid, def } = stripped();
  const st = g.s.settlements[sid], was = st.detail;
  st.detail = 'abstract'; // as a distant village (nobody walks there)
  planNow(g, sid);
  assert.ok(st.grove, 'it lays out a grove too');
  const y0 = treesNear(g, sid, def).young;
  atHour(g, sid); tickGroves(g);
  assert.equal(treesNear(g, sid, def).young - y0, FOREST.farPerDay, 'two a day');
  g.s.tick += 100; // the next hour: not its hour
  tickGroves(g);
  assert.equal(treesNear(g, sid, def).young - y0, FOREST.farPerDay, 'only at its own hour of the day');
  for (let d = 0; d < 20; d++) { atHour(g, sid); tickGroves(g); }
  const n = treesNear(g, sid, def);
  assert.ok(n.grown + n.young <= FOREST.min + FOREST.extra, 'no more than the limit');
  if (was === undefined) delete st.detail; else st.detail = was;
  assert.deepEqual(conservationErrors(g), []);
});

test('review fixes: a grove off the map is refused on load', () => {
  const { g, sid } = stripped();
  for (let d = 0; d < 3 && !g.s.settlements[sid].grove; d++) { planNow(g, sid); g.step(TICKS_PER_DAY); }
  assert.ok(g.s.settlements[sid].grove, 'a grove (on its village\'s looking day)');
  const bad = JSON.parse(serializeGame(g));
  bad.state.settlements[sid].grove.x = -5;
  assert.throws(() => loadGame(g.reg, JSON.stringify(bad)), /invalid grove/);
});
