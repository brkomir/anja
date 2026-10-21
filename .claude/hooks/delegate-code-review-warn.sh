#!/usr/bin/env bash
# delegate-code-review-warn.sh — PreToolUse Agent hook.
#
# Warns when an Agent dispatch looks like a code-review (--code / builder≠breaker /
# "find what's wrong" / "review the diff|commit|fix") AND a peer session is live —
# i.e. a review HUB may be available to take it. The orchestrator should DELEGATE
# the --code to the peer via `mail-send` (then proceed
# to the next audit / flip / wrap, folding any P1 async BEFORE the owner-gated push)
# rather than serialize it inline.
#
# Evidence chain: the delegation was missed a second time after the rule was written
# down. The always-loaded feedback rule + the active-recall trigger row were BOTH in
# context and still did not fire at the dispatch moment (the possession≠application
# gap). A stronger rule
# can't fix "didn't apply the loaded rule"; only a hook that fires at the exact
# dispatch moment can — same memory->rule->hook ladder as pre-workflow-agenttype-warn.
#
# Warn-mode (NEW hook; warn first, promote to block-mode after 5 fires (`outcome:"found"`
# rows) + 0 false positives read from `delegate-code-review-warn-fires.jsonl`; its `outcome:"clean"`
# rows are runs that did NOT fire, the denominator, never "clean fires").
# Per-invocation escape: SKIP_DELEGATE_REVIEW_WARN=1.
#
# NOTE: `set -eu` (NOT pipefail) — a zero-match grep in the count pipe exits 1.

set -eu

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
# BECOMES A FLEET LOCKOUT. (The failure mode is confirmed real:
# `bash: _WE_HAD_E: unbound variable`.)
case $- in *e*) _WE_HAD_E=1 ;; *) _WE_HAD_E=0 ;; esac
set +e
. "$(dirname "${BASH_SOURCE[0]}")/lib/warn-emit.sh" 2>/dev/null
# Returns rc=1 when the flag is 0 — harmless ONLY because a normal statement always
# follows and discards the status, and because errexit is off in exactly the hooks where
# it returns 1. ⚠️ It must never become the LAST line of a file.
[ "$_WE_HAD_E" = 1 ] && set -e
unset _WE_HAD_E

[[ "${SKIP_DELEGATE_REVIEW_WARN:-0}" == "1" ]] && exit 0

PAYLOAD="$(cat)"

if command -v jq >/dev/null 2>&1; then
  PROMPT="$(echo "$PAYLOAD" | jq -r '.tool_input.prompt // ""')"
  SUBTYPE="$(echo "$PAYLOAD" | jq -r '.tool_input.subagent_type // ""')"
else
  PROMPT="$(echo "$PAYLOAD" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("tool_input",{}) or {}).get("prompt","") or "")' 2>/dev/null || echo "")"
  SUBTYPE="$(echo "$PAYLOAD" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("tool_input",{}) or {}).get("subagent_type","") or "")' 2>/dev/null || echo "")"
fi

# A `fork` re-uses THIS context — there is no fresh-eyes review value to delegate. Skip.
[[ "$SUBTYPE" == "fork" ]] && exit 0
[[ -z "$PROMPT" ]] && exit 0

# Fire only on a code-review-style dispatch.
echo "$PROMPT" | grep -qiE 'builder.{0,6}breaker|\bcode review\b|--code\b|find what.{0,4}s wrong|review (the |this )?(diff|commit|fix|change|pr\b)|adversarial' || exit 0
# Run ledger: ONE row per in-scope run, clean included, so the bar above has a denominator.
_w1_fire() { local _r=$? _c="${BASH_COMMAND:-}"; case "$_c" in exit|exit[[:space:]]*) ;; *) [ "$_r" != 0 ] || { _r=abort; _w1_out=abort; } ;; esac; ( fires_log() { :; }; . "$(dirname "${BASH_SOURCE[0]}")/lib/fires-log.sh"; j() { printf '%s' "${PAYLOAD:-}" | jq -r ".$1 // \"\"" 2>/dev/null; }
  fires_log delegate-code-review-warn sid "$(j session_id)" agent_id "$(j agent_id)" via "$(j hook_event_name)" outcome "${_w1_out:-clean}" rc "$_r" ) >/dev/null 2>&1 || true; [ "$_r" != abort ] || exit 1; }; trap _w1_fire EXIT

# Session id — hoisted above both the hub self-skip and the peer probe, which
# each need it.
if command -v jq >/dev/null 2>&1; then
  SID="$(echo "$PAYLOAD" | jq -r '.session_id // ""')"
else
  SID="$(echo "$PAYLOAD" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("session_id","") or "")' 2>/dev/null || echo "")"
fi

