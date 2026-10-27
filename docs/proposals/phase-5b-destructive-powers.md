# Phase 5b: god powers, part 2 (destructive and nature powers)

Status: **in progress** ("go" from the user on 2026-10-27; the open questions' proposals are the working defaults). Slices 1 and 2 (fire) done; see "Results". Branch `cloud-work` (cloud rescue copy; see CLAUDE.md).

## Goal (from the roadmap and the user)
- **2026-10-24 direction:** lightning, fire (spreads through forest and wooden buildings), meteor, plague,
  earthquake, tornado, rain (puts out fire, grows plants) and drought; each with a preview and a confirm.
- **Phase 5b in the roadmap:** lightning, fire, plague, meteor and smite, each with a warning and a confirm step
  before anything destructive; built on Phase 5's death, illness and wounds; the same command, ledger and replay
  rules as Phase 2c (validated deterministic commands stored with their tick, replayed identically after load;
  every power shows what it will do before the player confirms; destructive ones warn first).
- WorldBox's breadth and chaos, never a copy: original names, effects and numbers.
- Rules for every phase: determinism across save/load, conservation (items and people), sim and UI apart (UI
  notes in `docs/ui-todo.md`), old saves load, content as data, 30+ villages, visible reasons.

## What exists today (explorer map, 2026-10-27)
- **God framework** (`god.js`): `registerPower(type, { validate, cost, preview, apply, daily })`; preview is
  read-only and returns `{ ok, reason, preview: { type, cost, favour, sandbox, ... } }`; commands queue for the next
  tick, are validated again when applied (refusals logged) and recorded in `s.god.log`; draws are hashes of the
  seed and the command id; created items go through `divineItems` (`created:divine`). Favour: start 30, max 100,
  +5 a day (`core:god`); Sandbox makes powers free. **There is no "warn first" or "confirm" notion in the sim.**
- **Destroying a finished building: no code does it.** `removeStructure` keeps indexes and caches right (power,
  water, light, rooms, ownership, markets, territory), but:
  - homes never notice: `home.complete` is set once and only it is read (shelter, housing);
  - nothing rebuilds a lost wall, door or bed (only decor slots and station counts are refilled by the planner);
  - station jobs must end **before** the station goes, or their buffered items leave the census;
  - beds keep their owners' `c.bedId`/`c.homeId`; plans hold structures by reference (a removed one must be
    replanned at once, as deaths are).
  - A building holds items in `delivered`, `reno.delivered`, `buffer`, `fuel` (hearth and generator fuel, medicine
    cabinets).
- **Nodes:** trees (`core:tree` tag), rocks, bushes, brush; `removeNode`/`addNode` keep indexes right; forests
  never regrow (nothing ever adds nodes in play).
- **Terrain never changes in play.** `setTerrain` exists but is unused; each `s.map.rev` bump rebuilds drink spots,
  the water walk, territory frontiers and contact land on big worlds (expensive: one bump per command at most).
  No ash, scorched or crater terrain.
- **No weather at all:** temperature is a pure function of the tick; crops grow by season and fertility
  (`farming.js`, every 10 ticks); frost kills.
- **People:** `injure` (wounds, collapse), death after 6 h at 0% or at once via `g._dying` (death.js), burial;
  `infect` (illness.js) with daily spread only in scenarios with an `illness` block; the `flee` job walks to a
  point.

