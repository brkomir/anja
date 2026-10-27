#!/usr/bin/env python3
"""decisions-archive-zero-hit.py — PostToolUse (Bash, Grep), warn-mode: a grep that named DECISIONS.md
alone and returned 0 hits gets ONE line of context naming the archive beside it.

Why: the decisions log was split on
2026-10-26 — every entry dated before 2026-09-01 (495 of 1,028) moved verbatim to
DECISIONS-ARCHIVE-<first>-<last>.md at the repo root. 354 citations in 99 files still name a ruling as
"DECISIONS.md 2026-07-04", and sessions issued ~1,100 grep-shaped calls naming the live file in the 7 days
before the split. A grep of DECISIONS.md for an older ruling now reads 0, and this project's own rules read
an empty grep as "no such ruling". No citation pass reaches a grep typed from habit; this does, at the one
moment it matters — the false zero — and stays silent on every hit, on every grep that already names the
archive, and when no archive exists.

Predicate (both halves must hold):
  1. the call named the LIVE file only — `DECISIONS.md` in a grep/rg/ugrep/ag Bash command or as the Grep
     tool's path/glob, with no `DECISIONS-ARCHIVE` and no `DECISIONS*` / `DECISIONS?` glob beside it;
  2. the result is a zero — Bash stdout empty, or `0`, or every line a `<file>:0` count; Grep tool in content
     mode numLines 0 and no content (that mode reports numFiles 0 even on a hit), in any other mode numFiles 0,
     or no filenames and no content.
Emits one JSON document (`hookSpecificOutput.additionalContext`, the channel measured to reach the model on
PostToolUse — bare stderr does not), logs one row (ts, sid8, tool, the Bash command or the Grep pattern, path and glob) to
decisions-archive-zero-hit-fires.jsonl in $HOOK_FIRES_LOG_DIR when set, else in .claude/logs, and
exits 0 always (warn-mode; an exception also exits 0 so a broken hook can never block a tool call).

Escape: SKIP_DECISIONS_ARCHIVE_ZERO_HIT=1 in the settings env block.  Self-test: --self-test (12 arms, a
throwaway root; exit 1 on any failure).  Wired in .claude/settings.json under PostToolUse Bash and Grep.
"""
import glob
import json
import os
import re
import sys
import time

LIVE = re.compile(r'DECISIONS\.md')
ARCHIVE_NAMED = re.compile(r'DECISIONS-ARCHIVE|DECISIONS[*?]')
GREP_VERB = re.compile(r'(^|[\s;|&(])(grep|rg|ugrep|ag|egrep|fgrep)(\s|$)')
COUNT_LINE = re.compile(r'^[^:\n]*:0$')
HEADING = re.compile(r'^### ', re.M)


def root_dir():
    r = os.environ.get('CLAUDE_PROJECT_DIR') or os.getcwd()
    return r


def archives(root):
    return sorted(glob.glob(os.path.join(root, 'DECISIONS-ARCHIVE-*.md')))


def names_live_only(s):
    return bool(LIVE.search(s)) and not ARCHIVE_NAMED.search(s)


def bash_is_zero(resp):
    out = resp.get('stdout', '') if isinstance(resp, dict) else str(resp)
    out = str(out).strip()
    if out == '' or out == '0':
        return True
    lines = [l for l in out.split('\n') if l.strip()]
    return bool(lines) and all(COUNT_LINE.match(l.strip()) for l in lines)


def grep_tool_is_zero(resp):
    if not isinstance(resp, dict):
        return str(resp).strip() in ('', '0', 'No files found', 'No matches found')
    # Content mode reports numFiles 0 and no filenames even on a hit (Claude Code 2.1.310's Grep returns
    # {mode: "content", numFiles: 0, filenames: [], content, numLines}), so it is read by numLines and content.
    if resp.get('mode') == 'content':
        return not resp.get('numLines') and not str(resp.get('content') or '').strip()
    if 'numFiles' in resp:
        return resp.get('numFiles') == 0
    return not resp.get('filenames') and not str(resp.get('content') or '').strip()


def decide(payload, root):
    """Return the context line to emit, or None."""
    tool = payload.get('tool_name', '')
    inp = payload.get('tool_input') or {}
    resp = payload.get('tool_response')
    if tool == 'Bash':
        cmd = str(inp.get('command', ''))
        if not GREP_VERB.search(cmd) or not names_live_only(cmd):
            return None
        if not bash_is_zero(resp if resp is not None else {}):
            return None
    elif tool == 'Grep':
        target = ' '.join(str(inp.get(k, '')) for k in ('path', 'glob'))
        if not names_live_only(target):
            return None
        if not grep_tool_is_zero(resp if resp is not None else {}):
            return None
    else:
        return None
    arcs = archives(root)
    if not arcs:
        return None
    n = 0
    for a in arcs:
        try:
            n += len(HEADING.findall(open(a, encoding='utf-8', errors='replace').read()))
        except OSError:
            pass
    names = ', '.join(os.path.basename(a) for a in arcs)
    return (
        f'0 hits in DECISIONS.md for a search that named the live file only. The log was split on '
        f'2026-10-26: the {n} entries dated before 2026-09-01 live in {names} beside it. Re-run over both '
        f'files (`DECISIONS.md DECISIONS-ARCHIVE-*.md`) before reading this zero as "no such ruling".'
    )


def log_fire(root, payload, tool):
    try:
        d = os.environ.get('HOOK_FIRES_LOG_DIR') or os.path.join(root, '.claude', 'logs')
        os.makedirs(d, exist_ok=True)
        row = {
            'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'sid8': str(payload.get('session_id', ''))[:8],
            'tool': tool,
            'cmd': str((payload.get('tool_input') or {}).get('command') or ' '.join(str(v) for v in ((payload.get('tool_input') or {}).get(k) for k in ('pattern', 'path', 'glob')) if v))[:200],
        }
        with open(os.path.join(d, 'decisions-archive-zero-hit-fires.jsonl'), 'a', encoding='utf-8') as f:
            f.write(json.dumps(row) + '\n')
    except OSError:
        pass


