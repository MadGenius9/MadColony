# MadColony

An original, moddable, **autonomous** colony and settlement simulation for the browser (2D, three-quarter top-down view).
You are an overseer. The settlers feed themselves, sleep, chop, mine, forage, farm, cook, haul, plan and build their own homes, workshops and fields, furnish and later renovate them, research technologies, and craft and equip tools, all without you placing anything. You set goals and priorities, then watch the settlement solve them. Around you, AI villages live by the same rules: they trade, sign pacts and alliances, go to war, and in the Living world they found new villages, form kingdoms and build markets with supply-and-demand prices.

All names, art (drawn procedurally on a canvas), interface and code are original. There are no external assets or libraries, and no paid AI calls: decisions use ordinary game AI.

**Planned work is listed separately in [docs/ROADMAP.md](docs/ROADMAP.md).** Anything not described below as implemented is not in the game.

## Run it

Requires Node.js 20 or newer. No `npm install` is needed (zero dependencies).

```bash
npm start
```

Then open http://localhost:8080. (Opening `index.html` directly from disk won't work: ES modules and mod files need to be served over HTTP.)

```bash
npm test
```

Runs the headless test suite (521 tests).

```bash
npm run sim -- 10 --log
```

Runs a colony headless for 10 days and prints a twice-daily report and the event log.

```bash
npm run pack-mod mods/example_herbalism
```

Bundles a mod folder into an importable `dist/*.modpack.json`.

| Control | |
|---|---|
| Left-click | select a colonist, tile or (zoomed out) a village |
| Drag / right-drag, WASD, arrows | pan |
| Mouse wheel | zoom |
| Space | pause |
| 0-4 | pause, or speed (1×, 3×, 9×, 30×) |
| N | mute or unmute sound |
| Q G R C P M L U | open or close a tab: Work, Goals, Research, Colony, Diplomacy, World, Log, Menu |
| Esc | close the open dialog, then the open tab, then clear the selection |
| Minimap | click or drag to move the camera |
| – / + on a panel | collapse or expand it |

## What is implemented

### Interface (Overseer style)
- The map fills the whole window. All UI floats over it as dark, translucent panels.
- **Top-left:** day, time, season and outdoor temperature, with pause and 1×/3×/9×/30× buttons.
- **Top-centre:** a portrait bar of your colonists, each with a small health bar and a warning dot when they have collapsed or a need (food, water, sleep) is urgent. Click a portrait to select that colonist and centre the camera. With more than 20 people the bar groups them by life stage, without names.
- **Top-right:** resource chips, and under them **letters**: event cards, newest first. There are two kinds:
  - **Important** cards (marked "!") stay until you click them or their cause is resolved. They are injuries, illness, dehydration, starvation, exhaustion, collapse, death, war, raids and proposals, but only when they concern your village (a raid only when your village is attacked). A card clears itself when the need is met, the colonist is back on their feet, the injury has healed, the war is over or the proposal is answered. It comes back if the colonist is cut off from water or food again, or collapses again, within a day.
  - **Routine** cards (trade, research, buildings finished, births and so on) fade after 8 seconds of real time. Hovering or keyboard focus pauses the timer; game speed and pause do not matter.
  - At most 4 cards show, important ones first; routine cards never push out an important one. Pushed-out routine notices stay in the Log, and "+N more" opens the Log. Repeats are grouped with a ×N badge. **Clear all** dismisses the routine cards.
  - Clicking a card jumps to the colonist, village or tile it is about and opens its panel (Diplomacy for a village); a card with no place opens the Log at that line. Proposals open Diplomacy and stay until answered.
  - **Menu → Routine notices:** 8 s, 15 s, keep until closed, or don't show (log only). Saved in this browser (`madcolony.letters.settings.v1`). Dismissals are kept per game in this browser only.
- **Bottom:** a tab bar with Work, Goals, Research, Colony, Diplomacy, World, Log and Menu. One tab panel is open at a time.
  - **Work:** a grid of colonists × work types; untick a box to forbid that work.
  - **Goals**, **Research**, **Colony** and **Log**: goals and presets, research and field priorities, colony statistics, and the event log (with a "warnings only" filter).
  - **Diplomacy:** neighbouring villages, relations, offers, pacts, alliances, rights and war orders.
  - **World:** every village with its people, relation and level of detail, and **Go there**. Click a row for its summary.
  - **Menu:** Save / Load, Mods, New colony, Help & keys; Roofs (Auto/On/Off, purely cosmetic), the ⚡ Power overlay and the Settlement area tool; Sound (master, music and effects sliders and Mute); and switches to show or hide each panel and the control hints.
- **Bottom-left:** the inspector card for the selected colonist, building, tile or village.
- **Bottom-right:** a minimap of the whole world with territories, buildings, village markers and the camera rectangle. Click or drag it to move the camera.
- Every panel can be collapsed; which panels are collapsed is remembered in this browser.

### Sound (Phase 1b)
- All sound is generated with the Web Audio API: no audio files and no libraries. It lives in `src/ui` and only reads the game, so simulation runs are exactly the same with or without it.
- Sound starts after your first click or key press (browsers require this). It is suspended while the tab is hidden.
- **Menu → Sound** has master, music and effects sliders and a Mute box. **N** mutes or unmutes. The settings are saved in this browser (`madcolony.sound.v1`).
- **Mixed by zoom.** Zoomed out you hear the world: ambience and event cues. Zoomed in you hear what is on screen: footsteps (a crunch on snow in winter), chopping, picks on stone, hammering, crafting, a cooking sizzle, rustling fields, crackling fires, and shots and hits. Wind and a cold whistle follow the season and temperature; birds sing in spring and summer days, crickets on spring and summer nights.
- **World cues:**
  - a war horn and drums when a relation involving your village turns hostile;
  - drums when an attack is ordered;
  - bells when a village is founded (today only at world creation), when research finishes, and when someone collapses;
  - plucked notes for trades and good news;
  - a two-tone warning for other warnings.
- **Music** is generated: a pentatonic tune per season, minor with a low drum while your village is at war, slower and softer at night.
- While paused, effects are silent and the music plays softer. At 9× and 30× cues of the same kind are merged, and footsteps and work sounds are thinned. The number of voices and how often each sound can repeat are capped.

### Simulation and autonomy
- Fixed timestep, seeded RNG stored in the save, and one JSON-serializable state. The same seed gives identical runs, including across save/load (tested). Simulation (`src/sim`) and presentation (`src/ui`) are separate.
- **Two planning layers.** The *settlement planner* (`planner.js`, per settlement) looks at shared needs: food reserves, meals, housing, farmland, stations, equipment, stockpile, research and renovation. It breaks them into dependencies (stock → in-flight production → recipes and stations → research → gatherable nodes → crops). *Colonists* (`ai/`) pick concrete jobs scored by urgency, priority, skill, tools and distance. Jobs are sticky, and urgent hunger or exhaustion interrupts them.
- **Autonomous construction:** template choice, site selection, clearing, hauling, a safe build order (door → furniture → walls), a no-trap check, bed ownership and later decor.
- **Real economy:** items come only from start, gather, harvest or craft, and leave only through construct, craft, research, eat, sow or wear. A ledger plus census proves conservation in tests. Workers carry everything. Items that can't be put down anywhere (completely full map) are **held**, counted and shown, never discarded, and placed once space frees.
- **Farming** sized from consumption, with a seed reserve that is never eaten, foraging while crops grow, and no endless overproduction.
- **Crafting and equipment:** recipes with stations, work time and skills; missing stations become projects; tools are reserved, fetched and equipped, wear out and get replaced; the best tool the settlement can actually make is chosen. Recipes larger than one colonist can carry are fetched in **several trips**, including from the same stack, with exact per-trip reservations.
- **Reliability:** reservations always equal what active jobs hold (checked in tests). Interrupted jobs release everything and drop carried items. Blocked routes are replanned. Unreachable targets fail with a reason and a colony-wide cooldown.

