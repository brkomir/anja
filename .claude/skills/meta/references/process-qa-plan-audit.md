Cadence-fired consolidation audit for `QA_TESTING_PLAN.md` — the doc-maintenance complement that `architecture-audit` is for `.claude/docs/architecture.md`. The QA plan accretes via `/expert-review` Synthesis Guideline 13 (every qa-expert panel appends manual tests to Part 7) and nothing consolidates → it drifts: superseded-duplicate flows, dead-premise items, items now covered by automated tests, and safety-wording drift. This subcommand is the periodic sweep. Codified 2026-06-19 after a consolidation pass turned up ~110 prunable items + a serious safety-wording defect across 14 months of accretion (built at N=1, with the usual recurrence bar waived).

**Distinct from `/meta architecture-audit`:** that audits the meta-system reference doc (count / L#-ref / date-currency drift, auto-fix). This audits the product QA artifact (stale-premise / superseded-duplicate / now-automated / safety-wording drift). Different doc, different drift classes. **Distinct from `/meta doc-content-audit`:** that is a claim-verification prose-rewrite pass on a conceptual/state doc; this is a structural consolidation of a checklist artifact.

**When to run (any fires):**
- Part 7 exceeds ~60 flow-subsections, OR ≥8 flows carry a duplicate subsection (structural bloat).
- Before any blocker pass (freshness gate — testers must not chase closed gaps).
- ~Quarterly proactive, OR after a batch of `/expert-review` final-audits appended to Part 7.

**Args:** `--strict` — treat any Tier 1 finding (dead-premise OR dangerous-wording) as failure, exit non-zero (CI / auto-fix flows). Default = warn + inline report.

**Steps:**

1. **Inventory.** Line count; Part-7 subsection count (`grep -cE '^## Part 7|^## Flow #' QA_TESTING_PLAN.md`); checkbox-item count (`grep -cE '^\s*- \[[ x]\]'`); Part-7 % of file. Flag if subsection count >60.

2. **Tier 1 — superseded-duplicate sweep (auto-fix).** Group Part 7 subsections by Flow #N / F#. Any flow with ≥2 dated subsections → the older one(s) MUST carry a `> ⚠️ SUPERSEDED by …` tombstone (per the Part-7 maintenance protocol). Missing tombstone = finding; auto-fix inline (insert the tombstone above the older block, citing the latest redo's date). Report the duplicate-flow count.

3. **Tier 1 — dead-premise detection (auto-fix ≤5-line).** For each item citing "once X is built" / "verify when Y ships" / "gap noted" / "decision pending" / "POST-LAUNCH-WHEN-Z" / a `rg "…"` sweep instruction: grep-verify the cited condition against CURRENT state (code / DECISIONS.md + DECISIONS-ARCHIVE-*.md / tests/ / messages/). Gap closed / flow shipped / sweep returns zero / decision locked → STALE. Auto-fix ≤5-line rewrites (strike + done-note, or repoint to the live redo block); surface larger rewrites as proposals. (Examples from the first run: a flow since shipped, a copy sweep that now returns zero hits, a locale bundle that now has CLDR plurals, a "decision pending" since locked.)

4. **Tier 1 — dangerous-wording guard (RED, never silent-fix).** Grep for any step instructing real illegal-content handling (an upload, fixture or staging step that names real illegal material). Any hit instructing sourcing/uploading/storing real illegal material (vs the safe proxy the plan names) = a P0 safety finding. Cross-check the §3.1 proxy-only banner exists. Surface RED + propose the reword — NEVER silently rewrite safety copy.

5. **Tier 2 — already-covered detection (pointer proposals, NEVER auto-delete).** Cross-reference manual items against the `tests/` inventory (`ls tests/e2e/*.spec.ts tests/integration/*.test.ts tests/*.test.ts*`). A manual item naming a flow/behavior with an obvious spec counterpart (`flowN-*.spec.ts`, `fN-*.test.ts`) → ALREADY-COVERED pointer candidate. **Surface as proposals only:** name-match ≠ assertion-match (the spec may assert a SIBLING property — verify the target spec's actual assertions per assert the literal the code reads), and per-row MANUAL residue (real-device / real-inbox / Paddle-sandbox / AI-judgment) must be preserved. Conversion is owner-reviewed per pointer. **Calibration (1st run 2026-06-19): a naive "item cites a `.spec.ts`" grep OVER-counts ~3× — most Part-7 items reference a spec for CONTEXT while being genuine-manual (real-Paddle-sandbox / real-device / AI-tone). Filter to items that EXPLICITLY say "covered by X" / "automated: X" OR whose cited spec actually ASSERTS the item's behavior — NOT items that merely mention a spec. The genuine pointer-able Part-7 subset is small (~5 on the first run); Part 7 is mostly the irreducible manual core by design.**

6. **Tier 3 — bucket-split estimate + freshness.** Estimate the manual-required / already-covered / stale / automatable split (grounded against the test inventory). Parse the header `Last updated:` date; flag GREEN <90d / YELLOW 90-180d / RED >180d.

7. **Output 3-tier report** (inline, no file): Tier 1 (auto-fixed dead-premise + tombstones; RED dangerous-wording), Tier 2 (pointer-candidate proposals), Tier 3 (bucket split + freshness). Bump `Last updated:` only if auto-fixes landed.

**Auto-fix rule:** Tier 1 dead-premise ≤5-line rewrites + missing tombstones apply inline; dangerous-wording surfaces RED (never silent-rewrite safety copy); Tier 2 pointer conversions surface as proposals (name-match≠assertion-match); Tier 3 surface for owner. Stage explicit pathspecs; one `meta(qa-plan-audit):` commit.

**Skip rule:** zero findings across tiers → one-line `QA plan clean — no drift since {Last updated}` + bump the date. Don't generate empty work.

**Anti-scope:**
- NOT a tracker entry in `/ops` or `/features` (doc-maintenance is the wrong category for those — the category question is exactly what triggered building this).
- Don't bulk-delete already-covered items — convert to pointers, owner-reviewed, assertion-match-verified.
- Don't fold Part 7 into Parts 1-6 (the audit-date grouping IS the provenance).
- No companion script yet (N=1) — prose-driven. Promote to a `scripts/qa-plan-audit.mjs` count-detector (the `architecture-counts.mjs` shape) only if this recurs AND the manual greps prove repetitive across 2+ runs.

**Revisit:** if this runs 3× with zero Tier 1 findings, the Part-7 tombstone-on-re-audit protocol is working and the cadence is too aggressive — extend. If it consistently surfaces dead-premise items, the protocol's tombstone/freshness step is being skipped at append time — tighten `/expert-review` Synthesis Guideline 13. If the manual greps prove repetitive, build the companion script. Consider adding as a `/meta maintain` member once the cadence is calibrated.
