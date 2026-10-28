// The Phase 8b acceptance run (cloud copy): a Vast world in Sandbox mode where the animal powers are used on fixed
// days. After each power the game is saved and loaded, and the copy must run 300 ticks exactly as the original;
// items, people and animals (the animal ledger) are counted every day. Prints a progress line about every 10 s,
// one line per power, and a JSON report at the end. Exit code 1 on any failed check.
//   node tools/cloud-animalpowers-run.mjs [days=30] [size=vast] [seed=7]
import { newGame, conservationErrors } from './headless.js';
import { serializeGame, loadGame } from '../src/sim/save.js';
import { issueCommand } from '../src/sim/god.js';
import { peopleCensus } from '../src/sim/godspawn.js';
import { animalCensus, herdCensus } from '../src/sim/animals.js';
import { TICKS_PER_DAY, CHUNK } from '../src/sim/constants.js';
/** The first path where two plain values differ (for a replay failure), or null. */
function diffPath(a, b, path = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return `${path}: ${JSON.stringify(a)?.slice(0, 200)} / ${JSON.stringify(b)?.slice(0, 200)}`;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = diffPath(a[k], b[k], `${path}.${k}`); if (d) return d; }
  return `${path}: (order)`;
}

const [days = 30, size = 'vast', seed = 7] = process.argv.slice(2).map((v, i) => (i === 1 ? v : Number(v)));
const g = newGame({ seed, scenario: 'core:vast_world', size, sandbox: true });
const start = Object.keys(g.s.colonists).length;
const state = (x) => { const s = JSON.parse(serializeGame(x)); delete s.state.loadedFrom; return JSON.stringify(s); };
let failed = false, last = Date.now(), worst = 0, worstDay1 = 0;
const fail = (why) => { failed = true; console.error(`FAILED: ${why}`); };

const centreOf = (sid) => g.s.settlements[sid].center;
const sids = () => Object.keys(g.s.settlements).filter((k) => !g.s.settlements[k].fallen).sort();
const other = () => { const p = centreOf(g.s.playerSettlement); return sids().filter((k) => k !== g.s.playerSettlement).sort((a, b) => Math.hypot(centreOf(a).x - p.x, centreOf(a).y - p.y) - Math.hypot(centreOf(b).x - p.x, centreOf(b).y - p.y) || (a < b ? -1 : 1))[0]; };
/** The first tile, ring by ring from (cx, cy) between rmin and rmax tiles, whose terrain passes ok. */
function ringTile(cx, cy, rmin, rmax, ok) {
  for (let r = rmin; r <= rmax; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const x = cx + dx, y = cy + dy;
    if (g.inB(x, y) && ok(g.terrainAt(x, y), x, y)) return { x, y };
  }
  return null;
}
const groundOf = (sp) => (t) => t.passable && !t.drinkable && g.reg.get('animal', sp).terrains.includes(t.id);
/** The middle of a chunk with none of a species' ground, nearest the player's village beyond 100 tiles. */
function offGround(sp) {
  const Hb = g._anHab, si = Hb.index.get(sp), p = centreOf(g.s.playerSettlement), cs = sids().map(centreOf);
  let best = null, bd = Infinity;
  for (let c = 0; c < g.CW * g.CH; c++) {
    const x = (c % g.CW) * CHUNK + 16, y = Math.floor(c / g.CW) * CHUNK + 16;
    if (!g.inB(x, y) || Hb.counts[si][c] !== 0 || !g.terrainAt(x, y).passable || g.terrainAt(x, y).drinkable) continue;
    if (cs.some((v) => Math.hypot(v.x - x, v.y - y) < 100)) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) { bd = d; best = { x, y }; }
  }
  return best;
}
let deerAt = null, crowdAt = null;
const PLAN = [
  [2, 'animals', () => { const c = centreOf(g.s.playerSettlement); deerAt = ringTile(c.x, c.y, 14, 26, groundOf('core:deer')); return { ...deerAt, species: 'core:deer', count: 12 }; }],
  [3, 'animals', () => { const h = Object.values(g.s.animals.herds).filter((e) => e.origin === 'divine' && e.sp === 'core:deer').sort((a, b) => (a.id < b.id ? -1 : 1))[0]; return { x: h.x, y: h.y, species: 'core:deer', count: 3, mode: 'join' }; }], // where the sent herd grazes now
  [4, 'animals', () => ({ ...offGround('core:wild_horse'), species: 'core:wild_horse', count: 15 })],
  [6, 'animals', () => { const c = centreOf(other()); return { ...ringTile(c.x, c.y, 8, 29, (t) => t.passable && !t.drinkable), species: 'core:wolf', count: 6, confirm: true }; }], // any dry land near it
  [8, 'peaceful', () => ({ on: true })],
  [14, 'peaceful', () => ({ on: false })],
  [16, 'animals', () => { const c = centreOf(g.s.playerSettlement); crowdAt = ringTile(c.x + 60, c.y, 0, 40, groundOf('core:deer')); return { ...crowdAt, species: 'core:deer', count: 12 }; }],
  [16, 'animals', () => ({ ...crowdAt, species: 'core:deer', count: 12 })],
  [16, 'animals', () => ({ ...crowdAt, species: 'core:deer', count: 12 })],
];
const used = [];

