#!/usr/bin/env bash
# log-subagent-dispatch.sh — SubagentStart observer. LOG ONLY, never decides.
#
# WHY THIS EXISTS (2026-09-04). Sub-agent dispatch is the plane
# carrying the majority of this fleet's API calls and a large share of its cache-read,
# and it was UNINSTRUMENTED. The two adjacent logs each answer a DIFFERENT question:
#   the dispatch-memory guard's log records the dispatch DESCRIPTION (free text)
#   the instructions-loaded log does not fire on dispatch at all
# So nobody could count dispatches BY AGENT TYPE, which is what the rule that read-only
# fan-outs run as Explore agents turns on. This hook records
# the agent type at dispatch so that adoption is a readable number instead of a belief.
#
# WHAT THE PAYLOAD CARRIES — verified against the CLI binary, not assumed. In
# 2.1.260 the SubagentStart zod schema is the common base (session_id, transcript_path,
# cwd, ...) AND `{hook_event_name:"SubagentStart", agent_id, agent_type}`, both required
# strings. The dispatch site passes `matchQuery: <agent_type>`, so a `matcher` on this
# event would match against the AGENT TYPE. We wire it matcher-less = every dispatch.
# (This refutes an older note calling SubagentStart
# "stderr-only, no payload" — that is false for this CLI version.)
#
# ⛔ EMITS NOTHING ON STDOUT, EVER. On SubagentStart, stdout is a DELIVERY CHANNEL into
# the freshly-dispatched sub-agent's context (exit 0 + a hookSpecificOutput document sets
# additionalContext). This hook exists to MEASURE dispatch cost; a hook that measured the
# cost while silently ADDING to every dispatched payload would corrupt its own instrument.
# Worse, the harness discards a hook's stdout wholesale unless it is exactly one JSON
# document (.claude/rules/bash-environment.md), so a stray echo here is not merely noise —
# it can suppress a sibling hook's real document. The smoke suite pins the silence with a
# STDOUT-SILENT arm whose positive control is the log line itself. Do not add an echo.
#
# NOT A GUARD. It asserts nothing and gates nothing. Wired FLEET-WIDE, so it takes the
# contained shape per .claude/rules/session-cadence.md § blast radius of the guard's own
# failure: no -e, silent mkdir, silent append, exit 0 on every path.
#
# Log format: JSONL, one line per dispatch
# Fields: {ts, agent_type, agent_id, session}
# Location: .claude/logs/subagent-dispatch.jsonl  (gitignored — high-churn telemetry)

set -u  # unset vars are errors, but no -e (a logging failure must never reach the dispatch)

LOG_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.claude/logs"
LOG_FILE="$LOG_DIR/subagent-dispatch.jsonl"

# Escape valve, same convention as the other loggers in this dir.
if [ "${SKIP_SUBAGENT_DISPATCH_LOG:-0}" = "1" ]; then
  exit 0
fi

# Ensure log dir exists; fail silent if we cannot create it.
mkdir -p "$LOG_DIR" 2>/dev/null || exit 0

INPUT="$(cat 2>/dev/null || true)"

# ⛔ TRY jq, THEN FALL THROUGH TO grep — NEVER BRANCH ON `command -v jq`. Presence is not
# function: a jq that EXISTS but exits non-zero (broken install, a PATH shim) satisfies
# `command -v` and returns nothing, so an if/else on presence routes a broken jq to the jq
# arm and the record is silently LOST — a logger that stops recording looks exactly like a
# fleet with no dispatches. `always-loaded-claim-warn.sh` shipped this bug and fixed it the
# same way; the smoke suite drives both hooks through an exit-127 jq shim to pin it.
_field() {  # $1 = json key; echoes the value, empty if unextractable
  _v=""
  _v=$(printf '%s' "$INPUT" | jq -r --arg k "$1" '.[$k] // empty' 2>/dev/null) || _v=""
  if [ -z "$_v" ]; then
    _v=$(printf '%s' "$INPUT" \
      | grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" \
      | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  fi
  printf '%s' "$_v"
}

AGENT_TYPE="$(_field agent_type)"
AGENT_ID="$(_field agent_id)"
SESSION="$(_field session_id)"

# ⛔ READ THE SESSION FROM THE PAYLOAD, NEVER FROM THE ENV FIRST. The harness sets
# CLAUDE_CODE_SESSION_ID, never CLAUDE_SESSION_ID — reading the latter stamped
# session:"unknown" on 4,341 of 4,341 records in the sibling skill logger (measured
# 2026-09-02, since fixed). Payload first, env only as a fallback.
SESSION="${SESSION:-${CLAUDE_CODE_SESSION_ID:-unknown}}"

# Only log when we actually extracted an agent type. On SubagentStart agent_type is a
# REQUIRED field, so an empty read means a parse failure or a non-SubagentStart payload —
# either way there is nothing to count, and a record with an empty type would silently
# inflate every per-type denominator that reads this log.
if [ -n "${AGENT_TYPE:-}" ]; then
  TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)
  # Compose with jq for correct escaping; VERIFY it produced an object before trusting it
  # (same broken-jq reasoning as the extractor above — an empty compose must not append a
  # blank line into a JSONL file every consumer parses line by line).
  LINE="$(jq -nc --arg ts "$TS" --arg agent_type "$AGENT_TYPE" --arg agent_id "$AGENT_ID" \
            --arg session "$SESSION" \
            '{ts:$ts, agent_type:$agent_type, agent_id:$agent_id, session:$session}' 2>/dev/null)" || LINE=""
  case "$LINE" in
    '{'*) : ;;
    *)  # Fallback: escape ", \, and the control chars that would break a JSONL reader.
        # ⛔ NO `-e ':a' -e 'N' -e '$!ba'` LINE-JOIN HERE. /usr/bin/sed is BSD sed and its
        # `N` at end of input QUITS WITHOUT PRINTING — measured 2026-09-04, empty output
        # BOTH with and without a trailing newline. The whole escaper returned EMPTY, so the
        # fallback wrote {"agent_type":"","agent_id":"","session":""}: a record that PARSES,
        # looks well-formed, and carries nothing. Escape quote+backslash with sed, then delete
        # control bytes with tr — these three fields are identifiers, so an embedded newline
        # is corruption rather than content. (.claude/rules/bash-environment.md § BSD userland.)
        _esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\000-\037'; }
        LINE="$(printf '{"ts":"%s","agent_type":"%s","agent_id":"%s","session":"%s"}' \
          "$TS" "$(_esc "$AGENT_TYPE")" "$(_esc "$AGENT_ID")" "$(_esc "$SESSION")")" ;;
  esac
  # ⚠️ THE BRACES ARE LOAD-BEARING, NOT STYLE. `printf ... >> "$F" 2>/dev/null` does NOT
  # silence a failed append: redirections are set up left to right, so the shell reports
  # "Permission denied" on `>> "$F"` BEFORE `2>/dev/null` exists and the message reaches
  # the real stderr. Grouping puts the redirect outside, covering the append itself.
  # (Same correction already carried by log-instructions-loaded.sh.)
  { printf '%s\n' "$LINE" >> "$LOG_FILE"; } 2>/dev/null || exit 0
fi

exit 0
