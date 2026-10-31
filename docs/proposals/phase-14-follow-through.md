# Phase 14: intervention follow-through

Status: **cloud part done** (2026-10-31; built and tested, not playable until the UI is wired at home; the owner: "You make the decisions"). Branch
`cloud-work`. Scope: the roadmap's Phase 14. Builds on the power results (`s.god.log`), the chronicle
(Phase 12) and petitions (Phase 13).

## Goal
After a god power, the player sees what it did (recorded) and, a few days later, what changed in the villages
it touched (followed, with no claim of cause). Nothing is added that would claim "what would have happened".

## Design (decisions)
- **Which villages:** the village a power was aimed at (`settlementId`), else the villages whose centre lies
  within 20 tiles of the point it hit (at most the 3 nearest). A power touching no village gets no card.
- **Before:** measured just before the power acts, per village: food days (its plan), people, grown trees
  within 12 tiles of the centre, living monsters within 20 tiles.
- **After:** the same measures `followDays` later (data: `godRules.followDays`, default 3), plus the deaths
  recorded in those villages since the power.
- **The outcome card** (`s.followUps.cards`, the newest 50): the power, its recorded result (what it returned),
  the petitions it answered, and the changes per village, labelled "changes that followed". A chronicle event
  `core:god_outcome` (milestone; world news, since it is about the player's own act) whose cause is the power's
  event.
- **Cost:** one small record per power used (at most 100 waiting), checked at day start.
- **Save format 36:** `s.followUps { wait: [...], cards: [...] }`, optional.

## Not in it
Counterfactual runs; per-tile history; measures the game does not already keep.

## Slices
1. The records, the cards, format 36, the chronicle event, tests.
2. Acceptance: a World run with scripted powers, save and load, bench, docs and UI notes.

## Results
### Slice 1 (built and tested, 2026-10-31)
`src/sim/followup.js` (`villagesOf`, `measure`, `beforePower`, `afterPowerFollow`, `tickFollowUps`,
`outcomeCards`), hooked through `g.beforePower` / `g.afterPower` in god.js; `godRules.followDays` (default 3);
chronicle kind `core:god_outcome`; save format 36. `answerPetitions` now returns the ids it answered, kept on
the card. Tests: `tests/cloud-followup.test.js` (a card with its
before/after, links to the power and the prayer, save and load while waiting; no card without a village; old
and bad saves).

### Slice 2: acceptance (2026-10-31)
- The powers run (`tools/cloud-powers-run.mjs 40 vast 7`, every destructive power and rain, save and load
  after each): ok; 11 powers, 9 outcome cards (2 powers touched no village), none left waiting. Example:
  "4 days after the lightning power: Frostholm: food 5.4 → 11 days, people 3 → 2, 1 died, trees 37. (Changes
  that followed; the game does not know how much the power caused.)" One card shows why the label matters:
  trees near First Hearth fell 13 → 0 after the rain power, because of a later fire.
- The full suite passes; classic runs unchanged without the log.
- Cards arrive at the first day start after `followDays`, so "3 days" reads as 3–4 days after the power.
