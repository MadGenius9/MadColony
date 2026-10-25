# Phase 2b: the vast world

Status: **in progress** on branch `phase2b` (from `main` after Phase 3 slice 3, `564dec7`). Slices 1
(`1ea7399`) and 2 (`d85a309`) are done; slices 3–8 are open. See "Results" at the end.

## Goal (from the user)
The game should feel like WorldBox and The Universim.
- **The world:** very large and almost empty at the start. A few small settlements begin far apart, grow and
  spread until civilizations meet, trade, ally and fight.
- **The camera:** zooms smoothly from one settler to the whole planet on screen.
- **Territory:** follows the land and grows outward from settlements.
- **Performance:** only places with people cost anything per tick.
- **Compatibility:** existing worlds and scenarios keep working unchanged.

## What exists and what breaks (explorer map + measurements)

Measured in Node 24 on this machine, Living world, seed 7, 10 AI villages, unchanged code (no file in the
repo edited). Timings are ranges because other agents were running.

| Size | Tiles | Nodes | Create | of which worldgen | Heap | Per tile | Save | Load ¹ | ms/tick (1 day) | Worst tick |
|---|---|---|---|---|---|---|---|---|---|---|
| Colossal 544×408 | 0.22M | 30k | 0.7–0.9 s | 0.35 s | 24 MB | ~159 B | 0.6 MB | 0.26 s | 0.31–0.51 | 56–80 ms |
| 1024×768 | 0.79M | 107k | 2.2–3.5 s | 1.1 s | 80 MB | ~152 B | 1.8 MB | 1.8 s | 0.81–1.21 | 116–151 ms |
| 1536×1152 | 1.77M | 238k | 8.5–12 s | 3 s | 174 MB | ~148 B | 3.9 MB | 4.0 s | 1.18–1.55 | 198–313 ms |
| 2048×1536 | 3.15M | 424k | 17–31 s | 9–11 s | 315 MB | ~150 B | 7.1 MB | 7.5 s | 1.25–2.53 | 340–550 ms |

¹ Measured with the save size limit raised in a scratch copy. In the real code, **no map wider or taller than
1000 tiles loads** (`save.js:58`).

### What breaks, in order
1. **Saves:**
   - load rejects maps over 1000 tiles;
   - the browser keeps saves in localStorage (about 5 MB, and each slot keeps a "(previous)" copy), so
     saves of 1536×1152 and up do not fit.
2. **Creation time:**
   - **Worldgen pass carving** is quadratic: each land pocket allocates a full-map array and scans the map
     3 times. It takes 4.1 s at 2048, with 347 pockets.
   - **`toQuantiles`** sorts with a JavaScript comparator: 2.6 s.
   - **Other costs:** `rebuildIndexes` 2–2.5 s, the water-walk Dijkstra 2 s, `spreadSites` 3.4 s and GC.
3. **Per-tile memory: about 150 B.** Six `Array(N).fill(null)` index arrays plus a string terrain array make
   up about 56 B; the path buffers, water walk, regions and heat make up the rest.
4. **Long ticks:**
   - **`ensureRegions`** runs a whole-map union-find after any node or structure change: 233 times a day,
     10.5 ms each at 2048 when the machine is quiet.
   - The **first `emptyNodes()`** scans all nodes (200–550 ms).
   - **`nodesByDefChange`** copies lists of 100k entries: 12–39 ms each.
5. **The world looks like one big field:**
   - ocean comes only from edge falloff, so there is a single continent;
   - climate is one temperature for the whole world;
   - rivers are short downhill walks.
6. **Contact:**
   - **Abstract villages never meet anyone:** their people sit at home.
   - **Scouts** are full-detail jobs limited to the same land region.
   - **Caravans** only serve trades that already exist.
7. **Spread:**
   - founding allows **one per day world-wide**;
   - a new village must be within 36 tiles of its parent, nearest first, on the same landmass.
8. **Territory:** the nearest village centre owns each tile (a Voronoi grid). Rebuilding it costs O(tiles ×
   villages) (125M operations at 2048 with 40 villages). It is drawn at 2 pixels per tile, which is 12.6M
   pixels at 2048.
