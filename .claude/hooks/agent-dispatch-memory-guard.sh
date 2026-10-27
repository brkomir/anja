#!/usr/bin/env bash
# PreToolUse hook (Agent matcher) — memory FLIGHT RECORDER + thrash gate.
#
# Background (2026-07-29, second deep-pass OOM):
#   Two /wrap deep-pass agent fan-outs drove "Memory Used" to ~115 GB on a 36 GB
#   machine (compressor + swap at ~3.2x physical). THREE post-mortems in a row
#   blamed the wrong mechanism — slice bytes, then regex backtracking, then
#   per-process footprint — each falsified by measurement, because peak memory
#   is gone the moment the processes exit and NOTHING recorded it. A spec-layer
#   fix (wrap SKILL.md ceiling 6->3 + sampler) protects only the session whose
#   orchestrator reads it. This hook is the structural layer: it fires for EVERY
#   session in this repo on EVERY Agent dispatch, no instruction-reading required.
#
# What it does, in order:
#   1. FLIGHT RECORDER (always): append one JSON line to
#      .claude/logs/agent-dispatch-memory.jsonl — timestamp, session, swap used,
#      compressor size, top-5 RSS processes, agent description. When the next
#      incident happens, the investigation reads a log instead of guessing.
#   2. THRASH GATE (deny): if swap + compressor exceed the threshold, DENY the
#      dispatch with a reason telling the orchestrator to serialize instead.
#      THRESHOLD 30 GB (applied through
#      scripts/memguard-recalibrate.py, settings.json env FF_AGENT_MEMGUARD_THRESHOLD_GB);
#      24 GB until then, raised from 18. The posture was
#      now explicitly CRASH-CLASS-ONLY: the guard exists to stop the OOM regime,
#      not to throttle routine dispatch.
#
#      MEASURED AT THE RAISE on the STAMPED-REAL subset (synthetic:false,
#      parse-clean) — n=611, the only trustworthy slice of this log:
#        min 4.32 / p50 9.03 / p90 16.72 / p95 17.19 / p99 19.98 / MAX 20.74 GB
#        18 GB -> 19 denies (3.1%)  ·  22 GB -> 0  ·  24 GB -> 0
#      At the raise 24 had never fired in the observed window, and the intent
#      was that below the crash class this guard would be inert.
#
#      ⛔ THAT IS NO LONGER TRUE, AND THIS HEADER ASSERTED IT UNTIL 2026-09-20.
#      Re-derived from THIS log with the header's own prescribed filter (drop
#      synthetic:true, drop agent names prefixed "smoke"): 8,712 real records,
#      **134 denies at >=24 GB across 28 distinct days**, first 2026-07-30T20:51Z,
#      latest 2026-09-20T19:53Z. One session took 4 of them in two days,
#      including two inside a single /wrap. So 24 GB is a LIVE threshold that fires
#      on ordinary multi-agent waves, not a crash-class-only backstop -- and a
#      threshold argument that quotes "inert by design" is quoting a dated reading
#      as a current property. Re-derive before citing; do not restate 134 either.
#
#      ⚠️ AND A FIRING IS NOT BY ITSELF EVIDENCE OF REAL PRESSURE: swap+compressor
#      is a LAGGING pair. Measured at the 2026-09-20 19:53Z deny -- 24.72 GB against
#      `memory_pressure -Q` reading 56% free with the largest process at 1.21 GB.
#      Check live pressure before shrinking a wave or asking the owner to close apps.
#
#      ⚠️ FILTER OR THE NUMBERS LIE.
#      713 records PREDATE the synthetic stamp and ~293 of those are
#      smoke fixtures injected at fixed values (40.0 x76, 2.0 x50, 0.0 x47).
#      Unfiltered, this same log reads p95 = 40.00 — a FIXTURE VALUE, not a
#      measurement. Any figure quoted from this log MUST say whether it was
#      filtered; the numbers above are stamped-real only.
#
#      WHAT 24 GIVES UP, honestly: the 19 stamped-real denies between 18 and
#      20.74 GB, incl. a legitimate breaker dispatch blocked at 19.29 GB on
#      2026-08-03 — the event that prompted the raise. The prior header rejected
#      22 for "dropping genuine catches at 19.8-20.0"; those readings are real,
#      but nothing established that those dispatches would have caused harm —
#      above-threshold is not the same as damaging.
#
#      WHAT IT KEEPS is ARITHMETIC, NOT MEASUREMENT — say it that way. The
#      45-49 GB deep-pass cluster (07-31 07:02Z) and the ~80 GB incident regime
#      PREDATE the synthetic stamp, so they are absent from the n=611 window
#      above and cannot be re-measured from it. 24 < 45 < 80, so those events
#      would still deny; that is inference from the bound, not an observation.
#      Margin vs the ~80 GB incident regime: ~3.3x (was ~4.4x at 18).
#
#      HISTORY (superseded, kept so nobody re-derives it): 15 -> 18
#      against 242 samples; the original block-mode waiver premise
#      ("baseline ~4.5 GB, FP ~0") was REFUTED by the flight record — do not
#      restore it. One deny at 16.55 GB was tagged "serial": a seat that honored
#      a deny, re-ran serially, and was denied AGAIN — serializing cannot lower
#      AMBIENT pressure, so "just run serially" is not always an escape.
#      NOTE the recorder LAGS under load: the 45-49 GB cluster was stamped
#      07:02Z and not yet written when the distribution was read at 07:16Z, so
#      any percentile computed DURING a pressure event under-represents it.
#
# Design decisions:
#   - FAIL-OPEN on measurement failure (this is a resource guard, not a security
#     gate; a parse quirk must not block all agent work). A parse failure is
#     still logged with "parse_error": true so the recorder shows the gap.
#   - Darwin-only (vm_stat / sysctl vm.swapusage are macOS). Non-Darwin: exit 0.
#   - Escape: SKIP_AGENT_MEMORY_GUARD=1 (documented, greppable).
#   - Test injection: FF_AGENT_MEMGUARD_FAKE_PRESSURE_GB overrides the measured
#     pressure so the smoke test can exercise the deny branch deterministically.
#   - Page size READ from vm_stat, never assumed (Apple Silicon = 16384).
#
# Companion layers:
#   - .claude/skills/wrap/SKILL.md 1b-DEEP (concurrency ceiling 3 + RSS sampler)
#   - .claude/logs/agent-dispatch-memory.jsonl (gitignored diagnostics)

