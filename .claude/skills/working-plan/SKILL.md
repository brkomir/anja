---
name: working-plan
description: Update the session working plan to the current state change and render it WHOLE, per the codified display rule. Use when the owner asks to see the plan, or when the plan itself is the question rather than the session's position — the fast path to "show me the plan". Full is the default since 2026-09-13; `--light` renders the last 10 live-items rows in FILE order instead. Owner-invoked.
---

# /working-plan — update the plan, then show it the codified way

The plan has a codified way to be presented on request, and this command both updates it and
shows it that way. Two acts, always both, in this order: **UPDATE** the session working plan to the
current state change, then **SHOW** it per the codified display rule.

**Carries its own marker `[working-plan]`** — the mode marker is visible: every reply is marked, so one-shot no longer means unmarked. Still one-shot like `/summary`, not a flow.

## Distinctions

| Command | Scope |
|---|---|
| `/summary` | THIS session's net position + owner-decision queue + fleet numbers; brings the WHOLE plan current — fence and prose alike, without restriction |
| `/summary --plan` | RETIRED 2026-09-05 — its functionality folded into bare `/summary`, which carries the plan table on every run; the flag is an accepted no-op alias |
| **`/working-plan`** | the PLAN artifact only: bring it current, render it **WHOLE** — no fleet derivation, no decision-queue rebuild. ⛔ **Full is the DEFAULT since 2026-09-13; `--light` is the opt-in digest** |
| **the typed PHRASE — *"show me the plan"*** | ⛔ **NOT THIS COMMAND'S RENDER. The two are kept different** — the typed phrase gets the short table (Item · Status · one-liner); `/working-plan` gets the full render (every live row, the review ledger, dated history, closability, queue split). The always-loaded trigger row and the display rule both answer the PHRASE and are CORRECT as written; they do not contradict the inversion, they answer a different request. **A typed phrase in conversation is a lighter ask than a deliberate command invocation, and the two must not converge.** |

⛔ **SINCE 2026-09-03 THESE SHARE ONE WRITE DUTY, AND THE DISTINCTION IS THE READOUT — NOT
WHAT EACH IS ALLOWED TO TOUCH.** `/summary`'s fence-only restriction was removed, so it can
update the working plan without restriction, and both commands now bring the whole plan current by the same method: correct in place, supersede a stale verdict
with a dated block, never delete a row.

⭐ **`/post-compact` IS THE THIRD MEMBER since 2026-09-04** — updating the working plan is a mandatory part of it, under the same write exception as `/working-plan` and `/summary`. Its Step 6 is MANDATORY, which the other two are not, and the reason is the one place a stale plan actually costs something: a compaction is when the plan stops being redundant with your context and becomes the only copy, and `/post-compact` is the only procedure guaranteed to fire at that moment. *Read "THE TWO" until then.* **The class rule, all three: they may write THIS SESSION'S working plan and nothing else on disk — no commit, no mail, no tracker edit, no memory write.**

**This command is NOT redundant — it is the cheap path.**
`/summary` pays for a fleet-wide git derivation, an owner-decision-queue rebuild and a mail
peek before it gets to the plan; `/working-plan` skips all of that and answers *"show me the
plan"* directly. Reach for this one when the plan is the question, and `/summary` when the
session's position is.

## Process

1. **Locate**: `ls plans/session-${CLAUDE_CODE_SESSION_ID%%-*}-*.md | LC_ALL=C sort | tail -1` (the order `summary-plan-sync.mjs` findPlan and `session-start.sh` use, so all three name one file). None ⇒ say
   so and offer to open one per your own record (`feedback_session_working_plan_file.md`, not in this copy) — do not invent a file.
   If the per-turn reminder hook is nagging, the offer IS the create path — accepting it
   silences the nag. ⚠️ The `%%-*` prefix here and
   `working-plan-reminder.sh`'s `tr '[:upper:]' '[:lower:]' | cut -c1-8` coincide only because
   a UUID carries exactly 8 hex chars before its first hyphen — keep them in agreement; a
   third consumer reads one shared helper rather than re-deriving.
