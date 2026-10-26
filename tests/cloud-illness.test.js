// Contagious illness (Phase 5, slice 3): illnesses as data, outbreaks and spread as a scenario rule. Tested on the
// classic worlds with a test illness and the rules added to their data in this test's own registry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, conservationErrors, serializeGame, loadGame, TICKS_PER_DAY } from './cloud-helpers.js';
import { readAllMods } from '../tools/fsmods.js';
import { buildRegistry } from '../src/sim/content/modloader.js';
import { illnessRules, infect, sicknessOf, contagious, susceptible, spreadContact, tickSickness, tickIllness } from '../src/sim/illness.js';
import { killColonist } from '../src/sim/death.js';
import { treatmentNeeds } from '../src/sim/medical.js';

const PLAGUE = { id: 'core:test_plague', name: 'Test plague', contagion: 1, travel: 1, growPerHour: 0.5, days: 2, immunityDays: 10, treatedGrowth: 0.2 };
let REG = null;
function reg() {
  if (REG) return REG;
  const mods = readAllMods();
  const core = mods.find((m) => m.manifest.id === 'core');
  core.files['content/illness.json'].illness.push(PLAGUE);
  const rules = { outbreakPerDay: 0, villageShare: 0.3, kinds: [{ illness: PLAGUE.id, weight: 1 }] };
  for (const sc of core.files['content/setup.json'].scenario) if (sc.id === 'core:standard' || sc.id === 'core:neighbours') sc.illness = rules;
  REG = buildRegistry(mods, ['core']).registry;
  return REG;
}
const plague = () => reg().get('illness', PLAGUE.id);

test('without illness rules (classic games) nothing happens', () => {
  const g = newGame({ seed: 4242 });
  assert.equal(illnessRules(g), null);
  runDays(g, 1);
  assert.equal(g.s.stats.illness, undefined);
  spreadContact(g, 't1', 't1', 'nothing');
  assert.ok(g.reg.get('illness', 'core:grey_fever'), 'the shipped illnesses load');
});

test('an illness runs its course: grows, is contagious, then heals with immunity', () => {
  const g = newGame({ seed: 4242, registry: reg(), scenario: 'core:standard' });
  const c = g.colonists()[0];
  assert.ok(infect(g, c, plague(), 'a test'));
  assert.equal(infect(g, c, plague(), 'again'), null, 'cannot catch it twice at once');
  assert.ok(contagious(g, c));
  for (let k = 0; k < 16; k++) tickSickness(g, c, 0.25); // four hours
  assert.ok(Math.abs(sicknessOf(c).severity - (1 + 4 * PLAGUE.growPerHour)) < 0.01);
  g.step(PLAGUE.days * TICKS_PER_DAY + 100);
  assert.equal(sicknessOf(c), null, 'the course is over');
  assert.ok(!susceptible(g, c, plague()), 'immune afterwards');
  assert.ok(g.s.log.some((e) => /fell ill with test plague \(a test\)/.test(e.msg)));
});

test('a doctor\'s medicine slows it: treated illnesses grow at treatedGrowth', () => {
  const g = newGame({ seed: 4242, registry: reg(), scenario: 'core:standard' });
  const c = g.colonists()[0];
  const inj = infect(g, c, plague(), 'a test');
  assert.deepEqual(treatmentNeeds(g, c).map((n) => n.need), ['medicine'], 'doctors are asked for medicine');
  inj.treated = true;
  tickSickness(g, c, 1);
  assert.ok(Math.abs(inj.severity - (1 + PLAGUE.growPerHour * PLAGUE.treatedGrowth)) < 0.01);
});

test('it spreads within a village, first to those who share the home', () => {
  const g = newGame({ seed: 4242, registry: reg(), scenario: 'core:standard' });
  runDays(g, 3);
  const c = g.colonists().find((x) => x.homeId);
  infect(g, c, plague(), 'a test');
  g.step(TICKS_PER_DAY - (g.s.tick % TICKS_PER_DAY)); // to the next day start: the daily spread
  const mates = g.colonists().filter((o) => o !== c && o.homeId === c.homeId);
  assert.ok(mates.length, 'someone shares the home');
  for (const m of mates) assert.ok(sicknessOf(m) || !susceptible(g, m, plague()), `${m.name} caught it (contagion 1 at home)`);
  assert.ok(g.s.stats.illness.cases > 1);
});