set -u
[ "${SKIP_AGENT_MEMORY_GUARD:-}" = "1" ] && exit 0
[ "$(uname)" = "Darwin" ] || exit 0

# LOCALE PIN (post-mortem, folded 2026-07-30, repro'd live): a comma-decimal ambient
# locale (de_DE — and sr_RS region formats the same way) makes `sysctl -n vm.swapusage`
# emit "used = 3515,19M" — the [0-9.]*M sed below never matches → PARSE_ERROR → fail-open
# → the deny branch is UNREACHABLE, while awk's %.2f writes comma decimals into the
# unquoted JSON slots (record invalid). One pin closes both. Latent under ambient
# C.UTF-8; de/fr/sr/pt/cs locales are installed on this machine.
export LC_ALL=C

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
LOG_DIR="$ROOT/.claude/logs"
LOG="$LOG_DIR/agent-dispatch-memory.jsonl"
# SMOKE CHANNEL (2026-09-13). This recorder is the denominator for every threshold argument made
# about this gate, and the suite below it was writing its fixtures into the SAME file: measured
# 2026-09-13 at 7,669 of 14,930 records (51.4%) synthetic, so an unfiltered count of "how many
# dispatches" was ~2x. Routed to a `.smoke.jsonl` sibling, as check-memory-budget.sh and
# post-compact-pending-check.sh do for their own smoke fixtures.
# ⚠️ FORWARD-ONLY: the 7,669 historical fixtures stay where they are, so any reading taken over
# records written before today still has to exclude them.
# ⛔ AND `synthetic:false` IS THE WRONG FILTER FOR THAT — IT MISSES 57% OF WHAT IT CLAIMS TO REMOVE.
# Re-measured 2026-09-13 over 14,977 live records: 7,668 are smoke by the `agent`-VALUE prefix
# (51.2%, which is the 51.4% above), but only 3,433 carry `"synthetic":true` — so 4,238 smoke
# records survive a `synthetic:false` filter, which keeps 11,544 against a true 7,309. A 58%
# inflation of the denominator every threshold argument about this gate rests on.
# THE CORRECT DISCRIMINATOR IS THE ONE ALREADY DERIVED ABOVE: `agent` value starting `smoke`.
# Why they are not co-extensive, in BOTH directions: `synthetic` is stamped on FAKE PRESSURE
# (FF_AGENT_MEMGUARD_FAKE_PRESSURE_GB, see the writer below), which is deliberately independent of
# the agent name — so a smoke arm that injects NO pressure runs with `CLAUDE_HOOK_SMOKE=1`, routes
# to the sibling file, and still stamps `"synthetic":false`. Five smoke arms take that path today.
# File identity and the field are not co-extensive either way; the agent-name prefix is.
[ -n "${CLAUDE_HOOK_SMOKE:-}" ] && LOG="$LOG_DIR/agent-dispatch-memory.smoke.jsonl"
mkdir -p "$LOG_DIR" 2>/dev/null || true

