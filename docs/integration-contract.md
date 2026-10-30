# Integration contract: cloud simulation ↔ home UI (Phase 11, item 1)

## 1. Status and how to use this file
- **Status:** built and tested in the cloud. **Not playable.** Nothing here has been run with the real UI
  (`src/ui`, `index.html` are not in the rescue copy). Every UI-side statement below is untested.
- **What it covers:** the cloud phases 5, 5b, 8, 8b, 8c, World shaping, Peoples and traits, World laws,
  Civilization laws and Mood (docs/ROADMAP.md marks each "Done in the cloud copy").
- **Sources:** `docs/ui-todo.md` (what to show), `docs/proposals/*.md` (Results), and the code in `src/sim`. Every
  function and field below was checked by grep against `src/sim` on 2026-10-30. Where ui-todo and the code
  disagree, see section 6.
- **How to use it at home:** work through sections 3 and 4 against the UI. Tick off each row once the UI calls or
  shows it, then mark the phase "playable" in the roadmap.
- **Units:** `TICKS_PER_HOUR = 100` and `TICKS_PER_DAY = 2400` (constants.js). Day N = `Math.floor(tick / 2400)`.
- **Reading never changes the game:** read `g.plans[sid]` and do not call `g.ensurePlan` from the UI. Preview with
  `previewCommand`. It is read-only and makes no random draws.

## 2. Save formats
`SAVE_FORMAT = 33` (src/sim/constants.js). Older saves are upgraded step by step by `migrateState`
(src/sim/migrate.js). After that, `loadGame(reg, saveOrText)` (src/sim/save.js) fills and mends the state.

| Format | Adds (all optional; absent = the old behaviour) |
|---|---|
| 13 | `s.god` (favour, queue, log, spawned, blessings) |
| 14 | `structure.charge` on batteries |
| 15 | `s.dead`, `colonist.health.zeroSince`, `s.stats.deaths` |
| 16 | `s.bodies`, `structure.grave`, `settlement.graveyard`, `colonist.grief`, `dead.buried/graveId` |
| 17 | sickness injury fields `illness/until/over`, `colonist.immune`, `s.stats.illness` |
| 18 | `colonist.lasting`, injury `deep/mended` |
| 19 | `relation.touch`, `relation.threat` |
| 20 | `relation.warSince` |
| 21 | `settlement.fallen` |
| 22 | `relation.beaten`, `trade.tribute` |
| 23–26 | `s.disasters`: `fires`, `scorched` (23), `storms` (24), `weather`, `plague` (25), `seeds` + `node.young` (26) |
| **27** | `s.animals` (herds). If absent, the herds are placed at the next tick. |
| **28** | `s.animals.ledger` (per species: start, born, sent, died by cause). migrate.js builds it from the herds. |
| **29** | `s.monsters` (lairs, list, ledger). If absent, the lairs are placed at the next tick. |
| **30** | `colonist.people/traits`, `settlement.people`, `dead.people/traits`. loadGame fills them: the village's people (else the default) and traits drawn by hash. |
| **31** | `s.worldLaws { set, since }`. `mendLaws` drops laws that no loaded mod defines. |
| **32** | `settlement.code { law: option }`, `settlement.codeSince { law: tick }`. `mendCode` drops unknown laws. |
| **33** | `colonist.mood`, `colonist.ate { t, m, f }`, `colonist.rough`; save.js also validates `colonist.breakUntil` and `settlement.unrest` |

- Blank worlds save `s.playerSettlement === null` and `s.settlements = {}` until the first village is founded.
- World shaping added no new state (format stays 29). It bumps `s.map.rev`, which the map must watch.
- Meteor craters change terrain without bumping `s.map.rev`. The terrain layer must also redraw when
  `g.terrainDrawRev` changes. That field is derived and never saved (game.js `setTerrainKeepRev`).

## 3. Player actions (commands)

### 3a. God powers
- **Preview (read-only):** `previewCommand(g, type, args)` (src/sim/god.js) returns `{ ok, reason, preview, type, needsConfirm? }`.
  - `preview` always has `{ type, cost, favour, sandbox }`, plus the power's own fields. Show `effect` and
    `warnings`.
  - For a destructive power, `preview.destructive` is true, its last warning is "This cannot be undone.", and
    without `confirm: true` the result is `ok: false, needsConfirm: true`, with the full preview.
  - The UI shows the warnings first. Confirm sends the same args plus `confirm: true`.
