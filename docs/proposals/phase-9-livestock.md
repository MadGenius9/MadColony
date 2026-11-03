# Phase 9: livestock, clothing and the settlement plan (design note, cloud copy, 2026-11-03)

From docs/ROADMAP.md: "Cows, pigs and sheep with enclosures and care; wool and leather clothing chains; a
settlement plan (reserved road corridors, plots, farmland, expansion space) replacing nearest-good-spot site
choice, with reasons." The detailed notes ("Livestock, clothing and deliberate town planning") add:
- shearing never kills a sheep;
- milk and wool take time to replenish;
- butchering removes an animal exactly once;
- species, yields, recipes, stations, garments and preferences are all moddable.

## What exists (survey, 2026-11-03)
- **Hides** come from hunting (deer, horses, wolves; `animals.json` butchering recipes), and two monsters drop
  them. **Nothing uses them**: they pile up in stock.
- **Cold:** in scenarios with `life.cold` (Vast world, Living world), people below the cold line get hypothermia
  (`life.js coldUnder`, `health.js`; death cause "froze to death"), with mood `core:freezing`.
  - It affects sleepers, the downed and the homeless outdoors, and people in cold rooms.
  - The line shifts by people and trait (`modsOf(g, c).cold`).
  - In the World run (seed 11, 200 days), 6 people froze to death.
- **No clothing.** Equipment slots are `tool`, `weapon` and `cart` (Phase 7).
- **Animals:** wild herds (deer, wolves, horses), counted far from people and as single animals near full-detail
  villages, with a per-species ledger. They are not owned, not penned and not tame.
- **No fences.** Walls make rooms (heat.js, up to 160 tiles), so a walled pen would count as indoors.
- **Fields** are rectangles in the zone layer (`farming.js createField`), the model for a pen.
- **Site choice:** a ring search for the nearest good spot (`construction.js findSite`, `civic/sites.js`).

## Design (decisions)
### A. Clothing (slices 1–2)
- **A fourth equipment slot, `body`**, for a garment with `warmth` (°C). It moves the cold line down for its
  wearer in `coldUnder`, beside the people and trait shift. Each hour the wearer is below the plain cold line
  wears the garment by one, and a worn-out garment leaves the ledger as worn.
  - Absent means no garment, so new colonists and old saves are unchanged (format 41, as with `equip.cart`).
  - The garment is counted in the census and in inventoryOf, dropped at death, and set aside on load if its mod
    is gone (the cart pattern).
- **Leather (slice 1):**
  - hide → leather at a new station, the tanning rack;
  - leather → a leather coat at the workbench;
  - no research: tanning is basic work, and a new tech would change what classic runs research.
- **The planner wants a coat for every adult**, only in scenarios with cold rules, and only when the day's
  outdoor low is within 4 °C of the cold line. The reason is "A leather coat for P against the cold". Existing
  coats go first to those who have them, then to the homeless, then by id. Distant villages do not equip
  (as with weapons); for them a coat in stock is left for later.
- **Wool (slice 2, after sheep):** wool → yarn at a spinning wheel → a wool coat (more warmth, less wear) at a
  loom. Sheep come in part B.

### B. Livestock (slices 3–5)
- **Where livestock come from:** new wild herds of three species. They are data, placed and counted like
  deer:
  - wild sheep (mouflon-like) in hills and mountains;
  - wild cattle (aurochs-like) on grass and savanna;
  - wild boar in forest.

  Adding species changes every world that places animals, so the classic baselines change. This is an
  intentional change, recorded for review.
- **Taming:** a hunter with a lasso or rope leads one animal of a near herd to a pen.
  - The animal leaves the wild herd (ledger: `died.tamed`) and joins the village's livestock (a new ledger
    with `start`, `born`, `tamed`, `died` by cause, per village and species).
  - Wild horses can be tamed the same way (Phase 8, answer 3: taming comes later).
- **Pens:** a rectangular zone in the zone layer (like a field), fenced by a new building category, `fence`.
  - A fence is passable to nobody but does not bound a room: heat.js stops at walls and doors only.
  - A gate is a door that animals do not pass.
  - The planner builds the fences and checks that the pen is closed and its gate reachable before anyone
    brings an animal in. The reason is shown ("The pen is not closed yet: 3 fence sections missing").
