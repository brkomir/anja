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
        self.dir = tempfile.mkdtemp(prefix='kw-gate-test-')
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
                   CLAUDE_PROJECT_DIR=self.dir)
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
for gap, want_block, label in ((20, True, 'fresh 20m'), (31, False, 'edge 31m'), (46, False, '46m'), (59, True, 'cold 59m')):
    r = due_rig(gap_min=gap)
    rc, out = r.gate(PING, T0)
    check(f'gap {label} -> {"BLOCK" if want_block else "PASS"}', blocked(out) == want_block, out)

# 3b. countdown (status line cache_expires_at) decides when present
for left_min, want_block, label in ((8, False, '8m left'), (18, False, '18m left (inside the 19m window)'), (21, True, '21m left (outside it)'), (20, True, '20m left'), (-1, True, 'countdown at zero'), (0.5, True, '30s left'),
                                  (19, False, '19m left exactly (the 1..19 window is inclusive)'), (18.5, False, '18m30s left'),
                                  (1, False, '60s left exactly (inclusive)'), (1.5, False, '90s left')):
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
STOP = 14   # the gate's KEEP_WARM_STOP_PINGS default: pings stop after about 12 hours without an owner prompt
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
for label, status in (('usage 100%', {'five_hour_pct': 100}), ('countdown 20m left', {'cache_expires_at': T0 + 20 * 60})):
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
proj = tempfile.mkdtemp(prefix='kw-gate-proj-')
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
    root = tempfile.mkdtemp(prefix='kw-ss-test-')
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

# the house style for every block reason: subject, then detail; no parentheses, no semicolons
odd = sorted({x for x in BLOCK_REASONS if '(' in x or ';' in x})
check(f'every block reason seen ({len(BLOCK_REASONS)}) is in the house style, no parentheses or semicolons', len(BLOCK_REASONS) > 20 and not odd, odd)

print(f'\nkeep-warm gate arms: {"FAIL" if fails else "PASS"} ({fails} failing)')
sys.exit(1 if fails else 0)
