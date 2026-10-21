---
name: fleet-inquiry
description: Owner-invoked cross-session investigation — use when a question needs the fleet's per-seat evidence without an all-to-all cascade. ONE lead session analyzes, peers reply only to scoped evidence requests, pre-registered question + termination condition, findings fold once through /meta learn. The convergent topology for questions that cascade when run all-to-all on the mail bus.
---

# /fleet-inquiry — lead-and-spokes investigation across the session fleet

Converts the fleet's adversarial-verification energy (a measured asset: ~50 real errors caught in 95 min on 2026-07-27/28) into a process that **terminates**. Born from the measured contrast of one night: the same subject, same seats, same evidence ran twice — all-to-all it produced 215 broadcasts in 95 minutes with a 24% self-retraction rate; lead-and-spokes it produced a settled, evidence-cited report in a handful of tool batches with zero cascade. The variable was the topology.

**Response-mode prefix:** `[fleet-inquiry]` on the first line of every response inside the flow.

## When to invoke

Owner-invoked ONLY (like `/review-hub`) — never self-ignited, never fired from a mail event. Use when a question satisfies **all four candidate criteria**:

1. **Decidable anchor** — an enumerable artifact set exists (files, scripts, mail items, commits) and a command can settle each member. If the subject is the participants' own judgment/process with no artifact, it fails this test (that class cannot converge from inside — measured).
2. **Per-seat privileged evidence** — peers hold something disk does not: lived context, authorship intent, in-flight state. If disk alone answers it, use `Explore`/`/agent-work` in one session instead; the fleet adds only cost.
3. **Statable terminator** — "done" is writable BEFORE the first evidence request (e.g. "N/N items dispositioned", "every instrument classified"). If you cannot write the stop condition, you are about to start a thread, not an inquiry.
4. **Instrument independence** — the measuring instrument must not be the participants' self-reports about their own behavior. A self-enumerated denominator is a floor, never a total; unauditable cells cannot sum into findings (the 2026-07-28 "34 errors, zero exceptions" withdrawal).

**⛔ 5th criterion — CONSEQUENCE. Criterion 1 asks whether the question is SETTLEABLE; it never asks whether settling it CHANGES ANYTHING, so a well-anchored WORTHLESS question passes cleanly (2026-07-30).** Two multi-seat threads the same night: an attribution hunt (~40 mails, produced nothing) and a filter-shape audit (~10 mails, produced a measured root cause and a shipped one-line remedy). The distinguishing variable was **not** volume, discipline, or evidence quality — both had careful seats citing artifacts. It was whether the answer changes an action. *"Who authored this heading"* looked perfectly anchored (git commits are enumerable) and the seats believed it gated the cede rule — **but the cede rule is file-position and author-independent**, so ~40 mails resolved an input that nothing reads.

**The test is decidable in ~30 seconds and applies at JOIN time as well as at initiation: NAME THE ACTION THE ANSWER CHANGES, before you enter the thread.** A seat that ran it on the same question declined to join and lost nothing. Same question, opposite value.

Any criterion failing → not an inquiry. Owner-action-shaped questions (who deleted X / is that session alive / did the owner intend Y) fail criterion 1 structurally: in-repo instruments cannot see the owner's hands — ONE broadcast maximum, then ask the owner.

## Roles

- **Lead** — the session the owner invokes this in. Does ALL analysis, synthesis, and owner-facing reporting. Reads every peer reply as evidence, replies to none of them beyond follow-up evidence requests.
- **Spokes (peers)** — evidence providers only. Answer scoped requests, mail the lead directly (never `--to all`), do not analyze beyond the ask, do not message each other about the inquiry.
- **Owner** — rules on ambiguous items the anchor cannot settle; receives exactly one report at close.

## Process

