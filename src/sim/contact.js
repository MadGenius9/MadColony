// Contact over distance (Phase 2b, slice 5). Scenarios with a `contact` block (data; core:vast_world) let
// villages far apart meet: explorers travel over their landmass, villages whose lands touch meet, and villages
// that have met send traders to each other. Every other scenario has no `contact` block: nothing here runs and
// no state is added (classic and Living worlds are unchanged).
//
// Saved state (format 11, only in games started with a contact block):
//   s.contact = {
//     n: <the last traveller number>,
//     met: { explorers: <pairs met by explorers>, borders: <pairs met because their lands touch> },
//     v: { <sid>: { disc, trips, next, exp, nextTrade, traded } },   (made on a village's first hour)
//       disc: the chunks this village has discovered, 6 bits per character (DISC alphabet, chunk order);
//       trips: expeditions sent; next: the tick the next one may leave; exp: the one out now (id) or null;
//       nextTrade: the tick traders next leave; traded: trader trips sent (they visit contacts in turn).
//     t: { <id>: traveller } }
//   explorer: { id, kind: 'explorer', from, trip, route: [chunk indexes, home first], k, dir (1 out, -1 home),
//               prev (tick it entered route[k]), next (tick it enters the next chunk), depart }
//   trader:   { id, kind: 'trader', from, to, x, y, tx, ty, depart, arrive, back, stage: 'out' | 'home' }
//
// Explorers (no colonist leaves; no items move): every explore.everyDays after the last one came home, a
// village sends an expedition. Its reach grows each trip (firstRange + rangeStep x trips chunk steps, up to
// maxRange). A breadth-first search over the chunks of its landmass (8 neighbours) picks the farthest
// undiscovered chunk within reach, ties broken by a hash of (village, trip, chunk): no random numbers. It
// walks the chunk path out and back at tilesPerDay (diagonal steps x1.4), marking the chunks within `sight`
// discovered, and on entering each chunk meets every village whose land (organic claims) or centre lies in the
// chunk or within `reach` tiles of it.
// Land: a chunk is land when at least minLand of its tiles are walkable; landmasses are the 8-connected groups
// of land chunks. Derived from the terrain (cached per map revision, never saved).
// Traders: every traders.everyDays a village sends traders to the next village it has met (in id order, in
// turn), unless relations are hostile. They travel centre to centre; on arrival the relation gains `relation`
// ("Traders from A visited") and they go home. No goods: trade goods still move only on trade legs (jobs,
// caravans), so conservation is untouched.
// Borders: growClaims (territory.js) reports owner pairs whose land became adjacent in the daily growth.
// Colonists on foot (ai/givers.js), so no one walks off across a planet: scouts aim only at villages within
// scoutRange of home and leave only when fed, watered and rested (scoutNeeds); carers tend only patients within
// tendRange of their centre; trade legs to villages beyond tradeWalkRange go by caravan (lod.js), also from
// villages at full detail, instead of being walked.
//
// Cost: per tick O(1) unless a traveller is due (the earliest due tick is cached); then O(travellers). Per
// explorer step (every ~32/tilesPerDay days): the sight box of chunks, the claim grid over its chunk plus
// reach (about 48 x 48 reads), and one test per village centre. Per expedition launch: one search over at most
// the chunks of the landmass (3072 on World). Hourly: O(villages) schedule checks; traders O(villages) to pick
// a partner. Once per map revision: one pass over the tiles to find land chunks.
// Distant (abstract) villages: exactly the same; nothing here depends on detail or on colonists.
// Slice 6: explorers with explore.around aim at the undiscovered chunk in reach with the most undiscovered land
// round it (a summed-area table per launch, O(chunks)); with pruneTradesDays, finished trades and stale log keys
// are pruned daily (pruneTrades, pruneLogKeys; O(trades + caravans + colonists) and O(keys) once a day).
import { CHUNK, TICKS_PER_DAY, TICKS_PER_HOUR } from './constants.js';
import { spreadContact } from './illness.js';
import { makeContact, changeRelation, relationOf, relationPeek, relationStatus, legRemaining } from './villages.js';
import { octile } from './util.js';
import { detailOf, sendFarCaravans, caravanTicks, caravanReach } from './lod.js';

export { caravanReach }; // for ai/givers.js (far legs: which goods a caravan can load)

