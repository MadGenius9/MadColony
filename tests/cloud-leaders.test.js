// Phase 6, slice 1: leaders and succession (docs/proposals/phase-6-government.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame } from './cloud-helpers.js';
import { tickLeaders, chooseLeader, leaderOf, rulerOf } from '../src/sim/leaders.js';
import { killColonist } from '../src/sim/death.js';
import { formKingdom } from '../src/sim/kingdoms.js';
import { chainOf } from '../src/sim/chronicle.js';
import { ageYears } from '../src/sim/life.js';
import { isAdult } from '../src/sim/people.js';

test('leaders: every village has one, the eldest by default, chosen quietly; a dead leader is succeeded, linked to the death', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  runDays(g, 1);
  const sids = Object.keys(g.s.settlements);
  for (const sid of sids) assert.ok(leaderOf(g, sid), `${sid} has a leader`);
  assert.equal(g.s.log.some((e) => e.kind === 'core:leader'), false, 'first leaders are not news');
  const sid = g.s.playerSettlement, L = leaderOf(g, sid);
  const adults = g.owned('colonists', sid).filter((c) => isAdult(g, c));
  const oldest = Math.max(...adults.map((c) => ageYears(g, c) ?? 0));
  assert.equal(ageYears(g, g.s.colonists[L.cid]) ?? 0, oldest, 'the eldest');
  killColonist(g, g.s.colonists[L.cid]);
  tickLeaders(g);
  const e = g.s.log.at(-1);
  assert.equal(e.kind, 'core:leader');
  assert.match(e.msg, /now leads .* after .* died/);
  const death = g.s.log.find((x) => x.kind === 'core:death' && x.cids?.includes(L.cid));
  assert.equal(e.cause, death.id);
  assert.ok(chainOf(g, e.id).back.some((x) => x.event.id === death.id));
  assert.notEqual(leaderOf(g, sid).cid, L.cid);
  // Not reshuffled while still eligible.
  const now = leaderOf(g, sid).cid, n = g.s.log.length;
  tickLeaders(g);
  assert.equal(leaderOf(g, sid).cid, now);
  assert.equal(g.s.log.length, n);
});

test('leaders: a people may choose the wisest or the bravest', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  runDays(g, 1);
  const sid = Object.keys(g.s.settlements).find((k) => g.s.settlements[k].ai);
  const adults = g.owned('colonists', sid).filter((c) => isAdult(g, c));
  for (const c of adults) c.traits = [];
  g.s.settlements[sid].people = 'core:reedkin'; // wisest
  const pick = adults.at(-1); pick.traits = ['core:wise'];
  assert.equal(chooseLeader(g, sid).c.id, pick.id, 'the Wise one');
  g.s.settlements[sid].people = 'core:cragborn'; // bravest
  pick.traits = []; const brave = adults[0]; brave.traits = ['core:brave'];
  assert.equal(chooseLeader(g, sid).c.id, brave.id, 'the Brave one');
});

test('leaders: a kingdom is ruled by its capital\'s leader; a new one there is news; saves, loads, old saves', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  runDays(g, 1);
  const [a, b] = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
  if (!g.s.settlements[a].kingdom) formKingdom(g, a, b);
  const kid = g.s.settlements[a].kingdom, cap = g.s.kingdoms[kid].capital;
  tickLeaders(g);
  assert.equal(rulerOf(g, kid).cid, leaderOf(g, cap).cid);
  assert.equal(g.s.log.some((e) => e.kind === 'core:ruler'), false, 'the first ruler is not news');
  killColonist(g, g.s.colonists[leaderOf(g, cap).cid]);
  tickLeaders(g);
  const e = g.s.log.find((x) => x.kind === 'core:ruler');
  assert.ok(e, 'a new ruler');
  assert.equal(rulerOf(g, kid).cid, leaderOf(g, cap).cid);
  const r = reload(g);
  runDays(g, 1); runDays(r, 1);
  assert.equal(stateText(r), stateText(g));
  const old = JSON.parse(serializeGame(g));
  for (const st of Object.values(old.state.settlements)) { delete st.leader; delete st.leaderSince; }
  for (const k of Object.values(old.state.kingdoms || {})) delete k.ruler;
  old.saveFormat = 37;
  const o = loadGame(g.reg, JSON.stringify(old));
  tickLeaders(o);
  assert.ok(Object.keys(o.s.settlements).every((k) => o.s.settlements[k].fallen || !o.owned('colonists', k).length || leaderOf(o, k)), 'leaders chosen for an old save');
  const bad = JSON.parse(serializeGame(g));
  bad.state.settlements[a].leaderSince = 1e12;
  assert.throws(() => loadGame(g.reg, JSON.stringify(bad)), /leader/);
});
