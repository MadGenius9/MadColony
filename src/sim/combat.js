// Combat (stage 1). Only colonists of settlements that are hostile to each other fight; neutral and
// friendly villagers are never targeted. Each settlement has a military order: defend (the default:
// fight hostile people near you or on your land), attack a named village, or retreat (everyone goes
// home and avoids fighting). Attacks need range and a clear line of sight; they can miss; damage uses
// the health system. Ranged weapons use ammunition carried in a pouch (`c.ammo`, drawn from the
// stockpile). Wounded fighters fall back; unarmed people flee; collapsed fighters drop out. Nobody dies.
import { mayFight } from './people.js';
import { travel, newJob } from './ai/jobs.js';
import { injure, isDown, hpOf } from './health.js';
import { warRules } from './war.js';
import { relationOf, relationPeek, relationStatus, changeRelation, noteRelation, noteMet, allianceOf, alliesOf, endAlliance, ALLIANCE } from './villages.js';
import { settlementOf } from './research.js';
import { kingdomOf, membersOf, sameKingdom, theKingdom } from './kingdoms.js';
import { octile } from './util.js';
import { modsOf } from './peoples.js';
import { lawIs } from './worldlaws.js';

export const COMBAT = {
  scanEvery: 5, // ticks between a colonist's threat checks
  engageRange: 9, // tiles: enemies this close are engaged (or fled from)
  fleeRange: 5,
  fitHp: 50, // health needed to join a fight
  retreatHp: 40, // fighters below this fall back
  ammoLoad: 12, // rounds a fighter tries to carry
  unarmed: { name: 'fists', damage: 3, range: 1.5, cooldown: 50, accuracy: 0.7 },
  woundRelation: -2, // relation cost per wound inflicted
};
export const COMBAT_JOBS = new Set(['fight', 'flee', 'arm', 'fend', 'slay']); // fend: against wild animals (hunt.js); slay: monsters (slay.js)

const sidOf = (g, c) => c.settlementId || g.s.playerSettlement;

/** Are these two settlements at war (hostile)? Members of one kingdom never are (kingdoms.js), even with a
 *  hostile relation: their colonists do not engage each other, a running raid on a fellow member is called off
 *  (tickMilitary retreats), and the daily kingdom check makes one of them leave, after which they may fight. */
export function isEnemy(g, a, b) {
  if (!a || !b || a === b) return false;
  const rel = relationPeek(g, a, b);
  if (relationStatus(rel) !== 'hostile' || sameKingdom(g, a, b)) return false;
  // War games (war.js): only a war that was started (declared, or an attack ordered) makes enemies; rivals who are
  // merely hostile neither fight on sight, raid, nor keep each other in full detail.
  return !rel.aggressor && warRules(g) ? false : true;
}

/** The military order of a settlement: { order: 'defend' | 'attack' | 'retreat', target? }. */
export function orderOf(g, sid) { return g.s.military?.[sid] || { order: 'defend' }; }
export function setOrder(g, sid, order, target = null) {
  g.s.military ||= {};
  g.s.military[sid] = { order, target, since: g.s.tick };
  const name = settlementOf(g, sid)?.name || sid;
  g.log(order === 'attack' ? `${name} is attacking ${settlementOf(g, target)?.name || target}.` : order === 'retreat' ? `${name}: everyone fall back home.` : `${name} is defending its land.`, 'warn');
}

/** Weapon stats in use, or fists. A ranged weapon without ammunition fights as fists. */
export function weaponOf(g, c) {
  const e = c.equip?.weapon;
  const def = e && g.reg.get('item', e.item);
  const eq = def?.equipment;
  if (!eq) return { ...COMBAT.unarmed, armed: false };
  const w = { name: def.name, item: def.id, damage: eq.damage ?? 5, range: eq.range ?? 1.5, cooldown: eq.cooldown ?? 45, accuracy: eq.accuracy ?? 0.75, ammo: eq.ammo || null, armed: true };
  if (w.ammo && !(c.ammo?.item === w.ammo && c.ammo.qty > 0)) return { ...COMBAT.unarmed, armed: true, outOfAmmo: true, wants: w };
  return w;
}