export const CONTACT_DEFAULTS = Object.freeze({
  explore: Object.freeze({ firstDays: 1, firstRange: 3, rangeStep: 2, maxRange: 48, sight: 1, reach: 8, minLand: 0.2 }),
  traders: Object.freeze({ firstDays: 2, relation: 1 }),
});
const DISC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const DISC_RE = /^[A-Za-z0-9_-]*$/;
const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

const hash = (str) => { let h = 2166136261; for (let k = 0; k < str.length; k++) h = Math.imul(h ^ str.charCodeAt(k), 16777619); return h >>> 0; };
const nameOf = (g, sid) => g.s.settlements?.[sid]?.name || sid;
const centreOf = (g, sid) => g.s.settlements?.[sid]?.center || g.s.center;

/** The scenario's contact rules merged with the defaults, or null: no contact block, or a game without contact
 *  state (started before slice 5: a format-10 save keeps the old rules everywhere, scouts, carers and trade legs
 *  on foot included, since no explorers or caravans for far legs run there). */
export function contactRules(g) {
  if (!g.s.contact) return null;
  if (g._ctRules !== undefined) return g._ctRules;
  const c = g.reg.get('scenario', g.s.scenarioId)?.contact;
  g._ctRules = c ? {
    explore: c.explore ? { ...CONTACT_DEFAULTS.explore, ...c.explore } : null,
    traders: c.traders ? { ...CONTACT_DEFAULTS.traders, ...c.traders } : null,
    borders: c.borders !== false,
    pruneTradesDays: c.pruneTradesDays, // finished trades are removed this many days after they end (absent: kept)
    // Colonists on foot (ai/givers.js): scouts only toward villages within scoutRange tiles of home and only
    // when eat, drink and sleep needs are all above scoutNeeds; carers only for patients within tendRange.
    scoutRange: c.scoutRange ?? 60, scoutNeeds: c.scoutNeeds ?? 0.7, tendRange: c.tendRange ?? 60,
    // Trade legs to villages farther than tradeWalkRange (centre to centre) go by caravan, also from full villages.
    // (Big worlds only: caravans travel in lod.js, which runs on big worlds.)
    tradeWalkRange: g.big ? c.tradeWalkRange ?? 60 : undefined,
  } : null;
  return g._ctRules;
}

/** Game.create: a scenario with a contact block starts with empty contact state (format 11). */
export function newContactState() { return { n: 0, met: { explorers: 0, borders: 0 }, v: {}, t: {} }; }

// ---------------- discovered chunks ----------------
/** Characters needed for a bitset of n chunks. */
export const discLength = (n) => Math.ceil(n / 6);
function decodeDisc(str, n) {
  const bits = new Uint8Array(n);
  for (let k = 0; k < str.length; k++) {
    const v = DISC.indexOf(str[k]);
    for (let b = 0; b < 6; b++) { const c = k * 6 + b; if (c < n && (v >> b) & 1) bits[c] = 1; }
  }
  return bits;
}
function encodeDisc(bits) {
  let out = '';
  for (let k = 0; k < bits.length; k += 6) {
    let v = 0;
    for (let b = 0; b < 6 && k + b < bits.length; b++) if (bits[k + b]) v |= 1 << b;
    out += DISC[v];
  }
  return out;
}
/** Save validation: a well-formed bitset for n chunks. */
export function validDisc(str, n) { return typeof str === 'string' && str.length === discLength(n) && DISC_RE.test(str); }

/** Run-time bits of a village's discovered chunks (derived from the saved string; rebuilt if it changed). */
function discBits(g, sid) {
  const v = g.s.contact.v[sid], n = g.CW * g.CH;
  g._ctDisc ||= new Map();
  let e = g._ctDisc.get(sid);
  if (!e || e.str !== v.disc) { e = { str: v.disc, bits: decodeDisc(v.disc, n) }; g._ctDisc.set(sid, e); }
  return e.bits;
}
/** Mark the chunks within `sight` of chunk c discovered (state: the string is rewritten when anything changed). */
function discover(g, sid, c, sight) {
  const bits = discBits(g, sid), CW = g.CW, CH = g.CH, cx = c % CW, cy = (c - cx) / CW;
  let changed = false;
  for (let y = Math.max(0, cy - sight); y <= Math.min(CH - 1, cy + sight); y++) for (let x = Math.max(0, cx - sight); x <= Math.min(CW - 1, cx + sight); x++) {
    const k = y * CW + x;
    if (!bits[k]) { bits[k] = 1; changed = true; }
  }
  if (changed) { const v = g.s.contact.v[sid]; v.disc = encodeDisc(bits); g._ctDisc.get(sid).str = v.disc; }
}
/** Read-only: how many chunks a village has discovered (for reports and the UI). */
export function discoveredCount(g, sid) {
  if (!g.s.contact?.v?.[sid]) return 0;
  let n = 0; for (const b of discBits(g, sid)) n += b;
  return n;
}
/** Read-only: is chunk c discovered by village sid? */
export function isDiscovered(g, sid, c) { return !!(g.s.contact?.v?.[sid] && discBits(g, sid)[c]); }

