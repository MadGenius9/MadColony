// Phase 10, slice 1: partnerships (docs/proposals/phase-10-leftovers.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame } from './cloud-helpers.js';
import { tickPartners, partnerOf, closeKin, PARTNER } from '../src/sim/family.js';
import { killColonist } from '../src/sim/death.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

const pairs = (g) => Object.values(g.s.colonists).filter((c) => c.partner && partnerOf(g, c));

test('partners: adults pair up over the days, both ways, never with close family, within their village', () => {
  const g = newGame({ seed: 5, scenario: 'core:living_world' });
  runDays(g, 20);
  const p = pairs(g);
  assert.ok(p.length >= 6, `some couples (${p.length / 2})`);
  for (const c of p) {
    const o = partnerOf(g, c);
    assert.equal(o.partner, c.id, 'both ways');
    assert.equal(o.settlementId || g.s.playerSettlement, c.settlementId || g.s.playerSettlement, 'same village');
    assert.ok(!closeKin(c, o), 'not close family');
  }
  assert.ok(g.s.log.some((e) => e.kind === 'core:partners') || p.length > 0);
});

test('partners: siblings, parents and children never pair; a partner\'s death ends it and brings grief', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  const [a, b, c, d] = Object.values(g.s.colonists);
  for (const x of [a, b, c, d]) delete x.partner;
  b.parents = ['cP']; c.parents = ['cP']; // b and c are siblings
  assert.ok(closeKin(b, c) && !closeKin(a, b));
  d.parents = [a.id];
  assert.ok(closeKin(a, d), 'a parent and child');
  for (let day = 0; day < 400 && !(b.partner && c.partner); day++) { g.s.tick += TICKS_PER_DAY; tickPartners(g); }
  assert.ok(b.partner !== c.id, 'siblings never pair');
  assert.ok(!(a.partner === d.id), 'a parent never pairs with a child');
  const x = pairs(g)[0];
  assert.ok(x, 'someone paired in time');
  const y = partnerOf(g, x);
  if (y.homeId) y.homeId = y.homeId === x.homeId ? null : y.homeId; // grief from the partnership itself, not a shared home
  killColonist(g, x, 'test');
  assert.equal(g.s.dead[x.id].partner, y.id, 'the dead keep their partner');
  assert.ok(y.grief?.for === x.name, 'the partner grieves');
  tickPartners(g);
  assert.notEqual(y.partner, x.id, 'the living one is free again (and may pair anew)');
});

test('partners: saved and loaded identically; old saves load unpartnered; a bad partner field is refused', () => {
  const g = newGame({ seed: 5, scenario: 'core:living_world' });
  runDays(g, 12);
  assert.ok(pairs(g).length > 0);
  const r = reload(g);
  assert.equal(stateText(r), stateText(g));
  runDays(g, 1); runDays(r, 1);
  assert.equal(stateText(r), stateText(g));
  const old = JSON.parse(serializeGame(newGame({ seed: 4242 })));
  old.saveFormat = 42;
  assert.ok(Object.values(loadGame(g.reg, JSON.stringify(old)).s.colonists).every((c) => !c.partner));
  const bad = JSON.parse(serializeGame(g));
  Object.values(bad.state.colonists)[0].partner = 7;
  assert.throws(() => loadGame(g.reg, JSON.stringify(bad)), /invalid partner/);
});

test('partners: a couple sharing a home are named as the parents of a child born there', () => {
  const g = newGame({ seed: 5, scenario: 'core:living_world' });
  let child = null;
  for (let d = 0; d < 60 && !child; d++) {
    runDays(g, 1);
    child = Object.values(g.s.colonists).find((c) => c.parents?.length === 2 && c.bornTick > 0 && g.s.colonists[c.parents[0]]?.partner === c.parents[1]);
  }
  assert.ok(child, 'a child of a couple');
  assert.ok(PARTNER.chance > 0);
});
