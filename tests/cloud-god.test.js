// God powers (Phase 2c): validated, deterministic world commands, stored with their tick in the save and replayed
// identically after load; what they create goes through the ledger as "divine"; favour is charged on apply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, firstDifference, conservationErrors, TICKS_PER_DAY } from './cloud-helpers.js';
import { previewCommand, issueCommand, favourNow } from '../src/sim/god.js';
import { peopleCensus } from '../src/sim/godspawn.js';

const NEIGH = { seed: 7, scenario: 'core:neighbours', size: 'medium', villages: 2 };

/** The first tile (row by row, every 4 tiles) where settlers could found a village, or null. Read-only. */
function foundSite(g, count = 3) {
  for (let y = 8; y < g.H - 8; y += 4) for (let x = 8; x < g.W - 8; x += 4) {
    if (previewCommand(g, 'spawn', { x, y, count, mode: 'found' }).ok) return { x, y };
  }
  return null;
}

/** A tile on the player's own land, near its centre, where settlers may join. */
function joinSpot(g, count = 1) {
  const c = g.s.settlements[g.s.playerSettlement].center;
  for (let r = 0; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const a = { x: c.x + dx, y: c.y + dy, count, mode: 'join' };
    if (previewCommand(g, 'spawn', a).ok) return a;
  }
  return null;
}

/** A run with powers used on fixed days. `cut(day)` may replace the game (a save and load) after any day. */
function poweredRun(cut = null) {
  let g = newGame({ ...NEIGH, sandbox: true });
  const p = g.s.playerSettlement, ai = Object.keys(g.s.settlements).find((x) => x !== p);
  const plan = {
    1: (gm) => issueCommand(gm, 'omen', { text: 'a sign' }),
    2: (gm) => issueCommand(gm, 'bless', { settlementId: p }),
    3: (gm) => issueCommand(gm, 'inspire', { settlementId: ai }),
    4: (gm) => { const s = foundSite(gm); assert.ok(s, 'a site to found on'); return issueCommand(gm, 'spawn', { ...s, count: 3, mode: 'found', name: 'Godsend' }); },
    5: (gm) => { const a = joinSpot(gm, 2); assert.ok(a, 'a spot to join'); return issueCommand(gm, 'spawn', a); },
  };
  for (let d = 1; d <= 7; d++) {
    if (plan[d]) assert.equal(plan[d](g).ok, true, `the day-${d} command is accepted`);
    if (cut) g = cut(g, d, 'issued') || g; // a save while the command waits in the queue
    g.step(TICKS_PER_DAY);
    if (cut) g = cut(g, d, 'day') || g;
  }
  return g;
}

test('no power used: no god state is made, so ordinary games are untouched', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 1);
  assert.equal(g.s.god, undefined);
});

test('an omen is queued for the next tick, charged on apply and logged', () => {
  const g = newGame({ seed: 4242 });
  const f0 = favourNow(g);
  const res = issueCommand(g, 'omen', { text: 'hello' });
  assert.equal(res.ok, true);
  assert.equal(res.tick, g.s.tick + 1);
  assert.equal(g.s.god.queue.length, 1);
  g.tick();
  assert.equal(g.s.god.queue.length, 0);
  assert.equal(g.s.god.log.at(-1).result.ok, true);
  assert.equal(favourNow(g), f0 - 1);
  assert.ok(g.s.log.some((e) => e.msg.includes('hello')));
});

test('commands are validated: unknown powers, bad arguments and missing favour are refused with a reason', () => {
  const g = newGame({ seed: 4242 });
  assert.equal(issueCommand(g, 'nope', {}).ok, false);
  assert.match(issueCommand(g, 'omen', { colour: 'red' }).reason, /only text and settlementId/);
  assert.match(issueCommand(g, 'spawn', { x: 1, y: 1, count: 0, mode: 'found' }).reason, /from 1 to 10/);
  const p = g.s.playerSettlement;
  assert.equal(issueCommand(g, 'bless', { settlementId: p }).ok, true); // 25 of 30 favour
  const r = issueCommand(g, 'inspire', { settlementId: p }); // 30 more: too much with the blessing waiting
  assert.equal(r.ok, false);
  assert.match(r.reason, /not enough favour/);
  assert.equal(g.s.god.queue.length, 1, 'the refused command was not queued');
});

test('preview is read-only: it changes nothing and makes no god state', () => {
  const g = newGame({ seed: 4242 });
  const before = stateText(g);
  const pv = previewCommand(g, 'bless', { settlementId: g.s.playerSettlement });
  assert.equal(pv.ok, true);
  assert.match(pv.preview.effect, /blessed/);
  assert.equal(stateText(g), before);
});

test('spawning settlers: a divine village is founded and settlers join, all through the ledger', () => {
  const g = poweredRun();
  const sts = Object.values(g.s.settlements);
  const born = sts.find((x) => x.name === 'Godsend');
  assert.ok(born, 'the new village exists');
  assert.equal(born.origin, 'divine');
  assert.ok(g.s.god.log.every((e) => e.result.ok), JSON.stringify(g.s.god.log.filter((e) => !e.result.ok)));
  assert.equal(g.s.god.spawned, 5);
  const pc = peopleCensus(g);
  assert.equal(pc.ok, true, pc.problems.join('; '));
  assert.ok(g.s.ledger.byReason['created:divine'], 'supplies were created as divine');
  assert.deepEqual(conservationErrors(g), []);
});

test('two runs with the same commands are identical (replay)', () => {
  assert.equal(stateText(poweredRun()), stateText(poweredRun()));
});

test('saved with a command waiting, and after each day: the loaded game replays the commands identically', () => {
  const a = poweredRun();
  const b = poweredRun((g, d, when) => (when === 'issued' || d === 6 ? reload(g) : null));
  const ta = stateText(a), tb = stateText(b);
  assert.equal(firstDifference(ta, tb), null);
  assert.equal(ta, tb);
});
