// Organic territory (Phase 2b, slice 4). Scenarios with `territory: "organic"` (data; core:vast_world) give
// land to a settlement only as it claims it: outward from its centre, a little more each day, along the
// cheapest ground. All other scenarios keep the nearest-centre rule (game.js territoryGrid), unchanged.
//
// Saved state (format 10, only in organic games):
//   s.claims = { ids: [settlement ids, in the order they first claimed], grid: <runs>, grew: { sid: tiles } }
//   grid: per tile the index into ids of its owner, or unclaimed. At run time it lives in a Uint16Array
//   (g._cl.grid, 0xffff = unclaimed) and s.claims.grid is null; saves write it as runs
//   ("<index + 1 base36>.<run length base36>,...", 0 = unclaimed), like the terrain (save.js).
//   grew: tiles each settlement claimed in the last daily growth (for the village card).
//
// Daily growth (growClaims, at the start of the day after founding; no random numbers): each settlement has a
// budget, its claim radius R = min(maxRadius, baseRadius + perPerson x people + perDay x days since founding)
// in tiles of open land. Land is claimed in order of cost distance from the centre (a Dijkstra search over
// 8 neighbours, no corner cutting past water; stepping onto a tile costs its terrain's claim cost, x1.4
// diagonally), up to the budget. All settlements grow together, nearest-first (by distance, then claim
// order, then tile), so where two meet the nearer one wins and neither ever takes a tile the other holds.
// A tile another village uses (its building, building site, stockpile or field) waits until it is free.
//
// Derived, never saved (rebuilt on load and when the terrain changes, the same way): per tile the cost
// distance of every claimed tile from its owner's centre (dist, true shortest paths through the owner's own
// land: a late claim that shortens them relaxes them at once), and per settlement a frontier heap of
// unclaimed tiles next to its land keyed by (distance, tile). A loaded game rebuilds exactly the frontier the
// saving game had (same smallest key per tile), so it grows the same way.
//
// Cost: nothing per tick. Daily: one pass over the colonists (head-counts), then O(new tiles x log) heap
// work plus O(log villages) per frontier entry to pick the nearest one. Memory: grid 2 B + dist 2 B per tile.
// Distant (abstract) villages grow exactly like full-detail ones (the rule reads only people and age).
import { TICKS_PER_DAY } from './constants.js';

export const CLAIM_DEFAULTS = Object.freeze({
  baseRadius: 10, perPerson: 1, perDay: 0.2, maxRadius: 90, defaultCost: 1, costs: Object.freeze({}), stops: Object.freeze([]), steepCost: 4, buildReach: 2,
});
const NONE = 0xffff;
const SH = 2 ** 24; // heap key = dist x SH + tile (maps up to 4096 x 4096)
const MAXD = 0xfffe;
const RUN = /^[0-9a-z]+\.[0-9a-z]+$/;
const DIRTY_KEEP = 64; // claim changes remembered for claimsDirtySince
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

/** Does this scenario use organic territory? */
export const organicScenario = (sc) => sc?.territory === 'organic';

/** The scenario's claim rules merged with the defaults. */
export function claimRules(g) {
  if (g._clRules) return g._clRules;
  const c = g.reg.get('scenario', g.s.scenarioId)?.claims || {};
  return (g._clRules = { ...CLAIM_DEFAULTS, ...c, costs: c.costs || CLAIM_DEFAULTS.costs, stops: c.stops || CLAIM_DEFAULTS.stops });
}

// ---------------- saving ----------------
export function encodeClaimGrid(grid) {
  const out = [];
  let prev = -1, run = 0;
  const flush = () => { if (run) out.push((prev === NONE ? 0 : prev + 1).toString(36) + '.' + run.toString(36)); };
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (v === prev) { run++; continue; }
    flush(); prev = v; run = 1;
  }
  flush();
  return out.join(',');
}

