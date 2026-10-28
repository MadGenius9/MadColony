# Phase 8b: god powers, part 3 (animals)

Status: **in progress** ("go" from the owner on 2026-10-28, with the answers below). Branch `cloud-work` (cloud
rescue copy; see CLAUDE.md).

## The owner's answers (2026-10-28)
1. **Wild monsters:** yes, their own phase (8c) with its own design note after 8b.
2. **Costs:** deer 2, horse 3, wolf 4 favour an animal, to be revisited later.
3. **A full animal ledger:** yes. Every birth and death is counted by cause, and living = start + born + sent −
   died is checked per species, as for people.
4. **A single animal living alone:** no. Single animals join the nearest herd of their species; with no herd
   near, the send is refused.
5. **Peaceful animals:** yes, now. A switch (a god command, saved and replayed) under which predators leave
   people alone (they still hunt deer and horses); the World laws phase can later add it to its list.

## Goal (from the roadmap and the owner)
- **Roadmap, Phase 8b:** spawn animals (deer, wolves, horses, later livestock) as herds or single animals, using
  the animal system's real needs and behaviour.
- **2026-10-24 direction, item 3:** animals (Phase 8), spawning animals with god powers (Phase 8b), then original
  wild monsters that attack villages.
- **The god-power rules (Phase 2c):**
  - powers are validated, deterministic world commands, stored with their tick and replayed identically after a
    load;
  - each shows what it will do before the player confirms, and destructive ones warn first;
  - anything a power creates is counted through a ledger (items: `created:divine`; people: `s.god.spawned`).
- **Rules for every phase:**
  - determinism across save and load;
  - conservation;
  - sim and UI kept apart, with UI notes in `docs/ui-todo.md`;
  - old saves load;
  - content as data;
  - works for 30+ villages;
  - visible reasons.

## What exists today
- **God framework** (`god.js`):
  - `registerPower(type, { validate, cost, preview, apply, destructive? })`.
  - `previewCommand` is read-only; `issueCommand` queues the command for the next tick; `applyCommands` applies
    it at the start of that tick (validating again; refusals are logged).
  - Favour: 30 at the start, at most 100, +5 a day. Sandbox powers are free.
  - `destructive` powers are refused without `confirm: true`, and their preview ends "This cannot be undone."
  - Draws are hashes of the seed and the command id (no `g.rng`).
- **Kind and nature powers:**
  - `spawn` settlers (`godspawn.js`): found a village or join one, people counted in `s.god.spawned`;
  - bless and inspire (`godboons.js`);
  - rain (`godwrath.js`);
  - costs in `mods/core/content/god.json` (`costs`).
- **Animals** (`animals.js`, Phase 8):
  - Herds (`s.animals.herds`: `{ id, sp, x, y, n, day, year, next, fed, ... }`) with ids `h<next>`.
  - Far from people a herd is a count moved between chunks; within 28 tiles of a full-detail village it becomes
    animals (`s.animals.list`), built by `expand` round its centre.
  - Spring births are limited by the chunk's room (`cap` animals per 1,000 tiles of its ground); winter losses
    (three times as many on poor winter ground); drought losses; packs starve without prey.
  - Herds of one species in a chunk merge while they fit (`herd[1]`), split above it, and fade below 2.
  - A hunt brings a far herd near.
- **Gaps the powers would expose:**
  - A herd placed off its ground (horses in a forest, deer on snow) never dies of it and never leaves: every
    chunk round it scores -1 in `move()`, and births are 0.
  - A chunk over its capacity stops births but loses nothing, so spawning 100 deer into one meadow would keep
    them there for good.
  - Herds have no origin: nothing says the gods sent them.

## Design

### The power `animals`
- **Arguments:** `{ x, y, species, count, mode }`.
  - `species` is an animal id from data, among the species this game has (`animalSpecies`: a scenario with animals
    off refuses it).
  - `count` is a whole number from 1 up to the species' `herd[1]` (deer 12, wolves 6, horses 15).
  - `mode` is `'herd'` (default: a new herd of `count`) or `'join'` (single animals: they join the nearest herd
    of that species within 12 tiles; refused if there is none).
- **Validation:**
  - the tile is on the map, passable and not water;
  - a new herd needs `count >= 2`, since herds below 2 fade; one animal joins a herd.
- **Cost:** favour per animal from the species' data (`godCost`: deer 2, horse 3, wolf 4).
  - Herds of 12 deer (24) and 6 wolves (24) both cost about one lightning bolt and a half.
  - Sandbox is free.
