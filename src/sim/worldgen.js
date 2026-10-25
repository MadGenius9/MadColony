// Data-driven world generation: terrain from noise, then spawn rules place resource nodes.
// Two generators share the spawn rules:
// - the classic one (one noise layer cut into `layers`), used by every world without `biomes`; it is kept
//   exactly as it was so existing seeds produce the same worlds;
// - the biome one (`biomes` in the worldgen data): elevation, moisture and cold fields picked by data rules,
//   ocean round the edges, rivers traced downhill, and land behind mountain walls joined by passes.
// A third, the planet generator (`planet` in the worldgen data, Phase 2b), has its own terrain and node
// rules: plates and continents, climate bands, drainage-basin rivers (see planetWorld below).
import { makeNoise } from './rng.js';

/** New-world size presets (new colonies only; existing saves keep their map). Huge and Colossal are for
 *  the big-world work (Phase 1): they need the biome generator and the world view to be playable. */
export const WORLD_SIZES = {
  small: { name: 'Small', w: 72, h: 52 },
  medium: { name: 'Medium', w: 128, h: 96 },
  large: { name: 'Large', w: 192, h: 144 },
  huge: { name: 'Huge', w: 384, h: 288 },
  colossal: { name: 'Colossal', w: 544, h: 408 },
  // Phase 2b: whole planets. `worldgen` is the generator these sizes are made with unless one is asked for.
  vast: { name: 'Vast', w: 1536, h: 1152, worldgen: 'core:planet' },
  world: { name: 'World', w: 2048, h: 1536, worldgen: 'core:planet' },
};

export function generateWorld(reg, s, rng, wg) {
  const W = wg.width, H = wg.height;
  s.map = { w: W, h: H, terrain: new Array(W * H) };
  if (wg.planet) return planetWorld(reg, s, rng, wg); // its own terrain and nodes (planet.json)
  const start = wg.biomes ? biomeTerrain(reg, s, rng, wg) : classicTerrain(reg, s, rng, wg);
  spawnNodes(reg, s, rng, start.cx, start.cy, wg.id);
  return start;
}

function classicTerrain(reg, s, rng, wg) {
  const W = wg.width, H = wg.height;
  const noise = makeNoise(rng.int(1e9));
  const cx = W >> 1, cy = H >> 1;
  const startTerrain = wg.startTerrain || wg.layers.find((l) => reg.get('terrain', l.terrain).buildable)?.terrain;
  const clearR = wg.startClearRadius ?? 6;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let n = noise(x / wg.noiseScale, y / wg.noiseScale);
      // gentle bias so the start area tends toward open land
      const d = Math.hypot(x - cx, y - cy);
      if (d < clearR + 6) n = n * 0.6 + 0.45 * 0.4;
      let t = wg.layers[wg.layers.length - 1].terrain;
      for (const l of wg.layers) if (n < l.below) { t = l.terrain; break; }
      if (d <= clearR) t = startTerrain;
      s.map.terrain[y * W + x] = t;
    }
  }
  return { cx, cy };
}

function spawnNodes(reg, s, rng, cx, cy, wgId) {
  const W = s.map.w, H = s.map.h;
  const occupied = new Uint8Array(W * H);
  for (const rule of reg.all('spawnRule')) {
    if (rule.worldgen && !rule.worldgen.includes(wgId)) continue; // a rule for other worlds draws no random numbers here
    const nd = reg.get('node', rule.node);
    const rnoise = rule.noiseScale ? makeNoise(rng.int(1e9)) : null;
    const allowed = new Set(rule.terrain);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (occupied[i] || !allowed.has(s.map.terrain[i])) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d < (rule.minDistFromStart ?? 0)) continue;
        if (rule.maxDistFromStart && d > rule.maxDistFromStart) continue;
        if (rnoise && rnoise(x / rule.noiseScale, y / rule.noiseScale) < (rule.noiseAbove ?? 0.5)) continue;
        if (!rng.chance(rule.density)) continue;
        const id = 'n' + s.nextId++;
        s.nodes[id] = { id, def: nd.id, x, y, chunks: nd.chunks };
        occupied[i] = 1;
      }
    }
  }
}

/** Each value replaced by its rank share (0..1), so data thresholds read as "the lowest 30% of tiles".
 *  Ranks order by value, then by index. Sorted natively as 64-bit keys (the value's bits made to sort as
 *  numbers, then the index), with no comparator: the same order as comparing (a[p] - a[q] || p - q). */
function toQuantiles(a) {
  const n = a.length;
  const out = new Float32Array(n);
  const keys = rankKeys(a);
  if (keys) {
    const lo = new Uint32Array(keys.buffer);
    for (let r = 0; r < n; r++) out[lo[2 * r]] = r / (n - 1 || 1);
    return out;
  }
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((p, q) => a[p] - a[q] || p - q);
  for (let r = 0; r < n; r++) out[idx[r]] = r / (n - 1 || 1);
  return out;
}
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
/** Sorted keys (high word: the Float32 value's bits turned to sort as unsigned numbers, -0 as +0; low word:
 *  the index), or null where that cannot match the comparator (NaN values, big-endian machines). */
