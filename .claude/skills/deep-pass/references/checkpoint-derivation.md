# Deep-pass — the checkpoint derivation, annotated

**READ THIS BEFORE EDITING ANY FILTER of the derivation block in `../SKILL.md`.** The core carries the code with one-line notes; this file is the same block as it stood (2026-10-25), with the copy's edits, and with every comment that records why each filter exists, the measurement that put it there, and the retired forms (an `isMeta` filter, a whole-record literal test, a line or byte threshold, an operator-supplied turn-start line) that each closed a wrong CP. **Where this file and the core disagree, the core wins** — the core's code is what runs; update this annotated copy in the same commit as any change to it. The surrounding prose (why the slice set is scoped, the `$TXT` rules, the plan line) is in [`deep-pass-detail.md`](deep-pass-detail.md).

   ⛔ **SCOPE THE SLICE SET TO WHAT IS NEW SINCE THE LAST WRAP — THIS SPEC SLICED THE WHOLE TRANSCRIPT EVERY TIME UNTIL 2026-09-02, SO A RE-WRAPPED SESSION RE-SCANNED TERRITORY IT HAD ALREADY SCANNED, ONCE PER WRAP.** Run from the last checkpoint. A long session wraps 2-5× (this spec documents that pattern elsewhere), and every prior wrap already deep-passed everything before it — so re-slicing from line 1 pays the full agent cost to re-derive findings that are already in the ledger, and the DEDUP brief then spends the agents' budget discarding them.
   ```bash
   # Last PRIOR /wrap in THIS transcript; 1 if none (a first wrap scans everything).
   # ⛔ DERIVE IT — DO NOT ASK THE OPERATOR FOR A TURN-START LINE. This block read
   # `TURN_START=<transcript line count at the START of this turn>` until 2026-09-05 and the
   # operator got it wrong TWICE ON CONSECUTIVE WRAPS of one session: 02:0xZ selected line 18948
   # for a 0.24 MB window against a 42.1 MB transcript, and the next wrap selected 23688 for
   # 0.21 MB against a true 9.79 MB. Both were caught by a later size check, i.e. the
   # BACKSTOP worked every time and the PRIMARY method worked never. A fixed lookback does not
   # fix it either (a 200-line window still matched — the spec injection plus the command put
   # SIX markers inside one turn).
   # THE DISCRIMINATOR NEEDS NO CLOCK AND NO OPERATOR INPUT: a PRIOR wrap always has a genuine
   # typed user prompt after it; THIS turn's markers never do, because the turn is still running.
   python3 - "$TXT" <<'CPPY'
   import json, re, sys
   lines = open(sys.argv[1], encoding='utf-8', errors='replace').readlines()
   def rec(l):
       try: return json.loads(l)
       except Exception: return {}
   # a marker inside a compaction SUMMARY is prose about a wrap, not an invocation
   # ⛔ `type == 'user'` IS LOAD-BEARING AND THE `isCompactSummary` EXCLUSION ALONE IS NOT
   # ENOUGH. A marker appears in ASSISTANT records and ATTACHMENTS too — a bash probe, a
   # `git show` of this spec, a skill-spec injection — so without the type test the derivation
   # matches text ABOUT /wrap as readily as an invocation of it, and picks the WRONG boundary.
   # POPULATIONS, measured on two transcripts: this seat 38 markers = 16 user / 15 assistant /
   # 7 attachment; a second transcript 29 markers, 18 of them mentions. Landing on a `user` record
   # without the test is luck in both.
   # ⚠️ THE EVIDENCE IS NOT WHERE YOU WOULD LOOK FOR IT. Adding this clause changed NOTHING on
   # this seat's CURRENT draw — both forms return the same CP, and the record was already
   # `user`. Stopping there would have reported the fix as unnecessary. The confirmation is the
   # EARLIER CP from the same session: it selected line 24680, `type=attachment`, and the author
   # noted the type in passing and rationalised it as "a queued-command attachment, i.e. a
   # genuine invocation". It is a mention. The second transcript reproduced the same selection
   # error twice (`attachment` then `assistant`), so the clause is confirmed on that
   # data twice and on this seat's history once, while being neutral on the current draw.
   # ⛔ AND ONE THING THAT LOOKS TRUE AND IS NOT: the overshoot does NOT compound. It was first
   # reported that each wrap's probe writes the marker so the next wrap lands further past the
   # boundary, unbounded — then measured and RETRACTED: 9,166 lines then 244, i.e. it SHRANK.
   # The magnitude is set by where the nearest mention happens to fall, not by accumulated probe
   # text. Single-hop selection error, reproducible, magnitude unpredictable. (A review verdict on
   # the earlier commit that made the wrap window derive itself, and that verdict's own
   # retraction, both 2026-09-05.)
   def is_tool_result(r):
       c = (r.get('message') or {}).get('content')
       return isinstance(c, list) and any(
           isinstance(b, dict) and b.get('type') == 'tool_result' for b in c)
   # ⛔ THE type=='user' TEST IS NECESSARY AND NOT SUFFICIENT — A TOOL_RESULT IS ALSO
   # type=='user', so a bash probe or `git show` that PRINTS this marker is counted as an
   # invocation. Measured 2026-09-05 on this seat: 10 true invocations and 10 tool_result
   # MENTIONS, i.e. the un-excluded form is wrong exactly half the time and its tail landed
   # on a mention — CP 26221 (a 1.45 MB window, 1 slice) against a true 23688 (7.15 MB,
   # 4 slices), an 80% under-scan reported as a completed deep pass. This is the THIRD link
   # in one correction chain: the original operator-supplied line, the type-test fix (a
   # CHANGES-REQUESTED review, fold-verified PASS), and this. A fold-verify
   # that PASSES certifies the fix landed, never that it is sufficient.
   # ⛔ KEEP `isMeta` RECORDS AND COLLAPSE ADJACENT PAIRS — DO NOT FILTER `isMeta` OUT.
   # A TYPED /wrap emits TWO records one line apart (the command, then the spec injection),
   # so the pair collapses to its first and nothing is lost. A SKILL-TOOL /wrap emits NO
   # command record at all — `.claude/traps/shell-traps.md`'s "A `<command-name>` GREP UNDER-MATCHES"
   # entry says so — so its injection is the ONLY trace it leaves, it arrives LONE, and it must
   # SURVIVE. Filtering `isMeta` deletes exactly that marker and the invocation becomes an
   # invisible checkpoint: CP falls back to the previous TYPED wrap and the window over-scans
   # by a full interval. Skill-tool invocations are 180 of 649 logged wraps (28%), so this
   # is not an edge case.
   # ⛔ AND THE COLLAPSE CANNOT REACH A *LONE* FOREIGN INJECTION — THIS SPEC IS ITSELF A
   # FALSE-MARKER SOURCE, AND IT CARRIES THE LITERAL TWICE WHERE `wrap/SKILL.md` CARRIES IT
   # ONCE. Invoking `/deep-pass` mid-wrap injects THIS file, whose derivation block quotes
   # `<command-name>/wrap` verbatim three lines below; that record is `type:"user"`,
   # `isMeta:true`, no `tool_result`, and sits NOWHERE NEAR a command record — so every filter
   # above passes it and the adjacent-pair collapse, which merges markers Δline=1, cannot see
   # it. Measured live 2026-09-13 in a second wrap: markers
   # `[12257, 12975, 18066, 18146, 18380, 20537]`, of which **12975 and 18380 are THIS spec's
   # own injections**; the derivation returned **CP=18380** against a hand-derived **18146**.
   # The under-scan was 234 lines that time and the magnitude is set by wherever the injection
   # happens to fall, so it is unbounded in principle, not small by nature.
   # ⚠️ The `isMeta`-keep rule above is still RIGHT — do not "fix" this by filtering `isMeta`,
   # which would delete the lone SKILL-TOOL `/wrap` marker (28% of invocations). The
   # discriminator is WHOSE spec the injection is: a skill-body injection is `isMeta` and names
   # its own base directory at the very start of its content, so keep an `isMeta` record only
   # when THAT header, opening a `text` or `content` string and ended by the `\n` after it,
   # names `wrap` (any text block qualifies, not only the first; all 643 measured sit first).
   # An `isMeta` record whose header cannot be read is EXCLUDED, never kept: exclusion can only
   # over-scan (the cheap direction), while keeping it pulls CUR toward the end and collapses the
   # window with the pass still reported complete.
   # ⛔ Two earlier forms failed. The first asked whether the WHOLE RECORD contained
   # `/.claude/skills/wrap`; this function's own body carried that literal, so every injection
   # of this spec written after it passed its own exclusion (one session's wrap, 2026-09-14: raw
   # [2455, 2456, 2543], 2543 this spec's injection, CUR 2543 and CP 2455 = that run's own /wrap,
   # `CP < CUR` passing). The second took the name from the first match anywhere in the record
   # and returned not-foreign when nothing matched, so an unreadable header reproduced that exact
   # collapse and a name such as `wrap.v2` read as `wrap`.
   BASE_DIR = re.compile(r'"(?:text|content)":"Base directory for this skill: [^"\\]*?/\.claude/skills/([A-Za-z0-9_-]+)(?=\\n|")')
   def foreign_spec(l):
       return bool(rec(l).get('isMeta')) and not wrap_injection(l)
   # ⛔ A WRAP INJECTION IS A MARKER EVEN WITHOUT THE LITERAL (2026-09-28). The
   # wrap spec stopped quoting `<command-name>/wrap` when this derivation moved here, so a
   # Skill-tool /wrap leaves NO literal-bearing record at all, and `marks[:-1]` below then drops
   # the PREVIOUS wrap instead of this one while CP<CUR still passes. Measured: CP 2270 against a
   # true 12776 (the 26 Sep checkpoint), a 10,506-line over-scan reported as a scoped pass. With
   # this arm: raw [2270, 2271, 12776, 12777, 32494] collapses to [2270, 12776, 32494], CP 12776.
   # ⛔ AND A SKILL-TOOL /wrap OF AN ALREADY-LOADED SPEC INJECTS NO BODY: the
   # harness writes ONE `isMeta` string record, `Skill /wrap is already loaded above; instructions
   # unchanged.`, after the `Launching skill: wrap` tool_result, with no header and no literal, so
   # the header arm misses it and `foreign_spec` excluded it. Over 265 transcripts it is 3 of 565
   # invocations (3 of the 173 Skill-tool ones; the other 170 carry a body), each a third-or-later
   # wrap of its session, and on the two where it was the LAST wrap CP was one interval early. It
   # matches only the decoded content's START, so a spec quoting the sentence cannot. With both
   # arms, 565 of 565 invocations map to one marker each and no marker maps to none.
   WRAP_LOADED = 'Skill /wrap is already loaded above'
   def wrap_injection(l):
       r = rec(l)
       if not r.get('isMeta'):
           return False
       m = BASE_DIR.search(l)
       c = (r.get('message') or {}).get('content')
       return bool(m and m.group(1) == 'wrap') or (isinstance(c, str) and c.startswith(WRAP_LOADED))
   raw = [i for i, l in enumerate(lines, 1)
          if ('<command-name>/wrap' in l or wrap_injection(l))
          and rec(l).get('type') == 'user'
          and not rec(l).get('isCompactSummary')
          and not is_tool_result(rec(l))
          and not foreign_spec(l)]
   marks = [m for k, m in enumerate(raw) if k == 0 or m != raw[k-1] + 1]
   # Controls, each naming the form it measured. 2026-09-13, on the transcript that produced the
   # clause above: with no `foreign_spec`, raw held 10 markers and collapsed to 6, CP=18380
   # (wrong); with the first earlier form, 8 collapsing to `[12257, 18066, 18146, 20537]`, CP=18146,
   # the hand-derived truth. That green was taken on injections written BEFORE that form, so it
   # could not see that form read its own body. 2026-09-14, that session's frozen copy: the
   # first earlier form printed CP 2455 / CUR 2543, the second and this one CP 1 / CUR
   # 2455. With that copy's line 2543 header moved to a plugin-cache path, the second printed
   # CP 2455 / CUR 2543 again and this form CP 1 / CUR 2455. Over 13 frozen wrap transcripts
   # this form and the second print identical CP and CUR on all 13. Predicate arms: a typed
   # `/wrap` and its skill-body twin are kept; a `wrap.v2` header, a plugin-cache header and a
   # wrap header quoted mid-record are excluded (all three kept by the second form). Live arm,
   # 2026-09-14, that session's second wrap: the first real injection of THIS text (stripped line
   # 4715) read foreign, that wrap's own skill-body twin (4656) was kept, and the block printed
   # CP 2455 / CUR 4655 — both checked by hand against the two typed `/wrap` command records.
   typed = [i for i, l in enumerate(lines, 1)
            if '"type":"user"' in l and rec(l).get('promptSource') in ('typed', 'queued', 'suggestion_accepted')]
   # ⛔ DROP THE LAST MARKER UNCONDITIONALLY — IT IS *THIS* RUN, AND THE typed-PROMPT FILTER
   # DOES NOT EXCLUDE IT (measured live 2026-09-07 in this very step). The filter's whole
   # job is "a PRIOR wrap always has a genuine typed prompt after it; THIS turn's marker never
   # does, because the turn is still running" — and that premise is FALSE the moment the owner
   # types anything mid-wrap. A rate-limit resume (a message saying the limits have reset, so resume) is the
   # commonest such message and it lands squarely inside a long wrap. MEASURED ON ONE SESSION,
   # BEFORE AND AFTER one owner message: before -> markers [2254, 4570, 6830], qualifying
   # [2254, 4570], CP=4570, window 2,299 lines / 5.41 MB / 3 slices. After -> qualifying
   # [2254, 4570, 6830], CP=6830, window 263 lines / ~0.3 MB / 1 slice. Same session, same
   # transcript, an 89% under-scan, and the only thing that changed was one mid-wrap
   # resume message. The prior wrap in that session hit it for real and caught it on the few-KB TELL
   # the block below documents; this run got the right answer purely because the derivation ran
   # BEFORE the owner spoke. ⚠️ THE TELL IS DOCUMENTED AND THE CAUSE WAS NOT — a seat that
   # re-derives after a mid-wrap owner message has no reason to distrust a fresh reading.
   # You are running /wrap right now, so the LAST /wrap marker in the transcript is yours.
   # ⛔ THE ASSUMPTION THIS RELIES ON, STATED SO YOU CAN CHECK IT: exactly ONE marker per
   # invocation. If the CURRENT run emits two or more marker-matching lines — an API-retry
   # duplicate, which `active-recall.md` notes is stamped per DELIVERY — then dropping one
   # trailing marker leaves the earlier duplicate exposed to the same misclassification this
   # fix exists to prevent. Measured on 9 fixtures (2026-09-07): 2 current-run
   # markers + an interjection gives old CP=6, this fix CP=4, correct CP=1 — better, still
   # wrong.
   # ⛔ THE ASSUMPTION IS FALSE AND THE CAUSE IS THIS BLOCK — MEASURED IN THE WILD 2026-09-09
   # (one session, 4 of 4 invocations), CORROBORATED INDEPENDENTLY BY A SEPARATE TRANSCRIPT READ
   # OF AN EARLIER WRAP OF THE SAME SESSION. Every invocation emits TWO matching records,
   # as an ADJACENT PAIR (Δline = 1): the command record (`type:"user"`, no `isMeta`, body
   # `<command-` + `message>` + `<command-name>`; the first literal is SPLIT here on purpose —
   # writing it whole would plant it in this file and kill the discriminator, which is what
   # an earlier commit did until 2026-09-09), and the SKILL-BODY INJECTION (`type:"user"`,
   # `isMeta:true`) — which matches because THE SPEC TEXT ITSELF CONTAINS THE LITERAL
   # `<command-name>/wrap`, quoted three lines above by this very derivation. So the detector
   # reads its own source: the self-contaminating-probe class (a probe whose own execution enters the corpus it searches), one
   # level up from the digit-bearing-example hazard the $TXT clause already warns about.
   # Measured markers: [4821, 4822, 8152, 8153, 9388, 9389, 13124, 13125] — four clean pairs,
   # `isMeta` None/True/None/True/… throughout. NOT an API retry: retries were an earlier
   # fixture hypothesis and the human-retype gaps (45.0s, 90.5s) were the counter-example;
   # this mechanism is structural and fires on EVERY invocation, so the fixture work was
   # aimed at a vector that exists but is not the one that was firing.
   # ⛔ TWO VECTORS, TWO FIXES, AND ONLY ONE OF THEM IS CLOSED — do not read the next
   # paragraph as covering both (a reviewer flagged exactly this risk, so it is
   # folded here before the review panel ran).
   # The API-RETRY vector is the harness re-emitting a record; the SPEC-SELF-READ vector is
   # this file's own injected text matching the detector's literal. Different trigger,
   # different fix. The ADJACENT-PAIR COLLAPSE closes the SECOND. Whether it also closes the
   # first is UNMEASURED AND MUST NOT BE ASSUMED: it would close the retry vector only if a
   # re-emitted record lands line-ADJACENT to its original, and nobody here has observed a
   # retry to check that — the evidence is a 9-fixture rig, not a live retry. ⚠️ It is
   # the plausible-mechanism-asserted-without-measurement shape this file has been bitten by
   # three times in one night; do not upgrade it on how reasonable it sounds. The retry
   # vector's stated mitigation therefore remains `marks[:-1]`, which that same rig shows is
   # better-but-still-wrong (CP=4 against a correct 1). It stays OPEN
   # as a tracked item, whose TRIGGER also needs re-pointing, because it keys on
   # the few-KB SANITY tell that the ~225 KB skill-body injection has since killed.
   # THE FIX IS THE ADJACENT-PAIR COLLAPSE ABOVE. Without any de-duplication `marks[:-1]`
   # drops the isMeta TWIN rather than the current run's command record, so the current run's
   # marker survives into `ok` and is excluded ONLY by the typed-prompt filter — the filter
   # the lesson records as failing the moment the owner types mid-wrap. The mitigation was
   # one-deep while reading as two-deep: on THIS run 13124 survived `marks[:-1]` and an owner
   # message after it would have collapsed a 3,867-line window to ~130, reported as a
   # completed deep pass. The collapse fixes that WITHOUT deleting the lone skill-tool marker.
   # ⛔ AN `isMeta` FILTER SHIPPED HERE FOR ~4 HOURS ON 2026-09-09 AND IS RETIRED — it closed
   # the same twin and blinded the detector to every skill-tool wrap. Two review lenses
   # converged on it independently and neither could test the decisive case, because the one
   # transcript each was permitted to read contained no skill-tool wrap. MEASURED HERE ON FIVE
   # PEER TRANSCRIPTS, none of them the author's (CP under filter -> CP under collapse):
   #   peer 1     1 -> 6830    (the filter left ONE marker; marks[:-1] emptied it, so CP fell
   #                            back to 1 and the whole 10,162-line transcript re-scanned)
   #   peer 2     24186 -> 28258   (4,072 lines over-scanned)
   #   peer 3     15602 -> 23503
   #   peer 4     15257 -> 21071
   #   peer 5     49640 -> 51147
   # CONTROL, and it is what makes the collapse safe to fold: on a transcript with NO lone
   # isMeta marker the two forms are byte-identical (author's own, 8 raw markers -> 4 both
   # ways, CP 9388 both ways). Every delta is an OVER-scan, so the retired filter never missed
   # a finding — it silently paid for one to four extra slice agents per wrap.
   CUR = marks[-1] if marks else 0   # the CURRENT run's own marker — the SANITY comparand below
   marks = marks[:-1]
   # ⛔ AN ABANDONED /wrap IS NOT A PRIOR WRAP (2026-10-03). The typed-prompt
   # filter asks only whether the owner spoke LATER, so a /wrap the owner typed and replaced before any
   # reply passes it and becomes CP, and the window starts at a wrap that never ran. Two shapes,
   # one transcript: /wrap replaced by /summary 4 s later, and `/wrap --sonnet` re-typed bare 14 s
   # later. Measured: CP 18585 against a true 16099, 2,486 of 3,043 window lines unscanned. Keep a
   # marker only if an ASSISTANT record sits between it and the owner's next input — a typed
   # prompt OR a slash command, because /summary is a command record with no promptSource and the
   # typed filter alone sees past it. Controls: 7 peer transcripts, CP identical under both forms,
   # ABANDONED [] on each. A re-typed /wrap's FLAGS are the orchestrator's to read off both records.
   cmds = [i for i, l in enumerate(lines, 1)
           if '<command-name>' in l and rec(l).get('type') == 'user' and not rec(l).get('isMeta')
           and not rec(l).get('isCompactSummary') and isinstance((rec(l).get('message') or {}).get('content'), str)]
   owner_in = sorted(set(typed) | set(cmds))
   # ⛔ A HARNESS-SYNTHETIC ASSISTANT RECORD IS NOT A REPLY.
   # A session-limit or API-error turn writes `type:"assistant"` with `model:"<synthetic>"` and
   # `isApiErrorMessage`, so a /wrap that hit the limit read as answered. Measured on one session: /wrap
   # at 30391, then "You've hit your session limit", /model, /wrap again at 30415: CP 30391 against
   # a true 16941, 13,450 lines unscanned, CP < CUR passing. Over 234 wrap transcripts the exclusion
   # changes that one CP and nothing else.
   # ⚠️ ABANDONED over-reports one shape: a /wrap interjected before its first reply and then resumed
   # by a typed request to resume it leaves no second marker, so it prints as ABANDONED although it ran
   # (two sessions; 2 of 23 ABANDONED over 234 transcripts). This filter only ever
   # REMOVES candidates, so that error moves CP earlier (an over-scan), never later.
   asst = [i for i, l in enumerate(lines, 1) if '"type":"assistant"' in l and rec(l).get('type') == 'assistant'
           and not rec(l).get('isApiErrorMessage') and (rec(l).get('message') or {}).get('model') != '<synthetic>']
   def answered(m):
       nxt = min([t for t in owner_in if t > m] + [len(lines) + 1])
       return any(m < a < nxt for a in asst)
   print("ABANDONED", [m for m in marks if not answered(m)])
   ok = [m for m in marks if any(t > m for t in typed) and answered(m)]
   print("CP", ok[-1] if ok else 1)
   print("CUR", CUR)
   CPPY
   CP=<the CP value printed>    # and CUR=<the CUR value printed> — BOTH are read; see the SANITY gate below
   CP=<the number that prints>   # ⛔ the 2026-09-05 reading that stood here ("34 markers, the 3
                                 # from the current turn correctly excluded, CP=24680") is STRUCK:
                                 # it measured a filter stack that no longer exists — it predates
                                 # both the `type=='user'` and the `is_tool_result` filters above,
                                 # so its "correctly excluded" describes a different derivation.
                                 # Caught 2026-09-07; a lens nearly published it as a
                                 # same-file refutation of the fix and caught it only by
                                 # git-blaming the comment's own origin. Verified live 2026-09-07
                                 # on this seat instead: 3 markers, CP=4570, 3,231-line window —
                                 # and WITHOUT `marks[:-1]` the same transcript yields CP=6830 and
                                 # a 263-line window, so the bug is live here, not hypothetical.
   COVERED=.claude/state/deep-pass-covered-${CLAUDE_CODE_SESSION_ID:0:8}; [ -f "$COVERED" ] && CP=$(( $(cut -d' ' -f2 "$COVERED") + 1 ))   # ⛔ FIRST, since 2026-10-11 (after the derivation's fourth hand correction): a COMPLETED deep pass records its covered range in this file when its last slice returns (the pass-return step below), and the derivation takes CP = that range's last line + 1 whenever the file exists; the marker walk above is the FALLBACK, used only when no pass of this session has recorded its range. Why: on 2026-10-11 the walk returned an abandoned Fable wrap (Steps 0-1 only, interrupted by the owner, marker 80366) as the last completed pass, and the seat set CP 62944 by hand — the fourth time the derivation needed a hand correction. The SANITY gate below still applies to the value this line produces, and the line sits BELOW every `CP=` assignment of the walk so nothing re-assigns it; a SANITY abort with this file present means a pass of THIS wrap already completed and recorded its range: read the file, do not re-dispatch.
   SCAN_BYTES=$(sed -n "${CP},\$p" "$TXT" | wc -c | tr -d ' ')
   # ⛔ SANITY — AN EXACT COMPARISON, NOT A THRESHOLD. CP must be STRICTLY LESS than the
   # CURRENT run's own marker; equality means the derivation matched THIS run.
   [ "$CP" -lt "$CUR" ] || { echo "ABORT — CP=$CP is not strictly less than this run's own marker $CUR: the derivation matched THIS run. Re-derive; do NOT dispatch."; exit 1; }
   # ⛔ THE OLD TELL — "a window of a few KB means CP matched THIS run" — IS STRUCK 2026-09-09,
   # DEAD TWICE OVER, and it was still prescribed here after an earlier commit fixed the matching tracked
   # trigger for exactly this reason and left this line alone. (i) The current run's own
   # ~223 KB skill-body injection sits INSIDE every self-match window, so a measured
   # self-matched window was 1.02 MB — one plausible slice at the 2 MB rule, not a few KB.
   # (ii) Its second half routed the reader to the ONE-MARKER-PER-INVOCATION assumption this
   # same file declares FALSE sixty lines above. A proposed replacement
   # ("under ~300 lines means CP matched this run") was withdrawn by its author the same day and
   # for the same class of reason: current-run windows measure 22-293 lines against a smallest legitimate gap
   # between two real wraps of 76, so the ranges OVERLAP and NO line or byte threshold can
   # separate "this run" from "a quick re-wrap" — in its author's words, "I gave you a number
   # where the honest answer is there is no number." The comparison
   # above needs no threshold and survives any future injection size. If it aborts, read the marker list and the flags.
   ```
