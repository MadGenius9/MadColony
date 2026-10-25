// A* on the tile grid: 8 directions, no corner cutting, terrain move costs.
import { CHUNK } from './constants.js';
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(f, v) {
    const a = this.a; a.push([f, v]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top[1];
  }
}

export function atGoal(x, y, tx, ty, mode, g) {
  const d = Math.max(Math.abs(x - tx), Math.abs(y - ty));
  if (mode === 'on') return d === 0;
  // The distance first: the standable test (a pure lookup) only matters within one tile, so asking it
  // there alone gives the same answers (A* asks this for every tile it expands).
  if (d > 1 || (mode === 'adj' && d === 0)) return false;
  // When working next to something, never stand on a pending wall/furniture site.
  if (g && !g.standable(x, y)) return false;
  return true; // 'adj': d === 1; 'near': d <= 1
}

/**
 * Walking distance from every tile to the nearest of `sources` (tile indices), over terrain alone (its
 * passability and move costs; buildings, nodes and walls are ignored, so the field depends only on the
 * saved terrain and can be cached per map revision). Same moves as findPath: 8 directions, no corner
 * cutting. Returns { dist: Float64Array (Infinity where no source is reachable), from: Int32Array (the
 * nearest source's index, -1 if none), passT, costT (walkable 1/0 and move cost, as a Float32, per terrain
 * palette index) }. Cost: one Dijkstra over the map, O(W*H log(W*H)).
 */
export function terrainDistanceField(g, sources) {
  const W = g.W, H = g.H, N = W * H;
  const { passT, costT } = terrainTables(g);
  const idx = g._ts.idx;
  // Per tile, read through the terrain's palette index (no per-tile copies).
  const dist = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1);
  // Binary heap of tile indices keyed on dist (lazy deletion: stale entries are skipped on pop).
  let hk = new Float64Array(1024), hv = new Int32Array(1024), n = 0;
  const push = (k, v) => {
    if (n === hk.length) { const k2 = new Float64Array(n * 2), v2 = new Int32Array(n * 2); k2.set(hk); v2.set(hv); hk = k2; hv = v2; }
    let i = n++;
    while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; }
    hk[i] = k; hv[i] = v;
  };
  const pop = () => {
    const top = hv[0], k = hk[--n], v = hv[n];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1; let m = -1, mk = k;
      if (l < n && hk[l] < mk) { m = l; mk = hk[l]; }
      if (r < n && hk[r] < mk) { m = r; mk = hk[r]; }
      if (m < 0) break;
      hk[i] = hk[m]; hv[i] = hv[m]; i = m;
    }
    hk[i] = k; hv[i] = v;
    return top;
  };
  for (const s of sources) if (passT[idx[s]] && dist[s] > 0) { dist[s] = 0; from[s] = s; push(0, s); }
  while (n) {
    const kTop = hk[0], cur = pop();
    if (kTop > dist[cur]) continue;
    const cx = cur % W, cy = (cur / W) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (!passT[idx[ni]]) continue;
      if (dx && dy && (!passT[idx[cy * W + nx]] || !passT[idx[ny * W + cx]])) continue;
      const nd = dist[cur] + (dx && dy ? 1.414 : 1) * costT[idx[ni]];
      if (nd < dist[ni]) { dist[ni] = nd; from[ni] = from[cur]; push(nd, ni); }
    }
  }
  return { dist, from, passT, costT };
}

/**
 * Walking distance over terrain from (sx, sy) to every tile of the square window of radius R round it, up to
 * `maxDist` (the same metric as terrainDistanceField: terrain only, 8 directions, no corner cutting; tiles
 * farther than maxDist or outside the window are Infinity). If (sx, sy) cannot be stood on, its walkable
 * neighbours are the sources. Returns { x0, y0, w, h, dist: Float32Array } or null when nothing round
 * (sx, sy) is walkable. Cost: one Dijkstra over at most (2R+1)^2 tiles.
 */
