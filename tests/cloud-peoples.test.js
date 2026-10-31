// Peoples and traits, slice 1: the records (docs/proposals/phase-peoples-and-traits.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame } from './cloud-helpers.js';
import { modsOf, inheritTraits, drawTraits, defaultPeople, MAX_TRAITS } from '../src/sim/peoples.js';
import { peopleCensus } from '../src/sim/godspawn.js';
import { issueCommand, previewCommand } from '../src/sim/god.js';
import { foundDaughter } from '../src/sim/founding.js';
import { workSpeed, practice } from '../src/sim/ai/jobs.js';
import { decayNeed } from '../src/sim/ai/needs.js';
import { coldUnder } from '../src/sim/life.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';
import { fitHpOf, fightersOf } from '../src/sim/combat.js';
import { wolfDanger } from '../src/sim/hunt.js';
import { greedOf, evaluateOffer } from '../src/sim/villages.js';
import { findFood } from '../src/sim/ai/needs.js';
import { endJob } from '../src/sim/ai/ai.js';
import { tickRivalry } from '../src/sim/war.js';
import { relationOf } from '../src/sim/villages.js';
import { readAllMods } from '../tools/fsmods.js';
import { buildRegistry } from '../src/sim/content/modloader.js';
import { makeLook, inheritLook, SKIN, HAIR } from '../src/sim/appearance.js';
import { namePoolOf } from '../src/sim/names.js';
import { foundVillage } from '../src/sim/villages.js';
import { Rng } from '../src/sim/rng.js';
import { candidateTemplates } from '../src/sim/civic/sites.js';
import { chooseSlot } from '../src/sim/construction.js';
import { requiredTechs } from '../src/sim/research.js';
import { peopleByLand } from '../src/sim/peoples.js';

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

// ---- slice 2: effects

/** A copy of colonist c with another people and traits (a twin for comparisons). */
const twin = (c, people, traits) => ({ ...JSON.parse(JSON.stringify(c)), people, traits });

test('peoples: work, learning, walking, tending and need decay follow people and traits', () => {
  const g = newGame({ seed: 4 });
  const base = twin(Object.values(g.s.colonists)[0], 'core:hearthfolk', []);
  base.equip = { tool: null, weapon: null };
  const ws = (c, wt, sk) => workSpeed(g, c, wt, sk);
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(near(ws(twin(base, 'core:hearthfolk', ['core:strong']), 'core:chop', 'core:woodcutting') / ws(base, 'core:chop', 'core:woodcutting'), 1.1), 'strong');
  assert.ok(near(ws(twin(base, 'core:cragborn', []), 'core:mine', 'core:mining') / ws(base, 'core:mine', 'core:mining'), 1.15), 'Cragborn miners');
  assert.ok(near(ws(twin(base, 'core:reedkin', ['core:lazy']), 'core:mine', 'core:mining') / ws(base, 'core:mine', 'core:mining'), 0.8 * 0.9), 'Reedkin, lazy');
  assert.ok(near(ws(twin(base, 'core:hearthfolk', ['core:kind']), 'core:doctor', 'core:medicine') / ws(base, 'core:doctor', 'core:medicine'), 1.3), 'kind doctors');
  // Learning.
  const w = twin(base, 'core:hearthfolk', ['core:wise']), p = twin(base, 'core:hearthfolk', []);
  w.xp = {}; p.xp = {};
  for (let i = 0; i < 10; i++) { practice(g, w, 'core:chop', 'core:woodcutting'); practice(g, p, 'core:chop', 'core:woodcutting'); }
  assert.ok(near(w.xp['core:woodcutting'], 1.5 * p.xp['core:woodcutting']), 'wise');
  // Need decay (thirst: Duneshade 0.6, Reedkin 1.3).
  const thirst = g.reg.get('need', 'core:thirst');
  const drop = (c) => { const x = twin(c, c.people, c.traits); x.sleeping = false; x.job = null; x.needs['core:thirst'] = 1; for (let i = 0; i < 100; i++) decayNeed(x, thirst, g); return 1 - x.needs['core:thirst']; };
  assert.ok(near(drop(twin(base, 'core:duneshade', [])) / drop(base), 0.6));
  assert.ok(near(drop(twin(base, 'core:reedkin', [])) / drop(base), 1.3));
  // Walking: a quick Duneshade steps in 1/(1.1 x 1.1) the ticks (rounded per step).
  const q = g.s.colonists[base.id];
  q.people = 'core:duneshade'; q.traits = ['core:quick'];
  let ticks = 0, steps = 0;
  for (let t = 0; t < 400; t++) { g.tick(); if (q.mv && q.mv.t === 0) { ticks += q.mv.dur; steps++; } }
  if (steps) assert.ok(ticks / steps < 4 * 1.2 / 1.15, `steps take ${ticks / steps} ticks`);
});

