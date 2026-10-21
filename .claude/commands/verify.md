# Verification Loop

Run this before every commit or PR. Execute each step in order and stop on first failure.

## Steps

1. **Type check**: Run `npx tsc --noEmit`. Filter out `.next/` errors (stale generated types). Any `src/` errors = FAIL.

2. **Lint check**: Run `npx eslint .` if eslint is configured. Skip if no eslint config exists.

3. **Build check**: Run `npx next build` only if specifically requested (takes longer). Otherwise skip.

4. **Security scan**: Check for:
   - The database vendor's admin key, or any other secret, in a file other than the one server-only module that reads it and the git-ignored env files
   - Any `dangerouslySetInnerHTML` usage
   - Any new server actions missing the project's auth check
   - Any `console.log` that might leak sensitive data

5. **Diff review**: Run `git diff --stat HEAD` and scan for:
   - Any `.env` files being staged (should be gitignored)
   - Any files over 500 lines being created (might need splitting)
   - Any TODO or FIXME comments that should be tracked

6. **Changed-scope e2e**: if the diff touches `tests/e2e/**`, `src/app/**`, or `src/components/**`, run `./scripts/run-changed-e2e.sh` before push. Opt-in auto-enforcement via `git config core.hooksPath .githooks` covers a feature/hotfix push only: an all-dev push never gates on it, and `/push` runs it BESIDE a dev push in a clean worktree, non-gating, fixing and re-pushing on a red (`/push` D2b). Escape hatch: `SKIP_E2E_HOOK=1 git push` or `./scripts/run-changed-e2e.sh --all` for the full suite. Not required for docs-only or config-only commits.

7. **Report**: Summarize results as PASS/FAIL with specific issues to fix.
