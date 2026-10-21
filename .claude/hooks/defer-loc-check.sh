#!/usr/bin/env bash
# PostToolUse(Edit|Write) hook — defer-residue net.
#
# A defer DECISION is a cognitive act with no tool call → un-hookable; the
# always-loaded sniff-test scope-down trigger (8b) catches it at composition
# time (pre-emission). But the defer RESIDUE — a vague-later line WRITTEN to the
# defer tracker (todo.txt) — is a greppable disk artifact. This hook is the
# post-write backstop: when a NEWLY-ADDED todo.txt line uses vague-defer
# language WITHOUT an LOC estimate, it warns. It scans only the Edit's
# new_string / Write's content (the changed region), never the whole tracker, so
# it does not re-flag pre-existing defers.
#
# WHY a hook and not just the rule: a remedy that is a judgment-RESTRAINT
# ("resist the vague defer") under-fires regardless of priming; the checkable
# ARTIFACT (the written line) is what a hook can observe. This is the action-form
# backstop for the restraint. The sniff-test trigger is the
# decision-moment layer; this is the residue layer (defense in depth).
#
# Enforces two rules: a defer carries an LOC estimate (<15 LOC → ship, never defer),
#   and a deferral goes to todo.txt WITH a trigger.
# MODE: WARN-ONLY (exit 0, never blocks — warn-first). Promote to block
#   (exit 2) after >=2 distinct-session fires confirm low FP (SC-2).
# Escape: SKIP_DEFER_LOC_CHECK=1
# Log:    .claude/logs/defer-loc-check-fires.jsonl (FP / cadence calibration)
#         DEFER_LOC_NO_LOG=1 suppresses the log write only (smoke-test guard —
#         keeps fixture fires out of the calibration instrument; the sibling
#         maxl-prose-grep-warn.sh MAXL_GREP_NO_LOG pattern). Historical entries
#         with file="/x/todo.txt" (2026-06-21..07-11) are smoke-fixture noise —
#         consumers MUST filter them out — exclude any `file` starting with `/x/` (a fixture path IS absolute, so "absolute repo path" alone doesn't discriminate; the `/x/` prefix is the discriminator).

set -u

# Model-aimed advisory on PostToolUse: it tells the ACTOR its own just-written defer is
# missing an LOC estimate. Measured 2026-08-25 — bare stderr delivers ZERO text to the model
# on this event. WARN_EMIT_EVENT is REQUIRED; the lib defaults to PreToolUse.
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
[[ "${SKIP_DEFER_LOC_CHECK:-}" == "1" ]] && exit 0

payload=$(cat 2>/dev/null || echo "{}")

# Payload via env var (NOT a pipe): the `<<'PY'` heredoc already owns python's
# stdin (it IS the program), so a `printf | python3 -` pipe would be discarded
# and json.load(stdin) would read nothing. Env var sidesteps the stdin conflict.
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
  echo "defer-loc-check: could not create a payload temp file — GATE INERT for this invocation" >&2
  exit 0
}
printf '%s' "$payload" > "$_pf"
trap 'rm -f "$_pf"' EXIT
# ⛔ SINGLE emit site, so the PIPE is safe here: the lib emit-once guard would not survive a
# subshell, but there is only one call. Verified before switching the handle: EVERY print()
# in the program below routes through `e`, and the calibration log writes to a FILE — so
# stdout is otherwise unused and the JSON cannot be contaminated by stray program output.
# ⚠️ defer-loc-check-bash.sh DELEGATES to this file by piping a synthesized payload in, so
# converting this one emit site covers BOTH hooks. The row called them two candidates; the
# advisory only ever existed once.
DEFER_LOC_PAYLOAD_FILE="$_pf" python3 - <<'PY' | warn_emit || true
import json, sys, re, os, datetime

try:
    with open(os.environ["DEFER_LOC_PAYLOAD_FILE"], encoding="utf-8") as _pfh:
        p = json.load(_pfh)
except Exception:
    sys.exit(0)

