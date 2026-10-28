// World shaping (docs/proposals/world-shaping.md): the shape power's terrain brushes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, conservationErrors } from './cloud-helpers.js';
import { issueCommand, previewCommand } from '../src/sim/god.js';

const sandbox = () => { const g = newGame({ seed: 4242, sandbox: true }); runDays(g, 1); return g; };
/** The first tile (row by row) passing ok, at least `from` tiles from the centre. */
function find(g, ok, from = 0) {
  const c = g.s.center;
  for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) if (Math.hypot(x - c.x, y - c.y) >= from && ok(g.terrainAt(x, y).id, x, y)) return { x, y };
  return null;
}
const counts = (g) => { const n = {}; for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) { const t = g.terrainAt(x, y).id; n[t] = (n[t] || 0) + 1; } return n; };

test('shape: refused for a bad brush, radius, tile or extra key, or where nothing would change', () => {
  const g = sandbox();
  const r = (a) => previewCommand(g, 'shape', a).reason;
  assert.match(r({ brush: 'volcano', x: 5, y: 5 }), /brush must be one of/);
  assert.match(r({ brush: 'raise', x: 5, y: 5, r: 9 }), /r must be a whole number from 1 to 8/);
  assert.match(r({ brush: 'raise', x: -3, y: 5 }), /pick tiles on the map/);
  assert.match(r({ brush: 'raise', x: 5, y: 5, colour: 1 }), /only brush, x, y, r, points and confirm/);
  assert.match(r({ brush: 'raise', points: [[1, 1], [999, 1]] }), /pick tiles on the map/);
  const w = find(g, (t, x, y) => [-1, 0, 1].every((dy) => [-1, 0, 1].every((dx) => g.inB(x + dx, y + dy) && g.terrainAt(x + dx, y + dy).id === 'core:water')), 0);
  assert.ok(w, 'open water');
  assert.match(r({ brush: 'water', x: w.x, y: w.y, r: 1, confirm: true }), /nothing here would change/);
});

test('shape: lowering land makes water there, raising it back makes land; preview equals apply; a load replays it', () => {
  const g = sandbox();
  const at = find(g, (t, x, y) => t === 'core:grass' && g.isPassable(x, y), 26);
  assert.ok(at, 'open grass away from the village');
  const p = previewCommand(g, 'shape', { brush: 'lower', ...at, r: 2, confirm: true });
  assert.equal(p.ok, true, p.reason);
  const n = p.preview.tiles;
  assert.ok(n > 3, `tiles to change (${n})`);
  issueCommand(g, 'shape', { brush: 'lower', ...at, r: 2, confirm: true });
  const b = reload(g);
  g.tick(); b.tick();
  assert.equal(stateText(b), stateText(g), 'the stroke replays after a load');
  const res = g.s.god.log.at(-1).result;
  assert.equal(res.tiles, n, 'apply changed what the preview said');
  assert.equal(g.terrainAt(at.x, at.y).id, 'core:shallows', 'lowered once: shallows');
  issueCommand(g, 'shape', { brush: 'lower', ...at, r: 2, confirm: true });
  g.tick();
  const t = g.terrainAt(at.x, at.y);
  assert.equal(t.id, 'core:water', 'lowered twice: water');
  assert.equal(g.isPassable(at.x, at.y), false, 'which cannot be walked');
  issueCommand(g, 'shape', { brush: 'raise', ...at, r: 2, confirm: true });
  g.tick();
  assert.ok(g.isPassable(at.x, at.y) || g.terrainAt(at.x, at.y).id === 'core:sand', 'raised back toward land');
  runDays(g, 1);
  assert.deepEqual(conservationErrors(g), []);
});

test('shape: buildings, fields, stockpiles and people are left untouched; mountains keep clear of the village', () => {
  const g = sandbox();
  runDays(g, 5);
  const c = g.s.settlements[g.s.playerSettlement].center;
  const before = Object.values(g.s.structures).map((st) => [st.id, g.terrainAt(st.x, st.y).id]);
  const p = previewCommand(g, 'shape', { brush: 'mountain', x: c.x + 8, y: c.y, r: 8, confirm: true });
  assert.equal(p.ok, true, p.reason);
  assert.ok((p.preview.kept['the way round villages'] || 0) > 0, `tiles near the village are kept (${JSON.stringify(p.preview.kept)})`);
  assert.ok(p.preview.warnings.some((w) => /tiles from your village/.test(w)));
  issueCommand(g, 'shape', { brush: 'mountain', x: c.x + 8, y: c.y, r: 8, confirm: true });
  g.tick();
  for (const [id, t] of before) if (g.s.structures[id]) assert.equal(g.terrainAt(g.s.structures[id].x, g.s.structures[id].y).id, t, `${id} keeps its ground`);
  for (const p2 of g.colonists()) assert.ok(g.isPassable(Math.round(p2.x), Math.round(p2.y)), `${p2.name} still stands on open ground`);
  runDays(g, 2);
  assert.ok(g.colonists().length >= 5, 'nobody died of it');
  assert.deepEqual(conservationErrors(g), []);
});

