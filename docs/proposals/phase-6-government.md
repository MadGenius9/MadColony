# Phase 6: government

Status: **design** (2026-11-02; the owner: "You decide and keep going"). Branch `cloud-work`. The roadmap's
Phase 6: "Village council and policies that change real decisions (food reserves, research, trade, work
allocation, public building), leadership and succession, laws and taxation; kingdoms get a ruler and
succession; member villages can rebel with visible causes." It extends what exists. It is not a second law
system, event log or mood.

## What exists already (and is extended, not replaced)
- **Laws and taxes:** civilization laws (`civlaws.js`: a code per village, kingdom laws set by the capital, the
  5-day wait, reviews every 10 days with reasons); the tithe is the kingdom's tax (`tithe.js`).
- **Policies:** each village's policy (`policyFor`: the profile's `policy`, overridden by `settlement.policy`):
  food days, meals, stock targets, researchers, population cap. The planner reads them.
- **Kingdoms:** formed, joined and left, with capitals that move when the old one falls (`kingdoms.js`); members
  leave when relations with the capital sour.
- **Reasons and history:** mood and unrest (`mood.js`, `unrest.js`), memories and traditions (`memories.js`),
  the chronicle with cause links (`chronicle.js`).

## Design (decisions)
### 1. A leader for each village, and succession
- Each village has a leader: an adult of the village, chosen by its people's way. By default the eldest adult;
  a people may name another rule in data (`people.leader`: `eldest`, `wisest` (the most skilled), `bravest` (the
  best fighter)).
- A new leader is chosen when the leader dies, leaves or the village changes hands, and that is a chronicle
  event (`core:leader`), with the death or move as its cause.
- A kingdom's ruler is its capital's leader; a new capital or a new leader there means a new ruler (a
  `core:ruler` event).
- Saved: `settlement.leader` (a colonist id) and `leaderSince`. Format 38.

### 2. The council: policies that change real decisions
Every 10 days, with the law review, an AI village's council may move its policy by one step within bounds,
each with a recorded reason, and only from things the game already measures:

| Policy (`settlement.policy`) | Raised when | Lowered when | Bounds |
|---|---|---|---|
| `foodDays` (food reserve) | a famine memory, or food under 2 days at the review | 20 days with food over twice the reserve | 2–10 |
| `maxResearchers` | many idle workers and nothing short | food short | 0–4 |
| `stock` of wood or stone | a building held up by that material | stock over twice the target for 20 days | 0.5×–3× the profile's |

- Each change is a log line and a chronicle event (`core:policy`), with its reason and cause (the memory or the
  recorded shortage).
- The player's village is never changed by the council: its policies are the player's (as with laws), and the
  UI shows the council's advice.

### 3. Rebellion, with visible causes
- A member village may rise against its kingdom when its grievances pass a threshold. All are already measured:
  - the tithe paid in the last 30 days;
  - unrest (`settlement.unrest`);
  - a war of the kingdom it was pulled into;
  - a capital of another people;
  - relations with the capital.
- A rebellion is leaving the kingdom (`leaveKingdom`) with the grievances listed, and relations with the capital
  falling. A war follows only through the existing rivalry rules.
- Bounded: at most one rebellion a kingdom per 20 days; the capital never rebels.

### 4. Civic budgets (from civic planning)
Parked again. They need the public-building policy to exist first; they are noted for a later slice.

## Not in it
Elections and parties, nobles, a separate tax system (the tithe is the tax), assassinations, and a council that
changes laws (laws keep their own review).

## Slices
1. Leaders and succession, rulers; format 38; chronicle events; tests.
2. The council's policy steps, with reasons; tests (bounds, reasons, the player's village untouched).
3. Rebellion with grievances; tests.
4. Acceptance: a World run (leaders change, policies move for clear reasons, rebellions are rare and
   explained), save and load, classic runs, bench, docs and UI notes.

## Results
### Slice 1: leaders and succession (built and tested, 2026-11-02)
- `src/sim/leaders.js`: `chooseLeader`, `tickLeaders` (daily, the last day-start job), `leaderOf`, `rulerOf`.
- `people.leader` in `peoples.json`: Hearthfolk and Duneshade the eldest, Reedkin the wisest, Cragborn the
  bravest. Chronicle kinds `core:leader` (news for the player's village) and `core:ruler` (world news). Save
  format 38.
- Tests: `tests/cloud-leaders.test.js`.
- **Gameplay unchanged** (leaders decide nothing yet): the hash without the log and the new fields is equal to
  the code before (`forty` daf1398fa99f1205), and the World seed 11 run's day-200 numbers are identical (270
  people, 46 wars declared, the same traditions).
- In that run: 23 successions and 4 new rulers in 200 days.
- **Full hashes** (they include the new fields), proposed with the spreading baselines, awaiting review:
  `forty` 9151d4cab0134351, `modern` 17120b8380963d4a.