/** Tiles that block a shot: buildings that cannot be walked through, and solid resource nodes. */
function blocksSight(g, x, y) {
  const st = g.structAt(x, y);
  if (st && st.built && !g.bDef(st)?.passable) return true;
  const n = g.nodeAt(x, y);
  return !!(n && !g.nodeDef(n)?.passable);
}
/** Clear line of sight between two tiles (the end tiles themselves never block). */
export function hasLOS(g, x0, y0, x1, y1) {
  let x = x0, y = y0;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x === x1 && y === y1) return true;
    if (!(x === x0 && y === y0) && blocksSight(g, x, y)) return false;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

/** How much a single tile shelters someone next to it: buildings and nodes may set `cover`; otherwise
 *  walls give 0.5 and other solid things 0.3. Open ground, doors and passable things give none. */
export function coverAt(g, x, y) {
  const st = g.structAt(x, y);
  if (st && st.built) {
    const d = g.bDef(st);
    if (d?.cover !== undefined) return d.cover;
    if (!d?.passable) return d?.category === 'wall' ? 0.5 : 0.3;
  }
  const n = g.nodeAt(x, y);
  if (n) {
    const d = g.nodeDef(n);
    if (d?.cover !== undefined) return d.cover;
    if (!d?.passable) return 0.3;
  }
  return 0;
}
/** Cover a target at (tx, ty) has against a shot from (sx, sy): the best sheltering tile right beside the
 *  target on the shooter's side. Melee ignores cover. */
export function coverBetween(g, sx, sy, tx, ty) {
  const dx = sx - tx, dy = sy - ty;
  if (Math.hypot(dx, dy) < 2) return 0;
  let best = 0;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    if (!ox && !oy) continue;
    if (ox * dx + oy * dy <= 0) continue; // only the side facing the shooter
    // a tile squarely between counts fully, one off to the side half
    const k = (ox * dx + oy * dy) / (Math.hypot(ox, oy) * Math.hypot(dx, dy)) > 0.7 ? 1 : 0.5;
    best = Math.max(best, coverAt(g, tx + ox, ty + oy) * k);
  }
  return best;
}

/** Nearest enemy (not collapsed) within `range` tiles of c, or null. */
export function nearestEnemy(g, c, range = COMBAT.engageRange) {
  const sid = sidOf(g, c);
  // The settlements it is at war with, once per call (O(villages) relation lookups instead of one per colonist);
  // none: no enemy anywhere. The same answer as testing every colonist's settlement.
  let foes = null;
  for (const o of Object.keys(g.s.settlements || {})) if (isEnemy(g, sid, o)) (foes ||= new Set()).add(o);
  if (!foes) return null;
  let best = null, bd = Infinity;
  for (const o of Object.values(g.s.colonists)) {
    if (o === c || !foes.has(sidOf(g, o)) || isDown(o)) continue;
    const d = octile(c.x, c.y, o.x, o.y);
    if (d <= range && d < bd) { bd = d; best = o; }
  }
  return best;
}

/** Transient visual effects (shots, hits); never saved. */
function fx(g, e) { (g.fx ||= []).push({ ...e, tick: g.s.tick }); if (g.fx.length > 60) g.fx.splice(0, g.fx.length - 60); }

/** One attack from c at t with weapon w. Returns 'hit' | 'miss'. */
export function attack(g, c, t, w) {
  const d = Math.hypot(t.x - c.x, t.y - c.y);
  relationOf(g, sidOf(g, c), sidOf(g, t)).lastClash = g.s.tick;
  if (w.ammo) { c.ammo.qty -= 1; g.consume(w.ammo, 1, 'shot'); if (c.ammo.qty <= 0) c.ammo = null; }
  const cover = w.range > 2 ? coverBetween(g, c.x, c.y, t.x, t.y) : 0;
  const p = Math.max(0.05, w.accuracy * (1 - Math.max(0, d - 1) / (w.range * 2.5)) * (1 - cover));
  const hit = g.rng.next() < p;
  fx(g, { kind: w.range > 2 ? 'shot' : 'swing', from: c.id, to: t.id, hit, cover: cover > 0, x0: c.x, y0: c.y, x1: t.x, y1: t.y });
  if (c.equip?.weapon) c.equip.weapon.dur = Math.max(0, (c.equip.weapon.dur ?? 1) - 1);
  if (!hit) return 'miss';
  const dmg = w.damage * (0.7 + 0.6 * g.rng.next());
  injure(g, t, 'wound', dmg, `Wounded by ${c.name}'s ${w.name}`);
  changeRelation(g, sidOf(g, c), sidOf(g, t), COMBAT.woundRelation, `${settlementOf(g, sidOf(g, c))?.name} wounded ${t.name}`);
  return 'hit';
}

