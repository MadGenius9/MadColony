// Medical care (built on health.js). Wounds that are not dressed can become infected; infections get worse
// until treated with medicine. Doctors (the Doctoring work type, faster with Medicine skill) find patients,
// carry collapsed people to a free medical bed, and treat them with bandages and medicine fetched from a
// medicine cabinet or the stockpile. Supplies are ordinary items made by recipes; nothing is free. Without
// supplies a doctor can only clean a wound (first aid). Without a doctor, the existing tending (feeding,
// dressing) still happens. Reservations ("patient:", "medbed:") keep two doctors off the same patient or bed.
import { TICKS_PER_HOUR } from './constants.js';
import { injure, isDown, hpOf, HEALTH } from './health.js';
import { newJob, travel, workSpeed, practice } from './ai/jobs.js';
import { octile } from './util.js';
import { fuelLoaded } from './power.js';

export const MED = {
  woundKinds: ['wound', 'injury'], // what bandages are for
  minSeverity: 4, // smaller scrapes need nothing
  infectAfterHours: 6, // undressed wounds older than this may get infected
  infectPerHour: 0.02, // chance per hour for each undressed wound
  cleanedFactor: 0.3, // first aid (cleaning) cuts that chance
  restingFight: 0.5, // an untreated infection heals at this share while the patient rests in bed or is tended
  infectionGrowth: 1.2, // severity per hour while untreated
  treatedHeal: 1.6, // dressed wounds and treated infections heal this much faster
  treatTicks: 60, // work per treatment
  // Phase 5 slice 4: lasting injuries. A wound of at least scarAt severity is deep; if it heals without surgery it
  // leaves a lasting injury (LASTING, picked by hash). Surgery: dressing a deep wound while the patient lies in a
  // medical bed; it mends the wound with chance surgeryBase + surgeryPerSkill x the doctor's Medicine skill.
  scarAt: 30, surgeryBase: 0.45, surgeryPerSkill: 0.07,
};

/** Lasting injuries and the work they slow (multipliers by work type; others unchanged). */
export const LASTING = [
  { kind: 'lame_leg', name: 'Lame leg', work: { 'core:construct': 0.85, 'core:haul': 0.8, 'core:farm': 0.9, 'core:chop': 0.9, 'core:mine': 0.9, 'core:forage': 0.85 } },
  { kind: 'bad_hand', name: 'Crippled hand', work: { 'core:craft': 0.8, 'core:construct': 0.85, 'core:cook': 0.9, 'core:doctor': 0.85, 'core:chop': 0.9 } },
];
const hashKey = (str) => {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};

/** health.js tickHealth: a deep wound healed without surgery leaves a lasting injury (c.lasting, save format 18). */
export function scarFrom(g, c, inj) {
  if (!inj.deep || inj.mended) return null;
  const L = LASTING[hashKey(`${g.s.seed}:lasting:${inj.id}`) % LASTING.length];
  c.lasting ||= [];
  if (c.lasting.some((x) => x.kind === L.kind)) return null;
  const rec = { kind: L.kind, since: g.s.tick, cause: String(inj.cause || '').slice(0, 80) };
  c.lasting.push(rec);
  g.log(`${c.name}'s wound healed badly: ${L.name.toLowerCase()} (${String(inj.cause || 'a wound').toLowerCase()}).`, 'warn');
  return rec;
}

/** Work speed with lasting injuries (jobs.js workSpeed). O(lasting injuries); 1 without any. */
export function lastingFactor(c, workType) {
  if (!c.lasting?.length || !workType) return 1;
  let f = 1;
  for (const x of c.lasting) { const L = LASTING.find((l) => l.kind === x.kind); if (L?.work[workType]) f *= L.work[workType]; }
  return f;
}

const sidOf = (g, c) => c.settlementId || g.s.playerSettlement;
const medTag = (g, item) => g.reg.get('item', item)?.tags || [];

