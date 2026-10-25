# MadColony — cloud rescue copy

This repo is a RESCUE COPY of MadColony, made 2026-10-24 from the owner's home PC, which is out of reach until
about 2026-11-08. It holds the complete simulation engine (`src/sim`), all game data (`mods/`), README.md,
docs/ROADMAP.md, docs/PERFORMANCE.md, one design note and a few tools. It does NOT have `src/ui`, `index.html`,
`tests/`, most tools, most docs, or the home agents and skills. Everything done here is merged back into the
real project as patches, so:

- Work on the branch `cloud-work`. Keep changes small; never reformat or rewrite files without a reason.
- Do not rebuild the UI. For every feature the player must see, add a note to `docs/ui-todo.md` saying
  what the UI must show.
- New test files are named `tests/cloud-*.test.js` (run with `node --test "tests/*.test.js"`).
- Commit and push after every finished slice; unpushed work is lost when a cloud session ends.

## The plan
Follow docs/ROADMAP.md. Read its "Direction" section (including the 2026-10-24 updates), the rules for every
phase, "How a phase runs" and the phase order before any work. One phase at a time; start each phase with a
design note in docs/proposals/<phase>.md. The next phase is Phase 5 (see the 2026-10-24 direction update).

## Long runs
Every command that can take over a minute runs with a time limit (e.g. `timeout 600 node ...`) and prints
progress at least every 10 s; runs over 2 minutes go in the background; only one heavy run at a time. On a
timeout: read the output tail, rerun once alone, then a smaller version, and report what got stuck.
