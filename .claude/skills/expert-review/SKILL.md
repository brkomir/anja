---
name: expert-review
description: Orchestrate multi-expert consultation on any topic. Use when making decisions that need input from multiple domains (security + UX + legal + pricing, etc.) — routes questions to the right experts, ensures coverage, synthesizes recommendations.
---

# Expert Panel Review

Orchestrate multi-expert consultation on any topic. This is the coordination layer — it routes questions to the right experts, ensures coverage, and synthesizes their recommendations into actionable decisions.

**This skill is a router, not a thinker.** It selects experts, writes prompts, and synthesizes outputs. It never generates domain opinions of its own.

## Usage

> 💡 `/expert-review help` (or `--help`) lists these modes + flags without running a panel.

> 🔀 **`/panel` is a live alias for this command.** Anything valid after `/expert-review` is valid after `/panel`, flags included — `/panel --lean <topic>`, `/panel --code --last 3`. The stub at `.claude/skills/panel/SKILL.md` holds no spec of its own and exists so there is nothing to drift; every mode, the sizing FLOOR and the synthesis rules stay here. *(📁 the rest of this paragraph moved verbatim to [`references/process-notes.md`](references/process-notes.md) § /panel alias — not a deprecation, and why it is a skill stub — provenance only.)*

`/expert-review <topic or question>`
`/expert-review --lean <topic>` — 3-5 experts, quick verdicts, no contrarian
`/expert-review --spot <expert> <question>` — Single expert direct consultation
`/expert-review --code [--last N | --session | <branch> | <PR#>]` — Diff-scoped code review; auto-picks experts from changed paths, uncapped (uncle-bob always on code). `--last N` = last N commits (use this); `--session` = this session's changes; bare = uncommitted
`/expert-review --final-audit <flow or feature>` — Full verification with finding checklist

### Review Modes