function go(g, c, j, x, y, mode, what) {
  const r = travel(g, c, j, x, y, mode, what);
  if (r === true) return 'arrived';
  if (r === false) return 'moving';
  return r;
}

export const COMBAT_DRIVERS = {
  // Close in until in range with a clear shot, then attack on the weapon's cooldown.
  fight: {
    tick(g, c, j) {
      if (hpOf(c) < COMBAT.retreatHp) return { fail: 'Wounded: falling back' };
      if (!j.targetId) { // marching toward an enemy village
        const r = go(g, c, j, j.tx, j.ty, 'on', 'the enemy');
        c.status.action = `Marching on ${settlementOf(g, j.against)?.name || 'the enemy'}`;
        return r === 'arrived' ? 'done' : r === 'moving' ? 'running' : r;
      }
      const t = g.s.colonists[j.targetId];
      if (!t || isDown(t) || !isEnemy(g, sidOf(g, c), sidOf(g, t))) return 'done';
      const w = weaponOf(g, c);
      const d = Math.hypot(t.x - c.x, t.y - c.y);
      if (j.cover) { // moving into a covered firing spot
        const r = travel(g, c, j, j.cover.x, j.cover.y, 'on', 'cover');
        if (r === false) { c.status.action = `Taking cover from ${t.name}`; return 'running'; }
        j.cover = null;
        if (r !== true) j.coverTried = true; // could not get there: fight from here
      }
      if (d <= w.range + 0.01 && !c.mv && hasLOS(g, c.x, c.y, t.x, t.y)) {
        if (w.range > 2 && !j.coverTried) {
          j.coverTried = true;
          const spot = coverSpot(g, c, t, w);
          if (spot) { j.cover = spot; c.status.action = `Taking cover from ${t.name}`; return 'running'; }
        }
        c.path = null;
        j.cool = (j.cool || 0) - 1;
        const mine = coverBetween(g, t.x, t.y, c.x, c.y);
        c.status.action = `Fighting ${t.name} (${w.name}${w.outOfAmmo ? ', out of ammunition' : ''}${mine > 0 ? `, in cover ${Math.round(mine * 100)}%` : ''})`;
        if (j.cool > 0) return 'running';
        attack(g, c, t, w);
        j.cool = w.cooldown;
        return 'running';
      }
      if (d <= w.range + 0.01 && !c.mv) { j.blocked = (j.blocked || 0) + 1; c.status.action = `No clear shot at ${t.name}: moving`; }
      const r = travel(g, c, j, t.x, t.y, w.range > 2 && d <= w.range ? 'on' : 'adj', t.name);
      if (r === true) return 'running';
      if (r === false) { c.status.action = `Closing in on ${t.name}`; return 'running'; }
      return r;
    },
  },
  // Run home (the settlement centre) and stay out of the fight.
  flee: {
    tick(g, c, j) {
      c.status.action = j.why || 'Fleeing to safety';
      const r = go(g, c, j, j.x, j.y, 'on', 'safety');
      return r === 'arrived' ? 'done' : r === 'moving' ? 'running' : r;
    },
  },
  // Fill the ammunition pouch from one of our stacks.
  arm: {
    valid(g, c, j) { return !!g.s.stacks[j.stackId]; },
    tick(g, c, j) {
      const st = g.s.stacks[j.stackId];
      if (!st) return { fail: 'The ammunition is gone' };
      const r = go(g, c, j, st.x, st.y, 'on', g.reg.get('item', j.item)?.name);
      if (r !== 'arrived') return r === 'moving' ? 'running' : r;
      g.release(j);
      const got = g.takeFromStack(j.stackId, j.qty);
      if (!got) return { fail: 'The ammunition is gone' };
      if (c.ammo && c.ammo.item !== got.item) { g.placeItems(c.ammo.item, c.ammo.qty, c.x, c.y); c.ammo = null; }
      c.ammo = { item: got.item, qty: (c.ammo?.qty || 0) + got.qty };
      c.status.action = `Took ${got.qty} ${g.reg.get('item', got.item)?.name}`;
      return 'done';
    },
  },
};

