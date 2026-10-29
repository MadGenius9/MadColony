// The Game wraps one serializable state object (`s`) plus rebuildable indexes and transient caches.
// All randomness comes from the seeded RNG stored in the state; nothing reads wall-clock time.
import { tickEducation } from './education.js';
import { tickPeople, ensureAdult } from './people.js';
import { tickHeat, rooms } from './heat.js';
import { tickWater } from './water.js';
import { Rng } from './rng.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR, PLAN_INTERVAL, CARRY_LIMIT, BLOCK_COOLDOWN, WATER_REACH_WALK, SAVE_FORMAT, GAME_API_VERSION, CHUNK, BIG_WORLD_TILES } from './constants.js';
import { rings, clamp } from './util.js';
import { generateWorld, WORLD_SIZES } from './worldgen.js';
import { runPlanner, emptyPlan, planNow } from './planner.js';
import { tickColonist } from './ai/ai.js';
import { tickFarming } from './farming.js';
import { reconcile } from './reconcile.js';
import { makeLook } from './appearance.js';
import { uniqueName } from './names.js';
import { ensureSettlement, researchSummary } from './research.js';
import { foundVillage, tickVillages, legRemaining, spreadSites, farSites } from './villages.js';
import { tickPower } from './power.js';
import { tickLOD } from './lod.js';
import { terrainDistanceField, nearestOnField } from './path.js';
import { tickFounding } from './founding.js';
import { tickKingdoms } from './kingdoms.js';
import { updateMarkets } from './markets.js';
import { IdLayer, SparseIdLayer, layerView, terrainStoreOf } from './tiles.js';
import { tickContact, bordersTouched, newContactState, landChunks, travellers, tradeDeadline, sameLandmass, landmassOf } from './contact.js';
import { applyCommands, newGodState } from './god.js';
import { processDeaths } from './death.js';
import { tickBurial } from './burial.js';
import { tickAging } from './life.js';
import { tickIllness } from './illness.js';
import { tickRivalry } from './war.js';
import { tickFallen } from './fallen.js';
import { tickFire } from './fire.js';
import { tickStorms } from './storm.js';
import { tickWeather } from './weather.js';
import { tickRegrowth, natureRules } from './regrow.js';
import { tickAnimals, animalSpecies } from './animals.js';
import { tickMonsters, monsterSpecies } from './monsters.js';
import { tickSpoil } from './spoil.js';
import './godwrath.js'; // registers the destructive powers (Phase 5b)
import './godspawn.js'; // registers the god power 'spawn' (Phase 2c slice 2)
import './godboons.js'; // registers the god powers 'bless' and 'inspire' (Phase 2c slice 3)
import './godanimals.js'; // registers the god power 'animals' (Phase 8b)
import './godmonsters.js'; // registers the god powers 'monster' and 'banish' (Phase 8c)
import './godshape.js'; // registers the god power 'shape' (world shaping)
import './godtraits.js'; // registers the god power 'trait' (Peoples and traits)
import './worldlaws.js'; // registers the god power 'law' (World laws)
import { tickTithes } from './tithe.js'; // the Tithe law (civilization laws)
import { tickCivLaws } from './civreview.js'; // civilization laws: AI reviews and the relations drift
import { tickMood } from './mood.js'; // Mood: hourly
import { defaultPeople, settleFolk } from './peoples.js';
import { organicScenario, attachClaims, startClaims, growClaims, claimsAdded, claimTerritory, landInfo, warmClaims, claimOkOrganic, claimsDirtySince } from './territory.js';

const COLONIST_COLORS = ['#e8c547', '#5cc8e8', '#e86a5c', '#9be85c', '#c78be8', '#e8a15c', '#5ce8b4', '#e85ca8', '#8ca0ff', '#ffd0a0'];
const NONE = Object.freeze([]); // an empty list shared by lookups that find nothing (never changed)

export class Game {
  constructor(reg, state, planner = null) {
    this.reg = reg;
    this.s = state;
    this.W = state.map.w;
    this.H = state.map.h;
    this.rng = new Rng(state.rng);
    this.prof = reg.get('aiProfile', state.aiProfileId) || reg.all('aiProfile')[0];
    this.policy = this.prof.policy || {};
    this.excl = new Map(); // exclusive reservations: key -> colonist id
    this.qtyRes = new Map(); // stack id -> reserved qty
    this.incRes = new Map(); // "structId|item" -> qty on the way
    state.blocked ||= {}; // target key -> {reason, until}: failed targets everyone skips for a while
    state.logKeys ||= {}; // log de-duplication
    this.pathVersion = 0;
    this.regionsDirty = true;
    this.region = new Int32Array(this.W * this.H); // per tile: chunk-local area label (chunk * 1024 + n), -1 if blocked
    this._ts = terrainStoreOf(state.map); // terrain as palette indexes; s.map.terrain becomes a view onto it (tiles.js)
    this._tdefs = []; // palette index -> terrain definition
    attachClaims(this); // organic territory (territory.js): the claim grid; null in nearest-centre games
    this.tempBlock = -1;
    this.plan = emptyPlan();
    this.plans = {};
    this.actor = null; // settlement acting right now (owner of items it creates/drops)
    if (state.playerSettlement === undefined) state.playerSettlement = 't1'; // null: a world with no people yet (world shaping)
    state.settlements ||= { [state.playerSettlement]: { id: state.playerSettlement, name: 'First Hearth', founded: 0 } };
    for (const st of Object.values(state.settlements)) ensureSettlement(reg, state, st);
    for (const st of Object.values(state.settlements)) st.stockpile ||= [];
    state.relations ||= {}; state.trades ||= {}; state.diplomacy ||= { tradePolicy: 'open' }; state.treaties ||= {}; state.proposals ||= {}; state.rights ||= {}; state.disputes ||= {}; state.enforcement ||= {};
    this.rebuildIndexes();
    if (planner) { // a format-7 save: continue with exactly the plans the saving game had (plancodec.js)
      this.plans = planner.plans;
      this.plan = planner.plan || planner.plans[state.playerSettlement] || emptyPlan();
      this.planDirty = planner.planDirty;
      this.replanSids = planner.replanSids;
      if (planner.replanLater) this.replanLater = planner.replanLater;
    }
    reconcile(this);
    if (!planner) {
      this.planDirty = true; // the first tick plans
      // Big worlds: abstract villages plan spread out, at their own slot or hour, so the first tick after
      // loading an older save (no saved plans) does not plan every village at once.
      if (this.big) this.replanLater = abstractVillages(state);
    }
  }

  // ---------- creation ----------
  static create(reg, opts = {}) {
    const seed = (opts.seed ?? 20261021) >>> 0;
    const scenario = (opts.scenarioId && reg.get('scenario', opts.scenarioId)) || reg.all('scenario')[0];
    const size = WORLD_SIZES[opts.size] || WORLD_SIZES[scenario?.size] || null; // a size preset overrides the world's own width and height
    // The generator: one asked for, else the size preset's own (Vast and World are planets), else the scenario's.
    // A scenario's own planet-style generator (world shaping's ocean) wins over the size preset's planet.
    const own = scenario?.worldgen && reg.get('worldgen', scenario.worldgen);
    const wg0 = (opts.worldgenId && reg.get('worldgen', opts.worldgenId)) || (own?.planet && own) || (size?.worldgen && reg.get('worldgen', size.worldgen)) || own || reg.all('worldgen')[0];
    const wg = wg0 && size ? { ...wg0, width: size.w, height: size.h } : wg0;
    const prof = (opts.aiProfileId && reg.get('aiProfile', opts.aiProfileId)) || reg.all('aiProfile')[0];
    if (!scenario || !wg || !prof) throw new Error('Cannot start a game: scenario, worldgen or aiProfile content is missing.');
    const s = {
      format: SAVE_FORMAT, apiVersion: GAME_API_VERSION, seed, rng: { s: seed || 1 }, tick: 0, nextId: 1,
      scenarioId: scenario.id, worldgenId: wg.id, aiProfileId: prof.id, worldSize: size ? (WORLD_SIZES[opts.size] ? opts.size : scenario.size) : null,
      map: null, nodes: {}, structures: {}, stacks: {}, crops: {}, colonists: {}, projects: {}, homes: {}, fields: {},
      goals: [], allowedArea: null, center: null, relations: {}, trades: {}, diplomacy: { tradePolicy: 'open' }, treaties: {}, proposals: {}, rights: {}, disputes: {}, enforcement: {},
      ledger: { created: {}, consumed: {}, byReason: {} }, log: [], orphans: [], overflow: [], stats: { replans: 0, interrupts: 0, jobFailures: 0 },
    };
    if (organicScenario(scenario)) s.claims = { ids: [], grid: null, grew: {} }; // organic territory (save format 10)
    if (scenario.contact) s.contact = newContactState(); // contact over distance: explorers, traders, touching lands (save format 11)
    const rng = new Rng(s.rng);
    const { cx, cy } = generateWorld(reg, s, rng, wg);
    // Stockpile: a 6x4 rectangle just south of the landing spot.
    const sx0 = cx - 3, sy0 = cy + 2;
    const pile = [];
    for (let y = sy0; y < sy0 + 4; y++) for (let x = sx0; x < sx0 + 6; x++) pile.push(`${x},${y}`);
    s.center = { x: cx, y: cy + 3 };
    // A world with no people (world shaping: scenario people: false): no village, no colonists, no neighbours;
    // the first village founded by the spawn power becomes the player's (godspawn.js).
    const empty = scenario.people === false;
    if (empty) { s.settlements = {}; s.playerSettlement = null; } else {
      // One settlement for now. Colonists belong to it; the planner plans for it. See docs/ARCHITECTURE.md.
      s.settlements = { t1: { id: 't1', name: 'First Hearth', founded: 0, center: { ...s.center }, stockpile: pile, color: '#e8b84a' } };
      if (defaultPeople({ reg })) s.settlements.t1.people = defaultPeople({ reg });
      s.playerSettlement = 't1';
      // Remove anything spawned on the stockpile.
      for (const [id, n] of Object.entries(s.nodes)) if (pile.includes(`${n.x},${n.y}`)) delete s.nodes[id];
    }

    const game = new Game(reg, s);
    const g = game;
    // Starting items go into the stockpile.
    if (!empty) for (const it of scenario.startItems) g.createItems(it.item, it.qty, s.center.x, s.center.y, 'start', undefined, true);
    // Colonists
    const pool = reg.get('namePool', scenario.namePool);
    const names = rng.shuffle([...pool.names]);
    const skills = reg.all('skill');
    const needs = reg.all('need');
    for (let i = 0; i < (empty ? 0 : scenario.colonists); i++) {
      const id = 'c' + s.nextId++;
      const sk = {};
      for (const k of skills) sk[k.id] = (scenario.skillMin ?? 0) + rng.int((scenario.skillMax ?? 6) - (scenario.skillMin ?? 0) + 1);
      const passion = skills[(i + rng.int(skills.length)) % skills.length];
      sk[passion.id] = 6 + rng.int(4);
      const nd = {};
      for (const n of needs) nd[n.id] = n.behavior === 'core:shelter' ? 0.6 : 0.75 + rng.next() * 0.2;
      s.colonists[id] = {
        id, settlementId: 't1', name: i < names.length ? names[i] : uniqueName({ names: pool.names, surnames: pool.surnames || [] }, new Set(Object.values(s.colonists).map((c) => c.name)), names[i % names.length], id), color: COLONIST_COLORS[i % COLONIST_COLORS.length],
        look: makeLook(`${seed}:${i}`),
        x: cx - 2 + (i % 5), y: cy - 1 + Math.floor(i / 5), mv: null,
        skills: sk, xp: {}, needs: nd, carry: null, equip: { tool: null, weapon: null },
        homeId: null, bedId: null, job: null, workOff: {}, lastWork: null, sleeping: false,
        idle: 0, status: { goal: 'Arriving', action: 'Looking around', target: '', blocker: '' }, workCount: {},
      };
      settleFolk(game, s.colonists[id], 't1' in s.settlements ? s.settlements.t1.people : null);
    }
    // Neighbouring AI villages (scenario option), founded after the player's colonists.
    if (!empty && scenario.neighbors?.length) {
      // Village spacing grows with the map (square root of its area relative to the standard 72x52).
      const scale = Math.max(1, Math.sqrt((s.map.w * s.map.h) / (72 * 52)) * 0.75);
      game._neighborDistance = Math.round((scenario.neighborDistance || 24) * scale);
      const used = new Set(Object.values(s.colonists).map((c) => c.name));
      // opts.villages picks how many (1-4 around the player; up to 40 spread over the land; far: up to farPlacement.maxVillages); profiles repeat in order.
      const spread = scenario.placement === 'spread', far = scenario.placement === 'far', fp = scenario.farPlacement || {};
      const want = Math.max(1, Math.min(far ? (fp.maxVillages ?? 8) : spread ? 40 : 4, opts.villages || scenario.villages || scenario.neighbors.length));
      // far: far apart on good sites over the player's land (villages.js farSites); spread: over the whole land.
      const sites = far ? farSites(game, want, fp, scenario.siteWaterWalk ?? 24) : spread ? spreadSites(game, want, game._neighborDistance) : null;
      const n = sites ? sites.length : want;
      // What 'far' placement found (derived, never saved: for reports and the New colony summary).
      if (far) game.placement = { wanted: want, placed: n, spacing: sites.spacing, candidates: sites.candidates, sites: sites.map((x) => ({ ...x })) };
      if (far && n < want) game.log(`Only ${n} of ${want} village sites fit on this land at least ${sites.spacing} tiles apart.`, 'warn');
      if (spread && n < want) game.log(`Only ${n} of ${want} village sites were found on this land.`, 'warn');
      for (let k = 0; k < n; k++) foundVillage(game, reg.get('villageProfile', scenario.neighbors[k % scenario.neighbors.length] ) || reg.all('villageProfile')[k % reg.all('villageProfile').length], rng, used, sites ? sites[k] : null);
      game.rebuildIndexes();
    }
    for (const c of Object.values(s.colonists)) ensureAdult(game, c);
    startClaims(game); // organic territory: every settlement claims its first land (nothing otherwise)
    runPlanner(game);
    if (game.big) game.warmCaches();
    game.log(empty ? 'The world is empty: shape it, then send the first people (the spawn power).' : 'The settlers have arrived. They will look after themselves; set goals to steer them.', 'good');
    if (opts.sandbox) s.god = newGodState(game, true); // Sandbox: god powers are free (god.js); otherwise s.god is made by the first power used
    return game;
  }

