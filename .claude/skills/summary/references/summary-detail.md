# /summary — detail by step (header, the rules, §1-§3b, §6)

**Not loaded on an invocation.** `../SKILL.md` is the core that every run and every compaction carry; this file holds, with the copy's edits, the header, the Distinctions table, the Iron rule, the population and capped-instrument rules, the retired Receipts row, Process §1, §2, §3, §3b, §6 and the second act as they stood in `SKILL.md` before the 2026-10-25 slim. Beyond the copy's edits nothing was paraphrased: each `## §` heading below names the source line range, and the text under it is the cut-and-pasted original with those edits, so a phrase of the old spec usually greps here. **Where this file and the core disagree, the core wins.** Older incident records: `cases.md`.

## § Header (SKILL.md, lines 6-29, with the copy's edits)

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

⛔ **UNLIMITED REACH IS ABOUT REACH, NOT ABOUT METHOD — CORRECT IN PLACE, NEVER
REGENERATE.** The fence was never a limit on `/summary`'s usefulness; it was a guarantee that a
measurement pass could not silently overwrite judgment somebody hand-wrote — a closability
verdict, a review ledger, an owner ruling quoted verbatim. That guarantee is now yours to keep
by discipline instead of by structure, and it is the plan file's own standing convention:
**a correction REPLACES the text it corrects, rows
are edited IN PLACE and never deleted or aged out, and closure is a dated status flip.** Rewrite
a hand-written section only where it is WRONG, and say what it used to say when the owner could
have acted on the old version. **Deleting a section because this run did not re-derive it is the
one outcome the old fence made impossible and this change does not license.**

## § Distinctions (SKILL.md, lines 31-42, with the copy's edits)

## Distinctions — what this is NOT

| Command | Scope | Timing |
|---|---|---|
| `/status` | **Project** trackers — `git status --short`, tracker counts, plans, migrations | any time |
| `/orient` | **Session start** — inbound mail, drift sentinels, peer scan, blindspot prime | session START |
| `/wrap` | **Session end** — the persistence + hanging-work gauntlet, writes to memory/trackers | session END |
| `/peers` | **Who** is working in the repo and on what | any time |
| **`/summary`** | **THIS session's net state** + the owner-decision queue | **mid-session** |

`/status` answers "where is the *project*." `/summary` answers "where is *this session*,
and what do you need to decide." They overlap on git and diverge everywhere else.

## § Iron rule, population rule, capped-instrument rule, retired Receipts row (SKILL.md, lines 44-100, with the copy's edits)

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

⛔ **RETIRED — the readout no longer ends with a `Receipts:` row, because the row went
unread; an unverified number says so IN its own sentence.** §1-§5 still DERIVE
everything, which was always the load-bearing half. The retired form + its panel provenance:
`references/cases.md` § Receipts row.

## Process

Run these, then compose **only** from their output.

## § 1 — Git, including the resolve recipe (SKILL.md, lines 102-264, with the copy's edits)

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
  grep ' commit ' resolve.txt | cut -d' ' -f1 > good.txt                     # keep what resolves (cut, not awk:)
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
  paths*. Measured 2026-09-05 against an empty list: it returned two numstat lines, a rules file and
  a peer's session plan, both a PEER's commit, rc=0, no stderr. This is
  `.claude/traps/shell-traps.md` § NEVER INTERPOLATE A POSSIBLY-EMPTY LIST INTO A SCANNING COMMAND, and
  `xargs` does NOT rescue it — BSD `xargs` runs the command once with no arguments on empty input
  and has no GNU `-r`. **Found by asking the one question the author had not
  listed: is the fixed instrument's OUTPUT distinguishable from the failure it replaces?** It was
  not. A derivation that returns a plausible answer for a real reason and a plausible answer for a
  broken reason has fixed nothing — it has only moved the lie.
  ⛔ **AND THE TWO BUGS ARE NOT INDEPENDENT — THE SECOND ONE'S FIX HAS A HOLE SHAPED LIKE THE
  FIRST (a review verdict, folded at the same hour).** The empty-list branch fires
  exactly when NOTHING resolves, and bug (1) is the thing that produces that state: a session
  that writes ABOUT the `[main <sha>]` format and commits little extracts mostly documentation
  instances, all of which are missing, so `good.txt` empties and the recipe confidently reports
  HEAD's paths as that seat's. **So the reachability of the serious defect is not incidental — the population
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
  AND COUNTING IT OVER-STATES YOUR EXTRACTION'S BREADTH (a minor review finding, folded 2026-09-05).**
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
  Since a later change, the `Claude-Session:` trailer is TOOL-stamped at the commit choke point.
  Both incident chains: `references/cases.md` § 1.

⛔ **DO NOT REPORT A PER-SESSION COMMIT COUNT TO THE OWNER AT ALL — the instrument this
section used to prescribe is RETIRED (see below). Report the FLEET unpushed
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
  commit the turn this correction was written: ` arch-counts sync` (private index) sat
  directly above ` commit: todo(review-congestion): …` (ordinary), in one `-20` window.
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


## § 2 — the owner-decision queue (SKILL.md, lines 265-356, with the copy's edits)

