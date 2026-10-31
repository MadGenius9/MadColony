// World laws acceptance run (cloud copy): a Vast world where the laws are set and lifted on a schedule. At every
// change the game is saved and loaded, and the copy must play the next day exactly as the original. Items,
// people, animals and monsters are counted at every change and every `every` days. Prints a progress line about
// every 10 s, a JSON line per change and summary, and a JSON report at the end. Exit code 1 on any failed check.
//   node tools/cloud-laws-run.mjs [days=200] [size=vast] [seed=7] [every=25]
import { newGame, conservationErrors } from './headless.js';
import { serializeGame, loadGame } from '../src/sim/save.js';
import { issueCommand } from '../src/sim/god.js';
import { peopleCensus } from '../src/sim/godspawn.js';
import { animalCensus } from '../src/sim/animals.js';
import { monsterCensus } from '../src/sim/monsters.js';
import { activeLaws } from '../src/sim/worldlaws.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

const [days = 200, size = 'vast', seed = 7, every = 25] = process.argv.slice(2).map((v, i) => (i === 1 ? v : Number(v)));
// Day -> laws to set at that day's start.
const SCHEDULE = {
  20: [['core:peace', 'on']],
  35: [['core:fast_growth', 'on']],
  50: [['core:plague', 'endless']],
  65: [['core:tame_monsters', 'on'], ['core:peaceful_animals', 'on']],
  80: [['core:season', 'winter'], ['core:no_fire_spread', 'on']],
  95: [['core:ageless', 'on'], ['core:plague', 'none']],
  110: [['core:season', 'summer']],
  125: [['core:peace', 'off'], ['core:season', 'normal'], ['core:tame_monsters', 'off']],
  140: [['core:ageless', 'off'], ['core:fast_growth', 'off'], ['core:plague', 'normal'], ['core:no_fire_spread', 'off'], ['core:peaceful_animals', 'off']],
};
const t0 = performance.now();
const g = newGame({ seed, scenario: 'core:vast_world', size, sandbox: true });
const start = Object.keys(g.s.colonists).length;
let failed = false, last = Date.now(), windowMs = 0, windowTicks = 0;
const fail = (why) => { failed = true; console.error(`FAILED: ${why}`); };
const state = (x) => { const s = JSON.parse(serializeGame(x)); delete s.state.loadedFrom; return JSON.stringify(s); };
const counts = (d) => {
  const ce = conservationErrors(g), pc = peopleCensus(g, start), ac = animalCensus(g), mc = monsterCensus(g);
  if (ce.length) fail(`day ${d}: items not conserved: ${ce.slice(0, 3).join('; ')}`);
  if (!pc.ok) fail(`day ${d}: people not counted: ${JSON.stringify(pc.problems).slice(0, 300)}`);
  if (!ac.ok || !mc.ok) fail(`day ${d}: animals or monsters not counted`);
  return pc;
};
const runDay = (x) => { for (let t = 0; t < TICKS_PER_DAY; t++) x.tick(); };

for (let d = 1; d <= days; d++) {
  if (SCHEDULE[d]) {
    for (const [law, value] of SCHEDULE[d]) { const r = issueCommand(g, 'law', { law, value }); if (!r.ok) fail(`day ${d}: ${law} ${value}: ${r.reason}`); }
    g.tick();
    const copy = loadGame(g.reg, serializeGame(g));
    const a = performance.now();
    runDay(copy); runDay(g);
    windowMs += performance.now() - a; windowTicks += TICKS_PER_DAY;
    if (state(copy) !== state(g)) fail(`day ${d}: the loaded copy differs a day after the change`);
    const pc = counts(d);
    console.log(JSON.stringify({ day: d, set: SCHEDULE[d].map(([l, v]) => `${l.replace('core:', '')}=${v}`), laws: activeLaws(g).map((x) => `${x.id.replace('core:', '')}=${x.value}`), people: pc.living, born: pc.born, died: pc.died }));
    continue;
  }
  for (let t = 0; t < TICKS_PER_DAY; t++) {
    const a = performance.now();
    g.tick();
    windowMs += performance.now() - a; windowTicks++;
    if (Date.now() - last > 10000) { last = Date.now(); console.error(`[run] day ${(g.s.tick / TICKS_PER_DAY).toFixed(1)} of ${days}, ${Object.keys(g.s.colonists).length} people, ${(windowMs / windowTicks).toFixed(3)} ms/tick`); }
  }
  if (d % every === 0 || d === days) {
    const pc = counts(d), st = Object.values(g.s.settlements);
    console.log(JSON.stringify({
      day: d, msPerTick: +(windowMs / windowTicks).toFixed(3), people: pc.living, born: pc.born, died: pc.died, deaths: g.s.stats.deaths || {},
      villages: st.length, standing: st.filter((x) => !x.fallen).length, wars: Object.values(g.s.relations || {}).filter((r) => r.aggressor).length,
      illness: g.s.stats.illness || {}, laws: activeLaws(g).map((x) => `${x.id.replace('core:', '')}=${x.value}`),
    }));
    windowMs = 0; windowTicks = 0;
  }
}
console.log(JSON.stringify({ done: true, ok: !failed, totalMin: +((performance.now() - t0) / 60000).toFixed(1) }));
process.exit(failed ? 1 : 0);