/** A nearby spot (within 2 steps) that keeps range and a clear shot at t but gives c more cover from t. */
export function coverSpot(g, c, t, w) {
  const here = coverBetween(g, t.x, t.y, c.x, c.y);
  let best = null, bs = here + 0.1;
  for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
    const x = c.x + ox, y = c.y + oy;
    if ((!ox && !oy) || !g.inB(x, y) || !g.isPassable(x, y)) continue;
    if (Object.values(g.s.colonists).some((o) => o !== c && o.x === x && o.y === y)) continue;
    if (Math.hypot(t.x - x, t.y - y) > w.range || !hasLOS(g, x, y, t.x, t.y)) continue;
    const s = coverBetween(g, t.x, t.y, x, y) - Math.hypot(ox, oy) * 0.02;
    if (s > bs && g.canReach(c, x, y, 'on')) { bs = s; best = { x, y }; }
  }
  return best;
}

/** A job to fetch ammunition for c's ranged weapon, or null if not needed / none available. */
export function armJob(g, c) {
  const e = c.equip?.weapon, eq = e && g.reg.get('item', e.item)?.equipment;
  if (!eq?.ammo) return null;
  const have = c.ammo?.item === eq.ammo ? c.ammo.qty : 0;
  if (have >= COMBAT.ammoLoad / 2) return null;
  let best = null, bd = Infinity;
  for (const st of g.stacksByItem().get(eq.ammo) || []) {
    if (!g.mine(st, c) || g.availQty(st.id) <= 0 || !g.canReach(c, st.x, st.y, 'on')) continue;
    const d = octile(c.x, c.y, st.x, st.y);
    if (d < bd) { bd = d; best = st; }
  }
  if (!best || bd > 30) return null;
  const qty = Math.min(COMBAT.ammoLoad - have, g.availQty(best.id));
  const job = newJob('arm', { stackId: best.id, item: eq.ammo, qty }, { why: 'Arming for a fight', label: `Take ${qty} ${g.reg.get('item', eq.ammo)?.name}` });
  return g.reserveQty(job, best.id, qty) ? job : null;
}

/**
 * Threat check for one colonist (every few ticks). Returns a combat job to start now, or null.
 * Order of concerns: retreat orders and wounds → flee; enemies close by → fight (armed, fit) or flee;
 * attack orders → arm, then march on the target village.
 */
export function combatDecision(g, c) {
  if (isDown(c)) return null;
  if ((g.s.tick + c.id.length * 3) % COMBAT.scanEvery) return null;
  if (c.job && COMBAT_JOBS.has(c.job.type) && c.job.type !== 'fend' && c.job.type !== 'slay' && !(c.job.type === 'flee' && (c.job.wolf || c.job.monster))) return null; // raiders come before wolves and monsters
  const sid = sidOf(g, c);
  const ord = orderOf(g, sid);
  const st = settlementOf(g, sid);
  const home = st?.center || g.s.center;
  if (!mayFight(g, c)) { const e = nearestEnemy(g, c, COMBAT.engageRange); const h = settlementOf(g, sidOf(g, c))?.center || g.s.center; return e && octile(c.x, c.y, h.x, h.y) > 2 ? newJob('flee', { x: h.x, y: h.y, why: 'Too young to fight: running home' }, { why: 'Too young to fight', label: 'Run home' }) : null; }
  const w = weaponOf(g, c);
  const reach = Math.max(COMBAT.engageRange, (w.wants?.range || w.range) + 2);
  const enemy = nearestEnemy(g, c, reach);
  const fleeJob = (why) => (octile(c.x, c.y, home.x, home.y) > 2 ? newJob('flee', { x: home.x, y: home.y, why }, { why, label: why }) : null);
  if (ord.order === 'retreat') {
    if (enemy || g.territoryAt(c.x, c.y) !== sid) return fleeJob('Falling back home (retreat order)');
    return null;
  }
  const m = modsOf(g, c), hp = hpOf(c);
  const fit = hp >= fitHpOf(g, c); // brave people fight on while hurt; timid ones never join (peoples.js)
  if (enemy) {
    if (w.armed && fit) {
      if (w.outOfAmmo && Math.hypot(enemy.x - c.x, enemy.y - c.y) > 4) { const aj = armJob(g, c); if (aj) return aj; }
      const brave = hp < COMBAT.fitHp ? ' (brave: fighting on while hurt)' : '';
      return newJob('fight', { targetId: enemy.id, stage: 'fight' }, { why: `Fighting ${enemy.name}${brave}`, label: `Fight ${enemy.name}` });
    }
    if (octile(c.x, c.y, enemy.x, enemy.y) <= (m.flee ?? COMBAT.fleeRange)) return fleeJob(!w.armed ? 'Unarmed: fleeing from enemies' : m.fightHp > 100 ? 'Timid: fleeing from the fight' : 'Wounded: avoiding the fight');
    return null;
  }
  if (ord.order === 'attack' && ord.target && w.armed && fit && isEnemy(g, sid, ord.target)) {
    const aj = armJob(g, c);
    if (aj) return aj;
    const tc = settlementOf(g, ord.target)?.center;
    if (tc && octile(c.x, c.y, tc.x, tc.y) > 3) return newJob('fight', { targetId: null, tx: tc.x, ty: tc.y, against: ord.target }, { why: `Attacking ${settlementOf(g, ord.target)?.name}`, label: 'March on the enemy' });
  }
  return null;
}

