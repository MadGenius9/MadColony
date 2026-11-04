// Phase 9, slice 3: pens and taming (docs/proposals/phase-9-livestock.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame, conservationErrors } from './cloud-helpers.js';
import { createProject, findSite, completeStructure } from '../src/sim/construction.js';
import { pensOf, penState, PEN } from '../src/sim/pens.js';
import { tameInto, penAnimals, penInterior, livestockCensus, tickLivestockDay, penEats, FEED, toSlaughter } from '../src/sim/livestock.js';
import { issueCommand } from '../src/sim/god.js';
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

/** Put n tame animals of sp in pen p (as if tamed: booked in the livestock ledger). */
function stock(g, p, sp, n) {
  const S = (g.s.livestock ||= { next: 1, list: {}, ledger: {} });
  const cells = penInterior(g, p);
  for (let k = 0; k < n; k++) {
    const id = 'l' + S.next++, at = cells[k % cells.length];
    S.list[id] = { id, sp, sid: p.settlement, pen: p.id, x: at.x, y: at.y, hp: 10 };
    const L = ((S.ledger[p.settlement] ||= {})[sp] ||= { tamed: 0, born: 0, died: {} }); L.tamed++;
  }
}
const law = (g, v) => { const r = issueCommand(g, 'law', { law: 'core:season', value: v }); assert.equal(r.ok, true, r.reason); g.tick(); };

test('feed: grass feeds a pen outside winter; in winter the animals eat from the trough, and starve without it', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const p = builtPen(g, 'core:wild_cattle');
  stock(g, p, 'core:wild_cattle', 2);
  law(g, 'summer');
  for (let d = 0; d < 6; d++) tickLivestockDay(g);
  assert.equal(penAnimals(g, p).length, 2, 'grass feeds them in summer');
  assert.ok(penAnimals(g, p).every((a) => !a.hungry));
  law(g, 'winter');
  assert.equal(penEats(g, p, 2), 2, 'in winter each eats a unit a day');
  p.feed = 3;
  tickLivestockDay(g);
  assert.equal(p.feed, 1, 'two eaten from the trough');
  tickLivestockDay(g);
  assert.deepEqual(penAnimals(g, p).map((a) => a.hungry || 0), [0, 1], 'one fed, one hungry');
  for (let d = 0; d < FEED.starve; d++) tickLivestockDay(g);
  assert.equal(penAnimals(g, p).length, 0, 'unfed for five days: they starve');
  assert.equal(g.s.livestock.ledger[g.s.playerSettlement]['core:wild_cattle'].died.starved, 2);
  assert.equal(Object.values(g.s.stacks).filter((s) => s.item === 'core:cattle_carcass').length, 2, 'their carcasses are left');
  assert.ok(livestockCensus(g).ok, livestockCensus(g).problems.join('; '));
  assert.deepEqual(conservationErrors(g), []);
});

test('feed: in winter haulers carry fodder into the trough, so the animals are fed', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const p = builtPen(g, 'core:wild_cattle');
  stock(g, p, 'core:wild_cattle', 2);
  law(g, 'winter');
  const ctr = g.s.settlements[g.s.playerSettlement].center;
  g.ledgerAdd('created', 'core:potato', 20, 'test');
  g.placeItems('core:potato', 20, ctr.x, ctr.y);
  let fed = false;
  for (let t = 0; t < 2 * TICKS_PER_DAY && !fed; t++) { g.tick(); fed = (p.feed || 0) > 0; }
  assert.ok(fed, 'fodder carried in');
  assert.equal(g.s.ledger.byReason['consumed:fodder']['core:potato'], p.feed, 'what is in the trough is booked as eaten fodder');
  g.step(2 * TICKS_PER_DAY);
  assert.ok(penAnimals(g, p).every((a) => !a.hungry), 'fed through the winter days');
  assert.deepEqual(conservationErrors(g), []);
});