test('peoples: the cold sets in later for the Cragborn and hardy, sooner for the Duneshade', () => {
  const g = newGame({ seed: 6, scenario: 'core:living_world' });
  g.s.tick = Math.round(22.5 * TICKS_PER_DAY); // midwinter (a 30-day year, coldest on day 22.5)
  g._outT = null;
  const c0 = twin(Object.values(g.s.colonists)[0], 'core:hearthfolk', []);
  c0.homeId = null; c0.sleeping = true;
  const base = coldUnder(g, c0);
  assert.ok(base > 0, `midwinter is cold out (${base})`);
  assert.equal(coldUnder(g, twin(c0, 'core:duneshade', [])), base + 4);
  assert.equal(coldUnder(g, twin(c0, 'core:cragborn', ['core:hardy'])), Math.max(0, base - 8));
});

test('peoples: a Vast world with every people mixed in plays, saves and loads the same, everyone counted', () => {
  const g = newGame({ seed: 9, scenario: 'core:vast_world', size: 'vast' });
  const folk = ['core:hearthfolk', 'core:reedkin', 'core:cragborn', 'core:duneshade'];
  Object.keys(g.s.settlements).forEach((sid, i) => {
    g.s.settlements[sid].people = folk[i % 4];
    for (const c of g.owned('colonists', sid)) c.people = folk[i % 4];
  });
  runDays(g, 4);
  const b = reload(g);
  runDays(g, 2); runDays(b, 2);
  assert.equal(stateText(b), stateText(g));
  const pc = peopleCensus(g);
  assert.ok(pc.ok, JSON.stringify(pc.problems));
  assert.equal(Object.keys(pc.byPeople).length, 4, JSON.stringify(pc.byPeople));
});

// ---- slice 3: courage, greed, favourite food, feuds between peoples
/** A classic game with one hungry wolf pack near the village (as tests/cloud-animals.test.js). */
function wolfGame() {
  const g = newGame({ seed: 4242 });
  g.tick();
  const c = g.s.settlements[g.s.playerSettlement].center, A = g.s.animals;
  for (const id of Object.keys(A.herds)) delete A.herds[id];
  const day = Math.floor(g.s.tick / 2400);
  A.herds.h901 = { id: 'h901', sp: 'core:wolf', x: c.x - 18, y: c.y + 6, n: 4, day, year: 0, next: g.s.tick, fed: day - 1 };
  A.next = 902; g._anIdx = null;
  while (g.s.tick % 600 !== 451) g.tick();
  return g;
}
const hurt = (c, hp) => { c.health = { injuries: hp < 100 ? [{ id: `t${c.id}`, kind: 'bruise', severity: 100 - hp, cause: 'test', tick: 0 }] : [] }; };
/** wolfDanger for c on the next tick that checks c (staggered every 5 ticks), without running the game. */
function danger(g, c) {
  const t0 = g.s.tick;
  try { for (let k = 0; k < 5; k++) { g.s.tick = t0 + k; const j = wolfDanger(g, c); if (j) return j; } return null; } finally { g.s.tick = t0; }
}

