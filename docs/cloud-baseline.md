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
| `forty` (seed 20261021, 40 days) | 40 | 0.039 | 65.5 ms | 5 | 65 | Workshops 6.04 | 0 errors | `66565ccb7cc6e19a` |
| `modern` (seed 4242, Advance to Modern) | 35.72 | 0.047 | 45.9 ms | 5 | 89 | Workshops 6.1, Industry 11.5, Electric 17.25, Modern 35.72 | 0 errors | `b2acaf9064cf4914` |

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
