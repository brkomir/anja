# Review Hub — handover and retire (moved, with the copy's edits, from `SKILL.md` on 2026-10-26; the core's `📁` stubs point here and the core wins a disagreement)

### ⛔ THE HANDOVER PROTOCOL — five steps

**It REPLACES the `--takeover` warrant dance and the seat-routing table that stood here for ~15 minutes before it.** That table said: incumbent-seat ⇒ `--retire (in favor of X)`, successor-seat ⇒ `--takeover` after a prose instruction, no-hub ⇒ vacancy. It was rejected as insufficient. **What was wrong with it:** it routed by which seat the owner happened to be sitting in, so the protocol changed shape depending on an accident of where he typed — and BOTH branches still ended with the incumbent improvising the wind-down. The five steps below are seat-independent and the wind-down is specified.

⛔ **THE DIRECTIVE BEHIND THE PROTOCOL, IN SUBSTANCE — IT LIVES HERE BECAUSE IT LIVED NOWHERE DURABLE.** A review of this
very commit found it survived only on planes that expire: the mail store (24h read / 72h unread), a log, and two session
transcripts. A protocol whose source of authority prunes in a day cannot be checked against its own intent, which is what
makes every interpretation below unfalsifiable from the artifact. So its five steps are recorded here:

> 1. a new session runs `/review-hub --await`, which sets the expectation that it will soon become the new review hub, and
> waits for the signal from the current hub;
> 2. the current hub runs `/review-hub --handover <session id or name>`, which announces to the fleet that the new hub is
> taking over;
> 3. any unfinished but started work from the current hub's queue transfers to the new hub; other work that is ongoing or
> in an unclosed review loop finishes in the retiring hub;
> 4. after unfinished work is complete, the retiring hub announces that it is done and won't respond to new requests, and
> forwards any new request it receives to the new hub;
> 5. once everything from the previous steps settles, the retiring hub updates its `/working-plan` and notifies the owner
> that it is ready for `/wrap`.


⛔ **THE WARRANT APPARATUS IS GONE FROM THE NORMAL PATH, DELIBERATELY.** `--handover` is invoked IN the incumbent, which is the seat that must act, so there is nothing to relay and nothing to authenticate. No `authorized-by`, no `_validate_authorized_by`, no quote-grep. Those survive only on the unresponsive-incumbent path: the successor's half in `references/takeover-superseded.md`, the incumbent's half in § Receiving a `hub-retire-demand` below.

| step | seat | command / act |
|---|---|---|
| **1** | incoming | `/review-hub --await` — declare intent, stamp AWAITING, arm the listener, WAIT |
| **2** | current hub | `/review-hub --handover <target>` — **stamp `.retiring` with the target FIRST, then broadcast.** ⛔ NOT the other order: this row said broadcast-then-stamp until a review caught it, and the inverted window is the election this protocol exists to close |
| **3** | both | partition the work by the discriminator below — some TRANSFERS, some STAYS |
| **4** | retiring hub | when the retained work is done: broadcast DONE + FORWARD-ONLY |
| **5** | retiring hub | update the working plan, notify the OWNER it is ready for `/wrap`, and HOLD |

### §A — `/review-hub --await [<incumbent>]` (the incoming session)

1. **STAMP THE AWAITING MARKER AND WRITE YOUR SESSION MANIFEST** — `date -u +%FT%TZ > .claude/state/review-hub-awaiting-<your-sid8>`, then `python3 scripts/session-manifest.py write`. This is a DIFFERENT marker kind from `review-hub-active-*` and must never be confused with one: an awaiting session is **not** a hub and must not be delegated to.
   ⛔ **THE MANIFEST IS NOT HOUSEKEEPING — THE WHOLE ELECTION SUPPRESSION GATES ON IT.** `_successor_is_live` returns False unless `active-sessions/<sid>.md` exists, so a successor with no manifest makes `hub-discover` print `🚨 REVIEW-HUB VACANCY` and the election command **instead of** `NO ELECTION — SUCCESSION IN FLIGHT`. Fixture-measured with a positive control; conditional today only because 11 of 11 live sessions happen to have manifests.
   ⚠️ **THIS MARKER HAS NO REAPER, NO LIVENESS CHECK AND NO ACK, AND THAT IS A KNOWN HOLE, NOT AN OVERSIGHT YOU SHOULD RE-DISCOVER.** Nothing removes it: no `rm -f` in this file names it (they name the base marker, `.retiring` and the paused marker), and the GC globs `review-hub-active-*`. So §B.1's STOP — the protocol's ONLY refusal — is satisfiable by a corpse forever. **If you abandon an await, `rm` your own marker.** And §B.1's existence test is weaker than what `--retire` step 4 requires of a successor (an ACK, from a seat that demonstrably ran); treat a bare `test -e` as the floor it is.
