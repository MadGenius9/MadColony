// Destructive god powers (Phase 5b). Every one is destructive (god.js: refused until confirmed, warnings first),
// deterministic (draws are hashes of the seed and the command id) and conserved (ruin.js; deaths through death.js).
// - lightning { x, y }: whoever stands on the tile dies ("was struck by lightning"); people on the tiles round it
//   are burned (wrath.lightning.wound severity); if anything there can burn, a fire starts (fire.js).
// - fire { x, y }: the tile and the burnable tiles round it catch fire (fire.js spreads it).
// - smite { colonistId }: that person dies at once ("was smitten by the gods").
// - meteor { x, y }: a crater of wrath.meteor.radius: everything in it is destroyed (whole buildings, not rebuilt
//   there: crater ground cannot be built on), people in it die ("was crushed by a falling star"); in the ring round
//   it (wrath.meteor.ring) people are wounded and burnable tiles may catch fire; buildable land in the crater that
//   walks and is claimed like a crater (move cost and claim cost 1: grass, soil, savanna, ...) becomes core:crater
//   without a whole-map rebuild (Game.setTerrainKeepRev); other ground (forest floor, sand, hills) is cleared but
//   keeps its terrain; a stack of meteoric iron is left (created, reason 'divine').
// - quake { x, y }: each built part within wrath.quake.radius may collapse (more likely near the centre, and for
//   wooden parts than stone: wrath.quake.sturdy); a collapsed part's goods fall to the ground and the village
//   rebuilds it; people on or beside a collapsing part are wounded.
// - tornado { x, y, dir? }: a storm that moves from the tile for a few hours (storm.js); dir 0..7 (east, then
//   clockwise) or by a draw. The preview shows its exact path.
// - rain { x, y } (not destructive) and drought { x, y }: a weather area for some days (weather.js).
// - plague { settlementId }: wrath.plague.share of the village's people (at least one) fall ill with the plague
//   illness (illness.js: it spreads like any illness, also where the scenario has none).
import { registerPower } from './god.js';
import { injure } from './health.js';
import { ignite, tileFlammable, buildingFlammable, fireRules } from './fire.js';
import { destroyStructures, destroyProject, destroyNode, destroyStack, destroyCrop, replan } from './ruin.js';
import { claimRules } from './territory.js';
import { stormRules, stormPath, startStorm, stormCount, stormDraw } from './storm.js';
import { weatherRules, startWeather, weatherCount, weatherAt } from './weather.js';
import { infect, susceptible } from './illness.js';
export { buildingFlammable };

const DEFAULTS = {
  lightning: { wound: [20, 45] },
  plague: { share: 0.3, illness: 'core:plague' },
  meteor: { radius: 2, ring: 3, wound: [15, 50], fire: 0.35, iron: [4, 10], item: 'core:iron' },
  quake: { radius: 12, collapse: 0.6, sturdy: 0.35, wound: [10, 35] },
};
const rulesOf = (r) => {
  const w = r.wrath || {}, out = {};
  for (const k of Object.keys(DEFAULTS)) out[k] = { ...DEFAULTS[k], ...(w[k] || {}) };
  return out;
};
const between = ([lo, hi], u) => lo + (hi - lo) * u;
const hash = (str) => {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};
const draw = (key) => hash(key) / 4294967296;
const keyOf = (g, cmd) => `${g.s.seed}:god:${cmd ? cmd.id : (g.s.god?.nextId ?? 1)}`;
const extraKey = (a, allowed) => Object.keys(a).find((k) => !allowed.includes(k));
const villageName = (g, sid) => g.s.settlements?.[sid]?.name || 'no village';
const at = (c) => [Math.round(c.x), Math.round(c.y)];
const mine = (g, sid) => (sid || g.s.playerSettlement) === g.s.playerSettlement;

