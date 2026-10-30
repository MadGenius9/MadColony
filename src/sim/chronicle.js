// The world chronicle (Phase 12, docs/proposals/phase-12-chronicle.md). It is the log (g.log) with more fields,
// not a second event system: a line written with event details (`ev`) gets a stable id `e<n>`, a kind (data:
// `eventKind`), the villages and people it concerns, a place, and links. Kinds rated notable or milestone are
// kept apart from routine lines: the newest CHRONICLE.routine routine lines and CHRONICLE.events notable and
// milestone events stay in s.log; older events fold into yearly counts per village (s.chronicle.years).
// s.chronicle (save format 34): { next, years, folded, follow, favs }.
import { TICKS_PER_DAY } from './constants.js';

export const CHRONICLE = { routine: 500, events: 2000 };
const IMPORTANCE = new Set(['notable', 'milestone']);

/** The days in a year of this world (the seasons' cycle, as heat.js reads it). */
export const yearOf = (g, tick) => Math.floor(tick / TICKS_PER_DAY / (g.reg.get('worldgen', g.s.worldgenId)?.climate?.yearDays || 30));

const kindOf = (g, kind) => (kind ? g.reg.get('eventKind', kind) : null);
/** Is this log entry kept as a notable or milestone event (else it rolls off with the routine lines)? */
export const isEvent = (g, e) => !!e.id && IMPORTANCE.has(kindOf(g, e.kind)?.importance);

export function chronicleOf(g) {
  return (g.s.chronicle ||= { next: 1 });
}

const ids = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x))].sort() : []);

/** Fill a new log entry's event fields from `ev` { kind, sids, cids, at, cause, rel } (g.log's last argument). */
export function stampEvent(g, e, ev) {
  const C = chronicleOf(g);
  e.id = `e${C.next++}`;
  if (ev.kind) e.kind = ev.kind;
  const sids = ids(ev.sids), cids = ids(ev.cids);
  if (sids.length) e.sids = sids;
  if (cids.length) e.cids = cids;
  if (ev.at && Number.isFinite(ev.at.x) && Number.isFinite(ev.at.y)) e.at = { x: Math.round(ev.at.x), y: Math.round(ev.at.y) };
  if (typeof ev.cause === 'string' && ev.cause) e.cause = ev.cause;
  if (typeof ev.rel === 'string' && ev.rel) e.rel = ev.rel;
}

// The number of notable and milestone events in a log array; derived, never saved (recounted when the array is
// new or was changed outside g.log).
const COUNTS = new WeakMap();
function eventCount(g, log) {
  const c = COUNTS.get(log);
  if (c && c.len === log.length) return c;
  const fresh = { len: log.length, events: log.reduce((n, e) => n + (isEvent(g, e) ? 1 : 0), 0) };
  COUNTS.set(log, fresh);
  return fresh;
}

/** Fold one event into its year's counts per village ('world' when it names none). */
function fold(g, e) {
  const C = chronicleOf(g);
  const Y = ((C.years ||= {})[yearOf(g, e.t)] ||= {});
  for (const sid of e.sids?.length ? e.sids : ['world']) { const V = (Y[sid] ||= {}); V[e.kind] = (V[e.kind] || 0) + 1; }
  const n = Number(e.id.slice(1));
  if (!(C.folded >= n)) C.folded = n;
}

/** After a push: keep the caps. Called by g.log with the entry it just added. */
export function trimLog(g, added) {
  const log = g.s.log;
  let c = COUNTS.get(log);
  if (c && c.len === log.length - 1) { c.len++; if (isEvent(g, added)) c.events++; }
  else c = eventCount(g, log);
  while (log.length - c.events > CHRONICLE.routine) {
    log.splice(log.findIndex((e) => !isEvent(g, e)), 1);
    c.len--;
  }
  while (c.events > CHRONICLE.events) {
    const i = log.findIndex((e) => isEvent(g, e));
    fold(g, log[i]);
    log.splice(i, 1);
    c.len--; c.events--;
  }
}

// ---------- reading (slice 3): filters, chains, subjects, follow and favourites, notifications ----------
const ID = /^e\d{1,9}$/;
/** The event with this id: the log entry, { id, summarised: true } once folded into the yearly counts, or null. */
export function eventById(g, id) {
  if (typeof id !== 'string' || !ID.test(id)) return null;
  const e = g.s.log.find((x) => x.id === id);
  if (e) return e;
  return Number(id.slice(1)) <= (g.s.chronicle?.folded ?? 0) ? { id, summarised: true } : null;
}

/** A person's family as the game records it: them, their parents, their children and those who share a parent
 *  (the living and the dead). */
export function familyOf(g, cid) {
  const all = [...Object.entries(g.s.colonists || {}), ...Object.entries(g.s.dead || {})]; // the dead are kept by id
  const me = g.s.colonists?.[cid] || g.s.dead?.[cid];
  const parents = new Set(me?.parents || []);
  const out = new Set([cid, ...parents]);
  for (const [pid, p] of all) {
    if (!p?.parents) continue;
    if (p.parents.includes(cid) || p.parents.some((x) => parents.has(x))) out.add(pid);
  }
  return [...out].sort();
}

/** Events matching a filter, oldest first. Every field is optional: sid (a village), cid (a person), family (a
 *  person: their family), kingdom (its member villages now), kind, cat, importance (or a list), from and to
 *  (ticks, inclusive), followed (only what the player follows). Lines without an id are left out. */
