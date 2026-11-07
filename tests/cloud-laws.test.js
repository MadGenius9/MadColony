// World laws (docs/proposals/world-laws.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame } from './cloud-helpers.js';
import { issueCommand, previewCommand } from '../src/sim/god.js';
import { lawOf, lawIs, activeLaws } from '../src/sim/worldlaws.js';

const law = (g, id, value) => { const r = issueCommand(g, 'law', { law: id, value }); assert.equal(r.ok, true, r.reason); g.tick(); };

test('laws: set, shown, refused, saved and cleared; free; a game without laws saves no law state', () => {
  const g = newGame({ seed: 3 });
  g.tick();
  assert.equal(g.s.worldLaws, undefined);
  assert.equal(lawOf(g, 'core:plague'), 'normal');
  const p = previewCommand(g, 'law', { law: 'core:plague', value: 'none' });
  assert.equal(p.ok, true);
  assert.equal(p.preview.cost, 0, 'free (the owner\'s answer 2)');
  assert.match(p.preview.effect, /Plague: None/);
  assert.match(previewCommand(g, 'law', { law: 'core:plague', value: 'normal' }).reason, /normal already/);
  assert.match(previewCommand(g, 'law', { law: 'core:plague', value: 'loud' }).reason, /one of/);
  assert.match(previewCommand(g, 'law', { law: 'core:nope', value: 'on' }).reason, /no world law/);
  assert.match(previewCommand(g, 'law', { law: 'core:peace', value: 'on', x: 1 }).reason, /takes only/);
  law(g, 'core:peace', 'on');
  law(g, 'core:peaceful_animals', 'on');
  assert.ok(lawIs(g, 'core:peace', 'on'));
  assert.equal(g.s.animals.peaceful, true, 'peaceful animals keeps its own flag');
  assert.deepEqual(activeLaws(g).map((x) => x.id), ['core:peace', 'core:peaceful_animals']);
  assert.match(g.s.log.map((e) => e.msg).join('\n'), /World law: Peace is now on/);
  const b = reload(g);
  runDays(g, 1); runDays(b, 1);
  assert.equal(stateText(b), stateText(g));
  law(g, 'core:peace', 'off');
  assert.equal(g.s.worldLaws, undefined, 'back to no laws: nothing saved');
  // A law a removed mod defined is dropped on load; a malformed block is refused.
  const t = JSON.parse(serializeGame(g));
  t.state.worldLaws = { set: { 'gone:law': 'on' }, since: { 'gone:law': 1 } };
  assert.equal(loadGame(g.reg, JSON.stringify(t)).s.worldLaws, undefined);
  t.state.worldLaws = { set: { 'core:peace': 'on' }, since: { 'core:peace': t.state.tick + 10 } };
  assert.throws(() => loadGame(g.reg, JSON.stringify(t)), /invalid start/);
});

// ---- slice 2: peace and tame monsters
import { readAllMods } from '../tools/fsmods.js';
import { buildRegistry } from '../src/sim/content/modloader.js';
import { tickRivalry } from '../src/sim/war.js';
import { relationOf, relationPeek, relationStatus, changeRelation } from '../src/sim/villages.js';
import { declareWar, evaluateAttack, isEnemy } from '../src/sim/combat.js';
import { killMonster, sendMonster } from '../src/sim/monsters.js';

let WAR_REG = null;
function warGame() {
  if (!WAR_REG) {
    const mods = readAllMods();
    mods.find((m) => m.manifest.id === 'core').files['content/setup.json'].scenario.find((x) => x.id === 'core:neighbours').war = { rivalry: { perDay: 1, floor: -70, near: 500, nearPerDay: 0.6 }, declareBelow: -50, stronger: 1.5, minStrength: 0.5, warnDays: 1 };
    WAR_REG = buildRegistry(mods, ['core']).registry;
  }
  const g = newGame({ seed: 7, registry: WAR_REG, scenario: 'core:neighbours', size: 'medium', villages: 2, sandbox: true });
  runDays(g, 1);
  return g;
}

