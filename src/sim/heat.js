// Seasons, rooms and heating (Phase 4). The outdoor temperature follows the seasons and the time of day
// (climate comes from the world's data). Rooms are areas closed off by built walls and doors; each room
// has a temperature that drifts toward the outdoor one and is raised by heaters inside it. Hearths burn
// fuel from their own store, electric heaters use power; both run only while their room is below its
// target. Sleeping somewhere cold restores energy more slowly. Rooms are derived from the buildings and
// never saved; each room's temperature is saved under its first tile (`s.rooms`).
import { interactionSpot } from './construction.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY } from './constants.js';
import { powerAt, isBroken, busyHooks, fuelLoaded } from './power.js';

export const HEAT = {
  tick: 50, // ticks between temperature updates
  loss: 0.12, // share of the indoor/outdoor difference lost per hour through walls
  maxRoom: 160, // larger enclosed areas count as outdoors
  coldSleep: 5, // below this (°C) sleep restores energy more slowly
  bodyHeat: 0.3, // °C per hour each person adds to a 10-tile room
  coldSleepFactor: 0.75,
  target: 18, // heaters run while their room is below this
};
const DEFAULT_CLIMATE = { yearDays: 30, summer: 22, winter: -6, daySwing: 5 };
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];

export function climateOf(g) { return { ...DEFAULT_CLIMATE, ...(g.reg.get('worldgen', g.s.worldgenId)?.climate || {}) }; }

/** The season's average temperature (°C) at a tick, without the day/night swing. */
/** Part of the key of every cache of temperatures over a time window: the Endless season law changes them all. */
export const seasonLawKey = (g) => g.s.worldLaws?.set?.['core:season'] || '';
/** The day of the year's cycle the seasons follow: the real day, or under the Endless season law
 *  (worldlaws.js) midsummer or midwinter for good (the warmest point is a quarter year in, the coldest three
 *  quarters). Read straight from the state: O(1). */
function seasonDay(g, tick, c) {
  const v = g.s.worldLaws?.set?.['core:season'];
  if (v === 'summer') return c.yearDays * 0.25;
  if (v === 'winter') return c.yearDays * 0.75;
  return tick / TICKS_PER_DAY;
}
export function seasonalTemp(g, tick = g.s.tick) {
  const c = climateOf(g);
  const day = seasonDay(g, tick, c);
  return (c.summer + c.winter) / 2 - ((c.summer - c.winter) / 2) * Math.cos((2 * Math.PI * (day - c.yearDays * 0.75)) / c.yearDays);
}
/** Outdoor temperature (°C) at a tick: day 1 starts in spring; the coldest point is in the middle of winter. */
export function outdoorTemp(g, tick = g.s.tick) {
  const c = climateOf(g);
  const day = seasonDay(g, tick, c);
  const mean = (c.summer + c.winter) / 2, amp = (c.summer - c.winter) / 2;
  const season = mean - amp * Math.cos((2 * Math.PI * (day - c.yearDays * 0.75)) / c.yearDays);
  const hour = (tick % TICKS_PER_DAY) / TICKS_PER_HOUR;
  return Math.round((season - c.daySwing * Math.cos((2 * Math.PI * (hour - 3)) / 24)) * 10) / 10; // coldest ~03:00
}
export function seasonOf(g, tick = g.s.tick) {
  const c = climateOf(g);
  const d = ((seasonDay(g, tick, c) + c.yearDays / 8) % c.yearDays) / c.yearDays; // seasons centred on mid-summer and mid-winter
  return SEASONS[Math.min(3, Math.floor(d * 4))];
}
/** The coldest outdoor temperature over the next `days` days (planners look ahead). */
export function coldestAhead(g, days) {
  let m = Infinity;
  for (let h = 0; h <= days * 24; h += 3) m = Math.min(m, outdoorTemp(g, g.s.tick + h * TICKS_PER_HOUR));
  return m;
}

const isBoundary = (g, x, y) => { const st = g.structAt(x, y); if (!st || !st.built) return false; const cat = g.bDef(st)?.category; return cat === 'wall' || cat === 'door'; };

/** Rooms: { roomAt: Int32Array (room index or -1), rooms: [{ key, tiles, area }] }, rooms in key order.
 *  Cached until walls change. A room is a 4-connected area of non-wall tiles that does not touch the map
 *  edge and has at most HEAT.maxRoom tiles; its key is its smallest tile index.
 *  Every rebuild returns a new object, but its roomAt array is updated in place (only the tiles of the rooms
 *  that changed), so a result must not be kept across a wall change: always ask rooms(g) again. (Copying the
 *  per-tile array on every wall change cost 12 MB and several ms a time on the largest maps.) */
