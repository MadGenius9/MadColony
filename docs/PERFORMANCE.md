# World sizes and performance

New colonies can be Small (72×52, 3,744 tiles, the original map), Medium (128×96, 12,288 tiles) or Large
(192×144, 27,648 tiles). The size is chosen in **New colony**, passed to world generation and saved with the
game (`state.worldSize`). It applies to new worlds only: a saved colony keeps the map it was made with.
Huge (384×288) and Colossal (544×408) were added in Phase 1; see "Big worlds and level of detail" below.
Vast (1536×1152) and World (2048×1536) planets were added in Phase 2b slice 2; see "Planet worlds" at the end.
There are no infinite worlds.

## Measurements (2026-10-22, Windows 11, Node 24, `node tools/bench.js`)

Simulation only (no drawing), seed 7, "neighbouring village" scenario. One tick is 1/100 of a game hour;
the browser runs 60 ticks a second at 1× speed, so "realtime at 1×" is the share of one CPU core the
simulation needs at normal speed.

| Size | Villages | Days | ms per tick (avg) | slowest tick | realtime at 1× | save | load |
|---|---|---|---|---|---|---|---|
| Small 72×52 | 2 | 1 | 0.18 | 60 ms | ~1% | 141 KB | 5 ms |
| Medium 128×96 | 2 | 1 | 0.32 | 38 ms | ~2% | 358 KB | 8 ms |
| Large 192×144 | 2 | 1 | 0.75 | 106 ms | ~5% | 746 KB | 35 ms |
| Small | 4 | 4 | 0.20 | 53 ms | ~1% | 187 KB | 7 ms |
| Medium | 4 | 6 | 0.82 | 129 ms | ~5% | 409 KB | 20 ms |
| Large | 4 | 6 | 1.55 | 205 ms | ~9% | 799 KB | 42 ms |

The slowest tick is usually the very first one (warm-up); after it, spikes of 20–30 ms on Large come from
rebuilding the walkable-region map after construction (up to ~10 ms each) and long path searches.

Before this work Large ran at 1.81 ms per tick (2 villages, 1 day). Changes that brought it to 0.75 ms:
- job search skips kinds of resource that nothing wants before checking each node (was 21% of the time);
- the walkable-region rebuild reads each tile's passability once instead of up to five times;
- the planner's "is this resource reachable" check looks only at nodes of the wanted kinds;
- room detection reads walls from one pass over the buildings;
- path searches reuse their buffers instead of allocating three map-sized arrays per search.

**Drawing** (browser, approximate — measured with the browser pane in the background):
- normal zoom: about 8 ms (Small, Medium), about 15 ms (Large) per frame;
- fully zoomed out: about 22 ms (Small), 37 ms (Medium), 18 ms (Large);
- the cached terrain image is built once per world (0.2 s Small, 0.5 s Medium, 1 s Large).
  Its resolution is lowered on bigger maps so it stays under about 16 million pixels
  (Large was 7680×5760 before, about 177 MB; now 3840×2880).

**Trade and contact on big maps.** Villages are spaced with the map (the square root of its area). On Large,
neighbours used never to meet; settlements now send a scout toward a neighbour they have not met
(at most every two days). With that, every pair met within a few days in all runs above. Automatic trade
only happens when a settlement lacks something: on Large maps villages usually have every resource on
their own land, so automatic trade is rare. Player offers are carried across the map normally (tested).

**Storage.** Browser saves use localStorage (about 5 MB per site). A Large save is about 0.8 MB, so the
autosave plus a few manual Large saves fit, but many Large saves will not; export to a file for more.

## Civic intents (2026-10-22)
Planner cost on the same saved game, 50 runs (`runPlanner`): Small 1.07 ms (was 1.23), Medium 1.32 ms (was
1.38), Large 1.47 ms (was 1.56) — faster because building counts are taken once per plan. Per tick (1 day,
2 villages): Small 0.19 ms, Medium 0.31 ms, Large 0.55 ms (was 0.81). The opening projects are now laid out
one per plan instead of all at once, so the first few planning ticks on Large cost 25–50 ms each (tick 1:
225 ms including warm-up, was 139 ms).

## Big worlds and level of detail (Phase 1, 2026-10-22)
Windows 11, Node 24 (same machine as above). Huge (384×288) and Colossal (544×408) worlds are new; on them
distant villages run at a lower level of detail (see the README).

Commands:
- `node tools/bench.js` for the classic sizes above.
- The Living world timing: `newGame({ seed: 7, scenario: 'core:living_world', size: 'colossal', villages: N })`
  run for 2 game days, N = 12 and 30.

| Living world, Colossal, seed 7 | ms per tick (avg) | worst tick after warm-up | warm-up worst (tick 2) | save at day 2 |
|---|---|---|---|---|
| 12 villages | 0.46 | 21–28 ms | 61 ms | ~0.73 MB |
| 30 villages | 0.88 | 21–28 ms | 133 ms | ~1.08 MB |

