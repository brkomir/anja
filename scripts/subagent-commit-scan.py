#!/usr/bin/env python3
"""subagent-commit-scan.py — did any SUB-AGENT run a commit verb after the never-commit rule landed?

Sub-agents never commit, stage or push: they work on a shared worktree, so the simplest rule, needing no
further logic, is that they do not commit at all. NO hook backs that rule until it recurs. This is the
instrument the recurrence trigger fires on. It scans every sub-agent transcript
under ~/.claude/projects/<key>/*/subagents/agent-*.jsonl whose FIRST record is at or after --since and
reports each Bash tool_use whose command carries a commit verb. Read-only. Exit 1 on any hit, 0 on none,
2 on a usage error — so a caller can gate on it.

  python3 scripts/subagent-commit-scan.py                      # since the rule landed (2026-09-03T21:00Z)
  python3 scripts/subagent-commit-scan.py --since 2026-09-03T00:00:00Z   # the pre-rule baseline: 0 of 166 (a substring scan had read 4 — all mentions)

Denominator note: the population is TRANSCRIPTS (one per dispatched agent that produced records), not
dispatch-log rows — the dispatch log carries no command field and cannot answer this (design doc §1).
"""
import argparse, glob, json, os, re, sys

# A verb counts only at COMMAND POSITION (start of the command or after ; && || | $( ), optionally via bash/sh and a
# scripts/ prefix). A grep ARGUMENT that mentions safe-commit.sh is documentation, never an instance — the first
# run of this script counted one such mention (2026-09-03) and the substring form over-reads by design.
# ⛔ THE `(?:bash|sh)` PREFIX MUST ADMIT FLAGS AND AN OPENING QUOTE, OR `bash -c 'git commit …'`
# MATCHES NOTHING. The original form allowed only `bash ` immediately before the verb, so the
# single most likely way a sub-agent wraps a commit was invisible to this instrument — a silent
# false ZERO in the exculpatory direction. Found 2026-09-04 by a positive control,
# NOT by reading the regex; the control was written to prove a new filter had not eaten real
# matches and indicted the pre-existing pattern instead.
# ⛔ `re.M` IS LOAD-BEARING AND WAS MISSING UNTIL 2026-09-04 — WITHOUT IT `^` ANCHORS TO STRING
# START ONLY, AND `\n` IS NOT IN `[;&|(]`, SO A VERB BEGINNING ANY CONTINUATION LINE SITS AT NO
# RECOGNISED COMMAND POSITION. Multi-line commands are the NORMAL shape here, so the scan was blind
# to most real invocations while reporting a confident count. Measured: `VERB_RE.flags` read 32
# (UNICODE only); `echo hi\ngit commit -m x` read CLEAN. ⭐ The tell was one line down — `_HEREDOC`
# already carried `re.S | re.M`; the flag was reached for in one regex of the pair and not the
# other. Reproduced on my own instrument before folding the fix.
# ⛔ THE FLAG CLASS MUST ADMIT LONG FLAGS — `-\w+` CANNOT MATCH `--norc`, SO A REAL INVOCATION
# WRAPPED IN ONE WAS INVISIBLE. Found 2026-09-05 by a CONTROL written for the _NOEXEC widening,
# not by reading this line: the fixture `bash --norc scripts/safe-commit.sh` was added to prove
# the noexec filter does not over-exempt, and it FAILED — because the scanner never saw the
# command at all. Same shape as the founding finding (`bash -c` needing to admit flags),
# one flag-syntax over, and the same exculpatory direction: a silent false NEGATIVE.
# ⚠️ `zsh`/`ksh` added with it — the old list was bash/sh only, so `zsh --no-rcs <tool>` was
# invisible twice over. Controls: a bare `echo hi` and a `cat | wc` must still match nothing.
VERB_RE = re.compile(r"(?:^|[;&|(]\s*|\$\(\s*)(?:(?:bash|sh|zsh|ksh)\s+(?:--?[\w-]+\s+)*['\"]?)?(?:\./)?(?:scripts/)?(git\s+(?:commit|add|push|update-index|commit-tree)|safe-commit\.sh|private-index-commit\.sh)\b", re.M)
DEFAULT_SINCE = "2026-09-03T21:00:00Z"   # the rule landed 2026-09-03 ~20:40Z; anything after is a recurrence

