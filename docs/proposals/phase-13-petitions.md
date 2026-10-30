# Phase 13: need-driven prayers and petitions

Status: **design, waiting for the owner's answers** (2026-10-30). Branch `cloud-work` (cloud rescue copy; see
CLAUDE.md). Scope: the roadmap's Phase 13 (owner, 2026-10-29), the first slice of worship. The rescue copy has
no fuller worship plan, only the roadmap lines ("worship and favour coming from villages", Later). If one
exists at home it is linked here and its open questions stay the owner's; nothing below decides them.

## Goal
Villages ask the gods for help when something real is wrong, the player answers with a power that already
exists (or dismisses or ignores the request), and the petition ends sensibly when things change. No quests, no
rewards, no free goods: an answer works through the simulation like any other use of the power.

## What exists today (and can be read cheaply, for distant villages too)
- **Food:** each village plan's `foodDays` (planner.js).
- **Monsters:** monsters near a village are noticed daily ("A Thornback was seen near X", monsters.js).
- **Trees:** the law review already counts grown trees within 12 tiles of the centre (civreview.js, "few
  trees" at 5 or fewer).
- **Drought:** only the drought power makes one (weather.js areas); there is no natural drought.
- **Mood:** thirst and other needs as thoughts (mood.js).
- **Powers that can answer:** bless (work and growth), rain, banish (monsters), shape (the forest brush),
  peaceful animals.
- **The chronicle** (Phase 12) for events and links; `s.god.log` for the powers used.

## Design
### Petition kinds as data (`mods/core/content/petitions.json`, a new type `petitionKind`)
Each has a name, the powers that answer it, how long it stays open (`days`) and a cooldown per village
(`cooldownDays`). When it applies is decided in code by its id (like thoughts in mood.js).

| Kind | Raised when (checked daily) | Answered by | Ends by itself when |
|---|---|---|---|
| Hunger | food for under 2 days and nothing near harvest | bless, rain | food for 4+ days |
| Drought | the village centre in a drought area | rain | the drought ends |
| Monster | a monster seen within 20 tiles in the last day | banish | no monster within 20 tiles for 2 days |
| Lost woods | 5 or fewer grown trees within 12 tiles | shape (forest) | 10+ trees again |

### A petition (save format 35, `s.petitions`)
- `{ id, sid, kind, since, until, evidence, status, ev }`.
- **evidence:** the numbers behind it, as recorded when raised ("food for 1.4 days, 6 people").
- **status:** open, answered (a matching power used on the village while it was open; linked to that power's
  chronicle event), resolved (the condition went away on its own), dismissed (by the player), expired.
- **Chronicle:** raising and closing are chronicle events (`core:petition`, `core:petition_closed`); a
  closing by an answer has the power's event as its cause.

### Limits
- **One open petition per village;** a cooldown per village and kind after it closes.
- **A world cap:** at most 1 open petition per 40 living people (at least 1), the most urgent first.
- **No duplicates:** the same village and kind never opens twice while one is open.

### What answering does (and does not do)
- The power acts as it already does. The petition only records that it was answered.
- No goods, favour or mood are given for answering (see question 3).

## Slices
1. Petition kinds, raising, ending by itself, expiry, the limits; format 35; chronicle events.
2. Answers (a matching power closes it, linked), dismissing; the reading API; UI notes.
3. Acceptance: a World run (petitions arise, close, no spam, save and load), classic runs, bench, docs.

## Not in it
A full religion, favour income from villages, temples, priests, quests or rewards.

## Open questions for the owner
1. **Who prays:** every village (the gods hear the whole world; proposed, within the caps) or only yours?
2. **Notifications:** petitions from your village notify (proposed); from other villages only in the list?
3. **An answered prayer and mood:** should the village feel it ("Our prayers were answered", a small good
   thought for a few days), or nothing at all in this phase (proposed: nothing, to avoid rewards)?
4. **The kinds:** hunger, drought, monster, lost woods. Add or drop any? (Thirst has no power that answers
   it today, so it is left out.)
5. **A home worship plan:** if one exists, it is linked when the home PC is back, and this design follows it.
