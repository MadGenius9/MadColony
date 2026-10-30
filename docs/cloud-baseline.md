# Cloud baseline

Reference numbers for the cloud rescue copy, taken on 2026-10-25 on branch `cloud-work` before any Phase 5 work
(code as in `1f73174`). The verifier compares every slice with these. Machine: the cloud container, Node 22.22.

## Test suite
`node --test "tests/*.test.js"`: 36 tests in 5 files, all passing, about 40 s.

| File | Tests | Covers |
|---|---|---|
| cloud-determinism | 7 | same seed same game; save/load continuity (classic, neighbours, mid-day, two loads) |
| cloud-conservation | 4 | ledger = census, reservations = jobs, finite needs, over 30 days and across a load |
| cloud-vast-world | 8 | Vast and World presets: spacing, one landmass, organic territory, contact, LOD, save/load |
| cloud-god | 7 | omen, bless, inspire, spawn (found, join): validation, favour, ledger, replay and save/load |
| cloud-world-basics | 10 | founding, kingdoms, claims, building rights, contact causes, borders touching |

## Runs (`tools/cloud-checks.mjs`)
| Run | Day | ms/tick | Worst tick | People | Built | Era days | Conservation | stateHash |
|---|---|---|---|---|---|---|---|---|
| `forty` (seed 20261021, 40 days) | 40 | 0.039 | 65.5 ms | 5 | 65 | Workshops 6.04 | 0 errors | `9426646c1190c148` |
| `modern` (seed 4242, Advance to Modern) | 35.72 | 0.047 | 45.9 ms | 5 | 89 | Workshops 6.1, Industry 11.5, Electric 17.25, Modern 35.72 | 0 errors | `429910fed998ddb5` |

stateHash covers the saved state and plans without the save header and `state.format` (changed
2026-10-26 so that a save format bump alone does not change it; the hashes above were recomputed on `ce2d67f`
and are the same on Phase 5 slice 1a).

`node tools/simulate.js 10 --log`: 24 000 ticks in about 1.5 s, 0 conservation errors.

## Bench (`node tools/bench.js`: 2 days, neighbours scenario, seed 7)
| Size | Villages | ms/tick | Worst tick | Save KB | Ledger |
|---|---|---|---|---|---|
| small | 2 | 0.203 | 74.1 | 163 | ok |
| small | 4 | 0.238 | 41.5 | 210 | ok |
| medium | 2 | 0.296 | 62.4 | 378 | ok |
| medium | 4 | 0.375 | 67.3 | 426 | ok |
| large | 2 | 0.505 | 116.8 | 768 | ok |
| large | 4 | 0.783 | 164.8 | 815 | ok |

Vast preset (`core:vast_world`, size `vast`, seed 7): creation about 3.0 s, days 1–6 at 0.3–0.8 s each.

## After Phase 5 (2026-10-26, `529b86f`)
- Tests: 102 in 13 files, all passing, about 45 s.
- `forty` and `modern`: unchanged (same state hashes as above).
- Bench (2 days, neighbours, seed 7): small 0.146 / 0.173, medium 0.196 / 0.271, large 0.364 / 0.537 ms/tick (2 / 4
  villages), ledger ok.
- World acceptance run (`tools/cloud-world-run.mjs 300 world 7 25 150`): see the table in
  `docs/proposals/phase-5-death-and-collapse.md`, "Slice 7". Day 300: 1.017 ms/tick (code before Phase 5: 0.900),
  326 people (345), worst tick 48 ms after day 1, 8.6 minutes in all.

## After Phase 5b (2026-10-27)
- Tests: 135 in 13 files, all passing.
- `forty` and `modern`: unchanged (same state hashes as above).
- Bench (`node tools/bench.js`, today, this machine; slower than on 2026-10-26 for the same code): small 0.213 /
  0.257, medium 0.316 / 0.441, large 0.669 / 0.900 ms/tick (3 / 5 settlements in the table), ledger ok. The
  Phase 5 code side by side: small 0.208 / 0.265, medium 0.322 / 0.443, large 0.577 / 0.804: no regression
  beyond the noise.
- Powers run (`tools/cloud-powers-run.mjs 40 vast 7`): see the design note, "Phase 5b acceptance".