/** The health colonist c needs to fight: COMBAT.fitHp, or their trait's (brave: lower; timid: above 100, never). */
export function fitHpOf(g, c) { return modsOf(g, c).fightHp ?? COMBAT.fitHp; }

/** Fit, armed fighters a settlement has right now. */
export function fightersOf(g, sid, bySid = null) {
  return (bySid ? bySid.get(sid) || [] : Object.values(g.s.colonists)).filter((c) => sidOf(g, c) === sid && !isDown(c) && hpOf(c) >= fitHpOf(g, c) && !!c.equip?.weapon && mayFight(g, c));
}

/** AI villages decide their own orders every 100 ticks: raid a hostile neighbour they clearly outnumber,
 *  call a raid off when it goes badly, and go back to defending after falling back. */
export function tickMilitary(g) {
  // The colonists by settlement, once (in Object.values order; nothing below moves anyone between villages or
  // changes their health or arms): O(colonists + villages) instead of O(colonists) per village.
  const bySid = new Map();
  for (const c of Object.values(g.s.colonists)) { const k = sidOf(g, c); let a = bySid.get(k); if (!a) bySid.set(k, (a = [])); a.push(c); }
  for (const st of Object.values(g.s.settlements || {})) {
    if (!st.ai) continue;
    const ord = orderOf(g, st.id);
    const mine = fightersOf(g, st.id, bySid);
    const people = bySid.get(st.id) || [];
    const downShare = people.length ? people.filter(isDown).length / people.length : 0;
    if (ord.order === 'attack') {
      if (!isEnemy(g, st.id, ord.target) || mine.length < 1 || downShare >= 0.5) setOrder(g, st.id, 'retreat');
      continue;
    }
    if (ord.order === 'retreat') {
      if (g.s.tick - (ord.since || 0) > 1200) setOrder(g, st.id, 'defend');
      continue;
    }
    if (st.detail === 'abstract') continue; // raids are only launched by villages simulated in full (lod.js)
    for (const other of Object.keys(g.s.settlements)) {
      if (!isEnemy(g, st.id, other) || relationPeek(g, st.id, other).value > -50 || allianceOf(g, st.id, other) || sameKingdom(g, st.id, other)) continue;
      const theirs = fightersOf(g, other, bySid).length;
      if (mine.length >= 2 && mine.length >= theirs * 1.5) { setOrder(g, st.id, 'attack', other); strikeFirst(g, st.id, other); break; }
    }
  }
}

// ---------------- war and peace ----------------
// Attacking a village you are not at war with declares war first: relations drop to hostile, any trade
// pact ends and open trades are cancelled by the usual hostile rule. The risks are listed before the
// order is given. Wars cool on their own when nobody is hurt for a while, and either side can offer a truce.
export const WAR = { declareTo: -40, truceTo: -20, coolAfterDays: 2, coolPerDay: 2 };

const ammoStock = (g, sid, item) => (g.stacksByItem().get(item) || []).filter((st) => g.territoryAt(st.x, st.y) === sid || st.owner === sid).reduce((n, st) => n + st.qty, 0);

