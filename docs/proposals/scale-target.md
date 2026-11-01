# Scale target: thousands of people by day 300 on the World preset

Status: **measuring** (2026-11-01). Branch `cloud-work`. The roadmap's direction item 7: "thousands of people
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
