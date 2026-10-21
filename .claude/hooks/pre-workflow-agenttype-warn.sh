#!/usr/bin/env bash
# pre-workflow-agenttype-warn.sh — PreToolUse Workflow hook.
#
# Warns when a Workflow script's agent() calls lack a lens-matched `agentType:`
# (or use agentType:'general-purpose') for project-domain work. A bare/generic
# workflow agent loads NO project skill/MEMORY — it re-derives domain knowledge
# from scratch and misses project invariants. The orchestrator must set
# agentType to a lens-matched expert per agent() call.
#
# Evidence chain: the always-loaded trigger-index
# rule failed at composition at the 2nd OCCURRENCE (occurrence-count from 1:
# the 2nd occurrence = 1 recurrence). Per the
# memory->rule->hook ladder, a deterministic hook fires regardless of whether the
# orchestrator scans the rule — which is exactly the observed failure mode (rule
# loaded into context, not applied at composition time). A stronger rule can't fix
# "didn't apply the loaded rule"; only a hook can.
#
# Warn-mode (NEW hook; warn first, promote to block-mode after 5 clean
# fires + 0 false positives read from `pre-workflow-agenttype-warn-fires.jsonl`).
# Per-invocation escape: SKIP_WORKFLOW_AGENTTYPE_WARN=1.
#
# NOTE: uses `set -eu` (NOT pipefail) — the `grep -oE ... | wc -l` count pipes
# legitimately produce exit 1 from grep on zero matches; pipefail would abort.

set -eu

# This warn must reach the MODEL, not only the terminal: a bare-stderr PreToolUse warn is
# invisible to it (measured twice — see lib/warn-emit.sh). The inline fallback keeps this
# hook behaving exactly as before if the lib is ever missing or unreadable.
# ⛔ FALLBACK FIRST, AND ERREXIT SUSPENDED ACROSS THE SOURCE — `.` is a POSIX SPECIAL
# BUILTIN, so under `set -e` a failed source is FATAL to the shell and `|| true` CANNOT
# rescue it. Measured 2026-08-24: a corrupt lib under `set -e` / `set -euo pipefail`
# exits **rc=2** — which is the PreToolUse BLOCK code — and a missing one exits rc=1;
# in both cases execution never reaches the next line. On a matcher=Bash hook that would
# DENY EVERY BASH CALL for every seat, with the SKIP_* escape unreachable because it sits
# below the fatal line. Defining the fallback first and suspending errexit only across the
# source makes a broken lib degrade to stderr-only instead of to a fleet-wide block.
# ⛔ HANDLES BOTH CALL SHAPES, and that is not tidiness. A bash function does NOT forward its
# arguments to a command in its body, so the old `warn_emit() { cat >&2; }` ran `cat` with NO
# args on an ARGUMENT call — reading stdin instead. Measured: advisory LOST at stdin EOF,
# HANGS with stdin open. The fallback exists for the case where the lib does not resolve, and
# in that exact case an argument-form caller emitted nothing at all.
warn_emit() { if [ "$#" -gt 0 ]; then printf '%s\n' "$*" >&2; else cat >&2; fi; }
# ⛔ BOTH arms of this `case` assign, and the `*)` arm is LOAD-BEARING IN SIX OF THE NINE
# hooks — the ones running `set -u` WITHOUT `-e`. It reads like defensive boilerplate and
# is exactly the kind of arm a tidier deletes. Delete it and the restore line below
# dereferences an UNSET variable, `set -u` kills the hook, and this fleet-lockout FIX
# BECOMES A FLEET LOCKOUT. (A re-review confirmed the failure mode is real:
# `bash: _WE_HAD_E: unbound variable`.)
case $- in *e*) _WE_HAD_E=1 ;; *) _WE_HAD_E=0 ;; esac
set +e
. "$(dirname "${BASH_SOURCE[0]}")/lib/warn-emit.sh" 2>/dev/null
# Returns rc=1 when the flag is 0 — harmless ONLY because a normal statement always
# follows and discards the status, and because errexit is off in exactly the hooks where
# it returns 1. ⚠️ It must never become the LAST line of a file.
[ "$_WE_HAD_E" = 1 ] && set -e
unset _WE_HAD_E

[[ "${SKIP_WORKFLOW_AGENTTYPE_WARN:-0}" == "1" ]] && exit 0

PAYLOAD="$(cat)"

