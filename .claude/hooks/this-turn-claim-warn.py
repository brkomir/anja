#!/usr/bin/env python3
"""Stop + UserPromptSubmit hook — flag a reply that says it checked something "this turn" when no tool ran.

Prevents: NEW class — a plain-English answer (/eli5, /explain) claims a this-turn check with 0 tool calls before
the reply. The /eli5 Iron rule says every claim is derived in that invocation or marked unverified in its own
sentence; the plain register strips the apparatus the owner would check the claim with, so a false "I re-checked
it this turn" is unfalsifiable on his side. Measured 2026-10-25 over the 35 post-fold /eli5 answers that claimed
a this-turn check: 2 had 0 tool calls before the reply (2026-10-18, 35 s after the command: "I re-checked the federation
wording myself this turn"; 2026-10-23, 19 s: "I read it this turn"). Pre-fold 1 of 138.

SCOPE — a guard against one measured habit, not a lie detector. It keys on the 2 time phrases (this turn / just
now) beside a check verb; a false claim worded any other way ("I verified the count", "I re-read the file") passes.
Measured 2026-10-25 before deciding: over the 60
newest transcripts, 204 in-scope /eli5 and /explain answers, 12 with 0 tool calls; this predicate fires on 2 (the
founding cases); a widened first-person check-verb predicate (any "I checked/read/ran…" with no past marker, no
negation, no quote) adds 1 hit, hand-read as a TRUE past reference (2026-10-14: the test it names
ran in the previous turn, 12 tool calls) — 0 new true cases, 1 false alarm per 12, and in block mode a false alarm
costs a forced model turn. So the predicate stays narrow by decision. RE-MEASURE at the next large batch of
command-spec changes (or on the first false claim found worded without the 2 phrases): re-run that count; if the
widened predicate finds a true case the narrow one missed, widen it then, with the hit as the test arm.

The choice was between accepting the measured rate and a hook that reads the reply's own record; the hook was
chosen. It is an exception to the standing rule against new written enforcement of verify-before-assert: this is
code reading the record, not prose.

What it reads (Stop): the session transcript's last turn — from the newest user record whose content is a STRING
(a typed prompt, a slash command, a queued prompt; tool results and the skill expansion are lists) to the end.
In scope only when that record carries `<command-name>/eli5` or `<command-name>/explain` (the measured population;
every other turn is out of scope so the predicate cannot fire on ordinary prose). It counts the turn's assistant
`tool_use` blocks and scans the turn's assistant text blocks sentence by sentence for a CLAIM: a sentence with
"this turn" / "just now" and a check verb (the words in VERB_RE) and no negation in the same clause (NEG_RE
anywhere in it; no / nothing / none / zero only before the verb or as the word right after it, since later in
the clause they state the check's result: WEAK_NEG_RE), read with its quoted and backtick spans blanked, since a
quoted phrase is a mention and not this reply's claim (QUOTED_RE). 0 tool calls AND at least 1 claim ⇒ a fire: one
line on stderr (Claude Code draws a Stop hook's output nowhere for the owner, so this is for the log), one ledger
row, and a marker for the next prompt.

What it does (UserPromptSubmit): if the marker exists, it puts one line in the seat's context naming the claim
sentence and the record, through hookSpecificOutput.additionalContext (the one channel the model reads), and
removes the marker. So the seat that wrote the claim meets it on its next turn, with the sentence quoted.

Warn-mode by default (session-cadence.md § PROMOTING WARN → BLOCK): it never blocks, every path exits 0, at most one
JSON document on stdout. THIS_TURN_CLAIM_MODE=block (settings env block; on since 2026-10-25;
that env reached already-running sessions' Bash tool without a relaunch, and whether a running session's hooks see it
is untested) makes a Stop fire print {"decision":"block","reason":…} (still exit 0), which Claude Code feeds back to
the seat and keeps the turn going, so the correction lands right under the reply in the same turn; it never blocks a
continuation (stop_hook_active) and never blocks the UserPromptSubmit side. Never fires for a dispatched sub-agent
(agent_id set). The classifier is a regex, so the ledger is a FLOOR and every fire is read by hand before it counts
toward anything (the use-vs-mention split).
Ledger: .claude/logs/this-turn-claim-fires.jsonl (…fires.smoke.jsonl under CLAUDE_HOOK_SMOKE;
THIS_TURN_CLAIM_LOG overrides). Marker: <state>/this-turn-claim-<sid8>. Tests point FF_STATE_DIR at a throwaway
state dir and run the real file: scripts/this-turn-claim-warn-test.py. Off: SKIP_THIS_TURN_CLAIM_WARN=1.
"""
import datetime
import json
import os
import re
import sys

