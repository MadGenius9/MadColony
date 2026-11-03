# Phase 10: leftovers (design note, cloud copy, 2026-11-03)

From docs/ROADMAP.md: "Families (partnerships, old age, more professions), contraband selling policy, scripting
API for mods, zip mod packages. Then a review of the Ideas parking lot before anything else is planned."

## What exists (survey, 2026-11-03)
- **Families:** a child stores `parents`; children and siblings are worked out on the fly (`chronicle.js
  familyOf`).
  - There is no partner, and people.js says so: "there is no romance or relationship system".
  - A birth takes the first two bed owners of a home as the parents. Homes are filled from the homeless in order,
    with no family preference.
  - Grief counts housemates, parents and children (not siblings).
- **Old age:** built in Phase 5 (`life.js`: elders work more slowly, death past `deathAge`, the Ageless law) in the
  Vast world, Living world and blank worlds. The roadmap still lists it as planned; that line is out of date.
- **Professions:** four qualifications in `education.json` (schooled, teacher, physician, engineer), as speed
  bonuses; nothing requires one.
- **Contraband:** the engine and the optional `contraband` mod are done. Still planned: a player-side automatic
  selling policy, whose consequences the UI shows before the player picks it.
- **Scripting API, zip packages:** not started. `tools/pack-mod.js` (the JSON mod packer) is not in this rescue
  copy, and running uploaded scripts is a browser-side and security decision.

## What is done here, and what waits for home
- **Here:** partnerships and family housing (slices 1–2); more professions (slice 3); the engine half of an
  automatic selling policy for controlled goods, off by default and changing no current game (slice 4).
- **Home:**
  - the scripting API: what may run, in what sandbox, with which hooks; this needs the owner's decision;
  - zip packages and mod icons (the browser importer and the packer are home code);
  - the selling policy's UI.

## Design (decisions)
### Partnerships (slice 1)
- **An optional colonist field `partner`** (a colonist id; format 43, absent means none).
- **Forming:** once a day (game.js DAILY_JOBS), in each village, each unpartnered adult has a small hashed chance
  (PARTNER.chance) to pair with the unpartnered adult of the same village they get on with best. "Get on with" is
  a hash of the two ids (stable); people of the same people get a bonus.
  - Never with a parent, a child or a sibling.
  - Gender is not modelled in the game and is not used.
  - Log and chronicle: "A and B of V are now partners" (routine).
- **Ending:** a partner's death leaves the other unpartnered, grieving as for close family. The dead keep their
  partner's id, so the chronicle can name them. Moving to another village (founding, migration) ends the
  partnership unless both move.
- **Births:** a home's parents are a couple living there if there is one, otherwise the first two bed owners as
  now. Only who is named as parents changes; the chance and its draw stay as they are.
- **Grief:** a partner counts as close family (`burial.js mourn`).
- Hashed draws only (no rng stream), so the rest of the game's draws are unchanged.

### Family housing (slice 2)
- When beds are assigned, a homeless adult whose partner has a home with a free bed goes there, and children go
  to a parent's home, before the plain order.
- When a new home is finished, a couple living apart may move together into it.
- Reasons are shown.

### More professions (slice 3)
- Data only, with the existing qualification machinery: farmer, builder, smith (from practice) and a college
  curriculum (from study), each a speed bonus for its work.

### Selling policy (slice 4, engine)
- A per-village policy `settlement.contrabandPolicy` (`never` default, `licensed`, `any`): which controlled goods
  the player's village offers to traders by itself.
- The consequences come from the existing enforcement rules: attention, seizure and law.
- Off by default, so no current game changes. The UI (home) shows the expected attention before the player picks.

## Slices
1. Partnerships (format 43), births' parents, grief; tests; classic and World runs.
2. Family housing.
3. Professions (data).
4. Selling policy (engine), off by default.
5. Acceptance, then the Ideas parking-lot review (a list for the owner, not new work).

