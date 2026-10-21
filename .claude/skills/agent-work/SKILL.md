---
name: agent-work
description: Orchestrate 1-5 specialist agents to execute a task in parallel (code changes, not consultation). Use when a task needs multiple experts touching code simultaneously, or when /expert-review advice needs to be implemented by specialists. Partitions files, launches agents, integrates changes.
---

# Agent Work

Orchestrate 1-5 specialist agents to execute a task in parallel. Unlike `/expert-review` (consultation), agents here **do the work** — editing code, writing tests, fixing bugs. The orchestrator partitions files, launches agents, then integrates their changes.

**This skill is an executor, not an advisor.** It selects agents, assigns file ownership, launches work, and integrates results.

## Usage

- `/agent-work fix this bug` — find and fix a specific bug
- `/agent-work add this feature` — implement a feature

**Use templates:** `.claude/templates/feature-spec.md` for feature implementation, `.claude/templates/audit-finding.md` when implementing audit fixes.
- `/agent-work review and fix this` — review code and fix issues found
- `/agent-work refactor X` — refactor with specific agents

## When to Use

Use `/agent-work` when:
- The task is well-defined enough to execute without ambiguity
- Multiple files need changes that can be parallelized
- The task benefits from specialist knowledge (security, frontend, prompts, etc.)

Do NOT use when:
- You need opinions or trade-off analysis → use `/expert-review`
- The task is a single file / single function fix → just do it directly
- Requirements are unclear → use `/expert-review` first, then `/agent-work`
- The task is writing an e2e test for behavior that unit/integration can verify with 100% confidence. E2E smells: needs 2+ backend-layer mocks to run, relies on async flush timing outside the component, asserts on server-action response format, or just checks specific copy/constants. Those should be Vitest + `vi.mock` instead.

Changed-scope e2e is a Process step — Step 6 item 8, after the commit — not a reminder to the owner.

## Phase-gated execution for large / money-path work

For a large refactor/migration or any **money-path** multi-phase change, do NOT "dispatch all N agents at once and show the result at the end." Sequence the **waves**, committing at each boundary:

1. **Separable fix first** — any standalone defect (esp. money-path) lands in its OWN commit before the refactor starts.
2. **Foundation Wave 0** — a single agent lays the shared scaffolding (schema, shared helper, type) → committed standalone.
3. **Parallel Wave N** — the cap-5 fan-out, gated on an **explicit owner "go"**.
4. **Orchestrator-verified integration** — per the Step-6 pass.

This is distinct from — and does NOT reintroduce — the REJECTED *phase-sequential-agents* pattern (anti-scope below): each wave still fans out in **parallel**; only the wave BOUNDARIES (commit points + the pre-Wave-N go-gate) are sequential.

## Pre-launch checklist for background agents

Before firing any agent with `run_in_background: true` whose scope requires creating new files (new migrations, new test helpers, new route files, new templates), verify:

- [ ] `.claude/settings.local.json` `permissions.allow` includes `"Write"` and `"Edit"` (tool-name-only entries permit all paths). Background agents cannot prompt the user for per-call approval — permission denials silent-fail and the agent terminates without creating files.
- [ ] Fallback when the above isn't set: launch in **foreground** (`run_in_background: false` or omit). User sees each Write prompt interactively and approves in-flight. Slower (blocks the conversation) but immune to silent denial.

**Why:** observed 2026-04-15: launched saas-engineer agent in background to create 9 new files; harness auto-denied the first Write call and agent terminated. Pattern repeated on relaunch until `update-config` skill added tool-only `Write` + `Edit` entries to the allow list.

Foreground agents are immune because the harness prompts the user UI; background agents have no UI and default to deny.

## Process

### 0. Validate the build premise (when building from a written spec)

When the task is "build X" from a written BACKLOG/plan spec (not a live bug), run the lean validation BEFORE selecting or launching any agent:
- **Already-shipped grep** — confirm the feature (or large parts of it) isn't already in the tree.
- **Fiction-check every cited symbol** — each file / function / column / route / flag the spec names must actually exist (`grep`/`ls`). A symbol that doesn't resolve means the spec is partly fictional.

Re-scope to the genuine gap, THEN proceed to Step 1. A written spec is a draft to pressure-test, not a fast-path to dispatch — agents launched against an already-shipped or fictional premise waste a full wave.

### 1. Analyze the task

