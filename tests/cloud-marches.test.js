// Marches and thirst (Phase 16 balance, 2026-11-06): AI villages march only on villages within COMBAT.raidReach,
// and fighters drink and eat before they set off. On planet-sized worlds AI fighters marched 200+ tiles, ran dry on
// the way and whole villages died of thirst (docs/proposals/phase-16-balance-notes.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from './cloud-helpers.js';
import { COMBAT, tickMilitary, combatDecision, withinRaidReach, isEnemy } from '../src/sim/combat.js';
import { relationOf } from '../src/sim/villages.js';

/** The classic neighbours game with its AI village hostile to the player (no war rules: hostile is war) and armed. */
function hostile() {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', size: 'medium', villages: 2 });
  const p = g.s.playerSettlement, a = Object.keys(g.s.settlements).find((x) => g.s.settlements[x].ai);
  relationOf(g, a, p).contact = true;
  relationOf(g, a, p).value = -60;
  for (const c of g.owned('colonists', a)) c.equip.weapon = { item: 'core:spear', dur: 100 };
  assert.ok(isEnemy(g, a, p));
  return { g, p, a };
}

test('an AI village raids an enemy within reach, but not one too far to march on', () => {
  const near = hostile();
  assert.ok(withinRaidReach(near.g, near.a, near.p), 'the neighbours are close');
  tickMilitary(near.g);
  assert.equal(near.g.s.military?.[near.a]?.order, 'attack');

  const far = hostile();
  const c = far.g.s.settlements[far.p].center;
  far.g.s.settlements[far.a].center = { x: c.x + COMBAT.raidReach + 5, y: c.y }; // (only the reach check reads it here)
  assert.equal(withinRaidReach(far.g, far.a, far.p), false);
  tickMilitary(far.g);
  assert.notEqual(far.g.s.military?.[far.a]?.order, 'attack', 'too far: it stays home');
});

test('fighters drink and eat before they march off', () => {
  const { g, p, a } = hostile();
  (g.s.military ||= {})[a] = { order: 'attack', target: p, since: g.s.tick };
  const c = g.owned('colonists', a).find((x) => x.equip.weapon);
  const drink = g.reg.all('need').find((d) => d.behavior === 'core:drink');
  c.job = null;
  // combatDecision looks every COMBAT.scanEvery ticks, offset by the colonist's id: pick such a tick.
  while ((g.s.tick + c.id.length * 3) % COMBAT.scanEvery) g.s.tick++;
  for (const d of g.reg.all('need')) c.needs[d.id] = 1;
  const march = combatDecision(g, c);
  assert.equal(march?.type, 'fight', 'watered and fed: they march');
  c.needs[drink.id] = drink.seekBelow / 2;
  assert.equal(combatDecision(g, c), null, 'thirsty: they drink first');
});

test('the attack plan warns of a long march', async () => {
  const { evaluateAttack } = await import('../src/sim/combat.js');
  const { g, p, a } = hostile();
  assert.ok(!evaluateAttack(g, p, a).risks.some((r) => r.includes('long march')), 'neighbours: no warning');
  const c = g.s.settlements[p].center;
  g.s.settlements[a].center = { x: c.x + COMBAT.raidReach + 5, y: c.y };
  assert.ok(evaluateAttack(g, p, a).risks.some((r) => r.includes('long march')));
});

test('people of a village simulated at a distance are not fought one by one', async () => {
  const { nearestEnemy, COMBAT_DRIVERS } = await import('../src/sim/combat.js');
  const { g, p, a } = hostile();
  const mine = g.owned('colonists', p)[0], theirs = g.owned('colonists', a)[0];
  theirs.x = mine.x + 1; theirs.y = mine.y; // right beside
  assert.equal(nearestEnemy(g, mine, 5)?.id, theirs.id, 'in full detail: an enemy');
  g.s.settlements[a].detail = 'abstract';
  assert.equal(nearestEnemy(g, mine, 5), null, 'summed up hourly at a distance: not fought');
  // A fight already under way with such a person ends (saves made before the change).
  const job = { type: 'fight', targetId: theirs.id, stage: 'fight', res: [] };
  assert.equal(COMBAT_DRIVERS.fight.tick(g, mine, job), 'done');
});
