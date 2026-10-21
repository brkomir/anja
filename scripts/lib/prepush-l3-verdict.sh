#!/usr/bin/env bash
# prepush-l3-verdict.sh — the Layer-3 (hook-liveness) verdict DISPOSITION for .githooks/pre-push.
#
# Extracted verbatim from the inline if/elif/else in .githooks/pre-push on 2026-08-26 so the suite can
# drive every branch with fixture logs (the scanner BLOCK had no arm at all while it was inline). This
# file is SOURCED by pre-push inside the Layer-3 block — after the smoke suite ran green, never at the
# top of the hook: `source` is a POSIX special builtin, so a lib that fails to parse aborts the whole gate
# under `set -e` before any check runs (the push-queue-lockout shape, bash-environment.md).
# The suite's `l3-verdict:` arms (scripts/smoke-test-hooks.sh) exercise it on every push.
#
# Usage:  l3_disposition <matrix-rc> <matrix-log-path> <changed-hook-list (one basename per line)>
#   returns 0 = push may proceed (LIVE, or WARN-mode), 1 = BLOCK. Prints the operator-facing lines.
#   Reads SKIP_HOOK_LIVENESS_GATE (1 = never block).

l3_disposition() {
  local _l3_rc="$1" _l3_log="$2" _l3_changed="${3:-}"
  if [[ "$_l3_rc" == "0" ]]; then
    echo "✓ Layer 3: every changed hook is mutation-LIVE (killing it reddens ≥1 assertion)"
  elif [[ "$_l3_rc" == "3" ]]; then
    echo "⚠ Layer 3 gate ERRORED (infrastructure, NOT a hook verdict) — baseline-not-green / an"
    echo "  uncommitted-or-staged matrix/suite edit / a worktree-add failure:"
    grep -E '⛔|BASELINE|UNCOMMITTED|dropped: ' "$_l3_log" || tail -10 "$_l3_log"
    # ── BROKEN-CHECK BLOCK for the scanner subset ──
    # The matrix names WHY it could not run (an `L3-CAUSE=` line). BASELINE-RED means the liveness check's
    # own suite is red at HEAD in isolation — a DURABLE, silent state, not a transient one, and it can
    # persist unnoticed for as long as it is mistaken for transient dirt. A scanner-hook push under
    # a broken check is exactly the unreviewed-leak path the block-mode subset exists for, so it BLOCKS.
    # Every other cause — DIRTY-TREE (a peer's uncommitted suite edit), WORKTREE-FAIL, SUITE-FLAKY,
    # SUITE-STATE-DEPENDENT, BAD-COUNT, BASELINE-EMPTY (the suite produced ZERO passing assertions, i.e. it did not run at
    # all — a broken HARNESS, not a red suite; blocking on it would manufacture the false push-block the matrix exists to
    # avoid), ISOLATION-FAIL (the live hooks CHANGED during a CLEAN inner run, by a before/after
    # fingerprint, so dirt already there passes — usually a peer's concurrent edit), ISOLATION-PRECHECK (that
    # fingerprint could not be read, so the inner never ran), NOT-ISOLATED (the inner was reached outside a linked
    # worktree) — is transient on a shared tree and stays WARN-mode: the original
    # fail-open reasoning holds for those. No cause line (an older matrix) reads as transient too — fail-open,
    # and say so. FIRST token wins, and that is safe BY CONSTRUCTION, not by observation:
    # every token is emitted in the same statement as its `exit 3`, so a process emits at most
    # one and terminates; the outer matrix emits only where the inner never ran (DIRTY-TREE, WORKTREE-FAIL,
    # ISOLATION-PRECHECK)
    # or ran CLEAN (ISOLATION-FAIL), never after the inner has emitted.
    local _l3_cause; _l3_cause="$(grep -oE 'L3-CAUSE=[A-Z-]+' "$_l3_log" | head -1 || true)"
    local _l3_scanner_changed; _l3_scanner_changed="$(printf '%s\n' "$_l3_changed" | grep -E '^(validate-no-secrets|scan-secrets-writes)\.sh$' || true)"
    if [[ "${SKIP_HOOK_LIVENESS_GATE:-0}" != "1" && "$_l3_cause" == "L3-CAUSE=BASELINE-RED" && -n "$_l3_scanner_changed" ]]; then
      echo ""
      echo "⛔ BLOCK — a SECRET SCANNER changed ($(printf '%s\n' "$_l3_scanner_changed" | paste -sd, -)) and the liveness check's OWN BASELINE IS RED:"
      echo "  the check that proves the scanner fires cannot run, so this push would ship an UNVERIFIED scanner —"
      echo "  the credential-leak path the block-mode subset exists for. This case is not rare: a red baseline"
      echo "  can persist unnoticed, so it is never let through as transient. Refusing this push."
      echo "  FIX: make the suite green at HEAD in isolation — 'bash scripts/smoke-mutation-matrix.sh --gate <hook>'"
      echo "  prints the red arms. Conscious override: SKIP_HOOK_LIVENESS_GATE=1 git push."
      return 1
    fi
    echo "  Fix the gate infra (commit the matrix/suite edit, or fix the suite) — the changed hook was"
    echo "  never actually tested. WARN-mode — NOT blocking (cause: ${_l3_cause:-not named by the matrix}; only"
    echo "  BASELINE-RED on a scanner push blocks). SKIP_HOOK_LIVENESS_GATE=1 silences."
  else
    echo "⚠ Layer 3: a changed hook is UNGUARDED (killing it fails NOTHING):"
    grep -E 'UNGUARDED|✅|not present' "$_l3_log" || tail -20 "$_l3_log"
    echo "  A green smoke suite does NOT prove this hook fires. Add a FIRE assertion that DIES when"
    echo "  the hook is killed (see the validate-no-secrets block in scripts/smoke-test-hooks.sh)."
    # ── SECRET-SCANNER BLOCK-MODE SUBSET ──
    # A DEAD secret scanner = a credential leak, so for
    # the 2 scanner hooks a CLEAN UNGUARDED verdict is a HARD BLOCK. General hooks stay WARN-mode —
    # blocking them trains the SKIP-reflex that then masks true corpses. Scope is deliberately the
    # scanner subset only. NOTE: an exit-3/infra refusal blocks a scanner push ONLY when its cause is
    # BASELINE-RED (the rc=3 branch above); the transient causes stay fail-open. Exit-3 is not assumed
    # transient on the premise that the tree is frequently dirty: a red baseline can be a durable
    # state. Emergency override: SKIP_HOOK_LIVENESS_GATE=1.
    if [[ "${SKIP_HOOK_LIVENESS_GATE:-0}" != "1" ]]; then
      scanner_unguarded="$(grep -E '(validate-no-secrets|scan-secrets-writes)\.sh.*UNGUARDED' "$_l3_log" || true)"
      if [[ -n "$scanner_unguarded" ]]; then
        echo ""
        echo "⛔ BLOCK — a SECRET SCANNER is UNGUARDED (block-mode subset):"
        printf '%s\n' "$scanner_unguarded" | sed 's/^/    /'
        echo "  Killing it fails NOTHING → the suite cannot prove the scanner fires → a dead scanner could"
        echo "  ship = a credential leak. Refusing this push."
        echo "  FIX: add a FIRE assertion that DIES when the hook is killed (the validate-no-secrets block"
        echo "  in scripts/smoke-test-hooks.sh is the reference). Conscious override: SKIP_HOOK_LIVENESS_GATE=1 git push."
        return 1
      fi
    fi
    echo "  WARN-mode for non-scanner hooks — NOT blocking. SKIP_HOOK_LIVENESS_GATE=1 silences."
  fi
  return 0
}

