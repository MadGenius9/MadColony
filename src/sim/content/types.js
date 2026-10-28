// Content type schemas. Every piece of game content (base game included) is validated against these.
import { req, str, num, int, bool, ref, arr, obj, map } from './schema.js';
import { GIVER_SPECS, NEED_BEHAVIOR_SPECS } from './hooks.js';
import { validateTemplate } from './templates.js';
import { validate } from './schema.js';

const id = req({ type: 'id' });
const name = req(str(60));
const color = { type: 'color' };
const tags = arr({ type: 'tag' });
const qtyList = (to = 'item') => arr(obj({ item: req(ref(to)), qty: req(int(1, 10000)) }));
// Trip budgets (ai/trips.js), big worlds only, opt-in (aiProfile or scenario `travel`; the scenario's wins).
// Defaults for keys left out: maxWalk 120, checkBeyond 30, farFromHome 30, walkTicks 4.6, workTicks 150.
const TRAVEL = obj({
  maxWalk: num(1, 400),       // nodes farther than this walk are not gathered (the planner turns to quarrying or trade)
  checkBeyond: num(0, 400),   // work within this walk of the centre is never checked against needs
  farFromHome: num(0, 400),   // beyond this walk a colonist heads back to eat as soon as it is hungry (seekBelow)
  walkTicks: num(0.1, 100),   // ticks per tile of walk in the estimates
  workTicks: num(0, 100000),  // ticks allowed for the work itself in a trip budget
});
const render = obj({
  shape: { type: 'enum', values: ['tree', 'rock', 'bush', 'brush', 'patch', 'square', 'circle'] },
  color, color2: color,
  sprite: str(80), // optional sprite id or atlas binding name (cosmetic; falls back to the shape)
});

// Optional "how it looks" hints for the renderer. Unknown looks fall back to sensible defaults.
const look = (shapes) => obj({ shape: { type: 'enum', values: shapes }, color2: color, sprite: str(80) });
const terrainLook = obj({ style: { type: 'enum', values: ['grass', 'soil', 'sand', 'gravel', 'water', 'plain', 'shallows', 'mountain', 'marsh', 'snow'] } });
const ITEM_ICONS = ['logs', 'stones', 'beans', 'potatoes', 'berries', 'bowl', 'cup', 'axe', 'pickaxe', 'spear', 'bow', 'gun', 'ammo', 'clay', 'pot', 'produce', 'sack', 'crate'];
const itemLook = obj({ shape: { type: 'enum', values: ['logs', 'stones', 'basket', 'meal', 'tool', 'axe', 'pickaxe', 'spear', 'gun', 'crate', 'sack', 'pots'] }, color2: color, icon: { type: 'enum', values: ITEM_ICONS } });
const cropLook = look(['bush', 'vine', 'stalk']);
const buildingLook = look(['log_wall', 'stone_wall', 'plank_wall', 'door', 'bed', 'table', 'chair', 'campfire', 'workbench', 'desk', 'lamp', 'shelf', 'cabinet', 'rug', 'kiln', 'furnace', 'generator', 'pole', 'streetlamp', 'machine', 'battery', 'well', 'pump', 'tower', 'tap', 'pipe', 'hearth', 'heater', 'medbed', 'cabinet', 'quarry', 'grave']);

