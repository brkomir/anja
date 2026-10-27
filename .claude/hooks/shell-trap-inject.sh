#!/usr/bin/env bash
# shell-trap-inject.sh — PreToolUse(Bash): deliver the shell traps that match THIS command.
#
# WHY THIS EXISTS. `.claude/rules/bash-environment.md` was 149,531 B of always-loaded context, 68%
# of everything that binds the band ceiling, and almost all of it is inert on any given turn: a rule
# about `mktemp -t` costs every seat on every turn and applies to the seat that runs `mktemp`.
# The proposal was to turn it into a lookup file: for the bash command about to run, grep the
# matching row from the lookup table and read what it says. A lookup the
# model must REMEMBER to consult fails exactly when it does not know it is in danger, so the hook
# does the lookup instead: it already holds the command string.
#
# ⛔ REACH IS MEASURED, NOT ASSUMED (2026-09-21): a PreToolUse hook DOES fire for a SUB-AGENT's Bash
# call — same flagged command DENIED byte-identically in a dispatched general-purpose seat, with a
# benign control EXECUTING there. Without
# that, this design would have silently stripped every trap from every dispatched agent.
#
# ⛔ THIS HOOK NEVER BLOCKS AND MUST NEVER EXIT NON-ZERO. rc=2 is the PreToolUse BLOCK code, so any
# crash here would deny Bash fleet-wide — including the commands needed to fix it, and including
# every dispatched agent per the reach measurement above. Every failure path below exits 0 silently.
#
# ⛔ EXACTLY ONE JSON DOCUMENT ON STDOUT, OR THE HARNESS DISCARDS ALL OF IT. Measured twice, and it
# is recorded in the very corpus this hook serves: a hook emitting two hookSpecificOutput documents
# delivered BOTH canaries absent. One document, emitted once, at the end.
#
# ⛔ ONCE PER SESSION. The first version had no memory across
# commands, so a session running 40 heredoc commands got the heredoc trap 40 times. Measured over the
# first 2.5 days of per-command delivery (2026-09-21..23, 697 sessions and agents, all transcripts):
# 43,210 fires, 33,399 of them (77%) carrying nothing the same context had not already been shown, and
# 84% of all trap BYTES were such repeats — about 62 MB a day appended to conversations, each repeat
# then re-read on every later request until the next compaction (~37 reads per write). At that rate the
# per-command delivery cost roughly TWICE what the always-loaded rules it replaced had cost. So: each
# trap is delivered ONCE per context. The context is keyed on session_id, plus agent_id for a dispatched
# seat (its own conversation, which has never seen what the main session saw). The seen-file lives in
# .claude/state/shell-traps-seen-<session_id>[-<agent_id>].txt; compact-save.sh deletes the session's main
# file AND all its agent files on ANY compaction (the PreCompact payload cannot say which context compacted),
# because a compaction replaces the context and the earlier delivery is gone. A trap that
# matched but was dropped by the cap is NOT marked seen — it is still owed and comes back next time.
# No session_id in the payload (the self-test, a hand invocation) ⇒ no state, every call delivers.
# Escape: SKIP_SHELL_TRAP_DEDUPE=1 — in .claude/settings.json's "env" block, since a PreToolUse hook
# is spawned with the SESSION env and an inline prefix never reaches it. STI_STATE_DIR overrides the
# state dir for tests; never point it at the real one from a suite.
set -u
exec 2>/dev/null

