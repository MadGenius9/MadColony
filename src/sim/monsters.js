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
import { injure } from './health.js';
import { roomAt } from './heat.js';
import { destroyCrop, destroyStructures } from './ruin.js';
import { buildingFlammable } from './fire.js';
import { endJob } from './ai/ai.js';

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

/** Game.tick: lairs on the first tick; each monster's hour (staggered by id); near ones act every STEP ticks;
 *  lairs regrow monsters. */
export function tickMonsters(g) {
  if (!g.s.monsters) { if (!monsterSpecies(g).length) return; placeLairs(g); }
  const s = g.s, M = s.monsters, slot = s.tick % HOUR;
  for (const id of Object.keys(M.list).sort(byId)) {
    const m = M.list[id];
    if (!m) continue;
    const h = hash(id);
    if (h % HOUR === slot) hourly(g, m);
    if (m.near !== undefined && h % STEP === s.tick % STEP && M.list[id]) act(g, m);
  }
  if (slot === 37 && s.tick % TICKS_PER_DAY === 37) for (const id of Object.keys(M.lairs).sort(byId)) regrow(g, M.lairs[id]);
}

function hourly(g, m) {
  const d = g.reg.get('monster', m.sp), day = Math.floor(g.s.tick / TICKS_PER_DAY);
  if (!d) return;
  const dist = Math.min(...anchors(g).map((p) => Math.hypot(p.x - m.x, p.y - m.y)));
  if (m.near === undefined && dist <= NEAR) m.near = g.s.tick; // near a full-detail village: it acts every STEP ticks
  else if (m.near !== undefined && dist > NEAR + 16 && g.s.tick - m.near >= TICKS_PER_DAY) delete m.near;
  if (m.near !== undefined || m.day === day) return;
  m.day = day;
  roam(g, m, d, day);
}

// ---------------- near monsters (slice 2) ----------------
// Within NEAR tiles of a full-detail village a monster acts every STEP ticks (by its `behaviour`):
// - trample (Thornback): charges anyone outdoors within DEN tiles of its lair, or who hurt it; at dawn, until it
//   has trampled a few crops that day, it goes for the nearest field within FIELD tiles of its lair and tramples
//   every crop it walks over (destroyCrop); else it roots about near its den.
// - stalk (Gloomstalker): at night it goes for the weakest person outdoors and alone within STALK tiles (never in a
//   room, never near a fire); by day it goes back to its cave.
// - tear (Barkmaw): it walks to the nearest built wooden part (flammable 0.5 or more) within TEAR tiles and tears
//   it down after TEAR_WORK ticks beside it (destroyStructures: goods dropped, the village rebuilds); stone stops
//   it; it crushes anyone next to it.
// Fire hurts every monster standing in it (BURN a step); a Barkmaw burns twice as fast.
// The owner's answer 3: a village of SMALL or fewer people is never wiped out: its people and buildings are left
// alone (its fields may still be trampled). Steps: passable tiles, never diagonally between two blocked ones.
const NEAR = 40, STEP = 10, DEN = 8, FIELD = 40, STALK = 30, TEAR = 30, TEAR_WORK = 100, BURN = 25, SMALL = 3, COOL = 40, FEAST = 3;
const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
const WOUND = { trample: ['gore', 'Gored by a Thornback'], stalk: ['maul', 'Mauled by a Gloomstalker'], tear: ['crush', 'Crushed by a Barkmaw'] };

/** Full-detail village centres (where monsters become near). */
function anchors(g) {
  const out = [];
  for (const id of Object.keys(g.s.settlements || {}).sort(byId)) { const v = g.s.settlements[id]; if (v.center && !v.fallen && v.detail !== 'abstract') out.push(v.center); }
  if (!out.length && g.s.center) out.push(g.s.center);
  return out;
}
/** People of full-detail villages that monsters may hurt (not of a village of SMALL or fewer), in id order (per tick). */
function prey(g) {
  if (g._mnPrey?.tick === g.s.tick) return g._mnPrey.list;
  const list = [];
  for (const [sid, m] of g.ownIndex('colonists')) {
    const v = g.s.settlements?.[sid];
    if (v?.detail === 'abstract' || m.size <= SMALL) continue;
    for (const c of m.values()) if (!c.carriedBy) list.push(c);
  }
  list.sort((a, b) => byId(a.id, b.id));
  return (g._mnPrey = { tick: g.s.tick, list }).list;
}
const smallVillage = (g, sid) => g.owned('colonists', sid || g.s.playerSettlement).length <= SMALL;
const burning = (g, x, y) => !!g.s.disasters?.fires && Object.hasOwn(g.s.disasters.fires, g.i(x, y));
const nearFire = (g, x, y, r) => { const F = g.s.disasters?.fires; if (!F) return false; for (const k of Object.keys(F)) { const i = Number(k), fx = i % g.W, fy = (i - fx) / g.W; if (Math.abs(fx - x) <= r && Math.abs(fy - y) <= r) return true; } return false; };
const free = (g, m, x, y) => g.isPassable(x, y) && (x === m.x || y === m.y || g.isPassable(x, m.y) || g.isPassable(m.x, y));

