#!/usr/bin/env python3
"""patch-always-loaded — refuse a `git apply` / `patch` that writes an always-loaded file with the door closed.

Called by block-dangerous.sh (arm `patch-always-loaded`) with the WHOLE hook payload on stdin (it needs
session_id, agent_id and cwd as well as the command).
Exit 0 = nothing to refuse. Exit 3 = refused: stdout carries ONE hook deny document.
Exit 4 = nothing refused, but a `git apply` / `patch` run's targets could not be read (an unreadable or
missing patch file, a patch arriving on stdin from a command whose output cannot be known, a path built at
run time, a line that would not parse): the hook lets it through and RECORDS it, stdout carries a one-line
detail. Exit 5 = the always-loaded write guard gave no verdict: the hook lets it through and records it.
Any other exit is a helper failure, and the hook lets the command through and records it.

WHY THIS EXISTS (built as recommended after the second occurrence below). block-subagent-always-loaded-write.sh
refuses an Edit, Write or MultiEdit of an always-loaded file
(CLAUDE.md, AGENTS.md, .claude/rules/*.md, .claude/orchestrator/*.md) unless this session's door is open, and it
is wired on the file tools only (a Bash arm for it was decided against). Twice a
session changed an always-loaded file with `git apply <patchfile>` and nothing warned: once on 2026-10-28
(.claude/orchestrator/conventions.md) and once on 2026-10-30 (two .claude/orchestrator/*.md files, its
door expired). The commit-time gate (scripts/always-loaded-commit-gate.sh) refuses the commit, but the bytes on
disk are what every session reads at once. A command-string check cannot see this shape, because `git apply`
names the patch file, not the files it changes; this helper READS the patch.

ONE DEFINITION. The protected set, the containment walk, the door, its 15-minute window, the future-mtime clamp
and the refusal of the door to a sub-agent all belong to the guard. This helper never copies them: it puts every
file a patch names to the guard as ONE synthetic MultiEdit in this call's own session_id (and agent_id, when the
call carries one), with the guard's ledgers pointed at a throwaway directory (a patch is not an edit, and its
fires would read as MultiEdit denials). Each target goes to the guard in every spelling the filesystem would
resolve it to (spellings(): realpath, and the casefold of a non-ASCII path), so a symlinked directory or a U+017F
`ſ` reaches the guard as the protected path it is. A deny is relayed with the guard's own reason (a protected file
and no live door, the door file itself, or a sub-agent), so the `! touch` line it names is that session's own door.

WHAT IT CHECKS. Runs in COMMAND POSITION only, found by kill-option-order.py's walker (imported, as door-create.py
imports it: scan()'s prologue is koo.command_tokens and the write-redirect test koo._is_write_redirect, one copy for
the three arms, extracted 2026-10-30 in review; commands() is still a copy of the splitter in the other two
files, since each returns a different shape, so a fix to how it reads a separator or redirect belongs in all
three): `git [global options] apply ...` and `patch` / `gpatch`, in any letter case (macOS finds `Git` and
`Patch` on a case-insensitive PATH), with the shell's quotes and backslashes already removed by the tokenizer
(`git ap\\ply`, `git "ap"ply`), and a plain `$'apply'` read as `'apply'`.
A mention (a grep pattern, an echo, a commit message, a comment, a heredoc mail body) is not a run and passes.
The patch text comes from: each file operand (`git apply a.patch b.patch`, `patch -i f`, `patch --input=f`,
`patch [origfile] patchfile`); a `< file` redirect; a heredoc or here-string on the run (`git apply <<EOF`); a
pipe from `cat <files>` (the files are read) or from any other command (the whole command text is read for
patch headers, with printf's `\\n` expanded; nothing found there is a recorded gap, exit 4). Targets are every
path in a `diff --git` line, a `---` / `+++` file header outside a hunk (hunks are counted, so a removed line
that starts with `--` is not read as a header), and `rename from` / `rename to` / `copy to`; /dev/null is
dropped. Paths are stripped as the tool strips them (git apply: -p, default 1, and p-1 for rename/copy lines,
plus --directory; patch: -p, and with no -p the basename, which is what Apple patch 2.0 does), resolved against
the directory the run happens in (each `cd` / `pushd` before it in the same command, `git -C`, `patch -d`) and,
for git apply, against that directory's work-tree top (measured 2026-10-30 on git 2.50.1: run in a subdirectory,
git apply resolves a patch's paths from the top and skips those outside the subdirectory; resolving from the top
over-blocks that skip, the safe direction). `patch -o out` and `patch origfile` write only that one file.
git apply's --exclude / --include are honoured in order, first match decides, `*` crossing `/` (measured on the
same git), and a target is skipped only when it is excluded whether or not --directory is prefixed.

WHAT PASSES. Read-only runs: `git apply --check / --stat / --numstat / --summary` without --apply, and
`patch --dry-run / -C / --check`. Every other run is a write, `git apply --cached` included: it writes only the
index, which no session reads, but committing it needs the door anyway (the commit gate), so refusing it costs a
legitimate flow nothing, and an index-only change is the first half of the hand-built commit-tree route the commit
gate never sees (a session used commit-tree that way on 2026-10-30).

LIMITS (stated, not hidden). A patch file written earlier in the SAME command by a producer this hook cannot run
(`git diff > p && git apply p`) does not exist yet, so it is a recorded gap (exit 4); one written by a heredoc in
the command (`cat > p <<EOF`) is read from the command text. An ANSI-C word carrying an escape (`git $'\\x61pply'`)
is not decoded, so its verb is never seen and the run passes unrecorded (named residual, 2026-10-30 review). A
variable assigned anywhere but a leading NAME=literal word of this command, `git am` (which applies a mailbox the same way; it was left out of this arm's scope), a
patch applied from inside python or node, and every non-patch shell write (sed -i, a redirect, cp) are not seen;
the commit gate is the backstop for all of them. It shares kill-option-order.py's approximate shell parsing; a
change to that walker changes this arm too, so run all three self-tests AND the full smoke suite after editing it.
"""
import fnmatch
import glob
import importlib.util
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("kill_option_order", os.path.join(HERE, "kill-option-order.py"))
koo = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(koo)