/** People on a tile and on the tiles round it (radius r), sorted by id. */
function peopleNear(g, x, y, r) {
  const on = [], near = [];
  for (const c of Object.values(g.s.colonists).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const [cx, cy] = at(c);
    const d = Math.max(Math.abs(cx - x), Math.abs(cy - y));
    if (d === 0) on.push(c); else if (d <= r) near.push(c);
  }
  return { on, near };
}

/** Warnings about people: the player's own first, then by village. */
function peopleWarnings(g, list, what) {
  const out = [];
  const by = new Map();
  for (const c of list) { const k = c.settlementId || g.s.playerSettlement; if (!by.has(k)) by.set(k, []); by.get(k).push(c.name); }
  const keys = [...by.keys()].sort((a, b) => (mine(g, b) - mine(g, a)) || (a < b ? -1 : 1));
  for (const k of keys) out.push(`${what}: ${by.get(k).join(', ')} (${mine(g, k) ? 'your village' : villageName(g, k)}).`);
  return out;
}

// ---------------- lightning ----------------
registerPower('lightning', {
  destructive: true,
  validate(g, a) {
    const k = extraKey(a, ['x', 'y', 'confirm']);
    if (k) return `lightning takes only x, y and confirm (not "${String(k).slice(0, 40)}")`;
    if (!Number.isInteger(a.x) || !Number.isInteger(a.y)) return 'pick a tile (whole x and y)';
    if (!g.inB(a.x, a.y)) return 'that spot is outside the map';
    return null;
  },
  cost: (g, a, r) => r.costs.lightning ?? 15,
  preview(g, a) {
    const { on, near } = peopleNear(g, a.x, a.y, 1), warnings = [];
    warnings.push(...peopleWarnings(g, on, 'Killed'), ...peopleWarnings(g, near, 'Burned'));
    const burns = tileFlammable(g, g.i(a.x, a.y)).f > 0;
    if (burns) warnings.push(...fireWarnings(g, a.x, a.y));
    return { x: a.x, y: a.y, killed: on.length, burned: near.length, fire: burns, warnings, effect: `Lightning strikes (${a.x}, ${a.y})${on.length ? `, killing ${on.length}` : ''}${near.length ? `, burning ${near.length}` : ''}${burns ? ', and a fire starts' : ''}.` };
  },
  apply(g, cmd, r) {
    const a = cmd.args, L = rulesOf(r).lightning, { on, near } = peopleNear(g, a.x, a.y, 1), key = keyOf(g, cmd);
    for (const c of on) if (!g._dying?.has(c.id)) (g._dying ||= new Map()).set(c.id, 'lightning');
    for (const c of near) injure(g, c, 'burn', L.wound[0] + (L.wound[1] - L.wound[0]) * draw(`${key}:${c.id}`), 'Burned by lightning', false, mine(g, c.settlementId) ? 'warn' : 'info');
    const fire = ignite(g, g.i(a.x, a.y));
    return { msg: `Lightning struck (${a.x}, ${a.y})${on.length ? `: ${on.map((c) => c.name).join(', ')} killed` : ''}${near.length ? `${on.length ? ',' : ':'} ${near.length} burned` : ''}${fire ? '; a fire broke out' : ''}.`, x: a.x, y: a.y, killed: on.length, burned: near.length, fire };
  },
});