- Heap about 29 MB; load about 95 ms.
- Before level of detail, 30 villages cost 29.6 ms per tick in the first game hour, then 8.0 ms after earlier
  Phase 1 work (still without level of detail).
- Save size: a Colossal world at day 0 was 5.3 MB; with save format 4 (compact terrain and nodes) it is
  469 KB.
- Targets from the design note: ≤ 1.5 ms (12 villages), ≤ 2.5 ms (30), worst tick ≤ 50 ms after warm-up,
  heap ≤ 300 MB, save ≤ 3 MB at day 60, load ≤ 1 s. The 60-day run is below.

## Phase 1 acceptance: 60 days on Colossal (2026-10-22)
Same machine (Windows 11, Node 24). Living world, Colossal, seed 7, run for 60 game days by the verifier,
each village count in a separate process: `newGame({ seed: 7, scenario: 'core:living_world', size:
'colossal', villages: N })`, N = 12 and 30, with a conservation check every 5 days and a save at day 30
loaded in a fresh process and run on to day 60.

| Living world, Colossal, seed 7, 60 days | 12 villages | 30 villages | target |
|---|---|---|---|
| ms per tick (avg) | 0.371 | 0.961 | ≤ 1.5 / ≤ 2.5 |
| worst tick after warm-up | 34.5 ms | 29.9 ms | ≤ 50 ms |
| heap | 26.6 / 34.2 / 35.1 MB (days 0/30/60) | 27.2 → 36.0 MB (day 0 → 60) | ≤ 300 MB |
| save at day 60 | 0.902 MB | 1.440 MB | ≤ 3 MB |
| load | 101–130 ms (before warm caches) | | ≤ 1 s |

- Conservation: no errors at any 5-day check. The day-30 save, loaded in a fresh process, gave the same
  run at days 31, 35, 40, 50 and 60; the day-60 state was byte-identical.
- Warm-up: ticks 1–2 of a brand-new game take 47–131 ms (first job picks and first replans).
- On seed 7 all AI villages stayed at the distant level (none within 64 tiles). With two AI villages held
  at full detail for 10 days: 12 villages 0.49 ms per tick (worst after tick 2: 12.8 ms); 30 villages
  1.07 ms (worst 20.8 ms).
- **Warm caches** (big worlds build their derived caches at creation and load), Colossal day-30 save: the
  worst tick after loading went from 63–81 ms to under 1 ms; load went from about 110–125 ms to about
  245–263 ms.

## Long paths (Phase 1 slice 2, 2026-10-22)
Same machine. `findPath` time per long trip, before → after the speed-up (identical routes):

| World | average | worst |
|---|---|---|
| Huge 384×288 | 11.8 → 3.8 ms | 68 → 16 ms |
| Colossal 544×408 | 18.8 → 6.1 ms | 88 → 26 ms |

A coarse-route corridor (coarse region graph, then tile A* inside a corridor of chunks) was also measured:
on open continents it cut only 1–7% of the expanded tiles and made region rebuilds 20–80% slower. It was
parked on branch `phase1-path-corridor-experiment`.

**World view drawing** (headless Chrome): `draw()` about 0.1 ms fully zoomed out on Colossal, 7–11 ms in the
cross-fade band, where both views are drawn. Not yet measured in a normal browser window.

## Sound (Phase 1b, 2026-10-22)
Same machine (Windows 11). Sound is UI only; the simulation is unchanged, and simulation runs are identical
to before.
- `sound.update` (called every frame; plans about 8 times a second): about 0.02 ms per frame. The browser
  readout `madcolony.perfStats().sound` records it over the last 240 frames.
- One plan (`planSounds`) on Colossal with 30 villages: about 0.48 ms, at about 8 plans a second.
- How measured: `sound.update` per frame in headless Edge (Colossal Living world, 12 villages, 240 frames, sound on vs. update stubbed out, `madcolony.perfStats()`); planning cost in Node: `newGame({ seed: 7, scenario: 'core:living_world', size: 'colossal', villages: 30 })`, one game day, then `planSounds` 400 times with the camera centred on the player at zoom 1.6 in a 1600×900 view (a tick every 4 plans; the average includes those ticks, so the plan alone costs less).

## Alliances (Phase 2 slice 1, 2026-10-22)
Same machine (Windows 11). Alliances run once a day inside the existing diplomacy pass, and war joins only
when a war starts; nothing new runs every tick.
- `node tools/bench.js`: within −1% to +2.6% of `main`.
- Living world, Colossal, 30 villages, 10 days: 0.81–0.83 ms per tick (`main`: 0.81–0.85).
- `npm run sim -- 40 --log` and the seed 4242 "Advance to Modern" run: identical to `main` except the save
  format number.
- No war happened in these runs, so the cost of allies joining a war was not measured.

## Villages founded during play (Phase 2 slice 2, 2026-10-22)
Same machine (Windows 11, Node 24), but **partly loaded by another process** during these runs, so the
absolute numbers are higher than on a quiet machine. "Before" is the code before slice 2, measured under the
same load. Founding runs once a day (at most one site search and one founding a day world-wide); nothing new
runs every tick. The slice also added per-settlement ownership indexes and cached structure lists.

