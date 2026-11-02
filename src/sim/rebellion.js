// Rebellion (Phase 6, docs/proposals/phase-6-government.md, slice 3): a member village rises against its kingdom
// when its grievances, all things the game already records, reach REBEL.threshold. It leaves the kingdom, relations
// with the capital fall, and the world is told why. A war follows only through the usual rivalry rules. Bounded: at
// most one rebellion a kingdom every REBEL.gapDays days; the capital and the player's village never rebel on their
// own (the player's grievances are only shown). Daily (game.js DAILY_JOBS). State: kingdom.rebelled (a tick).
import { TICKS_PER_DAY } from './constants.js';
import { leaveKingdom, theKingdom } from './kingdoms.js';
import { changeRelation, relationPeek } from './villages.js';

export const REBEL = Object.freeze({ threshold: 5, gapDays: 20, titheDays: 30, maxTithes: 3, fall: 15 });

/** The grievances of member village sid against its kingdom: [{ why, weight }] (empty outside a kingdom). */
export function grievancesOf(g, sid) {
  const s = g.s, st = s.settlements?.[sid], k = st?.kingdom && s.kingdoms?.[st.kingdom];
  if (!k || k.capital === sid || !s.settlements[k.capital]) return [];
  const cap = k.capital, out = [];
  const since = s.tick - REBEL.titheDays * TICKS_PER_DAY;
  const tithes = (st.tithePaid || []).filter((t) => t >= since).length; // tithe.js keeps the last few
  if (tithes) out.push({ why: `${tithes} tithe${tithes === 1 ? '' : 's'} in ${REBEL.titheDays} days`, weight: Math.min(REBEL.maxTithes, tithes) });
  if (st.unrest !== undefined) out.push({ why: 'unrest', weight: 2 });
  const pulled = Object.values(s.relations || {}).some((r) => (r.a === sid || r.b === sid) && r.joinedFor && r.joinedFor !== sid && s.settlements[r.joinedFor]?.kingdom === st.kingdom);
  if (pulled) out.push({ why: 'pulled into a war for the kingdom', weight: 2 });
  if (st.people && s.settlements[cap].people && st.people !== s.settlements[cap].people) out.push({ why: `ruled by another people (${g.reg.get('people', s.settlements[cap].people)?.name || 'strangers'})`, weight: 1 });
  const v = relationPeek(g, sid, cap).value;
  if (v < -10) out.push({ why: `relations with the capital at ${v}`, weight: 2 });
  else if (v < 0) out.push({ why: `relations with the capital at ${v}`, weight: 1 });
  return out;
}
export const grievanceScore = (list) => list.reduce((a, x) => a + x.weight, 0);

/** Daily: in each kingdom (not within REBEL.gapDays of its last rebellion), the most aggrieved AI member at or above
 *  the threshold rises (ties: the lower id). */
export function tickRebellion(g) {
  const s = g.s;
  for (const kid of Object.keys(s.kingdoms || {}).sort()) {
    const k = s.kingdoms[kid];
    if (k.rebelled !== undefined && s.tick - k.rebelled < REBEL.gapDays * TICKS_PER_DAY) continue;
    let best = null;
    for (const sid of Object.keys(s.settlements).sort()) {
      const st = s.settlements[sid];
      if (st.kingdom !== kid || st.fallen || !st.ai || sid === s.playerSettlement || sid === k.capital) continue;
      const list = grievancesOf(g, sid), n = grievanceScore(list);
      if (n >= REBEL.threshold && (!best || n > best.n)) best = { sid, list, n };
    }
    if (!best) continue;
    const st = s.settlements[best.sid], cap = k.capital, why = best.list.map((x) => x.why).join(', ');
    k.rebelled = s.tick;
    g.log(`${st.name} rose against ${theKingdom(k.name)}: ${why}.`, best.sid === s.playerSettlement || cap === s.playerSettlement ? 'warn' : 'info', null, 0,
      { kind: 'core:rebellion', sids: [best.sid, cap] });
    leaveKingdom(g, best.sid, `rebelled (${why})`);
    changeRelation(g, best.sid, cap, -REBEL.fall, `Rebelled against ${theKingdom(k.name)}`);
  }
}
