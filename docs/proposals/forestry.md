# Forestry: villages plant trees (design note, cloud copy, 2026-11-04)

From the Ideas parking lot ("Tree planting / forestry", the Phase 2b acceptance), proposed in the Phase 10 review.
The owner said "keep going".

## What exists
- Trees (`core:pine`: 6 wood a chunk, 2 chunks, 20 days to grow from a sprout) are chopped by the planner's wood
  wants (gather_nodes).
- Regrowth (Phase 5b, `regrow.js`):
  - burned, crushed and torn-up plants leave seeds that sprout;
  - in the Vast and Living worlds forests spread, but never within 3 tiles of a building, site or zone, so village
    grounds stay open.
- Nothing replants the woods round a village, so long runs strip the trees near old villages.

## Design (decisions)
- **A grove** (`settlement.grove { x, y, w, h, def, since }`, format 45, optional): a rectangle of 9 × 7 tiles
  (chosen after the World runs below; first 7 × 5).
  - A village lays one out when it has fewer than FOREST.min (30; first 20) grown trees of its wood tree within
    FOREST.reach (24) tiles of its centre, and the tree is one it can chop.
  - The grove goes on free, buildable, claimed ground, 8 to 22 tiles from the centre, at least 2 tiles from any
    building, site or zone. It is a site search like a field's, with its reason kept (`grove.why`).
  - One grove per village. It is kept while the village stands.
- **Planting:**
  - every other tile of the grove (a chequer, so it stays walkable) gets a young tree;
  - the giver `core:plant_trees` (in the woodcutting work) sends a woodcutter next to a free spot; after
    FOREST.work ticks a young tree sprouts there (`regrow.js sprout`; it grows up in the tree's `sproutDays`);
  - a spot is free when regrowth would let a plant grow there (not built, zoned, water, burning, or a trap for
    someone);
  - planting goes on while the village has fewer than FOREST.min + FOREST.extra (45) grown and young trees near
    it;
  - a distant village (nobody walks there) plants FOREST.farPerDay (2) young trees a day in its grove, in
    aggregate, by the same limit (a daily job, `tickGroves`).
- **No free rewards:** planting costs work and waiting. No item is made or used, so the item ledger is untouched.
  The trees are chopped as usual once grown.
- **Reasons:** a log line when the grove is laid out ("…are planting a grove: 12 trees left within 24 tiles"); the
  planner's note `P.forestNote`, kept only when there is something to say.
- **Not in it:** other tree kinds (data mods may add them: any node tagged `core:tree` that yields wood); orchards;
  wood at markets.

## Slices
1. The grove, planting, the note; tests; classic and World runs (trees near villages before and after).

## Results
### Slice 1: the grove and planting (built and tested, 2026-11-04)
- **Built:**
  - `src/sim/forestry.js` (`planForestry` in the planner, the giver `core:plant_trees` in Woodcutting, the job
    `plant`, the daily `tickGroves` for distant villages);
  - `settlement.grove` (format 45, save checks);
  - `regrow.js canSprout`;
  - the chronicle kind `core:grove`.
- **World seed 11, 200 days** (`tools/cloud-world-run.mjs`, now with grown pines within 24 tiles of each standing
  village):

  | Version | Villages under 20 trees | Average grown pines near a village | Groves |
  |---|---|---|---|
  | no forestry | 34 | 50 | – |
  | 7 × 5 groves, full-detail villages only | 32 | 47 | 1 |
  | 7 × 5, distant villages too | 28 | 53 | 29 |
  | 7 × 5, planting from 40 trees | 32 | 53 | 36 |
  | **9 × 7, planting from 30 (kept)** | **25** | **55** | **33** |

  - The runs differ in more than forestry (each world goes its own way), so the differences are modest and noisy.
  - The grove's size is the limit: grown trees there are felled as soon as they are ready, so planting earlier
    without more room did not help.
  - Villages still strip the trees round them; more groves, or wood at markets, would be the next step.
- **Checks:**
  - the kept run: 2.9 ms a tick on day 200; the save on day 100 loaded and ran on identically; no conservation
    errors;
  - classic hashes unchanged (`forty` 6a12204e4829dc11, `modern` 0b7058bac8b19e97: their villages keep plenty of
    trees);
  - full suite 332 passed.
- **Tests:** `tests/cloud-forestry.test.js`, 4 tests: a grove with its reason when short of trees; planting on
  every other tile, grown up after about 30 days, save and load identical; a bad grove refused, old saves without
  one; distant villages plant two a day up to the limit.
