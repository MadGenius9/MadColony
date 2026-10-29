// Civilization laws (docs/proposals/civilization-laws.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, serializeGame, loadGame, TICKS_PER_DAY } from './cloud-helpers.js';
import { civLawOf, civLawProblem, setCivLaw, codeOf, leaningsOf, optionMood } from '../src/sim/civlaws.js';
import { formKingdom } from '../src/sim/kingdoms.js';

test('civ laws: villages start with their people\'s leanings; the player starts with none; classic villages keep the defaults', () => {
  const g = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast' });
  assert.equal(g.s.settlements[g.s.playerSettlement].code, undefined);
  for (const [sid, st] of Object.entries(g.s.settlements)) {
    if (!st.ai) continue;
    for (const [law, option] of Object.entries(leaningsOf(g, sid))) assert.equal(civLawOf(g, sid, law), option, `${st.name} ${law}`);
  }
  const crag = Object.keys(g.s.settlements).find((k) => g.s.settlements[k].people === 'core:cragborn');
  assert.equal(civLawOf(g, crag, 'core:conscription'), 'militia');
  const classic = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  assert.ok(Object.values(classic.s.settlements).every((st) => !st.code), 'Hearthfolk lean to the defaults');
  assert.ok(optionMood(g, 'core:rationing', 'rationed') < 0, 'options carry a mood for the Mood phase');
});

test('civ laws: the player sets a law, waits 5 days to change it again, and the code saves, loads and mends', () => {
  const g = newGame({ seed: 3 });
  g.tick();
  const me = g.s.playerSettlement;
  assert.equal(setCivLaw(g, me, 'core:rationing', 'rationed', 'food is short').ok, true);
  assert.equal(civLawOf(g, me, 'core:rationing'), 'rationed');
  assert.match(g.s.log.at(-1).msg, /passed a law: Rationing, rationed \(food is short\)/);
  assert.match(civLawProblem(g, me, 'core:rationing', 'none'), /wait 5 more days/);
  assert.match(civLawProblem(g, me, 'core:rationing', 'rationed'), /already/);
  assert.match(civLawProblem(g, me, 'core:nope', 'x'), /no law/);
  assert.match(civLawProblem(g, me, 'core:rationing', 'loud'), /one of/);
  assert.deepEqual(codeOf(g, me).map((x) => x.id), ['core:rationing']);
  const b = reload(g);
  runDays(g, 1); runDays(b, 1);
  assert.equal(stateText(b), stateText(g));
  runDays(g, 5);
  assert.equal(setCivLaw(g, me, 'core:rationing', 'none').ok, true);
  assert.equal(g.s.settlements[me].code, undefined, 'back to the default: no code saved');
  const t = JSON.parse(serializeGame(g));
  t.state.settlements[me].code = { 'gone:law': 'x', 'core:hunting': 'banned' };
  assert.deepEqual(loadGame(g.reg, JSON.stringify(t)).s.settlements[me].code, { 'core:hunting': 'banned' }, 'a removed mod\'s law is dropped');
  t.state.settlements[me].codeSince = { 'core:hunting': t.state.tick + 5 };
  assert.throws(() => loadGame(g.reg, JSON.stringify(t)), /law dates/);
});

test('civ laws: a kingdom\'s capital sets its kingdom laws for every member; members keep their own other laws', () => {
  const g = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast' });
  const [cap, mem] = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
  formKingdom(g, cap, mem);
  setCivLaw(g, cap, 'core:borders', 'closed', 'a test', { force: true });
  assert.equal(civLawOf(g, mem, 'core:borders'), 'closed', 'the member follows the capital');
  assert.match(civLawProblem(g, mem, 'core:borders', 'open'), /set by/);
  assert.equal(setCivLaw(g, mem, 'core:rationing', 'rationed', '', { force: true }).ok, true, 'its own laws stay its own');
  assert.ok(codeOf(g, mem).some((x) => x.id === 'core:borders' && x.byKingdom === cap));
});

// ---- slice 2: daily life
import { mayDoWork } from '../src/sim/people.js';
import { NEED_BEHAVIORS, decayNeed } from '../src/sim/ai/needs.js';
import { workSpeed } from '../src/sim/ai/jobs.js';
import { RATION } from '../src/sim/civlaws.js';

const atHour = (g, h) => { while (Math.floor(g.hour) !== h) g.tick(); };

