// Villages founded during play (Phase 2, slice 2). When a village has been at its population cap for a few
// days, a group of its settlers (whole households first) leaves and founds a daughter village nearby. They
// move: nobody and nothing is created. The parent sends food and materials after them as an ordinary gift
// trade (carried by its colonists at full detail, by caravan at the abstract level), so the item ledger and
// the census stay exact. The daughter inherits its parent's knowledge, laws, personality and relations.
//
// Rules are data (`scenario.founding`); scenarios without it never found villages, so classic worlds are
// unchanged. See docs/proposals/phase-2-kingdoms.md, "Slice 2".
//
// Cost: nothing per tick. Once a day (tickFounding, from tickVillages at the start of the day): one pass over
// the colonists to count people per village, O(S) checks, chooseFounders only for villages that pass the
// cheap checks, and at most ONE site search a day world-wide (<= ~400 candidates in a window round the
// parent, each checked against the claimed tiles of the villages near it). A founding itself costs
// O(founders + relations) plus the local territory update (game.js territoryAdded, O(H x S + new area); with
// organic territory the new village's first claim, O(its area x log), territory.js).
// Phase 2b slice 6 (data: founding.perDay, searchesPerDay, daughterMinDays, outward; the vast world): no
// world-wide one-a-day rule. Each village founds at most once per cooldownDays (a daughter only once it has stood
// daughterMinDays); the world at most perDay villages and searchesPerDay site searches a day, longest-crowded
// first. Outward sites (outwardSite): anywhere on land the parent's explorers discovered, within a radius scaled
// with the map, scored for distance from other villages, unclaimed land, wood, stone, fertile ground and distance
// from home. Cost: per search one pass over the window round the parent (about (2 x 140)^2 tiles and its nodes,
// a few ms at most), at most searchesPerDay a day.
// Distant (abstract) villages found in the same way; founders of an abstract daughter are placed at the
// site like a village going abstract (lod.js setDetail / goHome), and goods travel by caravan.
//
// State (all optional, absent in older saves; save format unchanged):
//   settlement.parent, settlement.culture       the village it came from, and its culture (root village id)
//   settlement.crowdedSince                     tick the daily check first saw it at its cap (cleared below)
//   settlement.lastFounding                     tick it last founded a village
//   settlement.noSiteAt                         tick its last site search found nothing (it waits siteRetryDays)
import { TICKS_PER_DAY, WATER_REACH_WALK } from './constants.js';
import { settlementOf, newResearchState, ensureSettlement } from './research.js';
import { isAdult, BIRTH } from './people.js';
import { endJob } from './ai/ai.js';
import { relationOf, noteMet, villageColor, availableToTrade, spareOf } from './villages.js';
import { wantDetail, setDetail } from './lod.js';
import { emptyPlan } from './planner.js';
import { kingdomForDaughter } from './kingdoms.js';
import { claimsFreeFor, claimRadius } from './territory.js';
import { isDiscovered } from './contact.js';
import { coldWait } from './life.js';
import { livingCount } from './fallen.js';
import { peopleOfSettlement } from './peoples.js';
import { growthOf } from './worldlaws.js';

export const FOUNDING_DEFAULTS = Object.freeze({
  maxVillages: 30, minAdults: 6, crowdedDays: 3, foodDaysLeft: 5, cooldownDays: 20, founders: Object.freeze([3, 5]),
  sendFoodDays: 3, sendItems: Object.freeze({}), searchRadius: 36, minSpacing: 22, siteRetryDays: 5,
});
const STRIDE = 4;

const nameOf = (g, sid) => settlementOf(g, sid)?.name || sid;
const dayOf = (tick) => Math.floor(tick / TICKS_PER_DAY) + 1;
const sidOf = (g, c) => c.settlementId || g.s.playerSettlement;
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The scenario's founding rules merged with the defaults, or null when founding is off. */
export function foundingRules(g) {
  const f = g.reg.get('scenario', g.s.scenarioId)?.founding;
  if (!f) return null;
  return { ...FOUNDING_DEFAULTS, ...f, founders: f.founders || FOUNDING_DEFAULTS.founders, sendItems: f.sendItems || FOUNDING_DEFAULTS.sendItems };
}

/** People and adults per settlement, in one pass over the colonists. */
function headCounts(g) {
  const out = new Map();
  for (const c of Object.values(g.s.colonists)) {
    const sid = sidOf(g, c);
    let e = out.get(sid); if (!e) out.set(sid, (e = { pop: 0, adults: 0 }));
    e.pop++;
    if (isAdult(g, c)) e.adults++;
  }
  return out;
}

/** Is `sid` crowded, and for how long? Read-only. { crowded, days, pop, cap, adults, reason }.
 *  `days` counts whole days since the daily check first saw the village at its cap (st.crowdedSince). */
export function crowdedness(g, sid, counts = null) {
  const st = settlementOf(g, sid);
  const e = (counts || headCounts(g)).get(sid) || { pop: 0, adults: 0 };
  const cap = g.policyFor(sid).maxPopulation ?? BIRTH.defaultCap;
  const crowded = e.pop >= cap;
  const since = st?.crowdedSince;
  const days = crowded && Number.isFinite(since) ? Math.max(0, Math.floor((g.s.tick - since) / TICKS_PER_DAY)) : 0;
  const reason = crowded ? `crowded: ${e.pop} of ${cap} for ${plural(days, 'day')}` : `${e.pop} of ${cap} people`;
  return { crowded, days, pop: e.pop, cap, adults: e.adults, reason };
}

/** How many adults leave: half the adults, within the data's [fewest, most]. */
const founderTarget = (R, adults) => Math.min(R.founders[1], Math.max(R.founders[0], Math.floor(adults / 2)));

