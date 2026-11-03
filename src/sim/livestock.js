// Livestock (Phase 9, slice 3; docs/proposals/phase-9-livestock.md). Tame animals live in s.livestock (format 42,
// optional): { next, list: { l<n>: { id, sp, sid, pen, x, y, hp, led? } }, ledger: { sid: { sp: { tamed, born,
// died: { cause: n } } } } }. They are apart from the wild animals (animals.js never sees them: no fleeing, no
// folding into a herd count, no drift).
// Taming: a hunter of a village with a closed pen (pens.js) walks up to a near wild animal of the pen's species
// and catches it within TAME.catch tiles. In that one step the wild animal leaves its herd (the wild ledger books
// it as died 'tamed') and a tame one is made (this ledger books it as tamed): exactly once. The tamer then leads it
// through the gate into the pen (`led`: it follows the tamer step by step). If the lead is broken off, the animal
// waits where it is, loose, and anyone may lead it in. In the pen, each animal moves a step inside every
// TAME.every ticks (a hash draw, no rng). A village tames up to TAME.pair animals into a pen; births fill it.
// Feed and births (slice 4): once a day (game.js DAILY_JOBS), a pen's grass feeds up to its template's `graze`
// animals outside winter; the others, and all of them in winter, eat a unit of fodder (items tagged core:fodder)
// from the pen's trough (`project.feed`, a count: fodder carried in is booked as consumed, 'fodder'). An animal
// unfed for FEED.starve days in a row dies (ledger 'starved') and leaves its carcass (item ledger). Haulers keep
// the trough at FEED.days days of what the pen eats, from a day before winter on. On a spring day, a pen of fed
// animals with a pair and room has a birth with chance births × animals ÷ the days of spring (a hash draw).
import { killAnimal, herdAnimals, bringNear, herdsWithin, HUNT_LIMIT } from './animals.js';
import { pensOf, penState, PEN } from './pens.js';
import { newJob, travel } from './ai/jobs.js';
import { mayDoWork } from './people.js';
import { seasonOf, climateOf } from './heat.js';
import { TICKS_PER_DAY } from './constants.js';

export const TAME = Object.freeze({ catch: 1.5, giveUp: 1500, pair: 2, every: 10 });
export const FEED = Object.freeze({ starve: 5, days: 3, graze: 6 });

const hash = (str) => {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  return h >>> 0;
};

/** The tame animals of pen p (its project id), in id order (loose and led ones included). */
export const penAnimals = (g, p) => Object.values(g.s.livestock?.list || {}).filter((a) => a.pen === p.id).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));

/** The open ground inside pen p: { x, y } of its template's clear cells (derived, cached by pen). */
export function penInterior(g, p) {
  const C = (g._penCells ||= new Map());
  let v = C.get(p.id);
  if (!v) {
    const tpl = g.reg.get('template', p.templateId);
    v = p.cells.filter(([, , ch]) => tpl?.legend?.[ch]?.clear).map(([x, y]) => ({ x, y }));
    v.set = new Set(v.map((q) => `${q.x},${q.y}`));
    C.set(p.id, v);
  }
  return v;
}
const insidePen = (g, p, x, y) => penInterior(g, p).set.has(`${Math.round(x)},${Math.round(y)}`);
/** Is a being led now (its leader alive and on that very job)? A lead left behind by a death counts as loose. */
const ledNow = (g, a) => !!a.led && g.s.colonists[a.led]?.job?.type === 'tame' && g.s.colonists[a.led].job.tame === a.id;

function ledger(g, sid, sp) {
  const L = (g.s.livestock.ledger[sid] ||= {});
  return (L[sp] ||= { tamed: 0, born: 0, died: {} });
}

/** Wild animal `wildId` is caught by c for pen p: it leaves the wild and becomes tame, led by c. Returns it. */
export function tameInto(g, wildId, p, c) {
  const a = g.s.animals?.list?.[wildId], h = a && g.s.animals.herds[a.herd];
  if (!a || !h) return null;
  const sp = h.sp, d = g.reg.get('animal', sp);
  killAnimal(g, wildId, c.x, c.y, 'tamed');
  const S = (g.s.livestock ||= { next: 1, list: {}, ledger: {} });
  const id = 'l' + S.next++;
  S.list[id] = { id, sp, sid: p.settlement, pen: p.id, x: a.x, y: a.y, hp: d?.health || 1, led: c.id };
  ledger(g, p.settlement, sp).tamed++;
  return S.list[id];
}

