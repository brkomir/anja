#!/usr/bin/env bash
# commit-doctrine-inject.sh <k> — PreToolUse (matcher Bash). EVENT-SCOPED delivery of the commit doctrine:
# .claude/orchestrator/commit-doctrine.md arrives on the FIRST commit-shaped Bash call of each compaction epoch,
# not at SessionStart. Registered as ONE settings.json entry with hooks k=0..REGISTERED (one process per part):
#   k=0        the INTERCEPT — denies that first call (nothing in it executes) and tells the model to re-issue it;
#   k=1..n     each delivers one ≤CAP-char part via hookSpecificOutput.additionalContext;
#   k>n        spare (registered headroom; emits nothing).
# Every later commit-shaped call in the epoch is silent (per-part marker files). Compaction wipes the
# delivered copy from the context, so session-start.sh deletes this session's markers on source=compact (and clear,
# which empties the context by construction) and the next commit-shaped call re-delivers. A resume keeps the copy
# (measured), so nothing resets on resume.
#
# WHY: the doctrine was
# SessionStart-delivered into Messages and re-read on every API call; per compaction epoch ~22% of calls sit
# before the epoch's first commit-shaped call, so event delivery removes ≈57.8 KB from that window (≈1% of an
# average call, ≈11% of the doctrine) and — the reason it was built — proves an event-delivery plane with an
# ARRIVAL GUARANTEE: a PreToolUse additionalContext is read WITH the tool result, i.e. after the matched call
# ran, which for a commit is one commit too late; the deny is what puts the doctrine in context BEFORE the
# commit executes. Ceremony-verb keying (git status/diff/add) was rejected: only 5.1% of calls precede it.
#
# MEASURED (rigs A-E, scratchpad throwaway repos, claude -p):
#   · 7 parts × ~9.6K chars in ONE entry all arrive on one matched call; a 12K part vanishes whole → CAP 9,700.
#   · the deny reason lands in the tool_result slot; additionalContext parts ride the SAME denied call.
#   · hooks in one entry run CONCURRENTLY → one marker PER PART (a shared marker races; 3 of 7 saw it mid-write).
#   · a delivered part persists across later calls and across --resume (so no reset on resume).
#   · a sub-agent's Bash call carries the parent's session_id AND transcript_path, plus agent_id/agent_type
#     (null on the main session) → agent_id is the skip discriminator; without it a dispatch consumes the dose.
#
# PREDICATE (folded 2026-09-09 from a code review's CHANGES-REQUESTED — the first version missed 6 of 8
# adversarial commit shapes and false-fired on 3 of 4 mentions): a commit verb at COMMAND POSITION — line start with
# any indentation, after ; & | ( $( — with optional `VAR=… ` / `env` prefixes (the private-index recipe's own
# `GIT_INDEX_FILE=… git commit`), optional bash/sh/zsh/ksh wrapper, ANY path prefix on the two commit tools, and any
# git global options (`git -c … commit`, `git -C … commit`). Mentions are excluded by REUSING
# scripts/subagent-commit-scan.py's machinery — its NON_SHELL-gated heredoc/inline blanking (a `cat`/`python3`
# heredoc is written or interpreted, never run; a `bash <<'EOF'` body IS run and stays), search-pattern blanking,
# and its per-segment is_mention (`bash -n`, `--self-test/--help/--dry-run` on the tools, `git diff -- <tool>`,
# reader commands). Two local widenings on top: the heredoc blank tolerates a redirection after the delimiter
# (`python3 - <<'PY' 2>/dev/null`) and printf/echo quoted arguments are blanked (a JSON fixture literal is data).
# If that import ever fails the hook degrades to the widened regex ALONE — the over-fire direction, where the parts
# still ride the denied call and the cost is one round trip; never the silent-miss direction.
# FAIL DIRECTION: OPEN, everywhere. Unparseable stdin, unreadable source, unwritable state dir, python error →
# deny nothing, and emit nothing except k=1's DARK banner, which names an unreadable source or a state dir it cannot
# write (the second since a later fold; this line named only the first until then). Never exit non-zero: rc=2 is the
# PreToolUse block code and a corrupt hook would lock the fleet out of committing.
# ESCAPES: fleet-wide, SKIP_COMMIT_DOCTRINE_INJECT=1 in settings.json's env block (an inline prefix cannot reach a
# harness-spawned PreToolUse hook; a settings edit shows in a diff). Per SESSION, `touch
# .claude/state/commit-doctrine-<sid8>-escape` — session-keyed and aged out with the markers, so a blocked reader
# cannot switch the fleet off permanently (the first version's un-keyed, never-aged escape file was exactly that).
# STATE: .claude/state/commit-doctrine-<sid8>-part<k> and -escape; <sid8> is .strip().lower()[:8] — the project-wide key
# convention session-start.sh's reset uses (the first version skipped the lowercase and a mixed-case id would
# never have been reset). COMMIT_DOCTRINE_STATE_DIR overrides the dir for the smoke suite.
# REVERSIBILITY: the commit that wired this also removed commit-doctrine.md from orchestrator-inject.sh's list
# and added the reset line to session-start.sh — one `git revert` restores SessionStart delivery whole.
set -uo pipefail
[[ "${SKIP_COMMIT_DOCTRINE_INJECT:-0}" == "1" ]] && exit 0
K="${1:-1}"
DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
STATE="${COMMIT_DOCTRINE_STATE_DIR:-$DIR/.claude/state}"
REGISTERED=16   # 9 parts needed at 2026-09-14 sizes + MIN_HEADROOM=5 spare + 2 for growth; settings.json wires k=0..16
# ⛔ RAISE THIS AND settings.json TOGETHER — the smoke suite asserts both: k=0..REGISTERED wired exactly, and parts <=
# REGISTERED - MIN_HEADROOM. It read 13 (8+5, exact) until 2026-09-14, when the corpus reached 9 parts and the headroom arm
# went RED on a push-gating suite. The +2 is deliberate: at exact sizing a single part of growth re-blocks a push and needs
# another owner-run edit of the protected settings file. ⛔ BUT A SPARE IS NOT STRUCTURALLY CHEAP, AND ITS COST HAS TWO
# TIERS. Tier 0: every slot costs bash + cat on EVERY Bash call. Tier 1: when "commit" appears ANYWHERE in the hook
# payload (the command, the description or the cwd, because the pre-filter below tests the whole JSON), every
# MAIN-SESSION slot, spares included, also runs python: the scanner import, the doctrine read and the chunk loop, since n
# is what k > n tests. A sub-agent's call exits at the agent_id pre-filter before any spawn, so it pays tier 0 only.
# One slot alone, median of 25 (2026-09-14): tier 0 ~4.4 ms, tier 1 ~38 ms. What the +2 adds to one Bash call with every
# slot running at once: ~+1.5 to +3 ms at tier 0 and ~+8 to +12 ms at tier 1 (two review lenses, two rigs). The
# +2 is fine because 2 is small, not because spares are cheap. MIN_HEADROOM is one margin and the +2 is the second:
# refuse a third. ⚠️ THOSE FIGURES ASSUME THE HARNESS SETS CLAUDE_PROJECT_DIR FOR HOOKS, AND NOBODY HAS CHECKED. Unset,
# the root ladder above runs git rev-parse in every slot on every Bash call, which took one slot from ~4.4 to ~11.9 ms at
# tier 0 and from ~38 to ~49 ms at tier 1; every settings.json command line carries a second copy of that fallback,
# unmeasured.
# ⚠️ AND THE CEILING THE +2 RAISES IS PARTLY EXTRAPOLATED, ON TWO AXES. COUNT: 11 = 16 - 5 is the SUITE's alarm (it goes
# RED above 11 parts); the hook itself registers 16 and would try to deliver up to 16. 9 of 9 parts, ~63K characters,
# reached the model on each of three denied calls with 14 hooks registered and on two with 17 (2026-09-14); 10 or more
# on one call are unmeasured. SIZE, the axis of the only arrival failure this file records (the 12K part behind CAP):
# 11 parts would be ~77K characters at today's packing and up to ~103K at the chunker's ceiling, 1.2x to 1.6x the
# largest payload seen to arrive.
# (Until 2026-09-14 this read "each spare costs one no-op bash spawn per Bash call", wrong on both counts; then, until
# a later fold, it priced the +2 at "≈ +1.5 ms per Bash call", the cheap tier's figure with no tier named.)
MIN_HEADROOM=5   # the smoke suite goes RED when fewer spare parts than this remain below REGISTERED (same floor as orchestrator-inject.sh)
CAP=9700
INPUT="$(cat 2>/dev/null || true)"
# Cheap pre-filters in bash, before any spawn: a call that never mentions a commit verb needs no interpreter, and a
# sub-agent's call (agent_id carries a string; the main session's is null/absent) is never ours — measured:
# 14 python spawns per commit-mentioning sub-agent call without this.
case "$INPUT" in *commit*) ;; *) exit 0 ;; esac
case "$INPUT" in *'"agent_id":"'*|*'"agent_id": "'*) exit 0 ;; esac
PF="$(mktemp 2>/dev/null)" || exit 0
printf '%s' "$INPUT" > "$PF"
python3 - "$DIR" "$STATE" "$K" "$REGISTERED" "$CAP" "$PF" <<'PY' 2>/dev/null || true
import json, sys, os, re
root, state, k, registered, cap, pf = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), sys.argv[6]
try:
    d = json.load(open(pf, encoding="utf8"))
