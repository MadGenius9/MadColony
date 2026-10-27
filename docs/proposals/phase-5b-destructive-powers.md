# Phase 5b: god powers, part 2 (destructive and nature powers)

Status: **design, waiting for the user's "go"**. Branch `cloud-work` (cloud rescue copy; see CLAUDE.md). Nothing in
this note is built yet.

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

## Open questions for the user
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
(None yet.)