/** Every tick (game.js): tame animals in their pens take a step inside now and then. */
export function tickLivestock(g) {
  const S = g.s.livestock;
  if (!S) return;
  const t = g.s.tick;
  for (const id of Object.keys(S.list)) {
    const a = S.list[id];
    if (ledNow(g, a) || (t + Number(id.slice(1))) % TAME.every) continue;
    const p = g.s.projects[a.pen];
    if (!p || g.s.settlements?.[a.sid]?.detail === 'abstract' || !insidePen(g, p, a.x, a.y)) continue; // loose, or a distant village's
    const r = hash(`${g.s.seed}:${id}:${t}`), k = r % 9;
    if (k === 8 || (r >>> 8) % 10 < 6) continue; // most of the time it stands and grazes
    const nx = a.x + (k % 3) - 1, ny = a.y + Math.floor(k / 3) - 1;
    if ((nx !== a.x || ny !== a.y) && insidePen(g, p, nx, ny)) { a.x = nx; a.y = ny; }
  }
}

/** Per village and species: tame animals living against the ledger (tamed + born - died). { ok, problems }. */
export function livestockCensus(g) {
  const S = g.s.livestock, problems = [];
  if (!S) return { ok: true, problems };
  const live = {};
  for (const a of Object.values(S.list)) { const k = `${a.sid}|${a.sp}`; live[k] = (live[k] || 0) + 1; }
  const keys = new Set(Object.keys(live));
  for (const [sid, by] of Object.entries(S.ledger)) for (const sp of Object.keys(by)) keys.add(`${sid}|${sp}`);
  for (const k of keys) {
    const [sid, sp] = k.split('|'), L = S.ledger[sid]?.[sp] || { tamed: 0, born: 0, died: {} };
    const want = L.tamed + L.born - Object.values(L.died).reduce((x, y) => x + y, 0);
    if ((live[k] || 0) !== want) problems.push(`${sp} of ${sid}: ${live[k] || 0} living, the ledger says ${want}`);
  }
  return { ok: !problems.length, problems };
}

/** The tile inside pen p next to its gate (where a led animal is let go). */
function gateInside(g, p) {
  const gate = p.parts.map((id) => g.s.structures[id]).find((b) => b && g.bDef(b)?.passable);
  const cells = penInterior(g, p);
  if (!gate) return cells[0];
  return cells.slice().sort((a, b) => Math.hypot(a.x - gate.x, a.y - gate.y) - Math.hypot(b.x - gate.x, b.y - gate.y) || a.y - b.y || a.x - b.x)[0];
}

