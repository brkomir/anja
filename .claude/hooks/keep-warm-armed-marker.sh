#!/usr/bin/env bash
# PostToolUse(CronCreate) — record that THIS session armed its keep-warm timer.
#
# Pairs with keep-warm-arm-reminder.sh (UserPromptSubmit): that hook re-surfaces the
# `/keep-warm on` directive every turn UNTIL armed; this hook writes the per-session
# marker that SELF-SILENCES it the moment the agent's CronCreate for the timer lands.
# The mirror of mail-listen-armed-marker.sh, built because keep-warm shipped
# (2026-10-06) with only the one-line SessionStart directive, the exact shape the
# mail-listen pair exists to back up: one session (2026-10-18) armed the mail
# listener and the working plan on turn 1 — both have every-turn reminders — and
# never armed keep-warm, so its cache went cold over a multi-hour gap.
#
# Prevents: the missed-arm gap (possession != application), keep-warm leg.
# WARN-tier infra: writes a marker, never blocks. Always exit 0.
# Stdin JSON shape: { session_id, tool_name, tool_input: { cron, prompt, ... }, ... }
# Marker key = session_id.lower()[:8] — the project-wide convention.
set -u
INPUT="$(cat 2>/dev/null || true)"

if command -v jq >/dev/null 2>&1; then
  SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
  PROMPT=$(printf '%s' "$INPUT" | jq -r '.tool_input.prompt // empty' 2>/dev/null)
  RECURRING=$(printf '%s' "$INPUT" | jq -r '.tool_input.recurring' 2>/dev/null)   # not `// empty`: jq's // swallows false
else
  SID=$(printf '%s' "$INPUT" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  PROMPT=$(printf '%s' "$INPUT" | grep -oE '"prompt"[[:space:]]*:[[:space:]]*"[^"]*' | head -1 | sed 's/^"prompt"[[:space:]]*:[[:space:]]*"//')
  RECURRING=$(printf '%s' "$INPUT" | grep -qE '"recurring"[[:space:]]*:[[:space:]]*false' && echo false)
fi
# A one-shot fires once and deletes itself: it is not a timer, so it must not silence the reminder.
[ "$RECURRING" = "false" ] && exit 0
# The gate lstrips the prompt before matching its SENTINEL; match the same way, or a timer the gate
# recognises writes no marker and the reminder re-fires on every prompt.
PROMPT="${PROMPT#"${PROMPT%%[![:space:]]*}"}"

# Only the keep-warm timer counts: its prompt opens with the gate's SENTINEL
# (keep-warm-gate.py), the same words the skill tells the agent to use verbatim.
case "$PROMPT" in
  "[keep-warm] automated cache keep-alive"*) ;;
  *) exit 0 ;;
esac

[ -z "$SID" ] && exit 0
SID8=$(printf '%s' "$SID" | tr '[:upper:]' '[:lower:]' | cut -c1-8)

DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
STATE="${FF_STATE_DIR:-$DIR/.claude/state}"
mkdir -p "$STATE" 2>/dev/null || true
touch "$STATE/keep-warm-armed-${SID8}" 2>/dev/null || true
exit 0
