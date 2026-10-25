// Mod loading: manifest validation, dependency + version checks, load ordering, conflict reporting,
// atomic per-mod content staging and whole-registry cross-reference validation.
// Environment-agnostic: callers pass already-parsed packages ({ manifest, files, source }).
import { GAME_API_VERSION } from '../constants.js';
import { MOD_ID_RE, nsOf, satisfies, isValidRange, parseVersion, deepClone, deepFreeze } from '../util.js';
import { validate, req, str, arr, obj } from './schema.js';
import { CONTENT_TYPES, TYPE_NAMES, crossValidate } from './types.js';
import { Registry } from './registry.js';

const MANIFEST_SCHEMA = obj({
  id: req({ type: 'string', pattern: MOD_ID_RE, maxLen: 40 }),
  name: req(str(80)),
  author: req(str(80)),
  version: req(str(30)),
  gameApi: req(str(40)),
  description: str(1000),
  dependencies: arr(obj({ id: req({ type: 'string', pattern: MOD_ID_RE }), version: str(40) })),
  loadAfter: arr({ type: 'string', pattern: MOD_ID_RE }),
  loadBefore: arr({ type: 'string', pattern: MOD_ID_RE }),
  incompatibleWith: arr({ type: 'string', pattern: MOD_ID_RE }),
  content: req(arr(str(200))),
  art: str(200), // optional sprite atlas (built-in mods only; cosmetic)
});

export function validateManifest(m) {
  const ctx = { errors: [], refs: [] };
  validate(m, MANIFEST_SCHEMA, 'manifest', ctx);
  if (ctx.errors.length) return ctx.errors;
  if (!parseVersion(m.version)) ctx.errors.push(`manifest.version "${m.version}" must look like 1.2.3`);
  if (!isValidRange(m.gameApi)) ctx.errors.push(`manifest.gameApi "${m.gameApi}" is not a valid version range (e.g. "^1.0")`);
  for (const d of m.dependencies || []) if (d.version && !isValidRange(d.version)) ctx.errors.push(`dependency ${d.id}: invalid version range "${d.version}"`);
  for (const p of m.content) if (p.includes('..') || p.startsWith('/')) ctx.errors.push(`content path "${p}" must be relative and stay inside the mod`);
  if (m.art && (m.art.includes('..') || m.art.startsWith('/') || /^[a-z]+:/i.test(m.art))) ctx.errors.push(`art path "${m.art}" must be relative and stay inside the mod`);
  return ctx.errors;
}

/**
 * @param packages [{manifest, files: {path: parsedJson}, source}]
 * @param enabledIds ids the player has enabled (order irrelevant; load order is computed)
 * @returns {registry, report}
 */
export function buildRegistry(packages, enabledIds, opts = {}) {
  const gameApi = opts.gameApi || GAME_API_VERSION;
  const excluded = new Map(); // mod id -> [reasons]  (forced out after content/ref errors)
  for (let pass = 0; pass < 30; pass++) {
    const r = attempt(packages, enabledIds, excluded, gameApi);
    if (!r.retry) return r;
  }
  throw new Error('Mod loading did not stabilise');
}