# ── The trigger fired on 2026-09-04 with THREE hits and ZERO recurrences. Both filters below come
# ── from reading those three, and the trigger's own record had warned that its retracted "4 ran
# ── safe-commit" figure was a substring count of MENTIONS — this is that class, one level in.
#
# (1) A SHELL OPERATOR INSIDE A NON-SHELL INTERPRETER'S PAYLOAD IS NOT A COMMAND BOUNDARY.
# VERB_RE treats `|`, `;`, `&`, `(` as command position. Two of the three hits were a `git commit`
# / `git push` literal sitting inside a REGEX ALTERNATION in a python heredoc and an awk pattern —
# `…|git commit|push)` — where the pipe is regex syntax, not a shell pipe. So we blank the payloads
# of interpreters that do not run shell.
#
# ⛔ `bash -c` AND `sh -c` ARE DELIBERATELY NOT IN THIS LIST, and that is the whole risk of the
# filter: their payload IS shell, so blanking it would hide a real violation. Stripping one side of
# a two-sided predicate hardens the wrong side; the self-test's positive control is a
# `bash -c 'git commit …'` that MUST still fire.
# ⛔ `cat` AND `tee` ARE HERE BECAUSE THEY DO NOT EXECUTE THEIR HEREDOC — THEY WRITE IT. Found by
# me 2026-09-04 while classifying the hits the `re.M` fix newly surfaced: three "violations" from
# one review lens were `cat > /tmp/probe.py <<'PY' … PY` bodies containing MY OWN fixture
# strings. Adding `re.M` was correct and it exposed this class rather than creating it — a payload
# being WRITTEN to a file is not a command being RUN, which is the only thing the never-commit rule
# bans. Without this the scan floods with false positives on exactly the seats reviewing it.
# ⚠️ RESIDUAL, STATED NOT CLOSED: `cat <<'EOF' | bash` DOES execute, and this blanks it. That shape
# has zero instances in the corpus today and covering it needs pipe-target analysis; the arm below
# pins the behaviour so the next reader meets a documented bound rather than a surprise.
NON_SHELL = r"(?:python3?|awk|perl|sed|jq|ruby|node|cat|tee)"
# ⛔ THE CLASS MUST EXCLUDE COMMAND SEPARATORS, NOT JUST NEWLINES. With `[^\n]*?` any NON_SHELL
# name ANYWHERE EARLIER ON THE LINE claims the heredoc — so `python3 -c '…'; bash <<'EOF'` blanks
# a genuine SHELL body and hides a real commit. The interpreter only owns a heredoc on its OWN
# command segment. A regression I introduced, and one currently MASKED by
# the missing `re.M` above (the verb sits on a continuation line, so nothing matched either way) —
# which is why it needs its own self-test arm rather than a re-run of the old ones.
# ⚠️ TWO HOOKS REASSIGN THIS NAME BY MONKEYPATCH — .claude/hooks/commit-doctrine-inject.sh and
# .claude/hooks/commit-review-warn.sh both set `scs._HEREDOC` to a widened form before calling
# strip_non_shell_payloads(). Rename or restructure it and their assignment is silently ignored: the import
# still succeeds, stripping falls back to this narrower pattern, and neither hook fails toward firing.
_HEREDOC = re.compile(rf"{NON_SHELL}\b[^\n;&|]*?<<-?\s*['\"]?(\w+)['\"]?\n(.*?)^\1\b", re.S | re.M)
_INLINE = re.compile(rf"({NON_SHELL}\b(?:\s+-\w+)*\s+)('[^']*'|\"[^\"]*\")")

