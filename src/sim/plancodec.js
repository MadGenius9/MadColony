// Planner state in saves (save format 7). A game's plans (g.plans, g.plan) and the planner's pending
// requests (planDirty, replanSids, replanLater) are written with the save, so saving never changes the running
// game and a loaded game continues with exactly the same plans.
//
// Format: every object of the plans goes into a flat table ({ $o }, { $a }, { $m } for a Map, { $set } for a
// Set; { $p } holds properties hung on a list, Map or Set, e.g. techWanted.urgent) and is referred to by index
// ({ $r }), so objects shared between plans stay shared. undefined, Infinity and NaN are written explicitly
// ({ $u }, { $n }). Only the ROOT objects of the state's entity collections (ENTITY_COLLS: a colonist, a
// structure, ...) are written as references ({ $s: collection, id }) and resolved against the loaded state;
// anything else is copied. Plans must not hold other parts of the state (a job, a research record): the copy
// would lose its identity, except read-only snapshots listed in HARMLESS_COPIES. With `strict` (tests and headless
// runs: g.debugThrow; never in the game itself, so a save never fails) encoding throws on any other such value.
//
// Loading (save.js): checkPlanner refuses saves whose planner data is not well formed or tries to reach object
// prototypes (forbidden keys and ids). decodePlanner builds the objects without ever assigning a forbidden key,
// refuses references to entities that are not in the save, and drops plans that are well formed but do not fit
// (a plan for a settlement that is gone, the wrong types: planShapeProblems): a warning is logged and the loaded
// game plans afresh.

const ENTITY_COLLS = ['colonists', 'structures', 'stacks', 'projects', 'fields', 'homes', 'nodes', 'crops', 'settlements', 'trades', 'caravans', 'proposals'];
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const hasOwn = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

/** Parts of the state that plans hold as read-only snapshots, where a copy after loading is harmless: only
 *  counted or shown, never changed or compared by identity. (Path as written in encodePlanner's message.) */
const HARMLESS_COPIES = [
  /^plans\.[^.]+\.medical\.needs\.\d+\.inj$/, // the injury a treatment need is about (planMedical counts needs)
  /^plan\.medical\.needs\.\d+\.inj$/,
];
const harmlessCopy = (path) => { const p = path.join('.'); return HARMLESS_COPIES.some((re) => re.test(p)); };

/** Which kind of table entry this is ('o', 'a', 'm', 'set'), or null. The checker and decoder both use it. */
function kindOf(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const kinds = [];
  if (hasOwn(e, '$a')) kinds.push(Array.isArray(e.$a) ? 'a' : 'bad');
  if (hasOwn(e, '$m')) kinds.push(Array.isArray(e.$m) ? 'm' : 'bad');
  if (hasOwn(e, '$set')) kinds.push(Array.isArray(e.$set) ? 'set' : 'bad');
  if (hasOwn(e, '$o')) kinds.push(e.$o && typeof e.$o === 'object' && !Array.isArray(e.$o) ? 'o' : 'bad');
  return kinds.length === 1 && kinds[0] !== 'bad' ? kinds[0] : null;
}

/** The planner state of a game, as plain JSON data. Read-only. Plans of settlements that no longer exist and
 *  pending requests for them are left out. `strict`: throw if a plan holds a part of the state that is not an
 *  entity root (it would be copied, not referred to). */
export function encodePlanner(g, { strict = !!g.debugThrow } = {}) {
  const s = g.s;
  const exists = (sid) => hasOwn(s.settlements, sid);
  const refs = new Map();
  for (const coll of ENTITY_COLLS) for (const [id, e] of Object.entries(s[coll] || {})) if (e && typeof e === 'object') refs.set(e, [coll, id]);
  let inState = null;
  if (strict) {
    inState = new WeakSet();
    // The terrain list holds only strings, and at run time it is a view onto typed storage (tiles.js) that is
    // slow to list element by element: it is noted, not walked.
    const skip = s.map?.terrain;
    const walk = (o) => { if (!o || typeof o !== 'object' || inState.has(o)) return; inState.add(o); if (o === skip) return; for (const v of Object.values(o)) walk(v); };
    walk(s);
  }
  const index = new Map(), table = [], path = [];
  const at = (key, v) => { path.push(key); try { return enc(v); } finally { path.pop(); } };
  const enc = (v) => {
    if (v === undefined) return { $u: 1 };
    if (typeof v === 'number') return Number.isFinite(v) ? v : { $n: String(v) };
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v !== 'object') throw new Error(`a plan holds a ${typeof v}`);
    const ref = refs.get(v);
    if (ref) return { $s: ref[0], id: ref[1] };
    if (inState?.has(v) && !harmlessCopy(path)) throw new Error(`a plan holds a part of the game state that is not an entity (it would be copied on save): ${path.join('.')}`);
    if (index.has(v)) return { $r: index.get(v) };
    const k = table.length;
    index.set(v, k);
    table.push(null);
    let out;
    const extra = () => { // own properties hung on a list, map or set (e.g. techWanted.urgent)
      const keys = Object.keys(v).filter((key) => !(Array.isArray(v) && /^\d+$/.test(key)));
      if (!keys.length) return;
      out.$p = {};
      for (const key of keys) out.$p[key] = at(key, v[key]);
    };
    if (Array.isArray(v)) { out = { $a: Array.from(v, (x, i) => at(i, x)) }; extra(); }
    else if (v instanceof Map) { out = { $m: [...v].map(([a, b]) => [at('key', a), at(String(a), b)]) }; extra(); }
    else if (v instanceof Set) { out = { $set: [...v].map((x) => at('item', x)) }; extra(); }
    else {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new Error('a plan holds an object of an unknown kind');
      const o = {};
      for (const key of Object.keys(v)) o[key] = at(key, v[key]);
      out = { $o: o };
    }
    table[k] = out;
    return { $r: k };
  };
  const plans = {};
  for (const sid of Object.keys(g.plans || {})) if (exists(sid)) plans[sid] = g.plans[sid];
  const root = enc({ plans, plan: g.plan || null });
  return {
    table, root,
    planDirty: !!g.planDirty,
    replanSids: g.replanSids ? [...g.replanSids].filter(exists) : null,
    replanLater: g.replanLater ? [...g.replanLater].filter(exists) : null,
  };
}

