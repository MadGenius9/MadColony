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
