#!/usr/bin/env python3
"""Behavioural arms for the /pause resume-in-words net in .claude/hooks/standby-resume-check.sh (2026-10-25).

The founding case: a paused session was resumed in words (a /summary followed by a resume), the pause
marker stayed and 4 commits landed under it. The hook now directs `/pause resume` when this session's pause marker exists and his
message reads as a resume. Runs the hook under /bin/bash (3.2, as the harness does) against a throwaway
state dir, so it never touches the live .claude/state. One line per arm; exits 1 on any failure.
"""
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.environ.get('SRC_HOOK_PATH') or os.path.join(ROOT, '.claude', 'hooks', 'standby-resume-check.sh')
SID = 'SMKPAUSE-0000-1111'
SID8 = 'smkpause'
PAUSE_DIRECTIVE = 'Run `/pause resume` through the Skill tool'
fails = 0
passes = 0


def check(name, ok, detail=''):
    global fails, passes
    if ok:
        passes += 1
        print(f'PASS  {name}')
    else:
        fails += 1
        print(f'FAIL  {name}  {detail}')


def run(state, prompt, sid=SID):
    env = dict(os.environ, FF_STATE_DIR=state, CLAUDE_PROJECT_DIR=ROOT)
    env.pop('SKIP_STANDBY_RESUME_CHECK', None)
    p = subprocess.run(['/bin/bash', HOOK], input=json.dumps({'session_id': sid, 'prompt': prompt}),
                       capture_output=True, text=True, env=env, timeout=30)
    return p.returncode, p.stdout, p.stderr


def context(out):
    """The additionalContext of exactly ONE JSON document, or None when stdout is not exactly one."""
    try:
        return json.loads(out)['hookSpecificOutput']['additionalContext']
    except (ValueError, KeyError, TypeError):
        return None


