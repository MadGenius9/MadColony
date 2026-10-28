// Wild animals (Phase 8, slice 1: species and far herds; docs/proposals/phase-8-animals.md).
// Species are data (content type `animal`). Every game has them unless its scenario lists none
// (`scenario.animals: { species: [] }`). State: `s.animals` = { herds: id -> herd, next } (save format 27):
// a herd is { id, sp, x, y, n, day, year, next, fed }: its species, a centre tile, how many, the day and year it
// was last updated and last bred, the tick it may next move, and (packs) the day it last ate.
// - Placing: at the first tick of a game (or of an older save) each chunk gets herds of each species by the share
//   of its tiles that are the species' ground (density: herds per 1,000 such tiles), never within 24 tiles of a
//   village; positions and sizes are hash draws, so the world and the game's random stream are as before.
// - Every herd once an hour (staggered by id): once a day, births (once a year in spring, fewer as its chunk
//   fills: cap animals per 1,000 tiles of its ground; a pack only when it has eaten big prey lately), winter
//   losses, packs eating deer or horses within 2 chunks (a pack of more than 3 that has not eaten for starveDays
//   loses one: small game feeds 3), a herd above 1.5 x its
//   largest size splits, two of a species in one chunk that fit in one herd merge, one below 2 fades; at most every moveHours it moves one chunk toward better ground (more of its ground, less
//   crowded, away from villages; packs toward prey), never off its landmass.
// Draws are hashes of (seed, herd, day or tick). Cost: one pass over the map when herds are placed or the map
// changes (derived counts per chunk), then O(herds / 100) a tick.
import { TICKS_PER_DAY, CHUNK } from './constants.js';
import { seasonOf, climateOf } from './heat.js';
import { landChunks } from './contact.js';
import { injure, hpOf as hpOfP } from './health.js';
import { roomAt } from './heat.js';
import { stageOf as stageOfP } from './people.js';
import { endJob } from './ai/ai.js';
import { droughtAt } from './weatherat.js';

const HOUR = 100, NEAR_VILLAGE = 24, SMALL_GAME = 3, D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
const hash = (str) => {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};
const draw = (key) => hash(key) / 4294967296;
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The species this game has (scenario.animals.species, default: every species in data), in id order. */
export function animalSpecies(g) {
  if (g._anSpFor !== g.s.scenarioId) {
    const R = g.reg.get('scenario', g.s.scenarioId)?.animals;
    const ids = R?.species ?? g.reg.all('animal').map((d) => d.id);
    g._anSp = ids.map((id) => g.reg.get('animal', id)).filter(Boolean).sort((a, b) => byId(a.id, b.id));
    g._anScale = R?.scale ?? 1;
    g._anSpFor = g.s.scenarioId;
  }
  return g._anSp;
}

/** Per species, how many tiles of its ground each chunk has (derived per map revision, never saved). */
function habitat(g) {
  // Craters change terrain without the map revision (Game.setTerrainKeepRev): terrainDrawRev counts those too.
  const key = `${g.s.map.rev || 0}:${g.terrainDrawRev || 0}:${g.W}x${g.H}`;
  if (g._anHab?.key === key) return g._anHab;
  const sp = animalSpecies(g), pal = g.terrainPalette, ts = g._ts.idx, W = g.W, H = g.H, CW = g.CW, n = CW * g.CH;
  const masks = new Uint32Array(pal.length);
  const wmasks = new Uint32Array(pal.length); // winter ground (slice 6): winterTerrains, else all its terrains
  for (let k = 0; k < pal.length; k++) sp.forEach((d, s) => {
    if (d.terrains.includes(pal[k])) masks[k] |= 1 << s;
    if ((d.winterTerrains || d.terrains).includes(pal[k])) wmasks[k] |= 1 << s;
  });
  const counts = sp.map(() => new Int32Array(n)), winter = sp.map(() => new Int32Array(n));
  for (let y = 0; y < H; y++) {
    const cy = (y / CHUNK) | 0;
    for (let x = 0; x < W; x++) {
      const m = masks[ts[y * W + x]], wm = wmasks[ts[y * W + x]];
      if (!m && !wm) continue;
      const c = cy * CW + ((x / CHUNK) | 0);
      for (let s = 0; s < sp.length; s++) { if (m & (1 << s)) counts[s][c]++; if (wm & (1 << s)) winter[s][c]++; }
    }
  }
  return (g._anHab = { key, counts, winter, index: new Map(sp.map((d, s) => [d.id, s])) });
}

const chunkOf = (g, x, y) => ((y / CHUNK) | 0) * g.CW + ((x / CHUNK) | 0);
/** Does a drought area overlap chunk c (the circle reaches the chunk's rectangle)? O(weather areas). */
function droughtInChunk(g, c) {
  const W = g.s.disasters?.weather;
  if (!W) return false;
  const x0 = (c % g.CW) * CHUNK, y0 = ((c / g.CW) | 0) * CHUNK, x1 = Math.min(g.W, x0 + CHUNK) - 1, y1 = Math.min(g.H, y0 + CHUNK) - 1;
  for (const a of Object.values(W)) {
    if (a.kind !== 'drought') continue;
    const dx = a.x - Math.max(x0, Math.min(x1, a.x)), dy = a.y - Math.max(y0, Math.min(y1, a.y));
    if (dx * dx + dy * dy <= a.r * a.r) return true;
  }
  return false;
}

