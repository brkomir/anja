# /summary — the plan table, the output shape, anti-scope, revisit, provenance

**Not loaded on an invocation.** `../SKILL.md` is the core that every run and every compaction carry; this file holds § The plan table, § Output shape (with the full readout template), § Anti-scope, § Revisit and § Provenance as they stood in `SKILL.md` before the spec was slimmed (2026-10-25): each `## §` heading below names the source line range, and the text under it is the original. **Where this file and the core disagree, the core wins.**

## § The plan table (SKILL.md, lines 1217-1315)

## The plan table — PART OF THE DEFAULT READOUT; `--plan` retired

⛔ **THE PLAN TABLE IS NOW THE DEFAULT: `/summary --plan` was being typed habitually, even queued for
the next turn, so the flag was folded in and bare `/summary` carries its functionality.** Measured at
the time: 289 of 646 logged `/summary` invocations carried
`--plan` — and **289 of the 331 since the flag existed**
(first `--plan` in the log 2026-08-25T23:08:21Z; the other 315 predate it), so the in-era share is
87%, not 45%. Verified 2026-09-05 by a field-keyed parse (all 650 summary records parsed;
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

⛔ **THE SHAPE IS `/working-plan --light`'s SINCE 2026-09-13**: the `/summary` output was asked to
match `/working-plan --light`, with the change routed to the seat that owns the `--light` definition.
**Take the LAST 10 live-items rows in FILE order** — ⛔ **and SAY THE DENOMINATOR, e.g.
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

The table extends the plan-display rule — this section CITES that rule rather
than duplicating its format spec, so the two cannot drift.

⛔ **THE TABLE CARRIES THIS SESSION'S ITEMS ONLY.** A fleet item relayed for awareness never
appears as a table row — unattributed placement among this seat's rows reads as this seat's
work (2026-09-02: another session's arc sat in the table and was taken for this seat's own
work). Fleet items live on the `Next — fleet:`
line, origin-tagged, per §2's rule.

**Cell register:** Status cells, one-liners and item names follow § Output shape's *Write the readout in the owner's register* paragraph. `/post-compact` 7b reaches this table and §2 by pointer, never § Output shape, so this line is its route to that rule.


## § Output shape (SKILL.md, lines 1316-1388)

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
When a fix is a CLASS, the row's predicate names the class, not the first instance.**

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
session's NAME (`session-manifest.py who`; sid8 only when unnamed) — e.g. "the recheck (<session name>)". These carry the owner's DEFAULT
attention exactly like §2 items — the split is origin, not importance (§2). Omit the line when empty.>

## Plan

<the plan TABLE — Item · Status · one-liner, per the plan-display
rule, in `--light`'s shape — the last 10 live-items rows in FILE order WITH THE DENOMINATOR STATED,
their content from the plan's newest state blocks (§ The plan table) — its SESSION-WIDE
statements (the open-items count, the closability verdict, the you/me split) derive over the WHOLE
plan by heading enumeration (§ The plan table, 2026-09-13) — and cross-checked against this run's own
derivations. PART OF EVERY READOUT since 2026-09-05 (see § The plan table). Never a
file pointer, never a verbatim paste; this session's items only.>
```

Omit any section that is genuinely empty rather than printing a hollow heading. Never pad.

**Write the readout in the owner's register (measured 2026-10-15).** Numbers as digits. A **Needs you** item is named by what it changes for a user or for the owner, never by a label coined in this session (`Fix 2`, `Caveat 3`, `#<n>`, "the arrived hold") unless the same sentence says what the label is: the owner asked what 10 of 14 such lines meant. In the **plan table**, the Status cell is plain words (such as done · in progress · waiting on review · waiting on you · filed for later, keeping any qualifier the status earned: "done, one partial run"; a time it needs goes in the one-liner), never a glyph alone, a sha, an `HH:MMZ` time or a verdict code; the one-liner is a sentence with a subject and a verb; the item says what it is. The owner asked what 12 of the 16 plan rows quoted back meant, against 4 of 19 `Next — you` lines. A row waiting on the owner's decision is also listed under **Needs you** and one waiting on a step the owner takes under **Next — you**, so `Needs you: nothing` never sits above a row that waits on the owner's ruling; a row §2 dropped (the owner deferred it, or it closed) says that in its Status cell instead.


## § Anti-scope, Revisit, Provenance (SKILL.md, lines 1389-1433)

## Anti-scope

- **One ARTIFACT, never a persistence pass.** ⛔ **This clause has been corrected TWICE and the
  history is the point.** It read *"No writes"* until 2026-08-25, when the fenced sync was
  allowed; it then read *"One write, fenced"* until 2026-09-03, when the fence restriction was
  removed outright. **The command may now write anywhere in this session's working plan and nowhere
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