2. **ARM `mail-listen`** (`--poll 30`) so the incumbent's signal can land. **Do NOT arm the staleness poller yet** — you hold no queue, so it would poll an empty set. ⛔ **THIS DEFERRAL IS RESUMED AT §B.4 AND NOWHERE ELSE — DO NOT LEAVE IT DANGLING.** An earlier version of this section deferred it here and resumed it in no step at all, which silently re-armed a measured incident (a hub armed 10.4h with three requests at 83/80/56 minutes and no alarm) for every hub arriving by handover. ⭐ **The general form, which is the better half of that finding: a "not yet" inside a numbered protocol is a DEFERRAL WITH NO TRIGGER — grep the file for its resumption before you credit it. The dropped step is always the one the owner never had to say.**
3. **MAIL THE INCUMBENT**, naming yourself as the awaiting successor, so it knows who to hand to and does not have to guess or ask the owner. If you were given no incumbent, resolve one with `hub-discover`.
4. ⛔ **DO NOT BROADCAST TO THE FLEET, DO NOT `fleet-claim`, DO NOT STAMP A HUB MARKER.** The fleet switches on the INCUMBENT's step-2 broadcast and on nothing else. An awaiting session that announces itself creates a window where peers believe two hubs are live — the one failure this whole protocol exists to prevent, arriving through eagerness rather than through a crash.
5. **WAIT.** Do other work; the listener re-invokes you when the signal lands. **Do not poll the incumbent and do not re-ask.** If nothing arrives and the owner asks, say you are awaiting and name the incumbent — do not escalate to `--takeover` on your own judgment.

### §B — `/review-hub --handover <sid|name>` (the current hub)

1. **RESOLVE THE TARGET ONCE, INTO A VARIABLE, AND VERIFY IT.** `T=<sid8>` — then confirm `review-hub-awaiting-$T` exists. **If it does not, STOP and say so**: handing to a seat that never ran `--await` hands the role to a session with no listener, no marker and no expectation, which is a vacancy wearing a successor's name. A sid or a session NAME is acceptable input; resolve a name with `session-manifest.py who`.
   ⛔ **TYPE THE SID EXACTLY ONCE. Every later use is `$T`.** Hand-typing it into both the verification and the `.retiring` stamp means nothing compares them, and a SHAPE-VALID transposition passes the `[0-9a-f]{8}` validator: it then suppresses the fleet election **and** makes `fleet-claim` refuse the REAL successor — two independent gates, one character, both silent. A shape-INVALID typo reads as a declared vacancy and a third seat claims while you believe you handed over. One variable removes the whole class.
