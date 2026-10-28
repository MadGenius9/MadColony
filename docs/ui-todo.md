# UI to-do (from cloud work)

The cloud copy has no `src/ui`. Every feature the player must see gets an entry here: what the UI must show,
where, and which sim function or state field provides it. The UI is built at home from this list.

## Phase 5, slice 1a: death
- **Death letter (important):** for each new log entry with category `death` (`g.s.log`, `cat: 'death'`): the text
  as written ("Ana of Pinecroft died of their wounds (struck by an arrow)."). Click: jump to the place
  (`g.s.dead[id].x/y`). Important for the player's village, routine for others.
- **The dead in the Colony tab:** a "Died" list for the player's village from `g.s.dead` (entries with
  `settlementId === playerSettlement`): name, day (`tick / 2400`), `text`, `injury`. Counts by cause from
  `g.s.stats.deaths`.
- **Village summary / World tab:** deaths so far (count `g.s.dead` by `settlementId`).
- **Inspector and hover card:** a colonist at 0% health shows "Bleeding out: dies in N h without care"
  from `c.health.zeroSince` (dies at `zeroSince + HEALTH.deathAfterHours × 100` ticks); once cared for
  (tended, medical bed, dressed or cleaned wound) "Cared for".
- **Portrait bar:** a dead colonist disappears (they leave `g.s.colonists`); a letter explains why.
- **Sound:** the death cue (was planned for Phase 5 in Phase 1b) on a `death` log entry of the player's village.
- **Empty villages:** a village with no people left keeps its card; show "Nobody lives here any more".

## Phase 5, slice 1b: burial and mourning
- **Bodies on the map:** each `g.s.bodies[id]` at `x, y` (a lying figure in the village colour); when
  `carriedBy` is set, draw it on the carrier. Hover: "The body of <name> (`g.s.dead[cid].name`), died day N".
- **Graves:** buildings with `def === 'core:grave'` (`render.shape: 'grave'`, a new shape: a small mound with a
  marker stone). Hover / inspector: "Grave of <name>, buried day N" from `structure.grave`.
