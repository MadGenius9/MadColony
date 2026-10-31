// Fallen villages and ruins (Phase 5, slice 6a). A village with nobody left falls: it stays in s.settlements (every
// id in the save stays valid) with `fallen = { tick, cause, fate: 'ruin' }`. Its buildings and goods stay on the
// map as ruins; its open trades are called off, its pacts and alliances end, it leaves its kingdom (a fallen capital
// passes its crown to the largest member left: kingdoms.js), and from then on it plans nothing, trades with nobody,
// sends no explorers or traders, makes no deals, and no longer counts toward the village cap. Its land is released
// after RUIN.landDays so neighbours can grow into it (territory.js releaseClaims; the ruined buildings keep their
// tiles). The player's village never falls this way (Phase 5 open question 1: what then; it stays as an empty
// village). Daily, at day start. No random numbers are drawn.
import { TICKS_PER_DAY } from './constants.js';
import { releaseClaims } from './territory.js';
import { leaveKingdom, kingdomOf, membersOf, setCapital } from './kingdoms.js';
import { makePeace } from './combat.js';
import { relationStatus, relationPeek } from './villages.js';

export const RUIN = { landDays: 20 };

/** Has this village fallen? O(1). */
export const isFallen = (g, sid) => !!g.s.settlements?.[sid]?.fallen;
/** Villages that have not fallen, as ids in the given (or key) order. */
export const living = (g, ids = Object.keys(g.s.settlements || {})) => ids.filter((sid) => !g.s.settlements[sid]?.fallen);
/** How many villages stand (the village cap counts these). */
export const livingCount = (g) => living(g).length;

/** The most common cause of death among a village's dead, as words, or null. */
function deathCause(g, sid) {
  const n = new Map();
  for (const d of Object.values(g.s.dead || {})) if (d.settlementId === sid) n.set(d.text, (n.get(d.text) || 0) + 1);
  if (!n.size) return null;
  return [...n.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
}

/** `sid` falls now (cause: words for the log). Returns the fallen record. */
export function fall(g, sid, cause, fate = 'ruin', by = null) {
  const s = g.s, st = s.settlements[sid];
  const warEv = by ? relationPeek(g, sid, by).warEv : undefined; // the war that brought it down (chronicle.js)
  st.fallen = { tick: s.tick, cause: String(cause).slice(0, 120), fate, ...(by ? { by } : {}) };
  // Trades, pacts, alliances, proposals.
  for (const t of Object.values(s.trades || {})) if (t.status === 'active' && (t.seller === sid || t.buyer === sid)) t.status = 'cancelled';
  for (const k of Object.keys(s.treaties || {})) if (k.split('|').includes(sid)) delete s.treaties[k];
  for (const k of Object.keys(s.alliances || {})) { const al = s.alliances[k]; if (al.a === sid || al.b === sid) delete s.alliances[k]; }
  for (const p of Object.values(s.proposals || {})) if (p.status === 'pending' && (p.from === sid || p.to === sid)) p.status = 'expired';
  if (s.military?.[sid]) s.military[sid] = { order: 'defend' };
  // Its wars end: nobody fights ruins (war markers cleared with the peace), and attacks on it are called off.
  for (const k of Object.keys(s.relations || {}).sort()) {
    const r = s.relations[k];
    if ((r.a === sid || r.b === sid) && relationStatus(r) === 'hostile' && s.settlements[r.a] && s.settlements[r.b]) makePeace(g, r.a, r.b, `${st.name} has fallen`);
  }
  for (const o of Object.keys(s.military || {}).sort()) if (s.military[o]?.target === sid) s.military[o] = { order: 'defend' };
  if (s.watch === sid) delete s.watch;
  // The kingdom: a member leaves; a capital passes the crown to the largest member left (or the kingdom ends).
  const k = kingdomOf(g, sid);
  if (k) {
    if (k.capital === sid) {
      const heirs = membersOf(g, k.id).filter((x) => x !== sid && !isFallen(g, x)).sort((a, b) => g.owned('colonists', b).length - g.owned('colonists', a).length || (a < b ? -1 : 1));
      if (heirs.length) setCapital(g, k.id, heirs[0], `${st.name} has fallen`);
    }
    leaveKingdom(g, sid, `${st.name} has fallen`, { force: true });
  }
  g.planDirty = true;
  g.log(`${st.name} has fallen: ${cause}. Its ruins remain.`, 'warn', null, 0, { kind: 'core:village_fallen', sids: [sid, by].filter(Boolean), at: st.center, cause: warEv });
  return st.fallen;
}

/** Daily (day start): villages with nobody left fall; ruins' land is released after RUIN.landDays. O(villages). */
export function tickFallen(g) {
  const s = g.s;
  for (const sid of Object.keys(s.settlements || {}).sort()) {
    const st = s.settlements[sid];
    if (st.fallen) {
      if (st.fallen.fate === 'ruin' && st.fallen.released === undefined && s.tick - st.fallen.tick >= RUIN.landDays * TICKS_PER_DAY) {
        st.fallen.released = s.tick;
        if (g._cl) releaseClaims(g, sid);
        g.log(`The land round the ruins of ${st.name} is free again.`, 'info');
      }
      continue;
    }
    if (sid === s.playerSettlement || g.owned('colonists', sid).length) continue;
    const died = deathCause(g, sid);
    fall(g, sid, died ? `everyone ${died}` : 'everyone left');
  }
}
