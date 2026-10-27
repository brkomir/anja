#!/usr/bin/env bash
# hub-stale-request-poll.sh — emits ONLY when a review request has been open past
# THRESHOLD_MIN. Silent otherwise. Armed as a persistent Monitor by the review hub.
#
# WHY THIS EXISTS. The hub's characteristic failure is not MISSING a request — the mail
# listener surfaces every one on arrival. It is ACKING one and never starting it, because an
# ack FEELS like a disposition. Measured 2026-09-02: one fold-verify sat 4h35m until its
# sender chased it, and the hub twice reported its own queue to the owner instead of working
# it. `review-request-closure-scan.mjs` already computed the answer; nothing ran it on a
# timer, so it only fired when someone remembered to look. This is that timer.
#
# A 5-10 MINUTE PING IS THE OBVIOUS DESIGN AND THIS DELIBERATELY DOES NOT DO THAT. The
# deviation is named here so nobody "fixes" it back. A fixed-interval queue dump fires ~12x
# an hour with the SAME rows between ticks, because nothing changes in five minutes. That
# habituates the reader, and a habituated alarm is the exact mechanism of the miss it exists
# to catch. So: CHECK on a 5-10 minute cadence (the caller's sleep, 600s), SPEAK only on
# STALENESS (25m default). The reader gets the responsiveness; the signal keeps its meaning.
# If you widen this to emit every open row on every tick, you have rebuilt what does not work.
#
# ⛔ THE OVER-REPORT CLAUSE THAT STOOD HERE WAS FALSE WHEN IT WAS WRITTEN, AND ITS DIRECTION
# WAS THE HARMFUL ONE. It said a sha cited as CONTEXT "reads OPEN here". It does not: an
# earlier scan change (09-02 22:46) split context-only shas into a separate
# `ℹ️  CONTEXT-ONLY` tier and gated the OPEN print on rows with unanswered shas -- 69 minutes
# BEFORE this script was authored. Measured on the live store the same day: 0 OPEN rows, 24
# CONTEXT-ONLY, and the grep below cannot match the CONTEXT-ONLY tier at all. So every fire of
# this poller is a sha a requester named as a TARGET that no verdict has named -- usually, not
# always, a review owed: on 2026-10-24 it fired for 2h, the hub's own ledger
# commit cited as a base. Read the row, never discount it. The retired clause trained its only reader to
# discount fires as probable noise -- habituation-by-documentation, the exact mechanism the
# DO-NOT paragraph below exists to prevent.
#
# WHAT IT DOES INHERIT IS AN UNDER-REPORT, AND THAT IS THE DANGEROUS DIRECTION. Per the scan's
# own retraction block (review-request-closure-scan.mjs:44-53 and its DO-NOT-NARROW note): one
# ANSWERS token anywhere in a mail body marks EVERY sha in that mail answered, so a mail whose
# sentence DENIES that a verdict was sent still closes the row. This poller then never fires --
# which is the 4h35m miss it was built for. A fire is a prompt to look; SILENCE IS NOT PROOF.
#
# CONTROL-TESTED BEFORE ARMING, both directions: HUB_STALE_MIN=1 printed four real rows with
# ages; HUB_STALE_MIN=99999 printed nothing. A poller that has only ever been silent proves
# nothing, which is why the loud arm ran first.
#
# ⛔ IT MEASURES *OPEN*, NOT *IDLE* — and its own message said otherwise until 2026-09-03.
# The row clears when a VERDICT names the shas, so a request with two lenses actively running
# reads EXACTLY like one nobody has touched. Measured on its second-ever fire: it named a
# request at 41m that had been started at 12m, under a message reading "start or re-position
# them" — which were already started. The predicate was right and the imperative was wrong,
# which is the failure class a night of review kept finding in OTHER seats' instruments.
# The message now states the measurement and names the ambiguity instead of prescribing
# through it. ⚠️ DO NOT "fix" this by suppressing rows that have a dispatch after the request
# timestamp: the dispatch log carries no completion field, so a lens that DIED (two did
# tonight, on a session rate limit) would suppress its own row and the alarm would fail
# silent in the one direction that costs work.
set -uo pipefail
REPO="${CLAUDE_PROJECT_DIR:-<repo-path>}"
# ⛔ LOUD, AND IT SITS 18 LINES ABOVE THE GATE BELOW — which is why an earlier commit body was
# 3/4 true and reached the owner as 4/4. That body listed a failed cd among four causes the new
# sentinel gate had made loud; three were, and this one exits BEFORE the gate can run. Its shell
# error goes to STDERR, which the Monitor discards: measured stdout 0 bytes, stderr 108.
# ⚠️ CLAUDE_PROJECT_DIR is UNSET in the hub's own shell, so the hardcoded fallback is what is
# load-bearing today — a worktree or a machine change fires this.
cd "$REPO" || { printf '🔴 STALENESS POLLER BLIND — cannot cd to %s.\n   SILENCE FROM THIS POLLER IS NOT A CLEAN QUEUE RIGHT NOW.\n' "$REPO"; exit 0; }
THRESHOLD_MIN="${HUB_STALE_MIN:-25}"
# A non-integer threshold makes the [ -ge ] below throw, && short-circuits, and the alarm dies
# SILENT under a Monitor that captures stdout only. One operator typo, no alarm.
# ⛔ THE `??????????*` ARM IS THE >=10-DIGIT CASE, and it closes a hole INSIDE this guard's own
# stated threat model: a DIGIT-ONLY value above INT64_MAX passes the non-digit arm and then makes
# `[ -ge ]` throw `integer expression expected` on stderr — verbatim the silent-under-a-Monitor
# death the comment above claims to prevent. Measured: 25 fires (264 bytes), 10^20 and
# INT64_MAX+1 both emit 0 bytes on stdout. INT64_MAX itself compares fine; +1 throws.
# (Reachability is low — a pasted token or `HUB_STALE_MIN=$(…)`.)
case "$THRESHOLD_MIN" in
  ''|*[!0-9]*|??????????*)
    printf '🔴 STALENESS POLLER MISCONFIGURED — HUB_STALE_MIN=%s is not an integer.\n   The alarm is DEAD until this is fixed; silence below means nothing.\n' "$THRESHOLD_MIN"
    exit 0 ;;
