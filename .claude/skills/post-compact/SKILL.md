---
name: post-compact
description: Compact recovery brief — augments the system's generic post-compaction continuation summary with umbrella work-subject, detailed last-exchanges, and explicit hand-off state, then brings this session's working plan current. Use after any compaction event (auto or /compact) to rebuild mid-session hand-off state. Writes ONE file (this session's working plan, mandatory) and nothing else — it never acts on the recovered context.
---

# Post-Compact — Compact Recovery

**The core, paid on every compaction.** Why each clause exists (owner quotes, measurements, incidents, history, the caller list) is in [`references/post-compact-detail.md`](references/post-compact-detail.md) (not in this copy), by step. This core wins any disagreement. **Appending:** DIRECTIVE + TELL + the number the action needs here; the why goes to the reference in the SAME commit.

Rebuilds hand-off state after a compaction (re-read path for what the summary drops) — not `/orient`, `/meta learn` or `/wrap` Step 1b. **It writes this session's working plan (Step 6) and nothing else; it never acts on the recovered context.** `session-start.sh` directs it after every compaction; `post-compact-pending-check.sh` re-surfaces the marker until Step 8. **Skip only after an owner-curated `/compact <focus>`; NAME the decision either way.** ⛔ **`focus=yes` IS NOT THAT GATE — judge `focus_args` on the marker line: a DIRECTIVE in the slot ⇒ run the recovery.** TELL: the argument reads as an instruction to you, not a description of what to keep.

### Steps

0. ⛔ **ONE SENTENCE TO THE OWNER — what you are doing, what comes next — THEN Step 1.** ⛔ It is not "other work" the recovery-first rule defers; it is all the owner sees while the recovery runs.

0b. **Run the index — it caches the transcript scan and prints Step 4's owner-speech section:**

   ```bash
   python3 scripts/post-compact-recovery-index.py --plan plans/session-<sid8>-<date>.md
   ```

   ⛔ **ITS `triage` VERDICT IS ADVISORY AND SKIPS NOTHING — RUN STEPS 1-8 IN FULL, ALWAYS**. The LIGHT/FULL gate was demoted; the triage log is the only evidence that could earn it back. ⚠️ Read `legs`, not the verdict; note in the dated block whether Steps 2-4 found anything the plan did not already carry. Before keying a skip on a file's freshness, enumerate who writes it; measure a recency proxy against the END of the interval it vouches for. The cache (`.claude/state/post-compact-index-<sid8>.json`) rebuilds from zero, naming why, on a shrunk transcript, an off-boundary offset or a schema change; every verdict lands in `.claude/logs/post-compact-triage.jsonl` with `owner_window_counts`. ⛔ **Since 2026-10-11 the index asks the deferral rule itself FIRST and stops on DEFERRED (one JSON line, no cache write, no triage row; `--force` overrides), so running it here, before Step 1's `decide`, is safe.**

1. **Find the newest compaction by FIELD (`isCompactSummary: true`), never by phrase** — this spec carries the phrase; ignore any match lacking the field. Type by a `/compact` within ±5 idx: AUTO · EXPLICIT-bare · EXPLICIT-focus. None ⇒ `"No compaction events in this session — /meta post-compact not applicable."`
   ⭐ **THE BANK (index `BANK:` line).** `FRESH` ⇒ every step still runs: ⛔ **Step 4 reports EVERY owner record (`BANKED` = said before the save, not carried by it)**; read `AFTER-BANK` first, write a missing `BANKED` ruling in at Step 6. Step 3 takes the block's subject only at 0 `AFTER-BANK`. Step 5 STARTS from the block's items and CONFIRMS each (key in tree and at HEAD, builder vs dispatch log, loop vs store); its sweeps (dirty files, dispatch log, mail store) stay whole-window; a failed one gets full Step 5, named in the dated block. Else ⇒ as written. Why: reference § Step 1.
   ⛔ **ASK `python3 scripts/post-compact-deferral.py decide --sid $CLAUDE_CODE_SESSION_ID` FIRST, NEVER BY HAND.** **`DEFERRED` (PreCompact fired, no compaction landed) ⇒ say so in one line, ONCE, run NO recovery, DO NOT CLEAR THE MARKER** (the script writes `post-compact-deferred-<sid>`). **`NO-TRANSCRIPT` (exit 1) is not "no compaction" ⇒ run the recovery.** ⛔ **Cut a "since the compaction" window at the summary RECORD's position, never the marker's clock**; never string-compare the marker's and boundary's stamps. TELL: the window holds work you remember doing before it.

2. **Size and STATE the windows:** detailed = last 10 user-anchored exchanges (20 if rapid, 5 if dense); umbrella = 50-300 messages back to the dominant subject, most recent topic only.

3. **Umbrella subject — read it from the working plan's LIVE ITEMS; report only what this window CHANGED** (new item, status flip, decision, open question), citing commits and paths. The plan was stale at ~160 of ~170 windows: it anchors the subject, never replaces Steps 4-5.

4. **Last exchanges — from the index's `OWNER SPEECH IN THE RECOVERY WINDOW` section; never improvise a predicate.** Every owner record since the previous compaction, tagged `pre` (eaten) or `post` (said since). Per exchange: the owner's ask, what was done (assistant records after the owner's `idx`), the last 1-2 verbatim.

   | pop | what | keyed on |
   |---|---|---|
   | (a)(b)(b2) | typed · queued · accepted suggestion | `promptSource` |
   | (c) | queued-command attachment | `origin.kind == "human"` **AND** `commandMode == "prompt"` |
   | (d) | local slash command | `system`/`local_command` PAIR, read by its OUTPUT |
   | (e) | slash command, user record | no `promptSource`, no `isMeta`; STRING content with `<command-name>` (never a `tool_result` list, never `isCompactSummary`); `turnOrigin` not a machine one (`task_notification`, `peer`, `auto_continuation`, `scheduled`); an unseen value counts as the owner and is censused UNRECOGNISED |
   | (f) | answered `AskUserQuestion` | `tool_use_id` LINK (cached; can pre-date the window) **AND** non-empty `toolUseResult.answers` |
   | (g) | REJECTED tool call | `toolDenialKind == "user-rejected"` only — never "rejected" in content; `permission-rule` and `automode-*` are machines |

   - ⛔ **AN ABSENCE CLAIM NEEDS ITS CONTROL:** match the `positive control` line to a message you can cite, and SAY it matched. An unproven zero is a hypothesis.
   - ⛔ **`UNRECOGNISED` IS A NINTH POPULATION — read those records by hand.** Eight is a floor; the script censuses fields rather than testing a closed set. ⛔ The field is `promptSource`; `isQueued` does not exist.
   - ⛔ **(f) CARRIES EVERY FORK DECISION AND ITS ZERO PROVES NOTHING** — its control is the WHOLE-transcript `controls` line. Never key on the tool name or a content string. **Per question:** `the owner chose X` (`(Recommended)` stripped); `FREE TEXT` is THE OWNER'S prose — quote it (a question back is a Step 5 item); `f-none` is silence, never a ruling. Split a multi-select string or list only when every part is an offered label. Never key on `annotations.notes`; quote (f) figures over the ANSWER population.
   - ⛔ **(g) IS A STOP ON THAT CALL — never silence, never a veto of its step.** A dismissed question is (g), never a choice. After `the user said:` quote only the owner's words. A (g) zero excludes sub-agent transcripts — say so.
   - ⛔ **(c) NEEDS BOTH FIELDS** (task notifications share the channel). **(d): report what the OUTPUT says**, never an instruction; `/model` is configuration, not what serves. **`e-machine` lines are NOT the owner.**
   - ⛔ **A MESSAGE OPENING WITH A QUOTE OF MY TEXT IS THE OWNER'S RULING — READ IT FROM THE END.** Report each `QUOTE-RULING` pair as *the owner answered `<answer>` on the item the owner quoted*; the quote is my wording, never the owner's.
   - ⚠️ A cut is announced (`… NOT SHOWN — read record N whole`); read it whole before quoting. A record no row fits ⇒ open `.claude/rules/active-recall.md` row 56 (PARKED, the fuller catalogue). **Script failed ⇒ walk the table by hand with `references/post-compact-detail.md` (not in this copy) § Step 1 and § Step 4 open (the transcript path and the hand-walk guards live only there), and say so.**

5. **Hand-off state** — the owner's last ask, my in-flight work, open questions.
   - ⛔ **A MUTATING NEXT STEP (write, stage, commit, apply, dispatch): ESTABLISH WHETHER IT ALREADY RAN.** (1) its `tool_use` before the boundary + the `tool_result` with that id — no use ⇒ never ran, no result ⇒ go to (2); a dispatch reconciles against launch results and task notifications; (2) `grep -cF '<token>'` in the file AND `git show HEAD:<file>`; (3) `git diff --cached --numstat -- <paths>` (deletions near file length = a truncated stage). Porcelain decides nothing; a timed-out apply may still run, and `MANUAL` is not an all-clear. **State the reading; never act.** TELL: the next step is a state-changing verb.
   - **A `/wrap` in flight ⇒ INVOKE `/deep-pass` and PASTE its brief block, never re-type it.** TELL: `~/.claude/projects/` with no fence beside it.
   - **SWEEP THE MAIL STORE, not the summary:** `.claude/state/session-mail/` for this session as sender (`<peer>__<ts>__<me>.md`) AND recipient (`<me>__<ts>__<peer>.md[.read]`, read or unread — may carry unfolded findings); read each pending one back.
   - **`kill -0 $(cat .claude/state/mail-listen-<sid8>.pid)`**. Dead or missing ⇒ re-arm the Monitor BEFORE continuing (a review hub: with `--rebroadcast-hours 48`, `review-hub/SKILL.md` Phase 1) — ⛔ **UNLESS `.claude/state/session-standby-<sid8>` EXISTS: the owner parked the seat; leave it dead, report STANDBY, and let `/standby resume` re-arm it.** ⛔ **Likewise when `printenv SKIP_MAIL_LISTEN_ARM_REMINDER` prints `1`** (a setup that never runs two sessions at once sets it in the settings `env` block): there is no listener to restore; leave it off and say so in one line. A compaction's start printing no `📡 MAIL-LISTEN` line is not this test: it prints none while the listener is alive too.
   - **A hub's poller and usage watch, whatever the listener reads:** `pgrep -P $PPID -f '[h]ub-stale-request-poll'` empty ⇒ re-arm it (per pre-compact step 1); `'[h]ub-usage-watch'` empty ⇒ `review-hub/SKILL.md` § ⏸ `/review-hub --pause`, step 9; unless standby.
   - ⛔ **`[ -f .claude/state/session-pause-<sid8> ]` ⇒ THE OWNER PAUSED THIS SEAT'S WORK (`/pause`):** dispatch no builder and commit nothing; report the pause and its `resume=` from the marker, and leave the resume to the armed one-shot or the owner's word (`pause/SKILL.md` § While paused).
   - **REVIEW HUB (`[ -f .claude/state/review-hub-active-<sid8> ]`) ⇒ RUN ALL THREE:**

     ```bash
     node scripts/review-request-closure-scan.mjs      # 1. pending QUEUE items  — unanswered request SHAs
     python3 scripts/hub-unfinished-loops.py           # 2. peers AWAITING A REPLY — who holds the last word
     python3 scripts/hub-open-promises.py              # 3. MY OWN PROMISES      — what I said I would do
     ```

     ⛔ **NONE SUBSTITUTES FOR ANOTHER.** ⛔ **CHECK 3 EXISTS BECAUSE 1 AND 2 ARE BLIND to a promise in my own outbound.** Each is a FLOOR worklist: NAME every row, never a count; check 2 excludes broadcasts; all three read the mail plane only.
     ⛔ **`[ -f .claude/state/review-hub-paused-<sid8> ]` ⇒ THE OWNER'S PAUSE HOLDS:** seat nothing new; held requests stay held (`review-hub/SKILL.md` § ⏸ `--pause`).
     Phase 3 of `review-hub/SKILL.md` (steps 1-5, the ledger row rules included) fits inside the carry (a test arm, "Phase 3 ENDS inside the carry", pins it), so no re-read is owed; if that arm is red, `Read` the core from `5. **LOOP-CLOSE` to `### Phase 1` before a verdict or ledger row.
   - ⛔ **A CARRIED CLAIM LOSES ITS CLOCK:** for every "X has not happened yet", re-derive when X would have happened. TELL: a relative-time clause with no date.
   - ⛔ **AN UNATTRIBUTED ITEM INHERITS "MINE" BY FRAMING:** `whose-edit` every dirty file before staging; credit a peer's finding IN the commit that folds it (no TELL fires: adopting is not attributing).

6. **UPDATE THE WORKING PLAN — MANDATORY, every run.** ⛔ **NEVER MAKE IT CONDITIONAL** — that puts a judgment at the moment recall is worst.

   ```bash
   node scripts/summary-plan-sync.mjs        # CURRENT | UPDATED | NO-PLAN — owns the derived fence
   ```

   Then the prose delta by hand: corrections REPLACE; rows edited in place, never deleted; closure is a dated flip; a stale closability verdict is SUPERSEDED by a dated block. `NO-PLAN` ⇒ say so, write nothing. ⛔ **A panel in flight: *"panel in flight, host position committed at <sha>"*, never the position.**
   - ⛔ **WRITE OUTSIDE THE `SUMMARY-SYNC` FENCE** (`BEGIN`..`END` is overwritten): locate BOTH markers — the BEGIN line STARTS `<!-- SUMMARY-SYNC:BEGIN` (the whole line is the `BEGIN` constant in `scripts/summary-plan-sync.mjs`; restore a lost one by copying it from there, never by retyping, since the sync refuses any other form) and the END line is exactly `<!-- SUMMARY-SYNC:END -->` (`grep -n '^<!-- SUMMARY-SYNC:' <plan>` prints exactly those two with their line numbers; an unanchored grep also prints plan prose about the fence; never quote either marker whole in the plan, because the sync counts every occurrence and refuses a second) — and confirm your insertion point is above the first or below the second. ⛔ **The heading diff cannot catch a misplaced block** — it reads `>` now and is destroyed at the NEXT sync, blamed on another seat; only this hand check sees it.
   - ⛔ **WRITE ONLY WHAT THIS RECOVERY DERIVED**; untouched hand sections stay byte-identical.
   - ⭐ **THEN DIFF THE HEADING SET** — catches DESTRUCTION, blind to FABRICATION; say which you rely on:

     ```bash
     diff <(git show HEAD:<plan> | grep '^#\+ ') <(grep '^#\+ ' <plan>)
     ```

     `>` = added; **`<` = DESTROYED**; `<`+`>` = a rename. ⛔ **FIRST `git ls-files --error-unmatch <plan>`:** untracked ⇒ the diff is vacuous in the PASS direction: say the check could not run and the plan is unprotected; its commit is `/wrap` Step 8's or the next ordinary commit's, never this command's. Same for every `??` part `git status --short -- '<plan stem>-part*.md'` lists (quoted: zsh aborts an unmatched glob).
   - ⭐ **Class rule (with `/working-plan`, `/summary`):** write THIS SESSION'S plan and nothing else — no commit, mail, tracker or memory write. Read-only language here governs the RECOVERED CONTEXT, never the plan file.

7. **Output the brief** ([`report-formats.md`](../meta/references/report-formats.md) § Postmortem). The reply opens with ONE plain sentence ("Nothing was lost." / "One thing was lost: …"); Steps 1, 2 and 6's readings go in the plan's dated block, not the reply. Counts are written as digits. **Never act on the recovered context; no new `/wrap` before his next message.**

   ⭐ **7b. CLOSE THE TURN WITH `/summary`'s FOUR SECTIONS — MANDATORY** (rules by pointer: `.claude/skills/summary/SKILL.md` §2, the closing split, § The plan table): **Needs you** (what · why the owner · if the owner says nothing · **my recommendation**; this-seat only, fleet items on `Next — fleet`) · **Next — you** (numbered, with preconditions) · **Next — me** · **Plan (table)** composed in the reply from Step 6's plan, never a file pointer.
   - ⛔ **IT BINDS THE TURN, NOT THE BRIEF** — still last after any further work.
   - ⛔ **AN EMPTY SIDE IS A CLAUSE, NEVER AN EMPTY HEADING.**
   - ⚠️ Derive every line from the plan, tracker or mail store, never the summary's narrative.
   - ⛔ **DERIVE OVER THE WHOLE PLAN:** `grep -nE '^#+ ' <plan>`, then read blocks by anchor with `offset`/`limit` (`Read` caps at 262,144 B); `Next — me` = tracker rows ∪ plan queue rows. Not enumerated ⇒ a WINDOW claim naming the blocks read.

8. **Clear the pending marker:** `date -u +%FT%TZ > .claude/state/post-compact-cleared-$CLAUDE_CODE_SESSION_ID && rm .claude/state/post-compact-pending-$CLAUDE_CODE_SESSION_ID`. ⛔ **Re-read the marker first: changed since Step 1 ⇒ a NEW compaction began — leave it.** ⛔ **NOT after `DEFERRED`.** A named skip clears it too.
   ⛔ **The `cleared` breadcrumb keeps `/wrap` Step 0's gate non-vacuous: keep the `rm` and the additive write, never a `mv`.**

### Anti-scope

Additive to the system summary · no lesson extraction · once per compaction event. **Revisit** after 3 "this didn't help"; well-calibrated if it drives continued work once per 5 sessions.