// ---------------- land (derived) ----------------
/** Land chunks and landmasses: { comp: Int32Array (landmass id, -1 = not land), rep: Int32Array (the walkable
 *  tile nearest the chunk's centre, -1 if none) }. Cached per map revision; one pass over the tiles. */
export function landChunks(g) {
  const key = `${g.s.map.rev || 0}:${g.W}x${g.H}`;
  if (g._ctLand?.key === key) return g._ctLand;
  const R = contactRules(g)?.explore || CONTACT_DEFAULTS.explore;
  const W = g.W, H = g.H, CW = g.CW, CH = g.CH, n = CW * CH, ts = g._ts.idx, pal = g.terrainPalette;
  const pass = new Uint8Array(pal.length);
  for (let k = 0; k < pal.length; k++) pass[k] = g.reg.get('terrain', pal[k])?.passable ? 1 : 0;
  const cnt = new Int32Array(n), rep = new Int32Array(n).fill(-1), best = new Float64Array(n).fill(Infinity);
  for (let y = 0; y < H; y++) {
    const cy = (y / CHUNK) | 0, oy = y - (cy * CHUNK + CHUNK / 2);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!pass[ts[i]]) continue;
      const cx = (x / CHUNK) | 0, c = cy * CW + cx, ox = x - (cx * CHUNK + CHUNK / 2), d = ox * ox + oy * oy;
      cnt[c]++;
      if (d < best[c]) { best[c] = d; rep[c] = i; }
    }
  }
  const comp = new Int32Array(n).fill(-1), land = new Uint8Array(n);
  for (let c = 0; c < n; c++) {
    const cx = c % CW, cy = (c - cx) / CW;
    const area = (Math.min(W, (cx + 1) * CHUNK) - cx * CHUNK) * (Math.min(H, (cy + 1) * CHUNK) - cy * CHUNK);
    land[c] = cnt[c] > 0 && cnt[c] >= R.minLand * area ? 1 : 0;
  }
  let nc = 0;
  const q = new Int32Array(n);
  for (let c0 = 0; c0 < n; c0++) {
    if (!land[c0] || comp[c0] >= 0) continue;
    let h = 0, t = 0; q[t++] = c0; comp[c0] = nc;
    while (h < t) {
      const c = q[h++], cx = c % CW, cy = (c - cx) / CW;
      for (const [dx, dy] of D8) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= CW || y >= CH) continue;
        const m = y * CW + x;
        if (land[m] && comp[m] < 0) { comp[m] = nc; q[t++] = m; }
      }
    }
    nc++;
  }
  return (g._ctLand = { key, comp, rep });
}

/** A village's home chunk on land: its centre's chunk, or the first land neighbour of it; -1 if none. */
function homeChunk(g, L, sid) {
  const c = centreOf(g, sid);
  if (!c) return -1;
  const h = g.chunkOf(c.x, c.y);
  if (L.comp[h] >= 0) return h;
  const CW = g.CW, CH = g.CH, hx = h % CW, hy = (h - hx) / CW;
  let out = -1;
  for (const [dx, dy] of D8) {
    const x = hx + dx, y = hy + dy;
    if (x < 0 || y < 0 || x >= CW || y >= CH) continue;
    const m = y * CW + x;
    if (L.comp[m] >= 0 && (out < 0 || m < out)) out = m;
  }
  return out;
}

/** The landmass of a village's centre (land chunks), -1 if none: sameLandmass(a, b) is
 *  landmassOf(a) >= 0 && landmassOf(a) === landmassOf(b). Read-only. */
export function landmassOf(g, sid) {
  const L = landChunks(g), h = homeChunk(g, L, sid);
  return h >= 0 ? L.comp[h] : -1;
}

/** Are the centres of villages a and b on the same landmass (land chunks; markets.js landReach)? Read-only. */
export function sameLandmass(g, a, b) {
  const L = landChunks(g), ha = homeChunk(g, L, a), hb = homeChunk(g, L, b);
  return ha >= 0 && hb >= 0 && L.comp[ha] === L.comp[hb];
}