test('it travels between villages: traders, caravans and carriers pass it both ways', () => {
  const g = newGame({ seed: 7, registry: reg(), scenario: 'core:neighbours', size: 'medium', villages: 2 });
  runDays(g, 1);
  const [a, b, c] = Object.keys(g.s.settlements).sort();
  for (const p of g.owned('colonists', a)) infect(g, p, plague(), 'a test'); // all of a: the chance scales with the share ill
  const ill = (sid) => g.owned('colonists', sid).filter((p) => sicknessOf(p)).length;
  assert.equal(ill(b), 0);
  spreadContact(g, a, b, 'traders from A');
  assert.equal(ill(b), 1, 'traders brought it from a to b');
  // A carrier from c who walks into a (which has the sick) catches it there.
  const carrier = g.owned('colonists', c)[0];
  spreadContact(g, c, a, '', carrier);
  assert.ok(sicknessOf(carrier), 'the carrier caught it in the village they delivered to');
  assert.ok(g.s.log.some((e) => /brought by traders from A/.test(e.msg)));
  assert.ok(g.s.log.some((e) => /caught in/.test(e.msg)));
});

test('outbreaks start by the scenario chance, only after graceDays, never with someone ill', () => {
  const mods = readAllMods();
  const core = mods.find((m) => m.manifest.id === 'core');
  core.files['content/illness.json'].illness.push(PLAGUE);
  core.files['content/setup.json'].scenario.find((x) => x.id === 'core:standard').illness = { outbreakPerDay: 1, graceDays: 2, kinds: [{ illness: PLAGUE.id, weight: 1 }] };
  const g = newGame({ seed: 4242, registry: buildRegistry(mods, ['core']).registry, scenario: 'core:standard' });
  runDays(g, 1);
  assert.equal(g.s.stats.illness, undefined, 'none in the grace days');
  runDays(g, 2);
  assert.ok(g.s.stats.illness?.outbreaks >= 1, 'an outbreak once the grace days are over');
  assert.ok(g.s.log.some((e) => /Test plague broke out in/.test(e.msg)));
});

test('a death from an illness says which', () => {
  const g = newGame({ seed: 4242, registry: reg(), scenario: 'core:standard' });
  const c = g.colonists()[0];
  infect(g, c, plague(), 'a test').severity = 100;
  const d = killColonist(g, c);
  assert.equal(d.cause, 'sickness');
  assert.equal(d.text, 'died of test plague');
});

test('a game with illness spreading saves and loads to an identical continuation', () => {
  const run = (cut) => {
    let g = newGame({ seed: 4242, registry: reg(), scenario: 'core:standard' });
    runDays(g, 2);
    infect(g, g.colonists()[0], plague(), 'a test');
    for (let d = 1; d <= 5; d++) { g.step(TICKS_PER_DAY / 2); if (cut.includes(d)) g = reload(g); g.step(TICKS_PER_DAY / 2); }
    return g;
  };
  const a = run([]), b = run([1, 3]);
  assert.ok(a.s.stats.illness.cases >= 2);
  assert.equal(stateText(a), stateText(b));
  assert.deepEqual(conservationErrors(a), []);
});

test('saves: a malformed illness or immunity is refused', () => {
  const g = newGame({ seed: 4242, registry: reg(), scenario: 'core:standard' });
  const c = g.colonists()[0];
  infect(g, c, plague(), 'a test');
  const text = serializeGame(g);
  assert.doesNotThrow(() => loadGame(g.reg, text));
  const bad = JSON.parse(text);
  bad.state.colonists[c.id].health.injuries[0].until = 'soon';
  assert.throws(() => loadGame(g.reg, JSON.stringify(bad)), /illness/);
  const bad2 = JSON.parse(text);
  bad2.state.colonists[c.id].immune = { [PLAGUE.id]: 'forever' };
  assert.throws(() => loadGame(g.reg, JSON.stringify(bad2)), /immunity/);
});

test('tickIllness is a no-op without rules', () => {
  const g = newGame({ seed: 4242 });
  const before = stateText(g);
  tickIllness(g);
  assert.equal(stateText(g), before);
});
