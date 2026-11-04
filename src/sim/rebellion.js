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
export function grievancesOf(g, sid, joined = null) { // joined: joinedIndex(g), for a pass over many villages
  const s = g.s, st = s.settlements?.[sid], k = st?.kingdom && s.kingdoms?.[st.kingdom];
  if (!k || k.capital === sid || !s.settlements[k.capital]) return [];
  const cap = k.capital, out = [];
  const since = s.tick - REBEL.titheDays * TICKS_PER_DAY;
  const tithes = (st.tithePaid || []).filter((t) => t >= since).length; // tithe.js keeps the last few
  if (tithes) out.push({ why: `${tithes} tithe${tithes === 1 ? '' : 's'} in ${REBEL.titheDays} days`, weight: Math.min(REBEL.maxTithes, tithes) });
  if (st.unrest !== undefined) out.push({ why: 'unrest', weight: 2 });
  const pulled = (joined ? joined.get(sid) || [] : Object.values(s.relations || {}).filter((r) => (r.a === sid || r.b === sid) && r.joinedFor).map((r) => r.joinedFor))
    .some((j) => j !== sid && s.settlements[j]?.kingdom === st.kingdom);
  if (pulled) out.push({ why: 'pulled into a war for the kingdom', weight: 2 });
  if (st.people && s.settlements[cap].people && st.people !== s.settlements[cap].people) out.push({ why: `ruled by another people (${g.reg.get('people', s.settlements[cap].people)?.name || 'strangers'})`, weight: 1 });
  const v = relationPeek(g, sid, cap).value;
  if (v < -10) out.push({ why: `relations with the capital at ${v}`, weight: 2 });
  else if (v < 0) out.push({ why: `relations with the capital at ${v}`, weight: 1 });
  return out;
}
export const grievanceScore = (list) => list.reduce((a, x) => a + x.weight, 0);
/** For each village, the `joinedFor` of the relations it is in (war.js: whom it joined a war for). The same answer
 *  as asking every relation each time; built once for a pass (it went over every relation for every member). */
export function joinedIndex(g) {
  const m = new Map();
  for (const r of Object.values(g.s.relations || {})) if (r.joinedFor) for (const v of [r.a, r.b]) { if (!m.has(v)) m.set(v, []); m.get(v).push(r.joinedFor); }
  return m;
}

/** Daily: in each kingdom (not within REBEL.gapDays of its last rebellion), the most aggrieved AI member at or above
 *  the threshold rises (ties: the lower id). */
export function tickRebellion(g) {
  const s = g.s;
  let joined = null; // built on first need, and again after a rebellion (it may change relations)
  for (const kid of Object.keys(s.kingdoms || {}).sort()) {
    const k = s.kingdoms[kid];
    if (k.rebelled !== undefined && s.tick - k.rebelled < REBEL.gapDays * TICKS_PER_DAY) continue;
    let best = null;
    for (const sid of Object.keys(s.settlements).sort()) {
      const st = s.settlements[sid];
      if (st.kingdom !== kid || st.fallen || !st.ai || sid === s.playerSettlement || sid === k.capital) continue;
      const list = grievancesOf(g, sid, (joined ||= joinedIndex(g))), n = grievanceScore(list);
      if (n >= REBEL.threshold && (!best || n > best.n)) best = { sid, list, n };
    }
    if (!best) continue;
    const st = s.settlements[best.sid], cap = k.capital, why = best.list.map((x) => x.why).join(', ');
    k.rebelled = s.tick;
    g.log(`${st.name} rose against ${theKingdom(k.name)}: ${why}.`, best.sid === s.playerSettlement || cap === s.playerSettlement ? 'warn' : 'info', null, 0,
      { kind: 'core:rebellion', sids: [best.sid, cap] });
    leaveKingdom(g, best.sid, `rebelled (${why})`);
    changeRelation(g, best.sid, cap, -REBEL.fall, `Rebelled against ${theKingdom(k.name)}`);
    joined = null;
  }
}
