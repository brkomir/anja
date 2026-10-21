---
name: features
description: Show the current status of all engineering feature audits. Use when asking 'where are we on feature audits?' or planning the next audit to run.
---

# Feature Audit Status

Show the current status of all engineering feature audits.

## When to Use

When the user types `/features` or asks about feature audit progress.

## Subcommands

- **`/features`** (no arg) — the default tier-grouped **summary** view. Process below under "## Instructions".
- **`/features list [all|critical|high|standard|coverage-gap] [--brief]`** — render the **full per-group audit-history table** (`F#`, Feature, Status, **Last Audit (clean max ISO date)**, Initial Audit, Fixes, latest Final-Audit closer) for the named group, or `all` (default). Process under "## Process — `list`". Same engine as `/flows list` (`scripts/tracker-list.mjs`): it reads the live tracker and is **tail-aware** on the append-only Final-Audit cell, so the LATEST v2/v3/v4 closer is never head-truncated away. The untiered F17+ "coverage-gap" additions render under their own `coverage-gap` group. **`--brief`** drops the three narrative columns for the compact, scannable `# | F# | Status | Last Audit` view — use it for the inline paste. The `list` render also surfaces the **audit-tier date columns** (V1 / V2 / V3 / --code) parsed from each row's `Audit Tiers` token — see "## Audit-tier columns (`list` render)" below.

## Instructions

1. Read the feature tracker at `~/.claude/projects/<project-key>/memory/project_feature_audits.md`
2. **Read the Status column for canonical classification.** For counts, RUN the executable — do not hand-roll an awk:
   ```bash
   node scripts/tracker-list.mjs features --counts
   ```
   ⛔ **The awk that stood here until 2026-09-09 had two defects and both failed silently: an unresolvable `<tracker>` placeholder (empty output, no error), and a FIXED `$4` index. This tracker has FOUR table headers and the fourth carries no Status column at all, so a fixed index scored 16 rows against their `Audit Tiers` cell and reported `16 ✅ COMPLETE` where the truth is `24` — plausible, wrong, and silent.** The executable reads the status column by NAME per table and REFUSES with `rc=1` rather than bucketing junk.
   Never derive status by eyeballing the Final Audit column (Col 7) — that cell holds historical narrative, not the authoritative verdict.
3. Present a summary table grouped by tier (Critical, High, Standard)
4. Show counts: completed / total per tier (from Status column)
5. Highlight which feature should be tackled next (first row with Status=⏳ PENDING or — in Critical tier)

**Tracker-edit discipline:** whenever a feature moves between stages (PENDING → COMPLETE, etc.), update the Status column IN THE SAME EDIT as the Final Audit narrative — **and stamp the matching `Audit Tiers` token key** in that same edit (stamp-on-audit, see "## Audit-tier columns" below). Status is source-of-truth; Final Audit is context.

## Output Format

Show a concise status table per tier with columns: #, Feature, Audit, Fixes, Final Audit. Only show detail rows for the current tier being worked on (Critical). For other tiers, show a one-line summary count.

**Naming convention (mandatory in output):** Always render feature IDs as `F{N}` (e.g., `F5`), never bare `#{N}` or `Flow #{N}`. The `F` prefix disambiguates from the flow tracker where 1-16 collide.

End with a recommendation of which feature to tackle next.

## Process — `list [group]`

Render the full per-group feature audit-history table. Group arg: `all` (default) | `critical` | `high` | `standard` | `coverage-gap`.

1. **Run the extractor:** `node scripts/tracker-list.mjs features <group>` (omit `<group>` for `all`). It reads the live tracker, parses the `### TIER` section tables AND the untiered "Coverage-gap additions" table (F17+, a different 6-column schema `# | Feature | Audit | Fixes | Final Audit | Launch?` → rendered under a `coverage-gap` group), dedups by F#, and prints ready-to-paste markdown tables + COMPLETE counts.
2. **Present the script output directly — PASTE the table into your REPLY so it renders inline.** Bash stdout is collapsed by the terminal to `+N lines (ctrl+o to expand)`; reproduce the script's markdown verbatim in your response (a prose summary is not a substitute). Prefer **`--brief`** (`# | F# | Status | Last Audit`) for the inline paste — the full narrative form wraps badly. It honors the column discipline (`F{N}` IDs per the naming rule; the Status column is the canonical verdict). Do NOT hand-rebuild the table — that re-introduces the head-truncation of the append-only Final-Audit cell.
3. **Accuracy guarantee:** the Final-Audit cell is append-only — a feature's v2/v3/v4 re-audits are appended to the END, so the current closer is at the tail. `tracker-list.mjs` extracts the MAX-DATED verdict by scanning the whole cell; never head-truncate by hand.
4. **`list` is a pure render** — no staleness sweep. Close with the same next-action discipline as the default `/features` view.