1. **Open.** Write the charter inline BEFORE any evidence request: the question, the anchor set (enumerated or the command that enumerates it), the termination condition, and which seats hold privileged evidence for which slice. Persist the charter to the durable plane if the inquiry will span a compaction.
2. **Disk first.** Exhaust mail store / transcripts / git / trackers before tasking any peer (tasking a peer first is adding a check without applying it). Most of what peers "know" is on disk; request only the residue.
3. **Evidence requests.** One mail per seat, using the template below. Direct-addressed (`--to <sid8>`), never broadcast. Batch independent requests in one pass; peers answer in parallel.
4. **Synthesize.** Lead-only. Every load-bearing peer claim gets re-verified against disk where possible (a spoke's claim is a candidate, not ground truth); mark what rests on testimony alone. Zero-counts need a superset corpus; positive attributions need provenance independent of storage location (the 2026-07-28 asymmetry rule).
5. **Close.** Fires on the FIRST of: termination condition met · owner stop · lead declares the evidence exhausted with the condition unmet (report says so plainly). Then: (a) ONE owner-facing report, inline; (b) ONE `CLOSED` broadcast to the fleet naming the outcome — the single sanctioned all-seats message of the whole inquiry; (c) **fold-once** — surviving findings go through `/meta learn` in ONE deduped pass (codification-check against existing L#s/rules first), never per-finding commits mid-inquiry (the 51-commit accretion is the anti-pattern; 13 of those commits claimed finality and closed nothing).

## Evidence-request template

```
subject: [fleet-inquiry <slug>] evidence request — <one-line ask>
---
Inquiry: <question, one line>  ·  Lead: <sid8>  ·  Terminator: <condition>

NEEDED FROM YOU (evidence only, no analysis):
1. <exact artifact: command output / classification of YOUR items with the
   basis stated / a yes-no with the record that settles it>

Reply direct to <lead sid8>. Do NOT broadcast. Do NOT reply to other seats
about this. If you hold nothing responsive, say so in one line — that is a
real answer (an absent measurement is not a disclaim).
```

## Rules (the six that make it converge)

1. **Pre-registered question + terminator** — written before evidence request #1; scope changes re-open the charter explicitly, they don't accrete.
2. **One lead** — analysis happens in exactly one context. A spoke that disagrees with the synthesis mails the lead evidence, not the fleet an argument.
3. **Spokes never broadcast** — all inquiry traffic is point-to-point with the lead. All-to-all costs messages × N listener-wakes (~9× at current fleet size) and is the divergence mechanism itself.
4. **Owner-plane gate** — nothing reaches the owner until close, except the owner's own interjections. (The cascade emitted false claims into owner reports WHILE studying its own errors — the ~180 headline reached two owner reports mid-thread.)
5. **Fold once** — one `/meta learn` pass at close, deduped. No mid-inquiry codification.
6. **The owner outranks the terminator** — an owner stop closes the inquiry immediately, findings folded at whatever state they are in.

## Mode A — topology-2: led DELIBERATION on a fork

Topology-1 (everything above) answers a question the fleet's **evidence** settles. Topology-2 answers a
fork **evidence cannot settle** — two defensible arms where the disagreement is the point. Same spine
(one lead, spokes address only the lead, pre-registered terminator, fold once); different payload
(positions and rebuttals, not artifacts) and three additions that exist because deliberation has
failure modes evidence-gathering does not.

**Arm it only when:** a genuine undecided fork exists that is NOT disk-answerable (a grep would
dissolve it — run the grep first) · ≥2 seats BETWEEN tasks with divergent histories · a lead who
is neither the fork's author nor deep in a long context · a charter written before round 1. Owner-armed,
never self-ignited. *Anti-trigger: "the fleet is live" and "it has never run" are not forks.*

### Roles (one addition to topology-1)

- **Lead** — composes the charter, dispatches each round, synthesizes between rounds, writes the close
  report. **BARRED from holding a position or filing a rebuttal** (FC-01). A lead with a stake cannot
  strip verdicts honestly, and the synthesis is the one artifact every spoke reads.
  - **PICK A COLD (fresh) SESSION AS LEAD — it satisfies FC-01 BY CONSTRUCTION rather than by discipline** (validated across both pilot debates). A cold seat holds no position yet, so it cannot fail the rule; any already-engaged seat must *refrain* from taking a side for the whole run, and refraining is a discipline that can slip mid-synthesis exactly when the stakes peak. This is the same frame-independence axis as anti-pattern #9 — and note that a cold lead is the QUALIFICATION, not a limitation: verdict-stripped syntheses from a cold lead survived a refute-mandated breaker in both pilots. If no cold seat is available, say so in the close report as a named caveat rather than letting an engaged lead pass silently.
- **Spokes** — hold and defend a position. Address the lead only. Never message each other about the
  fork (G2 measures this, and it is the divergence mechanism itself).

### Rounds — 3, plus at most 1 logged extension (G1)

| Round | Spokes emit | Lead emits |
|---|---|---|
| **R1 — positions** | An independent position: the arm taken + its strongest anchor. Written BLIND (no peer has spoken yet). | A **verdict-stripped synthesis**: every claim and anchor, with attribution and any tallies REMOVED. |
| **R2 — rebuttals** | The strongest argument against the position they hold, plus a response to the synthesis's counter-claims. | A second verdict-stripped synthesis, plus an explicit list of what remains contested. |
| **R3 — final** | A final position, written **BLIND** to other R3 messages. | The close report. |

**Verdict-stripped** means the synthesis carries arguments and anchors but never "3 of 4 favour X" or
"the majority holds…". Spokes must respond to reasoning, not to a scoreboard — a tally is the mechanism
by which a well-argued minority silently folds (measured shape: 4 mechanisms each confirmed by 2-3
seats before the next cell killed them; N seats agreeing = N copies of one guess).

**Blind final** exists for the same reason one round later: an R3 that can see its peers' R3 is a
bandwagon round.

**Marker discipline (pilot-measured):** the lead's post-R2 synthesis — the message carrying
`contested: <n>` — goes out under the ROUND-2 marker even when bundled with the R3 request: the
thinness instrument reads `contested:` only from an R2-marked lead message (pilot 1's count existed
verbatim but read UNREADABLE under an R3 marker; pilot 2 read `ok` with the marker fixed). Dispatch
instructions describe the partial-round rule WITHOUT the literal bracket tag — G4 greps bodies, and
a MENTIONED tag is indistinguishable from a USED one (pilot 1's G4 raw 3 were the lead's own
dispatch copies). Syntheses carry no strength-of-defense disclosures ("argued at visibly different
strengths") — partial field information short of a tally is still a lead-influence edge.

### The three mandatory message fields

Every round message from a spoke carries all three, or the lead returns it unread:

- **`position:`** — the arm this seat currently holds, as a short stable label (`spine` /
  `independence`). Prose alone is not machine-comparable across rounds, and without a comparable
  label the social-convergence detector below cannot exist.
- **`basis-change:`** — what changed this seat's basis since its last message, or `none`. A position
  that moved WITHOUT a basis-change is social movement, and the field makes that visible rather than
  inferable. (`none` is a legitimate and common answer; an unchanged position with no new evidence is
  not a defect. `position:` changed **and** `basis-change: none` is the defect — see G7.)
- **An anchor-shaped citation** — a `file:line`, a command + its pasted output, or a named artifact.
  An argument with no citation is an impression; impressions do not enter the synthesis.
  ⚠️ **The gate checks SHAPE, and its name says so.** No computable check can confirm a citation
  *supports* the claim it is attached to — a well-formed `foo.ts:412` may point at a comment
  (measured: a 9-hit grep whose ground truth was 6; three matches sat in comments, one of them a
  comment stating the file deliberately lacked the thing being counted). Judging whether a citation
  bears its claim is the lead's job at synthesis; the gate only keeps unanchored impressions out.

**Run-validated mechanics (pilots 1-2, 2026-07-29 — G3 went 10/12 → 9/9 on these):**
- The R1 dispatch MUST carry a COPY-PASTE header block of the machine fields at the TOP. Prose instructions alone failed 3/3 seats on first submission (pilot 1); the block produced 100% first-submission compliance (pilot 2). The CHARTER carries the field specs too — the pilots' charters pre-dated the fields, which the charter author disclosed as the root cause of the 3/3 miss.
- ADMIN traffic (format confirmations, declines, clarification questions) carries NO round marker in subject or body — only positions/rebuttals/finals do. A marker-carrying admin message enters G3's denominator and reads as a non-compliant round message (pilot 1's G3 FAIL was exactly two format-fix confirmations).
- Bounce protocol for a non-compliant round message: the AUTHOR amends their own SENT file in place while it is unconsumed (verify no `.read` sibling first) — never lead-side corpus curation. The bounce must not SUGGEST a position-token mapping (a measured lead-influence edge; the label choice is the seat's alone).
- **An anchor must be the product of a command RUN that turn, never a recalled fragment.** Four anchors failed exactly this way across the pilots — two seats made the SAME importer error on the same file, a parameter miscount sat four unread lines from its refutation, and a LEAD mis-cite propagated seats→pins→close-report (caught only by a fresh-context reviewer). The lead spot-checks load-bearing anchors — including its OWN inherited cites — before they enter a synthesis (G3 checks shape and structurally cannot catch this).

### G7 — the social-convergence detector (REPORTED, not blocking, on run 1)

Verdict-stripping, the blind final, and `basis-change:` all target social convergence, and nothing in
G1-G6 measures it — a run could pass 6/6 while every seat quietly adopted the lead's framing. G7
counts the messages where **`position:` differs from that seat's previous `position:` AND
`basis-change: none`**. That is a position that moved with nothing behind it.

**Reported, not blocking, for the first run** (warn-before-block discipline — warn before block): no baseline exists for what
a healthy rate looks like, and a gate whose threshold is guessed fails in whichever direction the
guess was wrong. Run 1 establishes the number; it becomes blocking once there is something to
threshold against.

**Expected-zero limit (measured, pilots 1-2):** a G7 reading of 0 in
a run where NO position token ever moved proves the detector EXECUTES, not that it DETECTS — the
zero has no positive control (a `basis-change: none` on a MOVED position has never been seen by
the instrument in the wild). Report it as "raw 0, undischarged", never "G7 clean"; the first round
where a seat actually moves is what exercises it.

### Pre-registered thinness criterion — written BEFORE the pilot

A debate can satisfy every gate and still be too thin to have tested anything. Judged after the run,
that call gets rationalised toward whatever happened; so it is fixed now:

> **If R2 produces ZERO contested items, the debate was too thin** — the round budget or the
> lead-bar (or both) is wrong, and run 1 is informative in that direction rather than inconclusive.

The lead's R2 synthesis therefore carries a `contested: <n>` count line, which makes the criterion
computable rather than a judgement call. This settles the two open design questions (is 3 rounds
right? does barring the lead starve a 2-3 seat debate?) after ONE run instead of by argument now —
neither has evidence today, and a confident answer without evidence is the error this protocol exists
to catch.

### `[PARTIAL-ROUND]` (G4)

A member that does not reply inside the round window is **an absent measurement, not a concession**.
The round proceeds tagged `[PARTIAL-ROUND]`, the close report names who was absent for which
round, and its confidence is **capped at Medium**. Never infer a position from silence.

### Close (G6)

One report to the owner, at close, containing: the fork as pre-registered · each surviving position
with its anchors · what stayed contested · **and a recommendation**. A split does NOT get reported as a
tie — the lead recommends, and says what would change its mind. Then the single sanctioned `CLOSED`
broadcast, then **fold once** through `/meta learn`.

### Health gates — computed, never asserted

`scripts/fleet-mode-a-health.mjs <slug>` derives G1-G5 + G7 from `.claude/logs/mail-events.jsonl` + the
mail store and prints a PASS/FAIL table. Run it BEFORE writing the close report; paste its output into
the report. G6 is a human read of the report's own shape. **The lead does not self-score the gates** —
that is the pilot validating itself, which is exactly what the fresh-context breaker on the run
report is for.

**Convention this instrument establishes: a measurement states its own blind spots in its own
output.** Every gate here prints what it *cannot* see next to what it measured — G2 is exact about
accidental cascade and blind to deliberate out-of-band coordination; G3/G4 read bodies, so a deleted
message is invisible to them; G3 checks citation shape, never whether the citation bears its claim. A
reader quoting a gate into a run report inherits the caveat with the number instead of having to
remember it. Apply this to any instrument whose readings become an argument.

**Standing lead practice (pilot-measured):** the lead's mail-listener missed ~1 live inbound per
round across both pilots (found via transcript probe / store poll, never by waiting). Arm a
store-level completeness poll per round — count expected reply files by sender against an
ns-stamp baseline — as the fallback wake; the STORE, not the listener, is ground truth for
arrival.

## Anti-scope

- **Not for code review** (`/review-hub`), **not consultation** (`/expert-review`), **not implementation** (`/agent-work`). It is a forensic/audit topology for cross-session questions.
- **Never emergent.** A seat that sees an inquiry-shaped question mid-flight files it as a CANDIDATE (todo row or mail to the owner's active session) — it does not open one.
- **Not a broadcast-suppression regime.** Normal product traffic (verdicts, folds, claim-or-disclaim on artifacts, handoffs) is untouched — the 2026-07-27 morning ran 188 such messages, product-anchored, and every thread closed. This skill governs only the process-referent class that measurably cannot.
- **No new instruments mid-inquiry.** If the anchor's settling command doesn't exist, building it is the first evidence task — validated in BOTH directions before its readings are load-bearing (a discriminator validated on one side is not a discriminator).

## Provenance & revisit

Codified from the measured forensics of the 2026-07-27/28 mail cascade: ignition 22:58:15Z (a correct claim-or-disclaim broadcast), pivot 23:30:36Z (the anchor question was answered; a stand-down instruction had no mechanism), 215 messages / 95 min / one per 26 s / 52 self-retraction subjects / 6 product-anchored, 51 commits in 68 min, ended by an explicit stop at 00:32:58Z with exactly one post-stop message. Contrast arms: same-morning product-anchored traffic (188 msgs, all threads closed) and the same-night hub-and-spoke re-analysis (converged, zero cascade).

**Revisit:** after 3 runs, compare per-inquiry message count + cascade incidents vs the 2026-07-27 baseline. If a led inquiry still cascades, the topology hypothesis is falsified — re-examine subject-class instead. If no inquiry-shaped question surfaces in 60 days, fold this into `/mail`'s spec as a section and retire the standalone skill.
