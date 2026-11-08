#!/usr/bin/env python3
"""Behavioural arms for .claude/hooks/keep-warm-gate.py and keep-warm-tool-deny.sh (2026-10-06).

Runs each hook as a subprocess against a throwaway state dir and a synthetic transcript, so it never
touches the live .claude/state. Prints one line per arm and exits 1 on any failure. Wired into
scripts/smoke-test-hooks.sh.
"""
import datetime
import json
import os
import re
import runpy
import subprocess
import sys
import atexit
import glob
import signal
import shutil
import tempfile
import time

ROOT =os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GATE = os.environ.get('KW_GATE_PATH') or os.path.join(ROOT, '.claude', 'hooks', 'keep-warm-gate.py')
DENY = os.environ.get('KW_DENY_PATH') or os.path.join(ROOT, '.claude', 'hooks', 'keep-warm-tool-deny.sh')
SID = 'fixture1-session-id'
SID8 = SID[:8]
T0 = 1_800_000_000.0
PING = '[keep-warm] automated cache keep-alive'
fails = 0
# Every gate run gets a fake notifier: a recovery pass posts a desktop notification, and an arm must never put one
# on the owner's screen (the first run of the 2026-11-06 arms posted 8 real ones before this seam existed).
# Every temp folder this suite makes lives under ONE run folder, removed at exit. Until 2026-11-06 each Rig left
# its folder in the shared temp dir (52,241 kw-gate-test-* folders by then), and one random name,
# kw-gate-test-0nsevils, failed the session-mail smoke's '*evil*' escape check 5 times in a promote precheck.
# A run killed by SIGKILL keeps its folder, so sweep run folders older than an hour (a full run takes ~15 s);
# SIGTERM and SIGHUP become a normal exit, so atexit still removes this run's folder.
for _old in glob.glob(os.path.join(tempfile.gettempdir(), 'kw-gate-run-*')):
    try:
        if time.time() - os.path.getmtime(_old) > 3600:
            shutil.rmtree(_old, True)
    except OSError:        # a peer run removed it between the glob and the stat
        pass
RUN_ROOT = tempfile.mkdtemp(prefix='kw-gate-run-')
atexit.register(shutil.rmtree, RUN_ROOT, True)
for _sig in (signal.SIGTERM, signal.SIGHUP):
    signal.signal(_sig, lambda signum, _frame: sys.exit(128 + signum))
NOTIFY_DIR = tempfile.mkdtemp(prefix='kw-notify-', dir=RUN_ROOT)
NOTIFY_CMD = os.path.join(NOTIFY_DIR, 'notify.sh')
with open(NOTIFY_CMD, 'w') as _f:
    _f.write('#!/bin/sh\nprintf "%s|%s\\n" "$1" "$2" >> "${KW_NOTIFY_LOG:-/dev/null}"\n')
os.chmod(NOTIFY_CMD, 0o755)
os.environ['KEEP_WARM_NOTIFY_CMD'] = NOTIFY_CMD     # every subprocess env below is built from os.environ


def iso(t):
    return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')


def transcript(path, reqs):
    """reqs: list of (epoch, read, write, tier) or (epoch, read, write, tier, input, output)."""
    with open(path, 'w') as f:
        for t, read, write, tier, *io in reqs:
            cc = {'ephemeral_1h_input_tokens': write if tier == '1h' else 0,
                  'ephemeral_5m_input_tokens': write if tier == '5m' else 0}
            u = {'cache_read_input_tokens': read, 'cache_creation_input_tokens': write, 'cache_creation': cc}
            if io:
                u.update(input_tokens=io[0], output_tokens=io[1])
            f.write(json.dumps({'type': 'assistant', 'timestamp': iso(t), 'message': {'usage': u}}) + '\n')
        # a sub-agent record that must be ignored
        f.write(json.dumps({'type': 'assistant', 'isSidechain': True, 'timestamp': iso(T0),
                            'message': {'usage': {'cache_read_input_tokens': 1, 'cache_creation_input_tokens': 0}}}) + '\n')


class Rig:
    def __init__(self):
        self.dir = tempfile.mkdtemp(prefix='kw-gate-test-', dir=RUN_ROOT)
        self.state = os.path.join(self.dir, 'state')
        os.makedirs(self.state)
        self.tx = os.path.join(self.dir, 'tx.jsonl')
        self.log = os.path.join(self.dir, 'fires.jsonl')
        self.touch('keep-warm-enabled')          # the fleet switch; section 12 removes it

    def touch(self, name, body=''):
        with open(os.path.join(self.state, name), 'w') as f:
            f.write(body)

    def status(self, **kw):
        with open(os.path.join(self.state, f'statusline-{SID8}.json'), 'w') as f:
            json.dump(kw, f)
        os.utime(os.path.join(self.state, f'statusline-{SID8}.json'), (T0, T0))

    def gate(self, prompt, at, payload=None, gate=None, extra_env=None):
        inp = payload if payload is not None else json.dumps(
            {'session_id': SID, 'prompt': prompt, 'transcript_path': self.tx, 'cwd': self.dir})
        env = dict(os.environ, FF_STATE_DIR=self.state, KEEP_WARM_NOW=str(at), KEEP_WARM_LOG=self.log,
                   CLAUDE_PROJECT_DIR=self.dir, KEEP_WARM_NOTIFY_CMD=NOTIFY_CMD,
                   KW_NOTIFY_LOG=os.path.join(self.dir, 'notify.log'))
        env.pop('SKIP_KEEP_WARM', None)
        env.pop('KEEP_WARM_COMPACT_HEADROOM', None)
        env.update(extra_env or {})
        # cwd is the rig, never the runner's: a gate that resolved a sibling script from its cwd instead of
        # its own file would pass every arm when the runner happens to start at the repo root (smoke does).
        r = subprocess.run([sys.executable, gate or GATE], input=inp, capture_output=True, text=True, env=env, cwd=self.dir)
        return r.returncode, r.stdout.strip()

    def deny(self, agent=False):
        # The harness's key order (2.1.292 `Ad`): session_id ... agent_id, then tool_name, tool_input.
        p = {'session_id': SID, **({'agent_id': 'a123'} if agent else {}), 'tool_name': 'Bash', 'tool_input': {'command': 'ls'}}
        env = dict(os.environ, FF_STATE_DIR=self.state, CLAUDE_PROJECT_DIR=self.dir)
        env.pop('SKIP_KEEP_WARM', None)
        r = subprocess.run(['bash', DENY], input=json.dumps(p), capture_output=True, text=True, env=env)
        return r.returncode, r.stdout.strip()

    def turn_marker(self):
        return os.path.exists(os.path.join(self.state, f'keep-warm-turn-{SID8}'))


def check(name, cond, detail=''):
    global fails
    print(('PASS  ' if cond else 'FAIL  ') + name + ('' if cond else f'  [{detail}]'))
    if not cond:
        fails += 1


BLOCK_REASONS = []   # every block reason an arm saw; the style arm at the end reads them


def blocked(out):
    try:
        d = json.loads(out)
        if d.get('decision') == 'block':
            BLOCK_REASONS.append(str(d.get('reason')))
        return d.get('decision') == 'block'
    except ValueError:
        return False


def due_rig(gap_min=35, tier='1h', read=400_000, write=2_000, io=()):
    r = Rig()
    transcript(r.tx, [(T0 - 7200, 0, 300_000, tier), (T0 - gap_min * 60, read, write, tier, *io)])
    return r


# 1. owner prompt: silent, exit 0, records last_owner
r = due_rig()
rc, out = r.gate('please fix the bug', T0)
check('owner prompt -> exit 0, no output', rc == 0 and out == '', out)
st = json.load(open(os.path.join(r.state, f'keep-warm-{SID8}.json')))
check('owner prompt -> last_owner recorded', st.get('last_owner') == T0, st)

# 2. due ping passes quietly and writes the turn marker
r = due_rig()
rc, out = r.gate(PING, T0)
check('due ping (35m, 1h tier) -> PASS with no output', rc == 0 and out == '', out)
check('passed ping -> turn marker written', r.turn_marker())
check('passed ping -> marker holds the gate clock', open(os.path.join(r.state, f'keep-warm-turn-{SID8}')).read().strip() == str(int(T0)))
r.touch(f'keep-warm-turn-{SID8}', f'{int(time.time())}\n')   # T0 is in the real clock's future; section 14 covers the gate-stamped path
rc, out = r.deny()
check('tool call on a ping turn (main session) -> DENIED', '"permissionDecision":"deny"' in out, out)
rc, out = r.deny(agent=True)
check('tool call from a sub-agent on a ping turn -> allowed', rc == 0 and out == '', (rc, out))
r.gate('<task-notification>x', T0 + 60)
check('any later prompt clears the turn marker', not r.turn_marker())
rc, out = r.deny()
check('tool call after the marker cleared -> allowed', rc == 0 and out == '', (rc, out))

# 3. gap window
for gap, want_block, label in ((20, True, 'fresh 20m'), (31, True, 'fresh 31m (33 is the floor since 2026-10-27)'), (32, True, 'fresh 32m (one under the 33 floor)'), (33, False, 'edge 33m'), (46, False, '46m'), (50, False, '50m (before the ~54m idle compaction)'), (51, True, 'cold 51m (MAX_GAP is exclusive)'), (52, True, 'cold 52m'), (59, True, 'cold 59m')):
    r = due_rig(gap_min=gap)
    rc, out = r.gate(PING, T0)
    check(f'gap {label} -> {"BLOCK" if want_block else "PASS"}', blocked(out) == want_block, out)

# 3b. countdown (status line cache_expires_at) decides when present
for left_min, want_block, label in ((8, True, '8m left (under the 9m floor since 2026-10-27)'), (18, False, '18m left (inside the 9..27 window)'), (21, False, '21m left (inside it)'), (20, False, '20m left'), (-1, True, 'countdown at zero'), (0.5, True, '30s left'),
                                  (27, False, '27m left exactly (the 9..27 window is inclusive)'), (27.5, True, '27m30s left (outside it)'), (26.5, False, '26m30s left'),
                                  (9, False, '9m left exactly (inclusive)'), (8.5, True, '8m30s left (too close: the idle compaction would win)'),
                                  (1, True, '60s left (passed until 2026-10-27)'), (1.5, True, '90s left')):
    r = due_rig(gap_min=5)                     # transcript says fresh; the countdown must win
    r.status(cache_expires_at=T0 + left_min * 60, five_hour_pct=10)
    rc, out = r.gate(PING, T0)
    check(f'countdown {label} -> {"BLOCK" if want_block else "PASS"}', blocked(out) == want_block, out)

# 3c. the block reason the owner sees after the harness's own yellow prefix: the subject, then the minutes and their source
r = due_rig(gap_min=5)
r.status(cache_expires_at=T0 + 42 * 60 + 54, five_hour_pct=10)   # off the minute: pins floor, as the status line's own `seconds // 60`
rc, out = r.gate(PING, T0)
check('countdown reason reads "[keep-warm] cache fresh, 42 min left on the countdown"',
      blocked(out) and json.loads(out).get('reason') == '[keep-warm] cache fresh, 42 min left on the countdown', out)
r = due_rig(gap_min=20.9)                  # off the minute: 20m54s reads 20, never 21
rc, out = r.gate(PING, T0)
check('fallback reason reads "[keep-warm] cache fresh, 20 min since the last request"',
      blocked(out) and json.loads(out).get('reason') == '[keep-warm] cache fresh, 20 min since the last request', out)

