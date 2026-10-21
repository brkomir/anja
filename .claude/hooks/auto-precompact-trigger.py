#!/usr/bin/env python3
"""PostToolUse + UserPromptSubmit hook — tell the main session to run /pre-compact just before the automatic
compaction, once per crossing.

Prevents: NEW class — an automatic compaction lands with no /pre-compact bank, so the recovery has to rebuild the
hand-off state (builders, uncommitted edits, open mail loops, the next step) from the transcript alone. Founding
instance: an auto compaction at 2026-10-13T17:25Z, at 728,150 of 727,000 tokens by this hook's own
reading (the compaction record's preTokens: 728,422), no bank.

The rule behind it: run /pre-compact automatically once the context nears the compaction point (about 96% of
the context size). What it optimises for is a save that runs close to the automatic compaction, not the size of
a command that still fits in the remaining window, even if the save is sometimes cut off; /post-compact checks
whether a pre-compact ran, does less work if it did, and otherwise runs the same recovery as before (the
/post-compact half lives in that skill, not here).

What it reads:
  * the compaction point: `compact_threshold` in .claude/state/statusline-<sid8>.json, which scripts/statusline.py
    rewrites on every status-line refresh (window - 33,000, the formula Claude Code compacts at). Any age: it is
    derived from the model and the settings, not from the conversation. Absent -> silent.
  * the context size: the newest main-chain assistant record in the session transcript (input + cache read + cache
    write + that reply's output, the same total the status line shows), read from the file's tail. It lags by the
    newest tool result, which is what the headroom covers. Unreadable -> the status line's `context_tokens` if that
    file is at most STATUS_FRESH_S old, else silent.

When it fires: tokens left (threshold - context) at or under HEADROOM, once. A marker
(.claude/state/auto-precompact-fired-<sid8>) holds the crossing; the first reading back above the line (a
compaction happened) removes it, so the next crossing fires again.

HEADROOM = 30,000 (AUTO_PRECOMPACT_HEADROOM overrides). Measured 2026-10-13 over the 46 /pre-compact runs in this
project's transcripts, each from the command to the end of its own turn: min 3,509, median 8,422, max 23,629
tokens; 4 of 46 cost more than 15,000. 30,000 is about 96% of a 727,000 compaction point, the figure the rule names.
It does NOT always cover the save: the reading moves one model call at a time, so the first reading at or under
the line can already sit up to one step below it, and it lags by the tool results since that call. Replayed over
the 159,638 main-chain steps above 600,000 tokens in this project's transcripts (2026-10-13, crossing-weighted),
a save of median cost misses the compaction on ~10% of crossings and the largest on ~41%; 40,000 -> ~6%,
50,000 -> ~3.5% at the median. The rule is to run close to the compaction; a save that is cut off
costs its own tokens and nothing else: /post-compact finds no fresh bank and runs its full recovery.

Off unless switched on (the keep-warm pattern): the fleet switch .claude/state/auto-precompact-enabled, or the
pilot marker .claude/state/auto-precompact-pilot-<sid8>; .claude/state/auto-precompact-off-<sid8> turns one session
off under the fleet switch; SKIP_AUTO_PRECOMPACT=1 in the settings env block turns it off everywhere. Never fires
for a dispatched sub-agent (agent_id set), on a [keep-warm] ping (a ping must stay a cheap read), or on a seat
parked by /standby. A pre-compact the owner typed does not set the marker: one redundant bank (~8,400
tokens at the median) is the cost, the newer block supersedes.

Since 2026-10-16 this hook also carries the fleet-verb relay (.claude/hooks/fleet_verb.py: `/pause --fleet` and
`/pre-compact --fleet` typed in another session), because a registration of its own needs a settings.json edit.
SKIP_AUTO_PRECOMPACT=1 switches off the save only; FLEET_VERB_OFF=1 switches off the relay. When both fire on one
call they leave as ONE JSON document (the harness drops a second), fleet first, with a line stating that order.
A THIRD producer on these two events gets its own settings.json registration and a dispatcher, never a third
branch here: this file would then be a host that knows every producer's order.

Fails OPEN and SILENT on everything it cannot read; every path exits 0; at most one JSON document on stdout.
Fires are appended to .claude/logs/auto-precompact-fires.jsonl (…fires.smoke.jsonl under CLAUDE_HOOK_SMOKE;
AUTO_PRECOMPACT_LOG overrides). Tests point FF_STATE_DIR at a throwaway state directory:
scripts/auto-precompact-trigger-test.py.
"""
import datetime
import json
import os
import sys
import time

SENTINEL = '[keep-warm] automated cache keep-alive'
STATUS_FRESH_S = 120
TAIL_START = 262_144
TAIL_MAX = 8_388_608


def env_int(name, default):
    try:
        v = int(os.environ.get(name, '') or default)
        return v if v > 0 else default
    except ValueError:
        return default


HEADROOM = env_int('AUTO_PRECOMPACT_HEADROOM', 30_000)


def project_root(cwd):
    start = os.path.abspath(cwd if isinstance(cwd, str) and cwd else os.getcwd())
    d = start
    while not os.path.exists(os.path.join(d, '.git')):
        parent = os.path.dirname(d)
        if parent == d:
            return start
        d = parent
    return d


def usage_total(rec):
    """Context size after this main-chain assistant record, or None when it is not one."""
    if not isinstance(rec, dict) or rec.get('type') != 'assistant' or rec.get('isSidechain'):
        return None
    msg = rec.get('message')
    u = msg.get('usage') if isinstance(msg, dict) else None
    if not isinstance(u, dict):
        return None
    try:
        size = sum(int(u.get(k) or 0) for k in ('input_tokens', 'cache_read_input_tokens',
                                                 'cache_creation_input_tokens'))
        return size + int(u.get('output_tokens') or 0) if size else None
    except (TypeError, ValueError):
        return None


