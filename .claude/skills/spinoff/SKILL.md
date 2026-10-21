---
name: spinoff
description: Hand substantial unexpected work to a FRESH session without losing what this session already learned. Writes a self-contained brief to plans/, files its durable row, and hands the owner a one-line paste that makes the new session pick it up and run. Use when work surfaces mid-session that is real, is bigger than the current thread, and would either derail this session or be lost. The brief itself declares whether the new session reports back to the parent and at which checkpoints — decided from the nature of the work, not from a flag.
---

# Spinoff — hand real work to a fresh session, with its context intact

A session finds something substantial that does not belong in the thread it is
in. The two default outcomes are both bad: do it here and the current work
derails, or write "worth looking at" and lose every premise the discovery cost.
This command is the third option — spend the context ONCE, while it is hot, on a
brief a fresh session can act on cold.

**Why it exists:** the same procedure kept being reached for by hand — a session
that runs into unexpected substantial work writes a proper brief for a fresh
session, producing a plan file and a one-line paste for that new session, and
everything from there fires automatically.

**The recurrence is measured, not felt:** 32 `plans/*brief*` files exist,
**14 created in the 14 days to 2026-09-05, 6 in the last 48 hours** — each one
hand-shaped, each one a slightly different format, none of them carrying a
re-verification contract. Derive it again before quoting it:
`git log --since='<date>' --diff-filter=A --name-only --format='' -- 'plans/*brief*' | grep '^plans/' | sort -u`

## Distinctions — what this is NOT

| Command | Runs where | Runs when |
|---|---|---|
| `/agent-work` | sub-agents inside THIS session | now |
| `/autorun` | THIS session, later, via a local cron | at a set time |
| `/mail` | a peer session that already exists | when they read it |
| `/fleet-inquiry` | many live seats, one lead | owner-invoked |
| **`/spinoff`** | **a session that does not exist yet** | **when the owner pastes the line** |

The closest neighbour is `/autorun`, and the difference is the one that matters:
autorun runs a work-order in THIS session's context, which is exactly what you
do NOT want when the point is a clean head. `/mail` needs a live recipient. This
needs neither.

⛔ **It is not a way to avoid work you should do now.** A spinoff costs the owner
a paste and a second terminal. Work that fits in this session belongs in this
session — `behavioral-anti-patterns.md` #2 and #3 govern, and "spin it off" is a
new and very comfortable costume for a defer. **The bar is BOTH: substantial
(the fix is bigger than the note) AND out-of-thread (doing it here derails work
the owner is waiting on).** One without the other is not a spinoff.

## ⛔ The Iron rule — a brief is a CLAIM, and its reader has no way to check you

Every premise a brief carries gets laundered. A fresh session has no context to
doubt it with, and if the brief feeds a panel, a wrong premise comes back as
N-way convergence — the strongest-looking evidence the system produces.

So the brief is written under two hard rules and the run mode enforces the
second:

1. **CITE every load-bearing premise** at a `file:line`, a pasted command
   output, or an owner quote. A premise you cannot cite is one you invented.
2. **The brief states its own expiry.** It was written at a HEAD that many
   sessions are committing to; prompt versions, line numbers and tree state rot
   within minutes here. Every brief carries the sha and timestamp it was written
   at, and **run mode re-derives before it acts**.

## Usage

```
/spinoff <topic>                  write the brief + the one-liner        (default)
/spinoff run plans/<brief>.md     what the FRESH session runs            (the one-liner)
/spinoff status                   open spinoffs this session owns
```

## Process — create (`/spinoff <topic>`)

**1. Test the bar out loud.** Name (a) what makes it substantial and (b) what
makes it out-of-thread. If you cannot say both in one sentence each, do the work
here or file a row — do not spin it off. Say which you chose.

**2. Research it NOW, while the context is hot.** This is the whole economic
case for the command: the discovering session already knows where to look, and
that knowledge is what the fresh session cannot reconstruct cheaply. Derive at
source, run the greps, read the code. **Do not delegate this to the child** — a
brief that says "investigate X" has moved zero work and spent a paste.

**3. Draft the brief to `plans/spinoff-<slug>-<YYYY-MM-DD>.md`** using the
template below. Fill every section or strike it explicitly; an empty heading
reads as "nothing here" and is how a real constraint goes missing.

