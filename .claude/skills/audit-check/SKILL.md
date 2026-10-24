---
name: audit-check
description: Verify the quality and completeness of a feature or flow audit. Use after an audit's fixes are implemented and before marking it COMPLETE — catches lazy deferrals, source-grep disguised as tests, missing fixes, unverified claims.
---

# Audit Quality Check

Verify the quality and completeness of a feature or flow audit. Catches the patterns that slip through: lazy deferrals, source-grep disguised as tests, missing fixes, unverified claims. Run this AFTER an audit's fixes are implemented and BEFORE marking it COMPLETE.

## Usage

> 💡 `/audit-check help` (or `--help`) lists invocation forms + the checks below without running a gate.

`/audit-check <feature or flow>` (e.g., `/audit-check F14`, `/audit-check Flow #13`)
`/audit-check --v3-drift <F#|Flow #N|OPS #N>` — verification gate for `/expert-review --v3-drift` output (drift-aware skip rules; new Check 13 for v3-drift workflow integrity)

**Use templates:** `.claude/templates/final-audit-checklist.md` for structured output, `.claude/templates/audit-finding.md` for individual findings.

## When to Use

- After implementing audit fixes, before marking COMPLETE
- When confidence in an existing audit is low
- When re-checking a previously completed audit
- Proactively: the orchestrator should suggest running this before any COMPLETE status change

## Process

Run all 13 checks sequentially (Check 10 N/A for non-UI; Check 11 N/A for <7-expert panels; Check 12 N/A for FAIL verdicts; Check 13 N/A for fix-waves under the --code threshold AND not touching codified-policy copy — full-mode Check 13 is the Fix-Wave Review Gate; in --v3-drift mode Check 13 is the Workflow Integrity Gate). Each check produces a PASS/FAIL with specifics. The feature CANNOT be marked COMPLETE until all applicable checks pass. Check 9 (Test Run Gate) is the primary test gate — a feature with red tests is not COMPLETE regardless of prior checks. Check 12 (Verification-Before-Completion) confirms completion claims are backed by fresh proving-command output.

**Deterministic-first ordering (adopted from guildhall).** Before dispatching a FIX-WAVE (Check 2 fixes / a `--code` fold), run `npx tsc --noEmit` as a cheap fast-fail — a diff that fails typecheck bounces to fix-first, don't spend the wave on it. **This does NOT reorder Check 9:** Check 9 (Test Run Gate) stays the MANDATORY *last* gate by design — it validates the POST-fix state; a cheap tsc-first fast-fail and an authoritative test-gate-last are complementary, not a reorder. The panel-dispatch pre-gate lives in `/expert-review --code` Step 1c; here it is just the tsc fast-fail before a fix-wave.

### `--v3-drift` mode (added 2026-05-25 after a v3 audit shipped without a verification gate)

When invoked with `--v3-drift <target>`, the same 12 checks run with these drift-aware adjustments:

- **Check 1 (Deferral Audit) — scoped to v3 defers only.** The defer-sweep 3-part test targets the v3-drift section in `todo.txt` (header pattern: `## F<N> v3 drift audit deferrals (YYYY-MM-DD, ...)`). Earlier v2/v1 defers not re-audited (out of scope; would re-litigate settled decisions distinct from v3 ship).
- **Check 6 (Tracker Accuracy) — verifies v3 ✅ transition + process log path.** Required: tracker entry shows `**COMPLETE under v3 drift** (YYYY-MM-DD, N experts via /expert-review --v3-drift <target>` AND process log at `plans/feature-F<N>-v3-drift-process.md` exists AND its filename matches the tracker reference exactly.
- **Check 9 (Test Run Gate) — scoped to drift-fix-touched files.** `git diff --name-only <v2-commit>..HEAD -- '*.test.ts' '*.test.tsx'` enumerates added/modified test files in the v3 audit's commit range. Run those + any source files they cover. Skip full-suite unless drift fixes touched ≥5 files OR cross-cutting `src/lib/` modules.
- **Check 10 (Delta E2E Gate) — default-skip if zero `src/app/**` or `src/components/**` files touched.** v3 drift typically fixes `src/lib/` / `src/actions/` / `src/services/` surfaces; e2e regression rare. Re-enabled when any UI file appears in the v3 commit's diff.
- **Check 11 (Process-Log Existence Gate) — MANDATORY for v3-drift mode regardless of panel size.** v3 audits ALWAYS write a process log (per spec); panel-size-conditional skip rule does not apply.
- **Check 12 (Verification-Before-Completion) — same as full audit.** Fresh proving-command output for every claim made in the v3 synthesis (tsc, test run, grep-verify of cited file:line).
- **Check 13 (NEW, v3-drift-only) — Workflow Integrity Gate.** Verify the `/expert-review --v3-drift` Process Step 1a (post-v2 commit-grep on target surface — closing a detector blind spot) was actually run. Evidence in process log: a section containing `git log --since=` + the target surface paths + at least one `[uncodified-drift]` tag OR an explicit `none surfaced` claim. If absent → FAIL: workflow shortcut taken; v3 audit may have missed drift the detector cannot see.

**Auto-fix bias:** v3 drift fixes are typically ≤5 LOC; the inline-fix bias from `/expert-review --v3-drift` mode means most findings landed via Edit at audit time. `/audit-check --v3-drift` verifies they didn't drift back out OR introduce regressions. Same `Post-Gate Action` (commit session-scoped files) applies.

**Failure mode the v3-drift flag prevents:** a v3 audit shipped without ANY of the 11 checks running. The tracker label flip (v2 ✅ → v3 ✅) was the only "verification" — equivalent to the stale-classification anti-pattern (a label without a re-run). Its 5 inline production-code edits had no `npx tsc --noEmit` gate, and its 5 new integration tests were never run. Future v3 audits MUST run `/audit-check --v3-drift <target>` before the tracker label flip lands.

---

### Check 1: Deferral Audit

**Goal:** Every deferred item has a valid reason. No lazy deferrals.

**Steps:**
1. Read the feature tracker entry for this feature
2. Extract every item described as "deferred", "skipped", "post-launch", "monitor", "post-launch monitor", "acceptable", "track after launch", "needs data", or with fractional counts (e.g., "P2 7/8 — 1 deferred")
3. For EACH deferred item, apply the 5-minute rule:
   - Read the actual code/file the fix would touch
   - Estimate lines of change
   - Check against the 3 valid deferral reasons:
     a. Needs production data that doesn't exist yet
     b. Needs a decision the user hasn't made
     c. Has real dependencies on unbuilt systems
4. Present a table:

| Item | Claimed Reason | Actual LOC | Valid Deferral? |
|------|---------------|-----------|-----------------|

