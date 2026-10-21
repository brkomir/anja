#!/usr/bin/env bash
# commit-pathspec-warn.sh — PreToolUse Bash hook.
#
# Detects `git commit` invocations that lack a pathspec / --only / -o flag and
# warns when the index has 2+ files staged. Without a pathspec, `git commit`
# absorbs everything in the shared index — including files staged by a
# concurrent parallel session.
#
# Evidence: three back-to-back commits
# absorbed parallel-session staging in one session. Explicit-stage
# discipline alone is insufficient because the absorption fires at COMMIT time,
# not at STAGE time — the pre-stage check covers staging but not commit.
#
# Warn-mode (this is a NEW hook; warn first, promote to block-mode
# after 5 fires (`outcome:"found"` rows) + 0 false positives read from `commit-pathspec-warn-fires.jsonl`;
# its `outcome:"clean"` rows are runs that did NOT fire, the denominator, never "clean fires").
# 2026-08-26: Safer-forms advice REPLACED — the -o/--only/pathspec prescriptions took foreign CONTENT
# (a pathspec re-reads the worktree; active-recall.md commit row). scripts/safe-commit.sh is the control.
# Per-invocation escape: SKIP_COMMIT_PATHSPEC_WARN=1.

set -euo pipefail

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
# BECOMES A FLEET LOCKOUT. (The failure mode is real:
# `bash: _WE_HAD_E: unbound variable`.)
case $- in *e*) _WE_HAD_E=1 ;; *) _WE_HAD_E=0 ;; esac
set +e
. "$(dirname "${BASH_SOURCE[0]}")/lib/warn-emit.sh" 2>/dev/null
# Returns rc=1 when the flag is 0 — harmless ONLY because a normal statement always
# follows and discards the status, and because errexit is off in exactly the hooks where
# it returns 1. ⚠️ It must never become the LAST line of a file.
[ "$_WE_HAD_E" = 1 ] && set -e
unset _WE_HAD_E

[[ "${SKIP_COMMIT_PATHSPEC_WARN:-0}" == "1" ]] && exit 0

PAYLOAD="$(cat)"

# Extract the Bash command. Prefer jq when available; fall back to python3.
if command -v jq >/dev/null 2>&1; then
  CMD="$(echo "$PAYLOAD" | jq -r '.tool_input.command // ""')"
else
  CMD="$(echo "$PAYLOAD" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("command",""))' 2>/dev/null || echo "")"
fi

# Skip if not a git commit invocation
[[ "$CMD" =~ git[[:space:]]+commit ]] || exit 0
# Run ledger: ONE row per commit run, clean included, so the bar above has a denominator.
_w1_lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)/lib/fires-log.sh" || true; _w1_fire() { local _r=$? _c="${BASH_COMMAND:-}"; case "$_c" in exit|exit[[:space:]]*) ;; *) [ "$_r" != 0 ] || { _r=abort; _w1_out=abort; } ;; esac; ( fires_log() { :; }; . "${_w1_lib:-}"; j() { printf '%s' "${PAYLOAD:-}" | jq -r ".$1 // \"\"" 2>/dev/null; }
  fires_log commit-pathspec-warn sid "$(j session_id)" agent_id "$(j agent_id)" via "$(j hook_event_name)" outcome "${_w1_out:-clean}" rc "$_r" ) >/dev/null 2>&1 || true; [ "$_r" != abort ] || exit 1; }; trap _w1_fire EXIT

# Skip --amend (different semantic — amends prior commit; doesn't reabsorb)
[[ "$CMD" =~ --amend ]] && exit 0

# Skip if --only flag is already present (full form)
[[ "$CMD" =~ --only ]] && exit 0

# Skip if -o flag present (shortform of --only). Whole-token match to avoid
# false-match on flags like --no-something or -opts.
if echo "$CMD" | grep -qE '(^|[[:space:]])-o([[:space:]]|"|$)'; then
  exit 0
fi

# Skip if explicit pathspec separator -- is present
if echo "$CMD" | grep -qE '[[:space:]]--[[:space:]]'; then
  exit 0
fi

# Count staged files. If fewer than 2, the absorption risk is small enough to
# skip the warning (single-file commits are typically safe even with parallel
# staging — the parallel session's files just stay staged for their commit).
#
# COMMIT_PATHSPEC_WARN_FAKE_STAGED_COUNT — TEST-ONLY env var used by
# scripts/smoke-test-hooks.sh to inject a deterministic staged count, since
# the real index state varies per CI run. Production code path never sets it.
if [[ -n "${COMMIT_PATHSPEC_WARN_FAKE_STAGED_COUNT:-}" ]]; then
  STAGED_COUNT="$COMMIT_PATHSPEC_WARN_FAKE_STAGED_COUNT"
else
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
  cd "$REPO_ROOT"
  STAGED_COUNT="$(git diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')"
fi

[[ "$STAGED_COUNT" -lt 2 ]] && exit 0
_w1_out=found

# Emit warning to stderr (visible to orchestrator + user)
warn_emit <<EOF || true

⚠️  commit-pathspec-warn: 'git commit' without --only / -o / pathspec
    will absorb all ${STAGED_COUNT} files currently staged — including any
    staged by a concurrent parallel session.

    Safer path (the SHIPPED control - do not hand-roll a gate):
      bash scripts/safe-commit.sh --add <N> --del <M> -m "msg" -- <path1> <path2> ...
    It verifies the staged set against your declared paths in the same process as
    the commit. Do NOT reach for -o / --only / "-- <path>" instead: a pathspec
    RE-READS THE WORKTREE for each declared path, so it takes a peer uncommitted
    CONTENT even where it fixes the foreign-PATHS axis (active-recall.md commit row;
    from a hand-staged index -o is the worst shape available). If
    safe-commit REFUSES at GATE 1 on undeclared staged paths, you are in the
    foreign-PATHS state: gate both numstat columns by hand, commit by a means
    that preserves your index content, and disclose the ride-along in the body.

    If you've verified the staged set is yours alone (no parallel-session
    activity), this warning is informational. Disable per-invocation:
      SKIP_COMMIT_PATHSPEC_WARN=1 git commit -m "msg"

    Companion lessons: no -A staging + pre-stage check +
    defensive posture for cross-session WIP. Collision-state verb table:
    bash-environment.md, WHICH COLLISION YOU ARE IN DECIDES THE COMMIT VERB.

EOF

# Warn-mode: commit proceeds. Promote to exit 1 (block-mode) after 5 fires
# (`outcome:"found"` rows) + 0 false positives read from `commit-pathspec-warn-fires.jsonl`.
exit 0
