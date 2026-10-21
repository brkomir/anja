#!/usr/bin/env bash
# agent-memory-brief-warn.sh — dispatch-plane nudge for the class where a dispatched agent never attempts to read its own memory.
# PreToolUse(Agent), INJECT-ONLY, always exit 0 — fail-OPEN by construction (blast-radius
# rule, session-cadence.md § RANK CANDIDATE PLACEMENTS: inject-only on Agent costs one
# missed nudge when broken, never a blocked dispatch).
#
# MEASURED BASIS (fleet split, agent-memory-load-audit classifier; six confounds defused
# 2026-08-26): a brief that NAMES the agent's own memory file by PATH reads it
# 98-100% of the time (0/39 NO_ATTEMPT when the path is named); a brief that does not leaves a
# THIRD memory-blind (33.0% NO_ATTEMPT). The PATH is the key — NOT a phrase. The first cut
# keyed on the bare phrase "MEMORY.md first", which the regenerated definitions and every
# backtick-quoting composer never emit contiguously (0 of 55 definitions
# matched; the hook nudged the one compliant dispatch in the fleet). Predicate now:
# the prompt contains `.claude/skills/<type>/MEMORY` — bare, backticked, bold, or a shard.
#
# LEDGER: one line per MEMORY.md-owning dispatch — haspath 0/1 AND fired 0/1 — not fires
# only. The keep/kill read is the WITHIN-SESSION PAIRED haspath rate
# from this ledger (scripts/agent-memory-brief-split.mjs --ledger), never a pooled share:
# two sessions supply half the fleet's dispatches, so a pooled share moves ~9 points on one
# session's cadence alone. Smoke arms self-stamp via AMBW_SMOKE=1.
# DAMPENER: one nudge per THREAD per TYPE per TTL — the marker is keyed on both, so a wave
# dispatching five types gets five nudges naming five paths, not one naming the first.
# WARN-MODE. A deny is NOT justified yet (behavioural n=1).
# Escape: SKIP_AGENT_MEMORY_BRIEF_WARN=1 (settings env — a harness hook cannot see an inline
# prefix). Fires ledger: .claude/logs/agent-memory-brief-fires.jsonl.
set -u

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
TTL_SECONDS=300

INPUT="$(cat 2>/dev/null || true)"
[ -n "$INPUT" ] || exit 0
if [ "${SKIP_AGENT_MEMORY_BRIEF_WARN:-0}" = "1" ]; then exit 0; fi

# Parse type + whether the brief NAMES the family path for THIS type. Python for JSON
# correctness; any parse failure prints nothing and we exit 0 (fail-open).
PARSED="$(printf '%s' "$INPUT" | python3 -c '
import json, sys, os
try:
    p = json.load(sys.stdin)
    ti = p.get("tool_input") or {}
    t = ti.get("subagent_type") or ""
    prompt = ti.get("prompt") or ""
    tp = p.get("transcript_path") or ""
    ok_type = bool(t) and "/" not in t and "\\" not in t and t != ".."
    haspath = ok_type and (".claude/skills/" + t + "/MEMORY") in prompt
    name = t if ok_type else ""
    flag = "1" if haspath else "0"
    base = os.path.basename(tp)[:48]
    print(name + "\t" + flag + "\t" + base)
except Exception:
    pass' 2>/dev/null || true)"
[ -n "$PARSED" ] || exit 0
ATYPE="$(printf '%s' "$PARSED" | cut -f1)"
HASPATH="$(printf '%s' "$PARSED" | cut -f2)"
TKEY="$(printf '%s' "$PARSED" | cut -f3)"
[ -n "$ATYPE" ] || exit 0
[ -f "$ROOT/.claude/skills/$ATYPE/MEMORY.md" ] || exit 0