  // ---------- indexes ----------
  i(x, y) { return y * this.W + x; }
  inB(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }

  rebuildIndexes() {
    const N = this.W * this.H, s = this.s;
    this._chg = null; // tile changes per chunk (tileChanged): made below, once the chunk grid is known
    this._paths = null; // the path cache (path.js) is only valid against the counters it was made with
    // Per-tile id layers (tiles.js): read and written only through the accessors below.
    this.lNode = new IdLayer(N);
    // Nodes cover the land everywhere (a flat array); the rest only where people live (blocks made on use).
    this.lStruct = new SparseIdLayer(N);
    this.lStack = new SparseIdLayer(N);
    this.lCrop = new SparseIdLayer(N);
    this.lFoot = new SparseIdLayer(N);
    this.lZone = new SparseIdLayer(N); // 'S:<settlement>' = that settlement's stockpile, or a field id
    // Chunk index of resource nodes (32x32 tiles, nodes grouped by kind; derived, never saved).
    this.CW = Math.ceil(this.W / CHUNK); this.CH = Math.ceil(this.H / CHUNK);
    this._chg = { n: 0, all: 0, rev: new Float64Array(this.CW * this.CH) };
    this.cNodes = new Array(this.CW * this.CH).fill(null);
    // One pass over the nodes (listing a big world's nodes is itself costly): the tile layer, the chunk index,
    // nodes by definition (in s.nodes order) and the picked plants waiting to regrow.
    const byDef = new Map(), empty = new Map();
    for (const n of Object.values(s.nodes)) {
      this.setNodeId(this.i(n.x, n.y), n.id);
      this.indexNode(n);
      let a = byDef.get(n.def); if (!a) byDef.set(n.def, (a = [])); a.push(n);
      if (n.empty) empty.set(n.id, n);
    }
    for (const st of Object.values(s.structures)) this.setStructId(this.i(st.x, st.y), st.id);
    for (const st of Object.values(s.stacks)) this.setStackId(this.i(st.x, st.y), st.id);
    for (const c of Object.values(s.crops)) this.setCropId(this.i(c.x, c.y), c.id);
    for (const p of Object.values(s.projects)) if (p.status !== 'cancelled') for (const [x, y] of p.cells) this.setFootId(this.i(x, y), p.id);
    for (const f of Object.values(s.fields)) for (const [x, y] of fieldCells(f)) this.setZone(this.i(x, y), f.id);
    for (const st of Object.values(s.settlements || {})) for (const k of st.stockpile || []) { const [x, y] = k.split(',').map(Number); this.setZone(this.i(x, y), 'S:' + st.id); }
    this._own = null; // ownership indexes: rebuilt on first use
    this._sw = null;
    this._empty = empty;
    this._nbd = { rev: this.nodeRev || 0, map: byDef, sets: new Map(), stale: new Set() };
    this.structRev = (this.structRev || 0) + 1;
    this.markDirty();
  }

  /** Something changed walkability or paths. With a position only that chunk's areas are recomputed;
   *  without one, the whole map is. */
  markDirty(x, y) {
    this.tileChanged(x, y);
    this.regionsDirty = true; this.pathVersion = (this.pathVersion || 0) + 1; this.passRev = (this.passRev || 0) + 1;
    if (x === undefined || !this._dirtyChunks || !this.inB(x, y)) { this._dirtyAll = true; return; }
    this._dirtyChunks.add(this.chunkOf(x, y));
  }
  /** Derived, never saved: when anything a path search reads on a tile last changed (its terrain, node or
   *  structure, walkable or standable or not), per chunk, as a running count (path.js keeps found paths while
   *  nothing under the area they searched has changed). Without a position: everywhere. */
  tileChanged(x, y) {
    const ch = this._chg;
    if (!ch) return;
    if (x === undefined || !this.inB(x, y)) ch.all = ++ch.n;
    else ch.rev[this.chunkOf(x, y)] = ++ch.n;
  }
  /** Mark the chunks under a list of [x, y] cells. */
  markDirtyCells(cells) {
    if (!cells?.length) return this.markDirty();
    for (const [x, y] of cells) this.markDirty(x, y);
  }

