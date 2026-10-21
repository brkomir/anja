# Steps 7b–7h — instrument history, evidence and coordination — moved, with the copy's edits, from `.claude/skills/wrap/SKILL.md` (split under the per-file size line, a growth signal and not a delivery limit, 2026-09-26)

## 7b — why the field-4 awk was refuted — from `SKILL.md` § Process

```bash
   # ⛔ THE FIELD-4 FORM IS REFUTED (measured 2026-09-03) — `project_critical_flows.md`
   # has TWO row formats and $4 is the Status column in only ONE of them. A RESEARCH_GAP row
   # reads `| 62 | name | HIGH | 🔬 RESEARCH_GAP | …`: field 4 is a PRIORITY, Status is field 5.
   # The naive form buckets 14 of 69 rows under HIGH/CRITICAL/STANDARD/POLISH and prints
   # `54 ✅ COMPLETE` plus a SEPARATE 1-row long-variant bucket, against a true 64 — and this
   # step's own procedure then says "if mismatch, Edit", so the instrument's error routes
   # straight into a WRITE against the tracker pointer. The pointer was already correct
   # (64/4/1 of 69); obeying the old command would have corrupted it.
   # ⚠️ TWO CORRECTIONS TO THIS BLOCK'S OWN FIRST VERSION (both
   # re-verified at source before folding). (1) It said "55 COMPLETE"; that is the POST-fix
   # reading of a PRE-fix instrument — the old command literally emits 54 plus a separate
   # bucket. Direction unchanged, the number as written is not what a session sees.
   # (2) It said "the always-loaded index", and that is one file off IN MY OWN DISFAVOUR:
   # the tracker pointers moved to the COLD `MEMORY-INDEX.md`. Measured
   # 2026-09-03 — `project_critical_flows` greps 0 in `MEMORY.md`, 2 in `MEMORY-INDEX.md`.
   # The blast radius is a cold retrieval doc, not every session's startup context.
   # SCOPE: this command is written for `project_critical_flows.md` ALONE — one path, one
   # vocabulary. Step 7b is mandatory for three trackers, and on the ops register (ids `O1`,
   # outside the `[0-9F]+` class) it returns EMPTY, which reads as "nothing to reconcile".
   # Re-derive the id class and the status vocabulary per tracker; do not run this on a sibling.
```

## 7b — why the awk was replaced, not repaired — from `SKILL.md` § Process

```bash
   # ⛔ AN AWK STOOD HERE UNTIL 2026-09-09. IT WAS REPLACED, NOT REPAIRED, AND THE HISTORY BELOW IS
   # WHY: this one command carried THREE separate defects in seven days, each found and fixed
   # separately, none of the fixes reaching the two sibling copies of the same recipe.
   #   (1) Its STOP guard COULD NOT FAIL. It checked that the bucket total
   #       equals the row count — an ARITHMETIC IDENTITY, since there is one unconditional
   #       increment per matched row. Live tracker: 69 and 69, equal by construction. Run against
   #       `project_feature_audits.md` it PASSED 32/32 while six rows carried unrecognised statuses.
   #   (2) Its path was the BARE ROUTER, so it measured 0 rows against a glob's 64/4/1 — and this
   #       step's own procedure says "if mismatch, Edit", so the zero routed into a corrupting
   #       WRITE against the pointer it exists to keep true.
   #   (3) Its vocabulary was written for THIS tracker alone, so pointing it at a sibling silently
   #       scored date tokens as statuses.
   # The executable closes all three by construction: shard-aware (so no glob to forget), status
   # column resolved by NAME per table (so a sibling's fourth Status-less header cannot alias), and
   # a PER-TRACKER vocabulary with `rc=1` naming the offending ids. Its flows output reproduces the
   # canonical pointer byte-for-byte, which is the positive control this step needs before it
   # edits anything: `69 flows (64 COMPLETE / 4 RESEARCH_GAP / 1 NOT AUDITED)`.
   # ⚠️ Same command with `features` / `ops` for the sibling trackers — 7b is mandatory for all
   # three, and the old awk was correct for at most one of them at a time.
```

## 7b — MEMORY.md vs MEMORY-INDEX.md — from `SKILL.md` § Process

```bash
   #    ⚠️ This said `MEMORY.md` until 2026-09-03 and the target is NOT there — measured 0 hits in
   #    MEMORY.md, 3 in MEMORY-INDEX.md. A session obeying the old line finds nothing and the
   #    WRITE half of this step silently does not happen. Pre-dates this block's first version; fixed here.
```

## 7b — evidence basis — from `SKILL.md` § Process

   **Evidence basis:** an earlier recommendation + status-count discipline (read-side rule alone is insufficient — pointer rot continues until write-side refresh closes the loop). Cost: ~10 sec per tracker, runs only when tracker was touched this session.

