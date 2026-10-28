// Neighbouring villages, contact, relations and trade (Phase 2, first slice).
// AI villages are ordinary settlements: same needs, jobs, research, building and economy rules as the
// player's. Trades move real goods: a colonist carries them, and ownership changes hands on delivery.
// Nothing is created or destroyed by trading, so the item ledger stays exact.
import { TICKS_PER_DAY } from './constants.js';
import { newResearchState, settlementOf } from './research.js';
import { makeLook } from './appearance.js';
import { namePoolOf, uniqueName, firstByKey } from './names.js';
import { tickMilitary, tickWars, isEnemy, orderOf, fightersOf } from './combat.js';
import { baseValue, marketFor, marketPicker, priceOf } from './markets.js';
import { knownPeople, settleFolk, modsOf } from './peoples.js';
import { isAdult } from './people.js';

const VILLAGE_COLORS = ['#7fc8a0', '#b0a0e0', '#e0a0a0', '#a0c0e0'];
export const RELATION_LABEL = { unknown: 'Not met', neutral: 'Neutral', friendly: 'Friendly', hostile: 'Hostile' };

// ---------------- founding ----------------
/** Pick a reachable, buildable spot for a new village at roughly `dist` tiles from the player. */
export function findVillageSite(g, dist) {
  const c0 = g.s.center;
  const homeRegion = g.regionOf(c0.x, c0.y);
  let best = null;
  for (let y = 4; y < g.H - 8; y++) for (let x = 5; x < g.W - 8; x++) {
    const d = Math.hypot(x - c0.x, y - c0.y);
    if (d < dist * 0.75 || d > dist * 1.35) continue;
    if (Object.values(g.s.settlements).some((st) => Math.hypot(x - st.center.x, y - st.center.y) < dist * 0.7)) continue;
    let ok = true, open = 0, wood = 0, rock = 0, fert = 0;
    for (let yy = y - 2; yy <= y + 5 && ok; yy++) for (let xx = x - 4; xx <= x + 4; xx++) {
      if (!g.inB(xx, yy)) { ok = false; break; }
      const t = g.terrainAt(xx, yy);
      if (!t.passable || !t.buildable) { ok = false; break; }
      const i = g.i(xx, yy);
      if (g.structIdAt(i) || g.footIdAt(i) || g.zoneAt(i)) { ok = false; break; }
      if (!g.nodeIdAt(i)) open++;
    }
    if (!ok) continue;
    if (g.regionOf(x, y) !== homeRegion && g.regionOf(x, y + 3) !== homeRegion) continue; // must be reachable on foot
    for (let yy = y - 9; yy <= y + 9; yy++) for (let xx = x - 9; xx <= x + 9; xx++) {
      if (!g.inB(xx, yy)) continue;
      const n = g.nodeAt(xx, yy);
      if (n?.def === 'core:pine') wood++;
      if (n?.def === 'core:boulder') rock++;
      fert += g.terrainAt(xx, yy).fertility >= 1 ? 1 : 0;
    }
    const score = Math.abs(d - dist) * 2 - open * 0.3 - Math.min(wood, 25) * 0.4 - Math.min(rock, 15) * 0.3 - fert * 0.02;
    if (!best || score < best.score) best = { x, y, score };
  }
  return best;
}

/**
 * Sites for many villages spread over the land the player's colony stands on: candidate spots on a 6-tile
 * grid with open, buildable, reachable ground; each village then takes the free spot farthest from every
 * settlement so far (ties: more wood and stone nearby, then scan order). On big worlds, spots with drinkable
 * water within the scenario's siteWaterWalk come first. Deterministic, no random numbers.
 */
export function spreadSites(g, count, minSpacingCap = 120) {
  const c0 = g.s.center, home = g.regionOf(c0.x, c0.y);
  // Wood and stone within 12 tiles (a 25x25 box) of every grid spot, counted once per node: each pine or
  // boulder adds itself to the grid spots whose box holds it (the same counts as looking round every spot).
  const GX = Math.max(0, Math.ceil((g.W - 14) / 6)), GY = Math.max(0, Math.ceil((g.H - 14) / 6));
  const woodAt = new Int32Array(GX * GY), rockAt = new Int32Array(GX * GY);
  for (const n of Object.values(g.s.nodes)) {
    const arr = n.def === 'core:pine' ? woodAt : n.def === 'core:boulder' ? rockAt : null;
    if (!arr) continue;
    const gx0 = Math.max(0, Math.ceil((n.x - 12 - 6) / 6)), gx1 = Math.min(GX - 1, Math.floor((n.x + 12 - 6) / 6));
    const gy0 = Math.max(0, Math.ceil((n.y - 12 - 6) / 6)), gy1 = Math.min(GY - 1, Math.floor((n.y + 12 - 6) / 6));
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) arr[gy * GX + gx]++;
  }
  const cands = [];
  for (let y = 6; y < g.H - 8; y += 6) for (let x = 6; x < g.W - 8; x += 6) {
    let ok = true;
    for (let yy = y - 2; yy <= y + 5 && ok; yy++) for (let xx = x - 4; xx <= x + 4; xx++) {
      const t = g.terrainAt(xx, yy), i = g.i(xx, yy);
      if (!t.passable || !t.buildable || g.structIdAt(i) || g.footIdAt(i) || g.zoneAt(i)) { ok = false; break; }
    }
    if (!ok || (g.regionOf(x, y) !== home && g.regionOf(x, y + 3) !== home)) continue;
    const gi = ((y - 6) / 6) * GX + (x - 6) / 6, wood = woodAt[gi], rock = rockAt[gi];
    cands.push({ x, y, res: Math.min(wood, 25) + 2 * Math.min(rock, 10), wet: true });
  }
  // Big worlds: prefer sites with a lake shore within the scenario's walking distance (siteWaterWalk), over
  // terrain, so nobody is founded in a dry pocket a day's walk from water. Where no such site is left at
  // the spacing, a dry one is still taken (its planner digs a well first). Classic worlds keep the old rule.
  const walkMax = g.big ? g.reg.get('scenario', g.s.scenarioId)?.siteWaterWalk : 0;
  if (walkMax) { const ww = g.waterWalk(); for (const c of cands) c.wet = ww.dist[g.i(c.x, c.y + 3)] <= walkMax; }
  // Spacing from the usable land shared out among the villages (each candidate stands for a 6x6 patch).
  const minSpacing = Math.max(20, Math.min(minSpacingCap, Math.sqrt((cands.length * 36) / (count + 1)) * 0.6));
  // Distance from each spot to the nearest settlement so far, kept up to date as sites are taken (the same
  // minimum as measuring to every settlement each time).
  const near = new Float64Array(cands.length).fill(Infinity);
  const addPlaced = (p) => { for (let j = 0; j < cands.length; j++) near[j] = Math.min(near[j], Math.hypot(cands[j].x - p.x, cands[j].y + 3 - p.y)); };
  for (const st of Object.values(g.s.settlements)) addPlaced(st.center);
  const out = [];
  for (let k = 0; k < count; k++) {
    let best = null, bd = -1;
    for (const wetOnly of [true, false]) {
      for (let j = 0; j < cands.length; j++) {
        const c = cands[j];
        if (wetOnly && !c.wet) continue;
        const d = near[j];
        if (d < minSpacing) continue;
        if (d > bd || (d === bd && c.res > best.res)) { bd = d; best = c; }
      }
      if (best) break;
    }
    if (!best) break;
    out.push({ x: best.x, y: best.y });
    addPlaced({ x: best.x, y: best.y + 3 });
  }
  return out;
}

/** The spacing of 'far' placement on this map: max(minSpacing, round(spacingFactor x sqrt(W x H))). */
export function farSpacing(g, F = {}) {
  return Math.max(F.minSpacing ?? 120, Math.round((F.spacingFactor ?? 0.1) * Math.sqrt(g.W * g.H)));
}

/**
 * Sites for villages far apart (scenario placement 'far', data in scenario.farPlacement): a coarse grid of
 * candidate centres (one per `grid` x `grid` cell) on the player's walkable land, each a good site:
 *   - fresh water: a lake or river shore within siteWaterWalk tiles on foot (the water-walk field);
 *   - open ground: the square of `openRadius` round the centre is all buildable, nothing built on it;
 *   - wood, stone and fertile land (fertility 1 or more) in the 3 x 3 cells round it, at least minWood,
 *     minStone and minFertile.
 * Each village then takes, among the sites at least `spacing` tiles from every settlement so far, the one
 * with the highest key: its distance to the nearest settlement in units of spacing (capped at
 * weights.distanceCap, so beyond that the site's quality decides), plus its wood, stone, fertility and water
 * shares (each 0-1, times its weight), plus weights.biome if its biome (the commonest buildable terrain round
 * it, named by farPlacement.biomes) is not yet any settlement's. Ties: grid scan order. Deterministic, no
 * random numbers. Fewer sites than asked are returned when no more fit at the spacing (never closer).
 * Cost: one pass over the tiles and one over the trees and boulders (counts per cell), then O(cells x 9) and
 * O(villages x candidates); the water-walk field is built if not cached (big worlds warm it anyway).
 * Returns the sites ({x, y} as foundVillage takes them, plus biome and scores) with .spacing and .candidates.
 */
export function farSites(g, count, F = {}, walkMax = 24) {
  const W = g.W, H = g.H, G = F.grid ?? 8, rr = F.openRadius ?? 6, wt = F.weights || {};
  const spacing = farSpacing(g, F);
  const CW = Math.floor(W / G), CH = Math.floor(H / G), NC = CW * CH;
  const pal = g.terrainPalette, P = pal.length;
  const defs = pal.map((_, k) => g.terrainDefOf(k));
  const fertK = new Uint8Array(P), okK = new Uint8Array(P); // fertile; buildable ground
  for (let k = 0; k < P; k++) { fertK[k] = defs[k].fertility >= 1 ? 1 : 0; okK[k] = defs[k].passable && defs[k].buildable ? 1 : 0; }
  // Per cell: tiles of each terrain (for the biome) and fertile tiles; trees and boulders.
  const hist = new Uint16Array(NC * P), fert = new Int32Array(NC), wood = new Int32Array(NC), rock = new Int32Array(NC);
  const ts = g._ts.idx;
  for (let y = 0; y < CH * G; y++) {
    const row = ((y / G) | 0) * CW, o = y * W;
    for (let x = 0; x < CW * G; x++) { const k = ts[o + x], c = row + ((x / G) | 0); hist[c * P + k]++; fert[c] += fertK[k]; }
  }
  const woodItem = F.woodItem || 'core:wood', stoneItem = F.stoneItem || 'core:stone', kind = new Map();
  const kindOf = (def) => {
    let v = kind.get(def);
    if (v === undefined) { const ys = g.reg.get('node', def)?.yields || []; v = ys.some((y) => y.item === woodItem) ? 1 : ys.some((y) => y.item === stoneItem) ? 2 : 0; kind.set(def, v); }
    return v;
  };
  for (const [def, list] of g.nodesByDef()) { // (counts only: the order does not matter)
    const v = kindOf(def);
    if (!v) continue;
    const arr = v === 1 ? wood : rock;
    for (const n of list) { const cx = (n.x / G) | 0, cy = (n.y / G) | 0; if (cx < CW && cy < CH) arr[cy * CW + cx]++; }
  }
  const c0 = g.s.center, home = g.regionOf(c0.x, c0.y);
  if (home < 0) { const none = []; none.spacing = spacing; none.candidates = 0; return none; } // the player stands on no walkable land
  const ww = g.waterWalk();
  const sum3 = (a, cx, cy) => { let t = 0; for (let yy = cy - 1; yy <= cy + 1; yy++) for (let xx = cx - 1; xx <= cx + 1; xx++) t += a[yy * CW + xx]; return t; };
  const wCap = F.woodCap ?? 60, sCap = F.stoneCap ?? 12, fCap = F.fertileCap ?? 400;
  const bioNames = F.biomes || {};
  // A spot's biome: the commonest buildable terrain in the 3 x 3 cells round it, by its biome name.
  const biomeAt = (x, y) => {
    const cx = Math.min(CW - 2, Math.max(1, (x / G) | 0)), cy = Math.min(CH - 2, Math.max(1, (y / G) | 0));
    let bk = -1, bn = 0;
    for (let k = 0; k < P; k++) {
      if (!okK[k]) continue;
      let t = 0;
      for (let yy = cy - 1; yy <= cy + 1; yy++) for (let xx = cx - 1; xx <= cx + 1; xx++) t += hist[(yy * CW + xx) * P + k];
      if (t > bn) { bn = t; bk = k; }
    }
    return bk >= 0 ? (bioNames[pal[bk]] || pal[bk]) : 'unknown';
  };
  const cands = [];
  for (let cy = 1; cy < CH - 1; cy++) for (let cx = 1; cx < CW - 1; cx++) {
    const x = cx * G + (G >> 1), y = cy * G + (G >> 1);
    if (x - rr < 1 || y - rr < 4 || x + rr >= W - 1 || y + rr >= H - 1) continue;
    const walk = ww.dist[y * W + x];
    if (!(walk <= walkMax)) continue;
    const wd = sum3(wood, cx, cy), st = sum3(rock, cx, cy), fe = sum3(fert, cx, cy);
    if (wd < (F.minWood ?? 0) || st < (F.minStone ?? 0) || fe < (F.minFertile ?? 0)) continue;
    let ok = true;
    for (let yy = y - rr; yy <= y + rr && ok; yy++) for (let xx = x - rr; xx <= x + rr; xx++) {
      const i = yy * W + xx;
      if (!okK[ts[i]] || g.structIdAt(i) || g.footIdAt(i) || g.zoneAt(i)) { ok = false; break; }
    }
    if (!ok) continue;
    // Reachable on foot: foundVillage clears the trees and rocks off the village block (x-3..x+2, y-3..y+1:
    // the settlers' rows and the stockpile), so the block is open once some tile round its edge is on the
    // player's walkable land.
    let reach = false;
    for (let yy = y - 4; yy <= y + 2 && !reach; yy++) for (let xx = x - 4; xx <= x + 3; xx++) {
      if (yy !== y - 4 && yy !== y + 2 && xx !== x - 4 && xx !== x + 3) continue;
      if (g.regionAt(yy * W + xx) === home) { reach = true; break; }
    }
    if (!reach) continue;
    const biome = biomeAt(x, y);
    const q = (wt.wood ?? 0.3) * Math.min(1, wd / wCap) + (wt.stone ?? 0.3) * Math.min(1, st / sCap)
      + (wt.fertile ?? 0.3) * Math.min(1, fe / fCap) + (wt.water ?? 0.3) * (1 - walk / Math.max(1, walkMax));
    cands.push({ x, y, biome, wood: wd, stone: st, fertile: fe, walk: Math.round(walk), q });
  }
  // Distance from each candidate to the nearest settlement so far (kept up to date as sites are taken).
  const near = new Float64Array(cands.length).fill(Infinity);
  const addPlaced = (p) => { for (let j = 0; j < cands.length; j++) { const d = Math.hypot(cands[j].x - p.x, cands[j].y - p.y); if (d < near[j]) near[j] = d; } };
  const used = new Set();
  for (const st of Object.values(g.s.settlements)) { addPlaced(st.center); if (CW > 2 && CH > 2) used.add(biomeAt(st.center.x, st.center.y)); }
  const dCap = wt.distanceCap ?? 1.6, wB = wt.biome ?? 0.6;
  const out = [];
  for (let k = 0; k < count; k++) {
    let best = -1, bkey = -Infinity;
    for (let j = 0; j < cands.length; j++) {
      const d = near[j];
      if (d < spacing) continue;
      const c = cands[j];
      const key = Math.min(d / spacing, dCap) + c.q + (used.has(c.biome) ? 0 : wB);
      if (key > bkey) { bkey = key; best = j; }
    }
    if (best < 0) break;
    const c = cands[best];
    out.push({ x: c.x, y: c.y - 3, biome: c.biome, wood: c.wood, stone: c.stone, fertile: c.fertile, walk: c.walk, near: Math.round(near[best]) });
    used.add(c.biome);
    addPlaced({ x: c.x, y: c.y });
  }
  out.spacing = spacing; out.candidates = cands.length;
  return out;
}

