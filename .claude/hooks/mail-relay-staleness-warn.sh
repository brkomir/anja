#!/usr/bin/env bash
# Stop hook — mail-relay staleness net.
#
# The "verify an inbound mail STATE-CLAIM against ground truth before relaying it" rule
# (mail/SKILL.md) is a judgment-RESTRAINT (an ignorable-instruction class) that already
# failed once (a stale relay, N=1). Iron
# Law: a blindspot gate's remedy must be a tool-call / ARTIFACT the lifecycle can observe,
# NEVER a restraint. The DECISION (relayed-a-stale-claim-as-current) is un-hookable, but its
# observable RESIDUE is: a SESSION-MAIL block was surfaced this session AND no ground-truth
# tool call (git log/show/status, whose-edit, check-overlap, Read|Grep of a tracker) fired
# after the LATEST surface. This Stop hook warns on that residue.
#
# Sibling of defer-loc-check.sh (same residue-of-an-un-hookable-decision shape + the same
# env-payload + embedded-python pattern). APPROXIMATE proxy by construction: it cannot read
# relay-INTENT, so it ALSO fires on turns where a surfaced mail was correctly no-op'd /
# noted-for-later. That is the documented cost of making an un-observable decision observable
# — acceptable because WARN-ONLY (stderr, never blocks).
#
# Known FP: a mail-engine-DEV session that Reads session-manifest.py / the smoke test
# (both carry the literal delimiter string) registers a false "surface".
# Rare; warn-only; the fire-log calibrates it.
#
# Prevents: stale state-claim relay (the action-form of the relay-verify restraint).
# MODE: WARN-ONLY (exit 0, never blocks — warn-first). Promote to block (exit 2) ONLY
#   after >=5 fires with a measured FP rate (SC-3 ladder), NOT calendar.
# Escape: SKIP_MAIL_RELAY_CHECK=1 (skip entirely)
#         MAIL_RELAY_NO_LOG=1 (warn OUTPUT still fires; the calibration-log append is
#         suppressed — for smoke/fixture invocations, so fixtures don't pollute the FP data)
# Log:    .claude/logs/mail-relay-staleness-fires.jsonl (FP / cadence calibration).
#         Fire-once-per-surface: an entry keyed (transcript, surface_offset) is appended once;
#         a later Stop on the SAME un-verified surface neither re-warns nor re-logs (a
#         refire-per-Stop would swamp the log and make an FP rate uncomputable).
#         ⚠️ THE KEY CHANGED 2026-08-24: `surface_line` -> `surface_offset`, because a backward
#         scan yields a BYTE offset and a line index is unknowable without reading from the
#         front — which is the whole cost this change removes. Consequence, accepted: entries
#         written before that date can never match a new one, so an in-flight transcript earns
#         ONE duplicate advisory at the changeover and is then deduped normally again. Same
#         precedent the paragraph below already records for legacy entries lacking `transcript`.

# ⛔ THIS ADVISORY STAYS ON BARE STDERR — DELIBERATE, MEASURED, DO NOT "FIX" IT.
# Every other warn-mode hook in this repo was converted to hookSpecificOutput.additionalContext
# because bare stderr delivers ZERO text to the model. Stop is the ONE event where that
# remedy is worse than the disease. Measured 2026-08-25 in a throwaway rig, two arms,
# only the emit channel varying:
#     Stop + additionalContext -> reaches the model, and the hook FIRED 9x against the
#                                 other arm 1, because Stop runs at turn END so anything
#                                 reaching the model there forces a CONTINUATION. The
#                                 model final answer became the canary; the task was lost.
#     Stop + bare stderr       -> does not reach the model, 1 fire.
# The DIRECTION is structural, not a sample: it follows from the event contract, so no
# further measurement can reverse it. Only the magnitude (9) is empirical.
set -u
[[ "${SKIP_MAIL_RELAY_CHECK:-}" == "1" ]] && exit 0

payload=$(cat 2>/dev/null || echo "{}")

