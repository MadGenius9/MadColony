// Phase 5b, slice 1: safe destruction (ruin.js), repair by the village, the confirm-and-warn contract (god.js), and
// the first destructive powers: lightning and smite (godwrath.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, firstDifference, conservationErrors, reservationErrors, TICKS_PER_DAY } from './cloud-helpers.js';
import { previewCommand, issueCommand } from '../src/sim/god.js';
import { destroyStructure } from '../src/sim/ruin.js';
import { peopleCensus } from '../src/sim/godspawn.js';
import { encodePlanner } from '../src/sim/plancodec.js';

const sandbox = () => newGame({ seed: 4242, sandbox: true });
const at = (c) => ({ x: Math.round(c.x), y: Math.round(c.y) });

test('destructive powers are refused until confirmed; the preview lists the warnings first', () => {
  const g = sandbox();
  runDays(g, 1);
  const c = g.colonists()[0];
  const p = previewCommand(g, 'lightning', at(c));
  assert.equal(p.ok, false);
  assert.equal(p.needsConfirm, true);
  assert.equal(p.preview.destructive, true);
  assert.ok(p.preview.warnings.some((w) => w.startsWith('Killed:') && w.includes(c.name) && w.includes('your village')), JSON.stringify(p.preview.warnings));
  assert.equal(p.preview.warnings.at(-1), 'This cannot be undone.');
  assert.equal(issueCommand(g, 'lightning', at(c)).ok, false, 'not queued without confirm');
  assert.equal(issueCommand(g, 'lightning', { ...at(c), confirm: 'yes' }).ok, false, 'confirm must be true');
  const ok = issueCommand(g, 'lightning', { ...at(c), confirm: true });
  assert.equal(ok.ok, true);
  delete g.s.god.queue[0].args.confirm; // a tampered command: refused when applied
  g.tick();
  assert.equal(g.s.god.log.at(-1).result.ok, false);
  assert.match(g.s.god.log.at(-1).result.reason, /not confirmed/);
  assert.ok(g.s.colonists[c.id], 'nobody was hurt');
});

test('lightning kills whoever stands on the tile and burns those beside it', () => {
  const g = sandbox();
  runDays(g, 1);
  const start = g.colonists().length;
  const c = g.colonists()[0];
  assert.equal(issueCommand(g, 'lightning', { ...at(c), confirm: true }).ok, true);
  g.tick();
  assert.equal(g.s.colonists[c.id], undefined);
  assert.equal(g.s.dead[c.id].text, 'was struck by lightning');
  assert.deepEqual(conservationErrors(g), []);
  assert.equal(peopleCensus(g, start).ok, true);
});

test('smite: the named person dies', () => {
  const g = sandbox();
  runDays(g, 1);
  const c = g.colonists()[1];
  const p = previewCommand(g, 'smite', { colonistId: c.id });
  assert.ok(p.preview.warnings[0].includes(c.name));
  assert.equal(issueCommand(g, 'smite', { colonistId: c.id, confirm: true }).ok, true);
  g.tick();
  assert.equal(g.s.dead[c.id].text, 'was smitten by the gods');
});

test('destroying a home part keeps every count exact, and the village rebuilds it', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 6);
  const home = Object.values(g.s.homes).find((h) => h.complete);
  assert.ok(home, 'a finished home');
  const p = g.s.projects[home.projectId];
  const wall = p.parts.map((id) => g.s.structures[id]).find((st) => st.built && g.bDef(st).category === 'wall');
  assert.ok(wall);
  const part = destroyStructure(g, wall.id, { reason: 'divine', why: 'A test' });
  assert.equal(g.s.structures[wall.id], undefined);
  assert.ok(part && !part.built && part.def === wall.def && part.x === wall.x && part.y === wall.y, 'the part is back, unbuilt');
  assert.equal(home.complete, false, 'no shelter until it is rebuilt');
  assert.deepEqual(conservationErrors(g), []);
  assert.deepEqual(reservationErrors(g), []);
  assert.doesNotThrow(() => encodePlanner(g, { strict: true }), 'no saved plan holds the destroyed wall');
  runDays(g, 3);
  assert.ok(g.s.structures[part.id]?.built, 'rebuilt');
  assert.equal(home.complete, true, 'complete again');
});

test('destroying every building of a village, one by one, keeps items and reservations exact and saves identical', () => {
  let g = newGame({ seed: 4242 });
  runDays(g, 8);
  const ids = Object.values(g.s.structures).filter((st) => st.built).map((st) => st.id).sort();
  assert.ok(ids.length > 20);
  let k = 0;
  for (const id of ids) {
    if (!g.s.structures[id]) continue;
    destroyStructure(g, id, { reason: k % 2 ? 'fire' : null, why: 'A test' });
    if (++k % 5 === 0) {
      g.step(50);
      assert.deepEqual(conservationErrors(g), [], `after ${k}`);
      assert.deepEqual(reservationErrors(g), [], `after ${k}`);
    }
  }
  g.step(TICKS_PER_DAY);
  const b = reload(g);
  g.step(TICKS_PER_DAY); b.step(TICKS_PER_DAY);
  assert.equal(firstDifference(stateText(g), stateText(b)), null);
  assert.deepEqual(conservationErrors(g), []);
});