/** Steps toward (tx, ty) at the monster's speed (below 1: a step with that chance). */
function walk(g, m, d, tx, ty, key) {
  const n = d.speed >= 1 ? Math.round(d.speed) : draw(`${key}:pace`) < d.speed ? 1 : 0;
  for (let k = 0; k < n; k++) {
    let best = null, bd = Math.hypot(m.x - tx, m.y - ty);
    for (const [dx, dy] of D8) { const x = m.x + dx, y = m.y + dy, dd = Math.hypot(x - tx, y - ty); if (dd < bd && free(g, m, x, y)) { bd = dd; best = [x, y]; } }
    if (!best) return;
    m.x = best[0]; m.y = best[1];
    if (d.behaviour === 'trample') trample(g, m, d);
  }
}
function trample(g, m, d) {
  const cr = g.cropAt(m.x, m.y);
  if (!cr) return;
  destroyCrop(g, cr.id);
  m.trampled = (m.trampled || 0) + 1;
  g.log(`A ${d.name} trampled crops in the fields!`, 'warn', `monster-trample:${m.id}`, 1200);
}

/** Strike person c (adjacent): a wound by kind, wakes them, a letter. */
function strike(g, m, d, c, key) {
  if (g.s.tick < (m.cd || 0)) return;
  m.cd = g.s.tick + COOL;
  const [kind, cause] = WOUND[d.behaviour] || ['wound', `Hurt by a ${d.name}`], [lo, hi] = d.damage;
  const mine = (c.settlementId || g.s.playerSettlement) === g.s.playerSettlement;
  injure(g, c, kind, lo + Math.floor(draw(`${key}:hit`) * (hi - lo + 1)), cause, false, mine ? 'warn' : 'info');
  if (c.sleeping) { c.sleeping = false; if (c.job?.type === 'sleep') endJob(g, c, null, `Woken by a ${d.name}`); }
  g.log(`A ${d.name} attacked ${c.name}!`, mine ? 'warn' : 'info', `monster:${c.id}`, 600);
  if (c.health?.down) m.fed = Math.floor(g.s.tick / TICKS_PER_DAY); // a kill (or a downed one): it has had its fill today
}

/** One step of a near monster. */
function act(g, m) {
  const s = g.s, d = g.reg.get('monster', m.sp), lair = s.monsters.lairs[m.lair];
  if (!d || !lair) return;
  const key = `${s.seed}:${m.id}:${s.tick}`, day = Math.floor(s.tick / TICKS_PER_DAY), hour = g.hour;
  if (burning(g, m.x, m.y)) { // fire hurts it
    m.hp -= BURN * (d.behaviour === 'tear' ? 2 : 1);
    if (m.hp <= 0) { killMonster(g, m.id, 'burned'); g.log(`The ${d.name} burned to death.`, 'info', `monster-dead:${m.id}`); return; }
  }
  if (m.trampled && m.tday !== day) { m.trampled = 0; m.tday = day; }
  const angry = m.angry && m.angry.until > s.tick ? s.colonists[m.angry.cid] : null;
  if (d.behaviour === 'trample') {
    const near = angry && !smallVillage(g, angry.settlementId) ? angry : prey(g).find((c) => !roomAt(g, Math.round(c.x), Math.round(c.y)) && Math.hypot(c.x - lair.x, c.y - lair.y) <= DEN);
    if (near) { chase(g, m, d, near, key); return; }
    if (hour >= 5 && hour < 9 && (m.trampled || 0) < FEAST) { // dawn: the fields
      const f = nearestCrop(g, lair, FIELD);
      if (f) { walk(g, m, d, f.x, f.y, key); return; }
    }
    wander(g, m, d, lair, 5, key);
    return;
  }
  if (d.behaviour === 'stalk') {
    const night = hour >= 21 || hour < 5;
    if (night && m.fed !== day) {
      const c = angry && !smallVillage(g, angry.settlementId) ? angry : weakest(g, m);
      if (c) { chase(g, m, d, c, key); return; }
    }
    if (!night) { walk(g, m, d, lair.x, lair.y, key); return; } // back to its cave by day
    wander(g, m, d, m, 3, key);
    return;
  }
  if (d.behaviour === 'tear') {
    for (const c of prey(g)) if (Math.max(Math.abs(Math.round(c.x) - m.x), Math.abs(Math.round(c.y) - m.y)) <= 1) { strike(g, m, d, c, key); break; }
    const t = woodenPart(g, m);
    if (!t) { wander(g, m, d, lair, 4, key); return; }
    if (Math.max(Math.abs(t.x - m.x), Math.abs(t.y - m.y)) > 1) { walk(g, m, d, t.x, t.y, key); m.work = 0; return; }
    m.work = (m.work || 0) + STEP;
    if (m.work < TEAR_WORK) return;
    m.work = 0;
    const name = g.bDef(t)?.name?.toLowerCase() || 'a building';
    destroyStructures(g, [t.id], { reason: null, why: `A ${d.name} tore it down` });
    g.log(`A ${d.name} tore down ${name}${t.settlement ? ` in ${g.s.settlements[t.settlement]?.name || 'a village'}` : ''}!`, 'warn', `monster-tear:${m.id}`, 300);
  }
}