**4. File the durable row.** One `todo.txt` row naming the brief path, its
trigger, and its owner. The brief is the payload; the row is what `/triggers`
and every later sweep can reach. A brief with no row is invisible the moment
this session ends.

**5. Decide the parent contract and write it into section 7** — always, one way or
the other. It is a property of the WORK, not a flag you remembered to pass; the
test is in its own section below.

**6. Commit** — brief + row together, explicit pathspecs, hand-counted
`--add`/`--del` through `scripts/safe-commit.sh`. An uncommitted brief is one
peer's bare commit from being reverted.

**7. Hand the owner the one-liner and nothing else.** One fenced line, ready to
paste, plus at most two sentences on what the new session will do with it.

## The brief template

```markdown
# Spinoff — <one-line statement of the work>

**Paste this into a fresh session:**

    /spinoff run plans/spinoff-<slug>-<date>.md

Written by session <sid8> at <HEAD sha>, <UTC timestamp>, on a branch many
sessions commit to. **Re-derive every number below before acting on it** — the
commands are inline so that costs one call each.

## 1. What the work is, and why it is not being done in the parent session
## 2. What is verified, with the command or file:line for each claim
## 3. What is NOT known — named, not implied
## 4. First moves — the concrete opening steps, in order
## 5. Done-when — what makes this finished, in checkable terms
## 6. Out of scope — including anything the owner has on hold, named as held
   with NO ask attached
## 7. Parent contract — <none, and why | report back at these checkpoints>
```

⭐ **Section 4 may hand over a DECISION rather than a task, and that is the commoner case — say which.** Test-fired 2026-09-05 against a real brief written by hand an hour before this command existed: its first move was *run this panel with these lenses*, not *make this change*. The template fits it, but the spec did not SAY so, and a reader with an execution-shaped template in front of them will force a design fork into a task list. **A decision spinoff names the fork, the lenses, and what each branch costs; it does not pre-answer it.**

⛔ **Section 6 is the one that gets skipped and the one that causes damage.** The
parent session usually holds owner deferrals the child knows nothing about. A
child that re-raises a held item converts the owner's answer back into a
question they have to answer twice. **Carry the hold forward as a named
constraint, never as context the child may act on.**

⛔ **SECTION 5 IS A CONTRACT, AND A CRITERION NAMING A MECHANISM YOU HAVE NOT READ IS A CLOSURE TRAP.** Writing *"…and the ratchet accepts it"* into a done-when asserts that the ratchet can accept it. If you have not read that mechanism you do not know, and the child inherits a contract it may be unable to close by doing the work correctly — the one failure a diligent child cannot work around, because every criterion reads satisfiable until it is tested. Measured 2026-09-06: a brief's done-when #4 was an AND-list over a ratchet the author had not opened; the child audited the brief, found the exit locked from the inside, and the parent had to fix the brief mid-run. **TELL: a criterion cites a mechanism by name and you have not opened its source this session.** Open each one, or write the criterion in terms of the artifact the child produces rather than the gate it must satisfy.

## Process — run (`/spinoff run <file>`) — what the FRESH session does

**1. Read the brief whole.** Not a grep, not an excerpt — a truncated brief
reads exactly like a complete one.

**2. Re-derive before acting — this is the step the command exists for.**
Check the brief's HEAD sha against current HEAD. Re-run the commands in its
section 2. **Any premise that no longer holds is reported, not worked around**:
say which claim died, and stop if the work rests on it. A brief is a snapshot of
a tree that has since moved.

**3. Run section 4 in order**, applying the normal rules of whatever the work
is — this command hands over a task, it does not exempt it from anything.

**4. Close on section 5**, and update the parent's `todo.txt` row with the
outcome. The row is the shared surface; it is what the parent will read.

**5. Honour section 7 — and ESCALATE it if the work turns out to touch the
parent.** A `none` written at brief time is a prediction, and you are the first
party in a position to know it was wrong.

## The parent contract — declared in the brief, decided by the work