9. **Drawing:**
   - **Every frame:** sorts all colonists (`g.colonists()`) and draws every settlement's label.
   - **Every 30 frames:** clears and refills a full-map structure image.
   - **On any terrain change:** the renderer diffs every tile.

## Design

### Sizes
- New presets **Vast 1536×1152** and **World 2048×1536**. Both use a new generator (below) and are offered in
  New colony.
- **Decision rule:** after the slice 1 and 2 speed work, World ships only if it meets the targets below
  (generation under ~10 s in the browser, load under ~5 s, worst tick at most 50 ms in normal play).
  Otherwise the largest size that does meet them becomes the top preset, and the reason is recorded.
- **Expected after the fixes:** worldgen about 3–4 s at 2048 (no quadratic carving, a typed sort) and total
  creation about 6–8 s. Generation runs in a Web Worker with a progress bar if the main thread would freeze.

### Slice 1: scale foundations (no change to existing runs)
All existing runs stay byte-identical: the classic fingerprints, the 40-day run, the seed 4242 run and the
Living-world hashes.
- **Saves:**
  - raise the map limit to 4096;
  - the browser stores saves in **IndexedDB** (still zero dependencies), gzip-compressed with the built-in
    `CompressionStream`;
  - existing localStorage saves are moved over once; localStorage is the fallback if IndexedDB is missing;
  - Node tests keep using the same codec.
- **Per-tile memory:**
  - terrain becomes a `Uint8Array` of palette indices;
  - the six per-tile indexes (node, structure, stack, crop, footprint, zone) become `Int32Array`s of numeric
    handles into id tables;
  - target: **at most 70 B per tile** (from 150).
  - Accessors stay the same for callers where possible; this is the largest refactor, so it is done behind
    the existing accessors first.
- **Regions:** the union-find becomes incremental. Only the borders of dirty chunks are re-joined, with a
  coarse chunk graph kept, so a node or structure change costs O(chunk) instead of O(map).
- **Indexes:**
  - `emptyNodes` is built in `warmCaches`;
  - `nodesByDef` is updated without copying (per-def `Set`s, or arrays with swap-remove plus a stable order
    rule);
  - `spreadSites` is made faster.
- **Worldgen:**
  - pass carving becomes one multi-source search with reused buffers, with output identical to now;
  - `toQuantiles` uses a typed sort, with identical results.
  
  Existing generators must give byte-identical maps; tests pin this.
- **Format:** stays 9. The typed arrays are runtime only, and the save layout is unchanged.

### Slice 2: a planet generator
- A new generator `core:planet` in its own data file, `mods/core/content/planet.json`. The classic and
  `core:continent` generators are untouched.
- **Land:**
  - several continents and islands from low-frequency "plate" noise, with an ocean share set as data
    (e.g. 55–65%);
  - mountain ranges from ridged noise along plate edges;
  - shallow coasts and inland lakes.
- **Climate:** bands by latitude plus elevation (tundra and taiga toward the top and bottom, temperate,
  grassland and desert, jungle near the middle) and moisture from distance to the ocean.
  - This changes generation only. The running game's weather stays global for now; latitude weather is
    parked.
- **Rivers:** many long rivers from mountains to the sea, with continuous flow, joined into river systems.
- Deterministic by seed. Resources (nodes) follow the biomes at densities set as data, scaled so that node
  memory stays bounded.
- **Tests:**
  - determinism;
  - continent count and ocean share within the data bands;
  - every start site reachable from its own land;
  - generation time is recorded.

### Slice 3: the vast-world scenario (new default)
- **New scenario `core:vast_world`** (data). It becomes the default in New colony; all existing scenarios
  stay and behave as before.
- **Settlements:**
  - the player with the usual founders, plus 4–8 AI settlements (data);
  - at least `spacing = round(0.1 × sqrt(W×H))` tiles from each other (Vast 133, World 177; never under
    120);
  - on good sites: fresh water within walking distance, fertile land, wood and stone nearby;
  - spread over different regions and biomes, chosen by a deterministic farthest-first pick that rewards
    biome variety.
