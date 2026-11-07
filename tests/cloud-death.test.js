// Death (Phase 5, slice 1a): a colonist at 0% health for HEALTH.deathAfterHours dies, by the same rule in full and
// distant villages; everything that named them is cleared, their goods stay in the world, the people ledger adds up,
// and a game with deaths saves and loads to an identical continuation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, firstDifference, conservationErrors, reservationErrors, serializeGame, loadGame, TICKS_PER_DAY } from './cloud-helpers.js';
import { injure, hpOf, HEALTH } from '../src/sim/health.js';
import { peopleCensus } from '../src/sim/godspawn.js';
import { usedNames } from '../src/sim/names.js';
import { encodePlanner } from '../src/sim/plancodec.js';
import { TICKS_PER_HOUR } from '../src/sim/constants.js';

const HOURS = HEALTH.deathAfterHours * TICKS_PER_HOUR;

/** Wounds far beyond what healing can undo in the waiting time: health stays at 0 until death. */
function mortallyWound(g, c) {
  injure(g, c, 'wound', 100, 'Struck down');
  injure(g, c, 'wound', 100, 'Struck down again');
}

/** Every place in the saved state that still holds the id, except where the dead are meant to be named: their
 *  record (s.dead), the log, their body (s.bodies[*].cid) and grave inscriptions (structure.grave.cid). */
function mentions(g, id) {
  const st = JSON.parse(serializeGame(g));
  delete st.state.dead; delete st.state.log;
  for (const b of Object.values(st.state.bodies || {})) if (b.cid === id) delete b.cid;
  for (const x of Object.values(st.state.structures || {})) if (x.grave?.cid === id) delete x.grave.cid;
  const out = [];
  const walk = (v, path) => {
    if (v === id) out.push(path);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === id) out.push(`${path}.${k} (key)`); walk(x, `${path}.${k}`); }
  };
  walk(st, '');
  return out;
}

test('at 0% health a colonist dies after the waiting time, not before', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 2);
  const c = g.colonists()[0], id = c.id;
  mortallyWound(g, c);
  assert.equal(hpOf(c), 0);
  assert.equal(c.health.down, true);
  g.step(HOURS - 50);
  assert.ok(g.s.colonists[id], 'still alive before the waiting time is over');
  g.step(100);
  assert.equal(g.s.colonists[id], undefined, 'dead after it');
  const d = g.s.dead[id];
  assert.equal(d.name, c.name);
  assert.equal(d.cause, 'wound');
  assert.equal(d.text, 'died of their wounds');
  assert.equal(g.s.stats.deaths.wound, 1);
  assert.ok(g.s.log.some((e) => e.cat === 'death' && e.msg.startsWith(c.name)), 'a death line in the log');
});

test('care in time (first aid, tending) lets health rise above 0% and saves the colonist', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const c = g.colonists()[1];
  injure(g, c, 'wound', 100, 'Badly hurt'); // one wound: healing takes it above 0% within the hour
  g.step(HOURS + 200);
  assert.ok(g.s.colonists[c.id], 'alive');
  assert.equal(c.health.zeroSince, undefined);
  assert.equal(g.s.dead, undefined, 'nobody has died, so no record of the dead exists');
});

test('a death clears every reference, keeps the goods and the people ledger exact', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 3);
  const start = g.colonists().length;
  const c = g.colonists().find((x) => x.bedId) || g.colonists()[0], id = c.id;
  const homeId = c.homeId, bedId = c.bedId;
  mortallyWound(g, c);
  g.step(HOURS + 100);
  assert.equal(g.s.colonists[id], undefined);
  assert.deepEqual(mentions(g, id), [], 'nothing in the state names the dead');
  if (bedId) assert.equal(g.s.structures[bedId].owner, undefined, 'the bed is free');
  if (homeId) assert.ok(!g.s.homes[homeId].owners.includes(id), 'the home place is free');
  assert.deepEqual(conservationErrors(g), [], 'items are conserved');
  assert.deepEqual(reservationErrors(g), [], 'reservations match the jobs');
  const pc = peopleCensus(g, start);
  assert.equal(pc.ok, true, pc.problems.join('; '));
  assert.equal(pc.died, 1);
  assert.doesNotThrow(() => encodePlanner(g, { strict: true }), 'no saved plan names the dead');
});

test('the dead person\'s tool and carried goods are put down where they died, still their village\'s', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 4);
  const c = g.colonists().find((x) => x.equip.tool) || g.colonists()[0];
  const tool = c.equip.tool?.item;
  const at = { x: Math.round(c.x), y: Math.round(c.y) };
  mortallyWound(g, c);
  g.step(HOURS + 100);
  if (tool) {
    const near = Object.values(g.s.stacks).filter((s) => s.item === tool && Math.abs(s.x - at.x) <= 3 && Math.abs(s.y - at.y) <= 3);
    assert.ok(near.length >= 1, `the ${tool} lies near where they died`);
    assert.ok(near.every((s) => (s.settlement || g.s.playerSettlement) === g.s.playerSettlement));
  }
  assert.deepEqual(conservationErrors(g), []);
});