# ── SELF-TEST ────────────────────────────────────────────────────────────────────────────────
# `bash .claude/hooks/shell-trap-inject.sh --self-test`. Arms 3-5 are the load-bearing ones: this
# hook runs on the PreToolUse(Bash) path, where rc=2 is the BLOCK code, so a crash would deny Bash
# fleet-wide AND for every dispatched agent. Each failure mode must read rc=0 with empty stdout.
if [ "${1:-}" = "--self-test" ]; then
  SELF="${BASH_SOURCE[0]}"; fail=0
  arm() { # arm <label> <stdin> <expect-rc> <expect-empty|expect-json> [needle]
    local label="$1" in="$2" erc="$3" mode="$4" needle="${5:-}"
    local out rc
    out="$(printf '%s' "$in" | bash "$SELF" 2>/dev/null)"; rc=$?
    local ok=1
    [ "$rc" = "$erc" ] || ok=0
    if [ "$mode" = "expect-empty" ]; then [ -z "$out" ] || ok=0
    else
      printf '%s' "$out" | python3 -c 'import sys,json; json.load(sys.stdin)' 2>/dev/null || ok=0
      [ -z "$needle" ] || printf '%s' "$out" | grep -qF "$needle" || ok=0
    fi
    [ "$ok" = 1 ] && echo "  [PASS] $label" || { echo "  [FAIL] $label (rc=$rc)"; fail=$((fail+1)); }
  }
  arm "match -> one valid JSON document carrying the rule" \
      '{"tool_input":{"command":"D=$(mktemp -d)"}}' 0 expect-json "SYMLINKED"
  arm "no key matches -> silent, rc 0" '{"tool_input":{"command":"echo hi"}}' 0 expect-empty
  arm "malformed payload -> rc 0, NEVER 2 (2 is the BLOCK code)" 'not json' 0 expect-empty
  arm "empty command -> silent, rc 0" '{"tool_input":{"command":""}}' 0 expect-empty
  arm "no tool_input at all -> silent, rc 0" '{"other":1}' 0 expect-empty
  # `main:` keys. Neither needle is in either payload. The PRESENCE needle is a BODY token: the heading's
  # words also reach the drop notice's headline, so a heading needle passes with NO rule delivered at all
  # (MAX_RULES=0 mutant, measured 2026-09-23). The ABSENCE arm keeps the heading token, which catches a
  # leak through either channel.
  arm "main: key fires on the main session" \
      '{"tool_input":{"command":"cd \"$WT\" && git status"}}' 0 expect-json "SAME call as every command"
  o="$(printf '%s' '{"agent_id":"a1","tool_input":{"command":"cd \"$WT\" && git status"}}' | bash "$SELF" 2>/dev/null)"
  if printf '%s' "$o" | grep -qF 'DOES NOT OUTLIVE'; then
    echo "  [FAIL] main: key leaked into a sub-agent call"; fail=$((fail+1))
  else
    echo "  [PASS] main: key is ABSENT from a sub-agent call"
  fi
  # ⛔ SELECTIVITY IS TESTED BY ABSENCE ONLY. A PRESENCE arm here is vacuous — it was, and it
  # passed under a mutation that made the matcher inject every rule, because its needle is in the
  # payload under both hypotheses (the TWELFTH vacuous-control way). Both arms below must read the
  # OTHER way, and both DO red under that mutation.
  o="$(printf '%s' '{"tool_input":{"command":"D=$(mktemp -d)"}}' | bash "$SELF" 2>/dev/null)"
  if printf '%s' "$o" | grep -qF 'scale='; then
    echo "  [FAIL] negative control: the bc rule leaked into an mktemp command"; fail=$((fail+1))
  else
    echo "  [PASS] negative control: the bc rule is ABSENT from an mktemp command"
  fi
  if printf '%s' "$o" | grep -qF '127'; then
    echo "  [FAIL] negative control 2: the timeout rule leaked into an mktemp command"; fail=$((fail+1))
  else
    echo "  [PASS] negative control 2: the timeout rule is ABSENT from an mktemp command"
  fi
  # The `path` entry's keys (separator-anchored, per a review ruling). Three zsh PATH-breakers must fire; PATH=, a --flag and a Python kwarg must not.
  # Needle is a BODY token past the 88-char headline, so a drop notice cannot satisfy it.
  _pn='TIES each to its uppercase array'
  for _wc in '1|f() { path=$1; ls; }' '1|f() { local path; ls; }' '1|cd /x && path=/y ls' '0|PATH=/usr/bin:$PATH ls' '0|node s.mjs --output-path=x' "0|python3 -c 'f(path=1)'"; do
    _w="${_wc%%|*}"; _c="${_wc#*|}"
    _g=0; printf '{"tool_input":{"command":"%s"}}' "$_c" | bash "$SELF" 2>/dev/null | grep -qF "$_pn" && _g=1
    if [ "$_g" = "$_w" ]; then echo "  [PASS] path trap fires=$_w on: $_c"
    else echo "  [FAIL] path trap fires=$_g, want $_w, on: $_c"; fail=$((fail+1)); fi
  done
  # The `==` keys on the nomatch entry. An unquoted `echo ====` and a single-bracket `[ "$a" == "$b" ]` must fire;
  # a QUOTED label and a comparison inside a heredoc body must not (the dropped `== "` / `== $` keys fired on both: 3,316 fires, 0 unique trips, 3 days).
  _en='The same `=`-word error hits a bare'
  for _wc in '1|echo ====; ls' '1|[ \"$a\" == \"$b\" ] && ls' '0|echo \"== $f\"; ls' '0|python3 - <<PY\nif a == \"b\": pass\nPY'; do
    _w="${_wc%%|*}"; _c="${_wc#*|}"
    _g=0; printf '{"tool_input":{"command":"%s"}}' "$_c" | bash "$SELF" 2>/dev/null | grep -qF "$_en" && _g=1
    if [ "$_g" = "$_w" ]; then echo "  [PASS] == trap fires=$_w on: $_c"
    else echo "  [FAIL] == trap fires=$_g, want $_w, on: $_c"; fail=$((fail+1)); fi
  done
  # ⛔ HEADER PARITY. The injector splits on an ANCHORED, space-literal header; the cap probe below splits
  # on an unanchored, space-tolerant one. A header missing one space is counted by the probe and invisible to
  # the injector: its entry never fires on its own keys and its body rides on the PREVIOUS entry's, with every
  # other arm green (measured 2026-09-23). Expect a POSITIVE count; an unreadable table is a FAIL, not a pass.
  _hp="$(python3 -c 'import re,sys; t=open(sys.argv[1],encoding="utf-8").read(); print(len(re.findall(r"(?m)^<!-- TRAP keys: (.*?) -->$",t)), len(re.findall(r"<!--\s*TRAP keys:\s*(.*?)\s*-->",t)))' "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$SELF")/../.." && pwd)}/.claude/traps/shell-traps.md" 2>/dev/null)"
  read -r _h1 _h2 <<< "${_hp:-x y}"
  if [ "${_h1:-0}" -gt 0 ] 2>/dev/null && [ "$_h1" = "$_h2" ]; then echo "  [PASS] header parity: injector and cap probe both parse $_h1 headers"
  else echo "  [FAIL] header parity: injector ${_h1:-?} vs cap probe ${_h2:-?} — a malformed header rides on the previous entry"; fail=$((fail+1)); fi
  # ⛔ THE CAP-PATH ARM. Every arm above uses a SMALL body, so none of them ever reaches the cap —
  # which is why 7 of 7 passed green over a live, fleet-wide, zero-delivery bug for an hour, and
  # why mutating CAP to 0 left the suite clean. This arm derives the LONGEST body in the table at
  # runtime (never a hardcoded key — the table is edited constantly), feeds a command carrying its
  # own key, and asserts a real rule came back. It reds against `if used + len(body) > CAP: break`.
  # ⛔ THE PROBE GOES IN A TEMP FILE, NOT A HEREDOC INSIDE `$( )`. bash here is 3.2.57 and a
  # heredoc nested in a command substitution mis-parses on it — which made THIS script exit 2,
  # and 2 is the PreToolUse BLOCK code, so it denied every Bash call fleet-wide for ~1 minute
  # while I was fixing a different fleet-wide bug in the same file. Measured 2026-09-21.
  capprobe="$(mktemp)"
  cat > "$capprobe" <<'PY'
import json, os, re, subprocess, sys
# The table the HOOK reads (argv[2], resolved CLAUDE_PROJECT_DIR-first like the clamp and owed probes), never the cwd's repo.
root = os.path.abspath(os.path.join(os.path.dirname(sys.argv[2]), "..", ".."))
blocks = re.split(r"<!--\s*TRAP keys:\s*(.*?)\s*-->", open(sys.argv[2]).read())
ents = []
for i in range(1, len(blocks) - 1, 2):
    keys = [k.strip() for k in blocks[i].split(",") if k.strip()]
    if keys:
        ents.append((keys[0], blocks[i + 1].strip()))
key, body = max(ents, key=lambda e: len(e[1]))
out = subprocess.run(["bash", sys.argv[1]], input=json.dumps({"tool_input": {"command": key + " x"}}),
                     capture_output=True, text=True, env=dict(os.environ, CLAUDE_PROJECT_DIR=root)).stdout
ctx = json.loads(out)["hookSpecificOutput"]["additionalContext"] if out.strip() else ""
needle = body.splitlines()[0][:60]
# CAP is read out of the hook's OWN source, never restated here — a second copy of that number
# is a drift bug waiting for the first person who tunes one of them.
cap = int(re.search(r"CAP, MAX_RULES, out, used = (\d+),", open(sys.argv[1]).read()).group(1))
over = [k for k, b in ents if len(b) > cap]
# ⛔ THE DOCUMENT, NOT THE BODIES. Every reading above derives from `used` — the SUM OF BODIES —
# which is exactly the blind spot that shipped a live serious defect: the emitted document is header + bodies +
# separators + notice, and it reached 11,154 chars against a 10,000-char ceiling while every arm here
# read green. A simulator or a self-test that faithfully reproduces the capping loop INHERITS the
# loop's own blind spot. So this probe builds the WORST CASE it can — a command carrying many keys
# at once — and measures `len(ctx)`, the only quantity the harness actually cares about.
# Sorted with an EXPLICIT tiebreak: a bare `key=len` over a SET leaves equal-length keys in
# hash order, which varies per interpreter run — measured, this arm read 9699 then 9700 on two
# runs with no code change between them. An assertion whose input is per-run is a flaky arm,
# and a flaky arm gets muted rather than read.
worst = " ".join(sorted({k for k, _ in ents}, key=lambda k: (-len(k), k))[:40])
wout = subprocess.run(["bash", sys.argv[1]], input=json.dumps({"tool_input": {"command": worst}}),
                      capture_output=True, text=True, env=dict(os.environ, CLAUDE_PROJECT_DIR=root)).stdout