2. **UPDATE — the state-change duty, not a transcription pass.** The plan's hand-written
   sections update **at the state change, not at the next commit**. Before rendering, ask: has anything landed,
   closed, or been ruled since the newest state block? If yes, write the delta into the plan
   NOW (a dated state section — `##` and `###` are BOTH live heading forms in this corpus, so
   enumerate them with `grep -nE '^#+ '`, never `^###` alone: on this seat's plan `###` reaches 41
   of 223 dated headings and the closability chain sits at `##` — or
   an owner-queue/mine-queue revision — derived from events this session, never restated from
   memory of the file). If nothing moved, write
   nothing — an idle-run must be a no-op on the hand-written sections.
3. **Sync the fence**: `node scripts/summary-plan-sync.mjs` (CURRENT | UPDATED | NO-PLAN).
   The fence is the only machine-written region; everything else stays hand-written.
4. **SHOW.** ⛔ **The DEFAULT render is the WHOLE plan — jump to § The WHOLE plan is the DEFAULT
   render and follow its six-part order. The single table described in the rest of this step is
   the `--light` render, reached only when the owner asks for it.** Render per
   the display rule in your own record (`feedback_session_working_plan_file.md`, not in this copy) (cite it, never duplicate its format spec): **Item · Status · one-liner,
   composed IN the reply — never a file pointer, never a verbatim paste.** Rows come from the
   plan's NEWEST state blocks (a later block supersedes an earlier one where they conflict);
   carry every qualifier a status earned (a "green (one partial run)" never flattens to
   "green"). The fence's row dump is NOT the table — the table is the judgment-level plan
   (arcs, rulings, queues), not 167 tracker names.
