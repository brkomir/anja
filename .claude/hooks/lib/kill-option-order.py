#!/usr/bin/env python3
"""kill-option-order — find a pkill / pgrep / killall whose option comes AFTER its pattern.

Called by block-dangerous.sh (arm `kill-option-order`) with the Bash command on stdin.
Exit 0 = nothing found. Exit 3 = found: stdout carries ONE hook deny document.
Exit 4 = nothing found, but a line naming a kill tool could not be parsed (or the text was too
large to parse): the hook lets it through and RECORDS it, so a parse gap is not a silent allow.
Any other exit is a helper failure, and the hook lets the command through and records it.

WHY THIS EXISTS (2026-10-05). macOS ships the BSD tools, and their option parsing STOPS at the
first argument that is not an option. A sub-agent ran `pkill -f 'cat' -U $(id -u) -n` meaning
"the newest process of mine whose command line mentions cat". BSD pkill read 'cat', '-U', '501'
and '-n' as four PATTERNS and applied neither limit. With -f a pattern matches anywhere in the
full command line, so 'cat' matched every '/Applications/...' path and '501' every
'/private/tmp/claude-501/...' path: the system log shows 36 launchd jobs "exited due to SIGTERM |
sent by pkill[94157]" in one second, among them Chrome, every other iTerm tab and four Claude
sessions. pkill spares itself and its ANCESTORS (man pkill, -a), so the seat that ran it lived.
Repro without a signal: `pgrep -f '<no-match>' -U $(id -u) -n` matches; options-first matches 0.

WHAT IT CHECKS. Commands in COMMAND POSITION only. A pattern that is merely MENTIONED (inside a
grep pattern, an echo, a commit message, a heredoc body such as a mail) is not a run, so it is
never flagged: a raw-text matcher would block every write-up of this very incident, the
documentation burst session-cadence.md § ASK WHETHER ANYONE EVER WRITES THIS WITHOUT RUNNING IT
warns about. It does descend into what DOES run: $( ) and backtick bodies, `bash|sh|zsh -c '…'`,
`eval`, and the command after sudo / env / nohup / nice / time / exec / xargs. A heredoc fed to a
shell as its SCRIPT (`bash <<EOF`, `cat <<EOF | sh`) is a run too, and its body is scanned.

LIMITS (stated, not hidden). It parses shell text approximately: a heredoc is recognised by
`<<WORD` on its line, and an unbalanced quote falls back to a line-by-line read (a dropped line
naming a kill tool exits 4, which the hook records). A kill issued
from inside Python (`subprocess.run([...])`) or a script file run later is not seen. GNU tools,
which permute arguments, are not what runs here.
"""
import json
import os
import re
import shlex
import sys

TOOLS = {"pkill", "pgrep", "killall"}
# Options that take a value, from the macOS synopsis (man pkill / man killall, read 2026-10-05).
ARG_LETTERS = {"pkill": set("FGPUgtu"), "pgrep": set("FGPUdgtu")}
KILLALL_ARG_OPTS = {"-u", "-t", "-c"}
# `pkill -TERM` / `-SIGHUP` / `-9`. An explicit list, because `body.isupper()` also matched the
# one-letter options -U -F -G -P -I -L and skipped their values (caught by the self-test).
SIGNALS = set("HUP INT QUIT ILL TRAP ABRT EMT FPE KILL BUS SEGV SYS PIPE ALRM TERM URG STOP TSTP "
              "CONT CHLD TTIN TTOU IO XCPU XFSZ VTALRM PROF WINCH INFO USR1 USR2".split())
SHELLS = {"bash", "sh", "zsh", "dash"}
KEYWORDS = {"if", "then", "else", "elif", "do", "while", "until", "!", "{", "}"}
HEREDOC_RE = re.compile(r"(?<!<)<<(-?)[ \t]*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\2")
# A shell with no script operand reads its SCRIPT from stdin, so a heredoc fed to it (`bash <<EOF`,
# `cat <<EOF | sh`) is a run, not a mention.
STDIN_SHELL_RE = re.compile(r"(?:^|[;&|(]\s*)(?:sudo\s+)?(?:\S*/)?(?:bash|sh|zsh|dash)"
                            r"(?:\s+[-+][A-Za-z]+)*\s*(?:[;&|)]|$)")