test('peoples: brave people fight and stand against wolves while hurt; timid ones flee and never count as fighters', () => {
  const g = wolfGame();
  const w = Object.values(g.s.animals.list)[0], [a, b, c] = g.colonists();
  for (const p of [a, b, c]) {
    g.createItems('core:spear', 1, Math.round(p.x), Math.round(p.y), 'start');
    const st = Object.values(g.s.stacks).find((x) => x.item === 'core:spear');
    const t = g.takeFromStack(st.id, 1);
    p.equip.weapon = { item: t.item, dur: 1500 };
    p.x = w.x + 3; p.y = w.y; p.mv = null; p.path = null; if (p.job) endJob(g, p, null, 'test');
  }
  a.traits = ['core:brave']; b.traits = []; c.traits = ['core:timid'];
  assert.equal(fitHpOf(g, a), 30); assert.equal(fitHpOf(g, b), 50); assert.ok(fitHpOf(g, c) > 100);
  hurt(a, 35); hurt(b, 35); hurt(c, 100);
  assert.equal(danger(g, a)?.type, 'fend', 'brave: stands against the wolf at 35% health');
  assert.equal(danger(g, b)?.type, 'flee', 'others run when hurt');
  const tj = danger(g, c);
  assert.equal(tj?.type, 'flee', 'timid: runs even when well and armed');
  assert.match(JSON.stringify(tj), /Timid: running from wolves/);
  const sid = g.s.playerSettlement;
  hurt(a, 100); hurt(b, 100);
  const f = fightersOf(g, sid).map((x) => x.id);
  assert.ok(f.includes(a.id) && f.includes(b.id) && !f.includes(c.id), 'timid people are not fighters');
});

test('peoples: greedy adults raise a village\'s price; people eat their favourite food first', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  const ai = Object.keys(g.s.settlements).find((k) => g.s.settlements[k].ai);
  for (const c of g.owned('colonists', ai)) c.traits = [];
  relationOf(g, g.s.playerSettlement, ai).contact = true; // they have met
  assert.equal(greedOf(g, ai), 0);
  const offer = { give: [{ item: 'core:wood', qty: 20 }], want: [{ item: 'core:potato', qty: 10 }] };
  const plain = evaluateOffer(g, ai, offer);
  const [x, y] = g.owned('colonists', ai);
  x.traits = ['core:greedy']; y.traits = ['core:greedy'];
  assert.equal(greedOf(g, ai), 0.06);
  const greedy = evaluateOffer(g, ai, offer);
  assert.ok(greedy.lines.some((l) => /Greedy folk there: they ask 6% more/.test(l)), greedy.lines.join(' | '));
  const want = (r) => Number(/want at least (\d+)/.exec(r.verdict)?.[1]);
  if (want(plain)) assert.ok(want(greedy) > want(plain), `${plain.verdict} / ${greedy.verdict}`);
  for (const c of g.owned('colonists', ai)) c.traits = ['core:greedy'];
  assert.ok(greedOf(g, ai) <= 0.15);
  // Favourite food: with beans and potatoes the same distance away and no meals, Reedkin take beans.
  const h = newGame({ seed: 7 });
  for (const st of Object.values(h.s.stacks)) if (h.reg.get('item', st.item)?.nutrition) delete h.s.stacks[st.id];
  h._stackIdx = null;
  const c = h.colonists()[0];
  h.createItems('core:bean', 10, c.x + 3, c.y, 'start');
  h.createItems('core:potato', 10, c.x - 3, c.y, 'start');
  c.people = 'core:reedkin';
  assert.equal(findFood(h, c)?.item, 'core:bean');
});