IN_SCOPE = ('<command-name>/eli5', '<command-name>/explain')
TIME_RE = re.compile(r"\b(this turn|just now)\b", re.I)
VERB_RE = re.compile(
    r"\b(re-?checked|checked|re-?read|read|ran|re-?derived|derived|measured|grepped|verified|counted|confirmed|"
    r"looked|opened|re-?ran)\b", re.I)
NEG_RE = re.compile(r"\b(not|never|unverified|unchecked|haven't|hasn't|didn't|did not|have not|has not|cannot|can't)\b|n't\b", re.I)
SENT_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")
CLAUSE_SPLIT = re.compile(r"\s*[;:,()]\s*|\s+[—–]\s+|\s+-\s+")
TAIL_BYTES = 6 * 1024 * 1024
# no / nothing / none / zero negate the CHECK only before its verb or as the word right after it ("No tool ran",
# "I ran nothing"); later in the clause they state the check's RESULT ("I grepped it this turn and found no callers").
WEAK_NEG_RE = re.compile(r"\b(no|nothing|none|zero)\b", re.I)


def negated(clause):
    if NEG_RE.search(clause):
        return True
    v, w = VERB_RE.search(clause), WEAK_NEG_RE.search(clause)
    return bool(v and w) and w.start() <= v.end() + 1
QUOTED_RE = re.compile(r'"[^"\n]*"|\u201c[^\u201d\n]*\u201d|`[^`\n]*`')


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def project_root(cwd):
    d = cwd or os.getcwd()
    while d and d != os.path.dirname(d):
        if os.path.isdir(os.path.join(d, '.git')):
            return d
        d = os.path.dirname(d)
    return cwd or os.getcwd()


def claims_in(text):
    """Return the sentences of `text` that claim a this-turn check without a negation IN THE SAME CLAUSE.

    Clause, not sentence: both founding cases carried a negation elsewhere in the sentence ("I re-checked the federation
    wording myself this turn; the society I did not", "Updating the copy isn't a text edit; it's a whole procedure. I read
    it this turn:"), and a sentence-wide negation test read 0 on both (measured 2026-10-25 while building this).
    """
    out = []
    for s in SENT_SPLIT.split(text or ''):
        s = s.strip()
        bare = QUOTED_RE.sub(' ', s)  # a quoted phrase is a mention, never this reply's claim
        if not s or not TIME_RE.search(bare):
            continue
        for clause in CLAUSE_SPLIT.split(bare):
            if TIME_RE.search(clause) and VERB_RE.search(clause) and not negated(clause):
                out.append(s)
                break
    return out


def tail_records(path):
    """The transcript's last TAIL_BYTES as parsed records, oldest first (index = line number in the tail)."""
    with open(path, 'rb') as f:
        f.seek(0, 2)
        size = f.tell()
        f.seek(max(0, size - TAIL_BYTES))
        raw = f.read()
    lines = raw.split(b'\n')
    if size > TAIL_BYTES:
        lines = lines[1:]  # the first line of a mid-file cut is partial
    recs = []
    for ln in lines:
        if not ln.strip():
            continue
        try:
            recs.append(json.loads(ln))
        except Exception:
            continue
    return recs


def last_turn(recs):
    """(start index, start record) of the newest turn: the last user record whose content is a string."""
    for i in range(len(recs) - 1, -1, -1):
        r = recs[i]
        if r.get('type') != 'user' or r.get('isSidechain'):
            continue
        c = (r.get('message') or {}).get('content')
        if isinstance(c, str):
            return i, r
    return None, None


def scan_turn(recs):
    """Returns (in_scope, tool_calls, claims, command) for the newest turn of `recs`."""
    i, start = last_turn(recs)
    if start is None:
        return False, 0, [], ''
    content = start['message']['content']
    cmd = next((tag.split('>')[-1].lstrip('/') for tag in IN_SCOPE if tag in content), '')
    if not cmd:
        return False, 0, [], ''
    tools = 0
    claims = []
    for r in recs[i + 1:]:
        if r.get('type') != 'assistant' or r.get('isSidechain'):
            continue
        c = (r.get('message') or {}).get('content')
        if not isinstance(c, list):
            continue
        for b in c:
            if not isinstance(b, dict):
                continue
            if b.get('type') == 'tool_use':
                tools += 1
            elif b.get('type') == 'text':
                for s in claims_in(b.get('text', '')):
                    claims.append({'sentence': s[:300], 'uuid': r.get('uuid'), 'ts': r.get('timestamp')})
    return True, tools, claims, cmd


