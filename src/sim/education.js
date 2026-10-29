// Education and qualifications (Phase 5b/5c).
//
// Schools: children of a stage that `attendsSchool` study at a school desk during school hours. A teacher
// (anyone doing Teaching work; teaching skill and a teacher's qualification make them better) speeds
// learning up; without one, children still learn slowly on their own. At 100 they finish school and get
// the "schooled" qualification. Nobody needs a qualification to start teaching, so there is no
// chicken-and-egg problem.
//
// Qualifications are mod data (`qualification`): the work types they speed up, by how much, and how they
// are earned — by practice (a skill level) and/or a college course. Unqualified people still do all work
// (at the normal speed), so a missing specialist never stalls the colony.
//
// College: when a settlement lacks qualified staff (doctors, teachers, industrial specialists) and has a
// lecture hall, one schooled adult at a time is sent to train; an instructor at the lectern speeds it up.
import { TICKS_PER_DAY, TICKS_PER_HOUR } from './constants.js';
import { newJob, travel, workSpeed, practice } from './ai/jobs.js';
import { interactionSpot } from './construction.js';
import { octile } from './util.js';
import { isDown } from './health.js';
import { civLawIs } from './civlaws.js';

export const EDU = {
  school: [8, 15], college: [8, 17], // hours
  studyRate: 0.045, selfStudy: 0.3, // education points per tick with a teacher of quality 1, and the share without one
  trainRate: 0.03, selfTrain: 0.5,
  teachSession: 300,
};

const sidOf = (g, c) => c.settlementId || g.s.playerSettlement;
const hour = (g) => (g.s.tick % TICKS_PER_DAY) / TICKS_PER_HOUR;
export const inHours = (g, [a, b]) => hour(g) >= a && hour(g) < b;
const stageOf = (g, c) => g.reg.get('lifeStage', c.stage);
const isAdult = (g, c) => { const st = stageOf(g, c); return !st || st.untilDays === undefined; };
const roleOf = (g, st) => g.bDef(st)?.education?.role;
/** Structures with an education role (school desk, lectern, bench), in Object.values order (game.js structsWhere:
 *  cached until structures change), so finding a desk on a big world does not scan every structure in it. */
const eduDesks = (g) => (g.big ? g.structsWhere('eduRole', (st) => !!roleOf(g, st)) : Object.values(g.s.structures)); // classic worlds: the scan, as before

// ---------------- qualifications ----------------
export const qualsOf = (c) => c.quals || [];
export const hasQual = (c, id) => qualsOf(c).includes(id);
/** Work speed multiplier from a colonist's qualifications for one work type (1 when unqualified). */
export function qualSpeed(g, c, workType) {
  let m = 1;
  for (const q of qualsOf(c)) { const d = g.reg.get('qualification', q); if (d?.workTypes?.includes(workType)) m = Math.max(m, d.speed || 1); }
  return m;
}
/** Name of a colonist's profession: their most specific qualification, if any. */
export function professionOf(g, c) {
  const qs = qualsOf(c).map((q) => g.reg.get('qualification', q)).filter((d) => d?.workTypes?.length);
  return qs.length ? qs.map((d) => d.name).join(', ') : null;
}
export function grantQual(g, c, id, how) {
  if (hasQual(c, id)) return;
  c.quals = [...qualsOf(c), id];
  g.log(`${c.name} ${how === 'school' ? 'finished school' : how === 'practice' ? `is now a qualified ${g.reg.get('qualification', id)?.name} through practice` : `qualified as ${g.reg.get('qualification', id)?.name} at college`}.`, 'good');
}

// ---------------- staffing ----------------
/** How many qualified people a settlement should have per qualification, and how many it has. */
export function staffing(g, sid) {
  const s = g.s;
  const people = g.owned('colonists', sid);
  const adults = people.filter((c) => isAdult(g, c) && !isDown(c));
  const mine = g.owned('structures', sid);
  const out = [];
  for (const q of g.reg.all('qualification')) {
    if (!q.workTypes?.length) continue;
    let want = 0;
    if (q.staffing === 'perPeople') want = Math.ceil(people.length / (q.per || 8));
    else if (q.staffing === 'school') want = mine.some((st) => st.built && roleOf(g, st) === 'teacher') ? 1 : 0;
    else if (q.staffing === 'machines') want = mine.some((st) => st.built && g.bDef(st)?.power?.use > 0 && g.bDef(st).category === 'station' && !g.bDef(st).heat && !g.bDef(st).water) ? 1 : 0;
    const have = adults.filter((c) => hasQual(c, q.id)).length;
    out.push({ qual: q.id, name: q.name, want, have, short: Math.max(0, want - have) });
  }
  return out;
}

/** Children who should be at school now or soon. */
export function pupils(g, sid) {
  return g.owned('colonists', sid).filter((c) => stageOf(g, c)?.attendsSchool && !hasQual(c, 'core:schooled'));
}

