# warn-emit.sh — shared emit helper for WARN-MODE hooks on ANY event. Sourced, never executed.
# (Was "PreToolUse hooks" until 2026-08-26: 6 callers now set WARN_EMIT_EVENT to PostToolUse.)
# ⛔ THE PROSE IN THIS FILE DELIBERATELY SPLITS THAT ASSIGNMENT — "set X to Y", never "X=Y".
#    A fixed-string grep for that assignment is how anyone ENUMERATES the
#    callers, and a mention here makes this lib match its own caller-grep: it read 7 files
#    where 6 are real, caught within minutes of the fix that introduced it. Do not
#    "tidy" the wording back to the literal form.
#
# WHY THIS EXISTS. A warn-mode PreToolUse hook that writes to bare stderr and exits 0
# is INVISIBLE TO THE MODEL — orchestrator and sub-agent alike. Measured twice: once on
# `grep-blowup-warn.sh` (2026-08-14), and again 2026-08-24 in a throwaway repo with
# its own settings.json, a fresh `claude -p` session per arm and the probe hook
# logging its own fire so a negative could not be vacuous:
#     additionalContext arm -> hook fired, canary quoted back by the model verbatim
#     bare-stderr arm       -> hook fired, canary absent from the entire output
# So a guard whose purpose is to change the model's NEXT ACTION must emit on stdout as
# `hookSpecificOutput.additionalContext`. stderr remains correct for anything aimed at the
# HUMAN reading the terminal — a fires ledger, a session-end nudge.
#
# ⛔ NO TEMP FILE, AND THAT IS A FIX, NOT A STYLE CHOICE (2026-08-24,
# reproduced by me with a corrected parent control). The first version of this
# helper had each CALLER do `_ADV_FILE="$(mktemp)"` — a bare assignment, and three callers
# run under `set -e`. A failing mktemp therefore aborted the hook BEFORE the stderr write,
# killing the advisory on BOTH channels and returning rc=1, a state a warn-mode hook had
# never previously entered. Measured on commit-pathspec-warn with a stubbed failing mktemp:
#     current, mktemp OK    -> rc=0  stdout=1065  stderr=944
#     current, mktemp FAILS -> rc=1  stdout=0     stderr=0      <- advisory gone
#     PARENT,  mktemp FAILS -> rc=0  stdout=0     stderr=945    <- control: unaffected
# The temp file was introduced only to avoid nesting a heredoc inside command substitution
# (which breaks the parser on apostrophes). Reading the advisory from STDIN avoids BOTH:
# no nesting, and no new failure mode to handle. The payload reaches python on stdin while
# the PROGRAM comes from `-c`, so this is not the `python3 - <<EOF` trap.
#
# USAGE — feed the advisory on STDIN with a heredoc attached to the FUNCTION (no pipe, no subshell),
# or pass it as an argument. Never nest a heredoc inside a substitution (it breaks on apostrophes):
#     . "$(dirname "${BASH_SOURCE[0]}")/lib/warn-emit.sh" 2>/dev/null || true
#     type warn_emit >/dev/null 2>&1 || warn_emit() { if [ "$#" -gt 0 ]; then printf '%s\n' "$*" >&2; else cat >&2; fi; }
#     # ^ ⛔ THE FALLBACK MUST HANDLE BOTH SHAPES, and the arg-less form that used to sit here
#     #   was the ROOT CAUSE of a defect in 17 hooks (fixed). A bash function does NOT
#     #   forward its arguments to a command in its body, so `cat` with no args reads STDIN:
#     #   on an ARGUMENT-form call the advisory was LOST at stdin EOF and HUNG with stdin open.
#     #   This block taught the broken fallback FOUR LINES above "an argument still works too",
#     #   so an author following it verbatim wrote the bug. Teaching material is a call site.
#     warn_emit <<'EOF' || true
#     ...advisory...
#     EOF
#   or, for a computed advisory:  _adv="$(build_it)"; warn_emit "$_adv"    (or: warn_emit < <(build_it))
#   an argument always works:     warn_emit "text"
#   ⛔ NEVER `... | warn_emit` in a hook with MORE THAN ONE emit site: the emit-once flag below
#      (_WARN_EMITTED) is set INSIDE this function, so a PIPE runs it in a subshell and the flag dies
#      there — a second call then emits a SECOND document and the harness discards BOTH (measured:
#      pipe = 2 docs; argument / heredoc-into-function / process substitution = 1). The
#      suite's `warn_emit pipe-form × multi-site` arm REDs a hook that has both.
#
# CONTRACT — deliberately total, because every caller is a LIVE FLEET GATE (PreToolUse or PostToolUse)
# and a hook that aborts mid-flight is worse than one that says nothing:
#   * never returns non-zero (callers run under `set -e`)
#   * stderr is written FIRST and unconditionally, so the pre-existing human-facing
#     behaviour survives even if the JSON leg fails entirely
#   * no-ops on empty input
#   * python3 absent or failing degrades to stderr-only — i.e. exactly the pre-conversion
#     behaviour
#   * allocates nothing: no temp file, no directory, no cleanup that can be skipped
#
# ⛔ EXACTLY ONE JSON DOCUMENT PER PROCESS — MEASURED, AND THE FAILURE DIRECTION IS THE
# WORST AVAILABLE. Two hooks (`bash-safety-warn`, `dup-durable-append-warn`) can emit two
# advisories in one invocation; `bash-safety-warn`'s own comment says the co-fire is BY
# DESIGN. Two JSON documents concatenated on stdout is not one document, and the harness
# then discards stdout WHOLESALE: measured 2026-08-24 in the throwaway rig, hook fired,
# BOTH canaries absent, model replied "NONE" — where a single document arrives verbatim.
# So without this guard, THE MORE A GUARD HAS TO SAY THE LESS THE MODEL HEARS: one finding
# is delivered, two are silently dropped. Raised in review and
# reproduced independently here on the live plane.
#
# FIRST CALL WINS the model channel; every call still writes stderr, so nothing is lost to
# the human. A trap-based accumulate-and-flush would deliver both, and was REJECTED on
# purpose: `always-loaded-claim-warn` installs `trap 'rm -f "$_pf"' EXIT` AFTER sourcing
# this lib, so any EXIT trap set here is overwritten and its temp file leaks. Chaining via
# `trap -p` parsing is fragile on a live fleet gate, and this file already shipped one
# regression tonight. ⚠️ RESIDUAL, stated rather than hidden: on a genuine double-fire the
# SECOND advisory reaches the terminal but not the model.
#
# ⛔ IF YOU ARE REACHING FOR ACCUMULATE-AND-FLUSH, READ THIS FIRST — it is the obvious
# improvement and it has been proposed and withdrawn once already (in the
# proposer's own words): accumulate "loses nothing" **IN THE HELPER** and LEAKS A
# FILE **IN A CALLER**. That is the same function-boundary mistake as this helper's
# original totality contract — which claimed every failure path was covered while the
# `mktemp` the CALLERS ran was not — reproduced one level up, by the reviewer who was at
# that moment reviewing exactly that class. The completeness you gain is inside the
# boundary you are looking at; the cost lands outside it. Weigh it there or not at all.
warn_emit() {
  local _text="${1-}"
  if [ -z "$_text" ]; then _text="$(cat)"; fi
  [ -n "$_text" ] || return 0

  # 1. HUMAN channel — unconditional, and first, so it cannot be lost to a later failure.
  printf '%s\n' "$_text" >&2

  # 2. MODEL channel — best-effort by design; every failure path falls back to (1) alone.
  [ -z "${_WARN_EMITTED:-}" ] || return 0
  _WARN_EMITTED=1
  command -v python3 >/dev/null 2>&1 || return 0
  # hookEventName is a PARAMETER with a PreToolUse default, not a constant. ⛔ THE PREMISE
  # THAT ONCE JUSTIFIED THE DEFAULT IS DEAD: this read "every caller today is PreToolUse"
  # until 2026-08-26, and SIX callers now set WARN_EMIT_EVENT to PostToolUse
  # (check-memory-budget-post, check-memory-size, defer-loc-check, agent-diff-reporter,
  # scan-secrets-writes, commit-review-warn). The default is retained for the PreToolUse
  # majority; a caller on ANY other event MUST set WARN_EMIT_EVENT first or the harness
  # misroutes the payload and the advisory vanishes — the silent-loss class this lib exists
  # to end. ⚠️ This comment is itself a CALL SITE: the same file taught the arg-blind
  # fallback to all 17 consumers four lines above the argument line, so a stale claim here
  # mints the next wrong caller rather than merely misinforming a reader.
  printf '%s' "$_text" | WARN_EMIT_EVENT="${WARN_EMIT_EVENT:-PreToolUse}" python3 -c 'import json,os,sys
t = sys.stdin.read()
print(json.dumps({"hookSpecificOutput": {"hookEventName": os.environ.get("WARN_EMIT_EVENT") or "PreToolUse", "additionalContext": t}}))' 2>/dev/null || true
  return 0
}

# ⛔ NAMED REJECT — the trailing-newline strip stays. `_text="$(cat)"` drops ALL trailing
# newlines (command substitution always does), so an advisory deliberately ending in a blank
# line loses it. The x-sentinel idiom fixes the capture, but `printf '%s\n'` on the stderr
# path then emits the preserved newline PLUS its own, double-spacing every advisory across
# eleven LIVE hooks. The defect is cosmetic on both channels; the fix touches the one line
# every converted hook depends on. Not worth that trade — recorded so the next reader does
# not rediscover it and assume nobody noticed.
