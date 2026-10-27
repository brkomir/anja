---
name: claude-system-state
description: Current health + known failure modes for this Claude system. Companion to `.claude/docs/architecture.md` (architecture is durable; this file is manually curated and moves faster).
type: docs
refresh-cadence: manually curated; entries flow through `/meta architecture-audit` Step 6 (fragility list refresh); full review when a content pass is run; the trail at the end dates each pass
last-reviewed: 2026-10-27
audience: Future-self mid-flight, or anyone diagnosing a recurring problem.
---

# Claude System — Current State + Failure Modes

This page describes the source tree this copy was taken from; some files and counts it names are not in this copy. `docs/repository-map.md` lists what the copy ships.

> **What this doc is for.** Two things, separated by section:
> - **Part 1 (Current State).** A candid read of where the system actually is right now — what works, what is fragile, structural gaps. Manually curated; entries flow through `/meta architecture-audit` Step 6, with a full review when a content pass is run (the trail at the end dates each pass) — the same cadence this file's own frontmatter states.
> - **Part 2 (Failure Modes Index).** The patterns the system is built to catch, with detection + recovery for each. Refreshes when a new pattern recurs ≥2 times in production.
>
> Architecture lives in `architecture.md` (durable, quarterly refresh); shipped and queued improvements are tracked separately. This file does NOT duplicate those — pointers only.

---

## Part 1 — Current State

### What works well

#### Capture → Curate → Enforce model is genuinely useful
Naming the layer at the moment a problem surfaces changes the kind of fix proposed. "User had to push back on hallucinated rationale — capture-gap? no, the signal was present" forces the next sentence to be about why curation missed it, which has a more durable answer than fixing the specific incident.

#### Per-skill MEMORY is the system's most valuable part
A new audit on security can page through ~4,220 lines of prior decisions (a 106-line router plus five dated archive shards, measured 2026-10-27) with file:line citations and revisit triggers. Bloat is real but manageable with the tier split (`scripts/memory-tier-split.mjs`); `/meta distill` exists and last ran in May 2026 (`architecture.md` Lecture 8).

#### Parallel `/agent-work`: one timed wave
One audit wave of 4 parallel agents took about 12 minutes; the ~35 minutes it was compared with is a "would have taken" figure for a sequential run that was not timed.

#### Every defer is meant to carry a trigger
A defer is meant to carry a trigger, a LOC estimate and a reason, and `/audit-check` Check 8 enforces visibility in the ops tracker. A status in the audit trackers is a claim by whoever last touched the row, checked against git at `/audit-check`.

#### Hooks fire on real work; whether they shifted behavior is unmeasured
`bash-safety-warn.sh` has logged thousands of fires since its fires log began on 2026-08-13 (measured 2026-10-27) — among them 2,506 on `git checkout <path>`, 685 on the `git add -A` arm, 506 on `git stash` (re-derive per arm from the `arm` field; the arms named are not the whole log) — and the log records which ARM fired but not whether the command merely mentioned the pattern, so some of those are false fires. `check-test-exists.sh` warns on a `src/` edit with no matching test and keeps no fire log, so its rate is unmeasured. The fires are visible; whether that visibility changed behavior has not been measured (`docs/evidence.md`, the hook-guard and warn-then-block rows).

#### Meta self-audit catches drifted numbers when it runs
Embedded numbers drift constantly. The self-audit catches them when it runs, as a member of `/meta maintain`; whether it keeps the layer from rotting has not been measured (`docs/evidence.md`).

#### Per-skill CHANGELOG discipline is shipped, not aspirational
Every skill spec edit appends a one-line entry to the skill's changelog, and the git history shows consistent same-commit pairing with the corresponding SKILL.md edits.

### What is fragile

#### Sub-skill invocation discipline still slips under `/wrap` pressure
"when a SKILL.md spec says invoke X, fire it via the Skill tool — don't compress it into narrative" was codified 2026-04-20. The corrections registry records the class again on 2026-06-22 (three `/wrap` sub-skills deferred to a "fresh-context pass"), 2026-06-26 (skip-gates closed by assertion) and 2026-07-31 (mandatory sub-skills named as un-run instead of run, across ~15 closing summaries), plus a partial-emission variant on 2026-05-24. Since 2026-09-03 the primer that carries the rule reaches only the main session, from `.claude/orchestrator/conventions.md` at SessionStart. `scripts/wrap-reconcile.mjs` computes part of the wrap's completeness checkmark from the transcript and git (warn-mode; since 2026-10-15, it checks all five mandated sub-skills where it had checked three — and the two it lacked, `/hanging-work` and `/me learn-session`, were the ones skipped, in 15 and 6 of 138 wrap episodes), which is the structural half; the prose half has not held on its own.

