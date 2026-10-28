// Peoples and traits, slice 1: the records (docs/proposals/phase-peoples-and-traits.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame } from './cloud-helpers.js';
import { modsOf, inheritTraits, drawTraits, defaultPeople, MAX_TRAITS } from '../src/sim/peoples.js';
import { peopleCensus } from '../src/sim/godspawn.js';
import { issueCommand, previewCommand } from '../src/sim/god.js';
import { foundDaughter } from '../src/sim/founding.js';

/** No colonist has more than two traits, a trait twice or a trait with its opposite. */
function traitsOk(g, c) {
  const t = c.traits || [];
  if (t.length > MAX_TRAITS || new Set(t).size !== t.length) return false;
  return !t.some((a) => t.includes(g.reg.get('trait', a)?.opposite));
}

test('peoples: classic colonists are Hearthfolk with up to two fitting traits, the same every time, kept by a save', () => {
  const g = newGame({ seed: 3 });
  assert.equal(defaultPeople(g), 'core:hearthfolk');
  assert.equal(g.s.settlements.t1.people, 'core:hearthfolk');
  const cols = Object.values(g.s.colonists);
  assert.ok(cols.every((c) => c.people === 'core:hearthfolk' && traitsOk(g, c)));
  const again = newGame({ seed: 3 });
  assert.deepEqual(Object.values(again.s.colonists).map((c) => c.traits), cols.map((c) => c.traits), 'traits come from hashes');
  // Many seeds: every trait turns up, and some people have none.
  const seen = new Set();
  let none = 0;
  for (let seed = 1; seed <= 12; seed++) for (const c of Object.values(newGame({ seed }).s.colonists)) { c.traits.forEach((t) => seen.add(t)); if (!c.traits.length) none++; }
  assert.equal(seen.size, g.reg.all('trait').length, `every trait drawn (${[...seen].join(', ')})`);
  assert.ok(none > 0);
  runDays(g, 1);
  const b = reload(g);
  runDays(g, 1); runDays(b, 1);
  assert.equal(stateText(b), stateText(g));
  assert.ok(peopleCensus(g, 5).ok, JSON.stringify(peopleCensus(g, 5).problems));
});

test('peoples: an old save (format 29) gets the default people and the same traits a new game gives; unknown ones are mended', () => {
  const g = newGame({ seed: 5 });
  runDays(g, 1);
  const t = JSON.parse(serializeGame(g));
  for (const c of Object.values(t.state.colonists)) { delete c.people; delete c.traits; }
  for (const s of Object.values(t.state.settlements)) delete s.people;
  t.format = 29;
  const b = loadGame(g.reg, JSON.stringify(t));
  assert.equal(b.s.settlements.t1.people, 'core:hearthfolk');
  assert.deepEqual(Object.values(b.s.colonists).map((c) => [c.people, c.traits]), Object.values(g.s.colonists).map((c) => [c.people, c.traits]));
  runDays(g, 1); runDays(b, 1);
  assert.deepEqual(JSON.parse(stateText(b)).state, JSON.parse(stateText(g)).state, 'the old save plays on as the new one (fields filled on load come last, so compare parsed)');
  // A people or trait from a mod that is gone.
  const u = JSON.parse(serializeGame(g));
  const [c1, c2] = Object.values(u.state.colonists);
  c1.people = 'gone:folk'; c2.traits = ['gone:trait', ...c2.traits.slice(0, 1)];
  const m = loadGame(g.reg, JSON.stringify(u));
  assert.equal(m.s.colonists[c1.id].people, 'core:hearthfolk');
  assert.ok(m.s.colonists[c2.id].traits.every((x) => g.reg.get('trait', x)));
  // Invalid records are refused.
  const v = JSON.parse(serializeGame(g));
  Object.values(v.state.colonists)[0].traits = ['core:wise', 'core:quick', 'core:kind'];
  assert.throws(() => loadGame(g.reg, JSON.stringify(v)), /traits/);
});