esac
LOOP_BLOCK=""
# ── SECOND AXIS: peers holding the last word ──────────────────────────────────────────────
# ⛔ EVERYTHING ABOVE MEASURES ONE AXIS AND IT IS THE BIASED ONE. The closure scan keys on the
# SHA: a request closes when some outbound names it, so a HOLD, an ACK or an INTERIM that names
# the sha reads ANSWERED (the scan's own header: "ANSWERED IS NOT HANDLED"), and an inbound
# naming NO sha -- a ping, a question, an owner directive relayed by a peer -- is not in the
# request set at all and can never read open. This poller therefore inherited a blind spot it
# could not see past, and its own header already says so about the under-report.
#
# MEASURED 2026-09-06, which is why this block exists: the SHA axis fired on 2 rows while SIX
# peers held the last word, the oldest at 25 HOURS, and two separate live peers had to be told
# by hand to ping the hub because they were waiting on replies this poller was structurally
# incapable of flagging. A peer chasing you through the owner is this alarm's failure, not the owner's
# service.
#
# THRESHOLD IS MEASURED, NOT PICKED. Replaying 599 inbound events over the whole mail store, the
# count of peers ever crossing the loop threshold reads 10 / 10 / 7 / 7 / 6 at 15 / 30 / 45 / 60
# / 120 minutes. Flat from 45 to 120, a jump below it -- the ages are bimodal (normal in-flight
# work vs genuinely stranded), so 45 is a real knee. ⚠️ That replay counts DISTINCT PEERS EVER
# CROSSING, which sizes the population; it is NOT a per-tick fire rate and must not be quoted as
# one. Re-measure before moving this number.
LOOP_MIN="${HUB_LOOP_MIN:-45}"
case "$LOOP_MIN" in
  ''|*[!0-9]*|??????????*)
    LOOP_BLOCK=$(printf '🔴 LOOP AXIS MISCONFIGURED — HUB_LOOP_MIN=%s is not an integer.\n   That axis is DEAD until this is fixed; silence below covers the SHA axis only.\n' "$LOOP_MIN")
    LOOP_MIN="" ;;
