// The selling policy for controlled goods (Phase 10, slice 4; docs/proposals/phase-10-leftovers.md). The engine
// half: the player's village may sell its controlled goods (tagged core:controlled) by itself, through the same
// offers a player makes by hand (villages.js evaluateOffer, proposeTrade), so laws, prices, attention, seizure and
// closed trade all apply as they do. `settlement.sellPolicy` (format 44, optional; absent or mode 'off' means no
// selling, as before):
//   mode 'lawful': only where the goods are legal or restricted (never smuggled);
//   mode 'any': black markets too, where they are banned (double the price, attention and seizure);
//   keep: units of each controlled item never sold.
// Every SELL.everyDays days (daily job), at most one sale: the controlled item with the most to spare, to the
// village paying most for it (law price, then less attention, then id). Payment is what the player's village
// needs most of what that village can spare (its plan's trade needs and wants, then value), worth up to SELL.share of
// the goods; the deal must be one the village accepts. sellOutlook is what the UI shows before the player picks:
// for each village met, the law, the price, the attention it would add and the chance of seizure.
import { evaluateOffer, proposeTrade, lawFor, attentionOf, seizeChance, tradeClosed, isControlled, availableToTrade, tradeableItems, spareOf, value, relationPeek, ENFORCE } from './villages.js';
import { TICKS_PER_DAY } from './constants.js';

export const SELL = Object.freeze({ everyDays: 2, share: 0.85 });
export const SELL_MODES = Object.freeze(['off', 'lawful', 'any']);

const me = (g) => g.s.playerSettlement;
export const sellPolicyOf = (g) => g.s.settlements?.[me(g)]?.sellPolicy || { mode: 'off', keep: 0 };

/** Set the player's selling policy (the UI's choice). Returns { ok, message }. */
export function setSellPolicy(g, mode, keep = 0) {
  const st = g.s.settlements?.[me(g)];
  if (!st || !SELL_MODES.includes(mode) || !Number.isInteger(keep) || keep < 0 || keep > 100000) return { ok: false, message: 'Not a selling policy.' };
  if (mode === 'off') delete st.sellPolicy; else st.sellPolicy = { mode, keep };
  return { ok: true, message: mode === 'off' ? 'Controlled goods are sold only by hand.' : `Controlled goods are sold by the village${mode === 'lawful' ? ', only where the law allows them' : ', black markets too'} (keeping ${keep} of each).` };
}

/** For item, each village the player has met: { sid, name, law, price, attention, adds, seize, open }. */
export function sellOutlook(g, item) {
  const out = [];
  for (const sid of Object.keys(g.s.settlements || {}).sort()) {
    const st = g.s.settlements[sid];
    if (!st.ai || st.fallen || !relationPeek(g, me(g), sid).contact) continue;
    const law = lawFor(g, sid, item);
    out.push({
      sid, name: st.name, law,
      price: law === 'banned' ? ENFORCE.blackMarketPrice : law === 'restricted' ? ENFORCE.restrictedPrice : 1,
      attention: Math.round(attentionOf(g, sid, me(g)).value),
      adds: law === 'banned' ? ENFORCE.perUnitBanned : law === 'restricted' ? ENFORCE.perUnitRestricted : 0, // per unit
      seize: law === 'banned' ? Math.round(seizeChance(g, sid, me(g)) * 100) / 100 : 0,
      open: !tradeClosed(g, me(g), sid),
    });
  }
  return out;
}

/** Daily (game.js DAILY_JOBS): one sale by the policy, every SELL.everyDays days. Returns the trade id or null. */
export function tickSelling(g) {
  const pol = sellPolicyOf(g), sid = me(g);
  if (pol.mode === 'off' || Math.floor(g.s.tick / TICKS_PER_DAY) % SELL.everyDays) return null;
  const items = g.reg.all('item').filter((d) => isControlled(g, d.id)).map((d) => ({ item: d.id, spare: availableToTrade(g, sid, d.id) - pol.keep }))
    .filter((x) => x.spare > 0).sort((a, b) => b.spare - a.spare || (a.item < b.item ? -1 : 1));
  const P = g.plans?.[sid] || {};
  const need = (it) => (P.tradeNeeds?.[it] || 0) + (P.wants?.[it]?.remaining || 0);
  for (const { item, spare } of items) {
    const outlets = sellOutlook(g, item).filter((o) => o.open && (pol.mode === 'any' || o.law !== 'banned'))
      .sort((a, b) => b.price - a.price || a.attention - b.attention || (a.sid < b.sid ? -1 : 1));
    for (const o of outlets) {
      const qty = o.law === 'restricted' ? Math.min(spare, ENFORCE.restrictedCap) : spare;
      const give = [{ item, qty }];
      const alone = evaluateOffer(g, o.sid, { give });
      if (!alone.valid || alone.problems?.length) continue;
      const pay = tradeableItems(g, o.sid).filter((x) => !isControlled(g, x.item))
        .sort((a, b) => need(b.item) - need(a.item) || value(g, b.item) - value(g, a.item) || (a.item < b.item ? -1 : 1));
      for (const p of pay) {
        const q = Math.min(p.qty, spareOf(g, o.sid, p.item), Math.floor((alone.worthIn * SELL.share) / Math.max(0.1, value(g, p.item)))); // what it can spare
        if (q < 1) continue;
        const offer = { give, want: [{ item: p.item, qty: q }] };
        if (!evaluateOffer(g, o.sid, offer).accept) continue;
        const r = proposeTrade(g, o.sid, offer);
        if (!r.ok) continue;
        g.s.trades[r.tradeId].reason = `Your selling policy (${pol.mode === 'any' ? 'black markets too' : 'lawful only'})`;
        return r.tradeId;
      }
    }
  }
  return null;
}
