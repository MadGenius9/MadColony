// Lighting (Phase 4). After dark, work goes more slowly on unlit tiles. Buildings with a `light` radius light
// the tiles around them: fires and lanterns always, electric lights (`power.use`) only while their network
// has power. Electric lights draw power only after dark. Light sources are derived from buildings and
// never saved.
import { powerAt, isBroken } from './power.js';

export const LIGHT = { darkWork: 0.8, from: 21, until: 5 };

/** Is it dark outside? */
export const isDark = (g) => { const h = g.hour; return h >= LIGHT.from || h < LIGHT.until; };

/** Light sources shining right now: [{ x, y, r, st }]. Cached for the current tick. */
export function lightSources(g) {
  if (g._lights && g._lights.tick === g.s.tick) return g._lights.list; // per tick only, so saves continue identically
  const list = [];
  for (const st of g.structsWhere('light', (b) => !!g.bDef(b)?.light)) {
    if (!st.built) continue;
    const def = g.bDef(st);
    if (!def?.light) continue;
    if (def.power?.use && (isBroken(st) || powerAt(g, st).ratio <= 0)) continue;
    list.push({ x: st.x, y: st.y, r: def.light.radius, st });
  }
  g._lights = { tick: g.s.tick, list };
  return list;
}

/** Is this tile lit (by daylight or a light source)? */
export function litAt(g, x, y) {
  if (!isDark(g)) return true;
  for (const l of lightSources(g)) if ((l.x - x) ** 2 + (l.y - y) ** 2 <= l.r * l.r) return true;
  return false;
}

/** Work speed factor for someone working at (x, y). */
export const lightFactor = (g, x, y) => (litAt(g, x, y) ? 1 : LIGHT.darkWork);
