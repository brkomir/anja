#!/usr/bin/env bash
# PostToolUse(Bash) hook — defer-loc BASH-WRITE bypass closer (2026-07-12).
#
# defer-loc-check.sh is wired PostToolUse(Edit|Write) — so a defer written to
# todo.txt via a Bash `cat >> todo.txt <<EOF` heredoc (or echo/printf/tee/sed -i)
# goes through the Bash tool and NEVER reaches it. That is a REALIZED bypass: on
# 2026-06-22 a session deferred two items via a bash heredoc, the matcher never
# saw them, and the un-estimated defers were caught by hand, not by the gate
# (the enforce-layer was defeated by the write path).
#
# This companion closes it WITHOUT duplicating any logic: it extracts the content
# a Bash command WRITES to todo.txt, then re-invokes defer-loc-check.sh with a
# synthesized Edit-shaped payload — so the full item-grammar / LOC / verified:
# check + the calibration log all run exactly as on the Edit path. Extractor +
# delegate; the residue logic lives in ONE place.
#
# MODE: WARN-ONLY (the delegate is warn-only). Escape: SKIP_DEFER_LOC_CHECK=1
#   (honored by the delegate) OR SKIP_DEFER_LOC_BASH=1 (skips extraction here).
# Prevents a bypass: the action-gate had a hole the width of every bash-written defer.

set -u
[[ "${SKIP_DEFER_LOC_BASH:-}" == "1" ]] && exit 0

payload=$(cat 2>/dev/null || echo "{}")

# perf: shell-gate BEFORE spawning python. python was spawning on EVERY Bash
# tool call (~35ms) and only early-exiting the todo.txt-absent case INSIDE python — but that case
# is dominant. This substring gate skips the spawn entirely when todo.txt is nowhere in the payload;
# python still does the PRECISE write-vs-read detect when it is present. Sound over-approximation.
[[ "$payload" == *todo.txt* ]] || exit 0

# Extract the todo.txt-written content from the Bash command (env var, not a pipe —
# the python heredoc owns stdin). Emits an Edit-shaped payload on stdout, or nothing
# if the command does not WRITE to todo.txt (a read/grep/absent → silent no-op).
# ⛔ PAYLOAD VIA TEMP FILE, NEVER AN ENV VAR. macOS caps env+args at ~1 MB
# (bisected on this box: 1,019 KB ok / 1,024 KB E2BIG). Past the cap `execve` fails,
# python NEVER STARTS, and bash's non-zero is swallowed by this script's trailing
# `exit 0` — the harness records `exitCode: 0` and the gate is SILENTLY OPEN. Measured
# 21x in ONE session, every one on todo.txt, the file this hook exists to inspect. The
# fire-log still looks healthy because the failure is SIZE-SELECTIVE: small payloads
# pass, and the largest rows — exactly what an LOC gate is for — sail through unchecked.
# FAIL LOUD, NOT SILENT. This gate fails OPEN when it cannot stage its
# payload — correct for a warn hook (a transient /tmp failure must not block
# work) — but a bare `|| exit 0` makes the ERROR path byte-identical to the
# PASS path: exit 0, no output, indistinguishable from "ran and found
# nothing". That is how the GNU-mktemp defect (fixed 2026-08-10) left this
# gate INERT on every Linux box for its whole life, seen by nothing except
# CI's smoke suite. Announcing costs one line and turns a silent blind spot
# into a diagnosis.
_pf=$(mktemp "${TMPDIR:-/tmp}/hookpayload.XXXXXX") || {
  echo "defer-loc-check-bash: could not create a payload temp file — GATE INERT for this invocation" >&2
  exit 0
}
printf '%s' "$payload" > "$_pf"
trap 'rm -f "$_pf"' EXIT
synth=$(DEFER_LOC_BASH_PAYLOAD_FILE="$_pf" python3 - <<'PY'
import json, os, re, sys
try:
    with open(os.environ["DEFER_LOC_BASH_PAYLOAD_FILE"], encoding="utf-8") as _pfh:
        p = json.load(_pfh)
except Exception:
    sys.exit(0)
cmd = (p.get("tool_input", {}) or {}).get("command", "") or ""
if "todo.txt" not in cmd:
    sys.exit(0)
# Only a WRITE to todo.txt — a redirect (`> `/`>> `), `tee … todo.txt`, or `sed -i … todo.txt`.
# NOT a read (`cat todo.txt`, `grep … todo.txt`, `< todo.txt`) — those must stay silent.
if not re.search(r">>?\s*(?:\"|')?[^\s\"'|;&]*todo\.txt|\btee\b[^|;&]*todo\.txt|\bsed\b[^|;&]*-i[^|;&]*todo\.txt", cmd):
    sys.exit(0)
# Added content: a heredoc body if present (the realized case), else the whole command
# (coarse over-approximation — warn-tolerant; the delegate's DEFER gate keeps FP bounded).
m = re.search(r"<<-?\s*[\"']?(\w+)[\"']?\r?\n(.*?)\r?\n[ \t]*\1\b", cmd, re.S)
content = m.group(2) if m else cmd
root = ""
try:
    root = os.popen("git rev-parse --show-toplevel 2>/dev/null").read().strip()
except Exception:
    pass
fp = os.path.join(root, "todo.txt") if root else "todo.txt"
# carry the top-level session_id through: the delegate logs p["session_id"] for the
# SC-2 distinct-session count (NOTE: the 5/5 Fable panel RETIRED block-mode for this hook on TYPE grounds (2026-07-12): a LEXICAL-PROSE net is TERMINALLY WARN — its detection surface IS the text a blocked author would rewrite, so a hard block teaches evasion, not accuracy. The distinct-session count is a CALIBRATION/FP signal, NOT a promotion ladder. Do not re-inherit the SC-2 block-mode telos); dropping it collapses every bash-path fire to
# one empty pseudo-session and corrupts that metric. The Edit path carries it; this must too.
print(json.dumps({"tool_name": "Edit", "session_id": p.get("session_id", ""), "tool_input": {"file_path": fp, "new_string": content}}))
PY
)

[[ -z "$synth" ]] && exit 0

# Delegate to the single source of truth. Piped (not the Bash tool) → no PostToolUse
# re-trigger, no recursion. The delegate prints the warning + logs the fire.
printf '%s' "$synth" | bash "$(dirname "$0")/defer-loc-check.sh"
exit 0