function rankKeys(a) {
  if (!LITTLE_ENDIAN || !(a instanceof Float32Array) || a.length >= 2 ** 32) return null;
  const n = a.length, keys = new BigUint64Array(n), w = new Uint32Array(keys.buffer);
  const bits = new Uint32Array(a.buffer, a.byteOffset, n);
  for (let i = 0; i < n; i++) {
    const v = a[i];
    if (v !== v) return null;
    const u = v === 0 ? 0 : bits[i];
    w[2 * i] = i;
    w[2 * i + 1] = u & 0x80000000 ? ~u >>> 0 : (u | 0x80000000) >>> 0;
  }
  keys.sort();
  return keys;
}

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function biomeTerrain(reg, s, rng, wg) {
  const W = wg.width, H = wg.height, N = W * H, B = wg.biomes;
  const elevN = makeNoise(rng.int(1e9)), moistN = makeNoise(rng.int(1e9)), detailN = makeNoise(rng.int(1e9));
  const es = B.elevationScale ?? 64, ms = B.moistureScale ?? 40;
  const rawE = new Float32Array(N), rawM = new Float32Array(N), rawC = new Float32Array(N);
  const edge = B.edgeFalloff ?? 0.35, band = Math.max(4, Math.min(W, H) * (B.edgeWidth ?? 0.16));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let e = elevN(x / es, y / es) * 0.8 + detailN(x / (es / 4), y / (es / 4)) * 0.2;
    const dEdge = Math.min(x, y, W - 1 - x, H - 1 - y);
    if (dEdge < band) e -= edge * (1 - dEdge / band) ** 2; // ocean round the edges
    rawE[i] = e;
    rawM[i] = moistN(x / ms, y / ms);
    rawC[i] = (1 - y / (H - 1)) * 0.75 + e * 0.25; // the north and the heights are colder
  }
  const E = toQuantiles(rawE), M = toQuantiles(rawM), C = toQuantiles(rawC);
  const T = s.map.terrain;
  const pick = (i) => {
    for (const r of B.rules) {
      if (r.elevationBelow !== undefined && !(E[i] < r.elevationBelow)) continue;
      if (r.elevationAbove !== undefined && !(E[i] >= r.elevationAbove)) continue;
      if (r.moistureAbove !== undefined && !(M[i] >= r.moistureAbove)) continue;
      if (r.moistureBelow !== undefined && !(M[i] < r.moistureBelow)) continue;
      if (r.coldAbove !== undefined && !(C[i] >= r.coldAbove)) continue;
      return r.terrain;
    }
    return B.rules[B.rules.length - 1].terrain;
  };
  for (let i = 0; i < N; i++) T[i] = pick(i);
  const passable = (i) => reg.get('terrain', T[i])?.passable;
  const isWater = (i) => { const t = reg.get('terrain', T[i]); return !t.passable && t.drinkable; };

  // Rivers: from high ground, step to the lowest neighbour not yet river (carving through basins) until water.
  const R = B.rivers;
  if (R && R.count > 0) {
    const cands = [];
    for (let i = 0; i < N; i++) if (E[i] >= (R.sourceAbove ?? 0.8) && !isWater(i)) cands.push(i);
    rng.shuffle(cands);
    const sources = [];
    for (const i of cands) {
      if (sources.length >= R.count) break;
      const x = i % W, y = (i / W) | 0;
      if (sources.every((j) => Math.hypot(x - (j % W), y - ((j / W) | 0)) >= (R.spacing ?? 24))) sources.push(i);
    }
    const river = new Uint8Array(N);
    for (const src of sources) {
      let cur = src;
      for (let step = 0; step < (R.maxLength ?? 600); step++) {
        if (isWater(cur)) break;
        river[cur] = 1;
        const x = cur % W, y = (cur / W) | 0;
        let best = -1;
        for (const [dx, dy] of N4) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (river[j] && !isWater(j)) continue;
          if (best < 0 || E[j] < E[best] || (E[j] === E[best] && j < best)) best = j;
        }
        if (best < 0) break;
        cur = best;
      }
    }
    for (let i = 0; i < N; i++) if (river[i] && !isWater(i)) T[i] = R.terrain;
  }

  // Join land shut in by impassable ground (not by water) to the main land with a pass.
  const passTerrain = B.passTerrain || B.rules.find((r) => reg.get('terrain', r.terrain)?.passable && reg.get('terrain', r.terrain)?.buildable)?.terrain;
  const comp = new Int32Array(N).fill(-1);
  const sizes = [];
  for (let i = 0; i < N; i++) {
    if (comp[i] >= 0 || !passable(i)) continue;
    const id = sizes.length; let n = 0; const q = [i]; comp[i] = id;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], x = c % W, y = (c / W) | 0; n++;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (comp[j] < 0 && passable(j)) { comp[j] = id; q.push(j); }
      }
    }
    sizes.push(n);
  }
  let main = sizes.length ? 0 : -1; // the first largest area (as sizes.indexOf(Math.max(...sizes)))
  for (let id = 1; id < sizes.length; id++) if (sizes[id] > sizes[main]) main = id;
  // Each pocket in id order: breadth-first through impassable dry ground from its tiles (in index order) to
  // the main land; the way found is carved and the pocket joins the main land. One pass lists every pocket's
  // tiles, and the search buffers are shared (reset only where a search went), so the cost follows the
  // ground searched, not the map size times the number of pockets.
  const start = new Int32Array(sizes.length + 1);
  for (let id = 0; id < sizes.length; id++) start[id + 1] = start[id] + (id === main ? 0 : sizes[id]);
  const tiles = new Int32Array(start[sizes.length]), fill = start.slice(0, sizes.length);
  for (let i = 0; i < N; i++) { const c = comp[i]; if (c >= 0 && c !== main) tiles[fill[c]++] = i; }
  const from = new Int32Array(N).fill(-2);
  const q = [];
  for (let id = 0; id < sizes.length; id++) {
    if (id === main) continue;
    q.length = 0;
    for (let k = start[id]; k < start[id + 1]; k++) { from[tiles[k]] = -1; q.push(tiles[k]); }
    let hit = -1;
    for (let h = 0; h < q.length && hit < 0; h++) {
      const c = q[h], x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (from[j] !== -2) continue;
        if (comp[j] === main) { hit = c; break; }
        if (passable(j) || isWater(j)) continue; // only through mountains: islands stay islands
        from[j] = c; q.push(j);
      }
    }
    for (let c = hit; c >= 0 && from[c] !== -1; c = from[c]) T[c] = passTerrain;
    if (hit >= 0) for (let k = start[id]; k < start[id + 1]; k++) comp[tiles[k]] = main;
    for (const c of q) from[c] = -2; // every tile the search marked is in q
  }

  // Start: the first spot spiralling out from the centre with open, buildable main land all round.
  const st = B.start || {};
  const okStart = new Set(st.terrain || [wg.startTerrain || 'core:grass']);
  const rr = st.areaRadius ?? 7;
  const good = (x, y) => {
    if (!okStart.has(T[y * W + x])) return false;
    for (let yy = y - rr; yy <= y + rr; yy++) for (let xx = x - rr; xx <= x + rr; xx++) {
      if (xx < 1 || yy < 1 || xx >= W - 1 || yy >= H - 1) return false;
      const j = yy * W + xx, t = reg.get('terrain', T[j]);
      if (!t.passable || !t.buildable || comp[j] !== main) return false;
    }
    return true;
  };
  let cx = W >> 1, cy = H >> 1, found = false;
  for (let r = 0; r < Math.max(W, H) && !found; r++) {
    for (let dy = -r; dy <= r && !found; dy++) for (let dx = -r; dx <= r && !found; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = (W >> 1) + dx, y = (H >> 1) + dy;
      if (x >= 0 && y >= 0 && x < W && y < H && good(x, y)) { cx = x; cy = y; found = true; }
    }
  }
  const startTerrain = wg.startTerrain || [...okStart][0];
  const clearR = wg.startClearRadius ?? 6;
  for (let y = cy - clearR; y <= cy + clearR; y++) for (let x = cx - clearR; x <= cx + clearR; x++) {
    if (x >= 0 && y >= 0 && x < W && y < H && Math.hypot(x - cx, y - cy) <= clearR) T[y * W + x] = startTerrain;
  }
  s.map.land = { main: true }; // marker: generated with biomes (the main landmass is connected)
  return { cx, cy };
}