test('births: a fed pair in spring has young, up to the pen\'s room; saved and loaded identically', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const p = builtPen(g, 'core:wild_boar');
  stock(g, p, 'core:wild_boar', 2);
  let born = 0;
  for (let d = 0; d < 90 && !born; d++) { g.step(TICKS_PER_DAY); born = g.s.livestock.ledger[g.s.playerSettlement]['core:wild_boar'].born; } // boar breed fastest (births 0.5)
  assert.ok(born >= 1, 'a birth within three springs');
  assert.ok(penAnimals(g, p).length <= 8);
  assert.ok(livestockCensus(g).ok);
  const r = reload(g);
  assert.equal(stateText(r), stateText(g));
  runDays(g, 1); runDays(r, 1);
  assert.equal(stateText(r), stateText(g));
});

test('products: fed cows are milked every two days and sheep sheared; neither is harmed', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  law(g, 'summer');
  const cows = builtPen(g, 'core:wild_cattle');
  stock(g, cows, 'core:wild_cattle', 2);
  const made = (it) => g.s.ledger.byReason['created:livestock']?.[it] || 0;
  for (let t = 0; t < 3 * TICKS_PER_DAY && made('core:milk') < 4; t++) g.tick();
  assert.ok(made('core:milk') >= 4, `both cows milked (${made('core:milk')} milk)`);
  assert.equal(penAnimals(g, cows).length, 2, 'milking harms none');
  assert.ok(penAnimals(g, cows).every((a) => a.next > g.s.tick - TICKS_PER_DAY), 'each has a time it is ready again');
  const milked = made('core:milk');
  g.step(TICKS_PER_DAY / 2);
  assert.equal(made('core:milk'), milked, 'not again before two days');
  const sheep = builtPen(g, 'core:wild_sheep');
  stock(g, sheep, 'core:wild_sheep', 2);
  for (let t = 0; t < 3 * TICKS_PER_DAY && made('core:wool') < 6; t++) g.tick();
  assert.equal(made('core:wool'), 6, 'two sheep, three wool each');
  assert.equal(penAnimals(g, sheep).length, 2, 'shearing never kills a sheep');
  assert.ok(livestockCensus(g).ok);
  assert.deepEqual(conservationErrors(g), []);
});

test('slaughter: a full pen loses one above the breeding stock, exactly once; a pair is never slaughtered', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  law(g, 'summer');
  const pigs = builtPen(g, 'core:wild_boar');
  stock(g, pigs, 'core:wild_boar', 8);
  const P = g.planOf({ settlementId: g.s.playerSettlement });
  assert.equal(toSlaughter(g, pigs, P)?.id, penAnimals(g, pigs).at(-1).id, 'full: the youngest');
  const sid = g.s.playerSettlement;
  for (let t = 0; t < 2 * TICKS_PER_DAY && !g.s.livestock.ledger[sid]['core:wild_boar'].died.butchered; t++) g.tick();
  assert.equal(g.s.livestock.ledger[sid]['core:wild_boar'].died.butchered, 1, 'one slaughtered');
  assert.equal(penAnimals(g, pigs).length, 7);
  assert.equal(g.s.ledger.byReason['created:livestock']['core:boar_carcass'], 1, 'its carcass made once');
  assert.ok(livestockCensus(g).ok);
  assert.deepEqual(conservationErrors(g), []);
  const pair = builtPen(g, 'core:wild_cattle');
  stock(g, pair, 'core:wild_cattle', 2);
  assert.equal(toSlaughter(g, pair, { foodDays: 0 }), null, 'the breeding pair is kept even when meat is short');
});