/**
 * Who leaves (read-only, deterministic). Returns the ids (sorted) of at most `n` adults and the children who
 * go with them. Families are never split. The fixed rule:
 *  - a family is everyone joined by sharing a home or by being parent and child (at any age), so a child
 *    goes only with every parent of it who lives in the village, and a household is never split;
 *  - families with a home go first, in the order of their first home's id; then families without a home
 *    (unattached adults), in the order of their first adult's id;
 *  - a family is skipped whole if it would take more than the adults still wanted, if anyone in it cannot
 *    travel (collapsed, carried, in a medical bed), or if it would take the village's last adult holding
 *    one of its qualifications (needed roles: the village keeps at least one holder of each);
 *  - if no family fits exactly, fewer adults leave (canFound then says too few could leave).
 */
export function chooseFounders(g, sid, n) {
  const s = g.s;
  const people = Object.values(s.colonists).filter((c) => sidOf(g, c) === sid).sort(byId);
  const adults = people.filter((c) => isAdult(g, c));
  const isA = new Set(adults.map((c) => c.id));
  // Union-find over everyone in the village: people of the same home, and each child (not yet adult) with
  // every parent of it who lives here, whatever the parent's age (an infant is never split from a young parent).
  const here = new Set(people.map((c) => c.id));
  const up = new Map(people.map((c) => [c.id, c.id]));
  const find = (x) => { while (up.get(x) !== x) { up.set(x, up.get(up.get(x))); x = up.get(x); } return x; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) { if (a < b) up.set(b, a); else up.set(a, b); } };
  const homeOf = new Map(); // home id -> first resident
  for (const c of people) {
    const h = c.homeId && s.homes?.[c.homeId];
    if (h) { if (homeOf.has(h.id)) join(homeOf.get(h.id), c.id); else homeOf.set(h.id, c.id); }
    if (!isA.has(c.id)) for (const p of c.parents || []) if (here.has(p)) join(p, c.id); // grown-up children stand alone
  }
  const fam = new Map(); // root -> { adults, kids, home }
  for (const c of people) {
    const r = find(c.id);
    let f = fam.get(r); if (!f) fam.set(r, (f = { adults: [], kids: [], home: null }));
    (isA.has(c.id) ? f.adults : f.kids).push(c);
    const h = c.homeId && s.homes?.[c.homeId];
    if (h && (f.home === null || h.id < f.home)) f.home = h.id;
  }
  for (const [r, f] of fam) if (!f.adults.length) fam.delete(r); // children with no adult here stay
  const fams = [...fam.values()].sort((a, b) => (a.home === null) - (b.home === null)
    || (a.home !== null && a.home !== b.home ? (a.home < b.home ? -1 : 1) : 0) || byId(a.adults[0], b.adults[0]));
  const qualLeft = new Map(); // qualification -> adults still holding it
  for (const c of adults) for (const q of c.quals || []) qualLeft.set(q, (qualLeft.get(q) || 0) + 1);
  const canTravel = (c) => !c.health?.down && !c.carriedBy && !c.medBedId;
  const taken = [];
  let nAdults = 0;
  for (const f of fams) {
    if (nAdults >= n) break;
    if (nAdults + f.adults.length > n || ![...f.adults, ...f.kids].every(canTravel)) continue;
    const lose = new Map();
    for (const a of f.adults) for (const q of a.quals || []) lose.set(q, (lose.get(q) || 0) + 1);
    if ([...lose].some(([q, k]) => (qualLeft.get(q) || 0) - k < 1)) continue;
    for (const [q, k] of lose) qualLeft.set(q, qualLeft.get(q) - k);
    for (const c of [...f.adults, ...f.kids]) taken.push(c.id);
    nAdults += f.adults.length;
  }
  return taken.sort();
}

/** Food (days, for the people who stay) left after `leaving` people go and the gift of food is sent. */
function foodAfter(g, R, sid, pop, leaving) {
  const P = g.plans?.[sid];
  if (!P) return null;
  const stay = pop - leaving;
  if (stay <= 0) return 0;
  return (P.foodDays * pop - R.sendFoodDays * leaving) / stay;
}

/** Can `sid` found a village now (every condition except the site)? Read-only. { ok, problems, reason }
 *  (plus crowd, founders and n, used by tickFounding). */
