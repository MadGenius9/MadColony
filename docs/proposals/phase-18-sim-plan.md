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
