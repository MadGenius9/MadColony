// Hunting (Phase 8, slice 3; docs/proposals/phase-8-animals.md). Work type core:hunt (skill core:hunting), giver
// core:hunt_animals, job `hunt`.
// - The giver offers a hunt to an armed adult (a melee weapon, or a ranged one with ammunition) when the village is
//   short of meat (meat and carcasses in stock below MEAT_PER_PERSON a person) and a near herd of a huntable
//   grazing species is within HUNT_REACH of the village centre and above the hunting limit (animals.js HUNT_LIMIT). One
//   hunter per herd (reserved).
// - The job follows the herd's nearest animal (a new walk goal when it has moved 2 tiles away), and when in weapon
//   range strikes or shoots at the weapon's cooldown: hit chance from the weapon's accuracy and the distance (as in
//   combat.js), plus 2% a hunting skill level; damage 0.7-1.3 of the weapon's; arrows and rounds are used up
//   (`consumed:shot`). A wounded animal's herd runs. A kill leaves its carcass where it fell (`created:hunt`, owned
//   by the hunter's village), to be hauled and butchered (planner.js wants its meat). The hunt gives up after
//   GIVE_UP ticks.
// Draws come from the game's random stream, like other colonist work.
import { travel, newJob, practice } from './ai/jobs.js';
import { huntableNear, herdAnimals, killAnimal, alarmHerd, meatOnHand, woundAnimal, wolfNear, packThreat, nearHerdIds, HUNT_LIMIT, MEAT_PER_PERSON } from './animals.js';
import { roomAt } from './heat.js';
import { hpOf } from './health.js';

export const HUNT_REACH = 60, GIVE_UP = 1500;

/** The weapon c can hunt with: { item, eq, ranged } or null. */
export function huntWeapon(g, c) {
  const w = c.equip?.weapon, eq = w && g.reg.get('item', w.item)?.equipment;
  if (!eq?.damage) return null;
  if (eq.ammo && !(c.ammo?.item === eq.ammo && c.ammo.qty > 0)) return null;
  return { item: w.item, eq, ranged: (eq.range || 1.5) > 2 };
}

export const HUNT_GIVERS = {
  'core:hunt_animals': {
    find(g, c, params, wt) {
      if (!g.s.animals?.list || !huntWeapon(g, c)) return [];
      const P = g.planOf(c), sid = c.settlementId || g.s.playerSettlement, ctr = g.s.settlements?.[sid]?.center || g.s.center;
      const people = g.owned('colonists', sid).length;
      const out = [];
      // A pack that attacked the village's people is hunted down whatever the meat (slice 4).
      for (const hid of nearHerdIds(g)) { // near herds only
        const h = g.s.animals.herds[hid];
        if (!h || !(h.raids?.[sid] > g.s.tick) || g.isReserved(`hunt:${h.id}`, c.id) || g.isBlocked(`hunt:${sid}:${h.id}`)) continue;
        const d = g.reg.get('animal', h.sp);
        if (!d || Math.hypot(h.x - ctr.x, h.y - ctr.y) > HUNT_REACH) continue;
        out.push({ x: h.x, y: h.y, urgency: 1.5, label: `Hunt down the ${d.plural || d.name}`, make() {
          const job = newJob('hunt', { herd: h.id, target: null, gx: null, gy: null, cd: 0, started: g.s.tick }, { why: `${d.plural || d.name} attacked the village`, label: `Hunt down the ${d.plural || d.name}`, workType: wt.id, targetKey: `hunt:${sid}:${h.id}` });
          return g.reserveExcl(job, `hunt:${h.id}`, c.id) ? job : null;
        } });
      }
      const meat = meatOnHand(g, P);
      if (meat >= MEAT_PER_PERSON * Math.max(2, people)) return out;
      for (const { h, d, dist } of huntableNear(g, ctr.x, ctr.y, HUNT_REACH)) { // within reach of home (carcasses are hauled there)
        if (g.isReserved(`hunt:${h.id}`, c.id) || g.isBlocked(`hunt:${sid}:${h.id}`)) continue;
        out.push({
          x: h.x, y: h.y, urgency: (P?.foodDays ?? 9) < 3 ? 1.6 : meat === 0 ? 1.2 : 0.8, label: `Hunt ${d.plural || d.name}`, far: { x: h.x, y: h.y }, // the trip's far end (trips.js budgets it on big worlds)
          make() {
            const job = newJob('hunt', { herd: h.id, target: null, gx: null, gy: null, cd: 0, started: g.s.tick }, { why: 'The village needs meat', label: `Hunt ${d.plural || d.name}`, workType: wt.id, targetKey: `hunt:${sid}:${h.id}` });
            if (!g.reserveExcl(job, `hunt:${h.id}`, c.id)) return null;
            return job;
          },
        });
      }
      return out;
    },
  },
};