/** Herds by chunk, and herds by hour slot (derived, rebuilt when herds come or go; never saved). */
function indexes(g) {
  const A = g.s.animals;
  if (g._anIdx?.A === A && !g._anIdx.dirty) return g._anIdx;
  const byChunk = new Map(), slots = Array.from({ length: HOUR }, () => []);
  for (const id of Object.keys(A.herds).sort(byId)) {
    const h = A.herds[id], c = chunkOf(g, h.x, h.y);
    if (!byChunk.has(c)) byChunk.set(c, []);
    byChunk.get(c).push(id);
    slots[hash(id) % HOUR].push(id);
  }
  return (g._anIdx = { A, byChunk, slots, dirty: false });
}
const dirty = (g) => { if (g._anIdx) g._anIdx.dirty = true; };

/** Move herd h's centre to (x, y), keeping the chunk index current (its lists stay in id order). */
function setCentre(g, h, x, y) {
  const I = g._anIdx, from = chunkOf(g, h.x, h.y), to = chunkOf(g, x, y);
  h.x = x; h.y = y;
  if (!I || I.dirty || I.A !== g.s.animals || from === to) return;
  const a = I.byChunk.get(from);
  if (a) { const k = a.indexOf(h.id); if (k >= 0) a.splice(k, 1); if (!a.length) I.byChunk.delete(from); }
  if (!I.byChunk.has(to)) I.byChunk.set(to, []);
  const b = I.byChunk.get(to);
  let k = 0;
  while (k < b.length && b[k] < h.id) k++;
  b.splice(k, 0, h.id);
}

/** A tile of the species' ground in chunk c, by hash (12 tries), or null. */
function groundIn(g, d, c, key) {
  const CW = g.CW, cx = c % CW, cy = (c - cx) / CW;
  for (let k = 0; k < 12; k++) {
    const x = cx * CHUNK + Math.floor(draw(`${key}:x${k}`) * CHUNK), y = cy * CHUNK + Math.floor(draw(`${key}:y${k}`) * CHUNK);
    if (!g.inB(x, y)) continue;
    const t = g.terrainAt(x, y);
    if (t.passable && d.terrains.includes(t.id)) return { x, y };
  }
  return null;
}

function newHerd(g, d, x, y, n, day) {
  const A = g.s.animals, id = `h${A.next++}`;
  A.herds[id] = { id, sp: d.id, x, y, n, day, year: Math.floor(day / climateOf(g).yearDays), next: g.s.tick, fed: day };
  dirty(g);
  return A.herds[id];
}

/** Place the first herds (the first tick of a game without `s.animals`). */
function placeHerds(g) {
  const s = g.s, sp = animalSpecies(g), Hb = habitat(g), day = Math.floor(s.tick / TICKS_PER_DAY);
  s.animals = { herds: {}, next: 1 };
  const centres = Object.values(s.settlements || {}).map((v) => v.center).filter(Boolean);
  if (!centres.length && s.center) centres.push(s.center);
  const n = g.CW * g.CH, L = landChunks(g);
  for (let c = 0; c < n; c++) {
    if (g.big && L.comp[c] < 0) continue; // mostly water: a herd there could never move (a classic map has 6 chunks)
    sp.forEach((d, si) => {
      const e = (Hb.counts[si][c] / 1000) * d.density * g._anScale;
      if (e <= 0) return;
      const key = `${s.seed}:herd:${d.id}:${c}`;
      const k = Math.floor(e) + (draw(key) < e - Math.floor(e) ? 1 : 0);
      for (let j = 0; j < k; j++) {
        const at = groundIn(g, d, c, `${key}:${j}`);
        if (!at || centres.some((p) => Math.hypot(p.x - at.x, p.y - at.y) < NEAR_VILLAGE)) continue;
        const [lo, hi] = d.herd;
        newHerd(g, d, at.x, at.y, lo + (hash(`${key}:${j}:n`) % (hi - lo + 1)), day);
      }
    });
  }
}

/** Animals of species `d` in chunk c (all its herds there). */
function inChunk(g, I, c, d) {
  let n = 0;
  for (const id of I.byChunk.get(c) || []) { const h = g.s.animals.herds[id]; if (h && h.sp === d.id) n += h.n; }
  return n;
}

/** Game.tick: place herds on the first tick, then the herds due this tick (one hour slot). */
export function tickAnimals(g) {
  if (!g.s.animals) { if (!animalSpecies(g).length) return; placeHerds(g); }
  tickNear(g);
  const A = g.s.animals, I = indexes(g);
  for (const id of I.slots[g.s.tick % HOUR]) {
    const h = A.herds[id];
    if (!h) continue;
    const d = g.reg.get('animal', h.sp);
    if (!d) continue;
    hourly(g, h, d);
  }
}

function hourly(g, h, d) {
  const s = g.s, day = Math.floor(s.tick / TICKS_PER_DAY);
  if (h.near !== undefined) { syncNear(g, h); if (h.n < 1) { delete h.near; removeHerd(g, h.id); return; } driftAway(g, h); }
  if (h.day !== day) { h.day = day; const before = h.n; daily(g, h, d, day); if (!s.animals.herds[h.id]) { dropAnimals(g, h.id); return; } if (h.near !== undefined && h.n !== before) nearCount(g, h, d, before); }
  if (h.near === undefined && s.tick >= h.next) { move(g, h, d); h.next = s.tick + Math.round(d.moveHours * HOUR); }
}

