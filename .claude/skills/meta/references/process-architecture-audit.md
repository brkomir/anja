# /meta architecture-audit — full Process spec

*Extracted from `meta/SKILL.md` 2026-06-22 (BLOATED-skill reduction; the SKILL.md stub points here). Step numbers are load-bearing — cited by name in the meta skill's lesson and change records — preserved verbatim.*

## Process — Architecture Audit (subcommand: `architecture-audit`)

Cause-fix for the recurring `.claude/docs/architecture.md` staleness pattern. Symptom-fix is ad-hoc review (which surfaced 35 findings on 2026-05-18 prompting this subcommand). The doc serves three purposes (external map / stable baseline / articulator-of-theory) — all three degrade silently as the system evolves; without periodic audit they degrade until a contributor reads cold and notices stale counts.

**Distinct from `/meta self-audit`:** self-audit covers meta/SKILL.md, the meta skill's own memory and skill-corpus skill-lint. Architecture-audit covers `.claude/docs/architecture.md` specifically (a sibling artifact, not a skill spec, with different drift patterns — counts of enumerated things + cross-references between lectures + pointer-block-to-state.md staleness).

**Companion file (split 2026-05-23):** the architecture doc is now paired with `.claude/docs/state.md` (current health + failure modes; manually curated, full review every ~10 sessions per its own frontmatter — this line said "weekly" until 2026-09-27). When this audit examines fragility content (formerly Lecture 11 / 11.5), it operates against `state.md`, not `architecture.md`. The architecture doc's own drift surface shrank substantially after the split — current-state content no longer pollutes the durable reference.

**When to run:**
- Every ~30 days as proactive cadence.
- After ≥10 meta-system commits in a short window (high drift rate).
- When doc `last-reviewed` frontmatter is >90 days old (surfaced as YELLOW in `/meta status`).
- Before sharing the doc with a new contributor / external reader.
- After any session that adds a new entry-point / hook / rule / skill that affects lecture enumeration.

**Args:**
- `--strict` — Treats any Tier 1 finding as failure; exits non-zero. Use in CI / pre-merge / auto-fix workflows. Default mode is warn-only with inline report.

**Steps:**

1. **Read the doc.** `.claude/docs/architecture.md`. Parse `last-reviewed` frontmatter; flag if >90 days.