GUARD = os.path.join(os.path.dirname(HERE), "block-subagent-always-loaded-write.sh")
# ⚠️ ONE VERB LIST, SPELLED TWICE: block-dangerous.sh's pre-filter (`*git*apply*` and `_bd_pal_re`) decides
# whether this helper runs at all, and this regex decides which unparseable lines are recorded. A verb this
# helper learns (git am, say) must be added there too, or the helper never sees it.
VERB_WORD_RE = re.compile(r"(?:\bgit\b[^\n;&|]*\bapply\b|(?<![\w.-])g?patch(?![\w.-]))", re.I)
ANSI_C_PLAIN_RE = re.compile(r"\$'([^'\\]*)'")  # $'apply' with no escape inside is the word 'apply'
# The wrappers koo.unwrap strips that are PROGRAMS on PATH, so `ENV git apply` / `Bash -c` run them on macOS;
# builtins and keywords (exec, command, eval, if) are matched by bash case-sensitively and stay exact.
EXT_WRAPPERS = {"sudo", "env", "nice", "nohup", "time", "caffeinate", "xargs", "find", "perl"} | set(koo.SHELLS)


def _unwrap(argv):
    return koo.unwrap([a.lower() if os.path.basename(a).lower() in EXT_WRAPPERS else a for a in argv])
GIT_GLOBAL_ARG = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env"}
GIT_APPLY_ARG = {"-p", "-C", "--directory", "--exclude", "--include", "--whitespace", "--build-fake-ancestor"}
GIT_APPLY_READONLY = {"--check", "--stat", "--numstat", "--summary"}
# Every argument-taking option of Apple patch 2.0-12u11 (`man patch`, audited 2026-10-30: -B -D -d -F -g -i -o -p
# -r -V -x -Y -z and their long forms), plus GNU patch's (gpatch) required-argument long options. A short option
# is read the way getopt reads it, inside a cluster too (`-sg 0`, `-Np1`): an unknown arg-taking option would make
# its argument read as the origfile operand.
PATCH_SHORT_ARG = set("BDdFgioprVxYz")
PATCH_ARG = {"-" + ch for ch in PATCH_SHORT_ARG}
PATCH_LONG_ARG = {"--prefix", "--ifdef", "--directory", "--fuzz", "--get", "--input", "--output", "--strip",
                  "--reject-file", "--version-control", "--debug", "--basename-prefix", "--suffix",
                  "--quoting-style", "--reject-format", "--read-only"}
PATCH_CHECK = {"-C", "--check", "--dry-run"}
MAX_TARGETS = 500
HUNK_RE = re.compile(r"^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@")
GAPS = []
VARS = {}  # NAME=literal assignments made earlier in this command: `S=/x; git apply $S/p` reads /x/p


# ---- reading a patch ----------------------------------------------------------------------------------
def _unquote(p):
    p = p.strip()
    if len(p) >= 2 and p[0] == '"' and p[-1] == '"':
        try:
            return p[1:-1].encode("latin-1", "backslashreplace").decode("unicode_escape").encode("latin-1").decode("utf-8", "replace")
        except Exception:
            return p[1:-1]
    return p


def patch_paths(text):
    """[(path, kind)] from a patch text; kind 'hdr' (diff --git / --- / +++) or 'ren' (rename/copy lines)."""
    out, old_left, new_left = [], 0, 0
    for line in text.split("\n"):
        line = line.rstrip("\r")
        if old_left > 0 or new_left > 0:
            c = line[:1]
            if c == " " or line == "":
                old_left -= 1
                new_left -= 1
            elif c == "-":
                old_left -= 1
            elif c == "+":
                new_left -= 1
            elif c == "\\":
                pass
            else:
                old_left = new_left = 0  # malformed: fall back to header reading
            if old_left > 0 or new_left > 0:
                continue
            if c in " -+\\" or line == "":
                continue
        m = HUNK_RE.match(line)
        if m:
            old_left = int(m.group(1)) if m.group(1) is not None else 1
            new_left = int(m.group(2)) if m.group(2) is not None else 1
            continue
        if line.startswith("diff --git "):
            rest = line[len("diff --git "):]
            if rest.startswith('"'):
                parts = re.findall(r'"(?:[^"\\]|\\.)*"|\S+', rest)
            else:
                parts = rest.split(" ")
                if len(parts) != 2:  # a name with spaces: the ---/+++ lines carry it
                    parts = []
            out += [(_unquote(p), "hdr") for p in parts]
        elif line.startswith("--- ") or line.startswith("+++ "):
            name = line[4:].split("\t")[0]
            out.append((_unquote(name), "hdr"))
        elif line.startswith("rename from ") or line.startswith("rename to ") or line.startswith("copy to "):
            out.append((_unquote(line.split(" ", 2)[2]), "ren"))
    return [(p, k) for p, k in out if p and p != "/dev/null"]