wctx = json.loads(wout)["hookSpecificOutput"]["additionalContext"] if wout.strip() else ""
print("LONGEST=%d KEY=%r DELIVERED=%s ZERO_NOTICE=%s CAP=%d OVERCAP=%d %s CTX=%d WORSTCTX=%d NOTICEFIRST=%s" % (
    len(body), key, needle in ctx, "showing the 0 " in ctx, cap, len(over), ",".join(over[:4]),
    len(ctx), len(wctx), "further trap(s) matched" in wctx.split("\n\n")[1][:120] if wctx.count("\n\n") > 1 else False))
PY
  capout="$(python3 "$capprobe" "$SELF" "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$SELF")/../.." && pwd)}/.claude/traps/shell-traps.md" 2>/dev/null)" || capout="PROBE-FAILED"
  rm -f "$capprobe"
  echo "    $capout"
  case "$capout" in
    *"DELIVERED=True ZERO_NOTICE=False"*) echo "  [PASS] cap path: the LONGEST body in the table is actually delivered" ;;
    *) echo "  [FAIL] cap path: the longest body is NOT delivered ($capout)"; fail=$((fail+1)) ;;
  esac
  # ⛔ THE ARM THAT WOULD HAVE CAUGHT THAT SERIOUS DEFECT. It asserts the EMITTED DOCUMENT stays under the
  # harness's additionalContext ceiling on the worst case this table can produce. Against the
  # shipped state before the clamp it reds; that is the point of adding it.
  # ⛔ EXPECT THE POSITIVE READING — `0 <= 9700` IS A VOID, NOT A PASS. The first version of this
  # arm read `[ "$_wc" -le 9700 ]` alone, and against the pre-fix hook it went GREEN on WORSTCTX=0:
  # the probe had emitted nothing at all, and an arm hunting an OVER-ceiling payload scored the
  # absence of any payload as compliance. That is the thirteenth vacuous-control way inside the arm
  # written to close a blind spot. The lower bound is what makes the reading mean anything: the
  # worst case over 40 keys must produce a SUBSTANTIAL document, so anything under 1000 is the
  # instrument breaking, never the hook behaving.
  _wc=$(printf '%s' "$capout" | sed -n 's/.*WORSTCTX=\([0-9]*\).*/\1/p')
  if [ -z "$_wc" ] || [ "$_wc" -lt 1000 ]; then
    echo "  [FAIL] document ceiling: worst-case probe emitted ${_wc:-no} chars — VOID reading, the probe did not run (traps table unresolved?), NOT a clean payload"; fail=$((fail+1))
  elif [ "$_wc" -le 9700 ]; then
    echo "  [PASS] document ceiling: worst-case emitted payload is ${_wc} chars (<= 9700)"
  else
    echo "  [FAIL] document ceiling: worst-case emitted payload is ${_wc} chars — over 9700, the harness SPILLS it to a file and the model gets a preview"; fail=$((fail+1))
  fi
  # And the drop notice must be FIRST, or the front-keeping preview eats the one line that says
  # something is missing.
  case "$capout" in
    *"NOTICEFIRST=True"*) echo "  [PASS] drop notice leads the payload (survives a front-truncating preview)" ;;
    *"NOTICEFIRST=False"*) echo "  [FAIL] drop notice is NOT first — a truncating preview cuts it before anything else"; fail=$((fail+1)) ;;
    *) echo "  [FAIL] drop notice: VOID, the cap probe returned no NOTICEFIRST field ($capout)"; fail=$((fail+1)) ;;
  esac
  # ⛔ THE BUILDER-SIDE ARM: REFUSE A TABLE CARRYING AN ENTRY TOO BIG TO
  # DELIVER. The cap-path arm above proves the injector survives an over-cap entry; this one says the
  # table must not contain one in the first place. Both are needed and they fail differently: without
  # this, an editor who grows an entry past CAP gets a silently DEGRADED delivery (that entry alone,
  # everything else dropped) and no arm anywhere goes red.
  case "$capout" in
    *"OVERCAP=0 "*) echo "  [PASS] no entry in the table exceeds the injector cap" ;;
    *) echo "  [FAIL] an entry exceeds the cap and cannot be delivered whole ($capout)"; fail=$((fail+1)) ;;
  esac
  # ⛔ ONCE-PER-SESSION DEDUPE ARMS (2026-09-23). State goes to a TEMP dir via STI_STATE_DIR — never the
  # real .claude/state. Order is load-bearing: a hook that crashes silently AFTER its first delivery reads
  # "empty" on the second call exactly like a working dedupe, so the second-call arm certifies nothing on
  # its own; the other-agent and after-reset arms are what go red under that mutation, and the no-id arm
  # is what keeps every arm ABOVE this block honest (they send no session_id and must keep delivering).
  _dd="$(mktemp -d)"; _p1='{"session_id":"selftest-sid","tool_input":{"command":"D=$(mktemp -d)"}}'
  o1="$(printf '%s' "$_p1" | STI_STATE_DIR="$_dd" bash "$SELF" 2>/dev/null)"
  o2="$(printf '%s' "$_p1" | STI_STATE_DIR="$_dd" bash "$SELF" 2>/dev/null)"
  if printf '%s' "$o1" | grep -qF 'SYMLINKED'; then echo "  [PASS] dedupe: the first matching command in a session gets the rule"
  else echo "  [FAIL] dedupe: the first call did not deliver"; fail=$((fail+1)); fi
  if [ -s "$_dd/shell-traps-seen-selftest-sid.txt" ]; then echo "  [PASS] dedupe: a non-empty seen-file exists after the first delivery"
  else echo "  [FAIL] dedupe: no seen-file was written"; fail=$((fail+1)); fi
  if [ -z "$o2" ]; then echo "  [PASS] dedupe: the same command again in the same session is silent"
  else echo "  [FAIL] dedupe: the repeat was delivered again"; fail=$((fail+1)); fi
  python3 -c 'import os,sys,time; os.utime(sys.argv[1], (time.time()-49*3600,)*2)' "$_dd/shell-traps-seen-selftest-sid.txt"
  _aged="$(find "$_dd" -maxdepth 1 -name 'shell-traps-seen-selftest-sid.txt' -mmin +2880)"  # the pruner's own predicate
  o2r="$(printf '%s' "$_p1" | STI_STATE_DIR="$_dd" bash "$SELF" 2>/dev/null)"
  if [ -z "$_aged" ] || [ -n "$o2r" ]; then echo "  [FAIL] dedupe: freshness arm VOID — the seen-file was not aged past 48h (aged=${_aged:+y}) or the call delivered ${#o2r} chars, so it was not read-only"; fail=$((fail+1))
  elif [ -n "$(find "$_dd" -maxdepth 1 -name 'shell-traps-seen-selftest-sid.txt' -mmin -5)" ]; then echo "  [PASS] dedupe: a read refreshes the seen-file's mtime (the 48h pruner keys on it)"
  else echo "  [FAIL] dedupe: a read-only call left the seen-file 49h old — the pruner would remove a live context's file"; fail=$((fail+1)); fi
  o3="$(printf '%s' '{"session_id":"selftest-sid","agent_id":"agent9","tool_input":{"command":"D=$(mktemp -d)"}}' | STI_STATE_DIR="$_dd" bash "$SELF" 2>/dev/null)"
  if printf '%s' "$o3" | grep -qF 'SYMLINKED'; then echo "  [PASS] dedupe: a sub-agent of that session has its own context and still gets the rule"
  else echo "  [FAIL] dedupe: a sub-agent was starved by the main session's seen-file"; fail=$((fail+1)); fi
  rm -f "$_dd/shell-traps-seen-selftest-sid.txt"
  o4="$(printf '%s' "$_p1" | STI_STATE_DIR="$_dd" bash "$SELF" 2>/dev/null)"
  if printf '%s' "$o4" | grep -qF 'SYMLINKED'; then echo "  [PASS] dedupe: with the seen-file removed (the compaction reset) the rule comes back"
  else echo "  [FAIL] dedupe: no re-delivery after the reset"; fail=$((fail+1)); fi
  o5="$(printf '%s' "$_p1" | STI_STATE_DIR="$_dd" SKIP_SHELL_TRAP_DEDUPE=1 bash "$SELF" 2>/dev/null)"
  if printf '%s' "$o5" | grep -qF 'SYMLINKED'; then echo "  [PASS] dedupe: SKIP_SHELL_TRAP_DEDUPE=1 delivers a repeat"
  else echo "  [FAIL] dedupe: the escape hatch does not deliver"; fail=$((fail+1)); fi
  _dd2="$(mktemp -d)"; _p0='{"tool_input":{"command":"D=$(mktemp -d)"}}'
  printf '%s' "$_p0" | STI_STATE_DIR="$_dd2" bash "$SELF" >/dev/null 2>&1
  o7="$(printf '%s' "$_p0" | STI_STATE_DIR="$_dd2" bash "$SELF" 2>/dev/null)"
  if printf '%s' "$o7" | grep -qF 'SYMLINKED' && [ -z "$(ls -A "$_dd2")" ]; then echo "  [PASS] dedupe: no session_id -> no state file and every call delivers (the arms above depend on this)"
  else echo "  [FAIL] dedupe: a payload without session_id wrote state or stopped delivering"; fail=$((fail+1)); fi
  printf '%s' '{"session_id":"selftest-sid","agent_id":"bad.id","tool_input":{"command":"D=$(mktemp -d)"}}' | STI_STATE_DIR="$_dd2" bash "$SELF" >/dev/null 2>&1
  if [ -z "$(ls -A "$_dd2")" ]; then echo "  [PASS] dedupe: an agent_id that fails the id predicate writes no state (never the MAIN file)"
  else echo "  [FAIL] dedupe: an invalid agent_id wrote state ($(ls "$_dd2"))"; fail=$((fail+1)); fi
  # The reset is compact-save.sh's job; run the REAL PreCompact hook against the same temp dir (it honours
  # COMPACT_STATE_DIR). The payload is the harness's REAL shape — session_id, no agent_id, for a main AND a
  # sub-agent compaction alike — so one reset must clear the session's main file and every agent file,
  # and must not touch another session's.
  printf '%s' "$_p1" | STI_STATE_DIR="$_dd" bash "$SELF" >/dev/null 2>&1
  printf '%s' '{"session_id":"other-sid","tool_input":{"command":"D=$(mktemp -d)"}}' | STI_STATE_DIR="$_dd" bash "$SELF" >/dev/null 2>&1
  printf '%s' '{"session_id":"selftest-sid","trigger":"auto"}' | COMPACT_STATE_DIR="$_dd" bash "$(dirname "$SELF")/compact-save.sh" >/dev/null 2>&1
  if [ ! -e "$_dd/shell-traps-seen-selftest-sid.txt" ] && [ ! -e "$_dd/shell-traps-seen-selftest-sid-agent9.txt" ]; then
    echo "  [PASS] compact-save.sh: a compaction (payload has no agent_id) clears the session's seen-file AND its agents'"
  else echo "  [FAIL] compact-save.sh: reset left a file (main present=$([ -e "$_dd/shell-traps-seen-selftest-sid.txt" ] && echo y || echo n) agent present=$([ -e "$_dd/shell-traps-seen-selftest-sid-agent9.txt" ] && echo y || echo n))"; fail=$((fail+1)); fi
  if [ -s "$_dd/shell-traps-seen-other-sid.txt" ]; then echo "  [PASS] compact-save.sh: another session's seen-file survives this session's compaction"
  else echo "  [FAIL] compact-save.sh: the reset reached another session's seen-file"; fail=$((fail+1)); fi
  # A body the MAX_DOC clamp cuts was never shown, so it must not be marked seen. A command carrying the first
  # key of every entry is the worst case; every key in the seen-file must have its body WHOLE in the payload.
  _dd3="$(mktemp -d)"
  _clamp="$(python3 - "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$SELF")/../.." && pwd)}/.claude/traps/shell-traps.md" "$SELF" "$_dd3" <<'CLAMP'
