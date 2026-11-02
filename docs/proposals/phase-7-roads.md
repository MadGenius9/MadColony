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