def _strip(path, n):
    """-p n as git apply and patch do it: remove n leading components, each ending at a run of slashes, so an
    absolute `/.claude/rules/x.md` under -p1 is `.claude/rules/x.md` (the root is the first component)."""
    for _ in range(n):
        i = path.find("/")
        if i < 0:
            return None
        path = path[i:].lstrip("/")
    return path or None


def _excluded(path, rules):
    for kind, pat in rules:
        if fnmatch.fnmatchcase(path, pat):
            return kind == "exclude"
    return any(k == "include" for k, _ in rules)


# ---- reading the command ----------------------------------------------------------------------------------
def commands(tokens):
    """Split tokens at separators: [{argv, reads, inline, piped}] (reads = `<` targets; inline = a heredoc or
    here-string on the command; piped = it reads the previous command's output). A copy of kill-option-order.py
    simple_commands() and door-create.py commands(), whose shapes differ: a fix to how a separator or redirect is
    read belongs in all three."""
    out, cur, pending, piped, depth = [], None, None, False, 0

    def new():  # depth = how many ( subshells the command sits in, so a cd inside one ends at its )
        return {"argv": [], "reads": [], "inline": False, "piped": False, "depth": depth}
    cur = new()
    for t in tokens:
        if pending:
            kind, pending = pending, None
            if t in ("<(", ">("):
                pass
            else:
                if kind == "r":
                    cur["reads"].append(t)
                continue
        if koo._is_redirect(t) or koo._is_write_redirect(t):
            if cur["argv"] and cur["argv"][-1].isdigit():
                cur["argv"].pop()
            if t.startswith("<<"):
                cur["inline"] = True
                pending = "h"
            elif "<" in t and ">" not in t:
                pending = "r"
            else:
                pending = "w"
            continue
        if koo._is_punct(t):
            if cur["argv"] or cur["reads"] or cur["inline"]:
                out.append(cur)
            depth = max(depth + t.count("(") - t.count(")"), 0)
            cur = new()
            cur["piped"] = t in ("|", "|&")
            continue
        cur["argv"].append(t)
    if cur["argv"] or cur["reads"] or cur["inline"]:
        out.append(cur)
    return out


def _subst(p):
    return re.sub(r"\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))", lambda m: VARS.get(m.group(1) or m.group(2), m.group(0)), p)


def _resolve(base, p):
    p = os.path.expanduser(_subst(p))
    if "$" in p or "`" in p or "__SUBST__" in p:  # a variable no literal set, or a $( ) the prepass blanked
        return None
    return p if os.path.isabs(p) else os.path.normpath(os.path.join(base, p))


def _files(base, f):
    """The paths an operand names: a glob is expanded as the shell would (no match keeps the word)."""
    p = _resolve(base, f)
    return (sorted(glob.glob(p)) or [p]) if p and any(ch in p for ch in "*?[") else [p]


def _read(path, what):
    try:
        with open(path, "rb") as f:
            return f.read(8 * 1024 * 1024).decode("utf-8", "replace")
    except Exception as e:
        GAPS.append(what + " unreadable (" + type(e).__name__ + "): " + path[:160])
        return None


def _toplevel(d):
    try:
        r = subprocess.run(["git", "-C", d, "rev-parse", "--show-toplevel"], capture_output=True, text=True, timeout=5)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    except Exception:
        pass
    return None


def _stdin_text(c, prev, raw, cwd, what):
    """The patch text a run reads on stdin, or None (a gap is recorded)."""
    texts = []
    for r in c["reads"]:
        p = _resolve(cwd, r)
        if p is None:
            GAPS.append(what + " reads a patch through a variable: " + r[:120])
            continue
        t = _read(p, what + " patch")
        if t is not None:
            texts.append(t)
    if c["reads"]:
        return "\n".join(texts) if texts else None
    if c["inline"]:
        return raw + "\n" + raw.replace("\\n", "\n")
    if c["piped"] and prev is not None:
        run, _ = _unwrap(prev["argv"])
        tool = os.path.basename(run[0]).lower() if run else ""
        if tool == "cat":
            files = [a for a in run[1:] if not a.startswith("-")]
            for f in files:
                p = _resolve(cwd, f)
                if p is None:
                    GAPS.append(what + " reads a patch through a variable: " + f[:120])
                    continue
                t = _read(p, what + " patch")
                if t is not None:
                    texts.append(t)
            if files:
                return "\n".join(texts) if texts else None
        text = raw + "\n" + raw.replace("\\n", "\n")
        if patch_paths(text):
            return text
        GAPS.append(what + " reads a patch on stdin from `" + " ".join(run[:4])[:120] + "`, whose output cannot be known")
        return None
    GAPS.append(what + " reads a patch on stdin from nowhere this hook can see")
    return None


