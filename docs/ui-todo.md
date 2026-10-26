# UI to-do (from cloud work)

The cloud copy has no `src/ui`. Every feature the player must see gets an entry here: what the UI must show,
where, and which sim function or state field provides it. The UI is built at home from this list.

## Phase 5, slice 1a: death
- **Death letter (important):** for each new log entry with category `death` (`g.s.log`, `cat: 'death'`): the text
  as written ("Ana of Pinecroft died of their wounds (struck by an arrow)."). Click: jump to the place
  (`g.s.dead[id].x/y`). Important for the player's village, routine for others.
- **The dead in the Colony tab:** a "Died" list for the player's village from `g.s.dead` (entries with
  `settlementId === playerSettlement`): name, day (`tick / 2400`), `text`, `injury`. Counts by cause from
  `g.s.stats.deaths`.
- **Village summary / World tab:** deaths so far (count `g.s.dead` by `settlementId`).
- **Inspector and hover card:** a colonist at 0% health shows "Bleeding out: dies in N h without care"
  from `c.health.zeroSince` (dies at `zeroSince + HEALTH.deathAfterHours × 100` ticks); once cared for
  (tended, medical bed, dressed or cleaned wound) "Cared for".
- **Portrait bar:** a dead colonist disappears (they leave `g.s.colonists`); a letter explains why.
- **Sound:** the death cue (was planned for Phase 5 in Phase 1b) on a `death` log entry of the player's village.
- **Empty villages:** a village with no people left keeps its card; show "Nobody lives here any more".
