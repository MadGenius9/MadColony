# Peoples and traits (2026-10-24 direction, item 5)

Status: **building** (2026-10-28; the owner's answers below). Branch `cloud-work` (cloud rescue copy; see
CLAUDE.md).

## The owner's answers (2026-10-28)
1. **The four peoples:** keep Hearthfolk, Reedkin, Cragborn and Duneshade for now.
2. **Classic games:** left to me. **Traits in every game, classic too**, as with monsters: one rule everywhere,
   and the change to classic play is small. Classic colonists are Hearthfolk.
3. **More traits:** added **Quick** (walks ×1.1), **Strong** (mining, woodcutting and construction ×1.1) and
   **Kind** (tends and treats the sick and hurt ×1.3).
4. **Mixed villages:** **peoples keep apart.**
   - A village holds one people.
   - `spawn` with `join` is refused for another people ("Reedkin will not settle among Cragborn").
   - Daughter villages take their founders' people.
   - Conquest already keeps villages apart (the beaten village joins the winner's kingdom; nobody moves), so a
     kingdom may hold several peoples.
   - Children have their parents' people (both parents are always of the village's people).
5. **Feuds between peoples:** yes. Border rivalry grows ×1.5 between villages of different peoples.
6. **The `trait` power:** yes, for players who want to use it.

## Goal (from the owner and the roadmap)
- **Peoples:** 3–4 original peoples, each with its own looks, needs, preferences, temperament and building
  style. This replaces "Multiple races" in the parking lot.
- **Traits:** individual traits that children inherit (brave, greedy, wise, sickly, ...) and that change
  behaviour.
- **God powers:** the gods can spawn each people.
- **Original only:** WorldBox's breadth, never a copy. No humans, elves, dwarves or orcs, and none of its
  race designs.
- **Rules for every phase:**
  - determinism across save and load;
  - conservation (items, people);
  - sim and UI kept apart (UI notes in `docs/ui-todo.md`);
  - old saves load (`migrate.js` and a format bump);
  - content as data;
  - works for 30+ villages;
  - visible reasons;
  - never weaken a test;
  - the bench within 10%.

## What exists today (an explorer's audit)
- **The colonist record:**
  - skills, needs, `look {skin, hair, style, pants, build, height, beard}` (a hash, `appearance.js`), `color`,
    name, life stage and age, `parents` for children, health, immunity and lasting injuries;
  - no people, trait, sex, temperament, mood or preference field.
- **Where colonists are made:** in five places, each writing the record by hand:
  - the new game (`game.js:143`);
  - AI villages at world start (`villages.js:271`);
  - births (`people.js:126`);
  - the spawn power (`godspawn.js:190`);
  - daughter villages, which move existing people (`founding.js:539`).
- **Children inherit** only a colour and a surname. Their look is a fresh hash and their skills start at 0.
- **Names:** one name pool per scenario (25 first names). Births draw a first name with `g.rng`.
- **The hook points, each a single place:**
  - `workSpeed` (`jobs.js:35`), also used by distant villages;
  - skill gain (`practice`, `jobs.js:54`);
  - need decay (`needs.js:11`, repeated in `lod.js:341`);
  - each illness case's strength (`illness.js:87`, `hardy`);
  - the cold (`life.js coldUnder`);
  - fight or flee:
    - `combatDecision` (`combat.js:267`; hp ≥ 50 and armed fights);
    - wolves (`hunt.js:77`; hp > 40 fends them off);
    - monster hunt parties (`slay.js partyJob`).
- **Village "culture" today** is the `villageProfile`:
  - colour, settlement names, start items, policy, trade, laws;
  - `temperament` 0–5, used only for how fast border rivalry grows (`war.js:55`).
- **Homes:** the largest unlocked home template that fits (`civic/sites.js:12`):
  - cabin single, cabin double and longhouse;
  - materials are chosen per slot (`construction.js:150`).
- **Distant villages keep full colonist records:**
  - only the per-tick AI is skipped;
  - work speed, need decay, health, illness, births and aging all run on the records;
  - so trait effects placed in those functions reach them at no extra cost.