- **Landmass:** all starting settlements share one large landmass, so they can meet over land. Other
  continents start empty; reaching them needs boats, which is parked.
- Most of the world starts as untouched wilderness.

### Slice 4: organic territory
- **Rule (per scenario):** `territory: "organic"`. Classic and existing scenarios keep the nearest-centre
  rule.
- **Claims:** a saved **claim grid** (`Uint16Array` of settlement index, kept compact in the save). Every
  settlement claims tiles outward from its centre.
- **Daily growth:**
  - each settlement claims frontier tiles up to a radius budget that grows with population and age (data);
  - claims spread by terrain cost: open land is cheap, forest costs more, mountains cost a lot, deep water
    and rivers stop them unless crossed by an existing claim;
  - tiles another settlement already holds are never taken (conquest is Phase 5).
- **Cost:** O(new tiles) per day, using a per-settlement frontier list.
- **Use:** `claimOk`, `gatherOk`, gathering rights and founding read the claim grid through `territoryAt`
  (same interface).
- **Visible:** "Willowmere's land reached the river" is too noisy, so instead the village card shows land
  area, growth per day and what limits it (terrain or neighbours).
- **Save format 10:** the claim grid, plus frontier lists if needed. The migration leaves old saves on the
  nearest-centre rule, because their scenarios don't ask for organic territory.

### Slice 5: contact over distance
- **Explorers:**
  - every settlement (full or abstract) sends a small expedition out every N days (data);
  - an expedition is a light travelling entity, like caravans, not colonists on jobs;
  - it follows a deterministic route over its land region: farther each time, choosing unexplored chunks,
    with a hash-based choice and no new RNG stream;
  - it marks chunks as discovered (a per-settlement chunk bitset, about 400 B per settlement at 2048), then
    comes home.
- **Meeting through explorers:**
  - an expedition that passes within reach of another village's land or centre makes contact;
  - **log:** "Explorers from Oakmere met the people of Stonegard (14 days out)";
  - the relation history records the cause.
- **Traders:** villages in contact send traders on a schedule (data). The trips keep relations and markets
  alive, and the caravans show on the map.
- **Borders touching:** when two claim areas become neighbours, they make contact.
  - **log:** "The lands of A and B now touch";
  - the relation history records the cause.
- **Abstract level:** the same entities and rules; nothing per tile.
- **Cost:** O(expeditions) per tick, moving along cached coarse routes.
- **Reported:** the number of village pairs that have met by day 30, 100 and 300.

### Slice 6: civilization spreads
- **Founding** (scenario data):
  - one founding per village per cooldown (no world-wide one-per-day rule), with a world-wide budget per day
    as a performance guard;
  - `searchRadius` scaled with the map;
  - site choice biased outward: unclaimed land, away from other settlements, good resources, the direction of
    the most promising discovered land;
  - daughters can settle anywhere on discovered land within reach.
- **Village cap:** a data cap set by the performance budget. The target is that day 300 stays within ≤ 1.5
  ms/tick typical.
- **Expected counts (to be measured and tuned):**
  - start: 5–9;
  - day 100: about 20–30;
  - day 300: about 45–70, up to the cap.
- **Growth** relies on Phase 2's room-to-grow rule, with data tuned so villages reach founding size in weeks,
  not months.

### Slice 7: seeing the whole world
- **Camera:** zooms out until the entire world fits on screen (already possible, with `fitZoom`), with a
  smooth path all the way in.
- **World texture:** one pixel per tile for terrain, territory and structures, in canvases updated **per
  dirty chunk** (no full-map refills). At 2048 that is 3.1M pixels per layer, about 12 MB.
- **Territory:** drawn at one pixel per tile with smoothed borders (a cheap edge pass), instead of the
  2-pixels-per-tile overlay.
- **Labels by zoom level:**
  - zoomed far out, only kingdom names (biggest first, with collisions removed);
  - zooming in, village names appear;
  - zoomed in, today's labels;
  - labels are culled to the view, so there is no per-frame label work for off-screen settlements.
- **People and travellers:**
  - colonists are not drawn below a zoom threshold, so there is no per-frame `g.colonists()` sort; at mid
    zoom they show as dots taken from a cached list;
  - explorers, traders and caravans are drawn as small markers.