export function canFound(g, sid, counts = null) {
  const R = foundingRules(g);
  const res = { ok: false, problems: [], reason: '' };
  const st = settlementOf(g, sid);
  if (!R) { res.problems.push('Founding villages is off in this world.'); res.reason = res.problems[0]; return res; }
  if (!st) { res.problems.push('There is no such village.'); res.reason = res.problems[0]; return res; }
  counts ||= headCounts(g);
  const s = g.s, name = nameOf(g, sid), P = res.problems;
  const nVillages = livingCount(g); // ruins do not count (fallen.js)
  if (nVillages >= R.maxVillages) P.push(`The world already has ${nVillages} villages (the most is ${R.maxVillages}).`);
  if (g.policyFor(sid).allowEmigration === false) P.push(sid === s.playerSettlement ? 'Your policy keeps settlers at home.' : `${name}'s policy keeps settlers at home.`);
  const crowd = res.crowd = crowdedness(g, sid, counts);
  if (!crowd.crowded) P.push(`${name} is not crowded (${crowd.pop} of ${crowd.cap} people).`);
  const gf = growthOf(g), crowdedDays = R.crowdedDays / gf, cooldownDays = R.cooldownDays / gf; // the Fast growth law halves the waits
  if (crowd.crowded && crowd.days < crowdedDays) P.push(`${name} has been crowded for ${plural(crowd.days, 'day')} of ${crowdedDays}.`);
  if (crowd.adults < R.minAdults) P.push(`${name} has ${plural(crowd.adults, 'adult')}; settlers leave only with at least ${R.minAdults}.`);
  if (Number.isFinite(st.lastFounding) && s.tick - st.lastFounding < cooldownDays * TICKS_PER_DAY)
    P.push(`${name} founded a village on day ${dayOf(st.lastFounding)}; it waits until day ${dayOf(st.lastFounding + cooldownDays * TICKS_PER_DAY)}.`);
  if (R.daughterMinDays && st.parent && s.tick - (st.founded || 0) < R.daughterMinDays * TICKS_PER_DAY)
    P.push(`${name} was founded on day ${dayOf(st.founded || 0)}; a new village sends settlers out only from day ${dayOf((st.founded || 0) + R.daughterMinDays * TICKS_PER_DAY)}.`);
  if (Number.isFinite(st.noSiteAt) && s.tick - st.noSiteAt < R.siteRetryDays * TICKS_PER_DAY)
    P.push(`No free site was found near ${name} on day ${dayOf(st.noSiteAt)}; it looks again on day ${dayOf(st.noSiteAt + R.siteRetryDays * TICKS_PER_DAY)}.`);
  if (!P.length) { const cw = coldWait(g); if (cw) P.push(`In ${name} ${cw}.`); } // scenarios with cold rules (life.js)
  if (P.length) { res.reason = P[0]; return res; }
  // Only villages that pass the cheap checks pick founders and count food.
  const n = res.n = founderTarget(R, crowd.adults);
  const founders = res.founders = chooseFounders(g, sid, n);
  const fa = founders.filter((id) => isAdult(g, s.colonists[id])).length;
  if (fa < R.founders[0]) P.push(`Only ${plural(fa, 'adult')} could leave ${name} (needs ${R.founders[0]}): families stay together and the last holder of a skill stays.`);
  const left = foodAfter(g, R, sid, crowd.pop, founders.length);
  if (left === null) P.push(`${name} has not planned yet.`);
  else if (left < R.foodDaysLeft) P.push(`Food in ${name} would last ${left.toFixed(1)} days after ${founders.length} settlers leave (needs ${R.foodDaysLeft}).`);
  res.ok = !P.length;
  res.reason = res.ok ? crowd.reason : P[0];
  return res;
}

/**
 * A site for a daughter village of `sid` (read-only, no random numbers): { x, y } (the new centre) or null.
 * Candidates lie on a STRIDE-tile grid in a window of searchRadius round the parent's centre (<= ~400),
 * nearest to the parent first (then y, then x). A candidate needs open buildable land for the village core
 * (the box foundVillage uses) with no node or goods on its stockpile tiles, the parent's walkable area, a
 * lake shore within the scenario's siteWaterWalk, minSpacing from every village centre, and no claimed tile
 * (building, building site, field or stockpile) of any village may change owner under the nearest-centre
 * rule with the new centre added (ties counted as changes). With organic territory (territory.js) the window
 * is at least the parent's claim radius + 8, and no tile of the village core may be another village's land
 * (unclaimed or the parent's own; the parent hands its tiles within the daughter's first claim over).
 */
export function findDaughterSite(g, sid, rules = null) {
  const R = rules || foundingRules(g) || FOUNDING_DEFAULTS;
  const st = settlementOf(g, sid);
  if (!st) return null;
  const O = outwardRules(R);
  if (O && g._cl) return outwardSite(g, sid, R, O);
  const P0 = st.center || g.s.center;
  // Organic territory: the search reaches past the parent's own land (its claim radius + 8).
  const rad = g._cl ? Math.max(R.searchRadius, Math.ceil(claimRadius(g, sid)) + 8) : R.searchRadius, sp2 = R.minSpacing * R.minSpacing;
  const walkMax = g.reg.get('scenario', g.s.scenarioId)?.siteWaterWalk ?? WATER_REACH_WALK;
  const home = g.regionOf(P0.x, P0.y);
  const centres = Object.values(g.s.settlements).map((x) => ({ id: x.id, c: x.center || g.s.center }));
  const cands = [];
  for (let dy = -rad; dy <= rad; dy += STRIDE) for (let dx = -rad; dx <= rad; dx += STRIDE) {
    const x = P0.x + dx, y = P0.y + dy;
    if (x - 4 < 0 || y - 5 < 0 || x + 4 >= g.W || y + 2 >= g.H) continue;
    if (dx * dx + dy * dy > rad * rad) continue;
    cands.push({ x, y, d: dx * dx + dy * dy });
  }
  cands.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  let claims = null; // built on first use: claimed tiles by owner, and how far each owner's claims reach
  let ww = null;
  for (const cd of cands) {
    const { x, y } = cd;
    if (centres.some((o) => (o.c.x - x) ** 2 + (o.c.y - y) ** 2 < sp2)) continue;
    let ok = true;
    for (let yy = y - 5; yy <= y + 2 && ok; yy++) for (let xx = x - 4; xx <= x + 4; xx++) {
      const t = g.terrainAt(xx, yy), i = g.i(xx, yy);
      if (!t.passable || !t.buildable || g.structIdAt(i) || g.footIdAt(i) || g.zoneAt(i)) { ok = false; break; }
    }
    if (!ok) continue;
    for (const [px, py] of pileCells(x, y)) { const i = g.i(px, py); if (g.nodeIdAt(i) || g.stackIdAt(i)) { ok = false; break; } }
    if (!ok || g.regionOf(x, y) !== home || home < 0) continue;
    ww ||= g.waterWalk();
    if (!(ww.dist[g.i(x, y)] <= walkMax)) continue;
    if (g._cl) { if (!claimsFreeFor(g, sid, x - 4, y - 5, x + 4, y + 2)) continue; return { x, y }; }
    claims ||= claimedTiles(g);
    if (takesClaimedLand(claims, x, y)) continue;
    return { x, y };
  }
  return null;
}