# ── HUB SELF-SKIP ────────────────────────────────────────────────────────────
# "Delegate the --code to the hub" has no referent when you ARE the hub. A hub
# dispatches a subagent breaker on EVERY commit it authors, so without this the
# hook fires on every one, advising the hub to delegate to itself. This shipped as a TODO
# comment for months while the behaviour it describes was never implemented.
#
# ⛔ KEYED ON `review-hub-active-<sid>`, NOT ON THE MAIL LISTENER'S PID FILE. The row
# that asked for this named both; the pid is wrong and would have been a silent
# fleet-wide regression — EVERY session arms a mail-listen, and this repo carries
# 114 such pids, so keying on it disables the hook for everyone.
#
# ⛔ A RETIRING HUB IS SILENT TOO — the `.retiring` carve-out an earlier version carried
# was REVERSED on review.
# My reasoning was "the nudge means this commit owes a breaker, and that survives the
# role." I characterised the advisory instead of reading it. It says, in its own words
# (see the emit block below): "DELEGATE the --code to the peer hub via 'mail-send'",
# with the commands. Delegate-to-a-peer-hub, not owes-a-breaker.
# And `review-hub/SKILL.md` step 1 of 7 stamps `.retiring` FIRST, before anything else —
# the successor does not appear until step 4, which may end in VACANCY-DECLARED. So for
# most of the marker's life there is nobody to delegate TO, and the spec names that exact
# cost: peers read "no hub", broadcast, get no ack because every peer is in that state,
# and each self-runs the same review. "One review, N panels."
# ⚠️ My "warn-mode makes a false fire cheap" argument was wrong the same way: a warn
# false-positive costs whatever its own nextAction says, and this one's nextAction is
# broadcast into a vacancy.
#
# DELEGATE_REVIEW_FAKE_HUB — smoke override. EXACTLY "1" means hub; ANY other non-empty
# value is a usage error and refuses, because the contract used to be "non-empty non-1
# fires", which made FAKE_HUB=0 fire.
if [[ -n "${DELEGATE_REVIEW_FAKE_HUB:-}" ]]; then
  case "${DELEGATE_REVIEW_FAKE_HUB}" in
    1) exit 0 ;;
    0) ;;
    *) echo "delegate-code-review-warn: DELEGATE_REVIEW_FAKE_HUB must be 0 or 1 (got '${DELEGATE_REVIEW_FAKE_HUB}')" >&2 ;;
  esac
elif [[ -n "$SID" ]]; then
  # ⛔ NOT --show-toplevel: inside a git worktree it returns the WORKTREE root, so the
  # marker path cannot exist and the skip fails OPEN. 27 of this box's 38 worktrees are
  # detached. --git-common-dir resolves to the SHARED repo's .git from any worktree.
  _ROOT="${CLAUDE_PROJECT_DIR:-$(dirname "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" 2>/dev/null || echo "$PWD")}"
  _HUB="${_ROOT}/.claude/state/review-hub-active-${SID%%-*}"
  [[ -f "$_HUB" ]] && exit 0
fi

# Peer-activity probe — scoped to THIS project's session dir, excluding my OWN
# session jsonl + co-spawned agent sub-transcripts (the old all-projects find
# counted my own agents -> ~always fired).
# DELEGATE_REVIEW_FAKE_PEERS overrides for deterministic smoke tests.
if [[ -n "${DELEGATE_REVIEW_FAKE_PEERS:-}" ]]; then
  RECENT="$DELEGATE_REVIEW_FAKE_PEERS"
else
  # Locate THIS project's session dir via the current session's own jsonl.
  PROJ_DIR=""
  if [[ -n "$SID" ]]; then
    SELF_JSONL="$( { find "$HOME/.claude/projects" -maxdepth 2 -name "${SID}.jsonl" -print -quit 2>/dev/null || true; } )"
    [[ -n "$SELF_JSONL" ]] && PROJ_DIR="$(dirname "$SELF_JSONL")"
  fi
  # No reliable project scope -> don't risk a cross-project false-fire.
  [[ -z "$PROJ_DIR" ]] && exit 0
  # >=1 OTHER top-level session jsonl in this project, recently modified, == a live peer.
  RECENT="$( { find "$PROJ_DIR" -maxdepth 1 -name '*.jsonl' ! -name "${SID}.jsonl" ! -name 'agent-*' -mmin -30 2>/dev/null || true; } | wc -l | tr -d ' ')"
fi
[[ "${RECENT:-0}" -ge 1 ]] || exit 0
_w1_out=found
warn_emit <<EOF || true

⚠️  delegate-code-review-warn: this Agent dispatch looks like a --code / builder≠breaker
    review, AND other session/agent jsonls are active (rough proxy, NOT a peer count —
    a peer / review-hub MAY be live; verify with the scan below).

    DELEGATE the --code to the peer hub via 'mail-send' and proceed (next audit /
    flip / wrap), folding any P1 async BEFORE the owner-gated push — don't serialize
    it inline. Double-check each peer finding at file:line.

      Check the hub:  python3 scripts/parallel-session-scan.py --hours 9
      Delegate:       python3 scripts/session-manifest.py mail-send --to <sid8|all> "<--code request + SHAs>"

    If you're solo (no review hub) or this isn't a delegable review, ignore.
    Disable per-invocation: SKIP_DELEGATE_REVIEW_WARN=1

EOF

exit 0
