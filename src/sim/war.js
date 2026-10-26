// Rivalry and wars between villages (Phase 5, slice 5a). A scenario rule (`scenario.war`), on only where a scenario
// turns it on (the Vast world), so other games run exactly as before.
// - Pressing borders: once two villages' lands touch (contact.js bordersTouched marks rel.touch in war games), their relation
//   falls by `rivalry.perDay` a day, times the mean `temperament` of their profiles (villageProfile, default 1),
//   but never below `rivalry.floor` by this cause alone. Allies and villages of one kingdom do not quarrel over
//   land. The fall is written into the relation's history only when it changes the relation's standing (like
//   traders' visits), so the history keeps the causes that matter.
// - Near rivals: met villages whose centres are within `rivalry.near` tiles (and whose lands do not touch) fall by
//   `rivalry.nearPerDay` a day the same way ("they compete for the same land").
// - Declarations: daily, an AI village declares war on a village it has met when their relation is at or below
//   `declareBelow`, it is not already at war with it, they are neither allied nor of one kingdom, and it is
//   clearly stronger (`stronger` x their strength; strength: fit fighters, armed ones by weapon damage). Allies and
//   kingdom members of the attacked village join (combat.js joinDefence). On the player's village an AI village
//   first threatens (a letter) and declares only if it still may `warnDays` later. At most one declaration a day
//   per village, in id order. The cause is logged.
// No random numbers are drawn.
import { TICKS_PER_DAY } from './constants.js';
import { relationOf, relationPeek, relationStatus, allianceOf, changeRelation } from './villages.js';
import { sameKingdom } from './kingdoms.js';
import { declareWar, weaponOf, COMBAT } from './combat.js';
import { isDown, hpOf } from './health.js';
import { mayFight } from './people.js';
import { settlementOf } from './research.js';

/** The scenario's war rules, or null. */
export function warRules(g) {
  if (g._warRules === undefined || g._warRulesFor !== g.s.scenarioId) {
    g._warRules = g.reg.get('scenario', g.s.scenarioId)?.war || null;
    g._warRulesFor = g.s.scenarioId;
  }
  return g._warRules;
}

const nameOf = (g, sid) => settlementOf(g, sid)?.name || sid;
const temperOf = (g, sid) => { const p = g.s.settlements?.[sid]?.profile; return (p && g.reg.get('villageProfile', p)?.temperament) ?? 1; };

/** Fighting strength of a village: fit adults, armed ones counted by weapon damage (fists: COMBAT.unarmed). */
export function warStrength(g, sid) {
  let n = 0;
  for (const c of g.owned('colonists', sid)) {
    if (isDown(c) || hpOf(c) < COMBAT.fitHp || !mayFight(g, c)) continue;
    const w = weaponOf(g, c);
    n += (w.damage || COMBAT.unarmed.damage) / 5;
  }
  return Math.round(n * 100) / 100;
}

/** Daily (day start): rivalry from pressing borders, then declarations. O(touching pairs + villages × met). */
export function tickRivalry(g) {
  const R = warRules(g);
  if (!R) return;
  const s = g.s, rv = R.rivalry;
  if (rv) for (const k of Object.keys(s.relations || {}).sort()) {
    const rel = s.relations[k];
    if (rel.threat !== undefined && rel.value > R.declareBelow + 10) delete rel.threat; // the threat is past
    if (!rel.contact || !s.settlements[rel.a] || !s.settlements[rel.b]) continue;
    if (allianceOf(g, rel.a, rel.b) || sameKingdom(g, rel.a, rel.b) || rel.value <= rv.floor) continue;
    if (!g.owned('colonists', rel.a).length || !g.owned('colonists', rel.b).length) continue;
    let per = 0, why = '';
    if (rel.touch !== undefined) { per = rv.perDay; why = 'Their lands press on each other'; }
    else if (rv.near) {
      const ca = s.settlements[rel.a].center, cb = s.settlements[rel.b].center;
      if (ca && cb && Math.hypot(ca.x - cb.x, ca.y - cb.y) <= rv.near) { per = rv.nearPerDay ?? rv.perDay / 2; why = 'They compete for the same land'; }
    }
    if (!per) continue;
    const d = per * (temperOf(g, rel.a) + temperOf(g, rel.b)) / 2;
    const value = Math.max(rv.floor, Math.round((rel.value - d) * 100) / 100);
    if (relationStatus({ contact: true, value }) !== relationStatus(rel)) changeRelation(g, rel.a, rel.b, value - rel.value, why);
    else rel.value = value;
  }
  declarations(g, R);
}

function declarations(g, R) {
  const s = g.s, ids = Object.keys(s.settlements || {}).sort();
  const strength = new Map();
  const str = (sid) => { if (!strength.has(sid)) strength.set(sid, warStrength(g, sid)); return strength.get(sid); };
  for (const a of ids) {
    if (!s.settlements[a].ai || !g.owned('colonists', a).length) continue;
    for (const b of ids) {
      if (a === b || !g.owned('colonists', b).length) continue;
      const rel = relationPeek(g, a, b);
      if (!rel.contact || rel.value > R.declareBelow || rel.aggressor) continue;
      if (allianceOf(g, a, b) || sameKingdom(g, a, b)) continue;
      const mine = str(a), theirs = str(b);
      if (mine < (R.minStrength ?? 1) || mine < theirs * R.stronger) continue;
      const why = rel.touch !== undefined ? 'their lands press on each other' : 'they compete for the same land';
      if (b === s.playerSettlement && R.warnDays) {
        const r = relationOf(g, a, b);
        if (r.threat === undefined) {
          r.threat = s.tick;
          g.log(`${nameOf(g, a)} threatens war on ${nameOf(g, b)} (${why}). Improve relations or make peace within ${R.warnDays} day${R.warnDays === 1 ? '' : 's'}.`, 'warn');
          break;
        }
        if (s.tick - r.threat < R.warnDays * TICKS_PER_DAY) continue;
      }
      declareWar(g, a, b, `${nameOf(g, a)} declared war on ${nameOf(g, b)}: ${why}, and ${nameOf(g, a)} is stronger (${mine} against ${theirs})`);
      break; // one declaration a day per village
    }
  }
}
