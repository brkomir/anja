---
name: fix
description: Fix code issues — audit findings, bugs, regressions, or any targeted code fix. Use when you have a specific finding or bug to resolve and want the orchestrator to plan the fix + run appropriate tests.
---

# Fix Command

Fix code issues — audit findings, bugs, regressions, or any targeted code fix.

## Usage

**Audit findings:**
- `/fix p1s` — Fix all P1 findings from the current/most recent audit
- `/fix p2s` — Fix all P2 findings
- `/fix p1-3` — Fix a specific finding by number
- `/fix quick` — Fix all straightforward items across priorities (skip medium/complex)

**Bugs and regressions:**
- `/fix bug` — User provides screenshot, console logs, or error description. Diagnose → fix → test.
- `/fix <description>` — Any targeted fix described in plain English

**Suite-green loop:**
- `/fix --e2e-loop` — Discover + classify + dispatch + iterate until the full e2e suite is green. Use after a multi-spec regression lands (e.g., Wave-level change to a widely-exercised surface). See "Suite-Green Loop Mode" below.
- `/fix --integration-loop` — Same pattern for `npm run test:integration`. Lower ceremony (see variant notes).

**CI failure triage:**
- `/fix --ci [<run-id> | <PR#>]` — Triage + fix a red GitHub Actions run (auto-detects the latest failed run on the current branch if no arg). For each failed job: map its failing step to a LOCAL reproduction, classify real-regression vs CI-infra vs flake vs hygiene, fix, verify, then batch into ONE follow-up push. See "CI Failure Triage Mode" below.

## Core Principle: Read Before Writing

Every fix starts by reading the actual code path — never guess from stack traces or error messages alone. State what you found before proposing a change.

## State Assumptions Before Implementing

