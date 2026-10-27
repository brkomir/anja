# /summary — the tracker-row predicates (§4 filed-with-triggers, §5 next actions)

**Not loaded on an invocation.** `../SKILL.md` is the core that every run and every compaction carry; this file holds, with the copy's edits, Process §4 and §5 with every code-block comment, failure narration and bound as they stood in `SKILL.md` before the 2026-10-25 slim. Beyond the copy's edits nothing was paraphrased: each `## §` heading below names the source line range, and the text under it is the cut-and-pasted original with those edits, so a phrase of the old spec usually greps here. **Where this file and the core disagree, the core wins.** Older incident records: `cases.md`.

## § 4 — filed-with-triggers delta (SKILL.md, lines 443-509, with the copy's edits)

### 4. Filed-with-triggers delta

What got parked THIS session *with a concrete trigger* — `todo.txt` rows, `BACKLOG`
entries, deferred items. Derive from the row's own provenance field, never from a bare
`git log` on the tracker files — that log is FLEET-WIDE and every peer writes `todo.txt`,
so it answers "what got filed" and not "what I filed":

⛔ **THE PREDICATE MUST SCAN THE ROW BLOCK, NOT THE ROW'S FIRST LINE** — a line-scoped form
under-reported **16×** (rows average ~7 lines; provenance sits on a CONTINUATION line), and a
count of 1 reads as "I filed one thing": confident, specific, wrong, with no prompt to look.
Incident: `references/cases.md` (not in this copy) § 4.

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
# the first lowercase letter, so it read a prose-named row as a row named
# `F` and put that in an owner-facing list (2026-08-31). Measured on the live
# tracker: 620 of 1871 rows (33%) are not ALLCAPS-named, and old-vs-new disagree on 481
# OPEN rows. Anchor on the checkbox alone, take the id when there is one, else label with
# the prose. A row opening with an audit label then prose deliberately prose-labels rather
# than reading the label: the label is for the owner, and the fuller line is the more useful one.
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
# `filed: 2026-09-03 by <sid-A> (grep for prior art run by <sid-B> and re-run by me: ...)`, whose
# matched span ran from `filed:` all the way to the sid in the parenthetical. Fleet-wide that form
# claims 557 rows against 555 real ones: 3 false positives, and it MISSES one true row whose
# `filed:` field is WRAPPED (`filed:\n  2026-09-03 by <sid-C>`) because `[^|\n]*` cannot cross the
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


## § 5 — next actions, split by owner (SKILL.md, lines 510-722, with the copy's edits)

### 5. Next actions, split by owner

Two short lists: **yours** (decisions, approvals, external facts only you hold) and
**mine** (work I can do without you). If "mine" is empty, say so plainly — that is the
signal the session is genuinely idle rather than quietly stuck.

⛔ **ONE TOKEN FOR "WAITING ON THE OWNER":** a row blocked on the owner writes
`owner-pending: <why — taste call | external fact | irreversible action | spend | merchant-verified page | rule change>` on the row. The older
spellings (`needs-owner`, `owner: owner` / `owner: the owner` / `founder` / the owner's first name, `blocked-on: owner`,
`OWNER-DECISION`, `awaiting owner`) stay readable through the fleet board's alias list
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
point here (this line said it did until 2026-09-30), so at a wrap the
clause reaches a step only through a standing memory rule. Measured: three sessions in three days handed the owner
such a step and each time the owner had to ask how to do it, with that memory rule loaded.

