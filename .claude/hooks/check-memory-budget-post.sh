#!/usr/bin/env bash
# check-memory-budget-post.sh — PostToolUse(Bash) companion to check-memory-budget.sh.
#
# WHY A SECOND SCRIPT RATHER THAN A BRANCH IN THE FIRST ONE.
# check-memory-budget.sh is PreToolUse: it must PREDICT the resulting size from the
# tool payload. That works for Edit/Write (the content is in the payload) and for
# exactly one Bash spelling — a LITERAL `update-index --cacheinfo <mode>,<40-hex>,<path>`,
# where `git cat-file -s` gives the answer before the write.
#
# ⛔ IT DOES NOT WORK FOR THE SHAPE WE ACTUALLY USE, and that was MEASURED live through
# the harness on 2026-08-12, not reasoned:
#     sha written LITERALLY in the command   -> BLOCKED  (PreToolUse arm fires)
#     sha in a shell variable `$B`           -> NOT blocked
#     the same call inside a python heredoc  -> NOT blocked
# The third row is the one that matters: the blob-isolation recipe active-recall.md
# prescribes for a many-writer file is normally driven from python
# (`subprocess.run([...,f"100644,{h},{path}"])`), so the sha is an f-string placeholder
# and NO amount of command-string parsing can recover it. A PreToolUse guard is
# structurally incapable of covering that channel.
#
# THE FIX IS TO STOP PARSING AND START MEASURING. This runs AFTER the tool call and
# reads the FILE, so it is blind to how the write was spelled — heredoc, redirect,
# git plumbing, sed -i, a python rewrite, anything. It cannot DENY (the bytes are
# already on disk), and it does not need to: the harness truncates at LOAD time, i.e.
# the NEXT session. A warn emitted now is actionable before anyone reads it.
#
# Deliberately NOT wired on Edit|Write — the PreToolUse hook already blocks those
# before the write, which is strictly better. This closes only the Bash channel.
#
# Fails OPEN on everything (exit 0 always). A PostToolUse hook that errors would
# surface noise on every Bash call fleet-wide for no protective gain.
set -uo pipefail

# Model-aimed advisory on PostToolUse. Measured 2026-08-25: bare stderr delivers ZERO text
# to the model on this event; additionalContext is quoted back verbatim. WARN_EMIT_EVENT is
# REQUIRED — the lib defaults to PreToolUse and would misroute the payload.
WARN_EMIT_EVENT=PostToolUse
# ⛔ HANDLES BOTH CALL SHAPES, and that is not tidiness. A bash function does NOT forward its
# arguments to a command in its body, so the old `warn_emit() { cat >&2; }` ran `cat` with NO
# args on an ARGUMENT call — reading stdin instead. Measured: advisory LOST at stdin EOF,
# HANGS with stdin open. The fallback exists for the case where the lib does not resolve, and
# in that exact case an argument-form caller emitted nothing at all.
warn_emit() { if [ "$#" -gt 0 ]; then printf '%s\n' "$*" >&2; else cat >&2; fi; }
case $- in *e*) _WE_HAD_E=1 ;; *) _WE_HAD_E=0 ;; esac
set +e
. "$(dirname "${BASH_SOURCE[0]}")/lib/warn-emit.sh" 2>/dev/null
[ "$_WE_HAD_E" = 1 ] && set -e
unset _WE_HAD_E

# 24985 = 24.4 KiB off a ROUNDED banner (the cliff is only BOUNDED, 24,964-25,300 chars), and the
# harness counts CHARACTERS not bytes (measured 2026-08-13; the banner
# `MEMORY.md is 24.7KB (limit: 24.4KB)` fired at 25,527 B / 25,300 chars, and 25300/1024 = 24.7
# exactly). bytes >= chars in UTF-8, so gating BYTES at the character number can never permit an
# overrun — it errs strict, the fail-safe direction. Keep in lockstep with the PreToolUse sibling
# `check-memory-budget.sh` and with `check-memory-size.sh`; all three gated 25600 until 2026-08-13,
# i.e. 615 ABOVE the cliff, so every one of them read GREEN while the harness truncated the tail.
CAP_BYTES=24985
CAP_LINES=200