/** A colour of its own for a village: the profile colour, turned round the colour wheel if another village has it. */
export function villageColor(g, base, n) {
  const used = new Set(Object.values(g.s.settlements).map((st) => st.color));
  if (!used.has(base)) return base;
  const r = parseInt(base.slice(1, 3), 16) / 255, gg = parseInt(base.slice(3, 5), 16) / 255, b = parseInt(base.slice(5, 7), 16) / 255;
  const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (mx + mn) / 2, d = mx - mn;
  const sat = d === 0 ? 0.5 : d / (1 - Math.abs(2 * l - 1));
  const h = d === 0 ? 0 : mx === r ? ((gg - b) / d) % 6 : mx === gg ? (b - r) / d + 2 : (r - gg) / d + 4;
  for (let k = 1; k < 64; k++) {
    const hue = ((h * 60 + k * 137.508 + n * 7) % 360 + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * Math.max(0.35, sat), x = c * (1 - Math.abs(((hue / 60) % 2) - 1)), m = l - c / 2;
    const [r1, g1, b1] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
    const hex = '#' + [r1, g1, b1].map((v) => Math.round(Math.max(0, Math.min(1, v + m)) * 255).toString(16).padStart(2, '0')).join('');
    if (!used.has(hex)) return hex;
  }
  return base;
}

/** Found an AI village from a villageProfile: a settlement record, its stockpile, its people and goods. */
export function foundVillage(g, profile, rng, usedNames, chosenSite = null) {
  const s = g.s;
  const site = chosenSite || findVillageSite(g, g._neighborDistance || 24);
  if (!site) { g.log(`No room was found for a neighbouring ${profile.name.toLowerCase()}.`, 'warn'); return null; }
  const n = Object.keys(s.settlements).length;
  const sid = 't' + (n + 1);
  const name = profile.settlementNames.find((x) => !Object.values(s.settlements).some((st) => st.name === x)) || `${profile.settlementNames[0]} ${n}`;
  const pile = [];
  for (let y = site.y + 2; y < site.y + 5; y++) for (let x = site.x - 3; x < site.x + 3; x++) pile.push(`${x},${y}`);
  for (const k of pile) { const [x, y] = k.split(',').map(Number); const nd = g.nodeAt(x, y); if (nd) g.removeNode(nd.id); }
  // Far sites (farSites) can stand in forest: the trees and rocks on the settlers' rows are cleared too, so
  // the whole block is open ground joined to the land round it (nodes removed, nothing created).
  if (chosenSite?.biome) for (let y = site.y; y < site.y + 2; y++) for (let x = site.x - 3; x < site.x + 3; x++) {
    const nd = g.nodeAt(x, y);
    if (nd && g.reg.get('node', nd.def)?.passable === false) g.removeNode(nd.id);
  }
  const research = newResearchState(g.reg);
  for (const [f, p] of Object.entries(profile.research || {})) research.priorities[f] = p;
  s.settlements[sid] = {
    id: sid, name, profile: profile.id, ai: true, color: chosenSite ? villageColor(g, profile.color || VILLAGE_COLORS[n % VILLAGE_COLORS.length], n) : (profile.color || VILLAGE_COLORS[n % VILLAGE_COLORS.length]),
    founded: s.tick, center: { x: site.x, y: site.y + 3 }, stockpile: pile, research, policy: profile.policy || {}, trade: profile.trade || {}, laws: { ...(profile.laws || {}) }, enforcement: profile.enforcement ?? 0.6,
  };
  if (knownPeople(g, profile.people)) s.settlements[sid].people = knownPeople(g, profile.people);
  for (const k of pile) { const [x, y] = k.split(',').map(Number); g.setZone(g.i(x, y), 'S:' + sid); }
  g.territoryChanged();
  g.actor = sid;
  for (const it of profile.startItems) g.createItems(it.item, it.qty, site.x, site.y + 3, 'start', undefined, true);
  g.actor = null;
  const pool = namePoolOf(g, 'Settler');
  const names = rng.shuffle(pool.names.filter((x) => !usedNames.has(x)));
  const skills = g.reg.all('skill');
  for (let i = 0; i < profile.colonists; i++) {
    const id = 'c' + s.nextId++;
    const sk = {};
    for (const k of skills) sk[k.id] = rng.int(6);
    // A free first name while any is left, otherwise a first name with a surname (names.js; no rng draw).
    const cname = i < names.length ? names[i] : uniqueName(pool, usedNames, firstByKey(pool, id), id);
    usedNames.add(cname);
    const nd = {};
    for (const nn of g.reg.all('need')) nd[nn.id] = nn.behavior === 'core:shelter' ? 0.6 : 0.8;
    s.colonists[id] = {
      id, settlementId: sid, name: cname, color: profile.color, look: makeLook(`${s.seed}:${sid}:${i}`),
      x: site.x - 1 + (i % 3), y: site.y, mv: null, skills: sk, xp: {}, needs: nd, carry: null, equip: { tool: null, weapon: null },
      homeId: null, bedId: null, job: null, workOff: {}, lastWork: null, sleeping: false, idle: 0,
      status: { goal: 'Arriving', action: 'Looking around', target: '', blocker: '' }, workCount: {},
    };
    settleFolk(g, s.colonists[id], s.settlements[sid].people);
    g.ownAdd('colonists', s.colonists[id]);
  }
  g.markDirty();
  if (chosenSite?.biome) g.log(`A ${profile.name.toLowerCase()}, ${name}, was founded far away (${chosenSite.biome}, ${chosenSite.near} tiles from the nearest settlement; water, wood, stone and fertile land nearby) by ${profile.colonists} settlers.`, 'trade');
  else g.log(`A ${profile.name.toLowerCase()}, ${name}, was founded nearby by ${profile.colonists} settlers.`, 'trade');
  return sid;
}

// ---------------- relations ----------------
export const relKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export function relationOf(g, a, b) {
  const k = relKey(a, b);
  g.s.relations ||= {};
  return (g.s.relations[k] ||= { a: a < b ? a : b, b: a < b ? b : a, contact: false, value: 0, history: [] });
}
/** Two villages meet (if they have not yet): contact, the cause in the relation history (delta 0), a log line.
 *  Used by first contact on foot (tickVillages) and by explorers and touching lands (contact.js). Returns
 *  true when they had not met before. */
export function makeContact(g, a, b, reason, msg) {
  const rel = relationOf(g, a, b);
  if (rel.contact) return false;
  rel.contact = true;
  noteMet(g, rel, reason);
  rel.history.push({ tick: g.s.tick, delta: 0, reason });
  if (rel.history.length > 16) rel.history.splice(0, rel.history.length - 16);
  g.log(msg, 'trade');
  return true;
}
/** Contact games (s.contact, format 11): the permanent record of how two villages first met, rel.met = { tick,
 *  reason } (the history keeps only its last 16 entries). Written once. Other games add nothing (unchanged saves). */
export function noteMet(g, rel, reason) {
  if (g.s.contact && rel.contact && !rel.met) rel.met = { tick: g.s.tick, reason };
}
const NO_HISTORY = Object.freeze([]);
/** Read-only relation lookup: the stored record, or a frozen "not met" default. Never creates a record, so
 *  evaluating (dialogs, AI checks, LOD) cannot change the save. Use relationOf only where the relation is
 *  about to change (contact, history, value). */
export function relationPeek(g, a, b) {
  const k = relKey(a, b), r = g.s.relations?.[k];
  if (r) return r;
  // Not met: a frozen stand-in, made once per pair (derived, never saved).
  const m = (g._relNone ||= new Map());
  let d = m.get(k);
  if (!d) { if (m.size > 20000) m.clear(); m.set(k, (d = Object.freeze({ a: a < b ? a : b, b: a < b ? b : a, contact: false, value: 0, history: NO_HISTORY }))); }
  return d;
}
export function relationStatus(rel) {
  if (!rel?.contact) return 'unknown';
  return rel.value >= 25 ? 'friendly' : rel.value <= -25 ? 'hostile' : 'neutral';
}
/** Every change has a visible cause. */
export function changeRelation(g, a, b, delta, reason) {
  const rel = relationOf(g, a, b);
  const before = relationStatus(rel);
  rel.value = Math.max(-100, Math.min(100, rel.value + delta));
  rel.history.push({ tick: g.s.tick, delta, reason });
  if (rel.history.length > 16) rel.history.splice(0, rel.history.length - 16);
  const after = relationStatus(rel);
  // A war's markers (who struck first, who joined to defend an ally: combat.js) end with the war.
  if (before === 'hostile' && after !== 'hostile') { delete rel.aggressor; delete rel.joinedFor; delete rel.warSince; delete rel.threat; delete rel.beaten; }
  if (after !== before && rel.contact) {
    const na = settlementOf(g, a)?.name, nb = settlementOf(g, b)?.name;
    g.log(`Relations between ${na} and ${nb} are now ${RELATION_LABEL[after].toLowerCase()} (${reason.toLowerCase()}).`, after === 'hostile' ? 'warn' : 'trade');
  }
}

// ---------------- trade ----------------
/** What one unit of `item` is worth in trade. With `ctx` = { a, b } (the two trading villages) and a market
 *  serving both (markets.js marketFor), that market's price; otherwise the item's fixed value. The market is
 *  looked up once per ctx object (kept as ctx.market), so one evaluation prices every item at one market.
 *  A ctx may fix the market instead: ctx.market = a market's sid, or null for the fixed values. */
export function value(g, item, ctx = null) {
  if (ctx) {
    if (ctx.market === undefined) ctx.market = ctx.pick ? ctx.pick(ctx.a, ctx.b) : marketFor(g, ctx.a, ctx.b); // pick: marketPicker (one pass)
    if (ctx.market) return priceOf(g, ctx.market, item);
  }
  return baseValue(g, item);
}
const nameOf = (g, sid) => settlementOf(g, sid)?.name || sid;
const iname = (g, it) => g.reg.get('item', it)?.name || it;

/** Will settlement `sid` trade with `other` right now? (player: diplomacy policy; AI: personality) */
export function willTrade(g, sid, other) {
  const rel = relationPeek(g, sid, other);
  const status = relationStatus(rel);
  if (!rel.contact || status === 'hostile' || tradeClosed(g, sid, other)) return false;
  const st = settlementOf(g, sid);
  if (sid === g.s.playerSettlement) {
    const pol = g.s.diplomacy?.tradePolicy || 'open';
    return pol === 'open' || (pol === 'friendly' && (status === 'friendly' || hasPact(g, sid, other)));
  }
  const w = st?.trade?.willingness ?? 0.7;
  return rel.value >= -40 * w; // eager traders tolerate a cooler relationship
}

function legRemaining(g, trade, idx) {
  const leg = trade.legs[idx];
  let inTransit = 0;
  for (const c of Object.values(g.s.colonists)) if (c.job?.type === 'trade' && c.job.tradeId === trade.id && c.job.leg === idx) inTransit += c.job.qty;
  if (g.s.caravans) for (const cv of Object.values(g.s.caravans)) if (cv.trade === trade.id && cv.leg === idx) inTransit += cv.qty; // abstract villages' caravans (lod.js)
  return { remaining: leg.qty - leg.delivered - inTransit, inTransit };
}
export { legRemaining };

function activeTradeBetween(g, a, b) {
  return Object.values(g.s.trades || {}).find((t) => t.status === 'active' && ((t.seller === a && t.buyer === b) || (t.seller === b && t.buyer === a)));
}

/** Settlement-level trade planning: match one side's needs with the other side's surplus. */
export function planTrades(g) {
  const s = g.s;
  const ids = Object.keys(s.settlements || {}).filter((x) => !s.settlements[x].fallen); // ruins trade with nobody (fallen.js)
  // Pairs with an active trade: one pass over the trades (finished ones stay in s.trades), kept up to date as
  // trades are agreed below. The same answers as asking activeTradeBetween for every pair.
  const busy = new Set();
  for (const t of Object.values(s.trades || {})) if (t.status === 'active') busy.add(relKey(t.seller, t.buyer));
  // Contact games (Phase 2b slice 6; contact.tradeRange / maxActiveTrades, data): villages trade only with
  // villages whose centres are within tradeRange tiles, nearest pairs first, and each takes part in at most
  // maxActiveTrades active trades, so trading grows with the villages, not with the pairs of villages.
  const lim = s.contact ? g.reg.get('scenario', s.scenarioId)?.contact : null;
  const range = lim?.tradeRange, maxActive = lim?.maxActiveTrades;
  const nActive = new Map();
  if (maxActive !== undefined) for (const t of Object.values(s.trades || {})) if (t.status === 'active') for (const v of new Set([t.seller, t.buyer])) nActive.set(v, (nActive.get(v) || 0) + 1);
  let order = null;
  if (range !== undefined || maxActive !== undefined) {
    order = [];
    for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) {
      if (i === j) continue;
      const a = s.settlements[ids[i]].center || s.center, b = s.settlements[ids[j]].center || s.center;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (range === undefined || d <= range) order.push([d, i, j]);
    }
    order.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  }
  const needsOf = new Map(), wantsOf = new Map();
  let useful = null;
  // The market of each pair (value below): markets, contacts and centres do not change during this pass, so
  // which markets each village is in reach of is worked out once (markets.js marketPicker; same answers).
  let picker = null;
  const pick = (a, b) => (picker ||= marketPicker(g))(a, b);
  const N = order ? order.length : ids.length * ids.length;
  for (let k = 0; k < N; k++) {
    const i = order ? order[k][1] : Math.floor(k / ids.length), j = order ? order[k][2] : k % ids.length;
    const buyer = ids[i], seller = ids[j];
    if (buyer === seller || busy.has(relKey(buyer, seller))) continue;
    if (maxActive !== undefined && ((nActive.get(buyer) || 0) >= maxActive || (nActive.get(seller) || 0) >= maxActive)) continue;
    if (!willTrade(g, buyer, seller) || !willTrade(g, seller, buyer)) continue;
    const PB = g.ensurePlan(buyer), PS = g.ensurePlan(seller);
    if (!PB || !PS) continue;
    // What the buyer needs and cannot get itself, that the seller can spare.
    // Hard needs (nothing reachable produces it, or research is missing) come first; then goods the
    // buyer is currently spending labour to gather, which a neighbour with a surplus could supply.
    // (Plans do not change during this pass, so each buyer's needs and each seller's wants are worked out once.)
    let needs = needsOf.get(buyer);
    if (!needs) {
      needs = Object.entries(PB.tradeNeeds || {}).filter(([it, q]) => q > 0 && !isControlled(g, it));
      if (PB.foodDays < 1.5) for (const it of g.reg.itemsWithTag('core:food')) needs.push([it, Math.ceil(10 / (g.reg.get('item', it)?.nutrition || 0.1))]);
      for (const [it, w] of Object.entries(PB.wants || {})) if (w.remaining >= 5 && !needs.some(([x]) => x === it)) needs.push([it, Math.ceil(w.remaining)]);
      needsOf.set(buyer, needs);
    }
    // Up to 3 goods the seller can spare, most needed first.
    const lines = [];
    for (const [item, q] of needs) {
      if (lines.length >= 3 || lines.some((l) => l.item === item)) continue;
      const spare = Math.floor(PS.surplus?.[item] || 0);
      if (spare < 3) continue;
      lines.push({ item, qty: Math.min(q, spare, 30) });
    }
    if (!lines.length) continue;
    // The seller accepts what it needs, what it keeps in stock, or any useful material or food it does
    // not already have in surplus.
    let sellerWants = wantsOf.get(seller);
    if (!sellerWants) {
      useful ||= g.reg.all('item').filter((d) => !d.equipment && (d.tags?.includes('core:material') || d.tags?.includes('core:food'))).map((d) => d.id);
      sellerWants = [...new Set([
        ...Object.entries(PS.tradeNeeds || {}).filter(([, n]) => n > 0).map(([it]) => it),
        ...Object.keys(g.policyFor(seller).stock || {}),
        ...useful.filter((it) => !(PS.surplus?.[it] > 0)),
      ])].filter((it) => !isControlled(g, it));
      wantsOf.set(seller, sellerWants);
    }
    // Payment: up to 3 kinds of goods from the buyer's surplus that the seller wants, worth at least as
    // much. If the buyer cannot pay for everything, the least needed goods are dropped first.
    const px = { a: buyer, b: seller, pick }; // the market both are in reach of, if any, prices this deal
    const cents = (it) => Math.round(value(g, it, px) * 100); // sums in whole cents: no float drift in the payment
    const payFor = (goods) => {
      let owed = goods.reduce((a, l) => a + l.qty * cents(l.item), 0);
      const pay = [];
      for (const it of sellerWants) {
        if (owed <= 0 || pay.length >= 3) break;
        if (goods.some((l) => l.item === it)) continue;
        const have = Math.floor(PB.surplus?.[it] || 0);
        if (have < 1) continue;
        const pq = Math.min(have, Math.max(1, Math.ceil(owed / cents(it))));
        pay.push({ item: it, qty: pq });
        owed -= pq * cents(it);
      }
      return owed <= 0 ? pay : null;
    };
    let goods = lines, pay = payFor(goods);
    while (!pay && goods.length > 1) { goods = goods.slice(0, -1); pay = payFor(goods); }
    let gift = false;
    if (!pay) {
      const rel = relationPeek(g, buyer, seller);
      const generosity = settlementOf(g, seller)?.trade?.generosity ?? 0;
      if (seller === s.playerSettlement || generosity < 0.3 || rel.value < 5) continue;
      gift = true; // a generous neighbour on good terms helps out with the most needed item
      goods = [{ item: lines[0].item, qty: Math.min(lines[0].qty, 15) }];
      pay = [];
    }
    const id = g.newId('tr');
    const legs = [
      ...goods.map((l) => ({ from: seller, to: buyer, item: l.item, qty: l.qty, delivered: 0 })),
      ...pay.map((p) => ({ from: buyer, to: seller, item: p.item, qty: p.qty, delivered: 0 })),
    ];
    const priced = !gift && px.market ? px.market : null; // a market priced it (gifts are not priced)
    busy.add(relKey(seller, buyer));
    if (maxActive !== undefined) { nActive.set(seller, (nActive.get(seller) || 0) + 1); nActive.set(buyer, (nActive.get(buyer) || 0) + 1); }
    g.tradeAdded();
    s.trades[id] = { id, seller, buyer, legs, gift, status: 'active', created: s.tick, deadline: g.tradeDeadline(seller, buyer, s.tick + 3 * TICKS_PER_DAY),
      reason: `${nameOf(g, buyer)} lacks ${goods.map((l) => iname(g, l.item)).join(', ')}${pay.length ? `; ${nameOf(g, seller)} wants ${pay.map((p) => iname(g, p.item)).join(', ')}` : ''}${priced ? `; priced at the ${nameOf(g, priced)} market` : ''}`,
      ...(priced ? { market: priced } : {}) };
    const what = `${listText(g, goods)}${pay.length ? ` for ${listText(g, pay)}` : ' as a gift'}`;
    g.log(`${nameOf(g, seller)} and ${nameOf(g, buyer)} agreed a trade: ${what}${priced ? ` (${nameOf(g, priced)} market prices)` : ''}.`, 'trade');
    changeRelation(g, buyer, seller, 2, 'Agreed a trade');
  }
}

