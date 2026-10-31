// Prayers and petitions (Phase 13, docs/proposals/phase-13-petitions.md): a village asks the gods for help when
// something real is wrong, the player answers with a power that already exists (or dismisses the petition),
// and it ends by itself when things change. Nothing is given for an answer: the power acts as it always does.
// Kinds are data (`petitionKind`); when each applies is decided here by its id.
// s.petitions (save format 35): { next, open: { id: { id, sid, kind, since, until, urgency, evidence, ev, clear? } },
//   cool: { 'sid|kind': tick } } (cooldowns, dropped once over).
import { TICKS_PER_DAY } from './constants.js';
import { droughtAt } from './weatherat.js';
import { PROTECT_R } from './civlaws.js';

export const PETITION = Object.freeze({
  perPeople: 40, // the world cap: one open petition per 40 living people (at least 1)
  answerR: 20, // a power aimed within this many tiles of the village centre answers it
  hunger: { below: 2, until: 4 }, // food days: raised under 2, open while under 4
  monsterR: 20, monsterClear: 2, // a monster within 20 tiles; closed after 2 daily checks without one
  woods: { atMost: 5, until: 10 }, // grown trees within PROTECT_R of the centre
});

const centreOf = (g, sid) => g.s.settlements[sid]?.center || g.s.center;
function treesNear(g, c) {
  let n = 0;
  for (const t of g.nodesNear(c.x, c.y, PROTECT_R)) if (!t.young && g.nodeDef(t)?.workType === 'core:chop' && (t.x - c.x) ** 2 + (t.y - c.y) ** 2 <= PROTECT_R * PROTECT_R) n++;
  return n;
}
function nearestMonster(g, c, r) {
  let best = null, bd = r * r;
  for (const id of Object.keys(g.s.monsters?.list || {}).sort()) {
    const m = g.s.monsters.list[id], d = (m.x - c.x) ** 2 + (m.y - c.y) ** 2;
    if (d <= bd) { bd = d; best = m; }
  }
  return best && { m: best, dist: Math.round(Math.sqrt(bd)) };
}

/** Is the trouble behind kind `kind` real in village sid now? { on, urgency (0..1), evidence, text } or { on: false }.
 *  `open`: a petition of this kind is already open (the end thresholds apply, so it does not flicker). */
export function conditionOf(g, sid, kind, open = false) {
  const c = centreOf(g, sid), people = g.owned('colonists', sid).length;
  switch (kind) {
    case 'core:hunger': {
      const f = g.plans?.[sid]?.foodDays;
      if (f === undefined || !(f < (open ? PETITION.hunger.until : PETITION.hunger.below))) return { on: false };
      const days = Math.round(f * 10) / 10;
      return { on: true, urgency: Math.max(0.5, 1 - f / 4), evidence: { foodDays: days, people }, text: `food for ${days} day${days === 1 ? '' : 's'}, ${people} people` };
    }
    case 'core:drought':
      return droughtAt(g, c.x, c.y) ? { on: true, urgency: 0.6, evidence: { people }, text: 'the fields are in a drought' } : { on: false };
    case 'core:monster': {
      const n = nearestMonster(g, c, PETITION.monsterR);
      if (!n) return { on: false };
      const name = g.reg.get('monster', n.m.sp)?.name || 'monster';
      return { on: true, urgency: 0.8, evidence: { monster: n.m.id, sp: n.m.sp, dist: n.dist }, text: `a ${name} ${n.dist} tiles from the village` };
    }
    case 'core:lost_woods': {
      const t = treesNear(g, c);
      if (t > (open ? PETITION.woods.until - 1 : PETITION.woods.atMost)) return { on: false };
      return { on: true, urgency: 0.3, evidence: { trees: t }, text: `${t} grown tree${t === 1 ? '' : 's'} left near the village` };
    }
    default: return { on: false };
  }
}

const P = (g) => (g.s.petitions ||= { next: 1, open: {} });
const living = (g, sid) => g.owned('colonists', sid).length > 0;

function close(g, p, status, why, cause) {
  const s = g.s, st = s.settlements[p.sid], K = g.reg.get('petitionKind', p.kind);
  delete s.petitions.open[p.id];
  const T = s.petitions.cool ||= {};
  T[`${p.sid}|${p.kind}`] = s.tick + (K?.cooldownDays ?? 5) * TICKS_PER_DAY;
  const name = st?.name || p.sid;
  const what = (K?.name || p.kind).toLowerCase();
  const msg = { answered: `The gods answered ${name}'s prayer (${what})${why ? `: ${why}` : ''}.`, resolved: `${name} no longer prays (${what}): ${why}.`,
    dismissed: `The gods turned away ${name}'s prayer (${what}).`, expired: `${name}'s prayer (${what}) went unanswered${why ? ` (${why})` : ''}.` }[status];
  g.log(msg, p.sid === s.playerSettlement ? 'god' : 'info', null, 0, { kind: 'core:petition_closed', sids: [p.sid], cause: cause || p.ev, rel: cause ? p.ev : undefined });
}

