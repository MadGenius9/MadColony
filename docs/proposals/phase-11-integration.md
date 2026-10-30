# Phase 11: integration and reliability

Status: **the cloud part done** (2026-10-30). Item 1's build and UI test wait for the home PC. Branch `cloud-work` (cloud rescue copy; see CLAUDE.md). The scope is the
roadmap's Phase 11 (owner, 2026-10-29). This phase changes no balance and adds no features.

## 1. A playable build (status: the cloud part only)
- **The UI is not here:** `src/ui` and `index.html` are on the owner's home PC (back about 2026-11-08), so no
  playable build can be made or tested in the cloud copy.
- **What is done here:** `docs/integration-contract.md` lists, phase by phase, what the UI must call, read and
  show, checked against the source, with the save formats 27–33.
- **What happens at home:** merge, run the UI against `cloud-work`, and only then call anything playable.
- **Not done here:** no replacement UI, and no screenshots.

## 2. Goods set aside for a missing mod (status: reproduced and fixed)
- **The suspicion** (from reading `game.js tryRestore`): a map stack set aside on load keeps its village in
  `data.settlement`, but restoring set the owner only from the outer `owner`, which only caravan goods
  carried.
- **Reproduced:** `tests/cloud-orphans.test.js` adds an item as a mod would. An AI village holds 10 of it.
  Loaded without the item, the stack is set aside; loaded with it again, it was restored as `t1`'s, the
  player's.
- **Also found:** fuel, buffers, overflow, ammunition and carried goods set aside from a village recorded no
  owner at all.
- **Fixed:**
  - restoring uses the outer owner, else the stack's own `settlement`;
  - building contents, overflow and people's ammunition and carried goods are set aside with their village
    as `owner`.
- **Tests:** a map stack and a villager's carried goods come back as the AI village's, all of them, with
  items conserved. Both tests failed on the code before the fix.

## 3. Performance baselines (status: planned)
- **A tool** (`tools/cloud-baselines.mjs`) with fixed seeds and sizes, measuring each separately:
  - **terrain-edit latency:** one radius-8 raise and one forest stroke on Vast and World, in a running game,
    the stroke tick and the next 10 ticks;
  - **long ticks:** the 10 slowest ticks of a 60-day World run, with what ran on them (day start, planner,
    rooms, fights);
  - **war cost:** two full-detail villages at war against the same pair at peace, over the same 2 days
    (ms/tick);
  - **animal cost:** the share of `tickAnimals`, hunting and `wolfDanger` in a CPU profile of 20 Vast days.
- **Comparisons only within one session:** this machine's speed varies by about 35% between days (seen
  2026-10-29: the same code ran 1.30 against 0.92 ms/tick at day 100 on two days).

## 4. War frequency and hunting limits (status: planned, report only)
- **Wars:** World seed 11 declared 85 wars in 300 days with peoples, 61 with civilization laws and 101 with
  mood. The report will break that down by cause (rivalry between peoples ×1.5, militias' strength, unrest,
  borders) using the same seed with each factor switched off in a scratch copy. No change to the game
  without the owner.
- **Hunting:** distant villages hunt with one hunter an hour, and full ones arm two hunters. The report will
  give meat's share of food by village size and detail, from the World run's `meatShare`.

## Acceptance
- Reproducible test results; a clear UI and integration status; remaining defects and performance limits
  written down.

## Results so far (2026-10-30)
- **Item 1:** `docs/integration-contract.md` (292 lines) lists the save formats 13–33, all 17 god powers with
  their arguments and previews, the direct calls, what the UI reads per phase, and the new content types.
  - **10 mismatches** between `docs/ui-todo.md` and the code. Fixed here: the format-33 comment. Left for the
    home integration:
    - effect-source lines for traits;
    - the work-speed breakdown;
    - unrest reasons only in the log text;
    - the log has no village field;
    - "since" values are ticks.
  - **4 open questions** for the owner, in the contract.
- **Item 2:** reproduced and fixed (above). 238 tests pass; classic unchanged (`forty` 8345afce244873af,
  `modern` 3db6905a9e1dc4d5).
- **Items 3 and 4:** next.

## Item 3 results: baselines (2026-10-30, seed 7; `tools/cloud-baselines.mjs`)
| Measure | Vast | World |
|---|---|---|
| Raise stroke, radius 8 (197 tiles): preview | 0.7 ms | 0.7 ms |
| Raise stroke: its own tick | 40 ms | 1,174 ms |
| Raise stroke: worst of the next 200 ticks | 614 ms (43 ticks later, when a job first asks for the map data) | 32 ms |
| Forest stroke: its own tick / worst next 200 | 2 ms / 24 ms | 3 ms / 29 ms |