// ---------------- fire ----------------
/** What a fire at (x, y) puts at risk within FIRE_RISK tiles: people and flammable buildings, by village. */
const FIRE_RISK = 6;
function fireWarnings(g, x, y) {
  const out = [], people = [];
  for (const c of Object.values(g.s.colonists).sort((p, q) => (p.id < q.id ? -1 : 1))) if (Math.max(Math.abs(Math.round(c.x) - x), Math.abs(Math.round(c.y) - y)) <= FIRE_RISK) people.push(c);
  out.push(...peopleWarnings(g, people, 'In danger'));
  const by = new Map();
  for (let yy = y - FIRE_RISK; yy <= y + FIRE_RISK; yy++) for (let xx = x - FIRE_RISK; xx <= x + FIRE_RISK; xx++) {
    if (!g.inB(xx, yy)) continue;
    const st = g.structAt(xx, yy);
    if (!st || !st.built || buildingFlammable(g, g.bDef(st)) <= 0) continue;
    const k = st.settlement || g.s.playerSettlement;
    by.set(k, (by.get(k) || 0) + 1);
  }
  for (const k of [...by.keys()].sort((a, b) => (mine(g, b) - mine(g, a)) || (a < b ? -1 : 1))) out.push(`${by.get(k)} flammable building part${by.get(k) === 1 ? '' : 's'} of ${mine(g, k) ? 'your village' : villageName(g, k)} close by.`);
  out.push('The fire may spread through trees, brush, crops and wooden buildings until rain or bare ground stops it.');
  return out;
}

registerPower('fire', {
  destructive: true,
  validate(g, a) {
    const k = extraKey(a, ['x', 'y', 'confirm']);
    if (k) return `fire takes only x, y and confirm (not "${String(k).slice(0, 40)}")`;
    if (!Number.isInteger(a.x) || !Number.isInteger(a.y)) return 'pick a tile (whole x and y)';
    if (!g.inB(a.x, a.y)) return 'that spot is outside the map';
    if (tileFlammable(g, g.i(a.x, a.y)).f <= 0) return 'nothing there can burn';
    if (weatherAt(g, a.x, a.y) === 'rain') return 'it is raining there; nothing will catch';
    return null;
  },
  cost: (g, a, r) => r.costs.fire ?? 25,
  preview: (g, a) => ({ x: a.x, y: a.y, warnings: fireWarnings(g, a.x, a.y), effect: `A fire starts at (${a.x}, ${a.y}).` }),
  apply(g, cmd) {
    const { x, y } = cmd.args;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (g.inB(x + dx, y + dy) && ignite(g, g.i(x + dx, y + dy))) n++;
    return { msg: `A fire broke out at (${x}, ${y}).`, x, y, tiles: n };
  },
});

// ---------------- meteor ----------------
const CRATER = 'core:crater';
const tileArgs = (name) => (g, a) => {
  const k = extraKey(a, ['x', 'y', 'confirm']);
  if (k) return `${name} takes only x, y and confirm (not "${String(k).slice(0, 40)}")`;
  if (!Number.isInteger(a.x) || !Number.isInteger(a.y)) return 'pick a tile (whole x and y)';
  if (!g.inB(a.x, a.y)) return 'that spot is outside the map';
  return null;
};

/** Counts by village as warnings: "<n> <what>s of your village" (the player's first). */
function byVillage(g, counts, what) {
  return [...counts.keys()].sort((a, b) => (mine(g, b) - mine(g, a)) || (a < b ? -1 : 1))
    .map((k) => `${counts.get(k)} ${what}${counts.get(k) === 1 ? '' : 's'} of ${mine(g, k) ? 'your village' : villageName(g, k)}`);
}

