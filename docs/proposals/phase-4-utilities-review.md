# Phase 4: utilities at scale (review)

Status: **review done; no new system needed** (2026-11-02; the owner: "You decide and keep going"). Branch
`cloud-work`. The roadmap's Phase 4: "Review water, plumbing and heating for cost at scale and add abstract
versions for distant villages. Cooling and room lighting stay parked."

## Phase 3 first? (why this comes before Phase 3's open slices)
- The roadmap's order is Phase 3 (finish electric production), then Phase 4. Phase 3's design note
  (`docs/proposals/phase-3-electric.md`) is on the home PC only.
- This copy's roadmap lists slice 4 (power storage) as open, yet batteries are already in the code and the save
  format (format 14: `structure.charge`; `power.js` charge and discharge; batteries in `machines.json`). So slice
  4 looks done at home, with the roadmap here behind.
- Building slices 5–6 without their design note risks clashing with decisions made at home. They wait for it;
  this utilities review needs no such note.

## Measured (the grown world: 868 people, 62 villages, 23,500 buildings, day 300)
| Utility | Cost | How it scales |
|---|---|---|
| Heating (`tickHeat`, every 50 ticks) | 2.0 ms a time (0.04 ms a tick on average) | 1,052 rooms, 732 heaters, all villages |
| Rooms (`rooms`) | rebuilt only where walls changed; the wall list is now re-read only after a building change (scale target §12) | O(walls) at a building change |
| Room lookups for people (`tempAt`, `sleepWarmth`) | about 5% of the slow ticks' time | O(people), per tick |
| Water networks (`waterNetworks`) | 0.02 ms (cached per settlement) | 994 pipes, 79 taps |
| Plumbing in a plan (`planPlumbing`, `pipePath`) | about 5% of the slow ticks' time | a search of up to 4,000 tiles per plan while a network is not joined |

## Distant villages
- **Water:** already abstract. A distant village drinks if it has a working tap or water building, or a
  drinkable shore within walking reach of its centre (`lod.js hasWater`), the same rule the planner uses at full
  detail.
- **Heating:** the same room model for all villages. A distant village's hearths burn their own fuel and warm its
  rooms, and its people's cold is read from their room (`life.js coldUnder`).
- An extra abstract version would duplicate this without saving measurable time.

## What is left (proposed, not built)
1. **A failed pipe search is repeated every plan** while a network cannot be joined (the plan notes "No room to
   lay a water pipe"). Remembering the failure until the ground near the network changes would save most of
   that 5%. That needs a careful definition of "the ground changed" (stacks, crops, nodes, zones and claims all
   matter), so it belongs to Phase 18's profiling-led work.
2. **Room lookups per person:** a per-tick cache of each person's room would cut the repeated lookups. People
   move every tick, so the saving is small; also Phase 18.
3. **Cooling and room lighting** stay parked, as the roadmap says.
