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

async function start() {
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
    send({ type: 'init', packages, enabled: ['core'], opts: { seed, sandbox: $('sandbox').checked, ...sc }, id: nextId++ });
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
    $('start').disabled = false; $('start').textContent = 'New world';
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
  const behind = speed > 0 && f.tps > 0 && f.tps < 60 * speed * 0.85;
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
  renderDetail();
}
function renderDetail() {
  const v = villages.find((x) => x.id === selected);
  if (!v) { $('detail').innerHTML = 'Click a village on the map or in the list.'; return; }
  $('detail').innerHTML = `<strong>${esc(v.name)}</strong> · ${v.people} people · ${v.fallen ? 'fallen to ruins' : v.detail === 'abstract' ? 'simulated at a distance' : 'simulated in full'}${v.kingdom ? ` · in a kingdom` : ''}`;
}
function select(sid, center = false) {
  selected = sid; renderVillages();
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
const POWER_NAMES = { bless: 'Bless', inspire: 'Inspire', plague: 'Plague', rain: 'Rain', drought: 'Drought', lightning: 'Lightning', fire: 'Fire', meteor: 'Meteor' };
let aimHover = null;
async function previewPower(power, args) {
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
  if (aiming) { const power = aiming; aiming = null; showHint(null); previewPower(power, { x: t.x, y: t.y }); return; }
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
$('start').onclick = start;

function setSplash(h, p) { const s = $('splash'); s.hidden = false; s.innerHTML = `<h1>${esc(h)}</h1><p>${esc(p)}</p>`; }

resize();
requestAnimationFrame(draw);