/** Every ~100 ticks: contact, trade expiry, trade planning. */
export function tickVillages(g) {
  const s = g.s;
  const ids = Object.keys(s.settlements || {});
  if (ids.length < 2) return;
  if (s.tick % TICKS_PER_DAY === 0) tickPacts(g);
  if (s.tick % 100 === 0) {
    expireProposals(g);
    tickMilitary(g);
    let near = null; // built on first use: colonists by settlement and by 6x6 cell (same answers as comparing every pair)
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const rel = relationOf(g, ids[i], ids[j]);
      if (rel.contact) continue;
      near ||= contactIndex(g);
      if (near(ids[i], ids[j])) makeContact(g, ids[i], ids[j], 'First contact', `First contact: ${nameOf(g, ids[i])} and ${nameOf(g, ids[j])} have met.`);
    }
    for (const t of Object.values(s.trades || {})) {
      if (t.status !== 'active') continue;
      const hostile = relationStatus(relationPeek(g, t.seller, t.buyer)) === 'hostile';
      if (s.tick > t.deadline || hostile) {
        t.status = hostile ? 'cancelled' : 'expired';
        for (const [k, leg] of t.legs.entries()) {
          if (t.tribute) break; // tribute not delivered costs no goodwill (war.js sack)
          if (leg.delivered < leg.qty && legRemaining(g, t, k).inTransit === 0) changeRelation(g, leg.from, leg.to, -5, `${nameOf(g, leg.from)} failed to deliver ${iname(g, leg.item)}`);
        }
        g.log(`A trade between ${nameOf(g, t.seller)} and ${nameOf(g, t.buyer)} ${t.status} before it was fully delivered.`, 'warn');
      }
    }
  }
  if (s.tick % 300 === 150) planTrades(g);
}

/** First contact test: a colonist of either village within 12 tiles of the other's centre, or within 6 tiles
 *  of one of the other's colonists. Colonists are bucketed by settlement and by 6x6 cell, so a pair costs
 *  O(its colonists) instead of O(all colonists squared). */
function contactIndex(g) {
  const bySid = new Map(), cells = new Map(), C = 6;
  const key = (cx, cy) => cx * 65536 + cy;
  for (const c of Object.values(g.s.colonists)) {
    let a = bySid.get(c.settlementId); if (!a) bySid.set(c.settlementId, (a = [])); a.push(c);
    const k = key(Math.floor(c.x / C), Math.floor(c.y / C));
    let b = cells.get(k); if (!b) cells.set(k, (b = [])); b.push(c);
  }
  const oneWay = (from, other) => {
    const list = bySid.get(from);
    if (!list) return false;
    const oc = settlementOf(g, other).center;
    for (const c of list) {
      if (Math.hypot(c.x - oc.x, c.y - oc.y) <= 12) return true;
      const cx = Math.floor(c.x / C), cy = Math.floor(c.y / C);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        for (const d of cells.get(key(cx + dx, cy + dy)) || []) if (d.settlementId === other && Math.hypot(c.x - d.x, c.y - d.y) <= 6) return true;
      }
    }
    return false;
  };
  return (a, b) => oneWay(a, b) || oneWay(b, a);
}