- **Minimap:** shows the whole world from the same textures.
- **Target:** 60 fps with the whole world on screen, measured in headless Edge with `perfStats` and a frame
  budget.

### Slice 8: acceptance
A 300-day headless run on the largest preset, plus the browser checks.

## Data and save changes
- **New data:**
  - `planet.json` (generator, biomes, climate bands, rivers, node densities);
  - the `core:vast_world` scenario (sizes, spacing, settlements, territory rule, founding, explorers,
    traders);
  - schema validation for all of it.
- **Presets:** Vast and World are added to `WORLD_SIZES` and to the scenario size enum.
- **Save format 10:** the claim grid; expeditions and discovered-chunk bitsets as compact strings; the map
  limit raised. Older saves migrate without change, keeping their old territory rule.
- **Browser saves:** they move to IndexedDB, gzipped. This is a storage change, not a format change.

## Per-tick cost
| System | When | Cost |
|---|---|---|
| Regions | on change | O(dirty chunks), not O(map) |
| Territory growth | daily | O(new tiles) |
| Explorers and traders | per tick | O(travelling entities) |
| Contact checks | when an entity reaches a new chunk | O(villages near) |
| Founding | daily | O(villages) plus a bounded site search |
| Empty wilderness | — | nothing per tick |
| Rendering | per frame | O(visible labels + travellers); textures updated per dirty chunk |

## Distant villages
They grow, found, claim land, send explorers and traders, and make contact by the same rules in aggregate.
Nothing they do costs per-tile work per tick.

## Targets (measured before and after, recorded in docs/PERFORMANCE.md)
- **Generation:** under ~10 s in the browser for the largest preset.
- **Memory:** per-tile cost stated, at most 70 B per tile; typed arrays only; no per-tile objects.
- **Saves:** size for the largest preset at day 0 and day 100 (compressed and raw); load time.
- **Ticks at day 100 and day 300,** with the village count reached by then: ≤ 1.5 ms typical, ≤ 2.5 ms worst
  case on average over a day, and worst single tick ≤ 50 ms after warm-up.
- **Drawing:** 60 fps with the whole world on screen.

## Acceptance tests
1. **Existing worlds unchanged:** classic fingerprints, the 40-day run, seed 4242, the Living-world hashes,
   and old saves (formats 3–9).
2. **Generation:** deterministic by seed; continents and ocean share within bands; generation time within
   the target; memory per tile within the target.
3. **Start:** 5–9 settlements, each at least `spacing` apart, on good sites in different biomes, all on one
   landmass.
4. **Organic territory:** grows, follows terrain (stops at mountains and water), never steals; save/load is
   identical; `claimOk` and `gatherOk` agree with the grid.
5. **Contact:** explorer, trader and border contacts each have a logged cause; abstract villages make contact
   too; the number of pairs met by day 30, 100 and 300 is reported.
6. **Spread:** village counts at day 100 and 300 are near the expected counts and within the cap;
   conservation holds throughout.
7. **The 300-day headless run on the largest preset** (seed fixed):
   - ms/tick, worst tick and heap at days 100 and 300;
   - save size and load time at days 0, 100 and 300;
   - a save at day 150 continues identically to day 300;
   - conservation every 10 days.
8. **Browser:** generation time; zoom from one settler to the whole world; 60 fps fully zoomed out; labels by
   zoom level; minimap; no console errors.
9. **Full suite:** `npm test`, `npm run sim -- 40 --log`, the seed 4242 Modern run and `node tools/bench.js`.

## Results

### Slice 1: scale foundations (commit `1ea7399`)
**What was built:**
- **Typed per-tile storage** (`src/sim/tiles.js`) behind the `Game` accessors:
  - terrain is a palette index per tile (`Uint8Array`, widened to `Uint16Array` past 256 terrain kinds);
  - the node layer is an `IdLayer` (`Int32Array` of handles);
  - structures, stacks, crops, building-site footprints and zones are `SparseIdLayer`s: handles in blocks
    of 1024 tiles, made when a block gets its first entry;
  - `terrainAt`, `nodeAt`, `structAt`, `stackAt`, `cropAt`, `footAt` and `zoneAt` take `(i)` or `(x, y)`;
    new are `terrainIdx`, `terrainPalette`, `setTerrain` and id getters and setters;
  - the old per-tile arrays and `s.map.terrain` remain as slow compatibility views.
