// Mood (docs/proposals/mood.md): every person has a mood, -100..100, that moves toward the sum of their thoughts.
// - Thoughts (content type `thought`, data mods/core/content/mood.json) hold the names and values; when each applies
//   is decided here by its id, from inputs full and distant villages share (needs, home and furniture, the last
//   meal and night, grief, health, the cold, the village's laws, war, deaths, crowding). Rooms, light and positions
//   are not used: distant villages have none of them.
// - Once an hour (game.js) every person's mood moves a tenth of the way to its target (thoughts + traits).
//   The village facts are worked out fresh for each pass, so nothing cached can differ after a load.
// - Saved: colonist.mood (an integer), colonist.ate { t, m (a meal), f (the people's favourite) }, colonist.rough
//   (the tick of the last night on the ground). Old saves start at the target.
import { TICKS_PER_DAY, TICKS_PER_HOUR } from './constants.js';
import { modsOf } from './peoples.js';
import { civLawOf, leaningsOf } from './civlaws.js';
import { hpOf } from './health.js';
import { sicknessOf } from './illness.js';
import { coldUnder } from './life.js';
import { isEnemy } from './combat.js';
import { memoryMood, traditionMood } from './memories.js';

export const MOOD = Object.freeze({ breakChance: 0.3, breakHours: 3, breakHour: 9, happyWork: 0.05, sadWork: 0.15, min: -100, max: 100, rate: 0.1, content: 20, unhappy: -20, miserable: -50, memoryDays: 1, deathDays: 3, homeless: 0.3, hurtHp: 70, maxScars: 2 });

const sidOf = (g, c) => c.settlementId || g.s.playerSettlement;
const draw = (key) => { let h = 2166136261; for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); } h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
const val = (g, id) => g.reg.get('thought', id)?.value ?? 0;

/** Record what colonist c just ate (the three eating places: the eat job, being fed, distant villages). */
export function noteMeal(g, c, item) {
  const d = g.reg.get('item', item);
  const fav = c.people ? g.reg.get('people', c.people)?.food : null;
  c.ate = { t: g.s.tick, m: !!d?.tags?.includes('core:meal'), f: !!fav && item === fav };
}

// The building kinds that are beds (not medical), once per registry (a registry never changes once built): the
// count below looked each building's kind up twice (Phase 18: 2.5% of a big world's ordinary ticks).
const BED_DEFS = new WeakMap();
function bedDefs(reg) {
  let d = BED_DEFS.get(reg);
  if (!d) { d = new Set(reg.all('building').filter((b) => b.bed && !b.medical).map((b) => b.id)); BED_DEFS.set(reg, d); }
  return d;
}
/** Built beds (not medical) per village. */
function countBeds(g, list) {
  const beds = new Map(), kinds = bedDefs(g.reg);
  for (const b of list) if (b.built && kinds.has(b.def)) { const k = b.settlement || g.s.playerSettlement; beds.set(k, (beds.get(k) || 0) + 1); }
  return beds;
}
// Built beds per village, kept until a building is added, removed or finished (structRev, builtRev: the key
// power.js, water.js and lod.js already use); derived, never saved. Each village is recounted from its own
// buildings only when it is asked about after a change (the whole world was recounted at every change: about 4% of
// a big world's ticks paid 16 ms for it; the scale target).
const BEDS = new WeakMap();
function bedsOf(g, sid) {
  const key = `${g.structRev || 0}|${g.builtRev || 0}`;
  let c = BEDS.get(g.s);
  if (!c) { c = new Map(); BEDS.set(g.s, c); }
  let e = c.get(sid);
  if (!e || e.key !== key) { e = { key, n: countBeds(g, g.owned('structures', sid)).get(sid) || 0 }; c.set(sid, e); }
  return e.n;
}