## Design decisions
1. **Confirm is in the sim, not only in the UI.** Destructive powers (`preview.destructive: true`) are refused
   unless the command carries `confirm: true`. So a script or a replayed save cannot cast one by accident, and the
   saved command shows it was confirmed. The preview lists **warnings** first: people at risk (how many, whose
   village, the player's own named first), buildings and fields at risk, and "this cannot be undone". Nature powers
   that only help (rain) are not destructive.
2. **One safe destruction API** (`src/sim/ruin.js`, slice 1), used by every power:
   - `destroyStructure(g, id, cause)`: ends the jobs that use it (station, bed, desk, site, cabinet, maintenance,
     refuel) first, then deals with the items it holds: burned (fire) or crushed (meteor, quake, tornado) items are
     consumed with the reason `fire` or `divine`; the rest is dropped on the ground; frees bed owners and medical
     beds; removes it; marks its home **damaged**; replans the owner at once.
   - `destroyNode`, `burnStack`, `destroyCrop` the same way, with reasons.
   - **Repair:** a home or project that lost a required part gets the part back as an unbuilt part of the same
     project (same building, same tile), so the existing construction rebuilds it; until then the home is not
     complete (no shelter, its beds missing). Optional parts (decor) are refilled by the planner as today.
     Stations are re-planned by count as today.
3. **Disasters are world state, not village state** (`s.disasters`, slice 1): fires, storms, rain and drought live
   on tiles and areas, are updated on fixed ticks (fire every 25 ticks, storms every 10, weather hourly), use hash
   draws (seed, disaster id, tick, tile), and act the same on full and distant villages (they read tiles and
   records, not jobs). Their cost is bounded: at most `fire.maxTiles` burning tiles world-wide (data); a storm
   touches its own small area.
4. **Terrain changes are batched**: a command changes all its tiles at once and bumps `s.map.rev` once; a fire
   changes terrain only when a tile burns out, and the burned-out tiles of one fire update are batched.
5. **Ledger:** what a power destroys directly is `consumed:divine`; what a fire burns is `consumed:fire` (it can
   spread far from the power that lit it); what a power makes (meteor iron, wood from torn-up trees) is
   `created:divine`. People killed die through `death.js` with new causes ("struck by lightning", "burned to
   death", "crushed", "smitten by the gods").
6. **Opt-in by use:** nothing changes in a game where no power is used (`s.god` and `s.disasters` are made
   lazily). Classic pinned runs stay identical.
7. **Numbers are data:** costs, radii, chances and durations in `godRules` (`mods/core/content/god.json`, schema in
   `content/types.js`); new terrains (ash, crater) and the fire behaviour of terrains, nodes, buildings and items
   as data fields (`flammable`).

## Slices

### Slice 1: foundations (save format 23)
- `src/sim/ruin.js`: `destroyStructure`, `destroyNode`, `burnStack`, `destroyCrop` (decision 2), home damage and
  repair, replanning.
- `s.disasters` (lazy) with a tick hook in `Game.tick` after the god commands; validation.
- The confirm and warning contract in `god.js` (decision 1): `preview.destructive`, `preview.warnings`, refusal
  without `confirm: true`.
- New terrains `core:ash` (passable, buildable, fertility 1.1: burned land grows well) and `core:crater` (passable,
  not buildable, fertility 0); data field `flammable` on terrains, nodes, buildings, items (0–1).
- Tests: destroying every kind of building keeps items and reservations exact and save/load identical; a damaged
  home is rebuilt by its village; a confirmed command is required; classic runs unchanged.

### Slice 2: lightning and smite
- **Lightning** (tile): strikes one tile: the person there is killed ("struck by lightning") or, beside it,
  wounded; a flammable thing there catches fire (slice 3). Cheap (cost 15).
- **Smite** (a person): that person dies at once ("smitten by the gods"). Warns with the name and village (cost 20).

### Slice 3: fire
- Per-tile burning (`s.disasters.fires`: tile → { since, heat }); every 25 ticks each burning tile may light
  its neighbours by their `flammable` (trees, brush, wooden buildings, fields, wooden goods; stone and water stop
  it), faster in drought, never in rain; a tile burns for a while and then burns out: trees and crops are gone,
  wooden buildings destroyed, goods burned; forest floor and grass become ash.
- People on or next to burning tiles get burns (injury kind `burn`) and flee (the existing `flee` job, aimed away
  from the fire); burns can kill ("burned to death").
- The **fire** power lights a tile and its neighbours (cost 25). Fires also start from lightning and meteors.
- Limits: `fire.maxTiles` burning at once world-wide; a fire burns out on its own.
- Not in this slice: colonists fighting fires with water (see Open questions).

### Slice 4: meteor and earthquake
- **Meteor** (tile, radius 2–4 by data): everything in the crater is destroyed (people there die: "crushed by a
  falling star"), around it people are wounded and fires start; the crater tiles become `core:crater`; a few
  stacks of meteoric iron are left (`created:divine`). Cost 60.
- **Earthquake** (tile, radius ~12): each building in the area may collapse (stone ones less often, by data),
  people inside or beside collapsing ones are wounded, rocks may split (nodes lose chunks); no terrain change.
  Cost 70.

### Slice 5: tornado
- A storm that moves for a few hours (`s.disasters.storms`): from the clicked tile in a direction, with a hashed
  wander; each step tears up trees in its path (their wood is scattered as stacks: `created:divine` for the wood a
  felled tree gives), damages or destroys light buildings, throws loose goods (moves stacks: conserved), wounds
  people in its path. Cost 50.

### Slice 6: plague, rain and drought
- **Plague** (a village or tile): infects a share of a village with a strong illness (`core:plague`, data); in
  scenarios without illness rules the plague still spreads from home to home while it lasts (a plague-only spread
  rule). Cost 50.
- **Rain** (area, days): puts out fires, crops and wild plants grow faster (×1.5), no new fires. Not destructive.
  Cost 20.
- **Drought** (area, days): crops do not grow and slowly wither, wild plants stop regrowing, fires spread twice
  as fast. Cost 35. (Water sources stay: drying shores would rebuild the costly water maps.)
- Weather areas live in `s.disasters.weather`; crop and plant growth read them per tile (an area lookup).

### Slice 7: acceptance
- Every power used in a Vast run (scripted commands at fixed days), save/load at each step identical, items and
  people conserved, the worst tick under 50 ms with a large fire burning; classic, Living and 40-day runs
  unchanged when no power is used; a world report of a run with powers.

## Per-tick cost
- Nothing until a power is used. Fires: O(burning tiles) every 25 ticks, capped by `fire.maxTiles`. Storms:
  O(their area) every 10 ticks. Weather: an area lookup per crop or regrowing plant update (O(active weather
  areas), usually 0–2). Destruction: O(the building's items and jobs) once.

## Distant villages
Fire, storms and weather act on tiles and records, so they hit distant villages the same way; their people stand
round the centre (lod.js), so a fire there wounds those standing in it. Destroyed buildings are repaired by the
same projects (distant construction works on projects). Plague spreads on the real colonists.

## Targets
- Each power: preview lists the right warnings; refused without confirm; applied deterministically; replayed
  identically after load; items and people conserved.
- A forest fire on the Vast world burns out on its own within a few days, never more than `fire.maxTiles` tiles at
  once, with no tick over 50 ms.
- A village hit by a meteor or an earthquake rebuilds its homes within days.

### Slice 6, extended (2026-10-27, the owner's go: "fight fires, regrow plants/trees")
Built as four parts, each tested and pushed:
- **6a rain and drought** as above. Weather areas `s.disasters.weather` (id -> { kind, x, y, r, until }), at most
  4 at once; rain (radius 10, 2 days) puts out fires in it and no fire starts or spreads there, crops and wild
  plants grow ×1.5; drought (radius 12, 4 days) stops crop growth and withers unripe crops (a crop withered to
  nothing is lost), wild plants do not regrow, fires spread ×2. Rain is not destructive; drought is (confirm).
- **6b plague** as above (data `core:plague` illness; a village or a person).
- **6c firefighting** (open question 1, answered yes): a fire within a village's reach that threatens its
  buildings or fields (a burnable built part, field or stockpile within 3 tiles) is fought: able adults who are
  not resting go next to the burning tile and beat it out (work, then the tile is put out and scorched); a
  well, pump or water stretch within 15 tiles makes it twice as fast (they carry water). They take the usual
  burns beside a fire. Others still flee. Distant villages put out a fire tile next to their buildings with a
  chance per fire step (no walking).
- **6d regrowth** (open question 4, answered yes):
  - *Scars heal in every game:* a tree or plant destroyed by a power or a fire leaves a seed in
    `s.disasters.seeds` (tile -> { def, at }); after the scorch time (fire) or `seedDays` it sprouts as a young
    node (`empty`, grows with the usual regrowth, `regrowDays` from data: pine 20) if the tile is still free.
  - *Forests spread in the long-game worlds:* scenario rule `nature.spread` (Vast, Living and World): each day
    a share of trees and bushes may drop a seed on a free tile within 2 with fewer than `maxNear` of their kind
    round it, outside every village's buildings and fields. Classic games have no spread (state hashes stay).

## Open questions for the user
_Answered 2026-10-27: 1 (fight fires: yes), 4 (regrowth: yes). 2 and 3 stand as proposed._
1. **Fighting fires:** should colonists carry water to put fires out (a new job, more work), or only flee while
   rain and burning out end fires? Proposal: flee only in 5b; firefighting later.
2. **Costs:** proposal (favour, max 100): lightning 15, smite 20, fire 25, rain 20, drought 35, tornado 50, plague
   50, meteor 60, earthquake 70. Sandbox: free.
3. **Your own village:** powers may hit it, with the warning naming it first. Proposal: yes.
4. **Forests regrowing:** today forests never regrow, so a forest fire leaves ash for good. Proposal: ash grows
   saplings back slowly (a small regrowth rule for burned land only), so burned forests return over seasons.

## UI notes (added to docs/ui-todo.md per slice when built)
God tab buttons and the targeting for each power (tile, area with radius, a person, a village, a direction for the
tornado); the preview card with warnings first and a Confirm button that sends `confirm: true`; burning tiles,
smoke, ash and craters on the map and in the world view; storms and weather areas drawn; letters for each disaster
and its damage; sounds (thunder, fire crackle, impact, rumble, wind, rain).

## Results

### Slice 1: foundations, lightning and smite (slices 1 and 2 of the plan, together)
- **Built:** `src/sim/ruin.js` (`destroyStructure`: jobs using it end first, its goods burned/crushed through the
  ledger or dropped, beds and medical beds freed, a project part re-added unbuilt so the village rebuilds it, the
  home not complete until then, decor slots left to the planner, the owner replanned at once; `destroyNode`,
  `destroyStack`, `destroyCrop`, `replan`); the confirm-and-warn contract in `god.js` (`destructive` on a power:
  refused before and at apply time without `confirm: true`, `preview.warnings` ending with "This cannot be
  undone.", `needsConfirm` on the refusal); `src/sim/godwrath.js` with **lightning** (the person on the tile dies,
  those beside it get burns 20–45, a flammable building, tree, crop or goods on the tile burn) and **smite**;
  `flammable` on items (wood, planks, charcoal 1), nodes (pine, brush 1, berry bush 0.7) and buildings (default:
  the share of flammable materials in the cost); burns are dressed like wounds; death causes "was struck by
  lightning", "was smitten by the gods", "burned to death"; costs in `core:god` (lightning 15, smite 20, the
  rest set for later slices).
- **Deviation:** the plan's slices 1 and 2 were built as one, so the foundations were tested by real powers; no new
  saved state was needed (commands only), so no save format bump yet; new terrains (ash, crater) wait for the fire
  and meteor slices.
- **Not changed:** classic runs (same state hashes); 109 tests pass (7 in `tests/cloud-wrath.test.js`: confirm and
  warnings, lightning, smite, a destroyed wall rebuilt by its village, every building of a village destroyed with
  exact counts and save/load identity, replay).

### Slice 2: fire (the plan's slice 3)
- **Built:** `src/sim/fire.js`: `s.disasters { fires, scorched }` (save format 23, validated), `tickFire` every 25
  ticks (spread to the 8 neighbours with chance 0.3 × their flammability, burns for people on or beside a burning
  tile once a step, burn-out after 300 ticks, 100 for bare ground, at most 600 tiles burning world-wide, scorched
  tiles safe for 30 days), `ignite`, `tileFlammable` (the most flammable thing on the tile: building, plant, crop,
  goods, ground), `fireDanger` (people within 2 tiles of a fire run 8 tiles away; ai.js, beside the combat
  decision). The **fire** power (tile; refused where nothing can burn; warnings: people within 6 tiles, flammable
  buildings close by by village, "may spread"); **lightning** now starts a fire where it strikes instead of
  burning things at once. Terrains carry `flammable` (grass 0.06, savanna 0.12, forest floor and taiga 0.1, ...).
  Fire burns only flammable goods (`ruin.js`): stone and iron in a burned building are left on the ground.
- **Deviation: no ash terrain.** A terrain change on big worlds rebuilds the whole-map water and territory data
  (about 70 ms on World each time), so burned tiles are marked scorched in `s.disasters` instead (they do not
  burn again for 30 days; the UI draws them as ash). Craters (meteor) will change terrain, once per strike.
- **Tuning:** with grass at 0.25 a fire started near the player's village on the Vast world never stopped
  (13,755 tiles scorched in 3 days, still spreading). With the values above the same fire burned 206 tiles and
  went out after about 15 hours; dense woods still burn through. Worst tick during the fire 17 ms.
- **Not changed:** classic runs; 113 tests pass (4 more in `tests/cloud-wrath.test.js`).

### Slice 3: meteor and earthquake (the plan's slice 4)
- **Built:** the **meteor** power (tile, cost 60; `godRules.wrath.meteor`: radius 2, ring 3, wounds 15–50, fire
  chance 0.35 in the ring, 4–10 meteoric iron): in the crater people die ("was crushed by a falling star"), goods,
  trees, rocks and crops are destroyed (`consumed:divine`), and every building with a part in it is lost as a whole
  (`ruin.js destroyProject`: the project is cancelled, its footprint freed, a home removed and its people homeless
  until a new home has a free bed; goods in the parts outside the crater fall to the ground); in the ring people are
  wounded and burnable tiles may catch fire. The iron (`created:divine`) belongs to whoever holds the land. The
  **earthquake** power (tile, cost 70; `wrath.quake`: radius 12): each built part may collapse with chance
  0.6 × (1 − distance / 13) × (0.35 + 0.65 × how wooden it is); its goods fall to the ground and its village
  rebuilds it (slice 1's repair); people on or beside a collapsing part are wounded (10–35). Graves do not fall;
  a grave a meteor destroys is gone (the record of the dead keeps the burial, not the grave id).
- **New terrain `core:crater`** (passable, not buildable, fertility 0). A terrain change normally bumps the map
  revision, which rebuilt the whole-map water walk, land chunks and territory: a meteor took 485 ms on the Vast
  world. Crater tiles now replace only ground that walks and is claimed exactly like a crater (move cost 1, claim
  cost 1, not water: grass, soil, gravel, savanna, ...) without that rebuild (`Game.setTerrainKeepRev`; the caches
  would come out the same, and a test checks the water walk): 37 ms (worst tick of the strike) on Vast.
- **Deviations:** forest floor, sand, hills, snow, tundra and jungle in a crater are cleared but keep their
  terrain (they walk or are claimed differently), so they can be built on again. Rocks do not split in an
  earthquake (not built: nodes keep their chunks). A field under a crater keeps its zone; its crater tiles are
  never sown (fertility 0).
- **Not changed:** classic runs (same state hashes); 119 tests pass (5 more in `tests/cloud-wrath.test.js`).

### Slice 4: tornado (the plan's slice 5)
- **Built:** `src/sim/storm.js`: storms in `s.disasters.storms` (save format 24, validated; old saves load). The
  **tornado** power (tile and optional direction 0–7, cost 50; `godRules.wrath.tornado`: one tile every 10 ticks
  for 4 hours, 3 tiles wide, turns left or right with chance 0.4 a step, at most 3 at once). On its tiles each step:
  trees and plants are torn up and what a felled one gives is created (`created:divine`, owned by whoever holds
  the land; on land nobody holds, by the player's village, as other goods made without an owner) and thrown 2–5 tiles downwind; crops are destroyed; goods on the ground are thrown downwind (moved:
  `ruin.js moveStack`, jobs on them end first); built parts at least half wooden fall with chance 0.5 (goods to
  the ground, rebuilt by their village; stone and graves stand); people are hurt once per storm (wound 10–40).
- **The path has no randomness the preview cannot see:** directions are 8 steps of 45 degrees and turns are hash
  draws of (seed, command id, step), with no trigonometry (floating sines could differ between machines), so
  the preview gives the exact path the storm takes (a test checks it step by step).
- **Cost:** one sort of the colonists per storm step (review fix: it was one per tree and stack); worst tick
  13.3 ms on the Vast world with two tornadoes through villages at once. A save's storm must have next <= until
  (a crafted one could otherwise never end).
- **Deviation:** buildings are torn down or left standing (no partial damage: buildings have no health yet).
- **Not changed:** classic runs; 121 tests pass (2 more in `tests/cloud-wrath.test.js`).

### Slice 5a: rain and drought (the plan's slice 6a)
- **Built:** `src/sim/weather.js`: weather areas in `s.disasters.weather` (save format 25, validated; old saves
  load), at most 4 at once, the newest counting where they overlap. **Rain** (cost 20, not destructive; radius 10,
  2 days): burning tiles in it go out at the next fire step (left scorched; what stands there survives), nothing
  catches there (`ignite`) and fire does not spread into it; crops and wild plants grow 1.5 times as fast.
  **Drought** (cost 35, destructive; radius 12, 4 days): crops do not grow and unripe ones lose a quarter of a
  full crop a day (withered to nothing: lost), wild plants do not regrow, fires spread twice as fast.
  Data: `godRules.wrath.weather`. Water sources stay (drying shores would rebuild the whole-map water data).
- **Review fixes:** a drought made villages sow again and again into it (each crop withered in ten ticks; 5
  times the seed use in 3 days): sowing now waits on drought tiles (`weatherat.js droughtAt`, in the sowing job,
  the job giver and distant villages). The fire power is refused in rain (it did nothing but cost favour). The
  lookups live in `src/sim/weatherat.js`, a module with no imports (the AI imports it; importing weather.js there
  made an import cycle).
- **Not changed:** classic runs; 124 tests pass (3 more in `tests/cloud-wrath.test.js`).

### Slice 5b: plague (the plague power)
- **Built:** illness `core:plague` (data, `plague: true`: contagion 0.35, travel 0.5, grows 1 an hour for 5
  days, immunity 200 days). The **plague** power (a village, cost 50, destructive; `godRules.wrath.plague.share`
  0.3): that share of its people (at least one; picked by draw among those who can catch it) fall ill. It then
  spreads by the illness rules (illness.js), and also in scenarios without them (classic worlds): while
  `s.disasters.plague.until` (the end of the last case's course; save format 25) lies ahead, spread runs with
  village share 0.3 and no outbreaks; contacts between villages carry it too.
- **Tuning:** at 1.3 an hour every case was deadly (a whole village dead in 9 days, cared for or not); at 0.85
  nobody died in a classic village. At 1.0 most villages of 5 lost 1–2 people, some all of them.
- **Review fixes:** the power is refused unless its illness is marked `plague` (else nothing would spread in a
  classic world); a saved plague may last at most 1000 days; no outbreak work while only a plague runs. Format 25
  covers weather and plague (both new in this phase, never released apart).
- **Not changed:** classic runs; 127 tests pass (2 plague tests and 1 drought-sowing test more).

### Slice 5c: firefighting (open question 1, answered yes)
- **Built:** `fire.js` (rules) and `firefight.js` (the job, its own module: registering it from fire.js made an
  import cycle with ai.js). A burning tile within 3 tiles of a village's burnable built part, field or stockpile
  threatens it (worked out at most once a tick, from the state then, so a loaded game decides the same). Each
  awake adult of a full-detail village with health above half, within 30 tiles, goes next to the nearest
  threatening tile and puts it out after 50 work (twice as fast with a well, pump or water within 15 tiles); they
  no longer flee (others still do) and take the usual burns. A distant village puts out each threatening tile
  with chance 0.35 a fire step. Data: `godRules.wrath.fire` threat, fightReach, fightWork, fightWater, distantPut.
- **Tuning** (a fire set on a home, 3 seeds; built parts left of 61, after the fire): no firefighting 26, 4, 2;
  work 60: 39, 42, –; work 30 or 40: 55–61 (nothing much lost); work 50: 45, 48, 55. A fire should still hurt.
- **Cost:** worst tick 7 ms on the Vast world with fires in two villages and a wood (83 tiles burning at the
  peak; one earlier run showed a single 57 ms tick, not reproduced: a pause outside the sim).
- **Test kept, not weakened:** the slice-2 test of a wall burning down now runs with firefighting off in its data
  (the burn-out path), and a new test shows far more standing with firefighting than without.
- **Not changed:** classic runs; 130 tests pass (3 more).

