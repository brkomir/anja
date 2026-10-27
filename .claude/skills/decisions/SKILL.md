---
name: decisions
description: Record or manage entries in DECISIONS.md at repo root — the project's human-readable decisions log. Use after shipping a bundle of changes (capture what/why), when you say "we already decided this" and want to prevent re-litigation, when parking a decision for later (add to Open with trigger), or at end of a significant session to sweep for undocumented calls. Distinct from /session-memory (which writes to project memory + skill MEMORYs) — DECISIONS.md is the human-readable owner-scannable companion at repo root.
---

# /decisions — Decisions Log

Records significant project decisions to `DECISIONS.md` at repo root. Human-readable, owner-scannable, machine-portable. Entries are intentionally short — link to commits / memory for detail.

## Usage modes

- **`/decisions`** (no args) — scan recent conversation for undocumented decisions, propose additions, wait for approval.
- **`/decisions add <shipped|open|rejected>`** — create a new entry in the named section.
- **`/decisions promote <keywords>`** — move an Open entry to Shipped (needs commit hash or date) or Rejected (needs reason).
- **`/decisions audit`** — cross-check DECISIONS.md against recent commits + skill MEMORY files for drift. Report entries that appear in code/memory but not in DECISIONS.md.

`/wrap` Step 3a invokes `add`; `sweep` and `/wrap` are not modes of this command.

## When to use

- After shipping a bundle of changes (capture what/why before context decays)
- When you say "we already decided this" and want to prevent re-litigation
- When parking a decision for later (add to Open with trigger condition)
- At end of a significant session — call `/decisions` to sweep for undocumented calls
- When a previously-accepted decision gets reversed → add to Rejected with reason, link the new direction

## When NOT to use

- Routine code edits, bug fixes, refactors that don't change user-facing behavior or strategy
- Implementation details (those belong in code + commit messages, not in DECISIONS.md)
- Memory-only items that don't shape future decisions (those belong in `.claude/skills/*/MEMORY.md` or `.claude/project-memory/`)

## Distinction from `/session-memory`

| | /decisions | /session-memory |
|---|---|---|
| Audience | Human owner, future-self, contributors | Orchestrator, future sessions |
| Location | `DECISIONS.md` at repo root | `.claude/project-memory/*.md` + `.claude/skills/*/MEMORY.md` |
| Format | 3-5 lines, prose, owner-scannable | Structured frontmatter + body, machine-loadable |
| Scope | Business / pricing / strategy / vendor / release decisions | Per-feature, per-flow, per-expert technical decisions |
| Lifecycle | Survives machine switches via git (always); never auto-pruned | Lives in project memory; subject to /meta distill |
| Trigger | After shipping; when re-litigating; at session-end | Auto-invoked by /wrap; after expert review |

Both can run on the same session. /session-memory is exhaustive (capture everything that matters for future orchestrator sessions); /decisions is curated (capture only what a human co-owner needs to know about strategy/direction).

## Process

### Default mode (`/decisions` no args)

