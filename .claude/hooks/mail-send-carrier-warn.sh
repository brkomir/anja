#!/usr/bin/env bash
# PreToolUse(Bash) hook — WARN-MODE carrier for the SENDER HALF of the mail truncation rule.
#
# WHY. A `mail-listen` notification TRUNCATES, and the truncation eats the TAIL — so
# whatever a sender puts last is unreachable to a reader working from the notification.
# Measured: a 6-finding verdict cut at its moderate finding; the reader folded both serious findings, missed 3 minor ones,
# then published a false claim about what it held. The remedy is a SENDER-side habit —
# put a finding COUNT and a read-the-store line ABOVE the findings, the one spot a
# tail-truncation cannot reach.
#
# WHY A HOOK AND NOT ONLY PROSE. The remedy is codified fleet-wide in
# `.claude/orchestrator/conventions.md` (bullet: THE SENDER HALF), approved to stay there
# by a review verdict on 2026-09-09 — 10 of 16 non-hub senders have hit this,
# so breadth argues fleet-wide. ⚠️ THE COST HALF OF THAT ARGUMENT IS NOT WHAT I FIRST WROTE HERE.
# This header claimed the bullet "costs ~397 B on every turn of every main session"; the budget
# tool's own line refutes it — `.claude/orchestrator/` is "SessionStart-injected ONCE per session
# epoch, cached prefix, main session only". Band-O is the per-turn plane, not this one. So the
# case for this hook is NOT that it saves per-turn bytes. It is REACH and TIMING: the conventions
# file never reaches a sub-agent seat at all, and it is read at session start rather than at the
# one moment the failure happens — composing a send. The hook was adopted on that basis.
#
# MODE: WARN-ONLY (exit 0). Never blocks. `additionalContext` only — a bare-stderr
# PreToolUse warn is INVISIBLE to the model (measured twice; see lib/warn-emit.sh).
#
# ⛔ ESCAPE: `SKIP_MAIL_SEND_CARRIER_WARN=1` IN `.claude/settings.json`'s `"env"` BLOCK ONLY.
# An inline `SKIP_...=1 <cmd>` CANNOT reach this hook and it would be a false promise to
# print one: a PreToolUse hook process is spawned by the harness BEFORE your command, with
# the SESSION env, so the prefix is just text to it. Same for a session `export`, which does
# not survive to the next tool call. (bash-environment.md § unset EVERY SKIP_*.)
#
# FIRE = a real `session-manifest.py … mail-send … --to …` invocation whose body we cannot
# confirm already carries the header. Two suppressions keep the FP rate at zero on the
# cases that matter:
#   - a command that merely MENTIONS `mail-send` (a grep, a doc read, a heredoc quoting it)
#     carries no `--to`, so it cannot fire. Testing the COMMAND rather than counting
#     mentions is the whole point: the four hooks that name `mail-send` today all name it
#     in PROSE, and ZERO test it — counting those as precedent was an earlier error
#     this check exists to avoid.
#   - a `--body-file` whose first lines ALREADY carry a count + read-the-store header is
#     compliant, and firing at it would train the reader to skim the advisory.
#     ⛔ BOUNDED, AND I STATED IT TOO BROADLY FIRST: this works only when the path is a
#     LITERAL. A hook process cannot resolve a caller's shell variable — `--body-file
#     "$SP/x.md"` reaches us as those bytes — so a variable-built path is unreadable here
#     and the advisory fires anyway. Measured 2026-09-09, one variable, both arms: literal
#     path -> 0 documents, same file via `$SP` -> 1 document. It fails toward advising,
#     which is the safe direction, but 'self-suppresses on a compliant body' is FALSE for
#     the invocation shape this fleet actually uses. No fix is available from inside a
#     hook; the honest move is the narrower claim.
#
# ⚠️ KNOWN FALSE POSITIVE, MEASURED ON THIS HOOK'S OWN AUTHORING TURN (2026-09-09), DISCLOSED
# RATHER THAN NARROWED AWAY. A command that QUOTES a complete send — the send text, `--to` and
# all, inside a heredoc or an interpreter payload — is indistinguishable from a send by any
# predicate over the command string, and it fired here while I was writing the smoke arms.
# I did NOT add a clause to suppress it: every candidate (exclude heredocs, require a
# command-position verb) also suppresses REAL sends, since a quoted heredoc body is the house
# form for composing a backtick-bearing mail. A narrowing clause is a second blind spot shipped
# inside the fix (bash-environment.md § the fix for an incomplete sweep). At warn-mode the FP
# costs six advisory lines; the population that hits it is people editing THIS hook. The
# fire-log records `had_body_file` so the rate is measurable rather than argued.
#
# Smoke-tested in scripts/smoke-test-hooks.sh (FIRE + SAFE arms).