/** What an attack on `target` would mean, for the order dialog: strength on both sides and every risk. */
export function evaluateAttack(g, sid, target) {
  const name = settlementOf(g, target)?.name || target;
  const rel = relationPeek(g, sid, target);
  const status = relationStatus(rel);
  const ours = fightersOf(g, sid), theirs = fightersOf(g, target);
  const res = { valid: true, problems: [], lines: [], risks: [], declares: status !== 'hostile', ours: ours.length, theirs: theirs.length };
  if (sid === target || !settlementOf(g, target)) { res.valid = false; res.problems.push('There is no such village.'); return res; }
  if (settlementOf(g, target).fallen) { res.valid = false; res.problems.push(`${name} has fallen; only ruins are left.`); return res; } // fallen.js
  if (!rel.contact) { res.valid = false; res.problems.push(`You have not met ${name} yet.`); }
  if (allianceOf(g, sid, target)) { res.valid = false; res.problems.push(`${name} is your ally. End the alliance first.`); }
  if (sameKingdom(g, sid, target)) { res.valid = false; res.problems.push(`${name} is in your kingdom (${kingdomOf(g, sid).name}).`); }
  if (lawIs(g, 'core:peace', 'on') && !isEnemy(g, sid, target)) { res.valid = false; res.problems.push(`The Peace law holds: no new war may start (you are not at war with ${name}).`); }
  if (!ours.length) { res.valid = false; res.problems.push('Nobody fit is armed. Make weapons first (spears, bows).'); }
  const ranged = ours.filter((c) => g.reg.get('item', c.equip.weapon.item)?.equipment?.ammo);
  res.lines.push(`Your fighters: ${ours.length} armed and fit (${ranged.length} with ranged weapons). Theirs: about ${theirs.length}.`);
  for (const it of new Set(ranged.map((c) => g.reg.get('item', c.equip.weapon.item).equipment.ammo))) {
    const carried = ranged.reduce((n, c) => n + (c.ammo?.item === it ? c.ammo.qty : 0), 0);
    res.lines.push(`${g.reg.get('item', it)?.name || it}: ${carried} carried, ${ammoStock(g, sid, it)} in store.`);
  }
  if (ours.length && ours.length < theirs.length) res.risks.push(`They have more fighters than you: expect to lose.`);
  if (res.declares) {
    res.risks.push(`This declares war: relations with ${name} drop from ${rel.value} to ${WAR.declareTo} (hostile).`);
    if (g.s.treaties?.[[sid, target].sort().join('|')]) res.risks.push('Your trade pact with them ends.');
    const open = Object.values(g.s.trades || {}).filter((t) => t.status === 'active' && ((t.seller === sid && t.buyer === target) || (t.seller === target && t.buyer === sid)));
    if (open.length) res.risks.push(`${open.length} open trade(s) with them are cancelled.`);
    res.risks.push(`They will defend themselves and may raid you back while the war lasts.`);
  }
  const allies = defendersOf(g, target).filter((z) => z !== sid);
  if (allies.length && !startsWar(g, sid, target)) {
    const by = rel.aggressor === sid ? 'you' : settlementOf(g, rel.aggressor)?.name || rel.aggressor;
    res.lines.push(`This war was started by ${by}: ${name}'s allies and kingdom are not called in again.`);
  } else for (const z of allies) {
    const zn = settlementOf(g, z)?.name || z;
    const tie = sameKingdom(g, target, z) ? `in ${name}'s kingdom` : `allied with ${name}`;
    if (allianceOf(g, sid, z)) res.risks.push(`${zn} is allied with both of you: it stays out, and its alliance with you ends.`);
    else if (sameKingdom(g, sid, z)) res.risks.push(`${zn} is ${tie} but also in your kingdom: it stays out.`);
    else res.risks.push(`${zn} is ${tie} and will join the war.`);
  }
  res.risks.push('Wounded colonists collapse and need care; every wound worsens relations further.');
  return res;
}

/** An AI village declares war (war.js, Phase 5): relations go to WAR.declareTo at most, a trade pact ends, it
 *  orders an attack, and the attacked village's allies and kingdom are called in (strikeFirst). */
