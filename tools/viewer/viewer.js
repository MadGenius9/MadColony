// World Watch: a test viewer for the simulation running in a Web Worker (docs/proposals/sim-worker.md).
// Not the game's UI: it draws the world from the worker's messages only (terrain, territory, movers, the camera's
// contents, overlays, the chronicle) and sends god powers as commands. Every read goes through the messages in
// src/sim/simhost.js, so it is also the first browser test of that design.
const ROOT = new URL(document.querySelector('meta[name="sim-root"]')?.content || './', location.href);
const CHUNK = 32, MOVER_STRIDE = 5, TICKS_PER_DAY = 2400;
const $ = (id) => document.getElementById(id);
const canvas = $('map'), ctx = canvas.getContext('2d');

const SCENARIOS = {
  neighbours: { scenarioId: 'core:neighbours', size: 'medium', villages: 2 },
  living: { scenarioId: 'core:living_world', size: 'huge' },
  vast: { scenarioId: 'core:vast_world', size: 'vast' },
  world: { scenarioId: 'core:vast_world', size: 'world' },
};

// ---------------------------------------------------------------- state mirrored from the worker
let worker = null, W = 0, H = 0, pal = [], colors = {}, tick = 0, speed = 0;
let terrainImg = null, terrainCanvas = null, terrCanvas = null, terrImg = null, owners = null, ownerIds = [];
let movers = { ids: [], pos: new Float32Array(0) }, area = null, overlays = null, villages = [], log = [];
let selected = null, pending = new Map(), nextId = 1, aiming = null;
const view = { x: 0, y: 0, scale: 1 }; // world tile at the canvas's top-left, pixels per tile
let terrainColor = new Map(); // terrain id -> [r, g, b]

function hexRgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
  if (!m) return [90, 96, 90];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------- mods: the same packages buildRegistry takes
async function loadPackages() {
  const idx = await (await fetch(new URL('mods/index.json', ROOT))).json();
  const out = [];
  for (const id of idx.mods) {
    const base = new URL(`mods/${id}/`, ROOT);
    const manifest = await (await fetch(new URL('manifest.json', base))).json();
    const files = {};
    for (const rel of manifest.content || []) {
      const r = await fetch(new URL(rel, base));
      if (r.ok) files[rel] = await r.json();
    }
    out.push({ manifest, files, source: `mods/${id}` });
  }
  // Terrain colours for drawing come from the same data the worker loads.
  for (const p of out) for (const f of Object.values(p.files)) for (const t of f?.terrain || []) if (t?.id && t.color) terrainColor.set(t.id, hexRgb(t.color));
  return out;
}

// ---------------------------------------------------------------- the worker
function send(msg, transfer) { worker.postMessage(msg, transfer || []); }
function ask(msg) {
  const id = nextId++;
  return new Promise((resolve) => { pending.set(id, resolve); send({ ...msg, id }); });
}

async function start(saveText = null) {
  $('start').disabled = true;
  $('start').textContent = 'Creating…';
  setSplash('Creating the world…', 'Planet-sized worlds take a few seconds to generate.');
  try {
    const packages = await loadPackages();
    worker?.terminate();
    worker = new Worker(new URL('src/sim/worker.js', ROOT), { type: 'module' });
    worker.onmessage = (e) => onMessage(e.data);
    worker.onerror = (e) => { toast(`The simulation stopped: ${e.message || 'an error in the worker'}`, true); };
    log = []; area = null; overlays = null; villages = []; selected = null; movers = { ids: [], pos: new Float32Array(0) };
    const sc = SCENARIOS[$('scenario').value];
    const seed = Math.max(1, Math.floor(Number($('seed').value) || 7));
    report = null; god = null; personFor = null; delete $('laws').dataset.built;
    if (saveText) send({ type: 'init', packages, enabled: ['core'], save: saveText, id: nextId++ });
    else send({ type: 'init', packages, enabled: ['core'], opts: { seed, sandbox: $('sandbox').checked, ...sc }, id: nextId++ });
  } catch (e) {
    setSplash('Could not load the game data', String(e.message || e));
    $('start').disabled = false; $('start').textContent = 'Create world';
  }
}

function onMessage(m) {
  if (m.type === 'ready') {
    W = m.w; H = m.h;
    terrainCanvas = new OffscreenCanvasOr(W, H); terrainImg = terrainCanvas.ctx.createImageData(W, H);
    terrCanvas = new OffscreenCanvasOr(W, H); terrImg = terrCanvas.ctx.createImageData(W, H);
    owners = null; ownerIds = [];
    $('splash').hidden = true;
    $('start').disabled = false; $('start').textContent = 'New world'; $('saveBtn').disabled = false;
    fitView();
    setSpeed(1);
    return;
  }
  if (m.type === 'frame') return onFrame(m);
  if (m.type === 'result') { const r = pending.get(m.id); if (r) { pending.delete(m.id); r(m.value); } return; }
  if (m.type === 'error') {
    const r = pending.get(m.id); if (r) { pending.delete(m.id); r({ ok: false, reason: m.message }); }
    toast(m.of === 'tick' ? `The game stopped on tick ${m.tick}: ${m.message}` : m.message, true);
    if (m.of === 'tick') markSpeed(0);
    if (m.of === 'init') { setSplash('The world could not be created', m.message); $('start').disabled = false; $('start').textContent = 'Create world'; }
  }
}

