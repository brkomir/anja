#!/usr/bin/env bash
# always-loaded-claim-warn.sh — PreToolUse(Edit|Write|Bash), WARN-mode (never blocks).
#
# WHY (graduated to a guard at occurrence 3, not 2):
#   An ALWAYS-LOADED file (.claude/rules/*.md, CLAUDE.md, AGENTS.md, the orchestrator band)
#   is the highest-blast-radius place in the repo to be wrong, and the ONLY one with no guard.
#   A stale tracker row misleads whoever greps it — bounded, and that reader is already looking
#   at state. A stale always-loaded rule misleads EVERY session, silently, at composition time,
#   forever: nobody audits it, and its readers are not looking for state — they are absorbing
#   an invariant.
#
# MEASURED CORPUS (2026-07-13 — the pattern set is EARNED, not assumed; a guard whose parser is
# inherited rather than corpus-measured re-inherits the blindness it was built to fix):
#   1. LIVE-STATE   nextjs.md told every session for 3 days that password recovery was 404ing on
#                   live prod. It had shipped + deployed. The tracker was right the whole time.
#                   The FIRST fix for it was itself incomplete — it struck the `UNPUSHED` clause
#                   and left the present-tense sibling sentence standing. -> Check B.
#   2. STALE CITE   a rules file cited a category symbol in an enforcement module. That symbol
#                   exists NOWHERE in src/. The real one had a different name and was defined in
#                   a sibling file. An always-loaded SECURITY rule governing an enforcement cascade
#                   pointed at a symbol nobody could grep. -> Check A (deterministic).
#   3. COUNT DRIFT  already guarded (architecture-counts.mjs + skill-lint NARRATIVE_COUNT_DRIFT).
#                   Deliberately NOT re-implemented here.
#   4. FIDELITY     a rule mis-stating its canonical source (anti-patterns #9, reverted).
#                   Semantic; no mechanical catch exists. Deliberately out of scope.
#
# WARN-ONLY by design: Check B is a prose heuristic, and a prose gate's detection surface
# IS the text a blocked author would rewrite — a hard block there teaches evasion, not accuracy.
# Escape: SKIP_ALWAYS_LOADED_CLAIM=1

set -uo pipefail

# This warn must reach the MODEL, not only the terminal: a bare-stderr PreToolUse warn is
# invisible to it (measured twice — see lib/warn-emit.sh). The inline fallback keeps this
# hook behaving exactly as before if the lib is ever missing or unreadable.
# ⛔ FALLBACK FIRST, AND ERREXIT SUSPENDED ACROSS THE SOURCE — `.` is a POSIX SPECIAL
# BUILTIN, so under `set -e` a failed source is FATAL to the shell and `|| true` CANNOT
# rescue it. Measured 2026-08-24: a corrupt lib under `set -e` / `set -euo pipefail`
# exits **rc=2** — which is the PreToolUse BLOCK code — and a missing one exits rc=1;
# in both cases execution never reaches the next line. On a matcher=Bash hook that would
# DENY EVERY BASH CALL for every seat, with the SKIP_* escape unreachable because it sits
# below the fatal line. Defining the fallback first and suspending errexit only across the
# source makes a broken lib degrade to stderr-only instead of to a fleet-wide block.
# ⛔ HANDLES BOTH CALL SHAPES, and that is not tidiness. A bash function does NOT forward its
# arguments to a command in its body, so the old `warn_emit() { cat >&2; }` ran `cat` with NO
# args on an ARGUMENT call — reading stdin instead. Measured: advisory LOST at stdin EOF,
# HANGS with stdin open. The fallback exists for the case where the lib does not resolve, and
# in that exact case an argument-form caller emitted nothing at all.
warn_emit() { if [ "$#" -gt 0 ]; then printf '%s\n' "$*" >&2; else cat >&2; fi; }
# ⛔ BOTH arms of this `case` assign, and the `*)` arm is LOAD-BEARING IN SIX OF THE NINE
# hooks — the ones running `set -u` WITHOUT `-e`. It reads like defensive boilerplate and
# is exactly the kind of arm a tidier deletes. Delete it and the restore line below
# dereferences an UNSET variable, `set -u` kills the hook, and this fleet-lockout FIX
# BECOMES A FLEET LOCKOUT. (The failure mode is confirmed real:
# `bash: _WE_HAD_E: unbound variable`.)
case $- in *e*) _WE_HAD_E=1 ;; *) _WE_HAD_E=0 ;; esac
set +e
. "$(dirname "${BASH_SOURCE[0]}")/lib/warn-emit.sh" 2>/dev/null
# Returns rc=1 when the flag is 0 — harmless ONLY because a normal statement always
# follows and discards the status, and because errexit is off in exactly the hooks where
# it returns 1. ⚠️ It must never become the LAST line of a file.
[ "$_WE_HAD_E" = 1 ] && set -e
unset _WE_HAD_E
[ "${SKIP_ALWAYS_LOADED_CLAIM:-0}" = "1" ] && exit 0

