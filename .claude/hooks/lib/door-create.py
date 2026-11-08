#!/usr/bin/env python3
"""door-create — find a command that CREATES the always-loaded door file.

Called by block-dangerous.sh (arm `door-create`) with the Bash command on stdin.
Exit 0 = nothing found. Exit 3 = found: stdout carries ONE hook deny document.
Exit 4 = nothing found, but a line naming the door could not be parsed (or the text was too
large to parse): the hook lets it through and RECORDS it, so a parse gap is not a silent allow.
Any other exit is a helper failure, and the hook lets the command through and records it.

WHY THIS EXISTS. The door,
/tmp/claude-always-loaded-allow.<session id>, lets a session edit and commit the always-loaded
files for 15 minutes. The write guard and the commit gate honour it on existence and age, and the
write guard refuses a file tool writing it. Since 2026-10-25 the rules say only the owner opens it
(`! touch ...`); before that they told sessions to create it themselves, so a session can still do
it through the shell by habit. The refusal was built on the condition that the owner's own `!`
lines do not pass through the PreToolUse guards, so it cannot lock him out. A probe on
2026-10-29 left no line in the Bash safety hook's fires log, where the same text sent through
the Bash tool on 2026-10-28 left one, so they do not. Its scope: close a door an honest session
walks through by habit or by accident; write down one that takes deliberate effort and stop.

WHAT IT CHECKS. Commands in COMMAND POSITION, found by kill-option-order.py's walker (imported,
so the three arms read shell text the same way): a door path merely MENTIONED inside a grep pattern,
an echo, a commit message, a comment or a heredoc body such as a mail is not a run and is never
flagged, except the $( ) and backtick spans of an UNQUOTED heredoc (`<<EOF`): the shell runs
those, so they are scanned (a plan note written that way ran `! touch` on 2026-10-27). A command creates the door when a write redirect (`>`, `>>`, `>|`, `&>`) targets a door
path, when touch, tee, truncate or mkfifo names one (not as the file after a `-r` option of touch or
truncate, which is only read), when dd writes one with `of=`, or when cp, mv,
ln, install, rsync or ditto has one as its LAST operand (the destination). Removing it (`rm`), and
reading, testing or moving it away, pass: a session removes its own door after the commit.

LIMITS (stated, not hidden). A door path is a word beginning /tmp/ or /private/tmp/ followed by
`claude-always-loaded-allow.`. A path built at run time (a variable holding it, $TMPDIR), a write
from inside python or node, a script file run later, a name piped into xargs, and a copy made
under another name and renamed by a later step are not seen: each takes deliberate effort, and
such a route is written down, not chased (the commit gate's header names that class). It
shares kill-option-order.py's approximate shell parsing and its limits; a change to that walker
changes this arm too, so run all three self-tests AND the full smoke suite after editing any of them: renaming
one private name inside kill-option-order.py kept its own self-test green while this helper crashed
and the arm failed open (found in review, 2026-10-29), and `smoke-test-hooks.sh --for` refuses a
`.claude/hooks/lib/` path (exit 2) for exactly that reason. scan()'s prologue is koo.command_tokens and
the write-redirect test is koo._is_write_redirect, shared with kill-option-order.py and
patch-always-loaded.py (extracted 2026-10-30, in review, when patch-always-loaded.py became the
third importer); commands() is still a copy of the splitter in those two files, since each returns a
different shape, so a fix to how it reads a separator or redirect belongs in all three.
"""
import importlib.util
import json
import os
import re
import shlex
import sys

_spec = importlib.util.spec_from_file_location(
    "kill_option_order", os.path.join(os.path.dirname(os.path.abspath(__file__)), "kill-option-order.py"))
koo = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(koo)

DOOR_RE = re.compile(r"^(?:/private)?/tmp/claude-always-loaded-allow\.")
DOOR_WORD_RE = re.compile(r"claude-always-loaded-allow\.")
CREATORS_ANY = {"touch", "tee", "truncate", "mkfifo"}
CREATORS_DEST = {"cp", "mv", "ln", "install", "rsync", "ditto"}
UNPARSED = []


