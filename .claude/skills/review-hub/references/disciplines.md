# Review Hub — teardown and the disciplines (moved, with the copy's edits, from `SKILL.md` on 2026-10-26; the core's `📁` stubs point here and the core wins a disagreement)

### Phase 4 — TEARDOWN (at /wrap when the hub is RETIRED)
**FIRST ACTION, at teardown-INTENT — before any other teardown step:** stamp the retiring companion marker (`touch .claude/state/review-hub-active-<sid8>.retiring`). From that instant `hub-discover` renders this hub `⏸ RETIRING — do NOT delegate` and sorts it below any live hub, so a peer delegating mid-handoff can name the live one from a MARKER, never a timestamp (a 2026-07-10 handoff printed TWO live hubs sorted by recency; the retirement existed only in prose). The stamp precedes the steps below deliberately: teardown can stall mid-way (the exact failure that motivated this), and an early stamp fails SAFE (worst case: a hub that aborts retirement un-stamps by `rm`-ing the `.retiring` file).
⛔ **VOCABULARY — "RETIRED" IN THIS FILE MEANS THE *ROLE*, NEVER THE *SESSION*, AND THAT AMBIGUITY HAS ALREADY COST A WRONG COMMIT ON `main` (2026-08-06).** This spec used the `retir*` stem on **15 lines / 28 occurrences** about a ROLE (measured at the commit before the one that added this table, i.e. before this table existed); the fleet read it as a LIFECYCLE STATE. A seat stepped down as hub while **alive, held, and being wrapped by hand** — its silence imposed, because its listener had been shut down by hand. A peer read "retired" as exited, ran the adopt ladder against its dirty files, and landed, a `chore(adopt)` commit adopting the "retired" seat's two "orphaned" artifacts. Nobody misapplied a rule; the ladder ran correctly on a premise this file's word choice supplied.

| referent | say | never |
|---|---|---|
| **ROLE** (hub, lead, claim-holder) | **stepped down as hub**, handed off, released the claim | retired, done, finished |
| **LIFECYCLE** (the session itself) | wrapped, exited, dead | retired |

**Generalizes past this word:** any status verb shared between a ROLE and its HOLDER gets read as the HOLDER's state, because the holder is the more consequential referent — and here the stronger reading (dead ⇒ artifacts are orphans ⇒ adopt) authorises a destructive-adjacent action on `main`. Before broadcasting a step-down, say which axis you mean. **A step-down is NOT an adoption trigger; only a lifecycle exit is, and that needs the `session-lifecycle.py status` reading, never a role announcement.**