Commands: `newGame({ seed: 7, scenario: 'core:living_world', size: 'colossal', villages: N })` run for 60
game days, N = 12 and 30, plus saves at days 10–50 loaded in the same process and in a fresh process; and
`node tools/bench.js`.

| Living world, Colossal, seed 7, 60 days | 12 villages | 30 villages | target |
|---|---|---|---|
| ms per tick (avg), slice 2 | 0.49–0.50 | 1.20–1.23 | ≤ 1.5 / ≤ 2.5; design note: 30 villages ≤ 1.057 |
| ms per tick (avg), before, same load | 0.69 | 1.85 | |
| save at day 60 | 1.49 MB | 2.73 MB | ≤ 3 MB |
| load | 0.50–0.66 s | | ≤ 1 s |
| heap | ≤ 40 MB | ≤ 40 MB | ≤ 300 MB |

- Villages founded during play (settlement counts include the player's): 12 AI villages, 13 → 17
  settlements by day 60 (4 founded, on days 25, 39, 45 and 49); 30 AI villages, 31 → 38 (7 founded, on days
  27, 28, 34, 37, 38, 39 and 61, i.e. tick 144000, the end of day 60). The code before slice 2 founds none
  (13 → 13, 31 → 31), so it ran with fewer villages than the slice 2 code.
- Saving at days 10–50 gives the same day-60 state as never saving, with 12 and 30 villages.
- Save files are larger than in the Phase 1 acceptance run (0.90 / 1.44 MB at day 60), most likely because
  there are more villages by day 60 and save format 7 stores the plans (the plans alone add 2–8% in the bench).
- **Worst ticks:** 50–83 ms in some runs, but 7–15 ms when the same run was repeated alone, most likely the
  machine load. One spike is repeatable: about 46–50 ms at tick 53459 (12 villages), the planner's site
  search (`findSite`) for a Lecture hall. That is older code, not founding, and it is still open. The code
  before slice 2 has repeatable spikes of 64–66 ms.
- **Design-note target missed on this machine:** "30 villages within 10% of 0.961 ms per tick" means
  ≤ 1.057 ms. The slice measured 1.20–1.23 ms under load, where the older code measured 1.85 ms (and 1.00 ms
  earlier on a quiet machine). The Phase 1 target of ≤ 2.5 ms is met. A quiet-machine re-measure is open.
- `node tools/bench.js`: 8–22% faster than before in every row; save sizes +2–8% (the stored plans).

## Kingdoms (Phase 2 slice 3, 2026-10-22)
Same machine (Windows 11), fairly quiet during these runs. Kingdoms run once a day (only when a
kingdom exists) and on forming, joining and leaving; nothing new runs every tick. Command:
`newGame({ seed: 7, scenario: 'core:living_world', size: 'colossal', villages: N })` for 60 game days, slice 3
against the code before it (`150998d`), same conditions.
- ms per tick (avg): 12 villages 0.45 vs 0.45; 30 villages 1.09 vs 1.09 (within about 1%).
- The design-note target for 30 villages (≤ 1.057 ms) is still missed, by both the slice and the code before
  it, so the gap is not from kingdoms.
- Not measured: the time to rebuild the kingdom-coloured world overlay on Colossal.

## Markets (Phase 2 slice 4, 2026-10-22)
Same machine (Windows 11). Markets update once a day (only once a market exists); a trade evaluation looks
up its market in O(markets). Nothing new runs every tick. Command:
`newGame({ seed: 7, scenario: 'core:living_world', size: 'colossal', villages: 30 })` for 60 game days, slice
4 (`9039eb7`) against the code before it, three runs each, each run alone on the machine.
- ms per tick (avg): 1.28–1.29 against 1.08–1.10 (+17–19%).
- The two worlds differ: 39 against 38 settlements and 81 against 68 trades by day 60. A profile put the
  market code at 0.2% of CPU, so the extra time comes from the busier world, not the market code. A deeper
  profile is still open.
- Still well under the Phase 1 target of 2.5 ms per tick. The design-note target (≤ 1.057 ms) was already
  missed before this slice.
- `node tools/bench.js` (classic sizes, no markets): within ±4% of the code before the slice in every row.

## Hover-card fields (Phase 2 slice 5, 2026-10-22)
UI only (`src/ui/hoverfields.js`); the simulation is unchanged, so there are no new tick-time numbers. No
frame-cost measurement of the hover card was made for this slice.

## End of Phase 2 (2026-10-22)
No separate end-of-phase run: each slice was measured against the code before it (sections above).
- Living world, Colossal, seed 7, 30 villages, 60 days: the latest measurement is 1.28–1.29 ms per tick
  (slice 4). The Phase 1 target of ≤ 2.5 ms is met; the design-note target of ≤ 1.057 ms is not.
- Open: the repeatable ~46–50 ms `findSite` tick (Lecture hall), and a deeper profile of the +17–19% in the
  market world.

## Power and water networks (Phase 3 slice 1, 2026-10-22)
Windows 11, slice 1 (`2abb346`) against the code before it. Networks are now built per settlement in O(nodes)
and cached until that settlement's structures change. World: a 30-village Living world with the electric,
plumbing, heating and lighting techs forced, run for 30 game days. The exact script, size, seed and machine
load were not reported.
- ms per tick (avg): 2.041 → 1.342 (−34%).
- `networks()`: nothing changed 32.7 → 0.11 ms; after a pole completes 68.5 → 0.27 ms; full rebuild 71.9 →
  2.85 ms.
- Profile (inclusive): bills giver 19.6 s → 0.56 s; `machineBusy` 4.08 s → 0.21 s.
- Runs are unchanged (same hashes), so the normal Living world without forced techs has few powered
  structures; no separate tick-time number for it was reported for this slice.

## More machines and recipes (Phase 3 slice 2, 2026-10-23)
Slice 2 (`47c62d9`): planks, machine parts and the sawmill. No tick timings or `node tools/bench.js` numbers
were reported for this slice. Run outcomes (not timings):
- `npm run sim -- 40 --log`: identical to before except one research log line (Joinery).
- Seed 4242 "Advance to Modern" run: the colony now builds a generator, machine workbench and sawmill
  (days 43.3, 48.3, 51.8), so this run now has powered work; before, it built nothing powered. Save/load
  continues identically; conservation clean.
- Living world (Colossal, seed 7): not re-run after the slice's last fixes.

## Machine and generator sizing (Phase 3 slice 3, 2026-10-23)
Slice 3 (`564dec7`). No tick timings or `node tools/bench.js` numbers were reported for this slice. Sizing
adds per-plan work only: O(bills + colonists + building kinds × recipes) for machines, and one
`settlementLoad` sample (O(colonists + powered buildings + networks)) for generators, nothing cached. Run
outcomes (not timings):
- Identical to slice 2 (`47c62d9`): `npm run sim -- 40 --log`, the seed 4242 Modern run, the power-forced
  seed 141 run, the power-forced 30-village Living world and the 12-village Living world.
- Busy scenario (seed 141, electric techs forced, goals of 60 machine parts and 60 planks): 2nd machine
  workbench built day 13.62, 2nd generator day 17.37; save/load identical; conservation clean.

## Known limits
- Spikes of 20–30 ms on Large (region rebuilds, long path searches) can drop a frame.
- A repeatable ~46–50 ms tick from the planner's site search for a Lecture hall (Living world, Colossal,
  seed 7, 12 villages); see "Villages founded during play".
