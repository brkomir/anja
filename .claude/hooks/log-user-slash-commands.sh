#!/usr/bin/env bash
# User-typed slash-command logger — fires on UserPromptSubmit.
#
# Closes the telemetry capture gap surfaced on 2026-06-16:
# `log-skill-invocations.sh` (PreToolUse, Skill matcher) records ONLY
# orchestrator-initiated Skill-TOOL calls. A user-typed `/orient` (or any
# `/cmd`) is expanded by the harness as a command message — it never routes
# through the Skill tool, so it was invisible to the log. Result: `orient`
# read 0 invocations despite opening nearly every session, and dormancy-by-log
# was unreliable for every user-facing command skill (false-dormant class).
#
# This hook captures the OTHER half of the surface: when a user prompt is a
# genuine slash-command invocation (first token is `/<name>`), append a record
# to the SAME log so /meta telemetry sees both paths.
#
# Records carry source:"user-prompt"; the Skill-tool logger carries
# source:"skill-tool". The two writers are DISJOINT (a user `/cmd` never hits
# the Skill tool; an orchestrator Skill() call has no UserPromptSubmit), so
# there is no double-count. The source field lets telemetry separate
# user-initiated usage from orchestrator auto-fired sub-skills (e.g. /wrap
# auto-firing session-memory/me/decisions inflates their skill-tool counts).
#
# Log format: JSONL, one line per invocation
# Fields: {ts, skill, args, session, source:"user-prompt"}
# Location: .claude/logs/skill-invocations.jsonl
#
# Silent — NEVER writes stdout/stderr (UserPromptSubmit stdout is injected into
# model context; advisory output belongs to trigger-index-match.sh, not here)
# and NEVER blocks the prompt. Logging failures exit 0.
#
# Smoke-tested via scripts/smoke-test-hooks.sh (FIRE pairs + SAFE pairs).

set -u  # no -e; logging must never fail the user-prompt path

LOG_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.claude/logs"
LOG_FILE="$LOG_DIR/skill-invocations.jsonl"
mkdir -p "$LOG_DIR" 2>/dev/null || exit 0

INPUT="$(cat)"

# Extract the user prompt (prefer jq; grep fallback for single-line case).
if command -v jq >/dev/null 2>&1; then
  PROMPT="$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)"
else
  PROMPT="$(printf '%s' "$INPUT" | grep -oE '"prompt"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*: *"\(.*\)"$/\1/')"
fi

[ -n "${PROMPT:-}" ] || exit 0

# A slash command is recognized ONLY when the FIRST non-whitespace token of the
# prompt is `/<name>` (the harness's own rule). This excludes mid-sentence
# mentions like "let's run /meta telemetry" — those are natural language, not
# invocations (and if the orchestrator runs them via Skill(), the skill-tool
# logger captures them).
FIRST_LINE="$(printf '%s' "$PROMPT" | sed -n '1p')"
# Strip leading whitespace, require a leading slash.
case "$(printf '%s' "$FIRST_LINE" | sed 's/^[[:space:]]*//')" in
  /*) : ;;            # starts with a slash — candidate
  *)  exit 0 ;;       # not a slash command
esac

# Parse `/<cmd> <args...>`. cmd = [A-Za-z0-9:_-]+ (covers plugin-namespaced
# `vercel:deploy`); args = remainder of the first line after the command token.
TRIMMED="$(printf '%s' "$FIRST_LINE" | sed 's/^[[:space:]]*//')"
CMD="$(printf '%s' "$TRIMMED" | sed -E 's#^/([A-Za-z0-9:_-]+).*#\1#')"
ARGS="$(printf '%s' "$TRIMMED" | sed -E 's#^/[A-Za-z0-9:_-]+[[:space:]]*##')"

[ -n "${CMD:-}" ] || exit 0

# Only log REAL commands — a local skill dir, a .claude/commands/*.md file, or a
# plugin-namespaced `:` command. This filters built-in harness commands
# (/clear, /compact, /context, /config, /fast, /login, …) and pasted file paths
# (/<home-dir>/...), keeping the log aligned with the Skill-tool logger's semantics.
PROJ="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
if [ -d "$PROJ/.claude/skills/$CMD" ] || [ -f "$PROJ/.claude/commands/$CMD.md" ] || [[ "$CMD" == *:* ]]; then
  :
else
  exit 0
fi

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# ⛔ Same one-token defect as log-skill-invocations.sh, fixed in the same change: the harness
# sets `CLAUDE_CODE_SESSION_ID`, never `CLAUDE_SESSION_ID`, so every record this hook has ever
# written carries `session:"unknown"` (4,341 of 4,341 across both writers, measured 2026-09-02).
# ⚠️ The smoke arm sets `CLAUDE_SESSION_ID` itself (`smoke-test-hooks.sh`, the `uslc_fire`
# helper), which is why a green suite never caught it — it supplied the variable production
# does not. Payload first, env as fallback, matching the sibling hooks.
SESSION="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)"
SESSION="${SESSION:-${CLAUDE_CODE_SESSION_ID:-${CLAUDE_SESSION_ID:-unknown}}}"

if command -v jq >/dev/null 2>&1; then
  printf '%s' "${ARGS:-}" | jq -Rsnc \
    --arg ts "$TS" --arg skill "$CMD" --arg session "$SESSION" --arg source "user-prompt" \
    '{ts:$ts, skill:$skill, args:input, session:$session, source:$source}' \
    >> "$LOG_FILE" 2>/dev/null || true
else
  ARGS_ESC=$(printf '%s' "${ARGS:-}" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' \
    -e ':a' -e 'N' -e '$!ba' -e 's/\n/\\n/g' -e 's/\t/\\t/g' -e 's/\r/\\r/g')
  printf '{"ts":"%s","skill":"%s","args":"%s","session":"%s","source":"user-prompt"}\n' \
    "$TS" "$CMD" "$ARGS_ESC" "$SESSION" >> "$LOG_FILE" 2>/dev/null || true
fi

exit 0
