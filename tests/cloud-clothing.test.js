// Phase 9, slice 1: leather clothing against the cold (docs/proposals/phase-9-livestock.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame, conservationErrors } from './cloud-helpers.js';
import { issueCommand } from '../src/sim/god.js';
import { coldUnder, lifeRules } from '../src/sim/life.js';
import { outdoorTemp } from '../src/sim/heat.js';
import { warmthOf, wearBody, garmentWants, bestGarment } from '../src/sim/clothing.js';
import { requiredTechs } from '../src/sim/research.js';
import { killColonist } from '../src/sim/death.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

const COAT = 'core:leather_coat';
/** Give colonist c a leather coat (created in the ledger, as if made). */
function giveCoat(g, c) {
  g.ledgerAdd('created', COAT, 1, 'test');
  c.equip.body = { item: COAT, dur: g.reg.get('item', COAT).equipment.durability };
}
const winter = (g) => { const r = issueCommand(g, 'law', { law: 'core:season', value: 'winter' }); assert.equal(r.ok, true, r.reason); g.tick(); };

test('clothing: hides are tanned into leather and leather made into a coat, with no research', () => {
  const g = newGame({ seed: 4242 });
  assert.equal(g.reg.get('item', COAT).equipment.slot, 'body');
  assert.ok(g.reg.get('item', COAT).equipment.warmth > 0);
  assert.equal(g.reg.get('recipe', 'core:tan_hide').inputs[0].item, 'core:hide');
  assert.deepEqual(requiredTechs(g, 'recipe', 'core:tan_hide'), []);
  assert.deepEqual(requiredTechs(g, 'recipe', 'core:make_leather_coat'), []);
  const sid = g.s.playerSettlement;
  assert.equal(bestGarment(g, sid, {}), null, 'nothing to make one from');
  assert.equal(bestGarment(g, sid, { 'core:hide': 2 }).n, 1, 'two hides: four leather: one coat');
  assert.equal(bestGarment(g, sid, { 'core:leather': 8, [COAT]: 1 }).n, 3);
});

test('clothing: a coat moves the cold line down by its warmth, and wears while it keeps the cold out', () => {
  const g = newGame({ seed: 7, scenario: 'core:living_world' });
  runDays(g, 1);
  winter(g);
  const R = lifeRules(g).cold;
  while (outdoorTemp(g) >= R.below - 8) g.tick(); // a cold night
  const c = Object.values(g.s.colonists).find((x) => !x.settlementId || x.settlementId === g.s.playerSettlement);
  c.homeId = null; c.sleeping = true; // exposed
  const bare = coldUnder(g, c);
  assert.ok(bare > 6, `freezing (${bare} °C under the line)`);
  giveCoat(g, c);
  assert.equal(warmthOf(g, c), 6);
  assert.ok(Math.abs(coldUnder(g, c) - (bare - 6)) < 1e-9, 'six degrees warmer');
  assert.equal(coldUnder(g, c, true), bare, 'as if bare');
  const dur = c.equip.body.dur;
  wearBody(g, c, 0.5);
  assert.equal(c.equip.body.dur, dur - 0.5);
  c.equip.body.dur = 0.25;
  wearBody(g, c, 0.5);
  assert.equal(c.equip.body, null, 'worn out');
  assert.deepEqual(conservationErrors(g), [], 'a worn-out coat leaves the ledger as worn');
});

test('clothing: kept in saves; dropped when the wearer dies; old saves load', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const [a, b] = Object.values(g.s.colonists);
  giveCoat(g, a); giveCoat(g, b);
  const r = reload(g);
  assert.equal(stateText(r), stateText(g));
  assert.equal(r.s.colonists[a.id].equip.body.item, COAT);
  runDays(g, 1); runDays(r, 1);
  assert.equal(stateText(r), stateText(g), 'the same after a day');
  killColonist(g, g.s.colonists[b.id], 'test');
  assert.ok(Object.values(g.s.stacks).some((s) => s.item === COAT), 'the coat is left where they fell');
  assert.deepEqual(conservationErrors(g), []);
  const old = JSON.parse(serializeGame(newGame({ seed: 4242 })));
  old.saveFormat = 40;
  const o = loadGame(g.reg, JSON.stringify(old));
  assert.ok(Object.values(o.s.colonists).every((c) => !c.equip.body), 'old saves: nobody wears a coat');
});

test('clothing: the planner wants coats only against coming cold, as many as the stock makes, the homeless first', () => {
  const classic = newGame({ seed: 4242 });
  const person = (n, home) => ({ id: `c${String(n).padStart(2, '0')}`, name: `P${n}`, homeId: home ? 'h1' : null, equip: { tool: null, weapon: null } });
  const four = [person(0, true), person(1, true), person(2, false), person(3, true)];
  assert.deepEqual(garmentWants(classic, classic.s.playerSettlement, four, { 'core:hide': 9 }), [], 'no cold rules: no coats');
  const g = newGame({ seed: 7, scenario: 'core:living_world' });
  const sid = g.s.playerSettlement;
  const summer = issueCommand(g, 'law', { law: 'core:season', value: 'summer' }); assert.equal(summer.ok, true); g.tick();
  assert.deepEqual(garmentWants(g, sid, four, { 'core:hide': 9 }), [], 'mild days ahead: none');
  winter(g);
  assert.deepEqual(garmentWants(g, sid, four, {}), [], 'nothing to make them from: no demand');
  const w = garmentWants(g, sid, four, { 'core:hide': 4 });
  assert.deepEqual(w.map((d) => d.equipFor), ['c02', 'c00'], 'two coats: the homeless first, then by id');
  assert.equal(w[0].slot, 'body');
  assert.match(w[0].why, /leather coat for P2 against the cold/);
  four[2].equip.body = { item: COAT, dur: 5 };
  assert.deepEqual(garmentWants(g, sid, four, { 'core:hide': 4 }).map((d) => d.equipFor), ['c00', 'c01']);
});

test('clothing: as winter comes, a village with hides tans them, makes coats and its people wear them', () => {
  // Living world, seed 5 (on seed 7 the player's village dies of thirst by day 15, with or without clothing).
  const g = newGame({ seed: 5, scenario: 'core:living_world' });
  const sid = g.s.playerSettlement;
  runDays(g, 6);
  const c = g.s.settlements[sid].center;
  g.ledgerAdd('created', 'core:hide', 6, 'test');
  g.placeItems('core:hide', 6, c.x, c.y);
  const own = () => Object.values(g.s.colonists).filter((x) => (x.settlementId || g.s.playerSettlement) === sid);
  let worn = 0;
  for (let d = 6; d < 20 && worn < 2; d++) { g.step(TICKS_PER_DAY); worn = own().filter((x) => x.equip.body).length; }
  assert.ok(worn >= 2, `coats worn (${worn})`);
  assert.ok(Object.values(g.s.structures).some((s) => s.def === 'core:tanning_rack' && s.built), 'a tanning rack was built');
  assert.ok(g.s.log.some((e) => /equipped a Leather coat/.test(e.msg)));
  assert.deepEqual(conservationErrors(g), []);
});
