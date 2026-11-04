# Phase 7: roads and transport

Status: **design** (2026-11-02; the owner: "You decide and keep going"). Branch `cloud-work`. The roadmap's Phase
7: "Roads from real travel demand within and between villages; walking, then horses and wagons, then vehicles via
research; cargo tracked from loading to delivery; roads visible zoomed out. Larger buildings only as needed for
warehouses and factories." Also open there: storage reorganisation with warehouses; the coarse-route corridor and
a path cache, to be measured again once roads change how people travel.

## What exists
- **Terrain move costs:** each terrain has a `moveCost` (grass 1, hills 1.5, marsh 1.8, shallows 2.2). All path
  searches read the cost by the tile's terrain, and their caches already follow terrain changes (world shaping
  changes terrain during play: `g.setTerrain`).
- **No roads, no vehicles.** Goods move by people carrying them (jobs) and, for distant villages, by caravans
  (`lod.js`, abstract trips).

## Design (decisions)
### Roads are a terrain, built by work
- A road is a terrain (`core:dirt_road`, `moveCost` 0.6, passable, not buildable, not fertile) laid on a tile by a
  construction job.
- The tile's old terrain is kept (`s.roads[i] = old terrain id`), so a road can be lifted and the ground comes
  back (world shaping and ruins).
