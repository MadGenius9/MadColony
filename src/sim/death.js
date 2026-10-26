// Death (Phase 5, slice 1a). A colonist whose health has been at 0% for HEALTH.deathAfterHours while collapsed
// dies; the cause is their most severe injury or condition. Health rules run in tickHealth for full and distant
// villages alike (health.js, lod.js hourNeeds), so both die by the same rule. Deaths found during a tick are
// carried out at the end of that tick (Game.tick), in id order, so nothing is removed while colonists are still
// being ticked.
//
// What a death does, the way founding moves founders (founding.js):
// - jobs of others about the dead (care, treatment, rescue, a fight) end, and the dead's own job ends (carried
//   goods are dropped, reservations released);
// - what they carried, their tool, weapon and ammunition are put down where they died, still their village's
//   (the census counts them, so no ledger entry is needed: nothing is created or destroyed);
// - their bed, home place, medical bed and college training are freed; blocks on them are lifted;
// - the record moves from s.colonists to s.dead (save format 15): name, village, cause, tick, place, and the
//   fields the people ledger needs (bornTick, origin). Names stay unique against the living and the dead;
// - s.stats.deaths counts deaths by cause; the village plans afresh at once, so no plan names the dead.
// No random numbers are drawn. (When to die is decided in health.js checkDeath; this module is imported only by
// game.js, after the AI modules, to keep imports free of cycles.)
import { endJob } from './ai/ai.js';
import { planNow } from './planner.js';

/** The words for a death by the kind of its worst injury (others: "died of their injuries"). */
const CAUSE_TEXT = {
  wound: 'died of their wounds',
  malnutrition: 'starved to death',
  dehydration: 'died of thirst',
  exhaustion: 'died of exhaustion',
  infection: 'died of an infected wound',
  illness: 'died of an illness',
  injury: 'died of their injuries',
};
export const causeText = (kind) => CAUSE_TEXT[kind] || 'died of their injuries';

const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Game.tick, at the end of the tick: carry out the deaths found during it, in id order. O(1) when there are none. */
export function processDeaths(g) {
  const d = g._dying;
  if (!d?.size) return;
  g._dying = null;
  for (const id of [...d].sort(byId)) { const c = g.s.colonists[id]; if (c) killColonist(g, c); }
}

/** The worst injury or condition of a colonist (highest severity, then the oldest), or null. */
function worstInjury(c) {
  let w = null;
  for (const i of c.health?.injuries || []) if (!w || i.severity > w.severity) w = i;
  return w;
}

/** A colonist dies now. `kind` overrides the cause (else their worst injury). Returns the s.dead record. */
export function killColonist(g, c, kind = null) {
  const s = g.s, sid = c.settlementId || s.playerSettlement;
  const worst = worstInjury(c);
  const cause = kind || worst?.kind || 'injury';
  const text = causeText(cause);
  const why = `${c.name} died`;
  // Others' jobs about the dead end first (their reservations on the patient are released with them).
  for (const o of Object.values(s.colonists).sort((a, b) => byId(a.id, b.id))) {
    if (o === c || !o.job) continue;
    if (o.job.patientId === c.id || o.job.targetId === c.id) endJob(g, o, null, why);
  }
  if (c.job) endJob(g, c, null, 'Died');
  // Their goods stay their village's, put down where they died.
  const prev = g.actor;
  g.actor = sid;
  try {
    const x = Math.round(c.x), y = Math.round(c.y);
    if (c.carry) { g.placeItems(c.carry.item, c.carry.qty, x, y, c.carry.dur); c.carry = null; }
    for (const slot of ['tool', 'weapon']) {
      const e = c.equip?.[slot];
      if (e) { g.placeItems(e.item, 1, x, y, e.dur); c.equip[slot] = null; }
    }
    if (c.ammo) { g.placeItems(c.ammo.item, c.ammo.qty, x, y); c.ammo = null; }
  } finally { g.actor = prev; }
  // Bed, home, medical bed, training and blocks.
  const bed = c.bedId && s.structures[c.bedId];
  if (bed && bed.owner === c.id) delete bed.owner;
  const home = c.homeId && s.homes[c.homeId];
  if (home) home.owners = (home.owners || []).filter((x) => x !== c.id);
  const st = s.settlements?.[sid];
  if (st?.training?.cid === c.id) st.training = null;
  for (const k of [`patient:${c.id}`, `tend:${c.id}`]) delete s.blocked?.[k];
  // The record.
  const rec = { name: c.name, settlementId: sid, cause, text, tick: s.tick, x: Math.round(c.x), y: Math.round(c.y) };
  if (worst?.cause) rec.injury = String(worst.cause).slice(0, 80);
  if (c.bornTick !== undefined && c.bornTick !== null) rec.bornTick = c.bornTick;
  if (c.origin) rec.origin = c.origin;
  if (c.parents?.length) rec.parents = [...c.parents];
  (s.dead ||= {})[c.id] = rec;
  delete s.colonists[c.id];
  g.ownReset('colonists');
  s.stats.deaths ||= {};
  s.stats.deaths[cause] = (s.stats.deaths[cause] || 0) + 1;
  const village = st?.name ? ` of ${st.name}` : '';
  g.log(`${c.name}${village} ${text}${worst?.cause && cause === worst.kind ? ` (${worst.cause.toLowerCase()})` : ''}.`, 'death');
  // A fresh plan at once, so no plan holds the dead (saved plans may only name living colonists).
  planNow(g, sid);
  if (sid === s.playerSettlement) g.plan = g.plans[sid];
  return rec;
}
