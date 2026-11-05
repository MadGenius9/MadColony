// What a UI running apart from the simulation needs each frame (docs/proposals/sim-worker.md, slice 1).
// Pure readers: nothing here changes the game, draws a random number or is saved. Every result is plain data
// (numbers, strings, plain objects and arrays, typed arrays) that postMessage can copy. Results may hold the
// game's own objects: the sender copies them once (simhost.js: structuredClone, or postMessage in a worker), and
// nothing may change them in between. The caller keeps the markers (`since`) between frames; a fresh marker
// (null) means "everything".
// Cost (grown world, 868 people): movers O(people + animals + monsters), about 0.05 ms; changed chunks O(chunks)
// (3,072 on the World preset); log O(new lines); an area O(its tiles), 2-16 ms for 64x40 to 256x160 tiles.
import { CHUNK } from './constants.js';

const AREA_MAX = 512; // the largest area side sent at once, in tiles

/** Everything that moves: people, wild monsters, tame animals. `ids` is the id list, sent only when it differs
 *  from `prevKey` (the key from the last call); `pos` holds x, y per mover in that order. */
export function moversFrame(g, prevKey = null) {
  const s = g.s, ids = [], xy = [];
  const add = (kind, list) => { for (const e of Object.values(list || {})) { ids.push(kind + ':' + e.id); xy.push(e.x, e.y); } };
  add('c', s.colonists);
  add('m', s.monsters?.list);
  add('t', s.livestock?.list);
  const key = ids.join(',');
  return { key, ids: key === prevKey ? null : ids, pos: Float32Array.from(xy) };
}

/** The chunks whose tiles changed (terrain, nodes, structures; game.js tileChanged) since the count `since`.
 *  `all`: everything changed (or the first call). `n`: the count to pass next time. */
export function changedChunks(g, since = null) {
  const ch = g._chg;
  if (!ch) return { n: 0, all: true, chunks: [] };
  if (since === null || ch.all > since) return { n: ch.n, all: true, chunks: [] };
  const chunks = [];
  for (let k = 0; k < ch.rev.length; k++) if (ch.rev[k] > since) chunks.push(k);
  return { n: ch.n, all: false, chunks, size: CHUNK, cw: g.CW };
}

/** Log lines written since the entry `last` (the object returned as `last` by the previous call). The log is
 *  trimmed from its old end, so the search runs back from the newest line. If `last` is gone (trimmed, or a
 *  different game), the lines after its tick are sent. */
export function logSince(g, last = null) {
  const log = g.s.log || [];
  if (!log.length) return { entries: [], last: null };
  const newest = log[log.length - 1];
  if (last === newest) return { entries: [], last };
  let i = log.length - 1;
  if (last) {
    while (i >= 0 && log[i] !== last) i--;
    if (i < 0) { i = log.length - 1; while (i >= 0 && log[i].t > last.t) i--; }
  } else i = -1;
  return { entries: log.slice(i + 1), last: newest };
}

/** What lies in the rectangle (x0, y0, w, h), clipped to the map and to AREA_MAX a side: structures, stacks, crops
 *  and nodes with a tile in it, building projects whose site is in it, and the display fields of the people in it.
 *  The game's own objects (copy them before handing them on). */
export function areaSnapshot(g, x0, y0, w, h) {
  const X0 = Math.max(0, Math.floor(x0)), Y0 = Math.max(0, Math.floor(y0));
  const X1 = Math.min(g.W, X0 + Math.min(AREA_MAX, Math.max(0, Math.ceil(w)))), Y1 = Math.min(g.H, Y0 + Math.min(AREA_MAX, Math.max(0, Math.ceil(h))));
  const s = g.s, out = { x0: X0, y0: Y0, x1: X1, y1: Y1, structures: [], stacks: [], crops: [], nodes: [], projects: [], people: [] };
  const seen = new Set();
  const take = (list, id, coll) => { if (id && !seen.has(id) && coll[id]) { seen.add(id); list.push(coll[id]); } };
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
    const i = g.i(x, y);
    take(out.structures, g.structIdAt(i), s.structures);
    take(out.stacks, g.stackIdAt(i), s.stacks);
    take(out.crops, g.cropIdAt(i), s.crops);
    take(out.nodes, g.nodeIdAt(i), s.nodes);
    take(out.projects, g.footIdAt(i), s.projects);
  }
  for (const c of Object.values(s.colonists)) {
    if (c.x < X0 || c.y < Y0 || c.x >= X1 || c.y >= Y1) continue;
    out.people.push({ id: c.id, name: c.name, settlementId: c.settlementId, x: c.x, y: c.y, color: c.color, look: c.look, stage: c.stage, sleeping: !!c.sleeping, status: c.status ?? null, job: c.job?.type ?? null });
  }
  return out;
}

/** The villages as the zoomed-out world view draws them: name, colour, centre, detail, people, kingdom and
 *  whether it has fallen. */
export function worldSummary(g) {
  const out = [];
  for (const st of Object.values(g.s.settlements || {})) {
    out.push({ id: st.id, name: st.name, color: st.color, center: st.center ? { x: st.center.x, y: st.center.y } : null, detail: st.detail === 'abstract' ? 'abstract' : 'full', people: g.owned('colonists', st.id).length, kingdom: st.kingdom ?? null, fallen: !!st.fallen });
  }
  return out;
}
