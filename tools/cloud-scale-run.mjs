// The scale target (docs/ROADMAP.md direction 7: thousands of people world-wide by day 300 on the World preset).
//   node tools/cloud-scale-run.mjs load [targets=1000,2000,4000] [seed=7] [warmDays=20]
//       a World game; after warmDays days the villagers of the standing villages are copied (round-robin; a timing harness,
//       not a game rule: the copies come with no goods, home, bed or job, and their villages plan for them) until each
//       target is reached; then one game day is timed and profiled (CPU share by file). The spawn power cannot be used
//       for this: joining a village needs free beds.
//       SCALE_CACHE=<file>: the warmed game is saved there the first time and loaded from it after (faster experiments).
//       SCALE_FUNCS=1: also print the 12 slowest functions (self time) of each profiled day.
//   node tools/cloud-scale-run.mjs grow [cap=40] [days=300] [seed=7]
//       the World game with every village's population cap raised to `cap` (the data's maxPopulation, 6 today):
//       people, villages and ms/tick every 25 days, to see how fast growth itself can reach thousands.
// Prints a progress line about every 10 s and one JSON line per measurement.
import { newGame } from './headless.js';
import { readAllMods } from './fsmods.js';
import { buildRegistry } from '../src/sim/content/modloader.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';
import { Session } from 'node:inspector/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { serializeGame, loadGame } from '../src/sim/save.js';

const [mode = 'load', a1, a2, a3] = process.argv.slice(2);
let last = Date.now();
const progress = (msg) => { if (Date.now() - last > 10000) { last = Date.now(); console.error(`[${mode}] ${msg}`); } };
const people = (g) => Object.keys(g.s.colonists).length;
const standing = (g) => Object.keys(g.s.settlements).sort().filter((k) => !g.s.settlements[k].fallen && g.owned('colonists', k).length);
function runDays(g, days, label) {
  let sum = 0, n = 0, worst = 0;
  for (let t = 0; t < days * TICKS_PER_DAY; t++) {
    const a = performance.now(); g.tick(); const d = performance.now() - a;
    sum += d; n++; if (d > worst) worst = d;
    progress(`${label} day ${(g.s.tick / TICKS_PER_DAY).toFixed(1)}, ${people(g)} people, ${(sum / n).toFixed(2)} ms/tick`);
  }
  return { msPerTick: +(sum / n).toFixed(3), worstMs: +worst.toFixed(1) };
}
/** A passable tile in sid's land near its centre, for settlers to join at. */
function joinSpot(g, sid) {
  const c = g.s.settlements[sid].center;
  for (let r = 1; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = c.x + dx, y = c.y + dy;
    if (g.inB(x, y) && g.isPassable(x, y)) return { x, y };
  }
  return null;
}
async function profileDay(g) {
  const session = new Session(); session.connect();
  await session.post('Profiler.enable'); await session.post('Profiler.start');
  const r = runDays(g, 1, 'profile');
  const { profile } = await session.post('Profiler.stop'); session.disconnect();
  const dt = new Map(); profile.samples.forEach((id, i) => dt.set(id, (dt.get(id) || 0) + (profile.timeDeltas[i] || 0)));
  const byFile = {}; let total = 0;
  for (const nd of profile.nodes) { const t = dt.get(nd.id) || 0; total += t; const f = (nd.callFrame.url || '').split('/').pop() || '(other)'; byFile[f] = (byFile[f] || 0) + t; }
  let funcs;
  if (process.env.SCALE_FUNCS) {
    const byFn = {};
    for (const nd of profile.nodes) { const t = dt.get(nd.id) || 0; const k = `${nd.callFrame.functionName || '(anon)'} ${(nd.callFrame.url || '').split('/').pop()}:${nd.callFrame.lineNumber + 1}`; byFn[k] = (byFn[k] || 0) + t; }
    funcs = Object.entries(byFn).sort((x, y) => y[1] - x[1]).slice(0, 12).map(([f, t]) => `${f} ${((100 * t) / total).toFixed(1)}%`);
  }
  return { ...r, ...(funcs ? { funcs } : {}), top: Object.entries(byFile).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([f, t]) => `${f} ${((100 * t) / total).toFixed(1)}%`) };
}

if (mode === 'load') {
  const targets = (a1 || '1000,2000,4000').split(',').map(Number), seed = Number(a2) || 7, warm = Number(a3) || 20;
  const cache = process.env.SCALE_CACHE;
  let g;
  if (cache && existsSync(cache)) { const base0 = newGame({ seed, scenario: 'core:vast_world', size: 'world' }); g = loadGame(base0.reg, readFileSync(cache, 'utf8')); }
  else { g = newGame({ seed, scenario: 'core:vast_world', size: 'world' }); runDays(g, warm, 'warm-up'); if (cache) writeFileSync(cache, serializeGame(g)); }
  const base = await profileDay(g);
  console.log(JSON.stringify({ mode, seed, warmDays: warm, people: people(g), villages: standing(g).length, ...base }));
  for (const target of targets) {
    let i = 0, refused = 0;
    while (people(g) < target) {
      const S = standing(g), sid = S[i++ % S.length], src = g.owned('colonists', sid).find((c) => c.stage === g.reg.all('lifeStage').sort((x, y) => (y.order ?? 0) - (x.order ?? 0))[0].id) || g.owned('colonists', sid)[0];
      if (!src) { refused++; if (refused > 1000) break; continue; }
      const id = 'c' + g.s.nextId++;
      const c = JSON.parse(JSON.stringify(src));
      Object.assign(c, { id, name: `${src.name} ${id}`, carry: null, equip: { tool: null, weapon: null }, homeId: null, bedId: null, job: null, mv: null, sleeping: false, parents: [], ammo: undefined });
      delete c.ammo; delete c.grief; delete c.breakUntil;
      g.s.colonists[id] = c;
      g.ownAdd('colonists', c);
    }
    g.markDirty?.(); g.planDirty = true;
    runDays(g, 0.5, 'settle'); // half a day for the newcomers to find work and beds
    const m = await profileDay(g);
    console.log(JSON.stringify({ mode, seed, target, people: people(g), villages: standing(g).length, refused, ...m }));
  }
} else if (mode === 'grow') {
  const cap = Number(a1) || 40, days = Number(a2) || 300, seed = Number(a3) || 7;
  const mods = readAllMods();
  // SCALE_GROWTH='{"chancePerDay":..,"gapDays":..,"maxPopulation":..}': the World size's growthBySize (people.js) instead.
  const G = process.env.SCALE_GROWTH ? JSON.parse(process.env.SCALE_GROWTH) : null;
  for (const m of mods) for (const [, f] of Object.entries(m.files)) {
    if (!G) for (const p of f?.villageProfile || []) if (p.policy) p.policy.maxPopulation = cap;
    if (G) for (const sc of f?.scenario || []) if (sc.id === 'core:vast_world') sc.growthBySize = { world: G };
  }
  const registry = buildRegistry(mods, ['core']).registry;
  const g = newGame({ seed, registry, scenario: 'core:vast_world', size: 'world' });
  for (let d = 25; d <= days; d += 25) {
    const r = runDays(g, 25, 'grow');
    console.log(JSON.stringify({ mode, cap: G || cap, seed, day: d, people: people(g), villages: standing(g).length, ...r, heapMB: Math.round(process.memoryUsage().heapUsed / 1e6) }));
  }
} else { console.error('modes: load, grow'); process.exit(1); }