/** Runs back to a grid; throws on damage (wrong length, an owner index outside ids). */
export function decodeClaimGrid(runs, size, nIds) {
  const grid = new Uint16Array(size).fill(NONE);
  let i = 0;
  if (runs) for (const part of runs.split(',')) {
    if (!RUN.test(part)) throw new Error('the claimed land is damaged');
    const dot = part.indexOf('.');
    const v = parseInt(part.slice(0, dot), 36), n = parseInt(part.slice(dot + 1), 36);
    if (dot < 1 || !(v >= 0) || !(v <= nIds) || !(n >= 1) || i + n > size) throw new Error('the claimed land is damaged');
    if (v) grid.fill(v - 1, i, i + n);
    i += n;
  }
  if (i !== size) throw new Error(`the claimed land has ${i} tiles, expected ${size}`);
  return grid;
}

/** The claims as written in a save: the same keys in the same order, the grid as runs. */
export function claimsForSave(g) {
  const c = g.s.claims, out = {};
  for (const k of Object.keys(c)) out[k] = k === 'grid' ? encodeClaimGrid(g._cl.grid) : c[k];
  return out;
}

// ---------------- set-up ----------------
/** Game constructor: the run-time claim grid from the state (an organic game only). */
export function attachClaims(g) {
  const c = g.s.claims;
  if (!c) { g._cl = null; return; }
  c.ids ||= []; c.grew ||= {};
  const N = g.W * g.H;
  const grid = typeof c.grid === 'string' ? decodeClaimGrid(c.grid, N, c.ids.length) : new Uint16Array(N).fill(NONE);
  c.grid = null; // lives in g._cl.grid while the game runs; saves write it as runs
  const index = new Map(c.ids.map((sid, k) => [sid, k]));
  g._cl = { grid, dist: null, index, rev: 0, fr: null, changes: [], T: { tick: g.s.tick, sig: 'claims:0', rev: 0, ids: c.ids, grid } };
}

/** A settlement that has no claims record yet gets one (the next index). Returns its index. */
function register(g, sid) {
  const C = g._cl;
  let k = C.index.get(sid);
  if (k !== undefined) return k;
  k = g.s.claims.ids.length;
  if (k >= NONE) return -1;
  g.s.claims.ids.push(sid);
  C.index.set(sid, k);
  if (C.fr) C.fr.push(newFrontier(g, sid));
  return k;
}
const registerAll = (g) => { for (const sid of Object.keys(g.s.settlements || {}).sort()) register(g, sid); };

function newFrontier(g, sid) {
  const c = g.s.settlements[sid]?.center || g.s.center;
  return { heap: c && g.inB(c.x, c.y) ? [g.i(c.x, c.y)] : [], wait: new Set(), area: 0, x0: g.W, y0: g.H, x1: -1, y1: -1 };
}

// ---------------- costs ----------------
/** Claim cost per terrain palette index: 0 = never claimed (stops), else tenths of a tile (orthogonal). */
function costTable(g) {
  const pal = g.terrainPalette, C = g._cl;
  if (C.cost && C.costN === pal.length) return C.cost;
  const R = claimRules(g), stops = new Set(R.stops);
  const t = new Uint16Array(pal.length);
  for (let k = 0; k < pal.length; k++) t[k] = stops.has(pal[k]) ? 0 : Math.max(1, Math.round(10 * (R.costs[pal[k]] ?? R.defaultCost)));
  C.cost = t; C.costN = pal.length;
  return t;
}

// ---------------- the frontier (derived) ----------------
function heapPush(h, v) {
  let i = h.length; h.push(v);
  while (i > 0) { const p = (i - 1) >> 1; if (h[p] <= v) break; h[i] = h[p]; i = p; }
  h[i] = v;
}
function heapPop(h) {
  const top = h[0], last = h.pop();
  if (h.length) {
    let i = 0; const n = h.length;
    for (;;) {
      const l = 2 * i + 1; if (l >= n) break;
      const r = l + 1, c = r < n && h[r] < h[l] ? r : l;
      if (h[c] >= last) break;
      h[i] = h[c]; i = c;
    }
    h[i] = last;
  }
  return top;
}

/** Relax from tile t (owned by k, distance dist[t] already set): own tiles reached more cheaply get the
 *  shorter distance (and relax on), unclaimed tiles become frontier entries of k. */