/** A near herd's count changed in its day (births, losses, a split): animals come or go to match. */
function nearCount(g, h, d, before) {
  const A = g.s.animals, ids = (nearIndex(g).byHerd.get(h.id) || []).filter((id) => A.list?.[id]);
  if (h.n > ids.length) {
    for (let k = ids.length; k < h.n; k++) { const at = spotNear(g, h.x, h.y, 2, `${g.s.seed}:${h.id}:young:${g.s.tick}:${k}`), id = `a${A.na++}`; A.list[id] = { id, herd: h.id, x: at.x, y: at.y, hp: d.health }; }
  } else for (const id of ids.slice(h.n)) delete A.list[id]; // the last ones (by id) go
  nearDirty(g);
  void before;
}

/** A near herd that is gone: its animals go too. */
function dropAnimals(g, hid) {
  const A = g.s.animals;
  for (const id of nearIndex(g).byHerd.get(hid) || []) delete A.list?.[id];
  nearDirty(g);
  if (A.list && !Object.keys(A.list).length) delete A.list;
}

function daily(g, h, d, day) {
  const s = g.s, A = s.animals, key = `${s.seed}:${h.id}:${day}`, season = seasonOf(g), year = Math.floor(day / climateOf(g).yearDays);
  const Hb = habitat(g), si = Hb.index.get(d.id), c = chunkOf(g, h.x, h.y), I = indexes(g);
  if (season === 'Spring' && h.year !== year) { // births, fewer as the chunk fills; a pack breeds only when fed
    h.year = year;
    const hungry = d.diet === 'hunt' && day - h.fed >= Math.floor(d.starveDays ?? 10); // no big prey lately: no cubs
    const cap = ((si === undefined ? 0 : Hb.counts[si][c]) / 1000) * d.cap * g._anScale;
    const room = cap > 0 && !hungry ? Math.max(0, 1 - inChunk(g, I, c, d) / cap) : 0;
    const e = h.n * d.births * room;
    h.n += Math.floor(e) + (draw(`${key}:born`) < e - Math.floor(e) ? 1 : 0);
  }
  if (season === 'Winter') { // three times the loss on poor winter ground (under a fifth of its ground)
    const poor = si !== undefined && Hb.winter[si][c] < 0.2 * Hb.counts[si][c];
    const e = h.n * d.winterLoss * (poor ? 3 : 1);
    h.n -= Math.floor(e) + (draw(`${key}:winter`) < e - Math.floor(e) ? 1 : 0);
  }
  if (d.droughtLoss && droughtAt(g, h.x, h.y)) { // grazers in a drought go thin (and move away: score)
    const e = h.n * d.droughtLoss;
    h.n -= Math.floor(e) + (draw(`${key}:drought`) < e - Math.floor(e) ? 1 : 0);
  }
  if (d.diet === 'hunt') { // a pack eats from a prey herd in its chunk or the next ones
    let prey = null;
    for (const cc of around(g, c, 2)) for (const id of I.byChunk.get(cc) || []) {
      const p = A.herds[id];
      if (p && p !== h && p.near === undefined && h.near === undefined && (d.prey || []).includes(p.sp) && p.n > 0 && (!prey || p.n > prey.n || (p.n === prey.n && p.id < prey.id))) prey = p;
    }
    const starve = Math.floor(d.starveDays ?? 10);
    if (h.near === undefined && prey && draw(`${key}:kill`) < Math.min(0.9, 0.15 * h.n)) { prey.n--; h.fed = day; if (prey.n < 2) removeHerd(g, prey.id); }
    else if (day - h.fed >= starve && h.n > SMALL_GAME) { h.n--; h.fed = day; } // too many for small game alone
    if (h.near === undefined && h.fed !== day) raidDistant(g, h, day, key);
  }
  // Two herds of a species in one chunk that fit in one herd join (the lower id takes the other in).
  for (const id of I.byChunk.get(c) || []) {
    const o = A.herds[id];
    if (!o || o === h || o.sp !== h.sp || o.near !== undefined || h.near !== undefined || o.n + h.n > d.herd[1] || !s.animals.herds[h.id]) continue;
    const [keep, gone] = o.id < h.id ? [o, h] : [h, o];
    keep.n += gone.n; removeHerd(g, gone.id);
    if (gone === h) return;
    break;
  }
  const [, hi] = d.herd;
  if (h.n > hi * 1.5) { // splits: the young ones form a herd of their own nearby
    const at = groundIn(g, d, c, `${key}:split`);
    if (at) { const k = Math.floor(h.n / 2); h.n -= k; newHerd(g, d, at.x, at.y, k, day); }
  }
  if (h.n < 2) removeHerd(g, h.id);
}

/** A hungry far pack within RAID_R of a distant village (lod.js) may maul one of its adults once a day (by hash):
 *  a bite wound, the village marks the pack to hunt. Its people stand round the centre there, so no chase. */
const RAID_R = 20, RAID_CHANCE = 0.3;
function raidDistant(g, h, day, key) {
  const s = g.s;
  for (const sid of Object.keys(s.settlements || {}).sort(byId)) {
    const v = s.settlements[sid];
    if (v.detail !== 'abstract' || v.fallen || !v.center || Math.hypot(v.center.x - h.x, v.center.y - h.y) > RAID_R) continue;
    if (draw(`${key}:raid:${sid}`) >= RAID_CHANCE) continue;
    const adults = g.owned('colonists', sid).filter((c) => !c.health?.down && stageOfP(g, c)?.untilDays === undefined).sort((a, b) => byId(a.id, b.id));
    if (!adults.length) continue;
    const c = adults[Math.floor(draw(`${key}:who:${sid}`) * adults.length)];
    injure(g, c, 'bite', 10 + Math.floor(draw(`${key}:maul:${sid}`) * 16), 'Bitten by a wolf', false, 'info');
    (h.raids ||= {})[sid] = s.tick + 3 * TICKS_PER_DAY;
    g.log(`Wolves attacked ${c.name} near ${v.name}.`, 'info', `wolves:${sid}`, 2400);
    if (c.health?.down) h.fed = day;
    return;
  }
}