⭐ **This is a property of the BRIEF, not a flag on the command.** The first version put it behind `--supervise`, which was wrong for
two reasons. The switch sat next to a wire that was already connected: every
brief records the parent's session id in its header, so the address was never
the missing piece. And the flag is passed at INVOCATION time, before the
research that reveals whether the work touches the parent at all — so the
decision was being made at the one moment nobody could make it. The brief is
also the only artifact the child actually reads; a contract living anywhere else
is a contract the child can miss.

**So section 7 is always written, and it is decided from the nature of the
work.** In effect it is a supervisor mode: the brief can instruct the fresh
session to report to the parent along the way, for instance when the spinoff
work affects or even blocks work the parent session still has to do — and
whether it does depends on what the job requires.

### The deciding test — report back if ANY of these is true

1. **The answer changes what the parent does next.** The parent has work whose
   shape depends on how this comes out.
2. **The two will collide on the same files.** Name the paths in section 6 as
   well; two sessions on one branch is two writers.
3. **The parent has already told the owner something this could falsify.** A
   claim in the parent's readout that the child's work could overturn is the
   sharpest case — the correction has to reach the owner through somebody.

**None of the three ⇒ write `none` and say why in one clause.** An unconditional
report-back is noise: it puts a message in front of a session that has no move
to make with it.

⚠️ **`none` is a PREDICTION, and the child is better placed than the parent to
know it was wrong.** If the work turns out to touch the parent — a file
collision surfaces, an answer lands that invalidates something the parent said —
the child escalates: it adds the contract, mails the parent, and writes the row.
Nothing about a brief is frozen; it was written by someone who had not done the
work yet.

The contract, when there is one, written into section 7:

- **The parent's 8-hex session id**, and the checkpoints at which the child
  mails it — typically: *premise died*, *blocking answer known*, *done*.
- **The mechanism.** The child sends with
  `python3 scripts/session-manifest.py mail-send --to <parent-sid8> --signal <token>`;
  the parent, if it wants to wait, arms
  `mail-await --signal <token> --from <child-sid8>`. Both already exist — this
  command wires them, it does not add a transport.
- ⛔ **It degrades, it never blocks.** A parent session can be gone by the time
  the child has an answer, and no instrument tells the child whether it is
  alive — session liveness is not observable here, only jsonl recency, which a
  wrapped session and a live one share. **So the durable `todo.txt` row is the
  primary channel and the mail is the notification.** A child that cannot reach
  its parent writes the row and tells the owner. It never waits on a reply and
  never treats silence as an answer.
- **The parent owes the child one thing back:** if the parent's need dies —
  the work got done another way, the owner dropped it — the parent mails the
  child and strikes the row. An orphaned supervision contract is a session doing
  careful work nobody is waiting for any more.

## Honest limits — state these when you hand over the one-liner

- **"Fires automatically" means the paste fires it.** Nothing starts a fresh
  session on its own; the owner opens a terminal and pastes one line. What is
  automatic is everything after that.
- **The brief is only as good as the research step.** A thin brief moves the
  work without moving the knowledge, and the fresh session pays the discovery
  cost again with less context than the parent had.
- **Two sessions on one repo is two writers.** The child commits to the same
  shared `main`; if the parent is still editing the same files, say so in
  section 6 and name the paths.

## Anti-scope

- Not for work that fits in the current session (that is a defer wearing a new
  costume — the bar in step 1 is the gate).
- Not a dispatcher: it writes a brief and hands over a line. It never opens a
  session, never dispatches an agent, never fires a panel itself.
- Never smuggles the parent's owner-deferred items into the child's ask.
- No auto-invocation. A session does not decide on its own to spin work off —
  the owner does, because the owner pays the paste and the second terminal.

## Revisit

Codified on measured recurrence (6 brief files in 48 h).
**Re-measure after 5 spinoffs:** if the run-mode re-derivation in step 2 finds a
dead premise in a material share of them, briefs are being written too far ahead
of their use and the create step needs a freshness bound. If section 7 reads `none` on
all 5, the contract half was speculative — cut it and keep the brief half. If it
reads `none` and the child ESCALATES on more than one, the deciding test below
is calibrated too tight. If briefs keep being hand-written in `plans/` without this
command, the command is not reachable at the moment of need — that is a routing
problem, not a spec problem.
