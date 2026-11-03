// Phase 9, slice 3: pens and taming (docs/proposals/phase-9-livestock.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame, conservationErrors } from './cloud-helpers.js';
import { createProject, findSite, completeStructure } from '../src/sim/construction.js';
import { pensOf, penState, PEN } from '../src/sim/pens.js';
import { tameInto, penAnimals, penInterior, livestockCensus } from '../src/sim/livestock.js';
import { animalCensus, bringNear, herdAnimals } from '../src/sim/animals.js';
import { roomAt } from '../src/sim/heat.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

/** Lay out a pen for species sp near the player's centre and build it at once (its wood created in the ledger). */
function builtPen(g, sp) {
  const sid = g.s.playerSettlement, tpl = g.reg.get('template', 'core:animal_pen');
  const site = findSite(g, tpl, { center: g.s.settlements[sid].center, sid });
  assert.ok(site, 'room for a pen');
  const p = createProject(g, tpl, site, { owner: sid, why: 'test' });
  p.pen = { sp };
  for (const id of p.parts) {
    const st = g.s.structures[id], cost = g.bDef(st).cost;
    for (const c of cost) g.ledgerAdd('created', c.item, c.qty, 'test');
    st.delivered = Object.fromEntries(cost.map((c) => [c.item, c.qty]));
    completeStructure(g, st, null);
  }
  return p;
}

test('pens: a ring of fences with a gate; closed only when all stand; never a room', () => {
  const g = newGame({ seed: 5, scenario: 'core:living_world' });
  runDays(g, 1);
  const sid = g.s.playerSettlement, tpl = g.reg.get('template', 'core:animal_pen');
  const site = findSite(g, tpl, { center: g.s.settlements[sid].center, sid });
  const p = createProject(g, tpl, site, { owner: sid, why: 'test' });
  p.pen = { sp: 'core:wild_sheep' };
  assert.deepEqual(penState(g, p), { closed: false, missing: 20 }, '19 fence sections and a gate');
  for (const id of p.parts) {
    const st = g.s.structures[id], cost = g.bDef(st).cost;
    for (const c of cost) g.ledgerAdd('created', c.item, c.qty, 'test');
    st.delivered = Object.fromEntries(cost.map((c) => [c.item, c.qty]));
    completeStructure(g, st, null);
  }
  assert.equal(penState(g, p).closed, true);
  const inside = penInterior(g, p);
  assert.equal(inside.length, 15, 'five by three open ground');
  assert.ok(inside.every((q) => roomAt(g, q.x, q.y) === null), 'a pen is not a room (no shelter from the cold)');
  assert.ok(p.parts.map((id) => g.s.structures[id]).filter((b) => g.bDef(b).passable).length === 1, 'one gate people pass');
  assert.deepEqual(pensOf(g, sid).map((x) => x.id), [p.id]);
  g.removeStructure(p.parts[0]);
  assert.equal(penState(g, p).closed, false, 'a fence gone: open again');
  assert.deepEqual(conservationErrors(g), []);
});

test('taming: a caught animal leaves the wild and becomes tame in one step; both ledgers stay exact; saves', () => {
  const g = newGame({ seed: 5, scenario: 'core:living_world' });
  runDays(g, 1);
  const sid = g.s.playerSettlement;
  const h = Object.values(g.s.animals.herds).filter((x) => x.sp === 'core:wild_cattle').sort((a, b) => b.n - a.n)[0];
  const p = builtPen(g, h.sp);
  bringNear(g, h.id);
  const wild = herdAnimals(g, h.id)[0];
  assert.ok(wild, 'a wild cow near');
  const n0 = h.n, c = g.owned('colonists', sid)[0];
  const a = tameInto(g, wild.id, p, c);
  assert.equal(a.sp, 'core:wild_cattle');
  assert.equal(g.s.animals.list?.[wild.id], undefined, 'gone from the wild');
  assert.equal(g.s.animals.herds[h.id].n, n0 - 1);
  assert.equal(g.s.animals.ledger['core:wild_cattle'].died.tamed, 1);
  assert.equal(g.s.livestock.ledger[sid]['core:wild_cattle'].tamed, 1);
  assert.ok(animalCensus(g).ok && livestockCensus(g).ok);
  assert.equal(tameInto(g, wild.id, p, c), null, 'not twice');
  assert.equal(Object.keys(g.s.livestock.list).length, 1);
  const r = reload(g);
  assert.equal(stateText(r), stateText(g));
  g.step(300); r.step(300);
  assert.equal(stateText(r), stateText(g), 'the same after 300 ticks');
  const old = JSON.parse(serializeGame(newGame({ seed: 4242 })));
  old.saveFormat = 41;
  assert.equal(loadGame(g.reg, JSON.stringify(old)).s.livestock, undefined, 'old saves: no livestock');
  const bad = JSON.parse(serializeGame(g));
  bad.state.livestock.list[a.id].x = -5;
  assert.throws(() => loadGame(g.reg, JSON.stringify(bad)), /tame animal/);
});

test('pens and taming in play: a village of six lays out a pen with its reason, closes it and tames a pair', () => {
  const g = newGame({ seed: 5, scenario: 'core:living_world' });
  const sid = g.s.playerSettlement;
  let p = null, d = 0;
  for (; d < 40 && !(p && penAnimals(g, p).length >= 2 && penAnimals(g, p).every((a) => penInterior(g, p).set.has(`${a.x},${a.y}`))); d++) {
    g.step(TICKS_PER_DAY);
    p ||= pensOf(g, sid)[0] || null;
    if (p && !g._sawPlan) { g._sawPlan = true; assert.ok(g.owned('colonists', sid).length >= PEN.minPeople, 'only at six people'); assert.match(p.why, /^A pen for (sheep|cattle|pigs) \(a herd of \d+ wild/); }
  }
  assert.ok(p, 'a pen was laid out');
  assert.equal(penState(g, p).closed, true);
  const tame = penAnimals(g, p);
  assert.equal(tame.length, 2, `a pair tamed by day ${d}`);
  assert.ok(tame.every((a) => a.sp === p.pen.sp));
  assert.ok(animalCensus(g).ok, animalCensus(g).problems.join('; '));
  assert.ok(livestockCensus(g).ok, livestockCensus(g).problems.join('; '));
  g.step(500);
  assert.ok(penAnimals(g, p).every((a) => penInterior(g, p).set.has(`${a.x},${a.y}`)), 'they stay inside');
  assert.deepEqual(conservationErrors(g), []);
});