export function eventsOf(g, f = {}) {
  const fam = f.family ? new Set(familyOf(g, f.family)) : null;
  const kin = f.kingdom ? new Set(Object.keys(g.s.settlements || {}).filter((k) => g.s.settlements[k].kingdom === f.kingdom)) : null;
  const imp = f.importance ? new Set([].concat(f.importance)) : null;
  return g.s.log.filter((e) => {
    if (!e.id) return false;
    if (f.sid && !e.sids?.includes(f.sid)) return false;
    if (f.cid && !e.cids?.includes(f.cid)) return false;
    if (fam && !e.cids?.some((c) => fam.has(c))) return false;
    if (kin && !e.sids?.some((s) => kin.has(s))) return false;
    if (f.kind && e.kind !== f.kind) return false;
    if (f.cat && e.cat !== f.cat) return false;
    if (imp && !imp.has(kindOf(g, e.kind)?.importance || 'routine')) return false;
    if (f.from !== undefined && e.t < f.from) return false;
    if (f.to !== undefined && e.t > f.to) return false;
    if (f.followed && !isFollowed(g, e)) return false;
    return true;
  });
}

/** The chain through one event: its recorded causes back (each step 'cause', or 'followed' for an association)
 *  and the events that name it forward. Steps never invent a link: each is a field written when it happened. */
export function chainOf(g, id, max = 20) {
  const start = eventById(g, id);
  if (!start) return null;
  const back = [];
  const seen = new Set([id]);
  for (let e = start; back.length < max && e && !e.summarised;) {
    const next = e.cause || e.rel;
    if (!next || seen.has(next)) break;
    seen.add(next);
    const prev = eventById(g, next);
    back.push({ link: e.cause ? 'cause' : 'followed', event: prev || { id: next, lost: true } });
    e = prev;
  }
  const forward = g.s.log.filter((e) => e.cause === id || e.rel === id).map((e) => ({ link: e.cause === id ? 'cause' : 'followed', event: e }));
  return { event: start, back, forward };
}

/** Where to jump for an event: its place, else the first of its people still alive, else its first village's
 *  centre; with what to open (the people and villages it names). */
export function subjectOf(g, id) {
  const e = eventById(g, id);
  if (!e || e.summarised) return null;
  const alive = (e.cids || []).map((c) => g.s.colonists?.[c]).find(Boolean);
  const st = (e.sids || []).map((s) => g.s.settlements?.[s]).find(Boolean);
  const at = e.at || (alive ? { x: Math.round(alive.x), y: Math.round(alive.y) } : st?.center ? { x: st.center.x, y: st.center.y } : null);
  return { at, sids: e.sids || [], cids: e.cids || [] };
}

// Follow and favourites (saved in s.chronicle; the owner's answer 1). A subject is 'v:<village>', 'p:<person>' or
// 'f:<person>' (that person's family); a favourite is an event id.
const SUBJECT = /^[vpf]:[A-Za-z0-9_:.-]{1,64}$/;
const MAX_LIST = 200;
function toggle(g, list, x, on) {
  const C = chronicleOf(g);
  const L = (C[list] ||= []);
  const i = L.indexOf(x);
  if (on && i < 0) { if (L.length >= MAX_LIST) return { ok: false, message: `At most ${MAX_LIST}.` }; L.push(x); L.sort(); }
  if (!on && i >= 0) L.splice(i, 1);
  if (!L.length) delete C[list];
  return { ok: true };
}
export function follow(g, subject, on = true) {
  if (!SUBJECT.test(subject)) return { ok: false, message: 'Follow a village (v:id), a person (p:id) or a family (f:id).' };
  return toggle(g, 'follow', subject, on);
}
export function favourite(g, id, on = true) {
  if (on && !eventById(g, id)) return { ok: false, message: 'There is no such event.' };
  return toggle(g, 'favs', id, on);
}
export const favourites = (g) => (g.s.chronicle?.favs || []).map((id) => eventById(g, id) || { id, lost: true });

/** Does event e concern something the player follows? */
export function isFollowed(g, e) {
  const F = g.s.chronicle?.follow;
  if (!F?.length) return false;
  for (const f of F) {
    const [t, x] = [f[0], f.slice(2)];
    if (t === 'v' && e.sids?.includes(x)) return true;
    if (t === 'p' && e.cids?.includes(x)) return true;
    if (t === 'f' && e.cids?.length) { const fam = familyOf(g, x); if (e.cids.some((c) => fam.includes(c))) return true; }
  }
  return false;
}

/** Should event e notify the player (the owner's answer 4: world news)? A kind marked 'world' always does; one
 *  marked 'own' when it concerns the player's village or something followed; a followed subject's milestones and
 *  deaths do too. Repeats are already merged by the log's keys. */
export function notifies(g, e) {
  if (!e?.id) return false;
  const K = kindOf(g, e.kind);
  if (!K) return false;
  if (K.notify === 'world') return true;
  const mine = e.sids?.includes(g.s.playerSettlement);
  if (K.notify === 'own' && (mine || isFollowed(g, e))) return true;
  return (K.importance === 'milestone' || e.kind === 'core:death') && isFollowed(g, e);
}

/** The notifications since a tick (for the UI's news list). */
export const newsSince = (g, tick) => g.s.log.filter((e) => e.id && e.t >= tick && notifies(g, e));
