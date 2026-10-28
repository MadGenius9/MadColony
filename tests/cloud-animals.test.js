// Phase 8, slice 1: species and far herds (animals.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame, conservationErrors } from './cloud-helpers.js';
import { herdCensus, animalSpecies, foldHerdForTest } from '../src/sim/animals.js';
import { issueCommand } from '../src/sim/god.js';
import { planNow } from '../src/sim/planner.js';
import { endJob } from '../src/sim/ai/ai.js';
import { newJob } from '../src/sim/ai/jobs.js';
import { causeText } from '../src/sim/death.js';
import { seasonOf } from '../src/sim/heat.js';
import { readAllMods } from '../tools/fsmods.js';
import { buildRegistry } from '../src/sim/content/modloader.js';

test('every game has herds, placed on their ground away from villages; the world itself is unchanged', () => {
  const g = newGame({ seed: 4242 });
  const nodes = JSON.stringify(g.s.nodes);
  g.tick();
  const herds = Object.values(g.s.animals.herds);
  assert.ok(herds.length > 0, 'herds placed');
  for (const h of herds) {
    const d = g.reg.get('animal', h.sp);
    assert.ok(d.terrains.includes(g.terrainAt(g.i(h.x, h.y))), 'on its ground');
    assert.ok(h.n >= d.herd[0] && h.n <= d.herd[1], 'a herd of its size');
    for (const v of Object.values(g.s.settlements)) assert.ok(Math.hypot(v.center.x - h.x, v.center.y - h.y) >= 24, 'away from villages');
  }
  assert.equal(JSON.stringify(g.s.nodes), nodes, 'placing herds changes nothing else');
});

test('herds live through a year: they move, breed in spring, lose some in winter, stay within limits; saves identical', () => {
  const run = (cut) => {
    let g = newGame({ seed: 4242 });
    for (let d = 1; d <= 40; d++) { runDays(g, 1); if (cut.includes(d)) g = reload(g); }
    return g;
  };
  const g = run([]);
  const c = herdCensus(g);
  assert.ok(c['core:deer']?.animals > 0, 'deer survive a year');
  for (const h of Object.values(g.s.animals.herds)) assert.ok(h.n >= 2 && h.n <= g.reg.get('animal', h.sp).herd[1] * 1.5, 'herd sizes within limits');
  assert.equal(stateText(run([7, 25])), stateText(g), 'save and load mid-year: identical');
  assert.deepEqual(conservationErrors(g), []);
});

test('a scenario can turn animals off; a malformed herd is refused; an older save gets herds at the next tick', () => {
  const mods = readAllMods(), core = mods.find((m) => m.manifest.id === 'core');
  for (const sc of core.files['content/setup.json'].scenario) if (sc.id === 'core:standard') sc.animals = { species: [] };
  const registry = buildRegistry(mods, ['core']).registry;
  const off = newGame({ seed: 4242, registry, scenario: 'core:standard' });
  runDays(off, 1);
  assert.equal(animalSpecies(off).length, 0);
  assert.equal(off.s.animals, undefined);
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const text = serializeGame(g);
  const bad = JSON.parse(text);
  Object.values(bad.state.animals.herds)[0].n = -3;
  assert.throws(() => loadGame(g.reg, JSON.stringify(bad)), /herd/);
  const old = JSON.parse(text);
  old.saveFormat = 26; delete old.state.animals;
  const h = loadGame(g.reg, JSON.stringify(old));
  assert.equal(h.s.animals, undefined);
  h.tick();
  assert.ok(Object.keys(h.s.animals.herds).length > 0, 'herds placed at the next tick');
});

