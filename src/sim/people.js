// Life stages, ages and births (Phase 5 foundation).
//
// Stages come from mod data (`lifeStage`, ordered): by default Infant -> Child -> Adult. A stage can end
// after `untilDays` game days of life, need others' care (`needsCare`), attend school (`attendsSchool`),
// be limited to some work types (`workTypes`) and be kept out of fights (`fights: false`).
//
// Childhood is compressed: a child grows up in a few game days rather than years (data: untilDays), so
// the cycle can be seen in play. Adults have an age in years that grows one year per game year.
//
// How children arrive: there is no romance or relationship system. A household (a finished home whose
// beds have at least two adult residents and one free bed) in a settlement with enough food and room
// under its population cap may have a child, at most once every few days per home (BIRTH below). The
// child takes the free bed and records the two adults as its parents. Existing colonists in older saves
// become adults; nothing else in an old save changes.
import { TICKS_PER_DAY } from './constants.js';
import { inheritLook } from './appearance.js';
import { namePoolOf, surnameOf, uniqueName, usedNames } from './names.js';
import { startAge, ageNow } from './life.js';
import { blessingOf } from './god.js';
import { peopleOfSettlement, inheritTraits, paletteOf } from './peoples.js';
import { civLawOf, hoursOf, CHILD_WORK } from './civlaws.js';
/** School hours (education.js EDU.school, 8-15), here to keep people.js free of education.js. */
const inSchoolHours = (g) => { const h = (g.s.tick % TICKS_PER_DAY) / (TICKS_PER_DAY / 24); return h >= 8 && h < 15; };
import { growthOf } from './worldlaws.js';

export const BIRTH = { chancePerDay: 0.25, minFoodDays: 4, gapDays: 6, defaultCap: 12, adultAge: 16 };

const hash = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
// Life stages in order, once per registry (a registry does not change after it is built): stageOf runs for every
// colonist every tick, and sorting the stages each time was a measurable share of a big world's tick.
const STAGES = new WeakMap();
const stages = (g) => { let l = STAGES.get(g.reg); if (!l) STAGES.set(g.reg, (l = g.reg.all('lifeStage').sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))); return l; };
export const adultStage = (g) => { const st = stages(g); return st[st.length - 1]; };

/** The stage definition of a colonist (older saves without a stage are adults). */
export function stageOf(g, c) { return g.reg.get('lifeStage', c.stage) || adultStage(g); }
export const isAdult = (g, c) => stageOf(g, c) === adultStage(g);
export const needsCare = (g, c) => !!stageOf(g, c)?.needsCare;
export const mayFight = (g, c) => stageOf(g, c)?.fights !== false;
/** May this colonist do this kind of work at their stage? */
export function mayDoWork(g, c, workTypeId) {
  const st = stageOf(g, c), sid = c.settlementId || g.s.playerSettlement;
  // Civilization laws (civlaws.js): a curfew stops outdoor work at night; compulsory schooling keeps children
  // at their studies in school hours; child labour lets children haul and farm too.
  if (g.isNight() && hoursOf(g, sid) === 'curfew' && g.reg.get('workType', workTypeId)?.outdoor) return false;
  if (st?.workTypes && st.attendsSchool) {
    const law = civLawOf(g, sid, 'core:schooling');
    if (law === 'compulsory' && inSchoolHours(g) && workTypeId !== 'core:study') return false;
    if (law === 'child_labour' && CHILD_WORK.includes(workTypeId)) return true;
  }
  return !st?.workTypes || st.workTypes.includes(workTypeId);
}
/** Age in game days since birth (children), or null for adults without a recorded birth. */
export const ageDays = (g, c) => (c.bornTick !== undefined && c.bornTick !== null ? (g.s.tick - c.bornTick) / TICKS_PER_DAY : null);
/** Age in years for display: adults count game years; children are shown in days. */
export function ageLabel(g, c) {
  const st = stageOf(g, c);
  if (!isAdult(g, c)) return `${st.name}, ${Math.floor(ageDays(g, c) || 0)} day(s) old`;
  const yearDays = g.reg.get('worldgen', g.s.worldgenId)?.climate?.yearDays || 30;
  const yrs = (c.ageYears ?? 30) + Math.max(0, ageNow(g, c) - (c.ageTick ?? g.s.tick)) / (yearDays * TICKS_PER_DAY); // the Ageless law stops it (life.js)
  return `${st.name}, ${Math.floor(yrs)}`;
}

/** Older saves and newly founded colonists: adults of a plausible age (from the id, so no RNG is used). */
export function ensureAdult(g, c) {
  if (c.stage) return;
  c.stage = adultStage(g)?.id || 'core:adult';
  c.ageYears ??= startAge(g, c.id) ?? 20 + (hash(c.id) % 26); // scenarios with aging rules spread ages wider (life.js)
  c.ageTick ??= g.s.tick;
  c.quals ||= g.reg.get('qualification', 'core:schooled') ? ['core:schooled'] : []; // they grew up elsewhere and had schooling
}

/** Daily: children move on through the stages; households may have a child. */
export function tickPeople(g) {
  const adult = adultStage(g);
  for (const c of Object.values(g.s.colonists)) {
    if (!c.stage) ensureAdult(g, c);
    if (adult && c.stage === adult.id) continue; // adults (the last stage) never move on: the common case, at once
    const st = stageOf(g, c);
    if (st.untilDays === undefined || ageDays(g, c) === null || ageDays(g, c) < st.untilDays) continue;
    const list = stages(g);
    const next = list[list.indexOf(st) + 1];
    if (!next) continue;
    c.stage = next.id;
    if (next === adultStage(g)) { c.ageYears = BIRTH.adultAge; c.ageTick = g.s.tick; }
    g.log(`${c.name} is now ${next === adultStage(g) ? 'an adult' : `a ${next.name.toLowerCase()}`}.`, 'good');
  }
  if (g.s.tick % TICKS_PER_DAY !== 6 * 100) return; // births are considered once a day, in the morning
  for (const sid of Object.keys(g.s.settlements || {})) considerBirths(g, sid);
}

