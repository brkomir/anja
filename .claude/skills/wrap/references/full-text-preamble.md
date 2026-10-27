# /wrap — Preamble, modes and the Iron Law — the full pre-slim text, moved, with the copy's edits, from `.claude/skills/wrap/SKILL.md` (2026-10-25)

**Not loaded on a wrap.** `../SKILL.md` is the core an invocation and every compaction carry pays for; this file holds that step's full prior text — the rulings, measurements, incident records, history and instrument commands the core condenses. **Where this file and the core disagree, the core wins.** Each `## ` section below is one step (or section) of the core, cut at the ref's line numbers, and the sections tile the pre-slim body with no gap. A `references/<file>.md` pointer inside the moved text resolves against the skill directory (`.claude/skills/wrap/`), as it did in the core. Append new history to the core's owning step reference, never to the core.

## Preamble — the appending rule and the three-layer note — from `SKILL.md` § Wrap — Session End, lines 8–26

End-of-session checklist. Ensures nothing is left hanging and all decisions are persisted.

**Appending here.** ⛔ **THIS SPEC GROWS BY ACQUIRING SECTIONS, NOT BY PARAGRAPHS PILING UP INSIDE
EXISTING ONES — so a per-entry byte cap is the wrong constraint and was never the binding one.**
Measured 2026-09-13 over the 16 days after the 2026-08-28 extraction: **15 headings to 38**, about
1,123 B each, which accounts for essentially all of its +26,954 B. **A new `##` / `###` section is
the LAST resort, not the default** — fold the point into the step that already owns it, and name the
step you considered. **A correction REPLACES the sentence it corrects; it never appends a paragraph
beneath it.** The incident record never goes into a step.

⛔ **This is LAYER ONE OF THREE AND IT DOES NOT WORK ALONE** — the enforcement is three-layer on
purpose, and measuring layer one by itself makes it look useless (the
rules files carry this clause and still grew 14-30% in the same window; what stops them is layer
two). The other two: the per-file ceiling in `scripts/check-band-budget.mjs`, which has WATCHED this
file since 2026-09-13 — warn-tier, 171,340 chars against a 150,000 limit, promoted to blocking once
every watched spec is under it — and the corpus ratchet. **Read the size before you add:** the
whole-file Read cap is 262,144 B, a skill invocation delivers this spec WHOLE, and the deep-pass
extraction that bought the current headroom bought about sixteen days of it at the measured rate.

## When to Use — the modes in full (checkpoint, light, memefy, sonnet) — from `SKILL.md` § When to Use, lines 27–47

## When to Use
End of every session, or when the user says "let's wrap up" / "that's it for now". **Not typed by the owner this turn** (started after a recovery, or on an earlier "as recommended") ⇒ the first line quotes the owner's authorizing words with their time and names the model this runs on; no such words ⇒ do not start it.

**Checkpoint mode (`/wrap --checkpoint`; the bare word `/wrap checkpoint` is an accepted alias):** same steps, same rigor — but the session CONTINUES afterward. The Output Session Summary MUST frame as **"Checkpoint complete — session still live"**, NEVER "Session closed" (the lifecycle marker is 'wrapped'/done-for-now either way; this is a framing rule, not a state change). **A checkpoint ends by checking the mail listener** (after Step 12, when that runs), because the session continues and a wrap outlasts the Monitor's 30-minute watch (median 31.7 minutes to close, measured 2026-10-15; 5 of 120 owner replies after a wrap asked for a re-arm): `kill -0 "$(cat .claude/state/mail-listen-<sid8>.pid)"` fails, or the Monitor's expiry notice arrived with no re-arm since, ⇒ re-arm it (`python3 scripts/session-manifest.py mail-listen --poll 30`, `timeout_ms: 1800000`; on the review hub add `--rebroadcast-hours 48`, `review-hub/SKILL.md` Phase 1), unless `.claude/state/session-standby-<sid8>` exists. On the review hub, check the staleness poller on its own, whatever the listener read, because it has its own 30-minute cap: `pgrep -P $PPID -f '[h]ub-stale-request-poll'` empty ⇒ re-arm it as a second Monitor, `timeout_ms: 1800000`, with this session's newest poller arm command, its filters included (`/pre-compact` Step 1 shows how to read it), else Phase 1's loop. The same standby exception applies. A live pid is a live watch: never arm a second one.