# 4. tier
r = due_rig(tier='5m')
rc, out = r.gate(PING, T0)
check('5m cache tier -> BLOCK', blocked(out) and '5m' in out, out)

# 5. off-states
for name, body, label in ((f'keep-warm-off-{SID8}', '', '/keep-warm off'),
                          (f'session-standby-{SID8}', '1 abc', '/standby'),
                          (f'session-pause-{SID8}', '1', '/pause --cold (no window file)')):
    r = due_rig()
    r.touch(name, body)
    rc, out = r.gate(PING, T0)
    check(f'{label} -> BLOCK', blocked(out), out)

# 5b. the post-compact-pending marker: a compaction the harness only PREPARED is not a pending recovery;
#     one that APPLIED is.
MARKER = 'compacted=' + datetime.datetime.fromtimestamp(T0 - 3600, datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S') + ' UTC trigger=auto focus=no focus_args=<none>\n'


def boundary(path, at):
    with open(path, 'a') as f:
        f.write(json.dumps({'type': 'system', 'subtype': 'compact_boundary', 'timestamp': iso(at)}) + '\n')


FRESH = dict(cache_expires_at=T0 + 600, five_hour_pct=10, compact_threshold=727_000)   # the ceiling can run
r = due_rig()
r.touch(f'post-compact-pending-{SID}', MARKER)
r.status(**FRESH)
rc, out = r.gate(PING, T0)
check('pending marker, no compact_boundary in the transcript (prepared only) -> PASS', rc == 0 and out == '', out)
check('prepared-only pass writes no post-compact-deferred breadcrumb (the gate calls rule(), never decide())',
      not os.path.exists(os.path.join(r.state, f'post-compact-deferred-{SID}')), sorted(os.listdir(r.state)))
check('prepared-only pass logs pending_marker on its fire line', bool(json.loads(open(r.log).read().splitlines()[-1]).get('pending_marker')))
r = due_rig()
r.touch(f'post-compact-pending-{SID}', MARKER)
rc, out = r.gate(PING, T0)                     # same, but no fresh status line: nothing waits on the compact point now
check('prepared only + no fresh status line (fallback path) -> PASS (no context guard)', rc == 0 and out == '', out)
r = due_rig()
r.touch(f'post-compact-pending-{SID}', MARKER)
r.status(**FRESH)
boundary(r.tx, T0 - 1800)                      # applied 30 min after the marker was written
rc, out = r.gate(PING, T0)
check('pending marker + a compact_boundary newer than it (applied) -> BLOCK, reason names RECOVER',
      blocked(out) and 'pending' in out and 'RECOVER' in out, out)
r = due_rig()
r.touch(f'post-compact-pending-{SID}', MARKER)
r.status(**FRESH)
boundary(r.tx, T0 - 7200)                      # an EARLIER compaction, already recovered
rc, out = r.gate(PING, T0)
check('pending marker + only an older compact_boundary -> PASS', rc == 0 and out == '', out)
r = due_rig()
r.touch(f'post-compact-pending-{SID}', MARKER)
r.touch(f'post-compact-cleared-{SID}', iso(T0 - 2400) + '\n')
boundary(r.tx, T0 - 1800)                      # a boundary AFTER the last recovery
rc, out = r.gate(PING, T0)
check('pending marker + boundary newer than the last recovery -> BLOCK', blocked(out) and 'pending' in out, out)
r = due_rig()
r.touch(f'post-compact-pending-{SID}', MARKER)
rc, out = r.gate(PING, T0, payload=json.dumps({'session_id': SID, 'prompt': PING, 'transcript_path': r.tx + '.missing', 'cwd': r.dir}))
# 'pending' in the reason: the transcript read further down blocks an unreadable path on its own, so a bare
# blocked() stays green even when the rule's NO-TRANSCRIPT verdict is wrongly read as prepared.
check('pending marker + unreadable transcript -> BLOCK (fail closed)', blocked(out) and 'pending' in out, out)
for label, body in (('missing', None), ('raising', 'def rule(*a, **k):\n    raise RuntimeError("broken")\n')):
    r = due_rig()
    r.touch(f'post-compact-pending-{SID}', MARKER)   # prepared only: a working rule would PASS this ping
    tree = os.path.join(r.dir, 'tree')
    os.makedirs(os.path.join(tree, '.claude', 'hooks'))
    os.makedirs(os.path.join(tree, 'scripts'))
    g = os.path.join(tree, '.claude', 'hooks', 'keep-warm-gate.py')
    with open(GATE) as src, open(g, 'w') as dst:
        dst.write(src.read())
    if body is not None:
        with open(os.path.join(tree, 'scripts', 'post-compact-deferral.py'), 'w') as f:
            f.write(body)
    rc, out = r.gate(PING, T0, gate=g)
    check(f'pending marker + {label} deferral script -> BLOCK (an exception never passes a ping)', blocked(out) and 'pending' in out, out)
r = due_rig()
env_rc = subprocess.run([sys.executable, GATE], input=json.dumps({'session_id': SID, 'prompt': PING, 'transcript_path': r.tx}),
                        capture_output=True, text=True, env=dict(os.environ, FF_STATE_DIR=r.state, SKIP_KEEP_WARM='1',
                                                                KEEP_WARM_NOW=str(T0), KEEP_WARM_LOG=r.log))
check('SKIP_KEEP_WARM=1 -> BLOCK', blocked(env_rc.stdout.strip()), env_rc.stdout)

# 6. usage ceiling (status line state file); the context is logged, never a block
r = due_rig()
r.status(five_hour_pct=100, compact_threshold=727_000)
rc, out = r.gate(PING, T0)
check('5-hour usage 100% -> BLOCK (the limit would refuse the ping)', blocked(out) and 'limit reached' in out, out)
r = due_rig()
r.status(five_hour_pct=96, compact_threshold=727_000)
rc, out = r.gate(PING, T0)
check('5-hour usage 96% -> PASS (no 95% ceiling: a warm cache matters most near the limit)', rc == 0 and out == '', out)
r = due_rig()
r.status(five_hour_pct=99.9, compact_threshold=727_000)
rc, out = r.gate(PING, T0)
check('5-hour usage 99.9% -> PASS', rc == 0 and out == '', out)
r = due_rig()
r.status(five_hour_pct=100, five_hour_resets_at=T0 - 60, compact_threshold=727_000)
rc, out = r.gate(PING, T0)
check('5-hour usage 100% read before the window reset (resets_at passed) -> PASS', rc == 0 and out == '', out)
r = due_rig()
r.status(five_hour_pct=100, five_hour_resets_at=T0 + 600, compact_threshold=727_000)
rc, out = r.gate(PING, T0)
check('5-hour usage 100%, reset still ahead -> BLOCK', blocked(out) and 'limit reached' in out, out)


def refused(path, t):
    """The record the harness writes for a refused request (2.1.296: isApiErrorMessage, model <synthetic>,
    every usage field 0; 824 rate_limit records of this shape in the project transcripts, 2026-10-10)."""
    with open(path, 'a') as f:
        f.write(json.dumps({'type': 'assistant', 'timestamp': iso(t), 'isApiErrorMessage': True, 'error': 'rate_limit',
                            'message': {'model': '<synthetic>', 'usage': {
                                'input_tokens': 0, 'output_tokens': 0, 'cache_read_input_tokens': 0,
                                'cache_creation_input_tokens': 0,
                                'cache_creation': {'ephemeral_1h_input_tokens': 0, 'ephemeral_5m_input_tokens': 0}}}}) + '\n')


# a ping that passed and was then refused (the meter was stale): its zero-usage record must not stand in
# for the last real request
r = due_rig(read=723_600)
refused(r.tx, T0 - 20 * 60)
json.dump({'last_ping': T0 - 20 * 60, 'pings_since_owner': 1}, open(os.path.join(r.state, f'keep-warm-{SID8}.json'), 'w'))
r.status(cache_expires_at=T0 + 600, five_hour_pct=99, compact_threshold=727_000)
rc, out = r.gate(PING, T0)
fire = json.loads(open(r.log).read().splitlines()[-1])
check('refused ping record does not stand in for the context (context_tokens is the last REAL request, 725,600) -> PASS',
      rc == 0 and out == '' and fire.get('context_tokens') == 725_600 and fire.get('compact_left') == 1_400, (out, fire))
st = json.load(open(os.path.join(r.state, f'keep-warm-{SID8}.json')))
check('refused ping -> logged as refused, not as a cache hit, no stop; its last_ping consumed and replaced by this one',
      fire.get('prev_ping_refused') is True and 'prev_ping_hit' not in fire and not st.get('stopped')
      and st.get('last_ping') == T0, (fire, st))
r = due_rig(gap_min=45)
refused(r.tx, T0 - 20 * 60)
rc, out = r.gate(PING, T0 + 25 * 60)
check('refused ping record does not reset the gap rule (real request 70m old, refused one 45m) -> BLOCK',
      blocked(out) and 'cold' in out, out)
# A ping near or past the auto-compact point passes and compacts while the cache is warm.
def last_fire(r):
    return json.loads(open(r.log).read().splitlines()[-1])
r = due_rig(read=723_600)                      # prefix 725,600: 1,400 left, blocked by the 1,500 headroom until the rule changed
r.status(five_hour_pct=10, compact_threshold=727_000)
rc, out = r.gate(PING, T0)
check('1,400 tokens left before the compact point -> PASS, the fire line logs compact_left 1400',
      rc == 0 and out == '' and last_fire(r).get('compact_left') == 1_400, (out, last_fire(r)))
r = due_rig(read=722_520)                      # prefix 724,520: a session idled here 2026-10-16, 2,480 left
r.status(five_hour_pct=10, compact_threshold=727_000)
rc, out = r.gate(PING, T0)
check('2,480 tokens left with the countdown due (the 2026-10-16 case the 97% ratio blocked) -> PASS', rc == 0 and out == '', out)
r = due_rig(read=722_520, io=(2, 3_505))       # the last reply was 3,505 tokens (measured 2026-10-09): 1,027 past the point
r.status(five_hour_pct=10, compact_threshold=727_000)
rc, out = r.gate(PING, T0)
f = last_fire(r)
check('context past the compact point (724,520 + 3,507 = 728,027) -> PASS, this ping compacts; compact_left -1027',
      rc == 0 and out == '' and f.get('context_tokens') == 728_027 and f.get('compact_left') == -1_027, (out, f))
r = due_rig(read=723_600)
r.status(five_hour_pct=10, compact_threshold=727_000)
rc, out = r.gate(PING, T0, extra_env={'KEEP_WARM_COMPACT_HEADROOM': '3000'})
check('a leftover KEEP_WARM_COMPACT_HEADROOM in the environment no longer blocks -> PASS', rc == 0 and out == '', out)
r = due_rig(read=723_600)                      # no status line: context is still logged, compact_left is not
rc, out = r.gate(PING, T0)
f = last_fire(r)
check('no fresh status line -> PASS, context_tokens logged, no compact_left',
      rc == 0 and out == '' and f.get('context_tokens') == 725_600 and 'compact_left' not in f, (out, f))
for bad in (0, True):                          # a threshold the status line never means: no compact_left
    r = due_rig(read=723_600)
    r.status(five_hour_pct=10, compact_threshold=bad)
    rc, out = r.gate(PING, T0)
    check(f'compact_threshold {bad!r} -> PASS, no compact_left logged', rc == 0 and out == '' and 'compact_left' not in last_fire(r), (out, last_fire(r)))
r = due_rig()
r.status(five_hour_pct=99, compact_threshold=727_000)
os.utime(os.path.join(r.state, f'statusline-{SID8}.json'), (T0 - 3600, T0 - 3600))
rc, out = r.gate(PING, T0)
check('stale status file (1h old) -> guards skipped, PASS', rc == 0 and out == '', out)

# 7. stop rule: STOP passes with no owner prompt, then BLOCK; owner prompt resets it
STOP = 14   # the gate's KEEP_WARM_STOP_PINGS default: pings stop after about 12 hours without an owner prompt (pings stay 45 min apart in the 9..27 window)
r = due_rig()
t = T0
results = []
for i in range(STOP + 1):
    transcript(r.tx, [(t - 35 * 60, 400_000, 2_000, '1h')])   # the previous ping hit (read >= write)
    rc, out = r.gate(PING, t)
    results.append(blocked(out))
    t += 35 * 60 + 60
check(f'stop rule: passes 1-{STOP}, blocks the {STOP + 1}th', results == [False] * STOP + [True], results)
r.gate('ok I am back', t)
transcript(r.tx, [(t + 60 - 35 * 60, 400_000, 2_000, '1h')])
rc, out = r.gate(PING, t + 60)
check('owner prompt clears the stop -> next due ping PASSES', rc == 0 and out == '', out)

# 8. harness prompt does NOT count as the owner
r = due_rig()
st_path = os.path.join(r.state, f'keep-warm-{SID8}.json')
json.dump({'pings_since_owner': STOP}, open(st_path, 'w'))
r.gate('<cross-session-message from="x">hi', T0)
rc, out = r.gate(PING, T0)
check('harness prompt does not reset the stop counter -> BLOCK', blocked(out), out)

# 9. a ping that found the cache gone stops keep-warm
r = due_rig()
r.gate(PING, T0)                                              # passes, sets last_ping
transcript(r.tx, [(T0 + 5, 0, 450_000, '1h')])               # the ping re-wrote everything
rc, out = r.gate(PING, T0 + 36 * 60)
check('previous ping came back as a full re-cache -> BLOCK and stop', blocked(out) and 'gone' in out, out)
rc, out = r.gate(PING, T0 + 72 * 60)
check('...and stays stopped on the next fire', blocked(out) and 'stopped' in out, out)
# 9b. a ping that carried the session over the compact point: the first request after
#     the compaction re-caches by design, so the next fire must not read it as an account switch
r = due_rig()
r.gate(PING, T0)                                              # passes, sets last_ping
transcript(r.tx, [(T0 + 5, 12_048, 175_000, '1h')])          # the ping's own request, on the compacted context
boundary(r.tx, T0 + 3)
r.gate('/post-compact', T0 + 20 * 60)                         # the owner returns and recovers
rc, out = r.gate(PING, T0 + 36 * 60)
f = last_fire(r)
check('previous ping compacted the session (boundary after it) -> no stop, logged prev_ping_compacted',
      rc == 0 and out == '' and f.get('prev_ping_compacted') is True and 'prev_ping_hit' not in f, (out, f))
for at, label in ((T0 - 3600, 'before the ping'), (T0 + 600, 'after its first request')):
    r = due_rig()
    r.gate(PING, T0)
    transcript(r.tx, [(T0 + 5, 0, 450_000, '1h')])           # a full re-cache, as in section 9
    boundary(r.tx, at)                                       # a compaction outside [ping, its first request]
    rc, out = r.gate(PING, T0 + 36 * 60)
    check(f'full re-cache with a compaction only {label} -> BLOCK and stop (not read as the ping compacting)',
          blocked(out) and 'gone' in out, out)

# 10. /pause keep-warm window (the default): passes past the stop rule until its window ends
r = due_rig()
r.touch(f'session-pause-{SID8}', '1')
r.touch(f'keep-warm-pause-{SID8}', str(int(T0 + 5 * 3600)))
json.dump({'pings_since_owner': STOP + 5}, open(os.path.join(r.state, f'keep-warm-{SID8}.json'), 'w'))
rc, out = r.gate(PING, T0)
check('/pause keep-warm window open -> PASS past the stop rule', rc == 0 and out == '', out)
r = due_rig()
r.touch(f'session-pause-{SID8}', '1')
r.touch(f'keep-warm-pause-{SID8}', str(int(T0 - 60)))
rc, out = r.gate(PING, T0)
check('/pause keep-warm window ended -> BLOCK', blocked(out), out)

# 11. failure modes
r = Rig()
rc, out = r.gate(PING, T0)                                    # no transcript file
check('unreadable transcript on a ping -> BLOCK (fail closed)', blocked(out), out)
rc, out = r.gate('', T0, payload='not json')
check('unparseable payload -> exit 0, no output (fail open)', rc == 0 and out == '', out)
r = due_rig()
json.dump(['not', 'a', 'dict'], open(os.path.join(r.state, f'keep-warm-{SID8}.json'), 'w'))
rc, out = r.gate('hello', T0)
check('corrupt state file + owner prompt -> exit 0, no output', rc == 0 and out == '', out)
r = due_rig()
r.gate(PING, T0)
r.gate(PING, T0 + 60)
n = sum(1 for _ in open(r.log))
check('every sentinel fire writes one log line', n == 2, n)
# 12. fail modes (from a security review)
r = due_rig()
rc, out = r.gate('[keep-warm] why does this fire every 5 minutes? fix it', T0)
st = json.load(open(os.path.join(r.state, f'keep-warm-{SID8}.json')))
check('owner prompt that merely starts "[keep-warm]", at a due time -> owner path (silent, no turn marker, last_owner set)',
      rc == 0 and out == '' and not r.turn_marker() and st.get('last_owner') == T0, (out, r.turn_marker(), st))
r = due_rig()
rc, out = r.gate(PING, T0, payload=json.dumps({'prompt': PING, 'transcript_path': r.tx}))
check('ping with no session_id -> BLOCK (fail closed)', blocked(out), out)
r = due_rig()
env = dict(os.environ, FF_STATE_DIR=r.state, KEEP_WARM_NOW=str(T0), KEEP_WARM_LOG=r.log, CLAUDE_PROJECT_DIR=r.dir,
           KEEP_WARM_STOP_PINGS='four')
env.pop('SKIP_KEEP_WARM', None)
p = subprocess.run([sys.executable, GATE], input=json.dumps({'session_id': SID, 'prompt': PING, 'transcript_path': r.tx}),
                   capture_output=True, text=True, env=env)
check('malformed KEEP_WARM_* tunable -> the gate still decides (exit 0 on its default; exit 1 would pass every fire)',
      p.returncode == 0 and r.turn_marker(), (p.returncode, p.stderr[-160:]))
r = due_rig()
r.touch(f'keep-warm-turn-{SID8}', '')
rc, out = r.deny()
check('turn marker with no epoch (a partial write) -> allowed, never an unexpiring deny', out == '', out)
SENT = runpy.run_path(GATE, run_name='kw_gate_constants')['SENTINEL']
skill = next((p for p in (os.environ.get('KW_SKILL_PATH') or '', os.path.join(ROOT, '.claude', 'skills', 'keep-warm', 'SKILL.md'),
                          os.path.join(ROOT, 'plans', 'keep-warm-build-2026-10-07', 'keep-warm-SKILL.md')) if p and os.path.exists(p)), '')
m = re.search(r'## The timer prompt[^\n]*\n+```\n([^\n]*)', open(skill).read() if skill else '')
check('the /keep-warm timer prompt starts with the gate SENTINEL (a drift turns every fire into an unchecked owner prompt)',
      bool(m) and m.group(1).startswith(SENT), (skill, m.group(1)[:60] if m else None, SENT))
settings = os.environ.get('KW_SETTINGS_PATH') or os.path.join(ROOT, '.claude', 'settings.json')
try:
    hooks = json.load(open(settings)).get('hooks') or {}
    wired = [h.get('command', '') for blocks in hooks.values() for b in blocks for h in b.get('hooks', [])
             if 'keep-warm-gate.py' in h.get('command', '') or 'keep-warm-tool-deny.sh' in h.get('command', '')]
except (OSError, ValueError, AttributeError, TypeError):
    wired = []
bad = [c for c in wired if not c.rstrip().endswith('|| exit 1')]
check(f'every wired keep-warm hook command ends "|| exit 1" ({len(wired)} wired; a bare exit 2 blocks every prompt or tool)',
      not bad, bad)

r = due_rig()
json.dump({'pings_since_owner': 'x'}, open(os.path.join(r.state, f'keep-warm-{SID8}.json'), 'w'))
rc, out = r.gate(PING, T0)
check('unexpected error on a ping (corrupt state value) -> BLOCK by the outer handler', blocked(out) and 'gate error' in out, out)
r = due_rig()
rc, out = r.gate(PING, T0, payload=json.dumps({'prompt': PING, 'transcript_path': r.tx}))
check('ping with no session id -> BLOCK (fail closed)', blocked(out), out)
rc, out = r.gate('', T0, payload=json.dumps({'prompt': 'hello', 'transcript_path': r.tx}))
check('owner prompt with no session id -> exit 0, no output', rc == 0 and out == '', out)
r = due_rig()
benv = {k: v for k, v in os.environ.items() if k != 'SKIP_KEEP_WARM'}
benv.update(FF_STATE_DIR=r.state, KEEP_WARM_NOW=str(T0), KEEP_WARM_LOG=r.log, KEEP_WARM_STOP_PINGS='4.0', KEEP_WARM_MAX_GAP_MIN='x')
b = subprocess.run([sys.executable, GATE], input=json.dumps({'session_id': SID, 'prompt': PING, 'transcript_path': r.tx}),
                   capture_output=True, text=True, env=benv)
check('mistyped tuning knobs fall back to their defaults (no import-time crash, due ping PASSES)',
      b.returncode == 0 and b.stdout.strip() == '', (b.returncode, b.stderr[-120:]))
r = due_rig()
r.status(five_hour_pct=100, compact_threshold=727_000)
benv.update(FF_STATE_DIR=r.state, KEEP_WARM_LOG=r.log, KEEP_WARM_USAGE_CEILING='nan', KEEP_WARM_MAX_GAP_MIN='58')
b = subprocess.run([sys.executable, GATE], input=json.dumps({'session_id': SID, 'prompt': PING, 'transcript_path': r.tx}),
                   capture_output=True, text=True, env=benv)
check("KEEP_WARM_USAGE_CEILING='nan' falls back to 100, never disables the limit -> BLOCK at 100%",
      blocked(b.stdout.strip()) and 'limit reached' in b.stdout, (b.returncode, b.stdout[-160:]))

# 13. ordering and edges the first 37 arms left open
for label, status in (('usage 100%', {'five_hour_pct': 100}), ('countdown 30m left', {'cache_expires_at': T0 + 30 * 60})):
    r = due_rig()
    r.touch(f'session-pause-{SID8}', '1')
    r.touch(f'keep-warm-pause-{SID8}', str(int(T0 + 5 * 3600)))
    r.status(**status)
    rc, out = r.gate(PING, T0)
    check(f'/pause keep-warm window still obeys the ceilings: {label} -> BLOCK', blocked(out), out)
for pfx in ('<task-notification>', '<cross-session-message from="x">', '<agent-message', '[Owner-authorized',
            '# Autonomous loop', 'Your claude.ai usage limit'):
    r = due_rig()
    json.dump({'pings_since_owner': STOP}, open(os.path.join(r.state, f'keep-warm-{SID8}.json'), 'w'))
    r.gate(pfx + ' x', T0)
    rc, out = r.gate(PING, T0)
    check(f'harness prompt {pfx[:20]!r} does not reset the stop counter -> BLOCK', blocked(out), out)
r = due_rig(read=705_600, write=20_000)          # the read alone leaves 21,400; read + write leaves 1,400
r.status(five_hour_pct=10, compact_threshold=727_000)
rc, out = r.gate(PING, T0)
check('context counts the last write too (705.6k read + 20k write) -> PASS, compact_left 1400',
      rc == 0 and out == '' and last_fire(r).get('compact_left') == 1_400, (out, last_fire(r)))
r = due_rig(gap_min=58)
rc, out = r.gate(PING, T0)
check('gap edge 58m -> BLOCK (the ceiling is inclusive)', blocked(out), out)

# 14. the tool-deny hook reads the REAL clock (`date +%s`), and T0 lies in its future, so every arm above
#     handed it a future-dated marker: the TTL and the session scoping need markers stamped from time.time().
now_real = int(time.time())
r = Rig()
for age, want_deny in ((60, True), (660, True), (1860, False)):   # 660: a compaction past 10 minutes stays denied
    r.touch(f'keep-warm-turn-{SID8}', f'{now_real - age}\n')
    rc, out = r.deny()
    check(f'turn marker {age}s old -> {"DENIED" if want_deny else "allowed (30-minute TTL)"}',
          rc == 0 and ('"permissionDecision":"deny"' in out) == want_deny, (rc, out))
r = Rig()
r.touch('keep-warm-turn-<other-session-id>', f'{now_real}\n')      # ANOTHER session's ping turn
rc, out = r.deny()
check("another session's ping turn -> this session's tool call allowed", rc == 0 and out == '', (rc, out))
r = Rig()
transcript(r.tx, [(now_real - 7200, 0, 300_000, '1h'), (now_real - 35 * 60, 400_000, 2_000, '1h')])
rc, out = r.gate(PING, now_real)
rc2, out2 = r.deny()
check('ping passed at the real clock -> its marker stamp keeps the tool block on', out == '' and '"permissionDecision":"deny"' in out2, (out, out2))

# 15. production path resolution: no FF_STATE_DIR, no CLAUDE_PROJECT_DIR, the session cwd in a subdirectory
proj = tempfile.mkdtemp(prefix='kw-gate-proj-', dir=RUN_ROOT)
subprocess.run(['git', 'init', '-q', proj], check=True)
sub = os.path.join(proj, 'scripts')
pstate = os.path.join(proj, '.claude', 'state')
os.makedirs(sub)
os.makedirs(pstate)
open(os.path.join(pstate, 'keep-warm-enabled'), 'w').close()   # the fleet switch: the gate blocks without it
ptx = os.path.join(proj, 'tx.jsonl')
transcript(ptx, [(now_real - 7200, 0, 300_000, '1h'), (now_real - 35 * 60, 400_000, 2_000, '1h')])
penv = {k: v for k, v in os.environ.items() if k not in ('CLAUDE_PROJECT_DIR', 'FF_STATE_DIR', 'SKIP_KEEP_WARM', 'KEEP_WARM_NOW')}
penv['KEEP_WARM_LOG'] = os.path.join(proj, 'fires.jsonl')
penv['KEEP_WARM_NOTIFY_CMD'] = NOTIFY_CMD


def sub_gate():
    p = json.dumps({'session_id': SID, 'prompt': PING, 'transcript_path': ptx, 'cwd': sub})
    return subprocess.run([sys.executable, GATE], input=p, capture_output=True, text=True, env=penv, cwd=sub).stdout.strip()


with open(os.path.join(pstate, f'session-standby-{SID8}'), 'w') as f:
    f.write('1 x')
out = sub_gate()
check('session cwd in a subdirectory -> the root /standby marker still BLOCKS', blocked(out) and 'standby' in out, out)
os.remove(os.path.join(pstate, f'session-standby-{SID8}'))
out = sub_gate()
d = subprocess.run(['bash', DENY], input=json.dumps({'session_id': SID, 'tool_name': 'Bash', 'tool_input': {'command': 'ls'}}),
                   capture_output=True, text=True, env=penv, cwd=sub)
check('session cwd in a subdirectory -> the turn marker lands where the tool-deny hook reads it, no shadow state',
      out == '' and '"permissionDecision":"deny"' in d.stdout and not os.path.exists(os.path.join(sub, '.claude')), (out, d.stdout))

# 12. the fleet switch is the live kill switch: no keep-warm-enabled and no pilot marker -> every fire blocks
r = due_rig()
os.remove(os.path.join(r.state, 'keep-warm-enabled'))
rc, out = r.gate(PING, T0)
check('no fleet switch, no pilot marker -> BLOCK (removing the switch stops every armed timer)',
      blocked(out) and 'switched on' in out, out)
r.touch(f'keep-warm-pilot-{SID8}')
rc, out = r.gate(PING, T0)
check('pilot marker for this session -> PASS without the fleet switch', rc == 0 and out == '', out)

# 12b. a keep-warm-pause file left behind after the pause ended does not lift the stop rule
r = due_rig()
r.touch(f'keep-warm-pause-{SID8}', str(int(T0 + 3 * 3600)))
json.dump({'pings_since_owner': STOP + 5}, open(os.path.join(r.state, f'keep-warm-{SID8}.json'), 'w'))
rc, out = r.gate(PING, T0)
check('keep-warm-pause left without session-pause -> stop rule still BLOCKS', blocked(out) and 'stop rule' in out, out)

# 12c. the default /pause writes a window, so "window + /standby" is a live state: /standby still wins
r = due_rig()
r.touch(f'session-pause-{SID8}', '1')
r.touch(f'keep-warm-pause-{SID8}', str(int(T0 + 5 * 3600)))
r.touch(f'session-standby-{SID8}', '1 abc')
rc, out = r.gate(PING, T0)
check('/pause keep-warm window open + /standby -> BLOCK (standby wins)', blocked(out) and 'standby' in out, out)
# 12d. the gate passes any unexpired window while a pause marker exists, so a window an earlier pause left behind
#      would keep pinging through a later /pause --cold: step 6b's --cold branch must remove it
_6b = [ln for ln in open(os.path.join(ROOT, '.claude', 'skills', 'pause', 'SKILL.md')) if ln.startswith('6b. ')]
check('/pause --cold removes a leftover keep-warm-pause window (pause/SKILL.md 6b)',
      len(_6b) == 1 and 'rm -f .claude/state/keep-warm-pause-<sid8>' in _6b[0], _6b[:1])
# 12e. a step that deletes the keep-warm timer must drop the armed marker too, or keep-warm-arm-reminder.sh stays
#      silenced with no timer behind it: /standby 1b and /keep-warm off step 2
# the enter section only: the resume section has its own step 1b (the mail read)
#   a renamed resume heading makes the split a no-op, so the arm names a missing heading instead of showing a good 1b line
_sb = open(os.path.join(ROOT, '.claude', 'skills', 'standby', 'SKILL.md')).read()
_resume_h = '## Process — `/standby resume`'
_enter = _sb.partition(_resume_h)[0]
_1b = [ln for ln in _enter.splitlines() if ln.startswith('1b. ')]
check('/standby drops the keep-warm armed marker with the timer (standby/SKILL.md 1b)',
      _resume_h in _sb and len(_1b) == 1 and 'rm -f .claude/state/keep-warm-armed-<sid8>' in _1b[0],
      f'resume heading present: {_resume_h in _sb}; {len(_1b)} enter-section 1b line(s): {_1b[:1]}')
_off = open(os.path.join(ROOT, '.claude', 'skills', 'keep-warm', 'SKILL.md')).read().partition('### `/keep-warm off`')[2].split('\n### ')[0]
_off2 = [ln for ln in _off.splitlines() if ln.startswith('2. ')]
check('/keep-warm off drops the armed marker with the timer (keep-warm/SKILL.md off step 2)',
      len(_off2) == 1 and 'rm -f .claude/state/keep-warm-armed-<sid8>' in _off2[0], _off2[:1])

# 13. tool block: only an epoch the gate wrote can deny; anything else reads as a stale marker
r = Rig()
r.touch(f'keep-warm-turn-{SID8}', f'{int(datetime.datetime.now().timestamp())}\n')
rc, out = r.deny()
check('turn marker holding a fresh epoch -> DENIED (control)', rc == 0 and '"permissionDecision":"deny"' in out, out)
for body, label in (('', 'empty'), ('abc\n', 'non-numeric'), ('0800\n', 'zero-led'), ('9' * 30 + '\n', 'overflowing')):
    r = Rig()
    r.touch(f'keep-warm-turn-{SID8}', body)
    rc, out = r.deny()
    check(f'{label} turn marker -> tool call allowed', rc == 0 and out == '', out)
r = Rig()
r.touch(f'keep-warm-turn-{SID8}', f'{int(time.time()) + 86400}\n')
rc, out = r.deny()
check('future-dated turn marker (+1 day) -> tool call allowed', rc == 0 and out == '', out)
r = Rig()
r.touch(f'keep-warm-turn-{SID8}', f'{int(time.time())}\n')
p_ = {'session_id': SID, 'tool_name': 'mcp__x__y', 'tool_input': {'agent_id': 'z'}}
rr = subprocess.run(['bash', DENY], input=json.dumps(p_), capture_output=True, text=True,
                    env={k: v for k, v in dict(os.environ, FF_STATE_DIR=r.state, CLAUDE_PROJECT_DIR=r.dir).items() if k != 'SKIP_KEEP_WARM'})
check('main-session call whose tool_input carries agent_id -> still DENIED', '"permissionDecision":"deny"' in rr.stdout, rr.stdout)
r = due_rig(gap_min=20)
rc, out = r.gate(PING + ', scheduled by this session. ... read mail or resume anything.', T0)
check('blocked timer text -> original prompt hidden', blocked(out) and json.loads(out)['hookSpecificOutput']['suppressOriginalPrompt'] is True, out)
rc, out = r.gate(PING + ' -- owner: why did this fire?', T0)
check('blocked prompt with owner text after the sentinel -> original prompt shown', blocked(out) and json.loads(out)['hookSpecificOutput']['suppressOriginalPrompt'] is False, out)

# 14. SessionStart directive (session-start.sh driven in a stub root): ONE line only when the gate AND the tool
#     block are wired, the skill exists, and the fleet switch or this session's pilot marker is on
SS = os.path.join(ROOT, '.claude', 'hooks', 'session-start.sh')
GATE_CMD = {'type': 'command', 'command': 'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/keep-warm-gate.py"'}
DENY_CMD = {'type': 'command', 'command': '"$CLAUDE_PROJECT_DIR/.claude/hooks/keep-warm-tool-deny.sh"'}


def directive(hooks, markers, skill=True, extra=None, source='startup'):
    root = tempfile.mkdtemp(prefix='kw-ss-test-', dir=RUN_ROOT)
    for d in ('.claude/hooks', '.claude/state', 'scripts'):
        os.makedirs(os.path.join(root, d))
    with open(SS) as src, open(os.path.join(root, '.claude/hooks/session-start.sh'), 'w') as dst:
        dst.write(src.read())
    for name, code in (('session-lifecycle.py', 0), ('session-manifest.py', 0), ('meta-corrections-scan.py', 0),
                       ('band-o-echo-scan.py', 1)):
        with open(os.path.join(root, 'scripts', name), 'w') as f:
            f.write(f'import sys\nsys.exit({code})\n')
    if skill:
        os.makedirs(os.path.join(root, '.claude/skills/keep-warm'))
        open(os.path.join(root, '.claude/skills/keep-warm/SKILL.md'), 'w').close()
    with open(os.path.join(root, '.claude/settings.json'), 'w') as f:
        json.dump(dict(extra or {}, hooks=hooks), f)
    for m in markers:
        open(os.path.join(root, '.claude/state', m), 'w').close()
    env = {'PATH': os.environ['PATH'], 'HOME': os.environ.get('HOME', root), 'CLAUDE_PROJECT_DIR': root}
    p = subprocess.run(['bash', os.path.join(root, '.claude/hooks/session-start.sh')], capture_output=True, text=True,
                       input=json.dumps({'session_id': SID, 'source': source}), env=env, cwd=root)
    # keep-warm-arm-reminder.sh carries a copy of this block's eligibility test (state markers, skill, _kw_wired):
    # drive it over the same stub root, so a drift between the two copies reds the row that differs
    r = subprocess.run(['bash', REMINDER], capture_output=True, text=True, env=env, cwd=root,
                       input=json.dumps({'session_id': SID, 'prompt': 'do a thing'}))
    REM_RESULTS.append((r.returncode, r.stdout.count('KEEP-WARM NOT ARMED')))
    return p.returncode, p.stdout.count('KEEP-WARM (standing directive)'), p.stdout.count('MAIL-LISTEN (standing directive)')


REMINDER = os.path.join(ROOT, '.claude', 'hooks', 'keep-warm-arm-reminder.sh')
REM_RESULTS = []


WIRED = {'UserPromptSubmit': [{'hooks': [GATE_CMD]}], 'PreToolUse': [{'matcher': '', 'hooks': [DENY_CMD]}]}
ON = ['keep-warm-enabled']
PERMS = {'permissions': {'allow': ['Bash(python3 .claude/hooks/keep-warm-gate.py:*)', 'Bash(.claude/hooks/keep-warm-tool-deny.sh)']}}
for label, hooks, markers, skill, extra, want in (
        ('wired + fleet switch -> ONE directive', WIRED, ON, True, None, 1),
        ('wired + this session pilot marker -> ONE directive', WIRED, [f'keep-warm-pilot-{SID8}'], True, None, 1),
        ('wired, no switch, no pilot -> none', WIRED, [], True, None, 0),
        ('wired + another session pilot marker only -> none', WIRED, ['keep-warm-pilot-zzzzzzzz'], True, None, 0),
        ('wired + switch + /keep-warm off -> none', WIRED, ON + [f'keep-warm-off-{SID8}'], True, None, 0),
        ('wired + switch + /standby -> none', WIRED, ON + [f'session-standby-{SID8}'], True, None, 0),
        ('gate without the tool block + switch -> none', {'UserPromptSubmit': WIRED['UserPromptSubmit']}, ON, True, None, 0),
        ('tool block under a Bash-only matcher + switch -> none',
         {'UserPromptSubmit': WIRED['UserPromptSubmit'], 'PreToolUse': [{'matcher': 'Bash', 'hooks': [DENY_CMD]}]}, ON, True, None, 0),
        ('gate under the wrong event + switch -> none', {'PreToolUse': [{'matcher': '', 'hooks': [GATE_CMD, DENY_CMD]}]}, ON, True, None, 0),
        ('both names only in permissions rules + switch -> none', {}, ON, True, PERMS, 0),
        ('wired + switch, skill not installed -> none', WIRED, ON, False, None, 0)):
    rc, kw, ml = directive(hooks, markers, skill, extra)
    # MAIL-LISTEN is the control: it proves the hook ran past the keep-warm block (standby disarms it on purpose)
    check(f'SessionStart: {label}', rc == 0 and kw == want and ml == (0 if 'standby' in label else 1), (rc, kw, ml))
    check(f'arm reminder agrees: {label}', REM_RESULTS[-1] == (0, want), REM_RESULTS[-1])
# the armed marker: a compact keeps it and the reminder stays silent (rc 0: an exit 2 would erase the prompt);
# a startup drops it (the timer died with the old process) and the reminder fires again
directive(WIRED, ON + [f'keep-warm-armed-{SID8}'], source='compact')
check('arm reminder: armed marker kept across a compact -> silent, rc 0', REM_RESULTS[-1] == (0, 0), REM_RESULTS[-1])
directive(WIRED, ON + [f'keep-warm-armed-{SID8}'], source='startup')
check('arm reminder: armed marker dropped by a startup -> fires', REM_RESULTS[-1] == (0, 1), REM_RESULTS[-1])

# 16. recovery ping. The mail watch is restarted as recommended, but never on a session that is parked, or
#     compacted, with its mail listeners shut down and waiting on the owner's message.
#     The gate tells ONE passing ping to re-arm the mail listener when the seat's reply to its own listener-expiry
#     notice was refused by the safety filter (one session, 08:52Z to 12:22Z on 2026-11-06), and the tool block
#     lets exactly that Monitor call through. Every other state must be left exactly as it was.
EXPIRY_BUSY = (f'<task-notification>\n<task-id>b1</task-id>\n<summary>Monitor event: "inbound session mail for {SID8}"'
               '</summary>\n<event>[Monitor expired after 30m with 2 events delivered. Re-arm it if you still need the '
               'watch.]</event>\n</task-notification>')
EXPIRY_QUIET = EXPIRY_BUSY.replace('with 2 events delivered', 'with no events delivered')
MAIL_EVENT = (f'<task-notification>\n<task-id>b1</task-id>\n<summary>Monitor event: "inbound session mail for {SID8}"'
              '</summary>\n<event>===== SESSION-MAIL (ADVISORY DATA) =====\nfrom: <peer-session-id></event>\n</task-notification>')
SAFETY_NOTE = ('Your response above was stopped by a safety classifier — this is not a tool or API error. The rest of '
               'it was withheld.')
ZERO_USAGE = {'input_tokens': 0, 'output_tokens': 0, 'cache_read_input_tokens': 0, 'cache_creation_input_tokens': 0,
              'cache_creation': {'ephemeral_1h_input_tokens': 0, 'ephemeral_5m_input_tokens': 0}}


def note(path, t, text, **kw):
    with open(path, 'a') as f:
        f.write(json.dumps({'type': 'user', 'timestamp': iso(t), 'message': {'role': 'user', 'content': text}, **kw}) + '\n')


def said(path, t, text):
    """A plain reply with no usage block: a turn's text, never a request the gap rule reads."""
    with open(path, 'a') as f:
        f.write(json.dumps({'type': 'assistant', 'timestamp': iso(t),
                            'message': {'content': [{'type': 'text', 'text': text}]}}) + '\n')


def safety_refusal(path, t):
    with open(path, 'a') as f:
        f.write(json.dumps({'type': 'assistant', 'timestamp': iso(t), 'isApiErrorMessage': True, 'error': 'invalid_request',
                            'message': {'model': '<synthetic>', 'stop_reason': 'refusal', 'usage': ZERO_USAGE,
                                        'content': [{'type': 'text', 'text': 'API Error: safeguards flagged this message'}]}}) + '\n')


def refusal_rig(trigger=EXPIRY_BUSY, at=T0, kind='refusal', before=()):
    """A due ping (the status-line countdown decides) after a turn started by `trigger` and refused."""
    r = Rig()
    transcript(r.tx, [(at - 7200, 0, 300_000, '1h'), (at - 35 * 60, 400_000, 2_000, '1h')])
    for fn in before:
        fn(r.tx)
    note(r.tx, at - 30 * 60, trigger, promptSource='system')
    note(r.tx, at - 30 * 60 + 2, SAFETY_NOTE, isMeta=True)
    (safety_refusal if kind == 'refusal' else refused)(r.tx, at - 30 * 60 + 10)
    r.status(cache_expires_at=at + 15 * 60)
    return r


def recovery_of(out):
    try:
        return json.loads(out)['hookSpecificOutput']['additionalContext']
    except (ValueError, KeyError, TypeError):
        return None


def rec_marker(r):
    return os.path.exists(os.path.join(r.state, f'keep-warm-recovery-{SID8}'))


r = refusal_rig()
rc, out = r.gate(PING, T0)
line = recovery_of(out) or ''
check('refused reply to the listener expiry, listener dead -> PASS with ONE recovery line naming the listener command',
      rc == 0 and not blocked(out) and line.startswith('[keep-warm] RECOVERY')
      and 'scripts/session-manifest.py mail-listen --poll 30`' in line and f'inbound session mail for {SID8}' in line, out)
check('recovery ping -> recovery marker AND turn marker written, fire line logs the refusal',
      rec_marker(r) and r.turn_marker() and last_fire(r).get('recovery', {}).get('refused_at') == iso(T0 - 30 * 60 + 10),
      last_fire(r))
r.gate('back now', T0 + 60)
check('the owner speaking clears the recovery marker with the turn marker', not rec_marker(r) and not r.turn_marker())

# the states left out by design: parked or compacting seats are never touched
r = refusal_rig()
r.touch(f'session-standby-{SID8}', '1 x')
rc, out = r.gate(PING, T0)
check('same refusal on a /standby seat -> BLOCK as before, no recovery marker', blocked(out) and not rec_marker(r), out)
r = refusal_rig()
r.touch(f'post-compact-pending-{SID}', 'compacted=x trigger=manual focus=no')
rc, out = r.gate(PING, T0)
check('same refusal with a post-compact recovery pending -> no recovery line, no recovery marker',
      recovery_of(out) is None and not rec_marker(r), out)
r = refusal_rig()
r.touch(f'post-compact-deferred-{SID}', 'x')
rc, out = r.gate(PING, T0)
check('same refusal with a deferred-compaction marker -> no recovery line', recovery_of(out) is None and not rec_marker(r), out)

# a seat that had gone quiet by its own choice: two empty expiries in a row, nobody spoke between
r = refusal_rig(trigger=EXPIRY_QUIET, before=(lambda p: note(p, T0 - 62 * 60, EXPIRY_QUIET, promptSource='system'),
                                              lambda p: said(p, T0 - 62 * 60 + 5, 'Leaving the listener off.')))
rc, out = r.gate(PING, T0)
check('second quiet expiry in a row refused (the seat had gone quiet) -> plain PASS, no recovery',
      rc == 0 and out == '' and not rec_marker(r), out)
r = refusal_rig(trigger=EXPIRY_QUIET, before=(lambda p: note(p, T0 - 62 * 60, EXPIRY_QUIET, promptSource='system'),
                                              lambda p: note(p, T0 - 50 * 60, 'check these claims', promptSource='typed'),
                                              lambda p: said(p, T0 - 50 * 60 + 5, 'Checked.')))
rc, out = r.gate(PING, T0)
check('quiet expiry refused, but the owner spoke after the previous quiet one -> recovery', bool(recovery_of(out)), out)
r = refusal_rig(trigger=EXPIRY_QUIET)
rc, out = r.gate(PING, T0)
check('one quiet expiry refused, no earlier expiry in the tail -> recovery', bool(recovery_of(out)), out)

# other refused turns are not this case
for trig, label in (('please look at the hub verdict', 'an owner message'), (MAIL_EVENT, 'a mail delivery event')):
    r = refusal_rig(trigger=trig)
    rc, out = r.gate(PING, T0)
    check(f'refused reply to {label} -> plain PASS, no recovery', rc == 0 and out == '' and not rec_marker(r), out)
r = refusal_rig(kind='rate_limit')
rc, out = r.gate(PING, T0)
check('expiry turn ended by a usage-limit error, not a refusal -> no recovery', rc == 0 and out == '', out)
r = refusal_rig()
said(r.tx, T0 - 20 * 60, 'Re-armed the listener.')
rc, out = r.gate(PING, T0)
check('the seat answered again after the refusal -> no recovery', rc == 0 and out == '', out)

# a live listener: nothing to do
r = refusal_rig()
live = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)', 'mail-listen'])
try:
    r.touch(f'mail-listen-{SID8}.pid', f'{live.pid}\n')
    rc, out = r.gate(PING, T0)
    check('same refusal, listener process alive -> plain PASS, no recovery', rc == 0 and out == '' and not rec_marker(r), out)
