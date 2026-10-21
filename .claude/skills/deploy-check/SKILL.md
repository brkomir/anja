---
name: deploy-check
description: Pre-deployment verification. Use before pushing code to production — verifies types, tests, migrations, env config, and known issues.
---

# Deploy Check — Pre-Deployment Verification

Comprehensive check before deploying to production. Verifies types, tests, migrations, env config, and known issues.

## When to Use
Before any push to `main` or a promote pull request (since 2026-09-08 `scripts/promote-precheck.sh` runs the same gate the hook would), or before triggering a Vercel deployment.

## Process
1. **Type check:** `npx tsc --noEmit`
2. **Unit tests:** `npx vitest run` — all must pass
3. **Integration tests:** `npm run test:integration` — all must pass
4. **Changed-scope e2e:** `./scripts/run-changed-e2e.sh` — runs only specs affected by this branch's diff vs the shared baseline — `origin/dev` once it exists, `origin/main` before the cutover (per the meta test-cost-aware policy). Automatic at push if `.githooks/pre-push` is enabled. Full suite via `--all` only when deploying infra-level changes.
5. **Pending migrations:** Check if any migration files exist that haven't been applied to staging/prod
6. **Environment config:** Verify all required env vars are set (the email provider's API key, CRON_SECRET, etc.)
7. **Git state:** No uncommitted changes, branch is up to date with remote
8. **Known blockers:** Check todo.txt for any items tagged "blocks deploy" or "blocks launch"

## Output
```
## Deploy Check

| Check | Status | Detail |
|-------|:------:|--------|
| Types | PASS/FAIL | {error count} |
| Unit tests | PASS/FAIL | {pass}/{total} |
| Integration tests | PASS/FAIL | {pass}/{total} |
| Changed-scope e2e | PASS/FAIL/SKIP | {N specs run, or "no e2e-relevant changes"} |
| Pending migrations | PASS/WARN | {list if any} |
| Env config | PASS/WARN | {missing vars} |
| Git state | PASS/WARN | {uncommitted files} |
| Known blockers | PASS/FAIL | {blockers from todo} |

VERDICT: READY / NOT READY
```