**FAIL if:** Any item is <15 lines AND doesn't meet the 3 valid reasons.

---

### Check 2: Fix Verification

**Goal:** Every fix that was claimed as "implemented" actually exists in the code.

⛔ **GREP `git show HEAD:<path>`, NEVER A BARE PATH — A CHECK-2 RUN AGAINST THE WORKING TREE CANNOT FAIL FOR THE REASON CHECK 2 EXISTS.** "Exists in the code" is a claim about the COMMITTED plane. The two planes agree almost always, which is why the bare-path habit survives, and they disagree in exactly one state: a fix that was written and never staged. That state is the one this check is for, so reading the tree makes the check vacuous precisely where it is needed. The shape it catches: **a fix left unstaged can be NAMED AS SHIPPED in its own commit body while `git log -S <the fix's constant>` on that path returns nothing** — and a Check 2 that reads the tree finds the file and reports PASS. A Check 9 run the same way is green for the same reason and is no comfort: suites that run against the tree make *"nothing shipped untested"* luck rather than a property. **TELL: your verification command is a bare path, or your editor could satisfy it — OR it proves a NAME exists when the claim was about a VALUE (step 3).** The spec fix is this paragraph. *(This once read "the plane that SHIPS", but `origin/main..main` was 391 commits at the time, so HEAD is the committed plane, not the shipped one. The reasoning holds; the justification was over-claimed.)*

⚠️ **The mirror, so this does not get "fixed" into a new hole:** `git show HEAD:<path>` on a path that is wrong, moved or guessed returns EMPTY at rc=0 with no stderr, which reads as *the fix is missing* — a false FAIL where the bare path gave a false PASS. Run `git cat-file -e HEAD:<path>` first, or demand a NON-ZERO control from the same file (`.claude/traps/shell-traps.md`, the `git show <ref>:<path>` row of the false-zero table under its False-zeros provenance header).

**Steps:**
1. Extract every fix from the feature tracker entry (parse the description for specific changes). **State the count, and reconcile it against any count an earlier run or the tracker stated** — a claim dropped here is invisible to every later step, because steps 2-4 check only the claims you extracted. Measured on one audit: a first run stated 13 claims and a re-run at HEAD reported "all eleven verify" over a list that had dropped three of the 13 and added two new ones, and one of the three dropped was the demonstration case below.
2. For EACH fix, grep **`git show HEAD:<path>`** to verify it's present — never the working copy, per the paragraph above
3. **Read the VALUE the claim asserts, at HEAD, and compare it to the claim — a hit on the NAME is step 2, not step 3.** Name what the fix is supposed to make true (a key's ICU shape, a guard's condition, a constant's number, an order on the page), read exactly that at `git show HEAD:<path>`, and where the fix spans two files (a key and its caller, a producer and its reader) read BOTH at HEAD and check they agree. ⛔ **The demonstration is a translation-pending message key:** the key was on HEAD as a plain string while its `{family, select}` form sat uncommitted, and the component passing `family` WAS committed. Extra ICU arguments are ignored rather than thrown, so one family of surfaces showed its owner the message written for a different family. Step 2 passes (the name is there), step 4 passes (both files are in the commit), and only reading the value catches it.
4. **Reconcile the CLAIM against the COMMIT's own file list**, not only against the content: `git show --stat <sha>`. A body sentence naming a file the commit does not carry is its own defect class, and it is invisible to a content grep on any plane once the fix later lands.
5. Present a table:

| Fix | File | Grep Result | Verified? |
|-----|------|-------------|-----------|

**FAIL if:** Any claimed fix is missing from the codebase.

---

### Check 3: Test Quality Audit

**Goal:** Tests are behavioral, not source-grep. No readFileSync+toContain masquerading as coverage.

**Steps:**
1. Find all test files related to this feature: `grep -r "F{N}\|{feature-name}" tests/ -l`
2. For each test file, count:
   - **Source-grep tests:** Uses `readFileSync`, `toContain` on source text, or `extractFunctionBody`
   - **Behavioral tests:** Imports and invokes the actual function, asserts on return value or side effects
   - **Integration tests:** Uses real DB (Docker), invokes service/action functions
3. Present breakdown. **Columns are counts of test cases, not booleans.** Do not collapse "Source-Grep" to ❌/✅ — a count of `0` is meaningfully different from `3` even when both pass the threshold, and counts let the reader see scale at a glance.

| Test File | Total cases | Behavioral | Source-Grep (readFileSync) | % Behavioral |
|-----------|-------------|------------|----------------------------|--------------|
| example.test.ts | 17 | 17 | 0 | 100% |

If a test file has 0 source-grep cases, write `0`, not `—` or `❌`. If you can't count test cases mechanically, say so explicitly (don't invent a boolean).

4. For P0/P1 findings specifically, verify each has at least one behavioral test (not source-grep)
4b. **Test-validity (oracle) checks — behavioral ≠ valid (added 2026-06-14).** A test can invoke the function (clearing the behavioral bar above) yet still be FICTIONAL. For each test covering a P0/P1 finding, ALSO verify: (a) **arg-assertion** — a `vi.mock` on a vendor SDK (payments, email, model API, database) that asserts only "was called" (not the EXACT expected args) validates control flow, not correctness → flag it; (b) **literal-in-src (assert the literal the code reads)** — any asserted literal value/copy/constant (`.toBe(N)`, `toContain("…")`) must currently exist in `src/` and be live (not stale/dead-code) → grep it; (c) **mutation check — MANDATORY for P0/P1 fixes (2026-06-14):** actually REVERT the fix hunk and re-run its test — a test that stays GREEN with the bug back is fictional (it does not pin the behavior). The few blocking fixes per audit justify the manual revert+rerun; this is the single highest-confidence test-validity check. The AUTOMATED revert→RED harness (a `scripts/` mutation runner that auto-selects hunk+test) is the deferred deeper gate — trigger: build it if the manual check ever catches a fictional test the behavioral gate passed, OR when audit volume makes the manual step a bottleneck. Final Audit's coverage gate checks test PRESENCE; this checks test VALIDITY — the same `.filter(Boolean)` "green digest hides the failure" class, one layer down.
5. Check that integration tests exist for:
   - Usage-allowance handling paths (reservation, refund, leak prevention)
   - Auth/security gates (suspension, IDOR, contentSafe)
   - Error recovery paths (failure + refund, retry logic)

6. **Docker integration enforcement:** For P0/P1 findings involving usage-allowance handling, auth gates, or content safety:
   - Check that a test exists in `tests/integration/` (not `tests/`)
   - Check that it uses `getTestDb()` (not `readFileSync`)
   - Check that it calls the actual service/action function (not just parses source text)
   - The pattern `readFileSync` + `extractFunctionBody` + operation ordering assertions is NOT an integration test — it's source-grep with extra steps. Flag it.

