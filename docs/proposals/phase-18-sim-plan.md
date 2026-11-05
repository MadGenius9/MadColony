# Phase 18: simulation-side plan, from the cloud copy's measurements (2026-11-04)

The owner's Phase 18 entry (docs/ROADMAP.md) authorizes planning, not implementation. Its baselines belong on
the home reference machine and browser. This note gives that work a start: what the simulation spends its time
on in a grown world, measured here, and a list of candidate slices with what each would change. Nothing here has
been built except the exact-preserving fixes already listed in `scale-target.md`.

## The workload measured
- **The world:** the saved grown world (World preset, seed 7, grown with the growth experiment to day 300: 868
  people, 62 villages; `scratchpad grown300.json`, made 2026-11-01). Loaded with today's code through the save
  migrations, then one day of warm-up, then two days measured.
- **Caveat:** this is a naturally grown world under an experimental growth rule, not a synthetic population. The
  cloud machine's speed varies by up to about 35% between days, so compare only runs taken in turn in one
  session.

## What it costs today (after the exact fixes of 2026-11-04)
- **Overall** (two days, old and new code in turn): p95 17.4–18.4 ms, p99 31–35 ms, mean about 6.1–6.3 ms. The
  1× budget is 16.7 ms.
- **By kind of tick:**

  | Kind | Ticks | Mean | p95 | Max |
  |---|---|---|---|---|
  | First 30 ticks of the day (the daily jobs, one a tick) | 60 | 23–24 ms | 97–114 ms | 138–140 ms |
  | First tick of each hour | 46 | 38–40 ms | 55–70 ms | 68–78 ms |
  | All other ticks | 4,694 | 7.2–7.8 ms | 20–21 ms | 70–122 ms |

  The first tick of the hour alone is 5% of all simulation time.
- **What the hour's first tick spends** (inclusive):
  - education 14% (trainees and staffing; partly fixed);
  - the villages' hourly trade, pact and contact pass 14%;
  - regrowth 13% (seeds sprouting: the trap check for each solid plant, about 7%);
  - farming's regrowth of picked plants 6.5%;
  - the planner 7%.