/**
 * Why a village could not be founded with its centre at (x, y), or null when it can (read-only, no random
 * numbers). The daughter-site rules for one tile (god powers, godspawn.js): the village core (x-4..x+4,
 * y-5..y+2) inside the map, open, passable, buildable, with no building, building site or zone; nothing on the
 * stockpile tiles; walkable land (a region); a lake shore within the scenario's siteWaterWalk; minSpacing from
 * every village centre; and no claimed land of another village (organic: no tile of the core claimed by anyone
 * but `parent`; otherwise no built-on, farmed or stockpile tile would change owner). Cost: O(villages + core)
 * plus, without organic territory, one pass over the claimed tiles (claimedTiles).
 */
export function siteProblem(g, x, y, R = null, parent = null) {
  R ||= foundingRules(g) || FOUNDING_DEFAULTS;
  if (!Number.isInteger(x) || !Number.isInteger(y) || !g.inB(x, y)) return 'that spot is outside the map';
  const t0 = g.terrainAt(x, y);
  if (!t0.passable) return `${t0.name ? `${t0.name.toLowerCase()} is` : 'that ground is'} not land to settle on`;
  if (x - 4 < 0 || y - 5 < 0 || x + 4 >= g.W || y + 2 >= g.H) return 'it is too close to the edge of the map';
  let near = null, nd2 = Infinity;
  for (const st of Object.values(g.s.settlements)) {
    const c = st.center || g.s.center, d2 = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d2 < nd2 || (d2 === nd2 && st.id < near.id)) { nd2 = d2; near = st; }
  }
  if (near && nd2 < R.minSpacing * R.minSpacing) return `it is too close to ${near.name} (${Math.floor(Math.sqrt(nd2))} tiles; villages stay at least ${R.minSpacing} apart)`;
  for (let yy = y - 5; yy <= y + 2; yy++) for (let xx = x - 4; xx <= x + 4; xx++) {
    const t = g.terrainAt(xx, yy), i = g.i(xx, yy);
    if (!t.passable || !t.buildable) return 'there is not enough open, buildable land for the village (9 x 8 tiles)';
    if (g.structIdAt(i) || g.footIdAt(i) || g.zoneAt(i)) return 'a building, building site or zone is in the way';
  }
  for (const [px, py] of pileCells(x, y)) { const i = g.i(px, py); if (g.nodeIdAt(i) || g.stackIdAt(i)) return 'trees, rocks or goods stand where the stockpile would go'; }
  if (g.regionOf(x, y) < 0) return 'it is not on walkable land';
  const walkMax = g.reg.get('scenario', g.s.scenarioId)?.siteWaterWalk ?? WATER_REACH_WALK;
  if (!(g.waterWalk().dist[g.i(x, y)] <= walkMax)) return `there is no lake shore within ${walkMax} tiles' walk`;
  if (g._cl) {
    if (!claimsFreeFor(g, parent, x - 4, y - 5, x + 4, y + 2)) {
      const T = g.territoryGrid();
      let who = null;
      for (let yy = y - 5; yy <= y + 2 && !who; yy++) for (let xx = x - 4; xx <= x + 4; xx++) { const k = T.grid[g.i(xx, yy)]; if (k !== 0xffff && T.ids[k] !== parent) { who = T.ids[k]; break; } }
      return `the land is claimed by ${nameOf(g, who)}`;
    }
    return null;
  }
  if (takesClaimedLand(claimedTiles(g), x, y)) return "it would take land a village has built on, farmed or stocked";
  return null;
}

/** The stockpile of a village centred at (x, y): 6 x 3 tiles round the centre (as foundVillage lays it out). */
export function pileCells(x, y) {
  const out = [];
  for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 3; xx < x + 3; xx++) out.push([xx, yy]);
  return out;
}

/** Every claimed tile (buildings, building sites, fields, stockpiles) grouped by its territory owner, with
 *  its squared distance to that owner's centre, and each owner's reach (the farthest claim). One pass over
 *  the structures, projects, fields and stockpiles, once per site search. */
function claimedTiles(g) {
  const s = g.s, by = new Map(), T = g.territoryGrid();
  // Tiles already counted: a reused buffer of marks (derived, never saved), a new mark value per search.
  if (!g._claimSeen || g._claimSeen.length !== g.W * g.H || g._claimGen >= 0xfffffffe) { g._claimSeen = new Uint32Array(g.W * g.H); g._claimGen = 0; }
  const seen = g._claimSeen, gen = ++g._claimGen;
  const add = (x, y) => {
    if (!g.inB(x, y)) return;
    const i = y * g.W + x;
    if (seen[i] === gen) return;
    seen[i] = gen;
    const k = T.grid[i];
    const o = k === 0xffff ? null : T.ids[k];
    if (!o) return;
    const c = s.settlements[o]?.center || s.center;
    let e = by.get(o); if (!e) by.set(o, (e = { c, pts: [], reach2: 0 }));
    const d2 = (x - c.x) ** 2 + (y - c.y) ** 2;
    e.pts.push(x, y, d2);
    if (d2 > e.reach2) e.reach2 = d2;
  };
  for (const st of Object.values(s.structures)) add(st.x, st.y);
  for (const p of Object.values(s.projects)) if (p.status !== 'cancelled') for (const [x, y] of p.cells || []) add(x, y);
  for (const f of Object.values(s.fields)) for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) add(x, y);
  for (const st of Object.values(s.settlements)) for (const k of st.stockpile || []) { const [x, y] = k.split(',').map(Number); add(x, y); }
  return [...by.values()];
}