| Mode | When | Panel | Synthesis |
|------|------|:-----:|-----------|
| **Full** (default) | Audits, cross-cutting changes, launch readiness | 7-15 | Full synthesis + contrarian + finding checklist |
| **Lean** (`--lean`) | Feature design, single-system questions, trade-off analysis | 3-5 | Quick verdicts table, no contrarian, skip completeness sweep |
| **Spot** (`--spot`) | Copy fix, config question, "is this safe?", quick opinion | 1-2 | Direct answer, no synthesis overhead |
| **Code Review** (`--code [--last N\|--session\|<branch>\|<PR#>]`) | Pre-commit / pre-merge review of an actual diff — scope via `--last N` (last N commits, the ergonomic default), `--session` (this session's changes), bare (uncommitted), branch, or PR; experts auto-selected from changed paths | uncapped | Lean-style verdicts table keyed to `file:line` + severity + violated rule/L#; no contrarian |
| **Final Audit** (`--final-audit`) | Verification of previously-implemented fixes | 5-15 | Full finding checklist + test coverage gate |
| **v3 Drift Audit** (`--v3-drift <F#\|Flow #N\|OPS #N>`) | Re-verify a v2-completed audit against drift accumulated since v2-date (post-v2 L#s + DECISIONS §s + migrations + cross-flow audits) | 5-7 | 2-question brief (drift verification + new-lesson application); inline-fix bias for ≤5 LOC findings; tracker entry v2 ✅ → v3 ✅ |

**Sizing FLOOR for close/audit modes — computed, not chosen (`minimum-viable-scope:instrument-undersize`).** When picking a mode to CLOSE a flow/feature (an audit — not an open design consult), the mode is FLOORED: run `node scripts/audit-sizing-floor.mjs --stakes <revenue,legal,premium,safety|none> --last-audit-days <N|never> --had-final-audit <true|false> [--owner-invoked <mode>] [--diff-class <logic|security|cross-surface|shared-state|trivial>]` and take the mode AT-OR-ABOVE its returned floor. A `--lean` / `--spot` / `/audit-check`-alone closer on a high-stakes (revenue/legal/top-tier/safety) / never-`--final-audit`ed / ≥30d-stale surface is `:instrument-undersize` — the **highest-stakes MVS sub-mode** (its miss is invisible at miss time and the undersized gate is the *last net*). An **owner-invoked mode is a HARD floor** — never substitute a lighter one (`:directive-shrink`). Below the floor = an explicit owner pick with a logged reason, never a default. Self-detecting net: `/meta self-audit` (audit-floor-check over the 8b ledger).

### v3 Drift Audit mode (`--v3-drift`)

**Full mode spec: `references/v3-drift-mode.md` — MANDATORY: Read it BEFORE composing a v3-drift panel.** It carries the process (incl. Step 1a's uncodified-drift commit-grep + the shared surface-paths hint map), the 5-7 panel composition, synthesis tags, the conditional `/audit-check --v3-drift` verification gate, tracker stamping, and anti-scope.

Router-resident essentials:
- **Fire when:** the target's v2-date is ≥30 days old AND `python3 scripts/audit-drift-detector.py --target <F# | N for Flow #N | O# for an ops row>` (not in this copy) reports HIGH triage (since 2026-10-06: ≥50 commits on the audit's own code since it, or domain score ≥25 — keyword-matched lessons ×2 + decisions ×3 — with ≥10 commits; migrations and cross-audit hits never make HIGH; the report's footer prints the live rule). *(Read "`--target <F#|Flow #N|OPS #N>` … (score ≥25)" until then; `--target 'Flow #N'` returns no match.)*
- **Skip when:** v2-date <30 days (no drift accumulated) · LOW triage (score <12 — v2 holds; MEDIUM neither fires nor skips by rule — owner pick) · tracker entry has no v2 marker (run `--final-audit` first; there is no v2 baseline to drift from).

Use templates from `.claude/templates/` for structured output (expert-panel-brief.md, flow-audit-report.md, final-audit-checklist.md).

## Invocation mechanism

Each expert is a **native Claude Code subagent** defined in `.claude/agents/{expert-name}.md`. Fire it via:

```
Agent(subagent_type: "{expert-name}", model: "{tier}", description: "...", prompt: "...")
```

`{tier}` is the model your model-routing policy names for the seat (Opus for an expert consultation and for a panel's non-ladder seats; Fable for a panel's ladder seats — Step 5). Every definition says `model: inherit`, so an omitted key runs the seat on the session's model, not on Opus.

The subagent definition already instructs the expert to:
- Read `.claude/skills/{expert-name}/SKILL.md` (expertise) at the start
- Read `.claude/skills/{expert-name}/MEMORY.md` (past decisions) and verify referenced code is current
- Read `.agents/product-marketing-context.md` for product context
- Respond in a 7-field return form (Verdict · Confidence · Scope · Assessment · Recommendation · Trade-offs · Memory Update) — NOT the full § Required Output Format below
- Return its Memory Update block for YOU to persist (it never writes its own `MEMORY.md`; Step 8a below)

**You do NOT need to repeat any of that in the prompt — EXCEPT the return form.** The generated definition (`scripts/generate-expert-agents.mjs`, its `## Required Output Format` template) carries 7 of the 10 fields below, and its Verdict line has no `BLOCKED`; `### Memory-load`, `### Defect-class` and `### External-claim sources` reach a seat only when your brief pastes § Required Output Format, and a panel that needs `## UNVERIFIED` or literal PATCHes pastes `.claude/skills/scout/SKILL.md` § THE RETURN CONTRACT as well. Your prompt should contain the *question*, the *context specific to this audit*, and the *source files beyond what the expert reads by default*. Nothing more.

⛔ **ONE EXCEPTION — the MEMORY read, because the "the subagent definition already instructs it" premise was fleet-measured FALSE (2026-08-01).** An audit of **4,184 sub-agent dispatches** found **1,632 (39%) never ATTEMPTED their `MEMORY.md` read at all** (⛔ **SUPERSEDED 2026-08-26 by a classifier fix — 1,920 of 6,953 = 27.6%, plus ALT_READ 5.1%, a FLOOR, on a corpus 66% larger. The stale 39% is the MORE alarming figure; the conclusion is unaffected and strengthened**) — un-read outnumbered un-readable 4.6×, so this is a dispatch-brief/instruction-adherence gap, NOT a file-size gap, and no size work closes it. The definition instructing a read is not evidence the read happened. So **every expert prompt carries one line**:

> `Read your .claude/skills/<name>/MEMORY.md first (one Read; if it reports truncation, grep the rest — and grep MEMORY-ARCHIVE*.md in the same dir before claiming an entry is absent).`

> 📁 **Moved, with the copy's edits, to [`references/process-notes.md`](references/process-notes.md) § MEMORY-read line — the retired byte figure, and when to retire the exception** — READ IT before executing this step.

If an expert is new (not yet in `.claude/agents/`), regenerate with `node scripts/generate-expert-agents.mjs`.

## Process

1. **Read the topic** — Understand what's being asked. Identify which departments are affected. **For any layout, ordering, reorder, "move X before/after Y", placement, or visual-hierarchy question** (user describes current state + proposes a change): the FIRST tool call before launching any expert is `Read` or `Grep` on the two elements in question and note their actual line numbers. If the user's described starting state doesn't match reality (e.g., they think Score Breakdown is early and scroll test is late, and the line numbers show the reverse), surface the discrepancy immediately — THEN decide whether the panel question has changed. Cost: 10 seconds. Cost of skipping: an entire 4-expert panel cycle where the winning finding is "your mental model of current order was inverted." Evidence: Score Breakdown reorder, 2026-04-16 — the load-bearing finding was "scroll test is already early, not late".

   **1b. Parallel-session brief-injection (prevention, MANDATORY before Step 2).** Before composing per-expert briefs, run:

   ```bash
   python3 scripts/parallel-session-scan.py --hours 6
   ```

   Captures peer-session context (sessions in `~/.claude/projects/<key>/*.jsonl` modified in last 6h, excluding the current jsonl, capped to the 3 most-recent peers). Per-peer block reports: inferred work subject (last substantive user message), files touched (Edit/Write tool_use), sensitive-surface refs (ToS/Privacy/migrations/content-safety/email registry/backlog/decision log/pricing/RLS), and slash-command invocations. **Inject the entire markdown output verbatim into EVERY expert's prompt** (NOT just the lead's) under a `## Parallel session context (orchestrator-injected)` heading. Distributing across N expert lenses lets security catch moderation-taxonomy collisions, saas-engineer catch email-registry collisions, legal catch ToS section collisions, etc. — each expert's own domain knowledge identifies overlap the orchestrator alone can't see. The script's own preamble instructs each expert to surface any overlap as a verdict-level concern in their Recommendation — flag now, do not defer to "later." **Skip rules:** `--spot` consults (single-question scope, panel-of-1, overlap risk negligible). `--lean` mode keeps it (overlap-risk independent of panel size). When the script reports "_No peer sessions active in the last 6h_," still inject the block — the "no overlap" signal is itself useful for experts to know coordination concerns are out-of-scope. Cost: ~1.5 sec script + ~150-300 tokens per expert prompt. Evidence: real-time collision detection demonstrated during the very session that shipped this script — peer session was actively editing the same tracker and memory files the orchestrator was about to edit; surfaced + coordinated rather than clobbered.
2. **Select experts** — Use the routing rules and department directory below. Scale the panel to match scope.
3. **Write each expert prompt** — Keep it to the question + the audit-specific context. Each prompt must:
   - Give enough context that the expert can act specifically (architecture decisions, prior expert conclusions, constraints, business philosophy)
   - List the 2-5 source code / plans / todo files specific to this question (beyond the SKILL.md/MEMORY.md the expert auto-reads)
   - State the specific question — not vague "review X"
   - **Design-fork panels are briefed "find the best possible solution"** — the orchestrator's own option is included UN-privileged among the alternatives, never framed as "validate my proposal" (generate-and-compare-from-scratch, not confirm-the-premade)
   - For the contrarian role, append: "Additional role: Devil's Advocate..." (see step 4)
   - **On any panel of 2+ seats, the scratch-file discipline — the agent scratchpad is private per SESSION, not per seat, so every seat in the panel writes to the same directory.** (a) Every scratch file a seat writes starts with a prefix naming the system or task under review — give each seat its own; (b) any script whose output the seat will report as a verdict first asserts the path it is reading, and aborts if that is not its own file. *(📁 the rest of this paragraph moved, with the copy's edits, to [`references/process-notes.md`](references/process-notes.md) § Step 3 scratch-file discipline — the measurement — provenance only.)*
4. **Assign contrarian** — For panels of 5+ experts, append to ONE expert's prompt: "Additional role: Devil's Advocate. Find the strongest reason this approach could fail or cause unintended consequences. Present the counter-argument even if you ultimately agree with the direction. **You MUST surface at least one concrete concern** — 'looks good' with no qualification is unacceptable in this role. If the approach is genuinely well-constructed, identify the single most fragile assumption or most likely failure mode and state it explicitly. Target the assumptions the team is most CONFIDENT about — those are dangerous precisely because they don't get questioned. **Counterweight (calibrated abstention):** the must-find rule demands a GENUINE attack, not a manufactured concern — if after honestly pressing the most-confident assumptions you find nothing real, say exactly that + name what you checked; do NOT invent a weak concern to satisfy the rule, and do NOT inflate a verdict you can't ground in evidence. A fabricated concern is as much a failure as a missed one." **Never assign the contrarian role to Dr. Lena Voss (engagement-psychologist)** — her persona already plays devil's advocate by default. Double-negatives produce all critique, no construction. Give the formal contrarian role to a naturally constructive expert (Mika Tanaka, Jordan Osei, or a technical expert) to force them to find the counter-argument. **Rotation rule:** check the most recent audit's contrarian in meta MEMORY Panel Playbook — pick a different expert this time. That's the whole rule; per-session multi-audit rotation tracking was theater at N=3-4. Pool: saas-engineer, saas-architect, performance-expert, prompt-engineer. **MUST-find enforcement (v2.7.1, alirezarezvani adoption):** orchestrator verifies at synthesis time that the contrarian's output includes a concrete concern (not just APPROVED with no caveat). If absent → relaunch the contrarian with "your role required at least one concrete concern; re-run with the strongest failure mode you can identify." Evidence basis: alirezarezvani's devils-advocate agent ("never approve without finding a risk") and its adversarial-reviewer skill ("You MUST find at least one issue").
   **4b. ⛔ HOST COMMITS FIRST — WRITE YOUR OWN POSITION DOWN AND LOCK IT BEFORE ANY SEAT IS DISPATCHED, AND GIVE THE SEATS ONLY THE QUESTION.** This step adopts the ordering, not the text, of an outside project's council pattern, which the copy's credits page names, and adopting an outside pattern means proceeding with it — **proceed, not a verdict written about somebody else's system.** Three parts, and (a) is the load-bearing one:
   - **(a) COMMIT the host position.** Before composing briefs, write your own answer to the panel question into the SESSION PLAN — never the panel's process log, which the seats read — under `## Host position (committed <timestamp>, before dispatch)`, **and restate it NOWHERE ELSE a seat can read until synthesis — not in the plan's own status, work-table or closability rows either.** ⛔ **The plan is not a sealed channel:** on the 2026-09-25 CI panel the position sat under its own `## Host position` heading (outside the SUMMARY-SYNC fence, which the next `/summary` overwrites — never put it inside that fence) and a seat still read it, summarised, in that same plan's work-table row. ⛔ **Until 2026-09-26 this said "into the process log", and that primed seats while (a) and (b) were both obeyed:** on two panels in two days a seat listed the process log among its files read, and its agreement with the host was partly an echo. **It ends with a `Checked on:` line naming every channel its claims about how the product works today were read from — the stored fields, the code path, the prompt — so the position shows what it rests on before a seat is briefed.** A list of what was READ cannot by itself show a channel the host does not know exists, so **for a claim about stored data the line is written against the stored row's OWN KEY LIST: dump the row's keys first, name every key that could carry the thing the claim is about, and mark which were read**. On one panel the committed position took a round's advice from one stored field (`editing_clusters`) and missed `technique_tip` and the next action; a seat overturned the premise from the stored rows and all five host positions moved. It is timestamped and **not edited afterwards**: a change of mind goes BELOW it as a dated block naming the seat that moved you. **A position you can still revise while reading returns is not a position, it is a preference** — the entire value of the ordering is that your own prior becomes falsifiable after the fact.
   - **(b) Seats get the QUESTION, never the position.** No brief carries the host's answer, and no brief points a seat at that file for reading; **every brief names it by PATH as do-not-open AND tells the seat to exclude it from every search** (`--glob '!<path>'`). Both halves are needed: `rg <topic> plans/` returns the file's rows without opening it, and fencing a SECTION by name ("do not read Host position") left the rest of the same file open, which is where the leak came through. The seat's self-report is not a check, so run one: at synthesis, look in each seat's subagent transcript for a Read of that path, or a tool RESULT after the brief carrying the position's own `## Host position (committed` heading or the file's rows. The basename inside the seat's own `--glob '!<path>'` exclusion is compliance, not a leak — a grep for the basename alone marks every obedient seat primed. A real hit ⇒ say in the synthesis that its agreement was primed. ⚠️ **This is strictly stronger than step 3's design-fork clause above**, which only requires the orchestrator's option to sit UN-privileged among the alternatives; here it is ABSENT. The unprimed-arm rule is a different axis and still applies on top — that one withholds the FRAMINGS from at least one seat, this one withholds the HOST'S ANSWER from all of them.
   - **(c) Synthesis names the strongest dissent, and names who moved you.** State the single strongest argument AGAINST the recommendation you are about to make, and name any seat whose return changed the position committed in (a). ⛔ **If nothing changed it, SAY SO** — an unchanged host position reported silently is indistinguishable from a panel that was never in a position to disagree, which is the failure this ordering exists to make visible.

   > 📁 **Moved, with the copy's edits, to [`references/process-notes.md`](references/process-notes.md) § Step 4b — what was NOT adopted from that council pattern** — READ IT before executing this step.

5. **Launch in parallel** — Use the Agent tool. All independent experts launch simultaneously. Cap at **7 experts per parallel batch** — split into sequential batches if more are needed. **Background EVERY agent in the batch:** a ≥2-agent dispatch must not leave any agent foreground/main-thread-blocking (that forces the owner to Ctrl+B to interject mid-wave) — use `run_in_background: true` where the Agent tool exposes it, else the one-message multi-call async-returns each via notification; either way, no agent blocks the main thread. ⛔ **Model routing — READ THE REVIEW-PANEL AMENDMENT in your own record.** For **review / `--code` / breaker panels**: every panel agent is `model: "opus"` **INHERITING effort** — never pass an `effort` override, since inheritance from the dispatching session's effort is the point — and **the MANDATORY Fable ladder (superseding the one-optional-seat clause): ≥1 Fable seat on a panel of 3+ seats · ≥2 at 6+ · ≥3 at 9+, counted across waves — the review hub alone keeps the choice.** Put the Fable seats where judgment density is highest (the unprimed arm, the contrarian, the seat whose error is least catchable), never on a routine persona read. ⚠️ **This line said the opposite until 2026-08-24**, routing `--code`/breaker panels to Fable and citing an earlier confirmation; that clause is **DEAD for review panels**, and it is what produced the measured incident — seven Fable lenses in one session, all inheriting max effort, dispatched five and six at a time, which spent the Fable allowance fast enough to block other work. The Fable clause **survives only for the NON-panel uses** named beside it in that file (contrarian, targeted re-verifier, eval-judgment). Standard consultations + reading lenses run on **Opus** (their load-bearing claims get orchestrator re-verification); the breaker never runs below the builder's tier. **STATE the model per agent in the dispatch report.**

> 📁 **Moved, with the copy's edits, to [`references/process-notes.md`](references/process-notes.md) § Step 5 — the model-routing currency-check trap** — READ IT before executing this step.
   - **When splitting >7 into waves: prefer EVEN waves (e.g. 5+4, not 7+2), and partition scope across waves.** Even waves let more experts benefit from wave-1's directives + keep each wave under the 7+-expert department-lead overhead. Latency is identical either way (still 2 sequential waves) — the win is coverage, not speed.
   - **Feed wave-1 findings into wave-2 briefs as DIRECTIONS, never CONCLUSIONS (anti-anchoring).** Inject prior-wave findings as scope-partition + verify/challenge directives ("wave-1 owns security+schema; you own perf+billing — don't re-derive theirs; CHALLENGE their max:5 conclusion"). Do NOT inject conclusions as assumptions ("wave-1 found X clean") — that anchors wave-2 into confirming rather than independently re-deriving, which silently weakens the independent-convergence signal that makes `[CONVERGED]` (Guideline 14) load-bearing. Deliberate cross-check (have a wave-2 expert stress-test a wave-1 verdict) is a feature, not repetition. Generalizes the Full App Review "Pass critical findings from earlier waves" clause (§Between waves) to every >7 split. ⛔ **AND THE DIRECTIONS GET A DURABLE ARTIFACT AND A RECEIPT — a brief is an ephemeral dispatch payload, so a direction injected only there leaves nothing a return can be checked against.** (a) Between the waves, write a `## Wave-1 DIRECTIONS for wave 2` block into the panel's process log (7b; open one for it if the mode has none): numbered `D1`…`Dn`, each an OPEN QUESTION rather than a finding, under an opening anti-correlation warning — these are unsettled, and a return saying *my lens cannot adjudicate this* is worth more than agreement. Carry each direction's diagnosis with its file fact: a file fact two seats read, stripped of their diagnoses, reads to wave 2 as independent convergence. (b) Every wave-2 return carries one disposition line per direction it received — `D<k>: confirmed with new evidence` · `refuted` · `declined (reason)` · `not examined` — so a direction a seat DROPPED stops looking identical to one it DECLINED; synthesis reads a missing line as `not examined`, never as agreement. *(📁 the rest of this paragraph moved, with the copy's edits, to [`references/process-notes.md`](references/process-notes.md) § Step 5 wave directions — the measurement — provenance only.)*
   - **⛔ RESERVE ONE UNPRIMED ARM — naming the framings bounds what the panel can find, and no anti-anchoring reword fixes that (2026-08-06).** The wave-directions rule above keeps a later wave from inheriting an earlier wave's CONCLUSIONS. This is the FIRST brief: even a clean, conclusion-free list of candidate framings is a **boundary on the answer space**. A primed lens answers in your vocabulary; an unprimed one answers in the corpus's. So on any panel whose subject is open-ended (a root-cause investigation, an audit of an unknown failure class, a "why does this keep happening"), give **at least one agent the corpus and the bare question — every framing withheld.** *(📁 the rest of this paragraph moved verbatim to [`references/process-notes.md`](references/process-notes.md) § Step 5 unprimed arm — the measurement, the not-an-oracle caveat and cost — READ IT before executing this step.)*
   - **Mid-panel premise refutation → SendMessage-correct the still-running lenses.** When a briefed premise is REFUTED while lenses are in flight (a lens's own grep/measurement disproves something EVERY brief asserted), do not let the remaining lenses return on the false premise: `SendMessage` each still-running lens naming the refuted premise + the refuting evidence (file:line / pasted command output) and directing it to re-ground any dependent reasoning. Returns that already landed on the premise are DISCOUNTED at synthesis, with the correction noted per affected finding. ⛔ **In the SAME turn as the correction messages, write one line into the session plan or the process log: the correction time, the seats messaged, and the seats that had ALREADY returned (the task notifications that have arrived; a notification carries no clock time, so read `date -u +%H:%M:%SZ` in that turn and never type a return time). Any synthesis sentence about re-grounding QUOTES that line** — the discount above is otherwise applied from recall, and "every seat re-grounded" has twice covered a seat that returned before the correction. *(📁 the rest of this paragraph moved, with the copy's edits, to [`references/process-notes.md`](references/process-notes.md) § Step 5 mid-panel premise refutation — evidence — provenance only.)*
6. **Department-lead synthesis** — When a batch has 7+ experts, designate a lead per cluster who pre-summarizes their group's findings before top-level synthesis (see Department Leads below).
7. **Synthesize** — Group findings by topic (not by expert). Present a summary table showing consensus and disagreements.

   **7a. Targeted Verification for disputes (v2.7.2, wan-huiyan Phase 13 adoption).** When synthesis surfaces a MEDIUM+ severity DISPUTE between experts (one says APPROVED on specific claim, another says REJECT, or two experts give conflicting factual claims about the same behavior), DON'T arbitrate in synthesis head — fire a targeted re-verifier agent. Pick the expert whose domain most cleanly owns the disputed question (e.g., security dispute → security-expert; performance dispute → performance-expert; accessibility dispute → accessibility-expert). Brief is scoped: "Experts A and B disputed {specific claim}. Verify {the code/behavior/claim} and return a 1-paragraph resolution with file:line evidence." Smaller scope than full re-audit, ~5-10k tokens per verification. Result feeds final synthesis. Applies to `full` + `--final-audit` modes; skip for `--lean` (dispute-rate expected lower + cost ceiling tighter) + `--spot` (single-question scope). Cap: max 3 targeted verifications per audit — more than that signals the synthesis itself needs re-scoping.

   **7a sharpening (2026-06-14): refute-framed + grounding-gated + verdict-blind.** Brief the re-verifier to find why {claim} is WRONG or mis-severitied (NOT to confirm it); its verdict counts ONLY if it cites the artifact (file:line) it read — "sounds right" is discarded; and where practical withhold the disputing experts' verdicts (show the claim + the artifact pointer, not who concluded what) so it re-derives rather than picks a side. A grounded oracle-check screens off the shared-model correlation that makes same-model *confirmation* worthless (2026-06-14).

   **7a-ii. Lead-Directed Deep Probe (`--final-audit` / high-stakes only, 2026-06-14 — adopts wan-huiyan's Phase-13 *Deep* tier we under-took; 4-lens re-consult 2026-06-14).** DISTINCT from 7a: 7a resolves *disputes*; 7a-ii deep-investigates *under-examined leads*. A pass-1 panel spends its budget on BROAD discovery, so a real bug flagged by exactly ONE lens (or a P0 on a sprawling surface) often arrives as a SHALLOW flag, and a context-saturated orchestrator can't always re-derive it (Liu 2024 "Lost in the Middle" — mid-context recall degrades U-shaped). A fresh-context deep-diver reallocates a clean budget to that one coordinate.
   > 📁 **Moved, with the copy's edits, to [`references/deep-probe-and-claim-support.md`](references/deep-probe-and-claim-support.md) § 7a-ii Lead-Directed Deep Probe — qualification, agents, brief, guards, SC-3 revisit** — READ IT before executing this step.

   **7a-iii. CLAIM-SUPPORT PASS — one skill-LESS validator, on the findings that are about to reach the OWNER.** DISTINCT from both siblings and it is the one aimed at the ORCHESTRATOR rather than at the panel: 7a resolves disputes BETWEEN experts, 7a-ii deep-investigates an under-examined lead, and neither asks the question this one asks — **does the cited evidence actually support the claim drawn from it?** A lens can quote correctly and conclude too widely; so can the synthesis compressing it. Both failures survive every check above, because every check above asks whether a FACT is true.
   > 📁 **Moved, with the copy's edits, to [`references/deep-probe-and-claim-support.md`](references/deep-probe-and-claim-support.md) § 7a-iii Claim-support pass — agent, verdicts, controls, gate, weakness, cost, SC-3 run record** — READ IT before executing this step.

   **7b. Process-log file for full + final-audits ≥7 experts (v2.7.2; broadened + made READ-BACK 2026-06-14 — a reviewer's retention fix).** When `/expert-review` runs a `full` or `--final-audit` panel of 7+ experts, write verbatim per-expert output (Verdict + Scope + Assessment + Recommendation + Trade-offs + Memory Update blocks, before topic-grouping collapses them) to `plans/{flow|feature}-{name}-process.md`. Filename convention: `plans/flow-{NN}-{short-name}-process.md` or `plans/feature-F{NN}-{short-name}-process.md` matching the tracker entry. Content: H2 per expert in launch order, copy-pasted structured output verbatim, plus a short `## Synthesis mapping` footer noting which findings got grouped where. Purpose: recovers verbatim reasoning that topic-grouping drops; audit trail for synthesis decisions; reference when user asks "wait, what did saas-engineer say about X?" **Read-back (2026-06-14 retention fix — addresses the finding-retention bottleneck a reviewer named: "you already generate more findings than survive the funnel").** For `full` + `--final-audit` panels ≥7, the synthesis GROUPS findings from THIS on-disk record **cross-checked against** head-context — not from head-context alone (which truncates per Guideline 10 + drops single-expert findings per Guideline 11). ADDITIVE, not a replacement: the orchestrator's accumulated cross-expert pattern-recognition is retained (so this is **NOT** phase-fresh-synthesis — see Anti-scope), and the disk record is the loss-proof source that makes topic-grouping/truncation drop structurally impossible. 7a-ii deep-probe lead-fidelity depends on this — write the log BEFORE selecting deep-probe leads. Do NOT write for panels <7 experts, `--lean`, or `--spot` — process log value scales with panel size + audit stakes, not worth overhead for smaller consults. **Content trigger (overrides the size floor, 2026-06-14 — closes the truncation gap):** ALSO write the log at ANY panel size ≥3 (including `--lean`; `--spot` exempt) whenever Guideline 10 fires (an agent's `### Verdict:` truncated). The size floor targets the N-DEPENDENT losses (topic-grouping collapse + head-context saturation); truncation is a per-agent render artifact INDEPENDENT of N (a long output truncates whether it's 1-of-4 or 1-of-12) and loses 30-70% of that agent's findings — so a size floor alone leaves it open. The re-launched full output goes to the log so the recovered findings survive a second truncation. Linked from the audit-finding checklist once written. **Compaction trigger (2026-07-11 — validated live this session):** ALSO write the log at ANY panel size ≥3 (incl. `--lean`; `--spot` exempt) when orchestrator context is ≥~80% at dispatch — appending each expert's verbatim return AS IT ARRIVES, before synthesis — or when a compaction fires mid-panel (write immediately from the returns on hand; re-collect truncated ones per Guideline 10). Expert returns exist only in the transcript until synthesis; a mid-panel compact reduces them to the lossy summary with no re-derive source. Closes the panel-side sibling of wrap-side persist-before-fan-out. Revisit trigger: after 2 final-audits consume a process log → if nobody consulted it between audits, drop the practice.

   **7c. Self-challenge pass BEFORE finalizing the synthesis (defer-sweep 3-part test — MANDATORY).** Before emitting the synthesis, run one disconfirming pass over your OWN findings: **"what did I NOT check that would disconfirm this finding?"** For every load-bearing finding (anything that gates a COMPLETE flip, a defer, a P0/P1 severity, or an owner recommendation), name the evidence that would FALSIFY it and confirm you actually went looking for that evidence — not only the evidence that supports it. A synthesis assembled purely from what the panel happened to find is a confirmation-biased artifact: the panel's blind spots silently become the synthesis's blind spots, and nothing downstream can see them. Panel-side twin of the split-lens defer check (split-lens scope check) and verify-before-assert. If the disconfirming evidence was never sought: either seek it NOW (a targeted grep, or a 7a-style re-verifier) or state the residual explicitly in the synthesis — never let an unchecked disconfirmer pass as a confirmed finding. *(Demoted here from the always-loaded active-recall Hot Tier in the 2026-07-12 2-band split: its trigger moment is inside a `/expert-review` invocation, where this spec is loaded — an admission-gate (b) single-context rule.)*

8. **Present** — Unified recommendation with specific implementation steps. Flag any unresolved disagreements.
8a. **Memory Update persistence (sub-agent MEMORY blocks — 2026-04-20 fix, MANDATORY post-synthesis).** For each expert response, extract the `### Memory Update` block. ⛔ **The block ENDS before the first following line, OUTSIDE a ``` fence, that starts `### `, is a bare rule (`---` alone on its line), or is a `## ` heading that is NOT a dated entry (`## YYYY-MM-DD …`); never read to end-of-message, and never end it at the second `## `** — a block may carry several dated entries, and a second-`## ` cut keeps only the first (measured 2026-09-28: 62 of 883 real hand-backs would have lost entries that way). The header may be `## Memory Update` as well as `###` (81 of those 883). Read the hand-back's own text (the `SubagentHandback` `message` in the task `.output`) or strip the harness's two-space frame indent first: in the framed view no line starts with `### `. Experts may write detail below it (the output format allows it), and an extractor that reads to the end copies that report into the memory file: measured 2026-09-27, two re-panel blocks landed at 13,373 B and 3,662 B and had to be trimmed by hand to 1,094 B and 1,289 B. Skip if content is "None — no significant decisions." For every other block, append the content verbatim to that expert's memory (orchestrator-side — experts no longer self-persist per sub-agent MEMORY blocks). Batch across all experts post-synthesis to avoid N×turn cost; one Bash call looping the appends is the cheapest path. ⛔ **APPEND TO THE CURRENT SHARD, NOT `MEMORY.md`, ON ANY SPLIT SKILL — and this line prescribed `echo "$block" >> .claude/skills/<expert>/MEMORY.md` until 2026-08-27, which is the WRONG TARGET for every two-tier skill.** A split skill's `MEMORY.md` is a ROUTER whose region below `ROUTER PREAMBLE ENDS` is REGENERATED, so a body appended there survives only until the next roll — which discards it **while reporting conservation OK**. `meta/SKILL.md` § "Always update own MEMORY.md" has said so since the 2026-08-06 split, but it loads on `/meta` and this is the spec executing at the write, which is why the rule never arrived. **Per expert: `grep -q 'ROUTER PREAMBLE ENDS' <dir>/MEMORY.md` ⇒ SPLIT, append to the shard with the MAX END-DATE in its filename (never `ls -t`, which is mtime order and measurably picks a stale shard — `.claude/orchestrator/session-doctrine.md` § RE-RESOLVE A SHARD FILENAME AT WRITE TIME (relocated there 2026-09-03; this line named `bash-environment.md`, where it greps ZERO, until 2026-09-06); anchor the glob `MEMORY-ARCHIVE-20*.md`, since undated `legacy-lessons` siblings exist and a lexical sort returns one of them); else `MEMORY.md` IS the body, append there.** Then run `node scripts/memory-tier-split.mjs --heal` and stage the refreshed routers with the shards — an append leaves the router index stale either way, and entries in a shard are grep-invisible from an unhealed router. Measured 2026-08-27 on a 7-lens panel: 3 of 7 targets unsplit (append correct), 4 split (append wrong), nothing at write time distinguishing them; it was caught, and `.claude/hooks/dup-durable-append-warn.sh` warns on it — PreToolUse on Edit|Write AND on Bash, warn-mode, so it fires BEFORE the write lands, not at commit. ⚠️ This named `safe-commit.sh`'s "router-staleness warn" until 2026-08-31: that string has never been in that file at any ref (`grep -ci router scripts/safe-commit.sh` → 0), and the residual inferred from the wrong timing — an uncommitted write staying transient — was wrong with it. **When the panel's ruling ADOPTED some seats' positions and SUPERSEDED others, prefix each persisted block with a one-line italic annotation naming which parts of that seat's recommendation were adopted vs superseded (and where the superseded half now lives)** — the default (persisting the recommendation bare) leaves the seat's MEMORY carrying a stale position as if ruled, and its next consult argues from it (practice adopted 2026-08-03, crop panel; recovered by a later transcript read 2026-08-04). *(📁 the rest of this paragraph moved, with the copy's edits, to [`references/process-notes.md`](references/process-notes.md) § Step 8a — why orchestrator-side persistence, and what to watch when an expert self-writes — READ IT before executing this step.)*
8b. **Audit-outcome capture — minimal ledger (2026-06-14, saas-metrics-analyst; capture-only slice — the metrics + kill-rule COMPUTATION is deferred).** After synthesis, on `full` + `--final-audit` (skip `--lean`/`--spot`), append the audit's outcome to two JSONL ledgers via a single `cat >> … <<'EOF'` per file. Capture starts NOW so data accrues before 7a-ii has fired enough to evaluate; the A/B + kill-rule (saas-metrics-analyst's N=6 / X=2) are computed LATER from the accumulated rows.
   - `.claude/logs/audit-runs.jsonl` — ONE row/audit: `{audit_id, date, target, mode, panel_size, pass_count, deep_probe_fired, stakes}`. **`stakes`** (added 2026-07-12) = the array of `{revenue,legal,premium,safety}` the audited surface touches (`[]` for none) — the input `scripts/audit-floor-check.mjs` needs to flag an audit that ran BELOW its stakes-mandated sizing floor (`minimum-viable-scope:instrument-undersize`). Omit it and that row reads UNKNOWN, never falsely flagged. **`supersedes`** (added 2026-08-24) = the `audit_id` (or array) this run RE-AUDITS, so a corrected close can retire an earlier undersized one. **FORWARD-ONLY: the NEW row declares it; never edit a historical row** — same principle as a forward-only migration, and the reason this ledger stays append-only. ⛔ **A superseding row must itself MEET its floor** (`audit-floor-check.mjs` `supersededIds` enforces this) — otherwise a second too-small panel would silence exactly the flag its own size earned. Without the field, an undersized close could never be cleared: a re-audit only ADDS a row while the original stays flagged forever.
   - `.claude/logs/audit-findings.jsonl` — ONE row/finding: `{audit_id, finding_id, severity:P0|P1|P2|P3, evidence_class:CONVERGED|SINGLE_SOURCE|DISPUTED, pass_origin:1|2, status:confirmed|reconfirmed|refuted|confirmed-clean|deferred, is_deep_probe_lead:bool}`.
   - **`status` wiring (2026-06-18 — makes the kill-rule's `refute_count` decider live):** `confirmed` = a real finding that stands · `confirmed-clean` = a dimension the audit confirmed CLEAN (no issue) · `deferred` = punted with a trigger · **`refuted`** = a pass-1 lead the 7a-ii deep-probe (or any pass-2 re-exam) KILLED (ground-or-kill = kill) · **`reconfirmed`** = a pass-1 lead the deep-probe re-examined and re-VALIDATED (distinct from `confirmed`, which was never deep-re-examined). Set `refuted`/`reconfirmed` ONLY on a finding a pass-2 re-exam actually adjudicated (so typically `is_deep_probe_lead:true`, `pass_origin:1` — DISCOVERED in pass-1, verdict PRODUCED in pass-2). These two are what `scripts/audit-yield-metrics.mjs` decider #2 (refute_count) + its overturn-rate read; omit them and the depth-pass's confirm/refute value stays unmeasurable.
   Every GROUP-BY field is an enum (severity / evidence_class / status / mode) so the ledger aggregates cleanly; finding TEXT stays OUT (display-only — it lives in the 7b process-log). The two files are created on first append (no scaffolding needed). **Versioning (2026-06-18):** these two ledgers are git-TRACKED, the lone exception in the otherwise-ignored `.claude/logs/` zone (this copy's `.claude/.gitignore` re-includes the two by name, behind a directory-only re-include that keeps a worktree's `.claude/logs` link ignored), same decision-feeder class as the meta-corrections registry, for cross-machine metric accrual + PR review. Append + commit them in the SAME audit Post-Gate commit with an explicit pathspec — NEVER `git add .claude/logs/`; expect trivial both-append merges across parallel sessions. The rest of `.claude/logs/` (skill-invocations, drift, fire-logs, `*.log`) stays local (high-churn point-in-time telemetry). Revisit: once ≥6 high-stakes audits are logged, build the metrics + kill-rule; if capture is performed inconsistently, promote to a Stop-hook.
9. **Mid-audit scope-expansion protocol.** When user overrides a deferred architectural decision during synthesis ("let's do this during this audit" / "I think we should do X now" / "actually defer Y instead"), the NEXT tool call is `Write` of `memory/project_<topic>_<decision>.md` with 4 standard fields: (a) **Decision** (what changed), (b) **Why** (rationale — often user's reasoning + audit context), (c) **How to apply** (concrete impl hints for downstream agents), (d) **Revisit trigger** (when to re-evaluate). THEN regenerate any agent briefs or /agent-work specs referencing this memory file by path — never by summary paragraph. Rationale: scope-expansion decisions don't survive across agent launches in orchestrator head-context; the memory file becomes the anchor. Companion to the rule that promotes a deferral at the moment it is classified — this is the inverse case.

## Required Output Format

Every expert MUST structure their response using this format. Free-form prose without this structure is not acceptable — it makes synthesis unreliable.

```
### Verdict: APPROVED | ALTERNATIVE | REJECT | CONFLICT | BLOCKED(<artifact>)
[BLOCKED(<path or sha>) only when an artifact the brief REQUIRES could not be read — name it. A partial read is `### Memory-load: PARTIAL` or a `### Could not check` line, never BLOCKED (upstream shinpr pruned its deferral-shaped return states at v0.25.0 and kept `blocked`).]

### Confidence: High | Medium | Low

### Memory-load: FULL | PARTIAL(lines A–B of N) | FAILED(<error>) | NOT-READ
[How much of your own `.claude/skills/{you}/MEMORY.md` actually reached your context. For PARTIAL or FAILED, PASTE THE VERBATIM TOOL NOTICE (the truncation banner / the size-or-token error text) — never a bare status word, which is unfalsifiable. NOT-READ = you never attempted the read.]

### Scope
[Which specific aspect of the question this expert is evaluating]

### Assessment
[2-4 sentences: what you found, what matters, what's at risk]

### Recommendation
[Specific action to take + affected files/components if applicable]

### Trade-offs
[What's gained and what's lost with this recommendation]

### Defect-class (when severity ≥ P1)
EXISTING | PLAN-RISK | DESIGN-CONCERN

### External-claim sources (when citing vendor/regulation/standard)
[List URL(s) for any external claim — Paddle limits, GDPR rules, Postgres behavior, Anthropic API limits, etc. Orchestrator may web-verify opportunistically and tag as `[WEB-VERIFIED]` / `[WEB-CONTRADICTED]` / `[WEB-INCONCLUSIVE]`, per the wan-huiyan v2.16.3 pattern.]

### Memory Update
[If significant decision made, multi-line format — orchestrator persists verbatim to expert's MEMORY.md.
The date is TODAY IN UTC: run `date -u +%F` and copy its output. Never a date from your brief, the conversation, or your local clock.]
## YYYY-MM-DD — Title
Decision and rationale (3-8 lines max).
Revisit: trigger condition.

[Or if no significant decisions:]
None — no significant decisions.
```

**Reading `### Memory-load` at synthesis (2026-08-01).** A MISSING field is not a pass — treat it as **UNKNOWN** and run `scripts/agent-memory-load-audit.mjs --session` to recover that agent's real load state from its sub-agent transcript (self-report is the weaker instrument; the transcript is the oracle).
The field adjusts CONFIDENCE WEIGHTING — it **never voids a verdict**. A memory-blind expert can still be right, and a FULL-load expert can still be wrong; the field tells you which findings deserve a corroborating read before they go load-bearing, not which to discard.
Weight it where it bites: a PARTIAL/NOT-READ expert citing a *past decision* ("we already ruled X") is the claim to re-verify; the same expert's *first-principles* analysis is unaffected.

Experts may add additional detail below this structure, but the structured section must come first. The Memory Update section is MANDATORY — it tells the orchestrator what to write to the expert's MEMORY.md file. **Per sub-agent MEMORY blocks:** agents DO NOT call Edit/Write on their own MEMORY.md — the orchestrator extracts Memory Update blocks during synthesis and persists them (Process step 8a, above). Prior pattern (agents self-persisting) caused the truncation (agent's terse post-Edit "Memory persisted" final message overwrote the structured verdict in orchestrator view, ~20-30% rate across 5 prior audits).

**Defect-class definitions (per wan-huiyan adoption 2026-04-18):**
- **EXISTING** — finding cites a current code defect with file:line. Reproducible right now. Highest evidence quality.
- **PLAN-RISK** — finding is forward-looking risk that hasn't manifested yet (e.g., "this will leak under N concurrent sessions"). Requires reasoning + plausibility but no current observable.
- **DESIGN-CONCERN** — architectural / UX / strategic concern that doesn't map to a single defect or risk; needs design judgment. Lowest evidence requirement, highest interpretation latitude.

When severity is P0/P1, the defect-class clarifies what kind of evidence supports the severity. P0 EXISTING > P0 PLAN-RISK > P0 DESIGN-CONCERN in evidence weight. At synthesis, check that EXISTING-class findings have a code-citation; PLAN-RISK findings have a stated trigger; DESIGN-CONCERN findings have a stated principle/constraint.

## Panel Sizing

### Consult the Panel Playbook

Before composing a panel, read the "Panel Playbook" sections. The archive split moved them out of `.claude/skills/meta/MEMORY.md`, which is now a router, into the `MEMORY-ARCHIVE-*.md` shards beside it — grep `## Panel Playbook` across `.claude/skills/meta/`. They track:
- **High-signal experts** (QA, security) — always include for final audits
- **Reliable pairs** (Security+QA for coverage)
- **Contrarian rotation** — who was last assigned, who's in the pool
- **Panel sizing track record** — what worked and what didn't

### Quick Reference

| Scope | Size | Examples |
|-------|------|----------|
| Narrow/tactical | 3-5 | "Should this button be outline or ghost?", "Redis vs KV for this cache?" |
| Feature design | 5-7 | "Design the referral program", "How should curation scoring work?" |
| Strategic/cross-cutting | 7-12 | "Pricing model review", "Launch readiness check" |
| Full audit | 12-15+ | "Pre-launch security audit", "Complete UX review" |
| **Full app review** | All relevant (~27) | "Full expert review of the entire app" |

### Two-pass mode trigger (two-pass panel — strategic reviews)

When a panel ≥9 experts AND the topic has BOTH "what is current state" (cost baseline, market sizing, current-state diagnosis) AND "what should we build" (intervention specs, ranked priorities, execution playbook), **split into two sequential panels** instead of running one 13-15 expert mega-panel:

- **Pass 1 (diagnostic, 6-8 experts):** heavy on quant — `saas-economist`, `saas-metrics-analyst`, `ai-vision-expert`, `prompt-engineer`, `market-researcher`, `growth-analyst`, `user-researcher` (contrarian). Output: corrected baseline + agreed problem statement.
- **Pass 2 (design+execution, 9-11 experts):** trim pure-diagnostic roles + add 3-4 execution-domain experts — `engagement-psychologist`, `haines-onboarding-cro`, `saas-launch-marketing`, `haines-paywall-upgrade-cro`. Output: intervention specs anchored to pass-1 numbers.

> 📁 **Moved, with the copy's edits, to [`references/panel-sizing-and-full-app.md`](references/panel-sizing-and-full-app.md) § Two-pass mode — why split** — provenance only.

**Skip rule:** single-component reviews (only "what state" OR only "what to build") run as one panel. Two-pass discipline applies only when both components are present.

### Panel Size Estimation (mandatory for audits)

The quick reference is a starting point. For feature/flow audits, **do not default to the table range** — run this checklist to compute the actual panel size:

**Step 1 — Count distinct sub-systems.** How many independent technical systems does this audit cover? Each sub-system with its own data model, processing pipeline, or prompt deserves its own depth.
- 1 sub-system: base case
- 2+ sub-systems: add 2-3 experts per additional sub-system (they need independent review, not shared coverage)

**Step 2 — Count concern dimensions.** List every concern area that needs expert eyes. Common dimensions:
- Security (auth, input validation, usage-allowance manipulation, IDOR)
- Performance (memory, timeouts, batch sizing, concurrent processing)
- AI quality (prompt correctness, bias prevention, structured output validation)
- AI vision (multi-image handling, model capabilities, attention distribution)
- Score/output validation (consistency, anchoring, calibration)
- Domain correctness (the product's own domain rules and their edge cases)
- Implementation quality (DB writes, error recovery, translation, state machine)
- UX baseline (output usefulness, perceived value of the plan's allowance)
- **Financial/retention blast radius** (could this path cause lost revenue, rage-cancel, refund pressure, or silent over-charge?) — applies to ANY audit where the code path touches paid-plan state, billing events, the plan's remaining allowance, or paid-tier-only features. If yes → add saas-economist + haines-churn-prevention to the panel, not just UX.
- Test coverage (edge cases, error paths, integration gaps)

Each dimension maps to 1 expert. Some experts cover multiple dimensions — deduplicate.

**Step 3 — Anchor against prior audits.** Check the feature tracker for audits of similar scope/complexity. If a comparable feature used N experts, this one should use at least N.

**Step 4 — Present the estimate with reasoning.** Before launching, show:
```
Sub-systems: 2 (comparison + curation) → base 7, +3 for second system
Concern dimensions: security, perf, AI quality, AI vision, scoring, domain, impl, UX(×2), QA = 10 unique
Prior anchor: the single-AI-pipeline feature audit used 10 experts
Deduplication: ai-vision + scoring overlap slightly → 11 experts
Final panel: 11
```

If the user questions the size, the reasoning is already documented. If you can't justify an expert's inclusion in one sentence, drop them.

**Reality check:** after computing N, name 1-2 SPECIFIC findings each expert is likely to surface that no one else on the panel would. If the answer is generic ("they'll review the security angle") rather than specific ("they'll catch the missing row-security policy on the new events table"), the expert is filler — drop them. The 4-step framework brainstorms the maximum justifiable size; the reality check trims to the minimum useful one. Distinguishes "could include" from "should include." Evidence: the 4-step computation is interpretive — sub-systems and concern dimensions can both be drawn to support N=7 or N=11 for the same audit. Per-expert unique-finding test forces concreteness.

**Skepticism diversity check (v2.7.0, wan-huiyan adoption).** After panel composition, read the `skepticism: low|medium|high` frontmatter of each selected expert. A well-composed panel has diversity across skepticism levels — all-high produces unanimous-skeptical bias (everything looks broken), all-low produces rubber-stamping (nothing flagged). Target mix for panels N≥6: at least 1 HIGH (stress-tester), at least 1 LOW (output-focused), majority MEDIUM (balanced). If the panel is all-high or all-low, swap one expert for a different-skepticism sibling covering similar scope. Stable per-expert skepticism + rotated contrarian role are COMPLEMENTARY: skepticism is a personality attribute; contrarian is a per-audit role assignment. An expert can be HIGH skepticism without being THE contrarian for this audit, and vice versa.

**Subject-blindness check — when the LENSES are subject to the defect being audited (2026-07-31, N=1-structural).** Before composing, ask: **is the panel's subject a defect these lenses themselves suffer from?** If yes, a panel staffed from them runs context-blind on its own subject, and its convergence measures the defect rather than the question. Two moves:

> 📁 **Moved, with the copy's edits, to [`references/panel-sizing-and-full-app.md`](references/panel-sizing-and-full-app.md) § Subject-blindness check — the two moves, evidence and SC-3 revisit** — READ IT before executing this step.

### Blast-radius override — when default sizes undercount

The general Panel Size Estimation scales from sub-systems + concern dimensions. But some audits carry an artificially-low default that hides the actual blast radius. This override applies whenever the code path being audited — ops, flow, feature, anything — has material financial or user-state impact.

**Before sizing ANY audit, ask: does this path have any of (a) money movement, (b) plan-state mutation, (c) refund/chargeback handling, or (d) user-visible state cascade that could rage-cancel a paying customer?** If yes to any → default to **9-expert full panel** (typically: saas-engineer + security-expert + ops-monitor + saas-economist + haines-churn-prevention + qa-expert + launch-ops-expert + legal-advisor + saas-architect-as-contrarian). This overrides lean defaults, "it's just a simple X" framings, and narrow-scope audits. Reasoning: bugs in money/user-state paths cost revenue + trust — the cost asymmetry justifies the panel cost.

**Common cases where default sizes undercount:**

- **Ops-register entries** (webhooks, crons, health routes): default 2-3 lean per the ops register. Correct for pure plumbing (retry crons, cleanup jobs, healthchecks with no user state); wrong when the entry touches money or plan state.
- **Flow/feature audits framed as "just a utility"**: when the scoping language implies narrow work ("just a cron", "just a redirect", "tiny form tweak") but the code path controls paid-plan activation, billing events, refunds, or paid-tier gating.
- **Refactors touching billing or usage-allowance logic**: even when framed as pure cleanup.

The general principle is blast-radius-first sizing. The specific ops-register clause is the canary case.

> 📁 **Moved, with the copy's edits, to [`references/panel-sizing-and-full-app.md`](references/panel-sizing-and-full-app.md) § Blast-radius override — evidence** — provenance only.

## Department Leads

When a wave or batch exceeds 7 experts, designate these leads to pre-synthesize their cluster before top-level synthesis:

| Cluster | Lead | Summarizes |
|---------|------|-----------|
| Engineering | `saas-architect` | saas-engineer, security-expert, performance-expert, devops-deploy-expert |
| UX & Design | `ux-design-pro` | web-designer, ux-copywriter, accessibility-expert |
| CRO | `haines-page-cro` | signup-flow-cro, onboarding-cro, paywall-upgrade-cro, churn-prevention |
| Product & Business | `saas-economist` | growth-analyst, saas-metrics-analyst, market-researcher, saas-launch-marketing |

## Full App Review Protocol

> 📁 **Moved verbatim to [`references/panel-sizing-and-full-app.md`](references/panel-sizing-and-full-app.md) § Full App Review Protocol — waves, skips, between-wave and final synthesis** — READ IT before executing this step.

## Expert Prompt Quality

**This is critical.** Low-quality expert prompts produce low-quality expert output. Every expert prompt must include:

- The specific question or decision to evaluate
- Relevant constraints (tech stack, timeline, budget, prior decisions)
- What the user cares about (quality, speed, cost, etc.)
- Any prior expert conclusions that inform this question
- Links to specific files to read (don't make experts guess where to look)
- The product's build philosophy: quality first, correctness over speed

⛔ **RUN THE CODIFIED-POLICY GREP BEFORE YOU DISPATCH, AND PUT ITS RESULTS IN EVERY LENS'S BRIEF — not the obligation, the RESULTS.** The Pre-Synthesis Checklist below carries the same check (codified-policy verification gate), but it fires AFTER the lenses have spent their budget, so a lens can only rediscover a settled decision, never be spared it. *(📁 the rest of this paragraph moved, with the copy's edits, to [`references/process-notes.md`](references/process-notes.md) § Expert Prompt Quality — why hand lenses the grep RESULTS, and its cost — READ IT before executing this step.)*

- `grep -n -iF '<subject>' DECISIONS.md` — read ALL hits, never the first, plus `grep -n -F 'SUPERSED' DECISIONS.md`
- `rg '<subject>' .claude/project-memory/ BACKLOG.md IDEAS.md todo.txt plans/` — an ACTIVE plan doc's `Open decision #N` rows ARE codified positions

**Anti-pattern:** "Review the pricing page" (too vague)
**Good:** "Review the pricing page at `<path to the pricing route>`. The tier model (read the pricing constants in the source, never a figure quoted in a brief) was recently revised, over a tier shape an earlier 6-expert panel validated. Question: should we add `<the specific pricing-page option under evaluation>`? Read `<the plan-limits constants file>` for current plan limits and `<the referral-program design doc>` for the referral system that interacts with pricing."

## Expert Prompt Template

**Full template:** [`references/expert-prompt-template.md`](references/expert-prompt-template.md) — structured fields (Context / Your scope / Files to read / Constraints / Question) + post-prompt self-check. The subagent already knows its role via `.claude/agents/{expert}.md`; the prompt only carries audit-specific context.

## Department Directory

**Full roster:** [`references/department-directory.md`](references/department-directory.md) — all 33 experts organized by 9 departments (Engineering, Design & UX, CRO, Product & Business, AI & Prompts, Content & Brand, Legal, Operations, Psychology). Use when composing a panel to verify coverage across orthogonal domains (plus the v2.7.0 skepticism diversity check).

## Routing Rules

Use these rules to quickly identify which experts to include for common question types:

| Question Type | Always Include | Consider Adding |
|---------------|---------------|-----------------|
| **New feature design** | saas-architect, ux-design-pro | frontend-developer, saas-engineer, web-designer, security-expert |
| **Pricing/monetization** | saas-economist, haines-paywall-upgrade-cro | haines-churn-prevention, growth-analyst |
| **Landing/marketing page** | haines-page-cro, web-designer, ux-copywriter | seo-content-strategist, saas-launch-marketing |
| **Signup/auth flow** | haines-signup-flow-cro, ux-design-pro, security-expert | haines-onboarding-cro, ux-copywriter, legal-advisor |
| **Onboarding/first-run** | haines-onboarding-cro, engagement-psychologist | ux-design-pro, ux-copywriter |
| **AI critique quality** | prompt-engineer, ai-vision-expert | engagement-psychologist |
| **Database/schema change** | saas-architect, saas-engineer, security-expert | performance-expert, saas-metrics-analyst |
| **AI output schema design** | prompt-engineer, saas-metrics-analyst, saas-architect | ai-vision-expert |
| **Meta-system memory/band/context architecture** | context-architect, saas-architect | uncle-bob, qa-expert, prompt-engineer |
| **Data quality/analytics** | saas-metrics-analyst, saas-architect | prompt-engineer, growth-analyst |
| **Performance issue** | performance-expert, saas-engineer, web-designer | saas-architect, frontend-developer |
| **Component refactoring** | frontend-developer, ux-design-pro, uncle-bob | performance-expert, web-designer, accessibility-expert |
| **Code quality / SOLID review / design coherence** | uncle-bob, saas-architect | saas-engineer, frontend-developer, qa-expert |
| **Security review** | security-expert, saas-engineer, legal-advisor | qa-expert, saas-architect |
| **Launch readiness** | launch-ops-expert, qa-expert, security-expert | devops-deploy-expert, seo-content-strategist, legal-advisor |
| **i18n/localization** | ux-copywriter (the source-language strings only) | seo-content-strategist, web-designer, legal-advisor. No expert in this copy covers translation, locale routing, hreflang or ICU syntax: brief a general-purpose helper as a translation reviewer for those, as `/wrap` step 5d does |
| **Retention/churn** | haines-churn-prevention, engagement-psychologist, growth-analyst | saas-metrics-analyst, saas-economist |
| **Legal/compliance** | legal-advisor, security-expert | saas-engineer |
| **Copy/messaging** | ux-copywriter, saas-launch-marketing | brand-naming-expert, seo-content-strategist |
| **Content moderation** | legal-advisor, security-expert | qa-expert |
| **Email/lifecycle** | engagement-psychologist, haines-churn-prevention | ux-copywriter, growth-analyst |
| **Help/education content** | ux-copywriter, haines-onboarding-cro | seo-content-strategist |
| **API/integration design** | saas-architect, security-expert | saas-engineer, performance-expert |
| **Reach / channel plan / go-to-market** | saas-launch-marketing, growth-analyst | market-researcher, saas-economist |
| **Community/growth** | saas-launch-marketing, user-researcher | growth-analyst, engagement-psychologist |
| **Flow audit (user flow)** | saas-architect, security-expert, qa-expert, ux-design-pro + flow-specific CRO/domain experts | frontend-developer, performance-expert or saas-engineer if flow touches uploads/processing/billing |
| **Feature audit (engineering)** | saas-architect, security-expert, saas-engineer + the UX baseline (ux-design-pro) | frontend-developer, performance-expert, qa-expert, prompt-engineer depending on feature |
| **Full pre-launch audit** | All operations + security + legal + qa + launch-ops | Scale to 12-15 experts |

---

## Code Review mode (`--code`)

Diff-scoped, project-calibrated code review of actual changes — the pre-commit / pre-merge "review what I just wrote" mode. Auto-selects experts from the changed paths, uncapped (Process step 2; uncle-bob always on code). Added 2026-06-03 (the `--diff`/`--code` seam flagged in a prior code-review-gap assessment). The native Claude Code `/code-review` follows `CLAUDE.md` (its vendor page, read 2026-10-21); this mode adds the path-scoped rules files the changed paths match, injected into every reviewer's brief, and reviewers routed by expert domain.

**Who reviews — never the author (builder≠breaker).** The session that wrote a diff never reviews it inline. **When no other session is around** (`python3 scripts/session-manifest.py who` lists no peer in its 8-hour window except ones it marks ✓, exited — read the rows, since the headline's count includes those — and `session-manifest.py hub-discover` names no review session; a `🚨 VACANCY` block that names no session names none, because its peer count reads session manifests that stay until a session has been quiet 24 hours), skip the ladder below and run this mode's panel as fresh-context sub-agents given only the commits: there is nobody to broadcast to and no herd to guard against. Otherwise send it to the live review hub (`session-manifest.py hub-discover`). ⛔ **A silent `hub-discover` is the trigger, not the all-clear:** broadcast the sha (`mail-send --to all`), await an ack, and on a `🚨 REVIEW-HUB VACANCY` resolve it by election (`fleet-claim review-hub`) before concluding no hub is alive — the ladder at `.claude/orchestrator/conventions.md` § #9, which exists because every peer reads "no hub" at the same moment and would otherwise self-run the same review N times. Only with no hub alive after that ladder: run this mode's panel as fresh-context sub-agents given only the commits — a session may review its own changes when no hub is alive, provided it does so through sub-agents with minimal context, just the commits to look at (the ladder above is the route to that destination). An agent that wrote code in the diff never sits on its panel.

**Invocation (scope forms — you should never need to hand-figure commit hashes; that clumsiness is the gap these forms close):**
- `/expert-review --code` → uncommitted working tree (`git diff HEAD`, staged + unstaged). Pre-commit review. *Caveat:* untracked NEW files are invisible to `git diff HEAD` — `git add` them first, or review via `--last N` after committing.
- `/expert-review --code --last N` → the last N commits (`git diff HEAD~N..HEAD`). **The ergonomic default for "review what I just committed."** Mechanical + robust — no hashes, no transcript inference. When in doubt, use this.
- `/expert-review --code --session` → everything changed since the last `/clear` (or true session start if none this session): commits in that window ∪ current working tree. **Orchestrator-resolved + context-bounded** — it covers exactly what the orchestrator can still see, which fixes the boundary semantics precisely: **`/clear` is a hard cut** (context is wiped, so `--session` *cannot* reach pre-`/clear` work — it equals "since last `/clear`" for free), and **`/compact` is lossy** (only a summary survives, so the exact pre-`/compact` commit boundary may be gone — the same blind spot `/wrap` Step 1b patches). It does NOT reliably reach the true session-uuid start across a compaction. Parallel-session-aware (scopes to commits THIS session made, not a peer's — e.g., a meta session that committed nothing reviews only its uncommitted edits, not a peer's billing commits). **Natural-language scope also resolves** (`--code since last /clear`, "since this morning") — it's LLM-interpreted, not a strict flag set. **When you need guaranteed-exact across a `/clear` or `/compact`, use `--last N`** — it counts from git and ignores context entirely, so compaction can't corrupt it. Mechanical/compaction-proof upgrade: a hook that resets on `/clear` and preserves across `/compact`.
- `/expert-review --code <branch>` → `git diff main...<branch>`.
- `/expert-review --code <PR#>` → `gh pr diff <N>`.
- `/expert-review --code <ref>..<ref>` / `<sha>` → explicit range/commit. Escape hatch, not the default — the forms above cover the common cases.
- `/expert-review --code <flow #N | F# | O#>` → **whole-surface review of a tracked flow / feature / ops-register entry** (NO diff). Resolves the entry's code surface (Step 1b), confirms it, then runs the **Code-corpus slice-mode panel** over the whole surface — the way to review an already-shipped flow/feature/ops entry that has no pending diff (and the form that fills the tracker `--code:` / `c:` column). Heavier than the diff forms (whole files, not changed lines), so the resolver prints surface LOC first for a scope-down.

**Process:**

1. **Resolve the diff.** Map the scope arg to its git command (bare → `git diff HEAD`; `--last N` → `git diff HEAD~N..HEAD`; `--session` → orchestrator-resolved session range ∪ working tree, fallback `--last N`; `<branch>` → `git diff main...<branch>`; `<PR#>` → `gh pr diff N`; explicit range/sha → as given). If the resolved diff is empty → report "no changes to review" and exit. `git diff --name-only` on the resolved scope yields the changed-path list. **Untracked-file note:** for the bare working-tree form, also run `git status --porcelain` and surface any untracked files NOT in the diff so the user knows they're unreviewed (offer to `git add -N` them in).

1b. **Flow / feature / ops scope resolution (`--code <flow #N | F# | O#>` ONLY — there is no diff; resolve the CODE SURFACE instead).**
   > 📁 **Moved, with the copy's edits, to [`references/code-review-and-slice-mode.md`](references/code-review-and-slice-mode.md) § Code Review Step 1b — resolver, LOC confirmation, slice panel, tracker stamp** — READ IT before executing this step.

1c. **Deterministic pre-gate — run BEFORE composing/launching the panel (guildhall-adopt 2026-07-05).** For the DIFF forms (`--code` / `--last N` / `--session` / bare — anything with a real code diff; SKIP for the whole-surface `<flow|F#|O#>` form, which has no fresh diff): run the cheap deterministic gates FIRST — `npx tsc --noEmit` + the diff-scoped unit tests + the `checks_union` from `node scripts/expert-checks.mjs resolve --diff <range> --json` (the experts whose `applies_when` globs match the diff → their owned deterministic gates). Read pass/fail **COUNTS**, never the exit code (tee exit-code — a piped runner's exit is the tail stage's). **If a gate is RED *and the red is NEW* (introduced by THIS diff — NOT pre-existing on the baseline `HEAD~`/`main`; a diff must not bounce on an inherited unrelated red — that's a process-level over-escalation; **heuristic: a red in a file THIS diff touched → NEW (bounce); a red in an untouched file → inherited (proceed, note it)**) → BOUNCE: report the failure + "fix the deterministic red before spending the panel," and dispatch NO agents.** Two guards: (a) a GREEN pre-gate never SKIPS the panel — deterministic-pass is a floor, not a substitute for the design/security lenses (layers are complementary); (b) on green, PASTE the gate output into every brief under `## Deterministic pre-gate (passed)` — a passed sentinel is load-bearing panel input. **Exception:** when the review's PURPOSE is diagnosing the red, skip the bounce. Rationale: don't burn an uncapped multi-expert panel on a diff that fails typecheck (panel/push cost).

2. **Auto-select the panel (UNCAPPED — relevance-driven, not a fixed number).**
   - **Advisory panel-resolver first (guildhall-adopt 2026-07-05):** run `node scripts/expert-checks.mjs resolve --diff <range>` — it reads each expert's `applies_when:` frontmatter and prints the experts whose globs match the changed paths + their owned `checks:`. Fold its SUGGESTION into the selection below; it is ADVISORY, never the decider (panel-sizing + blast-radius + skepticism-diversity judgment a glob-matcher can't see stays yours). Its `checks_union` is exactly what Step 1c's pre-gate runs. (`expert-checks.mjs orphans` lists the `checks: []` experts — a coverage-gap signal, not a blocker.)
   - **uncle-bob MANDATORY on any CODE review** — whenever the scope includes `src/**` or `tests/**`, uncle-bob is non-negotiable: the design/SOLID/named-smell/Tidy-First lens is domain-ORTHOGONAL, so it catches the structural smells a panel of domain experts does not (evidence: a self-vs-peer A/B, 2026-06-25 — the peer arm ran 5 domain lenses with NO uncle-bob and MISSED the redundant back-to-back `profiles` SELECT that the uncle-bob-bearing arm caught). uncle-bob is OPTIONAL only for a NON-code-only scope (messages/i18n-only, docs, `.claude/` config — there is no code structure to review). The old cap could squeeze uncle-bob off a code review when 5 domain lenses filled it; uncapping (below) + this mandate together guarantee he is always present on code.
   - **security-expert AUTO-ADDED** whenever any changed path touches a safety surface: auth, billing (`src/lib/billing/**`), uploads, share-token resolvers, `supabase/migrations/**`, `src/db/schema.ts`, RLS/column-ACL. Non-negotiable — never dropped to stay under the cap.
   - **Domain experts** from the existing **Routing Rules** table (above) keyed by changed path: `src/lib/billing/**` → saas-engineer + security-expert; `supabase/migrations/**` + `src/db/schema.ts` → saas-engineer; `src/components/**` + `*client.tsx` → frontend-developer + ux-design-pro (+accessibility-expert if interactive/dialog/form); `src/lib/ai/**` + `src/lib/ai/prompts/**` → prompt-engineer (+ai-vision-expert); `src/actions/**` + `src/services/**` → saas-engineer; `messages/**` → ux-copywriter (source-language strings; for the other locales, a general-purpose translation reviewer as in `/wrap` step 5d); `src/app/api/**` → security-expert + saas-engineer.
   - **Union — NO hard cap.** Combine + dedupe; hire EVERY lens a changed path genuinely warrants (uncle-bob-on-code + security-auto + the domain lenses). There is NO artificial ceiling — a cross-cutting diff that legitimately needs 6-8 distinct lenses hires them all. The old cap-5 silently TRUNCATED genuine coverage on a big diff AND could squeeze uncle-bob off a code review (the exact failure the mandate above closes). The relevance gate below is the real bound — not a fixed number.
   - **Relevance-driven, NOT number-driven (the real bound — uncapped ≠ always-max).** Hire what the changed paths NEED, never a quota: a 1-file CSS tweak is still uncle-bob + ux-design-pro (2), not a committee; a billing+auth+ui+i18n+migration+tests diff is 6-8 distinct lenses. Scale to the diff's actual distinct-lens surface; do NOT pad to a number, and do NOT truncate below it.

3. **Auto-load project rules (this is what makes it project-calibrated).** Read the `.claude/rules/*.md` whose `paths:` front-matter matches the changed paths (⚠️ read `globs:` until 2026-09-04 — the rules carry `paths:`, 7 of the 9 this copy ships; 0 carry `globs:`) (e.g., a route or layout diff loads `nextjs.md`; a unit-test diff loads `tests-unit.md`; a TypeScript diff loads `typescript.md`) — and NOT `active-recall.md`: its Hot Tier was PARKED by `paths:` scope on 2026-09-07 (the exhortation-cut experiment, read date 2026-09-21; an earlier commit edited this file 261 lines below and left this clause ordering a 59 KB band into every seat — ~357 KB per 6-seat panel on the dispatch plane the experiment measures). If the experiment reverts, this clause reverts with it. Inject the matched rule text into each expert's brief under a `## Project rules in scope` heading. **Also inject parallel-session context (Step 1b applied to `--code`'s self-contained Process):** run `python3 scripts/parallel-session-scan.py --hours 6` and paste its verbatim markdown into EVERY brief under `## Parallel session context (orchestrator-injected)` — inline the ACTUAL scan output, NEVER a `%PLACEHOLDER%` you intend to fill later (a forgotten placeholder ships a brief blind to peer overlap — observed 2026-06-22). Briefing template: "Review THIS diff against the injected project rules + your domain. Flag violations with `file:line`, severity (P0/P1/P2), and the violated rule/L# where applicable. Bias toward concrete defects in the changed lines, not whole-file redesigns. When the dispatch includes the owner DIRECTIVE this diff implements, ALSO return a `Scope: FULL | NARROWED-from-directive — <directed-vs-shipped reconcile>` line judged diff-vs-directive (adopted 2026-07-18, superpowers spec-compliance slice — the external-referent gate for the minimum-viable-scope class; an omitted `Scope:` on a directive-bearing brief = incomplete review). **REVIEW ONLY — surface every finding in your return; do NOT edit any file** (not even an obviously-correct one-liner: a reviewer that edits mutates the diff under review and can sweep peer/shared WIP — the orchestrator applies fixes via `/fix` after reading your verdicts, per Step 5)."

4. **Synthesis: `--lean`-style.** Quick verdicts table, NO contrarian, skip the completeness sweep. Each finding row: `file:line | severity | finding | violated rule/L# | suggested fix`. Group by file, then severity. End with a one-line per-expert verdict (APPROVED / changes-requested) — plus, whenever the review carried the originating owner directive, a synthesis-level `Scope: FULL | NARROWED-from-directive — <reconcile>` verdict (pass the directive into the briefs per Step 3; an unfilled Scope slot on a directive-bearing review is INCOMPLETE, not implicit-FULL).

5. **No auto-write to `todo.txt`** (deferrals → todo.txt). Findings live in the synthesis and the step 6 record only; owner promotes per finding. `--code --fix`-style auto-apply is deliberately NOT offered — apply via `/fix` after you've read the findings.

6. **Write the record.** On a commit review (every diff form but the bare one; the bare form reviews the uncommitted tree and leaves no record), write the verdict to `.claude/reviews/<full-commit-sha>.md`, one file per reviewed commit, and commit it — [`references/code-review-and-slice-mode.md`](references/code-review-and-slice-mode.md) § Code Review — the record a `--code` panel on a commit leaves. A session that returns the verdict in its reply alone leaves nothing for the migration review gate to read; two non-interactive runs on a fresh copy did exactly that (2026-10-21).

> 📁 **Moved, with the copy's edits, to [`references/code-review-and-slice-mode.md`](references/code-review-and-slice-mode.md) § Code Review — distinct from siblings, anti-scope, revisit** — READ IT before executing this step.

---

## Code-corpus slice mode

> 📁 **Moved, with the copy's edits, to [`references/code-review-and-slice-mode.md`](references/code-review-and-slice-mode.md) § Code-corpus slice mode — invocation, companion script, anti-scope, promotion trigger** — READ IT before executing this step.

---

## Synthesis Guidelines

When combining expert outputs:

1. **Group by topic, not by expert.** If 3 experts comment on the same issue, present it once with their combined perspective.
2. **Surface disagreements explicitly.** Don't average conflicting opinions — present both sides with reasoning so the user can decide.
3. **Prioritize actionability.** Every recommendation should have a clear next step.
4. **Flag confidence levels.** If an expert is uncertain, say so. If there's strong consensus (5+ experts agree), highlight it.
5. **Include a summary table** with expert name, verdict (APPROVED/ALTERNATIVE/REJECT), confidence level, and one-line rationale.
6. **End with a unified recommendation** — what should actually be done, based on the weight of evidence.
6b. **RETIRED for owner-facing output — the synthesis now carries each caveat in its own sentence rather than a trailing row.** Historical form: its 1-3 load-bearing state claims — a fix landed, a suite green, a measurement taken — each name the command whose output was pasted, or carry `unverified`; an expert's assertion relayed without orchestrator re-derivation is `unverified (relayed)`. (2026-08-17 output-trust panel; numbered 6b so later guideline cites stay stable.)
7. **Watch for phantom consensus — unanimous agreement is the most dangerous failure mode.** If ≥50% of experts give nearly identical APPROVED verdicts with similar reasoning AND none cite distinct evidence, append a **Correlation Notice** to the synthesis: "**⚠️ Correlation Notice — shared model bias risk.** N of M experts converged on similar verdicts with overlapping reasoning. This may reflect shared training data rather than independent validation; the contrarian's analysis is especially valuable here. **Recommended:** treat the verdict as one data point, not consensus." (Proportional gate replaces the prior absolute "4+" / "5+" thresholds — flat counts don't scale across panel sizes 7-12. Stronger framing per wan-huiyan adoption 2026-04-18 — they identify unanimity as "the most dangerous failure mode" rather than just a noise signal. Carve-out: when the converging experts come from independently-weighted domains — e.g., security + QA both flagging same line for different domain reasons — convergence is additive signal, not shared-bias; do NOT issue Correlation Notice.)
8. **Respect qualitative + quantitative parity.** When Priya Sharma (growth-analyst, data-first) and user-researcher (experiential) are on the same panel, weight both equally. The researcher provides experiential user research that Priya's metrics cannot capture. They answer different questions — don't let data-skepticism dismiss experiential insight.
9. **Deduplicate cross-wave findings.** When findings from earlier waves were passed as context to later waves, and a later expert re-confirms without adding new analysis, count it as corroboration, not a new finding. Only surface separately if the later expert adds materially different insight.
10. **Output quality gate.** Before synthesizing, scan each agent's text output for the literal string `### Verdict:`.
    - **If absent → the verdict was truncated at render.** The agent wrote the full structured block to its internal state, but only a memory-confirmation tail reached orchestrator context ("Memory persisted/updated. Final structured output above stands." + file-path footers are the common fragment shape). DO NOT synthesize around the gap — fragment-synthesis silently drops 30-70% of the expert's findings. **Correct action: re-launch the agent in the SAME turn** with a targeted "your structured verdict got truncated — re-emit in full per the Required Output Format" brief, optionally citing the agent's own `.claude/skills/{expert}/MEMORY.md` entry as context-recovery anchor so it can rebuild without re-reading the whole audit. Parallelizable across multiple truncated agents; ~3-5 min recovery cost vs 40%-finding-drop + round-trip rework cost of synthesizing around it.
    - **If present but response otherwise lacks required sections** (Confidence, Scope, Assessment, Recommendation, Trade-offs, Memory Update), flag it as "incomplete response" in the synthesis. Do not infer a verdict from unstructured prose.
    - Do NOT silently accept memory-tail fragments as "the expert spoke through their memory entry" — memory persists the decision log, but the synthesis-time verdict, trade-off analysis, and cross-expert-disagreement signal live only in the in-band output block. Evidence: a 2026-04-18 flow audit — 3 of 10 experts truncated; re-runs surfaced 2 blocking findings + 3 inter-expert disagreements invisible in fragment synthesis.
    - **Agent-claim drift check (agent-claim drift hook extension).** When an agent's verdict says "APPROVED — no changes needed" / "no file modifications" / "nothing staged" / similar zero-delta framing, DO NOT trust the self-report. Run `git diff --stat` scoped to the agent's ownership files (or `git status --short` if ownership list not available). If the diff shows edits, the agent's final summary drifted from its actual tool-call history — the edits ARE in the tree and must be synthesized. *(📁 the rest of this paragraph moved, with the copy's edits, to [`references/synthesis-notes.md`](references/synthesis-notes.md) § Guideline 10 agent-claim drift check — evidence — provenance only.)*
    - **Fan-out reconciliation contract (2026-06-14 — promoted into the always-loaded synthesis gate so it fires during every `/expert-review`, not just `/meta`).** When ANY programmatic fan-out launches N agents (a wave, a `parallel()`/`pipeline()`, a 7a/7a-ii verify batch), the synthesis MUST account for all N: `launched == returned + accounted-failed`. NEVER silently `.filter(Boolean)` a result array — a dropped / rate-limited / timed-out agent marks its OWNED surface **UNVERIFIED** via a loud, synthesis-blocking header (`⚠️ M of N agents did not return — verification INCOMPLETE for {scope}`), never silently absent. Track the DENOMINATOR: "0 findings because 0 agents reported" must read DIFFERENTLY from "0 findings, all N reported." This closes the worst audit failure mode ("looks clean, didn't check") — the exact `.filter(Boolean)` trap the 2026-06-13 dynamic-Workflow experiment hit (a false `reviewerCount: 10` digest hiding rate-limited agents). Same reconciliation shape as the `### Verdict:`-scan above, generalized to any fan-out.
11. **Completeness sweep (mandatory).** After grouping findings by topic, go back through each expert's raw output and count their individual findings. Sum across all experts must equal or exceed the synthesis total. If any finding from any expert is missing from the grouped synthesis, add it to a **"Single-expert findings"** section below the main table — these are lower-confidence but must not be silently dropped. This step exists because topic-grouping naturally favors multi-expert consensus and drops unique insights from individual experts (especially copy polish, legal compliance details, and infrastructure items).

11b. **Topic-grouped finding completeness check (mandatory before Wave A scope is locked).** Completeness sweep (11) verifies all findings ARE in the synthesis. 11b verifies all sub-items under each TOPIC-GROUPED finding get explicit ship-or-defer disposition in the Wave A scope. Required because topic-grouping (per Guideline 1 "group by topic, not by expert") naturally collapses multi-sub-item findings (e.g., F1+F2+F3 all about "bespoke error.tsx boundaries") into one row — and the orchestrator's natural reading bias is to ship F1 (the first/canonical sub-item) under the topic header, silently dropping siblings.

    **Procedure (≤30 sec):** for each `[CONVERGED → P\d]` or topic-grouped finding in the synthesis table (typical pattern: one row, multiple F#/Item N references in body), walk every sub-item ID enumerated under that row. For each, mark in the Scope Proposal:
    - **SHIP (Wave A)** — included in agent brief with explicit file ownership (cite the agent + scope)
    - **DEFER (wave N+1)** — explicitly deferred with concrete trigger condition (defer discipline)
    - **N/A** — already-shipped inline — cite commit hash

    **Fail mode:** a sub-item appears in the synthesis topic-row body but does NOT appear in EITHER the Wave A ship list OR the todo.txt defer block. This is silent-orphan — the orchestrator scoped the topic header but not every sub-item under it.

    > 📁 **Moved, with the copy's edits, to [`references/synthesis-notes.md`](references/synthesis-notes.md) § Guideline 11b — evidence and companion note** — provenance only.

    **Skip rule:** if synthesis has zero topic-grouped multi-sub-item findings (each finding is atomic — one F#/Item per row), 11b is N/A. Common in `--lean` and `--spot` modes.

12. **Deferral audit (mandatory).** After grouping findings by severity, list EVERY item flagged as deferred / monitor / post-launch / "hygiene" / "launch scale" / "pre-launch acceptable". For each, apply the 3-valid-reasons check: (a) blocked on dependency, (b) needs production data to design correctly, (c) large spec not yet designed. **Auto-fail labels:** "post-launch hygiene", "at launch scale", "acceptable pre-launch", "no revenue yet", "monitor after launch" — none map to valid reasons. Promote any deferral failing the check to P1/P2 in scope, or reword to cite a specific valid reason. **Re-scope trigger:** if ≥3 deferrals promote in this synthesis, OR rolling 3-audit defer-promotion rate exceeds 30%, the synthesis rushed — re-scope. (The prior per-synthesis "30% of N" gate was theater at small N — N=7 promotion rates flip from "pass" to "fail" on a single classification. Absolute count + rolling-aggregate is the discriminative form.) Evidence: meta lessons on premature tracker COMPLETE flips (2026-04-18). Pre-Synthesis Checklist covers this (see below).

12b. **Defer Gauntlet — mandatory rendered output artifact (2026-04-22, /observations recommendation).** The split-lens scope check gates in the Pre-Synthesis Checklist have existed since 2026-04-16 and still failed to prevent 50–89% defer-promotion rates across five flow and feature audits. Diagnosis (reinforcement counting class — "loaded but not firing at composition time"): the gates are checklist ticks, not visible artifacts, so they pencil-whip under output-generation pressure. Fix: render every candidate defer as a row in a gauntlet table the user can read, challenge, and audit BEFORE the synthesis's P0/P1/P2 findings table is written.

    **Required output section — emit BEFORE the findings severity table, not after:**

    ```
    ## Defer Gauntlet — candidate defers with gate outputs

    | # | Candidate (one-line) | Primary lens | 3-reason gate | LOC/files | Split-lens slice | Alternate path | Verdict |
    |---|---|---|---|---|---|---|---|
    | 1 | {finding summary} | {expert} | dep-blocked / needs-prod-data / large-spec / ✗ FAIL | {N LOC or N files} | {"none — all uncertain" OR specific slice} | {"n/a" OR "viable: {alt}"} | **SHIP** / **DEFER** |

    **Gauntlet exit criteria (fill EACH column or the defer fails by default):**
    - Column "3-reason gate": must name one of the three valid reasons verbatim; any soft label (`post-launch`, `launch scale`, `tech debt`, `design judgment`, `ship first week`, `monitor after`) = ✗ FAIL → verdict auto-flips to **SHIP**.
    - Column "LOC/files": numeric effort in lines-of-code OR file-count. Human-time units (hours/days/weeks) are banned. If <100 LOC or <3 files AND gate column is NOT dep-blocked → verdict auto-flips to **SHIP**.
    - Column "Split-lens slice": either `"none — all uncertain"` (genuine defer) OR a concrete ship-now slice with LOC estimate. If a slice is named, it MUST appear as P1/P2 in the findings table below; verdict=SHIP for slice + DEFER for the uncertain remainder.
    - Column "Alternate path": if gate column is `dep-blocked`, enumerate at least one alternate (GET polling, event-log aggregation, existing-column, sibling-table derivation). If viable → gate is NOT actually dep-blocked → auto-flip to SHIP.
    - Column "Verdict": **SHIP** or **DEFER** only — no "maybe", "TBD", or "pending validation" (the last is a 1-turn spot-consult, not a defer).
    - **Environment-premise check (2026-06-12):** before accepting any rationale citing logs / retention / caching / "next touch" / "needs prod data": (a) does the premise hold in the PRODUCTION environment (a hosting platform's server logs are usually ephemeral — "logs carry it" is usually false in prod; the analytics store and the database are the durable stores)? (b) is the stated trigger ALREADY MET by the current wave (e.g. "defer to next schema touch" when THIS wave touches the schema)? (c) for tests, do WE control the failure injection (then "needs prod data" is a conflation)? Any yes → auto-flip to SHIP. Evidence: one feature audit's defer shake flipped 5/6 on exactly these.
    ```

    **Counting rules for the re-scope trigger (Guideline 12):**
    - Count rows with Verdict=**SHIP** that entered the gauntlet as candidate defers. If ≥3 candidates flipped to SHIP in this synthesis → the synthesis rushed; re-run the gauntlet on P1/P2 findings too (hidden ship-now slices likely there as well).
    - The rolling 3-audit defer-promotion rate is the aggregate of SHIP-flips across the last 3 audits. Persist the count in the synthesis footer (`Gauntlet: {N} candidates → {S} ship / {D} defer; rolling 3-audit SHIP-flip rate: {R}%`) so the next audit's orchestrator can check without re-running history.

    > 📁 **Moved, with the copy's edits, to [`references/synthesis-notes.md`](references/synthesis-notes.md) § Guideline 12b — why it complements Guideline 12** — provenance only.

    **Exceptions:** `--spot` mode skips the gauntlet (single-question consults rarely produce durable defers). `--lean` mode renders a simplified gauntlet (drop Split-lens + Alternate-path columns; keep Candidate / Gate / Effort / Verdict). `full` + `--final-audit` render the full 7-column table.

    Evidence basis: /observations 2026-04-22 recommendation; meta lessons on reinforcement counting; aggregate defer-promotion rate ~56% across five audits pre-artifact.

13. **Manual-test append to `QA_TESTING_PLAN.md` (mandatory when qa-expert is on panel, manual tests → QA plan Part 7).** If the qa-expert skill was consulted as part of this review AND their output includes a `### MANUAL_TESTS_APPENDED_TO_QA_PLAN` section, the orchestrator MUST append those entries to `<repo-root>/QA_TESTING_PLAN.md` → Part 7 ("Added by /expert-review audits") as part of the synthesis deliverable. Format per qa-expert SKILL.md spec. Priority ordering in the QA doc: P0 (must pass before ANY user), P1 (must pass before the first rollout gate), P2 (must pass before the wider rollout gate after it). Applies to `full` + `--final-audit` review modes. Exempt: `--lean` (qa often not on lean panels), `--spot` (single-question consults don't yield durable test entries). Without this step, manual-test needs surface verbally then disappear — same pattern deferrals → todo.txt catches for deferrals. First application: this rule itself was codified 2026-04-15 following the QA doc becoming 2 weeks stale.

14. **Finding-level convergence severity promotion (v2.7.0; source attribution corrected 2026-10-05).** *Upstream support, re-verified at source 2026-09-19: alirezarezvani's `named-persona-adversarial-review/SKILL.md:89` ("Two personas **independently** finding the same issue promotes it one level", emphasis added). This heading credited a "wan-huiyan + alirezarezvani + triple convergence" until 2026-10-05, and two legs were wrong: wan-huiyan never promotes on convergence (its Phase 11 CAPS a consensus finding at P1, and Guideline 7 already carries that rule), and the alirezarezvani skill first cited, `adversarial-reviewer`, runs its personas sequentially with no independence language, so by upstream's own canon it is not convergence evidence.* When the SAME specific finding (not the verdict, but the individual issue) is independently raised by 2+ experts, mark it `[CONVERGED]` in the synthesis output and promote its severity by one step (P2 → P1, P1 → P0). This is finding-level, operating per-issue — DISTINCT from Guideline 7 (phantom consensus at verdict level, panel-wide). The two rules fire at different scales and sometimes in opposing directions: finding-level convergence on a specific issue is STRONG signal (multiple experts independently found the same concrete problem); verdict-level convergence on overall APPROVE is WEAK signal (possibly shared-training-data bias). Convergence criteria: (a) same root cause identified (paraphrase the underlying mechanism, not the surface symptom); (b) 2+ experts with genuinely independent domains (2 engineering-sub-discipline experts converging counts less than engineering + security + UX — orthogonal-domain carve-out applies; if all converging experts are in the same department, don't promote); (c) cited evidence is distinct per expert (the same file:line reached through DIFFERENT lenses counts; N citations of ONE artifact's lines — a direction, a brief, a pack component, a peer's finding — are ONE source and never promote: wan-huiyan Live-State Rule 3); **(d) the degenerate control** — before marking `[CONVERGED]`, check whether the brief, its mandated reading list or a banked return DELIVERED the claim to the agreeing seats: a claim every agreeing seat read from one source is ONE source however many seats repeat it (a review withdrew three claimed convergences this way on 2026-10-09 — two in one verdict, where a banked wave-0 candidate framed both legs and a banked claim was named in a seat's brief, and one in a re-test, where one row had been delivered by the contrarian's mandated reading; (d) is criterion (c)'s one-source sentence run as a procedure before the tag, not a new test), and the synthesis records the check's result beside the tag. Do NOT promote on "both said 'this seems off'" — requires cited specifics. Format in synthesis: `**[CONVERGED → P{N-1}]** {Finding summary} — flagged by {expert-A} ({reason-A}), {expert-B} ({reason-B}){, {expert-C} ({reason-C})}.` Example: `**[CONVERGED → P0]** {Payment path} lacks failure-case handling — flagged by saas-engineer (missing try/catch in {function}), security-expert ({abuse vector}), qa-expert (user charged with no rollback)`. *(📁 the rest of this paragraph moved, with the copy's edits, to [`references/synthesis-notes.md`](references/synthesis-notes.md) § Guideline 14 — evidence basis, the struck leg, and the deliberate divergence on criterion (c) — READ IT before executing this step.)*

14b. **Evidence-class labels (v2.8.2 — wan-huiyan 8-label epistemic system, partial adoption).** Every finding in synthesis output gets ONE evidence-class tag alongside severity. Orchestrator assigns at synthesis time based on how many experts raised it and with what evidence shape:
   - **`[CONVERGED]`** — 2+ experts independently cited the same root cause with distinct evidence per expert (see Guideline 14 above for full criteria). Already shipping. Strongest signal.
   - **`[SINGLE-SOURCE]`** — one expert only flagged; no independent confirmation. Use when the evidence is a file+line citation from one expert's domain. NOT a downgrade — many real bugs surface only from a single specialized lens (security-expert catching IDOR, legal-advisor catching compliance). Use alongside severity to inform user decision weight.
   - **`[DISPUTED]`** — 2+ experts disagreed (A says P0, B says ALTERNATIVE or REJECT on same finding). Triggers Step 7a Targeted Verification. DO NOT synthesize around a dispute without running verification.

   **Dispute option discipline:** When presenting DISPUTED-finding options to user for resolution, present **A vs B binary**. Don't pad with a contrived 3rd option like "ship both behind a flag" / "phase A then B" / "union of A+B" / "hybrid" / "gate via flag until data decides" — those are decision-avoidance disguised as thoroughness, and a filler middle reads as laziness rather than care. **Rule:** before emitting a 3rd option, self-check: "Is this a genuinely distinct architecture articulatable in ≤2 sentences without the filler modifiers above?" If yes, keep. If no, drop and present A vs B. Evidence: two disputes in one flow audit ("unconditional headline vs cohort-gated vs ship-both-behind-flag"; "user-pinned vs system-only vs BOTH"), each resolved to one side of the binary. Both contrived middles failed the articulation test.
   
   Format: `**[CONVERGED → P0]** ...`, `**[SINGLE-SOURCE P1]** ...`, `**[DISPUTED P?]** ...`. Evidence-class goes immediately after severity, separated by `/` from the [CONVERGED → PX] block when both fire. Helps user distinguish "3 experts agree, strong signal" from "one expert, specialized concern" from "experts disagree, here's the resolution."
   
   Don't pad — not every finding needs a label. `[SINGLE-SOURCE]` is the default and can be omitted when most findings are single-source (keep synthesis readable); use it to CALL OUT a finding worth highlighting as specialized-lens-only. Always explicit on `[CONVERGED]` + `[DISPUTED]`.

15. **Deferral persistence to `todo.txt` (mandatory, deferrals → todo.txt).** For every finding that SURVIVED the Guideline 12 check (legitimate defer, not promoted), the synthesis MUST write an entry to `todo.txt` — not just "mention in the P3/Deferred section" of the synthesis. Deferrals that live only in conversation context evaporate when the session closes. Applies to ALL review modes: `full`, `--lean`, `--final-audit`. (The `--spot` mode is exempt — single-question consults rarely produce durable deferrals.) Format per entry:
    ```
    ## {Flow/Feature/Topic} deferrals ({YYYY-MM-DD} audit)
    - [ ] {One-line action}
      Source: {audit} {expert} {finding ID or severity}.
      Risk: {what breaks or leaks if never built}.
      Blocked on: {one of the 3 valid reasons — dependency / prod data needed / large spec}.
      Ship-now slice: {grounded slice that CAN ship now, already promoted to P1/P2 | "none — all uncertain"}.  # mandatory field
      Revisit trigger: {concrete condition, date, or event — NOT "post-launch"}.
    ```
    Show the append inline in the synthesis output (as a proposed diff or code block) so the user can veto individual entries BEFORE commit. If the user opts out of writing any entry, record it as "orchestrator surfaced, user declined to persist — reason: {reason}" in the synthesis. Silent drop is not an option.

15b. **Verdict persistence to a durable artifact (mandatory, same turn the panel returns).** Guideline 15 persists DEFERRALS; the VERDICT itself has no rule and has been lost. Write `plans/<topic>-VERDICTS-<date>.md` (or append to the arc's plan doc) with, per lens: the seat's model + `subagent_type`, its verdict token, and its load-bearing citations — **then flip the tracker row that gates on it.** Until that write lands, a row carrying `trigger: "panel verdict lands"` actively asserts the opposite of the truth (measured 2026-08-06: a 6-lens verdict lived only in sub-agent output files for ~5h). ⛔ **Capture the SEAT at DISPATCH, not after** — `queue-operation` task-notifications carry NO agent-identifying metadata (`{'type': 'queue-operation'}` and nothing else), so a block recovered from the notification layer is unattributable by construction. Recovery method when it is already too late: match Agent `tool_use` ids to their `output_file` paths.

**Definitional disagreement is a RESULT, not a tie to break (2026-08-06).** When lenses disagree on what counts as an instance of X, a downstream count over X is not a measurement — it is the synthesizer's casting vote wearing a number. Measured: a discriminator requiring "purely-post descriptions" **excluded the entire measured population** and reported **zero**, on precisely the definitional point the panel had split on. **Report the disagreement and both counts, or measure under both definitions and show the interval.** Never resolve a definitional split by picking the side that matches your framing and then quoting the resulting figure as fact — the number carries the panel's authority and the choice carries none.

16. **Overall synthesis confidence + ⚠️ HUMAN REVIEW RECOMMENDED gate (mandatory, wan-huiyan adoption 2026-04-18).** End every synthesis with a `### Synthesis Confidence: High | Medium | Low` block.
    - **High** — strong evidence, ≥3 expert convergence on key items, no factual disputes (factual-claim verification catches none), no truncation re-runs, no skepticism imbalance.
    - **Medium** — solid but with caveats: 1-2 unresolved disputes that didn't change top-level verdict, OR partial truncation that was re-run, OR moderate skepticism imbalance.
    - **Low** → **MUST emit `⚠️ HUMAN REVIEW RECOMMENDED` block** listing the unresolved questions, the disagreements that synthesis arbitrated without strong evidence, and the specific decisions where user judgment is required (not just nice-to-have). This is wan-huiyan's "judge confidence gating" pattern (Phase 14: low-confidence verdicts get HUMAN REVIEW flag).
    - **Why mandatory:** prevents the orchestrator from imposing false-confidence synthesis on genuinely-uncertain inputs. Aligns with the rule that state inputs are verified before a recommendation — when the inputs are weak, the recommendation should explicitly flag that.
    - **Triggering conditions (one Low-trigger qualifies):** ≥3 truncation re-runs, ≥2 ALTERNATIVE verdicts on the same finding (debate-needed signal per wan-huiyan deferred adoption), ≥3 factual claims that orchestrator couldn't verify (factual-claim verification inconclusive), Correlation Notice fired AND no contrarian on panel.

17. **Skepticism diversity check (when N≥5 panel, wan-huiyan adoption 2026-04-18).** Before launching a panel of ≥5 experts, classify each by the `skepticism:` line in its SKILL.md front matter, which every shipping expert carries: **high** (designed to find problems) / **medium** (balanced, most domain experts) / **low** (designed to find what works or what to add). Read the line rather than a list here: the list this step carried until 2026-10-21 disagreed with the front matter for 9 experts.
    - **Healthy distribution for N=7-9 audit panels:** 3-5 HIGH + 3-5 MEDIUM + 0-2 LOW. **Warn if >80% HIGH** (over-skeptical → P0 inflation risk) **OR >60% LOW** (rubber-stamping risk).
    - When imbalanced, surface in the panel-launch step: "Panel currently 6/7 HIGH skepticism — consider swapping out one for a MEDIUM/LOW counterpart (e.g., add ux-copywriter to balance qa+security+legal) to prevent P0 inflation."
    - Per wan-huiyan: their model assigns calibrated skepticism 20-60% per reviewer per run. Ours uses static persona disposition + panel-composition check. Functionally equivalent at much lower per-run overhead.
    - **Carve-out:** final-audit panels intentionally weight HIGH (the point IS to find problems before launch). The diversity check still applies but the warning threshold is relaxed: warn at >90% HIGH for final-audit mode.

    **Ship-now slice field is non-optional (2026-04-18).** Evidence (one flow audit): 7 defers written with no visible split-lens output — a challenge to the first defer set off a cascade of 4/7 (57%) promotions. The split-lens scope check exists as a Pre-Synthesis checkbox but under output-generation pressure gets pencil-whipped. Making the answer a mandatory ROW FIELD forces the question to be answered on paper: either "none — all uncertain" (genuine defer, sized right) or a specific slice that must already appear as P1/P2 in the synthesis's main finding list. If you find yourself writing "none" on every row, that's the signal split-lens scope check was skipped — re-run split-lens per item. If a slice is listed but has no corresponding P1/P2 row, the synthesis is incomplete; add it.

18. **Post-synthesis grounding self-check (2026-06-14 — wan-huiyan Phase-14.5 analog, "audit the synthesizer"; 0 agents, unconditional).** After writing the synthesis, grep your OWN output for any P0/P1 finding NOT traceable to a specific expert's cited `file:line` (or an artifact you verified yourself). Tag each `[SYNTHESIS-INTRODUCED]` and either GROUND it (find the citation) or DROP it. In our model the orchestrator IS the judge, and nothing else audits the judge — a plausible finding the orchestrator *composed* but no expert actually grounded ships silently otherwise. Cheap. **Escalation:** if `[SYNTHESIS-INTRODUCED]` fires on ≥2 findings in one audit, that's a real synthesizer-drift signal — add the conditional Completeness Auditor (Final Audit Mode Step 1) to the next high-stakes audit.

### Pre-Synthesis Checklist (mandatory — run before writing the synthesis)

Before writing ANY synthesis output, verify each of these. If one fails, fix it before proceeding.

- [ ] **Quality gate:** Did every expert response include Verdict + Confidence + Scope + Assessment + Recommendation + Trade-offs + Memory Update? Flag any that didn't.
- [ ] **Phantom consensus:** Are ≥50% of experts giving near-identical APPROVED verdicts with similar reasoning AND no expert citing distinct evidence? If yes, explicitly note this in the synthesis and highlight the contrarian's counterargument as especially valuable. (Proportional rule — replaces prior absolute "4+" threshold which didn't scale across N=7-12 panels.)
- [ ] **Completeness count:** Count findings per expert (e.g., "security: 3, saas-engineer: 5, qa: 4 = 12 total"). Does the grouped synthesis contain all 12? If any are missing, add a "Single-expert findings" section.
- [ ] **Contrarian surfaced:** Did the Devil's Advocate finding get its own section or callout in the synthesis? It must not be buried in the grouped findings.
- [ ] **Implementation handoff:** Are there code-fixable findings? If yes, the `/agent-work` command block is MANDATORY — not optional, not "I can do it if you want." Generate it.
- [ ] **Deferral audit (per Guideline 12):** List every deferred/monitor/post-launch item. For each, cite one of 3 valid reasons (blocked / needs prod data / large spec). Auto-fail labels: "post-launch hygiene", "at launch scale", "acceptable pre-launch", "no revenue yet". If ≥3 deferrals promote in this synthesis (absolute count, scales across N=5-15 lists), re-scope the synthesis. (Small-N percentage gates are theater — 29% vs 43% on N=7 flips on a single classification, providing no real discrimination.)
- [ ] **Codified-policy verification (codified-policy verification gate).** For every proposed ship-scope option touching codified-policy domain (refund / pricing / retention / withdrawal / billing-policy / ToS / privacy / content safety / moderation / scoring / **design-spec / cohort-gate / drifter-gate / engagement-spec / milestone-celebration-spec**): grep `DECISIONS.md` + relevant `.claude/project-memory/project_*.md` + `src/app/[locale]/(public)/{terms,privacy}/page.tsx` + `src/types/index.ts` BEFORE drafting the option. Cite the codified position in synthesis. **If an option contradicts codified policy, surface the contradiction explicitly + REQUIRE user override — don't present it as a neutral option among equals.** **Scope extension:** the rule also fires on bidirectional defer-shake-up passes — when challenging ship-side items, codified-spec contradiction-grep applies (not just defer-side). *(📁 the rest of this paragraph moved, with the copy's edits, to [`references/synthesis-notes.md`](references/synthesis-notes.md) § Checklist: codified-policy verification — evidence — provenance only.)*

- [ ] **First-pass defer gate (default SHIP) — DEFAULT = SHIP, not DEFER.** The null hypothesis for every candidate finding is **SHIP**. To move a finding to DEFER requires affirmative evidence of one of 3 valid reasons (blocked on dependency / needs production data / large spec not yet designed). Silence / "feels like it could wait" / "post-launch vibe" = SHIP, not defer. Evidence for why inversion matters: across five flow and feature audits the aggregate defer-promotion rate after user pushback is ~56% — meaning the prior default of "defer unless proven ship-worthy" was miscalibrated by ~2×. Procedure per candidate finding:
  1. Assume SHIP. Ask: "What concrete evidence makes this a DEFER?"
  2. If the answer names one of the 3 valid reasons AND cites a specific blocker (vendor API name, production-data field required, feature-class spec not yet written) → DEFER is justified, write the row.
  3. If the answer is vague ("large spec", "tech debt", "design judgment", "ship first week", "at launch scale") → FAIL the gate, ship it.
  4. Stress-test each surviving defer: "if the user pushed back right now, can I name a concrete blocker in ≤10 seconds?" If no, promote.
  > 📁 **Moved, with the copy's edits, to [`references/synthesis-notes.md`](references/synthesis-notes.md) § Checklist: first-pass defer gate — distinction and evidence** — provenance only.
- [ ] **Defer-cost discipline (defer without LOC):** Every surviving defer row must include EFFORT in **lines-of-code** or **file-count** (NOT hours/days/weeks — those are human-consultant-LARP units per LARP markers). If estimate <100 LOC or <3 files, the defer label is wrong — either promote OR re-label using one of the 3 valid reasons (not "large spec" / "tech debt" / "design judgment" / "ship first week" as fig leaves). Vague scope-words without a count are rhetoric, not decisions. Evidence (one flow audit): "large-spec locale work" = 30 mechanical string edits; "tech debt" = 5 LOC; "design judgment" = 1 copy cell × 12 locales. All three promoted on concrete-cost check. **Ban list for human-time units in defer rows:** "~Nh", "N hours", "N days", "N weeks", "takes N min" — grep for these pre-synthesis; promote or re-unit.
- [ ] **Split-lens gate (split-lens scope check) + alternate-path enumeration (2026-04-18):** For every candidate defer row, BEFORE writing it, ask "if I reverse the lens — what's the SMALLEST grounded slice that could ship now, keeping only the uncertain/unspec'd part deferred?" The 3-valid-reasons test (default SHIP) catches "defer has no valid reason"; it does NOT catch "defer is valid for PART X but there's also a grounded ship-now slice Y." Procedure per candidate:
  1. State the defer candidate in one sentence.
  2. **Alternate-path enumeration (runs BEFORE step 3).** If the defer cites "blocked on X" where X is a vendor API/webhook field/signal/distribution data: enumerate ≥2 alternate paths to the same information. Common alternates: GET API polling, event-log aggregation, derivable from wall-clock + documented schedule/invariant, alternate webhook event, dashboard-cached state, existing DB column, computed from sibling tables. If any alternate is viable → X is NOT a blocker; either promote outright OR narrow the defer to "calibration/tuning of the grounded path" before step 3. If no viable alternate → proceed to step 3 with X as the genuine constraint.
  3. Answer: "What's the uncertain/unspec'd/data-dependent part?" (the genuine defer)
  4. Answer: "What's the grounded part — already specified, doesn't need prod data, <100 LOC — that could ship NOW?" (the hidden slice)
  5. If step 4 returns a real slice → split the row: add a new P1/P2 finding for the slice, keep the defer for step 3's remainder. Both documented separately.
  6. If step 4 returns "nothing — all uncertain" → the defer is legitimate; proceed.

  > 📁 **Moved, with the copy's edits, to [`references/synthesis-notes.md`](references/synthesis-notes.md) § Checklist: split-lens gate — evidence and why it is distinct** — provenance only.
- [ ] **Fact-vs-spirit separation (haines fact-corrected but missed spirit concern):** After factual-claim verification resolves a code-behavior dispute, separately ask whether the NON-factual concern still applies (UX consistency across surfaces / analytics signal loss / conversion leakage even without blocking / user-psychology pattern). Keep facts and spirit in separate rows in synthesis. A win on facts does NOT auto-resolve the spirit question. *(📁 the rest of this paragraph moved, with the copy's edits, to [`references/synthesis-notes.md`](references/synthesis-notes.md) § Checklist: fact-vs-spirit separation — evidence — provenance only.)*
- [ ] **Verdict-flip-under-pushback requires NEW evidence (v2.8.2 — orchestrator-level sycophancy gate).** If user pushback triggers a verdict or severity change in this synthesis round (e.g., "actually, promote" after "defer"), the flip MUST cite a specific piece of NEW evidence that wasn't in the original synthesis: a file+line not previously referenced, a new expert consulted mid-session, a new fact about code state, or an explicit acknowledgment that the prior synthesis missed a specified check. If no new evidence exists → ORIGINAL VERDICT HOLDS. Closes the skeptical defer re-pass pattern where ~50% of surviving defers promote under pushback without new evidence (wan-huiyan calls this orchestrator-level sycophancy — changing position without new grounds). This is not about refusing to update — it's about requiring the update to be grounded. If the user argues the synthesis was wrong, cite WHY it was wrong (evidence), not WHETHER (persistence). Applies to single-round + re-audit alike.
- [ ] **Schema-layer verification on persistence proposals.** Any finding proposing a new DB write (new column, new table, new enum value, new index, new unique constraint) MUST have saas-architect OR saas-engineer verdict before synthesis incorporates the finding. If neither expert was on the panel, spot-launch one for a factual feasibility check on the proposed schema change. Without this, CRO/domain-expert proposals carrying implicit schema assumptions may reach implementation and fail silently (migration polluting an unrelated enum, missing column filed into a JSONB bucket, constraint collision). *(📁 the rest of this paragraph moved, with the copy's edits, to [`references/synthesis-notes.md`](references/synthesis-notes.md) § Checklist: schema-layer verification — evidence — provenance only.)*
- [ ] **Alignment-claim verification (alignment claim grep):** For any finding that cites "aligns with pattern in fileZ" or "matches existing Y", grep fileZ for the named pattern BEFORE incorporating the claim into synthesis. If the pattern isn't there, the alignment claim is false — either reject the finding or restate its justification. ~10-sec verification cost prevents silent reversal of closed decisions. Evidence: a parallel session cited ITERATE_TIERS as aligning with a sibling component — `rg 'ITERATE_TIERS' src/` returned only the file being edited.
- [ ] **Factual-claim verification (factual-claim verification + assert the literal the code reads):** For every finding that cites a specific file+line OR named function/symbol OR claims "X does/doesn't do Y in file Z" OR **proposes an inline test assertion citing a literal value/copy/constant** ("expects X", "toContain Y", `.toBe(N)`), orchestrator reads or greps the cited location before including the claim in synthesis. Scope: code-behavior claims only, not opinion-level claims (e.g. "this copy is cold" doesn't need verification; "the cleanup job doesn't delete the row" does). When two experts disagree on code behavior, the code wins; reject or reword the losing finding before synthesis. **assert the literal the code reads extension — test-assertion proposals require grep-verifying:** (a) literal exists in production source, (b) value is current (matches PLAN_LIMITS / DECISIONS / config — not stale), (c) cited function/path is LIVE (not dead code retained behind a cut-over). Locking in stale-copy assertions creates regression vectors that block legitimate future updates. Cost: ~1-2 min per panel; prevents propagating false/stale findings to implementation. *(📁 the rest of this paragraph moved, with the copy's edits, to [`references/synthesis-notes.md`](references/synthesis-notes.md) § Checklist: factual-claim verification — evidence — provenance only.)*
- [ ] **Deferral persistence plan (deferrals → todo.txt):** After the Deferral audit promotes/keeps items, draft the `todo.txt` append block NOW — don't defer it to post-synthesis. For every surviving deferral, write the 4-field entry (source / risk / blocked-on / revisit trigger). Drafting during the checklist forces you to confirm each has a CONCRETE trigger before shipping the synthesis — items without a concrete trigger either get one or get promoted back into scope. The append block goes into the synthesis output as a proposed diff the user can veto entry-by-entry. Without this gate, "surviving deferral" means "mentioned then lost."

---

## Scope Confirmation Gate (mandatory pre-handoff for `full` + `--final-audit` modes)

**STOP between synthesis presentation and action-artifact generation.** This gate prevents the pipeline defect where `/agent-work` + `todo.txt` + Memory Update writes all fire pre-agreement, then get rewritten on user pushback. Evidence: defer-promotion-after-pushback hits ~60% across three audits (57%, ~60%, 62.5%). Pre-gate, the cost of every one of those audits is a rewrite turn + a correction-block in todo.txt that future sessions have to reconcile.

**Procedure:**

1. **Synthesize + present** — findings grouped by topic, disputes flagged, defers listed, confidence assigned. Normal synthesis output. **Memory Update writes are safe to fire here** (they're per-expert verdict-level, stable pre-agreement — sub-agent MEMORY blocks orchestrator-side persistence still applies).

2. **Propose scope, don't commit it.** End the synthesis with a dedicated **Scope Proposal** section:
   ```
   ## Scope Proposal — confirm before I write artifacts

   **Ship-now (N items):** bulleted list of action-plan items 1..N with LOC / owner
   **Defer (M items):** bulleted list of surviving defers with the 4-field rationale
   **Disputes needing you (K items):** per-dispute, one-sentence question ("Day-60 KILL vs WIRE?", "Code fix or policy-text change only?")

   Confirm or push back on any ship/defer/dispute decision. On confirmation, I'll write `/agent-work` + `todo.txt` + any remaining MEMORY deltas in ONE canonical pass.
   ```

   **2a. Cross-session scope-overlap gate — TIERED BLOCK/WARN (MANDATORY in `full` + `--final-audit`).** Before presenting the Scope Proposal to the owner, run:

   ```bash
   python3 scripts/session-manifest.py check-overlap <file1> <file2> ...
   ```

   Pass every file path the ship-now scope would touch (extracted from the action-plan items). The script reads peer manifests and classifies each overlapping file into a **BLOCK tier** (code/migration — `src/`, `supabase/migrations/`, `tests/`, `scripts/`, config: concurrent line-level edits clobber silently) or a **WARN tier** (coordination/append files — `BACKLOG.md`, `DECISIONS.md`, `todo.txt`, `*/MEMORY.md`, `.claude/project-memory/*.md`, `messages/*.json`: benign section-appends). **Behavior — TIERED BLOCK-mode (promoted 2026-05-30 after 6 fires / 5 distinct sessions / 0 hard-FP):**
   - **BLOCK-tier overlap** → prints `## ⛔ Scope overlap check (BLOCK MODE — code/migration overlap, halting)` and **exits 2. You MUST HALT — do NOT present the Scope Proposal.** Either coordinate with the named peer session first, OR re-run with `python3 scripts/session-manifest.py check-overlap <files> --allow-overlap` after confirming the edits target different regions of the file (override downgrades to WARN + exit 0). The `--allow-overlap` decision is owner-facing — surface the ⛔ banner and ask before overriding.
   - **WARN-tier-only overlap** → prints `## ⚠️ Scope overlap check (WARN MODE — informational, not blocking)` and exits 0. Owner overrides freely (warn-before-block discipline — warn-mode discipline for the benign-append class).
   - **No overlap** → prints `✓ no overlap with peer sessions` (exit 0). Still include so the owner sees the explicit check ran.

   **Include the script output verbatim above the Scope Proposal block in your synthesis.** Every non-empty result is logged to `.claude/logs/scope-overlap-fires.jsonl` (count with `wc -l`; demote back toward WARN if BLOCK-tier false-positive rate climbs). **Manifest write at scope emission:** also run `python3 scripts/session-manifest.py write` so peer `/expert-review` runs see this session's current scope decisions when they fire their own scope-overlap check.

3. **STOP.** Do NOT write `/agent-work` command. Do NOT append to `todo.txt`. Do NOT write Memory Update deltas that depend on ship-vs-defer split (rare — most Memory Updates are verdict-level, persist in step 1).

4. **User response → execute.** Three possible signals:
   - **"Confirm / looks good / proceed"** → write all 3 artifacts in one turn.
   - **"Promote X to ship / defer Y / KILL Z"** → fold changes into final scope, write all 3 artifacts with the confirmed scope.
   - **"Push back on N"** → short back-and-forth, converge, then write artifacts.

5. **Post-agreement write order:**
   1. `todo.txt` append with final defer list (4-field format).
   2. `/agent-work` command draft with final ship-now scope (includes "Already shipped inline" + "Deferred — do NOT ship in this wave" blocks).
   3. Any ship-vs-defer-dependent Memory Update deltas (orchestrator-side, per sub-agent MEMORY blocks).

**Modes — when the gate fires:**
- `full` mode → gate fires. Artifact-generation cost justifies the round-trip.
- `--final-audit` mode → gate fires. Same.
- `--lean` mode → **skip the gate**. Lean defaults are small scope + user can inline-audit.
- `--spot` mode → no gate (no action plan generated).

**Cost of the gate:** 1 user round-trip.
**Cost of skipping:** ~60% of audits rewrite `/agent-work` + add a correction block to `todo.txt`. One flow audit (2026-04-20) was the Nth recurrence.

**Principle:** write artifacts exactly ONCE, post-agreement. Generating deliverables pre-agreement is the same class of failure as generating /agent-work sub-agent prompts without reading target files — draft-first-verify-later inverts the cost curve.

---

## Implementation Handoff

After the Scope Confirmation Gate confirms scope (or immediately in `--lean` mode), if findings require code changes (not just policy/process recommendations):

1. **Identify affected files** from all findings — list each file and which finding touches it
2. **Group into 1-5 non-overlapping agents** by file area. No two agents may own the same file. Use the same partitioning strategies as `/agent-work` (by layer, domain, or concern).
3. **Generate a ready-to-use `/agent-work` command** with:
   - Full task description referencing the prioritized findings
   - Explicit agent grouping with file ownership rationale — each agent's edit-scope ALSO as a machine-readable **`[scope-owns]: path1, path2, …`** marker line (so the partition is captured in the dispatching session's jsonl for `session-manifest.py whose-edit` attribution; see `/agent-work` Step 4). Wired 2026-06-19.
   - Instruction to include tests for each agent's fixes
4. **Present the command** in a code block the user can copy-paste
5. **Ask:** "Ready to implement? Paste the command above, or adjust the grouping first."
6. **Persist surviving deferrals to `todo.txt` (mandatory, deferrals → todo.txt).** Draft the append block in the synthesis output — one entry per legitimate deferral from Guideline 12, using the 4-field format (source / risk / blocked-on / revisit trigger). Group under a single `## {Flow/Feature/Topic} deferrals ({YYYY-MM-DD} audit)` header. The block is a proposed diff the user can veto entry-by-entry BEFORE you run `Write` / `Edit` on `todo.txt`. If the user approves the block, append it immediately (same response — don't defer the write to "later"). If the user declines a specific entry, record the rejection reason inline in the synthesis. Silent drop of a surviving deferral is a policy violation.
7. **Enumerate already-shipped inline fixes (ANY audit mode — initial full OR `--final-audit`).** ⛔ **A PANEL SEAT DOES NOT APPLY FIXES.** Every agent a review dispatches is read-only, panel seats included; this replaces the earlier rule that a seat meeting a small change (under ~15 lines) should make it in place rather than skip it. Every dispatch from this skill carries the REVIEW ONLY line from `references/expert-prompt-template.md`: the seat returns the fix as an exact PATCH in its verdict — path, exact old→new text, and the covering test — and **the orchestrator applies it**. `/agent-work` and `/fix` BUILDERS are untouched. Grounds are review integrity (a seat that edits what it evaluates certifies its own edit) and shared-tree attribution, NOT token cost — do not restate a cost rationale. **This is not a licence to defer:** the generated posture rule 4 in every expert definition (`scripts/generate-expert-agents.mjs`) forbids filing a small correctness fix as a finding-for-later — its former carriers (Band-U, `behavioral-anti-patterns.md` #3/#8) were PARKED by `paths:` scope on 2026-09-07 and are not delivered to a panel seat, and a fully specified patch handed to the seat that owns the tree is the same fix, not a deferral. **The DISPOSITION rule below survives untouched and is the load-bearing half.** The extraction minimum-viable discipline still bounds any patch — the violating line ONLY; anything >trivial / logic-touching / multi-file is a finding routed through `/agent-work`. If a seat edits anyway and reports it, it marks verdict `APPROVED + FIXED` and the ONLY requirement is report-back — do NOT revert a correct, reported inline edit citing "initial-audit = no code" (over-applies discipline). The two most expensive instances in the corpus were exactly such reverts. Those changes are ALREADY in the working tree when the handoff generates. The `/agent-work` command block MUST include an "Already shipped inline (do NOT re-apply)" section listing every file+key/line touched during the audit, plus the instruction "read current tree state before editing." Without this, downstream agents may re-apply (double-edit, merge conflict on same line) OR cite the item as still-to-ship (false tracker drift). Same surface-to-persistence pattern as deferrals → todo.txt + manual tests → QA plan Part 7: the third persistence surface is "what I already fixed inline" → agent briefs. Cost: ~30 sec to enumerate. Cost of skip: merge-conflicts or duplicate-edit rework in the downstream wave. Evidence (one final audit): ux-copywriter applied 2 inline fixes to the locale bundle (an em-dash and a copy rewrite); handoff explicitly noted them so a later agent wouldn't clobber.

8. **Post-implementation deferral re-evaluation (MANDATORY after `/agent-work` waves complete).** Deferrals written pre-implementation may cite dependencies that the same session's agents resolve. Before the final audit closes / `/audit-check` runs, scan the surviving deferral list (from Step 6's `todo.txt` append block) for every row citing "blocked on {X}" or "depends on {X}". For each:
   - Check git log since the synthesis was written: `git log --oneline --since="<synthesis-timestamp>"` OR read the most-recent commit bodies
   - If X shipped in this session's commits, AUTO-PROMOTE: surface to user with 1-line re-evaluation ("X shipped in commit Y — defer reason is stale, promote?")
   - If X is still genuinely pending, the defer holds

   > 📁 **Moved, with the copy's edits, to [`references/handoff-final-audit-anti-scope.md`](references/handoff-final-audit-anti-scope.md) § Implementation Handoff Step 8 — the gap and its evidence** — provenance only.

If some findings are deferred (blocked on dependencies), exclude them from the `/agent-work` command — they still go into `todo.txt` per step 6.

---

## Final Audit Mode

When running final audits (verification that previously-implemented fixes are correct), append `/expert-review --final-audit <flow or feature>` or just indicate "final audit" in the topic.

### Step 0: Build the Finding Checklist (MANDATORY — before launching any expert)

Before writing any expert prompts, the orchestrator MUST build an explicit finding-by-finding checklist from the original audit:

1. **Extract all original findings** from these sources (check all of them):
   - Expert MEMORY.md files — search for the feature number (e.g., "F1", "F3") in each expert's memory
   - Test files — search for finding tags (e.g., `P0-1`, `P1-3`) in `tests/` directory via `grep -r "P[0-3]-" tests/ | grep -i "<feature-name>"`
   - Code comments — search source files for finding tags: `grep -r "P[0-3]-\|F[0-9]" src/ --include="*.ts" --include="*.tsx" | grep -i "<feature-name>"`
   - Feature tracker entry in `project_feature_audits.md` — the summary line lists finding counts
   - Any plan files in `plans/` referencing the feature

2. **Format as an explicit checklist** with one line per finding:
   ```
   Original Findings for F3 <feature>:
   - [ ] P0-1: <finding summary> (<file>)
   - [ ] P0-2: <finding summary> (<file>)
   - [ ] P0-3: <finding summary> (<file>)
   - [ ] P1-1: <finding summary> (<related flow>)
   ... (every finding)
   ```

3. **Include this checklist in EVERY expert prompt** so each expert can check findings in their scope against the list. The QA expert gets the full list.

4. **Track in synthesis** — the final synthesis must show the checklist with each finding marked VERIFIED / ISSUE / NOT CHECKED. Any NOT CHECKED items are flagged as incomplete audit.

### Step 1: Final audit differences from regular review

1. **QA expert is mandatory** in every final audit panel, regardless of routing rules. QA identifies integration and e2e test gaps.
2. **Agents may propose trivial code fixes** (< 5 changed lines) during the review, as a patch the orchestrator applies: a seat is review only (Implementation Handoff step 7). Examples: missing aria-label, typo in translation, off-by-one in a guard, missing null check. If a fix is more than ~5 lines or touches logic/data flow, it becomes a finding — not a patch.
3. **CONFLICT verdict.** If an agent finds that another agent (or a prior session) already changed the same code their patch would touch, they MUST use the CONFLICT verdict instead of proposing the patch. Report: what their patch would have changed, what they found already changed, and why they deferred. The orchestrator resolves conflicts after synthesis.
4. **File ownership awareness.** Each expert prompt in final audit mode should include: "Other experts in this panel may be reviewing adjacent files. If you see recent uncommitted changes in a file your patch would touch, do NOT propose a patch over them — use CONFLICT verdict instead."
5. **Panel sizing for final audits:** Use the **Panel Size Estimation** checklist from the main Panel Sizing section — count sub-systems, concern dimensions, and anchor against the original audit's panel size. The final audit panel should be **at least as large as the original audit panel** (you're verifying everything they found, plus checking for regressions). Quick reference floor:
   - Simple features/flows (single sub-system, <5 original findings): 5-7 experts
   - Core features/flows (1-2 sub-systems, 5-15 original findings): 7-10 experts
   - Complex features/flows (2+ sub-systems or cross-cutting, 15+ findings): 10-15 experts
6. **Output includes test gaps.** QA expert's assessment MUST list: (a) existing test coverage gaps found, (b) specific integration/e2e tests that should be added, (c) edge cases not covered by current tests.
7. **Final audit verdict options:**
   - `APPROVED` — fixes are correct, no issues found
   - `APPROVED + FIXED` — fixes are correct AND this seat edited a file. ⛔ **NOT the expected path since 2026-09-04** (Implementation Handoff step 7): a panel seat is REVIEW ONLY and returns a patch for the orchestrator to apply. This verdict survives for the case where a seat edits anyway — it must still be REPORTED, never silent, and a correct reported edit is KEPT, not reverted.
   - `ALTERNATIVE` — fixes work but could be improved (include specific suggestion)
   - `REJECT` — a fix is incorrect or incomplete (include what's wrong)
   - `CONFLICT` — the area you would have patched has already moved under you (another agent or a prior session changed it). Report what you would have changed and what you found instead; the orchestrator resolves it.
8. **Conditional Completeness Auditor (high-stakes `--final-audit` only, 2026-06-14 — wan-huiyan Phase-8 analog; the *no-lead* complement to Step 7a-ii's *lead-seeded* deep-probe).** For final-audits over revenue / legal / top-tier / safety surfaces, fire ONE fresh-context agent that re-reads the SOURCE independently (NOT the panel's outputs) and answers a single question: "what material defect did the panel MISS?" — return `file:line` or "nothing material." This catches the *no-lead* classes 7a-ii is structurally blind to: an unflagged omission, and a sibling the panel never examines. Calibrated-abstention brief (manufacture nothing; do NOT re-litigate settled verdicts); builder≠breaker. SC-3 demote to an orchestrator-inline source-trace if it returns "nothing material" on 3 consecutive final-audits. Auto-escalated when Guideline 18 tags ≥2 `[SYNTHESIS-INTRODUCED]` findings.

### Step 2: Test Coverage Gate (MANDATORY — before marking COMPLETE)

A feature final audit is NOT complete until:

- [ ] Every original P0/P1 finding has at least one **behavioral** test (invoke the function, assert on output — not source-grep)
- [ ] Critical paths identified by QA expert have **integration tests** (real Docker DB)
- [ ] User-facing flows have at least basic **e2e tests** (Playwright) covering the happy path
- [ ] All tests pass: `npx vitest run` + `npm run test:integration`

If the QA expert identifies N test gaps and zero are addressed, the feature CANNOT be marked COMPLETE. Address at least the P0 test gaps before closing.

### Step 2b: Fix-Wave Diff Review (`--code` on the wave commit — threshold-gated, BEFORE /audit-check)

**When:** the post-synthesis fix wave (`/agent-work` + orchestrator integration pass) produced commit(s) totalling **≥10 files OR ≥250 changed LOC under `src/` OR ≥80 changed LOC in ANY SINGLE `src/` file OR touched codified-policy/legal copy** (ToS/Privacy/statute-cites/PRICING/refund/withdrawal/content-safety/moderation) regardless of LOC (test-only files excluded from the size counts). **These thresholds are a MANDATORY-BY-SIZE FLOOR (above any → builder≠breaker `--code` is non-negotiable), NOT a "below → skip" ceiling.** Below ALL triggers, skip the formal `--code` ONLY when the wave is GENUINELY TRIVIAL — mechanical, with no logic / security / privacy / auth / shared-helper / cross-surface / shared-state implication — in which case the orchestrator integration pass suffices. A *small* wave that touches a risk surface (e.g. a 5-LOC change to a security/privacy resolver, an auth gate, a shared helper, or a query) STILL gets reviewed: LOC is a proxy for EFFORT, not blast-radius, and trivial-SCOPED changes balloon at implementation. Default leans review; all code goes to the review hub.

> 📁 **Moved, with the copy's edits, to [`references/handoff-final-audit-anti-scope.md`](references/handoff-final-audit-anti-scope.md) § Step 2b — why the single-file trigger is load-bearing** — READ IT before executing this step.

**What:** run `/expert-review --code <wave-commit(s)>` on the integrated diff. Panel per normal `--code` auto-selection (uncapped, Process step 2) with one HARD constraint: **builder≠breaker — exclude every expert lens that AUTHORED wave code** (a wave Agent run as prompt-engineer excludes prompt-engineer from the review; substitute the domain companion — ai-vision-expert for prompts, saas-architect for saas-engineer surfaces, ux-design-pro for frontend-developer surfaces). Reviewers' MEMORY may contain their own same-day audit entries — brief them to treat those as context, not verification (re-derive from the diff).

> 📁 **Moved, with the copy's edits, to [`references/handoff-final-audit-anti-scope.md`](references/handoff-final-audit-anti-scope.md) § Step 2b — why the fixes get a fresh-diff review** — provenance only.

**Sequencing:** run BEFORE `/audit-check` so review fixes fold into the same gate run (one audit ran it after → second fix commit + re-verification round). Findings follow normal `--code` discipline: small fixes apply inline same-session; no auto-todo writes; `/audit-check` Check 13 (full mode) then verifies this step ran.

**Revisit (SC-3):** N=2 evidence basis (two wave reviews). If 3 consecutive threshold-met wave-reviews surface zero P1s, demote this step to optional and note the demotion here.

### Step 3: Audit Quality Check (MANDATORY — before marking COMPLETE)

After fixes are implemented and tests are written, run `/audit-check F{N}` before changing status to COMPLETE. This catches patterns that expert panels miss, among them:
- Lazy deferrals (trivial fixes labeled "post-launch")
- Source-grep tests disguised as behavioral coverage
- Fixes claimed as implemented but missing from code
- "Acceptable" labels on items that need real tests
- Stale expert memory entries
- Tracker inaccuracies

**This is not optional.** The feature status CANNOT change to COMPLETE until `/audit-check` passes every check. See `.claude/skills/audit-check/SKILL.md` for the full process.

## Anti-scope

> 📁 **Moved, with the copy's edits, to [`references/handoff-final-audit-anti-scope.md`](references/handoff-final-audit-anti-scope.md) § Anti-scope — the deliberately excluded patterns** — READ IT before executing this step.