export const LIVESTOCK_GIVERS = {
  'core:tame_animals': {
    find(g, c, params, wt) {
      if (!g.s.animals || !mayDoWork(g, c, wt.id)) return [];
      const sid = c.settlementId || g.s.playerSettlement, out = [];
      for (const p of pensOf(g, sid)) {
        if (!penState(g, p).closed) continue;
        const mine = penAnimals(g, p), d = g.reg.get('animal', p.pen.sp);
        for (const a of mine) { // loose ones first: lead them in
          if (ledNow(g, a) || insidePen(g, p, a.x, a.y) || g.isReserved(`lead:${a.id}`, c.id)) continue;
          out.push({ x: a.x, y: a.y, urgency: 0.7, label: `Lead the ${d.tame.name.toLowerCase()} to the pen`, make() {
            const job = newJob('tame', { stage: 'lead', pen: p.id, tame: a.id, started: g.s.tick }, { why: `A ${d.tame.name.toLowerCase()} got loose on the way to the pen`, label: `Lead the ${d.tame.name.toLowerCase()} to the pen`, workType: wt.id, targetKey: `lead:${a.id}` });
            return g.reserveExcl(job, `lead:${a.id}`, c.id) ? job : null;
          } });
        }
        if (mine.length >= Math.min(TAME.pair, g.reg.get('template', p.templateId)?.pen?.animals || TAME.pair)) continue;
        const ctr = g.s.settlements?.[sid]?.center || g.s.center;
        for (const h of herdsWithin(g, ctr.x, ctr.y, PEN.reach)) { // the herds round the village only
          if (h.sp !== p.pen.sp || h.n <= HUNT_LIMIT || Math.hypot(h.x - ctr.x, h.y - ctr.y) > PEN.reach || g.isReserved(`tame:${h.id}`, c.id) || g.isBlocked(`tame:${sid}:${h.id}`)) continue;
          out.push({ x: h.x, y: h.y, urgency: 0.5, label: `Tame a ${d.tame.name.toLowerCase()}`, far: { x: h.x, y: h.y }, make() {
            const job = newJob('tame', { stage: 'catch', pen: p.id, herd: h.id, target: null, gx: null, gy: null, started: g.s.tick }, { why: `Two ${d.tame.plural} for the pen`, label: `Tame a ${d.tame.name.toLowerCase()}`, workType: wt.id, targetKey: `tame:${sid}:${h.id}` });
            if (!g.reserveExcl(job, `tame:${h.id}`, c.id)) return null;
            bringNear(g, h.id); // a far herd becomes animals to catch
            return job;
          } });
        }
      }
      return out;
    },
  },
};

export const LIVESTOCK_DRIVERS = {
  tame: {
    valid(g, c, j) { return !!g.s.projects[j.pen]; },
    tick(g, c, j) {
      const p = g.s.projects[j.pen];
      if (!p || !penState(g, p).closed) return { fail: 'The pen is not closed', cooldown: 600 };
      if (g.s.tick - j.started > TAME.giveUp) return { fail: j.stage === 'catch' ? 'The animal got away' : 'Could not lead the animal in', cooldown: 600 };
      const d = g.reg.get('animal', p.pen.sp);
      if (j.stage === 'catch') {
        const h = g.s.animals?.herds[j.herd];
        if (!h || h.near === undefined || h.n <= HUNT_LIMIT) return 'done';
        let t = j.target && g.s.animals.list?.[j.target];
        if (!t) {
          t = herdAnimals(g, h.id).sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y) || (a.id < b.id ? -1 : 1))[0];
          if (!t) return 'done';
          j.target = t.id;
        }
        c.status.action = `Taming a ${d.tame.name.toLowerCase()}`;
        if (Math.hypot(t.x - c.x, t.y - c.y) > TAME.catch) {
          if (j.gx === null || Math.hypot(t.x - j.gx, t.y - j.gy) > 2) { j.gx = t.x; j.gy = t.y; c.path = null; }
          const r = travel(g, c, j, j.gx, j.gy, 'adj', d.name.toLowerCase());
          if (r === true) { j.gx = null; return 'running'; }
          return r === false ? 'running' : r;
        }
        if (c.mv) { c.mv.t++; if (c.mv.t < c.mv.dur) return 'running'; c.mv = null; }
        const a = tameInto(g, t.id, p, c);
        if (!a) return 'done';
        g.log(`${c.name} caught a ${d.name.toLowerCase()} for the pen.`, 'good');
        j.stage = 'lead'; j.tame = a.id; j.started = g.s.tick; c.path = null;
        return 'running';
      }
      const a = g.s.livestock?.list?.[j.tame];
      if (!a) return 'done';
      if (insidePen(g, p, a.x, a.y) && !a.led) return 'done';
      if (!ledNow(g, a) && a.led !== c.id) { // a loose one: walk up to it first
        if (Math.hypot(a.x - c.x, a.y - c.y) > TAME.catch) { const r = travel(g, c, j, a.x, a.y, 'adj', d.tame.name.toLowerCase()); return r === false || r === true ? 'running' : r; }
        a.led = c.id;
      }
      const to = gateInside(g, p), px = c.x, py = c.y;
      c.status.action = `Leading a ${d.tame.name.toLowerCase()} to the pen`;
      const r = travel(g, c, j, to.x, to.y, 'on', 'the pen');
      if (c.x !== px || c.y !== py) { a.x = Math.round(px); a.y = Math.round(py); } // it follows a step behind
      if (r === true) { a.x = to.x; a.y = to.y; delete a.led; g.log(`${c.name} brought a ${d.tame.name.toLowerCase()} into the pen.`, 'good'); return 'done'; }
      return r === false ? 'running' : r;
    },
    cleanup(g, c, j) { const a = g.s.livestock?.list?.[j.tame]; if (a?.led === c.id) delete a.led; }, // broken off: it waits, loose
  },
};

