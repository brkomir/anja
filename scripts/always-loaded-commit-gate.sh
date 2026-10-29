#!/usr/bin/env bash
# always-loaded-commit-gate.sh — refuse a commit that carries an always-loaded file while the committing
# session's door is closed. Called by scripts/safe-commit.sh and scripts/private-index-commit.sh before
# they stage anything, and by .githooks/prepare-commit-msg on every commit git's own commit path makes,
# safe-commit.sh's included.
#
#   always-loaded-commit-gate.sh -- <path>...   (paths relative to the repo root)
#   always-loaded-commit-gate.sh --self-test
#
# EXIT  0 = the commit may proceed · 1 = REFUSED (the reason is on stderr) · 2 = usage
#
# WHY:
# .claude/hooks/block-subagent-always-loaded-write.sh refuses an Edit, Write or MultiEdit of an
# always-loaded file unless the session's door is open, and the door is the owner's `! touch` since
# 2026-10-25. It never sees a shell write: a session changed 2 lines of
# .claude/orchestrator/conventions.md with `git apply` on 2026-10-28 with its door closed, and a command-string
# check cannot catch that shape, because `git apply` names the patch file, not the files it changes. Every
# write method ends in a commit, so the commit is where it is caught, before the change is durable: through
# these two tools, or through git's own commit path, where .githooks/prepare-commit-msg calls this gate. It
# does NOT reach an uncommitted change on disk, which every session reads at once, nor anything that writes a
# commit or moves a branch outside git's commit path (commit-tree or update-ref by hand; git am or a git rebase
# --apply, which apply patches without running prepare-commit-msg; a commit that already exists arriving on a
# branch: a fast-forward merge, pull or cherry-pick --ff, or the upstream side of a pull --rebase; a reset),
# nor a run with core.hooksPath pointed elsewhere, nor a session working to get past it. Every session runs as the
# owner's user, so a commit from a process it detached from its own tree, with both session variables dropped,
# reads as the owner's terminal (the parent walk ends at the root without meeting Claude Code), and a ps or bash
# of its own ahead on PATH, or exported as a shell function, answers for the real one, with or without its
# session id. It stops a session that commits the ordinary way; it is not a boundary against one evading it.
#
# NO OVERRIDE. The first version took the owner's words in a flag and only logged them: nothing could
# confirm they were the owner's, and a session that over-reads the owner (a summary of the owner's words, a
# peer's quote, a yes about something else) would fill it in sincerely. The door is the only way through,
# because only the owner types it; --owner-words is refused by name so an old recipe fails loudly.
#
# ONE DEFINITION. The protected set and the door test are the guard's own: each declared path is put to
# the guard as a synthetic Edit of that path, in this session's name, and a deny means "protected and the
# door is closed" (or expired: the guard's own stderr says which). No second copy of either to drift. The
# guard's ledgers are pointed at a throwaway directory for the call, because a commit is not an edit and
# its fires would read as Edit denials; this gate keeps its own record in
# .claude/logs/always-loaded-commit-gate-fires.jsonl (refusals).
#
# THE DOOR MUST BE OPEN AT COMMIT TIME, so the guard's recipe now reads "remove the door after the
# commit", not after the edit. Measured before this shipped: 22 commits of always-loaded files since
# 2026-10-25, 3 with a door touched in the 15 minutes before them; the sessions behind the rest show
# guard denials minutes before they committed, so they had the owner's door and removed it after editing
# as the old recipe said. Under the old recipe this gate would have refused them.
#
# NOT A CLAUDE SESSION (no CLAUDE_CODE_SESSION_ID and no CLAUDECODE, and no Claude Code process among the
# commit's parents, which the gate reads as the owner's own terminal): the door is per session, so the check does not apply; the
# commit proceeds and the gate says so. A Claude session (CLAUDECODE=1) with no session id is REFUSED instead,
# since no door can be named for it. The two variables are the session's own to drop, so their absence alone
# cannot tell the owner's terminal from a session that removed them: before letting such a commit through,
# the gate walks its parent processes and REFUSES when one is Claude Code, or when the walk cannot finish (the
# process table cannot be read, or the walk passes 64 levels; fail closed). The guard's test seams (FF_ALWAYS_LOADED_ALLOW_MARKER / _PREFIX / _TTL_SEC, AL_GATE_GUARD)
# and this gate's own (FF_ALWAYS_LOADED_ANCESTRY) are passed through only when the committing repo is not this
# script's own (see THE SEAMS BELONG TO FIXTURES in al_gate), so the self-test can open a door, or name a parent
# process, in its throwaway repo without touching the real /tmp prefix or the real process table.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="${AL_GATE_GUARD:-$HERE/../.claude/hooks/block-subagent-always-loaded-write.sh}"