def git_apply(argv, c, prev, raw, cwd):
    """argv = the words after `apply`. Returns [absolute target]."""
    strip, directory, rules, files, readonly, apply_flag, i = 1, "", [], [], False, False, 0
    while i < len(argv):
        a = argv[i]
        if a == "--":
            files += argv[i + 1:]
            break
        if a in GIT_APPLY_ARG and i + 1 < len(argv):
            v = argv[i + 1]
            i += 2
        elif a.startswith("--") and "=" in a:
            a, v = a.split("=", 1)
            i += 1
        elif a.startswith("-p") and len(a) > 2:
            a, v = "-p", a[2:]
            i += 1
        elif a.startswith("-C") and len(a) > 2:
            i += 1
            continue
        else:
            if a in GIT_APPLY_READONLY:
                readonly = True
            elif a == "--apply":
                apply_flag = True
            elif a == "-" or not a.startswith("-"):
                files.append(a)
            i += 1
            continue
        if a == "-p":
            strip = int(v) if v.isdigit() else strip
        elif a == "--directory":
            directory = v.strip("/")
        elif a in ("--exclude", "--include"):
            rules.append((a[2:], v))
    if readonly and not apply_flag:
        return []
    texts = []
    for f in [f for f in files if f != "-"]:
        for p in _files(cwd, f):
            if p is None:
                GAPS.append("git apply names a patch through a variable: " + f[:120])
                continue
            t = _read(p, "git apply patch")
            if t is None and not os.path.exists(p) and patch_paths(raw):  # written earlier in this command
                t = raw + "\n" + raw.replace("\\n", "\n")
            if t is not None:
                texts.append(t)
    if not files or "-" in files:
        t = _stdin_text(c, prev, raw, cwd, "git apply")
        if t is not None:
            texts.append(t)
    base = _toplevel(cwd) or cwd
    out = []
    for text in texts:
        for path, kind in patch_paths(text):
            s = _strip(path, max(strip - 1, 0) if kind == "ren" else strip)
            if not s:
                continue
            full = directory + "/" + s if directory else s
            if _excluded(s, rules) and _excluded(full, rules):
                continue
            out.append(os.path.normpath(os.path.join(base, full)))
    return out


def patch_run(argv, c, prev, raw, cwd):
    """argv = the words after `patch`. Returns [absolute target]."""
    strip, d, infile, outfile, operands, i = None, None, None, None, [], 0
    while i < len(argv):
        a = argv[i]
        if a == "--":
            operands += argv[i + 1:]
            break
        if a in PATCH_CHECK:
            return []
        if a.startswith("--") and "=" in a and a.split("=", 1)[0] in PATCH_LONG_ARG:
            a, v = a.split("=", 1)
            i += 1
        elif a in PATCH_LONG_ARG and i + 1 < len(argv):
            v = argv[i + 1]
            i += 2
        elif a.startswith("-") and not a.startswith("--") and len(a) > 1:
            # a short cluster, read as getopt reads it: flags until the first arg-taking letter, whose value is
            # the rest of the word or else the next word (-Np1, -sg 0, -g0, -p 1)
            k = next((k for k in range(1, len(a)) if a[k] in PATCH_SHORT_ARG or a[k] == "C"), None)
            if k is None:
                i += 1
                continue
            if a[k] == "C":
                return []
            if k + 1 < len(a):
                a, v = "-" + a[k], a[k + 1:]
                i += 1
            elif i + 1 < len(argv):
                a, v = "-" + a[k], argv[i + 1]
                i += 2
            else:
                i += 1
                continue
        else:
            if not a.startswith("-") or a == "-":
                operands.append(a)
            i += 1
            continue
        if a in ("-p", "--strip"):
            strip = int(v) if v.isdigit() else strip
        elif a in ("-d", "--directory"):
            d = v
        elif a in ("-i", "--input"):
            infile = v
        elif a in ("-o", "--output"):
            outfile = v
    base = _resolve(cwd, d) if d else cwd
    if base is None:
        GAPS.append("patch -d names a directory through a variable")
        return []
    if outfile and outfile != "-":
        p = _resolve(base, outfile)
        return [p] if p else []
    if operands:
        p = _resolve(base, operands[0])  # [origfile [patchfile]]: the origfile is the only file written
        return [p] if p else []
    if infile is not None:
        p = _resolve(cwd, infile)
        text = _read(p, "patch -i") if p else None
        if p is None:
            GAPS.append("patch -i names a patch through a variable: " + infile[:120])
    else:
        text = _stdin_text(c, prev, raw, cwd, "patch")
    if text is None:
        return []
    out = []
    for path, _kind in patch_paths(text):
        cands = [_strip(path, strip)] if strip is not None else [os.path.basename(path), path]
        out += [os.path.normpath(os.path.join(base, s)) for s in cands if s]
    return out