/** Would a centre at (x, y) take any claimed tile from its owner? A tile p of owner o can only change hands
 *  if d(p, new) <= d(p, o) <= reach(o), so owners whose centre is farther than 2 x reach are skipped. */
function takesClaimedLand(claims, x, y) {
  for (const e of claims) {
    const dc2 = (e.c.x - x) ** 2 + (e.c.y - y) ** 2;
    if (dc2 > 4 * e.reach2) continue;
    const pts = e.pts;
    for (let k = 0; k < pts.length; k += 3) if ((pts[k] - x) ** 2 + (pts[k + 1] - y) ** 2 <= pts[k + 2]) return true;
  }
  return false;
}

// ---------------- outward founding (Phase 2b slice 6: scenario data founding.outward) ----------------
export const OUTWARD_DEFAULTS = Object.freeze({
  searchFactor: 0.06, maxSearch: 160, stride: 8, cell: 8, box: 2, discovered: true, farCap: 60,
  woodItem: 'core:wood', stoneItem: 'core:stone',
  weights: Object.freeze({ far: 1, free: 0.6, wood: 0.25, stone: 0.25, fertile: 0.3, out: 0.3 }),
  caps: Object.freeze({ wood: 30, stone: 8 }),
});
/** The scenario's outward-founding rules over the defaults, or null (nearest-first search). */
export function outwardRules(R) {
  const o = R?.outward;
  if (!o) return null;
  return { ...OUTWARD_DEFAULTS, ...o, weights: { ...OUTWARD_DEFAULTS.weights, ...(o.weights || {}) }, caps: { ...OUTWARD_DEFAULTS.caps, ...(o.caps || {}) } };
}
/** The outward search radius for a village: the largest of searchRadius, its claim radius + 8 and the map-scaled
 *  radius (searchFactor x sqrt(W x H), at most maxSearch). */
export function outwardRadius(g, sid, R, O) {
  const scaled = Math.min(O.maxSearch, Math.round(O.searchFactor * Math.sqrt(g.W * g.H)));
  return Math.max(R.searchRadius, Math.ceil(claimRadius(g, sid)) + 8, scaled);
}

/**
 * Outward site search (organic territory with founding.outward; read-only, no random numbers). Daughters may
 * settle anywhere on land their parent has discovered (contact.js explorers; the parent's own walkable area)
 * within the outward radius. Every candidate on a `stride` grid round the parent is scored, then the
 * candidates are checked best first with the usual rules (open buildable core, clear stockpile, a lake shore
 * within siteWaterWalk, minSpacing from every centre, unclaimed land or the parent's own):
 *   score = far x min(distance to the nearest village centre, farCap) / farCap
 *         + free x the share of unclaimed tiles round it            (cells of `cell` tiles, `box` cells each way)
 *         + wood, stone x nearby trees and rocks (up to caps) + fertile x the share of fertile ground
 *         + out x its distance from the parent / the radius         (outward, away from home)
 * Ties: y, then x. Cost: one pass over the tiles and nodes of the window (about (2 x radius)^2 tiles), then
 * O(candidates x box) to score, and the usual checks only until the first site passes.
 */