// ---------------- daily upkeep ----------------
/** Practice earns qualifications; founders count as schooled; colleges get a trainee when staff are short. */
export function tickEducation(g) {
  if (g.s.tick % 100) return;
  const s = g.s;
  const schooled = g.reg.get('qualification', 'core:schooled');
  for (const c of Object.values(s.colonists)) {
    if (schooled && isAdult(g, c) && (c.bornTick === undefined || c.bornTick === null) && !hasQual(c, schooled.id)) c.quals = [...qualsOf(c), schooled.id]; // grew up elsewhere
    if (!isAdult(g, c)) continue;
    for (const q of g.reg.all('qualification')) {
      if (!q.practice || hasQual(c, q.id)) continue;
      if ((c.skills[q.practice.skill] || 0) >= q.practice.level) grantQual(g, c, q.id, 'practice');
    }
  }
  for (const st of Object.values(s.settlements || {})) assignTrainee(g, st.id);
}

function assignTrainee(g, sid) {
  const s = g.s, st = s.settlements[sid];
  const tr = st.training;
  if (tr) {
    const c = s.colonists[tr.cid];
    if (!c || hasQual(c, tr.qual) || !isAdult(g, c)) st.training = null;
    else return;
  }
  const hall = g.owned('structures', sid).some((b) => b.built && roleOf(g, b) === 'lectern');
  if (!hall) return;
  const short = staffing(g, sid).filter((x) => x.short > 0 && g.reg.get('qualification', x.qual)?.course);
  if (!short.length) return;
  const q = g.reg.get('qualification', short[0].qual);
  const cands = g.owned('colonists', sid).filter((c) => isAdult(g, c) && !isDown(c) && !hasQual(c, q.id) && (q.requires || []).every((r) => hasQual(c, r)));
  if (!cands.length) return;
  const skill = q.practice?.skill;
  cands.sort((a, b) => (b.skills[skill] || 0) - (a.skills[skill] || 0) || (a.id < b.id ? -1 : 1));
  st.training = { cid: cands[0].id, qual: q.id, progress: 0, since: s.tick };
  g.log(`${cands[0].name} will train as ${q.name} at the lecture hall (the colony is short of one).`, 'goal');
}

// ---------------- jobs ----------------
const teacherAt = (g, st) => {
  for (const o of Object.values(g.s.colonists)) {
    const j = o.job;
    if (j?.type !== 'teach' || j.stage !== 'work' || o.mv) continue;
    const d = g.s.structures[j.deskId];
    if (d && d.projectId === st.projectId) return o;
  }
  return null;
};
const quality = (g, t) => (t ? (0.6 + 0.08 * (t.skills['core:teaching'] || 0)) * qualSpeed(g, t, 'core:teach') : 0);
function go(g, c, j, x, y, what) { const r = travel(g, c, j, x, y, 'on', what); return r === true ? 'arrived' : r === false ? 'moving' : r; }

export const EDUCATION_GIVERS = {
  // Teach at a school (when there are pupils) or at a lecture hall (when someone is training).
  'core:teach': {
    find(g, c, params, wt) {
      if (!isAdult(g, c)) return [];
      const sid = sidOf(g, c);
      const out = [];
      const st0 = g.s.settlements[sid];
      for (const desk of eduDesks(g)) {
        const role = roleOf(g, desk);
        if (!desk.built || (role !== 'teacher' && role !== 'lectern') || !g.mine(desk, c)) continue;
        if (role === 'teacher' && (!inHours(g, EDU.school) || !pupils(g, sid).length)) continue;
        if (role === 'lectern' && (!inHours(g, EDU.college) || !st0?.training || st0.training.cid === c.id)) continue;
        const key = 'teach:' + desk.id;
        if (g.isReserved(key, c.id) || g.isBlocked(key)) continue;
        const spot = interactionSpot(g, desk);
        if (!g.canReach(c, spot.x, spot.y, 'on')) continue;
        out.push({ x: spot.x, y: spot.y, urgency: 0.9, label: role === 'teacher' ? 'Teach at the school' : 'Teach at the lecture hall', make: () => {
          const job = newJob('teach', { deskId: desk.id, stage: 'go', session: 0 }, { why: role === 'teacher' ? 'The children need a teacher' : 'A trainee needs an instructor', label: role === 'teacher' ? 'Teach' : 'Instruct', targetKey: key, workType: wt.id });
          return g.reserveExcl(job, key, c.id) ? job : null;
        } });
      }
      return out;
    },
  },
  // Children go to school during school hours.
  'core:attend': {
    find(g, c, params, wt) {
      if (!stageOf(g, c)?.attendsSchool || hasQual(c, 'core:schooled') || !inHours(g, EDU.school)) return [];
      if (civLawIs(g, sidOf(g, c), 'core:schooling', 'child_labour')) return []; // child labour: no school (civlaws.js)
      return deskCandidates(g, c, wt, 'desk', 'study', 'Go to school', 1.6);
    },
  },
  // The settlement's trainee goes to college.
  'core:train': {
    find(g, c, params, wt) {
      const tr = g.s.settlements[sidOf(g, c)]?.training;
      if (!tr || tr.cid !== c.id || !inHours(g, EDU.college)) return [];
      return deskCandidates(g, c, wt, 'bench', 'train', `Train as ${g.reg.get('qualification', tr.qual)?.name}`, 1.4);
    },
  },
};
function deskCandidates(g, c, wt, role, type, label, urgency) {
  let best = null, bd = Infinity;
  for (const desk of eduDesks(g)) {
    if (!desk.built || roleOf(g, desk) !== role || !g.mine(desk, c)) continue;
    const key = 'desk:' + desk.id;
    if (g.isReserved(key, c.id)) continue;
    const spot = interactionSpot(g, desk);
    const d = octile(c.x, c.y, spot.x, spot.y);
    if (d < bd && g.canReach(c, spot.x, spot.y, 'on')) { bd = d; best = { desk, spot, key }; }
  }
  if (!best) return [];
  return [{ x: best.spot.x, y: best.spot.y, urgency, label, make: () => {
    const job = newJob(type, { deskId: best.desk.id, stage: 'go' }, { why: label, label, targetKey: best.key, workType: wt.id });
    return g.reserveExcl(job, best.key, c.id) ? job : null;
  } }];
}

