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

### 2. God powers — constructive
Bless, inspire, heal, and simple “protect” or “speed” powers.  
Preview + confirm. Deterministic, ledgered as `"divine"`.

*Why:* gives the player the god fantasy early, without waiting for full destruction systems.

### 3. War, death, and collapse
Death, illness, more frequent wars between rivals.  
Villages and kingdoms can be destroyed or absorbed. Ruins stay on the map. Clear war indicators.

*Why:* adds stakes and drama before large destructive powers.

### 4. God powers — destructive and nature
Lightning, fire (spreads through forest and wooden buildings), meteor, plague, earthquake, tornado, rain (puts out fire, grows plants), drought.  
Each with preview and confirm (destructive ones warn).

### 5. Animals and wild threats
Herds, predators, hunting.  
Then spawning animals with god powers.  
Then original wild monsters that attack villages.

### 6. World shaping + blank start
Terrain brushes (raise/lower land, dig water, make mountains, plant forest, place stone and ore).  
Blank world scenario: shape the planet first, then place the first people.

### 7. Peoples, traits, and world laws
3–4 original peoples with their own looks, needs, preferences, temperament, and building styles.  
Inheritable individual traits (brave, greedy, wise, sickly, …) that change behaviour.  
Peoples can be spawned with god powers.  
World laws toggled during play (no wars, no aging, fast growth, endless plague, peaceful animals, etc.).

### 8. Scale and performance
Thousands of people world-wide by day 300 on the World preset.  
Measure, then plan the performance work needed. Refine LOD as required.

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

*Last reorganized: 2026-11-01. Direction updates from 2026-10-23 and 2026-10-24 are incorporated into the priority order above.*
