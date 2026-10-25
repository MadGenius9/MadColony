export const ID_RE = /^[a-z][a-z0-9_]*:[a-z0-9_.-]+$/;
export const MOD_ID_RE = /^[a-z][a-z0-9_]*$/;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const nsOf = (id) => String(id).split(':')[0];

export function octile(ax, ay, bx, by) {
  const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
  return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
}
export const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

export function deepClone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

// ---- Minimal semantic versioning (x.y.z) ----
export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?(?:[-+].*)?$/.exec(String(v ?? '').trim());
  return m ? [+m[1], +m[2], +(m[3] || 0)] : null;
}
export function cmpVersion(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}
function satisfiesPart(v, part) {
  let m;
  if (part === '*' || part === '') return true;
  if ((m = /^\^(.+)$/.exec(part))) {
    const r = parseVersion(m[1]);
    if (!r || cmpVersion(v, r) < 0) return false;
    return r[0] > 0 ? v[0] === r[0] : v[0] === 0 && v[1] === r[1];
  }
  if ((m = /^~(.+)$/.exec(part))) {
    const r = parseVersion(m[1]);
    return !!r && cmpVersion(v, r) >= 0 && v[0] === r[0] && v[1] === r[1];
  }
  if ((m = /^(>=|<=|>|<|=)(.+)$/.exec(part))) {
    const r = parseVersion(m[2]);
    if (!r) return false;
    const c = cmpVersion(v, r);
    return { '>=': c >= 0, '<=': c <= 0, '>': c > 0, '<': c < 0, '=': c === 0 }[m[1]];
  }
  if ((m = /^(\d+)\.x$/.exec(part))) return v[0] === +m[1];
  const r = parseVersion(part);
  return !!r && cmpVersion(v, r) === 0;
}
export function satisfies(version, range) {
  const v = parseVersion(version);
  if (!v) return false;
  const parts = String(range ?? '*').trim().split(/\s+/);
  return parts.every((p) => satisfiesPart(v, p));
}
export function isValidRange(range) {
  if (typeof range !== 'string') return false;
  return range.trim().split(/\s+/).every((p) =>
    p === '*' || /^(\^|~|>=|<=|>|<|=)?\d+\.\d+(\.\d+)?$/.test(p) || /^\d+\.x$/.test(p));
}

// Deterministic ring/spiral order of tiles around (x, y) up to radius r.
export function* rings(x, y, r) {
  yield [x, y];
  for (let d = 1; d <= r; d++) {
    for (let dx = -d; dx <= d; dx++) { yield [x + dx, y - d]; yield [x + dx, y + d]; }
    for (let dy = -d + 1; dy <= d - 1; dy++) { yield [x - d, y + dy]; yield [x + d, y + dy]; }
  }
}
