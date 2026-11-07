// Phase 9, slice 2: wild sheep, cattle and boar (docs/proposals/phase-9-livestock.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, runDays, stateText, reload, conservationErrors } from './cloud-helpers.js';
import { animalCensus } from '../src/sim/animals.js';

const NEW = ['core:wild_sheep', 'core:wild_cattle', 'core:wild_boar'];
const counts = (g) => { const n = {}; for (const h of Object.values(g.s.animals?.herds || {})) n[h.sp] = (n[h.sp] || 0) + h.n; return n; };

test('livestock: wild sheep, cattle and boar live on their own ground; wolves hunt sheep and boar', () => {
  const g = newGame({ seed: 7, scenario: 'core:living_world' });
  g.tick();
  const n = counts(g);
  for (const sp of NEW) assert.ok(n[sp] > 0, `${sp} placed (${n[sp]})`);
  for (const h of Object.values(g.s.animals.herds)) {
    if (!NEW.includes(h.sp)) continue;
    assert.ok(g.reg.get('animal', h.sp).terrains.includes(g.terrainAt(h.x, h.y).id), `${h.id} on its terrain`);
  }
  const prey = g.reg.get('animal', 'core:wolf').prey;
  assert.ok(prey.includes('core:wild_sheep') && prey.includes('core:wild_boar'));
  assert.ok(!prey.includes('core:wild_cattle'), 'cattle are too big for a pack');
});

test('livestock: each carcass is butchered into meat and a hide (pigskin for boar); pigskin tans into leather', () => {
  const g = newGame({ seed: 4242 });
  const out = (r) => Object.fromEntries(g.reg.get('recipe', r).outputs.map((o) => [o.item, o.qty]));
  assert.deepEqual(out('core:butcher_sheep'), { 'core:mutton': 5, 'core:hide': 1 });
  assert.deepEqual(out('core:butcher_cattle'), { 'core:beef': 12, 'core:hide': 2 });
  assert.deepEqual(out('core:butcher_boar'), { 'core:pork': 7, 'core:pigskin': 1 });
  assert.deepEqual(out('core:tan_pigskin'), { 'core:leather': 1 });
  for (const sp of NEW) {
    const d = g.reg.get('animal', sp);
    assert.ok(g.reg.get('item', d.carcass), `${sp} leaves a carcass`);
    assert.ok(g.reg.all('recipe').some((r) => r.fromStock && r.inputs.some((i) => i.item === d.carcass)), `${sp}: butchered from stock`);
  }
  for (const m of ['core:mutton', 'core:beef', 'core:pork']) assert.ok(g.reg.get('item', m).tags.includes('core:raw_food'));
});

test('livestock: the new herds keep the animal ledger exact and save and load identically', () => {
  const g = newGame({ seed: 7, scenario: 'core:living_world' });
  for (let d = 0; d < 6; d++) {
    runDays(g, 1);
    const c = animalCensus(g);
    assert.ok(c.ok, `day ${d + 1}: ${c.problems.join('; ')}`);
  }
  const n = counts(g);
  for (const sp of NEW) assert.ok(n[sp] > 0, `${sp} still there on day 6`);
  const r = reload(g);
  assert.equal(stateText(r), stateText(g));
  runDays(g, 1); runDays(r, 1);
  assert.equal(stateText(r), stateText(g));
  assert.deepEqual(conservationErrors(g), []);
});