test('peoples: effects combine (people times traits); inheritance keeps to two fitting traits and is deterministic', () => {
  const g = newGame({ seed: 1 });
  const c = { id: 'x1', people: 'core:cragborn', traits: ['core:strong', 'core:hardy'] };
  const m = modsOf(g, c);
  assert.ok(Math.abs(m.workBy['core:mining'] - 1.15 * 1.1) < 1e-9);
  assert.ok(Math.abs(m.workBy['core:farming'] - 0.9) < 1e-9);
  assert.equal(m.cold, 8);
  assert.equal(m.illnessStrength, 0.6);
  assert.equal(m.needs['core:hunger'], 1.2);
  assert.equal(modsOf(g, c), m, 'cached');
  c.traits = ['core:timid'];
  assert.equal(modsOf(g, c).fightHp, 101, 'a new traits array is seen');
  assert.equal(modsOf(g, { id: 'x2' }).work, 1, 'no people: no effects');
  const pa = { traits: ['core:brave', 'core:wise'] }, pb = { traits: ['core:timid', 'core:diligent'] };
  let inheritedAny = false;
  for (let i = 0; i < 200; i++) {
    const t = inheritTraits(g, `7:k${i}`, [pa, pb], 'core:hearthfolk');
    assert.deepEqual(t, inheritTraits(g, `7:k${i}`, [pa, pb], 'core:hearthfolk'));
    assert.ok(traitsOk(g, { traits: t }), t.join(','));
    if (t.some((x) => [...pa.traits, ...pb.traits].includes(x))) inheritedAny = true;
  }
  assert.ok(inheritedAny);
  assert.ok(drawTraits(g, 'k', 'core:reedkin').length <= 2);
});

test('peoples: AI villages, daughters and divine settlers are of their village\'s people; children too', () => {
  const g = newGame({ seed: 11, scenario: 'core:living_world' });
  const sids = Object.keys(g.s.settlements);
  assert.ok(sids.length > 2);
  assert.ok(sids.every((k) => g.reg.get('people', g.s.settlements[k].people)));
  runDays(g, 12);
  const pc = peopleCensus(g);
  assert.ok(pc.ok, JSON.stringify(pc.problems));
  assert.ok(Object.values(g.s.colonists).every((c) => traitsOk(g, c)));
  const kids = Object.values(g.s.colonists).filter((c) => c.bornTick !== undefined);
  for (const k of kids) assert.equal(k.people, g.s.settlements[k.settlementId].people);
  // Divine settlers (a Living world in Sandbox: room to found near the landing spot).
  const s = newGame({ seed: 2, scenario: 'core:living_world', sandbox: true });
  let spot = null;
  for (let r = 0; r < 120 && !spot; r += 2) for (let dy = -r; dy <= r && !spot; dy += 2) for (let dx = -r; dx <= r && !spot; dx += 2) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const a = { x: s.s.center.x + dx, y: s.s.center.y + dy, count: 3, mode: 'found' };
    if (s.inB(a.x, a.y) && previewCommand(s, 'spawn', a).ok) spot = a;
  }
  assert.ok(spot, 'a spot for divine settlers');
  issueCommand(s, 'spawn', spot); s.tick();
  const nv = Object.keys(s.s.settlements).find((k) => s.s.settlements[k].origin === 'divine');
  assert.ok(s.owned('colonists', nv).every((c) => c.people === s.s.settlements[nv].people && traitsOk(s, c)));
});

test('peoples: a village of another people keeps it in its daughters; a stray people or clashing traits are mended on load', () => {
  const g = newGame({ seed: 11, scenario: 'core:living_world' });
  const ai = Object.keys(g.s.settlements).find((k) => g.s.settlements[k].ai);
  g.s.settlements[ai].people = 'core:reedkin';
  for (const c of g.owned('colonists', ai)) c.people = 'core:reedkin';
  assert.ok(peopleCensus(g).ok, JSON.stringify(peopleCensus(g).problems));
  const res = foundDaughter(g, ai, { force: true });
  assert.equal(res.ok, true, res.msg);
  assert.equal(g.s.settlements[res.child].people, 'core:reedkin');
  assert.ok(res.founders.every((id) => g.s.colonists[id].people === 'core:reedkin'));
  // Someone of another people in it: the census says so, and a load mends it.
  const [one, two] = Object.values(g.s.colonists).filter((c) => c.people === 'core:reedkin');
  one.people = 'core:cragborn';
  assert.match(peopleCensus(g).problems.join(' '), /another people/);
  two.traits = ['core:brave', 'core:timid'];
  const b = loadGame(g.reg, serializeGame(g));
  assert.equal(b.s.colonists[one.id].people, 'core:reedkin');
  assert.deepEqual(b.s.colonists[two.id].traits, ['core:brave']);
  assert.ok(peopleCensus(b).ok, JSON.stringify(peopleCensus(b).problems));
});
