# Phase 15: village memories and traditions

Status: **cloud part done** (2026-11-01; built and tested, not playable until the UI is wired at home; the owner: "You make the decisions"). Branch `cloud-work`. Scope:
the roadmap's Phase 15. Builds on Mood, Peoples and traits, Civilization laws, the chronicle (12), petitions
(13) and follow-through (14). Not a religion system, and not inherited traits: memories and traditions belong
to a village, not to people.

## Design (decisions)
### Memories (data: `memory`, `mods/core/content/memories.json`)
| Memory | Comes from (a recorded event) | Mood while held | Days held |
|---|---|---|---|
| Survived a famine | food under 1 day for 2+ days, then back to 4+ days (a new chronicle event) | −2 | 30 |
| Defeated a monster | a monster slain by the village's hunt party, or a lair cleared | +3 | 20 |
| Received aid | one of its prayers answered by a power | 0 | 30 |
| Endured a disaster | a destructive power (lightning, fire, meteor, quake, tornado, plague, drought) touching the village | −3 | 20 |
| Endured a war (added after the first World run) | sacked or conquered | −2 | 30 |
| Won a war (added after the first World run) | sacked or conquered another village | +2 | 20 |

- **Bounds:** at most 2 of a kind and 8 in all per village (the oldest go first); the memories' mood is one
  thought ("Memories"), capped at ±6.
- Each memory keeps the id of the event it came from.

### Traditions (data: `tradition`)
A village gains a tradition once it has gathered 2 memories of one kind (counted over its whole history), at most
3 traditions, kept for good. The tradition records the events behind it.
| Tradition | From | Effect |
|---|---|---|
| Hunters' pride | Defeated a monster ×2 | +2 mood ("Traditions" thought) |
| Frugal | Survived a famine ×2 | leans to rationing (an AI village rations by default, and its people do not mind it, as with any leaning) |
| Devout | Received aid ×2 | its prayers stay open 1.5× longer |
| Hardened | Endured a disaster ×2 | disaster memories weigh half on its mood |
| Wary | Endured a war ×2 | leans to a militia |
| Proud victors | Won a war ×2 | +1 mood (no war bonus, so winning does not feed more wars) |

### State (save format 37)
`settlement.memories [{ kind, t, ev }]`, `memCount { kind: n }`, `traditions [{ id, since, ev, why }]`,
`famine` (the tick food fell under 1 day). All optional.

## Slices
1. Memories, traditions, effects, format 37, chronicle events, tests.
2. Acceptance: two villages with different traditions for clear reasons (a test), a World run (how many, which),
   save and load, classic runs, bench, docs and UI notes.

## Not in it
Religion, temples, priests; traits passed to children; traditions that grow without bound.

## Results (2026-11-01)
- **Built and tested:** `src/sim/memories.js`, `mods/core/content/memories.json` (6 memories, 6 traditions),
  hooks in slay.js, war.js, petitions.js and god powers (`g.afterPower`), the two thoughts in mood.js, the
  leanings in civlaws.js; save format 37. Tests: `tests/cloud-memories.test.js`, plus checks in the real slay,
  conquest and sack tests.
- **A bug found by the full suite:** slay.js called `addMemory` without importing it, so slaying a monster
  threw. My own tests had called `addMemory` directly; the slay, conquest and sack tests now check that the
  memory forms through the real code.
- **World seed 11, 200 days, no player:**
  - with the first four memories only: 3 memories in all (famines are rare, monsters seldom slain, and aid and
    disasters need the player), no tradition. So the two war memories were added;
  - with them: 36 memories held and 20 villages with a tradition on day 200 (Proud victors 14, Wary 9; 25
    tradition events), within every cap; wars declared 43 (42 before); save and load identical.
- **Acceptance:** two villages with different traditions for clear reasons (a test: Hardened after two
  disasters, Hunters' pride after two monsters; in the World run victors and the beaten grow apart).
- **Classic runs:** `forty` and `modern` unchanged (8345afce244873af, 96a3ae6edf4692e1).
- **To watch:** Wary villages keep a militia, which counts in war strength; the World run shows no rise in wars,
  but it is a possible loop to look at in Phase 16 playtesting.
- **Not playable** until the UI is wired at home.