except Exception:
    sys.exit(0)
if d.get("tool_name") != "Bash":
    sys.exit(0)
if d.get("agent_id"):                       # a dispatched sub-agent: never deliver, never spend the dose
    sys.exit(0)
cmd = (d.get("tool_input") or {}).get("command") or ""
if not isinstance(cmd, str):
    sys.exit(0)
# --- predicate: the sibling scanner's mention machinery + a commit-scoped verb regex that covers the adversarial
#     shapes (indented / multi-line / VAR= prefix / git global options / absolute path / executing shell heredoc)
POS  = r"(?:^[ \t]*|[;&|(]\s*|\$\(\s*)"
ENV  = r"(?:(?:env\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*)"
WRAP = r"(?:(?:bash|sh|zsh|ksh)\s+(?:--?[\w-]+\s+)*['\"]?)?"
PATHP = r"(?:[\w.~/-]*/)?"
GITOPT = r"(?:\s+(?:-C\s+\S+|-c\s+\S+|--[\w-]+(?:=\S+)?|-[a-zA-Z]\S*))*"
VERB = re.compile(POS + ENV + WRAP + r"(?P<verb>" + PATHP + r"(?:safe-commit\.sh|private-index-commit\.sh)|git" + GITOPT + r"\s+(?:commit|commit-tree)\b)", re.M)
def _verb_name(v):
    return v[v.rfind("/") + 1:] if v.endswith(".sh") else v