#### ~~Memory hygiene is the perpetual unhappy path~~ — LARGELY RESOLVED, and the axis changed (re-measured 2026-09-14)
The line-budget framing this entry was built on is **retired**. Two things happened: the 4,000-**line** URGENT tier was removed from `check-memory-size.sh` on 2026-08-01 as structurally blind, replaced by BYTE-keyed tiers (`SKILL_WARN_BYTES` / `SKILL_CEILING_BYTES` / `SKILL_HARD_BYTES`); and the two-tier router+shard split landed, so the meta skill's memory is a 102-line router (2026-10-27), not the ~7,700-line file this entry once described. ⛔ **The "no-cliff" rationale that justified the old soft-budget was MEASURED FALSE on 2026-07-31** — the Read tool's caps bind regardless of load mode. **Measured 2026-09-14:** ZERO skill `MEMORY.md` files are ≥600 lines; ZERO memory files of any kind exceed the 256 KB Read hard-error cap (as recently as 2026-07-31, four expert memories were silently hard-erroring their agents' opening Read); and no hot `MEMORY.md` is over the 57,500 B per-Read ceiling — re-measured 2026-10-27: the largest is `external-everything-claude-code` at 56,803 B, 697 B under the ceiling and rising (53,919 B at 2026-10-19), then `external-wshobson-agents` at 54,299 B (`qa-expert`, the 2026-09-27 leader at 53,880 B, was 33,102 B by 2026-10-19; `context-architect`, the 2026-09-14 leader, split on 2026-09-23). **The residual is by design, not drift:** all 110 skill memory files over that ceiling (105 at 2026-10-19, 72 at 2026-09-27) are dated `MEMORY-ARCHIVE-*.md` shards (the heaviest ~199.7 KB; nine shards sit at or above 199.5 KB), which are paged rather than read whole — `warn-large-tracker-read.sh` denies an unbounded Read with paging coordinates, and the retrieval path is grep-the-directory then Read with an offset. ⚠️ A count that globs `MEMORY.md` alone excludes every shard by construction, which is the population the split moved the bodies into — and a `find` that does not exclude `.claude/worktrees/` reads a leftover agent worktree's pre-split copies as live over-cap files (70 leftover agent worktrees at 2026-09-27, 33 of them holding a ≥4,648-line pre-split copy of the meta skill's memory; an unexcluded `find` returned 3,033 over-ceiling memory files against the 72 live ones), a false alarm in the other direction. Budget in BYTES; `/wrap` Step 7e surfaces overdue distills at session-close.

#### Some skills are dormant but not pruned
The Panel Playbook tracks high-signal experts; the inverse (low-signal experts that should be retired or consolidated) is implicit. A claim that one external-system expert had zero adoptions was refuted on 2026-08-24: the system it studies is credited in the bundle that brought compact-save and restore, the `/meta distill` spec and audit-check Check 11, and deleting that expert on dormancy alone is the specific pruning trap the state gate exists to prevent. The reasoning in this bullet is one the system already rules out. Several haines-* skills overlap with ux-design-pro. The system grew faster than it pruned. Some pruning has since happened, mostly not for dormancy: `/deploy` folded into `/promote` (2026-10-02; its alias stub was deleted 2026-10-26, with `/deploy-check` and `/expert-audit`, in the cold-command pass), one external-system expert's agent retired once another catalogued system covered its ground (2026-10-09; the folder stays as a frozen record), and `/meta demote` pruned after it was never invoked in 123 days (2026-10-11), the only one of the three removed for disuse. The first sweep FOR disuse followed on 2026-10-26: the cold-command pass found 24 of 71 commands with no logged use in 30 days and retired 3 (`/deploy`'s alias, `/deploy-check`, `/expert-audit`), merged 2 behind one-release stubs (`/launch-check` into `/launch check`, `/observations` into `/meta observations`) and kept the rest. It excluded the expert-type skills, so for experts the dormant-skill sweep still waits for enough invocations — until then, "never invoked" doesn't yet distinguish "dead" from "unexercised by traffic."

#### The `/meta learn` rubric (D+I+S ≥6 promote) is calibrated by gut
The promotion threshold is still judgment. **Partial close (2026-06-20):** for the subset of promoted lessons that become decision-moment gates (a sniff-test check / Hot-Tier trigger), `/meta corrections --analyze` **gate-effectiveness** now measures the OUTCOME — does the blindspot's owner-pushback share fall after the gate ships? — using the registry as ground truth. Residual gap: lessons that DON'T become gates still have no fire/outcome measure.

#### Model-default sycophancy / hedging / position-flipping is structural
The `sniff-test` skill ships 9 auto-fire triggers + a 15-check rubric — but the trigger-set itself is calibrated to recurrences we've observed in this project, not the full space of failure modes. A class that hasn't surfaced yet will not match a trigger. ⚠️ **And since 2026-09-23 no session receives the conventions auto-fire BLOCK:** round three of the exhortation cut parked it and its skip rules in an archive file that no hook delivers. One carrier survives — the skill's own listing description (*"Use BEFORE emitting any non-trivial draft … Auto-fired by the orchestrator"*; `sniff-test` is not in `settings.json` `skillOverrides`, so the listing reaches every main session), which is the confound the round-three read cannot separate. So it fires when invoked by name or when the model acts on that listing, and its pre-registered read, on 2026-10-09, detected no effect on the primary measure (which could detect only a rise of about 15 points) but left two signals unresolved (an ambiguous secondary share and a count too small to read); the experiment was closed on 2026-10-10 with the park permanent. Research-grounded (Sharma 2023 / Kim 2025 / arxiv 2601.04435). Worth periodic re-read of recent transcripts (every ~30 sessions) for trigger-set false-negatives. **The ceiling on this approach is now a settled rule, not a guess:** the rate of asserting without checking had sat between a third and forty percent for months across every intervention, so it is treated as a property of the model at this scale, and no new written enforcement — rule rows, sniff checks, receipt slots, primes — gets built against it. The sanctioned counter is a reader who was not in the room: the review hub, a fresh-context breaker, or a per-event classifier.

#### Parallel-session coordination is robust but high-cognitive-overhead
Every commit step needs a `git diff --staged --name-only` check; every memory-touching skill needs sub-agent MEMORY blocks awareness; every git operation needs awareness that parallel sessions exist. Hooks catch the obvious cases; residual cognitive load is real. Three tools since 2026-10-02 move part of it out of memory: `scripts/stage-own-hunks.mjs` stages only your own hunks of a shared file (2026-10-02), the pre-push hook allows one push at a time, gated on a clean copy of the pushed commit (2026-10-06), and the tool that produces this copy reads its listed live files at a fixed commit, so a peer's edit cannot stale a pin mid-wave (2026-10-10); and since 2026-10-15 `/board` (`scripts/fleet-board.py`) renders one read-only, derived card per open seat, taking alive-or-not from the harness's own `claude agents --json` list.

#### Preference→spec propagation has no automatic layer
On the first-ever run of the spec-coherence check (2026-06-13, 55 days after it shipped), 5 CONTRADICTS were found — every one was stale-policy residue (a spec line written before a policy flip and never swept: EN-placeholders in `/fix`, human-time units in `/backlog` + meta, flag-only posture in `/hanging-work`, an unshipped `--auto` claim in the profile). All fixed same-run, but the class will recur on every future policy flip until something sweeps specs at flip-time. Watch: coherence spec says 3+ CONTRADICTS on consecutive runs → propose scaffolding (a hook greping new policy commits against skill-spec keywords). The readings since: 0.87 on 2026-07-09 (1 soft CONTRADICTS), 0.90 on 2026-07-19 (0), 0 on 2026-08-11, **4 on 2026-08-24 (3 fixed same-run), 3 on 2026-09-04**, 2 on 2026-09-13 (both stale spec prose teaching a banned pattern), 0 on 2026-09-19 (162 cells), 3 on 2026-09-26 (re-verified: `audit-check` and `fix` prose against the never-log-flaky-tests preference, `hanging-work` against use-available-tooling), 3 on 2026-09-29 (`agent-work`, `dependabot-fix`, `fix`), and 5 on 2026-10-05, four of them one policy change — the dev-push policy — not yet carried into `wrap`, `agent-work` and `dependabot-fix` (the 09-26 and 09-29 sets were fixed by then; the 10-05 five were applied that day). The condition this entry names for proposing scaffolding — consecutive readings at 3 or more — has fired again, four runs running (09-26, 09-29, 10-05, 10-11 — the last read 5 contradictions over three root causes, as four items — three fixed same-run: `/summary`'s commit extractor matched only `[main <sha>]` while the fleet commits on `dev`, the unpromoted-vs-unpushed labels, the readout heading's session name; the fourth, the dead-agent resume rule, was settled by a decision on the rule itself), after the 08-24/09-04 pair, and no proposal is on record in the meta changelog shards. 10-05 is the class at its plainest: one policy flip, four stale specs. The next reading, 2026-10-27 (`/meta maintain`), was 2 (`promote` :66-67, `references/process-triage.md`:59), which ends the run of readings at 3 or more.

#### Slash-command surface grew without strong coordination (first pruned for disuse 2026-10-26)
Measured 2026-10-11: 61 of the 117 skills had no agent definition beside them (63 of 119 at 2026-10-14 — `limit-recovery` and `pre-compact` carry none; 64 of 120 at 2026-10-19 — `board`, added, carries none; 63 of 119 at 2026-10-27, after the cold-command pass deleted `deploy` and `deploy-check` and one new command arrived without one) (one of the 61, the retired `external-vinicius91carvalho-claude`, is a calibration record kept as a folder), i.e. they are invoked as commands rather than dispatched as experts or personas. The command index is no longer in `CLAUDE.md` (which now holds a pointer and no `/command` bullets): since 2026-09-03 it lives in `.claude/orchestrator/conventions.md` § Commands, delivered to the main session at SessionStart — 38 bullet entries at 2026-10-11, 40 at 2026-10-14, 41 at 2026-10-19 (the `/board` bullet), 42 at 2026-10-27, plus a line naming the commands in daily use that carry no bullet. **Derive it, don't restate it:** `awk '/^# Commands$/{f=1} f&&/^## /{exit} f' .claude/orchestrator/conventions.md | grep -cE '^- `/'` (the recipe `/meta self-audit` Check 10 uses), and `architecture-counts.mjs list → skills` for the corpus. A new contributor would not know which to invoke when. The cold-command pass (2026-10-26) is the first measured counter to the growth: 24 of 71 commands unused in 30 days, 3 retired and 2 merged — and it measured `/help` at zero recorded uses since the log began, and `/help` was kept. `/help <topic>` addresses command discovery, and the universal `help` arg (`/meta help`, `/meta <subcommand> help` — shipped 2026-05-30, now in `conventions.md`) covers *subcommand* discovery too (`/meta` has 16 primary entry points: 15 after `/meta demote` was pruned on 2026-10-11, and `/meta observations` since the 2026-10-26 merge). Residual gap: a contributor still has to know the `help`-arg convention exists.

#### Agents' Memory Update blocks miss expert memory, and get credited as saved
Every dispatched expert ends its hand-back with a `### Memory Update` block the orchestrator must persist into that expert's memory, and since 2026-09-28 the persist has kept not happening — the steady state, not an episode. A review hub that never checkpointed reached its wrap with 247 blocks from 289 agents unwritten, the second hub in a row (2026-10-01; the hub before it persisted 755 the same way). A brief told a translator its earlier entry was saved when nothing had been checked, and the rescue went to the wrong shard (corrections registry, 2026-10-03). On 2026-10-10, 43 of 47 panel and builder blocks were absent from every memory home while `wrap-reconcile.mjs` credited 44 of them LIKELY-REWRITTEN — its evidence was verdict records that quote each seat verbatim, an echo rather than a persist — and blocks re-homed as rows below a two-tier router's generated marker were then dropped by the next `--heal` while it printed conservation OK (corrections registry, 2026-10-10, twice, the second on the fleet-wide scope). What is in place: the reconcile now splits its evidence by home class (`classifyShingleEvidence`), and the lesson's prescribed action persists from the `SubagentHandback` payload in the subagents store, which survives a compaction where the in-context hand-back does not — for INLINE blocks only (a later amendment to the lesson): a review seat writes its block at the end of a report file and hands back a pointer, and 260 of 699 such blocks were absent, so a persistence pass must read the hand-back and the report it points to. The retiring hub's end-of-life wrap on 2026-10-13 was the third hub-scale miss in a row; it persisted 236 inline blocks from the store, then 323 more — report-file blocks plus 69 inline, with 64 duplicates removed after. Since 2026-10-27 `/wrap` Step 4a runs `scripts/wrap-memory-update-persist.py` (report, then `--apply` for MISSING), after the class recurred four times from 2026-10-19 to 10-27 (49 lens blocks across three occurrences, and 20 helper blocks in one session). What is not: no hook captures a block at hand-back (the design fix the watch row proposed), and the fleet re-check of past credits is still open in the todo tracker — its first clean run is on record for 2026-10-10 and the retired hub's own share was drained by that wrap, neither yet written on the tracker row. Distinct from failure-mode #4, a sub-agent writing memory directly: here the sanctioned path is followed and its last step is lost.

#### What the owner ruled gets restated wrongly on its way into the record
An owner ruling travels — into a plan row, a tracker, the decisions log, a brief, a readout — and arrives changed. Since 2026-09-28 it has gone wrong four ways: invented, a hold read out of the owner's words and re-cited across compactions until the durable record called it the owner's (2026-09-29); treated as open after the owner had ruled, re-put to the owner as "my call, you can overrule" with a default that shipped the opposite, then relayed as unruled to other seats and into memory a day after the lesson was promoted (2026-10-03); over-read, a blanket approval applied to a row that carried no recommendation (2026-10-08); and rewritten, a fresh reviewer's narrowing of what the owner's go covered folded into the gate without asking the owner (2026-10-11); and a fifth, paraphrased into doctrine — writing down a ruling is where its scope drifts (2026-10-12: a `/wrap` effort ruling widened to seven procedural commands, a harness save cited as the owner's preference). The same three days added a silence default treated as settled (2026-10-11), the losing option's trim riding into the build without a ruling, and a blanket approval of the recommendations applied to an item that carried none (2026-10-13 — the over-read shape again), and the registry a 2026-10-13 row (the band-budget gate put to the owner as pending after the owner had ruled it — the treated-as-open shape). The corrections registry holds the same shape twice more: an attribution corrected in one tracker row and written again in its sibling (2026-09-30), and a decision row telling the owner an option went "against the letter" of a ruling whose stated reason did not reach that case (2026-10-03). Since 2026-10-14 the class has kept coming: the paraphrase lesson's second occurrence (2026-10-17 — a choice between two options cited as disposing of a third the owner was never asked, and the owner's approving lead-in to a question recorded as accepting a bar, which a later lesson records accepted twice), a further lesson (filed 2026-10-18; its instance, an owner-defined gate's input widened to reach green, dates from 2026-10-13, the day before), and a 2026-10-18 reinforcement counting five instances in one session window (corrections registry 2026-10-18, two rows), whose proposed scaffolding — every line recording a ruling quotes the option text the owner picked — is held as a proposal, not built. It kept coming after 2026-10-19: three more lessons (all 2026-10-24) and a hub quoting a session's recommendation as the owner's ruling twice in one window. Each lesson names its own read — the marker-quoted words (`owner ruled:` / `owner, verbatim:`), the rows that visibly carried a recommendation, the question put back to the owner — and no standing instrument runs any of them. Neighbour of failure-mode #13, where the owner's input never reaches the seat, and #14, a verdict carried past its state: here the words arrived and the restatement drifted from them. Descriptive only, by the standing no-new-enforcement rule.

#### A harness timestamp read as the time the event happened
A message the owner types while a turn is running is two transcript records: a `queue-operation` enqueue carrying the text at the moment the owner typed it, and a `user` record stamped at delivery, after the turn yields. Reading the delivery stamp as the send time has produced wrong claims since 2026-09-28: a reply that came almost three hours late blamed on an expired mail watcher when the message had sat enqueued behind a Remote Control disconnect; a plan block stamping an owner pause seven minutes after the owner typed it (2026-10-06); and an owner `/pause` recorded as answering a readout produced 31 seconds after the owner typed it — so its "Needs you" list was unseen — repeated in the plan, the hub mail and the compaction summary, with two more plan blocks the next morning stamped at write time instead of at the owner's record (2026-10-10/11, with four more instances recorded by 2026-10-11, two of them from 10-09). The mechanism the lesson lacked is now written beside it: a queued SLASH command lands when the running turn ends, while queued plain text is absorbed mid-turn within about 20 s. Both lessons prescribe the same read: find the enqueue record and use its time. Scaffolding has since shipped — `/pause` resolves the time against when the owner typed it, and `summary-plan-sync.mjs` flags a future-dated plan heading — which reads plan labels, not enqueue stamps, so no instrument reads the stamps themselves. Kin on the same plane, a lesson with occurrences on 2026-10-15 and 2026-10-17: a model switch the owner makes while a compaction runs leaves no `/model` command record, only a changed `type:"model"` attachment on the next request, and twice the missing record was read as evidence: the first time filed as cause unknown although the seat had credited the owner, the second a correct note rewritten to "unexplained" and promoted as "do not credit the owner", until the switch was confirmed; its read is the attachment, then ask. An environment fact, so the no-new-enforcement rule does not reach it.

#### The cost of a cold cache gets left out of the arithmetic
Designs and recommendations since 2026-10-07 have priced a choice without the cache write it forces. The `/pause` spec stopped in-flight builders and resumed them by id later, though a resume re-writes the agent's whole context; the spec was changed to let them finish instead (corrections registry, 2026-10-07; `/pause` SKILL.md "RUNNING SUB-AGENTS ARE NOT STOPPED"). The same day `/pause` shipped with keep-warm off unless a flag was passed, so a forgotten flag paid for the re-cache; the default flipped to warm, with `--cold` to opt out (registry, 2026-10-07). And the keep-warm gate's 95 % five-hour ceiling withheld pings exactly when the window was nearly spent, though one cold re-cache costs about 26 pings; it now withholds only at the limit itself (registry, 2026-10-10). Kin, a mechanism claim rather than a cost one: telling the owner the mail listener could not keep the cache warm, against the session's own expiry turns, which had (registry, 2026-10-07). The cost facts are environment facts, so the no-new-enforcement rule does not reach them. A third followed: the `/pause` keep-warm window would have ended at the five-hour reset and let the cache go cold, and twelve hours from the pause became the standing rule — now bounded by any compaction, which stops the warmth by design, after readouts had promised "warm until <time>" past an owner `/compact` 7+ times across 4 sessions (one resume wrote 173,538 cache tokens). The corrected defaults live in `/pause` step 6b and `keep-warm-gate.py`. The sub-agent side got its first instruments on 2026-10-19, after a 7-day scan found 42 mid-run sub-agent cache rewrites (~10.4M tokens), 20 of them a message to a helper idle 8-124 minutes: `subagent-cache-window-inject.sh` (SubagentStart) tells every sub-agent its cache lives 5 minutes, and `subagent-resume-guard.py` (PreToolUse SendMessage) refuses a message to a helper idle over 240 s, or dead at an API error at any idle, unless it says RESUME-OK, printing the re-read price. Both act at the moment of the act, one by notice and one by a priced refusal before the send; nothing prices a new design's cache writes before it ships.

### Structural gaps

The lettered gap register the meta memory used to carry is closed: every gap in it was resolved, and the closure detail was archived on 2026-05-21. The two this section last listed went that way — skill-invocation telemetry by `log-skill-invocations.sh` plus `/meta telemetry`, and defer-trigger fire detection by `/hanging-work` item 12 plus the `/wrap` note on 2026-04-21, since joined by the deterministic `/triggers` scanner (`scripts/defer-trigger-scan.py`). One structural issue remains open:

- **Renumber drift:** the numbered-lesson range has gaps from past renumbers plus a few duplicate slots. The L# topic-tag convention prescribes the going-forward convention: cite L-numbers with a short topic tag (`LARP markers`), never a bare number. The tag makes drift visible at read-time — and it can itself drift: an annotation sweep had once mangled this very example and glossed it with the wrong topic, both corrected 2026-09-14.

### Velocity health

`session-cadence.md` (path-scoped since 2026-08-26; it loads when a session reads a hook, rule, orchestrator, command, meta-skill, `scripts/` or `.githooks/` file) carries three velocity rules. **SC-1 is a self-check, not a cap:** at a session's fourth meta-system commit it runs the enumeration and stops meta work only if at least three launch-blocker items are unshipped AND the session has made no product commit; an owner directive exempts the session before the count, and the choice between meta and product work belongs to the owner, not to the rule. SC-2 requires every new hook to name the L-number it prevents, or a `NEW class` with a specific failure mode. SC-3 ships a follow-up version only after the previous one produced an observable outcome. These rules were added after earlier sessions saw 15 meta version bumps in one day; the same file now also holds most of the doctrine on proposing, calibrating and promoting a guard.

**SUBTRACT verdict (2026-06-01) + a later 8-expert redo + a correction.** The 06-01 net verdict was SUBTRACT-not-ADD, framed on a `.claude:src` commit ratio. **Correction (supersedes the ratio framing):** commit-count is a FLAWED meta:product effort metric — product commits are far larger in scope/LOC, so commit-count overstates meta-share; and the meta work surfaces because it carries genuine weight, not product-avoidance. **The meta-freeze finding was NOT adopted**; the ratio-based displacement findings are downweighted. **The instrumentation finding corrected:** "zero fire instrumentation" was overstated — `scripts/rules-trigger-firerate.mjs` measures trigger-phrase PRESENCE (ran 06-09 on a since-fixed buggy build: 12% fire / 73% dead — the dead-count was artifact-inflated; the **2026-06-20 fix** [per-row L# attribution + cell-aware artifact exclusion] recalibrated it to ~21% TRUE-DEAD of 75 genuine triggers) and `meta-corrections-scan.py --analyze` is outcome instrumentation (gaining **gate-effectiveness** 2026-06-20 — per-gate registry-share before/after); the real gap is rule-action FIRING on prose (un-hookable — no hook reads orchestrator draft prose). **The reads that held, and where they landed.** Measure-before-building said to re-measure the under-justification rate after the session-start prime shipped (06-09) and to accept it as model-structural if it stayed high; that is now the settled position — the rate had sat between a third and forty percent for months across every intervention. The SUBTRACT options also landed: `/meta demote` ships as a primary entry point (pruned 2026-10-11 after 123 unused days), and a pre-registered experiment (read on 2026-09-21) took `behavioral-anti-patterns.md` and `active-recall.md` off the always-loaded path and switched off the per-turn Band-O injection.

---

## Part 2 — Known Failure Modes

A consolidated index of the failure modes the system is built to catch. The list is not exhaustive — only modes that have surfaced ≥2 times in production sessions (recurrence is the bar for inclusion). Single-incident failures stay in the meta skill's memory shards until they recur.

### 1. Memory hygiene drift

#### Pattern
Skill MEMORY.md files grow past useful retrieval. ⛔ **BYTES are the load-bearing axis, not lines** — the 2026-06-09 "no-cliff" reframe this entry once rested on was **MEASURED FALSE 2026-07-31**: the Read tool's own caps apply to every file regardless of load mode (256 KB ⇒ hard ERROR, zero content; ~58–64 KB ⇒ PARTIAL view — silent from the Read tool itself, but `warn-large-tracker-read.sh` ARM B denies the unbounded Read on a skill MEMORY file and hands back paging coordinates, so the agent is told). Four expert memories sat under every LINE threshold while hard-erroring their agents' opening Read for weeks.

#### Detection
`check-memory-size.sh` PostToolUse hook. **The line-keyed 4,000 URGENT was RETIRED 2026-08-01 as structurally blind** — read the live constants from the script (`WARN` lines; `SKILL_WARN_BYTES` / `SKILL_CEILING_BYTES` / `SKILL_HARD_BYTES`), never a figure restated here. `warn-large-tracker-read.sh` ARM B denies an unbounded Read at the ceiling and hands back paging coordinates. `/meta self-audit` Check 1 surfaces the largest MEMORY files. `/wrap` Step 7e surfaces overdue distills at session close.

#### Recovery
`/meta distill <skill>` — 8-step process: extract entries, score D+I+S, promote ≥6 as prescriptive patterns, delete source. **Or `scripts/memory-tier-split.mjs --roll`, which is what actually resolved this class** — a router + dated ≤200 KB shards, moving bodies verbatim rather than compressing them. Distillation is owner-judgment; the split is mechanical and conservation-checked.

#### Codified in
Architecture.md Lecture 3 (memory hygiene unhappy path), defer-with-trigger gold pattern / promote deferrals at moment of classification / default SHIP, meta/SKILL.md Process — Distill (full spec `meta/references/process-distill.md`).

### 2. Model-default sycophancy / hedging / position-flipping

#### Pattern
Model defaults to agreeable on rebuttal pressure; pads responses with hedges ("might", "could", "trade-off"); produces 2+ options when one is correct; flips verdicts under pushback without new evidence; escalates to external authority to avoid commitment.

#### Detection
`sniff-test` carries 9 triggers and a 15-check rubric; the block that made it AUTO-fire on a matching draft is PARKED since 2026-09-23 (round three of the exhortation cut; the experiment ended 2026-10-10 with the park permanent), so today it runs when invoked by name or when the model acts on the skill listing's own description, which still reads "Auto-fired by the orchestrator". The triggers: >200 words / 2+ options for one question / hedging OR unearned-confidence tokens / external-authority escalation / position-flip / user frustration markers in the last 3 messages / user-as-oracle delegation / defer, scope-down, over-isolation or dismissal framing / a codified-preference surface (a peer noun about uncommitted state, a verifiable-state claim asserted as fact, or an authority move on a codified workflow). 15-check rubric applied inline before send.

#### Recovery
Rewrite before send. Most common rewrites: kill hedge tokens, pick the right option (not present-and-ask), substitute "RE-EXAMINE first" for "you're right" under frustration markers, replace user-as-oracle questions with greppable lookups.

#### Codified in
user pushback, adding a check without applying it, sniff-test/SKILL.md; the auto-fire block moved to `.claude/orchestrator/conventions.md` on 2026-09-03 and was parked from there into an undelivered archive on 2026-09-23. Research-grounded: Sharma 2023, Kim 2025, arxiv 2601.04435.

### 3. Silent rule drift in skill specs

#### Pattern
Skill spec edits drift counts ("currently 24 lessons" when actual is 26), ordering inconsistencies (Step 2c before 2b), embedded references to files that have moved. Reader takes the drifted claim as authoritative.

#### Detection
`/meta self-audit` runs its check battery as a member of `/meta maintain` (**count is derived — `architecture-counts.mjs list → selfAuditChecks`; it read "11" here until 2026-08-24 while the live value was 13**): embedded-number drift, ordering, closed-gap cleanup, lesson count match, multi-home drift, principle contradictions, anti-pattern scan via `scripts/skill-lint.mjs`, staleness of the cross-system capability matrix (a 90-day gate), hook runtime smoke-test, entry-point and command-index currency (the index lives in `.claude/orchestrator/conventions.md` since 2026-09-03), Hot-Tier trigger-deadness extract (`rules-trigger-firerate.mjs`), **audit-sizing-floor net (`audit-floor-check.mjs` — flags a logged audit run below its stakes-mandated panel floor)**, **the instrument-standard audit (every new/edited `scripts/` instrument owes a real-symbol `--self-test`, a DISCRIMINATING red control per claim class, no piped-exit laundering, and explicit malformed-arg rejection)**, and **the always-loaded band-budget gate plus its held-lesson queue (`scripts/check-band-budget.mjs` + `meta/BAND-CANDIDATES.md`, added 2026-09-19 — one of three checks whose subject gates a push, beside Check 7's `skill-lint` and Check 9's hook smoke suite)**.

#### Recovery
≤5-line mechanical edits auto-applied inline. Larger reworks surface as proposals for approval.

#### Codified in
meta/SKILL.md Process — Self Audit (body in `meta/references/process-self-audit.md` since 2026-10-26), scripts/skill-lint.mjs (PluginEval Layer 1).

### 4. Sub-agent direct MEMORY write attempts

#### Pattern
Sub-agent in parallel context writes findings directly to skill MEMORY.md. Result: noisy + duplicated + out-of-order entries; the orchestrator's session-wide synthesis is bypassed.

#### Detection
`block-subagent-memory-write.sh` (PreToolUse Edit|Write matcher) denies any sub-agent Edit/Write touching `.claude/skills/*/MEMORY.md`, and fails closed when it cannot parse the tool payload. Each denial is logged.

#### Recovery
Sub-agent emits `Memory Update:` block in structured output; orchestrator extracts, deduplicates, and appends with full context. Bypass marker `/tmp/claude-meta-mem-allow` reserved for orchestrator's bulk meta operations.

#### Codified in
sub-agent MEMORY blocks, `_agent-primer.md` (the curate-layer instruction; every agent definition tells its agent to read it first — 56 of 56 at 2026-10-14, derive with `ls .claude/agents | grep -v '^_'`; the 57th file in the directory is the primer itself — nothing injects it, so a `general-purpose` dispatch does not get it; since 2026-10-18, the 41 SKILL.md rubrics that still told a seat to append to its own MEMORY.md send it to the `### Memory Update` block instead), `block-subagent-memory-write.sh` (enforce-layer hook).

### 5. Defer rot ("post-launch" labels without triggers)

#### Pattern
Audit defers items with vague labels ("post-launch", "monitor", "track after launch") and no LOC estimate, no trigger condition, no tracker entry. Items accumulate indefinitely; no one knows when to act.

#### Detection
`/audit-check` Check 8 enforces every deferred item has a corresponding tracker entry with reason + LOC + trigger. `/wrap` defer-sweep (mandatory when ≥5 defers added this session) applies the defer-sweep 3-part test.

#### Recovery
Promote defer to launch-blocker OR ship the fix inline (often <15 LOC). Defensible partial improvement beats broken status quo.

#### Codified in
defer-with-trigger gold pattern / default SHIP / split-lens scope check / skeptical defer re-pass / defer-discipline chain, `/audit-check` Check 8, `/wrap` Step 1c defer-sweep.

### 6. Parallel-session state pollution

#### Pattern
User runs multiple Claude Code sessions against the same repo. Session A stages files, Session B commits with `git add -A` and sweeps in Session A's WIP. Or both sessions edit the same MEMORY.md and one overwrites the other's append. A subtler class is a *decision-collision*: two sessions reach contradictory design decisions on the same surface (both redesign the same flow) without clobbering any file — a class with its own lesson. A third: a shared runtime file — a spec every session loads from disk, a script peers execute — edited or mutation-tested in place while peers read it (twice on 2026-10-25). Its writer-side kin is a read-shaped command that rewrites a shared state file on every call with a plain open-and-write, which concurrent seats can tear (`whose-edit`).

#### Detection
`bash-safety-warn.sh` warns on `git add -A` / `git add .` / `git add -u` / `git stash` / `--no-verify` / `--force` / `reset --hard` / `clean -f`. `commit-pathspec-warn.sh` warns on bare `git commit -m` when ≥2 files staged. Every `/wrap` commit step runs `git diff --staged --name-only`. The **session-manifest** layer adds capture-time detection: `scripts/session-manifest.py check-overlap` (tiered — BLOCK on code/migration overlap via `exit 2` unless `--allow-overlap`, WARN on coordination-files) is wired into `/expert-review` Phase 3 + peer-summary at `/orient`; its fires are logged.

#### Recovery
**Use `scripts/safe-commit.sh`.** ⚠️ This section previously said *"use `git commit -o <paths>` to bypass the shared
staged index"* — that is MEASURED WRONG and was the more dangerous half. `-o` narrows the FILE SET and then RE-READS
THE WORKTREE for those paths, so it is immune to a peer's staged *other* files and takes a peer's concurrent write to
*your* path; arriving from a hand-staged blob it was measured exiting **rc=0** while the author's own content reached
no commit at all. A BARE commit is the exact mirror: immune to the worktree write, and it takes the whole per-repo
index. Neither verb is safe alone, and picking by habit loses about half the time.

`safe-commit.sh` runs FOUR gates in the SAME PROCESS as the commit (a check from a previous tool call is already
stale): GATE 1 foreign-PATH (staged set must equal your declared set), GATE 2 index-vs-worktree drift, GATE 3 the
DELETE COLUMN (staged-vs-HEAD line counts against your declared `--del` / `--add`), and GATE 4, which parses the
staged blobs — gates 1-3 read path sets and line counts, and `tsc` and pre-push compile the worktree, so nothing else
reads the bytes actually being committed. It REFUSES rather than repairs. It NARROWS, never CLOSES — there is no
lock between gate and commit. And it never reads back the commit it made: a peer's staged files rode in twice
(2026-09-29, a peer staging between gate and commit; 2026-10-15, committed under
`--staged --drift-ok` after the refusal had warned it would commit THEIR files, 14 files where 4 were checked), so
`git show --numstat HEAD` after the commit is the only check that reads what actually landed (open in the
todo tracker).

⛔ **AND THE MODE DECIDES WHICH GATES CAN FIRE — FM6 NAMES TWO COLLISIONS AND, UNTIL NOW, THE MODE FOR NEITHER.**
DEFAULT mode stages with `git add -- "${PATHS[@]}"`, which **re-reads the worktree** — the identical mechanism this
section condemns in `-o` above. So GATE 2 is silent by construction there (the script's GATE 3 comment: *"structurally
silent exactly when you are not hand-staging"*), and on your own path only GATE 3's counts and GATE 4's parse can still
bite. **A reader who correctly diagnoses "a changed line on my path is not mine" is routed by default into the one
mode that stages it.** That collision needs `--staged` with a hand-built blob, not the default verb.
⚠️ **`--del N` is effectively REQUIRED: `EXP_DEL` defaults to 0 and the deletions check always runs, so ANY
deletion-bearing commit refuses without it — and a one-line tracker edit is 1 add / 1 del.** `--add N` is OPT-IN
(checked only when `EXP_ADD` is set); pass it on any many-writer file or the additive sweep goes unwatched.
*(Cite the script by gate name, never by line: the line numbers this section carried until 2026-09-14 had all moved.)*

Diagnose before choosing: `git diff --cached --name-only` (whose paths are staged?) and read the `+`/`-` lines on your
own path (is any changed line not mine?). If BOTH collisions are live at once there is no gated verb — disclose:
hand-gate both numstat columns in the same command as the commit and say out loud that you did.

#### Codified in
parallel-session coordination, shared-memory append discipline, sub-agent MEMORY blocks, pre-stage check, bare-commit sweeps the index, and the method lesson (the recurrence is METHOD, not verb — hand-rolling a gate instead of
grepping for the shipped one).
**`.claude/orchestrator/commit-doctrine.md`** carries the worked collision→verb pair and the numstat-column gate
(moved out of `bash-environment.md` on 2026-09-03, and delivered on the first commit-shaped Bash call of each
compaction epoch since 2026-09-09) — this section is the mid-incident summary, that file is the mechanism.

### 7. L-number reference drift

#### Pattern
Skill specs / rules / hooks / CHANGELOGs cite a lesson number for "LARP markers" — but that lesson was renumbered after a collision repair. The old citation is grammatically valid (numbers don't expire) but semantically wrong.

#### Detection
A detector exists but nothing runs it: `scripts/l-ref-drift-detect.mjs` (2026-05-23; since 2026-08-06 it reads the sharded memory, not just the router) compares each topic-tagged reference with the lesson's canonical title and skips bare `L{N}` refs. No hook, gate or skill invokes it, so in practice the class still surfaces via pushback when a cited lesson turns out to say something else. Run on 2026-09-14 it resolved canonical titles for 894 lessons, could check 68,116 of 134,111 tagged references, and flagged 12,950 of those as drifted; that output has not been triaged, so the figure says how much to look at, not how much is wrong.

#### Recovery
Going-forward convention: cite L-numbers with a short topic tag, e.g. `LARP markers`. The tag makes drift visible at read-time and gives the detector something to compare. `scripts/tag-l-refs.mjs` bulk-applies tags, and an annotation sweep is itself a drift source — the renumber-drift example in Part 1 had been mangled by one.

#### Codified in
L# topic-tag convention, the rule row for writing `L{N}` outside meta memory. The standing plan to promote the detector once ≥50% of references were tagged predates the 2026-09-05 annotation sweep and has not been re-measured since.

### 8. Compaction-boundary signal loss

#### Pattern
Session compaction replaces fine-grained per-message context with a continuation summary. `/wrap`-time scans of "what happened this session" run only over post-compact context and miss pre-compact decisions, technical-fix arcs, and lessons that were compressed into one summary bullet.

#### Detection
Before the compaction: `/pre-compact` banks the seat's state in the working plan — on the owner's order, or on the `⏳ AUTO PRE-COMPACT` line that `auto-precompact-trigger.py` (PostToolUse + UserPromptSubmit) emits about 30,000 tokens before the compaction point, switched on for every session by `.claude/state/auto-precompact-enabled` (off in a fresh copy). `compact-save.sh` (PreCompact) checkpoints state before compaction, and on a MANUAL compaction first runs `precompact-save-guard.py`, which refuses ONE owner-typed `/compact` while the `/pre-compact` save the owner asked for has not landed (at most one refusal per 600 s). `session-start.sh` (SRC=compact branch) replays the checkpoint + directs `/post-compact` (renamed from `postmortem` 2026-07-04; its own skill since 2026-09-04, with `/meta post-compact` kept as a legacy alias) as resume context, and `post-compact-pending-check.sh` (UserPromptSubmit) re-surfaces the directive every turn until it runs — was `compact-restore.sh`/PostCompact until 2026-07-03 (retired: PostCompact hook output never injects into agent context); since 2026-07-04 the directive is the script's FIRST emission, ahead of the unbounded mail dump (second occurrence: an 11-mail 44 KB dump once pushed it past the ~2 KB inline preview → 0% effective fire). `/wrap` Step 1b (mandatory when the transcript holds a compaction RECORD — `"isCompactSummary":true` or a `compact_boundary` system record — never a phrase) runs a full pre-compact-window scan.

#### Recovery
Bank, compact, recover: `/post-compact` immediately after compaction starts from the `/pre-compact` bank where one exists (its `BANK:` line — the plan bank, not the summary, is what the recovery trusts) and otherwise rebuilds the hand-off state (umbrella subject + last-exchanges + open questions) from the transcript, bringing the session's working-plan file current either way — that file, not the continuation summary, is the re-read path. `/wrap` Step 1b ensures session-end lesson extraction covers the full window, not just post-compact; on a huge window its deep variant runs as the `/deep-pass` skill.

#### Codified in
`/wrap` Step 1b, `.claude/skills/post-compact/SKILL.md`, `.claude/skills/deep-pass/SKILL.md`. Shares a root with failure mode #6 (parallel-session state).

### 9. Layer misclassification (wrong-altitude fixes)

#### Pattern
Proposing a fix at the wrong Capture/Curate/Enforce layer. Common shapes: adding more visibility (Capture fix) when signal is already loud and triage is missing (Curate gap); proposing a hook (Enforce fix) for a class that hasn't been characterized enough (no rule to enforce); adding a memory entry (Curate fix) when the rule needs to fire at composition time (Enforce gap).

#### Detection
The 30-second pause to ask *"which layer is broken — signal absent, triage missing, or activation skipped?"* before proposing a fix. `/meta learn` Step 6 only surfaces patterns seen 2+ times with no skill-level rule, as structural gaps for discussion; no step checks a proposed fix against its layer, so the pause above is the whole detector.

#### Recovery
Re-classify the gap before sinking implementation cost. Most expensive failure: building a Capture-layer dashboard for a Curate-gap, then realizing the dashboard surfaces correct signal that no one acts on. Diagnosis costs 30 seconds; the wrong-altitude fix costs hours.

#### Codified in
Architecture.md Lecture 9 ("Capture / Curate / Enforce"), meta/SKILL.md Principles. The anti-anchoring filter trace is the worked example.

### 10. Doc-prose mechanism-claim drift

#### Pattern
The human-facing prose docs (`architecture-overview.md`, `state.md`) state mechanism-specifics — a count, threshold, lifecycle-event name, an "X does Y" assertion — that silently drift as the system changes. Distinct from #3 (skill-spec drift): these are the *docs*, and `architecture-counts.mjs` / `/meta self-audit` do NOT cover them, so the drift has no detector until read cold. The reader takes the stale claim as authoritative (e.g. "nine lifecycle events" when 8 are wired; distill "≥2700" after the trigger moved to 4000).

#### Detection
`/meta doc-content-audit [<doc>]` (owner-invoked) reads each section and source-verifies every mechanism-claim against the live system. The COUNT-drift complement (`/meta architecture-audit` + `architecture-counts.mjs`) covers `architecture.md`'s numbers but not these docs' prose claims — doc-content-audit is the prose layer.

#### Recovery
Fix the claim inline against the grep'd ground truth; sweep ALL surfaces of the corrected claim (a self-claim often spans 2+ sections, and one missed policy-sweep can stale several at once); bump `last-reviewed`.

#### Codified in
`/meta doc-content-audit` Process (added 2026-06-18). Sibling of #3 (skill-spec drift / self-audit). Recurrence evidence (≥2×): architecture-overview prime "single" vs `top_n=3` (06-16); "nine"→8 lifecycle events + "docs audit themselves" overclaim (06-18); this state.md pass (06-18) — 4 stale distill/count claims from one un-swept 06-09 reframe.

### 11. Emit reaches a channel the consumer can't observe (or a store that expires first)

#### Pattern
A mechanism emits data for a downstream consumer — a model, a metric, a keep/retire decision — but into a channel the consumer never reads, OR a store that expires before the decision needs it. The emit "works" (the line is written, the hook fires) yet is inert. Two shapes: (a) exit-0 **stderr** as the delivery path to the MODEL (a UserPromptSubmit / PreToolUse hook's stderr never enters model context — only `additionalContext` / a JSON deny-reason does); (b) a metric written into a **TTL-pruned transport store** feeding a longer-horizon decision (a mail receipt in a 24–72h-pruned store feeding a ~2-week keep/retire verdict). Special case: an instrument that watches an artifact the mechanism *deliberately never produces* (mail-stats' archival read-rate vs the NON-consuming mail-listen — read-rate FALLS as the listener succeeds).

#### Detection
No standing detector — surfaces at audit (5 instances in a 2026-07-02 audit: mail-stats↔listener, budget-hook stderr-not-model ×2, PostCompact stderr, receipts-in-TTL-store). At ship time of any emit-for-a-consumer mechanism, verify BOTH (a) the consumer's actual channel (model → `additionalContext` / deny-reason, never exit-0 stderr) and (b) the store's lifetime vs the decision window it feeds.

#### Recovery
Route to the consumer-visible channel: model-facing → embed in `additionalContext` / the deny-reason string; a durable metric → an append-only `.claude/logs/*.jsonl` event log (survives TTL, and structurally can't be promoted to a consuming watermark). The mail-listen instrument was redirected from a TTL'd `.seen-by` sidecar to an append-only events log on exactly this reasoning.

#### Codified in
wired-but-inert stderr, the 2026-07-02 external-audit convergence (4 experts / 5 instances), `check-memory-budget.sh` deny-reason embed. Sibling of #9 (layer misclassification) — #9 asks *which* layer; this asks whether the chosen layer's OUTPUT actually reaches its reader.

### 12. An instrument succeeds and measures nothing

#### Pattern
A command exits 0, prints a well-formed result, and the result describes something other than the world. Not a crash
and not a wrong answer — a *plausible* answer to a question nobody asked. Measured shapes: a missing binary whose
rc=127 is swallowed by a pipe; a BSD-vs-GNU flag rejected to stderr while stdout stays empty; a `while read` dropping
the final record of a file with no trailing newline; a grep whose pattern the corpus never uses; an `rg` rooted at `.`
that cannot see `.claude/` at all; backticks inside a double-quoted `-m` silently command-substituted out of a commit
message. The failure direction is what makes it expensive — most of these fail toward a CLEAN ZERO or a CONFIDENT
PARTIAL, i.e. toward "nothing is wrong".

#### Detection
The free positive control: the instrument must find something you already know is there. A token sweep must find the
file that EMITS the token; a slicer must produce as many files as its plan has rows; an absence-grep ships with its
needle. State the expected reading BEFORE running — a count that moves in the right direction is not evidence of the
right delta.

#### Recovery
Re-derive with a second instrument blind in a DIFFERENT direction; two silences agreeing is what licenses an absence
claim, one silence never is. Never `2>/dev/null` a probe whose zero you intend to act on.

#### Codified in
`.claude/rules/bash-environment.md` — its environment-FACT half stays always-loaded (second-largest of the three unscoped
rule files); its instrument-READING half, the incident register for this class, is PARKED since
2026-09-23 in an archive no session loads (round three of
the exhortation cut; ended 2026-10-10, the park permanent), and the per-command shell traps moved to `.claude/traps/shell-traps.md` on
2026-09-21. Lessons in the class: counts not exit codes, a narrow instrument's silence is not absence, a correct
RESULT is not a correct INSTRUMENT, the vacuous control, the guard cannot see the thing it was written
for, and the deep-pass slicer that skipped its own newest slice.

### 13. Owner input lands in a channel the seat's instruments do not read

#### Pattern
The intake mirror of #11. The owner speaks — a typed line, a pasted ruling with two to four words around it, a numbered reply to a list, a tool REJECTION — and the seat's census of "what has the owner said" never sees it, so the message is delivered and never answered, or bound to the wrong question after a compaction swaps the list it referred to. Five lessons filed 2026-09-19 to 2026-09-23 (a sixth, on 2026-09-25, adds a message delivered INTO a running turn): an owner message delivered and never answered, every instrument blind to it; rulings arrive as pasted content plus a few words, so a `promptSource == "typed"` probe misses every one; a tool rejection is owner speech no `promptSource` census sees; a numbered reply binds to its list only while the list is in view; an owner question answered only in thinking after a queued skill buried it.

#### Detection
Three instruments read the intake side, all run at a boundary rather than per turn: `/wrap` Step 0 runs `queued-directive-residue-scan.py` (queued and never delivered) and `orphaned-prompt-scan.py` (delivered and never answered; since 2026-09-25 it also lists mid-turn `queued_command` attachments as a worklist), and `/post-compact` Step 4 walks the owner-speech populations with a positive control. What none reaches is a reply that exists but answers something else. Positional nets: `standby-resume-check.sh` (2026-09-23) classifies who is speaking when a parked seat wakes; the answer-beside-question rule is a rules-shard row, read on `/meta` only — neither `/working-plan` nor `/post-compact` carries it; the `session-doctrine.md` row on "no question open" says silence is an absent measurement, never a disposition.

#### Recovery
Enumerate the owner's raw turns — pasted content and tool rejections included — before writing "nothing owed"; answer an owner question in visible text before launching a queued skill; record a numbered answer against its question at the moment it lands.

#### Codified in
`.claude/orchestrator/conventions.md` (the owner-pending-decisions row) and `.claude/orchestrator/session-doctrine.md` (the "no question open" row); `/wrap` Step 0's two scans. Sibling of #11 — that one asks whether the system's OUTPUT reaches its reader; this asks whether the owner's INPUT reaches the seat.

### 14. A verdict carried past the state it measured

#### Pattern
The instrument was right when it ran; the claim built on it was reported after the thing it measured had changed, or about a neighbouring thing it never measured. Distinct from #12, where the instrument's output is false about its own target: here the reading was true of its target, and the claim was about a different one — a later tree or state or a neighbouring plane. Five lessons filed 2026-09-16 to 2026-09-23: a suite called green from a run that started before the last files of the change were written; a full-suite red read against a shared tree that a peer's commit and a peer's uncommitted edits changed mid-run; a size figure read from the worktree, carrying every peer's uncommitted lines; a feature flag's code default reported as its production state; a tracker checkbox carried forward as the state of a live dashboard setting the owner may have changed from another session.

#### Detection
None standing for these five, and none will be built — see Codified in. Each lesson names the read that exposes its own instance: the run's start time against the change's newest file; `git log --since=<run start>` over the run window, which sees only a peer's commits — 12 of that lesson's 13 failed tests were a peer's uncommitted edits, settled by a HEAD-vs-worktree compare and a re-run at the ref, and the lesson says the re-run, not the window, is what settles a red; the committed size at the sha the figure is about, `git cat-file -s <sha>:<path>`, never the worktree and never HEAD read later; the production side — the ledger rows the feature writes, or its deployed env var — never the registry default; one read-only look at the live plane before a checkbox state enters a brief, where the look was in fact taken and then filed under the record, so the read alone did not catch it (see Recovery). Two older mechanisms sit beside the class and did not prevent these instances: `bash-environment.md`'s denominator table asks for the SHA beside a pass count (always loaded since before these instances, but a SHA cannot name the dirty shared worktree a run was against), and the band gate decides on committed trees at pre-push while its headline figure is the worktree (the worktree size-figure lesson's own paragraph says the committed-tree rule existed and was not carried across). `scripts/cert.mjs` records the run-start head sha and dirty inputs beside their at-write twins, the one shipped instance of this detection, for cert runs only.

#### Recovery
Re-read at the moment of the claim, at the ref or plane the claim is about. When the fresh reading disagrees with the carried one, the disagreement is the finding — report it rather than filing it under the record.

#### Codified in
**Descriptive only, by standing rule:** this class sits inside the verify-before-assert family, and no new written enforcement is built against that family — no rule rows, band rows, sniff checks, receipt slots, primes or templates. This entry is none of those; it indexes the class for a reader diagnosing a recurrence, and was added as a description only. One of the five lessons also carries a rules-shard row in its claim-discipline section, read on `/meta` only. Sibling of #12 — that one asks whether the instrument measured anything; this one asks whether the claim is about the same ref, plane and moment as the reading. Neighbour of #10, which is this drift in a durable doc's standing prose; this one is a session's verdict carried in a sentence.

### 15. A spec cut to fit the compaction carry loses the steps its command runs

#### Pattern
An invoked SKILL.md survives a compaction only as its first 20,000 characters (and past a ~100,000-character total the carry drops whole skills), so specs are slimmed into a core plus `references/` files behind "read it first" pointers. Two shapes recur: the slim moves a step the command EXECUTES out of the core with its history (the review hub's pause-and-resume procedure, put back), and before that, a core long enough that its executed steps lay past the cut (the hub's Phase 3 serve steps, lost at every compaction until a later edit put them back), and a later edit grows the core back over the cut without running its budget test (the `/eli5` core 163 characters over the cut; `/summary` at 20,011 B over its test's 20,000-byte ceiling, still 19,643 characters and so under the cut itself, caught by a peer). A pointer is rarely followed: a reference behind a stub was opened 1 time in 251 `/post-compact` runs.

#### Detection
The per-spec budget tests (`tests/*-core-budget.test.ts`, `tests/*-core-carry.test.ts`) are unit tests, so they run with the whole unit suite at every push (the pre-push LIGHT gate runs `npx vitest run` through `scripts/pre-deploy-check.sh`) and on a pull request into main. Nothing runs them at commit time, while every session reads a spec from disk the moment it changes, so an over-cut core is live from its commit to the next push. The lesson's own remedy for that gap (its Revisit: `safe-commit.sh` runs the budget test for a staged path a test names) is not built.

#### Recovery
Keep every step the entry point executes in the core; move only history, rationale and worked examples. Run the spec's budget test before committing an edit to it.

#### Codified in
One lesson, written 2026-10-14 and reinforced 2026-10-27 over three instances from 2026-10-25 to 27. Neighbour of #8 — that one loses the session's transcript at the boundary; this one loses the instructions the session is running.

### Patterns we have NOT yet seen but watch for

- **Multi-persona compositions emerging organically.** If the orchestrator manually composes 3+ personas for the same audit 3+ times, the Persona-as-distinct-primitive question becomes load-bearing.
- **Synthesis contradictions on ≥9-expert panels.** If the same panel's findings contradict between turns of the same audit, the phase-fresh agent context pattern becomes a re-evaluation candidate.
- **Meta-hygiene gate false positives.** The CI workflow's `meta-hygiene` job left the per-push path because it took almost two hours on CI, and now runs on `workflow_dispatch`, a push to `main` and a PR into `main` (as a warning, not a `ci-gate` input), never on a `dev` push; its two arms — the hook smoke suite and `skill-lint --severity=fail` — now run as BLOCKING `.githooks/pre-push` gates (skill-lint on every push, the smoke suite when the push touches its changed-path set; `SKIP_META_HYGIENE=1` escapes skill-lint only; the smoke arm has no escape short of `SKIP_E2E_HOOK=1`, which skips the whole hook). One false RED is already on record from the CI era — a needle-validity control added to the smoke suite on 2026-08-25 read a historical blob that a depth-1 checkout does not have; fixed on 2026-08-28 with `fetch-depth: 0`, and paired on 2026-09-01 with `filter: blob:none` to keep the clone small. The local gate has one on record too: on 2026-10-14 smoke arm A12 read the live tracker, so an open hold row naming no commit turned the suite red on a valid dev push (open). If the local gate refuses 3+ consecutive valid pushes, the trigger-set is over-sensitive and needs calibration.

---

## Status updates (audit trail)

Past fragility items resolved in place. Recorded for the L# evidence chain — not load-bearing for current-state reading.

**2026-10-14 — `/meta doc-content-audit` over the whole doc set (run 10).** This file: the coherence trail extended to the 2026-10-11 reading (four consecutive runs at ≥3 contradictions), the `meta-hygiene` CI job's 2026-09-30 return to `main` pushes and PRs, failure-mode #8's Detection and Recovery gaining `/pre-compact` and the AUTO PRE-COMPACT hook, the Memory Update, owner-ruling, harness-timestamp and cold-cache entries extended through 2026-10-13 (the amendment, the four further instances and the 12-hour pause window), the agent count re-derived (56 + primer), and the 2026-05-21 distill entry's date and figure corrected. The 2026-10-11 `/meta maintain` pass had added four fragility entries without a trail entry; recorded here.

**2026-09-27 — `/meta doc-content-audit` over state.md, architecture.md and architecture-overview.md.** This file: 16 stale-claim fixes from one full-read pass — the 2026-09-16 CI meta-hygiene disablement (the watch bullet still described a CI gate), the 2026-09-23 round-three park of the sniff-test auto-fire block and of `bash-environment.md`'s instrument-reading half, the 14th self-audit check, the coherence readings of 09-19 and 09-26, and re-measured counts (bash-safety fires, flow shards, over-ceiling memory files, skills without agents, command-index bullets). Added failure-mode #13 (owner input in an unread channel — the intake mirror of #11). A second candidate — a verdict carried past the state it measured — was held at first under the no-new-enforcement rule, then went in as failure-mode #14, descriptive only (a catalog entry is none of the enforcement kinds that rule names).

**2026-09-14 — content pass (four commits, no trail entry until now).** The memory-hygiene fragility was retired in place to the byte axis (strikethrough above); the 24,985-character index cap and the announced-truncation wording were aligned with `check-memory-budget.sh`; `safe-commit.sh` gate citations moved from line numbers to gate names; the renumber-drift example that an annotation sweep had mangled was corrected.

**2026-07-19 — mail-listen GRADUATED from provisional to standing directive.** The experiment's re-based measurement window (2026-07-02 events-log ship + ~2 weeks) elapsed; the verdict read (`mail-stats.py --since 2026-07-02`, keyed on `surfaced-live` receipt coverage per the 2026-07-02 instrument fix) came back decisive: read-rate 89% (1447/1618), 160 surfaced-live listener receipts, true addressable gap 10/1618 (~0.6%), remaining unread dominated by EXITED recipients no listener can help. KEEP criteria met → PROVISIONAL banner dropped, `session-start.sh` + `mail-listen-armed-marker.sh` + `mail-listen-arm-reminder.sh` comments/emits updated, Lecture-9 prose earned (architecture.md § Cross-session messaging). The former fragile-list entry (2026-06-22 arm / 2026-07-02 instrument-fix history) is deleted and retired to this record.

**2026-07-02 — /external-audit claude-system (wave 1+2) + triaged follow-ups.** The mail-listen experiment's instrument was found blind (archival read-rate anti-correlated with the non-consuming listener) → a durable events log shipped, verdict re-keyed on receipt coverage (fragility entry above updated). **Windowed ranking:** the blindspot prime ranked on all-time share while the windowed ranking had inverted (under-justification 40→18% receding vs preference-violation 7→25% rising) → `--window 14` wired at all 3 prime call sites. **Blind verifiers:** 2 of 4 sibling verifier scripts could print ✅/✓ while blind (`architecture-counts fix` could auto-WRITE a blind regex-zero) → BLIND≠CLEAN guards added; skill-lint gained an `at N/60` self-count pattern + Hot-Tier self-count corrected (51→59→50, was stale-by-8). **Hot-Tier demotion pass:** 9 single-domain / enforcement-redundant rows → their topical tiers (active-recall 59→50/60). **preference-violation** corrections tag split into 16 sub-tags (its own 10%-split rule had fired). Added failure-mode #11 (emit-channel invisible to consumer).

**2026-06-20 — sniff-test effectiveness loop + firerate fix + memory-nav resolver (8-commit meta session).** Built `gate-effectiveness` in `/meta corrections --analyze` (per-gate registry-share before/after — the closed loop the sniff-test FAIL log never populated; **partially closes** the "promoted lessons never measured" fragility above, for the gated subset). Fixed `rules-trigger-firerate.mjs` (per-row L# attribution + cell-aware artifact exclusion — the prior "73% dead" was artifact-inflated; recalibrated to ~21% TRUE-DEAD of 75 genuine triggers). Wired `memory-graph-check.mjs` (the `[[wikilink]]` resolver + orphan/reverse-index — gave the write-only cross-link layer a reader; pre-push warn-mode). sniff-test **Check 14** (under-justification / lead-with-WHY, the #1 owner-correction @43%) shipped → rubric 13→14. Retired the stale 2026-04-15 subagent-MEMORY-write diagnostic memory. architecture.md + this doc content-audited same session.

**2026-06-18 — state.md gained a content-audit layer + first content-pass.** `/meta doc-content-audit` shipped (the CLAIM-drift complement to architecture-audit's COUNT pass) — it explicitly covers `state.md`, closing the "prose docs had no audit layer" gap. A first scan of state.md found 4 stale mechanism-claims, all from un-swept policy changes: distill thresholds (≥2700/3000 → 4000 soft-budget, never swept after the 2026-06-09 no-cliff reframe — 4 surfaces), `/meta` entry-points (13→14), self-audit checks (9→10), the meta skill's memory range (a pinned upper bound → unpinned). Added failure-mode #10 (doc-prose claim drift). Side-finding for separate fix: `check-memory-size.sh:12` header comment still reads "URGENT=2000" while the code (`:71`) is 4000.

**2026-06-13 — /meta maintain run #1 (first sequenced maintenance pass).** 6 members run. Self-audit added smoke coverage to a wired guard hook that had none (9 FIRE/SAFE assertions, suite 193/0) + 7 stale-count fixes. A spec-coherence check ran for the FIRST time (5 CONTRADICTS found+fixed — see new fragility entry). One member surfaced the supersede-marker hygiene class: 5 superseded expert verdicts unmarked → markers appended + `/decisions` gained the sweep rule. Two new rules: copy.md notify-channel parity, prompts.md AI-sibling-surface sweep.

**2026-05-21 — the meta skill's memory distilled.** The meta skill's memory had drifted to 2052 lines when the 2000 URGENT cap was crossed (2063 by the distill). `/meta distill meta` fired (2026-05-21) → 2063 → 1294. 2026-05-23 session appended further entries (among them a mass-substitution pre-flight); current state ~1598 lines, 402 headroom below URGENT cap. Cadence pattern validated: distill responds to URGENT-approach, not to every WARN-tier file.

**2026-05-23 — /wrap Step 7e shipped.** Surfaces `🔔 DISTILL-OVERDUE` warnings at session-close for any MEMORY ≥1800 lines. Closes the cadence-trigger-to-firing automation gap that previously relied on owner memory.

**2026-05-21 — project-memory index dedup.** The project-memory index had drifted to 211 lines (over the harness's 200-line limit — the vendor cap is the first 200 lines or 25 KB, whichever comes first, `code.claude.com/docs/en/memory`; the repo's gate is `CAP_BYTES` + `CAP_LINES` in `check-memory-budget.sh`, and the truncation is announced by the harness, not silent). Trimmed 211 → 158 lines via a dedup pass: dropped 5 Workflow:* topical subsections (Trigger Index duplicates), promoted 4 orphan triggers into Trigger Index. Recovered 11 truncated entries. Future cap-breach response codified in `/meta memory-audit` Step 3b.

**2026-05-17 — trigger-index hook shipped.** `trigger-index-match.sh` (UserPromptSubmit) emits matching project-memory advisories to stderr. Companion: `.claude/rules/active-recall.md` shipped same day as always-loaded in-context grep target. Two layers complementary.

**2026-05-17 — skill-lint pre-commit + CI shipped.** Pre-commit hook via `.githooks/pre-commit` runs skill-lint on staged `.claude/skills/**/*.md`. CI: the workflow's `meta-hygiene` job runs `scripts/smoke-test-hooks.sh` + `node scripts/skill-lint.mjs` on every push / PR. Three-tier verify layer: local hook on edit / local pre-push / CI on push.

---

## Companion files

- `.claude/docs/architecture.md` — architecture reference (durable, quarterly refresh).