- **Preview:**
  - what comes: "8 deer appear at (x, y) as a new herd", or "3 deer join the herd of 9 nearby (12)";
  - whether the ground suits them: "They live on forest floor, taiga, grass, savanna and soil; this is snow:
    they will wander off to find their ground and some will die on the way";
  - how crowded it is ("the land here feeds about N deer; M live here already");
  - for wolves, the villages within 30 tiles, nearest first: "Wolves will hunt near Pinecroft (14 tiles away)
    and may attack its people".
- **Destructive:** only wolves within 30 tiles of a standing village (a function, as for the drought power). Then
  the preview warns and the power needs `confirm: true`. Wolves far from everyone, and grazers anywhere, need
  no confirm.
- **Apply:**
  - A new herd: `id h<next>`, the centre on the tile, `n = count`, `fed` today and `next` now, plus
    `origin: 'divine'` and `sent: tick`.
  - A join: the herd's `n` grows; if it is near, new animals are placed round its centre by hash, as births are.
  - Within 28 tiles of a full-detail village the herd becomes animals at once (`expand`), so the player sees them
    arrive; otherwise it stays a count, and a distant village meets it in aggregate (hunting, raids).
  - The log reads "The gods sent 8 deer near Pinecroft."

### Real needs (so god-made animals obey the land)
- **Off its ground:**
  - A herd in a chunk with none of its ground loses `lostLoss` a day (data, default 0.05).
  - It moves every `moveHours` to the neighbour chunk with the most of its ground. Its score is ground, else
    "any ground within 2 chunks", so it can find its way back.
  - It fades below 2 as usual.
- **Overcrowded:** a chunk holding more than 1.5 times its capacity of a species makes that species' herds there
  lose `crowdLoss` a day (default 0.03) and move on (the score already prefers room).
- These rules apply to every herd, god-made or not, but wild herds are placed on their ground under capacity, so
  normal games change little. This is measured: classic hashes and the World run.

