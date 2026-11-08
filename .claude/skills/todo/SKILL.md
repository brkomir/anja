---
name: todo
description: Owner-in-the-loop triage of open todo.txt rows in batches — read-only readers check each row against code, git, newer rows, BACKLOG.md and owner rulings and recommend one of five outcomes (close · keep · merge · relabel · owner call); the orchestrator re-checks every close and merge, applies the evidence-backed ones itself, puts only owner calls and disputed rows to the owner, then commits. Use when the owner says /todo triage, wants to work down the todo list, or asks what is really left in a set of rows. Distinct from /backlog sweep (a bulk pass that defaults to KEEP and runs without him) and /triggers (deterministic trigger scan).
---

# /todo — the todo-list commands

Codified as a procedure, named `/todo triage`; a batch is sized for efficiency, up to 100 rows rather than a fixed 10.

**Why it exists.** A cleanup pass over 193 rows, run the day this command was codified, asked one question, *does the row's own text say it is finished?*, with outcomes close / keep / misplaced and KEEP as the default. It closed 3. Batch 1 of this procedure asked *what should happen to this row?* over 9 of those same rows, at ~44 checks for 9 rows, and the outcomes were 3 closes, 3 merges and 1 relabel. A row overtaken by a later ruling, tracked twice, or waiting only on an owner word never says "done" in its own text, so the narrow question cannot surface it. (9 rows is a small sample; these were the oldest rows, the likeliest to be overtaken.)

## Usage

- `/todo triage` — the next batch of open rows, oldest first (by todo.txt line), skipping rows already triaged by this command (grep `triage batch` in the row).
- `/todo triage <N>` — a batch of N rows (default 50, max 100).
- `/todo triage <list>` — the named rows (names or line numbers), or a saved list file (e.g. the open rows of an earlier cleanup pass's row list).

## Process — `/todo triage`

1. **Select.** Derive the batch from todo.txt THIS run: open rows are lines starting `- [ ]`; a row runs to the line before the next `- [`. Record the start lines and first words in the working plan before dispatch.
2. **Size.** Default 50 rows = 5 read-only readers × 10 rows each, in parallel, `Explore` on Opus, `run_in_background: true`. ~10 rows per reader is the measured depth that works (batch 1: 9 rows, 44 checks, ~130k reader tokens); larger slices thin out per row. The owner may name any N up to 100 (10 readers). Never above 90% of the five-hour limit (the dispatch rule).
3. **Brief each reader** with the template below, pasted whole (Explore holds no doctrine).
4. **Adjudicate (never delegated).** For every CLOSE and MERGE: re-run at least one of its evidence checks yourself; confirm every merge target exists by name. A failed check ⇒ re-verify that reader's whole set. Settle cheap UNKNOWNs now.
5. **Apply what needs no judgement, ask only what does** (evidence-backed rows close without asking, and only the rows that need the owner's judgement go to him: his calls, and anything you are unsure about; a 50-row batch then reaches him as ~5-10 questions, not 50 rulings). Without asking: a CLOSE, MERGE or RELABEL whose evidence you re-checked in step 4, and every KEEP (a one-line marker, step 6). That rule names closes; merges and relabels go the same way because none of the six owner-only reasons applies to them (`.claude/rules/session-cadence.md` § ESCALATE TO THE OWNER ONLY FOR JUDGEMENT THEY ALONE HOLD). To him: every OWNER CALL (one of the six owner-only reasons, or a hold of his whose ruling may be moot), any row where you and the reader disagree or a check failed, and a short count of what you applied (closed N · merged N · relabelled N · kept N) with one line per close he can veto. Plain register, digits, no paths in sentences; each question answerable in a word, recommendation attached.
6. **Apply** (rulings for the asked rows; your own step-5 dispositions for the rest), with `Edit` calls (never a read-modify-write script on todo.txt), each change carrying `<date> by <sid8> (owner, todo triage batch N: "<his words>")` for a row he ruled on, or `<date> by <sid8> (todo triage batch N, applied without asking under step 5)` for a step-5 disposition, and the evidence: CLOSE → `[x]` + `✅ CLOSED`; MERGE → `[x]` + `⤵ MERGED into <name>` AND a one-line absorbed note on the target (a BACKLOG target gets a dated sub-item); RELABEL → stays `[ ]`, `🔁 RELABELLED`; KEEP → one appended line `<date> by <sid8> (todo triage batch N): KEEP — <next step>` (Usage skips rows carrying `triage batch`, so an unmarked KEEP is re-selected by every later batch), plus an annotation if the reader found a stale label or dead blocker. One commit per batch via `scripts/safe-commit.sh`, counting your own edits.
7. **Review and record.** Send the batch commit to the live review hub (coherent-batch rule). Update the working plan. The next batch starts only on the owner's go.

## Reader brief template

> Read-only triage of <n> rows in todo.txt. No Edit, no Write, no git state changes. The owner (plain-English register) rules on each row from your output.
> Rows: <start line + first words, one per row>. If a line moved, re-locate by the first words.
> Context: <dates that matter (a release, a deadline), relevant owner rulings, relevant public artifacts>. Owner holds stay KEEP unless the ruling is now moot (say why).
> Rules: a row runs from its `- [` line to the line before the next `- [`; read to the END (closures and rulings are appended; a section heading may sit inside the range). Verify every done/shipped claim at source this run — `rg -F` the code (quote globs; never `2>/dev/null` on a search), `git log --oneline --all --grep=<token>` uncapped, `git merge-base --is-ancestor <sha> origin/main` for production. A row's description of the code is a claim, not evidence. Check BACKLOG.md (entry forms `### N.`, `- **#N `, `- **P<N> #N`) and todo.txt for a newer row covering the same thing. Production DB/dashboard state you cannot see: say so. A wrong CLOSE is worse than a KEEP.
> Output per row (≤120 words, plain English, evidence in a trailing `evidence:` line): name + one sentence on what it is about; what is done, what is left; exactly one of CLOSE (evidence) · KEEP (next step + who) · MERGE (into a named row or BACKLOG entry that exists) · RELABEL (the new label and why) · OWNER CALL (the yes/no question + recommended answer). End with a tally.

## Boundaries

- Owner-invoked. Writes todo.txt / BACKLOG.md on his ruling for the rows he was asked about and on its own step-5 dispositions for the rest (step 5's rule); never closes on a reader's word alone.
- Not `/backlog sweep` (bulk, default KEEP, no owner loop) and not `/triggers` (deterministic, zero-LLM).
