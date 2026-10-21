# Process — Distill (subcommand: `distill <skill>`)

Reduce MEMORY.md bloat by converting verbatim per-audit entries into prescriptive patterns. Delete source after extraction. Adopted from alirezarezvani/claude-skills `/si:promote` lifecycle (v2.8.1 — addresses "capture-only-no-curate" failure documented via security-expert 1422 lines, saas-engineer 1275 lines).

**Distinct from `/meta memory-audit`:** memory-audit flags redundancy; `distill` actively promotes patterns + deletes. Distill is the DELETE-on-confirmed-absorption pass memory-audit lacks.

## When to run

- A skill's MEMORY.md reaches URGENT (≥3000 lines) per `check-memory-size.sh` — mandatory pass
- A skill's MEMORY.md reaches WARN (≥600 lines) AND is trending toward URGENT — opportunistic pass
- After `/meta memory-audit` flags 10+ "absorbed" entries in one file
- Proactive pass every ~20 sessions on top-2 largest skills

## Steps

1. **Pre-scan.** `wc -l .claude/skills/<skill>/MEMORY.md`. If <600 lines (under WARN), abort with "not bloated enough to justify run." Confirm current line count as baseline for report.

2. **Entry extraction.** Read the skill's MEMORY.md. Group entries by dated header (`## YYYY-MM-DD` or `## FN` / `## Flow #N` or audit-date). Each entry is a candidate.

3. **Pattern detection per entry.** For each entry, score (descriptive → prescriptive):
   - Is this a verbatim audit-decision log, or a reusable pattern? (Entries with "P0 — fixed in commit abc123" are audit-specific; entries with "always check X before Y" are patterns.)
   - Is the pattern already codified elsewhere? Grep `.claude/rules/*.md`, `.claude/skills/meta/RULES.md`, or an existing RULES.md row in this skill. Codified-elsewhere = eligible for deletion.
   - Is the pattern one-shot (incident-specific) or generalizable (fires on similar future work)?

4. **Score each entry on Durability + Impact + Scope (0-3 per v2.7.3 rubric).**
   - **≥6** → keep as prescriptive pattern in MEMORY (compressed). Output format: lead with rule, then `**Why:**` + `**How to apply:**` (feedback-memory convention).
   - **4-5** → watch — compress to 1-line entry with revisit trigger.
   - **≤3** → delete. If promotion-eligible, cross-reference to `.claude/rules/`, meta RULES.md, or skill RULES.md row.

5. **Promote eligible patterns.** For entries scoring ≥6 that aren't already codified:
   - Destination: `.claude/rules/*.md` (project-wide code standard), `.claude/skills/<skill>/RULES.md` (skill-specific trigger→action), or meta RULES.md (cross-skill orchestration).
   - Write the promoted rule FIRST (land target side) before deleting source.

6. **Apply distillation rules on kept entries** (alirezarezvani pattern):
   - **Descriptive → prescriptive:** "In Flow #4, we found that pushback promotes 50% of defers" → "Before closing defer, re-challenge under 'would adversarial reviewer accept this?' "
   - **Verbose → concise:** drop narrative sections (Distinct from / Mechanism of miss / Cost of skipping) — those belong in RULES.md trigger+action format.
   - **Conditional → absolute:** "Sometimes an entry can be dropped when..." → "Drop entries with score ≤3."

7. **Propose changes in a table.** Present user-approval before destructive edits:

| Entry (dated header) | Lines | D+I+S score | Verdict | Target |
|---|---|---|---|---|
| `## audit 2026-04-07` | 47 | 2 (incident) | DELETE | cross-ref → .claude/rules/processing.md |
| `## 2026-04-10 P0 sycophancy pattern` | 28 | 7 | PROMOTE | meta RULES.md + compress here to 3 lines |

8. **After approval: execute.** Write promotions first, then delete source entries. Re-read file + report line-count delta.

**Auto-fix rule:** ≤3-entry runs (single-topic cleanup) can auto-execute inline. 10+-entry runs MUST get user approval per step 7 — wholesale memory rewrites are higher-stakes than spec edits.

**Output:** size-delta table (before / after — target ≥50% reduction for >1000-line files), promoted-rule destinations, kept-entry final state, audit trail in skill CHANGELOG.md.

**Scope boundary:** distill runs on ONE skill at a time. Don't batch across experts — context for promotion decisions is skill-specific (security-expert patterns promote to `.claude/rules/security.md`, not `supabase.md`).

**Companion skills:**
- `/meta memory-audit` — flags redundancy (read-only).
- `/meta learn` Step 2 — scores new entries on write (distill catches entries that escaped scoring or were borderline at write-time).