test('far herds on the Vast world: packs eat deer, herds stay on their landmass, numbers stay bounded', () => {
  const g = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast' });
  runDays(g, 1);
  const start = herdCensus(g);
  assert.ok(start['core:wolf']?.herds > 0 && start['core:deer']?.herds > 0 && start['core:wild_horse']?.herds > 0, JSON.stringify(start));
  // Slice 6: the share of far deer on chunks that are at least half winter ground (forest floor, taiga).
  const winterShare = (sp) => {
    const Hb = g._anHab, si = Hb.index.get(sp);
    let all = 0, w = 0;
    for (const h of Object.values(g.s.animals.herds)) {
      if (h.sp !== sp || h.near !== undefined) continue;
      const c = Math.floor(h.y / 32) * g.CW + Math.floor(h.x / 32);
      all += h.n; if (Hb.winter[si][c] >= 0.5 * Hb.counts[si][c]) w += h.n;
    }
    return w / all;
  };
  const spring = winterShare('core:deer');
  let farHunts = 0; // carcasses made while a distant village lives its hour (lod.js)
  const create = g.createItems.bind(g);
  g.createItems = (item, qty, ...rest) => {
    if (rest[2] === 'hunt' && g.s.settlements?.[g.actor]?.detail === 'abstract') farHunts += qty;
    return create(item, qty, ...rest);
  };
  runDays(g, 20);
  delete g.createItems;
  const now = herdCensus(g);
  for (const sp of Object.keys(start)) {
    assert.ok(now[sp]?.animals > 0, `${sp} survive`);
    assert.ok(now[sp].animals < start[sp].animals * 2.5, `${sp} do not explode`);
  }
  assert.equal(seasonOf(g), 'Winter');
  const winter = winterShare('core:deer');
  assert.ok(winter > spring + 0.05, `deer move onto winter ground (${spring.toFixed(2)} in spring, ${winter.toFixed(2)} in winter)`);
  // Slice 5: distant villages hunt too.
  assert.ok(farHunts > 0, `distant villages hunted (${farHunts} carcasses)`);
  // A hungry far pack beside a distant village mauls someone there (a chance a day).
  const v = Object.values(g.s.settlements).filter((x) => x.detail === 'abstract' && !x.fallen).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  const A = g.s.animals;
  A.herds[`h${A.next}`] = { id: `h${A.next}`, sp: 'core:wolf', x: v.center.x + 6, y: v.center.y, n: 5, day: 0, year: 0, next: g.s.tick + 1e6, fed: -10 };
  const pack = A.herds[`h${A.next++}`];
  g._anIdx = null;
  let attacked = false;
  for (let d = 0; d < 15 && !attacked; d++) {
    pack.x = v.center.x + 6; pack.y = v.center.y; pack.fed = -10; pack.next = g.s.tick + 1e6; g._anIdx = null;
    runDays(g, 1);
    attacked = g.s.log.some((e) => e.msg.startsWith('Wolves attacked') && e.msg.includes(`near ${v.name}`));
  }
  assert.ok(attacked, 'wolves mauled someone of a distant village');
  assert.ok(pack.raids?.[v.id] > 0, 'that village marks the pack to hunt');
  assert.deepEqual(conservationErrors(g), []);
});

test('review fix: meteors near herds, then a save and load: the game continues identically', () => {
  const run = (cut) => {
    let g = newGame({ seed: 4242, sandbox: true });
    runDays(g, 2);
    for (const h of Object.values(g.s.animals.herds).slice(0, 4)) issueCommand(g, 'meteor', { x: h.x, y: h.y, confirm: true });
    g.tick();
    if (cut) g = reload(g);
    runDays(g, 30);
    return g;
  };
  assert.equal(stateText(run(true)), stateText(run(false)));
});

// ---------------- slice 2: near animals ----------------
/** A classic game with a deer herd and a wolf pack placed by hand beside the village (both become near). */
function wildGame() {
  const g = newGame({ seed: 4242 });
  g.tick();
  const c = g.s.settlements[g.s.playerSettlement].center, A = g.s.animals;
  for (const id of Object.keys(A.herds)) delete A.herds[id];
  const spot = (dx, dy) => { for (let r = 0; r < 10; r++) for (let k = -r; k <= r; k++) { const x = c.x + dx + k, y = c.y + dy + r; if (g.isPassable(x, y)) return { x, y }; } return { x: c.x, y: c.y }; };
  const day = Math.floor(g.s.tick / 2400);
  const deer = spot(-14, 8), wolf = spot(-20, 8);
  A.herds.h900 = { id: 'h900', sp: 'core:deer', x: deer.x, y: deer.y, n: 8, day, year: 0, next: g.s.tick, fed: day };
  A.herds.h901 = { id: 'h901', sp: 'core:wolf', x: wolf.x, y: wolf.y, n: 4, day, year: 0, next: g.s.tick, fed: day - 1 };
  A.next = 902;
  g._anIdx = null;
  return g;
}

