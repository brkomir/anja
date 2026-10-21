---
name: meta
description: Expert system intelligence — health, evolution, and optimization of the entire expert + memory system. Use for system-wide reviews, memory audits, pattern synthesis, session-lesson extraction, or self-auditing the meta skill itself.
---

# Meta — Expert System Intelligence

Top-level abstraction expert responsible for the health, evolution, and optimization of the entire expert + memory system. Tracks how the system grows, identifies gaps, prunes waste, and ensures every future session benefits from past work.

**This is the system's self-awareness layer.** It sees patterns across all experts, tracks what works, identifies what's missing, and recommends how to grow the system. It coordinates with the orchestrator (`/expert-review`) and communicates system state to the user.

## Roles

### 1. Memory Gardener
Prune stale entries, merge duplicates, organize for optimal context loading. The memory system is a living document — entries that served their purpose should be retired, not preserved forever.

### 2. Expert System Architect  
Track the expert roster, identify capability gaps, recommend new experts or skill merges. Understand how experts interact and where handoff friction exists.

### 3. Pattern Synthesizer
Read across all expert MEMORY.md files to find cross-cutting patterns, contradictions, and emergent insights that no single expert can see. Surface these to the user.

### 4. Orchestrator Advisor
Help `/expert-review` compose better panels by tracking which expert combinations produce the best results, which experts consistently find issues others miss, and where panel sizing was wrong.

### 5. System Reporter
Give the user a clear picture of system health: how many experts, how much memory, what's stale, what's growing, what's working.

## Usage

> 💡 `/meta help` (or `--help`) lists these entry points without running anything. `/meta <subcommand> help` shows one subcommand's spec.

### Primary entry points (15 — memorize these)

