// The Phase 5b acceptance run (cloud copy): a Vast world in Sandbox mode where every destructive power (and rain)
// is used on fixed days. After each power the game is saved and loaded, and the copy must run 300 ticks exactly as
// the original; items and people are counted every day. Prints a progress line about every 10 s, one line per
// power, and a JSON report at the end. Exit code 1 on any failed check.
//   node tools/cloud-powers-run.mjs [days=40] [size=vast] [seed=7]
import { newGame, conservationErrors } from './headless.js';
import { serializeGame, loadGame } from '../src/sim/save.js';
import { issueCommand } from '../src/sim/god.js';
import { peopleCensus } from '../src/sim/godspawn.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

const [days = 40, size = 'vast', seed = 7] = process.argv.slice(2).map((v, i) => (i === 1 ? v : Number(v)));
const g = newGame({ seed, scenario: 'core:vast_world', size, sandbox: true });
const start = Object.keys(g.s.colonists).length;
const state = (x) => { const s = JSON.parse(serializeGame(x)); delete s.state.loadedFrom; return JSON.stringify(s); };
let failed = false, last = Date.now(), worst = 0, worstFire = 0, worstDay1 = 0, peakFire = 0;
const fail = (why) => { failed = true; console.error(`FAILED: ${why}`); };

// Targets, picked when the power is due: the player's village, the nearest other village, a wood near the player.
const sids = () => Object.keys(g.s.settlements).filter((k) => !g.s.settlements[k].fallen).sort();
const other = () => { const p = g.s.settlements[g.s.playerSettlement].center; return sids().filter((k) => k !== g.s.playerSettlement).sort((a, b) => Math.hypot(g.s.settlements[a].center.x - p.x, g.s.settlements[a].center.y - p.y) - Math.hypot(g.s.settlements[b].center.x - p.x, g.s.settlements[b].center.y - p.y))[0]; };
const homeTile = (sid) => { const h = Object.values(g.s.homes).filter((x) => (x.settlement || g.s.playerSettlement) === sid).sort((a, b) => (a.id < b.id ? -1 : 1))[0]; const st = h && g.s.projects[h.projectId]?.parts.map((id) => g.s.structures[id]).find((s) => s?.built); return st ? { x: st.x, y: st.y } : { ...g.s.settlements[sid].center }; };
const wood = (sid) => { const c = g.s.settlements[sid].center; return Object.values(g.s.nodes).filter((n) => n.def === 'core:pine' && !n.young && Math.hypot(n.x - c.x, n.y - c.y) > 12).sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y) || (a.id < b.id ? -1 : 1))[0]; };
/** The pine nearest the player's village that stands more than 80 tiles from every village centre. */
const farWood = () => {
  const cs = sids().map((k) => g.s.settlements[k].center), p = g.s.settlements[g.s.playerSettlement].center;
  return Object.values(g.s.nodes).filter((n) => n.def === 'core:pine' && !n.young && cs.every((c) => Math.hypot(n.x - c.x, n.y - c.y) > 80))
    .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y) || (a.id < b.id ? -1 : 1))[0];
};
const someone = (sid) => g.owned('colonists', sid).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
let fireAt = null;
/** One timed tick of the game (the worst-tick figures). */
function timedTick(d) {
  const a = performance.now();
  g.tick();
  const dt = performance.now() - a, fires = Object.keys(g.s.disasters?.fires || {}).length;
  if (d === 1) worstDay1 = Math.max(worstDay1, dt); else worst = Math.max(worst, dt);
  if (fires > 0 && d > 1) worstFire = Math.max(worstFire, dt);
  peakFire = Math.max(peakFire, fires);
  return fires;
}
const PLAN = [
  [2, 'lightning', () => { const c = someone(other()); return { x: Math.round(c.x), y: Math.round(c.y) }; }],
  [3, 'fire', () => { const t = wood(g.s.playerSettlement); fireAt = { x: t.x, y: t.y }; return { ...fireAt }; }],
  [4, 'rain', () => ({ ...fireAt })],
  [6, 'smite', () => ({ colonistId: someone(other()).id })],
  [8, 'meteor', () => homeTile(other())],
  [10, 'quake', () => homeTile(g.s.playerSettlement)],
  [12, 'tornado', () => { const t = homeTile(other()); return { x: t.x - 12, y: t.y, dir: 0 }; }],
  [14, 'plague', () => ({ settlementId: other() })],
  [16, 'drought', () => homeTile(g.s.playerSettlement)],
  [18, 'fire', () => homeTile(g.s.playerSettlement)],
  [20, 'fire', () => { const t = farWood(); return { x: t.x, y: t.y }; }], // a large fire nobody fights
];
const used = [];