### Phase 1: research, eras and settlement foundations
- A **technology graph** in data (`tech`, `techField`, `era` content types): prerequisites, research effort, optional material cost, and explicit unlocks (recipes, buildings, templates). Load-time validation rejects circular prerequisites, technologies that unlock nothing, and prerequisites from a later era. Technologies only *unlock*; colonists still gather, craft and build everything.
- **Basic food, shelter, gathering and starter tools need no research.** The core tree (8 technologies) unlocks stone walls (masonry), batch cooking, hafted axes and pickaxes, a bow, cupboards, lanterns and a four-bed stone hall plan.
- Colonists **build a research desk themselves** (a normal low-priority project behind food and housing), fetch a technology's material cost once, then research in sessions. Progress is kept on the settlement, so interruptions never lose it, and materials are charged exactly once (tested). Research pauses with a stated reason when food is low or settlers are homeless; the maximum number of researchers is a policy setting.
- **Field priorities** (Agriculture, Construction, Industry, Utilities, Defense: Off/Low/Normal/High) steer the choice. Within a priority, colonists prefer a technology that **unblocks something the settlement is waiting for** (e.g. a goal needing a locked recipe), and switch to it, keeping earlier progress. Every choice comes with a visible reason.
- **Eras** advance only by milestones: research counts, buildings, population; never by time. The configured eras are Early settlement → Advanced workshops → Industrialization → Electrification → Modern infrastructure. Only the first two have technologies; later eras are placeholders for the roadmap and cannot be reached yet.
- **Settlement ownership:** colonists, item stacks, buildings, projects, fields, homes, jobs and research all carry a settlement id. Each settlement is planned separately, and workers never use another settlement's goods, stations, beds or land (tested with a second settlement next door). Only one settlement is created in normal play; AI neighbours are Phase 2.
- **Autonomous renovation:** once masonry is researched and food and housing are fine, the settlement slowly stockpiles stone, then rebuilds a home's log walls as stone walls **one part at a time**. Each part stays standing until its replacement is finished, so residents, beds, furniture, doors and shelter are preserved. Renovation is lowest priority and shows progress (colony panel, tile inspector, scaffolding on the map). Further tiers can be added in data via `building.upgrade`.
- Save **format 2** with migration from format 1: settlements, ownership and research are added to older saves on load, and the stored original is untouched.

### Controlled goods and village laws (engine)
- Goods tagged `core:controlled` (added by optional mods) fall under each village's **laws**: legal, restricted (small amounts, a premium, a little attention) or banned (only a black market buys them, at a much higher price). Laws are per village; what is legal in one place counts for nothing elsewhere.
- Selling where goods are restricted or banned raises that village's **watch attention** toward you — separate from relations, shown with its reasons, and fading by 3 a day. Banned deliveries may be **seized** (the deal is off and relations drop); at 40 attention you are **fined**, at 70 the village **closes all trade** with you for 10 days (and any pact ends). The offer dialog shows the law, price, attention change and seizure odds before you send anything.
- AI villages never trade controlled goods among themselves or offer them to you; only your own offers involve them. Gifts of banned goods earn no goodwill.
- **Optional mod "Contraband economy"** (off by default; enable it in Menu → **Mods**): five fictional controlled commodities — cannabis/weed, cocaine, heroin, meth and MDMA — made only through abstract game steps from invented wild plants (dreamleaf, snowberry, gloomcaps) and generic "reagent kits" at a drying rack and a back-room bench, unlocked by two technologies. Colonists make them only up to the stock targets you set as goals, and stop there. Willowmere allows cannabis, restricts meth and MDMA and bans the rest; Stonebrook bans everything. Villages sell what they buy on to their own people, so their markets want more later. There are **no consumption, dependency or health effects**. Turning the mod off keeps a save safe: its goods wait in the save and come back when it is turned on again.

### Water (Phase 4, first slice)
- Colonists get **thirsty** (a new Water need) and walk to drink: at first from a lake shore, where untreated water gives an upset stomach about 3% of the time, and from a **well** once there is one (clean water; preferred unless it is much farther).
- The colony digs a well near its homes by itself: urgently if there is no lake within 14 tiles (or none at all, as on some maps), otherwise when it has time. Going without water causes dehydration, which only water cures; carers bring water to colonists who have collapsed.
- Mods: terrain `drinkable`, building `water: { clean }`, need behaviour `core:drink`.

### Health
- Colonists have **health** made up of injuries and conditions, each with a recorded cause: starving (malnutrition, cured only by food), collapsing from exhaustion (cured by rest) and rare **work accidents** while chopping, mining or building (the odds are mod data on each work type).
- Hurt colonists work more slowly. Below 60% they go and **rest in a bed**, where they heal fastest, until they are at 85%. At 15% or less they **collapse** where they are; the others (new **Care** work type) bring them food if they are hungry and tend their wounds (twice the healing for 12 hours) until they can stand again at 35%.
- **Hover a person** for a compact live card (see "Hover card" below). Click still opens the full inspector.
- The portrait bar shows each colonist's health and a warning dot when they have collapsed; the colonist inspector lists every injury and its cause. Nobody dies yet: death waits for its own design.

### Phase 3 (first slice): charcoal and iron
- The **Industrialization** era now has three technologies. **Charcoal burning** unlocks a kiln yard that turns wood into charcoal; **Smelting** unlocks a smithy whose bloomery smelts iron bars from stone and charcoal; **Ironworking** unlocks iron axes and pickaxes (much faster and far more durable than stone).
- Nothing is placed by you: once a technology is researched, the colony builds the kiln yard and smithy where it needs them, burns charcoal and smelts iron only as far as research costs and better tools require, re-equips woodcutters and miners, and then stops.
- The kiln and bloomery glow and smoke only while someone is working them.

### Phase 3 (second slice): electricity
- The **Electric** era has two technologies. **Electricity** unlocks a steam generator and power poles; **Machine tools** unlocks a powered **machine workbench** that makes iron tools about three times faster than by hand (and, since Phase 3, a sawmill; see below).
- The colony does it all itself: once a machine is worth having it builds a machine shop in the background (tools are still made by hand meanwhile), builds a power house with a generator, lays a line of power poles until the machine is connected, and keeps the generator's fuel store filled with wood or charcoal (charcoal burns 2.5× longer).
- The generator only burns fuel while a connected machine is actually being worked. If machines need more power than the generators give, they slow down; if there is none (no fuel, not connected), the colonist waits, then leaves the work for later. The ingredients go back on the ground and the progress is kept on the machine for whoever resumes it.
- The **⚡ Power overlay** (Menu tab) shows each network: green working, yellow overloaded, red out of fuel, grey not connected, with supply/demand, fuel and each machine's state. Selecting a generator or machine shows its fuel, power, network and any paused work. Wires are drawn between connected buildings.
- **Seasonal farming:** crops grow only while the season is warm enough and at full speed from about 8°C; frost kills plants that are not ripe yet. The colony does not sow what could not ripen before frost, wild plants regrow slowly in winter, and a few days before the growing season ends the colony raises its food reserve (up to 20 days) to last until the next harvest ("Laying in food for the winter").
- **Seasons and heating:** a year is 30 days: it starts in spring, peaks around 22°C in summer and falls to about −6°C (colder at night) in mid-winter. The clock (top-left) and the Colony tab show the season and temperature. Rooms are the areas closed off by walls and doors; each keeps its own temperature, slowly approaching the outdoors. Hearths (after Masonry) burn wood from their own store and electric heaters (after Electric heating) use power, each only while its room is below 18°C. Before winter the colony researches a heater if it has none, puts one in every home (rebuilding a lantern when no spot is free) and keeps hearths stocked. Sleeping somewhere below 5°C restores energy more slowly. Select any tile to see its temperature, or a heater to see whether it is on.
- **Running water:** research **Plumbing** (after Electricity) and the colony builds an electric pump and a water tower, puts taps by the stockpile and each finished home, and lays pipes tile by tile to join them (the power planner wires the pump to a generator). The pump fills the tower while powered and only draws power while there is room. Drinking at a tap is quick and clean and uses one unit of stored water; a dry tap is skipped. Select a tower, pump or tap to see stored water, pumping and any problem (no pump, no tower, no power).
- **Lighting:** after dark (21:00–05:00) work on unlit tiles runs at 80% speed. Cooking fires and lanterns light the tiles around them. Research **Electric lighting** (after Electricity) and the colony puts up electric lamps beside its unlit workplaces and stockpile, builds a generator if it has none, and runs a pole line to them. Lamps draw power only at night (so the generator burns fuel at night too) and go dark if the power fails. Every light source glows on the map at night.
- **Wear and repair:** generators wear while burning and machines while worked. Below 60% a colonist services them (the generator, machine workbench and sawmill with a machine part, the electric pump with an iron bar); left until 0% they break down and stop (a broken generator gives no power, a broken machine cannot be used) until someone repairs them. Worn machinery shows a wrench, broken machinery a red label, and the inspector shows each building's condition.

