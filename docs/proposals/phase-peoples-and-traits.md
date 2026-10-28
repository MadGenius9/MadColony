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
| **Hearthfolk** | grass, farmland | today's palette, average height | as today | as today | 1 (as today's default) | today's cabins and longhouse |
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
- **On load** (`save.js`), like missing skills today:
  - a people a removed mod defined, or one other than the village's, becomes the village's people;
  - unknown traits, and a trait beside its opposite, are dropped (the person keeps the rest).
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

## Results
### Slice 1 (2026-10-28): the records
- **Built:**
  - **Content types** `people` and `trait` (`content/types.js`), with the four peoples and eleven traits as data
    (`mods/core/content/peoples.json`). Village profiles may name a `people`.
  - **`src/sim/peoples.js`:**
    - the default people;
    - traits drawn by hash (`${seed}:${id}`, never `g.rng`);
    - inheritance at birth, one hash per parent trait plus 8% for a new one;
    - `modsOf`, the combined effects as a derived cache. Nothing reads it yet: behaviour is unchanged.
  - **Every place a colonist is made** gives people and traits: the new game, AI villages, births, divine
    settlers. Daughter villages take their founders' people. The dead keep people and traits.
  - **Save format 30**, validated. Old saves are filled on load with the village's people and the same hashed
    traits a new game gives, so an old save plays on exactly as a new one.
  - **The census** counts the living by people and checks every person is of their village's people (the
    owner's answer 4).
- **Not yet:** a per-people ledger (born + spawned − died per people). It needs a start count per people and
  arrives with the slices that bring other peoples into play (5 and 6).
- **Tests** (`tests/cloud-peoples.test.js`, 5):
  - classic colonists;
  - old saves and mended records;
  - combined effects and inheritance;
  - AI villages, births and divine settlers;
  - a Reedkin village and its daughter.

### Slice 2 (2026-10-28): effects on work, learning, walking, tending, needs, illness, healing and cold
- **Built** (each reads `modsOf`, one cached object per colonist):
  - **work** (`jobs.js workSpeed`): all work, by skill (people and Strong), and treating patients (Kind);
  - **learning** (`practice`): Wise;
  - **walking** (each step's ticks): Quick, Duneshade;
  - **tending:** Kind;
  - **need decay**, at full detail (`needs.js`) and in distant villages (`lod.js` hourly needs);
  - **illness:** the chance to catch it from someone (Sickly) and each case's strength (Hardy, Sickly);
  - **healing** (`health.js`): Hardy, Sickly;
  - **the cold** (`life.js coldUnder`): the line moves by the people's and traits' `cold`.
- **Visible reasons:** catching an illness says "(sickly)". The other effects show as the traits on the
  inspector card (UI note).
- **Not built:**
  - "marsh walks at full speed for the Reedkin" (no per-people ground cost yet);
  - trip estimates (`trips.js`) still use the plain decay rates.
- **Tests:** each effect against a twin without it; the cold line at midwinter; a Vast world with all four
  peoples mixed in plays, saves and loads the same, everyone counted.
- **Checks:**
  - 197 tests pass;
  - classic `forty` reaches the workshops era on day 6.10 (was 5.94), `modern` the modern era on day 46.12 (was
    45.5);
  - bench about +7% against slice 1 (two rounds: +11% and +4%).
### Slice 3 (2026-10-28): courage, greed, favourite food, feuds between peoples
- **Built:**
  - **Fighting** (`combat.js`): the health needed to fight is the trait's `fightHp` (Brave 30, Timid above
    100: never), else 50, through `fitHpOf`. It also decides who counts as a fighter (`fightersOf`, war
    strength). Timid people flee from 8 tiles (others 5).
  - **Wolves** (`hunt.js`): an armed Brave person stands at over 25% health (others 40%). A Timid one always
    runs.
  - **Hunt parties** (`slay.js`): Timid people never join; Brave ones take the job first (urgency 1.9 against
    1.6).
  - **Statuses:**
    - "Fighting X (brave: fighting on while hurt)";
    - "Timid: fleeing from the fight";
    - "A wolf came close (brave: standing while hurt)";
    - "Timid: running from wolves" and "Timid: running from the Thornback".
  - **Greed** (`villages.js greedOf`): a village asks 3% more per greedy adult, at most 15%. The offer screen
    says "Greedy folk there: they ask 6% more."
  - **Favourite food** (`needs.js findFood`): a stack of the people's favourite counts 25 tiles nearer. Meals
    still come first.
  - **Temperament:** a village without a profile temperament uses its people's (Hearthfolk 1, as today's
    default).
  - **Feuds:** rivalry grows ×1.5 between villages of different peoples, and the reason names both peoples
    (the owner's answer 5).
- **Not built:**
  - favourite food in distant villages (their food is picked for the whole village);
  - greed in trades between two AI villages (only offers to and from the player use it).
### Slice 4 (2026-10-28): names and looks
- **Built:**
  - **Name pools:** each people may name a `namePool` (`names.js namePoolOf`). Reedkin, Cragborn and Duneshade
    have their own 24 first names and 8 surnames, all invented for this game. Hearthfolk keep the scenario's.
  - **Look palettes:** each people may give a `look` (skin, hair, trousers, hair styles, build and height
    ranges, beard chance; `appearance.js makeLook`).
    - Without one (the Hearthfolk), looks are drawn exactly as before.
    - The palettes use the existing hair styles only. A "wrapped" style for the Duneshade is a UI note.
  - **Children take after their parents** (`inheritLook`): skin and hair each from one parent, build and
    height between theirs, the rest their own.
  - **Where:** AI villages, divine settlers and births use their people's names and palette.
  - **Already done in slice 1:** traits inherited at birth.
- **Classic:** a child born now takes after the parents, so their look differs from before (play does not).
  The classic runs have no births, so their hashes are unchanged. 201 tests pass.