TOOL_WORD_RE = re.compile(r"\b(pkill|pgrep|killall)\b")
MAX_TEXT = 262144  # shlex is quadratic in one long quoted word: 400 KB took 1.7 s, 1 MB ~10 s per pass
UNPARSED = []


def strip_heredocs(cmd):
    """Drop heredoc BODIES; keep the line that opens each one, and the body of one a shell runs."""
    out, pending, keep = [], [], False
    for line in cmd.split("\n"):
        if pending:
            if line.strip() == pending[0]:
                pending.pop(0)
            elif keep:
                out.append(line)
            continue
        out.append(line)
        pending.extend(m.group(3) for m in HEREDOC_RE.finditer(line))
        keep = bool(pending) and bool(STDIN_SHELL_RE.search(HEREDOC_RE.sub(" ", line)))
    return "\n".join(out)


def _match_paren(s, i):
    """s[i] == '(' just after '$'. Return the index of the matching ')', or -1."""
    depth, sq, dq = 0, False, False
    while i < len(s):
        c = s[i]
        if c == "\\" and not sq:
            i += 2
            continue
        if c == "'" and not dq:
            sq = not sq
        elif c == '"' and not sq:
            dq = not dq
        elif not sq and not dq:
            if c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
                if depth == 0:
                    return i
        i += 1
    return -1


def prepass(cmd, inner):
    """Remove comments, turn unquoted newlines into ';', and lift every $( ) / backtick body
    into `inner` (scanned separately), leaving a placeholder word in its place."""
    out, i, sq, dq = [], 0, False, False
    prev = " "
    while i < len(cmd):
        c = cmd[i]
        if c == "\\" and not sq and i + 1 < len(cmd):
            out.append(cmd[i:i + 2])
            prev = cmd[i + 1]
            i += 2
            continue
        if c == "'" and not dq:
            sq = not sq
        elif c == '"' and not sq:
            dq = not dq
        elif not sq and c == "$" and cmd[i + 1:i + 2] == "(":
            end = _match_paren(cmd, i + 1)
            if end == -1:
                inner.append(cmd[i + 2:])
                out.append(" __SUBST__ ")
                break
            inner.append(cmd[i + 2:end])
            out.append("__SUBST__")
            prev = "_"
            i = end + 1
            continue
        elif not sq and c == "`":
            end = cmd.find("`", i + 1)
            end = len(cmd) if end == -1 else end
            inner.append(cmd[i + 1:end])
            out.append("__SUBST__")
            prev = "_"
            i = end + 1
            continue
        elif not sq and not dq and c == "#" and (prev.isspace() or prev in ";&|()"):
            nl = cmd.find("\n", i)
            i = len(cmd) if nl == -1 else nl
            continue
        elif not sq and not dq and c == "\n":
            out.append(" ; ")
            prev = ";"
            i += 1
            continue
        out.append(c)
        prev = c
        i += 1
    return "".join(out)


def tokenize(text):
    lx = shlex.shlex(text, posix=True, punctuation_chars=True)
    lx.whitespace = " \t\r"
    lx.whitespace_split = True
    lx.commenters = ""
    return list(lx)


def _is_punct(tok):
    return tok != "" and all(ch in "();<>|&" for ch in tok)


def _is_redirect(tok):
    return _is_punct(tok) and ("<" in tok or ">" in tok) and not set(tok) & set(";|()")


def simple_commands(tokens):
    """Split a token list at separators; drop redirections and their targets."""
    cmds, cur, skip = [], [], False
    for t in tokens:
        if skip:
            skip = False
            if t not in ("<(", ">("):  # `cat < <(…)`: the target is a process substitution that RUNS
                continue
        if _is_redirect(t):
            # `2>` arrives as '2', '>': the fd digit is not an argument either.
            if cur and cur[-1].isdigit():
                cur.pop()
            skip = True
            continue
        if _is_punct(t):
            if cur:
                cmds.append(cur)
            cur = []
            continue
        cur.append(t)
    if cur:
        cmds.append(cur)
    return cmds


def _skip_opts(args, i, takes_arg):
    while i < len(args) and args[i].startswith("-") and args[i] != "-":
        if args[i] == "--":
            return i + 1
        i += 2 if args[i] in takes_arg else 1
    return i