test('near herds become animals and fold back with the same count; animals never block tiles', () => {
  const g = wildGame();
  while (g.s.tick % 600 !== 451) g.tick();
  const A = g.s.animals;
  assert.ok(A.herds.h900.near !== undefined, 'the deer are near');
  assert.equal(Object.values(A.list).filter((a) => a.herd === 'h900').length, 8);
  g.step(200);
  for (const a of Object.values(A.list)) assert.ok(g.isPassable(a.x, a.y), 'on walkable ground');
  assert.equal(stateText(reload(g)), stateText(g));
  // Folded back (as when people are far): the count is the living animals, the centre one of them.
  const live = Object.values(A.list).filter((a) => a.herd === 'h900');
  foldHerdForTest(g, 'h900');
  assert.equal(A.herds.h900.n, live.length);
  assert.ok(live.some((a) => a.x === A.herds.h900.x && a.y === A.herds.h900.y));
  assert.equal(Object.values(A.list || {}).filter((a) => a.herd === 'h900').length, 0);
  assert.equal(stateText(reload(g)), stateText(g));
});

test('grazers flee from people; wolves chase and kill deer near the village; all saved identically', () => {
  const run = (cut) => {
    let g = wildGame();
    while (g.s.tick % 600 !== 451) g.tick();
    const c = g.colonists()[0], deer = Object.values(g.s.animals.list).find((a) => a.herd === 'h900');
    c.x = deer.x + 2; c.y = deer.y; c.mv = null;
    let fled = false;
    for (let t = 0; t < 30; t++) { g.tick(); if (g.s.animals.herds.h900?.alarm > g.s.tick) fled = true; }
    assert.ok(fled, 'the herd ran from a person close by');
    for (let d = 0; d < 3; d++) { g.step(800); if (cut) g = reload(g); }
    return g;
  };
  const g = run(false);
  const deer = g.s.animals.herds.h900, pack = g.s.animals.herds.h901;
  assert.ok(!deer || deer.n < 8, 'the pack killed deer');
  assert.ok(pack && pack.fed >= Math.floor(g.s.tick / 2400) - 2, 'the pack ate in the last days');
  assert.equal(stateText(run(true)), stateText(g));
});

test('review fixes: two packs on one deer kill it once; a removed species takes its animals with it', () => {
  const g = wildGame();
  while (g.s.tick % 600 !== 451) g.tick();
  const A = g.s.animals;
  // A second pack beside the first: whatever they kill, the deer's count always matches its animals.
  const w = Object.values(A.list).find((a) => a.herd === 'h901');
  A.herds.h902 = { ...A.herds.h901, id: 'h902', n: 1 }; A.next = 903;
  A.list[`a${A.na}`] = { id: `a${A.na}`, herd: 'h902', x: w.x, y: w.y, hp: 40 }; A.na++;
  g._anNear = null; g._anIdx = null;
  for (let t = 0; t < 1200; t++) {
    g.tick();
    const h = A.herds.h900, live = Object.values(A.list || {}).filter((a) => a.herd === 'h900').length;
    if (h) assert.equal(live, h.n, 'the count is its animals');
    assert.ok(Object.values(A.list || {}).every((a) => A.herds[a.herd]?.near !== undefined), 'no animal without its herd');
  }
  assert.doesNotThrow(() => loadGame(g.reg, serializeGame(g)));
  // A species whose mod is gone: its herds and their animals go on load; the game saves again.
  const mods = readAllMods(), core = mods.find((m) => m.manifest.id === 'core');
  core.files['content/animals.json'].animal = core.files['content/animals.json'].animal.filter((d) => d.id !== 'core:wolf');
  const registry = buildRegistry(mods, ['core']).registry;
  const h = loadGame(registry, serializeGame(g));
  assert.ok(!Object.values(h.s.animals.herds).some((x) => x.sp === 'core:wolf'), 'the packs are gone');
  assert.ok(Object.values(h.s.animals.list || {}).every((a) => h.s.animals.herds[a.herd]), 'and their animals');
  h.tick();
  assert.doesNotThrow(() => loadGame(registry, serializeGame(h)));
});