try:
    import importlib.util
    _spec = importlib.util.spec_from_file_location("scs", os.path.join(root, "scripts", "subagent-commit-scan.py"))
    scs = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(scs)
    # widen the sibling's heredoc blank: anything may follow the delimiter on its line (`<<'PY' 2>/dev/null`)
    scs._HEREDOC = re.compile(scs.NON_SHELL + r"\b[^\n;&|]*?<<-?\s*['\"]?(\w+)['\"]?[^\n]*\n(.*?)^\1\b", re.S | re.M)
    text = scs.blank_search_patterns(scs.strip_non_shell_payloads(cmd))
    text = re.sub(r"\b(?:printf|echo)\b(?:\s+-\w+)*\s+('[^']*'|\"[^\"]*\")", lambda m: m.group(0)[:-len(m.group(1))] + "''", text)
    hit = False
    for m in VERB.finditer(text):
        if not scs.is_mention(scs._segment(text, m.start("verb")), _verb_name(m.group("verb"))):
            hit = True; break
except Exception:
    hit = bool(VERB.search(cmd))           # degraded: widened regex alone — over-fires, never silently misses
if not hit:
    sys.exit(0)
sid = (d.get("session_id") or "").strip().lower()[:8] or "nosid"
if os.path.exists(os.path.join(state, f"commit-doctrine-{sid}-escape")):   # per-session opt-out, aged out with the markers
    sys.exit(0)
marker = os.path.join(state, f"commit-doctrine-{sid}-part{k}")
if os.path.exists(marker):
    sys.exit(0)
src = os.path.join(root, ".claude", "orchestrator", "commit-doctrine.md")
try:
    body = open(src, encoding="utf8").read().rstrip("\n") + "\n"
except (OSError, UnicodeDecodeError) as e:
    if k == 1:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext":
              f"<!-- COMMIT-DOCTRINE DARK: could not read .claude/orchestrator/commit-doctrine.md ({type(e).__name__}) — the commit doctrine is NOT loaded; Read it before committing. -->"}}))
    sys.exit(0)                              # no source → no deny (fail open)