export function rooms(g) {
  if (g._rooms && g._rooms.v === g.pathVersion) return g._rooms;
  // Rooms depend only on where built walls and doors stand. Most path changes (a tree felled, a rock
  // mined, a bed built) leave those alone: then the old rooms are kept. When walls do change, only the
  // areas touching the changed tiles are flooded again (a room can only change there).
  const W = g.W, H = g.H, R0 = g._rooms;
  // Scratch kept between rebuilds: the wall flag and flood marks per tile (5 bytes a tile); the walls standing
  // now and the tiles of rooms found in this rebuild are sets (few tiles), not per-tile arrays.
  const work = R0?.work || { wall: new Uint8Array(W * H), seen: new Int32Array(W * H), gen: 0, walls: [] };
  ++work.gen; // (marked the walls standing now, when that was a per-tile array: kept so flood ids stay as before)
  // Built walls and doors now; unchanged when there are as many as before and all of them stood before.
  const walls = [];
  let same = !!R0;
  for (const st of g.structsWhere('wallDoor', (b) => { const cat = g.bDef(b)?.category; return cat === 'wall' || cat === 'door'; })) {
    if (!st.built) continue;
    const cat = g.bDef(st)?.category;
    if (cat !== 'wall' && cat !== 'door') continue;
    const i = st.y * W + st.x;
    walls.push(i);
    if (!work.wall[i]) same = false;
  }
  if (same && walls.length === work.walls.length) { R0.v = g.pathVersion; return R0; }
  const wall = work.wall;
  const changed = [], now = new Set(walls);
  for (const i of walls) if (!wall[i]) changed.push(i);
  for (const i of work.walls) if (!now.has(i)) changed.push(i);
  for (const i of changed) wall[i] = now.has(i) ? 1 : 0;
  work.walls = walls;
  const flood = (i0, seen, cap, id) => { // the area of i0, up to cap + 1 tiles; open = touches the edge or too big
    const tiles = [i0]; seen[i0] = id;
    let open = false;
    for (let k = 0; k < tiles.length; k++) {
      const i = tiles[k], x = i % W, y = (i - x) / W;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) open = true;
      if (tiles.length > cap) { open = true; break; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (seen[j] === id || wall[j]) continue;
        seen[j] = id; tiles.push(j);
      }
    }
    return { tiles, open: open || tiles.length > HEAT.maxRoom };
  };
  let list;
  const roomAt = R0 ? R0.roomAt : new Int32Array(W * H).fill(-1);
  if (!R0) {
    list = [];
    const id = ++work.gen; // one id for the whole scan: every flood here is complete
    for (let i0 = 0; i0 < W * H; i0++) {
      if (work.seen[i0] === id || wall[i0]) continue;
      const f = flood(i0, work.seen, Infinity, id);
      if (!f.open) list.push({ key: String(Math.min(...f.tiles)), tiles: f.tiles, area: f.tiles.length });
    }
  } else {
    // Tiles whose wall flag changed, and their neighbours: only areas through them can differ.
    const seeds = [];
    for (const i of changed) {
      const x = i % W, y = (i - x) / W;
      seeds.push(i);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) seeds.push(ny * W + nx); }
    }
    const drop = new Set();
    for (const i of seeds) if (roomAt[i] >= 0) drop.add(roomAt[i]);
    list = R0.rooms.filter((r, k) => !drop.has(k));
    for (const k of drop) for (const i of R0.rooms[k].tiles) roomAt[i] = -1;
    // Each seed floods afresh, with its own id (a flood cut short at the size cap must not wall off the
    // next one); seeds inside a room found in this rebuild are skipped.
    ++work.gen; // (the id that marked tiles of rooms found here, when those marks were a per-tile array)
    const inRoom = new Set();
    for (const i of seeds) {
      if (inRoom.has(i) || wall[i]) continue;
      const f = flood(i, work.seen, HEAT.maxRoom, ++work.gen);
      if (!f.open) { list.push({ key: String(Math.min(...f.tiles)), tiles: f.tiles, area: f.tiles.length }); for (const t of f.tiles) inRoom.add(t); }
    }
    list.sort((a, b) => Number(a.key) - Number(b.key));
  }
  for (let k = 0; k < list.length; k++) for (const i of list[k].tiles) roomAt[i] = k;
  g._rooms = { v: g.pathVersion, work, roomAt, rooms: list };
  return g._rooms;
}
/** The room at a tile, or null outdoors. */
export function roomAt(g, x, y) { const R = rooms(g); const r = R.roomAt[y * g.W + x]; return r >= 0 ? R.rooms[r] : null; }
/** Temperature at a tile: its room's, or the outdoor one. */
export function tempAt(g, x, y) {
  const r = roomAt(g, x, y);
  return r ? (g.s.rooms?.[r.key] ?? outdoorTemp(g)) : outdoorTemp(g);
}
/** Where a heater sits: heaters stand in a wall-side slot, so use the room beside them. */
function heaterRoom(g, st) {
  const own = roomAt(g, st.x, st.y);
  if (own) return own;
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) { const r = roomAt(g, st.x + dx, st.y + dy); if (r) return r; }
  return null;
}
/** Does this heater's room want heat (below its target)? Ignores fuel and power. */
export function heaterWants(g, st) {
  const h = g.bDef(st)?.heat;
  if (!h || !st.built || isBroken(st)) return false;
  const r = heaterRoom(g, st);
  const t = r ? (g.s.rooms?.[r.key] ?? outdoorTemp(g)) : outdoorTemp(g);
  return t < (h.target ?? HEAT.target);
}
/** Is this heater running now (its room wants heat, and it has fuel or power)? */
export function heaterOn(g, st) {
  const h = g.bDef(st)?.heat;
  if (!heaterWants(g, st)) return false;
  if (h.fuel) return (st.burn || 0) > 0 || fuelLoaded(st) > 0;
  if (g.bDef(st).power?.use) return powerAt(g, st).ratio > 0;
  return true;
}

