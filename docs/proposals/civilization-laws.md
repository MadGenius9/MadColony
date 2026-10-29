# Civilization laws (2026-10-28 direction, item 6b)

Status: **done** (2026-10-29; the owner's answers below). Branch `cloud-work` (cloud rescue copy; see
CLAUDE.md).

## The owner's answers (2026-10-29)
1. **The list:** the nine laws as proposed.
2. **Changing laws:** a law may change again only after 5 days.
3. **Kingdom laws:** the capital sets conscription, borders, tithe and justice for every member.
4. **Tithe:** a tenth of spare goods every 10 days.
5. **A mood system:** yes. It becomes its own phase, **Mood**, right after this one, because it touches food,
   homes, grief, traits, peoples and laws. This phase gives every law option a `mood` value in data (e.g.
   curfew −2, rationing −3, open borders +1, harsh justice −1, lenient +1), so Mood can use them at once.
6. **Relations from laws:** left to me. **Yes:** similar laws bring villages a little closer, and opposed ones
   push them a little apart, as proposed.
7. **AI changes:** yes, AI villages change laws by situation (war → militia, famine → rationing) and go back
   to their leanings when the reason passes.

## Goal (from the owner and the roadmap)
- **Laws that villages and kingdoms keep and change:** conscription, curfews, rationing, taxes or tithes,
  borders, schooling, hunting and forest protection, punishments, ...
- **Who chooses:** villages choose by their people, temperament and rulers; kingdoms set laws for their
  members.
- **The player** sets their own village's laws.
- **Not this phase:** the gods' world switches (World laws, done) are separate.
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
- **The names are taken.** `settlement.laws` holds the contraband laws (legal, restricted, banned). The gods'
  switches are the `worldLaw` type and the `law` power. So the new laws are the content type **`civLaw`** and
  the settlement field **`settlement.code`** ("the village's code of laws").
- **Village settings today:**
  - `settlement.policy` (maxPopulation, allowEmigration, food days, ...) through `g.policyFor`;
  - `settlement.trade` (willingness, generosity);
  - the village profile (temperament 0–5, enforcement, conquest).
  - The player changes them by direct calls between ticks, not by commands (as with attack orders and trade
    offers); the saved state keeps games deterministic.
- **Kingdoms** (`kingdoms.js`) have a capital and members. Nothing flows between them yet, and rulers are a
  later phase.
- **Shipments that keep items counted:** conquest tribute (`war.js sack`) and daughter supplies
  (`founding.js sendSupplies`) send goods as gift trades. A tithe can use the same path.