## 7c.1 — why the single-regex form and the fixed /tmp path are gone — from `SKILL.md` § Process

```bash
   # ⛔ The old single-regex form — grep -iE "(F[0-9]+|Flow #[0-9]+|<kw>).*(COMPLETE|PASS|shipped|/audit-check)"
   # — is DENIED by grep-blowup-warn.sh (block mode): variable-width quantifier
   # before an alternation. Measured 2026-08-22; a block-mode deny voids the
   # WHOLE Bash call, so it also silently discarded the awk above it.
   # SESSION-SCOPED path, same shape as :115 — a fixed /tmp path lets a
   # concurrent seat's /wrap overwrite this range, after which the grep below
   # reports THAT seat's commits as this session's work: plausible output,
   # wrong session, no error.
```

## 7c.1 — set-equivalence caveat — from `SKILL.md` § Process

   ⚠️ The replacement was verified to RUN. **Set-equivalence with the denied
   original is UNVERIFIABLE** — the only oracle is running both, and the guard
   denies the original by construction. Treat a surprising result as possible
   drift between the two forms, not as a fact about the commits.

## 7c.1b — why not a range-awk, and the range-heading blind — from `SKILL.md` § Process

```bash
   # ⚠️ NOT a range-awk (`/start/,/end/`): the heading `### N.` ALSO matches the end pattern `/^### [0-9]/`,
   # so the range collapses to the heading line and every entry reads a false "none" (caught 2026-07-20).
   # ⛔ RANGE-HEADING BLIND (measured 2026-08-07): the previous one-liner keyed `^### ${N}\\.` and
   # extracts ZERO body lines from a BATCH heading — `### 72–101.` / `### 108–121.` / `### 125–126.`,
   # the format EVERY `/backlog sweep` promotion uses. That is 46 promoted entries invisible to this
   # reconcile, silently, while the same command returns correct bodies (22 / 10 lines) for plain
   # headings — so a spot-check on a plain entry certifies an instrument that is dead for half the file.
   # `/backlog sweep`'s OWN spec documents this exact shape for its mint-verification grep and
   # positive-controls against it; this step never inherited the warning. Range-aware + BSD-portable
   # (no gawk 3-arg match()); the end-anchor stops at EITHER heading level, else the LAST `###` entry
   # runs to EOF and swallows the Archive section (measured: 98 body lines instead of 6).
```

## 7c.1b — why candidate LIST lines, not every id — from `SKILL.md` § Process

```bash
   # An entry's body carries its candidate LIST *and* prose about it — rationale, cross-references to
   # sibling entries, "superseded by F12" notes. A bare id-grep over the whole body cannot tell a
   # candidate from a MENTION of one, and it over-matches in the direction that manufactures work.
   # Measured this session: the whole-body form returned 136 hits, a pending-word filter cut it to 14,
   # and reading all 14 left **0** real stale candidates — every hit was prose. A candidate-LINE
   # predicate measured 53 -> 2 on the same corpus and never reached this spec until now.
   # The list-line anchor is what separates them: a candidate is a LIST ITEM, a mention is a sentence.
   # ⚠️ Do NOT "fix" this by tightening the id regex instead — the ids are identical in both
   # populations, so no id pattern can discriminate; the LINE SHAPE is the only axis that does.
```

## 7c.1c — the gap this closes — from `SKILL.md` § Process

   **The gap this closes, and why its siblings cannot.** 7c.1 fires only when a WHOLE entry is done (it needs a completion marker) and 7c.1b only when a candidate INSIDE a rollup entry completed. Neither has any branch for the ordinary case: a session advances, refutes, re-scopes or blocks an item and ships nothing archivable, so the entry keeps saying what it said before the work happened. Measured over the last 300 commits: **23 commits cite a backlog item and 5 of them never touch `BACKLOG.md`** — the sharpest FIXED the preflight gates one backlog entry tracks and left that entry unchanged.

## 7c.1c — SIGNAL 1 reads the diff: the retired message-anchored form — from `SKILL.md` § Process

   ⛔ **SIGNAL 1 READS THE *DIFF*, NEVER THE COMMIT MESSAGE. THE MESSAGE-ANCHORED FORM THIS STEP SHIPPED WITH IS RETIRED — IT MEASURED 24.2% RECALL AND, ON ONE COMMON SUBJECT SHAPE, WROTE A DATED ADVANCE ONTO AN ENTRY THE SESSION NEVER OPENED.** Every claim reproduced locally before folding. The retired form was `grep -ioE 'backlog[^|]{0,24}#[ ]?[0-9]{1,3}'`, and it fails by SHAPE, not by tuning: `[^|]{0,24}` is greedy and `grep -oE` returns non-overlapping matches, so it yields **at most one id per occurrence of the word `backlog`, and it is the LAST one**. Measured — `backlog rows #11 #22 #33 #44` → **44** (one of four, and not the first); ⛔ **`backlog #11 supersedes #22` → `22`**, so a supersedes-shaped subject stamps the *superseded* entry and leaves the moved one silent. **A missing line is a gap; a wrong line is a record, and a mandatory step makes the next reader trust it.** No width fixes this — widening only changes which single id you get. ⚠️ **It was also self-demonstrating and I did not test that direction: BOTH commits that shipped it return `[]` against their own predicate, while one of them cites its motivating backlog entry twice.** Ground truth over the same 300-commit window: 23 commits edited `BACKLOG.md` carrying **91** true (commit, entry) touches across **60** distinct entries; the predicate caught **22** and ever named **13**.

