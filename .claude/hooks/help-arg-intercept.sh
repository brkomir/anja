#!/usr/bin/env bash
# help-arg-intercept.sh — PreToolUse hook on the Skill matcher.
#
# Enforces the always-loaded `universal-help-arg` convention: any slash
# command whose sole arg is `help` / `--help` / `-h` /
# `?` must EMIT that command's Usage section (read live from its spec) WITHOUT
# executing the command.
#
# This is the ENFORCE-layer backstop for that orchestrator convention. The
# convention itself is instruction-layer — and like all
# instruction-layer rules it can be ignored ~10-15% of the time. This hook
# denies the Skill call and routes the orchestrator to
# emit usage instead — so a `help` arg can NEVER accidentally run the command
# (a hard requirement, not a preference).
#
# Prevents: NEW class "help-arg-swallowing" — a `help` arg silently executing a
# command's Process (side effects, agent dispatch, file writes) instead of
# showing usage. No prior L#; this hook ships with the convention. (SC-2: hook
# names the failure-mode it prevents.)
#
# BLOCK-MODE (deliberate warn-first WAIVER):
#   (a) the requirement is a hard block — a help arg must never run the command;
#   (b) FP profile ~0 — exact-string match on a 4-token set, single exemption;
#   (c) FP cost trivially recoverable — a deny just routes to "show usage", and
#       the orchestrator can re-invoke without the help arg.
# Per-invocation escape: SKIP_HELP_ARG_INTERCEPT=1.
#
# Exemption: skill=="help" — `/help help` should RUN /help (it is already the
# cross-command router; the convention routes `/help help` → run /help).
#
# Companion: .claude/skills/help/SKILL.md;
# scripts/smoke-test-hooks.sh (FIRE + SAFE + EXEMPT + escape assertions).

set -u
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"  # hooks inherit the session cwd

[ "${SKIP_HELP_ARG_INTERCEPT:-0}" = "1" ] && exit 0

INPUT=$(cat 2>/dev/null || echo "{}")

if command -v jq >/dev/null 2>&1; then
  TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)
  SKILL=$(printf '%s' "$INPUT" | jq -r '.tool_input.skill // ""' 2>/dev/null)
  ARGS=$(printf '%s' "$INPUT" | jq -r '.tool_input.args // ""' 2>/dev/null)
else
  TOOL=$(printf '%s' "$INPUT" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  SKILL=$(printf '%s' "$INPUT" | grep -o '"skill"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  ARGS=$(printf '%s' "$INPUT" | grep -o '"args"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
fi

# Only gate the Skill tool
[ "$TOOL" = "Skill" ] || exit 0

# Exempt the help router itself (`/help help` → run /help, don't block)
[ "$SKILL" = "help" ] && exit 0

# Trim leading/trailing whitespace from args
ARGS_TRIMMED=$(printf '%s' "$ARGS" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

# Fire ONLY on an exact help token (case-insensitive for word forms).
# Note: `'?'` is single-quoted in the case pattern so it matches a LITERAL
# question mark, not the glob "any single char".
ARGS_LC=$(printf '%s' "$ARGS_TRIMMED" | tr '[:upper:]' '[:lower:]')
case "$ARGS_LC" in
  help|--help|-h|'?') ;;   # matched → fall through to deny
  *) exit 0 ;;             # any other args → let the skill run
esac

# Log for observability / calibration (never blocks on log failure)
LOG_DIR="$ROOT/.claude/logs"
mkdir -p "$LOG_DIR" 2>/dev/null || true
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "unknown")
printf '%s INTERCEPT skill=%s args=%s\n' "$TS" "$SKILL" "$ARGS_TRIMMED" \
  >> "$LOG_DIR/help-arg-intercept.log" 2>/dev/null || true

# Deny execution; route the orchestrator to emit usage per the convention.
# SKILL + ARGS_TRIMMED are safe to interpolate: SKILL is a kebab-case skill
# name and ARGS_TRIMMED is guaranteed (by the case match above) to be one of
# {help, --help, -h, ?} — no quote/backslash that could break the JSON.
cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "universal-help-arg convention: '/${SKILL} ${ARGS_TRIMMED}' is a HELP request, not an execution. Do NOT run the ${SKILL} skill. Instead read .claude/skills/${SKILL}/SKILL.md (or .claude/commands/${SKILL}.md) and emit its Usage / entry-points section inline — every subcommand + one-line purpose + every flag — prefixed with the marker for the command asked about ('[${SKILL}]'; there is no unprefixed state), ending with 'run /${SKILL} <subcommand> to execute'. If the request was '<subcommand> help', scope the readout to that one subcommand. Per-invocation override if you truly intend to execute with a literal 'help' arg: SKIP_HELP_ARG_INTERCEPT=1."
  }
}
EOF

exit 0
