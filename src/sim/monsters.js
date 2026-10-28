// Wild monsters (Phase 8c, docs/proposals/phase-8c-wild-monsters.md). Original creatures of this game (data:
// mods/core/content/monsters.json): a Thornback, a Gloomstalker, a Barkmaw. Each lives alone at a lair.
//
// State s.monsters = { lairs: id -> { id, sp, x, y, monster, since?, cleared? }, list: id -> { id, sp, x, y, hp,
// lair, day }, next, ledger: species -> { start, born, sent, died: { cause: n } } } (saved; format 29).
// - Lairs are placed on the first tick (old saves: the next tick): about one per perTiles tiles of the species'
//   terrains, at least FAR tiles from every village and two chunks from other lairs, by hash. Every game has at
//   least minWorld lairs of the species with the most ground (the owner's answer 1): on a map too small for FAR,
//   on its fitting tile farthest from the villages (at least MIN_FAR away).
// - Far from people (slice 1) a monster is a record: once a day it roams to a tile of its ground within `roam`
//   chunks of its lair (by hash), and back to its lair every other day.
// - A lair whose monster is gone grows a new one after respawnDays, unless it was cleared.
// - The ledger records every monster born, sent and dead (by cause), and monsterCensus checks it.
// No g.rng draws: all choices are hashes of the seed, ids and days. Cost: placement once (one pass over the map
// per species); then each monster once an hour (staggered by id), its daily roam O(1).
import { TICKS_PER_DAY, CHUNK } from './constants.js';

const HOUR = 100, FAR = 80, MIN_FAR = 20, LAIR_GAP = 2 * CHUNK;
const hash = (str) => {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};
const draw = (key) => hash(key) / 4294967296;
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The species this game has (scenario.monsters.species, default: every species in data), in id order. */
export function monsterSpecies(g) {
  if (g._mnSpFor !== g.s.scenarioId) {
    const R = g.reg.get('scenario', g.s.scenarioId)?.monsters;
    const ids = R?.species ?? g.reg.all('monster').map((d) => d.id);
    g._mnSp = ids.map((id) => g.reg.get('monster', id)).filter(Boolean).sort((a, b) => byId(a.id, b.id));
    g._mnScale = R?.scale ?? 1;
    g._mnSpFor = g.s.scenarioId;
  }
  return g._mnSp;
}

/** Village centres (standing), or the classic map centre. */
function centres(g) {
  const out = Object.keys(g.s.settlements || {}).sort().map((id) => g.s.settlements[id]).filter((v) => v.center && !v.fallen).map((v) => v.center);
  if (!out.length && g.s.center) out.push(g.s.center);
  return out;
}
const nearestCentre = (C, x, y) => C.reduce((m, c) => Math.min(m, Math.hypot(c.x - x, c.y - y)), Infinity);
const fits = (g, d, x, y) => { const t = g.terrainAt(x, y); return t.passable && !t.drinkable && d.terrains.includes(t.id) && g.isPassable(x, y); };

function ledgerOf(g, sp) {
  const M = g.s.monsters;
  M.ledger ||= {};
  return (M.ledger[sp] ||= { start: 0, born: 0, sent: 0, died: {} });
}

/** A new monster of species d at its lair (or (x, y)); returns it. */
function newMonster(g, d, lair, x = lair.x, y = lair.y) {
  const M = g.s.monsters, id = `m${M.next++}`;
  M.list[id] = { id, sp: d.id, x, y, hp: d.health, lair: lair.id, day: Math.floor(g.s.tick / TICKS_PER_DAY) };
  lair.monster = id; delete lair.since;
  return M.list[id];
}
function newLair(g, d, x, y) {
  const M = g.s.monsters, id = `l${M.next++}`;
  M.lairs[id] = { id, sp: d.id, x, y, monster: null };
  return M.lairs[id];
}