test('civ laws: a curfew stops outdoor work at night; long hours keep people up later', () => {
  const g = newGame({ seed: 4242 });
  const me = g.s.playerSettlement, c = g.colonists()[0];
  setCivLaw(g, me, 'core:work_hours', 'curfew', '', { force: true });
  atHour(g, 23);
  assert.equal(mayDoWork(g, c, 'core:chop'), false, 'no felling at night');
  assert.equal(mayDoWork(g, c, 'core:craft'), true, 'indoor work goes on');
  atHour(g, 10);
  assert.equal(mayDoWork(g, c, 'core:chop'), true, 'by day as usual');
  const energy = g.reg.all('need').find((n) => n.behavior === 'core:sleep');
  atHour(g, 23);
  c.needs[energy.id] = 0.5;
  assert.equal(NEED_BEHAVIORS['core:sleep'].wants(g, c, energy), true, 'normally a 0.5-energy person goes to bed at night');
  setCivLaw(g, me, 'core:work_hours', 'long', '', { force: true });
  assert.equal(NEED_BEHAVIORS['core:sleep'].wants(g, c, energy), false, 'under long hours they stay up');
  c.needs[energy.id] = 0.3;
  assert.equal(NEED_BEHAVIORS['core:sleep'].wants(g, c, energy), true, 'until they are tired');
  const b = reload(g);
  runDays(g, 1); runDays(b, 1);
  assert.equal(stateText(b), stateText(g));
});

test('civ laws: rationing slows hunger and work; schooling laws decide what children do', () => {
  const g = newGame({ seed: 4242 });
  const me = g.s.playerSettlement, c = g.colonists()[0];
  const hunger = g.reg.all('need').find((n) => n.behavior === 'core:eat');
  const drop = () => { const x = { ...c, needs: { ...c.needs, [hunger.id]: 1 }, sleeping: false, job: null }; for (let i = 0; i < 100; i++) decayNeed(x, hunger, g); return 1 - x.needs[hunger.id]; };
  const d0 = drop(), w0 = workSpeed(g, c, 'core:chop', 'core:woodcutting');
  setCivLaw(g, me, 'core:rationing', 'rationed', '', { force: true });
  assert.ok(Math.abs(drop() / d0 - RATION.hunger) < 1e-9);
  assert.ok(Math.abs(workSpeed(g, c, 'core:chop', 'core:woodcutting') / w0 - RATION.work) < 1e-9);
  // A child.
  const kid = g.colonists()[1];
  kid.stage = g.reg.all('lifeStage').find((s) => s.attendsSchool).id;
  atHour(g, 10);
  assert.equal(mayDoWork(g, kid, 'core:forage'), true, 'free: children forage in school hours too');
  assert.equal(mayDoWork(g, kid, 'core:haul'), false);
  setCivLaw(g, me, 'core:schooling', 'compulsory', '', { force: true });
  assert.equal(mayDoWork(g, kid, 'core:forage'), false, 'compulsory: not in school hours');
  assert.equal(mayDoWork(g, kid, 'core:study'), true);
  atHour(g, 17);
  assert.equal(mayDoWork(g, kid, 'core:forage'), true, 'after school');
  setCivLaw(g, me, 'core:schooling', 'child_labour', '', { force: true });
  assert.equal(mayDoWork(g, kid, 'core:haul'), true, 'child labour: hauling');
  assert.equal(mayDoWork(g, kid, 'core:farm'), true);
  assert.equal(mayDoWork(g, kid, 'core:mine'), false, 'not everything');
});

test('civ laws: distant villages under laws play, save and load the same', () => {
  const g = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast' });
  runDays(g, 1); // detail is settled in the first ticks
  const far = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].detail === 'abstract');
  assert.ok(far.length > 0);
  far.forEach((sid, i) => { setCivLaw(g, sid, 'core:rationing', 'rationed', '', { force: true }); setCivLaw(g, sid, 'core:work_hours', i % 2 ? 'long' : 'curfew', '', { force: true }); });
  runDays(g, 2);
  const b = reload(g);
  runDays(g, 2); runDays(b, 2);
  assert.equal(stateText(b), stateText(g));
});

// ---- slice 3: land and arms
import { huntAllowed, treeProtected, PROTECT_R } from '../src/sim/civlaws.js';
import { warStrength } from '../src/sim/war.js';

const sixDays = (law) => {
  const g = newGame({ seed: 4242 });
  const me = g.s.playerSettlement;
  if (law) setCivLaw(g, me, law[0], law[1], '', { force: true });
  runDays(g, 6);
  return { g, me };
};

