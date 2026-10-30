# Phase 12: connected world chronicle

Status: **design agreed; slice 1 in progress** (2026-10-30). Branch `cloud-work` (cloud rescue copy; see
CLAUDE.md). The scope is the roadmap's Phase 12 (owner, 2026-10-29). It builds on the existing log; it is not
a second event system.

## Goal
- **Explain how events relate:** stable event ids, time, the villages, people and place, and cause links
  only where the simulation knows them.
- **Chains only from recorded links;** associations labelled as such, never "caused".
- **Filters:** village, person or family, kingdom, category, time. Follow and favourite; a jump to the
  subject or place.
- **Bounded storage:** keep milestones, summarise old routine events, no duplicate floods.
- **Acceptance:** one meaningful chain is understandable in the UI, survives save and load, and does not
  flood the player.

## What exists today
- **The log** (`game.js log(msg, cat, key, cooldown)`): `s.log` entries hold `{ t, msg, cat }`.
  - The categories are warn, info, trade, good, build, research, goal, food, god and a few more.
  - A `key` with a cooldown stops repeats (`s.logKeys`).
  - The newest 500 are kept.
  - 154 places write to it.
- **No separate letters:** "letters" are warn lines in the same log.
- **The god powers' own record:** `s.god.log` (the newest 500 commands and their results).
- **Reasons already recorded elsewhere:**
  - relations keep their last 16 changes with reasons;
  - laws keep the day they were passed (`codeSince`) and a reason in the log line;
  - unrest keeps the tick it began;
  - wars keep `aggressor` and `warSince`;
  - death records keep cause and tick;
  - trades keep a reason ("Tribute to X", "Tithe to X").
- **Things the simulation does not know** (and so must not be claimed): why a village lacked timber
  (beyond "no reachable trees" in its plan), or whether a war was "about" a law.

## Design

