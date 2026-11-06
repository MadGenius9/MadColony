// The simulation behind a message boundary (docs/proposals/sim-worker.md, slice 1): src/sim/simhost.js and
// src/sim/view.js. The host must run exactly the game a UI calling Game.tick() runs, send only plain copies,
// and send each change once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readAllMods } from '../tools/fsmods.js';
import { newGame, stateText, serializeGame, TICKS_PER_DAY } from './cloud-helpers.js';
import { issueCommand } from '../src/sim/god.js';
import { createSimHost, TICKS_PER_SECOND } from '../src/sim/simhost.js';
import { logSince, areaSnapshot, MOVER_STRIDE } from '../src/sim/view.js';

const PACKAGES = readAllMods();
const NEIGH = { seed: 7, scenario: 'core:neighbours', size: 'medium', villages: 2, sandbox: true };
const createOpts = (o) => ({ seed: o.seed, scenarioId: o.scenario, size: o.size, villages: o.villages, sandbox: o.sandbox });

/** A host whose messages are collected; `clock` drives its timer by hand. */
function hostWith(clock = null) {
  const out = [], timers = [];
  const host = createSimHost({
    post: (m) => { structuredClone(m); out.push(m); }, // throws if anything sent cannot be copied
    ...(clock ? { now: () => clock.t, schedule: (f) => { timers.push(f); return timers.length; }, cancel: () => {} } : {}),
  });
  const last = (type) => out.filter((m) => m.type === type).at(-1);
  const ask = (m) => { host.receive({ id: out.length + 1, ...m }); return out.at(-1); };
  return { host, out, timers, last, ask };
}

function initNeigh(h, extra = {}) {
  h.host.receive({ type: 'init', packages: PACKAGES, enabled: ['core'], opts: createOpts(NEIGH), debugThrow: true, ...extra });
  assert.ok(h.last('ready'), JSON.stringify(h.out.at(-1)).slice(0, 300));
}

test('the host runs the same game as ticking it directly, commands included', () => {
  const g = newGame(NEIGH);
  const h = hostWith(); initNeigh(h);
  const p = g.s.playerSettlement;
  for (let d = 0; d < 2; d++) {
    g.step(TICKS_PER_DAY / 2);
    h.host.receive({ type: 'step', ticks: TICKS_PER_DAY / 2 });
    const direct = issueCommand(g, d ? 'bless' : 'omen', d ? { settlementId: p } : { text: 'a sign' });
    const via = h.ask({ type: 'command', power: d ? 'bless' : 'omen', args: d ? { settlementId: p } : { text: 'a sign' } });
    assert.equal(via.type, 'result');
    assert.deepEqual(via.value, structuredClone(direct));
    g.step(TICKS_PER_DAY / 2);
    h.host.receive({ type: 'step', ticks: TICKS_PER_DAY / 2 });
  }
  assert.equal(stateText(h.host.game), stateText(g));
});

test('a save written through the host loads through the host and continues identically', () => {
  const g = newGame(NEIGH);
  g.step(TICKS_PER_DAY);
  const h = hostWith(); initNeigh(h);
  h.host.receive({ type: 'step', ticks: TICKS_PER_DAY });
  const text = h.ask({ type: 'save' }).value;
  assert.equal(text, serializeGame(g));
  const h2 = hostWith();
  h2.host.receive({ type: 'init', packages: PACKAGES, enabled: ['core'], save: text, debugThrow: true });
  assert.equal(h2.out[0].type, 'ready');
  g.step(TICKS_PER_DAY / 2);
  h2.host.receive({ type: 'step', ticks: TICKS_PER_DAY / 2 });
  assert.equal(stateText(h2.host.game), stateText(g));
});

