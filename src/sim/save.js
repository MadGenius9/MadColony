// Save/load. Saves record the enabled mods. Loading with missing or changed mods never deletes content:
// anything referring to unknown definitions is moved into `state.orphans` verbatim (with its position),
// kept in later saves, and restored automatically once the defining mod is enabled again AND its spot is
// free (see Game.restoreOrphans). Malformed saves are rejected before anything is loaded.
import { SAVE_FORMAT, GAME_API_VERSION, CHUNK } from './constants.js';
import { deepClone } from './util.js';
import { Game } from './game.js';
import { encodePlanner, checkPlanner, decodePlanner } from './plancodec.js';
import { migrateState } from './migrate.js';
import { WORLD_SIZES } from './worldgen.js';
import { encodeState, decodeState } from './savecodec.js';
import { claimsForSave, decodeClaimGrid } from './territory.js';
import { validDisc } from './contact.js';

export class SaveError extends Error {
  constructor(message, problems = []) { super(message); this.problems = problems; }
}

/** Write a save. Read-only: saving never changes the running game. Since format 7 the planner's state (plans
 *  and pending replans, plancodec.js) is written too, so a loaded game continues exactly as this one does. */
export function serializeGame(g, meta = {}) {
  return JSON.stringify({
    saveFormat: SAVE_FORMAT,
    gameApi: GAME_API_VERSION,
    name: meta.name || '',
    savedAtTick: g.s.tick,
    mods: g.reg.mods.map((m) => ({ id: m.id, version: m.version, name: m.name })),
    // Big worlds: terrain and nodes written compactly (format 4). Terrain is kept as palette indexes at run
    // time (tiles.js); it is written as the same plain list of ids as before.
    state: withClaims(g, g.big ? encodeState(g.s, g._ts) : plainState(g)),
    planner: encodePlanner(g), // format 7
  });
}

/** Organic territory (format 10): the claim grid is written as runs in s.claims (same key order). `st` is
 *  already a copy of the state's top level, so the running game is not changed. */
function withClaims(g, st) {
  if (g._cl && st.claims) st.claims = claimsForSave(g);
  return st;
}

/** The state as saved: the same object with s.map.terrain as a plain list of terrain ids (same keys, same
 *  order, so the same JSON as before). */
function plainState(g) {
  const s = g.s, map = {};
  for (const k of Object.keys(s.map)) map[k] = k === 'terrain' ? g._ts.toArray() : s.map[k];
  const out = {};
  for (const k of Object.keys(s)) out[k] = k === 'map' ? map : s[k];
  return out;
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v, max = 200) => typeof v === 'string' && v.length <= max;
const MAX_MAP = 4096; // widest or tallest map a save may have (Phase 2b: the largest presets are 2048 wide)
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,64}$/;