test('laws: Peace stops new wars (declarations, attack orders, relations sinking to hostile) but running wars go on', () => {
  const g = warGame();
  const [a, b] = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
  const me = g.s.playerSettlement;
  for (const [x, y] of [[a, b], [me, a], [me, b]]) relationOf(g, x, y).contact = true;
  // A running war between the player and b.
  relationOf(g, me, b).value = 0;
  declareWar(g, me, b, 'A test war');
  assert.ok(isEnemy(g, me, b));
  law(g, 'core:peace', 'on');
  assert.ok(isEnemy(g, me, b), 'the running war goes on (the owner\'s answer 3)');
  assert.equal(evaluateAttack(g, me, b).problems.some((p) => /Peace law/.test(p)), false, 'attacks in a running war are allowed');
  assert.ok(evaluateAttack(g, me, a).problems.some((p) => /Peace law holds/.test(p)), 'a new war is refused');
  // a and b: far below the declaring line, but no declaration while the law holds.
  relationOf(g, a, b).value = -24;
  changeRelation(g, a, b, -30, 'A border quarrel');
  assert.equal(relationPeek(g, a, b).value, -24, 'held just above hostile');
  assert.match(relationPeek(g, a, b).history.at(-1).reason, /held at neutral by the Peace law/);
  for (let d = 0; d < 3; d++) tickRivalry(g);
  assert.notEqual(relationStatus(relationPeek(g, a, b)), 'hostile');
  assert.ok(!g.s.log.some((e) => /declared war on/.test(e.msg) && e.t > g.s.worldLaws.since['core:peace']));
  const c = reload(g);
  runDays(g, 1); runDays(c, 1);
  assert.equal(stateText(c), stateText(g));
  // Lifted: rivalry may sink again.
  law(g, 'core:peace', 'off');
  changeRelation(g, a, b, -30, 'Another quarrel');
  assert.equal(relationStatus(relationPeek(g, a, b)), 'hostile');
});

test('laws: Tame monsters keep to their lairs and strike nobody; turning it on ends forays', () => {
  const run = (tame) => {
    const g = newGame({ seed: 4242 });
    runDays(g, 6); // as the 8c Thornback test
    for (const m of Object.values(g.s.monsters.list)) killMonster(g, m.id, 'test');
    for (const l of Object.values(g.s.monsters.lairs)) l.cleared = true;
    const f = Object.values(g.s.crops).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    while (Math.floor(g.hour) !== 4) g.tick();
    const m = sendMonster(g, 'core:thornback', f.x + 6, f.y); // as the 8c test: by the fields at dawn
    if (tame) law(g, 'core:tame_monsters', 'on');
    const crops = Object.keys(g.s.crops).length, t0 = g.s.tick;
    for (let t = 0; t < 400; t++) g.tick();
    const trampled = g.s.log.some((e) => e.t >= t0 && /trampled crops/.test(e.msg));
    if (tame) assert.equal(trampled, false, 'tame: no fields trampled');
    else assert.ok(trampled || Object.keys(g.s.crops).length < crops, 'wild: it tramples the fields');
    const c = g.colonists()[0], lair = g.s.monsters.lairs[m.lair];
    let gore = 0;
    for (let t = 0; t < 300 && !gore; t++) { c.x = lair.x + 3; c.y = lair.y; c.mv = null; c.path = null; g.tick(); gore = (c.health?.injuries || []).filter((i) => i.kind === 'gore').length; }
    if (tame) { const b = reload(g); runDays(g, 1); runDays(b, 1); assert.equal(stateText(b), stateText(g)); }
    return gore;
  };
  assert.ok(run(false) > 0, 'without the law a Thornback gores a person by its den');
  assert.equal(run(true), 0, 'tame: nobody is gored');
  // A monster on a foray goes home when the law comes.
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const m = sendMonster(g, 'core:gloomstalker', g.s.center.x + 12, g.s.center.y);
  m.foray = { sid: g.s.playerSettlement, x: m.x, y: m.y, until: g.s.tick + 5 * 2400 };
  law(g, 'core:tame_monsters', 'on');
  assert.ok(!m.foray || m.foray.until <= g.s.tick, 'its foray ended');
});

// ---- slice 3: ageless and fast growth
import { ageYears, tickAging } from '../src/sim/life.js';
import { canFound } from '../src/sim/founding.js';
import { tickFarming } from '../src/sim/farming.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

