// Hunting (Phase 8, slice 3; docs/proposals/phase-8-animals.md). Work type core:hunt (skill core:hunting), giver
// core:hunt_animals, job `hunt`.
// - The giver offers a hunt to an armed adult (a melee weapon, or a ranged one with ammunition) when the village is
//   short of meat (meat and carcasses in stock below MEAT_PER_PERSON a person) and a near herd of a huntable
//   grazing species is within HUNT_REACH of the hunter and above the hunting limit (animals.js HUNT_LIMIT). One
//   hunter per herd (reserved).
// - The job follows the herd's nearest animal (a new walk goal when it has moved 2 tiles away), and when in weapon
//   range strikes or shoots at the weapon's cooldown: hit chance from the weapon's accuracy and the distance (as in
//   combat.js), plus 2% a hunting skill level; damage 0.7-1.3 of the weapon's; arrows and rounds are used up
//   (`consumed:shot`). A wounded animal's herd runs. A kill leaves its carcass where it fell (`created:hunt`, owned
//   by the hunter's village), to be hauled and butchered (planner.js wants its meat). The hunt gives up after
//   GIVE_UP ticks.
// Draws come from the game's random stream, like other colonist work.
import { travel, newJob, practice } from './ai/jobs.js';
import { huntableNear, herdAnimals, killAnimal, alarmHerd, meatOnHand, HUNT_LIMIT, MEAT_PER_PERSON } from './animals.js';

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
      const P = g.planOf(c), sid = c.settlementId || g.s.playerSettlement;
      const people = g.owned('colonists', sid).length;
      if (meatOnHand(g, P) >= MEAT_PER_PERSON * Math.max(2, people)) return [];
      const out = [];
      for (const { h, d, dist } of huntableNear(g, c.x, c.y, HUNT_REACH)) {
        if (g.isReserved(`hunt:${h.id}`, c.id) || g.isBlocked(`hunt:${sid}:${h.id}`)) continue;
        out.push({
          x: h.x, y: h.y, urgency: (P?.foodDays ?? 9) < 3 ? 1.2 : 0.6, label: `Hunt ${d.plural || d.name}`, far: dist > 30,
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

export const HUNT_DRIVERS = {
  hunt: {
    valid(g, c, j) { const h = g.s.animals?.herds[j.herd]; return !!h && h.near !== undefined && h.n > HUNT_LIMIT; },
    tick(g, c, j) {
      const h = g.s.animals?.herds[j.herd];
      if (!h || h.near === undefined || h.n <= HUNT_LIMIT) return 'done'; // gone, far, or at the limit: leave the rest
      if (g.s.tick - j.started > GIVE_UP) return { fail: 'The herd got away', cooldown: 600 };
      const w = huntWeapon(g, c);
      if (!w) return { fail: 'No weapon to hunt with' };
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
      if (w.eq.ammo) { c.ammo.qty--; g.consume(w.eq.ammo, 1, 'shot'); if (c.ammo.qty <= 0) c.ammo = null; }
      if (c.equip.weapon) c.equip.weapon.dur = (c.equip.weapon.dur ?? w.eq.durability ?? 1000) - 1;
      practice(g, c, 'core:hunt', 'core:hunting');
      const skill = c.skills?.['core:hunting'] || 0;
      const p = Math.min(0.95, Math.max(0.05, (w.eq.accuracy ?? 0.7) * (1 - Math.max(0, dist - 1) / (range * 2.5))) + 0.02 * skill);
      if (g.rng.next() >= p) { alarmHerd(g, h.id, c.x, c.y); return 'running'; } // missed: they run
      t.hp -= w.eq.damage * (0.7 + 0.6 * g.rng.next());
      if (t.hp > 0) { alarmHerd(g, h.id, c.x, c.y); return 'running'; }
      const x = t.x, y = t.y;
      killAnimal(g, t.id, c.x, c.y);
      const prev = g.actor;
      g.actor = c.settlementId || g.s.playerSettlement;
      try { g.createItems(d.carcass, 1, x, y, 'hunt'); } finally { g.actor = prev; }
      g.log(`${c.name} killed a ${d.name.toLowerCase()}.`, 'good', `hunt:${c.settlementId}`, 300);
      return 'done';
    },
  },
};