finally:
    live.kill()
    live.wait()
r = refusal_rig()
r.touch(f'mail-listen-{SID8}.pid', '999999\n')                       # a stale pid file: the process is gone
rc, out = r.gate(PING, T0)
check('stale pid file (no such process) -> recovery', bool(recovery_of(out)), out)

# a recovery ping that did not re-arm is retried by the next one; ping turns are skipped when walking back
r = refusal_rig()
# the harness writes every ping isMeta (10 of 10 in one session, 130 of 130 in a review): a non-meta fixture
# here passed while production's retry was dead (a review finding)
note(r.tx, T0 - 10 * 60, PING + ', scheduled by this session.', promptSource='system', isMeta=True)
said(r.tx, T0 - 10 * 60 + 2, '')
said(r.tx, T0 - 10 * 60 + 3, '[keep-warm]')
rc, out = r.gate(PING, T0)
check('an earlier (isMeta) ping turn after the refusal (no re-arm) -> the next due ping carries the recovery line', bool(recovery_of(out)), out)


# 16a. the folds of a review verdict, one arm per finding
def queued_owner(path, t, text):
    """An owner message typed while a turn runs: a queued_command attachment, never a user record."""
    with open(path, 'a') as f:
        f.write(json.dumps({'type': 'attachment', 'timestamp': iso(t), 'attachment': {
            'type': 'queued_command', 'prompt': text, 'commandMode': 'prompt', 'origin': {'kind': 'human'},
            'humanTurn': True}}) + '\n')


