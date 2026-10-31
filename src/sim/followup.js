// Intervention follow-through (Phase 14, docs/proposals/phase-14-follow-through.md): a power's villages are
// measured just before it acts and again followDays later; the outcome card shows the power's recorded result
// and the changes that followed, without claiming they were its doing. No counterfactual is simulated.
// s.followUps (save format 36): { wait: [{ cmd, type, ev, t, due, sids, before, petitions? }], cards: [...] }.
import { TICKS_PER_DAY } from './constants.js';
import { PROTECT_R } from './civlaws.js';
import { godRulesOf } from './god.js';

export const FOLLOW = Object.freeze({ days: 3, near: 20, villages: 3, wait: 100, cards: 50 });
const followDays = (g) => godRulesOf(g)?.followDays ?? FOLLOW.days;

/** The villages a command touches: its settlementId, else up to FOLLOW.villages with a centre within FOLLOW.near
 *  of the point it hits (nearest first). */
export function villagesOf(g, cmd) {
  const a = cmd.args || {}, S = g.s.settlements || {};
  if (a.settlementId && S[a.settlementId]) return [a.settlementId];
  const pt = Array.isArray(a.points) && a.points.length ? a.points[0] : (Number.isFinite(a.x) && Number.isFinite(a.y) ? a : null);
  if (!pt) return [];
  return Object.keys(S).filter((sid) => !S[sid].fallen && S[sid].center)
    .map((sid) => [sid, (S[sid].center.x - pt.x) ** 2 + (S[sid].center.y - pt.y) ** 2])
    .filter(([, d]) => d <= FOLLOW.near ** 2).sort((x, y) => x[1] - y[1] || (x[0] < y[0] ? -1 : 1)).slice(0, FOLLOW.villages).map(([sid]) => sid);
}

/** What is measured per village (all already kept by the game). */
export function measure(g, sid) {
  const c = g.s.settlements[sid]?.center || g.s.center;
  let trees = 0;
  for (const t of g.nodesNear(c.x, c.y, PROTECT_R)) if (!t.young && g.nodeDef(t)?.workType === 'core:chop' && (t.x - c.x) ** 2 + (t.y - c.y) ** 2 <= PROTECT_R ** 2) trees++;
  let monsters = 0;
  for (const m of Object.values(g.s.monsters?.list || {})) if ((m.x - c.x) ** 2 + (m.y - c.y) ** 2 <= FOLLOW.near ** 2) monsters++;
  const f = g.plans?.[sid]?.foodDays;
  return { food: f === undefined ? null : Math.round(Math.min(f, 99) * 10) / 10, people: g.owned('colonists', sid).length, trees, monsters };
}

/** Just before a power acts (god.js): its villages measured. */
export function beforePower(g, cmd) {
  const sids = villagesOf(g, cmd);
  return sids.length ? { sids, before: Object.fromEntries(sids.map((sid) => [sid, measure(g, sid)])) } : null;
}

/** After it acted: the record that waits for its card. */
export function afterPowerFollow(g, cmd, pre, eventId, petitions) {
  if (!pre) return;
  const F = (g.s.followUps ||= { wait: [] });
  F.wait.push({ cmd: cmd.id, type: cmd.type, ev: eventId || undefined, t: g.s.tick, due: g.s.tick + Math.round(followDays(g) * TICKS_PER_DAY), sids: pre.sids, before: pre.before, ...(petitions?.length ? { petitions } : {}) });
  if (!F.wait.at(-1).ev) delete F.wait.at(-1).ev;
  if (F.wait.length > FOLLOW.wait) F.wait.splice(0, F.wait.length - FOLLOW.wait);
}

const diff = (b, a) => (b === a ? `${a}` : `${b} → ${a}`);

/** Day start (game.js): cards for the records that are due. */
export function tickFollowUps(g) {
  const F = g.s.followUps;
  if (!F?.wait?.length) return;
  const s = g.s, keep = [];
  for (const w of F.wait) {
    if (w.due > s.tick) { keep.push(w); continue; }
    const changes = {}, parts = [];
    for (const sid of w.sids) {
      const st = s.settlements[sid], b = w.before[sid];
      if (!st || !b) continue;
      const a = measure(g, sid);
      let died = 0;
      for (const d of Object.values(s.dead || {})) if (d.settlementId === sid && d.tick >= w.t) died++;
      changes[sid] = { before: b, after: a, died };
      parts.push(`${st.name}${st.fallen ? ' (fallen)' : ''}: food ${b.food ?? '?'} → ${a.food ?? '?'} days, people ${diff(b.people, a.people)}, ${died ? `${died} died` : 'no deaths'}, trees ${diff(b.trees, a.trees)}${b.monsters || a.monsters ? `, monsters near ${diff(b.monsters, a.monsters)}` : ''}`);
    }
    const res = s.god?.log?.find((x) => x.id === w.cmd)?.result;
    const days = Math.round((s.tick - w.t) / TICKS_PER_DAY);
    const card = { cmd: w.cmd, type: w.type, t: w.t, at: s.tick, sids: w.sids, effect: res?.msg || '', changes, ...(w.petitions ? { petitions: w.petitions } : {}) };
    card.ev = g.log(`${days} day${days === 1 ? '' : 's'} after the ${w.type} power: ${parts.join('; ') || 'no village to follow'}. (Changes that followed; the game does not know how much the power caused.)`,
      'god', null, 0, { kind: 'core:god_outcome', sids: w.sids, cause: w.ev }) || undefined;
    if (!card.ev) delete card.ev;
    (F.cards ||= []).push(card);
    if (F.cards.length > FOLLOW.cards) F.cards.splice(0, F.cards.length - FOLLOW.cards);
  }
  F.wait = keep;
}

/** The outcome cards, newest first (for the UI). */
export const outcomeCards = (g) => [...(g.s.followUps?.cards || [])].reverse();
