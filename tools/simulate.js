// CLI: run a colony headless and print a daily report.
//   node tools/simulate.js [days=5] [seed] [--mods=core,example_pottery] [--log]
import { newGame, summary, conservationErrors } from './headless.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

const args = process.argv.slice(2);
const days = Number(args.find((a) => /^\d+(\.\d+)?$/.test(a)) ?? 5);
const seedArg = args.filter((a) => /^\d+$/.test(a))[1];
const modsArg = args.find((a) => a.startsWith('--mods='));
const mods = modsArg ? modsArg.slice(7).split(',') : ['core'];
const scArg = args.find((a) => a.startsWith('--scenario='));
const g = newGame({ seed: seedArg ? Number(seedArg) : undefined, mods, scenario: scArg ? scArg.slice(11) : undefined });
const showLog = args.includes('--log');
let logIdx = 0;
const t0 = Date.now();
const total = Math.round(days * TICKS_PER_DAY);
for (let t = 0; t < total; t++) {
  g.tick();
  if (showLog) { while (logIdx < g.s.log.length) { const e = g.s.log[logIdx++]; console.log(`  [${(e.t / TICKS_PER_DAY).toFixed(2)}] ${e.msg}`); } }
  if ((t + 1) % (TICKS_PER_DAY / 2) === 0) console.log(JSON.stringify(summary(g)));
}
console.log('conservation errors:', conservationErrors(g));
console.log('ledger:', JSON.stringify(g.s.ledger.byReason));
console.log(`ran ${total} ticks in ${Date.now() - t0} ms`);
