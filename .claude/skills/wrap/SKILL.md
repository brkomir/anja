---
name: wrap
description: End-of-session checklist. Use at session end to verify nothing is left hanging and all decisions are persisted.
---

# Wrap — Session End

End-of-session checklist. Ensures nothing is left hanging and all decisions are persisted.

**Appending here.** ⛔ **THIS SPEC GROWS BY ACQUIRING SECTIONS, NOT BY PARAGRAPHS PILING UP INSIDE
EXISTING ONES — so a per-entry byte cap is the wrong constraint and was never the binding one.**
Measured 2026-09-13 over the 16 days after the 2026-08-28 extraction: **15 headings to 38**, about
1,123 B each, which accounts for essentially all of its +26,954 B. **A new `##` / `###` section is
the LAST resort, not the default** — fold the point into the step that already owns it, and name the
step you considered. **A correction REPLACES the sentence it corrects; it never appends a paragraph
beneath it.** The incident record never goes into a step.

⛔ **This is LAYER ONE OF THREE AND IT DOES NOT WORK ALONE** — the enforcement is
three-layer on purpose, and measuring layer one by itself makes it look useless (the
rules files carry this clause and still grew 14-30% in the same window; what stops them is layer
two). The other two: the per-file ceiling in `scripts/check-band-budget.mjs`, which has WATCHED this
file since 2026-09-13 — warn-tier, 171,340 chars against a 150,000 limit, promoted to blocking once
every watched spec is under it — and the corpus ratchet. **Read the size before you add:** the
whole-file Read cap is 262,144 B, a skill invocation delivers this spec WHOLE, and the deep-pass
extraction that bought the current headroom bought about sixteen days of it at the measured rate.

## When to Use
End of every session, or when the user says "let's wrap up" / "that's it for now".

**Checkpoint mode (`/wrap --checkpoint`; the bare word `/wrap checkpoint` is an accepted alias):** same steps, same rigor — but the session CONTINUES afterward. The Output Session Summary MUST frame as **"Checkpoint complete — session still live"**, NEVER "Session closed" (the lifecycle marker is 'wrapped'/done-for-now either way; this is a framing rule, not a state change). Reporting a checkpoint as a session close is the error this rule prevents. **A checkpoint ends by checking the mail listener** (after Step 12, when that runs), because the session continues and a wrap outlasts the Monitor's 30-minute watch (median 31.7 minutes to close, measured 2026-10-15; 5 of 120 owner replies after a wrap asked for a re-arm): `kill -0 "$(cat .claude/state/mail-listen-<sid8>.pid)"` fails, or the Monitor's expiry notice arrived with no re-arm since, ⇒ re-arm it (`python3 scripts/session-manifest.py mail-listen --poll 30`, `timeout_ms: 1800000`; on the review hub add `--rebroadcast-hours 48`, `review-hub/SKILL.md` Phase 1), unless `.claude/state/session-standby-<sid8>` exists. On the review hub, check the staleness poller on its own, whatever the listener read, because it has its own 30-minute cap: `pgrep -P $PPID -f '[h]ub-stale-request-poll'` empty ⇒ re-arm it as a second Monitor, `timeout_ms: 1800000`, with this session's newest poller arm command, its filters included (`/pre-compact` Step 1 shows how to read it), else Phase 1's loop. The same standby exception applies. A live pid is a live watch: never arm a second one.

**Light mode (`/wrap --light`).** Same steps, same rigor, ONE thing changes: the Step 1b-DEEP slice target rises into the band below, cutting the AGENT COUNT. ⛔ **THE "~240-280k TOKENS PER AGENT, FLAT" FIGURE THAT STOOD HERE IS STRUCK 2026-09-13, MEASURED ~3× TOO HIGH, AND IT WAS THE NUMBER THIS BLOCK USED TO ARGUE THE FLAG PAYS.** Six Explore/Opus agents over a 58.7 MB window at ~9.8 MB each spent **88,608 · 91,989 · 101,535 · 104,084 · 106,116 · 108,131 = 600,463 tokens**, so the real per-agent band is ~89-108k. FLAT-in-slice-size survives — the spread is 1.22×over slices that are near-identical, and the agents cannot context-read a slice that large anyway — but the LEVEL does not. ⛔ **AND PRICE THE MODE DECISION ON WHOLE-RUN COST, MAIN AGENT INCLUDED — NEVER ON AGENT COUNT.** The standing bar is a TOKEN ratio — light is chosen only when it is at least twice as token-efficient — and agent count is not tokens: a `--light` run was once reported as clearing that bar by comparing **6 agents to ~30**, which is a claim about a quantity the bar does not measure. The main agent's own spend — the spec injections, the slice arithmetic, every step outside 1b-DEEP — is unchanged by the flag and belongs in both sides of the ratio, so a mode comparison that omits it overstates the saving by exactly the part that does not move. **State which denominators you used.** The mode exists to save tokens on a big session: the deep-scan agents run on 5-10 MB slices, three to five times the default slice size.