function considerBirths(g, sid) {
  const s = g.s;
  const people = Object.values(s.colonists).filter((c) => (c.settlementId || s.playerSettlement) === sid);
  const cap = g.policyFor(sid).maxPopulation ?? BIRTH.defaultCap;
  if (people.length >= cap) return;
  if ((g.ensurePlan(sid)?.foodDays ?? 0) < BIRTH.minFoodDays) return;
  const first = stages(g)[0];
  if (!first || first === adultStage(g)) return;
  const homes = Object.values(s.homes).filter((h) => h.complete && (h.settlement || s.playerSettlement) === sid).sort((a, b) => (a.id < b.id ? -1 : 1));
  // Spare beds an active 'Expand housing' goal asks for are kept spare: a birth must not use them.
  const keep = sid === s.playerSettlement ? s.goals.filter((gl) => gl.type === 'core:expand_housing' && gl.status === 'active').reduce((m, gl) => Math.max(m, gl.params?.extra || 0), 0) : 0;
  if (keep > 0) {
    let free = 0;
    for (const h of homes) for (const id of s.projects[h.projectId]?.parts || []) { const b = s.structures[id]; if (b?.built && g.bDef(b)?.bed && !g.bDef(b).medical && (!b.owner || !s.colonists[b.owner])) free++; }
    if (free <= keep) return;
  }
  const bedsOf = (h) => (s.projects[h.projectId]?.parts || []).map((id) => s.structures[id]).filter((b) => b?.built && g.bDef(b)?.bed && !g.bDef(b).medical);
  const isFree = (b) => !b.owner || !s.colonists[b.owner];
  for (const home of homes) {
    if (s.tick - (home.lastBirth ?? -1e9) < (BIRTH.gapDays / growthOf(g)) * TICKS_PER_DAY) continue; // the Fast growth law halves the gap
    const beds = bedsOf(home);
    const adults = beds.map((b) => s.colonists[b.owner]).filter((c) => c && isAdult(g, c));
    if (adults.length < 2) continue;
    // The child sleeps in the family's home if a bed is free there, otherwise in any free bed of the village.
    let where = beds.find(isFree) ? home : null;
    let bed = where ? beds.find(isFree) : null;
    if (!bed) for (const h of homes) { const b = bedsOf(h).find(isFree); if (b) { where = h; bed = b; break; } }
    if (!bed) continue;
    // A divine blessing (godboons.js) multiplies the chance; the same single draw either way.
    const bl = g.s.god ? blessingOf(g, sid) : null;
    if (!g.rng.chance(Math.min(1, BIRTH.chancePerDay * (bl ? bl.growth : 1) * growthOf(g)))) continue; // the Fast growth law doubles it (worldlaws.js)
    birth(g, sid, where, bed, adults.slice(0, 2));
    home.lastBirth = s.tick;
    return; // one birth per settlement per day at most
  }
}

function birth(g, sid, home, bed, parents) {
  const s = g.s;
  const id = 'c' + s.nextId++;
  const folk = peopleOfSettlement(g, sid); // villages keep to one people, so the parents share it
  const pool = namePoolOf(g, 'Wren', folk); // the people's names (peoples.js), else the scenario's
  const used = usedNames(s); // the living and the dead (death.js)
  const free = pool.names.filter((n) => !used.has(n));
  // One rng draw either way (as before); a surname (a parent's first) when the first name is taken.
  const first = free.length ? free[g.rng.int(free.length)] : pool.names[g.rng.int(pool.names.length)];
  const family = surnameOf(pool, parents[0]?.name) || surnameOf(pool, parents[1]?.name);
  const name = uniqueName(pool, used, first, id, family, !family);
  const sk = {};
  for (const k of g.reg.all('skill')) sk[k.id] = 0;
  const nd = {};
  for (const n of g.reg.all('need')) nd[n.id] = 1;
  s.colonists[id] = {
    id, settlementId: sid, name, color: parents[0].color, look: inheritLook(`${s.seed}:born:${id}`, parents[0].look, parents[1]?.look, paletteOf(g, folk)), // each part from a parent
    x: bed.x, y: bed.y, mv: null, skills: sk, xp: {}, needs: nd, carry: null, equip: { tool: null, weapon: null },
    homeId: home.id, bedId: bed.id, job: null, workOff: {}, lastWork: null, sleeping: true,
    idle: 0, status: { goal: 'Newborn', action: 'Sleeping', target: '', blocker: '' }, workCount: {},
    stage: stages(g)[0].id, bornTick: s.tick, parents: parents.map((p) => p.id), quals: [], education: 0, health: { injuries: [] },
  };
  if (folk) { s.colonists[id].people = folk; s.colonists[id].traits = inheritTraits(g, `${s.seed}:${id}`, parents, folk); }
  g.ownAdd('colonists', s.colonists[id]);
  bed.owner = id;
  home.owners.push(id);
  home.lastBirth = s.tick;
  g.log(`A child, ${name}, was born to ${parents[0].name} and ${parents[1].name} in the ${home.name}.`, 'good');
}

/** Settlement head-count by stage, for the UI and milestones. */
export function populationOf(g, sid) {
  const out = { total: 0, byStage: {} };
  for (const c of Object.values(g.s.colonists)) {
    if ((c.settlementId || g.s.playerSettlement) !== sid) continue;
    out.total++;
    const st = stageOf(g, c).name;
    out.byStage[st] = (out.byStage[st] || 0) + 1;
  }
  return out;
}