/** Structural validation of a save before any of it is used. Returns a list of problems (empty = ok). */
export function validateSave(save) {
  const P = [];
  const bad = (m) => { if (P.length < 25) P.push(m); };
  if (!isObj(save)) return ['The file is not a save object.'];
  if (isObj(save.state)) { // compact (format 4) terrain and nodes are checked in their decoded form
    try { const st = decodeState(save.state); if (st !== save.state) save = { ...save, state: st }; }
    catch (e) { return [`state.map could not be read (${e.message})`]; }
  }
  if (!isInt(save.saveFormat) || save.saveFormat < 1) bad('saveFormat is missing or invalid');
  else if (save.saveFormat > SAVE_FORMAT) bad(`saved by a newer game version (format ${save.saveFormat}, this game reads up to ${SAVE_FORMAT})`);
  if (!Array.isArray(save.mods) || save.mods.some((m) => !isObj(m) || !isStr(m.id, 64) || !isStr(m.version, 32))) bad('mods list is missing or malformed');
  const s = save.state;
  if (!isObj(s)) { bad('state is missing'); return P; }
  // Saved plans (format 7): a malformed table or forbidden keys refuse the save; plans that are well formed but
  // do not fit only make the loaded game plan afresh (loadGame).
  if (save.planner !== undefined && save.planner !== null) for (const m of checkPlanner(save.planner, new Set(Object.keys(isObj(s.settlements) ? s.settlements : {})))) bad(m);
  if (!isInt(s.tick) || s.tick < 0) bad('state.tick must be a non-negative whole number');
  if (!isInt(s.nextId) || s.nextId < 1) bad('state.nextId must be a positive whole number');
  if (!isObj(s.rng) || !isNum(s.rng.s)) bad('state.rng is missing');
  const m = s.map;
  if (!isObj(m) || !isInt(m.w) || !isInt(m.h) || m.w < 8 || m.h < 8 || m.w > MAX_MAP || m.h > MAX_MAP) { bad('state.map size is invalid'); return P; }
  if (!Array.isArray(m.terrain) || m.terrain.length !== m.w * m.h || m.terrain.some((t) => typeof t !== 'string')) bad('state.map.terrain does not match the map size');
  const inB = (x, y) => isInt(x) && isInt(y) && x >= 0 && y >= 0 && x < m.w && y < m.h;
  if (!isObj(s.center) || !inB(s.center.x, s.center.y)) bad('state.center is outside the map');
  for (const k of ['nodes', 'structures', 'stacks', 'crops', 'colonists', 'projects', 'homes', 'fields']) if (!isObj(s[k])) bad(`state.${k} must be an object`);
  if (s.civic !== undefined && (!isObj(s.civic) || !isObj(s.civic.blocked ?? {}) || Object.values(s.civic.blocked || {}).some((b) => !isObj(b) || !isInt(b.until) || !isStr(b.reason, 300)))) bad('state.civic is invalid');
  if (s.medicalWait !== undefined && (!isObj(s.medicalWait) || Object.values(s.medicalWait).some((v) => !isInt(v) || v < 0))) bad('state.medicalWait is invalid');
  if (s.worldSize !== undefined && s.worldSize !== null && !Object.hasOwn(WORLD_SIZES, s.worldSize)) bad('state.worldSize is unknown');
  if (s.rooms !== undefined && (!isObj(s.rooms) || Object.values(s.rooms).some((t) => typeof t !== 'number' || !Number.isFinite(t)))) bad('state.rooms is invalid');
  if (s.enforcement !== undefined && (!isObj(s.enforcement) || Object.values(s.enforcement).some((a) => !isObj(a) || !isNum(a.value)))) bad('state.enforcement is invalid');
  for (const k of ['goals', 'log']) if (!Array.isArray(s[k])) bad(`state.${k} must be a list`);
  if (save.saveFormat < 3 && !Array.isArray(s.stockpile)) bad('state.stockpile must be a list');
  if (save.saveFormat >= 3 && (!isObj(s.settlements) || Object.values(s.settlements).some((st) => !isObj(st) || !Array.isArray(st.stockpile ?? [])))) bad('state.settlements is malformed');
  if (s.orphans !== undefined && !Array.isArray(s.orphans)) bad('state.orphans must be a list');
  if (s.overflow !== undefined && !Array.isArray(s.overflow)) bad('state.overflow must be a list');
  if (!isObj(s.ledger) || !isObj(s.ledger.created) || !isObj(s.ledger.consumed)) bad('state.ledger is missing');
  if (s.watch !== undefined && s.watch !== null && (!isStr(s.watch, 64) || !isObj(s.settlements) || !Object.hasOwn(s.settlements, s.watch))) bad('state.watch is not a settlement');
  if (s.caravans !== undefined && !isObj(s.caravans)) bad('state.caravans must be an object');
  if (s.claims !== undefined) validateClaims(s, m, bad);
  if (s.contact !== undefined) validateContact(s, m, bad, inB);
  if (s.god !== undefined) validateGod(s, bad);
  if (s.dead !== undefined) validateDead(s, bad); // format 15
  if (s.bodies !== undefined) validateBodies(s, bad, inB); // format 16
  if (s.disasters !== undefined) validateDisasters(s, bad); // format 23
  if (s.stats?.illness !== undefined && (!isObj(s.stats.illness) || !isInt(s.stats.illness.cases) || !isInt(s.stats.illness.outbreaks) || s.stats.illness.cases < 0 || s.stats.illness.outbreaks < 0)) bad('state.stats.illness is malformed'); // format 17
  if (s.stats?.deaths !== undefined && (!isObj(s.stats.deaths) || Object.entries(s.stats.deaths).some(([k, v]) => !SAFE_ID.test(k) || !isInt(v) || v < 0))) bad('state.stats.deaths is malformed'); // format 15
  if (P.length) return P;
  const ent = (coll, label, extra) => {
    for (const [key, e] of Object.entries(s[coll])) {
      if (!isObj(e)) { bad(`${label} "${key}" is not an object`); continue; }
      if (e.id !== key || !SAFE_ID.test(key)) bad(`${label} "${String(key).slice(0, 40)}" has a mismatched or invalid id`);
      if (coll !== 'projects' && coll !== 'homes' && !inB(e.x, e.y)) bad(`${label} "${key}" is outside the map`);
      extra?.(e, key);
    }
  };
  ent('nodes', 'resource node', (e, k) => { if (!isStr(e.def, 100)) bad(`resource node "${k}" has no definition id`); if (!isInt(e.chunks) || e.chunks < 0) bad(`resource node "${k}" has an invalid amount`); });
  ent('stacks', 'item stack', (e, k) => {
    if (!isStr(e.item, 100)) bad(`item stack "${k}" has no item id`);
    if (!isInt(e.qty) || e.qty < 1 || e.qty > 100000) bad(`item stack "${k}" has an invalid quantity`);
    if (e.dur !== undefined && !isNum(e.dur)) bad(`item stack "${k}" has an invalid durability`);
  });
  ent('structures', 'building', (e, k) => {
    if (!isStr(e.def, 100)) bad(`building "${k}" has no definition id`);
    if (typeof e.built !== 'boolean') bad(`building "${k}" has no built flag`);
    if (!isObj(e.delivered) || Object.values(e.delivered).some((q) => !isInt(q) || q < 0)) bad(`building "${k}" has invalid delivered materials`);
    if (e.water !== undefined && (typeof e.water !== 'number' || !(e.water >= 0) || e.water > 1e7)) bad(`building "${k}" has an invalid water store`);
    if (e.fuel !== undefined && (!Array.isArray(e.fuel) || e.fuel.some((b) => !isObj(b) || !isStr(b.item, 100) || !isInt(b.qty) || b.qty < 1))) bad(`building "${k}" has an invalid fuel store`);
    if (e.burn !== undefined && (!isInt(e.burn) || e.burn < 0)) bad(`building "${k}" has an invalid burn timer`);
    if (e.grave !== undefined && (!isObj(e.grave) || !isStr(e.grave.cid, 64) || !isStr(e.grave.name, 80) || !isInt(e.grave.tick))) bad(`building "${k}" has an invalid grave inscription`); // format 16
    if (e.charge !== undefined && (typeof e.charge !== 'number' || !(e.charge >= 0 && e.charge <= 1e7))) bad(`building "${k}" has an invalid battery charge`); // format 14
    if (e.condition !== undefined && (typeof e.condition !== 'number' || !(e.condition >= 0 && e.condition <= 100))) bad(`building "${k}" has an invalid condition`);
    if (e.buffer !== undefined && (!Array.isArray(e.buffer) || e.buffer.some((b) => !isObj(b) || !isStr(b.item, 100) || !isInt(b.qty) || b.qty < 1))) bad(`building "${k}" has an invalid input buffer`);
  });
  ent('crops', 'crop', (e, k) => { if (!isStr(e.def, 100) || !isNum(e.growth)) bad(`crop "${k}" is malformed`); });
  ent('colonists', 'colonist', (e, k) => {
    if (!isStr(e.name, 80)) bad(`colonist "${k}" has an invalid name`);
    if (!isObj(e.skills) || Object.values(e.skills).some((v) => !isNum(v))) bad(`colonist "${k}" has invalid skills`);
    if (!isObj(e.needs) || Object.values(e.needs).some((v) => !isNum(v))) bad(`colonist "${k}" has invalid needs`);
    if (!isObj(e.equip)) bad(`colonist "${k}" has no equipment slots`);
    if (e.carry !== null && e.carry !== undefined && (!isObj(e.carry) || !isStr(e.carry.item, 100) || !isInt(e.carry.qty) || e.carry.qty < 1)) bad(`colonist "${k}" is carrying something invalid`);
    if (e.job !== null && e.job !== undefined && (!isObj(e.job) || !isStr(e.job.type, 40) || !Array.isArray(e.job.res ?? []))) bad(`colonist "${k}" has an invalid job`);
    if (isObj(e.job) && e.job.unmet !== undefined && (!isObj(e.job.unmet) || Object.values(e.job.unmet).some((t) => !isNum(t) || t > s.tick))) bad(`colonist "${k}" has an invalid job (unmet needs)`);
    if (!isObj(e.status)) bad(`colonist "${k}" has no status`);
    if (e.stage !== undefined && !isStr(e.stage, 100)) bad(`colonist "${k}" has an invalid life stage`);
    if (e.origin !== undefined && e.origin !== 'divine') bad(`colonist "${k}" has an unknown origin`); // god powers (format 13, godspawn.js)
    for (const f of ['bornTick', 'ageYears', 'ageTick', 'education']) if (e[f] !== undefined && e[f] !== null && !isNum(e[f])) bad(`colonist "${k}" has an invalid ${f}`);
    if (e.quals !== undefined && (!Array.isArray(e.quals) || e.quals.some((q) => !isStr(q, 100)))) bad(`colonist "${k}" has invalid qualifications`);
    if (e.medBedId !== undefined && e.medBedId !== null && !isStr(e.medBedId, 64)) bad(`colonist "${k}" has an invalid medical bed`);
    if (e.carriedBy !== undefined && e.carriedBy !== null && !isStr(e.carriedBy, 64)) bad(`colonist "${k}" has an invalid carrier`);
    if (e.ammo !== undefined && e.ammo !== null && (!isObj(e.ammo) || !isStr(e.ammo.item, 100) || !isInt(e.ammo.qty) || e.ammo.qty < 1)) bad(`colonist "${k}" has invalid ammunition`);
    if (e.health !== undefined && (!isObj(e.health) || !Array.isArray(e.health.injuries) || e.health.injuries.some((i) => !isObj(i) || !isStr(i.kind, 40) || !isNum(i.severity) || i.severity < 0 || i.severity > 100))) bad(`colonist "${k}" has invalid health`);
    if (isObj(e.health) && Array.isArray(e.health.injuries) && e.health.injuries.some((i) => isObj(i) && i.kind === 'sickness' && (!isStr(i.illness, 64) || !isInt(i.until) || (i.over !== undefined && typeof i.over !== 'boolean')))) bad(`colonist "${k}" has an invalid illness`); // format 17
    if (isObj(e.health) && Array.isArray(e.health.injuries) && e.health.injuries.some((i) => isObj(i) && ((i.deep !== undefined && typeof i.deep !== 'boolean') || (i.mended !== undefined && typeof i.mended !== 'boolean')))) bad(`colonist "${k}" has invalid wound flags`); // format 18
    if (e.lasting !== undefined && (!Array.isArray(e.lasting) || e.lasting.length > 8 || new Set(e.lasting.map((x) => x?.kind)).size !== e.lasting.length || e.lasting.some((x) => !isObj(x) || !isStr(x.kind, 40) || !isInt(x.since) || x.since > s.tick || (x.cause !== undefined && !isStr(x.cause, 80))))) bad(`colonist "${k}" has invalid lasting injuries`); // format 18
    if (e.immune !== undefined && (!isObj(e.immune) || Object.entries(e.immune).some(([id, t]) => !SAFE_ID.test(id) || !isInt(t)))) bad(`colonist "${k}" has invalid immunity`); // format 17
    if (e.grief !== undefined && (!isObj(e.grief) || !isInt(e.grief.until) || !isStr(e.grief.for, 80) || !isNum(e.grief.work) || !(e.grief.work > 0 && e.grief.work <= 1))) bad(`colonist "${k}" has invalid grief`); // format 16
    if (isObj(e.health) && e.health.zeroSince !== undefined && (!isInt(e.health.zeroSince) || e.health.zeroSince > s.tick)) bad(`colonist "${k}" has an invalid time at 0% health`); // format 15
  });
  ent('projects', 'project', (e, k) => { if (!Array.isArray(e.parts) || !Array.isArray(e.cells)) bad(`project "${k}" is malformed`); });
  ent('fields', 'field', (e, k) => { if (!isInt(e.w) || !isInt(e.h) || e.w < 1 || e.h < 1) bad(`field "${k}" has an invalid size`); });
  const piles = save.saveFormat < 3 ? [s.stockpile] : Object.values(s.settlements).map((st) => st.stockpile || []);
  for (const pile of piles) for (const st of pile) { const [x, y] = String(st).split(',').map(Number); if (!inB(x, y)) { bad('a stockpile tile is outside the map'); break; } }
  if (save.saveFormat >= 2 && isObj(s.settlements)) validateSettlements(s, save.saveFormat, bad, inB);
  s.goals.forEach((gl, i) => { if (!isObj(gl) || !isStr(gl.id, 64) || !isStr(gl.type, 100) || !isObj(gl.params ?? {})) bad(`goal #${i + 1} is malformed`); });
  s.log.forEach((l, i) => { if (!isObj(l) || !isStr(l.msg, 2000)) { if (i < 3) bad(`log entry #${i + 1} is malformed`); } });
  for (const o of s.overflow || []) if (!isObj(o) || !isStr(o.item, 100) || !isInt(o.qty) || o.qty < 1) { bad('a held (overflow) item entry is malformed'); break; }
  for (const o of s.orphans || []) if (!isObj(o) || !isStr(o.kind, 20)) { bad('a set-aside (orphan) entry is malformed'); break; }
  return P;
}

