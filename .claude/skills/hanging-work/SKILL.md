---
name: hanging-work
description: Quick end-of-session audit to catch anything left undone. Use before /wrap when unsure if open threads (deferrals, half-finished fixes, missing tests) are still hanging.
---

# Hanging Work Check

Quick end-of-session audit to catch anything left undone.

## When to Use

Run at the end of a work session, or when the user asks "is there anything hanging?"

## Checklist

Check each of these and report only items that need action:

1. **Unpushed commits** — Run **`git fetch origin`** and THEN `git log --oneline origin/dev..HEAD` (unpushed — sessions commit on `dev`; `origin/main..HEAD` is the unpromoted queue, a different question). ⛔ **The fetch is load-bearing: `origin/dev` and `origin/main` are LOCAL refs that nothing refreshes**, so the count is taken against whatever the last fetch/push left behind — measured five days stale on this repo (2026-08-16), which inflates the number by every commit that already shipped and reads exactly like a long unpushed queue. A fresh command over a stale ref is still a stale answer.
2. **Uncommitted changes** — Run `git status` to check for staged/unstaged changes
3. **Failing tests** — Run `npx vitest run 2>&1 | tail -3` to verify unit tests pass
4. **Changed-scope e2e** — If this session touched `tests/e2e/**`, `src/app/**`, or `src/components/**`, run `./scripts/run-changed-e2e.sh <base>` YOURSELF and report its `N passed` line — do not hand it to the owner. `<base>` is the parent of this session's FIRST commit: the bare default diffs `origin/main...HEAD`, which skips everything already pushed and sweeps in every peer's unpushed commit. Commit first — a clean-HEAD run cannot see uncommitted work. `→ no changed files vs <base> — skipping` and `→ 0 specs selected vs <base> (…) — skipping` are valid results (the script's own strings, `scripts/run-changed-e2e.sh`): report them verbatim. A red confined to auth or login steps: check `lsof -iTCP:54321` for another session's run before diagnosing — `scripts/e2e-local.sh` binds its mock auth service to that fixed port. ⛔ Run it at a CLEAN HEAD in a detached worktree with a hard-linked `node_modules` (`.claude/rules/tests-e2e.md` § RUN E2E AT A CLEAN HEAD): in the shared tree under peer WIP the run is VOID (it compiles every peer's uncommitted error and ends with no `N passed` line). Hand it over only if that route is blocked, and say what blocked it.
5. **Type errors** — Run `L=$(mktemp); npx tsc --noEmit --pretty false --incremental false > "$L" 2>&1; echo "tsc rc=$?"; grep -c "error TS" "$L"` for type check. Read the rc beside the count: rc 0 is the clean verdict, and a non-zero rc with a count of 0 means tsc never type-checked (crash, OOM, unresolved `npx`) — open `$L`, never report it as clean. Both flags are load-bearing: pretty output can put colour codes between `error` and `TS`, and the incremental cache can answer from a stale build, and either one alone reads a false 0 (`.claude/traps/shell-traps.md`, the `tsc` entry). *(This line carried the bare form until 2026-09-25; it was run as written and had to be re-run with the flags.)*
6. **Locale sync** — Check if en.json has keys missing from other locales
7. **Task list** — Check for any in_progress tasks that weren't completed
8. **Memory updates** — Check if any flow tracker or memory files need updating based on work done
9. **CI verdict — DERIVE it, do not "note" it (upgraded 2026-08-10).** This check used to say *note if CI needs verification*, which was adequate while CI was a backstop. It is not any more: the pre-push gate defers **integration and e2e** to CI, so for those two tiers CI is the ONLY run that happens, and it lands AFTER the deploy is live. An unread CI verdict is now an unread regression report on production. For every SHA pushed this session:
    ```bash
    gh run list --limit 20 --json databaseId,headSha,name,status,conclusion \
      -q '.[] | select(.headSha=="<SHA>") | "\(.status)\t\(.conclusion)\t\(.name)\t\(.databaseId)"'
    ```
    `in_progress` ⇒ HANGING (say which run id, and hand it to a peer or the owner if this session is closing). Any non-`success` conclusion ⇒ HANGING unless it already carries a disposition (folded / `todo.txt` row / named reject). **Read PER JOB** — `gh run view <id> --json jobs` — because a `continue-on-error` job is red *inside* an overall-success run, which is exactly how a red tier reads as green.
10. **Todo.txt** — Check if any items were added during the session that the user should know about
11. **Stale info sweep** — If significant changes were made this session (new migrations, pricing changes, dimension changes, test count jumps, prompt version bumps), spot-check `todo.txt` engineering notes and `.agents/product-marketing-context.md` for numbers that may now be wrong. Investigate each flagged number ≤2 min: false alarm → close it; ≤5-LOC correction → apply inline; bigger → defer with a concrete trigger. Never flag-only.
12. **Defer-triggers-fired scan (2026-04-21)** — catches cross-session blocker resolution that a check limited to `/agent-work` aftermath misses. Grep `todo.txt` for open rows with a prose `Blocked on {X}` / `Revisit trigger: after {X}` / `Ship-now slice` clause and cross-reference {X} against the last-48h `git log --oneline --name-only`. Flag each hit as "trigger may have fired — candidate for promotion" and surface to user. Evidence (2026-04-21): a deferred row's blocker (another work arc's `/agent-work` commits) resolved mid-session; caught by luck (recent `git status` in context), not by process. Cost: ~10 sec. False positives on generic keywords ("launch", "data") are acceptable — user reviews the flagged set.

    ⛔ **THE FILTER AND THE EXTRACTOR MUST SHARE ONE LITERAL SET, AND AN UNPARSED ROW MUST BE LOUD — the shell shipped here from 2026-04-21 until 2026-09-06 failed BOTH and the failure was a silent under-report.** The outer filter matched three literals; the second-stage extractor looked for two, so a row matched via `Ship-now slice` — or via a hyphenated `BLOCKED-ON` the space-form filter never saw — produced an empty `$trigger` and hit a bare `continue`. **Measured 2026-09-06 on this tree: 6 of 19 rows parsed, 13 dropped with no output, and the check printed a clean `0` possible fires.** The repaired form below parses **23 of 27** (the filter itself widens on the hyphen variant), prints the residual 4 as `UNPARSED` rather than swallowing them, and surfaces **3** candidates — one of them a row whose own first line reads *"BLOCKED-ON IS DEAD, TRIGGER IS DUE"*, invisible to every prior run of this check. The `[ -z "$trigger" ] && continue` is the whole defect: `bash-environment.md` § WRITE A GATE SO INSTRUMENT FAILURE LANDS ON THE FAILING SIDE — treat empty as *instrument broke*, never as *nothing to report*.

    ⛔ **AND DO NOT "SIMPLIFY" THIS INTO A CALL TO `scripts/defer-trigger-scan.py` — MEASURED WRONG 2026-09-06, and it is the obvious move.** That scanner is a genuinely better instrument for its OWN population and it is already wired into `/wrap` Step 7h and `/triggers`, which is exactly what makes the swap look free. **It keys on STRUCTURED fields — `trigger <kind>:`, `blocked-on:`, `done-when:` — and greps zero for the phrase `blocked on`.** The two populations are disjoint in the direction that matters: 271 rows carry a structured `blocked-on:` and 7 carry a `trigger <kind>:`, against the 27 PROSE-clause rows this check exists for. A swap replaces the coverage rather than repairing it, and the resulting green says nothing about the rows that were being dropped. *(This was once proposed as a −19-line simplification and accepted before the populations were compared; the comparison is one grep and it refuted the premise.)*

    ```bash
    # Enumerate last-48h commit touches (files + messages)
    recent_log=$(git log --since="48 hours ago" --all --oneline --name-only 2>/dev/null)
    # TWO STAGES, and the row-anchor MUST come first: it keeps every variable-width
    # quantifier out of the shape `.claude/hooks/grep-blowup-warn.sh` blocks outright.
    # -i is load-bearing (measured 2026-08-15): the corpus writes the blocker as
    # "Blocked on" 8 / "blocked on" 4 / "BLOCKED ON" 1 on open rows, so the
    # case-sensitive form dropped 5 of 13 silently, toward a clean-looking zero.
    # The literal set below is IDENTICAL in both stages — that identity is the fix.
    LITS='Blocked[ -]on|Revisit trigger: after|Ship-now slice'
    grep -nE "^- \[ \]" todo.txt | grep -iE "$LITS" | while IFS= read -r line; do
      trigger=$(echo "$line" | grep -oiE "($LITS)[:]? [^.,]+" | head -1 \
                | sed -E "s/^($LITS)[:]? //i" | tr -s ' \t' '  ' | sed 's/^ //' | cut -d' ' -f1-3 | sed 's/[[:space:]]*$//')  # first three words; cut, not awk
      if [ -z "$trigger" ]; then
        # LOUD, never a silent `continue` — the filter matched, so this row is a
        # use-vs-mention case (a row DISCUSSING the clause) or a literal the
        # extractor cannot reach. Either way the operator decides, not the shell.
        echo "⚠️  UNPARSED — filter matched, no trigger extracted: $(echo "$line" | cut -c1-160)"
        continue
      fi
      if echo "$recent_log" | grep -qi "$trigger"; then
        echo "⚠️  Possible trigger fire: $(echo "$line" | cut -c1-160)"
        echo "   Matched against recent commit log keyword: '$trigger'"
      fi
    done
    ```
    ⚠️ **The `cut -c1-160` caps the DISPLAY, never the item set — every matched row still prints one line.** `bash-environment.md`'s never-cap-a-worklist rule governs dropping ITEMS; here the row NAME sits at the front of the line and the operator reads the row by range afterwards, which is the codified way to read one anyway. Uncapped, this check emitted **41 KB** for 7 items, because a single `todo.txt` row's first line runs to thousands of characters.

    ⚠️ **Read the KEYWORD beside each hit — extraction takes the first three words after the literal, so a prose clause yields a weak key** (`IS DEAD`, `ROUTING`). The value here is the SURFACED SET, not the precision; the FP posture above is what makes that acceptable, and a weak key is not a reason to re-tighten the regex.

    Skip rule: if `todo.txt` has zero open `Blocked on` / `Blocked-on` / `Revisit trigger: after` / `Ship-now slice` clauses, report clean + move on.

13. **Review-verdict disposition sweep (the EPHEMERAL-plane eye, 2026-07-11).** Checks 1-12 all scan the DURABLE plane (git, `todo.txt`, trackers). A cross-session `--code` VERDICT lives on the EPHEMERAL mail plane — TTL-pruned, archived-on-read (`*.md.read`), git-IGNORED — so its recommended-but-un-dispositioned findings have exactly ONE bridge to the durable plane: orchestrator memory at the read moment (recall it before writing; possession≠application). When a session pivots mid-arc that memory scrolls/compacts out and the follow-up strands. Perversely the hub-reviewed session (the one that CORRECTLY delegates its `--code`) is the MOST exposed: the review's existence satisfies `/wrap` Step 5e while its findings sit on a plane the net never reads. Evidence: two recommended folds from one verdict landed only via a manual double-check, never the net — and the same slippage class was caught by hand ~3× in 2 days. Run:
    ```bash
    node scripts/review-verdict-disposition-scan.mjs   # reads CLAUDE_CODE_SESSION_ID; --sid <sid8> to scope
    ```
    **SENT-SIDE ARM (added 2026-08-03).** The paragraph above is the RECEIVER
    half — `scan()` hard-filters on mail addressed TO this session. The SENDER half had no net
    at all: a `--code` request mailed to a hub that then exits, crashes, or never reaches it
    leaves the delegated work UNREVIEWED while the session wraps believing it delegated —
    worse than not delegating, because the delegation itself satisfies "did you get it
    reviewed?". Measured 2026-08-03: a hub sat on 16 unread mails including a live `--code`
    request, which moved only on a manual nudge. The scan now also enumerates review
    requests THIS session SENT and flags any with no reply from that recipient
    (🔴 AWAITING), telling you to confirm the reviewer is alive or take the review back.
    **Two asymmetric signals, and the asymmetry is the point:** a `.read` suffix on your sent
    file CERTIFIES pickup when PRESENT and proves NOTHING when absent (a peer working from the
    surface-only listener reads without marking); and a reply is `answered-strong` only when it
    carries the same review-id — `answered-weak` is engagement, explicitly not a pass. Neither
    certifies the work was HANDLED, so this arm SURFACES like the rest of Check 13 and never
    declares a loop closed. The clean-pass line prints the SCANNED COUNT ("N request(s) sent,
    0 awaiting") so a true clean is distinguishable from an arm that enumerated nothing.
    Deterministic (zero-LLM): it enumerates every surviving review-plane mail addressed to THIS session (typed `signal: deploy-*` frontmatter + verdict-shaped subjects), lists each verdict's finding tokens, and prints a disposition HINT (does the review-id appear in a recent commit and/or `todo.txt`?). It does NOT auto-resolve finding↔commit mapping (fuzzy — accepted-FP posture like Check 12) — it SURFACES 🔴 verdicts with NO durable trace for the orchestrator to CITE a disposition per finding (folded `<sha>` / `todo.txt` row / named-reject) before close. `--self-test` covers the classifier. Known hole it documents itself: the read-TTL can prune a verdict's drop file mid-session; the script cross-refs `mail-events.jsonl` and surfaces "N pruned hub mails — disposition from transcript" (the companion TTL bump in `session-manifest.py` keeps `signal:`-bearing mails the full 72h to shrink this). Skip rule: no review-plane mail to this session → one-line clean pass.

    ⛔ **A TRACE-RED IS NOT NOISE UNTIL YOU CHECK THE ARC'S SIBLINGS — the discriminator is a citation COUNT and it takes one command (2026-08-12).** The scan documents a safe-direction false-🔴 for a clean APPROVED verdict, and that reading is available for EVERY red, which makes "tooling noise" the comfortable call. It was wrong here: a red was written off in a `/wrap` summary as *"a false RED, not an open item"*. **Compare the flagged sha's citation count against the other commits in its own arc** — `git log --all --format='%B' | grep -cF '<sha>'` per member. ⚠️ **Bodies only: a `%H%n%B` format SELF-MATCHES the commit's own hash, so a short sha "cites" itself and returns a phantom 1** (measured — it nearly closed the investigation). Result: the five arc members were cited 3, **0**, 5, 3 and 1 times, against a strong repo convention — remeasured at a 43-57% COMMIT-level citation rate (my original "597/848" counted matching LINES across bodies, not commits: units-mixed, inflated in the flattering direction). One member at zero inside a well-followed convention is a REAL gap. Behind it sat a genuinely unguarded change (`preventScroll`, whose file had since moved directories); the sibling arm asserted focus MOVES, which a bare `focus()` also satisfies, so it could never have caught the regression. **Never add the token cosmetically — do the work the red points at and the citation lands on the durable plane as a side effect**, which is this check's entire purpose. The fix shipped with a guard and a mutation proof.

14. **The row that SENT you (2026-08-16).** Checks 12-13 sweep rows OTHER work may have unblocked. This one is narrower and fires every time: **when you close a batch of tracker rows at the end of a work unit, name the row that DISPATCHED the work and check its checkbox FIRST.** The rows you remember to close are the ones you were finishing; the dispatching row stops being a tracker item the moment it becomes the task, so it is the one that stays `- [ ]` after the work it asked for has shipped.
    - **Measured N=2 in one day, both caught by a direct question rather than by any net** — the pattern is closing rows for the work being finished and missing the row that sent you. One instance had the work committed and the originating row left open for hours; asking whether the addressed tracker and trigger entries had been updated found a real gap **both** times it was asked.
    - **Search, don't recall:** for every subject you shipped this session, grep the launch list and the backlog for it — `grep -n -i -F '<the product noun you shipped>' LAUNCH.md BACKLOG.md` — and read every OPEN hit, including obligations written INSIDE an entry ("on ship, re-add X"). A hit's own line carries no state — resolve it to its entry (`BACKLOG.md` has two forms, `### N.` and `- **#N `; `LAUNCH.md`'s worklist items are table rows whose first cell carries the status) and read the status there. Grep the feature noun AND the route or surface separately: a shorthand for the feature can miss a backlog entry written under the feature's full name, which only the full name reaches. Recall answers "no row" whenever the work was asked for directly. Measured 2026-09-25: a public sample of a paid feature shipped while its backlog entry, its launch-list item and that entry's own obligation to re-add a check stayed open ~11 h, caught by a later transcript scan, while a sibling pair was caught by luck of recency.
    - **Check:** before closing the batch, answer "which row put me on this?" and read its checkbox. If the answer is "no row — the owner asked directly", say so only after the grep above returned no open hit; if a row exists, it closes with the batch or you name why it stays open.
    - **Why it evades Check 12:** that scan looks for rows whose BLOCKER resolved elsewhere. This row has no blocker — it is simply done and unflipped, which no trigger-scan is looking for.

## Output Format

```
## Session Status

**Clean:** (or list of items needing action)

- [ ] Item 1
- [ ] Item 2

**Commits this session:** N commits (pushed/unpushed)
**Tests:** N passing
**Flows completed:** list
```

Keep it short. Only list items that actually need action.