Read the task description. Identify:
- **Affected files** — which files/directories will be modified
- **Task type** — bug fix, feature, refactor, review+fix
- **Complexity** — determines agent count (1-5)

### 2. Select agents (1-5)

Use the routing rules from `/expert-review` (`.claude/skills/expert-review/SKILL.md` → Department Directory + Routing Rules), but **bias toward agents that can write code:**

| Priority | Agents | When to include |
|----------|--------|-----------------|
| **Always eligible** | saas-engineer, frontend-developer, security-expert, saas-architect, prompt-engineer | Any code task |
| **When relevant** | performance-expert, qa-expert, ai-vision-expert | Perf, testing, AI pipeline |
| **Rarely for execution** | ux-design-pro, ux-copywriter | Only if task is UI/copy-specific |
| **Never for execution** | CRO experts, personas, economists, marketing, legal | These are consultation-only |

**Agent count guide:**
- 1 agent: Isolated fix in 1-2 files
- 2 agents: Fix spanning frontend + backend
- 3 agents: Feature touching pipeline + UI + tests
- 4-5 agents: Large refactor or cross-cutting change

**4-agent practical max for cross-cutting features.** If planning ≥5 agents for one dispatch, walk the file-ownership list per agent BEFORE launching and grep for cross-agent duplicates. Almost always the 5th agent's scope overlaps with an existing one — the natural axes of decomposition (schema/backend/UI/test/ops) max out at ~4 distinct boundaries; the 5th is a re-slice of one of those. Resolution: merge the smallest-scope agent into the largest-scope-overlap sibling. Evidence: a 5-agent initial partition (2026-05-19) had 3 file-ownership conflicts (the database schema file, the billing processor, the server-side analytics module); merged Agent E into Agent A → clean 4-agent ship.

### 3. Partition by file ownership

**Critical rule: no two agents may own the same file.** ⚠️ **Disjoint FILES are not disjoint CONTRACTS (2026-08-22):** an agent that RENAMES an ICU arg, an exported type, a DB column or an env-registry key changes a contract whose consumers sit in SIBLING agents' files — measured: a copy agent's in-flight rename of the `{recurring}` arg rendered a raw key on the pay-now surface another agent owned. Before dispatch, list every contract an agent may rename and name its consumers in the sibling briefs; prefer arg-free or additive shapes mid-wave.

Assign each agent an explicit, non-overlapping set of files. State this in the prompt:
```
You own these files ONLY — do not modify any other files:
- [owned file path, one per line]
```

**Partitioning strategies:**
- **By layer:** frontend agent (components/) vs backend agent (actions/, lib/)
- **By domain:** AI pipeline agent (lib/ai/) vs storage agent (lib/storage/) vs UI agent (components/)
- **By concern:** security agent (auth, RLS, validation) vs feature agent (business logic)

If a file needs changes from multiple concerns, assign it to the agent with the most changes. The other agent reports their needed changes as recommendations.

### 4. Write agent prompts

**⛔ POST-WRITE STEP — RE-READ EVERY EARLIER INSTRUCTION AGAINST THE SHAPE YOU FINALLY MANDATED (2026-07-30).** A brief that NARROWS its fix shape mid-composition leaves the earlier paragraphs presupposing the abandoned wider one — and **only the implementer can see it**, because each paragraph is locally correct and the author reads their own intent, not their own text. Measured: a charter carried an instruction imported from an earlier analysis ("flip this green test") that was correct only under the fix shape the *same charter* then forbade. The lead's own words on being caught: *"I told you to fix the trap and to apply the trap's own fix in the same paragraph."*

The implementer then either obeys the contradiction silently — **shipping the shape you forbade** — or spends a round-trip flagging it. Here the seat flagged, and the deviation was upheld as the BRIEF's defect, not the seat's.

**Check:** when you change the mandated approach at any point while writing, scan back through everything already written and reconcile it. Cheapest at composition time; it costs a dispatch cycle after. (Distinct from the mid-flight brief-CORRECTION case — that is a diff escalating *after* dispatch; this is residue present at send time.)

