#!/usr/bin/env bash
# UserPromptSubmit — inject the working-plan directive INTO THE AGENT'S OWN CONTEXT every
# turn until <repo-root>/plans/session-<sid8>-*.md exists, then self-silence. Sibling of
# mail-listen-arm-reminder.sh; the self-clear key is the plan file's own existence, so no
# PostToolUse marker hook is needed.
#
# WHY this exists: the working plan uses the same mechanism as the mail listener — it is created
# automatically on the session's first message. After the first-durable-write deviation failed
# its first live test, that became a codified rule: created automatically on the first message
# in the session. The SessionStart directive alone is ONE echo line in a ~46KB blob the terminal
# folds to "+N lines" (possession != application). The listener directive is reliable
# because of THIS shape — a per-turn additionalContext nag — and an earlier attempt copied the
# directive half of the listener mechanism without the nag half. The rule itself carries the
# placement, not data: the only post-directive datum is the one live
# miss that ordered this hook. Do NOT cite a coverage percentage here — the ~3% once quoted
# divided by transcripts that predate the directive and cannot support the decision.
#
# The mechanism is nag-until-the-AGENT-writes-it, never a hook-scaffolded stub: the plan needs
# the session's judgement about what to write, and an empty skeleton is content-free (the one
# part of the earlier attempt's reasoning that survives — its ~167-empty-files argument assumed a
# hook-written stub). TRADE, recorded on purpose: the self-clear key is a
# FILENAME, so a bare `touch` silences it, which contradicts the content-free rationale. Left
# as-is — it is the only in-session escape, and a content-aware key would strictly worsen the
# blast radius of a wrong nag.
#
# ESCAPE for a genuine one-shot / non-interactive run: SKIP_WORKING_PLAN_REMINDER=1 set in the
# LAUNCH environment (or settings.json's env block, applied at launch). A session-level export
# never reaches a harness-spawned hook, and UserPromptSubmit has no command line to prefix — so
# the model-facing text below deliberately does NOT tell the model to export it (the first cut
# of this hook did).
#
# PROJECT ROOT: session-start.sh:9's ladder. CLAUDE_PROJECT_DIR is UNSET in live sessions
# (measured), so the fallback rung IS the live path, and a bare $(pwd) there
# re-opens the shadow-tree trap: a seat whose cwd is a subdirectory searches the wrong plans/,
# nags forever, and a compliant agent then mints a shadow plans/ under that cwd — a silent
# success nobody reads. Both channels name the directory searched so that state is
# self-diagnosable in one turn.
#
# NON-BLOCKING (exit 0): injects context, never erases the user's prompt. Fixed ~1.2 KB payload,
# far under the 10,000-char additionalContext cap. Exactly ONE JSON document on stdout — the
# harness discards a multi-document stdout wholesale (bash-environment.md). The smoke arms
# assert the PARSE, never a substring.
# Stdin JSON shape: { prompt, session_id, ... }.  Key = session_id.lower()[:8].
set -u

[[ "${SKIP_WORKING_PLAN_REMINDER:-0}" == "1" ]] && exit 0  # =1 only — a stray =0/=no must NOT bypass

INPUT="$(cat 2>/dev/null || true)"
# A keep-warm ping turn (prompt starts '[keep-warm]', .claude/hooks/keep-warm-gate.py) is a harness timer,
# not the owner: inject nothing, so the ping stays one cheap read.
printf '%s' "$INPUT" | grep -qE '"prompt"[[:space:]]*:[[:space:]]*"[[:space:]]*\[keep-warm\]' && exit 0

if command -v jq >/dev/null 2>&1; then
  SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
else
  SID=$(printf '%s' "$INPUT" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
fi

# No session id -> no file name to check; stay silent (avoid an un-clearable every-turn nag).
[ -z "$SID" ] && exit 0
SID8=$(printf '%s' "$SID" | tr '[:upper:]' '[:lower:]' | cut -c1-8)

DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

# Plan file exists for this session (any date suffix) -> silent (no stdout, no stderr).
# Under bash an unmatched glob is passed literally, so ls fails and the nag fires.
if ls "$DIR"/plans/session-"${SID8}"-*.md >/dev/null 2>&1; then
  exit 0
fi

TODAY=$(date +%Y-%m-%d)

# Human-visible nag (stderr; transcript only — NOT the load-bearing path). Names the directory
# searched, so a wrong-root state reads as "wrong root", never as "no plan".
echo "📋 WORKING PLAN NOT CREATED — no ${DIR}/plans/session-${SID8}-*.md; injecting the directive into the agent's context (self-clears the instant that file exists)." >&2

# Model-visible directive (stdout JSON additionalContext) — THE load-bearing path.
# QUOTED heredoc: the prose is LITERAL, so a dollar, backtick or apostrophe in it can neither
# expand nor substitute (measured on the unquoted form: a dollar-19 gave ZERO bytes at exit 0,
# silent total loss; a backtick silently deleted a filename with valid JSON). The three
# placeholders land via bash pattern substitution, whose replacement is literal — no sed/awk
# ampersand or delimiter hazard. A double quote in the prose STILL breaks the JSON: the smoke
# parse arm guards that, and __DIR__ is JSON-escaped before substitution.
PAYLOAD=$(cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "📋 WORKING PLAN NOT CREATED — standing directive, not yet done this session. Every interactive session opens its working-plan file on the FIRST message (same mechanism as mail-listen). Searched __DIR__/plans/ for session-__SID8__-*.md and found none — if that directory is not the repo root, the hook resolved the wrong root: say so, and do not create a plans/ tree there. ACT NOW, before continuing the user's task: write plans/session-__SID8__-__TODAY__.md at the repo root — the arc in a few lines, the live item table (Item / Status / one-liner), the REVIEW LEDGER (REVIEWED / PENDING / NOT SENT per work unit), and the closability block; no number an instrument can derive — write the command instead. Update it AT every state change, including events you did not author (a verdict arriving, a peer commit, an owner ruling); corrections REPLACE the text they correct. This directive re-injects every turn and self-clears the instant the file exists. It is silenced only for a genuine one-shot / non-interactive run, by SKIP_WORKING_PLAN_REMINDER=1 in the LAUNCH environment — if you are reading this it was not set, and nothing exported from inside the session can reach a harness-spawned hook."
  }
}
JSON
)
DIR_JSON=$(printf '%s' "$DIR" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
PAYLOAD=${PAYLOAD//__SID8__/$SID8}
PAYLOAD=${PAYLOAD//__TODAY__/$TODAY}
PAYLOAD=${PAYLOAD//__DIR__/$DIR_JSON}
printf '%s\n' "$PAYLOAD"

exit 0
