// God power "spawn": divine settlers (Phase 2c slice 2, docs/proposals/phase-2c-god-powers.md). A group of
// 1..spawn.maxCount settlers arrives at a clicked tile with supplies. Mode 'found': they found a new village there
// (the daughter-site rules at that tile, founding.js siteProblem; under the founding cap); mode 'join': they join the
// village whose territory holds the tile (up to its beds + spawn.joinOverHousing people; without organic territory
// the tile must also lie within the village's claim radius, else 30 tiles, octile, of its centre).
//
// Everything they bring is created through the ledgers: items by divineItems (createItems, reason 'divine'), people
// by addDivinePeople (s.god.spawned). No g.rng draw: names, looks, skills, the profile and the name order come from
// hashes of the seed and the command id (preview uses the id the command would get, s.god.nextId, so the preview
// shows what will be made). Registered once when this module loads (game.js imports it).
//
// A divine village: settlement.origin = 'divine', no parent, no culture, no kingdom, no relations or contacts
// (contact rules then apply as usual), research and policy from its profile like a world-start village, a
// stockpile zone, territory (organic: its first claim), an empty plan until it plans, and the usual LOD rule
// (big worlds: far from the player it runs abstract at once). Colonists: colonist.origin = 'divine'.
//
// Cost: once per command (preview, issue and apply each): O(villages + site core) + one waterWalk lookup, and on
// worlds without organic territory one pass over the claimed tiles (founding.js claimedTiles); placing people is a
// spiral of at most 41x41 tiles plus one pass over the colonists. Nothing per tick.
import { registerPower, divineItems, addDivinePeople } from './god.js';
import { foundingRules, FOUNDING_DEFAULTS, siteProblem, pileCells } from './founding.js';
import { newResearchState, ensureSettlement, settlementOf } from './research.js';
import { villageColor } from './villages.js';
import { makeLook } from './appearance.js';
import { namePoolOf, uniqueName, firstByKey, usedNames } from './names.js';
import { ensureAdult, isAdult } from './people.js';
import { homeBeds } from './construction.js';
import { emptyPlan } from './planner.js';
import { LOD, wantDetail, setDetail, isAbstract } from './lod.js';
import { rings, octile } from './util.js';
import { claimRadius } from './territory.js';
import { livingCount } from './fallen.js';
import { defaultPeople, peopleOfSettlement, settleFolk, paletteOf } from './peoples.js';