def raw(path, rec):
    with open(path, 'a') as f:
        f.write(json.dumps(rec) + '\n')


def bare_rig(at=T0):
    """refusal_rig without the expiry turn: the caller writes the records."""
    r = Rig()
    transcript(r.tx, [(at - 7200, 0, 300_000, '1h'), (at - 35 * 60, 400_000, 2_000, '1h')])
    r.status(cache_expires_at=at + 15 * 60)
    return r


A = T0 - 30 * 60
r = bare_rig()
note(r.tx, A, EXPIRY_BUSY, promptSource='system')
queued_owner(r.tx, A + 1, 'leave the mail watch off and wait for me')
note(r.tx, A + 2, SAFETY_NOTE, isMeta=True)
safety_refusal(r.tx, A + 10)
rc, out = r.gate(PING, T0)
check('the owner spoke inside the refused expiry turn (queued mid-turn) -> no recovery', recovery_of(out) is None and not rec_marker(r), out)
r = refusal_rig()
note(r.tx, T0 - 10 * 60, PING + ', scheduled by this session.', promptSource='system', isMeta=True)
queued_owner(r.tx, T0 - 10 * 60 + 1, 'stop the listener, I am back at six')
said(r.tx, T0 - 10 * 60 + 3, 'Noted.')
rc, out = r.gate(PING, T0)
check('the owner spoke inside a later ping turn (queued mid-turn) -> no recovery', recovery_of(out) is None and not rec_marker(r), out)
r = refusal_rig()
note(r.tx, T0 - 10 * 60, PING + '\n\nwhy did this fire? leave the watch off.', promptSource='typed')
said(r.tx, T0 - 10 * 60 + 3, 'Answered.')
rc, out = r.gate(PING, T0)
check('an owner message that starts with the ping text is the owner, not a ping -> no recovery', recovery_of(out) is None, out)
PEER = 'Another Claude session sent a message: <agent-message from="x">ping</agent-message>'
for starter, label in ((PEER, 'a peer message'), ('[Owner-authorized autonomous run - one-shot cron]', 'a one-shot run')):
    r = bare_rig()
    note(r.tx, A, EXPIRY_BUSY, promptSource='system')
    said(r.tx, A + 5, 'Not re-arming: the owner said to wait for him.')
    note(r.tx, A + 600, starter, promptSource='system', isMeta=True)
    note(r.tx, A + 601, SAFETY_NOTE, isMeta=True)
    safety_refusal(r.tx, A + 610)
    rc, out = r.gate(PING, T0)
    check(f'busy expiry answered (left off), a later isMeta {label} turn refused -> no recovery',
          recovery_of(out) is None and not rec_marker(r), out)