1. **Read `DECISIONS.md` by heading and grep, never whole** — in the source project, at 2.19 MB (before its archive split), an unbounded `Read` returned lines 1-30 with no truncation note (measured 2 of 2 in 30 days), which is the 2 newest Shipped entries, so Step 3's de-duplication would run against 2 of ~1,000. The runs there already worked this way (131 spans: 0 unbounded Reads; 206 greps, 30 `sed -n`, 26 ranged Reads): `grep -n '^## ' DECISIONS.md` for the section lines, `grep -n '^### ' DECISIONS.md | head -40` for the newest headings (newest Shipped is at the top), `grep -n -i '<topic>'` for prior entries, then `Read` with `offset`/`limit` for the entries you need; `grep -n -i -F '<distinctive phrase>'` for the de-dupe in Step 3. Once the file has been split, the older entries live in `DECISIONS-ARCHIVE-*.md` at repo root (in the source project, every entry dated before 2026-09-01), so the topic and de-dupe greps run over both: `DECISIONS.md DECISIONS-ARCHIVE-*.md`, never `DECISIONS.md` alone.
2. **Scan the conversation** for non-obvious decisions that shaped code, copy, pricing, vendor choice, strategy, or public-facing behavior. Skip routine edits, bug fixes, implementation details.
2b. **DERIVE the owner's answered questions from the transcript — never recall them.** Any entry covering a build that ran across several days or sessions, which the owner steered by multiple choice or by replies to a closer, gets this step before it is written or updated (a one-turn decision needs no transcript walk). List every answered question by timestamp, keyed exactly as `/post-compact` Step 4 keys them: row (f), an `AskUserQuestion` `tool_result` linked by `tool_use_id` AND carrying a NON-EMPTY `toolUseResult.answers` (never the tool name, never the content string; an empty dict is a timeout, not an answer); row (g), `toolDenialKind == "user-rejected"`, is a dismissal, not a ruling (a cancelled question lands there, never in (f); `permission-rule` and `automode-*` are not the owner). Then walk the owner's own messages through every population that table names, (a) (b) (b2) (c), not only typed records (a ruling can arrive as a queued-command attachment, row (c)): the quote-then-rule messages (`"<my text>" - <the owner's answer>`, split into pairs per that step's quote clause, since one message can carry several), and every message that answers a numbered closer by number (`1. keep all; 2. yes`), read against the assistant message before it. Then diff that list against the entry and add every ruling the entry lacks to the step 4 preview, as the owner's option label with `(Recommended)` stripped plus the options turned down. ⛔ **Why it is a step and not care:** in the source project an entry kept up by hand over three days carried **5 of 20** of the owner's answers. An answer given by clicking leaves no typed sentence for a recall pass to find. **Revisit:** a second entry that misses an answered question after this step ⇒ write a script that lists the answered questions for a session and call it here.
3. **Check for duplicates.** A decision is duplicate if it's already in DECISIONS.md OR captured in `.claude/skills/*/MEMORY.md` with sufficient detail.
4. **Propose 1-3 entries** as a preview diff. Format per "Entry format" below.
5. **Wait for explicit user approval** before writing.
6. **Write** to the appropriate section (Shipped / Open / Rejected). Preserve section order. Insert directly below that section's `## ` heading, newest first; never append at the end of the file — the last section is `## Maintenance`, and in the source project 26 entries landed there that way within three days.

### Add mode (`/decisions add <section>`)

A `/wrap` Step 3a call passes no section: run Default-mode steps 1, 2, 2b (where its scope applies) and 3 first, with 2b's missing rulings added to the entry itself (Add-mode step 4 then decides whether it is written on disclosure or put to the owner first), then take each surviving entry through the steps below in the section it belongs to (Shipped / Open / Rejected, chosen as in Default-mode step 6).

1. Gather:
   - Short title (one phrase)
   - Date (default today, YYYY-MM-DD)
   - 2-3 line reasoning (what + why + counterfactual)
   - Optional: commit hash, related expert MEMORY pointer, cross-ref to other DECISIONS entry
2. Format per "Entry format" below
3. Insert directly below the named section's `## ` heading, newest first (Default-mode step 6); never at the end of the file
4. No need to wait for approval if user explicitly invoked `/decisions add` — they've already committed to the entry. When `/wrap` Step 3a invokes `add` by Skill call, that premise is absent: write on disclosure only an entry that records the owner's own ruling (quoted, timestamped); an entry recording a session's own call needs the owner's yes first.

### Promote mode (`/decisions promote <keywords>`)

1. Find the matching entry in an Open section by keyword: `grep -n -i '<keyword>' DECISIONS.md DECISIONS-ARCHIVE-*.md` (Open entries moved by an archive split live in the archive)
2. Ask: promote to Shipped (needs commit hash or date) OR Rejected (needs reason)
3. Move the entry within the file it lives in, **preserving the original reasoning** (an archive entry stays in the archive, so the date boundary Step 1 relies on holds); in the destination section it goes at its date position (newest first), not at the top
4. If moving to Shipped: prepend the shipping date + commit hash
5. If moving to Rejected: prepend the rejection date + reason

### Audit mode (`/decisions audit`)

1. Read last 20 commits (`git log --oneline -20`)
2. Read recent `.claude/skills/*/MEMORY.md` changes (`git log --since="14 days ago" --name-only -- .claude/skills/`)
3. Cross-check against DECISIONS.md entries
4. **Report entries that appear in code/memory but NOT in DECISIONS.md** — these are drift candidates
5. Propose additions; wait for approval

## Entry format — THREE LAYERS, TWO AUDIENCES

⛔ **This file serves BOTH a human scan and a machine read.** Neither half is dropped for the
other: each layer below has ONE audience, and the drift to watch for is apparatus leaking out of
layer 3 into layer 2.

```markdown
### YYYY-MM-DD — Short title                          <- layer 1: MACHINE
                                                         (no sha, no path — see below)
What was decided + why, in the plain register.        <- layer 2: HUMAN
Include the counterfactual (what we chose against)
OR the trigger to revisit.

see: <sha> · <path> · <ROW-NAME> · DECISIONS <date>   <- layer 3: APPARATUS
```

**LAYER 1 — the dated heading has one fixed form, not a style choice.** In the source project a
drift detector this copy does not ship dated entries by `^### (\d{4}-\d{2}(?:-\d{2})?)`, and any
reader you add can key on the same form. **Do not reformat the heading, do not demote
`###` to `##`, do not put anything before the date:** against that pattern the prescribed form
matches, a month-precision date matches, a `## ` heading fails and a prefix before the date fails.
A trailing sha would still match, but it does not belong here: it puts apparatus in the one line
whose job is to be scanned. The sha belongs in layer 3.

**LAYER 2 — the body is the OWNER's, and takes the plain register in full**
(`.claude/orchestrator/conventions.md` § Write to the owner the way you would say it out loud).
Numbers stay, inside sentences; every caveat the decision earned stays. What goes is the
apparatus — shas, file paths, symbol names, ALLCAPS row names, rule ids. 3-5 lines; 8-12 for a
pricing / vendor / schema decision.
⛔ **BUT THE BODY IS NOT FREE TEXT — A SECOND CONSUMER READS IT AS A SUBSTRING CORPUS.**
`scripts/plans-ruling-scan.py` counts a `plans/` doc as mirrored when `DECISIONS.md` contains the
doc's BASENAME anywhere in the file. So **an entry that rules on a plans doc must keep naming that
doc by basename in the body**, or the scan reports an unmirrored ruling that is actually mirrored:
no parse error, no failure, a silent false finding. A reformatted heading fails the pattern above
on sight; this one breaks QUIET, which is why it needs saying.

**LAYER 3 — `see:` is where the apparatus goes, and it is NOT optional.** In the source project,
70 of 450 entries carried a `see:` line, and that is why apparatus was in the prose: with no
designated home it lands wherever it was written. Every entry citing a commit, a file, a tracker
row or a sibling decision gets one, on its own trailing line. A reader who wants the trail finds
it in one place; a reader who wants the decision never reads it.

⚠️ **The three layers are why "human-readable" and "machine-readable" were never actually in
tension here** — they were competing for the same lines because nobody had assigned the lines.

## Rules

**Verbatim-banking discipline.** A quote recorded as verbatim is treated as un-re-checkable by
every later reader, so the elision rules are stricter than for paraphrase:
- Cut leading/trailing material freely. **Mark every INTERIOR cut with `…`.**
- **Never elide a hedge or an accompanying question** (*"i don't know what X is here"*, *"am i
  right on this?"*). Those state the ruling's CONFIDENCE and are half the ruling. In the source
  project a recorded quote kept a preference and dropped both the hedge and the closing question
  that came with it, and the option shipped on the strength of that quote deleted a live gate.
- Diff the banked quote against the source record before committing.
- **Supersession is a WRITE obligation, not just a read one:** when a new entry inverts an old one,
  annotate the OLD entry with a forward pointer in the same change. An inverted entry with no
  pointer stays accurately quotable, which is what makes it a decoy.
- **And the replacement sentence is itself HIGH-RISK:** a supersession edit is composed FROM the
  discovery that the old sentence rotted — which feels like verification and is not; in the source
  project the commit that closed one rotted clause introduced a new false one on the same surface.
  Derive the replacement from the artifact THIS turn, never from recall — and a filename supplies
  neither the KIND nor the STATE of the thing it names.

- **Never write to `DECISIONS.md` without explicit user approval** in default mode. Skip approval only in `add` mode where the user has explicitly invoked write intent; a `/wrap`-invoked `add` follows Add-mode step 4.
- **Preserve section order:** Shipped → Open → Rejected.
- **Never delete Rejected entries.** They prevent re-litigating the same debate in 3 months. Each Rejected entry is institutional memory.
- **Mirror business-critical project-memory entries** here when they should survive machine changes / contributor onboarding / context compaction. The same decision can live in BOTH `.claude/project-memory/project_X.md` (machine-readable) AND `DECISIONS.md` (human-readable) — they serve different audiences.
- **Each entry should be scannable by a non-technical co-owner in ~10 seconds.** If the entry needs to be re-read to understand, it's too long or too dense.
- **Supersede-marker sweep:** when a new entry OVERRIDES a panel/expert verdict (the owner picks an option the panel advised against), annotate **every dissenting expert MEMORY entry** with a one-line `> SUPERSEDED by DECISIONS YYYY-MM-DD (<what shipped>)` marker — not just one of them. An unmarked losing verdict is cited by a future panel as the current position. Grep: the expert names are in the entry's own "panel split" text.

## Cross-references

- **`DECISIONS.md`** at repo root — the artifact this skill maintains.
- **`/session-memory`** — sibling skill for orchestrator-side decision capture (machine-readable).
- **`/wrap`** — end-of-session closer. Its Step 3a runs `/decisions` after `/session-memory` on every non-trivial session; `scripts/wrap-reconcile.mjs` notes a wrap that skipped it.
- **`.claude/skills/meta/MEMORY.md`** — L# lessons that may have triggered a decision worth logging.
- **`.claude/project-memory/project_*.md`** — machine-readable per-topic decisions that pair with their DECISIONS.md mirror.

## Maintenance

- DECISIONS.md is append-only within each section. Don't reorder Shipped entries chronologically — let them stay in insertion order so the most-recent reads at the top of Shipped section (Step 6: newest first, directly below the heading).
- Section-move on promotion is OK (Open → Shipped or Open → Rejected). Section-move on demotion (Shipped → Open) is rare and should be explicitly logged with the reason ("reverted on YYYY-MM-DD because X").

## Revisit triggers

- If 3+ months pass without a single `/decisions` invocation surfacing a new entry, the artifact may not be serving its purpose — re-evaluate scope or fold into project-memory.
- If DECISIONS.md grows past ~500 entries, split it: move the older entries, by a date boundary, to a `DECISIONS-ARCHIVE-*.md` file at repo root, and re-file any entries that landed under `## Maintenance`. *(The source project made its first split at 1,028 entries, with a script that cannot yet merge into an existing archive.)*
- If the Rejected section grows past ~30 entries, the project may be over-debating; check whether decisions are being prematurely added to Rejected before being seriously evaluated.