export function localDistanceField(g, sx, sy, R, maxDist = Infinity) {
  const x0 = Math.max(0, sx - R), y0 = Math.max(0, sy - R), x1 = Math.min(g.W - 1, sx + R), y1 = Math.min(g.H - 1, sy + R);
  const w = x1 - x0 + 1, h = y1 - y0 + 1, W = g.W;
  const { passT, costT } = terrainTables(g);
  const idx = g._ts.idx;
  const pass = (x, y) => passT[idx[y * W + x]] === 1;
  const dist = new Float32Array(w * h).fill(Infinity); // distances are rounded to Float32 as they are found
  // Binary heap of window indices keyed on dist, in typed arrays (lazy deletion: stale entries are skipped).
  let hk = new Float64Array(1024), hv = new Int32Array(1024), n = 0;
  const push = (k, v) => {
    if (n === hk.length) { const k2 = new Float64Array(n * 2), v2 = new Int32Array(n * 2); k2.set(hk); v2.set(hv); hk = k2; hv = v2; }
    let i = n++;
    while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; }
    hk[i] = k; hv[i] = v;
  };
  const pop = () => {
    const top = hv[0], k = hk[--n], v = hv[n];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1; let m = -1, mk = k;
      if (l < n && hk[l] < mk) { m = l; mk = hk[l]; }
      if (r < n && hk[r] < mk) { m = r; mk = hk[r]; }
      if (m < 0) break;
      hk[i] = hk[m]; hv[i] = hv[m]; i = m;
    }
    hk[i] = k; hv[i] = v;
    return top;
  };
  const seed = (x, y, d) => { if (x >= x0 && y >= y0 && x <= x1 && y <= y1 && pass(x, y) && d < dist[(y - y0) * w + (x - x0)]) { dist[(y - y0) * w + (x - x0)] = d; push(d, (y - y0) * w + (x - x0)); } };
  if (pass(sx, sy)) seed(sx, sy, 0);
  else for (const [dx, dy] of DIRS) seed(sx + dx, sy + dy, Math.fround(dx && dy ? 1.414 : 1));
  if (!n) return null;
  while (n) {
    const top = hk[0], cur = pop();
    if (top > dist[cur]) continue;
    const lx = cur % w, ly = (cur / w) | 0, cx = lx + x0, cy = ly + y0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < x0 || ny < y0 || nx > x1 || ny > y1 || !pass(nx, ny)) continue;
      if (dx && dy && (!pass(nx, cy) || !pass(cx, ny))) continue;
      const nd = Math.fround(dist[cur] + (dx && dy ? 1.414 : 1) * costT[idx[ny * W + nx]]);
      const ni = (ny - y0) * w + (nx - x0);
      if (nd <= maxDist && nd < dist[ni]) { dist[ni] = nd; push(nd, ni); }
    }
  }
  return { x0, y0, w, h, dist };
}

/** Walkable (1/0) and move cost (Float32, as the field has always stored it) per terrain palette index, from
 *  the same terrain definitions terrainAt gives. */
function terrainTables(g) {
  const P = g.terrainPalette.length;
  const passT = new Uint8Array(P), costT = new Float32Array(P);
  for (let k = 0; k < P; k++) { const t = g.terrainDefOf(k); passT[k] = t.passable ? 1 : 0; costT[k] = t.moveCost || 1; }
  return { passT, costT };
}

/**
 * The nearest goal tile on foot from (sx,sy) in a terrainDistanceField's metric (same moves; a step costs the
 * tile stepped from, as the field read from this side does). A* with the field's distance as heuristic: it is
 * the exact distance to the nearest source, so it is consistent and the first goal popped is the nearest
 * goal. `isGoal(i)` should be true only on source tiles. Returns { i, d } or null (none within maxNodes).
 * Used when the field's own nearest source cannot be used (a tree or boulder on it, walled off).
 */
export function nearestOnField(g, F, sx, sy, isGoal, maxNodes = 20000) {
  const W = g.W, H = g.H, { dist: h } = F;
  // Walkability and cost per palette index; a kind added since the field was made is looked up as it comes.
  let { passT, costT } = F;
  const idx = g._ts.idx;
  if (passT.length !== g.terrainPalette.length) ({ passT, costT } = terrainTables(g));
  const pass = (i) => passT[idx[i]], cost = (i) => costT[idx[i]];
  const s = sy * W + sx;
  if (!pass(s) || !(h[s] < Infinity)) return null;
  const gs = new Map([[s, 0]]), closed = new Set();
  const heap = new Heap();
  heap.push(h[s], s);
  let expanded = 0;
  while (heap.size) {
    const cur = heap.pop();
    if (closed.has(cur)) continue;
    closed.add(cur);
    const d = gs.get(cur);
    if (isGoal(cur)) return { i: cur, d };
    if (++expanded > maxNodes) return null;
    const cx = cur % W, cy = (cur / W) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (!pass(ni) || closed.has(ni)) continue;
      if (dx && dy && (!pass(cy * W + nx) || !pass(ny * W + cx))) continue;
      const nd = d + (dx && dy ? 1.414 : 1) * cost(cur);
      if (nd < (gs.get(ni) ?? Infinity)) { gs.set(ni, nd); heap.push(nd + h[ni], ni); }
    }
  }
  return null;
}

