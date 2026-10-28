// World shaping (docs/proposals/world-shaping.md): the god power "shape" paints terrain with a brush.
// One command is one stroke: { brush, x, y, r } (a disc of radius r, 1..MAX_R) or { brush, points: [[x, y], ...], r }
// (a drag: up to MAX_POINTS discs). Brushes:
//   raise    deep water -> water -> shallows -> sand -> grass; other land -> hills; hills -> mountain
//   lower    mountain -> hills -> grass; land -> shallows; shallows -> water; water -> deep water
//   water    a lake: water inside, shallows at the edge
//   mountain mountains (impassable)
//   flatten  hills, gravel, marsh and sand -> grass; brush and rocks on it are cleared
//   desert, snow, marsh  paint the surface sand, snow or marsh (the owner's answer 1)
// Safety: tiles under buildings, building sites, fields and stockpiles, and tiles with someone on them, are left out
// (the preview counts them). A brush that makes ground impassable (mountain, water, lowering to shallows or water)
// also leaves out tiles within SAFE tiles of people, buildings, fields and stockpiles, so nobody is shut in (an
// exact trap check per tile is a later slice). Plants and rocks on ground that becomes water or mountain are
// destroyed (with seeds, as fire does); a crop there is lost.
// Cost: costs.shapeTile (default 0.2) favour a tile changed; free in Sandbox. Within NEAR_R tiles of a standing
// village the stroke is destructive (confirm, the villages named). Deterministic: no random draws; the stroke is
// applied row by row and preview reports exactly what apply changes.
import { registerPower } from './god.js';
import { destroyNode, destroyCrop } from './ruin.js';

const MAX_R = 8, MAX_POINTS = 16, SAFE = 3, NEAR_R = 40;
const BRUSHES = ['raise', 'lower', 'water', 'mountain', 'flatten', 'desert', 'snow', 'marsh'];
const WET = ['core:deep_water', 'core:water', 'core:shallows'];
const extraKey = (args, allowed) => Object.keys(args).find((k) => !allowed.includes(k));
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The terrain a brush makes of tile terrain t (an id) at distance dist of a disc of radius r; null: unchanged. */
function next(g, brush, t, dist, r) {
  const has = (id) => g.reg.has('terrain', id);
  switch (brush) {
    case 'raise':
      if (t === 'core:deep_water') return 'core:water';
      if (t === 'core:water') return has('core:shallows') ? 'core:shallows' : 'core:sand';
      if (t === 'core:shallows') return 'core:sand';
      if (t === 'core:sand') return 'core:grass';
      if (t === 'core:mountain') return null;
      if (t === 'core:hills') return has('core:mountain') ? 'core:mountain' : null;
      return has('core:hills') ? 'core:hills' : null;
    case 'lower':
      if (t === 'core:mountain') return 'core:hills';
      if (t === 'core:hills') return 'core:grass';
      if (t === 'core:shallows') return 'core:water';
      if (t === 'core:water') return has('core:deep_water') ? 'core:deep_water' : null;
      if (t === 'core:deep_water') return null;
      return has('core:shallows') ? 'core:shallows' : 'core:water';
    case 'water': return dist <= r - 1 ? 'core:water' : WET.includes(t) ? null : has('core:shallows') ? 'core:shallows' : 'core:water';
    case 'mountain': return has('core:mountain') ? 'core:mountain' : null;
    case 'flatten': return ['core:hills', 'core:gravel', 'core:marsh', 'core:sand'].includes(t) ? 'core:grass' : null;
    case 'desert': return WET.includes(t) || t === 'core:mountain' ? null : 'core:sand';
    case 'snow': return WET.includes(t) || t === 'core:mountain' ? null : has('core:snow') ? 'core:snow' : null;
    case 'marsh': return WET.includes(t) || t === 'core:mountain' ? null : has('core:marsh') ? 'core:marsh' : null;
    default: return null;
  }
}

/** The discs of a stroke, in order. */
const discs = (a) => (Array.isArray(a.points) ? a.points.map(([x, y]) => ({ x, y })) : [{ x: a.x, y: a.y }]);

