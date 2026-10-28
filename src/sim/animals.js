// Wild animals (Phase 8, slice 1: species and far herds; docs/proposals/phase-8-animals.md).
// Species are data (content type `animal`). Every game has them unless its scenario lists none
// (`scenario.animals: { species: [] }`). State: `s.animals` = { herds: id -> herd, next } (save format 27):
// a herd is { id, sp, x, y, n, day, year, next, fed }: its species, a centre tile, how many, the day and year it
// was last updated and last bred, the tick it may next move, and (packs) the day it last ate.
// - Placing: at the first tick of a game (or of an older save) each chunk gets herds of each species by the share
//   of its tiles that are the species' ground (density: herds per 1,000 such tiles), never within 24 tiles of a
//   village; positions and sizes are hash draws, so the world and the game's random stream are as before.
// - Every herd once an hour (staggered by id): once a day, births (once a year in spring, fewer as its chunk
//   fills: cap animals per 1,000 tiles of its ground), winter losses, packs eating deer or horses within 2 chunks
//   (a pack that has not eaten for starveDays loses one: they live on small game a while), a herd above 1.5 x its
//   largest size splits, two of a species in one chunk that fit in one herd merge, one below 2 fades; at most every moveHours it moves one chunk toward better ground (more of its ground, less
//   crowded, away from villages; packs toward prey), never off its landmass.
// Draws are hashes of (seed, herd, day or tick). Cost: one pass over the map when herds are placed or the map
// changes (derived counts per chunk), then O(herds / 100) a tick.
import { TICKS_PER_DAY, CHUNK } from './constants.js';
import { seasonOf, climateOf } from './heat.js';
import { landChunks } from './contact.js';

const HOUR = 100, NEAR_VILLAGE = 24, D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
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
  const key = `${g.s.map.rev || 0}:${g.W}x${g.H}`;
  if (g._anHab?.key === key) return g._anHab;
  const sp = animalSpecies(g), pal = g.terrainPalette, ts = g._ts.idx, W = g.W, H = g.H, CW = g.CW, n = CW * g.CH;
  const masks = new Uint32Array(pal.length);
  for (let k = 0; k < pal.length; k++) sp.forEach((d, s) => { if (d.terrains.includes(pal[k])) masks[k] |= 1 << s; });
  const counts = sp.map(() => new Int32Array(n));
  for (let y = 0; y < H; y++) {
    const cy = (y / CHUNK) | 0;
    for (let x = 0; x < W; x++) {
      const m = masks[ts[y * W + x]];
      if (!m) continue;
      const c = cy * CW + ((x / CHUNK) | 0);
      for (let s = 0; s < sp.length; s++) if (m & (1 << s)) counts[s][c]++;
    }
  }
  return (g._anHab = { key, counts, index: new Map(sp.map((d, s) => [d.id, s])) });
}

const chunkOf = (g, x, y) => ((y / CHUNK) | 0) * g.CW + ((x / CHUNK) | 0);

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
  const n = g.CW * g.CH;
  for (let c = 0; c < n; c++) {
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
  if (h.day !== day) { h.day = day; daily(g, h, d, day); if (!s.animals.herds[h.id]) return; }
  if (s.tick >= h.next) { move(g, h, d); h.next = s.tick + Math.round(d.moveHours * HOUR); }
}

function daily(g, h, d, day) {
  const s = g.s, A = s.animals, key = `${s.seed}:${h.id}:${day}`, season = seasonOf(g), year = Math.floor(day / climateOf(g).yearDays);
  const Hb = habitat(g), si = Hb.index.get(d.id), c = chunkOf(g, h.x, h.y), I = indexes(g);
  if (season === 'Spring' && h.year !== year) { // births, fewer as the chunk fills
    h.year = year;
    const cap = ((si === undefined ? 0 : Hb.counts[si][c]) / 1000) * d.cap * g._anScale;
    const room = cap > 0 ? Math.max(0, 1 - inChunk(g, I, c, d) / cap) : 0;
    const e = h.n * d.births * room;
    h.n += Math.floor(e) + (draw(`${key}:born`) < e - Math.floor(e) ? 1 : 0);
  }
  if (season === 'Winter') {
    const e = h.n * d.winterLoss;
    h.n -= Math.floor(e) + (draw(`${key}:winter`) < e - Math.floor(e) ? 1 : 0);
  }
  if (d.diet === 'hunt') { // a pack eats from a prey herd in its chunk or the next ones
    let prey = null;
    for (const cc of around(g, c, 2)) for (const id of I.byChunk.get(cc) || []) {
      const p = A.herds[id];
      if (p && p !== h && (d.prey || []).includes(p.sp) && p.n > 0 && (!prey || p.n > prey.n || (p.n === prey.n && p.id < prey.id))) prey = p;
    }
    if (prey && draw(`${key}:kill`) < Math.min(0.9, 0.15 * h.n)) { prey.n--; h.fed = day; if (prey.n < 2) removeHerd(g, prey.id); }
    else if (day - (h.fed ?? day) >= (d.starveDays ?? 10)) { h.n--; h.fed = day; }
  }
  // Two herds of a species in one chunk that fit in one herd join (the lower id takes the other in).
  for (const id of I.byChunk.get(c) || []) {
    const o = A.herds[id];
    if (!o || o === h || o.sp !== h.sp || o.n + h.n > d.herd[1] || !s.animals.herds[h.id]) continue;
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

/** How good chunk c is for herd h: its ground, less the crowding, much less with a village there; packs like prey. */
function score(g, I, Hb, h, d, c, villages) {
  const si = Hb.index.get(d.id), ground = si === undefined ? 0 : Hb.counts[si][c];
  if (!ground) return -1;
  const cap = (ground / 1000) * d.cap * g._anScale, others = inChunk(g, I, c, d) - (chunkOf(g, h.x, h.y) === c ? h.n : 0);
  let v = ground * Math.max(0.05, 1 - others / Math.max(1, cap));
  if (villages.has(c)) v *= d.diet === 'hunt' ? 0.5 : 0.2;
  if (d.diet === 'hunt') for (const id of I.byChunk.get(c) || []) { const p = g.s.animals.herds[id]; if (p && (d.prey || []).includes(p.sp)) v += 50 * p.n; }
  return v;
}

function move(g, h, d) {
  const s = g.s, I = indexes(g), Hb = habitat(g), L = landChunks(g), c = chunkOf(g, h.x, h.y);
  const villages = new Set();
  for (const v of Object.values(s.settlements || {})) if (v.center && !v.fallen) villages.add(chunkOf(g, v.center.x, v.center.y));
  const here = score(g, I, Hb, h, d, c, villages);
  let best = c, bv = here;
  for (const n of neighbours(g, c)) {
    if (L.comp[n] < 0 || L.comp[n] !== L.comp[c]) continue; // its landmass only
    const v = score(g, I, Hb, h, d, n, villages) * (0.95 + 0.1 * draw(`${s.seed}:${h.id}:mv:${s.tick}:${n}`));
    if (v > bv) { bv = v; best = n; }
  }
  if (best === c || bv < here * 1.15 + 1) return;
  const at = groundIn(g, d, best, `${s.seed}:${h.id}:to:${s.tick}`);
  if (!at) return;
  h.x = at.x; h.y = at.y;
  dirty(g);
}

/** Herd totals by species (for reports and tests). */
export function herdCensus(g) {
  const out = {};
  for (const h of Object.values(g.s.animals?.herds || {})) { out[h.sp] ||= { herds: 0, animals: 0 }; out[h.sp].herds++; out[h.sp].animals += h.n; }
  return out;
}
