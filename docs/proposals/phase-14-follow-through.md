# Phase 14: intervention follow-through

Status: **design decided, slice 1 in progress** (2026-10-31; the owner: "You make the decisions"). Branch
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