for (let d = 1; d <= days; d++) {
  for (const [day, type, args] of PLAN) {
    if (day !== d) continue;
    const a = { ...args(), ...(type === 'rain' ? {} : { confirm: true }) };
    const r = issueCommand(g, type, a);
    if (!r.ok) { fail(`${type} refused on day ${d}: ${r.reason}`); continue; }
    timedTick(d);
    const res = g.s.god.log.at(-1).result;
    if (!res.ok) fail(`${type} failed on day ${d}: ${res.reason}`);
    used.push({ day: d, type, msg: res.msg });
    console.error(`[power] day ${d} ${type}: ${res.msg}`);
    // Save, load, and both run 300 ticks: identical.
    const copy = loadGame(g.reg, serializeGame(g));
    for (let t = 0; t < 300; t++) { timedTick(d); copy.tick(); }
    if (state(g) !== state(copy)) fail(`${type}: the loaded copy differs after 300 ticks`);
  }
  while (g.s.tick < d * TICKS_PER_DAY) {
    const fires = timedTick(d);
    if (Date.now() - last > 10000) { last = Date.now(); console.error(`[run] day ${(g.s.tick / TICKS_PER_DAY).toFixed(1)} of ${days}, ${Object.keys(g.s.colonists).length} people, ${fires} burning`); }
  }
  const ce = conservationErrors(g), pc = peopleCensus(g, start);
  if (ce.length) fail(`day ${d}: items not conserved: ${ce.slice(0, 3).join('; ')}`);
  if (!pc.ok) fail(`day ${d}: people not counted: ${JSON.stringify(pc)}`);
}
const s = g.s, deaths = s.stats?.deaths || {};
console.log(JSON.stringify({
  days, size, seed, ok: !failed, powers: used.length, used,
  people: { start, now: Object.keys(s.colonists).length, deaths },
  worstTickMs: +worst.toFixed(1), worstTickWhileBurningMs: +worstFire.toFixed(1), worstTickDay1Ms: +worstDay1.toFixed(1), peakBurningTiles: peakFire,
  scorched: Object.keys(s.disasters?.scorched || {}).length, seedsWaiting: Object.keys(s.disasters?.seeds || {}).length,
  youngPlants: Object.values(s.nodes).filter((n) => n.young).length, craterTiles: g.terrainPalette.includes('core:crater') ? [...g._ts.idx].filter((k) => g.terrainPalette[k] === 'core:crater').length : 0,
  ledgerDivine: s.ledger.byReason['created:divine'] || {}, ledgerBurned: s.ledger.byReason['consumed:fire'] || {},
  villages: Object.keys(s.settlements).length, fallen: Object.values(s.settlements).filter((v) => v.fallen).length,
  // Phase 14: the outcome cards (changes that followed each power) and the records still waiting.
  outcomeCards: (s.followUps?.cards || []).map((c) => s.log.find((e) => e.id === c.ev)?.msg || `(card for ${c.type}, line rolled off)`), followWaiting: s.followUps?.wait?.length || 0,
}, null, 1));
process.exit(failed ? 1 : 0);