function removeHerd(g, id) { delete g.s.animals.herds[id]; dirty(g); }

/** Chunks within r of c (c first, then row by row), in a fixed order. */
function around(g, c, r) {
  const CW = g.CW, CH = g.CH, cx = c % CW, cy = (c - cx) / CW, out = [c];
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if ((x !== cx || y !== cy) && x >= 0 && y >= 0 && x < CW && y < CH) out.push(y * CW + x);
  return out;
}

/** Chunks next to c (8 directions), in a fixed order. */
function neighbours(g, c) {
  const CW = g.CW, CH = g.CH, cx = c % CW, cy = (c - cx) / CW, out = [];
  for (const [dx, dy] of D8) { const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < CW && y < CH) out.push(y * CW + x); }
  return out;
}

/** How good chunk c is for herd h: its ground (in winter mostly its winter ground), less the crowding, much less
 *  with a village there or, for a species that suffers in droughts (droughtLoss), a drought; packs like prey. */
function score(g, I, Hb, h, d, c, villages, winter = false) {
  const si = Hb.index.get(d.id), ground = si === undefined ? 0 : Hb.counts[si][c];
  if (!ground) return -1;
  const cap = (ground / 1000) * d.cap * g._anScale, others = inChunk(g, I, c, d) - (chunkOf(g, h.x, h.y) === c ? h.n : 0);
  let v = (winter ? Hb.winter[si][c] + 0.1 * ground : ground) * Math.max(0.05, 1 - others / Math.max(1, cap));
  if (d.droughtLoss && (c === chunkOf(g, h.x, h.y) ? droughtAt(g, h.x, h.y) : droughtInChunk(g, c))) v *= 0.3; // its own spot, or any of the chunk
  if (villages.has(c)) v *= d.diet === 'hunt' ? 0.5 : 0.2;
  if (d.diet === 'hunt') for (const cc of around(g, c, 2)) for (const id of I.byChunk.get(cc) || []) { const p = g.s.animals.herds[id]; if (p && (d.prey || []).includes(p.sp)) v += (cc === c ? 50 : 15) * p.n; }
  return v;
}

/** Chunks holding a standing village's centre (derived, once a tick). */
function villageChunks(g) {
  if (g._anVil?.tick === g.s.tick) return g._anVil.set;
  const set = new Set();
  for (const v of Object.values(g.s.settlements || {})) if (v.center && !v.fallen) set.add(chunkOf(g, v.center.x, v.center.y));
  g._anVil = { tick: g.s.tick, set };
  return set;
}

function move(g, h, d) {
  const s = g.s, I = indexes(g), Hb = habitat(g), L = landChunks(g), c = chunkOf(g, h.x, h.y);
  const villages = villageChunks(g);
  const winter = seasonOf(g) === 'Winter' && !!d.winterTerrains; // winter moves (slice 6)
  const here = score(g, I, Hb, h, d, c, villages, winter);
  let best = c, bv = here;
  for (const n of neighbours(g, c)) {
    if (L.comp[n] < 0 || L.comp[n] !== L.comp[c]) continue; // its landmass only
    const v = score(g, I, Hb, h, d, n, villages, winter) * (0.95 + 0.1 * draw(`${s.seed}:${h.id}:mv:${s.tick}:${n}`));
    if (v > bv) { bv = v; best = n; }
  }
  if (best === c || bv < here * 1.15 + 1) return;
  const at = groundIn(g, d, best, `${s.seed}:${h.id}:to:${s.tick}`);
  if (!at) return;
  setCentre(g, h, at.x, at.y);
}

// ---------------- near animals (slice 2) ----------------
// A herd whose centre comes within NEAR tiles of a full-detail village (all villages of a classic game) becomes
// individual animals (`s.animals.list`: id -> { id, herd, x, y, hp }), made round its centre by hash; one that has
// been near for NEAR_HOLD ticks and is NEAR + 16 away from all of them folds back into a count (the living ones,
// centred on the one nearest their middle). Checked every NEAR_CHECK ticks. While near, the herd's count is its
// animals; its centre is where they graze, drifting a tile an hour away from a village within 30 tiles (strays
// walk back to it); it does not move by chunks, and births and losses come and go as animals.
// Each animal acts every STEP ticks (staggered by id): grazers flee (the whole herd, for a while) from people and
// predators within their fear ranges, stepping to the free neighbour tile farthest from the danger (their speed in
// tiles), else graze a step now and then near the centre; a pack that has not eaten today chases the nearest prey
// animal within CHASE tiles and bites it (health); a kill feeds the pack. Animals never block tiles; they step only
// onto passable tiles of the region they stand in.
const NEAR = 48, NEAR_CHECK = 600, NEAR_HOLD = 2400, STEP = 10, CELL = 8, CHASE = 20, GRAZE = 5, ALARM = 300;

/** Near animals by herd and by step slot (derived; rebuilt when animals come or go). */
function nearIndex(g) {
  const A = g.s.animals;
  if (g._anNear?.A === A && !g._anNear.dirty) return g._anNear;
  const byHerd = new Map(), slots = Array.from({ length: STEP }, () => []);
  for (const id of Object.keys(A.list || {}).sort(byId)) {
    const a = A.list[id];
    if (!byHerd.has(a.herd)) byHerd.set(a.herd, []);
    byHerd.get(a.herd).push(id);
    slots[hash(id) % STEP].push(id);
  }
  return (g._anNear = { A, byHerd, slots, dirty: false });
}
const nearDirty = (g) => { if (g._anNear) g._anNear.dirty = true; };