# ⛔ THE FILE SET IS BOTH ARMS, NOT JUST THE INDEX (corrected 2026-08-12).
# The first version of this hook checked ONE file — the project index — while its commit message
# claimed the PostToolUse layer "catches everything else". The PreToolUse Bash arm filters
# `*MEMORY*.md`, so its one-spelling limit (literal-sha `--cacheinfo` only) applies to BOTH arms;
# correcting only arm 1 left that limit uncorrected for the 56 skill MEMORY.md files.
# It is REACHABLE, not theoretical: block-subagent-memory-write.sh DENIES Edit/Write on
# the skill memory files and its own deny text PRESCRIBES a Bash `>>` append — so Bash is the
# sanctioned write channel there, which is exactly the channel the Pre arm cannot project.
# Thresholds differ per arm and are mirrored from check-memory-budget.sh: the index is a hard
# harness cap (truncation), the skill memories are a Read-ceiling ratchet (partial view).
RATCHET_BYTES=57500

# ⛔ PRECEDENCE IS ENV-FIRST, MIRRORING check-memory-budget.sh:96 — DO NOT "simplify" TO git-first.
# `git rev-parse --show-toplevel` succeeds in ANY worktree and returns the WORKTREE root, so a
# git-first resolution makes an agent thread measure ITS OWN COPY of the index instead of the live
# one. Measured 2026-08-12 against a real agent worktree: live 25,527 B (73 B under the 25,600 cap)
# vs worktree copy 21,018 B (4,582 B) — a 4,509 B divergence, reported in the FAIL-OPEN direction.
# The repo instructs agent threads to write by ABSOLUTE path, so following that rule correctly is
# what evades the guard. ARM 2 below iterates 56 skill files under this same ROOT, so a wrong root
# here is not one file, it is all of them.
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"  # hooks inherit the session cwd

# ARM 1 — the always-loaded project index. Hard harness cap; breach = silent tail truncation.
IDX="$ROOT/.claude/project-memory/MEMORY.md"
if [ -f "$IDX" ]; then
  B=$(wc -c < "$IDX" 2>/dev/null | tr -d ' ')
  L=$(wc -l < "$IDX" 2>/dev/null | tr -d ' ')
  case "${B:-x}${L:-x}" in
    *[!0-9]*) ;;
    *) if [ "$B" -gt "$CAP_BYTES" ] || [ "$L" -gt "$CAP_LINES" ]; then
         _cmbp_a="$(
           echo "⛔ MEMORY.md budget BREACHED — the write already landed and the PreToolUse gate could not see it."
           echo "   $IDX is now ${B} bytes / ${L} lines (cap ${CAP_BYTES} / ${CAP_LINES})."
           # ⛔ DO NOT restore the word "SILENTLY" here. Refuted 2026-08-25 and again
           # 2026-09-01: the harness PRINTS a
           # truncation banner. What it withholds is WHICH rows went. The distinction sets the
           # urgency a reader assigns — silent rule loss is drop-everything, a loud refusal is a
           # chore — and the false version was once repeated as fact off a tracker row.
           echo "   Past the cap the harness TRUNCATES THE TAIL at the next session load. It DOES"
           echo "   announce that — a banner reports only part of the file loaded — but it never"
           echo "   names WHICH rows it dropped, so they just stop firing with nothing to point at."
           echo "   FIX IT BEFORE YOU FINISH THIS TURN:"
           echo "   move topical project_*/feedback_* pointers to the cold MEMORY-INDEX.md (not auto-loaded)."
           echo "   Keep only the Trigger Index + vendor reference_* pointers hot."
         )"
         warn_emit "$_cmbp_a" || true
       fi ;;
  esac
fi

