// Rivalry and AI war declarations (Phase 5, slice 5a): a scenario rule (scenario.war, the Vast world). Tested on the
// neighbours scenario with the rule added to its data in this test's own registry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame, TICKS_PER_DAY } from './cloud-helpers.js';
import { readAllMods } from '../tools/fsmods.js';
import { buildRegistry } from '../src/sim/content/modloader.js';
import { warRules, tickRivalry, warStrength } from '../src/sim/war.js';
import { relationOf, relationPeek, changeRelation } from '../src/sim/villages.js';
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
  assert.throws(() => loadGame(g.reg, JSON.stringify(bad)), /border, threat or war time/);
});

// ---------------- slice 5b: battles between distant villages, and peace ----------------
import { declareWar } from '../src/sim/combat.js';
import { conservationErrors } from './cloud-helpers.js';

let VAST = null;
function vastWar() {
  if (!VAST) { VAST = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast' }); runDays(VAST, 2); }
  const g = reload(VAST); // a fresh copy for each test
  const far = Object.values(g.s.settlements).filter((x) => x.ai && x.detail === 'abstract').map((x) => x.id).sort();
  const [a, b] = far;
  relationOf(g, a, b).contact = true;
  relationOf(g, a, b).value = -60;
  return { g, a, b };
}
const wounds = (g, sid) => g.owned('colonists', sid).reduce((n, c) => n + (c.health?.injuries || []).filter((i) => i.kind === 'wound').length, 0);

test('a war between two distant villages is fought in aggregate: both sides take wounds, the war does not cool', () => {
  const { g, a, b } = vastWar();
  declareWar(g, a, b, 'Test war');
  assert.ok(warStrength(g, a) > 0 && warStrength(g, b) > 0);
  for (let d = 0; d < 6; d++) { tickRivalry(g); g.s.tick += TICKS_PER_DAY; } // six days of fighting (only the daily rule)
  assert.ok(wounds(g, a) > 0 && wounds(g, b) > 0, `wounds: ${wounds(g, a)} and ${wounds(g, b)}`);
  assert.ok(relationPeek(g, a, b).lastClash !== undefined, 'a clash was recorded');
  assert.equal(relationPeek(g, a, b).aggressor, a, 'still at war');
  assert.ok(g.s.log.some((e) => /^Fighting between/.test(e.msg)));
  assert.deepEqual(conservationErrors(g), []);
});

test('the weaker side sues for peace only after the war\'s first days; an old war ends anyway', () => {
  const { g, a, b } = vastWar();
  declareWar(g, a, b, 'Test war');
  weaken(g, b);
  const min = g.reg.get('scenario', g.s.scenarioId).war.truce;
  tickRivalry(g);
  assert.ok(relationPeek(g, a, b).aggressor, 'still at war on the first day');
  relationOf(g, a, b).warSince = g.s.tick - min.minDays * TICKS_PER_DAY;
  tickRivalry(g);
  assert.equal(relationPeek(g, a, b).aggressor, undefined, 'peace');
  assert.ok(g.s.log.some((e) => /sued .* for peace \(.* is losing\)/.test(e.msg)));
  // An even war that drags on also ends.
  const v = vastWar();
  declareWar(v.g, v.a, v.b, 'Test war');
  relationOf(v.g, v.a, v.b).warSince = v.g.s.tick - min.maxDays * TICKS_PER_DAY;
  tickRivalry(v.g);
  assert.equal(relationPeek(v.g, v.a, v.b).aggressor, undefined);
  assert.ok(v.g.s.log.some((e) => /the war has gone on too long/.test(e.msg)));
});

test('a distant village looks after its wounded: wounds do not fester while others are on their feet', () => {
  const { g, a } = vastWar();
  const [c] = g.owned('colonists', a);
  const w = injure(g, c, 'wound', 30, 'A test wound');
  w.infected = true; // as if it had festered
  const inf = injure(g, c, 'infection', 10, 'Infected wound');
  g.step(12 * 100);
  assert.ok(!c.health.injuries.includes(inf) || inf.severity < 10, `the infection does not grow: ${inf.severity}`);
});

test('a war fought with battles saves and loads to an identical continuation', () => {
  const run = (cut) => {
    let { g, a, b } = vastWar();
    declareWar(g, a, b, 'Test war');
    for (let d = 1; d <= 4; d++) { g.step(TICKS_PER_DAY); if (cut.includes(d)) g = reload(g); }
    return g;
  };
  assert.equal(stateText(run([])), stateText(run([1, 3])));
});

// ---------------- review fixes ----------------
import { isEnemy, tickMilitary } from '../src/sim/combat.js';

test('war games: rivals who are merely hostile are not enemies (no raids, no fighting on sight) until war starts', () => {
  const g = warGame();
  const p = g.s.playerSettlement;
  const a = Object.keys(g.s.settlements).find((x) => g.s.settlements[x].ai);
  relationOf(g, a, p).contact = true;
  relationOf(g, a, p).value = -60;
  assert.equal(isEnemy(g, a, p), false, 'hostile, but no war');
  for (const c of g.owned('colonists', a)) c.equip.weapon = { item: 'core:spear', dur: 100 };
  tickMilitary(g);
  assert.notEqual(g.s.military?.[a]?.order, 'attack', 'no raid without a declaration (and so without the threat)');
  const c = newGame({ seed: 7, scenario: 'core:neighbours', size: 'medium', villages: 2 }); // no war rules: as before
  const b = Object.keys(c.s.settlements).find((x) => c.s.settlements[x].ai);
  relationOf(c, b, c.s.playerSettlement).contact = true;
  relationOf(c, b, c.s.playerSettlement).value = -60;
  assert.equal(isEnemy(c, b, c.s.playerSettlement), true);
});

test('every war gets a start date (joiners too), and peace clears the war markers', () => {
  const { g, a, b } = vastWar();
  declareWar(g, a, b, 'Test war');
  const rel = relationOf(g, a, b);
  assert.equal(rel.warSince, g.s.tick);
  for (const k of Object.keys(g.s.relations)) { const r = g.s.relations[k]; if (r.joinedFor) assert.ok(r.warSince !== undefined, 'a joiner\'s war has a start date'); }
  rel.threat = g.s.tick;
  changeRelation(g, a, b, 60, 'A test peace');
  assert.equal(rel.aggressor, undefined);
  assert.equal(rel.warSince, undefined);
  assert.equal(rel.threat, undefined);
});

// ---------------- slice 6b: conquest ----------------
import { kingdomOf as kOf } from '../src/sim/kingdoms.js';

/** A war between two distant villages where b has no fighters left (all collapsed). */
function beatenWar(profile) {
  const v = vastWar();
  if (profile) v.g.s.settlements[v.a].profile = profile;
  declareWar(v.g, v.a, v.b, 'Test war');
  for (const c of v.g.owned('colonists', v.b)) injure(v.g, c, 'injury', 70, 'Beaten in a test');
  return v;
}

test('a village without fighters for the beaten days is conquered: annexed into the winner\'s kingdom, the war ends', () => {
  const { g, a, b } = beatenWar('core:river_hamlet'); // a profile without "conquest": absorb
  tickRivalry(g);
  assert.ok(relationPeek(g, a, b).beaten?.sid === b, 'beaten noted');
  assert.ok(relationPeek(g, a, b).aggressor, 'not yet conquered');
  g.s.tick += 2 * TICKS_PER_DAY;
  tickRivalry(g);
  const k = kOf(g, a);
  assert.ok(k, 'the winner has a kingdom');
  assert.equal(kOf(g, b)?.id, k.id, 'the beaten village is in it');
  assert.equal(relationPeek(g, a, b).aggressor, undefined, 'the war is over');
  assert.ok(relationPeek(g, a, b).value >= 25, 'friendly under the crown');
  assert.ok(g.s.log.some((e) => /has conquered/.test(e.msg)));
});

test('a winner of a sacking profile takes tribute instead', () => {
  const { g, a, b } = beatenWar('core:hill_fort');
  tickRivalry(g);
  g.s.tick += 2 * TICKS_PER_DAY;
  tickRivalry(g);
  const t = Object.values(g.s.trades).find((x) => x.tribute && x.seller === b && x.buyer === a);
  assert.ok(t, 'a tribute trade');
  assert.ok(t.legs.length > 0);
  assert.equal(kOf(g, b), null, 'not annexed');
  assert.equal(relationPeek(g, a, b).aggressor, undefined, 'the war is over');
  assert.ok(g.s.log.some((e) => /has sacked/.test(e.msg)));
});

test('the player\'s village is never beaten this way', () => {
  const { g, a } = vastWar();
  const p = g.s.playerSettlement;
  relationOf(g, a, p).contact = true;
  declareWar(g, a, p, 'Test war');
  for (const c of g.owned('colonists', p)) injure(g, c, 'injury', 70, 'Beaten in a test');
  for (let d = 0; d < 4; d++) { tickRivalry(g); g.s.tick += TICKS_PER_DAY; }
  assert.equal(relationPeek(g, a, p).beaten, undefined);
  assert.equal(kOf(g, p), null);
});