test('shape: painting desert, snow and marsh changes the surface; flatten levels it; a lake has water and a shore', () => {
  const g = newGame({ seed: 7, scenario: 'core:vast_world', size: 'vast', sandbox: true });
  g.tick();
  const C = Object.values(g.s.settlements).map((v) => v.center);
  const far = (x, y) => C.every((c) => Math.hypot(c.x - x, c.y - y) > 60);
  const at = find(g, (t, x, y) => t === 'core:grass' && far(x, y) && g.isPassable(x, y));
  for (const [brush, want] of [['desert', 'core:sand'], ['snow', 'core:snow'], ['marsh', 'core:marsh'], ['flatten', 'core:grass']]) {
    assert.equal(issueCommand(g, 'shape', { brush, ...at, r: 2 }).ok, true, brush);
    g.tick();
    assert.equal(g.terrainAt(at.x, at.y).id, want, `${brush} -> ${want}`);
  }
  const lake = { x: at.x + 20, y: at.y };
  assert.equal(issueCommand(g, 'shape', { brush: 'water', ...lake, r: 4 }).ok, true);
  g.tick();
  assert.ok(g.terrainAt(lake.x, lake.y).drinkable, 'drinkable water in the middle');
  assert.equal(g.terrainAt(lake.x + 4, lake.y).id, 'core:shallows', 'shallows at the edge');
  const before = counts(g)['core:hills'] || 0;
  assert.equal(issueCommand(g, 'shape', { brush: 'raise', points: [[at.x, at.y], [at.x + 2, at.y], [at.x + 4, at.y]], r: 1 }).ok, true); // the flattened grass
  g.tick();
  assert.ok((counts(g)['core:hills'] || 0) > before, 'a drag of three discs raised hills');
});

// ---------------- slice 2: forest, stone and ore ----------------
test('shape: forest plants young pines that grow up; stone and ore place rocks; never next to the village; replays', () => {
  const g = sandbox();
  const at = find(g, (t, x, y) => t === 'core:grass' && g.isPassable(x, y), 28);
  const nodes = (def) => Object.values(g.s.nodes).filter((n) => n.def === def && Math.hypot(n.x - at.x, n.y - at.y) <= 4);
  const p = previewCommand(g, 'shape', { brush: 'forest', ...at, r: 4, confirm: true });
  assert.equal(p.ok, true, p.reason);
  const before = nodes('core:pine').length;
  issueCommand(g, 'shape', { brush: 'forest', ...at, r: 4, confirm: true });
  const b = reload(g);
  g.tick(); b.tick();
  assert.equal(stateText(b), stateText(g), 'replays after a load');
  const young = nodes('core:pine').filter((n) => n.young);
  assert.equal(young.length, p.preview.tiles, 'one young pine for each tile the preview named');
  assert.ok(young.length >= 3 && nodes('core:pine').length > before);
  const s2 = { x: at.x, y: at.y + 9 };
  for (const brush of ['stone', 'ore']) {
    const q = previewCommand(g, 'shape', { brush, ...s2, r: 3, confirm: true });
    if (!q.ok) continue; // all taken already
    issueCommand(g, 'shape', { brush, ...s2, r: 3, confirm: true });
    g.tick();
  }
  assert.ok(Object.values(g.s.nodes).some((n) => n.def === 'core:ore_rock'), 'ore-bearing rocks placed');
  const c = g.s.settlements[g.s.playerSettlement].center;
  const near = previewCommand(g, 'shape', { brush: 'forest', x: c.x, y: c.y, r: 2, confirm: true });
  assert.ok(!near.ok || (near.preview.kept['the way round villages'] || 0) > 0, 'nothing planted in the village itself');
  runDays(g, 45); // a pine takes about 20 days, longer in winter
  assert.ok(young.some((n) => g.s.nodes[n.id] && !g.s.nodes[n.id].young), 'some planted pines grew up');
  assert.deepEqual(conservationErrors(g), []);
});
