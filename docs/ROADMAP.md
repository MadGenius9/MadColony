# Roadmap

What is built is described in the [README](../README.md); this page is the plan. Nothing here is in the game
unless it is marked **Done** or "already built".

## Direction
The game is changing scale: a WorldBox-style wide, zoomed-out living world (a large procedural map with many
autonomous villages and kingdoms rising, trading, fighting, expanding and falling) combined with RimWorld-style
close-up life (zoom in and every settler is a real person with needs, jobs, health, family and a readable
reason for everything they do). Zoomed out the world reads like a pixel map with territory colours, roads,
armies and events; zoomed in it is today's detailed view.

**Direction update (user, 2026-10-23): WorldBox and The Universim.** The game should feel like WorldBox and
The Universim. A very large world starts almost empty: a few small settlements begin far apart, grow and
spread until civilizations meet, trade, ally and fight. The camera zooms smoothly from one settler out to the
whole planet on screen. Territory follows the land and grows outward from settlements. This is Phase 2b
("the vast world"), inserted before the rest of Phase 3.

**The player is the overseer of one settlement and also a god** (user, 2026-10-23). God powers are part of
the game: validated, deterministic world commands, stored with their tick in the save and replayed
identically after load; anything a power creates goes through the ledger as the explicit source "divine";
every power shows what it will do before the player confirms, and destructive ones warn first. They arrive
in steps: Phase 2c (settlers, blessing, inspiration), after Phase 5 (destructive powers), after Phase 8
(spawning animals), and later terrain, weather, worship and favour.

**Direction update (user, 2026-10-24): WorldBox's breadth and chaos on top of MadColony's depth.** An
original game in the same genre, never a copy: never use WorldBox's name, art, UI layout, race designs or
signature creatures. Phase 3 and Phase 4 are paused; the WorldBox-feel phases come first, in this order:
1. **Phase 5** (death, illness, war and collapse, as written below), plus: wars happen more often between
   rivals, villages and kingdoms can be destroyed or absorbed, and ruins stay on the map.
2. **Phase 5b** destructive and nature god powers: lightning, fire (spreads through forest and wooden
   buildings), meteor, plague, earthquake, tornado, rain (puts out fire, grows plants), drought. Each with a
   preview and a confirm.
3. **Phase 8 moved up:** animals (herds, predators, hunting), spawning animals with god powers (Phase 8b),
   then original wild monsters that attack villages.
4. **World shaping** (new): terrain brushes (raise/lower land, dig water, make mountains, plant forest, place
   stone and ore deposits) and a "Blank world" scenario: shape the planet first, then spawn the first people.
5. **Peoples and traits** (new; replaces "Multiple races" in the parking lot): 3–4 original peoples with their
   own looks, needs, preferences, temperament and building styles; individual inheritable traits (brave,
   greedy, wise, sickly, ...) that change behaviour; peoples can be spawned with god powers.
6. **World laws** (new): settings toggled during play, e.g. no wars, no aging, fast growth, endless plague,
   peaceful animals.
6b. **Civilization laws** (owner, 2026-10-28): laws that villages and kingdoms keep and change (conscription,
   curfews, rationing, taxes or tithes, borders, schooling, hunting and forest protection, punishments, ...),
   chosen by their people, temperament and rulers, with reasons; kingdoms set laws for their members. Its own
   phase and design note, right after World laws (which are the gods' world switches).
6c. **Mood** (owner, 2026-10-29): each person's mood from needs, home, food, grief, traits, their people and
   their village's laws (each law option has a mood value), with effects (work speed, unrest, villages
   changing laws or people leaving) and reasons. Its own phase and design note, after Civilization laws.
6d. **Phases 11–16** (owner, 2026-10-29), after Mood and before the scale target. Each has its own section
   below.
   - **11** integration and reliability;
   - **12** connected world chronicle;
   - **13** need-driven prayers and petitions (the first slice of worship);
   - **14** intervention follow-through;
   - **15** village memories and traditions;
   - **16** playtesting and balance.
   The macro god-simulator direction holds: villages manage themselves; the player shapes the world and
   watches consequences.
7. **Scale target:** thousands of people world-wide by day 300 on the World preset; measure and plan the
   performance work needed.
Then Phase 3, Phase 4 and the rest, as written below.

**Long runs never hang silently (user, 2026-10-24).** Every command that can take over a minute (tests,
bench, sim runs, reports, playtests) runs with a time budget and prints a progress line at least every 10 s;
runs over 2 minutes go in the background; the game server is never started in the foreground and is stopped
by its own PID afterwards; only one heavy run at a time. On a timeout: read the log tail, rerun once alone,
then a smaller version to find where it slows, and report what got stuck. Never report a pass that did not
finish. (At home this is `tools/run-guarded.mjs` and the `long-runs` skill.)

**Rules for every phase:** zero dependencies and procedural art; determinism across save/load; item
conservation (ledger + census); sim and UI separate; old saves keep loading (format changes through
`src/sim/migrate.js` with a version bump and an old-save test); content as data; every system works for 30+
villages (state its per-tick cost and its distant-village behaviour); full autonomy with visible reasons;
never weaken a test.

**Plans are saved (since Phase 2 slice 2, save format 7).** The planners' plans are derived data, but they
are now written into the save (`save.planner`, `src/sim/plancodec.js`). Reason: without them a loaded game
had to plan afresh, and its run could differ from the same game never saved. With them `serializeGame` only
reads, and a loaded game continues exactly like the game that was saved (determinism across save/load).
Rules that follow from this: a plan may hold whole state entities (a colonist, a structure, ...), which the
codec stores by id, but never other parts of the state (a job, a research record), which would be copied and
lose their identity; stored plans are checked on load (forbidden keys, references to entities in the save,
shapes); plans that do not fit are dropped with a warning and the game plans afresh, as do older saves and
saves made with other mods.

**How a phase runs:** a design note in `docs/proposals/<phase>.md`; small, separately tested slices; full
tests, the 40-day headless run, the seed 4242 "Advance to Modern" run and `tools/bench.js` against a baseline
(over 10% tick-time regression is fixed or explained); before/after screenshots; README and roadmap updated.

## Phase order

### Phase 0: close out half-built work (Done)
Civic intents phase 2 (lamps and taps as intents, family and schooling on the hover card) merged after an
independent compatibility review; leftovers placed in the phases below; this phase order; the Ideas parking
lot. See `docs/proposals/phase-0-close-out.md`.

### Phase 1: big-world foundation (the scale change) (Done)
**Summary.** Huge and Colossal worlds with biomes, compact saves, level-of-detail simulation for distant
villages, the world view and village summary, the Living world scenario, villages placed near water, path
searches about 3× faster, warm caches on big worlds, and the Overseer-style UI. The 60-day acceptance run
on Colossal met every target (12 villages 0.37 ms per tick, 30 villages 0.96 ms). A coarse-route corridor
was tried and parked for Phase 7; no path cache was added. Results: `docs/proposals/phase-1-big-world.md`, "Final
results"; numbers in `docs/PERFORMANCE.md`.

The original plan:
World presets up to at least 8x today's largest, in chunks/regions, with biomes, lakes, rivers, forests and
mountains readable from far out; level-of-detail simulation (full sim near the camera and the player, a
cheaper abstract tick for distant villages using the same rules in aggregate, conserved and deterministic,
with a tested round trip); path caching and a coarse region graph; a zoomed-out WorldBox-style renderer
(pixel terrain, settlements as building pixels, territory borders, roads, travellers as dots, names and
procedural flags) with a smooth transition to today's renderer; a village summary when clicking from far
out; a "Living world" scenario (player + 8-12 AI villages); performance targets for 12 and 30 villages.
*Already built before Phase 1:* Small/Medium/Large presets (up to 192x144), scouting, a region map for
reachability.

**Done** (see `docs/proposals/phase-1-big-world.md`, "Results so far" and "Final results"):
- Huge 384x288 and Colossal 544x408 presets.
- Biome world generation (`core:continent`: ocean, coast, plains, forest, hills, mountains, marsh, tundra,
  passable rivers) as mod data; existing worlds unchanged.
- Chunk indices for nodes, structures and stacks; a territory grid; chunked walkable areas.
- Compact save format 4 (Colossal day 0: 5.3 MB to 469 KB) and format 5 for level of detail.
- The "Living world" scenario with spread villages and 6 new village profiles (8 in all).
- Level-of-detail simulation: abstract hourly villages by the same rules, caravans, promotion when near,
  watched, at war with the player or attacked; known simplifications listed in the README.
- The world view (terrain pixels, territories, building pixels, people dots, caravans, names and flags,
  cross-fade).
- The village summary with "Go there".
- New colony dialog defaults taken from the scenario (size and village count, up to 40 when spread).
- Slice 2, pathfinding: `findPath` is about 3× faster with identical results (typed-array heap). The
  coarse-route corridor was built as an experiment and **parked** on branch
  `phase1-path-corridor-experiment`: on open continents the corridor cut only 1–7% of expanded tiles while
  region rebuilds got 20–80% slower. Revisit in Phase 7 (roads change travel anyway).
- Slice 7, the Overseer UI overhaul (below) and its follow-ups.
- Villages placed near water, and water found by walking distance (the seed 11 thirst problem).
- UI reads of relations no longer create relation records.
- Big worlds build their derived caches at creation and load (post-load worst tick under 1 ms).
- The 60-day Living world acceptance run and the performance table for 12 and 30 villages.

**Moved on from Phase 1** (not done):
- Separate before/after screenshots of the world view itself (the Overseer before/after shots at 1920 and
  1024 wide, zoomed in and out, are in `docs/screenshots/overseer-*.png`).
- Path cache and coarse-route corridor: Phase 7.
- More contact between far-apart villages (distant villages cannot meet by sight); later moved into
  Phase 2b and built there in slice 5 (Vast world only).

#### UI overhaul: Overseer style (part of Phase 1) (Done)
Built as specified below, with these differences: tab hotkeys Q/G/R/C/P/M/L/U (W/A/S/D move the camera);
the clock has no weather (there is none yet); the portrait bar shows health, not mood; letters at first
opened only the Log line or the Diplomacy tab (jumping the camera was added in Phase 2, see "Letters" there);
the world view's labels and the village card in the inspector slot are as built in slices 4–5.
**Goal.** The map fills the whole screen and all UI floats over it as dark translucent panels
(RimWorld-like). This replaces today's fixed left goals panel, right colonist panel and bottom event log.

**Look**
- Panels: background `rgba(24,25,28,0.9)`, a 1px border `rgba(255,255,255,0.08)`, 8–10px corner radius.
- Colours:
  - text `#ECE7DE`, secondary text `#B7B0A3`;
  - one accent, amber `#E0A43A`, with hover/selected `#E8B04B`;
  - good `#7CC47A`, warning `#E0A43A`, bad `#E26D5A`, water `#6FB2E6`.
