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

