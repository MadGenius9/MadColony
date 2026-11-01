# Phase 15: village memories and traditions

Status: **slice 1 in progress** (2026-11-01; the owner: "You make the decisions"). Branch `cloud-work`. Scope:
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

### State (save format 37)
`settlement.memories [{ kind, t, ev }]`, `memCount { kind: n }`, `traditions [{ id, since, ev, why }]`,
`famine` (the tick food fell under 1 day). All optional.

## Slices
1. Memories, traditions, effects, format 37, chronicle events, tests.
2. Acceptance: two villages with different traditions for clear reasons (a test), a World run (how many, which),
   save and load, classic runs, bench, docs and UI notes.

## Not in it
Religion, temples, priests; traits passed to children; traditions that grow without bound.