### Events: the log, with more fields (save format 34)
- **The same calls:** `g.log(msg, cat, key, cooldown, ev)`, where `ev` is optional:
  - `kind` (an event type from data, e.g. `core:war_declared`);
  - `sids` (villages), `cids` (people), `at { x, y }`;
  - `cause` (an earlier event's id, only when the code holds it);
  - `rel` (an association, labelled "followed", never "caused").
- **Ids:** every line with `ev` gets a stable id `e<n>` from a saved counter. Lines without `ev` stay as
  today (routine).
- **Event kinds as data** (`mods/core/content/chronicle.json`): name, category, importance (routine,
  notable, milestone), and whether it notifies.
- **First milestones:**
  - war declared, peace, conquest, a village fallen;
  - a village founded (daughter or divine), a kingdom formed, joined or left;
  - a law passed or repealed (with its recorded reason);
  - unrest begun, a family leaving;
  - a plague outbreak, a monster slain or a lair cleared;
  - a god power used;
  - the death of a person the player follows.

### Cause links, only where the code knows them
| Event | Its cause link |
|---|---|
| A law passed for war (militia) | the war's declaration event (kept on the relation) |
| A law repealed by unrest | the unrest's start event |
| A family leaving | the unrest's start event |
| A tithe sent | the law event that set the tithe |
| A village joining a kingdom by conquest | the conquest event |
| Peace | the war's declaration event |
| A war declared by rivalry | the last recorded dispute event between the two villages (a covet, rights refusal or seizure), if any; else none |
| A god power's effects (a fire's spread, a plague's deaths) | the power's event |

- **Associations** ("followed"):
  - a law passed for "few trees" and, later, that village's first "no reachable trees" plan note;
  - a famine and later deaths in that village.
- **The example chain** (forest depletion → protection law → timber shortage → trade dispute → war) is
  shown only as far as each link is recorded. For instance: law (reason: few trees) → rights request
  refused (recorded) → relation fall (recorded reason) → war (rivalry; linked to the last dispute). The
  timber shortage itself is an association, from the plan note.

### Retention (bounded)
- **Routine lines:** as today, the newest 500.
- **Notable and milestone events:** a separate cap (e.g. 2,000 entries) in the same array, kept while routine
  lines roll off.
- **Old milestones** beyond the cap fold into one summary entry per year and village ("Year 3 in Marshby: 2
  wars, 3 laws, 1 plague"), with their ids kept so chains still resolve to "summarised".
- **Size:** a check in the World run (save size and the number of entries).

### Reading it (for the UI)
- `chronicle.js`:
  - `eventsOf(g, { sid, cid, kingdom, kind, cat, from, to })`;
  - `chainOf(g, id)`: the recorded causes back and the known effects forward, each step marked "recorded"
    or "followed";
  - `subjectOf(g, id)`: where to jump.
- **Follow and favourites:** where they are kept is question 1.
- **Notifications:** an event notifies when its kind says so and it concerns the player's village or
  something followed. Duplicates merge (the existing keys).

## Slices
1. **Structured events:**
   - `ev` on the log, with ids and kinds as data;
   - the milestone call sites (about 30 of the 154);
   - retention and summaries;
   - save format 34.
2. **Cause links** where known, and associations.
3. **Reading:** filters, chains, subjects; follow and favourites; notification rules; UI notes.
4. **Acceptance:**
   - a World run that finds and prints one real chain;
   - save and load identical;
   - the size check;
   - classic runs, the bench, README and roadmap.

## Open questions
1. **Follow and favourites:** kept in the save (they travel with the game; proposed), or in the UI only?
2. **Retention:** the newest 500 routine lines plus up to 2,000 notable and milestone events, and older ones
   summarised by year and village. Are these numbers right?
3. **Milestones:** is the list right? Add or drop any (births, a person's first skill level 10, records)?
4. **Notifications:** only for the player's village and followed subjects (proposed), or also world news
   (any war, any fallen village)?

## The owner's answers (2026-10-30)
1. **Follow and favourites** (explained: *follow* marks a village, person or family so its events stand out and
   can notify you; a *favourite* bookmarks one event or chain to find again). No preference given, so: kept in
   the save, as proposed (`s.chronicle.follow`, `s.chronicle.favs`), so they travel with the game.
2. **Retention:** "not sure", so the proposed numbers stand: the newest 500 routine lines, up to 2,000 notable
   and milestone events, older ones folded into yearly summaries per village. The World run's size check
   (slice 4) tests them; they are constants, easy to change.
3. **Milestones:** "sure, unless it's too much info". The list stands. To keep it light: no births, no skill
   records, no "first" records; only milestones notify, and repeats merge (the existing keys).
4. **Notifications:** "maybe just world news". An event notifies when its kind is marked `notify` (world-level
   milestones: wars, peace, conquests, fallen villages, new kingdoms, plague outbreaks, god powers, and laws or
   unrest in the player's own village). Followed subjects add their milestones. Routine and notable events never
   notify; they stay readable in the chronicle.

## Results

### Slice 1: structured events (built and tested, 2026-10-30)
- `g.log(msg, cat, key, cooldown, ev)` returns the new event's id; 26 kinds in `mods/core/content/chronicle.json`;
  29 milestone lines carry them. Retention as agreed; `s.chronicle { next, years, folded }`; save format 34.
- Gameplay unchanged: the state hash without the log is equal before and after (`docs/cloud-baseline.md`).

### Slice 2: cause links (built and tested, 2026-10-30)
Where the event id is kept (all optional, saved, format 34): `relation.warEv` (the war's declaration, or the
joining line for a village that joined), `relation.lastEv` (the last recorded relations change, refused
gathering rights or war threat between the pair) and `settlement.codeEv { law: id }` (the line that set each
law not at its default).

| Event | Link | Kind of link |
|---|---|---|
| Peace (relations leave hostile) | the war's declaration | cause |
| Joined a war | the declaration of the war it joined | cause |
| Conquest, sack, the conquered village joining a kingdom or forming one | the war's declaration | cause |
| A village fallen to a war | the declaration of that war | cause |
| An AI village's militia law ("it is at war") | the declaration of its first war on record | cause |
| A tithe sent | the capital's tithe law line | cause |
| A family leaving | that day's unrest line (the warning or the repeal), when there is one | cause |
| A war declared | the pair's last relations change, refusal or threat | association ("followed") |

Changed from the design table: conquest-related kingdom joins link to the war's declaration (the conquest line
is written after the join). **Not linked, because the game does not record it:** a god power's later effects
(a fire's spread, a plague's deaths: deaths record their cause kind, not the power), a famine and later
deaths (there is no famine event), and a "few trees" protection law and a later timber shortage (the shortage
is a plan note, not an event). These stay unlinked rather than guessed.