import sys, re, json, hashlib, subprocess, os
t = open(sys.argv[1], encoding="utf-8").read(); b = re.split(r'(?m)^<!-- TRAP keys: (.*?) -->$', t)
ents = [([k.strip()[5:].strip() if k.strip().startswith("main:") else k.strip() for k in b[i].split(",") if k.strip()], b[i+1].strip()) for i in range(1, len(b)-1, 2)]
cmd = " ; ".join(k[0] for k, _ in ents if k)
p = json.dumps({"session_id": "clamp-sid", "tool_input": {"command": cmd}})
out = subprocess.run(["bash", sys.argv[2]], input=p, capture_output=True, text=True, env=dict(os.environ, STI_STATE_DIR=sys.argv[3], CLAUDE_PROJECT_DIR=os.path.abspath(os.path.join(os.path.dirname(sys.argv[1]), "..", "..")))).stdout
ctx = json.loads(out)["hookSpecificOutput"]["additionalContext"] if out else ""
by = {hashlib.sha1(x.encode("utf-8")).hexdigest()[:16]: x for _, x in ents}
f = os.path.join(sys.argv[3], "shell-traps-seen-clamp-sid.txt")
marked = [l.strip() for l in open(f)] if os.path.exists(f) else []
print("CLAMPED=%d MARKED=%d LOST=%d" % ("CLAMPED" in ctx, len(marked), sum(1 for h in marked if by.get(h, "") not in ctx)))
CLAMP
)"
  case "$_clamp" in
    *"MARKED=0 "*) echo "  [FAIL] dedupe: the worst-case command marked nothing seen ($_clamp)"; fail=$((fail+1)) ;;
    *"LOST=0") echo "  [PASS] dedupe: nothing the clamp cut is marked seen" ;;
    *) echo "  [FAIL] dedupe: a body the clamp cut was marked seen and will never come back ($_clamp)"; fail=$((fail+1)) ;;
  esac
  rm -rf "$_dd3"
  # ⛔ OWED-TRAP ARMS. Every arm above sends a SMALL command, so none reaches the cap
  # or the document clamp — and four guards survived deletion with 23/23 green: recording cap-dropped bodies,
  # recording clamp-cut bodies, filtering AFTER the cap, and writing state BEFORE the dump. Each is the SUPPRESS
  # direction. The worst-case command (40 longest keys, as in the cap probe) reaches both the cap and the clamp.
  _dd3="$(mktemp -d)"; owedprobe="$(mktemp)"
  cat > "$owedprobe" <<'PY'