# Env var (NOT a pipe): the <<'PY' heredoc owns python's stdin, so a pipe would be
# discarded and json.load(stdin) would read nothing (the defer-loc-check.sh lesson).
# ⛔ PAYLOAD VIA TEMP FILE, NEVER AN ENV VAR. macOS caps env+args at ~1 MB
# (bisected on this box: 1,019 KB ok / 1,024 KB E2BIG). Past the cap `execve` fails,
# python NEVER STARTS, and bash's non-zero is swallowed by this script's trailing
# `exit 0` — the harness records `exitCode: 0` and the gate is SILENTLY OPEN. Measured
# 21x in ONE session on the sibling LOC gate this pattern came from.
# A fire-log still looks healthy because the failure is SIZE-SELECTIVE: small payloads
# pass, and the largest payloads sail through unchecked.
# FAIL LOUD, NOT SILENT. This gate fails OPEN when it cannot stage its
# payload — correct for a warn hook (a transient /tmp failure must not block
# work) — but a bare `|| exit 0` makes the ERROR path byte-identical to the
# PASS path: exit 0, no output, indistinguishable from "ran and found
# nothing". That is how the GNU-mktemp defect (fixed 2026-08-10) left this
# gate INERT on every Linux box for its whole life, seen by nothing except
# CI's smoke suite. Announcing costs one line and turns a silent blind spot
# into a diagnosis.
_pf=$(mktemp "${TMPDIR:-/tmp}/hookpayload.XXXXXX") || {
  echo "mail-relay-staleness-warn: could not create a payload temp file — GATE INERT for this invocation" >&2
  exit 0
}
printf '%s' "$payload" > "$_pf"
trap 'rm -f "$_pf"' EXIT
MAIL_RELAY_PAYLOAD_FILE="$_pf" python3 - <<'PY'
import json, os, sys, re, datetime

try:
    with open(os.environ["MAIL_RELAY_PAYLOAD_FILE"], encoding="utf-8") as _pfh:
        p = json.load(_pfh)
except Exception:
    sys.exit(0)

tpath = p.get("transcript_path") or ""
if not tpath or not os.path.isfile(tpath):
    sys.exit(0)

DELIM = "===== SESSION-MAIL"   # the surfaced advisory-block marker (mail-check / mail-listen / SessionStart)
# Ground-truth verification an assistant turn can carry AFTER a surface. Tool-call shapes:
# a Bash git/rg/grep command, or a Read/Grep tool_use naming a tracker artifact.
GT = re.compile(
    r"\bgit\s+(log|show|status|diff)\b|whose-edit|check-overlap|"
    r"\b(rg|grep)\b[^\n]*\b(DECISIONS|BACKLOG|todo|project_|flows|tracker)\b|"
    r'"name":\s*"(Read|Grep)"[^\n]*(DECISIONS|BACKLOG|todo|project_|flows|\.md)',
    re.I)