SID="${CLAUDE_CODE_SESSION_ID:-nosession}"
[ -n "$TKEY" ] || TKEY="${SID%%-*}"
MARKER="$ROOT/.claude/state/agent-memory-brief-${TKEY%.jsonl}-${ATYPE}.mark"
FIRED=0
OUT=""
if [ "$HASPATH" = "0" ]; then
  DAMPED=0
  if [ -f "$MARKER" ]; then
    # ⛔ ORDER IS LOAD-BEARING, AND `||` CANNOT SEQUENCE THESE (session-cadence.md
    # § GIVE A FILE-BASED BYPASS AN EXPIRY). BSD `stat -f %m` is mtime; GNU `stat -f`
    # is --file-system, an ENTIRELY different mode. ⛔ THIS COMMENT SAID GNU 'prints a
    # MOUNT POINT and exits ZERO' — the mount-point half is REFUTED (from the
    # GNU coreutils manual): under `-f` the directive set is
    # `%a %b %c %d %f %i %l %n %s %S %t %T` and `%m` is NOT in it — `%m` means mount
    # point only in NORMAL-FILE mode, which `-f` switches off. The EXIT CODE remains
    # UNMEASURED; nobody on this fleet has a GNU stat to run `stat -f %m <f>; echo $?`.
    # The account that survives and generalizes does not need the exit code at all:
    # `$(A || B)` CONCATENATES the stdout of both, so any stdout from the first form
    # leaves MT non-numeric whichever way it exited. The numeric case below then
    # skips, DAMPED stays 0, and the dampener is INERT on every Linux host while
    # passing on macOS. Measured: CI meta-hygiene RED against a
    # local 1118/0 PASS. Try each form and VALIDATE NUMERIC before accepting it.
    MT="$(stat -c %Y "$MARKER" 2>/dev/null || true)"
    case "$MT" in ''|*[!0-9]*) MT="$(stat -f %m "$MARKER" 2>/dev/null || true)" ;; esac
    case "$MT" in
      ''|*[!0-9]*) : ;;
      *)
        NOW="$(date +%s)"
        AGE=$((NOW - MT))
        if [ "$AGE" -ge 0 ] && [ "$AGE" -lt "$TTL_SECONDS" ]; then DAMPED=1; fi
        ;;
    esac
  fi
  if [ "$DAMPED" = "0" ]; then
    OUT="$(python3 - "$ATYPE" <<'PY' 2>/dev/null || true
import json, sys
t = sys.argv[1]
msg = (
  f"AGENT-MEMORY BRIEF NUDGE (warn-mode): this dispatch to '{t}' owns a MEMORY.md and the brief "
  "never names it. Measured (fleet, 2026-08-26, six confounds defused): briefs that name the path "
  "get 98-100% memory-read compliance; briefs that do not leave a THIRD of dispatches memory-blind. "
  f"Add to this and each sibling brief: \"Read your .claude/skills/{t}/MEMORY.md first (one Read; "
  "if it reports truncation, grep the rest — and grep MEMORY-ARCHIVE*.md in the same dir before "
  "claiming an entry is absent).\" Any spelling that names the path counts. One nudge per thread "
  "per type (TTL-damped); the dispatch itself is not blocked."
)
print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": msg}}))
PY
)"
    if [ -n "$OUT" ]; then
      FIRED=1
      { mkdir -p "$(dirname "$MARKER")" && touch "$MARKER"; } 2>/dev/null || true
    fi
  fi
fi
SYN=""
if [ "${AMBW_SMOKE:-0}" = "1" ]; then SYN=',"synthetic":true'; fi
{ mkdir -p "$ROOT/.claude/logs" && printf '{"ts":"%s","type":"%s","sid":"%s","haspath":%s,"fired":%s%s}\n' "$(date -u +%FT%TZ)" "$ATYPE" "${SID%%-*}" "$HASPATH" "$FIRED" "$SYN" >> "$ROOT/.claude/logs/agent-memory-brief-fires.jsonl"; } 2>/dev/null || true
[ -n "$OUT" ] && printf '%s\n' "$OUT"
exit 0