/** What a meteor at (x, y) hits: crater tiles, the ring, and what stands in the crater. O(area + colonists). */
function meteorArea(g, x, y, M) {
  const R = M.radius, out = R + M.ring, s = g.s;
  const crater = [], ring = [], structs = new Set(), projects = new Set();
  for (let yy = y - out; yy <= y + out; yy++) for (let xx = x - out; xx <= x + out; xx++) {
    if (!g.inB(xx, yy)) continue;
    const d2 = (xx - x) ** 2 + (yy - y) ** 2;
    const i = g.i(xx, yy);
    if (d2 <= R * R + R) {
      crater.push(i);
      const sid = g.structIdAt(i), f = g.footIdAt(i);
      if (sid) { structs.add(sid); if (s.structures[sid].projectId && s.projects[s.structures[sid].projectId]) projects.add(s.structures[sid].projectId); }
      if (f && s.projects[f] && s.projects[f].status !== 'cancelled') projects.add(f);
    } else if (d2 <= out * out + out) ring.push(i);
  }
  const inCrater = new Set(crater), inRing = new Set(ring), killed = [], wounded = [];
  for (const c of Object.values(s.colonists).sort((p, q) => (p.id < q.id ? -1 : 1))) {
    const [cx, cy] = at(c);
    if (!g.inB(cx, cy)) continue;
    const i = g.i(cx, cy);
    if (inCrater.has(i)) killed.push(c); else if (inRing.has(i)) wounded.push(c);
  }
  // Parts lost: every part of a building hit, and loose structures (no building) in the crater.
  const lost = new Set();
  for (const pid of projects) for (const id of s.projects[pid].parts) if (s.structures[id]) lost.add(id);
  for (const id of structs) lost.add(id);
  return { crater, ring, structs, projects: [...projects].sort(), lost, killed, wounded };
}

registerPower('meteor', {
  destructive: true,
  validate: tileArgs('meteor'),
  cost: (g, a, r) => r.costs.meteor ?? 60,
  preview(g, a, r) {
    const M = rulesOf(r).meteor, A = meteorArea(g, a.x, a.y, M), warnings = [];
    warnings.push(...peopleWarnings(g, A.killed, 'Killed'), ...peopleWarnings(g, A.wounded, 'Wounded'));
    const by = new Map();
    for (const id of A.lost) { const k = g.s.structures[id].settlement || g.s.playerSettlement; by.set(k, (by.get(k) || 0) + 1); }
    for (const w of byVillage(g, by, 'building part')) warnings.push(`${w} destroyed (whole buildings, not rebuilt in the crater).`);
    let crops = 0, nodes = 0, goods = 0;
    for (const i of A.crater) { if (g.cropIdAt(i)) crops++; if (g.nodeIdAt(i)) nodes++; const st = g.stackIdAt(i); if (st) goods += g.s.stacks[st].qty; }
    if (crops || nodes || goods) warnings.push(`Also destroyed: ${[crops && `${crops} crop${crops === 1 ? '' : 's'}`, nodes && `${nodes} tree${nodes === 1 ? '' : 's'} or rock${nodes === 1 ? '' : 's'}`, goods && `${goods} goods on the ground`].filter(Boolean).join(', ')}.`);
    warnings.push(`The ground becomes a crater (${A.crater.length} tiles) where nothing can be built; fires may start round it.`);
    return { x: a.x, y: a.y, killed: A.killed.length, wounded: A.wounded.length, parts: A.lost.size, tiles: A.crater.length, warnings, effect: `A falling star strikes (${a.x}, ${a.y}).` };
  },
  apply(g, cmd, r) {
    const a = cmd.args, M = rulesOf(r).meteor, key = keyOf(g, cmd), s = g.s, A = meteorArea(g, a.x, a.y, M);
    for (const c of A.killed) if (!g._dying?.has(c.id)) (g._dying ||= new Map()).set(c.id, 'meteor');
    for (const c of A.wounded) injure(g, c, 'wound', between(M.wound, draw(`${key}:w:${c.id}`)), 'Hit by the falling star', false, mine(g, c.settlementId) ? 'warn' : 'info');
    const owners = new Set();
    for (const id of A.lost) owners.add(s.structures[id].settlement || s.playerSettlement);
    // Goods on the ground first, so the goods that fall out of the buildings' parts outside the crater stay.
    let goods = 0;
    for (const i of A.crater) {
      const n = g.nodeIdAt(i); if (n) destroyNode(g, n);
      const cr = g.cropIdAt(i); if (cr) destroyCrop(g, cr);
      const st = g.stackIdAt(i); if (st) goods += destroyStack(g, st, 'divine');
    }
    const opts = { reason: 'divine', why: 'A falling star destroyed it' };
    for (const pid of A.projects) destroyProject(g, pid, opts, A.structs);
    destroyStructures(g, [...A.structs].filter((id) => s.structures[id]), { ...opts, repair: false, replan: false });
    let tiles = 0;
    const ct = g.reg.get('terrain', CRATER), CR = claimRules(g), claimCost = (id) => CR?.costs?.[id] ?? CR?.defaultCost ?? 1;
    const same = (t) => t.passable === ct.passable && !!t.drinkable === !!ct.drinkable && (t.moveCost || 1) === (ct.moveCost || 1)
      && claimCost(t.id) === claimCost(CRATER) && !CR?.stops?.includes(t.id) && !CR?.stops?.includes(CRATER);
    if (ct) for (const i of A.crater) { const t = g.terrainDefOf(g.terrainIdx(i)); if (t.buildable && t.id !== CRATER && same(t)) { g.setTerrainKeepRev(i, CRATER); tiles++; } }
    let fires = 0;
    for (const i of A.ring) if (draw(`${key}:f:${i}`) < M.fire && tileFlammable(g, i).f > 0 && ignite(g, i)) fires++;
    const iron = Math.round(between(M.iron, draw(`${key}:iron`)));
    if (iron > 0 && g.reg.has('item', M.item)) { // it belongs to whoever holds the land there (else the player)
      const prev = g.actor;
      g.actor = g.territoryAt(a.x, a.y) || s.playerSettlement;
      try { g.createItems(M.item, iron, a.x, a.y, 'divine'); } finally { g.actor = prev; }
    }
    replan(g, [...owners]);
    return { msg: `A falling star struck (${a.x}, ${a.y})${A.killed.length ? `: ${A.killed.map((c) => c.name).join(', ')} killed` : ''}${A.wounded.length ? `${A.killed.length ? ',' : ':'} ${A.wounded.length} wounded` : ''}${A.lost.size ? `; ${A.lost.size} building part${A.lost.size === 1 ? '' : 's'} destroyed` : ''}.`,
      x: a.x, y: a.y, killed: A.killed.length, wounded: A.wounded.length, parts: A.lost.size, tiles, fires, goods, iron };
  },
});

