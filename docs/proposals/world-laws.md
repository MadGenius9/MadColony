# World laws (2026-10-24 direction, item 6)

Status: **building** (2026-10-28; the owner's answers below). Branch `cloud-work` (cloud rescue copy; see
CLAUDE.md).

## The owner's answers (2026-10-28)
1. **The list:** the owner expected laws of civilizations: laws villages and kingdoms keep (conscription, curfews,
   rationing, taxes, borders, ...). Those become their own phase, **Civilization laws**, right after this one,
   with its own design note. This phase builds the world switches below, as answered.
2. **Cost:** free.
3. **Peace does not end running wars.** It stops new wars from starting (declarations, and the AI's and the
   player's new attacks); wars already running go on to their end as usual.
4. **Ageless:** children still grow up. Only adults stop aging, and nobody dies of old age.
5. **Growth:** one switch, **Fast growth**: births, crops, forest spread and new daughter villages come twice as
   fast. (The levels were how much faster; one doubling is simpler.)
6. **Endless plague** keeps the rule that a village is never wiped out completely: villages with 3 or fewer
   standing are spared.
7. **Endless season** (summer or winter) is included.

## Goal (from the owner and the roadmap)
- **Settings the player toggles during play**, e.g. no wars, no aging, fast growth, endless plague, peaceful
  animals.
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
- **One law already exists: peaceful animals.**
  - It is the `peaceful` power (`godanimals.js:75`, args `{ on }`, free).
  - It is stored as `s.animals.peaceful` (true or absent, so saves made while it is off are unchanged).
  - It is read in about 8 places, including the distant-village paths (`animals.js raidDistant`, `farHuntable`).
- **The word "laws" is taken:** `settlement.laws` are the villages' contraband laws (legal, restricted,
  banned). The new state is **`s.worldLaws`**, kept apart.
- **Scenario rules that already act like laws** (each a cached getter keyed by scenario):
  - `scenario.war` (rivalry and declarations);
  - `scenario.life` (aging and the cold);
  - `scenario.illness` (outbreaks);
  - `scenario.nature` (forest spread);
  - `scenario.founding`.
  - A world law sits on top: it is checked before or after the getter and never changes the cached rules.
- **The single gates** a law can check in O(1):

  | System | Gate |
  |---|---|
  | War | `isEnemy` (`combat.js:34`, 9 callers, including the distant-village detail rule); `tickRivalry` (declarations, battles, conquests); `tickMilitary` raids; the player's `evaluateAttack` |
  | Aging | `ageYears` and `ageLabel` (derived from `ageTick`); `tickAging` (old-age death); the child stage check (`people.js:68`) |
  | Growth | the one birth draw (`people.js:110`, where the blessing multiplies); crop growth (`farming.js:46`); forest spread (`regrow.js:106`); daughter cooldowns |
  | Illness | `infect` (every new case) and `spreadRules` (plague or scenario rules) |
  | Monsters | `foray`, `raidDistant`, `strike` |
  | Fire | the spread loop in `tickFire` |
  | Seasons | `seasonalTemp` (`heat.js:26`) |

- **Distant villages** use the same code for aging, births, illness, farming, fire and health. Their own
  paths are animal raids, monster raids, aggregate battles and caravan contagion; each gets the same gate.

## Design

### The laws (data: `mods/core/content/laws.json`, new type `worldLaw`)
Each law has an id, a name, an `about` line and a kind: a switch (on/off), or a few named levels.

| Law | While it holds | Turning it on | Turning it off |
|---|---|---|---|
| **Peace** (no new wars) | no new declarations, and no new attack orders or raids against a village one is not already at war with; rivalry stops falling below neutral. Running wars go on to their end (answer 3) | nothing ends | rivalry resumes from where relations stand |
| **Ageless** (no aging) | adults do not age and nobody dies of old age; children still grow up (question 4) | ages are frozen where they stand | ages run on from the frozen values |
| **Fast growth** | births, crops, forest spread and daughter-village cooldowns twice as fast (births: the same single draw, as a blessing; answer 5) | — | — |
| **Plague: normal, none, endless** | none: no new cases (running cases finish their course). Endless: outbreaks of the plague illness keep coming, about one a village every 10 days, sparing villages of 3 or fewer standing (answer 6) | none: nothing more; endless: a plague breaks out in the largest village | the plague runs its course |
| **Peaceful animals** | as today (the existing `peaceful` power becomes a shortcut for this law) | as today | as today |
| **Tame monsters** | monsters stay near their lairs: no forays, no raids on distant villages, no strikes on people or crops | monsters on a foray turn home | forays resume after the usual 15-day gap |
| **No spreading fire** | fire burns only what it was set on; nothing catches from a neighbour | — | — |
| **Endless season: off, summer, winter** | the year's temperature stays at midsummer or midwinter (crops, the cold and animals follow) | — | — |