r = bare_rig()
note(r.tx, A, EXPIRY_BUSY, promptSource='system')
raw(r.tx, {'type': 'assistant', 'timestamp': iso(A + 1), 'message': {'content': [{'type': 'tool_use', 'id': 'tu1', 'name': 'Skill', 'input': {'skill': 'mail'}}]}})
raw(r.tx, {'type': 'user', 'timestamp': iso(A + 2), 'message': {'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': 'tu1', 'content': 'ok'}]}})
note(r.tx, A + 3, 'Base directory for this skill: /x', isMeta=True)
note(r.tx, A + 4, SAFETY_NOTE, isMeta=True)
safety_refusal(r.tx, A + 12)
rc, out = r.gate(PING, T0)
check('a refused expiry turn that ran a tool and loaded a skill (isMeta) -> recovery', bool(recovery_of(out)), out)
r = bare_rig()
note(r.tx, A - 3700, EXPIRY_QUIET, promptSource='system')
said(r.tx, A - 3680, 'Leaving the listener off.')
raw(r.tx, {'type': 'system', 'subtype': 'compact_boundary', 'timestamp': iso(A - 2000)})
note(r.tx, A - 1999, 'This session is being continued from a previous conversation...', isCompactSummary=True)
note(r.tx, A, EXPIRY_QUIET, promptSource='system')
note(r.tx, A + 1, SAFETY_NOTE, isMeta=True)
safety_refusal(r.tx, A + 9)
rc, out = r.gate(PING, T0)
check('second quiet expiry refused, the first one behind a compaction summary -> no recovery', recovery_of(out) is None, out)
r = bare_rig()
note(r.tx, A, EXPIRY_BUSY, promptSource='system')
said(r.tx, A + 5, 'Re-armed.')
raw(r.tx, {'type': 'assistant', 'timestamp': iso(A + 60), 'isSidechain': True, 'isApiErrorMessage': True, 'message': {'stop_reason': 'refusal', 'content': []}})
raw(r.tx, {'type': 'assistant', 'timestamp': iso(A + 61), 'agentId': 'a1', 'isApiErrorMessage': True, 'message': {'stop_reason': 'refusal', 'content': []}})
rc, out = r.gate(PING, T0)
check('sub-agent refusal records after a normal expiry reply -> no recovery', recovery_of(out) is None, out)
OTHER = EXPIRY_BUSY.replace(f'inbound session mail for {SID8}', 'usage watch')
r = refusal_rig(trigger=OTHER)
rc, out = r.gate(PING, T0)
check('refused reply to ANOTHER Monitor expiry -> no recovery', recovery_of(out) is None, out)
r = refusal_rig(trigger=f'why did this say "inbound session mail for {SID8}" [Monitor expired after 30m?')
rc, out = r.gate(PING, T0)
check('refused owner message QUOTING the expiry text -> no recovery', recovery_of(out) is None, out)
QUOTING_EVENT = MAIL_EVENT.replace('from: <peer-session-id>', 'from: <peer-session-id>\n> [Monitor expired after 30m with 2 events delivered.]')
r = refusal_rig(trigger=QUOTING_EVENT)
rc, out = r.gate(PING, T0)
check('refused reply to a mail EVENT whose body quotes the expiry words -> no recovery (the harness shape is matched whole)',
      recovery_of(out) is None, out)