import json, re, subprocess, sys, hashlib, os
hook, sd, traps = sys.argv[1], sys.argv[2], sys.argv[3]
e = re.split(r"(?m)^<!-- TRAP keys: (.*?) -->$", open(traps, encoding="utf-8").read())
keys = {k.strip()[5:].strip() if k.strip().startswith("main:") else k.strip() for i in range(1, len(e) - 1, 2) for k in e[i].split(",") if k.strip()}
body = {hashlib.sha1(e[i + 1].strip().encode("utf-8")).hexdigest()[:16]: e[i + 1].strip() for i in range(1, len(e) - 1, 2)}
worst = " ".join(sorted(keys, key=lambda k: (-len(k), k))[:40])
strip = lambda k: k[5:].strip() if k.startswith("main:") else k
owed = {h for i in range(1, len(e) - 1, 2) for h in [hashlib.sha1(e[i + 1].strip().encode("utf-8")).hexdigest()[:16]]
        if any(strip(k.strip()) and strip(k.strip()) in worst for k in e[i].split(","))}
def call():
    o = subprocess.run(["bash", hook], input=json.dumps({"session_id": "selftest-owed", "tool_input": {"command": worst}}),
                       capture_output=True, text=True, env=dict(os.environ, STI_STATE_DIR=sd)).stdout
    return json.loads(o)["hookSpecificOutput"]["additionalContext"] if o.strip() else ""
c1 = call()
seen = [l.strip() for l in open(os.path.join(sd, "shell-traps-seen-selftest-owed.txt"), encoding="utf-8") if l.strip()]
n = 1
while n < 8 and call():
    n += 1
final = {l.strip() for l in open(os.path.join(sd, "shell-traps-seen-selftest-owed.txt"), encoding="utf-8") if l.strip()}
print("DROPS=%s CLAMPED=%s SEEN=%d NOTWHOLE=%d OWED=%d CALLS=%d ALL_OWED_DELIVERED=%s" % ("did NOT fit" in c1, "WAS CLAMPED" in c1,
      len(seen), sum(1 for k in seen if body.get(k, "\0") not in c1), len(owed), n, owed <= final))
PY
  _ow="$(python3 "$owedprobe" "$SELF" "$_dd3" "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$SELF")/../.." && pwd)}/.claude/traps/shell-traps.md" 2>/dev/null)" || _ow="PROBE-FAILED"
  rm -f "$owedprobe"; echo "    $_ow"
  case "$_ow" in
    *"DROPS=True"*"NOTWHOLE=0 "*"ALL_OWED_DELIVERED=True"*) echo "  [PASS] dedupe: only bodies delivered WHOLE are marked seen, and every owed trap is delivered on a later call" ;;
    *) echo "  [FAIL] dedupe: a trap never shown whole was marked seen, the owed ones did not come back, or the probe was void ($_ow)"; fail=$((fail+1)) ;;
  esac
  _sf="$(mktemp)"  # a regular FILE as the state dir: every state-path call fails
  o8="$(printf '%s' "$_p1" | STI_STATE_DIR="$_sf" bash "$SELF" 2>/dev/null)"; o9="$(printf '%s' "$_p1" | STI_STATE_DIR="$_sf" bash "$SELF" 2>/dev/null)"
  if printf '%s' "$o8" | grep -qF 'SYMLINKED' && printf '%s' "$o9" | grep -qF 'SYMLINKED'; then echo "  [PASS] dedupe: an unusable state dir degrades to DELIVER on every call"
  else echo "  [FAIL] dedupe: a state-path failure suppressed delivery"; fail=$((fail+1)); fi
  _dd4="$(mktemp -d)"
  o10="$(printf '%s' '{"session_id":"sid/../escape","tool_input":{"command":"D=$(mktemp -d)"}}' | STI_STATE_DIR="$_dd4" bash "$SELF" 2>/dev/null)"
  o11="$(printf '%s' "{\"session_id\":\"$(printf 'a%.0s' $(seq 65))\",\"tool_input\":{\"command\":\"D=\$(mktemp -d)\"}}" | STI_STATE_DIR="$_dd4" bash "$SELF" 2>/dev/null)"
  if printf '%s' "$o10" | grep -qF 'SYMLINKED' && printf '%s' "$o11" | grep -qF 'SYMLINKED' && [ -z "$(ls -A "$_dd4")" ]; then echo "  [PASS] dedupe: an id with a path character, or over 64 chars, writes no state and still delivers"
  else echo "  [FAIL] dedupe: an invalid id wrote state or stopped delivering ($(ls -A "$_dd4" | head -3 | tr '\n' ' '))"; fail=$((fail+1)); fi
  # Ages are 49h / 47h around the documented 48h, not a 2020 date: BSD find's `-mtime +2` reads 49h as bucket 2
  # and keeps it (measured), so only a boundary pair can tell 48h from 72h.
  _dd5="$(mktemp -d)"; : > "$_dd5/shell-traps-seen-oldsid.txt"; : > "$_dd5/shell-traps-seen-livesid.txt"; : > "$_dd5/unrelated-old.txt"
  python3 -c 'import os,sys,time; [os.utime(f, (time.time()-h*3600,)*2) for f, h in ((sys.argv[1], 49), (sys.argv[2], 47), (sys.argv[3], 49))]' \
    "$_dd5/shell-traps-seen-oldsid.txt" "$_dd5/shell-traps-seen-livesid.txt" "$_dd5/unrelated-old.txt"
  printf '%s' '{"session_id":"selftest-sid","trigger":"auto"}' | COMPACT_STATE_DIR="$_dd5" bash "$(dirname "$SELF")/compact-save.sh" >/dev/null 2>&1
  if [ ! -e "$_dd5/shell-traps-seen-oldsid.txt" ] && [ -e "$_dd5/shell-traps-seen-livesid.txt" ] && [ -e "$_dd5/unrelated-old.txt" ]; then
    echo "  [PASS] compact-save.sh: the pruner removes a 49h seen-file and keeps a 47h one and a 49h non-seen-file"
  else echo "  [FAIL] compact-save.sh: pruner scope wrong (old=$([ -e "$_dd5/shell-traps-seen-oldsid.txt" ] && echo y || echo n) young=$([ -e "$_dd5/shell-traps-seen-livesid.txt" ] && echo y || echo n) unrelated=$([ -e "$_dd5/unrelated-old.txt" ] && echo y || echo n))"; fail=$((fail+1)); fi
  # ⛔ RANKING-ORDER ARM. The sort below is the only thing that decides which rules survive the caps, and
  # no arm above pins it: reversing it or deleting it left all of them green. A two-entry
  # fixture table whose SHORTER key is listed first, and one command that matches both: the longer key's
  # body must come first. Each wrong order reads SHORT-FIRST; a missing body reads VOID, never a pass.
  _fx="$(mktemp -d)"; mkdir -p "$_fx/.claude/traps"
  printf '<!-- TRAP keys: zq -->\nSHORTKEY-BODY\n<!-- TRAP keys: zqzq-longer -->\nLONGKEY-BODY\n' > "$_fx/.claude/traps/shell-traps.md"
  _ord="$(printf '%s' '{"tool_input":{"command":"zqzq-longer"}}' | CLAUDE_PROJECT_DIR="$_fx" bash "$SELF" 2>/dev/null | python3 -c 'import sys,json
