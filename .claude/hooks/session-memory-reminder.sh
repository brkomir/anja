#!/usr/bin/env bash
# Stop hook — remind to run /session-memory when session had substantial work.
#
# v2.8.0 top-priority adoption from vinicius91carvalho's published Claude setup (adapted
# signal-gated Stop pattern). Closes the regression class where
# /session-memory gets skipped on commit-heavy sessions.
#
# MODE: WARN-ONLY (exit 0), and NOT promotable as built. The pairing this line once waited for exists
# (the marker check below; 131 dated markers under .claude/state by 2026-10-09), but the predicate counts
# commits by the git identity every seat shares and reads a per-DAY fleet-wide marker, so it measures the
# fleet's day, not this session (150 such commits on 2026-10-09 when measured). A block here would refuse
# every seat's turn-end until any seat ran /session-memory. Prior-art panel 2026-10-09: REJECT.
# For v2.8.0, stateless heuristic: if git log shows ≥2 commits by current
# user today on current branch, warn. Simple, no state files needed.
#
# Known limitations (warn-mode acceptable):
#   - Fires on cosmetic commit-heavy sessions (false positive)
#   - Can't detect whether /session-memory actually ran
#   - No suppression once seen (intentional — reminder is cheap)
#
# Promotion path: once /session-memory skill writes
# `.claude/state/session-memory-done-<YYYYMMDD>` on each run, hook can
# check for marker absence + suppress after ack.

# ⛔ THIS ADVISORY STAYS ON BARE STDERR — DELIBERATE, MEASURED, DO NOT "FIX" IT.
# Every other warn-mode hook in this repo was converted to hookSpecificOutput.additionalContext
# because bare stderr delivers ZERO text to the model. Stop is the ONE event where that
# remedy is worse than the disease. Measured 2026-08-25 in a throwaway rig, two arms,
# only the emit channel varying:
#     Stop + additionalContext -> reaches the model, and the hook FIRED 9x against the
#                                 other arm 1, because Stop runs at turn END so anything
#                                 reaching the model there forces a CONTINUATION. The
#                                 model final answer became the canary; the task was lost.
#     Stop + bare stderr       -> does not reach the model, 1 fire.
# The DIRECTION is structural, not a sample: it follows from the event contract, so no
# further measurement can reverse it. Only the magnitude (9) is empirical.
set -u
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"  # hooks inherit the session cwd

today=$(date +%Y-%m-%d)
author=$(git config user.email 2>/dev/null || echo "")

if [[ -z "$author" ]]; then
  exit 0
fi

# v2.8.2 signal-gating — skip reminder if /session-memory already ran today.
# /session-memory skill writes `.claude/state/session-memory-done-<YYYYMMDD>` at
# completion; presence of marker means user already persisted decisions for today.
marker_file="$ROOT/.claude/state/session-memory-done-${today}"
if [[ -f "$marker_file" ]]; then
  exit 0
fi

# Count commits by current author today on current branch
commits_today=$(git log --since="$today 00:00:00" --author="$author" --oneline 2>/dev/null | wc -l | tr -d ' ')

if [[ -z "$commits_today" ]] || [[ "$commits_today" -lt 2 ]]; then
  exit 0
fi

echo "" >&2
echo "📝 SESSION REMINDER (session-memory-reminder.sh — WARN-ONLY, v2.8.2 signal-gated):" >&2
echo "   $commits_today commits today by $author on current branch." >&2
echo "   No .claude/state/session-memory-done-${today} marker found." >&2
echo "   If any decisions / product pivots / architectural choices worth persisting:" >&2
echo "     → run /session-memory before /wrap (captures product decisions + writes marker)" >&2
echo "     → run /meta learn before /wrap (captures process lessons)" >&2
echo "   Mode: warn-only. Marker-write suppresses subsequent fires today." >&2
echo "" >&2

exit 0