/** A doctor operates on a deep wound of a patient in a medical bed: mended (no lasting injury) by chance from skill. */
export function surgery(g, c, p, inj) {
  const chance = Math.min(0.95, MED.surgeryBase + MED.surgeryPerSkill * (c.skills?.['core:medicine'] || 0));
  inj.mended = hashKey(`${g.s.seed}:surgery:${inj.id}`) / 4294967296 < chance;
  g.log(inj.mended ? `${c.name} operated on ${p.name}: the wound will heal clean.` : `${c.name} operated on ${p.name}, but could not save the ${String(inj.cause || 'wound').toLowerCase()} from leaving a mark.`, inj.mended ? 'good' : 'warn');
}

/** What a colonist needs from a doctor right now: [{ inj, need: 'bandage'|'medicine' }]. */
export function treatmentNeeds(g, c) {
  const out = [];
  for (const i of c.health?.injuries || []) {
    if (i.treated) continue;
    if (i.kind === 'infection' || (i.kind === 'sickness' && !i.over)) out.push({ inj: i, need: 'medicine' }); // illness: illness.js
    else if (MED.woundKinds.includes(i.kind) && i.severity >= MED.minSeverity) out.push({ inj: i, need: 'bandage' });
  }
  return out;
}
/** Medical beds of a settlement, and who occupies them. */
export function medicalBeds(g, sid) {
  const beds = g.owned('structures', sid).filter((st) => st.built && g.bDef(st)?.medical);
  const used = new Set(Object.values(g.s.colonists).map((c) => c.medBedId).filter(Boolean));
  return { beds, free: beds.filter((b) => !used.has(b.id) && !g.isReserved('medbed:' + b.id)), used };
}
/** Count of an item kind (by tag) available to a settlement: stockpile stacks and medicine cabinets. */
export function supplyCount(g, sid, tag) {
  let n = 0;
  for (const st of g.owned('stacks', sid)) if (medTag(g, st.item).includes(tag)) n += Math.max(0, g.availQty(st.id));
  for (const b of g.owned('structures', sid)) if (b.built && g.bDef(b)?.supplies) for (const f of b.fuel || []) if (medTag(g, f.item).includes(tag)) n += f.qty;
  return n;
}
/** The nearest source of one supply (a stack or a cabinet holding it), or null. */
function findSupply(g, c, tag) {
  let best = null, bd = Infinity;
  for (const st of Object.values(g.s.stacks)) {
    if (!g.mine(st, c) || !medTag(g, st.item).includes(tag) || g.availQty(st.id) < 1 || !g.canReach(c, st.x, st.y, 'on')) continue;
    const d = octile(c.x, c.y, st.x, st.y);
    if (d < bd) { bd = d; best = { stackId: st.id, x: st.x, y: st.y, item: st.item, mode: 'on' }; }
  }
  for (const b of Object.values(g.s.structures)) {
    if (!b.built || !g.bDef(b)?.supplies || !g.mine(b, c)) continue;
    const f = (b.fuel || []).find((x) => x.qty > 0 && medTag(g, x.item).includes(tag));
    if (!f || g.isReserved('cab:' + b.id + ':' + f.item, c.id) || !g.canReach(c, b.x, b.y, 'adj')) continue;
    const d = octile(c.x, c.y, b.x, b.y) - 3; // prefer the clinic's cabinet
    if (d < bd) { bd = d; best = { cabinetId: b.id, x: b.x, y: b.y, item: f.item, mode: 'adj' }; }
  }
  return best;
}