def strip_non_shell_payloads(cmd: str) -> str:
    """Blank the bodies non-shell interpreters own, preserving offsets is unnecessary — we only match."""
    out = _HEREDOC.sub(lambda m: m.group(0)[: m.start(2) - m.start(0)] + m.group(1), cmd)
    return _INLINE.sub(lambda m: m.group(1) + ("'" + "" + "'"), out)

# (2) A COMMIT INTO A THROWAWAY REPO CANNOT TOUCH THE SHARED WORKTREE. The third hit was
# `R="$(cd "$(mktemp -d)" && pwd -P)"; cd "$R"; git init -q .; …; git commit -qm base` — a test
# fixture, isolated by construction. The rule this instrument enforces is about the SHARED
# worktree, so a scratch repo is out of scope by the obligation, not by convenience. Reported in
# its own bucket rather than dropped, so the classification stays visible and auditable.
_SCRATCH = re.compile(r"git\s+init\b")
_TEMPROOT = re.compile(r"mktemp\s+-d|/tmp/|\$TMPDIR|scratchpad")

def is_scratch(cmd: str) -> bool:
    return bool(_SCRATCH.search(cmd) and _TEMPROOT.search(cmd))


# (3) A VERB INSIDE A SEARCH TOOL'S PATTERN IS THE SUBJECT BEING SEARCHED FOR, NEVER A COMMAND.
# The 2026-09-05 firing reported 9 violations across 3 parent sessions, which READS as
# independence. Hand-classified with every command opened: SEVEN were mentions, in three shapes,
# and this is the commonest — a search whose PATTERN argument is the verb, e.g.
# `grep -rn --include=SKILL.md -E "<verb> origin main|<verb>\b"` and
# `grep -n 'word-split\|wordsplit\|<verb>' .claude/hooks/block-dangerous.sh`.
# `session-cadence.md` predicts exactly this: a use-detecting guard false-positives hardest on
# the most careful files, because prose ABOUT commits is where commit vocabulary lives.
# ⛔ WE BLANK ONLY THE QUOTED ARGUMENTS OF A SEARCH CALL, NEVER THE REST OF THE COMMAND, so
# `grep -q x f && <commit verb>` still fires. The argument list stops at `;`, `|` and `&` by
# construction, while a quoted alternation CONTAINING those characters is consumed atomically —
# which is why the alternatives are ordered quoted-first.
# ⚠️ This is the same one-sided-strip hazard the NON_SHELL filter above carries, and the same
# answer: the positive controls below must keep firing, or the filter has eaten its own subject.
_SEARCH = r"(?:grep|rg|egrep|fgrep|ugrep|ag)"
_SEARCH_CALL = re.compile(rf"\b{_SEARCH}\b(?:\s+(?:'[^']*'|\"[^\"]*\"|[^\s;|&]+))*")


def blank_search_patterns(cmd: str) -> str:
    """Blank the quoted pattern arguments of a search call; leave every other token alone."""
    def repl(m):
        s = m.group(0)
        s = re.sub(r"'[^']*'", "''", s)
        s = re.sub(r'"[^"]*"', '""', s)
        return s
    return _SEARCH_CALL.sub(repl, cmd)


# (4) THE OTHER TWO MENTION SHAPES ARE POSITIONAL, so they are judged on the command SEGMENT the
# match sits in rather than by blanking text:
#   · `bash scripts/private-index-commit.sh --self-test`  — THREE of the seven. A self-test builds
#     and commits into its OWN throwaway repos, so it cannot reach the shared worktree; but
#     `is_scratch` misses it because the command text carries no `git init` — that happens inside
#     the script, one process down. Same obligation as the SCRATCH bucket, different evidence.
#   · `git diff HEAD -- scripts/private-index-commit.sh`  — ONE of the seven. The commit tool is
#     the OBJECT of a read-only verb, not the thing being run.
# ⛔ A SEGMENT IS BOUNDED BY `;` `&&` `||` `|` `(` AND NEWLINE, so a reader command can never vouch
# for a verb in a LATER segment — `cat f && <commit verb>` still fires. This bound is what keeps
# the positional test from becoming a blanket exemption for any command that mentions a reader.
_SEG_SPLIT = re.compile(r"(?:\|\||&&|[;|&\n(])")
_READER = re.compile(
    r"^\s*(?:[A-Za-z_]\w*=\S+\s+)*"
    r"(?:git\s+(?:diff|show|log|blame|cat-file|ls-files|ls-tree|status|rev-parse)"
    r"|grep|rg|egrep|fgrep|ugrep|ag|cat|wc|head|tail|less|more|diff|md5|md5sum|shasum|stat|ls|file|bat|open)\b")
