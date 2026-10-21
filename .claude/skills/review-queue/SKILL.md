---
name: review-queue
description: Read-only status of the review hub plus the queue table — who is the hub, what is waiting, what was acknowledged but never answered, and where the ledger and the mail store disagree. Use when asking who the review hub is, whether a delegated commit has come back, or which review requests were acknowledged but never answered; and before assuming a review loop is closed.
---

# Review Queue — the hub's status and its table, derived every run

**Invocation: `/review-queue`.** Read-only. Owner-invoked or hub-invoked, any time.

Prints four things: **hub status** (who holds the role, listener liveness, re-broadcast
staleness) · **the queue table** (one row per review request addressed to this seat) ·
**the ledger cross-check** (where the plan-file ledger and the mail store disagree) ·
**what is owed** (peers holding the last word, and this seat's own open promises).

## Why it exists

`review-hub/SKILL.md` requires a queue claim to be re-derived before every assertion, and
then records — twice, with dates — that the re-derivation is expensive enough that it
silently degrades into **restating the last one**. Occurrence 2 (2026-08-25) was forty
minutes of *"one open hold, everything else clear"* that was true of the hub's model and
false of the store.

The ledger answered **where the state lives**. This answers **what it costs to read it**.
One command, no recall — which is the only form of the rule a seat actually follows.

## Distinctions

| Command | Answers |
|---|---|
| `/review-hub` | *become* the hub, take over, or retire |
| `/summary` | where THIS SESSION landed, across all its work |
| `/peers` | who is working in the repo and on what |
| **`/review-queue`** | **what is in the hub's queue right now, and what is owed** |

`hub-discover` (in `/orient` + SessionStart) answers *"is there a hub?"* for a peer. This
answers *"what is in it?"* for the hub and for the owner.

## Process

```bash
python3 scripts/review-queue.py              # the four sections
python3 scripts/review-queue.py --no-owed    # skip the two subprocess checks (faster)
python3 scripts/review-queue.py --json       # machine-readable
python3 scripts/review-queue.py --self-test  # 14 assertions, 5 claim classes
```

Render the output for the owner in the plain register — **session NAMES, never bare 8-hex
ids** (the script already resolves them). The
table is already owner-shaped; do not re-render it into prose.

## Reading it — the three states, and why the middle one exists

| | meaning |
|---|---|
| ✅ **disposed** | a verdict / fold-verify / deploy signal of mine names that commit |
| 🟡 **acknowledged, not answered** | only an ack or an interim names it |
| 🔴 **nothing sent** | no outbound of mine names it at all |

⛔ **THE MIDDLE STATE IS THE POINT.** The hub spec's own header says *"ANSWERED IS NOT
HANDLED"*, and every sha-keyed instrument in the fleet — including
`review-request-closure-scan.mjs` — scores an ack as an answer, because an ack names the
sha. From the requester's side **queued and forgotten are indistinguishable**, and those two demand opposite actions from them. A row sitting in
🟡 is the shape that produced the hub's measured 201-minute first reply.

## What it cannot see — state these, do not let a clean run imply otherwise

- **The mail plane only.** A loop closed in a commit body or a channel
  reads OPEN here. Every count is a **FLOOR**.
- **A verdict that answered by RANGE rather than by sha** leaves its request reading open —
  measured in this session: a verdict covering a range left the two commits
  inside that range unnamed and therefore unmatched. **Name each commit you cover.**
- **Body-sourced targets are a weaker reading.** Targets come from the SUBJECT; when a
  subject names none, the body is used and the row is flagged. Requests cite context shas
  mid-prose, so treating body shas as targets over-reports (53 body shas against 8 real
  targets, measured on this store).
- **Nothing about panel quality.** It counts dispositions, never whether the verdict was
  any good.

## The two design decisions worth not re-deriving

**A hex token becomes a commit only when `git cat-file -e <tok>^{commit}` says so.** An
8-hex session id is indistinguishable from an abbreviated sha by pattern — `migrations.md` records
the collision giving `git log --grep` seven hits and zero true positives. The object database
is the discriminator; a regex is not.

**The ledger comparison runs at REQUEST grain, not sha grain.** The obligation is one
ledger row per request. Comparing every-sha-mentioned against ledger-heading-shas is the
wrong axis and over-reported **45 against 6 real** on the first run of this tool — a
wrong-axis check is exhaustive, green and useless (name the binding predicate
first, then derive the set from it).

## Anti-scope

- **Read-only.** No mail, no commits, no ledger writes. It tells you a row is missing; you
  write it.
- **Not a replacement for the three hub checks.** `review-request-closure-scan.mjs`,
  `hub-unfinished-loops.py` and `hub-open-promises.py` are cross-blind to each other by
  design — this composes them and adds the ledger axis; it does not supersede any of them,
  and `/post-compact` still runs all three by name.
- **Don't add a "clean" verdict.** Every number here is a floor over one plane; a green
  summary line would be exactly the false reassurance the tool exists to remove.

**Revisit:** if three runs surface zero ack-only rows and zero ledger gaps, the ledger
discipline is holding and the cross-check can drop to `/wrap` cadence. If the ack-only
column is never empty, the ack-then-forget loop is structural and wants a hook, not a
report.