Before writing any fix, explicitly state:
- **Current behavior** — what the code does now (read it, don't guess)
- **Root cause** — why it's broken (for bugs) or what the finding identified (for audits)
- **Policy constraints** — e.g., refund rules, GDPR consent rules, plan limits
- **Downstream effects** — what other code depends on the area you're changing

If any assumption is uncertain, ask before coding.

## Validate the premise before fixing

When the "finding" comes from a written audit / BACKLOG / plan (not a live failure you've reproduced), verify the premise BEFORE planning the fix:
- **Already-fixed grep** — confirm it isn't already resolved in the current tree.
- **Fiction-check every cited symbol** — each file / function / column / line the finding names must actually exist. A cited symbol that doesn't resolve means the finding is stale or fictional.

Re-scope to the real gap rather than "fixing" something that isn't there. (A reproduced live bug skips this — its premise is the repro.)

## Step → Verify Pattern

Each fix must have an inline verification before moving to the next:

```
Fix: [description]
  → Verify: npx tsc --noEmit (types clean)
  → Verify: relevant test passes
```

Don't batch all fixes then verify at the end — catch issues per-fix.

---

## Bug Fix Mode (`/fix bug`)

When the user reports a bug with screenshots, console logs, or error descriptions:

### 0. Unexplained-failure subcase — DELEGATE diagnosis (do NOT keep inline-debugging)

**Iron rule: state + VERIFY a root-cause hypothesis (read the code path) before ANY fix. After ONE failed hypothesis on an unexplained bug, STOP — do NOT attempt a 2nd inline hypothesis; delegate diagnosis.** The orchestrator pattern-matches on surface symptoms; a fresh domain expert reads the evidence carefully. **Diagnosis ≠ implementation** — once the expert returns a code-proven cause, the orchestrator implements the fix + runs the `--code` review gate (Completion Checklist).

**Lane (a) — the bug IS a failing test.** Signatures: Playwright (`Error: expect(locator)...`, `Timeout of 30000ms`, `test-failed-*.png`), Vitest (`FAIL` / `AssertionError` / `expected X to equal Y`), a CI test report. → Delegate to **qa-expert** with a targeted brief:
   ```
   Test {name} fails at {file:line}. Screenshot path: {path}. Error (first 5 lines): {...}.
   Locator targets map to source files: {grep-derived list}.
   Recent git log for those files: {git log --since="24h" --oneline}.
   Task: classify root cause (code bug / test bug / env mismatch / flake) + propose 1-line fix.
   Do NOT apply fix — return structured analysis.
   ```
   Then: wait for the classified report → apply the fix as orchestrator → re-run the target subset via the proper wrapper (`./scripts/e2e-local.sh <name>` e2e / `npm run test:integration` / `npx vitest run <path>`) → if it fails, re-dispatch with the new evidence.

**Lane (b) — a non-test bug that is unexplained / intermittent / multi-layer** (a hang, a wrong result, a flaky symptom with no obvious cause). → Same discipline: after ONE failed hypothesis, delegate diagnosis to the **domain-matched expert(s)** (`frontend-developer` / `saas-engineer` / `saas-architect` / `qa-expert` / …) — NOT necessarily qa-expert. **The brief MUST carry the owner's FULL stated facts** — not your lossy paraphrase; the omitted fact is usually load-bearing.

**Rationale:** the orchestrator jumps to symptom-shaped conclusions instead of reading. Evidence — (test) an e2e failure (2026-04-21): 5 wrong hypotheses before the root cause; (non-test) the 2026-06-24 `/welcome` hang: **4 inline wrong fixes + 1 hallucinated premise** before delegating — the trigger existed but fired 3 hypotheses too late.

**Exception:** an OBVIOUS fresh regression from a commit THIS session (git blame points to code we just wrote) → fix inline, it's faster. The delegate rule applies to UNEXPLAINED failures (no clear cause, OR 1 hypothesis already disproven).

### 1. Gather context (non-test bugs)
- **Read the screenshot** if provided — understand what the user sees
- **Parse console/server logs** — identify the error chain, stack trace entry points
- **Ask for clarification** if the reproduction steps are unclear

### 2. Trace the code path
- Read the actual source files referenced in stack traces
- Follow the data flow from user action → server action → DB → response → render
- Identify the exact line(s) where behavior diverges from expectation

### 3. State the root cause
Before writing any code, present:
```
**Root cause:** [1-2 sentences explaining why this breaks]
**Affected file(s):** [list with line numbers]
**Fix approach:** [what you'll change and why]
```

Wait for user confirmation if the fix is non-obvious or touches sensitive areas (billing, auth, moderation).

### 4. Fix + test
- Apply the minimal fix that addresses the root cause
- Write a behavioral regression test (invoke the function, assert the fix)
- Run step→verify

### 5. Systemic closure — the trio
After fixing, surface all three WITHOUT waiting to be asked:
1. **Class** — "could this same pattern exist elsewhere?" Quick grep for the same anti-pattern in related files.
2. **Guard-test** — is there a test that would have caught this? If not, write one (a fix without a regression guard invites recurrence).
3. **Tracker-owner** — which flow / feature / OPS row owns this bug? Note the fix there so it's attributable.

---

## Audit Finding Mode (`/fix p1s`, `/fix p2s`, etc.)

### `/fix p1s` — Plan first, then execute

1. **List all P1s** with a one-line planned approach for each
2. **State assumptions** for any fix that touches policy, billing, moderation, or entitlement logic
3. **Flag items:**
   - `[MIGRATION]` — any fix requiring a DB migration
   - `[NEEDS EXPERT]` — complex/ambiguous items needing expert consultation
4. **Wait for user's "go"** before executing
5. Execute with **step→verify** per fix
6. After all fixes: type-check, run tests, sync locales, update tracker

### `/fix p2s`, `/fix p3s`, `/fix quick` — Just do it

Lower-risk. Fix directly without a plan step. Only pause for `[NEEDS EXPERT]` items.

### `/fix p1-N` — Fix a specific finding

Execute immediately if straightforward. Flag if it needs migration or is complex.

---

## CI Failure Triage Mode (`/fix --ci`)

Triage a red GitHub Actions run, fix every failed job, verify locally, batch into ONE follow-up push. Distinct from the suite-green loops (which drive ONE suite to exhaustion): `--ci` spans ALL jobs in a run (typecheck / lint / unit / integration / e2e / audit / knip / meta-hygiene / …), and its core move is **classifying each failure by local reproduction**.

**When to use:**
- A push went red — especially a long-unpushed backlog finally hitting CI (many latent failures surface at once because CI hadn't run on `main` for N commits).
- Before trusting a deploy: if push-to-main auto-deploys to prod BEFORE CI completes, a red run means prod may already be live with the failure → triage is urgent, not optional.

**Process:**

1. **Resolve the run.** No arg → latest failed run on the current branch: `gh run list --branch "$(git branch --show-current)" --limit 5`. Or take a `<run-id>` / `<PR#>`.
2. **Enumerate failed jobs + the failing step per job:**
   ```bash
   gh run view <id> --json status,conclusion,jobs \
     --jq '.jobs[] | select(.conclusion=="failure") | "[\(.databaseId)] \(.name) → \(.steps[]|select(.conclusion=="failure")|.name)"'
   ```
3. **Reproduce each failure LOCALLY** — `gh run view --job <id> --log` only serves logs after the WHOLE run completes (mid-run it returns empty), so reproduce rather than wait. Map the failing CI step to its local command:

   | CI job / step | Local reproduction |
   |---|---|
   | typecheck | `npx tsc --noEmit` |
   | lint | `npm run lint` (gate on the ERROR count, not warnings) |
   | unit | `npx vitest run` |
   | integration | `npm run test:integration` |
   | e2e (desktop/mobile, sharded) | `./scripts/e2e-local.sh tests/e2e/<spec>.spec.ts --project=<desktop\|mobile>` |
   | audit ("high + critical") | `npm audit --omit=dev --audit-level=high` |
   | knip | `npm run lint:knip` (severity in `knip.json` — `error` blocks, `warn` doesn't) |
   | meta-hygiene | `bash scripts/smoke-test-hooks.sh` |

4. **Classify by the local result:**
   - **Fails locally too** → REAL regression. Fix per `/fix bug` (Section 0: delegate unexplained test failures to qa-expert; inline-fix only a fresh-this-session regression).
   - **Passes locally, fails CI** → **CI-infra / environment drift**, NOT a product bug. See the discrepancy catalog below. Fix the CI setup or the test's CI-robustness — NEVER weaken a passing assertion just to make CI green.
   - **Intermittent** → flake. Rerun discovery before fixing.
5. **Fix + verify — and where the failure is CI-only, reproduce the CI CONDITION locally** (delete/empty the gitignored file; run the DB setup without the stub) so the fix is verified against the real failure mode, not just the passing local default.
6. **Batch → ONE follow-up push** (separate approval; 1 push = 1 CI run + 1 deploy). Never push per-fix.
7. **Track the triggered run to GREEN — `/fix --ci` is NOT complete until CI is green.** A local-green fix is necessary, not sufficient: the CI-only conditions above can still bite, so the push's own run is the real gate. After the push:
   - Resolve the new run, then watch the WHOLE run to completion — do NOT stop at the first failure; other jobs surface independent issues. `gh run watch <id> --exit-status` tracks to completion; to react on the first failure while the rest keep running, poll `gh run view <id> --json jobs --jq '.jobs[]|select(.conclusion=="failure")|.name'` on an interval and start diagnosing early failures while slow jobs (integration/e2e) finish.
   - **On a failed run, rerun its failed jobs ONCE FIRST — flake is the first hypothesis, not the last** (once the run has COMPLETED: `gh run rerun --failed <run-id>`, then re-watch; the command refuses an in-progress run, so diagnose early failures while it finishes). `--failed` takes the RUN id and reruns every failed job in it plus their dependents in one call, so it is one call per run, never one per red job. A single rerun is the cheapest guard against a false negative (timing/network/bfcache flake) before you spend a triage cycle. Passes on rerun → it is a flake: diagnose and fix it before closing `/fix --ci` (a slow arm made fast, never a longer timeout) — commit the fix; it rides the next batched push, never a push of its own, since the rerun already made this run green; log it only with a named blocker. Fails AGAIN → it's real → back to step 2 to re-triage that job. A standing rule pre-authorizes this one flake-retry per RUN within `/fix --ci` (a second rerun is still gated); be transparent ("retrying job X — flake hypothesis").
   - Loop fix → push → track → retry-flake until the run is **complete AND green**. Only then is the mode complete.
   - Reruns + pushes are CI-cost actions gated by the push-approval hook (the `ALLOW_PUSH=1` token) — batch fixes, never spam reruns. **The ONE covered rerun is `ALLOW_PUSH=1 gh run rerun --failed <run-id>`, and only while `gh run view <run-id> --json attempt -q .attempt` reads `1`** — a standing exception, the one case where you type the prefix without asking. **Type it ALONE in its own Bash call** — never chain another command to it. Attempt ≥ 2, or any other CI trigger, goes back to the owner.

**Meta-surface CI fixes route through `/meta` first.** Most `/fix --ci` work is product-CI (the app-test setup, the auth-stub, flakes) and needs no gate. But when the fix touches the **meta-system** surface — a `.claude/` hook, `skill-lint` / `smoke-test-hooks` config, the `meta-hygiene` CI job, a skill spec, or a slash command — it IS a meta-system change: consult `/meta` first so the SC-1 velocity gate + naming-coherence discipline load before you edit. Distinguish by what the fix EDITS, not which job failed.

**CI-vs-local discrepancy catalog** (why a green local run goes red in CI — check these first whenever step 4 says "passes locally"; all observed in the 2026-06-19 135-commit-backlog triage):
- **Gitignored runtime files absent in a fresh checkout** — logs, caches, generated artifacts. A test/script that reads one breaks in CI where it doesn't exist. Fix: make the reader tolerate absence (`|| echo 0`, `touch` first, `[ -f ]` guard).
- **`grep -v PATTERN file && mv` skips the `mv` when ALL lines match** — `grep -v` exits 1 when its output is empty (every line matched), so `&&` short-circuits. Exactly the fresh/empty-file case in CI. Fix: decouple `mv` from grep's exit (`grep -v … || true; mv … || true`).
- **Local-runner setup not mirrored in the CI workflow** — a bootstrap step in `scripts/e2e-local.sh` (DB role/schema stub, seed) that the CI workflow lacks. They DRIFT. Fix: extract the shared step to ONE file both apply; never maintain two copies.
- **Superuser masks missing RLS** — integration (connects as the DB superuser → RLS bypassed) PASSES while e2e (the app hits RLS policies) FAILS on the same missing `auth.uid()`/`authenticated` stub. A green integration job does NOT clear an RLS-setup gap.
- **Gate-config severity** — knip/lint exit codes depend on `error` vs `warn` rules; an unpushed dep-fix still shows in CI's `npm audit`. Read the gate's config, not just its output.

**Bisect the CI history when logs + local-repro both stall (the "passes locally, fails CI" hard case).** When a failure is real in CI but invisible locally AND log/code-reading hasn't pinned it, STOP reading code — find the commit that turned it red:
```bash
gh run list --workflow "<name>" --branch <branch> --limit 40 \
  --json conclusion,headSha,createdAt,event \
  --jq '.[]|select(.event=="push")|"\(.conclusion)\t\(.headSha[0:8])\t\(.createdAt)"'
```
Last GREEN sha → first RED → the window. Then `git log --oneline <green>..<red>` + `git diff --stat <green>..<red> -- <suspect paths>`. **Three traps that make the naive bisect LIE (all hit 2026-06-19 — the technique still won, but only after dodging these):**
1. **Bisect the SPECIFIC failing job/spec, NOT the overall-suite conclusion.** A suite is red if ANY job is, so its green→red boundary is confounded by unrelated failures. At the apparent boundary the e2e job had failed on a DIFFERENT spec (and on `knip`) while the spec we cared about was still GREEN — its real regression was ~130 commits later. Always `gh run view <boundary-id> --json jobs` + read the failing-job log to confirm YOUR spec broke there; if not, the boundary is later — re-bisect on the spec.
2. **An EMPTY scoped `git diff` across the window = the code in that path did NOT change** → the cause is env/CI-config (the workflow file, runner env) or a wider surface; don't assume the obvious file changed. (Widen the diff to the full green→now window — a small window can miss a regression that landed mid-backlog.)
3. **A green run that POSTDATES a suspected commit disproves it.** A sub-agent blamed an 06-15 commit; the last green was 06-16 (after it) → that commit can't be the cause. Any "commit X broke it" claim dies the moment a green run exists after X.

Scope `git diff` to the failing surface (CI-behind-by-N-commits makes the last green old + the raw diff huge), and prefer the per-spec boundary over the suite boundary.

**Skip if:** one known job with an obvious fix → just fix it inline. A LOCAL suite is red (not a CI run) → use `--e2e-loop` / `--integration-loop` / `/fix bug`.

---

## Suite-Green Loop Mode (`/fix --e2e-loop`)

Run the e2e suite to exhaustion, classify every failure, dispatch parallel fixes, iterate until green. Use when many specs fail simultaneously and single-finding `/fix` would require many round-trips.

**When to invoke:**
- Wave-level change just landed (audit fix batch, big refactor, file-decompose) and the e2e suite is red across multiple specs.
- Rebase + merge brought in conflicts that cascaded into multiple test files.
- "All e2e green before I ship this" gate — user wants ceremony around the full verification, not ad-hoc fixing.

**Do NOT use when:**
- One known failure in one file → classic `/fix bug` (test subcase) is cheaper.
- The first discovery run looks flake-heavy (many screenshots unrelated to recent changes) → rerun discovery first to separate flakes from regressions; each confirmed flake is then fixed, never left to self-resolve.

### Process

1. **Discovery run — capture ALL failures in one pass.**
   ```bash
   PLAYWRIGHT_MAX_FAILURES=0 ./scripts/e2e-local.sh --no-build 2>&1 | tee /tmp/e2e-full-run-1.log
   ```
   `PLAYWRIGHT_MAX_FAILURES=0` overrides the stock `maxFailures: 3` in `playwright.config.ts` (env-override added 2026-05-18 — direct `--max-failures=999` args get swallowed by `e2e-local.sh` as test-name filter and produce "No tests found." silently). Use `--no-build` only if `.next/` was rebuilt within the last 5 min by a prior run targeting this session's commit set; otherwise drop the flag for a fresh build. Iterative work on a fail-fast config forces repeated 10-20m discovery runs — one exhaustive discovery is cheaper than three fail-fast ones. Runs in background (`run_in_background: true`); duration 10-20m.

2. **Parse + classify failures.** From the log, extract the `N) [project] › tests/e2e/<file>.spec.ts:LINE:7 ›` block list + the first Error line per failure. Group by owning spec file. Per cluster, pick a dispatch mode:

   | Cluster shape | Mode | Foreground/Background | Example |
   |---|---|---|---|
   | 1-2 failures in file, <15 LOC root cause, clearly understood (e.g., enum value, missing fixture column, stale locator text) | **Orchestrator inline** | n/a | `refund_source='voluntary'` not in CHECK constraint |
   | 2+ failures OR design-change ripple (UI deleted, contract inverted, key moved) — **cause is known**, fix surface is clear | **One agent per file** | **Background** (port-pool isolation safe) | 7 tests broken by Wave 2 mutex + test-DB pollution |
   | **Cause UNCLEAR from discovery log alone** (suspected framework bug, docs gap, multi-layer interaction, requires reading `node_modules/<framework>/dist/` source, sandbox-bash needed for build/curl/move/rm) | **One investigation-class agent** | **Foreground (mandatory)** | a framework file-placement bug — background agent hit sandbox restrictions on mv/rm/build, ran 20 min, returned inverted hypothesis. Foreground saas-architect with full context: 7 min, correct fix. |
   | Repeated identical failure across many files | **Check for common root first** before per-file agents (probably one infra/fixture issue) | n/a (orchestrator scout) | Shared-fixture column change |

   **Foreground rule:** background agents inherit different Bash sandbox permissions than foreground — observed-blocked: `mv`, `rm`, `git mv`, `./scripts/e2e-local.sh`. Investigation-class agents that need to iterate (move file → rebuild → re-test → adjust hypothesis) MUST run foreground. Background is safe ONLY for "apply known fix in known file with known verification command" pattern.

3. **Dispatch.** Inline fixes happen first (fast). Agents launch with `run_in_background: true` — port-pool isolation in `scripts/e2e-local.sh` handles parallel test runs (5495-5499 DB, 3100-3104 Next) so multiple agents + orchestrator can each invoke the script without collision.

   **Agent prompt must include:**
   - The per-file failure excerpt from discovery log
   - Strict file ownership: `tests/e2e/<file>.spec.ts` only, NO `src/**` edits
   - Wave context: commit hashes to Read for design intent (e.g., "Wave 2 changed X, Y, Z")
   - Related src files to Read (not modify) for resolver/hook/component internals
   - Permission to DELETE tests whose UI was removed by design — with mandatory `todo.txt` replacement-coverage pointer
   - Instruction to investigate test-DB state pollution as a possible cause (shared e2e user accumulating state across runs is a recurring pattern)
   - "Run `npx tsc --noEmit` + targeted `npx playwright test <file> --project=desktop` after edits; report PASS/FAIL"

   **Orchestrator pre-scouting (mandatory for investigation-class agents, 2026-05-18). Spend 30-60 sec gathering BEFORE writing the brief:**
   - **(a) Recent git log on candidate files** — `git log --oneline -10 -- <file1> <file2> ...` — pre-supply in the brief. Saves the agent from spending a tool call to discover regressions.
   - **(b) Framework-source paths matching symptom keywords** — if the symptom mentions `middleware`, `proxy`, `manifest`, `routing`, `redirect`, `auth`, grep `node_modules/<framework>/dist/build/` or equivalent for the resolver. Pre-supply file:line citations. Agents trust docs by default; framework source is the truth-source when docs are ambiguous.
   - **(c) Cross-file impact map** — if the proposed fix removes a function/symbol/import, `rg <symbol> src/ tests/` first and list ALL call sites + orphaned imports. Without this, agents do proactive cleanup discovery themselves (2026-05-18: 12 tool uses for ~10 LOC fix because they had to find the orphaned `useTranslations` import on their own).
   - **(d) Explicit build/test command per scope:**
     - Test-only edit (no `src/**` changes): `./scripts/e2e-local.sh --grep "<name>" --no-build`
     - Source edit: `./scripts/e2e-local.sh --grep "<name>"` (full build) OR `rm -rf .next && ./scripts/e2e-local.sh --grep "<name>"` if you suspect stale `.next/` masking the fix
     - **DO NOT** mix `--no-build` with source edits — agents have shipped false-PASS verdicts this way (one verification ran against stale binary, recovered only because the actual fix was also correct).
     - For build-output inspection (proxy/middleware registration, route map, etc.), use `npx next build 2>&1 | grep -E "ƒ (Proxy|Middleware)|error"` — the build summary line is the truth-source, NOT `middleware-manifest.json` (which ships empty under Next 16 Turbopack regardless of registration state).
   - **(e) Foreground vs background routing** — see "Foreground rule" in the dispatch table above. If the agent might need to iterate (move file → rebuild → re-test), foreground only. Background agents get blocked on `mv` / `rm` / `./scripts/*.sh` in this sandbox.

4. **Parallel verification while agents work.** Run targeted specs NOT owned by any agent — verify any inline fixes against their specs. If nothing to verify, skip this step rather than inventing work.

5. **On agent completion — targeted re-run.**
   ```bash
   ./scripts/e2e-local.sh tests/e2e/<file>.spec.ts --no-build --project=desktop
   ```
   **Stock config** (`maxFailures: 3`, `retries: 0`) — fail-fast catches latent flakes the agent's TS check alone wouldn't surface. `--no-build` is safe after discovery; full rebuild not needed unless src/** changed.

6. **If new failures surface → next wave.** Classify, dispatch, loop. If the same test fails a second time after an agent "fixed" it, verify the agent's claim via `ls test-results/` + log artifacts; don't trust self-report.

7. **Final confirmation — full suite, stock config, both projects.**
   ```bash
   ./scripts/e2e-local.sh --no-build 2>&1 | tee /tmp/e2e-full-run-2.log
   ```
   Verifies no indirect regression from the fixes themselves + confirms mobile project (targeted re-runs default to desktop).

8. **Commit.** Per-wave or single bundled commit — your call. Bundled is usually cleaner for audit trail; per-wave is better when waves touched independent subsystems.

### Rules that matter

- **Discovery MUST set `PLAYWRIGHT_MAX_FAILURES=0`** (env var, not arg — bare args are filter-interpreted by `e2e-local.sh`). Iterating on fail-fast config burns 10-20m per pass for no information gain.
- **Investigation-class clusters → foreground agent + orchestrator pre-scouting.** When discovery log doesn't disclose the cause (framework bug suspected, docs ambiguous, multi-layer interaction), don't background-dispatch a per-file agent — they'll burn 20 min hitting sandbox restrictions. Foreground a single saas-architect / saas-engineer / qa-expert agent with the orchestrator-pre-scouted brief (git log + framework-source paths + cross-file impact + build command + foreground/background routing).
- **Targeted re-runs use stock config.** Fail-fast catches flakes the agent missed + prevents wasted time on a cascading failure chain.
- **No intermediate full-suite runs.** Only at discovery + final. Targeted re-runs in between.
- **Agents may DELETE tests** when the UI was removed by design. Must leave a `todo.txt` entry naming what replacement coverage looks like (unit test, new e2e scope, etc.).
- **One agent per owning file.** Never split one spec file across two agents — file-ownership collision will corrupt the diff.
- **Agents can spawn their own e2e-local.sh** — port pool handles isolation. Don't tell them to "reuse orchestrator's server" — the discovery run tears down its server at end.
- **Check for test-DB pollution before blaming design.** Shared e2e user accumulates state (projects, critiques, bookmarks) across runs. If the test's failure is "card X doesn't render" and the seeded state is <10 rows, but dashboard shows 20+ critiques, pollution is the root cause, not Wave design. Agent should add `beforeAll` cleanup for the shared user's owned rows.

### Integration-test variant (`/fix --integration-loop`)

Same structural pattern, simpler in practice:

- **Discovery:** `npm run test:integration` (3-5 min wall; Docker DB via port pool 5433-5437).
- **No "targeted re-run" distinction** — integration suite is already fast; just rerun the file after fix: `npm run test:integration -- tests/integration/<file>.test.ts`.
- **Almost always one wave.** Integration failures are usually fixture/mock issues (schema drift, new NOT NULL column, renamed export). Design-ripple failures are rare because integration doesn't exercise UI contracts.
- **Agents rarely needed.** Single-file fixture fixes are almost always orchestrator inline. Spawn an agent only if 3+ integration files fail with unrelated root causes.

Keep this mode in the same skill — don't split into a separate skill. The pattern is structurally identical; the differences are tuning.

### Skip if

- Single failure, single file, single LOC fix — classic `/fix bug` or inline edit beats full loop ceremony.
- Discovery surfaces exclusively timing/flake signatures (screenshots of valid UI, `toBeVisible` timeouts on known-slow elements) — rerun discovery first, don't loop on flakes: fix each one as a single `/fix bug`.
- User wants a specific subset (e.g., only Flow #X specs) — use classic `/fix` with spec path, not the loop.

---

## What counts as "straightforward"

- Adding a missing guard (useRef, a permission check, disabled prop)
- Mechanical FK migrations (add ON DELETE SET NULL/CASCADE)
- Adding a table to an export query
- Updating copy/translation keys
- Adding COALESCE or LIMIT to a query
- Mutual exclusion (disabled={otherLoading})
- Inline validation, error mappings, i18n keys

## What needs `[NEEDS EXPERT]`

- Changing deletion or processing order of operations
- Adding new UI sections (notification preferences, goodbye page)
- Architectural decisions (soft-delete vs hard-delete, cooling-off periods)
- Changes that affect multiple flows or have downstream dependencies
- Migration that changes existing behavior on a populated table
- UX decisions with multiple valid approaches
- Any fix where the "right answer" isn't obvious from the code alone

## What gets `[MIGRATION]`

Any fix that creates a file in `supabase/migrations/`. Always flagged — migrations are irreversible in production.

---

## Completion Checklist

- [ ] Type-check (`npx tsc --noEmit`)
- [ ] Run relevant tests (unit + integration) — all green
- [ ] Every fix has a behavioral test (not source-grep)
- [ ] **Non-trivial fix** (multi-file / security / billing / entitlement / auth / behavioral surface)? Run a scoped `/expert-review --code` on the fix diff BEFORE closing (builder≠breaker) — resolve findings, then close
- [ ] Translate new keys into every locale the project ships (never English placeholders)
- [ ] Update feature/flow tracker in memory if applicable
- [ ] Stage only this session's files (`git add` specific files, never `-A`)
- [ ] Commit with clear description (audit: finding refs, bug: root cause summary)
