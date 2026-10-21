# Expert Prompt Template

Reference extracted from expert-review/SKILL.md (v2.8.3 progressive disclosure).

The subagent already knows its role, how to read its SKILL.md/MEMORY.md, and how to respond. The prompt only carries **the question and the audit-specific context**. Copy and adapt:

```
**Context:** [1-2 sentences: what the user is asking about and why]

**Your scope:** [Which aspect this expert should evaluate — narrows from their general expertise to this audit]

**Files to read (beyond your own SKILL.md + MEMORY.md):**
- [List 2-5 specific source files, plans, todo sections, or other expert memories relevant to this question]

**Constraints:**
- [Prior decisions that constrain the solution space]
- [Technical constraints: stack, timeline, budget]
- Build philosophy: quality first, correctness over speed

**REVIEW ONLY — surface every finding in your return; do NOT edit any file** (not even an obviously-correct one-liner). Return the fix as an exact PATCH in your verdict: the path, the exact old→new text, and the test that covers it. The orchestrator applies it.

**Question:** [The specific question to answer]
```

⛔ **The REVIEW ONLY line is not optional and not boilerplate — carry it verbatim into every dispatch from this skill.** Every agent the review hub runs, and every panel seat, is read-only by default. For review dispatch this overrides the standing rule that an agent meeting a small change (under roughly 15 lines) makes it in place rather than skipping it; that rule still governs everything else.

**Scope — three things this does NOT change.** (1) `/agent-work` and `/fix` BUILDERS are untouched; they apply fixes as before, and this template is not theirs. (2) It is **not a licence to defer** — the generated posture rule 4 in EVERY expert definition (`scripts/generate-expert-agents.mjs`, *"Do not file a 5-line correctness fix as a 'finding for later'"*) forbids filing a small correctness fix as a finding-for-later — cite that, which every seat holds; its former carriers (Band-U, `behavioral-anti-patterns.md` #3/#8) were PARKED by `paths:` scope on 2026-09-07 and are not delivered to a panel seat. A fully specified patch handed to the seat that owns the tree is the same fix, not a deferral. (3) The **disposition rule survives entirely**: if a seat edits anyway and reports it, do NOT revert a correct edit on process grounds.

**Why, and it is NOT a token-cost argument.** The measured grounds are review integrity — a seat that edits what it evaluates certifies its own edit — and shared-tree attribution: **12 of 289 review-briefed sub-agent transcripts wrote into the shared tree in 5 days** (80 Write/Edit calls into quota, billing, pricing and test files), and two spot-checked briefs already said REVIEW ONLY. Sub-agents never commit, so each is an orphan the orchestrator carries or reverts on a worktree several sessions share. The token saving is ~0 and must not be claimed.

Do **not** re-state the Required Output Format, do **not** tell the expert to read its own SKILL.md/MEMORY.md, do **not** instruct it to append to its memory afterward — all of that is in the subagent definition at `.claude/agents/{expert-name}.md`.

**Post-prompt self-check:** Before launching, verify: (1) At least 2 audit-specific files listed? (2) Specific question stated, not just "review X"? (3) At least one constraint or prior decision included? Revise if any check fails.
