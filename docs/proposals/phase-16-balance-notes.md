# Phase 16: balance notes from the cloud copy (2026-11-04)

Phase 16 (playtesting and balance) depends on the home build: players following events, the hints and the
tutorial cannot be judged without a UI. This note gathers what the cloud copy's long runs found about balance, what
was changed (each a small, measured step), and what is left for the playtest at home.

## Changed (built and tested)
- **Raided villages arm themselves** (planner.js): a full-detail village attacked by a pack arms two hunters
  urgently, whatever its meat. The planner's raid branch never ran for full-detail villages. Living world seed 7:
  the village used to die out by day 15; now 6 live and none died.
- **Taming works** (livestock.js): a rope's reach (3 tiles, was 1.5) and urgency 0.9 (was 0.5). Tamers had kept
  failing to catch fleeing cattle; a pen now gets its pair the day it is closed (was 12–30 days later).
- **Pens grow before they are culled for meat** (livestock.js, `FEED.meatSpare`): a pen is culled for meat only
  once it is 2 beyond its breeding pair (a full pen still loses its youngest). Culling at once kept every pen at
  its pair in the World runs. Test in `cloud-pens.test.js`.
- **Sleepers wake for a fire next door** (owner, 2026-11-04), and tiredness does not end a firefight.
- **Groves:** villages short of trees plant them (forestry).

## Found, not changed (for the playtest)
- **Thirst under siege.** In the 300-day World run (seed 7), 14 died of thirst; in a later run of the same seed, 2,
  both in Rushmead. It was traced on a save from day 182:
  - Rushmead (4 people) has a well and a lake 5 tiles from its centre;
  - a war made it a full-detail village, and its needs, held full while distant, began to drain (about 17 hours
    from full to empty);
  - for the next 16 hours its people marched, fought, fled from attackers in the village, and fetched medicine for
    the wounded. Fighting and fleeing are never interrupted by needs, and an enemy was always near;
  - hunger, thirst and energy reached zero in the same few hours, and they collapsed.
  - A change that let a critical need end a march or a retreat with no enemy near was tried and made no
    difference here (the enemy was near), so it was taken out.
  - **For the owner:** should someone fleeing in their own village stop for water at a well next to them? Or
    should a village that becomes full-detail in a war start with needs that reflect the last day? Both change
    war balance.
- **Wolves** (Phase 9 note, the Living world seed 7 case): fixed by the raid branch above. The other suggested
  levers (packs tiring of a village, people finishing a drink when a wolf is not right there) are left.
- **Livestock is rare** (2 pens in a 200-day World run): pens need 6 people in a full-detail village. It waits on
  the growth decision.
- **Coats did not visibly cut deaths from cold** (6–8 a run, in different worlds); whether the frozen were in
  distant villages, which get no coats, is not known.

## For the playtest at home (needs the UI)
Can players follow events and find interventions worth making? Long runs with save and load; deleted or destroyed
subjects; expired petitions; repeated interventions; event retention; missing-mod recovery; hints for the new
controls. None of it can be judged without the UI.
