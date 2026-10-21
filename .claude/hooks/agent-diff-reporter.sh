#!/usr/bin/env bash
# PostToolUse hook — emit git status + diff --stat summary after every Agent
# tool call. Closes the agent-claim-drift gap where agents self-report
# "zero delta" / "no file modifications" / "nothing staged" while having
# actually made substantial edits.
#
# Rationale (3 recurrences):
#   - 2026-04-18: saas-engineer + qa-expert both reported zero-delta
#     while having landed real edits (~190 lines across 2 test files).
#   - 2026-04-19: Agent A's self-report drifted from tool-call history.
#   - 2026-04-20: saas-engineer Agent A reported "all 6 findings
#     already implemented, no edits required" while git diff --stat showed
#     +356 LOC across their ownership.
#
# The rule in .claude/skills/agent-work/SKILL.md Rule 4 ("Agent-claim drift
# check") tells the orchestrator to run `git diff --stat` post-agent, but
# enforcement-via-instruction is unreliable at composition time (hit 3×).
# This hook runs the check mechanically — orchestrator sees git state in
# stderr regardless of whether the agent's self-report was honest.
#
# MODE: INFORMATIONAL (exit 0 always). Stderr output shows up in the agent
# tool_result tail visible to the orchestrator; no blocking, no intercept.
#
# Scope: fires on PostToolUse matcher "Agent". If there's nothing to report
# (no staged/dirty/untracked changes), silent no-op so routine read-only
# agent consults don't spam output.
#
# Smoke-tested 2026-04-20 on fresh ai-vision-expert smoke (tool_uses=0, no
# changes) — hook correctly exited 0 silently. Real test: next /agent-work
# wave will produce meaningful git diff output in each agent's tool_result.

set -u

# Model-aimed advisory on PostToolUse. Measured 2026-08-25: bare stderr delivers ZERO text
# to the model on this event; additionalContext is quoted back verbatim. WARN_EMIT_EVENT is
# REQUIRED — the lib defaults to PreToolUse and would misroute the payload.
WARN_EMIT_EVENT=PostToolUse
# ⛔ HANDLES BOTH CALL SHAPES, and that is not tidiness. A bash function does NOT forward its
# arguments to a command in its body, so the old `warn_emit() { cat >&2; }` ran `cat` with NO
# args on an ARGUMENT call — reading stdin instead. Measured: advisory LOST at stdin EOF,
# HANGS with stdin open. The fallback exists for the case where the lib does not resolve, and
# in that exact case an argument-form caller emitted nothing at all.
warn_emit() { if [ "$#" -gt 0 ]; then printf '%s\n' "$*" >&2; else cat >&2; fi; }
case $- in *e*) _WE_HAD_E=1 ;; *) _WE_HAD_E=0 ;; esac
set +e
. "$(dirname "${BASH_SOURCE[0]}")/lib/warn-emit.sh" 2>/dev/null
[ "$_WE_HAD_E" = 1 ] && set -e
unset _WE_HAD_E

# Count changes across staging area, working tree, and untracked files.
# Defensive: any failure drops to 0 so hook never blocks.
staged=$(git diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')
dirty=$(git diff --name-only 2>/dev/null | wc -l | tr -d ' ')
untracked=$(git ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')

# Silent when nothing changed (read-only consults).
if [[ "${staged:-0}" -eq 0 && "${dirty:-0}" -eq 0 && "${untracked:-0}" -eq 0 ]]; then
  exit 0
fi

# This advisory exists to stop the ORCHESTRATOR repeating an agent false zero-delta claim, so it
# is model-aimed by construction — and it sat on the channel the model cannot read.
# BUILT INTO A VARIABLE, then passed as an ARGUMENT. A pipe into warn_emit runs it in a SUBSHELL
# where the emit-once guard cannot persist; two JSON documents on stdout are not one document and
# the harness discards stdout WHOLESALE, so the subshell form would silently deliver nothing.
# ⛔ NO COMMENTS AND NO APOSTROPHES INSIDE THE $( ) BELOW: an apostrophe in prose there opens a
# quote and takes the whole file with it. That broke this hook one attempt ago; bash -n caught it.
_adr_msg="$(
  echo ""
  echo "📊 POST-AGENT GIT STATE (agent-claim drift mechanical check):"
  echo "   staged: $staged · dirty: $dirty · untracked: $untracked"
  git diff --stat HEAD 2>/dev/null | tail -8 || true
  if [[ "${untracked:-0}" -gt 0 ]]; then
    echo "   Untracked files:"
    git ls-files --others --exclude-standard 2>/dev/null | head -10 | sed "s|^|     |"
  fi
  echo ""
)"
warn_emit "$_adr_msg" || true

exit 0
