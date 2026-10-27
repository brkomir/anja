---
name: meta
description: Expert system intelligence — health, evolution, and optimization of the entire expert + memory system. Use for system-wide reviews, memory audits, pattern synthesis, session-lesson extraction, or self-auditing the meta skill itself.
---

# Meta — Expert System Intelligence

Top-level abstraction expert responsible for the health, evolution, and optimization of the entire expert + memory system. Tracks how the system grows, identifies gaps, prunes waste, and ensures every future session benefits from past work.

**This is the system's self-awareness layer.** It sees patterns across all experts, tracks what works, identifies what's missing, and recommends how to grow the system. It coordinates with the orchestrator (`/expert-review`) and communicates system state to the user.

## Process — Session Learn (subcommand: `learn`)

End-of-session lesson extraction. Distinct from Full Review (which audits current state) — this synthesizes what just happened. Run before `/wrap`. Skip on sessions <5 messages / no decisions / pure read-explore.

**Full spec — Read it before step 1 of every run, and again after a compaction mid-run:** [`references/process-learn.md`](references/process-learn.md) (6 steps: conversation scan → diff-vs-knowledge → expert MEMORY proposals → skill-spec proposals → deferral sweep → structural gaps) + RULES.md write-target classification + Durability+Impact+Scope 0-3 scoring rubric + Panel Playbook auto-update + principles + defaults for borderline decisions.

**Core rule to remember inline:** new lesson promotes to RULES.md only if it has all 3: concrete trigger + sub-15-sec action + generalizable. Else MEMORY-only. Durability+Impact+Scope total ≥6 promotes; 4-5 watch; ≤3 ignore. Auto-write for meta MEMORY; approval required for skill/expert edits.