- **Care:**
  - penned animals eat from the pen's ground (grass regrows) or from hay, a new crop cut in fields;
  - a hungry animal gives nothing, and a starving one dies (ledger cause);
  - births in spring while the herd is under the pen's capacity;
  - the planner keeps breeding stock (never butchers the last pair) and a feed reserve for winter.
- **Products:**
  - milk from cows every 2 days;
  - wool from sheep every 10 days (shearing never kills);
  - meat and hide (cattle), meat and pigskin (pigs) when butchered at the butcher's table.

  Butchering removes the animal exactly once: the ledger cause is "butchered", and the carcass comes into
  being through the item ledger.
- **Distant villages:** livestock counts and products in aggregate, by the same rules hourly (the lod.js
  pattern); a promoted village gets its animals placed in its pens.

### C. The settlement plan (slices 6–7)
- **A saved, per-village plan of reserved areas:** road corridors (from the Phase 7 traffic and roads), plots
  for homes and workshops, farmland and pens, and expansion space. It is redone when the village outgrows it.
- **Site choice scores** access, terrain, distance to services and neighbouring uses (no pens beside homes, no
  fields under roads) instead of the nearest good spot.
- **The reason for each choice** is kept for the UI.

## Not in it (this phase)
Mounts and horse-drawn wagons (they need taming first, and could follow slice 4), dyes and fashion, animal
diseases, and selling livestock in markets (it can follow, through trade goods).

## Slices
1. The `body` slot (format 41), the tanning rack, leather and the leather coat, the planner's coats with
   reasons, and wear. Tests: warmth in `coldUnder`, census, saves, death drop, old saves, the planner. Classic
   hashes unchanged (no cold rules there). A World run: hypothermia deaths and coats worn.
2. Wild sheep, cattle and boar as data (herds, ledger); classic baselines re-proposed.
3. Fences, gates and pens (zone layer, a closed-pen check); taming into a pen; the livestock ledger.
4. Care, feed (hay), breeding, products (milk, wool, butchering); wool clothing.
5. Distant villages' livestock in aggregate; acceptance for livestock.
6. The settlement plan: reserved areas and scored site choice, with reasons.
7. Acceptance: World run, classic runs, bench, docs and UI notes.

## Results
### Slice 1: leather clothing (built and tested, 2026-11-03)
- **Built:**
  - `mods/core/content/clothing.json`: leather, the leather coat (slot `body`, warmth 6 °C, 600 hours of
    cold), the tanning rack (12 wood) and its spot, "Tan a hide" (1 hide → 2 leather) and "Make leather coat"
    (4 leather, at the workbench). There is no research.
  - `src/sim/clothing.js`:
    - `warmthOf`;
    - `wearBody`: worn by the hour while it keeps out the cold; worn out, it is booked as worn;
    - `bestGarment`: how many can be had from stock, through recipes two steps deep;
    - `garmentWants`: only with cold rules, only when the next 3 days come within 4 °C of the cold line, at
      most what the stock can make, the homeless first, then by id.
  - `life.js coldUnder(g, c, bare)`: the garment's warmth moves the line down; `bare` asks as if without it.
  - `health.js`: wear while the bare line would bite.
  - the `body` slot (format 41) in the census, inventoryOf, death drops and missing-mod recovery.
- **Tests:** `tests/cloud-clothing.test.js`, 5 tests. In the end-to-end test (Living world, seed 5), hides placed
  on day 6 are tanned once the nights near the cold line: the rack was built on day 14, 2 coats were worn on day
  17 and 4 by day 23.
- **Found on the way (not this slice; a balance finding for Phase 16):** in the Living world with seed 7, the
  player's 5-person village is gone by day 15, with or without this slice. Six died: four of thirst, one of
  hunger, one of an infected wolf bite.
  - The rescue copy (f59ef7d) survives that seed with 7 people. A bisect lands on the Phase 8 change that makes
    herds individual animals within 28 tiles (bec256c), but survival flips back and forth across later commits,
    so the cause is not one broken change. It is a world sensitive to timing.
  - **What happens:** from day 2, three wolf packs (13 wolves) about 30 tiles out raid the village. Nobody there
    has a weapon. People keep running from wolves ("Run from the wolves") instead of reaching the lake, go down
    from thirst, and die.
  - The planner orders a spear for a hunter from day 1 ("A Fire-hardened spear for Zev to hunt with"). The
    workbench is built and the spear needs 5 wood and 1 stone, but nobody makes it in 6 days: the people spend
    their time running. Without a weapon, nobody can hunt the packs down.
  - **A gap in the planner (planner.js, hunting):** for villages simulated in full, it lists only grazing herds
    (`huntableNear`). So its branch for packs that attacked the village never runs there: the note "Hunting
    down the wolves that attacked the village" and arming hunters even when meat is not short. It runs only for
    distant villages (`farHuntable`). The hunters' own job list does hunt raiding packs (hunt.js), once someone
    has a weapon. Fixing this alone would not have saved this village, since a spear was already ordered.
  - **Possible fixes, for the owner to weigh:** let thirsty or hungry people finish a drink unless a wolf is right
    there; count raiding packs at the edge of the hunting reach; arm a raided village's first hunters with a
    spear before anything else; make packs that are being run from tire of a village. None is made here: each
    changes wolf balance, and Phase 8's answers set it.