  // ---------- chunks (big worlds) ----------
  /** Worlds larger than the classic Large preset use bounded, chunk-based searches; classic worlds keep
   *  their original whole-map behaviour exactly. */
  get big() { return this.W * this.H > BIG_WORLD_TILES; }
  chunkOf(x, y) { return Math.floor(y / CHUNK) * this.CW + Math.floor(x / CHUNK); }
  indexNode(n) {
    const ci = this.chunkOf(n.x, n.y);
    const m = (this.cNodes[ci] ||= new Map());
    let a = m.get(n.def); if (!a) m.set(n.def, (a = []));
    a.push(n);
  }
  unindexNode(n) {
    const a = this.cNodes[this.chunkOf(n.x, n.y)]?.get(n.def);
    const k = a ? a.indexOf(n) : -1;
    if (k >= 0) a.splice(k, 1);
  }
  /** Nodes of the given kinds (a Set of node def ids, or null for all) in the chunks overlapping the square
   *  of radius r round (x, y): chunk rows top to bottom, columns left to right, then index order. */
  nodesNear(x, y, r, defs = null) {
    const out = [];
    const x0 = Math.max(0, Math.floor((x - r) / CHUNK)), x1 = Math.min(this.CW - 1, Math.floor((x + r) / CHUNK));
    const y0 = Math.max(0, Math.floor((y - r) / CHUNK)), y1 = Math.min(this.CH - 1, Math.floor((y + r) / CHUNK));
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const m = this.cNodes[cy * this.CW + cx];
      if (!m) continue;
      for (const [def, a] of m) if (!defs || defs.has(def)) for (const n of a) out.push(n);
    }
    return out;
  }

  newId(prefix) { return prefix + this.s.nextId++; }

  // ---------- ownership indexes (derived, never saved) ----------
  // Per settlement, its colonists / structures / stacks / projects / fields / homes, in the same order as
  // Object.values(s[coll]) (a Map keeps insertion order, as an object does for these string ids, and a key
  // set again keeps its place). Built on first use and kept current by every place that adds or removes
  // such an entity (addStructure, removeStructure, addStack, takeFromStack, createProject, createField, homes,
  // births, founding, restores). So "this village's own things" cost O(its own) instead of a whole-world scan,
  // with exactly the same results and order.
  ownerOf(coll, e) { return (coll === 'colonists' ? e.settlementId : e.settlement) || this.s.playerSettlement; }
  ownIndex(coll) {
    this._own ||= {};
    let ix = this._own[coll];
    // Colonists may also be added directly (tests, tools) with ids 'c' + s.nextId: pick up any made since the
    // index last looked (ids from s.nextId only grow), without walking every colonist.
    if (ix && coll === 'colonists' && ix.mark !== this.s.nextId) {
      for (let n = ix.mark; n < this.s.nextId; n++) { const c = this.s.colonists['c' + n]; if (c) this.ownAdd('colonists', c); }
      ix.mark = this.s.nextId;
    }
    if (!ix) {
      ix = new Map();
      let n = 0;
      for (const e of Object.values(this.s[coll] || {})) {
        const k = this.ownerOf(coll, e);
        let m = ix.get(k); if (!m) ix.set(k, (m = new Map()));
        m.set(e.id, e); n++;
      }
      ix.n = n;
      ix.mark = this.s.nextId;
      this._own[coll] = ix;
    }
    return ix;
  }
  /** Structures of one kind (pred on the structure, usually on its building definition), in Object.values
   *  order; cached until a structure is added, removed or rebuilt as another building (structRev). Callers
   *  apply changing conditions (built, powered) themselves. */
  structsWhere(key, pred) {
    this._sw ||= new Map();
    let e = this._sw.get(key);
    if (!e) { e = { pred, list: Object.values(this.s.structures).filter(pred) }; this._sw.set(key, e); }
    return e.list;
  }
  /** One settlement's structures of one kind: structsWhere(key, pred) narrowed to owner sid, in the same
   *  (Object.values) order. The split by owner is cached until that list changes; an empty array when none.
   *  Callers still check the owner and changing conditions themselves. */
  ownedWhere(key, pred, sid) {
    const list = this.structsWhere(key, pred);
    this._ow ||= new Map();
    let e = this._ow.get(key);
    if (!e || e.list !== list || e.ps !== this.s.playerSettlement) {
      const by = new Map();
      for (const st of list) { const k = st.settlement || this.s.playerSettlement; let a = by.get(k); if (!a) by.set(k, (a = [])); a.push(st); }
      e = { list, ps: this.s.playerSettlement, by };
      this._ow.set(key, e);
    }
    return e.by.get(sid) || NONE;
  }
  /** Keep structsWhere lists current as structures come and go (copy on write: a list someone holds is
   *  never changed under them). A new structure goes last, as in s.structures. */
  structsChanged(st, added) {
    if (!this._sw) return;
    for (const e of this._sw.values()) {
      if (!e.pred(st)) continue;
      e.list = added ? [...e.list, st] : e.list.filter((x) => x !== st);
    }
  }
  /** A structure became another building in place (a renovation, construction.js): the structsWhere lists it
   *  was in or joins are rebuilt (in Object.values order, as on first use); the others are unchanged. Their
   *  conditions read only the building kind, so each list is tested with the old kind and the new one. */
  structRedefined(st, oldDef) {
    this.tileChanged(st.x, st.y); // walkable or standable may differ now
    if (!this._sw) return;
    const now = st.def;
    for (const e of this._sw.values()) {
      st.def = oldDef; const was = !!e.pred(st);
      st.def = now; const is = !!e.pred(st);
      if (was || is) e.list = Object.values(this.s.structures).filter(e.pred); // a new list: caches keyed on it (power, water) redo
    }
    st.def = now;
  }
  /** Structures not built yet, in Object.values order (cached until one is added, removed or finished). */
  unbuiltStructs() {
    const key = `${this.structRev || 0}|${this.builtRev || 0}`;
    if (this._unbuilt?.key !== key) this._unbuilt = { key, list: Object.values(this.s.structures).filter((st) => !st.built) };
    return this._unbuilt.list;
  }
  /** Big worlds: a village's plan, planning it now if it has none and waits for its slot (after loading a save
   *  without saved plans: planner.js replanLater). For daily and hourly sim steps only, never from the UI
   *  (reading must not change the game). */
  ensurePlan(sid) {
    if (!this.plans?.[sid] && this.replanLater?.has(sid)) planNow(this, sid);
    return this.plans?.[sid];
  }
  /** Settlement sid's own entities of a collection, as a new array in Object.values order. */
  owned(coll, sid) { const m = this.ownIndex(coll).get(sid); return m ? [...m.values()] : []; }
  ownAdd(coll, e) {
    const ix = this._own?.[coll];
    if (!ix) return;
    const k = this.ownerOf(coll, e);
    let m = ix.get(k); if (!m) ix.set(k, (m = new Map()));
    if (!m.has(e.id)) ix.n++;
    m.set(e.id, e);
  }
  ownDel(coll, e) { const m = this._own?.[coll]?.get(this.ownerOf(coll, e)); if (m?.delete(e.id)) this._own[coll].n--; }
  /** Ownership changed (founding): rebuild that collection's index on next use. */
  ownReset(coll) { if (this._own) delete this._own[coll]; }

  // ---------- time ----------
  get day() { return Math.floor(this.s.tick / TICKS_PER_DAY) + 1; }
  get hour() { return (this.s.tick % TICKS_PER_DAY) / TICKS_PER_HOUR; }
  isNight() { const h = this.hour; return h >= 22 || h < 6; }
  timeString() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return `Day ${this.day}, ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // ---------- world queries ----------
  // ---------- per-tile layers (accessors) ----------
  // Every read or write of the per-tile layers goes through these. Index forms take a tile index i
  // (this.i(x, y)); the object forms also take (x, y), as before.
  /** terrainAt(x, y): the terrain definition (an unknown id gives a fallback); terrainAt(i): the terrain id. */
  terrainAt(x, y) {
    const ts = this._ts;
    if (y === undefined) return ts.pal[ts.idx[x]] ?? null;
    const k = ts.idx[y * this.W + x];
    return this._tdefs[k] || this._tdef(k);
  }
  /** Terrain definition of a palette index (unknown ids give the fallback, as terrainAt does). */
  terrainDefOf(k) { return this._tdefs[k] || this._tdef(k); }
  _tdef(k) {
    if (k === undefined) return FALLBACK_TERRAIN; // outside the map, as before
    return (this._tdefs[k] = this.reg.get('terrain', this._ts.pal[k]) || FALLBACK_TERRAIN);
  }
  /** Palette index of a tile's terrain (terrainPalette[k] is its id). */
  terrainIdx(i) { return this._ts.idx[i]; }
  /** Terrain ids by palette index (read only; grows when a new kind is set). */
  get terrainPalette() { return this._ts.pal; }
  /** Change a tile's terrain: bumps the map revision (terrain caches rebuild) and marks its chunk's walkable
   *  areas for relabelling. */
  setTerrain(i, id) {
    this._ts.set(i, id);
    this.s.map.rev = (this.s.map.rev || 0) + 1;
    this.markDirty(i % this.W, (i / this.W) | 0);
  }
  /** Change a tile's terrain to one that walks, drinks and is claimed exactly like the old one (the caller checks:
   *  godwrath.js craters): the map revision stays, so whole-map caches built from those (water walk, land chunks,
   *  territory) are not rebuilt; they would come out the same. The tile's chunk is marked changed, and
   *  terrainDrawRev (derived, never saved) tells the map drawing the terrain changed. */
  setTerrainKeepRev(i, id) {
    this._ts.set(i, id);
    this.terrainDrawRev = (this.terrainDrawRev || 0) + 1;
    this.markDirty(i % this.W, (i / this.W) | 0);
  }
  nodeIdAt(i) { const L = this.lNode, h = L.a[i]; return h ? L.ids[h] : null; }
  structIdAt(i) { return this.lStruct.get(i); }
  stackIdAt(i) { return this.lStack.get(i); }
  cropIdAt(i) { return this.lCrop.get(i); }
  footIdAt(i) { return this.lFoot.get(i); }
  /** The zone on a tile: 'S:<settlement>' (its stockpile) or a field id; null if none. */
  zoneAt(x, y) { return this.lZone.get(y === undefined ? x : y * this.W + x); }
  setNodeId(i, id) { this.lNode.set(i, id); this.tileChanged(i % this.W, (i / this.W) | 0); }
  setStructId(i, id) { this.lStruct.set(i, id); this.tileChanged(i % this.W, (i / this.W) | 0); }
  setStackId(i, id) { this.lStack.set(i, id); }
  setCropId(i, id) { this.lCrop.set(i, id); }
  setFootId(i, id) { this.lFoot.set(i, id); }
  setZone(i, z) { this.lZone.set(i, z); }
  // Array-like views of the layers for old callers (tests, tools): slow, the sim uses the accessors.
  get tNode() { return layerView(this.lNode); }
  get tStruct() { return layerView(this.lStruct); }
  get tStack() { return layerView(this.lStack); }
  get tCrop() { return layerView(this.lCrop); }
  get tFoot() { return layerView(this.lFoot); }
  get tZone() { return layerView(this.lZone); }
  nodeAt(x, y) { const id = this.nodeIdAt(y === undefined ? x : this.i(x, y)); return id ? this.s.nodes[id] : null; }
  structAt(x, y) { const id = this.structIdAt(y === undefined ? x : this.i(x, y)); return id ? this.s.structures[id] : null; }
  stackAt(x, y) { const id = this.stackIdAt(y === undefined ? x : this.i(x, y)); return id ? this.s.stacks[id] : null; }
  cropAt(x, y) { const id = this.cropIdAt(y === undefined ? x : this.i(x, y)); return id ? this.s.crops[id] : null; }
  footAt(x, y) { const id = this.footIdAt(y === undefined ? x : this.i(x, y)); return id ? this.s.projects[id] : null; }
  isStockpile(x, y) { const z = this.zoneAt(this.i(x, y)); return !!z && z.startsWith('S:'); }
  /** Which settlement's stockpile this tile belongs to (or null). */
  stockpileOwnerAt(x, y) { const z = this.zoneAt(this.i(x, y)); return z && z.startsWith('S:') ? z.slice(2) : null; }
  stockpileOf(sid) { return this.s.settlements?.[sid]?.stockpile || []; }
  fieldAt(x, y) { const z = this.zoneAt(this.i(x, y)); return z && !z.startsWith('S:') ? this.s.fields[z] : null; }
  nodeDef(n) { return this.reg.get('node', n.def); }
  bDef(st) { return this.reg.get('building', st.def); }

  isPassable(x, y) {
    if (!this.inB(x, y)) return false;
    const i = this.i(x, y);
    if (i === this.tempBlock) return false;
    if (!this.terrainAt(x, y).passable) return false;
    const n = this.nodeIdAt(i);
    if (n) { const d = this.reg.get('node', this.s.nodes[n].def); if (d && !d.passable) return false; }
    const st = this.structIdAt(i);
    if (st) { const s = this.s.structures[st]; if (s.built) { const d = this.reg.get('building', s.def); if (d && !d.passable) return false; } }
    return true;
  }
  moveCost(x, y) { return this.terrainAt(x, y).moveCost || 1; }
  /** False on tiles where an impassable blueprint is waiting to be built (don't loiter there). */
  standable(x, y) {
    const id = this.structIdAt(this.i(x, y));
    if (!id) return true;
    const st = this.s.structures[id];
    return st.built || !!this.reg.get('building', st.def)?.passable;
  }
  colonistAt(x, y, exceptId) {
    for (const c of Object.values(this.s.colonists)) if (c.x === x && c.y === y && c.id !== exceptId) return c;
    return null;
  }

  /**
   * Connected walkable areas (4-way), kept per chunk: each 32x32 chunk labels its own areas (label chunk * 1024
   * + n, n in scan order), and areas that touch across chunk borders are joined. A change at a known tile
   * relabels only its chunk and re-reads only that chunk's four borders; the joining then runs on the coarse
   * graph of areas and border contacts (a few per chunk), not on tiles. regionOf gives the joined id: the
   * smallest label of the joined areas, so two tiles are connected exactly when their ids are equal (the same
   * answers and the same ids as a whole-map flood fill joined by union-find).
   */
  ensureRegions() {
    if (!this.regionsDirty) return;
    const W = this.W, H = this.H, C = CHUNK, reg = this.region, CW = this.CW, CH = this.CH;
    const nChunks = CW * CH;
    if (!this._labels || this._labels.length !== nChunks) {
      this._labels = new Int32Array(nChunks);
      this._sideE = new Array(nChunks).fill(NONE); // contacts across the chunk's right border: [a, b, a, b, ...]
      this._sideS = new Array(nChunks).fill(NONE); // contacts across its bottom border
      this._dirtyAll = true;
    }
    const all = this._dirtyAll || !this._dirtyChunks;
    const todo = all ? Array.from({ length: nChunks }, (_, k) => k) : [...this._dirtyChunks];
    const stack = [];
    for (const ci of todo) {
      const cx0 = (ci % CW) * C, cy0 = Math.floor(ci / CW) * C;
      const cx1 = Math.min(W, cx0 + C), cy1 = Math.min(H, cy0 + C);
      for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) reg[y * W + x] = this.isPassable(x, y) ? -2 : -1;
      let n = 0;
      for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) {
        const i = y * W + x;
        if (reg[i] !== -2) continue;
        const id = ci * 1024 + n++;
        reg[i] = id; stack.push(i);
        while (stack.length) {
          const k = stack.pop(); const kx = k % W, ky = (k / W) | 0;
          if (kx + 1 < cx1 && reg[k + 1] === -2) { reg[k + 1] = id; stack.push(k + 1); }
          if (kx - 1 >= cx0 && reg[k - 1] === -2) { reg[k - 1] = id; stack.push(k - 1); }
          if (ky + 1 < cy1 && reg[k + W] === -2) { reg[k + W] = id; stack.push(k + W); }
          if (ky - 1 >= cy0 && reg[k - W] === -2) { reg[k - W] = id; stack.push(k - W); }
        }
      }
      this._labels[ci] = n;
    }
    // Border contacts of the relabelled chunks (each border kept by the chunk left of or above it).
    if (all) for (let ci = 0; ci < nChunks; ci++) { this._sideE[ci] = this.borderContacts(ci, true); this._sideS[ci] = this.borderContacts(ci, false); }
    else {
      for (const ci of todo) {
        this._sideE[ci] = this.borderContacts(ci, true);
        this._sideS[ci] = this.borderContacts(ci, false);
        if (ci % CW > 0) this._sideE[ci - 1] = this.borderContacts(ci - 1, true);
        if (ci >= CW) this._sideS[ci - CW] = this.borderContacts(ci - CW, false);
      }
    }
    // Join on the coarse graph. Areas are numbered compactly in label order (chunk, then n), so the smallest
    // compact number of a joined set is its smallest label.
    const base = new Int32Array(nChunks + 1);
    for (let ci = 0; ci < nChunks; ci++) base[ci + 1] = base[ci] + this._labels[ci];
    const total = base[nChunks];
    const parent = new Int32Array(total);
    for (let k = 0; k < total; k++) parent[k] = k;
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    for (const sides of [this._sideE, this._sideS]) for (let ci = 0; ci < nChunks; ci++) {
      const e = sides[ci];
      for (let k = 0; k < e.length; k += 2) {
        const la = e[k], lb = e[k + 1];
        const a = find(base[la >> 10] + (la & 1023)), b = find(base[lb >> 10] + (lb & 1023));
        if (a !== b) { if (a < b) parent[b] = a; else parent[a] = b; }
      }
    }
    // Joined id of each area: the label of its set's smallest member.
    const canon = new Int32Array(total);
    for (let ci = 0; ci < nChunks; ci++) for (let n = 0, b0 = base[ci], m = this._labels[ci]; n < m; n++) canon[b0 + n] = ci * 1024 + n;
    for (let k = 0; k < total; k++) canon[k] = canon[find(k)];
    this._base = base; this._canon = canon;
    if (!this._dirtyChunks) this._dirtyChunks = new Set();
    this._dirtyChunks.clear(); this._dirtyAll = false;
    this.regionsDirty = false;
  }
  /** Contacts between areas across chunk ci's right (east) or bottom (south) border, as label pairs [a, b, ...]
   *  (a run of the same pair is kept once). */
  borderContacts(ci, east) {
    const W = this.W, H = this.H, C = CHUNK, reg = this.region;
    const cx0 = (ci % this.CW) * C, cy0 = Math.floor(ci / this.CW) * C;
    let out = null, pa = -1, pb = -1;
    if (east) {
      const x = cx0 + C - 1;
      if (x + 1 >= W) return NONE;
      for (let y = cy0, y1 = Math.min(H, cy0 + C); y < y1; y++) {
        const a = reg[y * W + x], b = reg[y * W + x + 1];
        if (a >= 0 && b >= 0 && (a !== pa || b !== pb)) { (out ||= []).push(a, b); pa = a; pb = b; }
      }
    } else {
      const y = cy0 + C - 1;
      if (y + 1 >= H) return NONE;
      for (let x = cx0, x1 = Math.min(W, cx0 + C); x < x1; x++) {
        const a = reg[y * W + x], b = reg[(y + 1) * W + x];
        if (a >= 0 && b >= 0 && (a !== pa || b !== pb)) { (out ||= []).push(a, b); pa = a; pb = b; }
      }
    }
    return out || NONE;
  }
  /** Joined area id of a tile index, or -1 if the tile is blocked. */
  regionAt(i) { const r = this.region[i]; return r >= 0 ? this._canon[this._base[r >> 10] + (r & 1023)] : -1; }
  regionOf(x, y) {
    this.ensureRegions();
    if (!this.inB(x, y)) return -1;
    const r = this.regionAt(this.i(x, y));
    if (r >= 0) return r;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (this.inB(nx, ny) && this.regionAt(this.i(nx, ny)) >= 0) return this.regionAt(this.i(nx, ny));
    }
    return -1;
  }
  /** Can a colonist standing at (fx,fy) reach (x,y)? mode 'on' = stand on it, 'adj' = stand next to it. */
  reachableFrom(fx, fy, x, y, mode) {
    const r = this.regionOf(fx, fy);
    if (r < 0) return false;
    if (mode === 'on') return this.inB(x, y) && this.regionAt(this.i(x, y)) === r;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (this.inB(nx, ny) && this.regionAt(this.i(nx, ny)) === r) return true;
    }
    return false;
  }
  canReach(c, x, y, mode) { return this.reachableFrom(c.x, c.y, x, y, mode); }

  /** Would making (x,y) impassable cut any colonist or remaining blueprint off from the colony center? */
  wouldTrap(x, y, sid = null) {
    if (sid) return this.wouldTrapFor(x, y, sid);
    this.tempBlock = this.i(x, y);
    this.markDirty(x, y);
    let trapped = false;
    try {
      const home = this.regionOf(this.s.center.x, this.s.center.y);
      for (const c of Object.values(this.s.colonists)) if (this.regionOf(c.x, c.y) !== home) { trapped = true; break; }
      if (!trapped) {
        for (const st of Object.values(this.s.structures)) {
          if (st.built || (st.x === x && st.y === y)) continue;
          if (!this.reachableFrom(this.s.center.x, this.s.center.y, st.x, st.y, 'adj')) { trapped = true; break; }
        }
      }
    } finally {
      this.tempBlock = -1;
      this.markDirty(x, y);
    }
    return trapped;
  }
  /** wouldTrap for abstract villages (lod.js; big worlds only): would making (x,y) impassable cut a colonist
   *  of any settlement off from their settlement's centre, or a building site of any settlement off from
   *  its owner's centre, when they can reach it now? Anyone already cut off (a pocket closed by growing
   *  trees) is ignored, so one stranded colonist does not stop every village's walls, as the classic
   *  world-wide check does. `sid` (the builder) is kept for callers; every settlement counts. */
  wouldTrapFor(x, y, sid) {
    if (!this.cutsNothing(x, y)) return this.wouldTrapFull(x, y);
    return false;
  }
  /** Run fn with (x,y) blocked (tempBlock), then unblock. The walkable areas with the tile open again are the
   *  ones computed before (they are a pure function of walkability), so when nothing else changed meanwhile
   *  they are put back from a copy instead of being recomputed (that chunk's labels and the joined ids). */
  probeBlocked(x, y, fn) {
    this.ensureRegions();
    const W = this.W, C = CHUNK, CW = this.CW, ci = this.chunkOf(x, y);
    const cx0 = (ci % CW) * C, cy0 = Math.floor(ci / CW) * C, cx1 = Math.min(W, cx0 + C), cy1 = Math.min(this.H, cy0 + C);
    const cw = cx1 - cx0;
    const rows = (this._snapRows ||= new Int32Array(C * C));
    for (let yy = cy0; yy < cy1; yy++) rows.set(this.region.subarray(yy * W + cx0, yy * W + cx1), (yy - cy0) * cw);
    // The joined ids and the border contacts are replaced by ensureRegions, never changed in place, so keeping
    // the current ones is enough to put them back.
    const base = this._base, canon = this._canon, labels = this._labels[ci], passRev = this.passRev;
    const sE = this._sideE[ci], sS = this._sideS[ci], sW = ci % CW > 0 ? this._sideE[ci - 1] : null, sN = ci >= CW ? this._sideS[ci - CW] : null;
    this.tempBlock = this.i(x, y);
    this.markDirty(x, y);
    try { return fn(); } finally {
      this.tempBlock = -1;
      this.markDirty(x, y);
      this.passRev = passRev; // walkability is as it was
      if (!this._dirtyAll && this._dirtyChunks?.size === 1 && this._dirtyChunks.has(ci) && this._labels.length === CW * this.CH) {
        for (let yy = cy0; yy < cy1; yy++) this.region.set(rows.subarray((yy - cy0) * cw, (yy - cy0 + 1) * cw), yy * W + cx0);
        this._labels[ci] = labels;
        this._sideE[ci] = sE; this._sideS[ci] = sS;
        if (sW) this._sideE[ci - 1] = sW;
        if (sN) this._sideS[ci - CW] = sN;
        this._base = base; this._canon = canon;
        this._dirtyChunks.clear();
        this.regionsDirty = false;
      }
    }
  }
  /** Exact shortcut for wouldTrapFor: when the tile is no settlement centre, nobody stands on it, its walkable
   *  neighbours (4-way, as the areas are) are still one area with it blocked, and every building site touching
   *  it can still be reached from its own centre, then every route through it can go round it, so nobody and
   *  nothing (farther away) can be cut off. Otherwise the full check runs. */
  cutsNothing(x, y) {
    // Someone (or a centre) on the tile, or on a blocked tile next to it: their area is read from a walkable
    // neighbour (regionOf), which may be this tile, so leave those cases to the full check.
    const close = (p) => { const d = Math.abs(p.x - x) + Math.abs(p.y - y); return d === 0 || (d === 1 && !this.isPassable(p.x, p.y)); };
    for (const c of Object.values(this.s.colonists)) if (close(c)) return false;
    for (const st of Object.values(this.s.settlements)) if (close(st.center || this.s.center)) return false;
    // Building sites touching the tile (it may be the only way to stand next to them): reachable now?
    const near = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const b = this.inB(x + dx, y + dy) ? this.structAt(x + dx, y + dy) : null;
      if (!b || b.built) continue;
      const c = this.s.settlements[b.settlement || this.s.playerSettlement]?.center || this.s.center;
      if (this.reachableFrom(c.x, c.y, b.x, b.y, 'adj')) near.push([b, c]);
    }
    let one = true;
    this.probeBlocked(x, y, () => {
      this.ensureRegions();
      let r0 = null;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!this.inB(nx, ny) || !this.isPassable(nx, ny)) continue;
        const r = this.regionAt(this.i(nx, ny));
        if (r0 === null) r0 = r; else if (r !== r0) { one = false; break; }
      }
      if (one) for (const [b, c] of near) if (!this.reachableFrom(c.x, c.y, b.x, b.y, 'adj')) { one = false; break; }
    });
    return one;
  }
  wouldTrapFull(x, y) {
    const P = this.s.playerSettlement;
    const centre = (k) => this.s.settlements[k]?.center || this.s.center;
    const homes = new Map();
    const homeOf = (k) => { if (!homes.has(k)) { const c = centre(k); homes.set(k, this.regionOf(c.x, c.y)); } return homes.get(k); };
    // Only what is connected through the tile's own area can be cut off by blocking it (other areas do not
    // change), so the rest is left out of the check after the block.
    this.ensureRegions();
    const R = this.regionAt(this.i(x, y));
    const touches = (k) => R < 0 || homeOf(k) === R;
    const cols = Object.values(this.s.colonists).filter((c) => { const k = c.settlementId || P; return touches(k) && this.regionOf(c.x, c.y) === homeOf(k); });
    const sites = this.unbuiltStructs().filter((st) => { if (st.built || (st.x === x && st.y === y)) return false; const k = st.settlement || P; if (!touches(k)) return false; const c = centre(k); return this.reachableFrom(c.x, c.y, st.x, st.y, 'adj'); });
    let trapped = false;
    this.probeBlocked(x, y, () => {
      homes.clear();
      for (const c of cols) if (this.regionOf(c.x, c.y) !== homeOf(c.settlementId || P)) { trapped = true; break; }
      if (!trapped) for (const st of sites) { const c = centre(st.settlement || P); if (!this.reachableFrom(c.x, c.y, st.x, st.y, 'adj')) { trapped = true; break; } }
    });
    return trapped;
  }

  // ---------- entity add/remove (keep indexes in sync) ----------
  addNode(defId, x, y) {
    const id = this.newId('n');
    this.s.nodes[id] = { id, def: defId, x, y, chunks: this.reg.get('node', defId).chunks };
    this.setNodeId(this.i(x, y), id); this.markDirty(x, y);
    this.indexNode(this.s.nodes[id]);
    this.nodesByDefChange(this.s.nodes[id], true);
    return this.s.nodes[id];
  }
  /** A node was added or removed: bump nodeRev, and keep a current nodesByDef map current. Each kind keeps an
   *  insertion-ordered Set of its nodes (s.nodes order: new nodes go last, removals keep the rest in order);
   *  the kind's list is rebuilt from it on the next nodesByDef() call, not on every change, so gathering in a
   *  world of 100k trees copies nothing per node. Lists already handed out are never changed. Kinds enter and
   *  leave the map's key order exactly as a copy-per-change would have them. */
  nodesByDefChange(n, added) {
    const cur = this._nbd && this._nbd.rev === (this.nodeRev || 0);
    this.nodeRev = (this.nodeRev || 0) + 1;
    if (!cur) return;
    const N = this._nbd;
    let set = N.sets.get(n.def);
    if (!set) { // a kind's Set is made on its first change
      const a = N.map.get(n.def);
      if (!a && !added) { N.rev = this.nodeRev; return; }
      N.sets.set(n.def, (set = new Set(a || NONE)));
      if (!a) N.map.set(n.def, NONE); // a new kind goes last in the map, as before
    }
    if (added) {
      set.add(n);
      N.stale.add(n.def);
    } else if (set.delete(n)) {
      if (set.size) N.stale.add(n.def);
      else { N.sets.delete(n.def); N.map.delete(n.def); N.stale.delete(n.def); }
    }
    N.rev = this.nodeRev;
  }
  /** Resource nodes grouped by definition, each list in the same order as s.nodes (rebuilt when nodes change
   *  outside addNode/removeNode; kinds that changed are re-listed on the next call). */
  nodesByDef() {
    const N = this._nbd;
    if (N && N.rev === (this.nodeRev || 0)) {
      if (N.stale.size) { for (const d of N.stale) N.map.set(d, [...N.sets.get(d)]); N.stale.clear(); }
      return N.map;
    }
    const map = new Map();
    for (const n of Object.values(this.s.nodes)) { let a = map.get(n.def); if (!a) map.set(n.def, (a = [])); a.push(n); }
    this._nbd = { rev: this.nodeRev || 0, map, sets: new Map(), stale: new Set() };
    return map;
  }
  /** Picked plants waiting to regrow (derived, never saved): built with the indexes, kept by nodeEmptied,
   *  removeNode and tickFarming, so regrowth does not walk every node of the world. */
  emptyNodes() {
    if (!this._empty) { this._empty = new Map(); for (const n of Object.values(this.s.nodes)) if (n.empty) this._empty.set(n.id, n); }
    return this._empty;
  }
  nodeEmptied(n) { n.empty = true; n.regrow = 0; this._empty?.set(n.id, n); }
  removeNode(id) {
    const n = this.s.nodes[id]; if (!n) return;
    delete this.s.nodes[id];
    this._empty?.delete(id);
    this.unindexNode(n);
    if (this.nodeIdAt(this.i(n.x, n.y)) === id) this.setNodeId(this.i(n.x, n.y), null);
    this.markDirty(n.x, n.y);
    this.nodesByDefChange(n, false);
  }
  addStructure(defId, x, y, extra = {}) {
    const id = this.newId('b');
    this.s.structures[id] = { id, def: defId, x, y, built: false, progress: 0, delivered: {}, ...extra };
    this.setStructId(this.i(x, y), id);
    this.ownAdd('structures', this.s.structures[id]); this.structRev = (this.structRev || 0) + 1; this.structsChanged(this.s.structures[id], true);
    return this.s.structures[id];
  }
  removeStructure(id) {
    const st = this.s.structures[id]; if (!st) return;
    delete this.s.structures[id];
    this.ownDel('structures', st); this.structRev = (this.structRev || 0) + 1; this.structsChanged(st, false);
    if (this.structIdAt(this.i(st.x, st.y)) === id) this.setStructId(this.i(st.x, st.y), null);
    this.markDirty(st.x, st.y);
  }
  addCrop(defId, x, y, fieldId) {
    const id = this.newId('p');
    this.s.crops[id] = { id, def: defId, x, y, growth: 0, fieldId };
    this.setCropId(this.i(x, y), id);
    return this.s.crops[id];
  }
  removeCrop(id) {
    const c = this.s.crops[id]; if (!c) return;
    delete this.s.crops[id];
    if (this.cropIdAt(this.i(c.x, c.y)) === id) this.setCropId(this.i(c.x, c.y), null);
  }

  // ---------- items ----------
  ledgerAdd(kind, item, qty, reason) {
    const L = this.s.ledger;
    L[kind][item] = (L[kind][item] || 0) + qty;
    const k = `${kind}:${reason}`;
    L.byReason[k] ||= {};
    L.byReason[k][item] = (L.byReason[k][item] || 0) + qty;
  }
  /** Items come into existence ONLY through this (start, gather, harvest, craft). */
  createItems(item, qty, x, y, reason, dur, preferStockpile = false) {
    if (qty <= 0) return;
    if (!this.reg.get('item', item)) throw new Error(`createItems: unknown item "${item}" (is its mod enabled?)`);
    this.ledgerAdd('created', item, qty, reason);
    this.placeItems(item, qty, x, y, dur, preferStockpile);
  }
  /** Items leave existence ONLY through this (construct, craft, eat, sow, wear). The caller removes them first. */
  consume(item, qty, reason) { if (qty > 0) this.ledgerAdd('consumed', item, qty, reason); }

  canHoldItems(x, y, strict) {
    if (!this.inB(x, y) || !this.isPassable(x, y)) return false;
    const i = this.i(x, y);
    if (this.footIdAt(i)) return false;
    if (this.structIdAt(i)) return false;
    if (strict && this.zoneAt(i) && !this.zoneAt(i).startsWith('S:')) return false;
    return true;
  }
  stackRoom(st, item, dur) {
    if (st.item !== item || dur !== undefined || st.dur !== undefined) return 0;
    if ((st.settlement || this.s.playerSettlement) !== this.currentOwner()) return 0; // never mix settlements' goods
    const lim = this.reg.get('item', item)?.stackLimit ?? 1;
    return Math.max(0, lim - st.qty);
  }
  /** Moves items onto the map near (x, y), merging into stacks. Never creates or destroys. */
  placeItems(item, qty, x, y, dur, preferStockpile = false) {
    const left = this.placeOnMap(item, qty, x, y, dur, preferStockpile);
    if (left > 0) this.holdOverflow(item, left, x, y, dur);
  }
  /** Items that fit nowhere on the map are held (counted, shown in the UI) until space frees up. Never discarded. */
  holdOverflow(item, qty, x, y, dur) {
    (this.s.overflow ||= []).push({ item, qty, x, y, settlement: this.currentOwner() || undefined, ...(dur !== undefined ? { dur } : {}), since: this.s.tick });
    this.log(`No free ground for ${qty} ${this.reg.get('item', item)?.name || item}; holding it until space frees up.`, 'warn', 'overflow:' + item, 600);
  }
  retryOverflow() {
    const list = this.s.overflow;
    if (!list?.length) return;
    this.s.overflow = [];
    for (const o of list) {
      this.actor = o.settlement || null;
      const left = this.placeOnMap(o.item, o.qty, o.x, o.y, o.dur);
      this.actor = null;
      if (left > 0) this.s.overflow.push({ ...o, qty: left });
    }
  }
  /** Put items on the map; returns how many could not be placed anywhere. */
  placeOnMap(item, qty, x, y, dur, preferStockpile = false) {
    this._holds?.clear(); // (never inside readOnly; if it were, the trade holds are worked out afresh)
    const def = this.reg.get('item', item);
    const lim = def?.stackLimit ?? 1;
    let left = qty;
    const tryTile = (tx, ty) => {
      const st = this.stackAt(tx, ty);
      if (st) {
        const room = this.stackRoom(st, item, dur);
        if (room > 0) { const put = Math.min(room, left); st.qty += put; left -= put; }
      } else {
        const put = Math.min(lim, left);
        this.addStack(item, put, tx, ty, dur);
        left -= put;
      }
    };
    if (preferStockpile) {
      for (const k of this.stockpileOf(this.currentOwner())) {
        if (left <= 0) break;
        const [tx, ty] = k.split(',').map(Number);
        if (this.canHoldItems(tx, ty, false)) tryTile(tx, ty);
      }
    }
    for (const pass of [true, false]) {
      for (const [tx, ty] of rings(x, y, pass ? 6 : 20)) {
        if (left <= 0) return 0;
        if (!this.inB(tx, ty) || !this.canHoldItems(tx, ty, pass)) continue;
        tryTile(tx, ty);
      }
    }
    // Last resorts: anywhere passable, then passable tiles under unbuilt blueprints (they get hauled off).
    for (const allowSites of [false, true]) {
      for (let ty = 0; ty < this.H && left > 0; ty++) for (let tx = 0; tx < this.W && left > 0; tx++) {
        if (!this.isPassable(tx, ty)) continue;
        const sid = this.structIdAt(this.i(tx, ty));
        if (sid && (!allowSites || this.s.structures[sid]?.built)) continue;
        tryTile(tx, ty);
      }
    }
    return left;
  }
  /** Policy for one settlement: the AI profile's policy with that settlement's personality overrides. */
  policyFor(sid) {
    const o = this.s.settlements?.[sid]?.policy;
    return o ? { ...this.policy, ...o, stock: { ...(this.policy.stock || {}), ...(o.stock || {}) } } : this.policy;
  }
  /** Territory: land and wild resources belong to the settlement whose centre is nearest, or, in organic
   *  games (territory.js), to the settlement that has claimed the tile (null: nobody's). */
  territoryAt(x, y) {
    if (this._cl) { if (!this.inB(x, y)) return null; const k = this._cl.grid[y * this.W + x]; return k === 0xffff ? null : this.s.claims.ids[k]; }
    if (this.inB(x, y)) { const T = this.territoryGrid(); const k = T.grid[y * this.W + x]; return k === 0xffff ? null : T.ids[k]; }
    return this.territoryScan(x, y);
  }
  /** The nearest-centre owner of every tile (same answer and tie-break as territoryScan), rebuilt only when
   *  the settlements or their centres change (checked once per tick; derived, never saved). */
  territoryGrid() {
    if (this._cl) return claimTerritory(this); // organic: the claim grid, same shape (sig changes with every claim)
    const t = this._terr;
    if (t && t.tick === this.s.tick) return t;
    const list = Object.values(this.s.settlements || {});
    const sig = list.map((st) => `${st.id}:${(st.center || this.s.center)?.x},${(st.center || this.s.center)?.y}`).join('|');
    if (t && t.sig === sig) { t.tick = this.s.tick; return t; }
    const ids = list.map((st) => st.id), W = this.W, H = this.H;
    const grid = new Uint16Array(W * H).fill(0xffff);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let best = -1, bd = Infinity;
      for (let k = 0; k < list.length; k++) {
        const c = list[k].center || this.s.center;
        const d = (c.x - x) ** 2 + (c.y - y) ** 2;
        if (d < bd || (d === bd && list[k].id < ids[best])) { bd = d; best = k; }
      }
      if (best >= 0) grid[y * W + x] = best;
    }
    this._terr = { tick: this.s.tick, sig, ids, grid };
    return this._terr;
  }
  /** Drop the cached territory (a settlement was founded or moved within this tick). */
  territoryChanged() { this._terr = null; }
  /** A settlement `sid` was just added (the last in s.settlements) with nothing else changed since the grid
   *  was last current: give it the tiles it now owns without rebuilding the map. Same answers and tie-break
   *  as territoryGrid: the new centre wins a tile when (distance², id) is smaller than for every other
   *  centre. For each row that is an exact interval of x (one linear inequality per other centre), so the
   *  cost is O(H x S) plus the new territory's area. If the cache is not current, it is dropped instead
   *  (the next use rebuilds it). Derived, never saved: a loaded game rebuilds the same grid. */
  territoryAdded(sid) {
    if (this._cl) { claimsAdded(this, sid); return; } // organic: the new village claims its first land now
    const T = this._terr, list = Object.values(this.s.settlements || {});
    const ctr = (st) => st.center || this.s.center;
    const part = (st) => `${st.id}:${ctr(st)?.x},${ctr(st)?.y}`;
    const nw = list[list.length - 1];
    if (!T || !nw || nw.id !== sid || T.ids.length !== list.length - 1 || list.length > 0xffff
      || T.sig !== list.slice(0, -1).map(part).join('|')) { this._terr = null; return; }
    const W = this.W, H = this.H, k = T.ids.length, c = ctr(nw);
    const others = list.slice(0, -1).map((st) => ({ x: ctr(st).x, y: ctr(st).y, strict: !(sid < st.id) }));
    for (let y = 0; y < H; y++) {
      // New wins at (x, y) against centre o: dn < do, or dn == do when sid sorts first. Expanded, dn - do =
      // a*x + b with a = 2(o.x - c.x), b = c.x² - o.x² + (c.y - y)² - (o.y - y)²: all whole numbers.
      let lo = 0, hi = W - 1;
      for (const o of others) {
        const a = 2 * (o.x - c.x), b = c.x * c.x - o.x * o.x + (c.y - y) ** 2 - (o.y - y) ** 2;
        if (a === 0) { if (o.strict ? b >= 0 : b > 0) { lo = 1; hi = 0; break; } continue; }
        // a*x + b < 0 (strict) or <= 0.
        const q = -b / a;
        if (a > 0) hi = Math.min(hi, o.strict ? Math.ceil(q) - 1 : Math.floor(q));
        else lo = Math.max(lo, o.strict ? Math.floor(q) + 1 : Math.ceil(q));
        if (lo > hi) break;
      }
      for (let x = lo; x <= hi; x++) T.grid[y * W + x] = k;
    }
    T.ids.push(sid);
    T.sig = list.map(part).join('|');
    T.tick = this.s.tick;
  }
  territoryScan(x, y) {
    let best = null, bd = Infinity;
    for (const st of Object.values(this.s.settlements || {})) {
      const c = st.center || this.s.center;
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bd || (d === bd && st.id < best)) { bd = d; best = st.id; }
    }
    return best;
  }
  /** Passable tiles next to drinkable terrain (lake shores), cached until the map changes. */
  drinkSpots() {
    const key = this.s.map.rev || 0;
    if (this._drinkKey === key && this._drink) return this._drink;
    const out = [];
    for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) {
      if (!this.terrainAt(x, y).passable) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.inB(x + dx, y + dy) && this.terrainAt(x + dx, y + dy).drinkable)) out.push({ x, y });
    }
    this._drink = out; this._drinkKey = key;
    return out;
  }
  /** Walking distance over terrain from every tile to the nearest lake shore (drinkSpots), and which shore:
   *  { dist, from } (path.js terrainDistanceField). Derived from the saved terrain only, so it is cached per
   *  map revision and never saved; built on first use (one Dijkstra over the map). */
  waterWalk() {
    const key = this.s.map.rev || 0;
    if (this._waterWalk?.key === key) return this._waterWalk;
    const src = this.drinkSpots().map((p) => this.i(p.x, p.y));
    const f = terrainDistanceField(this, src);
    const shore = new Uint8Array(this.W * this.H);
    for (const i of src) shore[i] = 1;
    this._waterWalk = { key, dist: f.dist, from: f.from, passT: f.passT, costT: f.costT, shore };
    return this._waterWalk;
  }
  /** Big worlds: the lake shore nearest on foot from (x,y) that can be stood on and reached from there now
   *  (the field's nearest, or, if a tree, boulder or wall is in the way, the next nearest by a search guided
   *  by the field). { x, y, walk } or null. */
  shoreOnFoot(x, y) {
    if (!this.inB(x, y)) return null;
    const ww = this.waterWalk(), i = this.i(x, y), f = ww.from[i];
    if (f < 0) return null;
    const ok = (j) => { const jx = j % this.W, jy = (j / this.W) | 0; return this.isPassable(jx, jy) && this.reachableFrom(x, y, jx, jy, 'on'); };
    if (ok(f)) return { x: f % this.W, y: (f / this.W) | 0, walk: ww.dist[i] };
    const r = nearestOnField(this, ww, x, y, (j) => ww.shore[j] === 1 && ok(j));
    return r ? { x: r.i % this.W, y: (r.i / this.W) | 0, walk: r.d } : null;
  }
  /** Big worlds: drinking water on foot from (x,y), the same answer at full detail and abstract.
   *  { walk: tiles' walk to the nearest shore over terrain, reachable: a shore within WATER_REACH_WALK that
   *  can be reached now }. If the nearest shore is cut off (own walls, buildings), any shore within that
   *  distance in a straight line that can be reached counts instead. */
  waterOnFoot(x, y) {
    if (!this.inB(x, y)) return { walk: Infinity, reachable: false };
    const walk = this.waterWalk().dist[this.i(x, y)];
    if (!(walk < WATER_REACH_WALK)) return { walk, reachable: false };
    const sh = this.shoreOnFoot(x, y);
    if (sh) return { walk: sh.walk, reachable: sh.walk < WATER_REACH_WALK };
    const r2 = WATER_REACH_WALK * WATER_REACH_WALK;
    for (const p of this.drinkSpots()) if ((p.x - x) ** 2 + (p.y - y) ** 2 < r2 && this.reachableFrom(x, y, p.x, p.y, 'on')) return { walk, reachable: true };
    return { walk, reachable: false };
  }
  /** Big worlds: build the derived caches that are never saved (walkable areas, rooms, territory grid,
   *  nodes by definition, picked plants, lake shores and the walk-to-water field) now, at creation and load, so no tick
   *  pays for them (the walk-to-water field alone is a Dijkstra over the whole map). Each is a pure function
   *  of the saved state, reads no randomness and is rebuilt the same way it would be on first use, so the
   *  run is unchanged. */
  warmCaches() {
    this.ensureRegions();
    rooms(this);
    this.territoryGrid();
    warmClaims(this); // organic territory: the claim frontiers (a rebuild after loading)
    if (this.s.contact) landChunks(this); // contact: land chunks and landmasses for the explorers' routes
    this.nodesByDef();
    this.emptyNodes(); // picked plants (the first scan of every node would otherwise land in a tick)
    this.waterWalk();
  }
  /** Contact (contact.js): owner pairs whose lands became adjacent in the daily growth (called by growClaims). */
  bordersTouched(pairs) { bordersTouched(this, pairs); }
  /** Explorers, traders and caravans on the way, with their positions (contact.js travellers; read-only). */
  travellers() { return travellers(this); }
  /** A new trade's deadline (villages.js): `base`, or in contact games long enough for a caravan to a far village. */
  tradeDeadline(seller, buyer, base) { return tradeDeadline(this, seller, buyer, base); }
  /** Are two villages' centres on the same landmass (contact.js land chunks; markets.js landReach)? */
  sameLandmass(a, b) { return sameLandmass(this, a, b); }
  landmassOf(sid) { return landmassOf(this, sid); }
  /** A settlement's land for the village card (territory.js landInfo; read-only). */
  landInfo(sid) { return landInfo(this, sid); }
  /** For the map overlay: the box of tiles whose owner changed since claim revision `rev` (territory.js). */
  claimsDirtySince(rev) { return claimsDirtySince(this, rev); }
  claimOk(sid, x, y) {
    if (this._cl) return claimOkOrganic(this, sid, x, y); // organic: own land, or unclaimed within reach of it
    const t = this.territoryAt(x, y); return !t || t === sid;
  }
  /** May settlement sid gather this resource node? On its own land, or on a neighbour's land where that
   *  neighbour granted gathering rights for this kind of node (within reach of sid's centre). */
  gatherOk(sid, node) {
    const t = this.territoryAt(node.x, node.y);
    if (!t || t === sid) return true;
    const r = this.s.rights?.[t + '>' + sid];
    if (!r || !r.nodes.includes(node.def)) return false;
    const c = this.s.settlements[sid]?.center;
    return !!c && Math.hypot(node.x - c.x, node.y - c.y) <= (r.range || 18);
  }
  /** The settlement that owns items being created or dropped right now. */
  currentOwner() { return this.actor || this.s.playerSettlement; }
  /** Settlement-aware ownership check: can this colonist use/move this entity? */
  mine(e, c) { return !!e && (e.settlement || this.s.playerSettlement) === (c.settlementId || this.s.playerSettlement); }
  /** What to scan for the entities of `coll` (stacks, structures, projects, fields, colonists) that colonist c
   *  may use (g.mine): on big worlds only its settlement's own (ownership index: the same entities in the same
   *  order as Object.values filtered by mine); on classic worlds every one, as before. Callers keep their mine
   *  test. */
  mineList(coll, c) {
    if (!this.big) return Object.values(this.s[coll]);
    const m = this.ownIndex(coll).get(c.settlementId || this.s.playerSettlement);
    return m ? [...m.values()] : NONE; // a snapshot, like Object.values
  }
  /** Each settlement plans separately; jobs read their own settlement's plan. */
  planOf(c) { return this.plans?.[c?.settlementId] || this.plan; }
  researchSummary(sid) { return researchSummary(this, sid || this.s.playerSettlement); }
  addStack(item, qty, x, y, dur) {
    this._holds?.clear();
    const id = this.newId('s');
    const st = { id, item, qty, x, y, settlement: this.currentOwner() || undefined }; // no owner yet (a world with no people): none
    if (dur !== undefined) st.dur = dur;
    this.s.stacks[id] = st;
    this.setStackId(this.i(x, y), id);
    this.ownAdd('stacks', st);
    return st;
  }
  /** Take up to qty from a stack; returns {item, qty, dur?}. */
  takeFromStack(id, qty) {
    this._holds?.clear();
    const st = this.s.stacks[id];
    if (!st) return null;
    const q = Math.min(qty, st.qty);
    st.qty -= q;
    const out = { item: st.item, qty: q };
    if (st.dur !== undefined) out.dur = st.dur;
    if (st.qty <= 0) {
      delete this.s.stacks[id];
      this.ownDel('stacks', st);
      if (this.stackIdAt(this.i(st.x, st.y)) === id) this.setStackId(this.i(st.x, st.y), null);
    }
    return out;
  }
  carryLimit(item) { return Math.min(CARRY_LIMIT, this.reg.get('item', item)?.stackLimit ?? 1); }

  /** Every item instance that exists, wherever it is. Used for conservation checks and the UI. */
  census() {
    const c = {};
    const add = (it, q) => { if (q) c[it] = (c[it] || 0) + q; };
    for (const st of Object.values(this.s.stacks)) add(st.item, st.qty);
    for (const col of Object.values(this.s.colonists)) {
      if (col.carry) add(col.carry.item, col.carry.qty);
      if (col.equip.tool) add(col.equip.tool.item, 1);
      if (col.equip.weapon) add(col.equip.weapon.item, 1);
      if (col.ammo) add(col.ammo.item, col.ammo.qty);
    }
    for (const st of Object.values(this.s.structures)) {
      for (const [it, q] of Object.entries(st.delivered || {})) add(it, q);
      for (const [it, q] of Object.entries(st.reno?.delivered || {})) add(it, q);
      for (const b of st.buffer || []) add(b.item, b.qty);
      for (const f of st.fuel || []) add(f.item, f.qty);
    }
    for (const o of this.s.overflow || []) add(o.item, o.qty);
    for (const cv of Object.values(this.s.caravans || {})) add(cv.item, cv.qty); // goods on the road (lod.js)
    // Items inside content set aside because its mod is missing still exist.
    for (const o of this.s.orphans || []) {
      if (o.kind === 'stack') add(o.data.item, o.data.qty);
      else if (o.kind === 'equip') add(o.data.item, 1);
      else if (o.kind === 'delivered') add(o.item, o.qty);
      else if (o.kind === 'structure') {
        for (const [it, q] of Object.entries(o.data.delivered || {})) add(it, q);
        for (const [it, q] of Object.entries(o.data.reno?.delivered || {})) add(it, q);
        for (const b of o.data.buffer || []) add(b.item, b.qty);
        for (const f of o.data.fuel || []) add(f.item, f.qty);
      }
    }
    return c;
  }

  // ---------- content set aside by save/load (missing mods) ----------
  /** Restore set-aside content whose definitions exist again, only onto valid free positions. */
  restoreOrphans() {
    const s = this.s;
    if (!s.orphans?.length) return 0;
    const keep = [];
    let restored = 0;
    for (const o of s.orphans) {
      let r;
      try { r = this.tryRestore(o); } catch (e) { r = 'error: ' + e.message; }
      if (r === true) restored++;
      else { if (typeof r === 'string') o.waiting = r; keep.push(o); }
    }
    s.orphans = keep;
    if (restored) {
      this.markDirty();
      this.log(`Restored ${restored} saved object(s) whose content is available again.${keep.length ? ` ${keep.length} still waiting.` : ''}`, 'info');
    }
    return restored;
  }
  /** true = restored; string = definition exists but no valid spot yet (kept); false = definition missing. */
  tryRestore(o) {
    const s = this.s, reg = this.reg, d = o.data;
    const at = (x, y) => (this.inB(x, y) ? this.i(x, y) : -1);
    const occupiedForSolid = (i, x, y) => this.stackIdAt(i) || this.colonistAt(x, y);
    switch (o.kind) {
      case 'node': {
        const def = reg.get('node', d.def); if (!def) return false;
        const i = at(d.x, d.y); if (i < 0) return 'outside the map';
        if (this.nodeIdAt(i) || this.structIdAt(i)) return 'its tile is occupied';
        if (!this.terrainAt(d.x, d.y).passable) return 'its tile is not walkable ground any more';
        if (!def.passable && occupiedForSolid(i, d.x, d.y)) return 'its tile is occupied';
        if (!def.passable && this.wouldTrap(d.x, d.y, this.big ? s.playerSettlement : null)) return 'restoring it now would block a path'; // big worlds: the local check (wouldTrapFor)
        s.nodes[d.id] = d; this.setNodeId(i, d.id); if (d.empty) this._empty?.set(d.id, d); this.indexNode(d); this.nodesByDefChange(d, true); return true;
      }
      case 'structure': {
        const def = reg.get('building', d.def); if (!def) return false;
        const i = at(d.x, d.y); if (i < 0) return 'outside the map';
        if (this.structIdAt(i) || this.nodeIdAt(i)) return 'its tile is occupied';
        if (!def.passable && d.built && occupiedForSolid(i, d.x, d.y)) return 'its tile is occupied';
        if (!def.passable && d.built && this.wouldTrap(d.x, d.y, this.big ? (d.settlement || s.playerSettlement) : null)) return 'restoring it now would block a path';
        s.structures[d.id] = d; this.setStructId(i, d.id); this.ownAdd('structures', d); this.structRev = (this.structRev || 0) + 1; this.structsChanged(d, true);
        const p = s.projects[d.projectId];
        if (p && !p.parts.includes(d.id)) p.parts.push(d.id);
        return true;
      }
      case 'stack': {
        if (!reg.has('item', d.item)) return false;
        const prevActor = this.actor;
        if (o.owner && s.settlements?.[o.owner]) this.actor = o.owner; // goods set aside from a caravan stay the seller's
        let left;
        try { left = this.placeOnMap(d.item, d.qty, d.x ?? s.center.x, d.y ?? s.center.y, d.dur); } finally { this.actor = prevActor; }
        if (left > 0) { d.qty = left; return 'no free ground for it yet'; }
        return true;
      }
      case 'crop': {
        if (!reg.has('crop', d.def)) return false;
        const i = at(d.x, d.y); if (i < 0) return 'outside the map';
        if (this.cropIdAt(i) || this.nodeIdAt(i) || this.structIdAt(i)) return 'its tile is occupied';
        s.crops[d.id] = d; this.setCropId(i, d.id); return true;
      }
      case 'field': {
        if (!reg.has('crop', d.crop)) return false;
        for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) {
          const i = at(x, y); if (i < 0) return 'outside the map';
          if (this.zoneAt(i) || this.footIdAt(i) || this.structIdAt(i)) return 'its area is now used for something else';
        }
        s.fields[d.id] = d; this.ownAdd('fields', d);
        for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) this.setZone(this.i(x, y), d.id);
        return true;
      }
      case 'terrain': {
        const t = reg.get('terrain', o.id); if (!t) return false;
        const x = o.i % this.W, y = Math.floor(o.i / this.W);
        if (!t.passable && (this.structIdAt(o.i) || this.nodeIdAt(o.i) || this.stackIdAt(o.i) || this.cropIdAt(o.i) || this.colonistAt(x, y))) return 'something stands on that tile';
        this._ts.set(o.i, o.id); s.map.rev = (s.map.rev || 0) + 1; this.tileChanged(x, y); return true;
      }
      case 'equip': {
        if (!reg.has('item', d.item)) return false;
        const c = s.colonists[o.cid];
        if (c && !c.equip[o.slot]) { c.equip[o.slot] = d; return true; }
        // Slot taken (or owner gone): put the item on the ground instead of losing it (where a dead owner died, as
        // their village's: death.js).
        const dead = !c && s.dead?.[o.cid];
        const p = c || dead || { x: s.center.x, y: s.center.y };
        const prevActor = this.actor;
        if (dead) this.actor = dead.settlementId;
        let left;
        try { left = this.placeOnMap(d.item, 1, p.x, p.y, d.dur); } finally { this.actor = prevActor; }
        return left > 0 ? 'no free ground for it yet' : true;
      }
      case 'delivered': {
        if (!reg.has('item', o.item)) return false;
        const st = s.structures[o.sid];
        if (st && !st.built && reg.get('building', st.def)?.cost.some((k) => k.item === o.item)) { st.delivered[o.item] = (st.delivered[o.item] || 0) + o.qty; return true; }
        const left = this.placeOnMap(o.item, o.qty, st?.x ?? o.x ?? s.center.x, st?.y ?? o.y ?? s.center.y);
        if (left > 0) { o.qty = left; return 'no free ground for it yet'; }
        return true;
      }
      default: return 'unknown kind "' + o.kind + '"';
    }
  }
  /** Items in stacks on the map (what the colony "has" to use), minus nothing. */
  stockTotals() {
    const t = {};
    for (const st of Object.values(this.s.stacks)) t[st.item] = (t[st.item] || 0) + st.qty;
    return t;
  }
  stacksByItem() {
    if (this._sbiTick === this.s.tick && this._sbi) return this._sbi;
    const m = new Map();
    for (const st of Object.values(this.s.stacks)) { if (!m.has(st.item)) m.set(st.item, []); m.get(st.item).push(st); }
    this._sbi = m; this._sbiTick = this.s.tick;
    return m;
  }

  // ---------- reservations ----------
  // A job records everything it reserved in job.res so it can be released or re-applied after loading.
  isReserved(key, byId) { const r = this.excl.get(key); return r !== undefined && r !== byId; }
  reserveExcl(job, key, cid) {
    const cur = this.excl.get(key);
    if (cur !== undefined && cur !== cid) return false;
    this.excl.set(key, cid);
    job.res.push({ k: 'x', key });
    return true;
  }
  reservedQty(stackId) { return this.qtyRes.get(stackId) || 0; }
  /** Free units of a stack. Goods promised to an active trade are held back for its delivery jobs
   *  (forTrade = true) and hidden from everything else: cooking, eating, building, crafting, offers. */
  availQty(stackId, forTrade = false) {
    const st = this.s.stacks[stackId];
    if (!st) return 0;
    return st.qty - this.reservedQty(stackId) - (forTrade ? 0 : this.tradeHeld(stackId));
  }
  /** Active trades, cached per tick (trades only start between ticks or in the villages step). */
  activeTrades() {
    // Contact games (many villages, many finished trades kept in s.trades): the cache follows the trades added
    // through tradeAdded() instead of counting every trade on each call (which cost O(trades) per stack checked).
    // Other games keep the original key exactly.
    const key = this.s.contact ? this.s.tick + ':' + (this._tradeAdds || 0) : this.s.tick + '|' + Object.keys(this.s.trades || {}).length;
    if (this._atKey === key) return this._at;
    this._at = Object.values(this.s.trades || {}).filter((t) => t.status === 'active');
    this._atKey = key;
    return this._at;
  }
  /** A trade is about to be added to s.trades (villages.js, founding.js): the active-trade cache is stale. */
  tradeAdded() { this._tradeAdds = (this._tradeAdds || 0) + 1; this._holds?.clear(); }
  /** Units of an item a settlement still has to hand over (not yet picked up by a delivery job). */
  promisedQty(sid, item) {
    let n = 0;
    for (const t of this.activeTrades()) {
      if (t.status !== 'active') continue;
      t.legs.forEach((l, k) => { if (l.from === sid && l.item === item) n += Math.max(0, legRemaining(this, t, k).remaining); });
    }
    return n;
  }
  /** How many units of this stack are held for trades. Promised amounts are spread over the owner's
   *  stacks of that item in id order, so the result is derived from state alone (nothing is saved). */
  /** Can this stack go into a trade? Goods without wear, and tools or weapons still unused (full condition). */
  tradeable(st) {
    if (st.dur === undefined) return true;
    const full = this.reg.get('item', st.item)?.equipment?.durability;
    return full !== undefined && st.dur >= full;
  }
  tradeHeld(stackId) {
    const st = this.s.stacks[stackId];
    if (!st || !this.tradeable(st) || !this.activeTrades().length) return 0;
    const sid = st.settlement || this.s.playerSettlement;
    if (this._holds) { // inside readOnly(): the holds of this settlement's stacks of the item, worked out once
      const key = sid + '|' + st.item;
      let m = this._holds.get(key);
      if (!m) this._holds.set(key, (m = this.holdsOf(sid, st.item)));
      const h = m.by.get(stackId);
      if (h !== undefined) return h;
      return m.left <= 0 ? 0 : Math.min(Math.max(0, st.qty - this.reservedQty(stackId)), m.left);
    }
    let left = this.promisedQty(sid, st.item);
    if (left <= 0) return 0;
    const own = (this.stacksByItem().get(st.item) || [])
      .filter((x) => this.s.stacks[x.id] === x && this.tradeable(x) && (x.settlement || this.s.playerSettlement) === sid)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const x of own) {
      const h = Math.min(Math.max(0, x.qty - this.reservedQty(x.id)), left);
      if (x.id === stackId) return h;
      left -= h;
      if (left <= 0) return 0;
    }
    return Math.min(Math.max(0, st.qty - this.reservedQty(stackId)), left); // a stack made earlier this tick
  }
  /** tradeHeld for every stack of a settlement's item at once, in the same id order and with the same
   *  arithmetic: { by: stack id -> units held, left: what is still promised past them all }. */
  holdsOf(sid, item) {
    const by = new Map();
    let left = this.promisedQty(sid, item);
    const own = (this.stacksByItem().get(item) || [])
      .filter((x) => this.s.stacks[x.id] === x && this.tradeable(x) && (x.settlement || this.s.playerSettlement) === sid)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const x of own) {
      if (left <= 0) { by.set(x.id, 0); continue; }
      const h = Math.min(Math.max(0, x.qty - this.reservedQty(x.id)), left);
      by.set(x.id, h);
      left -= h;
    }
    return { by, left };
  }
  /** Run fn as a read-only stretch (the job givers' search for work, food, ingredients): nothing in it changes
   *  stacks, reservations, trades or jobs, so trade holds (tradeHeld, which walks every active trade and every
   *  colonist per call) are worked out once per settlement and item and reused until it ends. The answers are
   *  exactly those of asking each time; only the time differs. Nests. Returns fn's value. */
  readOnly(fn) {
    if (this._holds) return fn();
    this._holds = new Map();
    try { return fn(); } finally { this._holds = null; }
  }
  reserveQty(job, stackId, qty, forTrade = false) {
    if (qty <= 0 || this.availQty(stackId, forTrade) < qty) return false;
    this._holds?.clear(); // (reservations are made outside readOnly; if not, the holds are worked out afresh)
    this.qtyRes.set(stackId, this.reservedQty(stackId) + qty);
    job.res.push({ k: 'q', key: stackId, qty });
    return true;
  }
  incoming(sid, item) { return this.incRes.get(`${sid}|${item}`) || 0; }
  reserveIncoming(job, sid, item, qty) {
    const key = `${sid}|${item}`;
    this.incRes.set(key, this.incoming(sid, item) + qty);
    job.res.push({ k: 'i', key, qty });
    return true;
  }
  releaseOne(r) {
    this._holds?.clear();
    if (r.k === 'x') this.excl.delete(r.key);
    else if (r.k === 'q') { const v = this.reservedQty(r.key) - r.qty; if (v > 0) this.qtyRes.set(r.key, v); else this.qtyRes.delete(r.key); }
    else if (r.k === 'i') { const v = (this.incRes.get(r.key) || 0) - r.qty; if (v > 0) this.incRes.set(r.key, v); else this.incRes.delete(r.key); }
  }
  /** Release reservations of a job that match pred (all when pred omitted). */
  /** Release reservations of a job matching pred (all when omitted); once=true releases only the first match. */
  release(job, pred, once = false) {
    if (!job?.res) return;
    const keep = [];
    let done = false;
    for (const r of job.res) {
      if ((!pred || pred(r)) && !(once && done)) { this.releaseOne(r); done = true; } else keep.push(r);
    }
    job.res = keep;
  }
  /** Re-apply a saved reservation (after load). Returns false if it can no longer be honoured. */
  reapply(job, r, cid) {
    if (r.k === 'x') return this.reserveExcl(job, r.key, cid);
    // A saved reservation was valid when it was made; goods promised to trades since then are held from the
    // stack's other units (tradeHeld leaves reserved units alone), so it is re-applied past the trade holds,
    // as in the running game.
    if (r.k === 'q') return this.reserveQty(job, r.key, r.qty, true);
    if (r.k === 'i') return this.reserveIncoming(job, r.key.split('|')[0], r.key.split('|')[1], r.qty);
    return false;
  }

  blockTarget(key, reason, ticks = BLOCK_COOLDOWN) { if (key) this.s.blocked[key] = { reason, until: this.s.tick + ticks }; }
  isBlocked(key) {
    const b = this.s.blocked[key];
    if (!b) return false;
    if (b.until <= this.s.tick) { delete this.s.blocked[key]; return false; }
    return true;
  }

  // ---------- log ----------
  log(msg, cat = 'info', key = null, cooldown = 600) {
    if (key) {
      const last = this.s.logKeys[key];
      if (last !== undefined && this.s.tick - last < cooldown) return;
      this.s.logKeys[key] = this.s.tick;
    }
    this.s.log.push({ t: this.s.tick, msg, cat });
    if (this.s.log.length > 500) this.s.log.splice(0, this.s.log.length - 500);
  }

  // ---------- main loop ----------
  tick() {
    const s = this.s;
    s.tick++;
    if (s.god) applyCommands(this);
    if (s.disasters) { tickFire(this); if (s.disasters?.storms) tickStorms(this); if (s.disasters?.weather) tickWeather(this); }
    if (s.tick % 100 === 0 && (s.disasters?.seeds || natureRules(this)?.spread)) tickRegrowth(this); // regrowth (regrow.js): nothing without seeds or a spread rule // tornadoes move (storm.js); fires spread and burn out (fire.js, Phase 5b; nothing until a fire starts) // god powers due on this tick, in id order (god.js; nothing until a power is used)
    if (this.big) runPlanner(this, true); // big worlds: each village on its own staggered schedule
    else if (s.tick % PLAN_INTERVAL === 0 || this.planDirty) { this.planDirty = false; runPlanner(this); }
    if (s.tick % 10 === 0) tickFarming(this, 10);
    if (s.tick % 50 === 0 && s.overflow?.length) this.retryOverflow();
    if (s.tick % 600 === 0 && s.orphans?.length) this.restoreOrphans();
    if (s.tick % 50 === 0) tickVillages(this);
    // Daily, at the start of the day, right after the villages' diplomacy: settlers of crowded villages may
    // found a new one (founding.js; off unless the scenario has `founding`; it draws no random numbers).
    // Births come later in the day (people.js, 06:00) and see the new head-counts.
    if (s.tick % TICKS_PER_DAY === 0) { tickFounding(this); tickKingdoms(this); tickTithes(this); tickCivLaws(this); updateMarkets(this); if (this._cl) growClaims(this); tickAging(this); tickIllness(this); tickRivalry(this); tickFallen(this); tickSpoil(this); } // kingdoms: members leave when relations with the capital sour (nothing unless a kingdom exists); markets set the day's prices (nothing unless a market is built)
    tickPower(this);
    tickWater(this);
    tickPeople(this);
    if (s.tick % TICKS_PER_HOUR === 0 && Object.keys(s.colonists).length) tickMood(this); // Mood: hourly (mood.js)
    tickEducation(this);
    tickHeat(this);
    tickLOD(this); // big worlds: level of detail, abstract villages' hours, caravans
    if (s.animals || animalSpecies(this).length) tickAnimals(this); // wild herds (animals.js, Phase 8)
    if (s.monsters || monsterSpecies(this).length) tickMonsters(this); // wild monsters (monsters.js, Phase 8c)
    if (s.bodies) tickBurial(this); // bodies nobody buried in time, or of distant villages (burial.js)
    if (s.contact) tickContact(this); // contact over distance: explorers and traders (scenarios with a contact block)
    const big = this.big;
    // Big worlds: only colonists of villages simulated in full, gathered from the ownership index and sorted
    // (the same ids in the same order as sorting every colonist and skipping the abstract villages'), so the
    // tick does not sort every colonist in the world.
    const ids = big ? fullColonistIds(this) : Object.keys(s.colonists).sort();
    for (const id of ids) {
      const c = s.colonists[id];
      if (big && s.settlements[c.settlementId]?.detail === 'abstract') continue; // lives by the hour (lod.js)
      this.actor = c.settlementId || s.playerSettlement;
      tickColonist(this, c);
    }
    this.actor = null;
    processDeaths(this); // deaths found during this tick (death.js; nothing when there are none)
  }
  step(n) { for (let k = 0; k < n; k++) this.tick(); }

  colonists() { return Object.keys(this.s.colonists).sort().map((id) => this.s.colonists[id]); }
}

/** Ids of colonists whose village is not abstract (and of colonists of no known village), sorted. */
function fullColonistIds(g) {
  const s = g.s, out = [];
  for (const [sid, m] of g.ownIndex('colonists')) {
    if (s.settlements[sid]?.detail === 'abstract') continue;
    for (const c of m.values()) if (s.colonists[c.id] === c) out.push(c.id);
  }
  return out.sort();
}

/** Big worlds, loading a save without saved plans (Game constructor): the villages that plan
 *  spread out, at their own slot or abstract hour (planner.js replanLater): the abstract ones, in id order. */
export function abstractVillages(state) {
  const out = new Set();
  for (const sid of Object.keys(state.settlements || {}).sort()) if (state.settlements[sid].detail === 'abstract') out.add(sid);
  return out;
}

const FALLBACK_TERRAIN = { id: '?', name: 'Unknown ground', color: '#555555', passable: true, buildable: false, fertility: 0, moveCost: 1 };

export function fieldCells(f) {
  const out = [];
  for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) out.push([x, y]);
  return out;
}

export { clamp };
