# Spreading the hourly and daily peaks (scale target, slice 2)

Status: **design** (2026-11-01; the owner: "You decide and keep going"). Branch `cloud-work`. Part of the scale
target (`docs/proposals/scale-target.md`). Goal: no tick much slower than the others, so a big world plays without
hitches before faster growth is switched on.

## What the peaks are (the grown world: 868 people, 62 villages, 23,500 buildings; day 300)
- **Every hour tick** (100 ticks): 70–170 ms. The largest share is the hourly mood pass (`tickMood`): every
  person's thoughts at once (30 ms after today's two caches; 47 ms before).
- **The day-start tick:** 250–410 ms. The hour work plus 15 daily jobs (about 113 ms together: rivalry 25,
  illness 21, law reviews 20, spoilage 16, markets 13, territory 6, prayers 6, the rest under 2 each).
- A normal tick: about 9 ms.

## Design
1. **Mood, per person through the hour:** each person's mood steps at their own tick of the hour (a hash of
   their id, 0–99), not all on the hour. The step and its rules stay as they are (a tenth of the gap a time, the
   break check at 09:00 for those whose tick falls in that hour). The village facts are computed once an hour
   (as now) and kept for the hour.
2. **Daily jobs, one a tick:** the 15 jobs run in their order at ticks 0, 1, 2, ... 14 of the day, not all at
   tick 0. Each still sees the whole world once a day; the order between them is unchanged.
3. **Cost:** none added; the same work, spread out.

## What changes in play
Things happen a few ticks later than before: a person's mood moves at their own minute of the hour; a law
review, a founding or a market price comes up to 14 ticks (under 9 game minutes) into the day. Saves keep
working (no new state; the timing is derived from the tick and ids). The classic hashes change and are recorded
anew; the World run's numbers will differ slightly (a different order of events), and are compared for sense,
not equality.

## Checks
- Tests: a person's mood steps once an hour at their own tick; each daily job runs once a day at its tick; save
  and load in the middle of the hour and of the first 15 ticks of a day give the same game.
- The grown world's slowest ticks before and after; the World seed 11 run; classic runs; the bench.

## Semantics (added after the owner's Phase 18 notes, 2026-11-01)
The owner's appended Phase 18 asks the spreading to keep exactly-once daily and hourly work, stable ordering,
deterministic iteration, explicit catch-up, and to say when each job reads its inputs; and to record new
baselines only after review. This is that statement; it is the scheduler Phase 18 reuses, not a second one.
- **Exactly once:** the game never skips a tick, so each tick k of the hour and each tick 0–14 of the day comes
  once. A person's mood steps once an hour at `moodSlot(id)`; daily job i runs once a day at tick i.
  - Someone born or arriving after their slot has passed this hour first steps next hour; someone who dies
    before it is skipped. No job is lost or doubled.
  - Before the change a new person also stepped first at the next hour tick, so at most an hour later than now.
- **Order:** within a slot, people by id (as before, over everyone); daily jobs in their old order, one a tick.
- **When inputs are read:**
  - Mood reads the village facts (laws, war, recent deaths, crowding) once an hour, at the first slot that
    needs them, and keeps them for that hour. A war declared at minute 30 shows in moods from the next hour.
    Before, everything was read at the hour tick, so the delay is the same.
  - Each daily job reads the world at its own tick, so job i sees the effects of jobs 0..i−1 of that day, as
    before, plus up to i ticks of ordinary play.
- **Catch-up:** none is needed (no skipped ticks). A save in the middle of the hour or of the day-start jobs
  continues exactly: the timing is derived from the tick and the ids, and the caches are rebuilt on load
  (`tests/cloud-spread.test.js`).
- **Determinism:** the iteration order is by id; nothing reads wall-clock time. The derived caches (slot lists,
  hour facts) are keyed to the state and rebuilt on births, deaths and arrivals.
- **Baselines:** the classic hashes change (the order of events changes). The new values are recorded as
  **proposed, awaiting the owner's review**, not as accepted baselines.