- **World seed 11, 200 days** (`tools/cloud-world-run.mjs 200 world 11 25 100`, which now also counts coats):
  - coats worn: 3 on day 75, 9 on day 100, 16 on day 150 and 20 on day 200, among 280 people;
  - 8 froze to death by day 200, against 6 in the Phase 7 run of the same seed. That world went differently from
    day 75 on (280 people against 241), so the two counts are not a before-and-after comparison, and coats are
    not shown here to save lives.
  - It is not known from this run whether those who froze were in distant villages. People there get no coats
    (nobody equips there).
  - 3.0 ms a tick on day 200; the save on day 100 loaded and ran on identically; no conservation errors.
- **Classic runs:** `forty` 95e985761d5b0e93 and `modern` e60c658d08cab7f1, both unchanged (no cold rules there).
- **Changed test:** `cloud-life.test.js` "only the exposed feel it" now takes off the colonist's coat (the village
  makes coats as winter comes), with the same assertions.

### Slice 2: wild sheep, cattle and boar (built and tested, 2026-11-03)
- **Built** (`mods/core/content/livestock.json`, data only):
  - three grazing species, placed, grown, moved and hunted like deer:
    - wild sheep on hills, mountains and tundra;
    - wild cattle on grass, savanna and soil (rarer, stronger);
    - wild boar in forests and marsh;
  - their carcasses, butchered at the butcher's table: sheep → 5 mutton + 1 hide; cow → 12 beef + 2 hides; boar →
    7 pork + 1 pigskin;
  - pigskin → 1 leather at the tanning rack.
  - Wolves now also hunt sheep and boar (two lines in `animals.json`); cattle are too big for a pack.
- **Living world, seed 7, day 0:** 83 wild sheep, 30 wild cattle and 64 wild boar, beside 349 deer, 69 horses and
  42 wolves.
- **Tests:** `tests/cloud-livestock.test.js`, 3 tests: terrains, prey, recipes, the animal ledger exact for 6 days,
  save and load identical. Full suite 304 passed.
- **Classic runs** (an intended change, proposed for review):
  - `forty` b57317ab3e4ccbc5. The default map now has 14 wild cattle beside its 23 deer; the colony hunts and
    butchers them. The workshops era comes on day 6.59 (was 7.39). The extra meat is the likely reason; this was
    not tested on its own.
  - `modern` (seed 4242) is unchanged, e60c658d08cab7f1: only deer live on that map.

### Slice 3: pens and taming (built and tested, 2026-11-03)
- **Pens** (`src/sim/pens.js`, content in `livestock.json`):
  - a new building category, `fence`, which heat.js does not count as a room boundary (so a pen gives no shelter);
    the template check treats fences like walls;
  - the fence (1 wood) and the pen gate (3 wood, people pass it);
  - the template `core:animal_pen` (kind `pen`, for 8 animals): 19 fence sections and a gate round 5 × 3 tiles of
    cleared ground. The project is the pen; `project.pen = { sp }` names its species.
  - **The planner** (`planPens`): a full-detail village of at least 6 people with 30 wood lays out one pen. It is
    for the tameable species (data: `tame { name, plural }`) whose herd is nearest within 60 tiles, at a site from
    the usual search.
    - The reason: "A pen for cattle (a herd of 8 wild cattle, 25 tiles away)", with a log line.
    - The state (`P.penNote`): "The pen for cattle is not closed yet: 6 sections to build" / "… is ready".
  - **Closed** means every fence section and the gate stand built; a section removed opens it again.