- Fonts: a clean sans (the system-ui stack, or IBM Plex Sans if self-hosted) and a monospace for numbers.
  Zero dependencies: no CDN fonts at runtime; any font file ships inside the project, otherwise system fonts.
- The existing procedural resource icons stay.

**Layout** (1440x900 reference; must also work at 1024 wide)
- **Top-left:** date, time, season, temperature, weather, plus pause and 1x/3x/9x/30x.
- **Top-centre:** a colonist portrait bar (portrait, name, small mood/health bar). Clicking selects the
  colonist and centres the camera. It scrolls or groups when a village is large.
- **Top-right:** resource chips (number + small label). Under them, stacked event cards ("letters") for
  important events, newest on top: click to jump to or open one, or dismiss it.
- **Bottom:** a full-width tab bar: Work, Goals, Research, Colony, Diplomacy, World, Log, Menu.
  - Each tab opens a floating panel above the bar; only one is open at a time; Esc closes it.
  - Goals, field priorities, research, colony stats and the event log move into these tabs.
- **Bottom-left:** an inspector card for the selected colonist, building or tile: portrait, role, age,
  equipment, current job, the "why" explanation, and need bars (food, rest, water, mood, health).
- **Bottom-right:** a minimap of the whole world with the camera rectangle; click it to move.
- **Zoomed out** (the world view from Phase 1):
  - the same panel style;
  - kingdom and village labels in flag colours over the map;
  - clicking a village opens its summary card in the inspector slot;
  - the event cards show world events (wars, foundings, plague).

**Rules**
- UI only (`src/ui`): no simulation or determinism changes.
- Every panel can be collapsed, and every tab has a keyboard shortcut.
- The existing roof and overlay toggles move to the Menu tab.
- Before/after screenshots at 1920 and 1024 wide go in `docs/screenshots/`.

### Phase 1b: sound (Done)
**Summary.** Procedural Web Audio sound in `src/ui` (no files, no libraries): master, music and effects
sliders and mute in Menu → Sound (saved), N to mute; a zoom mix of world ambience and event cues (war horn and
drums, attack drums, bells, plucks, a warning) with on-screen voices (steps, chop, pick, hammer, craft,
cooking, fields, fire, shots and hits); wind and cold by season and temperature; birds and crickets;
generated pentatonic music per season, minor with a drum in war, slower at night. Simulation runs are
unchanged; `sound.update` costs about 0.02 ms per frame. Results: `docs/proposals/phase-1b-sound.md`.

**Still open:**
- Listening in a real browser (no one has heard it yet), including the browser checks in the design note.
- The death cue (collapse stands in until Phase 5) and the founding bells for villages founded during play
  (founding now exists, but plays the good-news notes, not the bells).
- Weather sounds beyond wind and cold, once weather exists.

The original plan:
Procedural sound only, generated with the Web Audio API: no audio files, no libraries. Zoom-aware mixing:
- **Zoomed out:** world ambience and distant event cues (war declared, village founded, fire, death).
- **Zoomed in:** work, footsteps, fire, weather and combat sounds for what is on screen.

Simple generated background music that shifts with the season, the time of day and war or peace. Master,
music and effects volume sliders and mute, saved in settings. Sound lives entirely in `src/ui`: it only
reads the simulation and never affects it or determinism.

### Phase 2: neighbours, diplomacy and kingdoms (Done)
**Summary.** Alliances; villages founded during play by settlers leaving crowded villages; kingdoms; markets
with supply-and-demand prices; a letters rework; and a hover-card field registry. Founding, kingdoms and
markets run only in scenarios that turn them on (today the Living world), so classic worlds are unchanged.
Save formats 6–9. Results and
acceptance tests: `docs/proposals/phase-2-kingdoms.md`, "Phase 2 summary".

The original plan:
Villages founded during play by settlers leaving crowded villages (inheriting relations and culture);
alliances (defensive pacts, allies join wars, shown before signing); markets with supply-and-demand prices;
kingdoms (capital + member villages, name, flag, one territory colour zoomed out); all at the abstract level
too. *Already built:* AI villages, contact, relations with causes, physical trade, offers, gifts, requests,
trade holds, trade pacts, pact proposals, multi-item deals, gathering rights and border disputes.
*Also open here (from civic planning):* hover-card fields for kingdom and culture once they exist, plus
home and equipment lines and a small field registry so future fields appear only with their systems.
Design note: `docs/proposals/phase-2-kingdoms.md`.

**Done:**
- Slice 1, alliances (commit `e81f5df`): defensive pacts (relations +50, contact, at most 3 allies), terms shown before
  signing, lapse below +25, −20 to end by hand; allies cannot attack each other; the first attack of a war
  calls in the defender's allies (no chaining); AI villages sign with each other and propose to the player
  with a reason; distant villages join by relation only. Save format 6 with load validation of treaties,
  alliances, proposals and war markers. Results and deviations: design note, "Slice 1".
- Letters (a user request, UI only; rework commit `fb8dfb9`): important cards stay until clicked or
  resolved, routine cards fade after 8 s of real time (setting in Menu → Routine notices), at most 4 cards
  with "+N more", repeats grouped, and clicking a card jumps to the colonist, village or tile.
- Sound fix (commit `af4065c`): quieter continuous layers (fire, fields, cooking, wind) and fewer work hits.
- Slice 2, villages founded during play (commit `150998d`): founding rules as scenario data (on in the
  Living world only); daily trigger with visible reasons; whole families leave, nothing is created, supplies
  go as a gift trade (caravan from distant villages); sites chosen without randomness and without taking
  anyone's claimed land; the daughter inherits relations, knowledge, profile, policy, laws and culture, and
  starts at +60 with its parent; distant villages found too; the player's "Let settlers leave" policy and
  the Settlers block in the Colony tab; lineage and growth lines in Diplomacy, the village summary and the
  World tab. Also: planner "room to grow" (a spare bed), distant construction no longer blocked by one
  stranded colonist, per-settlement ownership indexes (bench 8–22% faster), and save format 7 with the plans
  stored (see "Plans are saved" above). Results and deviations: design note, "Slice 2".
- Slice 3, kingdoms (commit `1ede90a`): a kingdom forms when a village in no kingdom founds a daughter
  (founder = capital); later daughters and daughters of members join; name from the profile's
  `kingdomNames` by a stable hash (no RNG); the capital's colour. Members defend each other (the first attack
  of a war, no chaining) and never fight each other; daily, a member hostile to its capital (≤ −25) leaves,
  and of two members at war the one the capital likes less leaves; the capital never leaves; a kingdom down
  to its capital dissolves; all logged with causes. Kingdom territory, capital banner, minimap rings, a
  Kingdom column, card and summary blocks, and "Kingdom: X" on the colonist hover card. Save format 8
  (migration forms kingdoms for existing daughters; load validation). Results and deviations: design note,
  "Slice 3".
- Slice 4, markets (commit `9039eb7`): the Trade routes tech (only where the scenario has a `market` block,
  today the Living world; hidden from the Research panel elsewhere) and a walk-through Market stall, built by
  a village that knows the tech and has met at least 2 non-hostile villages (wanted from 3 contacts). A market
  serves villages within 120 tiles that have met it; once a day it sets prices from the plans' surplus and
  wants (value × clamp((demand + k)/(supply + k), 0.5, 2), a quarter of the way per day, k = 200 in the
  Living world; controlled goods left out). Trades between two villages served by one market are valued at
  its prices in AI deals, player offers and the offer preview alike, in whole cents; calling off uses the
  deal's market. Market card, summary line, World-tab marker and offer price table. Save format 9
  (`s.markets`, `trade.market`, validated on load). Results and deviations: design note, "Slice 4".

- Slice 5, hover-card field registry (commit `c727e94`, UI only): `PERSON_FIELDS` in
  `src/ui/hoverfields.js` lists the card's text lines with the system each belongs to (top: life, kingdom,
  culture, family; bottom: home, equipment, village market, training). A line shows only when its system
  exists and there is data. New lines: Culture, Home, Equipment, Village market; the kingdom line moved into
  the registry; existing wording unchanged. A broken field is left out (`personFields(g, c, fields,
  onError)`). Results: design note, "Slice 5".

**Still open (moved on from Phase 2; not done):**
- Hover card: not checked in a browser: the "(building)" home text, the bed shown when there is no home, and
  the ammunition text.
- Kingdoms: no member left a kingdom in the 60-day runs, so leaving and dissolving are covered by tests
  only. Not checked: the kingdom overlay's rebuild time on Colossal, a live redraw when a member leaves,
  the 1024 px layout, and the capital banner near the top edge of the screen.
- Markets: a deeper profile of the 60-day Living world run with 30 villages (1.28–1.29 ms per tick against
  1.08–1.10 ms before markets, +17–19%; the worlds differ and a first profile put the market code at 0.2% of
  CPU). Few AI-to-AI trades use market prices (7 of 81), because AI villages rarely meet. Not checked in a
  browser: a market built by AI play, the 1024 px layout, the Colony-tab market card.
- Alliances in a real war in a long run: none of the verification runs had a war, so this is covered by
  tests only.
- A repeatable ~46–50 ms tick from the planner's site search for a Lecture hall (Living world, Colossal,
  seed 7, 12 villages, tick 53459). Older code; it breaks the 50 ms worst-tick target at its edge.
- Living-world villages grow slowly (about 5–7 people by day 30); the founding data is tuned so that
  villages are founded within 60 days.
- The design note's target "30 villages within 10% of 0.961 ms per tick" was not met on the (loaded)
  verification machine: 1.20–1.23 ms, against 1.85 ms for the code before slice 2 under the same load. In
  the slice 3 runs on a fairly quiet machine it was 1.09 ms (the same as the code before slice 3), still
  above 1.057.

### Phase 2b: the vast world (Done)
**Summary.** Planet worlds (Vast 1536×1152 and World 2048×1536, generator `core:planet`) on typed per-tile
storage (43–44 B per tile); the default New colony scenario `core:vast_world` with 7 settlements far apart;
organic territory; contact over distance (explorers, traders, touching borders); civilization spreading to
64 villages; the whole world on screen with labels by zoom; trip budgets so colonists far from home stay fed,
watered and rested. Final run (World, seed 7, 300 days, on `1808112`): villages 7 → 64, people 24 → 347,
1963 of 2016 pairs met, 5545 trades done, 0.62 ms/tick, 0 conservation errors. Browser: World generation
3.8–4.6 s, load median 2.7 s, 60 fps fully zoomed out. Results, the acceptance summary and the carried-over
list: `docs/proposals/phase-2b-vast-world.md`.