// ---------------- slice 3: hunting, butchering, spoilage ----------------
test('hunting: villagers arm, hunt deer, butcher the carcasses; counted through the ledger; herds kept at 3 or more', () => {
  const g = newGame({ seed: 4242 });
  let minHerd = Infinity;
  for (let d = 0; d < 16; d++) {
    runDays(g, 1);
    for (const h of Object.values(g.s.animals.herds)) if (h.sp === 'core:deer' && h.near !== undefined) minHerd = Math.min(minHerd, h.n);
  }
  const L = g.s.ledger.byReason;
  assert.ok((L['created:hunt']?.['core:deer_carcass'] || 0) > 0, 'deer were hunted');
  assert.ok((L['created:craft']?.['core:venison'] || 0) > 0, 'carcasses were butchered into venison');
  assert.ok((L['consumed:craft']?.['core:deer_carcass'] || 0) > 0);
  assert.ok(Object.values(g.s.structures).some((b) => b.def === 'core:butcher_table' && b.built), 'a butcher\'s table was built');
  assert.ok(g.colonists().some((c) => c.equip.weapon), 'a hunter took a weapon');
  assert.ok(minHerd >= 3, `no herd hunted below 3 (lowest ${minHerd})`);
  assert.ok(typeof g.plan.huntNote === 'string' && g.plan.huntNote.length > 0, 'the plan says why it hunts or not');
  assert.deepEqual(conservationErrors(g), []);
});

test('hunting: saved mid-hunt, the game continues identically', () => {
  const run = (cut) => {
    let g = newGame({ seed: 4242 });
    for (let k = 0; k < 64; k++) {
      g.step(300);
      if (cut.includes(k)) g = reload(g);
      if (g.colonists().some((c) => c.job?.type === 'hunt')) hunting.add(k);
    }
    return g;
  };
  const hunting = new Set();
  const g = run([]);
  assert.ok(Object.keys(g.s.ledger.byReason['created:hunt'] || {}).length > 0, 'a hunt happened in the run');
  const cuts = [...hunting].slice(0, 3);
  assert.ok(cuts.length > 0, 'someone was hunting at a save point');
  assert.equal(stateText(run(cuts)), stateText(g));
});

test('spoilage: meat and carcasses lose a share a day through the ledger; other goods keep', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const c = g.s.settlements[g.s.playerSettlement].center;
  g.createItems('core:venison', 40, c.x + 3, c.y + 3, 'start');
  const spoiledBefore = g.s.ledger.byReason['consumed:spoil']?.['core:venison'] || 0;
  runDays(g, 1);
  const spoiled = (g.s.ledger.byReason['consumed:spoil']?.['core:venison'] || 0) - spoiledBefore;
  assert.ok(spoiled >= 2 && spoiled <= 6, `about a tenth of 40 spoiled in a day (${spoiled})`);
  assert.equal(g.s.ledger.byReason['consumed:spoil']?.['core:wood'], undefined, 'wood does not spoil');
  assert.deepEqual(conservationErrors(g), []);
});