- **Issue:** `issueCommand(g, type, args)` returns the preview result plus `{ id, tick }`. The command applies at
  the next tick and is recorded in `s.god.log` as `{ id, tick, type, args, result }`; `result.msg` holds the text.
- **Other god.js reads:** `godSummary(g)` returns `{ available, sandbox, favour, max, perDay, waiting, spawned }`.
  `powerTypes()` lists the registered powers.
- **Cost:** favour comes from `mods/core/content/god.json` `costs`. Every power is free in Sandbox.
- **Registration:** the powers register when `game.js` imports their modules. The UI imports nothing extra.

| type | args | cost | destructive | preview fields (besides effect, warnings) |
|---|---|---|---|---|
| `lightning` | x, y | 15 | yes | x, y, killed, burned, fire |
| `fire` | x, y | 25 | yes | x, y |
| `smite` | colonistId | 20 | yes | colonistId |
| `meteor` | x, y | 60 | yes | x, y, killed, wounded, parts, tiles |
| `quake` | x, y | 70 | yes | x, y, parts, likely, people |
| `tornado` | x, y, dir? (0 = east … 7, clockwise) | 50 | yes | x, y, dir, **path** ([x, y] per step), people |
| `rain` | x, y | 20 | no | x, y, r, days, fires (tiles put out) |
| `drought` | x, y | 35 | yes | x, y, r, days |
| `plague` | settlementId | 50 | yes | settlementId, ill, people |
| `animals` | x, y, species, count, mode `'herd'`\|`'join'` | species `godCost` × count (deer 2, wolf 4, wild horse 3) | wolves within 30 tiles of a village | x, y, species, count, mode, near |
| `peaceful` | on (bool) | 0 | no | on |
| `monster` | x, y, species | species `godCost` (40/50/60) | within 40 tiles of a village | x, y, species |
| `banish` | x, y | 30 | no | x, y, monster (id) |
| `shape` | brush, r (1–8), and x, y **or** points [[x, y], … ≤ 16] | 0.2 × tiles changed (rounded to 0.1) | within 40 tiles of a village | brush, tiles, kept { reason: n } |
| `trait` | colonistId, trait, mode `'give'`\|`'remove'` | 15 | no | colonistId, trait, mode, replaced, traits (after), about |
| `law` | law, value | 0 | no | law, value, from |
| `spawn` (Phase 2c; cloud added `people`) | x, y, count, mode `'found'`\|`'join'`, profile?, name?, **people?** | 4 a settler | no | found: `village { name, profile, color, detail, people }`; join: `target`; both: people, supplies, costPer |

- **Animal counts:** a new herd takes 2 up to the species' maximum herd size; joining takes 1 up to it. Joining
  needs a herd of the species within 12 tiles.
- **Brushes:** raise, lower, water, mountain, flatten, desert, snow, marsh, forest, stone, ore.
- **Species and value ids:**
  - animals: `core:deer`, `core:wolf`, `core:wild_horse` (`animalSpecies(g)`, animals.js);
  - monsters: `core:thornback`, `core:gloomstalker`, `core:barkmaw` (`monsterSpecies(g)`, monsters.js);
  - traits and peoples: section 5; world-law values: `g.reg.get('worldLaw', id).values`.
- **Refusals:** read `reason` and show it as given. Examples: "Reedkin will not settle among the …", "it is raining
  there", "nothing here would change with that brush".

### 3b. Direct calls (not god commands)
These change the state at once, the same way the existing policy and attack orders do.

| Call | File | Returns | Use |
|---|---|---|---|
| `setCivLaw(g, sid, lawId, option, why = '', opts)` | civlaws.js | `{ ok, message }` | the player's village Laws tab |
| `civLawProblem(g, sid, lawId, option)` | civlaws.js | reason string or `null` | grey an option out; the reason is the tooltip |
| `evaluateAttack(g, sid, target)` | combat.js | `{ valid, problems[], lines[], risks[], declares, ours, theirs }` | attack dialog; now also refuses under the Peace law and for fallen villages |
| `orderAttack(g, sid, target)` | combat.js | `{ ok, message }` | after the dialog |
| `evaluateOffer(g, ai, offer)` | villages.js | `{ valid, accept, problems[], lines[], verdict, … }` | trade window; new lines "Greedy folk there: they ask N% more." and problems "Closed borders: …" |
| `canFound(g, sid)` | founding.js | `{ ok, problems, reason }` | Settlers block ("settlers wait for warmer weather") |

