// Phase 10, slice 4: the selling policy for controlled goods (docs/proposals/phase-10-leftovers.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame, conservationErrors } from './cloud-helpers.js';
import { setSellPolicy, sellPolicyOf, sellOutlook, tickSelling, SELL } from '../src/sim/selling.js';
import { makeContact, ENFORCE } from '../src/sim/villages.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

const ITEM = 'core:pistol_rounds';
/** Two neighbours, met, where pistol rounds are banned, and 40 pistol rounds in the player's stock (created in the ledger). */
function setup() {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  runDays(g, 2);
  const me = g.s.playerSettlement, ais = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
  for (const a of ais) { makeContact(g, me, a, 'test', null); g.s.settlements[a].laws[ITEM] = 'banned'; } // banned unless a test says otherwise
  const c = g.s.settlements[me].center;
  g.ledgerAdd('created', ITEM, 40, 'test');
  g.placeItems(ITEM, 40, c.x, c.y);
  while (Math.floor(g.s.tick / TICKS_PER_DAY) % SELL.everyDays) g.step(TICKS_PER_DAY); // a selling day
  return { g, me, ais };
}

test('selling: off unless chosen; the outlook shows each village\'s law, price, attention and seizure chance', () => {
  const { g, ais } = setup();
  assert.equal(sellPolicyOf(g).mode, 'off');
  assert.equal(tickSelling(g), null, 'off: nothing is sold');
  const o = sellOutlook(g, ITEM);
  assert.deepEqual(o.map((x) => x.sid), ais);
  assert.ok(o.every((x) => x.law === 'banned' && x.price === ENFORCE.blackMarketPrice && x.seize > 0), 'banned: the black-market price, and a chance of seizure');
  assert.equal(setSellPolicy(g, 'sometimes').ok, false);
});

test('selling: lawful never smuggles; a restricted market buys at most its cap; black markets only with "any"', () => {
  const { g, ais } = setup();
  setSellPolicy(g, 'lawful', 5);
  assert.equal(tickSelling(g), null, 'every market bans it: the lawful policy sells nothing');
  g.s.settlements[ais[1]].laws[ITEM] = 'restricted';
  const id = tickSelling(g);
  assert.ok(id, 'sold where it is restricted');
  const t = g.s.trades[id], leg = t.legs.find((l) => l.item === ITEM);
  assert.equal(leg.to, ais[1]);
  assert.ok(leg.qty <= ENFORCE.restrictedCap, 'no more than the restricted cap');
  assert.ok(t.legs.some((l) => l.to === g.s.playerSettlement && l.qty > 0), 'paid in goods');
  assert.match(t.reason, /selling policy \(lawful only\)/);
  const { g: g2 } = setup();
  setSellPolicy(g2, 'any', 0);
  const id2 = tickSelling(g2);
  assert.ok(id2, 'black markets with "any"');
  assert.match(g2.s.trades[id2].reason, /black markets too/);
  assert.deepEqual(conservationErrors(g2), []);
});

test('selling: the policy is saved; keep is respected; a bad policy in a save is refused; old saves have none', () => {
  const { g } = setup();
  setSellPolicy(g, 'any', 40);
  assert.equal(tickSelling(g), null, 'all 40 kept');
  const r = reload(g);
  assert.equal(stateText(r), stateText(g));
  assert.deepEqual(sellPolicyOf(r), { mode: 'any', keep: 40 });
  const bad = JSON.parse(serializeGame(g));
  bad.state.settlements[g.s.playerSettlement].sellPolicy.mode = 'always';
  assert.throws(() => loadGame(g.reg, JSON.stringify(bad)), /invalid selling policy/);
  setSellPolicy(g, 'off');
  assert.equal(g.s.settlements[g.s.playerSettlement].sellPolicy, undefined, 'off leaves no field');
  const old = JSON.parse(serializeGame(newGame({ seed: 4242 })));
  old.saveFormat = 43;
  assert.equal(sellPolicyOf(loadGame(g.reg, JSON.stringify(old))).mode, 'off');
});