The original plan:
Much bigger worlds (presets well beyond Colossal, e.g. "Vast" about 1536×1152 and "World" about 2048×1536,
the largest that meets the targets after measuring), with planet-scale continents, oceans, mountain ranges,
rivers and biomes; a new default scenario where the player and 4–8 AI settlements start far apart (about 150
tiles or more, scaled with the map) on good sites in different regions, and most of the world is wilderness;
growth and founding spread civilization outward over game years (expected village counts at day 100 and 300
stated); villages still meet: explorers and scouts, traders to known villages, and contact when territories
grow toward each other, each with a visible cause, also for distant villages; the camera zooms out until the
whole world fits on screen, with a cached world texture updated only where things change, kingdom labels
first and village labels as you zoom in, and a whole-world minimap; territory borders follow the land and
grow outward from settlements (organic, WorldBox-style). Only places with people cost anything per tick.
Targets: largest-preset generation under ~10 s in the browser; per-tile memory stated (typed arrays, no
per-tile objects); save size at day 0 and 100; tick time at day 100 and 300 within ≤ 1.5 ms typical and
≤ 2.5 ms worst case; 60 fps with the whole world on screen. Acceptance: a 300-day headless run on the
largest preset. Existing worlds and scenarios keep working unchanged. Design note:
`docs/proposals/phase-2b-vast-world.md`. This absorbs the parked ideas "contact between distant villages"
and "organic territory borders".

- **Done:** slice 1, scale foundations (commit `1ea7399`, no change to existing runs). Terrain and the six
  per-tile indexes are typed arrays behind the `Game` accessors; regions are relabelled per changed chunk
  and joined on a coarse chunk graph; faster indexes (`emptyNodes`, `nodesByDef`, `spreadSites`) and
  worldgen (typed quantile sort, buffered pass carving); A* in an 801×801 window with an exact whole-map
  rerun; map limit 4096; browser saves in IndexedDB, gzip-compressed. At 2048×1536 (seed 7, 10 villages):
  creation 34.5 → 7.3 s, 125 → 60 B per tile, load refused → 3.8 s, 2.58 → 0.75 ms/tick, worst tick 507 →
  104 ms. Results: design note, "Slice 1".
- **Done:** slice 2, planet generator and Vast/World presets (commit `d85a309`). New generator `core:planet`
  (data in `mods/core/content/planet.json`); presets Vast 1536×1152 and World 2048×1536 always make planets,
  classic sizes unchanged. 22 domain-warped plates, 9 continental in 4 groups kept apart by sea channels and
  straits (≥ 4 continents on seeds 1–20 at both sizes); ~60% sea; ridged ranges in segments along plate
  edges; drainage-basin lakes and continuous rivers; climate by latitude and height, moisture from the sea;
  15 biome rules with new terrains tundra, taiga, jungle and savanna; passes into walled valleys; nodes by
  biome within 0.05 per tile. World at seed 7 in Node: create 3.2 s, load 2.4 s, 0.62 ms/tick, worst tick
  after warm-up 38 ms. World ships as the top preset. Results: design note, "Slice 2".