## 4. What the UI reads and shows, per phase
Each entry gives the field or function, its file, and where ui-todo puts it.

**Log (all phases):** `g.s.log` entries are `{ t, msg, cat }`. `cat` is `info|good|warn|death`, and it holds the
last 500 lines. There is no settlement field on an entry; see section 6.

### Phase 5: death, illness, war, ruins
- **Death:**
  - `s.dead[id]` holds `{ name, settlementId, cause, text, tick, x, y, injury?, people, traits, buried?, graveId? }`;
  - `s.stats.deaths` counts deaths by cause;
  - `colonist.health.zeroSince` marks a person bleeding out: they die at `zeroSince + HEALTH.deathAfterHours × 100`
    (health.js).
- **Burial:**
  - `s.bodies[id]` has `x, y, carriedBy`;
  - graves: `structure.grave` on `core:grave` (leave it out of build menus);
  - `colonist.grief { for, until, work }`.
- **Cold and age:**
  - injury kind `hypothermia`;
  - `ageYears(g, c)` and `elderFactor(g, c)` (life.js);
  - `scenario.life.aging.elderAge`.
- **Illness:**
  - an injury of kind `sickness` with `cause`, `until`, `treated`;
  - `sicknessOf(c)` and `contagious(g, c)` (illness.js);
  - `colonist.immune { illnessId: tick }`;
  - `s.stats.illness`.
- **Lasting injuries:**
  - `colonist.lasting`, with names and work in `LASTING` (medical.js);
  - injury `deep` and `mended`.
- **War and ruins:**
  - relation fields `touch`, `threat`, `aggressor`, `warSince`, `beaten`;
  - `trade.tribute`;
  - `settlement.fallen` (`{ … released }`), checked with `isFallen(g, sid)` (fallen.js).

### Phase 5b: destructive powers
- **Map:**
  - `s.disasters.fires` (tile → tick), `scorched`, `storms` (x, y, d), `weather` (kind, x, y, r, until), `plague { until }`, `seeds`;
  - `node.young` and `node.regrow` (0..1) for saplings.
- **Plague:** `plagueActive(g)` (illness.js).
- **Firefighting:** shows in the job and status text already.
- **Craters:** terrain `core:crater` (redraw on `g.terrainDrawRev`, see section 2).

### Phase 8: animals
- **Herds:** `s.animals.herds[id]` holds `{ sp, x, y, n, near?, alarm?, raids?: { sid: untilTick }, origin?: 'divine', sent? }`.
- **Animals near a village:** `s.animals.list[id]` holds `{ x, y, hp, herd }`.
- **Species data:** `g.reg.get('animal', sp)`, with `name`, `plural`, `color`, `herd`, `winterTerrains`, `droughtLoss`.
- **Food panel:** `g.plans[sid].huntNote` (planner.js). Carcasses carry the tag `core:carcass`; the butcher's table
  is `core:butcher_table`.
- **Spoilage:** `spoilPerDay` on items.
- **Wildlife panel:**
  - `s.animals.ledger[sp] = { start, born, sent, died: { cause: n } }`;
  - `animalCensus(g)` and `herdCensus(g)` (animals.js).
- **Peaceful animals:** `s.animals.peaceful` (true when on).

### Phase 8c: monsters
- **Lairs:** `s.monsters.lairs[id]` holds `{ id, sp, x, y, monster, since?, cleared? }`.
- **Monsters:** `s.monsters.list[id]` holds `{ id, sp, x, y, hp, lair, day, near?, foray?: { until, … } }`.
- **Village card:**
  - `g.plans[sid].monsterNote`;
  - "Too small for monsters": `standing(g, people) <= 3` (monsters.js).
- **Census:** `monsterSummary(g)` and `monsterCensus(g)` (monsters.js).

