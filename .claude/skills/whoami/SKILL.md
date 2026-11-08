---
name: whoami
description: Print the current session's FULL session id (plus the 8-hex short prefix, transcript path, and lifecycle). Use when the full UUID is needed — e.g. cross-referencing harness/session tooling that keys on the full id — since /peers and the mail plane deliberately show only 8-hex prefixes.
---

# /whoami — this session's full identity

Read-only state-query. Answers **"what is THIS session's full id?"** — the one place the full UUID is surfaced (`/peers` and the mail plane deliberately use 8-hex prefixes).

## Process

1. Run the backing command and present its output **inline, verbatim**:
   ```bash
   python3 scripts/session-manifest.py whoami
   ```

2. The output is:
   - the **full session id** (the UUID, e.g. `<session-id>`),
   - the **short id** (8-hex prefix — what `/peers`, `mail-send --to`, and `whose-edit` use),
   - the **transcript path** (the session's jsonl on disk, or "(not on disk yet)" at session start),
   - the **lifecycle** state (`ACTIVE` / `STANDBY` / `WRAPPING` / `WRAPPED` / `EXITED`). `STANDBY` (2026-09-23, `/standby`) is owner-parked: alive, holding its work, listener DISARMED on purpose, woken by nothing but the owner's next message — it outranks `WRAPPING` / `WRAPPED` whatever their age (the listener stays disarmed until `/standby resume`), and `EXITED` outranks it.

   **`WRAPPING` vs `WRAPPED`.** `/wrap` Step 0 stamps
   `WRAPPING` (a wrap is running; live, non-terminal, never a `--peer-done` wake); the wrap's last
   act stamps `WRAPPED` only when it completed ("wrap complete: yes"). A completed `/wrap
   --checkpoint` clears both markers, so the seat reads `ACTIVE`. The `CHECKPOINT` state that
   stood here from 2026-08-26 is retired; a legacy checkpoint marker reads `ACTIVE`. A `WRAPPING`
   that never clears means the wrap stopped short — the SessionStart gate says so.

## Notes

- Identity comes ONLY from `CLAUDE_CODE_SESSION_ID`, validated to the full lowercase-UUID shape — **never guessed from the filesystem** (the `session-manifest.py` module invariant: an mtime-guessed identity resolves to whichever session wrote last, i.e. a live peer; see `current_sid()`'s docstring + the `self-test` regression cases). Absent or non-UUID env → the command fails CLOSED (rc 1) with an honest message rather than printing something full-id-shaped that isn't.
- For **peers'** full ids, there is no command — `who` prints prefixes by design; map a prefix to its full id via its jsonl filename (`ls ~/.claude/projects/<project-key>/<prefix>*.jsonl`).
- Sibling reads: `/peers` (`who` — you + peers, prefixes), `session-manifest.py read` (cached peer manifests).

**Read-only state-query — carries its own marker `[whoami]`** (every reply is marked; same family as `/peers`, `/status`, `/flows`).