### Phase 3, electric production (slice 2): planks, machine parts and the sawmill
- **Planks:** 2 wood make 2 planks. By hand at the workbench (work 120), unlocked by Joinery or Electricity; on a powered **sawmill** (work 40), unlocked by Machine tools.
- **Machine parts:** 1 iron and 2 planks make 1 machine part. By hand at the workbench (work 300), unlocked by Electricity; on the machine workbench (work 100), unlocked by Machine tools.
- **Gun parts on a machine:** the machine workbench makes 2 gun parts from 2 iron and 1 wood (work 70, against 220 at the gunsmith's bench). The gunsmith stays unpowered.
- **Machine parts are needed** to build the generator (6 iron + 2 parts), the machine workbench (7 iron + 3 parts), the electric pump (4 iron + 2 parts) and the sawmill (4 iron, 10 wood, 4 stone, 2 parts), and to research Machine tools (4 iron + 4 parts), Electric lighting (2 + 2), Plumbing (3 + 3) and Electric heating (2 + 2). The generator, machine workbench and sawmill are serviced with 1 machine part, so parts stay in demand while machines run.
- **The sawmill** (powered, use 6) is built in a small walled **Sawmill shop**.
- **Plank furniture:** a plank bed, a joined table and a joined chair (Joinery). They are a data alternative (`stockedOnly`): a home uses them only when free planks in stock (after reservations and other projects' needs) cover every such slot in that project. They are never required.
- **When a machine is used:** a machine recipe is chosen only when a built machine can run: it has power now, or its network has a built, unbroken generator and there is fuel in stock. Otherwise the work is done by hand.
- **One new machine at a time:** while one powered workstation is being built or planned, another waits. The Machines row then says "Waiting until the X is built (one new machine at a time)".
- **Reasons** name the chain, for example "Machine parts for Research: …: faster on a Machine workbench".

### Phase 2 (first slice): a neighbouring village, relations and trade
- **Neighbouring village:** the browser starts with the scenario "Five settlers and a neighbouring village" (choose a scenario in Menu → **New colony**). An AI village (e.g. Willowmere, a farming village) is founded at a reachable site with its own people, goods and stockpile. It runs on exactly the same needs, jobs, research, building and renovation rules as your settlement, with no free resources. Its *personality* is data (`villageProfile`): research priorities, policy overrides (food reserve, stock targets) and trade temperament.
- **Territory:** land and wild resources belong to the settlement whose centre is nearest. Settlements never build, farm, extend stockpiles or gather on each other's land, and never use each other's goods, stations or beds (tested continuously). A settlement that lacks a resource on its own land has a real reason to trade.
- **Contact and relations:** villages meet when their people come near. Relations (neutral, friendly or hostile) change only for recorded causes: first contact, agreed trades, completed trades, gifts, failed deliveries. The Diplomacy tab shows them. Hostile villages fight (see Combat below).
- **Trade:** the settlement planners match one side's needs (goods it can't get on its own land, or is spending labour to gather) with the other side's surplus. A deal bundles up to 3 goods the buyer lacks and the seller can spare; payment is up to 3 kinds of goods the seller lacks or keeps in stock, worth at least as much by item `value` (the least needed goods are dropped if the buyer cannot pay for all); generous villages may give gifts. A colonist **physically carries** the goods to the other stockpile, and ownership changes only on delivery, so nothing is created or destroyed and the ledger stays exact. Interrupted deliveries keep the goods with the sender, and undelivered trades expire with a relation penalty.
- **Your trade policy:** trade with anyone not hostile, friendly villages only, or no trade. It covers the deals your settlement makes on its own. AI villages decide for themselves.
- **Your own offers:** in the Diplomacy tab, **Offer a trade or gift…** opens a dialog where you choose what to give and what to ask for, up to 4 different items on each side ("+ another item"). Before you send it you see whether the neighbour will accept, why (what each side is worth to them, what they can spare), and the relationship effect. Give only = a gift (relations improve by its worth); ask only = a request, which only a generous neighbour on good terms (+15) grants, for up to 15 items in total. Accepted offers are ordinary trades: colonists carry both sides and ownership changes only on delivery. One trade at a time per neighbour. Promised goods are held for the delivery: your colonists will not eat, build with or craft from them, and you cannot offer them twice (the dialog warns before you give away food you are short of). **Call off** ends an active trade for at least −4 relations, more if you already received goods you have not paid for.
- **Trade pacts:** once relations are friendly (+25) and you have completed 2 trades with a neighbour, **Trade pact…** lets you sign a standing agreement. The dialog lists the conditions, effects and costs before you sign. While it holds, offers between you need a thinner margin, the neighbour grants small requests at lower relations (+5, up to 25), each completed trade adds +1 relation, and a "friendly villages only" policy counts the partner as a friend. It ends by itself if relations drop below +10 or no trade completes for 10 days; ending it yourself costs −10, and calling off a trade with a pact partner costs −3 extra. Pacts are the first treaty; alliances (below) are the second.
- **Neighbours propose too:** once a day, a neighbour that qualifies for a pact with you and wants one (eager traders do; cautious ones only at +40) sends a proposal. It appears as a letter and in the Diplomacy tab with the pact's effects and costs, and you **Accept (+3)** or **Decline (−1)**. Unanswered proposals expire after 2 days at no cost; after a decline the village waits 5 days before asking again. Two AI villages that qualify and both want a pact sign one on their own.
- **Gathering rights and border disputes:** a village that has run out of a resource on its own land (say, boulders) while you have some near the border asks to gather there. The request appears as a letter and in the Diplomacy tab with what it means: they may only gather that resource, within 18 tiles of their centre, never build or farm, and you can revoke it later (−5). **Grant (+4)** or **Refuse (−2)**. Refusing starts a border dispute: while they still lack it, relations slip by 1 a day (at most −8 in all), each day recorded with its cause; it settles when the need ends or you grant the rights. You can also **ask** a neighbour for rights on its land; it agrees if relations are at least +5 (any level with a pact) and it has plenty itself. Two AI villages settle such requests between themselves.
### Combat (stage 1)
- **Only hostile villages fight.** Colonists never target people from neutral or friendly villages.
- **Weapons:** a spear (melee) or a bow (range 7, needs arrows). Arrows are made at the workbench (wood → 8 arrows, Bowyery). Fighters fill a pouch of 12 from the stockpile; each shot uses one through the ledger. An empty bow fights as fists. Range, cooldown, accuracy, damage and ammunition are item data.
- **Shots need a clear line:** walls and solid things (trees, boulders) block them, and fighters move for a clear shot. Hits are more likely up close; every hit is a wound (health system), logged with who did it, and worsens relations by 2.
- **Who fights:** armed colonists with at least 50% health engage enemies within 9 tiles. The unarmed and wounded flee home; fighters below 40% fall back. Collapsed people are never attacked. Nobody dies.
- **Orders (Diplomacy tab):** **Defend** (default: fight enemies who come near), **Retreat** (everyone goes home and avoids fights) and **Attack…** on a village card. The attack dialog shows both sides' fighters, carried and stored ammunition, and every risk (war declared and relations set to −40, a trade pact ending, open trades cancelled, raids back) *before* anything changes.
- **War and peace:** wounds deepen a war. **Offer a truce…** sets relations to −20 (neutral) unless the enemy is clearly winning. When nobody is hurt for 2 days, relations recover by 2 a day. AI villages raid a hostile neighbour they outnumber 1.5 to 1, call raids off when half their people are down, and ask for a truce when losing badly.
- **Cover (stage 3):** someone right beside a wall (stops 50% of shots), another solid building, a tree or a rock (30%) on the shooter's side is harder to hit; diagonal cover counts half; melee ignores it. Before trading shots, ranged fighters step up to 2 tiles to a spot with better cover that keeps range and a clear shot. Shots stopped by cover show "cover" instead of "miss", and the inspector shows a fighter's cover.
- **Firearms (stage 2):** research **Gunsmithing** (after Ironworking) for the gunsmithy, gun parts, pistols, shotguns and their rounds; **Rifling** for rifles and rifle rounds; **Marksmanship** for the sniper rifle. Recipes are abstract (iron, wood and charcoal into parts, guns and rounds). Roles: the pistol is a quick sidearm (range 6), the shotgun hits hardest up close (range 4), the rifle is the all-rounder (range 12), the sniper rifle reaches 20 tiles but fires slowly. Snipers engage from further away.
- **Arming goals:** **Arm N guards with a weapon** (pick the weapon) and **Keep N spare** (e.g. 5 rifles to sell). At war, everyone is armed with the best weapon you can make, and armed colonists trade up once a better one is in stock. Rounds are kept for every gun carried.
- **Arms trade:** guns and rounds are controlled goods. Each village has arms laws (Willowmere: restricted, at most 10 per trade and some attention; Stonebrook: legal). Offers show the law before you send them, and goods are carried by hand. Equipped weapons and reserves are never sold automatically. Unused tools and weapons can be offered; worn ones cannot.
- **Feedback:** shot tracers, swings, red hit flashes, "miss" labels, ⚔ over fighters and ! over people fleeing; the inspector shows a fighter's ammunition.
- Save **format 3** gives every settlement its own stockpile; older saves migrate on load.

### Alliances (Phase 2, slice 1)
- An **alliance** is a defensive pact between two villages, separate from a trade pact (a pair can have both). It needs contact and relations of at least +50, and each village can have at most 3 allies.
- **Terms before signing:** the village card in the Diplomacy tab shows who each side is at war with (and so whom you would be expected to fight), the other side's allies, the relation needed and the relation now, and what ends it. **Propose alliance** asks for confirmation with the same terms. A village refuses if the alliance would drag it into a war with an enemy much stronger than both sides together (1.5 times their fighters).
- **Signing** adds +3 relations. An alliance **lapses** by itself when relations fall below +25. **Ending it by hand** costs −20, shown on the button and asked before.
- **Allies cannot attack each other**: the attack dialog says "End the alliance first", and AI villages never raid an ally.
- **Allies join wars.** Only the *first* attack of a war (your attack order or an AI raid) calls in the defender's allies: each turns hostile to the attacker (relations drop to −50, cause "Attacked our ally …"), meeting it if they had not met. Later attacks in the same war and retaliatory raids call in nobody, and allies of an ally do not join, so wars do not chain. The attack dialog lists which of the target's allies would join before you order it.
- **An ally of both sides** stays out, and its alliance with the attacker ends at no cost to it.
- **AI villages propose.** Once a day, friendly villages (+50) where either side is at war seek an alliance. Two AI villages that both accept the terms sign at once. An AI village sends you a proposal at most every 5 days; its log line gives the reason (for example "Willowmere is at war with Stonebrook"). It appears as a letter and in the Diplomacy tab with the terms; **Accept (+3)** or **Decline (−1)**; it expires after 2 days.
- **Distant villages** join by relation only. Joining a war never moves a village to full detail; it is promoted only for the usual reasons. A village at the distant level never raids.
- The village summary lists each village's allies.
- Save **format 6** adds alliances and alliance proposals (older saves load unchanged). Loading now also checks treaties, alliances, proposals and the war markers on relations (who started a war, and which ally a joiner defends), and rejects bad data with a clear reason.

### Villages founded during play (Phase 2, slice 2)
- **Only where the scenario allows it.** The rules are data (`founding` in the scenario). Today only the Living world turns it on; the classic scenarios have no founding and run exactly as before.
- **When settlers leave.** Once a day each village is checked. Settlers leave when the village has been at its population cap for 3 days, has at least 5 adults, would still have food for 5 days after they go, has not founded a village in the last 20 days, and the world has fewer than 40 villages. At most one village is founded per day in the whole world. If no free site is found, the village looks again after 5 days.
- **Who leaves.** 2–4 adults (about half the adults), with their children. Families are never split: everyone sharing a home, and every child with each parent living in the village (also a teenage parent), go together or not at all. Nobody leaves who is collapsed, carried or in a medical bed, and the last holder of a qualification stays.
- **Nothing is created.** The founders move to the new village: their jobs end, their beds and homes are freed, and their tools and weapons go with them. The parent sends food for 3 days per founder plus up to 20 wood and 10 stone, only what it can spare, as an ordinary **gift trade**: carried by its colonists at full detail, by caravan from a distant village.
- **The site** is the nearest free spot within 36 tiles of the parent, at least 22 tiles from every village centre, on the parent's walkable land and near water. No building, building site, field or storage tile of any village may change owner. The choice uses no random numbers. Only the land near the new centre changes owner.
- **What the daughter inherits:** its parent's relations with everyone (with the history line "Inherited from …"), research and era, research priorities, village profile, policy, trade habits, laws, enforcement and culture. Parent and daughter start friendly (+60, "Founded by …"). Alliances are not inherited.
- **Distant villages found too.** The founders are placed at the new site instead of walking, the supplies go by caravan, and the new village stays at the distant level unless it is near you.
- **Your village.** The same rules apply. The Colony tab has a **Settlers** block: people against the cap, what still stops settlers from leaving, and the policy box **Let settlers leave to found new villages** (on by default), with what ticking or unticking it does. Untick it and births simply stop at the cap. A village founded from yours is an AI village; you do not control it.
- **Where to see it.** The log says who left, why and what was founded ("3 settlers left … (crowded: 6 of 6 for 3 days) and founded …", where the count includes children). The Diplomacy card and the village summary show "Founded from … on day N", the culture and any daughter villages, plus a **Growth** line ("Crowded: 6 of 6 for 2 days — …" with the first thing still missing; hover for all of them). The World tab has a **From** column.
- **Room to grow.** Where founding is on, a village under its cap with food for at least 4 days plans one spare bed, so families can have children (births need a free bed); it starts once the village has stood for 5 days. The housing line under **Building next** gives the reason ("Room to grow: 4 of 6 people and food for 7 days").
- **Village size in the Living world.** The six Living-world profiles cap a village at 6 people; other villages, including yours, use the default cap of 12.
- **Distant construction no longer stalls.** At the distant level, a wall is no longer refused because one colonist somewhere else in the world is already cut off.

### Kingdoms (Phase 2, slice 3)
- **How a kingdom forms.** When a village that is in no kingdom founds a daughter, it becomes the **capital** of a new kingdom and the daughter its first member. Later daughters of the capital, and daughters of any member, join the same kingdom. A village that left its kingdom forms a new one when it next founds a daughter. Kingdoms only arise where villages are founded during play (today the Living world).
- **Name and colour.** The name comes from the capital's village profile (`kingdomNames` patterns such as "March of {capital}" or "{capital} League"; without them "Kingdom of {capital}", "{capital} Realm" or "Crown of {capital}"). The pattern is picked by a stable hash of the capital's id, so no random numbers are used. The kingdom takes the capital's colour.
- **Members stand together in war.** When a war on a member starts, its allies and every other member of its kingdom turn hostile to the attacker. As with alliances, only the first attack of a war calls anyone in, and there is no chaining. A defender that is in the attacker's kingdom stays out.
- **Members never fight each other** while they are in one kingdom: you cannot order an attack on a fellow member ("… is in your kingdom"), AI villages do not raid one, and their colonists do not fight each other even if relations turn hostile.
- **Leaving.** Once a day: a member whose relations with the capital are at or below −25 (hostile) leaves. Of two members hostile to each other, the one with the lower relation to the capital leaves (on a tie, the one with the higher id). The capital never leaves. A kingdom with only its capital left is dissolved. Each step is logged with its cause and noted in the relation history with the capital.
- **On the map.** Zoomed out, the land of all members is tinted in the kingdom's colour, with lighter borders between members. The capital carries a banner with the kingdom's name and flag; each member's label has a bar in the kingdom colour. The minimap draws a ring in the kingdom colour around members' dots.
- **In the panels.** The World tab has a **Kingdom** column (once any kingdom exists). The Diplomacy card and the village summary show the kingdom, its capital and members, the leave rule and the relation now. The colonist hover card shows "Kingdom: X". Alliances and kingdoms are separate: a village's list of allies does not include its fellow members; the panels show both.
- **Distant villages** belong to kingdoms in the same way; membership never changes a village's level of detail.
- Save **format 8** adds kingdoms. Older saves with villages founded during play get the kingdoms those foundings would have formed, in founding order. Loading checks each kingdom record (id, name, colour, founding time, a capital that exists and is in the kingdom) and that every village's kingdom exists, and rejects bad data with a reason.

### Markets (Phase 2, slice 4)
- **Only where the scenario allows it.** The technology **Trade routes** exists only in scenarios with a `market` block (today only the Living world). Elsewhere it is never researched and is hidden from the Research panel, so classic worlds are unchanged.
- **Who builds one.** A village that has met at least 3 neighbours wants Trade routes (never in a field switched Off). Once it knows the technology and has met at least 2 villages that are not hostile, it builds one **Market stall** (16 wood), with the reason "Market stall: Trades with N neighbours". The stall can be walked through, so it never seals off part of a village.
- **Reach.** A market serves every village whose centre is within 120 tiles of its village's centre and that has met its village (its own village included).
- **Prices.** Once a day each market sets a price for every good that villages in its reach want or can spare:
  - supply = what they can spare (their plans' surplus);
  - demand = what they want (their plans' remaining wants, or their trade needs where larger);
  - target = value × (demand + k) / (supply + k), kept between 0.5× and 2× the value (k = 200 in the Living world);
  - the price moves a quarter of the way to the target each day, rounded to 0.01.
  - Controlled goods get no market price. A market that is gone loses its record. No random numbers are used.
- **Trading at market prices.** When both villages of a trade are served by the same market, the goods are valued at its prices instead of their fixed values. If several markets serve both, the one nearest the first village is used (on a tie, the lower id). AI deals, your offers and the offer preview use the same prices, so the terms you see are the deal you get. Sums are kept in whole cents. Goods are still carried by hand: prices change only how much is asked and paid, nothing is created. Calling off a trade uses the prices of the market that priced it (or the fixed values if none did).
- **Where to see it.** A village with a market shows a **market card** (Colony tab for yours, its Diplomacy card for others): whom it serves, each price against the usual value, an arrow for where the price is heading (green when that is good for you, red when bad) and why ("scarce: …", "plentiful: …"). Other villages show "Market: X (N served)". The village summary has a Market line, the World tab marks villages that have a market, and the offer dialog shows "Priced at X's market" with a table of market prices next to the usual values. The log notes when a deal used market prices.
- Distant villages feed supply and demand through their plans, trade at the prices, and research and build markets like any other village.
- Save **format 9** adds markets (`s.markets`) and the market that priced each trade. Loading checks prices (above 0), supply, demand, the update time and that every market and priced trade names an existing village, and rejects bad data with a reason.

### Hover card (Phase 2, slice 5)
- **Hover a person** for a compact live card. From top to bottom:
  - name and village;
  - age and profession;
  - **Kingdom:** the kingdom's name with a dot in its colour, "(capital)" for people of the capital;
  - **Culture:** for a village founded during play, the village whose culture it carries;
  - family ("Child of …", "Parent of …");
  - current action and goal, health, urgent conditions (collapsed, infected, starving, urgent needs), and food, water and rest bars;
  - a School bar for children still at school;
  - **Home:** the home's name, with "(building)" while it is not finished; without a home, the bed the person sleeps in;
  - **Equipment:** tool and weapon with their wear (for example "Stone axe (80%)"), and the ammunition carried with a weapon;
  - **Village market:** the market that serves the person's village, once any market exists in the world;
  - "Training as …" for a college trainee;
  - the most relevant skills.
- A line appears only when its system exists and there is something to show, so a classic game shows no kingdom, culture or market lines. The lines come from one list of fields (`src/ui/hoverfields.js`); a new system adds its line there. A field with missing or broken data is left out instead of breaking the card.
- The card follows moving people and camera moves, sits beside the person inside the screen, never takes clicks, and hides while dragging, for touch input and while a dialog is open. Click still opens the full inspector (the same data).
- Screenshot: `docs/screenshots/phase2-hovercard.png`. Not checked in a browser yet: the "(building)" home text, the bed shown when there is no home, and the ammunition text.

### Village storage hubs
- Each village keeps its goods in **one central storage hub** (its stockpile zone around the village centre), outlined on the map and labelled with its name and how many tiles are in use ("First Hearth stores · 10/24").
- The Colony tab row **Storage** separates goods **stored** in the hub (and how many of those are **reserved** for jobs or trades), goods **being carried**, and goods **waiting to be hauled**. Goods kept on purpose elsewhere (workshop buffers, generator/hearth/cabinet stores, materials at a building site) are not counted as waiting.
- Villagers haul loose harvested, mined and crafted goods into their own hub; the more that lies around, the more hauling matters to them. New piles go next to piles of the same category (food, materials, tools, arms, medical) — nothing already in the hub is ever moved again, so there are no haul loops. Materials that a building site right next to them still needs are not detoured through the hub.
- The hub grows next to itself when it is nearly full, never onto fields, door fronts, building sites or outside the settlement area. Every village has its own hub and inventory; goods only cross between villages by trade deliveries. Saved colonies keep their existing hub tiles.
- Seed stock lying by the fields counts as "waiting" in the summary even though it is intentionally kept there.

### Medical care
- **Doctoring** is a work type (faster with the Medicine skill). Doctors carry collapsed colonists to a free medical bed (one rescuer per patient; the bed is reserved), then dress wounds with **bandages** and treat infections with **herbal medicine**, fetched from the medicine cabinet or the stockpile.
- **Infection:** a wound left undressed for 6 hours may become infected (cleaning it as first aid makes that much less likely). An untreated infection gets worse unless the patient rests in bed or is tended, where it slowly fades; medicine clears it much faster.
- **Supplies are real items:** bandages are made at a workbench from wood (no research needed), medicine at the clinic's apothecary table from berries. The colony keeps some of each in stock and fills the cabinet by hauling.
- **Clinic** (research Herbal medicine): two medical beds, a cabinet and an apothecary table; built once there are patients or five colonists. **Hospital ward** (research Hospitals): four better beds, built only when collapsed patients have been waiting for a bed (demand, not time).
- The colony researches herbal medicine on its own when infections appear (never in a field switched Off).
- **Shortages** are shown in the Colony tab ("Health care") and the colonist inspector lists each injury, whether it is dressed/treated, and what is still needed. No doctor, no bed, no supplies or an unreachable patient never block other work: doctors give first aid without supplies, and the existing tending still feeds the collapsed.
- Contagious and environmental illness (beyond dirty-water stomach upsets) is not modelled yet.

### People, children and schools
- **Life stages** (data: `lifeStage` in `mods/core/content/people.json`): infant (first 3 days), child (until day 15), adult. Every colonist has an age; colonists from older saves become adults aged 20–45.
- **Births:** a household with two adults may have a child when there is food for at least 4 days, a free bed (in the parents' home, or any free village bed) and room under the population cap (12 by default). Births never take spare beds that an active "Expand housing" goal is keeping. Infants stay in bed and are fed by others; children only do the work their stage allows (foraging and school), carry no tools or weapons and run from fights instead of joining them. After 15 days a child grows up into an adult, aged 16.
- **School** (research Schooling): once there are children who have not finished school, the village builds a schoolhouse (teacher's desk and pupils' desks) through a civic intent. During school hours (8:00–15:00) children attend; any adult can teach, so lessons never wait for a trained teacher, and children also learn alone at about a third of the speed. Finishing school gives **Basic schooling**; founders already have it.
- **Qualifications** (data: `qualification`): Teacher, Doctor and Industrial specialist. A qualification makes its work faster (a Doctor treats 1.6× faster) but is **never required**: unqualified colonists still do the work. They are earned by practice (for example Medicine skill 7 makes a Doctor) or at college.
- **College** (research Higher learning): only when the village is short of a profession (one Doctor per 8 people, one Teacher when there is a school, one Industrial specialist when there are machines) does it build a lecture hall, and then one trainee at a time studies there until qualified. No shortage means no lecture hall and no training.
- The Colony tab shows **People** by stage and **Education** (children at school, teachers, trainee progress and "short of: …"); the inspector shows each person's schooling and qualifications, and the hover card shows their profession.

### Machines and factories: why one is or isn't built
- The Colony tab row **Machines** lists every powered machine (today the Machine workbench in a Machine shop and the Sawmill in a Sawmill shop) with its state: running, built but without power (and why), being built (parts done and what it is still waiting for), planned, not needed now, or the first thing holding it back. Hover for every check: research, demand, generator, fuel, materials and space.
- **Research** is traced through the whole prerequisite chain ("Needs research Machine tools ← Electricity ← Ironworking ← …"), down to the era milestones still to do, a field you switched Off, or research that is waiting for its materials before it can start.
- **Shortages** are followed to their cause: a station that is not built yet, a missing ingredient, or nothing left to gather on your land ("no Granite boulder left on your land: research Quarrying to make it, or get gathering rights or trade").
- Nothing is forced: a machine is only built when something the colony is making would use it. The status is read-only.

### When a resource runs out
- **Quarrying** (research, Advanced workshops era): a quarry face makes 4 Stone from 1 Wood and labour at a third of the speed of mining a boulder. It is a *fallback* recipe (`"fallback": true` in recipe data, usable by mods): the colony only researches it when stone is short and only builds and uses a quarry while no boulder is left on reachable land, so mining always comes first.
- **Gathering rights:** when a resource it needs has run out on its land, your colony asks the neighbour with the most of it near the border for gathering rights, by the same rules AI villages use (one request a day; a neighbour must have met you, be on good terms and have plenty itself). A refusal costs nothing, starts no border dispute and is not repeated for 4 days. Granted rights let your colonists gather only that resource there.
- Land itself does not grow: every tile belongs to the nearest village, and the Settlement area only limits where you build.

### World size
- **New colony** offers Small (72×52, the original map), Medium (128×96), Large (192×144), Huge (384×288) and Colossal (544×408) worlds. Each scenario brings its own default size and village count ("Scenario default"); you can override both. Scenarios with villages around yours allow 1–4; the Living world allows up to 40, spread over the land. Sizes apply to new worlds only; saved colonies keep their map. Measurements are in docs/PERFORMANCE.md. On bigger maps, settlements send a scout to find neighbours they have not met.

### Big worlds and the living world
- **Continent worlds.** The Living world scenario uses a biome generator (other scenarios keep the original generator at any size): ocean, coast, plains, forest, hills, mountains, marsh and tundra, picked from elevation, moisture and temperature noise. Rivers run downhill as passable shallows, so the land never splits into pieces. Mountains are impassable. Terrain, biomes and spawn rules are mod data. Existing scenarios and seeds generate exactly the same worlds as before.
- **The Living world scenario** puts your village among many AI villages spread over a continent (by default 10 on a Huge map). There are 8 village profiles: the farming village and the quarry village from before, plus lumber camp, hill fort, trading post, river hamlet, highland steading and scholars' retreat. They differ in research priorities, stock, trade habits and laws; all use the same rules and economy as you. Crowded villages send settlers out to found new villages (see "Villages founded during play").
- **Villages near water.** In the Living world on big worlds, village sites with a lake shore within 24 tiles' walk come first (`siteWaterWalk` in the scenario data). Only where no such site is left at the required spacing does a village start on a dry site, and it then digs a well first.
- **Water found on foot.** On big worlds, "near water" means walking distance over terrain, not a straight line: a lake behind a ridge does not count as near. Colonists drink at the shore nearest on foot. A village with no shore within 40 tiles' walk digs a well urgently. Full and distant villages use the same rule, so a village does not change its mind when its level of detail changes.
- **World view.** Zoom out below 0.35 and a WorldBox-style map takes over: one pixel per tile of terrain, territory colours and borders, buildings as pixels in the village colour, people as dots, caravans as amber diamonds, and a label with each village's name and a procedural flag. The two views cross-fade around the threshold. The minimum zoom shows the whole world.
- **Village summary.** Click a village in the world view (or its row in the World tab) to see, in the inspector card, its population, era, relation with you, wealth (value of its goods), wars and level of detail. **Go there** moves the camera to it and marks it as *watched*.
- **Level of detail** (Huge and Colossal only). Villages far from you are simulated *at a distance*: once per game hour, by the same rules and the same item functions as the jobs, so every item is still conserved. Their people eat, drink, rest, research, build, craft, farm and gather in aggregate. A village is simulated in full when it is near your village (within 64 tiles), when you watch it with Go there, when it is at war with you, or when a fully simulated village attacks it. Wars and attacks switch it at once; otherwise the check runs every 600 ticks and a village keeps its level for at least a day. Switching never touches history, relations or ids. The village summary and the event log say which level a village is on and why.
- **Faster paths and loading.** Path searches are about 3× faster than before, with exactly the same routes (a long trip on Colossal: 6.1 ms on average instead of 18.8 ms). Big worlds build their derived maps (walkable areas, rooms, territory, distances to water) when a world is created or loaded, so the first ticks after loading no longer stall (worst tick under 1 ms instead of 63–81 ms; loading takes about 0.25 s instead of 0.12 s on a Colossal day-30 save).
- **Per-village indexes.** Each village's colonists, buildings, goods, building sites, fields and homes are kept in indexes by owner (built when first needed, never saved), and buildings of one kind are listed once and kept up to date. So looking at "this village's own things" costs as much as the village has, not a scan of the whole world, with exactly the same results. `tools/bench.js` is 8–22% faster in every row, and the 60-day Living world runs about 30–35% faster (numbers in docs/PERFORMANCE.md).
- **Caravans.** Trade goods sent by a distant village travel as a caravan: they leave its stock, are counted while on the road, and arrive at the buyer's store after the travel time.
- **Compact saves.** Save format 4 stores terrain and resource nodes compactly on big worlds (a Colossal world at day 0: 5.3 MB before, 469 KB now). Format 5 adds each village's level of detail, the watched village and caravans. Older saves load through migration.
- **Known simplifications of villages simulated at a distance:**
  - They burn no generator fuel and wear no machines while crafting.
  - They cannot make contact by sight: someone else's scouts or walkers have to meet them.
  - Their people stand at home (patients and infants in bed) instead of walking about.
  - Research progresses somewhat slower than at full detail: 0.77 of the full rate in the 10-day calibration.
  - What they make or gather goes straight to their stockpile.

### How villages decide what to build
- Every village keeps a list of **civic intents** for homes and workstations: what is needed and why (population, a recipe that needs a station, a goal, an era milestone), how many are wanted, how many are finished and under way, and what blocks it (research, a field you switched Off, no building plan, no space). The Colony tab shows the next ones under **Building next**.
- At most one new home or workstation project is started per village per planning cycle (every 60 ticks, about 36 game minutes), the most urgent first; villages take turns going first. Sites are chosen without randomness, checked again just before work starts, and a failed search waits a few hours before trying again. The existing construction, hauling and reservations do the work.
- Finished buildings count toward targets; ones under way count against duplicates. Materials for a village's buildings are chosen from that village's own stock.

### Goals and explanations
- **Era goals:** the Research tab lists the next era's milestones with completed/required counts. Beside an unmet building milestone, **Add goal** creates a "Build N of a building" goal; **Add goal: advance to …** creates an "Advance to an era" goal (also under "Custom goal…" in the Goals tab). The era goal reads the era's own milestone data: missing buildings become building targets, missing research becomes the research the settlement works on first (only in fields that are not Off; a field you switched Off is never turned on, and the goal says so), and milestones the colony cannot meet on its own (more settlers) are shown as blockers. Advancing an era is separate from finishing a research project.
- **Build N of a building:** counts only completed buildings toward the target and counts ones under construction against duplicates (2 wanted, 1 completed, none under way → exactly 1 more is planned). It uses the normal building plans (templates), sites, materials and hauling, and reports what blocks it (research, no plan, no space).
- **Pause / Resume / Remove:** a paused goal steers nothing; removing a goal cancels construction it started that has not begun (anything already under way is finished).
- **Goals:** furnished homes, maintain N meals, food for N days, stockpile an item (once or ongoing), expand housing, equip a worker type, keep spares, and arm everyone. One-time and ongoing goals are distinguished; there are Low/Normal/High priorities and presets.
- The **goal inspector** shows a step-by-step plan: what is in stock, what is being made or gathered, which station is needed and its build progress, which research is required, and what is blocked and why. It also shows "Colony is:", the colonists currently working for that goal.
- The **colonist inspector** shows goal, action, target and blocker, plus *what is missing* (e.g. "Materials at the site: 6 Wood", "Reachable food") and *what the colony is doing about it* (who is hauling or foraging, cooldowns, idle reasons such as forbidden work types).

### Mods and saves
- Base content (`mods/core`) goes through the same registry and validation as any mod. There is a mod manager with enable/disable, validation errors, dependency/version/API checks, load order and explicit conflict reporting. JSON packages can be imported into browser storage; packages containing scripts are rejected and nothing uploaded is executed.
- Example mods: `example_pottery` (resource, recipe and autonomously chosen furniture) and `example_herbalism` (a technology that colonists research when a goal needs berry tea, then brew it).
- **Saves:** multiple slots, an autosave, export/import, and the previous version of an overwritten slot kept as "(previous)". **Saves are validated before loading**: damaged or tampered saves are rejected with reasons and nothing is changed. When a mod is missing, its content is **set aside, not deleted**: it is counted in the item census, carried in later saves, and restored automatically only onto a **valid, free position**. If something else now occupies the spot, both are kept and the restore waits, with a stated reason (tested). The "set aside" warning appears only when that load set something aside.
- **Save format 7** also stores each village's plans (what the planners decided and what they still mean to replan). Saving never changes the running game, and a loaded game continues exactly as if it had never been saved (checked by saving at days 10–50 of a 60-day Living world run with 12 and with 30 villages). Loading checks the stored plans: damaged or tampered plan data is rejected with a reason; plans that are well formed but no longer fit (for example a village that is gone) are dropped with a warning, and the villages plan afresh. Older saves (format 6 and earlier; formats 3–6 tested), saves made with different mods, and loads that set something aside also plan afresh.
- **Current save format: 9.** Format 8 added kingdoms and format 9 markets (see those sections). Older saves load through migration.

### Visuals
A procedurally drawn three-quarter top-down view with no image files:
- **People:** individual settlers with generated looks, clothing, distinct axe and pickaxe silhouettes, and walking, working, carrying and sleeping poses.
- **Ground:** patchy, restrained terrain with shorelines and animated water.
- **Buildings:** log and stone walls with height and foundations, plank floors, recognizable furniture, a research desk and lanterns.
- **Roofs:** optional, with slate on stone homes and shingles on timber.
- **Crops:** growth stages from sprout to flowering to ripe.
- **Item piles:** contents look like the item.
- **Lighting:** one light direction with contact shadows, golden hour, and restrained nights with firelight. Names, counts, warnings and selection are drawn after lighting so they stay readable.
- **Resource chips:** item icons (logs, rocks, beans, potatoes, berries, stew bowl, tools, clay, pots, tea...) in one consistent style, cached and data-driven (`render.icon`), with a neutral fallback for unknown items. Full names appear on hover and keyboard focus, and the row wraps instead of clipping.
- **Security:** all UI text from saves and mods goes through an auto-escaping template, so names, ids and numbers render as text, never as HTML (tested with hostile names).
- **Full window:** the map fills the whole browser window and every panel floats over it (see "Interface" above). The canvas re-measures itself whenever its displayed size or the device pixel ratio changes, keeping the view centred. Zooming out goes all the way to the world view, where the whole map is centred on screen. The Overseer layout was checked at 1920×1080, 1440×900, 1024×768 and 1024×700 in a headless browser; high-DPI screens were not re-checked after the layout change.
- **Scenery:** grass drifts naturally between drier and lusher patches, and conifers come in three shapes with varied size and hue. Timber roofs have staggered shingles (with some moss) and stone homes get slate. Logs vary in tone with bark grain, and walls cast shadows in the same direction as trees.
- **Caching:** roofs and trees are drawn once into cached images, so the busier art does not cost frame time.

## Tests performed

`npm test` runs the whole suite (535 tests, all passing; the count grows with each phase). The early highlights below are kept as a record; each later system has its own test file under `tests/` (villages, trade, alliances, combat, letters, power, water, heating, medical, life stages, education, civic planning, machines, stone supply, old saves and more). Highlights from the first phases:
- **Autonomy (7 unattended days and other seeds):** furnished homes for all; farm → harvest → cook → workbench → tools → equip; meals replenished; nobody starves; seed stock protected.
- **Conservation:** census equals ledger throughout; mining yield equals chunks removed; construction consumption equals the cost of everything built, including renovation history.
- **Reliability:** no reservation leaks or double booking across seeds; interrupted hauls, crafts and research recover; walled-off targets fail with a reason; replanning; nobody trapped; a full map holds and later places items; hunger interrupts work; scarcity of stone or food produces explanations rather than crashes.
- **Large recipes:** a 120-wood recipe is fetched in multiple trips from a 75 stack plus a 45 stack, survives an interruption mid-way, and produces exactly one item.
- **Saves:** byte-identical continuation after save/load (also with research); format-1 migration; 11 kinds of malformed save rejected with the original untouched; a mod disabled and re-enabled with quantities preserved; restoration never overwrites a tree, wood stack or cupboard that took the old spot.
- **Phase 1:** a research desk built and technologies researched autonomously; materials charged exactly once; locked content never used early; research pauses when food is low; field priorities and reasons; eras advance by milestones only; ownership isolation with a neighbouring settlement; the herbalism example mod researched because a goal needed it, then producing real tea from real berries.
- **Villages founded during play (Phase 2, slice 2, headless):** the Living world on Colossal, seed 7, 60 days, starting with 12 and with 30 villages: villages were founded during play in both. 0.49–0.50 ms per tick with 12 and 1.20–1.23 ms with 30 on a machine partly loaded by another process. Saving at days 10–50 gave the same day-60 state as never saving. Details in docs/PERFORMANCE.md.
- **Kingdoms (Phase 2, slice 3, headless):** the Living world on Colossal, seed 7, 60 days: with 30 villages at the start, 6 kingdoms formed (five of 2 villages, the Marketon League of 3); with 12, 3 kingdoms (the March of Stonegard has 3). No village left a kingdom. A save at day 30 continued exactly like the unsaved run, conservation held, and time per tick stayed within about 1% of the code before the slice. The classic 40-day run is unchanged.
- **Markets (Phase 2, slice 4, headless):** the Living world on Colossal, seed 7, 30 villages, 60 days: 8 markets were built (the first, First Hearth's, on day 8), and 7 of 81 trades were priced by a market. A save at day 30 continued exactly like the unsaved run, and conservation held. The classic 40-day run is unchanged; the seed 4242 run is unchanged except one research log line (a name no longer listed twice) and the save format. Details in docs/PERFORMANCE.md.
- **Big-world acceptance (Phase 1, headless):** the Living world on Colossal, seed 7, ran 60 game days with 12 and with 30 villages: 0.37 and 0.96 ms per tick on average, no conservation errors (checked every 5 days), and a day-30 save loaded in a fresh process continued identically to day 60. Details in docs/PERFORMANCE.md.
- **Mod loader and UI safety:** invalid manifests, namespaces, unknown references, dependency/version/API problems, cycles, incompatibilities, override conflicts, trapping templates, scripts in packages; HTML-like names and ids from saves and mods rendered as text.

Four existing tests were adjusted because Phase 1 legitimately changed behaviour, and each still checks its original requirement:
- **Save-file mod version:** expects core `1.1.0`, because the core content changed.
- **Missing-mod test:** a shelf may now wait if colonists put a researched cupboard in its spot, as long as none is lost.
- **Conservation test:** includes renovation history.
- **Spare-axes test:** counts axes *crafted*, since axes retired after a tool upgrade sit in storage.

One recovery test now waits for an in-progress step to finish before checking the route.

**Manual checks** in a browser at 1400×860 and 760 px wide, same seed 4242, camera and times:
- **Before/after screenshots:** `docs/screenshots/before-*.png` and `after-*.png` (normal, close-up, night, busy, resource bar, narrow resource bar), plus `icon-sheet.png` and `phase1-research-renovation.png`. No console errors.
- **Later screenshots:** alliances (`phase2-alliances.png`, `phase2-alliances-terms.png`), kingdoms (`phase2-kingdoms.png`, `phase2-kingdoms-card.png`), the hover card (`phase2-hovercard.png`) and letters before and after the rework (`letters-before.png`, `letters-after.png`).
- **Rendering cost:** about 1.6 ms per frame close up, about 5 ms at normal zoom and day or night, and about 6.6 ms for the busy overview.

## Limitations

- **Neighbours:** 1–4 AI villages (up to 40 in the Living world), trade pacts, alliances, kingdoms and markets. Villages are founded during play, kingdoms form and markets are built only in the Living world. Deals bundle up to 3 goods and 3 kinds of payment (your own offers up to 4 items per side). Goods are carried by hand; there are no roads or vehicles.
- **Houses use a few fixed templates** (with rotation and flexible slots), not free-form or multiroom architecture. Renovation upgrades parts in place; it doesn't change the floor plan.
- **Data mods compose supported behaviours** (registered job givers, need behaviours, recipes, techs, templates, AI weights and policy). New algorithms need a future scripting API; uploaded JavaScript is never run.
- **Combat (stages 1–3):** nobody dies yet, and there is no direct control of characters.
- **Not simulated yet:** death, mood, relationships beyond parents, marriage, animals, weather (beyond seasons and temperature) and roads. Roofs are cosmetic; walls and doors make rooms.
- **Markets:** few trades between AI villages use market prices, because AI villages rarely meet each other (on seed 7 with 30 villages, 7 of 81 trades in 60 days). In the Living world, gluts such as beans and potatoes sit at the 0.5× floor. The 60-day Living world run with 30 villages took 1.28–1.29 ms per tick against 1.08–1.10 ms before markets (+17–19%). The worlds differ (39 against 38 settlements, 81 against 68 trades) and a profile put the market code at 0.2% of CPU, so the extra time looks like the busier world, but a deeper profile is still open. Not checked in a browser yet: a market built by AI play (only one placed by hand), the 1024 px layout, and the market card in the Colony tab.
- **Research content:** 25 core technologies across four eras (Trade routes only in the Living world); the last era (Modern infrastructure) can be reached but has no technologies of its own yet.
- **Mod icons and images:** imported (browser) mod packages can choose from the built-in icon set via `render.icon`, but can't ship their own images yet.
- **Storage:** browser saves use `localStorage` (about 5 MB).
- **Map size:** up to 544×408 (Colossal). On Huge and Colossal worlds, distant villages run at a lower level of detail, with the simplifications listed under "Big worlds and the living world". There is no path caching or coarse region graph: long trips use the ordinary (now faster) tile search. The New colony dialog offers five fixed sizes; there are no custom or infinite maps.
- **World view:** territories, flags, kingdoms, people and caravans; no roads or armies on it yet.
- **Kingdoms:** no rulers, succession or rebellion yet (Phase 6); a member only leaves by the daily rules. In the 60-day Living world runs (Colossal, seed 7) no village left a kingdom and none was dissolved, so leaving has been checked by tests only. Not checked yet: how long the kingdom-coloured overlay takes to rebuild on Colossal, the map redrawing live when a member leaves, the layout at 1024 px wide, and the capital banner near the top edge of the screen (it moves under the village label when there is no room above).
- **Living world:** distant villages cannot meet by sight, so far-apart villages rarely make contact (on seed 7 after 60 days: 12 of 78 pairs with 12 villages, 21 of 465 with 30). Each profile has 6 village names; beyond that names repeat with a number ("Willowmere 25"), and daughter villages without a free name are called "New <parent>". Villages grow slowly: the founding rules were tuned so that villages are founded within 60 days, but villages only reach about 5–7 people by day 30.
- **Performance:** one planner site search (for a Lecture hall, with 12 villages on seed 7) takes about 46–50 ms on the same tick every run. This is older code, not part of founding, and is still open.
- **Alliances:** a defending ally only turns hostile; whether it raids is left to the normal raid rules (full-detail villages only). In the verification runs (40 days, seed 4242 Modern, Living world Colossal with 30 villages for 10 days) no war happened, so alliances at war have only been checked by tests (`tests/alliances.test.js`), not seen in a long run.
- **Interface:** the clock shows no weather (there is none), and the portrait bar shows health but no mood (not simulated). Three hover-card texts have not been seen in a browser yet (see "Hover card").
- **Sound:** not yet listened to by the developer in a real browser; only the planning side is tested (headless). There are no weather sounds beyond wind and cold (there is no weather). The bells for a founded village play only at world creation: a village founded during play gives the good-news notes, not the bells. The collapse bells stand in for a death cue until death exists (Phase 5).
- **Balance:** tuned lightly. With an "Advance to Modern" goal, seed 4242 reaches the Modern era on day 37. Its first machines come 11–16 days after Electricity (day 32.7: generator day 43.3, machine workbench 48.3, sawmill 51.8), because iron is short.

## Layout

```
index.html, src/ui/      UI: main.js, overseer.js (tabs, clock, portraits, letters, work grid, World tab),
                         minimap.js, panels.js (safe HTML builders), html.js (escaping), render.js, sprites.js,
                         people.js, icons.js, hover.js, storage.js, worldview.js (world view helpers),
                         letters.js (which events become cards, timers, grouping),
                         hoverfields.js (hover-card field registry),
                         soundplan.js (pure sound planning), sound.js (Web Audio), style.css
src/sim/                 simulation: game.js, planner.js, research.js, construction.js, farming.js, goals.js,
                         explain.js, save.js, savecodec.js (compact saves), migrate.js, reconcile.js,
                         worldgen.js, lod.js (level of detail, caravans), founding.js (villages founded
                         during play), kingdoms.js, markets.js, plancodec.js (plans in saves), ...
src/sim/ai/              colonists: ai.js, givers.js, jobs.js, needs.js
src/sim/content/         registry, schemas (types.js), mod loader, template validation, behaviour hook names
mods/                    core, example_pottery, example_herbalism
tests/                   node:test suites (colony, recovery, reliability, research, saveload, goals_and_mod, mods)
docs/                    ARCHITECTURE.md, MODDING.md, ROADMAP.md, screenshots/
```