def is_door(word):
    return bool(DOOR_RE.match(word))


def commands(tokens):
    """Split a token list at separators into (argv, write-redirect targets).
    A copy of kill-option-order.py simple_commands(), which drops the targets this keeps; patch-always-loaded.py
    commands() is the third copy. A fix to how a separator or redirect is read belongs in all three."""
    out, argv, targets, pending = [], [], [], None
    for t in tokens:
        if pending:
            kind, pending = pending, None
            if t not in ("<(", ">("):  # a process substitution RUNS: let it start a command
                if kind == "w":
                    targets.append(t)
                continue
        if koo._is_redirect(t) or koo._is_write_redirect(t):
            if argv and argv[-1].isdigit():  # `2>` arrives as '2', '>'
                argv.pop()
            pending = "w" if ">" in t else "r"
            continue
        if koo._is_punct(t):
            if argv or targets:
                out.append((argv, targets))
            argv, targets = [], []
            continue
        argv.append(t)
    if argv or targets:
        out.append((argv, targets))
    return out


def creator(argv):
    """argv after koo.unwrap. The verb that creates a door, or None."""
    if not argv:
        return None
    tool = os.path.basename(argv[0])
    args = argv[1:]
    if tool in CREATORS_ANY:
        # `touch -r <file>` and `truncate -r <file>` only READ that file as a reference. Options end at
        # `--` or the first operand (BSD getopt), so `touch -- -r <door>` and `touch -r -r <door>` create it.
        ref, i = set(), 0
        while tool in ("touch", "truncate") and i < len(args) and args[i].startswith("-") and args[i] != "--":
            if args[i] == "-r":
                ref.add(i + 1)
                i += 1
            i += 1
        if any(is_door(a) for i, a in enumerate(args) if i not in ref):
            return tool
    if tool == "dd" and any(a.startswith("of=") and is_door(a[3:]) for a in args):
        return "dd"
    if tool in CREATORS_DEST:
        operands = [a for a in args if not a.startswith("-")]
        if operands and is_door(operands[-1]):
            return tool
    return None


def scan(cmd, depth=0):
    if depth > 6:
        return []
    tokens, inner = koo.command_tokens(cmd, DOOR_WORD_RE, lambda text: UNPARSED.append(text[:80]), UNPARSED.append)
    findings = []
    for argv, targets in commands(tokens):
        how = "a write redirect" if any(is_door(t) for t in targets) else None
        run, nested = koo.unwrap(argv)
        for script in nested:
            findings += scan(script, depth + 1)
        how = how or creator(run)
        if how:
            findings.append({"how": how, "argv": argv, "targets": targets})
    for body in inner:
        findings += scan(body, depth + 1)
    return findings


def deny_document(f):
    words = f["argv"] + [">" + t for t in f["targets"]]
    shown = " ".join(shlex.quote(a) for a in words)
    if len(shown) > 200:
        shown = shown[:200] + " ..."
    reason = (
        "BLOCKED by block-dangerous.sh (door-create): `" + shown + "` creates the always-loaded door ("
        + f["how"] + "). A session never opens that door itself: only the owner does, with the `! touch` "
        "line the always-loaded write guard prints when it refuses you, and his `!` lines do not pass "
        "through this hook (measured 2026-10-29). Ask him to run it, then carry on. Removing your own "
        "door after the commit (`rm -f` it), and reading or testing it, are allowed."
    )
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                   "permissionDecision": "deny",
                                   "permissionDecisionReason": reason}}


def verdict(text):
    """(exit code, deny document or None): 3 found, 4 a door-naming line not parsed, 0 nothing."""
    del UNPARSED[:]
    findings = scan(text)
    if findings:
        return 3, deny_document(findings[0])
    return (4 if UNPARSED else 0), None