INPUT=$(cat 2>/dev/null || echo "{}")
DESC=$(printf '%s' "$INPUT" | grep -oE '"description"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//' | LC_ALL=en_US.UTF-8 cut -c1-80)  # char-not-byte truncation under the script-wide LC_ALL=C pin

THRESHOLD_GB="${FF_AGENT_MEMGUARD_THRESHOLD_GB:-24}"
# An unvalidated threshold makes awk's t+0 read 0 on any
# typo/empty value -> DENY at normal pressure = fail-CLOSED, the opposite of this guard's design.
case "$THRESHOLD_GB" in ''|.|*.*.*|*[!0-9.]*) THRESHOLD_GB=24 ;; esac
PARSE_ERROR=false

# The FAKE override gets the same validation THRESHOLD got above —
# a non-numeric value flows into awk (reads 0) and the UNQUOTED JSON slots (record invalid).
# Invalid ⇒ ignored (falls through to REAL measurement); SYNTHETIC stays false, consistently.
case "${FF_AGENT_MEMGUARD_FAKE_PRESSURE_GB:-}" in *[!0-9.]*) FF_AGENT_MEMGUARD_FAKE_PRESSURE_GB="" ;; esac
if [ -n "${FF_AGENT_MEMGUARD_FAKE_PRESSURE_GB:-}" ]; then
  PRESSURE_GB="$FF_AGENT_MEMGUARD_FAKE_PRESSURE_GB"
  SWAP_GB="$FF_AGENT_MEMGUARD_FAKE_PRESSURE_GB"; COMP_GB="0"
else
  # swap used: "total = 4096.00M  used = 3024.12M  free = ..." -> GB
  SWAP_GB=$(sysctl -n vm.swapusage 2>/dev/null | sed -n 's/.*used = \([0-9.]*\)M.*/\1/p' | awk '{printf "%.2f", $1/1024}')
  # compressor: pages * page-size (read from vm_stat header, never assumed)
  # MEASURED: with the page-size line missing, $5*ps prints a well-formed "0.00" —
  # NON-empty, so the -z guard below passed and pressure silently became swap-only with
  # parse_error:false. The `if (ps=="") exit` makes the failure LOUD (empty -> caught), symmetric
  # with the swap half.
  COMP_GB=$(vm_stat 2>/dev/null | awk '/page size of/{ps=$8} /occupied by compressor/{ if (ps=="") exit; gsub(/\./,"",$5); printf "%.2f", $5*ps/1e9}')
  if [ -z "$SWAP_GB" ] || [ -z "$COMP_GB" ]; then
    PARSE_ERROR=true; SWAP_GB="${SWAP_GB:-0}"; COMP_GB="${COMP_GB:-0}"
  fi
  PRESSURE_GB=$(awk -v a="$SWAP_GB" -v b="$COMP_GB" 'BEGIN{printf "%.2f", a+b}')
fi

# pid<ppid captured so a consumer can be walked back to its spawning agent at the NEXT incident —
# a 12.89 GB ugrep was measured during a deep-pass wave and attribution died at capture
# because this field held comm only.
TOP=$(ps -A -o rss=,pid=,ppid=,comm= 2>/dev/null | sort -rn | head -5 | awk '{c=$4; for(i=5;i<=NF;i++) c=c" "$i; n=split(c,p,"/"); gsub(/["\\]/,"",p[n]); printf "%s%s(%s<%s):%.1fGB", (NR>1?",":""), p[n], $2, $3, $1/1048576}')

