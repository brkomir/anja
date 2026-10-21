#!/usr/bin/env bash
# hook-liveness-record.sh — SAVED Layer-3 (hook-liveness) results, so a push that changes more hooks than the
# per-push gate will mutate (>5) can still be judged on each hook's own measured verdict.
#
# The design: run the liveness check on every
# changed hook ahead of time, save each result keyed by fingerprints, and have .githooks/pre-push's >5 branch
# read the saved results instead of refusing. A saved result counts only while EVERY fingerprint still matches
# the commit being gated; one changed byte in any of them and the hook reads as not checked.
#
# WHAT A RECORD PINS (git object ids at the gated commit, so a content change of any one voids it):
#   the hook file .claude/hooks/<hook> · the hook smoke suite scripts/smoke-test-hooks.sh · the instrument
#   scripts/smoke-mutation-matrix.sh · the shared hook code .claude/hooks/lib (a tree id).
# ⚠ NOT pinned: anything else a suite arm reads (another script it extracts, a fixture under tests/). A change
#   there can move a verdict while every fingerprint still matches. Re-run the check when such a change is
#   in the range; the record is a cache of a measurement, not a proof about code it never saw.
# ⚠ A record is local, untracked state (.claude/state is gitignored). Anyone who can write it can forge a LIVE
#   verdict: as REACHABLE as SKIP_HOOK_LIVENESS_GATE=1, but where that escape is spelled in the push command and
#   ledgered by pre-push, a forged record is consumed silently — so l3_record_disposition writes a fires-ledger
#   row naming the record (sha256 + its bytes) and the gated commit when a scanner passes on one
#   — best-effort, like every fires row: none when pre-push's _pp_run_fire is absent,
#   under HOOK_SMOKE_EXEC=1 without HOOK_FIRES_LOG_DIR (a variable the SKIP_* ledger does not record), or when
#   the ledger is unwritable or python3 is missing; and the ledger is local, so it traces a careless writer,
#   not a determined one. l3_record_state also refuses a record whose gated sha, timestamp or count is malformed; a forger
#   who copies a real record's shape still passes, which is why the ledger row exists.
#
# Record file: <dir>/<hook>.rec, ONE tab-separated line:
#   v1 <LIVE|UNGUARDED> <assertions-that-die> <hook-blob> <suite-blob> <matrix-blob> <hooks-lib-tree> <gated-sha> <utc>
# Writer: scripts/smoke-mutation-matrix.sh --gate <hooks> --record <absolute dir>, after its post-run control
# passes (a run that ends in any exit-3 refusal writes nothing). Reader: l3_record_state, used by
# l3_record_disposition in scripts/lib/prepush-l3-verdict.sh.

# l3_record_ids — prints the four current fingerprints, tab-separated, at HEAD of the repo in the cwd.
# A path HEAD lacks prints "missing" (a hook deleted by the push, a tree with no hooks lib).
l3_record_ids() {
  local _p _out=""
  for _p in scripts/smoke-test-hooks.sh scripts/smoke-mutation-matrix.sh .claude/hooks/lib; do
    _out="${_out}$(git rev-parse -q --verify "HEAD:$_p" 2>/dev/null || echo missing)"$'\t'
  done
  printf '%s\n' "${_out%$'\t'}"
}

# l3_record_write <dir> <hook> <LIVE|UNGUARDED> <count> — one record, written atomically (temp file + mv).
# Returns non-zero on any failure, so the caller can refuse rather than leave a partial record set.
l3_record_write() {
  local _dir="$1" _hook="$2" _verdict="$3" _n="$4" _hb _ids _sha _tmp
  case "$_verdict" in LIVE|UNGUARDED) ;; *) echo "l3_record_write: bad verdict '$_verdict'" >&2; return 2 ;; esac
  case "$_n" in ''|*[!0-9]*) echo "l3_record_write: bad count '$_n'" >&2; return 2 ;; esac
  _hb="$(git rev-parse -q --verify "HEAD:.claude/hooks/$_hook" 2>/dev/null)" || { echo "l3_record_write: $_hook is not at HEAD" >&2; return 2; }
  _ids="$(l3_record_ids)"; _sha="$(git rev-parse HEAD)" || return 2
  mkdir -p "$_dir" || return 2
  _tmp="$_dir/.$_hook.rec.$$"
  printf 'v1\t%s\t%s\t%s\t%s\t%s\t%s\n' "$_verdict" "$_n" "$_hb" "$_ids" "$_sha" "$(date -u +%FT%TZ)" > "$_tmp" \
    && mv -f "$_tmp" "$_dir/$_hook.rec" || { rm -f "$_tmp"; return 2; }
}

# l3_record_state <dir> <hook> <current-ids> — prints ONE line: "LIVE <n> <sha> <utc>", "UNGUARDED 0 <sha> <utc>",
# or "NOTCHECKED <reason>". <current-ids> is l3_record_ids' output (computed once by the caller).
l3_record_state() {
  local _dir="$1" _hook="$2" _ids="$3" _rec="$1/$2.rec" _cur_h
  local _ver _v _n _hb _sb _mb _lb _sha _ts _cs _cm _cl
  IFS=$'\t' read -r _cs _cm _cl <<< "$_ids"
  _cur_h="$(git rev-parse -q --verify "HEAD:.claude/hooks/$_hook" 2>/dev/null || echo missing)"
  if [[ "$_cur_h" == "missing" ]]; then echo "NOTCHECKED the hook is not present at the gated commit"; return 0; fi
  if [[ ! -f "$_rec" ]]; then echo "NOTCHECKED no saved result"; return 0; fi
  IFS=$'\t' read -r _ver _v _n _hb _sb _mb _lb _sha _ts < "$_rec" || true
  local _re_sha='^[0-9a-f]{40}$' _re_ts='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' _re_n='^(0|[1-9][0-9]*)$'
  if [[ "$_ver" != "v1" ]] || ! [[ "$_sha" =~ $_re_sha && "$_ts" =~ $_re_ts && "$_n" =~ $_re_n ]]; then
    echo "NOTCHECKED the saved result is unreadable"; return 0
  fi
  if [[ "$_hb" != "$_cur_h" ]]; then echo "NOTCHECKED stale: the hook changed after the saved result (${_sha:0:9})"; return 0; fi
  if [[ "$_sb" != "$_cs" ]]; then echo "NOTCHECKED stale: the hook smoke suite changed after the saved result (${_sha:0:9})"; return 0; fi
  if [[ "$_mb" != "$_cm" ]]; then echo "NOTCHECKED stale: the liveness check changed after the saved result (${_sha:0:9})"; return 0; fi
  if [[ "$_lb" != "$_cl" ]]; then echo "NOTCHECKED stale: .claude/hooks/lib changed after the saved result (${_sha:0:9})"; return 0; fi
  case "$_v" in
    LIVE) case "$_n" in ''|*[!0-9]*|0) echo "NOTCHECKED the saved result is unreadable" ;; *) echo "LIVE $_n ${_sha:0:9} $_ts" ;; esac ;;
    UNGUARDED) echo "UNGUARDED 0 ${_sha:0:9} $_ts" ;;
    *) echo "NOTCHECKED the saved result is unreadable" ;;
  esac
}
