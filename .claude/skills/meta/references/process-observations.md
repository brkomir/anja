Merged from the `/observations` skill during a pass over rarely-used commands (0 invocations in the 30 days before). Invoked as `/meta observations`; the text below is the former `SKILL.md` body verbatim, except its When-to-Use line, which names `/meta observations`.

# Observations — Human-Curated Weak-Spot Report

Produces a **narrative report** on recurring patterns, weak spots, and what to do about them. This is NOT a dashboard, NOT a dump of L#/F#/Flow# codes. It's a curated read from Claude's perspective, for the founder, with concrete actions.

Output is an inline chat response — NO file is written.

## When to Use

- User types `/meta observations` (or the stub name `/observations`)
- User asks "where are we tripping up?" / "what's recurring?" / "what should I fix in the system?"
- Before major meta-system edits — to orient on what actually bites vs. what's theoretical
- Periodically (every ~2 weeks) as a system-health read

## Core design principles (the thing that went wrong in earlier versions)

Previous versions of this report were data-dense log dumps with internal references (a bare lesson number, P1-15, Flow #11, F14). The user couldn't decode them without running `/flows` or `/features`. That's failed curation.

**The rewrite rules:**

1. **Translate every internal code on first use.** Never say "Flow #45" without "(Dunning — the failed-payment retry UX flow)" immediately after. Never say a bare lesson number without its rule in words ("don't `git add -A` during parallel sessions"). Never say "F14" without "(Comparison + Curation AI pipelines)". If you cite a code, you owe an immediate gloss.

2. **Synthesize themes, don't enumerate lessons.** Instead of listing 11 user-pushback events, name the 2-3 underlying shapes and describe them in prose. Use specific examples as evidence, not as the primary output.

3. **Every observation has an attached lever.** If you name a weak spot, say what could fix it — a hook, a rule, a habit, a tool, a heads-up to the user. No observation ships without an action.

4. **Rank by actionability, not by frequency.** A pattern that fires 50× but has no obvious fix is less valuable than one that fires 10× and has a clear 20-line hook that closes it.

5. **Include "invisible wins."** Spend one section on what the system catches that the user wouldn't see without it. Reports that are all-complaints are demoralizing and miss half the story.

6. **Memory hygiene in plain English.** Not "saas-engineer 750 lines WARN." Instead: "the saas-engineer memory is getting crowded but not urgent — it's at 750 lines, a quarter of the way to the 3000-line alarm cap." **Do NOT recommend `/meta distill` unless a file is ≥2700 lines** (within ~300 of the URGENT threshold). WARN range (600–2700) is informational only; files there are expected and do not warrant a "distill next" action label (a standing preference, after successive cap raises: distill only once a file is close to the URGENT cap — distillation has deletion risk + real session-time cost, amortize by letting content accumulate; the cap was raised again after observing that post-distill re-accrual hits URGENT within 1-2 weeks at high velocity).

7. **Voice is allowed.** Write like a senior colleague summarizing their week, not a log parser. First person is fine ("I keep breaking this rule"). Express concern or confidence where warranted.

8. **End with 3-5 concrete recommendations, ranked.** Each has: what to do, how much effort, what it closes.

## Instructions

1. **Read sources** (all read-only):
   - `.claude/skills/meta/MEMORY*.md` — lessons, open gaps, user-pushback history, reinforcement blocks. ⛔ **THE GLOB, not the router: bodies live in `MEMORY-ARCHIVE-*.md` shards beside it, so a router-alone grep reads a clean ZERO for a live lesson.**
   - `.claude/skills/meta/RULES*.md` — trigger→action clusters. Same two-tier split since 2026-09-04: rows live in `RULES-SHARD-*.md`.
   - `.claude/skills/*/MEMORY.md` line counts
   - `.claude/project-memory/project_critical_flows*.md` — flow # → name mapping. ⛔ **THE GLOB, not the router: rows live in `-SHARD-*.md` files and a router-alone grep reads a clean zero for a flow that exists.**
   - `~/.claude/projects/<project-key>/memory/project_feature_audits.md` — F# → name mapping (grep the table headers only)

2. **Build the translation dictionary.** Before writing any section, have `{flow# → name, F# → name, L# → one-line rule gloss}` handy. Every code that appears in the output must pass through this dictionary.

   **Status-count discipline.** When the report quotes counts from any tracker (e.g., "31 flows COMPLETE", "22 features pending"), count the Status column DIRECTLY from the tracker file — do NOT quote the summary line in `MEMORY.md` (`- [Critical flows tracker](project_critical_flows.md) — N flows: ...`). Those pointer-line counts are written-once and silently rot when tracker rows transition. **RUN the executable, never an awk:** `node scripts/tracker-list.mjs <flows|features|ops> --counts`. ⛔ **An awk stood here until 2026-09-09 carrying ALL THREE defects of that family at once** — a fixed `$4` (not the Status column in every row layout), a bare `<tracker>` placeholder (unresolvable, so it emitted nothing with no error), and no shard glob (0 rows against a router). It survived a sweep that named this file, because the sibling line 20 lines below was fixed and this one was not. The executable is shard-aware, resolves the status column by NAME per table, and exits `rc=1` naming the offending row ids.

3. **Extract real counts.** Before any metric appears in the report, grep the source files to back it. Required measurements:
   - **Rule-violation counts:** for each reinforced rule, grep MEMORY.md for `**Reinforcement` blocks mentioning `L{N}` — each reinforcement block = N post-codification instances. Sum them.
   - **Defer-promotion ratios:** grep MEMORY.md for "promotion rate", "promoted back", "of N defers", or specific "X/Y" patterns in lesson bodies. Pull concrete ratios from each audit (<row name>, <row name>, etc.).
   - **User-pushback incidents:** `grep -c -iE 'user (pushback|caught|pushed back|asked|prompted|surfaced|flagged)' .claude/skills/meta/MEMORY*.md` (**the glob — the router alone reads ~0**) — this is an over-count (same incident may trigger multiple mentions), so round down and caveat as "mentioned in N lessons."
   - **Re-audit-finds-more ratio:** extract actual "re-audit found N new P0/P1/P2" numbers from the re-audit lessons.
   - **Agent self-report drift instances:** grep for "agent claimed" / "agent reported" / "git diff showed" / "agent summary" in lesson bodies.
   - **Memory file line counts:** `wc -l` on every skill MEMORY.md.
   **No invented numbers.** If a count isn't grep-able, either leave it out or label it explicitly as an estimate ("~5, estimated from scan").

4. **Identify themes, not data points.** Ask:
   - What are the 2-3 shapes underneath recurring failures? (e.g., "permissive first-pass synthesis" subsumes the four defer-sweep lessons; don't list four lessons, describe the one shape).
   - What's newly emerging this month that isn't yet codified?
   - What did I (Claude) get wrong recently where the user had to correct me?
   - What fixed things stayed fixed? (Signal that the countermeasure worked.)
   - What keeps breaking despite being codified? (Signal that the codification isn't the fix.)

4b. **Verify-codification grep BEFORE claiming a "codified but not enforced" gap.** For every theme or recommendation that asserts "X codified but not enforced" / "L# in MEMORY but no skill-spec entry" / "lever exists but unwired" / "rule but not in spec", run `grep -nE "L<N>\|<keyword-from-codification>" .claude/skills/*/SKILL.md .claude/rules/*.md` BEFORE writing the claim. If the codification surfaces in a target spec → either delete the claim OR reword to "shipped (cite file:line + date), monitor for drift." Cost: ~30 sec per claim × ~5 claims per report = 2-3 min total. Failure mode (2026-05-20): two of /observations' recommendations (the defer gauntlet and an `/agent-work` step) were already shipped — MEMORY-only scan missed it because the codified spec edit lives in SKILL.md, not MEMORY.md. 50% false-positive rate eroded report credibility. This step is the cause-fix; the existing "Pretending you read something you haven't" anti-pattern is the symptom-fix.

5. **Draft the report in the structure below.** Every theme section that has countable instances gets a mini-metrics row inline. The top-of-report "By the numbers" table is mandatory.

6. **Emit inline.** No file write. End with an explicit "what to do next" section.

## Report structure (narrative + metrics tables)

```markdown
# Observations — {date}

{One-sentence scene-set.}

## By the numbers

| Pattern | Count | Status | Trend | Suggested action |
|---|---|---|---|---|
| {short human name, NOT L#} | {grep-backed count} | {concerning / watch / stable / under-control} | {rising / stable / declining / new / one-off} | {1-4 word fix pointer} |
| ... | ... | ... | ... | ... |

{Aim for 6-10 rows. Examples of good rows:
  - "`git add -A` during parallel sessions" | "2 violations post-rule" | concerning | rising | pre-Bash hook
  - "Defer promoted to must-ship after pushback" | "10/11 on <row name>, 4/7 on <row name>" | concerning | stable | flip default
  - "Agent self-report said 'no changes' but git showed edits" | "2 instances in <row name>" | watch | new | verify step
  - "Re-audit of APPROVED finds new launch-blockers" | "4 P0s on <row name>, 34 findings on <row name>" | under-control | stable | keep re-auditing
  - "Memory files past WARN (600 lines)" | "5/60" | watch | stable | distill next
}

{Status legend beneath the table if needed:
`concerning` = recurring + not closed; `watch` = one-off or under threshold; `stable` = fires at same rate; 
`under-control` = countermeasure catches it; `rising` = frequency increasing; `declining` = frequency dropping; 
`new` = first time seen; `one-off` = isolated instance.}

## The big picture

{Short paragraph. Plain English. Names 1-2 top concerns by severity × actionability.}

## Where I keep tripping up

{2-4 themed subsections. Each:
- Plain-English theme name
- 3-5 sentence shape description
- 1-2 specific examples (flow/feature/commit named in full)
- Mini-metrics row: "Evidence: X instances across {audits named}. Countermeasure: {present / absent}. Gap: {what still leaks}."
- Concrete lever with effort + what it closes
}

## What's working (invisible wins)

{Short bullets. What the system caught that you wouldn't have seen. Include counts where available ("3 re-audits found new P0s after APPROVED verdict"). Keep this section honest but positive — reports without wins demoralize and miss half the story.}

## System hygiene

{Plain English. Include one small table if there are 3+ memory files to flag:

| File | Lines | Status | Note |
|---|---|---|---|
| ... | ... | WARN/URGENT/OK | ... |

}

## What I'd do next — ranked

{3-5 concrete recommendations. Format:

1. **{short name}** — {what} · ~{effort} · closes: {what pattern}
   {Optional 1-sentence why-now if non-obvious.}

Rank by payoff ÷ effort.}
```

## Anti-patterns this skill must avoid

- **Tabledumping.** If you're emitting a 20-row table of L#s, you're not curating.
- **Aggregate statistics masquerading as insight.** "60% of rules are in section J" is not an insight. "Tests keep breaking because vitest mock state bleeds between test files — this has cost 3 debugging rounds this month" is.
- **Citing a code without a gloss.** If you say "P1-15", you've failed.
- **Hedging every observation.** If you believe a lever would work, say so. Don't say "this might be worth considering exploring."
- **Pretending you read something you haven't.** If you didn't grep the tracker for a specific claim, don't imply you did.

## Principles

- **Inline only.** Do NOT write any file. The report is wanted in the reply, not as a pointer to a file, and tailored to the reader: curated from the system's own memories and lessons, with insights and actions.
- **Read-only w.r.t. memory/rules.** Mutations belong to `/meta learn` or `/meta memory-audit`.
- **Curate, don't enumerate.** Eleven examples grouped into one theme beats eleven bullets with L# citations.
- **Translate all internal codes.** Row names, lesson numbers and finding ids are my vocabulary, not yours. On first mention in a report, always gloss.
- **Every observation has a lever.** Action or it's not worth reporting.
- **No retirement check in-output.** The previous skill version included a self-deprecating "if this isn't useful, retire me" footer. Remove — it adds noise.

## Coordination

- `/meta learn` writes new lessons → next `/observations` picks them up
- `/meta memory-audit` prunes memory → next `/observations` sees cleaner hygiene section
- `/meta patterns` runs deeper cross-expert contradiction analysis; if `/observations` surfaces a theme worth interrogating, `/meta patterns` is the follow-up