function onFrame(f) {
  tick = f.tick; speed = f.speed;
  if (f.movers.ids) movers.ids = f.movers.ids;
  movers.pos = f.movers.pos;
  if (f.world) { villages = f.world; renderVillages(); } // before territory: its colours are the villages'
  if (f.terrain) applyTerrain(f.terrain);
  if (f.territory) applyTerritory(f.territory);
  if (f.area) area = f.area;
  if (f.overlays) overlays = f.overlays;
  if (f.log?.length) addLog(f.log);
  const behind = speed > 0 && speed <= 16 && f.tps > 0 && f.tps < 60 * speed * 0.85; // Max means as fast as it goes
  $('clock').innerHTML = `<span>${esc(f.clock)}</span><span class="${behind ? 'behind' : ''}">${speed ? `${f.tps || '…'} ticks/s` : 'paused'}</span>`;
  $('favour').textContent = f.favour === null ? '' : `favour ${Math.floor(f.favour)}`;
}

// ---------------------------------------------------------------- terrain and territory images
function OffscreenCanvasOr(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; this.canvas = c; this.ctx = c.getContext('2d'); }

function applyTerrain(t) {
  if (t.pal) pal = t.pal;
  const rgb = pal.map((id) => terrainColor.get(id) || [90, 96, 90]);
  const d = terrainImg.data;
  const paint = (idx, x0, y0, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = rgb[idx[y * w + x]] || [0, 0, 0], o = ((y0 + y) * W + x0 + x) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
  };
  if (t.all) { paint(t.idx, 0, 0, t.w, t.h); terrainCanvas.ctx.putImageData(terrainImg, 0, 0); }
  for (const c of t.chunks || []) { paint(c.idx, c.x, c.y, c.w, c.h); terrainCanvas.ctx.putImageData(terrainImg, 0, 0, c.x, c.y, c.w, c.h); }
}

function applyTerritory(t) {
  if (!owners) owners = new Uint16Array(W * H).fill(0xffff);
  ownerIds = t.ids;
  for (let y = 0; y < t.h; y++) owners.set(t.grid.subarray(y * t.w, (y + 1) * t.w), (t.y0 + y) * W + t.x0);
  const col = ownerIds.map((id) => hexRgb(villages.find((v) => v.id === id)?.color || colorOfId(id)));
  const d = terrImg.data, x0 = Math.max(0, t.x0 - 1), y0 = Math.max(0, t.y0 - 1), x1 = Math.min(W - 1, t.x0 + t.w), y1 = Math.min(H - 1, t.y0 + t.h);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x, k = owners[i], o = i * 4;
    if (k === 0xffff) { d[o + 3] = 0; continue; }
    const edge = (x > 0 && owners[i - 1] !== k) || (x < W - 1 && owners[i + 1] !== k) || (y > 0 && owners[i - W] !== k) || (y < H - 1 && owners[i + W] !== k);
    const c = col[k] || [255, 255, 255];
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = edge ? 220 : 60;
  }
  terrCanvas.ctx.putImageData(terrImg, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}
const colorOfId = (id) => { let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return '#' + ((h & 0x7f7f7f) | 0x404040).toString(16).padStart(6, '0'); };

// ---------------------------------------------------------------- drawing
function resize() {
  const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr));
}
const cssW = () => canvas.width / (window.devicePixelRatio || 1), cssH = () => canvas.height / (window.devicePixelRatio || 1);

function fitView() {
  resize();
  const s = Math.min(cssW() / W, cssH() / H);
  view.scale = s; view.x = (W - cssW() / s) / 2; view.y = (H - cssH() / s) / 2;
  sendCamera();
}
function zoomAt(f, sx = cssW() / 2, sy = cssH() / 2) {
  const wx = view.x + sx / view.scale, wy = view.y + sy / view.scale;
  view.scale = Math.min(40, Math.max(Math.min(cssW() / W, cssH() / H) / 2, view.scale * f));
  view.x = wx - sx / view.scale; view.y = wy - sy / view.scale;
  sendCamera();
}
let camTimer = 0;
function sendCamera() {
  if (!worker || !W) return;
  clearTimeout(camTimer);
  camTimer = setTimeout(() => {
    if (view.scale < 2.5) return; // zoomed out: the world view needs no contents
    send({ type: 'camera', x0: Math.floor(view.x), y0: Math.floor(view.y), w: Math.ceil(cssW() / view.scale) + 1, h: Math.ceil(cssH() / view.scale) + 1 });
  }, 80);
}

