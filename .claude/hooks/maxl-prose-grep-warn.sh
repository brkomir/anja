#!/usr/bin/env bash
# PreToolUse(Bash) hook — WARN-MODE on the max-L# prose-grep trap.
#
# WHY (the action-form enforcement the lesson itself argues for): finding the
# max/next lesson number by prose-grepping the meta docs for a GENERIC `L[0-9]…`
# pattern matches PHANTOM citation tokens — L#s quoted INSIDE lesson bodies (a
# lesson's own examples; another lesson's number cited in its body) — so it reads off by HUNDREDS.
# The canonical SSOT is `node scripts/architecture-counts.mjs list` → the `maxL` field
# (header-only via `maxLFromText`, phantom-safe). The RESTRAINT "never prose-grep"
# (active-recall Hot-Tier row) has under-fired 7+ times incl. a CROSS-SESSION
# mis-numbering 2026-07-02 (a peer numbered new lessons off a phantom maximum, and
# they were later renumbered). The lesson's thesis: a restraint under-fires; only
# an ACTION-form gate that leaves an observable nudge fires — this is that gate.
#
# MODE: WARN-ONLY (exit 0). Never blocks. Promotion to block (exit 2) after the
# observation window confirms low FP → SC-2. Escape: SKIP_MAXL_GREP_WARN=1.
#
# FIRE = a grep/rg for a GENERIC L-number class (`L[0-9]` / `L\d`) TARGETING a meta
# doc (MEMORY.md / RULES.md / architecture.md / state.md / skills/meta), and NOT
# already using `architecture-counts`. A SPECIFIC lookup (a grep for one lesson number in literal
# digits) does NOT fire (no `L[0-9]` class); a generic L-grep over CODE does NOT fire
# (no meta-doc target) — both keep FP low.
#
# Smoke-tested in scripts/smoke-test-hooks.sh (FIRE + 4 SAFE).

set -u

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

[[ "${SKIP_MAXL_GREP_WARN:-0}" == "1" ]] && exit 0  # =1 only — a stray =0/=no must NOT bypass

input=$(cat 2>/dev/null || echo "{}")
if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  cmd=$(echo "$input" | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//')
fi
[ -z "$cmd" ] && exit 0

# (1) a grep-family invocation
echo "$cmd" | grep -qE '(^|[|; ])(grep|egrep|rg)([[:space:]]|$)' || exit 0
# (2) a GENERIC L-number CLASS (not a literal L###) — the max-hunt tell
{ printf '%s' "$cmd" | grep -qF 'L[0-9]' || printf '%s' "$cmd" | grep -qF 'L\d'; } || exit 0
# (3) targeting a meta doc that carries phantom L# citation tokens
echo "$cmd" | grep -qE 'MEMORY\.md|RULES\.md|architecture\.md|state\.md|skills/meta' || exit 0
# (4) not already using the canonical SSOT
printf '%s' "$cmd" | grep -qF 'architecture-counts' && exit 0

# Fire-log (calibration for the eventual block promotion). Guarded so the smoke
# suite can exercise FIRE without polluting the real log.
if [ -z "${MAXL_GREP_NO_LOG:-}" ]; then
  LOG_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.claude/logs"
  mkdir -p "$LOG_DIR" 2>/dev/null || true
  TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "?")
  printf '{"ts":"%s"}\n' "$TS" >> "$LOG_DIR/maxl-grep-warn-fires.jsonl" 2>/dev/null || true
fi

warn_emit < <({
  echo ""
  echo "⚠️  MAX-L# PROSE-GREP (warn) — grepping a meta doc for a generic \`L[0-9]…\` pattern to find the max/next lesson number matches PHANTOM citation tokens (L#s quoted INSIDE lesson bodies — a lesson's own examples, or another lesson's number cited in its body). It reads off by HUNDREDS."
  echo "   Use the SSOT instead:  node scripts/architecture-counts.mjs list  → the \`maxL\` field (header-only, phantom-safe)."
  echo "   (7+ occurrences incl. a cross-session mis-numbering 2026-07-02. Escape: SKIP_MAXL_GREP_WARN=1.)"
  echo ""
}) || true
exit 0
