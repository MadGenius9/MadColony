// Phase 12: the connected world chronicle (docs/proposals/phase-12-chronicle.md). Slice 1: structured events.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame } from './cloud-helpers.js';
import { CHRONICLE, isEvent, yearOf } from '../src/sim/chronicle.js';
import { declareWar } from '../src/sim/combat.js';
import { relationOf } from '../src/sim/villages.js';
import { killColonist } from '../src/sim/death.js';
import { setCivLaw } from '../src/sim/civlaws.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

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

// ---- slice 2: cause links, only where the game holds the cause
import { makePeace } from '../src/sim/combat.js';
import { tickCivLaws } from '../src/sim/civreview.js';
import { changeRelation } from '../src/sim/villages.js';

const byId = (g, id) => g.s.log.find((e) => e.id === id);

test('chronicle: peace links to the war it ends; the war is linked (as an association) to the last dispute', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  runDays(g, 1);
  const [a, b] = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
  const rel = relationOf(g, a, b);
  rel.contact = true;
  changeRelation(g, a, b, 30, 'A good trade'); // a recorded relations change
  const before = rel.lastEv;
  assert.ok(before, 'the relations line is remembered on the pair');
  declareWar(g, a, b, 'A test war');
  const war = g.s.log.find((e) => e.kind === 'core:war_declared');
  assert.equal(war.cause, undefined, 'no cause is claimed for a rivalry war');
  assert.equal(war.rel, before, 'the last dispute is linked as "followed"');
  assert.equal(relationOf(g, a, b).warEv, war.id);
  makePeace(g, a, b, 'A test truce');
  const peace = g.s.log.find((e) => e.kind === 'core:peace');
  assert.ok(peace, 'peace is an event');
  assert.equal(peace.cause, war.id, 'peace links to the declaration');
  assert.equal(relationOf(g, a, b).warEv, undefined, 'the marker ends with the war');
  const r = reload(g);
  runDays(g, 1); runDays(r, 1);
  assert.equal(stateText(r), stateText(g));
});

test('chronicle: an AI village\'s militia law links to the war; a tithe links to the capital\'s tithe law', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  runDays(g, 1);
  const [a, b] = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
  relationOf(g, a, b).contact = true;
  declareWar(g, a, b, 'A test war');
  const war = g.s.log.find((e) => e.kind === 'core:war_declared');
  // Run the daily reviews until each village has reviewed once (every 10 days, offset by village).
  for (let d = 0; d < 10 && !g.s.log.some((e) => e.kind === 'core:law' && e.cause); d++) { g.s.tick += TICKS_PER_DAY; tickCivLaws(g); }
  const law = g.s.log.find((e) => e.kind === 'core:law' && /militia/i.test(e.msg));
  assert.ok(law, 'a militia law was passed');
  assert.equal(law.cause, war.id);
  assert.equal(g.s.settlements[law.sids[0]].codeEv['core:conscription'], law.id, 'the law remembers its line');
  // Repealing it forgets the line.
  setCivLaw(g, law.sids[0], 'core:conscription', 'none', '', { force: true });
  assert.equal(g.s.settlements[law.sids[0]].codeEv?.['core:conscription'], undefined);
});

import { formKingdom } from '../src/sim/kingdoms.js';
import { tickTithes } from '../src/sim/tithe.js';

test('chronicle: a tithe links to the capital\'s tithe law', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  runDays(g, 6);
  const [a, b] = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
  if (!g.s.settlements[a].kingdom) formKingdom(g, a, b);
  const cap = g.s.kingdoms[g.s.settlements[a].kingdom].capital, member = cap === a ? b : a;
  setCivLaw(g, cap, 'core:tithe', 'tithe', 'a test', { force: true });
  const law = g.s.settlements[cap].codeEv['core:tithe'];
  assert.ok(law);
  for (let d = 0; d < 10 && !g.s.log.some((e) => e.kind === 'core:tithe'); d++) { g.s.tick += TICKS_PER_DAY; tickTithes(g); }
  const t = g.s.log.find((e) => e.kind === 'core:tithe');
  assert.ok(t, 'a tithe was sent');
  assert.deepEqual(t.sids, [cap, member].sort());
  assert.equal(t.cause, law);
});

// ---- slice 3: reading
import { eventsOf, chainOf, subjectOf, follow, favourite, favourites, notifies, newsSince, familyOf, eventById } from '../src/sim/chronicle.js';