/** Per tick (from tickHealth's step): infections start in undressed wounds and grow while untreated. */
export function tickInfection(g, c, frac) {
  const inj = c.health?.injuries;
  if (!inj?.length) return;
  for (const i of [...inj]) {
    if (i.kind === 'infection' && !i.treated && !restingOrTended(g, c)) i.severity = Math.min(100, Math.round((i.severity + MED.infectionGrowth * frac) * 100) / 100);
    if (!MED.woundKinds.includes(i.kind) || i.treated || i.infected || i.severity < MED.minSeverity) continue;
    if (g.s.tick - (i.tick || 0) < MED.infectAfterHours * TICKS_PER_HOUR) continue;
    const p = MED.infectPerHour * frac * (i.cleaned ? MED.cleanedFactor : 1);
    if (g.rng.next() < p) {
      i.infected = true;
      injure(g, c, 'infection', 5, `Infected wound (${i.cause.toLowerCase()})`);
    }
  }
}
/** Resting in a bed (or collapsed in a medical bed), or tended by someone: the body can fight an infection. */
const restingOrTended = (g, c) => (c.sleeping && !!c.job?.bedId) || !!c.medBedId || (c.health?.tendedUntil || 0) > g.s.tick;
/** Healing multiplier for one injury: treated ones heal faster; an untreated infection heals only slowly, and
 *  only while the patient rests or is tended (medicine is much better, but not the only way to survive). */
export function healFactor(i, g, c) {
  if (i.kind === 'infection' && !i.treated) return g && c && restingOrTended(g, c) ? MED.restingFight : 0;
  return i.treated ? MED.treatedHeal : 1;
}
/** Extra healing in a medical bed. */
export function bedFactor(g, c) {
  const b = c.medBedId && g.s.structures[c.medBedId];
  return b ? (g.bDef(b)?.medical?.heal || 1) : 1;
}

// ---------------- job givers ----------------
export const MEDICAL_GIVERS = {
  // Carry a collapsed patient to a free medical bed.
  'core:rescue': {
    find(g, c, params, wt) {
      if (isDown(c)) return [];
      const sid = sidOf(g, c);
      const { free } = medicalBeds(g, sid);
      if (!free.length) return [];
      const out = [];
      for (const p of Object.values(g.s.colonists)) {
        if (p.id === c.id || sidOf(g, p) !== sid || !isDown(p) || p.medBedId || p.carriedBy) continue;
        const key = 'patient:' + p.id;
        if (g.isReserved(key, c.id) || g.isBlocked(key) || !g.canReach(c, p.x, p.y, 'adj')) continue;
        const bed = free.slice().sort((a, b) => octile(p.x, p.y, a.x, a.y) - octile(p.x, p.y, b.x, b.y)).find((b) => g.reachableFrom(p.x, p.y, b.x, b.y, 'on') || g.canReach(c, b.x, b.y, 'on'));
        if (!bed) continue;
        out.push({
          x: p.x, y: p.y, urgency: 3.6, label: `Carry ${p.name} to a medical bed`, // before treatment: treat them in the bed
          make: () => {
            const job = newJob('rescue', { patientId: p.id, bedId: bed.id, stage: 'go' }, { why: `${p.name} has collapsed`, label: `Carry ${p.name} to the clinic`, targetKey: key, workType: wt.id });
            if (!g.reserveExcl(job, key, c.id)) return null;
            if (!g.reserveExcl(job, 'medbed:' + bed.id, c.id)) { g.release(job); return null; }
            return job;
          },
        });
      }
      return out;
    },
  },
  // Dress wounds and treat infections, fetching the supplies first; first aid when there are none.
  'core:treat': {
    find(g, c, params, wt) {
      if (isDown(c)) return [];
      const sid = sidOf(g, c);
      const out = [];
      for (const p of Object.values(g.s.colonists)) {
        if (sidOf(g, p) !== sid || p.carriedBy) continue;
        const needs = treatmentNeeds(g, p);
        if (!needs.length) continue;
        if (p.id === c.id && isDown(p)) continue;
        const key = 'patient:' + p.id;
        if (g.isReserved(key, c.id) || g.isBlocked(key) || !g.canReach(c, p.x, p.y, 'adj')) continue;
        const first = needs.sort((a, b) => (b.need === 'medicine') - (a.need === 'medicine') || b.inj.severity - a.inj.severity)[0];
        const supply = findSupply(g, c, first.need === 'medicine' ? 'core:medicine' : 'core:bandage');
        // Without supplies only cleaning is possible, and only once per wound.
        if (!supply && (first.need === 'medicine' || first.inj.cleaned)) continue;
        const urg = (isDown(p) ? 1.6 : 1.0) + (first.need === 'medicine' ? 0.4 : 0) + first.inj.severity / 100;
        out.push({
          x: p.x, y: p.y, urgency: urg, label: `Treat ${p.name}`,
          make: () => {
            const job = newJob('treat', { patientId: p.id, injId: first.inj.id, treatNeed: first.need, supply, stage: supply ? 'fetch' : 'go', prog: 0 },
              { why: `${p.name}: ${first.need === 'medicine' ? 'infection' : 'wound'} (${Math.round(first.inj.severity)}%)`, label: supply ? `Treat ${p.name}` : `First aid for ${p.name}`, targetKey: key, workType: wt.id });
            if (!g.reserveExcl(job, key, c.id)) return null;
            if (supply?.stackId && !g.reserveQty(job, supply.stackId, 1)) { g.release(job); return null; }
            if (supply?.cabinetId && !g.reserveExcl(job, 'cab:' + supply.cabinetId + ':' + supply.item, c.id)) { g.release(job); return null; }
            return job;
          },
        });
      }
      return out;
    },
  },
};

