#!/usr/bin/env bash
# UserPromptSubmit — inject the `/keep-warm on` directive INTO THE AGENT'S OWN CONTEXT
# every turn until this session has armed its keep-warm timer, then self-silence.
#
# WHY: keep-warm (on by default) shipped with ONE SessionStart
# line (session-start.sh) as its only arm directive. Its two siblings in that blob —
# the mail listener and the working plan — each have an every-turn reminder, and the
# one without a reminder is the one that got missed: one session (2026-10-18)
# did the other two on turn 1, never armed keep-warm, and the cache went cold over a
# multi-hour gap. This is the mail-listen-arm-reminder.sh mechanism
# applied to the third directive.
#
# Silent when: SKIP_KEEP_WARM_ARM_REMINDER=1 (launch env) · the prompt is a keep-warm
# ping · no session id · an armed marker under 7 days old exists (keep-warm-armed-marker.sh writes it
# on the timer's CronCreate; the skill's already-armed path touches it too) · the seat
# is on /standby · /keep-warm off holds · neither the fleet switch nor this session's
# pilot marker exists · the gate and tool-deny hooks are not both wired (the same
# condition session-start.sh gates its directive on: a timer without its gate turns
# every fire into a full paid turn, so never direct one).
# The armed marker is cleared by session-start.sh on a startup/resume (a startup has no timer;
# a resume may restore an unexpired one, which the skill's step 3 re-touches) and by session-end.sh.
#
# NON-BLOCKING (exit 0): injects context via stdout JSON additionalContext — the
# model-visible path (bare stderr does not reach the model on UserPromptSubmit).
# Prevents: the missed-arm gap (possession != application), keep-warm leg.
set -u

[[ "${SKIP_KEEP_WARM_ARM_REMINDER:-0}" == "1" ]] && exit 0  # =1 only — a stray =0/=no must NOT bypass
# An unattended run (claude -p, the SDK: CLAUDE_CODE_SESSION_ATTENDED=0) never arms keep-warm (session-start.sh's
# UNATTENDED block, 2026-10-28): a headless process with a recurring timer has nothing to keep warm for.
[[ "${CLAUDE_CODE_SESSION_ATTENDED:-}" == "0" && "${CLAUDE_CODE_SESSION_KIND:-}" != "bg" ]] && exit 0  # a bg (daemon) session keeps arming: session-start.sh

INPUT="$(cat 2>/dev/null || true)"
# A keep-warm ping turn is a harness timer, not the owner: inject nothing.
# The gate lstrips before matching its SENTINEL, so leading whitespace (JSON-escaped as \n \r \t) is still a ping.
printf '%s' "$INPUT" | grep -qE '"prompt"[[:space:]]*:[[:space:]]*"([[:space:]]|\\[nrt])*\[keep-warm\]' && exit 0

if command -v jq >/dev/null 2>&1; then
  SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
else
  SID=$(printf '%s' "$INPUT" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
fi
[ -z "$SID" ] && exit 0
SID8=$(printf '%s' "$SID" | tr '[:upper:]' '[:lower:]' | cut -c1-8)

DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
STATE="${FF_STATE_DIR:-$DIR/.claude/state}"

# Cheap file tests first; python starts only when a reminder might be owed.
MARKER="$STATE/keep-warm-armed-${SID8}"
# A recurring CronCreate job auto-expires 7 days after creation (Claude Code docs, "Scheduled tasks" →
# "Seven-day expiry"). The marker is written at or after the job's creation, so a marker older than 7 days
# (10080 min) names an expired timer: treat it as absent. One-sided: a job restored on resume and re-touched
# by the skill's step 3 is older than its marker, and that case still reads armed until the marker ages out.
[ -n "$(find "$MARKER" -mmin -10080 2>/dev/null)" ] && exit 0
[ -f "$STATE/session-standby-${SID8}" ] && exit 0
[ -f "$STATE/keep-warm-off-${SID8}" ] && exit 0
{ [ -f "$STATE/keep-warm-enabled" ] || [ -f "$STATE/keep-warm-pilot-${SID8}" ]; } || exit 0
[ -f "$DIR/.claude/skills/keep-warm/SKILL.md" ] || exit 0

# WIRED = the gate under UserPromptSubmit AND the tool block under an all-tools PreToolUse
# matcher — the predicate session-start.sh's _kw_wired uses, so the two never disagree.
python3 - "$DIR/.claude/settings.json" <<'PY' 2>/dev/null || exit 0
import json, sys
try:
    h = json.load(open(sys.argv[1])).get('hooks') or {}
    def has(ev, name, all_tools=False):
        return any(name in str(x.get('command') or '') for b in (h.get(ev) or [])
                   if not all_tools or (b.get('matcher') or '') in ('', '*', '.*') for x in (b.get('hooks') or []))
    sys.exit(0 if has('UserPromptSubmit', 'keep-warm-gate.py') and has('PreToolUse', 'keep-warm-tool-deny.sh', True) else 1)
except Exception:
    sys.exit(1)
PY

echo "🔥 KEEP-WARM NOT ARMED — injecting the arm directive into the agent's context (self-clears once the timer's CronCreate lands)." >&2

# The marker path is interpolated: an agent that follows the summary below instead of the skill must still be
# told the one step that silences this hook when a timer already exists (a CronList that finds the job writes
# nothing by itself). The text holds no double quote or backslash, so it is JSON-safe as printed.
CTX=$(cat <<'TXT'
🔥 KEEP-WARM NOT ARMED — standing directive, not yet done this session. The SessionStart directive (keep-warm is on by default) says to run `/keep-warm on` on the first turn, and this session has not recorded an armed timer. ACT NOW, alongside the user's task and in the same turn: invoke the keep-warm skill with `on` — CronList; if a job's prompt already starts '[keep-warm]' the timer is armed, so run `touch @MARKER@` (that file is what silences this reminder, and a CronList on its own writes nothing); only if no such job is listed, CronCreate recurring '7,22,37,52 * * * *' with the exact prompt in .claude/skills/keep-warm/SKILL.md. Without it the prompt cache goes cold whenever the owner steps away for more than an hour, and the next message from the owner pays a full re-cache. This reminder re-injects every turn until that marker exists. Skip only if the owner said /keep-warm off, or in a one-shot / non-interactive run.
TXT
)
CTX="${CTX//@MARKER@/$MARKER}"
printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "UserPromptSubmit",\n    "additionalContext": "%s"\n  }\n}\n' "$CTX"
exit 0
