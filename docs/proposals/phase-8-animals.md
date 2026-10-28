# Phase 8: animals and the wild (design note)

Status: **approved** (owner's "keep going", 2026-10-28), with the owner's answers below; built slice by slice.

## The owner's answers (2026-10-28)
1. **Animals in every game**, classic games too (their reference state hashes are recorded again, with the reason).
2. **Meat spoils:** meat and carcasses lose a share of every stack each day (`consumed:spoil` in the ledger);
   cooked meals keep. Cold storage comes later.
3. **Horses** are wild herds in Phase 8; taming and riding come later.
4. **Wolves are as dangerous as real wolves:** packs hunt, guard their kills, and attack people outdoors,
   most readily when hungry (winter, no prey), when someone is alone, wounded or a child, or when a wolf is
   cornered or hurt; they kill. Only a group (3 or more, armed) makes a pack hold back; a lone hunter or woodcutter
   at the forest edge in winter is in real danger.
5. **Hunting limit:** villages leave every herd at least 3 animals.

## Where this comes from
- **Roadmap, Phase 8:** wildlife ecology (deer and predators), hunting chain to the kitchen, horses; herds as dots
  zoomed out; population-level simulation for distant regions.
- **Direction update 2026-10-24:** Phase 8 is moved up, right after Phase 5b; then Phase 8b (spawning animals
  with god powers), then original wild monsters that attack villages.
- **Roadmap, hunting chain:** policy → equipment → travel → hunt (animal health, no instant inventory) → butcher
  → haul → kitchen.
- **Rules for every phase:** determinism across save/load, conservation (ledger + census), sim and UI apart,
  old saves load, content as data, works for 30+ villages (per-tick cost and distant behaviour stated), full
  autonomy with visible reasons, never weaken a test.

## What exists today (surveyed 2026-10-27)
- No animals of any kind. Food is crops and berries (`core:raw_food`), cooked into stew at the campfire.
- **Combat** (`combat.js`) is colonist against colonist: targets are looked up in `s.colonists`, enemies are
  decided by settlement (`isEnemy`); weapons are data (spear 8 damage range 1.5; hunting bow 12 damage range 7
  with arrows; guns later); `injure` works on any object with `health`. No combat skill.
- **Jobs:** work types with givers (`GIVER_SPECS` + `GIVERS`), drivers `{valid, tick, cleanup}`, reservations,
  `travel`/`go` with modes on/adj/near. Gathering a node (`gather`) is the closest analogue to hunting.
- **Planner:** wants food when short, but only items some node yields (`reg.idx.nodesFor`); reasons such as
  "waiting for regrowth" are shown.
- **Distant villages** (`lod.js`): one aggregate hour per village every 100 ticks, staggered; tasks spend
  time and use the same ledger reasons as the jobs.
- **World scale:** chunks of 32 tiles (about 48×36 on Vast), a cached chunk land graph (`contact.js landChunks`:
  landmass and a walkable tile per chunk) that explorers already walk; tile paths (`findPath`) are too costly for
  many herds; regions rebuild when tiles change (animals must never block tiles).
- **Climate:** one temperature for the whole map by season (`heat.js`); local rain and drought (`weatherat.js`).
- **Worldgen** draws its random numbers in sequence: anything new must use hash draws (as `regrow.js` does) or
  every existing seed's world changes.

## The design

### Species are data (new content type `animal`)
`mods/core/content/animals.json`; schema in `content/types.js`. First three (all original, plain animals):

| | Deer | Wolf | Wild horse |
|---|---|---|---|
| Herd size | 4–12 | 3–6 (a pack) | 5–15 |
| Lives on | forest floor, taiga, grass | forest floor, taiga, tundra, snow | grass, savanna, steppe |
| Eats | grazes (any fertile ground) | deer (and the weak) | grazes |
| Health | 30 | 40 | 60 |
| Speed (tiles a step) | 1.3 | 1.4 | 1.6 |
| Flees from | people within 8, wolves within 10 | armed groups of 3+ | people within 10, wolves |
| Gives when butchered | 6 venison, 1 hide | 1 hide | 10 meat, 2 hide |
| Born | spring, +40% a year | spring, +30% | spring, +25% |

Fields: `id, name, herd [lo, hi], terrains, density (herds per 1,000 tiles of its ground), health, speed,
flee {from, range}, diet ('graze' | 'hunt': prey ids), yields (on butchering), births {season, perYear},
winterLoss, color, render`. New items: `core:venison` and `core:horse_meat` (tag `core:raw_food`, nutrition 0.2),
`core:hide`, and carcass items `core:deer_carcass`, `core:wolf_carcass`, `core:horse_carcass` (heavy: 1 per load).

### Two levels of detail per herd (the key to scale)
- **A herd record always exists** (`s.animals.herds`: id → `{ sp, x, y, n, born, mood }`): species, a centre
  tile, how many, when it last grew, and what it is doing (grazing, moving, fleeing, hunting). This is all a far
  herd is: a number on the map, moved and grown by the hour. Zoomed out the UI draws herds as dots.
- **Near herds become individual animals** (`s.animals.list`: id → `{ herd, x, y, mv, hp, wounds }`) when
  their centre is within 48 tiles of a full-detail colonist (the player's village, villages near it, the watched
  village). The individuals are made from the count (positions by hash round the centre) and folded back into the
  count when the herd goes far (the living ones). Animals never block tiles (no region rebuilds), and they move by
  short local steps (neighbour tiles that are passable and in the same region), never long paths.
- The switch runs with `lod.js`'s detail check (every 600 ticks), so near and far follow the same rule as
  villages.

### Far herds (aggregate, every herd once an hour, staggered by id)
- **Move** one chunk step on the land-chunk graph at most every few hours toward better ground for its
  species (more of its terrain, fewer people, in winter lower latitude for horses and deer), with a hashed choice
  among equals; they never cross water or leave their landmass.
- **Grow and die:** births once a year in spring (per data), losses in deep winter (`winterLoss`) and in
  drought; a herd above its species' maximum splits in two, a herd below 2 fades. Each chunk has a carrying
  capacity from its fertile ground; herds over it lose some and move on.
- **Predators far away:** a wolf pack in the same chunk as a deer herd takes deer at a rate per day (draws by
  hash); a pack with no prey for days loses members and moves.
- **People far away:** see "Distant villages".
- Draws are hashes of (seed, herd, hour or day): the game's random stream and existing worlds stay the same.

### Near animals (full detail, every 10 ticks per animal, staggered)
- **Grazing:** wander within a few tiles of the herd centre, which drifts slowly toward good ground.
- **Fleeing:** from what their species fears within range: step to the neighbour tile farthest from it (the
  whole herd turns when one sees danger).
- **Wolves hunt:** a hungry pack picks the weakest deer in reach, closes in, bites (`injure` on the animal's own
  health store, the same severities as wounds); a kill feeds the pack and leaves the carcass (it becomes a
  `core:deer_carcass` item only if people take it; see below).
- **Wolves and people** (answer 4): a pack attacks people outdoors within its range when hungry (no kill for a
  day, more in winter), always when one of them is hurt or cornered or someone comes at its kill, and picks the
  weakest: a child, someone alone, someone wounded; it holds back from a group of 3 or more armed people: a bite is a wound ("Bitten by a wolf"; death cause "was killed
  by wolves"). Colonists who see wolves close by run home; armed ones fight them (combat learns a second kind of
  target: an animal). A village attacked by wolves sets its hunters on the pack.

### Hunting (the chain)
- **Work type `core:hunt`** (new skill `core:hunting`), a giver that offers a hunt when the village wants meat
  (or a pack threatens it) and a herd of a huntable species is within reach (same trip limits as gathering),
  never taking a herd below 3 (a hunting limit in data: the village leaves the rest to grow).
- **The hunt job:** take a weapon if the hunter has none (bow first: range; spear otherwise), walk toward the
  herd, stalk (the herd flees when the hunter comes within its flee range unless stalking slowly), shoot or
  strike when in range (accuracy and damage from the weapon; skill raises accuracy; draws from the game's random
  stream like other colonist work). A wounded animal flees and the hunter follows it a while; a kill leaves a
  carcass item where it fell (`created:hunt`, through the ledger).
- **Butchering:** the carcass is hauled like any goods; a butcher's table (new station, no research, wood) has
  a recipe per carcass (`consumed:craft`, `created:craft`: venison and hide). Venison is raw food, so it feeds
  the stew recipe and can be eaten raw like berries.
- **Planner:** meat counts in the food reserve; "Hunt N venison from deer (herd of 8, 30 tiles east)" or
  "No herd within reach" appear among the food reasons; the trace says why hunting is not done (no weapon, herd
  at its limit, too far).
- **Hides** are only goods for now (clothing is Phase 9); villages may trade them.
- **Spoilage** (answer 2): items with `spoilPerDay` in data (venison, horse meat: 0.15; carcasses: 0.2) lose that
  share of every stack and load each day at the day start (`consumed:spoil`; whole units by hash), so meat must be
  cooked; stew keeps. Planners count meat at what it will be worth by the time it is eaten.

### Distant villages
- **Hunting in aggregate** (`lod.js taskHunt`, a new task after gathering): an adult hunter spends time on the
  nearest huntable herd within 40 tiles of the centre; time spent turns into kills at a measured rate (like the
  other `LOD.share` values), the herd's count goes down, venison and hides are made at the centre through the
  same ledger reasons (`created:hunt` for the carcass, then the butcher recipe in their bills, or meat at once —
  decided in slice 5 by what keeps the ledger simple).
- **Wolves and distant villages:** a hungry pack within 20 tiles may wound someone once a day by hash (no walk).

### Saves and cost
- `s.animals` is optional (absent: no animals; save format 27, migration with nothing to add, validation of
  every herd and animal). Big worlds save herds and individual animals compactly (flat number arrays and a
  species table, as nodes are saved).
- **Per tick:** O(herds / 100) for far herds, O(near animals / 10) for near ones, hunters' jobs O(the animals
  of their herd). World preset target: about 1 herd per 2 chunks (≈ 1,500 herds, ≈ 12,000 animals in counts) and
  a few hundred individual animals near full-detail villages; worst tick under 50 ms as before.