2. **STAMP `.retiring` WITH `$T`, THEN READ IT BACK.** `echo "$T" > .claude/state/review-hub-active-<your-sid8>.retiring` and verify through the function the fleet actually uses, not by `cat`: `_retiring_successor` must return `$T`. ⛔ **`touch` IS WRONG HERE:** an EMPTY `.retiring` declares a VACANCY and sends every booting peer into an election. With the sid in it, `hub-discover` prints `🔁 NO ELECTION — SUCCESSION IN FLIGHT` and routes to the target.
3. **BROADCAST THE ANNOUNCEMENT** — `--to all --signal hub-handover`, and **the signal token is not decoration**: `mail-listen` HOLDS `signal: info` without waking the recipient, and `info` is the majority convention for broadcasts (185 of 295 measured). An `info`-tagged handover would leave the awaiting seat asleep on the one message it is waiting for. Carry: the target's sid and name, that it takes every NEW request **effective now**, that this seat keeps its retained work (step 3), whether a usage watch is armed and at what N, and that this seat's inbox stays READ until it says otherwise. This broadcast is what moves the fleet.
4. **THE TARGET THEN CLAIMS, READS THE MESSAGE, AND ONLY THEN RESUMES PHASE 1.** `fleet-claim review-hub` needs no override flag once `.retiring` is stamped — **and that is not the hazard.** ⛔ **THREE OUTCOMES SHARE rc=3: READ THE MESSAGE, NEVER THE EXIT CODE.** **LOST names a winner — ack them, STAMP NOTHING, and STOP: you are not the hub, and the marker below is what would make you the second one.** REFUSED is a NEAR-match — read `fleet-claim --list` before deferring. COULD NOT VERIFY means the write landed and the read-back was empty — `--check` before STAMPING, not merely before announcing. *(This imperative has now been dropped by TWO successive compressions of this file and restored twice after review. It is the first thing to go and the last thing you can afford to lose.)*
   **Then, and only then:** stamp your own base hub marker, **re-arm `mail-listen` WITH `--rebroadcast-hours 48`** (a bare listener leaves the marker ageing past the 72h floor until every peer's `hub-discover` drops you to STALE-BROADCAST), and **arm the staleness poller as a SECOND Monitor, also `timeout_ms: 1800000` and re-armed on each expiry** — `while true; do bash scripts/hub-stale-request-poll.sh 2>&1; sleep 600; done`, the `2>&1` load-bearing. **This is where §A.2's deferral is resumed. A hub arriving by handover that skips it holds a queue with no alarm on it.** **And if the retiring hub's forward or working plan names a usage watch (`usage watch armed: --pause-at N`), arm § `--pause --when` step 6 with the same N in this turn: the 2026-10-23 handover dropped it, and the next day a question whether the hub would pause at 80% found no watch running.**

### §C — STEP 3, THE WORK PARTITION. This is the step that decides whether anything gets dropped.

✅ **CONFIRMED: QUEUED TRANSFERS, STARTED STAYS.** The reading was put back as a question and confirmed. This is no longer an interpretation and does not need re-litigating; the table below IS the rule.

⭐ **AND THE DIRECTIVE'S OWN STEP 4 SETTLES IT INDEPENDENTLY — the strongest evidence here, added 2026-09-12 and previously missed by both seats that argued about step 3.** Step 4 says that after unfinished work is complete, the retiring hub announces it is done and won't respond to new requests. That sentence is **vacuous unless the retiring hub keeps unfinished work to finish**: if everything started had transferred, there would be nothing left for it to complete and nothing to announce. So the confirmed rule is not a correction of the directive at all — it is the reading its next step requires. ⚠️ Worth stating because the argument below was reached for first and is weaker: it reasons from what an implementer CAN do, which invites the reply *"then change the implementation"*; this one reasons from what the directive SAYS. **Anyone re-opening this should be shown step 4 before the executability argument.**

*Why it needed asking, kept because it is the argument that survives if anyone re-opens it:* step 3 says that any unfinished but started work transfers, and **the literal reading is UNEXECUTABLE at row 2 of the table below** — a running panel cannot transfer, because sub-agents belong to the session that dispatched them, so "started ⇒ transfers" orders you either to hand over something you physically cannot hand over or to kill it and destroy the spend, which is separately forbidden. The directive is recorded above, so the rule stays checkable against it. *(This paragraph read "WE READ IT AS … CONFIRM OR CORRECT IT" and framed the partition as a reading rather than a rule until the confirmation landed.)*

⚠️ **THE DISCRIMINATOR, stated because the directive names two categories that sound alike and an implementer has to draw one line:** *has this item consumed context that lives only in THIS session?*

| state | where it goes | why |
|---|---|---|
| received, acked, **no panel dispatched and no verdict sent** | **TRANSFERS** — forward it to the new hub naming the ORIGINAL SENDER, not yourself | nothing is lost by a fresh seat picking it up; there is no context to carry |
| **panel dispatched / lenses running** | **STAYS** | sub-agents belong to this session and cannot be handed over; killing them destroys the spend (and is separately forbidden) |
| **verdict sent, fold-verify owed** — an UNCLOSED LOOP | **STAYS** | the findings, the file:line verifications and the brief premises live in this transcript; a fresh seat would re-derive them or take them on trust |
| a HOLD this seat issued that has not been cleared | **STAYS**, and its `todo.txt` row is what survives if the session does not | a hold is the strongest thing this seat sends; the mail plane expires and the row does not |

⛔ **STATE THE PARTITION OUT LOUD, PER ITEM, IN THE STEP-2 BROADCAST — derived by command, never recalled.** Run the queue instruments — the closure scan (`review-request-closure-scan.mjs`, the one OPEN predicate since 2026-10-26: `review-queue.py` takes its open set from its `--json` and `hub-stale-request-poll.sh` reads it too), `hub-unfinished-loops.py`, `hub-open-promises.py`, and `hub-owner-rulings-scan.py` for owner speech — and list every row with its side of the line. **A partition nobody published is a partition both hubs will guess at differently**, and the failure is silent on both sides: the new hub assumes you kept it, you assume they took it.
⚠️ **Every one of those instruments is blind to the hub's own dominant open loop — a verdict YOU issued whose findings never came back.** That one is invisible to every scan as run by default (§ ALSO ARM THE QUEUE-CLOSURE CHECK: pointed at the requester, the disposition scan counts your own ledger commits as its fold) and it is the commonest thing in the STAYS column, so read the ledger rows, not the scan output.

### §D — STEP 4, THE DONE ANNOUNCEMENT. Distinct from step 2 and easy to skip.

⛔ **PRECONDITION, AND IT IS THE GATE THAT STOPS THE WORST REACHABLE STATE: confirm `review-hub-active-<target>` EXISTS before this broadcast.** Without it, an awaiting seat that dies after §A leaves you with a base marker present, `.retiring` naming a dead sid, `hub-discover` reporting **0 live hubs with the election SUPPRESSED**, `fleet-claim` refusing every other seat, and you having publicly refused new work while forwarding to a corpse — **with no step violated anywhere.** One existence check also makes §B.1's typo case and the dead-target case LOUD instead of silent. If it is absent: do NOT send this broadcast, say so, and either re-run `--handover` against a live target or declare a VACANCY.
When every STAYS item has closed AND that precondition passes, **broadcast again** (`--to all`): this seat is DONE, it will **not** answer new requests, and **anything that arrives from here is FORWARDED to the new hub naming the sender**.
⛔ **THIS IS A SECOND, SEPARATE BROADCAST AND THE PROTOCOL IS INCOMPLETE WITHOUT IT.** Step 2 told the fleet where NEW work goes; step 4 tells them this seat has stopped working, which is a different fact and the one peers need before they stop expecting a reply. A step-2 broadcast with no step-4 leaves every peer holding a retained item unable to tell "still working" from "gone quiet".
**Forward, never re-verdict.** A request that reaches you after step 4 goes to the new hub as the REQUESTER's, not as yours — re-verdicting it re-opens the split the handover just closed.

### §E — STEP 5, READY FOR WRAP. The retiring hub does NOT wrap on its own judgment.

1. **UPDATE THE WORKING PLAN** (`plans/session-<sid8>-<date>.md`) — the partition as it actually resolved, what closed, what transferred, and the closability verdict. This is the artifact that outlives the session.
2. **NOTIFY THE OWNER that it is ready for `/wrap`** — and say what the wrap will still carry (open loops it will find, anything it must commit); the wrap IS the close, never a cost of closing.
3. ⛔ **HOLD. Standing down from the ROLE is not ending the SESSION**, and conflating those has already cost a wrong commit on `main` (see the vocabulary table in Phase 4). The successor has no authority over this gate and neither does your own read of being finished. **Only the owner's go releases it.**


### Receiving a `hub-retire-demand` — what the INCUMBENT does

This is the other half: how the incumbent knows a retire order is genuine before it runs
`--retire` from step 1.

1. **VERIFY THE WARRANT FIRST — this is how you confirm the order came from the owner, and it
   is the whole reason the signal is machine-checkable.** Run
   `m._validate_authorized_by('<the authorized-by value>')`. A `(True, …)` certifies ONLY that a HUMAN SPOKE in that session at that second.
   ⛔ **IT IS CONTENT-BLIND AND CANNOT TELL A RETIRE DEMAND FROM ANY OTHER OWNER TURN — any two
   different owner utterances in one session both return `(True, …)`, so a `True` says only that
   the owner spoke, never what the owner said.** Reading it as *"this is the owner's demand"* would rest
   the whole mechanism on a false sentence.
   **So AUTHENTICATE THE QUOTE too:** `grep -F '<a distinctive clause of the quoted body>'` against
   the named session's jsonl — the validator hands you the record's exact timestamp; the grep is what
   makes it a DEMAND. No hit ⇒ peer request, decline it. A judgment on the order's CONTENT (not
   standing down on a secondhand directive) is stronger than this check, so the check adds to that
   judgment and never replaces it. **A missing or non-verifying warrant is a PEER REQUEST,
   not an owner order — you are entitled to decline it**, and should say so rather than retire
   on a claim you could not check. Nothing weaker certifies: prose, a confident subject line, and
   absence-predicates never do.