def main():
    if os.environ.get('SKIP_DECISIONS_ARCHIVE_ZERO_HIT') == '1':
        return 0
    try:
        payload = json.load(sys.stdin)
    except (ValueError, OSError):
        return 0
    root = root_dir()
    line = decide(payload, root)
    if line is None:
        return 0
    log_fire(root, payload, payload.get('tool_name', ''))
    print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PostToolUse', 'additionalContext': line}}))
    return 0


def self_test():
    import shutil
    import subprocess
    import tempfile
    me = os.path.abspath(__file__)
    tmp = tempfile.mkdtemp(prefix='dazh-')
    try:
        open(os.path.join(tmp, 'DECISIONS.md'), 'w').write('# log\n\n## Shipped\n\n### 2026-09-03 — a\n\nbody\n')
        arc = os.path.join(tmp, 'DECISIONS-ARCHIVE-2026-03-2026-08-31.md')
        open(arc, 'w').write('# archive\n\n## Shipped\n\n### 2026-07-04 — b\n\nbody\n\n### 2026-06-23 — c\n\nbody\n')
        empty = tempfile.mkdtemp(prefix='dazh-empty-')
        open(os.path.join(empty, 'DECISIONS.md'), 'w').write('# log\n')

        def run(payload, root, env=None):
            e = dict(os.environ)
            e.pop('SKIP_DECISIONS_ARCHIVE_ZERO_HIT', None)
            e.pop('HOOK_FIRES_LOG_DIR', None)
            e['CLAUDE_PROJECT_DIR'] = root
            if env:
                e.update(env)
            p = subprocess.run([sys.executable, me], input=json.dumps(payload), capture_output=True, text=True, env=e)
            return p.returncode, p.stdout

        def fires(out):
            docs = [l for l in out.strip().split('\n') if l.strip()]
            if len(docs) != 1:
                return False
            d = json.loads(docs[0])
            return 'DECISIONS-ARCHIVE-2026-03-2026-08-31.md' in d['hookSpecificOutput']['additionalContext'] and '2 entries' in d['hookSpecificOutput']['additionalContext']

        bash = lambda cmd, out: {'tool_name': 'Bash', 'tool_input': {'command': cmd}, 'tool_response': {'stdout': out, 'stderr': '', 'interrupted': False}}
        grep = lambda path, resp: {'tool_name': 'Grep', 'tool_input': {'pattern': '2026-07-04', 'path': path}, 'tool_response': resp}
        arms = [
            ('1 Bash grep of the live file only, empty stdout → FIRES', bash("grep -n '2026-07-04' DECISIONS.md", ''), tmp, None, True),
            ('2 Bash grep of the live file with a hit → silent', bash("grep -n '2026-09-03' DECISIONS.md", '5:### 2026-09-03'), tmp, None, False),
            ('3 Bash grep naming the archive glob, empty → silent', bash("grep -n 'x' DECISIONS.md DECISIONS-ARCHIVE-*.md", ''), tmp, None, False),
            ('4 Bash grep -c printing 0 → FIRES', bash("grep -c 'x' DECISIONS.md", '0'), tmp, None, True),
            ('5 Grep tool on DECISIONS.md, numFiles 0 → FIRES', grep('DECISIONS.md', {'mode': 'content', 'numFiles': 0, 'filenames': [], 'content': ''}), tmp, None, True),
            ('6 Grep tool on another file, numFiles 0 → silent', grep('todo.txt', {'mode': 'content', 'numFiles': 0, 'filenames': [], 'content': ''}), tmp, None, False),
            ('7 no archive on disk → silent', bash("grep -n 'x' DECISIONS.md", ''), empty, None, False),
            ('8 a non-grep command naming the file, empty stdout → silent', bash('touch DECISIONS.md', ''), tmp, None, False),
            ('9 SKIP env → silent', bash("grep -n 'x' DECISIONS.md", ''), tmp, {'SKIP_DECISIONS_ARCHIVE_ZERO_HIT': '1'}, False),
            ('10 Grep tool content mode with a hit (numFiles 0, numLines 1) → silent', grep('DECISIONS.md', {'mode': 'content', 'numFiles': 0, 'filenames': [], 'content': '5:### 2026-09-03 — a', 'numLines': 1}), tmp, None, False),
            ('11 Bash grep -c over two files, every line <file>:0 → FIRES', bash("grep -c 'x' DECISIONS.md todo.txt", 'DECISIONS.md:0\ntodo.txt:0'), tmp, None, True),
            ('12 Bash grep over a DECISIONS*.md glob, empty → silent', bash("grep -n 'x' DECISIONS*.md", ''), tmp, None, False),
        ]
        ok = 0
        for name, payload, root, env, expect in arms:
            rc, out = run(payload, root, env)
            got = fires(out) if expect else (out.strip() == '')
            good = rc == 0 and got
            ok += good
            print(('PASS' if good else 'FAIL'), name, '' if good else f'(rc={rc} out={out[:160]!r})')
        print(f'self-test: {ok} passed / {len(arms) - ok} failed / {len(arms)} arms')
        return 0 if ok == len(arms) else 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        shutil.rmtree(empty, ignore_errors=True)


if __name__ == '__main__':
    if '--self-test' in sys.argv[1:]:
        sys.exit(self_test())
    try:
        sys.exit(main())
    except Exception:  # warn-mode: never block a tool call
        sys.exit(0)
