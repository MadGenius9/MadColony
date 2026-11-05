// The simulation behind a message boundary (docs/proposals/sim-worker.md, slice 1). The host owns the Game and
// answers messages; it runs the same in a Web Worker, in the main thread (a fallback) or in a test. It never
// touches the DOM or browser storage. Determinism: it runs the same Game.tick() in the same order as a UI
// calling it directly; god commands go through issueCommand (they apply at the next tick, as now); direct calls
// run between ticks, as the UI runs them today.
//
// Messages in (each may carry an `id`, echoed in its answer):
//   init    { packages, enabled, opts }    a new game (opts as Game.create takes them; debugThrow for tests)
//           { packages, enabled, save }    a saved game's text
//   speed   { speed }                     0 pauses; 1 is 60 ticks a second
//   step    { ticks }                     run this many ticks now and send a frame (tests, single-stepping)
//   command { power, args }               issue a god command      -> result
//   preview { power, args }               preview one              -> result
//   call    { fn, args }                  one of CALLS             -> result
//   query   { kind, ... }                 one of QUERIES           -> result
//   camera  { x0, y0, w, h }              the visible tiles; the next frame carries their contents
//   save    {}                            -> result: the save's text
// Messages out: ready, frame, result, error (see the design note for their fields).
import { buildRegistry } from './content/modloader.js';
import { Game } from './game.js';
import { serializeGame, loadGame } from './save.js';
import { issueCommand, previewCommand, favourNow } from './god.js';
import { setCivLaw, civLawProblem } from './civlaws.js';
import { evaluateAttack, orderAttack } from './combat.js';
import { evaluateOffer } from './villages.js';
import { canFound } from './founding.js';
import { explainColonist } from './explain.js';
import { TICKS_PER_HOUR } from './constants.js';
import { moversFrame, changedChunks, logSince, areaSnapshot, worldSummary, overlays } from './view.js';

export const TICKS_PER_SECOND = 60; // at 1x, as the browser has always run
const STEP_MS = 1000 / 60;          // the host's loop: one step a frame
const BUDGET_MS = 12;               // the most wall time one step spends ticking before it sends its frame
const BACKLOG_S = 1;                // ticks owed beyond a second of play are dropped (the machine is too slow)
const OVERLAYS_EVERY_MS = 250;      // fires, weather, caravans and travellers at most 4 times a second
const AREA_EVERY_MS = 250;          // the camera's contents at most 4 times a second, unless the camera moved
                                    // or the ground in view changed

/** The direct calls a UI may make (docs/integration-contract.md 3b), by name: each takes (g, ...args); `sids`:
 *  the argument positions that must name an existing village. */
export const CALLS = {
  setCivLaw: { fn: setCivLaw, sids: [0] },
  civLawProblem: { fn: civLawProblem, sids: [0] },
  evaluateAttack: { fn: evaluateAttack, sids: [0, 1] },
  orderAttack: { fn: orderAttack, sids: [0, 1] },
  evaluateOffer: { fn: evaluateOffer, sids: [0] },
  canFound: { fn: canFound, sids: [0] },
};

/** Names that reach an object's prototype when used as a key (`s.settlements['__proto__']`): refused anywhere in
 *  what a message passes on to the game, as a string or as a key. */
const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function refuseProtoKeys(v, depth = 0) {
  if (typeof v === 'string') { if (PROTO_KEYS.has(v)) throw new Error(`"${v}" is not allowed in a message`); return; }
  if (!v || typeof v !== 'object' || depth > 20) return;
  for (const k of Reflect.ownKeys(v)) { if (typeof k === 'string' && PROTO_KEYS.has(k)) throw new Error(`"${k}" is not allowed in a message`); refuseProtoKeys(v[k], depth + 1); }
}
const own = (coll, id) => (coll && typeof id === 'string' && Object.hasOwn(coll, id) ? coll[id] : null);

/** Reads a UI may ask for, by kind. */
export const QUERIES = {
  colonist: (g, m) => { const c = own(g.s.colonists, m.cid); return c ? { colonist: c, explain: explainColonist(g, c) } : null; },
  entity: (g, m) => (['structures', 'stacks', 'crops', 'nodes', 'projects', 'fields', 'settlements'].includes(m.coll) ? own(g.s[m.coll], m.eid) : null),
  area: (g, m) => areaSnapshot(g, m.x0, m.y0, m.w, m.h),
  world: (g) => worldSummary(g),
  overlays: (g) => overlays(g),
};