test('frames: the id list only when it changes, each log line once, the whole terrain first', () => {
  const h = hostWith(); initNeigh(h);
  const g = h.host.game;
  const first = h.last('frame');
  assert.ok(first.movers.ids.length >= 1 && first.movers.pos.length === first.movers.ids.length * MOVER_STRIDE);
  assert.equal(first.terrain.all, true);
  assert.equal(first.terrain.idx.length, g.W * g.H);
  const logged = [...first.log];
  for (let k = 0; k < 40; k++) { h.host.receive({ type: 'step', ticks: 30 }); logged.push(...h.last('frame').log); }
  assert.equal(h.last('frame').movers.ids, null, 'same people, so no id list');
  // Each person's numbers: where they are, where their step started and how far through it they are.
  const ids = first.movers.ids, pos = h.last('frame').movers.pos;
  ids.forEach((id, k) => {
    if (!id.startsWith('c:')) return;
    const c = g.s.colonists[id.slice(2)], o = k * MOVER_STRIDE;
    if (!c) return;
    assert.deepEqual([pos[o], pos[o + 1]], [c.x, c.y]);
    if (c.mv) { assert.deepEqual([pos[o + 2], pos[o + 3]], [c.mv.fx, c.mv.fy]); assert.ok(Math.abs(pos[o + 4] - Math.min(1, c.mv.t / c.mv.dur)) < 1e-6); }
    else assert.deepEqual([pos[o + 2], pos[o + 3], pos[o + 4]], [c.x, c.y, 1]);
  });
  assert.equal(h.last('frame').tick, g.s.tick);
  // Every line the game kept was sent, in order (trimming removes lines, never reorders them).
  const kept = g.s.log.map((e) => JSON.stringify(e)), sent = logged.map((e) => JSON.stringify(e));
  let j = 0; for (const k of kept) { while (j < sent.length && sent[j] !== k) j++; assert.ok(j++ < sent.length, 'kept but never sent: ' + k.slice(0, 120)); }
  assert.equal(new Set(logged.map((e) => e.id).filter(Boolean)).size, logged.filter((e) => e.id).length, 'no event twice');
  // A tile change arrives as its chunk's terrain, not the whole map.
  h.host.receive({ type: 'step', ticks: 0 });
  const c = g.s.settlements[g.s.playerSettlement].center;
  g.markDirty(c.x, c.y);
  h.host.receive({ type: 'step', ticks: 0 });
  const t = h.last('frame').terrain;
  assert.equal(t.all, false);
  assert.equal(t.chunks.length, 1);
  const ch = t.chunks[0];
  assert.ok(c.x >= ch.x && c.x < ch.x + ch.w && c.y >= ch.y && c.y < ch.y + ch.h);
  assert.equal(ch.idx[(c.y - ch.y) * ch.w + (c.x - ch.x)], g._ts.idx[g.i(c.x, c.y)]);
});

test('the camera gets what lies in view, as copies the game never sees', () => {
  const h = hostWith(); initNeigh(h);
  const g = h.host.game;
  h.host.receive({ type: 'step', ticks: TICKS_PER_DAY / 4 });
  const c = g.s.settlements[g.s.playerSettlement].center;
  h.host.receive({ type: 'camera', x0: c.x - 20, y0: c.y - 15, w: 40, h: 30 });
  const a = h.last('frame').area;
  assert.ok(a, 'a paused host sends a frame for a new camera');
  assert.ok(a.structures.length > 0 && a.people.length > 0, JSON.stringify({ s: a.structures.length, p: a.people.length }));
  const st = a.structures[0];
  assert.deepEqual(st, g.s.structures[st.id]);
  st.x = -99; a.people[0].x = -99;
  assert.notEqual(g.s.structures[st.id].x, -99);
  // Clipped to the map, and to 256 tiles a side.
  const big = areaSnapshot(g, -50, -50, 5000, 5000);
  assert.deepEqual([big.x0, big.y0], [0, 0]);
  assert.ok(big.x1 <= Math.min(g.W, 256) && big.y1 <= Math.min(g.H, 256));
});

