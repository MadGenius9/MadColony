// What a UI running apart from the simulation needs each frame (docs/proposals/sim-worker.md, slice 1).
// Pure readers: nothing here changes the game, draws a random number or is saved. Every result is plain data
// (numbers, strings, plain objects and arrays, typed arrays) that postMessage can copy. Results may hold the
// game's own objects: the sender copies them once (simhost.js: structuredClone, or postMessage in a worker), and
// nothing may change them in between. The caller keeps the markers (`since`) between frames; a fresh marker
// (null) means "everything".
// Cost (grown world, 868 people): movers O(people + animals + monsters), about 0.05 ms; changed chunks O(chunks)
// (3,072 on the World preset); log O(new lines); an area O(its tiles), 2-16 ms for 64x40 to 256x160 tiles.
import { CHUNK } from './constants.js';
import { claimsDirtySince } from './territory.js';
import { leaderOf } from './leaders.js';
import { codeOf } from './civlaws.js';
import { unrestOf } from './unrest.js';
import { memoriesOf } from './memories.js';
import { petitionsOf } from './petitions.js';
import { outcomeCards } from './followup.js';
import { activeLaws } from './worldlaws.js';
import { relationPeek, relationStatus } from './villages.js';
import { isEnemy } from './combat.js';
import { moodLevel } from './mood.js';
import { ageYears } from './life.js';
import { partnerOf } from './family.js';
import { sicknessOf } from './illness.js';

const AREA_MAX = 256; // the largest area side sent at once, in tiles (256x160 measured at 16 ms; zoomed further out
                      // the world view draws summaries)

/** Everything that moves: people, wild monsters, tame animals. `ids` is the id list, sent only when it differs
 *  from `prevKey` (the key from the last call); `pos` holds MOVER_STRIDE numbers per mover in that order: x, y
 *  (the tile it is on or stepping onto), fx, fy (the tile its current step started from; x, y when standing) and
 *  the step's progress 0..1 (1 when standing), from the step in progress (`mv`, ai/jobs.js), so the UI can draw it
 *  between tiles and face it the way it walks. */