function draw() {
  requestAnimationFrame(draw);
  if (!terrainCanvas) return;
  const dpr = window.devicePixelRatio || 1, s = view.scale;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0b1a22'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * s, 0, 0, dpr * s, -view.x * dpr * s, -view.y * dpr * s);
  ctx.imageSmoothingEnabled = s < 1;
  ctx.drawImage(terrainCanvas.canvas, 0, 0);
  if ($('showTerr').checked && owners) ctx.drawImage(terrCanvas.canvas, 0, 0);
  const px = 1 / s; // one screen pixel in tiles
  if (overlays) drawOverlays(px);
  if (area && s >= 2.5) drawArea(px);
  drawMovers(px, s);
  if (aimHover && aiming) { ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = 2 * px; ctx.strokeRect(aimHover.x, aimHover.y, 1, 1); ctx.beginPath(); ctx.arc(aimHover.x + 0.5, aimHover.y + 0.5, 10, 0, Math.PI * 2); ctx.stroke(); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawLabels();
}

function drawOverlays(px) {
  const o = overlays;
  ctx.fillStyle = 'rgba(40,30,25,0.55)';
  for (const k of Object.keys(o.scorched || {})) { const i = +k; ctx.fillRect(i % W, (i / W) | 0, 1, 1); }
  ctx.fillStyle = '#ff7a1a';
  for (const k of Object.keys(o.fires || {})) { const i = +k; ctx.fillRect(i % W - 0.2, ((i / W) | 0) - 0.2, 1.4, 1.4); }
  for (const w of Object.values(o.weather || {})) {
    ctx.fillStyle = w.kind === 'rain' ? 'rgba(90,160,230,0.25)' : 'rgba(220,170,80,0.25)';
    ctx.beginPath(); ctx.arc(w.x + 0.5, w.y + 0.5, w.r || 10, 0, Math.PI * 2); ctx.fill();
  }
  for (const st of Object.values(o.storms || {})) {
    ctx.strokeStyle = 'rgba(230,230,240,0.85)'; ctx.lineWidth = 2 * px;
    ctx.beginPath(); ctx.arc(st.x + 0.5, st.y + 0.5, Math.max(2, (st.r || 3)), 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = '#f0b429';
  const dot = Math.max(1.2, 3 * px);
  for (const c of Object.values(o.caravans || {})) {
    const span = (c.eta - c.depart) || 1, p = Math.min(1, Math.max(0, (tick - c.depart) / span));
    const x = c.x + (c.tx - c.x) * p, y = c.y + (c.ty - c.y) * p;
    ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
  }
  const cw = Math.ceil(W / CHUNK);
  ctx.fillStyle = '#d7e8ff';
  for (const t of Object.values(o.travellers || {})) {
    let x, y;
    if (t.kind === 'explorer' && t.route?.length) { const k = t.route[Math.min(t.route.length - 1, Math.max(0, t.k || 0))]; x = (k % cw) * CHUNK + CHUNK / 2; y = Math.floor(k / cw) * CHUNK + CHUNK / 2; }
    else if (Number.isFinite(t.x)) { const span = ((t.arrive ?? t.back) - t.depart) || 1, p = Math.min(1, Math.max(0, (tick - t.depart) / span)); x = t.x + ((t.tx ?? t.x) - t.x) * p; y = t.y + ((t.ty ?? t.y) - t.y) * p; }
    else continue;
    ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
  }
}

function drawArea(px) {
  const a = area;
  ctx.fillStyle = 'rgba(80,140,60,0.75)';
  for (const c of a.crops) ctx.fillRect(c.x + 0.25, c.y + 0.25, 0.5, 0.5);
  for (const n of a.nodes) { ctx.fillStyle = n.young ? 'rgba(60,110,50,0.6)' : 'rgba(30,80,35,0.85)'; ctx.fillRect(n.x + 0.2, n.y + 0.2, 0.6, 0.6); }
  for (const st of a.structures) {
    ctx.fillStyle = st.built ? 'rgba(120,96,70,0.95)' : 'rgba(170,150,120,0.45)';
    ctx.fillRect(st.x + 0.05, st.y + 0.05, 0.9, 0.9);
  }
  ctx.fillStyle = '#e8d38a';
  for (const k of a.stacks) ctx.fillRect(k.x + 0.3, k.y + 0.3, 0.4, 0.4);
  ctx.fillStyle = 'rgba(140,110,80,0.9)';
  for (const h of a.herds) { ctx.beginPath(); ctx.arc(h.x + 0.5, h.y + 0.5, Math.min(1.6, 0.5 + h.n * 0.08), 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#9aa0a8';
  for (const b of a.bodies) ctx.fillRect(b.x + 0.2, b.y + 0.4, 0.6, 0.25);
  void px;
}

function drawMovers(px, s) {
  const ids = movers.ids, P = movers.pos, r = s >= 2.5 ? 0.32 : Math.max(0.8, 1.6 * px);
  for (let k = 0; k < ids.length; k++) {
    const o = k * MOVER_STRIDE; if (o + 4 >= P.length) break;
    const p = P[o + 4], x = P[o + 2] + (P[o] - P[o + 2]) * p, y = P[o + 3] + (P[o + 1] - P[o + 3]) * p;
    const kind = ids[k][0];
    ctx.fillStyle = kind === 'c' ? '#fff4d6' : kind === 'm' ? '#e0533d' : '#c9a36b';
    ctx.beginPath(); ctx.arc(x + 0.5, y + 0.5, kind === 'm' ? r * 1.5 : r, 0, Math.PI * 2); ctx.fill();
  }
}

function drawLabels() {
  ctx.font = '600 12px "IBM Plex Sans", system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const v of villages) {
    if (!v.center) continue;
    const sx = (v.center.x + 0.5 - view.x) * view.scale, sy = (v.center.y + 0.5 - view.y) * view.scale;
    if (sx < -60 || sy < -20 || sx > cssW() + 60 || sy > cssH() + 20) continue;
    const label = v.fallen ? `${v.name} (ruins)` : `${v.name} · ${v.people}`;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,20,26,0.85)'; ctx.strokeText(label, sx, sy - 8);
    ctx.fillStyle = v.id === selected ? '#ffd27a' : '#f2f5f3'; ctx.fillText(label, sx, sy - 8);
    ctx.fillStyle = v.color || '#ffffff'; ctx.fillRect(sx - 3, sy - 3, 6, 6);
  }
}

// ---------------------------------------------------------------- the side panel
function esc(t) { return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function renderVillages() {
  const list = [...villages].sort((a, b) => Number(a.fallen) - Number(b.fallen) || b.people - a.people || (a.name < b.name ? -1 : 1));
  $('vcount').textContent = `${list.filter((v) => !v.fallen).length} standing · ${list.reduce((n, v) => n + v.people, 0)} people`;
  $('villages').innerHTML = list.map((v) => `<button type="button" class="vrow${v.id === selected ? ' sel' : ''}${v.fallen ? ' fallen' : ''}" data-sid="${esc(v.id)}">
    <span class="sw" style="background:${esc(v.color || '#888888')}"></span><span class="nm">${esc(v.name)}</span><span class="ct">${v.people}${v.detail === 'abstract' ? ' · far' : ''}</span></button>`).join('') || '<div class="empty">No villages.</div>';
  $('selName').textContent = villages.find((x) => x.id === selected)?.name || '(none selected)';
}

// ---------------------------------------------------------------- the inspector and the god panel (asked once a second)
let report = null, god = null, person = null, personFor = null, openDetails = new Set(['people']);
const NOTE_NAMES = { moodNote: 'Mood', huntNote: 'Food from hunting', monsterNote: 'Monsters', forestNote: 'Trees', waterNote: 'Water', penNote: 'Livestock', cartNote: 'Carts', clothNote: 'Clothing' };
async function poll() {
  if (!worker || !W) return;
  if (selected) { report = await ask({ type: 'query', kind: 'village', sid: selected }); renderInspector(); }
  if (personFor) { person = await ask({ type: 'query', kind: 'colonist', cid: personFor }); renderInspector(); }
  god = await ask({ type: 'query', kind: 'god' }); renderGod();
}
setInterval(poll, 1000);

function renderInspector() {
  const v = report, el = $('inspector');
  if (!v) { el.innerHTML = '<div class="empty">Click a village on the map or in the list.</div>'; return; }
  for (const d of el.querySelectorAll('details')) (d.open ? openDetails.add(d.dataset.k) : openDetails.delete(d.dataset.k));
  const sec = (k, title, body) => `<details data-k="${k}"${openDetails.has(k) ? ' open' : ''}><summary>${esc(title)}</summary><div>${body}</div></details>`;
  const ppl = v.people.map((c) => `<button type="button" class="person" data-cid="${esc(c.id)}">
      <span class="nm">${esc(c.name)}${c.sick ? ' · sick' : ''}</span><span class="mood ${esc(c.level)}">${c.mood > 0 ? '+' : ''}${c.mood}</span>
      <span class="doing">${esc(c.age)} · ${esc(c.doing || c.job || 'idle')}${c.partner ? ` · with ${esc(c.partner)}` : ''}${c.traits.length ? ` · ${esc(c.traits.join(', '))}` : ''}</span></button>
      ${personFor === c.id && person ? personBox(person) : ''}`).join('');
  const notes = Object.entries(v.notes).map(([k, n]) => `<p class="muted" style="margin:0"><strong>${esc(NOTE_NAMES[k] || cap(k.replace(/Note$/, '')))}:</strong> ${esc(n)}</p>`).join('');
  const laws = v.laws.length ? v.laws.map((L) => `<span class="chip">${esc(L.name)}: ${esc(L.optionName || L.option)}</span>`).join('') : '<span class="muted">Every law at its default.</span>';
  const mem = [...v.memories.map((m) => `<span class="chip">${esc(m.name)} · ${m.daysLeft} d</span>`), ...v.traditions.map((x) => `<span class="chip" title="${esc(x.about)}">Tradition: ${esc(x.name)}</span>`)].join('') || '<span class="muted">Nothing remembered yet.</span>';
  const met = v.met.length ? v.met.map((o) => `<span class="chip${o.war ? ' war' : ''}">${esc(o.name)} · ${o.war ? 'at war' : esc(o.status)} ${o.value > 0 ? '+' : ''}${o.value}</span>`).join('') : '<span class="muted">Has not met another village.</span>';
  const goods = v.goods.length ? v.goods.map((x) => `<span class="chip">${esc(x.name)} ${x.n}</span>`).join('') : '<span class="muted">Nothing in store.</span>';
  const pray = v.petitions.map((p) => `<p style="margin:0">Praying: <strong>${esc(p.name)}</strong> (${p.daysLeft} d left)</p>`).join('');
  el.innerHTML = `<h2><span>${esc(v.name)}</span><span>${v.people.length} people</span></h2>
    <dl class="facts">
      <dt>Simulated</dt><dd>${v.fallen ? 'fallen to ruins' : v.detail === 'abstract' ? 'at a distance (summed up hourly)' : 'in full, person by person'}</dd>
      <dt>Leader</dt><dd>${v.leader ? `${esc(v.leader.name)}${v.leader.rule ? ` (${esc(v.leader.rule)})` : ''}` : '<span class="muted">none</span>'}</dd>
      ${v.kingdom ? `<dt>Kingdom</dt><dd>${esc(v.kingdom)}</dd>` : ''}
      <dt>Unrest</dt><dd>${v.unrest.on ? `<span style="color:var(--danger)">yes: ${v.unrest.unhappy} of ${v.unrest.adults} adults unhappy</span>` : `${v.unrest.unhappy} of ${v.unrest.adults} adults unhappy`}</dd>
    </dl>
    ${pray}${notes}
    ${sec('people', `People (${v.people.length})`, `<div class="people">${ppl || '<span class="muted">Nobody lives here.</span>'}</div>`)}
    ${sec('goods', 'Goods', `<div class="chips">${goods}</div>`)}
    ${sec('laws', 'Laws', `<div class="chips">${laws}</div>`)}
    ${sec('memories', 'Memories and traditions', `<div class="chips">${mem}</div>`)}
    ${sec('met', 'Neighbours', `<div class="chips">${met}</div>`)}`;
}
function personBox(r) {
  if (!r?.colonist) return '';
  const e = r.explain || {}, m = e.mood || {};
  const thoughts = (m.thoughts || []).map((x) => `<span class="chip">${esc(x.name)} ${x.value > 0 ? '+' : ''}${x.value}</span>`).join('');
  const needs = Object.entries(r.colonist.needs || {}).map(([k, val]) => `<span class="chip">${esc(k.replace(/^core:/, ''))} ${Math.round(val * 100)}%</span>`).join('');
  return `<div class="explain">
    ${e.goal ? `<div><strong>Goal:</strong> ${esc(e.goal)}</div>` : ''}${e.action ? `<div><strong>Doing:</strong> ${esc(e.action)}</div>` : ''}
    ${e.blocker ? `<div style="color:var(--danger)"><strong>Stuck:</strong> ${esc(e.blocker)}</div>` : ''}
    <div><strong>Mood</strong> ${m.value ?? 0} (${esc(m.level || '')}, heading to ${m.target ?? 0})</div>
    <div class="chips">${thoughts}</div><div class="chips">${needs}</div>
    <div class="row" style="display:flex;gap:6px"><button type="button" class="danger" data-smite="${esc(r.colonist.id)}">Smite</button><button type="button" data-follow="${esc(r.colonist.id)}">Find on map</button></div></div>`;
}
$('inspector').addEventListener('click', (e) => {
  const sm = e.target.closest('[data-smite]');
  if (sm) { showTab('god'); previewPower('smite', { colonistId: sm.dataset.smite }); return; }
  const fo = e.target.closest('[data-follow]');
  if (fo) { const k = movers.ids.indexOf('c:' + fo.dataset.follow); if (k >= 0) { const o = k * MOVER_STRIDE; centerOn(movers.pos[o], movers.pos[o + 1], 8); } return; }
  const b = e.target.closest('.person');
  if (b) { personFor = personFor === b.dataset.cid ? null : b.dataset.cid; person = null; poll(); }
});
$('inspector').addEventListener('toggle', (e) => { const d = e.target; if (d.dataset?.k) (d.open ? openDetails.add(d.dataset.k) : openDetails.delete(d.dataset.k)); }, true);

function renderGod() {
  if (!god) return;
  const n = god.petitions.length;
  $('prayerBadge').hidden = !n; $('prayerBadge').textContent = n;
  $('prayerCount').textContent = n ? `${n} open` : '';
  $('prayers').innerHTML = n ? god.petitions.map((p) => `<div class="item"><div><strong>${esc(p.village)}</strong> prays: ${esc(p.name)}</div>
      <div class="meta">${p.daysLeft} days left · answered by ${esc((p.answers || []).map((a) => (a.brush ? `Shape land (${a.brush})` : POWER_NAMES[a.power] || a.power)).join(' or ') || 'a power')}</div>
      <div class="row"><button type="button" data-goto="${esc(p.sid)}">Show village</button></div></div>`).join('') : '<div class="empty">No village is praying right now.</div>';
  $('cards').innerHTML = god.cards.length ? god.cards.map((c) => {
    const rows = Object.entries(c.changes || {}).map(([sid, ch]) => {
      const name = villages.find((v) => v.id === sid)?.name || sid;
      const cells = Object.keys(ch.before || {}).map((k) => { const a = ch.before[k], b = ch.after?.[k]; const cls = b > a ? 'up' : b < a ? 'down' : ''; return `<span>${esc(name)} · ${esc(k)}</span><span class="${cls}">${fmtN(a)} → ${fmtN(b)}</span>`; }).join('');
      return cells + (ch.died ? `<span>${esc(name)} · died</span><span class="down">${ch.died}</span>` : '');
    }).join('');
    return `<div class="item"><div>${esc(c.effect || c.type)}</div><div class="meta">${esc(POWER_NAMES[c.type] || c.type)} on day ${Math.floor(c.t / TICKS_PER_DAY) + 1} · changes that followed (not all caused by it)</div><div class="change">${rows}</div></div>`;
  }).join('') : '<div class="empty">Three days after a power, its outcome appears here.</div>';
  if (!$('laws').dataset.built) {
    $('laws').innerHTML = god.laws.map((L) => `<label for="law-${esc(L.id)}">${esc(L.name)}</label><select id="law-${esc(L.id)}" data-law="${esc(L.id)}">${L.values.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('')}</select>`).join('');
    $('laws').dataset.built = '1';
    fillKinds();
  }
  for (const L of god.laws) { const sel = document.getElementById('law-' + L.id); const act = god.active.find((a) => a.id === L.id); if (sel && document.activeElement !== sel) sel.value = act ? act.value : L.values[0].id; }
  $('deadCount').textContent = god.dead ? `${god.dead} of ${god.dead + god.people} ever lived` : '';
  const causes = Object.entries(god.deaths).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  $('deaths').innerHTML = causes.length ? `<div class="chips">${causes.map(([k, n]) => `<span class="chip">${esc(k)} ${n}</span>`).join('')}</div>` : 'Nobody has died yet.';
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtN = (x) => (typeof x === 'number' ? (Math.round(x * 10) / 10).toString() : '–');
function fillKinds() {
  $('animalKind').innerHTML = god.animals.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
  $('monsterKind').innerHTML = god.monsters.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
}
$('laws').addEventListener('change', (e) => { const s = e.target.closest('[data-law]'); if (s) previewPower('law', { law: s.dataset.law, value: s.value }); });
$('prayers').addEventListener('click', (e) => { const b = e.target.closest('[data-goto]'); if (b) { select(b.dataset.goto, true); } });
function centerOn(x, y, scale) { if (scale && view.scale < scale) view.scale = scale; view.x = x - cssW() / view.scale / 2; view.y = y - cssH() / view.scale / 2; sendCamera(); }
function showTab(name) {
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const p of ['village', 'god', 'log']) $('pane-' + p).hidden = p !== name;
}
document.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });
function select(sid, center = false) {
  if (selected !== sid) { report = null; personFor = null; person = null; }
  selected = sid; renderVillages(); renderInspector(); showTab('village'); poll();
  const v = villages.find((x) => x.id === sid);
  if (center && v?.center) { view.x = v.center.x - cssW() / view.scale / 2; view.y = v.center.y - cssH() / view.scale / 2; if (view.scale < 3) zoomAt(4 / view.scale); else sendCamera(); }
}
$('villages').addEventListener('click', (e) => { const b = e.target.closest('.vrow'); if (b) select(b.dataset.sid, true); });

function addLog(entries) {
  for (const e of entries) log.push(e);
  if (log.length > 300) log = log.slice(-300);
  $('logcount').textContent = `${log.length} lines`;
  $('log').innerHTML = log.slice(-120).reverse().map((e) => {
    const d = Math.floor(e.t / TICKS_PER_DAY) + 1, h = Math.floor((e.t % TICKS_PER_DAY) / 100);
    const cls = e.cat === 'warn' ? 'warn' : e.cat === 'death' ? 'death' : e.id ? 'ev' : '';
    return `<div class="${cls}"><time>d${d} ${String(h).padStart(2, '0')}h</time><span>${esc(e.msg)}</span></div>`;
  }).join('');
}

let toastTimer = 0;
function toast(text, bad = false) { const t = $('toast'); t.textContent = text; t.className = 'toast' + (bad ? ' err' : ''); clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.textContent = ''; }, 6000); }

