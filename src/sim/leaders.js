// Leaders and succession (Phase 6, docs/proposals/phase-6-government.md, slice 1). Each village has a leader, an
// adult of the village chosen by its people's way (data: `people.leader`): eldest (the oldest adult), wisest (a Wise
// person first, then the most skill in all), bravest (a Brave person first, then the best hunter); ties: the lower
// id. A kingdom's ruler is its capital's leader. Changes are chronicle events (core:leader, core:ruler), linked to
// what caused them where the game holds it (the old leader's death). Checked daily (game.js DAILY_JOBS), for every
// village, distant ones too. State (save format 38): settlement.leader, leaderSince; kingdom.ruler.
import { isAdult } from './people.js';
import { ageYears } from './life.js';
import { theKingdom } from './kingdoms.js';

const RULES = new Set(['eldest', 'wisest', 'bravest']);
export const leaderRule = (g, sid) => {
  const p = g.reg.get('people', g.s.settlements?.[sid]?.people);
  return RULES.has(p?.leader) ? p.leader : 'eldest';
};
const num = (id) => Number(String(id).replace(/^\D+/, '')) || 0;
const skillSum = (c) => Object.values(c.skills || {}).reduce((a, x) => a + (x || 0), 0);
const has = (c, t) => !!c.traits?.includes(t);

/** Who should lead village sid now: { c, why } or null (no adult). */
export function chooseLeader(g, sid) {
  const adults = g.owned('colonists', sid).filter((c) => isAdult(g, c) && !c.health?.down);
  if (!adults.length) return null;
  const rule = leaderRule(g, sid);
  const key = (c) => {
    if (rule === 'wisest') return [has(c, 'core:wise') ? 1 : 0, skillSum(c)];
    if (rule === 'bravest') return [has(c, 'core:brave') ? 1 : 0, c.skills?.['core:hunting'] || 0];
    return [ageYears(g, c) ?? 0, 0];
  };
  let best = null, bk = null;
  for (const c of adults) {
    const k = key(c);
    if (!best || k[0] > bk[0] || (k[0] === bk[0] && (k[1] > bk[1] || (k[1] === bk[1] && num(c.id) < num(best.id))))) { best = c; bk = k; }
  }
  return { c: best, why: { eldest: 'the eldest', wisest: has(best, 'core:wise') ? 'wise' : 'the most skilled', bravest: has(best, 'core:brave') ? 'brave' : 'the best hunter' }[rule] };
}

/** The chronicle event of a person's death, if the log still holds it (the cause of a succession). */
const deathEvent = (g, cid) => { for (let i = g.s.log.length - 1; i >= 0; i--) { const e = g.s.log[i]; if (e.kind === 'core:death' && e.cids?.includes(cid)) return e.id; } return undefined; };

/** Daily: every village keeps a leader among its living adults; a leader who died, left or is no longer an adult
 *  of the village is succeeded. A leader is not replaced while still eligible (no daily reshuffles). Then each
 *  kingdom's ruler follows its capital's leader. */
export function tickLeaders(g) {
  const s = g.s;
  for (const sid of Object.keys(s.settlements || {}).sort()) {
    const st = s.settlements[sid];
    if (st.fallen) { if (st.leader) { delete st.leader; delete st.leaderSince; } continue; }
    const cur = st.leader && s.colonists[st.leader];
    if (cur && (cur.settlementId || s.playerSettlement) === sid && isAdult(g, cur)) continue;
    const pick = chooseLeader(g, sid);
    const was = st.leader;
    if (!pick) { if (was) { delete st.leader; delete st.leaderSince; } continue; }
    st.leader = pick.c.id; st.leaderSince = s.tick;
    if (!was) continue; // a village's first leader (a new village, an old save) is not news
    const old = s.colonists[was] || s.dead?.[was];
    const how = s.dead?.[was] ? ` after ${old?.name || 'the old leader'} died` : ` after ${old?.name || 'the old leader'} left`;
    g.log(`${pick.c.name} now leads ${st.name} (${pick.why}${how}).`, sid === s.playerSettlement ? 'good' : 'info', null, 0,
      { kind: 'core:leader', sids: [sid], cids: [pick.c.id], cause: s.dead?.[was] ? deathEvent(g, was) : undefined });
  }
  for (const kid of Object.keys(s.kingdoms || {}).sort()) {
    const k = s.kingdoms[kid], ruler = s.settlements[k.capital]?.leader;
    if (!ruler || k.ruler === ruler) continue;
    const first = k.ruler === undefined;
    k.ruler = ruler;
    if (first) continue; // a kingdom's first ruler is its capital's leader from the start: no news
    const c = s.colonists[ruler], name = theKingdom(k.name);
    g.log(`${c?.name || 'A new ruler'} now rules ${name} from ${s.settlements[k.capital].name}.`, 'info', null, 0, { kind: 'core:ruler', sids: [k.capital], cids: [ruler] });
  }
}

/** For the UI: a village's leader { cid, name, since, rule } or null; a kingdom's ruler likewise. */
export function leaderOf(g, sid) {
  const st = g.s.settlements?.[sid], c = st?.leader && g.s.colonists[st.leader];
  return c ? { cid: c.id, name: c.name, since: st.leaderSince, rule: leaderRule(g, sid) } : null;
}
export function rulerOf(g, kid) {
  const k = g.s.kingdoms?.[kid], c = k?.ruler && g.s.colonists[k.ruler];
  return c ? { cid: c.id, name: c.name, capital: k.capital } : null;
}