/** ai.js tickColonist (while near animals exist): a wolf within WOLF_SEE tiles: an armed, fit person fends it off,
 *  anyone else runs (home, away from it). Checked every 5 ticks (staggered). */
const WOLF_SEE = 7;
export function wolfDanger(g, c) {
  if (!c || c.health?.down || c.carriedBy || c.sleeping) return null;
  const t = c.job?.type;
  if (t === 'flee' || t === 'fend' || t === 'fight' || t === 'arm' || t === 'hunt' || t === 'firefight') return null;
  if ((g.s.tick + (Number(c.id.slice(1)) || 0)) % 5) return null; // staggered by the id's number
  if (roomAt(g, Math.round(c.x), Math.round(c.y))) return null; // safe indoors
  const w = wolfNear(g, c.x, c.y, WOLF_SEE);
  if (!w || !packThreat(g, w) || g.regionOf(w.x, w.y) !== g.regionOf(Math.round(c.x), Math.round(c.y))) return null; // a fed pack, or across water: no danger
  if (c.job?.need && Math.hypot(w.x - c.x, w.y - c.y) > 3) return null; // eating or drinking goes on unless it is right there
  if (huntWeapon(g, c) && hpOf(c) > 40 && !g.isBlocked(`fend:${c.id}`)) return newJob('fend', { wolf: w.id, gx: null, gy: null, cd: 0, started: g.s.tick }, { why: 'A wolf came close', label: 'Fend off the wolf', targetKey: `fend:${c.id}` });
  const dx = c.x - w.x, dy = c.y - w.y, len = Math.hypot(dx, dy) || 1;
  let tx = Math.round(c.x + (dx / len) * 10), ty = Math.round(c.y + (dy / len) * 10);
  tx = Math.max(0, Math.min(g.W - 1, tx)); ty = Math.max(0, Math.min(g.H - 1, ty));
  if (!g.isPassable(tx, ty)) { const h = g.s.settlements?.[c.settlementId]?.center || g.s.center; tx = h.x; ty = h.y; }
  return newJob('flee', { x: tx, y: ty, why: 'Running from wolves', wolf: true }, { why: 'Wolves nearby', label: 'Run from the wolves' });
}

/** Strike or shoot at animal t (hunt and fend): true when it died (the caller handles the kill). */
function strike(g, c, w, t, dist) {
  const range = w.eq.range || 1.5;
  if (w.eq.ammo) { c.ammo.qty--; g.consume(w.eq.ammo, 1, 'shot'); if (c.ammo.qty <= 0) c.ammo = null; }
  if (c.equip.weapon) c.equip.weapon.dur = Math.max(0, (c.equip.weapon.dur ?? w.eq.durability ?? 1000) - 1);
  practice(g, c, 'core:hunt', 'core:hunting');
  const skill = c.skills?.['core:hunting'] || 0;
  const p = Math.min(0.95, Math.max(0.05, (w.eq.accuracy ?? 0.7) * (1 - Math.max(0, dist - 1) / (range * 2.5))) + 0.02 * skill);
  if (g.rng.next() >= p) return false;
  return woundAnimal(g, t.id, w.eq.damage * (0.7 + 0.6 * g.rng.next()), c);
}

