#!/usr/bin/env python3
"""Behavioural arms for .claude/hooks/auto-precompact-trigger.py, run against the REAL hook file in a subprocess
(never an inline copy of its logic) with a throwaway state dir and synthetic transcripts.

Run: python3 scripts/auto-precompact-trigger-test.py   (exit 0 = all pass; prints FAIL lines otherwise).
Wired into scripts/smoke-test-hooks.sh beside the keep-warm gate's runner.
"""
import json
import os
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(ROOT, '.claude', 'hooks', 'auto-precompact-trigger.py')
SID = 'apctest1-0000-0000-0000-000000000000'
SID8 = SID[:8]
THRESHOLD = 727_000
FAILS = []
PASSES = 0


def check(label, cond, got=None):
    global PASSES
    if cond:
        PASSES += 1
    else:
        FAILS.append(label)
        print(f'FAIL {label}' + (f' — got: {got!r}' if got is not None else ''))


def assistant(total, sidechain=False, output=0):
    return {'type': 'assistant', 'isSidechain': sidechain,
            'message': {'usage': {'input_tokens': 10, 'cache_read_input_tokens': total - 10 - output,
                                  'cache_creation_input_tokens': 0, 'output_tokens': output}}}


def write_transcript(path, records, pad_lines=0):
    with open(path, 'w') as f:
        for _ in range(pad_lines):              # bulk ahead of the newest assistant record
            f.write(json.dumps({'type': 'user', 'message': {'content': 'x' * 2000}}) + '\n')
        for r in records:
            f.write(json.dumps(r) + '\n')


def run(state, transcript, event='PostToolUse', extra=None, env_extra=None, raw=None):
    payload = {'session_id': SID, 'transcript_path': transcript, 'hook_event_name': event, 'cwd': ROOT}
    payload.update(extra or {})
    env = dict(os.environ, FF_STATE_DIR=state, AUTO_PRECOMPACT_LOG=os.path.join(state, 'fires.jsonl'),
               CLAUDE_PROJECT_DIR=state)  # the fleet relay reads <root>/.claude/logs: keep it off the real log
    env.pop('SKIP_AUTO_PRECOMPACT', None)
    env.pop('AUTO_PRECOMPACT_HEADROOM', None)
    env.update(env_extra or {})
    r = subprocess.run([sys.executable, HOOK], input=raw if raw is not None else json.dumps(payload),
                       capture_output=True, text=True, env=env, timeout=30)
    return r.returncode, r.stdout


def docs(out):
    """Every JSON document on stdout; a non-JSON line counts as a document that failed to parse."""
    found = []
    for line in out.splitlines():
        if line.strip():
            try:
                found.append(json.loads(line))
            except ValueError:
                found.append(None)
    return found


def statusline(state, threshold=THRESHOLD, context=None):
    with open(os.path.join(state, f'statusline-{SID8}.json'), 'w') as f:
        json.dump({'compact_threshold': threshold, 'context_tokens': context}, f)


def fired(state):
    return os.path.exists(os.path.join(state, f'auto-precompact-fired-{SID8}'))


