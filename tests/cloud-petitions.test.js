// Phase 13: prayers and petitions (docs/proposals/phase-13-petitions.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame, conservationErrors } from './cloud-helpers.js';
import { tickPetitions, petitionsOf, dismissPetition, conditionOf, PETITION } from '../src/sim/petitions.js';
import { issueCommand } from '../src/sim/god.js';
import { sendMonster } from '../src/sim/monsters.js';
import { notifies, chainOf } from '../src/sim/chronicle.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

const hungry = (g, sid, f) => { (g.plans[sid] ||= {}).foodDays = f; };
const day = (g) => { g.s.tick += TICKS_PER_DAY; };

test('petitions: a hungry village prays, with the evidence; it ends when food is back, then waits its cooldown', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const sid = g.s.playerSettlement;
  hungry(g, sid, 1.4);
  tickPetitions(g);
  const [p] = petitionsOf(g, sid);
  assert.ok(p, 'a petition is open');
  assert.equal(p.kind, 'core:hunger');
  assert.equal(p.evidence.foodDays, 1.4);
  assert.equal(p.daysLeft, 4);
  const e = g.s.log.find((x) => x.id === p.ev);
  assert.match(e.msg, /prays to the gods \(hunger\): food for 1\.4 days/);
  assert.equal(notifies(g, e), true, 'the player\'s own village: news');
  // Still short (3 days, under the end threshold of 4): stays open; then 5 days: resolved.
  hungry(g, sid, 3); day(g); tickPetitions(g);
  assert.equal(petitionsOf(g).length, 1, 'open while still under 4 days');
  hungry(g, sid, 5); day(g); tickPetitions(g);
  assert.equal(petitionsOf(g).length, 0);
  assert.match(g.s.log.at(-1).msg, /no longer prays \(hunger\)/);
  assert.equal(g.s.log.at(-1).cause, p.ev, 'linked to the prayer');
  // Hungry again at once: the cooldown holds it back.
  hungry(g, sid, 1); day(g); tickPetitions(g);
  assert.equal(petitionsOf(g).length, 0, 'cooldown');
  for (let d = 0; d < 7; d++) { day(g); tickPetitions(g); }
  assert.equal(petitionsOf(g).length, 1, 'asks again after the cooldown');
});

test('petitions: a blessing on the village answers its hunger, linked to the power; dismissing and expiry', () => {
  const g = newGame({ seed: 4242, sandbox: true });
  runDays(g, 1);
  const sid = g.s.playerSettlement;
  hungry(g, sid, 1);
  tickPetitions(g);
  const [p] = petitionsOf(g);
  const r = issueCommand(g, 'bless', { settlementId: sid });
  assert.ok(r.ok, r.reason || r.message);
  g.tick();
  assert.equal(petitionsOf(g).length, 0, 'answered');
  const closed = g.s.log.find((e) => e.kind === 'core:petition_closed');
  assert.match(closed.msg, /The gods answered .* prayer \(hunger\)/);
  const power = g.s.log.find((e) => e.kind === 'core:god_power');
  assert.deepEqual(power.sids, [sid], 'the power names the blessed village');
  assert.equal(closed.cause, power.id, 'caused by the power');
  assert.equal(closed.rel, p.ev, 'and tied to the prayer');
  assert.ok(chainOf(g, closed.id).back.some((x) => x.event.id === power.id));
  // Dismissed.
  g.s.petitions.cool = {};
  hungry(g, sid, 1);
  day(g); tickPetitions(g);
  const [q] = petitionsOf(g);
  assert.equal(dismissPetition(g, q.id).ok, true);
  assert.match(g.s.log.at(-1).msg, /turned away/);
  assert.equal(dismissPetition(g, q.id).ok, false);
  // Expired: unanswered for its days.
  g.s.petitions.cool = {};
  day(g); tickPetitions(g);
  for (let d = 0; d < 5; d++) { hungry(g, sid, 1); day(g); tickPetitions(g); }
  assert.ok(g.s.log.some((e) => /went unanswered/.test(e.msg)));
  assert.deepEqual(conservationErrors(g), [], 'nothing given for answers');
});

test('petitions: a monster near a village is a prayer that banishing answers', () => {
  const g = newGame({ seed: 4242, sandbox: true });
  runDays(g, 1);
  const sid = g.s.playerSettlement, c = g.s.settlements[sid].center;
  const sp = g.reg.all('monster')[0].id;
  const m = sendMonster(g, sp, c.x + 8, c.y);
  assert.equal(conditionOf(g, sid, 'core:monster').on, true);
  tickPetitions(g);
  const [p] = petitionsOf(g);
  assert.equal(p.kind, 'core:monster');
  const r = issueCommand(g, 'banish', { x: Math.round(m.x), y: Math.round(m.y), confirm: true });
  assert.ok(r.ok, r.reason || r.message);
  g.tick();
  assert.equal(petitionsOf(g).length, 0, 'answered by the banishing');
});

test('petitions: one open per village, a world cap by population, distant villages too; saves, loads, old saves', () => {
  const g = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast' });
  runDays(g, 2);
  const sids = Object.keys(g.s.settlements).sort();
  for (const sid of sids) hungry(g, sid, 1);
  tickPetitions(g);
  const people = Object.keys(g.s.colonists).length;
  const open = petitionsOf(g);
  assert.equal(open.length, Math.min(sids.length, Math.max(1, Math.floor(people / PETITION.perPeople))));
  assert.equal(new Set(open.map((p) => p.sid)).size, open.length, 'one per village');
  assert.ok(open.some((p) => g.s.settlements[p.sid].detail === 'abstract') || open.length < 2, 'distant villages pray as well');
  const r = reload(g);
  runDays(g, 1); runDays(r, 1);
  assert.equal(stateText(r), stateText(g));
  const old = JSON.parse(serializeGame(g));
  delete old.state.petitions;
  old.saveFormat = 34;
  assert.ok(loadGame(g.reg, JSON.stringify(old)));
  const bad = JSON.parse(serializeGame(g));
  bad.state.petitions = { next: 1, open: { p5: { id: 'p5' } } };
  assert.throws(() => loadGame(g.reg, JSON.stringify(bad)), /petition/);
});