### Accounting and saves
- Animals are not items, so the item ledger is untouched.
- **The animal ledger** (the owner's answer 3): `s.animals.ledger` holds, per species,
  `{ start, born, sent, died: { cause: n } }`.
  - **Causes:** `winter`, `drought`, `starved` (a pack without prey), `prey` (eaten by a pack, far or near),
    `hunted` (killed by people, far or near), `lost` (off its ground), `crowded`, `faded` (the last animal of a
    herd below 2) and `gone` (a species removed from the data, dropped on load).
  - **Neutral changes:** merges, splits, expanding and folding change no total.
  - **The check:** `animalCensus(g)` compares, per species, living (the sum of herd counts) with start + born +
    sent − died, and lists the problems. Tests and the run tools check it like `peopleCensus`.
- A herd carries `origin: 'divine'` and `sent` (tick).
- **Save format 28:** the optional ledger and the herd fields are validated.
  - A format-27 save with herds gets a ledger at load, taking its living animals as the start (migrate.js).
  - Older saves place herds at the next tick, which records the start.

### Peaceful animals (the owner's answer 5)
- A god command `peaceful` (`{ on: true | false }`) sets `s.animals.peaceful`.
  - While it is on, packs never pick a person, an angry pack calms down, and raids on distant villages stop.
  - Wolves still hunt deer and horses, so they eat and breed as before.
  - People still run from a wolf in sight (they do not know) unless the pack is peaceful. Proposal: they do not
    run.
- It costs no favour, is not destructive, and its preview says what changes.
- It is saved and replayed like any command and logged ("The gods calmed the wild: animals leave people alone").

### Scale
- A command is O(herds in the chunks round the tile) to validate, preview and apply, plus `expand` (count
  animals).
- The new daily rules are O(1) per herd (a chunk lookup that already exists in `daily`). Nothing new runs per
  tick.

## Slices
0. **The animal ledger:**
   - every count change in `animals.js` and `lod.js` goes through `bornAnimals` or `diedAnimals` (by cause);
   - `animalCensus`; save format 28 and migration;
   - the run tools check the census.
   - Tests: a year on classic and Vast with the census exact every day, across a save and load mid-year; an old
     save gets a ledger.
1. **The power:**
   - `animals` with herd and join modes: validate, cost, preview, apply;
   - the species' `godCost` data;
   - herd `origin` and `s.god.animals`; save format 28;
   - the log line and UI notes.
   - Tests:
     - refused cases: water, off the map, an unknown species, a count out of range, join with no herd near,
       animals off;
     - favour is charged;
     - preview equals apply;
     - a herd appears near the village as animals;
     - a save and load mid-queue replays identically;
     - old saves load.
2. **Real needs:**
   - off-ground and crowding losses and moves (data `lostLoss`, `crowdLoss`).
   - Tests:
     - horses sent into a forest leave it and some die;
     - 60 deer sent into one meadow thin and spread;
     - classic and Vast numbers stay close to Phase 8's.
3. **Wolves sent near villages, and peaceful animals:** the destructive rule, warnings and confirm; the
   `peaceful` command.
   - Tests:
     - a pack sent beside a village needs confirm;
     - it attacks a lone person or the village fends it off;
     - with peaceful on, a hungry pack beside a lone person leaves them alone but still kills deer;
     - switching it off restores attacks;
     - save and load identical.
4. **Acceptance:**
   - a powers run on the Vast world (deer sent to a hungry village, then hunted; horses on snow; wolves beside a
     village);
   - save and load after each power;
   - the classic runs and the bench;
   - README and roadmap.

## Targets
- Each send is deterministic: preview shows what apply does, and replay after a load is identical.
- Sent animals live by the same rules as wild ones (they eat, breed in spring, starve, are hunted and hunt), and
  never last off their ground.
- No measurable cost when nobody uses the power (classic hashes unchanged unless slice 2's rules touch wild
  herds; then explained).

## Open questions
All answered (see "The owner's answers"). Still to settle while building: whether people should run from wolves
while peaceful is on (proposal: no).

## Results
### Slices 0–3 (2026-10-28)
- **Slice 0, the animal ledger** (`animals.js` `ledgerOf`, `born`, `died`, `recount`, `animalCensus`):
  - every count change is recorded;
  - `removeHerd` records what is left of a herd as `faded`, except in a merge;
  - near herds recounted from their animals record any difference;
  - save format 28 validates the ledger, and migrate.js gives a format-27 save one, with its living animals as the
    start;
  - the World run tool checks the census.
- **Slice 1, the power** (`godanimals.js`; `animals.js` `sendHerd`, `joinHerd`, `herdToJoin`, `landFor`; data
  `godCost`):
  - **herd** (2 to `herd[1]`) or **join** (1 to `herd[1]`, the nearest herd of the species within 12 tiles);
  - a send near a full-detail village arrives as animals;
  - herds carry `origin: 'divine'` and `sent`;
  - wolves within 30 tiles of a standing village are destructive (confirm), with the villages named in the warnings.
- **Slice 2, real needs** (data `lostLoss` 0.05, `crowdLoss` 0.03; `CROWDED` 1.5):
  - in a chunk with none of its ground, a herd scores the chunks round it by how much ground lies within 2 chunks
    and takes any better step;
  - in tests sent horses and crowded deer move off within hours, so the losses show only for herds held in place.
- **Slice 3, peaceful** (`peaceful` command, `s.animals.peaceful`):
  - packs never pick a person, an angry pack calms down, raids on distant villages stop, and `packThreat` is false
    (nobody runs or fends);
  - wolves still kill deer.
- **Found on the way:** plans held live injuries (`plan.medical.needs[].inj`, listed in plancodec.js as a harmless
  copy). In a loaded save the copy stopped changing while the original healed, so the saved plans differed after 300
  ticks (the game state did not). Plans now take a snapshot when they plan.

### Acceptance (`tools/cloud-animalpowers-run.mjs 30 vast 7`, Sandbox)
- **Powers used:**
  - day 2: 12 deer by the player's village;
  - day 3: 3 more joining them where they grazed;
  - day 4: 15 wild horses on a chunk with no horse ground, 100+ tiles from every village;
  - day 6: 6 wolves beside Frostholm (confirmed);
  - day 8: peaceful on;
  - day 14: peaceful off;
  - day 16: 3 × 12 deer on one patch.
- **Checks:**
  - after each power, a save and load ran 300 ticks identically;
  - items, people and animals were exact every day for 30 days;
  - worst tick 33 ms after day 1 (148 ms on day 1, the world starting).
- **Animal ledger at day 30:**
  - wolves: start 302, sent 6, born 3, died 17 (8 winter, 3 crowded, 3 lost, 2 hunted, 1 faded);
  - deer: start 3,393, sent 51, born 3, died 1,379 (1,099 eaten by wolves, 255 winter, 16 hunted, 9 lost);
  - horses: start 968, sent 15, born 3, died 252 (206 eaten, 33 winter, 13 hunted).
  - The 15 horses sent off their ground found it and were all alive on day 30.
  - Of the 36 deer sent on day 16, two herds remained (10 and 8) after the crowd thinned and spread.
- **People:** 24 → 48; no one died (people killed 2 wolves in the 30 days).