/** Organic territory (format 10, optional): settlement ids (existing, unique), the grid as runs that cover the
 *  map with owner indexes inside the id list, and the last day's growth per settlement. */
function validateClaims(s, m, bad) {
  const c = s.claims;
  if (!isObj(c)) { bad('state.claims must be an object'); return; }
  const ids = Array.isArray(c.ids) ? c.ids : null;
  const sett = isObj(s.settlements) ? s.settlements : {};
  if (!ids || ids.length >= 0xffff || ids.some((x) => typeof x !== 'string' || !Object.hasOwn(sett, x)) || new Set(ids).size !== ids.length) { bad('state.claims.ids must list existing settlements, each once'); return; }
  if (typeof c.grid !== 'string') { bad('state.claims.grid is missing'); return; }
  try { decodeClaimGrid(c.grid, m.w * m.h, ids.length); } catch (e) { bad(`state.claims.grid is invalid (${e.message})`); return; }
  if (c.grew !== undefined && (!isObj(c.grew) || Object.entries(c.grew).some(([k, v]) => !Object.hasOwn(sett, k) || !isInt(v) || v < 0))) bad('state.claims.grew is invalid');
}

/** God powers (format 13, optional; god.js): favour and counters finite, queued commands and the log well formed
 *  (whole ids below nextId, each used once, the queue in id order with ticks never decreasing, whole ticks),
 *  blessings well formed (a blessing of a settlement that no longer exists is dropped at load, loadGame). Unknown power types are allowed (a mod may be missing): such a
 *  command is refused, with its reason logged, when it comes due. */
/** Disasters (format 23, optional): burning and scorched tiles, keyed by tile index inside the map, with ticks. */
function validateDisasters(s, bad) {
  const D = s.disasters, N = (s.map?.w || 0) * (s.map?.h || 0);
  if (!isObj(D) || !isObj(D.fires) || !isObj(D.scorched)) { bad('state.disasters is malformed'); return; }
  for (const part of ['fires', 'scorched']) {
    for (const [k, t] of Object.entries(D[part])) {
      if (!/^\d{1,8}$/.test(k) || Number(k) >= N || !isInt(t) || t < 0 || t > s.tick) { bad(`state.disasters.${part} has a bad tile or time`); return; }
    }
  }
  if (D.storms === undefined) return; // format 24: tornadoes (storm.js)
  if (!isObj(D.storms)) { bad('state.disasters.storms is malformed'); return; }
  for (const [k, t] of Object.entries(D.storms)) {
    const ok = isObj(t) && t.id === k && /^t\d{1,9}$/.test(k) && isInt(t.x) && isInt(t.y) && isInt(t.d) && t.d >= 0 && t.d < 8
      && isInt(t.n) && t.n >= 0 && isInt(t.next) && isInt(t.until) && t.next <= t.until && t.until <= s.tick + 1e6 && isStr(t.key, 120)
      && Array.isArray(t.hit) && t.hit.length <= 100000 && t.hit.every((h) => isStr(h, 64));
    if (!ok) { bad(`tornado "${String(k).slice(0, 40)}" is malformed`); return; }
  }
}