/** Called when a delivery lands. Completes the trade when every leg is delivered. */
export function onDelivered(g, trade) {
  if (trade.status !== 'active' || !trade.legs.every((l) => l.delivered >= l.qty)) return;
  trade.status = 'done';
  trade.completed = g.s.tick;
  const reason = trade.gift ? `${nameOf(g, trade.seller)} gave ${listText(g, trade.legs.filter((l) => l.from === trade.seller))}` : 'Completed a trade';
  changeRelation(g, trade.buyer, trade.seller, trade.relOnDone ?? (trade.gift ? 10 : 6), reason);
  const pact = treatyOf(g, trade.buyer, trade.seller);
  if (pact?.kind === 'tradePact') { pact.lastTrade = g.s.tick; changeRelation(g, trade.buyer, trade.seller, PACT.tradeBonus, 'Trade pact partner'); }
  g.log(`Trade complete between ${nameOf(g, trade.seller)} and ${nameOf(g, trade.buyer)}: ${trade.legs.map((l) => `${l.qty} ${iname(g, l.item)} to ${nameOf(g, l.to)}`).join(', ')}.`, 'trade');
}

/** A trade leg's goods arrive: placed at (x, y) as the buyer's, the leg is credited, and the trade's
 *  rules run (laws at the destination, completion). Used by hand deliveries and by caravans (lod.js). */
export function deliverLeg(g, t, legIdx, item, qty, x, y, dur, preferStockpile = false) {
  const prev = g.actor;
  g.actor = t.legs[legIdx].to; // ownership passes to the receiving settlement here
  g.placeItems(item, qty, x, y, dur, preferStockpile);
  g.actor = prev;
  t.legs[legIdx].delivered += qty;
  onLegDelivered(g, t, legIdx, qty);
  onDelivered(g, t);
}

/** Item totals per settlement (stacks it owns + what its colonists carry/hold + goods in its caravans). Used by tests and the UI. */
export function inventoryOf(g, sid) {
  const out = {};
  const add = (it, q) => { if (q) out[it] = (out[it] || 0) + q; };
  for (const st of Object.values(g.s.stacks)) if ((st.settlement || g.s.playerSettlement) === sid) add(st.item, st.qty);
  for (const c of Object.values(g.s.colonists)) {
    if ((c.settlementId || g.s.playerSettlement) !== sid) continue;
    if (c.carry) add(c.carry.item, c.carry.qty);
    if (c.equip.tool) add(c.equip.tool.item, 1);
    if (c.equip.weapon) add(c.equip.weapon.item, 1);
    if (c.ammo) add(c.ammo.item, c.ammo.qty);
  }
  for (const st of Object.values(g.s.structures)) {
    if ((st.settlement || g.s.playerSettlement) !== sid) continue;
    for (const [it, q] of Object.entries(st.delivered || {})) add(it, q);
    for (const [it, q] of Object.entries(st.reno?.delivered || {})) add(it, q);
    for (const b of st.buffer || []) add(b.item, b.qty);
    for (const f of st.fuel || []) add(f.item, f.qty);
  }
  for (const cv of Object.values(g.s.caravans || {})) if (cv.from === sid) add(cv.item, cv.qty); // still the seller's until they arrive
  return out;
}

// ---------------- player proposals (Phase 2, second slice) ----------------
// The player can offer a trade (give X, ask for Y), a gift (give X) or a request (ask for Y). The
// neighbour judges it by item value, its own needs and surplus, and its personality. An accepted offer
// becomes an ordinary trade: goods are carried and change hands on delivery, exactly like AI deals.

/** Units of `item` that settlement `sid` could hand over now (its own unreserved goods on the ground). */
export function availableToTrade(g, sid, item) {
  let n = 0;
  for (const st of g.stacksByItem().get(item) || []) {
    if (!g.tradeable(st) || (st.settlement || g.s.playerSettlement) !== sid) continue;
    n += Math.max(0, g.availQty(st.id));
  }
  return n;
}

/** Items `sid` holds that it could offer, with available counts, most plentiful first. */
export function tradeableItems(g, sid) {
  const out = {};
  for (const st of Object.values(g.s.stacks)) {
    if (!g.tradeable(st) || (st.settlement || g.s.playerSettlement) !== sid) continue;
    out[st.item] = (out[st.item] || 0) + Math.max(0, g.availQty(st.id));
  }
  return Object.entries(out).filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]).map(([item, qty]) => ({ item, qty }));
}

/** What a village can spare (its planner's surplus after its own needs and safety buffer). */
export function spareOf(g, sid, item) { return Math.max(0, Math.floor(g.plans?.[sid]?.surplus?.[item] || 0)); }

/** Relation change when a gift worth `v` (to the receiver) arrives. */
export const giftRelation = (v) => Math.max(2, Math.min(12, Math.round(2 + v / 8)));

/** Why a village does (or does not) want an item, and how much it counts for. */
function interestIn(g, ai, item) {
  const P = g.plans?.[ai] || {};
  if ((P.tradeNeeds?.[item] || 0) > 0) return { k: 1.15, why: 'they cannot get it themselves' };
  if ((P.wants?.[item]?.remaining || 0) > 0) return { k: 1, why: 'they are short of it' };
  if (g.policyFor(ai).stock?.[item]) return { k: 0.9, why: 'they keep it in stock' };
  if ((P.surplus?.[item] || 0) > 0) return { k: 0.35, why: 'they already have plenty' };
  return { k: 0.7, why: 'it is useful to them' };
}

/** At most this many different items on each side of an offer. */
export const MAX_OFFER_ITEMS = 4;

/** An offer side as a clean list: accepts one {item, qty}, a list of them, or nothing; merges repeats. */
function offerList(x) {
  const out = new Map();
  for (const o of Array.isArray(x) ? x : x ? [x] : []) {
    if (!o?.item || !(o.qty > 0)) continue;
    out.set(o.item, (out.get(o.item) || 0) + Math.floor(o.qty));
  }
  return [...out].filter(([, q]) => q > 0).map(([item, qty]) => ({ item, qty }));
}
const listText = (g, list) => list.map((x) => `${x.qty} ${iname(g, x.item)}`).join(', ').replace(/, ([^,]*)$/, ' and $1');

/**
 * Judge an offer without changing anything. offer: { give, want }, each one {item, qty}, a list of up to
 * MAX_OFFER_ITEMS of them, or nothing. Returns { valid, accept, problems[], lines[], verdict, relOnAgree,
 * relOnDone, worthIn, worthOut, give[], want[] }.
 */
export function evaluateOffer(g, ai, offer) {
  const me = g.s.playerSettlement;
  const give = offerList(offer.give), want = offerList(offer.want);
  const res = { valid: true, accept: false, problems: [], lines: [], verdict: '', relOnAgree: 0, relOnDone: 0, worthIn: 0, worthOut: 0, give, want };
  const st = settlementOf(g, ai);
  const name = nameOf(g, ai);
  if (!st?.ai || ai === me) { res.valid = false; res.verdict = 'That is not a neighbouring village.'; return res; }
  const rel = relationPeek(g, me, ai);
  const status = relationStatus(rel);
  if (!rel.contact) res.problems.push(`You have not met ${name} yet.`);
  if (st.fallen) res.problems.push(`${name} has fallen; only ruins are left.`); // fallen.js
  if (status === 'hostile') res.problems.push(`${name} is hostile and will not trade.`);
  if (activeTradeBetween(g, me, ai)) res.problems.push(`A trade with ${name} is still being delivered. Wait for it to finish or call it off.`);
  if (tradeClosed(g, me, ai)) res.problems.push(`${name} has closed trade with you over smuggling until ${dayOf(attentionOf(g, ai, me).closedUntil)}.`);
  if (!give.length && !want.length) res.problems.push('Choose something to give or to ask for.');
  if (give.length > MAX_OFFER_ITEMS || want.length > MAX_OFFER_ITEMS) res.problems.push(`Use at most ${MAX_OFFER_ITEMS} different items on each side.`);
  for (const x of give) if (want.some((w) => w.item === x.item)) res.problems.push(`You cannot trade ${iname(g, x.item)} for itself.`);
  for (const x of give) {
    const have = availableToTrade(g, me, x.item);
    if (x.qty > have) res.problems.push(`You only have ${have} ${iname(g, x.item)} available.`);
    else if (x.qty > 200) res.problems.push('Offer at most 200 of each item at a time.');
  }
  if (res.problems.length) { res.valid = false; res.verdict = res.problems[0]; return res; }

  const willing = st.trade?.willingness ?? 0.7, generous = st.trade?.generosity ?? 0;
  const relK = status === 'friendly' ? 1.1 : rel.value < 0 ? 0.9 : 1;
  // A market both villages are in reach of prices every item (markets.js); the same ctx prices the deal.
  const px = { a: me, b: ai, market: marketFor(g, me, ai) };
  res.market = px.market || null;
  res.marketLine = null;
  res.prices = {};
  if (res.market) {
    for (const x of [...give, ...want]) res.prices[x.item] = { price: value(g, x.item, px), base: baseValue(g, x.item) };
    res.marketLine = res.lines.length; // index of the market line in res.lines (null without a market), for the UI
    res.lines.push(`Priced at the ${nameOf(g, res.market)} market: ${[...give, ...want].map((x) => `${iname(g, x.item)} ${res.prices[x.item].price} (value ${res.prices[x.item].base})`).join(', ')}.`);
  }
  const days = g.plans?.[me]?.foodDays;
  for (const x of give) {
    const law = lawFor(g, ai, x.item);
    if (law === 'restricted' && x.qty > ENFORCE.restrictedCap) { res.valid = false; res.verdict = `${iname(g, x.item)} is restricted in ${name}: at most ${ENFORCE.restrictedCap} per trade.`; return res; }
    const it = isControlled(g, x.item) ? { k: law === 'banned' ? ENFORCE.blackMarketPrice : law === 'restricted' ? ENFORCE.restrictedPrice : 1, why: law === 'banned' ? 'black-market price' : law === 'restricted' ? 'restricted: a premium' : 'legal there' } : interestIn(g, ai, x.item);
    const w = Math.round(x.qty * value(g, x.item, px) * it.k * relK);
    res.worthIn += w;
    if (law !== 'banned') res.goodwill = (res.goodwill || 0) + (law === 'legal' ? w : Math.round(w / ENFORCE.restrictedPrice)); // smuggled goods earn no goodwill
    res.lines.push(`You give ${x.qty} ${iname(g, x.item)}: worth ${w} to them (${it.why}).`);
    if (law !== 'legal') {
      const a = attentionOf(g, ai, me), add = (law === 'banned' ? ENFORCE.perUnitBanned : ENFORCE.perUnitRestricted) * x.qty;
      res.lines.push(`${LAW_LABEL[law]} in ${name}: their watch's attention on you rises by ${Math.round(add)} (now ${Math.round(a.value)}; fines at ${ENFORCE.fineAt}, trade closed at ${ENFORCE.closeAt}).`);
      if (law === 'banned') res.lines.push(`Smuggling: about ${Math.round(seizeChance(g, ai, me) * 100)}% chance this delivery is seized (${ENFORCE.seizeCost} relations, and they stop paying).`);
      res.risky = true;
    }
    // Promised goods are held for the delivery, so warn before giving away food the colony needs.
    if (g.reg.get('item', x.item)?.tags?.includes('core:food') && days !== undefined && days < 3 && !res.lines.some((l) => l.startsWith('Careful')))
      res.lines.push(`Careful: you have about ${Math.round(days * 10) / 10} days of food, and promised food is not eaten.`);
  }
  let short = null;
  for (const x of want) {
    const spare = spareOf(g, ai, x.item);
    const w = Math.round(x.qty * value(g, x.item, px));
    res.worthOut += w;
    res.lines.push(`You ask for ${x.qty} ${iname(g, x.item)}: worth ${w}; they can spare ${spare}.`);
    if (x.qty > spare && !short) short = spare ? `${name} can only spare ${spare} ${iname(g, x.item)}.` : `${name} has no ${iname(g, x.item)} to spare.`;
  }
  if (give.length > 1 || want.length > 1) res.lines.push(`In total: you give ${res.worthIn}, you ask for ${res.worthOut}.`);
  if (short) { res.verdict = short; return res; }

  if (give.length && !want.length) { // a gift is always welcome
    res.accept = true;
    res.relOnDone = res.goodwill ? giftRelation(res.goodwill) : 0;
    res.verdict = res.goodwill ? `${name} will gladly accept the gift.` : `${name}'s black market takes the goods; the village owes you nothing for them.`;
  } else if (!give.length && want.length) { // a request: only generous neighbours on good terms, and only small favours
    const pact = hasPact(g, me, ai), minRel = pact ? 5 : 15, maxQty = pact ? 25 : 15;
    const total = want.reduce((a, x) => a + x.qty, 0);
    const ok = generous >= 0.3 && rel.value >= minRel && total <= maxQty;
    res.accept = ok;
    res.relOnDone = ok ? 1 : 0;
    res.verdict = ok ? `${name} agrees to help you out.`
      : generous < 0.3 ? `${name} does not give things away.`
      : rel.value < minRel ? `${name} does not know you well enough to give things away (needs relations of +${minRel}).`
      : `${name} will give at most ${maxQty} items at a time.`;
  } else { // a trade: eager traders accept a thinner margin
    const pact = hasPact(g, me, ai);
    if (pact) res.lines.push('Trade pact: they accept a thinner margin.');
    const greed = greedOf(g, ai);
    if (greed > 0) res.lines.push(`Greedy folk there: they ask ${Math.round(greed * 100)}% more.`);
    const need = Math.ceil(res.worthOut * ((pact ? 1 : 1.15) - 0.25 * willing + greed));
    res.accept = res.worthIn >= need;
    res.relOnAgree = res.accept ? 2 : 0;
    res.relOnDone = res.accept ? 6 : 0;
    res.verdict = res.accept ? `${name} accepts: your offer is worth ${res.worthIn} to them (they want at least ${need}).`
      : `${name} refuses: your offer is worth ${res.worthIn} to them; they want at least ${need}.`;
  }
  return res;
}