2. **Tier 1 — count + narrative drift.** Delegate to `scripts/architecture-counts.mjs` (shipped 2026-05-21 as part of the prevention stack; narrative-drift detectors added 2026-05-23 after a manual chapter-by-chapter audit surfaced 13 drift items that the original 16-pattern set missed):
   ```bash
   node scripts/architecture-counts.mjs check   # report drifts to stderr + exit 1 if any
   node scripts/architecture-counts.mjs fix     # apply auto-fixes (position-based, ≤5-LOC per fix)
   node scripts/architecture-counts.mjs list    # JSON of current filesystem state (22 keys at 2026-10-27 — derive with `list`, never from a number here; this line once read 17)
   node scripts/architecture-counts.mjs conceptual-due [YYYY-MM-DD]  # CUMULATIVE "is a real Tier-2/3 pass due since last-reviewed?" signal (see Step 10 invariant)
   ```

   **Detector classes:**

   - **Structural counts (exact match; the 16 named here plus `hooksWiredSettings`, `distinctLessons`, `selfAuditChecks`, `sessionManifestModes`, `metaEntryPoints` and `metaSubcommands` in `list`'s 22 keys at 2026-10-27 — this once read "17"):** `skills` / `agents` / `hooks` / `rules` / `commands` / `templates` / `projectMemory` / `externalSkills` / `domainExperts` / `personaSkills` / `metaMemoryLines` / `metaRulesRows` / `maxL` / `sniffTestTriggers` / `activeRecallHotTier` (= the always-loaded Band-U rows) / `activeRecallBandO` (= the hook-delivered orchestrator-only Band-O rows, added by the 2026-07-12 2-band split). Drift = any deviation from filesystem truth.
   - **Narrative claims (7, tolerance-bounded):** lesson count phrasings (`N numbered/distinct lessons in/with/(`, tolerance ±10) / L# range phrasings (`L1 (tag) – LN` or `L1–LN with renumber gaps`, exact) / meta/MEMORY.md size (`MEMORY.md ... ~N lines`, tolerance ±50) / active-recall hot tier (`top-N most-cited`, tolerance ±1) / meta/RULES.md row count (`~N rows` or `N-row catalog`, tolerance ±5). Tolerance > 0 because these claims are inherently approximate; auto-fix only triggers on out-of-band drift.
   - **Listing-vs-count (2, exact):** `Hooks (N files):` and `Rules (N files):` heading-vs-list mismatch. Listing block may span multiple sub-bullets (e.g., hooks split by Claude-lifecycle / Git-pre-push / Orphan enforcement surfaces).
   - **Appendix C coverage (2, surface-only):** L# cited in body but missing from Appendix C table (coverage gap) + L# in Appendix C table but no body citation (orphan row). Both surface as proposals; no auto-fix because adding a row needs curated summary text (Step 3c) and pruning an orphan is owner judgment.

   Auto-fix is position-based (locates exact number offset within match, splices replacement). Telemetry appends per-invocation summary to `.claude/logs/architecture-doc-drift.jsonl` for cadence calibration. The narrative-drift detectors require `in` / `(` / `with` follow-up context to distinguish count claims from threshold expressions (e.g., `286 numbered lessons in meta/MEMORY.md` matches; `advances by ≥10 numbered lessons` does not).

   For drift-eligible surfaces not yet covered by the script (e.g., persona MEMORY size, internal text contradictions outside the tracked metrics), fall back to manual inspection.

   **Range-endpoint convention (2026-05-30).** In `L1 (tag)–L<max>` range phrasings the **max-L endpoint carries NO per-lesson topic tag** — it churns on every codification, so a tag there always goes stale, and the script `fix` bumps the number but not the tag (leaving a number/tag mismatch). Keep only the stable tag of lesson 1, the range's fixed start; then `fix` on the tagless endpoint is clean (number-only). Correspondingly, `architecture-counts.mjs` **excludes range endpoints from the Appendix C coverage-gap check** — they denote the lesson *span*, not a content citation, so they never need an Appendix C row. Excluded: (a) lesson 1 (the first lesson, always present) + current max-L always; (b) **any L# whose EVERY body occurrence sits inside an `L#–L#` range span (span-only)** — position-aware, added 2026-06-08 after a stale mid-text range `L<a>–L<b>` tripped a phantom gap on its upper endpoint; an L# that ALSO appears standalone anywhere is a real citation and is NOT excluded.

3. **Tier 1 — L# reference verification + Appendix C regen check.** Grep every `L\d+` mention in the doc. For each, verify within current L-range (extracted in step 2). Stale L-refs (an `L<N>` above the current max-L) auto-fix to current range OR flag for manual repair if the topic-tag is missing (per the L# topic-tag convention, bare L-refs are the drift class — flag them).

   **Appendix C regen sub-check (added 2026-05-20 after the topic-tag ship; expanded 2026-05-20 for summary-curation discipline).** If the doc's `## Appendix C — L# Reference Index` exists, perform two distinct checks with different auto-fix behavior:

   (a) **Coverage check (automated detection, manual curation):** `scripts/architecture-counts.mjs check` now automatically surfaces (i) L# cited inline but missing from Appendix C (gap rows), (ii) L# in Appendix C with no body citation (orphan rows). Detection is automatic; resolution is owner judgment because adding a row needs a curated 1-line summary (per Step 3c manual-curation discipline) and pruning an orphan depends on whether the L# is still load-bearing for system documentation outside architecture.md. Retired/renumbered L#s explicitly cited in meta-commentary contexts (e.g., those in the renumber-drift note in `state.md` Part 1 § Structural gaps) are intentionally omitted from the appendix — don't count them as gaps. For genuine inline-but-missing rows: propose adding a placeholder with topic-tag from existing inline cite + summary `**TODO: curate** (auto-add from MEMORY title: <truncated 80-char title>)`. Surface as Tier 2 proposal.

   (b) **Topic-tag inline regen (auto-able, ≤5 LOC):** for L# refs that lack inline `(topic-tag)` parens per the L# topic-tag convention, derive tag from (i) existing tagged refs elsewhere in the doc, (ii) L# self-titles in MEMORY.md body, (iii) first 3-6 verb-noun keywords from lesson header. Apply via perl `\bL${N}\b(?! \()` substitution. Topic-tag regen IS mechanical-script-able (the pattern from the 2026-05-20 topic-tag ship): bash array of `N|topic-tag` pairs piped to perl with negative-lookahead.

   (c) **Summary curation (manual, never auto-execute).** Appendix summaries are ≤200-char curated descriptions of what each lesson teaches — NOT auto-truncated MEMORY titles (the 2026-05-20 initial auto-generation produced ~30% noisy summaries with `…` truncation mid-sentence). Surface as Tier 2 proposal: list rows needing curation (new L#s from coverage gap OR rows with `…` truncation OR rows where the title doesn't capture the lesson's actual teaching). User approval required before write — never auto-execute summary content. The 2026-05-20 quality bar: each summary should be owner-scannable in <10 sec + accurately describe what the lesson teaches (action-oriented, not title-rephrase).

   **L# drift class — renumber collisions (special case).** When an inline L# cite + appendix row use a topic-tag that doesn't match the current `^N. **` numbered lesson body in MEMORY.md, this is a renumber collision (the historical lesson body still exists under a `## YYYY-MM-DD — L<N>: ...` SECTION header, but the numbered slot was reassigned same-day to a different topic). Two-stage handling: **(stage 1, automatic Tier 3 surface)** don't fix the inline tag — the cited concept may still be load-bearing for the surrounding lecture's argument. Surface as Tier 3 proposal: "L# numbering drift on L<N>; inline cite refers to {concept}, current numbered lesson is {different-concept}; renumber-cleanup needed to give the historical lesson its own L#." Document in the appendix row with a `**L# drift note:**` paragraph. **(stage 2, on user approval — renumber-cleanup pilot)** assign the historical lesson a fresh L# at the end of MEMORY's numbering range; rename its `## YYYY-MM-DD — L<old>:` section header with a `> **Renumber history:**` block; sweep all references via `grep -rn '\bL<old>\b' .claude/` and update each call site to the new L# (RULES.md row citations, SKILL.md examples, architecture.md inline cites + appendix row, any project-memory pointers). The old numbered slot continues to hold whatever lesson currently occupies it. **Worked example (resolved 2026-05-20):** the anti-anchoring-filter lesson was given a fresh L# at the end of the range, while the task-tag file-ownership lesson keeps the numbered slot it was bound to at codification.

   Skip the whole sub-check if Appendix C absent (doc may have been simplified — not a failure).

4. **Tier 1 — version-bump verification [RETIRED 2026-04-22].** Semver version numbers were dropped after `v2.8.6` — the system is now versioned by date + lesson number (`L#`). `vN.N.N` references in the doc body are now frozen historical tags (a "v2.6.4 decision" stays v2.6.4), so there is nothing to bump. The step number is preserved (not renumbered) for anchor stability — same convention as Step 7 below; maxL/date currency is covered by the count step (Step 2) above.

5. **Tier 2 — cross-reference verification.** For each "see Lecture N" / "see `state.md`" / "see section X" reference, verify target exists. Stale cross-refs surface as proposals. (The 2026-05-23 split rewrote Lecture 11 in-place and removed Lectures 11.5/12 — Lecture 11 references are still valid; references to 11.5 or 12 by number indicate orphan content not yet retargeted. Corrected 2026-05-29 after spec text falsely claimed Lecture 11 was removed.)

6. **Tier 2 — `state.md` fragility list refresh.** Run separately on `.claude/docs/state.md` (companion file; manually curated, full review every ~10 sessions). For each entry in Part 1 "What is fragile", check if any has been resolved (mentioned in CHANGELOG / commit log / closed in MEMORY structural gaps). Resolved items get strikethrough markup proposal — OR promoted into the `## Status updates` section at the bottom of `state.md` if the resolution is durable.

7. *(Intentionally vacant — a former Tier 2 pointer-block check was merged into Step 5. The slot is preserved rather than renumbered because Step 8 ("Tier 3") is referenced by number in the meta skill's lesson and change records; renumbering would break those anchors and require rewriting append-only change history. Flagged and documented 2026-06-06.)*

8. **Tier 3 — open-ended drift.** For each lecture body, surface text patterns suggesting conceptual drift:
   - Statements describing "current approach" that conflict with recent commits.
   - "We adopted X" / "we rejected Y" claims that COMPARISON.md disagrees with.
   - Counter-examples or worked examples that cite specific commits — verify the commits still exist.
   - **Recent-structural-change coverage (added 2026-06-01 — the audit's own blind spot).** `architecture-counts.mjs` verifies HOW MANY of a thing exist; it is structurally blind to whether a recent structural change got lecture *prose*. So a Tier-1-clean run does NOT mean Tier-3 clean. Before concluding "no conceptual drift": `git log --since="<doc last-reviewed>" --pretty=format:"%s"`, filter to meta-system commits (`meta`/`memory`/`hook`/`skill`/`rule`/`orient`/`wrap`; drop flow/feature/code-refactor), and for each that introduces a NEW subsystem / split / flag / hook / mechanism, grep the lecture bodies for a prose hit. Zero hit = content-coverage gap → write the coverage (Tier-2 proposal, or inline if it's this session's own change). Evidence: the 2026-06-01 audit passed Tier-1 (26 count fixes) but the orchestrator declared "Tier 3: none" while 3 structural changes had zero lecture prose (byte-budget hot/cold split, watch-tier register, `/orient --prime`); a plain check of whether the doc covered recent changes surfaced all three.
   These are NEVER auto-fixed; always surface for owner review.

9. **Output structured 3-tier report** (inline, no file):
   ```
   ## /meta architecture-audit — YYYY-MM-DD

   **Doc last-reviewed:** {date} ({N} days ago — {GREEN <30 / YELLOW 30-89 / RED ≥90})
   **Meta-system commits since last review:** {N}

   ### Tier 1 — mechanical drift ({K} findings, {M} auto-fixed)
   | Location | Claim | Actual | Action |
   |---|---|---|---|

   ### Tier 2 — content coverage ({K} findings, {M} surfaced as proposals)
   | Finding | Suggested fix | Awaits approval? |
   |---|---|---|

   ### Tier 3 — conceptual ({K} findings, all surfaced for owner review)
   | Lecture | Concern |
   |---|---|

   ### Frontmatter update
   - last-reviewed: {old} → {new (today if any fixes applied)}
   ```

10. **Update `last-reviewed` frontmatter** to today IF any auto-fixes were applied in steps 2-4. NOT updated if all findings are Tier 2/3 (those are proposals; the doc isn't actually fresher until they ship).

    **INVARIANT — `last-reviewed` is the CONCEPTUAL anchor; a count-sync must NOT bump it (added 2026-07-01).** `last-reviewed` must mean "last time a genuine Tier-2/3 conceptual pass ran," because `architecture-counts.mjs conceptual-due` (Step 2) measures cumulative new-infra + new-lessons SINCE this date to decide whether a real pass is due. So: only a full `/meta architecture-audit` (which examines all 3 tiers) bumps it — a run that finds only Tier-1 drift still EXAMINED Tier 2/3, so it may bump. A bare `architecture-counts.mjs fix` / `/wrap` Step 7d count-sync must NOT bump it — and by construction it can't (the `fix` command never touches the frontmatter; only the orchestrator's Step-10 edit does). **Never add a `last-reviewed` bump to the count-sync path.** Why it matters: the 2026-07-01 audit found 7 count-sync commits had kept the numbers fresh + honestly left `last-reviewed` at 2026-06-23, yet a whole `/push`+`/deploy`+`/review-hub` subsystem (5 skills + 4 hooks + ~35 lessons) had accumulated un-integrated in the lecture prose while the calendar-age flag (`/meta status` Check 9) read GREEN the entire time. `conceptual-due` is the content-keyed signal that closes that blind spot — and it goes blind itself the moment a count-sync bumps the anchor. **Threshold** (tunable, calibrated on the 06-23→07-01 gap): `⚠️ CONCEPTUAL PASS DUE` fires at new-infra ≥ 3 OR new-lessons (max-L delta) ≥ 30; meta-commit count is shown as context only (commit-count is noise). Wired into `/wrap` Step 7d (unconditional) + `/meta status` Check 9c; surface-only, never blocks.

**Auto-fix rule:** Tier 1 ≤5-LOC mechanical edits (count corrections, stale L#-fix-to-current, maxL/date currency, last-reviewed date bump) execute inline same-commit. Tier 2 surfaces as proposals with proposed diff. Tier 3 surfaces as observations for owner review.

**Skip rule:** If no findings across all 3 tiers, output one-line `Architecture doc clean — no drift since {last-reviewed}.` + bump `last-reviewed` to today. Don't generate empty work.

**Strict mode (`--strict`):** Tier 1 findings → exit non-zero. Use case: a pre-merge CI step or a `/wrap` integration that fails if doc drift accumulates without fix. Not yet wired — when wired, gate behind 5 clean default-mode runs first per the warn-mode-before-block-mode discipline.

**Coordination with `/meta status`:** Check 9 in `/meta status` (`references/process-status.md`; this once read "Check 8") surfaces the doc's `last-reviewed` age as a YELLOW (30-89 days) / RED (≥90 days) flag. This subcommand is the action when the flag fires.

**Anti-scope:**
- Don't auto-rewrite lecture-body prose. Tier 2/3 surface as proposals; owner judges.
- Don't run on every `/meta` invocation — cadence is 30 days OR commit-count trigger, not session-frequency.
- Don't produce HTML / external dashboards. Markdown inline only.
- Don't bump `last-reviewed` if zero auto-fixes ran (Tier 2/3 proposals don't make the doc fresher).
- **Don't auto-fix count/listing drift caused by a parallel session's UNCOMMITTED feature.** If a flagged count belongs to an in-flight feature not yet committed (new hook/skill/rule/migration), DEFER it to the owning session — its `/wrap` Step 7d auto-fires this audit on the new `.claude/{hooks,skills,...}/` file, it has the wiring context, and it commits atomically. Fix only **standalone-stable** drift (a settled artifact with no other doc-update owner, e.g. a new project-memory file count). Once the feature commits **and** owner delegates → document it.

**Revisit:** if subcommand runs 3× with zero Tier 1 findings, the every-30-days cadence is too aggressive — extend to 60. If it consistently surfaces Tier 3 findings the owner ignores, the Tier 3 detection is over-broad — relax. If `--strict` mode produces CI failures unrelated to actual doc problems, the auto-fix threshold is wrong — re-calibrate.