/** Returns an array of {x,y} steps (excluding the start), [] if already there, or null if unreachable. */
// Search buffers are reused between calls (a full-map set per call was ~13 bytes per tile of garbage);
// a generation stamp marks which entries belong to the current search, so nothing needs clearing. A tile's
// move cost is cached as its terrain's palette index + 1 (0 = not walkable): 2 bytes instead of 8.
// On maps larger than PATH_WINDOW tiles a side the buffers cover a PATH_WINDOW-square window round the start
// (about 14 MB, not 22 bytes for every tile of a vast map). A search that would step out of the window
// stops and is run again over the whole map with buffers of that size made for it, so every path is exactly
// the one a whole-map search finds (the window search is the same search up to that point).
const PATH_WINDOW = 801;
const BUFS = new Map(); // buffer size -> buffers (one for small maps, one window size for big ones)
function makeBuffers(N) { return { N, gs: new Float64Array(N), came: new Int32Array(N), tag: new Uint32Array(N), code: new Uint16Array(N), gen: 0, hk: new Float64Array(1024), hv: new Int32Array(1024) }; }
// Tags are gen * 8 + 3 bits (search below), so gen stays under 2^29; past it the tags are cleared.
const GEN_MAX = 0x1fffffff;
function buffers(N) {
  let B = BUFS.get(N);
  if (!B) { if (BUFS.size >= 2) BUFS.clear(); B = makeBuffers(N); BUFS.set(N, B); }
  if (++B.gen >= GEN_MAX) { B.tag.fill(0); B.gen = 1; }
  return B;
}
/** Whole-map buffers for the rare search that leaves its window: made on first need and reused (a fresh set
 *  per rerun would be ~70 MB of garbage at 2048x1536). */
let FULL = null;
function wholeMapBuffers(N) {
  if (!FULL || FULL.N !== N) FULL = makeBuffers(N);
  if (++FULL.gen >= GEN_MAX) { FULL.tag.fill(0); FULL.gen = 1; }
  return FULL;
}
const OUT_OF_WINDOW = Symbol('out of window');
/** Counters for performance checks (not game state): searches run again over the whole map; searches
 *  answered from the cache of found paths (big maps). */
export const pathStats = { wholeMap: 0, cached: 0 };

// Big maps: found paths (and failed searches) are kept, keyed by start, goal, mode and node limit, with the
// tile area the search read (the box round every tile whose walkability it asked, in chunks). While no tile
// in that area has changed since (game.js tileChanged, a count per chunk), the search would read the same
// map and find the same path, so the kept one is given (as a fresh copy). Colonists walk the same long way
// again and again (from the stockpile to the same stand of trees across a lake). Derived, never saved: after
// loading, a path is simply searched again. Box of the current search, in map tiles:
let bx0 = 0, by0 = 0, bx1 = 0, by1 = 0;
const CACHE_MAX = 256;
function cachedPath(g, key) {
  const C = g._paths, e = C?.get(key), ch = g._chg;
  if (!e || !ch) return undefined;
  if (ch.all > e.at) { C.delete(key); return undefined; }
  const CW = g.CW, rev = ch.rev;
  for (let cy = e.cy0; cy <= e.cy1; cy++) for (let k = cy * CW + e.cx0, k1 = cy * CW + e.cx1; k <= k1; k++) if (rev[k] > e.at) { C.delete(key); return undefined; }
  return e.path;
}
// Kept as tile indices (4 bytes a step); given back as the usual fresh list of {x, y}.
const packPath = (p, W) => (p ? Int32Array.from(p, (n) => n.y * W + n.x) : null);
const unpackPath = (a, W) => (a ? Array.from(a, (i) => ({ x: i % W, y: (i - (i % W)) / W })) : null);

