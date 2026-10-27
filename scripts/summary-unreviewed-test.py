#!/usr/bin/env python3
"""Behavioural arms for scripts/summary-unreviewed.py (/summary step 7), run against the REAL script in a
subprocess (never an inline copy of its logic), over a throwaway git repo built here with `git init`, a
throwaway mail dir and synthetic transcripts.

Run: python3 scripts/summary-unreviewed-test.py   (exit 0 = all pass; prints FAIL lines otherwise).
Wired into scripts/smoke-test-hooks.sh beside the this-turn-claim runner.
SUMMARY_UNREVIEWED_SCRIPT=<path> points the arms at a mutant copy (the mutation runs below use it).

The repo: A (committed 2026-01-01, a.txt) · B (c.txt + dir/b.txt) · C (now, c2.txt) · Q (now, q.txt) on `dev`.
Arms:
  1. 3 confirmation lines, 3 branch spellings ([dev], [main (root-commit)], [detached HEAD]) -> 3 rows, 0 sent
  2. A named (7 chars, git abbreviates to 12) by a request under .md.read, B under .md.read-by-xyz -> both sent:1; C named only by a
     review-verdict, a peer's mail, and a body-planted `signal:` line -> sent:0 (the suffix set is the trap)
  3. a transcript with 0 confirmation lines -> STATE: NOTHING-COMMITTED, rc 0
  4. a missing transcript / a wrong sid / no sid / a repo with neither dev nor main -> STATE: CRASH, rc 2,
     and nothing on stdout that reads as a clean empty set
  5. Q is committed but its confirmation line was swallowed (a -q run): it is NOT found — the FLOOR
  6. touches: lists the commit's paths (B -> c.txt, dir/b.txt)
  7. the aged hint appears only when an UNSENT row is older than 3 h (A unsent: yes; C unsent: no; A sent: no)
  8. the house commit tools' own lines (safe-commit / private-index-commit: committed <sha>) are found
  9. bracketed prose and an unreachable sha are dropped and COUNTED, never rows
 10. --json: a state object first, then one object per row
 11. reachability is dev THEN main: a commit only on main is a row
 12. the signal allowlist one member at a time; a verdict-class signal is never a request
 13. from a linked worktree the default store is the main checkout's
 14. an unreadable store is a CRASH (rc 2, one line), never a traceback
 15. the 3 h aged threshold has a boundary (2 min under: fresh; 2 min over: aged)
 16. the catch-all: a non-Crash exception in the store pass OR the row pass -> rc 2 and ONE CRASH line, traceback on
     stderr; a multi-line message stays one line; an ascii stdout never shows a success line first; the planned
     Crash prints no traceback; KeyboardInterrupt / SystemExit pass through
Every env the test builds strips the 8 git location variables (GIT_DIR and kin): a pre-push from a linked
worktree exports GIT_DIR, and inherited it aimed every throwaway verb at the shared repo.
Mutations (run by hand when the script changes):
  M1 the store glob '*__%s.md*' -> '*__%s.md' (suffix handling blanked)  -> arm 2 red
  M2 emit_crash prints 'STATE: 0 commits, 0 unsent' and returns 0        -> arm 4 red
  M3 TOOL_CONFIRM_RE dropped from the step-1 loop                         -> arm 8 red
  M4 sent = git's short sha as a substring of a token (the block's rule)  -> arm 2 red (A)
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.environ.get('SUMMARY_UNREVIEWED_SCRIPT') or os.path.join(ROOT, 'scripts', 'summary-unreviewed.py')
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import session_status  # noqa: E402  (the control arm builds the transcript dir with the script's own key derivation)
SID = 'surtest1-0000-0000-0000-000000000000'
SID8 = SID[:8]
FAILS = []
PASSES = 0
# A pre-push hook fired from a LINKED worktree exports GIT_DIR=<repo>/.git/worktrees/<n>; inherited, every
# throwaway-repo verb below (and the script under test) would act on THAT repo instead.
_GIT_LOC = ('GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY',
            'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_PREFIX')
BASE_ENV = {k: v for k, v in os.environ.items() if k not in _GIT_LOC}
GIT_ENV = dict(BASE_ENV, GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t', GIT_COMMITTER_NAME='t',
               GIT_COMMITTER_EMAIL='t@t', GIT_CONFIG_GLOBAL='/dev/null', GIT_CONFIG_SYSTEM='/dev/null')


def check(label, cond, got=None):
    global PASSES
    if cond:
        PASSES += 1
    else:
        FAILS.append('FAIL: %s%s' % (label, '' if got is None else ' (got %r)' % (got,)))


def g(repo, *args, env=None):
    p = subprocess.run(['git', '-C', repo, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false'] + list(args),
                       capture_output=True, text=True, env=env or GIT_ENV)
    if p.returncode != 0:
        raise SystemExit('test setup: git %s failed: %s' % (' '.join(args), p.stderr))
    return p.stdout.strip()


def commit(repo, files, msg, date=None):
    for f in files:
        path = os.path.join(repo, f)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w') as fh:
            fh.write(msg + '\n')
    g(repo, 'add', '-A')
    env = dict(GIT_ENV)
    if date:
        env['GIT_AUTHOR_DATE'] = env['GIT_COMMITTER_DATE'] = date
    g(repo, 'commit', '-q', '-m', msg, env=env)
    return g(repo, 'rev-parse', 'HEAD')


def build_repo(base):
    repo = os.path.join(base, 'repo')
    os.makedirs(repo)
    g(repo, 'init', '-q', '-b', 'dev')
    # git abbreviates to 12 here, so a mail naming 7 chars (arm 2's A) is found only by the prefix rule
    g(repo, 'config', 'core.abbrev', '12')
    old = '2026-01-01T00:00:00+00:00'
    a = commit(repo, ['a.txt'], 'feat: A old', old)
    b = commit(repo, ['c.txt', 'dir/b.txt'], 'fix: B two paths', old)
    c = commit(repo, ['c2.txt'], 'feat: C fresh')
    q = commit(repo, ['q.txt'], 'chore: Q quiet')
    return repo, a, b, c, q


def transcript(base, name, texts):
    p = os.path.join(base, name)
    with open(p, 'w') as f:
        for i, t in enumerate(texts):
            f.write(json.dumps({'type': 'user', 'uuid': 'u%d' % i, 'message': {'role': 'user', 'content': [
                {'type': 'tool_result', 'tool_use_id': 't%d' % i, 'content': t}]}}) + '\n')
    return p


def mail(d, name, fm, body):
    with open(os.path.join(d, name), 'w') as f:
        f.write('---\n' + ''.join('%s\n' % l for l in fm) + '---\n\n' + body + '\n')


def run(*args, env_sid=None):
    env = dict(BASE_ENV)
    env.pop('CLAUDE_CODE_SESSION_ID', None)
    if env_sid:
        env['CLAUDE_CODE_SESSION_ID'] = env_sid
    p = subprocess.run([sys.executable, SCRIPT] + list(args), capture_output=True, text=True, env=env)
    return p, p.stdout.splitlines()


def rows(lines):
    return [l for l in lines if l.startswith('sent:')]


def row_for(lines, full):
    return next((l for l in rows(lines) if l.split(' ')[1] and full.startswith(l.split(' ')[1])), None)


def main():
    base = tempfile.mkdtemp(prefix='sur-')
    try:
        repo, a, b, c, q = build_repo(base)
        empty_mail = os.path.join(base, 'mail-empty')
        os.makedirs(empty_mail)
        common = ['--sid', SID, '--repo', repo]

        # 1 — three branch spellings
        t1 = transcript(base, 't1.jsonl', ['[dev %s] feat: A old\n 1 file changed' % a[:7],
                                           '[main (root-commit) %s] fix: B' % b[:7],
                                           '[detached HEAD %s] feat: C' % c[:10]])
        p, out = run(*common, '--transcript', t1, '--mail-dir', empty_mail)
        check('arm 1: rc 0', p.returncode == 0, (p.returncode, p.stderr))
        check('arm 1: state line names 3 commits, 3 unsent', out[:1] == ['STATE: 3 commits, 3 unsent'], out[:1])
        check('arm 1: 3 rows, all sent:0', len(rows(out)) == 3 and all(r.startswith('sent:0 ') for r in rows(out)), rows(out))
        check('arm 1: each of A, B, C has a row', all(row_for(out, x) for x in (a, b, c)), out)

        # 2 — the suffix set: .md.read and .md.read-by-<sid8> are sent mail too
        m2 = os.path.join(base, 'mail2')
        os.makedirs(m2)
        mail(m2, 'hub00000__1__%s.md.read' % SID8, ['from: %s' % SID8, 'subject: --code review of %s' % a[:7]], 'please review')
        mail(m2, 'hub00000__2__%s.md.read-by-xyz' % SID8, ['from: %s' % SID8, 'subject: batch', 'signal: review-request'],
             'commits:\n- %s\n' % b)
        mail(m2, 'hub00000__3__%s.md' % SID8, ['from: %s' % SID8, 'subject: verdict on your work', 'signal: review-verdict'],
             'your %s looks fine' % c[:7])
        mail(m2, 'hub00000__4__othersid.md', ['from: othersid', 'subject: --code %s' % c[:7]], 'not mine')
        mail(m2, 'hub00000__5__%s.md' % SID8, ['from: %s' % SID8, 'subject: fleet note'], 'signal: review-request\n%s' % c[:7])
        p, out = run(*common, '--transcript', t1, '--mail-dir', m2)
        check('arm 2: state 3 commits, 1 unsent', out[:1] == ['STATE: 3 commits, 1 unsent'], out[:1])
        check('arm 2: A (named under .md.read, 7 chars while git abbreviates to 12) sent:1', (row_for(out, a) or '').startswith('sent:1 '), row_for(out, a))
        check('arm 2: B (named under .md.read-by-xyz, full sha, signal arm) sent:1',
              (row_for(out, b) or '').startswith('sent:1 '), row_for(out, b))
        check('arm 2: C (verdict / peer / body-planted signal only) sent:0',
              (row_for(out, c) or '').startswith('sent:0 '), row_for(out, c))

        # 3 — committed nothing
        t3 = transcript(base, 't3.jsonl', ['no commits here', 'git status: clean'])
        p, out = run(*common, '--transcript', t3, '--mail-dir', empty_mail)
        check('arm 3: rc 0', p.returncode == 0, p.returncode)
        check('arm 3: NOTHING-COMMITTED', out[:1] and out[0].startswith('STATE: NOTHING-COMMITTED'), out)
        check('arm 3: no rows', rows(out) == [], out)

        # 4 — crashes: rc 2 and nothing that reads as a clean empty set
        bare = os.path.join(base, 'bare')
        os.makedirs(bare)
        g(bare, 'init', '-q', '-b', 'feature')
        commit(bare, ['x.txt'], 'feat: X')
        crash_cases = [
            ('missing transcript', run(*common, '--transcript', os.path.join(base, 'nope.jsonl'), '--mail-dir', empty_mail)),
            ('wrong sid', run('--sid', 'zzzzzzzz-not-a-real-session-id', '--repo', repo, '--mail-dir', empty_mail)),
            ('no sid', run('--repo', repo, '--transcript', t1, '--mail-dir', empty_mail)),
            ('neither dev nor main', run('--sid', SID, '--repo', bare, '--transcript', t1, '--mail-dir', empty_mail)),
        ]
        for label, (p, out) in crash_cases:
            check('arm 4 (%s): rc 2' % label, p.returncode == 2, (p.returncode, out))
            check('arm 4 (%s): stdout is the one CRASH line' % label,
                  len(out) == 1 and out[0].startswith('STATE: CRASH '), out)
            check('arm 4 (%s): no row, no commit count on stdout' % label,
                  not rows(out) and 'commits' not in p.stdout and 'NOTHING' not in p.stdout, p.stdout)

        # 5 — the FLOOR: Q was committed and its line never reached the transcript
        p, out = run(*common, '--transcript', t1, '--mail-dir', empty_mail)
        check('arm 5: Q (no confirmation line) is NOT found — a floor, by design', row_for(out, q) is None, out)

        # 6 — touches
        check('arm 6: B touches c.txt, dir/b.txt', (row_for(out, b) or '').endswith('| touches: c.txt, dir/b.txt'), row_for(out, b))
        check('arm 6: A touches a.txt', (row_for(out, a) or '').endswith('| touches: a.txt'), row_for(out, a))

        # 7 — the aged hint
        hint = lambda lines: [l for l in lines if l.startswith('HINT:')]
        t7a = transcript(base, 't7a.jsonl', ['[dev %s] feat: C' % c[:7]])
        p, out = run(*common, '--transcript', t7a, '--mail-dir', empty_mail)
        check('arm 7: a fresh unsent row -> no hint', out[:1] == ['STATE: 1 commits, 1 unsent'] and hint(out) == [], out)
        t7b = transcript(base, 't7b.jsonl', ['[dev %s] feat: A' % a[:7], '[dev %s] feat: C' % c[:7]])
        p, out = run(*common, '--transcript', t7b, '--mail-dir', empty_mail)
        check('arm 7: an unsent row older than 3 h -> exactly one hint naming 1 row',
              len(hint(out)) == 1 and hint(out)[0].startswith('HINT: 1 sent:0') and "git log --all --grep='<sha>'" in hint(out)[0], out)
        check('arm 7: the hint is the last line', out[-1:] == hint(out), out)
        p, out = run(*common, '--transcript', t7b, '--mail-dir', m2)
        check('arm 7: the old row SENT -> no hint', hint(out) == [], out)

        # 8 — the house commit tools' own confirmation lines
        t8 = transcript(base, 't8.jsonl', [' 1 file changed\nsafe-commit: committed %s' % q[:10],
                                           'private-index-commit: committed %s' % b[:7]])
        p, out = run(*common, '--transcript', t8, '--mail-dir', empty_mail)
        check('arm 8: safe-commit and private-index-commit lines -> 2 rows (Q, B)',
              out[:1] == ['STATE: 2 commits, 2 unsent'] and row_for(out, q) and row_for(out, b), out)

        # 9 — prose and unreachable shas are dropped and counted
        t9 = transcript(base, 't9.jsonl', ['[dev %s] feat: A' % a[:7], 'see [word deadbeef] and [dev deadbee] here',
                                           '[main 1234567] from a scratch repo'])
        p, out = run(*common, '--transcript', t9, '--mail-dir', empty_mail)
        check('arm 9: 1 row, 2 dropped and named on the state line',
              out[:1] == ['STATE: 1 commits, 1 unsent (2 transcript sha(s) dropped: not a commit reachable from dev)']
              and len(rows(out)) == 1, out)

        # 10 — --json
        p, out = run(*common, '--transcript', t1, '--mail-dir', m2, '--json')
        objs = [json.loads(l) for l in out if l.strip()]
        check('arm 10: state object first', objs and objs[0].get('state') == 'OK' and objs[0].get('commits') == 3
              and objs[0].get('unsent') == 1, objs[:1])
        check('arm 10: one object per row, with full sha and touches',
              len(objs) == 4 and {o['full'] for o in objs[1:]} == {a, b, c} and all('touches' in o for o in objs[1:]), objs)
        p, out = run(*common, '--transcript', os.path.join(base, 'nope.jsonl'), '--mail-dir', empty_mail, '--json')
        check('arm 10: a crash under --json is rc 2 and state CRASH', p.returncode == 2 and bool(out) and json.loads(out[0])['state'] == 'CRASH', out)

        # 11 — reachability is dev THEN main: a commit only on main (a hotfix merged by PR, not yet in dev) is a row
        r11 = os.path.join(base, 'r11')
        os.makedirs(r11)
        g(r11, 'init', '-q', '-b', 'dev')
        d11 = commit(r11, ['d.txt'], 'feat: on dev')
        g(r11, 'checkout', '-q', '-b', 'main')
        m11 = commit(r11, ['m.txt'], 'fix: only on main')
        g(r11, 'checkout', '-q', 'dev')
        t11 = transcript(base, 't11.jsonl', ['safe-commit: committed %s' % m11[:10], '[dev %s] feat' % d11[:7]])
        p, out = run('--sid', SID, '--repo', r11, '--transcript', t11, '--mail-dir', empty_mail)
        check('arm 11: a commit on main and not on dev is a row', out[:1] == ['STATE: 2 commits, 2 unsent'] and bool(row_for(out, m11)), out)

        # 12 — the signal allowlist one member at a time; a verdict-class signal is never a request, whatever its subject quotes
        t12 = transcript(base, 't12.jsonl', ['[dev %s] feat: A' % a[:7]])
        for i, sig in enumerate(('review-request', 'review-fold', 'fold-verify', 'fold-report', 'fold', 'deploy-review')):
            d12 = os.path.join(base, 'm12-%d' % i)
            os.makedirs(d12)
            mail(d12, 'hub00000__1__%s.md' % SID8, ['from: %s' % SID8, 'subject: batch', 'signal: %s' % sig], a[:7])
            p, out = run(*common, '--transcript', t12, '--mail-dir', d12)
            check('arm 12: signal %s is a request' % sig, out[:1] == ['STATE: 1 commits, 0 unsent'], out[:1])
        for i, sig in enumerate(('review-verdict', 'review-finding', 'review-ack', 'deploy-clear')):
            d12 = os.path.join(base, 'm12v-%d' % i)
            os.makedirs(d12)
            mail(d12, 'hub00000__1__%s.md.read' % SID8, ['from: %s' % SID8,
                 'subject: FOLD-VERIFY %s: CHANGES-REQUESTED (--code)' % a[:7], 'signal: %s' % sig], a[:7])
            p, out = run(*common, '--transcript', t12, '--mail-dir', d12)
            check('arm 12: a %s mail is never a request, even under a marker subject' % sig, out[:1] == ['STATE: 1 commits, 1 unsent'], out[:1])

        # 13 — the default store is the MAIN checkout's, reached from a linked worktree through the git common dir
        wt13 = os.path.join(base, 'wt13')
        g(repo, 'worktree', 'add', '-q', '--detach', wt13)
        store = os.path.join(repo, '.claude', 'state', 'session-mail')
        os.makedirs(store)
        mail(store, 'hub00000__1__%s.md' % SID8, ['from: %s' % SID8, 'signal: review-request'], a[:7])
        p, out = run('--sid', SID, '--repo', wt13, '--transcript', t12)
        check('arm 13: from a linked worktree the default store is the main checkout\'s', out[:1] == ['STATE: 1 commits, 0 unsent'], out)

        # 14 — an unreadable store is a CRASH, never a traceback with an empty stdout
        locked = os.path.join(base, 'locked')
        os.makedirs(locked)
        os.chmod(locked, 0)
        try:
            p, out = run(*common, '--transcript', t12, '--mail-dir', locked)
        finally:
            os.chmod(locked, 0o755)
        check('arm 14: an unreadable store -> rc 2 and one CRASH line', p.returncode == 2 and len(out) == 1 and out[0].startswith('STATE: CRASH '), (p.returncode, out))

        # 15 — the aged threshold has a boundary: 2 minutes under 3 h is fresh, 2 minutes over is aged
        r15 = os.path.join(base, 'r15')
        os.makedirs(r15)
        g(r15, 'init', '-q', '-b', 'dev')
        now15 = int(time.time())
        y15 = commit(r15, ['y.txt'], 'feat: young', date='@%d +0000' % (now15 - 3 * 3600 + 120))
        o15 = commit(r15, ['o.txt'], 'feat: old', date='@%d +0000' % (now15 - 3 * 3600 - 120))
        t15 = transcript(base, 't15.jsonl', ['[dev %s] feat: young' % y15[:7], '[dev %s] feat: old' % o15[:7]])
        p, out = run('--sid', SID, '--repo', r15, '--transcript', t15, '--mail-dir', empty_mail)
        check('arm 15: 2 min under the 3 h threshold is fresh, 2 min over is aged -> one hint naming 1 row',
              out[:1] == ['STATE: 2 commits, 2 unsent'] and len(hint(out)) == 1 and hint(out)[0].startswith('HINT: 1 sent:0'), out)

        # 16 — the catch-all: an exception that is not a Crash still answers on line 1, wherever
        # in main() it is raised, with the traceback on stderr; the planned Crash prints none; KeyboardInterrupt and
        # SystemExit pass through. A patched leaf of the REAL script, run in a subprocess — never an inline copy.
        def run_patched(target, exc, *args):
            code = ('import importlib.util, sys\n'
                    'spec = importlib.util.spec_from_file_location("sur", sys.argv[1])\n'
                    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n'
                    'def boom(*a, **k): raise %s\n'
                    'setattr(m, %r, boom)\n'
                    'sys.exit(m.main(sys.argv[2:]))\n') % (exc, target)
            env = dict(BASE_ENV)
            env.pop('CLAUDE_CODE_SESSION_ID', None)
            p = subprocess.run([sys.executable, '-c', code, SCRIPT] + list(args), capture_output=True, text=True, env=env)
            return p, p.stdout.splitlines()
        args16 = common + ['--transcript', t1, '--mail-dir', m2]
        for target in ('frontmatter', 'names_commit'):  # one in the store pass, one in the row pass
            p, out = run_patched(target, 'RuntimeError("boom")', *args16)
            check('arm 16: %s raising -> rc 2 and exactly one CRASH line naming the type' % target,
                  p.returncode == 2 and out == ['STATE: CRASH unexpected RuntimeError: boom'], (p.returncode, out))
            check('arm 16: %s raising -> the traceback is on stderr' % target,
                  'Traceback' in p.stderr and 'RuntimeError: boom' in p.stderr, p.stderr[-300:])
        p, out = run_patched('frontmatter', 'RuntimeError("one\\ntwo")', *args16)
        check('arm 16: a multi-line message is still ONE stdout line', out == ['STATE: CRASH unexpected RuntimeError: one two'], out)
        for exc, label in (('KeyboardInterrupt()', 'KeyboardInterrupt'), ('SystemExit(7)', 'SystemExit')):
            p, out = run_patched('transcript_shas', exc, *args16)
            check('arm 16: %s passes through (no stdout, rc neither 0 nor 2)' % label,
                  out == [] and p.returncode not in (0, 2), (p.returncode, out))
        p, out = run(*common, '--transcript', os.path.join(base, 'nope.jsonl'), '--mail-dir', empty_mail)
        check('arm 16: the planned Crash prints no traceback', p.returncode == 2 and 'Traceback' not in p.stderr, p.stderr)
        long16 = commit(repo, ['l.txt'], 'feat: a subject long enough to be cut at sixty characters by the row')
        t16 = transcript(base, 't16.jsonl', ['[dev %s] feat' % long16[:7]])
        env16 = dict(BASE_ENV, PYTHONIOENCODING='ascii')
        env16.pop('CLAUDE_CODE_SESSION_ID', None)
        p = subprocess.run([sys.executable, SCRIPT] + common + ['--transcript', t16, '--mail-dir', empty_mail],
                           capture_output=True, text=True, env=env16)
        check('arm 16: an unencodable row on an ascii stdout -> one CRASH line, never a success state line first',
              p.returncode == 2 and p.stdout.splitlines()[:1] and p.stdout.splitlines()[0].startswith('STATE: CRASH unexpected UnicodeEncodeError')
              and len(p.stdout.splitlines()) == 1, (p.returncode, p.stdout))

        # control: the env sid is the default
        tdir = os.path.join(base, 'home', '.claude', 'projects', session_status.project_key(session_status.repo_root(cwd=repo)))
        os.makedirs(tdir)
        shutil.copy(t1, os.path.join(tdir, SID + '.jsonl'))
        env = dict(BASE_ENV, HOME=os.path.join(base, 'home'), CLAUDE_CODE_SESSION_ID=SID)
        pc = subprocess.run([sys.executable, SCRIPT, '--repo', repo, '--mail-dir', empty_mail], capture_output=True, text=True, env=env)
        check('control: $CLAUDE_CODE_SESSION_ID + the default transcript path -> 3 rows',
              pc.stdout.splitlines()[:1] == ['STATE: 3 commits, 3 unsent'], pc.stdout)
    finally:
        shutil.rmtree(base, ignore_errors=True)

    for f in FAILS:
        print(f)
    print('summary-unreviewed-test: %d passed, %d failed' % (PASSES, len(FAILS)))
    return 1 if FAILS else 0


if __name__ == '__main__':
    sys.exit(main())