- **Terrain edits** cost about 0.6 s on Vast and 1.2 s on World, as World shaping slice 4 measured: mostly the
  whole-map water walk rebuilt per map revision. An incremental water walk is still carried over.
- **Long ticks** (World, 60 days, 0.72 ms/tick):
  - the slowest is the first tick, 210 ms (start-up caches);
  - after that 108 ms at most, on day starts (the daily passes) and on the hour (the hourly passes, mood
    among them);
  - nothing over 0.25 s.
- **War cost** (neighbours, medium, 2 days, both villages armed): at war 0.40 ms/tick (5 wounded), at peace
  0.56. Fighting itself is cheap, because wounded people stop working. The slower late World game is
  therefore not the fights themselves, and item 4 looks at what wars bring with them.
- **Animal cost** (Vast, 20 days, the in-process profiler):
  - animals 3.8% of the time, monsters 0.6%, hunting under 0.1%;
  - the largest shares are the game core 30%, distant villages 9.5% and the job givers 7%.

## Item 4 results, part 1: hunting (World seed 11, 300 days, the Mood run)
- **Meat's share of the food made** falls from 3.4% (day 50) to 0.8% (day 300). Villages hunted 197 deer, 59
  horses and 9 wolves in 300 days (two Thornbacks too).
- **The herds shrink much more than the hunting explains:** deer 2,810 → 1,029, horses 1,056 → 435, wolves
  940 → 421. Hunting took about 200 deer, so most of the fall is winter and crowding losses (`animals.js`
  winterLoss, crowdLoss, lostLoss), not people.
- **Why hunting stays small:**
  - full villages arm their 2 best hunters only while meat is short;
  - distant villages hunt with one hunter an hour;
  - herds near villages thin out.
- **Not changed** (report only, as the roadmap says). The owner decides whether hunting should matter more
  and whether herds should hold up better in long games.

## Item 4 results, part 2: war frequency (World seed 11, 200 days)
The same seed in four copies of today's code, each with one cause switched off in a scratch copy (not
committed).

| Copy | Wars declared by day 150 / 200 | People day 200 | Standing villages | ms/tick day 200 |
|---|---|---|---|---|
| Today's code | 19 / 55 | 272 | 62 of 64 | 3.42 |
| No extra rivalry between peoples (×1 instead of ×1.5) | 5 / 27 | 272 | 62 of 65 | 3.32 |
| No militias (conscription always none) | 18 / 63 | 283 | 63 of 64 | 3.26 |
| No mood | 25 / 68 | 259 | 55 of 65 | 4.13 |

- **The main cause is the faster feuds between different peoples** (the owner's answer 5 in Peoples and
  traits: rivalry ×1.5). Without it, wars halve.
- **Militias are a result, not a cause:** villages raise them when at war, 37 of 64 by day 200. Without them
  slightly more wars happen.
- **Mood lowers wars a little** (55 against 68) and keeps more villages standing (62 against 55). Unrest
  repeals laws, and fewer villages fall.
- **The cost of a warlike world:** the copy with most wars and fallen villages (no mood) was the slowest,
  4.13 ms/tick. Fights are cheap (item 3), so the extra cost is everything wars bring: refugees, fallen
  villages, kingdoms changing, tribute.
- **The earlier "101 wars against 61"** compared runs 300 days long of different code. Over 300 days small
  changes snowball, so single long runs are not a measure of one cause. This table, with one cause off at a
  time on the same code, is.
- **Not changed.** Options for the owner:
  - keep ×1.5;
  - lower it (e.g. ×1.2);
  - let it fade for neighbours who have traded for a long time.

## Phase 11 status
- **Done in the cloud:** the integration contract (item 1, the cloud part), the set-aside goods bug
  reproduced and fixed (item 2), baselines (item 3), the wars and hunting report (item 4).
- **Waits for home:** the playable build, the UI checks against the contract, and the contract's 4 open
  questions.
- **Remaining limits:**
  - terrain strokes cost 0.6–1.2 s (an incremental water walk is carried over);
  - long games grow warlike between peoples (an owner decision);
  - herds shrink over long games, mostly from winter and crowding losses (an owner decision).