def main():
    rc = subprocess.run(['/bin/bash', '-n', HOOK], capture_output=True, text=True)
    check('the hook parses under /bin/bash 3.2', rc.returncode == 0, rc.stderr.strip())

    with tempfile.TemporaryDirectory() as state:
        pause = os.path.join(state, f'session-pause-{SID8}')
        standby = os.path.join(state, f'session-standby-{SID8}')
        with open(pause, 'w') as f:
            f.write('1791547195 deadbeef resume=owner wo=none builders=none\n')
        smoke_log = os.path.join(ROOT, '.claude', 'logs', 'pause-resume-words-fires.smoke.jsonl')
        live_log = os.path.join(ROOT, '.claude', 'logs', 'pause-resume-words-fires.jsonl')

        def count(path):
            try:
                with open(path) as f:
                    return sum(1 for line in f if f'"session":"{SID8}"' in line)
            except FileNotFoundError:
                return 0
        smoke0, live0 = count(smoke_log), count(live_log)
        sb_log = os.path.join(ROOT, '.claude', 'logs', 'standby-resume-fires.smoke.jsonl')
        sb0 = count(sb_log)

        # Measured resume phrasings, the spec's own list, and the founding /summary form: each must direct.
        fire = ['resume', 'Resume now.', 'continue', "let's resume", "and let's resume", 'continue the work',
                "/summary and let's resume", 'ok, let’s resume', 'resume, and then fix the red test',
                "let's resume and then go through the open review verdicts one at a time please",
                'let’s resume and then go through the open review verdicts one at a time please',
                "our limtis have reset, let's resume work as planned",
                "our limtis have reset, let's resume as usual, pause is lifted",
                "our limits have reset and the pause is lifted, so go through the open review verdicts one at a time please",
                "/summary resume the work and then go through the open review verdicts one at a time please"]
        for p in fire:
            code, out, err = run(state, p)
            ctx = context(out)
            check(f'FIRE: pause marker + {p!r} -> one JSON document carrying the directive',
                  code == 0 and ctx is not None and PAUSE_DIRECTIVE in ctx and f'session-pause-{SID8}' in ctx,
                  f'rc={code} out={out[:120]!r}')
            check(f'FIRE: {p!r} -> stderr silent', err == '', err[:200])
        check('FIRE: the directive names the paused-since time from the marker epoch',
              '2026-10-09T11:59Z' in (context(run(state, 'resume')[1]) or ''))

        # The skill parses its own command; the hook must not add a second directive.
        silent = [('/pause resume', 'the typed command is handled by the skill'),
                  ('/pause --resume', 'a bare --resume is handled by the skill'),
                  ('/pause --resume at 14:00', 'a new timed pause'),
                  ('[keep-warm] automated cache keep-alive', 'a keep-warm ping is not his words'),
                  ('Auto resume', 'a harness resume line is not his words'),
                  ('Your claude.ai usage limit has reset. Continue the task', 'a usage-limit reset line'),
                  ('<task-notification>\n<task-id>b1</task-id> resume', 'a task notification'),
                  ('[Owner-authorized autonomous run] resume the work order', 'an /autorun one-shot runs /pause resume itself'),
                  ('fix the resume parser in scripts/foo.py and then rerun the integration tier and report back', 'the word mid-way through a longer instruction'),
                  ('continue ' + ' '.join(['the long story about the lens and the light'] * 4), 'a long message that only opens with the word'),
                  ('this is a long note about the client brief and the cover letter and my resume', 'a long message that only ends with the word'),
                  ('hi', 'an ordinary message'),
                  ('/summary', 'a command with no words after it'),
                  ("the agent said let's resume once the limits reset but i want you to hold until i say so explicitly", "let's resume inside a message over 15 words"),
                  ("you can also respond when these experts finish but don't take new work until the pause is lifted", 'a hold that names the lift as a later condition'),
                  ("don't lift the pause yet", 'a negation right before the lift phrase'),
                  ('do not unpause, keep holding', 'a two-word negation right before unpause'),
                  ('keep holding until i lift the pause', 'a hold with a subject between until and the lift phrase'),
                  ('our limits have reset and the pause is lifted, so please go through the open review verdicts one at a time and write each fold into the plan before you mail', 'a lift phrase in a message over 25 words')]
        for p, why in silent:
            code, out, err = run(state, p)
            check(f'SAFE: pause marker + {p[:40]!r} -> nothing ({why})', code == 0 and out == '' and err == '',
                  f'rc={code} out={out[:120]!r} err={err[:120]!r}')

        code, out, _ = run(state, 'resume', sid='OTHERSID-2222')
        check('SAFE: no pause marker for this session + "resume" -> nothing', code == 0 and out == '', out[:120])

        check('LOG: a pause-only seat writes no standby fire line', count(sb_log) == sb0, f'+{count(sb_log) - sb0}')

        # Both markers: ONE document, the standby resume first (pause/SKILL.md resume step 0).
        with open(standby, 'w') as f:
            f.write('1791547195 deadbeef\n')
        code, out, err = run(state, 'resume')
        ctx = context(out)
        ok = ctx is not None and 'STANDBY' in ctx and PAUSE_DIRECTIVE in ctx
        check('BOTH: standby + pause markers + "resume" -> exactly one JSON document carrying both', ok and code == 0,
              f'out={out[:160]!r}')
        check('BOTH: the standby directive comes first, the pause one after it',
              ok and ctx.startswith('\u23f8 STANDBY') and ctx.index('\u23f8 STANDBY') < ctx.index('\u23ef PAUSE')
              and 'AFTER that `/standby resume`' in ctx)
        code, out, _ = run(state, '[keep-warm] automated cache keep-alive')
        ctx = context(out) or ''
        check('BOTH: standby + pause + keep-warm ping -> the stay-parked standby line only, no pause directive',
              'NOT the owner' in ctx and PAUSE_DIRECTIVE not in ctx, out[:160])
        code, out, _ = run(state, 'hi')
        ctx = context(out) or ''
        check('BOTH: standby + pause + "hi" -> the standby directive only (the pause holds)',
              'THIS PROMPT ENDS IT' in ctx and PAUSE_DIRECTIVE not in ctx, out[:160])
        os.remove(pause)
        code, out, _ = run(state, 'resume')
        ctx = context(out) or ''
        check('STANDBY ONLY: + "resume" -> the standby directive, no pause directive',
              'THIS PROMPT ENDS IT' in ctx and PAUSE_DIRECTIVE not in ctx, out[:160])

        check('LOG: fires went to the smoke log, never the live one',
              count(smoke_log) - smoke0 == len(fire) + 2 and count(live_log) == live0,
              f'smoke +{count(smoke_log) - smoke0}, live +{count(live_log) - live0}')

    print(f'\n{passes} passed, {fails} failed')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