- **Hook points** (each one place, used by full and distant villages alike unless noted):

  | Area | Hook |
  |---|---|
  | Sleep and hours | energy `nightSeekBelow` (`needs.js`); work choice `tryWork` (`ai.js`); distant villages' working hours (`lod.js hourLabour`, 06–21) |
  | Food | hunger decay (`needs.js decayNeed`, `lod.js`, the planner's food need) |
  | Arms | the planner's `armAll` (`planner.js:237`); war strength (`war.js warStrength`) |
  | Schooling | children's work types and school hours (`people.js mayDoWork`, `education.js`) |
  | Hunting | the hunt giver (`hunt.js`), the planner's two hunters, distant `taskHunt` |
  | Wood | `g.gatherOk`, the gather giver, the planner's `reachableNode`, distant `nodeCandidates` |
  | Borders | `willTrade` (`villages.js`), traders' visits (`contact.js`) |
  | Justice | contraband enforcement: fines, seizures, closed trade (`villages.js ENFORCE`, `settlement.enforcement`) |
  | Relations | a daily pass over met pairs (`war.js` rivalry is the pattern) |

## Design

### The laws (data: `mods/core/content/civlaws.json`, type `civLaw`)
Each law has options, the first being the default. Each option says what it does (shown) and which peoples
and temperaments lean to it.

| Law | Options | Effects |
|---|---|---|
| **Work hours** | normal · long hours · curfew | **Long hours:** people work later into the night (energy is sought at 0.4, not 0.62) and get work done sooner, but tire. **Curfew:** no outdoor work at night (22–06); people stay in, which is safer from wolves and monsters. |
| **Rationing** | none · rationed | **Rationed:** hunger falls 20% slower (smaller meals), but work is 10% slower. |
| **Schooling** | free · compulsory · child labour | **Compulsory:** children study in school hours and never forage then. **Child labour:** children also haul and farm, but learn nothing. |
| **Conscription** | none · militia | **Militia:** every fit adult is armed and counts in war strength, even in peace. Weapons are made for all. |
| **Hunting** | free · restricted · banned | **Restricted:** hunting only when meat runs low (under 3 food days). **Banned:** no hunting, except packs that attack the village. |
| **Forests** | free · protected | **Protected:** no felling of grown trees within 12 tiles of the village centre (saplings grow undisturbed). Building sites are still cleared. |
| **Borders** | open · closed | **Closed:** no trade with or traders from villages outside the kingdom. Illness does not travel in by traders. |
| **Tithe** (kingdom members only) | none · tithe | **Tithe:** every 10 days a member sends a tenth of its spare goods to the capital, as a gift trade. |
| **Justice** | lenient · usual · harsh | Contraband enforcement: **harsh** doubles attention and seizures (and smuggling falls); **lenient** halves them. |

- **Defaults:** the default options are today's game. A village with no laws plays exactly as before, classic
  runs included.
- **Kingdom laws:** a kingdom's capital sets **conscription, borders, tithe and justice** for all its members
  (question 3). Members keep the others for themselves.

### Who chooses
- **The player** sets their village's laws with `setCivLaw(g, sid, law, option)`: validated, with a reason and
  the day it was passed recorded, and the plan redone.
  - A law may change again only after 5 days (question 2).
  - When the player rules a kingdom, the kingdom laws they set apply to their members.
- **AI villages** start with their people's and profile's leanings (data):
  - Cragborn: militia and harsh justice;
  - Reedkin: protected forests and banned hunting;
  - Duneshade: open borders and the tithe;
  - Hearthfolk: the defaults.
  - Every 10 days they review by situation (by rule, with a hash for ties): at war → militia; food under 2
    days → rationing; 3 or more children and a school → compulsory schooling; no grown trees near → protected
    forests. They go back to their leaning when the reason passes.
  - The log says "Stonebrook passed a law: Rationing (food is short)".
- **Kingdoms:** members take the capital's kingdom laws the day they join, and when the capital changes them.

### Relations
- **A daily pass over met pairs** (O(pairs), about 450 for 30 villages): relations rise a little (+0.05 a day
  per law the two share, at most +0.3) and fall a little for opposed choices (open against closed borders,
  militia against none: −0.05 each), with the reason "similar laws" or "their laws differ" (question 6).

### Visible reasons
- **Statuses:** "Curfew: no outdoor work at night", "Too young to work (compulsory schooling)".
- **Planner notes:** "Militia law: arming every adult", "Hunting banned by law", "Protected forest: felling
  farther out".
- **Trade:** "Closed borders: Willowmere does not trade outside its kingdom".
- **The village panel** lists the laws with when and why each was passed (UI note).

### Saves (format 32)
- **New fields:** `settlement.code { law: option }` (only laws away from the default) and
  `settlement.codeSince { law: tick }`.
- **Old saves:** no code means every law at its default, so they play as before. AI villages get their
  leanings at their first review.
- **On load:** unknown laws or options (a removed mod) are dropped.
- **Daughters** copy their parent's code; divine villages get their people's leanings.

### Scale
- Effects read `settlement.code?.[law]`: one lookup, nothing when no laws are set.
- The review is daily: O(villages × laws). The relations pass is O(met pairs).
- **Distant villages:**
  - their hours, food and hunting go through `lod.js`;
  - militia counts in war strength;
  - schooling has no distant effect, as distant villages have no schools today.

## Slices
1. **The frame:**
   - the `civLaw` type and data, and `settlement.code`;
   - `setCivLaw` (validated, 5-day wait, reason, replan);
   - leanings at founding (world start, daughters, divine);
   - kingdom laws applied to members;
   - save format 32; the log.
2. **Daily life:** work hours, rationing, schooling, at full detail and in distant villages.
3. **Land and arms:** conscription, hunting, forests.
4. **Outside:** borders, tithe, justice.
5. **The AI:** situational reviews; relations from similar laws.
6. **Acceptance:**
   - a World run (laws differ between peoples and kingdoms; tithes counted; save and load identical);
   - classic runs unchanged with no laws;
   - the bench, README and roadmap.

## Open questions (answered; see "The owner's answers")

## Results
### Slice 1 (2026-10-29): the code
- **Built:**
  - the `civLaw` type, with nine laws as data (`mods/core/content/civlaws.json`), each option with a `mood`;
  - leanings in data: peoples' and profiles' `code` (Cragborn militia and harsh justice; Reedkin protected
    forests and banned hunting; Duneshade the tithe);
  - **`src/sim/civlaws.js`:**
    - `civLawOf` (O(1); kingdom laws are read from the capital);
    - `codeOf`;
    - `setCivLaw`, with the 5-day wait, a logged reason and a replan;
    - `startCode` for AI and divine villages;
    - `mendCode` on load.
  - Daughters copy their parent's code. Save format 32: `settlement.code` and `codeSince`, validated.
- **No effects yet:** the laws change nothing in play until slices 2–4.
- **Tests** (`tests/cloud-civlaws.test.js`): leanings by people, while classic villages keep the defaults;
  set, wait, end, save, load, mend and refuse; kingdom laws from the capital.
- **Checks:** 218 tests pass; classic unchanged.
### Slice 2 (2026-10-29): daily life
- **Work hours:**
  - **Long hours:** people go to bed at night only below 0.4 energy (not 0.62) (`needs.js`); distant
    villages work until 23:00, not 21:00 (`lod.js hourLabour`).
  - **Curfew:** no outdoor work at night (22:00–06:00). Work types now carry `outdoor` in data: farm, chop,
    mine, forage, haul, hunt. An idle person's reason begins "Curfew: no outdoor work at night".
- **Rationing:** hunger falls at 0.8 the rate, everywhere, distant villages included, and the planner's food
  sums follow; work goes at 0.9.
- **Schooling** (`people.js mayDoWork`):
  - **compulsory:** children do nothing but study in school hours (8–15);
  - **child labour:** children may also haul and farm, and get no school (`education.js` attend giver).
- **Seen in a 5-day classic run:** a curfew built 54 parts against 61; rationing keeps a smaller food stock,
  as the planner needs less for the same days.
- **Tests:** the curfew by night and day; long hours and bedtime; rationing ×0.8 hunger and ×0.9 work;
  schooling in and after school hours and child labour; distant villages under laws save and load the same.
- **Checks:** 221 tests pass (the distant test was fixed after a full run that had it failing for a setup reason: no village is distant before the first day); classic unchanged.
### Slice 3 (2026-10-29): land and arms
- **Conscription, militia:**
  - the planner arms every adult (as when hostile neighbours are about);
  - in a distant village, where nobody equips, each unarmed fit adult counts as a spearman in war strength.
  - Seen in a 6-day classic run: 4 armed against 2.
- **Hunting** (`civlaws.js huntAllowed`; `hunt.js`, the planner's hunters, distant `taskHunt`):
  - **banned:** no hunting; the plan says "Hunting is banned by law";
  - **restricted:** hunting only under 3 days of food;
  - a pack that attacked the village is hunted down either way.
- **Forests, protected** (`treeProtected`; the gather giver, the planner's `reachableNode`, distant
  `nodeCandidates`, all agreeing):
  - no grown tree within 12 tiles of the centre is felled;
  - building sites are still cleared, and saplings do not count.
  - Seen: 49 grown trees near the village against 26 after 6 days.
- **Tests:** no hunting, with the reason, against hunting without the law; the restricted rule; more grown
  trees near the village; more armed; a distant militia's war strength rises.
- **Checks:** 223 tests pass; classic unchanged.
### Slice 4 (2026-10-29): outside
- **Borders, closed** (`civlaws.js bordersClosed`):
  - no trade (`willTrade`) and no traders' visits (`contact.js`) between villages of different kingdoms when
    either keeps closed borders;
  - the player's offer screen says "Closed borders: X does not trade outside its kingdom";
  - villages of one kingdom are open to each other.
- **Tithe** (`src/sim/tithe.js`, daily after the kingdom check):
  - every 10 days, each member whose capital keeps the tithe sends a tenth of its spare goods (free to trade,
    at most 200 an item) as a gift trade;
  - each member's day comes from a hash, so tithes are spread out;
  - a new tithe waits while the last one is still on its way;
  - delivery is the usual way, so every item stays counted.
- **Justice:** harsh doubles the attention smuggling draws and the seizure chance; lenient halves them.
- **Tests:** closed borders stop trade both ways and in offers, but not inside a kingdom; a tithe goes from
  member to capital with every item counted and a save and load matching; harsh and lenient seizure chances.
- **Checks:** 226 tests pass; classic unchanged.
### Slice 5 (2026-10-29): the AI
- **Reviews** (`src/sim/civreview.js`, daily after the tithe; each AI village every 10 days by a hash of its
  id; the owner's answer 7):
  - at war → militia; peace again → its leaning;
  - under 2 days of food → rationing, until food is plentiful again (5 days);
  - 3 or more children of school age and a school desk → compulsory schooling;
  - 5 or fewer grown trees within 12 tiles → protected forests, until 20 have grown back (unless the people
    lean to protection).
  - Kingdom laws are the capital's to change. The 5-day wait applies, and the player's village is never
    changed.
  - The log says "Marketon passed a law: Rationing, rationed (food is short)".
- **Relations drift** (the owner's answer 6):
  - daily over met pairs, for each law at least one of the two has set: alike +0.05, apart −0.05, at most 0.3
    a day either way;
  - a change of standing is recorded with "Similar laws (n alike)" or "Their laws differ (n apart)";
  - villages with no laws (classic games) are untouched.
- **Tests:** a militia raised at war and stood down in peace; rationing on short food and off once food is
  plentiful; the player's village untouched; drift exactly +0.1 for two laws alike and nothing for two alike
  and two apart, none without laws; a Vast world with reviews saves and loads the same.
- **Checks:** 229 tests pass; classic unchanged.
### Acceptance (2026-10-29)
- **World run** (`tools/cloud-world-run.mjs 300 world 11`, which now counts laws and tithes): passed.
  - Items, people, animals and monsters were counted every 25 days, and a save and load on day 150 played on
    identically.
  - **Laws on day 300, of 53 standing villages:**
    - protected forests 51;
    - banned hunting 13;
    - militia 5 (rising to 37 in the wars around day 250 and standing down after);
    - harsh justice 5;
    - rationing 1.
    - Tithes went out while kingdoms held them (up to 8 members).
  - **People:** 256 people, 61 wars declared.
- **Speed:**
  - **Day 300:** 4.6 ms/tick, against 3.3 for the same seed and today's code with no laws (a copy where
    villages start with no laws and never review them).
  - **The code costs nothing extra:** with no laws it plays the identical game to the peoples run, and side by
    side with the code before this phase it runs at the same speed (100 days: 1.30 against 1.26 ms/tick).
    The earlier 2.45 at day 300 was a faster machine.
  - **The difference is a different game:** militias make villages stronger, so they declare war sooner (35
    wars by day 175 against 18). Fights cost time (`nearestEnemy` and `combatDecision` are 12% of a late
    tick).
  - **A profile of day 170:** the law code is about 1.5% of the time.
- **Suite:** 229 tests pass; classic unchanged (`forty` ee55506a781cb766, `modern` 479f5857575304ab).
- **Carried over** (not done):
  - the militia makes worlds more warlike (worth tuning after play);
  - nearly every village protects its forest by the end (few trees near), which is fine for the land but
    worth a look;
  - Mood, the next phase, will use each option's `mood`.
