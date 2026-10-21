#!/usr/bin/env bash
# hooks-integrity-check.sh — SessionStart. The OUT-OF-PROCESS net for a stubbed hook.
#
# WHY THIS CANNOT BE A TRAP (and why the obvious answer is wrong):
#   A mutation harness (`scripts/smoke-mutation-matrix.sh`, `hook-liveness-prepass.sh`) writes a
#   stub over a hook, runs the suite, and restores it. It HAS a `trap restore_all EXIT INT TERM`.
#   THAT IS NOT ENOUGH. A trap lives INSIDE the mutating process, so it dies with the process:
#   SIGKILL bypasses it entirely, and — MEASURED 2026-07-13 — a harness run in the foreground of a
#   tool call that hits a 10-minute timeout ALSO died without restoring. `defer-loc-check.sh` was
#   left as a 3-line stub with 216 lines deleted. The hook was DISABLED ON DISK and nothing said so.
#
#   Any restore that lives in the dying process cannot be the guarantee. The detection must be
#   OUT-OF-PROCESS. This hook is that. (Shape proposed by a peer session, which caught a live
#   mutation leaking into its own context and correctly reasoned that a trap-based answer
#   structurally cannot reach SIGKILL.)
#
# WHY IT MATTERS MORE THAN IT LOOKS:
#   The 2026-07-13 incident was caught only BY ACCIDENT — the mutant's stdout leaked into a peer's
#   UserPromptSubmit context. A hook that fails SILENTLY when stubbed (most of them) would have
#   stayed disabled and invisible. The failure mode is invisible by construction, so you cannot
#   rely on the next one being loud. Another hook was stubbed in the same run.
#
# WHAT IT DOES: on every session boot, assert `.claude/hooks/` matches HEAD. HEAD always holds the
# real hooks, so a dirty hook is either (a) legitimate WIP, or (b) a corpse from a dead harness.
# It cannot tell them apart — so it REPORTS and hands the human the one-line restore. It never
# auto-reverts (that would destroy a peer's real WIP).
#
# Warn-only, exit 0 always. Escape: SKIP_HOOKS_INTEGRITY=1

set -uo pipefail
[ "${SKIP_HOOKS_INTEGRITY:-0}" = "1" ] && exit 0

REPO="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$REPO" 2>/dev/null || exit 0

DIRTY="$(git status --porcelain .claude/hooks/ 2>/dev/null)"
[ -z "$DIRTY" ] && exit 0

# A STUB is the dangerous shape: a hook gutted to a few lines, or carrying a mutation marker.
# Distinguish it from ordinary WIP, because they demand opposite responses.
#
# The needle is ASSEMBLED at runtime, never written contiguously. A detector that contains its own
# search string MATCHES ITSELF: the first cut hard-coded the literal, and the moment this file was
# dirty it grepped itself, found the word inside its own pattern, and reported ITSELF as a stub.
# Split the literal and the self-match is structurally impossible, not merely unlikely.
NEEDLE="MUTANT-""GARBAGE-OUTPUT"

STUBS=""
while IFS= read -r line; do
  f="$(printf '%s' "$line" | awk '{print $2}')"
  [ -f "$f" ] || continue
  n="$(wc -l < "$f" | tr -d ' ')"
  if grep -qF "$NEEDLE" "$f" 2>/dev/null || [ "${n:-99}" -lt 6 ]; then
    STUBS="${STUBS}${f} (${n} lines)\n"
  fi
done <<< "$DIRTY"

if [ -n "$STUBS" ]; then
  # STDOUT, deliberately — SessionStart stdout is INJECTED INTO CONTEXT (session-start.sh
  # uses the same channel for its briefing). The first cut wrote this alarm to stderr,
  # which on exit 0 reaches nobody — the exact "warn to stderr goes unheeded" failure
  # block-dangerous.sh:70-76 documents. An alarm the agent cannot see is not a net.
  # The benign-WIP branch below stays on stderr on purpose.
  {
    echo ""
    echo "🚨 HOOK LEFT STUBBED — A PROTECTION LAYER IS DISABLED ON DISK RIGHT NOW"
    printf "   %b" "$STUBS"
    echo "   A mutation harness died between mutate and restore (a trap cannot catch SIGKILL, and"
    echo "   a tool-timeout SIGTERM killed one on 2026-07-13 leaving defer-loc-check.sh gutted)."
    echo "   HEAD holds the real hook. Restore:  git checkout -- .claude/hooks/"
    echo ""
  }
else
  {
    echo "ℹ️  .claude/hooks/ has uncommitted changes (looks like real WIP, not a stub):"
    printf '%s\n' "$DIRTY" | sed 's/^/     /'
    echo "   If a mutation harness was interrupted, verify before trusting them."
  } >&2
fi
exit 0