/** The extra share a village asks in trade for its greedy adults (peoples.js: each adult's trait `trade`, at most GREED_MAX). */
export const GREED_MAX = 0.15;
export function greedOf(g, sid) {
  let x = 0;
  for (const c of g.owned('colonists', sid)) if (isAdult(g, c)) x += modsOf(g, c).trade;
  return Math.min(GREED_MAX, Math.round(x * 1000) / 1000);
}

/** Send an offer. If the neighbour accepts it becomes an active trade (one leg per item); returns { ok, message, tradeId }. */
export function proposeTrade(g, ai, offer) {
  const me = g.s.playerSettlement;
  const ev = evaluateOffer(g, ai, offer);
  if (!ev.valid) return { ok: false, message: ev.verdict };
  if (!ev.accept) {
    g.log(`${nameOf(g, ai)} turned down your offer. ${ev.verdict}`, 'trade');
    return { ok: false, message: ev.verdict };
  }
  const { give, want } = ev;
  const id = g.newId('tr');
  const legs = [
    ...want.map((x) => ({ from: ai, to: me, item: x.item, qty: x.qty, delivered: 0 })),
    ...give.map((x) => ({ from: me, to: ai, item: x.item, qty: x.qty, delivered: 0 })),
  ];
  const both = give.length && want.length;
  g.tradeAdded();
  g.s.trades[id] = {
    id, seller: want.length ? ai : me, buyer: want.length ? me : ai, legs, gift: !both, proposedBy: me, relOnDone: ev.relOnDone,
    status: 'active', created: g.s.tick, deadline: g.tradeDeadline(ai, me, g.s.tick + 3 * TICKS_PER_DAY),
    reason: both ? `Your offer${ev.market ? `, priced at the ${nameOf(g, ev.market)} market` : ''}` : give.length ? 'Your gift' : 'Your request',
    ...(both && ev.market ? { market: ev.market } : {}),
  };
  const what = both ? `${listText(g, give)} for ${listText(g, want)}` : give.length ? `a gift of ${listText(g, give)}` : `${listText(g, want)} as a favour`;
  g.log(`${nameOf(g, ai)} accepted your offer: ${what}. Your colonists will carry your side.`, 'trade');
  if (ev.relOnAgree) changeRelation(g, me, ai, ev.relOnAgree, 'Agreed a trade');
  return { ok: true, message: ev.verdict, tradeId: id };
}

/** Relation cost of calling off a trade now (more if the other side already delivered and was not paid). */
export function cancelCost(g, t, by) {
  let owed = 0, paid = 0;
  const other = t.seller === by ? t.buyer : t.seller;
  const px = { a: by, b: other, market: t.market ?? null }; // priced as the deal was: its market's prices, or the fixed values
  for (const l of t.legs) {
    if (l.to === by) owed += l.delivered * value(g, l.item, px);
    if (l.from === by) paid += l.delivered * value(g, l.item, px);
  }
  return -(4 + Math.max(0, Math.round((owed - paid) / 4))) + (hasPact(g, by, other) ? PACT.breakCost : 0);
}

/** The player calls off an active trade. Delivered goods stay delivered; goods on the way stay the sender's where they are dropped. */
export function cancelTrade(g, tradeId) {
  const me = g.s.playerSettlement;
  const t = g.s.trades?.[tradeId];
  if (!t || t.status !== 'active' || (t.seller !== me && t.buyer !== me)) return { ok: false, message: 'There is no such active trade.' };
  const other = t.seller === me ? t.buyer : t.seller;
  const delta = cancelCost(g, t, me);
  t.status = 'cancelled';
  changeRelation(g, me, other, delta, `${nameOf(g, me)} called off a trade`);
  g.log(`You called off the trade with ${nameOf(g, other)} (${delta} relations).`, 'warn');
  return { ok: true, message: `Trade called off (${delta}).` };
}

// ---------------- treaties: trade pacts (Phase 2, third slice) ----------------
// A trade pact is a standing agreement between two settlements that already trade and are on good
// terms. While it holds: offers between them need a thinner margin, small requests are granted more
// readily, completed trades strengthen relations a little more, and "friendly only" trade policies
// count pact partners as friends. It ends on its own when relations sour or trading stops, and either
// side can end it (at a visible cost). Alliances and military treaties need combat and come later.

export const PACT = {
  minRelation: 25,        // must be friendly to sign
  minTrades: 2,           // completed trades between the two
  keepRelation: 10,       // ends if relations fall below this
  lapseDays: 10,          // ends if no trade completes for this long
  endCost: -10,           // relation change for whoever ends it
  breakCost: -3,          // extra cost when a pact partner calls off a trade
  tradeBonus: 1,          // extra relation per completed trade
};

export function treatyOf(g, a, b) { return g.s.treaties?.[relKey(a, b)] || null; }
export const hasPact = (g, a, b) => treatyOf(g, a, b)?.kind === 'tradePact';

// Completed trades pruned from s.trades (contact games, contact.js pruneTrades) are counted on the relation
// (rel.tradesDone), so these counts include them.
function completedTradesBetween(g, a, b, done = null) {
  if (done) return done.get(relKey(a, b)) || 0;
  return Object.values(g.s.trades || {}).filter((t) => t.status === 'done' && ((t.seller === a && t.buyer === b) || (t.seller === b && t.buyer === a))).length
    + (relationPeek(g, a, b).tradesDone || 0);
}
/** Completed trades per pair (relKey), counted once: for the daily pass over every pair (aiDiplomacy). */
function completedTradeCounts(g) {
  const m = new Map();
  for (const t of Object.values(g.s.trades || {})) if (t.status === 'done' && t.seller !== t.buyer) { const k = relKey(t.seller, t.buyer); m.set(k, (m.get(k) || 0) + 1); }
  for (const [k, r] of Object.entries(g.s.relations || {})) if (r.tradesDone > 0) m.set(k, (m.get(k) || 0) + r.tradesDone);
  return m;
}
/** Read-only: completed trades of village `sid` with any other village (those still in s.trades plus those
 *  pruned, counted on its relations). For the village card. */
export function completedTradesOf(g, sid) {
  let n = 0;
  for (const t of Object.values(g.s.trades || {})) if (t.status === 'done' && (t.seller === sid || t.buyer === sid)) n++;
  for (const r of Object.values(g.s.relations || {})) if (r.tradesDone > 0 && (r.a === sid || r.b === sid)) n += r.tradesDone;
  return n;
}

/** Can `a` propose a trade pact to `b`, and would `b` sign? No side effects. `done` (optional): completed
 *  trade counts per pair from completedTradeCounts, for the daily pass. */
export function evaluatePact(g, a, b, doneCounts = null) {
  const rel = relationPeek(g, a, b);
  const nb = nameOf(g, b);
  const res = { valid: true, accept: false, problems: [], lines: [], verdict: '' };
  if (a === b || !settlementOf(g, b)) res.problems.push('That is not a neighbouring village.');
  if (settlementOf(g, a)?.fallen || settlementOf(g, b)?.fallen) res.problems.push('Only ruins are left there.'); // fallen.js
  if (!rel.contact) res.problems.push(`You have not met ${nb} yet.`);
  if (hasPact(g, a, b)) res.problems.push(`You already have a trade pact with ${nb}.`);
  const done = completedTradesBetween(g, a, b, doneCounts);
  if (rel.value < PACT.minRelation) res.problems.push(`Relations must be at least +${PACT.minRelation} (friendly); they are ${rel.value > 0 ? '+' : ''}${rel.value}.`);
  if (done < PACT.minTrades) res.problems.push(`Complete at least ${PACT.minTrades} trades first (${done} so far).`);
  if (res.problems.length) { res.valid = false; res.verdict = res.problems[0]; return res; }
  const willing = settlementOf(g, b)?.trade?.willingness ?? 0.7;
  res.accept = !settlementOf(g, b)?.ai || willing >= 0.5 || rel.value >= 40;
  res.lines.push('While it holds: offers between you need a thinner margin, small requests are granted more readily, and each completed trade adds +' + PACT.tradeBonus + ' more to relations.');
  res.lines.push(`It ends by itself if relations fall below +${PACT.keepRelation} or no trade completes for ${PACT.lapseDays} days. Ending it yourself costs ${PACT.endCost}; calling off a trade with a pact partner costs ${PACT.breakCost} extra.`);
  res.verdict = res.accept ? `${nb} agrees to a trade pact (+3 relations).` : `${nb} is not interested in a pact (it is a cautious trader; relations of +40 would change its mind).`;
  return res;
}

export function proposePact(g, a, b) {
  const ev = evaluatePact(g, a, b);
  if (!ev.valid || !ev.accept) { if (ev.valid) g.log(ev.verdict, 'trade'); return { ok: false, message: ev.verdict }; }
  g.s.treaties ||= {};
  g.s.treaties[relKey(a, b)] = { kind: 'tradePact', a: a < b ? a : b, b: a < b ? b : a, since: g.s.tick, lastTrade: g.s.tick };
  changeRelation(g, a, b, 3, 'Signed a trade pact');
  g.log(`${nameOf(g, a)} and ${nameOf(g, b)} signed a trade pact.`, 'trade');
  return { ok: true, message: ev.verdict };
}

/** End a pact. `by` is the settlement ending it (pays the cost), or null when it lapses on its own. */
export function endPact(g, a, b, by, reason) {
  const k = relKey(a, b);
  if (!g.s.treaties?.[k]) return { ok: false, message: 'There is no pact to end.' };
  delete g.s.treaties[k];
  if (by) changeRelation(g, a, b, PACT.endCost, `${nameOf(g, by)} ended the trade pact`);
  else relationOf(g, a, b).history.push({ tick: g.s.tick, delta: 0, reason: `Trade pact ended: ${reason}` });
  g.log(`The trade pact between ${nameOf(g, a)} and ${nameOf(g, b)} has ended${reason ? ` (${reason})` : ''}.`, 'warn');
  return { ok: true, message: 'Pact ended.' };
}

// ---------------- alliances (Phase 2, slice 1) ----------------
// A defensive pact between two friendly villages, kept apart from trade pacts (`s.alliances`, created only
// when the first one is signed). Allies cannot attack each other. When a village attacks one of them, the
// other turns hostile to the attacker (combat.js joinDefence); an ally of both sides stays out and its
// alliance with the attacker ends. Allies of the ally do nothing (no chaining). An alliance lapses when
// relations fall below friendly; ending one by hand costs relations, shown before signing.

export const ALLIANCE = {
  minRelation: 50,       // relation needed to sign
  lapseBelow: 25,        // ends by itself (daily check) when relations fall below this
  endCost: 20,           // relation lost by ending one by hand
  joinRelation: -50,     // a defending ally's relation with the attacker drops to at most this (hostile)
  proposeEveryDays: 5,   // an AI village asks the player again only after this many days
  maxAllies: 3,          // allies per village
  signBonus: 3,          // relation gained on signing
  strongerBy: 1.5,       // an enemy with this many times the fighters of both sides together is "much stronger"
};