def append_log(root, rec):
    path = os.environ.get('THIS_TURN_CLAIM_LOG') or os.path.join(
        root, '.claude', 'logs',
        'this-turn-claim-fires.smoke.jsonl' if os.environ.get('CLAUDE_HOOK_SMOKE') else 'this-turn-claim-fires.jsonl')
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'a') as f:
            f.write(json.dumps(rec) + '\n')
    except Exception:
        pass


def main(inp):
    if os.environ.get('SKIP_THIS_TURN_CLAIM_WARN') == '1' or inp.get('agent_id'):
        return
    sid = str(inp.get('session_id') or os.environ.get('CLAUDE_CODE_SESSION_ID') or '')
    sid8 = sid.lower()[:8]
    if not sid8:
        return
    root = os.environ.get('CLAUDE_PROJECT_DIR') or project_root(inp.get('cwd'))
    state_dir = os.environ.get('FF_STATE_DIR') or os.path.join(root, '.claude', 'state')
    marker = os.path.join(state_dir, 'this-turn-claim-' + sid8)
    event = inp.get('hook_event_name') or ''

    if event == 'UserPromptSubmit':
        if not os.path.isfile(marker):
            return
        try:
            with open(marker) as f:
                fire = json.load(f)
        except Exception:
            fire = {}
        try:
            os.remove(marker)
        except Exception:
            pass
        claims = fire.get('claims') or []
        quoted = ' | '.join('"' + c.get('sentence', '') + '"' for c in claims[:3])
        msg = ('⚠️ THIS-TURN CLAIM WITH NO TOOL CALL (this-turn-claim-warn.py, warn-mode): your last /%s reply '
               'said it checked something this turn, and the turn ran 0 tool calls before the reply: %s '
               '(record %s). The /eli5 Iron rule: derive it in the invocation, or say in that sentence that it is '
               'unverified. If the claim was true of an EARLIER turn, say which.'
               % (fire.get('command', 'eli5'), quoted, (claims[0].get('uuid') if claims else '?')))
        print(json.dumps({'hookSpecificOutput': {'hookEventName': 'UserPromptSubmit', 'additionalContext': msg}}))
        return

    if event != 'Stop':
        return
    if inp.get('stop_hook_active'):
        return  # a continuation of a blocked stop: the first pass already logged and handled this turn's claim
    path = inp.get('transcript_path') or ''
    if not path or not os.path.isfile(path):
        return
    try:
        recs = tail_records(path)
    except Exception:
        return
    in_scope, tools, claims, cmd = scan_turn(recs)
    if not in_scope or tools > 0 or not claims:
        return
    fire = {'ts': now_iso(), 'sid8': sid8, 'command': cmd, 'tool_calls': tools, 'claims': claims}
    append_log(root, fire)
    try:
        os.makedirs(state_dir, exist_ok=True)
        with open(marker, 'w') as f:
            json.dump(fire, f)
    except Exception:
        pass
    sys.stderr.write('this-turn-claim-warn: /%s reply claimed a this-turn check with 0 tool calls: %s\n'
                     % (cmd, claims[0]['sentence'][:160]))
    if os.environ.get('THIS_TURN_CLAIM_MODE') == 'block':
        # Block mode (opt-in, not the default): a Stop hook's JSON {"decision":"block","reason":…} at exit 0
        # makes Claude Code feed the reason back to the seat and keep the turn going, so the correction lands under
        # the reply within the same turn instead of on the owner's next message. Exit 0, never 2: the fleet wires every
        # python hook with `|| exit 1` so a missing script cannot block, and a JSON
        # block needs no exit code. stop_hook_active=true means this is already that continuation: never twice.
        reason = ('BLOCKED STOP (this-turn-claim-warn, block mode): your /%s reply said it checked something this '
                  'turn and the turn ran 0 tool calls. Run the check now, or say in that sentence that it is '
                  'unverified, then finish. Claim: %s' % (cmd, claims[0]['sentence'][:300]))
        try:
            os.remove(marker)  # the correction is happening now; no next-prompt nudge needed
        except Exception:
            pass
        print(json.dumps({'decision': 'block', 'reason': reason}))


if __name__ == '__main__':
    try:
        payload = json.load(sys.stdin)
    except Exception:
        payload = {}
    try:
        main(payload if isinstance(payload, dict) else {})
    except Exception:
        pass
    sys.exit(0)