- **Taming** (`src/sim/livestock.js`, format 42 `s.livestock { next, list, ledger }`):
  - the giver `core:tame_animals`, in the Hunting work type. While a closed pen has fewer than 2 animals, an adult
    walks up to a near wild animal of its species (a far herd is brought near, as for hunting) and catches it
    within 1.5 tiles.
  - That one step takes it from its herd (wild ledger: died `tamed`) and makes a tame animal (livestock ledger:
    `tamed`), so it happens exactly once. A herd is never taken below the hunting limit (3).
  - The tamer leads it through the gate (it follows a step behind).
    - If the lead is broken off, or the tamer dies, the animal waits loose, and anyone may "Lead the cow to the
      pen".
  - In the pen, an animal takes a step inside now and then (a hash draw; no rng), and never leaves.
  - Tame animals are apart from the wild: no fleeing, folding or drift.
  - Save checks; tame animals of a removed mod's species go with their ledger; old saves have none.
- **In play** (Living world, seed 5): the pen is laid out on day 11 (the village reaches 6 people), closed on day
  18; the first wild cow is caught on day 30; two cows graze in the pen on day 31. Both ledgers are exact
  throughout.
  - Taming waits 12 days after the pen is closed: it is Hunting work at urgency 0.5, and the village's people do
    other work first. To be weighed in balance (slice 5 or Phase 16).
- **Tests:** `tests/cloud-pens.test.js`, 3 tests: the pen and its closed check, not a room; taming exactly once,
  both ledgers, save and load, old saves, a malformed save refused; the village in play (about 35 s).
- **Not yet:** feed, breeding, products, distant villages' livestock (slices 4–5). In a distant village the
  animals stand still in their pen.
- **Checks:** full suite 307 passed; classic hashes unchanged from slice 2 (`forty` b57317ab3e4ccbc5, `modern`
  e60c658d08cab7f1). The pen note is kept in the plan only when there is something to say: an empty note in every
  plan had changed both hashes with no change in play.

### Slice 4a: feed, starving and births (built and tested, 2026-11-03)
- **Feed** (`livestock.js tickLivestockDay`, a new daily job after `fadeTraffic`):
  - outside winter, a pen's grass feeds up to `pen.graze` (6) animals;
  - the others, and every animal in winter, eat a unit of fodder from the trough (`project.feed`, a count).
  - Fodder is an item tag, `core:fodder`, given to potatoes and beans (two lines in `items.json`). Hay as a crop
    is left for later: it would need seeds and the field planner's say.
  - The giver `core:feed_animals` (Hauling) keeps the trough at 3 days of what the pen eats, from a day before
    winter on, from the nearest fodder stack: "Fodder for the cattle (2 of 6 in the trough)". Fodder put in the
    trough is booked as consumed ('fodder'), so the census stays exact.
- **Starving:** an animal unfed for 5 days in a row dies (livestock ledger `starved`) and leaves its carcass
  (item ledger 'livestock'), with a warning in the log.
- **Births:** on a spring day, a pen whose animals are all fed, with at least a pair and room, has a young one
  with chance `births × animals ÷ the days of spring` (a hash draw; ledger `born`). Cattle (0.25) bring about one
  young per pair per spring, boar (0.5) about two.
- **In play** (Living world, seed 5, to day 70): two cows tamed on days 30–31, fed through winter (days 49–57)
  from a trough kept at 6, a calf born on day 62; both ledgers exact.
- **Tests:** 3 more in `tests/cloud-pens.test.js`: grass and trough, starving with carcasses; haulers carry fodder
  in during winter (booked as fodder); births in spring, saved and loaded identically.
- **Checks:** full suite 310 passed; classic hashes unchanged (`forty` b57317ab3e4ccbc5, `modern` e60c658d08cab7f1).

### Slices 4b–4c: milk, wool, slaughter, wool clothing (built and tested, 2026-11-03)
- **Products** (`tame.product` in data; the giver `core:tend_animals` in Farming, job `husbandry`):
  - a fed cow gives 2 milk every 2 days ("Milk a cow", 60 ticks of work);
  - a fed sheep gives 3 wool every 10 days ("Shear a sheep", 120 ticks);
  - neither is harmed. `a.next` is the tick it is ready again. Milk is raw food (spoils fast); wool a material.