⛔ **THE BAND IS ×3-×5 (6-10 MB) AND THE DEFAULT IS THE TOP OF IT — ×5 / 10 MB. TAKE THE LARGEST MULTIPLIER IN THE BAND; drop to a smaller one ONLY when it yields the SAME N.** *(📁 the rest of this paragraph moved, with the copy's edits, to [`references/modes-and-light-history.md`](references/modes-and-light-history.md) § Light mode — the ×3 attribution error — provenance only.)*

**Memefy mode (`/wrap --memefy`).** The only way Step 10 runs (in the source project, a write-up suggestion this copy does not ship); it combines with `--checkpoint` and `--light`. Without it Step 10 is skipped in silence.

> 📁 **Moved, with the copy's edits, to [`references/modes-and-light-history.md`](references/modes-and-light-history.md) § Light mode — who picked the multiplier, and why it is a flag** — READ IT before executing this step.

⚠️ **STATE THE TRADE IN THE WRAP OUTPUT WHENEVER `--light` IS ACTIVE**, one line: past ~2.4 MB an agent cannot context-read its slice (window arithmetic), so coverage rests entirely on its grep + windowed reads. That cut is real and UNMEASURED — say so rather than reporting a light wrap as if it were a full one.

**The bigger lever is NOT the multiplier — scope to the last checkpoint first (below), which on a re-wrapped session saves far more than the slice size does.** Measured on the session that prompted this flag: whole transcript 83.5 MB → **42 slices**; since the last `/wrap` (12.9 MB) → **7**; with `--light` at ×5 on that window → **2**. Scoping cut 83%, the multiplier cut the remaining 71%.

> 📁 **Moved, with the copy's edits, to [`references/modes-and-light-history.md`](references/modes-and-light-history.md) § Light mode — the checkpoint grep must exclude the current invocation** — READ IT before executing this step.

**Sonnet mode (`/wrap --sonnet`)** — a flag that lets the operator run the slices on Sonnet 5.5 instead of the default Opus. ONE thing changes: the Step 1b-DEEP slice agents dispatch with `model: "sonnet"` instead of the default `model: "opus"` (mechanics in `/deep-pass` § MODEL ROUTING, including the served-model read-back and the stop: one slice first, and any launch serving anything but `claude-sonnet-5-5` ends dispatching; the wrap then continues with the undispatched region declared unscanned and one question to the owner). Every other step, every inline check and every non-slice agent is unchanged. **State it in the wrap output, one line, with the served model per slice** — or, when Step 1b-DEEP did not fire, as *"--sonnet: no deep pass fired, no slice ran"* (`--sonnet` then changes nothing; `--light` does NOT skip the deep pass, it only enlarges the slices): a first read of 3 paired slices had Sonnet 5.5 finding about half what Opus 5.5 found (3 new verified items against 6), but that Sonnet arm ran at effort medium against Opus at high, so it settles nothing; at matched effort and an identical brief (high on both), 4 paired slices showed no such gap: Opus found clearly more on 1 slice and somewhat more on 1, the two were level on 2, and Sonnet found items Opus missed in every pair (an earlier read of the same 4 slices with unequal briefs had shown them level); 38 unpaired slices used about the same tokens on either model (4 pairs from one session, scored by one reader who knew which model was which, so a first reading, not a result) — so `--sonnet` is a preference the operator makes on any wrap, not a quality call (Sonnet is cheaper per token; Opus finds modestly more; each finds items the other misses), and any later comparison runs both models on the same brief at the same explicit effort. Without the flag the slices run on Opus, whatever model the session itself is on.

## The modes COMPOSE, and all three are FLAGS — `/wrap --checkpoint --light --sonnet`

**They stack because they touch disjoint things.** Checkpoint governs how the run ENDS — the
summary frames as *"Checkpoint complete — session still live"* and `session-lifecycle.py` derives
CHECKPOINT instead of WRAPPED. Light governs how the deep pass is SLICED — one multiplier on the
Step 1b-DEEP target. Sonnet governs which MODEL runs those slices. None reads another's state, so there is no interaction to reason about.
**And the combination is the NATURAL one for the case each was built for:** light exists because a
long session is expensive to wrap, and a long session is exactly what gets checkpointed rather than
closed. So `/wrap --checkpoint --light` stacks.

> 📁 **Moved, with the copy's edits, to [`references/modes-and-light-history.md`](references/modes-and-light-history.md) § Modes compose — spelling alignment and the per-line sweep boundary** — READ IT before executing this step.

**Nothing parses any of this.** `/wrap` has no argument parser; the args are prose this spec tells
the orchestrator how to read — which is why the inconsistency survived in the first place, with no
code to fail on it and no test to catch it. **So read intent over spelling in BOTH directions:
`/wrap checkpoint --light` and `/wrap --checkpoint --light` are the same request, and neither
spelling is worth a correction to the owner.**

## Process

**⚠️ IRON LAW (2026-07-01 — the completion-gate the /wrap self-certification kept bypassing): NO "complete" / "N/N steps ran" / "nothing hanging" claim without a COMPUTED artifact count for every ENUMERATION the Session Summary asserts. A mandatory-fired step with no artifact is an INCOMPLETE wrap, not a complete one.** The checkmark is COMPUTED (a pasted command output + the Step-11 reconcile), never ASSERTED from memory-of-intent. Red-Flags to catch at draft-time (the rationalizations that produce a false "complete" — this file's own /wrap emitted all three, more than once):

| Rationalization | Reality |
|---|---|
| "The arc is in-context, so the mandatory scan (deep-pass) is redundant" | In-context ≠ scanned. The trigger fired on a filesystem count (`wc -l` > 1500). RUN it. |
| "I persisted the high-value subset (3 of 6 Memory Updates)" | Economizing a persist is a silent DROP unless each dropped block is a named dedupe with a `MEMORY:line` citation. State BOTH integers (N emitted → M persisted). |
| "10/10 steps ran" / "all steps complete" | "Ran" is a memory of intent. Which ARTIFACT proves each step ran? Step 11 recomputes the two it CAN (memory-delta + deep-pass); every other step needs its artifact cited inline — the tool does NOT cover them. |
| "Nothing hanging" / "the summary looks complete" | Looking-complete is the SYMPTOM of an unverified emission (the 7g behavioral guard). Run Step 11 BEFORE the summary. |
| "Step N skips — I read the gate earlier and it was under threshold" | **A SKIP-GATE READING GOES STALE INSIDE THE SAME WRAP.** Measured 2026-07-31: Step 1c was skipped on a "zero defers added this session" reading taken at 11:19, and the same wrap appended a `[ ]` defer row at ~11:22 — the gate was never re-derived, so the skip self-certified against a state its own execution had already invalidated. A wrap MUTATES the things its gates measure (defers, trackers, counts, memory size, maxL), so **re-derive at the MOMENT of skipping, never from a reading taken earlier in the run** — and when re-deriving is as cheap as running the gate, just RUN it and delete the question. (Same restatement-rot the session was codifying, inside its own wrap.) |

> 📁 **Moved, with the copy's edits, to [`references/steps-8-11-output-notes.md`](references/steps-8-11-output-notes.md) § Iron Law — evidence** — provenance only.

**Held review batch — send it NOW, before Step 0** (the coherent-batch rule's early-send case (c); it replaced an earlier three-commit rule, whose exception 5 this was): if you are holding commits for a review batch, mail them all to the hub in ONE request listing every sha with its refute claim. The close waits on its verdict, so every step run before the send is hub latency added to this wrap. Step 5e re-checks that it went.

**0. Session manifest write + prune (MANDATORY at /wrap start).** Run:

```bash
# GATE — MUST print a positive verdict; silence is NOT a pass (see below)
: "${CLAUDE_CODE_SESSION_ID:? GATE ABORT — session id unset, the gate cannot be evaluated}"
M=".claude/state/post-compact-pending-$CLAUDE_CODE_SESSION_ID"
C=".claude/state/post-compact-cleared-$CLAUDE_CODE_SESSION_ID"
# 📁 moved, with the copy's edits, to .claude/skills/wrap/references/step0-gate-notes.md § The marker gate — why three branches — provenance only
if [ -f "$M" ]; then echo "🧠 MARKER PRESENT (sid=$CLAUDE_CODE_SESSION_ID): $(cat "$M")"
elif [ -f "$C" ]; then echo "⚠️  GATE UNINFORMATIVE (sid=$CLAUDE_CODE_SESSION_ID) — a recovery ran THIS session and cleared the marker at $(cat "$C"); this reading is not an independent check"
else echo "✅ GATE CLEAR (sid=$CLAUDE_CODE_SESSION_ID) — neither marker is present for THIS session (present tense: this cannot rule out a clear that left no breadcrumb)"; fi
# 📁 moved, with the copy's edits, to .claude/skills/wrap/references/step0-gate-notes.md § The marker gate — the CLEAR wording is the predicate's — provenance only
python3 scripts/session-manifest.py write              # snapshot final session state
python3 scripts/session-manifest.py prune              # cleanup manifests for sessions stale >24h
python3 scripts/session-manifest.py mail-check --peek  # surface (NON-consuming) any mid-session inbound mail BEFORE winding down
python3 scripts/queued-directive-residue-scan.py       # rc 0 clean · 3 residue (READ IT) · 1 instrument failure
python3 scripts/orphaned-prompt-scan.py                # rc 0 clean · 3 residue (READ IT) · 1 instrument failure
python3 scripts/session-lifecycle.py wrapped           # stamp WRAPPED intent marker (done-for-now signal)
#   ⛔ IN CHECKPOINT MODE (`/wrap --checkpoint`) PASS THE FLAG: `… wrapped --checkpoint`.
# 📁 moved verbatim to .claude/skills/wrap/references/step0-gate-notes.md § Checkpoint flag — spelling and marker history — provenance only
#   ⚠️ Intent is DECLARED, never inferred — omit the flag on a checkpoint and the run is
#   indistinguishable from a close again, which is the whole defect this closes.
```
> 📁 moved verbatim to .claude/skills/wrap/references/step0-gate-notes.md § Queued-directive residue scan — founding incident — **READ IT before executing this step** (a reference-file pointer, not the scan-output legend above)
> 📁 moved, with the copy's edits, to .claude/skills/wrap/references/step0-gate-notes.md § Orphaned-prompt scan — founding incident and the wrong predicate — **READ IT before executing this step** (a reference-file pointer, not the scan-output legend above)

**⛔ GATE — do NOT advance past Step 1 while `.claude/state/post-compact-pending-<sid>` exists.** If the marker is present, NAME it in your very next response, then act on it, *before* continuing the wrap:
- `focus=no` (auto-compaction, or a bare `/compact`) → the skip gate does **not** hold. Run `/post-compact`.
- `focus=yes` → **READ `focus_args` AND JUDGE IT. The flag alone does NOT sanction the skip.** It measures only that the `/compact` slot was non-empty, and a shell hook cannot tell a CURATION OF THE CUTOFF (an argument naming a thread to keep — the cutoff was chosen, so a skip is sanctioned) from a DIRECTIVE that happens to be typed in the same slot (an instruction about what to do after the compaction — nothing was curated, so the skip is NOT eligible and you run the recovery). ⛔ **MEASURED 2 OF 2 IN ONE SESSION: both arguments were directives and both produced `focus=yes`.** Both were declined by hand at the gate, so nothing was lost — but declining took judgement the flag was supposed to supply, which is the defect. `compact-save.sh` now emits `focus_args=<the argument>` on the marker line for exactly this read (2026-09-09; before that the argument was invisible and the boolean was all you had). **Name the decision out loud either way, and quote the argument you judged.**
- Either way, the marker must be **cleared** (`rm` it) — it tracks *"recovery decision made"*, not *"brief produced"*. ⛔ **ONE EXCEPTION, AND IT DOES NOT BLOCK THE WRAP: `python3 scripts/post-compact-deferral.py status --sid $CLAUDE_CODE_SESSION_ID` exiting 0 (`DEFERRED`) means Claude Code fired its pre-compaction hook and no compaction has landed (an automatic one fires early under the compact point; a manual /compact can be refused at the session limit), and `/post-compact` Step 1 already deferred it.** The marker stands on purpose, so name it — "pre-compaction hook fired, no compaction landed yet" — and continue past Step 1. Never say a compaction was "prepared": the word reads as something the owner did. Exit 1 (`OWED`) is the ordinary case: run `/post-compact`, which itself decides recover-or-defer. Step 11's reconcile reads the same script.

⛔ **AND THE GATE ABOVE CAN RETURN A CLEAR THAT GOES STALE SECONDS LATER — BECAUSE AN AUTO-COMPACTION CAN FIRE *MID-WRAP* AND `compact-save.sh` (PreCompact) WRITES THE MARKER AT THAT MOMENT (measured 2026-08-12; mechanism CORRECTED the same day by two independent reviews).**

> 📁 **Moved, with the copy's edits, to [`references/step0-gate-notes.md`](references/step0-gate-notes.md) § Post-compact gate — the mid-wrap compaction measurement and corrected mechanism** — provenance only.

**Check, still free and still worth it:** re-derive the `[ -f ]` at the END of Step 0 as well as the start — it catches a marker written *during* Step 0, which is exactly the 35 ms window above. And if this turn's SessionStart output carries a post-compact directive, the gate is not clear whatever `[ -f ]` returned (two instruments, PRESENT wins). The Stop-hook (`exit 2`) graduation named below supersedes both.

> 📁 **Moved, with the copy's edits, to [`references/step0-gate-notes.md`](references/step0-gate-notes.md) § Post-compact gate — why a step, and the enforce layer** — READ IT before executing this step.

Ensures next session's `/orient` sees this session's final state in its peer-summary read. Cost: ~150ms. Skip rule: trivial sessions (<5 messages) MAY skip the write+prune — manifest will be stale-pruned within 24h anyway (but NOT the mail-check — see below).

**Inbound-mail peek (shipped 2026-06-19) — the wrap-time half of the cross-session mail surface.** `mail-check --peek` closes the one window the existing surfaces miss: the `SessionStart` hook auto-surfaces mail waiting at session START, but mail that arrives MID-session (a peer's handoff/correction sent while you were working) has no push — without this you'd only catch it via a manual `/mail check`. The wrap is the natural bounded moment to catch it: you're deliberately winding down, and a handoff mailed to a session about to go quiet shouldn't silently sit (with the typical 2–4 concurrent sessions, mid-session cross-mail is the common case). Load-bearing specifics:
- **`--peek` is non-consuming (NOT a normal read).** It surfaces WITHOUT archiving — a heads-up, not a receipt. So if you choose not to act, the message stays unread and the next live `SessionStart` still properly receives it. A consuming read here would mean "carry it forward" silently loses the message (archived-then-never-acted). The mild re-surface on each of the 2–5× re-wraps is the safe direction (a standing reminder for an un-handled handoff), not a bug.
- **Deliver-and-surface holds.** Surface the advisory block to the owner; NEVER auto-apply code/actions from it (identical discipline to `/mail check` — the whole feature's safety model).
- **Runs even on trivial (<5-msg) sessions** — unlike the manifest write+prune, inbound mail is an EXTERNAL trigger independent of how much THIS session did; a 3-message session can still have a peer's handoff waiting.
> 📁 **Moved verbatim to [`references/step0-gate-notes.md`](references/step0-gate-notes.md) § Inbound-mail peek — placement and latency rationale** — provenance only.
- ⛔ **NEVER CAP THE PEEK, AND ENUMERATE SUBJECTS RATHER THAN BODIES.** ⛔ **AND NEVER GREP THE PEEK STREAM FOR A SUMMARY WORD (N=2):** the answer is the tool's own header line `(N message(s) for session …)` at line 3 of the peek file; a `grep -m1 'unread'` (lowercase, case-sensitive, against a header that spells UNREAD) matched a mail BODY at line 2454 and *"Nothing owed on this thread"* reached context as the inbox's size (2026-09-03). `| head -N` on this line turns the backstop into a green-looking step: measured, `--peek 2>&1 | head -8` printed the FIRST message's header out of **86**, and the step reported done. This peek IS the codified structural net for the measured listener-drops-a-message failure (N=2 — two ⛔STOPs sat in two stores with ZERO context records), so a cap here defeats the one net that does not depend on the listener working. `.claude/traps/shell-traps.md` § READ COUNTS, NEVER A PIPED EXIT CODE already bans capping a WORKLIST; nothing connected that ban to this step, and this step's spec did not say uncapped — which is the whole gap. ⛔ **AND THE TOOL'S OWN SUBJECT MODE CANNOT DELIVER THIS — `--summary` IS HARD-CAPPED** (`SUMMARY_TOTAL_CAP`; measured on a live inbox, 381 unread rendered as **3 shown** plus one skimmable *"378 more not shown"* line, i.e. 0.8% coverage) — the green-looking step this bullet exists to prevent, wearing the bullet's blessing. The uncapped path is one command: `grep -h '^subject:' .claude/state/session-mail/<me>__*.md | wc -l` (374 on this seat's store at writing). **Subjects are bounded, bodies are not** — that asymmetry is presumably why capping felt necessary, so enumerate SUBJECTS for everything unread and read bodies only for what you disposition. ⚠️ A partial mitigation was in place BY LUCK the day this was found (a separate after-cutoff subject enumeration happened to catch the one live item); that answers "what arrived recently", never "what is stranded in the store".

> 📁 **Moved, with the copy's edits, to [`references/step0-gate-notes.md`](references/step0-gate-notes.md) § Lifecycle marker — how the WRAPPED stamp works (8-hex key)** — READ IT before executing this step.

**Awaiting-peer wake (cross-session `mail-await`, shipped 2026-06-21).** The `session-wrapped` marker above doubles as a go-signal: a peer blocked on YOUR completion via `mail-await --peer-done <your-sid>` (armed in a Bash `run_in_background` loop) is woken AUTOMATICALLY when you wrap or exit — no action needed here. The one manual case is an *explicit* green-light you give BEFORE wrapping (e.g. "my part is safe, proceed"): `python3 scripts/session-manifest.py mail-send --to <sid8> --signal <tok>`. See `/mail` → "Process — await".

1. Run `/hanging-work` check (uncommitted changes, unstaged files, **defer-triggers-fired scan** — catches defers whose blockers resolved via cross-session commits)
1a. **Stale-classification sweep (stale classification re-verify, mandatory when audit-check ran this session with non-(a) e2e classifications).** For every Check 10 failure classified `(b) flake` or `(c) pre-existing` during this session, the audit-check output recorded (classified-at-commit, surface-files). Sweep:
   - For each classification: `git diff --name-only <classified-at>..HEAD` → does any path match the recorded surface files?
   - If yes: the classification is stale — re-run the test. If now passing, note as closed. If still failing but with a NEW root cause in this session's code, treat as regression (route to `/agent-work` or fix inline, don't close the session with the old label).
   - If no matches for any: sweep passes silently.

   > 📁 **Moved, with the copy's edits, to [`references/step1-evidence.md`](references/step1-evidence.md) § Step 1a — why here** — provenance only.

   **Consumer of:** `/audit-check` Check 10 Step 4a provenance data. If Step 4a wasn't run (old audit-check invocations without provenance), skip the sweep and flag it as a gap for next audit.

1a-ii. ⛔ **STRANDED-FOLD SWEEP — INTERSECT THE DIRTY SET WITH *THIS SESSION'S OWN COMMIT FILE-SET*, NEVER READ THE DIRTY SET RAW (2026-09-21).** Step 1's "uncommitted changes, unstaged files" is a WHOLE-TREE read, and on this shared worktree that is 40-plus files of peer work. **A raw dirty list does not fail to report your stranded fold — it BURIES it, and the burial reads as peer noise**, which is precisely the conclusion a careful seat draws. Measured on one multi-flow audit session: **FIVE of one session's own folds sat unstaged at wrap time**, including two that were un-landed MUST-FOLDS from a review already certified closed, and one that was **live on HEAD as a wrong sentence on a user-facing surface** (a caller passing an ICU arg the value did not declare, which is ignored rather than thrown, so every curation surface said "critique"). All five were found by accident while cleaning up, not by any check.

   **The instrument — partition by THIS SESSION'S OWN LABELS, never by a commit range — and the narrowing is the whole value.** ⛔ **A seat labels its commits THREE ways and the 8-hex trailer is the minority:** (1) `Claude-Session: <sid8>`, (2) `Claude-Session: <harness-session-url>` — the harness attribution block, whose URL changes across remote reconnects and is recorded in this session's transcript as `remote_session_change` attachments, and (3) a subject scope that ENDS in the sid, `wrap(<sid8>):` / `meta(learn <sid8>):`. Until 2026-09-29 this block matched (1) alone and its guard fired only on an EMPTY list, so a PARTIAL list passed silently: on one session it found **60 of 186** commits and the 28 Sep checkpoint wrap cleared its sweep on that. The scope in (3) must END in the sid — `fold(<hub> <batch> on <sha>)` names a REVIEWER, and the looser form credited two of this seat's folds to the hub — and it is read only when the commit carries NO trailer. **The reader is `scripts/session-labels.py`, ONE copy for this step, Step 7, Step 8a, `/summary`'s fold plane and `/sanity-check`** (it had been copied three times inside this file alone); its docstring carries the measurements — 0 commits claimed by two seats across all 291 transcripts — and its one known limit: a continued-in session inherits its predecessor's LAST remote URL.
   ```bash
   W=$(mktemp -d)   # per-run scratch: fixed /tmp paths let two wrapping seats clobber each other
   python3 scripts/session-labels.py mine > $W/mine-commits.txt   # all three labels; READ the count line it prints on stderr (exit 2 = instrument failure)
   [ -s $W/mine-commits.txt ] || { echo "NO COMMIT CARRIES ANY OF THIS SESSION'S LABELS — instrument failure, NOT an all-clear" >&2; exit 1; }
   xargs -n1 git show --name-only --format= < $W/mine-commits.txt | sed '/^$/d' | sort -u > $W/mine.txt
   [ -s $W/mine.txt ] || { echo "MINE-LIST EMPTY — instrument failure, NOT an all-clear" >&2; exit 1; }
   git status --porcelain | LC_ALL=C cut -c4- | sort > $W/dirty.txt   # cut, not awk: a skill invoked WITH arguments has awk's dollar-digit fields replaced by the argument words (measured 2026-09-21: delivered as substr(--light,4)); the pin only restores parity with the old awk on invalid bytes
   comm -12 $W/mine.txt $W/dirty.txt
   ```
   **Then READ each survivor's diff — do not infer from the name, and do not clear it with `whose-edit`.** That tool cannot see a python-heredoc or a `>` redirect write, so its silence on your own file is not evidence; the four of the five it was asked about returned no author at all. A survivor can still carry another session's lines, because shared tracker files sit in every seat's commit set, so read the diff for YOUR content before staging; on a fold wave the comments usually name the verdict that produced them.

   ⭐ **The output is a POSITIVE statement — *nothing of mine is unstaged*, from an enumeration over a known population — which is worth more than an absence of alarms and is what the wrap should be reporting.** ⚠️ Its population is files your commits ALREADY touched, so it is blind to a fold in a file this session never committed; `/hanging-work`'s whole-tree read stays as the outer net for that, and this narrows what you can actually check inside it.

   > 📁 **Moved, with the copy's edits, to [`references/step1-evidence.md`](references/step1-evidence.md) § Step 1a-ii — what this step used to read** — provenance only.

1b. **Compaction-boundary scan (mandatory when compact occurred this session).** If the session contains a compaction (a record, per Detection below — never a phrase), the post-compact context alone is incomplete signal — most session work likely happened pre-compact, and the harness summary compresses fine-grained signal that `/meta learn` (Step 2) and `/session-memory` (Step 3) need.

   **Detection (≤10 sec):**
   - Count records with the FIELD `"isCompactSummary":true` (or a `compact_boundary` system record) in the current session transcript, never a phrase, which this spec itself puts into the transcript (post-compact/SKILL.md Step 1). Any such record triggers the mandate (measured 2026-10-15: the phrase test raised 2 of 8 false "deep pass skipped" alarms; `scripts/wrap-reconcile.mjs` now keys on the record).
   - Fallback: `grep -c '^## 20' .claude/state/compact-checkpoint-${CLAUDE_CODE_SESSION_ID%%-*}.md` — THIS session's own checkpoint file (compact-save.sh writes one per session since 2026-09-07; for a session whose compactions predate it, count `isCompactSummary":true` records in your own transcript instead). ⛔ NEVER the shared `compact-checkpoint.md` — its mtime and its last block are the whole FLEET's (67 blocks landed in it on 2026-09-07 alone; an mtime test read TRUE for every session).

   **Scan procedure:**
   - Walk back through the session transcript to the prior **`/wrap` invocation** — the last session-CLOSE, the true "everything since here is un-wrapped" boundary. Do NOT anchor on the prior `/meta learn`: it fires INCREMENTALLY mid-session, so in a multi-`/meta learn` session (especially one with many compactions) "back to the prior `/meta learn`" resolves to the most-recent arc and systematically UNDER-scopes. **If no prior `/wrap` is found in this session, scope the ENTIRE session** (session-start → now) — NOT "the most recent commit timestamp" (far too narrow). Detect prior `/wrap` runs by grepping the transcript for the wrap SKILL.md load marker / a `[wrap]`-prefixed assistant turn. **Bias toward OVER-scanning + de-duping** — re-checking an already-codified lesson just de-dupes (cheap); under-scanning loses lessons (expensive). Evidence: an 18-compaction, 3-day session where the scan anchored on the most recent arc and MISSED three incidents — the under-scoping recurring in the very wrap that had codified the lesson against it. This anchor-on-`/wrap`-not-`/meta-learn` fix is the session-scope enforce layer.
   - Apply Step 2's `/meta learn` signal-extraction patterns (user pushback, agents launched, defer-with-trigger, LARP markers, novel factual discoveries) across the FULL pre-compact + post-compact window — NOT just post-compact.
   - **Drive the arc-enumeration from `git log --oneline <session-start>..HEAD` (the even, full-session commit list), NOT the in-context summary.** The harness post-compaction summary COMPRESSES pre-compaction arcs to bullets, so a linear scan over-weights the verbatim post-compaction turns — an under-WEIGHTING (distinct from under-SCAN). The git-log lists pre+post-compaction commits EVENLY → iterate each commit/arc as a distinct candidate. One corollary the iteration must apply: a captured DECISION can hide an uncaptured METHODOLOGY lesson (outcome-capture ≠ methodology-capture). Evidence: 2026-06-29 — a pre-compaction model-eval REVERSAL was anchored-past as "already captured" → missed the uncaptured eval-methodology lesson; caught only after 2 pushback turns.
   - Same applies to Step 3's `/session-memory` decision-capture: scan pre-compact for decisions worth persisting that the post-compact summary compressed away.
   - Step 4 `/me learn-session` similarly scans the full window for user-preference signals.

   > 📁 **Moved, with the copy's edits, to [`references/step1-evidence.md`](references/step1-evidence.md) § Step 1b — why mandatory, and the companion layers** — provenance only.

   **Skip rule:** if the transcript holds no `isCompactSummary` or `compact_boundary` record AND this session's own checkpoint file is absent or empty, this step is N/A — skip silently (the shared log's mtime is not a signal — see the fallback above).

1b-DEEP. **Mandatory PARALLEL-agent deep-pass for HUGE / multiday sessions — MOVED to its own skill 2026-09-12.**
   ⛔ **Invoke `/deep-pass` and follow it.** The procedure, its agent-count ladder, the slice
   arithmetic, the brief template, the anti-stall protocol and the founding evidence all live at
   `.claude/skills/deep-pass/SKILL.md` — moved whole, with the copy's edits. It left this file because it
   changes on its own clock (it and the rest of this spec co-changed in 6% of commits), it fires on
   roughly half of wraps, it has a consumer outside `/wrap` (`post-compact/SKILL.md` Step 5), and it
   was 26.5% of this spec's bytes while taking 36% of its growth since the 2026-08-28 extraction.
   **The trigger stays HERE, because the decision to fire must be makeable without loading it:**

   **Trigger — auto-detect (fire when this session compacted — a record, per /wrap Step 1b's Detection, auto or `/compact` — AND either bound is crossed):**
   ```bash
   TX="$HOME/.claude/projects/<project-key>/${CLAUDE_CODE_SESSION_ID}.jsonl"
   # STRIP FIRST, then measure — see the byte-unit rule below. TXT is the scan target for EVERYTHING downstream.
   # (filename deliberately avoids the `wrap-dp-<wordchar>` shape — that string in THIS spec would
   #  false-positive wrap-reconcile.mjs's deepPassRan transcript-grep, same trap as the digit rule below)
   TXT=/tmp/wrap-stripped-${CLAUDE_CODE_SESSION_ID}.jsonl   # SESSION-SCOPED — see below
   # ⛔ BLANK THE IMAGE PAYLOAD, NEVER DELETE THE LINE. A `grep -v` on the base64 marker stood here until 2026-09-15
   # and deleted every owner message sent WITH A SCREENSHOT, its text and rulings included (measured on one
   # session: 9 typed owner records in the raw transcript, 8 in the stripped copy; the lost one carried two rulings),
   # and it shifted every later line number off the raw transcript. The payload sits under TWO keys per record,
   # `source.data` and `toolUseResult.file.base64`, so the pattern names both: a `data`-only form kept 397,933,828 B
   # across 250 transcripts and one line of 3,102,592 B, more than a whole agent slice.
   # Keep the replacement a NON-raw string; a raw one writes literal backslashes into the JSON. Same pattern:
   # blankBase64Payloads in scripts/lib/transcript-strip.mjs and transcript_bytes in scripts/wrap-preflight.py;
   # tests/transcript-strip-parity.test.ts runs this block beside both, so run it after any edit here.
   # ⛔ AND BLANK THE HARNESS'S REQUEST COPIES TO A ONE-LINE STUB, NEVER DELETE THEM.
   # Since harness 2.1.300 (first seen 2026-10-14T21:36Z) the harness writes `api-request`, `api-request-blob` and `api-request-shape` records, a copy of each request
   # sent to the model; measured 52-65% of every transcript's bytes from their first appearance (five sessions),
   # so a slice agent spent half its reading on duplicate conversation. A stub keeps every line
   # number, for the reason above; every such record starts `{"type":"api-request`, so the test is a prefix, never a substring.
   python3 -c 'import re,sys
R=re.compile(r"^\{\"type\":\"(api-request[a-z-]*)\"")
for l in open(sys.argv[1],encoding="utf-8",errors="replace"):
    m=R.match(l)
    sys.stdout.write("{\"type\":\"%s\",\"stripped\":\"request copy\"}\n" % m.group(1) if m else re.sub(r"\"(data|base64)\":\"[^\"]{200,}\"","\"\\1\":\"<stripped>\"",l) if "\"type\":\"base64\"" in l else l)' "$TX" > "$TXT"
   BYTES=$(wc -c < "$TXT" | tr -d ' ')
   COMMITS=$(git log --oneline <session-start-sha>..HEAD | wc -l)   # session span; peer over-count is safe (it only raises the fire-rate)
   # FIRE the parallel deep-pass if Step 1b counted a compaction record AND (BYTES > 3000000 OR COMMITS > 20)
   ```
   Below both bounds (or no compaction record) → the inline 1b scan is sufficient; skip.

   > 📁 **Moved, with the copy's edits, to [`references/step1-evidence.md`](references/step1-evidence.md) § Step 1b-DEEP — the spec is delivered whole** — provenance only.
1c. **Defer-sweep (defer-sweep 3-part test, mandatory when ≥5 defers added this session).** Scaffolding added 2026-04-19 after repeated misses of the defer-sweep 3-part test (3× firings in 2 days — codification alone insufficient). Runs the defer-sweep 3-part test over every defer this session added or touched.

   **Enumerate the session's defer set:**
   ```bash
   # Defers in todo.txt (new entries and modified lines mentioning "defer"/"trigger")
   git diff --name-only <session-start-sha>..HEAD -- todo.txt
   # DEFER-labeled rows added to the 3 trackers
   # GLOBS: rows land in `-SHARD-*.md` files, so a bare router path misses every row added there.
   git log --oneline -p <session-start-sha>..HEAD -- \
     '.claude/project-memory/project_critical_flows*.md' \
     .claude/project-memory/project_feature_audits.md \
     .claude/project-memory/project_ops_register.md \
     | grep -B 1 -iE "DEFER|post-launch|^\+.*trigger:"
   ```
   Use the first commit of the session as `<session-start-sha>`. If the session added <5 defers total across these 4 files, skip silently — the 5-defer threshold is the defer-sweep 3-part test's original trigger and below that the overhead doesn't pay.

   > 📁 **Moved, with the copy's edits, to [`references/conditional-step-bodies.md`](references/conditional-step-bodies.md) § Step 1c — the 3-part test, auto-fix rule and output shape (fires at ≥5 session defers)** — READ IT before executing this step.

   > 📁 **Moved, with the copy's edits, to [`references/step1-evidence.md`](references/step1-evidence.md) § Step 1c — why here, and what it consumes** — READ IT before executing this step.
2. Run `/meta learn` to extract lessons + run mandatory deferral sweep (every defer/post-launch/monitor mentioned this session must be in todo.txt with trigger). Skip only on trivial sessions (<5 messages, no decisions). **<15-min exception (sub-skill invocation discipline, added 2026-04-20 after N=3 recurrence):** if `/meta learn` was invoked as an EXPLICIT Skill-tool call within the last 15 min of session wall-clock AND its output is verifiably present (grep-verify L-number in meta MEMORY.md / commit-hash / user_profile.md line — don't self-attest), Step 2 MAY skip re-invocation with one-line citation: "Step 2: /meta learn fired at turn T-X — verified output: L-N / commit <hash>. Skipping per sub-skill invocation discipline <15-min exception." Invariants: (a) grep-verify output exists; (b) cite specific artifact; (c) if prior run >15 min ago OR user pushed back on it OR output incomplete → RE-FIRE regardless. Exception prevents duplicate-run overhead, NOT inline substitution. **Watch-tier reconcile is NOT skippable (added 2026-06-01):** even when the <15-min exception skips full re-extraction, the `## Watch-tier register` reconcile (per `.claude/skills/meta/references/process-learn.md` → "Watch-tier auto-promote" — increment recurrence counts, auto-promote at `occurrences: 2`) MUST still run. It is a signature grep across the live `.claude/skills/meta/WATCH-TIER*.md` parts, archive excluded (the part count moves with every roll; the command is the process-learn step this sentence cites) — not one MEMORY section: the register left meta `MEMORY.md` — against this session's work; skipping it silently breaks occurrence-counting (a missed 2nd occurrence never promotes, which is the whole point of the register).
3. Run `/session-memory` to capture decisions. **<15-min exception applies (same conditions as Step 2 above)** — cite prior artifact if skipping.
3a. **Run `/decisions` to sweep for human-readable DECISIONS.md entries (auto-invoked — added 2026-05-17).** Mirrors `/session-memory` but writes to `DECISIONS.md` at repo root (human-readable owner-scannable strategy log) instead of machine-readable project memory. Scope: only entries that shape product / pricing / vendor / strategy / public-launch / compliance — NOT technical implementation details (those belong in /session-memory's output). De-duplicates against existing DECISIONS.md entries + any /session-memory entries written in Step 3 (avoid double-logging the same decision in both artifacts unless it's business-critical enough to warrant dual-home). Auto-execute on unambiguous proposals; surface as proposal when uncertain. **Skip rule:** on trivial sessions (<5 messages, no decisions surfaced by Step 3) /decisions is skipped — same as /meta learn / /session-memory. **Placement rationale:** runs AFTER /session-memory so /decisions can de-dupe against fresh /session-memory writes. Both can legitimately write the same decision (different audiences); /decisions just avoids volunteering duplicates without explicit value. Writes land in Step 8's commit.
4. If expert system was modified: update `/meta` MEMORY.md + CHANGELOG.md (and the touched skill's own CHANGELOG.md).
4a. **Whether or not Step 4's condition held** — its trigger is any agent hand-back this window, not an expert-system edit. **Persist every `### Memory Update` block this window's agents returned, enumerated from EVERY agent hand-back — panel seats, translators, builders, one-off consults, deep-pass slices — never from a panel roster or a carry list organised by panel**. Measured in one session: a carry list built panel by panel dropped two translator blocks and a third expert's block, found only by a later transcript scan and a later reconcile check. **The enumeration's source is `.claude/logs/subagent-dispatch.jsonl`: rows whose `session` starts with your sid (always the ROOT session, nested dispatches included) and whose `ts` is at or after this window's start: the newest `/wrap` row for this sid in `.claude/logs/skill-invocations.jsonl` that is OLDER than this invocation's own row (already logged by the time you read it) and is not a re-invocation of it (rows seconds apart are one wrap, re-typed), or session start when there is none — de-duplicated on `agent_id` (a re-started agent adds a row). ⚠️ **Zero agents in the window while this sid has dispatch rows since session start means the floor is wrong, not that nothing returned — fall back to session start and say so** (the count of rows since session start is the instrument). Step 11's reconcile anchors on the write-once session-start sha instead, a wider window, so a block it reports that 4a did not count can belong to an earlier window. Read EVERY hand-back in each agent's full transcript, `~/.claude/projects/<project-key>/<session-uuid>/subagents/agent-<id>.jsonl`: an agent woken again (a resume, or a background-task notification) can hand back more than once with its Memory Update only in the earlier one, and the `/private/tmp` task-output link does not survive a reboot. Never recall** (on one session: 78 rows = 57 agents, 29 builder blocks persisted here). Step 11 counts emitted against persisted; this step is where the count should already match.
5. If audits were completed: verify tracker updated + report their Check 10 delta-e2e outcome (test gate lives in `/audit-check`, not here)
5b. **Unit-suite gate for non-audit sessions (added 2026-06-09).** If this session touched `src/**` or `tests/**` — **SESSION-OWNED commits only: EXCLUDE peer commits interleaved on `main`** (instrument next) — AND ran **zero** `/audit-check` this session → run the full unit suite `npm test` (~2 min — fast, so the whole suite, not a selector). **The session-owned instrument:** re-run Step 1a-ii's trailer partition with both its empty-list gates in the same Bash call and `grep -cE '^(src|tests)/'` over its file list, plus the paths Step 8 will stage by explicit pathspec (a session with no commits answers from that pathspec alone) — never a `<base>..HEAD` range and never `git status`, both of which list peers' work on this shared tree (5e and 5d already carry this clause; measured 2026-07-28, a range listing 3 peer `src`/`tests` paths against 0 in the session's own 2 commits). ⛔ **Never hand `git show --name-only` a possibly-empty sha list: with no operand it prints HEAD's paths, a peer's commit. And the own-commit set is a FLOOR (a URL-form trailer or a bare `commit-tree` escapes the partition), so an empty, failed or doubtful derivation RUNS the gate and only a derivation that ran cleanly and listed ZERO `src/`/`tests/` paths skips it** — over-firing costs one suite run, and a peer's red is already handled below. Read the pass/fail **counts** (tee exit-code), never infer from exit code. **Any red that THIS session's work caused is a launch-blocker for the Step 8 commit — fix it now; never ship it to `main` for a sibling session / CI to surface.** A red that PRE-DATES this session's work (a sibling session's committed break) is NOT yours to fix here: surface it in the Step 7 summary + flag the owning session, don't block your commit on it. ⛔ **THE INSTRUMENT, WHICH THIS STEP SHIPPED WITHOUT UNTIL 2026-09-05:** `grep -c '"skill":"audit-check"' .claude/logs/skill-invocations.jsonl` scoped to this session — **NOT a `<command-name>` grep over the transcript.** A Skill-tool invocation leaves no `<command-name>` record at all, so that predicate UNDER-matches and the gate fires its full ~2.5-min suite off a zero that means nothing. Measured 2026-09-05: a wrap opened its own turn by explaining that its prose-invoked `/wrap` left no such marker, then eight minutes later ran `grep -c '<command-name>/audit-check'` → `0` and concluded `/audit-check` had never run. Naming a CONDITION without its instrument is what invites the improvisation. **Skip when ANY:** `/audit-check` ran this session (its Check 9 already ran unit+integration+tsc — running again is the duplicate-work the old design rightly avoided); session touched no `src`/`tests` files (docs / memory / meta-only); trivial session (<5 messages). Integration + e2e stay OUT of `/wrap` (slow; owned by `/audit-check` Check 9/10 + pre-push + CI) — this gate is unit-only because unit is the fast suite with no local home for non-audit sessions.
5c. **Lint gate (added 2026-06-11, when the CI `lint` job flipped to BLOCKING).** If this session touched `src/**` or `tests/**` (5b's session-owned instrument, including its run-on-doubt rule) → run `npm run lint` and read the **ERROR** count (the warning count is large and non-blocking — read it off the run's own summary line, never from a figure restated here: this clause said "~420" until 2026-09-05, when a later run measured 1319 and a seat seeing 3.1× the spec's number would reasonably conclude something had exploded). Because the CI `lint` job is now a hard gate, a lint ERROR here will fail the push's CI — catch it locally (free) rather than burning a CI run on it (Actions minutes are scarce). Fix any error before the Step 8 commit. Runs **regardless of `/audit-check`** (Check 9 runs tsc/unit/integration but NOT eslint). **Skip when:** session touched no `src`/`tests`; trivial session (<5 messages). (`knip` is still warn-mode in CI — don't gate `/wrap` on it.)
5d. **Translation review gate (added 2026-06-21).** If this session ADDED or CHANGED keys in `messages/*.json` (en source keys OR any non-EN locale value) → run a translation-review pass over EXACTLY the keys this session touched, before the Step 8 commit. *(📁 the rest of this paragraph moved, with the copy's edits, to [`references/conditional-step-bodies.md`](references/conditional-step-bodies.md) § Step 5d — why, detection, scope, scaling, verification and skip rules (fires when this session touched messages/*.json) — READ IT before executing this step.)*
5e. ⛔ **SEND-SIDE: this step DECIDES and SENDS, it is no longer surface-only.** It used to be surface-only on the ask-never-send rationale struck at 8a below — read that block for the reasoning. You judge whether the diff warrants a review, mail the hub, and disclose it in the closing message. *(Folded into this step 2026-09-07: the send-side rule shipped as a SEPARATE paragraph also labelled `5e.`, so `grep -n '^5e\.'` returned two steps and a seat executing the gate never reached it — address, not content. One step now.)* **`--code`-before-close gate (added 2026-06-22 — the enforce layer the verify-fix-before-close preference never had).** That preference (a scoped `/expert-review --code`, builder≠breaker, on a non-trivial multi-file/behavioral fix BEFORE close) had ZERO trigger — the orchestrator never self-fires it. PROOF: the defer-trigger mechanism shipped + `/wrap` ran **3×** with zero `--code`. This is the missing SURFACE. ⛔ **HELD BATCH FIRST, OUTSIDE THIS GATE (the coherent-batch rule's early-send case (c); it replaced an earlier three-commit rule, whose exception 5 this was):** if you are holding commits for a review batch you have not sent, send them all to the hub now in ONE request (you should already have, at the line above Step 0 — reaching here still holding means the send is late) listing every sha with its refute claim — whatever the count, and whether or not (a)–(c) or any skip condition below holds — and name them in the closing message. Held commits are often not `feat(` and touch no always-loaded spec, so the gate below would silently skip them. The gate below decides only about commits you had not already judged; if it also fires: still holding ⇒ name its sha(s) in that same request; batch already sent at the line above Step 0 ⇒ send them as their own request, which is 8a's boundary. **Fire only when ALL three hold:** (a) this session shipped a NEW behavioral mechanism — a NEW `scripts/*.{py,mjs,sh}` file OR a `feat(` commit BY THIS SESSION (`git log <session-start-sha>..HEAD`, EXCLUDE peer commits interleaved on `main` — match your own authorship/work, not the raw range) **OR an edit to an ALWAYS-LOADED BEHAVIORAL SPEC (`.claude/rules/*.md`, `CLAUDE.md`, `AGENTS.md`, `.claude/orchestrator/*.md`, a `.claude/hooks/*.sh` that is wired) — see the ⛔ clause in the skip list for why this arm exists** — **OR a diff that ADDS OR ALTERS A STEP A SKILL SPEC CALLS *MANDATORY*, which binds every seat's next invocation exactly the way an always-loaded rule does even though `.claude/skills/*/SKILL.md` is in none of the sets above (added 2026-09-05; the founding case is below)**; AND (b) at least one commit from (a) is **NOT COVERED** by a `--code` that ran this session — **coverage is per-COMMIT, never per-session; see the ⛔ ARM (b) clause at the end of this step for the derivation and for why the session-scoped form was wrong**; AND (c) ZERO `/audit-check` ran (its **Check 13 = Fix-Wave Review Gate** already verifies the audit-path `--code` — don't double-cover). **Then DECIDE AND SEND — never ask:** judge whether the diff warrants a review; if it does, `mail-send` the sha(s) to the live hub and NAME in the closing message that you sent it and what it was; if it does not, say so in one clause. **No hub live ⇒ the broadcast-then-self-run ladder in `behavioral-anti-patterns.md` #9's carve-out**, which is where the real token spend lives — that spend is the one thing on this step the owner still sees before it happens. *(This step printed the ask-shaped template `⚠️ Shipped <mechanism> + ran no --code … Run it? (y / defer-with-trigger to todo.txt)` until 2026-09-07.)* ⚠️ **This read *"Surface-only because `--code` is a real token spend the owner opts into"* until 2026-09-07, and that rationale was the spec author's, not a ruling.** It was struck: the seat judges whether a review is warranted, sends it, and says in the closing message that it sent it and what it was — the owner keeps the visibility and stops being asked. The original gap was "wasn't even reminded," not "didn't run it" — and a step that reminds you to ASK is not the step that gets the review RUN, which is the gap one turn further on. **Align with the existing record, do NOT invent one** (2026-06-22): the audit path already stamps a `c:<date>` tracker column + Check 13; the `--code` **commit message IS the canonical findings record** (for a non-audit mechanism with no tracker row, that commit message is the only record needed). **Skip when ANY:** the session shipped only structural-only / copy / i18n / refactor / chore / **non-always-loaded** memory / docs changes (own gates: tsc, `npm test` 5b, lint 5c, translation review 5d, ux-copywriter — a naive "shipped `src/` → surface" over-fires on every code session); a `--code` covered **every** qualifying commit (not merely "a `--code` already ran" — that phrasing was the arm-(b) defect restated in the skip list, where it would have re-opened the hole on its own; corrected 2026-08-14 in the same change); `/audit-check` ran; trivial session (<5 messages). *(📁 the rest of this paragraph moved, with the copy's edits, to [`references/step5e-arm-history.md`](references/step5e-arm-history.md) § Step 5e — the memory/docs skip history and the known once-only limitation — READ IT before executing this step.)*

> 📁 **Moved, with the copy's edits, to [`references/step5e-arm-history.md`](references/step5e-arm-history.md) § Step 5e — the SKILL.md-MANDATORY arm, calibration, founding case and ARM (b) per-commit derivation** — READ IT before executing this step.

   ⛔ **THE NON-GIT ARM — every arm above keys on COMMITS, so a file this session wrote outside the repo is invisible to all of them.** Run `python3 scripts/non-git-writes.py` (not in this copy) **whatever (a)–(c) and the skip list above say — they key on commits too, so none of them can exempt this arm.** Each EXACT path, and each POSSIBLE row whose command reads as a write, is sent to the hub as a frozen dated copy plus its sha256 (it cannot be reviewed by sha; a verdict on an older sha256 does not cover the current bytes), or gets a stated reason in the closing message. rc 2 = no session id, not exactly one transcript, or no parseable record — an instrument failure, never "none". Founding case: a session's status-line script kept outside the repository, unreviewed through a "nothing unreviewed" readout until a later check found it.
6a. **Deploy/env drift reconcile (read-only, warn-mode, ~5.3s / three network calls — measured 2026-09-07, 5.55/5.25/5.15s).** Run `node scripts/deploy-env-drift.mjs --domain <your production domain>` and read its VERDICT TOKEN, never its exit code (rc=2 means the instrument failed and nothing was measured). ⛔ **NO TOKEN AT ALL is also a reading:** the tokens go to stdout and `INSTRUMENT-FAILURE` to stderr, so an empty stdout means the instrument failed, not that nothing drifted. `DEPLOY-ENV: PENDING-REDEPLOY` ⇒ production holds env values that are stored but not live, and a row saying "waiting on a redeploy" is CURRENT — name the vars in the summary. `DEPLOY-ENV: ALL-LIVE` ⇒ **every stored value is deployed, so any row still claiming to wait on a redeploy or an env flip is STALE and gets re-read before it is quoted anywhere.** Same read as `/orient` 5e and same reason: measured 2026-09-07, three of eighteen top-tier backlog entries were stale because a deploy or an env write cleared their blocker and **no sweep we own reads either surface** — they read files, and neither of those is a file. This step is the wrap-side half; `/orient` 5e catches it at session start. It never blocks the wrap.

6. **Migration apply + notation reconcile.** If this session created migrations: remind about staging + prod application. Then run `node scripts/migration-notation-reconcile.mjs` (not in this copy; Layer 2, deterministic, read-only) — it schema-probes both DBs and surfaces any migration that is applied-but-unrecorded (the notation drop that silently false-alarms the next `/orient`; backfill any 🟢 APPLIED-UNRECORDED it prints via the `git commit --allow-empty` line it emits) or genuinely UNAPPLIED — or, since 2026-09-08, ⚪ SUPERSEDED, where a later migration dropped the probed object and the absence is expected, so do NOT re-apply. Silent when every recent migration is notated.
6b. **Memory-router auto-heal (the router-staleness fix — the REPAIR half; the DETECT half is the `.githooks/pre-commit` warn arm).** Run `node scripts/memory-tier-split.mjs --heal` — scans every sharded skill's router, repairs STALE (router re-index) and ROLL-DUE (over-cap shard cut) in one pass via a child-process roll per target (each conservation gate + exit code read individually), then RE-SCANS and prints a terminal `HEAL VERDICT` line — read that line, never rc alone. Stage whatever it changed into the Step-8 commit — ⛔ **BUT A DROPPED DIGEST ROW IS USUALLY A STALE DUPLICATE THE RE-INDEX IS REPLACING, NOT A LOSS (measured at this step 2026-08-30).** Search for the ENTRY'S IDENTITY (frame id / sha / date-plus-subject), never the dropped row's own wording — a grep on the row's sentence returns 0 in the shard whenever the body is headed differently, which is the normal case. Measured: I read that zero as a destroyed finding, restored the stale row into a peer's router, and mailed them to write a body they already had; `git show <sha>^:<router>` settled it in one command. ⛔ **A REPAIRED shard ROLL is a delete+add pair on the SHARED tree — commit BOTH endpoints in the SAME turn**, declared explicitly (a peer read this session's half-staged roll as a pending 4,449-line loss, 2026-09-02); and a bare `--heal` walks EVERY skill, so it writes tiers this session does not own, which land on the tree as dirt no `whose-edit` can attribute — scope it to the parent dir you mean (⛔ a PARENT of skill dirs, e.g. `--heal .claude/skills`: pointing `--heal` at ONE skill dir scans THAT dir's children and finds nothing — `HEAL VERDICT: ERROR — scanned 0 skill directories`, measured 2026-09-07; the one-skill form is `--roll <dir> --dry-run` / `--force`), and say what it wrote. **Skip-silent ONLY on `HEAL VERDICT: CLEAN`** — the positive token, emitted only when nothing needs a hand. `HEAL VERDICT: ATTENTION` means the listed rows (BROKEN / ERROR / refused / skipped-dirty) go into the Session Summary as findings; a BROKEN router is an UNLOADABLE layout, the tool's highest-severity state (the first version printed "nothing to do" over exactly that). The tool itself SKIPS any target whose memory files are dirty in `git status --porcelain` and prints `HEAL SKIPPED …` for each — that is the executable form of "never regenerate over a peer's uncommitted edit"; report the skipped ones, do not force them. ⛔ **A SKIP HERE IS USUALLY THIS WRAP'S OWN WORK: Steps 2-4 append to sharded tiers before 6b runs, so their routers read dirty at this step.** Re-run `node scripts/memory-tier-split.mjs --heal` after the Step 8 commit, and again after the COMMIT of any later step that appends to a shard (Step 9's learn, Step 11's persisted Memory-Update blocks): run before that commit, it skips the same routers again. Once this wrap's appends are committed, a target still skipped is another session's uncommitted edit: report it, never force it. Check that what the re-run wrote is moved lines and refreshed index rows only (an exact-line multiset over `git diff -U0`), then commit it. The Session Summary carries the LAST run's `HEAL VERDICT`: a first-run skip of this wrap's own appends that a re-run repaired is not a finding. Run it attended (it is an orchestrator step by construction): the residual is a peer append landing inside a roll's ~41 ms swap window on a target that read clean a moment earlier. Why a wrap step and not writer discipline: 6 occurrences, each a DIFFERENT session doing the correct-elsewhere default — the class is structural, so the repair is on cadence and the detect is at the commit choke point.
7. Show session summary (commits made, tests added, experts consulted, any pending Check 10 failures from feature audits)
7a. **Run `/me learn-session` (auto-invoked — added 2026-04-20, user-preference session extraction).** Mirrors the `/meta learn` + `/session-memory` pattern but scoped to USER working-style preferences. Scans session conversation for behavioral signals (user pushback, directional preferences, tool-friction flags, systems-thinking observations), de-duplicates against existing `user_profile.md` + `feedback_*.md`, classifies surviving candidates as profile-level or feedback-level, and writes. Auto-execute if total scope ≤30 LOC; larger = propose + confirm. Skip silently if zero preferences surface. Full spec: `.claude/skills/me/SKILL.md` → "Process — `/me learn-session`". **Why here, not Step 3:** user preferences belong alongside other session-end curation passes; running after session summary ensures the summary reflects the final preference state. Writes land in Step 8's commit. **Skip rule:** on trivial sessions (<5 messages, no decisions) /me learn-session is skipped same as /meta learn.
7b. **Tracker pointer-line refresh (mandatory when this session committed to any of: `project_critical_flows.md`, `project_feature_audits.md`, `project_ops_register.md`).** The one-line summaries in `~/.claude/projects/<project-key>/memory/MEMORY-INDEX.md` (the cold index, the file 7b's own procedure below reads) for each tracker are written ONCE per `/wrap` and silently rot when subsequent sessions transition row Status without re-stamping. The read-side rule enforces "count from tracker, not pointer" at READ time; this step closes the WRITE gap so the next session's `/orient` reads accurate counts.

   **Detection (≤5 sec):** if `git log --name-only <session-start-sha>..HEAD` doesn't list any of the 3 tracker files, skip silently — pointer counts haven't drifted from this session.

   **Procedure (per touched tracker):**
   ```bash
   # 1. Re-count Status column directly from tracker.
   # 📁 moved, with the copy's edits, to .claude/skills/wrap/references/step7-notes.md § 7b — why the field-4 awk was refuted — provenance only
   node scripts/tracker-list.mjs flows --counts
   # ⚠️ Same command with `features` / `ops` for the sibling trackers — 7b is mandatory for all three.
   # 📁 moved, with the copy's edits, to .claude/skills/wrap/references/step7-notes.md § 7b — why the awk was replaced, not repaired — provenance only
   # 2. Read the matching pointer line in MEMORY-INDEX.md (search "Critical flows tracker" / "Feature audits tracker" / "Ops register")
   # 📁 moved, with the copy's edits, to .claude/skills/wrap/references/step7-notes.md § 7b — MEMORY.md vs MEMORY-INDEX.md — provenance only
   # 3. Compare CLAIMED counts (in pointer) vs ACTUAL counts (from step 1's command). If mismatch:
   #    Edit ONLY the "N flows: X COMPLETE / Y PENDING / Z RESEARCH_GAP / W ungated" substring.
   #    DO NOT touch the trailing narrative ("; latest #N (date); #M still PENDING ...") — that's session-curated, not derivable from count.
   ```

   **Auto-fix rule:** ≤1-line targeted Edit per pointer (count substring only) auto-executes. If the pointer line's narrative tail references a flow/feature that no longer matches tracker reality (e.g., "latest #52" when tracker now has #65), surface as proposal — don't guess the right narrative.

   **Skip rule:** if all 3 trackers were untouched this session, skip silently. Also skip when the parallel-session check (Step 8's pre-stage `git diff --staged --name-only`) shows MEMORY-INDEX.md is currently staged by a concurrent session — refresh on the NEXT `/wrap` to avoid double-staging.

   > 📁 **Moved, with the copy's edits, to [`references/step7-notes.md`](references/step7-notes.md) § 7b — evidence basis** — provenance only.

7c. **Tracking-file sync sweep (forward-direction tracker-file sync at /wrap close, mandatory when this session has ≥1 commit AND `BACKLOG.md` / `todo.txt` not currently staged by a parallel session).** Closes the forward-direction gap: session shipped work matching a BACKLOG entry or open todo task → trackers must reflect shipped state. Companion to Step 7b (tracker-pointer count refresh) and inverse-companion to `/hanging-work` Check 12 (defer-trigger-fired — covers blocker-fired direction; this step covers task-done + archive-shipped + idea-capture directions).

   **Detection (≤10 sec):** if `git log --oneline <session-start-sha>..HEAD | wc -l` is 0, skip silently — nothing shipped to reconcile.

   **Procedure — the sub-checks below, in order** *(they were "3" in prose until 2026-09-05 while four were listed, and 7c.1c makes five; derive the set by reading the `**7c.` headings rather than trusting a count here — the cite-a-spec-never-a-number rule)*:

   **7c.1 — BACKLOG.md archive sweep.** For each P0/P1/P2 entry:
   ```bash
   # P-tier entries in BOTH forms (`### N.` + `- **#N`). NOT a range-awk: `/^## P[0-2]/,/^## P[0-9]/` ends on its own start line, read 0 of 163 (2026-09-14)
   awk '/^## /{p=/^## P[0-2]/} p' BACKLOG.md | grep -nE '^(### [0-9]|- \*\*#[0-9])'
   # Grep session commits for feature-IDs + completion markers.
   # 📁 moved, with the copy's edits, to .claude/skills/wrap/references/step7-notes.md § 7c.1 — why the single-regex form and the fixed /tmp path are gone — provenance only
   SESS=/tmp/wrap-sess-${CLAUDE_CODE_SESSION_ID}.txt
   git log <session-start-sha>..HEAD --oneline > "$SESS"
   for m in COMPLETE PASS shipped /audit-check; do grep -inF "$m" "$SESS"; done | sort -u
   ```
   > 📁 **Moved verbatim to [`references/step7-notes.md`](references/step7-notes.md) § 7c.1 — set-equivalence caveat** — READ IT before executing this step.
   If an entry's distinctive ID (F#, Flow #, or unique keyword) appears in a commit subject AND a completion marker is present → propose archive move. **Auto-archive** if ≤3-line move per entry (delete from P-tier, append to `## Archive → Shipped` with commit hash + 1-line summary). **Propose for batch approval** if ≥2 candidates OR if entry has shared keywords (e.g., "F11" could match multiple entries — surface for disambiguation).

   **7c.1b — Composite/rollup-entry candidate reconcile (mandatory whenever 7c runs).** 7c.1's whole-entry archive sweep is **entry-granular + archive-only** — structurally blind to a *composite/rollup* entry (one whose BODY enumerates `F#` / `Flow #` / `OPS #` candidates) that is NOT itself archivable (some candidates still open) but whose internal candidate list went **stale** because some candidates completed. 7c.1 checks "is the WHOLE entry done?" → no → does nothing → the stale sub-candidates are never touched. And because the completion often happened in a DIFFERENT (earlier) session, a session-commit-scoped scan can't see it at all.
   ```bash
   # 1. Find the rollup entries (body enumerates F#/Flow#/OPS# candidates with status markers)
   grep -nE "^### [0-9.]+\. " BACKLOG.md
   # 2. For EACH rollup entry, MECHANICALLY enumerate every candidate id of ALL types — never eyeball the body (occ-2).
   # 📁 moved, with the copy's edits, to .claude/skills/wrap/references/step7-notes.md § 7c.1b — why not a range-awk, and the range-heading blind — provenance only
   START=$(python3 - "$N" <<'PY'   # python, not awk: dollar-digit fields are replaced when this skill gets arguments
   import re, sys
   n = int(sys.argv[1])
   for i, l in enumerate(open("BACKLOG.md", encoding="utf-8"), 1):
       m = re.match(r"### (\d+)(?:–(\d+))?", l)
       if m and int(m.group(1)) <= n <= int(m.group(2) or m.group(1)): print(i); break
   PY
   )
   END=$(awk -v s="$START" 'NR>s && /^##+ / {print NR-1; exit}' BACKLOG.md); [ -z "$END" ] && END=$(wc -l < BACKLOG.md)
   # ⛔ KEY ON CANDIDATE **LIST LINES**, NEVER ON EVERY ID IN THE BODY.
   sed -n "$((START+1)),${END}p" BACKLOG.md \
     | grep -E '^[[:space:]]*([-*+]|[0-9]+\.)[[:space:]]' \
     | grep -oE "F[0-9]+|Flow #[0-9]+|OPS #[0-9]+" | sort -u
   # POSITIVE CONTROL, required before trusting a zero: the same pipeline WITHOUT the list-line filter
   # must return MORE. Equal counts mean the filter did not engage (an entry whose candidates are not
   # list-formatted) — read that entry by hand rather than reporting it clean.
   # 3. Loop EVERY enumerated id against its OWNING tracker's CURRENT Status (ground truth, NOT this session's commits):
   #   F#   → project_feature_audits.md      Flow # → project_critical_flows.md      OPS # → project_ops_register.md
   # CRITICAL (occ-2, 2026-06-17): sweep ALL candidate TYPES, not just the tier this session worked on. The grep
   # removes the orchestrator-discipline dependency the tier-anchored skip (flows swept, a feature missed) exploited.
   ```
   > 📁 moved, with the copy's edits, to .claude/skills/wrap/references/step7-notes.md § 7c.1b — why candidate LIST lines, not every id — **READ IT before executing this step** (a reference-file pointer, not the scan-output legend above)
   **The reconcile is against tracker ground truth, NOT session commits** — that is what catches the cross-session case (a candidate completed 2 days ago in another session). For each candidate: tracker row reads ✅ COMPLETE but the BACKLOG candidate line still reads pending/residual → **propose an in-place strike-✅ update** of that candidate line (mark `~~F#~~ ✅ … COMPLETE <date> (<commit>)`), NOT a whole-entry archive (the entry stays — other candidates remain). Bounded + cheap: only the handful of rollup entries, ~10-15 sec. ⛔ **DERIVE that set from step 1's grep — do not cite a list from here.** This clause named three specific entries until 2026-09-13 and **none of those three resolves any more**, so a seat checking whether the step applied to the right entries was reading a set that had not existed for weeks. **Auto-fix** ≤3-line in-place edits per candidate; **batch-propose** if ≥3 candidates flip at once OR the candidate ID is ambiguous (matches multiple tracker rows). Also re-derive the entry's "remaining" summary line + tier-count header if the strike changes them.

   **7c.1c — Session-touch reconcile: EVERY BACKLOG ITEM THIS SESSION TOUCHED GETS A DATED LINE. MANDATORY whenever 7c runs: every `/backlog` item the session touched is updated at every wrap.**

   > 📁 **Moved, with the copy's edits, to [`references/step7-notes.md`](references/step7-notes.md) § 7c.1c — the gap this closes** — provenance only.

   **Instrument — named here because a condition without one gets an unsound improvisation (the same lesson as Step 5b's instrument clause).** Two signals, unioned:

   > 📁 **Moved, with the copy's edits, to [`references/step7-notes.md`](references/step7-notes.md) § 7c.1c — SIGNAL 1 reads the diff: the retired message-anchored form** — READ IT before executing this step.
   ```bash
   # (1) GROUND TRUTH — which ENTRY each changed line of BACKLOG.md falls under, per commit.
   #     Resolves a hunk's new-file line numbers against the entry headings in that commit's
   #     own blob, so it cannot be fooled by prose, by a supersedes clause, or by a plan-file
   #     commit that merely NAMES an item. A batch heading is a RANGE and is skipped here —
   #     its members are resolved by the four-form resolver below.
   python3 - <<'PY'
   import subprocess, re, bisect, sys
   HEAD_RE = re.compile(r'^(?:### (\d+)\.|### (\d+)–(\d+)\.|- \*\*#(\d+) |- \*\*P\d+ #(\d+) )')
   # WHOSE each commit is: the ONE classifier (scripts/session-labels.py), never a local copy.
   # '<date> 00:00', never a bare date: git reads a bare date as that date at the CURRENT clock
   # time, and on the session's own start day that returns zero commits at rc=0.
   part = subprocess.run(['python3','scripts/session-labels.py','partition','--since','<session-start-date> 00:00',
                          '--path','BACKLOG.md'], capture_output=True, text=True)
   sys.stderr.write(part.stderr)          # the per-leg count line: "0 of 0" is a window to widen, not an all-clear
   if part.returncode != 0: raise SystemExit('PARTITION FAILED — instrument failure, NOT an empty partition: ' + part.stderr[:300])
   mine, unattributed = {}, {}
   for row in part.stdout.split('\n'):
       if not row.strip(): continue
       label, h = row.split(' ')[:2]
       bucket = mine if label == 'MINE' else (unattributed if label in ('URL-OTHER', 'NO-TRAILER') else None)
       if bucket is None: continue          # a DIFFERENT seat — theirs, skip
       blob = subprocess.run(['git','show',f'{h}:BACKLOG.md'],capture_output=True,text=True).stdout.split('\n')
       anchors, ids = [], []
       for i, line in enumerate(blob, 1):
           m = HEAD_RE.match(line)
           if m: anchors.append(i); ids.append([x for x in m.groups() if x])
       d = subprocess.run(['git','show',h,'--unified=0','--format=','--','BACKLOG.md'],
                          capture_output=True,text=True).stdout
       for hm in re.finditer(r'^@@ -\S+ \+(\d+)(?:,(\d+))? @@', d, re.M):
           s = int(hm.group(1)); c = int(hm.group(2) or 1)
           for ln in range(s, s+max(c,1)):
               j = bisect.bisect_right(anchors, ln) - 1
               if j >= 0 and len(ids[j]) == 1: bucket.setdefault(ids[j][0], set()).add(h[:9])
   print("MINE        :", sorted(mine, key=int))
   print("UNATTRIBUTED:", sorted(unattributed, key=int), "<- another seat's URL, or no trailer; NOT another seat's sid")
   PY
   # (2) /backlog invocations THIS session — the args carry the item id
   python3 - <<'PY'
   import json,os
   sid=os.environ['CLAUDE_CODE_SESSION_ID'].split('-')[0]
   for l in open('.claude/logs/skill-invocations.jsonl'):
       try: r=json.loads(l)
       except: continue
       if r.get('skill')=='backlog' and str(r.get('session','')).startswith(sid): print(r.get('args'))
   PY
   ```
   > 📁 **Moved verbatim to [`references/step7-notes.md`](references/step7-notes.md) § 7c.1c — the retired form's own defence** — READ IT before executing this step.

   ⛔ **SIGNAL 1 SPANS THE FLEET, NOT YOUR SEAT — `<session-start-sha>..HEAD` on a multi-day session is every seat's commits, and 7c.1's "peer over-count is safe (it only raises the fire-rate)" DOES NOT TRANSFER HERE.** Over-counting an archive sweep costs a redundant check; over-counting THIS step writes a peer's work into `BACKLOG.md` under your session id, which is the attribution failure the commit doctrine exists to prevent. **Partition with the block above, which calls `scripts/session-labels.py partition` (all three of this seat's labels: the 8-hex trailer, its own remote-URL trailers, a sid-closing subject scope)** — and treat it as the doctrine does: a PARTITION, never an identity, whose ABSENCE proves nothing and whose value has three shapes. An item you cannot attribute is still worth recording; attribute it to the WORK (the sha), not to your seat. ⛔ **AND THE TRAILER HAS A THIRD STATE THAT IS NEITHER YOURS NOR ANOTHER SEAT'S: A URL-FORM VALUE — MEASURED AT 25% OF THE LAST 400 COMMITS, AND 39% OF THE `BACKLOG.md`-EDITING ONES.** The hedge "whose ABSENCE proves nothing" does not reach it: a URL is a **present, non-matching value**, so an exact 8-hex compare reads it as positive evidence the commit is somebody else's and a URL-form seat gets a silent total false zero on every wrap, permanently. `safe-commit.sh` carries a test arm written for exactly this, in as many words. **Three buckets, never two — MINE (this seat's 8-hex or its OWN remote URLs) / ANOTHER 8-HEX SEAT / UNATTRIBUTED (another seat's URL, or absent), and the third is yours to consider, not to discard.** ⚠️ **Measured on this clause's own first run, and stated as the FLOOR it is: unpartitioned 24 items, trailer-matched 8. The retired sentence here read "16 items belonging to other seats" — bolded and flat, which is precisely the identity claim its own first clause forbids** (2026-09-05).

   ⚠️ **SIGNAL 2 FALSE-ZEROS BEFORE 2026-09-04.** `skill-invocations.jsonl` only started stamping a real `session` that day — 74 of the 78 historical `/backlog` records read `unknown`, so a run over older data returns empty and reads like a dead probe. Live going forward; do not "fix" it against the archive.

   ⛔ **SIGNAL 1 CANNOT TELL A COMMIT THAT *CHANGES* AN ITEM FROM ONE THAT MERELY *NAMES* IT — SO CONFIRM `BACKLOG.md` IS IN THE DIFF BEFORE WRITING AN ADVANCE.** The predicate reads the commit MESSAGE, and a session's plan-file, todo-row and mail commits routinely cite a backlog item in prose while touching nothing in `BACKLOG.md`. Measured on the maiden firing, 2026-09-05: of 4 items that reached the disposition step, **one item's only citation was a prose mention inside a plan-file commit** (`BACKLOG.md` NOT in its diff), against the other three (+11, +8, and 8 commits), which were all real entry edits. **One command separates them:** `git show --numstat --format='' <sha> | cut -f3 | grep -xF BACKLOG.md` — empty ⇒ the honest disposition is NO MATERIAL CHANGE, and the miss is the instrument's rather than the entry's. **Writing an ADVANCE off a mention is the exact fabrication the NO-MATERIAL-CHANGE outcome exists to prevent**, so this check is what makes that outcome reachable rather than decorative.

   ⚠️ **IT IS A FLOOR, NOT A CENSUS — say so rather than reporting it as complete.** In the same window **4 commits touched `BACKLOG.md` carrying no citation the predicate can see**, so the union under-reports by construction. What closes the residual is not a better regex: it is the orchestrator adding, from its own session knowledge, any item it worked on that the two signals missed. The instrument seeds the list; it does not bound it.

   ⛔ **RESOLVE THE ID AGAINST ALL FOUR ENTRY FORMS — A TWO-FORM RESOLVER SILENTLY DROPS ITEMS, AND THIS FILE HAS ALREADY DONE THAT TWICE.** Measured 2026-09-05: `### N.` **65** · `### N–M.` **5** (the batch headings every `/backlog sweep` promotion uses) · `- **#N ` **81** · `- **P0 #N ` **41**. A resolver knowing only the first and third — the pair a census naturally finds — misses 46 entries.
   ⛔ **AND THE BATCH FORM CANNOT BE RESOLVED BY A REGEX AT ALL — IT CARRIES A *RANGE*, SO MEMBERSHIP IS ARITHMETIC. THE FIRST VERSION OF THIS RESOLVER PUT `### [0-9]+–[0-9]+\.` INSIDE THE ALTERNATION WITH NO `$N` IN IT, WHICH MATCHES THE FIRST BATCH HEADING IN THE FILE FOR *EVERY* ITEM, INCLUDING ITEMS THAT DO NOT EXIST.** Measured on its own first live firing, 2026-09-05: two real items and the nonexistent `#999` and `#12345` ALL resolved to the same line, the file's first batch heading. **The tell was two different items resolving to one line**, and the negative control (`#999` → 0) that had passed at build time no longer reproduced against the shipped text — so the build-time control was sound and the thing that shipped was not. ⚠️ **7c.1b ONE STEP ABOVE ALREADY HAD THE RANGE-PARSE (`if (index(h,"–")) { split(h,p,"–") … }`) and this step re-invented a simpler broken one** — when a sibling sub-check resolves the same identifier, READ IT rather than re-deriving. Two commands, and the second is not optional:
   ```bash
   # (a) the three REGEX-resolvable forms
   grep -nE "^(### $N\.|- \*\*#$N |- \*\*P[0-9] #$N )" BACKLOG.md
   # (b) the BATCH form — range membership, so parse and compare (7c.1b's own logic)
   python3 - "$N" <<'PY'   # python, not awk: a skill invoked WITH arguments has awk's dollar-digit fields replaced
   import re, sys
   n = int(sys.argv[1])
   for i, l in enumerate(open("BACKLOG.md", encoding="utf-8"), 1):
       m = re.match(r"### (\d+)–(\d+)\.", l)
       if m and int(m.group(1)) <= n <= int(m.group(2)): print(f"{i}: {l.rstrip()}")
   PY
   ```
   **Run `#999` as a standing negative control every firing** — it must return NOTHING from both legs. A resolver that answers for a nonexistent item is answering for every item.

   ⚠️ **ALL 41 OF THE `- **P0 #N ` FORM SIT IN `## Archive`, SO RESOLVING THERE IS A DISPOSITION, NOT A MISS.** A cited item that lands in the Archive shipped already — record nothing unless this session actually RE-OPENED it, in which case the write is a re-open in the live tier, never an append to the archive line. Measured on this clause's own first run: of 8 touched items, one resolved only in the Archive and a two-form resolver reported it MISSING — which would have read as a broken predicate rather than a shipped item.

   ⚠️ **BATCH THE PER-ITEM ATTRIBUTION INTO ONE `git log --no-walk`, NEVER A LOOP PER ITEM.** You need each item's commits to write its disposition, and the obvious `for item; do for sha; do git log -1; done; done` is O(items × commits) — measured **timing out at 2 minutes on 8 items × 259 commits** while the single batched read returned the whole map instantly.

   **Disposition — per item, MANDATORY, and the write is a dated append in the entry's own house form** (`✅`/`⚠️`/`❓` + what changed + the date + the session id, exactly like the existing status bullets). One of:
   - **ADVANCED** — name what shipped and the sha.
   - **REFUTED / RESCOPED** — the entry's premise moved; correct the entry text IN PLACE and add the dated line saying what it used to claim.
   - **BLOCKED** — name the blocker and who owns it.
   - **NO MATERIAL CHANGE** — investigated, nothing moved. ⛔ **THIS IS A FIRST-CLASS OUTCOME AND MUST STAY ONE.** A mandatory write with no way to say "nothing changed" manufactures updates to satisfy itself, which is the failure mode that makes the next reader distrust every dated line in the file. Record it in one clause, or record nothing and say in the wrap output that the item was touched and needed no entry change — both are honest; a fabricated advance is not.

   **Already-updated check, so the step is idempotent on a re-wrap:** an item whose entry already carries a line naming THIS session is done — do not append a second one. ⛔ **THE COMMAND MUST BE RANGE-SCOPED, AND THE ONE THIS STEP SHIPPED WITH WAS WHOLE-FILE** — prose said "per entry range" and the command had none, so `grep -c <sid> BACKLOG.md` returns a file-wide count that is non-zero the moment you write your FIRST line, and every remaining item then reads "already done". On a maintain-wave wrap that silently drops 28 of 29 and reports them complete. **A named unsound instrument is worse than none: an unsound command gets pasted, an absent one gets thought about** (2026-09-05; whole-file count measured at 5 across five different entries while four items were still unwritten).
   ```bash
   SID8=$(echo "$CLAUDE_CODE_SESSION_ID" | cut -d- -f1)
   LN=$(grep -nE "^(### $N\.|- \*\*#$N |- \*\*P[0-9] #$N )" BACKLOG.md | head -1 | cut -d: -f1)
   END=$(awk -v s="$LN" 'NR>s && /^(### |## |- \*\*#|- \*\*P[0-9] #)/ {print NR-1; exit}' BACKLOG.md)
   [ -z "$END" ] && END=$(grep -c '' BACKLOG.md)
   sed -n "${LN},${END}p" BACKLOG.md | grep -c "$SID8"      # 0 => write; >0 => already done
   ```
   ⛔ **AND NO MATERIAL CHANGE MUST WRITE A MARKED LINE, NOT NOTHING — OTHERWISE THE IDEMPOTENCE GUARD CREATES THE FABRICATION GRADIENT THIS STEP EXISTS TO CLOSE.** "Record nothing" leaves no artifact, so the check above cannot see it, so the item is re-raised on every later wrap of the same session (checkpoint mode is same-steps-same-rigor) — **taking the honest outcome costs you the item forever while writing a false advance makes it stop.** That pressure comes from the guard, not from the wording, and only a recorded line removes it. Write the `❓ NO MATERIAL CHANGE — <date>, session <sid>` line and let it satisfy the check (2026-09-05 — a review lens confirmed the WORDING already carries the escape hatch; the guard was what undercut it).

   **Skip rule:** inherits 7c's — zero session commits, or `BACKLOG.md` staged by a parallel session. A skip is NAMED in the wrap output with which of the two it was; a silent skip is indistinguishable from the step not running.

   **7c.2 — `todo.txt` closed-entry sweep.** Inverse of blocker-fired direction; catches task-done direction:
   - For each open `- [ ]` entry, extract distinctive keywords (file path / function name / F# / OPS# / migration number)
   - Grep session commits + commit-touched files for matching keywords AND completion markers
   - **Auto-mark `- [x]`** (or move to closed section per `todo.txt` convention) if ≤2 entries match unambiguously
   - **Propose** otherwise

   **7c.3 — IDEAS.md capture.** If Step 2 `/meta learn` OR Step 3 `/session-memory` surfaced any "we should add X" / "future feature Y" / "captured for later" signal that did NOT get acted on this session (i.e., not promoted to P0/P1/P2, not added to an existing BACKLOG/IDEAS entry) → propose `/ideas add <title>` row(s) in root `IDEAS.md` with today's date (Ideas split out of BACKLOG.md 2026-07-10). **Auto-add** if ≤2 ideas; **propose** if more.

   **Auto-fix rule (cumulative across every 7c sub-check):** ≤5-line aggregate edit auto-executes inline. Larger changes surface as a single proposal table before write.

   **Skip rule:** zero session commits OR `BACKLOG.md` / `IDEAS.md` / `todo.txt` currently staged by parallel session (per Step 8 pre-stage check) → skip silently; reconcile on NEXT `/wrap`.

   > 📁 **Moved, with the copy's edits, to [`references/step7-notes.md`](references/step7-notes.md) § 7c — evidence basis and coordination notes** — READ IT before executing this step.

7d. **Architecture-doc audit (cadence-trigger enforcement, mandatory when this session added ≥1 new meta MEMORY lesson OR ≥1 new infrastructure file in `.claude/{skills,agents,hooks,rules,commands,templates}/` AND `.claude/docs/architecture.md` is not currently staged by a parallel session).** Closes the gap where `/meta architecture-audit` had documented cadence triggers but zero automation layer — relied on the orchestrator remembering. Architecture.md is the same shape of artifact as `MEMORY.md` pointer-lines (stamped at one time, silently rots until refreshed); same-shape /wrap enforcement as Step 7b/7c.

   **Detection (≤5 sec) — fire on ANY of two mechanical signals that directly observe what the doc enumerates:**
   ```bash
   # Signal 1: new L# headers in meta MEMORY (doc cites L# range in preamble + Appendix C rows).
   new_lessons=$(git diff <session-start-sha>..HEAD -- .claude/skills/meta/MEMORY.md \
     | grep -cE '^\+## [0-9-]+ — L[0-9]+:|^\+## L[0-9]+ \(')

   # Signal 2: new infrastructure files (doc enumerates counts of skills / agents / hooks /
   # rules / commands / templates / project-memory — all change when files added).
   new_files=$(git diff --name-status --diff-filter=A <session-start-sha>..HEAD -- \
     .claude/skills/ .claude/agents/ .claude/hooks/ .claude/rules/ .claude/commands/ .claude/templates/ \
     | wc -l)

   # Fire if either > 0
   [ "$new_lessons" -gt 0 ] || [ "$new_files" -gt 0 ] || skip
   ```

   **Cheap count-check runs UNCONDITIONALLY (occ-2, 2026-06-22).** The two signals above are PROXIES that gate only the heavier FULL `/meta architecture-audit` invocation (Tier 2/3 prose) — NOT the ~1-sec `node scripts/architecture-counts.mjs check`, which ALWAYS runs. The proxies under-fire on count-drift sources they don't grep: a new `.claude/project-memory/*.md` file (drifts `projectMemory`) or a `RULES.md`-row edit without a new L# header (drifts `metaRulesRows`) both leave the doc stale while both signals read 0. The check is content-keyed ground truth (the "key gates on CONTENT, not a proxy" fix — apply `architecture-counts fix` for ≤5-LOC drifts inline); the proxy signals then decide only whether the FULL audit also runs. Evidence: this 2026-06-22 wrap added a feedback memory + a RULES row → both proxy signals 0, yet `projectMemory`/`metaRulesRows` drifted; caught only by a later manual check.

   **Cumulative conceptual-drift surface also runs UNCONDITIONALLY (added 2026-07-01 — the count-sync-masks-conceptual-staleness fix).** Alongside `check`, ALSO run `node scripts/architecture-counts.mjs conceptual-due` (read-only, ~1 sec) and surface its verdict in the /wrap output. This is the CUMULATIVE backstop the per-session proxies above miss: those proxies decide whether to fire the FULL audit from THIS session's ≥1 lesson/infra, but when the orchestrator does count-sync-ONLY (applies Tier 1, surfaces Tier 2/3 without integrating — the common path), whole subsystems accumulate un-integrated in the lecture *prose* while the count-sync keeps the *numbers* fresh and `last-reviewed` correctly stays put — so the git log reads as if real audits ran. `conceptual-due` measures accumulation SINCE `last-reviewed` (new infra files + new lessons — NOT commit-count) and prints `⚠️ CONCEPTUAL PASS DUE` when new-infra ≥ 3 OR new-lessons ≥ 30: the signal to run a real Tier-2/3 `/meta architecture-audit` next session, not another count-sync. ⛔ **It can also print `⛔ INSTRUMENT DARK` (added 2026-09-14) — one half of the gate could not be measured, or the whole gate when git itself is failing. Surface that as a FINDING, never as a pass: a DARK lessons half is UNKNOWN.** The lessons half was dark this way for every run anchored after the 2026-08-06 memory split, printing an ordinary-looking PARTIAL, until 2026-09-14. **Surface-only — never blocks close** (like the Tier 2/3 rule below). Evidence: the 2026-07-01 audit found the entire `/push` + `/deploy` + `/review-hub` deploy/review subsystem (5 skills + 4 hooks + ~35 lessons) had accumulated un-integrated in Lectures 5/7/9 since 2026-06-23 while 7 architecture.md count-sync commits made the log read as active. **Invariant it depends on:** only a genuine Tier-2/3 pass bumps `last-reviewed`; a bare `architecture-counts.mjs fix`/count-sync must NOT (it doesn't touch the frontmatter) — else the anchor drifts and the signal goes blind.

   > 📁 **Moved, with the copy's edits, to [`references/step7-notes.md`](references/step7-notes.md) § 7d — rationale for the trigger choice** — provenance only.

   Also skip if `git diff --staged --name-only` shows `.claude/docs/architecture.md` already staged by a parallel session per Step 8 pre-stage check — defer the audit to next /wrap.

   **Procedure:** invoke `/meta architecture-audit` (default mode — NEVER `--strict` at /wrap; that mode is reserved for explicit CI/auto-fix flows per the warn-mode-before-block-mode discipline). The audit auto-fixes ≤5-LOC Tier 1 mechanical drifts inline (count corrections, stale L# refs, last-reviewed/maxL date refresh). Tier 2 (Appendix C coverage gaps, cross-reference verification, pointer-block-to-`state.md` staleness) surfaces as proposals. Tier 3 (conceptual drift) surfaces as observations.

   ⛔ **GENERALIZED 2026-08-07 (measured twice in ONE wrap, from two different steps): the invariant is not about `/meta learn` — it is about ANY LATER STEP THAT MUTATES WHAT 7d COUNTS.** The clause below names `/meta learn` because that is where it was first measured, and a reader who runs 7d after Step 2 reasonably concludes they are done. Measured this wrap: (a) Step 2 `/meta learn` added four lessons → re-drifted `maxL` by four; 7d re-run, clean. (b) **Step 7a `/me learn-session` then created one `feedback_*.md` file** → re-drifted `project-memory files` 231→232, and a later check caught it as `STEP 7d UNRUN/UNFIXED` on a wrap where 7d had already run twice. **7d counts skills · agents · hooks · rules · commands · templates · project-memory · maxL · RULES-rows — so `/me learn-session` (new feedback file), `/meta corrections` (registry), any new rule/hook/skill, and Step 9's own follow-up commit ALL re-drift it.** Practical form: **run `architecture-counts.mjs check` as the LAST thing before the Step-11 gate, not as part of 7d** — it is ~1 s, and it is the only placement that sees every mutation the wrap made. The 7d slot stays where it is for the Tier-2/3 proposals; only the count-check moves late.

   **Ordering invariant — run 7d AFTER Step 2 `/meta learn`, and RE-RUN the count-fix if 7d was front-loaded (2026-06-08).** `/meta learn` (Step 2) can promote a NEW L# via watch-tier auto-promote — which re-drifts `maxL` (the lesson-number range refs) in architecture.md. If you batched 7d's count detection/fix EARLY in the wrap (a common efficiency move — running all mechanical scans up front), the fix ran BEFORE the new L# existed and left stale `maxL` narrative refs. So: after `/meta learn` adds any L#, **re-run `node scripts/architecture-counts.mjs fix`**, then confirm `node scripts/architecture-counts.mjs check` is clean BEFORE the Step 8 commit. A "clean tree" claim is invalid until re-checked post-`/meta learn` — never assert clean from a check that ran before your own later edit. Evidence: 2026-06-08 wrap front-loaded 7d, `/meta learn` then added a lesson, and the Step 8 commit shipped with a stale `maxL 397` (5 narrative refs) — caught after the commit, fixed in a follow-up commit.

   **Auto-fix rule (cumulative with Step 7b/7c):** Tier 1 mechanical edits land in Step 8's session-residual commit. Tier 2/3 surface as proposals in /wrap output — DO NOT block /wrap close. Owner addresses Tier 2/3 in a separate explicit invocation of `/meta architecture-audit`.

   **STAGE what 7d wrote (2026-07-18):** when `architecture-counts.mjs fix` applies any auto-fix, it prints each mutated path on its own line under `Mutated files — now DIRTY…` — `git add` EXACTLY those paths in the same turn (they then ride Step 8's residual commit). An unstaged sentinel write manufactures an orphan NO session ever opened: 2026-07-10, five sessions spent an hour hunting the "author" of a dirty catalog file that this script wrote as a Step 7d side effect — four disclaimed honestly and all four were right (the `wired-but-INVISIBLE` class, inverse of wired-but-inert; the ownership tree has no answer for a file no session Edit/Write'd). The stage is what closes the orphan; the per-path print is only the visibility half. One guard before the `git add`: `git add <path>` stages the WHOLE file — if `git diff <path>` shows anything BEYOND the count-sync `fix` just wrote (an unstaged peer co-edit), hunk-isolate (a bare commit sweeps the index) instead of a bare add.

   **Skip rules:**
   - Zero new L# headers in meta MEMORY AND zero new infrastructure files this session → skip silently (no drift-eligible surface touched).
   - `.claude/docs/architecture.md` already staged by parallel session → skip silently (defer to next /wrap).
   - File `.claude/docs/architecture.md` does not exist → skip silently (doc may have been retired).

   > 📁 **Moved, with the copy's edits, to [`references/step7-notes.md`](references/step7-notes.md) § 7d — evidence basis and coordination** — READ IT before executing this step.

7e. **Memory-distill cadence surface (fires when any `.claude/skills/*/MEMORY.md` ≥46,000 BYTES at session-close).** Surfaces the `/meta distill <skill>` budget at session-close as an FYI. **⚠️ BYTES, not lines — the predicate was line-based (≥4000) until 2026-08-01 and was blind to 22 of 23 capped files** (these run 139-318 B/line, so a file busts a token cap thousands of lines under a line threshold). **The old "on-demand ⇒ no harness truncation cap" claim was FALSE** (measured 2026-08-01): a sub-agent's `Read` is capped like anyone's — the real cliffs are **~57.5 KB** (the one-Read band; past it a read truncates and 87.3% of dispatches never page the remainder) and **262,144 B** (hard error). 46,000 B warns with headroom below the first cliff. Distillation stays owner-judgment. Raised 3000→4000 lines 2026-06-09; converted to bytes 2026-08-01.

   **Detection (≤5 sec):**
   ```bash
   for f in .claude/skills/*/MEMORY.md; do
     bytes=$(wc -c < "$f" 2>/dev/null || echo 0)
     [ "$bytes" -ge 46000 ] && echo "$(basename $(dirname "$f")) ${bytes}B"
   done
   ```
   46,000 B = the warn budget. Informational FYI, not an alarm — but a file over ~57.5 KB IS past a real read cliff, so treat those as actionable rather than optional. Owner judges whether to distill. **✅ THE TWO SIBLING INSTRUMENTS ARE NOW BYTE-KEYED TOO (converted 2026-08-01)** — `.claude/hooks/check-memory-size.sh` (the 4000-LINE `URGENT` retired; now `SKILL_WARN_BYTES=46000` / `SKILL_CEILING_BYTES=57500` / `SKILL_HARD_BYTES=250000`) and `scripts/wrap-reconcile.mjs`'s 7e probe (`wc -c`, warn 46,000 / ceiling 57,500). Spec and enforcement now agree on one quantity and one number across all four surfaces (this step + those two + the two live gates). Proof the conversion was load-bearing: against the live cohort the retired line predicate surfaced **nothing**, while the byte predicate surfaces **6 files at 46-49 KB**. **Carve-out:** `meta/MEMORY.md` is excluded from the 7e probe — a cold body store with a separately-governed hot tier (`active-recall.md`) and its own governor lane (`/meta distill`); naming it every wrap would train the reader to skip the note. Same carve-out, same reason, in `check-memory-budget.sh` ARM 2.

   > 📁 **Moved, with the copy's edits, to [`references/conditional-step-bodies.md`](references/conditional-step-bodies.md) § Step 7e — procedure and auto-fix rule (fires when a MEMORY.md is ≥46,000 B)** — READ IT before executing this step.

   **Skip rules:**
   - Zero MEMORY files ≥46,000 B → skip silently (all within budget).
   - Owner already fired `/meta distill <same-skill>` this session AND the file is now <46,000 B → skip silently for THAT skill; still surface OTHER over-budget files.

   > 📁 **Moved, with the copy's edits, to [`references/step7-notes.md`](references/step7-notes.md) § 7e — evidence basis and coordination** — READ IT before executing this step.

7f. **Meta-corrections registry sweep (mandatory when current-session scan returns ≥1 candidate event).** Closes the gap where `scripts/meta-corrections-scan.py` had documented the registry workflow but zero session-end automation layer — relied on orchestrator remembering to invoke `--session <id>` after each session (lesson-propagation-lag territory). /wrap auto-detects new owner-pushback-correction events and surfaces them for inline triage so they land in `.claude/meta-corrections-registry.md` before session close.

   **Canonical invocation:** `/meta corrections --scan --current` (then `--add` per approved row). See `.claude/skills/meta/SKILL.md` "Process — Corrections" for the full subcommand surface. The bash commands below are the orchestrator's implementation (Claude Code skills can't invoke slash-commands from bash, so the orchestrator calls `scripts/meta-corrections-scan.py` directly — same script that `/meta corrections` dispatches to).

   **Detection (≤3 sec):**
   ```bash
   python3 scripts/meta-corrections-scan.py --current 2>&1 | grep "^Total candidate events:"
   # → "Total candidate events: N across 1 session(s)"
   ```
   If N = 0 → skip silently. If N ≥ 1 → continue to triage procedure.

   **Caveat — `scan=0` ≠ "no corrections."** The regex keys on canonical correction tokens ("are you sure" / "wrong" / "no, do X") and structurally under-matches two flavors: (a) **imperative-reframe** (an instruction to redo the work properly, or a rejection of a variant); (b) **provenance-probe questions** (asking where a figure comes from, or why something is relevant). So before trusting `N=0`: if you KNOW an owner-correction occurred this session — you cited/asserted something → owner probed/pushed → your position shifted — manually `--add` it anyway (the `--add-entry` flow in step 6 below). Do NOT widen the regex to chase these: provenance-probe questions are overwhelmingly benign, so the recall fix would explode the registry's ~20-30% FP rate — the orchestrator's manual-add habit is the robust mitigation (capture-layer, not enforce-layer). Codified at occ-1 (an imperative reframe, 2026-06-03); occ-2 (2026-06-09) was a provenance question about a cited figure → `/me` gate dropped, scan returned 0.

   > 📁 **Moved, with the copy's edits, to [`references/conditional-step-bodies.md`](references/conditional-step-bodies.md) § Step 7f — triage procedure and auto-fix rule (fires when the scan returns N ≥ 1)** — READ IT before executing this step.

   **Skip rules:**
   - Zero candidate events (N=0) → skip silently. Most "normal" coding sessions without owner pushback fall here. **BUT** apply the caveat above first — if you KNOW a correction occurred this session (cited/asserted → owner probed → position shifted) but the regex returned 0, manually `--add` it; `scan=0` ≠ "no corrections."
   - All current-session events already present in registry (e.g., owner manually triaged mid-session) → skip silently per de-dupe check in Procedure step 3.
   - Trivial session (<5 messages, no significant decisions per /wrap trivial-session gate) → 7f skips alongside the rest of Step 7.

   > 📁 **Moved, with the copy's edits, to [`references/step7-notes.md`](references/step7-notes.md) § 7f — evidence basis and coordination** — READ IT before executing this step.

7g. **Forward-list tracker-home verification (forward-pointer list = tracker-verify per item, mandatory whenever the closing session summary will include a "Pending / next session" / "what's next" / forward-pointer list).** Closes the forward-direction gap that Step 7c does NOT cover: 7c syncs SHIPPED work *backward* into trackers (archive-done / mark-closed / capture-ideas); 7g verifies the PENDING (work-to-come) list each item resolves to a durable home BEFORE it is presented to the owner as "tracked." Without this, the orchestrator free-composes the forward-list from conversation memory and asserts items are tracked when they are not — the recurring failure where the owner has to ask whether the items are tracked and a floating item surfaces.

   **Cross-session delivery — a tracker home is necessary but NOT sufficient for a hand-off.** If a forward-list item ASSIGNS work to ANOTHER session (defer-to-peer / hand-off / "→ the owning session's wrap"), the durable home is PASSIVE — the named session won't SEE it. `mail-send --to <sid8|all>` the hand-off at wrap (free, no approval needed) so it doesn't ORPHAN when THIS session terminates (the dead-session-orphan failure: the deferral had to be dug out of a closed peer's transcript by hand). Both: a durable home AND a mail.

   **Procedure (per forward-list item, ≤30 sec each):**
   1. Resolve each item to a concrete durable home — `todo.txt:N` open task / `BACKLOG.md` row / `project_*.md` tracker line / `project_feature_audits.md` row. Grep/read to confirm the line exists; don't assume.
   2. Item resolves → keep it in the list (optionally cite the home).
   3. Item does NOT resolve (lives only in this conversation / a prior session's wrap-summary / a "queued for a future pass" note) → it is **FLOATING**. Create the durable entry FIRST (tracker-home at creation — declare tracker-home with a concrete trigger), THEN list it.
   4. Prefer building the forward-list FROM the tracker files over free-composing it from memory.

   **Behavioral guard:** the summary shape *"N of M were already tracked, 1 had a gap now fixed"* is the SYMPTOM of an unverified emission — the existence of the 1 gap proves the list was presented without per-item verification. Run 7g BEFORE emitting; the owner should never have to ask.

   **Auto-fix rule:** creating a floating item's durable entry is a ≤15-LOC tracker append → execute inline during /wrap; the new `todo.txt`/`BACKLOG.md` line lands in Step 8's session-residual commit (so the entry exists before the summary that references it ships). If a floating item needs a NEW BACKLOG P-tier slot or a tracker-row creation >15 LOC → surface as a proposal, don't free-compose.

   **Skip rules:**
   - Closing summary has no forward-list (nothing left pending) → skip silently.
   - Trivial session (<5 messages, no decisions per /wrap trivial-session gate) → 7g skips alongside the rest of Step 7.
   - Target tracker (`todo.txt` / `BACKLOG.md`) currently staged by a parallel session per Step 8 pre-stage check → create the entry but expect the parallel-session commit discipline (explicit pathspec) to keep it isolated; if the file is mid-write by a peer, the floating item's home may defer to the NEXT /wrap (note it explicitly rather than silently dropping).

   > 📁 **Moved, with the copy's edits, to [`references/step7-notes.md`](references/step7-notes.md) § 7g — evidence basis and coordination** — READ IT before executing this step.

7h. **Defer-trigger reconcile sweep (deterministic; added 2026-06-22).** When this session has ≥1 commit, run the defer-trigger evaluator and surface its **RECONCILE bucket** — items whose `done-when` predicate just became TRUE (work shipped this session) but whose box is still `[ ]`:
   ```bash
   python3 scripts/defer-trigger-scan.py   # bare is COMPLETE for commit-touches since 2026-07-30 (blame-anchored default); add --run-exit-zero when the exit-zero predicates matter
   ```
   > 📁 **Moved, with the copy's edits, to [`references/step7-notes.md`](references/step7-notes.md) § 7h — HISTORY: the bare-invocation window** — READ IT before executing this step.
   For each RECONCILE candidate: **verify the deliverable yourself** (the `done-when` is a heuristic — a narrow predicate can cry wolf; e.g. a 2026-06-22 over-narrow done-when falsely read "done"), then flip `[ ]`→`[x]` with a one-line evidence note. An item bundling a SEPARATE deferral stays surfaced — never auto-flip (the manual June-12 reconcile shipped 2 false-RESOLVED of 35). Edits land in Step 8's commit (`todo.txt`, explicit pathspec).
   - ⛔ **READ LINE 1 FIRST — THERE IS A FOURTH BUCKET AND IT VOIDS THE OTHER THREE.** If line 1 carries `⛔ N INSTRUMENT FAILURE(S) — THIS RUN IS VOID`, N predicates could not be EVALUATED (a git/grep/eval error, or a `--since` git cannot parse), so every bucket below it is computed over a partial evaluation and none of them is a reading. Fix the instrument and re-run; do NOT triage the buckets. Measured 2026-09-06: one malformed `--since` moved DOABLE-NOW 71 → 2 and STALE 0 → 79 while rc, the unevaluated count and the RECONCILE bucket all stayed identical — every number this spec tells you to read was invariant under a totally broken run. The `wrap-reconcile.mjs` gate reads this line for you and pushes a VOID finding into `findings[]`, so the tool will refuse `ok:true` — but it reads the scan it runs ITSELF, not one you ran by hand, so a hand-run here still needs your own eyes on line 1.
   - **DOABLE-NOW bucket → surface as a one-line COUNT only** — "N defers now doable — `/triggers` for the list" (since the 2026-07-30 blame-anchored default, the bare command reproduces the count; the general rule stands: a surfaced count's pointer must name the exact invocation that produced it — measured 2026-07-30, 17-vs-1); do NOT expand it. You act on doable-now at session START (when you have appetite), not at close. **STALE bucket** (a `meta:` predicate pointing at a missing path) → open each row first: one whose text names the printed STALE detail as its fire is a FIRE, surfaced to the owner and never re-pointed; otherwise surface + fix inline (≤5-LOC block edit).
   - **LATCHED bucket → surface as a one-line COUNT beside it** — "N latched — hot-path commit-touches rows that fired long ago; re-key, not work" (since 2026-09-07: a `commit-touches` row whose watched path has ≥ `LATCH_COMMITS` distinct commits since the row's own anchor leaves DOABLE-NOW for LATCHED — still on the bare scan, never behind a window; `scripts/defer-trigger-scan.py` prints the resolved threshold in the banner). They are NOT in the doable-now count, so a doable-now figure that fell across that date is re-labelling, not progress — `wrap-reconcile` reads the count from the same line 1 and says so. A latched row's disposition is a predicate RE-KEY (grep-present / file-exists / exit-zero on the thing it actually waits for), a ≤5-LOC block edit, the same shape as STALE below.
   - ⛔ **AT A RETIREMENT WRAP THE DOABLE-NOW COUNT IS NOT AN OWNER ITEM.** A retiring session — a former review hub included — takes in no new work, during its service or at its end. The bucket is FLEET backlog whose blockers happened to clear; it is not this session's scope and it is not a decision. A retiring session **hands off open loops and opens none** — put the count in the handoff broadcast or leave it for `/triggers`, and keep it out of the owner-facing close. **Tell: you are about to write a number under "Needs you" that no one asked for and that nothing bad happens to if it waits.** Measured: 71 was surfaced to the owner three times in one retirement close, each time correctly derived and none of it theirs.
   - **Skip when:** zero session commits; `todo.txt` currently staged by a parallel session (per Step 8 pre-stage check — reconcile next /wrap); trivial session (<5 messages).
   - **Coordination:** complements `/hanging-work` Check 12 (run at Step 1), which greps FREE-TEXT defer triggers (broad net, catches un-`meta:`-tagged items); 7h evaluates the structured `meta:` blocks deterministically (precise, the class-1 subset). As more defers get `meta:` blocks, 7h subsumes Check 12. On-demand twin = `/triggers`; session-START surface = `/orient` Step 8.

8. **Commit session-touched residual files** (see "Commit procedure" below). **Commit-only — never push `main` at wrap:** a production push is a separate owner-gated action, and wrap readiness ≠ push authorization. Not a `dev` push either, here: that is Step 12, the OPTIONAL last act of the wrap, after the Session Summary. *(Read "never offer or perform a `git push`" until 2026-10-05, and "offer it last if staging lacks this seat's work" until 2026-10-06.)* Scope: MINE + SHARED MEMORY files NOT already committed by `/audit-check` runs during the session. Typical contents: meta/CHANGELOG edits, `/session-memory` adds, skill-spec fixes, ops-docs updates, non-feature bug fixes, **and `/me learn-session` Step 7a output (user_profile.md + new feedback_*.md files)**, **and `/meta architecture-audit` Tier 1 auto-fixes from Step 7d**, **and `/wrap` Step 7f registry entries appended to `.claude/meta-corrections-registry.md`**. Skip silently if zero residual files. Auto-execute on unambiguous classification; surface as proposal when UNKNOWN files exist.

   ⛔ **AFTER THE RESIDUAL COMMIT, RUN THE LESSON-NUMBER CHECK AGAINST WHAT WAS COMMITTED, NOT THE WORKTREE.** A bare `node scripts/check-lesson-numbers.mjs` reads the worktree's meta memory files, so a shard roll whose old-shard DELETION never reached the commit passes here. The pre-push gate reads the PUSHING tree's worktree too, so it refuses that push only when the push runs from a tree matching HEAD; pushed from the shared tree carrying the unstaged ` D`, it passes as well. Measured 2026-09-25: the previous wrap's roll left both shards in HEAD for ~2.5 h; the bare check passed on the worktree (old shard absent there) and the duplicate surfaced only when an approved push was blocked from a tree with 0 paths differing from HEAD. Concatenate HEAD's meta memory files into one scan:
   ```bash
   R=$(git rev-parse --show-toplevel); T=$(mktemp); U=$(mktemp); git -C "$R" ls-tree --name-only HEAD .claude/skills/meta/ | grep -F '/MEMORY' | while IFS= read -r f; do git -C "$R" show "HEAD:${f}" >> "$T"; done; git -C "$R" show HEAD:.claude/skills/meta/RETIRED.md > "$U"; node "$R/scripts/check-lesson-numbers.mjs" "$T" "$U"; echo "rc=$?"; rm -f "$T" "$U"
   ```
   Controls, 2026-09-25: HEAD read PASS (1,629 declarations); the same scan with one shard appended twice read rc=1. Read the `✗` line, not only the rc: `DUPLICATE L#` or `GAP-REUSE` means the commit carries a bad lesson number — fix it inside this wrap, before anyone pushes; `NOT read` or `not found` means the scan itself did not run, which is not a pass — fix the invocation and re-run.

8a. **Late-commit review re-derivation — MANDATORY.** Step 5e fires ONCE, at its place in the sequence, and the wrap then keeps committing — Step 7f's corrections entry, Step 8's residuals, the plan write, any lesson commit. Those land AFTER the request went out, so the request cannot name them. This step is the only thing that closes that window, and it is mandatory for the reason `/post-compact`'s Step 6 is: **its trigger is not a moment anyone chooses.** A seat that skips it does not know it skipped anything.

    ⛔ **THIS IS NOT A SECOND `--code` PASS, AND MUST NOT BECOME ONE.** Most wrap-caused commits are the bookkeeping a review hub explicitly does not want in its queue — the hub would rather the commits keep coming than have its queue carry bookkeeping. The cost this step is allowed to impose is one command and a classification — never a reviewer seat.

    **Derive, PARTITION, classify, then SEND — in that order.** *(This headline read "then ASK" until the send-side rule below replaced it.)* The 5e request's own mail is the boundary; take its timestamp, or the sha you named in it.

    ⛔ **THE RAW RANGE IS NOT YOUR WORK, AND THIS STEP SHIPPED CLAIMING IT WAS.** `<sha>..HEAD` on a shared branch contains every session's commits, and 5e's own arm (a) twelve paragraphs up already says *"EXCLUDE peer commits interleaved on `main` — match your own authorship/work, not the raw range."* 8a is the patch to 5e and its first version dropped 5e's guard. **The classification table below keys on what a commit TOUCHES, which is path-based, so a peer's commit to `.claude/rules/` classifies as "name it" and reaches the owner as this seat's unreviewed work** — on a MANDATORY step, whose noise costs the most precisely because it runs every wrap.

    ```bash
    # 1 · the window — every commit on the branch since the request. NOT yours yet.
    git log --format='%H %h %s' <5e-request-sha>..HEAD | cat
    # 2 · PARTITION by the seat that ran the commit, and COUNT what does not partition
    P=$(python3 scripts/session-labels.py partition --range <5e-request-sha>..HEAD) || { echo "PARTITION FAILED — instrument failure, NOT an empty partition" >&2; exit 1; }
    printf '%s\n' "$P" | sort   # MINE / <sid8> / URL-OTHER / NO-TRAILER, all three of this seat's labels
    # 3 · what YOURS touch — the classification input, never the subject line
    git show --numstat --format='%h' <your sha> | cat
    ```

    > 📁 **Moved verbatim to [`references/steps-8-11-output-notes.md`](references/steps-8-11-output-notes.md) § 8a — partition, not filter** — READ IT before executing this step.

    ⚠️ **TWO HOLES, BOTH ALREADY CODIFIED, BOTH NAMED IN WHAT YOU REPORT.** The trailer records who RAN `git commit`, never whose WORK is in it — one commit can sweep a peer's uncommitted lines — so a partition is not an authorship claim. And its value has THREE spellings (8-hex, a session URL, a full UUID); the script matches all three of THIS seat's labels, so another seat's URL lands in `URL-OTHER` and an absent trailer in `NO-TRAILER`, both reported as residue rather than silently dropped. **Report the residue count out loud.** A private-index commit drops the trailer entirely unless its `-F` message file carries one, which is exactly the recipe reached for on contended files.

    ⛔ **AND SAY WHAT THE NUMBER IS A COUNT OF.** The first version of this step said "every commit this wrap made after the 5e request went out". On a shared branch that sentence is false. Say instead: *"N commits landed on the branch since the request; M carry this seat's trailer; R did not partition."*

    | the commit touches | disposition |
    |---|---|
    | a WIRED hook, a guard predicate, a gate, `settings.json` | **name it to the owner** — failure is fleet-wide and silent |
    | an ALWAYS-LOADED file (`.claude/rules/`, `CLAUDE.md`, `AGENTS.md`, `.claude/orchestrator/`) | **name it** — every seat and sub-agent loads it |
    | `src/`, a migration, a new or edited test | **name it** |
    | `todo.txt` rows, `plans/` prose, a memory router re-index, `DECISIONS.md` | skip — say you skipped them, in one clause |

    ⛔ **JUDGE IT YOURSELF, SEND IT, AND SAY SO — THIS SUPERSEDES THE ASK-NEVER-SEND SENTENCE THAT STOOD HERE.** If the classification returns anything, YOU decide whether it warrants a review, mail the hub, and NAME in the closing message that you sent it and what it was. Do not put the decision to the owner. ⛔ **BOTH BRANCHES DISCLOSE, and this sentence covered only the SENT one until 2026-09-07:** a commit you judge NOT to warrant a review is still `name it` per the table above — say what you classified and why you did not send it, in one clause. Silence is not the not-sent branch. ⛔ **AND IF NO HUB IS LIVE, *mail the hub* has no referent:** take `behavioral-anti-patterns.md` #9's carve-out — broadcast, await an ack, self-run only on silence — and say which rung you took. That self-run IS the token spend the struck clause was guarding, so it is the one thing here still worth naming to the owner BEFORE it happens. *(📁 the rest of this paragraph moved, with the copy's edits, to [`references/steps-8-11-output-notes.md`](references/steps-8-11-output-notes.md) § 8a — the send-side rule — provenance only.)*

    > 📁 **Moved, with the copy's edits, to [`references/steps-8-11-output-notes.md`](references/steps-8-11-output-notes.md) § 8a — what the old ask-never-send sentence said** — provenance only.

    **An empty classification is the common case and a good answer: say "nothing since the request but records" and close.**

    ⚠️ **RE-RUN IT IF A LATER STEP COMMITS.** Step 9's conditional lesson sweep can commit, and so can any recovery. The window this step closes is *last commit → closing sentence*, so a commit after 8a re-opens it. **TELL: you committed anything after running this — run it again.**

    ⚠️ **AND THE BOUNDARY IS THE THING TO GET RIGHT.** If 5e did NOT fire this wrap (its three conditions did not all hold — a held batch sent late at 5e, outside its gate, is not a boundary), there is no request sha and this step has no boundary — say so and skip it explicitly, rather than inventing a base. Skipping for that reason is a decision; skipping silently is the defect.

9. **Wrap-execution lesson sweep (conditional — added 2026-06-17).** Step 2's `/meta learn` fires EARLY (before Steps 3–8), so it is structurally blind to lessons that arise DURING /wrap execution — a clobber/conflict caught at the Step 8 commit, a defer promoted at Step 1c, a mid-wrap compaction + recovery, a sub-skill surfacing a NEW structural gap, a tool/script failing mid-wrap, or an owner-flagged /wrap friction. After Step 8, ask: **did anything non-mechanical happen during THIS wrap's execution (Steps 1–8 + any mid-wrap recovery)?**
   - **No (the common case — every step ran clean, no surprises):** skip silently. Most wraps are mechanical.
   - **Yes:** run a TARGETED `/meta learn` scoped to the wrap-EXECUTION window ONLY (NOT the whole session — Step 2 already covered the session's work). Same D+I+S scoring; write the lesson to meta MEMORY (+ a RULES.md row if it qualifies); if it's a /wrap or meta-process gap, propose/apply the spec fix. The lesson + any meta writes land in a SEPARATE small path-scoped follow-up commit (Step 8's commit already closed).

   > 📁 **Moved, with the copy's edits, to [`references/steps-8-11-output-notes.md`](references/steps-8-11-output-notes.md) § 9 — why a second learn** — provenance only.

   **Skip gate:** trivial session (<5 messages) OR a purely-mechanical wrap (every step ran clean — no recovery / conflict / friction / new-gap). Don't manufacture a lesson where the wrap just worked. **Evidence (the founding case):** a 2026-06-17 audit-redo wrap had auto-compact fire AT Step 2, a peer clobber near-miss caught later in the wrap, and a lesson codified in the post-compact resumption — three execution-time lessons the Step-2 run structurally could not see.

10. *(Not in this copy: the source project used this step, opt-in under `/wrap --memefy`, to suggest an optional write-up command the copy does not ship. Without the flag the step is skipped entirely and nothing is said about it (the Self-attested remainder slot does not list it); `wrap-reconcile.mjs` then owes no memefy row.)*

11. **Wrap-verification — the terminal COMPLETION GATE (2026-07-01; superpowers verify-before-completion, in a design a four-seat review converged on).** Runs AFTER Steps 0-10, immediately BEFORE the Output Session Summary may use the word "complete." This is the layer that makes the Iron-Law's checkmark COMPUTED, not asserted — it is the enforce fix for the recurring self-certified-but-incomplete /wrap (dropped 3-of-6 panel persists + skipped a fired deep-pass + emitted "10/10 ran," recurring 3+ times).

> 📁 **Moved, with the copy's edits, to [`references/conditional-step-bodies.md`](references/conditional-step-bodies.md) § Step 11 — attributing a recovered Memory-Update block (when one is recovered)** — READ IT before executing this step.
   - **Run the reconcile:** `node scripts/wrap-reconcile.mjs` (warn-mode; reads the session-start anchor `.claude/state/session-start-sha-<sid>` + the per-agent task-output files vs the persisted `*MEMORY.md` git-diff). It surfaces (a) a **MEMORY-UPDATE DELTA** — N `### Memory Update` blocks emitted by THIS session's agents vs M persisted; ANY positive delta → enumerate the emitting agents (their `tasks/*.output` returns) + persist each un-consumed block, OR cite a per-block dedupe with a `MEMORY:line`; (b) a **DEEP-PASS check** — if the >1500-line/>20-commit + compaction trigger fired but no parallel deep-pass dispatched, RUN it (don't rationalize "in-context").
   - **Step-artifact probes (2026-07-13).** The reconcile now ALSO probes the steps whose output is an ARTIFACT rather than prose, because that is exactly where the misses cluster: **the steps that produce PROSE get narrated and the steps that RUN A SCRIPT or WRITE A FILE get skipped** — and the summary READS complete either way (every step NAME appears in it). Probed: **Step 0** (the `session-wrapped-<sid>` stamp — the peer WAKE signal), **Step 7d** (`architecture-counts check` clean) → artifact-bearing, each a **FINDING** when absent; **Step 7e** (distill cadence ≥46,000 B — `wrap-reconcile.mjs` filters on `wc -c` as of 2026-08-01; the `>= 4000` LINES predicate that made its print under-report is retired) + **Step 7h** (defer-trigger doable-now count) → surface-bearing, so **the tool computes and PRINTS them itself** rather than trusting the orchestrator to remember. A probe that cannot run reports BLIND, never a silent pass. Evidence: one session self-certified 7d/7e/7h done; a real run returned 22 count-drifts (incl. that session's OWN new hook absent from `architecture.md`), a fired distill cadence and 16 doable-now triggers — caught outside the wrap, not by it. **Every OTHER step remains SELF-ATTESTED: cite its artifact inline, or add a probe (~10 lines, the `findings[]`/`notes[]`/`blind[]` seams exist) in the same commit that makes it mandatory.**
   - **Git-story closure (guildhall-adopt 2026-07-05):** run `node scripts/git-story-closure.mjs` (warn-mode, deterministic; composes `git status` + unpushed-count + `whose-edit` + `migration-notation-reconcile --json`). It COMPUTES the closure state — `clean` / `unpushed(N)` (the SANCTIONED default — a `main` push is owner-gated and a `dev` push is Step 12's optional last act → NON-blocking) / `dirty_mine(N)` / `dirty_unattributed(N)` (orphan — resolve) / `migration_unrecorded(NNNN)` / `migration_probe_unread` / `mixed[…]` / `unknown` — plus a `ready` boolean. The Session Summary MUST name the closure state + declare intent per non-clean component (unpushed = intentional per the push gate or Step 12's optional `dev` push; dirty_mine = commit or deferred-with-reason; dirty_unattributed = ask every peer to claim or disclaim it, check for a live peer, and adopt and commit it only after a real window of silence; migration_unrecorded = backfill; **`migration_probe_unread` = the migration axis is UNMEASURED, not clean — the probe refused, crashed or skipped for want of a DB URL, so declare that you did not measure it rather than reporting no findings; NON-blocking, because a worktree without database credentials is legitimate**). Surfaces only — never blocks the wrap. ⚠️ `dirty_peer` and `no_upstream` are named in the state list above but not here; that gap predates the new state and is not closed by it.
   - **Pasted-count discipline (load-bearing):** every `{N}` slot in the Output Session Summary MUST be a PASTED command output (`git log --oneline <sha>..HEAD | wc -l`; the reconcile's own counts), NOT a typed number — a typed "6/6" satisfies the gate while proving nothing. If you cannot paste the count, the step didn't verifiably run.
   - **Warn-mode (calibration phase):** `wrap-reconcile.mjs` exits 0 always right now — it INFORMS the gate, it does NOT yet block; the orchestrator still owns acting on a surfaced delta. The emitted-side (per-agent task-output, mtime-windowed) needs ~5 clean-warn wraps of calibration before block-mode + a Stop-hook wiring (as the review recommended). Escape valve for the eventual block-mode: `SKIP_WRAP_COMPLETENESS=1`.
   - **Skip gate:** trivial session (<5 messages). **Why this late, not earlier:** the Session Summary is the artifact that makes the false "complete" claim; the gate must run against the FINAL state, immediately before the summary emits.

12. **Optional `dev` push — the LAST act of the wrap, after the Session Summary is out.** A push costs time and tokens, so it happens only at the wrap, is optional there, and comes at its end: a session pushes `dev` ONLY here, when the owner asks, or inside the owner's `/promote`, never mid-session, and the wrap never waits on it: the summary and the closability verdict are written first, and a wrap without a push is complete. **Under `--checkpoint`, skip this step unless the owner asked for the push** (a checkpoint is mid-session by definition and is sometimes self-invoked). **Default: skip unless needed.** Push only when BOTH hold: this seat's commits are not on GitHub's `dev` (`git fetch origin && git rev-list --count origin/dev..dev`, and check your own shas with `git merge-base --is-ancestor <sha> origin/dev`; a peer's push carries every commit already on `dev`, so a push is often redundant), AND staging needs them soon (the owner is waiting to look, or a promote is next). Then run `/push` (its D0 and the hook's one-push-at-a-time lock still apply) in the background. A refusal names its reason: on the lock, or a push already in flight, wait for it to land, run `git merge-base --is-ancestor <your sha> origin/dev`, and push again only if your shas are missing — a running push carries only the commits that were on `dev` when it started, never this wrap's Step 8 commits; on an open promote PR, a hold or a diverged `dev`, skip and say which one in one sentence. Once `/push` is running, report its landed line in one sentence when it arrives. A gate that ran 51, 6, 28 and 53 minutes on four tries on a busy box (measured 2026-10-06) is the reason this is last and optional.

## Commit procedure (shared with /audit-check Post-Gate Action)

1. **Enumerate:** `git status --porcelain` (don't use `-uall` on large repos per Claude Code safety protocol).
2. **Classify each entry:**
   - **MINE** — orchestrator touched via Edit/Write/Bash this session (orchestrator knows from conversation context — this skill can't infer it). Include.
   - **SHARED MEMORY** — `.claude/skills/*/MEMORY.md` files with MY session's entries alongside parallel-session entries. Include (append-only, non-conflicting, per shared-memory append discipline).
   - **PARALLEL** — modified by concurrent session, orchestrator did NOT touch. Exclude (per parallel-session coordination).
   - **UNKNOWN** — can't classify confidently. Surface for user decision before committing.
3. **Build explicit file list:** `git add path/one path/two ...` with MINE + SHARED MEMORY only. **Never** `git add -A` / `git add .` / `git add -u` when parallel sessions are active.

   **Pre-stage check (mandatory when parallel session active):** `git add <paths>` is ADDITIVE — doesn't reset the staged index. If a parallel session pre-staged files to the shared index, your subsequent `git commit` captures the union (theirs + yours) as one commit. Before staging:
   ```bash
   git diff --staged --name-only
   ```
   If the output shows files you didn't stage this session → **use `scripts/safe-commit.sh`.** It runs its gates in the SAME PROCESS as the commit, which is the whole point (a gate in a previous tool call is already stale).
   > 📁 **Moved, with the copy's edits, to [`references/steps-8-11-output-notes.md`](references/steps-8-11-output-notes.md) § Commit procedure — the two superseded options** — READ IT before executing this step.
   **Neither verb (`git restore --staged` + a bare commit, or `git commit -o`) is safe alone; picking by habit loses about half the time.** If `safe-commit.sh` REFUSES because a peer holds a foreign path staged, do not unstage, do not commit bare, and **do not HOLD** (measured the worst option — an uncommitted worktree line is the only state with no history): gate both numstat columns by hand, commit, and **say out loud in the body that you did.** Mechanism + the worked collision→verb pair: `.claude/rules/bash-environment.md`.
   > 📁 **Moved, with the copy's edits, to [`references/steps-8-11-output-notes.md`](references/steps-8-11-output-notes.md) § Commit procedure — evidence** — provenance only.
4. **Commit message conventions:**
   - `/audit-check` post-PASS: `{scope}({feature-id}): {one-line COMPLETE summary}` (e.g., `feat(F9): cancel-flow final audit — 10/10 COMPLETE`)
   - `/wrap` session hygiene: `{session-subject}: {one-line summary}` (e.g., `meta(v2.5.3): /meta self-audit — active-recall-before-write collision resolution`)
   - Never include sensitive files (`.env`, credentials) — warn the user if they explicitly request.
5. **Hook-failure protocol:** if pre-commit fails, fix the underlying issue, re-stage the same files, create a NEW commit. Never `--amend` (commit didn't happen; amending rewrites the PREVIOUS commit). Never `--no-verify` unless user explicitly requests.
6. **Skip rule:** if post-classification file list is empty, skip silently. No empty commits.
7. **Proactive visibility layer (HIGH cross-session overlap ONLY).** When this wrap committed SHARED files into a live collision zone — a shared meta/memory file (`meta/MEMORY.md`, `meta-corrections-registry.md`, `RULES.md`, an expert `MEMORY.md`) that a peer also committed/staged DURING your wrap, OR ≥2 peer commits landed on `main` since your session-start SHA — fire the VISIBILITY layer that the git-safety layer (commit-`-o` / explicit-pathspec / first-commit-wins) leaves silent + invisible:
   > 📁 **Moved, with the copy's edits, to [`references/conditional-step-bodies.md`](references/conditional-step-bodies.md) § Commit procedure 7 — the announce, the durability-show and the one-grep bound (HIGH overlap only)** — READ IT before executing this step.

## Output

Per the Iron-Law + Step 11: every `{N}` below is a PASTED command output (not a typed number), and the terminal `Wrap-verification` line is the computed completion proof — a wrap that cannot emit it is not complete.

> 📁 **Moved, with the copy's edits, to [`references/steps-8-11-output-notes.md`](references/steps-8-11-output-notes.md) § Output — the commit count (superseded as an output obligation)** — READ IT before executing this step.

> 📁 **Moved, with the copy's edits, to [`references/steps-8-11-output-notes.md`](references/steps-8-11-output-notes.md) § Output — why Bottom line exists** — provenance only.

**Hence `Bottom line:` FIRST, and it is a REQUIRED slot.** It is not a summary of the summary — it is the one register this contract lacked. Two rules govern it:
- **Plain words only.** No coined name as its subject, no unit-bearing number, no closure token, no sha, no path, no rule id. Those all belong in the slots below, which is what they are for. The benchmark is words the OWNER uses — *not* "findable in the repo", which is the inverted test that passed both measured failures (`memory-delta` is in 14 repo files).
- **Never manufacture a claim to fill it.** If closing costs nothing, it says so — and a review this session sent whose verdict has not arrived is a cost, not nothing: say the close waits on it (.claude/orchestrator/conventions.md, the closability row). The measured failure invented a cost identical whether the session stopped or continued; a format that produces a second one has made things worse.
> 📁 **Moved, with the copy's edits, to [`references/steps-8-11-output-notes.md`](references/steps-8-11-output-notes.md) § Output — the retired Receipts row** — provenance only.

```
Session Summary:
- Bottom line: {ONE-TO-TWO plain sentences — what happened and what (if anything) needs the owner. Someone who did not watch this session must be able to act on it. Its last clause answers the owner's question in the owner's words: "You can close this session now." or "Don't close yet: <the one thing still owed>." — any later message in the same turn-chain repeats that clause. Numbers as digits. REQUIRED; the slots below are the mechanism register and never substitute for it}
- Landed: {WHAT this session shipped, in prose + the subject lines. ⛔ NO PER-SESSION COMMIT COUNT: the number serves no decision the owner makes, every instrument that produces it is a floor presented as a count, and the cheaper fix is to delete the claim rather than keep repairing it. The FLEET unpushed count below is honest and stays.}
- Tests: {N} new ({total} total)
- Feature audits this session: {list with Check 10 e2e result}
- Expert system: {changes if any}
- Reviews sent: {the sha(s) mailed to the hub at 5e/8a and what each was — OR, in one clause, what you classified and judged not to warrant one, and to whom you broadcast if no hub was live. ⛔ **SELF-ATTESTED, never tool-computed** (`wrap-reconcile.mjs` computes the memory-delta, the deep-pass, the post-compact marker, 4 step-probes, the plan clock-label note and the Steps 1/2/3/3a/7a sub-skill invocation check (Iron Law #6, notes only); its own coverage line then declares every OTHER step self-attested, and this slot falls under that blanket rather than being separately probed — stated that way because the first draft of this slot claimed a per-item UNVERIFIED list the tool does not have). Added 2026-09-07: the send-side rule makes this disclosure the surviving obligation — the owner keeps the visibility and stops being asked — and it had a home in 5e's and 8a's step text but NO slot in the artifact a seat actually fills, which is the carrier defect this whole arc was about, one plane out. Precedent one slot down at Next session: the template is the carrier, not a lapse of attention.}
- Pending: {anything left undone, incl. any Check 10 failures needing follow-up} — ⛔ **IN THIS SLOT AND THE NEXT, A STEP THE OWNER PERFORMS OUTSIDE THIS TERMINAL CARRIES ITS CLICK PATH: where to go, which control, what done looks like (`/summary` §5 carries the same clause; a memory rule covering it was loaded in all three sessions that handed over a bare step in one week, and each time the how had to be asked for). A wrap's closing message is composed from this template, so the rule sits here rather than only in memory.**
- Next session: {suggested starting point} — ⛔ **IN CHECKPOINT MODE THIS SLOT IS `Next — me:` AND NAMES WORK YOU RESUME IMMEDIATELY, NOT WORK FOR A LATER SESSION.** There IS no next session after a checkpoint: the session continues. Measured: a checkpoint whose headline correctly read *"Checkpoint complete — session still live"* filled this slot two lines later with *"Next session: that fold-verify, then the five unread bodies"* — and both items were live work the hub simply carried on with once told to. **The template is the carrier, not a lapse of attention:** every other slot is mode-neutral, so this is the one place close-framing survives a checkpoint, and it sits AFTER the framing rule has already been obeyed at the top. **Check: if the summary says the session is still live, the closing slot must name a NEXT ACTION, and the next tool call should be that action.** A readout that hands the next move to the owner IS the defer, whatever the headline said.
- Wrap-verification (COMPUTED by wrap-reconcile.mjs): {emitted}→{persisted} memory-blocks · deep-pass {fired?/ran?} · served model(s) {SELF-ATTESTED from `toolUseResult.resolvedModel` per /deep-pass § MODEL ROUTING — not computed by wrap-reconcile} · under `--sonnet`, if the stop fired: {HALTED at slice N on <model> · `line region <first>-<last> unscanned` · the question put to the owner}
- Git-story closure (COMPUTED by git-story-closure.mjs): {closure enum — pasted} · ready={true/false} (intent named per non-clean component)
- Self-attested remainder (NOT tool-covered — cite the artifact per skipped/asserted step): {per-step artifacts or skip-justifications}

{the Bottom line's close clause again, alone on the summary's last line: "You can close this session now." or "Don't close yet: <the one thing still owed>." Under `--checkpoint`: "Session continues: <the next action>."}
```

*(Output-line honesty: the tool computes exactly 2 enumeration probes — a typed "mandatory-step deltas: none" next to computed counts launders self-attestation as tool output. Policy: adding a NEW mandatory step to this spec → same commit either adds a wrap-reconcile probe for it OR adds it to the tool's printed UNVERIFIED list — never silently.)*

## Test gating in /wrap (revised 2026-06-09)

**Heavy test gating** (integration + e2e + tsc) is owned by `/audit-check` (feature-level: Checks 9 unit+integration+tsc, 10 delta-e2e) + pre-push hook (i18n + the LIGHT gate; build on any non-main push touching e2e-relevant paths, and on an all-dev push touching a build input; changed-e2e only on a feature/hotfix push — an all-dev push, the only push a wrap makes, skips the specs in the hook since 2026-10-06, and `/push` D2b runs them beside that push, never gating it, since 2026-10-08) + CI (full suite on a PR into main and a push to main). `/wrap` stays out of those — they're slow and tied to the feature boundary — with ONE exception: Step 1's `/hanging-work` runs the changed-files e2e itself (its Step 4).

**The one thing `/wrap` DOES run is the unit suite, conditionally** (Step 5b): only when the session touched `src`/`tests` AND ran **zero** `/audit-check`. Rationale — the original design kept ALL tests out of `/wrap` for three reasons; later evidence revised two of them:
> 📁 **Moved, with the copy's edits, to [`references/steps-8-11-output-notes.md`](references/steps-8-11-output-notes.md) § Test gating — the three original objections** — provenance only.

Integration + e2e remain OUT of `/wrap` (slow; `/audit-check` and the promote PR's CI cover them — the pre-push hook runs no e2e on a dev push since 2026-10-06, so Step 1's `/hanging-work` Step 4 is the only local browser run a wrapping session's code gets before the promote PR, unless the wrap's optional push runs `/push` D2b's non-gating browser run beside it, since 2026-10-08). The unit gate is the narrow fix for the one gap those layers leave: a code-touching session that runs no `/audit-check` otherwise has no local full-unit run before commit/push.
