// Civilization laws (docs/proposals/civilization-laws.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame, TICKS_PER_DAY } from './cloud-helpers.js';
import { civLawOf, civLawProblem, setCivLaw, codeOf, leaningsOf, optionMood } from '../src/sim/civlaws.js';
import { formKingdom } from '../src/sim/kingdoms.js';

test('civ laws: villages start with their people\'s leanings; the player starts with none; classic villages keep the defaults', () => {
  const g = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast' });
  assert.equal(g.s.settlements[g.s.playerSettlement].code, undefined);
  for (const [sid, st] of Object.entries(g.s.settlements)) {
    if (!st.ai) continue;
    for (const [law, option] of Object.entries(leaningsOf(g, sid))) assert.equal(civLawOf(g, sid, law), option, `${st.name} ${law}`);
  }
  const crag = Object.keys(g.s.settlements).find((k) => g.s.settlements[k].people === 'core:cragborn');
  assert.equal(civLawOf(g, crag, 'core:conscription'), 'militia');
  const classic = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  assert.ok(Object.values(classic.s.settlements).every((st) => !st.code), 'Hearthfolk lean to the defaults');
  assert.ok(optionMood(g, 'core:rationing', 'rationed') < 0, 'options carry a mood for the Mood phase');
});

test('civ laws: the player sets a law, waits 5 days to change it again, and the code saves, loads and mends', () => {
  const g = newGame({ seed: 3 });
  g.tick();
  const me = g.s.playerSettlement;
  assert.equal(setCivLaw(g, me, 'core:rationing', 'rationed', 'food is short').ok, true);
  assert.equal(civLawOf(g, me, 'core:rationing'), 'rationed');
  assert.match(g.s.log.at(-1).msg, /passed a law: Rationing, rationed \(food is short\)/);
  assert.match(civLawProblem(g, me, 'core:rationing', 'none'), /wait 5 more days/);
  assert.match(civLawProblem(g, me, 'core:rationing', 'rationed'), /already/);
  assert.match(civLawProblem(g, me, 'core:nope', 'x'), /no law/);
  assert.match(civLawProblem(g, me, 'core:rationing', 'loud'), /one of/);
  assert.deepEqual(codeOf(g, me).map((x) => x.id), ['core:rationing']);
  const b = reload(g);
  runDays(g, 1); runDays(b, 1);
  assert.equal(stateText(b), stateText(g));
  runDays(g, 5);
  assert.equal(setCivLaw(g, me, 'core:rationing', 'none').ok, true);
  assert.equal(g.s.settlements[me].code, undefined, 'back to the default: no code saved');
  const t = JSON.parse(serializeGame(g));
  t.state.settlements[me].code = { 'gone:law': 'x', 'core:hunting': 'banned' };
  assert.deepEqual(loadGame(g.reg, JSON.stringify(t)).s.settlements[me].code, { 'core:hunting': 'banned' }, 'a removed mod\'s law is dropped');
  t.state.settlements[me].codeSince = { 'core:hunting': t.state.tick + 5 };
  assert.throws(() => loadGame(g.reg, JSON.stringify(t)), /law dates/);
});

test('civ laws: a kingdom\'s capital sets its kingdom laws for every member; members keep their own other laws', () => {
  const g = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast' });
  const [cap, mem] = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
  formKingdom(g, cap, mem);
  setCivLaw(g, cap, 'core:borders', 'closed', 'a test', { force: true });
  assert.equal(civLawOf(g, mem, 'core:borders'), 'closed', 'the member follows the capital');
  assert.match(civLawProblem(g, mem, 'core:borders', 'open'), /set by/);
  assert.equal(setCivLaw(g, mem, 'core:rationing', 'rationed', '', { force: true }).ok, true, 'its own laws stay its own');
  assert.ok(codeOf(g, mem).some((x) => x.id === 'core:borders' && x.byKingdom === cap));
});
