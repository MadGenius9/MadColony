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