esac
if [ -n "$LOOP_MIN" ]; then
  # Same fail-loud contract as the scan gate above: this script's whole promise is that silence
  # means clean, so every way the loop tool can fail to ANSWER must be loud. It prints its own
  # terminal "FLOOR, not a count" line on every successful run -- gate on that, never on rc.
  loop_raw=$(python3 "${HUB_LOOP_TOOL:-scripts/hub-unfinished-loops.py}" --min-age-min "$LOOP_MIN" 2>&1); loop_rc=$?
  if ! printf '%s' "$loop_raw" | grep -q 'FLOOR, not a count'; then
    LOOP_BLOCK=$(printf '🔴 LOOP AXIS BLIND — hub-unfinished-loops.py did not FINISH its report (rc=%s).\n   SILENCE ON UNANSWERED PEERS IS NOT A CLEAN QUEUE RIGHT NOW. First lines:\n%s\n' \
      "$loop_rc" "$(printf '%s' "$loop_raw" | head -3)")
  else
    loop_rows=$(printf '%s' "$loop_raw" | grep -E '^  [0-9a-f]{8} ' || true)
    if [ -n "$loop_rows" ]; then
      LOOP_BLOCK=$(printf '🔴 PEERS HOLDING THE LAST WORD PAST %sm — a DIFFERENT axis from the rows above, and\n   a row here can be absent there: a verdict that named the sha closed that row while the\n   conversation stayed open. Read the rows; a courtesy ack is not a loop.\n%s\n' \
        "$LOOP_MIN" "$loop_rows")
    fi
  fi
fi

# ⛔ COMPUTED **HERE**, ABOVE BOTH EARLY EXITS, AND THAT PLACEMENT IS THE WHOLE POINT. It first
# shipped at the tail, below the empty-scan-output exit and below the no-hits-and-nothing-skipped
# exit -- so on a QUIET SHA axis, which is the normal state and exactly when this axis matters
# most, the script returned before reaching it. A four-arm control caught it: fire / silent /
# broken-tool / bad-threshold all produced BYTE-IDENTICAL output, and two arms that agree
# measured nothing. Every early return below must emit "$LOOP_BLOCK" first.
# ⚠️ This comment DESCRIBES those two exit lines rather than quoting them: the first version
# quoted them verbatim and the quotation collided with the edit's own anchor.

now=$(date -u +%s)
# ⛔ THIS SCRIPT'S WHOLE CONTRACT IS "SILENCE MEANS CLEAN", SO EVERY WAY THE SCAN CAN FAIL TO
# ANSWER MUST BE LOUD. The retired one-liner piped the scan
# through grep with 2>/dev/null and || true, which ate stderr, ate the rc, AND defeated the
# pipefail set above -- so an unset CLAUDE_CODE_SESSION_ID (the scan REFUSES, exit 2, so a seat
# cannot read another's queue), a missing node, a broken git (the scan prints its own "Not a
# clean queue" line, which the OPEN-grep filters out), all produced empty output and rc=0,
# i.e. a clean bill of health. Gate on the scan's always-printed sentinel, not on rc: rc=2 is
# also its legitimate positive-control exit, so rc alone cannot discriminate.
# ⛔ GATE ON THE **TERMINAL** SENTINEL, NEVER A PREFIX ONE. This read
# `requests found` until a later fix — a line the scan prints at :735, while the `⚠️  OPEN` rows this
# poller exists to surface print at :755, in a loop that runs AFTER. So the gate certified "the
# scan reached its summary", never "the scan finished reporting", and `rc` is discarded the moment
# the sentinel matches (its only uses are inside this branch). Measured over one store with 17
# genuinely open rows: scan completes -> fires all 17; scan dies right after :735 -> 0 bytes on
# stdout, 17 unanswered requests, oldest 70 hours. `set -e` does NOT rescue it.
# The scan's own footer at :835 sits immediately before `process.exit(0)` and :735 always precedes
# it, so this is strictly stronger. Bonus: the scan's `⛔ CONTROL FAILED` exit-2 path used to
# produce a normal-looking fire with its banner discarded; it now reads BLIND, which is what that
# path asks for. ⚠️ If you change the scan's closing text, change this literal in the same commit.
# HUB_STALE_SCAN exists so this is testable at all — the hardcoded path is why it had no test.
raw=$(node "${HUB_STALE_SCAN:-scripts/review-request-closure-scan.mjs}" 2>&1); rc=$?
if ! printf '%s' "$raw" | grep -q 'NOT a queue verdict'; then
  printf '🔴 STALENESS POLLER BLIND — the closure scan did not FINISH its report (rc=%s).\n   SILENCE FROM THIS POLLER IS NOT A CLEAN QUEUE RIGHT NOW. First lines:\n%s\n' \
    "$rc" "$(printf '%s' "$raw" | head -3)"
  exit 0