test('peoples: rivalry grows faster between villages of different peoples', () => {
  const mods = readAllMods();
  mods.find((m) => m.manifest.id === 'core').files['content/setup.json'].scenario.find((x) => x.id === 'core:neighbours').war = { rivalry: { perDay: 1, floor: -70, near: 500, nearPerDay: 0.6 }, declareBelow: -50, stronger: 1.5, minStrength: 0.5, warnDays: 1 };
  const REG = buildRegistry(mods, ['core']).registry;
  const drop = (other) => {
    const g = newGame({ seed: 7, registry: REG, scenario: 'core:neighbours', size: 'medium', villages: 2 });
    const [x, y] = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
    const r = relationOf(g, x, y);
    r.contact = true;
    if (other) { g.s.settlements[y].people = 'core:reedkin'; for (const c of g.owned('colonists', y)) c.people = 'core:reedkin'; }
    const before = r.value;
    tickRivalry(g);
    return { d: before - relationOf(g, x, y).value, why: r.history?.at(-1)?.reason || '' };
  };
  const same = drop(false), other = drop(true);
  assert.ok(same.d > 0, `rivalry between neighbours (${same.d})`);
  // Reedkin temperament 1, Hearthfolk 1: only the 1.5 for different peoples changes the fall.
  assert.ok(Math.abs(other.d - 1.5 * same.d) < 0.02, `${other.d} against ${same.d}`);
});

// ---- slice 4: names and looks
test('peoples: Hearthfolk look as before; other peoples have their own names and palette; children take after their parents', () => {
  const g = newGame({ seed: 8, scenario: 'core:neighbours', size: 'large', villages: 1 });
  assert.deepEqual(makeLook('7:3'), makeLook('7:3', null), 'no palette: today\'s look, drawn as before');
  assert.ok(SKIN.includes(makeLook('k').skin) && HAIR.includes(makeLook('k').hair));
  const pal = g.reg.get('people', 'core:cragborn').look;
  for (let i = 0; i < 30; i++) {
    const l = makeLook(`c${i}`, pal);
    assert.ok(pal.skin.includes(l.skin) && pal.hair.includes(l.hair) && pal.styles.includes(l.style));
    assert.ok(l.height >= pal.height[0] && l.height <= pal.height[1]);
  }
  assert.equal(namePoolOf(g, 'X', 'core:hearthfolk').names, namePoolOf(g, 'X').names, 'Hearthfolk: the scenario\'s names');
  assert.ok(namePoolOf(g, 'X', 'core:cragborn').names.includes('Haska'));
  // A child's skin and hair come from a parent; height lies near theirs.
  const a = makeLook('pa', pal), b = makeLook('pb', pal);
  for (let i = 0; i < 20; i++) {
    const k = inheritLook(`kid${i}`, a, b, pal);
    assert.ok([a.skin, b.skin].includes(k.skin) && [a.hair, b.hair].includes(k.hair));
    assert.ok(Math.abs(k.height - (a.height + b.height) / 2) <= 0.021);
    assert.deepEqual(k, inheritLook(`kid${i}`, a, b, pal));
  }
  // An AI village of a profile naming the Cragborn: its people, names and palette.
  const prof = { ...g.reg.all('villageProfile')[0], people: 'core:cragborn' };
  const used = new Set(Object.values(g.s.colonists).map((c) => c.name));
  const sid = foundVillage(g, prof, new Rng({ s: 5 }), used);
  assert.ok(sid, 'a site for the village');
  assert.equal(g.s.settlements[sid].people, 'core:cragborn');
  const pool = namePoolOf(g, 'X', 'core:cragborn');
  for (const c of g.owned('colonists', sid)) {
    assert.equal(c.people, 'core:cragborn');
    assert.ok(pool.names.includes(c.name.split(' ')[0]), c.name);
    assert.ok(pal.skin.includes(c.look.skin));
  }
  assert.ok(peopleCensus(g).ok, JSON.stringify(peopleCensus(g).problems));
});