/** People and near animals by cell of CELL tiles (derived, once a tick). */
function grids(g) {
  if (g._anGrid?.tick === g.s.tick) return g._anGrid;
  const people = new Map(), beasts = new Map(), key = (x, y) => ((y / CELL) | 0) * 100000 + ((x / CELL) | 0);
  for (const c of Object.values(g.s.colonists)) {
    if (g.s.settlements?.[c.settlementId]?.detail === 'abstract') continue; // their places are stand-ins (lod.js)
    const k = key(c.x, c.y); if (!people.has(k)) people.set(k, []); people.get(k).push(c); }
  for (const a of Object.values(g.s.animals?.list || {})) { const k = key(a.x, a.y); if (!beasts.has(k)) beasts.set(k, []); beasts.get(k).push(a); }
  return (g._anGrid = { tick: g.s.tick, people, beasts, key });
}

/** The nearest thing within r of (x, y) in a grid (people or animals) passing `ok`, by distance then id; or null. */
function nearestIn(G, map, x, y, r, ok) {
  let best = null, bd = Infinity;
  const c0x = ((x - r) / CELL) | 0, c1x = ((x + r) / CELL) | 0, c0y = ((y - r) / CELL) | 0, c1y = ((y + r) / CELL) | 0;
  for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) for (const o of map.get(cy * 100000 + cx) || []) {
    if (!ok(o)) continue;
    const d = Math.hypot(o.x - x, o.y - y);
    if (d <= r && (d < bd || (d === bd && o.id < best.id))) { bd = d; best = o; }
  }
  return best;
}

/** Full-detail village centres (the places that make herds near). */
function anchors(g) {
  const out = [];
  for (const id of Object.keys(g.s.settlements || {}).sort(byId)) { const v = g.s.settlements[id]; if (v.center && !v.fallen && v.detail !== 'abstract') out.push(v.center); }
  if (!out.length && g.s.center) out.push(g.s.center);
  return out;
}

/** A free tile near (x, y) in its region, by hash (8 tries), else (x, y). */
function spotNear(g, x, y, r, key) {
  const reg = g.regionOf(x, y);
  for (let k = 0; k < 8; k++) {
    const nx = x + Math.round((draw(`${key}:${k}x`) * 2 - 1) * r), ny = y + Math.round((draw(`${key}:${k}y`) * 2 - 1) * r);
    if (g.isPassable(nx, ny) && g.regionOf(nx, ny) === reg) return { x: nx, y: ny };
  }
  return { x, y };
}

function expand(g, h, d) {
  const A = g.s.animals;
  A.list ||= {}; A.na ||= 1;
  for (let k = 0; k < h.n; k++) {
    const at = spotNear(g, h.x, h.y, 3, `${g.s.seed}:${h.id}:born:${g.s.tick}:${k}`), id = `a${A.na++}`;
    A.list[id] = { id, herd: h.id, x: at.x, y: at.y, hp: d.health };
  }
  h.near = g.s.tick;
  nearDirty(g);
}

function fold(g, h) {
  const A = g.s.animals, ids = nearIndex(g).byHerd.get(h.id) || [];
  const live = ids.map((id) => A.list[id]).filter(Boolean);
  for (const a of live) delete A.list[a.id];
  delete h.near;
  nearDirty(g);
  h.n = live.length;
  if (live.length) recentre(g, h, live);
  if (h.n < 2) removeHerd(g, h.id);
  if (!Object.keys(A.list || {}).length) delete A.list;
}

/** The herd's centre: the animal nearest the middle of them (a real tile; by id on ties). */
function recentre(g, h, live) {
  const mx = live.reduce((s, a) => s + a.x, 0) / live.length, my = live.reduce((s, a) => s + a.y, 0) / live.length;
  let best = live[0];
  for (const a of live) { const d = Math.hypot(a.x - mx, a.y - my), bd = Math.hypot(best.x - mx, best.y - my); if (d < bd || (d === bd && a.id < best.id)) best = a; }
  setCentre(g, h, best.x, best.y);
}

/** Every NEAR_CHECK ticks: herds come near (become animals) or go far (fold back). */
function checkNear(g) {
  const A = g.s.animals, P = anchors(g);
  for (const id of Object.keys(A.herds).sort(byId)) {
    const h = A.herds[id], d = g.reg.get('animal', h.sp);
    if (!d) continue;
    const dist = Math.min(...P.map((p) => Math.hypot(p.x - h.x, p.y - h.y)));
    if (h.near === undefined && dist <= NEAR) expand(g, h, d);
    else if (h.near !== undefined && dist > NEAR + 16 && g.s.tick - h.near >= NEAR_HOLD) fold(g, h);
  }
}

