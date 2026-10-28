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
