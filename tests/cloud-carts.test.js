// Phase 7, slice 4: handcarts (docs/proposals/phase-7-roads.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame, conservationErrors } from './cloud-helpers.js';
import { completeStructure } from '../src/sim/construction.js';
import { cartOf, cartWants, bestCart, wearCart, CART } from '../src/sim/roads.js';
import { requiredTechs } from '../src/sim/research.js';
import { CARRY_LIMIT } from '../src/sim/constants.js';
import { killColonist } from '../src/sim/death.js';

/** Give colonist c a handcart (created in the ledger, as if made). */
function giveCart(g, c) {
  g.ledgerAdd('created', 'core:handcart', 1, 'test');
  c.equip.cart = { item: 'core:handcart', dur: g.reg.get('item', 'core:handcart').equipment.durability };
}

test('carts: researched (Wheelwrighting, after Ironworking) and made at the workbench', () => {
  const g = newGame({ seed: 4242 });
  const t = g.reg.get('tech', 'core:wheelwrighting');
  assert.ok(t.prerequisites.includes('core:ironworking'));
  assert.deepEqual(requiredTechs(g, 'recipe', 'core:make_handcart'), ['core:wheelwrighting']);
  const r = g.reg.get('recipe', 'core:make_handcart');
  assert.equal(r.station, 'core:workbench');
  assert.equal(g.reg.get('item', 'core:handcart').equipment.slot, 'cart');
  const sid = g.s.playerSettlement;
  assert.equal(bestCart(g, sid), null, 'not before the research');
  g.s.settlements[sid].research.done.push('core:wheelwrighting');
  assert.equal(bestCart(g, sid)?.id, 'core:handcart');
});

test('carts: a hauler with a cart carries more (up to a stack); loaded, slower off a road, as quick on one', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const c = Object.values(g.s.colonists)[0];
  const wood = g.reg.get('item', 'core:wood').stackLimit;
  assert.equal(g.carryLimit('core:wood', c), Math.min(CARRY_LIMIT, wood));
  giveCart(g, c);
  assert.equal(cartOf(g, c).carry, 3);
  assert.equal(g.carryLimit('core:wood', c), Math.min(CARRY_LIMIT * 3, wood), 'a bigger load, at most a stack');
  assert.ok(g.carryLimit('core:wood', c) > CARRY_LIMIT);
  assert.equal(g.carryLimit('core:wood'), Math.min(CARRY_LIMIT, wood), 'others as before');
  // Steps: find an open tile; empty-handed, a cart changes nothing; loaded, off a road it is slower.
  const ctr = g.s.settlements[g.s.playerSettlement].center;
  let p = null;
  for (let d = 3; d < 20 && !p; d++) for (let dx = -d; dx <= d && !p; dx++) {
    const x = ctr.x + dx, y = ctr.y + d;
    if (g.inB(x, y) && g.isPassable(x, y) && g.terrainAt(x, y).buildable && !g.structAt(x, y) && !g.nodeAt(x, y) && !g.cropAt(x, y) && !g.zoneAt(g.i(x, y))) p = { x, y };
  }
  assert.ok(p);
  const plain = g.moveCost(p.x, p.y);
  assert.equal(g.stepCost(p.x, p.y, c), plain, 'empty-handed: as before');
  c.carry = { item: 'core:wood', qty: 1 }; g.ledgerAdd('created', 'core:wood', 1, 'test');
  assert.equal(g.stepCost(p.x, p.y, c), plain * 1.25, 'loaded: slower off the road');
  const st = g.addStructure('core:road', p.x, p.y, { settlement: g.s.playerSettlement });
  g.ledgerAdd('created', 'core:stone', 1, 'test');
  st.delivered = { 'core:stone': 1 };
  completeStructure(g, st, null);
  assert.equal(g.stepCost(p.x, p.y, c), 0.6, 'on the road: a road step');
  assert.deepEqual(conservationErrors(g), []);
});

test('carts: hauling with a cart moves bigger loads; the cart wears out by loads; nothing is duplicated', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  for (const c of Object.values(g.s.colonists)) giveCart(g, c);
  let loads = 0, saved = false;
  for (let t = 0; t < 3000; t++) {
    g.tick();
    for (const c of Object.values(g.s.colonists)) if (c.job?.type === 'haul' && c.job.loads > loads) loads = c.job.loads;
    if (!saved && loads > 1) { saved = true; const r = reload(g); assert.equal(stateText(r), stateText(g), 'a cart trip saves and loads'); g.step(200); r.step(200); assert.equal(stateText(r), stateText(g)); }
  }
  assert.ok(loads > 1, `a trip picks up several piles (most ${loads})`);
  assert.ok(Object.values(g.s.colonists).some((c) => c.equip.cart && c.equip.cart.dur < 400), 'loads wear the cart');
  assert.deepEqual(conservationErrors(g), []);
  const c = Object.values(g.s.colonists).find((x) => x.equip.cart);
  c.equip.cart.dur = 1;
  wearCart(g, c);
  assert.equal(c.equip.cart, null, 'worn out');
  assert.deepEqual(conservationErrors(g), [], 'a worn-out cart leaves the ledger as worn');
});

test('carts: kept in saves; dropped when the person dies; old saves load', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const [a, b] = Object.values(g.s.colonists);
  giveCart(g, a); giveCart(g, b);
  const r = reload(g);
  assert.equal(stateText(r), stateText(g));
  assert.equal(r.s.colonists[a.id].equip.cart.item, 'core:handcart');
  runDays(g, 1); runDays(r, 1);
  assert.equal(stateText(r), stateText(g), 'the same after a day');
  killColonist(g, g.s.colonists[b.id], 'test');
  assert.ok(Object.values(g.s.stacks).some((s) => s.item === 'core:handcart'), 'the cart is left where they fell');
  assert.deepEqual(conservationErrors(g), []);
  const old = JSON.parse(serializeGame(newGame({ seed: 4242 })));
  old.saveFormat = 39;
  const o = loadGame(g.reg, JSON.stringify(old));
  assert.ok(Object.values(o.s.colonists).every((c) => !c.equip.cart), 'old saves: nobody has a cart');
});

test('carts: the planner wants one cart for every six adults in villages of eight or more, keeping holders first', () => {
  const g = newGame({ seed: 4242 });
  const sid = g.s.playerSettlement;
  const person = (n, cart) => ({ id: `c${String(n).padStart(2, '0')}`, name: `P${n}`, equip: { tool: null, weapon: null, ...(cart ? { cart: { item: 'core:handcart', dur: 9 } } : {}) } });
  const twelve = Array.from({ length: 12 }, (_, i) => person(i, i === 7));
  assert.deepEqual(cartWants(g, sid, twelve, {}), [], 'nothing before the research');
  g.s.settlements[sid].research.done.push('core:wheelwrighting');
  const w = cartWants(g, sid, twelve, {});
  assert.equal(Math.floor(12 / CART.perPeople), 2);
  assert.deepEqual(w.map((d) => d.equipFor), ['c00'], 'c07 keeps theirs; c00 is next');
  assert.equal(w[0].slot, 'cart');
  assert.match(w[0].why, /handcart for P0 to haul with/);
  assert.deepEqual(cartWants(g, sid, twelve.slice(0, CART.minPeople - 1), {}), [], 'a small village wants none');
  twelve[0].workOff = { 'core:haul': true };
  assert.deepEqual(cartWants(g, sid, twelve, {}).map((d) => d.equipFor), ['c01'], 'not for someone who does not haul');
});