ti = p.get("tool_input", {}) or {}
fp = ti.get("file_path", "") or ""
# Scope: the defer tracker only (deferrals live in todo.txt). The feature
# queue is a different discipline → deliberately excluded in v1.
if os.path.basename(fp) != "todo.txt":
    sys.exit(0)

# New/added content: Edit→new_string, Write→content. For an Edit this is just the
# replaced region (low FP); lines also present in old_string are unchanged.
new = ti.get("new_string") or ti.get("content") or ""
old_lines = set((ti.get("old_string") or "").splitlines())

# Vague-later defer vocabulary — mirrors sniff-test trigger 8a. NOT every "- [ ]"
# (a neutral open todo is fine); only the rationalization phrasings.
DEFER = re.compile(
    # token-PROXIMITY, synced to sniff-test trigger 8a (2026-07-12, token-proximity-not-fixed-bigram): the
    # drafts carry morphologically-variable defer-language — a fixed-bigram scan under-fired ~5× (13% vs
    # 78% reach over the 32 historical surfaced-defer drafts; post-hoc corpus, floor/ceiling).
    # Kept defer-SPECIFIC (no bare "optional"/"future") to bound FP on this live residue net (warn-only;
    # todo.txt-scoped, 8 peer sessions). Keyword groups \b-ANCHORED + the noun-form "deferred" DROPPED
    # (else "test the deferred-cascade parity" / "by-pass" substring FP + fresh-log re-pollute).
    r"post-?launch|revisit( later| when| after)|out[ -]of[ -](today.?s )?scope|"
    r"tech debt|future[ \w-]*?\b(commit|sweep|pass|audit|candidate)\b|\bdefer(s|ring)?\b|"
    r"next[ -](session|pass|audit)|watch[ -]?(tier|item)|wait until|wait for .*(complain|signal)|"
    r"track (after|later)|monitor (and|then|post)|(file[ -])?for[ -]later|not actioned|"
    r"optional[ \w-]{0,20}(follow-?up|sequenced)|labell?ed? optional|"
    r"sometime,? not now|separate[ \w-]*?\b(reorg|follow-?up)\b|"
    r"\b(punt|shelve|deprioriti[sz]e|circle back|hold off)\b|"
    # REACHABILITY: these BLOCKER phrases were ABSENT from DEFER, so a line whose ONLY
    # defer signal is the blocker phrase never reached the blocker check — it could not fire on 2 of the
    # phrases it introduced.
    r"needs (a (design|content|schema|product|re-home) decision|prod(uction)? data)", re.I)