def scan(cmd, cwd, depth=0):
    """[(verb, [absolute target], words)] for every git apply / patch run in command position."""
    if depth > 6:
        return []
    raw = cmd
    tokens, inner = koo.command_tokens(
        cmd, VERB_WORD_RE, lambda text: GAPS.append("command too large to parse"),
        lambda line: GAPS.append("a line naming git apply / patch did not parse: " + line[:80]),
        pre=lambda c: ANSI_C_PLAIN_RE.sub(lambda m: "'" + m.group(1) + "'", c))
    found, prev, lost, depth, saved = [], None, None, 0, {}
    for c in commands(tokens):
        for k in range(depth + 1, c["depth"] + 1):
            saved[k] = (cwd, lost)
        if c["depth"] < depth and c["depth"] + 1 in saved:
            cwd, lost = saved[c["depth"] + 1]
        depth = c["depth"]
        for a in c["argv"]:
            m = re.match(r"([A-Za-z_]\w*)=(.*)\Z", a, re.S)
            if not m:
                break
            v = _subst(m.group(2))
            VARS[m.group(1)] = v  # an unresolvable value keeps its $ / __SUBST__, so _resolve still refuses it
        run, nested = _unwrap(c["argv"])
        for script in nested:
            found += scan(script, cwd, depth + 1)
        if run:
            tool = os.path.basename(run[0])
            low = tool.lower()  # `Git` / `PATCH` run the real tool on macOS; cd stays exact (a builtin is not)
            if tool in ("cd", "pushd") and len(run) > 1 and not run[1].startswith("-"):
                nd = _resolve(cwd, run[1])
                if nd and (os.path.isabs(os.path.expanduser(run[1])) or not lost):
                    cwd, lost = nd, None
                else:
                    lost = lost or run[1]
            elif low == "git":
                j, gcwd, glost = 1, cwd, lost
                while j < len(run) and run[j].startswith("-"):
                    a = run[j]
                    if a in GIT_GLOBAL_ARG and j + 1 < len(run):
                        if a == "-C":
                            glost = glost if _resolve(gcwd, run[j + 1]) else run[j + 1]
                            gcwd = _resolve(gcwd, run[j + 1]) or gcwd
                        elif a == "--work-tree":
                            gcwd = _resolve(gcwd, run[j + 1]) or gcwd
                        j += 2
                    else:
                        if a.startswith("--work-tree="):
                            gcwd = _resolve(gcwd, a.split("=", 1)[1]) or gcwd
                        j += 1
                if j < len(run) and run[j].lower() == "apply" and glost:
                    GAPS.append("git apply runs in a directory named through a variable: " + glost[:120])
                elif j < len(run) and run[j].lower() == "apply":
                    found.append(("git apply", git_apply(run[j + 1:], c, prev, raw, gcwd), run))
            elif low in ("patch", "gpatch") and lost:
                GAPS.append("patch runs in a directory named through a variable: " + lost[:120])
            elif low in ("patch", "gpatch"):
                found.append(("patch", patch_run(run[1:], c, prev, raw, cwd), run))
        prev = c
    for body in inner:
        found += scan(body, cwd, depth + 1)
    return found


# ---- asking the guard -------------------------------------------------------------------------------------
def spellings(t):
    """Every spelling of target t the guard is asked about: t itself, its realpath (a symlinked directory such as
    lnk -> .claude/rules, which the guard's lexical suffix match cannot see through), and for a non-ASCII spelling
    its Unicode casefold (APFS folds U+017F to s, so `.claude/ruleſ/x.md` IS .claude/rules/x.md, while the guard's
    grep -i folds ASCII only). The guard grades every path in the MultiEdit, so any form it protects refuses the
    run; a path that only folds or resolves onto a protected file is refused too, which is the intent. An ASCII
    path in a directory with no symlink yields t alone, so an ordinary run asks exactly what it asked before."""
    out = [t]
    try:
        r = os.path.realpath(t)
    except Exception:
        r = t
    for x in (r, t):
        for y in (x, unicodedata.normalize("NFC", x.casefold()) if not x.isascii() else x):
            if y not in out:
                out.append(y)
    return out


def ask_guard(targets, payload):
    """(verdict, reason, stderr): verdict 'deny' | 'allow' | 'error'."""
    first = targets[0]
    paths = []
    for t in targets:
        paths += [s for s in spellings(t) if s not in paths]
    probe = {"tool_name": "MultiEdit", "session_id": payload.get("session_id") or "",
             "tool_input": {"file_path": first, "edits": [{"file_path": t} for t in paths]}}
    if "agent_id" in payload:  # the guard refuses a sub-agent the door on the key's presence; carry it
        probe["agent_id"] = payload.get("agent_id")
    logs = tempfile.mkdtemp(prefix="patch-al-")
    try:
        env = dict(os.environ)
        env["HOOK_FIRES_LOG_DIR"] = logs
        r = subprocess.run(["/bin/bash", GUARD], input=json.dumps(probe), capture_output=True, text=True,
                           timeout=20, env=env)
    except Exception as e:
        return "error", type(e).__name__, ""
    finally:
        subprocess.run(["rm", "-rf", logs])
    out = r.stdout.strip()
    if r.returncode == 0 and not out:
        return "allow", "", ""
    try:
        doc = json.loads(out)
        hso = doc.get("hookSpecificOutput") or {}
        if hso.get("permissionDecision") == "deny":
            return "deny", hso.get("permissionDecisionReason") or "", r.stderr.strip()
    except Exception:
        pass
    return "error", "rc=" + str(r.returncode), r.stderr.strip()[:200]