# l3_record_disposition <record-dir> <changed-hook-list (one basename per line)>
# The >5-hooks branch of the Layer-3 block. More hooks
# than the per-push gate mutates used to SKIP every one of them, and REFUSE outright when a secret scanner was
# among them (a scanner cannot ride the cost skip). Now each changed hook is judged on its
# SAVED result (scripts/lib/hook-liveness-record.sh), which counts only while every fingerprint still matches:
#   · a secret scanner refuses unless its saved result is fresh and LIVE (scanner liveness is block-mode,
#     unchanged; a missing or stale result is "unverified", which block mode never lets through);
#   · any other hook is NAMED when it is UNGUARDED or has no fresh result — WARN-mode, as it always was;
#     whether a dead non-scanner hook should block is the owner's open call, not settled here.
# Requires l3_record_state (source scripts/lib/hook-liveness-record.sh first): without it this REFUSES.
# Returns 0 = proceed, 1 = BLOCK. Reads SKIP_HOOK_LIVENESS_GATE (1 = never block).
l3_record_disposition() {
  local _dir="$1" _changed="$2" _ids _h _st _kind _rest _scanner
  local _n_live=0 _n_ung=0 _n_not=0 _block="" _lines=""
  if ! declare -F l3_record_state >/dev/null 2>&1; then
    echo "✗ Layer 3: the saved-result reader (scripts/lib/hook-liveness-record.sh) is not loaded — refusing."
    return 1
  fi
  _ids="$(l3_record_ids)"
  while IFS= read -r _h; do
    [[ -z "$_h" ]] && continue
    _st="$(l3_record_state "$_dir" "$_h" "$_ids")"; _kind="${_st%% *}"; _rest="${_st#* }"
    _scanner=0; [[ "$_h" =~ ^(validate-no-secrets|scan-secrets-writes)\.sh$ ]] && _scanner=1
    case "$_kind" in
      LIVE) _n_live=$((_n_live + 1))
            if [[ "$_scanner" == 1 ]]; then
              _lines="${_lines}  ✅ ${_h} LIVE — ${_rest%% *} assertion(s) die when it is killed (saved at ${_rest#* })"$'\n'
              # A scanner passing on a SAVED result leaves a ledger row naming the exact record: a forged
              # record is otherwise consumed with no trace, where SKIP_* is ledgered. Only
              # when pre-push's own _pp_run_fire is defined; the suite's extracted fixture has none.
              if declare -F _pp_run_fire >/dev/null 2>&1; then
                _pp_run_fire hook-liveness-saved-result used hook "$_h" gated "$(git rev-parse HEAD 2>/dev/null)" \
                  record_sha256 "$(shasum -a 256 < "$_dir/$_h.rec" 2>/dev/null | cut -d' ' -f1)" \
                  record "$(head -c 300 "$_dir/$_h.rec" 2>/dev/null | tr '\t' ' ')"
              fi
            fi ;;
      UNGUARDED) _n_ung=$((_n_ung + 1))
            _lines="${_lines}  ❌ ${_h} UNGUARDED — killing it fails NOTHING (saved at ${_rest#* })"$'\n'
            [[ "$_scanner" == 1 ]] && _block="${_block}${_h} (UNGUARDED) " ;;
      *) _n_not=$((_n_not + 1))
            _lines="${_lines}  ⚠ ${_h} not checked — ${_rest}"$'\n'
            [[ "$_scanner" == 1 ]] && _block="${_block}${_h} (${_rest}) " ;;
    esac
  done <<< "$_changed"
  echo "  Layer 3 from saved results ($_dir): ${_n_live} LIVE · ${_n_ung} UNGUARDED · ${_n_not} not checked"
  printf '%s' "$_lines"
  if [[ -n "$_block" && "${SKIP_HOOK_LIVENESS_GATE:-0}" != "1" ]]; then
    echo "✗ a SECRET SCANNER in this push has no fresh LIVE result: ${_block% }"
    echo "  Its liveness is BLOCK-mode: an unverified scanner cannot ship. Produce the result"
    echo "  from the shared checkout, with the push's commit at HEAD, in the background (about 1.5 h), then push again:"
    echo "    bash scripts/smoke-mutation-matrix.sh --gate validate-no-secrets.sh,scan-secrets-writes.sh --record \"\$(pwd -P)/.claude/state/hook-liveness\""
    echo "  Conscious override: SKIP_HOOK_LIVENESS_GATE=1 git push."
    return 1
  fi
  if [[ "$_n_ung" -gt 0 || "$_n_not" -gt 0 ]]; then
    echo "  WARN-mode for non-scanner hooks — NOT blocking. Saved results come from"
    echo "    bash scripts/smoke-mutation-matrix.sh --gate <hooks,csv> --record \"\$(pwd -P)/.claude/state/hook-liveness\""
  fi
  return 0
}