- Nothing runs in a game without animals.

### Which games get animals
Every game (answer 1): herds are placed after the rest of the world by hash draws (the world itself is the same
for a seed); a scenario can list its species or turn animals off (`scenario.animals: { species: [] }`). Classic
games change from slice 1 on, so `forty` and `modern` are recorded again then.

## Slices
1. **Species and far herds:** content type and data, `s.animals.herds`, placing herds by hash, hourly far
   simulation (moving on the chunk graph, births, winter losses, capacity, predation by packs), save format 27,
   validation, tests (determinism, save/load identity, herd counts within limits over a year).
2. **Near animals:** individuals made from and folded back into herds (counts kept), local grazing and fleeing,
   wolves hunting deer near people, never blocking tiles; tests (the switch conserves the count both ways;
   save/load mid-flight identical).
3. **Hunting and butchering:** hunt work, skill, giver, job, carcass items, the butcher's table and recipes,
   venison and hides in the planner's food reasons, hunting limit; tests (conservation through the ledger, a
   village fed partly by hunting, no herd hunted below its limit).
4. **Wolves and people:** attacks, wounds and the death cause, fleeing and fighting back (combat with an
   animal target), villages hunting a threatening pack; tests.
5. **Distant villages:** aggregate hunting and wolf attacks, measured against full detail; World-preset timing.
6. **Horses and seasons:** wild horse herds; births in spring, winter losses and winter moves for all species;
   UI notes (herds as dots zoomed out, animals close up, hunting and butchering, wolf attacks).
