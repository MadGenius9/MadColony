// Performance benchmark for world sizes and village counts.
// Usage: node tools/bench.js [days=2] [sizes=small,medium,large] [villages=2,4] [seed=7]
// Reports world creation time, average and slowest milliseconds per simulation tick, the share of real
// time a 1x game would use (60 ticks per second in the browser), save size and memory.
import { newGame, conservationErrors } from './headless.js';
import { serializeGame, loadGame } from '../src/sim/save.js';
import { relationOf } from '../src/sim/villages.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

const days = Number(process.argv[2] || 2);
const sizes = (process.argv[3] || 'small,medium,large').split(',');
const villageCounts = (process.argv[4] || '2,4').split(',').map(Number);
const seed = Number(process.argv[5] || 7);
const report = typeof globalThis.process !== 'undefined' && process.env.CLAUDE_PROGRESS_SH;
void report;

const rows = [];
for (const size of sizes) for (const villages of villageCounts) {
  const t0 = performance.now();
  const g = newGame({ seed, scenario: 'core:neighbours', size, villages });
  const create = performance.now() - t0;
  const ticks = days * TICKS_PER_DAY;
  let worst = 0;
  const t1 = performance.now();
  for (let i = 0; i < ticks; i++) {
    const a = performance.now();
    g.tick();
    const d = performance.now() - a;
    if (d > worst) worst = d;
  }
  const run = performance.now() - t1;
  const text = serializeGame(g);
  const t2 = performance.now();
  loadGame(g.reg, text);
  const load = performance.now() - t2;
  const st = Object.values(g.s.settlements);
  let contacts = 0;
  for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) if (relationOf(g, st[i].id, st[j].id).contact) contacts++;
  const trades = Object.values(g.s.trades).filter((t) => t.status === 'done').length;
  rows.push({
    size, map: `${g.s.map.w}x${g.s.map.h}`, settlements: st.length, colonists: g.colonists().length,
    createMs: Math.round(create), msPerTick: +(run / ticks).toFixed(3), worstTickMs: +worst.toFixed(1),
    realtimeAt1x: `${Math.round((run / ticks) * 60 / 10)}%`, saveKB: Math.round(text.length / 1024), loadMs: Math.round(load),
    contacts, tradesDone: trades, ledgerOk: conservationErrors(g).length === 0, heapMB: Math.round(process.memoryUsage().heapUsed / 1e6),
  });
  console.error(`done ${size} x${villages}`);
}
console.table(rows);
