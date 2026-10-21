#!/usr/bin/env bash
# commit-review-warn.sh — PostToolUse Bash hook.
#
# After a `git commit` that touches src/, remind the orchestrator to get a
# `--code` review of the UNPUSHED commits (delegate to the review hub, or run it)
# BEFORE reporting "done" / discussing a push.
#
# Why this hook exists separately from the PreToolUse delegate-code-review-warn.sh:
# that sibling catches "running --code INLINE instead of delegating to a peer." This
# one catches the DIFFERENT, more common miss — forgetting to review AT ALL before
# close/push. That miss leaves NO tool-call to gate (no Agent dispatch fires), so
# only a COMMIT-time trigger can catch it; it fires regardless of attention.
#
# Evidence: the miss recurred 3× in ONE session (2026-06-28) despite an always-loaded
# active-recall row — a passive trigger wasn't enough; this is the enforce layer.
#
# Warn-mode (NEW hook; warn first, promote to block after a clean window).
# Per-invocation escape: SKIP_COMMIT_REVIEW_WARN=1.
# Smoke-test injection: COMMIT_REVIEW_WARN_TEST_SRC=1 forces the git-state probes to
# PASS (real HEAD/unpushed state varies per run — see smoke-test-hooks.sh).

set -euo pipefail

# This advisory is aimed at the ORCHESTRATOR ("before reporting done, get a --code review"),
# so it must reach the MODEL. Measured 2026-08-25 in a throwaway rig: on PostToolUse a bare
# stderr advisory delivers ZERO text to the model, while hookSpecificOutput.additionalContext
# is quoted back verbatim. Fallback FIRST and errexit suspended across the source: `.` is a
# POSIX special builtin, so under `set -e` a failed source is FATAL and `|| true` cannot
# rescue it — and this file runs `set -euo pipefail`, so that is live, not hypothetical.
# ⛔ WARN_EMIT_EVENT IS REQUIRED HERE. The lib defaults to PreToolUse — correct for its first
# eleven callers and WRONG for this one. Measured on the first conversion: without it the
# payload announced hookEventName "PreToolUse" from a PostToolUse hook, which the harness
# would reject or misroute, and the advisory would vanish exactly as it did on stderr.
WARN_EMIT_EVENT=PostToolUse
# ⛔ HANDLES BOTH CALL SHAPES, and that is not tidiness. A bash function does NOT forward its
# arguments to a command in its body, so the old `warn_emit() { cat >&2; }` ran `cat` with NO
# args on an ARGUMENT call — reading stdin instead. Measured: advisory LOST at stdin EOF,
# HANGS with stdin open. The fallback exists for the case where the lib does not resolve, and
# in that exact case an argument-form caller emitted nothing at all.
warn_emit() { if [ "$#" -gt 0 ]; then printf '%s\n' "$*" >&2; else cat >&2; fi; }
case $- in *e*) _WE_HAD_E=1 ;; *) _WE_HAD_E=0 ;; esac
set +e
. "$(dirname "${BASH_SOURCE[0]}")/lib/warn-emit.sh" 2>/dev/null
[ "$_WE_HAD_E" = 1 ] && set -e
unset _WE_HAD_E

[[ "${SKIP_COMMIT_REVIEW_WARN:-0}" == "1" ]] && exit 0

PAYLOAD="$(cat)"

if command -v jq >/dev/null 2>&1; then
  CMD="$(echo "$PAYLOAD" | jq -r '.tool_input.command // ""')"
else
  CMD="$(echo "$PAYLOAD" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("command",""))' 2>/dev/null || echo "")"
fi

