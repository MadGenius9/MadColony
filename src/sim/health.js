// Colonist health (groundwork for water quality, combat and other hazards).
// A colonist carries a list of injuries and conditions, each with a severity and a recorded cause;
// health = 100 − the total. Starving and exhaustion cause conditions; work accidents (per work type,
// mod data `hazard`) cause injuries. Injured colonists work more slowly, rest in bed below
// HEALTH.restBelow, and collapse at HEALTH.downAt until they recover to HEALTH.upAt. Others tend them:
// bring food if they are hungry and dress their wounds (faster healing for a while).
// At 0% health for HEALTH.deathAfterHours a colonist dies (death.js, Phase 5). Everything here is saved on the colonist.
import { tickInfection, healFactor, bedFactor, scarFrom, MED } from './medical.js';
import { TICKS_PER_HOUR } from './constants.js';
import { coldUnder, lifeRules } from './life.js';
import { tickSickness } from './illness.js';
import { modsOf } from './peoples.js';

export const HEALTH = {
  restBelow: 60, // rest in bed below this
  restUntil: 85,
  downAt: 15, // collapse at or below this
  upAt: 35, // get up again at or above this
  healAwake: 0.5, healGround: 1.0, healBed: 2.2, // severity healed per hour
  tendedFactor: 2, tendHours: 12,
  starvePerHour: 2.5, exhaustPerHour: 1.5, dehydratePerHour: 3,
  deathAfterHours: 6, // at 0% health this long (collapsed, so rescue and care still have a chance): death (death.js)
};
const STEP = 25; // ticks between health updates

export const hpOf = (c) => Math.max(0, Math.round(100 - (c.health?.injuries || []).reduce((a, i) => a + i.severity, 0)));
export const isDown = (c) => !!c.health?.down;

/** Work speed factor from health: 1 when healthy, down to 0.35 near collapse. */
export function workFactor(c) {
  const hp = hpOf(c);
  return hp >= 100 ? 1 : 0.35 + (0.65 * hp) / 100;
}

/** Add an injury, or worsen an ongoing condition of the same kind (malnutrition, exhaustion). */
export function injure(g, c, kind, severity, cause, ongoing = false, logCat = 'warn') {
  c.health ||= { injuries: [] };
  const list = c.health.injuries;
  let inj = ongoing ? list.find((i) => i.kind === kind) : null;
  if (inj) inj.severity = Math.min(100, inj.severity + severity);
  else {
    inj = { id: g.newId('inj'), kind, severity: Math.min(100, Math.round(severity * 10) / 10), cause, tick: g.s.tick };
    if (MED.woundKinds.includes(kind) && inj.severity >= MED.scarAt) inj.deep = true; // may leave a lasting injury (medical.js)
    list.push(inj);
    g.log(`${c.name}: ${cause} (${Math.round(inj.severity)}% injury).`, logCat);
  }
  checkDown(g, c);
  return inj;
}

function checkDown(g, c) {
  const hp = hpOf(c);
  if (!c.health.down && hp <= HEALTH.downAt) {
    c.health.down = true;
    c.health.downSince = g.s.tick;
    c.health.wasDown = true;
    g.log(`${c.name} has collapsed (health ${hp}%) and needs care.`, 'warn');
  } else if (c.health.down && hp >= HEALTH.upAt) {
    c.health.down = false;
    c.medBedId = null; // up again: the medical bed is free for the next patient
    g.log(`${c.name} is back on their feet (health ${hp}%).`, 'info');
  }
}

/** Every quarter hour: conditions from hunger and exhaustion, healing, collapsing and getting up.
 *  `force` runs one step regardless of the tick (abstract villages run four steps per game hour). */