- `/meta` — Full system review (memory + experts + health report)
- `/meta review [--hygiene | --patterns | --self | --coherence]` — Focused audit modes (table below)
- `/meta learn` — End-of-session lesson extraction. Run before `/wrap`. See "Process — Session Learn" below.
- `/meta new-skill <name>` — Codified procedure for adding a single new skill/expert. 6 phases: gap definition → shape decision → online research → implementation → test-fire validation → calibration patches. Distinct from `expert-system-bootstrap` (bootstraps WHOLE system). See "Process — Add new skill" below.
- `/meta status` — Memory + skill-lint health dashboard. "Is the system healthy RIGHT NOW?" See "Process — Status" below.
- `/meta queue` — Display the current Adoption Queue (workspace infrastructure roadmap). Read-only. See "Process — Queue" below.
- `/meta distill <skill>` — Reduce MEMORY.md bloat by distilling verbatim audit entries into prescriptive patterns. **Trigger:** SOFT budget ≥4000 lines (raised 3000→4000 + the 2700 "approach-nag" dropped on 2026-06-09). ⛔ **The "NOT a cliff" rationale this trigger was built on is FALSE — corrected 2026-07-31 (measured).** On-demand loading escapes the always-loaded HARNESS cap, but NOT the **Read tool's own caps, which apply to every file regardless of load mode**: **256 KB ⇒ hard ERROR (zero content)**, **~25k tokens ⇒ announced PARTIAL view**, 2000 lines ⇒ default limit. The token cap binds first for real prose at **~58.8-64.3 KB — a BAND, not a number** (it moves with content density; measured 2026-07-31 with built fixtures at 2.350 and 2.572 B/tok. An earlier "~90 KB" here was an UNVERIFIED estimate, wrong by ~50%, and it propagated to four surfaces in this file before the fixtures were built). **Lines are the wrong quantity** — measured 2026-07-31, four expert memories (qa 404 KB/1912 ln · saas-engineer 335 KB · security 314 KB · saas-architect 270 KB) sat **under every line threshold** while hard-erroring their agents' opening Read for weeks, silently. **Budget MEMORY.md in BYTES.** The line number remains a scannability marker only; it cannot detect the failure that actually fires. Distillation itself is owner-judgment (verbose→prescriptive, redundancy removal). Soft re-calibration history: 1500→2000 (05-20)→3000 (05-25)→4000 (06-09) — each a budget bump, not a correctness fix. Adopted from alirezarezvani/claude-skills `/si:promote` lifecycle. See "Process — Distill" below.
- Lesson retirement — no command since 2026-10-11: a lesson a later one SUPERSEDES / REFUTES / WITHDRAWS gets the mark on its HEADING at its source (`/meta learn` Step 2c; the mark's grammar is in `RETIRED.md`); the sweep that moves heading-marked lessons to the cold `RETIRED.md` is built once ≥20 headings carry the mark. The per-lesson `/meta demote <L#>` command (shipped 2026-06-09 as the first-class DELETE) was PRUNED by its own Revisit clause — 0 invocations in 123 days. Distinct from `/meta distill` (which COMPRESSES).
- `/meta telemetry [--days=N] [--dormant=N]` — Skill invocation telemetry from `.claude/logs/skill-invocations.jsonl`. Top/bottom invocation counts, dormancy detection, trend over time window, from real data instead of a commit-message grep proxy. See "Process — Telemetry" below.
- `/meta post-compact` (legacy alias: `postmortem`) — Compact recovery (auto OR explicit `/compact`). Mid-session use after a compaction event when the system's generic continuation summary feels insufficient. Augments with umbrella work-subject + detailed last-exchanges + explicit hand-off state. Writes ONE file — this session's working plan (mandatory since 2026-09-04) — and never acts on the recovered context (this line said "Read-only" until 2026-10-11). Renamed from `postmortem`, which collides with `/premortem` + incident-retro connotations; this is compact recovery. **Spec: `.claude/skills/post-compact/SKILL.md`** — split out 2026-09-04; `/meta post-compact` is a legacy alias that dispatches there. See "Process — Post-Compact" below for the routing pointer.
- `/meta architecture-audit [--strict]` — Audit `.claude/docs/architecture.md` for staleness across 3 tiers (mechanical count drift / content coverage / conceptual gaps). Auto-fixes ≤5-line mechanical drifts inline (count corrections, stale L# refs, `last-reviewed`/maxL refreshes); surfaces Tier 2/3 as proposals. **Trigger:** every ~30 days OR after ≥10 meta-system commits OR doc `last-reviewed` frontmatter >90 days old. `--strict` mode treats any Tier 1 finding as failure (exits non-zero — for CI/auto-fix flows). Adopted 2026-05-18 after a 35-finding ad-hoc review surfaced the cause-fix for recurring doc drift. See "Process — Architecture Audit" below.
- `/meta doc-content-audit [<doc>]` — CONTENT/claim-verification pass over the meta-system prose docs. **No argument = the WHOLE SET**: every `.claude/docs/*.md` whose frontmatter reads `type: docs` — derive the membership, never restate it (`grep -l '^type: docs' .claude/docs/*.md`); `<doc>` scopes to one. Three doc types drive the currency test (Step 1): CONCEPTUAL-durable, LIVE-STATE, EVIDENCE-DATED reconstruction. Per doc: read each section, source-verify every mechanism-claim against the LIVE system, check conceptual currency + scope-bounded gaps, then rewrite per findings. **On a LARGE doc it runs in TWO phases: a targeted-claim Phase 1 → an auto-started deep conceptual-dive Phase 2 (parallel reading agents over every section — Step 6b).** The CLAIM-drift complement to `architecture-audit`'s COUNT-drift pass — and because it rewrites prose, it is **owner-invoked only, never cadence-fired**. Added 2026-06-18; deep-dive Phase 2 made default 2026-06-19. See "Process — Doc Content Audit" below.
- `/meta qa-plan-audit [--strict]` — Cadence-fired consolidation audit for `QA_TESTING_PLAN.md` (the product manual-QA artifact) — the doc-maintenance complement that `architecture-audit` is for the meta-system reference doc. Detects superseded-duplicate flows (missing tombstones) / dead-premise items / dangerous safety-test wording (RED) / already-covered → pointer candidates. **Trigger:** Part 7 >60 subsections OR ≥8 duplicate flows OR before a blocker pass. Built at N=1 (SC-3 waived) after a 6-expert review pass found ~110 prunable items. See "Process — QA Plan Audit" below.
- `/meta corrections [--scan | --dig | --analyze | --prime | --add-entry] [args]` — Owner-pushback-correction event registry (**shorthand `/meta prime`** → `corrections --prime`, the compact session-start blindspot spotlight). Companion to `/meta learn` (lesson codification) at a different granularity: registry captures individual events, /meta learn codifies cross-event patterns. Auto-fires at `/wrap` Step 7f when current-session scan returns ≥1 candidate. Adopted 2026-05-25 after the 67-entry bulk triage on 2026-05-24 validated the data-collection workflow. See "Process — Corrections" below.
- `/meta triage <rules-file>` — Executing-triage of ONE always-loaded rules file: 2 read-only agents RUN its checkable claims (not grade its prose), corrections ship immediately, cuts are owner-gated with archive-conservation + the preservation gate. Codified at N=3. See "Process — Executing-Triage" (`references/process-triage.md`).
- `/meta maintain [--only <a,b> | --dry-run]` — Sequenced runner for the maintenance family (status → corrections scan → memory-audit → router-staleness → self-audit → architecture-audit → coherence → telemetry → patterns → cite-check). Runs ALL members with a non-gating context-read preamble (the due-check GATE was retired 2026-07-19 after 3 consecutive all-due runs; `--all` remains as a legacy alias). Approval-level findings batch into ONE consolidated table at the end; per-member auto-fix rules unchanged. One `meta(maintain):` commit per run. See "Process — Maintain" below.

### `/meta review` modes

| Flag | Alias for | What it runs | When |
|---|---|---|---|
| `--hygiene` | `/meta memory-audit` | Deep Phase 1 across ALL memory files (stale + dup + size budget + index) | `check-memory-size.sh` warns OR the project index passes `WARN_BYTES` in `check-memory-budget.sh` |
| `--patterns` | `/meta patterns` | Cross-expert synthesis only (Phase 2b+2c+2d) — contradictions, stale xrefs, emergent themes | Monthly insight read, or after 5+ experts updated memory in short window |
| `--self` | `/meta self-audit` | Audit meta/SKILL.md + meta/MEMORY.md itself (staleness, ordering, contradictions, closed-gap cleanup) | Every ~5 sessions, or after major meta edit |
| `--coherence` | `/meta coherence` | Cross-check `user_profile.md` + `feedback_*.md` preferences against actual skill-spec behavior | Monthly; after major skill-spec edits; when user asks "is my preference honored?" |

**Legacy subcommand names still route.** `/meta stale`, `/meta experts`, `/meta report`, `/meta memory-audit`, `/meta patterns`, `/meta self-audit`, `/meta coherence` all dispatch to the same Process sections below. Historical references (CHANGELOGs, hooks, external-system comparisons, scheduled triggers) remain valid and are NOT rewritten. Going forward prefer `/meta review --flag` — faster to recall and flags compose (e.g., `--hygiene --self` in one pass).

## Memory & Versioning (date + `L#`, not semver)

This skill maintains three files:

- **`.claude/skills/meta/MEMORY.md` + `MEMORY-ARCHIVE-*.md`** — Narrative source-of-truth: lessons L1-N (evidence-rich), panel playbook, system state, evolution timeline, structural gaps. **TWO-TIER since 2026-08-06:** `MEMORY.md` is a small ROUTER (shard manifest + current-shard digest rows) and IS loaded when /meta is invoked; the bodies live in dated `MEMORY-ARCHIVE-<from>-<to>.md` shards beside it, each ≤200 KB. ⚠️ **Sizes here are DATED readings — re-derive with `wc -c .claude/skills/meta/MEMORY*.md`, never restate** (this line said "~26 KB" until 2026-08-24, when the router measured 5,513 B — a 4.7× overstatement, and the router shrinks on every roll). ⛔ **≤200 KB clears the 256 KB HARD-ERROR cap; it does NOT clear the ~58-64 KB PARTIAL-VIEW band — 17 of 21 shards are over it as of 2026-08-24, so an unbounded Read is REFUSED by `warn-large-tracker-read.sh` ARM B with paging coordinates.** Retrieval = manifest lookup → grep the anchor → `Read` with an `offset` (never bare); **grep the skill DIR, never `MEMORY.md` alone.** *(Until the split this line said "Loaded when /meta is invoked" of a 3.14 MB file — 12× the Read hard-error ceiling, so no load ever occurred.)* The live registers moved out to **`WATCH-TIER.md`** and **`ADOPTION-QUEUE.md`**. ⛔ **AND `WATCH-TIER` IS ITSELF SHARDED SINCE 2026-09-13 — the rows live in `WATCH-TIER.md` + `WATCH-TIER-PART-NN.md`, so `grep -n '<row>' .claude/skills/meta/WATCH-TIER*.md`; a grep of `WATCH-TIER.md` ALONE now reads a clean ZERO for a row that exists.** Unlike the archive shards, every register part is sized to READ WHOLE (the guard's `SKILLMEM_THRESHOLD`, not the 200,000 B shard cap) because a live register is read and edited by hand. This REVERSES an earlier review's kept-whole exemption, which had left `--heal` refusing the entire meta router with no reachable exit — its prescribed remedy, the AGE RULE prune, had already returned zero cuttable rows. `ADOPTION-QUEUE.md` keeps the exemption: it carries no `partCap`, so it is still kept whole.
- **`.claude/skills/meta/RULES.md`** — Flat trigger→action lookup table (one row per trigger phrase, cites `L{N}` back to MEMORY). Loaded alongside MEMORY when /meta is invoked. ⛔ **TWO-TIER SINCE 2026-09-04 — `RULES.md` is a ROUTER (~14 KB, reads whole) and the rows live in `RULES-SHARD-*.md` beside it. GREP THE DIR, never the router alone:** `grep -n '<trigger>' .claude/skills/meta/RULES*.md` — a grep of `RULES.md` by itself now returns a clean zero for a rule that exists, the same false-refutation shape the MEMORY two-tier split carries. **The split RE-OPENED on the premise its own closure named.** An earlier pass closed it 2026-08-06 with *"38 sections, ZERO over the partial-view band"* and made the PREMISE the thing to re-check; re-derived 2026-09-04 at 458,660 B — still 38 sections, but `## AH. Session procedure` had reached **77,255 B** while the second-largest was 35,885 B, **+1 B in eleven days**, so every byte of growth was in one section and that section could no longer be read whole by ANY route. The file was then split in full. **Tool: `node scripts/rules-tier-split.mjs --check|--apply`** — it re-assembles router+shards before re-splitting (so append a section to the router and re-run), sizes every shard under the `SKILLMEM_THRESHOLD` it reads out of `warn-large-tracker-read.sh` rather than restating it, conserves per-section bytes and the row multiset, and ABORTS rather than write on a mismatch. **Use as the active-recall layer at composition time** — grep the DIR for your trigger phrase BEFORE producing output.
- **`.claude/skills/meta/CHANGELOG.md`** — Date-stamped log of every structural change (new experts, merges, deprecations, memory maintenance), one entry per session. **Semver version numbers (`vX.Y.Z`) were retired 2026-04-22 at `v2.8.6`** — the system is now versioned by entry date + lesson number (`L#`, the monotonic counter in MEMORY.md); a single semver counter doesn't survive parallel sessions, an append-only date+`L#` log does. Older `## vX.Y.Z` headings remain as historical record. Append after each session that modifies the system. ⛔ **APPEND TO THE CURRENT (newest-end-dated) `CHANGELOG-ARCHIVE-*.md` SHARD, NEVER TO `CHANGELOG.md` — that file is a two-tier ROUTER and everything below its `ROUTER PREAMBLE ENDS` marker is REGENERATED from the shards, so a hand-written entry there is correctly discarded by the next `--heal` or `--roll`.** The tell is `git diff --numstat` reading `0 <n>` on the router — zero additions, deletion of exactly what you just wrote. Same two-tier shape as MEMORY.md, stated separately because this line prescribed the router by name and two sessions walked into it hours apart on 2026-09-02 (the second seat had the first seat's write-up in the very file it should have appended to). Resolve the shard by MAX END-DATE, never `ls -t`.

**Inclusion criteria for RULES.md (must satisfy all 3):** trigger (concrete cue) + action (sub-15-sec check) + generalizable (fires across many contexts). Lessons that don't qualify (principles, post-mortems, panel playbook, evolution timeline, structural gaps) stay MEMORY-only.

MEMORY.md tracks:
- **System evolution timeline:** When experts were added, merged, or deprecated
- **Review history:** What was found and fixed in each periodic review
- **Pattern observations:** Cross-expert insights discovered during reviews
- **Growth recommendations:** What the system needs next (deferred to the user)
- **Effectiveness signals:** Which expert combinations worked well, which produced phantom consensus or lazy deferrals

## Process — Full Review

### Phase 1: Project Memory Audit

**1a. Stale Entry Detection**
Read every memory file. For each:
- Code references: Does the file/function still exist?
- "Deferred until X": Has X happened?
- Status claims: Does code confirm?
- Decisions with "revisit when": Has the trigger been met?

Classification: STALE-UPDATE / STALE-DELETE / CURRENT

**1b. Duplicate / Overlap Detection**  
Group by topic. For each group with 2+ files:
- True duplicate → merge into one
- Evolution (newer is stricter) → keep newer, delete older
- Complementary → consider merge into comprehensive entry
- Distinct → keep both

**1c. Type Classification**
- `project` entries about completed work → candidate for pruning
- `feedback` entries absorbed into SKILL.md rules → redundant, consider deleting
- `reference` entries → verify pointers still valid

**1d. Index Organization**
- Measure BYTES against `check-memory-budget.sh` — `WARN_BYTES` warns, `CAP_BYTES` / `CAP_LINES` cap (the byte arm binds first; read the constants there, never a number restated here)
- Group by topic with section headers (not chronological)
- Ensure descriptions are specific enough to decide relevance

**1e. Size Budget**
- Score each file: high value (prevents mistakes) / medium (active reference) / low (completed status)
- Bottom 20% are pruning candidates
- Total context budget awareness

### Phase 2: Expert System Audit

**2a. Expert Roster Health**
For each expert in `.claude/skills/*/`:
- Read SKILL.md — is the scope still accurate?
- Read MEMORY.md — how many entries? Any stale? Any contradictions with other experts?
- Check last consultation date (from memory entries)
- Flag dormant experts (never or rarely consulted)

**Dormant-detection grep heuristic (proxy for skill telemetry):**
```bash
for skill in .claude/skills/*/; do
  name=$(basename "$skill")
  commit_hits=$(git log --all --oneline --since="60 days ago" --grep="$name" | wc -l)
  memory_recency=$(git log -1 --format="%cr" -- "$skill/MEMORY.md" 2>/dev/null || echo "never")
  echo "$name | commits-mentioning: $commit_hits | memory-touched: $memory_recency"
done | sort
```
This is a crude proxy — doesn't measure runtime invocations (true telemetry needs a hook on the Skill tool). But it catches obviously-dormant skills (zero commit mentions in 60 days + memory untouched) which is the actionable signal. Run this when 5+ skills look possibly dormant or before a system-pruning sweep.

**Caveat — expert-agents read ~0 by ANY invocation proxy.** Neither this commit-grep nor `skill-invocations.jsonl` records `Agent`-dispatched experts (saas-engineer, qa-expert, uncle-bob, … — dispatched via the Agent tool / Workflow `agentType`, invisible to the Skill matcher and not named in commit messages). A 0/low reading for an EXPERT skill (one with a matching `.claude/agents/<name>.md`) is instrument-noise, NOT dormancy. Judge expert-agent dormancy by the **durable-artifact trail** (dated MEMORY/CHANGELOG audits with file:line, BACKLOG/DECISIONS citations, `/expert-review` routing membership, shipped outputs). Dormancy-by-invocation applies validly only to COMMAND skills.

**2b. Expert Memory Cross-Check**
Read all expert MEMORY.md files and look for:
- **Contradictions:** Expert A decided X, Expert B decided opposite
- **Stale code references:** File paths, function names, line numbers that no longer exist
- **Absorbed decisions:** Decisions that are now in the code and don't need to be in memory
- **Missing cross-references:** When Expert A's decision affects Expert B's domain but B doesn't know

**2c. Capability Gap Analysis**
Based on recent audit history and the department directory in `/expert-review`:
- Which domains were consulted most?
- Which domains produced the most findings?
- Are there emerging concerns not covered by any expert?
- Are any experts redundant (their scope fully covered by others)?

**2d. Panel Effectiveness Tracking**
From audit history in expert memories:
- Which panel sizes were right vs. over/undersized?
- Which experts consistently found issues others missed? (high signal)
- Which experts produced phantom consensus? (low signal)
- Which expert combinations had the best finding-to-noise ratio?

**2e. Non-skill folder health (extends Phase 2)**
Audit the rest of `.claude/`:
- **`.claude/commands/*.md`** — each file should reference current skills. Check for orphans (file claims a skill exists/works that's been renamed or removed) and stale content (e.g., expert counts, department lists).
- **`.claude/templates/*.md`** — list which templates are referenced from any SKILL.md. Templates with zero references are orphaned.
- **`.claude/hooks/*.sh`** — verify each script still exists and is referenced in `.claude/settings.json` (otherwise it's dead).
- **`.claude/rules/*.md`** — sample-check the `paths:` frontmatter at the top of each scoped file — does the glob still match current code structure?
- **Skill ancillary files** — for skills with non-SKILL/MEMORY/CHANGELOG content (e.g., `prompt-patterns.md`, `pricing-playbook.md`), verify each is referenced from its SKILL.md (orphan check) and that referenced code/decisions still hold (drift check).

### Phase 3: System Report

Present findings in the **Expert System Health Report** format — see [`references/report-formats.md`](references/report-formats.md) § Full Review.

## Process — Session Learn (subcommand: `learn`)

End-of-session lesson extraction. Distinct from Full Review (which audits current state) — this synthesizes what just happened. Run before `/wrap`. Skip on sessions <5 messages / no decisions / pure read-explore.

**Full spec:** [`references/process-learn.md`](references/process-learn.md) (6 steps: conversation scan → diff-vs-knowledge → expert MEMORY proposals → skill-spec proposals → deferral sweep → structural gaps) + RULES.md write-target classification + Durability+Impact+Scope 0-3 scoring rubric + Panel Playbook auto-update + principles + defaults for borderline decisions.

**Core rule to remember inline:** new lesson promotes to RULES.md only if it has all 3: concrete trigger + sub-15-sec action + generalizable. Else MEMORY-only. Durability+Impact+Scope total ≥6 promotes; 4-5 watch; ≤3 ignore. Auto-write for meta MEMORY; approval required for skill/expert edits.

**Most common signals to watch for:** user pushback ("are you sure?"), agents launched (right tool?), defer-with-trigger added, LARP markers (~Nh / N days / "post-launch" → training-data override failure, re-run citing the agent's "Agent-mode operating posture" preamble), "we should add X" without action. **Full signal table:** see references/process-learn.md.

## Process — Memory Audit (subcommand: `memory-audit`)

Deep Phase 1 pass only. Use when the `check-memory-size.sh` hook warned on a MEMORY.md file growing past threshold, OR when triaging memory hygiene without needing a full system review. Faster than `/meta` (no expert roster, no non-skill folder sweep) — ~2-3 min wall-clock on current scale.

**When to run:** hook-triggered warning, end-of-session cleanup when skeptical defer re-pass defer-promotion rate spikes (signals memory has gotten noisy), or proactive every ~10 sessions.

**Steps:**

1. **Size inventory.** **BYTE-count (`wc -c`) AND line-count every MEMORY.md** + the project memory index. **Bytes are the load-bearing axis** (see Distill trigger): flag any HOT router past `SKILL_CEILING_BYTES` — ⛔ **NOT a silent partial view, MEASURED FALSE 2026-08-06: `warn-large-tracker-read.sh` ARM B matches `.claude/skills/*/MEMORY*.md` at the same `SKILLMEM_THRESHOLD` and emits `permissionDecision:"deny"` WITH computed paging coordinates, so the agent is TOLD and handed a tail-first offset** — ⛔ **and the hook labels that a SEVERITY correction ONLY: an over-band file is still over band and still owes a roll, so do not read "the agent is told" as a reason to deprioritise it** — or past the Read HARD-ERROR ceiling, where the agent runs memory-blind. ⛔ **AND AN ARCHIVE IS COLD: judge a `MEMORY-ARCHIVE-*.md` shard against `ARCHIVE_WARN_BYTES`, never the hot ceiling** — `check-memory-size.sh` forbids that substitution by name, and under the hot number every shard in the corpus reads flaggable while the right instrument flags almost none. **Re-derive all four constants from `check-memory-size.sh` + `warn-large-tracker-read.sh`; never restate a KB figure here.** The line threshold `WARN=600` (`check-memory-size.sh`) is a scannability proxy that CANNOT see either cliff (the 4000-line URGENT arm was RETIRED 2026-08-01). Always-loaded project index: warns on BYTES (`WARN_BYTES`), with no line warn; HARD cap `CAP_LINES` lines (per `check-memory-budget.sh`) — ⛔ **BUT LINES ARE NOT THE BINDING AXIS HERE EITHER, AND THIS CLAUSE STATED ONLY LINES UNTIL 2026-09-04.** `check-memory-budget.sh` ARM 1 fires on `proj_bytes > CAP_BYTES` **OR** `proj_lines > CAP_LINES`, and `CAP_BYTES` is the harness's real character cap — grep the constant, never restate it. Measured at the moment this was fixed: the index read **174/200 lines (13% headroom, comfortable on the axis this clause named) and 24,984 of 24,985 bytes — ONE character from silent truncation.** A maintainer reading the line thresholds alone concludes there is room. Read BOTH arms; the byte one binds first on a mature index.

2. **Stale detection (Phase 1a intensified).** For every file >WARN threshold:
   - Code references: do cited files/functions/line numbers still exist (grep-verify at least 3 references per file)?
   - "Deferred until X" / "Revisit when Y" entries: has the trigger condition been met? (Check `todo.txt` + git log since entry date.)
   - Status claims: does current code confirm?
   - Classification per entry: STALE-UPDATE / STALE-DELETE / CURRENT.

3. **Duplicate sweep (Phase 1b intensified).** Group entries by topic across memory files — not just within. Cross-expert duplicates are the highest-leverage prunes (e.g., the same decision redundantly persisted in 3 expert memories).

3b. **Intra-file dedup sweep (project-memory MEMORY.md only).** The auto-memory index has 2 layers (Trigger Index = enforcement; topical pointer index = state/retrieval). Walk both layers. Any `feedback_*.md` reference appearing in BOTH is a candidate for topical-side deletion (Trigger Index is the load-bearing layer for composition-time scan). Workflow:* subsections of the topical index are the highest-density dupe surface because they mirror Trigger Index subsections 1:1. **Pre-delete safety check:** `grep -rln '## Workflow:' .claude/ scripts/` — any skill/agent/hook using those section headers as load-bearing routing blocks deletion. **Auto-fix rule:** ≤60-line removal AND zero load-bearing hits → apply inline. Larger → propose with diff. **Worked example (memory-cap dedup, 2026-05-21):** 211 → 158 lines via dropping 5 Workflow:* sections + User & Preferences dupes; recovered 11 silently-truncated entries past the harness `min(200 lines, 25 KB)` cap (https://code.claude.com/docs/en/memory). **Anti-pattern (do not do):** raising project-side cap — has zero effect on harness loader. Aggressive content removal of unique state pointers — those are load-bearing.

4. **Absorbed-into-SKILL.md check.** For feedback memories and short project memories: has the content been codified into a skill spec or rule file? If yes, the memory entry is redundant — candidate for deletion with cross-reference to the skill location.

5. **Index organization.** Re-group `MEMORY.md` index by topic (not chronological). Verify descriptions are specific enough to decide relevance.

5b. **Config-literal drift sweep.** Run `node scripts/memory-config-drift.mjs` (not in this copy) — it extracts the plan and pricing constants from the product's source-of-truth constants file and flags any `.claude/project-memory/*.md` line asserting a *current* value that drifted (history-marked lines auto-skipped to control FPs). Warn-mode; also wired into `.githooks/pre-push` (not in this copy; fires when project-memory docs OR the source-of-truth file change). For each finding: de-brittle the literal to its constant/SSOT-pointer, or correct the number. This is the structural sweep the memory docs lacked — the product's copy-drift test guards the message bundle but never the memory docs, so they rotted silently after a repricing (the audit that created this step).

6. **Auto-fix rule:** ≤5-line mechanical edits (fixing a stale line number, deleting an absorbed entry, renaming a section header) apply inline. Larger reworks (>15 lines, or anything touching the lessons list numbering) surface as proposals for approval before write.

**Output:** size-delta table (before/after), list of deletions/merges with 1-line justification each, any entries flagged CURRENT-but-concerning for user review, updated MEMORY.md index line count.

## Process — Patterns (subcommand: `patterns`)

Cross-expert synthesis only. No memory-gardener, no roster audit, no self-audit. Pure pattern-recognition across all `.claude/skills/*/MEMORY.md` files. Use when seeking *insight* (what themes recur, what experts contradict each other, what's emerging across the system) rather than *hygiene* (what to prune).

**When to run:** after big multi-expert sessions where 5+ experts wrote memory entries in a short window, or monthly as a system-health read. Cheap when done with a reading agent; costs ~3-5 min wall-clock.

**Steps:**

1. **Cross-expert contradiction scan (Phase 2b-intensified).** Walk every expert MEMORY.md. For each decision with the pattern "X is correct" or "Y is wrong", search sibling memories for opposing stances on the same topic. Contradictions are highest-value output — they indicate the system hasn't converged and will produce inconsistent recommendations depending on which expert fires.

2. **Convergence patterns.** The inverse of (1): when 3+ experts independently reach the same conclusion on a topic, it's a candidate for promotion from per-expert memory to a project-wide rule (`.claude/rules/`) or meta lesson. Surface these as promotion candidates. **Codification-check before claiming un-codified.** A convergence is a PROMOTION candidate ONLY if it is not already codified — BEFORE surfacing it as un-codified, grep the codified state: `.claude/rules/*.md` + meta/MEMORY.md L#s (`architecture-counts.mjs list → maxL`, never a prose grep) + the Watch-tier register + `DECISIONS.md`. If an existing L#/rule/watch-entry/DECISION already covers it → record "already-codified (cite the anchor)", NOT a promotion candidate. This sweep has no codification-check, so it over-reports "un-codified" (N=2 2026-06-25: all 4 surfaced "convergences" were already codified — as existing lessons, a watch-candidate or a haines doctrine; and all 3 "open disputes" were already settled). The same check applies to the Step-1 contradiction/"dispute" surfacing: a dispute already resolved in code or `DECISIONS.md` is STALE, not open.

3. **Stale cross-reference sweep.** Grep every memory for references to files/functions that have been renamed, moved, or deleted (git log --oneline --diff-filter=D, --diff-filter=R since the memory's last-modified date). These are "time bombs" — memories that still read correct but cite code that no longer exists.

4. **Emergent-theme detection.** If 3+ experts mention a theme NOT yet in project memory or rules (e.g., "parallel-session coordination" was emergent across 8 sessions before a lesson codified it), flag for user — the theme wants a dedicated rule or memory entry.

5. **Capability-gap analysis (Phase 2c intensified).** For each expert, count findings generated in last 30 days. Zero-finding experts for 60+ days are dormant — flag for potential consolidation. Many-finding experts (>20 in 30 days) may need scope decomposition.

6. **Panel-effectiveness rollup.** Cross-reference the `Panel Playbook` sections in the meta `MEMORY-ARCHIVE-*.md` shards (grep `Panel Playbook` across `.claude/skills/meta/`; the `MEMORY.md` router holds none) with outcomes (defer-promotion rates, finding-to-noise ratios per expert per audit). Update the "Who finds real bugs" and "Reliable pairs" sections if evidence has shifted.

7. **Demand-side capability-gap sweep.** The catalog of un-adopted solutions is SUPPLY-side only — anti-scope `### REJECTED` rows, Adoption Queue QUEUED items, and `🟡`-partial COMPARISON.md cells — and its revisit-triggers are PASSIVE (nothing watches them against accumulated pain). So a pattern solved elsewhere can sit un-adopted for weeks while the matching pain recurs (the session-lifecycle signal sat unbuilt while re-wrap friction recurred 2-5×/session). This step performs the demand→supply MATCH the passive triggers never do: take the dominant pains from `scripts/meta-corrections-scan.py --analyze` (top pattern-tag distribution) + any friction surfaced this window, and for each, scan the three un-adopted catalogs for a solution that addresses it — (a) anti-scope REJECTED (is the rejection's revisit-trigger now firing?), (b) Adoption Queue QUEUED (is the LOC-cheap item's trigger met?), (c) `🟡`-partial matrix cells (is the cited missing slice now the pain?). Surface any match as a promotion candidate (→ `/meta learn` for D+I+S + build). Cheap — reuses the `--analyze` output + reads three already-existing catalogs; the value is the ACTIVE pain↔catalog match. NOT a new subsystem (don't meta-meta) — it's a reading step inside `/meta patterns`.

**Output:** contradiction table (X vs Y, with file:line citations), convergence list (N experts agree on Z → promote to rule?), stale-reference list (file paths that no longer exist), emergent-theme proposals, dormant/hot-expert flags, panel-playbook deltas, **demand-side promotion candidates (recurring-pain ↔ un-adopted-catalog matches)**.

**Scope boundary:** no writes to memory files during `/meta patterns` — surface-only. Writes belong to `/meta memory-audit` (hygiene) or `/meta learn` (new lessons). Patterns is read-and-analyze; its output drives subsequent `/meta memory-audit` + `/meta learn` work.

## Process — Coherence (subcommand: `coherence`)

Cross-check user preferences (from `user_profile.md` + all `feedback_*.md`) against actual skill-spec behavior. Surfaces drift between "user said they prefer X" and "skills actually implement X." Read-only; output is a compliance matrix. Companion to `/me` (which runs 2–3-probe shallow spot-checks on default invocation) — this is the exhaustive sweep.

**When to run:** monthly; OR after major skill-spec edits (verify new spec didn't override a user preference); OR when user asks "is my preference being honored consistently?".

**Steps:**

1. **Extract user preferences.** Read `user_profile.md` + every `feedback_*.md` in the project memory directory. Build a list of discrete, concrete preferences — each one a ≤15-word phrase (e.g., reports go inline rather than to a file; consult the customer persona proactively on UX; translate internal codes on first use; never use git stash; destructive hygiene ops trigger late rather than preventively). Skip identity claims (business entity, stack) — these aren't behavioral preferences.

2. **Map preferences to target skill specs.** For each preference, curate the small list of skills where it *should* apply. Example mappings:
   - inline reports, not files → observations, meta, orient, status, flows, features, ops, backlog
   - customer persona consulted proactively on UX → expert-review, ux-design-pro routing
   - internal codes translated on first use → observations, orient, /wrap, any report-producing skill
   - no git stash / no git add -A → wrap, audit-check, agent-work, and the .claude/hooks/bash-safety-warn.sh hook
   - destructive hygiene triggers late → meta (distill), observations (hygiene section)
   - recommend AND execute for <15 LOC → every command skill
   Not every preference has a target — some are orchestrator-level (applied inline, not codified in a spec). Those get flagged as "orchestrator-enforced" with no matrix row.

3. **Classify each target skill per preference:**
   - **COMPLIES** — spec explicitly references the preference OR mirrors it in output format / procedure
   - **SILENT** — spec doesn't address the preference (may or may not comply in practice; no drift but no signal)
   - **CONTRADICTS** — spec explicitly states opposite behavior (real drift; high-priority finding)
   - **N/A** — preference doesn't apply to this skill's scope

4. **Build the output matrix + gap analysis.** One section per preference:
   ```
   ### Preference: reports go inline, not to a file
   COMPLIES (N):   observations, meta
   SILENT (M):     orient, status, flows, features
   CONTRADICTS (K): — none
   ```
   After the per-preference matrix, aggregate:
   - **Red flags:** every CONTRADICTS entry (name the skill + quote the contradicting sentence + propose a 1-line fix).
   - **Amber flags:** SILENT entries where the preference plausibly applies (the skill produces reports but doesn't state format discipline).
   - **Green:** preferences where every target skill COMPLIES.

5. **Propose fixes for CONTRADICTS only.** SILENT entries do not auto-propose edits — they're observations, not drift. Propose edits inline for the user to approve; do NOT auto-apply (this subcommand is read-only).

6. **Summary footer:**
   ```
   Preferences scanned: N (from user_profile.md + M feedback files)
   Target skills scanned: K
   CONTRADICTS: {total}
   SILENT-but-relevant: {total}
   Overall coherence score: {COMPLIES / (COMPLIES + SILENT + CONTRADICTS)} — informational only
   ```

**Output shape:** see [`references/report-formats.md`](references/report-formats.md) § Coherence (the prior inline render — a dated 2026-04-19 snapshot — was extracted + de-dated 2026-06-22 to stop it rotting on every `/meta` load).

**Scope boundary:** read-only. No writes to skills, no writes to memory. Output is the matrix + fix proposals for user approval. Applied edits go through the user's explicit "yes, apply X" + Edit tool.

**Revisit:** if `/meta coherence` runs 3× with 0 CONTRADICTS and 0 actionable SILENT findings, the cross-audit is over-engineered — prune or relax. If it consistently surfaces 3+ CONTRADICTS, preference propagation discipline is weak — propose scaffolding (e.g., a hook that greps new skill-spec commits against preference keywords).

## Process — Self Audit (subcommand: `self-audit`)

Audit meta's own SKILL.md + MEMORY.md for the drift patterns `/meta learn` catches in other skills. Prevents the meta skill from becoming the thing it critiques.

**When to run:** every ~5 sessions, or after any major meta edit, or when confidence in a meta statement is low.

**Checks (14):**

1. **Embedded-number drift.** Grep SKILL.md for numeric claims (lesson counts, expert counts, phase counts, gap counts). Cross-reference against actual state. Example: SKILL.md said "currently 24 lessons"; actual was 26 after two more were added.

2. **Ordering inconsistencies.** Phase/Step numbers should be sequential (2a → 2b → 2c). Sub-step numbers within a Step should reflect workflow order (propose before verify, not after).

3. **Closed-gap cleanup.** If a `## Structural gaps` section in the meta `MEMORY-ARCHIVE-*.md` shards (grep the skill dir; the `MEMORY.md` router holds none) lists items where ALL are closed, archive the section to CHANGELOG and clear it from its shard. Closed items belong in history, not in the scratchpad.

4. **Lesson count match.** SKILL.md references lesson counts; MEMORY.md has the canonical list. Discrepancy = fix SKILL.md (MEMORY is source of truth).

5. **Multi-home drift.** When a rule is codified in 2+ places (e.g., defer-with-trigger in the gold-pattern lesson + the promote-deferrals-at-classification lesson + Check 8 + Step 5), verify all homes agree. Divergence = pick the newest + most specific and sync older entries.

6. **Principle contradictions.** Re-read principles top-to-bottom. Flag any that contradict recent behavior (e.g., "don't meta-optimize" after a meta-optimization session) — either add nuance or remove if obsolete.

7. **Anti-pattern scan (PluginEval Layer 1 adoption — wshobson external-system expert).** Run `node scripts/skill-lint.mjs` and surface findings. Detectors: derive the set from the linter, never from a list here — `grep -oE 'code: "[A-Z_]+"' scripts/skill-lint.mjs | sort -u` (every finding code in that file is a literal; this sentence restated a hand-typed subset until 2026-09-13, one code twice — and the total moves with the linter, so it is not stated here either). Intentionally does NOT run OVER_CONSTRAINED (our rule-heavy skills intentionally exceed 15 MUST/ALWAYS/NEVER — we encode a lesson corpus in the thousands across skill specs — ⛔ **derive it, do not restate it: `node scripts/architecture-counts.mjs list` gives `maxL` and `distinctLessons`, and the "330+" that stood here until 2026-09-19 was 5.6× low against the live count, in the same sentence that prescribes deriving rather than listing** (the numbering carries renumber gaps from earlier collision repairs); this is by design per v2.6.4 decision). For each finding: auto-fix if ≤5 lines (e.g., add YAML frontmatter block with `name:` + `description:`), otherwise surface as proposal. Run frequency: every `/meta self-audit` (i.e. every ~5 sessions) OR after any skill spec edit that touches >1 skill. **Companion to /meta learn Step 4 cross-skill lint** — learn-mode lints on edit-touch; self-audit lints the whole corpus.

8. **COMPARISON.md staleness check (v2.8.1 anti-neglect layer).** Verify `.claude/skills/meta/COMPARISON.md` exists. Parse YAML frontmatter `last-reviewed: YYYY-MM-DD`. If ≥90 days old OR file missing → surface for user with prompt: "COMPARISON.md is {N} days old / missing. Run `/external-audit claude-system` to refresh matrix before using verdicts as load-bearing." Also verify each `.claude/skills/external-*/MEMORY.md` file has the cross-reference pointer to COMPARISON.md at top — missing pointer = propose re-add (pattern at top of any external-*/MEMORY.md). Auto-fix: re-add pointer if missing; DO NOT auto-refresh matrix (that needs a full `/external-audit`). Surface staleness as `RED` in self-audit output. **Per-skill stat-block freshness:** ALSO run `node scripts/external-staleness-check.mjs` — it parses each `external-*/SKILL.md` `last-fetched` and tiers GREEN <30d / YELLOW 30-89d / RED ≥90d (`--strict` exits 1 on any RED). Surface YELLOW/RED systems; the fix is a `/scout` self-refresh or `/external-audit` pass + a `last-fetched` bump (per-skill stats drift faster than the whole matrix, so this nudge is tighter than the 90-day COMPARISON gate). Do NOT auto-refresh stats (needs a real upstream fetch). **Body-staleness guard (2026-06-18):** the gate parses a SECOND frontmatter date — `last-deep-catalog` — alongside `last-fetched`, tiers each on the same GREEN/YELLOW/RED scale, and sets each system's status to the **WORSE of the two**. This catches the stats-only-touch failure *structurally*: a scout refresh that bumps `last-fetched` (→ GREEN) but leaves the body stale does NOT move `last-deep-catalog`, so its older date downgrades the system (`⚠️ deep-catalog stale`) — exactly the 2026-06-17 partial-refresh leak that read GREEN while 3 bodies lied, now caught by a date compare instead of the fragile prose-marker regex it replaced (the regex matched only 4 hand-written "re-catalog pending" phrasings; a new wording silently passed). A missing `last-deep-catalog` flags NOFIELD. **Convention: bump `last-deep-catalog` ONLY on a DEEP body re-catalog (full upstream re-read + body rewrite); bump `last-fetched` on ANY verification touch, including a stats-only scout refresh that finds no material drift.**

9. **Hook runtime smoke-test suite.** Run `./scripts/smoke-test-hooks.sh` and surface findings. Exercises every WIRED hook with canonical FIRE + SAFE synthetic payloads; asserts exit code + stdout/stderr pattern. **v1.5+ (2026-07-13):** the coverage skip-list is now EMPTY — **every** wired hook has a behavioral assertion, and the coverage-completeness gate at the bottom of the suite is what keeps that true, so read the count from `architecture-counts.mjs list → hooksWiredSettings` rather than from a figure typed here (it read "38" until 2026-08-24, when the live value was 41). A dated **2026-07-13** mutation-matrix run proved 36 of the then-38 detect their own death (`scripts/smoke-mutation-matrix.sh` mutates each hook KILL+GARBAGE in an isolated git worktree); **that ratio was re-measured 2026-08-26 over a DIFFERENT population and the two are not comparable:** a full `--gate` census (K=2, per-process scratch) read **29 of 29 MODEL-FACING EMITTERS LIVE, 0 UNGUARDED** — killing any one reddens 4-43 assertions. ⛔ **29 is the emitter set, not the 43 wired hooks, so it neither confirms nor refutes the 36/38** — name the denominator before quoting either. ⚠️ An earlier census the same day was DISCARDED WHOLE: the matrix wrote its baseline to a fixed `/tmp` path, so a concurrent hand run clobbered it and produced two false UNGUARDED plus 29 phantom labels — **every census verdict from before the fix is uninterpretable, LIVE readings included.** The secret-scanning hook carries real FIRE fixtures per secret class; `log-skill-invocations` + `session-memory-reminder` were driven out of the skip-list (the "unsynthesizable" claim was falsified for both). Plus settings.json integrity (every referenced hook exists + executable + cwd-independent), a **security-control WIRING PIN** (the security hooks pinned to their exact event+matcher — unwiring one fails the suite), `.githooks/pre-commit` warn-mode marker, active-recall.md Hot Tier row density, sniff-test rubric integrity, and agent-definition sub-agent MEMORY blocks clause coverage. Runtime ~27s; **833 assertions / 0 FAIL measured 2026-08-24** (was ~429 on 2026-07-13 — the suite grows with each wired hook, and the coverage-completeness gate at the bottom enforces it, so treat any figure here as a dated reading, never a current one). Layer 0 (`smoke-assert-lint.mjs --self-test` + `--strict`, self-grading-assertion detection) is now wired INTO the suite as a hard gate. **Companion instruments:** `smoke-mutation-matrix.sh` (per-assertion liveness audit, worktree-isolated) + `smoke-assert-lint.mjs` (self-grading detector). **Promotion to block-on-fail:** after 1 clean self-audit run, consider adding this to the pre-push hook. **Expand trigger:** every new hook added to `.claude/hooks/` must get a corresponding assertion pair in `smoke-test-hooks.sh` within the same commit (enforce via /meta learn signal "new .claude/hooks/ entry in staged diff"). Rationale: enforce-layer drift — if a hook breaks silently (JSON-parse error in a new Claude Code version, script marked non-executable by a merge, regex change that zeros the FIRE case) the block protection quietly degrades. Smoke suite is the verify layer Capture→Curate→Enforce was missing.

10. **CLAUDE.md / AGENTS.md / orchestrator-conventions currency.** The always-loaded entry-point prose — and, since 2026-09-03, the SessionStart-delivered `.claude/orchestrator/conventions.md` that now carries the command index — is NOT covered by `architecture-audit` (scoped to `.claude/docs/architecture.md`) or any other check, so the hand-maintained `# Commands` + `# Key Files` blocks rot silently. ⛔ **THE COMMAND INDEX MOVED ON 2026-09-03 AND THIS CHECK'S LOOP WENT VACUOUS FOR 10 DAYS — the subject is `.claude/orchestrator/conventions.md` § Commands, NOT CLAUDE.md, whose `# Commands` block has held ZERO `/<cmd>` entries since the move. An empty loop passes, which is exactly the shape of a covered check.** Grep `.claude/orchestrator/conventions.md`'s `# Commands` block: for each `/<cmd>`, verify (a) the skill exists at `.claude/skills/<cmd>/` (or `.claude/commands/<cmd>.md`), and (b) any embedded count in its one-line description ("N checks" / "N tiers" / "N experts") matches the skill's CURRENT spec. **Derive the entry count, never restate one — ``awk '/^# Commands$/{f=1} f&&/^## /{exit} f' .claude/orchestrator/conventions.md | grep -cE '^- `/'`` (31 at 2026-09-13); the block's opening paragraph also names 15 more commands inline as "unlisted but in daily use", and those are OUT of the bullet loop by construction.** ⚠️ **Where the skill's spec states its own count MORE THAN ONCE, reconcile the spec FIRST:** `/audit-check` reads "the 11/12 checks" (§ Usage), "the same 12 checks" and "the 11 checks" (both § `--v3-drift` mode), and "all 9" (§ Check 6: Tracker Accuracy) against **13** distinct checks — and a raw `grep -cE '^### Check [0-9]+'` reads **26** there, because that file lists every check twice (definition block, then output-template block), so the naive count is exactly double. No count-drift detector covers it: `architecture-counts.mjs` excludes it by name (measured 2026-09-13, not re-verified at apply time). Also grep CLAUDE.md's `# Commands` block and ASSERT it stays a POINTER — a `/<cmd>` bullet reappearing there is a re-split of the index, not an addition. Grep `# Key Files`: verify each cited path still exists. Flag duplicated prose across CLAUDE.md ↔ AGENTS.md. Auto-fix ≤5-line count/description drifts inline; surface the rest. **Evidence (2026-06-05):** CLAUDE.md claimed `/audit-check` was "6 checks" while the skill was an 11/12-check gate at the time (13 distinct checks today — re-derive it, per the reconcile clause above) — caught by a harvest investigation of the `claude-md-management` plugin and fixed then. Harvested (not installed) from that plugin's Currency / Red-Flag rubric — an entry-point-currency idea our meta system lacked. Section citations (`` `<file>.md` § <heading> ``) across the rules, orchestrator, skills, docs, traps, agents and templates corpus plus `CLAUDE.md` and `AGENTS.md` are checked by `node scripts/section-cite-check.mjs` (its `--self-test` carries the fixture); a dead cite is fixed by pointing it at the heading where the text now lives — the orchestrator files, `.claude/traps/shell-traps.md`, or the rules archive — never by deleting the pointer.

11. **Hot-Tier trigger-deadness extract (`rules-trigger-firerate.mjs` — closes a 2026-06-18 spot-audit orphan).** Run `node scripts/rules-trigger-firerate.mjs` and surface (a) the **TRUE-DEAD genuine-trigger set** — `active-recall.md` Hot-Tier rows whose trigger phrases never appeared across the scanned transcripts = the actionable **demotion candidates** (06-18 run: 20/96), and (b) the **suppression-target leaks** — `behavioral-anti-patterns.md` Red-Flags that surfaced, a NOISE-DOMINATED "rule may be failing" prompt-to-look (mostly the model *discussing* a rule, NOT rationalizing past it — never a confirmed failure; per `behavioral-anti-patterns.md`:Maintenance). **EXTRACT + SURFACE only — NEVER auto-demote:** promotion/demotion stays a human `/meta learn` (or owner) decision informed by the measured deadness — preserves sub-agent MEMORY blocks + the human-gated promotion. **Why this Check exists:** the tool shipped 2026-05-22 but had NO firing home (zero invocations from any routine → ran ad-hoc-or-never for a month) until a spot-audit caught the orphan. Cadence: every self-audit (~5 sessions) + under `/meta maintain` (self-audit is member #5; its own-cadence trigger — `active-recall.md`/`behavioral-anti-patterns.md` changed since last run, i.e. the measured rules moved — still governs organic mid-session fires and feeds the maintain context read). NOT bundled — and NOT a wire-candidate: `instinct-sweep` is owner-invoked BY DESIGN (`SKILL.md:22` "Auto-invocation gate: NEVER" — the rejected ECC-auto-instincts pattern); its low output is owner-on-demand, not a cadence-orphan, and cadence-wiring it would VIOLATE that rejection. (That audit's "sibling orphan" framing was a mis-attribution; corrected 2026-06-18.)
12. **Audit-sizing-floor net (`audit-floor-check.mjs` — `minimum-viable-scope:instrument-undersize`, 2026-07-12).** Run `node scripts/audit-floor-check.mjs` — it reads the git-tracked `audit-runs.jsonl` ledger and flags any LOGGED audit whose recorded `mode`/`panel_size` fell BELOW its stakes-mandated sizing floor (`scripts/audit-sizing-floor.mjs` is the SSOT — high-stakes ⇒ `--final-audit` + ≥7). This is the **self-detecting-absence net** for the highest-stakes MVS sub-mode — an undersized verification gate is invisible at miss time and is the *last net* (a lean panel can let a defect pass clean `/audit-check` runs). SURFACE flagged rows; the fix is re-running the audit at-or-above its floor. **Honest limit:** the 8b ledger logs only `full`/`--final-audit`, so this catches UNDER-PANELED logged audits, NOT a `--lean` that silently replaced a `--final-audit` — that residual is covered at SELECTION time by the computed floor wired into `/flows` + `/expert-review` (run `audit-sizing-floor.mjs` there). Pre-`stakes` rows (before 2026-07-12) read UNKNOWN, never falsely flagged. Read-only (NO_LOG); self-tested (`--self-test`). Cadence: every self-audit.
13. **Instrument-standard audit (5-expert convergence, promoted at the 2026-07-19 maintain approval pass).** For each NEW or EDITED measurement/verification instrument in `scripts/` since the last self-audit (`git log --since=<last self-audit> --name-only -- scripts/ | sort -u`; the bound = the last CHANGELOG `self-audit` entry's date — there is no durable machine marker, so **when unsure, WIDEN the window**: a too-recent bound silently DROPS an instrument from a net, the asymmetric failure), verify the instrument standard: (a) a `--self-test` whose assertions consume the REAL exported symbol — a replica self-test is structurally unfailable (the class: probes shipped to kill self-attestation were themselves self-attesting); (b) ≥1 RED control per claim class (= each distinct verdict the instrument can emit — e.g. "dead"/"drift"/"clean"; a fixture that MUST fail; delete-the-guard mutation proves the assertion is live) — **and the control must be the DISCRIMINATING fixture, not merely a failing one: a state in which the hypothesis you are ruling OUT would produce a DIFFERENT reading than the one you are ruling IN (enforce layer added 2026-07-31 when its own 4th-instance revisit trigger fired within the hour).** State the two predicted readings as numbers BEFORE running; if they coincide, the control is vacuous and its PASS means nothing. The failure is not laziness — all four measured instances were honest checks that ran correctly against a corpus where both hypotheses agree: an ASCII probe cannot separate chars from bytes (9.4K is under both); a `worktree == HEAD` tree cannot separate a worktree-read from a HEAD-read (315,055 either way); and a `lesson-mint` ledger ALIGNED at maxL 961 / base 962 cannot separate "frozen base is safe" from "frozen base drifts", because drift requires misalignment — which is why that verification passed honestly and a real defect shipped 20 minutes later; and — **the FIFTH instance, 2026-08-01, which extends this clause from SELF-TEST controls to PROBING A LIVE WIRED GUARD** — a peer fed `check-memory-budget.sh` a real Write payload, got SILENCE, and read it as "the arm passes." The file was UNDER the cap, so silence is what a working guard emits *and* what an inert one emits: the two hypotheses coincide, so the probe measured nothing. **To exercise a THRESHOLD guard you must probe with a payload that CROSSES the threshold** — an under-threshold probe is the vacuous control in its most natural disguise, because running the real tool with a real payload feels like the strong check. Settled instead by READING the source (`CAP_BYTES=25600`, projected pre-write, deny) — the cheap static layer this rule already tells you to try first; (c) no `|| true` / piped-exit laundering on load-bearing invocations (tee exit-code); (d) where the instrument WRITES, a pollution assertion (it must not corrupt the artifact it measures); **(e) every PREDICATE the instrument evaluates must reject malformed/empty ARGS explicitly — an unvalidated comparison over a total ordering is fail-OPEN, and the scanner's own output cannot tell you (2026-07-30).** `scripts/defer-trigger-scan.py` read `mf.get("trigger","")` while three live rows wrote the key as `trigger date:` — a *different* key — so args came back `""` and the guard evaluated `today >= ""`, which is **unconditionally True for every date, including future ones**. Two properties made it undetectable: its only three users were closed `- [x]` rows the walker skips (so "no observed failures" was luck, not evidence), and — the sharp half — **a vacuously-firing trigger APPEARS IN THE SCAN OUTPUT, and appearing in the scan output is exactly what a working trigger looks like.** The author who wrote a new trigger in that malformed form read their own false positive as confirmation it worked. **So a positive result from a predicate whose args you never validated is not evidence of anything**; require a `MALFORMED` arm in the self-test that asserts the visibly-stale/refused branch (fixed; the guard sits in `defer-trigger-scan.py`'s `eval_predicate`, its `MALFORMED` arms in `self_test()`). Surface violations — fixes are per-instrument work, never auto-applied. A "0 fires / N found / clean" result from an instrument failing this standard is UNTRUSTED until the standard is met (a correct-looking RESULT is not evidence of a correct INSTRUMENT; an SSOT must enumerate ground truth, never parse the claim it validates).

14. **Always-loaded BAND BUDGET + the held-lesson queue (added 2026-09-19).** Run
    `node scripts/check-band-budget.mjs` and report the gate verdict, the gated-plane total against
    its ceiling, and the FLOOR line. Then read the held queue at
    `.claude/skills/meta/BAND-CANDIDATES.md` — ⛔ **NOT a grep of the general tracker, which this step
    prescribed until 2026-09-19: the register moved to that file 17 days before this
    step was written, and the tracker grep returns ~14 plausible hits so it never fails loudly.
    The stale path was INHERITED — copied verbatim out of the gate's own deny text, which is
    the citing-a-source-by-copying-its-header class; fix the deny text too.** Give every held lesson
    a disposition — fold it, or decline it with the reason written on the row. The gate's own deny
    text names that queue, so a pass that clears bytes and leaves the queue untouched has done half
    the job.
    ⛔ **THIS EXISTS BECAUSE STEP 1 DOES NOT COVER IT AND READS AS IF IT DOES.** Step 1 byte-counts
    every `MEMORY.md` plus the project-memory index — the MEMORY plane. The band is a DIFFERENT
    population (`CLAUDE.md` + `AGENTS.md` + `.claude/rules/**`) governed by a DIFFERENT instrument
    with a HARD consequence: it is the only one of the two that BLOCKS A PUSH. A maintain run could
    therefore report a clean size inventory while the band sat over its ceiling, which is exactly
    what happened — measured 2026-09-19, the run before this step existed: band **723,758 B vs a
    710,000 B ceiling, 13,758 B over — ⚠️ a WORKTREE reading, unreproducible at any ref (the clean
    plane at that commit was 722,667 B, 12,667 over); kept as the dated observation it was, not as a
    figure to re-derive.** It surfaced not by maintain but by a blocked production push that
    had to be overridden by hand.
    ⚠️ **REPORT IT EVEN WHEN THE GATE SAYS ALLOW, AND SAY WHICH ALLOW IT IS.** The gate returns ALLOW
    while OVER the ceiling whenever the push adds 0 B — deliberately, so a cut can land. That reads
    like a pass and is not one: the next byte anyone adds blocks again. Quote the verdict line whole
    rather than the word.
    ⭐ **WHAT THE LEVERS ACTUALLY YIELD, so a pass is not planned on hope** (measured by the
    2026-09-07 compression pass): displacing incident narrative into
    the matching `.claude/docs/rules-ARCHIVE/*-cases.md` yields **~27%** of the unit it touches
    (range 3% on already-dense prose to 50% on a retraction chain) and took **ten commits across
    eleven files to move 13,025 B** — real, slow, and on its own it did NOT clear that ceiling. The
    step-change lever is a **PLANE MOVE**: relocating a section only the orchestrator can act on into
    `.claude/orchestrator/` took 11,790 B off the gated plane in ONE move and lost nothing, because
    the audience never changes. Look for a plane move before planning a grind.
    ⛔ **AND COMPRESSION HAS DEGRADED THIS CORPUS BEFORE — CHECK THE ADJUDICATION MARKERS FIRST.**
    `grep -rn 'restored:' .claude/docs/rules-ARCHIVE/` names spans a prior pass cut and a later one
    had to put back; one compression pass degraded six and a triage wave then re-cut three of them without
    citing the restoration. **A restored span is an adjudicated outcome, not narration — re-cutting
    one needs an explicit override citing the marker.** Keep the directive, the tell, the number and
    the archive anchor; drop only the story. Verify with
    `node scripts/band-directive-preservation.mjs --base <pre-pass ref> --head HEAD` in the same pass,
    not after it.

**Auto-fix rule:** findings ≤5 lines fix inline. Larger reworks surface as proposals.

**Output:** short report — what was stale, what got fixed, what surfaced for review.

## Process — Status (subcommand: `status`)

One-screen health dashboard: "is the system healthy RIGHT NOW?" Faster than memory-audit / self-audit. Modelled on alirezarezvani `/si:status`; its first step runs the skill lint from wshobson/agents.

**Full spec:** [`references/process-status.md`](references/process-status.md) — 11 read-only steps: skill count + skill-lint / MEMORY size inventory / project memory index size / skepticism distribution / agent count sync / stale L-ref sweep / rule-file glob validity / `--dormant` flag (opt-in) / architecture doc freshness / `/meta coherence` cadence / capacity indicator GREEN/YELLOW/RED.

**Remember:** capacity goes RED (the reference's step 11, capacity indicator) on any skill MEMORY past the soft line budget (>4000 lines — a scannability proxy that cannot see either byte cliff) OR >5 skill-lint findings OR project index past `CAP_BYTES` / `CAP_LINES` in `check-memory-budget.sh` (the byte arm binds first) OR agent drift OR an architecture doc ≥90 days old OR a coherence check never run or ≥90 days old OR state.md ≥30 days old. The byte cliffs are step 2's to report, not step 11's to grade: **256 KB (Read hard-errors — agent runs memory-blind)** and the partial-view band (~58.8-64.3 KB, density-dependent). After 3 uses with zero actionable surfaces, subcommand isn't paying for itself — trim.

## Process — Queue (subcommand: `queue`)

Display the Adoption Queue from `.claude/skills/meta/ADOPTION-QUEUE.md`, where the archive split moved meta MEMORY.md's `## Adoption Queue` section. Read-only answer to "what should I ship next for workspace infrastructure?" Complements `/backlog` (product). Added v2.7.5.

**Full spec:** [`references/process-queue.md`](references/process-queue.md) — 4 steps: read queue section / format by release / top-3 ready-to-ship callout / stats footer.

**Remember:** read-only — mutations via manual `ADOPTION-QUEUE.md` edit + CHANGELOG move. After 3 uses with identical output, queue is stalling; nudge user to ship or prune.

## Process — Distill (subcommand: `distill <skill>`)

Reduce MEMORY.md bloat by converting verbatim per-audit entries into prescriptive patterns. Delete source after extraction. Adopted from alirezarezvani `/si:promote` lifecycle (v2.8.1 — addresses "capture-only-no-curate" failure: security-expert 1422 lines, saas-engineer 1275 lines).

**Distinct from `/meta memory-audit`:** memory-audit flags redundancy; distill actively promotes + deletes. Distill is the DELETE-on-confirmed-absorption pass memory-audit lacks.

**Full spec:** [`references/process-distill.md`](references/process-distill.md) — 8 steps: pre-scan / entry extraction / pattern detection / Durability+Impact+Scope 0-3 scoring / promote eligible patterns FIRST then delete source / apply distillation rules (descriptive→prescriptive / verbose→concise / conditional→absolute) / propose table for approval / execute.

**Remember:** runs on ONE skill at a time. D+I+S ≥6 keep (compressed); 4-5 watch; ≤3 delete. Auto-execute OK for ≤3-entry runs; 10+-entry runs MUST get approval.

## Process — Telemetry (subcommand: `telemetry`)

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

## Process — Post-Compact (subcommand: `post-compact`, legacy alias: `postmortem`)

⛔ **THE PROCEDURE MOVED — it lives at `.claude/skills/post-compact/SKILL.md`** (split 2026-09-04: this spec is the most-invoked in the repo and the procedure was 12,736 B of it, so 91% of what a solo post-compaction run loaded was the other subcommands). `/meta post-compact` and `/meta postmortem` are LEGACY ALIASES that still route: **invoke the `post-compact` skill and follow its spec — never reconstruct the procedure from this pointer or from memory.** It carries the dated incident records, the Step 5 mail-store sweep + listener `kill -0` check, and the Step 7 marker-clear breadcrumb that `/wrap` Step 0's gate depends on.

**Callers split by the 2026-09-04 re-point** — the three hooks now emit bare `/post-compact`, which is where the byte win is realised; the remaining alias callers still name `/meta post-compact`, and every one still resolves through this pointer: `session-start.sh` (the standing post-compaction directive), `compact-save.sh` (the PreCompact marker stamp), `post-compact-pending-check.sh` (the per-prompt re-surface), `.claude/skills/wrap/SKILL.md` Step 0 (the gate), `scripts/wrap-reconcile.mjs`, `.claude/orchestrator/active-recall-orchestrator.md`.

## Process — Architecture Audit (subcommand: `architecture-audit`)

Cause-fix for recurring `.claude/docs/architecture.md` staleness — the mechanical COUNT / L#-ref / date-currency audit (3 tiers). Auto-fixes ≤5-line Tier 1 inline; surfaces Tier 2/3 as proposals. **Cadence:** every ~30 days OR ≥10 meta-system commits OR `last-reviewed` >90 days; also auto-fired by `/wrap` Step 7d. **Companion:** `.claude/docs/state.md` (Tier 2 fragility refresh = Step 6) + `scripts/architecture-counts.mjs` (the Tier 1 engine — `check` / `fix` / `list`).

**Distinct from** `/meta self-audit` (meta's OWN spec + skill-corpus lint) **and** `/meta doc-content-audit` (CLAIM/prose rewrite, owner-invoked). architecture-audit = mechanical COUNT/ref/date, cadence-fired, never rewrites prose.

**Full spec:** [`references/process-architecture-audit.md`](references/process-architecture-audit.md) — 10 steps (read + `last-reviewed` flag → Tier 1 count/narrative drift via `architecture-counts.mjs check`/`fix`/`list` → Tier 1 L#-ref + Appendix C regen sub-check → [Step 4 retired — semver dropped 2026-04-22] → Tier 2 cross-ref → Tier 2 `state.md` fragility refresh → [Step 7 deliberately vacant — anchor preservation] → Tier 3 open-ended incl. **recent-structural-change coverage** → 3-tier report → `last-reviewed` bump) + the detector classes + range-endpoint convention + auto-fix / skip / `--strict` rules.

**Remember inline:** Tier 1 ≤5-LOC count/L#/date fixes land SAME-commit; Tier 2/3 are PROPOSE-only (NEVER auto-rewrite lecture prose); bump `last-reviewed` ONLY if a Tier-1 fix actually landed; ⛔ **and NAME THE PLANE in the commit message — a bare `220 -> 222` reads as a ground-truth CLAIM and is not one.** A count-sync message states *"the doc claimed 220; ground truth is 222; I synced the doc"* — but the bare arrow is naturally read as *"the count changed from 220 to 222"*, i.e. a claim about the TREE. A reviewer's correct instinct on a count mismatch is to suspect a stale number, so the phrasing routes them straight into a false alarm: **two false alarms in one 12-commit review round, and the reviewer said a less patient reader would have filed one.** Write `doc 220 -> 222 (tree already 222)`. Zero behaviour change, and the cost lands entirely on whoever reviews next. **Measured 3× in one evening on one author** — `220 -> 222`, `maxL 1007 -> 1015` (where the sibling said `1008 -> 1015` for a DIFFERENT file and the pair read as a contradiction), and `12341→12394`; **do NOT auto-fix count drift caused by a peer's UNCOMMITTED feature** (defer to the owning session's `/wrap` Step 7d); `--strict` exits non-zero on any Tier 1 (CI / `/wrap`-gate). The step NUMBERS are load-bearing (cited by name, e.g. "Step 8 (Tier 3)") — preserved verbatim in the reference.

## Process — Doc Content Audit (subcommand: `doc-content-audit [<doc>]`)

CONTENT/claim-verification pass over a prose doc — the complement to `architecture-audit`. Where `architecture-audit` verifies COUNTS (and is forbidden to touch prose), this verifies CLAIMS and REWRITES prose per findings. **Owner-invoked ONLY — never cadence-fired** (the prose-rewrite is exactly what the mechanical mode must not do automatically). **Default target = the whole doc set** (it replaced the `architecture-overview.md` default, set when that was the only prose doc with no audit layer): every `.claude/docs/*.md` whose frontmatter reads `type: docs` — derive the membership (`grep -l '^type: docs' .claude/docs/*.md`), never list it here, so a new doc joins by being written. `<doc>` scopes the run to one. A set run also NAMES the non-members (`ls .claude/docs/*.md` minus the set), so a doc missing the frontmatter is seen rather than silently dropped. A set run is one Phase 1 per doc and one reader fan-out sized per doc (run 10: 12 readers over five docs, ~700 KB); state the reader count in the start line so the owner can scope down with `<doc>`. What a set run buys that five single runs do not: the CROSS-DOC class (Step 6 — a claim already corrected in one sibling and still standing in another), and the never-named doc, which is the never-audited doc (the two reconstruction docs had no audit pass between their writing on 2026-10-11 and run 10). **Not a new command or alias:** a new entry point is one more line in the meta Usage list, the Lecture 8 enumeration, `state.md`'s entry-point count and `/help` — the exact enumeration drift this audit hunts — and the spec already took `[<doc>]`; only the default moved.

**Distinct from `/meta architecture-audit`:** architecture-audit = mechanical COUNT/ref/date drift, auto-fixes ≤5-line, cadence-fired (incl. `/wrap` Step 7d), targets `architecture.md`. This = content correctness + currency + gap-fill, rewrites prose, owner-invoked, any prose doc. Two layers of one goal (honest architecture docs): the script catches count drift in the reference; this catches claim drift in the prose.

**Why it exists (the gap that motivated it):** the mechanical audit covers `architecture.md` only — `architecture-overview.md` / `state.md` prose had NO audit layer, so their mechanism-claims drifted silently (the `architecture-overview` blindspot-prime "single" vs `cmd_prime(top_n=3)` miss, 2026-06-16; then "nine"→8 lifecycle events + a "the docs audit themselves" overclaim, both caught 2026-06-18). This procedure is that missing layer, codified with SC-1 waived for a directed meta sprint.

**Steps:**

1. **Frame + classify doc-type (this drives Steps 4-5).** Read the frontmatter — note `last-reviewed` + the declared SCOPE — and CLASSIFY the doc: **CONCEPTUAL-durable** (e.g. `architecture-overview.md` — "approximate counts by design," refreshed only on a shape-change) vs **LIVE-STATE** (e.g. `state.md` — "current health, weekly refresh"). The type flips later steps: a conceptual doc's currency is shape-change-only + its scope is a bloat-guard (no per-session detail, approximate counts); a live-state doc is SUPPOSED to track per-session change and carries EXACT thresholds. Read the frontmatter's own scope line — don't assume. Also flag two STRUCTURAL attributes that reshape Steps 2-3: **LARGE** (>~600 lines — a full claim-by-claim read doesn't scale) and **COUNT-AUTO-MAINTAINED** (`architecture.md`, whose exact counts `architecture-counts.mjs` owns). `architecture.md` itself is the REFERENCE: exact counts, auto-maintained, its currency measured since `last-reviewed`. **A third type (added 2026-10-14, run 10): EVIDENCE-DATED RECONSTRUCTION — the discriminator is the frontmatter pair `written:` + `evidence-window:` with no `refresh-cadence:`** (`how-i-work-with-claude.md`, `operating-model.md`; built from the record, with a six-way key whose (5) means "historical, since changed"). Its window-bound counts are NOT drift unless wrong FOR THE WINDOW (re-derive a sample with the instruments its appendix names, at the sha it was written at); what drifts is a present-tense mechanism sentence that no longer holds at HEAD, and the remedy is the doc's own key — a "since <date>" clause or a (5) label naming the commit — never rewriting the reconstruction into a description of today. Its first audit adds a `last-reviewed:` line beside `written:` so the next run has a since-date.
2. **Section inventory.** **Small doc → read fully.** **LARGE doc (>~600 lines, e.g. `architecture.md` at ~1400) → a full claim-by-claim read doesn't scale: drive the inventory with a FIXED SET OF HIGH-YIELD MECHANICAL SWEEPS, then targeted reads of the flagged sections.** (Strengthened 2026-07-01 — the vague earlier "high-yield greps" let the Phase-2 deep-dive keep re-finding >10 grep-catchable fixes across both architecture.md runs; the Revisit "Phase 1 too thin → fold forward" trigger fired, so the sweeps are now concrete + named.) Run all four; each is a cheap grep that catches a class Phase 2 was otherwise re-discovering:
   - **(1) Number sweep.** Run `architecture-counts.mjs check` for the tracked counts, THEN grep every REMAINING numeric claim (`~?\d+` skill/lesson/hook/rule/%/LOC/line/entry counts) and spot-check each UNTRACKED one against its live source. The count-detector's patterns are specific, so non-matching phrasings silently rot — this sweep is their catch (2026-07-01: `55 of 81 skills`→87, `~300 distinct lessons`→553, `top-57 most-cited`→58, `~376 lines`→416, `~1340 LOC`→1360). *Graduated 2026-07-01: the filesystem-derivable subset is now auto-caught by `skill-lint`'s `NARRATIVE_COUNT_DRIFT` detector (warn, corpus-wide, SSOT via `architecture-counts list`, plausibility-band `[ssot×0.5, ssot×2]` FP-guard) at `/meta self-audit` Check 7 + pre-push — so `of N skills` / `top-N most-cited` / `N distinct lessons` reach NEITHER audit phase. The residual manual part of this sweep is the NON-filesystem-derivable numbers (registry `@N%`, per-file line/LOC counts).* **⚠️ WORD-FORM quantities escape the digit pattern** — "nearly a thousand", "half a dozen", "sixteen" match no `\d+` sweep (copy.md's number-word class at the doc surface); grep the spelled forms too, and check the HEDGE DIRECTION: an approximate count may be rough but never wrong-SIDE — "nearly a thousand" over a corpus at 1,028 is false even under the approximate-counts policy (2026-08-05 pre-gist run, ×2 in one doc).
   - **(2) Internal-contradiction sweep.** For each SSOT metric (skills/agents/hooks/maxL/RULES-rows/hot-tier) AND each load-bearing behavioral claim, grep ALL its mentions across the doc and assert they agree with EACH OTHER + the source. Catches numeric self-disagreement (`57/49/58` hot-tier; `55 of 81` vs the matrix's `55 of 87`) AND behavioral self-contradiction (`SessionStart bare event` vs the section describing it richly; `ECC largest` vs the doc's own Superpowers 231k).
   - **(3) Retired-token / policy-flip sweep.** Grep a curated retired-token list (semver `version-bump`, superseded thresholds/mechanism-names) + `git log --since=<last-reviewed> --pretty=%s`, then grep the OLD value of any flipped policy across the doc (one flip stales multiple surfaces — the 2026-06-18 `state.md` 4-in-1 catch).
   - **(4) Enumeration-vs-source sweep.** For EVERY `N modes / N checks / N steps / N events / N subcommands / N files` claim, grep the actual source enumeration (`add_parser` list, numbered-step headers, `settings.json` events, an `ls` count) and compare BOTH the count AND the members. This was the DOMINANT 2026-06-19 class (`Nine checks`→11, `2 globs-less rules`→7, event-table wiring omissions) + 2026-07-01 (`four modes`→six, `12 modes`→13).
   These four move the number / contradiction / retired-token / enumeration classes INTO Phase 1; the Phase-2 deep dive (Step 6b) is then confirmatory for those + reserved as PRIMARY only for the genuinely-behavioral drift a grep can't see (e.g. a hook grew a 2nd behavior the doc never names — `block-dangerous.sh`'s zsh no-word-split class). Either way, list every section + extract every MECHANISM-SPECIFIC claim: a count, threshold, render-shape, lifecycle-event name, a "X does Y" behavioral assertion, or a "the docs/system does Z" self-claim. **On a large doc, report Phase 1 HONESTLY as targeted-claim, NOT exhaustive line-by-line** (verify-before-assert applied to your own audit — don't claim coverage you didn't do); the exhaustive lecture-by-lecture read is NOT optional — it runs as the auto-started **Phase 2 deep dive (Step 6b)**, so Phase 1 reports targeted coverage knowing Phase 2 completes it.
3. **Source-verify each claim (LOAD-BEARING — this is the whole point).** Verify against the LIVE system, NEVER from memory — `grep`/`Read` the script / spec / `settings.json` / config the claim describes; run `node scripts/architecture-counts.mjs list` for counts. The verify-family applied to the doc-authoring surface, which none of them explicitly cover. A claim stating a mechanism's count/threshold/shape MUST be grep-confirmed before it survives the pass — this doc class has a miss on record (see "Why it exists"). **High-yield move — grep the OLD value of any policy / threshold / convention that flipped since `last-reviewed`:** one un-swept flip stales MULTIPLE surfaces at once (the 2026-06-18 `state.md` run found 4 stale distill-threshold claims from a single 2026-06-09 reframe), so finding the flip clears them all in one pass. **For a COUNT-AUTO-MAINTAINED doc (architecture.md):** run `architecture-counts.mjs check` FIRST — its exact counts are `architecture-audit`'s lane, NOT yours (clear via `architecture-counts.mjs fix` only if YOU caused the drift this session); spend YOUR effort on the prose-CLAIM layer the count-detector can't see. ⛔ **THE HAND-OFF HAS TWO HOLES AND BOTH STAY YOURS: a phrasing the detector carries NO PATTERN for, and a figure sitting INSIDE its tolerance band.** Measured: the Preface's skills count had no matching pattern, so the exact number was as invisible to `check` as the rounded one would have been (the pattern has since been added); and five "distinct lessons" claims read 1806 against a true 1816 — inside the ±10 band, silent — until one more citation tipped the tree to 1817 and the check finally fired. **Name both classes as exceptions you verify by hand, and say in the report which numbers you checked yourself.** **Source-not-paraphrase:** verify against the PRIMARY source (the `SKILL.md` stat-block / `settings.json` / the actual config), NEVER a derived paraphrase (an agent-description, a banner, a summary) — the paraphrase lags (the N=4 run nearly regressed `vinicius` v1.5.2/23→v1.3.0/17 by trusting the agent-description; the SKILL.md was right). **Cross-doc citation sync:** when the doc cites ANOTHER artifact's data (architecture.md's external stats from `external-*/SKILL.md`), tier the SOURCE's freshness FIRST (`external-staleness-check.mjs`; never sync to a stale source), sync to the fresh source, and FLAG source internal-inconsistencies for the source's owner — don't resolve them in the citing doc. **Two claim classes whose oracle is NOT the live system (added 2026-08-05, pre-gist fact-check run):** **(a) INCIDENT-ATTRIBUTION claims** — a story sentence asserting WHO/WHICH-LAYER found something, what a past audit scored, when — verify against the HISTORICAL record (the flow/feature tracker row + `plans/*-process.md` + the L# body), never the live tree and never memory; and confirm any precise number is bound to the RIGHT EVENT: the worst catch was truth-adjacent — a real "13/13" attributed to the two panels that MISSED a defect when it belonged to the audit that CAUGHT it, beside "a code review found this" naming the wrong layer entirely (the process log showed a 3-lens `[CONVERGED]` panel finding). An existence-check passes both; only the event-binding check fails them. **(b) POINTER claims** ("the precise trace lives in doc X" / "see X for Y") are claims about X's CONTENTS — grep X for the anchor tokens before the pointer survives ("traces live in architecture.md" carried 0 hits for its three anchor tokens; occ-2 of the cross-doc class first seen 2026-06-20).
4. **Currency check — BRANCH on doc-type (Step 1).** `git log --since=<last-reviewed> --pretty=format:"%s"`.
   - **CONCEPTUAL-durable doc:** filter to SHAPE-changing commits (a new primitive / workflow / subsystem / structural split). Only a shape-change earns prose; a per-session refinement does NOT (that's the reference doc's job). Zero shape-changes in the window is the common, expected result.
   - **LIVE-STATE doc:** the INVERSE — it is SUPPOSED to reflect per-session change, so run the `architecture-audit` Step-6 fragility-refresh lens instead: for EACH current-state claim ask "is this still true TODAY?" — a resolved fragility → strikethrough or move to Status-updates; a moved threshold/count → fix to current; a new failure-mode that recurred ≥2× → a Part-2 add (Step 5). Currency-against-today, NOT shape-change-only. ⚠️ The conceptual rule "a per-session refinement does NOT earn prose" is exactly BACKWARDS for a live-state doc — reflecting per-session change is that doc's whole job (caught 2026-06-18 on `state.md`).
   - **EVIDENCE-DATED RECONSTRUCTION:** `git log --since=<written> --pretty=%s` over the paths behind every mechanism the doc describes in the present tense (gates, defaults, commands, steps, authority rows); each change earns a since-clause or a (5) label at the sentence, and the window's figures stay. Run 10 measured the yield: 26 of 33 operating-model edits and 5 of 11 how-i-work edits were post-window mechanism changes from three days (2026-10-12/13).
5. **Gap scan (scope-bounded) — enumerate features, don't free-associate.** Build the system's high-value-feature inventory (the subcommand list + the cross-cutting mechanisms: skepticism levels, evidence-class labels, the sycophancy gate, hot/cold memory, hook smoke-test, the verify-before-assert spine, parallel-session coordination, …) and check the doc's coverage of EACH — a coverage checklist beats "what would the reader wish were here." Classify every miss:
   - **Un-named SHAPE feature** (high-value + distinctive + a behavioral/architectural principle the doc never names — e.g. the verify-before-assert spine) → a REAL coverage gap; **ADD** it (a conceptual doc is exactly where shape-features belong).
   - **Terse-but-covered concept** (the concept IS named, the prose is just thin) → usually **LEAVE** — terseness is scope-appropriate in a conceptual doc; enrich only a specific passage that is genuinely unreadable.
   - **Per-mechanism detail** (a count, a step-list, an individual subcommand) → **LEAVE** (reference-doc territory).
   The add-bar is all three at once: **high-value AND distinctive AND shape-level** — miss any one, leave it. **Owner-suggested enrichment RAISES this bar, not lowers it:** when the owner says "this could be richer / there may be gaps," the social pull is to over-add to please — resist it, hold the bar HIGHER, and treat "mostly the doc is fine; here is the one real gap" as a valid, expected answer (anti-sycophancy applied to gap-scanning). "No useful in-scope gap" remains a valid outcome. **Live-state doc variant:** for a live-state doc the gap scan is also a RECURRENCE check — a failure-mode/fragility that recurred ≥2× (the doc's OWN inclusion bar) but isn't indexed is a real coverage gap to ADD (the 2026-06-18 `state.md` run added failure-mode #10 this way), and a resolved fragility is a removal (strikethrough → Status-updates). **Reconstruction-doc variant:** the gap scan does not apply — the evidence window is the scope, and a mechanism born after it is a since-clause (Step 4), never an addition.
6. **Apply + report.** Fix verified inaccuracies inline, with EVIDENCE per change (the grep/read that justifies it). Declare every verified-clean section "clean" EXPLICITLY — do NOT manufacture changes to look thorough (anti-sycophancy; verifying-clean is the honest result for a well-maintained doc). Sweep ALL surfaces of a corrected claim (`grep` the old phrasing — a self-claim often spans 2+ sections; the 2026-06-18 overclaim lived in §8 AND §12). ⛔ **AND A REFUTATION IS NOT FOLDED UNTIL EVERY RESTATEMENT IS STRUCK — the survivor is most dangerous under a VERIFICATION-FLAVOURED heading (2026-08-01).** Measured: a findings doc recorded a claim that one function never calls another as **REFUTED**, then left the same claim standing 57 lines later in a list headed *"agent-surfaced, not yet verified."* Both halves written by one author, hours apart, in one file. **The label is what makes it worse than an unlabelled claim:** "not yet verified" reads as triage already performed, so the next reader's natural action is to go verify and PROMOTE it — here into the decisions log as a load-bearing fact. Grep your own artifact for the CLAIM, never for the section you remember writing it in. **Set run — the cross-doc sweep (a recurring find: first seen 2026-06-20, again on 2026-08-05 and in runs 8 and 10):** sweep each corrected claim across EVERY doc in the set, not only the doc it was found in — a claim already corrected in one sibling and standing in another is the commonest find of a set run (run 10: a stale product-status line, the quote-then-rule "named nowhere" sentence in two docs, the deploy-baton framing, the dated agent count), and the two directions matter: the sibling that is RIGHT is the source for the one that is wrong, and the record decides which that is.
6b. **Deep conceptual-dive second pass (LARGE doc — DEFAULT, auto-started after Phase 1).** Phase 1 (Steps 2-6) is *deliberately* non-exhaustive on a LARGE doc (high-yield greps + targeted reads, not every line), so it is ALWAYS followed by this exhaustive pass — **auto-started by default** (announce it + a one-line cost note so the owner can say "skip the deep dive"; do NOT block on a "shall I proceed?" — that's the list-and-wait anti-pattern). A small doc read fully in Step 2 is already exhaustive → no Phase 2. **Method:** (a) **fan out N parallel reading agents, one per section-cluster** — as `Explore` seats (the routing policy's read-only fan-out type), and ⛔ **brief the OUTPUT AS THE RETURNED MESSAGE, never a file: an Explore seat cannot write one (run 10: 12 of 12 made zero write attempts under their read-only rule); keep each `SubagentHandback` payload as the record and never a retyped digest (run 10's scratchpad copies were 20-25% of the hand-backs)** — (`architecture.md` ≈ 4: Lectures 1-3 / 4-5 / 6-8 / 9-11+appendices, ~250-500 lines each). Each READS its range in full + VERIFIES every mechanism-claim against the LIVE system (grep/read the script/spec/`settings.json`/config) + cross-checks adopt/reject vs `COMPARISON.md` + the named `external-*/SKILL.md` + verifies cited commits/L#s/paths exist + hunts internal contradictions; returns a STRUCTURED candidate list (claim · line · category · verification-run · confidence · suggested-fix), **surface-only — NO edits.** Brief each with: the 5 drift categories (mechanism-drifted / adopt-reject-vs-ledger / worked-example-citation / internal-contradiction / stale-version-naming); the Phase-1 fixes already applied ("do NOT re-surface"); the COUNT-LANE exclusion (architecture-counts owns counts → tag `[COUNT-LANE]`, move on — **except a phrasing the detector cannot match or a figure inside its tolerance band, which stay the audit's own, per Step 3**); anti-sycophancy ("declare clean explicitly; don't manufacture findings"). (b) **Orchestrator RE-VERIFIES every load-bearing finding ITSELF before applying** — an agent claim is a candidate, not ground truth; re-run the grep/read THEN apply, and **sweep ALL surfaces of a corrected claim** (it often appears in 2-3 places). (c) **Apply** confirmed fixes inline — **only after EVERY reader has returned**: each reader pages its range by line number, so an edit landing mid-wave shifts the offsets the still-running readers are using (run 8, 2026-09-27, held all edits until the six returned; a doc no still-running reader was briefed to read or cross-check, e.g. a small companion whose own reader has already returned, may be edited earlier — `COMPARISON.md` is in every reader's brief (a), so it waits with the target); surface genuinely-ambiguous rewrites; the count-lane residual stays architecture-audit's lane (recommend `architecture-counts.mjs fix` — but do NOT run it if it would clobber a peer's dirty `COMPARISON.md`/`active-recall.md`). One CHANGELOG entry covers BOTH phases. **Why default (2026-06-19):** on `architecture.md` the targeted Phase 1 found 8 fixes; this deep dive found **34 more** the greps structurally couldn't see (block-dangerous mischaracterization, "2 globs-less rules"→7, 3 event-table wiring omissions, "Nine checks"→11, the agent-tier 42→44 sweep ×3 surfaces). A targeted-only large-doc audit is knowingly incomplete — the deep dive is its completion, not an optional extra.
6c. **Breaker routing (mandatory on every `.claude/docs/*` run — added 2026-08-02).** Before the Stamp, route the audited doc to a fresh-context breaker with a refute mandate — the live review hub if one exists (`hub-discover`), else a fresh-context agent. Step 6's MANDATED declare-clean output makes every run of this subcommand self-referential + evaluative + codification-bound (the conjunction BY CONSTRUCTION), and the in-context routing rule measured 0/1 fires with the row loaded (run 8: the step had to be supplied from outside the run; yield = 4 confirmed findings + 1 overturned LEAVE on a doc just declared clean in 9 sections, including the audit's own freshly-written quality claim). Fold verdicts per the read-time disposition rule; the Stamp waits for the fold.
7. **Stamp.** Bump `last-reviewed` to today IF any edit landed (an all-clean pass does NOT make the doc fresher — same rule as architecture-audit); a reconstruction doc gets the line added on its first audit, `written:` untouched. Record a one-line meta/CHANGELOG entry.

**Auto-fix rule:** owner-invoked, so verified prose rewrites ARE applied inline this run (with evidence shown) — distinct from architecture-audit's "Tier 2/3 = propose-only," because the owner explicitly invoked the rewrite pass. A genuinely AMBIGUOUS rewrite (scope/voice judgment call) still surfaces for confirmation.

**Anti-scope:**
- Never cadence-fired / never auto-invoked from `/wrap` — it rewrites prose; only `architecture-audit`'s mechanical mode is safe to auto-fire.
- Don't bloat a conceptual doc with reference-grade detail (the frontmatter scope is the gate).
- Don't manufacture gaps or changes — most sections of a maintained doc verify clean, and saying so is the honest output.
- Counts stay APPROXIMATE in a conceptual doc — verify roughly-right (within range); do NOT make them exact (that's architecture-audit's job on the reference).
- A doc bound for an EXTERNAL venue (gist / blog) gets a DATED share copy — frontmatter stripped, internal links de-referenced to prose — generated FROM the canonical and regenerated on change, never edited in place; the canonical stays the audit target and the copy carries its date in the filename.

**Revisit:** calibrated N=6 — runs 1-2 on `architecture-overview.md` (2026-06-18: claim-verification 3 fixes / 14 §; then a prompted gap-scan, 1 real gap of 5) → Step-5 coverage-vs-richness + suggested-enrichment-raises-the-bar; run 3 on `state.md` (7 stale-claim fixes + 1 new failure-mode) → the **conceptual-vs-live-state branch** (Steps 1/4/5); run 4 on `architecture.md` (the 1346-line reference: 2 prose-claim fixes + a Lecture-10 external-citation sync) → the **LARGE / COUNT-AUTO-MAINTAINED branch** (Steps 1/2/3) + the source-not-paraphrase trap. If 3 runs find zero claim-drift on the SAME doc, its cadence is over-eager — extend. If a run routinely rewrites >30% of a doc's sections, that doc has a deeper staleness problem warranting a structural look, not a content pass. **Deep-dive Phase 2 made default (2026-06-19, run 5):** the exhaustive deep conceptual dive (Step 6b) is now the auto-started completion of any LARGE-doc audit — run 5 = `architecture.md`, where Phase 1's 8 fixes were followed by **34 more** from the deep dive. Revisit the AUTO default: if the deep dive finds <3 fixes beyond Phase 1 across 3 consecutive large-doc runs, Phase 1's greps have gotten good enough → downgrade Phase 2 to offer-not-auto; if it keeps finding >10, Phase 1 is too thin → fold more deep-dive coverage forward into Phase 1. **2026-07-01 (runs 6-7, both re-runs):** a 2nd `architecture.md` deep-dive (5-agent Phase 2, ~14 prose-claim fixes beyond Phase 1) + an `architecture-overview.md` re-run (1 currency fix, else clean). The deep-dive AGAIN found **>10** beyond Phase 1, so the "Phase 1 too thin" trigger fired on both architecture.md runs → **APPLIED 2026-07-01: Step 2 gained the 4 explicit high-yield sweeps** (number / internal-contradiction / retired-token / enumeration-vs-source) that mechanically catch the classes the deep-dive was re-finding, leaving Phase 2 confirmatory + PRIMARY only for genuinely-behavioral residual. **Re-measure:** the next 2 large-doc runs should drop Phase-2's beyond-Phase-1 finds under ~5; if still >10, the residual is behavioral (deep-dive-only) and Phase 1 is as strong as greps allow — stop tightening it. **Re-measure record (re-derived 2026-09-28; the 2026-09-27 figures from that run's six reader returns):** the "next 2 large-doc runs" after 2026-07-01 were both `architecture.md` — 2026-07-09 (11 fixes, recorded under the deep dive, not split by phase) and 2026-07-16 (~24 from the Phase-2 pass, which also found a Phase-1 sweep incomplete). The pair read >10, so the "still >10" branch was reached on 2026-07-16 and not recorded here. Every large-doc run since has also read >10: 2026-08-24 (~30, both phases together), 2026-09-14 (six readers, four commits) and 2026-09-27 (~65 applied beyond Phase 1, from 87 reader findings, 10 of which repeated Phase 1). **The branch's premise does not hold on the 2026-09-27 data:** by the readers' own tags, at least 27 of the 77 findings beyond Phase 1 are internal-contradiction, stale-naming or stale-figure finds — classes Step 2's sweeps (1)-(3) name as Phase-1 work. So >10 does not show that Phase 1 is as strong as greps allow; under-run sweeps produce the same count. The deep dive stays default (no run has read <3). Whether to tighten Phase 1 again stays open until one large-doc run records, for each Phase-2 finding, whether a Step-2 sweep run as written would have caught it. **Run 10 (2026-10-14, the first set run — five docs, 12 Explore readers on Opus, surface-only, every load-bearing finding re-verified at source):** readers returned 105 findings (architecture.md 56 across five readers, state.md 9, operating-model.md 24, how-i-work 9, overview 7); applied as 86 anchored replacements in architecture.md, 14 in state.md, 33 in operating-model.md, 11 in how-i-work, 10 in the overview. Phase 1 had found 3 items on architecture.md and 1 on state.md, so Phase 2 again read far above 10 beyond Phase 1 — but the dominant class this time was POST-WINDOW MECHANISM CHANGE from three days (2026-10-12/13: the always-resume rule, the migration apply gate, the exclusive-create fleet claim, the AUTO PRE-COMPACT hook, the promote hold arm, the session-limit guard, the worktree reaper), which no Step-2 sweep catches and which argues for the set default: one run three days after run 9 found 56 items in the reference doc. Two instrument findings: the hook count detector was `.sh`-only (fixed, four regex sites), and the readers' seat (Explore) cannot write its output file, so reports came back inline — brief the output as the returned message, not a file. Open from this run: one lesson number has two holders in the lesson corpus, and the review hub's refute read (Step 6c) was pending at stamp time.

## Process — QA Plan Audit (subcommand: `qa-plan-audit`)

Cadence-fired consolidation audit for `QA_TESTING_PLAN.md` — the doc-maintenance complement that `architecture-audit` is for `.claude/docs/architecture.md`. The QA plan accretes via `/expert-review` Synthesis Guideline 13 (every qa-expert panel appends manual tests to Part 7) and nothing consolidates → it drifts: superseded-duplicate flows, dead-premise items, items now covered by automated tests, and safety-wording drift. This subcommand is the periodic sweep. Codified after a 6-expert review consolidation pass found ~110 prunable items across 14 months of accretion (built at N=1; SC-3 explicitly waived).

**Distinct from `/meta architecture-audit`:** that audits the meta-system reference doc (count / L#-ref / date-currency drift, auto-fix). This audits the product QA artifact (stale-premise / superseded-duplicate / now-automated / safety-wording drift). Different doc, different drift classes. **Distinct from `/meta doc-content-audit`:** that is a claim-verification prose-rewrite pass on a conceptual/state doc; this is a structural consolidation of a checklist artifact.

**When to run (any fires):**
- Part 7 exceeds ~60 flow-subsections, OR ≥8 flows carry a duplicate subsection (structural bloat).
- Before any blocker pass (freshness gate — testers must not chase closed gaps).
- ~Quarterly proactive, OR after a batch of `/expert-review` final-audits appended to Part 7.

**Args:** `--strict` — treat any Tier 1 finding (dead-premise OR dangerous-wording) as failure, exit non-zero (CI / auto-fix flows). Default = warn + inline report.

**Steps:**

1. **Inventory.** Line count; Part-7 subsection count (`grep -cE '^## Part 7|^## Flow #' QA_TESTING_PLAN.md`); checkbox-item count (`grep -cE '^\s*- \[[ x]\]'`); Part-7 % of file. Flag if subsection count >60.

2. **Tier 1 — superseded-duplicate sweep (auto-fix).** Group Part 7 subsections by Flow #N / F#. Any flow with ≥2 dated subsections → the older one(s) MUST carry a `> ⚠️ SUPERSEDED by …` tombstone (per the Part-7 maintenance protocol). Missing tombstone = finding; auto-fix inline (insert the tombstone above the older block, citing the latest redo's date). Report the duplicate-flow count.

3. **Tier 1 — dead-premise detection (auto-fix ≤5-line).** For each item citing "once X is built" / "verify when Y ships" / "gap noted" / "decision pending" / "POST-LAUNCH-WHEN-Z" / a `rg "…"` sweep instruction: grep-verify the cited condition against CURRENT state (code / DECISIONS.md / tests/ / messages/). Gap closed / flow shipped / sweep returns zero / decision locked → STALE. Auto-fix ≤5-line rewrites (strike + done-note, or repoint to the live redo block); surface larger rewrites as proposals. (First-run examples: an item whose flow had since shipped, a copy-sweep instruction whose grep now returns zero hits, a locale file that now carries CLDR plurals, a "decision pending" item since locked in the decisions log.)

4. **Tier 1 — dangerous-wording guard (RED, never silent-fix).** Grep for any step instructing real illegal-content handling (upload / fixture / "in staging" phrasings near the illegal-content category term). Any hit instructing sourcing/uploading/storing real illegal material (rather than the plan's safe test proxy) = a top-severity safety finding. Cross-check that the plan's proxy-only banner exists. Surface RED + propose the reword — NEVER silently rewrite safety copy.

5. **Tier 2 — already-covered detection (pointer proposals, NEVER auto-delete).** Cross-reference manual items against the `tests/` inventory (`ls tests/e2e/*.spec.ts tests/integration/*.test.ts tests/*.test.ts*`). A manual item naming a flow/behavior with an obvious spec counterpart (`flowN-*.spec.ts`, `fN-*.test.ts`) → ALREADY-COVERED pointer candidate. **Surface as proposals only:** name-match ≠ assertion-match (the spec may assert a SIBLING property — verify the target spec's actual assertions, asserting the literal the code reads), and per-row MANUAL residue (real-device / real-inbox / Paddle-sandbox / AI-judgment) must be preserved. Conversion is owner-reviewed per pointer. **Calibration (1st run 2026-06-19): a naive "item cites a `.spec.ts`" grep OVER-counts ~3× — most Part-7 items reference a spec for CONTEXT while being genuine-manual (real-Paddle-sandbox / real-device / AI-tone). Filter to items that EXPLICITLY say "covered by X" / "automated: X" OR whose cited spec actually ASSERTS the item's behavior — NOT items that merely mention a spec. The genuine pointer-able Part-7 subset is small (~5 on the first run); Part 7 is mostly the irreducible manual core by design.**

6. **Tier 3 — bucket-split estimate + freshness.** Estimate the manual-required / already-covered / stale / automatable split (grounded against the test inventory). Parse the header `Last updated:` date; flag GREEN <90d / YELLOW 90-180d / RED >180d.

7. **Output 3-tier report** (inline, no file): Tier 1 (auto-fixed dead-premise + tombstones; RED dangerous-wording), Tier 2 (pointer-candidate proposals), Tier 3 (bucket split + freshness). Bump `Last updated:` only if auto-fixes landed.

**Auto-fix rule:** Tier 1 dead-premise ≤5-line rewrites + missing tombstones apply inline; dangerous-wording surfaces RED (never silent-rewrite safety copy); Tier 2 pointer conversions surface as proposals (name-match≠assertion-match); Tier 3 surface for owner. Stage explicit pathspecs; one `meta(qa-plan-audit):` commit.

**Skip rule:** zero findings across tiers → one-line `QA plan clean — no drift since {Last updated}` + bump the date. Don't generate empty work.

**Anti-scope:**
- NOT a tracker entry in `/ops` or `/features` (doc-maintenance is the wrong category for those — the category question is exactly what triggered building this).
- Don't bulk-delete already-covered items — convert to pointers, owner-reviewed, assertion-match-verified.
- Don't fold Part 7 into Parts 1-6 (the audit-date grouping IS the provenance — review decision 2026-06-19).
- No companion script yet (N=1) — prose-driven. Promote to a `scripts/qa-plan-audit.mjs` count-detector (the `architecture-counts.mjs` shape) only if this recurs AND the manual greps prove repetitive across 2+ runs.

**Revisit:** if this runs 3× with zero Tier 1 findings, the Part-7 tombstone-on-re-audit protocol is working and the cadence is too aggressive — extend. If it consistently surfaces dead-premise items, the protocol's tombstone/freshness step is being skipped at append time — tighten `/expert-review` Synthesis Guideline 13. If the manual greps prove repetitive, build the companion script. Consider adding as a `/meta maintain` member once the cadence is calibrated.

## Process — Corrections (subcommand: `corrections`)

Owner-curated registry of orchestrator-blindspot events — moments where owner pushed back on a recommendation/assertion/scope-decision AND the response shifted. Closes the gap that meta MEMORY codification was slow to detect: pattern visibility requires recurrence count crossing threshold, but during the recurrence window the events themselves are lost to memory unless captured at-source.

**Distinct from `/meta learn`** (the most-important distinction since both fire from `/wrap`):

| | `/meta learn` | `/meta corrections` |
|---|---|---|
| **Scope** | full session, all signals | owner-pushback events (regex on user messages) **+ soft-overrides** (v0.6: AskUserQuestion picks where owner chose a non-"(Recommended)" option) |
| **Output** | numbered L# lessons in the `.claude/skills/meta/MEMORY-ARCHIVE-*.md` shards, routed by `MEMORY.md` | event entries in `.claude/meta-corrections-registry.md` |
| **Granularity** | LOW-volume, high-formalism (D+I+S scored, evidence-backed, durable) | HIGH-volume, low-formalism (capture-first, triage-tag, append-only) |
| **Per-item format** | ~30-50 lines (Trigger/Action/Evidence/D+I+S/Revisit sections) | ~8 lines (My-proposal/Pushback/Correction/New-ground/Pattern/Codified) |
| **Promotion** | the registry feeds it — patterns recurring ≥3 distinct-sessions become L# candidates | N/A (every owner-triaged-TRUE event lands) |
| **Auto-fire** | `/wrap` Step 2 | `/wrap` Step 7f |

Registry IS the feeder; meta MEMORY IS the codifier. L# entries back-reference the registry via the "Codified as L#?" field.

**Implementation:** `scripts/meta-corrections-scan.py` (currently v0.7). The subcommand is a thin dispatch layer over the script's CLI flags — same functional surface, discoverable via `/meta` skill menu. **v0.6 (2026-06-03)** added `scan_overrides()` (soft-override detection — the (B) capture-gap fix, surfaced alongside pushback candidates in the scan output) + a `⚠️ DRAIN DUE` footer surfacing the uncodified backlog so capture can't outrun curation. Depends on the "(Recommended)" label convention + routing genuine recommendation-forks through AskUserQuestion.

**Subcommands:**

- `/meta corrections --scan` — scan recent sessions for candidate owner-pushback events. Default: last 10 sessions. Optional: `--session <id>` (specific session by ID-prefix substring) / `--current` (this session's jsonl via `CLAUDE_CODE_SESSION_ID`, falling back to the most-recently-modified jsonl only when that is unset — what /wrap Step 7f runs) / `--days N` (last N days) / `--all` (entire corpus) / `--verbose` (600-char excerpts vs default 400). Output: per-session table of candidates with signal tags + excerpt.
- `/meta corrections --dig <prefix>:<idx>` — resolve one event with proper `ARGUMENTS:` split + adjacent assistant context. **Use whenever a scan excerpt is ambiguous** (quote-and-react patterns where owner pasted my output and reacted; the regex match may be inside the quoted block while owner's reaction sits past the excerpt cap).
- `/meta corrections --analyze` — registry frequency analysis. Outputs pattern-tag distribution (primary + secondary), codification rate (yes/no/pending split), activity-over-time, top-5 codification candidates with distinct-session counts, **+ gate-effectiveness (2026-06-20)** — per gated blindspot-tag, the registry SHARE before vs after its decision-moment gate (sniff-test check / Hot-Tier trigger) shipped. This is the **closed loop** measuring whether a sniff-test check actually drops its blindspot's owner-pushback rate (the effectiveness signal the sniff-test FAIL log never populated). `GATE_SHIP_DATES` in the script is the curated tag→ship-date map — EXTEND it when a new check ships; needs ≥20 post-ship entries before the Δ reads (a just-shipped gate shows ⏳ pending + a locked baseline). **Companion instrument (2026-07-18, guildhall adoption): `node scripts/calibration-score.mjs [--since YYYY-MM-DD]`** — the dual over-/under-caution calibration score (−20 hedge-pole / −30 confident-wrong-pole, over the registry + `audit-findings.jsonl` refuted rows). Run it alongside `--analyze`: the SHARE analysis is one-pole (over-hedge frequency) and therefore gameable — a gate that drops its tag's share while the under-caution pole rises is a net LOSS the share-read alone would score as a win. REPORT-ONLY — never wire the score into any agent-facing prompt/incentive (score⊥incentive until baseline data justifies more; `--self-test` covers parser + scoring).
- `/meta corrections --prime` (top-level shorthand: **`/meta prime`**) — compact session-start blindspot spotlight: the top recurring pattern-tags with ≥10% registry share, rendered as the `/orient` Step-9 ⚠️ spotlight + per-tag counter-actions. Read-only, ~instant. This is what the **SessionStart hook (`session-start.sh`) auto-fires at every session start (wired 2026-06-09)**; invoke `/orient` or `/meta prime` manually to **re-prime mid-session** (e.g. before a heavy composition, or if the prime has scrolled far up a long post-compact stretch — note the SessionStart hook is matcher-less and re-fires the prime on the `compact` source, so a compact itself does NOT drop it). Sibling of `--analyze` (which does the full frequency read) but compact — spotlight only, no distribution/codification breakdown. The script **self-renders** via `--prime --render` (labeled `#1`-in-full + compact secondary for every other ≥10% tag, each with its counter-action; `PRIME_COUNTER_ACTIONS` in the script is the single-source map shared by the hook + `/orient`). Raw `--prime` (TSV) kept for back-compat.
- `/meta corrections --add-entry` — append one entry to registry via CLI flags. Required: `--session --topic --proposal --pushback --correction --new-ground --pattern`. Optional: `--pattern-secondary --date --codified --registry-path`. Used internally by /wrap Step 7f for each approved row.

**When to invoke directly (outside the /wrap auto-flow):**
- `/meta corrections --analyze` — monthly insight read; cross-pattern review after a bulk triage; "what's the dominant blindspot right now?"
- `/meta prime` (= `/meta corrections --prime`) — manual re-prime of the top blindspot mid-session; cheaper than `--analyze` when you only want the spotlight, not the full distribution. Most useful before a heavy composition, or when the session-start prime has scrolled far up a long context (a `/compact` does NOT drop it — the matcher-less SessionStart hook re-fires the prime on the `compact` source).
- `/meta corrections --scan --all` — full-corpus retrospective when investigating a recurring blindspot or after a regex/script update (compare diff against baseline).
- `/meta corrections --dig <prefix>:<idx>` — ambiguous-event resolution during triage.
- `/meta corrections --add-entry ...` — manual entry creation outside /wrap (e.g., owner notices a correction mid-session and wants to capture immediately).

**Auto-invocation:** `/wrap` Step 7f auto-fires `/meta corrections --scan --current` at session-close. If candidates exist, owner triages inline (table-based approval); approved entries land via `/meta corrections --add-entry` per row. Skip silently when zero candidates. See `.claude/skills/wrap/SKILL.md` Step 7f for the full session-end workflow.

**Files:**
- `.claude/meta-corrections-registry.md` — the registry (markdown, git-tracked, PR-reviewable). Header documents pattern-tag taxonomy.
- `scripts/meta-corrections-scan.py` — implementation script (CLI primitives).

**Pattern-tag taxonomy:** the canonical list lives in the registry header (`.claude/meta-corrections-registry.md` → "Pattern-tag taxonomy") — extend it THERE as new patterns surface (this spec no longer re-enumerates the full set, to kill the partial-list drift class). The high-frequency tags driving the session-start prime are `under-justification` / `minimum-viable-scope` / `over-narrowing`, each with a counter-action in `PRIME_COUNTER_ACTIONS` (`scripts/meta-corrections-scan.py`). Any new tag MUST get a matching `PRIME_COUNTER_ACTIONS` entry so `--prime --render` emits a real counter-action instead of the generic fallback. Newest: `preference-violation` (2026-06-09 — codified-preference application gaps, active-recall before write).

**Bulk triage workflow (when manually triaging many candidates, e.g., first registry bootstrap or post-regex-update):**
1. `/meta corrections --scan --all` (or `--days N` for narrower window).
2. Pre-classify each candidate (real / FP / dupe + pattern tag); resolve ambiguous via `--dig`.
3. Present table to owner: `| # | session:idx | excerpt | cls | pattern | new ground |`.
4. Batch-approve per ~10-20 events; entries land via `--add-entry` per row.
5. `/meta corrections --analyze` post-triage to validate distribution.

The 2026-05-24 bulk triage that bootstrapped the initial registry (67 entries from 22 jsonls) demonstrates this workflow.

**Anti-scope:**
- ⛔ **TRIAGE THE CANDIDATES YOURSELF AND WRITE THE REAL ONES — THIS REVERSES THE CLAUSE THAT STOOD HERE.** The retired rule said never auto-write without owner approval, because the regex carries a ~20-30% FP rate — but **an FP rate argues for CAREFUL triage, not for OWNER triage**, and owner triage did not in practice overturn the calls. Routing them is a round-trip that returns nothing. ⚠️ **That premise is a stated account, not a measurement** — `grep -ciF overturn scripts/meta-corrections-scan.py` → **0**, so the scanner has no overturn field and the registry records none; the sole evidence is a single statement, which is good grounds and is not a measurement. The sibling clause in `wrap/SKILL.md` asserted the same proposition BARE — no epistemic marker, which is the STRONGER form, not the honest one; both specs now attribute it to that statement.
  **What the FP rate still obliges:** classify every candidate against the registry's own definition — a proposal of MINE, an owner correction, and a SHIFT in response — and drop the rest. The reliable false shapes are REQUESTS ("can you check X?"), DIRECTIVES ("let's codify a rule that…"), QUESTIONS ABOUT THE TOOLING, and DUPLICATE RECORDS OF ONE UTTERANCE (a queued/typed pair is ONE event). Measured when the rule changed: **13 candidates → 8 real, 5 false**, a 38% FP rate — the triage is real work and it is mine.
  ⚠️ **Still gated: anything that CHANGES A RULE.** Writing a registry event is capture; promoting a pattern to an L# or editing a spec is not.
- Don't bloat the per-entry format. The 8-line shape is intentional — registry is the high-volume capture layer, meta MEMORY is the curated layer. Pushing more structure into entries duplicates meta MEMORY's purpose.
- Don't run `--analyze` on every `/meta` invocation — cadence is owner-driven (monthly or post-bulk-triage).
- Don't promote registry patterns to L# automatically. Promotion requires D+I+S scoring + evidence assembly + revisit-trigger design — that's a `/meta learn` step, not auto-firable from the registry side.

**Revisit:** if the registry grows beyond ~500 entries without /meta learn codification keeping pace, the feeder→codifier loop is broken — investigate why /meta learn isn't promoting recurring patterns. If `--analyze` shows pattern distribution stays stable across 90 days with no new patterns surfacing, the regex set is calibrated — no further v-bumps needed. If owner consistently skips Step 7f triage with "ship later", registry value isn't being realized — re-evaluate whether the auto-fire trigger is well-placed.

## Process — Maintain (subcommand: `maintain`)

Sequenced runner for the maintenance family. One invocation runs all members in canonical order (status → corrections scan → memory-audit → router-staleness → self-audit → architecture-audit → coherence → telemetry → patterns → cite-check), preceded by a non-gating context-read preamble (the due-check GATE was retired 2026-07-19 — 3 consecutive all-due runs proved it structurally dead at fleet velocity), and batches all propose-level findings into ONE consolidated approval table at the end.

**Distinct from bare `/meta`:** Full Review is one deep process; maintain is a dispatcher over the codified subcommands (including ones Full Review never runs — corrections, architecture-audit, self-audit, coherence, telemetry). **Distinct from `/meta review --flags`:** review composes the four audit modes unconditionally; maintain covers the wider family (its former due-gate retired 2026-07-19).

**Full spec:** [`references/process-maintain.md`](references/process-maintain.md) — member own-cadence reference table ("last run" ground truth = meta/CHANGELOG.md), canonical-order rationale, 8 execution rules (context-read preamble / per-member specs unchanged / per-member auto-fix rules unchanged / approval batching / context-budget guard / persist-before-heavy / one-commit / record), output format, anti-scope, revisit clauses.

**Remember inline:** the context-read preamble is always emitted (grounding facts — last-run dates, churn, sizes — that shape member briefs but gate nothing); `--all` is a legacy alias of the default, `--only <a,b>` subsets, `--dry-run` previews; `learn`/`post-compact`/`distill`/`new-skill` are NOT members (maintain may recommend distill when a member's output trips their trigger, never auto-runs them); one `meta(maintain):` commit with explicit pathspecs = one SC-1 unit; not auto-scheduled — owner-invoked (monthly-ish).

## Process — Add new skill/expert (subcommand: `new-skill`)

Codified procedure for adding a single new skill/expert to the existing system. 6 phases: gap definition → shape decision → online research → implementation → test-fire validation → calibration patches.

**Distinct from `expert-system-bootstrap` skill:** that skill bootstraps the WHOLE system on a fresh project (Phase 1-6 covering meta architecture + skill roster + memory layer). This subcommand procedure adds ONE skill to an existing system.

**When to use:** when a recurring gap surfaces that an existing expert doesn't cover — panel synthesis identifies it / recurring audit miss / user request.

**Full spec:** [`references/process-new-skill.md`](references/process-new-skill.md) — 6 phases with cost estimates + worked example (uncle-bob bootstrap 2026-05-26→27) + anti-scope.

**Anti-scope (key gates):**
- Domain already covered by existing expert — consult `.claude/skills/expert-review/references/department-directory.md` BEFORE drafting
- Gap is sentinel-shaped (mechanical CI) — sentinel goes to test infra (`tests/integration/*sentinel*.test.ts`) or hooks (`.githooks/pre-push`), NOT a skill (Capture → Curate → Enforce framing)
- One-time consultation — use general-purpose with explicit brief
- SC-1 velocity — at this session's 4th meta-system commit, run the displacement-counterweight enumeration (`.claude/rules/session-cadence.md` § VELOCITY); an owner-directed meta session is exempt (check that first), and the cap is a self-check — never escalate it to the owner
- Speculative gap (no concrete evidence of ≥2 missed findings) — wait for evidence

**Most important phase:** Phase 5 (test-fire validation). Without 1-3 stress-tests on the anti-scope clauses, the skill ships uncalibrated. uncle-bob's v0.1.1 (file-shape test FIRST) and v0.1.2 (fast-path SRP + section-divider signals) BOTH came from real audit evidence, not spec-time speculation.

**Cost estimates:**
- Light persona (no online research, project-specific): ~150 LOC across 3 files
- Research-heavy domain expert: ~250-300 LOC + 2-3 commits

**Revisit:** if this procedure runs 3× and one phase consistently produces 0 useful work, prune it. Currently N=1 evidence from uncle-bob bootstrap. After 3 skill additions, audit which phases consistently add value vs which are ceremony.

## Coordination with /expert-review

The memory curator maintains a "panel playbook" in its own memory:
- **Expert effectiveness ratings:** Which experts consistently produce actionable findings vs. generic approvals
- **Optimal combinations:** Panel compositions that worked well for specific audit types
- **Contrarian rotation:** Track who was last assigned contrarian to ensure rotation
- **Panel sizing history:** Actual vs. estimated panel sizes, with outcomes

When `/expert-review` is composing a panel, it should check the curator's memory for relevant guidance. The curator updates its playbook after each audit based on the synthesis quality.

## Coordination with /session-memory

- After `/session-memory` captures decisions, the curator can verify they were placed in the right files
- The curator identifies when a session's decisions conflict with existing memories
- The curator suggests which expert MEMORY.md files should also be updated

## Principles

- **The system serves future sessions.** Every memory, every expert, every skill exists to make the next conversation better. If it doesn't help the future, it's waste.
- **Recommend AND execute.** Don't just list recommendations — apply the defer discipline to your own output. If a recommendation is <15 lines of work, do it now. Don't present a table of "proposed actions" and wait. Present AND execute, then show what you did. Recommending without acting is the meta version of lazy deferral.
- **Apply stored memory at the moment of writing, not just on retrieval (active-recall before write).** The harness loads `MEMORY.md` into context at session start, but having a rule loaded ≠ firing it at the right moment. Before producing operational caveats, recommendations, or "you'll need to" framings, do a 2-second `grep -i '<topic>' ~/.claude/projects/.../memory/MEMORY.md` on the relevant topic. If a stored feedback entry covers the operational claim you're about to make, re-read it first and align the output. Common triggers: anything about test running ("requires Docker"), deployment ("manual step"), DB migrations ("requires CLI"), commit/git workflow, vendor lock-in arguments. The active-recall gap surfaces as user pushback ("why can't you remember…?") — pre-empting it costs ~2 sec; ignoring it costs a round-trip + reversal. Distinct from the "Recommend AND execute" principle (which is about acting on recommendations) — this is about consulting what's already known before generating recommendations.
- **Verify roadmap presence before stopgap labels (locator ambiguity).** Before stamping any in-flight implementation as "acceptable / monitor / post-launch / stopgap", run `grep -i '<stopgap-domain-keyword>' todo.txt`. If a related entry exists, the stopgap label MUST cite the existing entry by line ("scaffolding for todo:N item, replace when that ships") OR promote the existing entry to a blocker if its trigger condition is now met. Same shape as "Recommend AND execute" — but applied to defer-with-trigger calibration. Cost: 10 seconds. Cost of skipping: user pushback + recommendation reversal.
- **Track evolution, not just state.** Knowing that the system grew from 30 to 52 experts in 2 weeks, and that 4 of the new experts are dormant, is more useful than just knowing there are 52 experts.
- **Cross-pollinate.** The curator's unique value is seeing across all experts. A security finding in one feature audit might inform the prompt engineer's approach to another. Surface these connections.
- **Don't meta-optimize.** One level of abstraction is useful (meta over experts). Two levels (meta-meta) is waste. Don't create a curator for the curator. But DO maintain your own MEMORY.md — tracking system evolution is your core job, not meta-optimization.
- **Always update own MEMORY.md.** Every state-changing `/meta` invocation (not the read-only ones: `status`, `queue`, `telemetry`, `help`) must end with an update recording what was found, what was done, and what changed. If you finish a review without updating your memory, you're not doing your job. **Post-split (2026-08-06), the append target is the CURRENT (newest-dated) `MEMORY-ARCHIVE-*.md` shard, not the router** — `MEMORY.md` holds the manifest + digest rows and is regenerated, so a body appended there is transient. `node scripts/memory-tier-split.mjs --roll .claude/skills/meta` cuts a fresh shard when the current one crosses 200 KB.
- **Do memory work yourself, don't delegate it.** Memory curation is a context-rich activity — the meta skill has the full session context (what was decided, why, what patterns were seen). Fresh agents don't. Delegating memory trimming/restructuring to agents produces generic results where informed judgment is needed. Use agents for research (reading all expert MEMORY.md files) but do the actual curation edits yourself.

- **Per-skill CHANGELOG.md is mandatory after spec edits.** When any `.claude/skills/*/SKILL.md` is edited, the same skill's `CHANGELOG.md` gets a one-line entry: date + commit hash + one-sentence WHY. If the file doesn't exist, create it with this header pattern: `# {Skill Name} — Changelog\n\n## YYYY-MM-DD\n- {commit}: {what + why}`. Audit-check + meta were the canary cases; extend the pattern to every skill on next edit.

- **Cross-skill linting after every spec edit.** When a skill is edited to fix a pattern (e.g., audit-check Check 3: "use counts not booleans"), the same edit may apply to sibling skills. After every skill spec edit:
  1. Identify the pattern that changed (e.g., "tables with bool column where 0=good is non-obvious").
  2. Grep `.claude/skills/*/SKILL.md` for the same pattern.
  3. **For each candidate, READ its current handling before proposing.** If the candidate already enforces equivalent discipline via a sibling lesson (e.g., existing lessons for /flows already enforce strict-Status-column reading), SKIP propagation and document the skip in the meta CHANGELOG with rationale ("X already enforces equivalent via L-N"). Don't blanket-extend — selective propagation prevents skill-spec bloat + multi-home drift. Evidence 2026-04-24 PM: cross-skill sweep had 6 candidates → 2 actual edits after read-and-verify pass.
     - **Execution-path check before filing a skip.** "Expert skill X already enforces it" ≠ "covered" when X is a **consultation-path** skill (loads only when consulted via Agent / `/expert-review`) and the practice should ALSO fire on the **orchestrator / implementation** path (the orchestrator's own inline edits + dispatched non-expert agents). Before skipping, confirm WHICH always-loaded layers carry the rule: `grep` `.claude/rules/*.md` (orchestrator) + `.claude/agents/_agent-primer.md` (dispatched agents) + project-memory `MEMORY.md`. If it lives ONLY in consultation-path `SKILL.md` files → the orchestrator path is uncovered → promote to active-recall + _agent-primer, don't skip. Evidence: the YAGNI/rule-of-three skip filed `saas-architect` as "already embodies it" (SKILL.md:64) — but saas-architect loads only when consulted; the orchestrator's always-loaded layer had no premature-abstraction guard at all, surfaced by pushback asking whether the orchestrator should also be aware of it. A skip is valid only when an ALWAYS-LOADED layer (not a consultation-only spec) covers the same path the propagation would.
  4. For surviving candidates, propose matching edits, present diff per affected skill, request user approval.
  This is part of `/meta learn` Step 4 and any direct skill edit.

- **Capture → Curate → Enforce — know which layer you're in.** An external-systems discovery pass surfaced that all 3 reviewed systems (wan-huiyan + wshobson + alirezarezvani) explicitly separate these concerns while ours blends them. No structural rewrite needed, but orchestrator should reason about WHERE each action lives:
  - **Capture** = session conversation + tool calls + agent outputs + user pushback. Passive; happens during work.
  - **Curate** = `/meta learn` Steps 1-4 (lesson extraction, skill-spec proposals, expert-MEMORY writes) + `/meta memory-audit` (hygiene). Active; assesses what's worth persisting + where.
  - **Enforce** = meta RULES.md + skill RULES.md + project-wide `.claude/rules/*.md` + CLAUDE.md + skill-lint detectors. Active at composition time; fires BEFORE output is written.
  When adding a new rule: ask "is this a capture gap (no data), curate gap (data exists but isn't sifted), or enforce gap (rule exists but doesn't fire)?" The three failure modes need different fixes. Capture-gap → new signal to watch for. Curate-gap → new /meta step or MEMORY entry. Enforce-gap → new `meta/RULES` row (a `RULES-SHARD-*` shard since 2026-09-04) or skill-lint detector or hook.

- **Consult COMPARISON.md before proposing new external-system adoptions (v2.8.1).** `.claude/skills/meta/COMPARISON.md` is the cross-system capability matrix + strengths/weaknesses/adopt-reject ledger across the catalogued external systems (see COMPARISON.md for the current roster). Before writing a new external-system verdict or proposing an adoption, read COMPARISON.md to (a) check if a similar pattern was already examined with an explicit verdict, (b) see trigger conditions for rejected patterns, (c) know which dimensions we defend and why. Refresh cadence: frontmatter `last-reviewed` field; `/meta self-audit` Check 8 gates on 90-day staleness. Companion files: each `external-*/MEMORY.md` has a pointer to COMPARISON.md at top — these are the anti-neglect layers keeping the reference alive across sessions.

- **Doc-creation cadence (codified 2026-05-21 after the architecture.md 55-drift audit).** Don't create new architecture-class teaching docs (`.claude/docs/<doc>.md`, README expansions, lecture-style overviews) during high-velocity sprints (>5 doc-affecting changes per week — new skills/agents/hooks/rules/commands/templates OR L#-codification spikes) UNLESS the doc has auto-sync infrastructure in place FIRST. Auto-sync = (a) `scripts/architecture-counts.mjs`-style filesystem-derived count single-source-of-truth, (b) skill-lint detector that catches drift at commit-time (e.g. `ARCH_DOC_DRIFT`), (c) `/wrap` Step 7d-style enforcement layer that auto-invokes the audit. **Evidence:** architecture.md was created 2026-05-17 at the start of a high-velocity sprint (~50 doc-affecting events across 4 days); 55 drifts surfaced in 2026-05-21 deep-dive — most caused by the doc capturing day-1 state while the system kept changing. Auto-sync infrastructure (shipped 2026-05-21) would have prevented ~75% of those drifts. **Rule:** evaluate doc-creation timing against system change-velocity. If velocity is high AND no auto-sync exists for the doc class, defer doc creation until either velocity drops OR infrastructure ships first.

## Anti-scope

Deliberately NOT in this skill.

- **Auto-meta-optimization (the meta-meta layer).** No skill curates the curator. The "Don't meta-optimize" principle is load-bearing. If meta itself drifts, `/meta self-audit` catches it; we don't need a meta-meta-audit.
- **Proactive `/meta distill` below the soft budget.** Distill triggers on the soft budget (≥4000 lines), NOT on WARN, and NOT on an "approach" sub-threshold (the 2700 approach-nag was dropped 2026-06-09 — nagging an owner-judgment task ~200 lines below a soft budget is pure noise). ⛔ The "no hard cap" premise is CORRECTED 2026-07-31: the LINE budget is soft, but a real BYTE cliff exists (256 KB ⇒ Read hard-errors; ~61.5 KB ⇒ partial view, band ~58.8-64.3 KB) — see Process — Distill. The soft budget was re-calibrated 05-20 / 05-25 / 06-09. Distilling early flattens evidence-rich audit entries into prescriptive patterns prematurely.
- **Auto-rewriting of skill specs from `/meta learn` proposals.** Spec edits are PROPOSE-and-await-approval (cross-skill linting too). Auto-write would degrade orchestrator judgment over time. Auto-write IS allowed for meta MEMORY.md and meta CHANGELOG.md (those are meta's own files).
- **HTML / external dashboards / web UI for meta output.** Markdown + inline reports only. Text-grep beats HTML always; the report is meant to be read in conversation, not bookmarked.
- **Full wan-huiyan adversarial debate rounds.** Cost-prohibitive (50-100k tokens per dispute). Replaced by lighter Targeted Verification (Step 7a) + sycophancy gate (orchestrator-level). Revisit trigger: 3+ ALTERNATIVE verdicts on same finding in one audit (haven't observed).
- **wshobson PluginEval Layer 2 (LLM Judge) + Layer 3 (Monte Carlo).** Layer 1 (deterministic structural) is sufficient at our scale + re-audit cadence. Layer 2/3 are re-examining as opt-in "Layer 2-lite" probe.
- **alirezarezvani Skills vs Agents vs Personas three-role split.** We collapse Persona into the Skill primitive (high-skepticism frontmatter field). Revisit if multi-persona reasoning becomes a load-bearing workflow.
- **shinpr phase-fresh agent contexts as default.** Conditionally trigger-gated for `/expert-review --phase-fresh-synthesis` opt-in. Not default because orchestrator synthesis accumulation is a feature for cross-expert pattern-recognition, not a bug.
- **vinicius INVARIANTS.md full adoption (180-LOC project contract).** 4 of 5 proposed invariants already enforced via `.claude/rules/` + pre-push. 1 reserved — not yet shipped because existing security review and test coverage is judged sufficient.

**When to revisit anti-scope:** if a rejected pattern's trigger condition fires in production (e.g., 3+ ALTERNATIVE verdicts on same audit finding), promote from anti-scope to Adoption Queue. Don't quietly add — explicit rejection-reversal goes through the same `/meta learn` → COMPARISON.md update pipeline as any adoption.