## Audit-tier columns (`list` render)

The `list` render surfaces the **audit lifecycle** as date columns — a reader sees "v1 done, v2 done, drifted-and-re-verified, --code-reviewed" at a glance instead of decoding it from the append-only Final-Audit prose. It directly prevents the Status-drift class where audit state lived only in ambiguous narrative.

**(a) The audit-tier model** — five tiers, each shows the **latest** date that tier ran (2 drift re-audits → the latest v3; multiple `--code` waves → the latest `c`). *There were four tiers until a v4 tier was added to the tracking for both flows and features; the renderer, this file and the drift detector all carry it.*

| Tier | Means | `/expert-review` mode |
|---|---|---|
| **v1** | initial audit | `/expert-review <feature>` (first panel) |
| **v2** | final audit | `/expert-review --final-audit` |
| **v3** | drift re-audit | `/expert-review --v3-drift` (or a drift-scoped `--final-audit` redo) |
| **v4** | fourth pass — a full re-audit after a long gap or a regime change (a business-economics change, a 120-day drift) | `/expert-review --final-audit` at the v4 floor; narrated `**COMPLETE under v4** (date, …)` |
| **--code** | fix-wave diff review | `/expert-review --code <wave>` |

**`/audit-check` is the GATE, not a tier** — it never gets its own column; its date folds into whichever audit it closed. Status=COMPLETE is justified by the gate; the tier columns show *when each audit ran*. Absent tier → `—`. This is an overview index over the narrative, not a replacement for it.

**(b) Storage — the `Audit Tiers` token column.** One compact column in the tracker data file (inserted right after `Status`) holds a space-separated `key:value` token; `tracker-list.mjs` parses it into columns. Grammar (features): `v1:YYYY-MM-DD v2:YYYY-MM-DD v3:YYYY-MM-DD v4:YYYY-MM-DD c:YYYY-MM-DD` — any key omitted = that tier absent (e.g. a v1+v2 feature = `v1:2026-04-08 v2:2026-06-13`); a never-audited row's token is literally `—`. The existing `Audit`/`Fixes`/`Final Audit` narrative columns are **preserved unchanged** — the token is additive, and the full multi-audit history stays in the narrative cell.

**(c) `list` render columns** — `# | F# | Status | V1 | V2 | V3 | V4 | --code | latest-closer` (the tail-aware latest-verdict becomes a short closer, not the full paragraph); **`--brief`** drops the closer → `# | F# | Status | V1 | V2 | V3 | V4 | --code` (dates only). These per-tier date columns are the audit-date surface in the new render — they break the single `Last Audit` max-date out into its constituent tiers. **Back-compat:** a row with no `Audit Tiers` token (un-backfilled) falls back to the existing tail-aware date extraction, so the renderer never breaks mid-migration.

**(d) Stamp-on-audit maintenance rule (extends the tracker COMPLETE-flip rule).** The tier columns become drift surface UNLESS stamped when audits run. When an audit closes, stamp its token key **in the SAME edit as the Status flip** — `v1` on an initial close, `v2` on a `--final-audit` close, `v3` on a `--v3-drift`/redo close, `v4` on a fourth-pass close (⛔ a NEW key, never an overwrite of `v3` — the 2026-09-03 v4 re-audits of two flows were stamped over their v3 dates because no v4 slot existed, and both v3 dates had to be recovered from git on 2026-09-22), `c` on a `--code` review (use the close date). This is the tracker COMPLETE-flip rule's Status-flip co-commit extended to the tier token. `/audit-check`'s Post-Gate Action enforces it at the COMPLETE boundary; an `--final-audit`/`--v3-drift`/`--code` close that does NOT flip COMPLETE still stamps its tier key in the tracker edit it makes.