def _clean(s, n):
    s = re.sub(r"[\x00-\x1f]", " ", s)
    return s if len(s) <= n else s[:n] + " ..."


def deny_document(verb, words, guard_reason, guard_err):
    shown = _clean(" ".join(shlex.quote(a) for a in words), 200)
    reason = (
        "BLOCKED by block-dangerous.sh (patch-always-loaded): `" + shown + "` (" + verb + ") writes a "
        "file the always-loaded write guard refuses. A shell write such as git apply passes the "
        "Edit/Write guard unseen, so this arm reads the patch and asks that guard about every file it names. "
        "The guard answered: " + _clean(guard_reason, 2400)
        + ((" The guard also said: " + _clean(guard_err, 300)) if guard_err else "")
        + " Read-only forms pass: git apply --check / --stat / --numstat / --summary, patch --dry-run."
    )
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                   "permissionDecisionReason": reason}}


def verdict(payload):
    """(exit code, stdout text or None)."""
    del GAPS[:]
    VARS.clear()
    ti = payload.get("tool_input") if isinstance(payload, dict) else None
    cmd = ti.get("command") if isinstance(ti, dict) else None
    if isinstance(cmd, list):
        cmd = " ".join(str(x) for x in cmd)
    if not isinstance(cmd, str) or not cmd:
        return 0, None
    cwd = payload.get("cwd") if isinstance(payload.get("cwd"), str) and payload.get("cwd") else os.getcwd()
    runs = scan(cmd, cwd)
    targets, words, verb = [], None, None
    for v, ts, w in runs:
        for t in ts:
            if t not in targets:
                targets.append(t)
                if words is None:
                    words, verb = w, v
    if not targets:
        return (4, "; ".join(GAPS)[:400]) if GAPS else (0, None)
    v, reason, err = ask_guard(targets[:MAX_TARGETS], payload)
    if v == "deny":
        # name the run that carries the guard's hit, when the reason names one
        for rv, ts, w in runs:
            if any(s in reason or os.path.basename(s) in reason for t in ts for s in spellings(t)):
                verb, words = rv, w
                break
        return 3, json.dumps(deny_document(verb, words, reason, err))
    if v == "error":
        return 5, ("the always-loaded write guard gave no verdict: " + reason + " " + err)[:400]
    return (4, "; ".join(GAPS)[:400]) if GAPS else (0, None)


