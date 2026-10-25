// Shared helpers for the cloud test suite (tests/cloud-*.test.js). Not a test file itself.
import { newGame, conservationErrors } from '../tools/headless.js';
import { serializeGame, loadGame } from '../src/sim/save.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

export { newGame, conservationErrors, serializeGame, loadGame, TICKS_PER_DAY };

/** Run whole days; `onDay(day)` is called after each one. */
export function runDays(g, days, onDay = null) {
  const start = Math.round(g.s.tick / TICKS_PER_DAY);
  for (let d = 1; d <= days; d++) {
    g.step(TICKS_PER_DAY);
    if (onDay) onDay(start + d);
  }
}

/** The game's saved state as text, without the note a load adds (`loadedFrom`), so a loaded game and the game
 *  that was never saved can be compared byte for byte. */
export function stateText(g) {
  const save = JSON.parse(serializeGame(g));
  delete save.state.loadedFrom;
  return JSON.stringify(save);
}

/** Save and load in one step (the loaded game throws on internal errors, like the original). */
export function reload(g) {
  const g2 = loadGame(g.reg, serializeGame(g));
  g2.debugThrow = true;
  return g2;
}

/** The first top-level state key whose saved form differs, for readable failures. */
export function firstDifference(a, b) {
  const A = JSON.parse(a).state, B = JSON.parse(b).state;
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    if (JSON.stringify(A[k]) !== JSON.stringify(B[k])) return k;
  }
  return a === b ? null : '(outside state)';
}

/** Reservations must equal what the colonists' jobs hold (job.res). Returns a list of problems. */
export function reservationErrors(g) {
  const excl = new Map(), qty = new Map(), inc = new Map();
  for (const c of Object.values(g.s.colonists)) {
    for (const r of c.job?.res || []) {
      if (r.k === 'x') excl.set(r.key, c.id);
      else if (r.k === 'q') qty.set(r.key, (qty.get(r.key) || 0) + r.qty);
      else if (r.k === 'i') inc.set(r.key, (inc.get(r.key) || 0) + r.qty);
    }
  }
  const errs = [];
  const cmp = (name, want, have) => {
    for (const k of new Set([...want.keys(), ...have.keys()])) {
      if (want.get(k) !== have.get(k)) errs.push(`${name} ${k}: jobs hold ${want.get(k)}, game has ${have.get(k)}`);
    }
  };
  cmp('exclusive', excl, g.excl);
  cmp('quantity', qty, g.qtyRes);
  cmp('incoming', inc, g.incRes);
  return errs;
}

/** Needs and positions must be finite numbers (no NaN creeping in over long runs). */
export function badNumbers(g) {
  const errs = [];
  for (const c of Object.values(g.s.colonists)) {
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) errs.push(`${c.id} position ${c.x},${c.y}`);
    for (const [k, v] of Object.entries(c.needs)) if (!Number.isFinite(v)) errs.push(`${c.id} need ${k} = ${v}`);
  }
  return errs;
}

/** Shortest distance between two settlement centres. */
export function closestPair(g) {
  const st = Object.values(g.s.settlements);
  let best = Infinity;
  for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) {
    const a = st[i].center, b = st[j].center;
    best = Math.min(best, Math.hypot(a.x - b.x, a.y - b.y));
  }
  return best;
}
