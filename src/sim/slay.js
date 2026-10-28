// People against monsters (Phase 8c slice 3, docs/proposals/phase-8c-wild-monsters.md).
// - monsterDanger (ai.js, like wolfDanger): someone outdoors within SEE tiles of a monster that threatens them runs
//   (the flee job, "Running from the Barkmaw"), unless they are on a hunt party for it.
// - Giver core:slay_monster (work type Hunting): when a near monster threatens the village (a Barkmaw within
//   THREAT of its centre, or a monster that hurt its people, fields or buildings in the last 3 days), and the
//   village has at least the monster's fightGroup armed, fit adults, each of them may join the hunt party (one slot
//   per fighter, fightGroup + 1 slots); an armed fighter whom a monster comes near joins it instead of running. The
//   job `slay`: walk to within HOLD tiles; close in and strike once fightGroup of the party are within PARTY tiles
//   of the monster (one alone holds back), then fight on while two of them are; give up when
//   hurt (health 40 or less) or after GIVE_UP ticks. A kill (killMonster 'slain') leaves the carcass (or the drops)
//   where it fell, through the ledger (created:hunt).
// - Giver core:clear_lair: an empty, uncleared lair within CLEAR_R of the village centre is cleared by one adult
//   (CLEAR_WORK ticks at it): it never grows another monster.
import { newJob, travel, practice } from './ai/jobs.js';
import { huntWeapon } from './hunt.js';
import { hpOf } from './health.js';
import { roomAt } from './heat.js';
import { killMonster, woundMonster, standing, homeOf } from './monsters.js';
import { isAdult } from './people.js';
import { modsOf } from './peoples.js';

const SEE = 10, THREAT = 40, HOLD = 7, PARTY = 8, GIVE_UP = 1500, CLEAR_R = 60, CLEAR_WORK = 300;
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sidOf = (g, c) => c.settlementId || g.s.playerSettlement;
const centreOf = (g, sid) => g.s.settlements?.[sid]?.center || g.s.center;
/** Near monsters in id order (derived, once a tick). */
function nearMonsters(g) {
  if (g._slayNear?.tick === g.s.tick) return g._slayNear.list;
  const list = Object.values(g.s.monsters?.list || {}).filter((m) => m.near !== undefined).sort((a, b) => byId(a.id, b.id));
  return (g._slayNear = { tick: g.s.tick, list }).list;
}

/** Does monster m threaten village sid now (a hunt party may go for it)? */
export function threatens(g, m, sid) {
  const d = g.reg.get('monster', m.sp), ctr = centreOf(g, sid);
  if (!d || !ctr || Math.hypot(m.x - ctr.x, m.y - ctr.y) > THREAT) return false;
  return d.behaviour === 'tear' || (m.raids?.[sid] || 0) > g.s.tick;
}
/** Monsters threatening village sid, nearest its centre first (the planner arms fighters for them). */
export function monsterThreats(g, sid) {
  const ctr = centreOf(g, sid);
  return nearMonsters(g).filter((m) => threatens(g, m, sid)).sort((a, b) => Math.hypot(a.x - ctr.x, a.y - ctr.y) - Math.hypot(b.x - ctr.x, b.y - ctr.y) || byId(a.id, b.id));
}
// Timid people never join a hunt party (peoples.js; party 'never'); brave ones are first to (urgency below).
const armedFit = (g, c) => !!huntWeapon(g, c) && hpOf(c) > 50 && !c.health?.down && modsOf(g, c).party !== 'never';

/** Is monster o a danger to c now (as monsters.js attacks): a Thornback near its den or angry at them, a
 *  Gloomstalker at night, a Barkmaw always. */
function dangerTo(g, o, d, c, night) {
  if (o.angry?.cid === c.id && o.angry.until > g.s.tick) return true;
  if (d.behaviour === 'stalk') return night;
  if (d.behaviour === 'trample') { const l = homeOf(g, o); return !!l && Math.hypot(c.x - l.x, c.y - l.y) <= 10; } // its den, or its foray spot
  return true;
}