/** A step of one animal. */
function act(g, a) {
  const s = g.s, A = s.animals, h = A.herds[a.herd], d = h && g.reg.get('animal', h.sp);
  if (!d || h.near === undefined) { delete A.list[a.id]; nearDirty(g); return; } // its herd is gone (never left behind)
  const G = grids(g), key = `${s.seed}:${a.id}:${s.tick}`;
  if (d.diet === 'graze') {
    const fp = d.fear?.people || 0, fw = d.fear?.predators || 0;
    const who = (fp && nearestIn(G, G.people, a.x, a.y, fp, () => true))
      || (fw && nearestIn(G, G.beasts, a.x, a.y, fw, (o) => { const oh = A.list[o.id] && A.herds[o.herd]; return !!oh && (g.reg.get('animal', oh.sp)?.prey || []).includes(h.sp); }));
    if (who) { h.alarm = s.tick + ALARM; h.fx = Math.round(who.x); h.fy = Math.round(who.y); }
    if (h.alarm > s.tick) { for (let k = 0; k < Math.max(1, Math.round(d.speed)); k++) stepAway(g, a, h.fx, h.fy); return; }
    if (draw(key) < 0.3) stepNear(g, a, h.x, h.y, GRAZE, key);
    return;
  }
  // A pack (slice 4: wolves are as dangerous as real ones). It turns on whoever hurt one of it; when it has not
  // eaten today it chases the nearest prey animal, or a person when no prey is near; in winter it takes whichever
  // is the easier catch (a pack that has eaten today leaves people alone). People are picked weakest first (a child, someone alone, someone wounded), never inside a
  // room, and a pack holds back from anyone with 3 or more armed people within 6 tiles.
  const day = Math.floor(s.tick / TICKS_PER_DAY), winter = seasonOf(g) === 'Winter';
  let angry = h.angry && h.angry.until > s.tick ? s.colonists[h.angry.cid] : null;
  if (angry && s.settlements?.[angry.settlementId]?.detail === 'abstract') angry = null; // its place is a stand-in (lod.js)
  if (angry && !angry.health?.down && Math.hypot(angry.x - a.x, angry.y - a.y) <= CHASE * 2) {
    if (armedGroup(g, G, angry).group >= ARMED_GROUP) { delete h.angry; h.alarm = s.tick + ALARM; h.fx = Math.round(angry.x); h.fy = Math.round(angry.y); } // outmatched: the pack breaks off and runs
    else { chasePerson(g, a, h, d, angry, key); return; }
  }
  if (h.alarm > s.tick && h.fx !== undefined) { for (let k = 0; k < Math.max(1, Math.round(d.speed)); k++) stepAway(g, a, h.fx, h.fy); return; }
  if (h.fed !== day) { // a pack that has eaten today leaves people alone (winter or not) unless angry
    const prey = nearestIn(G, G.beasts, a.x, a.y, CHASE, (o) => { const oh = A.list[o.id] && A.herds[o.herd]; return !!oh && (d.prey || []).includes(oh.sp); });
    const person = pickPerson(g, G, a);
    const pd = person ? Math.hypot(person.c.x - a.x, person.c.y - a.y) - person.ease : Infinity, ad = prey ? Math.hypot(prey.x - a.x, prey.y - a.y) : Infinity;
    if (person && (!prey || (winter && pd < ad))) { chasePerson(g, a, h, d, person.c, key); return; }
    if (prey) {
      if (Math.max(Math.abs(prey.x - a.x), Math.abs(prey.y - a.y)) <= 1) bite(g, a, h, prey, key);
      else for (let k = 0; k < Math.max(1, Math.round(d.speed)); k++) stepToward(g, a, prey.x, prey.y);
      return;
    }
  }
  if (draw(key) < 0.3) stepNear(g, a, h.x, h.y, GRAZE, key);
}

const ARMED_GROUP = 3, GROUP_R = 6;
const armed = (g, c) => { const eq = c.equip?.weapon && g.reg.get('item', c.equip.weapon.item)?.equipment; return !!eq?.damage; };

/** People on their feet within GROUP_R of c (c too), and how many of them are armed. */
function armedGroup(g, G, c) {
  let group = 0, near = 0;
  for (let ky = (((c.y - GROUP_R) / CELL) | 0); ky <= (((c.y + GROUP_R) / CELL) | 0); ky++) for (let kx = (((c.x - GROUP_R) / CELL) | 0); kx <= (((c.x + GROUP_R) / CELL) | 0); kx++) {
    for (const o of G.people.get(ky * 100000 + kx) || []) if (Math.hypot(o.x - c.x, o.y - c.y) <= GROUP_R && !o.health?.down) { near++; if (armed(g, o)) group++; }
  }
  return { group, near };
}

/** The person a wolf at a would go for: { c, ease } (ease: how much easier than the distance says), or null. */
function pickPerson(g, G, a) {
  let best = null, bs = Infinity;
  const c0x = ((a.x - CHASE) / CELL) | 0, c1x = ((a.x + CHASE) / CELL) | 0, c0y = ((a.y - CHASE) / CELL) | 0, c1y = ((a.y + CHASE) / CELL) | 0;
  for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) for (const c of G.people.get(cy * 100000 + cx) || []) {
    if (!g.s.colonists[c.id] || c.health?.down) continue;
    const dist = Math.hypot(c.x - a.x, c.y - a.y);
    if (dist > CHASE || roomAt(g, Math.round(c.x), Math.round(c.y))) continue; // safe indoors
    const { group, near } = armedGroup(g, G, c);
    if (group >= ARMED_GROUP) continue; // an armed group: the pack holds back
    const st = stageOfP(g, c);
    const ease = (st && st.untilDays !== undefined ? 6 : 0) + (near <= 1 ? 4 : 0) + (hpOfP(c) < 70 ? 4 : 0);
    const sc = dist - ease;
    if (sc < bs || (sc === bs && c.id < best.c.id)) { bs = sc; best = { c, ease }; }
  }
  return best;
}