r = refusal_rig(trigger=EXPIRY_QUIET, before=(lambda p: note(p, T0 - 62 * 60, OTHER.replace('2 events', 'no events'), promptSource='system'),
                                              lambda p: said(p, T0 - 62 * 60 + 5, 'ok')))
rc, out = r.gate(PING, T0)
check('own quiet expiry refused, the previous quiet expiry was another Monitor -> recovery', bool(recovery_of(out)), out)
r = bare_rig()
note(r.tx, A, EXPIRY_BUSY, promptSource='system')
rc, out = r.gate(PING, T0)
check('an expiry with no reply recorded yet -> plain PASS, never a gate error', rc == 0 and out == '' and not rec_marker(r), out)
r = refusal_rig()
other_proc = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
try:
    r.touch(f'mail-listen-{SID8}.pid', f'{other_proc.pid}\n')
    rc, out = r.gate(PING, T0)
    check('pid file reused by a live process that is not the listener -> recovery', bool(recovery_of(out)), out)
finally:
    other_proc.kill()
    other_proc.wait()
r = refusal_rig(trigger=EXPIRY_QUIET, before=(lambda p: note(p, T0 - 62 * 60, EXPIRY_QUIET, promptSource='system'),
                                              lambda p: said(p, T0 - 62 * 60 + 5, 'ok')))
r.touch(f'review-hub-active-{SID8}')
rc, out = r.gate(PING, T0)
check('a review hub whose second quiet expiry was refused -> recovery (a hub is owed mail)',
      'mail-listen --poll 30 --rebroadcast-hours 48`' in (recovery_of(out) or ''), out)
# From a review (its patch applied verbatim): the hand-merged clauses no arm above pins.
# Each arm is the only one that reds its mutant: the quiet walk's attachment stop, its peer-turn break, its typed
# break, and _owner_queued's origin test; the last is an earlier finding's queued arm.
QUIET1 = (lambda p: note(p, T0 - 62 * 60, EXPIRY_QUIET, promptSource='system'), lambda p: said(p, T0 - 62 * 60 + 5, 'ok'))
r = refusal_rig(trigger=EXPIRY_QUIET, before=QUIET1 + (lambda p: queued_owner(p, T0 - 50 * 60, 'keep going'),))
rc, out = r.gate(PING, T0)
check('second quiet expiry refused, the owner spoke (queued) between the two -> recovery (not an idle seat)', bool(recovery_of(out)), out)
r = refusal_rig(trigger=EXPIRY_QUIET, before=QUIET1 + (lambda p: note(p, T0 - 50 * 60, PEER, promptSource='system', isMeta=True),
                                                       lambda p: said(p, T0 - 50 * 60 + 5, 'Answered the peer.')))
rc, out = r.gate(PING, T0)
check('second quiet expiry refused, an isMeta peer-message turn between the two -> recovery (work between)', bool(recovery_of(out)), out)
r = refusal_rig(trigger=EXPIRY_QUIET, before=QUIET1 + (lambda p: note(p, T0 - 50 * 60, '<task-notification> what was this?', promptSource='typed'),
                                                       lambda p: said(p, T0 - 50 * 60 + 5, 'Explained.')))
rc, out = r.gate(PING, T0)
check('second quiet expiry refused, the owner TYPED a harness-prefixed message between the two -> recovery', bool(recovery_of(out)), out)
r = bare_rig()
note(r.tx, A, EXPIRY_BUSY, promptSource='system')
raw(r.tx, {'type': 'attachment', 'timestamp': iso(A + 1), 'attachment': {'type': 'queued_command', 'commandMode': 'prompt', 'isMeta': True,
                                                                         'prompt': '<agent-message from="a1">x</agent-message>', 'origin': {'kind': 'peer'}}})