- **No mood system** (`burial.js:10`). The only "feelings" are grief (slower work) and shelter.

## Design

### Four original peoples (data: `mods/core/content/peoples.json`, new type `people`)
Each people is matched to land the brushes can paint (grass, marsh, hills and snow, desert).

| People | Home land | Looks | Needs and body | Work | Temperament (war rivalry 0–5) | Building style |
|---|---|---|---|---|---|---|
| **Hearthfolk** | grass, farmland | today's palette, average height | as today | as today | 2 (as today) | today's cabins and longhouse |
| **Reedkin** | marsh, rivers, coast | small and slight; green-brown skin tones, reed-dark hair | thirst ×1.3, hunger ×0.85; marsh walks at full speed for them | farming and cooking ×1.15, mining ×0.8 | 1 (slow to anger) | a raised reed house (thatch and wood, cheaper in wood, needs straw) |
| **Cragborn** | hills, mountains, snow | tall and broad; grey and ruddy skin, pale hair, more beards | hunger ×1.2; cold sets in 6 °C later | mining and construction ×1.15, farming ×0.9 | 4 (proud, quick to feud) | a stone roundhouse (stone walls preferred in every slot) |
| **Duneshade** | sand and desert | lean; deep bronze skin, dark hair, wrapped style | thirst ×0.6; cold sets in 4 °C sooner; rest outdoors lasts longer | crafting and trading; hauling walks ×1.1 | 3 | a low clay-and-wood courtyard house (fewer windows, a shared hearth) |

- **Data per people:**
  - name and plural;
  - look palette (skin, hair, styles, height and build ranges): `appearance.js`'s palettes move to data;
  - name pool;
  - need multipliers;
  - cold offset;
  - work multipliers by skill;
  - favoured terrain;
  - temperament;
  - home templates;
  - material preference;
  - trait odds.
- **Hearthfolk are exactly today's colonists.** A people with no multipliers changes nothing.
- **Preferences** (with no mood system) steer choices only:
  - **food:** each people eats its favoured food first (Reedkin beans, Cragborn meat, Duneshade berries,
    Hearthfolk stew);
  - **land:** daughter villages and the AI's land choice favour the people's home terrain.