/** The tile an explorer stands on in chunk c (its route's first chunk is home: the village centre). */
function chunkPoint(g, L, c, sid, isHome) {
  if (isHome) { const ctr = centreOf(g, sid); return { x: ctr.x, y: ctr.y }; }
  const r = L.rep[c];
  if (r >= 0) return { x: r % g.W, y: (r - (r % g.W)) / g.W };
  const cx = c % g.CW; return { x: Math.min(g.W - 1, cx * CHUNK + CHUNK / 2), y: Math.min(g.H - 1, ((c - cx) / g.CW) * CHUNK + CHUNK / 2) };
}

// ---------------- explorers ----------------
const stepTicks = (g, R, a, b) => {
  const base = Math.max(1, Math.round((CHUNK * TICKS_PER_DAY) / R.tilesPerDay));
  const diag = (a % g.CW) !== (b % g.CW) && Math.floor(a / g.CW) !== Math.floor(b / g.CW);
  return diag ? Math.max(1, Math.round(base * 1.4)) : base;
};

/** Choose the next expedition's route: home first, then the chunk path to the target. Null if there is none. */
function planRoute(g, sid, v, R) {
  const L = landChunks(g), home = homeChunk(g, L, sid);
  if (home < 0) return null;
  const CW = g.CW, CH = g.CH, n = CW * CH, comp = L.comp[home];
  const range = Math.min(R.maxRange, Math.floor(R.firstRange + R.rangeStep * v.trips));
  const dist = new Int32Array(n).fill(-1), par = new Int32Array(n).fill(-1), q = [home];
  dist[home] = 0;
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    if (dist[c] >= range) continue;
    const cx = c % CW, cy = (c - cx) / CW;
    for (const [dx, dy] of D8) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= CW || y >= CH) continue;
      const m = y * CW + x;
      if (dist[m] >= 0 || L.comp[m] !== comp) continue;
      dist[m] = dist[c] + 1; par[m] = c; q.push(m);
    }
  }
  const bits = discBits(g, sid), salt = `${sid}:${v.trips}:`;
  let target = -1, bestKey = -1;
  if (R.around > 0) {
    // Slice 6: toward the most unexplored land. Each undiscovered chunk in reach scores the undiscovered land
    // chunks of its landmass within `around` chunks of it (a summed-area table, O(chunks)) plus farWeight x its
    // distance; the hash breaks ties.
    const S = new Int32Array((CW + 1) * (CH + 1)), A = R.around;
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
      const c = y * CW + x, u = L.comp[c] === comp && !bits[c] ? 1 : 0;
      S[(y + 1) * (CW + 1) + x + 1] = u + S[y * (CW + 1) + x + 1] + S[(y + 1) * (CW + 1) + x] - S[y * (CW + 1) + x];
    }
    let bestS = -1, bestH = -1;
    for (const c of q) {
      if (bits[c]) continue;
      const cx = c % CW, cy = (c - cx) / CW;
      const x0 = Math.max(0, cx - A), y0 = Math.max(0, cy - A), x1 = Math.min(CW - 1, cx + A) + 1, y1 = Math.min(CH - 1, cy + A) + 1;
      const sc = S[y1 * (CW + 1) + x1] - S[y0 * (CW + 1) + x1] - S[y1 * (CW + 1) + x0] + S[y0 * (CW + 1) + x0] + (R.farWeight ?? 1) * dist[c];
      const h = hash(salt + c);
      if (sc > bestS || (sc === bestS && h > bestH)) { bestS = sc; bestH = h; target = c; }
    }
    bestKey = target >= 0 ? 0 : -1;
  }
  // The farthest undiscovered chunk in reach (hash breaks ties); when all is known, any chunk in the outer
  // half of the reach (patrols keep meeting newcomers).
  if (target < 0) for (const c of q) if (!bits[c]) { const key = dist[c] * 2 ** 32 + hash(salt + c); if (key > bestKey) { bestKey = key; target = c; } }
  if (target < 0) for (const c of q) if (c !== home && dist[c] * 2 >= range) { const key = hash(salt + c); if (key > bestKey) { bestKey = key; target = c; } }
  if (target < 0) return null;
  const route = [];
  for (let c = target; c >= 0; c = par[c]) route.push(c);
  return route.reverse();
}

