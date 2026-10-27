#!/usr/bin/env python3
"""Behavioural arms for .claude/hooks/this-turn-claim-warn.py, run against the REAL hook file in a subprocess
(never an inline copy of its logic) with a throwaway state dir, a throwaway ledger and synthetic transcripts.

Run: python3 scripts/this-turn-claim-warn-test.py   (exit 0 = all pass; prints FAIL lines otherwise).
Wired into scripts/smoke-test-hooks.sh beside the auto-precompact trigger's runner.

Arms (each a separate transcript):
  1. /eli5 turn, a this-turn claim, 0 tool calls      -> FIRES: stderr line, 1 ledger row, marker written
  2. same claim, 1 tool_use before the reply           -> silent (the claim is backed)
  3. a NEGATED claim ("I have not checked this turn")   -> silent
  4. the claim in a turn that is NOT /eli5 or /explain -> silent (out of scope by construction)
  5. UserPromptSubmit with the marker from arm 1        -> ONE JSON doc quoting the sentence; marker removed;
     a second UserPromptSubmit                          -> silent (surfaced once)
  6. arm 1's transcript with agent_id set              -> silent (never for a sub-agent)
  7. /explain turn, "just now" + "re-derived"           -> FIRES (the second time-phrase and a hyphenated verb)
  8. the claim sits in an EARLIER text block, then a tool runs, then the reply -> silent (tools counted over the turn)
  9. THIS_TURN_CLAIM_MODE=block: a JSON block decision at exit 0, no marker; a continuation is never blocked
 10. the 2 founding texts verbatim (negation in ANOTHER clause of the sentence) -> both fire
 11. a sidechain user record after the command does not move the turn start
 12. 6 honest disclosures ("No check ran this turn", "Nothing was checked this turn", ...) and 2 quoted phrases -> silent
The hook's env is built fresh per arm: THIS_TURN_CLAIM_MODE from the live settings is popped and set only by `mode=`
(2026-10-25: with block mode in the settings env the arms inherited it and read 16/4).
Mutation to run by hand when the predicate changes: blank VERB_RE's alternatives -> arms 1, 5, 7, 9, 10 and 11 go red
(12 of 31 checks); drop no/nothing/none/zero from NEG_RE -> arms 12a-12f; stop blanking quoted spans -> 12g and 12h.
"""
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(ROOT, '.claude', 'hooks', 'this-turn-claim-warn.py')
SID = 'ttctest1-0000-0000-0000-000000000000'
SID8 = SID[:8]
FAILS = []
PASSES = 0


def check(label, cond, got=None):
    global PASSES
    if cond:
        PASSES += 1
    else:
        FAILS.append('FAIL: %s%s' % (label, '' if got is None else ' (got %r)' % (got,)))


def user(content, uuid='u1'):
    return {'type': 'user', 'uuid': uuid, 'timestamp': '2026-10-25T23:00:00.000Z',
            'message': {'role': 'user', 'content': content}}


def assistant(blocks, uuid='a1'):
    return {'type': 'assistant', 'uuid': uuid, 'timestamp': '2026-10-25T23:00:05.000Z',
            'message': {'role': 'assistant', 'content': blocks}}


def text(t):
    return {'type': 'text', 'text': t}


def tool(name='Bash'):
    return {'type': 'tool_use', 'id': 'toolu_x', 'name': name, 'input': {'command': 'true'}}


def tool_result():
    return user([{'type': 'tool_result', 'tool_use_id': 'toolu_x', 'content': 'ok'}], uuid='tr')


CMD_ELI5 = '<command-message>eli5</command-message>\n<command-name>/eli5</command-name>\n<command-args>x</command-args>'
CMD_EXPLAIN = '<command-message>explain</command-message>\n<command-name>/explain</command-name>'
CLAIM = '[eli5] Where we stand. I re-checked the federation wording myself this turn and it still says the same thing.'


def run(records, event, state, log, agent_id=None, mode=None, extra=None):
    with tempfile.NamedTemporaryFile('w', suffix='.jsonl', delete=False) as f:
        for r in records:
            f.write(json.dumps(r) + '\n')
        tpath = f.name
    payload = {'session_id': SID, 'transcript_path': tpath, 'hook_event_name': event, 'cwd': ROOT}
    if agent_id:
        payload['agent_id'] = agent_id
    payload.update(extra or {})
    env = dict(os.environ, FF_STATE_DIR=state, THIS_TURN_CLAIM_LOG=log, CLAUDE_PROJECT_DIR=ROOT)
    env.pop('SKIP_THIS_TURN_CLAIM_WARN', None)
    env.pop('THIS_TURN_CLAIM_MODE', None)  # the live settings env must not decide which mode an arm tests
    if mode:
        env['THIS_TURN_CLAIM_MODE'] = mode
    p = subprocess.run([sys.executable, HOOK], input=json.dumps(payload), capture_output=True, text=True, env=env)
    os.unlink(tpath)
    return p


