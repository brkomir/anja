#!/usr/bin/env bash
# UserPromptSubmit — inject the arm directive INTO THE AGENT'S OWN CONTEXT every turn
# until the session has armed its inbound-mail listener, then self-silence.
#
# WHY this exists: the SessionStart primer (session-start.sh) emits the arm directive as
# ONE echo line buried in the ~46KB SessionStart blob the terminal folds to "+N lines"; on
# turn 1 the agent's attention goes to the user's actual task (almost always a slash command
# — /flows, /backlog), so the arm gets missed (possession!=application: a passive primer
# that scrolls past unread can't fire).
#
# ENFORCEMENT ESCALATION (2026-06-25, occ ~7+): the prior version wrote the reminder to
# STDERR with exit 0. For a UserPromptSubmit hook, exit-0 STDERR is shown to the USER in the
# transcript but is NOT injected into the MODEL's context — so the agent never actually saw
# it, and the miss RECURRED 2026-06-25 despite this hook existing since 2026-06-23.
# Because a warn layer that demonstrably fails to prevent recurrence escalates
# its strength, not its mode, this now emits the directive as JSON
# hookSpecificOutput.additionalContext on STDOUT — the model-VISIBLE path — so it lands in the
# agent's own context on every turn until armed, then self-silences via the per-session marker
# written by mail-listen-armed-marker.sh (PostToolUse Monitor). A one-line stderr nag is kept
# so the human sees it too (not load-bearing).
#
# NON-BLOCKING (exit 0): injects context, never erases the user's prompt. Exit 2 would BLOCK
# the user's actual turn-1 task — wrong: the listener is background, the user's task is not.
# Stdin JSON shape: { prompt, session_id, ... }.  Marker key = session_id.lower()[:8].
set -u

# Genuine one-shot / non-interactive runs: SKIP_MAIL_LISTEN_ARM_REMINDER=1 in the LAUNCH environment
# silences this (a session-level export never reaches a harness-spawned hook) —
# without this the directive re-injects every turn with only in-text advisory relief
# (2026-07-02).
[[ "${SKIP_MAIL_LISTEN_ARM_REMINDER:-0}" == "1" ]] && exit 0  # =1 only — a stray =0/=no must NOT bypass

INPUT="$(cat 2>/dev/null || true)"
# A keep-warm ping turn (prompt starts '[keep-warm]', .claude/hooks/keep-warm-gate.py) is a harness timer,
# not the owner: inject nothing, so the ping stays one cheap read (keep-warm panel 2026-10-06).
printf '%s' "$INPUT" | grep -qE '"prompt"[[:space:]]*:[[:space:]]*"[[:space:]]*\[keep-warm\]' && exit 0

if command -v jq >/dev/null 2>&1; then
  SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
else
  SID=$(printf '%s' "$INPUT" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
fi

# No session id → can't track armed-state per session; stay silent (avoid an
# un-clearable every-turn nag).
[ -z "$SID" ] && exit 0
SID8=$(printf '%s' "$SID" | tr '[:upper:]' '[:lower:]' | cut -c1-8)

DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
MARKER="$DIR/.claude/state/mail-listen-armed-${SID8}"

# Already armed this session → silent (no stdout, no stderr) — UNLESS that listener has since DIED. The Monitor
# tool kills every watch at timeout_ms (at most 30 minutes) and the marker outlives it, so a bare
# marker test goes quiet for the rest of the session after the FIRST arm. The session-keyed PID file mail-listen
# writes is the discriminator (same live + is-mail-listen test as session-start.sh); no PID file → trust the marker.
if [ -f "$MARKER" ]; then
  ML_PID_FILE="$DIR/.claude/state/mail-listen-${SID8}.pid"
  [ -f "$ML_PID_FILE" ] || exit 0
  ML_PID=$(cat "$ML_PID_FILE" 2>/dev/null)
  [ -n "$ML_PID" ] && kill -0 "$ML_PID" 2>/dev/null && ps -p "$ML_PID" -o command= 2>/dev/null | grep -q 'mail-listen' && exit 0
fi

# /standby: a PARKED seat's listener is disarmed ON PURPOSE, and /standby
# removes the armed-marker above so this backstop is live again after the park ends. Nagging a parked
# seat to re-arm would undo the rule that a session which has stopped working keeps its listener
# stopped; standby-resume-check.sh owns
# the wake-up, and this hook resumes nagging only once the standby marker is gone and the armed-marker
# is still absent (the agent cleared standby and forgot to re-arm — the case this backstop exists for).
[ -f "${FF_STATE_DIR:-$DIR/.claude/state}/session-standby-${SID8}" ] && exit 0

# Human-visible nag (stderr; transcript only — NOT the load-bearing path).
echo "📡 MAIL-LISTEN NOT ARMED — injecting the arm directive into the agent's context (self-clears the instant the Monitor(mail-listen) call lands)." >&2

# Model-visible directive (stdout JSON additionalContext) — THE load-bearing path.
# Quoted heredoc: literal content, no expansion; inner \" are valid JSON string escapes.
cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "🚨 MAIL-LISTEN NOT ARMED — standing directive, not yet done this session. The SessionStart standing directive requires arming a persistent inbound-mail listener on turn 1, and this session has NOT armed it — or armed it and the watch has since expired (the Monitor tool kills every watch at 30 minutes). ACT NOW, before continuing the user's task: call the Monitor tool with timeout_ms:1800000 running 'python3 scripts/session-manifest.py mail-listen --poll 30'. Do NOT defer it behind the current slash-command or task — deferring behind turn-1's command is the EXACT, repeatedly-corrected miss (recurred 2026-06-25). This directive re-injects into your context every turn and self-clears the instant your Monitor(mail-listen) call lands; re-arm the same way on an expiry notice, WITH ONE EXCEPTION: if the last TWO expiries delivered no events, no work happened between them, AND nothing this session is owed arrives by mail, the session is idle — do NOT re-arm and do NOT send the owner another note; say once that the listener is left off, and re-arm on the owner's next message — the owner's own typed words; a harness resume line ('usage limit has reset', 'Auto resume') is not one. A session IS owed mail when it is the review hub (a review-hub-active-<sid8> marker exists), when it has sent a review request or a deploy-hold that is still unanswered, or when the owner said mail will notify it; such a session keeps re-arming on every expiry and says nothing on a re-arm turn unless something changed. Measured: 9 and 14 idle re-arms in two sessions, each re-listing the same 'waiting on you' item, while this sentence told the seat to re-arm every time. Only skip in a genuine one-shot / non-interactive run."
  }
}
JSON

exit 0