When the session is **retired as hub** — i.e. **steps down from the ROLE** (the owner `/clear`s + moves the hub to a fresh session, or the session exits), **`TaskStop` the mail-listener — ⚠️ SUBJECT TO STEP 7.2'S CONDITIONAL, WHICH WINS: skip it
if you declared ARMED at step 5** — AND **remove the marker files explicitly** (`rm -f .claude/state/review-hub-active-<sid8> .claude/state/review-hub-active-<sid8>.retiring .claude/state/review-hub-paused-<sid8>` — `rm` of the base does NOT touch the separate `.retiring` file, and the mtime-keyed GC iterates base markers, so a companion whose base is gone would otherwise orphan; hub-discover also runs an orphaned-companion sweep as the backstop for `.retiring` only — nothing reaps a paused marker) so `hub-discover` stops surfacing this retired hub to new peers. Leaving the listener armed past retirement is the orphaned-listener leak: a wrapped/dead session's listener keeps polling → accumulating procs + cross-session DUPLICATE delivery into other sessions' monitor views. (A crashed hub that skips teardown is self-healing: its marker is auto-GC'd on the next `hub-discover` once BOTH its broadcast is >72h stale AND its session manifest has been pruned — i.e. the session is actually gone; the manifest gate deliberately prevents nuking a LIVE hub whose 48h push merely stalled. Its listener dies with the process — but clean teardown removes both immediately.)
- ⛔ **PRESERVE THE DISMISSAL LEDGER — IT IS SID-KEYED AND GIT-IGNORED, SO RETIREMENT DELETES IT FROM THE FLEET'S VIEW WITHOUT DELETING THE FILE.** `review-request-closure-scan.mjs` keys its own ledger to the running session (`DISMISS_FILE`, `:683`) and `.claude/state/` is git-ignored, so a hub's dismissals are invisible to **git** entirely — which is what the copy step below is for. ⛔ **THEY ARE NOT INVISIBLE TO OTHER SESSIONS: `:708-709` globs every sibling `closure-scan-dismissed-*.txt`, skips its own, and ANNOTATES a flagged row while leaving it flagged.** **A retiring hub copies its ledger into a git-tracked `plans/` file and names it in the retirement broadcast**. ⚠️ **The hub that set the 2026-08-26 precedent believed the opposite** — *"I recorded that limitation in the tool's own dismissal file, which prints on every run, so the next hub reads it at the moment it would otherwise be misled"* — true of that session, and that session was retiring. **This is the steady state, not a hypothesis:** two ledgers were already orphaned when the rule was written, and the rows are not bookkeeping — they include a RETRACTION and ~25 adjudications derived from mail bodies since aged out of the 24h read-TTL, which a successor **cannot re-derive**. It re-flags every one as OPEN and reads a queue that looks broken. The structural fix — surface FOREIGN ledgers as advisory, never as silent suppression, since one hub's out-of-scope call must not mute another's queue — **IS BUILT**, and its discriminating control is on record: a foreign dismissal planted on a currently-flagged sha printed the advisory AND left the flagged count unchanged at 10, with the plant removed restoring the prior output. The tracker row closed 2026-08-26. *This bullet read "is NOT built" until 2026-09-07: it was written in the very commit that shipped the fallback (+26 lines to the scanner), and it had copied the tracker row's PRE-fix problem statement without taking its closure — so it told every future hub to rebuild a mechanism it was already relying on. Lead supplied unverified by a peer 2026-09-06, verified at source here.*
- **Do NOT stop it at a "done-for-now" wrap where the session stays the active hub** (when told to keep listening) — only at genuine retirement. (The pushback over terminating the mail-listener was about terminating while still serving — the opposite mistake.)
- ⛔ **STOPPING THE LISTENER MAKES YOUR INBOX UNREACHABLE, AND NOTHING TELLS THE SENDER — so a retiring hub takes exactly one of two exits, never neither** (promised to a retiring peer 2026-08-12, unwritten until 2026-08-26; the seat that promised it retired without it): **(a) KEEP the listener armed until the successor confirms nothing is outstanding**, or **(b) SAY PLAINLY in the retirement broadcast that this inbox is now POLL-ONLY.** A `TaskStop` with neither leaves peers mailing a seat that will never answer, and their `mail-send` still prints a success ack — **delivery and readership are different facts and only the ack is visible to them.** A wrapping hub is done-for-now, not deaf: **stop the listener as the LAST action of the wrap, after the handoff is acked, never at wrap-start.**
- The fold-verify rule (A FOLD-VERIFY RE-DERIVES EVERY DISPOSITION, NOT ONLY THE BLOCKER) moved back to core Phase 3 step 5 on 2026-10-26.
- Broadcast a one-line retirement handoff (`--to all`): hub retiring + the successor state (see below) + the open loops (incl. any `DEPLOY-CLEAR`-but-unpushed verdicts → the deploy baton-holder) + the instrument state, so peers redirect new requests + nothing orphans.
- **⛔ NEVER retire into SILENCE — name the successor or declare the VACANCY explicitly (2026-07-26 incident).** "A fresh hub incoming" is prose that designates nobody: it used to leave every peer's `hub-discover` printing NOTHING, and that silence is the trigger for the fleet's most expensive failure — each peer independently reads "no hub", broadcasts, gets no ack (every peer is in the same state), and self-runs the SAME `--code` review with its own multi-agent panel. One review, N panels. The retirement broadcast MUST end in exactly one of:
  - **Successor CONFIRMED** — name the sid, and only after that peer has ACKED. Hand over open loops explicitly.
  - **VACANCY declared** — say so plainly and route peers to the one-writer election (`fleet-claim review-hub`; the claim is read back after writing, so ✅ CLAIMED means you hold it and a loser is told — never "first writer wins", which was never true of the write) — never to "self-review as needed", which is the fan-out in polite words.
  A retiring hub that cannot get an ack declares the vacancy; it does not soften it. `hub-discover` now prints a review-hub vacancy notice (`🚨 … VACANCY`) + the election command whenever zero hubs read LIVE and peers exist, so the vacancy is loud even if the broadcast is missed — but the broadcast is the primary signal and the notice is the backstop, not the plan.

## ⛔ RUN IT BEFORE YOU READ IT — I trace whether the code is RIGHT and never check whether it RUNS (2026-08-10, self-diagnosed; homed 2026-08-12 per a routing note)

**Verbatim, because the naming is the useful part: *"THE GAP IS METHODOLOGICAL AND I CAN NAME IT EXACTLY: I trace whether the code is RIGHT and never check whether it RUNS."*** A `--code` review reads for logic — the branch is correct, the predicate discriminates, the guard is live — and never asks the prior question: does this file execute at all? Two `ReferenceError`s on unbound identifiers survived BOTH my verdict AND a fresh-context breaker, because neither of us ran anything; they died only when an in-process `no-undef` arm landed.

**Rule: on any `--code` whose scope includes `.mjs` / `.sh` / any interpreted script, RUN it — or at minimum lint it for unbound identifiers — BEFORE reading it for correctness.** Reading-for-logic is what a reviewer is good at and it is downstream of a question a two-second lint answers. An unbound identifier is invisible to every careful read and fatal at first execution.

## ⛔ A REMEDY IS A HYPOTHESIS — mark it as one IN the verdict (at the hub's writing surface)

`behavioral-anti-patterns.md` #9 codifies the split; what belongs HERE is the verdict CONVENTION that follows from it. **A finding reads a system that exists; a remedy predicts a system that does not.** Finding a defect inspects what is there — that is where the review's authority comes from. Proposing a fix predicts the behaviour of code nobody has written, from LESS system knowledge than the author has.

The verdict format grants both the same authority, which is the trap. **So say which is which:** findings assert, remedies are labelled UNTESTED HYPOTHESIS. Measured cost of not doing it — two proposed fixes shipped as peers of their findings, both worse than what the author had, one a harm INVERSION; both planks conceded at `file:line` once challenged. A conceded plank is a healthy outcome, not a conflict — but only if the verdict flagged it as a prediction in the first place.

## ⛔ A DELEGATOR'S MUTATION EVIDENCE CANNOT SEE A SHARED FALSE PREMISE — the strongest verification in this repo is powerless against a wrong belief (2026-08-12, a delegator's finding, and it is theirs)

The hub routinely accepts a fold on mutation evidence: arm counts moving by exactly the arms added, single-arm attribution, inverse restores content-keyed both halves. **All of that is intact and was completely powerless here**, in their words: *"I pinned 'a pure-digit token is NOT a sha' with a mutation-pair, and it PASSED. It passed because the arm and the predicate under it were built from the same wrong belief. An assertion and a guard that share a mistaken premise agree with each other forever — the mutation is evaluated by the same belief that produced the error, so it cannot dissent."*

**The discipline measures whether an assertion RUNS and whether it DISCRIMINATES. It never asks whether it is TRUE.** Measured instance: a sha-shape predicate requiring a hex letter, pinned by a passing mutation pair, false-negating on 1.60% of all commits (80/5000 sampled; theory `(10/16)^9` = 1.46%) — including the very commit cited as its motivating example.

**What breaks the tie is an instrument OUTSIDE the belief**, and it is usually cheap: here, resolving candidate tokens through `git cat-file -t` instead of a charset test. **Check, when a fold arrives citing mutation evidence: what would this arm assert if the author's premise were wrong? If the answer is "the same thing", the mutation proves liveness and nothing about correctness — go find a ground-truth oracle.** Fixture REALISM is the aggravating factor, not a defence: a realistic sha has letters, so a letter-requiring bug is invisible to a realistic corpus. **The discriminating fixture is the ugly one.**

## ⛔ SHIPPING AN UNRECONCILED TENSION — a lens report that contradicts ITSELF, relayed with both halves intact and the conflict unflagged (2026-08-06, occurrence 2 in one session)

A hub's job is to resolve a report before it becomes a verdict. The failure mode is not dropping half of it (that is synthesis-dropout) and not characterising it wrongly (that is a separate recorded lesson — in both measured cases the hub's HEADLINE was CORRECT). It is **passing along two sentences from ONE report that cannot both be read naively, without naming that they need reconciling** — and letting the headline carry the weight while the raw halves ship underneath it.

