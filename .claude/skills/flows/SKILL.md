---
name: flows
description: Show the current status of all user flow audits. Use when asking 'what's next in the critical flow queue?' or planning the next flow audit.
---

# Flow Audit Status

Show the current status of all user flow audits.

## When to Use

When the user types `/flows` or asks about flow audit progress.

## Subcommands

- **`/flows`** (no arg) — the default tier-grouped **summary** view: detail rows for the Critical work-tier, one-line counts for the rest. Process below under "## Instructions".
- **`/flows list [all|critical|high|standard|polish] [--brief]`** — render the **full per-tier audit-history table** (#, Flow, Status, **Last Audit (clean max ISO date)**, Initial Audit, Fixes, latest Final-Audit closer) for the named tier, or `all` (the default when no tier is given). Process under "## Process — `list`". This is the accurate, complete form of the ad-hoc table: it reads the live tracker and is **tail-aware** on the append-only Final-Audit cell, so the LATEST closer is never head-truncated away — and the `Last Audit` column surfaces that latest date as its OWN scannable field (vs. buried in the narrative closer cell) (the failure that once showed a flow's April v2 instead of its 2026-06-06 re-audit). **`--brief`** drops the three narrative columns for the compact, scannable `# | Flow | Status | Last Audit` view — use it for the inline paste (the full form's 150-char closer cells wrap badly inline). The `list` render also surfaces the **audit-tier date columns** (V1 / V2 / V3 / --code) parsed from each row's `Audit Tiers` token — see "## Audit-tier columns (`list` render)" below.

## Instructions

1. Access the flow tracker at `~/.claude/projects/<key>/memory/project_critical_flows.md` ⛔ **TWO-TIER — GREP THE DIRECTORY, NEVER THAT PATH ALONE.** It is now a 9,225 B router plus eleven `project_critical_flows-SHARD-*.md` files beside it, so a grep of the router reads a clean ZERO for live flow rows. Use `project_critical_flows*.md`. The router reads whole, and so does every shard at HEAD: the hook's `TRACKER_THRESHOLD` is **51,200 B**, the largest shard is **45,045 B**, and **0 shards are over it** (2026-09-09 — this line claimed a shard "may still trip" it, which was false). It is an append-only ledger; the access patterns you need are the Step-2 awk (status counts) and **`grep -nE '^\| <N> \|' .claude/project-memory/project_critical_flows*.md` for one flow's row. ⛔ THE `rg "Flow #N"` RECIPE THIS LINE CARRIED UNTIL 2026-09-09 IS REFUTED AND MANUFACTURED THE FALSE REFUTATION IT WAS MEANT TO PREVENT: rows are keyed `| N |`, so measured over the whole directory it FAILS TO RETURN THE RIGHT ROW FOR 26 OF 69 live flows — 13 return NOTHING and 13 return a hit inside a DIFFERENT flow's row, the worse half because a wrong row is plausible where a zero is obvious; only 43 of 69 carry `Flow #N` in their own row at all, while the row anchor returns exactly 1 for 69 of 69.** Use the `Read` tool only with `offset`+`limit` for a specific slice.
2. **Read the Status column — KEY IT OFF THE HEADER, NEVER A FIXED FIELD INDEX.** ⛔ **THE CORPUS HAS TWO ROW LAYOUTS AND `$4` IS THE STATUS IN ONLY ONE OF THEM (measured 2026-09-09).** `| # | Flow | Status | …` puts it at `$4`; `| # | Flow | Tier | Status | …` (shards 10-11, **14 rows**) puts **Tier** at `$4` and Status at `$5`. A fixed `$4` therefore reports those rows' PRIORITY as their STATUS and injects four fake statuses (`CRITICAL`/`HIGH`/`STANDARD`/`POLISH`) into the counts — it RUNS and LIES, which is worse than the bare-placeholder no-op it replaced. Status values are canonical tokens — `✅ COMPLETE` / `⏳ PENDING` / `🔧 WIP` / `🔬 RESEARCH_GAP` / `—` — populated at tracker-edit time when any row moves between stages. The awk below finds `Status` in each file's own header and de-dupes on flow number (6 flows appear in two shards):
   ```bash
   node scripts/tracker-list.mjs flows            # per-row: # | Flow | Status | V1 | V2 | V3 | V4 | --code | verdict
   node scripts/tracker-list.mjs flows --counts   # the per-status breakdown, and it REFUSES rather than guessing
   ```
   ⛔ **AN AWK STOOD HERE UNTIL 2026-09-09 AND ITS REPLACEMENT IS THE POINT, NOT ITS REPAIR.** The
   same defect was fixed three times in seven days in three different files, three different ways,
   with **zero propagation between the copies** — and the mechanism had been written down on
   2026-07-13 and read by none of them. The executable is shard-aware, reads the status column by
   NAME per table (this corpus has two row layouts and a fixed `$4` is the status in only one), and
   exits `rc=1` naming the offending row ids rather than bucketing a value it does not recognise.
   **A citation to a DOCUMENT is an instruction to go and retrieve something, and retrieval is the
   act these three failures measure as not happening; a citation to an EXECUTABLE is the work.**
   Never fall back to session memory from earlier `/flows` invocations when a row's current content is unclear — reading the actual row costs ~2 sec.

   **Tracker-edit discipline:** whenever a flow moves to COMPLETE / PENDING / WIP, update the Status column IN THE SAME EDIT as the Final Audit column narrative — **and stamp the matching `Audit Tiers` token key** in that same edit (stamp-on-audit, see "## Audit-tier columns" below). Status column is source-of-truth; Final Audit column is historical context. /flows never reads Col 7 (Final Audit narrative) for classification — only for display alongside COMPLETE rows.
3. **False-positive sweep (tracker-row mechanical update, 2026-04-20 — closes 3 misreads/session class; refined 2026-04-20 to single-call form after for-loop triggered permission prompts).** Run ONE git log call with a regex covering every flow number, then cross-reference with the Pending/— rows from Step 2:
   ```bash
   # Fixed-string chain. ⛔ The old single-regex form is DENIED by
   # grep-blowup-warn.sh (block mode): a variable-width quantifier before an
   # alternation. Measured 2026-08-22 — the spec's own Step 3 could not run.
   git log --all --format='%h %s' | grep -iF 'complete' | grep -iF '(flow'
   # …and the flow numbers those commits name:
   git log --all --format='%h %s' | grep -iF 'complete' \
     | grep -oiE 'flow ?#? ?[0-9]+' | grep -oE '[0-9]+' | sort -n -u
   ```
   ⚠️ Use `-i` on BOTH greps. A case-sensitive `grep -F 'COMPLETE'` reads 25
   commits where the case-insensitive form reads 81 — a 31%-of-corpus sweep
   that looks clean (measured 2026-08-22).

   ⚠️ Verified to RUN; **set-equivalence with the denied original is
   UNVERIFIABLE** — the only oracle is running both forms on the same input,
   and the guard denies the original by construction. This chain is BROADER
   than the old regex (it matches any subject carrying both literals, not just
   `chore|feat` prefixes), which is the safe direction for a staleness sweep:
   more candidates to read, no silent misses.

   For each match, parse the `flow<N>` from the commit subject. If N appears in the Pending/— row list → the tracker row is STALE. Surface inline: "Flow #N tracker row says Pending but commit <hash> claims COMPLETE — row needs update before /flows output is trustworthy." Do NOT silently report stale state.

   **Why single-call form:** the earlier `for n in N1 N2 ... ; do git log ...; done` pattern wraps git log inside a shell construct — the command string starts with `for`, not `git log`, so `Bash(git log:*)` permission rules don't match and the user gets prompted. The one-shot `git log ... | grep ...` form starts with `git log` and matches cleanly. Also ~37× faster (1 call vs N).
4. Present a summary table grouped by tier (Critical, High, Standard, Polish)
5. Show counts: completed / total per tier
6. Highlight which flow should be tackled next (first unaudited in Critical tier)

**Placeholder ban (promoted 2026-04-21 @ N=2).** When rendering any row of the table, the Flow name MUST be the actual Col 3 value from the tracker — NEVER a placeholder like `(flow N name)` / `(coverage add)` / `(placeholder)` / `(...)`. Read Col 3 via the same awk used in Step 2 (add `name=` and print it). Cost: +1 awk field extraction (~0 sec). Cost of skipping: ridiculous output like this session's original /flows that surfaced placeholder rows for four flows when the real names were 2-sec-readable. If you're about to output a parenthetical in the Name column that contains "name" / "placeholder" / "TBD" / "add" / "..." as a stand-in for real data, STOP — re-read the tracker row first.

## Output Format

Show a concise status table per tier with columns: **#, Flow, Initial Audit (/expert-review), Fixes (/agent-work), Final Audit**. Only show detail rows for the current tier being worked on (Critical). For other tiers, show a one-line summary count.

**Skill-explicit column discipline (2026-04-20 — refined: `/audit-check` is not the only final-audit closer).** The three stage columns map to skills but Col 5 has TWO closers. Always render column headers with the skill name(s) in parentheses. Never shorten "Initial Audit" to just "Audit" in output. Cell values follow the same discipline:
- Col 3 (Initial Audit — `/expert-review`): `NOT AUDITED` / `Done (YYYY-MM-DD, N experts)` — NEVER "COMPLETE" (that word is reserved for Col 5).
- Col 4 (Fixes — `/agent-work`): `—` / `Done (commit <hash>)`.
- Col 5 (Final Audit — `/audit-check` OR `/expert-review` v2): `—` / `Pending` / `COMPLETE (YYYY-MM-DD, <closer>)`. Closer is one of: `/audit-check N/N PASS` (mechanical gate) OR `v2 panel (N experts)` (fresh re-audit surfacing new findings). **Do not use "Final Audit = /audit-check" as the only framing** — a v2 /expert-review panel is equally valid.

When describing next-action recommendations in output, state BOTH the stage AND the skill choice when Col 5 is pending: "Flow #42 needs /audit-check (mechanical gate)" OR "Flow #42 needs /expert-review --final-audit (fresh panel)".

**Closer-selection rule (audit layers are COMPLEMENTARY; there is NO uniform "/audit-check default"):** `/audit-check` only VERIFIES that found fixes are present + tests green; it CANNOT re-derive the surface, so it can't catch what the initial panel missed. Recommend it as the SOLE closer ONLY when the flow's prior audit is recent (<30 days) AND thorough AND low-stakes. If the flow has had only an initial audit + fixes (**no `/expert-review --final-audit` panel has ever run**), OR its initial audit is ≥30 days stale, OR stakes are high (revenue / legal / paid tier / safety) → recommend **`/expert-review --final-audit`** (fresh panel) FIRST — it finds new findings; `/audit-check` then verifies THAT cycle before COMPLETE. Do NOT default to the lighter gate. "Flow #42 is Pending" alone is ambiguous — the skill-explicit column discipline above closes that. (Recurrences this prevents: 2026-05-23, 2026-05-24, 2026-06-09.)

**COMPUTE the floor — don't judge it (`minimum-viable-scope:instrument-undersize`, 2026-07-12).** This rule is WORK-remediable: it kept firing WITH the prose loaded (a reasoned values error, not a missing fact — the undersized gate was the *last net*). So run the SSOT instead of eyeballing "is this high-stakes enough": `node scripts/audit-sizing-floor.mjs --stakes <revenue,legal,premium,safety|none> --last-audit-days <N|never> --had-final-audit <true|false> [--owner-invoked <mode>] [--diff-class <logic|security|cross-surface|shared-state|trivial>]`. It returns the mandated closer + min panel + whether `--code` is mandatory + any owner-invoked lock. **Go AT-OR-ABOVE the floor; going BELOW is an explicit owner pick with a logged reason — never a default.** The self-detecting net over logged closes is `/meta self-audit` (audit-floor-check).

**Naming convention (mandatory in output):** Always render flow IDs as `Flow #{N}` (e.g., `Flow #5`), never bare `F{N}` — the `F` prefix is reserved for features and 1-16 collide across both trackers.

End with a recommendation of which flow to tackle next, framed as "Flow #N needs /SKILL" (not just "next up: Flow #N").

## Process — `list [tier]`

Render the full per-tier audit-history table. Tier arg: `all` (default) | `critical` | `high` | `standard` | `polish`.

1. **Run the extractor:** `node scripts/tracker-list.mjs flows <tier>` (omit `<tier>` for `all`). It reads the live tracker (`.claude/project-memory/project_critical_flows.md` — the repo-tracked file; the `~/.claude/projects/<key>/memory/` path is a symlink to it), parses BOTH table schemas (the four `### TIER` sections AND the bottom "Coverage-gap additions" table whose tier is a *column*), dedups by flow number (a full-schema row wins), sorts ascending, and prints ready-to-paste markdown tables + per-tier and grand-total COMPLETE counts.
2. **Present the script output directly — PASTE the table into your REPLY so it renders inline.** The script's stdout lands in the Bash tool-output, which the terminal **collapses to `+N lines (ctrl+o to expand)`** — so a run-and-summarize leaves the user staring at a fold, never the table they asked for. Reproduce the script's markdown table verbatim in your response text; a prose summary is NOT a substitute for the rendered table. **For the inline paste prefer `--brief`** (`# | Flow | Status | Last Audit`) — the full form's 150-char narrative closers wrap badly inline; paste the full form only when the closer detail is explicitly wanted (else offer it). It already honors the column discipline (headers name the skill; the Status column carries the canonical `✅ COMPLETE` / `⏳ PENDING` / `🔬 RESEARCH_GAP` token, the source-of-truth verdict). Still do **NOT** hand-rebuild by reading the tracker yourself — copy the SCRIPT's output (hand-rebuilding is exactly how the Final-Audit cell gets head-truncated to a stale verdict).
3. **Accuracy guarantee (why this is a script, not inline awk).** The Final-Audit cell is append-only narrative — a flow's redos are appended to the END, so the current closer sits at the tail, not the headline. `tracker-list.mjs` extracts the MAX-DATED verdict by scanning the whole cell. A naive head-truncation prints a stale verdict (one flow's headline is its April v2 while the live-latest is its 2026-06-06 re-audit). Never re-truncate by hand; if the script is unavailable, scan the WHOLE Final cell for the latest date before quoting a closer. (The same `tracker-list.mjs` engine powers `/features list` and `/ops list`.)
4. **`list` is a pure render — it does NOT run the staleness sweep.** To also catch a tracker row that lags a COMPLETE commit, run the default `/flows` Step-3 git-log sweep separately.
5. **Close with the same next-action discipline as the default view** (Closer-selection rule below): if any rendered flow is not COMPLETE, recommend "Flow #N needs /SKILL" with the right closer (`--final-audit` fresh panel vs `/audit-check` mechanical gate).