test('civ laws: banned hunting stops the hunt (with the reason); restricted hunts only when food runs low', () => {
  const { g, me } = sixDays(['core:hunting', 'banned']);
  assert.equal(Object.keys(g.s.ledger?.byReason?.['created:hunt'] || {}).length, 0, 'nothing hunted');
  assert.equal(g.plans[me].huntNote, 'Hunting is banned by law');
  const free = sixDays(null);
  assert.ok(Object.keys(free.g.s.ledger?.byReason?.['created:hunt'] || {}).length > 0, 'without the law the village hunts');
  setCivLaw(g, me, 'core:hunting', 'restricted', '', { force: true });
  assert.equal(huntAllowed(g, me, 10), false);
  assert.equal(huntAllowed(g, me, 2), true);
});

test('civ laws: protected forests keep grown trees near the village; a militia arms everyone and counts in war', () => {
  const near = ({ g, me }) => { const c = g.s.settlements[me].center; return Object.values(g.s.nodes).filter((n) => !n.young && g.nodeDef(n)?.workType === 'core:chop' && (n.x - c.x) ** 2 + (n.y - c.y) ** 2 <= PROTECT_R * PROTECT_R).length; };
  const prot = sixDays(['core:forests', 'protected']), free = sixDays(null);
  assert.ok(near(prot) > near(free), `more grown trees within ${PROTECT_R} tiles (${near(prot)} against ${near(free)})`);
  const sapling = Object.values(prot.g.s.nodes).find((n) => n.young);
  if (sapling) assert.equal(treeProtected(prot.g, prot.me, sapling), false, 'saplings are not counted as grown');
  const mil = sixDays(['core:conscription', 'militia']);
  assert.ok(mil.g.colonists().filter((c) => c.equip.weapon).length > free.g.colonists().filter((c) => c.equip.weapon).length, 'more people armed');
  // A distant militia counts its fit adults as spearmen.
  const w = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast' });
  runDays(w, 1);
  const far = Object.keys(w.s.settlements).find((k) => w.s.settlements[k].detail === 'abstract' && !w.s.settlements[k].code);
  const before = warStrength(w, far);
  setCivLaw(w, far, 'core:conscription', 'militia', '', { force: true });
  assert.ok(warStrength(w, far) > before, `${before} -> ${warStrength(w, far)}`);
});

// ---- slice 4: outside
import { bordersClosed } from '../src/sim/civlaws.js';
import { willTrade, evaluateOffer, relationOf, seizeChance } from '../src/sim/villages.js';
import { conservationErrors } from './cloud-helpers.js';

test('civ laws: closed borders stop trade and traders outside the kingdom; members still trade', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  const me = g.s.playerSettlement, [a, b] = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
  for (const [x, y] of [[me, a], [me, b], [a, b]]) relationOf(g, x, y).contact = true;
  assert.equal(willTrade(g, a, b), true);
  setCivLaw(g, a, 'core:borders', 'closed', '', { force: true });
  assert.equal(bordersClosed(g, a, b), true);
  assert.equal(willTrade(g, a, b), false);
  assert.equal(willTrade(g, b, a), false, 'either side closed is enough');
  assert.ok(evaluateOffer(g, a, { give: [{ item: 'core:wood', qty: 5 }], want: [] }).problems.some((p) => /Closed borders: .* does not trade outside its kingdom/.test(p)));
  formKingdom(g, a, b);
  assert.equal(bordersClosed(g, a, b), false, 'one kingdom: open to each other');
});

test('civ laws: the tithe sends a tenth of a member\'s spare goods to the capital, every item counted', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  const [cap, mem] = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
  relationOf(g, cap, mem).contact = true;
  formKingdom(g, cap, mem);
  setCivLaw(g, cap, 'core:tithe', 'tithe', '', { force: true });
  runDays(g, 12);
  const tithes = Object.values(g.s.trades || {}).filter((t) => t.tithe);
  assert.ok(tithes.length > 0 || g.s.log.some((e) => /sends its tithe/.test(e.msg)), 'a tithe went out');
  assert.ok(tithes.every((t) => t.seller === mem && t.buyer === cap && t.gift));
  assert.deepEqual(conservationErrors(g), []);
  const b2 = reload(g);
  runDays(g, 1); runDays(b2, 1);
  assert.equal(stateText(b2), stateText(g));
});