test('distant villages: the pen is fed from the village stock, gives its products into it, in aggregate', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const sid = g.s.playerSettlement, st = g.s.settlements[sid];
  const p = builtPen(g, 'core:wild_cattle');
  stock(g, p, 'core:wild_cattle', 2);
  g.ledgerAdd('created', 'core:potato', 30, 'test');
  g.placeItems('core:potato', 30, st.center.x, st.center.y);
  const potatoes = () => Object.values(g.s.stacks).filter((s) => s.item === 'core:potato').reduce((a, s) => a + s.qty, 0);
  const before = potatoes();
  law(g, 'winter');
  const was = st.detail;
  st.detail = 'abstract'; // as a distant village (nobody walks there)
  for (let d = 0; d < 6; d++) tickLivestockDay(g);
  assert.ok(penAnimals(g, p).every((a) => !a.hungry), 'fed through six winter days');
  assert.equal(before - potatoes(), 12 + (p.feed || 0), 'two a day taken from its stock (and what is left in the trough)');
  law(g, 'summer');
  for (let d = 0; d < 3; d++) tickLivestockDay(g);
  assert.ok((g.s.ledger.byReason['created:livestock']?.['core:milk'] || 0) >= 4, 'milk into its stock');
  if (was === undefined) delete st.detail; else st.detail = was;
  assert.ok(livestockCensus(g).ok);
  assert.deepEqual(conservationErrors(g), []);
});

test('review fixes: a distant AI village\'s pen gives to its own stock; a destroyed pen\'s animals run off, booked once', async () => {
  const { destroyProject } = await import('../src/sim/ruin.js');
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  runDays(g, 1);
  const ai = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort()[0], st = g.s.settlements[ai];
  const tpl = g.reg.get('template', 'core:animal_pen');
  const site = findSite(g, tpl, { center: st.center, sid: ai });
  assert.ok(site, 'room for a pen at the AI village');
  const p = createProject(g, tpl, site, { owner: ai, why: 'test' });
  p.pen = { sp: 'core:wild_cattle' };
  for (const id of p.parts) {
    const b = g.s.structures[id], cost = g.bDef(b).cost;
    for (const c of cost) g.ledgerAdd('created', c.item, c.qty, 'test');
    b.delivered = Object.fromEntries(cost.map((c) => [c.item, c.qty]));
    completeStructure(g, b, null);
  }
  stock(g, p, 'core:wild_cattle', 2);
  const was = st.detail;
  st.detail = 'abstract';
  law(g, 'summer');
  for (let d = 0; d < 3; d++) tickLivestockDay(g);
  const milk = Object.values(g.s.stacks).filter((x) => x.item === 'core:milk');
  assert.ok(milk.length > 0, 'milk made');
  assert.ok(milk.every((x) => x.settlement === ai), 'and it is the AI village\'s, not the player\'s');
  if (was === undefined) delete st.detail; else st.detail = was;
  destroyProject(g, p.id);
  assert.deepEqual(pensOf(g, ai), [], 'a destroyed pen is no pen (a new one can be laid out)');
  tickLivestockDay(g);
  assert.equal(penAnimals(g, p).length, 0, 'its animals ran off');
  assert.equal(g.s.livestock.ledger[ai]['core:wild_cattle'].died.escaped, 2);
  assert.ok(livestockCensus(g).ok);
  assert.deepEqual(conservationErrors(g), []);
});

test('review fixes: a tame animal with a bad hunger or next field is refused on load', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const p = builtPen(g, 'core:wild_cattle');
  stock(g, p, 'core:wild_cattle', 1);
  const save = JSON.parse(serializeGame(g));
  Object.values(save.state.livestock.list)[0].hungry = 'x';
  assert.throws(() => loadGame(g.reg, JSON.stringify(save)), /tame animal/);
});

test('balance: a pen is culled for meat only once it has grown two beyond its breeding pair', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const p = builtPen(g, 'core:wild_cattle');
  stock(g, p, 'core:wild_cattle', 3);
  const short = { foodDays: 0 }; // no meat on hand: short
  assert.equal(toSlaughter(g, p, short), null, 'three: kept to grow');
  stock(g, p, 'core:wild_cattle', 1);
  assert.equal(toSlaughter(g, p, short)?.id, penAnimals(g, p).at(-1).id, 'four: the youngest for meat');
});