def unwrap(argv):
    """Strip assignments, keywords and wrapper commands. Returns (argv, nested_scripts)."""
    i = 0
    while i < len(argv):
        a = argv[i]
        base = os.path.basename(a)
        if a in KEYWORDS or re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", a):
            i += 1
        elif base == "sudo":
            i = _skip_opts(argv, i + 1, {"-u", "-g", "-h", "-p", "-C", "-U", "-r", "-t", "-T"})
        elif base == "env":
            i += 1
            while i < len(argv) and (argv[i].startswith("-") or "=" in argv[i]):
                i += 2 if argv[i] in {"-u", "-P", "-S"} else 1
        elif base == "nice":
            i = _skip_opts(argv, i + 1, {"-n"})
        elif base in {"nohup", "exec", "builtin", "noglob", "nocorrect"}:
            i = _skip_opts(argv, i + 1, {"-a"})
        elif base in {"time", "caffeinate"}:  # `time -p`, /usr/bin/time -o f, caffeinate -t N
            i = _skip_opts(argv, i + 1, {"-o", "-t", "-w"})
        elif base == "perl" and "--" in argv[i:] and any("exec @ARGV" in a for a in argv[i:]):
            i = argv.index("--", i) + 1  # the house timeout: perl -e 'alarm N; exec @ARGV' -- cmd
        elif base == "find":
            k = next((k for k in range(i, len(argv)) if argv[k] in {"-exec", "-execdir", "-ok", "-okdir"}), -1)
            if k == -1:
                return [], []
            i = k + 1
        elif base == "trap":  # trap 'script' SIGNAL: the script runs inside this same command
            j = i + 2 if argv[i + 1:i + 2] == ["--"] else i + 1
            return [], ([argv[j]] if j < len(argv) and not argv[j].startswith("-") else [])
        elif base == "command":
            if i + 1 < len(argv) and argv[i + 1] in {"-v", "-V"}:
                return [], []  # a lookup, not a run
            i = _skip_opts(argv, i + 1, set())
        elif base == "xargs":
            i = _skip_opts(argv, i + 1, {"-E", "-I", "-J", "-L", "-n", "-P", "-R", "-S", "-s"})
        elif base == "eval":
            return [], [" ".join(argv[i + 1:])]
        elif base in SHELLS:
            # The script is the first OPERAND after every option, and -o / -O (also a cluster
            # ending in them, `-euo pipefail`) and --rcfile / --init-file take a value; `--` ends options.
            j, has_c = i + 1, False
            while j < len(argv) and argv[j][:1] in "-+" and argv[j] not in ("-", "+"):
                a = argv[j]
                if a == "--":
                    j += 1
                    break
                if not a.startswith("--"):
                    has_c = has_c or "c" in a[1:]
                j += 2 if a in ("--rcfile", "--init-file") or (a[1:2] != "-" and a[-1] in "oO") else 1
            if has_c:
                return [], ([argv[j]] if j < len(argv) else [])
            return argv[i:], []
        else:
            return argv[i:], []
    return [], []


def _is_signal(body):
    """A signal word as pkill (argv[1] only) and killall (any position before --) read it:
    digits, or a name matched case-insensitively with or without SIG (strcasecmp in both)."""
    u = body.upper()
    return body.isdigit() or u in SIGNALS or (u[:3] == "SIG" and u[3:] in SIGNALS)