# Fix (2026-07-12, `scripts/defer-loc-fire-triage.mjs`): unit-anchor the LOC pattern. The old
# `~\s*[0-9]+` branch accepted a bare tilde-number — so a human-TIME estimate ("~1-2h", "~30 days")
# satisfied the LOC requirement (the exact form the rule bans). Dropped it; "~15 LOC"/"~50 lines"
# still match via the unit-bearing branches.
LOC = re.compile(r"[0-9]+[ \t]*LOC|[0-9]+[ \t]*lines?", re.I)  # [ \t] not \s: \s spans \n → cross-line FALSE has_loc on the joined item body
# meta-block-field awareness (2026-07-12): a `loc-estimate:` FIELD IS an estimate even when its
# value is prose ("loc-estimate: 1 DB query + decision") — the author DID estimate. Counts as residue.
LOC_FIELD = re.compile(r"loc-estimate[ \t]*:", re.I)  # [ \t] not \s (same cross-newline vector as LOC)
HEADER = re.compile(r"^\s{0,3}[-*]\s*\[[ xX~]\]")
# Never flag a defer being CLOSED (marked done / shipped / struck). The WORD tokens are POSITION-ANCHORED
# to item-start: free-floating \bDONE\b / \bCOMPLETE\b / \bRESOLVED\b also matched BLOCKER
# PROSE ("blocked on X being done" / "…is complete" / "…resolved upstream"), so a real unverified-blocker
# defer was skipped as "already closed". Markers ([x] / ✅ / ~~) stay free-floating — they legitimately
# appear anywhere on a closed line.
DONE = re.compile(r"\[x\]|✅|~~|^\s*[-*]?\s*\[?[ xX]?\]?\s*(SHIPPED|DONE|RESOLVED|COMPLETE|STRIKE)\b", re.I)
# A defer whose reason is a NAMED FACT-BLOCKER must carry a `verified:` residue — the command RUN and
# what it RETURNED. A blocker asserted from RECALL is malformed: recall FABRICATES preconditions
# (one session invented a precondition that never existed, and an invented caution reads as
# *diligence*, so nobody audits it). This is the LOC-artifact rule applied to defer-reason (c);
# MVS `:unverified-blocker`, 11% of the class (2026-07-12). Evaluated ONLY on lines DEFER already matched.
#
# HONEST LIMITS (named, NOT hidden; do NOT read this as "FP-safe"):
#   * The DEFER-gate REDUCES but does NOT eliminate FP. Safety rests on WARN-mode tolerance, not on the
#     gate being tight. Accepted warn-mode leaks: `waiting on` fires on quoted UI copy ("'waiting on
#     approval' badge"); `requires … first` fires on feature behavior ("requires the user to click Next
#     first"). Both are lexically IDENTICAL to real blockers — no clean anchor exists; forcing one is lossy.
#   * `not yet verified:` still SUPPRESSES — the suppressor trusts the WORD, not the assertion. (The
#     `un-verified:` inversion IS closed, by the (?<![-\w]) guard below.) Known residual.
#   * ITEM-GRAMMAR shipped 2026-07-12: residue (LOC / loc-estimate: / verified:) is resolved at the
#     ITEM level (disk-context — reads the post-write file for the header of a partial-append), so a
#     continuation line no longer fires when its header/sibling carries the estimate. Measured 47/87 = 54%
#     of real write-stream fires were this class (`scripts/defer-loc-fire-triage.mjs`). Only lines in
#     `new` are evaluated; the file is read ONLY to resolve item context (changed-region scope preserved).
#   * REACHABILITY, BY DESIGN (not an oversight): only the 2 UNAMBIGUOUS blocker phrases ("needs a …
#     decision", "needs prod data") were added to DEFER. The AMBIGUOUS ones ("blocked on" / "waiting on" /
#     "requires … first") stay gated behind a DEFER word — because "- [ ] fix: user gets blocked on upload"
#     is a BUG REPORT, not a defer. So a blocker-only line carrying NO defer word does not fire. That is the
#     conservative trade (FP-control over recall), chosen deliberately.
#   * The residue proves a check was CITED, not honestly RUN — but a cited command is
#     RE-RUNNABLE, so fabrication becomes checkable rather than structurally invisible. That is the gain.
#
# FORWARD-GUARD (SC-2, load-bearing): any BLOCK-mode promotion of this net MUST be gated on the FP/FN items
# above landing first. Warn-tolerable is NOT block-tolerable — the leaks would BLOCK a legitimate todo
# write, and a `not yet verified:` line would silently PASS an explicitly-unverified blocker.
BLOCKER = re.compile(
    r"needs (prod|production) data|needs a (design|content|schema|product|re-home) decision|"
    r"blocked on|blocked by|requires .{0,30}? first|entangled with|can'?t until|cannot until|"
    r"depends on .{0,30}? landing|waiting on", re.I)
# `(?<![-\w])verified\s*:` — the negation-guard: bare `verified:` counts, `un-verified:` does NOT (it was
# matching the substring and SILENCING an explicitly-unverified blocker — the inverse of intent).
# The cue-scoped 3rd branch closes the incidental-backtick escape: a stray `git blame` elsewhere on the
# line no longer satisfies the residue — the command must sit within 30 chars of a verification CUE.
VERIFIED = re.compile(
    r"(?<![-\w])verified\s*:|verified\s*(→|->|=)|"
    r"(verified|checked|confirmed|ran)\b[^`\n]{0,30}`(rg|grep|git|node|npm|psql)\b", re.I)

