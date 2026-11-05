# Roadmap

What is built is described in the [README](../README.md). This page is the plan.  
Nothing is in the game unless it is marked **Done**.

## Direction

MadColony is an original god-and-colony simulation. The player is the overseer of one settlement *and* a god of a living world.

- Zoomed out: a large procedural map of many autonomous villages and kingdoms that grow, trade, ally, fight, expand, and fall. Territory follows the land. The world should read clearly as a living map.
- Zoomed in: every settler is a real person with needs, jobs, health, family, and a readable reason for everything they do.
- The world starts almost empty. A few small settlements begin far apart, grow, and eventually meet.
- God powers are deterministic world commands stored with their tick. Anything they create goes through the ledger as source `"divine"`. Every power shows a preview; destructive powers warn first.
- Original game in the same genre as WorldBox and The Universim. Never a copy of names, art, UI layout, races, or signature creatures.

## Rules for every phase

- Zero dependencies and procedural art.
- Determinism across save/load.
- Item conservation (ledger + census).
- Simulation and UI stay separate.
- Old saves keep loading (`src/sim/migrate.js` with version bump + old-save test).
- Content as data.
- Every system must work for 30+ villages (state per-tick cost and distant-village behaviour).
- Full autonomy with visible reasons.
- Never weaken a test.
- Long runs never hang silently (time budget, progress every 10 s, background for >2 min, only one heavy run at a time).

Plans are saved (save format 7+). See `src/sim/plancodec.js`.

**How a phase runs:** design note in `docs/proposals/<phase>.md` → small tested slices → full tests + 40-day headless run + seed 4242 “Advance to Modern” + `tools/bench.js` (explain or fix >10% regression) → before/after screenshots → update README and this roadmap.

---

## Completed

### Phase 0: close out half-built work — **Done**
Civic intents phase 2 merged. Leftovers placed. See `docs/proposals/phase-0-close-out.md`.

### Phase 1: big-world foundation — **Done**
Huge (384×288) and Colossal (544×408) worlds, biomes, compact saves, level-of-detail simulation, world view, village summary, Living world scenario, villages near water, faster pathfinding, warm caches, Overseer UI.  
60-day Colossal acceptance run met targets.  
See `docs/proposals/phase-1-big-world.md` and `docs/PERFORMANCE.md`.

Path cache and coarse-route corridor parked for later (Phase 7 / roads).

### Phase 1b: sound — **Done**
Procedural Web Audio sound and music. Zoom-aware mixing. Master/music/effects sliders + mute.  
See `docs/proposals/phase-1b-sound.md`.  
Still open: real-browser listening, death cue (waits for Phase 5), founding bells for villages founded during play.

### Phase 2: neighbours, diplomacy and kingdoms — **Done**
Alliances, villages founded during play, kingdoms, markets with supply-and-demand prices, letters rework, hover-card field registry.  
Save formats 6–9.  
See `docs/proposals/phase-2-kingdoms.md`.

### Phase 2b: the vast world — **Done**
Planet worlds (Vast and World presets), the default 7-settlement start, organic territory, contact over distance,
civilization spreading to 64 villages. See `docs/proposals/phase-2b-vast-world.md`.

### Phase 2c: god powers, part 1 — **Done**
God tab and power bar, spawn settlers, bless, inspire; validated commands with favour costs. See
`docs/proposals/phase-2c-god-powers.md` (home).

---

## Current priorities (WorldBox-feel first)

These come before the older Phase 3 / Phase 4 work.

### 1. Visual clarity and feedback — **Next**
Make the zoomed-out world and close-up settlement read instantly.
- Clearer biome textures and terrain shading.
- Better settlement pixels, territory borders, roads, and flags.
- Higher-resolution procedural silhouettes for people and buildings (simple walk/idle frames).
- Stronger visual feedback for work, hauling, building, injuries, and status.

