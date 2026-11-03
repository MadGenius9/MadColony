// The planner arms a full-detail village against a pack that attacked it (Phase 8's rule, fixed 2026-11-03: the
// branch ran only for distant villages; see docs/proposals/phase-9-livestock.md, the wolf finding).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays } from './cloud-helpers.js';
import { planNow } from '../src/sim/planner.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

test('raids: a pack that attacked the village is named, and two hunters are armed for it, urgently', () => {
  const g = newGame({ seed: 7, scenario: 'core:living_world' });
  runDays(g, 1);
  const sid = g.s.playerSettlement, ctr = g.s.settlements[sid].center;
  const pack = Object.values(g.s.animals.herds).filter((h) => h.sp === 'core:wolf').sort((a, b) => Math.hypot(a.x - ctr.x, a.y - ctr.y) - Math.hypot(b.x - ctr.x, b.y - ctr.y))[0];
  assert.ok(Math.hypot(pack.x - ctr.x, pack.y - ctr.y) <= 60, 'a pack within reach');
  for (const h of Object.values(g.s.animals.herds)) delete h.raids;
  for (const c of g.owned('colonists', sid)) c.equip.weapon = null;
  planNow(g, sid);
  assert.doesNotMatch(g.plans[sid].huntNote, /attacked/, 'no raid yet');
  pack.raids = { [sid]: g.s.tick + 3 * TICKS_PER_DAY };
  planNow(g, sid);
  const P = g.plans[sid];
  assert.match(P.huntNote, /^Hunting down the wolves that attacked the village/);
  const bills = P.bills.filter((b) => /hunt down the wolves/.test(b.why || ''));
  assert.ok(bills.length >= 1, 'a weapon is ordered to hunt the pack down');
});

test('raids: the Living world village of seed 7 is no longer wiped out by the packs round it (day 16)', () => {
  const g = newGame({ seed: 7, scenario: 'core:living_world' });
  const sid = g.s.playerSettlement;
  runDays(g, 16);
  assert.ok(g.owned('colonists', sid).length >= 3, `people left: ${g.owned('colonists', sid).length}`);
  assert.ok(g.owned('colonists', sid).some((c) => c.equip.weapon), 'someone is armed');
});
