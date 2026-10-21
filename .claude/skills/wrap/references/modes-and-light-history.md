# Light mode and mode-spelling history — moved, with the copy's edits, from `.claude/skills/wrap/SKILL.md` (split under the per-file size line, a growth signal and not a delivery limit, 2026-09-26)

## Light mode — the ×3 attribution error — from `SKILL.md` § When to Use (tail of the paragraph, split at a sentence boundary)

⚠️ **This corrects a same-day error worth naming, because the failure was attributional rather than arithmetic: the first version of this block fixed ×3 (6 MB) as "the" light multiplier and stated it INSIDE a paragraph quoting someone else's range — so a reader took ×3 as a ruling when it was the author's own conservative pick off the bottom of that range.** Caught on the very first `--light` run: no 6 MB ceiling had ever been agreed, and two slices would have done where three were made. Measured on that run: a 12.9 MB window gave **3 slices at ×3** and **2 at ×5** — one wasted agent (**~89-108k tokens measured**, not the ~250k this sentence claimed until 2026-09-13) on a flag whose entire purpose is saving them. **A rule that says "prefer the smaller multiplier" inverts the flag's goal and only ever binds when it costs nothing; the tie-break belongs at the TOP of the band, not the bottom.**

## Light mode — who picked the multiplier, and why it is a flag — from `SKILL.md` § When to Use

⚠️ **GENERAL FORM, and it is the reusable half: an owner gives a RANGE, and a spec written from it must not silently collapse the range to one end and then present that end as the owner's.** If the author picks a point inside the band, the block says WHO picked it. Attribution laundering is invisible to every reviewer who was not in the conversation.

⛔ **IT IS A FLAG, NEVER A DEFAULT CHANGE, AND THAT DISTINCTION IS THE WHOLE JUSTIFICATION.** The 2 MB default was set back to net-window-fit after a flat-5MB DEFAULT was refuted as front-door widening at an UNMEASURED in-context-coverage cost (see the slice bullet in 1b-DEEP for the full derivation and the same-day 2→5→2.4→2 history). That objection is to widening the front door for every wrap; it does not reach an owner typing an explicit flag with the tradeoff stated. **Do not "simplify" this by moving 6 MB into the default — that reverts the 2 MB default itself.**

## Light mode — the checkpoint grep must exclude the current invocation — from `SKILL.md` § When to Use

⛔ **AND THE CHECKPOINT GREP MUST EXCLUDE THE CURRENT INVOCATION — IT DOES NOT BY DEFAULT, AND THE FAILURE IS A SILENT NEAR-NO-OP.** `grep -n '<command-name>/wrap' "$TXT" | tail -1` matches the `/wrap` you are running RIGHT NOW, so `CP` lands at the end of the transcript and the scan window collapses — **reported as a completed deep-pass either way.** ⚠️ **The COLLAPSE MAGNITUDE IS NOT A CONSTANT AND THE “few KB” FIGURE IS DATED:** 1 slice over ~2,800 bytes measured 2026-09-03, but the current run's own ~223 KB skill-body injection sits inside every self-match window, so a self-matched window measured **1.02 MB** on 2026-09-09 — a plausible-looking slice at the 2 MB rule. Size cannot discriminate; the `CP < CUR` gate can. Measured on this clause's own first run, 2026-09-03: the naive form returned line 38629 of 38629; a 200-line exclusion window still returned 38240, because the *spec injection plus the command* put **six** `/wrap` markers inside the current turn. ⛔ **THE FIX IS THE DERIVATION IN STEP 1b-DEEP — DO NOT ANCHOR ON A TURN-START LINE AND DO NOT ASK THE OPERATOR FOR ONE.** *(This clause prescribed exactly that until 2026-09-09 and had been RETIRED at the derivation itself since 2026-09-05, where the block says so in capitals because the operator got the number wrong on two consecutive wraps of one session — 0.24 MB against a true 42.1 MB, then 0.21 MB against 9.79 MB. Both were caught by a then-live size check. ⛔ **THAT BACKSTOP IS ITSELF STRUCK AS OF 2026-09-09 — do not read this sentence as an endorsement of it** (found at a later check, after my own struck-tell grep keyed on the phrase I remembered writing and missed this line; grep the CLAIM, never the sentence). The retirement of the turn-start prescription does NOT rest on the backstop: it rests on the operator having got the number wrong 2 of 2, which is evidence about the primary method and is unaffected by what caught it. The catching net is now the exact `CP < CUR` comparison in the derivation block, not a KB threshold. Two contradictory prescriptions, 200 lines apart, both reaching every wrap seat whole, with the retired one first in the file.)* Read the derivation block and run it: it filters on record FIELDS, collapses the adjacent marker pair, and drops the current run's own marker unconditionally.

## Modes compose — spelling alignment and the per-line sweep boundary — from `SKILL.md` § The modes COMPOSE, and all three are FLAGS — `/wrap --checkpoint --light --sonnet`

**⭐ THE SPELLINGS WERE ALIGNED THE SAME DAY, AND THE ALIGNMENT
IS WHY THAT `SKILL.md` SECTION IS SHORT.** Checkpoint mode was the bare word `/wrap checkpoint` while its
sibling was the flag `/wrap --light` — one mode a word, one a flag, for no reason anyone had
recorded. Worse, `--checkpoint` already existed one layer down as a `session-lifecycle.py` argument
that Step 0 passes internally, so the flag-looking spelling of the word meant a different thing on
a different surface. **Both modes are now flags, and the command flag and the script flag are
deliberately the SAME WORD** — Step 0 now reads `--checkpoint` twice in a row, and that redundancy
is the point rather than a defect.

⚠️ **THE BARE WORD `/wrap checkpoint` REMAINS AN ACCEPTED ALIAS, PERMANENTLY, AND NOT OUT OF
POLITENESS.** It is the spelling in armed `/autorun` work-orders that quote the owner VERBATIM, in
the decision log, and in dozens of older session and tracker records. Renaming those would edit quoted owner speech and rewrite history to match a
convention invented after it. **Live prescriptive surfaces were swept to the flag form** — the wrap
skill file (`SKILL.md`), `review-hub/SKILL.md`, `whoami/SKILL.md`, `session-lifecycle.py`, `session_status.py`;
**records were deliberately left alone.**

⛔ **THE BOUNDARY IS PER LINE, NOT PER FILE — the first sweep got
this wrong everywhere except inside the wrap skill file (`SKILL.md`).** The population is MIXED at line level, so
file-level triage sends a prescription to "records" whenever it shares a file with a quote.
Measured examples: one memory file has its **Action:** line
(prescription, swept) three lines from a quoted owner remark
(record, kept); the memory index's trigger row carries prescriptive action
text on the highest-read surface in the repo and was missed by the first pass. **Cost of getting
it wrong: the invariant is falsified on its most-read surface, so the next reader cannot use "is
it swept?" to infer "is it a prescription?" and has to re-derive the whole boundary by hand.**

⛔ **AND SWEEP THE GENERATORS FIRST — a template inside the protected class erodes the boundary
faster than any un-swept record.** `autorun/SKILL.md`'s cron-prompt template is copied VERBATIM
into every armed work-order, so leaving it while declaring those work-orders off-limits
means the protected class keeps growing new instances of the retired spelling — and a future
reader auditing adoption cannot separate drift from history, which is the one distinction the
boundary exists to preserve. Swept 2026-09-03 (its `description:` frontmatter too, the same
surface corrected on `/summary` for exactly this reason).