# ⛔ BACKWARD SCAN FROM EOF (2026-08-24). BOTH facts this hook needs — the LAST surface, and
# whether a ground-truth call followed it — live at the END of the transcript by construction,
# and the forward loop this replaces paid O(whole file) to reach them. Measured on an 808 MB
# transcript, IDENTICAL verdict: 32.49 s forward vs 0.05 s backward (the surface sat 14 KB from
# EOF). The cost scaled with session length, so it was worst on exactly the long-lived seats that
# surface the most mail — i.e. the ones this net exists for.
#
# Scanning backward, whichever marker we meet FIRST settles it, and this is decision-identical
# to the forward loop rather than an approximation of it:
#   GT first    -> a ground-truth call sits after the latest surface, OR no surface exists at
#                  all. The forward loop exited 0 in BOTH of those cases, so breaking here is
#                  exact, not a heuristic.
#   DELIM first -> nothing verified since the latest surface -> WARN.
# Parity checked against a verbatim copy of the old loop over 10 edge fixtures (no mail · mail
# then GT · mail with nothing after · GT only BEFORE the mail · two mails with GT after the
# first only · DELIM and GT on ONE line · empty · no trailing newline ×2 · mail as last line)
# plus the live 808 MB transcript: 11/11 same decision.
#
# ⚠️ DELIBERATELY UNCAPPED — and a later measurement STRENGTHENED this: 171/171 live transcripts
# terminate within 193 KB, max 0.010 s, the 810 MB one included. A distance cap buys nothing and
# costs detection, because a surface older than the cap would silently stop being checked.
# ⛔ BUT "THE WORST CASE EQUALS THE OLD COST AND IS NEVER WORSE" WAS FALSE AND IS CORRECTED HERE —
# REFUTED 22x. The OLD forward loop short-circuited its regex behind
# `last_surface >= 0`, so it paid `GT.search` only AFTER a surface; a backward scan cannot do that.
# Measured on a 200 MB transcript with NO DELIM and NO GT: OLD 0.45 s -> NEW 10.02 s, reproduced
# twice. The honest claim is **never worse WHEN A MARKER EXISTS** (with a DELIM present: 9.70 vs
# 9.95 s). Live exposure is nil — only 2 of 171 transcripts need full traversal and they are 236 B
# and 222 B — but the sentence as written was a false absolute in an always-read file.
# ⚠️ CAPPING SCAN DISTANCE and BOUNDING REASSEMBLY MEMORY are TWO decisions, not one; refusing the
# first does not license skipping the second. See the bytearray note in `_reverse_lines`.
def _reverse_lines(path, chunk=None):
    """Yield (text, byte_offset_of_line_start) from EOF backward, no cap."""
    if chunk is None:
        # Env-overridable ONLY so the smoke fixtures can reach the second iteration of the loop
        # below. Every committed fixture is 54-270 B against a 1 MB chunk, so at the production
        # size NONE of them can cross a chunk seam — measured: a seam-only mutant (one that
        # mis-stitches a line spanning two reads) PASSED 4/4 smoke arms while returning `quiet`
        # on a straddling transcript. At MAIL_RELAY_CHUNK=7 six of those same fixtures kill it,
        # at zero repo weight. The seam path is LIVE, not theoretical: 60 lines on this box
        # exceed 1 MB, longest 1,887,330 B.
        # Non-numeric / zero falls back rather than raising — a raise here would be swallowed by
        # the `except Exception: sys.exit(0)` below and silently disable the gate.
        _c = os.environ.get("MAIL_RELAY_CHUNK", "")
        chunk = int(_c) if _c.isdigit() and int(_c) != 0 else (1 << 20)
    with open(path, "rb") as fh:
        fh.seek(0, os.SEEK_END)
        pos = fh.tell()
        # ⛔ PEAK MEMORY IS ~QUADRATIC IN MAX LINE LENGTH unless the carry is both PREPENDED IN
        # PLACE and never re-materialised. Two ways to get this wrong, and the second one LOOKS
        # like the fix: `buf = fh.read(step) + tail` re-concatenates the carry every iteration,
        # and `tail[:0] = fh.read(step)` followed by `bytes(tail).split(b"\n")` removes that copy
        # and adds an identical one — so the ALLOCATION COUNT is unchanged and the growth class
        # survives the "fix".
        # ⛔ READ THE INCREMENTS, NEVER A DELTA — a delta between two of these forms CROSSES OVER
        # and will tell you the opposite thing on a different fixture. Peak RSS, single-line
        # fixtures, this box:
        #        MB     concat   prepend-only   this form
        #         8       63.7        108.0         39.7
        #        16      180.1        232.3         63.6
        #        24      361.4        383.2         87.7
        #        32      604.4        551.3        111.7
        #        64     2222.6       2140.1        209.6
        # increments per 8 MB — this form +23.9 / +24.1 / +24.0 CONSTANT (linear); concat
        # +116.4 / +181.3 / +243.0 and prepend-only +124.3 / +150.9 / +168.1, both GROWING
        # (superlinear). THAT is the invariant, and it is fixture-independent by construction: a
        # linear form has constant increments at every size, a quadratic one cannot.
        # ⚠️ Whereas prepend-only vs concat reads +70% / +29% / +6% / -9% / -4% across those same
        # rows — it crosses over between 24 and 32 MB here, and a second seat measuring only up to
        # 32 MB on another box read +47% and concluded the one-liner was WORSE than the defect.
        # Both readings were correct and neither is a fact about the code. Only the class is.
        # (The fixture-size sweep settled it, 2026-08-24.)
        # ⚠️ So the prescribed one-liner is necessary and NOT sufficient; the
        # load-bearing part is that NOTHING in the loop materialises the accumulated carry. Hence
        # `find` + `del` below: when a line spans chunks there is no newline yet, so the iteration
        # copies nothing at all.
        # ⚠️ WHY IT IS NOT MERELY SLOW: `MemoryError` is swallowed by the `except Exception:
        # sys.exit(0)` below, so the blow-up fails SILENT — the gate simply stops warning and
        # looks identical to a clean run. Fleet max line is 5.92 MB today, so this was LATENT,
        # not live.
        carry = bytearray()                    # bytes BEFORE `pos` that form an incomplete line
        while pos > 0:
            step = min(chunk, pos)
            pos -= step
            fh.seek(pos)
            carry[:0] = fh.read(step)          # prepend in place — no realloc of the carry
            nl = carry.find(b"\n")
            if nl < 0:
                continue                       # no complete line yet; carry grows, nothing copied
            body = bytes(carry[nl + 1:])       # the newly-completed region ONLY
            del carry[nl:]                     # in place: carry = incomplete head, newline dropped
            parts = body.split(b"\n")
            off = pos + nl + 1                 # first COMPLETE line begins here
            starts = []
            for _pt in parts:
                starts.append(off)
                off += len(_pt) + 1
            for _pt, _st in zip(reversed(parts), reversed(starts)):
                yield _pt.decode("utf-8", "ignore"), _st
        if carry:
            yield bytes(carry).decode("utf-8", "ignore"), 0