### World shaping
- **Blank world scenarios:** `core:blank_generated` and `core:blank_ocean` (mods/core/content/shaping.json).
- **No village yet:** while `s.playerSettlement === null`, the village panels show the "No village yet" state.
- **Spawn tool season hint:** `seasonOf(g)`, `outdoorTemp(g, tick)`, `coldestAhead(g, days)` and `tempAt(g, x, y)`
  (heat.js). These give the season and the low temperature to come.

### Peoples and traits
- **Colonist:** `c.people`, `c.traits` (≤ 2, `MAX_TRAITS`), and `c.look` (with `height` and `build`, appearance.js).
- **Settlement and the dead:** `settlement.people`, `dead.people` and `dead.traits`.
- **Names and abouts:** `g.reg.get('people', id).name/plural/about` and `g.reg.get('trait', id).name/about`.
- **Effects:** `modsOf(g, c)` (peoples.js) returns combined `{ work, workBy, walk, learn, tend, needs, illnessChance,
  illnessStrength, heal, cold, fightHp, wolfHp, flee, party, trade, mood }`. It does not say where each value comes
  from (section 6).
- **Counts:** `countByPeople(g)` (peoples.js) and `peopleCensus(g).byPeople` (godspawn.js).
- **Home templates:** `core:reed_house`, `core:roundhouse`, `core:courtyard_house`.

### World laws
- `activeLaws(g)` returns `[{ id, name, value, valueName, since }]`. Use it for the top-bar badges.
- `lawOf(g, id)` gives the current value of one law, for the highlighted row.
- `lawIs(g, id, value)` is a yes/no check, e.g. `lawIs(g, 'core:ageless', 'on')`.
- `lawSince(g, id)` gives the tick a law took its value; `growthOf(g)` returns 2 under Fast growth (worldlaws.js).
- `s.worldLaws { set, since }` holds every law away from its default. Peaceful animals is kept in
  `s.animals.peaceful` instead.

### Civilization laws
- **Laws tab:**
  - `civLawOf(g, sid, id)` gives the current option;
  - `codeOf(g, sid)` returns `[{ id, name, option, optionName, since, byKingdom }]` for laws away from their
    default only;
  - `lawHolder(g, sid, id)` gives the village whose code holds the law (its capital for a kingdom law);
  - `optionMood(g, id, option)` gives the face to show;
  - `CHANGE_DAYS = 5` is the wait between changes.
- **Effect helpers:**
  - `treeProtected(g, sid, node)` (tree marker);
  - `huntAllowed(g, sid, foodDays)`;
  - `bordersClosed(g, a, b)`;
  - `justiceOf(g, sid)` (2, 1 or 0.5);
  - `hoursOf(g, sid)`.
- **Text already in the sim:**
  - the idle reason "Curfew: no outdoor work at night." (ai.js);
  - the hunt note for a ban (planner.js);
  - tithe trades with reason "Tithe to X" (tithe.js);
  - the log "X passed a law: …".

### Mood
- **Colonist:** `explainColonist(g, c).mood` (explain.js) returns `{ value, level, target, thoughts: [{ id, name, value }] }`.
- **mood.js helpers:**
  - `moodOf(g, c)` (`c.mood ?? 0`);
  - `moodLevel(m)`, which returns `content|fine|unhappy|miserable` at the thresholds 20 / −20 / −50;
  - `thoughtsOf(g, c)` and `moodTarget(g, c)`;
  - `moodWork(m)` (×0.85–1.05);
  - `onBreak(g, c)`.
- **Colonist fields:** `c.mood`, `c.ate { t, m, f }`, `c.rough`, `c.breakUntil`. A person on a break has the status
  "Miserable: sulking".
- **Village:**
  - `g.plans[sid].moodNote`;
  - `settlement.unrest` (the tick unrest began);
  - `unrestOf(g, sid)` returns `{ unhappy, adults, on }` (unrest.js);
  - `UNREST.days = 5`.
- **Log lines:**
  - "Unrest in X: …";
  - "X's family (n) left A for B, miserable.";
  - "X is miserable and stops work for a while."

