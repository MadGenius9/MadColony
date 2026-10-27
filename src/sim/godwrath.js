// Destructive god powers (Phase 5b). Every one is destructive (god.js: refused until confirmed, warnings first),
// deterministic (draws are hashes of the seed and the command id) and conserved (ruin.js; deaths through death.js).
// - lightning { x, y }: whoever stands on the tile dies ("was struck by lightning"); people on the tiles round it
//   are burned (wrath.lightning.wound severity); a flammable building, tree, crop or goods on the tile burn.
// - smite { colonistId }: that person dies at once ("was smitten by the gods").
import { registerPower } from './god.js';
import { injure } from './health.js';
import { destroyStructure, destroyNode, destroyStack, destroyCrop, replan } from './ruin.js';

const DEFAULTS = { lightning: { wound: [20, 45], flammableAt: 0.5 } };
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

/** How flammable a building is: its own `flammable`, else the share of flammable materials in its cost. */
export function buildingFlammable(g, def) {
  if (!def) return 0;
  if (def.flammable !== undefined) return def.flammable;
  let all = 0, f = 0;
  for (const c of def.cost || []) { all += c.qty; f += c.qty * (g.reg.get('item', c.item)?.flammable || 0); }
  return all ? f / all : 0;
}

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
function lightningPlan(g, a, r) {
  const L = rulesOf(r).lightning;
  const { on, near } = peopleNear(g, a.x, a.y, 1);
  const st = g.structAt(a.x, a.y), node = g.nodeAt(a.x, a.y), crop = g.cropAt?.(a.x, a.y), stack = g.stackAt?.(a.x, a.y);
  const burns = {
    st: st && buildingFlammable(g, g.bDef(st)) >= L.flammableAt ? st : null,
    node: node && (g.nodeDef(node)?.flammable || 0) >= L.flammableAt ? node : null,
    crop: crop || null,
    stack: stack && (g.reg.get('item', stack.item)?.flammable || 0) >= L.flammableAt ? stack : null,
  };
  return { on, near, burns };
}

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
  preview(g, a, r) {
    const p = lightningPlan(g, a, r), warnings = [];
    warnings.push(...peopleWarnings(g, p.on, 'Killed'), ...peopleWarnings(g, p.near, 'Burned'));
    if (p.burns.st) warnings.push(`A ${g.bDef(p.burns.st).name} of ${mine(g, p.burns.st.settlement) ? 'your village' : villageName(g, p.burns.st.settlement)} burns down.`);
    if (p.burns.node) warnings.push(`A ${g.nodeDef(p.burns.node).name.toLowerCase()} burns.`);
    if (p.burns.stack) warnings.push(`${p.burns.stack.qty} ${g.reg.get('item', p.burns.stack.item).name} burn.`);
    return { x: a.x, y: a.y, killed: p.on.length, burned: p.near.length, warnings, effect: `Lightning strikes (${a.x}, ${a.y})${p.on.length ? `, killing ${p.on.length}` : ''}${p.near.length ? `, burning ${p.near.length}` : ''}.` };
  },
  apply(g, cmd, r) {
    const a = cmd.args, L = rulesOf(r).lightning, p = lightningPlan(g, a, r), key = keyOf(g, cmd);
    for (const c of p.on) (g._dying ||= new Map()).set(c.id, 'lightning');
    for (const c of p.near) injure(g, c, 'burn', L.wound[0] + (L.wound[1] - L.wound[0]) * draw(`${key}:${c.id}`), 'Burned by lightning', false, mine(g, c.settlementId) ? 'warn' : 'info');
    const sids = [];
    if (p.burns.st) { sids.push(p.burns.st.settlement || g.s.playerSettlement); destroyStructure(g, p.burns.st.id, { reason: 'fire', why: 'Struck by lightning', replan: false }); }
    if (p.burns.node) destroyNode(g, p.burns.node.id);
    if (p.burns.crop) destroyCrop(g, p.burns.crop.id);
    if (p.burns.stack) destroyStack(g, p.burns.stack.id, 'fire');
    replan(g, sids);
    return { msg: `Lightning struck (${a.x}, ${a.y})${p.on.length ? `: ${p.on.map((c) => c.name).join(', ')} killed` : ''}${p.near.length ? `${p.on.length ? ',' : ':'} ${p.near.length} burned` : ''}.`, x: a.x, y: a.y, killed: p.on.length, burned: p.near.length };
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
