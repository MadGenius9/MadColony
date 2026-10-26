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
// - Battles between distant villages (slice 5b): daily, a war where both sides are simulated at a distance is fought
//   in aggregate: each side wounds its strength x battle.woundsPerStrength of the other's fit fighters (the fraction
//   as a chance)
//   (picked by hash; wounds of battle.minSeverity..maxSeverity through health.js injure, so deaths follow the
//   death rules), the war does not cool (lastClash), and illness may pass (illness.js). A war with a village in
//   full detail is fought for real (combat.js raids; a village attacked by a full-detail one is promoted, lod.js).
// - Peace between AI villages: daily, the weaker side sues for peace when its strength is below truce.weakerShare
//   of the other's after truce.minDays of war, or when the war is truce.maxDays old (`relation.warSince`); relations go to the truce value.
// No random numbers are drawn (draws are hashes of seed, ids and day).
import { TICKS_PER_DAY } from './constants.js';
import { relationOf, relationPeek, relationStatus, allianceOf, changeRelation } from './villages.js';
import { sameKingdom, kingdomOf, membersOf, formKingdom, joinKingdom, leaveKingdom, setCapital } from './kingdoms.js';
import { availableToTrade, spareOf } from './villages.js';

const TRIBUTE_MAX = 200; // per item, as for ordinary offers
import { declareWar, makePeace, weaponOf, COMBAT } from './combat.js';
import { isDown, hpOf, injure } from './health.js';
import { spreadContact } from './illness.js';
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
const hash = (str) => {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};
const draw = (key) => hash(key) / 4294967296;
const isFit = (g, c) => !isDown(c) && hpOf(c) >= COMBAT.fitHp && mayFight(g, c);
const temperOf = (g, sid) => { const p = g.s.settlements?.[sid]?.profile; return (p && g.reg.get('villageProfile', p)?.temperament) ?? 1; };

