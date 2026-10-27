# Verification Loop

Run this before every commit or PR. Execute each step in order and stop on first failure.

## Steps

1. **Type check**: Run `npx tsc --noEmit`. Filter out `.next/` errors (stale generated types). Any `src/` errors = FAIL.

2. **Lint check**: Run `npx eslint <the changed .ts/.tsx/.js/.mjs/.mts files>` (the config is `eslint.config.mjs`; Next 16 has no `next lint`). Check for the config with `test -f eslint.config.mjs`, never a glob list: in zsh one unmatched glob (`.eslintrc*`) aborts the whole `ls` and prints nothing, which reads as no config. An empty changed-file list skips the step with the reason `no code files` (a bare `npx eslint` lints the whole repo). A skip names its reason in step 7.

3. **Build check**: Run `npx next build` only if specifically requested (takes longer). Otherwise skip.

4. **Security scan**: Check for:
   - The database vendor's admin key, or any other secret, in a file other than the one server-only module that reads it and the git-ignored env files
   - Any NEW `dangerouslySetInnerHTML` whose value is not `JSON.stringify(...).replace(/</g, "\\u003c")` inside a `<script type="application/ld+json">` (the house JSON-LD pattern; a bare `JSON.stringify` does not escape `</script>`, so user text in the object breaks out; any other use with user-supplied content is forbidden)
   - Any new server actions missing the project's auth check
   - Any `console.log` that might leak sensitive data

5. **Diff review**: Run `git diff --stat HEAD -- <your paths>` over the files this commit will declare, never over the whole worktree: it is shared, and a bare `git diff --stat HEAD` lists other sessions' uncommitted files as if they were yours. Not `git diff --cached`: `scripts/safe-commit.sh` stages your paths itself at commit time, so the index is empty while you verify. New files are untracked until `safe-commit.sh` stages them, so `git diff` cannot list them: for the 500-line and `.env` checks also run `git ls-files --others --exclude-standard -- <your paths> | xargs wc -l` (never `git add -N`, which writes the shared index). Scan for:
   - Any `.env` files being staged (should be gitignored)
   - Any files over 500 lines being created (might need splitting)
   - Any added `TODO` or `FIXME` comment that should be tracked (both words, over ADDED lines only, case-sensitively: `git diff -U0 HEAD -- <your paths> | grep '^+' | grep -nE '\b(TODO|FIXME)\b'`; a case-insensitive match also hits every mention of `todo.txt`)

6. **Changed-scope e2e**: if the diff touches `tests/e2e/**`, `src/app/**`, or `src/components/**`, run `./scripts/run-changed-e2e.sh` before push. Opt-in auto-enforcement via `git config core.hooksPath .githooks` covers a feature/hotfix push only: an all-dev push never gates on it, and `/push` runs it BESIDE a dev push in a clean worktree, non-gating, fixing and re-pushing on a red (`/push` D2b). Escape hatch: `SKIP_E2E_HOOK=1 git push` or `./scripts/run-changed-e2e.sh --all` for the full suite. Not required for docs-only or config-only commits.

7. **Report**: one line per step — `tsc PASS|FAIL (<n> src/ errors)`, `lint PASS|FAIL|SKIPPED (<reason>)`, `build SKIPPED|PASS|FAIL`, `security CLEAN|<n> hits, each read: <disposition>`, `diff CLEAN|<what>`, `e2e RAN|NOT IN SCOPE` — so a step that did not run reads as not run, never as passed.
