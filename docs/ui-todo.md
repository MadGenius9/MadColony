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