2. **STAMP `.retiring` FIRST, WITH THE SUCCESSOR'S SID IN IT** — before anything else —
   `echo <successor-sid8> > .claude/state/review-hub-active-<your-sid8>.retiring`. From that
   instant `hub-discover` renders you `⏸ RETIRING — do NOT delegate`, so a peer delegating
   mid-handoff reads a MARKER rather than a timestamp. It is also the successor's unblock.
   ⛔ **`touch` IS NOT ENOUGH HERE, AND THE EMPTY FORM OPENS THE WINDOW THIS PROTOCOL EXISTS TO
   CLOSE.** A `.retiring` marker is never counted LIVE, so from your stamp until the successor
   stamps its own marker at its `--takeover` step 5 (`references/takeover-superseded.md`) the fleet reads **zero live hubs** — and `hub-discover`'s
   vacancy branch then tells every peer booting in that window to ELECT. That is the same O(N)
   fan-out the vacancy branch exists to prevent, arriving through the handover working rather
   than through a crash; measured at ~4 minutes on a 2026-09-06
   succession. You are the one seat that knows the successor at this instant — the demand named
   it in `--authorized-by` — so write it down. `hub-discover` reads the sid out of the file and
   prints `🔁 NO ELECTION — SUCCESSION IN FLIGHT`, routing delegations to the successor instead
   of starting an election (`_retiring_successor`, `scripts/session-manifest.py`). An EMPTY
   marker still means a DECLARED VACANCY and still elects, which is why the two spellings must
   not be used interchangeably.