// ---- slice 5: home styles, stone walls, peoples by land
test('peoples: each people builds its own home style; Cragborn build stone walls once they can', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', size: 'large', villages: 2 });
  const sid = g.s.playerSettlement;
  const pick = (folk, need) => { g.s.settlements[sid].people = folk; return candidateTemplates(g, sid, { kind: 'home', need }, () => true, () => 0).map((t) => t.id); };
  assert.deepEqual(pick('core:hearthfolk', 3), ['core:longhouse'], 'Hearthfolk: as before');
  assert.deepEqual(pick('core:reedkin', 3), ['core:reed_house']);
  assert.deepEqual(pick('core:cragborn', 3), ['core:roundhouse']);
  assert.deepEqual(pick('core:duneshade', 5), ['core:courtyard_house']);
  assert.deepEqual(pick('core:cragborn', 1), ['core:cabin_single'], 'a single bed: the plain cabin');
  // Walls: wood until stone walls are researched, then stone when the stone is there.
  g.s.settlements[sid].people = 'core:cragborn';
  const pool = { 'core:wood': 300, 'core:stone': 300 };
  assert.equal(chooseSlot(g, 'core:wall', pool, sid, 20)?.id, 'core:wood_wall', 'not yet researched');
  g.s.settlements[sid].research.done.push(...requiredTechs(g, 'building', 'core:stone_wall'));
  assert.equal(chooseSlot(g, 'core:wall', pool, sid, 20)?.id, 'core:stone_wall');
  assert.equal(chooseSlot(g, 'core:wall', { 'core:wood': 300, 'core:stone': 10 }, sid, 20)?.id, 'core:wood_wall', 'not enough stone: wood');
  g.s.settlements[sid].people = 'core:hearthfolk';
  assert.notEqual(chooseSlot(g, 'core:wall', pool, sid, 20), undefined);
  // Built and finished: a Cragborn village raises a roundhouse that counts as a home.
  const g2 = newGame({ seed: 7, scenario: 'core:neighbours', size: 'large', villages: 2 });
  const ai = Object.keys(g2.s.settlements).find((k) => g2.s.settlements[k].ai);
  g2.s.settlements[ai].people = 'core:cragborn';
  for (const c of g2.owned('colonists', ai)) c.people = 'core:cragborn';
  runDays(g2, 8);
  assert.ok(Object.values(g2.s.homes).some((h) => h.name === 'Stone roundhouse' && h.complete), JSON.stringify(Object.values(g2.s.homes).map((h) => [h.name, h.complete])));
  assert.ok(peopleCensus(g2).ok);
});

test('peoples: Living and Vast worlds give AI villages the people of their land; the player stays Hearthfolk', () => {
  const g = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast' });
  const seen = new Set(Object.values(g.s.settlements).map((s) => s.people));
  assert.equal(g.s.settlements[g.s.playerSettlement].people, 'core:hearthfolk');
  assert.ok(seen.size >= 2, [...seen].join(', '));
  for (const st of Object.values(g.s.settlements)) if (st.ai) assert.equal(st.people, peopleByLand(g, st.center.x, st.center.y, 10, 0.1));
  assert.ok(peopleCensus(g).ok);
  const again = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast' });
  assert.deepEqual(Object.values(again.s.settlements).map((s) => s.people), Object.values(g.s.settlements).map((s) => s.people));
  // Classic neighbours: no rule, every village Hearthfolk.
  const n = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  assert.ok(Object.values(n.s.settlements).every((s) => s.people === 'core:hearthfolk'));
});

// ---- slice 6: god powers
/** The first spot (rings round `from`, every other tile) where `count` settlers may found a village. */
function foundSpotNear(g, from, count = 3, extra = {}) {
  for (let r = 0; r < 120; r += 2) for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const a = { x: from.x + dx, y: from.y + dy, count, mode: 'found', ...extra };
    if (g.inB(a.x, a.y) && previewCommand(g, 'spawn', a).ok) return a;
  }
  return null;
}

