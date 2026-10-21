# `--v3-drift` mode — full spec (extracted from SKILL.md)

> Extracted, with the copy's edits, from `expert-review/SKILL.md` (was lines 33-95) on 2026-07-02 —
> an audit finding: the router hit 797/800 (unconditional BLOATED_SKILL
> threshold); this is the rarest-invoked, fully flag-gated mode, so it moved one Read away.
> The router keeps the fire/skip conditions; THIS file is the MANDATORY pre-panel Read.

### v3 Drift Audit mode (`--v3-drift`)

**When to fire:** before launch, on any ✅ COMPLETE audit whose v2-date is ≥30 days old AND `python3 scripts/audit-drift-detector.py --target <id>` reports HIGH triage (since 2026-10-06: ≥50 commits on the audit's own code since it, or domain score ≥25 — keyword-matched lessons ×2 + decisions ×3 — with ≥10 commits; migrations and cross-audit hits never make HIGH; the report's footer prints the live rule). Drift sources are cumulative since v2-date and may have INVALIDATED conclusions OR INTRODUCED new findings.

**Why drift-only, NOT full re-audit:** v2 audited the THEN-current state at T1. Findings that didn't exist at T1 can ONLY come from drift sources (new code/migrations, DECISIONS §s, L# lessons, cross-flow interconnections). Re-auditing UNCHANGED surface produces noise + invites re-litigation of settled decisions without v2 context. Drift-only preserves v2 conclusions unless drift invalidates them + sharpens findings to the actual gap.

**Process (replaces Step 1-2 of full mode for v3 drift):**

1. **Run drift detector for target.** `python3 scripts/audit-drift-detector.py --target <F# | N for Flow #N | O# for an ops row>` (`--target 'Flow #<N>'` matches nothing; `--target <N>` does). Capture the drift-item lists (L#s, DECISIONS §s, migrations, cross-flow audits).

   **1a. Post-v2 commit-grep on target surface (MANDATORY, closes a detector blind spot an earlier v3 audit found).** The detector keys on codified L#s + DECISIONS §s + migrations + tracker entries. Drift that lands as PURE CODE COMMITS without yet earning an L# / § / tracker-row entry is INVISIBLE to the detector. Example: when several new gates ship after an audit's v2 and BEFORE their L# codification, the audit's keyword filter misses them.

   ```bash
   # Run after Step 1, BEFORE Step 2 curation
   V2_DATE=$(grep -A2 "^| <target-id> " .claude/project-memory/project_*.md \
     | grep -oE '\b20[0-9]{2}-[0-9]{2}-[0-9]{2}\b' | sort | tail -1)
   git log --since="$V2_DATE" --oneline -- <target-surface-paths>
   # <target-surface-paths> = the "**Code paths:**" line Step 1's `--target <id>` prints: CODE_PATHS in
   # scripts/audit-drift-detector.py, one list per COMPLETE audit, every spec checked live by self-test arm 20.
   # (Four hand-written examples stood here until 2026-10-06; two of them named paths that no
   # longer exist.)
   ```

   Surface every commit whose subject does NOT have an L#/§ counterpart yet — add to curated brief as `[uncodified-drift]` items. The panel briefs flag these for v3 verification (drift detector cannot vouch for them).

2. **Curate the drift list manually.** The detector's keyword matching is broad; many surfaced L#s/§s/migrations will be coincidental matches, not genuine domain drift. Read each candidate header/title; cut entries that don't actually apply to the target audit's surface. The brief should carry the curated subset (typically 30-50% of the detector's raw output) PLUS Step 1a's `[uncodified-drift]` items, not the full detector dump.
3. **Compose panel (5-7 experts):**
   - **Core drift verification (3-4 experts):** 2-3 domain experts from the v2 panel scoped to the curated drift areas + 1 contrarian. **Brief:** 2 questions — Q1 (drift verification): "v2 audit completed YYYY-MM-DD; here are the N drift items in your domain — verify v2's findings still hold + identify any new findings introduced by the drift." Q2 (new-lesson application): "Apply the M new L# lessons codified SINCE v2 to this feature's code REGARDLESS of whether the code changed. Example: a lesson codified after v2 about how a shared helper must be called applies to every call site the audited feature already had, even when none of that code changed since v2. System complexity grew; fresh patterns may detect issues unknowable at v2 time."
   - **Standing additions (2 experts always, each with OWN brief framed around their distinct lens):**
     - **(s1) saas-architect cross-flow integration check.** Brief: "given the N cross-flow audits since v2 touched shared surfaces, do those integrations still hold for this feature's invariants? Surface any cross-flow contradictions."
     - **(s2) premortem-of-integrated-state** (rotating expert assignment — pick by domain fit). Brief: "after we apply the v3 drift fixes, what new failure modes are introduced by the integration? Klein-method 'project failed in launch week — first-paragraph cause?' applied to the post-fix state."
   - **Conditional additions (0-1, fires only on trigger):**
     - **(c1) haines-paywall-upgrade-cro:** if target touches paid-tier surface OR drift includes pricing/copy DECISIONS §s.
     - **(c2) legal-advisor:** if codified-policy drift includes regulatory (GDPR/AI Act/CAN-SPAM/DMCA touch in DECISIONS §s since v2).
     - **(c3) security-expert:** if migrations since v2 touch RLS/auth/PostgREST surfaces (grep `REVOKE|GRANT|RLS|policy|auth\.` against post-v2 migrations).
   - Total panel size: typically 5-7 (3-4 core + 2 standing + 0-1 conditional). vs full re-audit (10-12) = ~50-60% size, vs naive drift-only (3-4) = ~50% bigger but ~3× orthogonal coverage.