function timedTick(d) {
  const a = performance.now();
  g.tick();
  const dt = performance.now() - a;
  if (d === 1) worstDay1 = Math.max(worstDay1, dt); else worst = Math.max(worst, dt);
}

for (let d = 1; d <= days; d++) {
  for (const [day, type, args] of PLAN) {
    if (day !== d) continue;
    const r = issueCommand(g, type, args());
    if (!r.ok) { fail(`${type} refused on day ${d}: ${r.reason}`); continue; }
    timedTick(d);
    const res = g.s.god.log.at(-1).result;
    if (!res.ok) fail(`${type} failed on day ${d}: ${res.reason}`);
    used.push({ day: d, type, msg: res.msg });
    console.error(`[power] day ${d} ${type}: ${res.msg}`);
    const copy = loadGame(g.reg, serializeGame(g));
    for (let t = 0; t < 300; t++) { timedTick(d); copy.tick(); }
    if (state(g) !== state(copy)) fail(`${type} on day ${d}: the loaded copy differs after 300 ticks: ${diffPath(JSON.parse(state(g)).state, JSON.parse(state(copy)).state)}`);
  }
  while (g.s.tick < d * TICKS_PER_DAY) {
    timedTick(d);
    if (Date.now() - last > 10000) { last = Date.now(); console.error(`[run] day ${(g.s.tick / TICKS_PER_DAY).toFixed(1)} of ${days}, ${Object.keys(g.s.colonists).length} people`); }
  }
  const ce = conservationErrors(g), pc = peopleCensus(g, start), ac = animalCensus(g);
  if (ce.length) fail(`day ${d}: items not conserved: ${ce.slice(0, 3).join('; ')}`);
  if (!pc.ok) fail(`day ${d}: people not counted: ${JSON.stringify(pc)}`);
  if (!ac.ok) fail(`day ${d}: animals not counted: ${ac.problems.join('; ')}`);
}
const s = g.s;
console.log(JSON.stringify({
  days, size, seed, ok: !failed, powers: used.length, used,
  people: { start, now: Object.keys(s.colonists).length, deaths: s.stats?.deaths || {} },
  herds: herdCensus(g), ledger: s.animals.ledger, sentHerdsLeft: Object.values(s.animals.herds).filter((h) => h.origin === 'divine').map((h) => ({ id: h.id, sp: h.sp, n: h.n })),
  worstTickMs: +worst.toFixed(1), worstTickDay1Ms: +worstDay1.toFixed(1),
}, null, 1));
process.exit(failed ? 1 : 0);
