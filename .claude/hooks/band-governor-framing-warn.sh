#!/usr/bin/env bash
# Pre-push WARN: a commit edits a band-governed rules file and justifies the edit
# with the ROW COUNT instead of a content reason.
#
# Prevents-NEW-class: band-governor-count-used-as-justification
#
# THE RULE IT ENFORCES (.claude/rules/active-recall.md): the Band-U row count is
# a WARN governor, never a cap.
#   "A qualified row is NEVER blocked by the row count, and the count is NEVER the
#    reason to fold, route or defer — say the content reason or add the row."
#
# WHY A HOOK, AT THE 10TH OCCURRENCE (the framing had by then been seen about ten
# times). The rule text is already correct and already carries its own
# five-times warning. A correction commit fixed the framing across SEVEN live
# surfaces. The behaviour reproduced anyway — 23 commits in 30 days carry it. A
# text layer that has been fixed seven times and still fires is saturated; that is
# what earns an enforce layer rather than a seventh tally mark.
#
# ⛔ WARN, NEVER BLOCK, and the reason is not timidity. A command/message
# matcher cannot separate USE from MENTION, and this token's mention-class is real
# and permanent: the rule text quotes it, corrections quote it to refute it
# (that correction commit is itself one), and this very hook's header contains it. A block would
# fire hardest on the people documenting the problem. Escape: SKIP_BAND_FRAMING_WARN=1
#
# ⚠️ MEASURED BEFORE SHIPPING, and the negative control FAILED — stated rather than
# papered over. The hook fires on the CORRECTION commit itself, via the
# adverb "cap-neutrally" inside a sentence describing the wrong behaviour. That is the
# permanent mention-class, not a tunable miss: shipping anyway, in warn, because the
# cost is one line of output and the alternative is no layer at all.
# Per-arm over 60 days: cap-neutral 24 · stays 3[0-9] 6 · no new row 3 · adds-no-row 0
# (that last arm was DROPPED — zero fires is dead weight, per-arm calibration).
#
# ⚠️ CALIBRATION IS NOT MINE. I am in this token's corpus — I committed two of
# tonight's occurrences and the codification, so my own output inflates the FP rate by
# construction. A seat outside this thread must read it. Fires are logged to
# .claude/logs/band-framing-fires.jsonl so that read comes from data, not memory —
# and per session-cadence.md, an un-narrated fire is UNCLASSIFIED, never a true positive.
#
# ✅ CALIBRATION RAN 2026-08-08 (fresh-context agent, no thread, briefed not to read the
# author's reasoning). VERDICT: 2/2 unique fires are FALSE POSITIVES; `cap-neutral` is
# structurally the fires-often-catches-little arm, because the relief ladder TEACHES that
# phrase as the correct label for a legitimate fold-in — so anyone following the rule and
# saying so trips it. RECOMMENDATION: **NO narrowing** (n=2; any narrowing that suppresses
# these would miss the real case) and **PERMANENT warn-mode**. Do not re-litigate promotion
# without NEW logged fires. It also found two defects in this file: the log was double-
# counting (sha-dedupe added — see below) and LOG was an unanchored relative path.
#
# ⚠️ AND A BOUND ON THAT CALIBRATION, disclosed by the agent unprompted: a fresh
# context is NOT frame-independent here, because the originally caught example is quoted in
# .claude/rules/active-recall.md and therefore arrives in EVERY agent regardless of brief.
# It compensated by classifying from the evidence (fires log, commit bodies) instead of the
# rule text. Any re-calibration must name that overlap in its brief.
#
# Wire-up: invoked from .githooks/pre-push. Args: $1 = BASE_REF
set -u
[ "${SKIP_BAND_FRAMING_WARN:-0}" = "1" ] && exit 0
# SHARED BASELINE (branching policy): origin/dev once it
# exists, origin/main before the cutover. The pre-push hook passes its own BASE_REF as $1.
SHARED_BASELINE="origin/main"
git rev-parse --verify --quiet 'origin/dev^{commit}' >/dev/null 2>&1 && SHARED_BASELINE="origin/dev"
BASE_REF="${1:-$SHARED_BASELINE}"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
LOG="$REPO_ROOT/.claude/logs/band-framing-fires.jsonl"

# Files whose row/char count is a GOVERNOR (warn), never a cap.
GOVERNED='\.claude/rules/active-recall\.md|\.claude/orchestrator/active-recall-orchestrator\.md'
# Count-as-justification phrasings. Deliberately narrow: a bare mention of the
# number is fine, it is the JUSTIFYING frame that is the defect.
FRAMING='cap-neutral|cap neutral|stays 3[0-9]|does not add a row|no new row|row count unchanged|without adding a row'

HITS=0
for SHA in $(git rev-list "${BASE_REF}..HEAD" 2>/dev/null); do
  git show --name-only --format='' "$SHA" 2>/dev/null | grep -qE "$GOVERNED" || continue
  MSG="$(git log -1 --format='%B' "$SHA")"
  printf '%s' "$MSG" | grep -qiE "$FRAMING" || continue
  HITS=$((HITS+1))
  if [ "$HITS" = "1" ]; then
    echo "" >&2
    echo "⚠️  BAND-GOVERNOR FRAMING (warn — nothing is blocked)" >&2
  fi
  echo "   $(git log -1 --format='%h %s' "$SHA" | cut -c1-88)" >&2
    # DEDUPE ON SHA — the hook re-scans BASE_REF..HEAD on EVERY invocation, so with an
    # unadvanced origin/main (this repo carries 2000+ unpushed commits) each fire is re-logged
    # on every push attempt. Measured 2026-08-07 by a fresh-context calibrator: 4 records were
    # 2 unique SHAs, each logged twice. This log IS the calibration corpus an out-of-thread
    # reader is routed to — so an inflated count is not cosmetic, it hands the calibrator a
    # fabricated rate, in the direction that argues the hook fires more than it does.
    if [ -f "$LOG" ] && grep -qF "\"sha\":\"$SHA\"" "$LOG"; then continue; fi
  mkdir -p "$(dirname "$LOG")" 2>/dev/null
  printf '{"sha":"%s","subject":%s}\n' "$SHA" "$(git log -1 --format='%s' "$SHA" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))')" >> "$LOG" 2>/dev/null
done

if [ "$HITS" -gt 0 ]; then
  cat >&2 <<'MSG'
   The row count is a WARN governor, not a cap. It is never
   the reason to fold, route or defer — and "cap-neutral" as a VIRTUE is the same
   substitution wearing a compliment: it declines nothing, so nothing alarms.
   THE TEST: can you state the reason WITHOUT mentioning the number?
     yes -> say that instead (trigger-family overlap; amends that row's own action)
     no  -> it is a ROW. Add it and record the breach; that is the sanctioned outcome.
   If this fired on a MENTION (a correction, a doc, this warning), it is a known
   false positive — the matcher cannot tell use from mention. Ignore and move on.
MSG
fi
exit 0
