// Phase 15: village memories and traditions (docs/proposals/phase-15-memories.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame } from './cloud-helpers.js';
import { addMemory, tickMemories, memoryMood, traditionMood, memoriesOf, petitionPatience, hasTradition, MEMORY } from '../src/sim/memories.js';
import { leaningsOf } from '../src/sim/civlaws.js';
import { thoughtsOf } from '../src/sim/mood.js';
import { issueCommand } from '../src/sim/god.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

const day = (g, n = 1) => { g.s.tick += n * TICKS_PER_DAY; };

test('memories: two monsters defeated give Hunters\' pride, with the events behind it; the moods show as thoughts', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const sid = g.s.playerSettlement, c = g.colonists()[0];
  const e1 = g.log('Slew one.', 'good', null, 0, { kind: 'core:monster_slain', sids: [sid] });
  addMemory(g, sid, 'core:monster_defeated', e1);
  assert.equal(hasTradition(g, sid, 'core:hunters_pride'), false, 'not after one');
  assert.equal(memoryMood(g, sid), 3);
  const e2 = g.log('Slew two.', 'good', null, 0, { kind: 'core:monster_slain', sids: [sid] });
  addMemory(g, sid, 'core:monster_defeated', e2);
  assert.equal(hasTradition(g, sid, 'core:hunters_pride'), true);
  const [t] = memoriesOf(g, sid).traditions;
  assert.deepEqual(t.why, [e1, e2], 'it records why');
  const line = g.s.log.find((e) => e.id === t.ev);
  assert.match(line.msg, /has a new tradition: Hunters' pride \(defeated a monster, 2 times\)/);
  assert.equal(line.cause, e2);
  assert.equal(memoryMood(g, sid), 6, 'two memories, +3 each');
  assert.equal(traditionMood(g, sid), 2);
  const th = thoughtsOf(g, c);
  assert.equal(th.find((x) => x.id === 'core:memories')?.value, 6);
  assert.equal(th.find((x) => x.id === 'core:traditions')?.value, 2);
  // A third: the stack holds 2; the tradition is not given twice.
  addMemory(g, sid, 'core:monster_defeated', null);
  assert.equal(g.s.settlements[sid].memories.filter((m) => m.kind === 'core:monster_defeated').length, 2);
  assert.equal(g.s.settlements[sid].traditions.length, 1);
  // Memories fade after their days; the tradition stays.
  day(g, 21); tickMemories(g);
  assert.equal(g.s.settlements[sid].memories, undefined);
  assert.equal(memoryMood(g, sid), 0);
  assert.equal(hasTradition(g, sid, 'core:hunters_pride'), true, 'kept for good');
});

test('memories: a famine that lasted and ended is remembered; twice makes a village Frugal, which leans to rationing', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  runDays(g, 1);
  const a = Object.keys(g.s.settlements).find((k) => g.s.settlements[k].ai);
  const famine = () => {
    g.plans[a].foodDays = 0.5; tickMemories(g);
    day(g, 2); tickMemories(g);
    g.plans[a].foodDays = 6; day(g); tickMemories(g);
  };
  // A short dip is not a famine.
  g.plans[a].foodDays = 0.5; tickMemories(g); g.plans[a].foodDays = 6; day(g); tickMemories(g);
  assert.equal(g.s.settlements[a].memories, undefined, 'one day under: not remembered');
  famine();
  assert.equal(g.s.settlements[a].memories.length, 1);
  assert.ok(g.s.log.some((e) => e.kind === 'core:memory' && /came through a famine/.test(e.msg)));
  assert.equal(memoryMood(g, a), -2);
  assert.notEqual(leaningsOf(g, a)['core:rationing'], 'rationed');
  famine();
  assert.equal(hasTradition(g, a, 'core:frugal'), true);
  assert.equal(leaningsOf(g, a)['core:rationing'], 'rationed', 'a Frugal village leans to rationing');
});

test('memories: bounds (8 in all, mood capped at 6); Devout prayers wait longer; Hardened halves disasters', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const sid = g.s.playerSettlement;
  for (let i = 0; i < 6; i++) for (const k of ['core:disaster_endured', 'core:aid_received', 'core:famine_survived', 'core:monster_defeated']) addMemory(g, sid, k, null);
  const st = g.s.settlements[sid];
  assert.ok(st.memories.length <= MEMORY.max);
  assert.ok(st.traditions.length <= MEMORY.traditions);
  assert.equal(st.traditions.length, 3, 'the first three to qualify');
  assert.ok(Math.abs(memoryMood(g, sid)) <= MEMORY.moodCap);
  assert.equal(hasTradition(g, sid, 'core:devout'), true);
  assert.equal(petitionPatience(g, sid), 1.5);
  // Hardened on its own: two disasters at −3 count half.
  const h = newGame({ seed: 4242 });
  runDays(h, 1);
  const hs = h.s.playerSettlement;
  addMemory(h, hs, 'core:disaster_endured', null);
  assert.equal(memoryMood(h, hs), -3);
  addMemory(h, hs, 'core:disaster_endured', null);
  assert.equal(hasTradition(h, hs, 'core:hardened'), true);
  assert.equal(memoryMood(h, hs), -3, 'two at half weight');
});

test('memories: a destructive power on a village is remembered; two villages grow different traditions; save and load', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2, sandbox: true });
  runDays(g, 1);
  const [a, b] = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
  const ca = g.s.settlements[a].center;
  assert.ok(issueCommand(g, 'drought', { x: ca.x, y: ca.y, confirm: true }).ok);
  g.tick();
  const m = g.s.settlements[a].memories?.find((x) => x.kind === 'core:disaster_endured');
  assert.ok(m, 'the drought is remembered');
  assert.equal(g.s.log.find((e) => e.id === m.ev)?.kind, 'core:god_power', 'it cites the power');
  addMemory(g, a, 'core:disaster_endured', null);
  addMemory(g, b, 'core:monster_defeated', null); addMemory(g, b, 'core:monster_defeated', null);
  assert.deepEqual(memoriesOf(g, a).traditions.map((t) => t.id), ['core:hardened']);
  assert.deepEqual(memoriesOf(g, b).traditions.map((t) => t.id), ['core:hunters_pride']);
  const r = reload(g);
  runDays(g, 1); runDays(r, 1);
  assert.equal(stateText(r), stateText(g));
  const old = JSON.parse(serializeGame(g));
  for (const st of Object.values(old.state.settlements)) { delete st.memories; delete st.memCount; delete st.traditions; delete st.famine; }
  old.saveFormat = 36;
  assert.ok(loadGame(g.reg, JSON.stringify(old)));
  const bad = JSON.parse(serializeGame(g));
  bad.state.settlements[a].traditions = [{ id: 'core:hardened' }];
  assert.throws(() => loadGame(g.reg, JSON.stringify(bad)), /memories or traditions/);
});
