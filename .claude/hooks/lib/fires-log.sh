# fires-log.sh — append ONE JSONL fire record for a hook. Sourced, never executed.
#
# WHY THIS EXISTS. A hook that denies and keeps no record of the deny cannot be calibrated: a per-arm
# false-positive rate needs a corpus, and every promote/demote argument in this repo leans on one
# (session-cadence.md § READING A GUARD'S FIRES). At 2026-09-13 two deny-capable hooks still wrote
# nothing — block-dangerous.sh and warn-large-tracker-read.sh. The append idiom they needed already existed
# inline in three hooks (bash-safety-warn.sh, block-push-without-approval.sh, grep-blowup-warn.sh), and
# the review that saw the third named a fourth copy as the extraction trigger. This is that extraction.
# The three inline copies are NOT migrated onto it here: that is a structural tidy and belongs in its own
# commit. ⚠️ They are not interchangeable with it either: grep-blowup-warn.sh writes different keys and
# interpolates two of them raw through printf, so a migration changes what that log holds.
# ⛔ THE DECLINE IS RIGHT AND ITS ORIGINAL SECOND REASON WAS WRONG — CORRECTED 2026-09-13.
# This said "the push guard cuts `arm` at 90 bytes where this cuts at 400 characters, so a
# migration changes what those logs hold." THE 90-BYTE CUT CANNOT BITE: the longest `arm` value that
# hook can emit is `jq-absent-fail-closed`, 21 bytes, and every other field it writes is well under the
# cap too. A reader who checks that reason disproves it in one command, concludes the decline was
# unfounded, migrates — and hits the real blocker with five red arms and no warning. **A right decision
# recorded with a refutable reason is worse than no note at all**, because it spends its own credibility.
# ⭐ THE BLOCKER THAT ACTUALLY HOLDS, and it was never written down: the smoke suite EXPORTS the log-dir
# override GLOBALLY, and this library reads that override BEFORE the project-dir knob. A migration would
# therefore redirect the later arms' writes to the suite-wide path while those arms still assert on the
# old one — REDding five arms that have nothing wrong with them. Whoever migrates must re-point those
# assertions in the same commit, or scope the export. (The live arm asserting a prose value is NOT a
# blocker: this library writes that value verbatim, so it survives a migration untouched.)
#
# USAGE — from the DENY PATH, inside a SUBSHELL, with every value braced (see WHERE TO SOURCE):
#     _x_fire() {
#       ( fires_log() { :; }   # fallback: an unloadable lib degrades to NO RECORD, never to a broken deny
#         . "$(dirname "${BASH_SOURCE[0]}")/lib/fires-log.sh"
#         fires_log <stem> "$@"
#       ) >/dev/null 2>&1 || true
#     }
#     _x_fire sid "${sid:-}" agent_id "${agent_id:-}" arm <ascii-slug> cmd "${cmd:-}"
#   appends {"ts":"<UTC>","sid":"...","agent_id":"...","arm":"...","cmd":"..."} to <logs dir>/<stem>-fires.jsonl
#   Arguments after <stem> are KEY VALUE pairs, written in order after "ts". A dangling key is dropped, and
#   so is a caller key named "ts": the timestamp is always this library's.
#   COUNTING: `grep -cF '"arm":"<slug>"'` counts one arm's records, and only when <slug> is ASCII. json.dumps
#   escapes every non-ASCII character to \uXXXX (the corpus convention: no fires log here stores raw
#   non-ASCII), so an arm spelled with an em-dash is `—` on disk and a grep for the rendered text reads 0.
#   Keep `arm` an ASCII slug and put prose in its own key. Separators are COMPACT, as in the inline copies'
#   printf, so that idiom matches; python's default `", "` / `": "` would zero it too.
#
# CONTRACT — total, because every caller is a live gate and a hook that aborts mid-deny is worse than
# one that denies without a record:
#   * writes NOTHING to stdout or stderr. The harness discards a hook's stdout wholesale unless it is
#     exactly one JSON document, so a stray byte from here would delete the deny it is recording.
#   * always returns 0. No python3, an unwritable directory or a bad stem each mean no record, never
#     a failure the caller can see.
#   * <stem> is letters, digits, dot, underscore and hyphen, and may not start with a dot, so a caller
#     cannot write outside the logs directory.
#   * values travel NUL-separated on a PIPE, never in argv or the environment: a Bash command can be
#     megabytes, and argv plus environment caps at about 1 MB here. Each value is cut to 400 characters
#     AFTER decoding, so the cut never splits a multibyte character (the inline copies cut with
#     `head -c`, which can).
#   * the ENCODED line, newline included, is at most 1,023 B (CAP). A longer one keeps the LARGEST prefix of its
#     longest value that still fits, found by binary search over CHARACTERS and re-encoded at each step, so the
#     line stays valid JSON whatever an escape costs. ⚠️ Do NOT subtract the byte overflow from a character
#     count: one U+26D4 is 6 B on disk, so that arithmetic emptied a 400-character value the smoke arm expected
#     cut to ~160 — it shipped in this fold's first draft and the arm is what caught it.
#   * the line reaches the log in ONE write() on an O_APPEND descriptor, made by python. The first version
#     appended with bash's printf, which goes through stdio and splits a line of 1,024 B or more into
#     several writes that concurrent appenders can interleave (measured below). CAP keeps a line under
#     that size as well, so neither mechanism is load-bearing alone.
#     MEASURED 2026-09-13, 8 concurrent writers x 10 records, 3 trials per size, malformed lines of 240:
#     <<H:ATOMIC-TABLE>>
#
# WHERE RECORDS GO — two locations, in order. The first is honoured by THIS LIBRARY ONLY:
#   1. $HOOK_FIRES_LOG_DIR when it is set. This file is its only consumer: the three inline copies derive
#      their directory from CLAUDE_PROJECT_DIR and never read it, so exporting it redirects nothing but the
#      hooks that record through here. scripts/smoke-test-hooks.sh exports it once, at its top, to a
#      throwaway directory it removes on exit, so the fixture arms that drive these hooks never write into
#      the real calibration corpus — the same shape as its SECRET_SCAN_FIRES_LOG export. It is needed: on
#      2026-09-13, 50 of the 51 records in the push guard's fires log were that suite's own push
#      fixtures, because that log was wired without one.
#   2. otherwise ${CLAUDE_PROJECT_DIR:-<git toplevel>:-<pwd>}/.claude/logs — the ladder the inline copies
#      use, and the root an arm pins to a fixture when it asserts that a write happened.
#
# WHERE TO SOURCE — inside a subshell on the deny path, as USAGE shows, never in the hook's own shell.
# A library that still PARSES can end the shell that sources it, and `bash -n` passes both shapes that do:
# a trailing `exit 0`, and a read of an unset variable under the hooks' `set -u`. Sourced in the hook's own
# shell, either one ends the hook with rc 0 or rc 1 and nothing on either channel — ALLOW on a PreToolUse hook,
# where the deny was the whole point: a sourced library that ends the shell turns a deny into an allow and
# writes no record. So source it in a subshell: the subshell confines the outcome to the child, so the
# hook's decision is whatever it was before the call; `>/dev/null 2>&1` keeps a library that prints off
# stdout, where a second document beside the deny deletes the deny; `|| true` keeps a failing child from
# mattering under `set -e`. Errexit needs no suspending around the source for the same reason. The only
# cost is one fork per RECORD: one per DENY on the guards that log denies alone (their allow paths never reach this), and since 2026-10-09 one per in-scope RUN on the run-ledger sites (bash-safety-warn, grep-blowup-warn and 13 more — one row per run, clean included, ~36 ms measured), whose allow paths DO reach this — <<H:FORK-COST>>.
# What the subshell CANNOT contain, both deliberate limits:
#   * an unset variable expanded at the CALL SITE. Arguments are expanded in the hook before the subshell
#     exists, so `_x_fire key "$UNSET"` still ends the hook with rc 1 (measured). Brace every value: `${v:-}`.
#   * a library that never returns: the hook waits for its child.
fires_log() {
  {
    local _fl_stem="${1-}" _fl_dir
    case "$_fl_stem" in ''|.*|*[!A-Za-z0-9._-]*) return 0 ;; esac
    shift
    command -v python3 || return 0
    if [ -n "${HOOK_FIRES_LOG_DIR:-}" ]; then
      _fl_dir="$HOOK_FIRES_LOG_DIR"
    else
      _fl_dir="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.claude/logs"
    fi
    printf '%s\0' "$@" | python3 -c 'import json, os, sys, time
CAP = 1023
parts = sys.stdin.buffer.read().split(b"\0")[:-1]
rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
for i in range(0, len(parts) - 1, 2):
    key = parts[i].decode("utf-8", "replace")[:64]
    if key != "ts":
        rec[key] = parts[i + 1].decode("utf-8", "replace")[:400]
def enc():
    return (json.dumps(rec, separators=(",", ":")) + "\n").encode("ascii")
line = enc()
while len(line) > CAP:
    keys = [k for k in rec if k != "ts"]
    if not keys:
        sys.exit(0)
    big = max(keys, key=lambda k: len(json.dumps(rec[k])))
    val = rec[big]
    if not val:
        del rec[keys[-1]]
    else:
        lo, hi = 0, len(val)
        while lo < hi:
            mid = (lo + hi + 1) // 2
            rec[big] = val[:mid]
            if len(enc()) <= CAP:
                lo = mid
            else:
                hi = mid - 1
        rec[big] = val[:lo]
    line = enc()
os.makedirs(sys.argv[1], exist_ok=True)
fd = os.open(os.path.join(sys.argv[1], sys.argv[2]), os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
try:
    os.write(fd, line)
finally:
    os.close(fd)' "$_fl_dir" "$_fl_stem-fires.jsonl" || return 0
  } >/dev/null 2>&1
  return 0
}