// ---------------- earthquake ----------------
/** Built parts within the quake's radius (graves do not fall), each with its chance to collapse, in id order.
 *  O(radius²) tile lookups. */
export function quakeParts(g, x, y, Q) {
  const out = [], ids = [];
  for (let yy = y - Q.radius; yy <= y + Q.radius; yy++) for (let xx = x - Q.radius; xx <= x + Q.radius; xx++) {
    if (!g.inB(xx, yy)) continue;
    const id = g.structIdAt(g.i(xx, yy));
    if (id) ids.push(id);
  }
  for (const id of [...new Set(ids)].sort()) {
    const st = g.s.structures[id];
    if (!st.built || st.grave) continue;
    const d = Math.hypot(st.x - x, st.y - y);
    if (d > Q.radius) continue;
    const wood = buildingFlammable(g, g.bDef(st));
    out.push({ st, chance: Q.collapse * (1 - d / (Q.radius + 1)) * (Q.sturdy + (1 - Q.sturdy) * Math.min(1, wood)) });
  }
  return out;
}

registerPower('quake', {
  destructive: true,
  validate: tileArgs('quake'),
  cost: (g, a, r) => r.costs.quake ?? 70,
  preview(g, a, r) {
    const Q = rulesOf(r).quake, parts = quakeParts(g, a.x, a.y, Q), warnings = [], by = new Map();
    let likely = 0;
    for (const p of parts) { const k = p.st.settlement || g.s.playerSettlement; by.set(k, (by.get(k) || 0) + 1); likely += p.chance; }
    const people = Object.values(g.s.colonists).sort((p, q) => (p.id < q.id ? -1 : 1)).filter((c) => Math.hypot(c.x - a.x, c.y - a.y) <= Q.radius);
    warnings.push(...peopleWarnings(g, people, 'May be hurt'));
    for (const w of byVillage(g, by, 'building part')) warnings.push(`${w} in the area may collapse.`);
    if (parts.length) warnings.push(`About ${Math.round(likely)} of them will fall (wooden ones more often than stone); their villages rebuild them.`);
    return { x: a.x, y: a.y, parts: parts.length, likely: Math.round(likely), people: people.length, warnings, effect: `The earth shakes round (${a.x}, ${a.y}).` };
  },
  apply(g, cmd, r) {
    const a = cmd.args, Q = rulesOf(r).quake, key = keyOf(g, cmd), s = g.s;
    const fallen = quakeParts(g, a.x, a.y, Q).filter((p) => draw(`${key}:q:${p.st.id}`) < p.chance).map((p) => p.st);
    const tiles = new Set(fallen.map((st) => g.i(st.x, st.y)));
    const hurt = [];
    for (const c of Object.values(s.colonists).sort((p, q) => (p.id < q.id ? -1 : 1))) {
      const [cx, cy] = at(c);
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (g.inB(cx + dx, cy + dy) && tiles.has(g.i(cx + dx, cy + dy))) { near = true; break; }
      if (near) hurt.push(c);
    }
    for (const c of hurt) injure(g, c, 'wound', between(Q.wound, draw(`${key}:w:${c.id}`)), 'Hurt in the earthquake', false, mine(g, c.settlementId) ? 'warn' : 'info');
    destroyStructures(g, fallen.map((st) => st.id), { reason: null, why: 'It collapsed in the earthquake' });
    return { msg: `The earth shook round (${a.x}, ${a.y}): ${fallen.length} building part${fallen.length === 1 ? '' : 's'} collapsed${hurt.length ? `, ${hurt.length} hurt` : ''}.`, x: a.x, y: a.y, collapsed: fallen.length, hurt: hurt.length };
  },
});