/** Daily (game.js, after unrest): open petitions end or expire; new ones are raised within the limits. */
export function tickPetitions(g) {
  const s = g.s, kinds = g.reg.all('petitionKind');
  if (!kinds.length) return;
  const st = s.petitions;
  if (st) {
    for (const k of Object.keys(st.cool || {})) if (st.cool[k] <= s.tick) delete st.cool[k];
    if (st.cool && !Object.keys(st.cool).length) delete st.cool;
    for (const id of Object.keys(st.open).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
      const p = st.open[id];
      if (!s.settlements[p.sid] || s.settlements[p.sid].fallen || !living(g, p.sid)) { close(g, p, 'expired', 'the village is gone'); continue; }
      const c = conditionOf(g, p.sid, p.kind, true);
      if (c.on) { delete p.clear; p.evidence = c.evidence; p.urgency = c.urgency; }
      else if ((p.clear = (p.clear || 0) + 1) >= (p.kind === 'core:monster' ? PETITION.monsterClear : 1)) { close(g, p, 'resolved', 'the trouble passed'); continue; }
      if (s.tick >= p.until) close(g, p, 'expired');
    }
  }
  // New petitions: at most one open per village, none during a cooldown, the most urgent first, under the cap.
  const sids = Object.keys(s.settlements || {}).sort().filter((sid) => !s.settlements[sid].fallen && living(g, sid));
  const people = sids.reduce((n, sid) => n + g.owned('colonists', sid).length, 0);
  const cap = Math.max(1, Math.floor(people / PETITION.perPeople));
  const open = Object.values(s.petitions?.open || {});
  if (open.length >= cap) return;
  const busy = new Set(open.map((p) => p.sid)), cool = s.petitions?.cool || {};
  const cand = [];
  for (const sid of sids) {
    if (busy.has(sid)) continue;
    let best = null;
    for (const K of kinds) {
      if (cool[`${sid}|${K.id}`] > s.tick) continue;
      const c = conditionOf(g, sid, K.id);
      if (c.on && (!best || c.urgency > best.c.urgency)) best = { K, c };
    }
    if (best) cand.push({ sid, ...best });
  }
  cand.sort((a, b) => b.c.urgency - a.c.urgency || (a.sid < b.sid ? -1 : 1));
  for (const x of cand.slice(0, cap - open.length)) raise(g, x.sid, x.K, x.c);
}

function raise(g, sid, K, c) {
  const s = g.s, S = P(g), id = `p${S.next++}`, name = s.settlements[sid].name, mine = sid === s.playerSettlement;
  const p = { id, sid, kind: K.id, since: s.tick, until: s.tick + K.days * TICKS_PER_DAY, urgency: Math.round(c.urgency * 100) / 100, evidence: c.evidence };
  S.open[id] = p;
  const powers = K.answers.map((a) => a.brush ? `${a.power} (${a.brush})` : a.power).join(' or ');
  p.ev = g.log(`${name} prays to the gods (${K.name.toLowerCase()}): ${c.text}. Answer with ${powers} within ${K.days} days.`, mine ? 'god' : 'info', null, 0,
    { kind: 'core:petition', sids: [sid], at: centreOf(g, sid) }) || undefined;
  if (!p.ev) delete p.ev;
  return p;
}

/** After a power is carried out (god.js): open petitions it answers are closed as answered, linked to the
 *  power's chronicle event. A power answers when its kind is listed for the petition and it was aimed at the
 *  village (its settlementId) or within PETITION.answerR tiles of its centre. */
export function answerPetitions(g, cmd, out, eventId) {
  const S = g.s.petitions;
  if (!S || !Object.keys(S.open).length) return 0;
  const a = cmd.args || {}, pt = Array.isArray(a.points) && a.points.length ? a.points[0] : (Number.isFinite(a.x) && Number.isFinite(a.y) ? a : null);
  const target = out?.settlementId || a.settlementId;
  let n = 0;
  for (const id of Object.keys(S.open).sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)))) {
    const p = S.open[id], K = g.reg.get('petitionKind', p.kind);
    if (!K?.answers.some((x) => x.power === cmd.type && (!x.brush || x.brush === a.brush))) continue;
    const c = centreOf(g, p.sid);
    const aimed = target === p.sid || (pt && (pt.x - c.x) ** 2 + (pt.y - c.y) ** 2 <= PETITION.answerR ** 2);
    if (!aimed) continue;
    close(g, p, 'answered', `${cmd.type}`, eventId || undefined);
    n++;
  }
  return n;
}

/** The player turns a petition away. */
export function dismissPetition(g, id) {
  const p = g.s.petitions?.open?.[id];
  if (!p) return { ok: false, message: 'There is no such open petition.' };
  close(g, p, 'dismissed');
  return { ok: true };
}

/** Open petitions (of one village, or all), oldest first, with what the UI shows. */
export function petitionsOf(g, sid = null) {
  return Object.values(g.s.petitions?.open || {}).filter((p) => !sid || p.sid === sid).sort((a, b) => a.since - b.since || Number(a.id.slice(1)) - Number(b.id.slice(1))).map((p) => {
    const K = g.reg.get('petitionKind', p.kind);
    return { ...p, name: K?.name || p.kind, answers: K?.answers || [], daysLeft: Math.max(0, Math.ceil((p.until - g.s.tick) / TICKS_PER_DAY)), village: g.s.settlements[p.sid]?.name };
  });
}
