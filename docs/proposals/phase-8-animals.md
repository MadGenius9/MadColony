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

