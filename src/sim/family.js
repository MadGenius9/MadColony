// Families (Phase 10, slice 1; docs/proposals/phase-10-leftovers.md). Partnerships: an optional colonist field
// `partner` (a colonist id; format 43). Once a day (game.js DAILY_JOBS), first, a partner who died, left or lives in
// another village no longer counts (the field is cleared; the dead keep theirs for the chronicle). Then in each
// village, in id order, each unpartnered adult has a PARTNER.chance hashed chance to pair with the unpartnered
// adult of the village they get on with best: a hash of the two ids, times PARTNER.samePeople when both are of one
// people. Never with a parent, a child or a sibling. Gender is not modelled and is not used. Hash draws only (no
// rng), so nothing else in the game draws differently.
import { isAdult } from './people.js';
import { TICKS_PER_DAY } from './constants.js';

export const PARTNER = Object.freeze({ chance: 0.08, samePeople: 1.5 });

const hash = (str) => {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};
const unit = (str) => hash(str) / 4294967296;
const num = (id) => Number(String(id).slice(1)) || 0;

/** c's living partner in the same village, or null. */
export function partnerOf(g, c) {
  const p = c?.partner && g.s.colonists[c.partner];
  return p && p.partner === c.id && (p.settlementId || g.s.playerSettlement) === (c.settlementId || g.s.playerSettlement) ? p : null;
}

/** Are a and b close family (a parent, a child, or sharing a parent)? */
export function closeKin(a, b) {
  return !!(a.parents?.includes(b.id) || b.parents?.includes(a.id) || (a.parents?.length && b.parents?.some((p) => a.parents.includes(p))));
}

/** How well a and b get on: stable, in [0, PARTNER.samePeople). */
export function liking(g, a, b) {
  const [x, y] = num(a.id) < num(b.id) ? [a.id, b.id] : [b.id, a.id];
  return unit(`${g.s.seed}:like:${x}:${y}`) * (a.people && a.people === b.people ? PARTNER.samePeople : 1);
}

/** Once a day (game.js DAILY_JOBS): partnerships end and form. */
export function tickPartners(g) {
  const s = g.s, day = Math.floor(s.tick / TICKS_PER_DAY);
  for (const c of Object.values(s.colonists)) if (c.partner && !partnerOf(g, c)) delete c.partner; // died, left, or apart
  for (const sid of Object.keys(s.settlements || {}).sort()) {
    const free = g.owned('colonists', sid).filter((c) => !c.partner && isAdult(g, c)).sort((a, b) => num(a.id) - num(b.id));
    for (const a of free) {
      if (a.partner || unit(`${s.seed}:pair:${a.id}:${day}`) >= PARTNER.chance) continue;
      let best = null, bl = -1;
      for (const b of free) {
        if (b === a || b.partner || closeKin(a, b)) continue;
        const l = liking(g, a, b);
        if (l > bl) { bl = l; best = b; }
      }
      if (!best) continue;
      a.partner = best.id; best.partner = a.id;
      g.log(`${a.name} and ${best.name} of ${s.settlements[sid]?.name || sid} are now partners.`, 'good', null, 0, { kind: 'core:partners', sids: [sid], cids: [a.id, best.id] });
    }
  }
}