function relax(g, k, t0, take = -1) {
  const C = g._cl, grid = C.grid, dist = C.dist, cost = costTable(g), W = g.W, H = g.H, ts = g._ts.idx;
  const fh = C.fr[k].heap;
  const q = [dist[t0] * SH + t0];
  while (q.length) {
    const key = heapPop(q), t = key % SH, dt = (key - t) / SH;
    if (dt > dist[t]) continue;
    const x = t % W, y = (t - x) / W;
    for (let d = 0; d < 8; d++) {
      const dx = DIRS[d][0], dy = DIRS[d][1], mx = x + dx, my = y + dy;
      if (mx < 0 || my < 0 || mx >= W || my >= H) continue;
      const m = my * W + mx, cm = cost[ts[m]];
      if (!cm) continue;
      let step = cm;
      if (d >= 4) { // diagonal: not past the corner of open water
        if (!cost[ts[y * W + mx]] || !cost[ts[my * W + x]]) continue;
        step = Math.round(cm * 1.4);
      }
      const nd = dt + step;
      if (nd > MAXD) continue;
      const o = grid[m];
      if (o === k) { if (nd < dist[m]) { dist[m] = nd; heapPush(q, nd * SH + m); } }
      else if (o === NONE || o === take) heapPush(fh, nd * SH + m);
    }
  }
}

/** Build the frontiers and distances from the saved claims (on load, after a terrain change, or the first
 *  time). Same result as the live game's: true shortest distances through each owner's own land. */
function rebuild(g) {
  const C = g._cl, N = g.W * g.H, grid = C.grid, ids = g.s.claims.ids;
  C.dist ||= new Uint16Array(N);
  C.dist.fill(0xffff);
  C.fr = ids.map((sid) => newFrontier(g, sid));
  for (let i = 0; i < N; i++) {
    const k = grid[i];
    if (k === NONE) continue;
    const f = C.fr[k], x = i % g.W, y = (i - x) / g.W;
    f.area++;
    if (x < f.x0) f.x0 = x; if (x > f.x1) f.x1 = x; if (y < f.y0) f.y0 = y; if (y > f.y1) f.y1 = y;
  }
  for (let k = 0; k < ids.length; k++) {
    const f = C.fr[k], c0 = f.heap[0];
    if (c0 === undefined || grid[c0] !== k) continue; // no land yet: the centre is its only frontier entry
    f.heap = [];
    C.dist[c0] = 0;
    relax(g, k, c0);
  }
  C.mapRev = g.s.map.rev || 0;
}

/** Rebuild one settlement's distances and frontier (it lost land: the hand-over at a founding). The same
 *  result as the full rebuild gives it. O(its bounding box + its area x log). */
function rebuildOne(g, k) {
  const C = g._cl, f = C.fr[k], grid = C.grid, dist = C.dist, W = g.W;
  for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) if (grid[y * W + x] === k) dist[y * W + x] = 0xffff;
  const c = g.s.settlements[g.s.claims.ids[k]]?.center || g.s.center;
  f.heap = c && g.inB(c.x, c.y) ? [g.i(c.x, c.y)] : [];
  const c0 = f.heap[0];
  if (c0 === undefined || grid[c0] !== k) return;
  f.heap = [];
  dist[c0] = 0;
  relax(g, k, c0);
}

function ensureFrontier(g) {
  const C = g._cl;
  if (!C.fr || C.mapRev !== (g.s.map.rev || 0)) rebuild(g);
}

/** Would claiming tile i for settlement sid take something another village uses? */
function usedByOther(g, i, sid) {
  const st = g.structAt(i);
  if (st?.settlement && st.settlement !== sid) return true;
  const p = g.footAt(i);
  if (p?.settlement && p.settlement !== sid) return true;
  const z = g.zoneAt(i);
  if (z) {
    if (z.startsWith('S:')) return z.slice(2) !== sid;
    const f = g.s.fields[z];
    if (f?.settlement && f.settlement !== sid) return true;
  }
  return false;
}