function outwardSite(g, sid, R, O) {
  const st = settlementOf(g, sid), P0 = st.center || g.s.center;
  const rad = outwardRadius(g, sid, R, O), sp2 = R.minSpacing * R.minSpacing;
  const walkMax = g.reg.get('scenario', g.s.scenarioId)?.siteWaterWalk ?? WATER_REACH_WALK;
  const home = g.regionOf(P0.x, P0.y);
  if (home < 0) return null;
  // Only land the parent's explorers discovered; a parent with no contact record yet (its first hour has not come)
  // knows no land, so it finds no site this time.
  if (O.discovered && !g.s.contact?.v?.[sid]) return null;
  const known = O.discovered ? (x, y) => isDiscovered(g, sid, g.chunkOf(x, y)) : null;
  const centres = Object.values(g.s.settlements).map((x) => x.center || g.s.center);
  // Cells of the window (the search square plus `box` cells): unclaimed and fertile tiles, trees and rocks.
  const CS = O.cell, B = O.box, pad = (B + 1) * CS;
  const wx0 = Math.max(0, P0.x - rad - pad), wy0 = Math.max(0, P0.y - rad - pad);
  const wx1 = Math.min(g.W - 1, P0.x + rad + pad), wy1 = Math.min(g.H - 1, P0.y + rad + pad);
  const NX = Math.floor((wx1 - wx0) / CS) + 1, NY = Math.floor((wy1 - wy0) / CS) + 1;
  const free = new Int32Array(NX * NY), fert = new Int32Array(NX * NY), area = new Int32Array(NX * NY);
  const wood = new Int32Array(NX * NY), rock = new Int32Array(NX * NY);
  const grid = g._cl.grid, W = g.W, pal = g.terrainPalette, ts = g._ts.idx;
  const fertK = new Uint8Array(pal.length), passK = new Uint8Array(pal.length);
  for (let k = 0; k < pal.length; k++) { const t = g.reg.get('terrain', pal[k]); passK[k] = t?.passable ? 1 : 0; fertK[k] = (t?.fertility ?? 0) >= 1 ? 1 : 0; }
  for (let y = wy0; y <= wy1; y++) {
    const row = ((y - wy0) / CS | 0) * NX;
    for (let x = wx0; x <= wx1; x++) {
      const i = y * W + x, k = ts[i];
      if (!passK[k]) continue;
      const c = row + ((x - wx0) / CS | 0);
      area[c]++;
      if (grid[i] === 0xffff) free[c]++;
      if (fertK[k]) fert[c]++;
    }
  }
  const kind = new Map();
  for (const n of g.nodesNear(P0.x, P0.y, rad + pad)) { // counts only: the order does not matter
    if (n.x < wx0 || n.x > wx1 || n.y < wy0 || n.y > wy1) continue;
    let v = kind.get(n.def);
    if (v === undefined) { const ys = g.reg.get('node', n.def)?.yields || []; v = ys.some((y) => y.item === O.woodItem) ? 1 : ys.some((y) => y.item === O.stoneItem) ? 2 : 0; kind.set(n.def, v); }
    if (v) (v === 1 ? wood : rock)[((n.y - wy0) / CS | 0) * NX + ((n.x - wx0) / CS | 0)]++;
  }
  const Wt = O.weights, ww = g.waterWalk(), cands = [];
  for (let dy = -rad; dy <= rad; dy += O.stride) for (let dx = -rad; dx <= rad; dx += O.stride) {
    const x = P0.x + dx, y = P0.y + dy;
    if (x - 4 < 0 || y - 5 < 0 || x + 4 >= g.W || y + 2 >= g.H) continue;
    const dp2 = dx * dx + dy * dy;
    if (dp2 > rad * rad) continue;
    let dmin2 = Infinity;
    for (const c of centres) { const d2 = (c.x - x) ** 2 + (c.y - y) ** 2; if (d2 < dmin2) dmin2 = d2; }
    if (dmin2 < sp2) continue;
    if (known && !known(x, y)) continue;
    if (!(ww.dist[g.i(x, y)] <= walkMax)) continue;
    const cx = (x - wx0) / CS | 0, cy = (y - wy0) / CS | 0;
    let a = 0, fr = 0, fe = 0, wd = 0, rk = 0;
    for (let yy = Math.max(0, cy - B); yy <= Math.min(NY - 1, cy + B); yy++) for (let xx = Math.max(0, cx - B); xx <= Math.min(NX - 1, cx + B); xx++) {
      const c = yy * NX + xx; a += area[c]; fr += free[c]; fe += fert[c]; wd += wood[c]; rk += rock[c];
    }
    const score = Wt.far * Math.min(Math.sqrt(dmin2), O.farCap) / O.farCap
      + Wt.free * (a ? fr / a : 0) + Wt.fertile * (a ? fe / a : 0)
      + Wt.wood * Math.min(wd, O.caps.wood) / O.caps.wood + Wt.stone * Math.min(rk, O.caps.stone) / O.caps.stone
      + Wt.out * Math.sqrt(dp2) / rad;
    cands.push({ x, y, score });
  }
  cands.sort((p, q) => q.score - p.score || p.y - q.y || p.x - q.x);
  for (const { x, y } of cands) {
    let ok = true;
    for (let yy = y - 5; yy <= y + 2 && ok; yy++) for (let xx = x - 4; xx <= x + 4; xx++) {
      const t = g.terrainAt(xx, yy), i = g.i(xx, yy);
      if (!t.passable || !t.buildable || g.structIdAt(i) || g.footIdAt(i) || g.zoneAt(i)) { ok = false; break; }
    }
    if (!ok) continue;
    for (const [px, py] of pileCells(x, y)) { const i = g.i(px, py); if (g.nodeIdAt(i) || g.stackIdAt(i)) { ok = false; break; } }
    if (!ok || g.regionOf(x, y) !== home) continue;
    if (!claimsFreeFor(g, sid, x - 4, y - 5, x + 4, y + 2)) continue;
    return { x, y };
  }
  return null;
}

/** A name for the daughter: the next name in the parent profile's list not used by any village, otherwise
 *  "New <parent>" (numbered if needed). No random numbers. */
function daughterName(g, parent) {
  const used = new Set(Object.values(g.s.settlements).map((x) => x.name));
  const prof = parent.profile && g.reg.get('villageProfile', parent.profile);
  const free = (prof?.settlementNames || []).find((n) => !used.has(n));
  if (free) return free;
  const base = `New ${parent.name}`.slice(0, 70);
  let name = base;
  for (let k = 2; used.has(name); k++) name = `${base} ${k}`;
  return name;
}

const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

/**
 * Found a daughter village of `sid` now. Checks canFound first (opts.force skips the trigger conditions:
 * crowding, adults, cooldown, food, village count; for tests and tools). opts.site: a site already found;
 * opts.checked: a canFound result from this tick (tickFounding).
 * Returns { ok, child, founders, msg }.
 */
