# Small-patch guard

The shared rules are in `AGENTS.md`; Claude imports them from `CLAUDE.md`.
The zero-dependency Node 20+ checker is read-only: it does not fix files, install
hooks, change Git settings, or touch game data. No CI exists in this cloud copy;
`npm test` automatically runs the working-tree guard via `pretest`, then includes
its fixture tests in the existing glob. A clean checkout has no working diff;
use an explicit commit range to review committed work too:

```sh
npm run check-diff                          # HEAD -> working bytes + untracked
npm run check-diff -- --staged               # HEAD -> index (what will commit)
npm run check-diff -- --base START --head HEAD # exact completed slice
npm run test-diff-guard
```

Record START with `git rev-parse HEAD` before work. In a dirty checkout, first
record both diffs and run the guard to distinguish existing work from your changes.
Default mode includes all current changes, not just yours. Staged mode excludes
unstaged/untracked work. Commit mode reads Git blobs, not checkout conversions.
For a PR, use its merge-base as START (`git merge-base origin/main HEAD` after
fetching the relevant history); do not blindly compare only HEAD~1 for multiple
commits. Future CI can invoke the same explicit range; missing refs fail, not pass.

When Git treats preserved CRLF as trailing whitespace, use
`git -c core.whitespace=cr-at-eol diff --check` (and `--cached` for the index).
This is a command-scoped check, not a Git configuration change or normalization.

Exit codes: 0 clear/reviewed; 1 findings need review; 2 invocation/Git/read error.
It flags BOM changes, UTF-8 validity or binary/text classification transitions,
final-newline changes, introduced/worsened mixed EOLs and EOL style conversions.
Unchanged pre-existing issues are not blamed on a tiny patch. It also flags
replacement of >=80% of a file with >=50 old lines and >=20 additions, or >=1000
added/deleted lines in one file (including new files). These are review heuristics,
not proof of accidental rewriting. Small rewrites can escape; large valid additions
can be flagged. Binary payloads and legacy encodings cannot be fully analyzed;
UTF-8 validity is not general encoding detection. Existing mixed EOLs use counts,
so relocation or balanced substitutions can escape. Review the actual diff always.
Git submodules are not supported (Git errors fail closed).
Renames are treated as delete/add; symlink working contents are not followed.

For an intentional flagged change, first inspect it and record why it is needed
in the commit/review. A one-run, exact-path allowance requires a concrete reason
and still prints every finding; unused allowances fail. There is no saved ignore
list or global bypass. Example (replace the path and reason):

```sh
npm run check-diff -- --base START --head HEAD --allow 'tools/new-tool.mjs=New standalone tool intentionally adds over 1000 lines; reviewed in full'
```

An allowance acknowledges *all* findings for that file, so inspect each, including
encoding/EOL, rather than assuming the only issue is size. Do not use allowances
to excuse accidental churn. If an intentional finding blocks `npm test`, run the
guard with the reviewed allowance, then `node --test "tests/*.test.js"` explicitly
under the usual time/progress limits; report both results. Do not disable pretest.
No hook can guarantee an agent obeys instructions;
this portable check complements, rather than replaces, patch review.