test('civ laws: harsh justice doubles seizures, lenient halves them', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  const me = g.s.playerSettlement, a = Object.keys(g.s.settlements).find((k) => g.s.settlements[k].ai);
  const usual = seizeChance(g, a, me);
  setCivLaw(g, a, 'core:justice', 'harsh', '', { force: true });
  assert.ok(Math.abs(seizeChance(g, a, me) - Math.min(0.9, usual * 2)) < 1e-9);
  g.s.tick += 6 * TICKS_PER_DAY;
  setCivLaw(g, a, 'core:justice', 'lenient');
  assert.ok(Math.abs(seizeChance(g, a, me) - usual * 0.5) < 1e-9);
});

// ---- slice 5: the AI
import { tickCivLaws, REVIEW_DAYS, DRIFT } from '../src/sim/civreview.js';
import { declareWar } from '../src/sim/combat.js';
import { relationPeek } from '../src/sim/villages.js';

/** Run the daily law pass on each of the next `days` days (time moved on by hand). */
const reviewDays = (g, days) => { for (let d = 0; d < days; d++) { g.s.tick += TICKS_PER_DAY; tickCivLaws(g); } };

test('civ laws: AI villages raise a militia at war and stand it down after; they ration when food is short', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  const me = g.s.playerSettlement, [a, b] = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
  for (const [x, y] of [[me, a], [a, b]]) relationOf(g, x, y).contact = true;
  relationOf(g, a, b).value = 0;
  declareWar(g, a, b, 'A test war');
  reviewDays(g, REVIEW_DAYS);
  assert.equal(civLawOf(g, a, 'core:conscription'), 'militia');
  assert.ok(g.s.log.some((e) => /passed a law: Conscription, militia \(it is at war\)/.test(e.msg)));
  assert.equal(civLawOf(g, me, 'core:conscription'), 'none', 'the player\'s village is never changed');
  relationOf(g, a, b).value = 10; // peace again
  delete relationOf(g, a, b).aggressor;
  reviewDays(g, REVIEW_DAYS);
  assert.equal(civLawOf(g, a, 'core:conscription'), 'none', 'stood down');
  g.plans[a].foodDays = 1;
  reviewDays(g, REVIEW_DAYS);
  assert.equal(civLawOf(g, a, 'core:rationing'), 'rationed');
  g.plans[a].foodDays = 3;
  reviewDays(g, REVIEW_DAYS);
  assert.equal(civLawOf(g, a, 'core:rationing'), 'rationed', 'kept until food is plentiful (5 days)');
  g.plans[a].foodDays = 8;
  reviewDays(g, REVIEW_DAYS);
  assert.equal(civLawOf(g, a, 'core:rationing'), 'none');
});

test('civ laws: similar laws bring villages together and differing ones push them apart; no laws, no drift', () => {
  const g = newGame({ seed: 7, scenario: 'core:neighbours', villages: 2 });
  const [a, b] = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
  relationOf(g, a, b).contact = true;
  relationOf(g, a, b).value = 0;
  reviewDays(g, 3);
  assert.equal(relationPeek(g, a, b).value, 0, 'no laws: no drift');
  setCivLaw(g, a, 'core:hunting', 'banned', '', { force: true });
  setCivLaw(g, b, 'core:hunting', 'banned', '', { force: true });
  setCivLaw(g, a, 'core:forests', 'protected', '', { force: true });
  setCivLaw(g, b, 'core:forests', 'protected', '', { force: true });
  const v0 = relationPeek(g, a, b).value;
  g.s.tick += TICKS_PER_DAY; tickCivLaws(g);
  assert.ok(Math.abs(relationPeek(g, a, b).value - v0 - 2 * DRIFT) < 1e-9, 'two laws alike');
  setCivLaw(g, b, 'core:borders', 'closed', '', { force: true });
  setCivLaw(g, a, 'core:justice', 'harsh', '', { force: true });
  const v1 = relationPeek(g, a, b).value;
  g.s.tick += TICKS_PER_DAY; tickCivLaws(g);
  assert.ok(Math.abs(relationPeek(g, a, b).value - v1) < 1e-9, 'two alike, two apart: no change');
});

test('civ laws: a Vast world with reviews on plays, saves and loads the same', () => {
  const g = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast' });
  runDays(g, 12);
  const b = reload(g);
  runDays(g, 2); runDays(b, 2);
  assert.equal(stateText(b), stateText(g));
});