// ---------------------------------------------------------------------------------------------------------
// Planet generator (Phase 2b, `planet` in the worldgen data, mods/core/content/planet.json).
// Fields are typed arrays, one value per tile; no per-tile objects. Steps:
//  1. elevation: domain-warped plates (continental or oceanic), continent-shape and detail noise, ridged
//     mountain ranges along converging plate edges, ocean at the map edges; the lowest `oceanShare` of the
//     tiles is sea;
//  2. coasts: distance to the sea over land (moisture, beaches) and over water (shallow coastal water);
//  3. climate: temperature from latitude and height, moisture from the sea, latitude belts and noise;
//  4. drainage: a priority flood from the sea gives every land tile a downhill way to the sea; deep filled
//     basins become lakes; rain gathered down the flow makes rivers where enough has collected, so rivers
//     run unbroken from the hills to the sea and join into river systems;
//  5. biomes: the first data rule matching a tile's height, temperature, moisture and coast distance;
//  6. land walled in by mountains is joined to its landmass by a pass; the start is a good spot near the
//     middle of the largest landmass;
//  7. nodes: per-terrain data rules, scaled down to stay within a node budget per tile.
// Only arithmetic and Math.sqrt/floor/abs/round are used for the fields (exactly specified in every engine).

/** Value noise sampled on a coarse grid and read back bilinearly: for low-frequency fields, where the
 *  grid step is a small fraction of the noise scale, the result is smooth and much cheaper. */