### 2. The owner-decision queue — the section the owner came for

One line per item blocked on the owner, named by what it changes (§ Output shape, the register paragraph). Each line: **what** · **why it needs them**
(which of the six owner-only reasons; the owner-column row in `.claude/orchestrator/conventions.md` lists them) · **what happens if they say nothing**.

⛔ **THIS-SEAT ITEMS ONLY — a fleet-wide list is confusing in a session's readout, because the
owner cannot act on it in that moment, so fleet items get their own `Next — fleet:` field.** §2
carries only decisions arising from THIS session's own work. An
owner-pending item another session filed or is carrying (a post-deploy check, a peer's blocked
deploy) goes to the **`Next — fleet:`** line in the output shape instead — one compact clause per
item, each tagged with its ORIGIN session's NAME (sid8 only when it has none), no elaboration. ⚠️ **The split is by ORIGIN, not
importance: anything that comes up fleet-wide needs the owner's attention by default.** A fleet item still carries the owner's
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
grep -nF '<ROW-NAME>' todo.txt            # or DECISIONS.md DECISIONS-ARCHIVE-*.md / plans/<doc>.md / BACKLOG.md / IDEAS.md
#    ⛔ IDEAS.md is IN the list: an owner-deferred pipeline idea lives ONLY there, so omitting it
#    made check 1 return nothing and the gate rule it "closed" — the memory hole reached by
#    process rather than by deleting a byte (2026-08-26).

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


## § 3 — in-flight work (SKILL.md, lines 357-372, with the copy's edits)

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


## § 3b — queue position (SKILL.md, lines 373-442, with the copy's edits)

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
  MY outbound, where no closure instrument looks. **A caution accepted 2026-09-13: run
  only the request scan, it reads clean in exactly the state both seats were in that day.**
  ⛔ **READ ITS ROWS, NEVER ITS COUNT — IT IS MAIL-ONLY, SO A PROMISE DISCHARGED BY A NON-MAIL ACT
  READS OPEN.** A lens you announced and then actually DISPATCHED, a fix you announced and then
  COMMITTED, a row you said you would file and then FILED — the delivery happened off the mail
  plane, the tool cannot see it, and the promise reports OPEN. It says so in its own caveat and
  reports a FLOOR. Demonstrated live the hour this was wired: two OPEN rows against
  one seat, both lenses it had dispatched, both cleared by reading the rows. **Reporting that count
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


## § 6 — working-plan currency, the sync, and the second act (SKILL.md, lines 723-883, with the copy's edits)

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
change: a plan's closability blocks were dated 08-30 and 08-31 and read at wrap on 09-03, two
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
- **EVERY SESSION-WIDE STATEMENT — a closability verdict, an open-items count, the owner/mine split, a "nothing owed" — derives over the WHOLE plan; the sites named in this file are instances of that rule, not its bound.** A closability verdict derived from the newest block alone is WINDOW-scoped however fresh it is — the newest block carries the delta, not the population. Derive the verdict, the open-items list and the owner/mine split over the WHOLE plan (every live row incl. ⏸/✅, every ledger row's terminal state, every dated block, this seat's open tracker rows) — the founding case: the 14:45Z digest read one block of 225 and called the session SAFE while 84 tracker rows and a day-one trigger sat open. ⛔ **THE WHOLE-PLAN READ IS AN ENUMERATION BY HEADING, NEVER A WHOLE-FILE `Read` — and "a read the run cannot afford" was the wrong name for the failure (a review verdict, 2026-09-13):** a long session's plan is over the Read tool's 262,144 B hard ceiling — ⚠️ **MEASURE YOURS (`wc -c`); every figure here is per-plan and has no fixed referent.** *(Read “this seat's at 1,400,000 B, 5.34×” until 2026-09-13: “this seat” resolves to whoever is READING in a file every seat reads. Four plans measured that day spanned 346,672 B to 1,929,895 B — 1.32× to 7.36× — and ALL of them are over the ceiling, so the rule holds on every one and never depended on the number.)*, so the tool REFUSES the whole file rather than the run declining to afford it, and an escape phrased as a budget call is taken every time, which turns the rule into a labelling convention. The method: `grep -nE '^#+ ' <plan>` enumerates every heading at every level (~49 KB on the 1.4 MB plan, against ~350K tokens for the file), then each dated block, the live-items list, the ledger and the queue sections are read by anchor with `offset`/`limit`. **Anchor on `^#+ `, never on `###` alone** — the closability supersession chain sits at `##`, `^###` reaches 41 of 223 dated headings on that plan, and the split inverts on other plans. A WINDOW claim (*"for the <arc>"*) is what a run writes when it did NOT enumerate, and it names the blocks it read.
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
step rather than a detector — recommended 2026-09-03 as the ≤5-line "wire something that
already exists" shape.

⚠️ **THE BASE RATE, AND THE FIRST NUMBER I PUT HERE WAS ATTACHED TO THE WRONG PREDICATE.** This
clause read *"~2% of 913 plan-file commits"* for one commit's life. Over ~920 commits touching a
session plan since 2026-08-01, measured on re-derivation after the figure was flagged as
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