7. **Acceptance:** the usual phase checks; a World run with herd numbers over 300 days (no extinction, no
   explosion), hunting share of food, wolf deaths, worst tick, classic runs unchanged.

## Targets
- Over 300 days on the World preset, every species survives and none grows past its land's capacity.
- A village near deer gets part of its food from hunting (visible in the ledger: `created:hunt`) and explains
  why when it does not hunt.
- Wolves kill some deer and, in winter, occasionally hurt people; a village defends itself.
- Saves and loads identical mid-hunt and mid-switch; worst tick under 50 ms on the World preset.

## Open questions for the owner (answered 2026-10-28: see the top)
1. **Classic games:** animals only in the Vast and Living worlds (proposal; classic games unchanged), or in
   every game (classic baselines re-recorded)?
2. **Spoilage:** there is no spoilage today; should meat spoil (a new rule for all food), or wait?
   Proposal: wait (later phase), so hunting is not weaker than farming for a reason the player cannot see.
3. **Horses:** wild herds only in Phase 8 (proposal), with taming and riding in Phase 7 (transport) or Phase 9
   (livestock); or tame them already here?
4. **How dangerous wolves are:** proposal: they go for people only when hungry (winter, no prey) and only for
   lone, unarmed people outdoors or when attacked; deaths rare.
5. **Hunting limit:** villages leave a herd of at least 3 (proposal); or no limit (herds can be wiped out)?

## UI notes (added to docs/ui-todo.md per slice when built)
Herds as dots zoomed out (species colour, size by count); animals close up (procedural sprites, grazing, running);
the hunt (hunter with bow, arrows, a fleeing wounded deer), carcasses, the butcher's table; wolves (a pack, a
bite, a warning letter "Wolves attacked Ada near the woods"); village card: "Food from hunting: N%".

## Results