export function declareWar(g, sid, target, reason) {
  if (lawIs(g, 'core:peace', 'on') && !isEnemy(g, sid, target)) return false; // the Peace law: no new wars
  const rel = relationOf(g, sid, target);
  if (rel.value > WAR.declareTo) changeRelation(g, sid, target, WAR.declareTo - rel.value, reason);
  else { rel.history.push({ tick: g.s.tick, delta: 0, reason }); if (rel.history.length > 16) rel.history.splice(0, rel.history.length - 16); }
  delete rel.threat;
  rel.warSince = g.s.tick; // war.js: AI wars end in a truce when old (save format 20)
  const k = [sid, target].sort().join('|');
  if (g.s.treaties?.[k]) { delete g.s.treaties[k]; rel.history.push({ tick: g.s.tick, delta: 0, reason: 'Trade pact ended: war' }); }
  g.log(`${reason}.`, 'warn');
  setOrder(g, sid, 'attack', target);
  strikeFirst(g, sid, target);
}

/** The player (or a script) orders an attack. Declares war first if needed. */
export function orderAttack(g, sid, target) {
  const ev = evaluateAttack(g, sid, target);
  if (!ev.valid) return { ok: false, message: ev.problems.join(' ') };
  if (ev.declares) {
    const rel = relationOf(g, sid, target);
    changeRelation(g, sid, target, WAR.declareTo - rel.value, `${settlementOf(g, sid)?.name} declared war`);
    const k = [sid, target].sort().join('|');
    if (g.s.treaties?.[k]) { delete g.s.treaties[k]; rel.history.push({ tick: g.s.tick, delta: 0, reason: 'Trade pact ended: war' }); }
  }
  setOrder(g, sid, 'attack', target);
  strikeFirst(g, sid, target);
  return { ok: true, message: 'Attack ordered.' };
}

// Who started a war. Allies are called in only when a war is started, never for a defensive or
// retaliatory raid, so wars do not chain through the alliance graph. The relation record of a warring
// pair keeps `aggressor` (the side whose attack started it, set at the first attack order or AI raid of
// the war) and, for a village that joined to defend an ally, `joinedFor` (that ally; its `aggressor` is the
// attacker it is defending against). Both are written only then, and are removed by changeRelation as
// soon as the pair is no longer hostile (truce, cooling down), so the next war starts afresh.

/** Would an attack by `x` on `y` start a war (and so call in `y`'s allies)? Read-only. */
export function startsWar(g, x, y) { return !relationPeek(g, x, y).aggressor; }

/** `x` attacks `y`. The first attack of a war records `x` as the aggressor and calls in `y`'s allies and kingdom;
 *  later attacks, retaliation by `y`, and raids by a village that joined to defend an ally call in nobody. */
function strikeFirst(g, x, y) {
  if (!startsWar(g, x, y)) return false;
  const r = relationOf(g, x, y);
  r.aggressor = x;
  r.warSince ??= g.s.tick; // war.js: how old the war is
  joinDefence(g, x, y);
  return true;
}

/** Who defends `y` when a war on it starts: its allies and the other members of its kingdom (kingdoms.js),
 *  sorted, without duplicates. Read-only, O(allies + S). */
export function defendersOf(g, y) {
  const out = new Set(alliesOf(g, y));
  const k = kingdomOf(g, y);
  if (k) for (const z of membersOf(g, k.id)) if (z !== y) out.add(z);
  return [...out].sort();
}

/** Allies of the attacked village `y`, and the other members of its kingdom, turn hostile to the attacker `x`
 *  (O(allies + members)). A defender tied to both sides stays out: an alliance with `x` ends at no cost to
 *  it; a kingdom shared with `x` is kept. No chaining: allies of the defenders do nothing, and a joiner's
 *  war with `x` is marked as defensive (aggressor `x`), so its own raids call in nobody. Only relations
 *  change; nothing here promotes a distant village (lod.js decides that from its own rules). */
