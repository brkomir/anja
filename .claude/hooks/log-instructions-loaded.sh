#!/usr/bin/env bash
# log-instructions-loaded.sh — InstructionsLoaded observer. LOG ONLY, never decides.
#
# WHY THIS EXISTS. The context-tiering design
# turns on one question: when a rules file carries `paths:` frontmatter, does it actually
# leave the payload, and does it come back when it should? Measured 2026-08-17 in a
# throwaway repo: YES to both, and exclusion propagates to dispatched subagents. But the
# objection to tiering is that a rule which fails to load produces NO ERROR — an agent
# that simply does not know it. This hook is the answer to that objection: it records every
# instruction load with its REASON, so absence becomes a readable log line instead of a
# silent wrong answer.
#
# WHAT THE PAYLOAD CARRIES (measured, not assumed):
#   load_reason  session_start | nested_traversal | path_glob_match | include | compact
#   file_path    the file that loaded  <- this is what makes the log useful
#   memory_type  e.g. Project
#   plus cwd, session_id, transcript_path, hook_event_name
#
# ⛔ LOG-ONLY BY DESIGN. It emits nothing on stdout and always exits 0, so it can never
# block, deny, or alter a load. That is deliberate: this hook is wired FLEET-WIDE in
# settings.json, and the blast radius of an observer that can fail is the whole fleet's
# instruction loading. Per session-cadence.md § RANK CANDIDATE PLACEMENTS BY THE BLAST
# RADIUS OF THE GUARD'S OWN FAILURE — a fleet-wide surface gets the contained shape.
#
# NOT A GUARD. It asserts nothing and gates nothing. Reading its log is a human act.
# Do not add a decision to this script; add a separate gate that reads the log.

set -u

LOG_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}/.claude/logs"
LOG="$LOG_DIR/instructions-loaded.jsonl"

# Escape valve, same convention as the other hooks in this dir.
if [ "${SKIP_INSTRUCTIONS_LOADED_LOG:-0}" = "1" ]; then
  exit 0
fi

INPUT="$(cat 2>/dev/null || true)"

# Never let a logging failure surface. mkdir, append, and exit 0 regardless.
mkdir -p "$LOG_DIR" 2>/dev/null || exit 0

# TIMESTAMP (2026-08-18). The harness payload carries NO time field, and that made every RATE
# question underivable from this log — compactions per hour, whether a delivery pattern is
# trending, how fast the corpus is re-paid. Append order is chronological, but an ordinal is
# not a time: you cannot subtract two line numbers and get an interval. Measured consequence,
# 2026-08-18: "compactions per session" had to be derived from transcript `compactMetadata`
# instead, a different instrument over a different population (160 transcripts vs this log's 8
# sessions), purely because this field was absent.
#
# Spliced with pure parameter expansion, NOT jq. This hook is wired FLEET-WIDE and fires ~20x
# per session_start, so a subprocess per record is a real cost; `date` is the one we cannot
# avoid, because /bin/bash here is 3.2.57 and the printf %(...)T builtin needs 4.2.
#
# ⛔ FAIL-SAFE, AND THIS IS THE LOAD-BEARING PART: if `date` fails, or the payload is not a
# NON-EMPTY `{"`-leading object, the record is appended UNCHANGED. Losing a timestamp is a
# nuisance; losing the record is the observability this hook exists to provide. The
# non-empty check is not decoration — a bare `{}` would splice to `{"ts":"...",}`, which is
# invalid JSON, and every consumer of this log parses it line by line.
_TS="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null)"

# BYTES (2026-08-25). The dispatch plane (~29x the write plane) had zero
# byte telemetry: this log recorded PATHS, never sizes-at-delivery, so rate questions were
# answered from CURRENT on-disk sizes attributed to PAST deliveries. One `stat` per record
# (same order of cost as the one `date`), spliced ONLY when it yields a pure number — losing
# the field is a nuisance, losing the record is the observability (same fail-safe contract as
# _TS). GNU-first with a numeric guard, per session-cadence.md (`stat -f` on GNU fails open).
_BY=""
_FP="${INPUT#*\"file_path\":\"}"
if [ "$_FP" != "$INPUT" ]; then
  _FP="${_FP%%\"*}"
  _BY="$(stat -c%s "$_FP" 2>/dev/null || stat -f%z "$_FP" 2>/dev/null || true)"
  case "$_BY" in ''|*[!0-9]*) _BY="" ;; esac
fi
_REST="${INPUT#\{}"
# ⚠️ THE BRACES ARE LOAD-BEARING, NOT STYLE. `printf ... >> "$LOG" 2>/dev/null` does NOT
# silence a failed append: redirections are set up left to right, so the shell reports
# "Permission denied" on `>> "$LOG"` BEFORE `2>/dev/null` exists, and the message goes to the
# real stderr. Pre-existing since this hook was written (measured 2026-08-18 against the
# committed version — same leak, line 42) and easy to miss because rc stays 0, so the
# never-blocks contract looks intact and the stdout arm passes. Grouping puts the redirect
# outside, where it covers the append itself. This hook is wired FLEET-WIDE on instruction
# loading; it should be silent on BOTH streams, not just the one that was asserted.
if [ -n "$_TS" ] && [ "$_REST" != "$INPUT" ] && [ "${_REST#\"}" != "$_REST" ]; then
  if [ -n "$_BY" ]; then
    { printf '%s\n' "{\"ts\":\"$_TS\",\"bytes\":$_BY,$_REST" >> "$LOG"; } 2>/dev/null || exit 0
  else
    { printf '%s\n' "{\"ts\":\"$_TS\",$_REST" >> "$LOG"; } 2>/dev/null || exit 0
  fi
else
  { printf '%s\n' "$INPUT" >> "$LOG"; } 2>/dev/null || exit 0
fi

exit 0