- **Regions:** incremental. Only changed chunks are relabelled, then joined on a coarse chunk graph. The
  region ids are identical to the whole-map rebuild.
- **Indexes:** `emptyNodes` is built together with the other indexes; `nodesByDef` is updated without
  copying lists; `spreadSites` is faster.
- **Worldgen:** `toQuantiles` uses a typed sort; pass carving uses buffered searches.
- **Paths:** A* runs in an 801×801 window round the start. A search that leaves the window is rerun exactly
  over the whole map (buffers reused), so routes are unchanged.
- **Saves:**
  - the map limit is 4096 (`save.js` `MAX_MAP`); a hand-made 4096×4096 save needs several hundred MB to
    load;
  - browser saves are in IndexedDB, gzip-compressed with `CompressionStream` (Colossal day 0: 632 KB →
    114 KB, about 18%);
  - old localStorage saves are moved over once; without IndexedDB saves stay in localStorage; without
    `CompressionStream` they are stored as plain bytes;
  - damaged or unpackable saves give a clear error; an autosave can't overwrite a newly loaded game;
  - import accepts `.json.gz`.
- Save format stays 9.

**No change to existing runs:** the classic fingerprints, the 40-day run, the seed 4242 Modern hashes, the
Living world Colossal 30-village hashes at days 10, 30 and 60, all fixtures and worldgen at sizes 544–2048
are identical. Tests pin this. `npm test`: 580 tests.

**Measurements** (Living world, seed 7, 10 AI villages, 1 day; before = `e7ef0d0`; shared machine). Full
table in `docs/PERFORMANCE.md`, "Vast worlds: after Phase 2b slice 1".

| | 544×408 | 1536×1152 | 2048×1536 |
|---|---|---|---|
| Worldgen | 510 → 277 ms | 3962 → 1747 ms | 11250 → 2935 ms |
| Create | 0.95 → 0.70 s | 11.4 → 3.8 s | 34.5 → 7.3 s |
| Game memory per tile | 136 → 72 B | 125 → 59 B | 125 → 60 B |
| Save time (size unchanged) | 83 → 61 ms | 1157 → 678 ms | 2203 → 1326 ms |
| Load | 396 → 225 ms | refused → 1834 ms | refused → 3769 ms |
| ms/tick | 0.67 → 0.42 | 1.56 → 0.55 | 2.58 → 0.75 |
| Worst tick | 58.9 → 62.3 ms | 367 → 74 ms | 507 → 104 ms |
| Ticks over 16 ms | 9 → 2 | 35 → 4 | 89 → 9 |
| Region rebuild, each | 0.54 → 0.31 ms | 4.24 → 0.60 ms | 6.34 → 1.24–1.57 ms |

**Against the targets:**
- Memory ≤ 70 B per tile: met at 1536 and 2048, not at 544 (72 B).
- Load under ~5 s: met at 2048 (3.8 s) in Node.
- Worst tick ≤ 50 ms: not met (74 ms at 1536, 104 ms at 2048). The remaining worst ticks at 2048 are mostly
  GC; `heat.js` copies a 12 MB `roomAt` array on wall changes.
- Generation under ~10 s in the browser: not measured in a browser yet (7.3 s total creation in Node at 2048).

**Deviations from the plan:**
- Pass carving: the design said "one multi-source search". It was built as one search per pocket with shared
  buffers. The output is identical.
- Structures, stacks, crops, footprints and zones use sparse blocks of handles, not full `Int32Array`s.
- Not in the plan: the windowed A* and the autosave guard.

### Slice 2: planet generator and Vast/World presets (commit `d85a309`)
**What was built:**
- **Generator `core:planet`** (`planetWorld` and helpers in `src/sim/worldgen.js`), with all settings in
  `mods/core/content/planet.json` and a schema in `src/sim/content/types.js`. The classic and
  `core:continent` generators are untouched.