// Each village's latest death tick (the dead's `tick`, -1e9 when missing), kept until someone dies (g.deadRev,
// death.js: the only place the dead are added) or another game state is read; derived, never saved. "A death in the
// last deathDays" is then one look-up (it went over every dead person in the world, for each village asked about).
const DEATHS = new WeakMap();
function latestDeaths(g) {
  let c = DEATHS.get(g.s);
  if (!c || c.rev !== (g.deadRev || 0) || c.g !== g) {
    const m = new Map();
    for (const d of Object.values(g.s.dead || {})) if (d.settlementId) { const t = d.tick ?? -1e9; if (!m.has(d.settlementId) || t > m.get(d.settlementId)) m.set(d.settlementId, t); }
    c = { rev: g.deadRev || 0, g, m }; DEATHS.set(g.s, c);
  }
  return c.m;
}

/** Facts about every village for one pass: { sid: { laws, war, death, crowded } }. O(villages^2 + buildings). */
export function villageFacts(g, only = null) {
  const s = g.s, out = {}, all = Object.keys(s.settlements || {}).sort(), sids = only ? [only] : all;
  const laws = g.reg.all('civLaw');
  const latest = latestDeaths(g), recentOf = (sid) => latest.has(sid) && s.tick - latest.get(sid) < MOOD.deathDays * TICKS_PER_DAY;

  for (const sid of sids) {
    if (s.settlements[sid].fallen) continue;
    // The laws' mood, from the defaults (so a village with no laws reads 0), by option; a people's own leanings
    // never count against it (mood.js thoughtsOf).
    const code = {};
    for (const L of laws) { const o = civLawOf(g, sid, L.id); if (o !== L.options[0].id) code[L.id] = o; }
    out[sid] = {
      code, lean: leaningsOf(g, sid),
      war: all.some((o) => o !== sid && isEnemy(g, sid, o)),
      death: recentOf(sid),
      crowded: g.owned('colonists', sid).length > bedsOf(g, sid),
    };
  }
  return out;
}

const optionMood = (g, id, o) => g.reg.get('civLaw', id)?.options?.find((x) => x.id === o)?.mood ?? 0;

/** The laws' share of colonist c's mood in village facts V (each option's mood less the default's; a people's own
 *  leaning counts at least 0 for them). */
function lawMood(g, c, V) {
  let m = 0;
  for (const [id, o] of Object.entries(V.code)) {
    const L = g.reg.get('civLaw', id);
    let d = optionMood(g, id, o) - optionMood(g, id, L.options[0].id);
    if (d < 0 && V.lean[id] === o) d = 0;
    m += d;
  }
  return m * val(g, 'core:laws');
}

/** A home's comfort: its furniture beyond the bed (furnishing scores of built parts), 0..core:comfort. */
function comfortOf(g, home) {
  const parts = g.s.projects?.[home.projectId]?.parts || [];
  let score = 0;
  for (const id of parts) { const b = g.s.structures[id]; if (b?.built) score += g.bDef(b)?.furnishing?.score || 0; }
  return Math.max(0, Math.min(val(g, 'core:comfort'), Math.round((score - 1) * 2)));
}

// The need with each behaviour, looked up once per registry (a registry never changes once built): thoughtsOf asked
// reg.all('need'), a fresh copy of the list, four times a person an hour (the scale target).
const NEEDS = new WeakMap();
function needOf(g, beh) {
  let m = NEEDS.get(g.reg);
  if (!m) { m = new Map(); NEEDS.set(g.reg, m); }
  if (!m.has(beh)) m.set(beh, g.reg.all('need').find((n) => n.behavior === beh));
  return m.get(beh);
}