export const MOVER_STRIDE = 5;
export function moversFrame(g, prevKey = null) {
  const s = g.s, ids = [], xy = [];
  const add = (kind, list) => {
    for (const e of Object.values(list || {})) {
      ids.push(kind + ':' + e.id);
      const mv = e.mv;
      if (mv && mv.dur > 0) xy.push(e.x, e.y, mv.fx, mv.fy, Math.min(1, mv.t / mv.dur));
      else xy.push(e.x, e.y, e.x, e.y, 1);
    }
  };
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

/** Log lines not sent yet. `sent` is a WeakSet the caller keeps between frames; the lines returned are added to
 *  it. New lines are always appended at the log's end, and trimLog (chronicle.js) removes old lines from anywhere
 *  before them (the oldest routine line first, events past their cap), so the unsent lines are exactly the ones
 *  after the newest line already sent: the search runs back from the end until it meets one. If none of the sent
 *  lines is left (a fresh WeakSet, or more new lines than the log keeps), every line is new. A mirror of the log
 *  must apply its own cap: what the game keeps is not always a suffix of what was sent. */
export function logSince(g, sent) {
  const log = g.s.log || [];
  let i = log.length;
  while (i > 0 && !sent.has(log[i - 1])) i--;
  const entries = log.slice(i);
  for (const e of entries) sent.add(e);
  return entries;
}

/** What lies in the rectangle (x0, y0, w, h), clipped to the map and to AREA_MAX a side: structures, stacks, crops
 *  and nodes with a tile in it, building projects whose site is in it, and the display fields of the people in it.
 *  The game's own objects (copy them before handing them on). */
export function areaSnapshot(g, x0, y0, w, h) {
  const X0 = Math.max(0, Math.floor(x0)), Y0 = Math.max(0, Math.floor(y0));
  const X1 = Math.min(g.W, X0 + Math.min(AREA_MAX, Math.max(0, Math.ceil(w)))), Y1 = Math.min(g.H, Y0 + Math.min(AREA_MAX, Math.max(0, Math.ceil(h))));
  const s = g.s, out = { x0: X0, y0: Y0, x1: X1, y1: Y1, structures: [], stacks: [], crops: [], nodes: [], projects: [], people: [], herds: [], bodies: [] };
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
  const inside = (e) => e.x >= X0 && e.y >= Y0 && e.x < X1 && e.y < Y1;
  for (const h of Object.values(s.animals?.herds || {})) if (inside(h)) out.herds.push({ id: h.id, sp: h.sp, x: h.x, y: h.y, n: h.n }); // wild herds by their centre (animals.js)
  for (const b of Object.values(s.bodies || {})) if (inside(b)) out.bodies.push(b); // the dead waiting for burial (burial.js)
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

/** What lies over the whole world and changes on its own: fires and scorched ground (tile index -> tick), storms,
 *  rain and drought, the plague, caravans (with their start, end and times, so the UI can move them between
 *  messages) and contact travellers (explorers by their chunk route, traders centre to centre). Absent parts are
 *  null. The game's own objects (copy them before handing them on). */
export function overlays(g) {
  const s = g.s, D = s.disasters;
  return {
    fires: D?.fires ?? null, scorched: D?.scorched ?? null, storms: D?.storms ?? null, weather: D?.weather ?? null, plague: D?.plague ?? null,
    caravans: s.caravans ?? null, travellers: s.contact?.t ?? null,
  };
}

/** Who owns which tiles, for the world view: the part of the owner grid that changed since `since` (the marker
 *  returned last time; null: everything), as { ids, x0, y0, w, h, grid } with grid[(y - y0) * w + (x - x0)] an
 *  index into ids (0xffff: nobody), plus the next marker; or { territory: null } when nothing changed. Organic
 *  games send the rectangle their claims changed in (territory.js claimsDirtySince); nearest-centre games the
 *  whole map when a village is founded or moves (their grid's sig). Reads derived caches only. */
export function territorySince(g, since = null) {
  const T = g.territoryGrid();
  let r;
  if (g._cl) {
    const d = claimsDirtySince(g, since === null ? -1 : since);
    if (!d) return { territory: null, next: since };
    if (d.x1 < d.x0 || d.y1 < d.y0) return { territory: null, next: d.rev };
    r = { x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1, next: d.rev };
  } else {
    if (since === T.sig) return { territory: null, next: since };
    r = { x0: 0, y0: 0, x1: g.W - 1, y1: g.H - 1, next: T.sig };
  }
  const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1, grid = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) grid.set(T.grid.subarray((r.y0 + y) * g.W + r.x0, (r.y0 + y) * g.W + r.x0 + w), y * w);
  return { territory: { ids: T.ids.slice(), x0: r.x0, y0: r.y0, w, h, grid }, next: r.next };
}

/** One village for an inspector: who lives there (age, mood, job, traits, partner, sickness), its leader, laws away
 *  from their default, unrest, memories and traditions, open prayers, its plan's notes, the goods it holds most of
 *  and every village it has met. Built from the readers the UI uses (docs/integration-contract.md section 4); null
 *  for an unknown village. Copies (the sender copies them again). */
export function villageReport(g, sid) {
  const s = g.s, st = typeof sid === 'string' && Object.hasOwn(s.settlements || {}, sid) ? s.settlements[sid] : null;
  if (!st) return null;
  const people = g.villagers(sid).map((c) => {
    const p = partnerOf(g, c);
    return {
      id: c.id, name: c.name, age: Math.floor(ageYears(g, c)), mood: Math.round(c.mood ?? 0), level: moodLevel(c.mood ?? 0),
      job: c.job?.type ?? null, doing: c.status?.action || c.status?.goal || '', traits: (c.traits || []).map((id) => g.reg.get('trait', id)?.name || id),
      people: g.reg.get('people', c.people)?.name || null, partner: p?.name || null, sick: !!sicknessOf(c),
    };
  });
  const stock = new Map();
  for (const k of g.owned('stacks', sid)) stock.set(k.item, (stock.get(k.item) || 0) + k.qty);
  const goods = [...stock].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 14).map(([id, n]) => ({ id, name: g.reg.get('item', id)?.name || id, n }));
  const met = [];
  for (const o of Object.keys(s.settlements).sort()) {
    if (o === sid) continue;
    const rel = relationPeek(g, sid, o);
    if (!rel.contact) continue;
    met.push({ id: o, name: s.settlements[o].name, value: Math.round(rel.value || 0), status: relationStatus(rel), war: isEnemy(g, sid, o) });
  }
  const P = g.plans?.[sid] || {}, notes = {};
  for (const [k, v] of Object.entries(P)) if (k.endsWith('Note') && typeof v === 'string' && v) notes[k] = v;
  return {
    id: sid, name: st.name, color: st.color, detail: st.detail === 'abstract' ? 'abstract' : 'full', fallen: !!st.fallen,
    kingdom: st.kingdom ? s.kingdoms?.[st.kingdom]?.name || st.kingdom : null, people, leader: leaderOf(g, sid), laws: codeOf(g, sid),
    unrest: unrestOf(g, sid), ...memoriesOf(g, sid), petitions: petitionsOf(g, sid), notes, goods, met,
  };
}

/** The god's view for a side panel: open prayers, the latest outcome cards, world laws (active ones, and every law
 *  with its values for a switch), deaths by cause, and the animal and monster kinds a power can send. */
export function godReport(g) {
  return {
    petitions: petitionsOf(g), cards: outcomeCards(g).slice(0, 8), active: activeLaws(g),
    laws: g.reg.all('worldLaw').map((L) => ({ id: L.id, name: L.name, values: L.values.map((v) => ({ id: v.id, name: v.name })) })),
    deaths: { ...(g.s.stats?.deaths || {}) }, dead: Object.keys(g.s.dead || {}).length, people: Object.keys(g.s.colonists).length,
    animals: g.reg.all('animal').map((d) => ({ id: d.id, name: d.name, herd: d.herd })), monsters: g.reg.all('monster').map((d) => ({ id: d.id, name: d.name })),
  };
}