*Why first:* everything that follows is easier to evaluate and more satisfying once the world looks alive.
*Cloud copy:* UI work, so home work. What the UI must show for everything the cloud copy built is in `docs/ui-todo.md`; the planned replacement UI is Phase 17 below.

### 2. God powers — constructive
Bless, inspire, heal, and simple “protect” or “speed” powers.  
Preview + confirm. Deterministic, ledgered as `"divine"`.

*Why:* gives the player the god fantasy early, without waiting for full destruction systems.
*Cloud copy:* bless and inspire exist (Phase 2c). Heal, protect and speed are not built.

### 3. War, death, and collapse
Death, illness, more frequent wars between rivals.  
Villages and kingdoms can be destroyed or absorbed. Ruins stay on the map. Clear war indicators.

*Why:* adds stakes and drama before large destructive powers.
*Cloud copy:* engine built and tested (Phase 5: death, illness, burial, lost wars, ruins; Phase 6: government and rebellion). See `docs/proposals/phase-5-death-and-collapse.md`, `phase-6-government.md`. War indicators are UI (home).

### 4. God powers — destructive and nature
Lightning, fire (spreads through forest and wooden buildings), meteor, plague, earthquake, tornado, rain (puts out fire, grows plants), drought.  
Each with preview and confirm (destructive ones warn).
*Cloud copy:* engine built and tested for all of them (Phase 5b), with previews and warnings as data for the UI. See `docs/proposals/phase-5b-destructive-powers.md`.

### 5. Animals and wild threats
Herds, predators, hunting.  
Then spawning animals with god powers.  
Then original wild monsters that attack villages.
*Cloud copy:* engine built and tested: wildlife and hunting (Phase 8), spawning animals (8b), wild monsters (8c), livestock and pens (Phase 9). See `docs/proposals/phase-8-animals.md`, `phase-8b-animal-powers.md`, `phase-8c-wild-monsters.md`, `phase-9-livestock.md`.

### 6. World shaping + blank start
Terrain brushes (raise/lower land, dig water, make mountains, plant forest, place stone and ore).  
Blank world scenario: shape the planet first, then place the first people.
*Cloud copy:* engine built and tested, including the Blank world. See `docs/proposals/world-shaping.md`.

### 7. Peoples, traits, and world laws
3–4 original peoples with their own looks, needs, preferences, temperament, and building styles.  
Inheritable individual traits (brave, greedy, wise, sickly, …) that change behaviour.  
Peoples can be spawned with god powers.  
World laws toggled during play (no wars, no aging, fast growth, endless plague, peaceful animals, etc.).
*Cloud copy:* engine built and tested: peoples and traits, world laws, and the owner's civilization laws and mood. See `docs/proposals/phase-peoples-and-traits.md`, `world-laws.md`, `civilization-laws.md`, `mood.md`.

### 8. Scale and performance
Thousands of people world-wide by day 300 on the World preset.  
Measure, then plan the performance work needed. Refine LOD as required.
*Cloud copy:* measured in `docs/proposals/scale-target.md`: speed allows about 2,850 people near 1×; growth is the limit (about 300–360 people by day 300), so reaching thousands is the owner's decision (kept off). Phase 18 slices 1–2 spread the daily and hourly peaks (below).

---

## Built in the cloud copy (2026-10-24 to 2026-11-05)

The engine work below was built and tested in the cloud rescue copy (`src/sim`, `mods/`, `tests/cloud-*.test.js`)
and is merged home as patches. **None of it is playable yet:** the UI is at home, and `docs/ui-todo.md` lists what
it must show. The proposed new baselines are in `docs/cloud-baseline.md` and wait for the owner's review.

- **Phase 3, electric production:** slices 1–3 done before; power storage (batteries) exists. Slices 5–6 wait
  for the design note at home.