# --- self-test: every arm calls scan(), the function the hook runs -------------------------
D = "/tmp/claude-always-loaded-allow."
FIRE = [
    ("the old habit form", "touch " + D + "$CLAUDE_CODE_SESSION_ID"),
    ("quoted, braced variable", "touch \"" + D + "${CLAUDE_CODE_SESSION_ID}\""),
    ("a literal session id", "touch " + D + "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx"),
    ("the /private spelling", "touch /private" + D + "abc"),
    ("touch -t (a back-dated door)", "touch -t 202601010000 " + D + "abc"),
    ("a bare redirect", ": > " + D + "abc"),
    ("an append redirect", "echo ok; date >> " + D + "abc"),
    ("a clobber redirect", "true >| " + D + "abc"),
    ("an &> redirect", "true &> " + D + "abc"),
    ("a redirect with no space", "echo x >" + D + "abc"),
    ("cp onto the door", "cp /dev/null " + D + "abc"),
    ("mv onto the door", "mv /tmp/x " + D + "abc"),
    ("ln -s onto the door", "ln -s /tmp/x " + D + "abc"),
    ("install onto the door", "install -m 600 /dev/null " + D + "abc"),
    ("tee", "echo | tee " + D + "abc"),
    ("tee -a, output discarded", "echo | tee -a " + D + "abc >/dev/null"),
    ("truncate", "truncate -s 0 " + D + "abc"),
    ("dd of=", "dd if=/dev/null of=" + D + "abc"),
    ("after &&", "cd /tmp && touch " + D + "abc"),
    ("on a later line", "echo a\ntouch " + D + "abc\necho b"),
    ("inside bash -c", "bash -c 'touch " + D + "abc'"),
    ("inside $( )", "x=$(touch " + D + "abc)"),
    ("inside backticks", "x=`touch " + D + "abc`"),
    ("behind env", "env A=1 touch " + D + "abc"),
    ("behind sudo", "sudo touch " + D + "abc"),
    ("behind an assignment", "A=1 touch " + D + "abc"),
    ("inside eval", "eval touch " + D + "abc"),
    ("find -exec touch", "find /tmp -maxdepth 0 -exec touch " + D + "abc \\;"),
    ("a heredoc fed to a shell", "bash <<'EOF'\ntouch " + D + "abc\nEOF"),
    ("a heredoc written INTO the door", "cat > " + D + "abc <<'EOF'\nx\nEOF"),
    ("a backtick span in an UNQUOTED heredoc body (2026-10-27)", "cat >> /tmp/p.md <<EOF\nask him: `! touch " + D + "abc`\nEOF"),
    ("a $( ) span in an UNQUOTED heredoc body", "mail-send <<EOF\nx $(touch " + D + "abc) y\nEOF"),
    ("mkfifo", "mkfifo " + D + "abc"),
    ("rsync, a trailing option", "rsync -a /tmp/x " + D + "abc --inplace"),
    ("ditto", "ditto /tmp/x " + D + "abc"),
    ("inside a process substitution a redirect reads", "cat < <(touch " + D + "abc)"),
    ("cp with stderr discarded (the fd digit is not an operand)", "cp /dev/null " + D + "abc 2>/dev/null"),
    ("touch -r <other> onto the door (the door is the file touched)", "touch -r /tmp/ref " + D + "abc"),
    ("touch -- -r <door>: after -- the -r is an operand", "touch -- -r " + D + "abc"),
    ("touch -r -r <door>: the reference is the file -r", "touch -r -r " + D + "abc"),
    ("touch <file> -r <door>: options end at the first operand", "touch /tmp/x -r " + D + "abc"),
    ("an apostrophe before a backtick span in an UNQUOTED heredoc body", "cat >> /tmp/p.md <<EOF\nit's due: `touch " + D + "abc`\nEOF"),
    ("a # before a $( ) span in an UNQUOTED heredoc body", "cat >> /tmp/p.md <<EOF\nnote # $(touch " + D + "abc)\nEOF"),
]
CLEAN = [
    ("rm after the commit (the prescribed cleanup)", "rm -f " + D + "$CLAUDE_CODE_SESSION_ID"),
    ("ls", "ls -la " + D + "abc"),
    ("stat", "stat -f %m " + D + "abc"),
    ("a [ -f ] test", "[ -f " + D + "abc ] && echo open"),
    ("test -e", "test -e " + D + "abc"),
    ("cat reads it", "cat " + D + "abc"),
    ("a read redirect", "wc -c < " + D + "abc"),
    ("stderr folded while reading it", "stat " + D + "abc 2>&1"),
    ("its listing redirected elsewhere", "ls " + D + "abc > /tmp/out"),
    ("mv it away", "mv " + D + "abc /tmp/old"),
    ("cp it out", "cp " + D + "abc /tmp/copy"),
    ("mentioned in grep", "grep -n -F 'touch " + D + "' .claude/hooks/x.sh"),
    ("mentioned in echo", "echo \"ask the owner: ! touch " + D + "abc\""),
    ("mentioned in a commit message", "git commit -m 'never touch " + D + "x yourself'"),
    ("mentioned in a mail heredoc body", "mail-send <<'EOF'\n! touch " + D + "abc\nEOF"),
    ("a backtick span in a QUOTED heredoc body is data", "cat >> /tmp/p.md <<'EOF'\nask him: `! touch " + D + "abc`\nEOF"),
    ("an ESCAPED backtick in an unquoted heredoc is data", "cat >> /tmp/p.md <<EOF\nask him: \\`! touch " + D + "abc\\`\nEOF"),
    ("mentioned in a comment", "ls # touch " + D + "abc"),
    ("a mail heredoc whose delimiter has - and . is data", "mail-send <<'END-1.x'\n! touch " + D + "abc\nEND-1.x"),
    ("an UNQUOTED mention after echo (command position, not quoting)", "echo then run touch " + D + "abc"),
    ("touch -r reads the door as a reference", "touch -r " + D + "abc /tmp/other"),
    ("truncate -r reads the door as a reference", "truncate -r " + D + "abc /tmp/other"),
    ("mentioned in a python string", "python3 -c \"print('touch " + D + "x')\""),
    ("another /tmp file", "touch /tmp/claude-other-marker"),
    ("a near-miss name with no dot", "touch /tmp/claude-always-loaded-allowance"),
    ("a door name outside /tmp", "touch ./claude-always-loaded-allow.abc"),
    ("a heredoc to a shell SCRIPT is data", "bash scripts/x.sh <<'EOF'\ntouch " + D + "abc\nEOF"),
    ("a while loop reading a process substitution", "while read l; do echo $l; done < <(ls " + D + "abc)"),
]


