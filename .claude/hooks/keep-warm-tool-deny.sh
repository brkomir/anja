#!/usr/bin/env bash
# PreToolUse (all tools) — deny every MAIN-SESSION tool call on a keep-warm ping turn (2026-10-06).
#
# WHY: a keep-alive turn exists only to read the cached prefix. Keep-warm needs a hard stop
# on tools: a ping that runs tools spends real usage
# and can act on directives injected that turn while the owner is away.
#
# HOW: keep-warm-gate.py writes .claude/state/keep-warm-turn-<sid8> when it PASSES a ping and removes it
# on the next prompt of any kind. While the marker exists (and is under 30 minutes old) every tool call
# from the main session is denied. A SUB-AGENT's call carries "agent_id" in its payload and is never
# denied: a background agent of this session must keep working through a ping.
#
# COST: this runs on every tool call fleet-wide, so the common path is one file test and exit — no jq,
# no python. Fail-open everywhere: no marker, no session id, a stale marker -> allow.
set -u
[[ "${SKIP_KEEP_WARM:-0}" == "1" ]] && exit 0
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
state_dir="${FF_STATE_DIR:-$ROOT/.claude/state}"
# Cheapest exit first: no turn marker for ANY session -> nothing to decide.
compgen -G "$state_dir/keep-warm-turn-*" >/dev/null 2>&1 || exit 0

INPUT="$(cat 2>/dev/null || true)"
# Top-level keys only: the harness writes session_id and agent_id BEFORE tool_input (2.1.292 `Ad`), so a key
# of the same name inside a tool's arguments must not decide (an "agent_id" there used to lift the block).
TOP="${INPUT%%\"tool_input\"*}"
field() { printf '%s' "$TOP" | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*"\([^"]*\)"$/\1/'; }
[ -n "$(field agent_id)" ] && exit 0
SID=$(field session_id)
[[ "$SID" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 0
SID8=$(printf '%s' "$SID" | tr '[:upper:]' '[:lower:]' | cut -c1-8)
marker="$state_dir/keep-warm-turn-$SID8"
[ -f "$marker" ] || exit 0
since=$(head -c 32 "$marker" 2>/dev/null | tr -dc '0-9')
# Only an epoch the gate wrote can deny. Empty, non-numeric, zero-led ("0800" is a bash octal error) or overflowing
# content used to skip the TTL and deny with no end; it reads as stale now, as the header promises.
[[ "$since" =~ ^[1-9][0-9]{8,10}$ ]] || exit 0
now=$(date +%s)
# 30 minutes, not 10: since a ping may carry the session over the
# compact point, the compaction runs inside the ping turn, and one in 2,759 measured compactions ran over 10 minutes
# (max 13.6); a marker aged out mid-compaction would let that turn act on the recovery directives with the owner away.
[ $(( now - since )) -gt 1800 ] && exit 0
# A stamp in the future (clock stepped back, a leaked KEEP_WARM_NOW) would deny with no end: read it as stale.
[ $(( since - now )) -gt 120 ] && exit 0
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' \
  "keep-warm ping turn: no tool calls. Reply with exactly [keep-warm] and end the turn. If this turn is NOT a [keep-warm] ping (an owner request, an agent result), the turn marker is stale: say that in one line instead; the next owner message clears it, or remove .claude/state/keep-warm-turn-$SID8."
exit 0