_TOOL_NOOP = re.compile(r"--(?:self-test|help|dry-run)\b")
# ⛔ A SHELL INVOKED WITH `-n` PARSES AND DOES NOT EXECUTE, so `bash -n scripts/<tool>.sh` names a
# commit tool without running it. Found IN PRODUCTION 40 minutes after the
# use-vs-mention fix shipped: a peer editing private-index-commit.sh syntax-checked their own edit
# twice, and both reads landed in the VIOLATION bucket. It is not an exotic shape — validating an
# edit to a commit tool is exactly when a seat reaches for `bash -n`, so this recurs by
# construction on the files most likely to be matched. `shellcheck` is the same class.
# ⛔ `-n` IS NOT ALWAYS A SEPARATE TOKEN. The first form required a bare
# `-n` argument, and FOUR noexec shapes escaped it — `bash -nx` and `bash -xn` (combined short
# flags), `env bash -n` (env prefix), `bash --norc -n` (long flag first). All four failed in the
# OVER-report direction, which is safe, and it still mattered for the right reason: this
# scanner's own argument for narrowing is that a SMALL count is what makes a new hit visible, so
# false positives re-inflate exactly the number the detector depends on. `bash -nx` is the
# plausible one — syntax-check with trace is a real habit; the other three are theoretical.
# ⚠️ THE THREE CONTROLS MATTER MORE THAN THE WIDENING: a normal invocation, `bash -x` (which
# RUNS the script), and `bash --norc` with no -n must all STAY violations. Verified 12/12.
_NOEXEC = re.compile(r'^\s*(?:[A-Za-z_]\w*=\S+\s+)*(?:env\s+(?:[A-Za-z_]\w*=\S+\s+)*)?'
                     r'(?:(?:bash|sh|zsh|ksh)(?:\s+--[\w-]+)*(?:\s+-[a-z]*n[a-z]*)\b|shellcheck\b)')


def _segment(text: str, pos: int) -> str:
    """The command segment containing `pos`, bounded by shell command separators."""
    start = 0
    for m in _SEG_SPLIT.finditer(text, 0, pos):
        start = m.end()
    m = _SEG_SPLIT.search(text, pos)
    return text[start : (m.start() if m else len(text))]


def is_mention(seg: str, verb: str) -> bool:
    if verb.endswith(".sh"):
        if _TOOL_NOOP.search(seg):
            return True                                                  # --self-test / --help / --dry-run
        if re.search(r"--\s+\S*" + re.escape(verb), seg):
            return True                                                  # `git diff … -- scripts/<tool>`
        if _NOEXEC.match(seg):
            return True                                                  # `bash -n scripts/<tool>` / shellcheck
    return bool(_READER.match(seg))