set -u

# Fallback FIRST, errexit suspended across the source: `.` is a POSIX special builtin, so
# under `set -e` a failed source is FATAL and `|| true` cannot rescue it — on a matcher=Bash
# hook that denies every Bash call fleet-wide with the escape unreachable below the fatal
# line. The `*)` arm of the case is load-bearing under `set -u` without `-e`.
warn_emit() { if [ "$#" -gt 0 ]; then printf '%s\n' "$*" >&2; else cat >&2; fi; }
case $- in *e*) _WE_HAD_E=1 ;; *) _WE_HAD_E=0 ;; esac
set +e
. "$(dirname "${BASH_SOURCE[0]}")/lib/warn-emit.sh" 2>/dev/null
[ "$_WE_HAD_E" = 1 ] && set -e
unset _WE_HAD_E

# ⛔ DRAIN STDIN *BEFORE* THE ESCAPE CHECK — DELIBERATELY UNLIKE THE SIBLING WARN HOOKS, WHICH
# ALL PUT THE SKIP FIRST. Exiting above the drain leaves stdin unread, so python's stdout flush
# at interpreter shutdown gets EPIPE and CPython prints a `BrokenPipeError` traceback into the
# smoke log. `scripts/smoke-test-hooks.sh` documents that exactly ONE arm produces that trace and
# names the mechanism; my escape arm made it two, which quietly falsifies a true comment in a file
# nobody re-reads. Draining first costs one `cat` on a path that is about to exit anyway and keeps
# that invariant true. Do NOT "fix" this back to house order for consistency.
input=$(cat 2>/dev/null || echo "{}")

[[ "${SKIP_MAIL_SEND_CARRIER_WARN:-0}" == "1" ]] && exit 0  # =1 only — a stray =0/=no must NOT bypass
if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  cmd=$(echo "$input" | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//')
fi
[ -z "$cmd" ] && exit 0

# (1) a real mail-send INVOCATION — the subcommand must follow the script on the same segment
printf '%s' "$cmd" | grep -qE 'session-manifest\.py[^|;]*[[:space:]]mail-send([[:space:]]|$)' || exit 0
# (2) …and carry the recipient flag argparse requires. A mention cannot satisfy this.
printf '%s' "$cmd" | grep -qE '[[:space:]]--to([[:space:]]|=)' || exit 0

# (3) SUPPRESS on a --body-file that already carries the header. Read the FILE, never the
# command string: the question is what the RECIPIENT will see. A stdin heredoc is invisible
# to us, so it always advises — the safe direction for a warn.
bf=$(printf '%s' "$cmd" | sed -nE 's/.*--body-file[[:space:]]+"?([^" ]+)"?.*/\1/p' | head -1)
if [ -n "$bf" ] && [ -r "$bf" ]; then
  if head -6 "$bf" 2>/dev/null | grep -qiE 'ITEMS?[[:space:]]*—|READ THE STORE|STORE FILE'; then
    exit 0
  fi
fi

# Fire-log for calibration (guarded so the smoke suite can exercise FIRE without polluting it).
if [ -z "${MAIL_SEND_CARRIER_NO_LOG:-}" ]; then
  LOG_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.claude/logs"
  mkdir -p "$LOG_DIR" 2>/dev/null || true
  TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "?")
  printf '{"ts":"%s","had_body_file":"%s"}\n' "$TS" "$([ -n "$bf" ] && echo yes || echo no)" \
    >> "$LOG_DIR/mail-send-carrier-warn-fires.jsonl" 2>/dev/null || true
fi

warn_emit < <({
  echo ""
  echo "⚠️  MAIL SEND — THE NOTIFICATION TRUNCATES, AND IT EATS THE TAIL (warn)."
  echo "   Whatever sits LAST in your body is unreachable to a reader working from the"
  echo "   notification. Measured: a 6-finding verdict cut at its moderate finding — the reader folded both"
  echo "   serious findings, missed 3 minor ones, then published a false claim about what it held."
  echo "   PUT ABOVE THE FINDINGS: an item COUNT, and a line telling the reader to open the"
  echo "   store file. That is the one spot a tail-truncation cannot reach."
  echo "   (Suppressed when --body-file names a LITERAL path already carrying that header. A"
  echo "    path built from a shell variable cannot be read from here, so this fires anyway.)"
  echo ""
}) || true
exit 0