def transcript_context(path):
    """The newest main-chain context size in the transcript, read backward from its end."""
    if not isinstance(path, str) or not os.path.isfile(path):
        return None
    try:
        size = os.path.getsize(path)
        chunk = TAIL_START
        with open(path, 'rb') as f:
            while True:
                start = max(0, size - chunk)
                f.seek(start)
                lines = f.read(size - start).split(b'\n')
                if start > 0:
                    lines = lines[1:]          # the first line of a mid-file chunk is partial
                for raw in reversed(lines):
                    if b'"assistant"' not in raw:
                        continue
                    try:
                        total = usage_total(json.loads(raw))
                    except ValueError:
                        continue
                    if total:
                        return total
                if start == 0 or chunk >= TAIL_MAX:
                    return None
                chunk *= 4
    except OSError:
        return None


def main(inp):
    if inp.get('agent_id'):
        return
    sid8 = str(inp.get('session_id') or '').lower()[:8]
    if not sid8 or not sid8.replace('-', '').isalnum():
        return
    if str(inp.get('prompt') or '').lstrip().startswith(SENTINEL):
        return
    root = os.environ.get('CLAUDE_PROJECT_DIR') or project_root(inp.get('cwd'))
    state_dir = os.environ.get('FF_STATE_DIR') or os.path.join(root, '.claude', 'state')
    # The fleet-verb relay rides this hook (it runs on the same two events, and a hook registration of its own
    # needs a settings.json edit): fleet_verb.py. Both messages leave as ONE JSON document,
    # because the harness discards a hook's stdout that holds two.
    msgs = []
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import fleet_verb
        fm = fleet_verb.check(inp, root, state_dir, sid8)
        if fm:
            msgs.append(fm)
    except Exception:  # noqa: BLE001 — the relay must never cost the auto save
        pass
    if os.environ.get('SKIP_AUTO_PRECOMPACT') != '1':
        try:
            am = auto_message(inp, root, state_dir, sid8)
        except Exception:  # noqa: BLE001 — nor may the auto save cost the relay: its handled mark is already written
            am = None
        if am:
            msgs.append(am)
    if not msgs:
        return
    if len(msgs) == 2:
        msgs.insert(0, 'Two directives this turn: run them in the order below, the fleet command first, then the save.')
    event = inp.get('hook_event_name') if inp.get('hook_event_name') in ('PostToolUse', 'UserPromptSubmit') \
        else 'PostToolUse'
    print(json.dumps({'hookSpecificOutput': {'hookEventName': event, 'additionalContext': '\n\n'.join(msgs)}}))


def auto_message(inp, root, state_dir, sid8):
    def has(name):
        return os.path.exists(os.path.join(state_dir, name))

    if not (has('auto-precompact-enabled') or has(f'auto-precompact-pilot-{sid8}')):
        return
    if has(f'auto-precompact-off-{sid8}') or has(f'session-standby-{sid8}'):
        return
    st = {}
    sp = os.path.join(state_dir, f'statusline-{sid8}.json')
    try:
        st = json.load(open(sp))
        st_age = time.time() - os.path.getmtime(sp)
    except (OSError, ValueError):
        st, st_age = {}, None
    if not isinstance(st, dict):
        st = {}
    threshold = st.get('compact_threshold')
    if not isinstance(threshold, int) or isinstance(threshold, bool) or threshold <= 0:
        return
    context = transcript_context(inp.get('transcript_path'))
    if context is None:
        ct = st.get('context_tokens')
        if isinstance(ct, int) and st_age is not None and st_age <= STATUS_FRESH_S:
            context = ct
    if not context:
        return
    left = threshold - context
    fired = os.path.join(state_dir, f'auto-precompact-fired-{sid8}')
    if left > HEADROOM:
        try:
            os.remove(fired)                   # back below the line: a compaction landed, re-arm
        except OSError:
            pass
        return
    if os.path.exists(fired):
        return
    now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    rec = {'ts': now, 'sid8': sid8, 'event': inp.get('hook_event_name'), 'context': context,
           'threshold': threshold, 'left': left, 'headroom': HEADROOM}
    os.makedirs(state_dir, exist_ok=True)
    with open(fired, 'w') as f:
        json.dump(rec, f)
    try:
        logp = os.environ.get('AUTO_PRECOMPACT_LOG') or os.path.join(
            root, '.claude', 'logs',
            'auto-precompact-fires.smoke.jsonl' if os.environ.get('CLAUDE_HOOK_SMOKE') else 'auto-precompact-fires.jsonl')
        os.makedirs(os.path.dirname(logp), exist_ok=True)
        with open(logp, 'a') as f:
            f.write(json.dumps(rec) + '\n')
    except OSError:
        pass
    return (f'⏳ AUTO PRE-COMPACT — context is at {context:,} of {threshold:,} tokens, {max(left, 0):,} left before '
           f'the automatic compaction. Run /pre-compact NOW through the Skill tool (no --disarm), before anything '
           f'else in this turn: it banks the hand-off state in this session\'s working plan (heading '
           f'"## PRE-COMPACT — <UTC ISO>", AUTO), writes nothing else, and the work then carries on. Fires once per '
           f'crossing (pre-compact/SKILL.md § Automatic trigger).')


if __name__ == '__main__':
    try:
        payload = json.load(sys.stdin)
        if isinstance(payload, dict):
            main(payload)
    except Exception:  # noqa: BLE001 — a bug here must never touch a tool call or a prompt
        pass
    sys.exit(0)