test('review fixes: a village short of raw food forages and farms, it does not plan to butcher deer it has not got', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 3);
  for (const id of Object.keys(g.s.stacks)) { const st = g.s.stacks[id]; if (g.reg.itemHasTag(st.item, 'core:raw_food') || g.reg.itemHasTag(st.item, 'core:meal')) { const t = g.takeFromStack(id, st.qty); g.consume(t.item, t.qty, 'eat'); } }
  planNow(g, g.s.playerSettlement);
  const P = g.plans[g.s.playerSettlement];
  assert.ok(!P.bills.some((b) => /butcher/.test(b.recipe)), 'no butchering bill without carcasses');
  assert.ok(!Object.values(P.blockers || {}).flat().some((b) => /Deer carcass/.test(JSON.stringify(b))), 'no carcass blocker');
  assert.ok((P.wants['core:berry']?.remaining || 0) > 0 || (P.farmPressure || 0) > 0, 'it forages or farms');
});

test('review fixes: spoilage keeps reserved units, so a save and load mid-haul plays on identically', () => {
  const run = (cut) => {
    let g = newGame({ seed: 4242 });
    runDays(g, 1);
    const c = g.s.settlements[g.s.playerSettlement].center;
    g.createItems('core:venison', 30, c.x + 6, c.y + 6, 'start');
    while (g.s.tick % 2400 !== 2399) g.tick();
    // A hauler reserves the whole stack just before the day start (spoilage runs then).
    const st = Object.values(g.s.stacks).find((x) => x.item === 'core:venison' && x.qty === 30);
    const h = g.colonists()[0];
    if (h.job) endJob(g, h, null, 'test');
    h.job = newJob('haul', { stackId: st.id, item: st.item, qty: 30, stage: 'src', dest: { kind: 'stock', x: c.x, y: c.y } }, { why: 'test' });
    assert.ok(g.reserveQty(h.job, st.id, 30));
    g.tick();
    assert.equal(g.s.stacks[st.id]?.qty, 30, 'reserved units do not spoil');
    if (cut) g = reload(g);
    g.step(300);
    return g;
  };
  assert.equal(stateText(run(true)), stateText(run(false)));
});

// ---------------- slice 4: wolves and people ----------------
/** A classic game with only a hungry wolf pack, near the village (it becomes near); people placed by hand. */
function wolfGame() {
  const g = newGame({ seed: 4242 });
  g.tick();
  const c = g.s.settlements[g.s.playerSettlement].center, A = g.s.animals;
  for (const id of Object.keys(A.herds)) delete A.herds[id];
  const day = Math.floor(g.s.tick / 2400);
  A.herds.h901 = { id: 'h901', sp: 'core:wolf', x: c.x - 18, y: c.y + 6, n: 4, day, year: 0, next: g.s.tick, fed: day - 1 };
  A.next = 902; g._anIdx = null;
  while (g.s.tick % 600 !== 451) g.tick();
  return g;
}
/** Give c a spear through the ledger (created, then taken up). */
function arm(g, c) {
  g.createItems('core:spear', 1, Math.round(c.x), Math.round(c.y), 'start');
  const st = Object.values(g.s.stacks).find((s) => s.item === 'core:spear');
  const t = g.takeFromStack(st.id, 1);
  c.equip.weapon = { item: t.item, dur: 1500 };
}
const bites = (c) => (c.health?.injuries || []).filter((i) => i.kind === 'bite').length;
const place = (g, c, x, y) => { c.x = x; c.y = y; c.mv = null; c.path = null; if (c.job) endJob(g, c, null, 'test'); };

test('wolves: a hungry pack goes for a lone person outdoors; bites are wounds; the village will hunt the pack', () => {
  const g = wolfGame();
  const w = Object.values(g.s.animals.list)[0], c = g.colonists()[0];
  place(g, c, w.x + 4, w.y);
  for (let t = 0; t < 400 && !bites(c); t++) g.tick();
  assert.ok(bites(c) > 0, 'bitten');
  assert.match(g.s.log.map((e) => e.msg).join('\n'), /Wolves attacked/);
  assert.ok(g.s.animals.herds.h901.raids?.[c.settlementId || g.s.playerSettlement] > g.s.tick, 'the village marks the pack to hunt');
  assert.deepEqual(conservationErrors(g), []);
});

