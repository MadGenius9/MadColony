// God powers "bless" and "inspire" (Phase 2c slice 3, docs/proposals/phase-2c-god-powers.md). Registered once when
// this module loads.
//
// bless { settlementId }: for godRules.bless.days the village works faster and grows faster.
//   s.god.blessings[sid] = { until, work, growth } (format 13). workSpeed (ai/jobs.js) multiplies by `work` while
//   until > tick, which covers every job and the abstract tasks of a distant village (lod.js calls workSpeed); the
//   daily birth chance (people.js) is multiplied by `growth` with the same single rng draw. Blessing again extends
//   it by `days`, up to maxDays from now; `until` is rounded up to a day start (texts say "until the start of day
//   N"). At each day start the records of ended blessings (and of villages that
//   are gone) are dropped with a log line: O(blessings), only while s.god exists.
// inspire { settlementId }: adds inspire.fraction x the research work of the village's current tech (else the tech
//   its researchers would pick next, research.js chooseTech) to its progress, and completes the tech when the work
//   is reached (completeTech). A tech whose materials are not yet paid keeps its progress at the full amount and is
//   completed by the researchers once they pay (the materials still go through g.consume). Works the same for an
//   abstract village (lod.js taskResearch reads the same progress). Refused when there is nothing to research.
//
// No random numbers, nothing created. Cost: once per command O(techs) at most (chooseTech); per tick nothing beyond
// blessingOf (O(1), skipped without s.god).
import { registerPower, effectTick } from './god.js';
import { TICKS_PER_DAY } from './constants.js';
import { settlementOf, eligibleTechs, chooseTech, completeTech } from './research.js';

const dayOf = (tick) => Math.floor(tick / TICKS_PER_DAY) + 1;
const BAD_KEYS = ['__proto__', 'constructor', 'prototype'];
const fmtX = (v) => `×${Math.round(v * 100) / 100}`;
const fmtD = (d) => { const r = Math.round(d * 10) / 10; return `${r} day${r === 1 ? '' : 's'}`; };

/** Check { settlementId } and nothing else: null or a refusal reason. */
function villageProblem(g, a, what) {
  const k = Object.keys(a).find((x) => x !== 'settlementId');
  if (k) return `${what} takes only settlementId (not "${String(k).slice(0, 40)}")`;
  const sid = a.settlementId;
  if (typeof sid !== 'string' || BAD_KEYS.includes(sid) || !Object.hasOwn(g.s.settlements || {}, sid)) return 'there is no such village';
  if (g.s.settlements[sid].fallen) return `${g.s.settlements[sid].name} has fallen; only ruins are left`; // fallen.js
  return null;
}

// ---------------- bless ----------------
/** What a blessing would be when it applies (effectTick): { until, days (from then), extends } or { reason }. Read-only. */
function blessPlan(g, sid, r) {
  const T = TICKS_PER_DAY, now = effectTick(g), B = r.bless; // the tick it applies (preview: the next tick)
  const god = g.s.god, cur = god && Object.hasOwn(god.blessings, sid) ? god.blessings[sid] : null;
  const active = cur && cur.until > now;
  // Blessings end at a day start (rounded up), so "until the start of day N" is exact and the expiry log (day start)
  // comes on the very tick the blessing stops working.
  const toDay = (t) => Math.ceil(t / T) * T;
  const cap = toDay(now + Math.round(B.maxDays * T));
  const until = Math.min(cap, toDay((active ? cur.until : now) + Math.round(B.days * T)));
  if (active && until <= cur.until) return { reason: `${settlementOf(g, sid).name} is already blessed for the most time allowed (${fmtD(B.maxDays)}, until the start of day ${dayOf(cur.until)})` };
  return { until, days: (until - now) / T, extends: !!active };
}