test('a tile change out of view does not resend the camera contents early; one in view does', () => {
  const clock = { t: 0 };
  const h = hostWith(clock); initNeigh(h);
  const g = h.host.game, c = g.s.settlements[g.s.playerSettlement].center;
  h.host.receive({ type: 'camera', x0: c.x - 10, y0: c.y - 10, w: 20, h: 20 });
  assert.ok(h.last('frame').area);
  const far = { x: c.x < g.W / 2 ? g.W - 1 : 0, y: c.y < g.H / 2 ? g.H - 1 : 0 };
  g.markDirty(far.x, far.y); h.host.receive({ type: 'step', ticks: 0 });
  assert.ok(h.last('frame').terrain && !h.last('frame').area, 'out of view: terrain, no area');
  g.markDirty(c.x, c.y); h.host.receive({ type: 'step', ticks: 0 });
  assert.ok(h.last('frame').area, 'in view: the area');
  h.host.receive({ type: 'step', ticks: 0 });
  assert.ok(!h.last('frame').area, 'nothing new, clock frozen: no area');
  clock.t += 300; h.host.receive({ type: 'step', ticks: 0 });
  assert.ok(h.last('frame').area, 'a quarter second later: the area again');
});

test('overlays (fires, caravans, travellers) at most 4 times a second; herds and bodies with the camera', () => {
  const clock = { t: 0 };
  const h = hostWith(clock); initNeigh(h);
  const g = h.host.game;
  assert.ok(h.last('frame').overlays, 'the first frame carries them');
  h.host.receive({ type: 'step', ticks: 1 });
  assert.equal(h.last('frame').overlays, undefined, 'clock frozen: not again');
  const c = g.s.settlements[g.s.playerSettlement].center, i = g.i(c.x, c.y);
  (g.s.disasters ||= {}).fires = { [i]: g.s.tick };
  (g.s.bodies ||= {}).b1 = { id: 'b1', cid: 'c0', settlementId: g.s.playerSettlement, x: c.x, y: c.y, tick: g.s.tick };
  clock.t += 300; h.host.receive({ type: 'step', ticks: 0 });
  assert.deepEqual(h.last('frame').overlays.fires, { [i]: g.s.tick });
  h.host.receive({ type: 'camera', x0: c.x - 5, y0: c.y - 5, w: 10, h: 10 });
  assert.deepEqual(h.last('frame').area.bodies.map((b) => b.id), ['b1']);
  const herd = Object.values(g.s.animals?.herds || {})[0];
  if (herd) {
    h.host.receive({ type: 'camera', x0: herd.x - 2, y0: herd.y - 2, w: 5, h: 5 });
    assert.ok(h.last('frame').area.herds.some((x) => x.id === herd.id && x.n === herd.n));
  }
  assert.equal(h.ask({ type: 'query', kind: 'overlays' }).value.fires[i], g.s.tick);
});

test('territory: the whole owner grid first, then only when it changes, at most hourly', async () => {
  const { territorySince } = await import('../src/sim/view.js');
  const h = hostWith(); initNeigh(h);
  const g = h.host.game, first = h.last('frame').territory;
  assert.ok(first && first.w === g.W && first.h === g.H, 'the whole map first');
  const T = g.territoryGrid(), c = g.s.settlements[g.s.playerSettlement].center;
  assert.equal(first.ids[first.grid[c.y * first.w + c.x]], g.s.playerSettlement, 'the village owns its centre');
  assert.equal(first.grid.length, T.grid.length);
  const again = territorySince(g, territorySince(g, null).next);
  assert.equal(again.territory, null, 'nothing changed: nothing sent');
  h.host.receive({ type: 'step', ticks: 1 });
  assert.equal(h.last('frame').territory, undefined, 'not within the hour');
});