7. **Redundant source-grep check:** When a real Docker integration test exists for a finding, flag any source-grep test covering the same finding as redundant. These should be deleted or clearly labeled as "fast smoke test, not primary coverage."

**FAIL if:**
- Any P0 finding has only source-grep coverage
- Any P0 allowance/auth/safety finding lacks a Docker integration test in `tests/integration/`
- Overall behavioral % is below 60%
- Zero integration tests exist for allowance or auth paths

---

### Check 4: "Acceptable" Claims Audit

**Goal:** Items marked "acceptable as source-grep" or "acceptable for launch" are genuinely acceptable.

**Steps:**
1. Find all items in the tracker or expert memories marked "acceptable"
2. For each, read the actual code:
   - If it's a CSS class or HTML attribute → source-grep genuinely acceptable
   - If it's logic, a gate, a validation, or error handling → NOT acceptable, needs behavioral test
   - If it's "acceptable at current scale" → check if scale assumptions still hold
3. Present findings with justification

**FAIL if:** Any logic/gate/validation is covered only by source-grep and labeled "acceptable."

---

### Check 5: Expert Memory Consistency

**Goal:** Expert memories were updated, and referenced code still exists.

**Steps:**
1. For each expert that participated in this audit, read their MEMORY.md
2. Find entries related to this feature
3. For entries that reference specific files, functions, or line numbers:
   - Verify the file exists
   - Verify the function/pattern is still present (code may have changed since the memory was written)
4. Flag stale entries

**FAIL if:** Expert memories reference code that no longer exists (stale entries that could mislead future audits).

---

### Check 6: Tracker Accuracy

**Goal:** The feature tracker entry is accurate and complete.

**Steps:**
1. Read the feature tracker entry
2. Cross-reference against:
   - Actual test count: `grep -c "it(" tests/f{N}-*.test.ts tests/integration/f{N}-*.test.ts` (adjust pattern)
   - Actual fix count: count the distinct changes in the relevant source files
   - Deferred items: verify the count matches what's actually deferred
3. Check that the status reflects reality:
   - "Audit done" → expert panel actually ran
   - "Fixes done" → all non-deferred items implemented
   - "Final audit done" → verification panel ran
   - "COMPLETE" → all checks in this file pass, or Check 10/11/12/13 is N/A (including Check 9 test-run gate: `npx vitest run` + `npm run test:integration` + `npx tsc --noEmit` all green)

**FAIL if:** Test counts, fix counts, or status don't match reality.

**Mechanical row-update verification (2026-04-20 — closes a tracker-row false-positive class).** On PASS in the Post-Gate commit, before staging the tracker file:
```bash
# Extract current tracker row for this flow/feature
# GLOB, not the router: the row lives in a shard, and a bare-router grep returns a clean zero.
ROW=$(grep -hE "^\| ${FLOW_NUM} \|" .claude/project-memory/project_critical_flows*.md | head -1)
# OR for features: ^\| F${FEATURE_NUM} \|
# ⛔ KEY THE COLUMN OFF THE HEADER — `$6` WAS A FIXED INDEX AND IT NEVER READ THE FINAL AUDIT
# COLUMN IN EITHER LAYOUT (measured 2026-09-09). The corpus has two row shapes, and this gate
# tested the wrong cell in both: layout A `$6` is `Initial Audit (/expert-review)` (Final Audit is
# `$8`), layout B `$6` is `Audit Tiers` — a DATE TOKEN. On one flow it read "Done (2026-04-04 eng…",
# which matches neither COMPLETE nor PASS, so the gate FALSE-STOPPED a genuinely complete flow.
# It sat one line below the glob comment added by the commit that fixed this family elsewhere:
# the sibling got attention, this line did not — the same miss the review caught in observations.
# python, not awk: /audit-check always takes an argument, and a skill invoked WITH arguments has awk's
# dollar-digit fields replaced by the argument words — the whole-record match here never fired.
FINAL_COL=$(python3 - "$FLOW_NUM" .claude/project-memory/project_critical_flows*.md <<'PY'
import re, sys
num, fi = sys.argv[1], None
for path in sys.argv[2:]:
    for l in open(path, encoding="utf-8"):
        cells = l.rstrip("\n").split("|")
        if re.match(r"\| *# *\| *Flow *\|", l):
            fi = None
            for i in range(1, len(cells)):
                if cells[i].strip() == "Final Audit": fi = i
            continue
        if re.match(r"\| *" + num + r" *\|", l):
            if fi is None: print("STOP - this row sits under a header with no Final Audit column"); sys.exit(1)
            print(cells[fi].strip() if fi < len(cells) else ""); sys.exit(0)
sys.exit(1)
PY
)
if ! echo "$FINAL_COL" | grep -qE "COMPLETE|PASS"; then
  echo "STOP — tracker row Final Audit column does not reflect COMPLETE state"
  echo "Current: $FINAL_COL"
  echo "Edit tracker row before committing."
  exit 1
fi
```
Evidence this is needed: a flow's final-audit COMPLETE commit (2026-04-17) did NOT touch the tracker file at all (`git show --stat` empty for it). The tracker row stayed "NOT AUDITED" for 3 days until it was caught later. Without this mechanical check, spec-advice-level "Verify tracker updated" gets silently skipped under context pressure. Evidence of the healthy path: two other flows both touched the tracker file in the same commit — the fix works when followed, it just needed enforcement.

---

### Check 7: Cross-System Registration

**Goal:** New system entries (email types, cron jobs, analytics events) are registered in all places that need to know about them.

**Steps:**
1. Identify any new system entries added by this audit's fixes:
   - New email type → must be in `PREF_MAP` in `src/lib/email/send.ts` AND `src/app/api/email/unsubscribe/route.ts`
   - New cron job → must be registered in the deployment platform's scheduled-jobs config AND authenticate with the shared cron secret
   - New analytics event → must have consent gating (if non-transactional)
   - New API endpoint → must have auth middleware + rate limiting
   - New DB table → must have RLS enabled
   - New preference column → must match default in schema AND `DEFAULT_PREFS` in `src/services/account.ts`
2. For each new entry, verify it appears in ALL required registries
3. Present findings:

| New Entry | Required Registrations | Found In | Missing From |
|-----------|----------------------|----------|-------------|

**FAIL if:** Any new entry is missing from a required registry. Silent bypass of user preferences (e.g., an email type missing from the preference registry) is a P0 privacy/trust issue.

---

### Check 8: Deferral Promotion to todo.txt