fi
out=$(printf '%s' "$raw" | grep -E '⚠️  OPEN' || true)
[ -z "$out" ] && { [ -n "$LOOP_BLOCK" ] && printf '%s\n' "$LOOP_BLOCK"; exit 0; }
# ⛔ COUNT WHAT YOU DROP. Every `continue` below discards a row this poller was supposed to
# evaluate, and a fire ESTABLISHES TRUST IN ITS OWN LISTING — so a partial fire was
# indistinguishable from a complete one, and a fire naming 2 of 4 rows said nothing about the 2
# it dropped (measured on a fixture). A negative age is the third drop: it silently fails `-ge`
# with no arm of its own. ⚠️ LATENT, NOT LIVE — all 1490 mails today carry exactly one
# well-formed ISO `created:`, because session-manifest.py writes strftime on a tz-aware UTC now.
# It is latent in the one direction with no tell, which is why it is counted rather than trusted.
# (`|| continue` does NOT catch every bad date: BSD `date -j -f`
# NORMALIZES 2026-02-30 to 2026-03-02 at rc=0 rather than refusing.)
hits=""; skipped=0
while IFS= read -r line; do
  ts=$(printf '%s' "$line" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z' | head -1)
  if [ -z "$ts" ]; then skipped=$((skipped + 1)); continue; fi
  epoch=$(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$ts" '+%s' 2>/dev/null) || { skipped=$((skipped + 1)); continue; }
  age=$(( (now - epoch) / 60 ))
  if [ "$age" -lt 0 ]; then skipped=$((skipped + 1)); continue; fi
  [ "$age" -ge "$THRESHOLD_MIN" ] && hits="${hits}  ${age}m open · ${line#*OPEN  }"$'\n'
done <<< "$out"
# ⛔ SILENCE IS ONLY EARNED WHEN NOTHING WAS DROPPED — a skipped row with no hits used to exit 0,
# which is this script's contract failing in exactly the direction its header forbids.
[ -z "$hits" ] && [ "$skipped" -eq 0 ] && { [ -n "$LOOP_BLOCK" ] && printf '%s\n' "$LOOP_BLOCK"; exit 0; }
[ -n "$hits" ] && printf '🔴 NO VERDICT SENT PAST %sm — this measures OPEN, not IDLE: a request with lenses\n   RUNNING reads the same as one nobody started. Check which, then send the verdict or\n   start it. An ack is not a disposition:\n%s' "$THRESHOLD_MIN" "$hits"
[ "$skipped" -gt 0 ] && printf '⚠️  %s OPEN row(s) had an unreadable or future-dated timestamp and were NOT evaluated.\n   The listing above is NOT a complete answer to "what is stale".\n' "$skipped"

[ -n "$LOOP_BLOCK" ] && printf '%s\n' "$LOOP_BLOCK"
exit 0
