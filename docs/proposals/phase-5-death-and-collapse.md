# Phase 5: death, illness, war and collapse

Status: **in progress** ("go" from the user on 2026-10-26). Slices 1a, 1b and 2 done; see "Results". Branch `cloud-work` (cloud rescue copy; see CLAUDE.md). Nothing in
this note is built yet.

## Goal (from the roadmap and the user)
- **Death** from wounds, starvation, dehydration, cold, illness and old age, with burial, mourning and
  inheritance (ROADMAP Phase 5).
- **Contagious illness** that spreads within villages and between them along trade routes; surgery; permanent
  injuries.
- **Wars can be lost:** abandoned ruins or absorption. Population growth and decline balanced over 100 days.
- **2026-10-24 direction:** wars happen more often between rivals; villages *and kingdoms* can be destroyed or
  absorbed; ruins stay on the map. WorldBox-style breadth and chaos, never a copy.
- Rules for every phase apply: determinism across save/load, conservation (items and people), sim/UI apart (UI
  notes in `docs/ui-todo.md`), old saves load, content as data, 30+ villages, full autonomy with visible reasons.

## What exists today (explorer map + measurements, 2026-10-25)
**Health** (`src/sim/health.js`, `medical.js`): injuries `{kind, severity, cause, tick}` on `c.health.injuries`;
hp = 100 − Σseverity; collapse at hp ≤ 15, up at 35. Ongoing conditions: malnutrition (2.5/h), dehydration
(3/h), exhaustion (1.5/h). Wounds from work accidents and combat, infection (can reach severity 100), an upset
stomach from lake water (`illness`, 3% per drink, the only illness). Doctors, bandages, herbal medicine,
clinics and hospital beds, rescue, treatment and tending exist. **hp can reach 0 and nobody dies.** No cold
injury (cold only slows sleep below 5 °C). No old age: adults never age past "adult"; starting adults are 20–45
(`ensureAdult`), and a year is 30 days.

**Distant villages** (`lod.js`): colonists keep their full records; `hourNeeds` calls `tickHealth` four times an
hour, so any health rule placed in `tickHealth` runs at both levels of detail. No accidents, rescue or tending
there; water is 1 when the village has water.

**War** (`combat.js`, `villages.js`): hostile at ≤ −25; AI raids need ≤ −50, ≥ 2 armed fit fighters and 1.5× the
target's; AI villages arm only once already hostile; only the player (`orderAttack`) ever declares war; quiet wars
cool +2 a day; AI villages sue for a truce only with the player. Distant villages never fight. **Measured, Vast
preset seed 7, 60 days: 7 → 18 villages, 27 → 70 people, 116 pairs met, the lowest relation in the world is 0,
and not one negative relation cause was recorded.** The Phase 2b 300-day World run had 0 wars. So wars need a
source of rivalry before anything else in this phase matters.

**Removing things:** nothing ever removes a colonist or a settlement. Many places name them (homes, beds, jobs,
reservations `patient:<id>`/`tend:<id>`, training, plans, ownership indexes; for settlements: relations,
treaties, alliances, proposals, rights, disputes, markets, kingdoms, claims `ids`, contact `v`/`t`, trades,
caravans, watch, military, blessings, owned entities), and `validateSave` rejects a save with a dangling id.
Founding (`founding.js` 536–559) is the model for moving people cleanly.

## Design decisions
1. **A dead colonist leaves `s.colonists`.** Their record moves to `s.dead[cid]` (name, settlement, cause, tick,
   parents, age), so families, logs and graves can still name them and names stay unique (`names.js` checks
   living and dead). Everything that names them is cleared the way founding clears founders. A test walks the
   whole state for a dead id after every death.
2. **A fallen settlement is never deleted.** It stays in `s.settlements` with `st.fallen = { tick, cause, by,
   fate: 'ruin' | 'absorbed' }`. Every id in saves stays valid, and the append-only claim and contact tables
   keep working. Fallen villages are skipped by the planner, founding, contact, markets, LOD, trade, diplomacy
   and the village cap (which counts living villages). A small `livingSettlements(g)` view replaces the
   `Object.keys(s.settlements)` loops where it matters.