## 5. Content types added (src/sim/content/types.js)
| Type | Phase | Data file (mods/core/content) | Ids |
|---|---|---|---|
| `illness` | 5 | illness.json | core:cough, core:fever, core:grey_fever, core:plague (`plague: true`) |
| `animal` | 8 | animals.json | core:deer, core:wolf, core:wild_horse |
| `monster` | 8c | monsters.json | core:thornback, core:gloomstalker, core:barkmaw |
| `people` | Peoples | peoples.json | core:hearthfolk (default), core:reedkin, core:cragborn, core:duneshade |
| `trait` | Peoples / Mood | peoples.json | brave, timid, hardy, sickly, wise, diligent, lazy, greedy, quick, strong, kind, cheerful, gloomy (all `core:`) |
| `worldLaw` | World laws | laws.json | peace, ageless, fast_growth, plague (normal/none/endless), peaceful_animals, tame_monsters, no_fire_spread, season (normal/summer/winter) |
| `civLaw` | Civ laws | civlaws.json | work_hours, rationing, schooling, conscription, hunting, forests, borders, tithe, justice |
| `thought` | Mood | mood.json | 20 thoughts (hungry … crowded) |

- **godRules (god.json):** costs for the new powers; `wrath` numbers.
- **New items:**
  - venison, horse meat and hide, plus the carcasses (animals.json);
  - thornback and gloomstalker carcasses, the gloom eye and heartwood (monsters.json).
- **New buildings:**
  - `core:butcher_table` (animals.json);
  - `core:grave` (Phase 5);
  - the three home templates (peoples.json).
- **New terrain:**
  - `core:crater` (meteor);
  - the ore-bearing rock node from the ore brush (shaping.json).

## 6. Mismatches found (ui-todo vs code)
1. **Mood on load:** constants.js says format 33 "absent means computed on load". In fact `loadGame` leaves
   `c.mood` unset, and the first hourly `tickMood` pass sets it to the target. Until then `moodOf` gives 0. The
   UI may show 0 for up to an in-game hour after loading an old save.
2. **Format 33's save comment:** `SAVE_FORMAT`'s comment does not list `colonist.breakUntil` or
   `settlement.unrest`, but both are saved and validated (save.js).
3. **Trait effect lines** ("Mining ×1.27 (Cragborn, Strong)", Peoples slice 2): `modsOf` returns only the combined
   numbers, with no sources. The UI must work the sources out itself, from `people.work/needs/walk/cold` and
   `trait.effects`.
4. **Unrest reasons** (Mood slice 3, "the reasons from the log line"):
   - the reasons exist only inside the log text;
   - `settlement.unrest` is just a tick;
   - the function that finds the reasons (`reasons` in unrest.js) is not exported.
5. **"Leaving families appear in both villages' logs":** there is one world log with no village field. The move is
   a single line, marked `warn` when either village is the player's.
6. **"Work line ×0.9 (mood)":** no function returns a breakdown of work speed. Use `moodWork(c.mood)`.
7. **Text the sim does not produce:** the UI must build these from the helpers named in section 4.
   - "(ageless)", "×2 (Fast growth law)", "Winter (endless)" and "No illness (Plague law: none)":
     build them from `lawIs`/`lawOf`.
   - "At school (compulsory schooling)" and "Working (child labour)": the sim's status is
     "At school with X (N%)".
   - "harsh justice: twice the attention": build it from `justiceOf`.
   - "Unrest for N days": build it from `settlement.unrest`.
   - "Too small for monsters": build it from `standing`.
8. **Kingdom laws "set by X":** `codeOf(...).byKingdom` is set only for laws away from their default. For every
   row, use `lawHolder(g, sid, id) !== sid`.
9. **`since day N`:** `codeOf().since` and `lawSince` are ticks, not days. Divide by 2400.
10. **Herd raids** (Phase 8 slice 4): ui-todo writes `raids[village]`. The real field is `herd.raids[sid]`, a tick,
    and a raid is active while it is greater than `s.tick`.

## 7. Open integration questions for the owner
1. `setCivLaw` and `orderAttack` change the state directly instead of going through the god-command queue, so they
   are not in `s.god.log`. Does the home UI's replay or command recording need to capture them? Policies and attack
   orders already work this way.
2. Should the log get an optional village field (e.g. `{ t, msg, cat, sid }`)? It would serve per-village letters,
   the family-move line and unrest reasons. It would change the log format; the save format would not change.
3. Should `explainColonist` return the trait/people sources and the mood work factor? That would close
   mismatches 3 and 6 in the sim instead of in the UI.
4. Does the home UI already scale sprites by `look.height` and `look.build`? The Cragborn and Reedkin depend on it.
