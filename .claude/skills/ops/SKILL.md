---
name: ops
description: Show the current status of all technical entry points (webhooks, crons, API routes) in the ops register. Use when asking what operational surfaces still need audits. Companion to /flows for backend/ops surfaces.
---

# Ops Register Status

Show the current status of all technical entry points (webhooks, crons, API routes) in the ops register. Companion to `/flows` — but for backend/ops surfaces that aren't user flows.

## When to Use

When the user types `/ops` or asks about ops register / webhook / cron audit progress.

## Subcommands

- **`/ops`** (no arg) — the default category-grouped **summary** view. Process below under "## Instructions".
- **`/ops list [all|webhooks|crons|async|api|embed|<substr>] [--brief]`** — render the **full per-category audit-history table** (`O#`, Entry, Status, **Last Audit (clean max ISO date)**, latest `Audited?` closer, Notes) for the named category, or `all` (default). Process under "## Process — `list`". Same engine as `/flows list` (`scripts/tracker-list.mjs`): the append-only audit history lives in the `Audited?` column here (ops has no Final-Audit column), and the renderer is **tail-aware** so the LATEST closer in those large cells is never truncated away. **`--brief`** drops to the compact, scannable `# | Entry | Status | Last Audit` view — use it for the inline paste. The `list` render also surfaces the **audit-tier columns** (Audit / --code) parsed from each row's `Audit Tiers` token — ops uses the `prov`/`c` grammar (provenance + last --code), not the flow/feature `v1/v2/v3` lifecycle; see "## Audit-tier columns (`list` render)" below.

## Instructions

1. Read the ops register at `~/.claude/projects/<project-key>/memory/project_ops_register.md`
2. **Read the Status column for canonical classification.** For counts, RUN the executable — do not hand-roll an awk:
   ```bash
   node scripts/tracker-list.mjs ops --counts
   ```
   ⛔ **The awk that stood here until 2026-09-09 had two defects and both failed silently: it ended in an unresolvable `<tracker>` placeholder (empty output, no error), and `$4` is a FIXED column index this tracker does not honour in every table.** The executable is shard-aware and schema-aware, reads the status column by NAME per table, and **REFUSES with `rc=1` naming the row ids** rather than bucketing a value it does not recognise — which matters because the next action after a count is editing a pointer. Same command for `flows` and `features`.
   Never derive status by eyeballing the Audited? column — Status is source-of-truth.
3. Present a summary table grouped by category (Webhooks, Crons, Async processing, Public REST API, Embed/Utility)
4. Show per-row: Status (from Col 3), entry path, idempotent? (for mutating routes), alerting wired? (for crons/webhooks)
5. Surface the checklist items still outstanding
6. Highlight which entry point should be tackled next (prioritize ⏳ PENDING / 🔧 WIP webhooks + crons with missing Sentry alerts)

**Tracker-edit discipline:** when an ops entry transitions between stages, update the Status column IN THE SAME EDIT as the Audited?/Notes narrative — **and stamp the matching `Audit Tiers` token key** (`prov` on an audit close, `c` on a --code review) in that same edit (stamp-on-audit, see "## Audit-tier columns" below).

## Output Format

Concise status table per category with columns: # | Entry | Audited? | Key gate (idempotency for webhooks, alerting for crons, auth for REST, caching for embed). End with:
- Outstanding checklist items count
- Recommended next entry to audit (prioritize: webhooks > crons > API routes > utility)

## Process — `list [category]`

Render the full per-category ops audit-history table. Category arg: `all` (default) | `webhooks` | `crons` | `async` | `api` | `embed` (substring-matched against the live `### ` section headers, so `crons` also catches "Crons (newly registered)").

