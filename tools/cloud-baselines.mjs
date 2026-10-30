// Phase 11, item 3: repeatable performance baselines, each measured on its own (fixed seeds and sizes).
//   node tools/cloud-baselines.mjs stroke [size=vast]    terrain-edit latency: one raise and one forest stroke in a
//                                                         running game; the stroke tick and the worst of the next 10
//   node tools/cloud-baselines.mjs longticks [days=60]   the 10 slowest ticks of a World run and when they fall
//                                                         (day start, the hour, other)
//   node tools/cloud-baselines.mjs war [days=2]          ms/tick of two full-detail neighbours at war against the same
//                                                         game at peace
//   node tools/cloud-baselines.mjs animals [days=20]     the share of CPU time in animals.js and hunt.js over a Vast run
//                                                         (the in-process profiler)
// Prints a progress line about every 10 s and one JSON line of results. Compare numbers only within one session:
// this machine's speed varies by about 35% between days.
import { newGame } from './headless.js';
import { issueCommand, previewCommand } from '../src/sim/god.js';
import { relationOf } from '../src/sim/villages.js';
import { declareWar } from '../src/sim/combat.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';
import { Session } from 'node:inspector/promises';

const [mode = 'stroke', arg] = process.argv.slice(2);
let last = Date.now();
const progress = (msg) => { if (Date.now() - last > 10000) { last = Date.now(); console.error(`[${mode}] ${msg}`); } };
const timed = (g) => { const a = performance.now(); g.tick(); return performance.now() - a; };
const runDays = (g, days, label = '') => { let worst = 0, sum = 0, n = 0; for (let t = 0; t < days * TICKS_PER_DAY; t++) { const d = timed(g); sum += d; n++; if (d > worst) worst = d; progress(`${label} day ${(g.s.tick / TICKS_PER_DAY).toFixed(1)}`); } return { msPerTick: +(sum / n).toFixed(3), worst: +worst.toFixed(1) }; };

async function stroke() {
  const size = arg || 'vast';
  const g = newGame({ seed: 7, scenario: 'core:vast_world', size, sandbox: true });
  runDays(g, 1, 'warm-up');
  // A spot far from every village where a radius-8 raise is allowed.
  const far = (x, y) => Object.values(g.s.settlements).every((v) => Math.hypot(v.center.x - x, v.center.y - y) > 60);
  let spot = null;
  for (let y = 40; y < g.H - 40 && !spot; y += 37) for (let x = 40; x < g.W - 40 && !spot; x += 37) if (far(x, y) && previewCommand(g, 'shape', { brush: 'raise', x, y, r: 8 }).ok) spot = { x, y };
  const out = { mode: 'stroke', size, seed: 7, W: g.W, H: g.H };
  for (const brush of ['raise', 'forest']) {
    const a = { brush, ...spot, r: 8 };
    const p0 = performance.now(), pv = previewCommand(g, 'shape', a), previewMs = performance.now() - p0;
    if (!pv.ok) { out[brush] = { refused: pv.reason }; continue; }
    issueCommand(g, 'shape', a);
    const strokeTick = timed(g);
    let next = 0;
    for (let t = 0; t < 10; t++) next = Math.max(next, timed(g));
    out[brush] = { tiles: pv.preview.tiles, previewMs: +previewMs.toFixed(1), strokeTickMs: +strokeTick.toFixed(1), worstNext10Ms: +next.toFixed(1) };
  }
  return out;
}

async function longticks() {
  const days = Number(arg) || 60;
  const g = newGame({ seed: 7, scenario: 'core:vast_world', size: 'world' });
  const slow = [];
  let sum = 0;
  for (let t = 0; t < days * TICKS_PER_DAY; t++) {
    const d = timed(g);
    sum += d;
    if (slow.length < 10 || d > slow[9].ms) { const k = g.s.tick % TICKS_PER_DAY; slow.push({ tick: g.s.tick, day: Math.floor(g.s.tick / TICKS_PER_DAY), ms: +d.toFixed(1), when: k === 0 ? 'day start' : k % 100 === 0 ? 'on the hour' : 'other' }); slow.sort((x, y) => y.ms - x.ms); slow.length = Math.min(10, slow.length); }
    progress(`day ${(g.s.tick / TICKS_PER_DAY).toFixed(1)}`);
  }
  return { mode: 'longticks', size: 'world', seed: 7, days, msPerTick: +(sum / (days * TICKS_PER_DAY)).toFixed(3), slowest: slow };
}

async function war() {
  const days = Number(arg) || 2;
  const make = (atWar) => {
    const g = newGame({ seed: 7, scenario: 'core:neighbours', size: 'medium', villages: 2 });
    runDays(g, 1, atWar ? 'war warm-up' : 'peace warm-up');
    const [a, b] = Object.keys(g.s.settlements).filter((k) => g.s.settlements[k].ai).sort();
    relationOf(g, a, b).contact = true;
    if (atWar) { relationOf(g, a, b).value = 0; declareWar(g, a, b, 'A baseline war'); }
    const r = runDays(g, days, atWar ? 'war' : 'peace');
    return { ...r, wounded: Object.values(g.s.colonists).filter((c) => (c.health?.injuries || []).length).length };
  };
  return { mode: 'war', size: 'medium', seed: 7, days, peace: make(false), war: make(true) };
}

async function animals() {
  const days = Number(arg) || 20;
  const g = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast' });
  const session = new Session();
  session.connect();
  await session.post('Profiler.enable');
  await session.post('Profiler.start');
  const r = runDays(g, days, 'animals');
  const { profile } = await session.post('Profiler.stop');
  session.disconnect();
  const dt = new Map();
  profile.samples.forEach((id, i) => dt.set(id, (dt.get(id) || 0) + (profile.timeDeltas[i] || 0)));
  let total = 0;
  const byFile = {};
  for (const n of profile.nodes) {
    const t = dt.get(n.id) || 0;
    total += t;
    const f = (n.callFrame.url || '').split('/').pop() || '(other)';
    byFile[f] = (byFile[f] || 0) + t;
  }
  const share = (f) => +((100 * (byFile[f] || 0)) / total).toFixed(1);
  const top = Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([f, t]) => `${f} ${((100 * t) / total).toFixed(1)}%`);
  return { mode: 'animals', size: 'vast', seed: 7, days, ...r, animalsPct: share('animals.js'), huntPct: share('hunt.js'), monstersPct: share('monsters.js'), topFiles: top };
}

const modes = { stroke, longticks, war, animals };
if (!modes[mode]) { console.error(`modes: ${Object.keys(modes).join(', ')}`); process.exit(1); }
console.log(JSON.stringify(await modes[mode]()));
