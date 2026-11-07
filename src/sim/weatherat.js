// Where the weather is (Phase 5b, slice 6a): lookups into s.disasters.weather (weather.js), in a module with no
// imports, so the colonists' AI (givers.js, jobs.js) and lod.js can ask without loading the god powers.
/** The weather areas, newest first (derived per tick, never saved). */
function areas(g) {
  const W = g.s.disasters?.weather;
  if (!W) return null;
  if (g._wxTick !== g.s.tick || g._wxFor !== W) {
    g._wx = Object.values(W).sort((a, b) => Number(b.id.slice(1)) - Number(a.id.slice(1)));
    g._wxTick = g.s.tick; g._wxFor = W;
  }
  return g._wx;
}

/** The weather at (x, y): 'rain', 'drought' or null. O(areas). */
export function weatherAt(g, x, y) {
  const A = areas(g);
  if (!A) return null;
  for (const a of A) if ((x - a.x) ** 2 + (y - a.y) ** 2 <= a.r * a.r) return a.kind;
  return null;
}
export const weatherAtTile = (g, i) => weatherAt(g, i % g.W, (i - (i % g.W)) / g.W);
/** Is (x, y) in a drought? Sowing waits there (a crop sown now would only wither). O(1) without weather. */
export const droughtAt = (g, x, y) => !!g.s.disasters?.weather && weatherAt(g, x, y) === 'drought';