- No change to the path code: a road is cheaper ground, and every search already prefers cheaper ground.
- Cost: work and stone (data: the road's build cost), so a road competes with other building, as it should.
- Never through buildings, fields or stockpiles (only open ground the village may build on: `tileUsable`).
  Between villages only on land each owns, or with a trade pact (diplomacy).

### Demand, from real travel
- **Foot traffic:** each village counts the steps its people take, by tile, in a coarse grid of 4×4 cells
  (sampled every 10 ticks, decaying by half every 10 days). Derived and saved: `settlement.traffic`, capped
  at 400 cells a village.
- **Planning a road:** at its plan, a village may lay one road segment at a time along the busiest route.
  - The route is the cheapest path between its centre and the busiest cell, run with the existing path search.
  - Only when that cell's traffic is above a threshold, and the route saves at least 20% of walking on it.
  - The reason is shown: "A road to the fields: 40 trips a day".
- **Between villages:** a road toward a trading partner with a pact when its traders or caravans travel there
  often.

### Transport (later slices)
- **Horses and wagons:** a researched technology. A wagon is an item, made, not spawned. A hauler with a wagon
  carries several loads per trip, and is faster on roads. Horses come from the wild herds (tamed: a later
  phase) or are left out at first, with the wagon pulled by hand.
- **Vehicles:** later research, made in factories (Phase 3, slice 5).
- **Cargo:** tracked from loading to delivery through the ledger, like carried goods (no duplication), and saved.

## Not in it (this phase)
Multi-floor buildings, railways, bridges over deep water, taming horses (Phase 9 livestock), and the coarse-route
corridor (to be measured again after roads).

## Slices
1. Road terrain; laying and lifting (`s.roads`, format 39); the road job; tests (paths prefer roads; save and
   load; world shaping and ruins keep the old ground).
2. Foot traffic (`settlement.traffic`) and the planner's first roads within a village, with reasons.
3. Roads between villages with pacts; distant villages' caravans faster on roads.
4. Wagons (research, an item, hauling several loads); cargo through the ledger.
5. Acceptance: a World run (roads where people walk, travel times before and after, no flood of roads),
   classic runs, bench (path costs), docs and UI notes (roads drawn, visible zoomed out).

## Open points the UI must settle at home
How roads are drawn (a terrain style `road`), and whether the player can order a road by hand (a civic
intent like taps, or a god-power-like tool).

## Results
### Slice 1: roads as a terrain laid by work (built and tested, 2026-11-02)
- **Built:**
  - `mods/core/content/roads.json`: the terrain `core:dirt_road` (move cost 0.6), the building `core:road` (1
    stone, 20 work, walkable) and the template `core:road_run`;
  - `src/sim/roads.js`: `layRoad` on completion, `liftRoad` on removal, `roadsOf`;
  - `building.road` in the schema; `structure.under` saved (format 39).
- **Changed from the design:** the old ground is kept on the road building (`st.under`), not in `s.roads`. A road
  is a building like a water pipe, so it fits projects and ownership as they are.
- **A bug found:** the path search's octile estimate assumed every step costs at least 1, so with ground cheaper
  than 1 it could miss the cheaper road route. The test showed a path ignoring a whole road.
  - The estimate is now scaled by the cheapest walkable terrain on the map.
  - The palette holds only terrains present, so the scale stays 1 until a road is laid and every current game is
    unchanged: classic hashes as before (`forty` 9151d4cab0134351, `modern` 17120b8380963d4a), and the World
    seed 11 run identical.
  - Searches in worlds with roads explore a little more; slice 5 measures it.
- **Tests:** `tests/cloud-roads.test.js`:
  - a road turns its tile into road and the old ground comes back;
  - on even ground a path ignores the row before the road and follows it after;
  - save and load; old and bad saves; the ledger stays whole.

### Slice 2: foot traffic and roads within a village (built and tested, 2026-11-02)
- **Built:**
  - `roads.js`: `countTraffic` (every 10 ticks: full-detail villages' walking people by 4×4 cell, in
    `settlement.traffic`, at most 400 cells), `fadeTraffic` (daily, 10%) and `planRoads` (from the planner, after
    plumbing);
  - a village of 8 or more people lays up to 8 road tiles along the path from its centre toward its busiest
    cell at least 8 tiles away, once that cell reaches 40;
  - one stretch at a time, at most 120 road tiles, with a log line and a `core:road` event giving the count.
- **Two problems found and fixed:**
  - **Paths differed after save and load once roads had been removed.** The path estimate's cheapest ground came
    from the terrain palette, which keeps a terrain after its last tile is gone, while a loaded game's palette
    holds only what is there. The terrain store now counts tiles per terrain (derived), and the estimate uses only
    the terrains present. A replay test (`tests/cloud-wrath.test.js`) caught it.
  - **Roads slowed the classic 5-person colony:** the modern era came on day 52.03 instead of 44.41, as the roads
    took stone and work. Hence the minimum of 8 people. With it the classic eras are back exactly (workshops
    day 7.39, modern day 44.41).
- **A test that became sensitive:** the firefighting test (fire at the first home, seed 4242) failed once roads
  were laid in that colony: the fire was not out within a day. At the second home it went out at the same time
  with and without roads, and road tiles do not burn. So it is not a clear effect of roads; it is now moot for
  that colony (under 8 people), and noted here, not hidden.
- **Checks:**
  - full suite passes;
  - classic hashes (they include the traffic counts), proposed: `forty` 95e985761d5b0e93, `modern`
    a6fd2f92a207fffc;
  - World seed 11, 200 days: 270 people; save and load identical.
- **Roads in that World run:** 3 tiles by day 25 and 6 by day 200, in 2 villages. AI villages are capped at 6
  people, under the minimum, so in today's worlds roads are rare. Roads between villages (slice 3) and bigger
  villages (the scale target's growth decision) are what would make them common. The 3 early tiles were enough
  to set this sensitive world on another course (66 wars declared against 29 before, 3.3 ms a tick on day 200).

### Slice 3: trade roads, and roads changed to change no terrain (built and tested, 2026-11-02)
- **Trade roads** (`roads.js planTradeRoad`):
  - a village with a trade pact and at least 3 completed trades with a partner within 160 tiles lays its own
    part of a road toward it, up to 8 tiles a stretch, on its own land, from its centre;
  - toward one partner only, the one it trades with most; no minimum of people;
  - looked at on one day in three, by village, from the tick (no saved state);
  - `completedTradesBetween` is now exported from villages.js.
- **The first World run with trade roads went badly, and showed two design faults:**
  - **A slowdown from 2.7 to 16 ms a tick by day 175** (the run timed out).
    - First cause: the path estimate scaled to road ground (0.6) made every search explore more. Undone:
      `path.js` and `tiles.js` are back to the rescue copy.
    - That was not all. A profile of the world on day 150 (1,194 roads) found **41% of the time in the
      whole-map water-distance field** (`terrainDistanceField`, `drinkSpots`, `waterWalk`): every road laid changed
      the terrain, so the field was worked out again.
  - **Too many roads:** toward every pact partner, 2,182 tiles by day 175.
- **The design now:**
  - a road changes no terrain; it is a walkable building whose `road.step` (0.6) is the time a step onto it takes
    (`game.js stepCost`, read by the walking step);
  - terrain, path searches, walkable areas and the water maps never see roads, and paths are exactly as without
    them;
  - roads are laid where people already walk, so they are used;
  - the road terrain, `structure.under` and the construction and removal hooks are gone; format 39 now holds only
    `settlement.traffic`.
- **Checks:**
  - full suite passes; classic hashes unchanged from slice 2 (`forty` 95e985761d5b0e93, `modern`
    a6fd2f92a207fffc, proposed);
  - World seed 11, 200 days: 2,106 road tiles in 56 villages (most of them trade roads), 249 people, **3.0 ms a
    tick on day 200** (the usual for this world), save and load identical.
- **Not done:** distant villages' caravans faster on roads (they travel abstractly); wagons (slice 4).
  **Caravans on roads done 2026-11-04:** `roads.js roadShare`, `caravanRoadTicks`. A caravan's time, fixed when it
  sets out, is cut by the share of its straight way that runs within 2 tiles of a built road (sampled every 2
  tiles), as a road step: all along a road, 0.6 of the time. Test in `cloud-roads.test.js`. Classic hashes
  unchanged (no caravans there); full suite 335 passed.
  - World seed 11, to day 160: 429 of 581 caravans ran partly along roads, saving about 3% of all caravan time.
    The road share was measured the day each caravan was seen, so this is an estimate. Each village lays only its
    own stretch (up to 120 tiles in all), so roads cover little of a long route.

### Slice 4: handcarts (built and tested, 2026-11-02)
- **Built:**
  - content (`roads.json`):
    - the tech Wheelwrighting (industry, after Ironworking, 2600 research);
    - the item `core:handcart` (equipment slot `cart`: carry 3, offRoad 1.25, durability 400);
    - the recipe "Make handcart" (workbench: 16 wood, 3 iron).
  - a third equipment slot, `equip.cart` (format 40; absent means none, so new colonists and old saves are
    unchanged). It is counted in the census and in inventoryOf, dropped at death, and set aside on load if its
    mod is gone.
  - a hauler with a cart:
    - carries `carry` × the usual load (`carryLimit(item, c)`, still at most a stack);
    - on a stockpile haul, also takes up to 3 more piles of the same item within 6 tiles (`moreLoads`, each one
      reserved; haul job `more`, `loads`). Loose piles are small (at most 12 in the classic colony on day 1), so a
      higher limit alone did nothing; this was found by the test.
  - each trip wears the cart by one; worn out, it leaves the ledger as worn.
  - loaded, a step off a road takes 1.25 times as long, and a road step is the same as without a cart (`stepCost`),
    so carts pay where there are roads.
  - the planner (`cartWants`): a full-detail village of at least 8 adults wants one cart for every 6 adults. The
    carts go first to people who already have one, then by id, and never to anyone with hauling switched off. The
    reason shown is "A handcart for P to haul with".
- **Cargo:** a load stays in the colonist's `carry`, as before (the census counts it once), so there is no new
  cargo store to keep in step.
- **Checks:**
  - 5 tests in `tests/cloud-carts.test.js`;
  - `forty` unchanged (95e985761d5b0e93);
  - `modern`: the same techs on the same ticks and the modern era on day 44.41. The hash changes to
    e60c658d08cab7f1 (proposed) because researchers twice pick Wheelwrighting, for 15 to 30 ticks each time,
    before a goal switches them away.
- **Not done:** horses (taming is Phase 9); faster caravans for distant villages.

### Slice 5: acceptance (2026-11-02)
- **World seed 11, 200 days** (`tools/cloud-world-run.mjs 200 world 11 25 100`, which now also counts carts):
  - 241 people in 67 villages; 1,978 road tiles built in 49 villages (23 planned), most of them trade roads;
  - 2.6 ms a tick on day 200 (2.1 on day 175), worst tick 565 ms;
  - the save on day 100 loaded identically and ran a day identically; no conservation errors.
  - **0 handcarts:** AI villages are capped at 6 people, so none reaches the 8 adults that want carts. Carts are
    built and tested, but are not seen in today's worlds until villages grow (the growth decision in
    `scale-target.md`).
- **Bench** (`tools/bench.js`, defaults, two runs each, against 774aa2b, the code before Phase 7):
  - ms/tick +5% to +8% for most sizes; large with 5 villages −3%;
  - small with 3 villages +13% in the first pair; 4 more pairs gave +9% on average (0.366 to 0.400 ms).
  - The bench worlds lay a road or two (built 168 against 167). The rest is the foot-traffic count every 10 ticks
    and the road lookup in each step.
  - This is under the 10% bar, and is recorded here.
- **Travel times:** a step onto a road takes 0.6 of a plain step. Roads are laid along the paths people take, so
  those paths are 40% quicker where they are paved. No before-and-after timing of whole trips was measured.
- **Path cache and corridor:** roads change no path, so the corridor question is the same as in Phase 1 and stays
  parked.