export const CONTENT_TYPES = {
  skill: {
    doc: 'A colonist skill (0-10). Raises work speed for work types that name it.',
    schema: obj({ id, name, description: str(300) }),
  },
  qualification: {
    doc: 'A qualification: the work types it speeds up (speed), how it is earned (practice: a skill level; course: college training, needing `requires`), and how many a settlement wants (staffing: perPeople with per, school, machines).',
    schema: obj({
      id, name,
      workTypes: arr(ref('workType')),
      speed: num(1, 5),
      practice: obj({ skill: req(ref('skill')), level: req(int(1, 10)) }),
      course: bool(),
      requires: arr(str(100)),
      staffing: { type: 'enum', values: ['perPeople', 'school', 'machines'] },
      per: int(1, 100),
      description: str(300),
    }),
  },
  lifeStage: {
    doc: 'A stage of life, in order (the last is adulthood). A stage may end after untilDays of life, need others to bring food and water (needsCare), attend school (attendsSchool), allow only some work types (workTypes) and keep out of fights (fights: false).',
    schema: obj({
      id, name,
      order: req(int(0, 100)),
      untilDays: num(0.1, 10000),
      needsCare: bool(), attendsSchool: bool(), fights: bool(),
      workTypes: arr(ref('workType')),
    }),
  },
  need: {
    doc: 'A colonist need. `behavior` picks a registered need behaviour (core:eat, core:sleep, core:drink, core:shelter).',
    schema: obj({
      id, name,
      behavior: req(str(60)),
      decayPerDay: req(num(0, 20)),
      seekBelow: req(num(0, 1)),
      urgentBelow: req(num(0, 1)),
      nightSeekBelow: num(0, 1),
      criticalBelow: num(0, 1), // below this a carrier drops its load to see to the need (default: urgentBelow / 2)
      sleepDecayMult: num(0, 5),   // core:eat / core:drink: decay while asleep, as a multiple of decayPerDay (default 1)
      beforeSleepBelow: num(0, 1), // seen to before going to sleep when below this (e.g. a drink before bed)
      maxBedDistance: num(1, 100000), // core:sleep: beyond this many tiles a bed is walked to only if energy lasts the walk; else sleep rough
      color,
    }),
  },
  terrain: {
    doc: 'Ground type.',
    schema: obj({ id, name, color: req(color), passable: req(bool()), buildable: req(bool()), fertility: req(num(0, 3)), moveCost: num(0.5, 5), drinkable: bool(), flammable: num(0, 1), render: terrainLook }),
  },
  item: {
    doc: 'Anything that can lie on the ground, be stored, carried, eaten, crafted or equipped.',
    schema: obj({
      id, name, color: req(color),
      stackLimit: req(int(1, 500)),
      value: num(0, 100000), // trade value per unit (default 1)
      tags,
      nutrition: num(0, 2),
      spoilPerDay: num(0, 1), // Phase 8 (spoil.js): this share of every stack and load spoils each day
      fuel: num(0, 100), // burn-time multiplier when used as generator fuel (default 1)
      equipment: obj({
        slot: req({ type: 'enum', values: ['tool', 'weapon'] }),
        workBoost: map({ type: 'ref', to: 'workType' }, num(0.1, 10)),
        durability: req(int(1, 1000000)),
        damage: num(0, 1000),
        range: num(1, 40), cooldown: int(1, 10000), accuracy: num(0, 1), ammo: ref('item'), // weapons
      }),
      render: itemLook,
      flammable: num(0, 1), // Phase 5b: how readily it burns (fire, lightning); default 0
    }),
  },
  node: {
    doc: 'A world resource node (tree, rock, bush, deposit). Worked by its `workType`; yields items per chunk.',
    schema: obj({
      id, name,
      workType: req(ref('workType')),
      work: req(int(1, 100000)),
      yields: req(qtyList()),
      cover: num(0, 0.9), // share of ranged hits it stops for someone sheltering beside it (default: 0.3 if solid)
      chunks: req(int(1, 100)),
      regrowDays: num(0.1, 100),
      sproutDays: num(0.1, 1000), // Phase 5b (regrow.js): a young one grows up in this many days
      passable: req(bool()),
      tags,
      render,
      flammable: num(0, 1), // Phase 5b: how readily it burns; default 0
    }),
  },
  crop: {
    doc: 'A plantable crop. Sowing consumes one `seed` item; harvesting a mature plant yields `harvest`.',
    schema: obj({
      id, name,
      seed: req(ref('item')),
      harvest: req(qtyList()),
      growDays: req(num(0.1, 60)),
      minFertility: num(0, 3),
      minTemp: num(-30, 40), // grows only while the season is at least this warm (°C, default 5)
      frost: num(-40, 30), // unripe plants die when it gets this cold (default -3)
      sowWork: int(1, 10000),
      harvestWork: int(1, 10000),
      color: req(color),
      tags,
      render: cropLook,
    }),
  },
  building: {
    doc: 'Walls, doors, furniture and work stations. Colonists place these via templates and slots.',
    schema: obj({
      id, name,
      category: req({ type: 'enum', values: ['wall', 'door', 'furniture', 'station'] }),
      passable: req(bool()),
      cover: num(0, 0.9), // share of ranged hits it stops (default: 0.5 for walls, 0.3 for other solid buildings)
      cost: req(qtyList()),
      // A data alternative for a slot (e.g. plank furniture): chosen only while its whole cost is in stock,
      // and then preferred over the usual pieces; never required (construction.js chooseSlot, planner planDecor).
      stockedOnly: bool(),
      work: req(int(1, 100000)),
      skill: ref('skill'),
      interaction: arr(int(-3, 3), { minItems: 2, maxItems: 2 }),
      slotTags: tags,
      furnishing: obj({ score: req(num(0, 100)) }),
      bed: obj({ restRate: req(num(0.1, 20)) }),
      medical: obj({ heal: req(num(1, 10)) }), // a medical bed: collapsed patients are carried here and heal faster
      supplies: obj({ tag: req({ type: 'tag' }), capacity: req(int(1, 1000)) }), // a cabinet that holds items with this tag
      research: obj({ speed: req(num(0.1, 10)) }),
      upgrade: obj({ to: req(ref('building')) }),
      // Electric power: generators have output + fuel; machines have use; poles (and both) have reach; batteries
      // have store (capacity, in power × ticks) and charge (the most power they take in or give out per tick).
      power: obj({
        output: num(0, 10000), use: num(0, 10000), reach: num(0, 30),
        store: num(1, 10000000), charge: num(0.01, 10000),
        fuel: obj({ tag: req({ type: 'tag' }), burnTicks: req(int(10, 1000000)), capacity: req(int(1, 1000)) }),
      }),
      // Sizing (planner.js planMachineCount, planGenerators; powered buildings only): machineHours = hours of
      // work one machine is counted on to do per day (default 8); maxMachines = the most of this kind a
      // settlement builds, machines and generators alike (default 3).
      machineHours: num(0.5, 24), maxMachines: int(1, 20),
      // Wear while running (generators while burning, machines while worked); serviced with `cost` and `work`.
      maintenance: obj({ wearPerHour: req(num(0.01, 100)), cost: qtyList(), work: req(int(1, 100000)) }),
      // Water: a drinking source (well: clean), or part of a water network: pump (units per hour, needs power),
      // storage (units held), tap (a drinking point fed by the network), pipe (connects neighbours).
      water: obj({ clean: bool(), pump: num(0.1, 10000), storage: int(1, 100000), tap: bool(), pipe: bool() }),
      light: obj({ radius: req(num(1, 20)) }),
      education: obj({ role: req({ type: 'enum', values: ['teacher', 'desk', 'lectern', 'bench'] }) }), // schools (teacher, desk) and lecture halls (lectern, bench)
      // Heating: warms the room it stands in (output: °C per hour for a 10-tile room) while that room is below
      // `target`; burns fuel from its own store (`fuel`) or uses power (`power.use`).
      heat: obj({ output: req(num(0.1, 100)), target: num(0, 40), fuel: obj({ tag: req({ type: 'tag' }), burnTicks: req(int(10, 1000000)), capacity: req(int(1, 1000)) }) }), // lights the tiles around it after dark (electric lights also need power)
      color: req(color),
      tags,
      render: buildingLook,
      flammable: num(0, 1), // Phase 5b: how readily it burns (default: the share of flammable materials in its cost)
    }),
  },
  template: {
    doc: 'A small floor plan colonists can choose and build by themselves. See docs/MODDING.md for the legend format.',
    schema: obj({
      id, name,
      kind: req({ type: 'enum', values: ['home', 'workshop', 'station'] }),
      capacity: int(0, 20),
      provides: arr(ref('building')),
      layout: req(arr(str(24), { minItems: 1, maxItems: 24 })),
      legend: req(map(null, obj({
        build: ref('building'),
        slot: { type: 'tag' },
        optional: bool(),
        floor: bool(),
        clear: bool(),
      }))),
      weight: num(0, 100),
    }),
  },
  recipe: {
    doc: 'A production recipe: ingredients + station + work time + skill -> outputs.',
    schema: obj({
      id, name,
      station: req(ref('building')),
      workType: req(ref('workType')),
      inputs: req(arr(obj({ item: ref('item'), tag: { type: 'tag' }, qty: req(int(1, 1000)) }, {
        check: (v, err) => { if (!!v.item === !!v.tag) err('each input needs exactly one of "item" or "tag"'); },
      }), { minItems: 1 })),
      outputs: req(qtyList()),
      work: req(int(1, 100000)),
      skill: ref('skill'),
      minSkill: int(0, 10),
      // A fallback recipe is only used while its output cannot be gathered (e.g. quarrying once no boulders are left).
      fallback: { type: 'bool' },
      fromStock: { type: 'bool' }, // Phase 8: only uses up goods on hand (butchering); the planner bills it only for a want naming it
    }),
  },
  workType: {
    doc: 'A category of work. `givers` compose registered job givers (see GIVER_SPECS) with parameters.',
    schema: obj({
      id, name,
      skill: ref('skill'),
      priority: req(num(0, 10)),
      givers: req(arr(obj({ giver: req(str(60)), params: { type: 'any' } }), { minItems: 1 })),
      // Chance per finished job of a work accident (an injury of min..max severity), and how it is described.
      hazard: obj({ chance: req(num(0, 1)), min: req(num(0, 100)), max: req(num(0, 100)), text: str(120) }),
      color,
    }),
  },
  spawnRule: {
    doc: 'World generation rule placing resource nodes on matching terrain.',
    schema: obj({
      id,
      node: req(ref('node')),
      terrain: req(arr(ref('terrain'), { minItems: 1 })),
      density: req(num(0, 1)),
      noiseScale: num(1, 100),
      noiseAbove: num(0, 1),
      minDistFromStart: int(0, 200),
      maxDistFromStart: int(0, 400),
      worldgen: arr(ref('worldgen')), // only for these world generators (all when omitted)
    }),
  },
  worldgen: {
    doc: 'Map size and terrain layering from a noise value 0..1 (first layer whose `below` exceeds the value wins).',
    schema: obj({
      id, name,
      width: req(int(24, 4096)),
      height: req(int(24, 4096)),
      noiseScale: req(num(2, 100)),
      startClearRadius: int(2, 20),
      startTerrain: ref('terrain'),
      layers: req(arr(obj({ terrain: req(ref('terrain')), below: req(num(0, 2)) }), { minItems: 1 })),
      // Seasons: the year's length in days, mid-summer and mid-winter temperatures (°C) and the day/night swing.
      climate: obj({ yearDays: int(4, 400), summer: num(-60, 60), winter: num(-80, 50), daySwing: num(0, 30) }),
      // Biome generation (worlds without it use the classic `layers`). Thresholds are shares of the map
      // (0.3 = the lowest 30% of tiles); the first rule whose conditions all hold picks the terrain.
      biomes: obj({
        elevationScale: num(4, 400), moistureScale: num(4, 400), edgeFalloff: num(0, 2), edgeWidth: num(0, 0.5),
        rivers: obj({ count: int(0, 200), terrain: req(ref('terrain')), sourceAbove: num(0, 1), spacing: int(0, 400), maxLength: int(1, 5000) }),
        passTerrain: ref('terrain'),
        start: obj({ terrain: arr(ref('terrain'), { minItems: 1 }), areaRadius: int(2, 20) }),
        rules: req(arr(obj({
          terrain: req(ref('terrain')),
          elevationBelow: num(0, 1), elevationAbove: num(0, 1), moistureAbove: num(0, 1), moistureBelow: num(0, 1), coldAbove: num(0, 1),
        }), { minItems: 1 })),
      }),
      // Planet generation (Phase 2b, worldgen.js planetWorld): plates and continents, climate bands, rivers
      // from drainage basins, and its own node rules. Scales marked "share" are fractions of the map's size
      // (the square root of its area); heights and moisture in `biomes` are shares of the land (0.9 = the
      // highest 10%); temperature runs from 0 at the poles to 1 at the equator, less on the heights.
      planet: obj({
        oceanShare: req(num(0.2, 0.9)),
        plates: obj({
          // continents: the continental plates form this many continents, with sea channels between them
          count: int(2, 64), continental: num(0.05, 0.95), continents: int(1, 32), landHeight: num(-2, 2), oceanHeight: num(-2, 2), jitter: num(0, 2),
          warp: num(0, 0.5), warpScale: num(0.01, 1), blend: num(0.001, 0.5),
          channel: num(0, 0.1), // half-width (share) of the strait always kept as sea between two continents
          dome: num(0, 1), // continental plates fall by this share from their middle to about a plate's width away
        }),
        ridges: obj({
          height: arr(num(-2, 2), { minItems: 3, maxItems: 3 }), // [ocean-ocean, ocean-continent, continent-continent]
          convergent: num(0, 1), rift: num(0, 1), width: num(0.001, 0.2), scale: num(2, 400), oceanSide: num(0, 1),
          split: num(0, 4), splitWidth: num(0.001, 0.3), // the sea channel between plates of different continents: depth, half-width (share)
          // Ranges come in segments (a noise along the edge: 0 below `cut`, full above cut + soft), vary in
          // width by up to `widthVary`, and fade out where the ground before them is below fadeBelow (+fadeWidth).
          segments: obj({ scale: num(0.001, 1), cut: num(0, 1), soft: num(0.01, 1) }), widthVary: num(0, 0.24),
          fadeBelow: num(-4, 4), fadeWidth: num(0.001, 4),
        }),
        shapeScale: num(0.005, 1), shapeWeight: num(0, 4), detailScale: num(2, 400), detailWeight: num(0, 4),
        edgeWidth: num(0, 0.5), edgeFalloff: num(0, 4),
        continentMinShare: num(0, 1), // a landmass with at least this share of the land counts as a continent
        coast: obj({ shallowWidth: int(0, 50) }),
        climate: obj({
          lapse: num(0, 2), lapseFrom: num(0, 0.99), jitter: num(0, 1), noiseScale: num(0.005, 1),
          seaReach: num(1, 2000), seaWeight: num(0, 4), beltWeight: num(0, 4), noiseWeight: num(0, 4),
        }),
        lakes: obj({ minDepth: num(0, 1), share: num(0, 1), minArea: int(1, 100000) }),
        rivers: req(obj({ terrain: req(ref('terrain')), minDrainage: num(1, 1e7), mountainRain: num(0, 100) })),
        terrain: req(obj({ ocean: req(ref('terrain')), shallow: req(ref('terrain')), lake: req(ref('terrain')), mountain: req(ref('terrain')) })),
        passTerrain: req(ref('terrain')),
        minPocket: int(0, 10000), // open pockets walled in by mountains smaller than this become mountain (not joined by a pass)
        start: req(obj({ terrain: req(arr(ref('terrain'), { minItems: 1, maxItems: 16 })), areaRadius: int(2, 20) })),
        biomes: req(arr(obj({
          terrain: req(ref('terrain')),
          heightAbove: num(0, 1), heightBelow: num(0, 1), tempAbove: num(-2, 2), tempBelow: num(-2, 2),
          moistureAbove: num(0, 1), moistureBelow: num(0, 1), coastWithin: int(0, 1000),
        }), { minItems: 1, maxItems: 200 })),
        nodeBudget: num(0.001, 1), // at most this many nodes per map tile (densities scale down evenly)
        nodes: arr(obj({
          node: req(ref('node')),
          terrain: req(arr(ref('terrain'), { minItems: 1 })),
          density: req(num(0, 1)),
          noiseScale: num(1, 100), noiseAbove: num(0, 1),
          minDistFromStart: int(0, 200),
        })),
      }),
    }),
  },
  aiProfile: {
    doc: 'Tunable AI parameters and the colony survival policy.',
    schema: obj({
      id, name,
      workWeights: map({ type: 'ref', to: 'workType' }, num(0, 10)),
      distanceWeight: num(0, 2),
      sameWorkBonus: num(0, 2),
      skillWeight: num(0, 1),
      // Trip budgets (ai/trips.js), big worlds only; opt-in: off unless this profile or the scenario sets it.
      travel: TRAVEL,
      policy: req(obj({
        mealsPerColonist: num(0, 50),
        foodDays: num(0, 60),
        stock: map({ type: 'ref', to: 'item' }, int(0, 10000)),
        maxActiveProjects: int(1, 10),
        equipTools: bool(),
        armColonists: bool(),
        fillDecorSlots: bool(),
        stockpileMinFree: int(0, 50),
        maxFieldTiles: int(0, 1000),
        fieldSize: arr(int(2, 12), { minItems: 2, maxItems: 2 }),
        maxResearchers: int(0, 50),
        researchMinFoodDays: num(0, 60),
        renovate: bool(),
        renovateMinFoodDays: num(0, 60),
        maxPopulation: int(1, 1000), // births stop at this head-count (default 12)
        allowEmigration: bool(), // settlers may leave a crowded village to found a new one (default true)
      })),
    }),
  },
  scenario: {
    doc: 'Starting conditions. `neighbors` founds AI villages (villageProfile) that follow exactly the same rules.',
    schema: obj({
      id, name,
      colonists: req(int(1, 20)),
      startItems: req(qtyList()),
      namePool: req(ref('namePool')),
      skillMin: int(0, 10),
      skillMax: int(0, 10),
      neighbors: arr(ref('villageProfile'), { maxItems: 40 }),
      neighborDistance: int(12, 80),
      villages: int(1, 40), // how many AI villages (profiles repeat in order); defaults to the neighbours listed
      worldgen: ref('worldgen'), // the world this scenario is played on (otherwise the first worldgen)
      god: ref('godRules'), // the god-power rules of this scenario (god.js; otherwise core:god, else the first godRules)
      size: { type: 'enum', values: ['small', 'medium', 'large', 'huge', 'colossal', 'vast', 'world'] }, // default world size preset
      placement: { type: 'enum', values: ['ring', 'spread', 'far'] }, // ring: around the player (default); spread: over the whole land; far: far apart on good sites (farPlacement)
      siteWaterWalk: int(4, 200), // spread placement on big worlds: prefer village sites with a lake shore within this walk (tiles); far: required
      // placement 'far' (villages.js farSites): sites on the player's land, at least
      // max(minSpacing, round(spacingFactor x sqrt(W x H))) tiles from every settlement, with water, open ground,
      // wood, stone and fertile land nearby; farthest first, rewarding good sites and new biomes.
      farPlacement: obj({
        minVillages: int(1, 40),            // the fewest AI villages New colony offers
        maxVillages: int(1, 40),            // the most AI villages (asked-for counts are capped here)
        spacingFactor: num(0, 1),           // spacing as a share of sqrt(W x H) (0.1: Vast 133, World 177)
        minSpacing: int(12, 1000),          // ... never less than this many tiles
        grid: int(4, 32),                   // candidate grid step (tiles); resources are counted per grid cell
        openRadius: int(3, 12),             // the square of this radius round a centre must be buildable ground (3+: the village block)
        minWood: int(0, 10000),             // trees within about 1.5 grid cells of the centre, at least
        minStone: int(0, 10000),            // boulders, at least
        minFertile: int(0, 10000),          // tiles of fertility 1 or more, at least
        woodCap: int(1, 10000),             // counts above these caps score no better
        stoneCap: int(1, 10000),
        fertileCap: int(1, 10000),
        weights: obj({ wood: num(0, 10), stone: num(0, 10), fertile: num(0, 10), water: num(0, 10), biome: num(0, 10), distanceCap: num(1, 100) }),
        biomes: map({ type: 'ref', to: 'terrain' }, str(30)), // terrain -> biome name (a site's biome is its commonest terrain's)
      }, { check: (v, err) => {
        if (v.minVillages !== undefined && v.maxVillages !== undefined && v.minVillages > v.maxVillages) err('minVillages must not be above maxVillages');
      } }),
      // Era drive (planner.js): every village with no player era goal works toward the next era by itself (its
      // milestones become build targets and wanted research at this urgency). Absent: only player goals do.
      // Phase 5 slice 2 (life.js): cold and old age. cold: below `below` °C where a colonist is, hypothermia grows by
      // perHour severity an hour per degree under it. aging: elders (from elderAge years) work at elderWork speed;
      // from deathAge a daily chance of death (perYear a year, perYearStep more per year past it); startAges [lo, hi]
      // for new adults of unknown age.
      // Phase 5 slice 3 (illness.js): outbreaks (a daily chance per village with nobody ill, raised by `crowding` x the
      // share of people without a bed; none before graceDays), the illnesses by weight, and the share of the contagion
      // that reaches people of the village who do not share the sick person's home.
      // Phase 5 slice 5 (war.js): rivalry from pressing borders (perDay a day x the profiles' mean temperament, never
      // below floor by this cause) and AI war declarations (relation <= declareBelow, stronger x the target's strength,
      // at least minStrength; on the player's village only warnDays after a threat).
      war: obj({
        rivalry: obj({ perDay: req(num(0, 20)), floor: req(num(-100, 0)), near: num(0, 5000), nearPerDay: num(0, 20) }),
        declareBelow: req(num(-100, 0)), stronger: req(num(1, 10)), minStrength: num(0, 100), warnDays: num(0, 30),
        battle: obj({ woundsPerStrength: req(num(0, 10)), minSeverity: req(num(1, 100)), maxSeverity: req(num(1, 100)) }), // slice 5b
        truce: obj({ weakerShare: req(num(0, 1)), maxDays: req(num(1, 1000)), minDays: num(0, 1000) }),
        conquest: obj({ beatenDays: req(num(0, 100)), tribute: req(num(0, 1)), beatenShare: num(0, 1) }), // slice 6b
      }),
      illness: obj({
        outbreakPerDay: req(num(0, 1)), crowding: num(0, 100), graceDays: num(0, 1000), villageShare: num(0, 1),
        kinds: req(arr(obj({ illness: req(ref('illness')), weight: req(num(0, 1000)) }), { minItems: 1 })),
      }),
      life: obj({
        cold: obj({ below: req(num(-60, 30)), perHour: req(num(0.01, 50)), shelter: num(0, 40), fires: arr(ref('building')), fireRadius: int(0, 50), foundWaitDays: num(0, 30) }),
        aging: obj({
          elderAge: req(num(1, 500)), elderWork: req(num(0.1, 1)), deathAge: req(num(1, 500)),
          perYear: req(num(0, 1)), perYearStep: req(num(0, 1)),
          startAges: arr(int(0, 500), { minItems: 2, maxItems: 2 }),
        }, { check: (v, err) => {
          if (v.elderAge > v.deathAge) err('elderAge must not be above deathAge');
          if (v.startAges && v.startAges[0] > v.startAges[1]) err('startAges must be [lowest, highest]');
        } }),
      }),
      animals: obj({ species: req(arr(ref('animal'))), scale: num(0, 100) }), // Phase 8 (animals.js): wild herds (default: every species; [] turns them off)
      nature: obj({ spread: arr(obj({ node: req(ref('node')), perDay: req(num(0, 1)), radius: req(int(1, 10)), minNear: int(0, 24), maxNear: req(int(1, 24)) })) }), // Phase 5b (regrow.js): forests spread
      travel: TRAVEL, // trip budgets for colonists (ai/trips.js); absent: off unless the AI profile sets it
      eraDrive: obj({ urgency: num(0, 2), afterDays: num(0, 3650) }), // afterDays: from this many days after the village's founding (default 0)
      // Villages founded during play by settlers leaving crowded villages (founding.js). Absent: off.
      founding: obj({
        maxVillages: req(int(2, 200)),      // no founding once the world has this many villages
        minAdults: int(2, 100),             // adults the parent needs before anyone leaves
        crowdedDays: num(0, 365),           // days at the population cap before settlers leave
        foodDaysLeft: num(0, 365),          // food the parent must still have after they go
        cooldownDays: num(0, 3650),         // days between two foundings by the same village
        founders: arr(int(1, 50), { minItems: 2, maxItems: 2 }), // [fewest, most] adults who leave
        sendFoodDays: num(0, 60),           // days of food for the founders sent along as a gift
        sendItems: map({ type: 'ref', to: 'item' }, int(1, 10000)), // materials sent along (what the parent can spare)
        searchRadius: int(8, 200),          // site search window around the parent's centre
        minSpacing: int(8, 200),            // the new centre stays this far from every village centre
        siteRetryDays: num(0, 365),         // after no site was found, the village looks again after this many days
        growBeds: int(0, 20),               // a village under its cap with food to spare keeps this many spare beds (room for births)
        growAfterDays: num(0, 365),         // ... once the village has stood this many days (default 5)
        // Phase 2b slice 6 (absent: the Living world's rule, one search and one founding a day world-wide, the
        // first village in id order). Present: each village founds at most once per cooldownDays, and the world
        // at most perDay villages and searchesPerDay site searches a day (a performance guard).
        perDay: int(1, 50),
        daughterMinDays: num(0, 3650),     // a village founded during play sends settlers out only once it has stood this many days (default 0)
        searchesPerDay: int(1, 200),
        // Outward sites (organic territory only): daughters settle anywhere on land their parent has discovered
        // within max(searchRadius, claim radius + 8, searchFactor x sqrt(W x H) up to maxSearch) tiles, at the
        // best-scoring candidate (founding.js outwardSite): far from other centres, unclaimed, wood, stone,
        // fertile ground, away from the parent.
        outward: obj({
          searchFactor: num(0, 1), maxSearch: int(8, 1000), stride: int(2, 32), cell: int(2, 32), box: int(0, 8),
          discovered: bool(), farCap: num(1, 1000),
          woodItem: ref('item'), stoneItem: ref('item'),
          weights: obj({ far: num(0, 10), free: num(0, 10), wood: num(0, 10), stone: num(0, 10), fertile: num(0, 10), out: num(0, 10) }),
          caps: obj({ wood: num(1, 10000), stone: num(1, 10000) }),
        }),
      }, { check: (v, err) => {
        if (Array.isArray(v.founders) && v.founders[0] > v.founders[1]) err('founders must be [fewest, most]');
        if (v.minSpacing !== undefined && v.searchRadius !== undefined && v.minSpacing >= v.searchRadius) err('minSpacing must be smaller than searchRadius');
      } }),
      // Territory (territory.js). 'nearest' (default): every tile belongs to the village whose centre is
      // nearest. 'organic' (Phase 2b): each village claims land outward from its centre, a little more each
      // day, along the cheapest ground (claims below); unclaimed land belongs to nobody.
      territory: { type: 'enum', values: ['nearest', 'organic'] },
      // Organic territory: claim radius = min(maxRadius, baseRadius + perPerson x people + perDay x days since
      // founding), in tiles of open land; other ground costs `costs` (default defaultCost) per tile, `stops`
      // are never claimed (open water). Tiles of cost steepCost or more are named as limits on the village card.
      claims: obj({
        baseRadius: num(0, 500),
        perPerson: num(0, 50),
        perDay: num(0, 10),
        maxRadius: num(1, 2000),
        defaultCost: num(1, 100),
        costs: map({ type: 'ref', to: 'terrain' }, num(1, 100)),
        stops: arr(ref('terrain'), { maxItems: 64 }),
        steepCost: num(1, 100),
        buildReach: int(0, 20),             // organic claimOk: build on own land or on unclaimed land this close to it (default 2)
      }, { check: (v, err) => {
        if (v.baseRadius !== undefined && v.maxRadius !== undefined && v.baseRadius > v.maxRadius) err('baseRadius must not be above maxRadius');
        if (v.stops && v.costs && v.stops.some((t) => Object.hasOwn(v.costs, t))) err('a terrain cannot both stop claims and have a claim cost');
      } }),
      // Contact over distance (contact.js, Phase 2b slice 5). Absent: off (classic and Living worlds), and no
      // state is added. explore: every settlement sends an expedition over its landmass (a travelling entity,
      // no colonist leaves) to farther, undiscovered chunks; passing near another village's land or centre
      // makes contact. traders: villages in contact visit each other (a small relation bonus, no goods).
      // borders: organic territories that come to touch make contact.
      contact: obj({
        explore: obj({
          everyDays: req(num(0.1, 365)),    // days between an expedition's return and the next one leaving
          firstDays: num(0, 365),           // days after founding before the first one leaves (default 1)
          firstRange: int(1, 500),          // the first trip's reach, in chunk steps from home (default 3)
          rangeStep: num(0, 100),           // each trip reaches this many chunk steps farther (default 2)
          maxRange: int(1, 500),            // ... up to this many (default 48)
          tilesPerDay: req(num(1, 100000)), // travelling speed over open land
          sight: int(0, 4),                 // chunks round the expedition marked discovered (default 1)
          reach: int(0, 200),               // tiles beyond its chunk in which it meets a village's land or centre (default 8)
          minLand: num(0, 1),               // a chunk is land when this share of it is walkable (default 0.2)
          // Slice 6: the target is the undiscovered chunk in reach with the most undiscovered land round it
          // (within `around` chunks; 0 = off, the farthest one) plus `farWeight` x its distance in chunk steps.
          around: int(0, 8),
          farWeight: num(0, 100),
        }),
        traders: obj({
          everyDays: req(num(0.1, 365)),    // days between two trader trips from one village
          firstDays: num(0, 365),           // days after founding before the first (default 2)
          tilesPerDay: req(num(1, 100000)),
          relation: num(0, 20),             // relation bonus when traders arrive (default 1)
        }),
        borders: bool(),                    // organic territories that touch make contact (default true)
        // Colonists on foot (ai/givers.js), so no one walks off across the planet: the scout giver aims only at
        // villages whose centre is within scoutRange tiles of home (default 60; farther, explorers make contact)
        // and only when eating, drinking and sleep needs are all above scoutNeeds (default 0.7); carers tend only
        // patients within tendRange tiles of their village centre (default 60).
        scoutRange: num(0, 100000),
        scoutNeeds: num(0, 1),
        tendRange: num(0, 100000),
        tradeWalkRange: num(0, 100000),     // trade legs to villages farther than this (centre to centre) go by caravan, also from villages at full detail (default 60)
        // Slice 6: finished trades (done, expired, cancelled) are removed this many days after they ended (their
        // deadline or completion); completed ones are still counted per pair (relation tradesDone). Absent: kept.
        pruneTradesDays: num(0, 3650),
        // Slice 6: villages agree trades only with villages within tradeRange tiles (centre to centre), nearest
        // pairs first, and each takes part in at most maxActiveTrades active trades at once. Absent: no limit.
        tradeRange: num(1, 100000),
        maxActiveTrades: int(1, 100),
      }),
      // Markets (markets.js): the market building can be researched and built only where this block is
      // present; prices follow supply and demand in the villages a market reaches. Absent: off (classic).
      market: obj({
        building: ref('building'),          // the market building (default core:market)
        reach: num(1, 2000),                // a market serves villages whose centres are within this many tiles
        k: num(0.01, 10000),                // smoothing: target = value x clamp((demand + k) / (supply + k), minFactor, maxFactor)
        minFactor: num(0.01, 1),            // the lowest price, as a share of the item's value
        maxFactor: num(1, 100),             // the highest price, as a multiple of the item's value
        step: num(0.01, 1),                 // share of the way to the target a price moves each day
        minContacts: int(1, 200),           // a village builds a market once it has met this many villages
        researchContacts: int(1, 200),      // ... and wants the research for it once it has met this many
        urgency: num(0, 2),                 // planner urgency of building the market (default 0.3)
        // Slice 6 (contact games): a market also serves villages it has met on the same landmass (contact.js
        // land chunks) whose centres are within landReach tiles. Absent: reach only.
        landReach: num(1, 10000),
      }, { check: (v, err) => {
        if (v.minFactor !== undefined && v.maxFactor !== undefined && v.minFactor > v.maxFactor) err('minFactor must not be above maxFactor');
      } }),
    }),
  },
  villageProfile: {
    doc: 'The personality of an AI village: who lives there, what it starts with, what it researches and keeps in stock, and how it trades. No free resources: it uses the same economy as the player.',
    schema: obj({
      id, name,
      settlementNames: req(arr(str(40), { minItems: 1 })),
      // Kingdom name patterns ("Kingdom of {capital}"), used when a village of this profile becomes a capital
      // (kingdoms.js picks one by a hash of the capital's id; without them the defaults are used).
      kingdomNames: arr(str(60), { minItems: 1, maxItems: 12 }),
      color: req(color),
      colonists: req(int(1, 12)),
      startItems: req(qtyList()),
      research: map({ type: 'ref', to: 'techField' }, int(0, 3)),
      policy: obj({
        mealsPerColonist: num(0, 50), foodDays: num(0, 60), stock: map({ type: 'ref', to: 'item' }, int(0, 10000)),
        maxActiveProjects: int(1, 10), equipTools: bool(), fillDecorSlots: bool(), maxResearchers: int(0, 50),
        researchMinFoodDays: num(0, 60), renovate: bool(), renovateMinFoodDays: num(0, 60),
        maxPopulation: int(1, 1000), allowEmigration: bool(),
      }),
      trade: obj({ willingness: num(0, 1), generosity: num(0, 1), keepExtra: int(0, 1000) }),
      // Laws on controlled goods (items tagged core:controlled), keyed by item id, by tag, or `default`.
      laws: map(str(80), { type: 'enum', values: ['legal', 'restricted', 'banned'] }),
      enforcement: num(0, 1), // how strict the village watch is (seizure odds)
      temperament: num(0, 5), // Phase 5 (war.js): how quickly it quarrels over land (default 1)
      conquest: { type: 'enum', values: ['absorb', 'sack'] }, // Phase 5 (war.js): what it does with a village it beats (default absorb)
    }),
  },
  techField: {
    doc: 'A research field the player can prioritise (agriculture, construction, ...).',
    schema: obj({ id, name, color, order: int(0, 1000) }),
  },
  era: {
    doc: 'An age of technology. Settlements advance when every milestone of the next era is met (never on a timer).',
    schema: obj({
      id, name, order: req(int(0, 1000)), description: str(400),
      milestones: arr(obj({
        type: req({ type: 'enum', values: ['techs', 'buildings', 'colonists'] }),
        era: ref('era'), field: ref('techField'), building: ref('building'),
        count: req(int(1, 100000)),
        text: str(160),
      })),
    }),
  },
  tech: {
    doc: 'A technology. Researching it unlocks the listed recipes/buildings/templates; it never creates anything by itself.',
    schema: obj({
      id, name, description: str(400),
      field: req(ref('techField')),
      era: req(ref('era')),
      prerequisites: arr(ref('tech')),
      // Only researchable in scenarios that turn this feature on (a scenario block of that name, e.g. `market`).
      scenarioFeature: { type: 'enum', values: ['founding', 'market'] },
      research: req(int(10, 10000000)),
      cost: qtyList(),
      unlocks: req(obj({ recipes: arr(ref('recipe')), buildings: arr(ref('building')), templates: arr(ref('template')) })),
    }),
  },
  namePool: {
    doc: 'Colonist names.',
    schema: obj({ id, name, names: req(arr(str(30), { minItems: 1 })), surnames: arr(str(30)) }), // surnames: used once every first name is taken (names.js)
  },
  animal: {
    doc: 'A wild animal species (animals.js, Phase 8). Herds of herd [lo, hi] live on its terrains: density herds per 1,000 tiles of them when the world starts, cap animals per 1,000 tiles the land feeds. Far from people a herd is a count, moved one chunk at most every moveHours and grown once a year in spring by births (less as its land fills); winterLoss a day in winter (three times that on poor winter ground: under a fifth of its ground is winterTerrains, which it moves toward in winter); droughtLoss a day in a drought (grazers also move away from one). godCost: favour a head when the gods send it (the animals power, godanimals.js; default 3). lostLoss (default 0.05) a day in a chunk with none of its ground, crowdLoss (default 0.03) in a chunk holding over 1.5 times what its ground feeds; such herds also move on. diet graze or hunt (prey: species it eats; a pack with no prey for starveDays loses one). fear: the distance at which it runs from people and from predators.',
    schema: obj({
      id, name, plural: str(40),
      herd: req(arr(int(1, 100), { minItems: 2, maxItems: 2 })), terrains: req(arr(ref('terrain'), { minItems: 1 })),
      density: req(num(0, 100)), cap: req(num(0, 1000)), health: req(num(1, 1000)), speed: req(num(0.1, 10)),
      diet: req({ type: 'enum', values: ['graze', 'hunt'] }), prey: arr(ref('animal')),
      fear: obj({ people: num(0, 50), predators: num(0, 50) }),
      carcass: ref('item'), // what a kill leaves (hunting, Phase 8 slice 3)
      births: req(num(0, 10)), winterLoss: req(num(0, 1)), winterTerrains: arr(ref('terrain'), { minItems: 1 }), droughtLoss: num(0, 1), godCost: num(0, 1000), lostLoss: num(0, 1), crowdLoss: num(0, 1), moveHours: req(num(1, 1000)), starveDays: int(1, 1000),
      color, render,
    }),
  },
  illness: {
    doc: 'A contagious illness (illness.js, Phase 5). While ill (days), its severity grows by growPerHour (treatedGrowth of that once a doctor treats it with medicine); then it heals and the person is immune for immunityDays. contagion: daily chance to pass it to each person sharing a home (scenario villageShare of it for the rest of the village); travel: chance to pass along a contact between villages (a delivery, caravan or traders).',
    schema: obj({
      id, name,
      contagion: req(num(0, 1)), travel: req(num(0, 1)),
      growPerHour: req(num(0, 50)), days: req(num(0.1, 100)), immunityDays: req(num(0, 10000)), treatedGrowth: req(num(0, 1)),
      plague: { type: 'bool' }, // Phase 5b: sent by the plague power; spreads even where a scenario has no illness rules
    }),
  },
  godRules: {
    doc: 'The numbers behind the god powers (god.js, Phase 2c): favour (start, max, regeneration perDay), the cost of each power (costs.settler is per settler; omen is the harmless test power, default 0), blessing length and multipliers, the inspire fraction, and the spawn limits and supplies. A scenario picks one with its optional `god` id; otherwise core:god applies. In a Sandbox game every power is free.',
    schema: obj({
      id, name,
      favour: req(obj({ start: req(num(0, 1e6)), max: req(num(0, 1e6)), perDay: req(num(0, 1e6)) }, { check: (v, err) => {
        if (v.start > v.max) err('start must not be above max');
      } })),
      costs: req(obj({ settler: req(num(0, 1e6)), bless: req(num(0, 1e6)), inspire: req(num(0, 1e6)), omen: num(0, 1e6),
        lightning: num(0, 1e6), smite: num(0, 1e6), fire: num(0, 1e6), meteor: num(0, 1e6), quake: num(0, 1e6), tornado: num(0, 1e6), plague: num(0, 1e6), rain: num(0, 1e6), drought: num(0, 1e6) })), // Phase 5b
      bless: req(obj({ days: req(num(0.1, 1000)), maxDays: req(num(0.1, 1000)), work: req(num(1, 10)), growth: req(num(1, 10)) }, { check: (v, err) => {
        if (v.days > v.maxDays) err('days must not be above maxDays');
      } })),
      // Phase 5b (godwrath.js): numbers of the destructive powers; defaults in godwrath.js.
      wrath: obj({
        lightning: obj({ wound: req(arr(num(0, 100), { minItems: 2, maxItems: 2 })) }),
        meteor: obj({ radius: int(1, 6), ring: int(0, 8), wound: arr(num(0, 100), { minItems: 2, maxItems: 2 }), fire: num(0, 1), iron: arr(int(0, 100), { minItems: 2, maxItems: 2 }), item: ref('item') }),
        plague: obj({ share: num(0, 1), illness: ref('illness') }),
        weather: obj({ rain: obj({ radius: int(1, 100), days: num(0.05, 60), grow: num(0, 10) }), drought: obj({ radius: int(1, 100), days: num(0.05, 60), wither: num(0, 10), spread: num(0, 10) }), maxAreas: int(1, 20) }),
        tornado: obj({ step: int(1, 2400), hours: num(0.1, 48), radius: int(0, 4), wander: num(0, 1), destroy: num(0, 1), light: num(0, 1), wound: arr(num(0, 100), { minItems: 2, maxItems: 2 }), throw: arr(int(0, 20), { minItems: 2, maxItems: 2 }), maxStorms: int(1, 20) }),
        quake: obj({ radius: int(1, 30), collapse: num(0, 1), sturdy: num(0, 1), wound: arr(num(0, 100), { minItems: 2, maxItems: 2 }) }),
        fire: obj({ step: int(1, 2400), spread: num(0, 1), burnTicks: int(1, 100000), maxTiles: int(1, 100000), burnPerStep: num(0, 100), scorchDays: num(0, 1000), cropFlammable: num(0, 1), threat: int(0, 10), fightReach: int(0, 200) /* 0: no firefighting */, fightWork: num(1, 10000), fightWater: int(0, 50), distantPut: num(0, 1) }),
      }),
      inspire: req(obj({ fraction: req(num(0.01, 1)) })), // research share added per inspiration (above 0: an inspiration always advances)
      spawn: req(obj({
        maxCount: req(int(1, 10)),            // the most settlers one command may bring
        suppliesPerSettler: req(qtyList()),   // found: created at the site (source 'divine') per settler
        joinSupplies: req(qtyList()),         // join: a small bundle per settler
        joinOverHousing: req(int(0, 100)),    // join: a village may take settlers up to its housing plus this many
      })),
    }),
  },
};