export function joinDefence(g, x, y) {
  const ny = settlementOf(g, y)?.name || y;
  for (const z of defendersOf(g, y)) {
    if (z === x) continue;
    const kin = sameKingdom(g, y, z);
    const via = kin ? `${ny}, of our kingdom` : `our ally ${ny}`;
    if (allianceOf(g, x, z)) { endAlliance(g, x, z, z, `attacked ${via}`, { free: true }); continue; }
    if (sameKingdom(g, x, z)) {
      g.log(`${settlementOf(g, z)?.name || z} stays out of the war on ${ny}: it is in ${theKingdom(kingdomOf(g, x).name)} with ${settlementOf(g, x)?.name || x}.`, 'warn');
      continue;
    }
    const rel = relationOf(g, z, x);
    if (!rel.contact) { rel.contact = true; noteMet(g, rel, `Met through ${via}`); noteRelation(g, z, x, `Met through ${via}`); }
    if (rel.value <= ALLIANCE.joinRelation) continue; // already at war with x
    changeRelation(g, z, x, ALLIANCE.joinRelation - rel.value, `Attacked ${via}`);
    if (!rel.aggressor) { rel.aggressor = x; rel.joinedFor = y; rel.warSince = g.s.tick; }
    g.log(`${settlementOf(g, z)?.name || z} joins the war on ${ny}'s side${kin ? ` (${theKingdom(kingdomOf(g, y).name)})` : ''}.`, 'warn');
  }
}

/** Would `target` accept a truce from `sid`? They accept unless they are clearly winning. */
export function evaluateTruce(g, sid, target) {
  const rel = relationPeek(g, sid, target);
  if (relationStatus(rel) !== 'hostile') return { valid: false, accept: false, verdict: 'You are not at war.' };
  const ours = fightersOf(g, sid).length, theirs = fightersOf(g, target).length;
  const attacking = orderOf(g, target).order === 'attack' && orderOf(g, target).target === sid;
  const accept = !(attacking && theirs > ours * 1.5);
  return { valid: true, accept, verdict: accept ? `They would accept: relations go to ${WAR.truceTo} (neutral) and both sides stand down.` : 'They are winning and would refuse.' };
}
export function offerTruce(g, sid, target) {
  const ev = evaluateTruce(g, sid, target);
  if (!ev.valid || !ev.accept) return { ok: false, message: ev.verdict };
  makePeace(g, sid, target, `${settlementOf(g, sid)?.name} and ${settlementOf(g, target)?.name} agreed a truce`);
  return { ok: true, message: 'Truce agreed.' };
}
export function makePeace(g, a, b, reason) {
  const rel = relationOf(g, a, b);
  changeRelation(g, a, b, WAR.truceTo - rel.value, reason);
  for (const s of [a, b]) { const o = orderOf(g, s); if (o.order !== 'defend' && (o.target === a || o.target === b || o.order === 'retreat')) setOrder(g, s, 'defend'); }
}

/** War games: are a and b rivals over land (their lands touch, or their centres are within rivalry.near)? */
function rivals(g, a, b) {
  const R = warRules(g)?.rivalry;
  if (!R) return false;
  if (relationPeek(g, a, b).touch !== undefined) return true;
  const ca = g.s.settlements[a]?.center, cb = g.s.settlements[b]?.center;
  return !!(R.near && ca && cb && Math.hypot(ca.x - cb.x, ca.y - cb.y) <= R.near);
}

/** Daily: wars where nobody has been hurt for a while cool down; AI villages losing a war ask for a truce. */
export function tickWars(g, ticksPerDay) {
  const ids = Object.keys(g.s.settlements || {});
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i], b = ids[j];
    const rel = relationPeek(g, a, b);
    if (relationStatus(rel) !== 'hostile') continue;
    const quiet = g.s.tick - (rel.lastClash || 0) > WAR.coolAfterDays * ticksPerDay;
    // War games (war.js): only a war cools; rivals who never fought stay hostile.
    const rivalsOnly = !rel.aggressor && !!warRules(g) && rivals(g, a, b);
    if (quiet && !rivalsOnly) changeRelation(g, a, b, WAR.coolPerDay, 'Tempers cool: no fighting for a while');
    for (const [me, them] of [[a, b], [b, a]]) {
      const st = settlementOf(g, me);
      if (!st?.ai || settlementOf(g, them)?.ai) continue; // AI villages sue the player; AI-vs-AI wars just cool
      const losing = !quiet && fightersOf(g, me).length < fightersOf(g, them).length / 2;
      if (losing && relationStatus(relationPeek(g, me, them)) === 'hostile') {
        makePeace(g, me, them, `${st.name} asked for a truce`);
        g.log(`${st.name} has asked for a truce, and the fighting stops.`, 'trade');
      }
    }
  }
}