test('village and god reports for an inspector, without changing the game', () => {
  const h = hostWith(); initNeigh(h);
  const g = h.host.game, p = g.s.playerSettlement;
  h.host.receive({ type: 'step', ticks: TICKS_PER_DAY });
  const before = stateText(g);
  const v = h.ask({ type: 'query', kind: 'village', sid: p }).value;
  assert.equal(v.id, p);
  assert.deepEqual(v.people.map((x) => x.id), g.villagers(p).map((c) => c.id));
  assert.ok(v.people.every((x) => typeof x.mood === 'number' && ['content', 'fine', 'unhappy', 'miserable'].includes(x.level)));
  assert.ok(Array.isArray(v.goods) && Array.isArray(v.laws) && Array.isArray(v.met) && Array.isArray(v.petitions));
  assert.equal(h.ask({ type: 'query', kind: 'village', sid: 'nobody' }).value, null);
  const god = h.ask({ type: 'query', kind: 'god' }).value;
  assert.ok(god.laws.length >= 1 && god.laws.every((L) => L.values.length >= 2));
  assert.ok(god.animals.length >= 1 && Array.isArray(god.cards) && Array.isArray(god.petitions));
  assert.equal(stateText(g), before, 'reading changes nothing');
});

test('calls, queries and errors', () => {
  const h = hostWith();
  assert.equal(h.ask({ type: 'step', ticks: 1 }).type, 'error', 'nothing before init');
  initNeigh(h);
  const g = h.host.game, p = g.s.playerSettlement;
  const found = h.ask({ type: 'call', fn: 'canFound', args: [p] });
  assert.equal(found.type, 'result');
  assert.equal(typeof found.value.ok, 'boolean');
  assert.equal(h.ask({ type: 'call', fn: 'tick', args: [] }).type, 'error', 'only the listed calls');
  assert.equal(h.ask({ type: 'call', fn: 'constructor', args: [] }).type, 'error');
  const cid = Object.keys(g.s.colonists)[0];
  const q = h.ask({ type: 'query', kind: 'colonist', cid });
  assert.equal(q.value.colonist.id, cid);
  assert.ok(q.value.explain);
  assert.equal(h.ask({ type: 'query', kind: 'world' }).value.length, Object.keys(g.s.settlements).length);
  assert.equal(h.ask({ type: 'query', kind: 'entity', coll: 'colonists', eid: cid }).value, null, 'not a listed collection');
  assert.equal(h.ask({ type: 'query', kind: 'nope' }).type, 'error');
  assert.equal(h.ask({ type: 'bogus' }).type, 'error');
});

test('speed: 60 ticks a second at 1x, and a slow machine never owes more than a second', () => {
  const clock = { t: 0 };
  const h = hostWith(clock); initNeigh(h);
  const g = h.host.game, t0 = g.s.tick;
  h.host.receive({ type: 'speed', speed: 1 });
  for (let k = 0; k < 60; k++) { clock.t += 1000 / 60; h.timers.shift()(); }
  assert.ok(Math.abs(g.s.tick - t0 - TICKS_PER_SECOND) <= 1, `ticks run in a second: ${g.s.tick - t0}`);
  const t1 = g.s.tick;
  clock.t += 10_000; h.timers.shift()(); // the machine stalled for 10 s
  assert.ok(g.s.tick - t1 <= TICKS_PER_SECOND, `caught up at most a second: ${g.s.tick - t1}`);
  h.host.receive({ type: 'speed', speed: 0 });
  const n = h.timers.length;
  h.timers.splice(0).forEach((f) => f()); // a timer already queued does nothing once paused
  assert.equal(h.timers.length, 0, `no new timers after a pause (had ${n})`);
});

test('logSince: each line once, also when trimming removes lines sent before', () => {
  const g = newGame(NEIGH);
  g.step(50);
  const sent = new WeakSet();
  assert.equal(logSince(g, sent).length, g.s.log.length, 'everything at first');
  g.log('one'); g.log('two');
  assert.deepEqual(logSince(g, sent).map((e) => e.msg), ['one', 'two']);
  g.log('three', 'info', 'k1'); g.log('four', 'info', 'k2'); // two lines in the same tick
  g.s.log.splice(g.s.log.length - 4, 2); // the newest lines sent ('one', 'two') are trimmed out of the middle
  g.log('five');
  assert.deepEqual(logSince(g, sent).map((e) => e.msg), ['three', 'four', 'five']);
  assert.deepEqual(logSince(g, sent), []);
});