def find_violation(cmd: str):
    """The first commit verb at a real EXECUTION position, or None.

    ⛔ ITERATES EVERY MATCH. The old code took `VERB_RE.search(...)` — the FIRST match — and on a
    multi-command line the first match is routinely a mention, so a real violation sitting behind
    one was invisible. Filtering without iterating would have traded a false positive for a false
    negative in the exculpatory direction, which is the worse of the two here.
    """
    text = blank_search_patterns(strip_non_shell_payloads(cmd))
    for m in VERB_RE.finditer(text):
        # ⛔ `m.start(1)`, NOT `m.start()`. VERB_RE's match INCLUDES the `[;&|(]\s*` command-position
        # prefix, so `m.start()` points at the SEPARATOR — one character into the PREVIOUS segment.
        # `cat f | wc -l; <commit verb>` then judged the verb by the segment `wc -l`, read `wc` as a
        # reader, and exonerated a real commit. Caught by the two positive controls written to prove
        # a reader cannot vouch for a later segment; both FAILED on first run, in the exculpatory
        # direction, which is the one nobody re-checks.
        if not is_mention(_segment(text, m.start(1)), m.group(1)):
            return m.group(1)
    return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default=DEFAULT_SINCE, help="ISO-8601 UTC lower bound on the transcript's first record")
    ap.add_argument("--project-key", default="<project-key>")
    ap.add_argument("--self-test", action="store_true", help="run the classifier fixtures (real hits and positive controls)")
    a = ap.parse_args()
    if a.self_test: return self_test()
    root = os.path.expanduser(f"~/.claude/projects/{a.project_key}")
    if not os.path.isdir(root):
        print(f"subagent-commit-scan: no harness project directory at {root}; pass --project-key", file=sys.stderr)
        return 2
    paths = glob.glob(os.path.join(root, "*", "subagents", "agent-*.jsonl"))
    scanned = 0; hits = []
    for p in paths:
        first = None; cmds = []
        try:
            with open(p, encoding="utf8") as fh:
                for line in fh:
                    try: r = json.loads(line)
                    except Exception: continue
                    ts = r.get("timestamp")
                    if first is None and ts: first = ts
                    m = r.get("message")
                    if not isinstance(m, dict) or m.get("role") != "assistant": continue
                    for part in (m.get("content") or []):
                        if isinstance(part, dict) and part.get("type") == "tool_use" and part.get("name") == "Bash":
                            cmd = str(part.get("input", {}).get("command", ""))
                            verb = find_violation(cmd)
                            if verb:
                                kind = "SCRATCH" if is_scratch(cmd) else "VIOLATION"
                                cmds.append((ts, verb, cmd.replace("\n", " ⏎ "), kind))
        except Exception:
            continue
        if not first or first < a.since: continue
        scanned += 1
        for ts, v, cmd, kind in cmds:
            # ⛔ `os.path.relpath`, NOT `p.replace(root + "/", "")` — the strip and the glob that
            # built the path are 25 lines apart and joined only by a bare string concat, so a
            # trailing slash on `root` silently defeats it. The failure is the bad direction:
            # the path stays ABSOLUTE, the session key below becomes '' for every hit, all
            # violations collapse to ONE pseudo-session, and the closing line then always counsels
            # "arguably ONE occurrence" — suppressing escalation, plausibly, with no error.
            # Measured: root-with-slash gives key='' where root gives the 8-hex session prefix;
            # relpath gives that prefix for zero, one or two trailing slashes. The fix was two
            # lines and removes the coupling rather than documenting it.
            hits.append((os.path.relpath(p, root), ts, v, cmd, kind))
    violations = [h for h in hits if h[4] == "VIOLATION"]
    scratch = [h for h in hits if h[4] == "SCRATCH"]
    print(f"subagent-commit-scan: {scanned} sub-agent transcript(s) started at/after {a.since}; "
          f"{len(violations)} violation(s), {len(scratch)} scratch-repo fixture(s)")
    for f, ts, v, cmd, kind in hits:
        print(f"  {kind:<9} {ts} {v:<24} {f}\n      {cmd}")
    if violations:
        # ⛔ THIS LINE USED TO READ "the never-commit rule RECURRED: build the marker-keyed warn
        # hook" — an instrument asserting a CONCLUSION its data cannot support, and prescribing a
        # fleet-wide hook off it. Violation COUNT is not OCCURRENCE count: `session-cadence.md`
        # keys occurrence on CAUSAL INDEPENDENCE, never wall-clock, so N hits from one session
        # running one recipe may be ONE occurrence. The scanner can count; only a reader can
        # classify. It now reports and hands over rather than concluding.
        sessions = {h[0].split("/")[0][:8] for h in violations}
        print(f"  ⇒ {len(violations)} violation(s) across {len(sessions)} parent session(s): {', '.join(sorted(sessions))}")
        print("     CLASSIFY BEFORE COUNTING: same session + same recipe = arguably ONE occurrence")
        print("     (session-cadence.md § TWO ERRORS FROM ONE CAUSAL THREAD). Read the commands, then")
        print("     decide.")
    elif scratch:
        print("  ⇒ NOT a recurrence. Every hit is a commit into a throwaway repo, which cannot reach the shared worktree.")
    return 1 if violations else 0