## Audit-tier columns (`list` render)

The `list` render surfaces the **audit lifecycle** as date columns — a reader sees "v1 done, v2 done, drifted-and-re-verified, --code-reviewed" at a glance instead of decoding it from the append-only Final-Audit prose. The columns directly prevent the Status-drift class where audit state lived only in ambiguous narrative.

**(a) The audit-tier model** — five tiers, each shows the **latest** date that tier ran (2 drift re-audits → the latest v3; multiple `--code` waves → the latest `c`). *Four until v4 was added to the tracking for both flows and features: the renderer learned it first, and this file and the drift detector learned it on 2026-09-22.*

| Tier | Means | `/expert-review` mode |
|---|---|---|
| **v1** | initial audit | `/expert-review <flow>` (first panel) |
| **v2** | final audit | `/expert-review --final-audit` |
| **v3** | drift re-audit | `/expert-review --v3-drift` (or a drift-scoped `--final-audit` redo) |
| **v4** | fourth pass — a full re-audit after a long gap or a regime change (an economics change, a 120-day drift) | `/expert-review --final-audit` at the v4 floor; narrated `**COMPLETE under v4** (date, …)` |
| **--code** | fix-wave diff review | `/expert-review --code <wave>` |

**`/audit-check` is the GATE, not a tier** — it never gets its own column; its date folds into whichever audit it closed. Status=COMPLETE is justified by the gate; the tier columns show *when each audit ran*. Absent tier → `—`. This is an overview index over the narrative, not a replacement for it.