/** What a stroke would do, tile by tile (row by row, each tile once): { changes: [{ i, from, to }], kept: { reason: n } }. */
function plan(g, a) {
  const r = a.r ?? 3, seen = new Set(), changes = [], kept = {};
  const keep = (why) => { kept[why] = (kept[why] || 0) + 1; };
  const people = Object.values(g.s.colonists).filter((c) => g.s.settlements?.[c.settlementId]?.detail !== 'abstract');
  const tiles = [];
  for (const d of discs(a)) for (let y = d.y - r; y <= d.y + r; y++) for (let x = d.x - r; x <= d.x + r; x++) {
    const dist = Math.hypot(x - d.x, y - d.y);
    if (!g.inB(x, y) || dist > r) continue;
    const i = g.i(x, y);
    if (seen.has(i)) continue;
    seen.add(i); tiles.push({ i, x, y, dist });
  }
  tiles.sort((p, q) => p.i - q.i);
  for (const t of tiles) {
    const from = g.terrainAt(t.x, t.y).id, to = next(g, a.brush, from, t.dist, r);
    if (!to || to === from) continue;
    if (g.structIdAt(t.i) || g.footIdAt(t.i)) { keep('buildings'); continue; }
    if (g.zoneAt(t.i)) { keep('fields and stockpiles'); continue; }
    if (people.some((c) => Math.round(c.x) === t.x && Math.round(c.y) === t.y)) { keep('people'); continue; }
    const blocks = !g.reg.get('terrain', to)?.passable || g.reg.get('terrain', to)?.drinkable;
    if (blocks && g.terrainAt(t.x, t.y).passable && !g.terrainAt(t.x, t.y).drinkable && nearSettled(g, t.x, t.y, people)) { keep('the way round villages'); continue; }
    changes.push({ i: t.i, from, to });
  }
  return { changes, kept };
}
/** Is (x, y) within SAFE tiles of a person, a building or site, a field or a stockpile? */
function nearSettled(g, x, y, people) {
  for (let yy = y - SAFE; yy <= y + SAFE; yy++) for (let xx = x - SAFE; xx <= x + SAFE; xx++) {
    if (!g.inB(xx, yy)) continue;
    const j = g.i(xx, yy);
    if (g.structIdAt(j) || g.footIdAt(j) || g.zoneAt(j)) return true;
  }
  return people.some((c) => Math.abs(c.x - x) <= SAFE && Math.abs(c.y - y) <= SAFE);
}
function villagesNear(g, a) {
  const out = [];
  for (const [id, v] of Object.entries(g.s.settlements || {})) {
    if (!v.center || v.fallen) continue;
    const dist = Math.min(...discs(a).map((d) => Math.hypot(v.center.x - d.x, v.center.y - d.y)));
    if (dist <= NEAR_R) out.push({ id, name: v.name || id, dist: Math.round(dist), mine: id === g.s.playerSettlement });
  }
  return out.sort((p, q) => p.dist - q.dist || byId(p.id, q.id));
}
const okArgs = (g, a) => !!a && BRUSHES.includes(a.brush) && (a.r === undefined || (Number.isInteger(a.r) && a.r >= 1 && a.r <= MAX_R))
  && (Array.isArray(a.points) ? a.points.length >= 1 && a.points.length <= MAX_POINTS && a.points.every((p) => Array.isArray(p) && p.length === 2 && Number.isInteger(p[0]) && Number.isInteger(p[1]) && g.inB(p[0], p[1]))
    : Number.isInteger(a.x) && Number.isInteger(a.y) && g.inB(a.x, a.y));

registerPower('shape', {
  destructive: (g, a) => okArgs(g, a) && villagesNear(g, a).length > 0,
  validate(g, a) {
    const k = extraKey(a, ['brush', 'x', 'y', 'r', 'points', 'confirm']);
    if (k) return `shape takes only brush, x, y, r, points and confirm (not "${String(k).slice(0, 40)}")`;
    if (!BRUSHES.includes(a.brush)) return `brush must be one of ${BRUSHES.join(', ')}`;
    if (a.r !== undefined && !(Number.isInteger(a.r) && a.r >= 1 && a.r <= MAX_R)) return `r must be a whole number from 1 to ${MAX_R}`;
    if (Array.isArray(a.points) ? !okArgs(g, a) : !(Number.isInteger(a.x) && Number.isInteger(a.y) && g.inB(a.x, a.y))) return `pick tiles on the map (a drag holds up to ${MAX_POINTS} points)`;
    if (!plan(g, a).changes.length) return 'nothing here would change with that brush';
    return null;
  },
  cost: (g, a, r) => Math.round(plan(g, a).changes.length * (r.costs.shapeTile ?? 0.2) * 10) / 10,
  preview(g, a) {
    const P = plan(g, a), warnings = [];
    for (const v of villagesNear(g, a)) warnings.push(`It reshapes land ${v.dist} tiles from ${v.mine ? 'your village' : v.name}.`);
    const lost = P.changes.filter((c) => { const to = g.reg.get('terrain', c.to); return (!to.passable || to.drinkable) && (g.nodeIdAt(c.i) || g.cropIdAt(c.i)); }).length;
    if (lost) warnings.push(`${lost} plants, rocks or crops on it are lost (plants leave seeds).`);
    const kept = Object.entries(P.kept).map(([why, n]) => `${n} tiles kept for ${why}`);
    return { brush: a.brush, tiles: P.changes.length, kept: P.kept, effect: `${P.changes.length} tiles change (${a.brush})${kept.length ? `; ${kept.join(', ')}` : ''}.`, warnings };
  },
  apply(g, cmd) {
    const P = plan(g, cmd.args), people = Object.values(g.s.colonists).sort((p, q) => byId(p.id, q.id));
    for (const c of P.changes) {
      const to = g.reg.get('terrain', c.to);
      if (!to.passable || to.drinkable) {
        const nid = g.nodeIdAt(c.i);
        if (nid) destroyNode(g, nid, people, null);
        const cr = g.cropIdAt(c.i);
        if (cr) destroyCrop(g, cr);
      }
      g.setTerrain(c.i, c.to);
    }
    return { msg: `The gods reshaped the land (${cmd.args.brush}, ${P.changes.length} tiles).`, tiles: P.changes.length };
  },
});