**Most common signals to watch for:** user pushback ("are you sure?"), agents launched (right tool?), defer-with-trigger added, LARP markers (~Nh / N days / "post-launch" → training-data override failure, re-run citing the agent's "Agent-mode operating posture" preamble), "we should add X" without action. **Full signal table:** see references/process-learn.md.

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

- **Per-skill CHANGELOG.md is mandatory after spec edits.** When any `.claude/skills/*/SKILL.md` is edited, the same skill's `CHANGELOG.md` gets a one-line entry: date + commit hash + one-sentence WHY. If the file doesn't exist, create it with this header pattern: `# {Skill Name} — Changelog\n\n## YYYY-MM-DD\n- {commit}: {what + why}`. Audit-check + meta were the canary cases; extend the pattern to every skill on next edit. For meta itself, `CHANGELOG.md` is a router: append to the newest `CHANGELOG-ARCHIVE-*.md` shard (§ Memory & Versioning).

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

- **Consult COMPARISON.md before proposing new external-system adoptions (v2.8.1).** `.claude/skills/meta/COMPARISON.md` is the cross-system capability matrix + strengths/weaknesses/adopt-reject ledger across the catalogued external systems (see COMPARISON.md for the current roster). Before writing a new external-system verdict or proposing an adoption, read COMPARISON.md to (a) check if a similar pattern was already examined with an explicit verdict, (b) see trigger conditions for rejected patterns, (c) know which dimensions we defend and why. Refresh cadence: frontmatter `last-reviewed` field; `/meta self-audit` Check 8 gates on 90-day staleness.

- **Doc-creation cadence (codified 2026-05-21 after the architecture.md 55-drift audit).** Don't create new architecture-class teaching docs (`.claude/docs/<doc>.md`, README expansions, lecture-style overviews) during high-velocity sprints (>5 doc-affecting changes per week — new skills/agents/hooks/rules/commands/templates OR L#-codification spikes) UNLESS the doc has auto-sync infrastructure in place FIRST. Auto-sync = (a) `scripts/architecture-counts.mjs`-style filesystem-derived count single-source-of-truth, (b) skill-lint detector that catches drift at commit-time (e.g. `ARCH_DOC_DRIFT`), (c) `/wrap` Step 7d-style enforcement layer that auto-invokes the audit. **Evidence:** architecture.md was created 2026-05-17 at the start of a high-velocity sprint (~50 doc-affecting events across 4 days); 55 drifts surfaced in 2026-05-21 deep-dive — most caused by the doc capturing day-1 state while the system kept changing. Auto-sync infrastructure (shipped 2026-05-21) would have prevented ~75% of those drifts. **Rule:** evaluate doc-creation timing against system change-velocity. If velocity is high AND no auto-sync exists for the doc class, defer doc creation until either velocity drops OR infrastructure ships first.

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

### Primary entry points (16 — memorize these)

- `/meta` — Full system review (memory + experts + health report)
- `/meta review [--hygiene | --patterns | --self | --coherence]` — Focused audit modes (table below)
- `/meta learn` — End-of-session lesson extraction. Run before `/wrap`. See "Process — Session Learn" above.
- `/meta new-skill <name>` — Codified procedure for adding a single new skill/expert. 6 phases: gap definition → shape decision → online research → implementation → test-fire validation → calibration patches. Distinct from `expert-system-bootstrap` (bootstraps WHOLE system). See "Process — Add new skill" below.
- `/meta status` — Memory + skill-lint health dashboard. "Is the system healthy RIGHT NOW?" See "Process — Status" below.
- `/meta queue` — Display the current Adoption Queue (workspace infrastructure roadmap). Read-only. See "Process — Queue" below.
- `/meta distill <skill>` — Reduce MEMORY.md bloat by distilling verbatim audit entries into prescriptive patterns. **Trigger:** SOFT budget ≥4000 lines (raised 3000→4000 + the 2700 "approach-nag" dropped on 2026-06-09). ⛔ **The "NOT a cliff" rationale this trigger was built on is FALSE — corrected 2026-07-31 (measured).** On-demand loading escapes the always-loaded HARNESS cap, but NOT the **Read tool's own caps, which apply to every file regardless of load mode**: **256 KB ⇒ hard ERROR (zero content)**, **~25k tokens ⇒ announced PARTIAL view**, 2000 lines ⇒ default limit. The token cap binds first for real prose at **~58.8-64.3 KB — a BAND, not a number** (it moves with content density; measured 2026-07-31 with built fixtures at 2.350 and 2.572 B/tok. An earlier "~90 KB" here was an UNVERIFIED estimate, wrong by ~50%, and it propagated to four surfaces in this file before the fixtures were built). **Lines are the wrong quantity** — measured 2026-07-31, four expert memories (qa 404 KB/1912 ln · saas-engineer 335 KB · security 314 KB · saas-architect 270 KB) sat **under every line threshold** while hard-erroring their agents' opening Read for weeks, silently. **Budget MEMORY.md in BYTES.** The line number remains a scannability marker only; it cannot detect the failure that actually fires. Distillation itself is owner-judgment (verbose→prescriptive, redundancy removal). Soft re-calibration history: 1500→2000 (05-20)→3000 (05-25)→4000 (06-09) — each a budget bump, not a correctness fix. Adopted from alirezarezvani/claude-skills `/si:promote` lifecycle. See "Process — Distill" below.
- Lesson retirement — no command since 2026-10-11: a lesson a later one SUPERSEDES / REFUTES / WITHDRAWS gets the mark on its HEADING at its source (`/meta learn` Step 2c; the mark's grammar is in `RETIRED.md`); the sweep that moves heading-marked lessons to the cold `RETIRED.md` is built once ≥20 headings carry the mark. The per-lesson `/meta demote <L#>` command (shipped 2026-06-09 as the first-class DELETE) was PRUNED by its own Revisit clause — 0 invocations in 123 days. Distinct from `/meta distill` (which COMPRESSES).
- `/meta telemetry [--days=N] [--dormant=N]` — Skill invocation telemetry from `.claude/logs/skill-invocations.jsonl`. Top/bottom invocation counts, dormancy detection, trend over time window, from real data instead of a commit-message grep proxy. See "Process — Telemetry" below.
- `/meta observations` — Narrative weak-spot report for the founder: where the system repeatedly trips up, what works, what to fix next (the former `/observations`, merged 2026-10-26). Inline output, no file written. See "Process — Observations" below.
- `/meta post-compact` (legacy alias: `postmortem`) — Compact recovery (auto OR explicit `/compact`). Mid-session use after a compaction event when the system's generic continuation summary feels insufficient. Augments with umbrella work-subject + detailed last-exchanges + explicit hand-off state. Writes ONE file — this session's working plan (mandatory since 2026-09-04) — and never acts on the recovered context (this line said "Read-only" until 2026-10-11). Renamed from `postmortem`, which collides with `/premortem` + incident-retro connotations; this is compact recovery. **Spec: `.claude/skills/post-compact/SKILL.md`** — split out 2026-09-04; `/meta post-compact` is a legacy alias that dispatches there. See "Process — Post-Compact" below for the routing pointer.
- `/meta architecture-audit [--strict]` — Audit `.claude/docs/architecture.md` for staleness across 3 tiers (mechanical count drift / content coverage / conceptual gaps). Auto-fixes ≤5-line mechanical drifts inline (count corrections, stale L# refs, `last-reviewed`/maxL refreshes); surfaces Tier 2/3 as proposals. **Trigger:** every ~30 days OR after ≥10 meta-system commits OR doc `last-reviewed` frontmatter >90 days old. `--strict` mode treats any Tier 1 finding as failure (exits non-zero — for CI/auto-fix flows). Adopted 2026-05-18 after a 35-finding ad-hoc review surfaced the cause-fix for recurring doc drift. See "Process — Architecture Audit" below.
- `/meta doc-content-audit [<doc>]` — CONTENT/claim-verification pass over the meta-system prose docs. **No argument = the WHOLE SET**: every `.claude/docs/*.md` whose frontmatter reads `type: docs` — derive the membership, never restate it (`grep -l '^type: docs' .claude/docs/*.md`); `<doc>` scopes to one. Three doc types drive the currency test (Step 1): CONCEPTUAL-durable, LIVE-STATE, EVIDENCE-DATED reconstruction. Per doc: read each section, source-verify every mechanism-claim against the LIVE system, check conceptual currency + scope-bounded gaps, then rewrite per findings. **On a LARGE doc it runs in TWO phases: a targeted-claim Phase 1 → an auto-started deep conceptual-dive Phase 2 (parallel reading agents over every section — Step 6b).** The CLAIM-drift complement to `architecture-audit`'s COUNT-drift pass — and because it rewrites prose, it is **owner-invoked only, never cadence-fired**. Added 2026-06-18; deep-dive Phase 2 made default 2026-06-19. See "Process — Doc Content Audit" below.
- `/meta qa-plan-audit [--strict]` — Cadence-fired consolidation audit for `QA_TESTING_PLAN.md` (the product manual-QA artifact) — the doc-maintenance complement that `architecture-audit` is for the meta-system reference doc. Detects superseded-duplicate flows (missing tombstones) / dead-premise items / dangerous safety-test wording (RED) / already-covered → pointer candidates. **Trigger:** Part 7 >60 subsections OR ≥8 duplicate flows OR before a blocker pass. Built at N=1 (SC-3 waived) after a 6-expert review pass found ~110 prunable items. See "Process — QA Plan Audit" below.
- `/meta corrections [--scan | --dig | --analyze | --prime | --rule-repeats | --add-entry] [args]` — Owner-pushback-correction event registry (**shorthand `/meta prime`** → `corrections --prime`, the compact session-start blindspot spotlight). Companion to `/meta learn` (lesson codification) at a different granularity: registry captures individual events, /meta learn codifies cross-event patterns. Auto-fires at `/wrap` Step 7f when current-session scan returns ≥1 candidate. Adopted 2026-05-25 after the 67-entry bulk triage on 2026-05-24 validated the data-collection workflow. See "Process — Corrections" below.
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
- **`.claude/skills/meta/RULES.md`** — Flat trigger→action lookup table (one row per trigger phrase, cites `L{N}` back to MEMORY). Not loaded by any channel (no hook, payload or Skill include reads it; Band-O injection parked 2026-09-07) — reached by grep only. ⛔ **TWO-TIER SINCE 2026-09-04 — `RULES.md` is a ROUTER (~14 KB, reads whole) and the rows live in `RULES-SHARD-*.md` beside it. GREP THE DIR, never the router alone:** `grep -n '<trigger>' .claude/skills/meta/RULES*.md` — a grep of `RULES.md` by itself now returns a clean zero for a rule that exists, the same false-refutation shape the MEMORY two-tier split carries. **The split RE-OPENED on the premise its own closure named.** An earlier pass closed it 2026-08-06 with *"38 sections, ZERO over the partial-view band"* and made the PREMISE the thing to re-check; re-derived 2026-09-04 at 458,660 B — still 38 sections, but `## AH. Session procedure` had reached **77,255 B** while the second-largest was 35,885 B, **+1 B in eleven days**, so every byte of growth was in one section and that section could no longer be read whole by ANY route. The file was then split in full. **Tool: `node scripts/rules-tier-split.mjs --check|--apply`** — it re-assembles router+shards before re-splitting (so append a section to the router and re-run), sizes every shard under the `SKILLMEM_THRESHOLD` it reads out of `warn-large-tracker-read.sh` rather than restating it, conserves per-section bytes and the row multiset, and ABORTS rather than write on a mismatch. **Use as the active-recall layer at composition time** — grep the DIR for your trigger phrase BEFORE producing output.
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

## Process — Memory Audit (subcommand: `memory-audit`)

Read `references/process-memory-audit.md` before step 1.
Deep Phase 1 pass only. Use when the `check-memory-size.sh` hook warned on a MEMORY.md file growing past threshold, OR when triaging memory hygiene without needing a full system review.

## Process — Patterns (subcommand: `patterns`)

Read `references/process-patterns.md` before step 1.
Cross-expert synthesis only. No memory-gardener, no roster audit, no self-audit. Pure pattern-recognition across all `.claude/skills/*/MEMORY.md` files.

## Process — Coherence (subcommand: `coherence`)

Read `references/process-coherence.md` before step 1.
Cross-check user preferences (from `user_profile.md` + all `feedback_*.md`) against actual skill-spec behavior.

## Process — Self Audit (subcommand: `self-audit`)

Read `references/process-self-audit.md` before step 1.
Audit meta's own SKILL.md + MEMORY.md for the drift patterns `/meta learn` catches in other skills.

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

Read `references/process-telemetry.md` before step 1.
Actual skill-invocation telemetry from `.claude/logs/skill-invocations.jsonl`.

## Process — Observations (subcommand: `observations`)

Read `references/process-observations.md` before step 1.
It is the former `/observations` spec, moved, with the copy's edits, on 2026-10-26 (sources, the translation dictionary, the counts, the report structure); its marker is `[meta]`, the parent's name (conventions.md § Response-mode prefix).

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

Read `references/process-qa-plan-audit.md` before step 1.
Cadence-fired consolidation audit for `QA_TESTING_PLAN.md` — the doc-maintenance complement that `architecture-audit` is for `.claude/docs/architecture.md`.

## Process — Corrections (subcommand: `corrections`)

Read `references/process-corrections.md` before step 1.
Owner-curated registry of orchestrator-blindspot events — moments where owner pushed back on a recommendation/assertion/scope-decision AND the response shifted.

## Process — Maintain (subcommand: `maintain`)

Sequenced runner for the maintenance family. One invocation runs all members in canonical order (status → corrections scan → memory-audit → router-staleness → self-audit → architecture-audit → coherence → telemetry → patterns → cite-check), preceded by a non-gating context-read preamble (the due-check GATE was retired 2026-07-19 — 3 consecutive all-due runs proved it structurally dead at fleet velocity), and batches all propose-level findings into ONE consolidated approval table at the end.

**Distinct from bare `/meta`:** Full Review is one deep process; maintain is a dispatcher over the codified subcommands (including ones Full Review never runs — corrections, architecture-audit, self-audit, coherence, telemetry). **Distinct from `/meta review --flags`:** review composes the four audit modes unconditionally; maintain covers the wider family (its former due-gate retired 2026-07-19).

**Full spec:** [`references/process-maintain.md`](references/process-maintain.md) — member own-cadence reference table ("last run" ground truth = meta/CHANGELOG.md), canonical-order rationale, 8 execution rules (context-read preamble / per-member specs unchanged / per-member auto-fix rules unchanged / approval batching / context-budget guard / persist-before-heavy / one-commit / record), output format, anti-scope, revisit clauses.

**Remember inline:** the context-read preamble is always emitted (grounding facts — last-run dates, churn, sizes — that shape member briefs but gate nothing), and it reads the open tracker rows filed for this run (`scripts/meta-maintain-filed-rows.py`); `--all` is a legacy alias of the default, `--only <a,b>` subsets, `--dry-run` previews; `learn`/`post-compact`/`distill`/`new-skill` are NOT members (maintain may recommend distill when a member's output trips their trigger, never auto-runs them); one `meta(maintain):` commit with explicit pathspecs = one SC-1 unit; not auto-scheduled — owner-invoked (monthly-ish).

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