1. **Run the extractor:** `node scripts/tracker-list.mjs ops <category>` (omit `<category>` for `all`). It groups by the `### ` category section header and renders `# | Entry | Status | Last Audit | Latest Audit (Audited?) | Notes`. The `Audited?` column is the append-only audit-history cell here — ops has no separate Final-Audit column; the `Last Audit` column is the clean max ISO date extracted from it (`—` when the cell carries no date).
2. **Present the script output directly — PASTE the table into your REPLY so it renders inline.** Bash stdout is collapsed by the terminal to `+N lines (ctrl+o to expand)`; reproduce the script's markdown verbatim in your response (a prose summary is not a substitute). Prefer **`--brief`** (`# | Entry | Status | Last Audit`) for the inline paste — the `Audited?` cells are large + append-only and wrap badly. `O{N}` IDs, Status column as canonical verdict. Do NOT hand-rebuild — a hand-truncation prints a stale verdict.
3. **Accuracy guarantee:** `tracker-list.mjs` extracts the MAX-DATED verdict from the `Audited?` cell (tail-aware). Documentation-artifact rows (the "Monitoring-surface" table) carry no `O#` ID and are correctly excluded.
4. **`list` is a pure render.** Close with the same next-action discipline as the default `/ops` view (prioritize PENDING webhooks > crons > API > utility).

## Audit-tier columns (`list` render)

The `list` render surfaces the **audit lifecycle** as columns — a reader sees "audited (or inherited from F#), --code-reviewed" at a glance instead of decoding it from the append-only `Audited?` prose. This directly prevents the Status-drift class where audit state lived only in ambiguous narrative.

**(a) The audit-tier model — ops variant.** Ops entries are audited with **2-3 expert lean panels** (not the 7-expert user-flow panels), and many entries INHERIT their audit from a parent feature/flow rather than running an independent panel — so ops does NOT use the flow/feature `v1/v2/v3` four-tier lifecycle. It uses a 2-key model:

| Key | Means |
|---|---|
| **prov** | audit provenance — the independent audit date IF the entry was audited on its own, ELSE the inherited parent it cites (`via-F17`, `Flow#`, `F2-v2`) |
| **--code** (`c`) | latest `/expert-review --code <wave>` fix-wave diff review |

**`/audit-check` is the GATE, not a tier** — its date folds into whichever audit it closed; it never gets its own column. Status=COMPLETE is justified by the gate. Absent key → `—`. This is an overview index over the narrative, not a replacement for it.

**(b) Storage — the `Audit Tiers` token column.** One compact column in the tracker data file (inserted right after `Status`) holds a space-separated `key:value` token; `tracker-list.mjs` parses it into columns. Grammar (ops): `prov:<YYYY-MM-DD | via-F17 | F2-v2> c:YYYY-MM-DD` — `prov` carries either an ISO date (independent audit) or the inherited `via-F#`/`Flow#` provenance; `c` = last --code date; either key omitted = absent; a never-audited row's token is literally `—`. The existing `Audited?`/`Notes` narrative columns are **preserved unchanged** — the token is additive.

**(c) `list` render columns** — `# | Entry | Status | Audit | --code | Idempotent? | Sentry?` — `Audit` = `prov` rendered (the date or the `via-F#`), `--code` = `c`. The existing ops domain columns (`Idempotent?` / `Sentry?` / `Notes`) are **preserved** — the tier columns are inserted, nothing is dropped. **`--brief`** → `# | Entry | Status | Audit | --code` (no domain columns). **Back-compat:** a row with no `Audit Tiers` token (un-backfilled) falls back to the existing tail-aware date extraction from the `Audited?` cell, so the renderer never breaks mid-migration.

**(d) Stamp-on-audit maintenance rule (extends the tracker COMPLETE flip).** The tier columns become drift surface UNLESS stamped when audits run. When an entry's audit closes, stamp `prov` (its independent date, OR the inherited `via-F#` provenance) **in the SAME edit as the Status flip**; stamp `c` on a `--code` review (use the close date). This is the tracker COMPLETE flip's Status-flip co-commit, extended to the tier token. `/audit-check`'s Post-Gate Action enforces it at the COMPLETE boundary.

## Principles

- Ops register entries are audited with **2-3 expert lean panels** (saas-engineer + security-expert + ops-monitor/devops-deploy-expert), NOT 7-expert user-flow panels.
- An entry on this list means "technical entry point with no user-flow semantics." If it has user-visible UX (refund flow, retry UX, rate-limit copy), that lives in the user-flow tracker, not here.
- Do not conflate with `/flows` — `/flows` is user journey coverage; `/ops` is backend entry-point coverage.