test('chronicle: filters, a chain back and forward, the jump target, follow and favourites (saved)', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  runDays(g, 1);
  const me = g.s.playerSettlement;
  const [a, b] = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
  relationOf(g, a, b).contact = true;
  changeRelation(g, a, b, 30, 'A good trade');
  const t0 = g.s.tick;
  declareWar(g, a, b, 'A test war');
  makePeace(g, a, b, 'A test truce');
  const war = eventsOf(g, { kind: 'core:war_declared' })[0], peace = eventsOf(g, { kind: 'core:peace' })[0];
  assert.ok(war && peace);
  assert.ok(eventsOf(g, { sid: a }).every((e) => e.sids.includes(a)));
  assert.ok(eventsOf(g, { from: t0, importance: 'milestone' }).every((e) => e.t >= t0 && g.reg.get('eventKind', e.kind).importance === 'milestone'));
  assert.equal(eventsOf(g, { sid: me, kind: 'core:war_declared' }).length, 0);
  // The chain from the peace: peace <-cause- war <-followed- the relations change.
  const ch = chainOf(g, peace.id);
  assert.deepEqual(ch.back.map((s) => [s.link, s.event.kind]), [['cause', 'core:war_declared'], ['followed', 'core:relations']]);
  assert.ok(chainOf(g, war.id).forward.some((s) => s.link === 'cause' && s.event.id === peace.id));
  assert.equal(chainOf(g, 'e999999'), null);
  // Jump: the war names no place: the first village's centre.
  assert.deepEqual(subjectOf(g, war.id).at, { x: g.s.settlements[a].center.x, y: g.s.settlements[a].center.y });
  // Notifications: a war is world news; a relations change never notifies.
  assert.equal(notifies(g, war), true);
  assert.equal(notifies(g, eventsOf(g, { kind: 'core:relations' })[0]), false);
  assert.ok(newsSince(g, t0).some((e) => e.id === war.id));
  // A death notifies only when followed.
  const c = g.owned('colonists', a)[0];
  killColonist(g, c);
  const d = eventsOf(g, { cid: c.id, kind: 'core:death' })[0];
  assert.equal(notifies(g, d), false);
  assert.equal(follow(g, `p:${c.id}`).ok, true);
  assert.equal(notifies(g, d), true);
  assert.equal(eventsOf(g, { followed: true }).length >= 1, true);
  assert.ok(familyOf(g, c.id).includes(c.id));
  assert.equal(follow(g, 'nonsense').ok, false);
  assert.equal(favourite(g, peace.id).ok, true);
  assert.equal(favourite(g, 'e999999').ok, false);
  assert.deepEqual(favourites(g).map((e) => e.id), [peace.id]);
  // Saved and loaded.
  const r = reload(g);
  assert.deepEqual(r.s.chronicle.follow, [`p:${c.id}`]);
  assert.deepEqual(r.s.chronicle.favs, [peace.id]);
  runDays(g, 1); runDays(r, 1);
  assert.equal(stateText(r), stateText(g));
  // Unfollow empties the list (no empty arrays saved).
  follow(g, `p:${c.id}`, false);
  assert.equal(g.s.chronicle.follow, undefined);
  // A folded id reads as summarised.
  g.s.chronicle.folded = 1;
  assert.deepEqual(eventById(g, 'e1'), g.s.log.find((e) => e.id === 'e1') || { id: 'e1', summarised: true });
});

test('chronicle: relations recovering from hostile with no war on record are a relations change, not peace', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  runDays(g, 1);
  const [a, b] = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
  const rel = relationOf(g, a, b);
  rel.contact = true;
  changeRelation(g, a, b, -40 - rel.value, 'A quarrel');
  assert.equal(rel.aggressor, undefined, 'no war');
  changeRelation(g, a, b, 30, 'Gifts');
  assert.equal(g.s.log.some((e) => e.kind === 'core:peace'), false);
  assert.equal(g.s.log.at(-1).kind, 'core:relations');
});

test('chronicle: the end of a war joined to defend an ally is its own kind (minor news, no notification)', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  runDays(g, 1);
  const [a, b] = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
  const rel = relationOf(g, a, b);
  rel.contact = true;
  changeRelation(g, a, b, -40 - rel.value, 'Attacked our ally');
  rel.aggressor = a; rel.joinedFor = g.s.playerSettlement; // as joinDefence marks it
  makePeace(g, a, b, 'A truce');
  const e = g.s.log.at(-1);
  assert.equal(e.kind, 'core:peace_joined');
  assert.equal(notifies(g, e), false);
});