## Phase 8, slice 1 (2026-10-28): new classic hashes
Animals are in every game (the owner's answer), so the herds are part of the saved state: `forty`
b6c75f52735d338a, `modern` 8d4917d8556d4f55. With `s.animals` removed `forty` still hashes to 9426646c1190c148
(nothing else changed). Later slices compare against the new hashes.

## Phase 8, slice 2 (2026-10-28): classic hashes
Near animals are saved: `forty` 6b934c050e95907a, `modern` e34dfb5baf5a02bc after the review fixes (first 58a33fd49d1db4de / a6dc12f1df32b2a4; same outcomes as before).

## Phase 8, slice 3 (2026-10-28): classic hashes
Hunting changes classic villages (they hunt the deer near them): `forty` 75cdeebbd8710a70 (5 colonists, 66
built, workshops era on day 5.47), `modern` 14be8f5a6511e9e2 (modern era on day 41.63), after the review fixes.

## Phase 8, slice 4 (2026-10-28): classic hashes
Wolves now go for people: `forty` a3f4673dd1c9392c, `modern` 3982dd57aa2eadad (same outcomes: 5 colonists, 66
and 90 built, the same era days).

## Phase 8, slice 5 (2026-10-28): classic hashes
Hunting at work priority 1: `forty` b9406ed4939d61cc (workshops era on day 6.05), `modern` 73214f81e4dcf083
(modern era on day 44.11).


After the review (hunting priority back to 0.8; the `far` fix has no effect on classic worlds): `forty`
a3f4673dd1c9392c, `modern` 3982dd57aa2eadad, the same as slice 4.

## Phase 8 acceptance (2026-10-28)
- Classic: `forty` a3f4673dd1c9392c (unchanged), `modern` 0c1fcaacd5934528 (modern era on day 42.76): the
  herd-move draw changed, which affects far herds on a classic map.
- Bench (2 days, neighbours, seed 7; the code before Phase 8, `b77cbfc`, against now, same machine): small
  0.23–0.30 against 0.27–0.35, medium 0.34–0.54 against 0.42–0.64, large 0.66–1.07 against 0.69–1.07 ms/tick.
  With animals off, the current code matches the code before Phase 8.
- World acceptance run (`tools/cloud-world-run.mjs 300 world 7 25 150`): day 300 at 2.577 ms/tick, 314 people,
  64 villages; save 12.7 MB; 21.4 min. Table in `docs/proposals/phase-8-animals.md`, "Slice 7".
- Phase 5 code (`529b86f`) on the same machine, World, day 50: 0.359 ms/tick (0.186 recorded on 2026-10-26: the
  machine is slower now).
- After the near distance went to 28 tiles: `forty` ac37a8f860cb8e30, `modern` 26aff18c94590ae1.

## Phase 8b acceptance (2026-10-28)
- Classic: `forty` d75653ad30ecf912, `modern` a9171d273506ce65. The era days are unchanged; the hashes changed
  because the animal ledger is part of the state.
- Bench (the code before 8b, `4af6044`, against now, two rounds each in turn):
  - small 0.309–0.401 against 0.330–0.418;
  - medium 0.439–0.783 against 0.545–0.742;
  - large 0.798–1.322 against 0.809–1.458 ms/tick;
  - the sum over all six sizes: +5.5% and +4%.
- Animal powers run (`tools/cloud-animalpowers-run.mjs 30 vast 7`): ok, worst tick 33.0 ms after day 1 (147.8 on
  day 1).

## Phase 8c acceptance (2026-10-28)
- Classic: `forty` f2b307a1c300840c (workshops era on day 5.94), `modern` 875b3904209fce3d (modern era on day
  45.5; monster forays from day 15 slow it).
- Bench (the code before 8c, `1d05d00`, against now, two rounds): the sum over all six sizes was +8% and +1%.
- World acceptance run: day 300 at 2.299 ms/tick, 289 people, 64 villages; save 12.3 MB; 21.1 min.

## World shaping acceptance (2026-10-28)
- No engine change since slice 4 (`fe93027`): 189 tests pass; classic `forty` f2b307a1c300840c, `modern`
  875b3904209fce3d (modern era on day 45.5), as after Phase 8c.
- Shaping run (`tools/cloud-shape-run.mjs 60 vast 7`): ok; 56 strokes, worst stroke tick 72.7 ms; after 60 days
  7 people, 103 buildings, 4 fields, no deaths; worst living tick 100.4 ms.

## Peoples and traits, slice 1 (2026-10-28): new classic hashes
- The records only (people and traits saved; no effect yet): 194 tests pass; era days and buildings unchanged.
- `forty` 517c43bfd1770f87 (workshops era on day 5.94, 66 built), `modern` 9a9001ab3f13385b (modern era on day
  45.5, 90 built).

## Peoples and traits, slice 2 (2026-10-28): effects
- 197 tests pass. The animal test "spoilage keeps reserved units" now places its venison on the last tick before
  the day starts: a quicker hauler had moved part of it first, so the test found no stack of 30. All its
  assertions are kept.
- Classic: `forty` ee55506a781cb766 (workshops era on day 6.10, was 5.94; 66 built); `modern` 479f5857575304ab
  (modern era on day 46.12, was 45.5; 90 built).
- Bench (the slice-1 code against now, same machine, two rounds, ms/tick summed over the six sizes): 3.33 → 3.69
  (+11%) and 3.63 → 3.77 (+4%), about +7% on average. Part of it is that the games play differently now
  (traits change work and walking), not only the cost of reading the effects.

## Peoples and traits, slice 3 (2026-10-28)
- 200 tests pass. Classic runs unchanged from slice 2 (`forty` ee55506a781cb766, `modern` 479f5857575304ab):
  classic games have no fights and only Hearthfolk.

## Peoples and traits acceptance (2026-10-28)
- 205 tests pass. Classic `forty` ee55506a781cb766 (workshops era on day 6.10), `modern` 479f5857575304ab (modern
  era on day 46.12).
- Bench (the code before the phase, `9053c0f`, against now, two rounds, summed): +2% and −1%.
- **World seed 7**, 300 days:
  - 2.326 ms/tick at day 300;
  - 302 people (Hearthfolk 131, Reedkin 107, Cragborn 64) in 62 standing villages of 65;
  - save 12.9 MB; 20.9 min.
- **World seed 11**, 300 days:
  - 2.453 ms/tick at day 300;
  - 289 people (Hearthfolk 158, Cragborn 50, Reedkin 48, Duneshade 33) in 56 standing villages of 65;
  - save 13.3 MB; 20.4 min.

## World laws acceptance (2026-10-29)
- 215 tests pass. Classic unchanged: `forty` ee55506a781cb766, `modern` 479f5857575304ab (no laws set).
- Bench (the code before the phase, `9c1b3a2`, against now, two rounds, ms/tick summed over the six sizes): 4.32 →
  4.30 (−0.5%) and 4.25 → 4.18 (−1.7%).
- Laws run (`tools/cloud-laws-run.mjs 200 vast 7`): ok; 129 people on day 200, 34 of 35 villages standing,
  1.39 ms/tick; 6.9 min.

## Civilization laws acceptance (2026-10-29)
- 229 tests pass. Classic unchanged: `forty` ee55506a781cb766, `modern` 479f5857575304ab.
- Bench (the code before the phase, `8835aaf`, against now, two rounds, ms/tick summed over the six sizes):
  4.71 → 4.83 (+2.6%) and 5.02 → 4.63 (−7.7%). This machine was slower today than in earlier sessions (all
  numbers about 35% higher), so compare only within a day.
- World seed 11, 300 days: 4.60 ms/tick at day 300 with laws, 3.31 with no laws (same code, same day), 256 people,
  53 of 66 villages standing; 34.3 min.
- Side by side, 100 days, no laws: the code before Civilization laws 1.30 ms/tick at day 100, now 1.26.

## Mood, slice 1 (2026-10-29): new classic hashes
- Moods saved, and two new traits (Cheerful, Gloomy) change trait draws: `forty` 00d13c824c43dec4 (workshops era on
  day 5.94, 66 built), `modern` 33e51d33d37f815e (modern era on day 46.12, 90 built). 232 tests pass.

## Mood, slice 2 (2026-10-29): classic hashes
- 234 tests pass. `forty` 8345afce244873af (workshops era on day 6.46, 66 built), `modern` 3db6905a9e1dc4d5 (modern
  era on day 46.31, 90 built).

## Mood acceptance (2026-10-30)
- 236 tests pass. Classic: `forty` 8345afce244873af (workshops era on day 6.46), `modern` 3db6905a9e1dc4d5 (modern era
  on day 46.31).
- World seed 11, 300 days: 3.26 ms/tick at day 300, 258 people, 52 of 64 villages standing, 101 wars; save 13.0 MB;
  28.6 min.
- Bench, the code before Mood (`46bf5f4`) against now (two rounds, summed): 4.61 → 4.32 (−6%) and 4.29 → 4.60 (+7%):
  within noise.

## Phase 11, item 2 (2026-10-30)
- Goods set aside for a missing mod keep their village: 238 tests pass; classic unchanged (`forty`
  8345afce244873af, `modern` 3db6905a9e1dc4d5).

## Phase 11 baselines (2026-10-30, `tools/cloud-baselines.mjs`, seed 7)
- Raise stroke r8: Vast 40 ms its tick, 614 ms 43 ticks later; World 1,174 ms its tick. Forest stroke ≤ 29 ms.
- Long ticks, World 60 days: 0.72 ms/tick; slowest 210 ms (tick 1), then ≤ 108 ms (day start, on the hour).
- War, neighbours medium 2 days, both armed: war 0.40, peace 0.56 ms/tick.
- Animals, Vast 20 days: animals.js 3.8%, monsters.js 0.6%, hunt.js < 0.1% of CPU.

## Phase 12, slice 1 (2026-10-30): structured events
- The full suite: 238 pass (run before the new file existed); the 4 new tests in
  `tests/cloud-chronicle.test.js` pass on their own.
- `forty`: 8345afce244873af, unchanged (no event line is written in that run); 0.091 ms/tick, workshops era on
  day 6.46.
- Gameplay checked apart from the log: the state hash without `log`, `logKeys` and `chronicle` is the same
  before and after the change: `forty` 083cf9ca5bea8d96, `modern` 69abf41e3365aa5a (both runs, old and new
  code). The full `modern` hash was not rerun.

## Phase 12, slice 2 (2026-10-30): cause links
- The full suite passes, no failures (it now includes 7 tests in `tests/cloud-chronicle.test.js`).
- Gameplay unchanged: the hash without the log and the new event-id fields is still `forty` 083cf9ca5bea8d96,
  `modern` 69abf41e3365aa5a. (Both are single-village runs; the World run comparison is in slice 4.)