**Goal:** Every deferred item with a code component is visible in `todo.txt` with an explicit trigger condition. Catches the pattern where 4 deferrals existed only in the tracker entry — invisible to anyone reading `/features` or `todo.txt`.

**Steps:**
1. From the feature tracker entry, extract every item described as "deferred", "post-launch", "monitor", "track after launch", or "needs data".
   **AND from the audit's process log (`plans/<audit>-process.md`), harvest every disposition whose value is an ACTION owed somewhere else** — cells or sentences reading ROW / ROWS / "Rows: …" / FILED / routed / mailed / "sent to". Each must name what it created: a `todo.txt` or `BACKLOG.md` row (grep the name), or for a routed item the mail in the store or the commit body that names it. A reconciliation line such as "None is lost" is a COUNT claim — write both numbers beside it (ROW-valued cells N, rows found N). *(Added after an audit synthesis disposed of about fifteen findings as ROW and ended "None is lost", while one of them became a row: this step's tracker-wording harvest never saw the process log's vocabulary, and Check 8 passed inside a 13/13.)*
2. For each, grep `todo.txt` for a matching entry (search by feature ID, finding tag, or descriptive keyword).
3. For each match, verify the todo entry includes:
   - **Defer reason** (one of the 3 valid reasons from Check 1)
   - **LOC estimate** (rough scope — "~80 LOC", "small", "medium")
   - **Trigger condition** (e.g., "first storage cost spike", "month-3+ retention data", "A/B once there are enough paid subscribers"). NOT just "post-launch."
4. Present findings:

| Deferred item | In todo.txt? | Has trigger? | Status |
|---------------|--------------|--------------|--------|

**FAIL if:** Any code-touching deferral is missing from `todo.txt`, OR is in `todo.txt` without a defer-with-trigger format, OR any ROW / FILED / routed disposition in the process log names nothing that exists. Pure-monitoring deferrals (e.g., "watch p99 latency") are exempt — they're not actionable code.

**Inline-fix during audit:** if missing entries are <15 lines to add, write them in `todo.txt` directly per the 5-line rule (see Execution Rules).

---

### Check 9: Test Run Gate (MANDATORY — last gate)

**Goal:** Confirm the tests pass in reality, not just that the test files look right. Check 3 inspects test *quality* (behavioral vs source-grep); Check 9 inspects test *results*. They are not interchangeable. A feature cannot be marked COMPLETE if the unit or integration suite is red, even if every prior check passes.