## 7c.1c — the retired form's own defence — from `SKILL.md` § Process

   ⚠️ **THE RETIRED FORM'S OWN DEFENCE IS KEPT ONLY AS THE REASON NOT TO REBUILD IT.** A bare `#N` scan over commit messages IS noise — measured on the same window, bare `#[0-9]{1,3}` matched **78** commits against the anchored form's **23**, the extras being `post-compact #30`, priority tiers and lesson numbers. That reasoning was sound and led to the wrong place: **both forms read the message, and the message is not where the truth is.** Anchoring was a real improvement to a predicate that should not have existed. **If you find yourself tuning a message regex here, the tuning is the error** — the diff already knows.

## 7c — evidence basis and coordination notes — from `SKILL.md` § Process

   **Evidence basis (7c.1):** a feature audit (a metric schema migration) shipped 2026-05-20 (audit-check 12/12 PASS), but the closing `/wrap` didn't archive its top-tier backlog entry. It had to be flagged by hand in the next session — the orchestrator then greenfielded the archive operation (delete from the top tier + append to Archive → Shipped). Cost of skip: stale roadmap surface for next `/orient` + manual reconciliation burden. Cost of inclusion: ~10 sec per `/wrap`.

   **Evidence basis (7c.1b):** three feature re-audits all completed 2026-06-14/15 with their `project_feature_audits.md` rows flipped ✅ — but a **top-tier** backlog entry (the composite "re-audit stale audits" rollup) still listed all three as pending/residual candidates in its body for ~2 days. Their own audit-session `/wrap` runs fired 7c.1, which declined to archive that rollup (two other audits in it still open) and never looked inside the entry. Caught only by a manual read of the backlog 2026-06-16 — two stale **top-tier** items. 7c.1b's tracker-ground-truth reconcile would have struck each candidate at the completing session's wrap (and as a net, on any later wrap).

   **Coordination notes:**
   - `/hanging-work` Check 12 handles *blocker-fired* (todo says "blocked on X" + X shipped → promote defer); 7c.2 handles orthogonal *task-done* (open todo + task work shipped → mark `[x]`).
   - Step 7b refreshes pointer-line counts in `MEMORY-INDEX.md` when tracker Status columns change. 7c does same-shape mechanical sync for `BACKLOG.md` (roadmap) + `todo.txt` (ops checklist).
   - Step 8 (commit) bundles 7c edits into the session-residual commit — no separate commit.

## 7d — rationale for the trigger choice — from `SKILL.md` § Process

   **Rationale for trigger choice (chosen over an initial ≥10-meta-commits heuristic):** commit-count is noise — a single L# codification can land as 1 or 5 commits depending on how the orchestrator batches enforce layers, refactor sessions accumulate 20 commits with zero doc-relevant changes, and tight high-impact sessions ship 1 commit that drifts multiple counts. The doc enumerates exactly two surface families: L# references (preamble L# range + Appendix C rows) and infrastructure counts (the count list under § Preface — Why this document exists — skills/agents/hooks/rules/commands/templates/project-memory). The new trigger directly observes these surfaces. Validation on the 2026-05-21 PM codification session: 8 new L# headers detected → trigger fires ✓; commit-count would have also fired but for the wrong reason (refactor commits would have triggered it equally).

