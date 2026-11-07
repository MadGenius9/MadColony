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
  - the scripting API: decided (owner, 2026-11-04): data-only for now. The engine adds registered behaviours
    that data mods can use; a sandbox may come later if modders ask for it;
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

### Slice 4: the selling policy for controlled goods, engine half (built and tested, 2026-11-03)
- **Built** (`src/sim/selling.js`, format 44 `settlement.sellPolicy { mode, keep }`, a daily job):
  - `setSellPolicy(g, mode, keep)`: `off` (the default; no field), `lawful` (only where legal or restricted) or
    `any` (black markets too); `keep` units of each controlled item are never sold.
  - `tickSelling`: every 2 days, at most one sale, through the same `evaluateOffer` / `proposeTrade` path a
    player's own offer takes, so laws, prices, the restricted cap, attention, seizure and closed trade apply as
    they do.
    - It sells the controlled item with the most to spare, to the village paying most for it.
    - The payment is what the player's village needs most of what that village can spare, worth up to 85% of the
      goods.
    - The trade's reason says "Your selling policy (lawful only)" or "… (black markets too)".
  - `sellOutlook(g, item)`: what the UI shows before the player picks. For each village met: the law, the price
    (×1, ×1.3, ×2.2), the watch's attention now, the attention a unit adds, the chance of seizure, and whether
    trade is open.
- **Off by default:** classic hashes unchanged (`forty` 9f293a56bce0c53c, `modern` 8e0ecba41839e932). Full suite
  325 passed.
- **Tests:** `tests/cloud-selling.test.js`, 3 tests: off sells nothing and the outlook is right; lawful never
  smuggles and keeps to the restricted cap; `any` sells on a black market; `keep` respected; saved; a bad policy
  refused; old saves off.
- **Home:** the UI to pick the policy, showing `sellOutlook` first (the roadmap's condition).

### Slice 5: acceptance, and the Ideas parking-lot review (2026-11-03)
- **World seed 11, 200 days** (`tools/cloud-world-run.mjs 200 world 11 25 100`, now with couples and professions):
  - 308 people in 65 villages; 336 born; 34 couples on day 200;
  - professions: 82 farmers, 80 cooks, 63 industrial specialists, 59 builders, 11 huntsmen;
  - 3.1 ms a tick on day 200; worst tick 326 ms (170 ms in the Phase 9 run of the same seed; not looked into);
  - the save on day 100 loaded and ran on identically; no conservation errors.
  - The Phase 9 run of this seed had 244 people on day 200. Couples sharing homes leave more spare beds for births,
    which may account for it, but that was not tested on its own.
- **Bench** (`tools/bench.js`, defaults, two runs each, against cb22712, the start of Phase 10): small −9%/+4%,
  medium +4%/+6%, large +4%/+6%. Under the 10% bar.
- **Ideas parking lot, reviewed** (for the owner; nothing new is started from it):

  | Idea | Where it stands | Suggestion |
  |---|---|---|
  | Cooling (air conditioning, cold storage) | Not built. The room temperature model exists (heat.js), and food spoils (spoil.js). | A small, self-contained phase: cold rooms slow spoiling. |
  | Lighting inside rooms | Not built. Roofs are cosmetic, so a room is never dark by day. | Wait for real roofs (UI and building work at home). |
  | Multiroom interiors | Not built. | Keep parked. The street experiment (Phase 9, slice 6) found nothing that needs denser or bigger buildings yet. |
  | Multiple races | Done as Peoples and traits. | Remove from the lot. |
  | Environmental state (fire, freezing, flooding) | Fire, burning, scorch and regrowth done (Phase 5b); cold and hypothermia done; flooding not built. | Flooding only, with a conservation and update-order design first, as the entry says. |
  | Contact between distant villages | Done (Phase 2b). | Remove from the lot. |
  | Organic territory borders | Done (Phase 2b). | Remove from the lot. |
  | Tree planting / forestry | Not built. Burned woods regrow from seed (regrowth); the Forests law protects trees; nobody plants. | Worth a small phase: long World runs still run out of wood near old villages. |

- **Waiting on the owner:**
  - the scripting API (what may run, in what sandbox);
  - zip packages and icons;
  - the selling policy's UI;
  - the proposed baselines: `forty` 9f293a56bce0c53c, `modern` 8e0ecba41839e932.

### After review: sleepers wake for a fire next door (owner, 2026-11-04: "yes they should wake up")
- **Built:**
  - `fire.js`: a sleeper fights a fire threatening the village within `wakeReach` (12 tiles; `fightReach` stays 30
    for those awake). Their sleep gives way, and the reason reads "Woken by a fire near the village". Someone
    whose energy is critical still sleeps.
  - `ai.js`: tiredness no longer interrupts a firefight unless it is critical. Without this, woken people were sent
    back to bed within a few ticks, woke again, and so on. Hunger and thirst still interrupt as before.
- **Midnight fire** (seeds 7, 8, 9: buildings that stood before the fire and still stand, of 61):

  | Seed | With firefighting | Without |
  |---|---|---|
  | 7 | 46 | 25 |
  | 8 | 52 | 34 |
  | 9 | 45 | 35 |

  Before waking, seed 7 was 34 against 28.
- **Changed tests:**
  - "firefighting saves buildings" counts the buildings that stood before the fire, not rebuilt parts (the village
    without firefighting rebuilt more during a long fire, which hid a 16-against-26 loss);
  - "saved mid-fight": the first save waits, at most 40 ticks, until someone is fighting again (at tick 40 everyone
    was choosing a new tile).
  - A new test: a fire next door wakes sleepers, who fight it.
- **Checks:** full suite 328 passed; era days unchanged.