surface_off = -1   # BYTE offset of the line carrying the most recent surfaced SESSION-MAIL block
try:
    for _text, _off in _reverse_lines(tpath):
        if DELIM in _text:
            surface_off = _off
            break                              # the LATEST surface; nothing after it was ground truth
        if GT.search(_text):
            sys.exit(0)                        # GT after the latest surface, or no surface at all
except Exception:
    sys.exit(0)

if surface_off < 0:
    sys.exit(0)   # no mail surfaced this session

# Fire-once-per-surface dedupe: if this exact (transcript, surface_offset) already fired,
# skip BOTH the re-warn and the duplicate log line — a surface only earns ONE calibration
# entry, however many Stops elapse before a git command lands. (Legacy entries lack the
# `transcript` field and never match — they can't suppress a new-format fire.)
log_path = None
try:
    root = os.popen("git rev-parse --show-toplevel 2>/dev/null").read().strip()
    if root:
        log_path = os.path.join(root, ".claude", "logs", "mail-relay-staleness-fires.jsonl")
except Exception:
    pass
if log_path and os.path.isfile(log_path):
    try:
        with open(log_path, errors="ignore") as fh:
            for line in fh:
                try:
                    prev = json.loads(line)
                except Exception:
                    continue
                if prev.get("transcript") == tpath and prev.get("surface_offset") == surface_off:
                    sys.exit(0)   # already warned+logged for THIS surface
    except Exception:
        pass

e = sys.stderr
print("", file=e)
print("📬 MAIL-RELAY STALENESS WARNING (mail-relay-staleness-warn.sh — WARN-ONLY):", file=e)
print("   A SESSION-MAIL block was surfaced this session and NO ground-truth tool call", file=e)
print("   (git log / git show / whose-edit / Read a tracker) fired after the latest surface.", file=e)
print("   IF you RELAYED or ACTED on its state-claim ('#X not launched' / 'blocked on Y' /", file=e)
print("   'already did Z'): VERIFY it against git/tracker FIRST — a mail is a point-in-time", file=e)
print("   snapshot. If you only no-op'd / noted it for later, ignore this.", file=e)
print("   Mode: warn-only (approximate — can't read relay-intent). Escape: SKIP_MAIL_RELAY_CHECK=1", file=e)
print("", file=e)

# Calibration log (best-effort; never affects exit). MAIL_RELAY_NO_LOG=1 suppresses the
# append ONLY (smoke/fixture runs assert the warn output above without polluting the log).
try:
    if os.environ.get("MAIL_RELAY_NO_LOG") != "1" and log_path:
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(log_path, "a") as fh:
            fh.write(json.dumps({"ts": ts, "surface_offset": surface_off, "transcript": tpath}) + "\n")
except Exception:
    pass
PY

exit 0