function coarseNoise(noise, scale, W, H) {
  const step = Math.max(1, Math.min(8, Math.floor(scale / 16)));
  const GW = Math.floor((W - 1) / step) + 2, GH = Math.floor((H - 1) / step) + 2;
  const g = new Float32Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) g[gy * GW + gx] = noise((gx * step) / scale, (gy * step) / scale);
  return (x, y) => {
    const fx = x / step, fy = y / step, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const i = y0 * GW + x0, a = g[i], b = g[i + 1], c = g[i + GW], d = g[i + GW + 1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

/** Breadth-first distance (4-neighbour steps) from every tile with mask[i] === from into the tiles with the
 *  other value, up to `cap` steps; unreached tiles keep 65535. */
function distField(W, H, mask, from, cap = 65534) {
  const N = W * H, d = new Uint16Array(N).fill(65535), q = new Int32Array(N);
  let qt = 0;
  for (let i = 0; i < N; i++) if (mask[i] === from) { d[i] = 0; q[qt++] = i; }
  for (let qh = 0; qh < qt; qh++) {
    const c = q[qh], nd = d[c] + 1;
    if (nd > cap) continue;
    const x = c % W;
    for (let k = 0; k < 4; k++) {
      const j = nb4(c, x, W, N, k);
      if (j >= 0 && mask[j] !== from && d[j] === 65535) { d[j] = nd; q[qt++] = j; }
    }
  }
  return d;
}

/** 4-connected components of the tiles with mask[i]: { comp (Int32, -1 outside), sizes }, ids in index order. */
function components(W, H, mask) {
  const N = W * H, comp = new Int32Array(N).fill(-1), q = new Int32Array(N), sizes = [];
  for (let i = 0; i < N; i++) {
    if (comp[i] >= 0 || !mask[i]) continue;
    const id = sizes.length;
    let qt = 0; q[qt++] = i; comp[i] = id;
    for (let qh = 0; qh < qt; qh++) {
      const c = q[qh], x = c % W;
      if (x > 0 && mask[c - 1] && comp[c - 1] < 0) { comp[c - 1] = id; q[qt++] = c - 1; }
      if (x < W - 1 && mask[c + 1] && comp[c + 1] < 0) { comp[c + 1] = id; q[qt++] = c + 1; }
      if (c >= W && mask[c - W] && comp[c - W] < 0) { comp[c - W] = id; q[qt++] = c - W; }
      if (c < N - W && mask[c + W] && comp[c + W] < 0) { comp[c + W] = id; q[qt++] = c + W; }
    }
    sizes.push(qt);
  }
  return { comp, sizes };
}

/** The 4 neighbours of tile c (x = c % W) as indexes, -1 off the map: left, right, up, down. */
function nb4(c, x, W, N, d) {
  if (d === 0) return x === 0 ? -1 : c - 1;
  if (d === 1) return x === W - 1 ? -1 : c + 1;
  if (d === 2) return c < W ? -1 : c - W;
  return c >= N - W ? -1 : c + W;
}

const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function planetWorld(reg, s, rng, wg) {
  const W = wg.width, H = wg.height, N = W * H, P = wg.planet;
  const S = Math.sqrt(N); // the map's scale: continent-sized features are fractions of it
  // The terrain palette: every terrain the data names (an index per tile fits a byte).
  const pal = [], palIdx = new Map();
  const tIdx = (id) => {
    let k = palIdx.get(id);
    if (k === undefined) {
      if (pal.length >= 255) throw new Error(`Planet ${wg.id}: more than 255 terrains.`);
      k = pal.length; pal.push(id); palIdx.set(id, k);
    }
    return k;
  };
  const tt = P.terrain, rv = P.rivers, st = P.start;
  const tDeep = tIdx(tt.ocean), tShallow = tIdx(tt.shallow), tLake = tIdx(tt.lake), tMount = tIdx(tt.mountain);
  const tRiver = tIdx(rv.terrain), tPass = tIdx(P.passTerrain);
  const rules = P.biomes.map((r) => ({
    t: tIdx(r.terrain),
    hA: r.heightAbove ?? -1, hB: r.heightBelow ?? 2, tA: r.tempAbove ?? -9, tB: r.tempBelow ?? 9,
    mA: r.moistureAbove ?? -1, mB: r.moistureBelow ?? 2, cw: r.coastWithin ?? 65535,
  }));
  const startT = st.terrain.map(tIdx), tClear = tIdx(wg.startTerrain || st.terrain[0]);
  for (const r of P.nodes || []) for (const id of r.terrain) tIdx(id);

  // Every random draw of the terrain happens in a fixed order: climate noise here, then the elevation's.
  const moistN = makeNoise(rng.int(1e9)), heatN = makeNoise(rng.int(1e9));
  // 1. Elevation; the lowest `oceanShare` of the tiles is sea.
  const elev = planetElevation(rng, P, W, H, S);
  let rawE = elev.rawE, E = toQuantiles(rawE);
  const LV = 65536, lev = new Uint16Array(N), land = new Uint8Array(N);
  let landN = 0, seaLevel = -Infinity;
  for (let i = 0; i < N; i++) {
    if (E[i] >= P.oceanShare) { land[i] = 1; landN++; } else if (rawE[i] > seaLevel) seaLevel = rawE[i];
    lev[i] = Math.min(LV - 1, Math.floor(E[i] * LV));
  }
  E = null;
  // Land height: each land tile's rank among the land tiles (0 lowest, 1 highest).
  const HL = new Float32Array(N);
  { const landE = new Float32Array(landN);
    for (let i = 0, k = 0; i < N; i++) if (land[i]) landE[k++] = rawE[i];
    const q = toQuantiles(landE);
    for (let i = 0, k = 0; i < N; i++) if (land[i]) HL[i] = q[k++]; }
  rawE = null;

  // 2. Coasts: steps to the sea over land.
  const dSea = distField(W, H, land, 0);
  // 3. Climate. Moisture (a rank among the land tiles) from the sea, the latitude belts (wet at the equator
  // and in the middle latitudes, dry near 30° and at the poles) and noise. Temperature (0 at the poles, 1 at
  // the equator, less on the heights) is worked out where the biomes are picked.
  const cl = P.climate || {};
  const lapse = cl.lapse ?? 0.5, lapseFrom = cl.lapseFrom ?? 0.6, jitter = cl.jitter ?? 0.06;
  const heat = coarseNoise(heatN, (cl.noiseScale ?? 0.05) * S, W, H), moist = coarseNoise(moistN, (cl.noiseScale ?? 0.05) * S, W, H);
  const reach = cl.seaReach ?? 60, seaW = cl.seaWeight ?? 0.5, beltW = cl.beltWeight ?? 0.35, noiseW = cl.noiseWeight ?? 0.35;
  const latOf = (y) => Math.abs((2 * y) / (H - 1) - 1);
  const M = new Float32Array(N);
  { const landM = new Float32Array(landN);
    for (let y = 0, k = 0; y < H; y++) {
      const belt = smooth01(Math.abs(((latOf(y) * 3) % 2) - 1)); // 1 at the equator and at latitude 2/3, 0 at 1/3 and the poles
      for (let x = 0; x < W; x++) { const i = y * W + x; if (land[i]) landM[k++] = seaW * (reach / (reach + dSea[i])) + beltW * belt + noiseW * moist(x, y); }
    }
    const q = toQuantiles(landM);
    for (let i = 0, k = 0; i < N; i++) if (land[i]) M[i] = q[k++]; }

  // 4. Drainage: lakes and rivers.
  const dr = planetDrainage(W, H, land, landN, lev, HL, M, P);

  // 5. Biomes: the first matching rule per land tile.
  const T8 = new Uint8Array(N);
  { const shallowW = P.coast?.shallowWidth ?? 4, dLand = distField(W, H, land, 1, shallowW);
    const fallback = rules[rules.length - 1].t;
    for (let y = 0; y < H; y++) {
      const lat = latOf(y);
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!land[i]) { T8[i] = dLand[i] <= shallowW ? tShallow : tDeep; continue; }
        if (dr.lake[i]) { T8[i] = tLake; continue; }
        if (dr.river[i]) { T8[i] = tRiver; continue; }
        const h = HL[i], m = M[i], dc = dSea[i];
        const t = 1 - lat - (lapse * Math.max(0, h - lapseFrom)) / (1 - lapseFrom) + jitter * 2 * (heat(x, y) - 0.5);
        let pick = fallback;
        for (const r of rules) {
          if (h >= r.hA && h < r.hB && t >= r.tA && t < r.tB && m >= r.mA && m < r.mB && dc <= r.cw) { pick = r.t; break; }
        }
        T8[i] = pick;
      }
    } }

  // 6. Passes (and small walled-in pockets turned to mountain), then the start.
  const pdef = pal.map((id) => reg.get('terrain', id));
  const ps = planetPasses(W, H, T8, pdef, tPass, tMount, P.minPocket ?? 0);
  const okStart = new Uint8Array(pal.length);
  for (const k of startT) okStart[k] = 1;
  const isBuild = pdef.map((d) => (d?.passable && d?.buildable ? 1 : 0));
  const { cx, cy } = planetStart(W, H, T8, ps.openComp, ps.startArea, okStart, isBuild, st.areaRadius ?? 7);
  const clearR = wg.startClearRadius ?? 6;
  for (let y = cy - clearR; y <= cy + clearR; y++) for (let x = cx - clearR; x <= cx + clearR; x++) {
    if (x >= 0 && y >= 0 && x < W && y < H && (x - cx) * (x - cx) + (y - cy) * (y - cy) <= clearR * clearR) T8[y * W + x] = tClear;
  }
  const T = s.map.terrain;
  for (let i = 0; i < N; i++) T[i] = pal[T8[i]];

  // Facts for tests and tools (returned, not saved): landmasses, sea share, lakes, rivers, passes.
  const minCont = (P.continentMinShare ?? 0.02) * landN;
  let continents = 0, islands = 0, waterTiles = N - landN;
  for (const n of ps.massSizes) if (n >= minCont) continents++; else islands++;
  for (let i = 0; i < N; i++) if (dr.lake[i]) waterTiles++;
  const planet = {
    continents, islands, landmasses: ps.massSizes.length, oceanShare: waterTiles / N, seaShare: (N - landN) / N, seaLevel,
    lakes: dr.lakes, rivers: dr.rivers, riverTiles: dr.riverTiles, longestRiver: dr.longestRiver,
    passes: ps.passes, passTiles: ps.passTiles, pockets: ps.pockets, plates: elev.K, continentalPlates: elev.nCont,
  };
  planetNodes(reg, s, rng, wg, T8, pal, cx, cy, planet);
  return { cx, cy, planet };
}

