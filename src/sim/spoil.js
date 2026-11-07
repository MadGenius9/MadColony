// Spoilage (Phase 8, slice 3; the owner's answer 2: meat spoils). Items with `spoilPerDay` in data (meat 0.1,
// carcasses 0.2) lose that share of every stack (its free units only: what a job has reserved or a trade holds is
// on its way to be used) and every colonist's load each day at the day start (goods in a station's buffer are
// being worked and do not spoil; nor do goods in caravans or held for want of space): whole units, the fraction by a hash draw (seed, holder, day), in id order; they leave through the
// ledger (`consumed:spoil`). Cooked meals do not spoil. Nothing happens in a game with no spoiling goods.
// Cold keeps (cold storage, from the Ideas parking lot, 2026-11-04): at the day start a stack's temperature is its
// room's (heat.js) if it lies indoors, else the day's mean outdoors (a carried load: outdoors). At or below
// COLD.freeze °C goods spoil at COLD.frozen of their rate; up to COLD.cool °C at COLD.cooled.
// Cost: O(stacks + colonists) once a day.
import { TICKS_PER_DAY } from './constants.js';
import { roomAt, tempAt, seasonalTemp } from './heat.js';

export const COLD = Object.freeze({ freeze: 0, frozen: 0.1, cool: 8, cooled: 0.4 });
/** How fast goods spoil at temperature t: 1, or less in the cold. */
export const coldFactor = (t) => (t <= COLD.freeze ? COLD.frozen : t <= COLD.cool ? COLD.cooled : 1);
/** The temperature goods at (x, y) keep at today: their room's, else the day's mean outdoors. */
export function keptAt(g, x, y) { return roomAt(g, x, y) ? tempAt(g, x, y) : seasonalTemp(g); }

const hash = (str) => {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** How many of qty spoil today (key: the holder). */
function spoiled(g, item, qty, key, cold = 1) {
  const r = (g.reg.get('item', item)?.spoilPerDay || 0) * cold;
  if (!r || qty <= 0) return 0;
  const e = qty * r, n = Math.floor(e);
  return Math.min(qty, n + (hash(`${g.s.seed}:spoil:${key}:${Math.floor(g.s.tick / TICKS_PER_DAY)}`) / 4294967296 < e - n ? 1 : 0));
}

/** Game.tick at the day start. */
export function tickSpoil(g) {
  const s = g.s;
  if (g._spoilAny === undefined) g._spoilAny = g.reg.all('item').some((d) => d.spoilPerDay > 0);
  if (!g._spoilAny) return;
  const lost = {};
  const gone = (owner, item, n) => {
    const prev = g.actor;
    g.actor = owner || null;
    try { g.consume(item, n, 'spoil'); } finally { g.actor = prev; }
    lost[item] = (lost[item] || 0) + n;
  };
  for (const id of Object.keys(s.stacks).sort(byId)) {
    const st = s.stacks[id];
    if (!st) continue;
    if (!(g.reg.get('item', st.item)?.spoilPerDay > 0)) continue;
    const n = Math.min(spoiled(g, st.item, st.qty, id, coldFactor(keptAt(g, st.x, st.y))), g.availQty(id)); // reserved units are kept (save/load); cold keeps
    if (n <= 0) continue;
    const item = st.item, owner = st.settlement;
    if (g.takeFromStack(id, n)) gone(owner, item, n);
  }
  for (const id of Object.keys(s.colonists).sort(byId)) {
    const c = s.colonists[id], cr = c.carry;
    if (!cr) continue;
    if (!(g.reg.get('item', cr.item)?.spoilPerDay > 0)) continue;
    const n = spoiled(g, cr.item, cr.qty, id, coldFactor(seasonalTemp(g)));
    if (!n) continue;
    cr.qty -= n;
    gone(c.settlementId, cr.item, n);
    if (cr.qty <= 0) c.carry = null;
  }
  for (const [item, n] of Object.entries(lost)) g.log(`${n} ${g.reg.get('item', item)?.name || item} spoiled.`, 'info', `spoil:${item}`, 2400);
}