3. **No new random numbers from the main stream** for the new daily chances (illness outbreaks, old age, war
   decisions, abstract battles). They use a hash of (seed, day, ids), as founding and contact do. So games
   where nothing of this happens draw exactly the same numbers as before.
4. **Health rules go into `tickHealth`.** Death, cold and illness then run identically for full and distant
   villages, with no second implementation.
5. **Opt-in by scenario where behaviour is new.** Illness outbreaks, rivalry, AI war declarations and falls
   are scenario blocks (`illness`, `war`) that only the Vast and Living worlds turn on. Death itself is for all
   games: a colonist at hp 0 dies everywhere (today hp 0 never happens in the classic pinned runs, and the
   checks will confirm it).
6. **People are conserved like items:** `start + born + spawned − died = living` (`peopleCensus` gets `died`).
   A dead colonist's goods never vanish: what they carried, their tool, weapon and ammunition drop where they
   died as stacks owned by their village (census unchanged, no ledger entry), and are hauled back as usual.

## Slices
Each slice is small, tested and verified before the next. Save format bumps are listed per slice.

### Slice 1: death, burial, mourning and inheritance (save format 15)
- **When someone dies:** at hp 0 while down for `deathAfterHours` (data, default 6 h, so rescue and care still
  have a chance); the cause is the injury with the highest severity ("died of their wounds", "starved",
  "died of thirst", "died of an infection"). Combat wounds that take hp to 0 count the same.
- **The body:** a `core:body` marker on the tile (state `s.bodies`, not an item), `burial` work type: carry it to
  a graveyard plot near the village (a small new building `core:grave`, wood cost, placed like a field) and bury
  it. Unburied bodies are buried where they lie after 3 days. Distant villages bury at once.
- **Mourning:** close family (partner by shared home, parents, children) gets a `grief` condition for 2 days:
  work ×0.85, no other effect (there is no mood system). Log line with the cause.
- **Inheritance:** goods drop as above; the bed and home place are freed; a dead parent's children stay in the
  home with the other parent or, if none, with the village (carers already look after infants); training and
  jobs naming the dead end with a reason.
- **People census and stats:** `s.stats.deaths` by cause; `peopleCensus` counts died.
- **A village with nobody left** becomes a ruin (decision 2), with the cause ("everyone died of hunger").
- Save format 15: `s.dead`, `s.bodies`, `st.fallen` (no-op migration; validated when present).
- Tests: each cause kills at hp 0 after the wait and not before; rescue in time prevents it; nothing names a
  dead id afterwards; conservation of items and people; save/load mid-burial continues identically; classic
  40-day and seed 4242 runs unchanged.

### Slice 2: cold and old age
- **Cold:** a `hypothermia` ongoing condition when a colonist's tile (room temperature indoors, outdoors
  otherwise) is below `coldBelow` (data, e.g. −2 °C) and they are asleep or idle outside a warm room; it heals
  once warm. Winter nights become a real threat to the homeless and to villages without heaters. Distant
  villages: from the home's room temperature, or the outdoors if homeless.
- **Old age:** an `elder` life stage after `elderAge` years (data) with slower work; from `deathAge` a daily
  chance of a peaceful death that rises each year (hash-based). **Timescale needs a decision** (see Open
  questions): with 30-day years and starting adults aged 20–45, old age only matters if the ages scale too.
- Tests: freezing kills a homeless sleeper in winter but not a housed one; elders appear and die at the
  configured ages; distant villages behave the same.