def check_argv(argv):
    """argv[0] is pkill / pgrep / killall. Return a finding dict or None."""
    tool = os.path.basename(argv[0])
    pattern, i = None, 1
    while i < len(argv):
        a = argv[i]
        # killall reads names, not a getopt operand list, so `--` there only ends its own options.
        if a == "--" and (pattern is None or tool == "killall"):
            return None  # everything after is a pattern, by the caller's own choice
        # AFTER the pattern getopt has already stopped, so `--` and a lone `-` are patterns too:
        # `pkill -f cat -- -n` matches '--' and '-n' anywhere (BSD getopt: `ls x -- y` lists '--').
        if pattern is None and a.startswith("-") and len(a) > 1:
            if tool == "killall":
                i += 2 if a in KILLALL_ARG_OPTS else 1
                continue
            body = a[1:]
            if (body.isdigit() or body in SIGNALS or body[3:] in SIGNALS and body[:3] == "SIG"
                    or tool == "pkill" and i == 1 and _is_signal(body)):
                i += 1
                continue
            step = 1
            for k, ch in enumerate(body):
                if ch in ARG_LETTERS[tool]:
                    if k == len(body) - 1:
                        step = 2  # the value is the next word
                    break  # otherwise the rest of the cluster IS the value
            i += step
            continue
        if pattern is None:
            pattern = a
        elif a.startswith("-"):
            if tool == "killall" and len(a) > 1 and _is_signal(a[1:]):
                i += 1  # killall lifts a signal out of ANY position (kludge_signal_args)
                continue
            return {"tool": tool, "pattern": pattern, "stray": a, "argv": argv}
        i += 1
    return None


def scan(cmd, depth=0):
    if depth > 6:
        return []
    cmd = cmd.replace("\\\n", " ")
    inner = []
    text = prepass(strip_heredocs(cmd), inner)
    if len(text) > MAX_TEXT:
        if TOOL_WORD_RE.search(text):
            UNPARSED.append(text[:80])
        return []
    try:
        tokens = tokenize(text)
    except ValueError:
        tokens = []
        for line in text.split(" ; "):
            try:
                tokens += tokenize(line) + [";"]
            except ValueError:
                if TOOL_WORD_RE.search(line):
                    UNPARSED.append(line)  # e.g. $'it\'s' on the same line: recorded, not silent
                continue
    findings = []
    for argv in simple_commands(tokens):
        argv, nested = unwrap(argv)
        for script in nested:
            findings += scan(script, depth + 1)
        if argv and os.path.basename(argv[0]) in TOOLS:
            f = check_argv(argv)
            if f:
                findings.append(f)
    for body in inner:
        findings += scan(body, depth + 1)
    return findings


def deny_document(f, more=0):
    shown = " ".join(shlex.quote(a) for a in f["argv"])
    if len(shown) > 200:
        shown = shown[:200] + " …"
    reason = (
        "BLOCKED by block-dangerous.sh (kill-option-order): in `" + shown + "` the option `"
        + f["stray"] + "` comes AFTER the pattern `" + f["pattern"] + "`. macOS " + f["tool"]
        + " stops reading options at its first pattern, so `" + f["stray"] + "` and every word "
        "after `" + f["pattern"] + "` become MORE PATTERNS and the limits you wrote never apply. "
        "On 2026-10-05 `pkill -f 'cat' -U $(id -u) -n` matched 'cat', '-U', '501' and '-n' "
        "anywhere in every running command line and sent SIGTERM to Chrome, every "
        "other iTerm tab and four Claude sessions ('cat' is inside '/Applications/', '501' inside "
        "every /private/tmp/claude-501/ path). FIX: put every option before the pattern. Better, "
        "kill by pid: list with `pgrep -lf -- '<long specific pattern>'` (options first), read "
        "the list, then `kill <pid>` for a process you started. -f matches ANYWHERE in the full "
        "command line, so a short pattern matches far more than you think."
    )
    if more:
        reason += " This call has " + str(more) + " more kill command(s) with the same defect: fix them all."
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                   "permissionDecision": "deny",
                                   "permissionDecisionReason": reason}}


