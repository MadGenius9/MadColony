// The content registry: every def, keyed by type and namespaced id, plus derived lookup indexes.
import { TYPE_NAMES } from './types.js';

export class Registry {
  constructor() {
    this.byType = {};
    for (const t of TYPE_NAMES) this.byType[t] = new Map();
    this.origin = new Map(); // "type|id" -> mod id that supplied the active def
    this.mods = []; // [{id, name, version}] in load order
    this.idx = null;
  }
  get(type, id) { return this.byType[type]?.get(id); }
  has(type, id) { return !!this.byType[type]?.has(id); }
  req(type, id) {
    const d = this.get(type, id);
    if (!d) throw new Error(`Unknown ${type} "${id}"`);
    return d;
  }
  all(type) { return [...this.byType[type].values()]; }
  itemHasTag(itemId, tag) { return !!this.get('item', itemId)?.tags?.includes(tag); }
  itemsWithTag(tag) { return this.idx.itemsWithTag[tag] || []; }

  buildIndexes() {
    const idx = { recipesFor: {}, nodesFor: {}, cropsFor: {}, itemsWithTag: {}, cropBySeed: {}, toolWorkTypes: [], bestTool: {} };
    const push = (o, k, v) => { (o[k] ||= []).push(v); };
    for (const it of this.all('item')) for (const t of it.tags || []) push(idx.itemsWithTag, t, it.id);
    for (const r of this.all('recipe')) for (const o of r.outputs) push(idx.recipesFor, o.item, r);
    for (const n of this.all('node')) for (const y of n.yields) push(idx.nodesFor, y.item, n);
    for (const c of this.all('crop')) { for (const h of c.harvest) push(idx.cropsFor, h.item, c); idx.cropBySeed[c.seed] = c; }
    const tw = new Set();
    for (const it of this.all('item')) {
      const eq = it.equipment;
      if (eq?.slot !== 'tool' || !eq.workBoost) continue;
      for (const [wt, boost] of Object.entries(eq.workBoost)) {
        tw.add(wt);
        if (!idx.bestTool[wt] || boost > idx.bestTool[wt].boost) idx.bestTool[wt] = { item: it.id, boost };
      }
    }
    idx.toolWorkTypes = [...tw];
    // Research: what each technology unlocks (anything not listed here is available from the start).
    idx.lockedBy = { recipe: {}, building: {}, template: {} };
    for (const t of this.all('tech')) {
      for (const r of t.unlocks?.recipes || []) push(idx.lockedBy.recipe, r, t.id);
      for (const b of t.unlocks?.buildings || []) push(idx.lockedBy.building, b, t.id);
      for (const tp of t.unlocks?.templates || []) push(idx.lockedBy.template, tp, t.id);
    }
    idx.eras = this.all('era').sort((a, b) => a.order - b.order);
    idx.researchStations = this.all('building').filter((b) => b.research).map((b) => b.id);
    this.idx = idx;
  }

  recipesForTag(tag) {
    const items = this.itemsWithTag(tag);
    const out = [];
    for (const it of items) for (const r of this.idx.recipesFor[it] || []) if (!out.includes(r)) out.push(r);
    return out;
  }
}
