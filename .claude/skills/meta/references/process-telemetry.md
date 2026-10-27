Actual skill-invocation telemetry from `.claude/logs/skill-invocations.jsonl`. Replaces the commit-message-grep dormant-detection proxy with measured data.

**Two writers — know which path each record came from (capture-gap closed 2026-06-16):**
- `log-skill-invocations.sh` (PreToolUse, Skill matcher) → records **orchestrator-initiated Skill-TOOL calls** (e.g. `/wrap` auto-firing session-memory/me/decisions/meta; an `/expert-review` or `/agent-work` dispatch). `source:"skill-tool"`.
- `log-user-slash-commands.sh` (UserPromptSubmit) → records **user-typed slash commands** (`/orient`, `/flows`, `/status`, …) that the harness expands as command messages and which therefore NEVER route through the Skill tool. `source:"user-prompt"`.

The two are disjoint (no double-count). **Before 2026-06-16 only the skill-tool path was logged** — so user-typed command skills read false-dormant (the 2026-06-16 run found `orient` at 0 invocations despite opening nearly every session; that was the instrument, not the skill). **Interpretation rules:** (a) records with NO `source` field are legacy skill-tool entries (pre-2026-06-16); (b) a command skill's count before that date is orchestrator-only and undercounts user usage — do NOT call it dormant on pre-2026-06-16 data alone; (c) high `skill-tool` counts on session-memory/me/decisions are inflated by `/wrap` auto-firing them — split by `source` to see real user-initiated usage. Also: pre-2026-05-18 lines have unescaped newlines in `args` that abort a naive `jq` read at the first bad line — use grep extraction (`grep -oE '"ts":"[^"]+","skill":"[^"]+"'`) over the full file, not `jq -r '.skill'`.

**When to run:** every ~7 days (weekly) OR before a system-pruning sweep OR when `/meta` dormant-detection produces a false call (claims dormancy that telemetry contradicts). Weekly rather than monthly because the signal — skill invocations from a cheap `.jsonl` log read — accrues continuously, so a weekly cadence surfaces dormancy/drift ~4× sooner at near-zero cost. The `--days` lookback window (default 30) is independent of run cadence: a weekly run reading a trailing 30-day window is the intended rolling read.

**Args:**
- `--days=N` (default 30) — analysis window in days. Invocations older than N days are excluded from counts.
- `--dormant=N` (default 60) — skills with zero invocations in last N days flagged dormant.

**Steps:**

1. **Inventory.** Count total log lines + earliest/latest timestamp. If log is missing or empty, report "no telemetry data — `log-skill-invocations.sh` may not be wired" and exit.

2. **Window filter.** Filter log to entries within `--days` window. Default 30. Use the `ts` field (ISO 8601 UTC).

3. **Aggregation.** Group by `skill` field. For each: count, first-seen, last-seen.

4. **Top / bottom slices.** Top 10 most-invoked + bottom 10 least-invoked (within window). Format as table:
   ```
   | Skill | Count | First | Last |
   ```

5. **Dormant detection.** For every skill in `.claude/skills/` (filesystem inventory), check if it appears in the window. Skills with ZERO invocations in last `--dormant` days are flagged dormant. Distinguish:
   - **User-typed command skills were not captured before 2026-06-16 (see "Two writers" above).** A command skill (orient/flows/features/ops/status/help/launch/sniff-test/…) reading 0 on a window that includes pre-2026-06-16 data is instrument-blind, NOT dormant — exclude it from prune recommendations unless the whole window is post-capture-fix. `ls .claude/skills/<name>` is a FILE not a dir for `AUTHORING.md`-style entries — filter non-dir inventory hits.
   - Skills never seen in entire log → "never-invoked" (may be new; check directory mtime).
   - Skills seen historically but silent in last N days → "newly-dormant" (candidates for pruning).
   - **Expert-agents are exempt from dormancy-by-this-log.** `skill-invocations.jsonl` records only Skill-tool slash-commands — NOT `Agent`-dispatched experts; EVERY expert skill (one with `.claude/agents/<name>.md`) reads ~0 here regardless of real usage. For expert-agents, judge by the durable-artifact trail, not this log. Dormancy-by-log applies validly only to COMMAND skills (which ARE Skill-invoked).
   - **Before reporting a skill "never logged", parse the log field-order-agnostically and check the remainder (2026-10-27).** A `"ts":…,"skill":…` regex skipped 9% of the file on 2026-10-11 and the absence claim rode on it. Parse each line with `json.loads`, fall back to independent `"ts"` and `"skill"` field matches in any order, and `grep -c '"skill":"<name>"'` the whole file for every skill you are about to call never-logged; print the unparsed count beside the claim. (2026-10-27: 744 of 11,462 non-blank lines unparsed, 157 blank lines besides, all multi-line `args` continuation lines through 2026-05-18, holding no skill record.)

6. **Trend signal (optional).** If `--days` window has ≥4 weeks of data, compare first-half vs second-half invocation counts per skill. Skills with >50% drop = "cooling" signal.

7. **Output format.** Inline report (no file). Sections: window stats / top 10 / bottom 10 / dormant list / cooling list / recommendation footer.

**Cross-check against `/meta` dormant heuristic.** When this subcommand surfaces a dormant skill, also run the commit-mention grep (from Phase 2a) on the same skill name. If both agree → high-confidence dormant. If telemetry says dormant but commits mention it → check whether commits are *about* the skill (audit log, CHANGELOG) vs *invoking* it; commits-about don't refute telemetry.

**Implementation hint:** the log is JSONL with shape `{ts, skill, args, session}`. Aggregation in shell is trivial via `jq` or `grep -oE`. For programmatic implementation reference, see how `log-skill-invocations.sh` writes the lines.

**Anti-patterns:**
- Don't blanket-prune everything dormant — some skills are seasonal (e.g., `external-audit` runs quarterly). Window the dormancy threshold appropriately.
- Don't treat low-count skills as low-value. Some skills (like `migration`) fire rarely but each invocation is high-leverage.
- Don't write the report to a file. Keep it inline.

**Output shape:** see [`references/report-formats.md`](references/report-formats.md) § Telemetry.

**Revisit:** if this subcommand runs 3× with zero actionable surfaces (no prunes, no spec-refreshes triggered), the cadence is too frequent — extend default --days window. If it produces consistent prune recommendations that user rejects, the threshold is too aggressive — raise --dormant default.
