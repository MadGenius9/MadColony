# Mood (2026-10-29 direction, item 6c)

Status: **building** (2026-10-29; the owner's answers below). Branch `cloud-work` (cloud rescue copy; see
CLAUDE.md).

## The owner's answers (2026-10-29)
1. **Classic games:** left to me. **Mood in every game**, classic too, as with traits and monsters: one
   rule everywhere, and the classic change is small.
2. **Breaks:** yes. Miserable people sometimes stop work for a few hours.
3. **Leaving:** left to me. **A miserable family in a village in unrest may move to another village of its
   own people that has room** (as settlers, carrying nothing; peoples keep apart). Otherwise unhappy families
   are first in line for daughter villages.
4. **The player's village under unrest:** not sure, so mine: **warnings and people leaving only.** The
   player's laws are never forced: who rules the village is the player's call.
5. **Thoughts:** the list as proposed.
6. **Cheerful and Gloomy:** yes, two new traits.

## Goal (from the owner and the roadmap)
- **A mood for every person**, from their needs, home, food, grief, health, traits, their people and their
  village's laws (the owner's answer 5 to Civilization laws).
- **Effects:** work speed, unrest, villages changing laws, people leaving.
- **Reasons** you can see.
- **Rules for every phase:**
  - determinism across save and load;
  - conservation;
  - old saves load;
  - content as data;
  - works for 30+ villages, distant ones included;
  - visible reasons;
  - never weaken a test;
  - the bench within 10%.

## What exists today (an explorer's audit)
- **No mood, morale, thoughts, beauty or comfort exists yet.** Grief (`c.grief`, 2 days, work ×0.85) is the
  only feeling, and `burial.js` notes "no mood system". The roadmap's UI plan already has a mood bar in the
  portrait bar and the inspector.
- **Cheap inputs**, the same for full and distant villages:
  - **needs:** hunger, thirst, energy;
  - **home:** the shelter need, which already rises with a finished home and falls without one, so it is a
    smoothed "has a home" signal; homes and beds; the furniture of a home (`furnishing.score`,
    `homeFurnished`);
  - **grief, health, illness, lasting injuries, the cold;**
  - **the village:** its laws (each option has a `mood`), war, deaths in the village, crowding;
  - **the person:** people and traits.
- **Inputs to avoid:** rooms, light and positions exist only at full detail, so near and distant villages
  would disagree.
- **Not recorded today:** the last meal (meal or raw, favourite or not) and whether someone slept on the
  ground. Each needs a tiny saved field.
- **Effect hooks:**
  - `workSpeed` (one O(1) read; also used by distant villages);
  - the work step (`ai.js`), for breaks;
  - the founders' choice (`founding.js chooseFounders`), for unhappy families leaving;
  - the birth chance (one draw, kept);
  - the AI law reviews (`civreview.js`).
- **Pitfalls:**
  - **The law moods** of the defaults sum to +1, so mood counts the laws from the defaults (classic villages
    read 0).
  - **A people's own leanings** (Cragborn militia, Duneshade tithe) must not make that people unhappy: a
    leaned-to option counts at least 0 for them.

## Design

### Thoughts (data: `mods/core/content/mood.json`, type `thought`)
A person's mood is the sum of their current thoughts, each a named value with a reason.

| Thought | Value | When |
|---|---|---|
| Hungry / Starving | −6 / −20 | hunger below its seek / urgent line |
| Thirsty / Parched | −6 / −20 | thirst likewise |
| Exhausted | −10 | energy below urgent |
| Homeless | −15 | shelter need under 0.3 (no finished home for a while) |
| A home of my own | +5 | owns a bed in a finished home |
| A comfortable home | +1 to +8 | the home's furniture (beyond the bed), by `furnishing.score` |
| Slept on the ground | −5 | last night's sleep was on the ground |
| A good meal | +4 | the last thing eaten (within a day) was a meal |
| My favourite food | +4 | it was the people's favourite |
| Grieving | −20 | while `c.grief` lasts |
| Hurt / Ill / Scarred | −8 / −10 / −4 | health under 70%; ill now; per lasting injury, at most 2 |
| Freezing | −10 | the cold is reaching them |
| The village's laws | sum of the option moods × 3 | e.g. rationing −9, child labour −9, open borders +3; a people's own leanings count at least 0 for them |
| At war | −5 | the village is at war |
| A death in the village | −4 | someone of the village died in the last 3 days |
| Crowded | −5 | more people than beds |

- **Traits** shift it: two new traits **Cheerful** (+10) and **Gloomy** (−10), added to the eleven
  (question 6).
- **Mood itself** (−100..100) moves toward the sum of the thoughts by a tenth of the gap each hour, so one
  bad meal does not swing it, but a week of hunger does.
- **Levels:**
  - **content:** 20 or more;
  - **fine;**
  - **unhappy:** −20 or less;
  - **miserable:** −50 or less.