def ledger_rows(log):
    if not os.path.isfile(log):
        return []
    with open(log) as f:
        return [json.loads(l) for l in f if l.strip()]


def fresh():
    d = tempfile.mkdtemp(prefix='ttc-')
    return d, os.path.join(d, 'fires.jsonl'), os.path.join(d, 'this-turn-claim-' + SID8)


def main():
    # 1 — fires
    state, log, marker = fresh()
    p = run([user('earlier prompt', 'u0'), assistant([text('old reply')], 'a0'), user(CMD_ELI5),
             user([text('expanded skill body')], 'ux'), assistant([text(CLAIM)])], 'Stop', state, log)
    check('arm 1: exit 0', p.returncode == 0, p.returncode)
    check('arm 1: stdout empty on Stop (no JSON doc)', p.stdout.strip() == '', p.stdout)
    check('arm 1: stderr names the claim', 'this-turn-claim-warn' in p.stderr and 'federation' in p.stderr, p.stderr)
    rows = ledger_rows(log)
    check('arm 1: one ledger row', len(rows) == 1, len(rows))
    check('arm 1: row carries command, 0 tools, the sentence',
          rows and rows[0].get('command') == 'eli5' and rows[0].get('tool_calls') == 0
          and 'this turn' in rows[0]['claims'][0]['sentence'], rows)
    check('arm 1: marker written', os.path.isfile(marker))
    marker_state = state

    # 2 — backed by a tool call
    state, log, marker = fresh()
    p = run([user(CMD_ELI5), assistant([tool()], 'a1'), tool_result(), assistant([text(CLAIM)], 'a2')], 'Stop', state, log)
    check('arm 2: silent when a tool ran', p.stderr == '' and not ledger_rows(log) and not os.path.isfile(marker), p.stderr)

    # 3 — negated
    state, log, marker = fresh()
    p = run([user(CMD_ELI5), assistant([text('[eli5] I have not checked the federation wording this turn; this is from memory.')])],
            'Stop', state, log)
    check('arm 3: silent on a negated claim', p.stderr == '' and not ledger_rows(log), p.stderr)

    # 4 — out of scope
    state, log, marker = fresh()
    p = run([user('tell me where we stand'), assistant([text(CLAIM)])], 'Stop', state, log)
    check('arm 4: silent outside /eli5 and /explain', p.stderr == '' and not ledger_rows(log), p.stderr)

    # 5 — surfaced once on the next prompt
    state = marker_state
    log = os.path.join(state, 'fires.jsonl')
    p = run([user('next prompt')], 'UserPromptSubmit', state, log)
    doc = None
    try:
        doc = json.loads(p.stdout)
    except Exception:
        pass
    ctx = (doc or {}).get('hookSpecificOutput', {}).get('additionalContext', '') if doc else ''
    check('arm 5: one JSON document on the next prompt', doc is not None and p.stdout.count('hookSpecificOutput') == 1, p.stdout)
    check('arm 5: it quotes the claim sentence and names 0 tool calls', 'federation' in ctx and '0 tool calls' in ctx, ctx)
    check('arm 5: marker removed', not os.path.isfile(os.path.join(state, 'this-turn-claim-' + SID8)))
    p2 = run([user('another prompt')], 'UserPromptSubmit', state, log)
    check('arm 5: silent the second time', p2.stdout.strip() == '', p2.stdout)

    # 6 — sub-agent
    state, log, marker = fresh()
    p = run([user(CMD_ELI5), assistant([text(CLAIM)])], 'Stop', state, log, agent_id='agent-123')
    check('arm 6: silent for a sub-agent', p.stderr == '' and not ledger_rows(log), p.stderr)

    # 7 — /explain, "just now", hyphenated verb
    state, log, marker = fresh()
    p = run([user(CMD_EXPLAIN), assistant([text('[explain] The row is current: I re-derived the count just now.')])], 'Stop', state, log)
    rows = ledger_rows(log)
    check('arm 7: fires on /explain with "just now" + "re-derived"', len(rows) == 1 and rows[0].get('command') == 'explain', rows)

    # 8 — claim in an earlier block, a tool later in the turn: tools counted over the whole turn
    state, log, marker = fresh()
    p = run([user(CMD_ELI5), assistant([text(CLAIM)], 'a1'), assistant([tool()], 'a2'), tool_result(),
             assistant([text('[eli5] done.')], 'a3')], 'Stop', state, log)
    check('arm 8: silent when any tool ran in the turn', not ledger_rows(log), ledger_rows(log))

    # 9 — block mode: a JSON block decision at exit 0, marker removed; a continuation (stop_hook_active) is never blocked
    state, log, marker = fresh()
    p = run([user(CMD_ELI5), assistant([text(CLAIM)])], 'Stop', state, log, mode='block')
    doc = None
    try:
        doc = json.loads(p.stdout)
    except Exception:
        pass
    check('arm 9: block mode exits 0 with a JSON block decision quoting the claim',
          p.returncode == 0 and doc is not None and doc.get('decision') == 'block' and 'federation' in doc.get('reason', ''),
          (p.returncode, p.stdout))
    check('arm 9: block mode leaves no next-prompt marker', not os.path.isfile(marker))
    p = run([user(CMD_ELI5), assistant([text(CLAIM)])], 'Stop', state, log, mode='block',
            extra={'stop_hook_active': True})
    check('arm 9: a continuation (stop_hook_active) is never blocked, never re-logged, leaves no marker', p.returncode == 0 and p.stdout.strip() == '' and len(ledger_rows(log)) == 1 and not os.path.isfile(marker), (p.returncode, p.stdout, len(ledger_rows(log)), os.path.isfile(marker)))

    # 10 — the two founding texts verbatim: the negation sits in ANOTHER clause of the same sentence, so these are
    # the only arms that go red if the negation test widens to the sentence or CLAUSE_SPLIT stops splitting
    for n, t in [('10a', '[eli5] I re-checked the federation wording myself this turn; the society I did not.'),
                 ('10b', "**Updating the copy isn't a text edit; it's a whole procedure.** I read it this turn:")]:
        state, log, marker = fresh()
        run([user(CMD_ELI5), assistant([text(t)])], 'Stop', state, log)
        check('arm %s: fires on the founding text (negation in another clause)' % n, len(ledger_rows(log)) == 1, ledger_rows(log))

    # 11 — a sidechain user record with string content after the command does not move the turn start
    state, log, marker = fresh()
    side = dict(user('sub-agent prompt', 'us'), isSidechain=True)
    run([user(CMD_ELI5), side, assistant([text(CLAIM)])], 'Stop', state, log)
    check('arm 11: a sidechain user record does not end the /eli5 turn', len(ledger_rows(log)) == 1, ledger_rows(log))

    # 12 — the honest disclosures the Iron rule asks for stay silent (without
    # no/nothing/none/zero in NEG_RE all 6 fired, and in block mode each forced a continuation), and a quoted
    # claim is a mention, never this reply's claim (QUOTED_RE)
    for n, t in [('12a', 'No check ran this turn; this is from memory.'),
                 ('12b', 'Nothing was checked this turn.'),
                 ('12c', 'I ran nothing this turn, so treat it as unverified.'),
                 ('12d', 'No tool ran this turn.'),
                 ('12e', 'Zero tools ran this turn.'),
                 ('12f', 'None of this was re-read this turn.'),
                 ('12g', 'The panel quoted "I re-checked the federation wording myself this turn" as the first case.'),
                 ('12h', 'This turn the owner typed "I read it again" under the page.'),
                 ('12i', 'The seat wrote \u201cI read it this turn\u201d in its reply.'),
                 ('12j', 'The hook matches `I checked this turn` literally.')]:
        state, log, marker = fresh()
        run([user(CMD_ELI5), assistant([text('[eli5] ' + t)])], 'Stop', state, log)
        check('arm %s: silent on %r' % (n, t), not ledger_rows(log), ledger_rows(log))

    # 13 — no / none / nothing / zero AFTER the check verb state the check's RESULT, not its absence, so the claim
    # still fires (the 2 genuine claims an earlier fold lost over the 60 newest transcripts)
    for n, t in [('13a', 'I grepped the tree this turn and found no other callers.'),
                 ('13b', 'I checked this turn and none of our 3 test critiques has a sentence like that.'),
                 ('13c', 'The origin record has no entry for it (checked this turn).')]:
        state, log, marker = fresh()
        run([user(CMD_ELI5), assistant([text('[eli5] ' + t)])], 'Stop', state, log)
        check('arm %s: fires on %r' % (n, t), len(ledger_rows(log)) == 1, ledger_rows(log))

    # control: a corrupt payload never fails
    p = subprocess.run([sys.executable, HOOK], input='not json', capture_output=True, text=True)
    check('control: garbage stdin exits 0 with no output', p.returncode == 0 and p.stdout == '' and p.stderr == '', (p.returncode, p.stdout, p.stderr))

    for f in FAILS:
        print(f)
    print('this-turn-claim-warn-test: %d passed, %d failed' % (PASSES, len(FAILS)))
    return 1 if FAILS else 0


if __name__ == '__main__':
    sys.exit(main())