test('a game with a death saves and loads to an identical continuation (and before the death, too)', () => {
  const run = (cutAt) => {
    let g = newGame({ seed: 4242 });
    runDays(g, 2);
    mortallyWound(g, g.colonists()[2]);
    for (let h = 1; h <= 30; h++) { g.step(TICKS_PER_HOUR); if (cutAt.includes(h)) g = reload(g); }
    return g;
  };
  const a = run([]), b = run([3, 12]);
  assert.ok(a.s.dead, 'someone died');
  assert.equal(firstDifference(stateText(a), stateText(b)), null);
  assert.equal(stateText(a), stateText(b));
});

test('names stay unique against the dead', () => {
  const g = newGame({ seed: 4242 });
  const c = g.colonists()[0];
  mortallyWound(g, c);
  g.step(HOURS + 100);
  assert.ok(usedNames(g.s).has(c.name));
});

test('a colonist of a distant village dies by the same rule', () => {
  const g = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast' });
  runDays(g, 1);
  const far = Object.values(g.s.settlements).find((x) => x.detail === 'abstract');
  assert.ok(far, 'a distant village');
  const c = g.owned('colonists', far.id)[0];
  mortallyWound(g, c);
  g.step(HOURS + 2 * TICKS_PER_HOUR);
  assert.equal(g.s.colonists[c.id], undefined);
  assert.equal(g.s.dead[c.id].settlementId, far.id);
  assert.deepEqual(mentions(g, c.id), []);
  assert.deepEqual(conservationErrors(g), []);
  assert.equal(stateText(reload(g)), stateText(g));
});

test('saves: a format-14 save without the dead loads; a malformed record of the dead is refused', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const old = JSON.parse(serializeGame(g));
  old.saveFormat = 14;
  assert.doesNotThrow(() => loadGame(g.reg, JSON.stringify(old)));
  const c = g.colonists()[0];
  mortallyWound(g, c);
  g.step(HOURS + 100);
  const bad = JSON.parse(serializeGame(g));
  bad.state.dead[c.id].tick = 'yesterday';
  assert.throws(() => loadGame(g.reg, JSON.stringify(bad)), /dead/);
  const both = JSON.parse(serializeGame(g));
  both.state.dead[g.colonists()[0].id] = { ...both.state.dead[c.id] };
  assert.throws(() => loadGame(g.reg, JSON.stringify(both)), /both living and dead/);
});

test('classic games where nobody reaches 0% health run exactly as before (no record of the dead)', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 10);
  assert.equal(g.s.dead, undefined);
  assert.equal(g.s.stats.deaths, undefined);
});

test('a village where everyone dies keeps running as an empty village (ruins come in slice 6)', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', size: 'medium', villages: 2 });
  runDays(g, 2);
  const st = Object.values(g.s.settlements).find((x) => x.ai);
  for (const c of g.owned('colonists', st.id)) mortallyWound(g, c);
  runDays(g, 3);
  assert.equal(g.owned('colonists', st.id).length, 0);
  assert.ok(g.s.settlements[st.id], 'the village record stays');
  assert.deepEqual(conservationErrors(g), []);
  const b = reload(g);
  runDays(g, 1); runDays(b, 1);
  assert.equal(stateText(g), stateText(b));
});

test('distant villages: with others on their feet a 100% wound heals; when all fall at once, all bleed out', () => {
  const g = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast' });
  runDays(g, 1);
  const far = Object.values(g.s.settlements).filter((x) => x.detail === 'abstract');
  const [a, b] = far;
  const one = g.owned('colonists', a.id)[0];
  injure(g, one, 'wound', 100, 'Badly hurt');
  const all = g.owned('colonists', b.id);
  for (const c of all) injure(g, c, 'wound', 100, 'Badly hurt');
  const start = g.colonists().length;
  g.step(HOURS + 2 * TICKS_PER_HOUR);
  assert.ok(g.s.colonists[one.id], 'cared for by the others: alive');
  for (const c of all) assert.equal(g.s.colonists[c.id], undefined, `${c.name} bled out with nobody to help`);
  assert.equal(Object.keys(g.s.dead).length, all.length);
  assert.equal(g.colonists().length, start - all.length);
  assert.deepEqual(conservationErrors(g), []);
  assert.doesNotThrow(() => encodePlanner(g, { strict: true }));
});

test('saves: malformed death counts, times at 0% and ids not yet given out are refused', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const c = g.colonists()[0];
  mortallyWound(g, c);
  g.step(HOURS + 100);
  const base = serializeGame(g);
  const tamper = (f) => { const x = JSON.parse(base); f(x.state); return JSON.stringify(x); };
  assert.throws(() => loadGame(g.reg, tamper((st) => { st.stats.deaths = 5; })), /deaths/);
  assert.throws(() => loadGame(g.reg, tamper((st) => { st.colonists[Object.keys(st.colonists)[0]].health = { injuries: [], zeroSince: st.tick + 10 }; })), /0% health/);
  assert.throws(() => loadGame(g.reg, tamper((st) => { st.dead[`c${st.nextId + 5}`] = st.dead[c.id]; })), /not yet given out/);
  assert.doesNotThrow(() => loadGame(g.reg, base));
});
