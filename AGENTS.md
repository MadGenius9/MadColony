# Shared editing rules

Work on `cloud-work`; this rescue copy is merged home as patches. Read `CLAUDE.md`
for the project context and existing workflow, and any more-specific instructions.

- Before editing, inspect the target and `git status --short`, `git diff`, and
  `git diff --cached`. Record pre-existing work; do not claim or undo others' edits.
- Make the smallest targeted patch that meets the request. Preserve unrelated
  bytes, indentation, ordering, encoding/BOM, each file's LF/CRLF convention, and
  final-newline state. Do not reserialize a whole JSON/data file to add one item.
- No incidental formatting, import sorting, generated-file regeneration, or
  repository-wide line-ending normalization. Do not change Git EOL settings.
- After each edit, inspect its diff. Before committing, review `git diff --stat`,
  the full diff, and the staged diff; run `git diff --check`, the diff guard below,
  and relevant tests. Unexpected whole-file churn is a reason to stop and repair
  only your own changes, not to blindly revert/reset/stash a shared file.
- If a whole-file rewrite/refactor is genuinely necessary, explain why a targeted
  patch cannot do the job, identify affected files, and separate unrelated work.
  Review and justify guard findings explicitly; never weaken the guard to pass.
- Commit only intended files. Preserve concurrent work and never force-push.

Run `npm run check-diff` before staging, then `npm run check-diff -- --staged`
before committing. For a finished slice, use its recorded starting commit:
`npm run check-diff -- --base <start-sha> --head HEAD`.
See [the guard guide](docs/edit-guard.md) for ranges, intentional exceptions and limits.