const capOf = (g, p) => g.reg.get('template', p.templateId)?.pen?.animals || 8;
const grazeOf = (g, p) => g.reg.get('template', p.templateId)?.pen?.graze ?? FEED.graze;
/** How many fodder units pen p's animals eat a day, now or (with ahead) a day from now. */
export function penEats(g, p, n, ahead = 0) { return seasonOf(g, g.s.tick + ahead) === 'Winter' ? n : Math.max(0, n - grazeOf(g, p)); }

/** Once a day (game.js DAILY_JOBS): feeding, starving and spring births, pen by pen (pens in id order). */
export function tickLivestockDay(g) {
  const S = g.s.livestock;
  if (!S) return;
  const day = Math.floor(g.s.tick / TICKS_PER_DAY), byPen = new Map();
  for (const a of Object.values(S.list).sort((x, y) => Number(x.id.slice(1)) - Number(y.id.slice(1)))) { if (!byPen.has(a.pen)) byPen.set(a.pen, []); byPen.get(a.pen).push(a); }
  for (const pid of [...byPen.keys()].sort()) {
    const p = g.s.projects[pid], list = byPen.get(pid);
    if (!p) continue;
    let grass = seasonOf(g) === 'Winter' ? 0 : grazeOf(g, p);
    for (const a of list) {
      const inside = insidePen(g, p, a.x, a.y);
      if (inside && grass > 0) { grass--; a.hungry = 0; continue; }
      if (inside && (p.feed || 0) >= 1) { p.feed -= 1; a.hungry = 0; continue; }
      a.hungry = (a.hungry || 0) + 1;
      if (a.hungry < FEED.starve) continue;
      const d = g.reg.get('animal', a.sp);
      delete S.list[a.id];
      const L = ledger(g, a.sid, a.sp).died; L.starved = (L.starved || 0) + 1;
      if (d?.carcass) g.createItems(d.carcass, 1, a.x, a.y, 'livestock');
      g.log(`A ${d?.tame?.name.toLowerCase() || a.sp} starved in the pen of ${g.s.settlements?.[a.sid]?.name || a.sid}.`, 'warn');
    }
    if (p.feed === 0) delete p.feed;
    const live = list.filter((a) => S.list[a.id]), d = g.reg.get('animal', p.pen?.sp);
    if (!d || seasonOf(g) !== 'Spring' || live.length < 2 || live.length >= capOf(g, p) || live.some((a) => a.hungry)) continue;
    const chance = Math.min(1, ((d.births || 0) * live.length) / Math.max(1, climateOf(g).yearDays / 4));
    if ((hash(`${g.s.seed}:birth:${pid}:${day}`) % 10000) / 10000 >= chance) continue;
    const cells = penInterior(g, p), at = cells[hash(`${g.s.seed}:born:${pid}:${day}`) % cells.length];
    const id = 'l' + S.next++;
    S.list[id] = { id, sp: d.id, sid: p.settlement, pen: pid, x: at.x, y: at.y, hp: d.health || 1 };
    ledger(g, p.settlement, d.id).born++;
    g.log(`A young ${d.tame.name.toLowerCase()} was born in the pen of ${g.s.settlements?.[p.settlement]?.name || p.settlement}.`, 'good');
  }
}

