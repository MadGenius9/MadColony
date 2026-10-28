// Spoilage (Phase 8, slice 3; the owner's answer 2: meat spoils). Items with `spoilPerDay` in data (meat 0.15,
// carcasses 0.2) lose that share of every stack, every colonist's load and every station buffer each day at the
// day start: whole units, the fraction by a hash draw (seed, holder, day), in id order; they leave through the
// ledger (`consumed:spoil`). Cooked meals do not spoil. Nothing happens in a game with no spoiling goods.
// Cost: O(stacks + colonists + buildings with buffers) once a day.
import { TICKS_PER_DAY } from './constants.js';

const hash = (str) => {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** How many of qty spoil today (key: the holder). */
function spoiled(g, item, qty, key) {
  const r = g.reg.get('item', item)?.spoilPerDay || 0;
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
    const n = spoiled(g, st.item, st.qty, id);
    if (!n) continue;
    const item = st.item, owner = st.settlement;
    if (g.takeFromStack(id, n)) gone(owner, item, n);
  }
  for (const id of Object.keys(s.colonists).sort(byId)) {
    const c = s.colonists[id], cr = c.carry;
    if (!cr) continue;
    const n = spoiled(g, cr.item, cr.qty, id);
    if (!n) continue;
    cr.qty -= n;
    gone(c.settlementId, cr.item, n);
    if (cr.qty <= 0) c.carry = null;
  }
  for (const id of Object.keys(s.structures).sort(byId)) {
    const b = s.structures[id];
    if (!b.buffer?.length) continue;
    for (const e of b.buffer) {
      const n = spoiled(g, e.item, e.qty, `${id}:${e.item}`);
      if (!n) continue;
      e.qty -= n;
      gone(b.settlement, e.item, n);
    }
    b.buffer = b.buffer.filter((e) => e.qty > 0);
  }
  for (const [item, n] of Object.entries(lost)) g.log(`${n} ${g.reg.get('item', item)?.name || item} spoiled.`, 'info', `spoil:${item}`, 2400);
}