export function findPath(g, sx, sy, tx, ty, mode = 'on', maxNodes = 30000) {
  if (atGoal(sx, sy, tx, ty, mode, g)) return [];
  const W = g.W, H = g.H;
  if (W <= PATH_WINDOW && H <= PATH_WINDOW) return search(g, sx, sy, tx, ty, mode, maxNodes, 0, 0, W, H, buffers(W * H));
  const key = sx + ',' + sy + ',' + tx + ',' + ty + ',' + mode + ',' + maxNodes;
  const kept = g._chg ? cachedPath(g, key) : undefined;
  if (kept !== undefined) { pathStats.cached++; return unpackPath(kept, W); }
  const at = g._chg?.n ?? 0; // tile changes so far (nothing changes during the search)
  bx0 = bx1 = sx; by0 = by1 = sy;
  const ww = Math.min(W, PATH_WINDOW), wh = Math.min(H, PATH_WINDOW);
  const x0 = Math.max(0, Math.min(W - ww, sx - (ww >> 1))), y0 = Math.max(0, Math.min(H - wh, sy - (wh >> 1)));
  let r = search(g, sx, sy, tx, ty, mode, maxNodes, x0, y0, ww, wh, buffers(ww * wh));
  if (r === OUT_OF_WINDOW) {
    pathStats.wholeMap++;
    r = search(g, sx, sy, tx, ty, mode, maxNodes, 0, 0, W, H, wholeMapBuffers(W * H));
  }
  if (g._chg) {
    const C = (g._paths ||= new Map());
    if (C.size >= CACHE_MAX) C.delete(C.keys().next().value); // the oldest
    C.delete(key);
    C.set(key, { path: packPath(r, W), at, cx0: Math.floor(bx0 / CHUNK), cy0: Math.floor(by0 / CHUNK), cx1: Math.floor(bx1 / CHUNK), cy1: Math.floor(by1 / CHUNK) });
  }
  return r;
}

/** A* over the window (x0, y0, ww x wh) of the map; tile indices in the buffers and the heap are the
 *  window's own. OUT_OF_WINDOW when it would step onto a map tile outside the window.
 *  Written out for speed (big worlds run searches of 50000 tiles and more): directions in DIRS order, the same
 *  goal test as atGoal, the same costs, f values and binary heap (the same sift rules), so every path is
 *  exactly the one the plain version finds. Per tile one tag word says, for this search, whether its move cost
 *  is known (1), it has a cost so far (2) and it is closed (4): tag = gen * 8 + those bits. */