c = json.load(sys.stdin)["hookSpecificOutput"]["additionalContext"]
a, b = c.find("LONGKEY-BODY"), c.find("SHORTKEY-BODY")
print("ORDER=" + ("VOID" if a < 0 or b < 0 else "LONG-FIRST" if a < b else "SHORT-FIRST"))' 2>/dev/null)"
  rm -rf "$_fx"
  if [ "$_ord" = "ORDER=LONG-FIRST" ]; then echo "  [PASS] ranking: the longer matched key is delivered first"
  else echo "  [FAIL] ranking: longest-key-first order not held (${_ord:-no output})"; fail=$((fail+1)); fi
  rm -rf "$_dd" "$_dd2" "$_dd3" "$_dd4" "$_dd5" "$_sf"
  [ "$fail" = 0 ] && { echo "OK: self-test clean"; exit 0; } || { echo "FAILED: $fail"; exit 1; }
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
TRAPS="$ROOT/.claude/traps/shell-traps.md"
[ -r "$TRAPS" ] || exit 0
STI_STATE_DIR="${STI_STATE_DIR:-$ROOT/.claude/state}"

INPUT="$(cat)" || exit 0
CMD="$(printf '%s' "$INPUT" | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    print((d.get("tool_input") or {}).get("command") or "")
except Exception:
    pass' 2>/dev/null)" || exit 0
[ -n "$CMD" ] || exit 0
# A `main:` key fires on the MAIN session only. A sub-agent's call carries a string agent_id (null or
# absent on the main session) — the discriminator commit-doctrine-inject.sh already skips on.
STI_SUB=0; case "$INPUT" in *'"agent_id":"'*|*'"agent_id": "'*) STI_SUB=1 ;; esac
# Dedupe key: session_id, plus agent_id for a dispatched seat. An id is accepted ONLY if it is entirely
# [A-Za-z0-9_-] and at most 64 chars — the same predicate compact-save.sh applies before it deletes the file,
# so the two hooks name the same file or neither touches one. Anything else reads "-" = absent ⇒ no dedupe.
read -r STI_SID STI_AID <<< "$(printf '%s' "$INPUT" | python3 -c 'import sys,json,re
try:
    d=json.load(sys.stdin)
    ok=lambda v: v if isinstance(v,str) and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", v) else "-"
    a=d.get("agent_id")
    # An agent_id that is PRESENT but fails the predicate must not collapse onto the MAIN file: no state.
    print(ok(d.get("session_id")) if a is None or ok(a) != "-" else "-", ok(a))
except Exception:
    print("- -")' 2>/dev/null)" || { STI_SID="-"; STI_AID="-"; }
: "${STI_SID:=-}" "${STI_AID:=-}"