- **Default:** every law is off, or at its normal level. A game with no laws plays exactly as today, classic
  runs included.
- **Visible reasons:**
  - "Peace law: no wars may start";
  - "Ageless: Ana does not age";
  - "Endless plague: fever broke out in X".
  - The relations panel and the planner's notes name the law that blocks something.

### The command
- **One god power, `law`**, with args `{ law, value }` (true or false for a switch, a level id for levels).
- **Validated:** a known law, a known value, and not the current one.
- **Applied at the next tick**, like every command, so a replay or a loaded save gives the same game.
- **The preview** says what changes now: "Peace: no new war can start; the 2 wars running go on to their end".
- **Cost:** free, like the peaceful switch (question 2).

### Saves (format 31)
- **`s.worldLaws`** holds `{ <law>: value }`, with only the laws that differ from their default; absent means
  no laws.
- **The age freeze:** `s.worldLaws.agelessSince`, a tick. `ageYears` stops at it; on turning it off, every
  colonist's `ageTick` is shifted on by the frozen time in one pass (O(colonists), once).
- **Migration 30 → 31:** an old save with `s.animals.peaceful` gets `s.worldLaws.peaceful = true`. The
  animal code reads the law from then on.
- **Validated:** known laws, known values, and the freeze tick not in the future.

### Scale
- Each gate reads one property (`g.s.worldLaws?.x`), so the cost per tick is nil when no laws are set.
- Peace: ending the wars is one pass over the relations, once. Growth multiplies numbers that are already
  computed.
- Distant villages: the same gates (animal and monster raids, aggregate battles, caravan contagion).

## Slices
1. **The frame:**
   - the `worldLaw` type and data;
   - `s.worldLaws`, the `law` power (validate, preview, apply, log);
   - save format 31 with the peaceful migration, and `peaceful` as a shortcut;
   - validation;
   - a `lawOf(g, id)` helper.
2. **Peace, peaceful animals, tame monsters:** the gates on new declarations, new attack orders and raids,
   the distant paths and monster forays. Tests: running wars go on; none start while it holds, at full and
   distant detail; save and load.
3. **Ageless and growth:** the age freeze and thaw; no old-age death; fast growth for births, crops,
   forest spread and founding. Tests: ages frozen and resumed exactly; births and crops twice as fast.
4. **Plague:** none and endless, through `infect` and `spreadRules`. Tests: no cases under none; outbreaks
   keep coming under endless; the "3 or fewer standing" rule (question 6).
5. **No spreading fire, endless season.**
6. **Acceptance:**
   - a World run with laws turned on and off mid-run, saved and loaded at each change;
   - classic runs unchanged with no laws;
   - the bench, README and roadmap.

## Open questions (answered; see "The owner's answers")

## Results
### Slice 1 (2026-10-28): the frame
- **Built:**
  - the `worldLaw` type, with eight laws as data (`mods/core/content/laws.json`);
  - `src/sim/worldlaws.js`: `lawOf`, `lawIs` (O(1)), `lawSince`, `activeLaws`, change hooks, and the free
    `law` power (validated, previewed, applied at the next tick, logged "World law: Peace is now on");
  - `s.worldLaws { set, since }`, present only while a law is in force, so games without laws save as before;
  - save format 31, validated; laws a removed mod defined are dropped on load;
  - peaceful animals keeps its flag (`s.animals.peaceful`), and the law reads and writes it, so the old
    `peaceful` power and old saves need nothing.
- **Tests** (`tests/cloud-laws.test.js`): set, shown, refused, saved and cleared; free; mended and refused
  on load. 206 tests pass.
### Slice 2 (2026-10-28): peace and tame monsters
- **Peace** (the owner's answer 3: running wars go on):
  - no declarations (`war.js declarations`);
  - no new war from `declareWar`;
  - the player's attack order on a village they are not at war with is refused, with "The Peace law holds: no
    new war may start";
  - relations of villages not already hostile stop at −24, just above hostile, with "(held at neutral by the
    Peace law)" in the reason.
  - Wars already running (enemies when the law came) go on: their raids, battles and truces as usual.
- **Tame monsters:**
  - no forays, no raids on distant villages, no trampling, strikes or tearing;
  - a tame monster only wanders by its lair, and nobody runs from it;
  - turning the law on ends every foray at once.
- **Peaceful animals:** as before (slice 1).
- **Tests:** a running war goes on while new ones are refused, relations are held, and a save and load
  match; a Thornback gores and tramples when wild but not when tame; a foray ends when the law comes.
  208 tests pass; classic unchanged.
