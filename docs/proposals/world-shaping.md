# World shaping (2026-10-24 direction, item 4)

Status: **design** (2026-10-28). Waiting for the owner's "go" and answers to the open questions; the proposals below
are the working defaults. Branch `cloud-work` (cloud rescue copy; see CLAUDE.md).

## Goal
- **2026-10-24 direction, item 4:**
  - terrain brushes: raise and lower land, dig water, make mountains, plant forest, place stone and ore deposits;
  - a "Blank world" scenario: shape the planet first, then spawn the first people.
- WorldBox's breadth, never a copy: our own tools, names and look.
- **Rules for every phase:**
  - determinism across save and load: brush strokes are god commands, saved and replayed;
  - conservation: what a brush makes or destroys goes through the ledgers;
  - sim and UI kept apart (UI notes);
  - old saves load;
  - content as data;
  - works for 30+ villages;
  - visible reasons.

## What exists today
- **Terrain:**
  - `Game.setTerrain(i, id)` bumps `s.map.rev`, which rebuilds every whole-map cache built from the terrain: drink
    spots, the water walk (`path.js`), land chunks and contact (`contact.js`), territory frontiers
    (`territory.js`), animal habitat (`animals.js`). That is about 0.5 s on Vast for one change.
  - `setTerrainKeepRev` (Phase 5b craters) changes a tile without the revision when the move cost and claim cost
    stay the same.
  - Walkable regions are rebuilt per chunk.
- **Nature:** nodes (trees, rocks, ore, bushes) are added and removed with indexes kept (`addNode`,
  `destroyNode`); regrowth and forest spread (`regrow.js`); ore and stone come from rock nodes and quarries.
- **Worlds:** worldgen presets (temperate, continent, planet) build terrain from elevation and moisture once at the
  start. Scenarios pick the preset and the starting people.
- **God powers:** commands with preview, confirm, cost and replay (`god.js`). `spawn` brings settlers (it can found
  a village on a tile).

## Design

### Brushes (god powers, one command per stroke)
- **A stroke:** `{ brush, x, y, r }` (radius 1–8 tiles), or a short line of up to 16 points for a drag (one
  command, one map revision).
- **Brushes:**
  - **raise:** water → shallows → sand or grass; land → hills; hills → mountain.
  - **lower:** mountain → hills; hills → grass; land → shallows; shallows → water. Buildings stop it (it is
    refused on them).
  - **water:** dig a lake or river (land → shallows at the edge, water inside).
  - **mountain:** make mountains (impassable; people and animals there are moved off, nodes removed).
  - **forest:** plant young trees on fitting free land (as regrowth: `sprout`, so they grow up over days).
  - **stone** and **ore:** place rock or ore nodes on free land (`created:divine` is not needed: nodes are not
    items, and mining them goes through the ledger as usual).
  - **flatten:** clear brush and rocks and level hills to grass, for building.
- **Safety:**
  - A stroke never traps anyone (the existing `wouldTrap` check: tiles that would shut a person or a village in
    are left out).
  - It never changes tiles under buildings, fields, stockpiles or people (they are left out and the preview says
    how many).
  - Destroyed nodes leave seeds as usual; crops on lowered land drown (`destroyCrop`).
- **Cost:** favour per tile changed (small: 0.2 a tile). Free in Sandbox and in the Blank world.
- **Speed:** one stroke is one map revision, so the whole-map caches rebuild once. On Vast that is about 0.5 s a
  stroke.
  - Proposal: strokes apply at once in the Blank world (no people yet, so nothing waits on the caches).
  - In a running game, at most one stroke an hour of game time is applied (the rest wait in the queue, shown).
  - Making the caches incremental (rebuild only round the change) is a later speed slice if strokes feel slow.

### Blank world (a scenario)
- A Vast-sized world of open water with a few islands (or flat grass: open question 2), no people, no animals and
  no monsters at the start. Sandbox rules: favour is free.
- The player shapes it with the brushes, then:
  - **spawn people** (the existing `spawn` power founds villages);
  - **animals** (Phase 8b `animals` power);
  - **monsters** (Phase 8c `monster` power).
- Animals and monsters are not placed on their own until the player starts life ("Start life": one command that
  places the herds and lairs by the usual rules on the shaped land).
- Time runs as usual, but nothing happens until people exist; a pause-like "shaping" mode is the UI's job.

### Saves
- Strokes are commands in `s.god.log` and their results are in the saved terrain and nodes. No new state beyond an
  optional `s.shaping { started }` for the Blank world.
- Save format 30.

## Slices
1. **The raise and lower brushes:** one command per stroke, terrain changes, safety rules (trap, buildings,
   people), one map revision a stroke.
   - Tests: shapes as previewed, save and load identical, nobody trapped, buildings untouched, caches right after
     a stroke (water walk, regions, territory).
2. **The water, mountain, flatten, forest, stone and ore brushes.**
   - Tests: lakes drinkable, mountains impassable and people moved off, trees sprout and grow, ore mined through
     the ledger.
3. **The Blank world scenario and "Start life".**
   - Tests: an empty world shaped, people spawned, herds and lairs placed on the shaped land.
4. **Speed:**
   - measure strokes on Vast and World;
   - the one-stroke-an-hour queue in running games;
   - incremental caches if needed.
5. **Acceptance:** a scripted shaping run (a continent built from water, villages founded, 60 days), save and
   load after each stroke, the classic runs, the bench, README and roadmap.

## Open questions for the owner
1. **Brushes:** raise, lower, water, mountain, flatten, forest, stone and ore. Add or drop any, e.g. desert, snow
   or marsh painting?
2. **The Blank world's start:** open water with a few islands, or one flat grass plain?
3. **In a running game:** may the player reshape land where villages live (with confirm near villages), or only
   empty land?
4. **Cost:** 0.2 favour a tile in normal games, free in Sandbox and the Blank world?
5. **Slow strokes:** about 0.5 s a stroke on Vast. Proposal: accept it now and make the caches incremental later
   if it feels slow.