test('laws: Ageless stops adults aging and old-age deaths; ages run on when lifted', () => {
  const g = newGame({ seed: 5 });
  g.tick();
  const c = Object.values(g.s.colonists)[0];
  const a0 = ageYears(g, c);
  law(g, 'core:ageless', 'on');
  runDays(g, 30); // a year
  assert.ok(Math.abs(ageYears(g, c) - a0) < 0.001, 'frozen');
  // The very old do not die of old age while it holds (a Living world has aging rules).
  const w = newGame({ seed: 5, scenario: 'core:living_world' });
  const o = Object.values(w.s.colonists)[0];
  o.ageYears = 400; o.ageTick = w.s.tick;
  w._dying = null;
  for (let d = 0; d < 60 && !w._dying?.has(o.id); d++) { w.s.tick += TICKS_PER_DAY; tickAging(w); }
  assert.ok(w._dying?.has(o.id), 'without the law the very old die of old age');
  w._dying = null;
  law(w, 'core:ageless', 'on');
  for (let d = 0; d < 60; d++) { w.s.tick += TICKS_PER_DAY; tickAging(w); }
  assert.ok(!w._dying?.has(o.id), 'no old-age death under the law');
  const b = reload(g);
  runDays(g, 1); runDays(b, 1);
  assert.equal(stateText(b), stateText(g));
  law(g, 'core:ageless', 'off');
  const a1 = ageYears(g, c);
  runDays(g, 30);
  assert.ok(Math.abs(ageYears(g, c) - a1 - 1) < 0.01, 'a year later, a year older');
});

test('laws: Fast growth doubles crop growth, halves the founding wait and brings more births', () => {
  const base = newGame({ seed: 4242 });
  runDays(base, 4);
  const step = (fast) => {
    const g = loadGame(base.reg, serializeGame(base));
    if (fast) g.s.worldLaws = { set: { 'core:fast_growth': 'on' }, since: { 'core:fast_growth': g.s.tick } };
    const cr = Object.values(g.s.crops).filter((x) => x.growth < 0.9).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    const before = cr.growth;
    tickFarming(g, 10);
    return g.s.crops[cr.id].growth - before;
  };
  const d0 = step(false), d1 = step(true);
  assert.ok(d0 > 0 && Math.abs(d1 / d0 - 2) < 1e-6, `crops grow twice as fast (${d0} -> ${d1})`);
  // Founding: a village that founded 12 days ago waits 20 days, or 10 under the law.
  const g = newGame({ seed: 7, scenario: 'core:living_world' });
  const ai = Object.keys(g.s.settlements).find((k) => g.s.settlements[k].ai);
  g.s.tick = 40 * TICKS_PER_DAY; g.s.settlements[ai].lastFounding = g.s.tick - 12 * TICKS_PER_DAY;
  assert.ok(canFound(g, ai).problems.some((p) => /waits until/.test(p)));
  law(g, 'core:fast_growth', 'on');
  assert.ok(!canFound(g, ai).problems.some((p) => /waits until/.test(p)), 'half the wait under the law');
  // Births across a Living world, 15 days.
  const births = (on) => { const w = newGame({ seed: 7, scenario: 'core:living_world' }); if (on) law(w, "core:fast_growth", "on"); runDays(w, 15); return Object.values(w.s.colonists).filter((x) => x.bornTick !== undefined).length + Object.values(w.s.dead || {}).filter((x) => x.bornTick !== undefined).length; };
  const n0 = births(false), n1 = births(true);
  assert.ok(n1 > n0, `more births (${n0} -> ${n1})`);
});

// ---- slice 4: plague
import { infect, sicknessOf } from '../src/sim/illness.js';
test('laws: Plague none stops every new case; endless keeps outbreaks coming but spares villages of 3 or fewer standing', () => {
  const run = (value, days) => {
    const g = newGame({ seed: 7, scenario: 'core:living_world' });
    law(g, 'core:plague', value);
    const c0 = g.s.stats.illness?.cases || 0;
    runDays(g, days);
    return { g, cases: (g.s.stats.illness?.cases || 0) - c0 };
  };
  const none = run('none', 15);
  assert.equal(none.cases, 0, 'nobody falls ill');
  const fever = none.g.reg.get('illness', 'core:fever'), who = Object.values(none.g.s.colonists).find((c) => !sicknessOf(c));
  assert.equal(infect(none.g, who, fever, 'a test'), null, 'even a direct infection is refused');
  none.g.s.worldLaws = undefined;
  assert.ok(infect(none.g, who, fever, 'a test'), 'and allowed without the law');
  const endless = run('endless', 12);
  assert.ok(endless.cases > 0, 'the plague breaks out');
  assert.ok(endless.g.s.log.some((e) => /broke out in .* \(the Endless plague law\)/.test(e.msg)));
  const sick = Object.values(endless.g.s.colonists).filter((c) => (c.health?.injuries || []).some((i) => i.kind === 'sickness' && i.illness === 'core:plague'));
  assert.ok(sick.length > 0, 'plague cases');
  const b = reload(endless.g);
  runDays(endless.g, 1); runDays(b, 1);
  assert.equal(stateText(b), stateText(endless.g));
  // A village of 3 standing: no outbreak there, ever.
  const g = newGame({ seed: 7, scenario: 'core:living_world' });
  const sid = Object.keys(g.s.settlements).find((k) => g.s.settlements[k].ai && g.owned('colonists', k).length === 3);
  assert.ok(sid, 'a village of 3');
  law(g, 'core:plague', 'endless');
  let small = 0;
  for (let d = 0; d < 20; d++) {
    const standing = g.owned('colonists', sid).filter((c) => !c.health?.down).length, t0 = g.s.tick;
    runDays(g, 1);
    if (standing > 3) continue;
    small++;
    const hit = g.s.log.some((e) => e.t >= t0 && e.msg.includes(`broke out in ${g.s.settlements[sid].name}`));
    assert.equal(hit, false, `the small village is spared on day ${d} (the owner's answer 6)`);
  }
  assert.ok(small > 0, 'it was small on some days');
});

