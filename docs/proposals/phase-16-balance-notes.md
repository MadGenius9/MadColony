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

- **Long marches no longer kill whole villages by thirst** (combat.js, ai.js; 2026-11-06). Found in the browser
  viewer's 8-minute soak (Vast, seed 7, 189 days): 60 dead, 27 of thirst and 19 of hunger, nearly all in villages at
  war, whole villages within a day or two. Traced on a save from day 120 (Millbrook): a distant village with water
  every hour went to full detail for a war, ordered an attack on a village 216 tiles away, and its four fighters set
  off (one already at 15% water and 23% food); thirst runs from full to empty in about 17 hours, so they fought,
  fell back, and collapsed 110 tiles from home. Three changes:
  - an AI village marches only on a village within `COMBAT.raidReach` (80 tiles, centre to centre); a war declared
    on one farther away stands, but they defend (the player may still order a long march: the attack plan now
    warns of it);
  - fighters drink and eat (below the level they would go looking) before they march off;
  - on a march or a retreat with no enemy within engaging range, critical thirst or hunger stops them (the retreat
    order waits until they have drunk or eaten).
  - **Measured, the same world replayed in Node (identical to the browser run):** deaths in 190 days 60 → 35;
    thirst 27 → 8; hunger 19 → 4; people on day 190 189 → 226. Seed 11 (150 days) is unchanged: 20 → 19 dead,
    thirst 9 → 10; its thirst deaths are all at home (Kestrel Tor under attack on day 131; New First Hearth 2,
    one a day for six days). Classic hashes unchanged. Tests: `tests/cloud-marches.test.js`.

- **No endless fights with people of a village simulated at a distance** (combat.js, 2026-11-06). Traced on seed 11
  (day 138): hunters of New First Hearth 2 met people of Ravenhold, an enemy simulated at a distance, and fought
  them for 10+ hours; those people are summed up and healed every hour, so they never went down, and the hunters
  died of thirst in the fight (one a day for six days). Only enemies simulated in full are now engaged, and a fight
  already under way with such a person ends. A village under attack is still brought to full detail.
- **Both changes together, replayed:**

  | | Deaths | Thirst | Hunger | People at the end |
  |---|---|---|---|---|
  | Seed 7, 190 days, before | 60 | 27 | 19 | 189 |
  | Seed 7, after | 30 | 9 | 5 | 226 (after the first change) |
  | Seed 11, 150 days, before | 20 | 9 | 2 | 199 |
  | Seed 11, after | 16 | 5 | 1 | 202 (after the first change) |

  What is left is mostly the siege case below (a village under attack at home).

- **Villages simulated at a distance treat their sick** (medical.js `treatFar`, from lod.js; 2026-11-06). A survey
  of three more planets (Vast, 150 days; seeds 3, 21, 42) found sickness the top cause of death in two; on seed 42,
  15 of 19 deaths, 13 of them grey fever in distant villages during one epidemic (days 110–126). Distant villages
  fell ill and spread illness like full ones but were never treated, though 39 of 60 distant villages in the grown
  world held medicine. Now, each hour, each untreated illness, infection or wound there takes one dose of the right
  supply from the village's own stores (not reserved, not promised to a trade), while anyone is on their feet to
  give it: the same supplies and effect as the treat job, summed up. Seed 42, 150 days: deaths 19 → 6, sickness
  15 → 5. Classic hashes unchanged. Tests: `tests/cloud-farcare.test.js`.
- **The survey** (all fixes above except this one): seed 3, 17 deaths (7 of thirst, a warlike world: 42 wars);
  seed 21, 13 deaths (8 sickness, 3 cold, none of thirst); seed 42, 19 deaths (15 sickness).

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

- **Air conditioning / a cold store: checked 2026-11-06, not worth building now.** Only meat spoils (game and
  livestock meat, 10–20% a day), and goods are kept in outdoor stockpiles, so cooling would need a walled cold
  store, a hauling rule and a planner rule. The grown world (868 people, day 300) lost 86 cuts of meat (65 venison,
  21 horse meat) and 27 carcasses to spoilage in 300 days, against about 2,300 cuts made: under 4%. Cold weather
  already slows it (`spoil.js`). Worth revisiting only if more foods are made to spoil.

## For the playtest at home (needs the UI)
Can players follow events and find interventions worth making? Long runs with save and load; deleted or destroyed
subjects; expired petitions; repeated interventions; event retention; missing-mod recovery; hints for the new
controls. None of it can be judged without the UI.
