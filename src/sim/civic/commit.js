// Civic commitment: the one place where housing, workstation and utility (lamp, tap) intents become
// construction projects. At most one project per settlement per plan; the most urgent eligible intent goes
// first (utilities after homes and stations). A failed site search is remembered in state.civic.blocked for
// a while (saved, so a loaded game behaves the same) so blocked intents do not search the map on every plan.
import { createProject, tileUsable } from '../construction.js';
import { orderedIntents } from './intents.js';
import { selectCandidate, siteStillValid } from './sites.js';
import { fillName } from './needs.js';

export const CIVIC = { perPlan: 1, blockedTicks: 600, maxSearches: 2 };

const blockKey = (sid, it) => `${sid}|${it.id}`;

/** The cached site-search blocker for an intent, if still in force (and, for a utility, if its targets are unchanged). */
export function cachedBlock(g, sid, it) {
  const b = g.s.civic?.blocked?.[blockKey(sid, it)];
  return b && b.until > g.s.tick && (b.sig === undefined || b.sig === it.sig) ? b : null;
}

/** A utility spot found this plan: re-check its two tiles exactly as the search did. */
const nearStillValid = (g, sid, site) => [0, 1].every((k) => tileUsable(g, site.x, site.y + k, sid) && !g.nodeAt(site.x, site.y + k) && !g.fieldAt(site.x, site.y + k) && !g.cropAt(site.x, site.y + k));

/**
 * Commit the most urgent intents of a settlement (at most CIVIC.perPlan). Returns the projects created.
 * Intents that are blocked (research, template, waiting, or a recent failed site search) are skipped and
 * keep their blocker for the UI.
 */
export function commitIntents(g, P, sid, { templateUnlocked, templateCost, homeCapacity }) {
  const s = g.s;
  s.civic ||= { blocked: {} };
  for (const [k, b] of Object.entries(s.civic.blocked)) if (b.until <= s.tick) delete s.civic.blocked[k];
  const made = [];
  for (const it of orderedIntents(P)) {
    if (made.length >= CIVIC.perPlan) break;
    if (it.need <= 0 || it.blocked) continue;
    const cached = cachedBlock(g, sid, it);
    if (cached) { it.blocked = { kind: 'space', reason: cached.reason }; continue; }
    const pick = selectCandidate(g, sid, it, templateUnlocked, templateCost, CIVIC.maxSearches);
    if (pick.blocked) {
      it.blocked = pick.blocked;
      if (pick.blocked.kind === 'space') s.civic.blocked[blockKey(sid, it)] = { until: s.tick + CIVIC.blockedTicks, reason: String(pick.blocked.reason).slice(0, 300),...(it.sig !== undefined ? { sig: it.sig } : {}) };
      continue;
    }
    const { template: t, site } = pick;
    if (!(it.near ? nearStillValid(g, sid, site) : siteStillValid(g, sid, t, site))) { it.blocked = { kind: 'space', reason: 'The chosen site was no longer free' }; continue; }
    if (it.kind === 'utility') { made.push(commitUtility(g, P, sid, it, t, site)); continue; }
    const why = it.sources.find((x) => x.goal || x.forGoal)?.why || it.sources[0]?.why || t.name;
    const p = createProject(g, t, site, { urgency: it.priority + (it.kind === 'station' ? 0.2 : 0), why: it.kind === 'station' ? `${t.name}: ${why}` : why, owner: sid });
    p.goal = it.goal || null;
    if (it.forGoal) p.forGoal = it.forGoal;
    p.intent = it.id;
    if (it.kind === 'home') g.log(`The colonists planned a ${t.name} for ${homeCapacity(g, t)} at (${site.x},${site.y}).`, 'build');
    else if (it.forGoal) g.log(`For a goal, the colonists will build another ${t.name} (${it.completed} built, ${it.inFlight + 1} under way, ${it.target} wanted).`, 'build');
    else g.log(`The colonists decided to build a ${t.name} (${why.toLowerCase()}).`, 'build');
    it.inFlight += it.kind === 'home' ? homeCapacity(g, t) : 1;
    it.need = Math.max(0, it.target - it.completed - it.inFlight);
    it.project = p;
    P._counts = null; // a project was added: recount when next needed
    made.push(p);
  }
  return made;
}

/** A lamp or tap by the target it serves; the reason and log line name that target. */
function commitUtility(g, P, sid, it, t, site) {
  const name = site.target.name;
  const p = createProject(g, t, { x: site.x, y: site.y, rot: site.rot }, { urgency: it.priority, why: fillName(it.whyText, name), owner: sid });
  p.intent = it.id;
  g.log(fillName(it.logText, name), 'build');
  it.inFlight += 1;
  // The new one serves its target and every other target it reaches; one at a time means none more now.
  it.near = it.oneAtATime ? [] : it.near.filter((n) => n !== site.target && Math.hypot(n.x - site.x, n.y - site.y) > it.cover);
  it.need = it.oneAtATime ? 0 : it.near.length;
  it.project = p;
  P._counts = null;
  return p;
}
