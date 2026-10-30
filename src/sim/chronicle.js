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