# rc 0 = a Claude Code process is among this script's parents · 1 = none is · 2 = the process table could not be
# read, or the walk reached its 64-level cap first (fail closed). Claude Code runs as a process named claude (or
# started by its versioned path, .../claude/versions/<v>), or as node or bun running the claude-code package; the
# package rule reads only a node or bun process's arguments, so a commit message that mentions the package does
# not count.
# One process row per call: from ps, or, as a fixture seam, from the table file FF_ALWAYS_LOADED_ANCESTRY names
# (rows "<pid> <ppid> <comm> [args]"; the row keyed SELF answers the walk's first pid; an unreadable table is a ps
# failure; comm EMPTY prints nothing). Only the ROW comes from the seam, so every rule in the walk is under test.
_al_proc() {  # $1 = ps -o fields (ppid=,comm= or args=) · $2 = pid
  if [ -z "${FF_ALWAYS_LOADED_ANCESTRY+x}" ]; then ps -o "$1" -p "$2" 2>/dev/null; return; fi
  [ -r "$FF_ALWAYS_LOADED_ANCESTRY" ] || return 1
  local f="$1" row; row="$(awk -v p="$2" '$1==p {print; exit}' "$FF_ALWAYS_LOADED_ANCESTRY")"
  [ -n "$row" ] || row="$(awk '$1=="SELF" {print; exit}' "$FF_ALWAYS_LOADED_ANCESTRY")"
  set -f; set -- $row; set +f
  [ "${3:-}" = "EMPTY" ] && return 0
  case "$f" in ppid=,comm=) printf '%s %s\n' "$2" "$3" ;; *) shift 3; printf '%s\n' "$*" ;; esac
}
claude_ancestor() {
  local p=$$ line pp comm args i=0
  while [ "$p" -gt 0 ] && [ "$i" -lt 64 ]; do
    line="$(_al_proc ppid=,comm= "$p")" || return 2
    [ -n "$line" ] || return 2
    pp="$(printf '%s\n' "$line" | awk '{print $1}')"
    comm="$(printf '%s\n' "$line" | sed -E 's/^[[:space:]]*[0-9]+[[:space:]]+//')"
    [ "${comm##*/}" = "claude" ] && return 0
    case "$comm" in */claude/versions/*) return 0 ;; esac
    case "${comm##*/}" in
      node|nodejs|bun)
        args="$(_al_proc args= "$p")"
        case "$args" in *claude-code/cli*|*@anthropic-ai/claude-code*) return 0 ;; esac ;;
    esac
    case "$pp" in ''|*[!0-9]*) return 2 ;; esac
    p="$pp"; i=$((i+1))
  done
  [ "$p" -le 1 ] && return 1
  return 2  # 64 levels without reaching the root: the walk cannot tell, so fail closed
}

