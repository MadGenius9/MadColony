// Burial and mourning (Phase 5, slice 1b): the dead leave a body that a carer carries to the village graveyard and
// buries; distant villages bury at once; bodies left too long are laid to rest anyway; close family grieve.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, firstDifference, conservationErrors, reservationErrors, serializeGame, loadGame, TICKS_PER_DAY } from './cloud-helpers.js';
import { injure, HEALTH } from '../src/sim/health.js';
import { BURIAL, GRAVE } from '../src/sim/burial.js';
import { workSpeed } from '../src/sim/ai/jobs.js';
import { TICKS_PER_HOUR } from '../src/sim/constants.js';

const HOURS = HEALTH.deathAfterHours * TICKS_PER_HOUR;
const mortallyWound = (g, c) => { injure(g, c, 'wound', 100, 'Struck down'); injure(g, c, 'wound', 100, 'Struck down again'); };
const graves = (g) => Object.values(g.s.structures).filter((s) => s.def === GRAVE);
/** Let `c` die: until just after the death. */
function dies(g, c) {
  mortallyWound(g, c);
  g.step(HOURS);
  for (let t = 0; t < 2 * TICKS_PER_HOUR && !g.s.dead?.[c.id]; t += 10) g.step(10); // distant villages: hourly health
  assert.ok(g.s.dead?.[c.id], `${c.name} died`);
}

test('the dead leave a body where they fell; a carer buries it in a grave near the village', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 3);
  const c = g.colonists()[2];
  dies(g, c);
  const bodies = Object.values(g.s.bodies || {});
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].cid, c.id);
  g.step(6 * TICKS_PER_HOUR);
  assert.equal(g.s.bodies, undefined, 'buried within hours');
  const [grave] = graves(g);
  assert.ok(grave, 'a grave');
  assert.equal(grave.built, true);
  assert.equal(grave.grave.name, c.name);
  assert.equal(grave.settlement, g.s.playerSettlement);
  const centre = g.s.settlements[g.s.playerSettlement].center;
  const d = Math.max(Math.abs(grave.x - centre.x), Math.abs(grave.y - centre.y));
  assert.ok(d >= BURIAL.yardFrom && d <= BURIAL.yardTo, `the grave is ${d} tiles from the centre`);
  assert.equal(g.s.dead[c.id].graveId, grave.id);
  assert.ok(g.s.log.some((e) => new RegExp(`buried ${c.name}`).test(e.msg)));
  assert.deepEqual(conservationErrors(g), []);
  assert.deepEqual(reservationErrors(g), []);
});

test('later graves go next to the first one (a graveyard)', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 3);
  dies(g, g.colonists()[1]);
  g.step(8 * TICKS_PER_HOUR);
  dies(g, g.colonists()[1]);
  g.step(8 * TICKS_PER_HOUR);
  const [a, b] = graves(g);
  assert.ok(a && b, 'two graves');
  assert.ok(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= BURIAL.nearGrave, 'side by side');
});

test('a body nobody buries is laid to rest by the village after the waiting days', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 3);
  const c = g.colonists()[0];
  dies(g, c);
  const body = Object.values(g.s.bodies)[0];
  g.blockTarget('body:' + body.id, 'test: nobody may carry it', 10 * TICKS_PER_DAY);
  g.step(BURIAL.layAfterDays * TICKS_PER_DAY - 2 * TICKS_PER_HOUR);
  assert.ok(g.s.bodies?.[body.id], 'still waiting');
  g.step(3 * TICKS_PER_HOUR);
  assert.equal(g.s.bodies, undefined);
  assert.equal(graves(g).length, 1);
  assert.ok(g.s.dead[c.id].buried);
});

test('distant villages bury their dead at once (no body)', () => {
  const g = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast' });
  runDays(g, 1);
  const far = Object.values(g.s.settlements).find((x) => x.detail === 'abstract');
  const c = g.owned('colonists', far.id)[0];
  dies(g, c);
  assert.equal(g.s.bodies, undefined);
  const gr = graves(g).find((x) => x.settlement === far.id);
  assert.ok(gr, 'a grave in the distant village');
  assert.equal(gr.grave.cid, c.id);
  assert.deepEqual(conservationErrors(g), []);
});

test('close family grieve for two days: they work more slowly, then it passes', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 3);
  const c = g.colonists().find((x) => x.homeId && g.colonists().some((o) => o !== x && o.homeId === x.homeId));
  assert.ok(c, 'someone who shares a home');
  const mate = g.colonists().find((o) => o !== c && o.homeId === c.homeId);
  const others = g.colonists().filter((o) => o !== c && o.homeId !== c.homeId && !c.parents?.includes(o.id) && !o.parents?.includes(c.id));
  dies(g, c);
  assert.equal(mate.grief?.for, c.name);
  for (const o of others) assert.equal(o.grief, undefined, `${o.name} does not grieve`);
  const during = workSpeed(g, mate, null, null);
  const grief = mate.grief; delete mate.grief;
  const without = workSpeed(g, mate, null, null);
  mate.grief = grief;
  assert.ok(Math.abs(during - without * BURIAL.griefWork) < 1e-9, `grieving: ${during.toFixed(3)} = ${without.toFixed(3)} × ${BURIAL.griefWork}`);
  g.step(BURIAL.griefDays * TICKS_PER_DAY + TICKS_PER_HOUR);
  assert.equal(mate.grief, undefined, 'grief is over');
});

test('saved while the body is carried to the graveyard: continues identically', () => {
  const run = (cuts) => {
    let g = newGame({ seed: 4242 });
    runDays(g, 3);
    mortallyWound(g, g.colonists()[2]);
    for (let t = 1; t <= 16; t++) { g.step(TICKS_PER_HOUR / 2); if (cuts.includes(t)) g = reload(g); }
    return g;
  };
  // Find a moment the body is being carried, then cut there and around it.
  let g = newGame({ seed: 4242 }); runDays(g, 3); mortallyWound(g, g.colonists()[2]);
  let carried = 0;
  for (let t = 1; t <= 16 && !carried; t++) { g.step(TICKS_PER_HOUR / 2); if (Object.values(g.s.bodies || {}).some((b) => b.carriedBy)) carried = t; }
  assert.ok(carried, 'the body was carried at some point');
  const a = run([]), b = run([carried - 1, carried, carried + 1]);
  assert.equal(firstDifference(stateText(a), stateText(b)), null);
  assert.equal(stateText(a), stateText(b));
});

test('saves: a body of no one who died is refused; a format-15 save with the dead loads', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 3);
  const c = g.colonists()[0];
  dies(g, c);
  const text = serializeGame(g);
  const bad = JSON.parse(text);
  Object.values(bad.state.bodies)[0].cid = 'c1';
  assert.throws(() => loadGame(g.reg, JSON.stringify(bad)), /body/);
  const old = JSON.parse(text);
  old.saveFormat = 15; delete old.state.bodies;
  assert.doesNotThrow(() => loadGame(g.reg, JSON.stringify(old)));
});