**Light mode (`/wrap --light`).** Same steps, same rigor, ONE thing changes: the Step 1b-DEEP slice target rises into the stated band, cutting the AGENT COUNT. ⛔ **THE "~240-280k TOKENS PER AGENT, FLAT" FIGURE THAT STOOD HERE IS STRUCK 2026-09-13, MEASURED ~3× TOO HIGH, AND IT WAS THE NUMBER THIS BLOCK USED TO ARGUE THE FLAG PAYS.** Six Explore/Opus agents over a 58.7 MB window at ~9.8 MB each spent **88,608 · 91,989 · 101,535 · 104,084 · 106,116 · 108,131 = 600,463 tokens**, so the real per-agent band is ~89-108k. FLAT-in-slice-size survives — the spread is 1.22×over slices that are near-identical, and the agents cannot context-read a slice that large anyway — but the LEVEL does not. ⛔ **AND PRICE THE MODE DECISION ON WHOLE-RUN COST, MAIN AGENT INCLUDED — NEVER ON AGENT COUNT.** The standing bar is a TOKEN ratio — choose light only if it is at least 2x more efficient in token usage — and agent count is not tokens: a `--light` run was reported as clearing that bar by comparing **6 agents to ~30**, which is a claim about a quantity the bar does not set. The main agent's own spend — the spec injections, the slice arithmetic, every step outside 1b-DEEP — is unchanged by the flag and belongs in both sides of the ratio, so a mode comparison that omits it overstates the saving by exactly the part that does not move. **State which denominators you used.** The mode exists to save tokens on a big session: the deep-scan agents run on 5-10 MB slices, 3-5x the default slice size.

