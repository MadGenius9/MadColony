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

## Results (2026-10-31)
Two worlds, 200 days each (World size; `tools/cloud-world-run.mjs 200 world <seed>`):

| Version | Wars declared, seed 11 | Seed 7 | Meat share of raw food, seed 11 | Seed 7 | People day 200, seed 11 | Seed 7 |
|---|---|---|---|---|---|---|
| Before (`8c8505a`) | 55 | 14 | 0.9% | 1.9% | 272 | 275 |
| Feud ×1.2, hungry rule (`33090a3`) | 30 | 13 | 0.9% | 2.0% | 280 | 268 |
| + 2 distant hunters, arming reach 60 (`ae5080f`) | 61 | 11 | 1.2% | 1.7% | 291 | 286 |

- **Wars are chaotic:** any change reshuffles which villages fight, so one world proves little (seed 11 swung
  55 → 30 → 61 while seed 7 moved 14 → 13 → 11). Over both worlds the lower feud gives fewer or equal wars; the
  Phase 11 report (no feud at all: 27 against 55) points the same way. **Kept: ×1.2.**
- **Why villages hunt little** (a diagnostic over days 10–60 of seed 11, per village a day): 48% had no weapon
  at all (a spear needs a workbench), 43% were armed, near a herd and short of meat but brought in little (one
  hunter an hour), and the food was almost never under 3 days (the 10th percentile was 6 days).
- **2 distant hunters:** no consistent gain (meat +0.3 points in one world, −0.2 in the other). **Reverted to 1.**
- **The arming reach** for distant villages now matches the hunting reach (60, was 40): a consistency fix; it
  changed nothing in the run (identical numbers with and without it). **Kept.**
- **The hungry rule** (twice the meat wanted under 3 days of food) acts only in a famine, which these worlds
  rarely reach. **Kept** as the owner's intent ("hunting is a source of food") for hard times.
- **What would make hunting matter more:** weapons. Young villages cannot make a spear before they have a
  workbench. Letting them hunt earlier (a simple hunting weapon without a workbench, or trapping) is a design
  for a later phase, not a number to tune.
