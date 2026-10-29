// Mood (docs/proposals/mood.md): every person has a mood, -100..100, that moves toward the sum of their thoughts.
// - Thoughts (content type `thought`, data mods/core/content/mood.json) hold the names and values; when each applies
//   is decided here by its id, from inputs full and distant villages share (needs, home and furniture, the last
//   meal and night, grief, health, the cold, the village's laws, war, deaths, crowding). Rooms, light and positions
//   are not used: distant villages have none of them.
// - Once an hour (game.js) every person's mood moves a tenth of the way to its target (thoughts + traits).
//   The village facts are worked out fresh for each pass, so nothing cached can differ after a load.
// - Saved: colonist.mood (an integer), colonist.ate { t, m (a meal), f (the people's favourite) }, colonist.rough
//   (the tick of the last night on the ground). Old saves start at the target.
import { TICKS_PER_DAY } from './constants.js';
import { modsOf } from './peoples.js';
import { civLawOf, leaningsOf } from './civlaws.js';
import { hpOf } from './health.js';
import { sicknessOf } from './illness.js';
import { coldUnder } from './life.js';
import { isEnemy } from './combat.js';

export const MOOD = Object.freeze({ min: -100, max: 100, rate: 0.1, content: 20, unhappy: -20, miserable: -50, memoryDays: 1, deathDays: 3, homeless: 0.3, hurtHp: 70, maxScars: 2 });

const sidOf = (g, c) => c.settlementId || g.s.playerSettlement;
const val = (g, id) => g.reg.get('thought', id)?.value ?? 0;

/** Record what colonist c just ate (the three eating places: the eat job, being fed, distant villages). */
export function noteMeal(g, c, item) {
  const d = g.reg.get('item', item);
  const fav = c.people ? g.reg.get('people', c.people)?.food : null;
  c.ate = { t: g.s.tick, m: !!d?.tags?.includes('core:meal'), f: !!fav && item === fav };
}

/** Facts about every village for one pass: { sid: { laws, war, death, crowded } }. O(villages^2 + dead + buildings). */
export function villageFacts(g, only = null) {
  const s = g.s, out = {}, all = Object.keys(s.settlements || {}).sort(), sids = only ? [only] : all;
  const laws = g.reg.all('civLaw');
  const recent = new Set();
  for (const d of Object.values(s.dead || {})) if (s.tick - (d.tick ?? -1e9) < MOOD.deathDays * TICKS_PER_DAY && d.settlementId) recent.add(d.settlementId);
  const beds = new Map();
  for (const b of only ? g.owned('structures', only) : Object.values(s.structures)) if (b.built && g.bDef(b)?.bed && !g.bDef(b).medical) { const k = b.settlement || s.playerSettlement; beds.set(k, (beds.get(k) || 0) + 1); }
  for (const sid of sids) {
    if (s.settlements[sid].fallen) continue;
    // The laws' mood, from the defaults (so a village with no laws reads 0), by option; a people's own leanings
    // never count against it (mood.js thoughtsOf).
    const code = {};
    for (const L of laws) { const o = civLawOf(g, sid, L.id); if (o !== L.options[0].id) code[L.id] = o; }
    out[sid] = {
      code, lean: leaningsOf(g, sid),
      war: all.some((o) => o !== sid && isEnemy(g, sid, o)),
      death: recent.has(sid),
      crowded: g.owned('colonists', sid).length > (beds.get(sid) || 0),
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

/** Colonist c's thoughts now: [{ id, name, value }] (V: village facts, worked out if not given). */
export function thoughtsOf(g, c, V = null) {
  const s = g.s, out = [], add = (id, value = val(g, id)) => { if (value) out.push({ id, name: g.reg.get('thought', id)?.name || id, value }); };
  const need = (beh) => g.reg.all('need').find((n) => n.behavior === beh);
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
  return out;
}

/** The mood colonist c moves toward: their thoughts plus their traits (Cheerful, Gloomy), clamped. */
export function moodTarget(g, c, V = null) {
  const t = thoughtsOf(g, c, V).reduce((a, x) => a + x.value, 0) + modsOf(g, c).mood;
  return Math.max(MOOD.min, Math.min(MOOD.max, Math.round(t)));
}

/** Colonist c's mood now (their saved mood, or their target before the first pass). */
export function moodOf(g, c) { return c.mood ?? 0; }

/** content | fine | unhappy | miserable. */
export function moodLevel(m) { return m >= MOOD.content ? 'content' : m <= MOOD.miserable ? 'miserable' : m <= MOOD.unhappy ? 'unhappy' : 'fine'; }

/** A tenth of the way from m to target, at least 1 (whole numbers, so it settles exactly on the target). */
export function stepToward(m, target) {
  const gap = target - m;
  if (!gap) return m;
  return m + Math.sign(gap) * Math.max(1, Math.round(Math.abs(gap) * MOOD.rate));
}

/** Hourly (game.js): every person's mood moves toward its target; a night on the ground is noted. O(people). */
export function tickMood(g) {
  const s = g.s, V = villageFacts(g), night = g.isNight();
  for (const id of Object.keys(s.colonists).sort()) {
    const c = s.colonists[id], sid = sidOf(g, c);
    // A night on the ground: asleep without a bed (full detail: the sleep job; distant: no built bed at night).
    if (night && (c.job?.type === 'sleep' ? !c.job.bedId : s.settlements?.[sid]?.detail === 'abstract' && !(c.bedId && s.structures[c.bedId]?.built))) c.rough = s.tick;
    const target = moodTarget(g, c, V[sid]);
    c.mood = c.mood === undefined ? target : stepToward(c.mood, target);
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
