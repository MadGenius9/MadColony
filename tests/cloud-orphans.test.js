// Phase 11, item 2: goods set aside when their mod is missing keep their owner when restored.
// A regression test for a suspected bug (docs/ROADMAP.md Phase 11): a stack set aside on load keeps its village
// inside the stack (`data.settlement`), but restoring set the owner only from the outer `owner` field (used for
// caravan goods), so an AI village's goods could come back as someone else's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, serializeGame, loadGame, conservationErrors } from './cloud-helpers.js';
import { readAllMods } from '../tools/fsmods.js';
import { buildRegistry } from '../src/sim/content/modloader.js';

let WITH = null;
/** The core content plus one extra item (as if a mod added it); and the plain core content (the mod "missing"). */
function registries() {
  if (!WITH) {
    const mods = readAllMods();
    mods.find((m) => m.manifest.id === 'core').files['content/items.json'].item.push({ id: 'core:test_gem', name: 'Test gem', color: '#8040c0', stackLimit: 50, tags: ['core:material'], value: 1 });
    WITH = buildRegistry(mods, ['core']).registry;
  }
  return { WITH, WITHOUT: newGame({ seed: 1 }).reg };
}

test('orphans: an AI village\'s stack set aside for a missing item comes back as that village\'s', () => {
  const { WITH, WITHOUT } = registries();
  const g = newGame({ seed: 7, registry: WITH, scenario: 'core:neighbours', villages: 2 });
  g.tick();
  const ai = Object.keys(g.s.settlements).find((k) => g.s.settlements[k].ai);
  const c = g.s.settlements[ai].center;
  g.actor = ai;
  g.createItems('core:test_gem', 10, c.x + 1, c.y + 1, 'start', undefined, true);
  g.actor = null;
  const st = Object.values(g.s.stacks).find((x) => x.item === 'core:test_gem');
  assert.ok(st, 'the gems are on the map');
  assert.equal(st.settlement, ai, 'and belong to the AI village');
  // Loaded without the item: set aside.
  const without = loadGame(WITHOUT, serializeGame(g));
  assert.ok(without.s.orphans.some((o) => o.kind === 'stack' && o.data.item === 'core:test_gem'), 'set aside');
  // Loaded with it again: restored at the next restoring tick.
  const back = loadGame(WITH, serializeGame(without));
  for (let t = 0; t < 700 && back.s.orphans.length; t++) back.tick();
  const gem = Object.values(back.s.stacks).filter((x) => x.item === 'core:test_gem');
  assert.ok(gem.length > 0, 'restored');
  assert.equal(gem.reduce((a, x) => a + x.qty, 0), 10, 'all of it');
  assert.ok(gem.every((x) => x.settlement === ai), `still the AI village's (owners: ${gem.map((x) => x.settlement).join(', ')})`);
  assert.deepEqual(conservationErrors(back), []);
});

test('orphans: goods an AI villager was carrying, set aside for a missing item, come back as the village\'s', () => {
  const { WITH, WITHOUT } = registries();
  const g = newGame({ seed: 7, registry: WITH, scenario: 'core:neighbours', villages: 2 });
  g.tick();
  const ai = Object.keys(g.s.settlements).find((k) => g.s.settlements[k].ai);
  const p = g.owned('colonists', ai)[0];
  g.actor = ai;
  g.createItems('core:test_gem', 3, Math.round(p.x), Math.round(p.y), 'start', undefined, true);
  g.actor = null;
  const st = Object.values(g.s.stacks).find((x) => x.item === 'core:test_gem');
  if (p.job) { g.release(p.job); p.job = null; }
  p.carry = g.takeFromStack(st.id, 3);
  const without = loadGame(WITHOUT, serializeGame(g));
  assert.ok(without.s.orphans.some((o) => o.kind === 'stack' && o.data.item === 'core:test_gem' && o.owner === ai), 'set aside with its village');
  const back = loadGame(WITH, serializeGame(without));
  for (let t = 0; t < 700 && back.s.orphans.length; t++) back.tick();
  const gem = Object.values(back.s.stacks).filter((x) => x.item === 'core:test_gem');
  assert.equal(gem.reduce((a, x) => a + x.qty, 0), 3, 'restored, all of it');
  assert.ok(gem.every((x) => x.settlement === ai), `the AI village's (owners: ${gem.map((x) => x.settlement).join(', ')})`);
  assert.deepEqual(conservationErrors(back), []);
});