/** Colonist c's thoughts now: [{ id, name, value }] (V: village facts, worked out if not given). */
export function thoughtsOf(g, c, V = null) {
  const s = g.s, out = [], add = (id, value = val(g, id)) => { if (value) out.push({ id, name: g.reg.get('thought', id)?.name || id, value }); };
  const need = (beh) => needOf(g, beh);
  for (const [beh, mild, bad] of [['core:eat', 'core:hungry', 'core:starving'], ['core:drink', 'core:thirsty', 'core:parched']]) {
    const n = need(beh);
    if (!n) continue;
    const v = c.needs[n.id] ?? 1;
    if (v < n.urgentBelow) add(bad); else if (v < n.seekBelow) add(mild);
  }
  const en = need('core:sleep');
  if (en && (c.needs[en.id] ?? 1) < en.urgentBelow) add('core:exhausted');
  const sh = need('core:shelter');
  if (sh && (c.needs[sh.id] ?? 1) < MOOD.homeless && !c.homeId) add('core:homeless');
  const home = c.homeId && s.homes?.[c.homeId];
  if (home?.complete && c.bedId) { add('core:own_home'); add('core:comfort', comfortOf(g, home)); }
  if (c.rough !== undefined && s.tick - c.rough < TICKS_PER_DAY) add('core:slept_rough');
  if (c.ate && s.tick - c.ate.t < MOOD.memoryDays * TICKS_PER_DAY) { if (c.ate.m) add('core:good_meal'); if (c.ate.f) add('core:favourite_food'); }
  if (c.grief && c.grief.until > s.tick) add('core:grieving');
  if (hpOf(c) < MOOD.hurtHp) add('core:hurt');
  if (sicknessOf(c)) add('core:ill');
  const scars = Math.min(MOOD.maxScars, (c.lasting || []).length);
  if (scars) add('core:scarred', val(g, 'core:scarred') * scars);
  if (coldUnder(g, c) > 0) add('core:freezing');
  V ||= villageFacts(g, sidOf(g, c))[sidOf(g, c)];
  if (V) {
    add('core:laws', lawMood(g, c, V));
    if (V.war) add('core:at_war');
    if (V.death) add('core:death');
    if (V.crowded) add('core:crowded');
  }
  const sid = sidOf(g, c); // Phase 15: the village's memories and traditions (memories.js)
  add('core:memories', memoryMood(g, sid));
  add('core:traditions', traditionMood(g, sid));
  return out;
}

/** The mood colonist c moves toward: their thoughts plus their traits (Cheerful, Gloomy), clamped. */
export function moodTarget(g, c, V = null) {
  const t = thoughtsOf(g, c, V).reduce((a, x) => a + x.value, 0) + modsOf(g, c).mood;
  return Math.max(MOOD.min, Math.min(MOOD.max, Math.round(t)));
}

/** Colonist c's mood now (their saved mood, or their target before the first pass). */
export function moodOf(g, c) { return c.mood ?? 0; }

/** The work-speed factor of mood m: 1 + 0.05 at +50 and above, 1 - 0.15 at -50 and below, a straight line between. */
export function moodWork(m) {
  if (!m) return 1;
  const k = Math.max(-1, Math.min(1, m / 50));
  return 1 + (k > 0 ? MOOD.happyWork : MOOD.sadWork) * k;
}
/** The birth chance's factor for two parents (0.75..1.25 by their mean mood). */
export function moodBirth(a, b) { return 1 + Math.max(-0.25, Math.min(0.25, (((a?.mood ?? 0) + (b?.mood ?? 0)) / 2) / 400)); }
/** Is colonist c on a break (miserable, sulking) now? */
export const onBreak = (g, c) => (c.breakUntil ?? -1) > g.s.tick;

/** content | fine | unhappy | miserable. */
export function moodLevel(m) { return m >= MOOD.content ? 'content' : m <= MOOD.miserable ? 'miserable' : m <= MOOD.unhappy ? 'unhappy' : 'fine'; }

/** A tenth of the way from m to target, at least 1 (whole numbers, so it settles exactly on the target). */
export function stepToward(m, target) {
  const gap = target - m;
  if (!gap) return m;
  return m + Math.sign(gap) * Math.max(1, Math.round(Math.abs(gap) * MOOD.rate));
}

/** A person's tick within the hour for their mood step (0..TICKS_PER_HOUR-1; a hash of their id). Spreading the
 *  hourly pass over the hour keeps hour ticks of big worlds from being much slower than the rest
 *  (docs/proposals/spread-the-peaks.md). */