# ITEM-GRAMMAR (2026-07-12): a todo item is MULTI-LINE (header + indented continuations); the LOC /
# loc-estimate: / verified: residue often sits on a SIBLING line, not the defer line. Resolve each changed
# defer line's ITEM and evaluate residue at the ITEM level. DISK-CONTEXT: read the post-write file (fp) so a
# partial-append (header already on disk, not in new_string) still finds its header; fall back to grouping
# `new` when the file is unreadable (a smoke-fixture path) or the line isn't found.
def build_items(text):
    items, cur = [], None
    for l in text.splitlines():   # .splitlines() (not .split("\n")) → parity with the main loop on a CRLF fallback
        if HEADER.search(l):
            cur = []
            items.append(cur)
        if cur is not None:
            cur.append(l)
    return items

_items = None
def item_residue(ln):
    global _items
    if _items is None:
        text = ""
        try:
            with open(fp) as fh:
                text = fh.read()
        except Exception:
            text = ""
        _items = build_items(text if text else new)
    for it in _items:
        if ln in it:                       # first item containing the line (dup-line: first match, warn-tolerant)
            body = "\n".join(it)
            return (bool(LOC.search(body) or LOC_FIELD.search(body)), bool(VERIFIED.search(body)))
    return (bool(LOC.search(ln) or LOC_FIELD.search(ln)), bool(VERIFIED.search(ln)))  # not found → per-line fallback

findings = []
for ln in new.splitlines():
    if ln in old_lines:        # unchanged line carried in the replacement
        continue
    if DONE.search(ln):        # a defer being completed, not added
        continue
    if not DEFER.search(ln):   # only vague-later defer lines
        continue
    has_loc, has_verified = item_residue(ln)
    # A cited fact-blocker with NO `verified:` residue is malformed EVEN IF the ITEM carries an estimate —
    # the two residues are independent requirements (an estimate always; verified: whenever a blocker is named).
    unverified_blocker = bool(BLOCKER.search(ln)) and not has_verified
    if has_loc and not unverified_blocker:   # well-formed: an estimate present AND any named blocker verified
        continue
    s = ln.strip()
    if s:
        findings.append(("[blocker-unverified] " if unverified_blocker else "") + s[:140])

if not findings:
    sys.exit(0)

e = sys.stdout   # routed to warn_emit by the pipe above; see the note there
print("", file=e)
print("📋 DEFER-LOC WARNING (defer-loc-check.sh — WARN-ONLY):", file=e)
print(f"   File: {fp}", file=e)
print("   Newly-written defer line(s) missing a required residue (LOC estimate · `verified:` for a named blocker):", file=e)
for f in findings:
    print(f"     • {f}", file=e)
print("   Rule: no defer without an LOC estimate. Grep the count (rg -c / read the span);", file=e)
print("        <15 LOC + no hard blocker → ship now, don't defer.", file=e)
print("   Mode: warn-only — residue net for the sniff-test scope-down trigger. Escape: SKIP_DEFER_LOC_CHECK=1", file=e)
print("", file=e)

# Calibration log (best-effort; never affects exit). DEFER_LOC_NO_LOG=1 suppresses
# (smoke-test guard). `session` + `lines` enable the SC-2 distinct-session count +
# FP triage CALIBRATION requires (NOT a promotion ladder — block-mode for this hook is RETIRED on TYPE grounds (2026-07-12): a LEXICAL-PROSE net is TERMINALLY WARN — its detection surface IS the text a blocked author would rewrite, so a hard block teaches evasion, not accuracy. The distinct-session count is a CALIBRATION/FP signal, NOT a promotion ladder. Do not re-inherit the SC-2 block-mode telos) (schema added 2026-07-11).
if os.environ.get("DEFER_LOC_NO_LOG") != "1":
    try:
        root = os.popen("git rev-parse --show-toplevel 2>/dev/null").read().strip()
        if root:
            d = os.path.join(root, ".claude", "logs")
            os.makedirs(d, exist_ok=True)
            ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            with open(os.path.join(d, "defer-loc-check-fires.jsonl"), "a") as fh:
                fh.write(json.dumps({"ts": ts, "file": fp, "n": len(findings),
                                     "session": p.get("session_id", ""),
                                     "lines": findings}) + "\n")
    except Exception:
        pass
PY

exit 0