**Both measured occurrences, ~3.5h apart, different reviews and different peers — independent threads, so this is occurrence 2 under the co-thread rule, not one incident counted twice:**
- A lens reported a mechanism note AND, separately, that the landmark the mechanism depends on **no longer exists**. The hub relayed the first without reconciling it against the second. *The refutation was inside the report it was synthesizing from.*
- A partition lens wrote *"Exactly 1 is a genuine present-state defect"* and, four paragraphs later, *"Net effect: none … the extended-field sweep adds ZERO genuine instances."* Both shipped. The delegator did the obvious thing — added them — and committed an inflated numerator to a file header.

**Why it is worse than relaying the wrong half:** a wrong half is one claim a reader can check. An unreconciled pair **looks complete**, so the downstream reader resolves it by the obvious operation and inherits an error neither party stated.

**The check, at compose time:** when two claims in one report bear on the same quantity, either reconcile them in the relay or SAY they are unreconciled. If you resolved the tension silently to write the headline, that resolution is the thing the recipient most needs and the thing you are least likely to include.

**Companion, from the same exchange — THE PEER'S HALF, named by them:** adding counts from two instruments without establishing the counted SETS ARE DISJOINT. The remedy that settled it is worth copying: a **pre-registered two-branch discriminator** — one query, both outcomes stated in advance with their consequences — handed to whichever party can actually run it.