- **Computed once an hour per person,** full and distant alike (O(people), about 300 on a World map). Only
  the mood number and two tiny facts (the last meal, last night's bed) are saved; the thoughts are derived
  and shown.

### Effects
- **Work:** mood +50 or more ×1.05; 0 ×1; −50 ×0.85; in between, a straight line.
- **Breaks (miserable people):**
  - once a day, by a hash, a miserable person may stop work for 3 hours ("Miserable: sulking at home", or
    for distant villages an hour's work lost);
  - never during a fight or while fleeing (question 2).
- **Births:** the chance scales with the parents' mood (0.75 to 1.25 times; the one draw is kept).
- **Unrest** (a village where half the adults are unhappy for 5 days):
  - **AI villages** repeal their most disliked law that has no current reason (not a militia at war, not
    rationing in famine). The log says "Unrest in Stonebrook: the tithe was repealed".
  - **Leaving:** unhappy families are first in line when a daughter village is founded; and, in a village
    in unrest, a miserable family may leave to join another village of their own people that has room
    (question 3).
  - **The player's village** gets a warning in the log, "Unrest: 4 of 7 are unhappy (rationing, homeless)",
    and their people may leave the same way; their laws stay theirs to change (question 4).

### Visible reasons
- **The person:** each person's thoughts are listed with values (`explainColonist`), plus their level and
  trend.
- **The village plan:** `P.moodNote` ("Mood: fine, 2 unhappy: rationing, no homes").
- **The log:** breaks, unrest, repeals and leaving.

### Saves (format 33)
- **New fields:**
  - `colonist.mood` (an integer −100..100);
  - `colonist.ate` ({ t, meal, fav });
  - `colonist.rough` (the tick of the last night on the ground);
  - `settlement.unrest` (since when).
- **Old saves:** no mood means a mood computed on load from the thoughts, so old saves continue sensibly
  (the first hour).

### Scale
- **The hourly pass** is O(people) with O(1) reads. A village's law sum and war state are worked out once a
  day per village, and its deaths once a day.
- **`workSpeed`** reads the mood: one number.
- **Distant villages** use the same inputs (no rooms or light).

### Classic games
- Mood changes work speed, so classic runs change (as traits did), unless mood is kept to the new worlds
  (question 1).

## Slices
1. **The thoughts and the mood number:**
   - data;
   - the hourly pass;
   - the meal and sleep facts;
   - save format 33;
   - reasons (`explainColonist`, `P.moodNote`).
   - No effects yet.
2. **Effects:** work speed, births, breaks.
3. **Unrest:** AI repeals, the player's warning, unhappy families leaving (to daughters and to villages of
   their own people).
4. **Acceptance:**
   - a World run (mood spread by people and laws, unrest and its outcomes, everything counted, save and load
     identical);
   - classic runs;
   - the bench, README and roadmap.

## Open questions (answered; see "The owner's answers")

## Results
### Slice 1 (2026-10-29): thoughts and mood
- **Built:**
  - the `thought` type with 20 thoughts as data (`mods/core/content/mood.json`);
  - **`src/sim/mood.js`:**
    - `thoughtsOf` (needs, home and comfort, last night and last meal, grief, health, the cold, laws, war,
      deaths, crowding);
    - `moodTarget` (thoughts plus the new traits **Cheerful** +10 and **Gloomy** −10);
    - an hourly pass for every person, full and distant, moving the mood a tenth of the gap and at least 1;
    - `moodLevel`;
    - `villageFacts`, worked out fresh each pass, so a load cannot differ;
    - `moodNote` for the plan.
  - **The last meal** is noted at the three eating places (the eat job, being fed, distant villages). **A night
    on the ground** is noted by the hourly pass.
  - **Laws** count from the defaults (a village with no laws reads 0), and a people's own leanings never
    count against them (the Cragborn do not mind their militia).
  - `explainColonist` gives the mood, its level, its target and the thoughts. Save format 33: `mood`, `ate`,
    `rough`, validated.
- **No effects yet:** that is slice 2.
- **Tests** (`tests/cloud-mood.test.js`): thoughts from hunger, grief and laws; the hourly step settles
  exactly; levels; reasons in the explanation and the plan; the people's leaning rule; Cheerful and Gloomy;
  save and load; an old save starting at its target; distant villages.
- **Checks:** 232 tests pass. Classic: `forty` 00d13c824c43dec4 (workshops on day 5.94: the two new traits change who draws what), `modern` 33e51d33d37f815e (modern on day 46.12, as before).
### Slice 2 (2026-10-29): effects
- **Work** (`jobs.js workSpeed`, so distant villages too): ×1.05 at mood +50 and above, ×0.85 at −50 and
  below, a straight line between (0 is ×1).
- **Births:** the chance is multiplied by 0.75–1.25 by the parents' mean mood. It is the same single draw, so
  the draws do not shift.
- **Breaks** (the owner's answer 2):
  - at 09:00 a miserable adult (mood −50 or less) may, by a hash draw (30%), stop work for 3 hours
    (`colonist.breakUntil`, saved and validated);
  - at full detail their work job ends and they take no new work ("Miserable: sulking"); needs, fights and
    flight go on;
  - distant villages leave them out of the hour's work;
  - the log says "X is miserable and stops work for a while".
- **Tests:** the work factors exactly; the birth factor; a break within 30 days of misery, with no work job
  held during it, and a save and load matching.
- **Three older tests isolated** (no assertion weakened): mood and the two new traits change the game's draws.
  - The 8c monster tests' colonists now have no personal traits.
  - The hunt-party test wakes everyone first.
  - The lasting-injury test's wound is marked as not festering, since infection is a game-rng draw that any
    earlier change moves.
