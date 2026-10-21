---
name: instinct-sweep
description: Use when sweeping accumulated runtime telemetry for emergent patterns to promote into lessons. Runtime-observation pattern extraction — read accumulated event logs (skill-invocations, memory-write-attempts, subagent-memory-block) and surface high-frequency patterns as candidate instincts/lessons for human curation. NOT a hook — owner-invoked. Writes draft candidates to `.claude/state/instinct-candidates-YYYY-MM-DD.md` for review by `/meta learn`. Adopted from external-everything-claude-code (ECC) `/promote` mechanic + own runtime telemetry layer. Shipped 2026-05-18.
type: skill
metadata:
  version: 1.0.0
  shipped: 2026-05-18
  source: an external-system audit
---

# Instinct-sweep — Runtime pattern extraction

Closes the gap between **captured event streams** (1015+ skill-invocations + 450+ memory-write events + 42+ subagent-block events accumulated across 32 days) and **promoted lessons** (235 L# entries, all manually authored via `/meta learn`). The captured streams contain patterns the orchestrator has never extracted.

## When to Use

- `/instinct-sweep` (no args) — read recent N days of logs (default 7), surface candidate patterns
- `/instinct-sweep --days=N` — adjust time window
- `/instinct-sweep --output=<path>` — override default output location
- Run after `/meta learn` produces 5+ new lessons — useful pairing (`/meta learn` catches what user surfaced; `/instinct-sweep` catches what user MISSED)
- Run before `/external-audit claude-system` — surfaces material for the audit panel
- Auto-invocation gate: NEVER. This is owner-invoked. Auto-extraction is the "ECC instincts go global" pattern we explicitly reject (promotion is human-curated)

## Process

1. **Read log files in priority order:**
   - `.claude/logs/skill-invocations.jsonl` (highest signal — direct tool usage)
   - `.claude/logs/memory-write-attempts.log` (memory pressure points + concentration)
   - `.claude/logs/subagent-memory-block.log` (sub-agent MEMORY blocks hook fires — sub-agent bypass attempts)
   - `.claude/state/compact-checkpoint.md` (compaction events — context-loss signals)

2. **For each log, extract candidate patterns:**
   - **Skill-invocation log:** which skills fire most often? Which fire RARELY (potential dormancy)? Which patterns of args repeat (e.g., `/meta learn` always with the same boilerplate prefix)?
   - **Memory-write log:** which skill MEMORY.md files get most writes? Which haven't been touched in 30+ days? Are there time-of-day clusters?
   - **Sub-agent block log:** what file paths do sub-agents invent that don't exist (phantom paths)? Which sub-agent types attempt MEMORY writes most?
   - **Compaction events:** how often do sessions compact? Any patterns in pre-compact final messages (e.g., "still working on..." → could promote to active-wave marker)

3. **Apply ECC-style confidence scoring:**
   - **High confidence (≥0.7):** 5+ observations, distinct sessions, consistent pattern shape
   - **Medium confidence (0.4-0.7):** 3-4 observations OR similar pattern across different log streams
   - **Low confidence (<0.4):** 1-2 observations OR ambiguous pattern

4. **Filter out captured-already patterns:**
   - Grep `meta/MEMORY.md` for L# entries matching candidate themes
   - Grep `.claude/rules/*.md` for codified rules
   - Skip candidates already promoted to lessons OR rules (already in the system)

5. **Write draft candidates file:**

   ```
   .claude/state/instinct-candidates-YYYY-MM-DD.md
   ```

   Format per candidate (Markdown):
   ```markdown
   ## Candidate #N — <one-line descriptor>

   **Confidence:** high / medium / low (with N observations)
   **Log stream(s):** skill-invocations / memory-writes / sub-agent-block / compact-events
   **Pattern:** <2-3 sentence description of the recurring shape>
   **Evidence:** <3 specific log entries OR observation counts with grep commands>
   **Promotion suggestion:** L# lesson (new) / a rules row / active-recall.md trigger / skill-spec edit / hook
   **Risk of promotion:** false-positive class / surface-area / re-litigation
   ```

6. **Emit summary inline:**
   - "N high-confidence candidates → review at `.claude/state/instinct-candidates-YYYY-MM-DD.md`"
   - "M medium-confidence (review optional)"
   - "K low-confidence (likely noise — skip)"
   - "P already-captured (filtered out)"

7. **NEVER auto-promote.** The output is a curation candidate file; `/meta learn` is the authoritative promotion path. Human must review + decide.

## Constraints

- **Output goes to `.claude/state/`** (NOT any skill's memory file). The state directory is for ephemeral / candidate / draft artifacts. Curation step (manual via `/meta learn`) is what promotes a candidate to a real L#.
- **No hooks.** This is owner-invoked. ECC's `observe.sh` PostToolUse-based extraction is rejected in our system (PostToolUse fires too late for pre-emission patterns; sniff-test is the correct substrate for behavioral catches).
- **Confidence cap:** even "high confidence" candidates require human review. No 1.0 confidence — runtime patterns can mask sampling bias.
- **De-duplication mandatory:** before writing a candidate, grep existing L# entries and rules files for the topic. Already-captured = skip.

## Known patterns visible NOW (2026-05-18 baseline — to use for first invocation testing)

Three actionable patterns are ALREADY visible in current logs:

1. **Phantom path invention** — 42 events in the sub-agent block log: sub-agents invent skill paths like `/abs/foo/MEMORY.md`, `/abs/xyz/MEMORY.md` that don't exist. Pattern: sub-agents emit placeholder paths when uncertain about real skill names. Confidence: high (42 observations across 30 days). Promotion suggestion: add to sniff-test Check N or sub-agent briefing rule.

2. **Meta memory write concentration** — 183 of 451 (40.6%) memory-writes target the meta skill's own memory. Concentration signal: the meta skill's memory is the most-actively-curated skill memory. Pattern: meta is the meta-skill that writes itself. Confidence: high. Promotion suggestion: codify as observation in `/meta status` (already partially there).

3. **Memory dormancy** — 21 of 54 skill memory files have ZERO write events in 32 days. Pattern: 39% of skill memories never touched in a month. Confidence: high. Promotion suggestion: gated by project stage (early dormancy ≠ uselessness); flag for review once the project has been in use for 90 days.

These 3 patterns SHOULD appear in first `/instinct-sweep` output. If they don't, the extraction logic is broken.

## Why this isn't a hook

ECC's `observe.sh` PostToolUse hook auto-captures observations. We explicitly REJECT that pattern because:

1. **PostToolUse fires too late** — by then the bad output has shipped. Sniff-test (pre-emission self-audit) is the correct substrate for behavioral catches.
2. **Auto-promotion bypasses human curation** — leads to noise accumulating in candidate stream without filtering.
3. **Hook architecture is for ENFORCEMENT not EXTRACTION** — block-subagent-memory-write.sh blocks attempts; instinct-sweep extracts patterns. Different goal, different layer.

The right architecture: hooks ENFORCE (block-mode), skills EXTRACT (owner-invoked), `/meta learn` PROMOTES (human-curated). Three distinct layers.

## Companion skills + rules

- **`/meta learn`** — the authoritative promotion path. Read instinct-sweep candidates, decide which to promote to L# lessons.
- **`/meta status` Step 8** — dormancy probe via commit-grep heuristic. Complementary signal source.
- **`.claude/rules/active-recall.md`** — graduation thresholds: ≥3 cites → Hot Tier; ≥5 → topical rules/. Use these thresholds when scoring candidates for promotion.
- **Runtime telemetry layer** (`log-skill-invocations.sh` + `log-memory-writes.sh`) — this skill is the consumer of those captured streams.

## Revisit + maintenance

- **After first 3 invocations:** verify the 3 known-visible patterns (phantom paths / meta concentration / dormancy) appear in output. If not, fix extraction logic.
- **After 10 invocations:** measure promotion rate — what fraction of high-confidence candidates get promoted to L# / rules? If <30%, the extraction is too noisy; tighten confidence thresholds. If >70%, the extraction may be missing high-value lower-confidence patterns; widen.
- **30-day review:** measure dormancy of the skill itself — has `/instinct-sweep` been invoked in last 30 days? If not, the captured streams aren't generating enough novel patterns to justify the skill.
- **Demote criterion:** if 5 consecutive `/instinct-sweep` runs surface only already-captured patterns, the captured streams may have reached saturation — pause invocations until new log volume accumulates.

## Effort + first run

- **Implementation:** ~50 LOC (this SKILL.md spec is the implementation; the orchestrator follows the Process steps above on invocation).
- **First-run cost:** ~5-10 min for orchestrator to read 4 log files + extract patterns + write candidates file. ~30-50k tokens.
- **Output expected:** 3 already-known high-confidence candidates + 1-3 medium-confidence patterns + filtered-out list. Total output ~30-100 LOC in `.claude/state/instinct-candidates-2026-05-18.md`.
