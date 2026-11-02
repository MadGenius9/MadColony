// Roads (Phase 7, docs/proposals/phase-7-roads.md, slice 1). A road is a one-tile, walkable building (data: a
// building with `road: { terrain }`). When it is built, its tile becomes the road terrain, which is cheaper to walk
// (moveCost), so every path search already prefers it; the old terrain is kept on the building (st.under, saved:
// format 39) and comes back when the road is removed (game.js removeStructure). Nothing in the path code changes.

/** Construction finished a road (construction.js completeStructure): its tile becomes road. */
export function layRoad(g, st) {
  const R = g.bDef(st)?.road;
  if (!R || !g.reg.get('terrain', R.terrain)) return;
  const i = g.i(st.x, st.y), now = g.terrainAt(st.x, st.y)?.id;
  if (!now || now === R.terrain) return;
  st.under = now;
  g.setTerrain(i, R.terrain);
}

/** A road is removed (game.js removeStructure): its tile's old ground comes back. */
export function liftRoad(g, st) {
  if (!st.under || !g.reg.get('terrain', st.under)) return;
  g.setTerrain(g.i(st.x, st.y), st.under);
}

/** Built road tiles of village sid (for plans and the UI). */
export const roadsOf = (g, sid) => g.owned('structures', sid).filter((b) => b.built && g.bDef(b)?.road);
