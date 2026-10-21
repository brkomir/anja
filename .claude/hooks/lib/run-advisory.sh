#!/usr/bin/env bash
# run-advisory.sh — run a WARN-ONLY hook so that it can never block a prompt, a tool call or a stop.
#
# Bash exits 2 on a syntax error, and 2 is the code Claude Code reads as "block". On 2026-10-18 a live,
# half-edited post-compact-pending-check.sh carried a syntax error from 22:51 to 22:54Z and refused 11 of
# the owner's prompts in two sessions, although its own header says it never blocks. A warn-only hook never
# means to exit 2, so this launcher turns its 2 into 1, a non-blocking error the harness shows to the owner
# with the hook's stderr, adds one stderr line naming the hook, and logs the event to
# .claude/logs/run-advisory-fires.jsonl (the hook's name, and arm syntax-error or exit-2). Every other exit
# code, and the hook's stdin, stdout and stderr, pass through untouched: stdout is never captured, so a
# hook's single JSON document reaches the harness exactly as it would without the launcher.
#
# A failing hook also gets a marker, .claude/state/run-advisory-failing-<hook>, written at its first failure
# and removed by its next run that does not exit 2 (a syntax-error marker only once the file parses again,
# since that run may simply have exited before the broken line). session-start.sh prints `run-advisory.sh --list` (one
# line per marker), so a broken hook is named at every session start until it is fixed — the screen alone is
# not enough, because Claude Code draws a Stop hook's non-blocking error nowhere.
# The marker is keyed by the hook's basename: a hook wired more than once (band-o-inject.sh, 3 commands) shares
# one, so a sibling command's clean run clears an exit-2 marker; a hook unwired after failing keeps its marker
# until it is deleted by hand.
#
# Wired in .claude/settings.json in front of every warn-only bash hook on UserPromptSubmit, PreToolUse and
# Stop. A hook that blocks on purpose (an `exit 2`, a deny or block
# decision) is never wired through this: for a guard, refusing while broken is the safe failure. Every
# warn-only hook runs through this file, so each wired command also ends in
# `|| { r=$?; [ $r -eq 2 ] && r=1; exit $r; }`: even a syntax error here reaches the harness as 1, never 2.
# A test pins the behaviour and the wiring.
#
# Usage: bash run-advisory.sh <hook path> [hook args...]   (the hook's payload arrives on stdin)
#        bash run-advisory.sh --list                        (each failing hook: "<hook> since <UTC> (<arm>)")
state="${RUN_ADVISORY_STATE_DIR:-${FF_STATE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)/state}}"
if [ "${1:-}" = "--list" ]; then
  for m in "$state"/run-advisory-failing-*; do
    [ -f "$m" ] || continue
    read -r since arm < "$m"
    printf '%s since %s (%s)\n' "${m##*/run-advisory-failing-}" "${since:-?}" "${arm:-?}"
  done
  exit 0
fi
hook="${1:-}"
[ -n "$hook" ] || exit 0
shift
marker="$state/run-advisory-failing-${hook##*/}"
bash "$hook" "$@"
rc=$?
if [ "$rc" -ne 2 ]; then
  # Bash parses as it runs, so a run that exits before a broken line returns 0 over a file that still fails
  # to parse (the 2026-10-18 hook: sessions with no pending marker exited before its broken block). A
  # syntax-error marker therefore clears only once the file parses again; any other marker on a clean run.
  if [ -f "$marker" ]; then
    read -r _since _arm 2>/dev/null < "$marker"
    { [ "${_arm:-}" != syntax-error ] || bash -n "$hook" 2>/dev/null; } && rm -f "$marker"
  fi
  exit "$rc"
fi
kind=exit-2
bash -n "$hook" 2>/dev/null || kind=syntax-error
printf 'run-advisory: %s exited 2 (%s); turned into 1 so a warn-only hook cannot block\n' "${hook##*/}" "$kind" >&2
[ -f "$marker" ] || printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$kind" 2>/dev/null > "$marker"
( fires_log() { :; }
  . "$(dirname "${BASH_SOURCE[0]}")/fires-log.sh"
  fires_log run-advisory hook "${hook##*/}" arm "$kind"
) >/dev/null 2>&1 || true
exit 1
