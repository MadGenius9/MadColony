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