/** A wolf closes on a person and bites (a wound: 'bite'). A pack whose victim is down has had its fill and goes. */
function chasePerson(g, a, h, d, c, key) {
  const s = g.s, cx = Math.round(c.x), cy = Math.round(c.y);
  if (Math.max(Math.abs(cx - a.x), Math.abs(cy - a.y)) > 1) { for (let k = 0; k < Math.max(1, Math.round(d.speed)); k++) stepToward(g, a, cx, cy); return; }
  const mine = (c.settlementId || s.playerSettlement) === s.playerSettlement;
  injure(g, c, 'bite', 6 + Math.floor(draw(`${key}:maul`) * 9), 'Bitten by a wolf', false, mine ? 'warn' : 'info');
  if (c.sleeping) { c.sleeping = false; if (c.job?.type === 'sleep') endJob(g, c, null, 'Woken by wolves'); } // a bite wakes anyone
  const sid = c.settlementId || s.playerSettlement;
  (h.raids ||= {})[sid] = s.tick + 3 * TICKS_PER_DAY; // that village will hunt the pack
  g.log(`Wolves attacked ${c.name}!`, mine ? 'warn' : 'info', `wolves:${c.id}`, 600);
  if (c.health?.down) { h.fed = Math.floor(s.tick / TICKS_PER_DAY); delete h.angry; h.alarm = s.tick + ALARM; h.fx = cx; h.fy = cy; }
}

/** A person hurts an animal (fend, hunt): health down; a wolf's pack turns on them. Returns true when it died. */
export function woundAnimal(g, id, dmg, c) {
  const a = g.s.animals?.list?.[id], h = a && g.s.animals.herds[a.herd];
  if (!a) return false;
  a.hp -= dmg;
  const d = h && g.reg.get('animal', h.sp);
  if (d?.diet === 'hunt' && c) h.angry = { cid: c.id, until: g.s.tick + 600 };
  return a.hp <= 0;
}

/** Is the pack of near animal a a danger to people now (hungry or angry)? */
export function packThreat(g, a) {
  const h = g.s.animals?.herds[a?.herd];
  return !!h && (h.fed !== Math.floor(g.s.tick / TICKS_PER_DAY) || (h.angry && h.angry.until > g.s.tick));
}

/** Ids of the herds that are near (individual animals), in id order. */
export const nearHerdIds = (g) => (g.s.animals?.list ? [...nearIndex(g).byHerd.keys()].sort(byId) : []);

/** The nearest wolf (an animal of a hunting species) within r of (x, y), or null. */
export function wolfNear(g, x, y, r) {
  if (!g.s.animals?.list) return null;
  const G = grids(g), A = g.s.animals;
  return nearestIn(G, G.beasts, x, y, r, (o) => { const oh = A.list[o.id] && A.herds[o.herd]; return !!oh && g.reg.get('animal', oh.sp)?.diet === 'hunt'; });
}

function bite(g, a, pack, prey, key) {
  const A = g.s.animals, ph = A.herds[prey.herd];
  if (!A.list?.[prey.id] || prey.hp <= 0) return; // already killed this tick (the grid is the tick's start)
  prey.hp -= 10 + Math.floor(draw(`${key}:bite`) * 10);
  if (ph) { ph.alarm = g.s.tick + ALARM; ph.fx = a.x; ph.fy = a.y; }
  if (prey.hp > 0) return;
  delete A.list[prey.id];
  nearDirty(g);
  if (ph) { ph.n--; if (ph.n < 1) { delete ph.near; removeHerd(g, ph.id); } }
  pack.fed = Math.floor(g.s.tick / TICKS_PER_DAY);
}

const free = (g, a, x, y) => g.isPassable(x, y) && g.regionOf(x, y) === g.regionOf(a.x, a.y);
function stepAway(g, a, fx, fy) {
  let best = null, bd = Math.hypot(a.x - fx, a.y - fy);
  for (const [dx, dy] of D8) { const x = a.x + dx, y = a.y + dy, dd = Math.hypot(x - fx, y - fy); if (dd > bd && free(g, a, x, y)) { bd = dd; best = [x, y]; } }
  if (best) { a.x = best[0]; a.y = best[1]; }
}
function stepToward(g, a, tx, ty) {
  let best = null, bd = Math.hypot(a.x - tx, a.y - ty);
  for (const [dx, dy] of D8) { const x = a.x + dx, y = a.y + dy, dd = Math.hypot(x - tx, y - ty); if (dd < bd && free(g, a, x, y)) { bd = dd; best = [x, y]; } }
  if (best) { a.x = best[0]; a.y = best[1]; }
}
function stepNear(g, a, cx, cy, r, key) {
  if (Math.hypot(a.x - cx, a.y - cy) > r) { stepToward(g, a, cx, cy); return; } // back to the herd
  const [dx, dy] = D8[Math.floor(draw(`${key}:dir`) * 8) % 8], x = a.x + dx, y = a.y + dy;
  if (Math.hypot(x - cx, y - cy) <= r && free(g, a, x, y)) { a.x = x; a.y = y; }
}

/** Game.tick (from tickAnimals): the near check and the animals due this tick. */
function tickNear(g) {
  if (g.s.tick % NEAR_CHECK === 450) checkNear(g);
  const A = g.s.animals;
  if (!A.list) return;
  const N = nearIndex(g);
  for (const id of N.slots[g.s.tick % STEP]) if (A.list?.[id]) act(g, A.list[id]);
}

/** A near herd's grazing centre drifts a tile an hour away from a village within DRIFT tiles (people disturb
 *  them), so herds do not settle round villages for good; the animals follow as they graze. */
