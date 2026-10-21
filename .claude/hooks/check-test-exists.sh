#!/usr/bin/env bash
# PreToolUse hook — warn when editing src/**/*.ts(x) without a sibling test file.
#
# v2.8.0 top-priority adoption of a pattern by vinicius91carvalho.
# Enforces "tests with every fix" machine-side instead of
# orchestrator-memory-only. Warn-only v2.8.0 — path allowlist tuning via
# observation before promoting to block.
#
# MODE: WARN-ONLY (exit 0). Flip to BLOCK (exit 2) after 1 session confirms
# allowlist covers legitimate edit-without-test cases.
#
# Gated path: src/**/*.ts, src/**/*.tsx
# Allowlisted (no test required):
#   - src/db/schema.ts (pure schema)
#   - src/types/**, src/types.ts (type declarations)
#   - src/constants.ts, src/lib/env.ts (constants/env plumbing)
#   - src/middleware.ts (tested via e2e)
#   - src/app/**/page.tsx, layout.tsx, error.tsx, loading.tsx, not-found.tsx, opengraph-image.tsx (Next.js route files, e2e-tested)
#   - src/app/**/route.ts (API routes, integration-tested)
#   - *.d.ts (type declarations)
#   - src/db/migrations/** (migration files tested via integration)
#
# Sibling-test detection: searches tests/**/*<basename>*.test.ts(x).
# Found anywhere under tests/ → pass.

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

payload=$(cat 2>/dev/null || echo "{}")
file_path=$(echo "$payload" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

if [[ -z "${file_path:-}" ]]; then
  exit 0
fi

# Only gate src/**/*.ts(x)
case "$file_path" in
  *src/*.ts|*src/*.tsx) : ;;
  *) exit 0 ;;
esac

# Path allowlist (no test required)
case "$file_path" in
  *src/db/schema.ts) exit 0 ;;
  *src/db/migrations/*) exit 0 ;;
  *src/types/*) exit 0 ;;
  *src/types.ts) exit 0 ;;
  *src/constants.ts) exit 0 ;;
  *src/lib/env.ts) exit 0 ;;
  *src/middleware.ts) exit 0 ;;
  *src/app/*/page.tsx) exit 0 ;;
  *src/app/*/layout.tsx) exit 0 ;;
  *src/app/*/error.tsx) exit 0 ;;
  *src/app/*/loading.tsx) exit 0 ;;
  *src/app/*/not-found.tsx) exit 0 ;;
  *src/app/*/opengraph-image.tsx) exit 0 ;;
  *src/app/*/route.ts) exit 0 ;;
  *.d.ts) exit 0 ;;
esac

# Find repo root
d=$(dirname "$file_path")
repo_root=""
while [[ "$d" != "/" && "$d" != "." && -z "$repo_root" ]]; do
  if [[ -f "$d/package.json" ]]; then
    repo_root="$d"
    break
  fi
  d=$(dirname "$d")
done

if [[ -z "$repo_root" ]] || [[ ! -d "$repo_root/tests" ]]; then
  exit 0
fi

# Extract basename without extension
basename=$(basename "$file_path" | sed -E 's/\.tsx?$//')

# Look for sibling test file under tests/
test_found=0
if find "$repo_root/tests" -type f \( -name "*$basename*.test.ts" -o -name "*$basename*.test.tsx" \) 2>/dev/null | head -1 | grep -q .; then
  test_found=1
fi

if [[ "$test_found" -eq 0 ]]; then
  warn_emit < <({
    echo ""
    echo "🧪 TEST WARNING (check-test-exists.sh — WARN-ONLY, v2.8.0):"
    echo "   File: $file_path"
    echo "   No sibling test found under $repo_root/tests/"
    echo "   Expected: tests/**/*$basename*.test.ts(x)"
    echo "   Action: every feature + bug fix ships with tests."
    echo "   If this path legitimately needs no test, add it to allowlist in this script."
    echo "   Mode: warn-only. Will promote to block mode after false-positive calibration."
    echo ""
  }) || true
fi

exit 0