// ---- slice 5: no spreading fire, endless season
import { ignite } from '../src/sim/fire.js';
import { seasonalTemp, seasonOf, outdoorTemp } from '../src/sim/heat.js';

test('laws: under No spreading fire a fire burns only where it was set', () => {
  const run = (on) => {
    const g = newGame({ seed: 4242 });
    g.tick();
    if (on) law(g, 'core:no_fire_spread', 'on');
    const pine = Object.values(g.s.nodes).filter((n) => n.def === 'core:pine' && Math.hypot(n.x - g.s.center.x, n.y - g.s.center.y) > 15).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    assert.ok(ignite(g, g.i(pine.x, pine.y), true), 'set alight');
    let most = 0;
    for (let t = 0; t < 600; t++) { g.tick(); most = Math.max(most, Object.keys(g.s.disasters?.fires || {}).length); }
    return most;
  };
  const wild = run(false), held = run(true);
  assert.ok(wild > 1, `without the law the fire spreads (${wild} tiles)`);
  assert.equal(held, 1, 'with it, only the tile it was set on burns');
});

test('laws: Endless season holds midsummer or midwinter all year', () => {
  const g = newGame({ seed: 4242 });
  g.tick();
  const temps = (n) => Array.from({ length: n }, (_, d) => seasonalTemp(g, g.s.tick + d * TICKS_PER_DAY));
  const normal = temps(30);
  assert.ok(Math.max(...normal) - Math.min(...normal) > 10, 'the seasons turn');
  law(g, 'core:season', 'winter');
  const w = temps(30);
  assert.ok(w.every((t) => t === w[0]) && w[0] <= Math.min(...normal) + 0.01, 'midwinter all year');
  assert.equal(seasonOf(g), 'Winter');
  assert.ok(outdoorTemp(g, g.s.tick) !== outdoorTemp(g, g.s.tick + 12 * 100), 'days and nights still differ');
  law(g, 'core:season', 'summer');
  assert.equal(seasonOf(g, g.s.tick + 17 * TICKS_PER_DAY), 'Summer');
  assert.ok(temps(30).every((t) => t >= Math.max(...normal) - 0.01));
  runDays(g, 2);
  const b = reload(g);
  runDays(g, 1); runDays(b, 1);
  assert.equal(stateText(b), stateText(g));
});

test('laws: a save and load right after a season change plays on identically (review: the heating-season and lean-season caches)', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 3);
  for (let t = 0; t < 250; t++) g.tick(); // part way through a quarter day
  law(g, 'core:season', 'winter');
  const b = reload(g);
  runDays(g, 1); runDays(b, 1);
  assert.equal(stateText(b), stateText(g));
});

test('laws: under the Endless plague a village of 3 or fewer living never dies out: its plague cases stop short of deadly', () => {
  const g = newGame({ seed: 7, scenario: 'core:living_world' });
  const sid = Object.keys(g.s.settlements).find((k) => g.s.settlements[k].ai && g.owned('colonists', k).length === 3);
  law(g, 'core:plague', 'endless');
  const plague = g.reg.all('illness').find((d) => d.plague);
  for (const c of g.owned('colonists', sid)) { const i = infect(g, c, plague, 'a test'); assert.ok(i); i.severity = 55; }
  runDays(g, 3);
  const left = g.owned('colonists', sid);
  assert.equal(left.length, 3, 'nobody died');
  for (const c of left) for (const i of c.health.injuries) if (i.kind === 'sickness') assert.ok(i.severity <= 60, `severity ${i.severity}`);
});
