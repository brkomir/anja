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
   - the **lifecycle** state (`ACTIVE` / `STANDBY` / `CHECKPOINT` / `WRAPPED` / `EXITED`). `STANDBY` (2026-09-23, `/standby`) is owner-parked: alive, holding its work, listener DISARMED on purpose, woken by nothing but the owner's next message — it outranks `WRAPPED` / `CHECKPOINT` whatever their age (the listener stays disarmed until `/standby resume`), and `EXITED` outranks it.

   **`CHECKPOINT` vs `WRAPPED`.** `/wrap --checkpoint` now writes
   an intent field the plain `/wrap` does not, so the two are distinguishable. Both are
   NON-TERMINAL and identical to every gate — a checkpointed seat still mutates state, still sends
   and receives mail, still counts for overlap. `CHECKPOINT` says only that the seat DECLARED it
   was not finished. ⚠️ **Its absence proves nothing**: intent is declared at wrap time and never
   inferred, so a plain `/wrap` followed by hours of work reads `WRAPPED`, and a marker written
   before 2026-08-26 reads `WRAPPED` because it records no intent either way.

## Notes

- Identity comes ONLY from `CLAUDE_CODE_SESSION_ID`, validated to the full lowercase-UUID shape — **never guessed from the filesystem** (the `session-manifest.py` module invariant: an mtime-guessed identity resolves to whichever session wrote last, i.e. a live peer; see `current_sid()`'s docstring + the `self-test` regression cases). Absent or non-UUID env → the command fails CLOSED (rc 1) with an honest message rather than printing something full-id-shaped that isn't.
- For **peers'** full ids, there is no command — `who` prints prefixes by design; map a prefix to its full id via its jsonl filename (`ls ~/.claude/projects/<project-key>/<prefix>*.jsonl`).
- Sibling reads: `/peers` (`who` — you + peers, prefixes), `session-manifest.py read` (cached peer manifests).

**Read-only state-query — carries its own marker `[whoami]`** (every reply is marked; same family as `/peers`, `/status`, `/flows`).
