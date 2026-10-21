# Process — Status (subcommand: `status`)

One-screen health dashboard for the expert+memory system. Faster than `/meta memory-audit` (no stale-detection) and `/meta self-audit` (no drift checks). Use when the question is "is the system healthy RIGHT NOW?" — before starting a new audit, after a big editing session, or when the size-check hook warns. Modelled on alirezarezvani `/si:status`, over health reports that were already here; step 1 runs the skill lint adopted from wshobson/agents.

## Steps (all read-only — no writes)

1. **Skill count + skill-lint pass.** `ls .claude/skills/*/SKILL.md | wc -l` + `node scripts/skill-lint.mjs`. Total skills / clean / findings-by-code.

2. **MEMORY.md size inventory — IN BYTES.** `wc -c` every `.claude/skills/*/MEMORY.md` + `.claude/project-memory/MEMORY.md`. Sort descending. ⛔ **This step read LINES until 2026-08-07, which contradicted this skill's own `/meta distill` entry in `SKILL.md` (§ Usage): "Lines are the wrong quantity … Budget MEMORY.md in BYTES. The line number remains a scannability marker only; it cannot detect the failure that actually fires." Four expert memories sat under every LINE threshold while hard-erroring their agents' opening Read.** Thresholds: **46,000 B** approaching · **57,500 B** the partial-view band (Read returns a PREFIX; the real boundary is density-dependent, ~58.8–64.3 KB) · **262,144 B** Read HARD-ERRORS with zero content. The 600-line WARN and the 4,000-line distill soft budget remain scannability markers, reported but never load-bearing.

2b. **Layout-shape census + the ARCHIVE side (added 2026-08-07).** `node -e "import('./scripts/memory-tier-split.mjs').then(m=>console.log(JSON.stringify(m.memoryCensus(),null,1)))"` — or call `memoryCensus()` directly. Reports: shape census (`classic` / `unsplit` / `sharded`), hot-side counts at each threshold, and the ARCHIVE side.
   - **Why this is not duplication.** `wrap-reconcile` 7e already measures the HOT side every wrap against the same thresholds, and `warn-large-tracker-read.sh` already covers archives. Neither reports the SHAPE — and the shape only became worth reporting once `--roll` could act on it (2026-08-07). Before that adapter, "25 classic" was a number with no action attached.
   - **The archive side is measurably worse than the hot side**, which is what motivated this step. First run (2026-08-07): hot = 6 over band, 0 over the hard cap; archives = 19 over band and **4 over the 262,144 B HARD-ERROR cap** (qa-expert 406,018 · saas-engineer 329,189 · security-expert 315,650 · saas-architect 271,808). An unbounded Read of those returns NOTHING — not a prefix.
   - ⛔ **REPORT AND STOP.** Converting a live expert's memory is an OWNER-GATED act, deliberately kept out of that adapter's scope. This step names `--roll` as now-capable of the first conversion and goes no further. A census that grows into "you should convert these 25" is a nag with a destructive suggestion attached; do not let it.

3. **Project memory index size.** `wc -c -l .claude/project-memory/MEMORY.md` against `check-memory-budget.sh`: `WARN_BYTES` warns, `CAP_BYTES` / `CAP_LINES` cap. Read the constants there, never a number restated here — the byte arm binds first (re-keyed from 120/200 LINES at /meta maintain 2026-10-11: the index sat at 133 lines and 18,785 B, past the byte warn while every line threshold read green).

