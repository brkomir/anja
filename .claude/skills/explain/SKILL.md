---
name: explain
description: Expand ONE compressed statement of mine — a decision-queue row, a table cell, a closer line — into what it actually means, how I know, and what it costs the owner. Use when the owner quotes my own words back and asks for more context. A bare topic is /eli5, not this; /eli5 "<line>" re-says a line plainly and read-only, while this command audits the line and fixes the row it lives in. WRITES — it fixes the stale row it finds, so it carries the [explain] prefix and is not a read-only state query. Every claim is re-derived this invocation; the quoted row is itself a claim and is checked for staleness before it is defended.
---

# /explain — unpack one thing I said

The owner reads a compressed row and cannot act on it. This command gives back what compression
removed: what the words mean, how I know, why it is the owner's, what each option costs, and what I did
not check. The rows the owner quotes back usually come from a `/summary` decision row, a table cell
inside a structured output, or the closing line of a readout — the owner has asked this way at least
159 times, 128 of them opening with my own sentence (168 of the 232 logged invocations by
2026-10-14 carried a quote; 60 carried a bare topic, which is `/eli5`'s).

**Every reply opens with `[explain]`.** Not read-only: it fixes the stale row it finds (step 5)
and says so.

## Before you send — check the draft against these 11

These 11 items are this command's rules for every reply. This file loads at the moment
you write (measured 2026-10-14 over 164 outputs of this command: 100% wrote counts as words,
89% carried a paragraph over 3 sentences, 25% carried a table).

1. **The quoted row comes first, verbatim, in a `>` block** — the owner may read the reply many tool
   calls below the owner's question, and the block says which sentence this answers.
2. **The first sentence answers the words the owner typed AFTER the quotation** (a question about
   what the row means and whether it was addressed, or about which items a numbered reference
   points to), not the row in general
   and not the story of how you got there. An expansion that walked a row's 4 options and
   5 not-checked bullets left the owner asking what it even meant — the row was explained,
   the owner's question was not.
3. **Every fact was re-derived this turn, or its own sentence says it was not.**
4. **Numbers are digits:** 3 files, 12 corrections, 4.1x, 40%, 90 seconds. No size threshold
   and no exceptions: digits are allowed for every number, and typing numbers out does not add
   to readability.
5. **Decompress every noun, and coin no new ones while expanding.** *"Mine, actionable —
   disposition condition fired at v2.50, neither branch taken"* is 4 pieces of jargon: say what
   fired, what the 2 branches were, and why neither was picked. Every work-word the answer brings
   in gets its meaning in the sentence that first uses it.
6. **Step 4's parts are bold lead-ins, not `##` headings** — they are facets of 1 answer
   (*"**How I know.**"*, *"**If you say nothing.**"*); the 1 `##` a long reply may carry is the
   closing *What's waiting on you*. **At most 80 words per paragraph**: a sentence that would
   carry it past 80 starts the next one; a sentence over 40 words is split. A headed section that is 1 long paragraph
   still reads as squashed (the complaint behind this rule was on an `/explain`).
7. **"How I know" is a bulleted list**, 1 check and its result per line. The 4 checks' verdict
   goes in the answer sentence, never in a card — currency, closure, authority and size are my
   words for my checks, not the owner's.
8. **An options fork is 1 bullet per option, the recommended one first with its reason attached**;
   a table with a cost column only when the content is genuinely tabular — at most 4
   columns, each cell a value or a state and never a sentence (an expansion that put 4
   options in a 3-column table with 60-word cells left the owner asking what it even meant). Each
   decision ends as a question the owner can answer in a word, never a label followed by comma-chained
   options (`/eli5` check 11 holds the 2 cases).
9. **Text the owner must judge goes in a fenced block** — what it says now, what you propose.
10. **No apparatus in the body.** A path, sha or symbol is a citation, never the answer.
11. **A row you fixed shows as 2 blocks, labelled *as written* and *now*, and you say you
    committed.** A thing only THE OWNER can answer (*"who the twelve would be"*) is not a not-checked
    item, it is an ask: it goes in the numbered list of what needs the owner, or it is dropped
    (3 such bullets drew an answer from the owner of having no idea on any of the 3).

## ⛔ The Iron rule — THE QUOTED ROW IS ITSELF A CLAIM

Re-derive every fact in the expansion this invocation, or mark it unverified in its own sentence
(`.claude/orchestrator/conventions.md` § Say an unverified claim is unverified IN the sentence).

The row was written by me, possibly turns or days ago, on a tree other sessions have committed to
since. **Check whether it is still TRUE before you explain what it means** — an expansion that
elaborates a stale row is worse than the row, because length reads as diligence. Run all 4
before writing a word:

1. **Currency** — is the state it asserts still the state? Re-run the check that produced the
   number, not the number's memory.
2. **Closure** — has a peer closed it? `grep -nF '<ROW-NAME>' todo.txt`, read the checkbox NOW,
   then `git log --oneline -5 -G '^- \[x\] <ROW-NAME>' -- todo.txt`.
3. **Authority** — if the row says the decision is the owner's, name what makes it the owner's: a taste call, an
   external fact, an irreversible action. **If you cannot name one, it was never the owner's**, and the
   expansion says so and takes it back.
4. **Size** — if the row states a cost or a LOC figure, derive it again. An offer's size is the
   half nobody checks; it has been measured 4.1x understated.

**A `/explain` that ends "…and the row was wrong / stale / mine after all" is a SUCCESS.** Finding
the defect a compressed row hid is the yield. Do not let the expansion become a defence of the sentence.

## Process

### `/explain "<quote>"` — the primary form

1. **Locate the statement, and read what the owner typed after it** — where I wrote it and what it was
   about. A table cell is a fragment of a claim: read the whole row. The words after the
   quotation are the owner's actual question (check 2).
2. **Run the 4 checks above.**
3. **Quote the row in a `>` block, then answer first** (checks 1 and 2).
4. **Then expand, in this order** — skip any part that does not apply, never pad:
   - **What it is** — the compressed nouns, in ordinary English.
   - **How I know** — what I just ran, and what it said (check 7).
   - **Why it is yours** — the taste call, external fact, or irreversible action.
   - **The options and what each costs** — if it is a fork (check 8).
   - **What happens if you say nothing** — the cost of silence.
   - **What I did not check** — named, not implied; an owner-only unknown is an ask (check 11).
5. **If a check found the row wrong or stale, fix the row this turn** — the `todo.txt` line, the
   tracker, the plan file. Correct the text rather than appending a correction under it, and show
   the fixed lines (check 11). This is the command's only write, to the fleet's most contended file, so:
   - **Use `Edit`, never a read-modify-write script** — `Edit` fails loudly when the anchor moved.
   - **Anchor on the row's own `- [ ] <ROW-NAME>` line**, never a bare name; house style cites
     rows by name, so a name-grep lands on a cross-row mention.
   - **Commit through `scripts/safe-commit.sh` with hand-counted `--add`/`--del`**; if a peer's
     uncommitted hunk sits in the same file, isolate yours with `git apply --cached` or
     `scripts/stage-own-hunks.mjs`.
   - **Say in the reply that you committed.**

### Bare `/explain`

Expand the most recent compressed thing you put in front of the owner: the last decision row, table,
or closer. **Name which one in the first line**, so the owner can redirect in 1 word; do not ask which
the owner meant.

### A topic, not a quote

There is no topic form. Run `/eli5 <topic>` and say you did.

## Anti-scope

- **Not a defence of the row.** If it survives the 4 checks, say so in 1 sentence and spend the
  rest on what it means. If it does not, the first sentence's answer to the owner's question starts from that (check 2).
- **Do not expand a row the owner has deferred.** A deferral is an answer; re-raising it turns the owner's answer
  back into a question.
- **Not a research command.** If the honest answer is "I don't know, and here is what it would
  take to find out", that is the answer — do not launch an investigation behind it.
- **No peer form.** 1 request to send a new review hub more context is not a form; if it recurs it
  becomes `--for <sid8>` through `mail-send`.

## Revisit

Count with `grep -c '"skill":"explain"' .claude/logs/skill-invocations.jsonl`. The re-measure
this spec promised at 10 invocations had not run at 232 (2026-10-14); a regex proxy over 164
outputs (a stale / no longer / was wrong / not yours phrase) fires in 53%, noisy but enough to
keep the 4 checks. The real read is a hand score of 20 outputs against the 4 checks: 5 or more
of the 20 finding the row stale or mis-assigned means the defect is upstream and `/summary`'s
decision section needs the derivation inline, not a repair command downstream. Over the next 10
owner-invoked runs (`"source":"user-prompt"`, counted from this edit's commit): 0 of 10 opening
with stale / wrong / not the owner's ⇒ drop the 4 checks to a single currency re-derive and keep the expansion.
