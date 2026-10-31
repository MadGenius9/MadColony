// God powers (Phase 2c, docs/proposals/phase-2c-god-powers.md). The player is also a god: powers are validated,
// deterministic world commands. The UI only issues them (issueCommand) and shows what they would do
// (previewCommand); they take effect at the start of the next tick (applyCommands, from Game.tick right after
// s.tick++), in id order, validated again then, and are recorded with their result in s.god.log.
//
// State (`s.god`, save format 13) is made lazily: when the first command is issued, or at the start of a Sandbox
// game. Until then nothing here writes state or draws a random number, so games without powers (every pinned
// run, every old save) are byte-identical. Randomness inside a power must come from hash keys (cmd.id + seed),
// never from g.rng.
//
// Favour: until s.god exists it is min(max, start + perDay x day); afterwards min(max, favour + perDay x
// (day - favourDay)), worked out on read (no per-day work). It is charged when a command is applied, never in
// a Sandbox game. Numbers: the `godRules` content (mods/core/content/god.json; a scenario may name its own).
//
// Ledger: whatever a power creates comes in through divineItems (createItems with reason 'divine'); people a
// power brings are counted in s.god.spawned (addDivinePeople), so start + births + spawned - left = people.
//
// Per-tick cost: applyCommands is O(1) when s.god is absent or the queue head is not due; a due command costs
// what its power costs (validation + apply), once. Nothing here loops over villages.
import { TICKS_PER_DAY } from './constants.js';
import { deepClone } from './util.js';

export const GOD_LOG_MAX = 500; // applied and refused commands kept in s.god.log (oldest dropped)
export const GOD_QUEUE_MAX = 1000; // pending commands at most (the UI issues one at a time; this guards scripts)
const ARGS_MAX_CHARS = 4000; // a command's arguments, as JSON, at most
const EPS = 1e-9;

/** The god-power rules in force: the scenario's `god` id, else core:god, else the first godRules loaded; null
 *  when no mod defines any (powers are then refused with that reason). Cached on the game (derived, never saved). */
export function godRulesOf(g) {
  if (g._godRules !== undefined) return g._godRules;
  const reg = g.reg, sc = reg.get('scenario', g.s.scenarioId);
  g._godRules = (sc?.god && reg.get('godRules', sc.god)) || reg.get('godRules', 'core:god') || reg.all('godRules')[0] || null;
  return g._godRules;
}

/** Whole game days since the start (favour regenerates per whole day). */
export const godDay = (g) => Math.floor(g.s.tick / TICKS_PER_DAY);

/** Favour available now (read-only). */
export function favourNow(g) {
  const r = godRulesOf(g);
  if (!r) return 0;
  const f = r.favour, god = g.s.god, day = godDay(g);
  if (!god) return Math.min(f.max, f.start + f.perDay * day);
  return Math.min(f.max, god.favour + f.perDay * Math.max(0, day - god.favourDay));
}

/** A fresh s.god (not attached). Favour starts at what the formula gives today. */
export function newGodState(g, sandbox = false) {
  return { sandbox: !!sandbox, favour: favourNow(g), favourDay: godDay(g), queue: [], log: [], nextId: 1, spawned: 0, blessings: {} };
}

// ---------- powers ----------
// Each power: validate(g, args, rules) -> null or a refusal reason; cost(g, args, rules) -> favour;
// preview(g, args, rules) -> plain description (read-only); apply(g, cmd, rules) -> { msg, ...result } (only
// after validate passed on this tick). Optional daily(g, god, rules): runs at every day start while s.god exists. validate, cost and preview must not write state or draw random numbers.
// Powers are code, registered once when this module (or a later slice's module) loads; they are not per-game
// state and are never saved (a save holds only commands, by type name). Registering a type twice is an error.
// Phase 5b: a power with `destructive: true` (or a function (g, args) -> bool) is refused unless its command carries
// `confirm: true` (the UI's Confirm step, kept in the saved command). Its preview lists `warnings` first; the refusal
// before confirming still returns the full preview, so the warnings can be shown.
const POWERS = new Map();
const isDestructive = (P, g, a) => (typeof P.destructive === 'function' ? !!P.destructive(g, a) : !!P.destructive);
/** The arguments a power validates: without `confirm` for powers that do not destroy (a UI may always send it). */
const plainArgs = (P, g, a) => { if (isDestructive(P, g, a) || a?.confirm === undefined) return a; const { confirm, ...rest } = a; void confirm; return rest; };

export function registerPower(type, spec) {
  if (typeof type !== 'string' || !type) throw new Error('registerPower: a power needs a type name');
  if (POWERS.has(type)) throw new Error(`registerPower: the power "${type}" is already registered`);
  for (const k of ['validate', 'cost', 'preview', 'apply']) if (typeof spec?.[k] !== 'function') throw new Error(`registerPower(${type}): "${k}" must be a function`);
  POWERS.set(type, spec);
}
export const powerTypes = () => [...POWERS.keys()];

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const extraKey = (args, allowed) => Object.keys(args).find((k) => !allowed.includes(k));
const settlementName = (g, sid) => g.s.settlements?.[sid]?.name || sid;