- **Burial job:** the colonist card shows the job label ("Bury Ana") and status action ("Carrying Ana to the
  graveyard", "Burying Ana"), already in `c.job.label` / `c.status.action`.
- **Grief:** hover card and inspector line "Grieving for <name> (until day N): work 85%" from `c.grief`
  (`for`, `until`, `work`). A small dark ribbon on the portrait while `grief.until > tick`.
- **Log/letters:** "X buried Y." and "Y was buried by the people of V." are routine (`cat: 'info'`).
- **Work grid:** no new column (burial is part of Care).

## Phase 5, slice 1b (review): Grave in build menus
- If any UI lists every building (a build or debug menu), leave out `core:grave`: graves are made only by burial.

## Phase 5, slice 2: cold and old age (Vast and Living worlds)
- **Hover card / inspector:** "Freezing" injury line (kind `hypothermia`, cause "Freezing"), like other conditions.
  A frost icon on the portrait while `hypothermia` grows.
- **Age:** "Elder, 57" when `ageYears(g, c) >= scenario.life.aging.elderAge` (life.js `ageYears`), and "works at
  80%" in the work line (`elderFactor`).
- **Founding:** the Colony tab's Settlers block shows the wait reason from `canFound(...).reason` ("settlers wait
  for warmer weather").
- **Death letters:** causes "froze to death" and "died of old age" come through the `death` log category as before.

## Phase 5, slice 3: contagious illness (Vast and Living worlds)
- **Hover card / inspector:** the illness as an injury line: name (`inj.cause`, e.g. "Grey fever"), severity,
  "ill until day N" from `inj.until`, "treated" when `inj.treated`; "Immune to X until day N" from `c.immune`.
- **Portrait bar:** a sickness dot while `sicknessOf(c)` (illness.js).
- **Letters:** "X broke out in V" (warn) is important when V is the player's village; "A fell ill with x (how)."
  routine, grouped. Click: the village / colonist.
- **Village card / World tab:** "Ill now: N (illness)" from the village's colonists; `g.s.stats.illness`
  (cases, outbreaks) in the World tab.
- **World view (optional):** a faint sickly tint on villages with contagious people, so spread along trade routes
  can be watched.

## Phase 5, slice 4: lasting injuries and surgery
- **Inspector / hover card:** "Lame leg (since day N, from <cause>)" lines from `c.lasting` (names in medical.js
  `LASTING`), and the work they slow (`LASTING[].work`).
- **Injury lines:** mark deep wounds ("deep: may leave a lasting injury unless operated on") from `inj.deep`;
  "operated on" when `inj.mended`.
- **Log:** "X operated on Y…" and "Y's wound healed badly: …" (good / warn).

## Phase 5, review of slices 2–3
- The treat job's reason ("infection") also covers illnesses: show the illness name (`inj.cause`) for kind
  `sickness`.

## Phase 5, slice 5a: rivalry and wars (Vast world)
- **Threat letter (important):** log line "X threatens war on <your village> (…). Improve relations or make peace
  within N day(s)." (warn). Click: Diplomacy on X; show `relation.threat` and the line −40 to lift it.
- **Declarations:** "X declared war on Y: <cause>, and X is stronger (a against b)." (warn) as a world-event card
  zoomed out; important when Y or X is the player's village or ally.
- **Diplomacy / village card:** "Rival: their lands press on each other" or "they compete for the same land"
  for pairs with `relation.touch` or within `scenario.war.rivalry.near`; temperament from the profile.
- **World view:** wars between villages (pairs with `relation.aggressor` and hostile) as crossed swords between
  their labels, kingdom wars in the kingdom colours.

## Phase 5, slice 5b: battles and peace (Vast world)
- **World view:** "Fighting between A and B: n wounded in A, m in B." (warn, one a day per pair) as a small
  battle marker between the two villages for that day.
- **Peace:** "X sued Y for peace (why); the war is over." as a world-event card; the war marker goes.
- **Diplomacy:** war age from `relation.warSince` ("at war for N days").

## Phase 5, slice 6a: ruins
- **World view and map:** buildings of a village with `settlement.fallen` drawn greyed and broken (ruins); no
  label colour or flag, a "Ruins of <name>" label instead; territory drawn faded until `fallen.released`, then
  none.
- **Letters:** "<name> has fallen: <cause>. Its ruins remain." (warn) as a world-event card (important when it was
  an ally or a kingdom member of the player); "<name> is now the capital of <kingdom> (…)".
- **Village card / World tab:** "Fallen on day N: <cause>" from `fallen`; ruins sorted last or filtered out.
- **God tab:** bless/inspire/join on a ruin show the refusal ("has fallen; only ruins are left").

## Phase 5, slice 6b: conquest
- **Letters / world events:** "<winner> has conquered <village>: it is now part of its kingdom." and
  "<winner> has sacked <village>: …" (warn); important when the player's village, ally or kingdom is involved.
- **Diplomacy:** while `relation.beaten` is set, "<village> has no fighters left (since day N): beaten in M days".
- **Trades:** a tribute trade (`trade.tribute`) shown as "Tribute to <winner>".
- **Kingdom card:** conquered members ("conquered by X" in their relation history with the capital).

## Phase 5b, slice 1: confirm, lightning, smite
- **Preview card for destructive powers:** when `previewCommand` returns `needsConfirm`, show `preview.warnings`
  first (people killed or burned with their village, "your village" first; buildings and goods that burn; "This
  cannot be undone.") and a Confirm button that issues the same command with `confirm: true`.
- **Lightning:** target a tile; a white flash and a scorch mark. **Smite:** target a person (hover card button in
  god mode).
- **Damaged homes:** a home with `complete === false` after it was finished shows "Damaged: being rebuilt" and the
  missing part as a building site.

## Phase 5b, slice 2: fire
- **Map:** burning tiles (`g.s.disasters.fires`: tile index → tick) drawn as flames with smoke (the world view: an
  orange glow); scorched tiles (`g.s.disasters.scorched`) drawn as ash on the ground until they fade (30 days).
- **Fire power:** target a tile; the preview shows the warnings (people in danger, flammable buildings by village).
- **Colonists:** "Running from the fire" (flee job); burns in the injury list (kind `burn`).
- **Letters:** "A fire broke out at …" (god log), "The fire has burned out."; buildings that burned show up as
  "Damaged: being rebuilt" homes.
- **Sound:** crackling while fires burn on screen.


## Phase 5b, slice 4: meteor and earthquake
- **Meteor power:** target a tile; the preview draws the crater (radius 2) and the ring (3 more tiles) and lists
  the warnings (killed, wounded, building parts destroyed by village, crops/trees/goods, "the ground becomes a
  crater"). On impact: a streak of light from the sky, a flash, dust, then fires round the rim.
- **Crater terrain** (`core:crater`, render style `gravel`, colour #5a5048): drawn darker with a raised rim; its
  tooltip says "Crater: nothing can be built here".
- **Redraw:** craters change terrain without bumping `s.map.rev` (so whole-map sim caches are kept); the
  terrain layer must also redraw when `g.terrainDrawRev` (derived, never saved) changes.
- **Meteoric iron:** the stack left in the crater (core:iron) can be shown with a faint glow for a day.
- **Earthquake power:** target a tile; the preview shows the radius (12) and "about N building parts will fall";
  on impact the screen shakes for a moment and collapsed parts show as rubble then building sites ("Damaged:
  being rebuilt").
- **Homes lost to a meteor:** their people show "Homeless" until a new home is built; the letter "A falling star
  struck …" names the dead ("was crushed by a falling star").

## Phase 5b, slice 5: tornado
- **Tornado power:** target a tile and pick a direction (8 arrows, or "let the wind decide"); the preview draws
  the exact path it will take (`preview.path`, a list of [x, y], one per step; 3 tiles wide) and lists the
  warnings (people in its path now, wooden building parts that may be torn down by village, trees torn up).
- **Map:** each storm in `g.s.disasters.storms` (x, y, heading d: 0 = east, clockwise) drawn as a turning funnel
  with debris; trees vanish and wood lands downwind; thrown goods fly a few tiles.
- **Colonists:** "Hurt by the tornado" in the injury list.
- **Letters:** "A tornado touched down at …", "The tornado has died away (N hurt)."; torn-down parts show as
  "Damaged: being rebuilt" homes.
- **Sound:** wind roar while a storm is on screen.

## Phase 5b, slice 6a: rain and drought
- **Rain power** (not destructive): target a tile; the preview draws the area (radius 10) and says how many
  burning tiles it puts out. **Drought power** (destructive, confirm): radius 12, warnings list the growing crops
  by village.
- **Map:** weather areas (`g.s.disasters.weather`: kind, x, y, r, until) drawn as falling rain / a heat haze over
  the area, with a soft edge; the world view draws them as a cloud or a dry patch.
- **Fields:** crops in a drought look dry and shrink as they wither; tooltip "Withering in the drought".
- **Letters:** "Rain began to fall …", "The rain has stopped.", "A drought began …", "N crops withered in the
  drought.", "The drought is over."
- **Sound:** rain on the roofs while a rain area is on screen.
- **Drought fields:** sowing waits while a field lies in a drought; the field's tooltip and the farmers' status
  say "Waiting out the drought". The fire power is refused in rain ("it is raining there").

## Phase 5b, slice 6b: plague
- **Plague power** (destructive, confirm): target a village (village card button in god mode, or click a person to
  pick their village); the preview names who falls ill first and says it spreads and kills many of the untended.
- **Colonists:** "Plague" in the injury list (an illness like the others); the sick can be shown pale.
- **Village card:** "Plague: N ill" while `g.s.disasters.plague` lasts.
- **Letters:** "Plague struck <village>: N fell ill.", then the usual "fell ill with plague (caught it from …)".

## Phase 5b, slice 6c: firefighting
- **Colonists:** job "Fight the fire": status "Running to the fire", "Beating out the fire" or "Throwing water on
  the fire" (water within 15 tiles); draw them with a bucket or a beater beside the flames.
- **Map:** a tile put out turns to ash at once (scorched) with a puff of steam.
- **Letters:** "<name> put out a fire." (at most one every few hours per village).
- **Settings (later):** the player may want a "let it burn" order per village; not in the sim yet.

## Phase 5b, slice 6d: regrowth
- **Map:** young plants (`node.young`, `empty`) drawn as saplings (small, light green) that grow to full size as
  `node.regrow` goes from 0 to 1; seeds waiting in `g.s.disasters.seeds` need no drawing (perhaps a faint green
  tint on scorched ground once its seed is due).
- **Tooltips:** "Young pine: grows up in about N days" (sproutDays × (1 − regrow), slower in winter); it cannot
  be cut yet.
- **Letters:** "N young plants sprouted on burned and broken ground." (at most one a day).

## Phase 8, slice 1: species and far herds
- **World view:** each herd in `g.s.animals.herds` (sp, x, y, n) drawn as a dot (or a small cluster of dots) in
  its species' colour (`animal.color`: deer brown, wolves grey, wild horses chestnut), its size by `n`;
  tooltip "Deer: a herd of 8".
- **Map legend:** the three species; wolves marked as dangerous.
- **Close up:** nothing yet (individual animals come in slice 2).

## Phase 8, slice 2: near animals
- **Close up:** each animal in `g.s.animals.list` (x, y, hp; its herd's species from `herds[a.herd].sp`) drawn as a
  procedural sprite (deer: slim, light belly, antlers on some; wolf: grey, long tail; horse: chestnut, mane),
  walking between tiles (they step one tile at a time, two when fleeing); a herd whose `alarm` is ahead of the
  tick is running (tails up, faster animation); a wounded animal (hp below its species' health) limps.
- **Wolves hunting:** a pack chasing a deer, a bite flash, the deer falling (it disappears; carcasses come with
  hunting in slice 3).
- **Hover card:** "Deer (herd of 8): grazing / running from Ada / running from wolves"; "Wolf (pack of 4):
  hunting / resting".

## Phase 8, slice 3: hunting, butchering, spoilage
- **Colonists:** job "Hunt deer" (status "Hunting deer"): the hunter walking after the herd with a spear or bow,
  the throw or shot, a hit (the animal limps) or a miss (the herd bolts); "<name> killed a deer." in the log.
- **Carcasses** (`core:deer_carcass` etc., tag `core:carcass`): drawn as the animal lying on its side; hauled one
  at a time; the **butcher's table** (`core:butcher_table`, shape table) with a carcass on it while the cook works
  ("Butcher a deer"); venison, horse meat (red cuts) and hides (folded skins) as goods.
- **Spoilage:** goods with `spoilPerDay` show a freshness hint in the stockpile tooltip ("spoils: about 10% a
  day; eat or cook it soon"); the log says "N Venison spoiled." at most once a day.
- **Village food panel:** the plan's `huntNote` ("Hunting deer (a herd of 8, 30 tiles away)", "Enough meat for
  now", "No herd near enough to hunt") beside the food note; a "Food from hunting" share from the ledger
  (`created:hunt` carcasses butchered into meat).
- **Work tab:** the new work type Hunting (skill Hunting) can be turned off per colonist like any work.

## Phase 8, slice 4: wolves and people
- **Wolves attacking:** a pack running at a person, bites (a red flash), the victim's injury list "Bitten by a
  wolf" (kind `bite`; can become infected; bandaged like wounds); a letter "Wolves attacked Ada!" (warn) and,
  if they die, "Ada was killed by wolves.".
- **People:** "Running from the wolves" (flee) or "Fending off a wolf" (job `fend`, spear or bow out); a pack
  that met an armed group running off; hunters going after a pack that attacked the village ("Hunt down the
  wolves", herd `raids[village]` until a tick).
- **Map warning:** a near pack (`herds[…].sp` wolf, `near` set) within 30 tiles of the village could show a
  small wolf icon at the village edge; the village card: "Wolves near: stay in groups, carry spears".

## Phase 8, slice 5: distant villages
- **World view:** a distant village's hunters are not drawn (they are simulated in aggregate); its stockpile shows
  carcasses and venison like any village; the village card's food line can read "Hunting deer (a herd of 7, 17
  tiles away)" (`plans[sid].huntNote`).
- **Letters:** "Wolves attacked <name> near <village>." (info) for distant villages.
- **Raid note:** for a pack that attacked the village the card reads "Hunting down the wolves that attacked the
  village (12 tiles away)".

## Phase 8, slice 6: seasons
- **Zoomed out:** herd dots drift with the seasons: in winter deer gather in forest and taiga and horses on open
  grass and savanna (`animal.winterTerrains`), and they spread out again in spring. No extra drawing is needed;
  a herd's tooltip could add "Wintering in the forest" in winter.
- **Drought:** deer and horse dots move away from a drought area and thin out (`animal.droughtLoss` a day). The
  drought power's preview could add "Grazing herds will thin and move away".
- **Encyclopedia or species card:** per species: herd size, where it lives and where it winters, what it eats,
  births in spring, losses in winter (three times as many on poor winter ground) and in droughts.

## Phase 8b, slice 0: the animal ledger
- **Reports (optional):** a "Wildlife" panel can show per species: living now, born, sent by the gods, and deaths by
  cause (winter, drought, starved, eaten by wolves, hunted, lost, crowded, faded) from `s.animals.ledger`.

## Phase 8b, slice 1: the animals power
- **God powers panel:** a new power "Send animals":
  - choose a species (deer, wolf, wild horse: `animalSpecies`), a count (2 to the herd maximum; 1 and up when
    joining) and the mode "New herd" or "Join a herd";
  - then click a tile.
- **Preview** (`previewCommand(g, 'animals', args).preview`):
  - show `effect` ("6 deer appear at (x, y) as a new herd" or "2 deer join the herd of 9 nearby (11)") and the cost
    in favour (deer 2, horse 3, wolf 4 a head);
  - then the warnings: not their ground, how many the land feeds, and for wolves the villages they will hunt near.
  - Wolves near a village need the Confirm step (`needsConfirm`), like the other destructive powers.
- **Letter:** "The gods sent 6 deer near your village." (info).
- **Herd tooltip:** a herd with `origin: 'divine'` can read "Sent by the gods (day N)".

## Phase 8b, slice 2: animals obey the land
- **Herd tooltip:** a herd off its ground can read "Lost: looking for grassland", and a crowded one "Too many
  here: moving on". Deaths show in the wildlife panel as "lost" and "crowded" (`s.animals.ledger`).

## Phase 8b, slice 3: peaceful animals
- **God powers panel:** a toggle "Peaceful animals" (`issueCommand(g, 'peaceful', { on })`, free, no confirm). Its
  preview text is `preview.effect`.
- **Status line:** while `s.animals.peaceful` is on, show a small dove or calm-paw icon: "Animals leave people
  alone".
- **Letters:** "The gods calmed the wild: animals leave people alone." and "The wild is wild again: beware of
  wolves."

## Phase 8c, slice 1: monster lairs
- **Map:** lairs (`s.monsters.lairs`) as small landmarks: a thorn den, a cave mouth, a ring of fallen trunks.
  A cleared lair is shown as cleared, an empty one as empty.
- **Monsters far away:** a monster (`s.monsters.list`) can be drawn zoomed out as a single dark mark near its lair.
- **Encyclopedia:** each species' `about` text, where it lives and what it leaves when slain.
- **Letters:** "A new Thornback has come to an old lair." (info).

## Phase 8c, slice 2: monsters near villages
- **Close up:** draw near monsters (`s.monsters.list`, `near` set) as single large figures:
  - a Thornback: a thorn-backed boar;
  - a Gloomstalker: long-limbed and dark, shown only at night;
  - a Barkmaw: a walking dead tree.
- **Letters** (warn for the player's village):
  - "A Thornback trampled crops in the fields!"
  - "A Gloomstalker attacked Ada!"
  - "A Barkmaw tore down log wall in First Hearth!"
  - "The Barkmaw burned to death."
- **Deaths:** "was gored by a Thornback", "was taken by a Gloomstalker", "was crushed by a Barkmaw".
- **Wounds:** gore, maul and crush are wounds (bandaged like bites).
- **Village card:** a village of 3 or fewer people could say "Too small for monsters to bother" (the owner's
  rule: monsters never wipe a village out).

## Phase 8c, slice 3: people fight back
- **People:**
  - "Run from the Barkmaw" (flee);
  - "Hunt the Thornback" (job `slay`), with the action "Waiting for the hunt party (2 of 3)" or "Fighting the
    Thornback";
  - "Clear the Barkmaw's lair" (job `clearlair`).
- **Village card:** `plans[sid].monsterNote` ("A Thornback threatens the village: arming 3 fighters to hunt it").
- **Letters:**
  - "Ada and the hunt party slew the Thornback!" (good);
  - "Ada cleared the Thornback's lair: nothing will live there again." (good).
- **Items:** Thornback and Gloomstalker carcasses are butchered at the butcher's table (venison and hides; hides
  and a gloom eye). A slain Barkmaw leaves 30 wood and a piece of heartwood.

## Phase 8c, slice 4: distant villages and the monster powers
- **Letters** (info) for distant villages:
  - "A Thornback trampled a field of Pinecroft."
  - "A Gloomstalker attacked Ada of Pinecroft in the night."
  - "A Barkmaw tore down log wall in Pinecroft."
  - "The people of Pinecroft slew the Barkmaw that troubled them."
- **God powers panel:**
  - "Send a monster": choose a species, then click a tile. Near a village it needs Confirm; the warnings name the
    villages.
  - "Banish": click near a monster; it removes the nearest one within 20 tiles (favour 30).
  - Both show the cost, the preview `effect` and the `warnings`.
- **Letters:** "The gods sent a Barkmaw near your village." and "The gods banished the Thornback."

## Phase 8c: forays
- **Letters:** "A Thornback was seen near Pinecroft." (warn for the player's village, info for others), when a
  monster sets out for a village (it stays near it for 2 days, `monster.foray`).
- **Map:** a monster on a foray can be marked near the village it is visiting.

## World shaping, slice 1: terrain brushes
- **God powers panel:** a "Shape the land" tool:
  - pick a brush: raise, lower, water, mountain, flatten, desert, snow or marsh;
  - pick a size (radius 1–8);
  - click to paint one disc, or drag (up to 16 discs in one stroke: `points`).
- **Preview while hovering** (`previewCommand(g, 'shape', …)`):
  - the number of tiles that change and the cost (0.2 favour a tile; free in Sandbox);
  - "N tiles kept for buildings / fields and stockpiles / people / the way round villages";
  - near a village, Confirm.
- **Map:** the terrain redraws after a stroke (the map revision changes).
