# Phase 8c: wild monsters

Status: **in progress** (the owner's answers on 2026-10-28, below). Branch `cloud-work` (cloud rescue copy; see
CLAUDE.md).

## The owner's answers (2026-10-28)
1. **Which games:** some monsters in every game, classic too.
   - Every game gets at least one lair, so a classic map has one.
   - On maps too small for the 80-tile distance, a lair goes on the fitting tile farthest from every village
     (at least 20 tiles away).
2. **The three monsters:** keep Thornback, Gloomstalker and Barkmaw for now.
3. **Danger:** monsters must never wipe a village out completely. A village with 3 or fewer people is left
   alone: monsters do not hurt its people or tear down its homes, though they may still trample its fields.
4. **Peaceful animals:** does not cover monsters.
5. **Rewards:** as proposed: meat, hides, wood, a gloom eye and heartwood, with no use yet beyond trade.
6. **God powers:** `monster` and `banish`, as proposed.

## Goal (from the owner and the roadmap)
- **2026-10-24 direction, item 3:** animals (Phase 8), spawning animals with god powers (Phase 8b), then
  **original wild monsters that attack villages**. WorldBox's breadth and chaos, never a copy: never use its
  names, art, races or signature creatures (no dragons, no giant crabs, no demons, no UFOs).
- **The owner's answer 1 to Phase 8b:** monsters get their own phase and design note.
- **Rules for every phase:**
  - determinism across save and load;
  - conservation (items, people, animals);
  - sim and UI kept apart (UI notes in `docs/ui-todo.md`);
  - old saves load;
  - content as data;
  - works for 30+ villages;
  - full autonomy with visible reasons.

## What exists today (to build on)
- **Animals** (`animals.js`, Phases 8 and 8b):
  - herds as counts far from people, single animals near full-detail villages (28 tiles), with every 10 ticks a
    step: fear, grazing, chase;
  - packs that hunt people with bites (`injure` kind `bite`, death cause "was killed by wolves");
  - `raidDistant` for distant villages;
  - the animal ledger and census;
  - `peaceful`.
- **People against animals** (`hunt.js`):
  - `wolfDanger`: flee, or `fend` when armed and fit;
  - the "hunt down" giver for a pack that attacked;
  - `strike` (weapon damage, cooldown, accuracy);
  - three armed people together make a pack back off (`armedGroup`).
- **Destruction** (`ruin.js`, Phase 5b):
  - `destroyStructure` and `destroyProject` keep goods counted and let villages rebuild parts;
  - `destroyCrop`, `destroyNode` (with seeds for regrowth);
  - fire (`ignite`, `buildingFlammable`);
  - the tornado tears down wooden parts by chance.
- **Distant villages** (`lod.js`): aggregate hunting and wolf raids.
- **God powers** (`god.js`): commands, previews, confirm for destructive powers, favour.

## Design

### Three original monsters (data: `mods/core/content/monsters.json`)
Each is a single creature (not a herd), much stronger than any animal, living in or near a **lair**.