/** Update room temperatures; heaters burn fuel while on. */
export function tickHeat(g) {
  if (g.s.tick % HEAT.tick) return;
  const R = rooms(g);
  const out = outdoorTemp(g);
  const prev = g.s.rooms || {};
  const next = {};
  const heatIn = new Map();
  for (const st of g.structsWhere('heat', (b) => !!g.bDef(b)?.heat)) {
    const h = g.bDef(st)?.heat;
    if (!h || !heaterOn(g, st)) continue;
    const r = heaterRoom(g, st);
    if (r) heatIn.set(r.key, (heatIn.get(r.key) || 0) + h.output * (g.bDef(st).power?.use ? powerAt(g, st).ratio : 1));
    if (h.fuel) { // burn fuel one unit at a time, like a generator
      if ((st.burn || 0) <= 0) {
        const f = (st.fuel || []).find((x) => x.qty > 0);
        if (f) { f.qty -= 1; st.fuel = st.fuel.filter((x) => x.qty > 0); g.consume(f.item, 1, 'burned for heat'); st.burn = Math.round((h.fuel.burnTicks || 300) * (g.reg.get('item', f.item)?.fuel || 1)); }
      }
      st.burn = Math.max(0, (st.burn || 0) - HEAT.tick);
    }
  }
  for (const c of Object.values(g.s.colonists)) { const r = roomAt(g, c.x, c.y); if (r) heatIn.set(r.key, (heatIn.get(r.key) || 0) + HEAT.bodyHeat); } // people warm a room a little
  const hours = HEAT.tick / TICKS_PER_HOUR;
  for (const r of R.rooms) {
    let t = prev[r.key] ?? out;
    t += (out - t) * Math.min(1, HEAT.loss * hours);
    t += ((heatIn.get(r.key) || 0) * hours * 10) / r.area; // output is °C per hour for a 10-tile room
    next[r.key] = Math.round(Math.max(out - 5, Math.min(35, t)) * 100) / 100;
  }
  g.s.rooms = next;
}

/** Is it the heating season (cold now or within `days` days)? */
export function heatSeason(g, days = 2) {
  const k = Math.floor(g.s.tick / (TICKS_PER_DAY / 4)) + ':' + days + ':' + seasonLawKey(g);
  g._heatSeason ||= {};
  if (g._heatSeason[k] === undefined) { let m = Infinity; const t0 = Math.floor(g.s.tick / (TICKS_PER_DAY / 4)) * (TICKS_PER_DAY / 4); for (let d = 0; d <= days; d += 0.25) m = Math.min(m, seasonalTemp(g, t0 + d * TICKS_PER_DAY)); if (Object.keys(g._heatSeason).length > 8) g._heatSeason = {}; g._heatSeason[k] = m < HEAT.coldSleep + 2; }
  return g._heatSeason[k];
}
/** Where to stand to load a building: its interaction spot, or a free tile beside it (inside its room first). */
export function refuelSpot(g, st) {
  const def = g.bDef(st);
  if (def?.interaction) return interactionSpot(g, st); // follows the building's rotation
  let best = null;
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const x = st.x + dx, y = st.y + dy;
    if (!g.inB(x, y) || !g.isPassable(x, y)) continue;
    if (roomAt(g, x, y)) return { x, y };
    best ||= { x, y };
  }
  return best;
}

/** Sleep restores energy more slowly in the cold. */
export const sleepWarmth = (g, c) => (tempAt(g, c.x, c.y) < HEAT.coldSleep ? HEAT.coldSleepFactor : 1);

// Electric heaters draw power only while they are running.
busyHooks.push((g, st) => (g.bDef(st)?.heat && g.bDef(st).power?.use ? heaterWants(g, st) : undefined));
