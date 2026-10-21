#!/usr/bin/env bash
# limit-recovery-check.sh — UserPromptSubmit, warn-mode, read-only.
#
# Names the sub-agents of THIS session that died at an API usage limit (or the auth error a limit
# hit cascades into) and have no recorded recovery, so the seat runs /limit-recovery instead of
# reporting their work as done or resuming one the scan says FRESH (a model change, a context that no longer fits, a
# failed resume, or a Fable agent at Fable's own limit) or WAIT before the reset (its own model, any but Fable, at its limit)
# (the procedure: a death at a limit is detected automatically, and on the resume the work is picked up where
# it left off). NEW class: dead-at-limit sub-agents go
# unnoticed across the limit reset — in the founding run four readers died within five minutes and the seat
# learned it only from the task notifications, which a compaction then dropped.
#
# Detection + decision live in scripts/limit-recovery.py (`scan --hook`): the last assistant record
# of a sub-agent transcript carries isApiErrorMessage with no SubagentHandback tool_use anywhere,
# and the id is not in .claude/state/limit-recovery-<sid8>.json. Emits ONE hookSpecificOutput
# document when something is unrecovered, nothing otherwise; a resume self-clears (new records
# after the error), a fresh seat or a deliberate drop is recorded by `mark`. Exit 0 always — a
# crash here prints nothing, which is the SAFE reading (nothing to recover), never a block.
# Escape: SKIP_LIMIT_RECOVERY_CHECK=1.
set -u
[ "${SKIP_LIMIT_RECOVERY_CHECK:-}" = "1" ] && exit 0
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
[ -f "$ROOT/scripts/limit-recovery.py" ] || exit 0
python3 "$ROOT/scripts/limit-recovery.py" scan --hook 2>/dev/null
exit 0