# --- self-test: every arm calls scan(), the function the hook runs -------------------------
FIRE = [
    ("the 2026-10-05 command", "pkill -f 'cat' -U $(id -u) -n 2>/dev/null; sleep 0"),
    ("signal after the pattern", "pkill -f foo -9"),
    ("pgrep, flag after", "pgrep -x Finder -q"),
    ("absolute path", "/usr/bin/pkill -f node -n"),
    ("behind sudo", "sudo pkill -f node -n"),
    ("behind an assignment", "FOO=1 pkill -f node -U 501"),
    ("after &&", "cd /tmp && pkill -f node -n"),
    ("on a later line", "echo start\npkill -f node -n\necho done"),
    ("inside $( )", "kill $(pgrep -f node -n)"),
    ("inside backticks", "kill `pgrep -f node -n`"),
    ("inside bash -c", "bash -c 'pkill -f node -n'"),
    ("inside zsh -lc", "zsh -lc \"pkill -f node -n\""),
    ("inside eval", "eval pkill -f node -n"),
    ("after if", "if pgrep -f node -q; then echo up; fi"),
    ("after xargs", "echo x | xargs pkill -f node -n"),
    ("killall, option after the name", "killall node -u '<user>'"),
    ("killall, dry-run flag after the name (it signals for real)", "killall node -s"),
    ("-- after the pattern is one more pattern", "pkill -f vitest -- --run"),
    ("quoted multi-word pattern", "pkill -f \"next start\" -n"),
    ("after a heredoc closes", "cat > /tmp/x <<'EOF'\nbody\nEOF\npkill -f node -n"),
    ("-- AFTER the pattern is a pattern", "pkill -f cat -- -n"),
    ("a lone - AFTER the pattern is a pattern", "pkill -f cat -"),
    ("bash -o pipefail -c", "bash -o pipefail -c 'pkill -f node -n'"),
    ("bash -eo pipefail -c", "bash -eo pipefail -c 'pkill -f node -n'"),
    ("bash -c -x: script is the first operand", "bash -c -x 'pkill -f node -n'"),
    ("shell fed a heredoc", "bash <<'EOF'\nset -e\npkill -f node -n\nEOF"),
    ("inside a trap", "trap \"pkill -f 'next dev' -n\" EXIT; sleep 0"),
    ("time -p", "time -p pkill -f node -n"),
    ("/usr/bin/time", "/usr/bin/time -l pkill -f node -n"),
    ("perl alarm wrapper", "perl -e 'alarm 30; exec @ARGV' -- pkill -f node -n"),
    ("redirect from a process substitution", "cat < <(pkill -f node -n)"),
    ("noglob", "noglob pkill -f node -n"),
    ("find -exec", "find . -name x -exec pkill -f {} -n \\;"),
    # One arm per branch that no arm above reaches (each measured surviving its own deletion).
    ("inside a double-quoted $( )", "P=\"$(pgrep -f node -n)\""),
    ("behind env", "env FOO=1 pkill -f node -n"),
    ("behind nice -n", "nice -n 5 pkill -f node -n"),
    ("behind nohup", "nohup pkill -f node -n"),
    ("behind command", "command pkill -f node -n"),
    ("behind sudo -u <user>", "sudo -u root pkill -f node -n"),
    ("behind xargs -n <count>", "echo x | xargs -n 1 pkill -f node -n"),
    ("a redirect between pattern and option", "pkill -f foo 2>/dev/null -n"),
    ("after a here-string line", "cat <<<foo\npkill -f node -n"),
    ("after a word holding #", "echo a#b; pkill -f node -n"),
    ("named signal ending in a value letter", "pkill -STOP node -n"),
    ("attached value, then pattern, then option", "pgrep -U501 node -n"),
    ("bash -euo pipefail -c", "bash -euo pipefail -c 'pkill -f node -n'"),
    ("bash --rcfile <file> -c", "bash --rcfile /dev/null -c 'pkill -f node -n'"),
    ("heredoc fed to a shell", "bash <<'EOF'\npkill -f node -n\nEOF"),
    ("heredoc piped to a shell", "cat <<'EOF' | sh\npkill -f node -n\nEOF"),
]
CLEAN = [
    ("options first (the fix)", "pkill -n -U \"$(id -u)\" -f 'cat'"),
    ("signal first", "pkill -9 -f foo"),
    ("named signal first", "pkill -SIGTERM -U 501 -f foo"),
    ("one-letter uppercase option with a value", "pgrep -U 501 -F /tmp/pidfile -f foo"),
    ("long specific pattern", "pkill -f 'server.py --port 8797'; echo stopped"),
    ("attached option value", "pgrep -U501 -lf node"),
    ("cluster ending in a value letter", "pgrep -lfU 501 node"),
    ("pattern after --", "pgrep -f -- -n"),
    ("several plain patterns", "pgrep -f foo bar"),
    ("pipe after", "pgrep -f foo | xargs kill"),
    ("redirect after", "pgrep -f foo 2>/dev/null >/tmp/out"),
    ("wait loop", "until ! pgrep -f '[b]ash ./scripts/e2e-local'; do sleep 1; done"),
    ("killall, options first", "killall -u '<user>' -9 node"),
    ("killall, signal after the name (lifted from any position)", "killall node -9"),
    ("lowercase signal first (pkill matches it case-insensitively)", "pkill -int -U 501 -f foo"),
    ("mentioned in grep", "grep -n -F 'pkill -f cat -U 501 -n' notes.md"),
    ("mentioned in echo", "echo \"pkill -f cat -U 501 -n\""),
    ("mentioned in a commit message", "git commit -m 'guard: pkill -f cat -n is wrong'"),
    ("mentioned in a heredoc body", "mail-send <<'EOF'\npkill -f 'cat' -U $(id -u) -n\nEOF"),
    ("mentioned in a comment", "ls # pkill -f cat -n"),
    ("command -v lookup", "command -v pkill"),
    ("python string", "python3 -c \"import os; os.system('ls')\" # pkill -f x -n"),
    ("xargs pattern from stdin", "echo node | xargs pkill -f"),
    ("rg for the token", "rg -l 'pkill' --glob '*.jsonl' ."),
    ("bash -o pipefail -c, options first", "bash -o pipefail -c 'pkill -n -f node'"),
    ("shell fed a heredoc, options first", "bash <<'EOF'\npkill -n -f node\nEOF"),
    ("cat heredoc body stays a mention", "cat > /tmp/m <<'EOF'\npkill -f cat -n\nEOF"),
    ("trap reset", "trap - EXIT; pgrep -lf node"),
    ("trap with an unrelated script", "trap 'rm -f /tmp/x' EXIT; pgrep -lf node"),
    ("time -p, options first", "time -p pgrep -lf node"),
    ("find without -exec", "find . -name pkill -print"),
    ("while read from a process substitution", "while read p; do echo $p; done < <(pgrep -lf node)"),
    ("comment holding a separator", "ls # stop it; pkill -f cat -n"),
    ("command -v with arguments", "command -v pkill -f x -n"),
    ("a redirect's fd digit", "pgrep -n 2>/dev/null -f foo"),
    ("words after --", "pgrep -f -- foo -n"),
    ("every pkill value option first", "pkill -F /tmp/p -G 20 -P 1 -U 501 -g 1 -t ttys001 -u '<user>' -f cat"),
    ("every pgrep value option first", "pgrep -F /tmp/p -G 20 -P 1 -U 501 -d , -g 1 -t ttys001 -u '<user>' -lf cat"),
    ("every killall value option first", "killall -t ttys001 -c foo -u '<user>' -9 node"),
    ("heredoc to a shell SCRIPT is data", "bash scripts/x.sh <<'EOF'\npkill -f cat -n\nEOF"),
]


