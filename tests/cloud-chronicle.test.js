// Phase 12: the connected world chronicle (docs/proposals/phase-12-chronicle.md). Slice 1: structured events.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame } from './cloud-helpers.js';
import { CHRONICLE, isEvent, yearOf } from '../src/sim/chronicle.js';
import { declareWar } from '../src/sim/combat.js';
import { relationOf } from '../src/sim/villages.js';
import { killColonist } from '../src/sim/death.js';
import { setCivLaw } from '../src/sim/civlaws.js';

test('chronicle: a line with event details gets a stable id, its kind, villages (sorted, once) and place', () => {
  const g = newGame({ seed: 4242 });
  const a = g.log('Plain line.');
  assert.equal(a, null, 'a plain line has no id');
  assert.equal(g.s.log.at(-1).id, undefined);
  const id = g.log('Something.', 'warn', null, 0, { kind: 'core:outbreak', sids: ['b', 'a', 'b'], cids: ['c1'], at: { x: 3.4, y: 7.6 } });
  assert.equal(id, 'e1');
  assert.deepEqual(g.s.log.at(-1), { t: g.s.tick, msg: 'Something.', cat: 'warn', id: 'e1', kind: 'core:outbreak', sids: ['a', 'b'], cids: ['c1'], at: { x: 3, y: 8 } });
  assert.equal(g.log('Again.', 'info', null, 0, { kind: 'core:death' }), 'e2');
  // Held back by its key: no line, no id used.
  assert.equal(g.log('Keyed.', 'info', 'k', 600, { kind: 'core:death' }), 'e3');
  assert.equal(g.log('Keyed.', 'info', 'k', 600, { kind: 'core:death' }), null);
  assert.equal(g.log('Next.', 'info', null, 0, { kind: 'core:death' }), 'e4');
});

test('chronicle: the newest 500 routine lines and 2,000 events are kept; older events fold into yearly counts', () => {
  const g = newGame({ seed: 4242 });
  g.s.log.length = 0;
  for (let i = 0; i < 2300; i++) {
    g.s.tick = i * 10;
    g.log(`War ${i}.`, 'warn', null, 0, { kind: 'core:war_declared', sids: ['v1', 'v2'] });
    g.log(`Routine ${i}.`);
    g.log(`Tithe ${i}.`, 'info', null, 0, { kind: 'core:tithe', sids: ['v1'] }); // a routine kind: rolls off with the routine lines
  }
  const ev = g.s.log.filter((e) => isEvent(g, e));
  assert.equal(ev.length, CHRONICLE.events);
  assert.equal(g.s.log.length - ev.length, CHRONICLE.routine);
  assert.equal(ev[0].msg, 'War 300.', 'the oldest events went first');
  assert.equal(g.s.log.at(-1).msg, 'Tithe 2299.');
  const C = g.s.chronicle;
  const folded = Object.values(C.years).reduce((n, Y) => n + (Y.v1?.['core:war_declared'] || 0), 0);
  assert.equal(folded, 300, 'the 300 oldest wars are counted');
  assert.equal(Object.values(C.years).reduce((n, Y) => n + (Y.v2?.['core:war_declared'] || 0), 0), 300, 'under each village');
  assert.equal(C.years[String(yearOf(g, 0))].v1['core:war_declared'] > 0, true);
  assert.equal(C.folded, 2 * 299 + 1, 'the last folded id (war 299: two ids a round)');
  // Saves and loads, the caps still holding after.
  const b = loadGame(g.reg, serializeGame(g));
  assert.equal(stateText(b), stateText(g));
  b.log('One more.', 'warn', null, 0, { kind: 'core:war_declared', sids: ['v1'] });
  assert.equal(b.s.log.filter((e) => isEvent(b, e)).length, CHRONICLE.events);
});

test('chronicle: a declared war is recorded with both villages; saves and loads; old saves and bad ids', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  runDays(g, 1);
  const [a, b] = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
  relationOf(g, a, b).contact = true;
  declareWar(g, a, b, 'A test war');
  const w = g.s.log.find((e) => e.kind === 'core:war_declared');
  assert.ok(w, 'the declaration is an event');
  assert.deepEqual(w.sids, [a, b].sort());
  assert.match(w.msg, /A test war/);
  const r = reload(g);
  runDays(g, 1); runDays(r, 1);
  assert.equal(stateText(r), stateText(g));
  // An old save (format 33): no chronicle, plain lines; it loads and records from e1.
  const old = JSON.parse(serializeGame(g));
  delete old.state.chronicle;
  for (const e of old.state.log) for (const k of ['id', 'kind', 'sids', 'cids', 'at', 'cause', 'rel']) delete e[k];
  old.saveFormat = 33;
  const o = loadGame(g.reg, JSON.stringify(old));
  assert.equal(o.log('x', 'info', null, 0, { kind: 'core:death' }), 'e1');
  // A repeated or out-of-range id is refused.
  const bad = JSON.parse(serializeGame(g));
  const evs = bad.state.log.filter((e) => e.id);
  evs[0].id = `e${bad.state.chronicle.next}`;
  assert.throws(() => loadGame(g.reg, JSON.stringify(bad)), /event id/);
});

test('chronicle: everyday milestones carry their kinds (a death, a law)', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  runDays(g, 1);
  const c = g.colonists()[0], sid = g.s.playerSettlement;
  killColonist(g, c);
  const d = g.s.log.find((e) => e.kind === 'core:death');
  assert.ok(d, 'a death is an event');
  assert.deepEqual(d.cids, [c.id]);
  assert.deepEqual(d.sids, [sid]);
  setCivLaw(g, sid, 'core:rationing', 'rationed', '', { force: true });
  assert.deepEqual(g.s.log.at(-1).sids, [sid]);
  assert.equal(g.s.log.at(-1).kind, 'core:law');
  for (const k of new Set(g.s.log.map((e) => e.kind).filter(Boolean))) assert.ok(g.reg.get('eventKind', k), `${k} is a known kind`);
});