function launchExpedition(g, sid, v, R) {
  const s = g.s, every = Math.max(1, Math.round(R.everyDays * TICKS_PER_DAY));
  const route = planRoute(g, sid, v, R);
  if (!route || route.length < 2) { v.next = s.tick + every; return; }
  const id = 'x' + ++s.contact.n;
  v.trips++;
  v.exp = id;
  s.contact.t[id] = { id, kind: 'explorer', from: sid, trip: v.trips, route, k: 0, dir: 1, prev: s.tick, next: s.tick + stepTicks(g, R, route[0], route[1]), depart: s.tick };
}

/** Villages whose land or centre lies in chunk c or within `reach` tiles of it (sorted ids, not `sid`). */
function villagesNear(g, c, reach, sid) {
  const CW = g.CW, cx = c % CW, cy = (c - cx) / CW;
  const x0 = Math.max(0, cx * CHUNK - reach), y0 = Math.max(0, cy * CHUNK - reach);
  const x1 = Math.min(g.W - 1, (cx + 1) * CHUNK - 1 + reach), y1 = Math.min(g.H - 1, (cy + 1) * CHUNK - 1 + reach);
  const out = new Set();
  for (const [o, st] of Object.entries(g.s.settlements || {})) {
    const ctr = st.center || g.s.center;
    if (o !== sid && ctr && ctr.x >= x0 && ctr.x <= x1 && ctr.y >= y0 && ctr.y <= y1) out.add(o);
  }
  if (g._cl) {
    const grid = g._cl.grid, ids = g.s.claims.ids, W = g.W, seen = new Set();
    for (let y = y0; y <= y1; y++) {
      const row = y * W;
      for (let x = x0; x <= x1; x++) { const k = grid[row + x]; if (k !== 0xffff) seen.add(k); }
    }
    for (const k of seen) { const o = ids[k]; if (o !== sid && g.s.settlements[o]) out.add(o); }
  }
  return [...out].sort();
}

function explorerStep(g, t, R) {
  const s = g.s, v = s.contact.v[t.from];
  if (!s.settlements[t.from] || !v) { delete s.contact.t[t.id]; return; }
  t.k += t.dir;
  t.prev = t.next;
  const c = t.route[t.k];
  discover(g, t.from, c, R.sight);
  for (const o of villagesNear(g, c, R.reach, t.from)) {
    const days = Math.max(1, Math.round((s.tick - t.depart) / TICKS_PER_DAY));
    const a = nameOf(g, t.from), b = nameOf(g, o);
    if (makeContact(g, t.from, o, `Met by explorers from ${a}`, `Explorers from ${a} met the people of ${b} (${days} day${days === 1 ? '' : 's'} out).`)) s.contact.met.explorers++;
  }
  if (t.dir === 1 && t.k === t.route.length - 1) t.dir = -1;
  if (t.dir === -1 && t.k === 0) { // home
    delete s.contact.t[t.id];
    v.exp = null;
    v.next = s.tick + Math.max(1, Math.round(R.everyDays * TICKS_PER_DAY));
    return;
  }
  t.next = t.prev + stepTicks(g, R, c, t.route[t.k + t.dir]);
}

// ---------------- traders ----------------
function launchTraders(g, sid, v, R) {
  const s = g.s, every = Math.max(1, Math.round(R.everyDays * TICKS_PER_DAY));
  v.nextTrade = s.tick + every;
  const met = [];
  for (const o of Object.keys(s.settlements).sort()) {
    if (o === sid) continue;
    const rel = relationPeek(g, sid, o);
    if (rel.contact && relationStatus(rel) !== 'hostile') met.push(o);
  }
  if (!met.length) return;
  const to = met[v.traded % met.length];
  v.traded++;
  // Overland only: a contact on another landmass (or with no land chunk at home) gets no visit this turn.
  const L = landChunks(g), ha = homeChunk(g, L, sid), hb = homeChunk(g, L, to);
  if (ha < 0 || hb < 0 || L.comp[ha] !== L.comp[hb]) return;
  const a = centreOf(g, sid), b = centreOf(g, to);
  const dur = Math.max(1, Math.ceil((octile(a.x, a.y, b.x, b.y) * TICKS_PER_DAY) / R.tilesPerDay));
  const id = 'x' + ++s.contact.n;
  s.contact.t[id] = { id, kind: 'trader', from: sid, to, x: a.x, y: a.y, tx: b.x, ty: b.y, depart: s.tick, arrive: s.tick + dur, back: s.tick + 2 * dur, stage: 'out' };
}