- **Presets:** `WORLD_SIZES` has `vast` (1536×1152) and `world` (2048×1536), each naming `core:planet`. In
  `Game.create` (`game.js:78-80`) a size preset's own generator wins over the scenario's, so these sizes always
  make planets. Only an explicitly requested generator overrides it. Classic sizes are unchanged. The scenario
  size enum accepts `vast` and `world`.
- **Land:**
  - 22 domain-warped plates; 9 continental, in 4 groups (one continent each);
  - sea channels between groups and a strait along the line between two groups' plates, so continents never
    join;
  - ~60% sea (`oceanShare` 0.6);
  - the outer 2 rows are always sea; the edge falloff uses the unwarped distance to the edge (never further
    out than half of it).
- **Mountains:** ridged ranges along plate edges, broken into segments, varying in width, fading where the
  ground is below sea level.
- **Coasts:** shallow water within 4 tiles of land.
- **Drainage:** a priority flood from the sea. Deep basins become lakes, at most 1.5% of the land. Rivers form
  where drainage ≥ 900 and form continuous trees down to the sea or a lake. They are rare on maps under about
  384 tiles.
- **Climate:** temperature from latitude minus height; moisture from distance to the sea, latitude belts and
  noise.
- **Biomes:** 15 rules. New terrains: tundra, taiga, jungle and savanna ("Dry grassland").
- **Passes:** open pockets under 8 tiles walled in by mountains become mountain. Larger valleys get a pass
  (World, seed 7: 4 passes, 28 tiles).
- **Start:** on the main open area of the largest landmass.
- **Nodes:** per-biome rules, scaled down to `nodeBudget` 0.05 per tile: Vast about 84k, World about 149k
  (the continent generator made 424k at 2048).
- **Deterministic:** only arithmetic and `Math.sqrt` (plus floor, abs, round) are used for the fields.
- **Tests:** `planet-2b.test.js`, `planet-2b-presets.test.js`, `planet-2b-world.test.js`, helper
  `tests/planet-shape.js`. `npm test`: 600 tests.

**Shape across seeds:** at least 4 continents on every seed 1–20 at Vast and World (seed 4: 12 at Vast, 10 at World), and 57–154 islands.

**Measurements** (Node v24.22.0, seed 7, Living world, 10 AI villages; the machine was about 21% busy). Full table in
`docs/PERFORMANCE.md`, "Planet worlds: Phase 2b slice 2".

| | Vast 1536×1152 | World 2048×1536 |
|---|---|---|
| Worldgen | 0.97–1.0 s | 1.64–1.68 s |
| Create | 1.8 s | 3.2 s |
| Load | 0.7 s | 2.4 s |
| Game memory per tile | 44.4 B | 43.4 B |
| Save, raw / gzipped | 1,609 / 316 KB | 2,745 / 535 KB |
| ms/tick | 0.53 | 0.62 |
| Worst tick after warm-up | 22 ms | 38 ms |

- Peak memory during generation: about 51 B per tile at World.
- Tick 0 takes 110–134 ms.

**Against the targets:**
- Generation under ~10 s in the browser: not measured in a browser. The estimate is about 4.8 s to create
  and 3.6 s to load a World.
- Memory ≤ 70 B per tile: met (43–44 B).
- Worst tick ≤ 50 ms after warm-up: met in this 1-day run (22 and 38 ms). Tick 0 is over it.

**Decision:** World (2048×1536) ships as the top preset.

**Deviations from the plan:**
- Rivers end at the sea or at a lake, not always at the sea.
- Deserts use the existing sand terrain; the plan's "grassland" is the new savanna ("Dry grassland").
- Latitude shapes generation only; weather in play is still global (as planned).
- No Web Worker or progress bar was built; creation runs on the main thread.
- Not in the plan: pocket filling (small walled pockets become mountain) and the 2-row sea border.
- Screenshots (1 px per 2 tiles): `docs/screenshots/phase2b-planet-world-seed7.png` and
  `docs/screenshots/phase2b-planet-vast-seed11.png`.