4. **Skepticism distribution (v2.7.0 field).** Count skills by skepticism level — ⛔ **ANCHOR THE PATTERN, AND STATE THE DENOMINATOR BESIDE THE THREE COUNTS:** `grep -rlE '^skepticism: high' .claude/skills/*/SKILL.md | grep -c ''` and the same for `medium` / `low`. ⛔ **THE UNANCHORED FORM PRESCRIBED HERE UNTIL 2026-09-19 OVER-COUNTED `low` BY EXACTLY ONE, ON EVERY RUN, FOR THREE WEEKS.** `.claude/skills/expert-review/SKILL.md` carries the prose string `skepticism: low|medium|high` as a MENTION, which matches the `low` substring and cannot match the other two — so the bucket that was wrong was the one no alternation could balance. Measured 2026-09-19: unanchored 11 files, anchored 10, and the single differing file is that mention (use-versus-mention, live in a dashboard). **Controls, both required: the mention file must read 0 anchored and 1 unanchored.** ⛔ **AND THE TOTAL SPEC COUNT IS NOT THIS FIELD'S DENOMINATOR — the field is an expert-persona one and the agent generator excludes command skills BY DESIGN (its own comment says so), so the base is the EXPERT specs (the generator's `EXPERTS` entries), not every spec.** Print the base you used: three bucket counts with no denominator is the shape that let a wrong number sit unexamined because it was plausible. The three buckets partition the DECLARING set and were never meant to sum to the spec count. Target mix per v2.7.0 diversity check. If distribution skews (e.g., all medium) → flag for user.

5. **Agent count sync.** `ls .claude/agents/*.md | wc -l` vs. the EXPERTS count in `scripts/generate-expert-agents.mjs`. Divergence → user should run `node scripts/generate-expert-agents.mjs`.

   **5b. Mid-session agent-registry check.** `find .claude/agents -name '*.md' -mmin -240 2>/dev/null` — agents modified in last 4 hours may have been created or regenerated this session; the registry refreshes mid-session through an `agent_listing_delta` attachment (superseding the session-init snapshot this step used to assume), so a new file can lag. If any match: surface as `⚠ {name}.md mtime {T} — may not be registered yet; use the general-purpose+skill-loading fallback until an agent_listing_delta names it`. Crude proxy (mtime is weaker than true session-start diff, which requires harness access the orchestrator lacks) — catches the actionable case (agent file touched this session).

6. **Stale L-reference sweep (v2.8.2).** ⛔ **BOTH commands this step prescribed were broken by the two-tier splits and returned a clean FALSE ZERO on every run until 2026-09-19 — GREP THE DIRECTORY, NEVER THE ROUTER, AND ALLOW FOUR DIGITS.** `RULES.md` (split 2026-09-04) and `meta/MEMORY.md` (split 2026-08-06) are ROUTERS holding no rows and no lesson bodies, and `L[0-9]{1,3}` cannot match a 4-digit lesson. Measured 2026-09-19, the old form beside the new: lesson bodies `0` vs the SSOT's live count · distinct L-cites in RULES `28` vs `1140` over the shard glob — a 40× under-read and a zero, both indistinguishable from "no drift". Use `grep -ohE '\bL[0-9]{1,4}\b' .claude/skills/*/RULES*.md | sort -u | wc -l` for the cites — ⛔ **the `wc -l` is load-bearing: without it the pipeline emits a LIST and the control below has no number to compare against** — and take the lesson count from `node scripts/architecture-counts.mjs list` (`maxL` + `distinctLessons`), never a prose grep (a generic L-number pattern over a meta doc matches phantom citations quoted inside lesson bodies and reads off by hundreds — a live repo guard warns on exactly that shape). Positive control: **the cite sweep must return ≥1000 (measured 1,140 on 2026-09-19) and the SSOT read must be non-zero** — do not write "in the thousands", which a reader checking it against 1,140 can reasonably read as FAILING, turning a working instrument into a false alarm. A small number here is the instrument, not the world: it discriminates both measured failure modes, since a glob matching nothing reads 0 and a router-only glob reads 28. Surface any L-number cited in RULES but absent from the MEMORY family (renumber or deletion drift) OR any lesson L≥N without RULES-row coverage (missing enforcement). Report count + top-5 offenders.

7. **Rule-file glob validity (v2.8.2).** The front-matter key is **`paths:`**, not `globs:` — measured 2026-09-19, `grep -l '^globs:' .claude/rules/*.md` returns ZERO across all 19 files, so a sweep keyed on the old spelling has no rule to check and passes vacuously. For each `.claude/rules/*.md` with a `paths:` line in front-matter: extract each entry, run `ls -1 <glob> 2>/dev/null | wc -l`. Globs matching zero files are stale rules targeting removed code — surface for user. Example: the `paths:` entry `src/actions/**` should return >0; if zero, the rule's scope has evaporated.

