// World shaping acceptance run (cloud copy): the Blank ocean world (Sandbox). Raise an island out of the open sea
// stroke by stroke, give it a lake, forest, stone and ore, found the first village on it (it becomes the player's),
// then let it live `days` days. After every stroke the game is saved and loaded and the copy must run 300 ticks
// exactly as the original; items and people are counted every day. Prints a progress line about every 10 s, one
// line per stroke, and a JSON report at the end. Exit code 1 on any failed check.
//   node tools/cloud-shape-run.mjs [days=60] [size=vast] [seed=7]
import { newGame, conservationErrors } from './headless.js';
import { serializeGame, loadGame } from '../src/sim/save.js';
import { issueCommand, previewCommand } from '../src/sim/god.js';
import { peopleCensus } from '../src/sim/godspawn.js';
import { animalCensus } from '../src/sim/animals.js';
import { monsterCensus } from '../src/sim/monsters.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

const [days = 60, size = 'vast', seed = 7] = process.argv.slice(2).map((v, i) => (i === 1 ? v : Number(v)));
const g = newGame({ seed, scenario: 'core:blank_ocean', size, sandbox: true });
const state = (x) => { const s = JSON.parse(serializeGame(x)); delete s.state.loadedFrom; return JSON.stringify(s); };
let failed = false, last = Date.now(), worst = 0, worstStroke = 0, strokes = 0;
const fail = (why) => { failed = true; console.error(`FAILED: ${why}`); };
const tick = () => { const a = performance.now(); g.tick(); const dt = performance.now() - a; worst = Math.max(worst, dt); return dt; };

// Open sea: a spot with water all round within 24 tiles.
let sea = null;
for (let y = 60; y < g.H - 60 && !sea; y += 24) for (let x = 60; x < g.W - 60 && !sea; x += 24) {
  let wet = true;
  for (let dy = -32; dy <= 32 && wet; dy += 8) for (let dx = -32; dx <= 32 && wet; dx += 8) if (!g.terrainAt(x + dx, y + dy).drinkable && g.terrainAt(x + dx, y + dy).id !== 'core:deep_water') wet = false;
  if (wet) sea = { x, y };
}
if (!sea) { console.error('no open sea'); process.exit(1); }
const dry = (x, y) => { const t = g.terrainAt(x, y); return t.passable && !t.drinkable && t.id !== 'core:shallows'; };

function stroke(args) {
  const p = previewCommand(g, 'shape', args);
  if (!p.ok) return false;
  issueCommand(g, 'shape', args);
  const dt = tick();
  let w = dt;
  const copy = loadGame(g.reg, serializeGame(g));
  for (let t = 0; t < 300; t++) { w = Math.max(w, tick()); copy.tick(); }
  worstStroke = Math.max(worstStroke, w);
  if (state(g) !== state(copy)) fail(`${args.brush} at (${args.x}, ${args.y}): the loaded copy differs after 300 ticks`);
  strokes++;
  console.error(`[stroke] ${args.brush} (${args.x}, ${args.y}) r${args.r}: ${p.preview.tiles} tiles, worst tick ${w.toFixed(0)} ms`);
  return true;
}
// 1. An island: raise a 3x3 block of discs 12 apart (they overlap, so the island is one piece), each until its
// middle is dry land, flattening after every raise so the overlaps stay grass (raise lifts grass to hills and
// hills to mountain; flatten turns hills and sand back to grass, which can be farmed).
for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
  const at = { x: sea.x + i * 12, y: sea.y + j * 12 };
  for (let k = 0; k < 6 && !dry(at.x, at.y); k++) { stroke({ brush: 'raise', ...at, r: 8 }); stroke({ brush: 'flatten', ...at, r: 8 }); }
}
let cut = 0;
for (let y = sea.y - 24; y <= sea.y + 24; y++) for (let x = sea.x - 24; x <= sea.x + 24; x++) if (dry(x, y) && !g.reachableFrom(sea.x, sea.y, x, y, 'on')) cut++;
if (cut) fail(`the island is in pieces: ${cut} dry tiles cannot be walked to from its middle`);
// 2. A lake, forest, stone and ore on it.
stroke({ brush: 'water', x: sea.x - 8, y: sea.y - 8, r: 3 });
stroke({ brush: 'forest', x: sea.x + 10, y: sea.y - 10, r: 6 });
stroke({ brush: 'stone', x: sea.x - 10, y: sea.y + 10, r: 4 });
stroke({ brush: 'ore', x: sea.x + 10, y: sea.y + 10, r: 4 });
// The forest brush plants saplings; let them grow up for a year (pines take 20 days, a year is 30) so the
// settlers have wood and land in the season a new game starts in (they freeze if they land in midwinter).
for (const end = g.s.tick + 30 * TICKS_PER_DAY; g.s.tick < end;) tick();
// 3. The first village.
let found = null;
for (let r = 0; r < 20 && !found; r++) for (let dy = -r; dy <= r && !found; dy++) for (let dx = -r; dx <= r && !found; dx++) {
  const a = { x: sea.x + dx, y: sea.y + dy, count: 5, mode: 'found' };
  if (previewCommand(g, 'spawn', a).ok) found = a;
}
if (!found) fail(`no spot on the island to found a village: ${previewCommand(g, 'spawn', { x: sea.x, y: sea.y, count: 5, mode: 'found' }).reason}`);
else { issueCommand(g, 'spawn', found); tick(); }
const start = Object.keys(g.s.colonists).length - (g.s.god?.spawned || 0);
// 4. Live.
worst = 0;
for (let d = 1; d <= days; d++) {
  const end = (Math.floor(g.s.tick / TICKS_PER_DAY) + 1) * TICKS_PER_DAY;
  while (g.s.tick < end) { tick(); if (Date.now() - last > 10000) { last = Date.now(); console.error(`[run] day ${(g.s.tick / TICKS_PER_DAY).toFixed(1)}, ${Object.keys(g.s.colonists).length} people`); } }
  const ce = conservationErrors(g), pc = peopleCensus(g, start), ac = animalCensus(g), mc = monsterCensus(g);
  if (ce.length) fail(`day ${d}: items not conserved: ${ce.slice(0, 3).join('; ')}`);
  if (!pc.ok) fail(`day ${d}: people not counted: ${JSON.stringify(pc.problems)}`);
  if (!ac.ok || !mc.ok) fail(`day ${d}: animals or monsters not counted`);
}
const v = g.s.settlements[g.s.playerSettlement];
console.log(JSON.stringify({
  days, size, seed, ok: !failed, strokes, worstStrokeTickMs: +worstStroke.toFixed(1), worstLivingTickMs: +worst.toFixed(1),
  village: v ? { name: v.name, people: g.owned('colonists', g.s.playerSettlement).length, built: Object.values(g.s.structures).filter((s) => s.built).length, fields: g.owned('fields', g.s.playerSettlement).length } : null,
  deaths: g.s.stats?.deaths || {}, born: peopleCensus(g, start).born,
}, null, 1));
if (!v || g.owned('colonists', g.s.playerSettlement).length === 0) { console.error('FAILED: the village on the island died out'); process.exit(1); }
process.exit(failed ? 1 : 0);