### Slice 3: contagious illness (save format 16)
- **Data type `illness`** (`mods/core/content/illness.json`): name, contagion within a village per day,
  contagion per contact between villages, severity growth per hour, incubation, duration, immunity days,
  treatment (herbal medicine halves growth; a doctor's care stops it rising), deadliness only through severity
  (hp 0 → slice 1). Start with 2–3 original illnesses (a mild cough, a fever, a deadly plague).
- **Outbreaks:** a daily chance per village (scenario `illness` block), higher with more people per bed, bad
  water and hunger; never in the first `graceDays`. The player sees the cause: "A fever broke out in Reedwater
  (crowded homes)."
- **Spread:** within a village each day by the illness's contagion to people sharing homes first. Between
  villages along real contacts: a trade delivery by hand (`deliverLeg`), a caravan arriving, a trader visit, a
  founding (the founders carry it), a war clash. Each has a chance; the log says how it came ("brought by a
  caravan from Pinecroft").
- **Immunity** after recovery, for `immunityDays`.
- **Distant villages:** the same daily rule on their real colonists; per-hour severity in `tickHealth`.
- Save format 16: `c.health.illness` / immunity records, `s.outbreaks` (validated).
- Tests: spread within a home, along a trade, by caravan; treatment slows it; immunity; deaths counted;
  save/load mid-outbreak; scenarios without the block unchanged.

### Slice 4: surgery and permanent injuries
- A wound of severity ≥ `scarAt` (data, e.g. 30) can leave a lasting injury when it heals untreated: a
  `lasting` entry (e.g. "lame leg": walking ×0.8; "bad hand": crafting and building ×0.85). Surgery by a doctor
  at a hospital bed with bandage + medicine before it heals prevents it; a failed surgery (skill-based, hash)
  keeps it. The planner builds the hospital ward when wounded people wait.
- Tests: lasting injuries appear and change work speed; surgery prevents them; save/load.

### Slice 5: rivalry and wars between villages
- **Rivalry causes** (all with recorded reasons, all data in the scenario `war` block):
  - *Pressing borders:* while two villages' claims meet and both still want to grow, −1 a day ("Their lands
    press on each other"), capped per pair (e.g. −40).
  - *Scarcity:* a village short of a resource that a neighbour has on its land: the existing coveting, with a
    higher cap in war scenarios.
  - *Temperament:* village profiles get `temperament` (e.g. the hill fort is proud: rivalry ×1.5; the scholars'
    retreat is peaceful: ×0.5).
  - *Old wounds:* a past war leaves a lasting grudge (the relation cools back only to −20, not to 0).
  - *Kingdom rivalry:* members share half of their capital's quarrels with another kingdom.
- **AI villages declare war** when the relation is ≤ `declareBelow` (e.g. −50), they are clearly stronger
  (1.5×), not allied or in one kingdom. The reason is logged ("Highwatch declared war on Reedwater: their lands
  press on each other and Highwatch is stronger"). Hostile villages arm their adults (existing guard and arming
  goals). Allies and kingdom members join as today.
- **Distant wars are fought in aggregate:** daily, both sides' strength (armed fit fighters × weapon power) gives
  wounds to real colonists of both sides (chosen by hash, through `injure`, so deaths come from slice 1).
  Villages near the player or watched fight in full, as today.
- **Peace:** AI-to-AI truces when one side is clearly losing or the war is old; the weaker side may *submit*
  instead (slice 6).
- Tests: rivalry builds with reasons; a declaration happens under the rule and not otherwise; allies join;
  aggregate battles conserve items and people; save/load mid-war identical; scenarios without the block
  unchanged.

### Slice 6: defeat, absorption, ruins and fallen kingdoms (save format 17)
- **A village is beaten** when, at war, it has no fit fighters left for `beatenDays` (e.g. 2) while the enemy
  has some. The winner's profile decides (data): *absorb* (the beaten village joins the winner: people,
  buildings, goods, land and research move over, like a founding in reverse; it becomes `fallen: absorbed`)
  or *sack* (the winner takes a share of the goods as a caravan; survivors flee to the nearest non-hostile
  village, else stay as a weakened village).
- **Ruins:** a village with nobody left (war, plague, famine) becomes `fallen: ruin`. Its buildings stay on the
  map as ruins (unusable, drawn grey), its goods stay as ruin stacks that any village may scavenge (ownership
  moves on pickup, no ledger change), its land is released after `ruinLandDays` (e.g. 20) so neighbours can grow
  into it.
- **Kingdoms:** absorbed villages join the winner's kingdom (a new kingdom move: transfer). A capital that falls
  passes the capital to the largest remaining member (succession; today the kingdom dissolves). A kingdom with
  no members left is gone, logged as fallen.
- Save format 17: `fallen` fields, ruin markers, released claims (validated; migration no-op).
- Tests: absorption moves every owned thing and conserves items and people; ruins keep their buildings and
  goods; land is released; kingdom succession; the village cap counts living villages; save/load identical.

### Slice 7: balance and acceptance
- **Population over 100 days** (Vast seed 7 and World seed 7): births and deaths both happen; total population
  still grows overall but some villages shrink or fall. Targets below.
- Acceptance runs: the 300-day World run (`core:vast_world`, seed 7), the 40-day run, seed 4242 Modern, the
  bench; save/load continuity at days 50, 100, 200.

## Per-tick cost
- Death check: inside `tickHealth` (every 25 ticks per full colonist, 4 per hour per distant colonist): O(1).
- Illness: daily per village O(its people); spread events O(1) at each delivery, caravan, trader or founding.
- Rivalry: daily O(pairs whose lands touch) from the claim growth that already finds them.
- Wars: daily O(wars); aggregate battles O(fighters in those wars).
- Ruins and absorption: rare events, O(the village's things) once.
- Target: World preset at day 300 still ≤ 1.5 ms/tick typical and ≤ 50 ms worst (Phase 2b: 0.62 ms).

## Distant villages
Every rule runs at both levels: health rules in `tickHealth`; daily village rules on real colonist records;
battles in aggregate when neither side is in full detail. A village promoted to full detail sees the same
people, wounds, illnesses and graves.

## Targets (World preset, seed 7, 300 days; Vast for quicker checks)
- Wars: at least 3 wars between AI villages by day 100, every one with a logged cause; at least one village
  absorbed or ruined by day 200.
- Deaths from at least 4 different causes by day 300; illness outbreaks spread between villages along trade.
- Population: still growing over 300 days (not extinction) but slower than today's 24 → 347; at least one
  village shrinks by a third or more.
- Classic pinned runs (40-day, seed 4242 Modern) unchanged, unless death happens in them (then reported).
- 0 conservation errors (items and people), save/load identical at every checked day.

## Open questions for the user
1. **The player's own village falls** (everyone dies, or it is beaten): game over, keep playing as god only, or
   pick another village to oversee? Proposal: keep playing as god, with an offer to take over a living village.
2. **Can AI villages absorb or sack the player's village?** Proposal: yes, but only after a warning letter and
   a day to sue for peace.
3. **Old-age timescale:** a year is 30 days, so a lifetime of 60+ years is 1800+ days. Proposal: lifespans in
   game years as data with `elderAge` 50 and `deathAge` 60, and starting ages spread 16–60 so some old people
   exist from the start; real old-age deaths then appear within 300 days.
4. **Death in classic games:** proposal yes (it only happens at hp 0); illness, rivalry and falls only in the
   Vast and Living worlds.

## UI notes (added to docs/ui-todo.md per slice when built)
Death letters (important), graves and bodies on the map, the cause of death on the inspector, grief on the hover
card, illness icons and an outbreak letter, war declarations with the cause, beaten/absorbed/ruined village cards
and grey ruins in the world view, the death cue sound.

## Results

The four open questions were not answered with the "go", so the proposals above are the working defaults
(keep playing as god when the player's village falls; AI villages may take it only after a warning; ages 16–60
with elders from 50 and deaths from 60; death in all games, illness and wars only in the Vast and Living worlds).

### Slice 1a: death (commit `fe413b7`, review fixes after it)
Slice 1 was split: 1a is death itself; 1b (bodies, burial, graves, mourning) comes next.
- **Built:** `src/sim/death.js` (killColonist, processDeaths); `checkDeath` and `cared` in `health.js`;
  `usedNames` in `names.js`; `peopleCensus` counts the dead; save format 15 (`s.dead`, `health.zeroSince`,
  `s.stats.deaths`; no-op migration; `validateDead`, ids below `nextId`, death counts checked).
- **Deviation: bleeding out.** The review found that a single 100% wound healed to 1% within half an hour, so
  combat would almost never kill. Now at 0% a collapsed colonist heals only with care (tending, a medical bed,
  a dressed or cleaned wound; in a distant village anyone else on their feet). Probe (seed 4242, a 100% wound at
  01:00): first aid in the first hour saves them; without it they die at 6 h.
- **Deviation:** `deathAfterHours` is in `HEALTH` (code, like the other health numbers), not mod data; the cause
  words are in `death.js`. Both can move to data with the illness type (slice 3).
- **Deaths in one tick** are done in one pass: others' jobs end once, each village plans once.
- **Not changed:** classic 40-day run and seed 4242 Modern: the same state hash as before the slice
  (`9426646c1190c148`, `429910fed998ddb5`); bench no slower. A village where everyone dies keeps running as an
  empty village (ruins: slice 6). 48 tests pass (12 in `tests/cloud-death.test.js`).
- **Open:** set-aside equipment of someone who died is restored where they died (not tested: needs a missing
  mod); `s.dead` is never pruned (slice 6); a death while being carried to a clinic and a combat death are not
  tested directly yet (combat comes in slice 5).

### Slice 1b: bodies, burial and mourning (commit `7e48fac`)
- **Built:** `src/sim/burial.js`: bodies (`s.bodies`), the `core:bury` giver under Care and the `bury` job (go to
  the body, carry it, dig for 120 ticks, place the grave), `graveTile` (next to the first grave, else the nearest
  free tile 5–30 tiles out on land the village may build on, in its walkable area), `tickBurial` (hourly while
  there are bodies: laid to rest after 3 days, or at once when the village is distant), `mourn` (home, parents,
  children: `colonist.grief`, work ×0.85 for 2 days). Building `core:grave` (furniture, passable, no cost, built
  at once, `structure.grave` holds the name). Save format 16.
- **Deviation:** graves are built at once at the end of the dig, not as construction projects, and cost nothing
  (a dug grave). The numbers are in `BURIAL` (code), like `HEALTH`.
- **Measured** (seed 4242, a death on day 3): the body was carried and buried within 2 hours; the grave stood 6
  tiles from the centre; the two housemates grieved.
- **Not changed:** classic 40-day and seed 4242 Modern state hashes; 55 tests pass (7 in
  `tests/cloud-burial.test.js`).
- **Review fixes** (after `7e48fac`): carers do not walk out to bodies beyond `contact.tendRange` (big worlds)
  and the trip budget applies; carrying a body finishes its leg unless a need is critical; the nearest body is
  offered; a stale carrier on a body is cleared on load (`reconcile.js`); graveyards start 8 tiles out (5 put
  the first grave in the village core, where homes and fields must then go round it).
- **Deviations also:** burial is part of the Care work type (no new work type); a body left 3 days gets a grave
  in the graveyard, not where it lies; grief has no effect in distant villages (their hourly labour does not use
  work speed).
- **Open:** the UI (graves, bodies, grief: `docs/ui-todo.md`); graves are never removed (ruins: slice 6).

### Slice 2: cold and old age
- **Built:** `src/sim/life.js`, the scenario block `life` (schema in `content/types.js`), on in the Vast and Living
  worlds only:
  `cold { below: -2, perHour: 0.4, shelter: 6, fires: [campfire, hearth], fireRadius: 5, foundWaitDays: 8 }`,
  `aging { elderAge: 50, elderWork: 0.8, deathAge: 60, perYear: 0.2, perYearStep: 0.15, startAges: [16, 60] }`.
  Hypothermia in `tickHealth`, elders in `workSpeed`, old age daily (`tickAging`, deaths through
  `processDeaths` with the cause), start ages in `ensureAdult`, the founding wait in `canFound`.
- **Deviation from the note: who feels the cold.** The first rule (anyone where it is below −2 °C) killed 19 of
  37 people in the first winter (Vast seed 7): distant villages' people stand outdoors round the centre
  (`lod.js`), and full-detail workers were out at night. Then founders of new villages froze before their first
  home. Now only the exposed feel it (asleep or collapsed outdoors, the homeless away from a fire), rooms add
  6 °C, a finished home shelters a distant villager, and founding waits for warmer weather.
- **Fix: hash draws.** FNV-1a alone gave almost the same value for keys that differ only in the day, so a daily
  chance hardly changed from day to day; `life.js` adds a 32-bit finaliser. (Other hash-based picks in the code
  were not changed.)
- **Measured** (Vast seed 7, 100 days): 25 → 119 people, 7 → 29 villages, 7–9 elders, 2 deaths of old age (days
  ~75 and ~85), no cold deaths (an earlier tuning, before the hash fix changed the ages: 2 cold deaths in the third
  winter). 0 conservation errors.
- **Not changed:** classic 40-day and seed 4242 Modern (no `life` block): same state hashes. 62 tests pass (7 in
  `tests/cloud-life.test.js`, run on the classic world with the rules added to its data).
- **Open:** cold and age numbers are first values; balance over 100 and 300 days is slice 7. No winter clothing.