export function foundDaughter(g, sid, opts = {}) {
  const s = g.s;
  const parent = settlementOf(g, sid);
  if (!parent) return { ok: false, child: null, founders: [], msg: 'There is no such village.' };
  const R = foundingRules(g) || FOUNDING_DEFAULTS;
  let ev = opts.checked || null, founders = ev?.founders;
  if (ev) { /* tickFounding has just run canFound */ } else if (!opts.force) {
    ev = canFound(g, sid);
    if (!ev.ok) return { ok: false, child: null, founders: [], msg: ev.reason };
    founders = ev.founders;
  } else {
    const counts = headCounts(g);
    founders = chooseFounders(g, sid, founderTarget(R, counts.get(sid)?.adults || 0));
    if (!founders.some((id) => isAdult(g, s.colonists[id]))) return { ok: false, child: null, founders: [], msg: `Nobody in ${parent.name} can leave.` };
  }
  const site = opts.site || findDaughterSite(g, sid, R);
  if (!site) {
    parent.noSiteAt = s.tick;
    g.log(`Settlers in ${parent.name} wanted to found a new village, but no free site was found nearby.`, 'info', `nosite:${sid}`, TICKS_PER_DAY);
    return { ok: false, child: null, founders: [], msg: `No free site was found near ${parent.name}.` };
  }
  const why = ev ? ev.crowd.reason : crowdedness(g, sid).reason;
  g.territoryGrid(); // bring the territory cache up to date, so the new village is added to it locally

  // ---- the settlement record
  let child = g.newId('t');
  while (s.settlements[child]) child = g.newId('t');
  const name = daughterName(g, parent);
  const nVillages = Object.keys(s.settlements).length;
  const color = villageColor(g, parent.color || '#a0c0e0', nVillages);
  const research = newResearchState(g.reg);
  const pr = parent.research || {};
  research.done = [...(pr.done || [])];
  research.era = pr.era ?? research.era;
  research.completed = clone(pr.completed || []);
  research.priorities = { ...research.priorities, ...(pr.priorities || {}) };
  const pile = pileCells(site.x, site.y).map(([x, y]) => `${x},${y}`);
  const rec = {
    id: child, name, ...(parent.profile ? { profile: parent.profile } : {}), ai: true, color,
    founded: s.tick, parent: sid, culture: parent.culture ?? sid,
    center: { x: site.x, y: site.y }, stockpile: pile, research,
    policy: clone(parent.policy || {}), trade: clone(parent.trade || {}), laws: { ...(parent.laws || {}) },
    ...(parent.enforcement !== undefined ? { enforcement: parent.enforcement } : {}),
  };
  if (peopleOfSettlement(g, sid)) rec.people = peopleOfSettlement(g, sid); // the founders' people (villages keep to one)
  if (parent.code) rec.code = { ...parent.code }; // civilization laws: the daughter keeps its parent's code (civlaws.js)
  s.settlements[child] = rec;
  ensureSettlement(g.reg, s, rec);
  for (const k of pile) { const [x, y] = k.split(',').map(Number); g.setZone(g.i(x, y), 'S:' + child); }
  g.territoryAdded(child);

  // ---- relations: the parent's, inherited; parent and daughter friendly
  const pName = parent.name;
  for (const k of Object.keys(s.relations || {}).sort()) {
    const rel = s.relations[k];
    if (rel.a !== sid && rel.b !== sid) continue;
    const other = rel.a === sid ? rel.b : rel.a;
    if (other === child || !s.settlements[other]) continue;
    const r = relationOf(g, child, other);
    r.contact = !!rel.contact;
    noteMet(g, r, `Inherited from ${pName}`); // contact games only: how the daughter knows them
    r.value = rel.value;
    r.history.push({ tick: s.tick, delta: 0, reason: `Inherited from ${pName}` });
  }
  const pc = relationOf(g, sid, child);
  pc.contact = true;
  noteMet(g, pc, `Founded by ${pName}`);
  pc.value = 60;
  pc.history.push({ tick: s.tick, delta: 60, reason: `Founded by ${pName}` });

  // ---- the founders move
  const moving = new Set(founders);
  for (const c of Object.values(s.colonists).sort(byId)) { // others' jobs about a founder (care, treatment) end
    if (moving.has(c.id) || !c.job) continue;
    if (c.job.patientId && moving.has(c.job.patientId)) endJob(g, c, null, 'They left to found a new village'); // care and treatment
  }
  for (const id of founders) { const c = s.colonists[id]; if (c.job) endJob(g, c, null, `Leaving ${pName} to found ${name}`); } // carried goods are dropped as the parent's
  for (const id of founders) {
    const c = s.colonists[id];
    const bed = c.bedId && s.structures[c.bedId];
    if (bed && bed.owner === c.id) delete bed.owner;
    const home = c.homeId && s.homes[c.homeId];
    if (home) home.owners = (home.owners || []).filter((x) => x !== c.id);
    c.bedId = null; c.homeId = null; c.medBedId = null;
    if (parent.training?.cid === c.id) parent.training = null;
    c.settlementId = child; // equipment and ammunition go with them (ownership follows the colonist)
    c.color = color;
    c.sleeping = false; c.idle = 0;
    c.status = { goal: `Moving to ${name}`, action: `Left ${pName} to found ${name}`, target: '', blocker: '' };
  }

  g.ownReset('colonists'); // they belong to the new village now (ownership index, game.js)

  // ---- supplies: a gift trade from the parent (only what it can spare)
  sendSupplies(g, R, sid, child, founders.length);

  // ---- bookkeeping, plans, level of detail
  parent.lastFounding = s.tick;
  delete parent.noSiteAt;
  g.planDirty = true;
  (g.plans ||= {})[child] = emptyPlan(); // a plan of its own (empty) until it plans next tick, never the player's
  (g.replanSids ||= new Set()).add(sid).add(child);
  g.log(`${founders.length} settlers left ${pName} (${why}) and founded ${name}.`, 'good');
  // Kingdoms (slice 3): the daughter joins its parent's kingdom, or the parent becomes the capital of a new one.
  kingdomForDaughter(g, sid, child);
  if (g.big && wantDetail(g, child) === 'abstract') setDetail(g, child, 'abstract', 'it is far from the player');
  return { ok: true, child, founders, msg: `${founders.length} settlers founded ${name}.` };
}

/** Food for sendFoodDays (for the people who left) and the data's materials, as one gift trade (a leg per
 *  item) from parent to child; capped by what the parent has free to trade (and its plan's surplus for
 *  materials). Food goes richest first, then by id, never into the seed reserve. */
