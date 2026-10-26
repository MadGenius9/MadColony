// Rivalry and AI war declarations (Phase 5, slice 5a): a scenario rule (scenario.war, the Vast world). Tested on the
// neighbours scenario with the rule added to its data in this test's own registry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame, TICKS_PER_DAY } from './cloud-helpers.js';
import { readAllMods } from '../tools/fsmods.js';
import { buildRegistry } from '../src/sim/content/modloader.js';
import { warRules, tickRivalry, warStrength } from '../src/sim/war.js';
import { relationOf, relationPeek } from '../src/sim/villages.js';
import { injure } from '../src/sim/health.js';

const WAR = { rivalry: { perDay: 1, floor: -70, near: 500, nearPerDay: 0.6 }, declareBelow: -50, stronger: 1.5, minStrength: 0.5, warnDays: 1 };
let REG = null;
function warGame() {
  if (!REG) {
    const mods = readAllMods();
    const core = mods.find((m) => m.manifest.id === 'core');
    core.files['content/setup.json'].scenario.find((x) => x.id === 'core:neighbours').war = WAR;
    REG = buildRegistry(mods, ['core']).registry;
  }
  const g = newGame({ seed: 7, registry: REG, scenario: 'core:neighbours', size: 'medium', villages: 2 });
  runDays(g, 1);
  return g;
}
/** Two AI villages that have met. */
function aiPair(g) {
  const ai = Object.keys(g.s.settlements).filter((x) => g.s.settlements[x].ai).sort();
  for (const x of ai) for (const y of ai) if (x < y) { relationOf(g, x, y).contact = true; return [x, y]; }
  return null;
}
const weaken = (g, sid) => { for (const c of g.owned('colonists', sid)) injure(g, c, 'injury', 55, 'Weakened for a test'); };

test('without war rules nothing changes', () => {
  const g = newGame({ seed: 4242 });
  assert.equal(warRules(g), null);
  const before = stateText(g);
  tickRivalry(g);
  assert.equal(stateText(g), before);
});

test('near rivals fall out a little each day, never below the floor by rivalry alone', () => {
  const g = warGame();
  const [a, b] = aiPair(g);
  const rel = relationOf(g, a, b);
  rel.value = 0;
  tickRivalry(g);
  assert.ok(rel.value < 0 && rel.value >= -1, `after a day: ${rel.value}`);
  rel.value = WAR.rivalry.floor + 0.1;
  tickRivalry(g);
  assert.equal(rel.value, WAR.rivalry.floor);
  tickRivalry(g);
  assert.equal(rel.value, WAR.rivalry.floor, 'stays at the floor');
});

test('lands that touch press harder than nearness; the standing change is recorded with the cause', () => {
  const g = warGame();
  const [a, b] = aiPair(g);
  const rel = relationOf(g, a, b);
  rel.value = -24.5; rel.touch = g.s.tick;
  tickRivalry(g);
  assert.ok(rel.value <= -25, 'now hostile');
  assert.equal(rel.history.at(-1).reason, 'Their lands press on each other');
});

test('a clearly stronger AI village declares war on a rival at -50; the weaker one does not', () => {
  const g = warGame();
  const [a, b] = aiPair(g);
  weaken(g, b);
  assert.ok(warStrength(g, a) >= 1.5 * warStrength(g, b));
  relationOf(g, a, b).value = -55;
  tickRivalry(g);
  const rel = relationPeek(g, a, b);
  assert.equal(rel.aggressor, a, `${a} started the war`);
  assert.ok(g.s.log.some((e) => /declared war on/.test(e.msg)));
  assert.equal(g.s.military?.[a]?.order, 'attack');
});

test('rivals far above the declaring line, or evenly matched, keep the peace', () => {
  const g = warGame();
  const [a, b] = aiPair(g);
  relationOf(g, a, b).value = -40;
  tickRivalry(g);
  assert.equal(relationPeek(g, a, b).aggressor, undefined, 'not low enough');
  relationOf(g, a, b).value = -60;
  if (warStrength(g, a) < 1.5 * warStrength(g, b) && warStrength(g, b) < 1.5 * warStrength(g, a)) {
    tickRivalry(g);
    assert.equal(relationPeek(g, a, b).aggressor, undefined, 'evenly matched');
  }
});

test('an AI village threatens the player first and declares only after the warning days', () => {
  const g = warGame();
  const p = g.s.playerSettlement;
  const a = Object.keys(g.s.settlements).find((x) => g.s.settlements[x].ai);
  relationOf(g, a, p).contact = true;
  weaken(g, p);
  relationOf(g, a, p).value = -60;
  tickRivalry(g);
  assert.equal(relationPeek(g, a, p).aggressor, undefined);
  assert.ok(relationPeek(g, a, p).threat !== undefined, 'a threat');
  assert.ok(g.s.log.some((e) => /threatens war on/.test(e.msg)));
  g.s.tick += TICKS_PER_DAY; // the warning days pass (a test shortcut: only the daily rule is run)
  tickRivalry(g);
  assert.equal(relationPeek(g, a, p).aggressor, a, 'war after the warning');
});

test('in war games rivals who never fought stay hostile; the daily rules keep a save identical', () => {
  const run = (cut) => {
    let g = warGame();
    const [a, b] = aiPair(g);
    relationOf(g, a, b).value = -30;
    for (let d = 1; d <= 6; d++) { g.step(TICKS_PER_DAY); if (cut.includes(d)) g = reload(g); }
    return { g, a, b };
  };
  const x = run([]), y = run([2, 4]);
  assert.ok(relationPeek(x.g, x.a, x.b).value <= -30, 'no cooling back to neutral');
  assert.equal(stateText(x.g), stateText(y.g));
});

test('saves: malformed border or threat times are refused', () => {
  const g = warGame();
  const [a, b] = aiPair(g);
  relationOf(g, a, b).touch = g.s.tick;
  const text = serializeGame(g);
  assert.doesNotThrow(() => loadGame(g.reg, text));
  const bad = JSON.parse(text);
  const k = Object.keys(bad.state.relations).find((x) => bad.state.relations[x].touch !== undefined);
  bad.state.relations[k].touch = bad.state.tick + 100;
  assert.throws(() => loadGame(g.reg, JSON.stringify(bad)), /border or threat/);
});