test('lightning burns a wooden building it hits; its goods are consumed as burned', () => {
  const g = sandbox();
  runDays(g, 6);
  const st = Object.values(g.s.structures).find((x) => x.built && x.def === 'core:campfire') || Object.values(g.s.structures).find((x) => x.built && g.bDef(x).category === 'wall');
  const p = previewCommand(g, 'lightning', { x: st.x, y: st.y, confirm: true });
  assert.ok(p.ok, p.reason);
  issueCommand(g, 'lightning', { x: st.x, y: st.y, confirm: true });
  g.tick();
  const burned = !g.s.structures[st.id];
  assert.equal(burned, p.preview.warnings.some((w) => /burns down/.test(w)), 'the preview said what would happen');
  assert.deepEqual(conservationErrors(g), []);
});

test('powers replay identically and survive a save and load', () => {
  const run = (cut) => {
    let g = sandbox();
    runDays(g, 2);
    const [a, b] = g.colonists();
    issueCommand(g, 'smite', { colonistId: a.id, confirm: true });
    if (cut) g = reload(g);
    g.step(10);
    issueCommand(g, 'lightning', { ...at(b), confirm: true });
    if (cut) g = reload(g);
    runDays(g, 1);
    return g;
  };
  assert.equal(stateText(run(false)), stateText(run(true)));
});

// ---------------- slice 2: fire ----------------
import { tileFlammable, isBurning, fireRules } from '../src/sim/fire.js';
import { serializeGame, loadGame } from './cloud-helpers.js';

/** The tile with the most trees round it (radius 3) near the player's village: a small wood. */
function wood(g) {
  const c = g.s.settlements[g.s.playerSettlement].center;
  let best = null, bn = -1;
  for (const n of Object.values(g.s.nodes)) {
    if (n.def !== 'core:pine' || Math.hypot(n.x - c.x, n.y - c.y) > 30) continue;
    let k = 0;
    for (const m of Object.values(g.s.nodes)) if (m.def === 'core:pine' && Math.abs(m.x - n.x) <= 3 && Math.abs(m.y - n.y) <= 3) k++;
    if (k > bn) { bn = k; best = n; }
  }
  return best;
}

test('fire: refused where nothing can burn; it spreads through a wood, never past the cap, and burns out', () => {
  const g = sandbox();
  runDays(g, 1);
  const water = (() => { for (let i = 0; i < g.W * g.H; i++) if (tileFlammable(g, i).f <= 0 && !g.isPassable(i % g.W, Math.floor(i / g.W))) return { x: i % g.W, y: Math.floor(i / g.W) }; return null; })();
  if (water) assert.match(previewCommand(g, 'fire', { ...water, confirm: true }).reason, /nothing there can burn/);
  const t = wood(g);
  const before = Object.values(g.s.nodes).filter((n) => n.def === 'core:pine').length;
  assert.equal(issueCommand(g, 'fire', { x: t.x, y: t.y, confirm: true }).ok, true);
  g.tick();
  assert.ok(isBurning(g, g.i(t.x, t.y)));
  let most = 0;
  for (let d = 0; d < 6 && Object.keys(g.s.disasters.fires).length; d++) for (let k = 0; k < 24; k++) { g.step(100); most = Math.max(most, Object.keys(g.s.disasters.fires).length); }
  assert.equal(Object.keys(g.s.disasters.fires).length, 0, 'burned out within 6 days');
  assert.ok(most <= fireRules(g).maxTiles);
  assert.ok(Object.values(g.s.nodes).filter((n) => n.def === 'core:pine').length < before, 'trees burned');
  assert.ok(Object.keys(g.s.disasters.scorched).length > 0, 'scorched ground');
  assert.equal(tileFlammable(g, g.i(t.x, t.y)).f, 0, 'scorched ground does not burn again soon');
  assert.deepEqual(conservationErrors(g), []);
  assert.deepEqual(reservationErrors(g), []);
});