/** People per settlement (one pass over the colonists). */
function people(g) {
  const out = new Map();
  for (const c of Object.values(g.s.colonists)) { const sid = c.settlementId || g.s.playerSettlement; out.set(sid, (out.get(sid) || 0) + 1); }
  return out;
}

/** A settlement's claim radius now (tiles of open land). */
export function claimRadius(g, sid, pop = null) {
  const R = claimRules(g), st = g.s.settlements[sid];
  if (!st) return 0;
  pop ??= people(g).get(sid) || 0;
  const days = Math.max(0, (g.s.tick - (st.founded || 0)) / TICKS_PER_DAY);
  return Math.min(R.maxRadius, R.baseRadius + R.perPerson * pop + R.perDay * days);
}

/**
 * Grow the claims (daily, from Game.tick; at creation; for a new village at founding with `only`). Returns the
 * number of tiles claimed. No random numbers; the order is fixed by distance, claim order and tile.
 */
export function growClaims(g, only = null, take = -1) {
  const C = g._cl;
  if (!C) return 0;
  registerAll(g);
  ensureFrontier(g);
  const ids = g.s.claims.ids, grid = C.grid, dist = C.dist, cost = costTable(g), ts = g._ts.idx;
  const pops = people(g);
  const budget = ids.map((sid) => (only === null || sid === only) && g.s.settlements[sid] ? Math.floor(10 * claimRadius(g, sid, pops.get(sid) || 0)) : -1);
  const grew = ids.map(() => 0);
  // Tiles that waited (another village used them) are looked at again, at their current distance.
  for (let k = 0; k < ids.length; k++) {
    const f = C.fr[k];
    if (budget[k] < 0 || !f.wait.size) continue;
    for (const i of f.wait) heapPush(f.heap, waitKey(g, k, i));
    f.wait.clear();
  }
  // The settlements whose nearest frontier tile is within budget, ordered by (that tile's key, index): a
  // small heap. Claiming changes only the claimant's own frontier, so only its place in this heap moves.
  const live = (k) => { const h = C.fr[k].heap; return h.length > 0 && Math.floor(h[0] / SH) <= budget[k]; };
  const less = (a, b) => { const ka = C.fr[a].heap[0], kb = C.fr[b].heap[0]; return ka < kb || (ka === kb && a < b); };
  const sel = [];
  const selDown = (i) => {
    const n = sel.length, v = sel[i];
    for (;;) {
      const l = 2 * i + 1; if (l >= n) break;
      const r = l + 1, c = r < n && less(sel[r], sel[l]) ? r : l;
      if (!less(sel[c], v)) break;
      sel[i] = sel[c]; i = c;
    }
    sel[i] = v;
  };
  for (let k = 0; k < ids.length; k++) if (budget[k] >= 0 && live(k)) sel.push(k);
  for (let i = (sel.length >> 1) - 1; i >= 0; i--) selDown(i);
  let total = 0, handed = 0, bx0 = g.W, by0 = g.H, bx1 = -1, by1 = -1;
  // Contact (contact.js): lands that come to touch. Only in the daily growth of a game with contact borders (a
  // founding's first claim is skipped: the daughter takes over its parent's contacts right after). Pairs of
  // owner indexes in the order found; 8 reads per claimed tile.
  const touch = only === null && g.s.contact && g.reg.get('scenario', g.s.scenarioId)?.contact?.borders !== false ? new Map() : null;
  while (sel.length) {
    const best = sel[0];
    const f = C.fr[best], key = heapPop(f.heap), i = key % SH, d = (key - i) / SH;
    const o = grid[i];
    if ((o === NONE || o === take) && cost[ts[i]]) { // else already claimed (by itself: a longer way; by another: theirs)
      const sid = ids[best];
      if (usedByOther(g, i, sid)) f.wait.add(i);
      else {
        if (o === take) { C.fr[take].area--; handed++; } // a founding: the parent hands this tile over
        grid[i] = best; dist[i] = d;
        const x = i % g.W, y = (i - x) / g.W;
        f.area++; grew[best]++; total++;
        if (x < f.x0) f.x0 = x; if (x > f.x1) f.x1 = x; if (y < f.y0) f.y0 = y; if (y > f.y1) f.y1 = y;
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
        relax(g, best, i, take);
        if (touch) for (let dd = 0; dd < 8; dd++) {
          const nx = x + DIRS[dd][0], ny = y + DIRS[dd][1];
          if (nx < 0 || ny < 0 || nx >= g.W || ny >= g.H) continue;
          const o2 = grid[ny * g.W + nx];
          if (o2 === NONE || o2 === best) continue;
          const pk = best < o2 ? best * 65536 + o2 : o2 * 65536 + best;
          if (!touch.has(pk)) touch.set(pk, [ids[best], ids[o2]]);
        }
      }
    }
    // Its frontier only grew by keys >= the one just taken, or lost its top: it can only move down (or out).
    if (live(best)) selDown(0);
    else { const last = sel.pop(); if (sel.length) { sel[0] = last; selDown(0); } }
  }
  if (only === null) for (let k = 0; k < ids.length; k++) if (g.s.settlements[ids[k]]) g.s.claims.grew[ids[k]] = grew[k];
  if (handed) rebuildOne(g, take);
  if (total) {
    C.rev++; C.T.sig = 'claims:' + C.rev; C.T.rev = C.rev;
    C.changes.push({ rev: C.rev, x0: bx0, y0: by0, x1: bx1, y1: by1 });
    if (C.changes.length > DIRTY_KEEP) C.changes.shift();
  }
  C.handed = handed;
  if (touch?.size && g.bordersTouched) g.bordersTouched([...touch.values()]);
  return total;
}

