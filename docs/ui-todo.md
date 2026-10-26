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

## Phase 5, slice 1b: burial and mourning
- **Bodies on the map:** each `g.s.bodies[id]` at `x, y` (a lying figure in the village colour); when
  `carriedBy` is set, draw it on the carrier. Hover: "The body of <name> (`g.s.dead[cid].name`), died day N".
- **Graves:** buildings with `def === 'core:grave'` (`render.shape: 'grave'`, a new shape: a small mound with a
  marker stone). Hover / inspector: "Grave of <name>, buried day N" from `structure.grave`.
- **Burial job:** the colonist card shows the job label ("Bury Ana") and status action ("Carrying Ana to the
  graveyard", "Burying Ana"), already in `c.job.label` / `c.status.action`.
- **Grief:** hover card and inspector line "Grieving for <name> (until day N): work 85%" from `c.grief`
  (`for`, `until`, `work`). A small dark ribbon on the portrait while `grief.until > tick`.
- **Log/letters:** "X buried Y." and "Y was buried by the people of V." are routine (`cat: 'info'`).
- **Work grid:** no new column (burial is part of Care).

