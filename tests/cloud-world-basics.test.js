// Founding, kingdoms, contact and territory basics on the vast world (Phase 2 slices 2–3, Phase 2b slices 4–6).
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, conservationErrors, reload, stateText } from './cloud-helpers.js';
import { canFound, foundDaughter, chooseFounders } from '../src/sim/founding.js';
import { kingdomOf, membersOf } from '../src/sim/kingdoms.js';
import { bordersTouched, metPairs } from '../src/sim/contact.js';
import { landInfo, claimOkOrganic } from '../src/sim/territory.js';
import { relationOf } from '../src/sim/villages.js';
import { previewCommand, issueCommand } from '../src/sim/god.js';

const NONE = 0xffff;
let g, parent, first, second;

before(() => {
  g = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast' });
  runDays(g, 6);
  // On day 6 most villages have 3 people of one family, who stay together. The parent is the first village (the
  // player's first, then by id) with a family free to leave (not holding the village's only physician or teacher);
  // which homes people share depends on the run (Phase 8: hunting changed the timing). canFound is still checked
  // on an AI village below.
  const order = [g.s.playerSettlement, ...Object.keys(g.s.settlements).sort().filter((k) => k !== g.s.playerSettlement)];
  parent = order.find((sid) => chooseFounders(g, sid, 2).length > 0);
  assert.ok(parent, 'some village can send settlers on day 6');
});

/** Settlers join `sid` by divine power (adults without family, so they may leave again), applied next tick. */
function addSettlers(sid, count) {
  const c = g.s.settlements[sid].center;
  for (let r = 0; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const a = { x: c.x + dx, y: c.y + dy, count, mode: 'join' };
    if (previewCommand(g, 'spawn', a).ok) { assert.equal(issueCommand(g, 'spawn', a).ok, true); g.tick(); return; }
  }
  assert.fail(`no spot to join ${sid}`);
}

// ---------------- founding and kingdoms ----------------
test('founding is refused early with a readable reason (villages are not crowded on day 6)', () => {
  const ai = Object.keys(g.s.settlements).sort().find((sid) => g.s.settlements[sid].ai);
  const ev = canFound(g, ai);
  assert.equal(ev.ok, false);
  assert.ok(ev.reason.length > 10, ev.reason);
  assert.match(ev.problems.join(' '), /not crowded/);
});

test('a forced founding makes a daughter: founders move, relations +60, supplies go as a gift', () => {
  const pop0 = g.owned('colonists', parent).length;
  const res = foundDaughter(g, parent, { force: true });
  assert.equal(res.ok, true, res.msg);
  first = res.child;
  const d = g.s.settlements[first];
  assert.equal(d.parent, parent);
  assert.equal(d.ai, true, 'a daughter is always run by the AI, even the player\'s');
  assert.ok(res.founders.length >= 1);
  for (const id of res.founders) assert.equal(g.s.colonists[id].settlementId, first);
  assert.equal(g.owned('colonists', parent).length, pop0 - res.founders.length);
  const rel = relationOf(g, parent, first);
  assert.equal(rel.contact, true);
  assert.equal(rel.value, 60);
  assert.ok(Object.values(g.s.trades).some((t) => t.founding && t.seller === parent && t.buyer === first), 'a supplies trade');
  assert.deepEqual(conservationErrors(g), []);
});

test('the first daughter forms a kingdom with the parent as capital; a second daughter joins it', () => {
  const k = kingdomOf(g, parent);
  assert.ok(k, 'the parent is in a kingdom');
  assert.equal(kingdomOf(g, first)?.id, k.id);
  assert.equal(k.capital, parent);
  addSettlers(parent, 2); // the first founding took everyone who could leave
  const res = foundDaughter(g, parent, { force: true });
  assert.equal(res.ok, true, res.msg);
  second = res.child;
  assert.equal(kingdomOf(g, second)?.id, k.id);
  assert.equal(membersOf(g, k.id).length, 3);
});

test('a new village has land at once and keeps growing', () => {
  const a0 = landInfo(g, first).area;
  assert.ok(a0 > 0, 'land on founding');
  runDays(g, 2);
  assert.ok(landInfo(g, first).area > a0, 'more land two days later');
  assert.deepEqual(conservationErrors(g), []);
});

// ---------------- territory ----------------
test('claims: one owner per tile, never on open water, and the areas add up', () => {
  const C = g._cl, ids = g.s.claims.ids, count = new Map();
  for (let i = 0; i < C.grid.length; i++) {
    const k = C.grid[i];
    if (k === NONE) continue;
    count.set(k, (count.get(k) || 0) + 1);
    const t = g.terrainAt(i % g.W, Math.floor(i / g.W));
    assert.ok(t.id !== 'core:water' && t.id !== 'core:deep_water', `tile ${i} is claimed on ${t.id}`);
  }
  for (const [k, n] of count) assert.equal(landInfo(g, ids[k]).area, n, `${ids[k]} area`);
});

test('building rights: a village may build on its own land, never on another village\'s', () => {
  const p = g.s.settlements[parent].center;
  assert.equal(claimOkOrganic(g, parent, p.x, p.y), true);
  const other = Object.keys(g.s.settlements).find((x) => x !== parent && x !== first && x !== second);
  assert.equal(claimOkOrganic(g, other, p.x, p.y), false);
});

// ---------------- contact ----------------
test('contact: every met pair records how it met (explorers, founding, borders...)', () => {
  const m = metPairs(g);
  assert.ok(m.byCause.founding >= 2, `founding contacts: ${m.byCause.founding}`);
  assert.equal(m.byCause.unknown, 0);
  for (const rel of Object.values(g.s.relations)) if (rel.contact && g.s.settlements[rel.a] && g.s.settlements[rel.b]) assert.ok(rel.met?.reason, `${rel.a}-${rel.b} has a first-contact record`);
});

test('touching borders make contact once, with the cause "Their lands touch"', () => {
  const ids = Object.keys(g.s.settlements).sort();
  let pair = null;
  for (let i = 0; i < ids.length && !pair; i++) for (let j = i + 1; j < ids.length; j++) if (!relationOf(g, ids[i], ids[j]).contact) { pair = [ids[i], ids[j]]; break; }
  assert.ok(pair, 'two villages that have not met');
  const before = g.s.contact.met.borders;
  bordersTouched(g, [pair]);
  bordersTouched(g, [pair]);
  assert.equal(g.s.contact.met.borders, before + 1, 'counted once');
  assert.equal(relationOf(g, pair[0], pair[1]).met.reason, 'Their lands touch');
});

test('after all of this the world still saves and loads to the same state', () => {
  assert.equal(stateText(reload(g)), stateText(g));
});

test('classic games have no contact, claims or founding state', () => {
  const c = newGame({ seed: 4242 });
  assert.equal(c.s.contact, undefined);
  assert.equal(c.s.claims, undefined);
  assert.equal(canFound(c, c.s.playerSettlement).ok, false);
});