/** Check saved planner data without the state. Returns the problems that make the save unreadable: keys or ids
 *  that would reach object prototypes, and a table that is not well formed. (Plans that are well formed but do
 *  not fit, e.g. a plan for a settlement that is gone or missing its fields, only make the loaded game plan
 *  afresh: decodePlanner.) */
export function checkPlanner(p, settlementIds) {
  const P = [];
  const bad = (m) => { if (P.length < 10) P.push(`planner: ${m}`); };
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['planner: must be an object'];
  // Injection checks first: they apply even where the rest is malformed.
  const scanKeys = (o, where) => { if (o && typeof o === 'object' && !Array.isArray(o)) for (const key of Object.keys(o)) if (BAD_KEYS.has(key)) bad(`${where} uses the forbidden key "${key}"`); };
  const list = (v) => (Array.isArray(v) ? v : []);
  const scanVal = (v, where) => { if (v && typeof v === 'object' && !Array.isArray(v) && hasOwn(v, '$s') && (typeof v.id !== 'string' || BAD_KEYS.has(v.id) || BAD_KEYS.has(v.$s))) bad(`${where} refers to a forbidden id`); };
  list(p.table).forEach((e, k) => {
    if (!e || typeof e !== 'object') return;
    scanKeys(e, `entry ${k}`);
    scanKeys(e.$o, `entry ${k}`); scanKeys(e.$p, `entry ${k}`);
    for (const v of [...list(e.$a), ...list(e.$set), ...(e.$o && typeof e.$o === 'object' ? Object.values(e.$o) : []), ...(e.$p && typeof e.$p === 'object' ? Object.values(e.$p) : [])]) scanVal(v, `entry ${k}`);
    for (const x of list(e.$m)) if (Array.isArray(x)) { scanVal(x[0], `entry ${k}`); scanVal(x[1], `entry ${k}`); }
  });
  for (const f of ['replanSids', 'replanLater']) for (const x of list(p[f])) if (typeof x === 'string' && BAD_KEYS.has(x)) bad(`${f} names "${x}"`);
  if (P.length) return P;
  if (!Array.isArray(p.table)) bad('table is missing');
  if (typeof p.planDirty !== 'boolean') bad('planDirty must be true or false');
  for (const f of ['replanSids', 'replanLater']) {
    const v = p[f];
    if (v !== null && v !== undefined && (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !settlementIds.has(x)))) bad(`${f} must list existing settlements`);
  }
  if (P.length) return P;
  const n = p.table.length;
  const okVal = (v) => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return true;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    const keys = Object.keys(v);
    if (hasOwn(v, '$r')) return keys.length === 1 && Number.isInteger(v.$r) && v.$r >= 0 && v.$r < n;
    if (hasOwn(v, '$u')) return keys.length === 1;
    if (hasOwn(v, '$n')) return keys.length === 1 && ['Infinity', '-Infinity', 'NaN'].includes(v.$n);
    if (hasOwn(v, '$s')) return keys.length === 2 && ENTITY_COLLS.includes(v.$s) && typeof v.id === 'string' && SAFE_ID.test(v.id);
    return false;
  };
  for (let k = 0; k < n && P.length < 10; k++) {
    const e = p.table[k], kind = kindOf(e);
    if (!kind) { bad(`entry ${k} is of an unknown kind`); continue; }
    if (e.$p !== undefined && (kind === 'o' || !e.$p || typeof e.$p !== 'object' || Array.isArray(e.$p) || !Object.values(e.$p).every(okVal))) bad(`entry ${k} holds a bad property`);
    if (kind === 'a' && !e.$a.every(okVal)) bad(`entry ${k} holds a bad value`);
    if (kind === 'm' && !e.$m.every((x) => Array.isArray(x) && x.length === 2 && okVal(x[0]) && okVal(x[1]))) bad(`entry ${k} holds a bad map entry`);
    if (kind === 'set' && !e.$set.every(okVal)) bad(`entry ${k} holds a bad value`);
    if (kind === 'o' && !Object.values(e.$o).every(okVal)) bad(`entry ${k} holds a bad value`);
  }
  if (!okVal(p.root) || !hasOwn(p.root, '$r')) bad('root is malformed');
  return P;
}

