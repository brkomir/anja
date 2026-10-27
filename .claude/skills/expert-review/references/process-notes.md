# Usage and Process — evidence, history and maintenance notes — moved, with the copy's edits, from `.claude/skills/expert-review/SKILL.md` (split under the per-file size line, a growth signal and not a delivery limit, 2026-09-26)

## /panel alias — not a deprecation, and why it is a skill stub — from `SKILL.md` § Usage (tail of the paragraph, split at a sentence boundary)

⛔ **Not a deprecation in either direction — both names stay and neither is preferred**, unlike `.claude/commands/expert-audit.md`, a wound-down rename since deleted. It is a SKILL stub rather than a `.claude/commands/` file on purpose: that directory is an enumerated set of six, named literally in `.claude/orchestrator/conventions.md` and asserted as `commands: 6` by `scripts/architecture-counts.mjs`, so a seventh file there would silently falsify both; the skills count is derived and moved 103 → 104 on its own.

## MEMORY-read line — the retired byte figure, and when to retire the exception — from `SKILL.md` § Invocation mechanism

*(The line used to assert "≤48KB" — a byte figure no mechanism maintains: it was true at the 2026-08-01 split batch and false for 12+ files five days later. A number in a mandated prompt line rots silently; the instruction in the skill file's section Invocation mechanism is true regardless of drift. Size management itself is the meta work order's recurrence decision.)*

