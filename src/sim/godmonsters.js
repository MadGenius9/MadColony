// God powers "monster" and "banish" (Phase 8c, docs/proposals/phase-8c-wild-monsters.md; the owner's answer 6).
// - monster { x, y, species, confirm }: a monster of that species is sent to an open dry tile; it makes its lair
//   there (sendMonster, counted as sent in the monster ledger). Within NEAR_R tiles of a standing village it is
//   destructive: the preview names the villages and the power needs confirm. Cost: the species' godCost.
// - banish { x, y }: the monster nearest the tile within BANISH_R tiles is gone (killMonster 'banished'); its lair
//   stays (it may grow another unless cleared). Kind (no confirm). Cost: costs.banish (default 30).
// Validation and preview are read-only; no random draws.
import { registerPower } from './god.js';
import { monsterSpecies, sendMonster, killMonster } from './monsters.js';

const NEAR_R = 40, BANISH_R = 20;
const extraKey = (args, allowed) => Object.keys(args).find((k) => !allowed.includes(k));
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const tileOk = (g, a) => Number.isInteger(a.x) && Number.isInteger(a.y) && g.inB(a.x, a.y);

function villagesNear(g, x, y) {
  const out = [];
  for (const [id, v] of Object.entries(g.s.settlements || {})) {
    if (!v.center || v.fallen) continue;
    const dist = Math.hypot(v.center.x - x, v.center.y - y);
    if (dist <= NEAR_R) out.push({ id, name: v.name || id, dist: Math.round(dist), mine: id === g.s.playerSettlement });
  }
  return out.sort((a, b) => a.dist - b.dist || byId(a.id, b.id));
}
function nearestMonster(g, x, y) {
  let best = null, bd = Infinity;
  for (const m of Object.values(g.s.monsters?.list || {})) { const d = Math.hypot(m.x - x, m.y - y); if (d <= BANISH_R && (d < bd || (d === bd && m.id < best.id))) { bd = d; best = m; } }
  return best;
}

registerPower('monster', {
  destructive: (g, a) => !!a && tileOk(g, a) && villagesNear(g, a.x, a.y).length > 0,
  validate(g, a) {
    const k = extraKey(a, ['x', 'y', 'species', 'confirm']);
    if (k) return `monster takes only x, y, species and confirm (not "${String(k).slice(0, 40)}")`;
    if (!tileOk(g, a)) return 'pick a tile on the map';
    if (typeof a.species !== 'string' || !monsterSpecies(g).some((d) => d.id === a.species)) return 'there is no such monster in this world';
    const t = g.terrainAt(a.x, a.y);
    if (!t.passable || t.drinkable || !g.isPassable(a.x, a.y)) return 'a monster needs open dry land to stand on (not water, a wall or a building)';
    return null;
  },
  cost: (g, a) => g.reg.get('monster', a.species)?.godCost ?? 50,
  preview(g, a) {
    const d = g.reg.get('monster', a.species), warnings = [];
    for (const v of villagesNear(g, a.x, a.y)) warnings.push(`The ${d.name} will make its lair ${v.dist} tiles from ${v.mine ? 'your village' : v.name} and may attack it (${d.about || ''})`.trim());
    if (!d.terrains.includes(g.terrainAt(a.x, a.y).id)) warnings.push(`It lives on ${d.terrains.map((t) => g.reg.get('terrain', t)?.name?.toLowerCase() || t).join(', ')}: here it keeps to its lair.`);
    return { x: a.x, y: a.y, species: a.species, effect: `A ${d.name} appears at (${a.x}, ${a.y}) and makes its lair there.`, warnings };
  },
  apply(g, cmd) {
    const a = cmd.args, d = g.reg.get('monster', a.species), m = sendMonster(g, a.species, a.x, a.y), v = villagesNear(g, a.x, a.y)[0];
    return { msg: `The gods sent a ${d.name}${v ? ` near ${v.mine ? 'your village' : v.name}` : ''}.`, monster: m.id };
  },
});

registerPower('banish', {
  validate(g, a) {
    const k = extraKey(a, ['x', 'y']);
    if (k) return `banish takes only x and y (not "${String(k).slice(0, 40)}")`;
    if (!tileOk(g, a)) return 'pick a tile on the map';
    if (!nearestMonster(g, a.x, a.y)) return `no monster within ${BANISH_R} tiles`;
    return null;
  },
  cost: (g, a, r) => r.costs.banish ?? 30,
  preview(g, a) {
    const m = nearestMonster(g, a.x, a.y), d = g.reg.get('monster', m.sp);
    return { x: a.x, y: a.y, monster: m.id, effect: `The ${d.name} at (${m.x}, ${m.y}) is banished. Its lair stays: another may come to it unless it is cleared.` };
  },
  apply(g, cmd) {
    const m = nearestMonster(g, cmd.args.x, cmd.args.y), d = g.reg.get('monster', m.sp);
    killMonster(g, m.id, 'banished');
    return { msg: `The gods banished the ${d.name}.`, monster: m.id };
  },
});