- Zoomed out on Medium, drawing everything visible costs about 37 ms per frame (classic view; Huge and
  Colossal use the world view when zoomed out).
- The camera is limited to the map edges (checked on Large). The minimap (bottom-right) shows the whole
  world; its frame cost has not been recorded here.
- No path caching (the corridor experiment is parked, see "Long paths"). Since Phase 2b slice 1 regions are
  joined on a coarse chunk graph, but paths do not use it. On classic
  sizes the whole map is simulated every tick; on Huge and Colossal distant villages are simulated hourly.

## Vast worlds: measurements before Phase 2b (2026-10-23)
Node 24, this machine (other agents' runs were active, so timings are ranges), Living world, seed 7, 10 AI
villages, code at Phase 3 slice 3 with no changes; larger maps were requested by adding entries to
`WORLD_SIZES` at runtime in a scratch script. Load above 1000 tiles was measured with the save size limit
raised in a scratch copy: in the real code no map wider or taller than 1000 tiles loads (`save.js:58`).

| Size | Tiles | Nodes | Create | of which worldgen | Heap | Per tile | Save | Load | ms/tick (1 day) | Worst tick |
|---|---|---|---|---|---|---|---|---|---|---|
| 544×408 (Colossal) | 0.22M | 30k | 0.7–0.9 s | 0.35 s | 24 MB | ~159 B | 0.6 MB | 0.26 s | 0.31–0.51 | 56–80 ms |
| 1024×768 | 0.79M | 107k | 2.2–3.5 s | 1.1 s | 80 MB | ~152 B | 1.8 MB | 1.8 s | 0.81–1.21 | 116–151 ms |
| 1536×1152 | 1.77M | 238k | 8.5–12 s | 3 s | 174 MB | ~148 B | 3.9 MB | 4.0 s | 1.18–1.55 | 198–313 ms |
| 2048×1536 | 3.15M | 424k | 17–31 s | 9–11 s | 315 MB | ~150 B | 7.1 MB | 7.5 s | 1.25–2.53 | 340–550 ms |

Hotspots at 2048×1536: worldgen pass carving (4.1 s, quadratic in land pockets), `toQuantiles` sorts (2.6 s),
`rebuildIndexes` (2–2.5 s), the water-walk Dijkstra (2 s), `spreadSites` (3.4 s); per tick, the whole-map
region union-find after every node or structure change (233 a day, ~10.5 ms each when quiet), the first
`emptyNodes()` (200–550 ms) and `nodesByDefChange` copying 100k-entry lists (12–39 ms). Village count barely
changes creation time; map area drives it. The plan to fix these is `docs/proposals/phase-2b-vast-world.md`.

## Vast worlds: after Phase 2b slice 1 (2026-10-23)
Slice 1 (`1ea7399`, typed per-tile storage, incremental regions, faster indexes and worldgen, windowed A*,
map limit 4096). Node, this machine, shared with other agents' runs. Living world, seed 7, 10 AI villages,
1 game day; larger maps requested through `WORLD_SIZES` entries added at runtime, as before. "Before" is the
code at `e7ef0d0`, measured the same way in this round (so it differs from the table above).
Command: `node <scratchpad>\measure-vast\measure.mjs W H [villages] [days] [skipSave]` (a session scratch
script, not in the repo; it adds the `WORLD_SIZES` keys at runtime).

| | 544×408 | 1536×1152 | 2048×1536 |
|---|---|---|---|
| Worldgen | 510 → 277 ms | 3962 → 1747 ms | 11250 → 2935 ms |
| Create | 0.95 → 0.70 s | 11.4 → 3.8 s | 34.5 → 7.3 s |
| Game memory per tile | 136 → 72 B | 125 → 59 B | 125 → 60 B |
| Save time | 83 → 61 ms | 1157 → 678 ms | 2203 → 1326 ms |
| Load | 396 → 225 ms | refused → 1834 ms | refused → 3769 ms |
| ms/tick | 0.67 → 0.42 | 1.56 → 0.55 | 2.58 → 0.75 |
| Worst tick | 58.9 → 62.3 ms | 367 → 74 ms | 507 → 104 ms |
| Ticks over 16 ms | 9 → 2 | 35 → 4 | 89 → 9 |
| Region rebuild, each | 0.54 → 0.31 ms | 4.24 → 0.60 ms | 6.34 → 1.24–1.57 ms |

- Save size is unchanged (the format is still 9). In the browser, saves are now gzip-compressed in
  IndexedDB: a Colossal day-0 save goes from 632 KB to 114 KB (about 18%).
- "Refused" means the old code rejected maps over 1000 tiles on load.
- Target of at most 70 B per tile: met at 1536 and 2048, not at 544 (72 B).
- **Still open:** worst ticks of about 100 ms at 2048, mostly GC (`heat.js` copies a 12 MB `roomAt` array
  on wall changes); load takes 3.8 s at 2048. Creation time in a browser has not been measured.
- A hand-made 4096×4096 save needs several hundred MB to load.

## Planet worlds: Phase 2b slice 2 (2026-10-23)
Slice 2 (`d85a309`): the `core:planet` generator and the Vast and World presets. Node v24.22.0, this
machine, about 21% busy with other work. Living world, seed 7, 10 AI villages, 1 game day, on the real
presets (no runtime `WORLD_SIZES` entries needed now). Command:
`NOGEN=1 node --expose-gc <scratchpad>\sim-2b2\measure.mjs vast|world 7 1` (a session scratch script, not
in the repo).

| | Vast 1536×1152 | World 2048×1536 |
|---|---|---|
| Worldgen | 0.97–1.0 s | 1.64–1.68 s |
| Create | 1.8 s | 3.2 s |
| Load | 0.7 s | 2.4 s |
| Game memory per tile | 44.4 B | 43.4 B |
| Save, raw / gzipped | 1,609 KB / 316 KB | 2,745 KB / 535 KB |
| Nodes | about 84k | about 149k |
| ms/tick | 0.53 | 0.62 |
| Worst tick after warm-up | 22 ms | 38 ms |

- Peak memory while generating: about 51 B per tile at World.
- Tick 0 takes 110–134 ms.
- Fewer nodes than the continent generator (424k at 2048×1536 before slice 1): node density is capped at
  0.05 per tile (`nodeBudget` in `planet.json`).
- Against the targets: at most 70 B per tile, met; worst tick ≤ 50 ms after warm-up, met in this 1-day run.
  Browser times are not measured; the estimate for World is about 4.8 s to create and 3.6 s to load.
- Decision: World ships as the top preset.

## The vast-world scenario: Phase 2b slice 3 (2026-10-23)
Slice 3 (`e843618`): scenario `core:vast_world` with placement `far`. This machine, busy with other agents'
work. The exact commands were not recorded in the report given to the docs keeper.

**Headless, World, seeds 1–10, 6 AI villages:**
- 6 villages placed on every seed; closest pair 184–280 tiles; 4–6 biomes per world; one landmass.
- 0.21–1.3 ms/tick.
- Save/load continues identically.
- Asking for 8: World places 8 on most seeds (6 on seed 2, 7 on seed 5); Vast 8 on most (7 on seed 3, 6 on
  seed 6). Small to Colossal place 0 (the spacing does not fit).

**Browser (headless Edge), World:**

| | Time | Target |
|---|---|---|
| Generate a new World | about 5.7–5.9 s | under ~10 s: met |
| Import a 2.79 MB World save | about 7.9 s | under ~5 s: not met (open) |

- Both run behind the "Generating the world…" / "Loading the colony…" overlay on the main thread (no Web
  Worker).

## Organic territory: Phase 2b slice 4 (2026-10-23)
Slice 4 (`95dd79d`): organic territory in `core:vast_world` (`src/sim/territory.js`). This machine; the
machine load and the exact commands were not recorded in the report given to the docs keeper.

**Cost of the claims:**

| | Measured |
|---|---|
| Per tick | nothing |
| Daily growth, 7 villages | 0.06–0.56 ms |
| Daily growth, 40 villages | about 1 ms |
| Rebuild at load (in `warmCaches`) | about 125 ms |
| Memory (organic games only) | 4 B per tile; 12.6 MB at World |
| Claims in the save | about 2.2 KB of a 2.97 MB save; 51 KB with 40 villages |

**Drawing:** the territory overlay is repainted only in the box that changed (`Game.claimsDirtySince`). The
frame spike once a game day went from 61–130 ms to at most 14 ms.

**Headless, World, seed 7, 100 days:**

| Day | 30 | 50 | 75 | 100 |
|---|---|---|---|---|
| Villages | 8 | 13 | 20 | 30 |
| Villages before the founding fix | 8 | 14 | 20 | 25 |

- Before the founding fix there were 3 long "no free site" stalls.
- Land per village at day 100: 180–3019 tiles.
- 0.37–0.93 ms/tick.
- Worst ticks 178–238 ms. They do not come from this slice; still open (target ≤ 50 ms).
- A save at day 50 continues identically to day 100. Conservation clean.
- `npm test`: 645 tests.
- **Still open:** `ensureStructurePixels` re-uploads the full-map structure image every 30 frames.

## Contact over distance: Phase 2b slice 5 (2026-10-23)
Slice 5 (`cff79cb`): explorers, traders and border contact in `core:vast_world` (`src/sim/contact.js`). This
machine; the machine load and the exact commands were not recorded in the report given to the docs keeper.

**Cost:**

| | Measured |
|---|---|
| Contact (explorers, traders, schedules) | about 1.4 µs per tick |
| `activeTrades` / `planTrades`, days 90–96 | 3.17 → 1.21 ms/tick (finished trades no longer rescanned) |

**Headless, World, seed 7, 100 days:**

| Day | 10 | 30 | 100 |
|---|---|---|---|
| Villages | 7 | 7 | 31 |
| Pairs met | 0 of 21 | 4 of 21 | 267 of 465 |
| Player's structures | 101 | 157 | 263 |

- Pairs met at day 100: 40 by explorers, 227 at a founding, 0 by borders.
- 0.65 ms/tick on average over 100 days; about 1.45 ms/tick at days 90–100.
- Trades: 1,255 done, 17 expired, 27 active at day 100. Finished trades stay in the save (pruning not decided).
- Save/load continues identically. Conservation clean.
- `npm test`: 675 tests.

## Urgent needs while walking (commit `3420ce2`, 2026-10-23)
All games. Classic pinned runs unchanged. Vast world, World, seed 7, 30 days: the player's village built 190
(was 157), 0 collapses. The machine load and the exact command were not recorded in the report given to the
docs keeper.

## Civilization spreads: Phase 2b slice 6 (2026-10-23)
Slice 6 (`b17fdd4`): founding, outward sites, market and trade reach, trade pruning, era drive. Node, this
machine; the machine load and the exact command were not recorded in the report given to the docs keeper.
`tools/world-report.mjs` (added in `9045b47`) runs the same world headless
(`node tools/world-report.mjs --seed 7 --days 300 --json`); whether these numbers came from it was not stated.

**Headless, World, seed 7, 300 days:**

| Day | 30 | 60 | 100 | 150 | 300 |
|---|---|---|---|---|---|
| Villages | 8 | 16 | 32 | 64 | 64 |
| Starting pairs met (of 21) | 11 | 18 | 18 | 19 | 20 |
| All pairs met | 15/28 | 101/120 | 440/496 | 1879/2016 | 1968/2016 |

| | Day 100 | Day 300 |
|---|---|---|
| Save, raw / gzipped | 4.89 MB / 784 KB | 9.53 MB / 1.24 MB |
| Player's village built | 281 (Modern) | 466 (flat from day 190) |

- Load: 1.7–2.6 s in Node. Heap: 60–76 MB.
- ms/tick: 0.22–0.44 (days 1–100), about 1.0 (days 101–150), 1.28–1.57 (days 201–300). Worst day averages
  1.94–2.29 ms. Before the slice's performance fixes: 12–38 ms/tick by day 180.
- Worst single ticks: 40–83 ms, from long A* searches. Open (target ≤ 50 ms).
- Eras at day 300: all starting villages Modern; of 64, 53 Modern, 9 Electric, 2 Industrialization.
- `npm test`: 726 tests.

## Trip budgets and the final Phase 2b run (commit `1808112`, 2026-10-24)
Node, this machine; the machine load was not reported to the docs keeper.

**Trip budgets** (opt-in `travel` rules, only the vast world), World, seed 7, 300 days, before → after:
- Health episodes 1167 → 0.
- The player's village reached the Modern era on day 96 → 92 (25 techs).
- World ms/tick about +9% (under the 10% rule). Worst tick 19–33 ms.
- Classic runs, the Living world and the seed 4242 run are identical. `npm test`: 772 of 772.
- The exact command for these before/after numbers was not reported to the docs keeper.

**Final world report** (`node tools/world-report.mjs`, `core:vast_world`, World, seed 7, 300 days; report
`docs/reports/world-report-2026-10-24-300d.html` and `.json`):
- 0.62 ms/tick on average over 300 days.
- Villages 7 → 64, people 24 → 347, 57 foundings, 7 kingdoms.
- Pairs met 17 at day 30, 1963 of 2016 at day 300. 0 wars. 5545 trades done, 30 expired.
- Conservation errors: 0.
- Earlier reports (history, before the fixes): `docs/reports/world-report-2026-10-23.json`,
  `docs/reports/world-report-2026-10-23-300d.html` / `.json`.

## Browser measurements

### 2026-10-23 — Phase 2b slice 7 (`d4d2a8b`, seeing the whole world)
Headless Edge, window 1600×900, this machine. Scenario: the vast world, World 2048×1536, seed 7, measured at
day 20 running at 30×. The exact command was not recorded in the report given to the docs keeper.

| Measurement | Result |
|---|---|
| World creation | 6.7 s |
| Drawing (`perfStats`): zoomed in / village zoom / whole world | avg 11.0 / 21.0 / 0.49 ms; max 14.2 / — / 1.1 ms |
| Real frame interval, zoomed in | avg 17.6 ms |
| JS heap | 178 MB |
| Console errors | 0 |

- Median direct draw before and after the slice is within noise. At village zoom it is about 19 ms in both;
  that is the older close-up chunk drawing, still open.
- Save/load and sound were not measured in this run.
- Verifier (Node): `node tools/bench.js` within noise of the previous commit; the 40-day run and the seed
  4242 run are byte-identical.
- Screenshots: `docs/screenshots/phase2b-world-labels.png`, `phase2b-village-borders.png`,
  `phase2b-travellers.png`.

### 2026-10-23 — playtest of 3420ce2 (Phase 2b slices 1–5)
Chromium 156 (Playwright, headless), window 1600×900, this machine (other agents' Node runs active).
Scenario: the vast world (New colony default), World 2048×1536, seed 7, 7 settlements; served from a clean
`git archive` of 3420ce2. Ran at 30× from day 0 to about day 30 (≈ 2.5 game days per 10 s of real time).

| Measurement | Result |
|---|---|
| World creation (Start click → first frame after the overlay) | 3.7 s |
| Save (Menu → Save, until the slot is listed) | 0.34 s |
| Load (Load click → first frame after the overlay) | 3.9 s |
| Drawing only (`perfStats`, 240 frames): one settler / one village / whole world | avg 4.3 / 7.6 / 0.9 ms; worst 9.2 / 61.8 / 6.6 ms |
| Real frame interval at 30× (rAF, 240 frames): zoomed in / whole world | avg 18.0 / 7.9 ms; p95 21.1 / 7.2 ms; worst 174 / 153 ms |
| JS heap (`usedJSHeapSize`) | 231 MB after 15 days; 368 MB right after a load (old game not yet collected) |
| Console errors / warnings | 0 / 0 |
| Sound | AudioContext running after a click; mute and the music slider change and persist (`madcolony.sound.v1`); live voices 9–15 over 60 s (no growth) |

The worst real frames (150–175 ms) come from simulation ticks at 30×, not drawing. Load is 3.9 s (target
≤ 5 s met in this run; an earlier 2.8 MB file import took 7.9 s). Screenshots:
`docs/screenshots/playtest-2026-10-23-settler.png`, `-village.png`, `-world.png`.
Problems seen: the player's buildings stall with repeated "Finishing this … now would seal off an area"
(furniture in unfinished buildings), a colonist named "Elin 150578", the "Kingdom of Highwatch" label
overlapping a village label when zoomed out, territory borders not visible at village/world zoom, the
stockpile label unreadable at village zoom.

### 2026-10-24 — Phase 2b slice 8 (f5b1fab)
Headless Edge 155.0.4283.62 (Chromium 155), driven over the DevTools protocol by a zero-dependency script;
window 1600×900, this machine. Served from a clean `git archive f5b1fab` on its own port. Scenario: the vast
world (New colony default), World 2048×1536, seed 7, 7 settlements. Three full runs; other agents' Node runs
were active during runs 1–3 (one CPU-bound process). Each run played 60.3 s of real time at 30×: from day 1
to day 16 (about 15.1 game days, 36 159 ticks). Saves were made at day 20, after the frame measurements.

| Measurement | Result |
|---|---|
| World creation (Start click → first frame after the overlay) | 3.79 / 4.63 / 3.77 s (target < ~10 s) |
| Save (Save click → "Saved" shown) | 304 / 279 / 284 ms; 3.01–3.03 MB raw, 577–579 KB stored (gzip, IndexedDB), day 20 |
| Load (Load click → first frame after the overlay) | f5b1fab, 9 samples: 4.43, 4.46, 4.65, 4.89, 4.95, 5.38, 5.43, 5.66, 5.77 s (median 4.95 s; 4 of 9 over 5 s). 3420ce2 with the same script on a quiet machine: 4.61, 4.65, 4.58 s |
| Load steps (typical) | reading 0.2 s, trial run ("Checking that it runs") 2.1–2.8 s, rebuilding 1.8–2.3 s, first frame 0.3–0.4 s |
| Real frame interval at 30×, fully zoomed out (rAF, 240 frames) | avg 7.93 / 6.94 / 8.63 ms; p95 7.2 / 7.1 / 8.6 ms; worst 152.8 / 7.5 / 138.2 ms (0–2 frames over 20 ms, from simulation ticks) |
| Drawing, fully zoomed out (`perfStats` draw) | avg 0.44 / 0.55 / 0.41 ms; worst 1.7 / 1.2 / 1.9 ms |
| Real frame interval at 30×, one settler (zoom 2) | avg 14.2 / 17.9 / 12.6 ms; p95 20.9 / 21.0 / 16.6 ms; worst 146 / 243 / 139 ms |
| Drawing, one settler (zoom 2) | avg 5.3 / 6.9 / 5.0 ms; worst 8.8 / 58.4 / 11.0 ms |
| Real frame interval at 30×, village zoom (0.5) | avg 26.3 / 33.1 / 33.4 ms (30–38 fps); drawing avg 11.0 / 13.7 / 14.1 ms |
| Paused (drawing only), zoomed out / one settler | rAF avg 6.95 / 6.94 / 7.72 ms; 12.4 / 7.2 / 16.0 ms |
| Zoom sweep, one settler → whole world (zoom 3 → 0.029) | draw 4–7 ms at zoom 3–0.9, 9–10 ms at 0.6–0.4, ≤ 1 ms at 0.25 and below |
| Labels by zoom | tiers detail (≥ 0.6), villages (0.4–0.06), far (≤ 0.05); placed village/kingdom label boxes overlapping: 0 at every step |
| Minimap | 220×165, drawn (188 colour buckets), a click moves the camera |
| JS heap (`usedJSHeapSize`) | 178–183 MB at day 20; after a load and a forced GC 284–290 MB (3420ce2: 171 → 292 MB, same; it does not grow over 3 loads) |
| Console errors / warnings | 0 / 0 (all runs) |
| Sound | AudioContext `running` after a click (null before); N mutes and unmutes; the music slider 0.35 → 0.15, stored in `madcolony.sound.v1`; live voices 1–11 over the 60 s, 7–9 at the end (no growth) |

- 60 fps fully zoomed out: met (headless rAF runs at about 144 Hz; the worst frames are simulation ticks).
- Load: no regression against 3420ce2 under the same conditions, but it is close to the 5 s target and
  over it in 4 of 9 samples. The trial run on a copy plus the rebuild take about 90% of the time.
- Screenshots (run 1): `docs/screenshots/playtest-2026-10-24-settler.png`, `-village.png`, `-world.png`.

### 2026-10-24 — faster World loads (`c2d4544`)
The load's trial run ("Checking that it runs") now runs in a Web Worker, and a leak after load is fixed.
Browser, World save; the browser, machine load and exact command were not reported to the docs keeper.

| Measurement | Before → after |
|---|---|
| Load, median | 3.8 → 2.7 s |
| JS heap after a load | 280 → 160 MB |

- The 3.8 s "before" is the commit's own measurement. The `f5b1fab` playtest above, on a busier machine, had
  a median of 4.95 s.
- Load target (≤ 5 s): met.

### 2026-10-24 — Phase 2c slice 5 playtest (`caf1373`, god powers)
Headless Edge 155, window 1600×900, this machine, using the playtest skill. Scenario: Living world, Huge,
seed 7. Two sessions: a normal game and a Sandbox game. The exact command line was not reported to the
docs keeper.

| Measurement | Result |
|---|---|
| UI frame while targeting a power (god mode) | avg 4.1 ms, p95 5.7 ms |
| UI frame without god mode | avg 4.0 ms, p95 5.3 ms |
| One preview (`previewCommand` for the hovered tile) | 0.1 ms |
| Save mid-game (with a blessing and a divine village) | 68 ms |
| Load of that save | 294 ms; blessing and divine village kept |
| Console errors / warnings | 0 / 0 (both sessions) |

- God mode adds about 0.1 ms to the average frame.
- Screenshots: `docs/screenshots/phase2c-god-tab.png`, `phase2c-spawn-preview.png`,
  `phase2c-divine-village.png`.
