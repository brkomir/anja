#!/usr/bin/env bash
# predeploy-lint-verdict.sh — the eslint ERROR gate's DISPOSITION for scripts/pre-deploy-check.sh.
#
# Why this gate exists: the deploy runs on push BEFORE CI reports. CI's lint job blocks on eslint rc 1,
# but that verdict arrives after the deploy has gone out, so an eslint ERROR in pushed code would reach
# production and fail CI only afterwards. So pre-deploy-check lints the files the push CHANGES (vs
# origin/main) and REFUSES the deploying push on rc 1. Warnings stay the pre-push ratchet's business —
# this gate never counts them.
#
# Extracted into a sourced lib (the prepush-l3-verdict.sh pattern) so scripts/smoke-test-hooks.sh can
# drive every branch with a fixture log instead of a real eslint run. Sourced by pre-deploy-check.sh
# only inside its lint step — `source` is a POSIX special builtin, so a lib that fails to parse aborts
# the caller under `set -e` (bash-environment.md); the smoke suite's `bash -n` arm guards that.
#
# Usage:  lint_error_disposition <eslint-rc> <log-path> <changed-lintable-file-count>
#   returns 0 = proceed, 1 = REFUSE. Prints the operator-facing lines. Reads SKIP_LINT_ERROR_GATE
#   (1 = warn instead of refuse — a documented exception, never the default; it is NOT the pre-push
#   ratchet's SKIP_LINT_RATCHET, which is a different concern sharing no branch with this one).
#   rc 0  → clean.   rc 1 → eslint reported ERRORS → refuse.   rc ≥2 → eslint failed to RUN → refuse
#   too: an instrument failure lands on the FAILING side, never reads as clean (bash-environment.md
#   § WRITE A GATE SO INSTRUMENT FAILURE LANDS ON THE FAILING SIDE).

lint_error_disposition() {
  local _rc="$1" _log="$2" _n="${3:-0}"
  if [[ "$_rc" == "0" ]]; then
    echo "✓ eslint: no errors in the ${_n} changed lintable file(s)"
    return 0
  fi
  if [[ "$_rc" == "1" ]]; then
    echo "✗ eslint reports ERRORS in the files this push changes (rc=1):"
    # stylish output: an unindented file-path line, then indented `L:C  error  message  rule` rows.
    # Two fixed-shape passes on purpose — one regex leading a wildcard into an alternation is the
    # backtracking shape grep-blowup-warn.sh refuses.
    # ⛔ UNCAPPED, and that is the rule, not a preference: a REFUSAL is one of the output kinds
    # bash-environment.md § READ COUNTS, NEVER A PIPED EXIT CODE says must never be capped — the
    # operator has to fix EVERY error to get past this gate, so a `head -10`/`head -30` hands them
    # a partial worklist and a second refusal they could have avoided.
    # The extension alternation is the same population as step 1b's filter and carried the same
    # `.mts` hole: capped or not, a `.mts` file header never printed.
    grep -v '^ ' "$_log" | grep -E '\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$' || true
    grep -E '^[[:space:]]+[0-9]+:[0-9]+[[:space:]]+error[[:space:]]' "$_log" || true
    if [[ "${SKIP_LINT_ERROR_GATE:-0}" == "1" ]]; then
      echo "  ⚠️  SKIP_LINT_ERROR_GATE=1 — NOT refusing. CI's lint job WILL fail on this and Vercel deploys before it reports."
      return 0
    fi
    echo "  CI's lint job is BLOCKING on these and Vercel deploys BEFORE CI reports — fix them, or"
    echo "  SKIP_LINT_ERROR_GATE=1 for a documented exception (say why in the push)."
    return 1
  fi
  echo "✗ eslint failed to RUN (rc=${_rc}) — an instrument failure is not a clean reading. Log: ${_log}"
  # ⛔ UNCAPPED for the same reason, and this branch is where a cap costs most: on a config-level
  # failure the ONE line naming the cause (a missing plugin, an unparseable config) can sit at
  # EITHER end of the merged stream, which is the measured shape behind the never-cap-a-refusal
  # rule. The log path stays printed above so the operator can re-read it after the hook exits.
  cat "$_log" 2>/dev/null || true
  if [[ "${SKIP_LINT_ERROR_GATE:-0}" == "1" ]]; then
    echo "  ⚠️  SKIP_LINT_ERROR_GATE=1 — NOT refusing."
    return 0
  fi
  return 1
}
