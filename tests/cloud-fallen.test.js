// Fallen villages and ruins (Phase 5, slice 6a): a village with nobody left falls at the next day start; its ruins
// stay, it drops out of trade, diplomacy, planning and the village count, its kingdom passes the crown on, and its
// land is released after RUIN.landDays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, conservationErrors, serializeGame, loadGame, TICKS_PER_DAY } from './cloud-helpers.js';
import { injure } from '../src/sim/health.js';
import { RUIN, isFallen, livingCount } from '../src/sim/fallen.js';
import { previewCommand, issueCommand } from '../src/sim/god.js';
import { foundDaughter } from '../src/sim/founding.js';
import { kingdomOf, membersOf } from '../src/sim/kingdoms.js';
import { landInfo } from '../src/sim/territory.js';

const wipeOut = (g, sid) => { for (const c of g.owned('colonists', sid)) { injure(g, c, 'wound', 100, 'Struck down'); injure(g, c, 'wound', 100, 'Struck down again'); } };
/** Until the next day start after everyone of `sid` died. */
function untilFallen(g, sid) {
  wipeOut(g, sid);
  for (let d = 0; d < 3 && !isFallen(g, sid); d++) g.step(TICKS_PER_DAY);
  assert.ok(isFallen(g, sid), 'the village fell');
}

test('a village with nobody left falls: the cause is logged, trades end, it stops planning and counting', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', size: 'medium', villages: 2 });
  runDays(g, 2);
  const sid = Object.keys(g.s.settlements).find((x) => g.s.settlements[x].ai);
  const n0 = livingCount(g);
  untilFallen(g, sid);
  const f = g.s.settlements[sid].fallen;
  assert.equal(f.fate, 'ruin');
  assert.match(f.cause, /everyone died of their wounds/);
  assert.ok(g.s.log.some((e) => /has fallen: everyone died of their wounds\. Its ruins remain\./.test(e.msg)));
  assert.equal(livingCount(g), n0 - 1);
  assert.ok(Object.values(g.s.trades || {}).every((t) => t.status !== 'active' || (t.seller !== sid && t.buyer !== sid)), 'no open trades with the ruin');
  assert.ok(Object.values(g.s.structures).some((b) => b.settlement === sid), 'its buildings remain as ruins');
  runDays(g, 2);
  assert.equal((g.plans?.[sid]?.projects || []).length || 0, 0, 'a ruin plans nothing');
  assert.deepEqual(conservationErrors(g), []);
});

test('the player\'s village never falls this way (it stays as an empty village)', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  wipeOut(g, g.s.playerSettlement);
  runDays(g, 2);
  assert.equal(g.owned('colonists', g.s.playerSettlement).length, 0);
  assert.equal(isFallen(g, g.s.playerSettlement), false);
});

test('god powers refuse a fallen village', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', size: 'medium', villages: 2, sandbox: true });
  runDays(g, 2);
  const sid = Object.keys(g.s.settlements).find((x) => g.s.settlements[x].ai);
  untilFallen(g, sid);
  const r = previewCommand(g, 'bless', { settlementId: sid });
  assert.equal(r.ok, false);
  assert.match(r.reason, /has fallen/);
});

// ---------------- on the vast world: land and kingdoms ----------------
let BASE = null;
function vast() {
  if (!BASE) { BASE = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast', sandbox: true }); runDays(BASE, 3); }
  return reload(BASE);
}
/** Settlers join `sid` by divine power, applied next tick. */
function join(g, sid, count) {
  const c = g.s.settlements[sid].center;
  for (let r = 0; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const a = { x: c.x + dx, y: c.y + dy, count, mode: 'join' };
    if (previewCommand(g, 'spawn', a).ok) { assert.equal(issueCommand(g, 'spawn', a).ok, true); g.tick(); return; }
  }
  assert.fail(`no spot to join ${sid}`);
}

test('a ruin\'s land is released after the waiting days; its buildings stay', () => {
  const g = vast();
  const sid = Object.keys(g.s.settlements).sort().find((x) => g.s.settlements[x].ai);
  assert.ok(landInfo(g, sid).area > 0);
  untilFallen(g, sid);
  assert.ok(landInfo(g, sid).area > 0, 'land kept at first');
  runDays(g, RUIN.landDays + 1);
  assert.ok(g.s.settlements[sid].fallen.released, 'released');
  assert.equal(landInfo(g, sid).area, 0, 'no land left');
  assert.ok(Object.values(g.s.structures).some((b) => b.settlement === sid), 'ruined buildings remain');
  const copy = reload(g); // a game saved right after the release grows its land on exactly like the original
  runDays(g, 3); runDays(copy, 3);
  assert.equal(stateText(copy), stateText(g));
});

test('a fallen capital passes its crown to the largest member left', () => {
  const g = vast();
  const cap = Object.keys(g.s.settlements).sort().find((x) => g.s.settlements[x].ai);
  join(g, cap, 2);
  assert.equal(foundDaughter(g, cap, { force: true }).ok, true);
  join(g, cap, 2);
  assert.equal(foundDaughter(g, cap, { force: true }).ok, true);
  const k = kingdomOf(g, cap);
  assert.ok(k && membersOf(g, k.id).length === 3, 'a kingdom of three');
  untilFallen(g, cap);
  const k2 = g.s.kingdoms[k.id];
  assert.ok(k2, 'the kingdom lives on');
  assert.notEqual(k2.capital, cap);
  assert.ok(!isFallen(g, k2.capital));
  assert.equal(kingdomOf(g, cap), null, 'the ruin is in no kingdom');
  assert.ok(g.s.log.some((e) => /is now the capital of/.test(e.msg)));
  assert.equal(stateText(reload(g)), stateText(g));
});

test('saves: a malformed fallen record is refused; a fall saved and loaded continues identically', () => {
  const run = (cut) => {
    let g = newGame({ seed: 7, scenario: 'core:neighbours', size: 'medium', villages: 2 });
    runDays(g, 2);
    wipeOut(g, Object.keys(g.s.settlements).find((x) => g.s.settlements[x].ai));
    for (let d = 1; d <= 3; d++) { g.step(TICKS_PER_DAY); if (cut.includes(d)) g = reload(g); }
    return g;
  };
  const a = run([]), b = run([1, 2]);
  assert.equal(stateText(a), stateText(b));
  const bad = JSON.parse(serializeGame(a));
  const sid = Object.keys(bad.state.settlements).find((x) => bad.state.settlements[x].fallen);
  bad.state.settlements[sid].fallen.fate = 'vanished';
  assert.throws(() => loadGame(a.reg, JSON.stringify(bad)), /fallen record/);
});

test('a falling village\'s wars end and attacks on it are called off; the player cannot deal with a ruin', async () => {
  const { declareWar, evaluateAttack } = await import('../src/sim/combat.js');
  const { relationOf, relationPeek, evaluateOffer } = await import('../src/sim/villages.js');
  const g = vast();
  const [a, b] = Object.keys(g.s.settlements).filter((x) => g.s.settlements[x].ai).sort();
  relationOf(g, a, b).contact = true;
  declareWar(g, a, b, 'Test war');
  untilFallen(g, b);
  assert.equal(relationPeek(g, a, b).aggressor, undefined, 'no war with a ruin');
  assert.notEqual(g.s.military?.[a]?.target, b, 'no attack on a ruin');
  const p = g.s.playerSettlement;
  relationOf(g, p, b).contact = true;
  assert.ok(evaluateOffer(g, b, { give: [], want: [] }).problems.some((x) => /has fallen/.test(x)));
  assert.equal(evaluateAttack(g, p, b).valid, false);
});
