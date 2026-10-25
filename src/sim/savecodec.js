// Compact save encoding (save format 4). Big worlds made the two largest parts of a save, the terrain grid
// and the resource nodes, too big for browser storage (a day-0 Colossal world was 5.3 MB). They are now
// written compactly on big worlds (classic worlds keep the plain layout, which they fit in easily);
// everything else in the state is stored as before.
// - map.terrain: { palette: [terrain ids], runs: "<palette index base36>.<run length base36>,..." }
// - nodes: { packed: 1, defs: [node ids], list: [id step, def, x, y, chunks, ...], extra: [[position, node]] }
//   Plain nodes (only id 'n<number>', def, x, y, chunks) go in the flat list, each id as the step from the
//   previous one; any other node is kept whole in `extra` at its position, so insertion order is kept.
// Decoding gives back exactly the same state: same keys in the same places, nodes in the same order. It never
// changes the object it is given.

const PLAIN = /^n(\d+)$/;
const isPlainNode = (n) => {
  const k = Object.keys(n);
  return k.length === 5 && k[0] === 'id' && k[1] === 'def' && k[2] === 'x' && k[3] === 'y' && k[4] === 'chunks'
    && PLAIN.test(n.id) && Number.isInteger(n.x) && Number.isInteger(n.y) && Number.isInteger(n.chunks);
};

export function encodeTerrain(arr) {
  const palette = [], index = new Map(), out = [];
  let prev = null, run = 0;
  const flush = () => { if (run) out.push(index.get(prev).toString(36) + '.' + run.toString(36)); };
  for (const t of arr) {
    if (!index.has(t)) { index.set(t, palette.length); palette.push(t); }
    if (t === prev) { run++; continue; }
    flush(); prev = t; run = 1;
  }
  flush();
  return { palette, runs: out.join(',') };
}

/** encodeTerrain for terrain kept as palette indexes (tiles.js TerrainStore): the same output as
 *  encodeTerrain(store.toArray()), without building the list of ids. */
export function encodeTerrainStore(store) {
  const { idx, pal, n } = store;
  const outIx = new Int32Array(pal.length).fill(-1), palette = [], out = [];
  let prev = -1, run = 0;
  const flush = () => { if (run) out.push(outIx[prev].toString(36) + '.' + run.toString(36)); };
  for (let i = 0; i < n; i++) {
    const k = idx[i];
    if (k === prev) { run++; continue; }
    if (outIx[k] < 0) { outIx[k] = palette.length; palette.push(pal[k]); }
    flush(); prev = k; run = 1;
  }
  flush();
  return { palette, runs: out.join(',') };
}

export function decodeTerrain(enc, size) {
  const out = new Array(size);
  let i = 0;
  if (enc.runs) for (const part of enc.runs.split(',')) {
    const dot = part.indexOf('.');
    const t = enc.palette[parseInt(part.slice(0, dot), 36)];
    const n = parseInt(part.slice(dot + 1), 36);
    for (let k = 0; k < n; k++) out[i++] = t;
  }
  if (i !== size) throw new Error(`terrain has ${i} tiles, expected ${size}`);
  return out;
}

export function encodeNodes(nodes) {
  const defs = [], dIndex = new Map(), list = [], extra = [];
  let prevId = 0, pos = 0;
  for (const n of Object.values(nodes)) {
    if (isPlainNode(n)) {
      if (!dIndex.has(n.def)) { dIndex.set(n.def, defs.length); defs.push(n.def); }
      const num = Number(PLAIN.exec(n.id)[1]);
      list.push(num - prevId, dIndex.get(n.def), n.x, n.y, n.chunks);
      prevId = num;
    } else extra.push([pos, n]);
    pos++;
  }
  return { packed: 1, defs, list, extra };
}

export function decodeNodes(enc) {
  const out = {};
  const L = enc.list || [], extra = enc.extra || [];
  let li = 0, ei = 0, prevId = 0;
  const total = L.length / 5 + extra.length;
  for (let pos = 0; pos < total; pos++) {
    if (ei < extra.length && extra[ei][0] === pos) { const n = extra[ei++][1]; out[n.id] = n; continue; }
    const num = prevId + L[li]; prevId = num;
    const id = 'n' + num;
    out[id] = { id, def: enc.defs[L[li + 1]], x: L[li + 2], y: L[li + 3], chunks: L[li + 4] };
    li += 5;
  }
  return out;
}

/** A copy of the state for writing: terrain and nodes encoded in place (same keys, same order). */
export function encodeState(s, store = null) {
  const map = {};
  for (const k of Object.keys(s.map)) map[k] = k === 'terrain' ? (store ? encodeTerrainStore(store) : encodeTerrain(s.map.terrain)) : s.map[k];
  const out = {};
  for (const k of Object.keys(s)) out[k] = k === 'map' ? map : k === 'nodes' ? encodeNodes(s.nodes) : s[k];
  return out;
}

/** True when this state was written with the compact encoding. */
export const isEncoded = (st) => !!st && ((st.map && st.map.terrain && !Array.isArray(st.map.terrain)) || (st.nodes && st.nodes.packed === 1 && Array.isArray(st.nodes.list)));

/** A decoded copy of an encoded state (the given state is not changed); plain states are returned as they are. */
export function decodeState(st) {
  if (!isEncoded(st)) return st;
  const out = {};
  for (const k of Object.keys(st)) {
    if (k === 'map' && st.map && !Array.isArray(st.map.terrain)) {
      const map = {};
      for (const mk of Object.keys(st.map)) map[mk] = mk === 'terrain' ? decodeTerrain(st.map.terrain, st.map.w * st.map.h) : st.map[mk];
      out.map = map;
    } else if (k === 'nodes' && st.nodes?.packed === 1) out.nodes = decodeNodes(st.nodes);
    else out[k] = st[k];
  }
  return out;
}
