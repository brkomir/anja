---
name: peers
description: Show the current session id + active parallel sessions with their work summaries, marking which one is YOU; `--board` (or `/board`) renders the fleet board instead. Use when a message references "a peer session <id>" and you can't tell from the terminal which session is which, or to see who else is working in the repo right now.
---

# /peers — who's working in this repo right now

Read-only state-query. Answers **"which session am I, and what is each parallel session doing?"** — the map you need when Claude cites an opaque session-id-prefix (e.g. "the comparison-redo peer `<session-id>`") and you can't tell from the terminal which session that is.

## Process

1. Run the backing command and present its output **inline, verbatim** (`--board` → `python3 scripts/fleet-board.py`, see § `--board` below):
   ```bash
   python3 scripts/session-manifest.py who
   ```
   Widen the window with `--hours N` (default **8** — "who's active now"; e.g. `who --hours 24` to include yesterday's wrapped sessions).

2. The output is a table:
   - The **current session is marked `→ … (YOU)`** (resolved deterministically via `$CLAUDE_CODE_SESSION_ID`, not a racy mtime guess).
   - Active **peers** follow, sorted by recency, each with a **Recent activity** summary + files-touched + last-active + lifecycle badge (`⏸` = ran `/wrap`, done-for-now but still live · `⏸ standby` = owner-parked with the listener disarmed, still live, reads mail only when the owner resumes it · `✓` = exited). The **Recent activity** cell shows up to the **last 3 substantive user messages, newest-first**, and prefers real directives over quote-and-react fragments (owner pasting assistant output and reacting) — falling back to fragments only when the window has nothing cleaner, so a session never reads blank.
   - It **live-scans the session jsonls** (fresher than the cached `.claude/state/active-sessions/*.md` manifests `read` uses).

3. Present the table as-is. **No side effects, no writes** — this is a read, like `/status` / `/ops`.

## `--board` — the fleet board

`/peers --board` runs `python3 scripts/fleet-board.py` and presents its output **verbatim** — one card per seat by default, `--table` for the 9-column markdown table, `--json` for machines. **`/board` is the same thing under its own name**; both stay. ONE row per seat `claude agents --json` lists for this repo's cwd, every cell derived at render time from the instrument named in its column header, with its age; nothing is stored. Derivations, per column:

- **Alive** — the CLI's `status` (`busy` / `idle`) and `startedAt`. The only complete liveness list; a file mtime is NEVER liveness here. A standby or paused seat reads `idle`, which is why the next column exists.
- **Lifecycle** — the markers in `.claude/state/` through `session_status.py` (the SSOT `who` uses): active / wrapped / checkpoint / standby / exited, plus `paused (resume …)` from `session-pause-<sid8>` and `HUB` (with `retiring` / `stale broadcast`) from review-queue's `hub_status`.
- **Subject** — the seat's newest substantive user message, read from the transcript TAIL by the manifest's `recent_user_msgs_tail` (the same message filter as `scan_jsonl`; imported, `who` has no `--json`). No files count — plain `/peers` shows the file names.
- **Last commit** — `session-labels.py`'s three legs (8-hex trailer, URL-form trailer joined through the seat's own transcript, sid-scoped subject) over the whole history by default (`--git-max-count`; 400 covered about 41 hours at 237 commits a day and read 2 of 7 live seats as `none`, measured 2026-10-15; it adds about 1 s to a render); the leg that matched is printed. A failed `git log` reads `? (git log failed)` on every seat, never `none`. A commit no live seat claims is simply not anyone's row.
- **Review loops** — review-queue's `build_rows` (OPEN / ACK ONLY rows) and hub-unfinished-loops' `scan` (peers holding the last word, oldest wait), imported and run over one load of the store. **Both read the mail plane only, so both are FLOORS.**
- **Hold** — the newest hold-class broadcast per sender (`writehold-armed` / `writehold` / HOLD / GO-QUIET subjects), walked forward to its lift, per sender AND per plane: a signal-carried hold is the dev-push plane and a subject-only HOLD / GO-QUIET the commit plane; a `writehold-lifted` signal clears the push plane, an ALL-CLEAR / HOLD LIFTED subject clears both. A body saying `lapses HH:MMZ` past now renders LAPSED. Receipts (`.read-by-<sid>`, empty files) are skipped before a key is marked seen (the first version let one stand in for its mail and read 3 of 8 hold mails, measured 2026-10-15). The one on-disk hold, `promote-inline-hold` in the git dir, is read too; an open promote PR and the `deploy-clear` / `deploy-hold-ack` signals are not, so this too is a floor. Open `HUB-HOLD-*` rows naming the seat print beside it.
- **Plan** — the newest `plans/session-<sid8>-*.md` by mtime: how many of the three headings (`## Arc` / `## Live items` / `## Closability`) it carries, its newest dated block (PRE-COMPACT / POST-COMPACT / OWNER PAUSE / ▶ RESUMED), and `plan behind by N min` when the transcript was written more than `--plan-lag-min` (default 10) minutes after the plan's last save.
- **Owner-pending** — open `todo.txt` rows the seat filed or owns (an owner field naming ANOTHER seat takes a row from its filer; `owner: owner` does not) that carry the one token `owner-pending:` or one of its aliases (the older spellings, incl. `owner: the owner` / `founder` and the live `⏸ owner-deferred` marker; list in `scripts/fleet-board.py` `OWNER_PENDING_ALIASES`). The fleet-wide total and the per-alias split print in the header line. A regex proxy over prose, never a count: a row that only QUOTES a spelling counts (the token's own tracker row does), a spelling outside the list does not; a row matching two aliases counts once in the total and once per alias, so the split does not sum to the total; per-seat cells cover live seats only, so they do not sum to the fleet figure.

Measured 2026-10-15 on 7 seats: 14.6-18.9 s as first shipped (machine load moves it) (whole-transcript scans 6.6 s, per-seat mail subprocesses 6.0 s), 2.2 s after the tail read and the in-process readers, most of the rest the URL leg's transcript reads; 3.3-3.5 s once the commit window became the whole history (2.4 s at 400 on the same fleet). `--self-test` seeds a wrapped seat with fresh files and a live seat whose plan trails its transcript by 25 min, plus a throwaway git repo, a review request and a retiring hub, and drives every column through the live readers; `--self-test --break-seed` is the RED control and must exit 1. Exit 2 means the CLI refused to answer or the /summary spec's owner predicate could not be extracted; an empty fleet prints a line saying why, never an error. Read-only, same marker `[peers]`.

## Notes

- The **Files** column is still a strong disambiguator — the Recent-activity summary de-noises quote-and-react fragments but can't always recover a clear subject (a session whose whole window is pasted quotes falls back to showing them), and the files-touched set usually says exactly what a session is doing.
- It maps a session-prefix → **work + files**. It **cannot** map a prefix → a physical terminal window (the OS pane is invisible to the script) — use the work-subject + files to recognize which is which.
- Sibling reads it complements: `session-manifest.py read` (peers only, cached manifests — `/orient` uses this), `parallel-session-scan.py` (richer per-peer detail, used in `/expert-review` Step 1b briefs), `check-overlap` (the scope-clobber BLOCK/WARN gate). `/peers` is the **"who + me"** view those three lacked.

**Read-only state-query — carries its own marker `[peers]`** (every reply is marked; same family as `/status`, `/flows`, `/ops`).