# The matcher runs in python so the table stays declarative and the shell cannot mangle a payload.
STI_CMD="$CMD" STI_SUB="$STI_SUB" STI_SID="$STI_SID" STI_AID="$STI_AID" STI_STATE_DIR="$STI_STATE_DIR" python3 - "$TRAPS" <<'PY' || exit 0
import sys, os, json, re, hashlib
try:
    traps = open(sys.argv[1], encoding="utf-8").read()
    cmd = os.environ.get("STI_CMD", "")
    if not cmd:
        sys.exit(0)
    # Each entry starts with a machine header: <!-- TRAP keys: a, b, c -->
    blocks = re.split(r'(?m)^<!-- TRAP keys: (.*?) -->$', traps)
    hits, seen = [], set()
    sub = os.environ.get("STI_SUB") == "1"
    for i in range(1, len(blocks) - 1, 2):
        keys = [k.strip() for k in blocks[i].split(",") if k.strip()]
        body = blocks[i + 1].strip()
        for k in keys:
            main_only = k.startswith("main:")
            k = k[5:].strip() if main_only else k
            if main_only and sub:
                continue
            if k and k in cmd and body not in seen:
                seen.add(body); hits.append((k, body)); break
    # ⛔ ONCE PER CONTEXT (header paragraph). Drop every hit this session — or this
    # agent — has already been shown. The key is a hash of the BODY, so editing an entry re-delivers it once.
    # Any failure on the state path degrades to "deliver", never to "suppress": a lost file costs a repeat, a
    # false suppression costs the rule at the one moment it applied.
    key = lambda b: hashlib.sha1(b.encode("utf-8")).hexdigest()[:16]
    seen_path, delivered_before = None, set()
    sid, aid = os.environ.get("STI_SID", "-"), os.environ.get("STI_AID", "-")
    if sid != "-" and os.environ.get("SKIP_SHELL_TRAP_DEDUPE") != "1" and os.environ.get("STI_STATE_DIR"):
        seen_path = os.path.join(os.environ["STI_STATE_DIR"],
                                 "shell-traps-seen-%s%s.txt" % (sid, "" if aid == "-" else "-" + aid))
        try:
            with open(seen_path, encoding="utf-8") as fh:
                delivered_before = {ln.strip() for ln in fh if ln.strip()}
        except Exception:
            delivered_before = set()
        # Keep a LIVE context's file fresh: the pruner in compact-save.sh keys on mtime, and a context that
        # only READS for 48h (every trap already shown) would otherwise lose its file and pay one burst of
        # repeats. This runs on EVERY call from a context with a
        # valid id, matching or not (a zero-match `echo hi` refreshes it too, measured); it refreshes
        # only this context's own file and never creates one. Failure here changes nothing about delivery.
        try:
            os.utime(seen_path, None)
        except Exception:
            pass
        hits = [(k, b) for k, b in hits if key(b) not in delivered_before]
    if not hits:
        sys.exit(0)
    # CAP, deliberately — but on the SPILL, not on a volume finding. An uncapped dump on a command
    # matching eight rows blows the harness's 10,000-char ceiling, which is measured and total (see
    # the serious-defect note below). Whether a long payload also gets SKIMMED is unmeasured in both directions;
    # do not restate the retracted gloss here. Longest match first.
    hits.sort(key=lambda h: -len(h[0]))
    # TWO CAPS, and the RULE cap was added after watching it fire (2026-09-21). A compound probe
    # command — one carrying `git show HEAD:`, `| head`, `grep -c` and `cut -c` at once — matched
    # SIX rules and delivered ~6 KB. Every one was relevant, so relevance alone does not bound the
    # payload — and the rule cap is a cheap second bound on a document the byte cap does not measure.
    # ⛔ NOT because "the more a guard has to say, the less the model hears": that is a GLOSS on the
    # two-documents-deliver-neither finding, it is retracted ~30 lines below, and calling it "the
    # corpus's own finding" here dressed a stdout-framing result as a dose-response law on volume.
    # MAX_RULES 4 -> 25, by the rule: either double it, or find the largest measured match
    # count and set it two above that.
    # ⛔ THE TABLE THAT STOOD HERE WAS MEASURED AT CAP=6000 AND WAS NEVER LABELLED AS SUCH — it sat
    # directly above the line that changed CAP to 10000, two adjacent measured tables with nothing
    # telling a reader which one still described the code.
    # RE-DERIVED AT CAP=10000 over the same 5,237 real peer commands (NUL-delimited, own session
    # excluded; 5,209 match at least one trap):
    #     MAX  4 -> 3.61 rules / 3,688 B mean / p95 7,078 / 62.8% lose at least one
    #     MAX  8 -> 5.36 / 4,997 / 9,504 / 19.8%
    #     MAX 12 -> 5.66 / 5,174 / 9,791 /  9.4%
    #     MAX 25 -> 5.67 / 5,180 / 9,796 /  8.8%
    #     MAX 28 -> identical to 25 (0 commands match more than 25)
    # ⛔ AND THE CONCLUSION INVERTED WITH THE CAP. The old note said "12 and 25 are INDISTINGUISHABLE,
    # so this is effectively a SINGLE-LIMITER design (bytes)". That was TRUE AT 6000 and is FALSE at
    # 10000: 152 commands match more than 12 traps, and the lose-at-least-one rate moves 9.4% -> 8.8%.
    # Raising CAP gave the rule count room to bind. ⭐ THE REUSABLE HALF: a two-limiter design's
    # "this knob does not matter" finding has a shelf life exactly equal to the OTHER knob's stability.
    # ⚠️ THE STATED BASIS FOR 25 IS CORPUS-DEPENDENT AND WAS ALREADY STALE. This read "the biggest
    # measured is 23 traps on ONE real command, so 25"; at HEAD the biggest is 24 and 3 commands exceed
    # 23, which under the two-above rule stated earlier would give 26. It does not matter behaviourally — 0
    # commands match more than 25 — but do not quote the 23 as a fixed fact.
    # ⛔ NAME THE POPULATION OR THE PERCENTAGE MEANS NOTHING. Every figure in this block comes from
    # ONE sample: Bash commands extracted from the TAILS (last 12 MB) of the 14 LARGEST peer
    # transcripts, own session excluded — 5,237 commands, 5,209 matching at least one trap. That is
    # a sample of 227,465 Bash tool_use records across the 265 transcripts in the project dir, so it
    # is a RECENCY-WEIGHTED slice of the busiest seats, not the fleet.
    # ⛔ AND IT IS MAIN-SESSION ONLY BY SAMPLING: the 14 transcripts it was drawn from are main-session
    # files, and a sub-agent's Bash calls are recorded in a SEPARATE file, <sid>/subagents/agent-<id>.jsonl
    # (1,018 such files touched 2026-09-20..23 held 50,827 Bash calls). This paragraph said until 2026-09-23
    # that agent calls are "NOT RECORDED in these transcripts at all", from a count with TWO blind spots:
    # it walked the top-level files only, AND it keyed on `agentName`, which neither corpus carries (0 in
    # that top-level count; 0 of 341,404 records in those 1,018 agent files, every one of which carries
    # `agentId` and `isSidechain: true`). Either blind spot alone reads 0, so re-running the old count over
    # subagents/ with the old key still reads 0. So this table says nothing about what a dispatched agent
    # receives, and the reach measurement at the top of this file says those agents DO get this hook. The
    # all-rules-delivered rate below has never been derived over agent commands; a review
    # measured a different quantity there (0 of 31,883 emitted trap payloads missing from context, over
    # 40 main + 400 agent transcripts).
    # CAP 6000 -> 10000 -> 9000 (the fix for the serious defect described below). RE-DERIVED at HEAD over that sample, all-rules-delivered:
    #     6000 61.9%  |  8000 79.2%  |  9000 (live) 85.8%  |  10000 90.8%  |  12000 95.9%  | uncapped 100%
    #     mean payload 4,103 / 4,722 / 4,945 / 5,104 / 5,291 / 5,447 B;  p95 5,938 / 7,867 / 8,794 /
    #     9,579 / 10,610 / 11,511 B.
    # ⚠ THE OLD ROW READ 63.8 / 82.3 / 92.5 / 97.0 AND IS SUPERSEDED, NOT REFUTED — it was measured
    # before the table grew; re-derive rather than citing either set. Note the p95 column is WHY the
    # document clamp exists: at CAP 10000 the p95 BODY total alone was 9,579 B, before header and
    # separators, against a 10,000-char ceiling. The old note "it stops paying after 10000" was
    # reasoning about delivery only, with no term for the spill.
    # ⚠️ AND THE ARGUMENT I USED TWICE AGAINST RAISING IT WAS OVER-READ. I cited "the more a guard
    # has to say, the less the model hears" as if it were a dose-response measurement on volume.
    # It is not: it is a GLOSS on the two-documents-deliver-neither finding, which is about stdout
    # framing, not payload size. There is no measurement here saying 4 KB is read and 6 KB is not.
    # The honest position is that the volume cost is UNMEASURED in both directions, and 10000 buys
    # a large, measured reduction in silent rule loss against that unmeasured cost.
    # ⛔ CAP BOUNDS THE SUM OF RULE BODIES — IT IS NOT THE EMITTED DOCUMENT, AND CONFLATING THE
    # TWO SHIPPED A LIVE SERIOUS DEFECT. The document is
    # header + bodies + separators + notice, so a CAP of 10000 emitted up to 11,154 chars against
    # the harness's 10,000-char `additionalContext` ceiling. Over that ceiling the payload is
    # SPILLED TO A FILE and the model receives a ~2 KB preview — near-total loss, silent, and it
    # looks like successful delivery from inside this script. Measured on disk before the fix:
    # 28 spilled shell-trap payloads across FIVE sessions, 10,140-11,154 B, zero before the raise.
    # 9000 leaves room for the framing; `MAX_DOC` below is the thing that actually binds.
    CAP, MAX_RULES, out, used = 9000, 25, [], 0
    # ⛔ RANKING IS BY THE LENGTH OF THE FIRST KEY IN THE ENTRY HEADER THAT MATCHED, NOT THE LONGEST: the
    # match loop above breaks on the first hit, so header order decides between the keys of one entry; 56 of 117
    # headers do not list them longest-first. AND SEVERITY-FIRST WAS MEASURED AND REJECTED
    # (2026-09-21). The obvious fix for "a load-bearing trap loses to a chatty one" is to sort the
    # ⛔-marked entries first. DO NOT: that marker is a FORMAT artifact here, not a severity signal.
    # Measured over all 93 entries — every one of the 45 ⛔ entries is a `-` BULLET, and all 30
    # `##` SECTION entries carry no marker at all. So severity-first is exactly "bullets before
    # sections", and on 5,237 real commands it demoted five of the most load-bearing rules in the
    # corpus (the `|| echo 0` on `grep -c` rule −300 deliveries, READ-COUNTS-NEVER-A-PIPED-EXIT-CODE
    # −249, the todo.txt range-read −301) to promote narrower bullets. A ranking key chosen from an
    # ACCIDENTAL property of how an entry was written is worse than no re-ranking at all.
    # ⛔ AND RARITY-FIRST WAS MEASURED AND REJECTED TOO.
    # Rank by how RARE the matched key is over real commands, tie-broken by length. It is the
    # better-motivated version of the same idea — rarity is a property of the KEY, not of how the
    # entry happens to be formatted — and its summary statistics look like a win: worst-starved
    # rule 72.5% -> 88.4% delivery, rules below 80% 1 -> 0, median 99.4% -> 100%, mean 97.8% -> 98.8%.
    # ⭐ IT LOSES ON THE ONLY READING THAT MATTERS, AND THE SUMMARY IS WHAT HID IT. Simulator
    # validated 70/70 byte-identical against this hook AS IT STOOD AT (CAP 10000, no
    # per-context dedupe, no MAX_DOC; the simulator is not on disk), over 5,237 real peer commands:
    #   - TOTAL rule-deliveries 30,043 -> 29,914. It delivers 129 FEWER rules, not more.
    #   - The whole apparent gain is ONE entry: the `grep -E` alternation false-zero, +234.
    #   - The losses land on the three entries this corpus NAMES as load-bearing, the same three
    #     severity-first demoted: `|| echo 0` on `grep -c` -158, the todo.txt range-read -141,
    #     READ-COUNTS-NEVER-A-PIPED-EXIT-CODE -33. Same rules, same direction, about half the size.
    # So both rejected rankings fail the same way, and a DISTRIBUTION SUMMARY cannot show it: lifting
    # one starved entry moves every percentile while the corpus's most-cited rules quietly lose a
    # tenth of their deliveries. ⚠️ READ WHICH ENTRIES MOVE AND IN WHICH DIRECTION, never the spread.
    # It would also have cost a per-key frequency baked into the table — a generated number with no
    # regeneration trigger, i.e. the drift defect this file was corrected for earlier the same day.
    # ⚠️ DATED: the rarity figures above were measured — CAP 10000, MAX_RULES 25, 94 entries,
    # every match delivered on every command (before the once-per-context dedupe and the MAX_DOC clamp).
    # All of those have moved; re-run the simulator against THIS hook before citing them as its property.
    dropped = []
    for k, body in hits:
        if len(out) >= MAX_RULES:
            dropped.append(body)
            continue
        # ⛔ `out and` IS LOAD-BEARING: WITHOUT IT AN OVER-CAP *FIRST* MATCH DELIVERS NOTHING AT ALL.
        # Measured live 2026-09-21, three independent corpora: the false-zeros instrument table is
        # ~6,432 B against a CAP of 6000, and its shortest key is `rg` — so it sorted first for
        # every `rg` / `grep -r` command, the loop broke on iteration ONE with `out` empty, and the
        # fleet's two commonest search verbs got a notice reading "showing the 0 most specific"
        # and ZERO rules. A cap must never be able to deliver LESS THAN ONE rule; an over-cap
        # single rule is the lesser evil against silence, because silence is indistinguishable
        # from "no trap applies to this command".
        if out and used + len(body) > CAP:
            dropped.append(body)
            continue  # NOT `break` — a later, SMALLER rule still fits and is still owed. `break`
                      # here discarded every rule sorted after the oversized one.
        out.append(body)
        used += len(body)
    # Only a body that reaches the emitted document WHOLE is marked seen (checked after the clamp below) — a
    # body in `dropped`, or one the MAX_DOC clamp cut, was never shown and stays owed.
    shown = list(out)
    # ⛔ NAME WHAT WAS DROPPED. The notice used to read "showing the N most specific" and identified
    # NOTHING, so a dropped rule was indistinguishable from a rule that never matched — a silent
    # loss, on 62.8% of matching commands (5,237 real commands, 14 peer transcripts, 2026-09-21).
    # Naming costs ~70 B per dropped rule against ~750 B to raise MAX_RULES to 6, and it is the
    # only fix here that needs no judgement about which rule matters more: the reader decides.
    if dropped:
        def headline(b):
            for ln in b.splitlines():
                # Strip LEADING markers only. A blanket class ate `>` mid-text and turned
                # `|| echo "<conclusion>"` into `|| echo "<conclusion`, corrupting the very
                # rule name the reader needs to grep for.
                ln = re.sub(r"^[-*#>\s]+", "", ln.strip())
                ln = re.sub(r"[`*⛔⚠⭐️]", "", ln).strip()
                if ln:
                    return ln[:88]
            return "(untitled entry)"
        # ⛔ insert(0), NOT append: the over-ceiling preview keeps the FRONT, so a notice appended
        # last is the FIRST thing cut — the fix for silent loss was 100% ineffective on exactly the
        # commands that lose most. The reader must learn something is missing before anything else.
        out.insert(0, "… %d further trap(s) matched this command and did NOT fit. That absence is a CAP,"
                   " not a clean bill — read them in .claude/traps/shell-traps.md:\n%s"
                   % (len(dropped), "\n".join("   · " + headline(b) for b in dropped[:8])))
    ctx = ("SHELL TRAPS matching this command (delivered by shell-trap-inject.sh; the full table is "
           ".claude/traps/shell-traps.md):\n\n" + "\n\n".join(out))
    # ⛔ CLAMP THE DOCUMENT, NOT JUST THE BODIES. `band-o-inject.sh`, `commit-doctrine-inject.sh`,
    # `orchestrator-inject.sh` and `trigger-index-match.sh` all clamp the emitted string at 9500-9700;
    # this hook was the fleet's ONLY exception and that is what let that serious defect ship. The ceiling is not a
    # guess: `trigger-index-match.sh` asserts `10,000-char additionalContext cap` in a shipped string.
    # ⛔ MEASURE THE NOTICE, NEVER RESERVE A ROUND NUMBER FOR IT. This reserved a hardcoded 220
    # chars for a notice that is 243, so the clamp emitted 9,723 against its own 9,700 ceiling — a
    # guard that breaches the limit it exists to enforce, by 23 chars, silently. Nothing in the suite
    # could see it until a test for it was added, and it was caught on that test's first run.
    # The notice is built with MAX_DOC in the numerator slot precisely so the reservation is a
    # CEILING: keep < MAX_DOC, so len(str(keep)) <= len(str(MAX_DOC)), so the real notice is never
    # longer than the one measured. The final slice is an unconditional backstop — if the arithmetic
    # is ever wrong again, the payload is short and ugly rather than spilled.
    MAX_DOC = 9700
    if len(ctx) > MAX_DOC:
        total = len(ctx)
        note = ("\n\n… THIS PAYLOAD WAS CLAMPED at %d of %d chars to stay under the harness's 10,000-char"
                " additionalContext ceiling. Past it the whole payload is spilled to a file and you get a"
                " preview instead. Read the rest in .claude/traps/shell-traps.md.")
        keep = MAX_DOC - len(note % (MAX_DOC, total))
        ctx = (ctx[:keep].rstrip() + (note % (keep, total)))[:MAX_DOC]
    json.dump({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": ctx}}, sys.stdout)
    delivered_now = [key(b) for b in shown if b in ctx]
    if seen_path and delivered_now:
        try:
            os.makedirs(os.path.dirname(seen_path), exist_ok=True)
            with open(seen_path, "a", encoding="utf-8") as fh:
                fh.write("".join(k + "\n" for k in delivered_now))
        except Exception:
            pass
except Exception:
    sys.exit(0)
PY
exit 0