function sendSupplies(g, R, sid, child, leaving) {
  const s = g.s, reg = g.reg;
  const hunger = reg.all('need').find((x) => x.behavior === 'core:eat');
  let nutr = R.sendFoodDays * leaving * (hunger?.decayPerDay ?? 1);
  const seed = g.plans?.[sid]?.seedReserve || {};
  const legs = [];
  const foods = [...reg.itemsWithTag('core:food')].map((id) => reg.get('item', id)).filter((d) => d?.nutrition > 0)
    .sort((a, b) => b.nutrition - a.nutrition || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const d of foods) {
    if (nutr <= 1e-9) break;
    const have = Math.max(0, availableToTrade(g, sid, d.id) - (seed[d.id] || 0));
    const q = Math.min(have, Math.ceil(nutr / d.nutrition));
    if (q <= 0) continue;
    legs.push({ from: sid, to: child, item: d.id, qty: q, delivered: 0 });
    nutr -= q * d.nutrition;
  }
  for (const item of Object.keys(R.sendItems || {}).sort()) {
    if (!reg.get('item', item) || legs.some((l) => l.item === item)) continue;
    const q = Math.min(R.sendItems[item], spareOf(g, sid, item), availableToTrade(g, sid, item));
    if (q > 0) legs.push({ from: sid, to: child, item, qty: q, delivered: 0 });
  }
  if (!legs.length) return null;
  const id = g.newId('tr');
  s.trades ||= {};
  g.tradeAdded();
  s.trades[id] = {
    id, seller: sid, buyer: child, legs, gift: true, founding: true, relOnDone: 5, status: 'active', created: s.tick,
    // Contact games: a far daughter's supplies go by caravan, so the deadline allows for the journey (contact.js).
    deadline: g.tradeDeadline ? g.tradeDeadline(sid, child, s.tick + 6 * TICKS_PER_DAY) : s.tick + 6 * TICKS_PER_DAY, reason: `Supplies for the new village ${nameOf(g, child)}`,
  };
  const list = legs.map((l) => `${l.qty} ${reg.get('item', l.item)?.name || l.item}`).join(', ');
  g.log(`${nameOf(g, sid)} is sending ${list} to ${nameOf(g, child)}.`, 'trade');
  return id;
}

/**
 * Daily (start of the day, from tickVillages after diplomacy; no random numbers): note which villages are at
 * their cap (st.crowdedSince), then let the first village in id order that may found do so. At most one
 * site search and one founding a day, world-wide.
 */
export function tickFounding(g) {
  const R = foundingRules(g);
  if (!R) return;
  const s = g.s;
  const counts = headCounts(g);
  const ids = Object.keys(s.settlements || {}).sort();
  for (const sid of ids) {
    const st = s.settlements[sid];
    const e = counts.get(sid);
    const cap = g.policyFor(sid).maxPopulation ?? BIRTH.defaultCap;
    if (e && e.pop >= cap) { if (!Number.isFinite(st.crowdedSince)) st.crowdedSince = s.tick; }
    else if (st.crowdedSince !== undefined) delete st.crowdedSince;
  }
  if (ids.length >= R.maxVillages) return;
  if (R.perDay !== undefined) { budgetedFounding(g, R, counts, ids); return; }
  for (const sid of ids) {
    let ev = canFound(g, sid, counts);
    // After a save or a load an abstract village may not have planned yet: plan it now if that is all that is missing.
    if (!ev.ok && !g.plans?.[sid] && g.replanLater?.has(sid) && ev.problems.length === 1 && ev.n !== undefined) { g.ensurePlan(sid); ev = canFound(g, sid, counts); }
    if (!ev.ok) continue;
    const site = findDaughterSite(g, sid, R);
    if (!site) {
      s.settlements[sid].noSiteAt = s.tick;
      g.log(`Settlers in ${nameOf(g, sid)} want to found a new village (${ev.crowd.reason}), but no free site was found nearby.`, 'info', `nosite:${sid}`, TICKS_PER_DAY);
      return;
    }
    foundDaughter(g, sid, { site, checked: ev });
    return;
  }
}

/** Founding with a world-wide daily budget (scenario data founding.perDay and searchesPerDay; the vast world):
 *  each village founds at most once per cooldownDays (canFound), and the world at most perDay villages and
 *  searchesPerDay site searches a day (a performance guard). Villages that have waited longest at their cap go
 *  first (crowdedSince, then id). No random numbers. */
function budgetedFounding(g, R, counts, ids) {
  const s = g.s, perDay = R.perDay, searches = R.searchesPerDay ?? perDay;
  const order = ids.filter((sid) => Number.isFinite(s.settlements[sid].crowdedSince))
    .sort((a, b) => s.settlements[a].crowdedSince - s.settlements[b].crowdedSince || (a < b ? -1 : a > b ? 1 : 0));
  let made = 0, looked = 0;
  for (const sid of order) {
    if (made >= perDay || looked >= searches || livingCount(g) >= R.maxVillages) return;
    let ev = canFound(g, sid, counts);
    if (!ev.ok && !g.plans?.[sid] && g.replanLater?.has(sid) && ev.problems.length === 1 && ev.n !== undefined) { g.ensurePlan(sid); ev = canFound(g, sid, counts); }
    if (!ev.ok) continue;
    looked++;
    const site = findDaughterSite(g, sid, R);
    if (!site) {
      s.settlements[sid].noSiteAt = s.tick;
      g.log(`Settlers in ${nameOf(g, sid)} want to found a new village (${ev.crowd.reason}), but no free site was found on the land they know.`, 'info', `nosite:${sid}`, TICKS_PER_DAY);
      continue;
    }
    if (foundDaughter(g, sid, { site, checked: ev }).ok) made++;
  }
}

