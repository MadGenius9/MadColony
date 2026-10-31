// Rain and drought (Phase 5b, slice 6a). World state: `s.disasters.weather` (id -> { id, kind, x, y, r, until }),
// round areas made by the rain and drought powers, at most wrath.weather.maxAreas at once; each ends at `until`.
// - Rain: fires in it go out at the next fire step (the tile is left scorched, nothing more burns), no fire starts
//   or spreads there; crops and wild plants grow `rain.grow` times as fast.
// - Drought: crops do not grow and unripe ones wither (`drought.wither` of a full crop a day; a crop withered to
//   nothing is lost); wild plants do not regrow; fires spread `drought.spread` times as fast.
// Where areas overlap, the newest one counts. Lookups are O(areas) (usually 0..2); nothing while none is active.
import { godRulesOf } from './god.js';
import { disasters } from './fire.js';
import { weatherAt } from './weatherat.js';
export { weatherAt, weatherAtTile, droughtAt } from './weatherat.js';

export const WEATHER_DEFAULTS = Object.freeze({
  rain: Object.freeze({ radius: 10, days: 2, grow: 1.5 }),
  drought: Object.freeze({ radius: 12, days: 4, wither: 0.25, spread: 2 }),
  maxAreas: 4,
});
export function weatherRules(g) {
  if (g._wxRules) return g._wxRules; // derived, per game (the rules do not change)
  const w = godRulesOf(g)?.wrath?.weather || {};
  return (g._wxRules = { rain: { ...WEATHER_DEFAULTS.rain, ...(w.rain || {}) }, drought: { ...WEATHER_DEFAULTS.drought, ...(w.drought || {}) }, maxAreas: w.maxAreas ?? WEATHER_DEFAULTS.maxAreas });
}

export const weatherCount = (g) => Object.keys(g.s.disasters?.weather || {}).length;

/** Start a weather area (the rain and drought powers; its id comes from the command id). Returns it. */
export function startWeather(g, kind, x, y, cmdId) {
  const R = weatherRules(g)[kind], D = disasters(g);
  D.weather ||= {};
  const a = { id: `w${cmdId}`, kind, x, y, r: R.radius, until: g.s.tick + Math.round(R.days * 2400) };
  D.weather[a.id] = a;
  g._wxTick = -1;
  return a;
}

/** Game.tick (while weather areas exist): areas whose time is up end. */
export function tickWeather(g) {
  const W = g.s.disasters?.weather;
  if (!W) return;
  for (const id of Object.keys(W).sort()) {
    if (g.s.tick < W[id].until) continue;
    const a = W[id];
    delete W[id];
    g._wxTick = -1;
    g.log(a.kind === 'rain' ? 'The rain has stopped.' : 'The drought is over.', 'info');
  }
  if (!Object.keys(W).length) delete g.s.disasters.weather;
}

/** Crop growth and wild regrowth factor at (x, y): rain.grow in rain, 0 in a drought, else 1. */
export function growFactor(g, x, y) {
  const k = weatherAt(g, x, y);
  return k === 'rain' ? weatherRules(g).rain.grow : k === 'drought' ? 0 : 1;
}