// ---------------------------------------------------------------- speed
function markSpeed(v) { for (const b of document.querySelectorAll('#speeds button')) b.classList.toggle('on', Number(b.dataset.speed) === v); }
function setSpeed(v) { if (!worker) return; send({ type: 'speed', speed: v }); markSpeed(v); }
$('speeds').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setSpeed(Number(b.dataset.speed)); });

// ---------------------------------------------------------------- god powers: preview, then confirm
const POWER_NAMES = { bless: 'Bless', inspire: 'Inspire', plague: 'Plague', rain: 'Rain', drought: 'Drought', lightning: 'Lightning', fire: 'Fire', meteor: 'Meteor', tornado: 'Tornado', quake: 'Quake', banish: 'Banish', animals: 'Animals', monster: 'Monster', smite: 'Smite', law: 'World law', shape: 'Shape land' };
let aimHover = null;
/** The arguments of a power aimed at tile t (the extra ones some powers take). */
function tileArgs(power, t) {
  const a = { x: t.x, y: t.y };
  if (power === 'animals') { const d = god?.animals.find((x) => x.id === $('animalKind').value); a.species = $('animalKind').value; a.count = Math.max(2, Math.min(d?.herd?.[1] ?? 4, 4)); a.mode = 'herd'; }
  if (power === 'monster') a.species = $('monsterKind').value;
  if (power === 'shape') { a.brush = $('brush').value; a.r = 4; }
  return a;
}
async function previewPower(power, args) {
  showTab('god');
  const r = await ask({ type: 'preview', power, args });
  const p = r?.preview;
  const bad = !r?.ok && !r?.needsConfirm;
  const warn = (p?.warnings || []).map((w) => `<li>${esc(w)}</li>`).join('');
  $('powerCard').innerHTML = `<div class="card${bad ? ' bad' : ''}">
    <p><strong>${esc(POWER_NAMES[power] || power)}</strong>${p && !p.sandbox ? ` · costs ${Math.round(p.cost)} favour` : ''}</p>
    <p>${esc(p?.effect || r?.reason || '')}</p>${bad && p?.effect ? `<p>${esc(r.reason)}</p>` : ''}
    ${warn ? `<ul>${warn}</ul>` : ''}
    <div class="row">${bad ? '' : `<button type="button" class="${r?.needsConfirm ? 'danger' : 'primary'}" id="doPower">${r?.needsConfirm ? 'Confirm' : 'Use power'}</button>`}<button type="button" id="cancelPower">Cancel</button></div></div>`;
  $('cancelPower').onclick = () => { $('powerCard').innerHTML = ''; };
  const go = $('doPower');
  if (go) go.onclick = async () => {
    const res = await ask({ type: 'command', power, args: r.needsConfirm ? { ...args, confirm: true } : args });
    $('powerCard').innerHTML = '';
    toast(res?.ok ? `${POWER_NAMES[power]}: done on the next tick.` : `${POWER_NAMES[power]} refused: ${res?.reason || 'unknown reason'}`, !res?.ok);
  };
}
document.querySelector('.side').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-power]');
  if (!b || !worker) return;
  const power = b.dataset.power;
  if (b.dataset.target === 'village') {
    if (!selected) { toast('Select a village first.', true); return; }
    aiming = null; showHint(null);
    previewPower(power, { settlementId: selected });
  } else {
    aiming = power; canvas.classList.add('aiming');
    showHint(`${POWER_NAMES[power]}: click a spot on the map. Press Esc to stop aiming.`);
  }
});
function showHint(t) { $('hint').hidden = !t; $('hint').textContent = t || ''; if (!t) canvas.classList.remove('aiming'); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { aiming = null; showHint(null); } });