| | Thornback | Gloomstalker | Barkmaw |
|---|---|---|---|
| What | a boar-like beast the size of a cart, its back a mat of thorns | a long-limbed, eyeless hunter that comes out at night | an old dead tree that walks, roots for legs, a split trunk for a mouth |
| Lives in | thickets in forest and grassland (lair: a thorn den) | caves in hills and mountains (lair: a cave mouth) | old forests (lair: a ring of fallen trunks) |
| Does | tramples fields and crops, charges whoever comes near its den, knocks people down | hunts lone people at night, never enters a lit room, flees light and fire | tears down wooden building parts, smashes fences and stockpiles; slow; stone stops it |
| Health | 180 | 120 | 240 (a blow: 12–24, 15–30, 8–16, every 60 ticks; balanced so a small village's spear party can win) |
| Speed | 1.6 (charges) | 2.0 | 0.6 |
| Weak to | spears (reach) | light and fire (runs from lit buildings; a torch or fire hurts it) | fire (burns: `ignite` on its tile hurts it a lot) |
| When slain | 40 meat, 4 hides (`core:thornback_carcass`) | 2 hides; a "gloom eye" trophy (sold or kept) | 30 wood, 1 "heartwood" (a rare wood) |
| Per map | 1 per ~60,000 tiles of its ground | 1 per ~80,000 tiles of hills, gravel, tundra and snow | 1 per ~80,000 tiles of forest floor, taiga and jungle |

All the names and looks are new to this game.

### Lairs and life far from people
- **Placement:**
  - Lairs are placed at the start of a game (or the next tick of an older save) on fitting ground, far from
    villages (at least 80 tiles), by hash. `s.monsters = { lairs, list, next, ledger }`.
  - Every game has at least one (answer 1): the species with the most fitting ground gets a lair on the tile
    farthest from the villages, at least 20 tiles away.
- **Far monsters:** while no full-detail village is within 40 tiles, a monster is a record that rests at its lair
  and roams once a day, a few chunks from it, by hash.
- **Raids on distant villages** (`lod.js`, aggregate like wolf raids): a roaming monster within 30 tiles of a
  distant village has a chance per day to strike it.
  - A Thornback ruins one field.
  - A Gloomstalker wounds one adult at night (a chance of death).
  - A Barkmaw tears down one wooden part.
  - These go through the same ruin and injury functions, and the village is told ("A Barkmaw tore down part of a
    house in Pinecroft").
- **Respawn:** a lair whose monster died stays empty for 60 days (two years), then a new one grows there.
  Villagers can **clear** an empty lair (burn the den, block the cave, burn the trunks: a job at the lair), which
  removes it for good.
- **Monster ledger:** born at a lair, sent by the gods, slain (by whom), checked like the animal census.

### Near monsters (full detail)
- Within 40 tiles of a full-detail village, a monster acts every 10 ticks, like near animals, and never blocks
  tiles.
- **Thornback:** grazes and roots near its den. It charges anyone within 8 tiles of the den or who hurts it (a
  hit of 15–30 that knocks down), and tramples crops it walks over (`destroyCrop`). Most days it stays by its
  den; it comes to fields at dawn when hungry.
- **Gloomstalker:** at night only (the game's night hours), it stalks the weakest person outdoors and alone, like
  a wolf but stronger (a bite of 20–40). It never enters a lit room, and turns back from tiles near lit
  buildings or a fire. By day it is in its cave.
- **Barkmaw:** walks slowly toward the nearest wooden building part within 30 tiles. Each hour beside one it
  tears it down (`destroyStructure`; goods dropped and counted; the village rebuilds). It stops at stone and
  brick, and burns if it stands in fire.

### People and villages
- **Fear and fleeing:** anyone who sees a monster within 10 tiles runs home (the existing flee job, with the
  reason "Running from the Barkmaw").
- **Fighting:**
  - armed people fight a monster only in a group (at least 3 armed adults; more for a stronger monster: the
    monster's `fightGroup`);
  - a lone armed person runs too;
  - combat uses `strike` (weapons, wounds, deaths: "was killed by a Thornback").
- **A hunt party** (a new giver, urgency high): when a monster has attacked the village or its fields, or a
  Barkmaw is within 30 tiles:
  - the village arms its fighters (weapons from the planner, as for hunters);
  - it sends a party of `fightGroup` to slay it;
  - the party gives up when half are hurt;
  - the reason is shown ("Hunt the Thornback that trampled the barley").
- **Fire against them:** villagers with a torch item, or a burning tile, may drive off a Gloomstalker or burn a
  Barkmaw. Proposal: no torches now (the fire system has no carried fire); fire from the fire power or a
  wildfire hurts them.
- **Clearing a lair:** after a monster is slain, the village plans a "clear the lair" job if the lair is within
  60 tiles.

### God powers
- **`monster`:** send a monster of a species to a tile (destructive near villages, confirm, favour 40–60). It
  roams from where it lands and makes a lair nearby.
- **`banish`:** remove one monster (kind, favour 30).
- **`peaceful`** (Phase 8b) does not cover monsters (proposal; open question 4).

### Accounting and saves
- **Save format 29:** `s.monsters` (lairs, monsters, ledger), validated; absent means lairs are placed at the
  next tick.
- Items from slain monsters and torn-down parts go through the ledger (`created:hunt`; ruin.js reasons).
- **Death causes:** `thornback`, `gloomstalker`, `barkmaw`, with their text.

### Scale
- A few monsters per map: Vast about 10–20, World about 30.
- Far monsters: one record each, a daily roam and raid check.
- Near ones: one act every 10 ticks each.
- Lair placement: one pass over the habitat counts that animals already keep.

## Slices
1. **Data and lairs:**
   - the three species in data, lairs placed on fitting ground, far monsters resting and roaming;
   - the monster ledger and census; save format 29.
   - Tests: placement away from villages, roaming stays near the lair, save and load identical, old saves get
     lairs.
2. **Near monsters:** each one's behaviour (trampling, night stalking, tearing down wooden parts), wounds and
   death causes.
   - Tests:
     - fields trampled;
     - a lone person at night attacked, a lit room safe;
     - a wooden part torn down and rebuilt, stone left standing;
     - conservation;
     - save and load mid-attack.
3. **People fight back:** fear and fleeing, group fighting, the hunt party giver, slaying and carcasses, clearing
   lairs.
   - Tests: a party of 3+ slays a Thornback; a lone person runs; the carcass is butchered; a cleared lair never
     respawns; an uncleared one respawns after 60 days.
4. **Distant villages and god powers:** aggregate raids; `monster` and `banish` powers.
   - Tests: a distant village loses a field or a part; the powers' previews, confirm, replay.
5. **Acceptance:**
   - a World run of 300 days (monsters alive, villages hurt but not wiped out, deaths by cause, worst tick);
   - a powers run;
   - classic runs; bench; README and roadmap.

## Targets
- Monsters are rare, dangerous and visible: over 300 days on the World map most villages meet one, some lose
  people or buildings, and villages slay some of them and clear some lairs.
- No village is wiped out by monsters alone in normal play (they hurt, villages rebuild).
- A slain monster's lair comes back after 60 days unless cleared.
- No cost when no monster is near (far monsters are a few records).

## Open questions (answered; see "The owner's answers")
1. **Which games have monsters:** proposal: the Vast, World and Living worlds have them; classic games do not (a
   scenario setting, like animals).
2. **The three monsters:** Thornback, Gloomstalker and Barkmaw (looks and powers above). Keep, rename or replace
   any?
3. **How dangerous:** proposal: a monster can kill people and tear down parts, but a village rebuilds. Should a
   monster ever be able to wipe out a small village?
4. **Peaceful animals and monsters:** proposal: the peaceful switch does not calm monsters. A separate "monsters
   sleep" law can come with World laws.
5. **Rewards:** proposal: meat, hides, wood and two rare items (gloom eye, heartwood) now, with no use yet beyond
   trade value. Uses (armour, charms, worship) come later with Peoples and traits.
6. **God powers:** proposal: `monster` (send one, confirm near villages) and `banish` (remove one) now. Yes?
