// The Tithe law (civilization laws, civlaws.js): every TITHE.days days each member of a kingdom whose capital keeps
// the tithe sends a tenth of its spare goods (its plan's surplus that is free to trade, at most TITHE.max an
// item) to the capital as a gift trade. Delivery goes the usual way (villages.js deliverLeg, caravans for far
// legs), so every item stays counted. Daily (game.js, after tickKingdoms); a member's day comes from a hash of its
// id, so the tithes are spread over the days. O(kingdom members) a day, nothing without kingdoms.
import { TICKS_PER_DAY } from './constants.js';
import { availableToTrade, spareOf } from './villages.js';
import { civLawIs, TITHE } from './civlaws.js';

const hash = (str) => { let h = 2166136261; for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

export function tickTithes(g) {
  const s = g.s;
  if (!s.kingdoms || !Object.keys(s.kingdoms).length) return;
  const day = Math.floor(s.tick / TICKS_PER_DAY);
  for (const sid of Object.keys(s.settlements).sort()) {
    const st = s.settlements[sid], k = st.kingdom && s.kingdoms[st.kingdom];
    if (!k || st.fallen || k.capital === sid || !s.settlements[k.capital] || s.settlements[k.capital].fallen) continue;
    if (!civLawIs(g, sid, 'core:tithe', 'tithe') || (day + (hash(sid) % TITHE.days)) % TITHE.days) continue;
    if (Object.values(s.trades || {}).some((t) => t.tithe && t.seller === sid && t.status === 'active')) continue; // last one still on its way
    const legs = [];
    g.readOnly(() => {
      for (const it of g.reg.all('item').map((d) => d.id).sort()) {
        const q = Math.min(TITHE.max, Math.floor(Math.min(spareOf(g, sid, it), availableToTrade(g, sid, it)) * TITHE.share));
        if (q > 0) legs.push({ from: sid, to: k.capital, item: it, qty: q, delivered: 0 });
      }
    });
    if (!legs.length) continue;
    const id = g.newId('tr');
    s.trades ||= {};
    g.tradeAdded();
    s.trades[id] = { id, seller: sid, buyer: k.capital, legs, gift: true, tribute: true, tithe: true, relOnDone: 0, status: 'active', created: s.tick,
      deadline: g.tradeDeadline ? g.tradeDeadline(sid, k.capital, s.tick + 6 * TICKS_PER_DAY) : s.tick + 6 * TICKS_PER_DAY, reason: `Tithe to ${s.settlements[k.capital].name}` };
    g.log(`${st.name} sends its tithe to ${s.settlements[k.capital].name} (${legs.length} kind${legs.length === 1 ? '' : 's'} of goods).`, 'info', `tithe:${sid}`, 2400);
  }
}
