# Scale target: thousands of people by day 300 on the World preset

Status: **measured; two speed fixes done; the plan below** (2026-11-01). Branch `cloud-work`. The roadmap's direction item 7: "thousands of people
world-wide by day 300 on the World preset; measure and plan the performance work needed". Phase 16 waits for
the home PC, so this comes next. Tool: `tools/cloud-scale-run.mjs` (load and grow modes).

## 1. What limits the number of people today (a design limit, not speed)
- Every AI village profile caps its people at **6** (`policy.maxPopulation` in `living-world.json`); the
  player's village 12 (`BIRTH.defaultCap`). A crowded village founds a daughter where a free site is found.
- So the world's people are about 6 × the village sites. The 200-day World runs end near 230–290 people in
  60–64 villages; the 300-day runs before were 256–302.
- **Thousands by day 300 needs a design change first** (larger villages, or many more sites), not only speed.

## 2. What thousands of people cost (load mode: villagers copied to set totals, one day profiled)
**Spread over 51 villages (from day 150):**
| People | ms per tick | Slowest tick | Top CPU shares |
|---|---|---|---|
| 206 | 3.1 | 169 | game.js 23%, lod.js 13%, heat.js 9%, planner.js 7% |
| 998 | 9.0 | 401 | game.js 24%, lod.js 12%, heat.js 8%, villages.js 6% |
| 1,990 | 15.7 | 337 | game.js 28%, lod.js 10%, villages.js 9%, people.js 6% |
| 2,859 | 21.9 | 590 | game.js 26%, villages.js 12%, lod.js 10%, people.js 7% |

- About 3 ms plus 6.5 ms for each 1,000 people: close to linear when people are spread out.
- A 1× game in the browser runs 60 ticks a second (16.7 ms a tick): **about 2,000 people fit at 1×; 3,000 need
  the tick about 25% cheaper**, and faster game speeds need more.
- `villages.js` grows fastest (4.5% → 12%): to look at first.

**Crowded into 7 villages (from day 20):** 1,000 people 6.8 ms; 1,865 people 20.9 ms (about three times the
cost for twice the people), led by `givers.js` (13%) and `medical.js` (9%). At 4,000 the villages starved
(3,000 deaths), so that point measures a famine, not a load. Villages of 150–250 people are not what the game
makes, but the super-linear part is a real cost: several job finders looped over everyone in the world for each
person looking for work (below).

## 3. First fix (slice 1): loops over everyone in the world, for one village's people
`medical.js` (carry to a medical bed, treat), `givers.js` (tend, scouts, researchers) and `education.js`
(pupils counted, teachers) went through `Object.values(s.colonists)` for each person looking for work and kept
only their village's people: the cost grew with people × people. They now use the village's own index
(`g.villagers(sid)`, in the same order as before, or `g.owned`), so nothing they choose changes.

## 4. Second fix: trade legs
`legRemaining` (villages.js) went over everyone in the world for every trade leg asked about (the planner, the
trade givers, distant villages and the daily trade check all ask). Carriers are always people of the sending
village (trade jobs go only to them; moving village ends a job first), so only that village is counted now.

## 5. Results of the two fixes (gameplay unchanged)
- Classic hashes unchanged (`forty` 8345afce244873af, `modern` 96a3ae6edf4692e1); the World seed 11 run gives
  exactly the same day-200 numbers (255 people, 269 born, 38 died, 43 wars, the same traditions); save and load
  identical. Tests: `tests/cloud-scale.test.js` (same people in the same order; carriers counted).
- Load, 51 villages from day 150 (ms per tick):