/** Place the lairs and their monsters (the first tick of a game without s.monsters). */
function placeLairs(g) {
  const s = g.s, C = centres(g), sp = monsterSpecies(g);
  s.monsters = { lairs: {}, list: {}, next: 1, ledger: {} };
  const ground = new Map(), placed = [], idx = g._ts.idx, pal = g.terrainPalette, perTerrain = new Float64Array(pal.length);
  for (let i = 0; i < idx.length; i++) perTerrain[idx[i]]++; // tiles of each terrain, once
  for (const d of sp) {
    let n = 0;
    for (let k = 0; k < pal.length; k++) if (perTerrain[k] && d.terrains.includes(pal[k])) n += perTerrain[k];
    ground.set(d.id, n);
    const e = (n / d.perTiles) * g._mnScale, want = Math.floor(e) + (draw(`${s.seed}:lairs:${d.id}`) < e - Math.floor(e) ? 1 : 0);
    // Candidate spots: chunk by chunk in hash order, a few tries in each.
    const order = Array.from({ length: g.CW * g.CH }, (_, c) => [hash(`${s.seed}:${d.id}:c${c}`), c]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const chunks = order.map((e) => e[1]);
    for (const c of chunks) {
      if (placed.filter((l) => l.sp === d.id).length >= want) break;
      const cx = (c % g.CW) * CHUNK, cy = Math.floor(c / g.CW) * CHUNK;
      for (let k = 0; k < 6; k++) {
        const x = cx + Math.floor(draw(`${s.seed}:${d.id}:c${c}:x${k}`) * CHUNK), y = cy + Math.floor(draw(`${s.seed}:${d.id}:c${c}:y${k}`) * CHUNK);
        if (!g.inB(x, y) || !fits(g, d, x, y) || nearestCentre(C, x, y) < FAR || placed.some((l) => Math.hypot(l.x - x, l.y - y) < LAIR_GAP)) continue;
        placed.push({ sp: d.id, x, y });
        break;
      }
    }
  }
  // Every game has at least one (the owner's answer 1): the species with minWorld and the most ground, on its
  // fitting tile farthest from the villages (at least MIN_FAR away).
  const d = sp.filter((e) => e.minWorld && ground.get(e.id) > 0).sort((a, b) => ground.get(b.id) - ground.get(a.id) || byId(a.id, b.id))[0];
  if (d && !placed.some((l) => g.reg.get('monster', l.sp)?.minWorld)) {
    let far = null, fd = MIN_FAR - 1e-9;
    const step = Math.max(1, Math.floor(Math.sqrt((g.W * g.H) / 40000)));
    for (let y = 0; y < g.H; y += step) for (let x = 0; x < g.W; x += step) {
      if (!fits(g, d, x, y)) continue;
      const dist = nearestCentre(C, x, y);
      if (dist > fd) { fd = dist; far = { sp: d.id, x, y }; }
    }
    if (far) placed.push(far);
  }
  for (const p of placed) {
    const d = g.reg.get('monster', p.sp), lair = newLair(g, d, p.x, p.y);
    newMonster(g, d, lair);
    ledgerOf(g, d.id).start++;
  }
}

/** Game.tick: lairs on the first tick; each monster's hour (staggered by id); lairs regrow monsters. */
export function tickMonsters(g) {
  if (!g.s.monsters) { if (!monsterSpecies(g).length) return; placeLairs(g); }
  const s = g.s, M = s.monsters, slot = s.tick % HOUR;
  for (const id of Object.keys(M.list).sort(byId)) if (hash(id) % HOUR === slot) hourly(g, M.list[id]);
  if (slot === 37 && s.tick % TICKS_PER_DAY === 37) for (const id of Object.keys(M.lairs).sort(byId)) regrow(g, M.lairs[id]);
}

function hourly(g, m) {
  const d = g.reg.get('monster', m.sp), day = Math.floor(g.s.tick / TICKS_PER_DAY);
  if (!d || m.day === day) return;
  m.day = day;
  roam(g, m, d, day);
}

/** Far roaming: every other day back at the lair, else a tile of its ground within `roam` chunks of it. */
function roam(g, m, d, day) {
  const lair = g.s.monsters.lairs[m.lair];
  if (!lair) return;
  if (day % 2 === 0 || !d.roam) { m.x = lair.x; m.y = lair.y; return; }
  const R = d.roam * CHUNK, key = `${g.s.seed}:${m.id}:roam:${day}`;
  for (let k = 0; k < 12; k++) {
    const x = lair.x + Math.round((draw(`${key}:x${k}`) * 2 - 1) * R), y = lair.y + Math.round((draw(`${key}:y${k}`) * 2 - 1) * R);
    if (g.inB(x, y) && fits(g, d, x, y)) { m.x = x; m.y = y; return; }
  }
}

/** A lair without its monster grows a new one after respawnDays (unless cleared). Once a day. */
function regrow(g, lair) {
  if (lair.monster || lair.cleared) return;
  const d = g.reg.get('monster', lair.sp);
  if (!d) return;
  lair.since ??= g.s.tick;
  if (g.s.tick - lair.since < d.respawnDays * TICKS_PER_DAY) return;
  newMonster(g, d, lair);
  ledgerOf(g, d.id).born++;
  g.log(`A new ${d.name} has come to an old lair.`, 'info', 'monster-born', 2400);
}

/** Monster id dies of `cause` (slain, banished...): it leaves its lair empty (which may grow another). */
export function killMonster(g, id, cause) {
  const M = g.s.monsters, m = M?.list[id];
  if (!m) return null;
  delete M.list[id];
  const lair = M.lairs[m.lair];
  if (lair?.monster === id) { lair.monster = null; lair.since = g.s.tick; }
  const L = ledgerOf(g, m.sp).died;
  L[cause] = (L[cause] || 0) + 1;
  return m;
}

/** The monster ledger against the living, per species: { ok, living, problems }. */
export function monsterCensus(g) {
  const M = g.s.monsters, living = {}, problems = [];
  if (!M) return { ok: true, living, problems };
  for (const m of Object.values(M.list)) living[m.sp] = (living[m.sp] || 0) + 1;
  for (const sp of new Set([...Object.keys(living), ...Object.keys(M.ledger || {})])) {
    const L = M.ledger?.[sp] || { start: 0, born: 0, sent: 0, died: {} };
    const dead = Object.values(L.died).reduce((a, b) => a + b, 0), want = L.start + L.born + L.sent - dead, have = living[sp] || 0;
    if (want !== have) problems.push(`${sp}: start ${L.start} + born ${L.born} + sent ${L.sent} - died ${dead} = ${want}, but ${have} are living`);
  }
  return { ok: !problems.length, living, problems };
}

/** Lairs and monsters by species (reports and tests). */
export function monsterSummary(g) {
  const out = {};
  for (const l of Object.values(g.s.monsters?.lairs || {})) { out[l.sp] ||= { lairs: 0, living: 0 }; out[l.sp].lairs++; }
  for (const m of Object.values(g.s.monsters?.list || {})) { out[m.sp] ||= { lairs: 0, living: 0 }; out[m.sp].living++; }
  return out;
}
