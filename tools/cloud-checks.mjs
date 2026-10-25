// The phase checks from docs/ROADMAP.md "How a phase runs", for the cloud copy (the home project has its own tools).
//   node tools/cloud-checks.mjs forty    the 40-day headless run (default seed, classic colony)
//   node tools/cloud-checks.mjs modern   seed 4242 with an "Advance to Modern" goal, up to 60 days
// Prints a progress line about every 5 s and a JSON result at the end. `stateHash` is a hash of the final save:
// equal hashes mean the run is unchanged (compare with docs/cloud-baseline.md).
import { createHash } from 'node:crypto';
import { newGame, conservationErrors } from './headless.js';
import { serializeGame } from '../src/sim/save.js';
import { addGoal } from '../src/sim/goals.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

const mode = process.argv[2] || 'forty';
if (!['forty', 'modern'].includes(mode)) { console.error('usage: node tools/cloud-checks.mjs forty|modern'); process.exit(2); }
const g = mode === 'modern' ? newGame({ seed: 4242 }) : newGame({});
if (mode === 'modern') addGoal(g, 'core:advance_era', { era: 'core:modern' });
const days = mode === 'modern' ? 60 : 40;
const sid = g.s.playerSettlement;
const eraOf = () => g.s.settlements[sid]?.research?.era;
const eraDays = {};
let worst = 0, last = Date.now(), errors = [];
const t0 = performance.now();
for (let t = 1; t <= days * TICKS_PER_DAY; t++) {
  const a = performance.now();
  g.tick();
  const d = performance.now() - a;
  if (d > worst) worst = d;
  const era = eraOf();
  if (era && !(era in eraDays)) eraDays[era] = +(t / TICKS_PER_DAY).toFixed(2);
  if (t % TICKS_PER_DAY === 0 && (t / TICKS_PER_DAY) % 5 === 0) {
    errors = conservationErrors(g);
    if (errors.length) break;
  }
  if (Date.now() - last > 5000) { last = Date.now(); console.error(`[${mode}] day ${(t / TICKS_PER_DAY).toFixed(1)} of ${days}, era ${era}`); }
  if (mode === 'modern' && era === 'core:modern') break;
}
const ticks = g.s.tick;
const built = Object.values(g.s.structures).filter((b) => b.built).length;
const result = {
  mode, seed: g.s.seed, day: +(ticks / TICKS_PER_DAY).toFixed(2), msPerTick: +((performance.now() - t0) / ticks).toFixed(3), worstTickMs: +worst.toFixed(1),
  colonists: g.colonists().length, built, era: eraOf(), eraDays, conservationErrors: errors.length ? errors : conservationErrors(g),
  stateHash: createHash('sha1').update(serializeGame(g)).digest('hex').slice(0, 16),
};
console.log(JSON.stringify(result));
process.exit(result.conservationErrors.length ? 1 : 0);