## Results
### Slice 1: partnerships (built and tested, 2026-11-03)
- **Built:**
  - `src/sim/family.js` (`partnerOf`, `closeKin`, `liking`, `tickPartners`, a new daily job after
    `tickLivestockDay`);
  - the optional colonist and dead `partner` (format 43, save checks);
  - births name a couple living in the home as the parents (`people.js`; the chance and its rng draw are
    unchanged);
  - grief counts a partner (`burial.js`);
  - the chronicle kind `core:partners` (routine).
- **In play:** Living world, seed 5: 26 of 51 people partnered after 18 days.
- **Tests:** `tests/cloud-family.test.js`, 4 tests: pairs both ways within a village, never close family; a partner's
  death frees the other and brings grief; save and load identical, old saves unpartnered, a bad field refused; a
  couple named as the parents of a child born in their home.
- **Changed test:** `cloud-spread.test.js` "the day-start jobs run one a tick" now watches the first 30 ticks of the
  day instead of 20: there are 21 day-start jobs. Same assertions.
- **Classic runs** (intended change, proposed): the era days are the same as before (`forty` workshops 6.59;
  `modern` 7.27 / 14.55 / 18.75 / 44.41). The hashes change by the partner fields: `forty` 3f9025f579d6a2d9,
  `modern` 987ed5c0f0482498. Full suite 320 passed.

### Slice 2: family housing (built and tested, 2026-11-03)
- **Built** (`construction.js assignHome`): beds go first to someone whose partner or parent lives in the home, then
  to homeless couples (each followed at once by the other), then to the rest in the usual order. Moving couples
  who already live apart into a new home together is not done: assigning beds never moves anyone housed.
- **What it changed:**
  - The classic 40-day run: couples share homes, the workshops era comes on day 5.43 (was 6.59), and the hash is
    7fa8ee19278e5103 (proposed). `modern` is unchanged (987ed5c0f0482498).
  - **The firefighting test** (`cloud-wrath.test.js`, seed 7, a home set alight at midnight) fell from 56 buildings
    standing (26 without firefighting) to 34 (28). Only awake adults fight fires (Phase 5b). With couples housed
    together, the couple in the next home slept through the fire. The test now runs the same fire on seeds 7, 8 and
    9: at least as much stands on each with firefighting, and more than 10 more in all (now 34/28, 50/37, 41/37:
    23 more). That is stronger per seed than the one seed it had.
  - **Whether sleepers should wake for a fire next door** is a firefighting design question for the owner, not
    changed here.
  - **The pen play test** (`cloud-pens.test.js`): the pair was now tamed only on day 48 (pen closed on day 18).
    Tracing it showed taming barely worked: tamers came within 2–6 tiles of a fleeing cow and gave up.
    - Fixed in `livestock.js`: a tamer catches within 3 tiles (a rope's reach; it was 1.5), and taming is urgency
      0.9 (was 0.5; at 0.5 nobody took it for days).
    - Now the pair is in the pen the day it is closed (day 18). Both changes were needed.
- **Tests:** a housing test in `cloud-family.test.js`; full suite 321 passed.

### Slice 3: more professions (built and tested, 2026-11-03)
- **Built** (`mods/core/content/professions.json`, data only, with the qualification machinery of education.js):
  - farmer (Farming 7: farm work ×1.2, also milking and shearing);
  - builder (Construction 7: building ×1.2);
  - huntsman (Hunting 6: hunting ×1.2);
  - cook (Cooking 7: cooking and butchering ×1.2).

  All are earned by practice and never required; the log says "P is now a qualified Farmer through practice".
- **Classic runs** (intended change, proposed): `forty` 9f293a56bce0c53c (workshops on day 6.64, was 5.43 after
  slice 2); `modern` 8e0ecba41839e932 (modern era on day 43.04, was 44.41).
- **Changed test:** `cloud-mood.test.js`, "a miserable family may leave". On day 8 the first AI village's only
  family now has someone down, and such a family never leaves. The test picks the AI village where nobody is down
  as the one that leaves, and asserts that one exists. Same assertions after that.
- **Tests:** a professions test in `cloud-family.test.js` (earned at the skill level, not below; the right work
  only). Full suite: 321 passed, plus the changed mood test.