Evidence (one flow's v2 audit, 2026-04-15): `/audit-check` signed off 7/7 while `npx vitest run` was red with 14 failures — stale source-grep assertions on copy strings + a source-grep security test broken by a legitimate doc-comment change. The prior 7 checks had no gate that would catch this. Without Check 9 this would have shipped with red tests under a "COMPLETE" label.

**Steps:**

1. Run unit suite. **Record both the exit code AND the pass/fail counts** — don't infer.
   ```bash
   npx vitest run 2>&1 | tail -5
   ```
   Expected: `Test Files  N passed (N)` and `Tests  M passed (M)` with no `failed` tokens.

   **If unit is RED:** stop. Do not proceed to integration/e2e — fix unit first (stale source-grep or legitimate regression per triage rules below). Running downstream suites with known-red unit tests wastes 5-10 min and produces noisy failure cascades.

2. **If unit is GREEN:** run integration + tsc + Check 10 delta-e2e in parallel. These use independent runners (Docker DB, TypeScript compiler, Playwright browser) — sequential execution wastes ~5-8 min wall-clock per audit. Launch all three as background Bash calls and collect exit codes:
   ```bash
   # Parallel batch — launch with run_in_background: true on each Bash call
   npm run test:integration 2>&1 | tee /tmp/integration.out &     # ~2-5 min
   npx tsc --noEmit 2>&1 | tee /tmp/tsc.out &                     # ~30 sec
   npm run lint 2>&1 | tee /tmp/lint.out &                        # ~30 sec
   ./scripts/run-changed-e2e.sh 2>&1 | tee /tmp/e2e.out &         # ~2-3 min
   wait
   ```
   Expected: all four exit 0; `Test Files N passed (N)` for integration; zero tsc errors; **zero lint ERRORS** (read the `N problems (E errors, W warnings)` line — warnings are non-blocking, ~420 exist; only the ERROR count gates per tee exit-code); delta-e2e per Check 10 classification.

   **Why lint is in the batch (added 2026-06-15):** the CI `lint` job flipped to BLOCKING (2026-06-11), but `tsc`/unit/integration do NOT run eslint — so a lint-only ERROR (e.g. `react-hooks/purity`) passes every other Check-9 gate and fails the push's CI. Evidence: a `react-hooks/purity: Cannot access refs during render` error passed a feature's `/audit-check` 13/13 and shipped, caught only later, at session end (post-commit). Linting at the feature boundary catches it before the COMPLETE flip. **Skip only when** the audit touched zero `src/**` or `tests/**` files (docs/memory/meta-only). A lint ERROR this audit's work introduced blocks COMPLETE; a pre-existing lint ERROR in a peer's uncommitted file is NOT yours — scope the read to files this audit touched.

   **Optional desktop/mobile split (matches CI):** if the feature touched mobile-responsive components, replace the single `run-changed-e2e.sh` call with the two project runs:
   ```bash
   npx playwright test --project=desktop 2>&1 | tee /tmp/e2e-desktop.out &
   npx playwright test --project=mobile 2>&1 | tee /tmp/e2e-mobile.out &
   ```

3. If any suite has failures, **FIRST enumerate failing file paths before any classification**. Run `grep -E "^FAIL|^❯" /tmp/integration.out | head -30` (or equivalent on the output buffer). Pre-classification without knowing WHICH files fail is premature and actively misleads the user — "12 failures" could be your-feature regressions, parallel-session fixture bugs, infrastructure drift, or flake, and you cannot tell which without file paths. Only after file list is known, present the triage table:

   | Test file | Test name | Failure mode | Classification |
   |---|---|---|---|
   | example.test.ts | "X does Y" | assertion | stale source-grep / legitimate regression / flake / parallel-session |

4. For each failure, decide:
   - **Stale source-grep on copy/source strings** (this audit's changes broke the assertion, not the behavior): inline-fix the test per the 5-line rule, or convert to behavioral if trivial. Fail the gate, fix, re-run.
   - **Legitimate regression** (behavior is wrong): block COMPLETE, file a finding, route back to `/agent-work` for a fix.
   - **Flake** (e.g., Docker port conflict, timing): re-run ONCE to test the flake hypothesis. If it passes and the cause was the ENVIRONMENT (a Docker port a peer held, a `[vitest-pool]` worker-start failure — `tests-unit.md` § RE-RUN STANDALONE), no test is flaky: record the event in the Check 9 table and move on. Otherwise it IS a flaky test: find the cause and fix it in this pass (a slow arm made fast, never a longer timeout) — log it only with a named blocker. If it fails twice, treat as legitimate.

5. **tsc ran in parallel with integration + e2e (Step 2)** — re-check /tmp/tsc.out for zero errors. If errors surfaced and were not resolved by inline-fixes above, FAIL the gate.

**FAIL if:**
- Any unit test fails AND the failure is a legitimate regression
- Any integration test fails AND the failure is a legitimate regression
- `tsc --noEmit` reports any error
- `npm run lint` reports any ERROR introduced by this audit's work (warnings non-blocking); CI lint is a hard gate
- Delta e2e (Check 10) has (a) real regression failures per its own classification

**Inline-fix during audit:** If failures are stale source-grep tests broken by this audit's legitimate copy/code changes, fix the test assertions in the same audit turn (per the 5-line rule). Do NOT defer them to a separate session — a red test on `main` under a COMPLETE label is worse than a failing audit that prompts immediate fix.

**Note for subagent orchestration:** when running this inside `/expert-review --final-audit` or after `/agent-work`, Check 9 must run AFTER all agents complete + the orchestrator integration pass. Running it between waves produces false positives (mid-flight work hasn't landed).

---

### Check 10: Delta E2E Gate (MANDATORY for UI-touching features)

**Goal:** Confirm feature's e2e specs pass, since unit + integration (Check 9) can't catch UI-layer regressions like cookie-banner overlap, hydration races, or framework-level routing bugs. Complements Check 9 — together they form the feature-level test gate.

Evidence (one flow's audit, 2026-04-16): Check 9 signed off (4074 unit + 1748 integration green), but the e2e suite had 5 real fails (cookie-banner intercepting sticky-CTA clicks, a rate-limiter-migration regression in a form submission, rating-card hydration race) — ALL UI-layer. Only surfaced after commit, on a manual playwright run. Check 10 catches these before COMPLETE.

**Steps:**

1. Determine if this feature touched `tests/e2e/**`, `src/app/**`, or `src/components/**`. If none → Check 10 skip-clean; report as `N/A — no UI-touching changes`. If any → continue.

2. Run delta e2e via the existing script:
   ```bash
   ./scripts/run-changed-e2e.sh
   ```
   The script auto-selects affected specs via direct match (modified `.spec.ts`) + indirect match (spec files referencing changed component/app paths — conservative, may include false positives), then forwards to `scripts/e2e-local.sh` for always-isolated execution (mock auth + Docker DB + cached `.next-e2e/` build). Typical runtime: ~20-30s steady-state (cached build hit), ~90s on cold cache (first run after source-change). Pre-2026-05-19 the script ran against the dev `.next` build directly and was gated by a live-database guard; the refactor to an always-isolated flow eliminates the needs-prod-data bounce + manual escalation pattern that fired on every audit-check invocation.

3. If failures surface, categorize:

   | Test | Root cause | Category |
   |---|---|---|
   | example.spec.ts:N | cookie banner overlay / hydration race / shared-state pollution | (c) infrastructure miss |
   | other.spec.ts:M | feature behavior wrong in browser | (a) real regression |
   | flaky.spec.ts:P | passed on retry | (b) flake — fixed in `<sha>` / blocked: `<named blocker>` |

4. For each failure, decide:
   - **(a) Real regression** (UI behavior wrong): block COMPLETE, route back to `/agent-work`. Same posture as Check 9 legitimate-regression.
   - **(b) Flaky / retry-passed**: find the cause and fix it in this pass (a slow arm made fast, never a longer timeout); log it only with a named blocker — no flaky test is allowed to exist. Don't block COMPLETE on it once fixed or blocker-logged.
   - **(c) Infrastructure miss** (cookie banner, fixture timing, env gap, shared-state pollution): inline-fix if ≤15 LOC per the 5-line rule (extended to 15 for e2e test-fixture edits since they span helper patterns).

4a. **Classification provenance (stale classification re-verify, mandatory for `(b)` + `(c)`).** For every failure NOT promoted to `(a)` — i.e., labeled flake or pre-existing infrastructure — record in the Check 10 output table:
   - **commit-hash at classification time** (`git rev-parse HEAD`)
   - **surface-file list** — which source files the failing test exercises (trace locator targets via `grep -h "page.locator\|getBy" tests/e2e/{spec}.spec.ts` then resolve to component files)

   Example row:
   | Test | Root cause | Category | Classified-at | Surface files |
   |---|---|---|---|---|
   | example.spec.ts:117 | button click timeout | (c) pre-existing | `<sha>` | `<surface-file-1>`, `<surface-file-2>` |

   **Why:** `(c)` classifications become stale the moment a later session commit modifies any listed surface file. Evidence: one session classified 5 specs as `(c)`; a later feature fix added a `disabled` gate to a dialog component — the exact button those tests clicked. The label carried forward, and the root cause surfaced only when a re-run was explicitly asked for. Cost: ~5 min + 1 extra commit.

   **Consumer of this data:** `/wrap` Step 1b runs a stale-classification sweep — for each `(b)`/`(c)` entry in this session's audit-check outputs, `git diff --name-only <classified-at>..HEAD` vs the surface-file list. If any match, re-run the test before closing the session. Without the provenance record, the sweep has nothing to check against.

5. Full suite is still gated on pre-push hook — Check 10 runs the fast delta only (~2-3 min typical). Check 10 vs pre-push hook: Check 10 runs at feature-COMPLETE boundary (earlier catch); pre-push runs at merge boundary (last-line safety net). Neither is redundant with the other.

**FAIL if:**
- Any (a) real regression present
- Delta-e2e script exits non-zero AND failures are not all classified as (b) or (c)-fixed

**Inline-fix during audit (5-line rule extended to 15 for e2e test-fixture edits):** cookie-banner dismiss patterns, hydration-wait additions, selector narrowing. These are mechanical test-infrastructure fixes that don't change feature behavior — the 5-line rule is too tight for them.

**Escape hatch:** if this audit explicitly does not touch UI (e.g., pure backend refactor, ops-register item), mark Check 10 as `N/A — non-UI audit` and skip.

**Where Check 10 moved from:** originally landed as `/wrap` Step 1a (2026-04-16 first codification). Relocated to `/audit-check` Check 10 the same day after meta design-decision review concluded test gating belongs at feature-boundary (where a feature is marked COMPLETE), not session-boundary. `/wrap` now reports per-audit Check 10 outcomes in its session summary but doesn't itself run e2e.

### Check 11: Process-Log Existence Gate (conditional — 7+ expert panels only)

**Goal:** Confirm the v2.7.2-mandated process-log file exists for any audit that used a ≥7 expert panel. **(Threshold lowered 9→7 on 2026-06-19 to match the ≥7 process-log *creation* threshold `/expert-review` broadened on 2026-06-14 — a 7-8-expert panel now WRITES a process-log, so the gate must verify it exists; the gate previously lagged at ≥9, leaving 7-8-expert logs ungated.)** Closes a finding of an earlier system audit: 8 qualifying final-audits (all with ≥9-expert panels, the original motivating set) shipped with zero process-logs. The original trigger ("first process-log reveals drift") is structurally unfalsifiable until the log gets written.

**Applies to:** features where `/expert-review --final-audit` ran with ≥7 experts (check the Panel Playbook sections across `.claude/skills/meta/MEMORY*.md` for this feature's row — the glob, as step 1 below says, because the router alone reads 0 — OR grep synthesis output for expert count).

**Steps:**

1. **Determine panel size from meta MEMORY Panel Playbook.** `grep -A 10 "F{N}\|Flow #{N}" .claude/skills/meta/MEMORY*.md | grep -i "panel size"` — ⛔ **the GLOB is load-bearing: `panel size` reads `0` on the router alone against `17` across the shards (measured 2026-09-09), and a zero here silently marks every check `N/A — <7 expert panel`**. If panel size <7, mark Check 11 as `N/A — <7 expert panel` and skip.

2. **If panel size ≥7, look for the process-log file.** Two canonical patterns:
   - `plans/{feature|flow}-{name}-process.md` (feature/flow audits)
   - `plans/external-audit-{subject}-process.md` (workspace audits from `/external-audit`; pre-2026-06-17 logs are named `plans/expert-audit-*`)

3. **Verify file content.** If file exists, confirm:
   - Has per-expert verbatim output section (one per expert — a real log has ≥3)
   - Has convergence + synthesis notes
   - Not empty / placeholder

4. **FAIL if:**
   - Panel size ≥7 AND no matching process-log file exists
   - Panel size ≥7 AND process-log is empty / placeholder / has <3 expert sections
   - Synthesis output references a process-log path that doesn't exist

**Inline-fix during audit:** if the audit session is still warm (orchestrator has expert outputs in context), write the process-log file using the template at top of your own process-log exemplar (`plans/expert-audit-claude-system-process.md`, not in this copy). Per-expert verbatim + topic-grouped synthesis + convergence callouts + defense list. This is the fix — don't route back to /agent-work.

**Skip rule:** If the feature's audit used <7 experts (typical for spot/lean audits), Check 11 is N/A. Only full `/expert-review --final-audit` or `/external-audit` reaches the threshold.

**Why here:** process-log is an audit-quality artifact — belongs in audit-check. If the log gate lived only in `/expert-review`, orchestrators could bypass by running final-audit-equivalents via spot panels + manual synthesis. Placing the gate at the COMPLETE boundary catches both paths.

---

### Check 12: Verification-Before-Completion Gate

**Goal:** Confirm that every "COMPLETE" / "PASS" / "verified" claim in the audit summary is backed by a FRESH proving-command run within the audit's own time window. Closes a three-expert convergence from an earlier review round. Pattern source: the Iron Law of Superpowers' `verification-before-completion` skill — a claim that work is done must rest on proof produced just now, not earlier. Complement to Check 9 (test run gate) — Check 9 enforces tests pass; Check 12 enforces the orchestrator actually re-ran them THIS audit.

**Applies to:** every `/audit-check` invocation that produces a PASS verdict. Bypasses only on FAIL outcomes (no completion claim to verify).

**Steps:**

1. **Scan synthesis output for completion claims.** Grep keywords: `COMPLETE`, `PASS`, `verified`, `confirmed`, `tests green`, `build clean`, `migration applied`, `no regressions`. Each match = a claim that needs fresh evidence.

2. **For each claim, verify the proving command ran in THIS audit.** Acceptable proving commands by claim type:
   - "tests pass" / "tests green" → `npx vitest run` (unit), `npm run test:integration` (integration), `./scripts/run-changed-e2e.sh` or `npx playwright test --project=desktop --project=mobile` (e2e) — output saved to /tmp/*.out per Check 9 step 2
   - "build clean" / "no type errors" → `npx tsc --noEmit` — output captured
   - "migration applied" → migration apply log saved (per `/migration` skill)
   - "e2e passes" → delta-e2e or full-suite per Check 10
   - "feature works" → manual walkthrough OR functional test run, with output cited
   
3. **Check timestamp on proving-command output.** If `/tmp/vitest.out`, `/tmp/integration.out`, `/tmp/tsc.out`, `/tmp/e2e.out` exist, check mtime. **Must be within last 30 minutes** of the audit's PASS write. Stale output (>30 min) → fail this Check 12 row.

4. **Banned hedging language scan.** If the synthesis contains any of these tokens in completion-context, FAIL:
   - "should pass" / "should be green" / "should work"
   - "probably fine" / "probably OK" / "probably passes"
   - "seems to be working" / "appears to..." / "looks good"
   - "Done!" / "Perfect!" / "Ready!" — without proving-command output
   - "I believe..." / "I think..." — when followed by a completion claim

5. **Present a table:**

| Completion claim | Proving command | Timestamp | Hedging language? | PASS/FAIL |
|---|---|---|---|---|
| tests green | `npx vitest run` | 2026-05-18T10:25Z (3 min ago) | none | PASS |
| build clean | `npx tsc --noEmit` | 2026-05-18T10:23Z (5 min ago) | none | PASS |
| e2e passes | `./scripts/run-changed-e2e.sh` | (no output found) | "should pass" detected | **FAIL** |

**FAIL if:** ANY completion claim lacks a fresh (within 30 min) proving-command output, OR ANY hedging language appears in completion-context.

**Inline-fix during audit:** if a completion claim is hedged or stale, re-run the proving command BEFORE the audit closes. Update the synthesis to cite the fresh output. Don't mark COMPLETE on stale evidence.

**Skip rule:** if the audit's verdict is FAIL (any earlier check failed), Check 12 is N/A — there's no completion claim to verify because COMPLETE isn't being asserted.

**Why here:** completion claims are the audit's load-bearing output. Without Check 12, orchestrator can pencil-whip "tests pass" based on memory from earlier in the session. Empirical evidence (wan-huiyan v3.3 Live-State Claim Discipline + Superpowers `verification-before-completion` Iron Law): 3 external systems independently arrived at "verify completion claims at audit-close" as load-bearing discipline. Check 12 brings us into convergence with that pattern.

**Pattern provenance:** Superpowers `verification-before-completion.md` Iron Law + wan-huiyan v3.3.0 Live-State Claim Discipline + shinpr Design-Sync Agent (artifact-level consistency verification). Our adaptation: tie to /audit-check (which already gates COMPLETE) rather than a separate pre-emission check.

---

### Check 13: Fix-Wave Review Gate (conditional — full-audit mode, threshold-met OR codified-policy-copy waves)

**Goal:** verify the `/expert-review --code` fix-wave diff review (expert-review SKILL §Final Audit Step 2b) actually RAN when the audit's fix wave met the size threshold. Workflow-integrity-shaped — this check VERIFIES the step happened; it never runs the panel itself. (Naming note: in `--v3-drift` mode, Check 13 is the v3 Workflow Integrity Gate — same verify-the-step-ran shape, different step.)

**Steps:**
1. Compute wave size: `git show --stat <wave-commit(s)>` → file count + changed LOC under `src/` (exclude `tests/**` from both). **Threshold-met = (≥15 files OR ≥400 src-LOC) OR the wave touched codified-policy/legal copy** (`terms/`·`privacy/` ToS/Privacy pages, statute cites, `src/types/index.ts` PRICING/PLAN_LIMITS, refund/withdrawal/content-policy copy). If neither the size NOR the domain trigger fires → `N/A — wave under --code threshold`. **Domain rationale:** a ≤2-line legal-copy edit can introduce a statutory inaccuracy (wrong AB 2863 subdivision) the multi-expert audit + /audit-check both pass — size is the wrong gate for correctness-dense legal copy. **Revisit (SC-3):** if 3 codified-policy-copy waves get a `--code` pass with zero findings, the domain trigger over-fires — relax toward size-only.
2. If threshold met, find evidence the review ran: a wave-review synthesis section in the process log (`plans/*-process.md`), OR the in-session `--code` synthesis, OR a follow-up commit citing it (e.g. `fix(F#): --code review fix pass`).
3. Spot-verify builder≠breaker: the review panel must exclude the wave's authoring expert lenses.

**FAIL if:** threshold met AND no evidence the wave-review ran — the audit may carry unreviewed fix-wave defects. **Inline-fix:** run the review now (Step 2b spec); it is cheaper than shipping the classes it catches.

**Evidence:** one feature's v3 audit (2026-06-12) — a review of the wave after a 12/12 PASS caught 3 verified serious findings, all in wave-new code: clamp sibling-asymmetry, carve-out residual score-clamp contradictions, ICU grammar defect ×12 locales. Codified same day. **Revisit (SC-3):** N=1 basis — if 3 consecutive threshold-met wave-reviews surface zero P1s, this check and Step 2b demote to optional together.

---

### Post-Gate Action: Commit Session-Scoped Files

After every check PASSes (or Check 10/11/12/13 is N/A), commit the files scoped to THIS audit — don't defer to `/wrap`. Audit-PASS is the commit trigger, not session-end. Each feature gets its own commit (clean history, easy revert).

**Scope:** files touched by THIS audit only:
- Tracker entry update (e.g., `memory/project_critical_flows.md` row flipped to COMPLETE) — **plus the matching `Audit Tiers` token key stamped in the SAME edit** (Stamp-on-audit, below)
- `todo.txt` entries added for deferrals (Check 8)
- Inline fixes applied during any check (5-line rule / 15-line rule for e2e fixtures)
- QA plan appends (if qa-expert participated — manual tests → QA plan Part 7)
- Expert MEMORY entries from the audit session (SHARED MEMORY rule — co-commit per shared-memory append discipline)

**Exclude:** parallel-session work, meta hygiene, ops docs not specific to this audit — those are `/wrap` Step 8's job.

**Stamp-on-audit (extends the tracker COMPLETE flip).** When this gate flips Status→COMPLETE, stamp the matching `Audit Tiers` token key **in the SAME tracker edit as the Status flip** — this is the token column that `/flows`·`/features`·`/ops` `list` renders into date columns. `/audit-check` is the GATE, not its own tier: it never adds a column; it stamps the key of whichever audit it just closed, dated today (the close date):
- closing an initial audit + fixes → `v1:YYYY-MM-DD`
- closing a `/expert-review --final-audit` cycle → `v2:YYYY-MM-DD`
- closing a `--v3-drift`/redo cycle → `v3:YYYY-MM-DD` (`/audit-check --v3-drift` mode)
- a `--code` fix-wave review that landed in this cycle → `c:YYYY-MM-DD`

Flow/feature rows use keys `v1/v2/v3/c`; ops-register rows use `prov/c` (stamp `prov` with the audit provenance — an independent date or the inherited `via-F#`). This is the tracker COMPLETE flip's Status-flip co-commit discipline extended to the tier token: the column rots into drift surface unless stamped at close — the same reason Check 6's mechanical row-update verification co-edits the Status↔Final-Audit pair.

**Execution:** follow the shared **Commit procedure** (canonical copy in `/wrap` SKILL.md). Same classification + safety rules.

**Commit message:** `{scope}({feature-id}): {one-line COMPLETE summary}` — example: `feat(F<N>): <feature> final audit — 10/10 COMPLETE (migration <NNNN> + <N> tests)`. Include migration numbers if any, test delta if material.

**Skip rule:** if audit was read-only verification (no fixes, no tracker update, no todo adds, no memory updates), skip commit silently. `/audit-check` that produces zero writes doesn't commit.

**Why here not /wrap:** a session can run 3 `/audit-check`s on 3 different features; each should be its own commit for clean revert + clear history. `/wrap` Step 8 picks up the residual (meta work, session-memory, unrelated fixes) after all feature commits have landed.

---

## Output Format

⛔ **The trailing `Receipts:` row is RETIRED for OWNER-FACING output.** The obligation moves INTO the prose: any verdict claim not checked this turn — the N/N PASS line above all — says so in its own sentence. The notation still ships in peer mail and commit bodies.

```
## Audit Quality Check: F{N} — {Feature Name}

### Check 1: Deferral Audit — PASS/FAIL
[Table + details]

### Check 2: Fix Verification — PASS/FAIL
[Table + details]

### Check 3: Test Quality Audit — PASS/FAIL
[Breakdown table + P0/P1 coverage]

### Check 4: "Acceptable" Claims Audit — PASS/FAIL
[Findings]

### Check 5: Expert Memory Consistency — PASS/FAIL
[Stale entries if any]

### Check 6: Tracker Accuracy — PASS/FAIL
[Discrepancies if any]

### Check 7: Cross-System Registration — PASS/FAIL
[Missing registrations if any]

### Check 8: Deferral Promotion to todo.txt — PASS/FAIL
[Table of deferred items + todo.txt presence + trigger format]

### Check 9: Test Run Gate — PASS/FAIL
[Unit pass/fail counts, integration pass/fail counts, tsc status, any inline-fixed stale tests]

### Check 10: Delta E2E Gate — PASS/FAIL/N-A
[delta e2e result when feature touched tests/e2e/**, src/app/**, or src/components/**; categorized failures (a/b/c); inline fixes applied. `N/A — non-UI audit` when feature didn't touch those paths.]

### Check 11: Process-Log Existence Gate — PASS/FAIL/N-A
[When this feature used ≥7-expert panel per Panel Playbook, confirm plans/*-process.md exists with per-expert verbatim. `N/A — <7 expert panel` when panel was smaller.]

### Check 12: Verification-Before-Completion — PASS/FAIL/N-A
[For each completion claim (COMPLETE / PASS / verified / tests green / build clean), verify a fresh proving-command output exists within last 30 min + scan for hedging language (should/probably/seems/Done!/Perfect!). `N/A` when audit verdict is FAIL.]

### Check 13: Fix-Wave Review Gate — PASS/FAIL/N-A
[When the fix wave met the --code threshold (≥15 files OR ≥400 src-LOC, tests excluded), confirm the /expert-review --code wave-review ran with a builder≠breaker panel. `N/A — wave under --code threshold` otherwise. (--v3-drift mode: Check 13 is the Workflow Integrity Gate instead.)]

### VERDICT: READY FOR COMPLETE / NOT READY
[Summary of failures + what needs to happen. All checks must pass (or Check 10/11/12/13 be N/A) for COMPLETE.]
```

**Naming convention (mandatory in output):** Feature IDs render as `F{N}` (e.g., `F5`); flow IDs render as `Flow #{N}` (e.g., `Flow #5`). Never write bare `F{N}` for flows — the `F` prefix is reserved for features. Numbers 1-16 collide across both trackers, so the prefix/marker must be explicit in every header and reference.

## Execution Rules

- **Fix during audit.** If any check finds a fix that's <5 lines (typo, stale reference, missing registration), fix it directly during the audit. Don't just report it. The audit-check is not a read-only scanner — it's empowered to make trivial corrections.
- **Inline-fix vs finding heuristic (5-line rule, codified):**
  - **Inline fix when ALL apply:** (a) ≤5 lines of change OR a single-operation delete; (b) no business-logic change (typo, stale ref, missing registration entry, single string update, single class-name swap); (c) no test required (or test is also ≤5 lines and obvious); (d) no design decision needed.
  - **Becomes a finding when ANY apply:** (a) >5 lines of change; (b) touches business logic, validation, or data flow; (c) requires a new test or test refactor; (d) needs a design decision (e.g., "should we delete this stale file or label it smoke?").
  - **Edge cases:** Big delete operations (e.g., deleting a 500-LOC stale file) ARE inline-fixable IF coverage is verified first AND the precedent is established by earlier audits. New i18n keys propagated to multiple locale files = inline OK if mechanical.
  - **Apply to your own output:** if `/audit-check` finds <5 lines worth of corrections, write them in the same turn — don't list-and-defer.
- **Minimum-viable inline fix (meta).** When an inline fix is warranted, change ONLY the violating line — never couple a rename, semantic improvement, or "while we're at it" restructure with a pure-correctness fix. Evidence: a reconciliation fix dropped an invalid value from an allowance-source field (1-line correctness fix, correct) AND added per-event-kind suffixes to an event-type field (gratuitous rename) — the suffixes broke unrelated reconcile tests. Every inline fix asks: "what's the SMALLEST change that resolves the violation?" before writing. If tempted to improve surrounding code, flag it as a separate finding instead.
- **Report to /meta.** After the audit completes, notify `/meta` by appending findings to the Review History in the **CURRENT `MEMORY-ARCHIVE-*.md` shard**, resolved by MAX END-DATE — ⛔ **never to the router file itself: an append there is silently discarded by the next heal or roll.** Resolver: `.claude/skills/meta/references/process-learn.md` (grep `Current shard by MAX END-DATE`) — do not hand-roll it, `ls -t` is mtime order and returns the wrong shard.
- **Verify tracker updated.** Before marking COMPLETE, confirm the flow/feature tracker entry in project memory has been updated to reflect the final status, test counts, any deferrals resolved during implementation, and the `Audit Tiers` token key stamped for the audit just closed (Stamp-on-audit, Post-Gate Action).
- **Green-light a waiting peer (cross-session `mail-await`, 2026-06-21).** If a peer armed `mail-await --signal <tok>` waiting on THIS audit's pass, emit the go on final PASS: `python3 scripts/session-manifest.py mail-send --to <sid8> --signal <tok>`. (A peer using `--peer-done <your-sid>` instead is woken automatically when you `/wrap` or `/exit` — only the explicit pre-wrap green-light needs this step.) See `/mail` → "Process — await".

## Integration with /expert-review

The `/expert-review --final-audit` process should automatically suggest running `/audit-check` before marking a feature COMPLETE. Add this to the final audit workflow:

> After the final audit synthesis is presented and fixes are implemented, run `/audit-check F{N}` before changing status to COMPLETE. This is not optional — it catches the patterns that expert panels miss (lazy deferrals, source-grep tests, missing fixes).

## Integration with /meta

After every `/audit-check` run, append to `/meta`'s Review History in its CURRENT `MEMORY-ARCHIVE-*.md` shard (never the `MEMORY.md` router — see "Report to /meta" above) with:
- Which checks passed/failed
- Any patterns that repeat across features (e.g., "third feature in a row where Check 3 finds source-grep P0 tests")
- Whether the check caught something the expert panel missed

## Principles

This skill exists because of patterns discovered during audits:

**In one feature audit:**
- 15 fixes were initially deferred as lesser-severity "later" items — all were <15 lines
- 79% of the feature's tests were source-grep (readFileSync)
- The auth gatekeeper had zero behavioral tests
- A fully-built component was loaded but never rendered
- "No obvious deferrals" was stated without checking

**What the check looks for in a flow's final audit:**
- Items labeled "monitor later" that are 1-5 line fixes (a tier gate, a threshold, a copy fix, a query limit)
- "Integration tests" that turn out to be `readFileSync` + `extractFunctionBody` labeled "behavioral"
- A new message type that every user-preference check must know about but that is not registered where those checks read
- A schema default changed without the matching default in the service code
- A redundant source-grep test file left beside the real integration test for the same P0 findings

Trust nothing. Verify everything. Read the code before claiming anything.
