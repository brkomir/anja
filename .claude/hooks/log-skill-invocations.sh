#!/usr/bin/env bash
# Skill-tool invocation logger (2026-04-16)
# Runs on PreToolUse for Skill tool. Captures which skills are invoked
# at runtime — complements the meta dormant-detection grep heuristic
# (which only sees commit-mentions, not actual invocations).
#
# Log format: JSONL, one line per invocation
# Fields: {ts, skill, args, session_dir}
# Location: .claude/logs/skill-invocations.jsonl
#
# Read this log during /meta expert reviews to identify:
# - Which skills have zero invocations in 60+ days (true dormant)
# - Which skills are most-used
# - Usage pattern changes after skill-spec edits
#
# Ignore failures silently — logging never blocks tool execution.
set -u  # unset vars are errors, but no -e (don't fail the tool call)

LOG_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.claude/logs"
LOG_FILE="$LOG_DIR/skill-invocations.jsonl"

# Ensure log dir exists; fail silent if can't create
mkdir -p "$LOG_DIR" 2>/dev/null || exit 0

# Parse Skill tool input from stdin (JSON from Claude Code hook runtime)
# Expected payload shape: { tool_name: "Skill", tool_input: { skill: "...", args: "..." } }
INPUT="$(cat)"

# Extract fields with jq (fallback to grep if jq missing)
if command -v jq >/dev/null 2>&1; then
  SKILL=$(printf '%s' "$INPUT" | jq -r '.tool_input.skill // empty' 2>/dev/null)
  ARGS=$(printf '%s' "$INPUT" | jq -r '.tool_input.args // empty' 2>/dev/null)
else
  SKILL=$(printf '%s' "$INPUT" | grep -o '"skill"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  ARGS=$(printf '%s' "$INPUT" | grep -o '"args"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
fi

# Only log if we extracted a skill name (filters non-Skill tool calls + parse failures)
if [ -n "${SKILL:-}" ]; then
  TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  # ⛔ THE HARNESS SETS `CLAUDE_CODE_SESSION_ID`, NEVER `CLAUDE_SESSION_ID` — reading the
  # latter stamped `session:"unknown"` on 4,341 of 4,341 records (100%), measured 2026-09-02.
  # Every consumer that wants per-seat data (`/meta telemetry`, `/instinct-sweep`) has therefore
  # only ever had fleet-wide counts.
  # ⚠️ The smoke arm was GREEN throughout because `smoke-test-hooks.sh` sets `CLAUDE_SESSION_ID`
  # itself before firing this hook, so it proved the code path works when the variable is set
  # and was structurally incapable of noticing production never sets it — the fixture-supplies-
  # the-variable vacuous control. Read the PAYLOAD first, as the sibling hooks
  # (band-o-inject, compact-save, log-instructions-loaded) already do; env is the fallback.
  SESSION="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)"
  SESSION="${SESSION:-${CLAUDE_CODE_SESSION_ID:-${CLAUDE_SESSION_ID:-unknown}}}"
  # Build JSON via jq if available — handles control chars (\n, \t, \r) correctly
  # (fix 2026-05-18: manual sed-escape only handled " — newlines in args caused
  # `jq` parse-error contamination at downstream analysis time).
  # source:"skill-tool" distinguishes orchestrator-initiated Skill-TOOL calls
  # from user-typed slash commands (source:"user-prompt", written by
  # log-user-slash-commands.sh on UserPromptSubmit). Added 2026-06-16 — lets
  # /meta telemetry separate user-initiated usage from auto-fired sub-skills.
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "${ARGS:-}" | jq -Rsnc \
      --arg ts "$TS" --arg skill "$SKILL" --arg session "$SESSION" --arg source "skill-tool" \
      '{ts:$ts, skill:$skill, args:input, session:$session, source:$source}' \
      >> "$LOG_FILE" 2>/dev/null || true
  else
    # Fallback: escape ", \, \n, \t, \r
    ARGS_ESC=$(printf '%s' "${ARGS:-}" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' \
      -e ':a' -e 'N' -e '$!ba' -e 's/\n/\\n/g' -e 's/\t/\\t/g' -e 's/\r/\\r/g')
    printf '{"ts":"%s","skill":"%s","args":"%s","session":"%s","source":"skill-tool"}\n' \
      "$TS" "$SKILL" "$ARGS_ESC" "$SESSION" >> "$LOG_FILE" 2>/dev/null || true
  fi
fi

exit 0