test('messages cannot reach a prototype: ids are checked, and prototype keys refused', () => {
  const h = hostWith(); initNeigh(h);
  const g = h.host.game;
  for (const args of [['__proto__', 'core:work_hours', 'long'], ['constructor', 'core:work_hours', 'long'], ['nobody', 'core:work_hours', 'long']]) {
    assert.equal(h.ask({ type: 'call', fn: 'setCivLaw', args }).type, 'error', JSON.stringify(args));
  }
  assert.equal(h.ask({ type: 'call', fn: 'setCivLaw', args: [g.s.playerSettlement, '__proto__', 'x'] }).type, 'error');
  assert.equal(h.ask({ type: 'command', power: 'omen', args: JSON.parse('{"__proto__": {"x": 1}}') }).type, 'error');
  assert.equal(h.ask({ type: 'query', kind: 'entity', coll: 'settlements', eid: '__proto__' }).type, 'error');
  assert.equal(h.ask({ type: 'query', kind: 'colonist', cid: 'toString' }).value, null);
  assert.equal(({}).code, undefined, 'Object.prototype untouched');
  assert.equal(h.ask({ type: 'query', kind: 'entity', coll: 'settlements', eid: g.s.playerSettlement }).value.id, g.s.playerSettlement);
});

test('an error while the game runs pauses it and says so', () => {
  const clock = { t: 0 };
  const h = hostWith(clock); initNeigh(h);
  const g = h.host.game;
  h.host.receive({ type: 'speed', speed: 1 });
  clock.t += 100; h.timers.shift()();
  const tick = g.s.tick;
  g.tick = () => { throw new Error('boom'); };
  clock.t += 100; h.timers.shift()();
  const err = h.last('error');
  assert.equal(err.of, 'tick');
  assert.match(err.message, /boom/);
  assert.equal(h.timers.length, 0, 'no timer left: the game is paused');
  assert.equal(g.s.tick, tick);
});

test('in a real worker thread: the same save as the host in this thread, and frames at the game speed', async () => {
  const { Worker } = await import('node:worker_threads');
  const w = new Worker(new URL('../tools/node-worker.mjs', import.meta.url));
  const got = [];
  const waitFor = (pred, ms = 20_000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out; last: ' + JSON.stringify(got.at(-1))?.slice(0, 200))), ms);
    const check = () => { const m = got.find(pred); if (m) { clearTimeout(t); resolve(m); } else setTimeout(check, 10); };
    check();
  });
  w.on('message', (m) => got.push(m));
  try {
    w.postMessage({ type: 'init', packages: PACKAGES, enabled: ['core'], opts: createOpts(NEIGH), debugThrow: true });
    await waitFor((m) => m.type === 'ready');
    w.postMessage({ type: 'step', ticks: 200 });
    w.postMessage({ type: 'save', id: 'a' });
    const saved = await waitFor((m) => m.id === 'a');
    const h = hostWith(); initNeigh(h);
    h.host.receive({ type: 'step', ticks: 200 });
    assert.equal(saved.value, h.ask({ type: 'save' }).value, 'the worker runs the same game');
    const frame = got.filter((m) => m.type === 'frame').at(-1);
    assert.ok(frame.movers.pos instanceof Float32Array, 'positions arrive as a typed array');
    // Half a second at 1x: about 30 ticks, in frames of a few ticks each.
    const n0 = got.length, t0 = frame.tick;
    w.postMessage({ type: 'speed', speed: 1 });
    await new Promise((r) => setTimeout(r, 500));
    w.postMessage({ type: 'speed', speed: 0 });
    w.postMessage({ type: 'save', id: 'b' });
    await waitFor((m) => m.id === 'b');
    const frames = got.slice(n0).filter((m) => m.type === 'frame');
    const ran = frames.at(-1).tick - t0;
    assert.ok(frames.length >= 10, `frames in half a second: ${frames.length}`);
    assert.ok(ran >= 15 && ran <= 40, `ticks in half a second at 1x: ${ran}`);
  } finally {
    await w.terminate();
  }
});