payload=$(cat 2>/dev/null || true)
# Cheap shell gate BEFORE the python spawn — a non-rules edit must cost ~0ms.
# (The defer-loc-check-bash.sh lesson: an early-exit INSIDE python is not an early exit.)
case "$payload" in
  *.claude/rules/*|*CLAUDE.md*|*AGENTS.md*|*.claude/orchestrator/*) ;;
  *) exit 0 ;;
esac

# NOTE the payload goes through the ENVIRONMENT, not a pipe. `python3 - <<'PY'` takes its
# SCRIPT from stdin, so a piped payload never reaches `json.load(sys.stdin)` — the heredoc
# wins and the hook exits silently, INERT. The first cut of this hook shipped exactly that
# and was SILENT on both real instances it was built to catch; every SAFE test still passed,
# because a hook that never fires passes every negative test. Only the FIRE test caught it.
# (The wired-but-inert class. Never ship a guard on SAFE assertions alone.)
# ⛔ PAYLOAD VIA TEMP FILE, NEVER AN ENV VAR. macOS caps env+args at ~1 MB
# (bisected on this box: 1,019 KB ok / 1,024 KB E2BIG). Past the cap `execve` fails,
# python NEVER STARTS, and bash's non-zero is swallowed by this script's trailing
# `exit 0` — the harness records `exitCode: 0` and the gate is SILENTLY OPEN. Measured
# 21x in ONE session, every one on the file this hook exists to inspect. The
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
  echo "always-loaded-claim-warn: could not create a payload temp file — GATE INERT for this invocation" >&2
  exit 0
}
printf '%s' "$payload" > "$_pf"
trap 'rm -f "$_pf"' EXIT
export _ALC_PAYLOAD_FILE="$_pf"
python3 <<'PY' | warn_emit || true
import json, os, re, sys, time

# Anchor to the SCRIPT, never the cwd. Hooks INHERIT the session cwd, which any bare `cd`
# moves — and Check A resolves cited paths against this. A cwd-relative REPO would make
# every citation mis-resolve after a `cd` (and the same disease was found
# in wrap-reconcile.mjs today: a relative `cat` read "0 persisted" from any other cwd).
REPO = os.environ.get("CLAUDE_PROJECT_DIR") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(".claude/hooks/x"))))
if not os.path.isdir(os.path.join(REPO, ".claude")):
    import subprocess
    try:
        REPO = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, timeout=5).stdout.strip() or os.getcwd()
    except Exception:
        REPO = os.getcwd()
try:
    with open(os.environ["_ALC_PAYLOAD_FILE"], encoding="utf-8") as _pfh:
        p = json.load(_pfh)
except Exception:
    sys.exit(0)

ti = p.get("tool_input") or {}
tool = p.get("tool_name") or ""

# ── target + added-content extraction (Edit / Write / Bash-heredoc) ──────────────
path = ti.get("file_path") or ""
added = ""
if tool in ("Edit", "MultiEdit"):
    added = ti.get("new_string") or ""
elif tool == "Write":
    added = ti.get("content") or ""
elif tool == "Bash":
    cmd = ti.get("command") or ""
    # ⛔ THE PATH MUST COME FROM THE WRITE TARGET, NOT A FREE-TEXT SCAN.
    # This was a bare search over the WHOLE command with no relation to the redirect, so the hook
    # graded by MENTION: a heredoc appending to the tracker whose BODY named a rules file fired and
    # told the author "perishable STATE belongs in the tracker" — which is exactly where they were
    # writing it. Measured live on tracker and plan-document targets, both firing. Base rate is low
    # (2 of 279 on the real corpus, 2.6% on the tracker-row population) so the cost was a MISDIRECTED
    # INSTRUCTION rather than a noise storm — which is the kind that gets obeyed.
    # Anchored on the write verb instead: >, >>, tee, tee -a, sed -i ''.
    TARGET = r"(\.claude/rules/[\w.-]+\.md|CLAUDE\.md|AGENTS\.md|\.claude/orchestrator/[\w.-]+\.md)"
    m = re.search(r">>?\s*" + TARGET, cmd)
    if not m:
        m = re.search(r"tee\s+(?:-a\s+)?" + TARGET, cmd)
    if not m:
        # ⛔ `|` IS NOT EXCLUDED, DELIBERATELY — `s|old|new|` is the HOUSE sed idiom here
        # (bash-environment.md's own worked examples use it), so a `[^|;&]` class made the
        # single most likely real write INVISIBLE while the slash form fired. Measured
        # 2026-08-18: `sed -i '' "s|X|Y|" .claude/rules/x.md` -> silent, `s/X/Y/` -> FIRE.
        # The trade is a false positive against a silent miss of the exact write this guard
        # exists to catch; at warn-mode a spurious line costs one read and the miss costs
        # nothing being caught at all. `;` and `&` stay excluded — those genuinely start a
        # different command, and a rules path after one is a MENTION, not this sed's target.
        # ⚠️ THE FP IS NARROWER THAN A REGEX-ONLY PROBE SAYS, AND THE FIRST WRITE-UP OF THIS
        # COMMENT OVERSTATED IT — measured end-to-end 2026-08-18 against the whole hook, not
        # just this pattern: `sed … foo.txt | grep <rules path>` is SILENT, because matching
        # the path only sets the target; a warn still needs CHECK A or CHECK B to fire. The
        # FP therefore requires the pipe AND a phantom citation or live-state claim in the
        # SAME command — it fires (verified), but it is not the everyday shape. Probing the
        # regex alone answers "does the target extract", never "does the guard speak".
        # `;`/`&` verified silent on the same three-payload run, target form FIRES.
        m = re.search(r"sed\s+-i\s*(?:''|\"\")?\s+[^;&]*?" + TARGET, cmd)
    if m:
        path = m.group(1)
    h = re.search(r"<<-?\s*[\"']?(\w+)[\"']?\r?\n(.*?)\r?\n[ \t]*\1\b", cmd, re.S)
    added = h.group(2) if h else cmd

ALWAYS_LOADED = re.compile(r"(^|/)(\.claude/rules/[\w.-]+\.md|CLAUDE\.md|AGENTS\.md|\.claude/orchestrator/[\w.-]+\.md)$")
# ── WRITE-DETECT LEDGER — the TP denominator the block-half wiring decision needs.
# This hook only SPEAKS when Check A/B fires, so a CLEAN shell append to a band file is
# invisible: warn-mode on Bash has run since 2026-08-18 and produced zero recoverable
# evidence, leaving the SC-3 observation window uninstrumented. Log every resolved band
# write-target independent of the warns. Never blocks; on any failure it is a no-op.
# ⛔ A RECORD IS AN EXTRACTED WRITE-TARGET, NOT A CONFIRMED WRITE. A command that merely
# QUOTES a redirect — a probe payload, a smoke arm, prose about this hook — records
# identically to a real append: measured 3 of 3 mentions in the first minutes live, with
# every band file unchanged. Classify each record against `git status`/mtime before
# quoting any count, and never call the raw total a true-positive rate.
if tool == "Bash" and path and ALWAYS_LOADED.search(path):
    try:
        _lg = os.path.join(os.environ.get("HOOK_FIRES_LOG_DIR") or os.path.join(REPO, ".claude", "logs"), "always-loaded-bash-write.jsonl")  # the smoke suite exports HOOK_FIRES_LOG_DIR; 1,422 of 1,437 rows 2026-09-13..10-09 were its alc() fixtures
        os.makedirs(os.path.dirname(_lg), exist_ok=True)
        with open(_lg, "a", encoding="utf-8") as _fh:
            _fh.write(json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                  "target": path, "sid": p.get("session_id") or "", "agent_id": p.get("agent_id") or "", "cmd": (ti.get("command") or "")[:400]}) + "\n")
    except Exception:
        pass

if not path or not ALWAYS_LOADED.search(path) or not added.strip():
    sys.exit(0)

warns = []

# ── CHECK A — CITATION RESOLVER (deterministic; aimed at phantom symbols) ──
# A rule citing `SYMBOL` alongside `path/to/file.ts` must have BOTH resolve. Either the
# path is gone or the symbol was renamed — both are silent, both mislead every session.
for cm in re.finditer(r"`([A-Za-z_][A-Za-z0-9_]{4,})`[^`\n]{0,80}?`((?:src|scripts|tests)/[\w./-]+\.\w+)`", added):
    sym, fp = cm.group(1), cm.group(2)
    full = os.path.join(REPO, fp)
    if not os.path.exists(full):
        warns.append(f"CITE: `{fp}` does not exist (cited for `{sym}`)")
        continue
    try:
        with open(full, "r", errors="replace") as fh:
            if sym not in fh.read():
                warns.append(f"CITE: `{sym}` is NOT in `{fp}` — renamed or removed? (an always-loaded rule citing a phantom symbol is ungreppable for every session)")
    except Exception:
        pass

# ── CHECK B — LIVE-STATE CLAIM (heuristic; requires a CONCRETE REFERENT) ─────────
# The referent requirement is what separates a real state-claim ("404 on `example.photo`")
# from ordinary rule prose ("the guard is DEAD in prod while the suite stays green"). Without
# it the detector produced ~13 false positives on the live corpus and would train SKIP=1.
STATE = re.compile(
    r"\b(is|are|remains?|stays?)\s+(still\s+|currently\s+|now\s+)?(broken|failing|down|404|unfixed|unpushed|undeployed|unapplied)\b"
    r"|\bUNPUSHED\b|\bpersists?\s+(until|in\s+prod)\b"
    r"|\b(not\s+yet|never)\s+(been\s+)?(deployed|pushed|applied|shipped|landed)\b"
    r"|\bstill\s+(404|broken|failing|down)\b", re.I)
REFERENT = re.compile(r"\b[a-z0-9-]+\.(?:com|io|app|dev|photo|net|org)\b|\b[0-9a-f]{7,40}\b|\b20\d\d-\d\d-\d\d\b|`(?:src|supabase|scripts)/", re.I)
PAST_OK = re.compile(r"\bHISTORICAL\b|\bRESOLVED\b|\bwas\b|\bwere\b|\b404'd\b|\bformerly\b", re.I)

for ln in added.splitlines():
    if STATE.search(ln) and REFERENT.search(ln) and not PAST_OK.search(ln):
        warns.append(f"STATE: perishable live-state claim + a concrete referent → «{ln.strip()[:95]}»")

if not warns:
    sys.exit(0)

print("")
print(f"⚠️  always-loaded-claim-warn — {os.path.basename(path)} (warn-only)")
for w in warns[:6]:
    print(f"   • {w}")
print("   → An always-loaded file carries the INVARIANT. Perishable STATE belongs in the tracker,")
print("     and the rule POINTS at it. If state must appear as evidence: past tense + mark it")
print("     HISTORICAL. A stale rule misleads EVERY session, silently, forever — the tracker")
print("     being right does not rescue you, because nobody reads the tracker.")
print("   Escape: export SKIP_ALWAYS_LOADED_CLAIM=1 in the SESSION env — setting it inline on\n            the command does NOT reach this hook process (measured 2026-08-18).")
PY
exit 0