const hash = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const peopleN = (n) => (n === 1 ? '1 person' : `${n} people`);
const JOIN_RADIUS = 30; // join without organic territory or claim rules: at most this far (octile) from the centre
const PLACE_RADIUS = 20; // tiles round the arrival spot searched for a free standing place
/** Optional arguments may also be sent as null or '' (the UI's "random"). */
const has = (v) => v !== undefined && v !== null && v !== '';
const NAME_OK = /^[\p{L}\p{N}][\p{L}\p{N} '\-.]*$/u;

/** The id the next command will get (preview) or the command's own id (apply): the key of every hash. */
const keyOf = (g, cmd) => `${g.s.seed}:god:${cmd ? cmd.id : (g.s.god?.nextId ?? 1)}`;

/** Every villageProfile, by id (the hash pick and the refusal list do not depend on load order). */
const profiles = (g) => g.reg.all('villageProfile').slice().sort(byId);

function profileFor(g, a, key) {
  if (has(a.profile)) return g.reg.get('villageProfile', a.profile);
  const list = profiles(g);
  return list.length ? list[hash('profile:' + key) % list.length] : null;
}

/** The new village's name: the one given, or the profile's next settlement name not in use (starting at a hashed
 *  place in its list), else "New <first name>" numbered. */
function villageName(g, a, prof, key) {
  if (has(a.name)) return a.name.trim();
  const used = new Set(Object.values(g.s.settlements).map((x) => x.name));
  const list = prof?.settlementNames || [];
  const start = list.length ? hash('name:' + key) % list.length : 0;
  for (let k = 0; k < list.length; k++) { const n = list[(start + k) % list.length]; if (!used.has(n)) return n; }
  const base = `New ${list[0] || 'Haven'}`.slice(0, 36);
  let name = base;
  for (let k = 2; used.has(name); k++) name = `${base} ${k}`;
  return name;
}

/** The village whose territory holds (x, y), or null. */
function ownerAt(g, x, y) {
  const T = g.territoryGrid(), k = T.grid[g.i(x, y)];
  return k === 0xffff ? null : T.ids[k] || null;
}

/** Beds (built, not medical) in the homes of `sid`, and its people. */
function housing(g, sid) {
  let beds = 0;
  for (const h of g.owned('homes', sid)) for (const b of homeBeds(g, h)) if (b.built && !g.bDef(b)?.medical) beds++;
  return { beds, people: g.owned('colonists', sid).length };
}

/** Supplies as [{ item, name, qty }] (items not loaded are skipped), `per` x n each. */
function supplies(g, per, n) {
  return (per || []).filter((e) => g.reg.get('item', e.item)).map((e) => ({ item: e.item, name: g.reg.get('item', e.item).name, qty: e.qty * n }));
}
const listText = (sup) => sup.map((e) => `${e.qty} ${e.name}`).join(', ');

/** Would a village centred at (x, y) run at a distance (big worlds, far from the player)? Read-only. */
function wouldBeAbstract(g, x, y) {
  if (!g.big) return false;
  const p = settlementOf(g, g.s.playerSettlement)?.center || g.s.center;
  return Math.hypot(x - p.x, y - p.y) > LOD.nearRadius;
}

function validate(g, a, r) {
  const k = Object.keys(a).find((x) => !['x', 'y', 'count', 'mode', 'profile', 'name'].includes(x));
  if (k) return `settlers take only x, y, count, mode, profile and name (not "${String(k).slice(0, 40)}")`;
  if (!Number.isInteger(a.x) || !Number.isInteger(a.y)) return 'pick a tile (whole x and y)';
  if (!g.inB(a.x, a.y)) return 'that spot is outside the map';
  const max = r.spawn.maxCount;
  if (!Number.isInteger(a.count) || a.count < 1 || a.count > max) return `the number of settlers must be from 1 to ${max}`;
  if (a.mode !== 'found' && a.mode !== 'join') return 'the settlers either found a village or join one (mode "found" or "join")';
  if (a.mode === 'join') {
    if (has(a.profile) || has(a.name)) return 'settlers who join a village take no profile or name';
    return joinProblem(g, a, r).reason;
  }
  if (has(a.profile) && (typeof a.profile !== 'string' || !g.reg.get('villageProfile', a.profile))) return `there is no village profile "${String(a.profile).slice(0, 40)}"`;
  if (!has(a.profile) && !profiles(g).length) return 'no village profiles are loaded';
  if (has(a.name)) {
    if (typeof a.name !== 'string') return 'the village name must be text';
    const n = a.name.trim();
    if (n.length < 3 || n.length > 40) return 'the village name must be 3 to 40 characters';
    if (!NAME_OK.test(n)) return 'the village name may hold only letters, digits, spaces and \' - .';
    const low = n.toLowerCase();
    if (Object.values(g.s.settlements).some((st) => String(st.name).toLowerCase() === low)) return `a village called ${n} already exists`;
  }
  const R = foundingRules(g) || FOUNDING_DEFAULTS;
  const nV = livingCount(g); // ruins do not count (fallen.js)
  if (nV >= R.maxVillages) return `the world already has ${nV} villages (the most is ${R.maxVillages})`;
  return siteProblem(g, a.x, a.y, R, null);
}

/** Join: the target village and why it cannot take the settlers ({ sid, reason, h }). */
function joinProblem(g, a, r) {
  const sid = ownerAt(g, a.x, a.y);
  if (!sid || !g.s.settlements[sid]) return { sid: null, reason: 'that spot is in no village\'s territory' };
  if (g.s.settlements[sid].fallen) return { sid, reason: `${g.s.settlements[sid].name} has fallen; only ruins are left` }; // fallen.js
  const st = g.s.settlements[sid], c = st.center || g.s.center;
  if (!g.isPassable(a.x, a.y)) return { sid, reason: 'the settlers cannot stand there' };
  const home = g.regionOf(c.x, c.y);
  if (home < 0 || g.regionOf(a.x, a.y) !== home) return { sid, reason: `that spot is cut off from ${st.name} on foot` };
  const h = housing(g, sid);
  // Without organic territory every tile belongs to its nearest village: joining also needs the tile within the
  // village's claim radius (the scenario's claim rules if it has any, else JOIN_RADIUS), octile from its centre.
  if (!g._cl) {
    const lim = g.reg.get('scenario', g.s.scenarioId)?.claims ? claimRadius(g, sid, h.people) : JOIN_RADIUS;
    const d = octile(a.x, a.y, c.x, c.y);
    if (d > lim) return { sid, h, reason: `too far from ${st.name} to join (${Math.round(d)} tiles)` };
  }
  const room = h.beds + r.spawn.joinOverHousing - h.people;
  if (a.count > room) return { sid, h, reason: `no room: ${plural(h.beds, 'bed')}, ${peopleN(h.people)} (+${r.spawn.joinOverHousing} allowed over housing)` };
  return { sid, h, reason: null };
}

function preview(g, a, r) {
  const cost = { per: r.costs.settler };
  if (a.mode === 'join') {
    const { sid, h } = joinProblem(g, a, r), st = g.s.settlements[sid];
    const sup = supplies(g, r.spawn.joinSupplies, a.count);
    return {
      mode: 'join', site: { x: a.x, y: a.y, ok: true }, target: { id: sid, name: st.name, color: st.color, people: h.people, beds: h.beds },
      people: a.count, supplies: sup, costPer: cost.per,
      effect: `${plural(a.count, 'settler')} join ${st.name} (it has ${peopleN(h.people)} and ${plural(h.beds, 'bed')}; ${peopleN(h.people + a.count)} after they join), bringing ${listText(sup) || 'nothing'}.`,
    };
  }
  const key = keyOf(g, null), prof = profileFor(g, a, key), name = villageName(g, a, prof, key);
  const color = villageColor(g, prof?.color || '#a0c0e0', Object.keys(g.s.settlements).length);
  const sup = supplies(g, r.spawn.suppliesPerSettler, a.count), far = wouldBeAbstract(g, a.x, a.y);
  return {
    mode: 'found', site: { x: a.x, y: a.y, ok: true }, village: { name, profile: prof?.id || null, profileName: prof?.name || '', color, detail: far ? 'abstract' : 'full' },
    people: a.count, supplies: sup, costPer: cost.per,
    effect: g.s.playerSettlement === null ? `${plural(a.count, 'settler')} found ${name} here: your village, bringing ${listText(sup) || 'nothing'}.`
      : `${plural(a.count, 'settler')} found ${name} here (${prof?.name || 'their own'} ways), bringing ${listText(sup) || 'nothing'}${far ? '; it is far from your village, so it is simulated at a distance' : ''}.`,
  };
}

/** Free standing places for n people round (x0, y0) in region `region` (spiral order; never on another colonist,
 *  an active building site or an unbuilt building). Fewer may be found: the rest stand on (x0, y0). */
function placesAround(g, x0, y0, region, n) {
  const taken = new Set();
  for (const o of Object.values(g.s.colonists)) taken.add(o.x + ',' + o.y);
  const out = [];
  for (const [x, y] of rings(x0, y0, PLACE_RADIUS)) {
    if (out.length >= n) break;
    const k = x + ',' + y;
    if (!g.inB(x, y) || taken.has(k) || !g.isPassable(x, y)) continue;
    const foot = g.footAt(x, y);
    if (foot && foot.status === 'active') continue;
    const b = g.structAt(x, y);
    if (b && !b.built) continue;
    if (region >= 0 && g.regionOf(x, y) !== region) continue;
    out.push([x, y]); taken.add(k);
  }
  while (out.length < n) out.push([x0, y0]);
  return out;
}

/** n new adult colonists of `sid` (like world-start founders, but every random choice from a hash of the
 *  command): ids from s.nextId, names from the scenario's pool, skills 0..5. Counted in s.god.spawned. */
function makeSettlers(g, cmd, sid, color, spots, why) {
  const s = g.s, key = keyOf(g, cmd), folk = peopleOfSettlement(g, sid), pool = namePoolOf(g, 'Settler', folk);
  const used = usedNames(s); // the living and the dead (death.js)
  const skills = g.reg.all('skill'), needs = g.reg.all('need');
  const ids = [];
  spots.forEach(([x, y], i) => {
    const id = 'c' + s.nextId++;
    const free = pool.names.filter((n) => !used.has(n));
    const first = free.length ? free[hash(`first:${key}:${i}`) % free.length] : firstByKey(pool, id);
    const name = uniqueName(pool, used, first, id);
    used.add(name);
    const sk = {};
    for (const k of skills) sk[k.id] = hash(`skill:${key}:${i}:${k.id}`) % 6;
    const nd = {};
    for (const n of needs) nd[n.id] = n.behavior === 'core:shelter' ? 0.6 : 0.8;
    const c = s.colonists[id] = {
      id, settlementId: sid, name, color, look: makeLook(`${key}:${i}`, paletteOf(g, folk)),
      x, y, mv: null, skills: sk, xp: {}, needs: nd, carry: null, equip: { tool: null, weapon: null },
      homeId: null, bedId: null, job: null, workOff: {}, lastWork: null, sleeping: false, idle: 0,
      status: { goal: 'Arriving', action: why, target: '', blocker: '' }, workCount: {}, origin: 'divine',
    };
    settleFolk(g, c, peopleOfSettlement(g, sid));
    ensureAdult(g, c);
    g.ownAdd('colonists', c);
    ids.push(id);
  });
  addDivinePeople(g, ids.length);
  return ids;
}

function applyFound(g, cmd, r) {
  const s = g.s, a = cmd.args, key = keyOf(g, cmd);
  const prof = profileFor(g, a, key), name = villageName(g, a, prof, key);
  g.territoryGrid(); // bring the territory cache up to date, so the new village is added to it locally
  let sid = g.newId('t');
  while (s.settlements[sid]) sid = g.newId('t');
  const color = villageColor(g, prof?.color || '#a0c0e0', Object.keys(s.settlements).length);
  const research = newResearchState(g.reg);
  for (const [f, p] of Object.entries(prof?.research || {})) research.priorities[f] = p;
  const pile = pileCells(a.x, a.y).map(([x, y]) => `${x},${y}`);
  const clone = (o) => JSON.parse(JSON.stringify(o || {}));
  // In a world with no people yet (world shaping), the first village founded is the player's: no AI profile,
  // laws and policy as a starting player village.
  const first = s.playerSettlement === null;
  const rec = first ? { id: sid, name, color: '#e8b84a', founded: s.tick, origin: 'divine', center: { x: a.x, y: a.y }, stockpile: pile, research }
    : {
      id: sid, name, ...(prof ? { profile: prof.id } : {}), ai: true, color, founded: s.tick, origin: 'divine',
      center: { x: a.x, y: a.y }, stockpile: pile, research,
      policy: clone(prof?.policy), trade: clone(prof?.trade), laws: { ...(prof?.laws || {}) }, enforcement: prof?.enforcement ?? 0.6,
    };
  if (defaultPeople(g)) rec.people = defaultPeople(g);
  s.settlements[sid] = rec;
  if (first) { s.playerSettlement = sid; s.center = { x: a.x, y: a.y }; g._own = null; } // the player's village from now on
  ensureSettlement(g.reg, s, rec);
  for (const k of pile) { const [x, y] = k.split(',').map(Number); g.setZone(g.i(x, y), 'S:' + sid); }
  g.territoryAdded(sid);
  // Supplies: created at the site by divine power, into the new stockpile.
  const sup = supplies(g, r.spawn.suppliesPerSettler, a.count);
  for (const e of sup) divineItems(g, e.item, e.qty, a.x, a.y, sid);
  // People: on the free tiles round the centre.
  const spots = placesAround(g, a.x, a.y - 3, g.regionOf(a.x, a.y), a.count);
  const ids = makeSettlers(g, cmd, sid, color, spots, `Sent by the gods to found ${name}`);
  // Plans and level of detail (as a daughter village).
  g.planDirty = true;
  (g.plans ||= {})[sid] = emptyPlan();
  (g.replanSids ||= new Set()).add(sid);
  if (first) g.plan = g.plans[sid];
  else if (g.big && wantDetail(g, sid) === 'abstract') setDetail(g, sid, 'abstract', 'it is far from the player');
  const ways = prof && !first ? `, ${prof.name} ways` : '';
  return { msg: `Divine settlers founded ${first ? 'your village, ' : ''}${name} (${peopleN(ids.length)}${ways}; they brought ${listText(sup) || 'nothing'}).`, settlementId: sid, colonists: ids };
}

function applyJoin(g, cmd, r) {
  const a = cmd.args, { sid } = joinProblem(g, a, r), st = g.s.settlements[sid];
  const c = st.center || g.s.center, abs = isAbstract(g, sid);
  // At full detail they arrive where the god pointed; a village simulated at a distance takes them at its centre.
  const spots = abs ? placesAround(g, c.x, c.y, g.regionOf(c.x, c.y), a.count) : placesAround(g, a.x, a.y, g.regionOf(c.x, c.y), a.count);
  const ids = makeSettlers(g, cmd, sid, st.color || '#e8c547', spots, `Sent by the gods to join ${st.name}`);
  if (abs) for (const id of ids) { const p = g.s.colonists[id]; p.status.goal = 'Living at home'; p.status.action = 'The village is far from view: it is simulated by the hour'; }
  const sup = supplies(g, r.spawn.joinSupplies, a.count);
  for (const e of sup) divineItems(g, e.item, e.qty, c.x, c.y, sid);
  g.planDirty = true;
  (g.replanSids ||= new Set()).add(sid);
  return { msg: `Divine settlers joined ${st.name} (${peopleN(ids.length)}; they brought ${listText(sup) || 'nothing'}).`, settlementId: sid, colonists: ids };
}

registerPower('spawn', {
  validate,
  cost: (g, a, r) => r.costs.settler * a.count,
  preview,
  apply: (g, cmd, r) => (cmd.args.mode === 'join' ? applyJoin(g, cmd, r) : applyFound(g, cmd, r)),
});

/**
 * The people ledger (for tests and reports; read-only, one pass over the living and the dead): people by origin.
 * Nobody leaves the world but by death (s.dead, death.js), so
 *   start + born + spawned - died = living,
 * where born = people (living or dead) with a birth tick, spawned = s.god.spawned (people made by powers; each
 * also carries origin 'divine'), died = s.dead, and start = the rest. Pass `start` (the head-count at tick 0) to
 * check the sum; `problems` lists what does not add up.
 */
export function peopleCensus(g, start = null) {
  let living = 0, born = 0, divine = 0, adults = 0, died = 0;
  const count = (c) => {
    if (c.bornTick !== undefined && c.bornTick !== null) born++;
    else if (c.origin === 'divine') divine++;
  };
  for (const c of Object.values(g.s.colonists)) { living++; count(c); if (isAdult(g, c)) adults++; }
  for (const d of Object.values(g.s.dead || {})) { died++; count(d); }
  const spawned = g.s.god?.spawned || 0, left = 0;
  const problems = [];
  if (divine !== spawned) problems.push(`${divine} people came by divine power but the ledger counts ${spawned}`);
  const others = living + died - born - divine;
  if (start !== null && start + born + spawned - died - left !== living) problems.push(`start ${start} + born ${born} + spawned ${spawned} - died ${died} - left ${left} = ${start + born + spawned - died - left}, but ${living} are living`);
  // Peoples and traits: villages keep to one people, so everyone is of their village's people.
  const byPeople = {};
  if (defaultPeople(g)) for (const c of Object.values(g.s.colonists)) {
    byPeople[c.people] = (byPeople[c.people] || 0) + 1;
    if (!g.reg.get('people', c.people)) problems.push(`${c.name} has no known people`);
    else if (c.people !== peopleOfSettlement(g, c.settlementId || g.s.playerSettlement)) problems.push(`${c.name} (${c.people}) lives in a village of another people`);
  }
  return { living, start: start ?? others, born, spawned, died, left, adults, byPeople, ok: !problems.length, problems };
}