export const moodSlot = (id) => Math.floor(draw(`moodslot:${id}`) * TICKS_PER_HOUR);
// People by mood slot, each list sorted by id; derived, never saved; rebuilt when someone is born, arrives or dies.
const SLOTS = new WeakMap();
function slotLists(g) {
  const key = `${g.s.nextId}:${g.ownIndex('colonists').n}`;
  let c = SLOTS.get(g.s);
  if (!c || c.key !== key) {
    const lists = Array.from({ length: TICKS_PER_HOUR }, () => []);
    for (const id of Object.keys(g.s.colonists).sort()) lists[moodSlot(id)].push(id);
    c = { key, lists }; SLOTS.set(g.s, c);
  }
  return c.lists;
}
// The village facts for this tick's slot: worked out on the tick, only for the villages of the people stepping
// (a few a tick), so a game loaded in the middle of the hour reads exactly what the unsaved one does.
function tickFacts(g, ids) {
  const V = {};
  for (const id of ids) { const c = g.s.colonists[id], sid = c && sidOf(g, c); if (c && !(sid in V)) V[sid] = villageFacts(g, sid)[sid]; }
  return V;
}

/** Each tick (game.js, with `slot` = the tick within the hour): the mood of the people whose slot it is moves
 *  toward its target, so everyone steps once an hour; a night on the ground is noted. Without `slot`, everyone at
 *  once (tests, tools). O(people) an hour. */
export function tickMood(g, slot = null) {
  const s = g.s, night = g.isNight();
  const ids = slot === null ? Object.keys(s.colonists).sort() : slotLists(g)[slot];
  if (!ids.length) return;
  const V = slot === null ? villageFacts(g) : tickFacts(g, ids);
  for (const id of ids) {
    if (!s.colonists[id]) continue;
    const c = s.colonists[id], sid = sidOf(g, c);
    // A night on the ground: asleep without a bed (full detail: the sleep job; distant: no built bed at night).
    if (night && (c.job?.type === 'sleep' ? !c.job.bedId : s.settlements?.[sid]?.detail === 'abstract' && !(c.bedId && s.structures[c.bedId]?.built))) c.rough = s.tick;
    const target = moodTarget(g, c, V[sid]);
    c.mood = c.mood === undefined ? target : stepToward(c.mood, target);
    // Breaks: at BREAK_HOUR a miserable adult may stop work for a few hours (a hash draw: no g.rng).
    if (Math.floor(g.hour) === MOOD.breakHour && c.mood <= MOOD.miserable && !onBreak(g, c) && draw(`${s.seed}:break:${id}:${Math.floor(s.tick / TICKS_PER_DAY)}`) < MOOD.breakChance) {
      c.breakUntil = s.tick + MOOD.breakHours * (TICKS_PER_DAY / 24);
      g.log(`${c.name} is miserable and stops work for a while.`, sid === s.playerSettlement ? 'warn' : 'info', `break:${id}`, 2400);
    }
    if (c.breakUntil !== undefined && c.breakUntil <= s.tick) delete c.breakUntil;
  }
}

/** The village's mood for its plan (planner.js P.moodNote): its average, how many are unhappy, and the commonest
 *  bad thoughts among them. */
export function moodNote(g, cols) {
  if (!cols.length) return '';
  const avg = Math.round(cols.reduce((a, c) => a + moodOf(g, c), 0) / cols.length);
  const low = cols.filter((c) => moodOf(g, c) <= MOOD.unhappy);
  let why = '';
  if (low.length) {
    const sid = sidOf(g, cols[0]), V = villageFacts(g, sid), count = new Map();
    for (const c of low) for (const t of thoughtsOf(g, c, V[sid])) if (t.value < 0) count.set(t.name, (count.get(t.name) || 0) + 1);
    why = [...count].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(([n]) => n.toLowerCase()).join(', ');
  }
  return `Mood: ${moodLevel(avg)} (${avg})${low.length ? `; ${low.length} of ${cols.length} unhappy${why ? `: ${why}` : ''}` : ''}`;
}