**Pre-write step — parallel-session file-scope check (mandatory when ≥3 agents AND any shared-surface files):**
Before composing agent prompts, run:
```bash
git status --porcelain
git log --all --oneline --since="6 hours ago"
```
If either reveals a concurrent session's modifications to shared-surface file types — `messages/*.json`, `schema.ts`, `types/index.ts`, `CLAUDE.md`, `package.json`, any `.env.*` file — enumerate the parallel session's file surface AND its working-tree file list. Each agent prompt gets a "DO NOT modify" section listing those paths. Without this check, agents may clobber concurrent work (wrong merge, conflict cleanup rework, or lost edits from the parallel branch). Cost: ~60 sec; cost of skip: full re-run + cleanup. Extends the expect-parallel-session-commits rule with a specific pre-handoff procedure.

Each agent prompt MUST include:
- The task description with full context
- Their assigned file list (explicit ownership), emitted as a machine-readable **`[scope-owns]: path1, path2, …`** marker line listing ONLY that agent's EDIT-scope — NOT files-to-read, NOT parallel-session exclusions. This captures the orchestrator's partition decision in its OWN jsonl, so `scripts/session-manifest.py whose-edit <file>` can attribute a shared file to the right session's wave (closes the subagent-edit attribution blind spot: the orchestrator knows the partition; the marker records it precisely, where a prose-grep would mis-credit read-context/peer-warning paths). Wired 2026-06-19.
  - **⚠️ A `[scope-owns]` marker is DATA FOR A PARSER, not shell and not shorthand for a human reader. EVERY path must be a COMPLETE repo-relative path. No brace expansion. No bare fragments. No shorthand of any kind.** Two malformations shipped 2026-07-09 and both silently degraded `check-overlap` — a **BLOCK gate**:
    - `locales/{de,es,fr,…}.json` (shell brace expansion) tokenized to the garbage token `locales/{de`; **every locale file registered nowhere**, so the gate falsely cleared the exact bundles two live sessions were concurrently editing. The collision was caught by a human, not the gate.
    - `app/auth/reset/page.tsx, reset/error.tsx, …` (first path complete, the rest bare fragments) recorded phantom paths verbatim — `whose-edit reset/layout.tsx` named a session for **a file that does not exist on disk**, while the REAL dirty file read `UNATTRIBUTED` and a peer's wrap-time orphan sweep nearly ADOPTED a live wave.
    Cheap self-check before dispatch: every emitted path either exists on disk or is one the agent will create. `scripts/session-manifest.py` was hardened against these two notations; it cannot anticipate the third — the discipline belongs on the emitter.
    Corollary: `whose-edit` records **assignment**, not authorship. An agent assigned a file that it decides not to write leaves a permanent phantom positive. A positive means "some manifest claims this path"; an absence means nothing at all. Never attribute a hunk from either.
- What other agents are doing (so they understand the full picture)
- **Parallel-session exclusions** (when pre-write step surfaced any) — "DO NOT modify X, Y, Z — parallel session owns those"
- **Already-shipped inline fixes** (when invoked from `/expert-review --final-audit`) — enumerate every file+line touched during the audit itself, plus "read current tree state before editing"
- **Policy assumptions** — explicitly state any business rules that constrain the fix (e.g., "a rejected request changes no state", "the plan allowance is the value in the plan-limits constant, not a remembered number"). Agents that violate unstated policies waste work.
- Instruction to NOT edit files outside their ownership
- Instruction to report conflicts: "If you see recent uncommitted changes in your files that seem related to this task, do NOT override — report what you found and what you wanted to change."
- Instruction to run `npx tsc --noEmit` after their changes
- **Scratch-file discipline — the agent scratchpad is private per SESSION, not per seat, so every sibling in the wave writes to the same directory.** Two habits, both in every brief: (a) every scratch file the seat writes starts with a prefix naming the system or task it is working on — give each seat its own prefix; (b) any script whose output the seat will read as a verdict first asserts the path it is reading, and aborts if that is not the file it owns. Measured during an audit wave, 2026-09-13: a builder's verification script was overwritten mid-run at a shared scratch path by a sibling seat. **The near-miss is a vacuous control, not a lost file** — seconds' difference and the same command prints a clean pass table about a DIFFERENT system's file, every arm agreeing. The harness's environment line calls the scratchpad "session-specific, isolated from the project" — accurate, and exactly the trap, because every seat the session dispatches gets the same one — and that line cannot be edited, so the brief is the only surface that says so. Same class as `.claude/rules/bash-environment.md` § A CERTIFYING INSTRUMENT'S SCRATCH STATE GOES IN `mktemp`, with the second writer a sibling instead of the operator.