function go(g, c, j, x, y, mode, what) {
  const r = travel(g, c, j, x, y, mode, what);
  if (r === true) return 'arrived';
  if (r === false) return 'moving';
  return r;
}

// ---------------- job drivers ----------------
export const MEDICAL_DRIVERS = {
  rescue: {
    valid(g, c, j) { const p = g.s.colonists[j.patientId]; return !!p && isDown(p) && !!g.s.structures[j.bedId]?.built; },
    tick(g, c, j) {
      const p = g.s.colonists[j.patientId], bed = g.s.structures[j.bedId];
      if (!p || !isDown(p)) return 'done';
      if (!bed?.built) return { fail: 'The medical bed is gone' };
      if (j.stage === 'go') {
        const r = go(g, c, j, p.x, p.y, 'adj', p.name);
        if (r === 'moving') { c.status.action = `Going to ${p.name}`; return 'running'; }
        if (r !== 'arrived') return r;
        p.carriedBy = c.id; j.stage = 'carry';
        g.log(`${c.name} is carrying ${p.name} to the ${g.bDef(bed).name}.`, 'info');
      }
      const r = go(g, c, j, bed.x, bed.y, 'on', g.bDef(bed).name);
      p.x = c.x; p.y = c.y; p.mv = null; p.path = null; // carried along
      if (r === 'moving') { c.status.action = `Carrying ${p.name} to the clinic`; return 'running'; }
      if (r !== 'arrived') { p.carriedBy = null; return r; }
      p.x = bed.x; p.y = bed.y; p.carriedBy = null; p.medBedId = bed.id; p.sleeping = true;
      c.status.action = `Put ${p.name} in a medical bed`;
      return 'done';
    },
    cleanup(g, c, j) { const p = g.s.colonists[j.patientId]; if (p && p.carriedBy === c.id) p.carriedBy = null; },
  },
  treat: {
    valid(g, c, j) { return !!g.s.colonists[j.patientId]; },
    tick(g, c, j) {
      const p = g.s.colonists[j.patientId];
      const inj = p?.health?.injuries?.find((i) => i.id === j.injId);
      if (!p || !inj || inj.treated) return 'done';
      if (j.stage === 'fetch') {
        const s = j.supply;
        const r = go(g, c, j, s.x, s.y, s.mode, g.reg.get('item', s.item)?.name);
        if (r === 'moving') { c.status.action = `Fetching ${g.reg.get('item', s.item)?.name}`; return 'running'; }
        if (r !== 'arrived') return r;
        let got = null;
        if (s.stackId) { g.release(j, (x) => x.k === 'q' && x.key === s.stackId); got = g.takeFromStack(s.stackId, 1); }
        else {
          const cab = g.s.structures[s.cabinetId];
          const f = cab?.fuel?.find((x) => x.item === s.item && x.qty > 0);
          if (f) { f.qty -= 1; cab.fuel = cab.fuel.filter((x) => x.qty > 0); got = { item: s.item, qty: 1 }; }
        }
        if (!got) return { fail: `The ${g.reg.get('item', s.item)?.name} is gone`, cooldown: 100 };
        if (c.carry) g.placeItems(c.carry.item, c.carry.qty, c.x, c.y, c.carry.dur);
        c.carry = got; j.stage = 'go';
      }
      if (j.stage === 'go') {
        const r = go(g, c, j, p.x, p.y, p.id === c.id ? 'on' : 'adj', p.name);
        if (r === 'moving') { c.status.action = `Going to treat ${p.name}`; return 'running'; }
        if (r !== 'arrived') return r;
        j.stage = 'work';
      }
      j.prog += workSpeed(g, c, 'core:doctor', 'core:medicine');
      practice(g, c, 'core:doctor', 'core:medicine');
      c.status.action = `${j.supply ? 'Treating' : 'First aid for'} ${p.name} (${Math.min(100, Math.round((j.prog / MED.treatTicks) * 100))}%)`;
      if (j.prog < MED.treatTicks) return 'running';
      if (j.supply && c.carry) {
        g.consume(c.carry.item, 1, 'treatment');
        c.carry = c.carry.qty > 1 ? { ...c.carry, qty: c.carry.qty - 1 } : null;
        inj.treated = true;
        if (inj.deep && !inj.mended && p.medBedId) surgery(g, c, p, inj); // in a medical bed: surgery (slice 4)
        p.health.tendedUntil = Math.max(p.health.tendedUntil || 0, g.s.tick + HEALTH.tendHours * TICKS_PER_HOUR);
        g.log(inj.kind === 'sickness' ? `${c.name} treated ${p.name} for ${String(inj.cause).toLowerCase()}.` : `${c.name} ${j.treatNeed === 'medicine' ? 'treated the infection of' : 'dressed the wound of'} ${p.name}.`, 'good');
      } else {
        inj.cleaned = true;
        g.log(`${c.name} cleaned ${p.name}'s wound (no bandages: first aid only).`, 'warn', `firstaid:${p.id}`, 600);
      }
      return 'done';
    },
  },
};

