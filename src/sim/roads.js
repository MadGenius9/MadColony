// Roads (Phase 7, docs/proposals/phase-7-roads.md, slice 1). A road is a one-tile, walkable building (data: a
// building with `road: { terrain }`). When it is built, its tile becomes the road terrain, which is cheaper to walk
// (moveCost), so every path search already prefers it; the old terrain is kept on the building (st.under, saved:
// format 39) and comes back when the road is removed (game.js removeStructure). Nothing in the path code changes.
import { findPath } from './path.js';
import { createProject, tileUsable } from './construction.js';

/** Construction finished a road (construction.js completeStructure): its tile becomes road. */
export function layRoad(g, st) {
  const R = g.bDef(st)?.road;
  if (!R || !g.reg.get('terrain', R.terrain)) return;
  const i = g.i(st.x, st.y), now = g.terrainAt(st.x, st.y)?.id;
  if (!now || now === R.terrain) return;
  st.under = now;
  g.setTerrain(i, R.terrain);
}

/** A road is removed (game.js removeStructure): its tile's old ground comes back. */
export function liftRoad(g, st) {
  if (!st.under || !g.reg.get('terrain', st.under)) return;
  g.setTerrain(g.i(st.x, st.y), st.under);
}

/** Built road tiles of village sid (for plans and the UI). */
export const roadsOf = (g, sid) => g.owned('structures', sid).filter((b) => b.built && g.bDef(b)?.road);

// ---------- foot traffic and the first roads (slice 2) ----------
// Each full-detail village counts its people walking, by cell of ROAD.cell x ROAD.cell tiles, every ROAD.sample
// ticks (settlement.traffic { "cx,cy": n }, saved, at most ROAD.cells cells), decaying by ROAD.decay a day. A village
// lays roads, ROAD.segment tiles at a time, along the path from its centre toward its busiest cell at least
// ROAD.far tiles away, once that cell reaches ROAD.busy; one batch at a time, at most ROAD.max road tiles.

// minPeople: a village smaller than this lays no roads (a small colony's stone and work matter more elsewhere: in
// the classic 5-person game roads delayed the modern era by 8 days).
export const ROAD = Object.freeze({ cell: 4, sample: 10, cells: 400, decay: 0.9, busy: 40, far: 8, segment: 8, max: 120, minPeople: 8 });

/** Every ROAD.sample ticks (game.js): walking people of full-detail villages add to their village's traffic. */
export function countTraffic(g) {
  const s = g.s;
  for (const c of g.colonistList()) {
    if (!c.mv) continue;
    const sid = c.settlementId || s.playerSettlement, st = s.settlements?.[sid];
    if (!st || st.fallen || st.detail === 'abstract') continue;
    const k = `${Math.floor(c.x / ROAD.cell)},${Math.floor(c.y / ROAD.cell)}`;
    const T = (st.traffic ||= {});
    if (T[k] === undefined && Object.keys(T).length >= ROAD.cells) continue; // full: only cells already counted grow
    T[k] = (T[k] || 0) + 1;
  }
}

/** Daily (game.js DAILY_JOBS): traffic fades. */
export function fadeTraffic(g) {
  for (const sid of Object.keys(g.s.settlements || {}).sort()) {
    const st = g.s.settlements[sid];
    if (!st.traffic) continue;
    for (const k of Object.keys(st.traffic)) { const v = Math.floor(st.traffic[k] * ROAD.decay); if (v > 0) st.traffic[k] = v; else delete st.traffic[k]; }
    if (!Object.keys(st.traffic).length) delete st.traffic;
  }
}

const roadOpen = (g, x, y, sid) => g.inB(x, y) && tileUsable(g, x, y, sid) && g.terrainAt(x, y).buildable && !g.structIdAt(g.i(x, y)) && !g.nodeAt(x, y) && !g.fieldAt(x, y) && !g.cropAt(x, y) && !g.stackAt(x, y) && !g.zoneAt(g.i(x, y));

/** The planner (planner.js planSettlement): maybe lay the next stretch of road. Returns the tiles started, or 0. */
export function planRoads(g, P, sid) {
  const s = g.s, st = s.settlements?.[sid], T = st?.traffic;
  if (!T || st.fallen || g.owned('colonists', sid).length < ROAD.minPeople) return 0;
  const tpl = g.reg.get('template', 'core:road_run'), roadTerrain = g.reg.get('building', 'core:road')?.road?.terrain;
  if (!tpl || !roadTerrain) return 0;
  const mine = g.owned('structures', sid).filter((b) => g.bDef(b)?.road);
  if (mine.some((b) => !b.built) || mine.length >= ROAD.max) return 0; // one stretch at a time; a cap
  const c = st.center || s.center;
  let best = null;
  for (const k of Object.keys(T).sort()) {
    const [cx, cy] = k.split(',').map(Number), x = cx * ROAD.cell + 1, y = cy * ROAD.cell + 1;
    if (Math.hypot(x - c.x, y - c.y) < ROAD.far || T[k] < ROAD.busy) continue;
    if (!best || T[k] > best.n) best = { k, n: T[k], x, y };
  }
  if (!best) return 0;
  const path = findPath(g, c.x, c.y, best.x, best.y, 'adj', 20000);
  if (!path?.length) return 0;
  const tiles = [];
  for (const p of path) {
    if (tiles.length >= Math.min(ROAD.segment, ROAD.max - mine.length)) break;
    if (g.terrainAt(p.x, p.y).id === roadTerrain) continue; // already road
    if (roadOpen(g, p.x, p.y, sid)) tiles.push(p);
  }
  if (!tiles.length) return 0;
  for (const p of tiles) createProject(g, tpl, { x: p.x, y: p.y, rot: 0 }, { urgency: 0.3, why: 'Road', owner: sid });
  g.log(`The colonists of ${st.name} are laying a road (${tiles.length} section${tiles.length === 1 ? '' : 's'}) where they walk most (${best.n} walkers counted there).`, 'build', null, 0, { kind: 'core:road', sids: [sid], at: tiles[0] });
  return tiles.length;
}