# ⛔ CLAIM THE PART WITH AN EXCLUSIVE CREATE — the os.path.exists check above is only a fast path, never the guard.
# Record BEFORE emitting (a deny that cannot be remembered would repeat forever), and record ATOMICALLY: two
# concurrent commit-shaped calls in one session each run every slot, and the exists-then-open marker used until
# 2026-09-14 let BOTH deliver the same part. How often depended on the machine: natural timing gave anywhere from 0 of 5
# (one review rig) to 10 of 10 (this fix's own rig, 2 concurrent calls from the main repo), a second review rig
# 5 of 10 between them, and the suite's forced interleaving gives it every time. O_EXCL lets exactly one process win;
# the loser exits silent. ⚠️ THIS GUARDS THE PART, NOT THE CALL: two concurrent calls still split the parts between
# them, and the call that is not denied commits un-intercepted, on this hook and on its parent alike.
# ⚠️ AND WHETHER TWO COMMIT-SHAPED CALLS EVER RUN AT ONCE IS THE
# HARNESS'S CALL, AND ON THE ONE MEASURED THEY DO NOT: Claude Code 2.1.270 runs a Bash call in parallel only when the
# Bash tool's read-only check passes, two write commands sent in one turn ran one after the other, and none of the 4
# turns since 2026-09-09 that sent two commit-shaped calls ran them at once (2026-09-14). So this claim, like the
# per-call gap, is insurance against a harness that parallelizes writes, not a fix for a race seen in production.
# Every failure here stays fail-OPEN, and part 1 names a state dir it cannot write in a DARK banner: the intercept
# cannot deny without a marker, so that banner is the only tell.
def _state_dark(e):
    if k == 1:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext":
              f"<!-- COMMIT-DOCTRINE DARK: could not write this session's marker in {state} ({type(e).__name__}), so this "
              f"commit-shaped call was NOT intercepted and no doctrine part was delivered — Read "
              f".claude/orchestrator/commit-doctrine.md before the next commit. -->"}}))
    sys.exit(0)
try:
    os.makedirs(state, exist_ok=True)
except OSError as e:                         # also a state path that exists as a FILE (FileExistsError here)
    _state_dark(e)
try:
    fd = os.open(marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o666)
except FileExistsError:
    sys.exit(0)                              # another process claimed this part first; it delivers, this one stays silent
except OSError as e:
    _state_dark(e)
with os.fdopen(fd, "w", encoding="utf8") as fh:
    fh.write(cmd[:200] + "\n")
HDR_ROOM = 600
chunks, cur = [], ""
for ln in body.split("\n"):
    add = ln + "\n"
    if cur and len(cur) + len(add) > cap - HDR_ROOM:
        chunks.append(cur); cur = add
    else:
        cur += add
if cur.strip():
    chunks.append(cur)
n = len(chunks)
if k == 0:
    reason = (f"⛔ COMMIT-DOCTRINE INTERCEPT — NOTHING IN THIS CALL EXECUTED. This is the first commit-shaped command of this "
              f"context window, so the commit doctrine (.claude/orchestrator/commit-doctrine.md, {n} parts) should have "
              f"arrived in your context alongside this refusal; if fewer than {n} COMMIT-DOCTRINE part headers are there, Read "
              f"the source instead. Read it, then RE-ISSUE THE IDENTICAL COMMAND — the second attempt is allowed. "
              f"⛔ IDENTICAL MEANS THE WHOLE CALL, INCLUDING ANY HEREDOC THAT WRITES YOUR -F MESSAGE FILE. "
              f"NOTHING IN THIS CALL EXECUTED means that write did not happen either, so re-issuing only the commit line runs "
              f"-F against whatever stale file is already at that path — measured 2026-09-12: a leftover msg.txt put an "
              f"unrelated i18n subject AND A PEER'S Claude-Session trailer on a 6-file fold commit, tree correct, amended after. "
              f"Fires once per compaction epoch. Opt this SESSION out (ages out in 48h): "
              f"touch .claude/state/commit-doctrine-{sid}-escape; fleet-wide only via SKIP_COMMIT_DOCTRINE_INJECT=1 in settings.json.")
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                             "permissionDecisionReason": reason}}))
    sys.exit(0)
if k > n:
    sys.exit(0)
hdr = (f"<!-- COMMIT-DOCTRINE part {k}/{n} — delivered on this context window's first commit-shaped call "
       f"(PreToolUse, .claude/hooks/commit-doctrine-inject.sh); source .claude/orchestrator/commit-doctrine.md. "
       f"If parts are missing, Read the source. -->\n")
out = hdr + chunks[k - 1]
if k == registered and n > registered:
    out += (f"\n⛔ COMMIT-DOCTRINE OVERFLOW: {n} parts needed, {registered} registered in settings.json — parts "
            f"{registered + 1}..{n} were NOT delivered. Read .claude/orchestrator/commit-doctrine.md now and raise "
            f"REGISTERED in commit-doctrine-inject.sh + settings.json.\n")
print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": out}}))
PY
rm -f "$PF" 2>/dev/null || true
exit 0