// ---------------------------------------------------------------- map input: drag, zoom, click
const toTile = (sx, sy) => ({ x: Math.floor(view.x + sx / view.scale), y: Math.floor(view.y + sy / view.scale) });
let drag = null; const touches = new Map(); let pinch = null;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId); touches.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; drag = null; return; }
  drag = { x: e.offsetX, y: e.offsetY, vx: view.x, vy: view.y, moved: false };
});
canvas.addEventListener('pointermove', (e) => {
  if (aiming) aimHover = toTile(e.offsetX, e.offsetY);
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (pinch && touches.size === 2) {
    const [a, b] = [...touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch.d > 0) zoomAt(d / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
    pinch.d = d; return;
  }
  if (!drag) return;
  const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
  view.x = drag.vx - dx / view.scale; view.y = drag.vy - dy / view.scale;
  if (drag.moved) sendCamera();
});
canvas.addEventListener('pointerup', (e) => {
  touches.delete(e.pointerId);
  if (touches.size < 2) pinch = null;
  if (!drag || drag.moved || !W) { drag = null; return; }
  drag = null;
  const t = toTile(e.offsetX, e.offsetY);
  if (t.x < 0 || t.y < 0 || t.x >= W || t.y >= H) return;
  if (aiming) { const power = aiming; aiming = null; showHint(null); previewPower(power, tileArgs(power, t)); return; }
  if (area && view.scale >= 2.5) { // zoomed in: a person under the pointer opens their card
    const near = area.people.find((c) => Math.abs(c.x - t.x) <= 0.5 && Math.abs(c.y - t.y) <= 0.5);
    if (near) { select(near.settlementId); personFor = near.id; openDetails.add('people'); poll(); return; }
  }
  const k = owners ? owners[t.y * W + t.x] : 0xffff;
  let sid = k !== 0xffff ? ownerIds[k] : null;
  if (!sid) { // nearest village centre within 24 tiles (games without organic territory)
    let best = 24 * 24;
    for (const v of villages) if (v.center) { const d = (v.center.x - t.x) ** 2 + (v.center.y - t.y) ** 2; if (d < best) { best = d; sid = v.id; } }
  }
  if (sid) select(sid);
});
canvas.addEventListener('pointercancel', (e) => { touches.delete(e.pointerId); drag = null; pinch = null; });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY); }, { passive: false });
$('zin').onclick = () => zoomAt(1.6); $('zout').onclick = () => zoomAt(1 / 1.6); $('zfit').onclick = () => W && fitView();
window.addEventListener('resize', () => { resize(); sendCamera(); });
$('start').onclick = () => start();