/** Bodies waiting for burial (format 16, optional): of someone in s.dead, owned by an existing settlement, on the map,
 *  carried only by a living colonist. */
function validateBodies(s, bad, inB) {
  if (!isObj(s.bodies)) { bad('the list of bodies is malformed'); return; }
  for (const [k, b] of Object.entries(s.bodies)) {
    if (!SAFE_ID.test(k) || !isObj(b) || b.id !== k || !isStr(b.cid, 64) || !Object.hasOwn(s.dead || {}, b.cid) || !isStr(b.settlementId, 64)
      || !Object.hasOwn(s.settlements || {}, b.settlementId) || !isInt(b.x) || !isInt(b.y) || !inB(b.x, b.y) || !isInt(b.tick) || b.tick > s.tick
      || (b.carriedBy !== undefined && (!isStr(b.carriedBy, 64) || !Object.hasOwn(s.colonists || {}, b.carriedBy)))) { bad(`body "${String(k).slice(0, 40)}" is malformed`); return; }
  }
}

/** The dead (format 15, optional): plain records keyed by safe ids that are not living colonists. */
function validateDead(s, bad) {
  if (!isObj(s.dead)) { bad('the list of the dead is malformed'); return; }
  for (const [k, d] of Object.entries(s.dead)) {
    if (!SAFE_ID.test(k) || !isObj(d) || !isStr(d.name, 80) || !isStr(d.cause, 40) || !isStr(d.text, 80) || !isInt(d.tick) || d.tick < 0 || d.tick > s.tick
      || !isStr(d.settlementId, 64) || !isInt(d.x) || !isInt(d.y)) { bad(`the record of the dead "${String(k).slice(0, 40)}" is malformed`); return; }
    if (Object.hasOwn(s.colonists || {}, k)) { bad(`"${k}" is both living and dead`); return; }
    const n = /^c(\d+)$/.exec(k);
    if (n && Number(n[1]) >= s.nextId) { bad(`the record of the dead "${k}" has an id not yet given out`); return; }
    if (d.injury !== undefined && !isStr(d.injury, 80)) { bad(`the record of the dead "${k}" has an invalid injury`); return; }
    if (d.bornTick !== undefined && !isNum(d.bornTick)) { bad(`the record of the dead "${k}" has an invalid birth tick`); return; }
    if (d.origin !== undefined && d.origin !== 'divine') { bad(`the record of the dead "${k}" has an unknown origin`); return; }
    if ((d.buried !== undefined && (!isInt(d.buried) || d.buried > s.tick)) || (d.graveId !== undefined && !isStr(d.graveId, 64))) { bad(`the record of the dead "${k}" has an invalid burial`); return; } // format 16
    if (d.parents !== undefined && (!Array.isArray(d.parents) || d.parents.length > 4 || d.parents.some((p) => !isStr(p, 64)))) { bad(`the record of the dead "${k}" has invalid parents`); return; }
  }
}

function validateGod(s, bad) {
  const god = s.god;
  if (!isObj(god)) { bad('state.god must be an object'); return; }
  if (typeof god.sandbox !== 'boolean') { bad('state.god.sandbox must be true or false'); return; }
  if (!isNum(god.favour) || god.favour < -1e-9 || !isInt(god.favourDay) || god.favourDay < 0) { bad('state.god favour is invalid'); return; }
  if (!isInt(god.nextId) || god.nextId < 1 || !isInt(god.spawned) || god.spawned < 0) { bad('state.god counters are invalid'); return; }
  if (!Array.isArray(god.queue) || god.queue.length > 1000 || !Array.isArray(god.log) || god.log.length > 500) { bad('state.god.queue and state.god.log must be lists (at most 1000 and 500 entries)'); return; }
  const seen = new Set();
  const cmdOk = (c) => isObj(c) && isInt(c.id) && c.id >= 1 && c.id < god.nextId && !seen.has(c.id) && isInt(c.tick) && c.tick >= 0 && isStr(c.type, 64) && isObj(c.args) && JSON.stringify(c.args).length <= 4000 && (seen.add(c.id), true);
  let prev = null;
  for (const c of god.queue) {
    if (!cmdOk(c) || (prev && (c.id <= prev.id || c.tick < prev.tick))) { bad('state.god.queue has a malformed command (ids must be unique, below nextId and in order; ticks whole and never decreasing)'); return; }
    prev = c;
  }
  for (const c of god.log) {
    if (!cmdOk(c) || !isObj(c.result) || typeof c.result.ok !== 'boolean') { bad('state.god.log has a malformed entry (ids unique and below nextId, whole ticks, a result)'); return; }
  }
  if (!isObj(god.blessings)) { bad('state.god.blessings must be an object'); return; }
  for (const [sid, b] of Object.entries(god.blessings)) {
    if (!SAFE_ID.test(sid) || ['__proto__', 'constructor', 'prototype'].includes(sid) || !isObj(b) || !isInt(b.until) || b.until < 0 || !isNum(b.work) || b.work <= 0 || !isNum(b.growth) || b.growth <= 0) { bad(`state.god: the blessing of "${String(sid).slice(0, 40)}" is invalid`); return; }
  }
}

/** Contact over distance (format 11, optional; contact.js): per settlement the discovered chunks (a bitset of
 *  the map's chunks) and schedules; travellers (explorers on chunk routes, traders between two centres). */