- **Phase 4, utilities:** reviewed; heating and water are cheap at scale. `docs/proposals/phase-4-utilities-review.md`.
- **Phase 5, death, illness and the end of combat; 5b, destructive powers:** see Current priorities 3 and 4.
- **Phase 6, government:** leaders and succession, councils, rebellion. `docs/proposals/phase-6-government.md`.
- **Phase 7, roads and transport:** roads, caravans on roads, handcarts. `docs/proposals/phase-7-roads.md`.
- **Phases 8, 8b, 8c; world shaping; peoples and traits; world laws; civilization laws; mood:** see Current
  priorities 5–7.
- **Phase 9, livestock, clothing and the settlement plan:** taming, pens, wool and leather coats, cold storage,
  sites chosen with reasons. `docs/proposals/phase-9-livestock.md`.
- **Phase 10, leftovers:** partners and family housing, four professions by practice, selling policy.
  `docs/proposals/phase-10-leftovers.md`. **Owner decision, 2026-11-04:** mods stay data-only for now (no
  scripting API; new behaviours are added to the engine as registered givers and needs that data mods can use).
- **Forestry:** villages short of trees plant groves. `docs/proposals/forestry.md`.
- **Cold storage:** goods spoil slower at or below 8 °C (`spoil.js`). Air conditioning is still open.
- **Phases 11–15:** integration and reliability, the chronicle, petitions, intervention follow-through, village
  memories and traditions (cloud parts). `docs/proposals/phase-11-integration.md` to `phase-15-memories.md`.
- **Phase 16:** balance notes from long runs in `docs/proposals/phase-16-balance-notes.md`; the playtest needs
  the home build.
- **Phase 18, slices 1–2:** the daily and hourly peaks spread. `docs/proposals/phase-18-sim-plan.md`.
- **Save formats** up to 45, each with a migration step; old saves load.

---

## Later

After the priorities above:

- Phase 3 and Phase 4 (paused while the WorldBox-feel work is first).
- Path cache / coarse routes (revisit with roads).
- Weather (beyond current wind/cold).
- Worship, favour, and deeper god systems.
- Anything remaining in the Ideas parking lot that still fits the direction.

---

## Ideas parking lot

(Keep short. Move items into a numbered phase when they become next.)

- Multiple cultures / deeper culture systems
- Family and schooling expansions
- More civic intents
- Advanced trade and caravans
- Religion / belief systems (after basic god powers)

---

### Phase 16: playtesting and balance (planned; cloud balance notes 2026-11-04)
Cloud copy: balance changes and findings from the long runs in `docs/proposals/phase-16-balance-notes.md`; the
playtest itself needs the home build.
Depends on: Phase 11's playable build (home), and Phases 12–15.
- **Play the features together:**
  - can players follow events, find interventions worth making, and see results without micromanaging?
  - long runs, save and load, deleted or destroyed subjects, expired petitions, repeated interventions,
    event retention, missing-mod recovery.
- **Performance** against the Phase 11 baselines, with regressions reported honestly.
- **A short tutorial or hints** for the new controls in the existing UI style.
- **Not in it:** new systems.


## Appended queue: new world UI and deep performance work (owner, 2026-11-01)

**Status: planned only.** These phases are appended after the entire existing queue; no earlier phase,
priority, acceptance result or parking-lot entry is replaced or reordered. This entry authorizes planning,
not implementation or a merge to main. Work already underway under the scale target keeps its place:
reconcile these phases with `docs/proposals/scale-target.md` and `docs/proposals/spread-the-peaks.md` at
implementation time, credit completed work, and do not build a second scheduler or duplicate UI.

### Phase 17: replacement world-focused UI (planned)
A new, better interface for the living-world god simulator, retaining access to the existing game's depth.
Design note first, then small reviewed slices; use the real home UI as a comparison, not an assumption that
the rescue copy's missing UI means it never existed.

- **Preserve and compare:** back up the complete home project (including untracked/ignored work) and export
  browser saves separately. Inventory the home UI's working controls, accessibility and workflows before
  replacing anything. Preserve the owner's already-approved icon sizes and positions unless the owner
  explicitly changes them; document deliberate changes, never silently lose existing functionality.