function chase(g, m, d, c, key) {
  const cx = Math.round(c.x), cy = Math.round(c.y);
  if (Math.max(Math.abs(cx - m.x), Math.abs(cy - m.y)) > 1) { walk(g, m, d, cx, cy, key); return; }
  strike(g, m, d, c, key);
}
function wander(g, m, d, home, r, key) {
  if (Math.hypot(m.x - home.x, m.y - home.y) > r) { walk(g, m, d, home.x, home.y, key); return; }
  if (draw(`${key}:idle`) < 0.7) return;
  const [dx, dy] = D8[Math.floor(draw(`${key}:dir`) * 8) % 8], x = m.x + dx, y = m.y + dy;
  if (Math.hypot(x - home.x, y - home.y) <= r && free(g, m, x, y)) { m.x = x; m.y = y; if (d.behaviour === 'trample') trample(g, m, d); }
}
/** The nearest crop within r of (p.x, p.y), by distance then id. */
function nearestCrop(g, p, r) {
  let best = null, bd = Infinity;
  for (const c of Object.values(g.s.crops || {})) { const dd = Math.hypot(c.x - p.x, c.y - p.y); if (dd <= r && (dd < bd || (dd === bd && c.id < best.id))) { bd = dd; best = c; } }
  return best;
}
/** The weakest person outdoors and alone within STALK tiles of the stalker, away from fire; or null. */
function weakest(g, m) {
  let best = null, bs = Infinity;
  for (const c of prey(g)) {
    const cx = Math.round(c.x), cy = Math.round(c.y), dist = Math.hypot(cx - m.x, cy - m.y);
    if (dist > STALK || roomAt(g, cx, cy) || nearFire(g, cx, cy, 4)) continue;
    const others = prey(g).filter((o) => o !== c && Math.hypot(o.x - c.x, o.y - c.y) <= 4).length;
    if (others > 0) continue; // only the lone
    const hp = 100 - (c.health?.injuries || []).reduce((a, i) => a + i.severity, 0);
    const sc = dist + hp / 10 - (c.health?.down ? 20 : 0); // near, hurt or down first
    if (sc < bs || (sc === bs && c.id < best.id)) { bs = sc; best = c; }
  }
  return best;
}
/** The nearest built wooden part within TEAR of the Barkmaw (not of a village of SMALL or fewer); or null. */
function woodenPart(g, m) {
  let best = null, bd = Infinity;
  for (const st of Object.values(g.s.structures)) {
    if (!st.built) continue;
    const dd = Math.hypot(st.x - m.x, st.y - m.y);
    if (dd > TEAR || dd > bd || buildingFlammable(g, g.bDef(st)) < 0.5 || smallVillage(g, st.settlement)) continue;
    if (dd < bd || st.id < best.id) { bd = dd; best = st; }
  }
  return best;
}

/** A person hurts monster id (slice 3 fights): health down, it turns on them. Returns true when it died. */
export function woundMonster(g, id, dmg, c) {
  const m = g.s.monsters?.list[id];
  if (!m) return false;
  m.hp -= dmg;
  if (c) m.angry = { cid: c.id, until: g.s.tick + 600 };
  return m.hp <= 0;
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

/** A monster of species sp sent to (x, y) (the god power, slice 4; tests): it makes its lair there and is counted
 *  as sent. It is near at once when a full-detail village is within NEAR. Returns it. */
export function sendMonster(g, sp, x, y) {
  if (!g.s.monsters) g.s.monsters = { lairs: {}, list: {}, next: 1, ledger: {} };
  const d = g.reg.get('monster', sp), lair = newLair(g, d, x, y), m = newMonster(g, d, lair);
  ledgerOf(g, sp).sent++;
  if (anchors(g).some((p) => Math.hypot(p.x - x, p.y - y) <= NEAR)) m.near = g.s.tick;
  return m;
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