registerPower('bless', {
  validate(g, a, r) {
    return villageProblem(g, a, 'a blessing') || blessPlan(g, a.settlementId, r).reason || null;
  },
  cost: (g, a, r) => r.costs.bless,
  preview(g, a, r) {
    const p = blessPlan(g, a.settlementId, r), B = r.bless, name = settlementOf(g, a.settlementId).name;
    return {
      settlementId: a.settlementId, days: p.days, until: p.until, work: B.work, growth: B.growth, extends: p.extends,
      effect: `${name} is blessed: work ${fmtX(B.work)}, growth ${fmtX(B.growth)}${p.extends ? ', extended' : ` for ${fmtD(p.days)}`}, until the start of day ${dayOf(p.until)}.`,
    };
  },
  apply(g, cmd, r) {
    const sid = cmd.args.settlementId, p = blessPlan(g, sid, r), B = r.bless, name = settlementOf(g, sid).name;
    g.s.god.blessings[sid] = { until: p.until, work: B.work, growth: B.growth };
    return {
      msg: `Blessed ${name}: work ${fmtX(B.work)}, growth ${fmtX(B.growth)}${p.extends ? ', extended' : ` for ${fmtD(p.days)}`}, until the start of day ${dayOf(p.until)}.`,
      settlementId: sid, until: p.until,
    };
  },
  // Day start: ended blessings (and those of villages that are gone) are dropped, in id order, each with a log line.
  daily(g, god) {
    const B = god.blessings;
    for (const sid of Object.keys(B).sort()) {
      const st = g.s.settlements?.[sid];
      if (!st) { delete B[sid]; continue; }
      if (B[sid].until > g.s.tick) continue;
      delete B[sid];
      g.log(`The blessing on ${st.name} has ended; work and growth are back to normal.`, 'god');
    }
  },
});

// ---------------- inspire ----------------
/** The tech an inspiration would advance: { tech, why } or { reason }. Read-only (chooseTech reads only). */
function inspireTarget(g, sid) {
  const st = settlementOf(g, sid), R = st.research;
  if (!R) return { reason: `${st.name} does no research` };
  const elig = eligibleTechs(g, sid);
  // The current tech counts only while its field is switched on (as planResearch and the research job require).
  const cur = R.current && elig.find((t) => t.id === R.current);
  let id = cur && (R.priorities?.[cur.field] ?? 2) > 0 ? cur.id : null, why = 'its current research';
  if (!id) { id = chooseTech(g, sid, g.plans?.[sid]?.techWanted || new Set())?.tech || null; why = 'the research it would take up next'; }
  if (!id) return { reason: `${st.name} has nothing to research now (${elig.length ? 'every field it could study is switched off' : 'nothing is left in its era yet'})` };
  return { tech: g.reg.get('tech', id), why };
}

function inspireNumbers(g, sid, t, r) {
  const R = settlementOf(g, sid).research, have = R.progress[t.id] || 0;
  const add = Math.min(r.inspire.fraction * t.research, Math.max(0, t.research - have));
  const unpaid = !R.paid[t.id] && (t.cost || []).length > 0;
  return { have, add, after: have + add, completes: have + add >= t.research, unpaid };
}

registerPower('inspire', {
  validate(g, a, r) {
    const why = villageProblem(g, a, 'an inspiration') || inspireTarget(g, a.settlementId).reason;
    if (why) return why;
    const { tech } = inspireTarget(g, a.settlementId), n = inspireNumbers(g, a.settlementId, tech, r);
    if (n.add <= 0) return `all the work on ${tech.name} is done already; ${settlementOf(g, a.settlementId).name} only has to pay its materials`;
    return null;
  },
  cost: (g, a, r) => r.costs.inspire,
  preview(g, a, r) {
    const sid = a.settlementId, { tech, why } = inspireTarget(g, sid), n = inspireNumbers(g, sid, tech, r);
    const name = settlementOf(g, sid).name, pct = Math.round((n.add / tech.research) * 100);
    const done = n.completes ? (n.unpaid ? '; it completes once its materials are paid' : '; it completes now') : '';
    return {
      settlementId: sid, tech: tech.name, techId: tech.id, add: n.add, progress: n.after, research: tech.research, completes: n.completes,
      effect: `${name} is inspired: ${tech.name} (${why}) +${pct}%, to ${Math.round((n.after / tech.research) * 100)}%${done}.`,
    };
  },
  apply(g, cmd, r) {
    const sid = cmd.args.settlementId, { tech } = inspireTarget(g, sid), n = inspireNumbers(g, sid, tech, r);
    const R = settlementOf(g, sid).research, name = settlementOf(g, sid).name;
    const pct = Math.round((n.add / tech.research) * 100);
    R.progress[tech.id] = n.completes ? tech.research : n.after;
    const ready = n.completes && !n.unpaid;
    const msg = `Inspired ${name}: ${tech.name} +${pct}%${n.completes ? (n.unpaid ? ' (complete once its materials are paid)' : ' (complete)') : ''}.`;
    if (ready) completeTech(g, sid, tech.id);
    else { g.planDirty = true; (g.replanSids ||= new Set()).add(sid); }
    return { msg, settlementId: sid, tech: tech.id, add: n.add, completed: ready };
  },
});
