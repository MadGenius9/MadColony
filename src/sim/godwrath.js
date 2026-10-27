// Destructive god powers (Phase 5b). Every one is destructive (god.js: refused until confirmed, warnings first),
// deterministic (draws are hashes of the seed and the command id) and conserved (ruin.js; deaths through death.js).
// - lightning { x, y }: whoever stands on the tile dies ("was struck by lightning"); people on the tiles round it
//   are burned (wrath.lightning.wound severity); if anything there can burn, a fire starts (fire.js).
// - fire { x, y }: the tile and the burnable tiles round it catch fire (fire.js spreads it).
// - smite { colonistId }: that person dies at once ("was smitten by the gods").
import { registerPower } from './god.js';
import { injure } from './health.js';
import { ignite, tileFlammable, buildingFlammable, fireRules } from './fire.js';
export { buildingFlammable };

const DEFAULTS = { lightning: { wound: [20, 45] } };
const rulesOf = (r) => ({ ...DEFAULTS, ...(r.wrath || {}) });
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
    for (const c of on) (g._dying ||= new Map()).set(c.id, 'lightning');
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

// ---------------- smite ----------------
registerPower('smite', {
  destructive: true,
  validate(g, a) {
    const k = extraKey(a, ['colonistId', 'confirm']);
    if (k) return `smite takes only colonistId and confirm (not "${String(k).slice(0, 40)}")`;
    if (typeof a.colonistId !== 'string' || !Object.hasOwn(g.s.colonists, a.colonistId)) return 'there is no such person';
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