/** Raw elevation of a planet (Float32 per tile; only its order matters). Domain-warped plates (continental
 *  ones in `continents` groups, sloping down from their middle), ridged ranges along converging plate edges
 *  (broken into segments, varying in width, and only where the ground is near or above sea level anyway),
 *  rifts along the others, sea channels and a strait between continents, continent-shape and detail noise,
 *  and ocean at the map edges. */
function planetElevation(rng, P, W, H, S) {
  const N = W * H, pl = P.plates || {}, rg = P.ridges || {};
  const warpXN = makeNoise(rng.int(1e9)), warpYN = makeNoise(rng.int(1e9)), shapeN = makeNoise(rng.int(1e9));
  const detailN = makeNoise(rng.int(1e9)), ridgeN = makeNoise(rng.int(1e9)), segN = makeNoise(rng.int(1e9));
  const K = pl.count ?? 20;
  const px = new Float64Array(K), py = new Float64Array(K), base = new Float64Array(K), cont = new Uint8Array(K);
  for (let k = 0; k < K; k++) { px[k] = rng.next() * W; py[k] = rng.next() * H; }
  // Continental plates, in `continents` groups (one continent each): the groups' first plates are picked
  // one by one, each scoring best on distance from those already picked, distance from the map edge and a
  // random factor, so continents spread out; then the groups take turns adding the free plate nearest to
  // them (away from the edge). Edges between plates of different continents are sea channels.
  const nCont = Math.max(1, Math.min(K, Math.round(K * (pl.continental ?? 0.4))));
  const G = Math.max(1, Math.min(nCont, pl.continents ?? 1));
  const group = new Int32Array(K).fill(-1);
  const edgeRoom = 0.15 * Math.min(W, H);
  const room = (k) => Math.min(1, Math.min(px[k], py[k], W - px[k], H - py[k]) / edgeRoom);
  const dist = (a, b) => { const dx = px[a] - px[b], dy = py[a] - py[b]; return Math.sqrt(dx * dx + dy * dy); };
  const near = new Float64Array(K).fill(S);
  for (let r = 0; r < G; r++) {
    let best = -1, bs = -1;
    for (let k = 0; k < K; k++) {
      const luck = rng.next();
      if (cont[k]) continue;
      const sc = (near[k] / S) * room(k) * (0.3 + luck);
      if (sc > bs) { bs = sc; best = k; }
    }
    cont[best] = 1; group[best] = r;
    for (let k = 0; k < K; k++) near[k] = Math.min(near[k], dist(k, best));
  }
  for (let n = G, r = 0; n < nCont; n++, r = (r + 1) % G) {
    let best = -1, bd = Infinity;
    for (let k = 0; k < K; k++) {
      if (cont[k]) continue;
      let d = Infinity;
      for (let j = 0; j < K; j++) if (group[j] === r) d = Math.min(d, dist(k, j));
      d /= Math.max(0.1, room(k));
      if (d < bd) { bd = d; best = k; }
    }
    cont[best] = 1; group[best] = r;
  }
  for (let k = 0; k < K; k++) base[k] = (cont[k] ? pl.landHeight ?? 0.55 : pl.oceanHeight ?? 0) + (rng.next() - 0.5) * (pl.jitter ?? 0.2);
  // Plate edges: converging edges raise a range (higher where continents meet), the others a shallow rift.
  const rh = rg.height || [0.25, 0.5, 0.8];
  const edgeH = new Float64Array(K * K);
  for (let a = 0; a < K; a++) for (let b = a + 1; b < K; b++) {
    let h = rng.next() < (rg.convergent ?? 0.6) ? rh[cont[a] + cont[b]] : -(rg.rift ?? 0.05);
    if (cont[a] && cont[b] && group[a] !== group[b]) h = -(rg.split ?? 0.8); // between two continents: a sea channel
    edgeH[a * K + b] = edgeH[b * K + a] = h;
  }

  const warpS = (pl.warpScale ?? 0.12) * S, warpA = (pl.warp ?? 0.08) * S;
  const wx = coarseNoise(warpXN, warpS, W, H), wy = coarseNoise(warpYN, warpS, W, H);
  const shape = coarseNoise(shapeN, (P.shapeScale ?? 0.08) * S, W, H);
  const shapeW = P.shapeWeight ?? 0.45, detailS = P.detailScale ?? 22, detailW = P.detailWeight ?? 0.15;
  const chanW = (pl.channel ?? 0) * S, blend = (pl.blend ?? 0.03) * S, dome = pl.dome ?? 0, plateR = S / Math.sqrt(K);
  const ridgeW = (rg.width ?? 0.012) * S, ridgeS = rg.scale ?? 28, oceanSide = rg.oceanSide ?? 1, splitW = (rg.splitWidth ?? 0.03) * S;
  // Ranges in segments: a low-frequency noise along the edge sets each stretch's height (0 in the gaps);
  // a second one varies the width; ranges fade out where the ground would be under the sea anyway.
  const sg = rg.segments || {}, segS = (sg.scale ?? 0.03) * S, segCut = sg.cut ?? 0.35, segSoft = sg.soft ?? 0.3, widthVary = rg.widthVary ?? 0;
  const seg = coarseNoise(segN, segS, W, H), wid = coarseNoise((x, y) => segN(x + 57.31, y + 23.17), segS * 1.7, W, H);
  const fadeLo = rg.fadeBelow ?? -9, fadeW = rg.fadeWidth ?? 0.1;
  const edgeBand = Math.max(4, Math.min(W, H) * (P.edgeWidth ?? 0.06)), edgeFall = P.edgeFalloff ?? 0.6;
  const rawE = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const qx = x + (wx(x, y) - 0.5) * 2 * warpA, qy = y + (wy(x, y) - 0.5) * 2 * warpA;
    let d1 = Infinity, d2 = Infinity, k1 = 0, k2 = 0, c1 = Infinity, c2 = Infinity, cg = -1;
    for (let k = 0; k < K; k++) {
      const dx = qx - px[k], dy = qy - py[k], d = dx * dx + dy * dy;
      if (d < d1) { d2 = d1; k2 = k1; d1 = d; k1 = k; } else if (d < d2) { d2 = d; k2 = k; }
      if (cont[k]) { // nearest continental plate (c1, its group cg) and nearest of another group (c2)
        if (d < c1) { if (group[k] !== cg) c2 = c1; c1 = d; cg = group[k]; } else if (group[k] !== cg && d < c2) c2 = d;
      }
    }
    const s1 = Math.sqrt(d1), s2 = Math.sqrt(d2), b = (s2 - s1) * 0.5; // b: about the distance to the plate edge
    const b1 = cont[k1] ? base[k1] * (1 - dome * Math.min(1, s1 / plateR)) : base[k1], b2 = cont[k2] ? base[k2] * (1 - dome * Math.min(1, s2 / plateR)) : base[k2];
    let e = b2 + (b1 - b2) * (0.5 + 0.5 * Math.min(1, b / blend)); // continents slope down from their middle
    const sh = shapeW * (shape(x, y) - 0.5), pre = e + sh; // the ground before ranges and detail
    const split = cont[k1] && cont[k2] && group[k1] !== group[k2];
    const rw = ridgeW * Math.max(0.2, 1 + widthVary * 4 * (wid(x, y) - 0.5));
    if (b < rw) {
      const r = 1 - b / rw, h = edgeH[k1 * K + k2] * (cont[k1] < cont[k2] ? oceanSide : 1); // lower on the sea side of a coast range
      if (h > 0) {
        const amp = smooth01((seg(x, y) - segCut) / segSoft) * smooth01((pre - fadeLo) / fadeW);
        if (amp > 0) { const n = ridgeN(x / ridgeS, y / ridgeS), rn = 1 - Math.abs(2 * n - 1); e += h * r * r * (0.35 + 0.65 * rn) * amp; }
      } else if (!split) e += h * r;
    }
    if (split && b < splitW) e += edgeH[k1 * K + k2] * (1 - b / splitW);
    e += sh + detailW * (detailN(x / detailS, y / detailS) - 0.5);
    // Ocean round the edges: a band wavy on the warped map, but never further out than half the plain one.
    const dPlain = Math.min(x, y, W - 1 - x, H - 1 - y);
    const dEdge = Math.max(0, Math.min(qx, qy, W - 1 - qx, H - 1 - qy, 2 * dPlain));
    if (dEdge < edgeBand) { const f = 1 - dEdge / edgeBand; e -= edgeFall * f * f; }
    // The map's outer two rows are sea, and so is a strait along the line between two continents' plates
    // (land can never join two continents).
    if (dPlain < 2 || (c2 < Infinity && (Math.sqrt(c2) - Math.sqrt(c1)) * 0.5 < chanW)) e = -1e3;
    rawE[y * W + x] = e;
  }
  return { rawE, K, nCont };
}