4. **Discipline to prevent v3 morphing back into v2:** the brief stays drift-focused for CORE experts; orthogonal experts get their OWN brief framed around their lens. Conditional experts only fire when their trigger condition is MET — not by default. If v3 routinely hits 7 experts on every audit, drift in the spec — re-trim the conditional triggers.

**Synthesis (replaces Step 7 of full mode for v3 drift):**
- Group findings by `[v2-still-holds]` / `[drift-introduced]` / `[new-lesson-detected]` tags so the synthesis output makes the drift-coverage gap explicit.
- **Inline-fix bias:** small drift (≤5 LOC fix per finding) → inline same-session. Larger drift → promote to v3+ follow-up wave (separate `/agent-work` task).
- Scope Confirmation Gate (Step 2a) still applies — present curated scope before writing artifacts.

**Step 3 — Verification gate (conditional; added 2026-06-23 on drift-pass evidence).** A v3-drift was *designed* assuming small (≤5 LOC inline) fixes — but it can surface a P0/P1 + a multi-file fix wave (one v3-drift shipped a serious finding plus a multi-locale fix wave out of a "v2 holds" pass). When the close ships fixes **beyond trivial-inline** (any P0/P1, OR a multi-file fix wave):
- **Run `/audit-check --v3-drift <target>` before stamping `v3 ✅`** — its Check 13 (Workflow-Integrity Gate) + the test-run / verify-before-completion gates close the post-fix loop, the same discipline the full `--final-audit` Step 3 mandates. (This gate has existed since 2026-05-25; the gap this clause closes is that the v3-drift *workflow never pointed to it* — invoking it relied on orchestrator memory.) If the close confirmed "v2 holds, zero fixes" → **skip** (nothing to verify).
- **Step-2b `--code` surfacing.** When the v3 fix wave crosses the Step-2b threshold (≥10 files / ≥250 src-LOC / ≥80 single-file / security·codified-policy) — OR is a security P1 partly authored by its finder — SURFACE "this warrants a builder≠breaker `--code` on the fix-wave diff" (at minimum a suggestion; the full-mode Step 2b builder≈breaker risk applies here too, since v3 fix waves are authored by the same experts that found the drift). Below threshold + low-risk (e.g. gate-mirror one-liners already covered by a completeness pass) → note it's available, don't force it.

**Tracker entry update:** target audit's row goes v2 ✅ → v3 ✅ with one-line drift summary + commit hash + which conditionals fired (e.g., "v3 ✅ 2026-05-25 commit `<hash>` — 3 drift-introduced findings, 1 new-lesson-detected, c3 security-expert fired"). **Stamp-on-audit:** in the SAME tracker edit, stamp the matching `Audit Tiers` token key — `v3:YYYY-MM-DD` (today's close date) for this drift close; `c:YYYY-MM-DD` when a `--code` wave lands fixes. (v1 initial / v2 final-audit closes are stamped by the subsequent `/audit-check` Post-Gate, which owns the COMPLETE flip.) This is the token column `/flows`·`/features`·`/ops list` renders into the `V1│V2│V3│--code` date columns; an un-stamped close re-creates the lifecycle drift this column set was built to kill.

**Process log:** write `plans/feature-F<N>-v3-drift-process.md` with verbatim per-expert output + curated drift list + synthesis-mapping footer (same shape as Full Audit's process log, scoped to drift evidence).

**Skip rules:**
- v2-date <30 days old → skip (no drift accumulated yet).
- `--target` reports LOW triage (drift score <12) → skip; v2 still holds.
- MEDIUM (drift score ≥12, domain score <25) neither fires nor skips by rule: the audit stays on the ranked list for an owner pick.
- Tracker entry has no v2 marker (only v1) → first run a `--final-audit` (not `--v3-drift`) since there's no v2 baseline to drift from.

**Anti-scope:**
- Don't re-litigate v2's settled decisions. Brief explicitly states "v2 conclusions held unless drift invalidates."
- Don't expand panel to >7. If pressure to add an 8th expert, re-trim conditional triggers.
- Don't run `--strict` mode (doesn't exist for v3 drift). Drift findings are advisory until inline-fixed or promoted.

**Revisit:** if 3 v3 drift audits ship in a row with zero drift-introduced findings, v2 calibration was over-engineered for staleness fear — extend default --target threshold (raise the domain-score HIGH cutoff). If a v3 audit surfaces a P0 security/compliance finding, the gap V2 left is real — promote v3 drift mode to a default pre-launch checklist gate.