/** Settlement overview for the UI and planner. */
export function medicalSummary(g, sid) {
  const cols = g.owned('colonists', sid);
  const patients = cols.filter((c) => isDown(c) || treatmentNeeds(g, c).length);
  const needs = patients.flatMap((c) => treatmentNeeds(g, c));
  const { beds, free } = medicalBeds(g, sid);
  const doctors = cols.filter((c) => !isDown(c) && !c.workOff?.['core:doctor']);
  const bandages = supplyCount(g, sid, 'core:bandage'), medicine = supplyCount(g, sid, 'core:medicine');
  const shortages = [];
  if (needs.some((n) => n.need === 'bandage') && !bandages) shortages.push('No bandages: wounds only get first aid');
  if (needs.some((n) => n.need === 'medicine') && !medicine) shortages.push('No medicine: infections cannot be treated');
  if (patients.some((c) => isDown(c) && !c.medBedId) && beds.length && !free.length) shortages.push('All medical beds are taken');
  if (patients.length && !doctors.length) shortages.push('Nobody may do Doctoring work');
  return { patients, needs, beds: beds.length, freeBeds: free.length, doctors: doctors.length, bandages, medicine, shortages, down: cols.filter(isDown).length };
}
export { fuelLoaded as suppliesLoaded, hpOf };