// Omen: the harmless test power of slice 1. It changes nothing but the log (and favour). It exercises the queue,
// the favour rules, save/load and replay. Optional args: text (shown in the log), settlementId (must exist when
// the omen appears: a village gone by then makes it refused at apply time).
registerPower('omen', {
  validate(g, a) {
    const k = extraKey(a, ['text', 'settlementId']);
    if (k) return `an omen takes only text and settlementId (not "${String(k).slice(0, 40)}")`;
    if (a.text !== undefined && (typeof a.text !== 'string' || a.text.length > 120)) return 'the omen text must be at most 120 characters';
    if (a.settlementId !== undefined && (typeof a.settlementId !== 'string' || !Object.hasOwn(g.s.settlements || {}, a.settlementId))) return 'there is no such village';
    return null;
  },
  cost: (g, a, r) => r.costs.omen ?? 0,
  preview: (g, a) => ({ effect: `An omen appears${a.settlementId ? ` over ${settlementName(g, a.settlementId)}` : ' in the sky'}; nothing else changes.` }),
  apply(g, cmd) {
    const a = cmd.args;
    const where = a.settlementId ? ` over ${settlementName(g, a.settlementId)}` : ' in the sky';
    return { msg: `An omen appears${where}${a.text ? `: "${a.text}"` : '.'}` };
  },
});

// ---------- commands ----------
function refuse(type, reason) { return { ok: false, reason, preview: null, type }; }

function costOf(g, P, args, r) {
  if (g.s.god?.sandbox) return 0;
  const c = P.cost(g, args, r);
  return Number.isFinite(c) && c > 0 ? c : 0;
}

/** Favour already promised to commands waiting in the queue (charged when they apply). */
function pendingCost(g, r) {
  const god = g.s.god;
  if (!god || god.sandbox) return 0;
  let n = 0;
  for (const c of god.queue) { const P = POWERS.get(c.type); if (P && isPlain(c.args)) n += costOf(g, P, c.args, r); }
  return n;
}

const fmt = (v) => String(Math.round(v * 10) / 10);

/** What a command would do, or why it is refused. Read-only: no state writes, no random numbers.
 *  Returns { ok, reason, preview: { type, cost, favour, sandbox, ...the power's own description } }. */
export function previewCommand(g, type, args = {}) {
  const r = godRulesOf(g);
  if (!r) return refuse(type, 'no god-power rules are loaded (no godRules content)');
  const P = POWERS.get(type);
  if (!P) return refuse(type, `unknown power "${String(type).slice(0, 40)}"`);
  if (!isPlain(args)) return refuse(type, 'the command arguments must be an object');
  let text;
  try { text = JSON.stringify(args); } catch { return refuse(type, 'the command arguments must be plain data'); }
  if (text.length > ARGS_MAX_CHARS) return refuse(type, 'the command arguments are too long');
  if (args.confirm !== undefined && args.confirm !== true) return refuse(type, 'confirm must be true');
  const why = P.validate(g, plainArgs(P, g, args), r);
  if (why) return refuse(type, why);
  const sandbox = !!g.s.god?.sandbox;
  const cost = costOf(g, P, args, r), favour = favourNow(g), free = favour - pendingCost(g, r);
  const preview = { type, cost, favour, sandbox, ...P.preview(g, args, r) };
  if (isDestructive(P, g, args)) {
    preview.destructive = true;
    preview.warnings ||= [];
    preview.warnings.push('This cannot be undone.');
    if (args.confirm !== true) return { ok: false, reason: 'this power destroys: confirm it first', preview, type, needsConfirm: true };
  }
  if (!sandbox && cost > free + EPS) return { ok: false, reason: `not enough favour (${fmt(cost)} needed, ${fmt(Math.max(0, free))} free${free < favour - EPS ? ' after the commands waiting' : ''}; it regenerates ${fmt(r.favour.perDay)} a day)`, preview, type };
  if ((g.s.god?.queue.length || 0) >= GOD_QUEUE_MAX) return { ok: false, reason: 'too many commands are waiting', preview, type };
  return { ok: true, reason: '', preview, type };
}

/** Validate and queue a command for the next tick. Returns previewCommand's result, plus { id, tick } when it is
 *  queued. The first command queued makes s.god. */
export function issueCommand(g, type, args = {}) {
  const res = previewCommand(g, type, args);
  if (!res.ok) return res;
  const s = g.s;
  s.god ||= newGodState(g, false);
  const cmd = { id: s.god.nextId++, tick: s.tick + 1, type, args: deepClone(args) };
  s.god.queue.push(cmd);
  return { ...res, id: cmd.id, tick: cmd.tick };
}

/** Called by Game.tick right after s.tick++: applies every queued command that is due, in id order. O(1) when
 *  there is no s.god or the head of the queue is not due. */
