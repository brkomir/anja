---
name: summary
description: Mid-session state readout — where THIS session has landed, what is blocked on the owner, what is still in flight. Use when the owner asks where things stand mid-session, especially in long multiday sessions after compactions. Every number derived live, never restated from context. It writes exactly one artifact — this session's working plan — and may update ANY part of it, the derived fence and the hand-written sections alike, correcting in place rather than regenerating.
---

# /summary — where this session has landed, right now

**Mid-session**, owner-facing state brief. Answers the question a long session actually
raises — where this session now stands — not the
story of how we got here, but the **net position** and **what needs the owner**.

**State-query — carries its own marker `[summary]`** (every reply is marked; same family as `/status`, `/peers`, `/flows`).
One-shot; no commits, no mail, no tracker edits. ⛔ **It writes ONE artifact — this session's
working plan — and nothing else on disk moves.** Inside that file it may write ANYWHERE:
the derived fence in §6 AND the hand-written sections around it. **It may update the working
plan without limits — this replaced an earlier fence-only rule after a plan sat two days stale
through two `/summary` runs that were each behaving exactly as specified.**

⛔ **THE REMOVED LIMIT IS ABOUT REACH, NOT ABOUT METHOD — CORRECT IN PLACE, NEVER
REGENERATE.** The fence was never a limit on `/summary`'s usefulness; it was a guarantee that a
measurement pass could not silently overwrite judgment somebody hand-wrote — a closability
verdict, a review ledger, an owner ruling quoted verbatim. That guarantee is now yours to keep
by discipline instead of by structure, and it is the plan file's own standing convention:
**a correction REPLACES the text it corrects, rows
are edited IN PLACE and never deleted or aged out, and closure is a dated status flip.** Rewrite
a hand-written section only where it is WRONG, and say what it used to say when the owner could
have acted on the old version. **Deleting a section because this run did not re-derive it is the
one outcome the old fence made impossible and this widening does not license.**

## Distinctions — what this is NOT

| Command | Scope | Timing |
|---|---|---|
| `/status` | **Project** trackers — `git status --short`, tracker counts, plan docs, migrations | any time |
| `/orient` | **Session start** — inbound mail, drift sentinels, peer scan, blindspot prime | session START |
| `/wrap` | **Session end** — the persistence + hanging-work gauntlet, writes to memory/trackers | session END |
| `/peers` | **Who** is working in the repo and on what | any time |
| **`/summary`** | **THIS session's net state** + the owner-decision queue | **mid-session** |

`/status` answers "where is the *project*." `/summary` answers "where is *this session*,
and what do you need to decide." They overlap on git and diverge everywhere else.

## Iron rule: DERIVE, never RESTATE

**Every number, path, sha, and state word in the output must come from a command run
THIS invocation.** Not from the conversation, not from a prior turn's output, not from
a compaction summary, not from the context header.

This is the whole reason the command exists: on 2026-07-27 five sessions produced **nine**
restatement errors in one night, every underlying measurement clean — the RESTATEMENT step is
where they broke. The five error shapes: `references/cases.md` (not in this copy, nor at any later mention) § Iron rule.

### The population rule — every count declares FLEET or THIS SEAT (2026-08-17)

**The Iron rule governs whether a number is FRESH. This governs whose it is, and until
2026-08-17 only §1 enforced it.** The owner talks to one seat; the repo is written by many.
So every instrument this command reaches for — `git log`, `todo.txt`, `BACKLOG.md`, the mail
store — answers a FLEET question by default, and reporting its output as this session's work
is the single most likely way this readout misleads.

**No count reaches the owner without naming its population.** Where the two differ, give both
("1,030 unpushed, ≥139 mine"). Where the instrument cannot separate them, say that instead of
picking one.