export function allianceOf(g, a, b) { return g.s.alliances?.[relKey(a, b)] || null; }
/** Allied settlement ids of `sid`, sorted. Read-only. */
export function alliesOf(g, sid) {
  const out = [];
  for (const al of Object.values(g.s.alliances || {})) { if (al.a === sid) out.push(al.b); else if (al.b === sid) out.push(al.a); }
  return out.sort();
}
/** Settlements `sid` is at war with: hostile relations, or an attack order either way. Sorted, read-only. */
export function enemiesOf(g, sid) {
  const out = [];
  const mine = orderOf(g, sid);
  for (const x of Object.keys(g.s.settlements || {}).sort()) {
    if (x === sid) continue;
    const theirs = orderOf(g, x);
    if (isEnemy(g, sid, x) || (mine.order === 'attack' && mine.target === x) || (theirs.order === 'attack' && theirs.target === sid)) out.push(x);
  }
  return out;
}
const listNames = (g, ids) => ids.map((x) => nameOf(g, x)).join(', ');
const signed = (v) => `${v > 0 ? '+' : ''}${v}`;

/** Note a relation event that does not change the value (history kept to 16 entries, like changeRelation). */
export function noteRelation(g, a, b, reason) {
  const rel = relationOf(g, a, b);
  rel.history.push({ tick: g.s.tick, delta: 0, reason });
  if (rel.history.length > 16) rel.history.splice(0, rel.history.length - 16);
  return rel;
}

/** Why `a` and `b` would ally: a shared enemy, or one side's war. Read-only. */
export function allianceReason(g, a, b, eA = enemiesOf(g, a), eB = enemiesOf(g, b)) {
  const shared = eA.filter((e) => eB.includes(e));
  if (shared.length) return `both are at war with ${listNames(g, shared)}`;
  if (eA.length) return `${nameOf(g, a)} is at war with ${listNames(g, eA)}`;
  if (eB.length) return `${nameOf(g, b)} is at war with ${listNames(g, eB)}`;
  return '';
}

/** Can `a` propose an alliance to `b`, and would `b` sign? The terms are in `lines`. No side effects.
 *  `ctx` (optional, the daily AI pass): { enemies: Map, fighters: Map } caches per village. */
export function evaluateAlliance(g, a, b, ctx = null) {
  const enemiesFor = (x) => { if (!ctx) return enemiesOf(g, x); if (!ctx.enemies.has(x)) ctx.enemies.set(x, enemiesOf(g, x)); return ctx.enemies.get(x); };
  const fightersFor = (x) => { if (!ctx) return fightersOf(g, x).length; if (!ctx.fighters.has(x)) ctx.fighters.set(x, fightersOf(g, x).length); return ctx.fighters.get(x); };
  const res = { valid: true, accept: false, problems: [], lines: [], verdict: '' };
  const na = nameOf(g, a), nb = nameOf(g, b);
  if (a === b || !settlementOf(g, a) || !settlementOf(g, b) || settlementOf(g, a).fallen || settlementOf(g, b).fallen) { // ruins: fallen.js
    res.valid = false; res.problems.push('That is not a neighbouring village.'); res.verdict = res.problems[0]; return res;
  }
  const rel = relationPeek(g, a, b);
  const eA = enemiesFor(a), eB = enemiesFor(b);
  if (!rel.contact) res.problems.push(`${na} has not met ${nb} yet.`);
  if (allianceOf(g, a, b)) res.problems.push(`${na} and ${nb} are already allies.`);
  if (eA.includes(b)) res.problems.push(`${na} and ${nb} are at war. Make peace first.`);
  for (const [x, nx] of [[a, na], [b, nb]]) if (alliesOf(g, x).length >= ALLIANCE.maxAllies) res.problems.push(`${nx} already has ${ALLIANCE.maxAllies} allies, the most it can have.`);
  if (res.problems.length) { res.valid = false; res.verdict = res.problems[0]; return res; }
  res.lines.push(eA.length ? `${na} is at war with ${listNames(g, eA)}: ${nb} would be expected to fight them.` : `${na} is at war with nobody.`);
  res.lines.push(eB.length ? `${nb} is at war with ${listNames(g, eB)}: ${na} would be expected to fight them.` : `${nb} is at war with nobody.`);
  const allB = alliesOf(g, b);
  res.lines.push(allB.length ? `${nb}'s allies: ${listNames(g, allB)}.` : `${nb} has no allies yet.`);
  res.lines.push(`Relations needed: at least +${ALLIANCE.minRelation} (friendly); they are ${signed(rel.value)}.`);
  res.lines.push(`It ends by itself if relations fall below +${ALLIANCE.lapseBelow}, or if either side attacks an ally of the other. Ending it by hand costs -${ALLIANCE.endCost} relations.`);
  if (rel.value < ALLIANCE.minRelation) {
    res.verdict = `${nb} wants relations of at least +${ALLIANCE.minRelation} first (they are ${signed(rel.value)}).`;
    return res;
  }
  // b's judgement: would the alliance drag it into a war with a village much stronger than both together?
  const ours = fightersFor(a) + fightersFor(b);
  for (const e of eA) {
    if (eB.includes(e) || allianceOf(g, b, e)) continue; // already b's war, or b's ally (it would stay out)
    const theirs = fightersFor(e);
    if (theirs >= 2 && theirs > ALLIANCE.strongerBy * ours) {
      const why = `${nameOf(g, e)} (about ${theirs} fighters) is much stronger than ${na} and ${nb} together (${ours}).`;
      res.lines.push(`Risk for ${nb}: ${why}`);
      res.verdict = `${nb} refuses: it would be dragged into a war it cannot win. ${why}`;
      return res;
    }
  }
  res.accept = true;
  res.verdict = `${nb} agrees to an alliance (+${ALLIANCE.signBonus} relations).`;
  return res;
}

/** Sign an alliance (the caller has checked evaluateAlliance). `by` is the proposer; `reason` (optional) is
 *  why, shown in the log and the relation history and kept on the record. */
export function signAlliance(g, a, b, by, reason = '') {
  g.s.alliances ||= {};
  g.s.alliances[relKey(a, b)] = { a: a < b ? a : b, b: a < b ? b : a, since: g.s.tick, by, ...(reason ? { reason } : {}) };
  changeRelation(g, a, b, ALLIANCE.signBonus, `Signed an alliance${reason ? ` (${reason})` : ''}`);
  g.log(`${nameOf(g, a)} and ${nameOf(g, b)} signed an alliance${reason ? ` (${reason})` : ''}: each will defend the other.`, 'trade');
  return { ok: true, msg: 'Alliance signed.', message: 'Alliance signed.' };
}

/** `from` proposes an alliance to `to`; it is signed if `to` accepts, otherwise refused with the reason. */
export function proposeAlliance(g, from, to) {
  const ev = evaluateAlliance(g, from, to);
  if (!ev.valid) return { ok: false, msg: ev.verdict, message: ev.verdict };
  if (!ev.accept) {
    g.log(`${nameOf(g, to)} declined an alliance with ${nameOf(g, from)}: ${ev.verdict}`, 'trade');
    return { ok: false, msg: ev.verdict, message: ev.verdict };
  }
  signAlliance(g, from, to, from);
  return { ok: true, msg: ev.verdict, message: ev.verdict };
}

/** End an alliance. `by` is the side ending it by hand (pays ALLIANCE.endCost), or null when it lapses.
 *  `opts.free`: `by` ends it because of the other side's act (attacking its ally), at no cost. */
export function endAlliance(g, a, b, by, reason, opts = {}) {
  const k = relKey(a, b);
  if (!g.s.alliances?.[k]) return { ok: false, msg: 'There is no alliance to end.', message: 'There is no alliance to end.' };
  delete g.s.alliances[k];
  const other = by === a ? b : a;
  if (by && !opts.free) {
    changeRelation(g, a, b, -ALLIANCE.endCost, 'Ended our alliance');
    g.log(`${nameOf(g, by)} ended its alliance with ${nameOf(g, other)} (-${ALLIANCE.endCost} relations).`, 'warn');
  } else {
    noteRelation(g, a, b, `Alliance ended: ${reason || 'ended'}`);
    g.log(by ? `${nameOf(g, by)} has left its alliance with ${nameOf(g, other)}${reason ? ` (${reason})` : ''}.`
      : `The alliance between ${nameOf(g, a)} and ${nameOf(g, b)} has ended${reason ? ` (${reason})` : ''}.`, 'warn');
  }
  return { ok: true, msg: 'Alliance ended.', message: 'Alliance ended.' };
}

/** Daily: alliances lapse when relations sour. */
function tickAlliances(g) {
  if (!g.s.alliances) return;
  for (const k of Object.keys(g.s.alliances).sort()) {
    const al = g.s.alliances[k];
    if (!al) continue;
    if (relationPeek(g, al.a, al.b).value < ALLIANCE.lapseBelow) endAlliance(g, al.a, al.b, null, 'lapsed: relations soured');
  }
}

/** Daily upkeep: pacts end when relations sour or trade stops. */
function tickPacts(g) {
  for (const p of Object.values(g.s.treaties || {})) {
    if (p.kind !== 'tradePact') continue;
    const rel = relationPeek(g, p.a, p.b);
    if (rel.value < PACT.keepRelation) endPact(g, p.a, p.b, null, 'relations fell too low');
    else if (g.s.tick - p.lastTrade > PACT.lapseDays * TICKS_PER_DAY) endPact(g, p.a, p.b, null, `no trade for ${PACT.lapseDays} days`);
  }
  tickAlliances(g);
  aiDiplomacy(g);
  tickWars(g, TICKS_PER_DAY);
  borderDiplomacy(g);
  tickEnforcement(g);
}

// ---------------- proposals from AI villages (Phase 2, fourth slice) ----------------
// Once a day, AI villages look for pacts they qualify for. Two AI villages that both want one simply
// sign. An AI village that wants a pact with the player sends a proposal, which the player accepts or
// declines in the Neighbours panel. Unanswered proposals expire after 2 days without penalty; declining
// costs a little goodwill and the village waits before asking again.

export const PROPOSAL = { expireDays: 2, askAgainDays: 5, declineCost: -1 };

/** Would `ai` like a pact with `other`? Same personality rule the AI uses when it is asked. */
function aiWantsPact(g, ai, other) {
  const st = settlementOf(g, ai);
  return !!st?.ai && ((st.trade?.willingness ?? 0.7) >= 0.5 || relationPeek(g, ai, other).value >= 40);
}

export function pendingProposals(g, to) {
  return Object.values(g.s.proposals || {}).filter((p) => p.to === to && p.status === 'pending');
}

function aiDiplomacy(g) {
  const s = g.s;
  const me = s.playerSettlement;
  const ids = Object.keys(s.settlements || {}).sort().filter((x) => !s.settlements[x].fallen); // no deals with ruins (fallen.js)
  // Daily alliance pass state (never saved): who already proposed or signed today; enemies and fighter
  // counts per village, built on first use (signing does not change them); and the AI villages' alliance
  // proposals to the player, indexed once.
  const ctx = { busy: new Set(), enemies: new Map(), fighters: new Map(), asked: null, done: completedTradeCounts(g) };
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i], b = ids[j];
    aiPactPair(g, a, b, me, ctx.done, ctx);
    aiAlliancePair(g, a, b, me, ctx);
  }
}

/** evaluatePact(g, a, b, doneCounts).valid, without writing its texts (the daily pass asks it of every pair). */
function pactValid(g, a, b, doneCounts) {
  const rel = relationPeek(g, a, b);
  if (a === b || !settlementOf(g, b) || !rel.contact || hasPact(g, a, b)) return false;
  return !(rel.value < PACT.minRelation) && !(completedTradesBetween(g, a, b, doneCounts) < PACT.minTrades);
}

function aiPactPair(g, a, b, me, done, ctx = null) {
  const s = g.s;
  if (hasPact(g, a, b) || !pactValid(g, a, b, done)) return;
  const aiA = settlementOf(g, a)?.ai, aiB = settlementOf(g, b)?.ai;
  if (aiA && aiB) {
    if (aiWantsPact(g, a, b) && aiWantsPact(g, b, a)) proposePact(g, a, b);
    return;
  }
  const ai = aiA ? a : aiB ? b : null;
  const other = ai === a ? b : a;
  if (!ai || other !== me || !aiWantsPact(g, ai, me)) return;
  // Villages with a pending pact proposal to the player: listed once per daily pass (ctx) and kept up to date
  // below (proposals are only added during it), the same answer as looking through every proposal each time.
  if (ctx && !ctx.pactAsked) { ctx.pactAsked = new Set(); for (const p of Object.values(s.proposals || {})) if (p.kind === 'tradePact' && p.to === me && p.status === 'pending') ctx.pactAsked.add(p.from); }
  if (ctx ? ctx.pactAsked.has(ai) : Object.values(s.proposals || {}).some((p) => p.kind === 'tradePact' && p.from === ai && p.to === me && p.status === 'pending')) return;
  const last = s.diplomacy?.lastAsked?.[ai];
  if (last !== undefined && s.tick - last < PROPOSAL.askAgainDays * TICKS_PER_DAY) return;
  s.proposals ||= {};
  const id = g.newId('pp');
  s.proposals[id] = { id, kind: 'tradePact', from: ai, to: me, status: 'pending', created: s.tick, expires: s.tick + PROPOSAL.expireDays * TICKS_PER_DAY };
  ctx?.pactAsked?.add(ai);
  s.diplomacy = { ...(s.diplomacy || {}), lastAsked: { ...(s.diplomacy?.lastAsked || {}), [ai]: s.tick } };
  g.log(`${nameOf(g, ai)} proposes a trade pact. Answer in the Neighbours panel.`, 'trade');
}

