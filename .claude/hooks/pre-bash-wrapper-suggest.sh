#!/usr/bin/env bash
# PreToolUse(Bash) hook — warn-mode when a direct invocation bypasses a project wrapper script.
#
# Codified 2026-04-21 after a session hit the e2e guard the hard way:
# ran `npx playwright test` directly, all auth'd tests showed login-stuck symptom
# because .next was built against the wrong env. A runtime guard caught it
# AFTER ~3 min of wasted attempts. This hook catches it BEFORE the command runs.
#
# MODE: WARN-ONLY (exit 0). Never blocks. Warns on patterns where project has a
# canonical wrapper script that handles env/Docker/build discipline.
#
# Patterns scanned:
#   - `npx playwright test` / `npx playwright ...` without preceding `scripts/e2e-local.sh`
#     → suggest `./scripts/e2e-local.sh` (handles mock-auth build + Docker Postgres)
#   - `npx vitest run tests/integration` / bare integration vitest
#     → suggest `npm run test:integration` (auto-starts Docker)
#   - bare `psql` / direct prod Supabase DATABASE_URL use without /migration context
#     → suggest `/migration` skill
#   - `timeout`/`gtimeout` in command position when the binary is absent (macOS dev has
#     no coreutils) → suggest the Bash TOOL's own `timeout` param or `perl -e 'alarm'`
#     (an enforce layer for a loaded-rule-not-firing gap: the failure kept recurring
#     and each recurrence wasted a round-trip)
#
# Smoke-testable additions to scripts/smoke-test-hooks.sh required.

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

input=$(cat 2>/dev/null || echo "{}")
cmd=$(echo "$input" | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//')

if [[ -z "$cmd" ]]; then
  exit 0
fi

warn=""
suggest=""

# Direct `npx playwright` invocation — skip if wrapper is in the same command
if [[ -z "$warn" ]] \
  && echo "$cmd" | grep -qE '(^|[[:space:]&|;])npx[[:space:]]+playwright([[:space:]]|$)' \
  && ! echo "$cmd" | grep -qE 'scripts/e2e-local\.sh'; then
  warn="Direct \`npx playwright\` bypasses .next rebuild against mock-auth env"
  suggest="./scripts/e2e-local.sh [spec-filter] — rebuilds .next with the database service's public URL variable pointed at the local stack + starts Docker Postgres. Guard symptom: 'login page shown' on every auth'd test."
fi

# Direct `npx vitest run tests/integration` — integration tests need Docker
if [[ -z "$warn" ]] \
  && echo "$cmd" | grep -qE '(^|[[:space:]&|;])npx[[:space:]]+vitest[[:space:]].*tests/integration' \
  && ! echo "$cmd" | grep -qE '(^|[[:space:]&|;])(npm[[:space:]]+run[[:space:]]+test:integration|scripts/integration-test\.sh)'; then
  warn="Direct \`npx vitest\` on tests/integration skips Docker Postgres bootstrap"
  suggest="npm run test:integration — starts Docker DB + applies migrations before running. Symptom of skipping: CONNECTION_ENDED or missing-table errors."
fi

# Bare psql or direct Supabase connection outside the /migration skill path
if [[ -z "$warn" ]] \
  && echo "$cmd" | grep -qE '(^|[[:space:]&|;])psql[[:space:]]+.*(supabase\.co|DATABASE_URL)' \
  && ! echo "$cmd" | grep -qE 'migration|supabase/migrations/'; then
  warn="Direct psql against prod/staging Supabase bypasses migration logging + prefers-ipv4 + safety checks"
  suggest="/migration skill handles apply-to-staging-then-prod sequencing. If truly read-only exploration, add '# read-only' comment to silence this warn."
fi

# `timeout` / `gtimeout` in COMMAND POSITION (start of string/segment — after ; & | && ||
# or a $( subshell) when the binary is ABSENT. macOS dev ships neither (coreutils absent),
# so the command dies with `command not found` and wastes a round-trip every time.
# Command-position anchoring keeps `--timeout 3` flags and prose mentions silent.
# Gated on the binary actually being absent → installing coreutils auto-silences;
# MACOS_TIMEOUT_WARN_FORCE=1 forces the warn (deterministic smoke-test fixture).
if [[ -z "$warn" ]] \
  && echo "$cmd" | grep -qE '(^[[:space:]]*|[;&|][[:space:]]*|\$\([[:space:]]*)g?timeout[[:space:]]'; then
  _to_tok=$(echo "$cmd" | grep -oE '(^[[:space:]]*|[;&|][[:space:]]*|\$\([[:space:]]*)g?timeout[[:space:]]' | head -1 | grep -oE 'g?timeout')
  if [[ "${MACOS_TIMEOUT_WARN_FORCE:-0}" == "1" ]] || ! command -v "${_to_tok:-timeout}" >/dev/null 2>&1; then
    warn="\`${_to_tok:-timeout}\` is not installed here (macOS dev has no coreutils) — the command will die with 'command not found'"
    suggest="Use the Bash TOOL's own \`timeout\` parameter (milliseconds), or \`perl -e 'alarm N; exec @ARGV' -- <cmd> <args...>\`."
  fi
fi

if [[ -z "$warn" ]]; then
  exit 0
fi

warn_emit < <({
  echo ""
  echo "⚠️  WRAPPER-SCRIPT SUGGEST (pre-bash-wrapper-suggest.sh — WARN-ONLY):"
  echo "   Pattern: $warn"
  echo "   Command: $cmd"
  echo "   Suggest: $suggest"
  echo "   Mode: warn-only (exit 0). Will NOT block."
  echo ""
}) || true

exit 0