function traderStep(g, t, R) {
  const s = g.s;
  if (!s.settlements[t.from] || !s.settlements[t.to]) { delete s.contact.t[t.id]; return; }
  if (t.stage === 'out') {
    t.stage = 'home';
    const peek = relationPeek(g, t.from, t.to);
    if (peek.contact && relationStatus(peek) !== 'hostile') {
      const a = nameOf(g, t.from), rel = relationOf(g, t.from, t.to);
      // Visits are counted on the relation (rel.visits), not written into its history (which keeps the
      // causes that matter); a visit that changes the relation's standing is recorded and logged as usual.
      const before = relationStatus(rel), value = Math.max(-100, Math.min(100, rel.value + R.relation));
      if (R.relation && relationStatus({ contact: true, value }) !== before) changeRelation(g, t.from, t.to, R.relation, `Traders from ${a} visited`);
      else rel.value = value;
      rel.visits = { n: (rel.visits?.n || 0) + 1, last: s.tick, from: t.from };
      spreadContact(g, t.from, t.to, `traders from ${a}`); // illness may travel with them (illness.js)
      const P = s.playerSettlement;
      if (t.from === P || t.to === P) g.log(`Traders from ${a} visited ${nameOf(g, t.to)}.`, 'trade', `traders:${t.from}:${t.to}`, TICKS_PER_DAY);
    }
    return;
  }
  delete s.contact.t[t.id];
}
const dueOf = (t) => (t.kind === 'explorer' ? t.next : t.stage === 'out' ? t.arrive : t.back);

// ---------------- the tick ----------------
/** Game.tick (every tick): travellers that are due move on; hourly, villages send expeditions and traders.
 *  Nothing unless the game has contact state (a scenario with a contact block). */
export function tickContact(g) {
  const s = g.s, C = s.contact;
  if (!C) return;
  const R = contactRules(g);
  if (!R) return;
  if (s.tick % TICKS_PER_HOUR === 0) {
    for (const sid of Object.keys(s.settlements).sort()) {
      let v = C.v[sid];
      const founded = s.settlements[sid].founded || 0, off = hash('contact:' + sid) % TICKS_PER_DAY;
      if (!v) {
        v = C.v[sid] = {
          disc: DISC[0].repeat(discLength(g.CW * g.CH)), trips: 0,
          next: founded + Math.round((R.explore?.firstDays ?? 0) * TICKS_PER_DAY) + off, exp: null,
          nextTrade: founded + Math.round((R.traders?.firstDays ?? 0) * TICKS_PER_DAY) + off, traded: 0,
        };
        const L = landChunks(g), h = homeChunk(g, L, sid);
        if (h >= 0) discover(g, sid, h, R.explore?.sight ?? 1);
      }
      if (R.explore && !v.exp && s.tick >= v.next) launchExpedition(g, sid, v, R.explore);
      if (R.traders && s.tick >= v.nextTrade) launchTraders(g, sid, v, R.traders);
    }
    farTradeCaravans(g, R);
    if (s.tick % TICKS_PER_DAY === 0) { pruneTrades(g, R); pruneLogKeys(g, R); }
    g._ctDue = undefined;
  }
  if (g._ctDue !== undefined && s.tick < g._ctDue) return;
  let due = Infinity;
  for (const id of Object.keys(C.t).sort()) {
    const t = C.t[id];
    while (C.t[id] === t && dueOf(t) <= s.tick) {
      if (t.kind === 'explorer') explorerStep(g, t, R.explore || CONTACT_DEFAULTS.explore);
      else traderStep(g, t, R.traders || CONTACT_DEFAULTS.traders);
    }
    if (C.t[id] === t) due = Math.min(due, dueOf(t));
  }
  g._ctDue = due;
}

/** Daily (contact games with pruneTradesDays): finished trades (done, expired, cancelled) whose end (completion,
 *  else deadline) is pruneTradesDays or more in the past are removed from s.trades, so saves and the scans over
 *  s.trades stay bounded. A trade a caravan or a colonist's job still names is kept. Completed ones are counted
 *  on their relation (rel.tradesDone; villages.js completedTradesOf and the pact rule read it). O(trades +
 *  caravans + colonists) once a day. */