# ARM 2 — skill MEMORY.md. Read-ceiling ratchet, NOT the harness cap; a breach here means a
# sub-agent's opening Read returns a PARTIAL view with the truncation disclosed only in a footer.
# meta/ is exempt for the same reason it is exempt in the Pre hook: a cold body store retrieved by
# keyed grep, not read whole at invocation.
NOW=$(date +%s)
for M in "$ROOT"/.claude/skills/*/MEMORY.md; do
  [ -f "$M" ] || continue
  case "$M" in */skills/meta/MEMORY.md) continue ;; esac
  SB=$(wc -c < "$M" 2>/dev/null | tr -d ' ')
  # ⛔ AN UNMEASURABLE FILE MUST NOT READ AS CLEAN. This `continue` used to be silent, which
  # reproduces — one level down — the exact shape the hook exists to catch: truncation that
  # announces nothing. A file we could not size is UNKNOWN, never OK. Announce it.
  case "${SB:-x}" in
    ''|*[!0-9]*)
      echo "⚠️ SKILL MEMORY UNMEASURABLE — $M could not be sized (wc -c failed); NOT checked against the ${RATCHET_BYTES} B ceiling." >&2
      continue ;;
  esac
  # Fire only for a FRESH write. This arm reads file STATE, so without a recency guard every Bash
  # call in every seat re-announced a breach that predated it: an 8-seat review measured ~36,000
  # fires / ~18 MB in 7 days (31,021 on 2026-09-23 alone, 2,122 in one hub session), all on ONE
  # file no caller had touched. A Bash heredoc/redirect write bumps mtime, so "modified within the
  # last 120 s" = written by ANY seat in the last 120 s: the writer's own call, plus every other
  # seat's Bash call in that window (the hook cannot tell which, so the message does not claim
  # it). 120 s = the Bash tool's default timeout, so it covers a default-timeout writing call; a
  # call run with a longer explicit timeout, or backgrounded, that writes >120 s before its
  # PostToolUse is NOT warned. The Write/Edit tools never reach this hook's matcher. An
  # UNREADABLE mtime falls through to the warning, never to silence. Enforcement is unchanged:
  # warn-large-tracker-read.sh ARM B still refuses an unbounded Read of the oversized file, and
  # /wrap step 7e (wrap-reconcile.mjs) carries the level signal. Arms: FRESH / STALE pair in
  # scripts/smoke-test-hooks.sh.
  # INSIDE the size branch: stat on every one of ~59 files cost ~+300 ms per Bash call. GNU FIRST:
  # GNU `stat -f` is --file-system and prints a non-numeric block (marker_live() in
  # block-subagent-always-loaded-write.sh), which would make the STALE arm red on ubuntu CI.
  if [ "$SB" -gt "$RATCHET_BYTES" ]; then
    MT=$(stat -c %Y "$M" 2>/dev/null || stat -f %m "$M" 2>/dev/null)
    case "${MT:-x}" in ''|*[!0-9]*) MT=$NOW ;; esac
    AGE=$(( NOW - MT ))
    if [ "$AGE" -gt 120 ]; then continue; fi
    _cmbp_b="$(
      echo "⛔ SKILL MEMORY over the Read ceiling — a write in the last ${AGE} s (this seat or a peer; the hook cannot tell which) left it here, and the PreToolUse gate could not see it."
      echo "   $M is now ${SB} bytes (ceiling ${RATCHET_BYTES})."
      echo "   Past this, warn-large-tracker-read.sh ARM B DENIES an unbounded Read and hands back paging"
      echo "   coordinates — an unbounded Read-TOOL read is refused loudly. ONE channel, not all: a Bash"
      echo "   cat/sed of the same file bypasses ARM B (matcher='Read'). Distil before dispatching."
    )"
    warn_emit "$_cmbp_b" || true
    # Fire ledger: the pre-guard flood (~36,000/wk) was found only by transcript archaeology.
    [ -d "$ROOT/.claude/logs" ] && printf '{"ts":"%s","file":"%s","bytes":%s,"age_s":%s}\n' \
      "$(date -u +%FT%TZ)" "${M#"$ROOT"/}" "$SB" "$AGE" >> "$ROOT/.claude/logs/memory-budget-post-fires.jsonl" 2>/dev/null || true
  fi
done
exit 0
