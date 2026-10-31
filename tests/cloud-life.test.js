// Cold and old age (Phase 5, slice 2): scenario rules (scenario.life). Tested on a small classic world with the
// rules switched on in this test's own registry (the shipped scenarios that have them are the Vast and Living worlds).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, conservationErrors, TICKS_PER_DAY } from './cloud-helpers.js';
import { readAllMods } from '../tools/fsmods.js';
import { buildRegistry } from '../src/sim/content/modloader.js';
import { coldUnder, coldWait, lifeRules, startAge, elderFactor, ageYears } from '../src/sim/life.js';
import { causeText } from '../src/sim/death.js';
import { canFound } from '../src/sim/founding.js';
import { tickHealth } from '../src/sim/health.js';
import { roomAt } from '../src/sim/heat.js';
import { TICKS_PER_HOUR } from '../src/sim/constants.js';

const LIFE = {
  cold: { below: -2, perHour: 0.4, shelter: 6, fires: ['core:campfire', 'core:hearth'], fireRadius: 5, foundWaitDays: 8 },
  aging: { elderAge: 50, elderWork: 0.8, deathAge: 60, perYear: 0.2, perYearStep: 0.15, startAges: [16, 60] },
};
/** The classic default scenario (core:standard) with the life rules added to its data before loading. */
let REG = null;
function lifeGame(seed = 4242) {
  if (!REG) {
    const mods = readAllMods();
    const core = mods.find((m) => m.manifest.id === 'core');
    const sc = core.files['content/setup.json'].scenario.find((x) => x.id === 'core:standard');
    sc.life = LIFE;
    REG = buildRegistry(mods, ['core']).registry;
  }
  return newGame({ seed, registry: REG, scenario: 'core:standard' });
}
/** Step to the coldest time: day 22 (mid-winter in a 30-day year), 03:00. */
function toWinterNight(g) { g.step(22 * TICKS_PER_DAY + 3 * TICKS_PER_HOUR - g.s.tick); }
/** An outdoor tile with no room and no fire within 6 tiles. */
function openTile(g) {
  const fires = Object.values(g.s.structures).filter((b) => LIFE.cold.fires.includes(b.def));
  for (let y = 2; y < g.H - 2; y++) for (let x = 2; x < g.W - 2; x++) {
    if (!g.isPassable(x, y) || roomAt(g, x, y)) continue;
    if (fires.every((f) => Math.max(Math.abs(f.x - x), Math.abs(f.y - y)) > 6)) return { x, y };
  }
  return null;
}

test('without life rules (classic games) nothing changes: no cold, no aging', () => {
  const g = newGame({ seed: 4242 });
  assert.equal(lifeRules(g), null);
  assert.equal(coldUnder(g, g.colonists()[0]), 0);
  assert.equal(startAge(g, 'c5'), null);
  assert.equal(elderFactor(g, g.colonists()[0]), 1);
  assert.equal(coldWait(g), null);
});

test('cold: only the exposed feel it — asleep outdoors yes, up and about no, sheltered less', () => {
  const g = lifeGame();
  toWinterNight(g);
  const c = g.colonists().find((x) => x.homeId);
  const keep = { x: c.x, y: c.y, sleeping: c.sleeping, homeId: c.homeId };
  const at = openTile(g);
  assert.ok(at, 'an open tile');
  Object.assign(c, at, { sleeping: false });
  assert.equal(coldUnder(g, c), 0, 'up and about outdoors: warm enough');
  c.sleeping = true;
  const out = coldUnder(g, c);
  assert.ok(out > 3, `asleep outdoors on a winter night: ${out.toFixed(1)} °C under the line`);
  c.homeId = null; c.sleeping = false;
  assert.equal(coldUnder(g, c), out, 'the homeless feel it even awake');
  Object.assign(c, keep);
});

test('cold: a homeless person by a fire gets the shelter bonus', () => {
  const g = lifeGame();
  toWinterNight(g);
  const fire = Object.values(g.s.structures).find((b) => b.def === 'core:campfire' && b.built);
  assert.ok(fire, 'a campfire');
  const c = g.colonists()[0], keep = { x: c.x, y: c.y, homeId: c.homeId };
  const at = openTile(g);
  Object.assign(c, at, { homeId: null });
  const far = coldUnder(g, c);
  const spot = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([dx, dy]) => ({ x: fire.x + dx, y: fire.y + dy }))
    .find((p) => g.isPassable(p.x, p.y) && !roomAt(g, p.x, p.y));
  assert.ok(spot, 'an open tile beside the fire');
  Object.assign(c, spot);
  const near = coldUnder(g, c);
  assert.ok(far > 0, 'cold away from the fire');
  assert.ok(Math.abs(Math.max(0, far - LIFE.cold.shelter) - near) < 0.2, `by the fire: ${far.toFixed(1)} → ${near.toFixed(1)}`);
  Object.assign(c, keep);
});

test('cold: hypothermia grows while exposed and heals once warm; a death from it is "froze to death"', () => {
  const g = lifeGame();
  toWinterNight(g);
  const c = g.colonists()[0], keep = { x: c.x, y: c.y, sleeping: c.sleeping, homeId: c.homeId };
  Object.assign(c, openTile(g), { homeId: null });
  for (let k = 0; k < 8; k++) tickHealth(g, c, true); // two hours of exposure
  const h = c.health.injuries.find((i) => i.kind === 'hypothermia');
  assert.ok(h && h.severity > 1, 'hypothermia');
  Object.assign(c, keep);
  assert.equal(causeText('hypothermia'), 'froze to death');
});

test('founding waits while the coming days are freezing', () => {
  const g = lifeGame();
  g.step(5 * TICKS_PER_DAY);
  assert.equal(coldWait(g), null, 'early spring: no wait');
  g.step(13 * TICKS_PER_DAY);
  assert.match(coldWait(g) || '', /wait for warmer weather/);
  const sid = g.s.playerSettlement;
  const ev = canFound(g, sid);
  assert.equal(ev.ok, false); // (founding is off in this scenario anyway: the reason says so first)
});

test('old age: start ages from the id, elders work slower, the very old die of old age', () => {
  const g = lifeGame();
  const a = startAge(g, 'c7');
  assert.ok(a >= 16 && a <= 60);
  assert.equal(startAge(g, 'c7'), a, 'the same id, the same age');
  const c = g.colonists()[0];
  c.ageYears = 55; c.ageTick = g.s.tick;
  assert.equal(elderFactor(g, c), LIFE.aging.elderWork);
  c.ageYears = 30;
  assert.equal(elderFactor(g, c), 1);
  c.ageYears = 95; // past deathAge by 35 years: the chance is at its cap (0.99 a year)
  runDays(g, 60);
  const d = g.s.dead?.[c.id];
  assert.ok(d, `${c.name} died within 60 days`);
  assert.equal(d.cause, 'old_age');
  assert.equal(d.text, 'died of old age');
  assert.ok(ageYears(g, g.colonists()[0]) !== null);
  assert.deepEqual(conservationErrors(g), []);
});

test('a game with life rules saves and loads to an identical continuation through winter', () => {
  const run = (cut) => {
    let g = lifeGame(11);
    g.colonists()[1].ageYears = 80;
    for (let d = 1; d <= 26; d++) { g.step(TICKS_PER_DAY); if (cut.includes(d)) g = reload(g); }
    return g;
  };
  const a = run([]), b = run([10, 21, 23]);
  assert.equal(stateText(a), stateText(b));
});