function validateContact(s, m, bad, inB) {
  const c = s.contact;
  if (!isObj(c) || !isObj(c.v) || !isObj(c.t) || !isInt(c.n) || c.n < 0) { bad('state.contact is malformed'); return; }
  if (c.met !== undefined && (!isObj(c.met) || Object.values(c.met).some((v) => !isInt(v) || v < 0))) { bad('state.contact.met is invalid'); return; }
  const sett = isObj(s.settlements) ? s.settlements : {};
  const n = Math.ceil(m.w / CHUNK) * Math.ceil(m.h / CHUNK);
  const tick = (v) => isInt(v) && v >= 0;
  for (const [sid, v] of Object.entries(c.v)) {
    const ok = Object.hasOwn(sett, sid) && isObj(v) && validDisc(v.disc, n) && isInt(v.trips) && v.trips >= 0 && tick(v.next) && tick(v.nextTrade) && isInt(v.traded) && v.traded >= 0
      && (v.exp === null || (isStr(v.exp, 64) && Object.hasOwn(c.t, v.exp) && isObj(c.t[v.exp]) && c.t[v.exp].kind === 'explorer' && c.t[v.exp].from === sid));
    if (!ok) { bad(`state.contact: the record of settlement "${String(sid).slice(0, 40)}" is invalid`); return; }
  }
  for (const [id, t] of Object.entries(c.t)) {
    const num = /^x([1-9][0-9]{0,8})$/.exec(id); // ids are x1, x2, ... up to the counter n
    let ok = !!num && Number(num[1]) <= c.n && isObj(t) && t.id === id && Object.hasOwn(sett, t.from) && tick(t.depart);
    if (ok && t.kind === 'explorer') {
      ok = Array.isArray(t.route) && t.route.length >= 2 && t.route.length <= 4096 && t.route.every((x) => isInt(x) && x >= 0 && x < n)
        && isInt(t.trip) && t.trip >= 1 && isInt(t.k) && t.k >= 0 && t.k < t.route.length && (t.dir === 1 || t.dir === -1)
        && (t.dir === 1 ? t.k < t.route.length - 1 : t.k > 0) && tick(t.prev) && tick(t.next) && t.next > t.prev && c.v[t.from]?.exp === id;
    } else if (ok && t.kind === 'trader') {
      ok = Object.hasOwn(sett, t.to) && t.to !== t.from && inB(t.x, t.y) && inB(t.tx, t.ty) && tick(t.arrive) && tick(t.back)
        && t.arrive >= t.depart && t.back >= t.arrive && (t.stage === 'out' || t.stage === 'home');
    } else ok = false;
    if (!ok) { bad(`state.contact: traveller "${String(id).slice(0, 40)}" is malformed`); return; }
  }
}

/** Settlements, their research and everything that points at a settlement. Malformed data here used to pass
 *  validation and then crash the running game. */
function validateSettlements(s, format, bad, inB) {
  const ids = new Set(Object.keys(s.settlements));
  if (!ids.size) bad('the save has no settlements');
  if (s.playerSettlement !== undefined && !ids.has(s.playerSettlement)) bad(`the player's settlement "${String(s.playerSettlement).slice(0, 40)}" does not exist`);
  const numMap = (o) => isObj(o) && Object.values(o).every((v) => isNum(v));
  for (const [k, st] of Object.entries(s.settlements)) {
    const L = `settlement "${String(k).slice(0, 40)}"`;
    if (st?.fallen !== undefined && (!isObj(st.fallen) || !isInt(st.fallen.tick) || st.fallen.tick > s.tick || !isStr(st.fallen.cause, 120) || !['ruin', 'absorbed', 'sacked'].includes(st.fallen.fate)
      || (st.fallen.by !== undefined && !ids.has(st.fallen.by)) || (st.fallen.released !== undefined && (!isInt(st.fallen.released) || st.fallen.released > s.tick || st.fallen.released < st.fallen.tick)) || st.kingdom !== undefined)) bad(`${L} has an invalid fallen record`); // format 21 (a ruin is in no kingdom)
    if (st?.graveyard !== undefined && (!isObj(st.graveyard) || !isInt(st.graveyard.x) || !isInt(st.graveyard.y) || !inB(st.graveyard.x, st.graveyard.y))) bad(`${L} has an invalid graveyard`); // format 16
    if (!isObj(st)) { bad(`${L} is not an object`); continue; }
    if (st.id !== k || !SAFE_ID.test(k)) bad(`${L} has a mismatched or invalid id`);
    if (st.name !== undefined && !isStr(st.name, 80)) bad(`${L} has an invalid name`);
    if (st.center !== undefined && (!isObj(st.center) || !inB(st.center.x, st.center.y))) bad(`${L} has its centre outside the map`);
    if (format >= 3 && (!Array.isArray(st.stockpile) || st.stockpile.some((t) => typeof t !== 'string' || !/^\d+,\d+$/.test(t)))) bad(`${L} has a malformed stockpile`);
    for (const f of ['policy', 'trade', 'laws']) if (st[f] !== undefined && !isObj(st[f])) bad(`${L} has an invalid ${f}`);
    if (st.laws && Object.values(st.laws).some((v) => !['legal', 'restricted', 'banned'].includes(v))) bad(`${L} has an unknown law setting`);
    if (st.enforcement !== undefined && !isNum(st.enforcement)) bad(`${L} has an invalid enforcement level`);
    if (st.detail !== undefined && st.detail !== 'full' && st.detail !== 'abstract') bad(`${L} has an unknown level of detail`);
    if (st.detailSince !== undefined && (!isInt(st.detailSince) || st.detailSince < 0)) bad(`${L} has an invalid detail time`);
    if (st.abs !== undefined && (!isObj(st.abs) || ['craft', 'gather'].some((f) => st.abs[f] !== undefined && (!numMap(st.abs[f]) || Object.values(st.abs[f]).some((v) => v < 0))))) bad(`${L} has invalid distant-work progress`);
    // Villages founded during play (founding.js): optional, absent in older saves.
    for (const f of ['parent', 'culture']) if (st[f] !== undefined && (!isStr(st[f], 64) || !SAFE_ID.test(st[f]) || (f === 'parent' && st[f] === k))) bad(`${L} has an invalid ${f === 'parent' ? 'parent village' : 'culture'}`); // may name a village that is gone
    if (st.origin !== undefined && st.origin !== 'divine') bad(`${L} has an unknown origin`); // god powers (format 13, godspawn.js)
    for (const f of ['founded', 'crowdedSince', 'lastFounding', 'noSiteAt']) if (st[f] !== undefined && (!isNum(st[f]) || st[f] < 0)) bad(`${L} has an invalid ${f} time`);
    if (st.training !== undefined && st.training !== null && (!isObj(st.training) || !isStr(st.training.cid, 64) || !isStr(st.training.qual, 100) || !isNum(st.training.progress))) bad(`${L} has invalid training data`);
    const r = st.research;
    if (r === undefined) continue;
    if (!isObj(r)) { bad(`${L} has invalid research data`); continue; }
    if (!Array.isArray(r.done) || r.done.some((t) => !isStr(t, 100))) bad(`${L}: the list of finished research is malformed`);
    if (r.progress !== undefined && (!numMap(r.progress) || Object.values(r.progress).some((v) => v < 0))) bad(`${L}: research progress is malformed`);
    if (r.paid !== undefined && (!isObj(r.paid) || Object.values(r.paid).some((v) => typeof v !== 'boolean'))) bad(`${L}: paid research materials are malformed`);
    if (r.priorities !== undefined && (!numMap(r.priorities) || Object.values(r.priorities).some((v) => !isInt(v) || v < 0 || v > 3))) bad(`${L}: research priorities must be whole numbers 0-3`);
    if (r.current !== undefined && r.current !== null && !isStr(r.current, 100)) bad(`${L}: the current research is invalid`);
    if (r.era !== undefined && !isStr(r.era, 100)) bad(`${L}: the era is invalid`);
    if (r.completed !== undefined && !Array.isArray(r.completed)) bad(`${L}: completed eras are malformed`);
  }
  const owned = (coll, label) => { for (const [k, e] of Object.entries(s[coll] || {})) if (isObj(e) && e.settlement !== undefined && !ids.has(e.settlement)) { bad(`${label} "${String(k).slice(0, 40)}" belongs to a settlement that does not exist`); return; } };
  owned('structures', 'building'); owned('stacks', 'item stack'); owned('projects', 'project'); owned('fields', 'field'); owned('homes', 'home');
  for (const [k, c] of Object.entries(s.colonists || {})) if (isObj(c) && c.settlementId !== undefined && !ids.has(c.settlementId)) { bad(`colonist "${String(k).slice(0, 40)}" belongs to a settlement that does not exist`); break; }
  for (const [k, t] of Object.entries(s.trades || {})) if (!isObj(t) || !ids.has(t.seller) || !ids.has(t.buyer) || !Array.isArray(t.legs)) { bad(`trade "${String(k).slice(0, 40)}" is malformed`); break; }
  for (const [k, v] of Object.entries(isObj(s.caravans) ? s.caravans : {})) {
    const ok = isObj(v) && v.id === k && SAFE_ID.test(k) && isStr(v.trade, 64) && isInt(v.leg) && v.leg >= 0 && ids.has(v.from) && ids.has(v.to)
      && isStr(v.item, 100) && isInt(v.qty) && v.qty >= 1 && v.qty <= 100000 && (v.dur === undefined || isNum(v.dur))
      && inB(v.x, v.y) && inB(v.tx, v.ty) && isInt(v.depart) && isInt(v.eta) && v.eta >= v.depart;
    if (!ok) { bad(`caravan "${String(k).slice(0, 40)}" is malformed`); break; }
  }
  validateDiplomacy(s, ids, bad);
}