export function pruneTrades(g, R = contactRules(g)) {
  const s = g.s, days = R?.pruneTradesDays;
  if (days === undefined || !s.trades) return 0;
  const cut = s.tick - days * TICKS_PER_DAY;
  let held = null, n = 0;
  for (const id of Object.keys(s.trades)) {
    const t = s.trades[id];
    if (t.status === 'active' || (t.completed ?? t.deadline ?? t.created ?? 0) > cut) continue;
    if (!held) {
      held = new Set();
      for (const cv of Object.values(s.caravans || {})) held.add(cv.trade);
      for (const c of Object.values(s.colonists)) if (c.job?.tradeId) held.add(c.job.tradeId);
    }
    if (held.has(id)) continue;
    if (t.status === 'done' && t.seller !== t.buyer) {
      const rel = s.relations?.[t.seller < t.buyer ? `${t.seller}|${t.buyer}` : `${t.buyer}|${t.seller}`];
      if (rel) rel.tradesDone = (rel.tradesDone || 0) + 1;
    }
    delete s.trades[id];
    n++;
  }
  return n;
}

/** Daily, with pruneTradesDays: log de-duplication keys (s.logKeys; many name a trade or a caravan) last used 30 or
 *  more days ago are removed. Every log cooldown is far shorter, so no message is logged differently; the keys
 *  just stop piling up in the save. O(keys) once a day. */
const LOG_KEY_DAYS = 30;
function pruneLogKeys(g, R) {
  const K = g.s.logKeys;
  if (R?.pruneTradesDays === undefined || !K) return;
  const cut = g.s.tick - LOG_KEY_DAYS * TICKS_PER_DAY;
  for (const k of Object.keys(K)) if (K[k] <= cut) delete K[k];
}

/** villages.js (planTrades, proposeTrade): a trade's deadline. In contact games on big worlds, legs beyond
 *  tradeWalkRange go by caravan, so the deadline is at least the caravan's journey plus a day (to haul the goods
 *  to the stockpile and for the hourly departure); otherwise `base`, unchanged. */
export function tradeDeadline(g, seller, buyer, base) {
  const R = contactRules(g);
  if (R?.tradeWalkRange === undefined) return base;
  const a = centreOf(g, seller), b = centreOf(g, buyer);
  if (!a || !b || octile(a.x, a.y, b.x, b.y) <= R.tradeWalkRange) return base;
  return Math.max(base, g.s.tick + caravanTicks(a, b) + TICKS_PER_DAY);
}

/** Is this trade leg's destination too far to walk (centre to centre, octile tiles)? */
export function tradeLegFar(g, leg, range) {
  const a = centreOf(g, leg.from), b = centreOf(g, leg.to);
  return !!(a && b) && octile(a.x, a.y, b.x, b.y) > range;
}
/** Hourly: full-detail villages send goods owed on legs to far villages by caravan (abstract villages already send
 *  all theirs, lod.js). O(trades) to find them, then lod.js's village store per such village. */
function farTradeCaravans(g, R) {
  if (R.tradeWalkRange === undefined) return;
  const far = new Set();
  for (const id of Object.keys(g.s.trades || {}).sort()) {
    const t = g.s.trades[id];
    if (t.status !== 'active') continue;
    t.legs.forEach((leg, k) => {
      if (!far.has(leg.from) && detailOf(g, leg.from) === 'full' && tradeLegFar(g, leg, R.tradeWalkRange) && legRemaining(g, t, k).remaining > 0) far.add(leg.from);
    });
  }
  for (const sid of [...far].sort()) sendFarCaravans(g, sid, (leg) => tradeLegFar(g, leg, R.tradeWalkRange));
}

/** territory.js growClaims: owner pairs whose lands became adjacent in the daily growth ([[a, b], ...]). */
export function bordersTouched(g, pairs) {
  const C = g.s.contact;
  if (!C || !contactRules(g)?.borders) return;
  for (const [a, b] of pairs) {
    if (!g.s.settlements[a] || !g.s.settlements[b]) continue;
    const [x, y] = a < b ? [a, b] : [b, a];
    if (g.reg.get('scenario', g.s.scenarioId)?.war) { const r = relationOf(g, x, y); if (r.touch === undefined) r.touch = g.s.tick; } // rivalry (war.js)
    if (makeContact(g, x, y, 'Their lands touch', `The lands of ${nameOf(g, x)} and ${nameOf(g, y)} now touch.`)) C.met.borders++;
  }
}