5. **Close with the queue split**: what needs the OWNER vs what runs without them — read from
   the plan's own queue sections, freshened by step 2. ⛔ **AND RUN `/summary` §3b's QUEUE-POSITION
   PROCEDURE — it binds both commands by name**, so nobody has to ask or think whether the review hub
   needs a nudge. Cited,
   not duplicated, so the two cannot drift: three reads, and the third — **open your own outbound and
   read the REQUEST SENTENCE for every PENDING sha** — is the one no closure instrument on either
   side can do for you, because a sha MENTIONED is not a sha REQUESTED. **Say the result in the split
   even when it is empty.** ⛔ **Derived over the WHOLE plan — every live row incl. ⏸/✅, every ledger row's terminal state, every dated block, this seat's open tracker rows — never the newest block or the digest (a digest that read one block of 225 once called the session SAFE while 84 tracker rows and a day-one trigger sat open). EVERY session-wide statement this command makes — the split, the closability line, any "nothing owed" — derives the same way; the sites named in this file are instances, not the bound.** ⛔ **THE WHOLE-PLAN READ IS AN ENUMERATION BY HEADING, NEVER A WHOLE-FILE `Read` — and "a read the run cannot afford" was the wrong name for the failure:** a long session's plan is over the Read tool's 262,144 B hard ceiling (this seat's at 1,400,000 B, 5.34×; the largest on the tree 7.36×), so the tool REFUSES the whole file rather than the run declining to afford it, and an escape phrased as a budget call is taken every time, which turns the rule into a labelling convention. The method: `grep -nE '^#+ ' <plan>` enumerates every heading at every level (~49 KB on the 1.4 MB plan, against ~350K tokens for the file), then each dated block, the live-items list, the ledger and the queue sections are read by anchor with `offset`/`limit`. **Anchor on `^#+ `, never on `###` alone** — the closability supersession chain sits at `##`, `^###` reaches 41 of 223 dated headings on that plan, and the split inverts on other plans. A WINDOW claim (*"for the <arc>"*) is what a run writes when it did NOT enumerate, and it names the blocks it read.

## The WHOLE plan is the DEFAULT render; `--light` is the opt-in digest

⛔ **THE DEFAULT INVERTED** — `/working-plan` now does what `/working-plan --full` did, and a
lighter parameter (`--light`, roughly the last 10 items) is the opt-in. **Bare `/working-plan`
renders the WHOLE plan.** `--full` survives as an accepted no-op alias — it is in this file's history, in
commit bodies and in the owner's muscle memory, and it now asks for what already happens.

*Read "`--full` — the WHOLE plan, not the headline table" and "Bare `/working-plan` keeps the
digest" until 2026-09-13.* The flag was added the day before, after a rendered plan read as
truncated, and **one day of use answered the question that flag was hedging: the digest was never
the thing wanted, so it should not be what a bare invocation returns.**

**The compact table is a DIGEST and on a long session it reads as the whole plan.** That is the
defect it was built for, and the numbers have since grown past the ones that motivated it: a
session with **53 state blocks, a 46-row live-items table, a review ledger and ten superseded
closability verdicts** renders as eight rows and looks complete. A reader cannot tell a summary from
the thing itself — which is precisely why the digest is now the thing you have to ASK for.

**The render runs steps 1-3 UNCHANGED** — the update duty and the fence sync are not optional and
not different — **then replaces step 4's single table with the whole plan, in this order:**

1. **Live items** — EVERY row, including `↳` sub-rows and the ⏸/✅ ones the digest drops. The
   digest keeps only what is moving; the DEFAULT render keeps what is TRUE.
2. **The review ledger** — per work unit: what state it is in, who holds it, what is owed.
3. **State chronology** — the dated blocks at EVERY heading level (`##` and `###`; enumerate with `grep -nE '^#+ '`, 2026-09-13) NEWEST FIRST, one to three lines each. ⛔ **A
   block that CORRECTS an earlier one renders WITH its correction** — the corrections are the
   part a digest always eats, and they are usually the part the owner most needs.
4. **Standing directives + constraints** — what this session is holding itself to.
5. **Closability** — the NEWEST verdict, and say it supersedes earlier ones rather than printing
   the chain. ⛔ The newest verdict is the newest READING; it is the session's verdict only if it was derived over the whole plan (by the heading enumeration in step 5 — the whole file cannot be `Read`) — if it names an arc, a block or a compaction, say that it is scoped to that. ⚠️ A closability bullet rewritten in place under its old stamp is a residue measured at 15% of the commits touching this seat's plan (77 of 511; 14 of 22 stamped pairs keep the stamp) — the newest verdict must DATE its newest content.
6. **The queue split** — step 5 above, unchanged.

⛔ **STILL COMPOSED IN THE REPLY. `--full` IS NOT A FILE PASTE AND NOT A POINTER** — a `cat` of the
plan is the one output that satisfies neither mode. ⛔ **The display rule
does NOT govern both modes — it knows nothing about modes
and prescribes exactly ONE shape, the short table, which is the PHRASE's answer.** What it governs
here is the composed-in-the-reply requirement, which both modes share. *(Read "the display rule …
governs both modes" until 2026-09-13 — a checkable claim about a sibling file that the sibling file
does not carry.)* The plan file carries its own provenance, mid-row corrections
and byte-level supersession notes; the reply carries the STATE those add up to.

⚠️ **Scale it, do not truncate it.** If the plan has grown past what one reply can carry, say which
sections you compressed and by what rule — never silently drop rows, which is the exact failure
this flag was created to fix.

⛔ **AND ON A LONG SESSION COMPRESSION IS THE EXPECTED CASE, NOT THE EXCEPTIONAL ONE — say so in the
render rather than treating it as a confession.** Found by USE, not by reading: an invocation under
the new default, minutes after it landed, compressed one day's chronology to one line per arc, and
showed that the spec tells the renderer to scale rather than truncate and to say which sections it
compressed, but does not say the compression is EXPECTED on a long session — so a renderer meeting the clause above as an exception will either bloat the reply or
silently drop rows, which are the two failures this section exists to prevent. **A 53-block, 46-row
plan does not fit a reply at full width and never will; the honest render states its compression
rule up front and keeps every row.**

## `--light` — the digest, opt-in since 2026-09-13

**The last 10 live-items rows in FILE order, and nothing else.** The request framed it as roughly the
last 10 items — a RANGE, with no ordering specified. ⭐ **The request left the ordering open; I picked
it, and this sentence says so because the pick is mine to own:** take the last 10 rows of the
live-items table as they appear in the file, and render Item · Status · one-liner exactly as step 4
describes. Rows are appended and never deleted, so file order needs no judgement and is arguably the
plainer reading of the request.

⛔ **THE PREVIOUS DEFINITION WAS UNCOMPUTABLE AND THE SPEC STILL MANDATED CLAIMING IT.** *(Read
"order the live-items rows by the date of the newest state block that touches them" until
2026-09-13.)* Measured on this command's own plan file: **4 of 45** live-items rows appear verbatim
in any of the 56 state blocks, and the table carries no date column, no row id and no
back-reference — so for **41 of 45** the key had no mechanical derivation, while the clause below
required printing a sentence asserting that key was used. **Unfalsifiable to the reader, which is
worse than an unlabelled cut.** Blast radius was zero — **0 of 93 logged invocations** — and would
have escalated on first use.

⛔ **SAY THE DENOMINATOR — for example `10 of 45 live rows, last 10 in file order`.** ⚠️ *That
example is MINE, not a quotation: the italic-quote form in this file marks quoted words, so an
author-written exemplar is set plainly instead.* A digest that does
not name what it dropped is the defect the full render exists to fix, and a `--light` that hides
its own cut re-creates it one flag over.

⚠️ **It renders NO chronology, NO review ledger and NO closability block** — those are what make
the full render long, and a reader asking for `--light` is asking to skip them. **The queue split
stays regardless**, because that is the part the owner acts on — and it is derived over the WHOLE plan even here (by the heading enumeration of step 5): `--light` shrinks what is SHOWN, never the population a session-wide statement is made over.

**Accepted spellings: `--light`, `light`, `-l`.** `--full`, `full` and `-f` are accepted no-op
aliases for the default. Bare `/working-plan` renders the whole plan.

⭐ **BOTH FLAGS AT ONCE, OR ANY UNRECOGNISED ARGUMENT, FALLS THROUGH TO THE FULL RENDER — and that
is the inversion's best under-sold property rather than an oversight.** Nothing parses these args;
they are prose. So the failure direction is safe BY CONSTRUCTION: a typo, a half-remembered flag or
`--light --full` together all yield MORE than the owner asked for, never less, which is the one direction
this command's whole history says matters.

## Anti-scope

- Never a `/wrap` substitute; no memory writes, no tracker edits, no mail.
- No fleet numbers (unpushed counts, dirty counts) — that is `/summary`'s lane; a plan table
  with fleet numbers goes stale the moment it is written.
- The commit of a plan update follows the normal commit discipline (safe-commit, declared
  paths); committing is allowed but not mandated per-invocation — batch with the next commit
  when one is imminent.

## Revisit

If 3 invocations in a row hit step 2 as a no-op AND the owner only ever wanted the digest,
collapse this into `/summary` (which carries the plan table by default since 2026-09-05) and retire the command. If the owner asks for a
different table shape twice, the display rule (not this file) is where the fix lands.

⚠️ **And the inversion has its own revisit, because it is one day old and rests on one day of use.**
**The thing to measure is which one the owner TYPES, not which one reads better here.**

⭐ **THE INSTRUMENT EXISTS AND THIS SECTION ASKED A HUMAN TO REMEMBER INSTEAD.** `log-skill-invocations.sh` already records
every invocation with `args` — **a bare invocation records as an EMPTY STRING, which is a RECORD,
not an absence** — and `source`, which separates typed from agent-invoked (90 typed to 3 across 93
records at 2026-09-13). One field query answers the whole revisit:
`grep '"skill":"working-plan"' .claude/logs/skill-invocations.jsonl`

⛔ **AND THE KILL CRITERION AS FIRST WRITTEN COULD BE PERMANENTLY DISARMED BY ONE CURIOUS USE.**
*(Read "if `--light` is never once invoked across 5 full renders" until 2026-09-13.)* Read
naturally that is a one-shot: a single exploratory invocation on day one — the LIKELY case with a
flag the owner has not seen — retires the criterion forever and the section then survives on that one use.
And "5 full renders" is about **fifteen hours** at the measured 7.7 renders/day, against a revisit
whose own premise is that it rests on one day. **Make it ROLLING:** if `--light` is 0 of the last
20 TYPED invocations, the digest has no audience — cut the section and say so. If it is more than
half of them, the inversion was wrong and the honest fix is to put the default back rather than
keep a flag the owner has to remember.