# DECISION computed BEFORE the record is written (folded
# 2026-07-30): the recorder used to prove the MEASUREMENT but never the ACTION —
# 0 of 256 records carried a decision, so "was the 20.03 GB dispatch denied?" was
# unanswerable from the log and had to be reconstructed from git arming times.
# PARSE_ERROR forces allow, mirroring the fail-open exit below.
OVER=0
if [ "$PARSE_ERROR" != "true" ]; then
  OVER=$(awk -v p="$PRESSURE_GB" -v t="$THRESHOLD_GB" 'BEGIN{print (p+0 > t+0) ? 1 : 0}')
fi
DECISION=allow; [ "$OVER" = "1" ] && DECISION=deny

# SYNTHETIC STAMP (2026-08-01): mark records whose pressure was INJECTED, so the log can be
# filtered structurally instead of by a `grep -v smoke` every reader has to remember. Keyed on
# FF_AGENT_MEMGUARD_FAKE_PRESSURE_GB — the thing that MAKES a record synthetic — not on the agent
# NAME, so a real agent whose description happens to contain "smoke" is not misclassified and a
# smoke case that measures REAL pressure is correctly marked real.
# WHY: measured 2026-08-01, this log was 713 records = 420 real + 293 injected (41% synthetic),
# with fixtures clustering on fixed values (40.0 x76, 2.0 x50, 2.95 x47). Unfiltered, the log
# reports p95 = 40.00 — a FIXTURE VALUE — and it did so on three separate days. Smoke-filtered the
# same span is p50 9.43 / p95 19.80. Any threshold recalibrated off the raw log inherits that.
SYNTHETIC=false
[ -n "${FF_AGENT_MEMGUARD_FAKE_PRESSURE_GB:-}" ] && SYNTHETIC=true
# STRUCTURAL BACKSTOP for the smoke routing above, keyed on the SAME thing that MAKES a record
# synthetic rather than on a flag a future arm has to remember to set — which is the discipline
# post-compact-pending-check.sh credits to this hook by name. An INJECTED pressure value is by
# construction not a measurement, so it can never belong in the calibration denominator.
[ "$SYNTHETIC" = "true" ] && LOG="$LOG_DIR/agent-dispatch-memory.smoke.jsonl"

printf '{"ts":"%s","sid":"%s","swap_gb":%s,"comp_gb":%s,"pressure_gb":%s,"parse_error":%s,"synthetic":%s,"decision":"%s","agent":"%s","top":"%s"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${CLAUDE_CODE_SESSION_ID:-unknown}" \
  "${SWAP_GB:-0}" "${COMP_GB:-0}" "${PRESSURE_GB:-0}" "$PARSE_ERROR" "$SYNTHETIC" "$DECISION" \
  "$(printf '%s' "$DESC" | tr -d '"\\')" "$TOP" >> "$LOG" 2>/dev/null || true

# FAIL-OPEN: unmeasurable pressure must not block agent work (logged above).
[ "$PARSE_ERROR" = "true" ] && exit 0

if [ "$OVER" = "1" ]; then
  cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Memory guard: swap ${SWAP_GB} GB + compressor ${COMP_GB} GB = ${PRESSURE_GB} GB > ${THRESHOLD_GB} GB. Re-derived over the flight record since 2026-09-01: 16723 real samples, p50 16.1 / p95 21.9 / p99 24.7 / max 41.6 GB. The max MOVES - it rose 27.3 to 28.9 inside two hours on 2026-09-19 as one session's own lens fan-out pushed it - so read it as a floor, never a bound. WARNING - THIS SUM IS NOT A RAM-SCARCITY MEASURE: swap is disk, the compressor is RAM, and the sum has exceeded this machine's physical memory. A high compressor reading means the kernel is SUCCEEDING at squeezing idle apps, so check free pages with vm_stat and look at the largest process before treating this as real. The 115 GB incidents once cited here were traced 2026-08-01 to runaway ugrep, not agent fan-out, and are guarded at that command. Do NOT dispatch more agents now: run this work SERIALLY (one agent, wait, next), or wait for pressure to fall. Flight record: .claude/logs/agent-dispatch-memory.jsonl. Escape (owner-authorized only): SKIP_AGENT_MEMORY_GUARD=1."
  }
}
EOF
  exit 0
fi
exit 0