/** Drainage of a planet. A priority flood from the sea over land, lowest first (a bucket queue on 16-bit
 *  heights): each land tile drains to the tile it was reached from, and is filled to its basin's spill level.
 *  Lakes are the deepest basin parts; rain gathered downhill makes rivers. Returns the lake and river masks
 *  and river facts; every other buffer is dropped (or reused) here. */
function planetDrainage(W, H, land, landN, lev, HL, M, P) {
  const N = W * H, LV = 65536;
  const head = new Int32Array(LV).fill(-1), tail = new Int32Array(LV), next = new Int32Array(N);
  const down = new Int32Array(N).fill(-1), fill = new Uint16Array(N), seen = new Uint8Array(N), flow = new Int32Array(landN);
  const push = (i, l) => { next[i] = -1; if (head[l] < 0) head[l] = i; else next[tail[l]] = i; tail[l] = i; };
  for (let i = 0; i < N; i++) {
    if (land[i]) continue;
    seen[i] = 1; fill[i] = lev[i];
    const x = i % W;
    for (let d = 0; d < 4; d++) { const j = nb4(i, x, W, N, d); if (j >= 0 && land[j]) { push(i, lev[i]); break; } }
  }
  // Tiles below the current level (inside a basin being filled) wait in a heap ordered by their own height
  // (then index) and go before the rest of the level, so water in a basin gathers along its floor instead
  // of in straight lines out from the spill point.
  const heap = new Int32Array(N);
  let hn = 0;
  const below = (a, b) => lev[a] < lev[b] || (lev[a] === lev[b] && a < b);
  const hpush = (i) => { let k = hn++; while (k > 0) { const p = (k - 1) >> 1; if (!below(i, heap[p])) break; heap[k] = heap[p]; k = p; } heap[k] = i; };
  const hpop = () => {
    const top = heap[0], last = heap[--hn];
    let k = 0;
    for (;;) { let c = 2 * k + 1; if (c >= hn) break; if (c + 1 < hn && below(heap[c + 1], heap[c])) c++; if (!below(heap[c], last)) break; heap[k] = heap[c]; k = c; }
    if (hn > 0) heap[k] = last;
    return top;
  };
  let nf = 0;
  for (let l = 0; l < LV; l++) {
    for (;;) {
      let c;
      if (hn > 0) c = hpop(); else if (head[l] >= 0) { c = head[l]; head[l] = next[c]; } else break;
      if (land[c]) flow[nf++] = c;
      const x = c % W;
      for (let d = 0; d < 4; d++) {
        const j = nb4(c, x, W, N, d);
        if (j < 0 || seen[j]) continue;
        seen[j] = 1; down[j] = c;
        if (lev[j] > l) { fill[j] = lev[j]; push(j, lev[j]); } else { fill[j] = l; hpush(j); }
      }
    }
  }
  // Lakes: the deepest parts of filled basins, at least `minDepth` deep (a share of the height range), at
  // most `share` of the land (the depth cut is raised until they fit), in pieces of at least `minArea` tiles.
  // The rest of a basin stays land, and its rivers run across it to the lake and on out.
  const lk = P.lakes || {};
  let lakeDepth = Math.max(1, Math.round((lk.minDepth ?? 0.004) * LV));
  { const byDepth = new Float64Array(LV);
    for (let i = 0; i < N; i++) if (land[i]) byDepth[fill[i] - lev[i]]++;
    const most = (lk.share ?? 0.02) * landN;
    let n = 0, D = LV - 1;
    for (; D >= lakeDepth; D--) { if (n + byDepth[D] > most) break; n += byDepth[D]; }
    lakeDepth = Math.max(lakeDepth, D + 1); }
  const lakeC = seen; // reused: the deep enough basin tiles
  for (let i = 0; i < N; i++) lakeC[i] = land[i] && fill[i] - lev[i] >= lakeDepth ? 1 : 0;
  const lake = new Uint8Array(N);
  let lakes = 0;
  { const lc = components(W, H, lakeC), big = lc.sizes.map((n) => n >= (lk.minArea ?? 12));
    for (const b of big) if (b) lakes++;
    for (let i = 0; i < N; i++) if (lakeC[i] && big[lc.comp[i]]) lake[i] = 1; }
  // Rivers: rain (more where wet and on the heights) gathered downhill; a river wherever enough has gathered.
  const rv = P.rivers, mtnRain = rv.mountainRain ?? 3, minDrain = rv.minDrainage ?? 1500;
  const acc = new Float32Array(heap.buffer); // reused: the heap is empty
  for (let k = 0; k < nf; k++) { const i = flow[k], h = HL[i]; acc[i] = 0.5 + M[i] + mtnRain * h * h * h * h; }
  for (let k = nf - 1; k >= 0; k--) { const i = flow[k], d = down[i]; if (d >= 0 && land[d]) acc[d] += acc[i]; }
  const river = new Uint8Array(N);
  let riverTiles = 0, mouths = 0, longest = 0;
  const rlen = next; // reused: each river tile's length to its mouth
  for (let k = 0; k < nf; k++) {
    const i = flow[k];
    if (acc[i] < minDrain || lake[i]) continue;
    river[i] = 1; riverTiles++;
    const d = down[i];
    if (d >= 0 && river[d]) rlen[i] = rlen[d] + 1; else { rlen[i] = 1; mouths++; }
    if (rlen[i] > longest) longest = rlen[i];
  }
  return { lake, river, lakes, rivers: mouths, riverTiles, longestRiver: longest };
}

