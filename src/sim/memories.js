// Village memories and traditions (Phase 15, docs/proposals/phase-15-memories.md). A memory is a meaningful
// experience a village went through (data: `memory`), held for a time with a small mood; gathering `count`
// memories of one kind over its history gives the village a lasting tradition (data: `tradition`) with a modest
// effect. Each memory keeps the chronicle event it came from; each tradition the events behind it. Bounded:
// MEMORY.max memories, a stack per kind, MEMORY.traditions traditions, the memories' mood capped at
// ±MEMORY.moodCap. State on the settlement (save format 37): memories, memCount, traditions, famine.
import { TICKS_PER_DAY } from './constants.js';

export const MEMORY = Object.freeze({ max: 8, traditions: 3, moodCap: 6, famine: { below: 1, days: 2, back: 4 }, why: 8 });

const memDef = (g, kind) => g.reg.get('memory', kind);

/** Village sid lived through `kind` (the event `ev` records it). Returns the memory, or null. */
export function addMemory(g, sid, kind, ev) {
  const st = g.s.settlements?.[sid], D = memDef(g, kind);
  if (!st || st.fallen || !D) return null;
  const M = (st.memories ||= []);
  const m = { kind, t: g.s.tick, ...(ev ? { ev } : {}) };
  M.push(m);
  const same = M.filter((x) => x.kind === kind);
  if (same.length > (D.stack ?? 2)) M.splice(M.indexOf(same[0]), 1);
  if (M.length > MEMORY.max) M.splice(0, M.length - MEMORY.max);
  const C = (st.memCount ||= {});
  C[kind] = Math.min(9999, (C[kind] || 0) + 1);
  adoptTraditions(g, sid, kind);
  return m;
}

function adoptTraditions(g, sid, kind) {
  const st = g.s.settlements[sid], T = (st.traditions ||= []);
  for (const D of g.reg.all('tradition')) {
    if (D.from !== kind || T.some((t) => t.id === D.id) || (st.memCount[kind] || 0) < D.count) continue;
    if (T.length >= MEMORY.traditions) break;
    const why = st.memories.filter((m) => m.kind === kind && m.ev).map((m) => m.ev).slice(-MEMORY.why);
    const n = st.memCount[kind], mem = memDef(g, kind);
    const t = { id: D.id, since: g.s.tick, ...(why.length ? { why } : {}) };
    const ev = g.log(`${st.name} has a new tradition: ${D.name} (${(mem?.name || kind).toLowerCase()}, ${n} times). ${D.about || ''}`.trim(), sid === g.s.playerSettlement ? 'good' : 'info', null, 0,
      { kind: 'core:tradition', sids: [sid], cause: why.at(-1) });
    if (ev) t.ev = ev;
    T.push(t);
  }
  if (!T.length) delete st.traditions;
}

/** Daily (game.js): memories past their days fade; a famine that has ended becomes a memory. */
export function tickMemories(g) {
  const s = g.s;
  if (!g.reg.all('memory').length) return;
  for (const sid of Object.keys(s.settlements || {}).sort()) {
    const st = s.settlements[sid];
    if (st.fallen) continue;
    if (st.memories) {
      st.memories = st.memories.filter((m) => s.tick - m.t < (memDef(g, m.kind)?.days ?? 0) * TICKS_PER_DAY);
      if (!st.memories.length) delete st.memories;
    }
    const f = g.plans?.[sid]?.foodDays;
    if (f === undefined || !memDef(g, 'core:famine_survived')) continue;
    if (f < MEMORY.famine.below) st.famine ??= s.tick;
    else if (st.famine !== undefined && f >= MEMORY.famine.back) {
      const long = s.tick - st.famine >= MEMORY.famine.days * TICKS_PER_DAY;
      delete st.famine;
      if (long && g.owned('colonists', sid).length) {
        const ev = g.log(`${st.name} came through a famine.`, sid === s.playerSettlement ? 'good' : 'info', null, 0, { kind: 'core:memory', sids: [sid] });
        addMemory(g, sid, 'core:famine_survived', ev);
      }
    }
  }
}

/** After a god power (game.js afterPower): villages it touched with a disaster remember it. */
export function rememberPower(g, cmd, sids, ev) {
  for (const D of g.reg.all('memory')) if (D.powers?.includes(cmd.type)) for (const sid of sids || []) addMemory(g, sid, D.id, ev);
}

const traditionsOf = (g, sid) => (g.s.settlements?.[sid]?.traditions || []).map((t) => g.reg.get('tradition', t.id)).filter(Boolean);
export const hasTradition = (g, sid, id) => !!g.s.settlements?.[sid]?.traditions?.some((t) => t.id === id);

/** The memories' share of the village's mood (the "Memories" thought), capped. */
export function memoryMood(g, sid) {
  const M = g.s.settlements?.[sid]?.memories;
  if (!M?.length) return 0;
  const half = new Set(traditionsOf(g, sid).map((T) => T.halve).filter(Boolean));
  let m = 0;
  for (const x of M) { const v = memDef(g, x.kind)?.mood || 0; m += half.has(x.kind) ? v / 2 : v; }
  return Math.max(-MEMORY.moodCap, Math.min(MEMORY.moodCap, Math.round(m)));
}
/** The traditions' share of the mood (the "Traditions" thought). */
export const traditionMood = (g, sid) => traditionsOf(g, sid).reduce((a, T) => a + (T.mood || 0), 0);
/** The law leanings the village's traditions add (civlaws.js leaningsOf). */
export const traditionCode = (g, sid) => Object.assign({}, ...traditionsOf(g, sid).map((T) => T.code || {}));
/** How much longer its prayers stay open (petitions.js). */
export const petitionPatience = (g, sid) => traditionsOf(g, sid).reduce((a, T) => a * (T.petitionDays || 1), 1);

/** For the UI: a village's memories (with names and days left) and traditions (with why). */
export function memoriesOf(g, sid) {
  const st = g.s.settlements?.[sid];
  return {
    memories: (st?.memories || []).map((m) => ({ ...m, name: memDef(g, m.kind)?.name || m.kind, mood: memDef(g, m.kind)?.mood || 0, daysLeft: Math.max(0, Math.ceil(((memDef(g, m.kind)?.days || 0) * TICKS_PER_DAY - (g.s.tick - m.t)) / TICKS_PER_DAY)) })),
    traditions: (st?.traditions || []).map((t) => ({ ...t, name: g.reg.get('tradition', t.id)?.name || t.id, about: g.reg.get('tradition', t.id)?.about || '' })),
    mood: memoryMood(g, sid) + traditionMood(g, sid),
  };
}