**And verify your own CONFESSION.** The hub's first self-blame here named the wrong class ("I forwarded the reading that fit my summary"); grepping its own sent verdict showed it had forwarded BOTH and gotten the headline right. **The confessed class is what gets codified**, so an unverified over-confession mints the wrong lesson — Anti-pattern #1's accepting side applies to your own admissions, not only to a peer's correction.

## ⛔ A BRIEF'S PREMISES ABOUT THE **AUTHOR** ARE PANEL INPUTS TOO — and only the premises about the CODE ever get verified

When you compose a re-run or verdict-attack brief, you characterise not just the diff but the
person who wrote it — *"they conceded without checking"*, *"they folded on one reviewer's say-so"*,
*"this was rushed"*. **Those sentences enter the panel with exactly the same status as a claim
about the code, and nothing in the pipeline grounds them.** A breaker sent at *"the author folded on
one reviewer's say-so"* attacks a strawman, and whatever it concludes **launders that premise back
out as a finding** — now wearing the panel's authority.

Measured 2026-07-30: a re-run brief told the architect breaker that three findings
had been *"ALL CONCEDED WITHOUT A CHECK."* False — three of the four legs had been verified at
source (`charter:16-20`, the comparison record, an independent runtime-registry corroboration) and
only one was accepted on reasoning. The reviewee intercepted before the panel converged.

**Rule:** before sending, separate the brief's claims about the DIFF from its claims about the
AUTHOR'S PROCESS, and either cite the second kind at `file:line` / a quoted mail, or delete it. The
breaker needs the diff and the question — it does not need your read of how carefully the author
worked, and supplying that read is how a wrong one becomes evidence. Kin: the strawman-check
for a brief that mis-frames the *user's* proposal, and the rule against a gauntlet laundering an
untraced premise; neither covers a peer REVIEWEE's verification process, which is the axis nobody grounds.

## The hub CONSUMES the range — it does not wait to be asked

**Iron law: a peer's `--code` request naming N commits is authorization to review all N.**
After sending a verdict the next action is the NEXT COMMIT IN THAT RANGE — never a closure
statement, never an idle report. Stop only when the range is empty or the owner redirects.

- **Never** end a hub turn with "queue empty" / "nothing needs you" derived from MAIL state.
  Derive from COMMITS: declared range minus reviewed. >0 ⇒ say the number and keep going.
  Measured failure: 0 unanswered requests reported as an empty queue while 17+ delegated
  commits sat unreviewed; it took three pings in one session to surface it.