3. **DERIVE the open queue by command, never recall** — `node scripts/review-request-closure-scan.mjs`
   plus an enumeration of inbound, read AND unread. A retirement that says "everything is closed"
   from memory is the one claim nobody downstream can re-check.
4. **PRESERVE the dismissal ledger** into a git-tracked `plans/` file and name it in the
   broadcast — it is sid-keyed and git-ignored, so retiring deletes it from the fleet's view
   without deleting the file, and a successor re-flags every dismissal as OPEN.
5. **ANNOUNCE the retirement IN THE SUCCESSOR'S FAVOUR** (`--to all`), naming the successor's
   sid explicitly. This is a successor-CONFIRMED retirement, so it needs no ack to be complete —
   but it must not be softened to "a fresh hub is coming", which designates nobody and triggers
   the every-peer-self-runs fan-out. State your open loops and whether your inbox stays read.
6. ⛔ **THEN HOLD FOR THE OWNER'S GO BEFORE `/wrap`.** The incumbent announces its
   retirement in the successor's favour to the fleet and then waits for the owner's go before
   `/wrap`. Standing down from the ROLE is not ending the SESSION — the two are
   different axes and conflating them has already cost a wrong commit on `main` (see the
   vocabulary table in Phase 4). **The successor has no authority over this gate**; neither does
   your own read of being finished.

A takeover transfers the ROLE, never the outstanding work: finish every open loop regardless.

### `/review-hub --retire` — the ordered sequence

⛔ **THE ORDER IS THE POINT. Phase 4 has always held every step; what it lacked was a
named command that runs them in sequence — and the retiring hub reconstructs that order
from prose at exactly the moment it is winding down.** Codified after the retiring
seat that had READ Phase 4 that same day still (a) broadcast BEFORE
stamping the marker and (b) wrote *"a fresh hub is up in minutes"* — the precise phrasing
the vacancy rule names as designating nobody. Two of the four steps, in the one run.

1. **STAMP `.retiring` FIRST**, before anything else — `touch
   .claude/state/review-hub-active-<sid8>.retiring`. From that instant `hub-discover`
   renders this hub `⏸ RETIRING — do NOT delegate`. It precedes the broadcast so a peer
   delegating mid-handoff reads a MARKER, never a timestamp.
2. **DERIVE the open queue — never recall it.** Every request addressed to this hub with a
   verdict from you, established by command. A retirement broadcast that says "everything
   is closed" from memory is the one claim nobody downstream can re-check.