### 5. Launch in parallel

**5a. Session manifest update.** ⛔ **AND MAIL THE FILES A BUILDER WILL *CREATE* TO `all` IN THE DISPATCH TURN** — an untracked half-written file reads to every peer as a fleet-wide `tsc` RED with no author (a peer broadcast one at 06:08Z 2026-09-03 and two seats spent measurements before the owning seat claimed it); `[scope-owns]` records the assignment locally and the fleet never sees it. Before dispatching agents, run `python3 scripts/session-manifest.py write` to capture the about-to-dispatch scope into the manifest. Peer `/orient` runs will see the updated files-touched + scope-invocation list. One-line cost (~150ms).

Fire each agent with `Agent(subagent_type: "{expert-name}", model: "{tier}", ...)` — `{tier}` is the model the routing sentence at the end of this paragraph names for that agent, and a builder expected to run for tens of minutes goes to Fable; every definition says `model: inherit`, so an omitted `model` runs the agent on the session's model. Each expert is a native subagent defined in `.claude/agents/` and auto-reads its own SKILL.md + MEMORY.md + `.agents/product-marketing-context.md`. You do **not** need to re-instruct the agent to read those files. All agents launch simultaneously in a single message. **Background EVERY agent in the batch:** never leave any agent foreground/main-thread-blocking — use `run_in_background: true` where the Agent tool exposes it, else the one-message multi-call async-returns each via notification. (The permission-driven foreground fallback in the §Pre-launch checklist is the *exception*, traded for permission-immunity — not the default.) **Model routing:** classify each agent verify-vs-generate — verify/refute/breaker lenses and anything whose output goes load-bearing without orchestrator re-verification run on **Fable**; generate/read/implement work with a net behind it (tests, orchestrator re-verify) runs on **Opus**; the breaker NEVER runs below the builder's tier; uncertain → inherit. **STATE the model per agent in the dispatch report** — routing transparency is expected, not volunteered-on-ask.

### 6. Integration pass (orchestrator) — Step → Verify

After all agents complete, **note each agent's STATUS line first** — a PARTIAL/BLOCKED agent gates the pass (resolve its escalations via the step-6 escape-hatch table before staging); cross-check files-touched vs ownership + `git diff --stat` (don't-trust-agent-clean). Then verify incrementally (not all at once):

