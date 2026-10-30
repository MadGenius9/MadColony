# Phase 11: integration and reliability

Status: **in progress** (2026-10-30). Branch `cloud-work` (cloud rescue copy; see CLAUDE.md). The scope is the
roadmap's Phase 11 (owner, 2026-10-29). This phase changes no balance and adds no features.

## 1. A playable build (status: the cloud part only)
- **The UI is not here:** `src/ui` and `index.html` are on the owner's home PC (back about 2026-11-08), so no
  playable build can be made or tested in the cloud copy.
- **What is done here:** `docs/integration-contract.md` lists, phase by phase, what the UI must call, read and
  show, checked against the source, with the save formats 27–33.
- **What happens at home:** merge, run the UI against `cloud-work`, and only then call anything playable.
- **Not done here:** no replacement UI, and no screenshots.

## 2. Goods set aside for a missing mod (status: reproduced and fixed)
- **The suspicion** (from reading `game.js tryRestore`): a map stack set aside on load keeps its village in
  `data.settlement`, but restoring set the owner only from the outer `owner`, which only caravan goods
  carried.
- **Reproduced:** `tests/cloud-orphans.test.js` adds an item as a mod would. An AI village holds 10 of it.
  Loaded without the item, the stack is set aside; loaded with it again, it was restored as `t1`'s, the
  player's.
- **Also found:** fuel, buffers, overflow, ammunition and carried goods set aside from a village recorded no
  owner at all.
- **Fixed:**
  - restoring uses the outer owner, else the stack's own `settlement`;
  - building contents, overflow and people's ammunition and carried goods are set aside with their village
    as `owner`.
- **Tests:** a map stack and a villager's carried goods come back as the AI village's, all of them, with
  items conserved. Both tests failed on the code before the fix.

## 3. Performance baselines (status: planned)
- **A tool** (`tools/cloud-baselines.mjs`) with fixed seeds and sizes, measuring each separately:
  - **terrain-edit latency:** one radius-8 raise and one forest stroke on Vast and World, in a running game,
    the stroke tick and the next 10 ticks;
  - **long ticks:** the 10 slowest ticks of a 60-day World run, with what ran on them (day start, planner,
    rooms, fights);
  - **war cost:** two full-detail villages at war against the same pair at peace, over the same 2 days
    (ms/tick);
  - **animal cost:** the share of `tickAnimals`, hunting and `wolfDanger` in a CPU profile of 20 Vast days.
- **Comparisons only within one session:** this machine's speed varies by about 35% between days (seen
  2026-10-29: the same code ran 1.30 against 0.92 ms/tick at day 100 on two days).

## 4. War frequency and hunting limits (status: planned, report only)
- **Wars:** World seed 11 declared 85 wars in 300 days with peoples, 61 with civilization laws and 101 with
  mood. The report will break that down by cause (rivalry between peoples ×1.5, militias' strength, unrest,
  borders) using the same seed with each factor switched off in a scratch copy. No change to the game
  without the owner.
- **Hunting:** distant villages hunt with one hunter an hour, and full ones arm two hunters. The report will
  give meat's share of food by village size and detail, from the World run's `meatShare`.

## Acceptance
- Reproducible test results; a clear UI and integration status; remaining defects and performance limits
  written down.

## Results so far (2026-10-30)
- **Item 1:** `docs/integration-contract.md` (292 lines) lists the save formats 13–33, all 17 god powers with
  their arguments and previews, the direct calls, what the UI reads per phase, and the new content types.
  - **10 mismatches** between `docs/ui-todo.md` and the code. Fixed here: the format-33 comment. Left for the
    home integration:
    - effect-source lines for traits;
    - the work-speed breakdown;
    - unrest reasons only in the log text;
    - the log has no village field;
    - "since" values are ticks.
  - **4 open questions** for the owner, in the contract.
- **Item 2:** reproduced and fixed (above). 238 tests pass; classic unchanged (`forty` 8345afce244873af,
  `modern` 3db6905a9e1dc4d5).
- **Items 3 and 4:** next.