raw(r.tx, {'type': 'attachment', 'timestamp': iso(A + 1), 'attachment': {'type': 'queued_command', 'commandMode': 'task-notification',
                                                                         'prompt': '<task-notification>\n<task-id>z</task-id>\n</task-notification>',
                                                                         'origin': {'kind': 'task-notification'}}})
note(r.tx, A + 2, SAFETY_NOTE, isMeta=True)
safety_refusal(r.tx, A + 10)
rc, out = r.gate(PING, T0)
check('peer and task-notification queued attachments inside the refused turn are not the owner -> recovery', bool(recovery_of(out)), out)
r = refusal_rig()
note(r.tx, T0 - 10 * 60, PING + '\n\nwhy did this fire? leave the watch off.', promptSource='queued')
said(r.tx, T0 - 10 * 60 + 3, 'Answered.')
rc, out = r.gate(PING, T0)
check('an owner message typed while busy (promptSource queued) that starts with the ping text is the owner -> no recovery',
      recovery_of(out) is None, out)
r = refusal_rig(trigger=EXPIRY_QUIET, before=QUIET1 + (lambda p: note(p, T0 - 50 * 60, '<task-notification> and this?', promptSource='suggestion_accepted'),
                                                       lambda p: said(p, T0 - 50 * 60 + 5, 'Explained.')))
rc, out = r.gate(PING, T0)
check('second quiet expiry refused, an owner suggestion_accepted message between the two -> recovery (the quiet walk)',
      bool(recovery_of(out)), out)
r = refusal_rig(trigger=EXPIRY_QUIET, before=QUIET1 + (lambda p: note(p, T0 - 50 * 60, '<task-notification> and this?', promptSource='queued'),
                                                       lambda p: said(p, T0 - 50 * 60 + 5, 'Explained.')))
rc, out = r.gate(PING, T0)
check('second quiet expiry refused, an owner message queued while busy (promptSource queued) between the two -> recovery (the quiet walk)',
      bool(recovery_of(out)), out)
# the recovery line overrides the OLD timer wording by name (seats armed before the change still carry it)
r = refusal_rig()
rc, out = r.gate(PING, T0)
line = recovery_of(out) or ''
check('the recovery line names and overrides the old timer wording (out of scope, do not arm a listener)',
      'this line overrides it' in line and 'out of scope' in line and 'do not arm a listener' in line, line)
# an allow earned by one ping does not survive a later ping that did not earn it (here: a compaction appeared)
r = refusal_rig()
r.gate(PING, T0)
r.touch(f'post-compact-pending-{SID}', 'compacted=x trigger=auto focus=no')
rc, out = r.gate(PING, T0 + 60)                                    # still due; the compaction was only prepared: DEFERRED, passes
check('a later PASSING ping that earns no recovery removes the earlier recovery marker',
      not blocked(out) and r.turn_marker() and not rec_marker(r), (out, rec_marker(r)))

# the desktop notification when a session's reply is refused: once per refused reply, whatever turn was refused,
# on the first timer tick that reads the transcript, passed or blocked. The first build covered only the listener
# case on a passing ping.
def notes(r):
    p = os.path.join(r.dir, 'notify.log')
    return open(p).read().splitlines() if os.path.exists(p) else []


NAMED = (lambda p: raw(p, {'type': 'custom-title', 'customTitle': 'moderation-spinoff', 'sessionId': SID}),)
r = refusal_rig(before=NAMED)
r.gate(PING, T0)
n_ = notes(r)
check('listener-expiry refusal -> ONE notification naming the session, the time and the restart',
      len(n_) == 1 and 'moderation-spinoff' in n_[0] and iso(A + 10)[11:16] in n_[0] and 'restarts it' in n_[0]
      and last_fire(r).get('refusal_notice', {}).get('notified') is True, (n_, last_fire(r)))
rc, out = r.gate(PING, T0 + 60)                                    # the next due ping retries the same refusal
check('the next ping retrying the SAME refusal -> recovery line again, no second notification',
      bool(recovery_of(out)) and len(notes(r)) == 1, (out, notes(r)))
for trig, label in (('please look at the hub verdict', 'an owner message'), (MAIL_EVENT, 'a review verdict mail event')):
    r = refusal_rig(trigger=trig, before=NAMED)
    rc, out = r.gate(PING, T0)
    n_ = notes(r)
    check(f'refused reply to {label} -> ONE notification, no recovery line (the watch is not restarted)',
          len(n_) == 1 and 'moderation-spinoff' in n_[0] and 'cannot wake it' in n_[0] and recovery_of(out) is None, (n_, out))
r = refusal_rig(trigger=MAIL_EVENT)
r.status(cache_expires_at=T0 + 50 * 60)                            # cache fresh: this tick is BLOCKED, not due
rc, out = r.gate(PING, T0)
check('a BLOCKED tick (cache fresh) still posts the notification for a new refusal',
      blocked(out) and 'fresh' in out and len(notes(r)) == 1, (out, notes(r)))
r = refusal_rig(trigger=MAIL_EVENT)
live = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)', 'mail-listen'])
try:
    r.touch(f'mail-listen-{SID8}.pid', f'{live.pid}\n')
    r.gate(PING, T0)
    n_ = notes(r)
    check('refusal with the mail watch still running -> notification without a watch sentence',
          len(n_) == 1 and 'mail watch' not in n_[0], n_)
finally:
    live.kill()
    live.wait()
r = refusal_rig()
r.touch(f'session-standby-{SID8}', '1 x')
r.gate(PING, T0)
check('a /standby seat -> its ticks are blocked before the transcript is read, no notification', notes(r) == [], notes(r))
r = due_rig()
r.gate(PING, T0)
check('no refusal -> no notification', notes(r) == [], notes(r))
r = refusal_rig(trigger=MAIL_EVENT)
r.gate(PING, T0)
r.gate('back now', T0 + 30)
note(r.tx, T0 + 40, MAIL_EVENT, promptSource='system')
note(r.tx, T0 + 41, SAFETY_NOTE, isMeta=True)
safety_refusal(r.tx, T0 + 50)
r.gate(PING, T0 + 60)
check('a NEW refusal later -> a second notification', len(notes(r)) == 2, notes(r))

# notify hardening (three review findings): a harness run that
# forgot the seam never reaches osascript, an empty seam is an off switch, and nothing on the notification path can
# change a tick's decision. Every arm here puts a fake osascript first on PATH, so even a mutant that loses the guard
# posts nothing real.
FAKE_BIN = tempfile.mkdtemp(prefix='kw-fakebin-', dir=RUN_ROOT)
with open(os.path.join(FAKE_BIN, 'osascript'), 'w') as _f:
    _f.write('#!/bin/sh\necho "$@" >> "${KW_OSA_LOG:-/dev/null}"\n')
os.chmod(os.path.join(FAKE_BIN, 'osascript'), 0o755)
r = refusal_rig(trigger=MAIL_EVENT)
osa = os.path.join(r.dir, 'osa.log')
env = dict(os.environ, FF_STATE_DIR=r.state, KEEP_WARM_NOW=str(T0), KEEP_WARM_LOG=r.log, CLAUDE_PROJECT_DIR=r.dir,
           PATH=FAKE_BIN + os.pathsep + os.environ['PATH'], KW_OSA_LOG=osa)
env.pop('KEEP_WARM_NOTIFY_CMD', None)
env.pop('SKIP_KEEP_WARM', None)
p = subprocess.run([sys.executable, GATE], input=json.dumps({'session_id': SID, 'prompt': PING, 'transcript_path': r.tx}),
                   capture_output=True, text=True, env=env, cwd=r.dir)
check('a harness run (FF_STATE_DIR set) with no KEEP_WARM_NOTIFY_CMD never reaches osascript',
      p.stdout.strip() == '' and not os.path.exists(osa), (p.stdout[-200:], os.path.exists(osa)))
r = refusal_rig(trigger=MAIL_EVENT)
osa = os.path.join(r.dir, 'osa.log')
proj = tempfile.mkdtemp(prefix='kw-proj-', dir=RUN_ROOT)
os.makedirs(os.path.join(proj, '.claude'))
os.symlink(r.state, os.path.join(proj, '.claude', 'state'))       # production shape: no FF_STATE_DIR, no fake clock
env = {k: v for k, v in os.environ.items() if k not in ('FF_STATE_DIR', 'KEEP_WARM_NOW', 'SKIP_KEEP_WARM')}
env.update(KEEP_WARM_NOTIFY_CMD='', CLAUDE_PROJECT_DIR=proj, KEEP_WARM_LOG=r.log,
           PATH=FAKE_BIN + os.pathsep + os.environ['PATH'], KW_OSA_LOG=osa)
p = subprocess.run([sys.executable, GATE], input=json.dumps({'session_id': SID, 'prompt': PING, 'transcript_path': r.tx}),
                   capture_output=True, text=True, env=env, cwd=r.dir)
check('an empty KEEP_WARM_NOTIFY_CMD is an off switch in a production-shaped run: nothing reaches osascript',
      'refusal_notice' in last_fire(r) and not os.path.exists(osa), (p.stdout[-200:], os.path.exists(osa)))
NUL_NAME = (lambda p: raw(p, {'type': 'custom-title', 'customTitle': 'mod\x00spin', 'sessionId': SID}),)
r = refusal_rig(before=NUL_NAME)
rc, out = r.gate(PING, T0)
check('a NUL in the session name -> the recovery ping still passes with its line (notify fails quietly)',
      rc == 0 and not blocked(out) and bool(recovery_of(out)), out)
r = refusal_rig(trigger=MAIL_EVENT, before=NUL_NAME)
r.status(cache_expires_at=T0 + 50 * 60)
rc, out = r.gate(PING, T0)
check('a NUL in the session name on a BLOCKED tick -> the block keeps its own reason and its fire line',
      blocked(out) and 'fresh' in out and 'gate error' not in out and os.path.exists(r.log)
      and last_fire(r).get('refusal_notice', {}).get('notified') is False, out)
r = refusal_rig(trigger=MAIL_EVENT)
raw(r.tx, {'type': 'user', 'timestamp': iso(T0 - 60), 'message': 'not a dict'})   # off-shape: read as an empty message
r.status(cache_expires_at=T0 + 50 * 60)
rc, out = r.gate(PING, T0)
check('an off-shape user record (message is a string) never changes the decision (the block keeps its own reason)',
      blocked(out) and 'fresh' in out and 'gate error' not in out and os.path.exists(r.log), out)
r = refusal_rig(trigger=MAIL_EVENT)
raw(r.tx, {'type': 'user', 'timestamp': iso(T0 - 70), 'message': {'role': 'user', 'content': 'and now?'}, 'promptSource': 'typed'})
raw(r.tx, {'type': 'assistant', 'timestamp': 1793990000, 'isApiErrorMessage': True,   # no usage: only the notice path reads it
           'message': {'stop_reason': 'refusal', 'content': [{'type': 'text', 'text': 'API Error'}]}})
r.status(cache_expires_at=T0 + 50 * 60)
rc, out = r.gate(PING, T0)
check('an exception on the notification path is caught and logged, and the block keeps its own reason (the decide() wrapper)',
      blocked(out) and 'fresh' in out and os.path.exists(r.log)
      and last_fire(r).get('refusal_notice', {}).get('error') == 'TypeError', out)

# the review hub re-arms with its own listener flags
r = refusal_rig()
r.touch(f'review-hub-active-{SID8}')
rc, out = r.gate(PING, T0)
check('review hub -> the recovery command carries --rebroadcast-hours 48',
      'mail-listen --poll 30 --rebroadcast-hours 48`' in (recovery_of(out) or ''), out)