/** ai.js tickColonist: run from a monster close by that is a danger to this person (every 5 ticks, staggered). */
export function monsterDanger(g, c) {
  if (!c || c.health?.down || c.carriedBy || c.sleeping) return null;
  if ((g.s.tick + (Number(c.id.slice(1)) || 0)) % 5) return null;
  if (!nearMonsters(g).length) return null; // the usual case: no monster near any village
  const t = c.job?.type;
  if (t === 'flee' || t === 'slay' || t === 'fight' || t === 'arm' || t === 'firefight') return null;
  const cx = Math.round(c.x), cy = Math.round(c.y);
  if (roomAt(g, cx, cy)) return null; // safe indoors
  const hour = g.hour, night = hour >= 21 || hour < 5;
  let m = null, md = Infinity;
  for (const o of nearMonsters(g)) {
    const d = g.reg.get('monster', o.sp), dist = Math.hypot(o.x - c.x, o.y - c.y);
    if (dist > SEE || dist >= md || !dangerTo(g, o, d, c, night)) continue;
    m = o; md = dist;
  }
  if (!m) return null;
  if (c.job?.need && md > 3) return null; // eating or drinking goes on unless it is right there
  if (standing(g, g.owned('colonists', sidOf(g, c))) <= 3) return null; // monsters leave a village of 3 or fewer standing alone
  const join = partyJob(g, c, m); // armed and enough of them: join the hunt party instead of running
  if (join) return join;
  const d = g.reg.get('monster', m.sp), dx = c.x - m.x, dy = c.y - m.y, len = Math.hypot(dx, dy) || 1;
  let tx = Math.max(0, Math.min(g.W - 1, Math.round(c.x + (dx / len) * 12))), ty = Math.max(0, Math.min(g.H - 1, Math.round(c.y + (dy / len) * 12)));
  if (!g.isPassable(tx, ty)) { const h = centreOf(g, sidOf(g, c)); tx = h.x; ty = h.y; }
  return newJob('flee', { x: tx, y: ty, why: `${modsOf(g, c).party === 'never' && huntWeapon(g, c) ? 'Timid: running' : 'Running'} from the ${d.name}`, monster: m.id }, { why: modsOf(g, c).party === 'never' && huntWeapon(g, c) ? `Timid: running from the ${d.name}` : `A ${d.name} came close`, label: `Run from the ${d.name}` });
}

/** A free slot of monster m's hunt party for c (fightGroup + 1 slots), or -1. */
function freeSlot(g, c, m, d) {
  for (let k = 0; k <= d.fightGroup; k++) if (!g.isReserved(`slay:${m.id}:${k}`, c.id)) return k;
  return -1;
}
/** Can c's village field a hunt party against m (enough armed, fit adults)? */
const enoughArmed = (g, sid, d) => g.owned('colonists', sid).filter((p) => isAdult(g, p) && armedFit(g, p)).length >= d.fightGroup;
/** A slay job for c against m with a party slot reserved, or null (not armed, too few armed, no slot). */
function partyJob(g, c, m, wt = null) {
  const d = g.reg.get('monster', m.sp), sid = sidOf(g, c);
  if (!d || !isAdult(g, c) || !armedFit(g, c) || !enoughArmed(g, sid, d) || g.isBlocked(`slay:${sid}:${m.id}`)) return null;
  const k = freeSlot(g, c, m, d);
  if (k < 0) return null;
  const why = d.behaviour === 'tear' ? `A ${d.name} is tearing at the village` : `The ${d.name} attacked the village`;
  const job = newJob('slay', { m: m.id, gx: null, gy: null, cd: 0, started: g.s.tick }, { why, label: `Hunt the ${d.name}`, workType: wt?.id || 'core:hunt', targetKey: `slay:${sid}:${m.id}` });
  return g.reserveExcl(job, `slay:${m.id}:${k}`, c.id) ? job : null;
}

export const SLAY_GIVERS = {
  'core:slay_monster': {
    find(g, c, params, wt) {
      if (!g.s.monsters || !isAdult(g, c) || !armedFit(g, c)) return [];
      const sid = sidOf(g, c), out = [];
      for (const m of monsterThreats(g, sid)) {
        const d = g.reg.get('monster', m.sp);
        if (!enoughArmed(g, sid, d) || g.isBlocked(`slay:${sid}:${m.id}`) || freeSlot(g, c, m, d) < 0) continue;
        out.push({ x: m.x, y: m.y, urgency: modsOf(g, c).party === 'first' ? 1.9 : 1.6, label: `Hunt the ${d.name}`, far: { x: m.x, y: m.y }, make: () => partyJob(g, c, m, wt) });
      }
      return out;
    },
  },
  'core:clear_lair': {
    find(g, c, params, wt) {
      if (!g.s.monsters || !isAdult(g, c)) return [];
      const sid = sidOf(g, c), ctr = centreOf(g, sid), out = [];
      for (const l of Object.values(g.s.monsters.lairs).sort((a, b) => byId(a.id, b.id))) {
        if (l.monster || l.cleared || Math.hypot(l.x - ctr.x, l.y - ctr.y) > CLEAR_R || g.isReserved(`lair:${l.id}`, c.id) || g.isBlocked(`lair:${sid}:${l.id}`)) continue;
        const d = g.reg.get('monster', l.sp);
        out.push({ x: l.x, y: l.y, urgency: 0.5, label: `Clear the ${d?.name || 'monster'}'s lair`, far: { x: l.x, y: l.y }, make() {
          const job = newJob('clearlair', { lair: l.id, prog: 0 }, { why: 'So no monster comes back to it', label: `Clear the ${d?.name || 'monster'}'s lair`, workType: wt.id, targetKey: `lair:${sid}:${l.id}` });
          return g.reserveExcl(job, `lair:${l.id}`, c.id) ? job : null;
        } });
      }
      return out;
    },
  },
};

