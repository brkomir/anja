# /wrap — Steps 0 to 1c — the full pre-slim text, moved, with the copy's edits, from `.claude/skills/wrap/SKILL.md` (2026-10-25)

**Not loaded on a wrap.** `../SKILL.md` is the core an invocation and every compaction carry pays for; this file holds that step's full prior text — the rulings, measurements, incident records, history and instrument commands the core condenses. **Where this file and the core disagree, the core wins.** Each `## ` section below is one step (or section) of the core, cut at the ref's line numbers, and the sections tile the pre-slim body with no gap. A `references/<file>.md` pointer inside the moved text resolves against the skill directory (`.claude/skills/wrap/`), as it did in the core. Append new history to the core's owning step reference, never to the core.

## Step 0 — session manifest, gate, post-compact gate, mail peek, lifecycle marker — from `SKILL.md` § Process, lines 82–133

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
# 📁 moved, with the copy's edits, to .claude/skills/wrap/references/step0-gate-notes.md § Checkpoint flag — spelling and marker history — provenance only
#   ⚠️ Intent is DECLARED, never inferred — omit the flag on a checkpoint and the run is
#   indistinguishable from a close again, which is the whole defect this closes.
```
> 📁 moved, with the copy's edits, to .claude/skills/wrap/references/step0-gate-notes.md § Queued-directive residue scan — founding incident — **READ IT before executing this step** (a reference-file pointer, not the scan-output legend above)
> 📁 moved, with the copy's edits, to .claude/skills/wrap/references/step0-gate-notes.md § Orphaned-prompt scan — founding incident and the wrong predicate — **READ IT before executing this step** (a reference-file pointer, not the scan-output legend above)

**⛔ POST-COMPACT GATE — do NOT advance past Step 1 while `.claude/state/post-compact-pending-<sid>` exists.** If the marker is present, NAME it in your very next response, then act on it, *before* continuing the wrap:
- `focus=no` (auto-compaction, or a bare `/compact`) → the skip gate does **not** hold. Run `/post-compact`.
- `focus=yes` → **READ `focus_args` AND JUDGE IT. The flag alone does NOT sanction the skip.** It measures only that the `/compact` slot was non-empty, and a shell hook cannot tell a CURATION OF THE CUTOFF (*"keep the billing thread"* — the cutoff was chosen, so a skip is sanctioned) from a DIRECTIVE that happens to be typed in the same slot (an instruction to prepare a follow-up wrap — nothing was curated, so the skip is NOT eligible and you run the recovery). ⛔ **MEASURED 2 OF 2 IN ONE SESSION: both arguments were directives and both produced `focus=yes`.** Both were declined by hand at the gate, so nothing was lost — but declining took judgement the flag was supposed to supply, which is the defect. `compact-save.sh` now emits `focus_args=<the argument>` on the marker line for exactly this read (2026-09-09; before that the argument was invisible and the boolean was all you had). **Name the decision out loud either way, and quote the argument you judged.**
- Either way, the marker must be **cleared** (`rm` it) — it tracks *"recovery decision made"*, not *"brief produced"*. ⛔ **ONE EXCEPTION, AND IT DOES NOT BLOCK THE WRAP: `python3 scripts/post-compact-deferral.py status --sid $CLAUDE_CODE_SESSION_ID` exiting 0 (`DEFERRED`) means Claude Code fired its pre-compaction hook and no compaction has landed (an automatic one fires early under the compact point; a manual /compact can be refused at the session limit), and `/post-compact` Step 1 already deferred it.** The marker stands on purpose, so name it — "pre-compaction hook fired, no compaction landed yet" — and continue past Step 1. Never say a compaction was "prepared": it reads as something the owner did. Exit 1 (`OWED`) is the ordinary case: run `/post-compact`, which itself decides recover-or-defer. Step 11's reconcile reads the same script.

⛔ **AND THE GATE ABOVE CAN RETURN A CLEAR THAT GOES STALE SECONDS LATER — BECAUSE AN AUTO-COMPACTION CAN FIRE *MID-WRAP* AND `compact-save.sh` (PreCompact) WRITES THE MARKER AT THAT MOMENT (measured 2026-08-12; mechanism CORRECTED the same day by two independent reviews).**

> 📁 **Moved, with the copy's edits, to [`references/step0-gate-notes.md`](references/step0-gate-notes.md) § Post-compact gate — the mid-wrap compaction measurement and corrected mechanism** — provenance only.

**Check, still free and still worth it:** re-derive the `[ -f ]` at the END of Step 0 as well as the start — it catches a marker written *during* Step 0, which is exactly the 35 ms window above. And if this turn's SessionStart output carries a POST-COMPACT directive, the gate is not clear whatever `[ -f ]` returned (two instruments, PRESENT wins). The Stop-hook (`exit 2`) graduation named below supersedes both.

> 📁 **Moved, with the copy's edits, to [`references/step0-gate-notes.md`](references/step0-gate-notes.md) § Post-compact gate — why a step, and the enforce layer** — READ IT before executing this step.

Ensures next session's `/orient` sees this session's final state in its peer-summary read. Cost: ~150ms. Skip rule: trivial sessions (<5 messages) MAY skip the write+prune — manifest will be stale-pruned within 24h anyway (but NOT the mail-check — see below).

**Inbound-mail peek (shipped 2026-06-19) — the wrap-time half of the cross-session mail surface.** `mail-check --peek` closes the one window the existing surfaces miss: the `SessionStart` hook auto-surfaces mail waiting at session START, but mail that arrives MID-session (a peer's handoff/correction sent while you were working) has no push — without this you'd only catch it via a manual `/mail check`. The wrap is the natural bounded moment to catch it: you're deliberately winding down, and a handoff mailed to a session about to go quiet shouldn't silently sit (with the typical 2–4 concurrent sessions, mid-session cross-mail is the common case). Load-bearing specifics:
- **`--peek` is non-consuming (NOT a normal read).** It surfaces WITHOUT archiving — a heads-up, not a receipt. So if you choose not to act, the message stays unread and the next live `SessionStart` still properly receives it. A consuming read here would mean "carry it forward" silently loses the message (archived-then-never-acted). The mild re-surface on each of the 2–5× re-wraps is the safe direction (a standing reminder for an un-handled handoff), not a bug.
- **Deliver-and-surface holds.** Surface the advisory block to the owner; NEVER auto-apply code/actions from it (identical discipline to `/mail check` — the whole feature's safety model).
- **Runs even on trivial (<5-msg) sessions** — unlike the manifest write+prune, inbound mail is an EXTERNAL trigger independent of how much THIS session did; a 3-message session can still have a peer's handoff waiting.
> 📁 **Moved, with the copy's edits, to [`references/step0-gate-notes.md`](references/step0-gate-notes.md) § Inbound-mail peek — placement and latency rationale** — provenance only.
- ⛔ **NEVER CAP THE PEEK, AND ENUMERATE SUBJECTS RATHER THAN BODIES.** ⛔ **AND NEVER GREP THE PEEK STREAM FOR A SUMMARY WORD (N=2 — registry 2026-08-27 recorded the identical mechanism uncodified):** the answer is the tool's own header line `(N message(s) for session …)` at line 3 of the peek file; a `grep -m1 'unread'` (lowercase, case-sensitive, against a header that spells UNREAD) matched a mail BODY at line 2454 and *"Nothing owed on this thread"* reached context as the inbox's size (2026-09-03).** `| head -N` on this line turns the backstop into a green-looking step: measured, `--peek 2>&1 | head -8` printed the FIRST message's header out of **86**, and the step reported done. This peek IS the codified structural net for the measured listener-drops-a-message failure (N=2 — two ⛔STOPs sat in two stores with ZERO context records), so a cap here defeats the one net that does not depend on the listener working. `.claude/traps/shell-traps.md` § READ COUNTS, NEVER A PIPED EXIT CODE already bans capping a WORKLIST; nothing connected that ban to this step, and this step's spec did not say uncapped — which is the whole gap. ⛔ **AND THE TOOL'S OWN SUBJECT MODE CANNOT DELIVER THIS — `--summary` IS HARD-CAPPED** (`SUMMARY_TOTAL_CAP`; measured on a live inbox, 381 unread rendered as **3 shown** plus one skimmable *"378 more not shown"* line, i.e. 0.8% coverage) — the green-looking step this bullet exists to prevent, wearing the bullet's blessing. The uncapped path is one command: `grep -h '^subject:' .claude/state/session-mail/<me>__*.md | wc -l` (374 on this seat's store at writing). **Subjects are bounded, bodies are not** — that asymmetry is presumably why capping felt necessary, so enumerate SUBJECTS for everything unread and read bodies only for what you disposition. ⚠️ A partial mitigation was in place BY LUCK the day this was found (a separate after-cutoff subject enumeration happened to catch the one live item); that answers "what arrived recently", never "what is stranded in the store".

> 📁 **Moved, with the copy's edits, to [`references/step0-gate-notes.md`](references/step0-gate-notes.md) § Lifecycle marker — how the WRAPPED stamp works (8-hex key)** — READ IT before executing this step.

**Awaiting-peer wake (cross-session `mail-await`, shipped 2026-06-21).** The `session-wrapped` marker above doubles as a go-signal: a peer blocked on YOUR completion via `mail-await --peer-done <your-sid>` (armed in a Bash `run_in_background` loop) is woken AUTOMATICALLY when you wrap or exit — no action needed here. The one manual case is an *explicit* green-light you give BEFORE wrapping (e.g. "my part is safe, proceed"): `python3 scripts/session-manifest.py mail-send --to <sid8> --signal <tok>`. See `/mail` → "Process — await".

## Step 1 and 1a — /hanging-work and the stale-classification sweep — from `SKILL.md` § Process, lines 134–143

1. Run `/hanging-work` check (uncommitted changes, unstaged files, **defer-triggers-fired scan** — catches defers whose blockers resolved via cross-session commits)
1a. **Stale-classification sweep (stale classification re-verify, mandatory when audit-check ran this session with non-(a) e2e classifications).** For every Check 10 failure classified `(b) flake` or `(c) pre-existing` during this session, the audit-check output recorded (classified-at-commit, surface-files). Sweep:
   - For each classification: `git diff --name-only <classified-at>..HEAD` → does any path match the recorded surface files?
   - If yes: the classification is stale — re-run the test. If now passing, note as closed. If still failing but with a NEW root cause in this session's code, treat as regression (route to `/agent-work` or fix inline, don't close the session with the old label).
   - If no matches for any: sweep passes silently.

   > 📁 **Moved, with the copy's edits, to [`references/step1-evidence.md`](references/step1-evidence.md) § Step 1a — why here** — provenance only.

   **Consumer of:** `/audit-check` Check 10 Step 4a provenance data. If Step 4a wasn't run (old audit-check invocations without provenance), skip the sweep and flag it as a gap for next audit.

## Step 1a-ii — the stranded-fold sweep — from `SKILL.md` § Process, lines 144–161

1a-ii. ⛔ **STRANDED-FOLD SWEEP — INTERSECT THE DIRTY SET WITH *THIS SESSION'S OWN COMMIT FILE-SET*, NEVER READ THE DIRTY SET RAW (2026-09-21).** Step 1's "uncommitted changes, unstaged files" is a WHOLE-TREE read, and on this shared worktree that is 40-plus files of peer work. **A raw dirty list does not fail to report your stranded fold — it BURIES it, and the burial reads as peer noise**, which is precisely the conclusion a careful seat draws. Measured on one audit wave: **FIVE of one session's own folds sat unstaged at wrap time**, including two un-landed must-fold fixes from a review already certified closed, and one that was **live on HEAD as a wrong sentence to real users** (a caller passing a message argument the string did not declare, which is ignored rather than thrown, so a whole family of product pages showed the wrong word). All five were found by accident while cleaning up, not by any check.

   **The instrument — partition by THIS SESSION'S OWN LABELS, never by a commit range — and the narrowing is the whole value.** ⛔ **A seat labels its commits THREE ways and the 8-hex trailer is the minority:** (1) `Claude-Session: <sid8>`, (2) `Claude-Session: <a session URL>` — the harness attribution block, whose URL changes across remote reconnects and is recorded in this session's transcript as `remote_session_change` attachments, and (3) a subject scope that ENDS in the sid, `wrap(<sid8>):` / `meta(learn <sid8>):`. Until 2026-09-29 this block matched (1) alone and its guard fired only on an EMPTY list, so a PARTIAL list passed silently: on one session it found **60 of 186** commits and the 28 Sep checkpoint wrap cleared its sweep on that. The scope in (3) must END in the sid — `fold(<hub> B178 on <sha>)` names a REVIEWER, and the looser form credited two of this seat's folds to the hub — and it is read only when the commit carries NO trailer. **The reader is `scripts/session-labels.py`, ONE copy for this step, Step 7, Step 8a, `/summary`'s fold plane and `/sanity-check`** (it had been copied three times inside this file alone); its docstring carries the measurements — 0 commits claimed by two seats across all 291 transcripts — and its one known limit: a continued-in session inherits its predecessor's LAST remote URL.
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

## Step 1b — the compaction-boundary scan — from `SKILL.md` § Process, lines 162–178

1b. **Compaction-boundary scan (mandatory when compact occurred this session — adopted 2026-05-17 from another project's `/wrap` mandate).** If the session contains a compaction (a record, per Detection below — never a phrase), the post-compact context alone is incomplete signal — most session work likely happened pre-compact, and the harness summary compresses fine-grained signal that `/meta learn` (Step 2) and `/session-memory` (Step 3) need.

   **Detection (≤10 sec):**
   - Count records with the FIELD `"isCompactSummary":true` (or a `compact_boundary` system record) in the current session transcript, never a phrase, which this spec itself puts into the transcript (post-compact/SKILL.md Step 1). Any such record triggers the mandate (measured 2026-10-15: the phrase test raised 2 of 8 false "deep pass skipped" alarms; `scripts/wrap-reconcile.mjs` now keys on the record).
   - Fallback: `grep -c '^## 20' .claude/state/compact-checkpoint-${CLAUDE_CODE_SESSION_ID%%-*}.md` — THIS session's own checkpoint file (compact-save.sh writes one per session since 2026-09-07; for a session whose compactions predate it, count `isCompactSummary":true` records in your own transcript instead). ⛔ NEVER the shared `compact-checkpoint.md` — its mtime and its last block are the whole FLEET's (67 blocks landed in it on 2026-09-07 alone; an mtime test read TRUE for every session).

   **Scan procedure:**
   - Walk back through the session transcript to the prior **`/wrap` invocation** — the last session-CLOSE, the true "everything since here is un-wrapped" boundary. Do NOT anchor on the prior `/meta learn`: it fires INCREMENTALLY mid-session, so in a multi-`/meta learn` session (especially one with many compactions) "back to the prior `/meta learn`" resolves to the most-recent arc and systematically UNDER-scopes. **If no prior `/wrap` is found in this session, scope the ENTIRE session** (session-start → now) — NOT "the most recent commit timestamp" (far too narrow). Detect prior `/wrap` runs by grepping the transcript for the wrap SKILL.md load marker / a `[wrap]`-prefixed assistant turn. **Bias toward OVER-scanning + de-duping** — re-checking an already-codified lesson just de-dupes (cheap); under-scanning loses lessons (expensive). Evidence (2026-06-24): an 18-compaction, 3-day session where the scan anchored on the most recent arc and MISSED a production outage AND two other incident arcs — firing against the same wrap that codified it. This anchor-on-`/wrap`-not-`/meta-learn` fix is session-scope enforce layer.
   - Apply Step 2's `/meta learn` signal-extraction patterns (user pushback, agents launched, defer-with-trigger, LARP markers, novel factual discoveries) across the FULL pre-compact + post-compact window — NOT just post-compact.
   - **Drive the arc-enumeration from `git log --oneline <session-start>..HEAD` (the even, full-session commit list), NOT the in-context summary.** The harness post-compaction summary COMPRESSES pre-compaction arcs to bullets, so a linear scan over-weights the verbatim post-compaction turns — an under-WEIGHTING (distinct from under-SCAN). The git-log lists pre+post-compaction commits EVENLY → iterate each commit/arc as a distinct candidate. Two corollaries the iteration must apply: (a) memefy = STORY-worthiness, NOT lesson-novelty (a big DECISION / REVERSAL / multi-stage-eval is memefy-gold even if already captured as a decision); (b) a captured DECISION can hide an uncaptured METHODOLOGY lesson (outcome-capture ≠ methodology-capture). Evidence: 2026-06-29 — a pre-compaction model-evaluation REVERSAL was anchored-past as "already captured" → missed both its memefy story AND the uncaptured eval-methodology lesson; caught over 2 pushback turns.
   - Same applies to Step 3's `/session-memory` decision-capture: scan pre-compact for decisions worth persisting that the post-compact summary compressed away.
   - Step 4 `/me learn-session` similarly scans the full window for user-preference signals.

   > 📁 **Moved, with the copy's edits, to [`references/step1-evidence.md`](references/step1-evidence.md) § Step 1b — why mandatory, and the companion layers** — provenance only.

   **Skip rule:** if the transcript holds no `isCompactSummary` or `compact_boundary` record AND this session's own checkpoint file is absent or empty, this step is N/A — skip silently (the shared log's mtime is not a signal — see the fallback above).