/** Passes on a planet. Open (passable) pockets walled in by impassable dry ground, other than a landmass's
 *  main open area and smaller than `minPocket` tiles, become mountain. The rest join their landmass's main
 *  open area: one search from every main area at once through impassable dry ground; a pocket reached is
 *  joined by carving the way back as pass terrain, and is then searched on from as well. Returns the open
 *  areas (comp ids per tile), the start area (the main open area of the largest landmass) and facts. */
function planetPasses(W, H, T8, pdef, tPass, tMount, minPocket) {
  const N = W * H;
  const isPass = pdef.map((d) => (d?.passable ? 1 : 0)), isWet = pdef.map((d) => (d && !d.passable && d.drinkable ? 1 : 0));
  const passM = new Uint8Array(N), dryM = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const k = T8[i]; passM[i] = isPass[k]; dryM[i] = isWet[k] ? 0 : 1; }
  const open = components(W, H, passM), mass = components(W, H, dryM);
  const nOpen = open.sizes.length, firstOf = new Int32Array(nOpen).fill(-1);
  for (let i = 0; i < N; i++) { const c = open.comp[i]; if (c >= 0 && firstOf[c] < 0) firstOf[c] = i; }
  const mainOf = new Int32Array(mass.sizes.length).fill(-1); // landmass -> its largest open area (first if tied)
  for (let c = 0; c < nOpen; c++) {
    const m = mass.comp[firstOf[c]], cur = mainOf[m];
    if (cur < 0 || open.sizes[c] > open.sizes[cur]) mainOf[m] = c;
  }
  const joined = new Uint8Array(nOpen);
  for (const c of mainOf) if (c >= 0) joined[c] = 1;
  let pockets = 0;
  if (minPocket > 0) {
    for (let c = 0; c < nOpen; c++) if (!joined[c] && open.sizes[c] < minPocket) { joined[c] = 2; pockets++; }
    if (pockets) for (let i = 0; i < N; i++) { const c = open.comp[i]; if (c >= 0 && joined[c] === 2) { T8[i] = tMount; passM[i] = 0; open.comp[i] = -1; } }
    for (let c = 0; c < nOpen; c++) if (joined[c] === 2) open.sizes[c] = 0;
  }
  const cStart = new Int32Array(nOpen + 1);
  for (let c = 0; c < nOpen; c++) cStart[c + 1] = cStart[c] + open.sizes[c];
  const byComp = new Int32Array(cStart[nOpen]), fillAt = cStart.slice(0, nOpen);
  for (let i = 0; i < N; i++) { const c = open.comp[i]; if (c >= 0) byComp[fillAt[c]++] = i; }
  const from = new Int32Array(N).fill(-2), q = new Int32Array(N);
  let qt = 0, passes = 0, passTiles = 0;
  for (let i = 0; i < N; i++) { const c = open.comp[i]; if (c >= 0 && joined[c] === 1) { from[i] = -1; q[qt++] = i; } }
  for (let qh = 0; qh < qt; qh++) {
    const c = q[qh], x = c % W;
    for (let d = 0; d < 4; d++) {
      const j = nb4(c, x, W, N, d);
      if (j < 0 || from[j] !== -2 || !dryM[j]) continue;
      const oc = open.comp[j];
      if (oc < 0) { from[j] = c; q[qt++] = j; continue; } // impassable dry ground: search on through it
      if (joined[oc]) continue;
      joined[oc] = 1; passes++;
      for (let p = c; p >= 0 && from[p] !== -1; p = from[p]) if (!passM[p]) { T8[p] = tPass; passM[p] = 1; passTiles++; }
      for (let k = cStart[oc]; k < cStart[oc + 1]; k++) { const t = byComp[k]; from[t] = -1; q[qt++] = t; }
    }
  }
  // The start area: the main open area of the largest landmass (the first if tied), else the largest open area.
  let bigM = -1;
  for (let m = 0; m < mass.sizes.length; m++) if (mainOf[m] >= 0 && (bigM < 0 || mass.sizes[m] > mass.sizes[bigM])) bigM = m;
  let startArea = bigM >= 0 ? mainOf[bigM] : -1;
  if (startArea < 0) for (let c = 0; c < nOpen; c++) if (open.sizes[c] > 0 && (startArea < 0 || open.sizes[c] > open.sizes[startArea])) startArea = c;
  return { openComp: open.comp, startArea, passes, passTiles, pockets, massSizes: mass.sizes };
}