/** Monster m (species d) is slain by c: it leaves its carcass or drops where it fell (created:hunt, c's village). */
function slain(g, c, m, d) {
  const x = m.x, y = m.y, sid = sidOf(g, c);
  killMonster(g, m.id, 'slain');
  const prev = g.actor;
  g.actor = sid;
  try {
    if (d.carcass && g.reg.has('item', d.carcass)) g.createItems(d.carcass, 1, x, y, 'hunt');
    for (const e of d.drops || []) if (g.reg.has('item', e.item)) g.createItems(e.item, e.qty, x, y, 'hunt');
  } finally { g.actor = prev; }
  g.log(`${c.name} and the hunt party slew the ${d.name}!`, 'good', `slay:${m.id}`);
}

export const SLAY_DRIVERS = {
  slay: {
    valid(g, c, j) { return typeof j.m === 'string'; },
    tick(g, c, j) {
      const m = g.s.monsters?.list[j.m], d = m && g.reg.get('monster', m.sp);
      if (!m || !d) return 'done'; // slain (by the party) or gone
      if (g.s.tick - j.started > GIVE_UP) return { fail: `The ${d.name} got away`, cooldown: 1200 };
      const w = huntWeapon(g, c);
      if (!w) return { fail: 'No weapon to fight with' };
      if (hpOf(c) <= 40) return { fail: 'Too hurt to fight on', cooldown: 1200 };
      const dist = Math.hypot(m.x - c.x, m.y - c.y);
      const party = Object.values(g.s.colonists).filter((p) => p.job?.type === 'slay' && p.job.m === m.id && Math.hypot(m.x - p.x, m.y - p.y) <= PARTY).length;
      const need = j.engaged ? 2 : d.fightGroup; // once the party has closed in, it fights on while two remain
      if (party >= need) j.engaged = true;
      c.status.action = party >= need ? `Fighting the ${d.name}` : `Waiting for the hunt party (${party} of ${need})`;
      const range = w.eq.range || 1.5, want = party >= need ? range : HOLD;
      if (dist > want) {
        if (j.gx === null || Math.hypot(m.x - j.gx, m.y - j.gy) > 2) { j.gx = m.x; j.gy = m.y; c.path = null; }
        const r = travel(g, c, j, j.gx, j.gy, 'adj', `the ${d.name.toLowerCase()}`);
        if (r === true) { j.gx = null; return 'running'; }
        return r === false ? 'running' : r;
      }
      if (party < need || g.s.tick < j.cd) return 'running';
      j.cd = g.s.tick + (w.eq.cooldown || 45);
      if (w.eq.ammo) { c.ammo.qty--; g.consume(w.eq.ammo, 1, 'shot'); if (c.ammo.qty <= 0) c.ammo = null; }
      if (c.equip.weapon) c.equip.weapon.dur = Math.max(0, (c.equip.weapon.dur ?? w.eq.durability ?? 1000) - 1);
      practice(g, c, 'core:hunt', 'core:hunting');
      const p = Math.min(0.95, Math.max(0.05, (w.eq.accuracy ?? 0.7) * (1 - Math.max(0, dist - 1) / (range * 2.5))) + 0.02 * (c.skills?.['core:hunting'] || 0));
      if (g.rng.next() < p && woundMonster(g, m.id, w.eq.damage * (0.7 + 0.6 * g.rng.next()), c)) { slain(g, c, m, d); return 'done'; }
      return 'running';
    },
  },
  clearlair: {
    valid(g, c, j) { return typeof j.lair === 'string'; },
    tick(g, c, j) {
      const l = g.s.monsters?.lairs[j.lair];
      if (!l || l.monster || l.cleared) return 'done'; // a monster came back, or someone else cleared it
      if (Math.max(Math.abs(Math.round(c.x) - l.x), Math.abs(Math.round(c.y) - l.y)) > 1) {
        const r = travel(g, c, j, l.x, l.y, 'adj', 'the lair');
        return r === true || r === false ? 'running' : r;
      }
      c.status.action = 'Clearing a monster lair';
      if (++j.prog < CLEAR_WORK) return 'running';
      l.cleared = true;
      const d = g.reg.get('monster', l.sp);
      g.log(`${c.name} cleared the ${d?.name || 'monster'}'s lair: nothing will live there again.`, 'good', `lair:${l.id}`);
      return 'done';
    },
  },
};