// ---------------------------------------------------------------- saves, in this browser only (IndexedDB)
function idb() {
  return new Promise((res, rej) => { const r = indexedDB.open('world-watch', 1); r.onupgradeneeded = () => r.result.createObjectStore('saves'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => { const tx = db.transaction('saves', mode), q = fn(tx.objectStore('saves')); tx.oncomplete = () => res(q?.result); tx.onerror = () => rej(tx.error); });
}
async function slotLabels() {
  try {
    for (const o of $('slot').options) {
      const s = await idbDo('readonly', (st) => st.get('slot' + o.value));
      o.textContent = s ? `${o.value}: ${s.label}` : `${o.value}: empty`;
    }
  } catch { /* storage blocked: the slots stay unlabelled */ }
}
$('saveBtn').onclick = async () => {
  if (!worker || !W) return;
  $('saveBtn').disabled = true;
  try {
    const text = await ask({ type: 'save' });
    if (typeof text !== 'string') throw new Error('the game could not be saved');
    const label = `${$('clock').textContent.split(',')[0]} · ${$('scenario').selectedOptions[0].textContent.split(':')[0]}`;
    await idbDo('readwrite', (st) => st.put({ text, label, at: Date.now() }, 'slot' + $('slot').value));
    toast(`Saved to slot ${$('slot').value} (${(text.length / 1e6).toFixed(1)} MB, in this browser only).`);
    slotLabels();
  } catch (e) { toast(`Not saved: ${e.message || e}`, true); }
  $('saveBtn').disabled = false;
};
$('loadBtn').onclick = async () => {
  try {
    const s = await idbDo('readonly', (st) => st.get('slot' + $('slot').value));
    if (!s) { toast(`Slot ${$('slot').value} is empty.`, true); return; }
    start(s.text);
  } catch (e) { toast(`Could not load: ${e.message || e}`, true); }
};
slotLabels();

function setSplash(h, p) { const s = $('splash'); s.hidden = false; s.innerHTML = `<h1>${esc(h)}</h1><p>${esc(p)}</p>`; }

resize();
requestAnimationFrame(draw);