al_gate() {
  local -a paths=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --owner-words|--owner-words=*) echo "always-loaded-commit-gate: --owner-words was removed on 2026-10-28 (the door is the only way through); ask the owner to run the ! touch line for this session." >&2; return 2 ;;
      --) shift; while [ $# -gt 0 ]; do paths+=("$1"); shift; done ;;
      *) echo "always-loaded-commit-gate: unexpected arg '$1'" >&2; return 2 ;;
    esac
  done
  [ "${#paths[@]}" -gt 0 ] || { echo "always-loaded-commit-gate: need at least one path after --" >&2; return 2; }
  local root; root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  # THE SEAMS BELONG TO FIXTURES. In the hook the harness sets these; here the committing session does, so
  # in this script's own repo a session could open its own door with one. Honoured only for another repo.
  local own_c root_c
  own_c="$(git -C "$HERE" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  root_c="$(git -C "$root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  if [ -z "$own_c" ] || [ "$own_c" = "$root_c" ]; then
    unset FF_ALWAYS_LOADED_ALLOW_MARKER FF_ALWAYS_LOADED_ALLOW_PREFIX FF_ALWAYS_LOADED_ALLOW_TTL_SEC FF_ALWAYS_LOADED_ANCESTRY
    GUARD="$HERE/../.claude/hooks/block-subagent-always-loaded-write.sh"
  fi
  if [ ! -f "$GUARD" ]; then
    echo "always-loaded-commit-gate: the always-loaded write guard is not at $GUARD, so the protected set is unknown; REFUSING (fail closed)." >&2
    echo "  To recover: restore the guard file at that path (git show HEAD:.claude/hooks/block-subagent-always-loaded-write.sh). Commits work again at once: this check runs the file on disk, so the fix need not be committed first." >&2
    return 1
  fi
  local sid="${CLAUDE_CODE_SESSION_ID:-}"
  local logs; logs="$(mktemp -d)"
  local errf; errf="$(mktemp)"
  local -a hits=(); local p payload out grc guard_err=""
  for p in "${paths[@]}"; do
    payload="$(python3 -c 'import json,sys; print(json.dumps({"tool_name":"Edit","tool_input":{"file_path":sys.argv[1]},"session_id":sys.argv[2]}))' "$root/$p" "$sid")" || { echo "always-loaded-commit-gate: python3 failed to build the probe for '$p'; REFUSING (fail closed)." >&2; rm -rf "$logs" "$errf"; return 1; }
    out="$(printf '%s' "$payload" | env CLAUDE_PROJECT_DIR="$root" HOOK_FIRES_LOG_DIR="$logs" bash "$GUARD" 2>"$errf")"; grc=$?
    if printf '%s' "$out" | grep -qE '"permissionDecision"[[:space:]]*:[[:space:]]*"deny"'; then
      hits+=("$p")
      [ -s "$errf" ] && guard_err="$(head -c 400 "$errf")"
    elif [ "$grc" -ne 0 ] || [ -n "$out" ]; then  # the guard allows only by rc 0 and empty stdout
      echo "always-loaded-commit-gate: the guard gave no verdict for '$p' (rc=$grc); REFUSING (fail closed)." >&2
      echo "  To recover: the guard is broken. Check it with: bash -n $GUARD (and run it on one Edit payload); fix it on disk. Commits work again at once: this check runs the file on disk, so the fix need not be committed first. Until then every commit that stages a path refuses, through safe-commit.sh, private-index-commit.sh, git commit or any other route .githooks/prepare-commit-msg reaches." >&2
      rm -rf "$logs" "$errf"; return 1
    fi
  done
  rm -rf "$logs" "$errf"
  [ "${#hits[@]}" -eq 0 ] && return 0
  if [ -z "$sid" ] && [ -z "${FF_ALWAYS_LOADED_ALLOW_MARKER:-}" ]; then
    if [ -z "${CLAUDECODE:-}" ]; then
      local arc=0
      claude_ancestor || arc=$?
      if [ "$arc" -eq 1 ]; then
        echo "always-loaded-commit-gate: not run from a Claude session (no CLAUDE_CODE_SESSION_ID, no CLAUDECODE, no Claude Code parent process), so the per-session door does not apply: ${hits[*]}" >&2
        return 0
      fi
      if [ "$arc" -eq 0 ]; then
        echo "always-loaded-commit-gate: REFUSED — neither session variable is set, but Claude Code is one of this commit's parent processes, so this is a Claude session and its door decides: ${hits[*]}. Commit from the session with its door open. Nothing was staged or committed." >&2
      else
        echo "always-loaded-commit-gate: REFUSED — neither session variable is set and the parent processes could not be read to the root (the table was unreadable, or the walk passed 64 levels), so the owner's own terminal cannot be told from a Claude session (fail closed): ${hits[*]}. Nothing was staged or committed." >&2
      fi
      { mkdir -p "$root/.claude/logs" && python3 -c '
import json, sys, datetime
print(json.dumps({"ts": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                  "sid": "", "decision": "refused-no-session-vars", "paths": sys.argv[1:]}))' \
          "${hits[@]}" >> "$root/.claude/logs/always-loaded-commit-gate-fires.jsonl"; } 2>/dev/null || true
      return 1
    fi
    echo "always-loaded-commit-gate: REFUSED — a Claude session (CLAUDECODE is set) with no CLAUDE_CODE_SESSION_ID, so no door can be named for it: ${hits[*]}. Commit these from the owner's own terminal. Nothing was staged or committed." >&2
    return 1
  fi
  { mkdir -p "$root/.claude/logs" && python3 -c '
import json, sys, datetime
print(json.dumps({"ts": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                  "sid": sys.argv[1][:8], "decision": "refused", "paths": sys.argv[2:]}))' \
      "$sid" "${hits[@]}" >> "$root/.claude/logs/always-loaded-commit-gate-fires.jsonl"; } 2>/dev/null || true
  {
    echo "always-loaded-commit-gate: REFUSED — this commit carries always-loaded file(s) and this session's door is closed:"
    for p in "${hits[@]}"; do echo "    $p"; done
    [ -n "$guard_err" ] && echo "  the guard says: $guard_err"
    echo "  These files are read by every session on its next turn, and only the owner opens the door for writing them."
    echo "  Ask the owner to run:  ! touch ${FF_ALWAYS_LOADED_ALLOW_PREFIX:-/tmp/claude-always-loaded-allow}.$sid"
    echo "  (it opens the door for the guard's window, 15 minutes unless FF_ALWAYS_LOADED_ALLOW_TTL_SEC says otherwise), then re-run this commit; remove the door AFTER the commit."
    echo "  Nothing was staged or committed."
  } >&2
  return 1
}

self_test() {
  local T; T="$(mktemp -d)"
  local PASS=0 FAIL=0 RC OUT
  local SELF; SELF="$HERE/$(basename "${BASH_SOURCE[0]}")"
  ( cd "$T" && git init -q . && git config user.email t@t && git config user.name t && mkdir -p .claude/rules .claude/orchestrator && echo x > CLAUDE.md && echo x > AGENTS.md && echo x > .claude/rules/r.md && echo x > .claude/orchestrator/o.md && echo x > plain.txt && git add -A && git commit -qm init ) || { echo "self-test: fixture repo failed"; rm -rf "$T"; return 1; }
  local DOOR="$T/door"
  ck() {  # $1 expected rc · $2 name · $3 needle that must be in the output ('' = none) · $4 needle that must NOT be ('' = none)
    if [ "$RC" = "$1" ] && { [ -z "$3" ] || grep -qF -- "$3" <<<"$OUT"; } && { [ -z "${4:-}" ] || ! grep -qF -- "$4" <<<"$OUT"; }; then
      PASS=$((PASS+1)); echo "PASS  $2"
    else
      FAIL=$((FAIL+1)); echo "FAIL  $2 (rc=$RC)"; printf '%s\n' "$OUT" | sed 's/^/      /' | head -12
    fi
  }
  g() { OUT="$(cd "$T" && env "$@" 2>&1)"; RC=$?; }
  local TEST_ID=feedc0de-0000-4000-8000-0000
  rm -f "$DOOR"
  g CLAUDE_CODE_SESSION_ID=$TEST_ID FF_ALWAYS_LOADED_ALLOW_MARKER="$DOOR" bash "$SELF" -- CLAUDE.md
  ck 1 "G1 a protected file with the door closed is refused, names the file, and offers no override" "    CLAUDE.md" "owner-always-loaded"
  for f in AGENTS.md .claude/rules/r.md .claude/orchestrator/o.md; do
    g CLAUDE_CODE_SESSION_ID=$TEST_ID FF_ALWAYS_LOADED_ALLOW_MARKER="$DOOR" bash "$SELF" -- "$f"
    ck 1 "G2 every protected family is refused with the door closed: $f" "    $f"
  done
  : > "$DOOR"
  g CLAUDE_CODE_SESSION_ID=$TEST_ID FF_ALWAYS_LOADED_ALLOW_MARKER="$DOOR" bash "$SELF" -- CLAUDE.md
  ck 0 "G3 a protected file with the door open commits, silently" "" "REFUSED"
  touch -t "$(date -v-2H +%Y%m%d%H%M 2>/dev/null || date -d '2 hours ago' +%Y%m%d%H%M)" "$DOOR"
  g CLAUDE_CODE_SESSION_ID=$TEST_ID FF_ALWAYS_LOADED_ALLOW_MARKER="$DOOR" bash "$SELF" -- CLAUDE.md
  ck 1 "G4 an expired door is refused, and the guard's own reason is passed on" "EXPIRED"
  rm -f "$DOOR"
  g CLAUDE_CODE_SESSION_ID=$TEST_ID FF_ALWAYS_LOADED_ALLOW_MARKER="$DOOR" bash "$SELF" -- plain.txt
  ck 0 "G5 an ordinary file commits with the door closed, silently" "" "REFUSED"
  g CLAUDE_CODE_SESSION_ID=$TEST_ID FF_ALWAYS_LOADED_ALLOW_MARKER="$DOOR" bash "$SELF" -- plain.txt .claude/rules/r.md
  ck 1 "G6 a mixed commit is refused and names only the protected file" "    .claude/rules/r.md" "    plain.txt"
  g CLAUDE_CODE_SESSION_ID=$TEST_ID FF_ALWAYS_LOADED_ALLOW_MARKER="$DOOR" bash "$SELF" -- .claude/rules/gone.md
  ck 1 "G7 a protected path not on disk (a deletion) is refused" "    .claude/rules/gone.md"
  rm -f "$T/.claude/logs/always-loaded-commit-gate-fires.jsonl"
  g CLAUDE_CODE_SESSION_ID=$TEST_ID FF_ALWAYS_LOADED_ALLOW_MARKER="$DOOR" bash "$SELF" --owner-words 'yes, commit "it"' -- CLAUDE.md
  ck 2 "G8 the removed --owner-words flag is refused by name, never honoured" "was removed"
  g CLAUDE_CODE_SESSION_ID=$TEST_ID FF_ALWAYS_LOADED_ALLOW_MARKER="$DOOR" bash "$SELF" --owner-words=yes -- CLAUDE.md
  ck 2 "G9 the = spelling of the removed flag is refused too" "was removed"
  g CLAUDE_CODE_SESSION_ID=$TEST_ID FF_ALWAYS_LOADED_ALLOW_MARKER="$DOOR" bash "$SELF" -- CLAUDE.md
  if grep -qF '"decision": "refused"' "$T/.claude/logs/always-loaded-commit-gate-fires.jsonl" 2>/dev/null; then
    PASS=$((PASS+1)); echo "PASS  G10 a refusal is logged"
  else FAIL=$((FAIL+1)); echo "FAIL  G10 a refusal is logged"; fi
  local AT="$T/ancestry"
  at() { printf '%s\n' "$@" > "$AT"; }  # one parents-table row per argument: "<pid> <ppid> <comm> [args]"
  at "SELF 500 bash" "500 400 -zsh" "400 300 /usr/bin/login" "300 1 iTerm2" "1 0 /sbin/launchd"
  g -u CLAUDE_CODE_SESSION_ID -u FF_ALWAYS_LOADED_ALLOW_MARKER -u CLAUDECODE FF_ALWAYS_LOADED_ANCESTRY="$AT" bash "$SELF" -- CLAUDE.md
  ck 0 "G11 outside a Claude session (the owner's own terminal) the door check does not apply, and it says so" "not run from a Claude session"
  g CLAUDE_CODE_SESSION_ID=$TEST_ID FF_ALWAYS_LOADED_ALLOW_MARKER="$DOOR" AL_GATE_GUARD=/nonexistent/guard.sh bash "$SELF" -- CLAUDE.md
  ck 1 "G12 a missing guard refuses, and says why" "protected set is unknown"
  ck 1 "G12b a missing guard's refusal says how to recover" "To recover: restore the guard file"
  g CLAUDE_CODE_SESSION_ID=$TEST_ID bash "$SELF" CLAUDE.md
  ck 2 "G13 a path without -- is a usage error" "unexpected arg"
  # The guard logs under the COMMITTING repo (CLAUDE_PROJECT_DIR), so its ledgers here are the fixture's.
  rm -f "$T/.claude/logs/subagent-always-loaded-block.log" "$T/.claude/logs/subagent-always-loaded-block-fires.jsonl"
  g CLAUDE_CODE_SESSION_ID=$TEST_ID FF_ALWAYS_LOADED_ALLOW_MARKER="$DOOR" bash "$SELF" -- CLAUDE.md
  if [ "$RC" = 1 ] && [ ! -e "$T/.claude/logs/subagent-always-loaded-block.log" ] && [ ! -e "$T/.claude/logs/subagent-always-loaded-block-fires.jsonl" ]; then
    PASS=$((PASS+1)); echo "PASS  G14 a refused commit writes nothing to the guard's own Edit ledgers"
  else FAIL=$((FAIL+1)); echo "FAIL  G14 a refused commit writes nothing to the guard's own Edit ledgers (rc=$RC; $(ls "$T/.claude/logs" 2>/dev/null | tr '\n' ' '))"; fi
  printf '#!/bin/bash\nexit 3\n' > "$T/crash.sh"; rm -f "$DOOR"
  g CLAUDE_CODE_SESSION_ID=$TEST_ID FF_ALWAYS_LOADED_ALLOW_MARKER="$DOOR" AL_GATE_GUARD="$T/crash.sh" bash "$SELF" -- CLAUDE.md
  ck 1 "G15 a guard that dies without a verdict refuses" "gave no verdict"
  ck 1 "G15b that refusal says how to recover" "To recover: the guard is broken"
  mkdir -p "$T/scripts" "$T/.claude/hooks/lib" && cp "$SELF" "$T/scripts/" && cp "$GUARD" "$T/.claude/hooks/" && cp "$(dirname "$GUARD")/lib/fires-log.sh" "$T/.claude/hooks/lib/" && : > "$DOOR"
  g CLAUDE_CODE_SESSION_ID=$TEST_ID FF_ALWAYS_LOADED_ALLOW_MARKER="$DOOR" FF_ALWAYS_LOADED_ALLOW_TTL_SEC=0 bash "$T/scripts/$(basename "$SELF")" -- CLAUDE.md
  ck 1 "G16 in the gate's own repo the door seams are ignored (a session cannot open its own door)" "    CLAUDE.md"
  # G16b-G16d: the other seams the own-repo branch drops, one arm each.
  : > "$T/pfx2.$TEST_ID"
  g -u FF_ALWAYS_LOADED_ALLOW_MARKER CLAUDE_CODE_SESSION_ID=$TEST_ID FF_ALWAYS_LOADED_ALLOW_PREFIX="$T/pfx2" bash "$T/scripts/$(basename "$SELF")" -- CLAUDE.md
  ck 1 "G16b in the gate's own repo the door-prefix seam is ignored too" "    CLAUDE.md"
  printf '#!/bin/bash\ncat >/dev/null\nexit 0\n' > "$T/allow.sh"
  g -u FF_ALWAYS_LOADED_ALLOW_MARKER CLAUDE_CODE_SESSION_ID=$TEST_ID AL_GATE_GUARD="$T/allow.sh" bash "$T/scripts/$(basename "$SELF")" -- CLAUDE.md
  ck 1 "G16c in the gate's own repo AL_GATE_GUARD is ignored and the real guard answers" "    CLAUDE.md"
  local NR; NR="$(cd "$(mktemp -d)" && pwd -P)"
  mkdir -p "$NR/scripts" "$NR/.claude/hooks/lib" && cp "$SELF" "$NR/scripts/" && cp "$GUARD" "$NR/.claude/hooks/" && cp "$(dirname "$GUARD")/lib/fires-log.sh" "$NR/.claude/hooks/lib/"
  g CLAUDE_CODE_SESSION_ID=$TEST_ID FF_ALWAYS_LOADED_ALLOW_MARKER="$DOOR" bash "$NR/scripts/$(basename "$SELF")" -- CLAUDE.md
  ck 1 "G16d a gate outside any git repo ignores the seams too (fail closed)" "    CLAUDE.md"
  rm -rf "$NR"
  # G17-G19: the verdict is parsed, and the production door path.
  printf '#!/bin/bash\ncat >/dev/null\necho \x27{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"x"}}\x27\n' > "$T/compact.sh"
  g CLAUDE_CODE_SESSION_ID=$TEST_ID FF_ALWAYS_LOADED_ALLOW_MARKER="$DOOR" AL_GATE_GUARD="$T/compact.sh" bash "$SELF" -- plain.txt
  ck 1 "G17 a deny in compact JSON is read as a deny (the verdict is parsed, not byte-matched)" "    plain.txt"
  # The production door: no exact-marker seam, the guard derives <prefix>.<session id> from the payload.
  rm -f "$T/pfx.$TEST_ID"
  g -u FF_ALWAYS_LOADED_ALLOW_MARKER CLAUDE_CODE_SESSION_ID=$TEST_ID FF_ALWAYS_LOADED_ALLOW_PREFIX="$T/pfx" bash "$SELF" -- CLAUDE.md
  ck 1 "G18 the per-session door path is the one the refusal names" "$T/pfx.$TEST_ID"
  : > "$T/pfx.$TEST_ID"
  g -u FF_ALWAYS_LOADED_ALLOW_MARKER CLAUDE_CODE_SESSION_ID=$TEST_ID FF_ALWAYS_LOADED_ALLOW_PREFIX="$T/pfx" bash "$SELF" -- CLAUDE.md
  ck 0 "G19 this session's own door, found by its session id, lets the commit through" "" "REFUSED"
  # G20: a Claude session with no session id is refused; only the owner's own terminal is exempt.
  g -u CLAUDE_CODE_SESSION_ID -u FF_ALWAYS_LOADED_ALLOW_MARKER CLAUDECODE=1 bash "$SELF" -- CLAUDE.md
  ck 1 "G20 a Claude session (CLAUDECODE=1) with no session id is refused" "no door can be named"
  # G21-G24: a session that drops both variables is still a session.
  local NOVARS="-u CLAUDE_CODE_SESSION_ID -u FF_ALWAYS_LOADED_ALLOW_MARKER -u CLAUDECODE FF_ALWAYS_LOADED_ANCESTRY=$AT"
  at "SELF 500 bash" "500 400 /bin/zsh" "400 300 claude" "300 1 /usr/bin/login"
  g $NOVARS bash "$SELF" -- CLAUDE.md
  ck 1 "G21 no session variables, but a parent process (two levels up) is Claude Code: refused" "Claude Code is one of this commit's parent processes" "not run from a Claude session"
  if grep -qF '"decision": "refused-no-session-vars"' "$T/.claude/logs/always-loaded-commit-gate-fires.jsonl" 2>/dev/null; then
    PASS=$((PASS+1)); echo "PASS  G21b that refusal is logged"
  else FAIL=$((FAIL+1)); echo "FAIL  G21b that refusal is logged"; fi
  at "SELF 500 bash" "500 1 /usr/local/bin/claude"
  g $NOVARS bash "$SELF" -- CLAUDE.md
  ck 1 "G22 Claude Code named by its full path counts too" "Claude Code is one of"
  at "SELF 500 bash" "500 400 node node /opt/lib/node_modules/@anthropic-ai/claude-code/cli.js" "400 1 -zsh"
  g $NOVARS bash "$SELF" -- CLAUDE.md
  ck 1 "G22b node running the claude-code package counts too (the args rule)" "Claude Code is one of"
  at "SELF 1 bash" "1 0 claude"
  g $NOVARS bash "$SELF" -- CLAUDE.md
  ck 1 "G22c Claude Code as process 1 (a container's entry point) counts too" "Claude Code is one of"
  at "SELF 500 bash" "500 400 git git commit -m mentions-@anthropic-ai/claude-code/cli.js" "400 1 -zsh" "1 0 /sbin/launchd"
  g $NOVARS bash "$SELF" -- CLAUDE.md
  ck 0 "G22d a parent that is not node or bun counts not, even when its arguments name the claude-code package (the owner's own commit message)" "not run from a Claude session"
  at "SELF 500 bash" "500 1 /opt/claude/versions/2.1.0" "1 0 /sbin/launchd"
  g $NOVARS bash "$SELF" -- CLAUDE.md
  ck 1 "G22e Claude Code started by its versioned path counts too" "Claude Code is one of"
  g -u CLAUDE_CODE_SESSION_ID -u FF_ALWAYS_LOADED_ALLOW_MARKER -u CLAUDECODE FF_ALWAYS_LOADED_ANCESTRY="$T/no-such-table" bash "$SELF" -- CLAUDE.md
  ck 1 "G23 a process table that cannot be read refuses (fail closed)" "could not be read"
  at "SELF 500 bash" "500 0 EMPTY"
  g $NOVARS bash "$SELF" -- CLAUDE.md
  ck 1 "G23b a parent the table has no row for refuses (fail closed)" "could not be read"
  at "SELF x7 bash"
  g $NOVARS bash "$SELF" -- CLAUDE.md
  ck 1 "G23c a parent id that is not a number refuses (fail closed)" "could not be read"
  at "SELF 500 bash" "500 1 claude"
  g $NOVARS bash "$SELF" -- plain.txt
  ck 0 "G24 an ordinary file still commits with no session variables, whatever the parents" "" "REFUSED"
  # G26: a parent chain longer than the walk's 64 levels refuses (fail closed); 70 nested shells
  # put every real parent past the cap, from a Claude session and from CI alike.
  printf '#!/bin/bash\nn=$1; shift\nif [ "$n" -gt 0 ]; then bash "$0" $((n-1)) "$@"; exit $?; fi\nexec "$@"\n' > "$T/nest.sh"
  g -u CLAUDE_CODE_SESSION_ID -u FF_ALWAYS_LOADED_ALLOW_MARKER -u CLAUDECODE -u FF_ALWAYS_LOADED_ANCESTRY bash "$T/nest.sh" 70 bash "$SELF" -- CLAUDE.md
  ck 1 "G26 a parent chain longer than the walk's 64 levels refuses (fail closed), never reads as the owner's terminal" "could not be read" "not run from a Claude session"
  # G25: in the gate's own repo the parent-process seam is ignored and the real process table answers, so the
  # expected result is read off this self-test's own parents (a Claude session: refused; a terminal or CI: through).
  # The seam's table always says the OPPOSITE of the real one, so a seam the gate wrongly honours turns this red
  # in every environment, CI included.
  local real=0; ( unset FF_ALWAYS_LOADED_ANCESTRY; claude_ancestor ) || real=$?
  if [ "$real" -eq 0 ]; then at "SELF 500 bash" "500 1 -zsh"; else at "SELF 500 bash" "500 1 claude"; fi
  g $NOVARS bash "$T/scripts/$(basename "$SELF")" -- CLAUDE.md
  case "$real" in
    0) ck 1 "G25 in the gate's own repo the parent-process seam is ignored (run from a Claude session: refused)" "Claude Code is one of" ;;
    1) ck 0 "G25 in the gate's own repo the parent-process seam is ignored (run outside a Claude session: through)" "not run from a Claude session" ;;
    *) ck 1 "G25 in the gate's own repo the parent-process seam is ignored (process table unreadable: refused)" "could not be read" ;;
  esac
  rm -rf "$T"
  echo "self-test: $PASS passed, $FAIL failed"
  [ "$FAIL" -eq 0 ]
}

if [ "${1:-}" = "--self-test" ]; then self_test; exit $?; fi
[ $# -gt 0 ] || { echo "usage: always-loaded-commit-gate.sh -- <path>...  |  --self-test" >&2; exit 2; }
al_gate "$@"
