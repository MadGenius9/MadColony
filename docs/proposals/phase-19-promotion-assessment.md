# Phase 19: promotion assessment of PR #1 (cloud copy, 2026-11-04)

The owner's Phase 19: "assess PR #1 at promotion, don't blindly merge it". This is the assessment. Nothing has
been merged.

## The pull request
- **PR #1:** `cloud-work` → `main` (MadGenius9/MadColony), open.
  - Its title still says "Cloud work: core test suite, tools and Phase 5"; it now holds far more.
  - 275 commits since the branches split (1f73174); 203 files changed, +27,950 / −455. Of that: `src/sim` 80
    files (+9,000), `tests` 46 files (+7,102, all `tests/cloud-*.test.js`), the rest docs, data and tools.
- **Main has moved since:** one commit, cfa5d44 "Reorganize ROADMAP.md into cleaner milestone-focused
  priorities" (MadGenius9, 2026-11-01), which rewrites `docs/ROADMAP.md` (+133 / −688).
  - **The PR cannot merge cleanly:** `cloud-work` changed the same file heavily (Phases 11–19, results of each
    phase).
  - **Resolved 2026-11-05:** main was merged into `cloud-work` (a merge commit). The roadmap keeps main's
    structure; the cloud results and the owner's Phases 16–19 were added to it, nothing of main's removed. The
    old long phase list and the "Detailed notes" section, which main had dropped, stay dropped; their cloud
    updates (the mods decision, cold storage, forestry) are in the new "Built in the cloud copy" section.

## What the branch contains (built and tested in the cloud copy; the UI is home work)
- **Engine:** Phases 5, 5b, 6, 7, 8, 8b, 8c, 9, 10, 11–15 (their cloud parts), forestry, cold storage, the scale
  work, and Phase 18 slices 1–2.
- **Save formats** up to 45, each with a migration step and checks; old saves load (tests).
- **Tests:** 338 in `tests/cloud-*.test.js`, all passing on the branch head.
- **UI notes** for everything the player must see: `docs/ui-todo.md`. No UI code changed: the rescue copy has
  none.

## Gates before promotion (to be checked at home)
1. **The roadmap conflict** (resolved in the cloud on 2026-11-05 as suggested below; the owner should check
   the result). Two roadmaps existed:
   - main's reorganized one, a short priority list. It puts "Visual clarity and feedback" next, and has no Phases
     11–19 or their results;
   - the branch's, which extends the old phase list with every phase's results and the owner's Phases 17–19.

   Merging needs one of them as the base, with the other folded in. Suggested: keep main's structure, and carry
   over from the branch the "Done" lines (with links to the design notes) and Phases 16–19, so no result is lost.
2. **The UI:** the branch changes `src/sim` only. The home build (`src/ui`, `index.html`) must load these saves
   and show the new state; `docs/ui-todo.md` lists what. The home tests (not in the rescue copy) must pass with
   the new engine.
3. **Baselines:** the classic hashes have changed many times, each recorded as proposed in
   `docs/cloud-baseline.md`. Latest: `forty` e340696c71f36c9d, `modern` 1194e9931714f31c (modern era on day
   41.51). They need the owner's review.
4. **Open owner decisions:**
   - village growth (kept off: the grown world's p95 is about 20 ms against 16.7);
   - the Phase 3 design note (at home) for its slices 5–6;
   - whether sleepers' waking reach (12 tiles) suits;
   - the wolf balance points in the Phase 9 note.
5. **Performance on the home machine:** the Phase 18 baseline matrix (browser, frames) has not been run; the cloud
   numbers are simulation only.

## Recommendation
Do not merge PR #1 into main as it stands. At home:
1. check the merged roadmap (gate 1, merged in the cloud);
2. bring the branch into the home project as the patches CLAUDE.md describes, and run the home tests and the
   browser build;
3. review the baselines;
4. then merge (or rebase the home result onto main) as one reviewed step.

The PR's title and description should be updated to say what it holds; done from the cloud the same day.