# the /pause keep-warm window passes through the same recovery
r = refusal_rig()
r.touch(f'session-pause-{SID8}', '1')
r.touch(f'keep-warm-pause-{SID8}', str(int(T0 + 3600)))
rc, out = r.gate(PING, T0)
check('/pause keep-warm window -> the recovery line too (a paused seat keeps its listener on)', bool(recovery_of(out)), out)


# 16b. the tool block on a recovery ping (real clock): exactly the listener call, once
def deny_call(r, tool, tinput):
    p = {'session_id': SID, 'tool_name': tool, 'tool_input': tinput}
    env = {k: v for k, v in dict(os.environ, FF_STATE_DIR=r.state, CLAUDE_PROJECT_DIR=r.dir).items() if k != 'SKIP_KEEP_WARM'}
    x = subprocess.run(['bash', DENY], input=json.dumps(p), capture_output=True, text=True, env=env)
    return x.returncode, x.stdout.strip()


now_real = int(time.time())
r = refusal_rig(at=now_real)
rc, out = r.gate(PING, now_real)
m = re.search(r'command `([^`]+)`', recovery_of(out) or '')
cmd = m.group(1) if m else ''
listen = {'command': cmd, 'description': f'inbound session mail for {SID8}', 'timeout_ms': 1800000}
rc, out = deny_call(r, 'Bash', {'command': 'ls'})
check('recovery ping: a Bash call -> still DENIED', cmd != '' and '"permissionDecision":"deny"' in out, (cmd, out))
for bad, label in ((dict(listen, command=cmd + '; rm -rf /tmp/x'), 'a listener command with a chained command'),
                   (dict(listen, command='python3 scripts/other.py --poll 30'), 'another Monitor command'),
                   (dict(listen, ws={'url': 'wss://x'}), 'a Monitor call carrying a websocket')):
    rc, out = deny_call(r, 'Monitor', bad)
    check(f'recovery ping: {label} -> DENIED, marker kept', '"permissionDecision":"deny"' in out and rec_marker(r), out)
rc, out = deny_call(r, 'Monitor', listen)
check('recovery ping: the exact listener command the gate printed -> allowed, and it spends the marker',
      rc == 0 and out == '' and not rec_marker(r), (rc, out))
rc, out = deny_call(r, 'Monitor', listen)
check('recovery ping: the same call a second time -> DENIED', '"permissionDecision":"deny"' in out, out)
r = Rig()
r.touch(f'keep-warm-turn-{SID8}', f'{now_real}\n')
rc, out = deny_call(r, 'Monitor', listen)
check('ordinary ping (no recovery marker): the listener call -> DENIED (control)', '"permissionDecision":"deny"' in out, out)
r.touch(f'keep-warm-recovery-{SID8}', f'{now_real - 2000}\n')
rc, out = deny_call(r, 'Monitor', listen)
check('recovery marker older than 30 minutes -> DENIED', '"permissionDecision":"deny"' in out, out)
r.touch(f'keep-warm-recovery-{SID8}', f'{now_real}\n')
rc, out = deny_call(r, 'Monitor', dict(listen, command=f'cd {r.dir} && python3 scripts/session-manifest.py mail-listen --poll 30 --rebroadcast-hours 48'))
check('recovery ping: the review hub listener command -> allowed', rc == 0 and out == '', out)


def armed(turn_body, rec_body):
    x = Rig()
    x.touch(f'keep-warm-turn-{SID8}', turn_body)
    x.touch(f'keep-warm-recovery-{SID8}', rec_body)
    return x


LISTEN = 'python3 scripts/session-manifest.py mail-listen --poll 30'
x = armed(f'{now_real}\n', f'{now_real}\n')
rc, out = deny_call(x, 'Monitor', {'command': f'cd /tmp/elsewhere && {LISTEN}'})
check('recovery ping: the listener command from ANOTHER directory -> DENIED (the cd is pinned to the project root)',
      '"permissionDecision":"deny"' in out and rec_marker(x), out)
rc, out = deny_call(x, 'Monitor', {'command': LISTEN})
check('recovery ping: the bare listener command (no cd) -> allowed', rc == 0 and out == '', out)
x = armed(f'{now_real}\n', f'{now_real - 60}\n')
rc, out = deny_call(x, 'Monitor', {'command': LISTEN})
check('recovery marker from an EARLIER ping (epoch differs from the turn marker) -> DENIED', '"permissionDecision":"deny"' in out, out)
x = armed(f'{now_real}\n', f'{now_real}\n')
rc, out = deny_call(x, 'Bash', {'command': LISTEN})
check('recovery ping: a BASH call running the listener command -> DENIED', '"permissionDecision":"deny"' in out, out)
x = armed(f'{now_real + 600}\n', f'{now_real + 600}\n')
rc, out = deny_call(x, 'Monitor', {'command': LISTEN})
check('recovery and turn markers stamped 10 minutes in the future -> no allow path (the turn block reads them stale)',
      rc == 0 and out == '' and rec_marker(x), (rc, out))
for body in ('0\n', '0800\n', 'x\n'):
    x = armed(f'{now_real}\n', body)
    rc, out = deny_call(x, 'Monitor', {'command': LISTEN})
    check(f'recovery marker body {body.strip()!r} -> DENIED', '"permissionDecision":"deny"' in out, out)
# two racing calls on one marker: the rename lets exactly one through
races = []
for _ in range(10):
    x = armed(f'{now_real}\n', f'{now_real}\n')
    env = {k: v for k, v in dict(os.environ, FF_STATE_DIR=x.state, CLAUDE_PROJECT_DIR=x.dir).items() if k != 'SKIP_KEEP_WARM'}
    pl = json.dumps({'session_id': SID, 'tool_name': 'Monitor', 'tool_input': {'command': LISTEN}})
    procs = [subprocess.Popen(['bash', DENY], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, env=env) for _ in range(2)]
    for p in procs:              # feed both before reading either, so they run at the same time
        p.stdin.write(pl)
        p.stdin.close()
    outs = [p.stdout.read().strip() for p in procs]
    for p in procs:
        p.wait()
    races.append(sum(1 for o in outs if o == ''))
check('two racing listener calls on one recovery marker -> exactly one allowed, 10 of 10 rounds', races == [1] * 10, races)

# a review (its patch applied verbatim but for 2 hunks that only respelled
# STOP as 14): the queued-owner flag's two readers, the quiet walk's own owner stop, and the notice read after the decision
r = refusal_rig(trigger=EXPIRY_QUIET, before=(
    lambda p: note(p, A - 1800, EXPIRY_QUIET, promptSource='system'),
    lambda p: queued_owner(p, A - 1799, 'keep it running, I will write soon'),
    lambda p: said(p, A - 1795, 'Leaving it off.')))
rc, out = r.gate(PING, T0)
check('two quiet expiries with the owner queued between them -> not an idle seat, recovery',
      recovery_of(out) is not None and rec_marker(r), out)
r = bare_rig()
note(r.tx, A, 'please look at the hub verdict', promptSource='typed')
queued_owner(r.tx, A + 1, 'and the other one')
note(r.tx, A + 2, SAFETY_NOTE, isMeta=True)
safety_refusal(r.tx, A + 10)
rc, out = r.gate(PING, T0)
check('owner queued inside a refused turn -> still ONE notification (only the recovery reads the flag)',
      len(notes(r)) == 1 and recovery_of(out) is None, (notes(r), out))
r = refusal_rig(trigger='please look at the hub verdict')
note(r.tx, T0 - 10 * 60, PING + ', scheduled by this session.', promptSource='system', isMeta=True)
queued_owner(r.tx, T0 - 10 * 60 + 1, 'back soon')
said(r.tx, T0 - 10 * 60 + 3, '[keep-warm]')
rc, out = r.gate(PING, T0)
check('owner queued inside a LATER ping turn -> the refusal behind it still notifies', len(notes(r)) == 1, notes(r))
r = refusal_rig()
json.dump({'pings_since_owner': STOP}, open(os.path.join(r.state, f'keep-warm-{SID8}.json'), 'w'))
rc, out = r.gate(PING, T0)
check('stop-rule tick -> the notice never promises a ping will restart the watch',
      blocked(out) and len(notes(r)) == 1 and 'restarts it' not in notes(r)[0], (out, notes(r)))
r = refusal_rig(trigger='please look at the hub verdict')
raw(r.tx, {'type': 'attachment', 'timestamp': iso(T0 - 60), 'attachment': {'type': 'queued_command', 'origin': 'human'}})
r.status(cache_expires_at=T0 + 50 * 60)
rc, out = r.gate(PING, T0)
check('a record the walk cannot read -> the tick decides as without the notice (cache fresh), never a gate error',
      blocked(out) and 'fresh' in out, out)
r = refusal_rig()
raw(r.tx, {'type': 'attachment', 'timestamp': iso(T0 - 60), 'attachment': {'type': 'queued_command', 'origin': 'human'}})
rc, out = r.gate(PING, T0)
check('the same off-shape attachment on a DUE ping -> it still passes, never a gate error', rc == 0 and not blocked(out), out)
# from a later review: an unreadable record never earns a recovery and never raises on the notice path
for _o in ('human', None, ['human']):
    r = refusal_rig()
    raw(r.tx, {'type': 'attachment', 'timestamp': iso(T0 - 60), 'attachment': {'type': 'queued_command', 'commandMode': 'prompt',
                                                                               'prompt': 'leave it off', 'origin': _o}})
    rc, out = r.gate(PING, T0)
    check(f'a prompt-mode queued command with an unreadable origin ({_o!r}) after the refused expiry is the owner -> no recovery',
          rc == 0 and not blocked(out) and recovery_of(out) is None and not rec_marker(r), out)
r = bare_rig()   # the real shape of 406 of 16,953 task-notification queued commands (80 transcripts): no origin at all
note(r.tx, A, EXPIRY_BUSY, promptSource='system')
raw(r.tx, {'type': 'attachment', 'timestamp': iso(A + 1), 'attachment': {'type': 'queued_command', 'commandMode': 'task-notification',
                                                                         'prompt': '<task-notification>\n<task-id>z</task-id>\n</task-notification>'}})
note(r.tx, A + 2, SAFETY_NOTE, isMeta=True)
safety_refusal(r.tx, A + 10)
rc, out = r.gate(PING, T0)
check('a task-notification queued command with no origin inside the refused turn is not the owner -> recovery', bool(recovery_of(out)), out)
r = refusal_rig()
raw(r.tx, {'type': 'user', 'timestamp': iso(T0 - 60), 'message': 'not a dict'})
rc, out = r.gate(PING, T0)
fl = last_fire(r) if os.path.exists(r.log) else {'refusal_notice': {'error': 'no fire line'}}
check('a string-message user record after the refused expiry reads as a newer turn: pass, no recovery, no notice error (_msg)',
      rc == 0 and not blocked(out) and recovery_of(out) is None and 'error' not in fl.get('refusal_notice', {}), (out, fl))

# the house style for every block reason: subject, then detail; no parentheses, no semicolons
odd = sorted({x for x in BLOCK_REASONS if '(' in x or ';' in x})
check(f'every block reason seen ({len(BLOCK_REASONS)}) is in the house style, no parentheses or semicolons', len(BLOCK_REASONS) > 20 and not odd, odd)

print(f'\nkeep-warm gate arms: {"FAIL" if fails else "PASS"} ({fails} failing)')
sys.exit(1 if fails else 0)
