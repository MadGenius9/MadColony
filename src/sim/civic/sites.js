// Deterministic candidate selection for civic intents: which template, and where. No random numbers are
// drawn (ties go to the first candidate in a fixed scan order), and the search radius is bounded by
// findSite. A chosen site is checked again immediately before it is committed.
import { findSite, placedCells, tileUsable } from '../construction.js';
import { parseTemplate } from '../content/templates.js';
import { settlementOf } from '../research.js';
import { templatesProviding } from './needs.js';

const bedsOf = (t) => t.capacity ?? parseTemplate(t).cells.filter((c) => c.spec?.slot === 'core:bed').length;

/** Templates to try for an intent, best first, in a stable order. */
export function candidateTemplates(g, sid, intent, templateUnlocked, templateCost) {
  if (intent.kind === 'home') {
    const caps = g.reg.all('template').filter((t) => t.kind === 'home' && templateUnlocked(g, sid, t)).map((t) => ({ t, cap: bedsOf(t) }));
    if (!caps.length) return [];
    let fit = caps.filter((x) => x.cap <= intent.need);
    if (!fit.length) { const min = Math.min(...caps.map((y) => y.cap)); fit = caps.filter((x) => x.cap === min); }
    const maxCap = Math.max(...fit.map((x) => x.cap));
    return fit.filter((x) => x.cap === maxCap).map((x) => x.t).sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  return templatesProviding(g, sid, intent.building, templateUnlocked).sort((a, b) => templateCost(g, a) - templateCost(g, b) || (a.id < b.id ? -1 : 1));
}

/**
 * A spot for a small utility (lamp, tap) near the first target in `near` that has one: each target's square
 * of radius r is scanned row by row (dy, then dx, from −r), a spot needs its tile and the one below free
 * (usable by this settlement, no resource node, field or crop), and the closest wins, with `pen` added for
 * spots right beside the target (not in the way). Ties go to the first in scan order; no random numbers.
 * Returns { x, y, rot: 0, target } or null.
 */
export function nearSite(g, sid, tpl, near) {
  void tpl; // the utility templates are one building over one free tile: the predicate below checks both
  const ok = (x, y) => tileUsable(g, x, y, sid) && !g.nodeAt(x, y) && !g.fieldAt(x, y) && !g.cropAt(x, y);
  for (const t of near) {
    let best = null, bd = Infinity;
    for (let dy = -t.r; dy <= t.r; dy++) for (let dx = -t.r; dx <= t.r; dx++) {
      const x = t.x + dx, y = t.y + dy;
      if (!ok(x, y) || !ok(x, y + 1)) continue;
      const d = Math.hypot(dx, dy) + (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 ? (t.pen || 0) : 0);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    if (best) return { x: best.x, y: best.y, rot: 0, target: t };
  }
  return null;
}

// At most three names, so the reason stays short (it is saved, and saves cap reasons at 300 characters).
const listNames = (near) => {
  if (near.length <= 1) return near[0]?.name || 'anywhere';
  if (near.length > 3) return `${near.slice(0, 3).map((n) => n.name).join(', ')} and ${near.length - 3} more`;
  return `${near.slice(0, -1).map((n) => n.name).join(', ')} or ${near[near.length - 1].name}`;
};

/** First template with a site, searching at most `maxSearches` templates. Utilities search near their targets. */
export function selectCandidate(g, sid, intent, templateUnlocked, templateCost, maxSearches = 2) {
  if (intent.near) {
    const t = g.reg.get('template', intent.template);
    if (!t || !templateUnlocked(g, sid, t)) return { blocked: { kind: 'template', reason: `No plan for ${intent.label} is available` } };
    const site = nearSite(g, sid, t, intent.near);
    if (site) return { template: t, site };
    return { blocked: { kind: 'space', reason: `No free spot for ${intent.label} near ${listNames(intent.near)}` } };
  }
  const tpls = candidateTemplates(g, sid, intent, templateUnlocked, templateCost);
  if (!tpls.length) return { blocked: { kind: 'template', reason: intent.kind === 'home' ? 'No home plans are available' : 'No building template is available' } };
  const center = settlementOf(g, sid)?.center;
  for (const t of tpls.slice(0, maxSearches)) {
    const site = findSite(g, t, { center, sid }); // no rng: stable choice
    if (site) return { template: t, site };
  }
  return { blocked: { kind: 'space', reason: intent.kind === 'home' ? 'No free space for another home (enlarge or clear the allowed area)' : `No free space for a ${g.reg.get('building', intent.building)?.name || 'building'} (check the allowed area)` } };
}

/** Re-check a site just before committing: every cell still usable by this settlement, entrance still reachable. */
export function siteStillValid(g, sid, tpl, site) {
  const cells = placedCells(tpl, site.x, site.y, site.rot);
  for (const c of cells) if (!tileUsable(g, c.x, c.y, sid)) return false;
  const home = g.regionOf(settlementOf(g, sid)?.center?.x ?? g.s.center.x, settlementOf(g, sid)?.center?.y ?? g.s.center.y);
  const entrances = cells.filter((c) => c.spec?.clear);
  const probe = entrances.length ? entrances : cells;
  return probe.some((c) => g.regionOf(c.x, c.y) === home || g.nodeAt(c.x, c.y));
}