| People | Before | After fix 1 | After fix 2 |
|---|---|---|---|
| 206 | 3.1 | 2.5 | 2.5 |
| 998 | 9.0 | 7.9 | 7.2 |
| 1,990 | 15.7 | 14.6 | 11.7 |
| 2,859 | 21.9 | 18.0 | 18.5 |

  (This machine's speed varies; the 2,859 line did not improve with fix 2, within noise.) `villages.js` left
  the top of the profile. What is left grows with people about linearly: `game.js` (the tick loop over everyone)
  ~30%, `lod.js` (distant villages) ~11%, `people.js` ~9%, `heat.js`, `power.js`.

## 6. The plan
1. **The design limit first (owner's call when back):** growth itself is too slow for thousands by day 300.
   The grow run (every village's cap raised from 6 to 40, World seed 7, 300 days): 40 people on day 25, 110 on
   day 100, 222 on day 200, **364 on day 300** in 26 villages, 2.1 ms/tick. That is about 1.2 people a day
   world-wide, close to the ~300 the normal caps give (with more, smaller villages). Births are the limit: a 25%
   chance a day per couple, at least 6 days apart, only with a free bed and 4 days of food (`BIRTH`), in a year of
   30 days. Thousands by day 300 needs a choice: faster births, larger starting villages, more settlers arriving
   (immigration), or a longer horizon. Bigger village caps alone do not do it.
2. **Speed, in order of what the profile shows:**
   - the per-tick colonist loop in `game.js` and `people.js` (life stage and needs per person per tick): spread
     slow-changing checks over ticks (as distant villages already do hourly);
   - `lod.js`: distant villages' hourly work, already staggered; measure per village;
   - `heat.js` rooms and `power.js` networks: per-structure costs that grow with buildings.
3. **Target:** 3,000 people under 16.7 ms a tick on this machine (1× in the browser), checked with
   `tools/cloud-scale-run.mjs load`; then the browser at home.
4. **Rules kept:** every speed change keeps the classic hashes and the World run identical, as these two did.

## 7. Third and fourth fixes (2026-11-01, gameplay unchanged each time)
- **Life stages** (`people.js tickPeople`): checked every person every tick, though adults never move on. Now a
  derived list of those not yet adults (same order), rebuilt on births, deaths and arrivals, and daily.
- **Tile checks** (`game.js colonistAt`, `cutsNothing`): copied the whole list of people on every call. Now one
  shared list (same order), rebuilt only when someone is born, arrives or dies. A position index would be faster
  still, but people are moved in too many places to keep one exact; not done.
- Each change kept `forty` 8345afce244873af and `modern` 96a3ae6edf4692e1, and the World seed 11 run's day-200
  numbers (255 people, 269 born, 38 died, 43 wars, the same traditions); save and load identical.

**Load, 51 villages from day 150, after all four fixes (ms per tick):**
| People | Before any fix | Now |
|---|---|---|
| 206 | 3.1 | 3.5 (this machine was slower in the last round; compare within a column) |
| 998 | 9.0 | 8.8 |
| 1,990 | 15.7 | 14.0 |
| 2,859 | 21.9 | 17.6 |

About 2,850 people now run at 17.6 ms a tick, close to the 16.7 ms a 1× game allows.

**What is left at the top** (function self time, 2,859 people): `ensureRegions` 7% (walkable areas rebuilt as
walls go up: inflated by the load harness, whose 2,600 homeless newcomers start a building rush), `busyStations`
(power.js) 3.5%, garbage collection 3%, `roomAt` (heat.js) 3%, registry lookups 3% (already a single Map lookup;
called very often). No single large cost remains; the next gains need either fewer calls (e.g. heat and power
answers cached per hour) or measuring a naturally grown big world, which needs the owner's growth decision first.

## 8. The growth decision (2026-11-01; the owner: "You decide")
- **Why growth is slow** (a diagnostic, World seed 7 with caps raised to 40, days 20–120, per village a day):
  on 88% of village-days a birth was possible (food for 4+ days, a couple in a home, a free bed); food stopped it
  on 1%, no couple on 1%, no free bed on 11%. Children grow up in 18 days. So the limit is the birth rule
  itself: a 25% chance a day, one birth a village a day at most, 6 days between births in a home: about a quarter
  of a person a village a day.
- **Decision:** faster births and bigger villages for the World preset only, as scenario data
  (`growthBySize.world` in `vast-world.json`: `chancePerDay`, `gapDays`, `maxPopulation`). The classic game,
  the neighbours scenarios and the smaller worlds keep today's rules (`BIRTH`). The values are chosen by runs
  (below), aiming at 2,000–3,000 people by day 300, which the speed work showed fits a 1× game.
- **Not chosen:** immigration (a new system), larger starting villages (changes the opening), a longer
  horizon (does not meet the target).

### Growth experiments (World seed 7, 300 days, `tools/cloud-scale-run.mjs grow`)
| Setting | Day 100 | Day 200 | Day 300 | ms/tick on day 300 |
|---|---|---|---|---|
| Today's rules | ~110 | ~220 | ~300 | ~2 |
| Cap 40 only | 110 | 222 | 364 (26 villages) | 2.1 |
| Chance 0.6, gap 3, cap 20 (stopped at day 100) | 159 | | | |
| Chance 0.8, gap 2, cap 24, 3 births a village a day | 208 | 638 | **868 (62 villages)** | **15.0 (slowest tick 2.9 s)** |

- **What limits growth, in order:** (1) births come from homes where a couple sleeps, each such home waiting out
  the gap, and at most one birth a village a day (now `perDay`); (2) the beds and food newcomers need; (3) the
  scenario's 64-village limit (`founding.maxVillages`), reached on day 250 in the last run.
- **A warning from the last run:** a world that really grew to 868 people cost 15 ms a tick on day 300, about
  twice the load test's cost for the same number of people, with a 2.9-second tick. Something builds up over
  300 days (buildings, villages, records) that the load test does not have. **Faster growth is not switched on**
  until that cost is found: the grown world is being profiled next.

## 9. The grown world (868 people, 62 villages, day 300) and three more fixes (2026-11-01)
Profiled from the saved end of the fast-growth run (`SCALE_SAVE`, then `load` with `SCALE_CACHE`):
- **Fighters' targets** (`combat.js nearestEnemy`, 15% of the time): every person in the world was checked for
  each fighter. Now only the people of the villages it is at war with (ties: the lower id, the old order).
- **Medical supplies** (`medical.js findSupply`, 7%): every stack and building in the world. Now the village's
  own (`mineList`, the same order).
- **Law reviews at day start** (`civreview.js wanted`, the largest share of the day-start tick): every building
  in the world was scanned for a school desk, for each village reviewed. Now the village's own buildings.
- Gameplay unchanged each time (classic hashes; the World seed 11 run's day-200 numbers; save and load).

| The grown world | Before | After |
|---|---|---|
| ms per tick (one day) | 12.2 | 9.2 |
| Day-start ticks | 310–510 ms | 240–400 ms |

## 10. Decision on growth, for now
- **Faster growth stays off** for the moment. With it the World preset would reach about 870 people by day 300
  (three times today) at about 9 ms a tick, which a 1× game can carry, but its day-start ticks of 250–400 ms are
  visible hitches (today's World: about 110–210 ms).
- **Next:** spread the daily jobs over the first hour instead of one tick (villages in turn, as the hourly
  distant-village work already is), then switch on growth for the World preset
  (`growthBySize.world`: chance 0.8, gap 2 days, cap 24, up to 3 births a village a day) and raise its village
  limit (64) if the target of thousands still needs it. Spreading the daily jobs changes the order things happen
  in, so it needs its own design note and new classic hashes.

## 11. The grown world's steady load (2026-11-02)
After the spreading (`docs/proposals/spread-the-peaks.md`), the grown world's p95 tick stayed near 24–25 ms,
above the 16.7 ms budget. Which ticks are slow (2 days, 609 of 4,800 ticks over 16.7 ms):
- **Minute 0 of each hour** averaged 46 ms. Its jobs, timed alone:
  - education 9.9 ms (now 5.1);
  - village upkeep (`tickVillages`) 4.7 ms;
  - regrowth 3.7 ms;
  - farming 2.6 ms (every 10 ticks).
- **About 20 other minutes** averaged 12–21 ms. These are distant villages replanning. Each distant village
  plans every 600 ticks at its own offset, so with 62 villages about every tenth tick carries a plan:
  - one plan costs 7.7 ms on average and up to 27 ms for a 24-person village;
  - inside it, `planSettlement` itself takes 15%, the plumbing route search 10% (`pipePath`, a search of up to
    4,000 tiles when a water network is not joined), and `medicalBeds` 3%.
- **Hours 0, 6, 12 and 18** have more slow ticks: the 6-hour planning cycle.

**Fixed (same answers, gameplay unchanged):**
- education's qualification list is looked up once;
- lecture halls are cached on `structRev|builtRev`;
- mood's bed counts recount only the village asked about;
- `medicalBeds` no longer copies everyone's bed into a set.

The classic hashes stay the proposed ones (`forty` 370a3135216012bd, `modern` 78fc7e9b0909c987), and the World
seed 11 run is identical.

**Result:** the p95 did not move beyond noise (24–25.5 ms). It is set by the planner's cost per distant village,
not by the hourly jobs.

**Next options for the planner** (each needs care, and possibly the owner's Phase 18 review):
- (a) make one plan cheaper: profile `planSettlement`'s body, and remember a failed pipe search until the ground
  near the network changes;
- (b) split a distant village's plan over several ticks;
- (c) plan distant villages less often (a behaviour change).

Growth stays off until the grown world meets its target.

## 12. Finding the slow ticks directly, and three more fixes (2026-11-02)
A new measurement: one continuous profile of a day, with each slow tick's start and end recorded, counting only
the samples inside ticks over 16.7 ms (`slowattr`, scratch tool). Inside the slow ticks:
- the planner was 30% (distant villages' plans);
- villagers deciding what to do, 27%;
- distant villages' hours, 16%;
- rooms (heat.js), 8%;
- mood, 7%.

The fixes, same answers each time:
- **Machine checks** (`power.js machineBusy`, from `powerAt` for each powered building a plan checks): every
  person in the world → the machine's village only (station jobs go only to its own people).
- **Growing food in a plan** (`planner.js`): every crop in the world for each plan → `g.cropsBy(sid)`, lists by
  village in `Object.values` order (the sums are identical), updated as crops come and go.
- **Rooms** (`heat.js rooms`): every wall and door re-read at each path change → skipped when no building was
  added, removed, finished or renovated (`structRev|builtRev`).

After each one the classic hashes were the proposed ones and the World seed 11 run was identical.

**The grown world** (868 people, 62 villages, day 300; 2 days after a day of warm-up):

| ms a tick | before the spreading | after it | now |
|---|---|---|---|
| median | 3.7 | 4.4 | 4.4 |
| p95 | 24.2 | 25.4 | **20.3** |
| p99 | 59.3 | 44.5 | **37.8** |
| p99.9 | 117.6 | 77 | **55.9** |
| slowest | 248 | 113 | **85** |

The p95 is still above 16.7 ms. What is left inside slow ticks is villagers' decisions, the rest of the planner
and distant villages' hours: spread-out costs with no single cause left above a few percent.

## The grown world, again (2026-11-04): exact-preserving fixes
- **Measured on** the saved grown world (868 people, day 300; `pct.mjs`, two days after a day of warm-up), with the
  code as of Phase 10: p95 19.9 ms, p99 38.9 ms.
- **Profile of the slow ticks:** the planner about 30%, people's choices about 20%, distant villages' hours 14%; the
  rooms rebuild (heat.js) about 9%; registry look-ups 8.7% on their own; `completedTradesBetween` (trade roads)
  3.5%; `planPlumbing` 2.6%.
- **Fixed, all exact** (the grown world hashes the same after two days with the old and the new code, bed1a71f…;
  classic hashes unchanged):
  - `heat.js rooms`: worked out again only when walls or doors change (`g.wallRev`, bumped in game.js
    `structsChanged` / `structRedefined` and construction.js `completeStructure`). Before, every building added or
    finished anywhere counted, and each rebuild looked at every wall twice.
  - `roads.js planTradeRoad`: trades counted once a look (`completedTradeCounts`), not once a partner.
  - `planner.js planPlumbing`: its own homes (`g.owned('homes', sid)`), not every home in the world; the water
    buildings and their templates kept per registry, in registry order.
  - `people.js considerBirths`: its own homes, not every home in the world.
  - `heat.js outdoorTemp`: kept for the tick and season law (every sleeper asks each tick).
- **After** (old and new taken in turn, twice):

  | | p95 | p99 | p99.9 | Mean |
  |---|---|---|---|---|
  | Old | 20.7, 18.6 ms | 39.0, 35.3 ms | 87.5, 81.6 ms | 7.06, 6.34 ms |
  | New | 17.4, 18.4 ms | 31.4, 34.5 ms | 73.1, 59.6 ms | 6.05, 6.34 ms |

  - Slow ticks (over 16.7 ms) in the profiled day: 247 before, 158 after.
- **Still above the 16.7 ms p95 target.** What is left is spread out: the planner's demand resolution, people's
  work choices, distant villages' hourly labour. Bigger gains need the deeper work the owner queued as Phase 18
  (for example planning fewer villages per tick), which changes timing and so needs its baselines reviewed. Not
  started here.
- **One more, the same day:** `mood.js villageFacts` looked for a recent death by going over every dead person in
  the world, for each village a tick's mood step asked about. Each village's latest death tick is now kept until
  someone dies (`g.deadRev`, bumped where the dead are added: death.js). The grown world still hashes bed1a71f…
  after two days; classic hashes unchanged; full suite 335 passed.
- **Looked at and left:**
  - the pipe search (`pipePath`, 3.4%): a failing search reads stacks, fields, crops, zones and claims, so there is
    no exact key for remembering it;
  - the power state (3.4%): rebuilt once a tick over every network; making it incremental is a redesign;
  - `stacksByItem` (2.1%): a per-tick snapshot that callers rely on within the tick; keeping that exactly saves
    little.
- **And one more:** `education.js staffing` asked every hour, for each village with a lecture hall, about every
  qualification (the four professions too) and went over the village's buildings for each. Now:
  - its training callers ask only for the qualifications a college teaches (`staffing(g, sid, true)`);
  - "has a school" and "has a machine" are kept until a building is added, removed or finished (as HALLS).

  Exact (the grown world still hashes bed1a71f…; classic hashes unchanged; full suite 335 passed).
- **What remains for Phase 18 (planning):** `docs/proposals/phase-18-sim-plan.md`.