## Step 1b-DEEP — the deep-pass trigger — from `SKILL.md` § Process, lines 179–220

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
   TX="$HOME/.claude/projects/<project-key>/${CLAUDE_CODE_SESSION_ID}.jsonl"   # <project-key>: this repository's absolute path with every / replaced by -
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
   # tests/transcript-strip-parity.test.ts (not in this copy) runs this block beside both, so run it after any edit here.
   # ⛔ AND BLANK THE HARNESS'S REQUEST COPIES TO A ONE-LINE STUB, NEVER DELETE THEM.
   # Since harness 2.1.300 (first seen 2026-10-14T21:36Z) the harness writes `api-request`, `api-request-blob` and `api-request-shape` records, a copy of each request
   # sent to the model; measured 52-65% of every transcript's bytes from their first appearance (five
   # sessions), so a slice agent spent half its reading on duplicate conversation. A stub keeps every line
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

## Step 1c — the defer-sweep — from `SKILL.md` § Process, lines 221–239

1c. **Defer-sweep (the defer-sweep 3-part test, mandatory when ≥5 defers added this session).** Scaffolding added 2026-04-19 after misses of that test recurred (3× firings in 2 days — codification alone insufficient). Runs the 3-part test over every defer this session added or touched.

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
   Use the first commit of the session as `<session-start-sha>`. If the session added <5 defers total across these 4 files, skip silently — the 5-defer threshold is defer-sweep 3-part test's original trigger and below that the overhead doesn't pay.

   > 📁 **Moved, with the copy's edits, to [`references/conditional-step-bodies.md`](references/conditional-step-bodies.md) § Step 1c — the 3-part test, auto-fix rule and output shape (fires at ≥5 session defers)** — READ IT before executing this step.

   > 📁 **Moved, with the copy's edits, to [`references/step1-evidence.md`](references/step1-evidence.md) § Step 1c — why here, and what it consumes** — READ IT before executing this step.
