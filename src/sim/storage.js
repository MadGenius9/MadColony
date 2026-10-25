// Village storage hubs. Each settlement keeps its goods in one stockpile zone around its centre (the hub);
// this module gives the hub a name, groups goods by category when they are put away, explains what is
// stored, reserved, on the way and still waiting to be hauled, and stops pointless detours (materials
// already needed by a building site next to them are not carried to the hub first). Goods only move by
// hauling; nothing is ever rearranged inside the hub, so there are no haul loops.

export const CATEGORIES = ['Food', 'Materials', 'Tools & equipment', 'Arms & ammunition', 'Medical', 'Other'];

/** The storage category of an item (data-driven: tags, nutrition and equipment). */
export function itemCategory(g, item) {
  const d = g.reg.get('item', item);
  if (!d) return 'Other';
  const t = d.tags || [];
  if (t.includes('core:medical')) return 'Medical';
  if (t.includes('core:arms') || t.includes('core:ammo')) return 'Arms & ammunition';
  if (d.equipment) return 'Tools & equipment';
  if (d.nutrition > 0 || t.includes('core:food') || t.includes('core:meal') || t.includes('core:raw_food')) return 'Food';
  if (t.includes('core:material') || t.includes('core:fuel')) return 'Materials';
  return 'Other';
}

/** Placement preference for one hub tile: next to goods of the same category is better (lower score). */
export function categoryScore(g, item, x, y, sid) {
  const cat = itemCategory(g, item);
  let s = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const st = g.stackAt(x + dx, y + dy);
    if (!st || !g.isStockpile(x + dx, y + dy) || (st.settlement || g.s.playerSettlement) !== sid) continue;
    s += itemCategory(g, st.item) === cat ? -1.5 : 1;
  }
  return s;
}

export const hubName = (g, sid) => `${g.s.settlements?.[sid]?.name || 'Village'} stores`;

/** Is this loose stack wanted by a building site of the same settlement close by (no detour via the hub)? */
export function neededNearby(g, st, sid, range = 8) {
  // Big worlds: only this settlement's projects (ownership index, game.js: the same projects in the same order
  // as a scan of every project), so a check costs O(its projects), not O(the world's). Classic worlds: the scan.
  for (const p of g.big ? g.ownIndex('projects').get(sid)?.values() || [] : Object.values(g.s.projects)) {
    if ((p.status !== 'active' && !p.renovating) || (p.settlement || g.s.playerSettlement) !== sid) continue;
    for (const id of p.parts) {
      const site = g.s.structures[id];
      if (!site || Math.max(Math.abs(site.x - st.x), Math.abs(site.y - st.y)) > range) continue;
      const def = site.built ? (site.reno && g.reg.get('building', site.reno.to)) : g.bDef(site);
      const delivered = site.built ? site.reno?.delivered || {} : site.delivered || {};
      if (def?.cost?.some((c) => c.item === st.item && (delivered[c.item] || 0) < c.qty)) return true;
    }
  }
  return false;
}

/**
 * What a settlement holds and where it is:
 *  stored     — in the hub (of which `reserved` is promised to jobs or trades);
 *  inTransit  — carried by its colonists right now;
 *  waiting    — loose on the ground outside the hub, still to be hauled (not counting goods kept at a
 *               building site that needs them);
 *  kept       — goods deliberately kept elsewhere: station buffers, fuel/supply stores, building sites.
 */
export function storageStatus(g, sid) {
  const tiles = g.stockpileOf(sid);
  let used = 0, stored = 0, reserved = 0, waiting = 0, waitingStacks = 0, inTransit = 0, kept = 0;
  const byCategory = {};
  for (const k of tiles) {
    const [x, y] = k.split(',').map(Number);
    const st = g.stackAt(x, y);
    if (!st || (st.settlement || g.s.playerSettlement) !== sid) continue;
    used++; stored += st.qty;
    reserved += Math.min(st.qty, g.reservedQty(st.id) + (g.tradeHeld ? g.tradeHeld(st.id) : 0));
    const cat = itemCategory(g, st.item);
    byCategory[cat] = (byCategory[cat] || 0) + st.qty;
  }
  for (const st of g.owned('stacks', sid)) {
    if (g.isStockpile(st.x, st.y)) continue;
    if (neededNearby(g, st, sid)) { kept += st.qty; continue; }
    waiting += st.qty; waitingStacks++;
  }
  for (const c of g.owned('colonists', sid)) if (c.carry) inTransit += c.carry.qty;
  for (const b of g.owned('structures', sid)) {
    for (const x of b.buffer || []) kept += x.qty;
    for (const f of b.fuel || []) kept += f.qty;
    for (const q of Object.values(b.delivered || {})) if (!b.built) kept += q;
  }
  return { name: hubName(g, sid), tiles: tiles.length, used, free: tiles.length - used, stored, reserved, inTransit, waiting, waitingStacks, kept, byCategory };
}
