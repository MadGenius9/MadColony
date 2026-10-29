// Civilization laws, the AI side (docs/proposals/civilization-laws.md, slice 5; the owner's answer 7).
// - Every REVIEW_DAYS days (a village's day from a hash of its id) each AI village looks at its situation and
//   changes laws by rule: at war -> militia; under SHORT_FOOD days of food -> rationing; MIN_CHILDREN children and a
//   school -> compulsory schooling; FEW_TREES or fewer grown trees near -> protected forests. When the reason
//   passes it goes back to its leaning (civlaws.js leaningsOf), else the default. Kingdom laws are the capital's
//   to change. The 5-day wait applies, so nothing flips back and forth. The player's village is never touched.
// - Daily, relations between met villages drift by their laws (the owner's answer 6, left to Claude: yes): for each
//   law at least one of them has set (away from the default), the same option +DRIFT, a different one -DRIFT, at
//   most DRIFT_MAX either way a day. Villages with no laws (classic games) are untouched.
// O(villages x laws) for the review and O(met pairs x laws) for the drift, daily.
import { TICKS_PER_DAY } from './constants.js';
import { civLawOf, setCivLaw, leaningsOf, lawHolder, PROTECT_R } from './civlaws.js';
import { isEnemy } from './combat.js';
import { relationStatus, changeRelation } from './villages.js';
import { isAdult } from './people.js';

export const REVIEW_DAYS = 10;
export const SHORT_FOOD = 2;
export const MIN_CHILDREN = 3;
export const FEW_TREES = 5;
export const DRIFT = 0.05, DRIFT_MAX = 0.3;

const hash = (str) => { let h = 2166136261; for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const defaultOf = (g, id) => g.reg.get('civLaw', id)?.options?.[0]?.id;

/** What village sid's situation calls for: [[law, option, why]] (only laws it holds itself). */
function wanted(g, sid) {
  const s = g.s, st = s.settlements[sid], lean = leaningsOf(g, sid), out = [];
  const want = (id, cond, option, why, back) => {
    if (lawHolder(g, sid, id) !== sid || !g.reg.get('civLaw', id)) return;
    if (cond) out.push([id, option, why]);
    else out.push([id, lean[id] || defaultOf(g, id), back]);
  };
  const atWar = Object.keys(s.settlements).some((o) => o !== sid && isEnemy(g, sid, o));
  want('core:conscription', atWar, 'militia', 'it is at war', 'the war is over');
  const foodDays = g.plans?.[sid]?.foodDays;
  if (foodDays !== undefined) {
    const cur = civLawOf(g, sid, 'core:rationing');
    // Rationing ends only once food is plentiful again (5 days), so it does not stop and start.
    want('core:rationing', foodDays < SHORT_FOOD || (cur === 'rationed' && foodDays < 5), 'rationed', 'food is short', 'food is plentiful again');
  }
  const people = g.owned('colonists', sid);
  const children = people.filter((c) => !isAdult(g, c) && g.reg.get('lifeStage', c.stage)?.attendsSchool).length;
  const school = Object.values(s.structures).some((b) => b.built && (b.settlement || s.playerSettlement) === sid && g.bDef(b)?.id === 'core:school_desk');
  want('core:schooling', children >= MIN_CHILDREN && school, 'compulsory', 'its children should be at school', 'few children are of school age');
  const c = st.center || s.center;
  let trees = 0;
  for (const n of g.nodesNear(c.x, c.y, PROTECT_R)) if (!n.young && g.nodeDef(n)?.workType === 'core:chop' && (n.x - c.x) ** 2 + (n.y - c.y) ** 2 <= PROTECT_R * PROTECT_R) trees++;
  const prot = civLawOf(g, sid, 'core:forests') === 'protected';
  // Protection is lifted only once the woods have grown back (20 trees).
  want('core:forests', trees <= FEW_TREES || (prot && trees < 20 && !lean['core:forests']), 'protected', 'few trees are left near the village', 'the woods have grown back');
  return out;
}

/** Daily (game.js): the reviews (each village every REVIEW_DAYS days) and the relations drift. */
export function tickCivLaws(g) {
  const s = g.s, day = Math.floor(s.tick / TICKS_PER_DAY);
  for (const sid of Object.keys(s.settlements || {}).sort()) {
    const st = s.settlements[sid];
    if (!st.ai || st.fallen || sid === s.playerSettlement || (day + (hash(sid) % REVIEW_DAYS)) % REVIEW_DAYS) continue;
    for (const [id, option, why] of wanted(g, sid)) {
      if (!option || civLawOf(g, sid, id) === option) continue;
      setCivLaw(g, sid, id, option, why); // refused quietly while the 5-day wait holds
    }
  }
  drift(g);
}

function drift(g) {
  const s = g.s, laws = g.reg.all('civLaw').map((L) => L.id).sort();
  const coded = (sid) => !!s.settlements[sid]?.code || laws.some((id) => lawHolder(g, sid, id) !== sid && s.settlements[lawHolder(g, sid, id)]?.code?.[id]);
  for (const k of Object.keys(s.relations || {}).sort()) {
    const rel = s.relations[k];
    if (!rel.contact || !s.settlements[rel.a] || !s.settlements[rel.b] || s.settlements[rel.a].fallen || s.settlements[rel.b].fallen) continue;
    if (!coded(rel.a) && !coded(rel.b)) continue;
    let d = 0, same = 0, diff = 0;
    for (const id of laws) {
      const x = civLawOf(g, rel.a, id), y = civLawOf(g, rel.b, id), def = defaultOf(g, id);
      if (x === def && y === def) continue;
      if (x === y) { d += DRIFT; same++; } else { d -= DRIFT; diff++; }
    }
    d = Math.max(-DRIFT_MAX, Math.min(DRIFT_MAX, Math.round(d * 1000) / 1000));
    if (!d) continue;
    const value = Math.max(-100, Math.min(100, Math.round((rel.value + d) * 1000) / 1000));
    const why = d > 0 ? `Similar laws (${same} alike)` : `Their laws differ (${diff} apart)`;
    if (relationStatus({ contact: true, value }) !== relationStatus(rel)) changeRelation(g, rel.a, rel.b, value - rel.value, why);
    else rel.value = value;
  }
}