/**
 * post(msg, transfer): sends a message out (transfer: ArrayBuffers that may be moved, not copied).
 * now(): wall time in ms. schedule(fn, ms) / cancel(handle): a timer (setTimeout in a worker).
 * copy: whether the host copies each message itself (structuredClone) before posting it. Keep it on in the main
 * thread and in tests, so the receiver can never reach into the running game; a worker's postMessage copies
 * anyway, so worker.js turns it off.
 */
export function createSimHost({ post, now = () => performance.now(), schedule = (f, ms) => setTimeout(f, ms), cancel = (h) => clearTimeout(h), copy = true }) {
  let g = null, speed = 0, timer = null, owed = 0, lastWall = 0;
  let moversKey = null, chgN = null, logSent = new WeakSet(), pal = 0, idxKind = null, camera = null, areaAt = -Infinity, areaDue = false, worldHour = -1, overAt = -Infinity;
  let tps = 0, tpsTicks = 0, tpsFrom = 0;

  // With copy on, the clone owns the moved buffers (the originals are detached), so nothing is left to transfer.
  const send = (msg, transfer = []) => (copy ? post(structuredClone(msg, { transfer }), []) : post(msg, transfer));
  const resetMarkers = () => { moversKey = null; chgN = null; logSent = new WeakSet(); pal = 0; idxKind = null; areaDue = true; worldHour = -1; overAt = -Infinity; };
  /** Whether chunk k of a changedChunks result overlaps the camera. */
  const inView = (c, k) => {
    if (!camera) return false;
    const x = (k % c.cw) * c.size, y = Math.floor(k / c.cw) * c.size;
    return x < camera.x0 + camera.w && x + c.size > camera.x0 && y < camera.y0 + camera.h && y + c.size > camera.y0;
  };

  function terrainOf(chunks) {
    const ts = g._ts, size = chunks.size, out = [];
    for (const k of chunks.chunks) {
      const cx = (k % chunks.cw) * size, cy = Math.floor(k / chunks.cw) * size;
      const w = Math.min(size, g.W - cx), h = Math.min(size, g.H - cy), idx = new ts.idx.constructor(w * h);
      for (let y = 0; y < h; y++) idx.set(ts.idx.subarray((cy + y) * g.W + cx, (cy + y) * g.W + cx + w), y * w);
      out.push({ k, x: cx, y: cy, w, h, idx });
    }
    return out;
  }

  /** The frame: what changed since the last one. */
  function frame() {
    const m = moversFrame(g, moversKey); moversKey = m.key;
    const c = changedChunks(g, chgN); chgN = c.n;
    const msg = { type: 'frame', tick: g.s.tick, day: g.day, clock: g.timeString(), speed, tps, favour: g.s.god ? favourNow(g) : null, movers: { ids: m.ids, pos: m.pos }, log: logSince(g, logSent) };
    const transfer = [m.pos.buffer];
    // The whole terrain at the start, after a change everywhere, and when the store widened its index type
    // (tiles.js: Uint8Array to Uint16Array past 256 kinds), so the mirror's array type always matches.
    const kind = g._ts.idx.constructor.name;
    if (c.all || kind !== idxKind) { msg.terrain = { all: true, w: g.W, h: g.H, idx: g._ts.idx.slice(), pal: g._ts.pal.slice() }; idxKind = kind; areaDue = true; }
    else if (c.chunks.length) { msg.terrain = { all: false, chunks: terrainOf(c) }; if (c.chunks.some((k) => inView(c, k))) areaDue = true; }
    if (msg.terrain) for (const t of msg.terrain.all ? [msg.terrain] : msg.terrain.chunks) transfer.push(t.idx.buffer);
    if (g._ts.pal.length !== pal) { (msg.terrain ||= { all: false, chunks: [] }).pal = g._ts.pal.slice(); pal = g._ts.pal.length; }
    const wall = now();
    if (camera && (areaDue || wall - areaAt >= AREA_EVERY_MS)) { msg.area = areaSnapshot(g, camera.x0, camera.y0, camera.w, camera.h); areaAt = wall; areaDue = false; }
    const hour = Math.floor(g.s.tick / TICKS_PER_HOUR);
    if (hour !== worldHour) { msg.world = worldSummary(g); worldHour = hour; }
    if (wall - overAt >= OVERLAYS_EVERY_MS) { msg.overlays = overlays(g); overAt = wall; }
    send(msg, transfer);
  }

  /** Run up to `ticks` ticks within the step's budget; returns how many ran. */
  function run(ticks) {
    const from = now(); let n = 0;
    while (n < ticks) { g.tick(); n++; if (now() - from >= BUDGET_MS) break; }
    return n;
  }

  function loop() {
    timer = null;
    if (!g || speed <= 0) return;
    const wall = now();
    try {
      owed = Math.min(owed + (wall - lastWall) / 1000 * TICKS_PER_SECOND * speed, BACKLOG_S * TICKS_PER_SECOND * speed);
      lastWall = wall;
      const n = run(Math.floor(owed)); owed -= n;
      tpsTicks += n;
      if (wall - tpsFrom >= 1000) { tps = Math.round(tpsTicks * 1000 / (wall - tpsFrom)); tpsTicks = 0; tpsFrom = wall; }
      frame();
    } catch (e) { // never a clock that runs on while the game has stopped: pause, and say why
      setSpeed(0);
      send({ type: 'error', id: null, of: 'tick', tick: g.s.tick, message: String(e?.message || e) });
      return;
    }
    timer = schedule(loop, Math.max(0, STEP_MS - (now() - wall)));
  }

  function setSpeed(v) {
    speed = Number.isFinite(v) && v > 0 ? Math.min(v, 64) : 0;
    if (timer !== null) { cancel(timer); timer = null; }
    owed = 0; lastWall = now(); tpsFrom = lastWall; tpsTicks = 0; tps = 0;
    if (speed > 0 && g) timer = schedule(loop, 0);
  }

  const handlers = {
    init(m) {
      const { registry, report } = buildRegistry(m.packages || [], m.enabled || ['core']);
      g = m.save !== undefined ? loadGame(registry, m.save) : Game.create(registry, m.opts || {});
      if (m.debugThrow) g.debugThrow = true; // tests: internal errors throw (as tools/headless.js newGame does)
      resetMarkers();
      send({ type: 'ready', id: m.id, tick: g.s.tick, w: g.W, h: g.H, report });
      frame();
    },
    speed(m) { setSpeed(m.speed); },
    step(m) { const k = Math.max(0, Math.floor(m.ticks || 0)); for (let i = 0; i < k; i++) g.tick(); frame(); },
    command(m) { refuseProtoKeys([m.power, m.args]); return issueCommand(g, m.power, m.args); },
    preview(m) { refuseProtoKeys([m.power, m.args]); return previewCommand(g, m.power, m.args); },
    call(m) {
      const c = Object.hasOwn(CALLS, m.fn) ? CALLS[m.fn] : null;
      if (!c) throw new Error(`unknown call "${String(m.fn).slice(0, 40)}"`);
      const args = Array.isArray(m.args) ? m.args : [];
      refuseProtoKeys(args);
      for (const k of c.sids) if (!own(g.s.settlements, args[k])) throw new Error(`${m.fn}: argument ${k + 1} is not a village`);
      return c.fn(g, ...args);
    },
    query(m) {
      const q = Object.hasOwn(QUERIES, m.kind) ? QUERIES[m.kind] : null;
      if (!q) throw new Error(`unknown query "${String(m.kind).slice(0, 40)}"`);
      refuseProtoKeys(m);
      return q(g, m);
    },
    camera(m) { camera = { x0: +m.x0 || 0, y0: +m.y0 || 0, w: +m.w || 0, h: +m.h || 0 }; areaDue = true; if (speed <= 0 && g) frame(); },
    save() { return serializeGame(g); },
  };
  const ANSWERS = new Set(['command', 'preview', 'call', 'query', 'save']);

  return {
    /** Handle one message (from onmessage, or called directly). */
    receive(m) {
      try {
        const h = m && Object.hasOwn(handlers, m.type) ? handlers[m.type] : null;
        if (!h) throw new Error(`unknown message "${String(m?.type).slice(0, 40)}"`);
        if (m.type !== 'init' && !g) throw new Error('no game yet: send init first');
        const value = h(m);
        if (ANSWERS.has(m.type)) send({ type: 'result', id: m.id ?? null, value: value ?? null });
      } catch (e) {
        send({ type: 'error', id: m?.id ?? null, of: m?.type ?? null, message: String(e?.message || e) });
      }
    },
    /** For tests and the main-thread fallback: the game itself (never sent anywhere). */
    get game() { return g; },
    stop() { setSpeed(0); },
  };
}