# Only after a git commit (not --amend — it re-touches an already-handled commit).
# 2026-09-23: anchored to a COMMAND position. The bare `git[[:space:]]+commit` matched the
# words "git commit -o" inside a mail-send heredoc BODY and fired "This commit touched src/"
# after a mail, reading HEAD (= whoever committed last on the shared branch). It was
# reproduced on a read-only grep of this file.
# A command position is also a keyword/wrapper word (then/else/do/if/xargs/time/command/env), a
# `{`/`!` opener, or VAR=val prefixes; `commit-tree` counts — the private-index route's commit-tree +
# update-ref moves HEAD like `git commit`, and the pre-anchor regex caught it.
_CRW_RE=$'(^|[;&|({!\n]|(^|[[:space:];&|(])(then|else|do|if|xargs|time|command|env)[[:space:]])[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*git[[:space:]]+commit(-tree)?([[:space:]]|$)'
[[ "$CMD" =~ $_CRW_RE ]] || exit 0
# A heredoc BODY line that BEGINS `git commit` (a mail body, a python payload) sits at a line start, so the
# anchor above matches it. Re-test with non-shell heredoc and quoted payloads stripped, using the same helper
# commit-doctrine-inject.sh uses. An executing-shell heredoc (`bash <<EOF`)
# is NOT stripped, so a real commit inside one still fires. Any helper failure keeps the unstripped command:
# fail toward firing, never toward a silent miss.
_CRW_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
_CRW_OUT="$(printf '%s' "$CMD" | python3 -c '
import importlib.util, os, re, sys
spec = importlib.util.spec_from_file_location("scs", os.path.join(sys.argv[1], "scripts", "subagent-commit-scan.py"))
scs = importlib.util.module_from_spec(spec); spec.loader.exec_module(scs)
scs._HEREDOC = re.compile(scs.NON_SHELL + r"\b[^\n;&|]*?<<-?\s*[\x27\x22]?(\w+)[\x27\x22]?[^\n]*\n(.*?)^\1\b", re.S | re.M)
sys.stdout.write("CRW-OK\n" + scs.strip_non_shell_payloads(sys.stdin.read()))
' "$_CRW_ROOT" 2>/dev/null)"
case "$_CRW_OUT" in
  "CRW-OK"$'\n'*) [[ "${_CRW_OUT#CRW-OK$'\n'}" =~ $_CRW_RE ]] || exit 0 ;;
esac
[[ "$CMD" =~ --amend ]] && exit 0
# Run ledger: ONE row per commit run, clean included, so the clean window has a denominator.
_w1_fire() { local _r=$? _c="${BASH_COMMAND:-}"; case "$_c" in exit|exit[[:space:]]*) ;; *) [ "$_r" != 0 ] || { _r=abort; _w1_out=abort; } ;; esac; ( fires_log() { :; }; . "$(dirname "${BASH_SOURCE[0]}")/lib/fires-log.sh"; j() { printf '%s' "${PAYLOAD:-}" | jq -r ".$1 // \"\"" 2>/dev/null; }
  fires_log commit-review-warn sid "$(j session_id)" agent_id "$(j agent_id)" via "$(j hook_event_name)" outcome "${_w1_out:-clean}" rc "$_r" ) >/dev/null 2>&1 || true; [ "$_r" != abort ] || exit 1; }; trap _w1_fire EXIT

# Git-state probes — bypassed deterministically for the smoke test.
if [[ "${COMMIT_REVIEW_WARN_TEST_SRC:-0}" == "1" ]]; then
  HEAD_SRC=1
  UNPUSHED=1
else
  # Did the just-made commit touch a src/ file? Pure docs/test/meta commits don't
  # need a product --code review.
  HEAD_SRC="$(git diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null | grep -cE '^src/' || true)"
  # Only nag if there is actually an unpushed set to review.
  # SHARED BASELINE (branching policy): origin/dev once it
  # exists (the branch every session pushes), origin/main before the cutover. Resolved, never assumed.
  SHARED_BASELINE="origin/main"
  git rev-parse --verify --quiet 'origin/dev^{commit}' >/dev/null 2>&1 && SHARED_BASELINE="origin/dev"
  UNPUSHED="$(git log "${SHARED_BASELINE}..HEAD" --oneline 2>/dev/null | wc -l | tr -d ' ')"
fi

[[ "${HEAD_SRC:-0}" -gt 0 ]] || exit 0
[[ "${UNPUSHED:-0}" -gt 0 ]] || exit 0
_w1_out=found

warn_emit <<EOF || true
⚠️  [commit-review-warn] This commit touched src/ — ${UNPUSHED} unpushed commit(s) on ${SHARED_BASELINE:-origin/main}..HEAD.
   Before reporting "done" / discussing a push, get a --code review of the diff:
     • delegate to the hub: python3 scripts/session-manifest.py mail-send --to <hub-sid|all> ...
     • or run it yourself:   /expert-review --code ${SHARED_BASELINE:-origin/main}..HEAD
   (warn-only; escape: SKIP_COMMIT_REVIEW_WARN=1)
EOF
exit 0