- "Say the word and I'll take the rest" is a defer. The word was said at delegation.
- ⛔ **AND THE COMMITS-NOT-MAIL RULE ABOVE HAS ITS OWN BLIND SPOT — IT CANNOT SEE A REQUEST YOU NEVER OPENED (measured 2026-08-06, TWO hubs in one handoff, same direction).** That rule exists to stop a real failure (reading "0 unanswered mails" as an empty queue) and in fixing it points AWAY from the mail store — but a delegation that was never read has no declared range to subtract from, so a commits-only derivation is structurally blind to it. **A queue derivation must ENUMERATE THE STORE'S INBOUND *and* reconcile the commit range. Neither alone is sufficient.**
  **Both seats failed it and both named it better than the rule did.** The retiring hub certified *"UNREVIEWED QUEUE: EMPTY. Explicitly, and derived… from the mail store this turn, not from recall"* — and its own account of what it actually ran: *"I grepped for the SHAs of the waves I remembered serving, and for deploy-clear tokens. I never enumerated the store's INBOUND. So the derivation confirmed what I already believed and could not surface what I had never seen."* Its one-liner is the rule: **a queue derivation must LIST INBOUND, not VERIFY OUTBOUND — mine did the second and called it the first.** A peer sharpened the general form: **"derived, not recalled" bounds the SOURCE and says nothing about the SET — both halves need naming: derived from WHAT, enumerating WHICH population.**
  **Cost, measured:** a 4-commit wave with a serious security finding stranded 40 min on the retiring hub (never opened, omitted from a handoff that named two other peers), then a further 4 hours on the successor, which had the self-contained resend in its own store and reported a clear queue four times. A plain question about pending reviews is what surfaced it; `mail-check --peek` answered in one call.
  **⚠️ AND BOUNDING YOUR RECALL HONESTLY IS WHAT MAKES THE SENTENCE FEEL SAFE.** The retiring hub disclosed three compactions and correctly refused to trust its memory. That disclosure is good practice and it did not help: the substitute instrument was shaped by the same blind spot. Naming a source as untrustworthy does not validate whatever you reach for instead.
  ⛔ **AND THE INBOUND ENUMERATION IS ITSELF WINDOW-BOUNDED — THE STORE PRUNES, SO IT IS NOT AN ARCHIVE (verified at source 2026-08-06, `scripts/session-manifest.py:104` `MAIL_READ_TTL_HOURS = 24` · `:107` `MAIL_UNREAD_TTL_HOURS = 72`).** A peer bounded this sweep within minutes of it going out, and the evidence is decisive: mail from that seat to the retired hub currently in the store = **0**, while verdicts it holds FROM that hub = **5**. Both cannot be true of a complete store — the requests existed and were pruned.
  **The direction is the cruel part: the failure mode you are hunting has the SHORTER TTL.** A stranded-and-never-read request survives 72h and then becomes ABSENT — indistinguishable from never-sent. A request that was READ and never answered is gone at **24h**. So a store sweep reaches ~24h for the read-not-answered shape, not the ~4h of whatever incident prompted it, and a clean enumeration past that window means nothing at all.
  **So the BROADCAST is the primary instrument and the enumeration is the secondary one** — only the SENDER still knows what they asked for, and their transcript outlives the store. Ask; enumerate only to seed the ask. Stating a clean enumeration as though it bounded the queue is the same defect one level up: an instrument that is incomplete not by a missed file but by a DELETED one.

  **Disposition is the SENDER'S to give, never yours to infer:** unread-on-disk is NOT unhandled (one unread item here had a full 5-lens verdict sent). When the store cannot answer, broadcast a claim-or-disclaim and let each seat classify its own outbound — that sweep returned 8-of-9 handled plus the one real loss, in two replies.
- **Re-derive the range at pickup**, never quote the request — the declarer keeps committing,
  so a supplied denominator is stale on arrival (a declared 13 was ≥20 hours later). Report
  `≥N`: a transcript creation-record PRESENT proves authorship, ABSENT proves nothing.

## Assert a known member BEFORE trusting a population — the positive control

**A population you derived is a claim about a SET, and a set can be silently incomplete.**
Every enumeration in a review — coverage sweeps, sibling sets, call-site lists, key populations —
gets one line before its size is used: *assert that a member you already know belongs is in it.*
A derivation that excludes a key you were citing as the standard is not a rare failure; it
happened to three independent seats on one small question (2026-08-02).

**Measured on this hub, one night, five occurrences — all caught by re-reading, none by method:**

| the probe | why it returned a false empty/short set |
|---|---|
| `rg -ln 'from "<library>"'` | missed a dynamic `(await import("<library>"))` reacher |
| `rg … \| head -8` | truncated 3 of 4 gated files → a false serious finding, "the gate is called from ONE service" |
| `--include=*.sh` unquoted | zsh ate the glob; 0 consumers reported on a token the emitter itself contains |
| `hits[:12]` listing | declared a peer's cited key "does not exist" |
| `'"{' in value` | blind to keys whose EN is already `“{arg}”` |

**The tell is that none of these were careless.** Each probe ran, exited 0, and returned a
well-formed answer. The failure is invisible from inside the result — which is precisely why it
needs a control rather than more attention.

**Cheapest forms, in order:** the emitter is a free needle (a grep for a token MUST find the file
that emits it — zero is structurally impossible); a known member you can name before running;
two instruments blind in OPPOSITE directions both returning empty. Re-running the SAME probe is
not a control — a borrowed instrument reproduces its author's blind spot and returns a confident
N=2 that is one observation counted twice.