8. **Dormant-skill check (`--dormant` flag, v2.8.2).** Opt-in via `/meta status --dormant`. Runs the dormant-detection grep heuristic from step 2a of the Full Review's Phase 2 in `SKILL.md` (commit-hits + memory-recency per skill over 60-day window). Surfaces top-5 possibly-dormant skills. Not included in default `/meta status` — too slow + noisy for every invocation. Use when planning a pruning sweep.

   **No-traffic gate (added 2026-05-18):** before a product has traffic, dormancy ≠ uselessness — many domain skills exist for traffic a product may not have yet (`haines-churn-prevention` is meaningless before paid users). An invocation of `--dormant` before a product has traffic should output findings with the qualifier `"(no-traffic context: pruning is premature — these may still prove load-bearing after launch)"` and NOT recommend pruning. After launch (≥90 days, when usage patterns stabilize), the flag becomes actionable.

   Detection of the no-traffic state: check `DECISIONS.md` for a `Launched YYYY-MM-DD` entry OR `.claude/project-memory/project_launch_state.md` (if codified). Absent both → assume the product has no traffic yet.

9. **Architecture doc freshness (added 2026-05-18).** Parse `.claude/docs/architecture.md` YAML frontmatter `last-reviewed` field. Compute age in days from today.
   - ≤30 days → GREEN (architecture doc fresh)
   - 31-89 days → YELLOW ("architecture doc is N days stale; consider running `/meta architecture-audit`")
   - ≥90 days → RED ("architecture doc is N days stale; `/meta architecture-audit` recommended before trusting count claims")

   Cheap check (~5 ms — read frontmatter, compute date diff). Surfaces the action — `/meta architecture-audit` is the recovery subcommand.

   **9b. `state.md` freshness (added 2026-06-04 — the "if cadence becomes a concern" trigger fired).** `.claude/docs/state.md` (companion file, split 2026-05-23) carries current health + failure modes on a WEEKLY cadence — it decays faster than architecture.md, so tighter thresholds. Parse its `last-reviewed`; compute age:
   - ≤7 days → GREEN
   - 8–29 days → YELLOW ("state.md is N days stale; refresh Part 1 fragility + Part 2 failure modes, or run `/meta architecture-audit` Step 6")
   - ≥30 days → RED ("state.md is N days stale; current-state is materially unrecorded")

   A stale architecture.md is *wrong* (bad counts); a stale state.md is *unrecorded* current-state — but unrecorded current-state IS the failure (the 2026-06-04 audit found state.md 12 days stale AND missing a velocity finding). Recovery: `/meta architecture-audit` Step 6 (state.md fragility refresh) OR a manual Part 1/Part 2 pass. **Asymmetry this closes:** architecture.md has THREE maintenance layers (`/wrap` Step 7d auto-fire + this freshness check + `architecture-counts.mjs`); state.md previously had ZERO automated signal — Check 9b is now its one staleness flag.

   **9c. Conceptual-drift signal (added 2026-07-01 — the count-sync-masks-conceptual-staleness fix).** Checks 9/9b above are CALENDAR-age only — they read GREEN at <30 days even when whole subsystems have landed un-integrated in the lecture *prose* (exactly what 9's age-flag missed: on 2026-07-01 `last-reviewed` was 8 days = GREEN, yet 5 skills + 4 hooks + ~35 lessons had accumulated since the last real Tier-2/3 pass, count-synced but never conceptually integrated). Run `node scripts/architecture-counts.mjs conceptual-due` — it measures CONTENT accumulation since `last-reviewed` (new infra + new lessons, NOT commit-count) and surfaces `⚠️ CONCEPTUAL PASS DUE` at new-infra ≥ 3 OR new-lessons ≥ 30. It prints `⛔ INSTRUMENT DARK` when a half of the gate could not be measured (added 2026-09-14) — report 9c as UNKNOWN then, never GREEN. **When 9's age says GREEN but 9c says DUE, the content signal wins** — a real Tier-2/3 `/meta architecture-audit` (not another count-sync) is due regardless of the calendar. Also wired unconditionally into `/wrap` Step 7d.

10. **`/meta coherence` cadence (added 2026-05-18).** Grep `.claude/logs/skill-invocations.jsonl` for the most recent entry matching `"skill":"meta"` with args containing `coherence` (catches both `/meta coherence` and `/meta review --coherence`). Compute age in days from today's date.
   - Never run OR ≥90 days → RED ("preference-vs-spec compliance matrix is stale OR has never been verified; run `/meta review --coherence`")
   - 31-89 days → YELLOW ("coherence matrix is N days stale; refresh before assuming preferences are honored consistently")
   - ≤30 days → GREEN

   ```bash
   last_coherence=$(grep '"skill":"meta"' .claude/logs/skill-invocations.jsonl | grep -i "coherence" | tail -1 | grep -oE '"ts":"[^"]+"' | cut -d'"' -f4)
   ```

   **Maintain-blindness caveat (2026-06-13):** a coherence run executed via `/meta maintain` logs as `args:"maintain"` — invisible to this grep. Also check `grep -iE "^## .*coherence" .claude/skills/meta/CHANGELOG.md` for a maintain-run record (CHANGELOG is maintain's ground truth) and take the newer of the two dates.
   Cheap check (~10 ms — single grep + date math). Surfaces the action — `/meta review --coherence` is the recovery subcommand. The check fires RED on never-run intentionally: the cadence problem the coherence check exists to solve is "preferences accumulate, specs drift, no one notices" — flagging never-run as RED creates the demand pressure.

   **Why this works as a cadence proxy:** coherence is read-only (writes nothing to disk), so file-mtime can't track it. JSONL invocation log is the only reliable artifact. Same approach is already used for `/meta telemetry` consumption.

11. **Capacity indicator.** Green/Yellow/Red overall:
   - GREEN — every MEMORY.md under step 2's approaching threshold + skill-lint 0 findings + project index under `WARN_BYTES` + no agent-count drift + architecture doc ≤30 days fresh + coherence ≤30 days fresh
   - YELLOW — 1-3 memories past step 2's approaching threshold OR 1-5 skill-lint findings OR project index between `WARN_BYTES` and `CAP_BYTES` OR architecture doc 31-89 days old OR coherence 31-89 days OR state.md 8-29 days old
   - RED — any memory past step 2's partial-view band (or its hard-error cap) OR >5 skill-lint findings OR project index past `CAP_BYTES` / `CAP_LINES` OR agent-count drift OR architecture doc ≥90 days old OR coherence never-run / ≥90 days OR state.md ≥30 days old

## Output format

```
📊 Meta Status — {YYYY-MM-DD}

Capacity: {GREEN / YELLOW / RED}

Skills: {N} total, {M} clean (skill-lint)
  Findings: {if any — list by code with count}

Top 5 MEMORY.md by size:
  {skill}: {lines}/{WARN} — {GREEN/YELLOW/RED}
  ...

Project memory index: {lines}/200 lines

Skepticism distribution (domain experts):
  HIGH: {N} | MEDIUM: {N} | LOW: {N}
  {flag if skewed}

Agents: {N} generated / {M} in EXPERTS table
  {"✓ synced" or "⚠ run node scripts/generate-expert-agents.mjs"}

Recommendations:
  {0-3 specific actions OR "no action required"}
```

**Scope boundary:** pure read + summarize. No writes. If a finding needs fixing, propose it; don't auto-apply. Use `/meta memory-audit` for hygiene writes, `/meta learn` for lesson writes.

**When NOT to use:** during an active audit (distracting); when just one specific file was flagged by the hook (use `/meta memory-audit` directly).

**Revisit trigger:** after 3 uses, verify whether the dashboard caught anything non-obvious. If zero actionable surfaces in 3 runs → subcommand isn't paying for itself; trim or remove.
