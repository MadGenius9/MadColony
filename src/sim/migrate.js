import { SAVE_FORMAT } from './constants.js';
import { kingdomsFromParents } from './kingdoms.js';
// Save migrations. Each step upgrades a state object in place from one save format to the next.
// Loading always works on a deep copy, so the stored original save is never changed.
export const MIGRATIONS = {
  // 1 -> 2: settlement ownership and research (Phase 1).
  1(s) {
    s.settlements ||= { t1: { id: 't1', name: 'First Hearth', founded: 0 } };
    const sid = Object.keys(s.settlements)[0];
    for (const c of Object.values(s.colonists || {})) c.settlementId ||= sid;
    for (const coll of ['structures', 'stacks', 'projects', 'fields', 'homes']) {
      for (const e of Object.values(s[coll] || {})) e.settlement ??= sid;
    }
    s.stockpileOwner ||= sid;
  },
  // 2 -> 3: every settlement owns its own stockpile zone; relations and trades exist.
  2(s) {
    const owner = s.stockpileOwner || s.playerSettlement || Object.keys(s.settlements || {})[0] || 't1';
    if (s.settlements?.[owner] && Array.isArray(s.stockpile)) s.settlements[owner].stockpile = s.stockpile;
    for (const st of Object.values(s.settlements || {})) st.stockpile ||= [];
    delete s.stockpile; delete s.stockpileOwner;
    s.relations ||= {};
    s.trades ||= {};
    s.diplomacy ||= { tradePolicy: 'open' };
  },
  // 3 -> 4: only the file encoding changed (compact terrain and nodes, decoded by savecodec.js before
  // migrating); the state itself needs nothing.
  3() {},
  // 4 -> 5: level of detail (big worlds). Villages without `detail` are simulated in full; no caravans yet.
  4(s) { s.caravans ||= {}; },
  // 5 -> 6: alliances (Phase 2). Every new field is optional and absent in old saves; nothing to add (no
  // empty objects: `s.alliances` is created when the first alliance is signed).
  5() {},
  // 6 -> 7: the save may carry the planner's state beside `state` (save.planner); older saves have none and
  // the loaded game plans afresh. The state itself needs nothing.
  6() {},
  // 7 -> 8: kingdoms (Phase 2, slice 3). Villages founded during play before kingdoms existed (settlement.parent)
  // get the kingdoms they would have formed at founding time: replayed in founding order (founded, then id),
  // with no random numbers, so a saved world keeps its family of villages together. Worlds without daughters
  // (all classic worlds) are untouched: `s.kingdoms` is created only when a kingdom forms. `reg` (optional)
  // supplies the profiles' kingdom name patterns.
  7(s, reg) { kingdomsFromParents(s, reg); },
  // 8 -> 9: markets (Phase 2, slice 4). `s.markets` and `trade.market` are optional and absent in older saves
  // (no market had been built); the first daily update after a market is built writes them. Nothing to add.
  8() {},
  // 9 -> 10: organic territory (Phase 2b, slice 4). `s.claims` is optional: only games started in a scenario with
  // `territory: "organic"` have it. Older saves have none and keep the nearest-centre rule, unchanged (even a
  // vast-world game saved before slice 4). Nothing to add.
  9() {},
  // 10 -> 11: contact over distance (Phase 2b, slice 5). `s.contact` is optional: only games started in a scenario
  // with a `contact` block have it. Older saves have none: no explorers, no traders, no touching-lands contact
  // (even a vast-world game saved before slice 5). Nothing to add.
  10() {},
  // 11 -> 12: civilization spreads (Phase 2b, slice 6). Contact games may prune finished trades (contact.js
  // pruneTrades); completed ones pruned are counted on the relation (`rel.tradesDone`, optional). Older saves
  // kept every trade, so there is nothing to count or add.
  11() {},
  // 12 -> 13: god powers (Phase 2c). `s.god` is optional: it is made when the first power is used, or at the start of
  // a Sandbox game. Older saves have none, which means no power was used yet (favour is then worked out from the
  // day, god.js favourNow). Nothing to add.
  12() {},
  // 13 -> 14: power storage (Phase 3, slice 4). A battery's stored energy (`structure.charge`) is optional: absent
  // means empty, and older saves had no batteries. Nothing to add.
  13() {},
  // 14 -> 15: death (Phase 5, slice 1a). `s.dead` (the dead by id), `health.zeroSince` and `s.stats.deaths` are
  // optional: absent means nobody has died, as in every older save. Nothing to add.
  14() {},
  // 15 -> 16: burial and mourning (Phase 5, slice 1b). Bodies (`s.bodies`), graves (`structure.grave`), the
  // graveyard (`settlement.graveyard`) and grief (`colonist.grief`) are optional. A format-15 save with the dead
  // has no bodies: they count as laid to rest. Nothing to add.
  15() {},
  // 16 -> 17: contagious illness (Phase 5, slice 3). The sickness fields on injuries, `colonist.immune` and
  // `s.stats.illness` are optional: absent means nobody fell ill. Nothing to add.
  16() {},
  // 17 -> 18: lasting injuries and surgery (Phase 5, slice 4). `colonist.lasting` and the injury flags `deep` and
  // `mended` are optional; wounds from older saves are not deep (they leave no lasting injury). Nothing to add.
  17() {},
  // 18 -> 19: rivalry and wars (Phase 5, slice 5). `relation.touch` (lands touch, war games) and `relation.threat`
  // (an AI village threatened the player) are optional. Older vast-world saves have no touch marks: borders that
  // touched before stay quiet. Nothing to add.
  18() {},
  // 19 -> 20: AI wars (Phase 5, slice 5b). `relation.warSince` is optional: a war from an older save has no start
  // time, so it ends only when one side is losing. Nothing to add.
  19() {},
  // 20 -> 21: fallen villages (Phase 5, slice 6a). `settlement.fallen` is optional: absent means the village
  // stands. An empty village from an older save falls at the next day start. Nothing to add.
  20() {},
  // 21 -> 22: conquest (Phase 5, slice 6b). `relation.beaten` (who has had no fighters, since when) and the trade
  // flag `tribute` are optional. Nothing to add.
  21() {},
  // 22 -> 23: fire (Phase 5b). `s.disasters` (burning and scorched tiles) is optional: absent means nothing burns.
  22() {},
  // 23 -> 24: tornadoes (Phase 5b). `s.disasters.storms` is optional: absent means no storm blows. Nothing to add.
  23() {},
};

export function migrateState(s, fromFormat, reg = null) {
  let f = Number(fromFormat) || 1;
  while (f < SAVE_FORMAT && MIGRATIONS[f]) { MIGRATIONS[f](s, reg); f++; }
  s.format = f;
  return s;
}