def main():
    with tempfile.TemporaryDirectory() as tmp:
        state = os.path.join(tmp, 'state')
        os.makedirs(state)
        tx = os.path.join(tmp, 'tx.jsonl')
        statusline(state)
        near = THRESHOLD - 20_000                    # inside the 30,000 headroom
        far = THRESHOLD - 100_000                    # well below the line

        # 1. switched off: no fleet switch, no pilot marker
        write_transcript(tx, [assistant(near)])
        rc, out = run(state, tx)
        check('OFF: no switch, no pilot -> silent', rc == 0 and out == '', out)
        check('OFF: no marker written', not fired(state))

        pilot = os.path.join(state, f'auto-precompact-pilot-{SID8}')
        open(pilot, 'w').close()

        # 2. pilot, below the line
        write_transcript(tx, [assistant(far)])
        rc, out = run(state, tx)
        check('BELOW: 100k left -> silent', rc == 0 and out == '', out)

        # 3. pilot, inside the headroom -> exactly one document carrying the directive
        write_transcript(tx, [assistant(near)])
        rc, out = run(state, tx)
        d = docs(out)
        check('FIRE: inside headroom -> exactly one JSON document', rc == 0 and len(d) == 1 and d[0] is not None, out)
        ctx = (d[0] or {}).get('hookSpecificOutput', {}) if d and d[0] else {}
        check('FIRE: event name echoed', ctx.get('hookEventName') == 'PostToolUse', ctx)
        check('FIRE: directive names /pre-compact and the numbers',
              '/pre-compact' in ctx.get('additionalContext', '') and '707,000' in ctx.get('additionalContext', '')
              and '20,000 left' in ctx.get('additionalContext', ''), ctx.get('additionalContext'))
        check('FIRE: crossing marker written', fired(state))
        log = open(os.path.join(state, 'fires.jsonl')).read().splitlines()
        check('FIRE: one log row', len(log) == 1 and json.loads(log[0]).get('left') == 20_000, log)

        # 4. once per crossing
        rc, out = run(state, tx)
        check('ONCE: second call in the same crossing -> silent', rc == 0 and out == '', out)

        # 5. a compaction lands (context drops) -> re-armed, then the next crossing fires again
        write_transcript(tx, [assistant(60_000)])
        rc, out = run(state, tx)
        check('REARM: back below the line -> silent', out == '', out)
        check('REARM: crossing marker removed', not fired(state))
        write_transcript(tx, [assistant(THRESHOLD - 5_000)])
        rc, out = run(state, tx, event='UserPromptSubmit', extra={'prompt': 'carry on'})
        d = docs(out)
        check('REFIRE: next crossing fires on UserPromptSubmit', len(d) == 1 and d[0]
              and d[0]['hookSpecificOutput']['hookEventName'] == 'UserPromptSubmit', out)
        os.remove(os.path.join(state, f'auto-precompact-fired-{SID8}'))

        # 6. headroom edge: exactly 30,000 left fires, 30,001 does not
        write_transcript(tx, [assistant(THRESHOLD - 30_001)])
        rc, out = run(state, tx)
        check('EDGE: 30,001 left -> silent', out == '', out)
        write_transcript(tx, [assistant(THRESHOLD - 30_000)])
        rc, out = run(state, tx)
        check('EDGE: 30,000 left -> fires', len(docs(out)) == 1, out)
        os.remove(os.path.join(state, f'auto-precompact-fired-{SID8}'))

        # 7. past the compaction point still fires (a precomputed compaction may not have landed yet)
        write_transcript(tx, [assistant(THRESHOLD + 2_000)])
        rc, out = run(state, tx)
        check('PAST: beyond the point -> fires, left shown as 0', len(docs(out)) == 1 and ' 0 left' in out, out)
        os.remove(os.path.join(state, f'auto-precompact-fired-{SID8}'))

        # 8. a dispatched sub-agent never fires
        write_transcript(tx, [assistant(near)])
        rc, out = run(state, tx, extra={'agent_id': 'a1b2c3'})
        check('SUBAGENT: agent_id set -> silent', out == '' and not fired(state), out)

        # 9. a keep-warm ping stays a cheap read
        rc, out = run(state, tx, event='UserPromptSubmit',
                      extra={'prompt': '[keep-warm] automated cache keep-alive, scheduled by this session.'})
        check('PING: [keep-warm] prompt -> silent', out == '' and not fired(state), out)

        # 10. off-states
        rc, out = run(state, tx, env_extra={'SKIP_AUTO_PRECOMPACT': '1'})
        check('SKIP env -> silent', out == '', out)
        off = os.path.join(state, f'auto-precompact-off-{SID8}')
        open(off, 'w').close()
        rc, out = run(state, tx)
        check('OFF marker -> silent', out == '', out)
        os.remove(off)
        sb = os.path.join(state, f'session-standby-{SID8}')
        open(sb, 'w').close()
        rc, out = run(state, tx)
        check('STANDBY marker -> silent', out == '', out)
        os.remove(sb)

        # 11. the fleet switch alone switches it on
        os.remove(pilot)
        open(os.path.join(state, 'auto-precompact-enabled'), 'w').close()
        rc, out = run(state, tx)
        check('FLEET switch -> fires', len(docs(out)) == 1, out)
        os.remove(os.path.join(state, f'auto-precompact-fired-{SID8}'))
        os.remove(os.path.join(state, 'auto-precompact-enabled'))
        open(pilot, 'w').close()

        # 12. sidechain records are not the session's context
        write_transcript(tx, [assistant(far), assistant(THRESHOLD - 1_000, sidechain=True)])
        rc, out = run(state, tx)
        check('SIDECHAIN: a newer sidechain record near the line is ignored', out == '', out)

        # 13. the newest main record wins, and output tokens count
        write_transcript(tx, [assistant(near), assistant(far)])
        rc, out = run(state, tx)
        check('NEWEST: the last main record decides (older near-line record ignored)', out == '', out)
        write_transcript(tx, [assistant(THRESHOLD - 35_000 + 10_000, output=10_000)])
        rc, out = run(state, tx)
        check('OUTPUT: a reply\'s output tokens count toward the size', len(docs(out)) == 1, out)
        os.remove(os.path.join(state, f'auto-precompact-fired-{SID8}'))

        # 14. a long transcript: the newest record sits behind more than one tail chunk of padding
        write_transcript(tx, [assistant(far)] , pad_lines=0)
        with open(tx, 'a') as f:
            f.write(json.dumps(assistant(near)) + '\n')
            for _ in range(400):                # ~800 KB of non-assistant records after it
                f.write(json.dumps({'type': 'user', 'message': {'content': 'y' * 2000}}) + '\n')
        rc, out = run(state, tx)
        check('TAIL: newest assistant record found behind 800 KB of later records', len(docs(out)) == 1, out)
        os.remove(os.path.join(state, f'auto-precompact-fired-{SID8}'))

        # 15. fails open and silent
        rc, out = run(state, tx, raw='not json')
        check('BAD INPUT: unparseable stdin -> exit 0, silent', rc == 0 and out == '', (rc, out))
        os.remove(os.path.join(state, f'statusline-{SID8}.json'))
        rc, out = run(state, tx)
        check('NO STATUS FILE: no compaction point -> silent', rc == 0 and out == '', out)
        statusline(state)
        rc, out = run(state, os.path.join(tmp, 'missing.jsonl'))
        check('NO TRANSCRIPT, status context unset -> silent', rc == 0 and out == '', out)
        statusline(state, context=near)          # same reading, written 10 minutes ago: past STATUS_FRESH_S
        stale = time.time() - 600
        os.utime(os.path.join(state, f'statusline-{SID8}.json'), (stale, stale))
        rc, out = run(state, os.path.join(tmp, 'missing.jsonl'))
        check('NO TRANSCRIPT: a status-line reading older than STATUS_FRESH_S -> silent',
              rc == 0 and out == '' and not fired(state), out)
        if fired(state):                         # under a mutant: clear it, so only this arm reds
            os.remove(os.path.join(state, f'auto-precompact-fired-{SID8}'))
        statusline(state, context=near)
        rc, out = run(state, os.path.join(tmp, 'missing.jsonl'))
        check('NO TRANSCRIPT: falls back to a fresh status-line reading', len(docs(out)) == 1, out)
        os.remove(os.path.join(state, f'auto-precompact-fired-{SID8}'))

        # 16. the headroom override
        write_transcript(tx, [assistant(THRESHOLD - 40_000)])
        statusline(state)
        rc, out = run(state, tx, env_extra={'AUTO_PRECOMPACT_HEADROOM': '50000'})
        check('OVERRIDE: AUTO_PRECOMPACT_HEADROOM=50000 widens the line', len(docs(out)) == 1, out)

    print(f'auto-precompact-trigger: {PASSES} passed, {len(FAILS)} failed')
    return 1 if FAILS else 0


if __name__ == '__main__':
    sys.exit(main())