/** Friendly villages where at least one side is at war (a shared enemy, or one side's enemy) seek an
 *  alliance. The side at war proposes; both sides must accept the terms. AI pairs sign at once; an AI
 *  village sends the player a proposal (again only after ALLIANCE.proposeEveryDays). */
function aiAlliancePair(g, a, b, me, ctx) {
  const s = g.s, busy = ctx.busy;
  if (busy.has(a) || busy.has(b)) return;
  const rel = relationPeek(g, a, b);
  if (!rel.contact || rel.value < ALLIANCE.minRelation || allianceOf(g, a, b)) return;
  const aiA = settlementOf(g, a)?.ai, aiB = settlementOf(g, b)?.ai;
  if (!aiA && !aiB) return;
  const enemy = (x) => { if (!ctx.enemies.has(x)) ctx.enemies.set(x, enemiesOf(g, x)); return ctx.enemies.get(x); };
  const eA = enemy(a), eB = enemy(b);
  if (!eA.length && !eB.length) return;
  if (aiA && aiB) {
    const from = eA.length ? a : b, to = from === a ? b : a;
    if (!evaluateAlliance(g, from, to, ctx).accept || !evaluateAlliance(g, to, from, ctx).accept) return;
    signAlliance(g, from, to, from, allianceReason(g, from, to, enemy(from), enemy(to)));
    busy.add(a); busy.add(b);
    return;
  }
  const ai = aiA ? a : b, other = ai === a ? b : a;
  if (other !== me) return;
  const ev = evaluateAlliance(g, me, ai, ctx); // the AI village's own judgement of the terms
  if (!ev.valid || !ev.accept) return;
  if (!ctx.asked) { // ai -> { pending, last } for alliance proposals to the player, built once a day
    ctx.asked = new Map();
    for (const p of Object.values(s.proposals || {})) {
      if (p.kind !== 'alliance' || p.to !== me) continue;
      const e = ctx.asked.get(p.from) || { pending: false, last: -Infinity };
      if (p.status === 'pending') e.pending = true;
      if (p.created > e.last) e.last = p.created;
      ctx.asked.set(p.from, e);
    }
  }
  const asked = ctx.asked.get(ai);
  if (asked && (asked.pending || s.tick - asked.last < ALLIANCE.proposeEveryDays * TICKS_PER_DAY)) return;
  const reason = allianceReason(g, ai, me, enemy(ai), enemy(me));
  s.proposals ||= {};
  const id = g.newId('pp');
  s.proposals[id] = { id, kind: 'alliance', from: ai, to: me, status: 'pending', created: s.tick, expires: s.tick + PROPOSAL.expireDays * TICKS_PER_DAY, reason };
  ctx.asked.set(ai, { pending: true, last: s.tick });
  busy.add(ai);
  g.log(`${nameOf(g, ai)} proposes an alliance (${reason}). Answer in the Neighbours panel.`, 'trade');
}

/** Unanswered proposals lapse (checked with the other village upkeep, every 100 ticks). */
function expireProposals(g) {
  for (const p of Object.values(g.s.proposals || {})) {
    if (p.status === 'pending' && g.s.tick >= p.expires) {
      p.status = 'expired';
      g.log(`${nameOf(g, p.from)}'s ${p.kind === 'gatherRights' ? 'request for gathering rights' : p.kind === 'alliance' ? 'alliance proposal' : 'pact proposal'} expired unanswered.`, 'trade');
    }
  }
}

/** The player answers a proposal. Accepting signs the pact (if the conditions still hold). */
export function answerProposal(g, id, accept) {
  const p = g.s.proposals?.[id];
  if (!p || p.status !== 'pending') return { ok: false, message: 'That proposal is no longer open.' };
  if (p.kind === 'gatherRights') {
    if (accept) { p.status = 'accepted'; grantRights(g, p.to, p.from, p.node); return { ok: true, message: 'Granted.' }; }
    p.status = 'declined';
    changeRelation(g, p.to, p.from, RIGHTS.refuseCost, `${nameOf(g, p.to)} refused gathering rights (${nodeName(g, p.node)})`);
    startDispute(g, p.from, p.to, p.node, p.item);
    g.log(`You refused ${nameOf(g, p.from)} gathering rights. Expect a border dispute while they lack ${nodeName(g, p.node)}.`, 'trade');
    return { ok: true, message: 'Refused.' };
  }
  if (p.kind === 'alliance') {
    if (!accept) {
      p.status = 'declined';
      changeRelation(g, p.to, p.from, PROPOSAL.declineCost, `${nameOf(g, p.to)} declined an alliance`);
      g.log(`You declined ${nameOf(g, p.from)}'s alliance proposal.`, 'trade');
      return { ok: true, message: 'Declined.', msg: 'Declined.' };
    }
    const ev = evaluateAlliance(g, p.to, p.from); // the proposer's terms must still hold
    if (!ev.valid || !ev.accept) { p.status = 'expired'; return { ok: false, message: ev.verdict, msg: ev.verdict }; }
    p.status = 'accepted';
    return signAlliance(g, p.from, p.to, p.from, p.reason || '');
  }
  if (!accept) {
    p.status = 'declined';
    changeRelation(g, p.to, p.from, PROPOSAL.declineCost, `${nameOf(g, p.to)} declined a trade pact`);
    g.log(`You declined ${nameOf(g, p.from)}'s pact proposal.`, 'trade');
    return { ok: true, message: 'Declined.' };
  }
  const ev = evaluatePact(g, p.to, p.from);
  if (!ev.valid) { p.status = 'expired'; return { ok: false, message: ev.verdict }; }
  p.status = 'accepted';
  return proposePact(g, p.to, p.from);
}

// ---------------- territory: gathering rights and border disputes (Phase 2, fifth slice) ----------------
// Land belongs to the nearest village centre, and nobody gathers on another village's land. A village
// that cannot find a resource on its own land, while a neighbour has some near the border, asks for
// gathering rights for that kind of resource. Granted rights let its colonists gather there (never
// build or farm), within RIGHTS.range of their own centre. A refusal starts a border dispute: while
// the need lasts, relations slip a little each day (up to a cap), each change recorded with its cause.

export const RIGHTS = { range: 18, grantRel: 5, plentyNodes: 6, grantGain: 4, refuseCost: -2, revokeCost: -5, covetPerDay: -1, covetCap: -8, askAgainDays: 4 };

const rightsKey = (owner, grantee) => `${owner}>${grantee}`;
export const rightsOf = (g, owner, grantee) => g.s.rights?.[rightsKey(owner, grantee)] || null;
const nodeName = (g, def) => g.reg.get('node', def)?.name || def;

/** Unexhausted nodes of kind `def` on `owner`'s land within reach of `grantee`'s centre (anyOwner: on
 *  anyone's land or none, for callers that sort them by owner themselves). */
export function borderNodes(g, owner, grantee, def, anyOwner = false) {
  const c = settlementOf(g, grantee)?.center;
  if (!c) return [];
  // Nodes of that kind in the chunks round the centre only (g.nodesNear, chunk order). Callers count them.
  return g.nodesNear(c.x, c.y, RIGHTS.range, new Set([def]))
    .filter((n) => !n.empty && Math.hypot(n.x - c.x, n.y - c.y) <= RIGHTS.range && (anyOwner || g.territoryAt(n.x, n.y) === owner));
}
/** Node kinds a grantee could usefully ask `owner` for (some near the border), most plentiful first. */
export function askableNodes(g, owner, grantee) {
  const counts = {};
  const c = settlementOf(g, grantee)?.center;
  if (!c) return [];
  for (const n of Object.values(g.s.nodes)) {
    if (n.empty || g.territoryAt(n.x, n.y) !== owner || Math.hypot(n.x - c.x, n.y - c.y) > RIGHTS.range) continue;
    if (!(g.reg.get('node', n.def)?.yields || []).length) continue;
    counts[n.def] = (counts[n.def] || 0) + 1;
  }
  return Object.entries(counts).filter(([d]) => !rightsOf(g, owner, grantee)?.nodes.includes(d)).sort((a, b) => b[1] - a[1]).map(([def, n]) => ({ def, n }));
}

/** Would `owner` grant `grantee` rights to gather `def`? No side effects. */
export function evaluateRights(g, grantee, owner, def) {
  const res = { valid: true, accept: false, problems: [], lines: [], verdict: '' };
  const rel = relationPeek(g, grantee, owner);
  const on = nameOf(g, owner), what = nodeName(g, def);
  if (!rel.contact) res.problems.push(`You have not met ${on} yet.`);
  if (settlementOf(g, owner)?.fallen) res.problems.push(`${on} has fallen; only ruins are left.`); // fallen.js
  if (relationStatus(rel) === 'hostile') res.problems.push(`${on} is hostile.`);
  if (rightsOf(g, owner, grantee)?.nodes.includes(def)) res.problems.push(`You may already gather ${what} there.`);
  const near = borderNodes(g, owner, grantee, def).length;
  if (!near) res.problems.push(`There is no ${what} on ${on}'s land within ${RIGHTS.range} tiles of your centre.`);
  if (res.problems.length) { res.valid = false; res.verdict = res.problems[0]; return res; }
  const ownTotal = (g.nodesByDef().get(def) || []).filter((n) => !n.empty && g.territoryAt(n.x, n.y) === owner).length;
  res.lines.push(`${what}: ${near} on ${on}'s land are within reach of your colonists (they have ${ownTotal} on their land in all).`);
  res.lines.push('Rights let your colonists gather that resource there; they never build or farm on it. The owner can revoke them (at a cost to relations).');
  if (!settlementOf(g, owner)?.ai) { res.accept = true; res.verdict = 'This is your own land.'; return res; }
  const minRel = hasPact(g, grantee, owner) ? 0 : RIGHTS.grantRel;
  res.accept = rel.value >= minRel && ownTotal >= RIGHTS.plentyNodes;
  res.verdict = res.accept ? `${on} agrees (+${RIGHTS.grantGain} relations).`
    : rel.value < minRel ? `${on} refuses: relations must be at least +${minRel}.`
    : `${on} refuses: it has too little ${what} itself (${ownTotal}; needs ${RIGHTS.plentyNodes}).`;
  return res;
}

export function grantRights(g, owner, grantee, def) {
  g.s.rights ||= {};
  const k = rightsKey(owner, grantee);
  const r = (g.s.rights[k] ||= { owner, grantee, nodes: [], since: g.s.tick, range: RIGHTS.range });
  if (!r.nodes.includes(def)) r.nodes.push(def);
  r.nodes.sort();
  delete g.s.disputes?.[`${grantee}>${owner}:${def}`];
  changeRelation(g, owner, grantee, RIGHTS.grantGain, `${nameOf(g, owner)} granted gathering rights (${nodeName(g, def)})`);
  g.log(`${nameOf(g, owner)} lets ${nameOf(g, grantee)} gather ${nodeName(g, def)} near the border.`, 'trade');
  g.planDirty = true;
  (g.replanSids ||= new Set()).add(owner).add(grantee); // big worlds: both plan on the next tick
}

export function revokeRights(g, owner, grantee, def) {
  const r = rightsOf(g, owner, grantee);
  if (!r || !r.nodes.includes(def)) return { ok: false, message: 'There are no such rights.' };
  r.nodes = r.nodes.filter((d) => d !== def);
  if (!r.nodes.length) delete g.s.rights[rightsKey(owner, grantee)];
  changeRelation(g, owner, grantee, RIGHTS.revokeCost, `${nameOf(g, owner)} revoked gathering rights (${nodeName(g, def)})`);
  g.log(`${nameOf(g, owner)} revoked ${nameOf(g, grantee)}'s rights to gather ${nodeName(g, def)}.`, 'warn');
  // Colonists already walking to such a node lose their target on the next check (gatherOk fails).
  g.planDirty = true;
  (g.replanSids ||= new Set()).add(owner).add(grantee); // big worlds: both plan on the next tick
  return { ok: true, message: 'Revoked.' };
}

/** The player asks an AI neighbour for gathering rights. */
export function requestRights(g, owner, def) {
  const me = g.s.playerSettlement;
  const ev = evaluateRights(g, me, owner, def);
  if (!ev.valid) return { ok: false, message: ev.verdict };
  if (!ev.accept) { g.log(`${nameOf(g, owner)} refused gathering rights. ${ev.verdict}`, 'trade'); return { ok: false, message: ev.verdict }; }
  grantRights(g, owner, me, def);
  return { ok: true, message: ev.verdict };
}

