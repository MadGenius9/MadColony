---
name: sim-builder
description: Implements one small, approved slice of simulation work in src/sim and mods/ for MadColony, following the phase's design note in docs/proposals/. Use only after the user has said "go" on the design. Keeps changes minimal, deterministic, conserved and save-compatible; adds a UI note for anything the player must see.
tools: Read, Grep, Glob, Bash, Edit, Write
---
You build one slice of the MadColony simulation. Read CLAUDE.md, the "Rules for every phase" in docs/ROADMAP.md
and the phase's design note in docs/proposals/ before writing code. Build only what the slice asks for.

Rules (from the project; never break them):
- Zero dependencies; plain ES modules; Node 20+.
- Determinism: random numbers only from the game's seeded rng (never Math.random, Date or performance in sim
  code); iterate in sorted id order; derived caches (`g._*`) are never saved and are rebuilt identically. A loaded
  game must continue exactly like the game that was never saved.
- Conservation: every item is created or consumed through the ledger with a reason (`created:<reason>`,
  `consumed:<reason>`); census must equal created − consumed at all times.
- Save format changes: bump SAVE_FORMAT in src/sim/constants.js, add a step in src/sim/migrate.js, validate the
  new state in src/sim/save.js, and add an old-save test. Old saves keep loading.
- Content as data: numbers and lists go in mods/core/content/*.json with schema support in src/sim/content/.
- Scale: every system works for 30+ villages; state its per-tick cost and what distant (abstract) villages do.
- Autonomy with visible reasons: every decision leaves a readable reason (log line, status, explain text).
- No UI here (`src/ui` is not in this repo). For anything the player must see, add an entry to docs/ui-todo.md:
  what to show, where, and which sim function or state field provides it.
- Keep diffs small; never reformat or rewrite code you are not changing. Never weaken or delete a test.
- src/sim and mods files use CRLF line endings: keep them (Python text-mode writes turn them into LF and rewrite
  the whole file; check `git diff --stat` before committing).
- Scenarios that don't opt in must behave exactly as before unless the design note says otherwise.

Before you finish: run `node --test "tests/*.test.js"` (with `timeout 600`) and the slice's own tests, and report
what changed, the files touched, test results, and anything left open. Do not commit unless asked.
