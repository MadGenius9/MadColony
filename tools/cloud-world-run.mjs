// A long world run for the Phase 5 acceptance (cloud copy; Phase 8 adds herd numbers, hunting and the meat share of raw food; Peoples and traits adds people and standing villages by people). Prints a progress line about every 10 s and a JSON
// summary every `every` days; checks conservation (items and people) at each summary, and at `saveAt` saves, loads
// a copy and checks that the copy runs 1 day identically. Exit code 1 on any failed check.
//   node tools/cloud-world-run.mjs [days=300] [size=world] [seed=7] [every=25] [saveAt=150]
import { newGame, conservationErrors } from './headless.js';
import { serializeGame, loadGame } from '../src/sim/save.js';
import { peopleCensus } from '../src/sim/godspawn.js';
import { metPairs } from '../src/sim/contact.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';
import { herdCensus, animalCensus } from '../src/sim/animals.js';
import { monsterCensus, monsterSummary } from '../src/sim/monsters.js';
import { civLawOf } from '../src/sim/civlaws.js';
import { isEvent, chainOf, notifies } from '../src/sim/chronicle.js';

/** Phase 8: raw food made so far (nutrition, from the ledger) and the share that is meat (hunting, butchering). */
function foodShare(g) {
  let all = 0, meat = 0;
  for (const [reason, items] of Object.entries(g.s.ledger?.byReason || {})) {
    if (!reason.startsWith('created:')) continue;
    for (const [it, q] of Object.entries(items)) {
      const d = g.reg.get('item', it);
      if (!d?.nutrition || !d.tags?.includes('core:raw_food')) continue;
      all += q * d.nutrition;
      if (d.tags.includes('core:meat')) meat += q * d.nutrition;
    }
  }
  return all ? +(meat / all).toFixed(3) : 0;
}

const [days = 300, size = 'world', seed = 7, every = 25, saveAt = 150] = process.argv.slice(2).map((v, i) => (i === 1 ? v : Number(v)));
const t0 = performance.now();
const g = newGame({ seed, scenario: 'core:vast_world', size });
console.error(`created ${g.W}x${g.H} in ${Math.round(performance.now() - t0)} ms`);
const start = Object.keys(g.s.colonists).length;
const ev = { declared: 0, conquered: 0, sacked: 0, fallen: 0, peace: 0, outbreaks: 0 };
let li = 0, last = Date.now(), failed = false, worst = 0, windowMs = 0, windowTicks = 0;
const slowest = []; // the five slowest ticks of the run: { tick, ms }
const state = (x) => { const s = JSON.parse(serializeGame(x)); delete s.state.loadedFrom; return JSON.stringify(s); };