/**
 * For the map overlay (read-only): the box of tiles whose owner changed since claim revision `rev` (the `rev`
 * of territoryGrid() when it was last drawn), as { x0, y0, x1, y1, rev } (rev: the current revision), or null
 * when nothing changed. Too old a revision (or another game's) gives the whole map; so do nearest-centre
 * games (their grid has no rev; use its sig).
 */
export function claimsDirtySince(g, rev) {
  const C = g._cl;
  if (!C) return { x0: 0, y0: 0, x1: g.W - 1, y1: g.H - 1, rev: 0 };
  if (rev === C.rev) return null;
  const all = { x0: 0, y0: 0, x1: g.W - 1, y1: g.H - 1, rev: C.rev };
  if (!Number.isInteger(rev) || rev > C.rev || !C.changes.length || C.changes[0].rev > rev + 1) return all;
  const out = { x0: g.W, y0: g.H, x1: -1, y1: -1, rev: C.rev };
  for (const e of C.changes) if (e.rev > rev) {
    if (e.x0 < out.x0) out.x0 = e.x0; if (e.y0 < out.y0) out.y0 = e.y0; if (e.x1 > out.x1) out.x1 = e.x1; if (e.y1 > out.y1) out.y1 = e.y1;
  }
  return out;
}

/** Load and creation (Game.warmCaches): build the frontiers now, so no tick pays for it. Changes no state. */
export function warmClaims(g) { if (g._cl) ensureFrontier(g); }

/** Organic claimOk: may settlement sid build or lay out here? On its own land, or on unclaimed land within
 *  buildReach tiles of it; never on another village's land. O(buildReach^2) for unclaimed tiles. */
