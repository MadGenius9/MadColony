# Balance: the feud between peoples, and hunting as food

Status: **in progress** (2026-10-31). The two open decisions from Phase 11, item 4 (`docs/proposals/
phase-11-integration.md`). The owner left them to me ("You make the decisions"; on hunting: "Hunting is a
source of food").

## What the Phase 11 report found (World seed 11, 200 days)
- Wars: 55 declared; 27 without the ×1.5 faster rivalry between villages of different peoples. The feud
  between peoples is the main driver of war.
- Meat was 0.8% of raw food. Villages hunt only while they hold under 2 meat a person, and a distant
  village sends one hunter an hour at most. Herds shrink mostly from winter and crowding, not hunting.

## Decisions
1. **Feud:** `OTHER_PEOPLE_RIVALRY` 1.5 → 1.2. Different peoples still drift apart faster than kin, and peoples
   still keep apart (unchanged), but wars should fall to roughly between the two measured numbers.
2. **Hunting when food is short:** a village with under 3 days of food (its plan's `foodDays`) hunts until it
   holds twice the usual meat (4 a person instead of 2), and a distant village then sends up to 2 hunters an
   hour instead of 1. The hunting limit that protects herds (animals.js) is unchanged, and so are the Hunting
   law and its restrictions.

## Checks
- Regression: the rule is a pure function (`meatWanted`) with a unit test; the old peoples test keeps its
  assertion, written against the constant.
- World seed 11, 200 days, before and after: wars declared, meat share, herds, people, speed.
- Classic hashes change (single villages hunt); recorded.