⛔ **WHEN THIS SEAT HAS COMMITTED WORK THE OWNER CAN SEE ON STAGING AND GitHub's `dev` DOES NOT HOLD IT
YET, "MINE" CARRIES "AT THE END OF MY /wrap, IF NEEDED"; "YOURS" CARRIES THE LOOK ONLY ONCE IT HAS LANDED (the push
moment: only at /wrap, and skipped unless needed).** A `dev` push now happens only
as the optional last step of `/wrap` or when the owner asks for one, and the wrap SKIPS it unless the owner is waiting to look or a promote
is next (`/wrap` Step 12). So a mid-session readout never promises a push: it says the change is not on staging yet and
that the owner can say "push" if the owner wants to look sooner; if the owner is waiting to look, "mine" carries *"push at the end of my /wrap"*. Once it lands, hand the owner the
staging link with the click path the rule above requires. Check with `git rev-list --count origin/dev..dev` after a
`git fetch origin`: non-zero and something user-visible among this seat's commits ⇒ say so in the readout, and the
push belongs in "mine" only when Step 12's conditions hold (the owner is waiting to look, or a promote is next), minus `/push` § D0's
stops (a promote in flight, a live hold). **TELL: "Next — you" asks the owner to look at a change that only exists on this machine.** Measured
once: a readout left user-visible changes unpushed and the owner had to ask why they were not pushed to `dev`
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
# `filed: 2026-09-03 by <sid-A> (grep for prior art run by <sid-B> and re-run by me: ...)`, whose
# matched span ran from `filed:` all the way to the sid in the parenthetical. Fleet-wide that form
# claims 557 rows against 555 real ones: 3 false positives, and it MISSES one true row whose
# `filed:` field is WRAPPED (`filed:\n  2026-09-03 by <sid-C>`) because `[^|\n]*` cannot cross the
# newline. The shaped form below fixes both — it says what the field IS (the filer is the token
# right after the date) instead of budgeting characters.
# ⚠️ `\s` CROSSES NEWLINES, which is what recovers the wrapped field — and it is SAFE HERE ONLY
# because both call sites apply this per ROW BLOCK, so it cannot span into the next row. Do NOT
# copy this into a whole-file scan without re-deriving that. (The owner predicate above needs the
# opposite, `[^\S\n]`, for the reason failure 8 documents.)
def FILED_BY(sid):
    return r'filed:\s*[0-9-]*\s*by ' + re.escape(sid) + r'\b'
# ⛔ THE `owner:` ALTERNATIVE IS ANCHORED AT BOTH ENDS, AND IT WAS UNBOUNDED HERE UNTIL
# 2026-09-08 (a review finding). `scripts/summary-plan-sync.mjs` has carried the bounded
# form since a review finding on 2026-08-25; this snippet did not, and a hand-run `/summary` executes
# THIS one — the checker's own docstring says the spec IS the implementation. Measured on the
# two forms: `downer: <sid>` claimed the row, and `owner: <sid>ff` PREFIX-claimed it, under the
# unbounded form and under neither anchor of the script's. ⚠️ `scripts/summary-owner-predicate-
# check.py` could not have caught this — it extracts `owner_line` and `owner_pipe` only, never
# this claim predicate, and it compares SPEC-section to SPEC-section rather than spec to script.
pat = re.compile(FILED_BY(sid) + r'|\bowner: *' + re.escape(sid) + r'\b')
# ⛔ AN EXPLICIT PEER `owner:` OVERRIDES `filed: by me`. Filing a row and OWNING it are
# different facts, and this predicate ORs them — so a row you WROTE and a peer OWNS matches
# on the first alternative and lands in "mine". Measured 2026-08-26 on one seat: of six
# rows returned, one carried `filed: by <sid-A>` AND `owner: <sid-B>`,
# was reported to the owner as "mine, actionable", and had ALREADY been handed to <sid-B> in a
# triage report that omitted it.
# ⛔ FAILURE 7 (2026-08-30, measured): the `^`-anchor alone MISSES the inline `| owner: X`
# form, which this tracker uses on 41 of its 197 owner fields — 8 owned by one seat, 2 each by
# two others, 4 `needs-owner-ruling`, 2 `OWNER`. So the exclusion arm was blind to
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
# reports the live misattributions. The residue is tracked as an open row.
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
    # THIS PREDICATE DID NOT READ. Measured 2026-09-02 on one seat: three rows were reported
    # to the owner as "actionable without you" and NONE was. One of them
    # carries `📌 STANDING RULE — NOT DOABLE-NOW WORK … it should never appear in a
    # next-actions list` — a request in the row's own text that no code honored. Doing it was
    # approved and the work turned out not to exist.
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
    # ⛔ AND THIS PREDICATE IS ONE OF TWO POPULATIONS (2026-09-13): the plan's own
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

