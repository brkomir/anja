#!/bin/bash
# PreToolUse hook: log Edit/Write attempts on MEMORY.md and .claude/agents/ files.
# Diagnostic only — never blocks the tool. Captures every attempted path so we can
# cross-reference "Edit denied" errors in subagent output against actual file paths
# the harness sees, to diagnose why allow-patterns miss-match.
#
# Wired into .claude/settings.json PreToolUse / matcher "Edit|Write".
# Receives tool_input JSON on stdin. Always exits 0.

set -u
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"  # hooks inherit the session cwd
LOG_DIR="$ROOT/.claude/logs"
LOG_FILE="$LOG_DIR/memory-write-attempts.log"

mkdir -p "$LOG_DIR" 2>/dev/null || exit 0

# Read stdin, extract file_path + tool_name safely; fall back to empty if jq absent or JSON malformed.
INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null)

# Filter: only log if path references MEMORY.md or .claude/agents/ — keeps log focused.
if [ -n "$FILE_PATH" ] && { echo "$FILE_PATH" | grep -qE '(MEMORY\.md|\.claude/agents/)'; }; then
  TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  printf '%s %s %s\n' "$TS" "$TOOL" "$FILE_PATH" >> "$LOG_FILE" 2>/dev/null || true
fi

# ── HTML-ESCAPE / ENVELOPE WARN (added 2026-08-27) ───────────────────────────────────────────
# The agent-return notification XML-escapes its payload, so a Memory-Update block persisted from
# it carries `&lt;` `&gt;` and stray `</result>` envelope tags straight into durable memory. That
# silently corrupts recorded predicates — the sharpest instance was a comparison operator,
# `1 &lt;= versionCount &lt; PLAN_LIMITS[...]`, which no longer reads as the predicate it recorded.
#
# ⛔ THE RULE FOR THIS ALREADY EXISTS ("the wrapper XML-ESCAPES the payload,
# so decode entities before persisting"). It did not fire: 61 escapes and 15 envelope tags had
# accrued across 21 memory files by the time anyone measured. So the gap is ENFORCEMENT, not
# knowledge, and this is the enforce layer — a warn at the moment of the write, where the
# decision is, rather than a rule read at some other time.
#
# WARN ONLY, never blocks. A payload legitimately ABOUT escaping (a note quoting `&quot;`) will
# trip it; that is the accepted cost of a warn, and the model can judge in context.
#
# ⚠ The path filter here is DELIBERATELY WIDER than the logging filter above: it matches
# MEMORY-ARCHIVE-*.md too, which is where most of the measured corruption actually landed and
# which the log filter misses entirely.
#
# ⛔ THE THIRD ALTERNATIVE `/memory` IS LOAD-BEARING, NOT BELT-AND-BRACES. The bare
# `MEMORY[^/]*\.md` this replaced also matched an ordinary doc whose name merely contains MEMORY;
# the remedy proposed in review was `(skills|project-memory)/`, which is blind to the HARNESS
# spelling — .claude/projects/<key>/memory/ is a symlink to .claude/project-memory and carries
# NEITHER token. Measured against this hook's own ledger (3121 records
# / 50 distinct memory paths): bare = 50 kept but 6/6 hazards matched; the proposed
# two-token form = 49 kept, 1 MISSED, and that one spelling is 87 real writes; this three-token
# form = 50 kept, 0 missed, 0 of 6 hazards. Re-score against the ledger before narrowing it again.
PAYLOAD=$(printf '%s' "$INPUT" | jq -r '(.tool_input.new_string // "") + (.tool_input.content // "")' 2>/dev/null)
if [ -n "$FILE_PATH" ] && echo "$FILE_PATH" | grep -qE '(skills|project-memory|/memory)/.*MEMORY[^/]*\.md'; then
  FOUND=""
  for TOK in '&lt;' '&gt;' '&amp;' '&quot;' '</result>' '<result>'; do
    case "$PAYLOAD" in *"$TOK"*) FOUND="$FOUND $TOK" ;; esac
  done
  if [ -n "$FOUND" ]; then
    # ONE JSON document only — the harness discards a hook's stdout wholesale if it is not
    # exactly one, so two findings would deliver neither.
    printf '%s' "$INPUT" | jq -n --arg toks "$FOUND" --arg fp "$FILE_PATH" \
      '{hookSpecificOutput:{hookEventName:"PreToolUse",additionalContext:("⚠️ MEMORY WRITE CARRIES HARNESS ESCAPES:" + $toks + "  ->  " + $fp + "\nThe agent-return notification XML-escapes its payload. DECODE before persisting: & lt; -> <, & gt; -> >, and drop any </result> envelope tag. A persisted `&lt;=` is a corrupted predicate, not a typo. If this text is deliberately ABOUT escaping, ignore this — it is a warn, not a gate.")}}' \
      2>/dev/null || true
  fi
fi

exit 0