for (let d = 1; d <= days; d++) {
  for (let t = 0; t < TICKS_PER_DAY; t++) {
    const a = performance.now();
    g.tick();
    const dt = performance.now() - a;
    windowMs += dt; windowTicks++;
    if (dt > worst) worst = dt;
    if (slowest.length < 5 || dt > slowest[4].ms) { slowest.push({ tick: g.s.tick, ms: +dt.toFixed(1) }); slowest.sort((x, y) => y.ms - x.ms); slowest.length = Math.min(5, slowest.length); }
    if (Date.now() - last > 10000) { last = Date.now(); console.error(`[run] day ${(g.s.tick / TICKS_PER_DAY).toFixed(1)} of ${days}, ${Object.keys(g.s.colonists).length} people, ${(windowMs / windowTicks).toFixed(3)} ms/tick`); }
  }
  for (const e of g.s.log) if (e.t > li) {
    if (/declared war on/.test(e.msg)) ev.declared++;
    if (/has conquered/.test(e.msg)) ev.conquered++;
    if (/has sacked/.test(e.msg)) ev.sacked++;
    if (/has fallen:/.test(e.msg)) ev.fallen++;
    if (/for peace/.test(e.msg)) ev.peace++;
    if (/broke out in/.test(e.msg)) ev.outbreaks++;
  }
  li = g.s.tick;
  if (d === saveAt) {
    const a = performance.now();
    const copy = loadGame(g.reg, serializeGame(g));
    copy.debugThrow = true;
    const loadMs = Math.round(performance.now() - a);
    const probe = loadGame(g.reg, serializeGame(g)); // the original keeps running untouched; compare two copies
    probe.debugThrow = true;
    copy.step(TICKS_PER_DAY); probe.step(TICKS_PER_DAY);
    const same = state(copy) === state(probe);
    // and against the original after the same day (the original runs it in the loop below)
    console.log(JSON.stringify({ saveCheck: d, loadMs, copiesIdentical: same }));
    if (!same) failed = true;
    g._saveCopy = copy;
  }
  if (g._saveCopy && d === saveAt + 1) {
    const same = state(g._saveCopy) === state(g);
    console.log(JSON.stringify({ saveCheck: 'continued', day: d, identicalToUnsaved: same }));
    if (!same) failed = true;
    g._saveCopy = null;
  }
  if (d % every === 0 || d === days) {
    const st = Object.values(g.s.settlements);
    const cons = conservationErrors(g), pc = peopleCensus(g, start);
    const ac = animalCensus(g), mc = monsterCensus(g);
    if (cons.length || !pc.ok || !ac.ok || !mc.ok) failed = true;
    const m = g.s.contact ? metPairs(g) : null;
    console.log(JSON.stringify({
      day: d, msPerTick: +(windowMs / windowTicks).toFixed(3), worstTickMs: +worst.toFixed(1),
      villages: st.length, standing: st.filter((x) => !x.fallen).length, kingdoms: Object.keys(g.s.kingdoms || {}).length,
      people: Object.keys(g.s.colonists).length, born: pc.born, died: pc.died, deaths: g.s.stats.deaths || {}, illness: g.s.stats.illness || {},
      wars: Object.values(g.s.relations || {}).filter((r) => r.aggressor).length, ...ev, pairsMet: m?.pairs,
      herds: g.s.animals ? Object.fromEntries(Object.entries(herdCensus(g)).map(([k, v]) => [k.replace('core:', ''), v.animals])) : undefined,
      hunted: g.s.ledger?.byReason?.['created:hunt'], meatShare: foodShare(g),
      peoples: Object.fromEntries(Object.entries(pc.byPeople || {}).map(([k, v]) => [k.replace('core:', ''), v])),
      villagesByPeople: st.filter((x) => !x.fallen).reduce((o, x) => { const k = String(x.people || 'none').replace('core:', ''); o[k] = (o[k] || 0) + 1; return o; }, {}),
      laws: st.filter((x) => !x.fallen).reduce((o, x) => { for (const l of g.reg.all('civLaw')) { const v = civLawOf(g, x.id, l.id); if (v !== l.options[0].id) { const k = `${l.id.replace('core:', '')}=${v}`; o[k] = (o[k] || 0) + 1; } } return o; }, {}),
      tithes: g.s.log.filter((e) => /sends its tithe/.test(e.msg)).length,
      mood: (() => { const cs = Object.values(g.s.colonists); const m = cs.map((c) => c.mood ?? 0); return cs.length ? { avg: Math.round(m.reduce((a, x) => a + x, 0) / cs.length), unhappy: m.filter((x) => x <= -20).length, miserable: m.filter((x) => x <= -50).length, unrest: st.filter((x) => !x.fallen && x.unrest !== undefined).length } : {}; })(),
      chronicle: { lines: g.s.log.length, events: g.s.log.filter((e) => isEvent(g, e)).length, folded: g.s.chronicle?.folded || 0, notify: g.s.log.filter((e) => notifies(g, e)).length, linked: g.s.log.filter((e) => e.cause || e.rel).length },
      heapMB: Math.round(process.memoryUsage().heapUsed / 1e6), cons: cons.length, peopleOk: pc.ok, animalsOk: ac.ok, monstersOk: mc.ok, monsters: monsterSummary(g),
    }));
    windowMs = 0; windowTicks = 0; worst = 0;
  }
}
const text = serializeGame(g);
// Phase 12: the longest recorded chain in the log, printed step by step (each link as written when it happened).
let best = null;
for (const e of g.s.log) if (e.cause || e.rel) { const c = chainOf(g, e.id); if (!best || c.back.length > best.back.length) best = c; }
if (best) console.log(JSON.stringify({ longestChain: [best.event, ...best.back.map((x) => ({ link: x.link, ...x.event }))].map((e) => (e.link ? `  <-${e.link}- ` : '') + `day ${((e.t ?? 0) / TICKS_PER_DAY).toFixed(1)} [${e.kind || '?'}] ${e.msg || (e.summarised ? '(summarised)' : '(lost)')}`) }));
console.log(JSON.stringify({ slowest }));
console.log(JSON.stringify({ done: true, saveMB: +(text.length / 1e6).toFixed(2), totalMin: +((performance.now() - t0) / 60000).toFixed(1), failed }));
process.exit(failed ? 1 : 0);