export function tickHealth(g, c, force = false) {
  if (!force && g.s.tick % STEP) return;
  const frac = STEP / TICKS_PER_HOUR;
  const hunger = g.reg.all('need').find((n) => n.behavior === 'core:eat');
  const energy = g.reg.all('need').find((n) => n.behavior === 'core:sleep');
  const fed = !hunger || (c.needs[hunger.id] ?? 1) > 0.2;
  const rested = !energy || (c.needs[energy.id] ?? 1) > 0.3;
  const thirst = g.reg.all('need').find((n) => n.behavior === 'core:drink');
  const watered = !thirst || (c.needs[thirst.id] ?? 1) > 0.3;
  if (thirst && (c.needs[thirst.id] ?? 1) <= 0) injure(g, c, 'dehydration', HEALTH.dehydratePerHour * frac, 'Dehydrated', true);
  if (hunger && (c.needs[hunger.id] ?? 1) <= 0) injure(g, c, 'malnutrition', HEALTH.starvePerHour * frac, 'Starving', true);
  if (energy && (c.needs[energy.id] ?? 1) <= 0.01 && !c.sleeping) injure(g, c, 'exhaustion', HEALTH.exhaustPerHour * frac, 'Collapsing from exhaustion', true);
  const cold = coldUnder(g, c); // scenarios with cold rules (life.js): degrees below the freezing line where they are
  if (cold > 0) injure(g, c, 'hypothermia', lifeRules(g).cold.perHour * cold * frac, 'Freezing', true);
  if (c.grief && c.grief.until <= g.s.tick) delete c.grief; // mourning is over (burial.js)
  if (!c.health?.injuries?.length) return;
  tickInfection(g, c, frac);
  tickSickness(g, c, frac); // contagious illness runs its course (illness.js)
  const inBed = (c.sleeping && c.job?.bedId) || (c.health.down && c.medBedId);
  let rate = inBed ? HEALTH.healBed : (c.sleeping || c.health.down) ? HEALTH.healGround : HEALTH.healAwake;
  if ((c.health.tendedUntil || 0) > g.s.tick) rate *= HEALTH.tendedFactor;
  rate *= bedFactor(g, c) * modsOf(g, c).heal; // hardy and sickly people (peoples.js)
  if (c.health.down && hpOf(c) === 0 && !cared(g, c)) rate = 0; // bleeding out: at 0% only care lets them heal
  for (const i of c.health.injuries) {
    if (i.kind === 'malnutrition' && !fed) continue; // only food cures hunger
    if (i.kind === 'exhaustion' && !rested) continue;
    if (i.kind === 'dehydration' && !watered) continue; // only water cures thirst
    if (i.kind === 'hypothermia' && cold > 0) continue; // only warmth cures the cold
    if (i.kind === 'sickness' && !i.over) continue; // an illness grows until its course is over (illness.js)
    i.severity = Math.max(0, Math.round((i.severity - rate * healFactor(i, g, c) * frac) * 100) / 100);
  }
  const healed = c.health.injuries.filter((i) => i.severity <= 0);
  for (const i of healed) if (i.kind === 'infection') g.log(`${c.name}'s infection has cleared up.`, 'info', `healed:${i.id}`, 1);
  for (const i of healed) if (i.deep) scarFrom(g, c, i); // a deep wound healed without surgery (medical.js)
  for (const i of healed) if (i.kind === 'injury') g.log(`${c.name} has recovered (${i.cause.toLowerCase()}).`, 'info', `healed:${i.id}`, 1);
  c.health.injuries = c.health.injuries.filter((i) => i.severity > 0);
  checkDown(g, c);
  checkDeath(g, c);
}

/** End of tickHealth: note when health first reached 0, and mark the colonist to die once it has stayed there long
 *  enough. Read-only apart from c.health.zeroSince and the derived g._dying set. O(1) per call. */
function checkDeath(g, c) {
  const h = c.health;
  if (!h) return;
  if (hpOf(c) > 0) { if (h.zeroSince !== undefined) delete h.zeroSince; return; }
  if (h.zeroSince === undefined) h.zeroSince = g.s.tick;
  if (g.s.tick - h.zeroSince >= HEALTH.deathAfterHours * TICKS_PER_HOUR && !g._dying?.has(c.id)) (g._dying ||= new Map()).set(c.id, null); // cause: their worst injury
}

/** At 0% health, is anyone caring for a collapsed colonist? Tended now, in a medical bed, or a wound already
 *  dressed or cleaned (first aid). In a village simulated at a distance (no carers walk there, lod.js) anyone else
 *  of the village on their feet counts. Only called at 0% health, so its cost does not matter. */
export function cared(g, c) {
  if ((c.health.tendedUntil || 0) > g.s.tick || c.medBedId) return true;
  if (c.health.injuries.some((i) => i.treated || i.cleaned)) return true;
  const sid = c.settlementId || g.s.playerSettlement;
  if (g.s.settlements?.[sid]?.detail !== 'abstract') return false;
  for (const o of g.owned('colonists', sid)) if (o !== c && !o.health?.down) return true;
  return false;
}

/** After a job finishes successfully: a small chance of a work accident (work type `hazard`). */
export function maybeAccident(g, c, job) {
  const wt = job?.workType && g.reg.get('workType', job.workType);
  const hz = wt?.hazard;
  if (!hz || !(hz.chance > 0)) return;
  if (g.rng.next() >= hz.chance) return;
  injure(g, c, 'injury', hz.min + g.rng.next() * (hz.max - hz.min), hz.text || `Hurt while working (${wt.name})`);
}

/** How much this colonist needs care right now (0 = none): collapsed, or hungry while collapsed. */
export function careNeed(g, c) {
  const infant = !!g.reg.get('lifeStage', c.stage)?.needsCare;
  if (!c.health?.down && !infant) return 0;
  const hunger = g.reg.all('need').find((n) => n.behavior === 'core:eat');
  const thirst = g.reg.all('need').find((n) => n.behavior === 'core:drink');
  const hungry = (hunger && (c.needs[hunger.id] ?? 1) < 0.5) || (thirst && (c.needs[thirst.id] ?? 1) < 0.5);
  const tended = (c.health?.tendedUntil || 0) > g.s.tick;
  if (infant && !c.health?.down) return hungry ? 2 : 0; // a healthy infant only needs feeding
  return hungry ? 2 : tended ? 0 : 1;
}