function startDispute(g, coveter, owner, def, item) {
  g.s.disputes ||= {};
  const k = `${coveter}>${owner}:${def}`;
  if (!g.s.disputes[k]) g.s.disputes[k] = { coveter, owner, node: def, item, since: g.s.tick, accum: 0 };
}

/**
 * Daily: your own colony, when a resource it needs has run out on its land, asks the AI neighbour with the
 * most of it near the border for gathering rights (the same rules an AI village uses). A refusal costs
 * nothing and starts no dispute; it asks that neighbour again after RIGHTS.askAgainDays. Bounded: one
 * request per day, only for resources the plan is short of, only villages already met.
 */
function playerAsksRights(g, sid) {
  const s = g.s;
  if ((s.diplomacy?.autoRights ?? true) === false) return; // on unless a save sets diplomacy.autoRights = false
  s.diplomacy ||= { tradePolicy: 'open' };
  const asked = (s.diplomacy.askedRights ||= {});
  for (const [item, need] of Object.entries(g.plans?.[sid]?.landNeeds || {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
    let best = null;
    for (const owner of Object.keys(s.settlements).sort()) {
      if (owner === sid || !settlementOf(g, owner)?.ai || !relationPeek(g, sid, owner).contact) continue;
      for (const def of need.nodes) {
        if (rightsOf(g, owner, sid)?.nodes.includes(def)) continue;
        const last = asked[`${owner}:${def}`];
        if (last !== undefined && s.tick - last < RIGHTS.askAgainDays * TICKS_PER_DAY) continue;
        const n = borderNodes(g, owner, sid, def).length;
        if (n && (!best || n > best.n)) best = { owner, def, n };
      }
    }
    if (!best) continue;
    asked[`${best.owner}:${best.def}`] = s.tick;
    const ev = evaluateRights(g, sid, best.owner, best.def);
    if (ev.accept) grantRights(g, best.owner, sid, best.def);
    else g.log(`${nameOf(g, sid)} has no ${nodeName(g, best.def)} left for ${g.reg.get('item', item)?.name || item} and asked ${nameOf(g, best.owner)} for gathering rights, but was refused: ${ev.verdict}`, 'trade');
    return; // one request per day
  }
}

/** Daily: AI villages short of a resource on their own land ask a neighbour for gathering rights;
 *  border disputes cost a little goodwill each day while the need lasts, then are settled. */
function borderDiplomacy(g) {
  const s = g.s;
  const me = s.playerSettlement;
  for (const sid of Object.keys(s.settlements || {}).sort()) {
    if (s.settlements[sid].fallen) continue; // ruins ask nothing (fallen.js)
    if (!settlementOf(g, sid)?.ai) { if (sid === me) playerAsksRights(g, sid); continue; }
    // Nodes of a kind round our centre, looked up once per kind (borderNodes for each neighbour filters the
    // same list by owner; nodes and land do not change in this pass, so the counts are the same).
    const nearOf = new Map();
    const borderCount = (owner, def) => {
      let near = nearOf.get(def);
      if (!near) nearOf.set(def, (near = borderNodes(g, null, sid, def, true)));
      let n = 0;
      for (const nd of near) if (g.territoryAt(nd.x, nd.y) === owner) n++;
      return n;
    };
    for (const [item, need] of Object.entries(g.ensurePlan(sid)?.landNeeds || {})) {
      // The neighbour with the most of a suitable resource near our border.
      let best = null;
      for (const owner of Object.keys(s.settlements)) {
        if (owner === sid || !relationPeek(g, sid, owner).contact) continue;
        for (const def of need.nodes) {
          if (rightsOf(g, owner, sid)?.nodes.includes(def)) continue;
          const n = borderCount(owner, def);
          if (n && (!best || n > best.n)) best = { owner, def, n };
        }
      }
      if (!best) continue;
      const dk = `${sid}>${best.owner}:${best.def}`;
      if (s.disputes?.[dk]) continue; // already refused: the dispute runs its course below
      if (settlementOf(g, best.owner)?.ai) {
        const ev = evaluateRights(g, sid, best.owner, best.def);
        if (ev.accept) grantRights(g, best.owner, sid, best.def);
        else if (ev.valid) { startDispute(g, sid, best.owner, best.def, item); g.log(`${nameOf(g, best.owner)} refused ${nameOf(g, sid)} gathering rights for ${nodeName(g, best.def)}.`, 'trade'); }
        continue;
      }
      if (best.owner !== me) continue;
      if (Object.values(s.proposals || {}).some((p) => p.kind === 'gatherRights' && p.from === sid && p.status === 'pending')) continue;
      const last = s.diplomacy?.lastAskedRights?.[sid];
      if (last !== undefined && s.tick - last < RIGHTS.askAgainDays * TICKS_PER_DAY) continue;
      const id = g.newId('pp');
      s.proposals ||= {};
      s.proposals[id] = { id, kind: 'gatherRights', from: sid, to: me, node: best.def, item, status: 'pending', created: s.tick, expires: s.tick + PROPOSAL.expireDays * TICKS_PER_DAY };
      s.diplomacy = { ...(s.diplomacy || {}), lastAskedRights: { ...(s.diplomacy?.lastAskedRights || {}), [sid]: s.tick } };
      g.log(`${nameOf(g, sid)} has no ${nodeName(g, best.def)} left on its land and asks to gather some near your border. Answer in the Neighbours panel.`, 'trade');
    }
  }
  // Disputes: resentment grows slowly while the need lasts; they end when the need is gone or rights are granted.
  for (const [k, d] of Object.entries(s.disputes || {})) {
    const still = g.ensurePlan(d.coveter)?.landNeeds?.[d.item] && !rightsOf(g, d.owner, d.coveter)?.nodes.includes(d.node);
    if (!still) {
      delete s.disputes[k];
      relationOf(g, d.coveter, d.owner).history.push({ tick: s.tick, delta: 0, reason: `Border dispute over ${nodeName(g, d.node)} settled` });
      continue;
    }
    if (d.accum > RIGHTS.covetCap) {
      d.accum += RIGHTS.covetPerDay;
      changeRelation(g, d.coveter, d.owner, RIGHTS.covetPerDay, `${nameOf(g, d.coveter)} covets ${nodeName(g, d.node)} across the border`);
    }
  }
}

// ---------------- controlled goods, laws and enforcement ----------------
// Items tagged core:controlled are subject to each village's laws: legal, restricted or banned (by item id,
// by tag, or a default; AI villages ban what their laws do not mention). Selling them where they are
// restricted draws a little enforcement attention; selling them on a village's black market where they
// are banned pays much more but draws a lot of attention, and deliveries may be seized. Attention belongs
// to one village's watch and is separate from diplomatic relations; it fades over time. Crossing
// thresholds brings fines and closed trade, each with a recorded reason. AI villages never trade
// controlled goods on their own: only the player's offers do.

export const LAW_LABEL = { legal: 'Legal', restricted: 'Restricted', banned: 'Banned' };
export const ENFORCE = {
  restrictedCap: 10, // units per trade a village accepts where restricted
  restrictedPrice: 1.3, blackMarketPrice: 2.2,
  perUnitRestricted: 0.4, perUnitBanned: 1.6, // attention per unit delivered
  seizeBase: 0.12, // seizure chance per banned delivery: base + attention / 250, times the village's enforcement
  decayPerDay: 3, fineAt: 40, closeAt: 70, closeDays: 10, fineCost: -6, seizeCost: -8, closeCost: -10,
};

export const isControlled = (g, item) => !!g.reg.get('item', item)?.tags?.includes('core:controlled');
export const anyControlled = (g) => g.reg.all('item').some((d) => d.tags?.includes('core:controlled'));

/** The law on an item in a settlement: legal, restricted or banned. */
export function lawFor(g, sid, item) {
  if (!isControlled(g, item)) return 'legal';
  const st = settlementOf(g, sid);
  const laws = st?.laws || {};
  if (laws[item]) return laws[item];
  for (const t of g.reg.get('item', item)?.tags || []) if (laws[t]) return laws[t];
  return laws.default || (st?.ai ? 'banned' : 'legal');
}

const enfKey = (j, actor) => `${j}>${actor}`;
/** Enforcement attention of jurisdiction j toward trader actor: { value, history[], closedUntil }. */
export function attentionOf(g, j, actor) {
  g.s.enforcement ||= {};
  return (g.s.enforcement[enfKey(j, actor)] ||= { value: 0, history: [], closedUntil: 0 });
}
export const tradeClosed = (g, a, b) => (g.s.enforcement?.[enfKey(a, b)]?.closedUntil || 0) > g.s.tick || (g.s.enforcement?.[enfKey(b, a)]?.closedUntil || 0) > g.s.tick;

/** Chance a banned delivery into j by actor is seized right now. */
export function seizeChance(g, j, actor) {
  const enf = settlementOf(g, j)?.enforcement ?? 0.6;
  return Math.min(0.9, (ENFORCE.seizeBase + attentionOf(g, j, actor).value / 250) * (0.4 + enf));
}

function raiseAttention(g, j, actor, delta, reason) {
  const a = attentionOf(g, j, actor);
  const before = a.value;
  a.value = Math.min(100, Math.round((a.value + delta) * 10) / 10);
  a.history.push({ tick: g.s.tick, delta: Math.round(delta * 10) / 10, reason });
  if (a.history.length > 12) a.history.splice(0, a.history.length - 12);
  if (before < ENFORCE.fineAt && a.value >= ENFORCE.fineAt) {
    changeRelation(g, j, actor, ENFORCE.fineCost, `${nameOf(g, j)} fined ${nameOf(g, actor)} for smuggling`);
    g.log(`${nameOf(g, j)}'s watch fined ${nameOf(g, actor)} for smuggling (attention ${Math.round(a.value)}).`, 'warn');
  }
  if (before < ENFORCE.closeAt && a.value >= ENFORCE.closeAt) {
    a.closedUntil = g.s.tick + ENFORCE.closeDays * TICKS_PER_DAY;
    for (const t of Object.values(g.s.trades || {})) if (t.status === 'active' && ((t.seller === j && t.buyer === actor) || (t.seller === actor && t.buyer === j))) t.status = 'cancelled';
    if (hasPact(g, j, actor)) endPact(g, j, actor, null, 'closed over smuggling');
    changeRelation(g, j, actor, ENFORCE.closeCost, `${nameOf(g, j)} closed trade over smuggling`);
    g.log(`${nameOf(g, j)} has closed all trade with ${nameOf(g, actor)} for ${ENFORCE.closeDays} days over smuggling.`, 'warn');
  }
}

/** A trade leg has delivered `qty` units: laws at the destination apply to controlled goods. */
export function onLegDelivered(g, t, legIdx, qty) {
  const leg = t.legs[legIdx];
  if (!isControlled(g, leg.item) || !settlementOf(g, leg.to)?.ai) return;
  const law = lawFor(g, leg.to, leg.item);
  if (law === 'legal') return;
  const name = iname(g, leg.item);
  if (law === 'restricted') { raiseAttention(g, leg.to, leg.from, ENFORCE.perUnitRestricted * qty, `Sold ${qty} restricted ${name}`); return; }
  const chance = seizeChance(g, leg.to, leg.from);
  raiseAttention(g, leg.to, leg.from, ENFORCE.perUnitBanned * qty, `Smuggled ${qty} ${name} (banned)`);
  if (g.rng.next() < chance && t.status === 'active') {
    t.status = 'seized'; // the goods stay with the village's watch; nothing more is paid
    t.seized = { leg: legIdx, qty, tick: g.s.tick };
    changeRelation(g, leg.to, leg.from, ENFORCE.seizeCost, `${nameOf(g, leg.to)}'s watch seized ${qty} ${name}`);
    g.log(`${nameOf(g, leg.to)}'s watch seized ${qty} ${name} from ${nameOf(g, leg.from)}; the deal is off.`, 'warn');
  }
}

/** Daily: attention fades; AI villages sell controlled goods on to their own people (a fifth a day, so their
 *  markets want more later), and their watch destroys what it seized. Only AI villages: the player's goods
 *  are the player's business. */
function tickEnforcement(g) {
  for (const a of Object.values(g.s.enforcement || {})) if (a.value > 0) a.value = Math.max(0, Math.round((a.value - ENFORCE.decayPerDay) * 10) / 10);
  for (const st of Object.values(g.s.stacks)) {
    const sid = st.settlement || g.s.playerSettlement;
    if (!settlementOf(g, sid)?.ai || !isControlled(g, st.item) || g.availQty(st.id) <= 0) continue;
    const q = Math.min(g.availQty(st.id), Math.max(1, Math.ceil(st.qty * 0.2)));
    const law = lawFor(g, sid, st.item);
    g.takeFromStack(st.id, q);
    g.consume(st.item, q, law === 'banned' ? 'destroyed by the watch' : 'sold to locals');
  }
}

const dayOf = (tick) => `day ${Math.floor(tick / TICKS_PER_DAY) + 1}`;