// ---------------- tornado ----------------
const stormDir = (a, key) => (a.dir !== undefined ? a.dir : Math.floor(stormDraw(`${key}:dir`) * 8) % 8);

registerPower('tornado', {
  destructive: true,
  validate(g, a, r) {
    const k = extraKey(a, ['x', 'y', 'dir', 'confirm']);
    if (k) return `tornado takes only x, y, dir and confirm (not "${String(k).slice(0, 40)}")`;
    if (!Number.isInteger(a.x) || !Number.isInteger(a.y)) return 'pick a tile (whole x and y)';
    if (!g.inB(a.x, a.y)) return 'that spot is outside the map';
    if (a.dir !== undefined && (!Number.isInteger(a.dir) || a.dir < 0 || a.dir > 7)) return 'dir is a direction from 0 (east) to 7, clockwise';
    if (stormCount(g) >= stormRules(g).maxStorms) return 'too many storms are blowing already';
    return null;
  },
  cost: (g, a, r) => r.costs.tornado ?? 50,
  preview(g, a) {
    const T = stormRules(g), key = keyOf(g, null), path = stormPath(g, a.x, a.y, stormDir(a, key), key, T), R = T.radius;
    const tiles = new Set();
    for (const [x, y] of path) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (g.inB(x + dx, y + dy)) tiles.add(g.i(x + dx, y + dy));
    const people = Object.values(g.s.colonists).sort((p, q) => (p.id < q.id ? -1 : 1)).filter((c) => g.inB(...at(c)) && tiles.has(g.i(...at(c))));
    const by = new Map();
    let trees = 0;
    for (const i of tiles) {
      const st = g.structAt(i % g.W, (i / g.W) | 0);
      if (st?.built && !st.grave && buildingFlammable(g, g.bDef(st)) >= T.light) { const k2 = st.settlement || g.s.playerSettlement; by.set(k2, (by.get(k2) || 0) + 1); }
      const n = g.nodeAt(i % g.W, (i / g.W) | 0);
      if (n && (g.nodeDef(n)?.flammable || 0) > 0) trees++;
    }
    const warnings = [...peopleWarnings(g, people, 'In its path now')];
    for (const w of byVillage(g, by, 'wooden building part')) warnings.push(`${w} in its path may be torn down (stone stands).`);
    if (trees) warnings.push(`${trees} tree${trees === 1 ? '' : 's'} and plant${trees === 1 ? '' : 's'} in its path will be torn up.`);
    warnings.push(`It blows for about ${T.hours} hours along the path shown (${path.length} tiles); anyone it reaches is hurt, goods are thrown about and crops destroyed.`);
    return { x: a.x, y: a.y, dir: stormDir(a, key), path, people: people.length, warnings, effect: `A tornado touches down at (${a.x}, ${a.y}).` };
  },
  apply(g, cmd) {
    const a = cmd.args, key = keyOf(g, cmd), st = startStorm(g, a.x, a.y, stormDir(a, key), key, cmd.id);
    return { msg: `A tornado touched down at (${a.x}, ${a.y}).`, x: a.x, y: a.y, dir: st.d, storm: st.id };
  },
});