test('peoples: the gods found a village of a chosen people; settlers never join a village of another people', () => {
  const g = newGame({ seed: 2, scenario: 'core:living_world', sandbox: true });
  const a = foundSpotNear(g, g.s.center, 3, { people: 'core:duneshade' });
  assert.ok(a, 'a spot');
  const p = previewCommand(g, 'spawn', a);
  assert.match(p.preview.effect, /3 Duneshade settlers found/);
  assert.equal(p.preview.village.people, 'core:duneshade');
  issueCommand(g, 'spawn', a); g.tick();
  const sid = Object.keys(g.s.settlements).find((k) => g.s.settlements[k].origin === 'divine');
  assert.equal(g.s.settlements[sid].people, 'core:duneshade');
  assert.ok(g.owned('colonists', sid).every((c) => c.people === 'core:duneshade'));
  assert.equal(previewCommand(g, 'spawn', { ...a, people: 'gone:folk' }).ok, false);
  // Join: their own people only.
  const c = g.s.settlements[sid].center;
  const join = { x: c.x, y: c.y - 3, count: 1, mode: 'join' };
  const other = previewCommand(g, 'spawn', { ...join, people: 'core:cragborn' });
  assert.equal(other.ok, false);
  assert.match(other.reason, /Cragborn will not settle among the Duneshade/);
  const own = previewCommand(g, 'spawn', join);
  if (own.ok) { issueCommand(g, 'spawn', join); g.tick(); assert.ok(g.owned('colonists', sid).every((x) => x.people === 'core:duneshade')); }
  else assert.doesNotMatch(own.reason, /will not settle/);
  assert.ok(peopleCensus(g, null).ok, JSON.stringify(peopleCensus(g).problems));
  const b = reload(g);
  runDays(g, 1); runDays(b, 1);
  assert.equal(stateText(b), stateText(g));
});

test('peoples: the trait power gives a trait (replacing its opposite), takes one away and refuses what cannot be', () => {
  const g = newGame({ seed: 3, sandbox: true });
  const [c, d] = Object.values(g.s.colonists);
  c.traits = ['core:timid']; d.traits = ['core:wise', 'core:quick'];
  const give = (who, trait) => previewCommand(g, 'trait', { colonistId: who.id, trait, mode: 'give' });
  assert.equal(give(c, 'core:brave').preview.replaced, 'core:timid');
  assert.match(give(d, 'core:kind').reason, /already has 2 traits/);
  assert.match(give(d, 'core:wise').reason, /wise already/);
  assert.match(previewCommand(g, 'trait', { colonistId: c.id, trait: 'core:wise', mode: 'remove' }).reason, /not wise/);
  assert.match(previewCommand(g, 'trait', { colonistId: 'c999999', trait: 'core:wise', mode: 'give' }).reason, /no such person/);
  assert.match(previewCommand(g, 'trait', { colonistId: c.id, trait: 'core:wise', mode: 'give', extra: 1 }).reason, /takes only/);
  const s = newGame({ seed: 3, sandbox: true });
  const sc = Object.values(s.s.colonists)[0];
  sc.traits = ['core:timid'];
  issueCommand(s, 'trait', { colonistId: sc.id, trait: 'core:brave', mode: 'give' }); s.tick();
  assert.deepEqual(s.s.colonists[sc.id].traits, ['core:brave']);
  assert.equal(modsOf(s, s.s.colonists[sc.id]).fightHp, 30, 'the effect follows at once');
  issueCommand(s, 'trait', { colonistId: sc.id, trait: 'core:brave', mode: 'remove' }); s.tick();
  assert.deepEqual(s.s.colonists[sc.id].traits, []);
  const b = reload(s);
  runDays(s, 1); runDays(b, 1);
  assert.equal(stateText(b), stateText(s));
});