3. **PRESERVE the dismissal ledger** into a git-tracked `plans/` file and name it in the
   broadcast — it is sid-keyed and git-ignored, so retirement deletes it from the fleet's
   view without deleting the file.
4. **BROADCAST**, and it MUST end in exactly one of two states, never in prose between them:
   - **successor CONFIRMED** — named sid, and only after that peer ACKED. **Write that sid into
     your `.retiring` marker in the same turn** — `echo <successor-sid8> >
     .claude/state/review-hub-active-<sid8>.retiring` — so `hub-discover` prints
     `🔁 NO ELECTION — SUCCESSION IN FLIGHT` instead of an election to every peer that boots
     before the successor stamps its own marker. The broadcast reaches whoever is reading mail;
     the marker reaches whoever is booting, which is the population the election misroutes.
   - **VACANCY DECLARED** — say the word, route to `fleet-claim review-hub`, and **leave the
     `.retiring` marker EMPTY**. Emptiness is the signal that the election is correct: a marker
     naming nobody elects, exactly as it always did.
   ⛔ **"A fresh hub is coming" is neither.** It reads as a handoff and designates nobody,
   and the resulting silence is the trigger for the fleet's most expensive failure: each
   peer reads "no hub", broadcasts, gets no ack because every peer is in that same state,
   and self-runs the SAME review with its own panel. One review, N panels. **A retiring hub
   that cannot get an ack declares the vacancy; it does not soften it.**
5. **STATE THE INBOX**, explicitly, one of two: the listener stays ARMED until the session
   closes, or this inbox is now POLL-ONLY. A `TaskStop` with neither leaves peers mailing a
   seat that will never answer — and their `mail-send` still prints a success ack, because
   delivery and readership are different facts and only the ack is visible to them.
6. **FORWARD, do not answer, once your loops are closed**. A
   retiring hub keeps receiving requests — peers read mail on their own cadence and a
   broadcast does not reach a session mid-wave. Forward each to the successor naming the
   SENDER and the SHAs, and add nothing else: **a forwarded request must reach the new hub
   as the requester's, not as yours.** Re-verdicting it yourself after standing down
   re-opens the split the handover just closed, and answering "I have retired" without
   forwarding strands work that was correctly sent to a hub that was still listed.
