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
- **Found on the way:** in the Living world with seed 7, the player's village dies of thirst by day 15, with
  or without this slice. This is looked into separately below.