⛔ **A PREDICATE THAT SOUNDS SEAT-SCOPED IS THE DANGEROUS CASE, NOT AN ABSENT ONE** — an absent
instrument prompts you to go find one; a confident wrong one does not (measured DISJOINT from the
truth: 9 rows returned, 0 the reader's own). **Scope on the SEAT ID
(`${CLAUDE_CODE_SESSION_ID%%-*}`), never on a first-person word**, and prefer a field the WRITER
stamped (`filed: by <sid>`) over one the reader interprets. Story: `references/cases.md` § The
predicate family.

### The capped-instrument rule (learned the same night, 4 sessions)

**Never read the `gitStatus` block in the context header.** It carries its own notice —
*"(truncated because it exceeds 2k characters)"* — and its silence is the cap, not the
tree. Four sessions cited it as certification that night; it bit two of them and spared
the other two. A clean result from a capped instrument generates no signal, so it never
gets challenged — which is why the observed failure rate understates this class by
construction.

The margin that spares anyone is structural (tracked-first block ordering), and it ERODES as
tracked `.claude/*` paths sort alphabetically ahead of the targets — exactly what a heavy meta
session produces (mechanism + measured margins: `references/cases.md` § Capped instrument).

Run `git status --porcelain` fresh. Same discipline for any capped source: if a check
must use one, **measure where the cap falls relative to the targets before trusting a
negative** — and say so.

## RETIRED — the Receipts row (heading kept only to be findable)

⛔ **RETIRED, because the receipts went unread — the readout no
longer ends with a `Receipts:` row; an unverified number says so IN its own sentence.** §1-§5 still DERIVE
everything, which was always the load-bearing half. The retired form + its panel provenance:
`references/cases.md` § Receipts row.

## Process

Run these, then compose **only** from their output.

### 1. Git — pushed vs committed-unpushed vs dirty

```bash
git fetch origin 2>/dev/null                       # ⛔ FIRST — `origin/main` is a LOCAL ref and does not self-update
git log --oneline origin/dev..HEAD | cat           # unpushed: committed here, not yet on GitHub's dev
git log --oneline origin/main..HEAD | cat          # unpromoted queue: not yet in production (WHOLE fleet, not just you)
git status --porcelain                             # dirty tree — never the context header
git log -1 --format='%h %s (%cr)' | cat            # HEAD
```

- ⛔ **THE FETCH IS NOT OPTIONAL.** `origin/main` is a **local ref**; nothing refreshes it
  (measured five days stale once), so a fresh command over a stale ref is still a stale answer —
  and the error is invisible, because a large number is exactly what a long unpushed queue looks
  like. Full incident: `references/cases.md` § 1.
- Report each queue as a **count + the subset that is THIS session's**. On a shared branch
  the queue contains peers' commits; attributing all of them to this session is the
  restatement failure in its most common form.
- To split yours from theirs, derive from the **jsonl creation-records**, NOT from your
  tool-call history and NOT from `git log --author` (the whole fleet commits as the owner).
  Grep this session's transcript for git's own `[dev <sha>]` confirmation lines (sessions commit on `dev`; the pattern below also takes `main` and a detached HEAD), resolve
  each with `git rev-parse`, and set-intersect against `git rev-list origin/main..HEAD` (the UNPROMOTED set, deliberately wider than unpushed, so your commits already pushed to `dev` stay in it).

  ⛔ **RESOLVE FIRST, IN ONE PASS, AND NEVER `2>/dev/null` THE BATCH — TWO INDEPENDENT BUGS
  COMPOUND HERE INTO A CLEAN ZERO THAT SKIPS EVERY GATE BELOW IT (measured 2026-09-05, three
  runs, `/wrap` Steps 5b/5c/5e).** *"Resolve each with `git rev-parse`"* names the right verb and
  does not say what happens when one FAILS, which is the whole defect:

  1. **THE EXTRACTION MATCHES ITS OWN DOCUMENTATION.** `[main <sha>]` appears in prose ABOUT the
     format as readily as in git's output, so a session that WRITES THIS RULE DOWN plants live
     instances in the corpus the probe globs. Measured: **2 of 34** extracted shas were
     `[main 3b6c6c4]` and `[detached HEAD 8525491]` — examples typed into that session's own
     comments hours earlier. The self-contaminating-probe class (`bash-environment.md`), reproduced
     by the one file most likely to quote the pattern.
  2. **ONE UNRESOLVABLE ARGUMENT ABORTS THE WHOLE `git show`.** Batching the set —
     `xargs git show --numstat --format='' --no-walk` — is correct and fast, but a single bad sha
     yields `fatal: ambiguous argument '<sha>'` on **stderr** and **zero bytes on stdout for all
     34**. With `2>/dev/null` the pipeline prints a clean `0`, indistinguishable from *"this seat
     touched no paths"* — and that reading makes every path-conditioned gate skip. **It fails on
     the passing side**, which is the direction `bash-environment.md` § WRITE A GATE SO INSTRUMENT
     FAILURE LANDS ON THE FAILING SIDE exists to forbid.

  **The form that works** — one process for the resolve, no per-sha subprocess, no timeout risk
  (a 34-sha `merge-base` loop had already blown the 120 s Bash cap twice):
  ```bash
  sed '/^$/d' mine.txt | sed 's/$/^{commit}/' | git cat-file --batch-check > resolve.txt  # ONE process
  grep ' commit ' resolve.txt | cut -d' ' -f1 > good.txt                     # keep what resolves (cut, not awk)
  N=$(grep -cvE '^[0-9a-f]{40}$' good.txt); [ "$N" != 0 ] && { echo "GOOD-LIST HOLDS A NON-SHA — the extraction broke, NOT a real list" >&2; exit 1; }  # a COUNT, never -qv: the Bash tool's grep shim inverts -q+-v together
  grep 'missing'  resolve.txt                                               # READ these — see (1)
  [ -s good.txt ] || { echo "GOOD-LIST EMPTY — instrument failure, NOT a real zero" >&2; exit 1; }
  git show --numstat --format='' --no-walk $(cat good.txt | tr '\n' ' ')    # stderr NOT suppressed
  ```
  ⛔ **THE `[ -s good.txt ]` GATE IS LOAD-BEARING AND IT WAS MISSING FROM THIS RECIPE'S FIRST
  VERSION — WITHOUT IT THE BROKEN CASE RETURNS A CONFIDENT *WRONG NON-ZERO*, WHICH IS WORSE THAN
  THE FALSE ZERO THE RECIPE EXISTS TO FIX.** If every sha fails to resolve, `good.txt` is empty,
  the `$(...)` supplies NO operand, and `git show --numstat --no-walk` falls back to **HEAD** —
  so the derivation reports whatever the fleet's newest commit happens to touch as *this seat's
  paths*. Measured 2026-09-05 against an empty list: it returned a numstat line for a rules file
  and a line for a peer's session plan, both from a PEER's commit, rc=0, no stderr. This is
  `.claude/traps/shell-traps.md` § NEVER INTERPOLATE A POSSIBLY-EMPTY LIST INTO A SCANNING COMMAND, and
  `xargs` does NOT rescue it — BSD `xargs` runs the command once with no arguments on empty input
  and has no GNU `-r`. **Found by asking the one question the author had not
  listed: is the fixed instrument's OUTPUT distinguishable from the failure it replaces?** It was
  not. A derivation that returns a plausible answer for a real reason and a plausible answer for a
  broken reason has fixed nothing — it has only moved the lie.
  ⛔ **AND THE TWO BUGS ARE NOT INDEPENDENT — THE SECOND ONE'S FIX HAS A HOLE SHAPED LIKE THE
  FIRST.** The empty-list branch fires
  exactly when NOTHING resolves, and bug (1) is the thing that produces that state: a session
  that writes ABOUT the `[main <sha>]` format and commits little extracts mostly documentation
  instances, all of which are missing, so `good.txt` empties and the recipe confidently reports
  HEAD's paths as that seat's. **So the reachability of that serious defect is not incidental — the population
  most likely to hit it is a meta-heavy session, which is the population this derivation exists
  to serve.** This was reached by EXECUTING the recipe in a throwaway repo with controls in
  both directions rather than reading it, and the measured arms (`zsh` and `bash`, identical)
  match the ones recorded above.
  ⛔ **AND DEMAND THE POSITIVE CONTROL BEFORE READING ANY NUMBER: `git show --numstat --format=''
  --no-walk <a sha you know is yours>` must return its files.** Three successive runs reported
  `paths this seat's commits touched: 0` and the derivation was believed broken in three different
  wrong ways before anyone ran that one command. **A `missing` line is a FINDING, not noise** — it
  tells you the extraction is over-broad, which is the bug you would otherwise never see.
  ⛔ **BUT A *BODILESS* `^{commit} missing` LINE IS NOT THAT FINDING — IT IS AN EMPTY INPUT LINE,
  AND COUNTING IT OVER-STATES YOUR EXTRACTION'S BREADTH.**
  A blank line in `mine.txt` becomes a bare `^{commit}` after the peel, which `--batch-check` reports
  as `missing` exactly like a real unresolvable sha: measured, `printf '%s\n\n' "$A"` yields one
  `commit 117` line and one `^{commit} missing`. The `sed '/^$/d'` above removes the cause; read any
  surviving `missing` line for a SHA in front of it before treating it as evidence about the grep.
  ⚠️ **TWO WORRIES THIS RECIPE CARRIED, ADJUDICATED BY EXECUTION — one refuted, one confirmed and
  sharper.** The ANNOTATED-TAG worry does NOT hold, and the reason is the `^{commit}` peel itself:
  it dereferences the tag before `--batch-check` reports a type, so the type IS `commit` and the
  `grep ' commit '` keeps it (`printf 'v1\n' | sed 's/$/^{commit}/' | git cat-file --batch-check`
  → `… commit 165`). **The peel does more work than this text used to credit it with — do not
  "harden" it away.** The FIELD-SPLITTING worry is real and its obvious fix is destructive: the
  unquoted `$(cat good.txt | tr '\n' ' ')` is **DELIBERATE**, because zsh DOES split command
  substitutions even though it does not split parameter expansions — the distinction this fleet's
  own `$VAR`-does-not-word-split rule omits. Quoting it does not degrade silently, it dies
  (`fatal: ambiguous argument '<sha> <sha> '`), so the hazard is a reader applying that rule and
  "fixing" the working form into a fatal they then blame on the shas.

  **Why not tool-call history: it is CONTEXT-BOUNDED** — after a compaction it silently becomes
  a WINDOW count reported as a session total (measured ≥38% miss on a 13-compaction session).
  The `Claude-Session:` trailer is TOOL-stamped at the commit choke point.
  Both incident chains: `references/cases.md` § 1.

⛔ **DO NOT REPORT A PER-SESSION COMMIT COUNT TO THE OWNER AT ALL — and
the instrument this section used to prescribe is RETIRED (see below). Report the FLEET unpushed
count, which is honest and needs no attribution, and describe what this session DID in prose.**
The number served no decision the owner makes, and every instrument that produces it is a floor
presented as a count — so the cheaper fix is to delete the claim rather than keep repairing it.

⛔ **NEVER FILTER A COUNT ON THE `Claude-Session:` TRAILER — the instrument that did is RETIRED.**
A URL-form trailer value is common and session-clustered (103 of the last 300 commits on 2026-09-25, from 5 sessions — re-derive before citing) (a hand-written value WINS over the tool stamp), so
an exact 8-hex compare reads a compliant seat as having done nothing; and "there is no range
expression that isolates a session here — the isolation is SEMANTIC, not syntactic" (`/wrap`).
**The trailer itself STAYS** — for peer disclosure and as a PARTITION; retired only as an identity a
count can filter on. Full post-mortem: `references/cases.md` § 1.

  **Two bounds, both load-bearing.** The trailer records who RAN `git commit`, never whose WORK
  is in it, and only when the body was silent — it PARTITIONS, never identifies an author. The
  creation-record survives compaction but is **sound in ONE DIRECTION ONLY**: PRESENT ⇒ strong
  evidence; **ABSENT ⇒ NOTHING** (measured: 16% of unpushed commits have no creation record in ANY
  transcript, all authored by somebody). No exact attribution instrument exists here — five tested,
  five with measured holes. **Say "≥N mine", a FLOOR, never a total.** Measurements:
  `references/cases.md` § 1.

  ⛔ **THIS IS AN OPEN LIST, AND A FOURTH MECHANISM DELETES THE RECORD BY CONSTRUCTION — NOT A
  HABIT, SO NO *TRANSCRIPT* DISCIPLINE RECOVERS IT.** The private-index recipe (`git commit-tree` +
  `git update-ref`, prescribed in `active-recall.md`'s commit row and `bash-environment.md`)
  moves HEAD and prints NOTHING: there is no confirmation line to preserve. **The blindness is
  selective in the worst direction** — that recipe is reached for precisely when a shared
  contended file is in play, so it hides the highest-traffic commits. Measured in scratch;
  this spec mentioned it zero times before. **Do not close this count
  again**: it was written as three, and its own domain refuted it.
  ✅ **BUT "NO DISCIPLINE RECOVERS IT" WAS TOO STRONG AND IS CORRECTED 2026-09-02 — THE REFLOG
  SEPARATES THE TWO ROUTES, FLEET-WIDE, AND THE REMEDY HAD BEEN FILED SINCE 2026-09-01 WITHOUT
  EVER BEING LINKED HERE.** `git reflog --format='%h %gs'` labels an ORDINARY commit
  `commit: <subject>` and a private-index one with the bare `update-ref -m` text, because the two
  routes write different reflog messages by construction. Demonstrated live on this seat's own
  commit the turn this correction was written: a private-index entry (bare message) sat
  directly above an ordinary `commit: <subject>` entry, in one `-20` window.
  ⚠️ **It recovers the COMMIT, not the AUTHOR** — the reflog is fleet-wide and per-repo, so it
  tells you a private-index commit happened and gives you its sha and message; pairing that to a
  SEAT still needs the `Claude-Session:` trailer, which `commit-tree` drops unless you put it in
  the `-F` message file. So this narrows the blindness from total to attributional, which is the
  same bound every other instrument in this section carries. **The failure here was not the claim, it was
  that a filed remedy and a declared-unanswerable question sat in the same repo for a day and
  never met** — when you write "nothing recovers this", grep the tracker for the thing that does.
  ⛔ **THREE HABITS DELETE IT TOO, AND EACH READS AS TIDINESS.** `git commit`'s own
  `[main <sha>]` confirmation line IS the creation-record, so: **never pipe a commit through
  `tail`/`head`** (cuts the line — a commit you authored goes invisible to your own next
  `/summary`); **never redirect its stdout** (discards it wholesale, commonest on an `--amend`);
  **never `-q`** (suppresses it at the source — measured on adjacent commits: without `-q` 2
  records, with it 0, three of three). All three share one shape: **a channel silenced for
  readability is a channel deleted**, discovered only by a later session that cannot explain its
  own missing work. TELL for the worst one: `-q` gets adopted inside a careful multi-command
  gate — the more disciplined the ceremony, the more likely it is in it.
  Rules that survive whatever moves: **in an instrument's own docs, DESCRIBE a matched form,
  never render it** (a rendered instance contaminates every future reader's transcript — this
  file loads on invocation); **key a `--verify` line to STRUCTURE, never a bare token**; and
  **a forbidden-pattern check ships with its needle, or it is decoration** (a 0 from a correct
  pattern and a 0 from a typo'd one are the same character). Control table, both use-vs-mention
  near-misses, and the 19×`-q`/296-floor incident: `references/cases.md` § 1.

### 2. The owner-decision queue — the section the owner came for

One line per item blocked on the owner, named by what it changes (§ Output shape, the register paragraph). Each line: **what** · **why it needs them**
(taste call / external fact / irreversible action) · **what happens if they say nothing**.

⛔ **THIS-SEAT ITEMS ONLY — a fleet-wide list in one session's readout is confusing, because the
owner cannot act on it in that moment, so fleet items get their own field, each tagged with its
peer.** §2 carries only decisions arising from THIS session's own work. An
owner-pending item another session filed or is carrying (a post-deploy check, a peer's blocked
deploy) goes to the **`Next — fleet:`** line in the output shape instead — one compact clause per
item, each tagged with its ORIGIN session's NAME (sid8 only when it has none), no elaboration. ⚠️ **The split is by ORIGIN, not
importance — anything that comes up fleet-wide needs the owner's attention by default.** A fleet item still carries the owner's
default attention; what the split buys is that they can tell what THIS session's work asks of them
from what the fleet is raising, instead of one undifferentiated list. The derivation discipline is
UNCHANGED (derive each
fleet item this invocation; the owner-deferred suppression + marker rule binds fleet items too) —
only the PLACEMENT moved. The origin tag is the half that was missing when this rule was made: an
unattributed fleet relay in the plan table read as this seat's own work. ⚠️ The capability fact below now spans §2 PLUS the `Next — fleet:` line together — moving a
fleet item there satisfies it; DROPPING one entirely deletes the only surface that raises it.

Sort by *cost of waiting*, not by age. An item that fails silently outranks one that
merely sits. If a decision has been surfaced before and not answered, say how many times
— without editorializing about it.

⛔ **AN ITEM THE OWNER HAS EXPLICITLY DEFERRED IS NOT A QUEUE ITEM — DROP IT FROM §2 AND FROM
FREE-FORM CLOSERS FOR THE REST OF THIS SESSION.** Re-listing converts their
answer into a question they must answer again. **And WRITE THE DEFERRAL ON THE ITEM'S OWN DURABLE
ROW, IMMEDIATELY** — `⏸ owner-deferred YYYY-MM-DD — "<verbatim>" → resurface next session` on the
`todo.txt` row or `IDEAS.md` entry. ⛔ **CAPABILITY FACT: `/summary` §2 is the ONLY surface in the repo that enumerates owner-pending
items** — `/orient`, `/wrap` and `/hanging-work` carry no owner-decision step (verified by grep), and
the fleet board (`/board` and `scripts/fleet-board.py`) only COUNTS rows carrying the
`owner-pending:` token or an alias (it names no item), so an unwritten deferral is raised by NOTHING,
ever. The written marker is the carrier. Recurrence story + the verification: `references/cases.md` § 2.

⛔ **AND THE SUPPRESSION IS SCOPED TO WHAT THE DEFERRAL NAMED — uncertainty REPORTS.**
Suppression covers only the items the deferral NAMES, in the session where it was said. If you
cannot name the utterance and the items it covered, the item is NOT deferred — report it.
Without this the predicate is a recall question with no durable input and no default, which
post-compaction is the normal state: a careful reader concludes almost nothing qualifies, a
careless one pattern-matches "later" and suppresses the wrong item. The default has to point at
REPORTING, the safe direction — and the marker above is what makes the question answerable from
disk instead of memory (the entry this sits under ends "the answer is always on disk").
Never silently drop it from disk — the deferral is to a session, not to oblivion.

⛔ **DERIVE EVERY ITEM, PER ITEM, THIS INVOCATION.** A section with no command gets RECALLED
while its siblings get derived — same message, same composer, same discipline (measured: an item
asserted "still waiting on you" across four turns after a peer had closed it 3.5h earlier with a
sharper diagnosis; incident: `references/cases.md` § 2).

Run all four per candidate. An item that survives all four is a queue item; an item that fails any
one of them is **closed** — say so, and do not carry it:

```bash
# 1. ANCHOR — where does it live? No durable home ⇒ that is the finding, not the item.
grep -nF '<ROW-NAME>' todo.txt            # or DECISIONS.md / plans/<doc>.md / BACKLOG.md / IDEAS.md
#    ⛔ IDEAS.md is IN the list: an owner-deferred pipeline idea lives ONLY there, so omitting it
#    made check 1 return nothing and the gate rule it "closed" — the memory hole reached by
#    process rather than by deleting a byte.

# 2. STATE — read the checkbox NOW. `[x]` closes it however recently you surfaced it.
#    Read the whole ROW, not the matched line: rows run ~7 lines and the tail carries done-when/owner.
awk '/^- \[[^]]*\] <ROW-NAME>/,/^- \[/' todo.txt | head -20

# 3. PEER CLOSURE — WHEN/WHO closed it. Step 2 decides WHETHER; this only dates it.
#    -G, NEVER -S. Closing a row flips `- [ ]` -> `- [x]`, which does NOT change the row
#    NAME's occurrence count, so -S is blind to the close — and it does not return empty,
#    it returns the commit that ADDED the row: a plausible, non-empty, exactly-wrong sha.
#    Measured on a 3-commit scratch repo (add/close/reword), 2026-08-14:
#      -S '<NAME>'            -> add only          (hits on the close: 0)
#      -G '^- \[x\] <NAME>'   -> close + reword    (excludes the add)
#    -S and -G are both case-sensitive BY DEFAULT and BOTH DO honor -i (measured on git
#    2.50.1: a lowercase probe reads 0 against ALLCAPS content, -i restores the exact-case
#    count, --pickaxe-regex NOT required). This line read "-S takes no -i" until 2026-08-16,
#    which is false — but it never mattered here, because the reason to use -G is the
#    blindness above, not case. Row names are ALLCAPS; type them that way or pass -i.
git log --oneline -5 -G '^- \[x\] <ROW-NAME>' -- todo.txt | cat
git log --oneline --since='<when you last measured>' -- <path the item cites> | cat

# 4. QUANTITY — recompute any number the item carries. Never carry one forward.
```

**Step 2 is what decides; step 3 is the one you will skip** — because an item you surfaced feels like yours to
report on. It is not: on a shared tree the actor who closes your queue item is usually a peer, and
they close it without telling you. **"Surfaced N times" is itself a claim** — derive it or omit the
count; never estimate it.

Empty queue is a valid, good answer. Say "nothing is blocked on you" and move on.

### 3. In-flight work

```bash
python3 scripts/session-manifest.py mail-check --peek 2>&1 | head -20
```

**`--peek` is load-bearing — a bare `mail-check` CONSUMES (renames `.md` → `.md.read`).** This command
was bare until 2026-07-29, which made a command that declares *"no writes, no commits, no mail"* silently
archive every unread inbound it surfaced. Measured: a `/summary` run consumed three unread messages from
one peer; had this session not gone on to act on them, they would have been marked read and would never
have re-surfaced at the next `SessionStart` — the exact "archived-then-never-acted" loss `/wrap` Step 0
documents when it explains why IT uses `--peek`. A read-only command must never consume a queue.

- Background agents / monitors still running (from this turn's task state).
- Delegated `--code` reviews awaiting a verdict — **procedure in §3b, which is not optional.**

### 3b. QUEUE POSITION — every review this seat SENT, and whether the hub needs a nudge

⛔ **Check the queue position of every pending review request, and nudge the hub where needed, as
part of `/summary` (or `/working-plan`), so the owner never has to ask whether the hub needs a
nudge.** The bullet above has named this since the command existed and carried NO procedure, so it
was never derived and had to be asked for. This is the procedure.

**Three reads, in this order. The third is the one that was missing and it is the one that matters.**

1. **The fence's `Derived state — reviews this seat sent` list** — PENDING / VERDICT-ON-MAIL-ONLY /
   LEDGERED per sha. It is a FLOOR (a request whose mail aged out before the fence first saw it was
   never carried) and MONOTONE (a row cannot regress), so it opens the question and never closes it.
2. **For every PENDING row, the hub's own last word** — their newest mail to this seat, and their
   plan file's newest queue enumeration if they keep one. An ACK that names a POSITION ("queued,
   next in the group after X") is an answer; an ACK that names only the sha is not.
3. ⛔ **FOR EVERY PENDING ROW, OPEN YOUR OWN OUTBOUND AND READ THE REQUEST SENTENCE.** A sha
   MENTIONED in a mail is not a sha REQUESTED, and **no closure instrument on either side can tell
   the two apart** — both key on the sha. Measured 2026-09-13: two shas sat in this seat's plan as
   *"still with the hub, unreviewed"* and were reported to the owner twice as open items, when the
   outbounds that name them say *"is prose only and I am not asking for a lens on it"* and *"I am
   not asking you to re-verify the other seven."* **Neither was ever requested.** The hub had
   carried both onto its open list out of courtesy, and this seat then wrote that courtesy into a
   durable row. **The discriminator is the request sentence, never the sha.**

**THE NUDGE RULE, and it resolves toward NOT nudging:**

- Request sentence absent ⇒ **there is no queue position.** Correct your own row, and tell the hub
  to drop it — they may be holding work you never asked for.
- Requested, and their last word names a POSITION ⇒ **no nudge.** Restating an ask they have already
  placed is a chase, and the hub is load-bearing for the whole fleet.
- Requested, no ack on either plane ⇒ **nudge**, once, subject leading with the ask.
- ⛔ **RUN THE REVERSE DIRECTION TOO — `node scripts/review-request-closure-scan.mjs` — BECAUSE THE
  OPEN LOOP IS ROUTINELY YOURS.** It scans requests sent TO this seat and flags any whose shas this
  seat never cited back. On the same 2026-09-13 run a day-old verdict turned up whose serious findings had been
  folded in the code and never reported, so the hub had held the last word for a day on a loop that
  was closed. **The question is whether the hub needs a nudge; the answer is more often
  "no, and you owe them a fold report."**

- ⛔ **AND A SHA-KEYED REQUEST SCAN IS BLIND TO TWO WHOLE CLASSES — RUN THE PROMISES INSTRUMENT AS
  WELL: `python3 scripts/hub-open-promises.py`** (it reads YOUR OWN sent mail and works from any
  seat, not just a hub). The request scan answers *were my requests answered*. It says nothing about
  **whether my FOLDS were verified**, and nothing about **an obligation I volunteered in prose** —
  and the volunteered kind is the dangerous one, because the sentence that creates it is usually in
  MY outbound, where no closure instrument looks. **If you run
  only the request scan, it reads clean in exactly the state both seats were in that day.**
  ⛔ **READ ITS ROWS, NEVER ITS COUNT — IT IS MAIL-ONLY, SO A PROMISE DISCHARGED BY A NON-MAIL ACT
  READS OPEN.** A lens you announced and then actually DISPATCHED, a fix you announced and then
  COMMITTED, a row you said you would file and then FILED — the delivery happened off the mail
  plane, the tool cannot see it, and the promise reports OPEN. It says so in its own caveat and
  reports a FLOOR. Demonstrated live the hour this was wired: two OPEN rows, both lenses
  already dispatched, both cleared by reading the rows. **Reporting that count
  to the owner would manufacture exactly the phantom item this whole section exists to prevent —
  the false-positive direction is cheap and self-clearing; the SILENT direction is what cost two
  seats a day.**

**Report it in the readout even when it is empty** — *"nothing of mine is queued with the hub"* is
the sentence that stops the owner having to ask, and it is only worth anything when all four reads ran.

⚠️ **ONE THING THE SAME EXCHANGE GOT WRONG, KEPT BECAUSE THE SHAPE RECURS:** a correction then
arrived saying the closure scan read 0 OPEN and had never flagged this — measured at the
corrector's ref, AFTER this seat's fold report had cited both shas and closed the row. It HAD been flagged: `1
unanswered` naming both, before the fold; `0` after. **A correction that relieves you is still a
claim, and an absence measured after your own fix is the classic false retraction** — the expensive
direction, because retracting a true finding costs more than publishing a false one. **Re-measure at
the ref the claim was about, never at HEAD.**
- **Fleet threads — bounded.** Include a thread ONLY if this session has an unfulfilled
  obligation in it, or is awaiting something from it. General fleet activity is noise in
  a session summary; an unanswered claim-or-disclaim addressed to you is not.

### 4. Filed-with-triggers delta

What got parked THIS session *with a concrete trigger* — `todo.txt` rows, `BACKLOG`
entries, deferred items. Derive from the row's own provenance field, never from a bare
`git log` on the tracker files — that log is FLEET-WIDE and every peer writes `todo.txt`,
so it answers "what got filed" and not "what I filed":

⛔ **THE PREDICATE MUST SCAN THE ROW BLOCK, NOT THE ROW'S FIRST LINE** — a line-scoped form
under-reported **16×** (rows average ~7 lines; provenance sits on a CONTINUATION line), and a
count of 1 reads as "I filed one thing": confident, specific, wrong, with no prompt to look.
Incident: `references/cases.md` § 4.

```bash
SID=${CLAUDE_CODE_SESSION_ID%%-*}
python3 - "$SID" <<'PY'
import sys, re
sid = sys.argv[1]
rows, cur = [], None
for line in open('todo.txt', encoding='utf-8', errors='replace'):
    if re.match(r'^- \[[^\]]*\] ', line):   # NOT [ x] — six checkbox forms exist; on a SPLITTER an unmatched row-start falls through to the append branch and its filed:/owner: read as the PREVIOUS row's
        if cur: rows.append(cur)
        cur = [line]
    elif cur is not None:
        cur.append(line)
if cur: rows.append(cur)
# ⛔ ALLCAPS-HYPHENATED IS A CONVENTION, NOT THE SHAPE — an `([A-Z0-9-]+)` capture stops at
# the first lowercase letter, so it read a prose-labelled row as a row named by its first
# capital letter and put that in an owner-facing list. Measured on the live
# tracker: 620 of 1871 rows (33%) are not ALLCAPS-named, and old-vs-new disagree on 481
# OPEN rows. Anchor on the checkbox alone, take the id when there is one, else label with
# the prose. `Q12 P2-1 — Sample feature title` deliberately prose-labels rather than reading
# `Q12`: the label is for the owner, and the fuller line is the more useful one.
row_name = re.compile(r'^- \[[^\]]*\] (.*)$')
row_id = re.compile(r'^[A-Z0-9][A-Z0-9-]{3,}(?=\s|$)')
def row_label(first_line):
    m = row_name.match(first_line.rstrip("\n"))
    if not m: return '(unparseable row)'
    rest = m.group(1).strip()
    t = row_id.match(rest)
    return t.group(0) if t else (rest[:60] + ('...' if len(rest) > 60 else ''))
# ⛔ FAILURE 9 (2026-09-03, measured): `filed:[^|\n]*by <sid>` is GREEDY ACROSS THE ROW LINE, so
# ANY later mention of your sid on that line matches even when the row names a DIFFERENT filer
# first. It fires precisely on rows that CREDIT a collaborator — measured on a peer's row reading
# `filed: 2026-09-03 by <peer-sid> (grep for prior art run by <your-sid> and re-run by me: ...)`, whose
# matched span ran from `filed:` all the way to the sid in the parenthetical. Fleet-wide that form
# claims 557 rows against 555 real ones: 3 false positives, and it MISSES one true row whose
# `filed:` field is WRAPPED (`filed:\n  2026-09-03 by <sid>`) because `[^|\n]*` cannot cross the
# newline. The shaped form below fixes both — it says what the field IS (the filer is the token
# right after the date) instead of budgeting characters.
# ⚠️ `\s` CROSSES NEWLINES, which is what recovers the wrapped field — and it is SAFE HERE ONLY
# because both call sites apply this per ROW BLOCK, so it cannot span into the next row. Do NOT
# copy this into a whole-file scan without re-deriving that. (The owner predicate above needs the
# opposite, `[^\S\n]`, for the reason failure 8 documents.)
def FILED_BY(sid):
    return r'filed:\s*[0-9-]*\s*by ' + re.escape(sid) + r'\b'
for r in rows:                       # OPEN rows whose BLOCK names this seat as filer
    if r[0].startswith('- [ ] ') and re.search(FILED_BY(sid), "".join(r)):
        print(row_label(r[0]))
PY
```

**Positive control before trusting a low number:** a row you filed THIS session must appear. If it
does not, the instrument is broken, not the queue — which is exactly how the 16× was found.

A defer with no trigger is not a filed item, it is an open loop — report it in §2 or §5,
never here.

### 5. Next actions, split by owner

Two short lists: **yours** (decisions, approvals, external facts only you hold) and
**mine** (work I can do without you). If "mine" is empty, say so plainly — that is the
signal the session is genuinely idle rather than quietly stuck.

⛔ **ONE TOKEN FOR "WAITING ON THE OWNER":** a row blocked on the owner writes
`owner-pending: <why — taste call | external fact | irreversible action | spend>` on the row. The older
spellings (`needs-owner`, `owner: owner` / `owner: the owner` / `founder` / the owner's first name, `blocked-on: owner`,
`awaiting owner`) stay readable through the fleet board's alias list
(`OWNER_PENDING_ALIASES` in `scripts/fleet-board.py`) and are never back-migrated; a spelling outside that list is invisible to the
board, so new rows use the token. `⏸ owner-deferred` is NOT superseded: it is §2's live marker for *the owner
answered later*, still written at the deferral, and the board counts it under its own alias. `owner:`
should name a SEAT and `owner-pending:` the REASON, and a row can carry both; the legacy `owner: owner` /
`owner: the owner` / `owner: needs-owner-ruling` fields name the human — the predicate below drops them
from "mine" as owner-blocked, and the board credits them to the row's filer. Fleet-wide counts come from
the fleet board's header line, never from a figure restated here.

⛔ **A STEP ON "YOURS" THAT THE OWNER PERFORMS OUTSIDE THIS TERMINAL CARRIES ITS CLICK PATH: WHERE TO
GO, WHICH CONTROL, WHAT DONE LOOKS LIKE.** A dashboard, a device, another app: name the page, the button or field, and the
state that tells the owner it worked. **TELL: the line names a product or a verb ("in Upstash, create a
database", "run the phone test on production") and no control.** `/post-compact` borrows this
list by pointer (its step 7b), so it inherits the clause; `/wrap`'s closing template does NOT
point here (this line once said it did), so at a wrap the
clause reaches a step only through a standing memory rule. Measured: three sessions in three days handed the owner
such a step and each time the owner had to ask how to do it, with that memory rule loaded.

⛔ **WHEN THIS SEAT HAS COMMITTED WORK THE OWNER CAN SEE ON STAGING AND GitHub's `dev` DOES NOT HOLD IT
YET, "MINE" CARRIES "AT THE END OF MY /wrap, IF NEEDED"; "YOURS" CARRIES THE LOOK ONLY ONCE IT HAS LANDED.** A `dev` push now happens only
as the optional last step of `/wrap` or when the owner asks for one, and the wrap SKIPS it unless the owner is waiting to look or a promote
is next (`/wrap` Step 12). So a mid-session readout never promises a push: it says the change is not on staging yet and
that the owner can say "push" if the owner wants to look sooner; if the owner is waiting to look, "mine" carries *"push at the end of my /wrap"*. Once it lands, hand the owner the
staging link with the click path the rule above requires. Check with `git rev-list --count origin/dev..dev` after a
`git fetch origin`: non-zero and something user-visible among this seat's commits ⇒ say so in the readout, and the
push belongs in "mine" only when Step 12's conditions hold (the owner is waiting to look, or a promote is next), minus `/push` § D0's
stops (a promote in flight, a live hold). **TELL: "Next — you" asks the owner to look at a change that only exists on this machine.** Measured
once: a readout left gallery changes unpushed and the owner had to ask why they were not pushed to `dev`
so the owner could view them on staging.

⛔ **AN EMPTY "MINE" IS A CLAIM, AND THIS SECTION HAD NO INSTRUMENT UNTIL 2026-08-16 — the
same single-section scoping the compaction-count note below documents.** §2 got a per-item
derivation block; §5 kept the sentence that INVITES the assertion and shipped nothing to
check it against. Two days after the §2 fix, a run emitted *"Next — me: genuinely empty"*
and named three actionable items from a filed row **in the same sentence**. Derive it:

```bash
# Open rows THIS SEAT filed or is named on. `owner: me` is NOT the predicate — see below.
SID=${CLAUDE_CODE_SESSION_ID%%-*}
# ⛔ BLOCK-AWARE, for the 16× reason in §4 — a line-scoped grep here misses every row whose
# provenance sits on a continuation line, which is most of them.
python3 - "$SID" <<'PY'
import sys, re
sid = sys.argv[1]
rows, cur = [], None
for line in open('todo.txt', encoding='utf-8', errors='replace'):
    if re.match(r'^- \[[^\]]*\] ', line):   # NOT [ x] — six checkbox forms exist; on a SPLITTER an unmatched row-start falls through to the append branch and its filed:/owner: read as the PREVIOUS row's
        if cur: rows.append(cur)
        cur = [line]
    elif cur is not None:
        cur.append(line)
if cur: rows.append(cur)
# ⛔ FAILURE 9 (2026-09-03, measured): `filed:[^|\n]*by <sid>` is GREEDY ACROSS THE ROW LINE, so
# ANY later mention of your sid on that line matches even when the row names a DIFFERENT filer
# first. It fires precisely on rows that CREDIT a collaborator — measured on a peer's row reading
# `filed: 2026-09-03 by <peer-sid> (grep for prior art run by <your-sid> and re-run by me: ...)`, whose
# matched span ran from `filed:` all the way to the sid in the parenthetical. Fleet-wide that form
# claims 557 rows against 555 real ones: 3 false positives, and it MISSES one true row whose
# `filed:` field is WRAPPED (`filed:\n  2026-09-03 by <sid>`) because `[^|\n]*` cannot cross the
# newline. The shaped form below fixes both — it says what the field IS (the filer is the token
# right after the date) instead of budgeting characters.
# ⚠️ `\s` CROSSES NEWLINES, which is what recovers the wrapped field — and it is SAFE HERE ONLY
# because both call sites apply this per ROW BLOCK, so it cannot span into the next row. Do NOT
# copy this into a whole-file scan without re-deriving that. (The owner predicate above needs the
# opposite, `[^\S\n]`, for the reason failure 8 documents.)
def FILED_BY(sid):
    return r'filed:\s*[0-9-]*\s*by ' + re.escape(sid) + r'\b'
# ⛔ THE `owner:` ALTERNATIVE IS ANCHORED AT BOTH ENDS, AND IT WAS UNBOUNDED HERE UNTIL
# 2026-09-08. `scripts/summary-plan-sync.mjs` has carried the bounded
# form since 2026-08-25; this snippet did not, and a hand-run `/summary` executes
# THIS one — the checker's own docstring says the spec IS the implementation. Measured on the
# two forms: `downer: <sid>` claimed the row, and `owner: <sid>ff` PREFIX-claimed it, under the
# unbounded form and under neither anchor of the script's. ⚠️ `scripts/summary-owner-predicate-
# check.py` could not have caught this — it extracts `owner_line` and `owner_pipe` only, never
# this claim predicate, and it compares SPEC-section to SPEC-section rather than spec to script.
pat = re.compile(FILED_BY(sid) + r'|\bowner: *' + re.escape(sid) + r'\b')
# ⛔ AN EXPLICIT PEER `owner:` OVERRIDES `filed: by me`. Filing a row and OWNING it are
# different facts, and this predicate ORs them — so a row you WROTE and a peer OWNS matches
# on the first alternative and lands in "mine". Measured 2026-08-26: of six rows returned, one
# carried `filed: by <this-seat>` AND `owner: <peer-sid>`,
# was reported to the owner as "mine, actionable", and had ALREADY been handed to that peer in a
# triage report that omitted it.
# ⛔ FAILURE 7 (2026-08-30, measured): the `^`-anchor alone MISSES the inline `| owner: X`
# form, which this tracker uses on 41 of its 197 owner fields — 12 owned by peer seats,
# 4 `needs-owner-ruling`, 2 `OWNER`. So the exclusion arm was blind to
# exactly the rows it exists to exclude, and a row whose inline `| owner:` field named the owner
# was reported to the owner as "actionable by me" — the documented dangerous direction, again. Accept BOTH
# spellings: line-start, or after the ` | ` field separator.
# ⛔ FAILURE 8 (2026-08-30, SAME DAY as 7): the single alternation `(?:^|\|)` that
# fixed 7 REOPENED shadowing through its own new half. `re.search` is leftmost, so a prose
# mention after a pipe BEATS the real field on a later line — measured on
# "ran /audit-check | owner: bbbbbbbb\n  owner: aaaaaaaa": old form -> aaaaaaaa, one-alternation
# form -> bbbbbbbb. Fix: line-anchored is AUTHORITATIVE, pipe-inline is a FALLBACK. A real field
# line then always wins, and the 41 inline fields stay readable.
# ⛔ AND `\s` MATCHED NEWLINES. Under the old `^`-only form newline-safety was structural (`^`
# cannot follow a pipe); under an alternation it became contingent on every row starting `- [`,
# a convention nothing enforces. `[^\S\n]` is whitespace-except-newline and restores it by
# construction. Do NOT "simplify" either back to `\s` or to one alternation.
owner_line = re.compile(r'^[^\S\n]*owner: *(\S+)', re.M)   # AUTHORITATIVE — a real field line
owner_pipe = re.compile(r'\|[^\S\n]*owner: *(\S+)')        # FALLBACK — inline after ` | `
# Verified on the live tracker: 0 rows change value vs the one-alternation form, 0 newly unread.
# ⚠️ BOUND, MEASURED AND NOT CLOSED: `|` is the SECOND of at least FOUR separators. Of 460
# `owner:` occurrences, 162 are line-anchored, 41 pipe-inline, and 257 sit behind `.` (173),
# `(` (27), `;` (18), `·` (11), `—` (8) or a backtick (6).
# ⛔ AND THE CONSEQUENTIAL NUMBER IS **2**, NOT THE 165 I FIRST PUBLISHED. That 165 counted
# every open row containing the STRING "owner:" that neither arm reads — and the great
# majority are PROSE, not fields: "named by its owner:" ending a sentence, "(DECIDED — owner:
# <the ruling>)" recording a RULING, "owner: THE OWNER" mid-paragraph. Hand-reading the
# rows that could actually misattribute (an unread owner naming someone OTHER than the row's
# own `filed: by` seat) gives FIVE, of which four are `unassigned`/`unclaimed` — nobody owns
# those, so a filer seeing them is right. TWO are genuine peer misattributions, both
# middot-separated, both filed by one seat and owned by another.
# ⛔ SO NO PARSER, AND NO NINTH ANCHOR. A population of 2 justifies neither, and widening to
# `[|.;·]` was MEASURED: 10 rows change, 4 clean values against 6 junk ("whoever" x3,
# "needs", "unrouted", a seat id in markdown bold) — the third widening to buy coverage
# plus a normalization bug. **The fix that was warranted is the TEST**, which now exists:
# `scripts/summary-owner-predicate-check.py` extracts these two regexes and runs them against
# a fixture per historical failure, with a mutation arm that swaps each broken form in and
# demands the fixtures go RED. Wired into `scripts/smoke-test-hooks.sh`. Its `--scan` mode
# reports the live misattributions.
# ⚠️ HOW THE 165 HAPPENED, because it is the reusable part: I built a predicate to count how
# often a predicate fails and never hand-read its members. A proportion whose predicate stands
# in for a JUDGMENT is an upper bound, never a count.
for r in rows:
    if not (r[0].startswith('- [ ] ') and pat.search("".join(r))):
        continue
    body = "".join(r)
    m = owner_line.search(body) or owner_pipe.search(body)
    if m and m.group(1) not in (sid, 'me'):
        continue          # a peer owns it, OR it is owner-BLOCKED (`needs-owner-ruling`) — either way not actionable by you
    # ⛔ A ROW THAT DECLARES ITSELF NOT-QUEUED IS NOT ACTIONABLE, AND ONE OF THEM SAYS SO IN WORDS
    # THIS PREDICATE DID NOT READ. Measured 2026-09-02: three rows were reported
    # to the owner as "actionable without you" and NONE was. One row
    # carries `📌 STANDING RULE — NOT DOABLE-NOW WORK … it should never appear in a
    # next-actions list` — a request in the row's own text that no code honored. The work
    # was approved and it turned out not to exist.
    if any(k in body for k in ("NOT DOABLE-NOW WORK", "STANDING RULE")):
        continue          # the row declares itself a discipline, not queued work
    # ⚠️ AND THE OTHER TWO MISSES ARE NOT PREDICATE-FIXABLE — do not add clauses for them.
    # One row's `done-when` waits on "a queue-position ACK from a hub", an EXTERNAL
    # actor; the other is held by the band gate reading BLOCK. Both are judgments about a
    # `done-when`, and the marker population is 3 rows in ~1,900 (0.16%), far under the base rate
    # where a predicate beats a convention (`session-cadence.md` § MEASURE THE BASE RATE).
    # ⇒ THE CONVENTION, which is the actual fix: READ EACH SURVIVING ROW'S `done-when` BEFORE
    # CALLING IT ACTIONABLE. If it names an external actor, a gate, or another session, it belongs
    # in §3 (in-flight / waiting) — never in "Next — me". This predicate returns rows you FILED;
    # filing a row is not evidence that anything is left to do on it.
    # ⛔ AND THIS PREDICATE IS ONE OF TWO POPULATIONS: the plan's own
    # queue and live-item rows, enumerated by heading (§ The plan table), are the other, and the
    # Next — me / Next — you split is their UNION — a plan row no tracker row carries is still a member.
    # Same `row_label` as §4 — see the block there for why an `([A-Z0-9-]+)` capture is wrong.
    # ⛔ THIS SITE HAD A SECOND, WORSE BUG THAT §4 DID NOT: it was guarded `if mm:` and
    # therefore SILENTLY DROPPED every row whose name is not ALLCAPS, so §5's count was a
    # floor beneath the floor it already declared. §4's unguarded `.group(1)` would instead
    # have CRASHED on such a row — it never did only because the truncation always matched
    # at least one character. Two sites, one pattern, opposite failure modes.
    # ⛔ THE SAME FUNCTION AS §4, BYTE-FOR-BYTE — not an inline restatement of it.
    # It WAS an inline restatement until 2026-08-31, and the two forms had already
    # diverged: on an empty label (`- [ ] `) §4 returned `''` and this site returned
    # `'(unparseable row)'`. The checker's drift arm could not see it, because that arm
    # compared only the two REGEXES while the algorithm around them was re-typed at both
    # sites and re-typed a third time inside the checker itself. `scripts/summary-owner-
    # predicate-check.py` now EXTRACTS this function from the spec and executes it, so a
    # replica cannot exist and drift is caught on the whole function rather than its two
    # constants. Keep both copies identical; the checker fails loudly if they are not.
    row_name = re.compile(r'^- \[[^\]]*\] (.*)$')
    row_id = re.compile(r'^[A-Z0-9][A-Z0-9-]{3,}(?=\s|$)')
    def row_label(first_line):
        m = row_name.match(first_line.rstrip("\n"))
        if not m: return '(unparseable row)'
        rest = m.group(1).strip()
        t = row_id.match(rest)
        return t.group(0) if t else (rest[:60] + ('...' if len(rest) > 60 else ''))
    print(row_label(r[0]))
PY
```

⛔ **THIS PREDICATE FAMILY HAS FAILED SIX MEASURED TIMES — the code block above carries every
fix; these are the rules each failure earned** (full narrations: `references/cases.md` § 5):
1-3 were MATCHING bugs (line-scoped → 16× under-report · `owner: me` indexical → sets DISJOINT
from the truth · un-`\n`'d class spanning into the row below). 4 matched the right string in the
right place and was still wrong: `filed:` and `owner:` answer **different questions** — **before
sharpening a predicate again, check whether the fields it reads mean the same thing.** 5-6: an
owner value that is neither a peer-sid nor yours must EXCLUDE, and the owner read must be
`^`-anchored — **when a fixture pair agrees, ask what each one could NOT have shown** (the fix
took THREE fixtures; the first two passed for an incidental reason).

⚠️ **The failure direction is the expensive one on a shared tree:** a peer's row lands in YOUR
column, where it is done twice or quietly dropped from the handoff meant to carry it — a row
nobody is doing.

⚠️ **Bounds.** `filed: by <sid>` and `owner: <sid>` are conventions, not schema — most rows carry
neither, so this is a FLOOR on what is actionable without the owner, never a total. About to
write that nothing at all is actionable? Say which population you checked. And the clause that
outlives every grep fix: **read what your own instrument returned, not just the count it
returned** — each historical failure was a wrong CHARACTERIZATION written on top of data the
same message already disclosed.

### 6. Working-plan currency — DERIVED, and SYNCED

If this session keeps a working-plan file (`plans/session-<sid8>-<date>.md`), report whether it is BEHIND the state this
readout just derived. One line, and it is a state claim like every other here.

```bash
SID=${CLAUDE_CODE_SESSION_ID%%-*}
P=$(ls plans/session-${SID}-*.md 2>/dev/null | LC_ALL=C sort | tail -1)   # findPlan's order (summary-plan-sync.mjs): head -1 named a stale fragment
[ -n "$P" ] && {
  echo "plan: $P"
  git log -1 --format='  last written %h %cr' -- "$P"
  # commits to THIS repo since the plan was last written — the staleness measure
  echo "  commits since: $(git rev-list --count "$(git log -1 --format=%H -- "$P")"..HEAD)"
}
```

⛔ **THIS SECTION EXISTS BECAUSE THE READ-ONLY INSTRUMENT WATCHED THE FAILURE FOUR TIMES** — a
plan sat 8h stale while `/summary` fired four times inside the window and said nothing, with the
update-at-state-change rule already live (active-recall before write, possession ≠ application). Incident:
`references/cases.md` § 6.

**SYNC IT.** Run it, and report which way it went. ⛔ **This is now the
FIRST of two acts, not the whole duty — see "AND THEN UPDATE THE PROSE" below.** The script owns the derived block; the hand-written sections are yours.

```bash
node scripts/summary-plan-sync.mjs        # CURRENT | UPDATED | NO-PLAN
node scripts/summary-plan-sync.mjs --check # report only; rc=3 means it would change
```

**It updates the plan UNLESS one of exactly three things holds:**

1. **No plan file exists** for this session — prints `NO-PLAN`, writes nothing.
2. **Nothing changed** — the derived block is byte-identical to what is on disk. This is the
   load-bearing clause: it is what keeps the command idempotent, so running `/summary` twice
   does what running it once does. Verified live across three consecutive runs (UPDATED, then
   CURRENT, then CURRENT, with an unchanged numstat proving runs 2 and 3 wrote nothing).
3. **The SCRIPT's write would land outside its own fence** — structurally impossible, not merely
   discouraged: `spliceFence` rebuilds the file as `before-fence + block + after-fence`, and
   the self-test asserts text on both sides survives verbatim. ⛔ **This is a property of the
   SCRIPT and it is UNCHANGED by the 2026-09-03 widening — do not "fix" `spliceFence` to reach
   outside the fence.** The script stays deterministic and idempotent precisely so the fence can
   be trusted; the prose around it is updated by YOU, by hand, with judgment. Two writers, two
   methods, one file.

### AND THEN UPDATE THE PROSE — the second act

The sync above brings the DERIVED block current. It cannot bring the plan current, because the
parts that rot fastest are the hand-written ones — the closability verdict, the review ledger,
the open-question list, the owner-pending split. **Measured on the run that produced this
rule: a plan's closability blocks were dated 08-30 and 08-31 and read at wrap on 09-03, two
days and one whole second arc stale, while `/summary` had run twice in that window and correctly
touched only the fence each time.** Both runs were compliant. That is what made it a spec defect
rather than a discipline one.

**So after the sync, ask the state-change question `/working-plan` asks** (its Process step 2 —
*"has anything SHIPPED, closed, or been ruled since the newest state block?"*) and write the
delta in. Concretely, and none of this is optional because the readout you are about to emit
already derived every one of them:

- **A closability verdict older than the newest state block is STALE** — supersede it with a
  dated block, per the file's own convention. Never edit the old one in place: this session's
  plan carries three, each explicitly superseding the last, and that chain is the record.
- **EVERY SESSION-WIDE STATEMENT — a closability verdict, an open-items count, the owner/mine split, a "nothing owed" — derives over the WHOLE plan; the sites named in this file are instances of that rule, not its bound.** A closability verdict derived from the newest block alone is WINDOW-scoped however fresh it is — the newest block carries the delta, not the population. Derive the verdict, the open-items list and the owner/mine split over the WHOLE plan (every live row incl. ⏸/✅, every ledger row's terminal state, every dated block, this seat's open tracker rows). Measured: a digest that read one block of 225 called the session SAFE while 84 tracker rows and a day-one trigger sat open. ⛔ **THE WHOLE-PLAN READ IS AN ENUMERATION BY HEADING, NEVER A WHOLE-FILE `Read` — and "a read the run cannot afford" was the wrong name for the failure:** a long session's plan is over the Read tool's 262,144 B hard ceiling — ⚠️ **MEASURE YOURS (`wc -c`); every figure here is per-plan and has no fixed referent.** *(Read “this seat's at 1,400,000 B, 5.34×” until 2026-09-13: “this seat” resolves to whoever is READING in a file every seat reads. Four plans measured that day spanned 346,672 B to 1,929,895 B — 1.32× to 7.36× — and ALL of them are over the ceiling, so the rule holds on every one and never depended on the number.)*, so the tool REFUSES the whole file rather than the run declining to afford it, and an escape phrased as a budget call is taken every time, which turns the rule into a labelling convention. The method: `grep -nE '^#+ ' <plan>` enumerates every heading at every level (~49 KB on the 1.4 MB plan, against ~350K tokens for the file), then each dated block, the live-items list, the ledger and the queue sections are read by anchor with `offset`/`limit`. **Anchor on `^#+ `, never on `###` alone** — the closability supersession chain sits at `##`, `^###` reaches 41 of 223 dated headings on that plan, and the split inverts on other plans. A WINDOW claim (*"for the <arc>"*) is what a run writes when it did NOT enumerate, and it names the blocks it read.
- **An owner ruling or deferral this session produced** goes onto the item's own row, verbatim,
  with its date — the `⏸ owner-deferred` marker is the carrier that stops a closer re-raising it.
- **An item that closed** gets a dated status flip on its existing row. It is not deleted and it
  does not age out.
- **A section this run PROVED wrong** gets corrected, with one line saying what it used to say
  if the owner could have acted on the old version.

⚠️ **What does NOT go in: anything this run did not derive.** The widening removes a boundary on
REACH, not the Iron rule at the top of this file. A hand-written section you did not verify this
invocation stays exactly as it is — leaving a true-but-unre-derived paragraph alone is correct,
and rewriting it from recall is the failure this command exists to prevent.

⛔ **ANCHOR YOUR PROSE WRITE ON THE FENCE'S `SUMMARY-SYNC:BEGIN` MARKER — NOT ON A HEADING, AND
NEVER ON `### Derived state`.** The obvious insertion anchor for a new dated block is the heading
that opens the derived region, and **that heading lives INSIDE the fence**: measured 2026-09-05 on
this session's own plan, `### Derived state` sat at line 1786 with the fence spanning 1784-1814, so
prose anchored there is written into the overwrite region and the next `summary-plan-sync.mjs` run
deletes it. **The tell is that there is none** — the write succeeds, the file looks right, and the
text is gone at the next sync with no error and no diff you would think to read.

**Two real disappearances came from this, plus a fleet-wide bug report about the sync script that
was one keystroke from sending and would have been FALSE** — the script was doing exactly what it
documents; the anchor was inside its region. **The safe form is the marker, which cannot move
inside the fence because it IS the fence:**

```bash
  # insert a dated state block immediately BEFORE the fence — outside it by construction
python3 - <<'PY'
import io
p = "<plan>"; t = io.open(p, encoding="utf-8").read()
a = "\n<!-- SUMMARY-SYNC:BEGIN"
assert t.count(a) == 1                      # the marker is unique or you are not where you think
i = t.index(a)                              # index(), never find() — a miss must raise
assert t[:i].endswith("\n")                 # newline-bounded insertion point
io.open(p, "w", encoding="utf-8").write(t[:i] + BLOCK + t[i:])
PY
```

⭐ **AFTER WRITING, DIFF THE HEADING SET AGAINST HEAD. Two greps, no script, no hook:**

⛔ **PRECONDITION — CONFIRM THE PLAN IS TRACKED (`git ls-files --error-unmatch <plan>`). ON AN UNTRACKED PLAN THIS DIFF IS VACUOUS AND FAILS PASS-SHAPED (measured 2026-09-05).** With no committed baseline it emits `fatal: … exists on disk, but not in 'HEAD'` to STDERR and `0a1,N` to stdout — every heading a `>`, **zero `<` possible** — so the reading rule below reports the one outcome it treats as clean, and the `fatal:` is visually buried by the diff body. Untracked ⇒ SAY the check could not run; do not report it clean. Canonical write-up: `.claude/skills/post-compact/SKILL.md` Step 6.

```bash
diff <(git show HEAD:<plan> | grep '^#\+ ') <(grep '^#\+ ' <plan>)
```

A `>` line is a section you added; **a `<` line is one you DESTROYED**, which is the single
failure class here that is not a judgment call — an over-broad edit anchor silently eats a
heading and everything under it reads as belonging to the section above. This has happened twice
in this repo within one day and BOTH times the author caught it only by running a heading diff, never
by rereading. **It cannot false-positive** (it compares two literal sets), which is why it is a
step rather than a detector — the ≤5-line "wire something that already exists" shape.

⚠️ **THE BASE RATE, AND THE FIRST NUMBER I PUT HERE WAS ATTACHED TO THE WRONG PREDICATE.** This
clause read *"~2% of 913 plan-file commits"* for one commit's life. Over ~920 commits touching a
session plan since 2026-08-01, measured on re-derivation after I flagged the figure as
untaken:

| what was counted | commits | rate |
|---|---|---|
| removed a heading at ANY level | 18 | 2.0% |
| removed a level-2 `##` heading only | 8 | 0.87% |
| **removed a heading and added NONE back** | **1** | **0.11%** |

**Only the third row is the failure this step prevents.** Almost all of the 18 removed a heading
and added another in the same commit — a rename or restructure, not a loss. So the 2% was an
UPPER BOUND wearing a count's clothes (`active-recall.md`'s PROPORTION TELL: a figure whose
predicate stands in for a judgment is a ceiling, never a measurement), and the true silent-loss
rate is about one in a thousand. **That argues for this step MORE strongly, not less** — a
convention beats a predicate far below a few percent, so building a hook here would have been
wrong by a factor of twenty rather than by a hair. ⚠️ The denominator moved 918→920 mid-computation
because other sessions were committing; the three numerators held. **Do not restate these figures
as current — the corpus grows daily; re-derive if you need them.**

⚠️ **AND STATE THE LIMIT OF THE EVIDENCE THAT MOTIVATED THIS WIDENING, because it is easy to
over-read.** The two `/summary` runs that were fully compliant while the plan rotted are evidence
about a PROHIBITION — and the compliant act under a prohibition is *doing nothing*, which is
cheap. This section replaces it with an OBLIGATION, whose compliant act is derived work, which is
expensive. **Those two have different compliance rates and the first tells you nothing about the
second.** The fence was aimed wrong; that is established. That the replacement will be honored at
the same rate is NOT, and nothing measured here shows it.

⛔ **THE FENCE HOLDS ONLY THIS SEAT'S OPEN/CLOSED TRACKER ROWS — NEVER FLEET NUMBERS.** A
fleet-bearing block differs on nearly every run (measured 13 commits in one hour on this tree),
so "write only when changed" never fires and the command becomes always-writes. **Fleet numbers
belong in the READOUT**, true at the moment they are read. Measurement: `references/cases.md` § 6.

⚠️ **The determinism is a property of the CONTENT, so it is the thing to guard on any future
edit.** No timestamps, no relative dates, no counts of anything the fleet moves. A sync that
rewrites on every run is not a sync — it is churn with a verdict token, and it will read as
working right up until someone counts the commits.


### 7. Shipped-but-UNREVIEWED — what this seat committed that no reviewer has seen

⛔ **ADDED after the question of which commits were still missing a review from the hub got a
derived answer of TEN of fourteen commits.** Nothing in this repo surfaced that
gap. `/hanging-work` Check 13 has a SENT-side arm — it flags a review you REQUESTED that never came
back — and that arm is structurally blind to the case where you never requested one. A request you
never sent produces no artifact to go looking for, so the absence is invisible to every net that
scans for stalled requests. This section is the missing half.

⛔ **STEP 1 ENUMERATES FROM THE jsonl CREATION-RECORD. NEVER FROM THE `Claude-Session:` TRAILER
— that spelling was this snippet's own instrument until 2026-08-30 and it read 1 of 41.** Measured
on one seat: its commits carried **three** trailer values — the 8-hex sid, plus two
DIFFERENT session URLs either side of a compaction — so the single-spelling grep returned ONE
commit where forty-one were shippable, and §7's failure direction is *"everything risk-bearing has
been sent"*. Fleet-wide the same day: **237 commits, 12+ distinct trailer values in TWO
incompatible formats** (8-hex AND full URL), plus **a repeated-letter `safe-commit` self-test FIXTURE
literal on five commits reachable from `main`.** No spelling catches both formats, and a
normalizer would have to recognise a fixture as not-a-session. ⛔ **AND DO NOT "FIX" IT BY ROUTING
STEP 1 THROUGH THE MAIL STORE**: step 2 already IS the mail store, so that replaces it with itself
— and the store holds no record of a commit that was never mailed, which is precisely the
population this section exists to find, so the empty set would read as clean. (Proposed and
withdrawn the same day, on this paragraph's own reasoning.)

```bash
# STEP 1 — this seat's commits, from git's own `[main <sha>]` confirmation lines in the
# transcript. Spelling-independent, and it is the instrument §1 already prescribes for the
# same split. The jsonl IS the session boundary, so no BASE has to be chosen.
MINE=$(mktemp)
python3 - > "$MINE" <<'PY'
import re, os
p = f"{os.environ['HOME']}/.claude/projects/<project-key>/{os.environ['CLAUDE_CODE_SESSION_ID']}.jsonl"
seen = set()
for line in open(p, encoding='utf-8', errors='replace'):
    # ⛔ NOT `\[main (...)\]` ALONE. git's confirmation line opens with the CURRENT branch —
    # measured in a scratch repo, and independently: `[main 3b6c6c4]`,
    # `[feature 951e22a]`, `[detached HEAD 8525491]`, `[main (root-commit) 3b6c6c4]`. A
    # main-only pattern returns ZERO on a detached HEAD, and zero here reads as "all reviewed"
    # — the false-clean this whole section exists to remove, reproduced by its own fix.
    # ⛔ AND NOT THE OBVIOUS GENERALISATION `\[[^ \]]+(?: HEAD)? (hex)\]` EITHER — it fails in
    # BOTH directions at once, which is what makes it the wrong approach rather than a near
    # miss. It OVER-matches ordinary bracketed prose (`[BAND-O-DIGEST <session-id>]`, `[word
    # deadbeef]`), and it
    # UNDER-matches a real confirmation line, `[main (root-commit) 3b6c6c4]`, which the form
    # below catches. Both branch states that can occur here are named explicitly instead;
    # `feature-*` is excluded on purpose: sessions commit on `dev` (dev-branch policy since 2026-09-08; `main` for older transcripts; a hotfix worktree commits as
    # `[hotfix/<topic> <sha>]`, /push --emergency's branch) and review worktrees run DETACHED.
    # `dev` was MISSING until 2026-10-11, so every session's commits read as none and the
    # unreviewed slot came back clean (/meta maintain 2026-10-11).
    # ⚠️ The prose over-matches are NOISE, not corruption: the reachability filter below drops
    # them. This comment claimed for ~10 minutes that two of them SURVIVED the filter on an
    # 8-hex collision — that was RETRACTED 2026-08-30 and was never measured. It was inferred
    # from a row count moving 43 -> 45 between two runs, and the +2 was the author's own two
    # commits landing in between. `<session-id>`, `<session-id>` and `deadbeef` all fail
    # `git rev-parse --verify -q <sha>^{commit}` here. Kept because the inference
    # shape — reading a delta on a tree that moves every few minutes as if it were a
    # measurement — is the one this file warns about three sections up.
    for m in re.finditer(r'\[(?:main|dev|hotfix/[^\] ]+|detached HEAD)(?: \([^)]*\))? ([0-9a-f]{7,40})\]', line):
        seen.add(m.group(1))
print("\n".join(sorted(seen)))
PY
rc=$?
# ⛔ GATE THE INSTRUMENT, LOUDLY — WITHOUT THIS THE SECTION FAILS TO "EVERYTHING REVIEWED".
# Measured with a bad session id: python exits 1, `$MINE` is 0 bytes, the loop emits nothing,
# and the closing line below tells the reader an empty set is a good answer.
# `bash-environment.md` § WRITE A GATE SO INSTRUMENT FAILURE LANDS ON THE FAILING SIDE —
# breached in the one snippet whose whole purpose is catching an absence. EVERY other step-1
# failure mode (wrong pattern, moved transcript, renamed field) terminates at this same silent
# zero, which is why this gate outranks any pattern fix.
if [ "$rc" -ne 0 ]; then
  echo "STEP 7 STEP 1 FAILED (rc=$rc) — INSTRUMENT FAILURE, NOT 'everything risk-bearing has" >&2
  echo "been sent'. Do not report §7 at all. Commonest cause: the transcript path is wrong." >&2
  rm -f "$MINE"; exit 1
fi
# ⛔ THREE STATES, NOT TWO. rc!=0 is a CRASH. rc==0 with zero rows is a session that COMMITTED
# NOTHING — legitimate and common — and telling that reader "instrument failure" is a false
# alarm that trains them to ignore the real one. Do not fold them into one condition.
# ⛔ COUNT LINES, NOT BYTES: `[ -s ]` IS THE WRONG INSTRUMENT and reads as right —
# `print("\n".join(...))` on an empty set still emits a bare newline, so the file is 1 byte and
# `-s` is TRUE. Measured: the zero-commit arm sailed straight into the normal branch.
# ⛔ AND NO `|| echo 0` ON `grep -c` — it prints `0` AND exits 1, so the fallback fires too and
# `$rows` becomes `0\n0`, which THROWS in the `-gt` ("integer expression expected"). Codified in
# `bash-environment.md`; shipped here anyway and caught only because the arm printed the error.
rows=$(grep -c . "$MINE" 2>/dev/null); rows=${rows:-0}
[ "$rows" -gt 0 ] || echo "(no commits from this session — §7 is empty for THAT reason, which is not the same as everything having been sent)"
SID8=${CLAUDE_CODE_SESSION_ID%%-*}

# STEP 2 — the mail store, ONE PASS. `*__<me>.md*` is mail FROM me; the trailing `*` keeps
# `.read`. Walk the store ONCE, collect the hex tokens each request-marked mail names, then
# intersect per sha below.
# ⛔ THE PASS IS OUTSIDE THE SHA LOOP ON PURPOSE — NESTING IT INSIDE TIMES OUT AND THE TIMEOUT
# READS AS A RESULT. Until 2026-09-04 this `find` ran once PER SHA: 227 shas x 148 mails is
# ~34k greps, and it was MEASURED dying at the Bash tool's 2-minute cap (exit 143) on this very
# seat — twice, because the first death was read as "the store is quiet" rather than as an
# instrument failure. A per-sha loop is O(shas x mails) and every heavy session grows BOTH
# factors, so this fails precisely on the sessions with the most to review. Single pass is
# O(shas + mails) and finishes in seconds.
#
# ⛔ TWO-PART PREDICATE: is this mail a review REQUEST, and does it name this sha (anywhere)?
# Neither half alone works, and THREE single-half versions have shipped and failed.
#
# v1 — whole-file `grep -rlF "$h" …` matched any mail that merely MENTIONED the sha, and a
# fleet broadcast quoting your own commit list is exactly that. MEASURED by a later check
# on one seat: 5 of 5 commits read `sent:1`; THREE had never been sent to anyone.
#
# v2 — subject-only, sha in subject. Fixed the above and introduced a WORSE, SYSTEMATIC blind
# spot. MEASURED against the RECEIVING side (104 real review requests held there): sha in SUBJECT 92, sha in BODY ONLY 12 — and ALL TWELVE ARE BATCH REQUESTS. A subject
# cannot hold nine shas, so a batch NECESSARILY puts them in the body: subject-only misses 100%
# of batches, and a batch is the shape carrying the most commits per request.
#
# v3 — REQUEST-MARKER on the subject, sha ANYWHERE. Verified on the sending side: 8 of 8
# sha-quoting broadcasts carry no request marker; the requests carry `--code`/`request`.
#
# v4 (this one) — SUBJECT MARKER **OR** FRONTMATTER `signal:` IN THE REQUEST/FOLD ALLOWLIST.
# v3's marker list is three literals, and a fold report whose subject reads `FOLD <sha>` matches
# none of them — the hyphenated `fold-verify` is not the word `FOLD`. MEASURED on one seat's
# own outbound corpus, 2026-09-04: of 148 sent mails, 20 hit on subject with NO signal at all
# (so the subject arm is load-bearing and this is a UNION, never a replacement —
# an archived shell-environment note, not in this copy: the fix for an incomplete sweep is routinely incomplete in the OPPOSITE
# direction), and 5 carried a fold signal their subject missed. Both arms over the same 227-sha
# creation-record set, 223 reachable from main: v3 called 148 UNSENT, v4 calls 141, and ALL SEVEN
# recovered commits are `fix(...)` — the risk-bearing class this section exists to catch, each
# one already sent inside a FOLD mail. The failure v4 removes is the SAFE direction (over-report),
# but 7 false alarms in the one class that matters is what teaches a reader to skim the section.
#
# ⛔ THE ALLOWLIST IS AN ALLOWLIST AND MUST STAY ONE — AND THIS IS THE OPPOSITE OF THE
# CONVENTION NEXT DOOR, so someone will "fix" it for consistency. `session-manifest.py`'s wake
# decision is a DENYLIST, correctly, because there an unrecognised signal must still WAKE you.
# HERE the safe direction is inverted: an unrecognised signal reading as NOT-a-request only
# over-reports a commit as unsent (safe), while reading as a request marks work reviewed that
# nobody reviewed — the exact false-clean v1 and v2 both shipped. A new signal type therefore
# gets ADDED here deliberately, never admitted by default.
# ⛔ `review-verdict` / `review-finding` / `review-ack` STAY OUT: on the SENDING side those are
# you reviewing SOMEBODY ELSE, so a verdict you write that happens to quote your own sha would
# read as "sent" — v1's bug by another route. `review-ack` is confirmed correct to exclude (hub
# store, 6 of 6 genuine acknowledgements of a verdict, none of them work sent for review).
#
# ⛔ BUT `deploy-review` IS IN THE ALLOWLIST, AND THE REASONING THAT EXCLUDED IT WAS WRONG.
# v4 shipped excluding it, arguing the cost was "zero" because all 5 of THIS seat's
# `deploy-review` sends are `--code request`s the subject arm already catches. That argument was
# weak by construction and it broke on the RECEIVING side, the corpus a
# sender's own store cannot see: at least one seat uses `deploy-review` as its REQUEST signal,
# 7 times, including an amendment to a QUEUED request that the subject arm misses. Corroborated
# here on a wider population — the WHOLE store rather than one inbox — 19 of 62 `deploy-review`
# mails carry a request-class subject. A seat's own outbound cannot answer "how do OTHER seats
# signal a request", so do not re-derive this exclusion from your own sends.
#
# ⚠️ KNOWN UNDER-REPORT, MEASURED, DELIBERATELY NOT FIXED HERE: `review-verdict` IS OVERLOADED.
# Four seats use it for "I folded your verdict, here is my commit" — which IS work exposed to a
# reviewer — as well as for "I reviewed you". The deciding set: 9 of 9 were FOLD reports.
# Whole store: 33 of 163 `review-verdict` mails carry a FOLD-class subject. So excluding it
# leaves a real hole and INCLUDING it re-opens v1. An allowlist cannot fix a token that means
# two opposite things — the fix is a convention (`fold-report` already exists, 10 in store), not
# a predicate. Recorded so the next seat does not re-derive it and close it the wrong way.
#
# ⛔ AND DO NOT REACH FOR A SUBJECT-ANCHORED `^FOLD` MARKER AS THE CLEVER FIX — MEASURED AND
# REJECTED 2026-09-04. It looks like it dissolves the overload, since fold reports announce
# themselves in the subject. It admits 231 store mails, and among them `FOLD-VERIFIED` (the
# REVIEWER confirming a fold) is a VERDICT sitting two letters from `FOLD-VERIFY` (the author
# requesting one). That near-miss is the same shape as the bug v4 exists to fix.
#
# ⛔ `find`, NOT a glob — zsh `nomatch` ABORTS the whole command on an empty store, BEFORE the
# loop body, so a `[ -e "$f" ] || continue` guard inside it is UNREACHABLE BY CONSTRUCTION.
# Measured both shells with a positive control: empty store, zsh -> `no matches found` and the
# command dies; bash -> reaches the end with n=0. The Bash tool runs /bin/zsh, so a bash test
# PASSES WITH THE BUG PRESENT — which is how it shipped. Hits any seat whose store holds no
# mail it sent, i.e. a fresh session running /summary.
V=$(mktemp)
find .claude/state/session-mail -maxdepth 1 -name "*__${SID8}.md*" -type f 2>/dev/null \
  | while IFS= read -r f; do
      # ⛔ SCOPE THE FIELD READ TO THE FRONTMATTER BLOCK. `grep -m1 '^signal:'` over the WHOLE
      # file takes the first match anywhere, so on a mail with no frontmatter signal a BODY line
      # beginning `signal:` is read as the header — the exact whole-file-regex hazard
      # `session-manifest.py` warns about beside its own `_parse_mail` ("a body-planted `signal:`
      # line must not be" trusted). awk stops at the closing `---`.
      fm=$(awk 'NR==1{next} /^---$/{exit} {print}' "$f" 2>/dev/null)
      hit=0
      printf '%s\n' "$fm" | grep -m1 '^subject:' \
        | grep -qiE -e '--code' -e 'review request' -e 'fold-verify' && hit=1
      [ "$hit" -eq 1 ] || printf '%s\n' "$fm" | grep -m1 '^signal:' \
        | grep -qiE '^signal: *(review-request|review-fold|fold-verify|fold-report|fold|deploy-review) *$' && hit=1
      [ "$hit" -eq 1 ] || continue
      grep -oE '[0-9a-f]{7,40}' "$f"
    done | sort -u > "$V"

while read -r s; do
  [ -n "$s" ] || continue
  # Drops amended / reset shas — AND is what makes the pattern above safe: a bracketed
  # `[word deadbeef]` in ordinary prose is discarded here because it is not a real commit.
  # ⛔ ANCHOR ON A SHARED REF (`dev`, THEN `main`), NEVER `HEAD`. `HEAD` resolves in the CURRENT checkout, and this box has
  # 38 worktrees of which 27 are DETACHED (`git worktree list`) — measured, as was the effect:
  # from a real detached worktree pinned to an older base, a genuine main commit is DROPPED
  # under `HEAD` and KEPT under `main`. That is not the branch-reachability caveat it looks
  # like — it discards perfectly reachable commits whenever the reader's own HEAD is behind,
  # which is the normal state of a worktree, and tells them their work was reviewed. `main` is
  # a shared ref resolving the same from every worktree; so is `dev`, where sessions commit
  # (dev-branch policy since 2026-09-08), and a dev commit reaches `main` only at a promote.
  { git merge-base --is-ancestor "$s" dev || git merge-base --is-ancestor "$s" main; } 2>/dev/null || continue
  h=$(git rev-parse --short "$s")
  # Lookup against the one pass above. `grep -F` is a SUBSTRING match on purpose: `$h` is the
  # short sha, and a mail naming the full 40-char form must still count.
  grep -qF "$h" "$V" && n=1 || n=0
  printf '%s  sent:%s  %s\n' "$h" "$n" "$(git show -s --format='%s' "$s" | cut -c1-60)"
done < "$MINE"
rm -f "$MINE" "$V"
```

**Cross-check before trusting a low number.** The retired trailer method is still a valid SECOND
instrument once you take the UNION of every spelling your own commits carry — different failure
mode, so agreement is real corroboration. Measured on the run that found this: creation-record
**42 shas, 41 reachable from `main`**; trailer-union **41**. A creation-record count that lands far
under the union's is the tell that a `-q`, a `tail`, or a redirect ate your confirmation lines
(§1 documents all three).

**Report the UNSENT set, then triage it — do not report a raw count.** Most commits in a heavy
session are tracker rows and plan prose, and listing those as "unreviewed" buries the two that
matter. LOC is a proxy for EFFORT, never for RISK/blast-radius, so triage on what the diff
TOUCHES:

| touches | disposition |
|---|---|
| a WIRED hook, a guard predicate, a gate, `settings.json` | **OWED — name it in the readout; `/wrap` or your next ordinary turn sends it** — failure is fleet-wide and silent |
| an ALWAYS-LOADED file (`.claude/rules/`, the project index, a band) | **OWED — name it in the readout; `/wrap` or your next ordinary turn sends it** — every session and sub-agent loads it, and lost meaning greps to nothing |
| `src/`, a migration, a new or edited test | **OWED — name it in the readout; `/wrap` or your next ordinary turn sends it** |
| tracker rows, plan prose, a memory router re-index | skip — say you skipped them and why, in one clause |

⛔ **THE DISPOSITION IS *CLASSIFY AND SURFACE*, NEVER *SEND* — `/summary` DOES NOT MAIL, AND THE
SUCCESSOR IS NAMED SO THERE IS NOTHING TO DECIDE HERE.** **Name what is owed and TO WHOM — sha, what it touches, which hub** — so the
successor re-derives nothing: `/wrap`'s own review step, or your next ordinary turn, whichever you
reach first. *(This read **send** at first, which collided head-on with this command writing nothing but
the plan. The collision was real as written — this table's two categories are OWED and skip, skip's
gloss prescribes only what the READOUT says about a skip, and the reason column prices NOT SENDING —
so it was resolved by naming a successor, not by carving an exception.)*

⭐ **WHY A SUCCESSOR RATHER THAN A CARVE-OUT, because the next reader will want to re-litigate it.**
Mail IS a disk write — `session-manifest.py` creates one file per message — so the rule that these
commands touch nothing but the plan was never wrong about mail; it was **underspecified about what
happens next**. A commit already had a named successor for exactly this shape (`post-compact/references/post-compact-detail.md` (not in this copy) § Step 6 — full text:
*"the commit belongs to `/wrap` Step 8 or the next ordinary commit, and this step's job is to SURFACE
that it is owed"*) and mail did not.

⛔ **WHAT NAMING A SUCCESSOR BUYS — REWRITTEN WHEN THE ANSWER FLIPPED BACK.** This paragraph has now held three
positions, and the history is written in because the flip is the instructive part. (1) It first read *"Naming one REMOVES the decision instead
of relocating it"*. (2) That broke within minutes: the successor did not send either — `/wrap` 5e was *"SURFACE (never block,
never auto-run)"* and 8a was *"⛔ ASK, NEVER SEND … it does not mail the hub on its own"* — so the chain ended at **the owner decides**, and this
paragraph was corrected to say a successor merely RELOCATES. (3) Both clauses were then struck: the seat judges whether a
review is warranted, sends it, and says in the closing message that it sent it and what it was, so the owner keeps the visibility and stops
being asked. So 5e and 8a now DECIDE and SEND, and naming a successor removes the decision after all — position (1), by a mechanism it did not
have when it was written. **This also re-agrees with the disposition table twelve lines up**, which said `OWED — name it in the readout; /wrap or
your next ordinary turn sends it` throughout; the table was right and the paragraph beneath it was wrong for one commit's life.

⛔ **AND THE WORDS "Verified at source" ARE WHY THIS ONE HAD TO BE HUNTED RATHER THAN NOTICED.** Position (2) carried them, honestly and correctly
at the time — and they are exactly what stops the next reader re-checking. A citation that rots UNDER them is worse than a bare one, and this was a
load-bearing premise in a design argument rather than a footnote, so the argument inherited the falsity and licensed *"the owner decides"* in an
owner-facing readout. ⛔ **The pointer to this paragraph was INSIDE the sentence being deleted:** the struck `/wrap` 8a text carried
*"(also cited at summary/SKILL.md:1010)"*, and the strike still missed it, because the edit happened in `wrap/SKILL.md` and nothing re-read the
condemned sentence for its own outbound pointers. Found in a file neither commit touched. **Check, whenever you strike a cited
claim: grep the TEXT YOU ARE DELETING for pointers to siblings, before you delete it — it is the last moment that list exists.**

What naming a successor actually buys is unchanged by all three positions, so it survives the rewrite: the handoff becomes **DURABLE and
LEGIBLE** — the owed item lands somewhere with a named next reader instead of in a readout that scrolls, nothing collides with the class rule,
and no seat has to judge anything mid-command.

⚠️ **BOUNDS, both load-bearing.** The creation-record is sound in ONE DIRECTION ONLY (§1, at
length): PRESENT ⇒ strong evidence you ran that commit; **ABSENT ⇒ NOTHING** — 16% of unpushed
commits carry no creation record in any transcript, and a `-q` / `tail` / redirect on your own
`git commit` deletes yours. **So this is a FLOOR, never a total, and it enumerates commits you
RAN — the right population for "did I send my own work for review" and the wrong one for
authorship.** And a sha absent from your sent mail is exact only because the grep keys on the sha
itself: if you described a commit to the hub without naming its sha, this reads it as unsent. That
direction is SAFE (it over-reports), and over-reporting is the correct failure for a net whose
whole purpose is catching an absence. ⚠️ **It fires in practice, so read the set before you act on
it:** measured 2026-08-30, one commit was reported unsent while the seat HAD told the hub its
reasoning in a fold-verify — without the sha. The commit still needed sending (the hub had been
left holding an open fork), so the over-report was right for a reason the grep could not see.

⛔ **AND THE OVER-REPORT RATE GROWS WITH COMMIT AGE, BECAUSE THIS INTERSECTS A PERMANENT SET WITH
AN EXPIRING ONE.** Step 1 enumerates from the transcript, which never decays; Step 2 checks the
mail store, which is PRUNED — `scripts/session-manifest.py` `MAIL_READ_TTL_HOURS = 24` and
`MAIL_UNREAD_TTL_HOURS = 72`. A review request a LIVE hub reads promptly flips to `.read` in
minutes and is deleted a day later, **so the better the review, the faster its evidence
disappears** — and the commit it covered reads `sent:0` forever. *(The 24h figure is the READ
TTL; a `deploy-*`-signalled mail keeps 72h, and `_is_verdict_mail` keys on the PREFIX, so
`deploy-review` REQUESTS inherit that carve-out too — 48 store files carry the signal. Erring
toward over-alarm, so a nit rather than a defect in the argument.)* Measured 2026-09-05: 238 shas
reachable, 149 `sent:0`, and a whole-store grep at 8 AND 9 characters found no surviving review
REQUEST for either risk-bearing sha — both of which had in fact been reviewed. ⚠️ *That sentence
said "ZERO mail naming either sha" until it was checked: two broadcasts naming both shas were
sitting in the store the whole time, one of them mine. The conclusion held; the prose overran the
bytes, which is the exact split named three paragraphs down.*

⭐ **SO BEFORE TREATING AN AGED `sent:0` AS A FINDING, ASK GIT — THE GIT PLANE OUTLIVES THE MAIL
PLANE.** `git log --all --grep='<sha>' --format='%h %s'` (never capped): a fold commit names the
verdict it folded, so `fold(<peer> verdict on <sha>)` IS the review record. ⛔ **BUT IT REACHES
FOLDED REVIEWS ONLY, AND A CLEAN APPROVAL IS THE LARGER CLASS — SO THE BEST-REVIEWED COMMITS ARE
THE ONES THIS REMEDY PERMANENTLY FAILS.** An APPROVED-no-findings verdict produces no fold commit,
so nothing on the git plane ever names its sha, and past the TTL the row reads `sent:0` with the
dismissal-burden clause below forbidding you to clear it. Measured 2026-09-05, uncapped: three
clean approvals returned **0 hits each**, against **6 / 3 / 3** for three fold-carrying shas. **So at fold-verify time write the verdict sha into a `todo.txt`
row — that row is the only durable record a clean approval ever gets**; the three that do clear,
clear through exactly such rows. ⛔ **This is not
licence to dismiss the row — a dismissal of your own instrument carries the same evidence burden
as the finding, so NAME THE ARTIFACT that proves it reviewed.** A dismissal without an artifact is
memory wearing an instrument's clothes, and it is worse than ignoring the row: ignoring leaves it
for the next reader, explaining it away spends the finding and hands the owner a false all-clear.

**An empty unsent set is a good answer** — "everything risk-bearing has been sent" — but say which
BASE you measured from, because the boundary is the whole claim.

⛔ **AND A FILE WRITTEN OUTSIDE THE REPO HAS NO COMMIT, SO BOTH STEPS ABOVE ARE BLIND TO IT —
RUN THE NON-GIT LEG EVERY TIME.** (The script is not in this copy: until you write it, say that this leg did not run, and do not write "nothing unreviewed".)

```bash
python3 scripts/non-git-writes.py        # EXACT = an Edit/Write outside the repo; POSSIBLE = a shell write naming such a path
```

Skip it and this section can read "nothing unreviewed" while a script the session wrote outside
the repository sits unreviewed — the commit-based steps above have no way to see it.
**Each listed path is either REVIEWED** (a frozen
dated copy plus its sha256 mailed to the hub, and the verdict named) **or carries a stated reason
on its own line** — a backup copy, a cache, a file only read. A review covers the sha256 it was
sent with: if the file's current sha256 differs, it is unreviewed again. ⛔ **A POSSIBLE row is a
heuristic over the command text — read the command before calling it a write; one that IS a write
owes exactly what an EXACT path owes**; rc 2 means no session id or not exactly one transcript
(or a transcript with no parseable record), an instrument failure and never an empty set. An empty set prints its own
`NONE` line; quote it. **And the closability verdict counts this leg**: an EXACT path, or a POSSIBLE
row read as a write, with neither a review nor a reason is a `ready to /wrap: no`.

## The plan table — PART OF THE DEFAULT READOUT; `--plan` retired

⛔ **`--plan` was being typed on nearly every run, so `/summary` lost the argument and its
function became the default — bare `/summary` now does what `/summary --plan` did.** Measured at
the change: 289 of 646 logged `/summary` invocations carried
`--plan` — and **289 of the 331 since the flag existed**
(first `--plan` in the log 2026-08-25T23:08:21Z; the other 315 predate it), so the in-era share is
87%, not 45%. Verified by a field-keyed parse (all 650 summary records parsed;
the substring count admits five `--plans` typos and misses `--olan` / `--pllan`, intent 291; bare
`plan` was typed zero times, ever). So bare `/summary` now runs the full Process
above AND appends the plan table — every run, no argument. `--plan` and the bare spelling `plan`
are ACCEPTED AND IGNORED (a no-op alias, so a queued or habitual `/summary --plan` still works
and produces the identical readout); never document them as a distinct mode again.

⛔ **THE ARGUMENT GRAMMAR, WHICH THIS FILE HAD NONE OF UNTIL 2026-09-13 — and the gap went live the
moment the plan table took `--light`'s shape.** The owner is told `/summary`'s output is now the
digest; `--full` is in the owner's muscle memory from the sibling command by that command's own account; the owner
types `/summary --full` and **nothing here defines it, and there is no documented route to a full
plan render from `/summary` at all.**

| typed | renders |
|---|---|
| bare · `--plan` · `plan` · `--light` · `light` · `-l` | the DEFAULT — full readout, digest-shaped plan table |
| `--full` · `full` · `-f` | the same readout with the WHOLE plan table — every live row, not the last 10 |
| anything else, or both flags together | the DEFAULT, never an error |

⚠️ **The `--full` row is a design pick, not part of the change** — the change named the default
only. And an unrecognised argument resolving to the DEFAULT rather than to the fuller render is the
one place this diverges from the sibling's fall-through-to-MORE rule, deliberately: here the default
is the shape that was asked for. Nothing parses any of this; it is prose the renderer reads.
*(Until this change the table was opt-in behind the flag; that history stays below.)*

The section it appends:

**Plan (table)** — the working plan's LIVE state rendered per the plan-display rule
(Item · Status · one-liner, composed IN the reply;
never a file pointer, never a verbatim paste).

⛔ **THE SHAPE IS `/working-plan --light`'s** — the `/summary` output mirrors `/working-plan
--light`. **Take the LAST 10 live-items rows in FILE order** — ⛔ **and SAY THE DENOMINATOR, e.g.
`10 of 45 live rows, last 10 in file order`: a digest that does not name what it dropped re-creates
the defect the full render exists to fix, and that clause is the one part of `--light` that must
survive being mirrored.**

⛔ **THE IMPORT IS BOUNDED, AND THE BOUND IS LOAD-BEARING: ONLY THE TABLE'S *SELECTION* AND ITS
DENOMINATOR TRANSFER. `--light`'s EXCLUSIONS DO NOT.** The source says `--light` renders no
chronology, no review ledger and **no closability block** — and `/summary` is REQUIRED to carry a
closability verdict (§ A closability verdict; the always-loaded trigger row says to state it
unprompted). **A seat that follows the pointer below to the source, reads "renders NO closability
block" and omits it has destroyed a required output by obeying this section.** Chronology
and ledger are arguably N/A for a `/summary` table; closability is NOT, and the silence resolved
the wrong way until this clause.

⭐ **LOCATING THE LAST 10 IS ITSELF AN ENUMERATION — A WINDOWED GUESS PRINTS A DENOMINATOR IT DID
NOT DERIVE.** `grep -nE '^#+ '` the plan → take the `## Live items` heading and the NEXT heading →
`grep -c '^|'` over that range minus the 2 header rows is N; the last 10 data rows before that next
heading are the selection. Measured on a real plan: 47 lines, 45 data rows, matching the exemplar.
**Never read the table by a fixed window — the same line that mandates the denominator calls an
underived one a WINDOW claim.**

⚠️ **TIE-BREAK, because two rules can disagree with no arbiter: the table carries THIS session's
items only, and a mechanical last-10 can land on a fleet row.** Skip it and take the next
this-seat row, so the count is honestly 10 — never print 9 under a "10 of N" denominator, and
never print the fleet row. Say in the denominator clause that you skipped. *(Read "Rows come from the plan file's NEWEST state blocks … plus the
sync fence" as the SELECTION rule until 2026-09-13 — supersession still governs what a row SAYS,
it no longer governs which rows appear.)*

⛔ **MIRROR THE POST-2026-09-13 `--light`, NEVER A QUOTATION OF IT.** Its ordering key changed the
same day this shape was adopted: it was *"by the date of the newest state block that touches
them"*, and that key is UNCOMPUTABLE — measured on a real plan, **4 of 45** rows appear verbatim in
any state block and the table carries no date column, no row id and no back-reference, so 41 of 45
had no derivation while the spec still mandated printing a claim the key was used. File order
replaced it. **A relay composed before that fold quotes the retired definition in good faith; read
`working-plan/SKILL.md` at HEAD instead.**

A row's CONTENT still comes from the plan's NEWEST state
blocks (a later block supersedes an earlier one where they conflict) plus the sync fence,
cross-checked against this invocation's own §1-§5 derivations where they overlap: **the table
must not restate a plan sentence a fresh derivation just contradicted** — the fresher reading
wins, the plan file is then BEHIND (say so in §6), and the plan gets fixed per the
update-at-state-change rule after the readout, not silently inside it. ⛔ **The per-item ROWS are the last 10 in FILE order per the shape rule above, their CONTENT taken from the newest state blocks; the SESSION-WIDE statements the readout carries — the closability verdict this run writes into the plan (the dated closability block, § A closability verdict above), the open-items count and the `Next — you` / `Next — me` split — derive over the WHOLE plan: every live row incl. ⏸/✅, every ledger row's terminal state, every dated block, this seat's open tracker rows — never the newest block. By ENUMERATION, never a whole-file read: `grep -nE '^#+ '` over the plan, then each block by anchor — the plan is over the Read tool's 262,144 B ceiling — ⚠️ **MEASURE IT, never cite a number here: `wc -c` the plan.** *(Read "(1.4 MB on this seat)" until 2026-09-13. That figure was correct for the plan it was taken from and WRONG as written, because "this seat" reads as the seat doing the reading in a file every seat reads. Measured the same day, four plans: 1,431,174 B / 1,929,895 B / 346,672 B / 353,896 B — **5.46x, 7.36x, 1.32x, 1.35x.** All four are over the ceiling, so the clause holds on every one of them and never depended on the number; a reader on a 1.32x plan who checks the 1.4 MB claim finds it false and may discard a true finding with it. The figure had also aged 5.34x -> 5.46x in four hours.)*, so "cannot afford" is never the reason and a WINDOW claim is only what a run that did not enumerate writes. ⛔ TWO POPULATIONS, ONE SLOT — the text chooses UNION: §5's tracker predicate returns rows this seat FILED, the plan's own queue and live-item rows are the second population, and the `Next — me` / `Next — you` split is their UNION — a plan row absent from the tracker and a tracker row absent from the plan are both members; neither alone is the split.** *(This clause read "the `Closability` row" until 2026-09-13 — a row the table never prescribes.)*

This extends the plan-display rule — this section CITES that rule rather
than duplicating its format spec, so the two cannot drift.

⛔ **THE TABLE CARRIES THIS SESSION'S ITEMS ONLY.** A fleet item relayed for awareness never
appears as a table row — unattributed placement among this seat's rows reads as this seat's
work (measured: another session's /admin arc sat in the table and read as this seat's own
work). Fleet items live on the `Next — fleet:` line, origin-tagged, per §2.

**Cell register:** Status cells, one-liners and item names follow § Output shape's *Write the readout in the owner's register* paragraph. `/post-compact` 7b reaches this table and §2 by pointer, never § Output shape, so this line is its route to that rule.

## Output shape

Compact. Net state over narrative. The owner is re-entering a long session and needs
orientation in one screen, not a chronicle.

⛔ **THE COMPACTION COUNT IS A SELF-CONTAMINATING GREP — COUNT `isCompactSummary`, NEVER THE
MARKER PHRASE.** The header slot below asks for a number and this file never said how to derive
it, so the natural instrument is a phrase-grep for the continuation marker — which matches **this
spec's own text** the moment `/summary` loads it into the transcript, plus every turn that
discusses compaction. Measured 2026-08-03: a run reported **3 compactions** from 6 line-hits; the
field-true count was **1**. Filter on the discriminating FIELD instead:

```bash
python3 - <<'PY'
import json, os
p = f"{os.environ['HOME']}/.claude/projects/<project-key>/{os.environ['CLAUDE_CODE_SESSION_ID']}.jsonl"
n = sum(1 for l in open(p, encoding='utf-8', errors='replace')
        if '"isCompactSummary"' in l and json.loads(l).get('isCompactSummary') is True)
print(f"compactions: {n}")
PY
```

**Why it recurred: the class was fixed once with a single-file `done-when`, so the row went
`[x]` while the class stayed open, and this spec re-introduced it from scratch 16 days later.
When a fix is a CLASS, the row's predicate names the class, not the first instance.** Chain:
`references/cases.md` § Output shape.

```
## Session <sid8> "<name>" — <n> days, <n> compactions

**Bottom line:** <one-to-two PLAIN sentences: what happened and what needs the owner. Someone who did not watch this session must be able to act on it. No coined name as the subject, no unit-bearing number, no sha, no path, no rule id — those belong in the slots below. If nothing needs them, say so; never invent a stake to fill the slot.>

**Landed:** <one sentence: what this session actually accomplished, net>

**Closability:** <ready to `/wrap`: yes / no — then what the wrap will still carry. Never "safe to close" or "closing costs X": the wrap IS the close. Derived over the WHOLE plan (§ The plan table).>

**Git:** <n> unpromoted, not yet on main (FLEET — no per-session count) · <n> unpushed to origin/dev · <n> dirty · HEAD <sha> <subj>

**Needs you:**
- <item — THIS seat's arc only; a fleet-originated item goes to `Next — fleet:` (§2)> — <why yours> · <cost of silence>

**In flight:** <agents/monitors/reviews, or "nothing">

**Filed with triggers:** <n> — <one-line each, or "none">

**Unreviewed:** <n risk-bearing commits this seat shipped that no reviewer has seen — name them and what they touch; or "everything risk-bearing has been sent". State the BASE you measured from. Tracker/plan-only commits are excluded, say so in a clause.>

**Plan file:** <IN SYNC, OR N commits behind — this is about the FILE, never the work. ⛔ "current"
is banned here: `Plan: current` was read as "the plan is done" on the line's first live run.
Say "plan file in sync" or "plan file N behind", and never let it sit next to the
open-items count where it can be read as a verdict on them.>

**Next — you:** <… — a step outside this terminal carries its click path: where, which control, what done looks like (§5)>   **Next — me:** <…>
**Next — fleet:** <items from OTHER sessions' arcs, each as a compact clause tagged with its origin
session's NAME (`session-manifest.py who`; sid8 only when unnamed) — e.g. "the post-deploy recheck (<session-name>)". These carry the owner's DEFAULT
attention exactly like §2 items — the split is origin, not importance (§2). Omit the line when empty.>

## Plan

<the plan TABLE — Item · Status · one-liner, per the plan-display
rule, in `--light`'s shape — the last 10 live-items rows in FILE order WITH THE DENOMINATOR STATED,
their content from the plan's newest state blocks (§ The plan table) — its SESSION-WIDE
statements (the open-items count, the closability verdict, the you/me split) derive over the WHOLE
plan by heading enumeration (§ The plan table, 2026-09-13) — and cross-checked against this run's own
derivations. PART OF EVERY READOUT (see § The plan table). Never a
file pointer, never a verbatim paste; this session's items only.>
```

Omit any section that is genuinely empty rather than printing a hollow heading. Never pad.

**Write the readout in the owner's register (measured 2026-10-15).** Numbers as digits. A **Needs you** item is named by what it changes for a user or for the owner, never by a label coined in this session (`Fix 2`, `Caveat 3`, `#<n>`, "the arrived hold") unless the same sentence says what the label is: the owner asked what 10 of 14 such lines meant. In the **plan table**, the Status cell is plain words (such as done · in progress · waiting on review · waiting on you · filed for later, keeping any qualifier the status earned: "done, one partial run"; a time it needs goes in the one-liner), never a glyph alone, a sha, an `HH:MMZ` time or a verdict code; the one-liner is a sentence with a subject and a verb; the item says what it is. The owner asked what 12 of the 16 plan rows quoted back meant, against 4 of 19 `Next — you` lines. A row waiting on the owner's decision is also listed under **Needs you** and one waiting on a step the owner takes under **Next — you**, so `Needs you: nothing` never sits above a row that waits on the owner's ruling; a row §2 dropped (the owner deferred it, or it closed) says that in its Status cell instead.

## Anti-scope

- **One ARTIFACT, never a persistence pass.** ⛔ **This clause has been corrected TWICE and the
  history is the point.** It read *"No writes"* until the fenced sync was allowed; it then read
  *"One write, fenced"* until the fence restriction was removed outright, so that it can update
  the working plan without limits. **The command may now write anywhere in this session's working plan and nowhere
  else.**
  **The axis that survives both corrections is judgment vs. measurement, and it is what still
  separates this from `/wrap`.** `/wrap` decides which lessons survive, what a decision meant,
  what enters memory, what gets committed — and it writes to memory, trackers, the decisions log
  and git. `/summary` derives numbers, reports them, and keeps ONE file honest. Widening its
  reach inside that file did not make it a lighter `/wrap`; it made it able to finish its own
  job, which was always "leave the plan true".
  ⚠️ **What the fence used to guarantee structurally is now a duty:** correct in place, never
  regenerate; supersede a stale verdict with a dated block rather than editing the old one; do
  not delete a section merely because this run did not re-derive it. The plan file's own
  convention already said all three — the fence was standing in for it.
- **No narrative.** "We investigated X, then found Y, then corrected Z" is the shape the
  owner is trying to avoid by asking. Report where it landed.
- **No project-tracker sweep.** That is `/status`. Cite it, do not inline it.
- **No self-assessment.** Not the place for how well the session went. State, not grade.
- **No fleet gossip.** §3's bound is load-bearing.
- **Never a substitute for `/wrap`.** Running `/summary` at session end does not discharge
  the wrap gauntlet, and the spec must not imply it does.

## Revisit

- If 3 invocations produce a §2 that is always empty, the owner-decision queue is not the
  live need and the command should re-center on §1+§3 — or fold into `/status`.
- If the owner repeatedly asks a follow-up question the output did not answer, add that as
  a section; the recurrence *is* the spec.
- If §1's derivation proves repetitive across ≥3 runs, promote it to a
  `scripts/session-summary.mjs` (the `architecture-counts.mjs` shape) so the numbers stop
  depending on the composer at all — the endpoint the Iron rule is reaching toward. Not
  built at N=1: the content is heterogeneous (git + mail + decisions + task state) and a
  premature script would harden the wrong shape.

## Provenance

Built per `/meta new-skill`. The Iron rule and the capped-instrument rule are both codified from
the 2026-07-27 night in which five sessions produced nine restatement errors and four
sessions independently mis-read a capped instrument's silence as absence — the evidence
that a mid-session readout needs to be *derived* rather than *composed*.