/** A kill by c: the animal leaves its herd; its carcass is left where it fell (created:hunt, c's village). */
function leaveCarcass(g, c, t, d) {
  const x = t.x, y = t.y;
  killAnimal(g, t.id, c.x, c.y);
  if (!d.carcass || !g.reg.has('item', d.carcass)) return;
  const prev = g.actor;
  g.actor = c.settlementId || g.s.playerSettlement;
  try { g.createItems(d.carcass, 1, x, y, 'hunt'); } finally { g.actor = prev; }
  g.log(`${c.name} killed a ${d.name.toLowerCase()}.`, 'good', `hunt:${c.settlementId}:${d.id}`, 300);
}

export const HUNT_DRIVERS = {
  fend: {
    valid(g, c, j) { return typeof j.wolf === 'string'; },
    tick(g, c, j) {
      const t = g.s.animals?.list?.[j.wolf], h = t && g.s.animals.herds[t.herd], d = h && g.reg.get('animal', h.sp);
      if (!t || !d) return 'done'; // dead or gone
      const w = huntWeapon(g, c);
      if (!w || hpOf(c) <= 30) return { fail: 'Too hurt to fight on' };
      const dist = Math.hypot(t.x - c.x, t.y - c.y);
      if (dist > 12 || g.s.tick - j.started > 600) return 'done'; // it ran off
      c.status.action = 'Fending off a wolf';
      if (dist > (w.eq.range || 1.5)) {
        if (j.gx === null || Math.hypot(t.x - j.gx, t.y - j.gy) > 1) { j.gx = t.x; j.gy = t.y; c.path = null; }
        const r = travel(g, c, j, j.gx, j.gy, 'adj', 'the wolf');
        if (r === true) { j.gx = null; return 'running'; }
        return r === false ? 'running' : r;
      }
      if (c.mv) { c.mv.t++; if (c.mv.t < c.mv.dur) return 'running'; c.mv = null; }
      if (g.s.tick < j.cd) return 'running';
      j.cd = g.s.tick + (w.eq.cooldown || 45);
      if (strike(g, c, w, t, dist)) { leaveCarcass(g, c, t, d); return 'done'; }
      return 'running';
    },
  },

  hunt: {
    valid(g, c, j) { return typeof j.herd === 'string'; }, // the herd's state is checked each tick (it may change at any time)
    tick(g, c, j) {
      const h = g.s.animals?.herds[j.herd];
      const hd = h && g.reg.get('animal', h.sp), limit = hd?.diet === 'hunt' ? 0 : HUNT_LIMIT; // a dangerous pack is hunted down
      if (!h || h.near === undefined || h.n <= limit) return 'done'; // gone, far, or at the limit: leave the rest
      if (g.s.tick - j.started > GIVE_UP) return { fail: 'The herd got away', cooldown: 600 };
      const w = huntWeapon(g, c);
      if (!w) return { fail: 'No weapon to hunt with' };
      if (hpOf(c) <= 30) return { fail: 'Too hurt to hunt on', cooldown: 1200 };
      const d = g.reg.get('animal', h.sp);
      let t = j.target && g.s.animals.list?.[j.target];
      if (!t) {
        const live = herdAnimals(g, h.id);
        t = live.sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y) || (a.id < b.id ? -1 : 1))[0];
        if (!t) return 'done';
        j.target = t.id;
      }
      const range = w.eq.range || 1.5, dist = Math.hypot(t.x - c.x, t.y - c.y);
      c.status.action = `Hunting ${d.name.toLowerCase()}`;
      if (dist > range) {
        if (j.gx === null || Math.hypot(t.x - j.gx, t.y - j.gy) > 2) { j.gx = t.x; j.gy = t.y; c.path = null; }
        const r = travel(g, c, j, j.gx, j.gy, 'adj', d.name.toLowerCase());
        if (r === true) { j.gx = null; return 'running'; }
        return r === false ? 'running' : r;
      }
      if (c.mv) { c.mv.t++; if (c.mv.t < c.mv.dur) return 'running'; c.mv = null; }
      if (g.s.tick < j.cd) return 'running';
      j.cd = g.s.tick + (w.eq.cooldown || 45);
      if (!strike(g, c, w, t, dist)) { alarmHerd(g, h.id, c.x, c.y); return 'running'; } // missed or wounded: they run
      leaveCarcass(g, c, t, d);
      return 'done';
    },
  },
};