export function claimOkOrganic(g, sid, x, y) {
  if (!g.inB(x, y)) return true;
  const C = g._cl, grid = C.grid, W = g.W, o = grid[y * W + x], k = C.index.get(sid);
  if (k !== undefined && o === k) return true;
  if (o !== NONE) return false;
  if (k === undefined) return true; // no land yet (not registered): as before
  const r = claimRules(g).buildReach;
  for (let yy = Math.max(0, y - r); yy <= Math.min(g.H - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(W - 1, x + r); xx++) if (grid[yy * W + xx] === k) return true;
  return false;
}

/** The current frontier key of a waiting tile: its cheapest step from the owner's land (the same value a
 *  rebuilt frontier holds). */
function waitKey(g, k, i) {
  const C = g._cl, cost = costTable(g), ts = g._ts.idx, W = g.W, H = g.H;
  const x = i % W, y = (i - x) / W, cm = cost[ts[i]];
  const c = g.s.settlements[g.s.claims.ids[k]]?.center || g.s.center;
  if (c && g.inB(c.x, c.y) && i === g.i(c.x, c.y)) return i; // its own centre: key 0, as a rebuilt frontier has it
  let best = MAXD + 1;
  if (!cm) return best * SH + i;
  for (let d = 0; d < 8; d++) {
    const tx = x - DIRS[d][0], ty = y - DIRS[d][1];
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
    const t = ty * W + tx;
    if (C.grid[t] !== k) continue;
    let step = cm;
    if (d >= 4) { if (!cost[ts[ty * W + x]] || !cost[ts[y * W + tx]]) continue; step = Math.round(cm * 1.4); }
    const nd = C.dist[t] + step;
    if (nd < best) best = nd;
  }
  return best * SH + i;
}

/** Game.create (organic scenario): every settlement claims its first land. */
export function startClaims(g) { if (g._cl) growClaims(g); }

/** A village was just founded: it gets its first land at once (the others do not grow now). A daughter founded
 *  on its parent's land is handed the parent's tiles within that first claim (the one exception to claims
 *  being permanent: parent to daughter, at founding only; logged). */
export function claimsAdded(g, sid) {
  if (!g._cl) return;
  register(g, sid);
  const st = g.s.settlements[sid], par = st?.parent, pk = par ? g._cl.index.get(par) : undefined;
  growClaims(g, sid, pk ?? -1);
  const n = g._cl.handed || 0;
  if (n) g.log(`${g.s.settlements[par]?.name || par} handed ${n} tiles of its land to the new village ${st.name || sid}.`, 'info');
}

/** Founding (organic): may a daughter of `parent` start on the box [x0, x1] x [y0, y1]? Unclaimed land or
 *  the parent's own; never another village's. */
export function claimsFreeFor(g, parent, x0, y0, x1, y1) {
  const grid = g._cl.grid, W = g.W, pk = g._cl.index.get(parent) ?? -1;
  for (let y = Math.max(0, y0); y <= Math.min(g.H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
    const o = grid[y * W + x];
    if (o !== NONE && o !== pk) return false;
  }
  return true;
}

/** The claim grid in territoryGrid's shape: { tick, sig, ids, grid } (sig changes whenever claims change). */
export function claimTerritory(g) {
  const T = g._cl.T;
  T.tick = g.s.tick;
  return T;
}

/** Is the box [x0, x1] x [y0, y1] free of claims (organic founding: a new village starts on unclaimed land)? */
export function claimsFree(g, x0, y0, x1, y1) {
  const grid = g._cl.grid, W = g.W;
  for (let y = Math.max(0, y0); y <= Math.min(g.H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) if (grid[y * W + x] !== NONE) return false;
  return true;
}

// ---------------- the village card ----------------
const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
function sector(dx, dy) {
  const a = Math.atan2(dy, dx); // y grows southwards
  return ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
}

/**
 * Read-only: a settlement's land for the village card. Organic: { organic: true, area, grew (tiles claimed in the
 * last daily growth), radius (its claim budget in tiles of open land), limits: [{ kind: 'terrain' | 'water' |
 * 'neighbour' | 'used' | 'size', what, dirs, tiles }], text }. Nearest-centre: { organic: false, area, text }.
 * Organic cost: O(its bounding box), cached until the claims change.
 */
export function landInfo(g, sid) {
  const st = g.s.settlements?.[sid];
  if (!st) return null;
  if (!g._cl) {
    const T = g.territoryGrid();
    if (!g._landNear || g._landNear.sig !== T.sig) {
      const n = new Map();
      for (let i = 0; i < T.grid.length; i++) { const k = T.grid[i]; if (k !== NONE) n.set(k, (n.get(k) || 0) + 1); }
      g._landNear = { sig: T.sig, n };
    }
    const area = g._landNear.n.get(T.ids.indexOf(sid)) || 0;
    return { organic: false, area, text: `${area} tiles: the land nearer to ${st.name || sid} than to any other village.` };
  }
  const C = g._cl;
  const ck = `${C.rev}|${g.s.tick - (g.s.tick % TICKS_PER_DAY)}|${sid}`;
  if (C.info?.has(ck)) return C.info.get(ck);
  if (!C.info || C.infoRev !== C.rev) { C.info = new Map(); C.infoRev = C.rev; }
  ensureFrontier(g);
  const k = C.index.get(sid), name = st.name || sid;
  const radius = Math.round(claimRadius(g, sid) * 10) / 10;
  const grew = g.s.claims.grew?.[sid] ?? 0;
  if (k === undefined) { const r = { organic: true, area: 0, grew: 0, radius, limits: [], text: `${name} has no land yet.` }; C.info.set(ck, r); return r; }
  const f = C.fr[k], grid = C.grid, W = g.W, H = g.H, cost = costTable(g), ts = g._ts.idx, R = claimRules(g);
  const steep = Math.round(10 * R.steepCost), c = st.center || g.s.center;
  const groups = new Map(); // kind|what -> { kind, what, n, sec: [8] }
  const add = (kind, what, x, y) => {
    const key = kind + '|' + what;
    let e = groups.get(key); if (!e) groups.set(key, (e = { kind, what, n: 0, sec: new Array(8).fill(0) }));
    e.n++; e.sec[sector(x - c.x, y - c.y)]++;
  };
  const budget = Math.floor(10 * claimRadius(g, sid));
  for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) {
    if (grid[y * W + x] !== k) continue;
    for (let d = 0; d < 4; d++) {
      const mx = x + DIRS[d][0], my = y + DIRS[d][1];
      if (mx < 0 || my < 0 || mx >= W || my >= H) continue;
      const m = my * W + mx, o = grid[m];
      if (o === k) continue;
      if (o !== NONE) { add('neighbour', g.s.settlements[g.s.claims.ids[o]]?.name || g.s.claims.ids[o], mx, my); continue; }
      const cm = cost[ts[m]];
      if (!cm) { add('water', g.terrainAt(mx, my).name, mx, my); continue; }
      if (f.wait.has(m) || usedByOther(g, m, sid)) { add('used', 'buildings and fields of other villages', mx, my); continue; }
      if (cm >= steep) { add('terrain', g.terrainAt(mx, my).name, mx, my); continue; }
      add('size', 'its size', mx, my);
    }
  }
  const top = f.heap.length ? Math.floor(f.heap[0] / SH) : Infinity;
  const limits = [...groups.values()].map((e) => {
    const order = e.sec.map((n, s) => [n, s]).filter(([n]) => n > 0).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    const dirs = order.filter(([n], j) => j < 2 && n * 4 >= order[0][0]).map(([, s]) => COMPASS[s]);
    return { kind: e.kind, what: e.what, dirs, tiles: e.n };
  }).sort((a, b) => b.tiles - a.tiles || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.what < b.what ? -1 : 1));
  const phrase = (l) => {
    const where = l.dirs.length ? ` to the ${l.dirs.join(' and ')}` : '';
    if (l.kind === 'neighbour') return `${l.what}'s land${where}`;
    if (l.kind === 'water') return `${l.what.toLowerCase()}${where}`;
    if (l.kind === 'terrain') return `${l.what.toLowerCase()}${where}`;
    if (l.kind === 'used') return `${l.what}${where}`;
    return '';
  };
  const blockers = limits.filter((l) => l.kind !== 'size').slice(0, 3).map(phrase);
  const open = groups.has('size|its size');
  let growth;
  if (!open && !f.heap.length) growth = 'It cannot grow any further.';
  else if (top > budget) growth = `Elsewhere it is limited by its size (it claims up to ${radius} tiles of open land out; that grows with its people and its age${radius >= R.maxRadius ? ', and has reached the most' : ''}).`;
  else growth = 'It is still growing.';
  const text = `${f.area} tiles of land, ${grew >= 0 ? '+' : ''}${grew} at the last daily growth.${blockers.length ? ` Held back by ${blockers.join(', ')}.` : ''} ${growth}`;
  const r = { organic: true, area: f.area, grew, radius, limits, text };
  C.info.set(ck, r);
  return r;
}