/** Fighting strength of a village: fit adults, armed ones counted by weapon damage (fists: COMBAT.unarmed). */
export function warStrength(g, sid) {
  let n = 0;
  for (const c of g.owned('colonists', sid)) {
    if (!isFit(g, c)) continue;
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
  // People per village, once (the checks below only ask whether a village has anyone).
  const pop = new Map();
  for (const c of Object.values(s.colonists)) { const k = c.settlementId || s.playerSettlement; pop.set(k, (pop.get(k) || 0) + 1); }
  g._warPop = pop; // derived, for this call only
  if (rv) for (const k of Object.keys(s.relations || {}).sort()) {
    const rel = s.relations[k];
    if (rel.threat !== undefined && (rel.value > R.declareBelow + 10 || s.tick - rel.threat > 2 * (R.warnDays || 1) * TICKS_PER_DAY)) delete rel.threat; // the threat is past or lapsed
    if (!rel.contact || !s.settlements[rel.a] || !s.settlements[rel.b]) continue;
    if (allianceOf(g, rel.a, rel.b) || sameKingdom(g, rel.a, rel.b) || rel.value <= rv.floor) continue;
    if (!pop.get(rel.a) || !pop.get(rel.b)) continue;
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
  if (R.battle) battles(g, R);
  if (R.conquest) conquests(g, R);
  if (R.truce) truces(g, R);
  g._warPop = null;
}
const hasPeople = (g, sid) => (g._warPop ? !!g._warPop.get(sid) : g.owned('colonists', sid).length > 0);

/** Slice 6b: a village with at most conquest.beatenShare of its enemy's strength (0: no fit fighters) for
 *  conquest.beatenDays while its enemy has some is beaten. The winner's
 *  profile decides (villageProfile.conquest, default 'absorb'; the player's village absorbs): 'absorb' annexes it
 *  into the winner's kingdom (formed if the winner has none; the beaten village leaves its own, a capital passing
 *  its crown on), 'sack' takes conquest.tribute of its spare goods as a tribute trade (delivered like any trade).
 *  Either way the war ends. The player's village is never beaten this way (Phase 5 open question 2). */
function conquests(g, R) {
  const s = g.s, C = R.conquest, done = new Set(); // a loser is conquered once a day, by the first in key order
  for (const rel of wars(g)) {
    const { a, b } = rel;
    if (done.has(a) || done.has(b)) continue;
    const sa = warStrength(g, a), sb = warStrength(g, b);
    const share = C.beatenShare ?? 0; // beaten: at most this share of the enemy's strength (0: no fit fighters at all)
    const loser = sb > 0 && sa <= sb * share ? a : sa > 0 && sb <= sa * share ? b : null;
    if (!loser || loser === s.playerSettlement) { delete rel.beaten; continue; }
    if (rel.beaten?.sid !== loser) { rel.beaten = { sid: loser, since: s.tick }; continue; }
    if (s.tick - rel.beaten.since < C.beatenDays * TICKS_PER_DAY) continue;
    const winner = loser === a ? b : a;
    delete rel.beaten;
    const prof = s.settlements[winner].profile && g.reg.get('villageProfile', s.settlements[winner].profile);
    const how = winner === s.playerSettlement ? 'absorb' : prof?.conquest || 'absorb';
    done.add(loser);
    if (how === 'sack') sack(g, loser, winner, C);
    else absorb(g, loser, winner);
  }
}

function absorb(g, loser, winner) {
  const s = g.s, ln = nameOf(g, loser), wn = nameOf(g, winner);
  const old = kingdomOf(g, loser);
  if (old) {
    if (old.capital === loser) {
      const heirs = membersOf(g, old.id).filter((x) => x !== loser && !s.settlements[x].fallen).sort((x, y) => g.owned('colonists', y).length - g.owned('colonists', x).length || (x < y ? -1 : 1));
      if (heirs.length) setCapital(g, old.id, heirs[0], `${ln} was conquered`);
    }
    leaveKingdom(g, loser, `conquered by ${wn}`, { force: true });
  }
  const k = kingdomOf(g, winner);
  if (k) joinKingdom(g, loser, k.id, `conquered by ${wn}`);
  else formKingdom(g, winner, loser, { conquered: true });
  makePeace(g, winner, loser, `${ln} was conquered by ${wn}`);
  changeRelation(g, winner, loser, 50, `${ln} is now under ${wn}'s crown`); // from the truce value to friendly
  // Peace with the rest of its new kingdom too (members that had joined the war against it).
  const nk = kingdomOf(g, winner);
  if (nk) for (const m of membersOf(g, nk.id)) if (m !== winner && m !== loser && relationStatus(relationPeek(g, m, loser)) === 'hostile') makePeace(g, m, loser, `${ln} joined ${wn}'s kingdom`);
  g.log(`${wn} has conquered ${ln}: it is now part of ${kingdomOf(g, winner) ? 'its kingdom' : 'its lands'}.`, 'warn');
}

function sack(g, loser, winner, C) {
  const s = g.s, ln = nameOf(g, loser), wn = nameOf(g, winner);
  const legs = [];
  // What it can spare (its plan's surplus, as for ordinary deals) and has free to trade, at most TRIBUTE_MAX an item.
  g.readOnly(() => {
    for (const it of g.reg.all('item').map((d) => d.id).sort()) {
      const q = Math.min(TRIBUTE_MAX, Math.floor(Math.min(spareOf(g, loser, it), availableToTrade(g, loser, it)) * C.tribute));
      if (q > 0) legs.push({ from: loser, to: winner, item: it, qty: q, delivered: 0 });
    }
  });
  makePeace(g, loser, winner, `${ln} was sacked by ${wn}`);
  if (legs.length) {
    const id = g.newId('tr');
    s.trades ||= {};
    g.tradeAdded();
    s.trades[id] = { id, seller: loser, buyer: winner, legs, gift: true, tribute: true, relOnDone: 0, status: 'active', created: s.tick,
      deadline: g.tradeDeadline ? g.tradeDeadline(loser, winner, s.tick + 6 * TICKS_PER_DAY) : s.tick + 6 * TICKS_PER_DAY, reason: `Tribute to ${wn}` };
  }
  g.log(`${wn} has sacked ${ln}${legs.length ? `: ${legs.length} kinds of goods go to ${wn} as tribute` : ''}.`, 'warn');
}

/** Wars in progress: hostile relations with an aggressor, both villages still standing with people. */
function wars(g) {
  const s = g.s, out = [];
  for (const k of Object.keys(s.relations || {}).sort()) {
    const rel = s.relations[k];
    if (!rel.aggressor || relationStatus(rel) !== 'hostile' || !s.settlements[rel.a] || !s.settlements[rel.b]) continue;
    if (!hasPeople(g, rel.a) || !hasPeople(g, rel.b)) continue;
    out.push(rel);
  }
  return out;
}

function battles(g, R) {
  const s = g.s, B = R.battle, day = Math.floor(s.tick / TICKS_PER_DAY);
  for (const rel of wars(g)) {
    const { a, b } = rel;
    if (s.settlements[a].detail !== 'abstract' || s.settlements[b].detail !== 'abstract') continue; // fought for real
    const sa = warStrength(g, a), sb = warStrength(g, b);
    if (!sa && !sb) continue;
    const hit = (side, enemy, strength) => {
      const fit = g.owned('colonists', side).filter((c) => isFit(g, c)).sort((x, y) => (x.id < y.id ? -1 : 1));
      fit.sort((x, y) => hash(`${s.seed}:battle:${x.id}:${day}`) - hash(`${s.seed}:battle:${y.id}:${day}`));
      const x = strength * B.woundsPerStrength; // whole wounds, plus one more with the chance of the fraction
      const n = Math.min(fit.length, Math.floor(x) + (draw(`${s.seed}:hits:${side}:${enemy}:${day}`) < x - Math.floor(x) ? 1 : 0));
      for (let k = 0; k < n; k++) {
        const c = fit[k], sev = B.minSeverity + (B.maxSeverity - B.minSeverity) * draw(`${s.seed}:wound:${c.id}:${day}`);
        injure(g, c, 'wound', sev, `Wounded fighting ${nameOf(g, enemy)}`, false, side === s.playerSettlement ? 'warn' : 'info');
      }
      return n;
    };
    const na = hit(a, b, sb), nb = hit(b, a, sa);
    if (na + nb) rel.lastClash = s.tick;
    if (na + nb) g.log(`Fighting between ${nameOf(g, a)} and ${nameOf(g, b)}: ${na} wounded in ${nameOf(g, a)}, ${nb} in ${nameOf(g, b)}.`, 'warn', `battle:${a}|${b}`, TICKS_PER_DAY);
    spreadContact(g, a, b, 'the fighting');
  }
}

function truces(g, R) {
  const s = g.s, T = R.truce;
  for (const rel of wars(g)) {
    const { a, b } = rel;
    if (!s.settlements[a].ai || !s.settlements[b].ai) continue; // the player makes peace through diplomacy
    if (rel.warSince === undefined) rel.warSince = s.tick; // a war from an older save, or started another way: from today
    const sa = warStrength(g, a), sb = warStrength(g, b);
    const old = rel.warSince !== undefined && s.tick - rel.warSince >= T.maxDays * TICKS_PER_DAY;
    let weak = null;
    if (sa < sb * T.weakerShare) weak = a; else if (sb < sa * T.weakerShare) weak = b;
    const fought = rel.warSince === undefined || s.tick - rel.warSince >= (T.minDays ?? 0) * TICKS_PER_DAY;
    if ((!weak || !fought) && !old) continue;
    const who = weak || (sa <= sb ? a : b), other = who === a ? b : a;
    const why = weak ? `${nameOf(g, who)} is losing` : 'the war has gone on too long';
    makePeace(g, who, other, `${nameOf(g, who)} sued for peace`);
    delete rel.warSince;
    g.log(`${nameOf(g, who)} sued ${nameOf(g, other)} for peace (${why}); the war is over.`, 'warn');
  }
}

function declarations(g, R) {
  const s = g.s, ids = Object.keys(s.settlements || {}).sort();
  const strength = new Map();
  const str = (sid) => { if (!strength.has(sid)) strength.set(sid, warStrength(g, sid)); return strength.get(sid); };
  for (const a of ids) {
    if (!s.settlements[a].ai || !hasPeople(g, a)) continue;
    for (const b of ids) {
      if (a === b || !hasPeople(g, b)) continue;
      const rel = relationPeek(g, a, b);
      if (!rel.contact || rel.value > R.declareBelow || rel.aggressor) continue;
      if (allianceOf(g, a, b) || sameKingdom(g, a, b)) continue;
      // Only where a fight can happen: both distant (battles), or the attacker in full detail (raids), or on the
      // player's village (a war with the player brings the attacker into full detail, lod.js).
      if (s.settlements[a].detail === 'abstract' && s.settlements[b].detail !== 'abstract' && b !== s.playerSettlement) continue;
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