// ---------------- rain and drought ----------------
/** What lies in a round area: fires burning, crops (unripe) by village. O(r²). */
function inArea(g, x, y, r) {
  const fires = g.s.disasters?.fires || {}, crops = new Map();
  let burning = 0;
  for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) {
    if (!g.inB(xx, yy) || (xx - x) ** 2 + (yy - y) ** 2 > r * r) continue;
    const i = g.i(xx, yy);
    if (Object.hasOwn(fires, i)) burning++;
    const cr = g.cropAt(xx, yy);
    if (cr && cr.growth < 1) { const k = g.fieldAt(xx, yy)?.settlement || g.territoryAt(xx, yy) || g.s.playerSettlement; crops.set(k, (crops.get(k) || 0) + 1); }
  }
  return { burning, crops };
}
const weatherValidate = (name) => (g, a) => {
  const why = tileArgs(name)(g, a);
  if (why) return why;
  if (weatherCount(g) >= weatherRules(g).maxAreas) return 'the skies are busy enough (too many weather areas)';
  return null;
};

registerPower('rain', {
  validate: weatherValidate('rain'),
  cost: (g, a, r) => r.costs.rain ?? 20,
  preview(g, a) {
    const R = weatherRules(g).rain, A = inArea(g, a.x, a.y, R.radius);
    return { x: a.x, y: a.y, r: R.radius, days: R.days, fires: A.burning, effect: `Rain falls round (${a.x}, ${a.y}) for ${R.days} days${A.burning ? `, putting out ${A.burning} burning tile${A.burning === 1 ? '' : 's'}` : ''}; crops and plants grow faster there.` };
  },
  apply(g, cmd) {
    const a = cmd.args, w = startWeather(g, 'rain', a.x, a.y, cmd.id);
    return { msg: `Rain began to fall round (${a.x}, ${a.y}).`, x: a.x, y: a.y, area: w.id };
  },
});

registerPower('drought', {
  destructive: true,
  validate: weatherValidate('drought'),
  cost: (g, a, r) => r.costs.drought ?? 35,
  preview(g, a) {
    const R = weatherRules(g).drought, A = inArea(g, a.x, a.y, R.radius), warnings = [];
    for (const w of byVillage(g, A.crops, 'growing crop')) warnings.push(`${w} stop growing and wither (a crop withered to nothing is lost).`);
    warnings.push(`For ${R.days} days within ${R.radius} tiles: wild plants do not regrow and fires spread ${R.spread} times as fast.`);
    return { x: a.x, y: a.y, r: R.radius, days: R.days, warnings, effect: `A drought grips the land round (${a.x}, ${a.y}).` };
  },
  apply(g, cmd) {
    const a = cmd.args, w = startWeather(g, 'drought', a.x, a.y, cmd.id);
    return { msg: `A drought began round (${a.x}, ${a.y}).`, x: a.x, y: a.y, area: w.id };
  },
});