# Extract the Workflow script body — inline `script`, else read `scriptPath` file.
if command -v jq >/dev/null 2>&1; then
  SCRIPT="$(echo "$PAYLOAD" | jq -r '.tool_input.script // ""')"
  SCRIPT_PATH="$(echo "$PAYLOAD" | jq -r '.tool_input.scriptPath // ""')"
else
  SCRIPT="$(echo "$PAYLOAD" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("tool_input",{}) or {}).get("script","") or "")' 2>/dev/null || echo "")"
  SCRIPT_PATH="$(echo "$PAYLOAD" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("tool_input",{}) or {}).get("scriptPath","") or "")' 2>/dev/null || echo "")"
fi

# If no inline script but a scriptPath is supplied, scan that file's contents.
if [[ -z "$SCRIPT" && -n "$SCRIPT_PATH" && -f "$SCRIPT_PATH" ]]; then
  SCRIPT="$(cat "$SCRIPT_PATH" 2>/dev/null || echo "")"
fi

# Nothing to scan
[[ -z "$SCRIPT" ]] && exit 0

# Count agent() spawn calls, agentType: declarations, and general-purpose uses.
# `{ grep || true; }` keeps a zero-match grep from aborting under set -e.
AGENT_CALLS="$( { printf '%s' "$SCRIPT" | grep -oE '\bagent\(' || true; } | wc -l | tr -d ' ')"
[[ "$AGENT_CALLS" -eq 0 ]] && exit 0
# Run ledger (2026-10-09): ONE row per in-scope run, clean included, so the bar above has a denominator.
_w1_fire() { local _r=$? _c="${BASH_COMMAND:-}"; case "$_c" in exit|exit[[:space:]]*) ;; *) [ "$_r" != 0 ] || { _r=abort; _w1_out=abort; } ;; esac; ( fires_log() { :; }; . "$(dirname "${BASH_SOURCE[0]}")/lib/fires-log.sh"; j() { printf '%s' "${PAYLOAD:-}" | jq -r ".$1 // \"\"" 2>/dev/null; }
  fires_log pre-workflow-agenttype-warn sid "$(j session_id)" agent_id "$(j agent_id)" via "$(j hook_event_name)" outcome "${_w1_out:-clean}" rc "$_r" ) >/dev/null 2>&1 || true; [ "$_r" != abort ] || exit 1; }; trap _w1_fire EXIT

AGENTTYPE_COUNT="$( { printf '%s' "$SCRIPT" | grep -oE 'agentType:' || true; } | wc -l | tr -d ' ')"
GENERIC_COUNT="$( { printf '%s' "$SCRIPT" | grep -oE "agentType:[[:space:]]*['\"]general-purpose['\"]" || true; } | wc -l | tr -d ' ')"

# Fire if any agent() lacks agentType, OR any agentType is general-purpose.
if [[ "$AGENTTYPE_COUNT" -lt "$AGENT_CALLS" || "$GENERIC_COUNT" -gt 0 ]]; then
  MISSING=$(( AGENT_CALLS - AGENTTYPE_COUNT ))
  [[ "$MISSING" -lt 0 ]] && MISSING=0
  _w1_out=found
warn_emit <<EOF || true

⚠️  pre-workflow-agenttype-warn: this Workflow script has agent() calls
    without a lens-matched agentType (or using 'general-purpose').
      agent() calls: ${AGENT_CALLS} | with agentType: ${AGENTTYPE_COUNT} | missing: ${MISSING} | general-purpose: ${GENERIC_COUNT}

    A bare/general-purpose workflow agent loads NO project skill/MEMORY — it
    re-derives domain knowledge from scratch and misses project invariants
    (side-effect ordering, idempotency rules, just-shipped flows, etc.).

    Run the 4-point checklist
    BEFORE launch: (1) does each agent() need domain knowledge? -> set agentType;
    (2) lens-match the expert to the task; (3) builder!=breaker across
    analyze/verify stages; (4) append a just-shipped-context primer string.

    If these agents genuinely need no project knowledge (pure file-reading over
    explicit paths you supply), this is informational. Disable per-invocation:
      SKIP_WORKFLOW_AGENTTYPE_WARN=1

    Evidence: occurrence N=2.

EOF
fi

# Warn-mode: the Workflow proceeds. Promote to exit 1 (block) after 5 clean
# fires + 0 false positives read from `pre-workflow-agenttype-warn-fires.jsonl`.
exit 0