1. **Type-check:** `npx tsc --noEmit` — if errors, identify which agent's changes conflict and fix before proceeding
2. **Test per-agent:** Run tests relevant to each agent's changes individually. If an agent's tests fail, fix before combining with the next agent's work.
3. **Combined test:** `npx vitest run` — verify no cross-agent regressions
4. **Review:** Scan agent outputs for:
   - CONFLICT reports (agent found changes it didn't want to override)
   - Recommendations for files outside their ownership
   - Test gaps identified
   - `**ORCHESTRATOR TEST-CONTRACT SWEEP NEEDED**` sections (see step 4a)
   - **Agent-claim drift (agent-claim drift hook).** If an agent's output says "APPROVED — no changes needed" / "no file modifications" / "nothing staged" / similar zero-delta framing, DO NOT trust it. Run `git diff --stat -- <agent's ownership files>`. If diff is non-empty, the agent's final summary drifted from its actual tool-call history — the edits ARE in the tree and must be synthesized. Cost: ~2 sec. Evidence: in one 2026-04-18 wave, saas-engineer + qa-expert both reported zero-delta while having landed real edits; synthesizing on their self-reports would have shipped uncovered deltas.
   - **Orchestrator-must-do auto-extract (2026-04-21).** Agents hit sandbox/hook limits they cannot work around and surface the delta back to the orchestrator. Ad-hoc catch is unreliable — one was nearly missed this session. After all agents return, grep each output for the 6 canonical escape-hatch phrases, build a unified checklist, execute during integration pass BEFORE staging. Phrases + required orchestrator action:

     | Phrase (case-insensitive grep) | Cause | Orchestrator action |
     |---|---|---|
     | `ORCHESTRATOR TEST-CONTRACT SWEEP NEEDED` | agent owns src but test lives outside ownership | Apply listed substitutions (step 4a) |
     | `ORCHESTRATOR I18N ALLOWLIST SWEEP NEEDED` | new Progress/Critique/etc. namespace added | Update every `pick(messages,` call in `src/app/` |
     | `sub-agent MEMORY blocks` or `hook blocked` or `block-subagent-memory-write` | Agent tried to Edit/Write expert MEMORY.md; hook refused | Extract Memory Update block, `touch /tmp/claude-meta-mem-allow`, Edit, remove marker |
     | `sandbox could not delete` or `neutralized to a .*stub` or `must remove` | Agent created temp/sanity files but rm was refused | `rm` the file(s) listed |
     | `requires orchestrator decision` or `must be resolved post-wave` | Agent hit a design call it cannot unilaterally make | Surface to user for decision BEFORE staging |
     | `followed the literal spec but intent was different` or `task spec was inaccurate for` | Agent did exactly what prompt said but noticed spec-intent mismatch | Read agent's CONFLICT section; fix spec OR apply post-hoc correction |

     **Execution:** single bash pass — `for f in <agent-outputs>; do grep -i -E '<pattern-alternation>' "$f"; done` — build the list. Apply each action in sequence. If 2+ agents name the same file (e.g., both flag tmp files to delete), dedupe.

     **Why this catches ad-hoc failures:** one wave (2026-04-21) surfaced 4 such deltas; 1 (a literal-spec-but-wrong-intent case in one agent's output file) was nearly missed because it didn't self-announce in a canonical way. That case specifically motivated row 6 of this table.
4a. **Test-contract sweep (interface change).** If any agent output contains `**ORCHESTRATOR TEST-CONTRACT SWEEP NEEDED**`, perform the listed substitutions now. Budget: mechanical substitutions across the flagged call sites (`perl -i -pe`/sed) + one full test re-run. Agents correctly refuse to edit tests outside their ownership when Rule 7 (interface-change call-site updates) and Rule 1 (file ownership) collide; the delta must land somewhere — that somewhere is here. Don't skip on the assumption "type-check passed, tests must be fine" — `tsc` accepts legacy call shapes via structural typing where runtime behavior differs.
5. **Test coverage gate** — before staging, verify:
   - [ ] Every code fix has a **behavioral** test (invoke function, assert output — NOT readFileSync + toContain)
   - [ ] Integration tests use real Docker DB where applicable (`npm run test:integration`)
   - [ ] If an agent wrote only source-grep tests, flag it and write behavioral replacements before committing
5a. **Shared-state surface verification scope (shared image/storage state).** If any agent's changes touched a **shared-state surface** — concretely: any page file with `export const revalidate`, any file imported by an ISR-cached page, OR any service hit by ≥2 e2e specs — and the agent reports e2e "PASS in isolation" / single-spec verification, that is NOT sufficient. Isolation hides suite-level bug class (in-memory ISR cache pollution from earlier specs' `<Link>` prefetch, shared DB state, `workers: 1` alphabetical-ordering effects). Required: one of (a) full-suite `./scripts/e2e-local.sh` (~10-15 min), OR (b) in-suite-order run of all specs alphabetically up to the agent's spec, OR (c) at minimum the agent's spec run AFTER 2-3 specs known to hit the same URL via `<Link>` prefetch. Evidence: one spec fixed twice 2026-05-18 (AM isolation pass → PM full-suite fail, ~45 min orchestrator debug cost). When in doubt, prefer (a) — full-suite verification is the cheapest correctness signal for shared-state changes.
6. **Stage + commit:** Stage all changed files in a single commit (explicit pathspecs, never `-A` — a bare commit sweeps the index). Agents never commit independently. **Do NOT push `main` or trigger CI on it** — that is a HARD owner-gated action; a directive to implement the task is NOT push approval. A `dev` push happens only as `/wrap`'s optional last step, when the owner asks, or inside a `/promote` the owner runs; never mid-promote.
7. **Commit expert MEMORY.md files** if any agents wrote memory updates — don't leave these uncommitted.
8. **Changed-scope e2e — AFTER item 6's commit, before the Step 7 report.** If the panel touched `tests/e2e/**`, `src/app/**`, or `src/components/**`, run `./scripts/run-changed-e2e.sh <base>` YOURSELF and report its `N passed` line — never hand it to the owner. It runs at a clean HEAD in a detached worktree, so it can only see COMMITTED work: run it before item 6 and it reports "N passed" on code without the panel's edits. Follow `/hanging-work` step 4 exactly — `<base>`, the worktree recipe, and what to say if that route is blocked all live there. The pre-push hook at `.githooks/pre-push` also runs it when `git config core.hooksPath .githooks` is set.

### 7. Report to user

Present a structured summary (not prose — use this format):

```
## Agent Work Complete

| Agent | Files Changed | What Was Done |
|-------|---------------|---------------|
| 1 (role) | file1.ts, file2.ts | Brief description |
| 2 (role) | file3.ts | Brief description |

**Conflicts:** None (or list them)
**Type-check:** Clean
**Tests:** X/X passing (Y new)
**E2E (changed-scope):** N passed at <sha> / "→ no changed files vs <base> — skipping" / not applicable (no e2e-relevant paths) / blocked: <what>
**Ready to commit:** Yes / No (reason)
```

This format ensures nothing is buried in prose.

## Global Constraints + lightweight handoff conventions (2026-06-17: the shared-constraints line already here became a named handoff contract, after shinpr/claude-code-workflows' handoff contracts, which also gave the one-line STATUS report; the block names come from the Global Constraints and per-task Interfaces blocks of obra/superpowers' plans; trimmed after the 2026-06-17 self-review)

**Global Constraints (the load-bearing part)** — a block of task-wide invariants (version floors like Next 16 / React 19; the exact source-of-truth constants the task touches — cite the `src/types/index.ts` value, NOT a remembered number, per the assert-the-literal-the-code-reads rule) **pasted byte-identically into every agent's prompt.** Assembled ONCE. Prevents cross-agent constraint drift (agent A assumes one plan allowance, agent B hardcodes another). The mandatory-shared upgrade of the optional "Policy assumptions" line in step 4.

**Two one-line conventions** — kept minimal; the fuller return-schema was trimmed after self-review found it re-encoded the step-6 escape-hatch table + the existing "what other agents are doing" field. **The durable reason a typed `files_touched[]`/`tests_added[]` return stays REJECTED:** those are agent SELF-REPORT, dominated by `agent-diff-reporter.sh` (PostToolUse `git diff --stat` ground-truth, "regardless of whether self-report was honest") + the step-5 full-suite run — re-adding them re-introduces the exact false-self-report failure that hook was built to defeat (agents claimed false deltas 3×). Re-expand ONLY if a dispatch shows prose-parsing failed on something git+test CANNOT independently observe (≈ never for files/tests; the one non-derivable slice — `status` — already shipped below):
- Each agent ends with a `STATUS: COMPLETE | PARTIAL | BLOCKED` line + any escape-hatch marker (the step-6 table drives the action).
- Each agent names what it CONSUMES from / PRODUCES for siblings — so a hidden ownership collision surfaces before launch.

## Agent Prompt Template

```
You are implementing part of a task for the product. You own these files ONLY — do not modify any other files.

**Your files:**
- [list of files]

**Task:** [full task description with context]

**What other agents are doing:**
- Agent 1 (role): [files they own, what they're doing]
- Agent 2 (role): [files they own, what they're doing]

**Global Constraints (identical in every agent's prompt; do NOT reinterpret):**
- [version floors: e.g. Next 16, React 19]
- [exact source-of-truth constants this task touches — cite the `src/types/index.ts` value, not a remembered number]
- [task-wide invariants / policy: e.g. "a rejected request changes no state", "plan allowance = the plan-limits constant's value"]

**You consume / You produce (Interfaces):**
- CONSUMES: [exports / types / files from sibling agents this task depends on, or "none"]
- PRODUCES: [exports / types / behavior siblings depend on, or "none"]

**Rules:**
1. Only modify files in your ownership list
2. If you see uncommitted changes in your files that seem related, do NOT override — report as CONFLICT
3. Read files before editing to understand current state
4. Run `npx tsc --noEmit` after your changes and fix any type errors in your files
5. Do NOT run vitest — the orchestrator handles combined testing
6. Report any changes needed in files outside your ownership as recommendations
7. **Interface changes mandate call-site updates.** If your scope includes changing any exported function's signature, arg shape, return shape, or exported type, you MUST: (a) `rg --type ts 'funcName\(' src/ tests/` to enumerate every call site, (b) update each call site in the same task, (c) run `npx vitest run` (or the relevant test subset) to catch runtime mismatches `tsc` can't see — TypeScript often accepts legacy call shapes via structural typing where runtime behavior differs. Interface changes discovered in isolation without call-site updates are a recurrent failure mode.

   **Test-caller exception.** When call sites live in test files outside your ownership list, do NOT silently edit them — Rule 1 (file ownership) wins over Rule 7 in this case. Instead: (a) list every such file explicitly in your output under an `**ORCHESTRATOR TEST-CONTRACT SWEEP NEEDED**` heading, (b) describe the substitution pattern (`old assertion → new assertion`) so the sweep can be mechanical. The orchestrator owns the post-wave sweep; don't block your own completion on tests you can't touch.

   **Constant/literal extraction.** "Interface change" includes EXTRACTING a constant, literal, object, or symbol from one file to another (factor-out refactors), not just function-signature changes. When your scope includes "extract X from file A to file B", source-grep tests asserting on X's presence in file A break silently — same defect class as call-site updates. Run `rg --type ts '<extracted-symbol-or-literal>' tests/` to enumerate breakage and surface as `**ORCHESTRATOR TEST-CONTRACT SWEEP NEEDED**` (per the Test-caller exception above). Evidence: an agent extracted `SECURITY_HEADERS` (Content-Security-Policy, Strict-Transport-Security, frame-src, `<host>`) from the request proxy file into a new shared module; 2 source-grep tests in unrelated files broke at the orchestrator test-run gate. Flagging during the agent task would have moved the fix from Check 9 inline-fix to pre-wave preparation.

   **i18n namespace additions.** When your scope adds a NEW top-level namespace to the source-locale message bundle (e.g., `Critique`, `CurationResult`, `BillingNew`), the corresponding layout-level `pick(messages, ALLOWLIST)` calls MUST be updated — otherwise `useTranslations("NewNamespace.*")` throws `MISSING_MESSAGE` at every page render under that layout. Run `rg "pickMessages as pick" src/app/` to enumerate allowlists (6 at last count — the canonical table lives in `.claude/rules/i18n.md`, not in this copy; do not hardcode the count here). Update every allowlist whose layout wraps pages using the new namespace, OR flag unhandled ones as `**ORCHESTRATOR I18N ALLOWLIST SWEEP NEEDED**`. See `.claude/rules/i18n.md` (not in this copy) for the full contract. Evidence: a frontend-developer agent added `Critique.rating.*` keys but the app layout's namespace allowlist only had `CritiqueResult`; `MISSING_MESSAGE` hit every render of a page under that layout; 1-line fix.

   **"KEEP X" / "PRESERVE Y" preservation instructions require pre-state verification (orchestrator-side prompt-writing hygiene).** When the orchestrator writes an agent prompt containing "KEEP the X call" or "PRESERVE Y's behavior" for a function being refactored, the orchestrator MUST verify X/Y actually exists in the file being modified BEFORE dispatch. One `Read` tool call costs ~5 sec; ambiguous wording causes the agent to faithfully ADD X where it didn't previously exist. Evidence: a spec moving the rate limiter to a hosted service said "KEEP the usage-event table insert on the allowed path" — the original limiter function never had an INSERT; INSERTs lived downstream at the usage-logging helper's call sites. Agent dutifully added one → would have double-written every rate-limited event, breaking MRR analytics + reconcile math. Caught by agent's own behavior-shift flag during integration pass, reverted inline. Applies to orchestrator prompts only; agents should trust the preservation instructions they receive.

**Read these files for context:**
- [relevant context files]

8. **Heartbeat (long tasks — >5 min OR >10 tool calls expected).** Every ~10 tool calls, append one line to `/tmp/heartbeat-{your-agent-descriptor}.txt` via Bash: `echo "$(date +%H:%M:%S) [desc] completed: <what you just finished>" >> /tmp/heartbeat-<desc>.txt`. Orchestrator tails this with `tail -3` for live progress without touching your JSONL output buffer (which stays at ~132 bytes until agent completion). Skip for short (<5 min, <10 tool call) research tasks — overhead exceeds signal.

9. **Test-hygiene preamble — read BEFORE writing any test.** If your task includes writing or modifying tests, these six traps have cost us debugging rounds across several earlier waves — consulting them up-front is cheaper than surfacing them at the test-run gate:
   - **`vi.mock` factory referencing module-scope `const`** → ReferenceError on hoist. Wrap shared stubs in `vi.hoisted(() => ({...}))` (rule in `.claude/rules/tests-unit.md`).
   - **`vi.mock(module, () => ({...}))` without spreading `importActual`** → silently drops every other export the production path uses. Default to `async () => { const actual = await vi.importActual<...>(...); return { ...actual, overriddenFn: mockFn }; }`.
   - **`mockReset()` inside one test** wipes the file-level default for every test that follows. If you reset, re-establish the default in `beforeEach`.
   - **Writing e2e for logic that unit+`vi.mock` can cover** (PostHog batch timing, multi-mock pipelines, server-action response format) — skip e2e entirely; write the unit.
   - **Integration-test seeds in loops** — grep `supabase/migrations/*.sql` for UNIQUE constraints on the target table FIRST. Loop-seeded rows with repeated `email` / `slug` / composite keys fail on the 2nd iteration with constraint violation.
   - **UUID test seeds MUST be hex only (0-9, a-f).** No `g-z`. Hint-prefix with all-hex (`f14000b0001`, NOT `f14p200b0001`) → postgres `22P02 invalid input syntax for type uuid` otherwise.
   If any applies to your scope: apply the pattern at write-time, not after the integration-run gate fails.

**End your output with a `STATUS:` line** (COMPLETE / PARTIAL / BLOCKED) + any step-6 escape-hatch marker, and name what you CONSUME from / PRODUCE for siblings (see "Global Constraints + lightweight handoff conventions" above). COMPLETE + no escalations = clean to integrate; PARTIAL/BLOCKED tells the orchestrator to resolve before staging.
```

## Coordination with /expert-review

- `/expert-review` produces findings → `/agent-work` implements them
- `/expert-review --final-audit` can make trivial fixes inline (< 5 lines)
- `/agent-work` handles substantial changes (> 5 lines, multi-file)
- Both use the same routing table for agent selection
- Both reference the same expert SKILL.md and MEMORY.md files

### When implementing audit findings

When `/agent-work` is executing fixes from an `/expert-review` audit:

1. **Include the finding checklist** in each agent's prompt — the explicit list of P0/P1/P2 findings from the audit synthesis. Agents must know which findings they're responsible for.
2. **Each agent's output must map fixes to finding numbers** (e.g., "Fixed P1-3: input validation added to the upload handler"). This enables traceability.
3. **Every finding that involves code logic must have a behavioral test** — not source-grep. If an agent writes only source-grep tests, the orchestrator must flag it during integration pass and write behavioral replacements.

## What This Skill Does NOT Do (anti-scope)

- **Does not plan.** If the task needs planning, use plan mode or `/expert-review` first.
- **Does not consult.** No verdicts, no trade-off analysis. Agents execute, not advise.
- **Does not auto-retry.** If an agent fails, the orchestrator reports what failed. User re-runs with narrower scope.
- **Does not maintain state between invocations.** Each `/agent-work` call is independent.
- **Does not run phase-sequential agents.** Adopted shinpr-style sequential phase pattern was REJECTED — we run all specialists in parallel (cap-5 fanout) because most multi-file features have independent partitions. Revisit if observation surfaces 3+ collision-class failures from concurrent edits.
- **Does not use worktree isolation per agent.** Vinicius's worktree-per-executor pattern would isolate each agent in its own git worktree; rejected because we have zero observed collision incidents. Revisit on first observed collision (per `agent-diff-reporter.sh` hook output).
- **Does not exceed 5-agent parallel fanout.** Cap is a hard rule, not a guideline. >5 agents → orchestrator coordination cost exceeds the parallelism benefit + Anthropic 5h quota stress (per agent-claim drift hook evidence). Group related concerns into composite agents to stay under cap.
- **Does not allow sub-agents to self-write `.claude/skills/*/MEMORY.md`.** Enforced by `block-subagent-memory-write.sh` PreToolUse hook. Sub-agents emit `Memory Update:` blocks in structured output; orchestrator extracts and appends. This codifies the sub-agent MEMORY-blocks rule.
- **Does not produce multi-format output.** Each agent produces a single structured response (verdict + changes summary + memory-update block + test-coverage assessment). No HTML, no separate transcript files. Orchestrator integration pass produces the single summary.
- **Does not substitute for `/expert-review`.** This skill executes; expert-review consults. If the task starts with "what do we think about X?" → `/expert-review` first. If the task is "do X, Y, Z" with clear acceptance criteria → `/agent-work`.
