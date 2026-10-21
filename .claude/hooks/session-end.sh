#!/usr/bin/env bash
# SessionEnd hook — write terminal "finished" marker on true exit.
# Non-blocking: ALWAYS exit 0. Reason-filtering (only logout/prompt_input_exit stamp the
# marker) happens in session-lifecycle.py. NB: the vendor docs give /clear reason `clear`
# and a normal exit reason `other`, both outside that filter; whether /exit or /clear fire
# SessionEnd on THIS build is UNMEASURED (#17885 / #6428 closed stale, not confirmed). Either
# way a session closed by /exit or /clear leaves NO marker and reads ACTIVE indefinitely. ⛔ THERE IS NO BACKSTOP —
# this line read "those rely on the jsonl-staleness backstop in cmd_gate" until that
# sweep was removed, and this file is read at exactly the
# debugging moment ("why did my exit not register?"), so a dead mechanism named here is
# the most expensive place to leave one. The answer is: it did not register, by design.
# Stdin JSON shape: { session_id, reason, hook_event_name, cwd, ... }  — SessionEnd sends
# `reason` (NOT `source`; SessionStart uses `source` — the field name differs per event).
set -uo pipefail
INPUT="$(cat 2>/dev/null || true)"
DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

if command -v jq >/dev/null 2>&1; then
  SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
  REASON=$(printf '%s' "$INPUT" | jq -r '.reason // .source // empty' 2>/dev/null)
else
  SID=$(printf '%s' "$INPUT" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  REASON=$(printf '%s' "$INPUT" | grep -oE '"reason"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
fi

python3 "$DIR/scripts/session-lifecycle.py" finished --session "${SID:-}" --reason "${REASON:-}" 2>/dev/null || true

# MAIL-LISTEN teardown (2026-07-16): kill THIS session's inbound-mail listener + GC its markers so the
# persistent monitor doesn't outlive the session (they were accumulating — 7 machine-wide). Best-effort:
# SessionEnd is documented for /clear (reason: clear) and a normal exit (reason: other) as well as logout/prompt_input_exit; whether /exit or /clear
# fire it on THIS build is UNMEASURED (#17885/#6428 were closed STALE, not confirmed — architecture.md Lecture 5). A listener left by
# a LIVE session that later re-starts self-corrects at the next SessionStart's kill -0 re-arm check; one
# left by an EXITED session gets no future SessionStart, so it leaks until a manual pkill. Targets this
# session's pid — though under PID REUSE the ps|grep could match a peer's mail-listen (benign: they re-arm).
if [ -n "${SID:-}" ]; then
  SID8=$(printf '%s' "$SID" | tr '[:upper:]' '[:lower:]' | cut -c1-8)   # match python current_sid() .lower()[:8] + the sibling arm hooks
  ML_PID_FILE="$DIR/.claude/state/mail-listen-${SID8}.pid"
  if [ -f "$ML_PID_FILE" ]; then
    ML_PID=$(cat "$ML_PID_FILE" 2>/dev/null)
    # Kill ONLY if the pid is actually a mail-listen (guards PID REUSE). Then drop the pid file either way.
    if [ -n "$ML_PID" ] && ps -p "$ML_PID" -o command= 2>/dev/null | grep -q 'mail-listen'; then
      kill "$ML_PID" 2>/dev/null || true
    fi
    rm -f "$ML_PID_FILE"
  fi
  # ALSO GC the armed-marker (written by mail-listen-armed-marker.sh; arm-reminder.sh self-silences on it).
  # Without this a logout→resume keeps the marker → the reliable every-turn re-nag stays silenced → re-arm
  # falls back to the flaky SessionStart directive → the resumed session can silently FAIL to re-arm.
  rm -f "$DIR/.claude/state/mail-listen-armed-${SID8}"
  # Same for keep-warm's armed-marker (keep-warm-armed-marker.sh): the timer dies with the process.
  rm -f "$DIR/.claude/state/keep-warm-armed-${SID8}"
fi
exit 0