export function applyCommands(g) {
  const god = g.s.god;
  if (!god) return;
  if (g.s.tick % TICKS_PER_DAY === 0) dailyPowers(g, god); // day start: e.g. blessings expire (before this tick's commands)
  if (!god.queue.length || god.queue[0].tick > g.s.tick) return;
  while (god.queue.length && god.queue[0].tick <= g.s.tick) applyOne(g, god, god.queue.shift());
}

/** Day start (only while s.god exists): each registered power's optional daily(g, god, rules), in registration
 *  order (fixed by module load order). Cost: what the hooks cost (bless: O(blessings)). */
function dailyPowers(g, god) {
  const r = godRulesOf(g);
  for (const P of POWERS.values()) if (P.daily) P.daily(g, god, r);
}

/** The blessing in force on a settlement now, or null. O(1); null at once when no power was ever used (no s.god),
 *  so work speed and births cost nothing extra in games without powers. A blessing works until its `until` tick;
 *  the record itself is dropped at the next day start (godboons.js). */
export function blessingOf(g, sid) {
  const god = g.s.god;
  if (!god) return null;
  const b = Object.hasOwn(god.blessings, sid) ? god.blessings[sid] : null;
  return b && b.until > g.s.tick ? b : null;
}

function record(god, cmd, result) {
  god.log.push({ id: cmd.id, tick: cmd.tick, type: cmd.type, args: cmd.args, result });
  if (god.log.length > GOD_LOG_MAX) god.log.splice(0, god.log.length - GOD_LOG_MAX);
}

/** The tick a command takes effect: the current tick while commands are being applied (validate and apply run in
 *  applyCommands), else the next tick (previewCommand / issueCommand: a command issued now applies at s.tick + 1).
 *  Powers whose result depends on the tick (bless: rounded to a day start) plan from this, so a preview shows exactly
 *  what applying will do. */
export const effectTick = (g) => (g._godApplying ? g.s.tick : g.s.tick + 1);

function applyOne(g, god, cmd) {
  g._godApplying = true; // derived, never saved (effectTick)
  try { applyOneNow(g, god, cmd); } finally { g._godApplying = false; }
}

function applyOneNow(g, god, cmd) {
  const r = godRulesOf(g), P = POWERS.get(cmd.type);
  let reason = !r ? 'no god-power rules are loaded' : !P ? `unknown power "${String(cmd.type).slice(0, 40)}" (is its mod enabled?)` : !isPlain(cmd.args) ? 'the command arguments are malformed' : P.validate(g, plainArgs(P, g, cmd.args), r);
  if (!reason && isDestructive(P, g, cmd.args) && cmd.args.confirm !== true) reason = 'it was not confirmed';
  const cost = reason ? 0 : costOf(g, P, cmd.args, r);
  if (!reason && !god.sandbox) {
    const f = favourNow(g);
    if (cost > f + EPS) reason = `not enough favour (${fmt(cost)} needed, ${fmt(f)} available)`;
  }
  if (reason) {
    record(god, cmd, { ok: false, reason });
    g.log(`A divine command (${cmd.type}) was refused: ${reason}.`, 'warn');
    return;
  }
  if (cost > 0) { god.favour = Math.max(0, favourNow(g) - cost); god.favourDay = godDay(g); } // never below 0 (cost may exceed favour by EPS)
  const out = P.apply(g, cmd, r) || {};
  const { msg = `A divine command (${cmd.type}) was carried out.`, ...rest } = out;
  record(god, cmd, { ok: true, cost, msg, ...rest });
  const sid = rest.settlementId || cmd.args?.settlementId;
  const eid = g.log(msg, 'god', null, 0, { kind: 'core:god_power', at: Number.isFinite(cmd.args?.x) ? cmd.args : null, sids: sid ? [sid] : [] });
  g.afterPower?.(cmd, rest, eid); // petitions it answers (petitions.js)
}

// ---------- ledger helpers (used by the powers) ----------
/** Create items by divine power: the ledger records them as created:divine. They belong to `owner` (default the
 *  settlement acting now, else the player's) and go to its stockpile first, else onto the ground near (x, y). */
export function divineItems(g, item, qty, x, y, owner = g.actor || g.s.playerSettlement) {
  const prev = g.actor;
  g.actor = owner;
  try { g.createItems(item, qty, x, y, 'divine', undefined, true); } finally { g.actor = prev; }
}

/** Count people brought by a power (the people ledger): start + births + spawned - left = people. */
export function addDivinePeople(g, n) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`addDivinePeople: a whole number of people is needed (got ${n})`);
  const god = (g.s.god ||= newGodState(g, false));
  god.spawned += n;
}

/** For the UI: favour and the queue, read-only. */
export function godSummary(g) {
  const r = godRulesOf(g), god = g.s.god;
  return {
    available: !!r, sandbox: !!god?.sandbox, favour: favourNow(g), max: r?.favour.max ?? 0, perDay: r?.favour.perDay ?? 0,
    waiting: god?.queue.length || 0, spawned: god?.spawned || 0,
  };
}