# --- self-test: every arm calls scan(), the function verdict() runs; no guard is spawned ---------------------
def self_test():
    tmp = tempfile.mkdtemp(prefix="patch-al-st-")
    P = ("diff --git a/.claude/orchestrator/o.md b/.claude/orchestrator/o.md\n--- a/.claude/orchestrator/o.md\n"
         "+++ b/.claude/orchestrator/o.md\n@@ -1 +1 @@\n-x\n+y\n")
    Q = "--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,2 +1,2 @@\n--- a/CLAUDE.md\n+++ b/CLAUDE.md\n"  # header-shaped hunk lines
    R = "diff --git a/CLAUDE.md b/docs/old.md\nsimilarity index 100%\nrename from CLAUDE.md\nrename to docs/old.md\n"
    with open(os.path.join(tmp, "o.patch"), "w") as f:
        f.write(P)
    with open(os.path.join(tmp, "q.patch"), "w") as f:
        f.write(Q)
    with open(os.path.join(tmp, "r.patch"), "w") as f:
        f.write(R)
    with open(os.path.join(tmp, "abs.diff"), "w") as f:  # .diff: the *.patch glob arm below keeps its set
        f.write(P.replace(" a/", " /").replace(" b/", " /"))
    O = os.path.join(tmp, ".claude/orchestrator/o.md")

    def tg(cmd):
        return sorted({t for _, ts, _ in scan(cmd, tmp) for t in ts})
    cases = [
        ("git apply <file> names the patch's target", "git apply o.patch", [O]),
        ("git apply with options and -p1", "git apply --3way -p1 --whitespace=nowarn o.patch", [O]),
        ("git -C <dir> apply", "cd / && git -C " + tmp + " apply o.patch", [O]),
        ("cd before git apply", "cd " + tmp + " && git apply o.patch", [O]),
        ("git apply --cached is a write (stated decision)", "git apply --cached o.patch", [O]),
        ("git apply --index", "git apply --index o.patch", [O]),
        ("git apply -R", "git apply -R o.patch", [O]),
        ("git apply --check passes", "git apply --check o.patch", []),
        ("git apply --stat passes", "git apply --stat o.patch", []),
        ("git apply --check --apply is a write", "git apply --check --apply o.patch", [O]),
        ("--exclude of the target passes", "git apply --exclude=.claude/orchestrator/o.md o.patch", []),
        ("--exclude=* passes", "git apply --exclude=* o.patch", []),
        ("--include of another file only", "git apply --include=src/* o.patch", []),
        ("a hunk line shaped like a header is not a target", "git apply q.patch", [os.path.join(tmp, "src/x.ts")]),
        ("a rename away from CLAUDE.md names it", "git apply r.patch", [os.path.join(tmp, "CLAUDE.md"), os.path.join(tmp, "docs/old.md")]),
        ("--directory prefixes", "git apply --directory=sub o.patch", [os.path.join(tmp, "sub/.claude/orchestrator/o.md")]),
        ("inline heredoc", "git apply <<'EOF'\n" + P + "EOF", [O]),
        ("heredoc into git apply -", "git apply - <<EOF\n" + P + "EOF", [O]),
        ("printf piped", "printf '" + P.replace("\n", "\\n") + "' | git apply", [O]),
        ("cat piped", "cat o.patch | git apply", [O]),
        ("< redirect", "git apply < o.patch", [O]),
        ("patch -p1 < f", "patch -p1 < o.patch", [O]),
        ("patch -i f", "patch -p1 -i o.patch", [O]),
        ("patch --input=f", "patch -p1 --input=o.patch", [O]),
        ("patch with no -p takes the basename", "patch < o.patch", [os.path.join(tmp, "o.md"), os.path.join(tmp, "a/.claude/orchestrator/o.md"),
                                                                         os.path.join(tmp, "b/.claude/orchestrator/o.md")]),
        ("patch -d dir", "patch -d sub -p1 < o.patch", [os.path.join(tmp, "sub/.claude/orchestrator/o.md")]),
        ("patch origfile patchfile writes origfile", "patch CLAUDE.md o.patch", [os.path.join(tmp, "CLAUDE.md")]),
        ("patch -o out writes out", "patch -p1 -o /tmp/out.md < o.patch", ["/tmp/out.md"]),
        ("patch --dry-run passes", "patch --dry-run -p1 < o.patch", []),
        ("inside bash -c", "bash -c 'git apply o.patch'", [O]),
        ("inside $( )", "x=$(git apply o.patch)", [O]),
        ("behind env", "env A=1 git apply o.patch", [O]),
        ("a heredoc fed to a shell", "bash <<'EOF'\ngit apply o.patch\nEOF", [O]),
        ("on a later line", "echo hi\ngit apply o.patch", [O]),
        ("a cd inside ( ) ends at the )", "cd " + tmp + " && (cd /tmp && true); git apply o.patch", [O]),
        ("a cd inside { } persists", "{ cd /; }; git apply " + tmp + "/o.patch", ["/.claude/orchestrator/o.md"]),
        ("mention: a commit message", "git commit -m 'fix git apply o.patch bug'", []),
        ("mention: grep", "grep -n 'git apply' o.patch", []),
        ("mention: echo", "echo git apply o.patch", []),
        ("mention: a heredoc mail body", "mail-send <<'EOF'\ngit apply o.patch\npatch -p1 < o.patch\nEOF", []),
        ("mention: a comment", "ls # git apply o.patch", []),
        ("mention: git log -S", "git log -S 'git apply' --oneline", []),
        ("a .patch file name is not the patch verb", "cat x.patch; wc -l v68ca.patch", []),
        ("a glob operand is expanded", "git apply *.patch", [O, os.path.join(tmp, "CLAUDE.md"), os.path.join(tmp, "docs/old.md"), os.path.join(tmp, "src/x.ts")]),
        ("a patch written by a heredoc earlier in the command is read", "cat > w.patch <<'EOF'\n" + P + "EOF\ngit apply w.patch", [O]),
        ("git am is not this arm", "git am o.patch", []),
        ("a patch named through a variable set earlier is read", "S=" + tmp + "; git apply $S/o.patch", [O]),
        ("${S} spelling too", "S=" + tmp + " && git apply ${S}/o.patch", [O]),
        ("cd into a variable set to a literal resolves", "W=/; cd \"$W\" && git apply " + tmp + "/o.patch", ["/.claude/orchestrator/o.md"]),
        # 2026-10-30 review: macOS runs a capitalised verb, and the shell removes quotes and backslashes
        ("Git apply", "Git apply o.patch", [O]),
        ("GIT APPLY", "GIT APPLY o.patch", [O]),
        ("/usr/bin/GIT apply", "/usr/bin/GIT apply o.patch", [O]),
        ("Patch -p1 <", "Patch -p1 < o.patch", [O]),
        ("git ap\\ply", "git ap\\ply o.patch", [O]),
        ("git \"ap\"ply", "git \"ap\"ply o.patch", [O]),
        ("git ap''ply", "git ap''ply o.patch", [O]),
        ("pa\\tch -p1 <", "pa\\tch -p1 < o.patch", [O]),
        ("git $'apply' (no escape inside)", "git $'apply' o.patch", [O]),
        ("ENV wrapper (a program on PATH)", "ENV A=1 git apply o.patch", [O]),
        ("Bash -c wrapper", "Bash -c 'Git apply o.patch'", [O]),
        ("Cat o.patch | git apply", "Cat o.patch | git apply", [O]),
        ("mention: a capitalised commit message", "git commit -m \"fix Git Apply bug\"", []),
        ("mention: an Echo of Patch", "echo Patch -p1 < o.patch", []),
        # git and patch strip the root as the first -p component
        ("an absolute header under git apply -p1", "git apply abs.diff", [O]),
        ("an absolute header under patch -p1", "patch -p1 < abs.diff", [O]),
        ("an absolute header under -p2", "git apply -p2 abs.diff", [os.path.join(tmp, "orchestrator/o.md")]),
        # every arg-taking patch option, read the way getopt reads a cluster
        ("patch -g 0 -p1 <", "patch -g 0 -p1 < o.patch", [O]),
        ("patch --get 0 -p1 <", "patch --get 0 -p1 < o.patch", [O]),
        ("patch -sg 0 -p1 < (a cluster ending in -g)", "patch -sg 0 -p1 < o.patch", [O]),
        ("patch -Np1 < reads the -p1 inside the cluster", "patch -Np1 < o.patch", [O]),
        ("patch -sC is a dry run", "patch -sC -p1 < o.patch", []),
        # a |& pipe is read as a pipe
        ("cat o.patch |& git apply", "cat o.patch |& git apply", [O]),
        ("a clobber redirect's target is not a command", "patch -p1 >| out.txt < o.patch", [O]),
    ]
    bad = 0
    for name, cmd, want in cases:
        del GAPS[:]
        VARS.clear()
        got = tg(cmd)
        ok = got == sorted(want)
        bad += not ok
        print(("PASS" if ok else "FAIL") + "  " + name + ("" if ok else "  -> " + repr(got)))
    gaps = [
        ("a missing patch file is a recorded gap", "git apply nope.patch"),
        ("a patch built earlier in the same command is a recorded gap", "git diff > n.patch && git apply n.patch"),
        ("stdin from an unknown producer is a recorded gap", "git show HEAD | git apply"),
        ("a patch through a variable is a recorded gap", "git apply $P"),
        ("cd into a variable before git apply is a recorded gap", 'cd "$W" && git apply ' + tmp + '/o.patch'),
        ("git -C a variable is a recorded gap", 'git -C "$W" apply ' + tmp + '/o.patch'),
        ("cd into a variable before patch is a recorded gap", 'cd "$W" && patch -p1 < ' + tmp + '/o.patch'),
        ("cd into a $( ) is a recorded gap", 'cd "$(cat w.txt)" && git apply ' + tmp + '/o.patch'),
        ("a variable set from a $( ) stays a gap", 'W=$(cat w.txt); cd "$W" && git apply ' + tmp + '/o.patch'),
        ("a relative cd after a variable cd stays a gap", 'cd "$W" && cd sub && git apply ' + tmp + '/o.patch'),
        # both GAPS.append in scan()'s prologue, pinned
        ("a line naming git apply that will not tokenize is a recorded gap", "echo $'it\\'s'; git apply o.patch"),
        ("... and in capitals (VERB_WORD_RE folds case)", "echo $'it\\'s'; GIT APPLY o.patch"),
        ("a command too large to parse is a recorded gap", "echo '" + "x" * (koo.MAX_TEXT + 8) + "'; git apply o.patch"),
    ]
    for name, cmd in gaps:
        rc, _ = verdict({"tool_input": {"command": cmd}, "cwd": tmp})
        ok = rc == 4
        bad += not ok
        print(("PASS" if ok else "FAIL") + "  " + name + ("" if ok else "  -> rc " + str(rc)))
    del GAPS[:]
    VARS.clear()
    got = sorted({t for _, ts, _ in scan("cd " + tmp + " && git apply o.patch", "/") for t in ts})
    extra = [("a cd moves the directory the run resolves from (scan starts at /)", got == [O], got)]
    # the spellings the guard is asked about
    os.makedirs(os.path.join(tmp, ".claude/orchestrator"))
    os.symlink(os.path.join(tmp, ".claude/orchestrator"), os.path.join(tmp, "lnk"))
    sp = spellings(os.path.join(tmp, "lnk/o.md"))
    extra.append(("a symlinked directory is also asked as its realpath", os.path.realpath(O) in sp, sp))
    sp = spellings(os.path.join(tmp, ".claude/ruleſ/x.md"))
    extra.append(("a U+017F path is also asked as its casefold", any(s.endswith("/.claude/rules/x.md") for s in sp), sp))
    sp = spellings(os.path.join(tmp, "AGENTſ.md"))
    extra.append(("AGENTſ.md is also asked as agents.md", any(s.endswith("/agents.md") for s in sp), sp))
    plain = os.path.join(os.path.realpath(tmp), "src/x.ts")
    extra.append(("an ASCII path with no symlink is asked as itself only", spellings(plain) == [plain], spellings(plain)))
    doc = deny_document("git apply", ["git", "apply", "o.patch"], 'a "quoted" reason', "")
    why = json.loads(json.dumps(doc))["hookSpecificOutput"]
    extra.append(("deny document is one valid JSON object", why["permissionDecision"] == "deny", why))
    extra.append(("the deny text relays the guard, never asserts its reason",
                  "write guard refuses" in why["permissionDecisionReason"] and "door is not live" not in why["permissionDecisionReason"], ""))
    for name, ok, got in extra:
        bad += not ok
        print(("PASS" if ok else "FAIL") + "  " + name + ("" if ok else "  -> " + repr(got)[:300]))
    subprocess.run(["rm", "-rf", tmp])
    n = len(cases) + len(gaps) + len(extra)
    print(("ALL PASS" if bad == 0 else str(bad) + " FAILED") + " (" + str(n) + " arms)")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        sys.exit(self_test())
    try:
        payload = json.loads(sys.stdin.read())
    except Exception:
        print("payload is not JSON")
        sys.exit(4)
    rc, out = verdict(payload if isinstance(payload, dict) else {})
    if out:
        print(out)
    sys.exit(rc)