### Slice 1: species and far herds
- **Built:** content type `animal` (`mods/core/content/animals.json`: deer, wolves, wild horses), on in every
  game (`scenario.animals.species`, default every species; `[]` turns them off). `src/sim/animals.js`: at the
  first tick (of a new game or an older save) herds are placed per chunk by the share of the species' ground
  (density per 1,000 tiles), never within 24 tiles of a village, by hash draws (the world and the game's random
  stream are unchanged). Every herd once an hour, staggered by id: once a day births (spring, once a year, less as
  its chunk fills: `cap`), winter losses, packs eating deer or horses within 2 chunks (in winter a pack that has
  not eaten for 10 days loses one; the rest of the year small game keeps it), splits above 1.5 × the largest herd,
  merges of two that fit in one herd, fades below 2; at most every `moveHours` a move of one chunk toward more of
  its ground, less crowding, away from villages (packs toward prey), on its landmass (`contact.js landChunks`).
  `s.animals` (save format 27, validated; an older save gets herds at the next tick).
- **Tuning** (Vast seed 7): at first wolves died out (300 → 19 by day 300): their land cap (4 per 1,000 tiles) was
  smaller than one pack, so packs never bred, and packs that had emptied their range starved all year. With cap
  12, births 0.6, starving only in winter and a 2-chunk view of prey: wolves 298 → 428, deer 2,207 → 1,639,
  wild horses 729 → 447 over 180 days, all three steady from day 90 on. Classic seed 4242: 4 deer herds (29 deer)
  and 1 horse herd, 35 deer after 90 days.
- **Cost:** the herd update is about 0.0005 ms a tick on Vast (600 herds); Vast days 2–60: 0.385 and 0.408 ms a
  tick with animals, 0.378 and 0.368 without (two runs each; worst ticks 35–46 ms with, 35–173 ms without: the
  spikes are not the herds).
- **Classic runs:** new state hashes `forty` b6c75f52735d338a, `modern` 8d4917d8556d4f55 (herds are saved).
  With `s.animals` left out, `forty` hashes to the old 9426646c1190c148: the herds change nothing else yet. Same
  outcome numbers (5 colonists, 65 built, workshops era at day 40; modern era reached).
- **Not changed:** 139 tests pass (4 new in `tests/cloud-animals.test.js`).
- **Review fixes:** the herds' ground counts were cached by the map revision, which craters leave alone (Phase 5b
  keeps whole-map caches): a game saved after a meteor played on differently from one that was not (reproduced;
  `terrainDrawRev` is now in the key, and a test checks meteors then a save and load). Wolves with no prey never
  starved (winter is shorter than starveDays), so their numbers followed the land, not the deer: now a pack breeds
  only after big prey and loses members above 3 (small game feeds 3) without it. Vast seed 7, 180 days: wolves
  297 → 347 (day 60) → 189, deer 2,181 → 1,605 → 1,740, wild horses 734 → 484, all steady at the end. Herds are not
  placed in mostly-water chunks (they could never move); herds of a species whose mod is gone are dropped on load;
  `starveDays` is a whole number (else the game refused its own save).

### Slice 2: near animals
- **Built** (`animals.js`, "near animals"): every 600 ticks a herd whose centre is within 48 tiles of a
  full-detail village (every village of a classic game) becomes individual animals (`s.animals.list`: id, herd,
  x, y, hp; made round the centre by hash); one near for 2,400 ticks and 64 tiles from all of them folds back into
  a count (the living ones, centred on the one nearest their middle). While near, a herd's count and centre follow
  its animals; it does not move by chunks; births and losses add or remove animals; it neither merges nor is
  eaten in the aggregate. Each animal acts every 10 ticks (by id): deer and horses flee, the whole herd for 300
  ticks, from people (8 and 10 tiles) and predators (10), one or two tiles a step to the neighbour farthest from
  the danger, else graze a step now and then within 5 tiles of the centre; a pack that has not eaten today chases
  the nearest prey animal within 20 tiles and bites it (10–19 health a bite); a kill feeds the pack. Animals never
  block tiles and step only onto walkable tiles of their region.
- **Cost:** Vast seed 7, days 2–15: 3 herds near villages (28–29 animals); 0.308 ms a tick, worst 20 ms. The
  herd index was rebuilt whenever a herd moved (every near herd every hour); it is now updated in place
  (`setCentre`, lists kept in id order). The per-tick grid of people and near animals is about 0.01 ms.
- **Classic runs:** new hashes `forty` 58a33fd49d1db4de, `modern` a6dc12f1df32b2a4 (near animals are saved); same
  outcomes (5 colonists, 65 and 89 built).
