// Shared helpers for running the simulation without a browser (tests and the CLI simulator).
import { readAllMods } from './fsmods.js';
import { buildRegistry } from '../src/sim/content/modloader.js';
import { Game } from '../src/sim/game.js';
import { TICKS_PER_DAY } from '../src/sim/constants.js';

export function makeRegistry(enabled = ['core']) {
  const { registry, report } = buildRegistry(readAllMods(), enabled);
  if (report.rejected.length) throw new Error('Mods rejected: ' + JSON.stringify(report.rejected));
  return registry;
}

export function newGame(opts = {}) {
  const reg = opts.registry || makeRegistry(opts.mods || ['core']);
  const g = Game.create(reg, { seed: opts.seed ?? 20261021, scenarioId: opts.scenario, worldgenId: opts.worldgen, size: opts.size, villages: opts.villages, sandbox: opts.sandbox });
  if (opts.debugThrow !== false) g.debugThrow = true;
  return g;
}

export function summary(g) {
  const s = g.s;
  const stock = g.stockTotals();
  const homes = Object.values(s.homes);
  const built = Object.values(s.structures).filter((b) => b.built);
  const cols = g.colonists();
  return {
    day: (s.tick / TICKS_PER_DAY).toFixed(2),
    stock,
    meals: stock['core:stew'] || 0,
    homes: homes.map((h) => `${h.name}${h.complete ? '✓' : '…'}(${h.owners.length}/${h.capacity})`).join(' '),
    housed: cols.filter((c) => c.homeId).length,
    stations: built.filter((b) => g.bDef(b).category === 'station').map((b) => b.def).join(','),
    fields: Object.keys(s.fields).length,
    crops: Object.keys(s.crops).length,
    tools: cols.map((c) => `${c.name}:${c.equip.tool?.item?.split(':')[1] || '-'}`).join(' '),
    needs: cols.map((c) => `${c.name} H${c.needs['core:hunger'].toFixed(2)} E${c.needs['core:energy'].toFixed(2)}`).join(' | '),
    jobs: cols.map((c) => `${c.name}:${c.job?.type || 'idle'}`).join(' '),
    stats: s.stats,
  };
}

export function conservationErrors(g) {
  const census = g.census();
  const L = g.s.ledger;
  const errs = [];
  const items = new Set([...Object.keys(census), ...Object.keys(L.created), ...Object.keys(L.consumed)]);
  for (const it of items) {
    const expect = (L.created[it] || 0) - (L.consumed[it] || 0);
    if ((census[it] || 0) !== expect) errs.push(`${it}: exists ${census[it] || 0}, ledger says ${expect}`);
  }
  return errs;
}