- **Villages:** each settlement has one `people` (the owner's answer 4), its founders'. It sets the home style,
  the name pool and the people of everyone born there.
- **Feuds:** border rivalry grows ×1.5 between villages of different peoples (answer 5).

### Traits (data: `mods/core/content/traits.json`, new type `trait`)
Each person has 0 to 2 traits. Opposite traits never go together.

| Trait | Effect (all numbers in data) | Opposite |
|---|---|---|
| **Brave** | fights while hp ≥ 30 (others 50); fends wolves off at hp > 25; first to join hunt parties | Timid |
| **Timid** | never joins a fight or hunt party unless cornered; flees at 8 tiles (others 5) | Brave |
| **Hardy** | illness strength ×0.6; heals ×1.25; cold sets in 2 °C later | Sickly |
| **Sickly** | catches illness at ×1.5 the chance; illness strength ×1.4; heals ×0.8 | Hardy |
| **Wise** | learns skills ×1.5; teaches ×1.25 (education) | — |
| **Diligent** | work ×1.1 | Lazy |
| **Lazy** | work ×0.9; rests a little longer (energy seek threshold lower) | Diligent |
| **Greedy** | eats ×1.1; a village asks 3% more in trade per greedy adult (at most +15%) | — |
| **Quick** | walks ×1.1 (each step takes 1/1.1 the ticks) | — |
| **Strong** | mining, woodcutting and construction ×1.1 | — |
| **Kind** | tending and treating patients ×1.3 | — |

- **Effects are a few kinds:** work (all or by skill), walking, tending, learning, a need's decay, illness chance and strength, healing, cold
  offset, fight hp, flee range, trade margin.
- **Assignment:**
  - **New people** (new game, world-start villages, spawned settlers): each trait comes from a hash of the
    person's key at that people's odds (about 40% have none, 45% one, 15% two).
  - Hashes only, never `g.rng`, so existing draws do not move.
- **Inheritance at birth:**
  - each of a parent's traits passes on at 40% (a hash of `seed:born:id:trait`);
  - plus 8% for a new trait;
  - opposites and the cap of 2 settle conflicts;
  - **people:** the parents' people (villages keep apart, so both parents share it); each look part comes from
    one parent's (by hash), within the people's palette.
- **Speed:** each colonist's combined modifiers are a small derived cache, never saved:
  - built from people and traits on load and whenever traits change;
  - the hot paths (`workSpeed`, need decay, `tickHealth`, combat checks) read one number each, with no list
    scans.

### Visible reasons
- **Statuses name the trait:** "Fled: timid", "Joined the hunt party: brave", "Caught the fever (sickly)".
- **The planner's trade note** names the greedy surcharge.
- **The inspector** shows people, traits and what each does (UI note).
- **Village panels** show the mix of peoples and the home style.

### God powers
- **`spawn`** takes `people`. By default the people of the village joined, or for `found` the people whose
  home land is under the cursor. The preview says it ("found Reedkin village here").
- **A new `trait` power** gives or removes one trait on one person. It costs favour (about 15) and is free in
  Sandbox. The preview names the opposite trait it replaces.

### Saves (format 30)
- `colonist.people` and `colonist.traits` (a list, at most 2), `settlement.people`, `dead.people` and
  `dead.traits`.
- **Old saves** (`migrate.js` step 29):
  - every colonist and village becomes Hearthfolk;
  - traits come from the same hash as new people, so a loaded old save and the same game continued give the
    same traits.
- **Unknown people or traits** (a mod removed) fall back to Hearthfolk and no trait on load, like missing skills
  today.
- **The census:** `peopleCensus` also counts by people (born + spawned − died = living, per people).

### Scale
- **Per tick:** nothing new beyond reading the cached modifiers.
- **Distant villages:** they get work, need, health and illness effects through the shared functions; combat
  traits matter only at full detail, as combat does today.
- **Bench target:** within 3%.

### Classic games
- **Classic colonists are Hearthfolk,** so the people layer changes nothing there.
- **Traits do change behaviour** (a diligent woodcutter, a timid hunter), so the classic hashes and era days
  move.
- Question 2 asks whether classic games get traits.

## Slices
1. **Data and records:**
   - the `people` and `trait` types, the four peoples and eleven traits;
   - fields at all five creation sites by hash;
   - the save format 30 migration, validation and the census by people;
   - the modifier cache.
   - No behaviour change yet (Hearthfolk everywhere).
2. **Trait and people effects** on work, learning, needs, illness, healing and cold, with statuses.
   - Tests: each effect against a twin without it, and distant villages.
3. **Courage:** brave and timid in `combatDecision`, wolves and hunt parties; the greedy trade margin; food
   preferences.
4. **Births:** inheritance of people, traits and looks; a name pool per people; look palettes moved to data.
5. **Building styles:**
   - the three new home templates (reed house, stone roundhouse, courtyard house), chosen by the settlement's
     people;
   - material preference;
   - land preference for daughter villages and AI villages;
   - Living and Vast worlds give their AI villages peoples by home terrain.
6. **God powers:** `spawn` with `people`, and the `trait` power.
7. **Acceptance:**
   - a World 300-day run with all four peoples (each survives somewhere, all counted, save and load
     identical);
   - the classic runs, the bench, README and roadmap.

## Targets
- **Mixed worlds:** each people lives and grows in its own land in the Vast run, and no people dies out by day
  100.
- **Old saves load** as Hearthfolk with hashed traits.
- **Every effect is visible** in a status or note.

## Open questions (answered; see "The owner's answers")
1. The four peoples. 2. Classic games. 3. The traits. 4. Mixed villages. 5. Feuds between peoples. 6. The
   `trait` power.
