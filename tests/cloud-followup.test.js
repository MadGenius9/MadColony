// Phase 14: intervention follow-through (docs/proposals/phase-14-follow-through.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame } from './cloud-helpers.js';
import { issueCommand } from '../src/sim/god.js';
import { outcomeCards, villagesOf, FOLLOW } from '../src/sim/followup.js';
import { tickPetitions, petitionsOf } from '../src/sim/petitions.js';
import { chainOf, notifies } from '../src/sim/chronicle.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

test('follow-through: a blessing gets an outcome card 3 days later, linked to the power and the prayer it answered', () => {
  const g = newGame({ seed: 4242, sandbox: true });
  runDays(g, 1);
  const sid = g.s.playerSettlement;
  (g.plans[sid] ||= {}).foodDays = 1;
  tickPetitions(g);
  const [p] = petitionsOf(g);
  assert.ok(issueCommand(g, 'bless', { settlementId: sid }).ok);
  g.tick();
  assert.equal(g.s.followUps.wait.length, 1);
  const w = g.s.followUps.wait[0];
  assert.deepEqual(w.sids, [sid]);
  assert.equal(w.before[sid].food, 1, 'measured before the power acted');
  assert.deepEqual(w.petitions, [p.id]);
  // Saved while waiting.
  const r = reload(g);
  runDays(g, FOLLOW.days + 1); runDays(r, FOLLOW.days + 1);
  assert.equal(stateText(r), stateText(g));
  const [card] = outcomeCards(g);
  assert.ok(card, 'a card');
  assert.equal(card.type, 'bless');
  assert.match(card.effect, /^Blessed /, 'the recorded result');
  assert.ok(card.changes[sid].after.people >= 0);
  const e = g.s.log.find((x) => x.id === card.ev);
  assert.match(e.msg, /days after the bless power: .*food 1 → .* days.*\(Changes that followed; the game does not know how much the power caused\.\)/);
  const power = g.s.log.find((x) => x.kind === 'core:god_power');
  assert.equal(e.cause, power.id);
  assert.ok(chainOf(g, e.id).back.some((x) => x.event.id === power.id));
  assert.equal(notifies(g, e), true);
  assert.equal(g.s.followUps.wait.length, 0);
});

test('follow-through: a power touching no village gets no card; villages near a point are found; old and bad saves', () => {
  const g = newGame({ seed: 4242, sandbox: true });
  runDays(g, 1);
  const sid = g.s.playerSettlement, c = g.s.settlements[sid].center;
  assert.deepEqual(villagesOf(g, { args: { x: c.x + 5, y: c.y } }), [sid]);
  assert.deepEqual(villagesOf(g, { args: { x: c.x + 60, y: c.y + 60 } }), []);
  assert.ok(issueCommand(g, 'rain', { x: Math.min(g.W - 1, c.x + 60), y: Math.min(g.H - 1, c.y + 60) }).ok);
  g.tick();
  assert.equal(g.s.followUps, undefined, 'nothing to follow');
  assert.ok(issueCommand(g, 'rain', { x: c.x, y: c.y }).ok);
  g.tick();
  assert.equal(g.s.followUps.wait.length, 1);
  const old = JSON.parse(serializeGame(g));
  delete old.state.followUps;
  old.saveFormat = 35;
  assert.ok(loadGame(g.reg, JSON.stringify(old)));
  const bad = JSON.parse(serializeGame(g));
  bad.state.followUps.wait[0].sids = 'x';
  assert.throws(() => loadGame(g.reg, JSON.stringify(bad)), /followUps/);
  assert.ok(TICKS_PER_DAY > 0);
});
