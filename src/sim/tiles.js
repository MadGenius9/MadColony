// Per-tile storage at run time (Phase 2b). Derived from the saved state and never saved itself:
// - terrain: one byte per tile (a palette index; two bytes past 256 kinds) instead of a string pointer;
// - the six per-tile indexes (node, structure, stack, crop, building-site footprint, zone): an Int32Array of
//   handles per layer, each handle naming an id kept in a small table (only occupied tiles cost more).
// The saved layout is unchanged: s.map.terrain still reads and writes like the plain list of terrain ids
// (a view onto the bytes, used by tests, the UI and JSON), and saves write the same JSON as before. The sim
// itself reads and writes the layers only through the Game accessors (game.js).

const STORES = new WeakMap(); // terrain view (s.map.terrain at run time) -> its TerrainStore

/** A per-tile layer of ids (or null). */
export class IdLayer {
  constructor(n) {
    this.n = n;
    this.a = new Int32Array(n); // handle per tile, 0 = none
    this.ids = [null]; // handle -> id
    this.free = []; // handles to reuse
    this.view = null;
  }
  get(i) { const h = this.a[i]; return h ? this.ids[h] : null; }
  set(i, id) {
    if (!(i >= 0 && i < this.n)) return; // outside the map: nothing to store (no handle handed out)
    const h = this.a[i];
    if (id === null || id === undefined) {
      if (h) { this.ids[h] = null; this.free.push(h); this.a[i] = 0; }
      return;
    }
    if (h) { this.ids[h] = id; return; }
    const k = this.free.length ? this.free.pop() : this.ids.length;
    this.ids[k] = id;
    this.a[i] = k;
  }
}

/** A per-tile layer of ids that is empty on most of the map (structures, stacks, crops, sites, zones): the
 *  handles are kept in blocks of 1024 consecutive tiles, made when the block gets its first entry, so
 *  wilderness costs nothing per tile. Same interface as IdLayer. */
export class SparseIdLayer {
  constructor(n) {
    this.n = n;
    this.blocks = new Array((n + 1023) >> 10); // block -> Int32Array(1024) of handles, or undefined
    this.ids = [null];
    this.free = [];
    this.view = null;
  }
  get(i) {
    const b = this.blocks[i >> 10];
    if (b === undefined) return null;
    const h = b[i & 1023];
    return h ? this.ids[h] : null;
  }
  set(i, id) {
    if (!(i >= 0 && i < this.n)) return;
    let b = this.blocks[i >> 10];
    const o = i & 1023;
    if (id === null || id === undefined) {
      const h = b === undefined ? 0 : b[o];
      if (h) { this.ids[h] = null; this.free.push(h); b[o] = 0; }
      return;
    }
    if (b === undefined) b = this.blocks[i >> 10] = new Int32Array(1024);
    const h = b[o];
    if (h) { this.ids[h] = id; return; }
    const k = this.free.length ? this.free.pop() : this.ids.length;
    this.ids[k] = id;
    b[o] = k;
  }
}

/** Terrain ids as palette indexes. */
export class TerrainStore {
  constructor(arr) {
    const n = arr.length;
    this.n = n;
    this.pal = [];
    this.ix = new Map();
    this.idx = new Uint8Array(n);
    let prev, pk = -1;
    for (let i = 0; i < n; i++) {
      const t = arr[i];
      if (t !== prev || pk < 0) { prev = t; pk = this.code(t); }
      this.idx[i] = pk;
    }
    this.rev = 0; // bumped when the palette grows (cached per-palette tables are rebuilt)
  }
  code(id) {
    let k = this.ix.get(id);
    if (k === undefined) {
      k = this.pal.length;
      if (k === 256 && this.idx instanceof Uint8Array) this.idx = Uint16Array.from(this.idx);
      if (k === 65536) throw new Error('more than 65536 terrain kinds');
      this.pal.push(id); this.ix.set(id, k); this.rev++;
    }
    return k;
  }
  get(i) { return this.pal[this.idx[i]]; }
  set(i, id) { this.idx[i] = this.code(id); }
  /** A plain array of terrain ids (for writing saves). */
  toArray() {
    const n = this.n, out = new Array(n), pal = this.pal, idx = this.idx;
    for (let i = 0; i < n; i++) out[i] = pal[idx[i]];
    return out;
  }
}

const isIndex = (p) => { const c = p.charCodeAt(0); return c >= 48 && c <= 57 && String(+p) === p; };

/** An array-like view (a Proxy over an empty array, so Array.isArray is true and array methods, iteration and
 *  JSON work) whose element i is get(i) and whose element writes call set(i, v). Slow per element: for tests,
 *  tools and old callers only; the sim uses the accessors. */
function arrayView(n, get, set) {
  return new Proxy([], {
    get(t, p, r) {
      if (typeof p === 'string') {
        if (p === 'length') return n;
        if (isIndex(p)) { const i = +p; return i < n ? get(i) : undefined; }
      }
      return Reflect.get(t, p, r);
    },
    set(t, p, v, r) {
      if (typeof p === 'string' && isIndex(p)) { const i = +p; if (i < n) { set(i, v); return true; } return false; }
      if (p === 'length') return v === n;
      return Reflect.set(t, p, v, r);
    },
    has(t, p) { if (typeof p === 'string' && isIndex(p)) return +p < n; return Reflect.has(t, p); },
    deleteProperty(t, p) { if (typeof p === 'string' && isIndex(p)) return false; return Reflect.deleteProperty(t, p); },
    ownKeys(t) { const k = []; for (let i = 0; i < n; i++) k.push(String(i)); k.push('length'); return k; },
    getOwnPropertyDescriptor(t, p) {
      if (typeof p === 'string' && isIndex(p) && +p < n) return { value: get(+p), writable: true, enumerable: true, configurable: true };
      return Reflect.getOwnPropertyDescriptor(t, p);
    },
  });
}

/** The view of an id layer (g.tNode etc., kept for old callers). */
export function layerView(layer) {
  return (layer.view ||= arrayView(layer.n, (i) => layer.get(i), (i, v) => layer.set(i, v)));
}

/** The terrain store of a state, converting its plain s.map.terrain into a store and installing the view in
 *  its place on first use (a state already converted keeps its store). */
export function terrainStoreOf(map) {
  let st = STORES.get(map.terrain);
  if (st && st.n === map.w * map.h) return st;
  st = new TerrainStore(map.terrain);
  const view = arrayView(st.n, (i) => st.pal[st.idx[i]], (i, v) => st.set(i, v));
  STORES.set(view, st);
  map.terrain = view;
  return st;
}