export const TYPE_NAMES = Object.keys(CONTENT_TYPES);

// Checks that need the whole registry (run after all enabled mods are loaded).
export function crossValidate(reg, type, def) {
  const errors = [];
  if (type === 'workType') {
    def.givers.forEach((g, i) => {
      const spec = GIVER_SPECS[g.giver];
      if (!spec) errors.push(`givers[${i}]: unknown giver "${g.giver}". Available: ${Object.keys(GIVER_SPECS).join(', ')}`);
      else {
        const ctx = { errors: [], refs: [] };
        validate(g.params ?? {}, spec.params, `givers[${i}].params`, ctx);
        errors.push(...ctx.errors);
      }
    });
  }
  if (type === 'need' && !NEED_BEHAVIOR_SPECS[def.behavior]) {
    errors.push(`unknown behavior "${def.behavior}". Available: ${Object.keys(NEED_BEHAVIOR_SPECS).join(', ')}`);
  }
  if (type === 'template') errors.push(...validateTemplate(reg, def));
  if (type === 'recipe') {
    const st = reg.get('building', def.station);
    if (st && st.category !== 'station') errors.push(`station "${def.station}" is not a building with category "station"`);
    for (const inp of def.inputs) {
      if (inp.tag && !reg.all('item').some((it) => (it.tags || []).includes(inp.tag))) errors.push(`no item has tag "${inp.tag}"`);
    }
  }
  if (type === 'building' && def.category === 'station' && !def.interaction) errors.push('stations need an "interaction" offset [dx, dy]');
  if (type === 'building' && (def.machineHours !== undefined || def.maxMachines !== undefined) && !(def.power?.use > 0 || def.power?.output > 0)) errors.push('machineHours and maxMachines size powered machines and generators: this building has no power use or output');
  if (type === 'building' && def.power && (def.power.store !== undefined) !== (def.power.charge !== undefined)) errors.push('a battery needs both power.store (capacity) and power.charge (rate)');
  if (type === 'building' && def.power?.store !== undefined && (def.power.output > 0 || def.power.use > 0 || def.power.fuel)) errors.push('a battery (power.store) cannot also be a generator or a machine: no power.output, power.use or power.fuel');
  if (type === 'building' && def.upgrade) {
    const to = reg.get('building', def.upgrade.to);
    if (to && to.category !== def.category) errors.push(`upgrade target "${to.id}" must have the same category (${def.category})`);
    if (to && to.passable !== def.passable) errors.push(`upgrade target "${to.id}" must have the same passability`);
    if (def.upgrade.to === def.id) errors.push('a building cannot upgrade into itself');
  }
  if (type === 'tech') {
    const era = reg.get('era', def.era);
    for (const p of def.prerequisites || []) {
      const pe = reg.get('era', reg.get('tech', p)?.era);
      if (era && pe && pe.order > era.order) errors.push(`prerequisite "${p}" belongs to a later era than this technology`);
    }
    // Cycle check: following prerequisites from this tech must never lead back to it.
    const seen = new Set();
    const stack = [...(def.prerequisites || [])];
    while (stack.length) {
      const t = stack.pop();
      if (t === def.id) { errors.push('circular prerequisites (this technology eventually requires itself)'); break; }
      if (seen.has(t)) continue;
      seen.add(t);
      stack.push(...(reg.get('tech', t)?.prerequisites || []));
    }
    const u = def.unlocks || {};
    if (!(u.recipes?.length || u.buildings?.length || u.templates?.length)) errors.push('unlocks nothing (every technology must unlock at least one recipe, building or template)');
  }
  if (type === 'era') {
    for (const [i, m] of (def.milestones || []).entries()) {
      if (m.type === 'buildings' && !m.building) errors.push(`milestones[${i}]: "buildings" milestones need a building`);
      if (m.type === 'techs' && !m.era && !m.field) errors.push(`milestones[${i}]: "techs" milestones need an era or a field`);
    }
  }
  if (type === 'crop' && def.minFertility === undefined) { /* defaults to 0.5 */ }
  return errors;
}