⛔ **THE BAND IS ×3-×5 (6-10 MB) AND THE DEFAULT IS THE TOP OF IT — ×5 / 10 MB. TAKE THE LARGEST MULTIPLIER IN THE BAND; drop to a smaller one ONLY when it yields the SAME N.** *(📁 the rest of this paragraph moved, with the copy's edits, to [`references/modes-and-light-history.md`](references/modes-and-light-history.md) § Light mode — the ×3 attribution error — provenance only.)*

**Memefy mode (`/wrap --memefy`).** The only way Step 10 runs (in the source project, a write-up suggestion this copy does not ship); it combines with `--checkpoint` and `--light`. Without it Step 10 is skipped in silence.

> 📁 **Moved, with the copy's edits, to [`references/modes-and-light-history.md`](references/modes-and-light-history.md) § Light mode — who picked the multiplier, and why it is a flag** — READ IT before executing this step.

⚠️ **STATE THE TRADE IN THE WRAP OUTPUT WHENEVER `--light` IS ACTIVE**, one line: past ~2.4 MB an agent cannot context-read its slice (window arithmetic), so coverage rests entirely on its grep + windowed reads. That cut is real and UNMEASURED — say so rather than reporting a light wrap as if it were a full one.

**The bigger lever is NOT the multiplier — scope to the last checkpoint first (below), which on a re-wrapped session saves far more than the slice size does.** Measured on the session that prompted this flag: whole transcript 83.5 MB → **42 slices**; since the last `/wrap` (12.9 MB) → **7**; with `--light` at ×5 on that window → **2**. Scoping cut 83%, the multiplier cut the remaining 71%.

> 📁 **Moved, with the copy's edits, to [`references/modes-and-light-history.md`](references/modes-and-light-history.md) § Light mode — the checkpoint grep must exclude the current invocation** — READ IT before executing this step.

**Sonnet mode (`/wrap --sonnet`)** lets the operator choose Sonnet or Opus for the deep pass. ONE thing changes: the Step 1b-DEEP slice agents dispatch with `model: "sonnet"` instead of the default `model: "opus"` (mechanics in `/deep-pass` § MODEL ROUTING, including the served-model read-back and the stop: one slice first, and any launch serving anything but `claude-sonnet-5-5` ends dispatching; the wrap then continues with the undispatched region declared unscanned and one question to the owner). Every other step, every inline check and every non-slice agent is unchanged. **State it in the wrap output, one line, with the served model per slice** — or, when Step 1b-DEEP did not fire, as *"--sonnet: no deep pass fired, no slice ran"* (`--sonnet` then changes nothing; `--light` does NOT skip the deep pass, it only enlarges the slices): on 3 paired slices (2026-09-29) Sonnet 5.5 found about half what Opus 5.5 found (3 new verified items against 6), but that Sonnet arm ran at effort medium against Opus at high (read off the agents' records 2026-10-20), so it settles nothing; at matched effort and an identical brief (high on both, 2026-10-20) 4 paired slices showed no such gap: Opus found clearly more on 1 slice and somewhat more on 1, the two were level on 2, and Sonnet found items Opus missed in every pair (an earlier read of the same 4 slices with unequal briefs had shown them level); 38 unpaired slices used about the same tokens (N=4, one transcript, one unblinded scorer) — and on that result both models are a preference: neither model is the quality choice, so `--sonnet` is a preference to make on any wrap (Sonnet is cheaper per token; Opus finds modestly more; each finds items the other misses), and any later comparison runs both models on the same brief at the same explicit effort. Without the flag the slices run on Opus, whatever model the session itself is on.

## The modes COMPOSE — in full — from `SKILL.md` § The modes COMPOSE, and all three are FLAGS — `/wrap --checkpoint --light --sonnet`, lines 48–65

## The modes COMPOSE, and all three are FLAGS — `/wrap --checkpoint --light --sonnet`

**They stack because they touch disjoint things.** Checkpoint governs how the run ENDS — the
summary frames as *"Checkpoint complete — session still live"* and `session-lifecycle.py` derives
CHECKPOINT instead of WRAPPED. Light governs how the deep pass is SLICED — one multiplier on the
Step 1b-DEEP target. Sonnet governs which MODEL runs those slices. None reads another's state, so there is no interaction to reason about.
**And the combination is the NATURAL one for the case each was built for:** light exists because a
long session is expensive to wrap, and a long session is exactly what gets checkpointed rather than
closed.

> 📁 **Moved, with the copy's edits, to [`references/modes-and-light-history.md`](references/modes-and-light-history.md) § Modes compose — spelling alignment and the per-line sweep boundary** — READ IT before executing this step.

**Nothing parses any of this.** `/wrap` has no argument parser; the args are prose this spec tells
the orchestrator how to read — which is why the inconsistency survived in the first place, with no
code to fail on it and no test to catch it. **So read intent over spelling in BOTH directions:
`/wrap checkpoint --light` and `/wrap --checkpoint --light` are the same request, and neither
spelling is worth a correction to the owner.**

## Process — the Iron Law table and the held review batch — from `SKILL.md` § Process, lines 66–81

## Process

**⚠️ IRON LAW (2026-07-01 — the completion-gate the /wrap self-certification kept bypassing): NO "complete" / "N/N steps ran" / "nothing hanging" claim without a COMPUTED artifact count for every ENUMERATION the Session Summary asserts. A mandatory-fired step with no artifact is an INCOMPLETE wrap, not a complete one.** The checkmark is COMPUTED (a pasted command output + the Step-11 reconcile), never ASSERTED from memory-of-intent. Red-Flags to catch at draft-time (the rationalizations that produce a false "complete" — this file's own /wrap emitted all three, caught 3+ times):

| Rationalization | Reality |
|---|---|
| "The arc is in-context, so the mandatory scan (deep-pass) is redundant" | In-context ≠ scanned. The trigger fired on a filesystem count (`wc -l` > 1500). RUN it. |
| "I persisted the high-value subset (3 of 6 Memory Updates)" | Economizing a persist is a silent DROP unless each dropped block is a named dedupe with a `MEMORY:line` citation. State BOTH integers (N emitted → M persisted). |
| "10/10 steps ran" / "all steps complete" | "Ran" is a memory of intent. Which ARTIFACT proves each step ran? Step 11 recomputes the two it CAN (memory-delta + deep-pass); every other step needs its artifact cited inline — the tool does NOT cover them. |
| "Nothing hanging" / "the summary looks complete" | Looking-complete is the SYMPTOM of an unverified emission (the 7g behavioral guard). Run Step 11 BEFORE the summary. |
| "Step N skips — I read the gate earlier and it was under threshold" | **A SKIP-GATE READING GOES STALE INSIDE THE SAME WRAP.** Measured 2026-07-31: Step 1c was skipped on a "zero defers added this session" reading taken at 11:19, and the same wrap appended a `[ ]` defer row at ~11:22 — the gate was never re-derived, so the skip self-certified against a state its own execution had already invalidated. A wrap MUTATES the things its gates measure (defers, trackers, counts, memory size, maxL), so **re-derive at the MOMENT of skipping, never from a reading taken earlier in the run** — and when re-deriving is as cheap as running the gate, just RUN it and delete the question. (Same restatement-rot the session was codifying, inside its own wrap — the same lesson family.) |

> 📁 **Moved, with the copy's edits, to [`references/steps-8-11-output-notes.md`](references/steps-8-11-output-notes.md) § Iron Law — evidence** — provenance only.

**Held review batch — send it NOW, before Step 0** (the coherent-batch rule, early-send case (c), which replaced an earlier three-commit rule whose exception 5 this was): if you are holding commits for a review batch, mail them all to the hub in ONE request listing every sha with its refute claim. The close waits on its verdict, so every step run before the send is hub latency added to this wrap. Step 5e re-checks that it went.