export const EDUCATION_DRIVERS = {
  teach: {
    valid(g, c, j) { return !!g.s.structures[j.deskId]?.built; },
    tick(g, c, j) {
      const desk = g.s.structures[j.deskId];
      const role = roleOf(g, desk);
      const spot = interactionSpot(g, desk);
      if (j.stage === 'go') { const r = go(g, c, j, spot.x, spot.y, g.bDef(desk).name); if (r !== 'arrived') return r === 'moving' ? 'running' : r; j.stage = 'work'; }
      if (!inHours(g, role === 'lectern' ? EDU.college : EDU.school)) return 'done';
      practice(g, c, 'core:teach', 'core:teaching');
      const n = Object.values(g.s.colonists).filter((o) => (o.job?.type === 'study' || o.job?.type === 'train') && g.s.structures[o.job.deskId]?.projectId === desk.projectId && o.job.stage === 'work').length;
      c.status.action = role === 'lectern' ? `Instructing (${n} trainee${n === 1 ? '' : 's'})` : `Teaching (${n} pupil${n === 1 ? '' : 's'})`;
      j.idle = n ? 0 : (j.idle || 0) + 1;
      return ++j.session >= EDU.teachSession || j.idle > 120 ? 'done' : 'running';
    },
  },
  study: {
    valid(g, c, j) { return !!g.s.structures[j.deskId]?.built; },
    tick(g, c, j) {
      const desk = g.s.structures[j.deskId], spot = interactionSpot(g, desk);
      if (j.stage === 'go') { const r = go(g, c, j, spot.x, spot.y, 'school'); if (r !== 'arrived') return r === 'moving' ? 'running' : r; j.stage = 'work'; }
      if (!inHours(g, EDU.school) || hasQual(c, 'core:schooled')) return 'done';
      const t = teacherAt(g, desk);
      c.education = Math.min(100, Math.round(((c.education || 0) + EDU.studyRate * (t ? quality(g, t) : EDU.selfStudy)) * 1000) / 1000);
      c.status.action = t ? `At school with ${t.name} (${Math.floor(c.education)}%)` : `Studying alone (${Math.floor(c.education)}%)`;
      if (c.education >= 100) { grantQual(g, c, 'core:schooled', 'school'); return 'done'; }
      return 'running';
    },
  },
  train: {
    valid(g, c, j) { return !!g.s.structures[j.deskId]?.built; },
    tick(g, c, j) {
      const desk = g.s.structures[j.deskId], spot = interactionSpot(g, desk);
      const tr = g.s.settlements[sidOf(g, c)]?.training;
      if (!tr || tr.cid !== c.id) return 'done';
      if (j.stage === 'go') { const r = go(g, c, j, spot.x, spot.y, 'the lecture hall'); if (r !== 'arrived') return r === 'moving' ? 'running' : r; j.stage = 'work'; }
      if (!inHours(g, EDU.college)) return 'done';
      const t = teacherAt(g, desk);
      tr.progress = Math.min(100, Math.round((tr.progress + EDU.trainRate * (t ? quality(g, t) : EDU.selfTrain)) * 1000) / 1000);
      const q = g.reg.get('qualification', tr.qual);
      c.status.action = `Training as ${q?.name} (${Math.floor(tr.progress)}%)${t ? ` with ${t.name}` : ''}`;
      if (tr.progress >= 100) { grantQual(g, c, tr.qual, 'college'); g.s.settlements[sidOf(g, c)].training = null; return 'done'; }
      return 'running';
    },
  },
};

/** Settlement overview for the UI. */
export function educationSummary(g, sid) {
  const kids = pupils(g, sid);
  const atSchool = kids.filter((c) => c.job?.type === 'study');
  const teachers = Object.values(g.s.colonists).filter((c) => sidOf(g, c) === sid && c.job?.type === 'teach');
  const tr = g.s.settlements[sid]?.training;
  return {
    pupils: kids.length, atSchool: atSchool.length, teachers: teachers.map((t) => t.name),
    training: tr ? { name: g.s.colonists[tr.cid]?.name, qual: g.reg.get('qualification', tr.qual)?.name, progress: tr.progress } : null,
    staffing: staffing(g, sid),
  };
}
export { workSpeed };