- **World first:** a large world canvas with smooth zoom from the planet to a person, readable settlements,
  kingdoms and events; compact god-power controls with costs, targeting, previews, cancellation and clear
  destructive-action confirmation. Panels should support observation without covering the world.
- **Inspect and understand:** select people, creatures and villages; show needs, mood and its reasons,
  relationships, laws, memories and traditions, with links to the recorded events behind them. Keep the
  existing colony, production, research, diplomacy, mod and save workflows accessible.
- **Act on real events:** petitions and a filterable chronicle with follow/favourites and jump-to-location
  or subject; show missing/destroyed subjects gracefully. Link a power's immediate result to its later
  outcome card, distinguishing recorded effects from changes that merely followed.
- **Integration contract:** reconcile `docs/ui-todo.md` and `docs/integration-contract.md` with actual
  exports/state, including save formats after 33 (37 at this planning checkpoint). Update the contract to
  the implementation's current version, not a hard-coded historical version; keep sim and UI separate.
- **Acceptance:** a feature-parity checklist against the home UI; before/after screenshots at the existing
  supported desktop/narrow sizes and high DPI; keyboard/focus and readable-text checks; no console errors.
  Check repeated clicks, cancel/back, expired petitions, removed subjects, and save/load while panels or
  power previews are open. The owner reviews the new layout before the old UI is retired.
- **Not claimed:** playable, faster, approved visual design or implemented by this roadmap entry.

### Phase 18: deep simulation and rendering optimization (planned)
Cloud copy, 2026-11-04: a simulation-side plan from measurements on the grown world, in
`docs/proposals/phase-18-sim-plan.md`. On the owner's "finish the rest of the phases", slices 1–2 are built:
hourly jobs at their own ticks, distant groves by village hour, rebellion relations indexed. The hour's first tick
mean fell from 40 to 15 ms, the day start's p95 from 97 to 54 ms. Steady-state p95 is about 20 ms, still above
16.7 (flagged). The browser baseline matrix and rendering are home work.
Profile first; optimize real bottlenecks without hiding work or reducing the game's depth. Establish a
reproducible baseline on the target home hardware/browser before choosing implementation slices, and
measure the new UI throughout Phase 17 rather than postponing all performance checks to the end.

- **Baseline matrix:** fixed commits, seeds, saves, hardware/browser, viewport/DPI and speed settings;
  classic runs plus Vast/World at early, middle and late ages, quiet and war-heavy worlds, near/far zoom,
  busy inspectors, chronicle/petitions, and repeated terrain strokes. Include naturally grown day-300
  worlds with accumulated buildings/history as well as separately labelled synthetic population loads.
- **Measure honestly:** tick and frame time p50/p95/p99/max, achieved simulation ticks per second at each
  requested speed, daily/hourly spikes, input-to-feedback and terrain-edit latency, memory, save size and
  save/load time. Profile sim, rendering and UI separately and together; record warm-up/start-up separately.
  Use repeated same-session before/after runs, progress output and the existing long-run time budgets.
- **Known reference points, not new measurements:** the November 1 scale notes report a grown world of
  868 people/62 villages at 9.2 ms/tick with 240–400 ms day-start ticks; synthetic 2,859 people at 17.6 ms/tick
  against a 16.7 ms 1× budget. Terrain shaping previously cost about 0.6–1.2 seconds. Rebaseline these cases
  on the same machine before comparing; never treat the synthetic case as grown-world acceptance.
- **Spread daily/hourly work:** finish or reuse the scale-target scheduler design rather than duplicate it.
  Preserve exactly-once daily/hourly semantics, stable ordering, deterministic iteration and explicit
  catch-up behavior. Specify when each job reads its inputs and how delayed work affects gameplay; do not
  claim an order-changing scheduler preserves old hashes. Record intentional behavior changes and new
  baselines only after review. Do not enable faster growth merely to mask an unmet hitch target.