// ---------------- plague ----------------
/** Who falls ill: wrath.plague.share of the village's susceptible people (at least one), picked by draw. */
function plagueVictims(g, sid, ill, P, key) {
  const list = g.owned('colonists', sid).filter((c) => susceptible(g, c, ill)).sort((a, b) => (a.id < b.id ? -1 : 1));
  const n = Math.min(list.length, Math.max(1, Math.round(P.share * g.owned('colonists', sid).length)));
  return list.map((c) => ({ c, u: draw(`${key}:plague:${c.id}`) })).sort((a, b) => a.u - b.u || (a.c.id < b.c.id ? -1 : 1)).slice(0, n).map((e) => e.c);
}

registerPower('plague', {
  destructive: true,
  validate(g, a, r) {
    const k = extraKey(a, ['settlementId', 'confirm']);
    if (k) return `plague takes only settlementId and confirm (not "${String(k).slice(0, 40)}")`;
    if (typeof a.settlementId !== 'string' || !Object.hasOwn(g.s.settlements || {}, a.settlementId)) return 'there is no such village';
    const ill = g.reg.get('illness', rulesOf(r).plague.illness);
    if (!ill) return 'no plague illness is loaded';
    if (!g.owned('colonists', a.settlementId).some((c) => susceptible(g, c, ill))) return 'nobody there can catch it now';
    return null;
  },
  cost: (g, a, r) => r.costs.plague ?? 50,
  preview(g, a, r) {
    const P = rulesOf(r).plague, ill = g.reg.get('illness', P.illness), v = plagueVictims(g, a.settlementId, ill, P, keyOf(g, null));
    const all = g.owned('colonists', a.settlementId).length, where = mine(g, a.settlementId) ? 'your village' : villageName(g, a.settlementId);
    return { settlementId: a.settlementId, ill: v.length, people: all, warnings: [
      ...peopleWarnings(g, v, `Fall ill with ${ill.name.toLowerCase()}`),
      `It spreads through ${where} (${all} people) and to the villages they meet; it lasts ${ill.days} days a case, and many of the untended die.`,
    ], effect: `${ill.name} strikes ${where}.` };
  },
  apply(g, cmd, r) {
    const P = rulesOf(r).plague, ill = g.reg.get('illness', P.illness), sid = cmd.args.settlementId;
    const v = plagueVictims(g, sid, ill, P, keyOf(g, cmd));
    let n = 0;
    for (const c of v) if (infect(g, c, ill, 'struck by the gods')) n++;
    return { msg: `${ill.name} struck ${villageName(g, sid)}: ${n} fell ill.`, settlementId: sid, ill: n };
  },
});

// ---------------- smite ----------------
registerPower('smite', {
  destructive: true,
  validate(g, a) {
    const k = extraKey(a, ['colonistId', 'confirm']);
    if (k) return `smite takes only colonistId and confirm (not "${String(k).slice(0, 40)}")`;
    if (typeof a.colonistId !== 'string' || !Object.hasOwn(g.s.colonists, a.colonistId) || g._dying?.has(a.colonistId)) return 'there is no such person';
    return null;
  },
  cost: (g, a, r) => r.costs.smite ?? 20,
  preview(g, a) {
    const c = g.s.colonists[a.colonistId];
    return { colonistId: c.id, warnings: [`${c.name} of ${mine(g, c.settlementId) ? 'your village' : villageName(g, c.settlementId)} dies.`], effect: `${c.name} is smitten.` };
  },
  apply(g, cmd) {
    const c = g.s.colonists[cmd.args.colonistId];
    (g._dying ||= new Map()).set(c.id, 'smite');
    return { msg: `The gods smote ${c.name}.`, colonistId: c.id };
  },
});