function search(g, sx, sy, tx, ty, mode, maxNodes, x0, y0, ww, wh, B) {
  const W = g.W, H = g.H;
  const base = B.gen * 8, gsA = B.gs, came = B.came, tag = B.tag, code = B.code;
  // Move cost of a tile, 0 if impassable; asked of the game once per tile per search (the map does not change
  // during a search, so this only saves time: the paths are exactly those of asking every time). The cost is
  // the terrain's moveCost (g.moveCost), so it is kept as the terrain's palette index + 1 (0 = not walkable).
  const tidx = g._ts.idx, P = g.terrainPalette.length;
  if (P >= 0xffff) throw new Error('too many terrain kinds');
  const costOf = new Float64Array(P + 1), passT = new Uint8Array(P);
  for (let k = 0; k < P; k++) { const t = g.terrainDefOf(k); costOf[k + 1] = t.moveCost || 1; passT[k] = t.passable ? 1 : 0; }
  // (impassable terrain is known without asking isPassable, which would say the same)
  const tileCost = (i, x, y) => { // i: window index; x, y: map position
    const t = tag[i];
    if (t >= base && (t & 1)) return costOf[code[i]];
    if (x < bx0) bx0 = x; else if (x > bx1) bx1 = x; // the area read (findPath's cache)
    if (y < by0) by0 = y; else if (y > by1) by1 = y;
    const k = tidx[y * W + x];
    const c = passT[k] && g.isPassable(x, y) ? k + 1 : 0;
    code[i] = c; tag[i] = (t >= base ? t : base) | 1;
    return costOf[c];
  };
  // the binary heap of tile indices keyed on f (lazy deletion: closed tiles popped again are skipped)
  let hk = B.hk, hv = B.hv, n = 0;
  const s = (sy - y0) * ww + (sx - x0);
  gsA[s] = 0; came[s] = -1; tag[s] = tag[s] >= base ? tag[s] | 2 : base + 2;
  hk[0] = 0; hv[0] = s; n = 1;
  let expanded = 0;
  const on = mode === 'on', adj = mode === 'adj';
  const x1 = x0 + ww, y1 = y0 + wh;
  while (n) {
    // pop
    const cur = hv[0];
    if (--n) {
      const f = hk[n], val = hv[n]; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = -1, mk = f;
        if (l < n && hk[l] < mk) { m = l; mk = hk[l]; }
        if (r < n && hk[r] < mk) { m = r; mk = hk[r]; }
        if (m < 0) break;
        hk[i] = hk[m]; hv[i] = hv[m]; i = m;
      }
      hk[i] = f; hv[i] = val;
    }
    const tc = tag[cur]; // set (>= base) for every tile in the heap
    if (tc & 4) continue; // closed
    tag[cur] = tc | 4;
    const lx = cur % ww, ly = (cur / ww) | 0, cx = x0 + lx, cy = y0 + ly;
    const gd = Math.max(Math.abs(cx - tx), Math.abs(cy - ty)); // atGoal, inline
    if (on ? gd === 0 : gd <= 1 && !(adj && gd === 0) && g.standable(cx, cy)) {
      B.hk = hk; B.hv = hv;
      const out = [];
      for (let k = cur; k !== s; k = came[k]) out.push({ x: x0 + (k % ww), y: y0 + ((k / ww) | 0) });
      return out.reverse();
    }
    if (++expanded > maxNodes) { B.hk = hk; B.hv = hv; return null; }
    const gc = gsA[cur];
    for (let k = 0; k < 8; k++) {
      const dx = DX[k], dy = DY[k];
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (nx < x0 || ny < y0 || nx >= x1 || ny >= y1) { B.hk = hk; B.hv = hv; return OUT_OF_WINDOW; }
      const ni = cur + dy * ww + dx, mc = tileCost(ni, nx, ny);
      const diag = k >= 4;
      if (!diag) oc[k] = mc; // the four straight steps come first (DIRS order)
      if (!mc) continue;
      // No corner cutting: a diagonal step's two corner tiles are the straight neighbours just asked (a
      // diagonal on the map has both of them on the map, and in the window, or the search returned already).
      if (diag && (!oc[CA[k]] || !oc[CB[k]])) continue;
      const tn = tag[ni]; // >= base: tileCost has set it
      if (tn & 4) continue; // closed
      const ng = gc + (diag ? 1.414 : 1) * mc;
      if (!(tn & 2) || ng < gsA[ni]) {
        gsA[ni] = ng; tag[ni] = tn | 2; came[ni] = cur;
        const hx = Math.abs(nx - tx), hy = Math.abs(ny - ty); // the octile heuristic
        const hd = Math.max(hx, hy) + 0.414 * Math.min(hx, hy);
        const fk = ng + (on ? hd : Math.max(0, hd - 1));
        // push
        if (n === hk.length) { const k2 = new Float64Array(n * 2), v2 = new Int32Array(n * 2); k2.set(hk); v2.set(hv); hk = k2; hv = v2; }
        let j = n++;
        while (j > 0) { const p = (j - 1) >> 1; if (hk[p] <= fk) break; hk[j] = hk[p]; hv[j] = hv[p]; j = p; }
        hk[j] = fk; hv[j] = ni;
      }
    }
  }
  B.hk = hk; B.hv = hv;
  return null;
}
const DX = DIRS.map((d) => d[0]), DY = DIRS.map((d) => d[1]);
// For a diagonal direction k, the straight directions of its corner tiles (x step, then y step).
const CA = DIRS.map(([dx]) => DIRS.findIndex(([ex, ey]) => ex === dx && ey === 0));
const CB = DIRS.map(([, dy]) => DIRS.findIndex(([ex, ey]) => ex === 0 && ey === dy));
const oc = new Float64Array(4); // move costs of the current tile's straight neighbours
