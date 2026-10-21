---
name: board
description: Render the fleet board — one read-only card per session open in this repo (alive, lifecycle, subject, last commit, review loops, holds, plan currency, owner-pending rows), every cell derived on this render from the instrument named in its column, nothing stored. Use when the owner asks where the fleet stands, which seat holds what, or whether anyone's plan is behind; the short form of /peers --board.
---

# /board — the fleet board

Read-only state-query. Answers **"where does every session stand right now?"** — one card per seat (`**Label:** value` lines, a rule between seats; `--table` for the 9-column markdown table, which the terminal would otherwise stack into cards on its own). Same mechanism as `/peers --board`; this is its short name, and both stay.

## Process

1. Run the backing command and present its output **inline, verbatim** (`--table` when the pane is wide or it goes to a file; `--json` only when a machine asked):
   ```bash
   python3 scripts/fleet-board.py
   ```
   Options pass straight through: `--plan-lag-min N` (default 10), `--git-max-count N` (default: the whole history, about 1 s of the render).

2. Present the cards as-is, then at most two sentences on what moved since the last render you showed, if you showed one. **No side effects, no writes.**

## What the columns mean, and what they cannot see

The full per-column derivation lives in `.claude/skills/peers/SKILL.md` § `--board` — the fleet board, and in the script's own header; the two facts a reader acts on are here so they are never skipped. **Alive is the CLI's word (`claude agents --json`), never a file mtime**; a standby or paused seat reads `idle` there, so the lifecycle column (the `.claude/state/` markers) is what says why. **Review loops and holds read the mail plane only and are FLOORS** — a loop closed in a commit body, or a hold lifted there, is invisible. `plan behind by N min` means the seat's transcript was written N minutes after its plan's last save.

A render takes about 3.5 s for 7 seats (measured 2026-10-15: 2.4 s after the tail read and the in-process mail readers, about 1 s more for the whole-history commit window; it was 14.6-18.9 s before, whole-transcript scans plus two mail subprocesses per seat). Exit 2 means the CLI refused to answer, or the /summary spec's owner predicate could not be extracted; an empty fleet prints a line saying why, never an error. `python3 scripts/fleet-board.py --self-test` is the seeded self-test and `--self-test --break-seed` its RED control.

The card layout is the default because the stacked cards read more easily than the table.

**Read-only state-query — carries its own marker `[board]`** (every reply is marked; same family as `/peers`, `/status`, `/whoami`).