/** The start of a planet: the spot nearest the middle of the start area whose square of radius rr is all
 *  open, buildable ground of that area, on a start terrain. Where none fits, smaller squares are tried, then
 *  the nearest buildable tile of the area, so the start is never on water or mountain. */
function planetStart(W, H, T8, comp, area, okStart, isBuild, rr0) {
  const W1 = W + 1, bad = new Int32Array(W1 * (H + 1)); // integral image of the tiles a start square must not hold
  let sx = 0, sy = 0, sn = 0;
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      const i = y * W + x, inA = area >= 0 && comp[i] === area;
      if (inA) { sx += x; sy += y; sn++; }
      row += isBuild[T8[i]] && inA ? 0 : 1;
      bad[(y + 1) * W1 + x + 1] = bad[y * W1 + x + 1] + row;
    }
  }
  const mx = sn ? Math.round(sx / sn) : W >> 1, my = sn ? Math.round(sy / sn) : H >> 1;
  // Tiles in rings round the middle, nearest ring first (each ring: top and bottom rows, then the sides).
  const ring = (test) => {
    for (let r = 0; r < Math.max(W, H); r++) {
      const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && test(x, y);
      if (r === 0) { if (at(mx, my)) return [mx, my]; continue; }
      for (let dx = -r; dx <= r; dx++) { if (at(mx + dx, my - r)) return [mx + dx, my - r]; if (at(mx + dx, my + r)) return [mx + dx, my + r]; }
      for (let dy = -r + 1; dy < r; dy++) { if (at(mx - r, my + dy)) return [mx - r, my + dy]; if (at(mx + r, my + dy)) return [mx + r, my + dy]; }
    }
    return null;
  };
  for (let rr = rr0; rr >= 1; rr--) {
    const p = ring((x, y) => {
      if (x - rr < 1 || y - rr < 1 || x + rr >= W - 1 || y + rr >= H - 1 || !okStart[T8[y * W + x]]) return false;
      const x0 = x - rr, y0 = y - rr, x1 = x + rr + 1, y1 = y + rr + 1;
      return bad[y1 * W1 + x1] - bad[y0 * W1 + x1] - bad[y1 * W1 + x0] + bad[y0 * W1 + x0] === 0;
    });
    if (p) return { cx: p[0], cy: p[1] };
  }
  const p = ring((x, y) => comp[y * W + x] === area && isBuild[T8[y * W + x]] === 1) || ring((x, y) => comp[y * W + x] === area);
  return p ? { cx: p[0], cy: p[1] } : { cx: mx, cy: my };
}

/** Resource nodes of a planet: per-terrain rules (planet.nodes), the first rule that fires on a tile wins.
 *  Densities are scaled down evenly when the expected count would pass `nodeBudget` nodes per map tile. */
function planetNodes(reg, s, rng, wg, T8, pal, cx, cy, planet) {
  const W = s.map.w, H = s.map.h, N = W * H, P = wg.planet, rules = P.nodes || [];
  const byT = pal.map(() => []);
  const noises = rules.map((r) => (r.noiseScale ? makeNoise(rng.int(1e9)) : null));
  const count = new Float64Array(pal.length);
  for (let i = 0; i < N; i++) count[T8[i]]++;
  let expected = 0;
  rules.forEach((r, k) => {
    const share = r.noiseScale ? 1 - (r.noiseAbove ?? 0.5) : 1;
    for (const id of r.terrain) {
      const t = pal.indexOf(id);
      if (t < 0) continue;
      byT[t].push(k);
      expected += count[t] * r.density * share;
    }
  });
  const scale = P.nodeBudget && expected > P.nodeBudget * N ? (P.nodeBudget * N) / expected : 1;
  const defs = rules.map((r) => reg.get('node', r.node));
  const dens = rules.map((r) => r.density * scale);
  const minD2 = rules.map((r) => (r.minDistFromStart ?? 0) * (r.minDistFromStart ?? 0));
  let n = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const list = byT[T8[y * W + x]];
    if (!list.length) continue;
    const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
    for (const k of list) {
      if (d2 < minD2[k]) continue;
      const r = rules[k], nz = noises[k];
      if (nz && nz(x / r.noiseScale, y / r.noiseScale) < (r.noiseAbove ?? 0.5)) continue;
      if (rng.next() >= dens[k]) continue;
      const id = 'n' + s.nextId++, nd = defs[k];
      s.nodes[id] = { id, def: nd.id, x, y, chunks: nd.chunks };
      n++;
      break;
    }
  }
  planet.nodes = n; planet.nodeScale = scale;
}