/** Rebuild the planner state against a loaded state (after checkPlanner found no problems). Throws an Error
 *  with the reason if an entity it refers to is missing or a value is malformed (the save is refused); returns
 *  { dropped: reason } if the plans are well formed but do not fit (the loaded game plans afresh). */
export function decodePlanner(p, s) {
  const kinds = p.table.map(kindOf);
  const objs = kinds.map((k) => (k === 'a' ? [] : k === 'm' ? new Map() : k === 'set' ? new Set() : {}));
  const dec = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (hasOwn(v, '$r')) return objs[v.$r];
    if (hasOwn(v, '$u')) return undefined;
    if (hasOwn(v, '$n')) return Number(v.$n);
    if (hasOwn(v, '$s')) {
      const coll = s[v.$s];
      if (!hasOwn(coll, v.id) || !coll[v.id] || typeof coll[v.id] !== 'object') throw new Error(`a plan refers to ${v.$s} "${v.id}", which is not in the save`);
      return coll[v.id];
    }
    throw new Error('a plan value is malformed');
  };
  const put = (o, key, val) => { if (BAD_KEYS.has(key)) throw new Error(`forbidden key "${key}"`); Object.defineProperty(o, key, { value: val, enumerable: true, writable: true, configurable: true }); };
  p.table.forEach((e, k) => {
    const o = objs[k];
    if (kinds[k] === 'a') for (const x of e.$a) o.push(dec(x));
    else if (kinds[k] === 'm') for (const [a, b] of e.$m) o.set(dec(a), dec(b));
    else if (kinds[k] === 'set') for (const x of e.$set) o.add(dec(x));
    else for (const [key, x] of Object.entries(e.$o)) put(o, key, dec(x));
    if (kinds[k] !== 'o' && e.$p) for (const [key, x] of Object.entries(e.$p)) put(o, key, dec(x));
  });
  const root = dec(p.root);
  // Well formed but not fitting: the loaded game plans afresh instead (save.js).
  const soft = [];
  if (!isPlain(root) || !isPlain(root.plans) || !hasOwn(root, 'plan') || (root.plan !== null && !isPlain(root.plan))) soft.push('the saved plans are malformed');
  else {
    for (const [sid, P] of Object.entries(root.plans)) {
      if (!hasOwn(s.settlements, sid)) soft.push(`a plan belongs to settlement "${sid}", which is not in the save`);
      else for (const m of planShapeProblems(P)) soft.push(`${sid}: ${m}`);
    }
    if (root.plan) for (const m of planShapeProblems(root.plan)) soft.push(`the player's plan: ${m}`);
  }
  if (soft.length) return { dropped: soft.slice(0, 3).join('; ') };
  return {
    plans: root.plans, plan: root.plan,
    planDirty: p.planDirty,
    replanSids: p.replanSids ? new Set(p.replanSids) : null,
    replanLater: p.replanLater ? new Set(p.replanLater) : undefined,
  };
}

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Map) && !(v instanceof Set);
/** The fields every plan has (planner.js emptyPlan), with their types. Returns the problems found. */
export function planShapeProblems(P) {
  if (!isPlain(P)) return ['not an object'];
  const out = [];
  const want = (key, ok, what) => { if (!ok(P[key])) out.push(`${key} must be ${what}`); };
  for (const key of ['wants', 'seedReserve', 'goalInfo', 'blockers', 'trace', 'stock', 'stations', 'tradeNeeds', 'landNeeds', 'surplus']) want(key, isPlain, 'an object');
  for (const key of ['bills', 'equipNeeds', 'notes']) want(key, Array.isArray, 'a list');
  want('clear', (v) => v instanceof Map, 'a map');
  want('techWanted', (v) => v instanceof Set, 'a set');
  for (const key of ['tick', 'foodDays', 'growingDays', 'mealCount', 'bedsBuilt']) want(key, (v) => typeof v === 'number', 'a number');
  for (const w of Object.values(isPlain(P.wants) ? P.wants : {})) if (!isPlain(w) || typeof w.remaining !== 'number') { out.push('a want is malformed'); break; }
  return out;
}