test('fire: a burning wooden home part is lost and rebuilt; stone in it is left on the ground; people flee and get burns', () => {
  const g = sandbox();
  runDays(g, 6);
  const home = Object.values(g.s.homes).find((h) => h.complete);
  const p = g.s.projects[home.projectId];
  const wall = p.parts.map((id) => g.s.structures[id]).find((st) => st.built && g.bDef(st).category === 'wall' && tileFlammable(g, g.i(st.x, st.y)).f > 0);
  assert.ok(wall, 'a wooden wall');
  const c = g.colonists()[0];
  c.x = wall.x; c.y = wall.y + 1; // someone right next to it
  assert.equal(issueCommand(g, 'fire', { x: wall.x, y: wall.y, confirm: true }).ok, true);
  g.step(30);
  assert.ok(c.job?.type === 'flee' || c.health?.injuries?.some((i) => i.kind === 'burn'), 'they run, or are already burned');
  g.step(fireRules(g).burnTicks + 50);
  assert.equal(g.s.structures[wall.id], undefined, 'the wall burned');
  assert.equal(home.complete, false);
  assert.deepEqual(conservationErrors(g), []);
  runDays(g, 4);
  assert.equal(home.complete, true, 'rebuilt');
});

test('lightning on a tree starts a fire', () => {
  const g = sandbox();
  runDays(g, 1);
  const t = wood(g);
  assert.ok(previewCommand(g, 'lightning', { x: t.x, y: t.y, confirm: true }).preview.fire);
  issueCommand(g, 'lightning', { x: t.x, y: t.y, confirm: true });
  g.tick();
  assert.ok(isBurning(g, g.i(t.x, t.y)));
});

test('fire: saved mid-fire, the game continues identically; a malformed fire is refused; no fire, no state', () => {
  const run = (cut) => {
    let g = sandbox();
    runDays(g, 1);
    const t = wood(g);
    issueCommand(g, 'fire', { x: t.x, y: t.y, confirm: true });
    for (let h = 1; h <= 12; h++) { g.step(100); if (cut.includes(h)) g = reload(g); }
    return g;
  };
  const a = run([]), b = run([2, 5]);
  assert.equal(firstDifference(stateText(a), stateText(b)), null);
  assert.equal(stateText(a), stateText(b));
  const bad = JSON.parse(serializeGame(a));
  bad.state.disasters.fires['99999999'] = 0;
  assert.throws(() => loadGame(a.reg, JSON.stringify(bad)), /disasters/);
  const c = newGame({ seed: 4242 });
  runDays(c, 1);
  assert.equal(c.s.disasters, undefined);
});

// ---------------- review fixes (slice 1) ----------------
test('a destroyed bed is rebuilt for its owner', () => {
  const g = newGame({ seed: 4242 });
  runDays(g, 6);
  const bed = Object.values(g.s.structures).find((st) => st.built && st.owner && g.bDef(st)?.bed && g.s.colonists[st.owner]?.bedId === st.id);
  assert.ok(bed, 'an owned bed');
  const who = bed.owner;
  const part = destroyStructure(g, bed.id, { reason: null, why: 'A test' });
  assert.equal(part.owner, who);
  assert.equal(g.s.colonists[who].bedId, part.id);
  runDays(g, 3);
  assert.ok(g.s.structures[part.id]?.built, 'rebuilt');
  assert.equal(g.s.structures[part.id].owner, who, 'still theirs');
});

test('nobody is smitten twice in one tick; non-destructive powers accept confirm', () => {
  const g = sandbox();
  runDays(g, 1);
  const c = g.colonists()[0];
  issueCommand(g, 'smite', { colonistId: c.id, confirm: true });
  issueCommand(g, 'smite', { colonistId: c.id, confirm: true });
  g.tick();
  assert.equal(g.s.god.log.filter((e) => e.type === 'smite' && e.result.ok).length, 1);
  assert.equal(issueCommand(g, 'omen', { text: 'hi', confirm: true }).ok, true);
});

// ---------------- slice 4: meteor and earthquake ----------------
import { buildingFlammable } from '../src/sim/godwrath.js';

/** A tile on the player's first home: the target of the tests below. */
function homeTile(g) {
  const h = Object.values(g.s.homes).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  const st = g.s.projects[h.projectId].parts.map((id) => g.s.structures[id]).find(Boolean);
  return { h, x: st.x, y: st.y };
}

