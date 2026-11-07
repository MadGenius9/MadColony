// God power "animals" (Phase 8b, docs/proposals/phase-8b-animal-powers.md): the gods send deer, wolves or wild
// horses to a clicked tile, as a new herd (mode 'herd', count 2..herd max) or as animals joining the nearest herd
// of their species within JOIN_R tiles (mode 'join', count 1..herd max; refused with no herd near: a lone animal
// would not last, the owner's answer 4). Cost: the species' godCost a head (deer 2, horse 3, wolf 4). Wolves sent
// within WOLF_R tiles of a standing village are destructive: the preview names the villages and the power needs
// confirm. Sent animals live by the animal system's rules (animals.js) and are counted as `sent` in the animal
// ledger. No random draws here; positions of animals made near a village come from hashes (animals.js).
// Cost: once per command, O(herds in the chunks round the tile + villages).
import { registerPower } from './god.js';
import { animalSpecies, sendHerd, joinHerd, herdToJoin, landFor } from './animals.js';

const JOIN_R = 12, WOLF_R = 30;
const extraKey = (args, allowed) => Object.keys(args).find((k) => !allowed.includes(k));
const plural = (d, n) => (n === 1 ? d.name.toLowerCase() : (d.plural || d.name).toLowerCase());

/** Standing villages within WOLF_R tiles of (x, y), nearest first: [{ name, dist }]. */
function villagesNear(g, x, y) {
  const out = [];
  for (const [id, v] of Object.entries(g.s.settlements || {})) {
    if (!v.center || v.fallen) continue;
    const dist = Math.hypot(v.center.x - x, v.center.y - y);
    if (dist <= WOLF_R) out.push({ id, name: v.name || id, dist: Math.round(dist), mine: id === g.s.playerSettlement });
  }
  return out.sort((a, b) => a.dist - b.dist || (a.id < b.id ? -1 : 1));
}

const isPack = (g, a) => g.reg.get('animal', a.species)?.diet === 'hunt';

registerPower('animals', {
  destructive: (g, a) => !!a && typeof a.species === 'string' && isPack(g, a) && Number.isInteger(a.x) && Number.isInteger(a.y) && villagesNear(g, a.x, a.y).length > 0,
  validate(g, a) {
    const k = extraKey(a, ['x', 'y', 'species', 'count', 'mode', 'confirm']);
    if (k) return `animals takes only x, y, species, count, mode and confirm (not "${String(k).slice(0, 40)}")`;
    if (!Number.isInteger(a.x) || !Number.isInteger(a.y) || !g.inB(a.x, a.y)) return 'pick a tile on the map';
    if (!animalSpecies(g).length) return 'this world has no animals';
    if (typeof a.species !== 'string' || !animalSpecies(g).some((d) => d.id === a.species)) return 'there is no such animal in this world';
    if (!g.s.animals) return 'the wild has not settled yet (wait a moment)';
    const d = g.reg.get('animal', a.species), mode = a.mode ?? 'herd';
    if (mode !== 'herd' && mode !== 'join') return 'mode must be herd or join';
    const t = g.terrainAt(a.x, a.y);
    if (!t.passable || t.drinkable || !g.isPassable(a.x, a.y)) return 'animals need open dry land to stand on (not water, a wall or a building)';
    const lo = mode === 'herd' ? 2 : 1, hi = d.herd[1];
    if (!Number.isInteger(a.count) || a.count < lo || a.count > hi) return `send ${lo} to ${hi} ${plural(d, 2)}${mode === 'herd' ? ' (a herd needs at least 2)' : ''}`;
    if (mode === 'join' && !herdToJoin(g, a.species, a.x, a.y, JOIN_R)) return `no herd of ${plural(d, 2)} within ${JOIN_R} tiles to join`;
    return null;
  },
  cost: (g, a) => (g.reg.get('animal', a.species)?.godCost ?? 3) * a.count,
  preview(g, a) {
    const d = g.reg.get('animal', a.species), mode = a.mode ?? 'herd', warnings = [];
    const h = mode === 'join' ? herdToJoin(g, a.species, a.x, a.y, JOIN_R) : null, at = h ? { x: h.x, y: h.y } : { x: a.x, y: a.y }; // where they will be
    const L = landFor(g, a.species, at.x, at.y), terrain = g.terrainAt(at.x, at.y).name?.toLowerCase() || 'other ground';
    const effect = h ? `${a.count} ${plural(d, a.count)} join the herd of ${h.n} nearby (${h.n + a.count}).` : `${a.count} ${plural(d, a.count)} appear at (${a.x}, ${a.y}) as a new herd.`;
    const lives = `They live on ${L.terrains.map((t) => g.reg.get('terrain', t)?.name?.toLowerCase() || t).join(', ')}`;
    if (!L.chunkGround) warnings.push(`${lives}; there is none of it here: they will wander off to find it and some will die on the way.`);
    else if (!L.onGround) warnings.push(`${lives}; this is ${terrain}, but there is some of their ground nearby to graze.`);
    warnings.push(`The land here feeds about ${L.feeds} ${plural(d, 2)}; ${L.living} live here already${L.living + a.count > L.crowdedAt ? ': too many, some will die or move on' : ''}.`);
    if (isPack(g, a)) for (const v of villagesNear(g, a.x, a.y)) warnings.push(`Wolves will hunt near ${v.mine ? 'your village' : v.name} (${v.dist} tiles away) and may attack its people.`);
    return { x: a.x, y: a.y, species: a.species, count: a.count, mode, near: h ? h.near !== undefined : L.near, effect, warnings };
  },
  apply(g, cmd) {
    const a = cmd.args, d = g.reg.get('animal', a.species), mode = a.mode ?? 'herd';
    const v = villagesNear(g, a.x, a.y)[0], where = v ? ` near ${v.mine ? 'your village' : v.name}` : '';
    if (mode === 'join') {
      const h = joinHerd(g, herdToJoin(g, a.species, a.x, a.y, JOIN_R).id, a.count);
      return { msg: `The gods sent ${a.count} ${plural(d, a.count)}${where}; they joined a herd.`, herd: h.id };
    }
    const h = sendHerd(g, a.species, a.x, a.y, a.count);
    return { msg: `The gods sent ${a.count} ${plural(d, a.count)}${where}.`, herd: h.id };
  },
});

// Peaceful animals (the owner's answer 5): { on: true | false }. While on, packs never go for people (an angry
// pack calms down, distant villages are not raided) and people need not run from them; wolves still hunt deer and
// horses. Free, not destructive, saved as s.animals.peaceful and replayed like any command.
registerPower('peaceful', {
  validate(g, a) {
    const k = extraKey(a, ['on']);
    if (k) return `peaceful takes only on (not "${String(k).slice(0, 40)}")`;
    if (typeof a.on !== 'boolean') return 'on must be true or false';
    if (!animalSpecies(g).length) return 'this world has no animals';
    if (!g.s.animals) return 'the wild has not settled yet (wait a moment)';
    if (!!g.s.animals.peaceful === a.on) return a.on ? 'the animals are peaceful already' : 'the animals are wild already';
    return null;
  },
  cost: () => 0,
  preview: (g, a) => ({ on: a.on, effect: a.on ? 'Animals leave people alone: wolves still hunt deer and horses, but never people, and people need not run from them.' : 'Animals are wild again: hungry wolves may attack people.' }),
  apply(g, cmd) {
    if (cmd.args.on) g.s.animals.peaceful = true; else delete g.s.animals.peaceful;
    return { msg: cmd.args.on ? 'The gods calmed the wild: animals leave people alone.' : 'The wild is wild again: beware of wolves.' };
  },
});