**(b) Storage — the `Audit Tiers` token column.** One compact column in the tracker data file (inserted right after `Status`) holds a space-separated `key:value` token; `tracker-list.mjs` parses it into columns. Grammar (flows): `v1:YYYY-MM-DD v2:YYYY-MM-DD v3:YYYY-MM-DD v4:YYYY-MM-DD c:YYYY-MM-DD` — any key omitted = that tier absent (e.g. a v1-only flow = `v1:2026-04-08`); a never-audited row's token is literally `—`. The existing `Initial Audit`/`Fixes`/`Final Audit` narrative columns are **preserved unchanged** — the token is additive, and the full multi-audit history stays in the narrative cell.

**(c) `list` render columns** — `# | Flow | Status | V1 | V2 | V3 | V4 | --code | latest-closer` (the tail-aware latest-verdict becomes a short closer, not the full paragraph); **`--brief`** drops the closer → `# | Flow | Status | V1 | V2 | V3 | V4 | --code` (dates only). These per-tier date columns are the audit-date surface in the new render — they break the single `Last Audit` max-date out into its constituent tiers. **Back-compat:** a row with no `Audit Tiers` token (un-backfilled) falls back to the existing tail-aware date extraction, so the renderer never breaks mid-migration.

**(d) Stamp-on-audit maintenance rule (extends tracker COMPLETE flip).** The tier columns become drift surface UNLESS stamped when audits run. When an audit closes, stamp its token key **in the SAME edit as the Status flip** — `v1` on an initial close, `v2` on a `--final-audit` close, `v3` on a `--v3-drift`/redo close, `v4` on a fourth-pass close (⛔ a NEW key, never an overwrite of `v3` — the 2026-09-03 v4 re-audits of two flows were stamped over their v3 dates because no v4 slot existed, and both v3 dates had to be recovered from git on 2026-09-22), `c` on a `--code` review (use the close date). This is the tracker COMPLETE flip Status-flip co-commit extended to the tier token. `/audit-check`'s Post-Gate Action enforces it at the COMPLETE boundary; an `--final-audit`/`--v3-drift`/`--code` close that does NOT flip COMPLETE still stamps its tier key in the tracker edit it makes.