const TREATY_KINDS = new Set(['tradePact']);
const PROPOSAL_KINDS = new Set(['tradePact', 'gatherRights', 'alliance']);
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Treaties, alliances and proposals: known kinds, references to existing settlements, sane numbers. */
function validateDiplomacy(s, ids, bad) {
  const cut = (k) => String(k).slice(0, 60);
  for (const f of ['treaties', 'alliances', 'proposals', 'kingdoms', 'markets']) if (s[f] !== undefined && !isObj(s[f])) { bad(`state.${f} must be an object`); return; }
  for (const [k, t] of Object.entries(s.treaties || {})) {
    const L = `treaty "${cut(k)}"`;
    if (!isObj(t)) { bad(`${L} is not an object`); break; }
    if (!TREATY_KINDS.has(t.kind)) { bad(`${L} has an unknown kind "${cut(t.kind)}"`); break; }
    if (!ids.has(t.a) || !ids.has(t.b) || t.a === t.b) { bad(`${L} is between settlements that do not exist`); break; }
    if (k !== pairKey(t.a, t.b)) { bad(`${L} is stored under the wrong key (expected "${cut(pairKey(t.a, t.b))}")`); break; }
    if ((t.since !== undefined && !isNum(t.since)) || (t.lastTrade !== undefined && !isNum(t.lastTrade))) { bad(`${L} has an invalid date`); break; }
  }
  for (const [k, al] of Object.entries(s.alliances || {})) {
    const L = `alliance "${cut(k)}"`;
    if (!isObj(al)) { bad(`${L} is not an object`); break; }
    if (!ids.has(al.a) || !ids.has(al.b)) { bad(`${L} is between settlements that do not exist`); break; }
    if (!(al.a < al.b)) { bad(`${L} must list its two settlements in order (a before b)`); break; }
    if (k !== pairKey(al.a, al.b)) { bad(`${L} is stored under the wrong key (expected "${cut(pairKey(al.a, al.b))}")`); break; }
    if (!isNum(al.since)) { bad(`${L} has an invalid start time`); break; }
    if (al.by !== undefined && al.by !== null && !ids.has(al.by)) { bad(`${L} was proposed by a settlement that does not exist`); break; }
    if (al.reason !== undefined && !isStr(al.reason, 500)) { bad(`${L} has an invalid reason`); break; }
  }
  validateKingdoms(s, ids, bad, cut);
  validateMarkets(s, ids, bad, cut);
  // War markers on relations (format 6, optional): who started the war, and the ally a joiner defends.
  for (const [k, r] of Object.entries(isObj(s.relations) ? s.relations : {})) {
    if (!isObj(r)) continue;
    const L = `relation "${cut(k)}"`;
    if (r.aggressor !== undefined && r.aggressor !== r.a && r.aggressor !== r.b) { bad(`${L} names an aggressor that is not one of its two settlements`); break; }
    if ((r.touch !== undefined && (!isInt(r.touch) || r.touch > s.tick)) || (r.threat !== undefined && (!isInt(r.threat) || r.threat > s.tick)) || (r.warSince !== undefined && (!isInt(r.warSince) || r.warSince > s.tick)) || (r.beaten !== undefined && (!isObj(r.beaten) || (r.beaten.sid !== r.a && r.beaten.sid !== r.b) || !isInt(r.beaten.since) || r.beaten.since > s.tick))) { bad(`${L} has an invalid border, threat or war time`); break; } // formats 19-22
    if (r.joinedFor !== undefined && !ids.has(r.joinedFor)) { bad(`${L} defends an ally that does not exist`); break; }
    // Contact games (format 11, optional): how they first met, and the traders' visits.
    if (r.met !== undefined && (!isObj(r.met) || !isInt(r.met.tick) || r.met.tick < 0 || !isStr(r.met.reason, 500))) { bad(`${L} has an invalid first-contact record`); break; }
    if (r.visits !== undefined && (!isObj(r.visits) || !isInt(r.visits.n) || r.visits.n < 1 || !isInt(r.visits.last) || r.visits.last < 0 || (r.visits.from !== r.a && r.visits.from !== r.b))) { bad(`${L} has an invalid record of traders' visits`); break; }
    // Format 12 (contact games that prune finished trades): completed trades between the two that were pruned.
    if (r.tradesDone !== undefined && (!isInt(r.tradesDone) || r.tradesDone < 1)) { bad(`${L} has an invalid count of completed trades`); break; }
  }
  for (const [k, p] of Object.entries(s.proposals || {})) {
    const L = `proposal "${cut(k)}"`;
    if (!isObj(p)) { bad(`${L} is not an object`); break; }
    if (!PROPOSAL_KINDS.has(p.kind)) { bad(`${L} has an unknown kind "${cut(p.kind)}"`); break; }
    if (!ids.has(p.from) || !ids.has(p.to)) { bad(`${L} refers to a settlement that does not exist`); break; }
    if ((p.created !== undefined && !isNum(p.created)) || (p.expires !== undefined && !isNum(p.expires))) { bad(`${L} has an invalid date`); break; }
    if (p.reason !== undefined && !isStr(p.reason, 500)) { bad(`${L} has an invalid reason`); break; }
  }
}