# ── Fixtures began as the three REAL 2026-09-04 commands plus the control the filter could break; each section below adds a shape found since.
SELF_TEST = [
    # (label, command, expect_verb_match_after_strip, expect_scratch)
    ("mention: git commit inside a python heredoc regex alternation",
     "python3 - <<'PY'\nimport re\norch = re.compile(r\"(bus|todo|safe-commit|git commit|push)\")\nPY", False, False),
    ("mention: git push inside an awk pattern",
     "export LC_ALL=C; awk '/^\\| /{ if ($0 ~ /mail-send|git push|safe-commit/) print }' f.txt", False, False),
    ("scratch: git init in a mktemp -d throwaway repo",
     'set -e\nR="$(cd "$(mktemp -d)" && pwd -P)"\ncd "$R"\ngit init -q .\ngit add f.txt; git commit -qm base', True, True),
    # POSITIVE CONTROLS — these MUST still fire, or the filter has eaten the thing it exists to find.
    ("real: a bare commit on the shared worktree", "git commit -m 'fix'", True, False),
    ("real: bash -c payload IS shell and must not be stripped", "bash -c 'git commit -m x'", True, False),
    ("real: after a shell pipe", "make build | git commit -F -", True, False),
    ("real: safe-commit.sh", "bash scripts/safe-commit.sh --add 1 --del 0 -F m -- f", True, False),
    # ── Two reported misses. Both were REAL and both are the shape the old arms could not reach.
    ("real: verb STARTS a continuation line (needs re.M)",
     'echo "=== 7. my two files ==="\ngit commit -m x', True, False),
    ("real: git add -N on a continuation line — the 2026-09-03 occurrence-2 shape",
     'SD=/tmp/x\nwc -l a.mts b.ts\ngit add -N a.mts b.ts', True, False),
    ("real: a NON_SHELL name earlier on the line must NOT blank a bash heredoc",
     "python3 -c 'print(1)'; bash <<'EOF'\ngit commit -m sneaky\nEOF", True, False),
    ("mention: python3's OWN heredoc still blanks (the strip must not be defeated wholesale)",
     "python3 <<'PY'\nre.compile(r'git commit|push')\nPY", False, False),
    # ── The class the re.M fix EXPOSED: a heredoc written to a file is not executed. Three of the
    # five hits that fix surfaced were this shape, from the very lens reviewing this scanner.
    ("mention: cat > file.py heredoc carrying a verb string is WRITTEN, never RUN",
     "cat > /tmp/probe.py <<'PY'\ncases = [\"bash -c 'git commit -m x'\"]\nPY", False, False),
    ("mention: tee heredoc, same reason",
     "tee /tmp/x.py <<'PY'\ngit commit -m x\nPY", False, False),
    # ── The 2026-09-05 firing: 9 reported, SEVEN mentions, three shapes. All four below are the
    # ── REAL commands, verbatim from that scan's output, and each stood as a "violation".
    ("mention: verb inside a grep -E double-quoted pattern (real, 2026-09-05)",
     'cd <repo-root>/.claude/skills && echo "=== probes ==="; '
     'grep -rn --include=SKILL.md -E "git ' 'push origin main|git ' 'push\\b"', False, False),
    ("mention: verb inside a grep single-quoted alternation (real, 2026-09-05)",
     "grep -n 'word-split\\|wordsplit\\|git add' .claude/hooks/block-dangerous.sh | head -30", False, False),
    ("mention: a commit tool run with --self-test commits only into its own throwaway repos (real)",
     "bash scripts/private-index-commit.sh --self-test > /tmp/selftest.txt 2>&1; echo rc=$?", False, False),
    ("mention: the commit tool is the OBJECT of a read-only verb, not the thing run (real)",
     'cd <repo-root> || exit 1\n'
     'echo "=== shared script untouched? ==="\n'
     'git diff HEAD -- scripts/private-index-commit.sh | wc -l', False, False),
    # ── POSITIVE CONTROLS for the two new filters. Each is the shape that would prove the filter
    # ── has become a blanket exemption; all four MUST still fire.
    ("real: a search call must not exempt a LATER segment",
     "grep -q 'git add' f.txt && git commit -m y", True, False),
    ("real: a reader command must not vouch for a LATER segment",
     "cat notes.txt | wc -l; git commit -m y", True, False),
    ("real: a mention FIRST and a genuine commit after it — find_violation must iterate, not stop",
     "grep -n 'git add' scripts/safe-commit.sh; git commit -am wip", True, False),
    ("real: the tool itself, actually invoked, with no --self-test",
     "bash scripts/private-index-commit.sh --add 1 --del 0 -F m -- f", True, False),
    # ── Found in production 40 min after the fix above shipped.
    ("mention: `bash -n` parses without executing (real, 2026-09-05, twice in one agent)",
     'bash -n scripts/private-index-commit.sh && echo "syntax OK"', False, False),
    ("mention: shellcheck is the same class",
     "shellcheck scripts/safe-commit.sh", False, False),
    # ── Four noexec shapes the first _NOEXEC missed.
    ("mention: `bash -nx` — combined short flags, the plausible one",
     "bash -nx scripts/safe-commit.sh", False, False),
    ("mention: `bash -xn` — combined, other order",
     "bash -xn scripts/safe-commit.sh", False, False),
    ("mention: `env bash -n` — env prefix before the shell",
     "env bash -n scripts/safe-commit.sh", False, False),
    ("mention: `bash --norc -n` — long flag before -n",
     "bash --norc -n scripts/safe-commit.sh", False, False),
    # ⛔ CONTROLS for the widening — all four must STAY violations.
    ("real: `bash -x` RUNS the script, it does not parse it",
     "bash -x scripts/safe-commit.sh", True, False),
    ("real: a long flag with NO -n is a normal invocation",
     "bash --norc scripts/safe-commit.sh", True, False),
    ("real: the noexec filter must not exempt a shell invoked NORMALLY",
     "bash scripts/private-index-commit.sh -F m -- f", True, False),
    ("real: `bash -n` on one segment must not vouch for a verb in the NEXT",
     "bash -n scripts/safe-commit.sh && git commit -m y", True, False),
]

# ⚠️ DOCUMENTED RESIDUAL, deliberately NOT in SELF_TEST as a passing arm because it is a KNOWN
# MISS rather than a behaviour to lock in: `cat <<'EOF' | bash` executes its body and this scanner
# blanks it. Zero instances in the corpus at the time of writing; closing it needs pipe-target
# analysis. Named here so the next reader meets a bound rather than a surprise.
KNOWN_MISS = "cat <<'EOF' | bash\ngit commit -m x\nEOF"

def self_test() -> int:
    bad = 0
    for label, cmd, want_match, want_scratch in SELF_TEST:
        got_match = bool(find_violation(cmd))
        got_scratch = is_scratch(cmd)
        ok = (got_match == want_match) and (got_scratch == want_scratch)
        if not ok: bad += 1
        print(f"  {'PASS' if ok else 'FAIL'}  match={got_match!s:<5} (want {want_match!s:<5})  "
              f"scratch={got_scratch!s:<5} (want {want_scratch!s:<5})  {label}")
    print(f"self-test: {len(SELF_TEST) - bad}/{len(SELF_TEST)} passed")
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main())