- **Targeted improvements:** profile entity/ownership queries, spatial lookups, cache invalidation and
  expensive world passes; investigate incremental terrain/water updates. For rendering/UI, measure culling,
  level-of-detail drawing, cached layers, text/icon work, panel updates and event-list virtualization.
  Rendering shortcuts must not alter authoritative simulation, conservation or the recorded world history.
- **Acceptance gates (planned targets):** first reproduce the baseline, then reduce grown-world daily/hourly
  p95/p99 spike cost by at least 50% on the same workload and hardware, with no worse maximum. Target
  steady-state tick p95 at or below the existing 16.7 ms 1× budget; explicitly flag workloads that miss it.
  Target combined browser frame p95 <= 16.7 ms and p99 <= 33.3 ms at 1× on the agreed reference machine,
  not separate budgets that each consume the whole frame. Allocate sim/render/UI shares from the profile.
  Terrain-stroke p95 end-to-end latency should fall by at least 50% from its measured baseline, with
  immediate targeting/feedback at p95 <= 100 ms; do not report early feedback as completed terrain work.
  Publish absolute results and maxima alongside percentages. Any target revision requires an explained,
  reviewed trade-off, not a silent redefinition of success.
- **No fake speedups:** no disabling mood, wars, animals, petitions, history or conservation checks; no
  smaller worlds, capped-away people, dropped jobs, changed seeds or slower simulated time presented as
  equivalent speed gains. Any approximation or changed game rule needs a separate explicit decision.
  Fix or explain/review regressions above the existing 10% guardrail in unaffected baseline cases.

### Phase 19: integrated acceptance and safe promotion (planned; cloud assessment 2026-11-04)
Cloud copy: PR #1 assessed in `docs/proposals/phase-19-promotion-assessment.md`. Do not merge it as it stands: the
home build, the home tests and the baselines come first. (Main's reorganized roadmap was merged in on 2026-11-05.)
Prove the replacement UI and optimized simulation work together before retiring the old build or changing
main. This is a final gate for Phases 17–18, not a claim that Phase 16 or earlier integration is complete.

- **Safe integration:** inspect the actual home checkout, remotes, branch and ancestry; preserve unpushed
  work and create a separate integration branch from the complete home version. If the rescue repository
  has unrelated history, review/import its delta from the rescue baseline rather than blindly forcing an
  unrelated-history merge. Never replace the home folder with the incomplete rescue snapshot.
- **Reliability:** run the full applicable home and cloud suites, conservation checks, classic runs and
  representative long worlds. Verify old-save migrations, missing-mod recovery and ownership, deterministic
  command replay and identical save/load continuation. Specifically save/reload halfway through staggered
  daily/hourly work and around boundaries; prove no skipped or duplicated jobs and correct cache rebuilds.
- **Real play:** exercise world navigation, inspections, powers, destructive confirms/cancel, petitions,
  chronicle links and outcomes with repeated/interrupted flows, destroyed subjects and large histories.
  Verify new and old saves on the integrated UI; compare against the preserved home build.
- **Performance sign-off:** publish Phase 18's baseline matrix and percentile/maximum results for both
  naturally grown and synthetic scale, including render/UI costs and failed targets. A lower average alone
  is not acceptance; visible stalls and latency must be reported.
- **Promotion:** provide the reviewed diff, feature-parity checklist, test results, performance report,
  remaining limitations and rollback path. Only after owner review and explicit approval push/open the
  appropriate draft PR and merge into the intended main; assess existing PR #1 rather than blindly merging
  it or discarding it. Keep the old UI/backup available until the replacement passes acceptance.

---

*Last reorganized: 2026-11-01. Direction updates from 2026-10-23 and 2026-10-24 are incorporated into the priority order above. Merged with the cloud copy's roadmap on 2026-11-05: main's structure kept, the cloud results and the owner's Phases 16–19 added.*
