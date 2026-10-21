#!/usr/bin/env bash
# PostToolUse(Monitor) — record that THIS session armed its inbound-mail listener.
#
# Pairs with mail-listen-arm-reminder.sh (UserPromptSubmit): that hook re-surfaces
# the arm directive every turn UNTIL armed; this hook writes the per-session marker
# that SELF-SILENCES it the moment the agent's Monitor(mail-listen ...) call lands.
#
# Closes the gap behind the mail-listen standing directive (graduated 2026-07-19): the
# SessionStart primer (session-start.sh) emits the arm directive as ONE line buried
# in the ~19KB SessionStart blob the terminal folds away, so turn-1 attention (on
# the user's actual task) misses it.
#
# WARN-tier infra: writes a marker, never blocks. Always exit 0.
# Stdin JSON shape: { session_id, tool_name, tool_input: { command, ... }, ... }
# Marker key = session_id.lower()[:8] — matches the project-wide convention in
# scripts/session-manifest.py (session-finished-<sid8>, etc.).
set -u
INPUT="$(cat 2>/dev/null || true)"

if command -v jq >/dev/null 2>&1; then
  SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
  CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  SID=$(printf '%s' "$INPUT" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  CMD=$(printf '%s' "$INPUT" | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*: *"\(.*\)"$/\1/')
fi

# Only a Monitor call that actually arms the mail listener counts.
case "$CMD" in
  *mail-listen*) ;;
  *) exit 0 ;;
esac

[ -z "$SID" ] && exit 0
SID8=$(printf '%s' "$SID" | tr '[:upper:]' '[:lower:]' | cut -c1-8)

DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
mkdir -p "$DIR/.claude/state" 2>/dev/null || true
touch "$DIR/.claude/state/mail-listen-armed-${SID8}" 2>/dev/null || true
exit 0