const DRIFT = 30;
function driftAway(g, h) {
  let p = null, pd = Infinity;
  for (const c of anchors(g)) { const d = Math.hypot(c.x - h.x, c.y - h.y); if (d < pd) { pd = d; p = c; } }
  if (!p || pd > DRIFT) return;
  let best = null, bd = pd;
  for (const [dx, dy] of D8) { const x = h.x + dx, y = h.y + dy, d = Math.hypot(x - p.x, y - p.y); if (d > bd && g.isPassable(x, y)) { bd = d; best = [x, y]; } }
  if (best) setCentre(g, h, best[0], best[1]);
}

/** Near herds: their count and centre from their animals (hourly, before the herd's own hour). */
function syncNear(g, h) {
  const ids = nearIndex(g).byHerd.get(h.id) || [];
  h.n = ids.filter((id) => g.s.animals.list?.[id]).length; // the centre is where they graze (it drifts; fold recentres)
}

// ---------------- for hunting (slice 3) ----------------
export const HUNT_LIMIT = 3; // villages leave every herd at least this many (the owner's answer 5)
export const MEAT_PER_PERSON = 2; // a village hunts while it has less meat than this a person

/** Meat on hand for the village of plan P (meat items and carcasses, a carcass counted as 6). */
export function meatOnHand(g, P) {
  let n = 0;
  for (const [it, q] of Object.entries(P?.stock || {})) {
    const d = g.reg.get('item', it);
    if (d?.tags?.includes('core:meat')) n += q;
    else if (d?.tags?.includes('core:carcass')) n += 6 * q;
  }
  return n;
}

/** The live animals of a near herd, in id order. */
export function herdAnimals(g, hid) {
  const A = g.s.animals;
  return (nearIndex(g).byHerd.get(hid) || []).map((id) => A.list?.[id]).filter(Boolean);
}

/** An animal is killed (by a hunter): it leaves the herd, the herd runs. Returns the herd (or null). */
export function killAnimal(g, id, fx, fy) {
  const A = g.s.animals, a = A.list?.[id];
  if (!a) return null;
  delete A.list[id];
  nearDirty(g);
  const h = A.herds[a.herd];
  if (h) { h.n--; h.alarm = g.s.tick + ALARM; h.fx = Math.round(fx); h.fy = Math.round(fy); if (h.n < 1) { delete h.near; removeHerd(g, h.id); } }
  if (!Object.keys(A.list).length) delete A.list;
  return h;
}

/** A wounded animal: its herd runs from (fx, fy). */
export function alarmHerd(g, hid, fx, fy) {
  const h = g.s.animals?.herds[hid];
  if (h) { h.alarm = g.s.tick + ALARM; h.fx = Math.round(fx); h.fy = Math.round(fy); }
}

/** Herds whose centre may be within r of (x, y): those in the chunks the square round it touches (callers check
 *  the distance and sort, so the order here does not matter). */
function herdsWithin(g, x, y, r) {
  const A = g.s.animals;
  if (!A?.herds) return [];
  const I = indexes(g), out = [];
  const c0x = Math.max(0, Math.floor((x - r) / CHUNK)), c1x = Math.min(g.CW - 1, Math.floor((x + r) / CHUNK));
  const c0y = Math.max(0, Math.floor((y - r) / CHUNK)), c1y = Math.min(g.CH - 1, Math.floor((y + r) / CHUNK));
  for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) for (const id of I.byChunk.get(cy * g.CW + cx) || []) if (A.herds[id]) out.push(A.herds[id]);
  return out;
}

/** Near herds a village may hunt: grazers with a carcass, above the hunting limit, within `r` of (x, y), nearest
 *  first (then by id). */
export function huntableNear(g, x, y, r) {
  const out = [];
  for (const h of herdsWithin(g, x, y, r)) {
    if (h.near === undefined || h.n <= HUNT_LIMIT) continue;
    const d = g.reg.get('animal', h.sp);
    if (!d?.carcass || d.diet !== 'graze') continue;
    const dist = Math.hypot(h.x - x, h.y - y);
    if (dist <= r) out.push({ h, d, dist });
  }
  return out.sort((a, b) => a.dist - b.dist || (a.h.id < b.h.id ? -1 : 1));
}

/** Far herds a distant village may hunt (lod.js): packs that attacked village `sid` first (no limit), then grazers
 *  with a carcass above the hunting limit, within r of (x, y), nearest first (then by id). */
export function farHuntable(g, x, y, r, sid = null) {
  const out = [];
  for (const h of herdsWithin(g, x, y, r)) {
    if (h.near !== undefined) continue;
    const d = g.reg.get('animal', h.sp);
    const raid = d?.diet === 'hunt' && sid && h.raids?.[sid] > g.s.tick;
    if (!d?.carcass || (!raid && (d.diet !== 'graze' || h.n <= HUNT_LIMIT))) continue;
    const dist = Math.hypot(h.x - x, h.y - y);
    if (dist <= r) out.push({ h, d, dist, raid });
  }
  return out.sort((a, b) => b.raid - a.raid || a.dist - b.dist || (a.h.id < b.h.id ? -1 : 1)); // packs that raided first
}

/** One animal of far herd hid is killed (a distant village's hunt). */
export function killFar(g, hid) {
  const h = g.s.animals?.herds[hid];
  if (!h || h.near !== undefined) return;
  h.n--;
  if (h.n < 2) removeHerd(g, hid);
}

/** For tests: fold a near herd back into a count now. */
export const foldHerdForTest = (g, id) => fold(g, g.s.animals.herds[id]);

/** Herd totals by species (for reports and tests). */
export function herdCensus(g) {
  const out = {};
  for (const h of Object.values(g.s.animals?.herds || {})) { out[h.sp] ||= { herds: 0, animals: 0 }; out[h.sp].herds++; out[h.sp].animals += h.n; }
  return out;
}