/** Markets (format 9, optional): each record belongs to an existing settlement and holds prices (finite, above
 *  0), supply and demand (finite, not negative) by item id, and the tick of its last update; a trade
 *  priced by a market names an existing settlement. (Whether the market building still stands is checked by
 *  the daily update, which drops the record of a market that is gone.) */
function validateMarkets(s, ids, bad, cut) {
  const BAD_KEYS = ['__proto__', 'constructor', 'prototype'];
  const numMap = (o, min0 = true) => isObj(o) && Object.entries(o).every(([k, v]) => isStr(k, 100) && !BAD_KEYS.includes(k) && isNum(v) && (min0 ? v >= 0 : v > 0) && v <= 1e9);
  for (const [k, m] of Object.entries(s.markets || {})) {
    const L = `market "${cut(k)}"`;
    if (!ids.has(k) || BAD_KEYS.includes(k)) { bad(`${L} belongs to a settlement that does not exist`); break; }
    if (!isObj(m)) { bad(`${L} is not an object`); break; }
    if (!numMap(m.prices, false)) { bad(`${L} has invalid prices (each must be a number above 0)`); break; }
    if (m.supply !== undefined && !numMap(m.supply)) { bad(`${L} has invalid supply`); break; }
    if (m.demand !== undefined && !numMap(m.demand)) { bad(`${L} has invalid demand`); break; }
    if (!isInt(m.updated) || m.updated < 0) { bad(`${L} has an invalid update time`); break; }
  }
  for (const [k, t] of Object.entries(s.trades || {})) {
    if (isObj(t) && t.market !== undefined && (typeof t.market !== 'string' || !ids.has(t.market))) { bad(`trade "${cut(k)}" names a market village that does not exist`); break; }
  }
}

/** Kingdoms (format 8, optional): each record is stored under its own id, names an existing capital that is
 *  in it, and has a name, a colour and a founding time; every settlement.kingdom names an existing kingdom. */