def self_test():
    bad = 0
    for name, cmd in FIRE:
        ok = bool(scan(cmd))
        bad += not ok
        print(("PASS" if ok else "FAIL") + "  fires: " + name)
    for name, cmd in CLEAN:
        got = scan(cmd)
        ok = not got
        bad += not ok
        print(("PASS" if ok else "FAIL") + "  clean: " + name + ("" if ok else "  -> " + got[0]["how"]))
    got = scan(FIRE[0][1])
    doc = deny_document(got[0]) if got else {"hookSpecificOutput": {}}
    ok = json.loads(json.dumps(doc))["hookSpecificOutput"].get("permissionDecision") == "deny"
    bad += not ok
    print(("PASS" if ok else "FAIL") + "  deny document is one valid JSON object")
    ok = verdict("echo $'it\\'s'; touch " + D + "abc")[0] == 4
    ok = ok and verdict("ls " + D + "abc\necho $'it\\'s'")[0] == 0
    ok = ok and verdict(FIRE[0][1])[0] == 3
    ok = ok and verdict("echo " + "a" * koo.MAX_TEXT + "; touch " + D + "abc")[0] == 4  # too large to parse
    bad += not ok
    print(("PASS" if ok else "FAIL") + "  a line it cannot parse is recorded (exit 4) only when it names the door")
    print(("ALL PASS" if bad == 0 else str(bad) + " FAILED") + " (" + str(len(FIRE) + len(CLEAN) + 2) + " arms)")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        sys.exit(self_test())
    rc, doc = verdict(sys.stdin.read())
    if doc:
        print(json.dumps(doc))
    sys.exit(rc)