- **Review fixes:** two packs could kill the same deer twice in one tick (the grid of animals is the tick's
  start): the herd's count went below its animals, the herd was removed with animals left over, and the game
  refused its own save (reproduced; a bite now checks the prey is alive, the dead are neither chased nor feared,
  an animal whose herd is gone is dropped). Herds of a species whose mod is gone took their animals with them only
  in the count (their animals stayed: every later save failed); they go together now. Near packs starve like far
  ones. Near herds settled round villages for good: their grazing centre now drifts a tile an hour away from a
  village within 30 tiles and strays walk back to it. Deer no longer fear the stand-in places of distant villages'
  people. Malformed saves (a near herd with no animals list, a bad animal counter) are refused or handled.
- **Classic runs** after the fixes: `forty` 6b934c050e95907a, `modern` e34dfb5baf5a02bc; same outcomes.
- **Not changed:** 143 tests pass (3 more in `tests/cloud-animals.test.js`).

### Slice 3: hunting, butchering and spoilage
- **Built:** `src/sim/hunt.js`: work type Hunting (skill Hunting), giver `core:hunt_animals` and job `hunt`. An
  armed adult (a melee weapon, or a bow with arrows) hunts while the village has less meat than 2 a person
  (meat and carcasses, a carcass counted as 6) and a near herd of deer or horses is within 60 tiles and above the
  hunting limit of 3; one hunter a herd. The hunter follows the herd's nearest animal, strikes or shoots at the
  weapon's cooldown (accuracy and range as in combat, +2% a skill level; arrows used up), a hit or a miss sets the
  herd running; a kill leaves a carcass where it fell (`created:hunt`); a hunt gives up after 1,500 ticks. The
  planner arms the two best hunters while a herd is near and meat is short ("A Fire-hardened spear for Ada to hunt
  with"), wants every carcass butchered (its meat, or a wolf's hide), so the village builds a **butcher's table**
  (wood 10) and the cook butchers (deer: 6 venison and a hide; horse: 10 meat and 2 hides; wolf: a hide), and
  says why it hunts or not (`P.huntNote`). Venison and horse meat are raw food (nutrition 0.2): eaten, or cooked
  into stew. `src/sim/spoil.js`: goods with `spoilPerDay` (meat 0.1, carcasses 0.2) lose that share of every stack,
  load and station buffer each day (`consumed:spoil`); what spoils is eaten and cooked first.
- **Tuning** (classic seed 4242, 20 days): with meat spoiling at 0.15 a day and a target of 4 a person, 49 of 84
  venison rotted (people ate meals and the cook took potatoes first); with 0.1, a target of 2 and perishables
  first, 3 of 102 spoiled, 17 deer were hunted and both nearby herds were brought down to the limit of 3 ("No herd
  near enough to hunt"): hunting thins the game round a village, which comes back with the spring births.
- **Older tests:** hunting changes every game's timing, and 8 older tests failed. One was a real bug found
  this way: a harvest job that has picked its last crop stayed one more tick and was dropped by a load (it was no
  longer "valid"), so a game saved at that moment played on differently (`ai/jobs.js` harvest: valid while
  finishing). The others depended on a fixed day for something that now comes at another time (the founding
  parent's families, the first growing field, a rebuilt home, how long eating takes); each now waits for its
  condition or picks a village where it holds, with the same assertions (none weakened).
- **Classic runs:** `forty` 729318226c0f973c (66 built, workshops era on day 5.47, before 6.04), `modern`
  81ac639d99e0b452 (modern era on day 41.6); no conservation errors.
- **Review fixes:** meat is raw food, so a village short of food planned to butcher deer it did not have (the
  stew chain took the butcher recipes and never reached foraging or farming): butcher recipes are `fromStock` in
  data, billed only by the want to butcher the carcasses on hand (that recipe, at most one run a carcass); a test
  checks a hungry village forages and farms. Spoilage took reserved units, so a save and load mid-haul played on
  differently (reproduced): only free units spoil now (a test with a real reservation). Spoilage in a station's
  buffer let a butchering make meat from a spoiled carcass: buffers do not spoil now. The founding test keeps the
  player's village as parent (two settlers join first when its families cannot leave). Hunting reach is measured
  from the village centre; a hunt's `valid` checks only the job's shape; weapon wear stops at 0.
- **Classic runs** after the fixes: `forty` 75cdeebbd8710a70, `modern` 14be8f5a6511e9e2 (same outcomes).
- **Not changed:** 148 tests pass (5 more in `tests/cloud-animals.test.js`).

### Slice 4: wolves and people
- **Built** (`animals.js` pack branch, `hunt.js`): a near pack turns on whoever hurt one of it (unless that
  person is in an armed group of 3: then it breaks off and runs); when it has not eaten today it chases the
  nearest deer or horse, or a person when no prey is near; in winter whichever is the easier catch. People are
  picked weakest first (a child +6, someone alone +4, someone below 70% health +4 against the distance), never
  inside a room, and never anyone with 3 or more armed people within 6 tiles. A bite is a wound of kind `bite`
  (6–14; bandaged, may become infected or deep like other wounds; death cause "was killed by wolves"); a pack whose
  victim is down has had its fill and goes; the bitten person's village marks the pack (`raids`) for 3 days.
  People who see a wolf within 7 tiles run 10 tiles away from it, or, armed (a spear, or a bow with arrows) and
  above 40% health, fend it off (job `fend`, the same strike as hunting; a kill leaves a wolf carcass, skinned
  for a hide); a village whose people were attacked hunts the pack down (urgency 1.5, no hunting limit for
  wolves; hunting a wolf makes the pack turn on the hunter).
- **Seen** (classic seed 4242, a pack of 4 placed by the village): Tamsin, alone and unarmed, was bitten four
  times, a bite festered, the village treated her; the pack, its victim down, moved off. Three armed people
  together were never bitten (the pack fled when they struck one).
- **Classic runs:** `forty` a3f4673dd1c9392c, `modern` 3982dd57aa2eadad (the 40-day world has wolves on its
  grassland); same outcomes.
- **Review fixes:** in winter a pack that had eaten kept hunting people (now a fed pack leaves people alone,
  winter or not, unless angry). Fending and firefighting took turns forever (fire.js now counts `fend` as combat,
  and nobody fighting a fire is sent to fend). People near a wolf they could not reach retried a failed walk every
  5 ticks: fending now has a per-person cooldown after "no path", and nobody reacts to a wolf of a fed pack, across
  water (another region), or while indoors; eating and drinking go on unless the wolf is within 3 tiles. The new
  herd fields (`angry`, `raids`) are validated (a bad one crashed the first bite). An angry pack no longer goes
  for the stand-in places of a distant village's people; a hunter below 30% health gives up a hunt; a bite wakes a
  sleeper; raiders come before wolves (combat may replace a fend or a wolf flee); the raid check in the hunt giver
  looks at near herds only, and the wolf check is staggered by the id's number.
- **Merge note:** wolves can now kill classic colonists; the home project's fuller test suite (not in this copy)
  may have tests assuming nobody dies in a classic game.
- **Not changed:** 152 tests pass (4 more in `tests/cloud-animals.test.js`); classic hashes unchanged by the fixes.

### Slice 5: distant villages
- **Built** (`lod.js taskHunt`, `animals.js farHuntable`/`killFar`/`raidDistant`): an adult of a distant village
  who may hunt (with their own weapon, or a melee weapon in the village's stock, since nobody equips there),
  while the village is short of meat, spends time on the nearest far herd of deer or horses within 40 tiles of the
  centre above the hunting limit, or first on a pack that attacked it: a hunt is 400 work ticks (half of the time
  counts, `LOD.share.hunt` 0.5, not yet measured against full detail) plus the walk there and back, kept per herd
  in `settlement.abs.hunt` (saved, validated); at the end a hash draw (0.7) gives a kill: one animal from the herd
  and its carcass at the centre (`created:hunt`), butchered by the village's bills. One hunter a village an hour,
  before farming and gathering. A hungry far pack within 20 tiles of a distant village mauls one of its adults
  once a day with chance 0.3 (a bite of 10–25), and the village marks the pack to hunt. The planner wants weapons
  for a distant village's hunters by its far herds, and distant villages eat and cook what spoils first.
- **Found on the way:** hunting never happened on big worlds at all: the hunt giver passed `far: true` where the
  work chooser expects the trip's far end (a point), so every hunt counted as too far; distant villages' weapons
  never counted (worn goods carry `dur`); hunting was the last task of a distant villager's hour, so other work
  used the time. Hunting is now work priority 1 with more urgency when there is no meat.
- **Vast seed 7, 30 days:** 32 deer hunted world-wide (13 by the player's village), 156 venison, 10 spoiled; no
  wolf attack on a distant village in that time (packs keep away from villages); a test places a pack beside one.
- **Classic runs:** `forty` b9406ed4939d61cc (66 built; workshops era on day 6.05, before 5.47), `modern`
  73214f81e4dcf083 (modern era on day 44.1, before 41.6): with hunting at priority 1 the village spends more time
  hunting; nothing is lost from the ledger.
- **Not changed:** 152 tests pass (the Vast test now also checks distant hunting and a raid).
- **Review fixes:**
  - A distant village with only bows never hunted (only melee weapons counted); a bow now counts when its arrows are in stock too.
  - Hunting priority and urgency are back to 0.8 and 1.2/0.6. The big-world bug was only the `far` point, and the raise had slowed classic games for no gain.
  - The planner's note for a pack that raided now says so, with the real distance.
  - Distant hunters count meat from the live stacks each hour, not from the 6-hour-old plan.
  - Targets are found once per village and hour.
  - The Vast test counts carcasses made during distant hours, not ledger against log.
  - Not modelled (accepted): distant hunters do not spend arrows or wear weapons. A raid mark is lost when the raiding pack merges the same day (harmless).
- **After the review:** 152 tests pass. Classic hashes: `forty` a3f4673dd1c9392c (workshops era on day 5.47) and `modern` 3982dd57aa2eadad (modern era on day 41.63), back to their pre-slice era days.


### Slice 6: horses and seasons
- **Already there from slice 1:** wild horse herds (grass, savanna, soil), births once a year in spring and losses
  every winter day for all species.
- **Built** (`animals.js`, data `winterTerrains`, `droughtLoss`):
  - **Winter ground:** each species may name its winter ground (deer: forest floor and taiga; horses: grass and
    savanna; wolves: none, they follow their prey).
  - **Winter moves:** in winter a far herd scores chunks by its winter ground (plus a tenth of its other ground),
    so deer gather in the woods and horses on open grass; in spring they spread out again.
  - **Winter losses:** on poor winter ground (under a fifth of its ground) a herd loses three times `winterLoss`.
  - **Droughts:** grazers in a drought lose `droughtLoss` a day (deer 5%, horses 4%; a drought lasts 4 days) and
    far herds score a drought chunk at 0.3, so they move away.
  - The winter ground counts are part of the habitat cache (derived, keyed by map and terrain revisions).
    Nothing new is saved, so the save format stays 27.
- **Vast seed 7, 30 days:** the share of far deer on chunks that are at least half winter ground goes from 0.28
  in autumn to 0.42 in winter and back to 0.29 in spring; horses go from 0.94 to 1.00. After the year: deer 2,038
  (2,181 before), horses 709 (734), wolves 297 (297).
- **Classic runs:** `forty` a3f4673dd1c9392c and `modern` 3982dd57aa2eadad are unchanged: classic maps have no
  far herds and the runs have no drought.
- **Tests:** 153 pass. The Vast test checks the winter move. A new test checks that a deer herd in a drought ends
  up smaller than in the same game without one, and that a save and load mid-drought plays on identically.
- **Review fixes:**
  - The drought check in a herd's chunk scores now uses the herd's own spot for its chunk and, for the other
    chunks, whether the drought reaches the chunk at all. Before, only the chunk's middle tile was checked, so a
    drought near a chunk corner thinned herds without driving them off.
  - Whether a species moves away from droughts now comes from the data (`droughtLoss`), not from its diet.
  - The Vast test now also casts a drought on a far deer herd and checks that the herd leaves it within two days.
  - After the fixes: 153 tests pass; the classic hashes are unchanged.

### Slice 7: acceptance (2026-10-28)
- **World run** (`tools/cloud-world-run.mjs 300 world 7 25 150`, World 2048×1536, seed 7; the tool now also
  reports herd numbers, carcasses hunted and the meat share of raw food made):

| Day | ms/tick | Worst tick | People | Villages | Wolves | Deer | Horses | Hunted (total) | Meat share |
|---|---|---|---|---|---|---|---|---|---|
| 25 | 0.487 | 142.5 (day 1) | 41 | 7 | 523 | 4,265 | 1,559 | 36 | 4.7% |
| 50 | 0.587 | 71.4 | 61 | 13 | 598 | 3,617 | 1,532 | 79 | 4.7% |
| 100 | 0.945 | 77.7 | 129 | 31 | 576 | 2,906 | 1,255 | 181 | 3.7% |
| 150 | 1.576 | 86.2 | 226 | 53 | 404 | 2,202 | 1,015 | 314 | 2.9% |
| 200 | 2.574 | 96.4 | 310 | 64 | 359 | 2,449 | 1,045 | 496 | 2.3% |
| 250 | 2.361 | 101.3 | 311 | 64 | 322 | 2,609 | 1,098 | 592 | 2.0% |
| 300 | 2.577 | 196.0 | 314 | 64 | 290 | 2,282 | 1,049 | 662 | 1.7% |

- **Targets:**
  - Every species survives 300 days and none grows past its land: met. Deer and horses settle from day 150
    (deer 2,200–2,700 with the yearly cycle, horses about 1,000–1,100). Wolves fall slowly all the way (598 at
    day 50, 290 at day 300), as packs thin the deer near villages; see "Carried over".
  - A village near deer gets part of its food from hunting (`created:hunt`): met. 662 carcasses by day 300, but
    meat is only 1.7–4.7% of raw food made (farms grow far more).
  - Save and load: met. A save at day 150 loaded in 4.4 s; two copies and the unsaved game ran the next day
    identically.
  - Conservation: met. Items and people were exact at every check.
- **Wolves and people:** no one was killed by wolves in 300 days (deaths: sickness 16, dehydration 6,
  hypothermia 2, old age 2, infection 1). In classic and Vast tests a hungry pack does bite and kill a lone
  person. On the World map, villages are placed away from herds, packs keep off villages, and a pack that has
  eaten leaves people alone.
- **Classic runs:**
  - `forty` a3f4673dd1c9392c: unchanged.
  - `modern` 0c1fcaacd5934528: the modern era on day 42.76 (41.63 before; 5 colonists, 90 built). The new herd-move
    draw (one hash per move) changes the far herds of a classic map: herds more than 48 tiles from the village are
    far there too.
- **Speed:**
  - Changes that keep results the same:
    - hunting lookups use the herd chunk index;
    - herd moves share one village set a tick and one hash;
    - an animal's region is looked up once a step;
    - the near-animal grid is kept current as animals step;
    - the person grid is built from the village index.
  - Tried and undone (no measurable gain):
    - steps without region lookups;
    - grazers acting every other turn.
  - Measured on the same machine against the code before Phase 8 (`b77cbfc`):
    - With animals turned off, the current code is as fast as before (medium game 0.431–0.433 against
      0.433–0.462 ms/tick).
    - With animals on, bench small is 0–20% slower and medium 25–35%. Large is within noise (+0–5%).
    - World is +8% over the first 30 days and about +35% by day 50–60.
  - **Explained, not fixed:**
    - The cost is the animals near villages, each simulated every 10 ticks: the medium bench game keeps about
      110 animals near 11 people, at about 11 µs an act (fleeing steps, nearest-person and nearest-prey lookups,
      region checks). Colonists' work choice adds about 5% (hunting options), and the wolf check adds 1%.
    - Halving the grazers' turns saved no measurable time, so there is no single hot spot left. The real lever is
      fewer full-detail animals (a smaller NEAR radius, or near herds only round the player's village on small
      maps): a design choice for the owner (open question below).
  - Worst ticks on the World run: 142 ms on day 1 (the world starting) and up to 196 ms later (tick 702437).
    In a 50-day run of the code before Phase 8 the worst ticks were about 100 ms on day 1 and 47 ms by day 50; this run's were 71 ms by day 50.
- **Found on the way (Phase 5b):**
  - On the same machine the World run costs 0.359 ms/tick at day 50 with the Phase 5 code (`529b86f`) and
    0.485 with the code before Phase 8: +35%, from forest spread.
  - New trees check whether they would trap someone (`wouldTrap`), and that forces region rebuilds.
  - Phase 5b's acceptance timed small maps only.
- **Carried over:**
  - **Wolves:** a slow decline on the World map; whether wolves should kill people more often (the owner asked
    for wolves as dangerous as real ones); full-detail animals cost 10–35% on small and medium maps (above).
  - **Hunting:** distant villages do not spend arrows or wear weapons on hunts; `LOD.share.hunt` is not measured
    against full detail.
  - **Phase 5b:** the forest-spread cost on World (+35%).

### After the acceptance: fewer full-detail animals (the owner's answer, 2026-10-28)
- **Changed:**
  - Herds become animals within 28 tiles of a full-detail village (was 48).
  - A hunt can go for a far herd within its 60-tile reach. That herd becomes animals when the hunt starts and
    stays near while anyone hunts it.
  - Animal distances use a plain square root instead of `Math.hypot`.
  - Tried and undone: grazers acting every other turn (no gain).
- **Bench** (code before Phase 8 `b77cbfc` against now, same machine, one run each in turn):
  - small 0.301 / 0.288 and 0.371 / 0.404;
  - medium 0.425 / 0.515 and 0.564 / 0.588;
  - large 0.759 / 0.794 and 1.082 / 1.065 ms/tick.
  - That is −4% to +21%, about +5% on average.
  - Medium games timed alone, three runs: 0.48–0.52 before, 0.53–0.58 now (+12%); small +6%.
- **Classic:** `forty` ac37a8f860cb8e30 (workshops era on day 5.94, 66 built), `modern` 26aff18c94590ae1 (the
  modern era on day 41.24); 153 tests pass.
- **World, 300 days:**
  - Herds: wolves 288, deer 2,305, horses 1,019 on day 300.
  - 641 carcasses hunted; meat 1.7–5.7% of raw food.
  - The save at day 150 continued identically; items and people were exact.
  - Its times are not comparable: other test runs overlapped it.