function attempt(packages, enabledIds, excluded, gameApi) {
  const report = { loaded: [], rejected: [], conflicts: [], warnings: [], order: [], available: [] };
  const reject = (id, reasons) => {
    const ex = report.rejected.find((r) => r.id === id);
    if (ex) ex.reasons.push(...reasons); else report.rejected.push({ id, reasons: [...reasons] });
  };

  // 1. Manifests
  const pkgs = new Map();
  for (const p of packages) {
    const m = p.manifest;
    const id = typeof m?.id === 'string' ? m.id : '(unknown)';
    if (p.loadError) { reject(id, [p.loadError]); continue; }
    const errs = validateManifest(m);
    if (errs.length) { reject(id, errs.map((e) => `invalid manifest: ${e}`)); continue; }
    if (pkgs.has(m.id)) {
      report.conflicts.push({ mods: [m.id], message: `Two packages use the mod id "${m.id}" (${pkgs.get(m.id).source} and ${p.source}); the second was ignored.` });
      continue;
    }
    pkgs.set(m.id, p);
    report.available.push({ id: m.id, name: m.name, version: m.version, author: m.author, source: p.source, description: m.description || '' });
  }

  // 2. Enabled set + API compatibility
  const enabled = new Set();
  for (const id of enabledIds) {
    const p = pkgs.get(id);
    if (!p) { report.warnings.push(`Enabled mod "${id}" is not installed.`); continue; }
    if (excluded.has(id)) { reject(id, excluded.get(id)); continue; }
    if (!satisfies(gameApi, p.manifest.gameApi)) { reject(id, [`requires game API ${p.manifest.gameApi}, this game provides ${gameApi}`]); continue; }
    enabled.add(id);
  }

  // 3. Dependencies (iterate until stable so failures cascade)
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...enabled]) {
      const m = pkgs.get(id).manifest;
      for (const d of m.dependencies || []) {
        const dp = pkgs.get(d.id);
        let why = null;
        if (!dp) why = `missing dependency "${d.id}"`;
        else if (!enabled.has(d.id)) why = `dependency "${d.id}" is disabled or failed to load`;
        else if (d.version && !satisfies(dp.manifest.version, d.version)) why = `needs ${d.id} ${d.version}, found ${dp.manifest.version}`;
        if (why) { enabled.delete(id); reject(id, [why]); changed = true; break; }
      }
    }
  }

  // 4. Declared incompatibilities
  for (const id of [...enabled].sort()) {
    if (!enabled.has(id)) continue;
    for (const other of pkgs.get(id).manifest.incompatibleWith || []) {
      if (enabled.has(other)) {
        report.conflicts.push({ mods: [id, other], message: `"${id}" declares it is incompatible with "${other}". "${id}" was not loaded.` });
        enabled.delete(id);
        reject(id, [`incompatible with enabled mod "${other}"`]);
        break;
      }
    }
  }
  // (re-run dependency cascade after incompatibility removals)
  for (let again = true; again;) {
    again = false;
    for (const id of [...enabled]) {
      for (const d of pkgs.get(id).manifest.dependencies || []) {
        if (!enabled.has(d.id)) { enabled.delete(id); reject(id, [`dependency "${d.id}" was not loaded`]); again = true; break; }
      }
    }
  }

  // 5. Load order: dependencies and loadAfter before, loadBefore after. Ties: core first, then id.
  const ids = [...enabled].sort((a, b) => (a === 'core' ? -1 : b === 'core' ? 1 : a < b ? -1 : 1));
  const edges = new Map(ids.map((i) => [i, new Set()])); // before -> afters
  for (const id of ids) {
    const m = pkgs.get(id).manifest;
    for (const d of [...(m.dependencies || []).map((x) => x.id), ...(m.loadAfter || [])]) if (enabled.has(d)) edges.get(d).add(id);
    for (const b of m.loadBefore || []) if (enabled.has(b)) edges.get(id).add(b);
  }
  const indeg = new Map(ids.map((i) => [i, 0]));
  for (const [, outs] of edges) for (const o of outs) indeg.set(o, indeg.get(o) + 1);
  const order = [];
  const ready = ids.filter((i) => indeg.get(i) === 0);
  while (ready.length) {
    ready.sort((a, b) => ids.indexOf(a) - ids.indexOf(b));
    const n = ready.shift();
    order.push(n);
    for (const o of edges.get(n)) { indeg.set(o, indeg.get(o) - 1); if (indeg.get(o) === 0) ready.push(o); }
  }
  for (const id of ids) if (!order.includes(id)) { reject(id, ['load-order cycle (check loadAfter / loadBefore / dependencies)']); }

  // 6. Content, staged atomically per mod
  const reg = new Registry();
  const overriddenBy = new Map(); // "type|id" -> mod id that last overrode it
  const defRefs = []; // {type, id, mod, refs}
  for (const id of order) {
    const p = pkgs.get(id);
    const errors = [];
    const staged = [];
    const stagedKeys = new Set();
    for (const path of p.manifest.content) {
      const file = p.files?.[path];
      if (file === undefined) { errors.push(`content file "${path}" is missing from the package`); continue; }
      if (!file || typeof file !== 'object' || Array.isArray(file)) { errors.push(`${path}: must be a JSON object keyed by content type`); continue; }
      for (const [type, list] of Object.entries(file)) {
        if (type.startsWith('$')) continue;
        if (!CONTENT_TYPES[type]) { errors.push(`${path}: unknown content type "${type}" (supported: ${TYPE_NAMES.join(', ')})`); continue; }
        if (!Array.isArray(list)) { errors.push(`${path}: "${type}" must be a list`); continue; }
        list.forEach((def, i) => {
          const label = `${path} ${type}[${i}]${def && def.id ? ` "${def.id}"` : ''}`;
          const ctx = { errors: [], refs: [] };
          validate(def, CONTENT_TYPES[type].schema, label, ctx);
          if (ctx.errors.length) { errors.push(...ctx.errors); return; }
          const key = `${type}|${def.id}`;
          const exists = reg.has(type, def.id);
          if (def.$override) {
            if (!exists) { errors.push(`${label}: "$override" targets "${def.id}", which no earlier mod defines`); return; }
            const prev = overriddenBy.get(key);
            if (prev && prev !== id) {
              report.conflicts.push({ mods: [prev, id], message: `${type} "${def.id}" is overridden by both "${prev}" and "${id}". Load order makes "${id}" win.` });
            }
          } else {
            if (nsOf(def.id) !== id) { errors.push(`${label}: id must use this mod's namespace "${id}:" (or set "$override": true to replace another mod's content)`); return; }
            if (exists || stagedKeys.has(key)) {
              errors.push(`${label}: duplicate id "${def.id}"`);
              return;
            }
          }
          stagedKeys.add(key);
          staged.push({ type, def, refs: ctx.refs, override: !!def.$override });
        });
      }
    }
    if (errors.length) {
      excluded.set(id, errors);
      return { retry: true };
    }
    for (const s of staged) {
      const clean = deepClone(s.def);
      delete clean.$override; delete clean.$comment;
      reg.byType[s.type].set(clean.id, deepFreeze(clean));
      reg.origin.set(`${s.type}|${clean.id}`, id);
      if (s.override) overriddenBy.set(`${s.type}|${clean.id}`, id);
      const ix = defRefs.findIndex((d) => d.type === s.type && d.id === clean.id);
      if (ix >= 0) defRefs.splice(ix, 1);
      defRefs.push({ type: s.type, id: clean.id, mod: id, refs: s.refs });
    }
    const m = p.manifest;
    reg.mods.push({ id: m.id, name: m.name, version: m.version, author: m.author, source: p.source });
  }

  // 7. Cross-reference + semantic validation over the merged registry
  reg.buildIndexes();
  const errsByMod = new Map();
  const addErr = (mod, e) => { if (!errsByMod.has(mod)) errsByMod.set(mod, []); errsByMod.get(mod).push(e); };
  for (const d of defRefs) {
    for (const r of d.refs) {
      if (!reg.has(r.to, r.id)) addErr(d.mod, `${r.path}: unknown ${r.to} "${r.id}"`);
    }
    const def = reg.get(d.type, d.id);
    for (const e of crossValidate(reg, d.type, def)) addErr(d.mod, `${d.type} "${d.id}": ${e}`);
  }
  if (errsByMod.size) {
    for (const [mod, errs] of errsByMod) {
      if (mod === 'core' && enabled.size > 1) {
        // Blame later mods first: a mod's override may have broken core references.
        const culprit = [...order].reverse().find((m) => m !== 'core');
        if (culprit && !excluded.has(culprit)) { excluded.set(culprit, [`core content failed validation while this mod was loaded: ${errs[0]}`]); return { retry: true }; }
      }
      excluded.set(mod, errs);
    }
    return { retry: true };
  }

  for (const t of ['scenario', 'worldgen', 'aiProfile', 'namePool']) {
    if (reg.all(t).length === 0) report.warnings.push(`No ${t} is defined. A new game cannot start (is the "core" mod enabled?).`);
  }
  report.order = order;
  report.loaded = reg.mods.map((m) => ({ ...m }));
  report.playable = report.warnings.every((w) => !w.startsWith('No '));
  return { registry: reg, report };
}
