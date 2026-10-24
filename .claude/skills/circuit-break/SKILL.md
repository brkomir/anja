---
name: circuit-break
description: The owner invokes this when I have started wandering — making things up, half-checking evidence, correcting myself every turn — and the owner can no longer tell where the work stands. It stops the current line of work, re-derives what is actually true right now from a fixed set of commands, withdraws every claim I cannot back, and restarts from that. Use when the owner types /circuit-break. Owner-invoked. The output is hard-capped and short by design; a long answer here is the failure repeating itself.
---

# /circuit-break — stop, consolidate, start from the truth

When I start wandering — making things up, half-checking evidence, correcting
myself every turn — we do a circuit break: the owner invokes a command, I consolidate,
and we start from scratch.

The plainer form of the same signal: the owner cannot follow me any more, I am
correcting myself each turn, and the owner no longer knows where we are or what I am
talking about.

**Carries the marker `[circuit-break]`.**

## What has actually gone wrong when the owner invokes this

Not one bad claim. A bad claim gets corrected and the session continues. This
fires when the **correction stream itself** has become the output: every turn
opens by amending the last one, so each turn is locally honest and the sequence is
unreadable. The owner cannot tell which version is current, and neither of us can tell
which parts were ever measured.

**So the fix is not another correction.** It is: stop producing, go measure a
small fixed set of things, say what is true once, and drop everything else.

## ⛔ The one rule that makes this command work

**THE OUTPUT IS SHORT AND IT IS CAPPED.** Four sections, each at most three
sentences. If the consolidation is long, the command has failed — the owner invoked it
because the owner could not follow me, and a thorough answer here is the same failure
wearing a better costume.

Everything the cap squeezes out goes in the working-plan write at step 5, where it
is available and not in the owner's face.

## What it is NOT

| | |
|---|---|
| `/summary` | where the session stands, in full, on request |
| `/explain` | one statement of mine, unpacked |
| `/eli5` | the whole arc rebuilt as narrative |
| `/meta learn` | why it went wrong, for future sessions |
| **`/circuit-break`** | **stop. what is true. what I take back. one next step.** |

⛔ **It is not a post-mortem.** Do not explain how the wandering happened, do not
diagnose myself, do not apologise. That is `/meta learn` and the owner did not ask for
it. A sentence beginning "I think what happened is" is this command failing.

⛔ **It is not an investigation.** No panel, no sub-agent, no new research thread.
The command runs the fixed command set in step 2 and nothing else. If the
consolidation surfaces real work, that work is ONE line under NEXT for the owner to
approve — never started inside this command.

⛔ **It is not a scope change.** Committed work stays committed; the task the owner asked
for is still the task. This resets what I *claim*, not what we are *doing*.

## Process

### 1. Stop

Drop the in-flight line of reasoning. Do not finish the thought, do not land the
edit that was halfway out. Nothing further is asserted until step 2 has run.

If a mutation, a stash, or a half-applied edit is sitting on the tree, that is the
one exception: restore it first, and say so in one clause. Leaving the tree
mid-mutation to honour a stop is worse than the stop.

### 2. Re-derive, from this fixed set and nothing else

Small on purpose. An open-ended re-check is another wander.

```bash
git status --porcelain                       # what is dirty, right now
git log --oneline -8 | cat                   # what actually landed
git log --oneline origin/dev..HEAD | cat     # what is unpushed to dev (FLEET, say so); origin/main..HEAD = unpromoted
```

Then, and only then, re-run the **one** command behind whichever claim of mine the owner
is standing in front of. One. If I cannot name which command produced a claim,
that claim does not get re-derived — it gets withdrawn at step 3. That is the
whole discriminator, and it is cheap: **a claim whose instrument I cannot name was
never measured.**

⚠️ Read what the commands print. Do not pattern-match them against what I expect —
expecting is the faculty that failed.

### 3. Withdraw, by default

Every claim I made in the recent window is in one of three states, and the third
is the default:

- **Measured this turn** — keep it, and it is the only kind of sentence allowed in
  the WHERE WE ARE section.
- **Measured earlier, instrument named** — keep it, marked as earlier.
- **Everything else** — **withdraw it.** Not soften, not hedge, not "I believe" —
  withdraw. Say the words *"I withdraw"* and name the claim.

⛔ **A DECISION I INVENTED FOR THE OWNER IS THE WORST MEMBER OF THAT THIRD CLASS AND IT
GOES FIRST.** Manufacturing an owner decision — telling the owner a settled convention
is the owner's taste call, putting a fork in front of the owner that the codebase already
answers — costs the owner a decision the owner did not owe, and it is the specific thing that
happened the day this command was written. Check every open item I have marked as
needing the owner: name which of the six owner-only reasons makes it the owner's
(the owner-column row in `.claude/orchestrator/conventions.md` lists them). **Cannot name one ⇒ it was never the owner's. Take it back in
this message.**

### 4. Name what a retraction cannot reach

Chat retracts freely. These do not:

- a **commit message** or a code comment carrying the withdrawn claim
- a **`todo.txt` row**, a `plans/` block, a `DECISIONS.md` entry
- **mail already sent** to a peer or the hub
- an always-loaded **rules** file

If a withdrawn claim reached any of those, FIX THAT PLANE in this same turn —
a correction REPLACES the text it corrects, never appends beneath it — and say in
one clause which plane you fixed. A claim retracted only in chat is still live
everywhere that matters.

### 5. Write the consolidated state to the working plan

`plans/session-<sid8>-<date>.md`, one dated block: what is true, what was
withdrawn, what is next. This is what makes "start from scratch" survive the next
compaction instead of being a feeling that lasts one turn.

Correct in place; never delete a section this run did not derive.

### 6. Answer, in this shape and no other

```
Where we are      — measured this turn. 1-3 sentences.
What I withdraw   — the claims, plainly. "I withdraw X." No story.
What's left       — the real remaining work, as items, not prose.
Next              — ONE action, mine or the owner's. Not a menu.
```

Nothing outside those four. No preamble, no closing reassurance, no receipts line,
no offer to explain further. The owner will ask if the owner wants more.

## Self-offer — one clause, never a self-fire

I may notice the pattern before the owner does. When I do: **offer it in one clause at
the end of a turn** ("I have corrected myself twice in three turns — say
circuit-break and I will stop and re-derive"), and then carry on with the work.

⛔ **Never fire it myself.** The command is the owner's to invoke, and a self-fired
circuit break is one more unrequested meta-detour by the session that is already
producing too many. **At most one offer per session** — a second offer is the
nagging that made the first one worth ignoring.

The condition for offering is mechanical, not a mood read: **I have amended a
previous turn's factual claim in two of the last three turns.**

## Revisit

- If the owner invokes it and the answer still runs long, the cap is not being honoured
  and the fix is the cap, not more sections.
- If three invocations in a row find nothing to withdraw, the trigger is firing on
  ordinary correction rather than on wandering — narrow it.
- If the owner stops needing it, that is the outcome. Retire it rather than defend it.