- **Done:** slice 3, the vast-world scenario (commit `e843618`). New scenario `core:vast_world` (World size,
  planet generator, 5 founders, 6 AI villages by default, 4–8 allowed), preselected in New colony; the page
  still boots a small Neighbours world. Placement `far`: spacing max(120, round(0.1 × √(W×H))) (Vast 133,
  World 177), good sites (water within 24 tiles' walk, wood, stone, fertile land, open ground, on the
  player's landmass), greedy farthest-first with a biome-variety bonus, no RNG, never closer than the
  spacing. New colony offers only Vast and World for it; a "Generating the world…" overlay for Huge and
  larger. World, seeds 1–10: 6 villages every seed, closest pair 184–280 tiles, 4–6 biomes, one landmass.
  `npm test` 618. Results: design note, "Slice 3".
- **Done:** slice 4, organic territory (commit `95dd79d`). Scenario rule `territory: "organic"` (only the vast
  world; all other scenarios keep nearest-centre). Each village claims land outward from its centre, daily,
  up to a radius min(90, 10 + 1 × people + 0.2 × days) of open land, spreading by terrain cost (data; open
  water stops it, rivers cost 8 and mountains 10); nearest frontier tile world-wide first; claims are
  permanent except a logged hand-over from parent to a new daughter; tiles another village uses wait.
  Building and fields need own land or unclaimed land within 2 tiles of it; gathering is free on unclaimed
  land. Founding searches past the parent's land and may start on it. Land area, last growth and limits on
  the village card and summary; the overlay repaints only the changed box (daily frame spike 61–130 ms →
  ≤ 14 ms); minimap territory layer. Save format 10 (claim grid as runs, validated; old saves keep
  nearest-centre). World seed 7, 100 days: 8/13/20/30 villages at days 30/50/75/100, save/load identical,
  0.37–0.93 ms/tick. `npm test` 645. Results: design note, "Slice 4".
- **Done:** slice 5, contact over distance (commit `cff79cb`). A scenario `contact` block (only
  `core:vast_world`; other scenarios unchanged). Explorers: light travelling entities (no colonist, no
  items), every 3 days after the last came home, over land chunks of the home landmass, range 4 chunks + 2
  per trip up to 48, 240 tiles/day, to the farthest undiscovered chunk (FNV-hash ties), discovered-chunk
  bitsets, meeting villages within 8 tiles of a chunk entered ("Explorers from A met the people of B (n days
  out)."). Traders every 8 days to known villages on the same landmass (not hostile), relation +1 counted in
  `rel.visits`. Borders: "The lands of A and B now touch." First contact kept in `rel.met`. Player-village
  stall fixed in contact games: scouts and carers within 60 tiles (scouts only when fed and rested), far trade
  legs by caravan with goods hauled to the stockpile first, deadline max(3 days, caravan + 1 day).
  `activeTrades` cache no longer rescans finished trades. Save format 11. World seed 7, 100 days: 7/7/31
  villages at days 10/30/100; pairs met 0/21, 4/21, 267/465; player 101/157/263 structures, no collapses;
  0.65 ms/tick average; contact ~1.4 µs/tick; save/load identical. `npm test` 675. Results: design note,
  "Slice 5".

- **Done:** urgent needs interrupt walking colonists, in all games (commit `3420ce2`, approved by the user).
  The needs check runs on a step's last tick; carriers (goods, a carried patient, water) finish their leg
  unless the need is critical (`criticalBelow`, default half of `urgentBelow`); combat is exempt; need jobs
  switch to a clearly more pressing need while walking (margin 0.1); `job.unmet` stops repeated interrupts
  for 600 ticks. Classic pinned runs unchanged; famine and drought games and the Vast and Living worlds play
  differently. Vast world, seed 7, 30 days: player 157 → 190 built, 0 collapses. Results: design note,
  "Urgent needs while walking".
- **Done:** slice 6, civilization spreads (commit `b17fdd4`). Founding per village (cooldown 25 days,
  daughters from 40 days), world budget 4 a day and 8 site searches, cap 64; outward sites on discovered land
  within 0.06 × √(W×H) (max 140); explorers aim at big undiscovered areas; markets also reach met villages on
  the same landmass within 400 tiles; trades within 400 tiles, nearest pairs first, at most 3 active per
  village; finished trades pruned after 10 days (`rel.tradesDone`) and old log keys pruned; the era drive
  (Vast and Living worlds; also the player's village without an era goal, "Advancing to the next era"); a
  trap-check fix for big worlds; save format 12. World seed 7, 300 days: 8/16/32/64 villages at days
  30/60/100/150; starting pairs met 20 of 21 by day 300; player 281 built at day 100 (Modern), 466 at day 300;
  0.22–0.44 ms/tick to day 100, 1.28–1.57 over days 201–300. `npm test` 726. Results: design note, "Slice 6".
- **Tools** (commits `637ba02` and `9045b47`): `tools/world-report.mjs` and `tools/balance-check.mjs`, plus the project
  skills playtest, world-report and balance-check in `.claude/skills/`.
- **Done:** readable unique colonist names (commit `c9009b2`). First names while free, then first name +
  surname (40 surnames in `core:names`; `surnames` optional in a name pool), children take a parent's
  surname, Roman numerals only last; no rng draws. Two Living-world pinned results re-pinned with the
  user's approval (names only). Results: design note, "Readable colonist names".
- **Done:** slice 7, seeing the whole world (commit `d4d2a8b`). Labels by zoom (`src/ui/labels.js`):
  kingdom names fully out (plus villages outside kingdoms and the player's village), village names and
  flags nearer, name tags and storage labels close up on a dark backing, all placed without overlaps.
  Territory borders at every zoom (close-up overlay in every world with 2+ villages; a coarse 1-px-per-4-tiles
  layer far out, resampled only in changed rectangles). Explorers, traders and caravans drawn with dashed
  lines to their destination and a hover card. Structure image updated per chunk. Colonists hidden below
  zoom 0.1, dots from a cached list. Headless Edge, World seed 7: drawing 11.0 ms zoomed in, 21.0 ms at
  village zoom, 0.49 ms whole world. `npm test` 740. Results: design note, "Slice 7".
- **Done:** no thirst in sleep and no far-bed collapses, in all games (commit `322da8c`, approved by the
  user). New optional need fields `sleepDecayMult` (water decays at 0.5× while asleep), `beforeSleepBelow`
  (a drink before bed below 0.6) and `maxBedDistance` (beyond 20 tiles a bed is walked to only if energy
  lasts; otherwise sleep on the ground); energy `criticalBelow` 0.08. Vast world seed 7, day 60: 40
  Dehydrated / 154 collapses → 0 / 0; classic seed 4242, day 40: 10 → 0; output within 1%. Re-pins and 4 test
  setup changes approved by the user. Results: design note, "No thirst in sleep, no far-bed collapses".
- **Done:** worst ticks under 50 ms on the World preset, identical results (commit `f5b1fab`). `tradeHeld`
  memo, A* rewrite and a path cache on maps over 801 tiles, market/landmass memo, pact index, cheaper
  `pipePath` keys. Vast world seed 7, days 240–300: worst tick 68 → 45 ms, none over 50 ms; a fresh 300-day
  run: 44 ms after day 1. Bench within noise. `npm test` 757. Results: design note, "Worst ticks under 50 ms".
- **Done:** slice 8, acceptance. First 300-day run (World, seed 7, before the two fixes above): typical
  tick about 0.7 ms and worst day average 2.1–2.4 ms (pass); worst single tick 83–114 ms (fail, since fixed by
  `f5b1fab`); saves 2.76 MB / 544 KB gzipped at day 0 and 9.49 MB / 1.24 MB at day 300; load 1.0–1.8 s; heap
  59–74 MB; day-150 save continued identically; conservation clean; 64 villages (the cap); 1965 of 2016
  pairs met by day 300. Browser checks (commit `0373a41`): generation 3.8–4.6 s, fully zoomed out 60 fps
  (drawing 0.4–0.6 ms), labels without overlaps, minimap, save 0.3 s, 0 console errors. Trip budgets (commit
  `1808112`, opt-in `travel` rules, only the vast world): work trips judged by the walk from home and only
  taken if food, water and rest last; far nodes left to quarrying, trade or markets; seed 7, 300 days:
  health episodes 1167 → 0, the player's village Modern on day 92 (was 96); classic, Living and 4242 runs
  identical; World ms/tick about +9%; `npm test` 772. Faster World loads (commit `c2d4544`): the load's
  trial run in a Web Worker, browser load median 3.8 → 2.7 s, heap after a load 280 → 160 MB. Final world
  report: `docs/reports/world-report-2026-10-24-300d.html`. Results: design note, "Slice 8" and "Phase 2b
  acceptance summary".

**Carried over from Phase 2b** (not done):
- Village-zoom drawing about 10–19 ms (30–38 fps at village zoom in the browser).
- The close-up territory overlay is still 2 px per tile (about 50 MB on World).
- The minimap territory layer is fully resampled each day.
- One starting pair never meets; the starting villages' borders never touch.
- No wars happen (Phase 5).
- Population only grows (Phase 5).
- Wood runs out near old villages: no forestry, no wood at markets (see "Tree planting" in the Ideas parking
  lot).
- A rare dehydration chain near home (a long job near home holds through the need's seek level; a critical
  rest cuts off a drink; a sleeper wakes for thirst only above energy 0.3). 0 cases in the final run, but
  possible.
- Smaller points: rivers are a costly crossing for claims, not a stop; the first tick on planets takes about
  74 ms; 72 B per tile at Colossal (target 70); low stone near vast-world sites; weather in play is still
  global (latitude weather stays parked).

### Phase 2c: god powers, part 1 (Done)
Design note: `docs/proposals/phase-2c-god-powers.md`.

A God tab / power bar in the Overseer style, with a hotkey and a clear "god mode" cursor so nothing is cast by
accident. Spawn settlers: a group of 1–10 arrives at a clicked spot with basic founding supplies and founds a
new village (its own name, flag and profile, chosen or random), or joins an existing village. Bless a village
(temporary faster work and growth) and inspire research (a one-time boost). Every power is a validated,
deterministic world command, stored with its tick in the save and replayed identically after load; anything
it creates (people, items) goes through the ledger as the explicit source "divine", so conservation tests
still pass; each power shows what it will do before the player confirms. A "Sandbox" scenario setting makes
powers free; in normal games powers cost favour that slowly regenerates (numbers are mod data).

- **Done:** slice 1, the command framework (commit `6e69c7f`). `src/sim/god.js`: `previewCommand` (read-only),
  `issueCommand` and `applyCommands` right after `s.tick++`; `s.god` made lazily (first command, or a Sandbox
  game); favour per whole day (core: start 30, max 100, +5 a day), charged on apply; content type `godRules`
  and `core:god`; scenario `god`; save format 13 (no-op migration, `validateGod`); `created:divine`; a test
  power `omen`. 19 tests. Results: design note, "Slice 1".
- **Done:** slice 2, spawn settlers (commit `dca934c`). `src/sim/godspawn.js`: found (daughter-site rules at the
  tile, the village cap, `origin: 'divine'`, normal LOD) or join (in the village's land, room in beds + 2);
  supplies as `created:divine`; no rng draws; `peopleCensus`. 10 tests. Results: design note, "Slice 2".
- **Done:** slice 3, bless and inspire (commit `caf1373`). Bless: work ×1.5 and growth ×2 for 5 days (at most
  15), ending at a day start, also in abstract villages. Inspire: +40% of the current tech; waits for unpaid
  materials. 15 tests. Results: design note, "Slice 3".
- **Done:** slice 4, the God tab (commit `dca934c`). Ninth tab, key O; power bar, favour meter, targeting ring
  and banner, preview card, Confirm step, Escape one layer at a time; letters; village summary lines; the
  Sandbox checkbox in New colony. 12 tests. Results: design note, "Slice 4".
- **Passing:** slice 5, acceptance. `npm test` 828 of 828; with no power used, the 40-day run, seed 4242 and
  the Living world are identical to Phase 2b; bench within noise. Browser playtest (`caf1373`, headless Edge,
  Living world Huge seed 7, normal and Sandbox): all pass, 0 console errors; god mode costs about 0.1 ms a
  frame. World report not run: powers act only on player commands, which headless reports don't issue, so it
  would repeat Phase 2b's numbers. Results: design note, "Slice 5".
- **Visual fixes from the playtest:** done (banner, blessing line, compact God tab, card clears the ring).
- **Carried over:** a divine village shows "Relation: Not met" with the player; crowded labels in a brand-new
  village; blessings last `days` to `days + 1` (end rounded to a day start); the minimap can cover a map label.

### Phase 3: finish electric production (paused after slice 3 for Phases 2b and 2c)
More powered machines and recipes (sawmill, machine-made parts, gun parts), factories larger than one machine
with delivery areas, production lines feeding each other, a planner that sizes machine count to demand,
power storage, abstract production rates for distant villages. *Already built:* charcoal, iron, generator,
poles, machine workbench, maintenance, the machine status panel. Design note:
`docs/proposals/phase-3-electric.md`.

- **Done:** slice 1, power at scale (commit `2abb346`, no behaviour change). Power and water networks are
  built per settlement in O(nodes) and cached until that settlement's structures change; one busy-station set
  per power update; the bills, refuel and maintenance givers and `machineStatus` look only at the
  settlement's own structures. All runs identical; a power-forced 30-village world went from 2.041 to 1.342
  ms per tick (−34%). Results: design note, "Slice 1".
- **Done:** slice 2, sawmill, planks and machine parts (commit `47c62d9`). New items planks and machine
  parts, made by hand at the workbench or faster on a powered sawmill and machine workbench; gun parts on the
  machine workbench; plank furniture used only when planks are free in stock. Generators, machines, the pump
  and four Electric-era techs now cost machine parts, and generators and machines are serviced with them. The
  planner uses a machine only when a built one can run, and starts one new machine at a time. In the seed
  4242 Modern run the colony now builds a generator (day 43.3), machine workbench (48.3) and sawmill (51.8);
  before, it built nothing powered. Results: design note, "Slice 2".
- **Done:** slice 3, machine and generator counts sized to demand (commit `564dec7`). Another machine of a
  kind when workable demand stays above one machine's daily capacity (`machineHours`) for a day and all
  machines were busy 6 h; another generator after 6 h of overload (capacity < 0.9 × demand) in 24 h. Capped
  by `maxMachines` (3) and workers, one at a time, priority below homes, with reasons in the machine status.
  Normal runs unchanged; in a busy seed 141 run the 2nd bench was built day 13.62 and the 2nd generator day
  17.37. Results: design note, "Slice 3".

**Phase 3 is paused after slice 3:** Phase 2b (done) and Phase 2c come first; Phase 3 resumes with slices
4–6 after Phase 2c. **Still open in Phase 3:** slice 4 (power
storage), slice 5 (factories with delivery areas), slice 6 (abstract production for distant villages; also
generator sizing for distant villages). Machines come 11–16 days after Electricity in the seed 4242 run
(iron is short), not "a few days" as planned.

### Phase 4: finish utilities (scale-relevant only)
Review water, plumbing and heating for cost at scale and add abstract versions for distant villages. Cooling
and room lighting stay parked. *Already built:* water, wells, lighting, running water, seasons and heating,
seasonal crops; lamps and taps are civic intents (pipes and power poles stay direct projects on purpose:
they are network paths, not single buildings).

### Phase 5: death, illness and the end of combat (Done in the cloud copy, 2026-10-26)
Death (wounds, starvation, dehydration, cold, illness, old age) with burial, mourning and inheritance;
contagious illness spreading within and between villages along trade routes; surgery; permanent injuries;
wars can be lost (abandoned ruins or absorption); population growth and decline balanced over 100 days.
*Already built:* health, injuries, medical care, combat stages 1-3, births.
Design note: `docs/proposals/phase-5-death-and-collapse.md` (the user said "go" on 2026-10-26; the four open
questions were not answered, so the note's proposals are the working defaults).

- **Done:** slice 1a, death (commit `fe413b7` and the review fixes after it). At 0% health for 6 hours a collapsed
  colonist dies, in full and distant villages alike; at 0% they heal only with care (tending, a medical bed, a
  dressed or cleaned wound; in a distant village anyone else on their feet). The dead leave `s.colonists` for
  `s.dead`; jobs, beds, homes, training and plans are cleared; goods are put down where they died; the people
  ledger counts deaths. Save format 15. Classic 40-day and seed 4242 runs unchanged. Results: design note,
  "Slice 1a".
- **Done:** slice 1b, bodies, burial and mourning (commit `7e48fac`). Bodies carried to a village graveyard by
  carers and buried in named graves (distant villages at once; after 3 days by the village anyway); close family
  grieve 2 days (work ×0.85). Save format 16. Classic runs unchanged. Results: design note, "Slice 1b".
- **Done:** slice 2, cold and old age (scenario `life` block, Vast and Living worlds). Hypothermia for the exposed
  below −2 °C (asleep or collapsed outdoors, the homeless away from a fire; rooms +6 °C; distant villages: a
  finished home shelters); founding waits for warmer weather; elders from 50 work at 80%, old-age deaths from 60.
  Vast seed 7, 100 days: 25 → 119 people, 2 deaths of old age, none from cold. Classic runs unchanged. Results:
  design note, "Slice 2".
- **Done:** slice 3, contagious illness (content type `illness`, scenario `illness` block, Vast and Living worlds):
  outbreaks, spread at home and in the village, along deliveries, caravans and traders, medicine slows it,
  immunity; deaths through the slice 1a rules. Save format 17. Vast seed 7, 100 days: 9 outbreaks, 48 cases, 8
  between villages. Classic runs unchanged. Results: design note, "Slice 3".
- **Done:** slice 4, lasting injuries and surgery: deep wounds (≥ 30%) healed without surgery leave a lame leg or
  a crippled hand (slower work of some kinds); surgery in a medical bed mends them by skill. Save format 18.
  Classic runs unchanged. Results: design note, "Slice 4".
- **Done:** slice 5a, rivalry and AI war declarations (scenario `war` block, Vast world): pressing borders and
  near rivals lower relations daily by temperament; rivals who never fought do not cool; a stronger AI village
  declares war at −50 (on the player only after a threat and a day). Save format 19. Vast seed 7: first wars
  around day 98. Classic runs unchanged. Results: design note, "Slice 5a".
- **Done:** slice 5b, battles between distant villages (daily, in aggregate, wounds through the health rules) and
  AI peace (the weaker side after 4 days, any war after 20). Save format 20. Vast seed 7, 150 days: 14 wars in
  progress at day 150, population still growing (191). Results: design note, "Slice 5b".
- **Done:** slice 6a, fallen villages and ruins (commit `3b7231a`, all games): a village with nobody left falls,
  its ruins stay, it drops out of trade, diplomacy, planning, contact and the village cap, a fallen capital's
  kingdom passes to its largest member, its land is released after 20 days. Save format 21. Plus review fixes to
  slices 4–5b (wars start only by declaration in war games, war start dates for every war, markers cleared at
  peace). Results: design note, "Slice 6a".
- **Done:** slice 6b, conquest: a village with no fit fighters for 2 days is beaten; winners annex it into their
  kingdom or (hill fort, lumber camp) sack it for tribute; the war ends. Save format 22. Vast seed 7, 150 days: 16
  wars, 11 conquered, 1 sacked, 3 fallen. Results: design note, "Slice 6b".
- **Done:** slice 7, balance and acceptance: World tuning (conquest at 15% strength, faster near rivalry), speed
  fixes (ruin land release, cold checks, elder work speed). World seed 7, 300 days: 326 people, 22 wars, 2
  conquests, 2 ruins, 869 illness cases, 16 deaths; worst tick 48 ms after day 1; 10–12% slower per tick than
  before Phase 5 late in the run (more is simulated); classic runs unchanged. Not met: wars by day 100 on World
  (first at about day 175), deaths of 4 causes on World (3). Results: design note, "Phase 5 acceptance summary".

**Carried over from Phase 5** (not done): the player's village falling or being taken (open questions 1–2);
scavenging ruins; a full merge on conquest; more rivalry causes; seasonal outbreaks; winter clothing; earlier wars
on World; all UI (`docs/ui-todo.md`).

### Phase 5b: god powers, part 2 (destructive) (Done in the cloud copy, 2026-10-27)
Lightning, fire, plague, meteor and smite, each with a warning and a confirm step before anything
destructive; built on Phase 5's death, illness and wounds, using the same command, ledger and replay rules
as Phase 2c.

- **Done:** lightning, fire (spreading, burning out, scorch marks), smite, meteor (craters), earthquake, tornado
  (an exact path in the preview), plague, rain and drought, each destructive one refused until confirmed with
  warnings first; safe destruction and repair by the villages (`ruin.js`); firefighting and regrowth (the
  owner's answers to open questions 1 and 4, 2026-10-27). Save formats 23–26. Design and results:
  `docs/proposals/phase-5b-destructive-powers.md`.
- **Acceptance** (`tools/cloud-powers-run.mjs 40 vast 7`): all 11 power uses applied, after each a save and load
  ran 300 ticks identically, items and people exact every day, worst tick 32 ms after day 1 (14 ms while
  burning, 127 tiles burning at the peak); classic runs unchanged (same state hashes); bench the same as the
  Phase 5 code measured side by side on the same machine.
- **Carried over** (not done): craters on ground that walks or is claimed differently (forest floor, sand, hills,
  snow, tundra, taiga, jungle) keep their terrain, because a terrain change there rebuilds the whole-map water
  and territory data (about 0.5 s on Vast); burned land is marked scorched rather than turned to ash for the same
  reason; buildings have no partial damage (torn down or standing); rocks do not split in an earthquake; forest
  spread costs the Vast world about 10–15% (more trees to walk round and search: lower `perDay` in the data to
  trade growth for speed); costs and "powers may hit your own village" stand as proposed (open questions 2–3).
  Found in Phase 8: on the World map forest spread costs about +35% by day 50 (Phase 5 code 0.359 ms/tick,
  Phase 5b code 0.485, same machine), mostly from region rebuilds forced by the new trees' trap checks; the
  Phase 5b acceptance timed small maps only.

### Phase 6: government
Village council and policies that change real decisions (food reserves, research, trade, work allocation,
public building), leadership and succession, laws and taxation; kingdoms (capitals exist since Phase 2)
get a ruler and succession; member villages can rebel with visible causes. *Also open here (from civic planning):* decor, renovation and
storage-hub growth moved onto civic intents, and civic budgets (per-category project caps as views over
existing stock, never a second inventory), since public-building policy decides them.

### Phase 7: roads and transport
Roads from real travel demand within and between villages; walking, then horses and wagons, then vehicles
via research; cargo tracked from loading to delivery; roads visible zoomed out. Larger buildings only as
needed for warehouses and factories. *Also open here:* storage reorganisation (category zones, safe moves)
together with warehouses; the coarse-route corridor parked in Phase 1 (branch
`phase1-path-corridor-experiment`) and a path cache, to be measured again once roads change how people
travel.

### Phase 8: animals and the wild (Done in the cloud copy, 2026-10-28)
Wildlife ecology (deer and predators), hunting chain to the kitchen, horses; herds as dots zoomed out;
population-level simulation for distant regions.

- **Done:** deer, wolves and wild horses in every game (owner's answer 1), as herd counts far from people and
  single animals near full-detail villages; spring births, winter losses, winter ground and winter moves,
  drought losses; wolf packs eating deer and horses; hunting with weapons, a hunting limit of 3 (answer 5),
  carcasses, butchering, venison, horse meat and hides; meat and carcasses spoil (answer 2); wolves as
  dangerous as real ones to lone people, with fleeing, fending off and hunting a pack down (answer 4);
  distant villages hunt and are raided in aggregate. Wild horses only; taming comes later (answer 3). Save
  format 27. Design and results: `docs/proposals/phase-8-animals.md`.
- **Acceptance** (`tools/cloud-world-run.mjs 300 world 7 25 150`):
  - every species survives 300 days within its land (day 300: 290 wolves, 2,282 deer, 1,049 horses);
  - 662 carcasses hunted, with meat 1.7–4.7% of raw food;
  - the save at day 150 continued identically, and items and people were exact at every check;
  - classic runs `forty` ac37a8f860cb8e30 and `modern` 26aff18c94590ae1 (the modern era on day 41.24).
- **Carried over** (not done):
  - **Speed:** after the owner chose fewer full-detail animals (herds become animals within 28 tiles of a
    village, a hunt brings its herd near), the bench is about +5% on average against the code before Phase 8
    (medium alone +12%, small +6%); World was +35% by day 50 before this change and has not been timed alone
    since.
  - **Wolves:** they decline slowly on the World map (598 at day 50 to 290 at day 300), and none killed anyone in
    the 300-day World run; whether they should be more dangerous is open.
  - **Distant hunting:** distant villages spend no arrows and wear no weapons on hunts; their hunting share is not
    measured against full detail.

### Phase 8b: god powers, part 3 (animals) (Done in the cloud copy, 2026-10-28)
Spawn animals (deer, wolves, horses, later livestock) as herds or single animals, using the animal system's
real needs and behaviour.

- **Done:**
  - the `animals` power: a new herd, or animals joining the nearest herd; wolves near a village need confirm;
  - herds off their ground or crowded lose some and move on (all herds);
  - a full animal ledger, with births, sends and deaths by cause checked every day (owner's answer 3);
  - the `peaceful` switch: predators leave people alone (owner's answer 5);
  - save format 28.
  - Design and results: `docs/proposals/phase-8b-animal-powers.md`.
- **Acceptance** (`tools/cloud-animalpowers-run.mjs 30 vast 7`):
  - 9 power uses, with a save and load after each identical for 300 ticks;
  - items, people and animals exact every day;
  - worst tick 33 ms after day 1;
  - 164 tests pass;
  - classic era days unchanged;
  - bench +4–6% overall against the code before 8b (within this machine's noise).
- **Carried over** (not done): livestock to spawn (Phase 9); costs to revisit (owner's answer 2).

### Phase 8c: wild monsters (Done in the cloud copy, 2026-10-28)
Original wild monsters that attack villages (2026-10-24 direction, item 3), with their own design note: new
creatures, their looks, lairs and behaviour, built on the animal system.

- **Done:** the Thornback, the Gloomstalker and the Barkmaw:
  - lairs in every game, classic too (owner's answer 1), with far roaming and regrowth after 60 days;
  - behaviour near villages: fields, people, wooden parts;
  - fleeing, hunt parties, carcasses and drops, clearing lairs;
  - aggregate raids on distant villages;
  - the `monster` and `banish` powers (answer 6);
  - a village with 3 or fewer standing is never hurt (answer 3); peaceful does not cover monsters (answer 4);
  - a monster ledger; save format 29.
  - Design and results: `docs/proposals/phase-8c-wild-monsters.md`.
- **Acceptance:**
  - 182 tests pass;
  - World 300 days: 2.30 ms/tick at day 300, everything counted, save and load identical, no village wiped out;
  - classic `forty` unchanged; `modern` on day 45.5 (monster forays from day 15);
  - bench +1–8% against the code before 8c.
- **Carried over** (not done): monsters do not find paths (a blocked one goes home after 30 steps); "lit
  buildings" are not checked (rooms and fire only); no use yet for the gloom eye or heartwood (answer 5); few
  villages met a monster in the World run (forays may need tuning once the owner has played it); one 358 ms tick
  on day 170 of the World run is not explained.

### World shaping (Done in the cloud copy, 2026-10-28)
Terrain brushes and the Blank world (2026-10-24 direction, item 4), with their own design note.

- **Done:**
  - the `shape` power: raise, lower, water, mountain, flatten, paint desert, snow or marsh (the owner's answer 1),
    and forest, stone and ore;
  - strokes of radius 1-8 or drags; tiles under buildings, fields, stockpiles and people are kept;
  - brushes that block the way keep 3 tiles clear of villages and people;
  - 0.2 favour a tile, free in Sandbox (answer 4); destructive near villages, with a confirm (answer 3);
  - the Blank world scenarios: generated land with no people, and an open ocean with a few islands (answer 2);
    the first village founded there is the player's.
  - Design and results: `docs/proposals/world-shaping.md`. No new state; save format stays 29.
- **Acceptance:**
  - 189 tests pass; classic runs unchanged;
  - an island raised from open sea in 56 strokes, each saved, loaded and replayed identically, then settled:
    after 60 days 7 people, 103 buildings, no deaths, everything counted.
- **Carried over** (not done): an incremental water walk (a terrain stroke costs 0.6 s on Vast and 1.2 s on World
  in a running game; the owner's answer 5 accepted about 0.5 s); an exact trap check instead of the 3-tile
  clearance; "Start life" was dropped (generated maps keep their animals and monsters).

### Peoples and traits (Done in the cloud copy, 2026-10-28)
Original peoples and personal traits (2026-10-24 direction, item 5), with their own design note.

- **Done:**
  - four peoples (the owner's answer 1): Hearthfolk (every classic village), Reedkin, Cragborn and Duneshade;
  - each with its own needs, body, work, temperament, favourite food, names, looks and home style (reed
    house, stone roundhouse with stone walls, courtyard house);
  - Living and Vast worlds give each AI village the people of its land;
  - villages keep to one people (answer 4), and feuds between peoples grow ×1.5 (answer 5);
  - eleven traits (answer 3 added Quick, Strong and Kind) in every game, classic too (answer 2): they change
    work, learning, walking, tending, needs, illness, healing, cold, fighting, wolves, hunt parties and trade,
    with reasons in the statuses;
  - children inherit people, traits and looks;
  - `spawn` takes a people; the `trait` power (answer 6);
  - save format 30, with old saves filled on load from hashes.
  - Design and results: `docs/proposals/phase-peoples-and-traits.md`.
- **Acceptance:**
  - 205 tests pass;
  - World 300 days on seeds 7 and 11: every people lives on, everything is counted, save and load are
    identical, 2.33 and 2.45 ms/tick at day 300;
  - classic eras a little later (workshops on day 6.10, modern on day 46.12);
  - bench within 2% of the code before the phase.
- **Carried over** (not done):
  - a per-people ledger;
  - Reedkin on marsh;
  - daughter sites by land;
  - favourite food and greed in distant and AI-to-AI trade;
  - new materials;
  - mixed worlds see about twice the wars: tune after play.

### World laws (Done in the cloud copy, 2026-10-29)
The gods' world switches (2026-10-24 direction, item 6), with their own design note. The owner's laws of
civilizations are the next phase (direction item 6b).

- **Done:** the free `law` power and eight laws as data:
  - **Peace:** no new wars; running ones go on (the owner's answer 3);
  - **Ageless:** adults stop aging, no old-age deaths, children still grow up (answer 4);
  - **Fast growth:** ×2 (answer 5);
  - **Plague:** none or endless, never emptying a village (answer 6);
  - **Peaceful animals** (the Phase 8b switch);
  - **Tame monsters**;
  - **No spreading fire**;
  - **Endless season:** summer or winter (answer 7).
  - `s.worldLaws`, save format 31. Design and results: `docs/proposals/world-laws.md`.
- **Acceptance:**
  - 215 tests pass; classic unchanged;
  - a 200-day Vast run setting and lifting every law: save and load identical at each change, everything
    counted;
  - two bugs it found are fixed: the season caches, and the plague emptying a small village.
- **Carried over** (not done): the endless plague is harsh (tune after play); herds have no spring under an
  endless season.

### Civilization laws (Done in the cloud copy, 2026-10-29)
Laws villages and kingdoms keep (direction item 6b, the owner's ask), with their own design note.

- **Done:** nine laws as data (`civLaw`), each option with a mood value for the Mood phase:
  - work hours; rationing; schooling; conscription; hunting; forests; borders; tithe; justice;
  - `settlement.code`, with a 5-day wait between changes (the owner's answer 2);
  - kingdom laws from the capital (answer 3);
  - leanings by people and profile;
  - AI reviews by situation (answer 7);
  - relations drift with similar laws (answer 6);
  - the tithe as counted gift trades (answer 4);
  - every effect in distant villages too;
  - save format 32.
  - Design and results: `docs/proposals/civilization-laws.md`.
- **Acceptance:**
  - 229 tests pass; classic unchanged;
  - World 300 days: everything counted, save and load identical, laws spread and change with wars and want;
  - the law code costs nothing extra (the same speed as before with no laws); the slower late game (4.6
    against 3.3 ms/tick at day 300) is a more warlike world.
- **Carried over** (not done): militias make worlds more warlike (tune after play); Mood (direction 6c) is
  next.

### Mood (Done in the cloud copy: built and tested, 2026-10-30; not yet playable)
Each person's mood from their thoughts (direction 6c), with its own design note: `docs/proposals/mood.md`
(the owner's answers there).
- **Built and tested:**
  - 20 thoughts as data and an hourly mood (full and distant villages alike);
  - the traits Cheerful and Gloomy;
  - work speed ×0.85–1.05; the birth chance ×0.75–1.25; breaks for the miserable;
  - unrest: AI villages repeal their most disliked law; the player gets warnings, never a forced law; a
    miserable family may move to a village of its own people with room; unhappy families found daughters
    first;
  - save format 33.
- **Acceptance:**
  - 236 tests pass;
  - World 300 days: everything counted, save and load identical; mood +8 to +19 on average, unrest in up to 4
    villages during wars;
  - 101 wars against 61 before (for Phase 11 to investigate).
- **Not playable yet:** the UI is not in the cloud copy (UI notes in `docs/ui-todo.md`).

**Status words for every phase from here on:**
- **planned:** a design note or roadmap entry;
- **built:** code merged on `cloud-work`;
- **tested:** suite, runs and bench recorded in `docs/cloud-baseline.md`;
- **playable:** checked with the real UI (only possible at home).
- Everything done in the cloud copy so far is built and tested, not yet playable.

### Phase 11: integration and reliability (the cloud part done, 2026-10-30; the build waits for home)
Results: `docs/proposals/phase-11-integration.md`. In short:
- the set-aside goods bug was reproduced and fixed;
- the integration contract is `docs/integration-contract.md`;
- baselines are recorded;
- wars come mostly from the faster feuds between peoples (×1.5), which halve without it;
- herds shrink mostly from winter and crowding, not hunting.

The plan as written:
Before more simulation complexity. Depends on: the home PC for the UI (back about 2026-11-08).
- **1. A playable build:** combine the cloud simulation with the real UI. The UI (`src/ui`, `index.html`) is
  not in the rescue copy, so the cloud part is an integration contract:
  - every UI-facing function and field the cloud phases added (from `docs/ui-todo.md`), with its module and
    signature;
  - the save formats 27–33;
  - what the UI must call (`setCivLaw`, `issueCommand('law' | 'trait' | 'shape', ...)`, `explainColonist(...).mood`).
  The build and its testing happen at home; nothing is claimed as tested before that.
- **2. A regression test for set-aside goods (missing mods):** a suspected bug, from reading the code
  (`game.js tryRestore`, `save.js`).
  - A map stack set aside on load keeps its village in the stack itself (`data.settlement`), but restoring
    sets the owner only from the outer `owner`, which only caravan goods carry. So an AI village's goods may
    come back as the player's or nobody's.
  - Fuel, buffers, ammunition and carried goods set aside from a village keep no owner at all.
  - First a test that reproduces it; then the fix.
- **3. Performance baselines:**
  - fixed seeds and sizes;
  - terrain-edit latency (a shaping stroke on Vast and World) and long ticks (the worst ticks and their
    causes);
  - war cost (fights in full-detail villages; `nearestEnemy`, `combatDecision`) and animal cost (herds,
    hunting), each measured on its own;
  - comparisons only within one session, as this machine's speed varies by about 35% between days.
- **4. Investigate war frequency and hunting limits:**
  - why mixed worlds see twice the wars (feuds between peoples, militias);
  - why distant villages hunt so little (one hunter a village an hour).
  - Report first; balance changes only with the owner, never to pass a benchmark.
- **Acceptance:** reproducible test results, a clear UI and integration status, and the remaining defects and
  performance limits written down.
- **Not in it:** a replacement UI; balance changes; new simulation features.

### Phase 12: connected world chronicle (cloud part done)
Builds on the existing log (`s.log`, letters, `g.log` keys). Depends on: Phase 11. Design and the owner's answers:
[docs/proposals/phase-12-chronicle.md](proposals/phase-12-chronicle.md).
- **Status (2026-10-30):** slices 1–3 built and tested: event ids, 26 kinds as data, 29 milestone lines,
  retention with yearly summaries, save format 34; cause links where the game holds the cause (associations
  labelled "followed"); filters, chains, jump targets, follow and favourites (saved), world-news notifications.
  Slice 4 accepted: a World run finds and prints a real 4-step chain, saves and loads identically, plays the
  same as before the phase and sends 281 notifications in 200 days across 64 villages. Not playable: the UI is
  on the home PC (`docs/ui-todo.md`).
- **Events:** stable ids, simulation time, the villages, people, place and category, and cause links only
  where the simulation knows them.
  - Examples: a law passed for a recorded reason ("few trees left near"), a war declared by rivalry, a tithe,
    a trade refused by closed borders.
- **Chains:** shown only from recorded links (e.g. forest depletion → protection law → timber shortage →
  trade dispute → war). Associations without a recorded link are labelled "followed", never "caused".
- **Filters:** village, person or family where known, kingdom, category, time. Follow and favourite
  controls, and a jump from an event to its subject or place (UI notes).
- **Bounded storage:**
  - milestones kept;
  - routine events summarised as they age;
  - a fixed cap with a save-size check on the World run;
  - duplicate notifications merged (the log's existing keys).
- **Acceptance:** one real chain is understandable in the UI, survives save and load, and does not flood the
  player.
- **Not in it:** a second event system next to the log; invented causes.

### Phase 13: need-driven prayers and petitions (cloud part done)
Design note and results: [docs/proposals/phase-13-petitions.md](proposals/phase-13-petitions.md). Built and tested
(2026-10-31): four kinds (hunger, drought, monster, lost woods), answered by bless, rain, banish or the forest
brush, with caps, cooldowns and chronicle links; save format 35. Not playable: the UI is on the home PC.
The first slice of worship. The rescue copy holds only the roadmap line "worship and favour coming from
villages" (Later, below). A fuller worship plan, if one exists at home, is linked and its open questions left
to the owner. Depends on: Phase 12 (petitions are chronicle events) and Mood.
- **Petitions from real conditions:**
  - hunger (food days), water shortage, monster danger, environmental damage (forest loss, drought);
  - each a small data type tied to an existing power the player can answer with (rain, bless, banish,
    shaping, peaceful animals).
- **Shown:** who asks, the evidence (the numbers behind it), the urgency, and when it expires or stops
  mattering.
- **The player** answers with a power, dismisses or ignores it. No quest playstyle, no free goods, no
  arbitrary rewards: answers act through the simulation as usual.
- **Limits:** cooldowns, de-duplication, and a cap by population.
- **Acceptance:** petitions arise from real conditions, resolve sensibly when things change, and persist
  through save and load without spam.
- **Not in it:** a full religion, favour income from villages, temples.

### Phase 14: intervention follow-through (cloud part done)
Design and results: [docs/proposals/phase-14-follow-through.md](proposals/phase-14-follow-through.md). Built and
tested (2026-10-31): outcome cards 3 days after a power (before → after per village, labelled "changes that
followed"), linked to the power and the prayers it answered; save format 36. Not playable: the UI is at home.
Builds on the existing power previews and results (`s.god.log`). Depends on: Phase 12; links to Phase 13.
- **Each power's result records:**
  - the region affected;
  - the immediate effects (what apply returned);
  - a few before-and-after measures already available (food days, casualties, migration, forest cover).
- **An outcome card** after a configurable interval: what changed, split into "recorded consequences" (what
  the power did) and "changes that followed" (no causal claim).
- **No alternate-outcome claims:** there is no counterfactual simulation, and none is added.
- **Links** to the chronicle and to any petition it answered.
- **Acceptance:** the player understands the immediate result and the later changes, with no misleading
  claims and little tracking cost.
- **Not in it:** counterfactual runs; per-tile history.

### Phase 15: village memories and traditions (planned)
Builds on Mood, Peoples and traits, and Civilization laws. Depends on: Phases 12 and 14 (memories cite
events) and Mood done.
- **Memories:** a few data types of meaningful experiences: survived a famine, defeated a monster, received
  aid, endured a disaster. Each has a description, a duration and decay, stacking limits and modest
  transparent effects (e.g. a mood thought, a law leaning).
- **Traditions:** these emerge from repeated or exceptional memories, so villages of one people can grow
  different identities. They show why they exist and link to their events.
- **Bounded:** no runaway bonuses or penalties (caps on effects and on the number held). Deterministic across
  save and load.
- **Acceptance:** two villages develop different histories and traditions for understandable reasons, with
  bounded effects.
- **Not in it:** a religion system; duplicates of inherited traits.

### Phase 16: playtesting and balance (planned)
Depends on: Phase 11's playable build (home), and Phases 12–15.
- **Play the features together:**
  - can players follow events, find interventions worth making, and see results without micromanaging?
  - long runs, save and load, deleted or destroyed subjects, expired petitions, repeated interventions,
    event retention, missing-mod recovery.
- **Performance** against the Phase 11 baselines, with regressions reported honestly.
- **A short tutorial or hints** for the new controls in the existing UI style.
- **Not in it:** new systems.

### Phase 9: livestock, clothing and the settlement plan
Cows, pigs and sheep with enclosures and care; wool and leather clothing chains; a settlement plan
(reserved road corridors, plots, farmland, expansion space) replacing nearest-good-spot site choice, with
reasons.

### Later: god powers, part 4 (terrain and weather), then worship
Once weather exists: terrain brushes (raise and lower land, dig water, plant forest) and weather powers
(rain, drought, storms). Later still: worship and favour coming from villages. (2026-10-28: the terrain brushes
are done, see "World shaping"; rain and drought came with Phase 5b. 2026-10-29: Phase 13 is the first slice
of worship, prayers and petitions from real needs.)

### Phase 10: leftovers, then review
Families (partnerships, old age, more professions), contraband selling policy, scripting API for mods, zip
mod packages. Then a review of the Ideas parking lot before anything else is planned.

---

# Detailed notes from earlier work
The sections below are the earlier, more detailed plans and records, kept as they were. Each title says
which phase above continues it.

## Neighbours and diplomacy (continues in Phase 2)
- Several AI villages on the same map, using the same needs, costs, research and production rules as the player's village, with different priorities and personalities, and no free resources.
- Contact; neutral, friendly and hostile relations; physically delivered resource trades with conserved transfers.
- Visible causes for relationship changes (trades, gifts, shortages, disputed land, broken agreements); treaties and alliances added step by step.
- Hostile villages fight (combat stage 1, below). Friendly and neutral villages never do.
- **Done (first slice):** an AI village founded from data and running on the same rules; territory; contact; relations with recorded causes; physically delivered, ledger-conserved trades; the player's trade policy (see README).
- **Done (second slice):** player-proposed trades, gifts and requests with the neighbour's answer and relationship effects shown before sending; calling off a trade with a visible, fair cost; goods promised in any trade are held for its delivery.
- **Done (third slice):** trade pacts, the first treaty: conditions, effects and costs shown before signing; they lapse without trade or when relations sour.
- **Done (fifth slice):** territory disputes: gathering rights across the border (requested by AI villages or the player, granted, refused or revoked), with border disputes as a recorded, capped relationship cause.
- **Done:** AI deals bundle up to 3 goods and 3 kinds of payment.
- **Done:** multi-item offers (up to 4 items per side, one delivery leg per item).
- **Done (fourth slice):** AI villages propose pacts to the player (accept/decline in the panel) and sign them with each other.
- **Done (Phase 2 slice 1):** alliances (see Phase 2 above).
- **Done (Phase 2 slice 2):** villages founded during play (see Phase 2 above).
- **Done (Phase 2 slice 3):** kingdoms (see Phase 2 above).
- **Done (Phase 2 slice 4):** markets (see Phase 2 above).

## Electric production chain (continues in Phase 3)
Research electricity → materials → generator → connected powered workshop → a useful item made faster than by hand. Generation, fuel, connections, demand and shortages; safe pauses without losing ingredients or progress; colonists refuel and maintain; a power overlay with outage explanations.
- **Done (slice 1, materials):** the Industrialization era now has technologies: charcoal burning (kiln yard, wood → charcoal), smelting (smithy with a bloomery, stone + charcoal → iron) and ironworking (iron axes and pickaxes). The colony builds and runs the chain on demand, re-equips its workers and stops when nothing more is needed.
- **Done (slice 2, electricity):** Electric-era techs Electricity (steam generator, power poles) and Machine tools (powered machine workbench). The colony builds a power house, lays pole lines, keeps the generator fuelled (wood or charcoal), and makes iron tools about 3× faster on the machine. Fuel burns only while a machine is in use; shortages slow machines; outages pause them without losing ingredients or progress; a power overlay and the inspector explain supply, demand, fuel and outages.
- **Done (slice 3):** wear, routine servicing and breakdowns with repair for generators and machines.
- **Done (Phase 3 slice 2):** a sawmill, planks, machine parts and gun parts on a machine (see Phase 3 above).
- **Done (Phase 3 slice 3):** machine and generator counts sized to demand (see Phase 3 above).
- **Still open in Phase 3:** power storage, sizing, factories and abstract production.
- **Done (visibility):** the Colony panel explains why each machine is or isn't built: the research chain down to era milestones, Off fields and research waiting for materials; demand; generator; fuel; materials traced to their cause; space.
- **Factory work still to do:** factories larger than one machine (multiroom workshops with delivery areas); more powered machines and recipes (sawmill, machine-made parts, gun parts); production lines feeding each other; a planner that sizes machine count to demand; power storage. In a long autonomous run (seed 4242 with an "Advance to Modern" goal) the colony reaches the Electrification era by day 18, then waits on Electricity for 17+ days because it has mined out all the stone on its land and smelting needs stone; fixed: Quarrying (a fallback stone source used only when no boulders are left) and automatic gathering-rights requests to neighbours; the same run now reaches the Modern era on day 36.

## Health groundwork (done; death and illness in Phase 5)
Injuries and conditions with causes (starvation, exhaustion, work accidents per work type), slower work when hurt, bed rest, collapse and care by other colonists (feeding and tending). **Still planned:** illness and its spread, medicine and a doctor's station, permanent injuries, and death (with combat).

## Utilities and daily life (continues in Phase 4)
- **Done (slice 1, water):** a Water need; drinking from lake shores (untreated, small illness risk) and wells (clean); wells dug by the colony itself, urgently where there is no surface water; dehydration and care.
- **Done (slice 2, lighting):** after dark (21:00–05:00) work on unlit tiles runs at 80%; cooking fires (radius 4) and lanterns (3) light their surroundings; Electric lighting (after Electricity) lets the colony put up electric lamps (radius 6) beside unlit workplaces and the stockpile, build a generator for them if needed and wire them up; lamps draw power only after dark and go out without it. `light: { radius }` on buildings.
- **Done (slice 3, running water):** Plumbing (after Electricity): an electric pump (40 units an hour while powered, drawing power only while there is room), a water tower (150 units, saved), taps by the stockpile and each finished home, and pipes laid tile by tile along a free path to join them. Water networks are separate from power networks. Each drink at a tap takes one unit and is quicker than at a well; dry taps are skipped. The inspector shows storage, pumping, taps and network problems.
- **Done (slice 4, seasons and heating):** a 30-day year (spring start, about 22°C in mid-summer, −6°C in mid-winter, colder at night; `climate` in world data); rooms found from built walls and doors, each with a saved temperature that drifts toward the outdoors and is raised by heaters and, a little, by the people inside; hearths (Masonry, burning wood or charcoal from their own store) and electric heaters (Electric heating, power only while needed) in a home's decor spot; before winter the colony researches a heater if it has none, puts one in every home (rebuilding a lantern if no spot is free) and stocks hearths; sleeping below 5°C restores energy more slowly.
- **Done (slice 5, seasonal crops):** crops grow only while the season is warm enough (`minTemp`, full speed 3°C above it), hard frost (`frost`) kills unripe plants, nothing is sown that cannot ripen before frost, wild plants regrow slowly in winter, and a few days before the lean season the colony raises its food reserve to last until the next harvest.
- **Still planned:** animals affected by the seasons (Phase 8). Cooling and lighting inside rooms are in the Ideas parking lot.
Water (sources, pumping, storage, distribution, plumbing), then heating, cooling and lighting, with a real room and temperature model. A health model must come before any water-quality effects. Electricity and water stay separate networks. The UI shows coverage, consumption, failures and repair priorities.
*Note:* roofs are still visual; walls and doors decide what is a room.

## Medical care (first phase done; continues in Phase 5)
Doctors, rescue to medical beds, bandages and medicine from recipes, a medicine cabinet, wound infection and treatment, clinic and demand-built hospital ward, shortages in the UI. **Still planned:** contagious and environmental illness, surgery. (Trained doctors are done: the Doctor qualification.)

## Progression goals (done)
Era goals generated from milestone data, a building-count goal that counts completed buildings and avoids duplicates, pause/resume/remove, and Add Goal actions beside unmet milestones in the research panel. Settler milestones cannot be met autonomously yet (no arrivals or births).

## Government and civilization depth (Phase 6)
A village council and settlement policies that actually change decisions (food reserves, research priorities, trade, work allocation, public construction), with visible costs and reasons. Later: leadership, laws, public services and taxation, once an ownership and economic model exists.

## Building scale, roads and transport (Phase 7; multiroom interiors parked)
1. **Larger single-floor buildings:** multiroom homes, shared housing, warehouses, workshops and factories planned from population, storage and production demand. Built in stages without blocking entrances, with corridors and delivery areas. *Today:* homes come from a few fixed templates (with rotation and flexible slots); there is no free-form or multiroom architecture.
2. **Roads:** routes chosen from real travel demand, terrain, cost and benefit; built with labour and materials; never through buildings; cross-settlement roads respect ownership and diplomacy.
3. **Transport:** walking first (today), then horses and wagons, then manufactured vehicles via research. Each type has capacity, terrain limits, speed and upkeep. Vehicles are produced in factories (designs, components, assembly), never spawned. Cargo is tracked from loading to delivery without duplication, and everything survives save/load.
- Acceptance: a settlement identifies a transport need, builds infrastructure, makes or acquires transport through the economy, and delivers real goods to another settlement unassisted.

## Larger world and animals (Phases 1 and 8)
**Wildlife exists since Phase 8** (deer, wolves, wild horses, hunting and butchering; see Phase 8). Still open:
taming, horses as mounts, wagons, and drawing animals in the UI (`docs/ui-todo.md`).
1. A configurable, seeded world in regions or chunks, with lower-frequency updates for distant regions that never reset populations or history. Performance is measured before scaling up; a world map shows settlements and routes.
2. Deer ecology (habitat, food, movement, fear, reproduction, population caps) and a complete hunting chain: policy → equipment → travel → hunt (animal health, no instant inventory) → butcher → haul → kitchen. Sustainable hunting limits as a policy.
3. Horses: taming or acquisition, ownership, feeding, pasture or shelter, breeding.
4. Horse-drawn wagons integrated with trade.

## Livestock, clothing and deliberate town planning (Phase 9)
- **Livestock:** cows (milk while alive; meat and hides when butchered), pigs (meat and pigskin), sheep (renewable wool by shearing). Colonists build fences, gates, shelters and feeding areas and verify that enclosures are complete and reachable before bringing animals in. They lead, feed and care for animals, manage breeding and herd sizes, and keep breeding stock and feed reserves. Shearing never kills a sheep; milk and wool take time to replenish; butchering removes an animal exactly once.
- **Clothing chains:** shearing → wool → yarn/fabric → tailored clothing, and butchering cows *and* pigs → hides/pigskin → tanning → leather → leather clothing or equipment. Colonists build the workstations, craft garments and equip suitable clothing themselves. Species, yields, recipes, stations, garments and preferences are all moddable.
- **Settlement plan:** replaces today's nearest-good-spot site choice. It reserves road corridors, plots, farmland and expansion space, and scores sites by access, terrain, distances, services and neighbouring uses. It is shown visually, explaining why a site was chosen and what comes next.

## Optional contraband economy (selling policy in Phase 10)
**Stage 1 done (engine):** controlled goods, per-village laws, black-market prices, watch attention separate from relations, seizures, fines, closed trade, and risk previews in the offer dialog.
**Stage 2 done (optional mod `contraband`, off by default):** the five commodities, invented source plants, abstract recipes at two stations behind two technologies, production on the player's stock goals, village laws in core profiles, local markets in AI villages, safe saves when the mod is off.
**Still planned:** a player-side automatic selling policy for controlled goods; consumption/dependency effects only once a fuller health model exists. It waits until Phase 2 trade is stable and must not change existing gameplay.
- **Optional and moddable:** shipped as a separate mod that is off by default. Saves that contain its goods load safely when it is disabled: the goods are kept as unknown items, with a warning, rather than dropped or crashing the game.
- **Commodities (fictional, abstract production):** cannabis/weed, cocaine, heroin, meth and MDMA (one product each; no separate ecstasy or Molly entries). Production is only generic resource costs, workshop jobs, labour and timers, using invented crops and abstract recipes. There are no real manufacturing methods, chemical ingredients or extraction steps.
- **Economy:** colonists grow or gather inputs, build the workshops, process goods and store them for sale. Production follows player policy, stock limits and actual demand, never running endlessly.
- **Trade:** uses the existing physically delivered trade. Goods are loaded, carried and delivered, and cargo is conserved through interrupted trips and save/load.
- **Per-village legality:** each village permits, restricts or bans each product, which drives demand, prices, relations and trade agreements. Legal trade with one village is not illegal everywhere.
- **Two separate scores:**
  - *Diplomatic reputation:* the existing relations.
  - *Illicit-trade notoriety / enforcement attention:* raised by trading goods a village prohibits, with recorded reasons.
- **Consequences:** reduced trust, fines, confiscated cargo, or closed trade agreements. The UI shows likely consequences *before* the player picks a policy.
- **No consumption, dependency or health effects** until a health system exists.

## Firearms, equipment and combat (death in Phase 5)
**Stages 1 and 2 are done (melee, bows, orders, war and truce; firearms, gunsmithing, guard goals and the arms trade). Stage 3 (cover) is done. Death is still to come.** It must keep existing saves, autonomous behaviour, the full-browser layout and the current resource icons. It comes in small, separately tested stages:
1. **Health and damage first:** colonist health, injury, recovery and death or incapacitation. Combat needs these, and Phase 2 hostility stays relationship-only until they exist.
2. **Production and equipment:** **Done (stage 2):** pistol, shotgun, rifle and sniper rifle behind Gunsmithing, Rifling and Marksmanship; a gunsmithy (walled workshop with a gunsmith's bench) making generic gun parts, guns and three kinds of rounds from iron, wood and charcoal; weapons ranked by fighting power, with armed colonists trading up during a war; the goal "Arm N guards with a weapon"; "Keep N spare" works for guns; ammunition stocked for every ranged weapon. Equipment never appears in automatic deals.
   - Weapons: pistols, rifles, shotguns and sniper rifles, unlocked by research.
   - A gunsmith workshop that turns generic game components into weapons and ammunition through labour and abstract recipes, with no real-world manufacturing detail.
   - Colonists make weapons and ammunition on their own, reserve the materials, equip suitable defenders and restock supplies.
   - Goals such as "arm every guard" and "keep five rifles for trade".
   - Equipped weapons and defence reserves are never sold automatically.
3. **Arms trade:** **Done (stage 2):** guns and rounds are controlled goods (`core:arms`); each village's arms laws (Willowmere restricts them, Stonebrook allows them) apply to your offers, with attention, caps and seizures as for other controlled goods. Unused (full-condition) tools and weapons can now be offered; worn ones cannot.
   - Goes through the existing physical trade: cargo leaves the seller's stock and arrives before ownership and payment change hands.
   - Respects each village's arms laws and relationships.
4. **Combat:**
   - **Done (stage 1):** hostile targets only; weapon range, cooldown, accuracy and ammunition from mod data (`equipment.range/cooldown/accuracy/ammo`); line of sight blocked by walls and solid nodes; hits and misses; wounds through the health system; collapse and fleeing; ammunition pouches filled from the stockpile and spent through the ledger; Defend/Attack/Retreat orders; AI villages raid when they clearly outnumber a hostile neighbour, call raids off when losing, and sue for truces; an attack dialog that lists both sides' strength and every risk before war is declared; tracers, hit flashes and fight markers; save/load mid-fight. **Done (stage 3):** cover: walls (50%), other solid buildings and trees/rocks (30%) stop that share of ranged hits on someone right beside them on the shooter's side (half for diagonal shots); `cover` can be set on buildings and nodes; ranged fighters step up to 2 tiles to a covered spot that keeps range and a clear shot. **Still to do:** death.
   - Hostile targets, range, line of sight, ammunition use, firing cooldowns, damage, cover and retreat.
   - Colonists defend themselves and follow settlement-level defend, attack and retreat orders. There is no direct control of characters.
   - Friendly and neutral villagers are never targeted by default.
   - The UI shows the risks of an attack order *before* it changes peaceful relations, with readable targeting and hit feedback.
- **Distinct roles:** each weapon has a distinct gameplay role. Weapon stats, ammunition, recipes, research and trade restrictions are all mod data.
- **Tests:** crafting, equipping, running out of ammunition, blocked shots, protection of friendly targets, physical trade, and save/load during combat.

## Families, schools and professions (first phase done; the rest in Phase 10)
**Done:** life stages (infant, child, adult) and ages; births in households with spare beds, food and room under the population cap; infant care; children's work limits; schools built when there are children; teaching by anyone (faster with a Teacher); Basic schooling; qualifications (Teacher, Doctor, Industrial specialist) that speed up work but are never required, earned by practice or at a college built only for staff shortages.
**Still planned:** partnerships and relationships beyond parents, family housing preferences, old age, more professions and a wider college curriculum.

## Other technical items (Phases 1 and 10)
- A scripting API for behaviour mods. Today, data mods can only compose registered behaviours; uploaded JavaScript is never run.
- Zip mod packages and mod-supplied image icons for imported (browser) mods.
- Path caching for much larger maps: Phase 1 made `findPath` about 3× faster; a path cache and the
  coarse-route corridor (parked) move to Phase 7.

---

# Ideas parking lot
Ideas kept for later. None of these belongs to a phase yet; they are reviewed together after Phase 10.
- **Cooling** (air conditioning and cold storage, using the room temperature model).
- **Lighting inside rooms** (once roofs are real and rooms can be dark).
- **Multiroom building interiors** (free-form homes and workshops with corridors and several rooms).
- **Multiple races** (peoples with their own needs, looks and preferences).
- **Environmental state** (fire, freezing and thawing, flooding), from the civic-planning roadmap: needs a
  conservation and update-order design first.
- **Contact between distant villages** (user, 2026-10-23; **moved into Phase 2b; built in slice 5**). Far-apart villages never meet (every pair "Not
  met"), which starves alliances, markets and trade (only 7 of 81 trades in a 30-village run went through a
  market). Ways to make contact: scouts that travel further, traders and travellers between villages,
  kingdoms whose borders touch, news passed on by a village that has met both. Suggested home: a short
  Phase 2 follow-up right after Phase 3, because alliances, kingdoms and markets already depend on it; Phase 7
  (roads and transport) can later make the journeys faster and visible.
- **Organic territory borders** (user, 2026-10-23; **moved into Phase 2b; built in slice 4**). Borders are drawn as straight-edged blocks because
  territory is "nearest village centre". Wanted: borders that follow terrain (rivers, mountains, coast) and
  grow outward from villages over time, WorldBox-style, in the world view. Note: a UI-only version would
  draw borders that disagree with the real land rules (who may build and gather where), so the honest
  version changes the territory rule in the sim too (claimed tiles that grow and stop at terrain), with the
  drawing following it. Suggested home: Phase 7, together with roads, or a Phase 2 follow-up with contact.
- **Tree planting / forestry** (from the Phase 2b acceptance, 2026-10-24). In long Vast-world runs the trees
  near old villages run out, and wood is not sold at markets. Villages could plant and tend trees on their own
  land (and wood could be traded at markets) so wood stays renewable.