function validateKingdoms(s, ids, bad, cut) {
  const K = s.kingdoms || {};
  for (const [k, kd] of Object.entries(K)) {
    const L = `kingdom "${cut(k)}"`;
    if (!isObj(kd)) { bad(`${L} is not an object`); break; }
    if (kd.id !== k || !SAFE_ID.test(k) || ['__proto__', 'constructor', 'prototype'].includes(k)) { bad(`${L} has a mismatched or invalid id`); break; }
    if (!isStr(kd.name, 80) || !kd.name.trim()) { bad(`${L} has an invalid name (text of at most 80 characters)`); break; }
    if (!isStr(kd.color, 32) || !/^#[0-9a-fA-F]{3,8}$/.test(kd.color)) { bad(`${L} has an invalid colour`); break; }
    if (!isNum(kd.founded) || kd.founded < 0) { bad(`${L} has an invalid founding time`); break; }
    if (typeof kd.capital !== 'string' || !ids.has(kd.capital)) { bad(`${L} has a capital that does not exist`); break; }
    if (s.settlements[kd.capital]?.kingdom !== k) { bad(`${L}: its capital "${cut(kd.capital)}" is not in it (the capital's kingdom must be "${cut(k)}")`); break; }
  }
  for (const [k, st] of Object.entries(s.settlements || {})) {
    if (!isObj(st) || st.kingdom === undefined) continue;
    if (typeof st.kingdom !== 'string' || !SAFE_ID.test(st.kingdom)) { bad(`settlement "${cut(k)}" has an invalid kingdom`); break; }
    if (!Object.hasOwn(K, st.kingdom)) { bad(`settlement "${cut(k)}" belongs to a kingdom that does not exist ("${cut(st.kingdom)}")`); break; }
  }
}

/**
 * Load a save into a throwaway game and run a few ticks. Catches data that passes validation but cannot run,
 * before the player's current colony is replaced. Returns null when fine, or the error message.
 */
export function trialRun(reg, save, ticks = 5) {
  try {
    const g = loadGame(reg, save);
    for (let i = 0; i < ticks; i++) g.tick();
    return null;
  } catch (e) { return e.message || String(e); }
}

export function parseSave(text) {
  let save;
  try { save = typeof text === 'string' ? JSON.parse(text) : text; }
  catch (e) { throw new SaveError(`This is not a readable save file (${e.message}).`, []); }
  if (!save || typeof save !== 'object' || !save.state || !Array.isArray(save.mods)) throw new SaveError('This is not a MadColony save file.', []);
  // Format 4 writes terrain and nodes compactly; everything after this sees the plain state (a copy: the
  // caller's save object is never changed).
  try { const st = decodeState(save.state); if (st !== save.state) save = { ...save, state: st }; }
  catch (e) { throw new SaveError(`This save is damaged and was not loaded: its map could not be read (${e.message}).`, ['state.map']); }
  return save;
}

/** Compare a save's mod list and content against the current registry. */
export function analyzeSave(save, reg) {
  const res = { missing: [], changed: [], added: [], unknown: {}, ok: true, problems: validateSave(save) };
  for (const m of save.mods || []) {
    const cur = reg.mods.find((x) => x.id === m.id);
    if (!cur) res.missing.push(m);
    else if (cur.version !== m.version) res.changed.push({ id: m.id, name: m.name, saved: m.version, current: cur.version });
  }
  for (const cur of reg.mods) if (!(save.mods || []).some((m) => m.id === cur.id)) res.added.push(cur);
  const st = save.state || {};
  const count = (k) => { res.unknown[k] = (res.unknown[k] || 0) + 1; };
  for (const n of Object.values(st.nodes || {})) if (!reg.has('node', n?.def)) count('resource nodes');
  for (const b of Object.values(st.structures || {})) if (!reg.has('building', b?.def)) count('buildings');
  for (const s of Object.values(st.stacks || {})) if (!reg.has('item', s?.item)) count('item stacks');
  for (const c of Object.values(st.crops || {})) if (!reg.has('crop', c?.def)) count('crops');
  for (const f of Object.values(st.fields || {})) if (!reg.has('crop', f?.crop)) count('fields');
  res.ok = !res.missing.length && !res.changed.length && !Object.keys(res.unknown).length && !res.problems.length;
  return res;
}

export function loadGame(reg, saveOrText) {
  const save = parseSave(saveOrText);
  const problems = validateSave(save);
  if (problems.length) throw new SaveError(`This save is damaged and was not loaded: ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? ` (+${problems.length - 3} more)` : ''}`, problems);
  // The caller's save object is never modified: a save given as text was parsed here (its objects are this
  // load's own, and already plain JSON), so only a save given as an object is copied.
  const s = typeof saveOrText === 'string' ? save.state : deepClone(save.state);
  migrateState(s, save.saveFormat, reg);
  s.orphans ||= [];
  const waitingBefore = s.orphans.length; // set aside in earlier loads (they do not change the plans)
  // Laws added to a village profile after the save was made (e.g. arms laws) join that village's laws; existing ones are kept.
  for (const st of Object.values(s.settlements || {})) {
    const prof = st.ai && st.profile && reg.get('villageProfile', st.profile);
    if (prof?.laws) st.laws = { ...prof.laws, ...(st.laws || {}) };
  }
  s.overflow ||= [];
  // Set aside anything referring to unknown definitions (kept verbatim, with its position).
  const q = (kind, data, extra = {}) => s.orphans.push({ kind, data, ...extra, since: s.tick });
  for (const [id, n] of Object.entries(s.nodes)) if (!reg.has('node', n.def)) { q('node', n); delete s.nodes[id]; }
  for (const [id, b] of Object.entries(s.structures)) {
    if (!reg.has('building', b.def)) { q('structure', b); delete s.structures[id]; continue; }
    // Battery charge (format 14) never exceeds the store of the loaded definition: a mod may have lowered it, so the
    // charge is clamped rather than the save refused (validateSave rejects only malformed values).
    if (b.charge !== undefined) { const cap = reg.get('building', b.def).power?.store || 0; if (b.charge > cap) b.charge = cap; }
    for (const [it, qty] of Object.entries(b.delivered || {})) if (!reg.has('item', it)) { s.orphans.push({ kind: 'delivered', sid: id, item: it, qty, x: b.x, y: b.y, since: s.tick }); delete b.delivered[it]; }
    if (b.fuel) b.fuel = b.fuel.filter((x) => reg.has('item', x.item) || (q('stack', { id: `s_orph_${id}_f_${x.item}`, item: x.item, qty: x.qty, x: b.x, y: b.y }), false));
    if (b.buffer) b.buffer = b.buffer.filter((x) => reg.has('item', x.item) || (q('stack', { id: `s_orph_${id}_${x.item}`, item: x.item, qty: x.qty, x: b.x, y: b.y, ...(x.dur !== undefined ? { dur: x.dur } : {}) }), false));
  }
  for (const [id, st] of Object.entries(s.stacks)) if (!reg.has('item', st.item)) { q('stack', st); delete s.stacks[id]; }
  for (const [id, c] of Object.entries(s.crops)) if (!reg.has('crop', c.def)) { q('crop', c); delete s.crops[id]; }
  for (const [id, f] of Object.entries(s.fields)) if (!reg.has('crop', f.crop)) { q('field', f); delete s.fields[id]; }
  const fallbackTerrain = reg.all('terrain').find((t) => t.passable && t.buildable)?.id;
  for (let i = 0; i < s.map.terrain.length; i++) {
    if (!reg.has('terrain', s.map.terrain[i])) { s.orphans.push({ kind: 'terrain', i, id: s.map.terrain[i], since: s.tick }); s.map.terrain[i] = fallbackTerrain; }
  }
  // Caravans carrying an item whose mod is missing: the goods are set aside at the seller's centre, still the
  // seller's (restored as its stack once the item exists again); the caravan itself is gone.
  for (const [id, cv] of Object.entries(s.caravans || {})) {
    if (reg.has('item', cv.item)) continue;
    const home = s.settlements?.[cv.from]?.center || s.center;
    s.orphans.push({ kind: 'stack', owner: cv.from, data: { id: `s_orph_${id}`, item: cv.item, qty: cv.qty, x: home.x, y: home.y, ...(cv.dur !== undefined ? { dur: cv.dur } : {}) }, since: s.tick });
    delete s.caravans[id];
  }
  s.overflow = s.overflow.filter((o) => reg.has('item', o.item) || (q('stack', { id: `s_orph_over_${o.item}_${o.qty}`, item: o.item, qty: o.qty, x: o.x, y: o.y }), false));
  for (const c of Object.values(s.colonists)) {
    for (const slot of ['tool', 'weapon']) {
      const e = c.equip?.[slot];
      if (e && !reg.has('item', e.item)) { s.orphans.push({ kind: 'equip', cid: c.id, slot, data: e, since: s.tick }); c.equip[slot] = null; }
    }
    if (c.ammo && !reg.has('item', c.ammo.item)) { q('stack', { id: `s_orph_ammo_${c.id}`, item: c.ammo.item, qty: c.ammo.qty, x: c.x, y: c.y }); c.ammo = null; }
    if (c.carry && !reg.has('item', c.carry.item)) { q('stack', { id: `s_orph_carry_${c.id}`, item: c.carry.item, qty: c.carry.qty, x: c.x, y: c.y, ...(c.carry.dur !== undefined ? { dur: c.carry.dur } : {}) }); c.carry = null; }
    for (const sk of reg.all('skill')) if (c.skills[sk.id] === undefined) c.skills[sk.id] = 0;
    for (const nd of reg.all('need')) if (c.needs[nd.id] === undefined) c.needs[nd.id] = 0.8;
  }
  if (!reg.has('aiProfile', s.aiProfileId)) s.aiProfileId = reg.all('aiProfile')[0]?.id;
  // God powers (format 13): a blessing of a settlement that no longer exists has nothing to bless; it is dropped.
  if (s.god?.blessings) for (const sid of Object.keys(s.god.blessings)) if (!Object.hasOwn(s.settlements || {}, sid)) delete s.god.blessings[sid];
  s.loadedFrom = { mods: save.mods, tick: save.savedAtTick, name: save.name };
  // Saved plans (format 7) are used only when nothing was set aside and the mods are the same as when saving;
  // otherwise (and for older saves) the loaded game plans afresh, as before.
  const sameMods = save.mods.length === reg.mods.length && save.mods.every((m) => reg.mods.some((r) => r.id === m.id && r.version === m.version));
  const setAsideNow = s.orphans.length > waitingBefore;
  let planner = null, dropped = '';
  if (save.saveFormat >= 7 && save.planner && sameMods && !setAsideNow) {
    let r;
    try { r = decodePlanner(save.planner, s); }
    catch (e) { throw new SaveError(`This save is damaged and was not loaded: ${e.message}.`, ['planner']); }
    if (r.dropped) dropped = r.dropped; else planner = r;
  }
  const g = new Game(reg, s, planner);
  if (dropped) g.log(`The saved plans could not be used (${dropped}); the settlements plan afresh.`, 'warn');
  g.restoreOrphans(); // only onto valid, free positions; the rest keep waiting
  if (g.big) g.warmCaches(); // derived, never saved: built here so the first ticks after loading do not pay for them
  // Said when this load set something aside; objects still waiting from earlier loads were reported then (so
  // loading a game saved with the same mods leaves its state exactly as it was).
  const waiting = s.orphans.length;
  if (waiting && setAsideNow) g.log(`${waiting} saved object(s) are set aside (their mod is missing or their spot is taken). They are kept in the save and restored automatically when possible.`, 'warn');
  return g;
}