7. **TEARDOWN LAST**, and ⛔ **RELEASE THE CLAIM BEFORE THE MARKERS — THE ORDER IS THE
   WHOLE FIX.** In this exact sequence:
   1. `python3 scripts/session-manifest.py fleet-claim review-hub --release`
   2. `TaskStop` the listener — ⚠️ **ONLY IF you declared POLL-ONLY at step 5.** Step 5
      offers "the listener stays ARMED until the session closes" as its first option,
      and a `TaskStop` here makes that announcement false. Declared ARMED ⇒ skip this,
      remove the markers, leave it running. ⛔ **AND SAY THIS OUT LOUD IF YOU TAKE THAT
      BRANCH: 7.3 DELETES THE BASE MARKER, AND THE QUEUE-CLOSURE SCAN IS GATED ON IT**
      (`session-manifest.py`: `if not my or not os.path.exists(... review-hub-active-{my})`
      → `return []`). So an ARMED teardown leaves you RECEIVING requests with the one
      instrument built to catch a dropped one switched off — and it returns an empty list
      at the gate, never reaching the fail-loud branch its own docstring promises. Run
      `node scripts/review-request-closure-scan.mjs` BY HAND before closing, or forward
      per step 6. Keeping the base marker instead is worse: it re-lists you as LIVE.
      *(Measured 2026-09-06: a retiring hub kept
      it armed and received 16 further messages, including a question relayed by
      the successor. A spec-compliant unconditional `TaskStop` would have dropped all
      sixteen, and `mail-send` would still have printed a success ack to every sender —
      the failure step 5 exists to prevent, arriving through step 7 instead.)*
   3. `rm -f` the marker files (base, `.retiring` AND `review-hub-paused-<sid8>`; `rm` of the
      base does not touch the companions).

   ⛔ **WHY THE RELEASE COMES FIRST — AND THE REASON THIS PARAGRAPH GAVE UNTIL 2026-09-07
   WAS FALSE AT SOURCE.** It claimed release-after-`rm` is *unreleasable* because
   `_fleet_claim_holder_stood_down` needs the `.retiring` marker. That helper does need it,
   and **it is never consulted when a holder releases its OWN claim**:
   `session-manifest.py`'s release refusal reads
   `if my and f'session: {my}' not in existing and not args.force and not rel_down:` —
   `rel_down` is the **fourth** conjunct, reached only when the second is true, i.e. only when
   releasing SOMEBODY ELSE'S claim. A retiring hub holds its own. Measured in an
   isolated fixture: **both markers removed first, then `--release` → rc=0, claim gone**, with
   a peer-release control correctly refusing at rc=3 so the arm was not vacuous. The repo's own
   self-test asserts the same thing (`fleet-claim: owner releases its own claim` → 0).

   **The order is still right, for a reason worth more than the false one: it buys a correct
   DISCOVERY WINDOW.** Between step 7.1 and 7.3 a peer runs `hub-discover`, and the two orders
   say opposite things — measured, both windows:

   - **markers gone, claim still held** → *"… VACANCY (0 live hubs) — but review-hub
     is CLAIMED by `<sid>` … DELEGATE THERE; do not self-run"* — **the notice's own remedy
     defeating the notice**, and a peer sent to a seat that has stood down.
   - **claim released first, markers still present** → the hub renders `⏸ RETIRING — do NOT
     delegate`, then a clean **VACANCY → ELECTION** with the `fleet-claim` command.

   So: release-first is correct, the window is the payoff, and the original defect — retirement
   stamped `.retiring` but never released the fleet-claim — was one of **omission**: `--release`
   appeared **zero** times in this spec before the fix. **Adding the release is the fix; the order
   is the refinement.**

   ⚠️ **AND VERIFY THE RELEASE LANDED — `rc=0` DOES NOT MEAN RELEASED.** The release swallows an
   `os.remove` OSError and still prints `released` and returns 0 (measured against a
   read-only state dir: rc=0, success text, claim file still on disk, and `--check` then printing
   `⛔ CLAIMED`). Run `fleet-claim review-hub --check` after 7.3 and require *not claimed*, or a
   sid that is not yours. A `rc=2` identity-unresolvable exit strands it the same way.

   ⭐ **SAFE ON BOTH EXITS BY CONSTRUCTION, so it needs no conditional.** In a SUCCESSION
   the successor has already overwritten the claim, so the release is loudly REFUSED
   (rc=3, *"held by ANOTHER session"*) and nothing happens. It only takes effect on the
   VACANCY path — the one that needs it. Run it unconditionally and read the refusal as
   the success it is.

   Never at wrap-start: a wrapping hub is done-for-now, not deaf.

⚠️ **Steps 4 and 5 are the two that get skipped, and both fail SILENTLY** — a softened
handoff and an unannounced dead inbox each look like a completed retirement from the
retiring seat's side. Neither produces an error, and only a peer discovers the cost.

## Entry points — the full text (moved from the core on 2026-10-26; the table is in `references/entry-points.md`)

- **`/review-hub`** — become the hub on a FRESH role, no incumbent. The core's § Process (Phase 3 first).
- **`/review-hub --await [<incumbent sid|name>]`** — ⛔ **THE INCOMING SESSION'S FIRST STEP.** Declares that this session is about to become the hub and then WAITS for the incumbent's signal. Stamps an AWAITING marker, arms the listener so the signal can land, and **claims nothing, stamps no hub marker, and does not broadcast to the fleet.** §A above.
- **`/review-hub --handover <sid|name>`** — ⛔ **THE CURRENT HUB'S STEP.** Announces to the fleet that the named session is taking over, partitions the work, and begins the wind-down. §B above.
- **`/review-hub --retire`** — STAND DOWN via Phase 4, in a FIXED ORDER. **TWO terminal states, not one:** a declared VACANCY + election, OR a successor CONFIRMED-BY-ACK (its own step 4). ⚠️ **That ack branch is NOT dead and this line said it was:** `session-manifest.py` cites `--retire` step 4 in three comments as the writer of the successor sid, and a peer who ACKED but never ran `--await` is routable by that branch and by nothing else. It BYPASSES §B.1's STOP gate (an ack, not an awaiting marker), so prefer `--handover`; do not delete the branch.
- **`/review-hub --takeover`** — ⏸ **SUPERSEDED 2026-09-12 by `--await` + `--handover`.** Section moved to `references/takeover-superseded.md` 2026-09-29 (the core's takeover stub); kept for the unresponsive-incumbent case and for its warrant mechanics; do not reach for it as the normal path.