// ---------------- read-only views ----------------
/**
 * Everything travelling between villages, for the map (read-only): [{ kind: 'explorer' | 'trader' | 'caravan',
 * id, from, to (traders, caravans), x, y (tiles, fractional: where it is now), tx, ty (where it is heading),
 * stage ('out' | 'home'), text }]. O(travellers + caravans).
 */
export function travellers(g) {
  const s = g.s, out = [], now = s.tick;
  const lerp = (a, b, f) => a + (b - a) * Math.max(0, Math.min(1, f));
  if (s.contact) {
    let L = null;
    for (const id of Object.keys(s.contact.t).sort()) {
      const t = s.contact.t[id];
      if (t.kind === 'explorer') {
        L ||= landChunks(g);
        const c0 = t.route[t.k], c1 = t.route[t.k + t.dir];
        const p0 = chunkPoint(g, L, c0, t.from, t.k === 0), p1 = c1 === undefined ? p0 : chunkPoint(g, L, c1, t.from, t.k + t.dir === 0);
        const f = t.next > t.prev ? (now - t.prev) / (t.next - t.prev) : 0;
        const days = Math.max(0, Math.floor((now - t.depart) / TICKS_PER_DAY));
        out.push({ kind: 'explorer', id, from: t.from, x: lerp(p0.x, p1.x, f), y: lerp(p0.y, p1.y, f), tx: p1.x, ty: p1.y, stage: t.dir === 1 ? 'out' : 'home',
          text: `Explorers from ${nameOf(g, t.from)}, ${days} day${days === 1 ? '' : 's'} out (trip ${t.trip}), ${t.dir === 1 ? 'heading out' : 'coming home'}.` });
      } else {
        const outb = t.stage === 'out';
        const f = outb ? (now - t.depart) / Math.max(1, t.arrive - t.depart) : (now - t.arrive) / Math.max(1, t.back - t.arrive);
        const [ax, ay, bx, by] = outb ? [t.x, t.y, t.tx, t.ty] : [t.tx, t.ty, t.x, t.y];
        out.push({ kind: 'trader', id, from: t.from, to: t.to, x: lerp(ax, bx, f), y: lerp(ay, by, f), tx: bx, ty: by, stage: t.stage,
          text: `Traders from ${nameOf(g, t.from)} ${outb ? 'on their way to' : 'coming home from'} ${nameOf(g, t.to)}.` });
      }
    }
  }
  for (const id of Object.keys(s.caravans || {}).sort()) {
    const cv = s.caravans[id], f = (now - cv.depart) / Math.max(1, cv.eta - cv.depart);
    out.push({ kind: 'caravan', id, from: cv.from, to: cv.to, x: lerp(cv.x, cv.tx, f), y: lerp(cv.y, cv.ty, f), tx: cv.tx, ty: cv.ty, stage: 'out',
      text: `A caravan from ${nameOf(g, cv.from)} to ${nameOf(g, cv.to)} with ${cv.qty} ${g.reg.get('item', cv.item)?.name || cv.item}.` });
  }
  return out;
}

const CAUSES = [
  ['explorers', /^Met by explorers from /], ['borders', /^Their lands touch$/], ['on foot', /^First contact$/],
  ['founding', /^Founded by |^Inherited from /], ['war', /^Met through /],
];
/**
 * Read-only: the village pairs that have met. { pairs, villages, possible, byCause: { explorers, borders,
 * 'on foot', founding, war, unknown } }. The cause is the relation's permanent first-contact record (rel.met,
 * written by makeContact, founding and war in contact games), else the oldest contact entry still in its history
 * (older games); s.contact.met keeps the exact explorer and border counts.
 */
export function metPairs(g) {
  const s = g.s, ids = Object.keys(s.settlements || {}), byCause = { explorers: 0, borders: 0, 'on foot': 0, founding: 0, war: 0, unknown: 0 };
  let pairs = 0;
  for (const rel of Object.values(s.relations || {})) {
    if (!rel.contact || !s.settlements[rel.a] || !s.settlements[rel.b]) continue;
    pairs++;
    let cause = 'unknown';
    if (rel.met?.reason) { const m = CAUSES.find(([, re]) => re.test(rel.met.reason)); byCause[m ? m[0] : 'unknown']++; continue; }
    for (const h of rel.history || []) { const m = CAUSES.find(([, re]) => re.test(h.reason)); if (m) { cause = m[0]; break; } }
    byCause[cause]++;
  }
  return { pairs, villages: ids.length, possible: (ids.length * (ids.length - 1)) / 2, byCause, met: s.contact?.met ? { ...s.contact.met } : null };
}