- **What the slow ticks spend** (over 16.7 ms, inclusive):
  - the planner about 28–31% (demand resolution, plumbing's pipe search, civic site search);
  - people's choices about 21%: work givers, with trade holds asked through `availQty`;
  - distant villages' hourly labour about 15% (building, farming in aggregate);
  - mood 7%;
  - registry look-ups 6% on their own, from building look-ups everywhere.

## Candidate slices (each with what it changes)
1. **Spread the hour's first tick** (reuse the scale-target scheduler, `docs/proposals/spread-the-peaks.md`):
   - give education, the villages' hourly pass, regrowth and farming's plant regrowth slots in the hour, by
     village or by tile, as mood already does by person;
   - **changes:** the order in which hourly work happens, so classic and World hashes change. Each job must still
     run exactly once an hour, and the note must say when it reads its inputs.
   - **Expected:** the hour's first tick from about 40 ms to under 16.7 ms.
2. **Spread the day's first ticks further:** today the 23 daily jobs run one a tick, but single jobs still reach
   97–140 ms. Split the heavy ones by village across the day's first hour (founding, markets, claims, aging).
   - **Changes:** order within the day. Needs a day-start profile per job (`tools/cloud-baselines.mjs longticks`).
3. **Fewer plans per tick:** the planner is the largest single cost.
   - Today a village plans every PLAN_INTERVAL ticks, at the slot it got.
   - Options: cap plans per tick (a queue, exactly once per interval); or skip a plan when nothing it reads has
     changed (needs a full list of its inputs; hard to make exact).
   - **Changes:** when villages react, so hashes change; the cap is the safer first step.
4. **Incremental power state:** rebuilt once a tick over every network (3.4%). Keep it per network and redo a
   network only when its members, fuel or busy machines change.
   - **Exact if done right;** a redesign of power.js's cache.
5. **`stacksByItem` kept up to date:** rebuilt from every stack on the first ask of each tick (2.1% on its own).
   - Callers rely on a snapshot within the tick, so an exact version must keep that snapshot.
   - **Exact but fiddly;** small gain.
6. **The regrowth trap check:** each solid seed due asks `wouldTrap` (a probe of the walkable areas). Ask only for
   seeds near people or building sites (where a trap is possible), with an exact reason for the rest.
   - Needs a proof that it is equivalent, or it changes where trees sprout.
7. **Registry look-ups:** 6% on their own. Keep the definition on hot objects (for example a structure's def object
   cached by id in a typed table) instead of a Map look-up each time.
   - **Exact;** wide-reaching but mechanical; best done with the UI build in view, since the UI reads the same
     objects.

## Order suggested
1 and 2 first: they answer the owner's acceptance gate on daily and hourly spikes (at least 50% less), and use a
design that already exists. Then 3, measured on the grown world and on the classic runs (behaviour changes need
the owner's review). 4, 5 and 7 are exact and can come at any time. 6 only with its proof.

## Not in this plan
Rendering and UI (home: Phase 17's build); growth enablement (the owner's decision, and the roadmap says not to
enable faster growth to mask an unmet target).

## Results: slices 1–2, the hour's and the day's peaks (built and tested, 2026-11-04; owner: "finish the rest of the phases")
- **Built:**
  - **Hourly jobs at their own tick of the hour** (`constants.js HOUR_SLOT`): the villages' hourly pass at 0,
    room heat at 10/60 (every 50 ticks), education at 20, farming's 50-tick pass at 30/80 (frost, plants
    regrowing), regrowth at 40, contact at 60, unburied bodies at 80, distant groves at 90.
  - **Semantics:** each job still runs exactly once an hour (or once every 50 ticks), at a fixed tick, so the game
    needs no catch-up. A save in the middle of the hour loads and runs on identically (the spread tests); inputs
    are read on the job's own tick.
  - **Distant villages' groves:** each village plants at its own hour of the day (from its id), trying at most 8
    spots. As one daily job it took 120–155 ms.
  - **Rebellion:** relations indexed once a pass (it went over every relation for every member every day: 28–66
    ms). Exact.
  - **Forestry's planting job:** the cheap spot checks while walking, the trap check once at planting
    (`regrow.js spotOpen`). Found because one world's run went 12–14 ms a tick while a full-detail village planted:
    the trap check every tick was 37% of the time.
- **The grown world** (868 people; old and new taken in turn):

  | | Before | After |
  |---|---|---|
  | Hour's first tick, mean | 40 ms | 15.3 ms |
  | Hour's first tick, p95 | 55–70 ms | 31.7 ms |
  | Hour's first tick, p99 | 68.5–78 ms | 34.4 ms |
  | Day's first ticks, mean | 23 ms | 16.9 ms |
  | Day's first ticks, p95 | 97–114 ms | 54 ms |
  | Day's first ticks, max | 138–140 ms | 74 ms |
  | Overall p95 | 21.7, 20.4 ms | 21.6, 19.9 ms |
  | Overall p99 | 40.5, 37.8 ms | 36.2, 34.8 ms |
  | Overall p99.9 | 70, 76 ms | 62, 62 ms |
  | Overall max | 100, 116 ms | 95, 71 ms |
  | Overall mean | 7.3, 7.1 ms | 7.6, 7.2 ms |

  - The gate "spike cost at least 50% lower": met for the hour's first tick (mean −62%, p95 −43 to −55%). Close for
    the day's (p95 −44 to −53%, max −46%).
  - **Steady-state p95 is not met:** about 20 ms against 16.7, flagged as the gate asks. The ordinary ticks are now
    what decide it: people's choices, the planner, distant villages' hours.
- **Classic runs** (the order of events changed; proposed, for review):
  - `forty` e340696c71f36c9d (workshops on day 6.44, was 6.64);
  - `modern` 1194e9931714f31c (modern era on day 41.51, was 44.70).
  - Full suite 338 passed. The forestry test now plants at the village's own hour.
- **Next (slice 3, fewer plans per tick):** see below.

## Results: slice 3, plans spread over the cycle (built and tested, 2026-11-05)
- **Found first** (the grown world, 2 days; ordinary ticks, not the hour's or day's first): ticks with no plan
  averaged 3.8–4.0 ms; with one distant village's plan 10 ms; with two 19–20 ms; with three 25–26 ms. 65 of 121 slow
  ticks (over 16.7 ms) had two or more plans. The cause: a distant village planned when `tick % 600 ===
  stagger(sid)`, and its stagger is under 100, so about 60 villages shared the first 100 ticks of each 600.
- **Built:** `lod.js abstractPlanSlot(sid)`: one of the village's own hours in the cycle (tick mod 100 is still its
  stagger, so the plan still comes just before that hour's work in the same tick), chosen by a hash among the 6
  hours. Each distant village still plans exactly once every 600 ticks. A cap on plans a tick was not needed after
  this: two plans in one tick became rare.
- **Measured** (old and new taken in turn, twice):

  | | Before | After |
  |---|---|---|
  | Slow ordinary ticks with 2+ plans | 65 | 18 |
  | Overall p99 | 22.1, 23.2 ms | 21.5, 19.9 ms |
  | Overall p99.9 | 37.6, 40.6 ms | 31.9, 33.0 ms |
  | Overall max | 49.2, 51.0 ms | 50.1, 48.1 ms |
  | Overall p95 | 13.5, 14.3 ms | 14.6, 13.9 ms |
  | Overall mean | 4.9, 5.07 ms | 5.23, 4.97 ms |

  The machine was faster this session than on 2026-11-04 (p95 about 14 ms here against 20 then), so compare only
  within this table. Mean and p95 did not change beyond noise; the rare slow ticks did.
- **One distant plan alone** costs about 3.4 ms (planning each of 60 villages five times under the profiler):
  plumbing's pipe search 22% (16% `pipePath`, mostly searches that find no room and are repeated each plan),
  demand resolution 12%, the stockpile plan 8%, roads 6%. Caching a failed pipe search exactly needs every input
  of `tileUsable` to record its changes (stacks, crops, fields, zones and claims do not); not done.
- **Tests:** `tests/cloud-planslots.test.js` (the slot is one of the village's hours, villages spread out; on a
  Vast world every distant village plans once a cycle, at its slot). Classic hashes unchanged.