def self_test():
    bad = 0
    for name, cmd in FIRE:
        got = scan(cmd)
        ok = bool(got)
        bad += not ok
        print(("PASS" if ok else "FAIL") + "  fires: " + name)
    for name, cmd in CLEAN:
        got = scan(cmd)
        ok = not got
        bad += not ok
        print(("PASS" if ok else "FAIL") + "  clean: " + name + ("" if ok else "  -> " + repr(got[0]["stray"])))
    doc = deny_document(scan(FIRE[0][1])[0])
    ok = json.loads(json.dumps(doc))["hookSpecificOutput"]["permissionDecision"] == "deny"
    bad += not ok
    print(("PASS" if ok else "FAIL") + "  deny document is one valid JSON object")
    del UNPARSED[:]
    ok = not scan("echo $'it\\'s'; pkill -f node -n") and bool(UNPARSED)
    del UNPARSED[:]
    ok = ok and not scan("pgrep -lf node\necho $'it\\'s'") and not UNPARSED
    bad += not ok
    print(("PASS" if ok else "FAIL") + "  a line it cannot parse is recorded (exit 4) only when it names a kill tool")
    print(("ALL PASS" if bad == 0 else str(bad) + " FAILED") + " (" + str(len(FIRE) + len(CLEAN) + 2) + " arms)")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        sys.exit(self_test())
    findings = scan(sys.stdin.read())
    if findings:
        print(json.dumps(deny_document(findings[0], len(findings) - 1)))
        sys.exit(3)
    sys.exit(4 if UNPARSED else 0)