test('wolves: a pack holds back from 3 armed people together; an armed person fends one off and may kill it', () => {
  const g = wolfGame();
  const w = Object.values(g.s.animals.list)[0], [a, b, c] = g.colonists();
  for (const p of [a, b, c]) { arm(g, p); place(g, p, w.x + 3, w.y + (p === b ? 1 : p === c ? -1 : 0)); }
  let bitten = 0, fended = false;
  for (let t = 0; t < 600; t++) {
    for (const p of [a, b, c]) if (Math.hypot(p.x - (w.x + 3), p.y - w.y) > 4) { p.x = w.x + 3; p.y = w.y; p.mv = null; } // they stay together
    g.tick();
    if ([a, b, c].some((p) => p.job?.type === 'fend')) fended = true;
  }
  for (const p of [a, b, c]) bitten += bites(p);
  assert.ok(fended, 'armed people turn on a wolf close by');
  assert.equal(bitten, 0, 'nobody in the armed group was bitten');
  assert.deepEqual(conservationErrors(g), []);
  assert.equal(stateText(reload(g)), stateText(g));
});

test('wolves: killed by wolves is a death cause; a save and load mid-attack plays on identically', () => {
  assert.equal(causeText('bite'), 'was killed by wolves');
  const run = (cut) => {
    let g = wolfGame();
    const w = Object.values(g.s.animals.list)[0], c = g.colonists()[0];
    place(g, c, w.x + 4, w.y);
    for (let k = 0; k < 6; k++) { g.step(60); if (cut.includes(k)) g = reload(g); }
    return g;
  };
  assert.equal(stateText(run([1, 3])), stateText(run([])));
});

test('review fixes: a pack that has eaten today leaves people alone; a load mid-fend, with the pack angry, plays on identically', () => {
  const g = wolfGame();
  g.s.animals.herds.h901.fed = Math.floor(g.s.tick / 2400); // fed today
  const w = Object.values(g.s.animals.list)[0], c = g.colonists()[0];
  place(g, c, w.x + 4, w.y);
  for (let t = 0; t < 300; t++) g.tick();
  assert.equal(bites(c), 0, 'a fed pack does not attack');
  const run = (cut) => {
    let h = wolfGame();
    const ww = Object.values(h.s.animals.list)[0], p = h.colonists()[0];
    arm(h, p); place(h, p, ww.x + 3, ww.y);
    for (const id of Object.keys(p.needs)) p.needs[id] = 1; // fed, watered, rested: nothing calls them away
    let angrySeen = false;
    for (let k = 0; k < 8; k++) {
      for (let t = 0; t < 30; t++) { h.tick(); if (h.s.animals.herds.h901?.angry && h.colonists().some((q) => q.job?.type === 'fend' || (q.job?.type === 'hunt' && q.job.herd === 'h901'))) angrySeen = true; }
      if (cut.includes(k)) h = reload(h);
    }
    h.step(300);
    return { h, angrySeen };
  };
  const a = run([]), b = run([1, 2, 3]);
  assert.ok(a.angrySeen, 'the pack was angry while someone fought it (fending it off or hunting it down)');
  assert.equal(stateText(b.h), stateText(a.h));
});

test('slice 6: grazers in a drought lose some of their number and the game saves identically', () => {
  const make = () => { const g = newGame({ seed: 3 }); runDays(g, 1); return g; };
  const g = make(), ctl = make();
  const herd = Object.values(g.s.animals.herds).filter((h) => h.sp === 'core:deer').sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1))[0];
  assert.ok(herd, 'a deer herd');
  assert.equal(issueCommand(g, 'drought', { x: herd.x, y: herd.y, confirm: true }).ok, true);
  const b = reload(g);
  runDays(g, 2); runDays(b, 2);
  assert.equal(stateText(b), stateText(g), 'a save and load mid-drought plays on identically');
  runDays(g, 2); runDays(ctl, 4);
  const n = (x) => x.s.animals.herds[herd.id]?.n || 0;
  assert.ok(n(g) < n(ctl), `the herd in the drought is smaller (${n(g)} against ${n(ctl)})`);
  assert.deepEqual(conservationErrors(g), []);
});
