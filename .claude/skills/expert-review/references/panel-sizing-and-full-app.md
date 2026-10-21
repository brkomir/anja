# Panel Sizing — subject-blindness procedure and evidence; Full App Review Protocol — moved, with the copy's edits, from `.claude/skills/expert-review/SKILL.md` (split under the per-file size line, a growth signal and not a delivery limit, 2026-09-26)

## Two-pass mode — why split — from `SKILL.md` § Two-pass mode trigger (two-pass panel — strategic reviews)

**Why split:** mega-panel mixes diagnostic and design responses → hard to anchor design on agreed baseline. Pass-1 baseline corrections (the system-prompt size, the cache-hit rate, the payment provider's fee rate) corrected a material monthly error in pass-2's cost math on a profitability review (two-pass panel evidence).

## Subject-blindness check — the two moves, evidence and SC-3 revisit — from `SKILL.md` § Panel Size Estimation (mandatory for audits)

- **Dispatch from INSIDE the defect and make the lens an instrument.** Ask each affected expert to attempt the normal operation, then report three things: what happened · whether it would have NOTICED unwarned · what it would have done next. That converts "diagnose this" (which the blindness corrupts) into "report your own state" (which it cannot).
  - ⚠️ **ONLY THE FIRST IS AN INSTRUMENT — REQUIRE PASTED TOOL OUTPUT, and treat the other two as INTROSPECTION, labelled, never load-bearing alone.** "What happened" is auditable (the truncation notice, the error string, the exit code — verbatim, pasted, re-runnable). "Would you have noticed" and "what next" are a participant's self-report about its own behaviour, which `/fleet-inquiry` criterion 4 rules out as a measuring instrument (`fleet-inquiry/SKILL.md:19`, after the 2026-07-28 "34 errors, zero exceptions" withdrawal). **This clause does not overturn that — it partitions the report.** The lens in the founding evidence drew the line itself, unprompted: *"(b) and (c) are introspection about a counterfactual, not measurement"* — and then supplied a STRUCTURAL argument (no output-format field exists for it) that the orchestrator could verify independently. **That is the pattern: introspection points at a structural claim; the structural claim is what you check and what survives.**
- **PRE-REGISTER what each outcome means, in the brief, before seeing any of them.** This is the load-bearing half — without it the reading is chosen after the fact. Worked form: *"if they'd have proceeded silently, my claim holds; if they'd have noticed and said so, my row overstates it and I'll correct that too."* Name both branches or the test is decorative.

**Evidence.** The memory-read-ceiling panel: the four heavyweight experts WERE the oversized-memory files, so a panel drawn from them would have diagnosed a truncation defect while truncated. Dispatched from inside with both branches pre-registered, a lens returned *"for my own file — yes, certainly… I won't claim otherwise; that would be false modesty and would corrupt your data"* — refusing the flattering answer — and then supplied the structural finding that survived its own introspection caveat: **no expert output format has a field for "my memory load was partial"** (verified: zero hits for a memory-state field across all skill specs). The defect was real; the panel's ability to see it was not automatic. Companion to the skepticism-diversity check in `SKILL.md` § Panel Size Estimation (mandatory for audits) (that one diversifies PERSONALITY; this one asks whether the panel can perceive its subject at all) and to the frame-independence axis in `.claude/rules/behavioral-anti-patterns.md` § #9, Extension — non-diff self-review.

**⚠️ SC-3 revisit (mandatory — N=1-structural, not frequency-proven, same standing as Step 7a-ii).** This ships on one instance because the argument is structural — a panel drawn from the affected population cannot see its own blindness, independent of how often that happens — not because it has recurred. **If two further panels invoke this and NEITHER changes a verdict or surfaces a finding the ordinary composition would have missed, prune it as ceremony.** If it fires and the pre-registered losing branch actually wins (the claim gets narrowed rather than confirmed), that is the signal it is earning its place.

## Blast-radius override — evidence — from `SKILL.md` § Blast-radius override — when default sizes undercount

Evidence: on a high-blast-radius audit, a lean panel can return only hygiene-level findings while widening it (the domain experts the surface touches, then QA, operations and a contrarian) surfaces severe findings the lean panel missed and reshapes the implementation plan. Generalizes to any audit with comparable blast radius.

## Full App Review Protocol — waves, skips, between-wave and final synthesis — from `SKILL.md` § Full App Review Protocol

When the user requests a review of the entire app, run **all departments** in waves. Each wave is capped at 7 experts in a single parallel batch — split into sub-batches if needed.

**Wave 1 — Engineering & Security (6 experts):**
`saas-architect`(lead), `saas-engineer`, `security-expert`, `performance-expert`, `devops-deploy-expert`, `qa-expert`

**Wave 2 — Operations & Legal (3 experts):**
`launch-ops-expert`, `ops-monitor`, `legal-advisor`

**Wave 3 — Design & CRO (7 experts):**
`ux-design-pro`(lead), `web-designer`, `ux-copywriter`, `accessibility-expert`, `haines-page-cro`(lead), `haines-signup-flow-cro`, `haines-onboarding-cro`

**Wave 4 — CRO (continued) & Psychology (3 experts):**
`haines-paywall-upgrade-cro`, `haines-churn-prevention`, `engagement-psychologist`

**Wave 5 — Product & Content (6 experts):**
`saas-economist`(lead), `growth-analyst`, `saas-metrics-analyst`, `market-researcher`, `saas-launch-marketing`, `seo-content-strategist`

**Wave 6 — AI (2 experts):**
`prompt-engineer`(lead), `ai-vision-expert`

**Skip unless specifically relevant:** `brand-naming-expert` (dormant — product is named; invoke only if naming is part of the review scope). `newsletter-draft` is a content generator, not a consultation expert — never include in panels.

**Between waves:**
- Synthesize the current wave's findings before launching the next
- Pass critical findings from earlier waves as context to later waves (e.g., security issues inform UX recommendations)
- Present each wave's summary to the user so they can steer focus

**Final synthesis:**
- Merge all wave summaries into a single prioritized report
- Group by severity: Critical / High / Medium / Low
- Each finding must have: department source, specific issue, recommended fix, affected files
- End with a ranked action plan
