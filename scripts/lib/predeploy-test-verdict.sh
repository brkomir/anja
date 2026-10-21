# shellcheck shell=bash
# predeploy-test-verdict.sh — ONE verdict for a vitest run, from BOTH its exit code and its summary.
# Sourced by scripts/pre-deploy-check.sh (unit + integration arms); tested with
# fixture logs, so the shipped function is what is tested.
#
# WHY BOTH:
#   - the exit code alone misses a run that exits 0 having run nothing (no summary at all);
#   - the summary alone misses vitest 4's `Errors  N error(s)` line: an unhandled rejection makes
#     vitest exit 1 while `Test Files` and `Tests` both read "passed" — measured, and the old
#     summary-only arm scored that run PASS.
# The callers capture rc WITHOUT a pipe (`cmd >log 2>&1 || rc=$?`), so rc IS vitest's (the failure this
# guards against was a pipe; there is none). The integration wrapper returns vitest's own code (integration-test.sh,
# PIPESTATUS), and the `Errors` grep covers any wrapper that ever loses it.
#
# test_run_verdict <rc> <log>  → prints PASS | FAIL | NOSUMMARY, returns 0.
#   FAIL      rc != 0, or a `Tests … failed` / `Test Files … failed` / `Errors N error` line
#   PASS      rc == 0 and a `Tests … passed` line
#   NOSUMMARY rc == 0 and no summary line (a run that did not complete or did not run)
test_run_verdict() {
  local rc="$1" log="$2"
  if [ "$rc" != "0" ] \
     || grep -qE 'Tests .*failed|Test Files .*failed' "$log" 2>/dev/null \
     || grep -qE '^[[:space:]]*Errors[[:space:]]+[0-9]+ errors?' "$log" 2>/dev/null; then
    echo FAIL
  elif grep -qE 'Tests .*passed' "$log" 2>/dev/null; then
    echo PASS
  else
    echo NOSUMMARY
  fi
  return 0
}

# test_run_summary <log> → the `Test Files` / `Tests` / `Errors` summary lines on one line, for a message.
test_run_summary() {
  { grep -E '^[[:space:]]*(Test Files|Tests|Errors)[[:space:]]' "$1" 2>/dev/null || true; } \
    | tail -3 | sed 's/^[[:space:]]*//' | tr '\n' ' '
}