## 7d — evidence basis and coordination — from `SKILL.md` § Process

   **Evidence basis:** /meta architecture-audit shipped 2026-05-18 with documented cadence triggers (every ~30 days OR ≥10 meta-commits OR doc >90 days old) but zero automation. 2026-05-21 PM session shipped 30 meta-system commits + 5 new L#s; the doc accumulated 2 Tier 1 drifts (a stale preamble L# range + renumber-drift narrative). A manual audit caught them. Without this step, drift lingers until next manual `/meta` invocation. Cost of step: ~5 sec detection + ~30 sec audit when threshold met. Cost of skip: silent doc rot every high-meta-velocity session.

   **Coordination:**
   - Step 7b handles `MEMORY-INDEX.md` pointer-line drift; 7d handles architecture.md drift. Same shape, different artifact.
   - Step 7c handles BACKLOG.md + todo.txt; 7d handles the architecture doc. All three are write-side state-sync sweeps.
   - `/meta` Process Architecture Audit `--strict` mode promotion to /wrap is deferred until 5 clean default-mode runs per the warn-mode-before-block-mode discipline.

## 7e — evidence basis and coordination — from `SKILL.md` § Process

   **Evidence basis:** 2026-05-21 — one skill's memory file sat at 2052 lines (252 OVER 1800 distill trigger, 52 OVER 2000 URGENT cap) for several days. `check-memory-size.sh` PostToolUse hook was firing URGENT warnings on every edit, but warnings scrolled past in heavy meta-system sessions. A manual `/meta distill` run brought it 2052 → 1294. The distill spec already existed; the gap was in trigger-to-firing automation, not the procedure. This step closes the surface gap; the procedure stays owner-invoked per memory-curation principle. Cost of step: ~5 sec detection across ~76 skill MEMORY files. Cost of skip: silent URGENT lingering across sessions until owner notices.

   **Coordination:**
   - `check-memory-size.sh` is write-time PostToolUse hook (per-edit warn); 7e is session-end persistent surface (per-session inventory). Two layers, complementary — neither replaces the other.
   - `/orient` could mirror DISTILL-OVERDUE surface at session-start if 7e's session-close surface doesn't carry into the next session — defer until recurrence observed.
   - Step 7e is READ-only; Steps 7b/7c/7d write — keep the boundary explicit so owner doesn't expect auto-distill.

## 7f — evidence basis and coordination — from `SKILL.md` § Process

   **Evidence basis:** 2026-05-24 manual triage of 67 entries across 22 jsonls revealed the dominant orchestrator-blindspot pattern (`under-justification` at 43%) recurs in nearly every multi-turn session. Without session-end auto-detection, the capture loop depends on orchestrator remembering to invoke the scan — exactly the remember-to-invoke anti-pattern. Capture-at-freshest beats reconstruction-from-memory. Cost of step: ~3 sec detection (always) + ~5-10 min triage (only when events fire — most sessions skip silently). Cost of skip: pattern recurrence stays invisible until owner explicitly invokes `--analyze`.

   **Coordination:**
   - `--current` flag (v0.5, 2026-05-25) resolves to the most-recently-modified jsonl, reliably the current session at /wrap time.
   - `--add-entry` flag (v0.5, 2026-05-25) is the CLI primitive that lands an entry; orchestrator invokes per approved row.
   - Step 7f writes to `.claude/meta-corrections-registry.md` only; Step 8 commits the file alongside other session-residual edits.
   - Distinct from Step 7a (/me learn-session captures owner working-style preferences for user_profile.md + feedback_*.md): 7a captures USER preferences, 7f captures ORCHESTRATOR blindspot patterns. Two different audiences, two different registries.

## 7g — evidence basis and coordination — from `SKILL.md` § Process

   **Evidence basis:** N=3 — the architecture-audit Appendix C residual floated across three consecutive audit `/wrap`s, each time living only in conversation / wrap-summary with no durable home, until it was recognised as a recurring tracking gap rather than a one-off. Cost of step: ~30 sec/item (only when a forward-list exists). Cost of skip: floating items evaporate on compact; next session re-discovers or loses them.

   **Coordination:**
   - Step 7c handles SHIPPED→tracker (backward); 7g handles PENDING→home (forward). Both write tracker edits into Step 8's commit. Inverse companions.
   - Distinct from Step 7b (pointer-COUNT refresh — mechanical count sync) and Step 7e (distill cadence). 7g is item-level home EXISTENCE for the forward-list.

## 7h — HISTORY: the bare-invocation window — from `SKILL.md` § Process

   **HISTORY (superseded):** the bare invocation USED to skip every `commit-touches` predicate (measured 2026-07-29: bare = 5 doable / 34 unevaluated vs flagged = 17/0 — a 70% under-report reading as a completed scan, inside the wrap's own instrument). The window no longer exists: `commit-touches` now defaults to the item's own git-blame date as its anchor (a fired trigger is STATE, visible on the bare scan), so the bare run IS complete for that class; `--since` survives only as a narrowing view and the sole remaining opt-in is `--run-exit-zero` (it EXECUTES commands). The residual discipline: if the output still prints an `unevaluated` count, name it — never read it as clean.