The general don't-duplicate rule in the skill file's section Invocation mechanism still stands for SKILL.md, product context, and output format — this is a single measured exception, not a licence to re-inline the primer. **Retire it** when the Guard-3 fleet report shows the never-attempted rate collapsed (re-run `scripts/agent-memory-load-audit.mjs`; ⛔ **the comparison point is the post-classifier-fix **27.6% + ALT_READ 5.1%** (2026-08-26, 6,953 dispatches), NOT the 39% reading — that predates the `ALT_READ` fix now on disk in that very script, so comparing a post-fix re-run against it decomposes as ~5.2 pts classifier + ~6.2 pts corpus growth + **0 measured improvement**, and retires a mandate the fleet's own data says works).

## Step 3 scratch-file discipline — the measurement — from `SKILL.md` § Process (tail of the paragraph, split at a sentence boundary)

Measured on `/external-audit meta` 2026-09-13: a builder's verification script was overwritten mid-run at a shared scratch path by a sibling seat — seconds' difference and the same command prints a clean pass table about a DIFFERENT system's file, every arm agreeing. The harness's environment line calls the scratchpad "session-specific, isolated from the project" — accurate, and exactly the trap, because every seat the session dispatches gets the same one — and that line cannot be edited, so the brief is the only surface that says so. This is dispatch-specific context, not a repeat of the subagent definition, so the "Nothing more" rule in the skill file's section Invocation mechanism does not exclude it.

## Step 4b — what was NOT adopted from that council pattern — from `SKILL.md` § Process

   ⚠️ **NOT adopted from that council pattern, and not to be re-proposed as part of this:** the cross-provider critique leg and the 3-of-4 quorum. A tracker row records the exclusion; its (A) done-when stays open until ONE panel has actually run this way, **because an ordering nobody ran is not adopted.**

## Step 5 — the model-routing currency-check trap — from `SKILL.md` § Process

⛔ **BEFORE YOU "CORRECT" THIS BACK — THE CURRENCY CHECK ON THIS TOPIC HAS A TRAP, AND CHECKING BY DATE ALONE REVERTS THE FIX.** A search of the decisions log for `model routing` returns three entries — all NEWER than the review-panel amendment is *worded*, all reading like supersessions, and **all about a completely different subject: the PRODUCTION CRITIQUE MODEL** (which model scores a photo — the critique model is not routed per tier). The AGENT/panel-routing rule is the OLDER one (orchestrator tier follows judgment-density). **The two subjects share a phrase and nothing else.** **Nothing supersedes the review-panel amendment** (its rule 1 has since changed — the hub session runs Opus at high — and the panel rules stand); the amendment supersedes the Fable-for-breakers clause of the model-routing policy. Related and also cleared: the Fable ban you may meet in that policy no longer holds — Fable is **RESTORED**, and the Fable ladder is live, not a reference to a banned model.

## Step 5 wave directions — the measurement — from `SKILL.md` § Process (tail of the paragraph, split at a sentence boundary)

Measured on `/external-audit meta` 2026-09-13: that run's block was the only one among the stored process and verdict logs (a search for `DIRECTIONS for wave 2`, run 2026-09-13, returned that log, one brief file and one session plan that only mentions it) — the one earlier durable instance sits in a panel brief file, and a 2026-09-03 panel numbered its D1-D8 in a scratchpad file git never saw — two of that run's six directions manufactured convergence by dropping the diagnosis, and the two-wave design still produced its best result, a wave-1 serious finding refuted rather than confirmed.

## Step 5 unprimed arm — the measurement, the not-an-oracle caveat and cost — from `SKILL.md` § Process (tail of the paragraph, split at a sentence boundary)

**Measured:** a 53-slice investigation briefed four named framings to its last 15 slices, then ran an 8-lens panel; a contrarian-demanded control of 5 unprimed agents flipped **zero** labels (the pre-registered failure mode did not occur) and **all five produced an axis none of the six primed framings contained.** The priming had cost a hypothesis, and a label-flip metric is structurally incapable of detecting that — you cannot measure the absence of an option nobody was offered. **Not an oracle:** the unprimed account was itself falsified later by a blind partition test, so treat the arm as a GENERATOR of candidates the priming excluded, which then face the same verification as anything else. Cost: one agent per wave over a corpus already sliced.

## Step 5 mid-panel premise refutation — evidence — from `SKILL.md` § Process (tail of the paragraph, split at a sentence boundary)

Evidence: a design panel (2026-08-02) — the brief asserted the v2.14/v2.15 comparative levers were LIVE; two lenses refuted it with the same zero-hit grep the orchestrator had explained away, but no correction was sent, so 2 of 5 lenses returned reasoning from the dead premise and had to be discounted at synthesis. Companion to the inbound half (cite every load-bearing brief premise): that rule keeps a false premise OUT of the brief; this one bounds the damage when one gets in anyway.

## Step 8a — why orchestrator-side persistence, and what to watch when an expert self-writes — from `SKILL.md` § Process (tail of the paragraph, split at a sentence boundary)

**Why:** pre-fix pattern (agent writes own MEMORY.md as last tool call → emits terse "Memory persisted" final message → orchestrator loses structured verdict) caused the truncation ~20-30% of the time. Orchestrator-side persistence eliminates the trailing-confirmation-message class entirely AND centralizes dedupe + cross-expert conflict detection. **When experts still call Edit/Write on their own MEMORY.md** (template non-compliance or regression): the agent's final message is at higher truncation risk; watch for Guideline 10 symptoms and re-launch if verdict truncated.

## Expert Prompt Quality — why hand lenses the grep RESULTS, and its cost — from `SKILL.md` § Expert Prompt Quality (tail of the paragraph, split at a sentence boundary)

**And re-stating the obligation demonstrably does not work:** Band-U is re-sent on every sub-agent dispatch and already carries the codified-policy verification gate row, so every lens holds the duty and it still does not fire — measured 2026-08-28, **2 of 4 lenses in one lean panel recommended already-settled things** (an `fr` register arm whose zero yield was recorded in a CLOSED row, and an hreflang change a standing decision had already barred). That is possession≠application (active-recall before write), not a coverage gap, which is exactly why the fix is to hand them the ANSWER rather than the instruction. **Cost: one grep. Do it once, paste the hits into each brief.**

## Step 5 — the model-routing correction and the measured incident — from `SKILL.md` § Process, step 5 (mid-paragraph, moved to bring the spec back under its per-file size line)

⚠️ **This line said the opposite until 2026-08-24**, routing `--code`/breaker panels to Fable and citing an earlier confirmation; that clause is **DEAD for review panels**, and it is what produced the measured incident — seven Fable lenses in one session, all inheriting max effort, dispatched five and six at a time, which spent the Fable allowance fast enough to block other work.

## Step 2b(c) — the checker's evidence — from `SKILL.md` § Process, step 2b(c) (two spans, moved to keep the spec under its per-file size line, counted in UTF-16 units)

- Why a `ran:` premise is checked for its command and its framing, never re-derived: (across two rounds of panels, 34/40 and 40/42 checker pairs were numeric; the first round's seats then refuted 3 non-numeric premises).
- Why the missing-consideration question exists: a panel passed the premise check, then flipped on a clause of the product's terms that no seat had weighed.

## Step 1b — the peer-context block's founding evidence — from `SKILL.md` § Process, step 1b (tail of the paragraph, split at a sentence boundary)

Evidence: real-time collision detection demonstrated during the very session that shipped this script — peer session was actively editing the same tracker and memory files the orchestrator was about to edit; surfaced + coordinated rather than clobbered.