- **Slaughter:**
  - a pen at its room (8), or any pen while the village is short of meat (the hunting rule's measure), has one
    animal above the breeding stock (`tame.keep`, 2) slaughtered, the youngest first;
  - removing it (ledger `butchered`) and making its carcass (item ledger 'livestock') happen in the same step,
    once; the carcass is butchered at the butcher's table as usual.
- **Wool clothing** (`clothing.json`): the spinning wheel (2 wool → 1 yarn) and the loom (4 yarn → a wool coat:
  warmth 9 °C, 900 hours). The planner now asks for the warmest coats it can make, then the next warmest for the
  rest (`garmentsOnHand`).
- **A bug caught on the way:** the first name of the tending job, `tend`, was already the job of caring for the
  hurt (medical); registering it replaced the doctors' job, and the clothing play test failed. It is `husbandry`
  now; no other job type name is shared.
- **Tests:** 2 more in `cloud-pens.test.js` (milking and shearing harm none and wait their days; a full pen loses
  exactly one to slaughter, never the breeding pair), 1 more in `cloud-clothing.test.js` (warmest first).
- **Checks:** full suite 313 passed; classic hashes unchanged (`forty` b57317ab3e4ccbc5, `modern` e60c658d08cab7f1).

### Slice 5: distant villages' livestock, and the livestock acceptance (2026-11-03)
- **Distant villages** (`livestock.js fillTrough`, `tendFar`): nobody walks there, so once a day the trough is
  filled from the village's stacks (booked as fodder), products ready go into its stock, and the slaughter rule is
  applied, in aggregate. Their animals stand still. They keep the pens they have and lay out no new ones. Before
  this, a village with a pen that became distant would have lost its animals to the first winter. Test: a pen fed
  through six winter days from its stock, then milked into it.
- **World seed 11, 200 days** (`tools/cloud-world-run.mjs 200 world 11 25 100`, now with a livestock summary):
  - 2 pens, both closed (the first by day 25);
  - 2 wild sheep tamed (by day 50), 1 lamb born, 1 sheep slaughtered when meat was short: 2 sheep on day 200;
  - 244 people in 64 villages; 2.7 ms a tick on day 200; the save on day 100 loaded and ran on identically; no
    conservation errors;
  - 17 coats worn on day 200, 6 frozen to death.
  - **Livestock is rare in today's worlds:** AI villages are capped at 6 people, and pens need 6 people in a
    full-detail village. As with carts, it waits on the growth decision (`scale-target.md`).
  - Slaughtering whenever meat is short keeps a pen at its breeding pair: the one lamb was slaughtered at once. A
    balance point for Phase 16 (slaughter only when the pen is full, or keep more than a pair).
- **Bench** (`tools/bench.js`, defaults, two runs each, against 81c40d6, the end of Phase 7): small +4%/+4%,
  medium −5%/+1%, large +6%/+4%. Under the 10% bar.

### Slice 6: the settlement plan, first experiment (main streets): measured, not kept (2026-11-03)
- **Tried:** each village keeps a cross of single-tile main streets through its centre (2 to 24 tiles out). New
  buildings and fields keep off them (code in `plan.js`, the site searches in construction.js and farming.js).
- **Measured** (classic colony, 40 days, seeds 1–4, against the code without streets):
  - forbidding the streets: modern era not reached within 40 days on seeds 1 and 3 (35.2 and 37.1 without
    streets); seeds 2 and 4 0.6 and 1.4 days earlier;
  - costing them (+3 a street tile, as clearing a tree) gave exactly the same choices: the sites near the centre
    avoid streets at that cost already.
- **In villages of 8 or more only** (classic games unchanged), Living world, 60 days:

  | Seed | Techs | Buildings | Time walking |
  |---|---|---|---|
  | 5, without streets | 10 | 246 | 37.7% |
  | 5, with streets | 9 | 263 | 38.5% |
  | 1, without streets | 12 | 300 | 37.9% |
  | 1, with streets | 7 | 240 | 40.7% |

- **Why it does not pay here:** nothing in the simulation needs a clear corridor. People walk diagonally around
  buildings, nobody crowds or blocks, and roads already follow where people walk (Phase 7). Reserving tiles only
  pushes buildings outward, so people walk further.
- **Removed;** nothing of it is in the code.
- **Open for the owner:** what the settlement plan is to buy. If it is for the player to read the town (reasons,
  a shown plan), a plan that only explains the choices it already makes costs nothing in play. If it is to change
  play, it needs something the plan protects against first: congestion, fire spreading between packed
  buildings, or room to grow larger buildings. "Pens away from homes" is the one neighbouring-use rule with a
  reason today; it can be added on its own.