test('meteor: a crater where a home stood; people in it die, the home is gone and its people are homeless', () => {
  const g = sandbox();
  runDays(g, 3);
  const start = g.colonists().length;
  const { h, x, y } = homeTile(g);
  const pid = h.projectId, owners = [...h.owners];
  const victim = g.colonists()[0];
  victim.x = x; victim.y = y; // standing in the crater
  const p = previewCommand(g, 'meteor', { x, y });
  assert.equal(p.needsConfirm, true);
  assert.ok(p.preview.warnings.some((w) => w.startsWith('Killed:') && w.includes(victim.name)), JSON.stringify(p.preview.warnings));
  assert.ok(p.preview.warnings.some((w) => /building parts? of your village destroyed/.test(w)));
  assert.ok(p.preview.warnings.some((w) => w.startsWith('The ground becomes a crater')));
  const ironBefore = g.s.ledger.byReason['created:divine']?.['core:iron'] || 0;
  const ww = g.waterWalk(), rev = g.s.map.rev;
  assert.equal(issueCommand(g, 'meteor', { x, y, confirm: true }).ok, true);
  g.tick();
  const r = g.s.god.log.at(-1).result;
  // The crater keeps the map revision: the water walk kept is the one a fresh build gives.
  assert.equal(g.s.map.rev, rev);
  delete g._waterWalk; g._drink = null;
  const fresh = g.waterWalk();
  assert.deepEqual([...fresh.dist], [...ww.dist]);
  assert.deepEqual([...fresh.from], [...ww.from]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(g.s.dead[victim.id].text, 'was crushed by a falling star');
  assert.equal(g.terrainAt(g.i(x, y)), 'core:crater');
  assert.equal(g.s.homes[h.id], undefined, 'the home is gone');
  assert.equal(g.s.projects[pid].status, 'cancelled');
  assert.deepEqual(g.s.projects[pid].parts, []);
  // Its people are homeless, or already moved into a free bed of another home (here: the victim's).
  for (const id of owners) if (g.s.colonists[id]) {
    const c = g.s.colonists[id];
    assert.notEqual(c.homeId, h.id);
    if (c.homeId) assert.ok(g.s.homes[c.homeId] && g.s.structures[c.bedId]?.owner === c.id);
    else assert.equal(c.bedId, null);
  }
  for (let yy = y - 2; yy <= y + 2; yy++) for (let xx = x - 2; xx <= x + 2; xx++) {
    if (!g.inB(xx, yy) || g.terrainAt(g.i(xx, yy)) !== 'core:crater') continue;
    const i = g.i(xx, yy);
    assert.ok(!g.structIdAt(i) && !g.nodeIdAt(i) && !g.cropIdAt(i) && g.footIdAt(i) !== pid, `tile ${xx},${yy} is clear`);
  }
  assert.ok(r.iron > 0 && (g.s.ledger.byReason['created:divine']['core:iron'] - ironBefore) === r.iron, 'meteoric iron is created through the ledger');
  assert.deepEqual(conservationErrors(g), []);
  assert.deepEqual(reservationErrors(g), []);
  assert.equal(peopleCensus(g, start).ok, true);
  // Nothing is rebuilt in the crater, the village carries on, and the game saves and loads identically.
  runDays(g, 4);
  assert.equal(g.structAt(x, y), null);
  assert.deepEqual(conservationErrors(g), []);
  assert.deepEqual(reservationErrors(g), []);
  assert.equal(stateText(reload(g)), stateText(g));
});

test('earthquake: parts collapse (wooden more often than stone), goods fall, villages rebuild, all counts exact', () => {
  const g = sandbox();
  runDays(g, 3);
  const { x, y } = homeTile(g);
  const p = previewCommand(g, 'quake', { x, y });
  assert.ok(p.preview.warnings.some((w) => /in the area may collapse/.test(w)), JSON.stringify(p.preview.warnings));
  const before = Object.values(g.s.structures).filter((st) => st.built && Math.hypot(st.x - x, st.y - y) <= 12).map((st) => st.id);
  assert.equal(issueCommand(g, 'quake', { x, y, confirm: true }).ok, true);
  g.tick();
  const r = g.s.god.log.at(-1).result;
  assert.equal(r.ok, true);
  assert.ok(r.collapsed > 0, JSON.stringify(r));
  assert.equal(before.filter((id) => !g.s.structures[id]).length, r.collapsed);
  assert.deepEqual(conservationErrors(g), []);
  assert.deepEqual(reservationErrors(g), []);
  const unbuilt = () => Object.values(g.s.structures).filter((st) => !st.built && g.s.projects[st.projectId]?.homeId).length;
  assert.ok(unbuilt() > 0, 'home parts come back unbuilt');
  runDays(g, 6);
  assert.deepEqual(conservationErrors(g), []);
  assert.equal(stateText(reload(g)), stateText(g));
  // Stone stands better than wood (the chances, which the draws follow).
  assert.ok(buildingFlammable(g, g.reg.get('building', 'core:stone_wall')) < buildingFlammable(g, g.reg.get('building', 'core:wood_wall')));
});

test('meteor and earthquake replay identically across a save and load', () => {
  const run = (cut) => {
    let g = sandbox();
    runDays(g, 3);
    const { x, y } = homeTile(g);
    issueCommand(g, 'quake', { x: x + 4, y, confirm: true });
    if (cut) g = reload(g);
    g.step(50);
    issueCommand(g, 'meteor', { x, y, confirm: true });
    if (cut) g = reload(g);
    g.step(30);
    if (cut) g = reload(g);
    runDays(g, 1);
    return g;
  };
  assert.equal(stateText(run(false)), stateText(run(true)));
});