export const FEED_GIVERS = {
  'core:feed_animals': {
    find(g, c, params, wt) {
      const S = g.s.livestock;
      if (!S) return [];
      const sid = c.settlementId || g.s.playerSettlement, out = [];
      for (const p of pensOf(g, sid)) {
        const n = penAnimals(g, p).length;
        const want = n && FEED.days * Math.max(penEats(g, p, n), penEats(g, p, n, TICKS_PER_DAY));
        if (!want || (p.feed || 0) >= want || g.isReserved(`feed:${p.id}`, c.id)) continue;
        let best = null, bd = Infinity;
        for (const it of g.reg.itemsWithTag('core:fodder')) for (const st of g.stacksByItem().get(it) || []) {
          if (!g.mine(st, c) || g.availQty(st.id) <= 0) continue;
          const dd = Math.hypot(st.x - c.x, st.y - c.y);
          if (dd < bd || (dd === bd && st.id < best.id)) { bd = dd; best = st; }
        }
        if (!best) continue;
        const st = best, name = g.reg.get('animal', p.pen.sp)?.tame?.plural || 'animals';
        out.push({ x: st.x, y: st.y, urgency: 0.8, label: `Feed the ${name}`, make() {
          const qty = Math.min(g.availQty(st.id), g.carryLimit(st.item, c), want - (p.feed || 0));
          if (qty <= 0) return null;
          const job = newJob('feed', { stackId: st.id, item: st.item, qty, pen: p.id, stage: 'src' }, { why: `Fodder for the ${name} (${p.feed || 0} of ${want} in the trough)`, label: `Feed the ${name}`, workType: wt.id, targetKey: `feed:${p.id}` });
          if (!g.reserveQty(job, st.id, qty) || !g.reserveExcl(job, `feed:${p.id}`, c.id)) { g.release(job); return null; }
          return job;
        } });
      }
      return out;
    },
  },
};

export const FEED_DRIVERS = {
  feed: {
    valid(g, c, j) { return !!g.s.projects[j.pen] && (j.stage === 'dst' ? !!c.carry : !!g.s.stacks[j.stackId]); },
    tick(g, c, j) {
      const p = g.s.projects[j.pen];
      if (j.stage === 'src') {
        const st = g.s.stacks[j.stackId];
        const r = travel(g, c, j, st.x, st.y, 'on', 'the fodder');
        if (r !== true) return r === false ? 'running' : r;
        g.release(j, (x) => x.k === 'q' && x.key === j.stackId);
        const got = g.takeFromStack(j.stackId, j.qty);
        if (!got || got.qty <= 0) return { fail: 'The fodder is gone' };
        c.carry = got; j.stage = 'dst';
        return 'running';
      }
      const to = gateInside(g, p);
      const r = travel(g, c, j, to.x, to.y, 'on', 'the pen');
      if (r !== true) return r === false ? 'running' : r;
      p.feed = (p.feed || 0) + c.carry.qty;
      g.consume(c.carry.item, c.carry.qty, 'fodder');
      c.carry = null;
      return 'done';
    },
  },
};

/** save.js: s.livestock (format 42) is well formed. */
export function validateLivestock(s, bad) {
  const S = s.livestock, W = s.map?.w || 0, H = s.map?.h || 0;
  const isInt = Number.isInteger, n = (v) => isInt(v) && v >= 0 && v <= 1e12;
  if (!S || typeof S !== 'object' || !isInt(S.next) || S.next < 1 || typeof S.list !== 'object' || typeof S.ledger !== 'object') { bad('state.livestock is malformed'); return; }
  for (const [k, a] of Object.entries(S.list)) {
    const ok = a && a.id === k && /^l\d{1,9}$/.test(k) && Number(k.slice(1)) < S.next && typeof a.sp === 'string' && typeof a.sid === 'string' && typeof a.pen === 'string'
      && isInt(a.x) && isInt(a.y) && a.x >= 0 && a.y >= 0 && a.x < W && a.y < H && typeof a.hp === 'number' && a.hp > 0 && (a.led === undefined || typeof a.led === 'string');
    if (!ok) { bad(`tame animal "${String(k).slice(0, 40)}" is malformed`); return; }
  }
  for (const [sid, by] of Object.entries(S.ledger)) for (const [sp, L] of Object.entries(by || {})) {
    if (!L || !n(L.tamed) || !n(L.born) || typeof L.died !== 'object' || !Object.entries(L.died).every(([k, v]) => /^[a-z]{1,20}$/.test(k) && n(v))) { bad(`the livestock ledger of "${String(sid).slice(0, 40)}" "${String(sp).slice(0, 40)}" is malformed`); return; }
  }
}
