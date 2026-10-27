#!/usr/bin/env python3
"""UserPromptSubmit — the /keep-warm gate (on once the keep-warm-enabled switch file exists).

WHY. The main conversation's prompt cache lives one hour on a subscription. A session left idle past
that hour pays a full re-cache of its whole context on the next message (~936k base-input-equivalent
at a 480k context), while one keep-alive request that READS the cached prefix
costs ~36k and restarts the hour.

HOW. A recurring in-session CronCreate job (armed by SessionStart / the /keep-warm skill) submits a
prompt starting with SENTINEL every 15 minutes. This hook decides, at fire time, whether that fire
becomes a paid turn:
  * BLOCK -> the prompt never reaches the model: zero tokens (probed 2026-10-06 in a throwaway
             project: a blocked prompt returned num_turns 0, every usage field 0, cost $0).
  * PASS  -> one minimal turn that reads the cached prefix and resets its hour. Prints NOTHING,
             because the cron prompt itself carries the instruction; a quiet pass is the point.
Every non-sentinel prompt only updates state and exits 0 silently.

THE RULES:
  * due window   — the status line's cache countdown (cache_expires_at) shows 9..27 minutes left (1..19 earlier), so with
                   the 15-minute timer (7,22,37,52) the ping lands 33-51 minutes after the last request (41-59
                   earlier), always before the harness's own idle compaction, which summarises a 200,000+ token
                   session about 54 minutes after its last request (settings reference, `idleCompaction`, on by
                   default; measured to START 53.8-54.0 min after the last request in 3 fires here (the compact_boundary record lands 2-3 min later, when the summary finishes), blocked ticks in between — a blocked tick is not
                   activity). The window moved because a late FIRST ping was losing to it
                   — under 1..19 the first ping after a request landed at 41-59 min, under 9..27 at 33-48;
                   passed pings then sit on the tick lattice 45 min apart under either window, so the move changes
                   only that first ping. After the stop rule the idle compaction is expected to end the window warm
                   (provisional: the only stop-rule end on record did not compact).
                   (the */5 tick printed a 'blocked by hook' line 12x an hour; a hook's suppressOutput does NOT hide it,
                   tested live; the window is wider than the tick so one tick always lands in it; 18 wide (19 not 16 when the window was 1..19) leaves period +
                   2x the cron jitter, and at 16 the slack was zero; the countdown, not a faster tick, picks the
                   moment, so a 15-minute timer is enough).
                   No fresh countdown -> fallback: the last main request is 33..51 min old (51 exclusive; 31..58 earlier).
  * off-states   — SKIP_KEEP_WARM=1, no fleet switch (.claude/state/keep-warm-enabled) and no pilot marker
                   for this session, /keep-warm off, /standby, /pause (unless its keep-warm window is
                   open; /pause --cold writes none), a pending post-compact recovery (a marker whose compaction
                   was only PREPARED — the deferral script's rule() says DEFERRED: no compact_boundary at or after the
                   recovery floor — is NOT one; any other verdict or an error keeps the block), the
                   cache on the 5m tier
  * usage limit  — 5-hour usage >= 100% (read from the status line's state file) -> no ping, it would be refused.
                   The 95% "let it go cold" ceiling was REMOVED: near the limit is when
                   a warm cache matters most — a cold re-cache costs ~26 pings and lands on the little budget left
  * context      — NOT a rule: a ping near or past the
                   auto-compact point passes and compacts while the cache is warm. The fire line logs
                   context_tokens and compact_left
  * stop rule    — 14 passed pings in a row with no owner message (about 11-12 hours away at one ping per 45 min — passed pings sit on the 15-minute tick lattice; 17 for about an hour on a false "~42 min apart" premise, measured and reverted); lifted inside a /pause keep-warm
                   window, which instead ends 12 hours after the pause (the epoch /pause writes)
  * switch       — a ping that came back as a full re-cache (an account switch killed the cache, or it
                   expired) stops keep-warm for the session until the owner speaks

FAIL CLOSED on the sentinel path: any error BLOCKS (a broken gate must never turn fires into paid
turns). FAIL OPEN everywhere else: an owner prompt is never blocked by a gate bug.

STATE. .claude/state/keep-warm-<sid8>.json (gate state), keep-warm-turn-<sid8> (marks a passed ping
so keep-warm-tool-deny.sh denies every main-session tool call on that turn), keep-warm-off-<sid8>,
keep-warm-pause-<sid8> (body: epoch the /pause keep-warm window ends; /pause writes it by default, --cold does not). Log:
.claude/logs/keep-warm-fires.jsonl, one line per sentinel fire.
"""
import datetime
import json
import math
import os
import sys
import time

# The timer prompt's first words, not the bare tag: an owner message that merely starts "[keep-warm]"
# (quoting a ping reply) must stay an owner prompt. The three reminder hooks' early exits key on the bare tag,
# a looser prefix that only skips advisories. scripts/keep-warm-gate-test.py reds if the timer text drifts.
SENTINEL = '[keep-warm] automated cache keep-alive'
# A prompt with one of these prefixes is the harness, not the owner. The list matches
# scripts/queued-directive-residue-scan.py; it deliberately DIFFERS from standby-resume-check.sh,
# which classes an `[Owner-authorized` one-shot prompt as the owner's own
# authorization (it ends a park) — for this gate a cron firing is still not the owner speaking,
# so it stays a harness prompt here and never clears a stop.
HARNESS_PREFIXES = ('<task-notification>', '<cross-session-message', '<agent-message', '[Owner-authorized',
                    '# Autonomous loop', 'Your claude.ai usage limit', SENTINEL)


def env_num(name, default, cast=float):
    """A malformed tunable falls back to its default. Parsed at import, a ValueError would exit 1 before
    the fail-closed handler exists, and the harness treats exit 1 as non-blocking: every fire would pass."""
    try:
        v = cast(os.environ.get(name, default))
        if not math.isfinite(v):     # 'nan' parses, and every comparison against it is False: fail open
            raise ValueError(name)
        return v
    except ValueError:
        return cast(default)


MIN_LEFT_S = env_num('KEEP_WARM_MIN_LEFT_MIN', '9') * 60    # 1 earlier (idle compaction, header)
MAX_LEFT_S = env_num('KEEP_WARM_MAX_LEFT_MIN', '27') * 60   # 19 earlier; the window stays 18 min wide
MIN_GAP_S = env_num('KEEP_WARM_MIN_GAP_MIN', '33') * 60     # 31 earlier
MAX_GAP_S = env_num('KEEP_WARM_MAX_GAP_MIN', '51') * 60     # 58 earlier
STOP_PINGS = env_num('KEEP_WARM_STOP_PINGS', '14', int)     # passed pings sit on the 15-min tick lattice, 45 min apart in both windows, so 14 keeps ~11.5 h
USAGE_CEILING = env_num('KEEP_WARM_USAGE_CEILING', '100')   # the limit itself
# No context guard: a ping may carry the session over the auto-compact point, because there is nothing to keep
# warm once a fully loaded context goes stale, and that is the most expensive case keep-warm exists to prevent.
# Earlier a ping was blocked within a
# headroom of the point (1,500 tokens from 2026-10-17, 3% of it before), so a session idling there went cold at
# its largest. The fire line still records the context and the tokens left before the point.
STATUS_FRESH_S = 15 * 60
TAIL_BYTES = 2_000_000


def now():
    return float(os.environ.get('KEEP_WARM_NOW') or time.time())  # test seam


def iso_ts(s):
    return datetime.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()


def main_requests(path):
    """Main-conversation assistant records with usage, newest first, from the transcript tail. A request the
    harness or API refused (a usage-limit 429, a lost connection, a login failure) is written as an
    isApiErrorMessage record with an all-zero usage block and model <synthetic>; it is kept, flagged err, so the
    outcome check can see a refused ping, and main() keeps it out of the gap, tier and prefix reads."""
    size = os.path.getsize(path)
    with open(path, 'rb') as f:
        f.seek(max(0, size - TAIL_BYTES))
        lines = f.read().splitlines()
    out = []
    for ln in reversed(lines):
        try:
            d = json.loads(ln)
        except ValueError:
            continue
        if not isinstance(d, dict) or d.get('type') != 'assistant' or d.get('isSidechain') or d.get('agentId'):
            continue
        u = (d.get('message') or {}).get('usage')
        if not u or not d.get('timestamp'):
            continue
        cc = u.get('cache_creation') or {}
        out.append(dict(t=iso_ts(d['timestamp']), read=u.get('cache_read_input_tokens') or 0,
                        write=u.get('cache_creation_input_tokens') or 0,
                        w1h=cc.get('ephemeral_1h_input_tokens') or 0, w5m=cc.get('ephemeral_5m_input_tokens') or 0,
                        inp=u.get('input_tokens') or 0, out=u.get('output_tokens') or 0,
                        err=bool(d.get('isApiErrorMessage'))))
        if len(out) >= 400:
            break
    return out


def compacted_between(path, lo, hi):
    """True when the transcript tail holds a compact_boundary record stamped in [lo, hi]."""
    size = os.path.getsize(path)
    with open(path, 'rb') as f:
        f.seek(max(0, size - TAIL_BYTES))
        lines = f.read().splitlines()
    for ln in lines:
        try:
            d = json.loads(ln) if b'"compact_boundary"' in ln else None
            if isinstance(d, dict) and d.get('subtype') == 'compact_boundary' and lo <= iso_ts(d['timestamp']) <= hi:
                return True
        except (ValueError, KeyError, TypeError, AttributeError):
            continue
    return False


def read_epoch(path):
    try:
        return float(open(path).read(64).split()[0])
    except (OSError, IndexError, ValueError):
        return None


# The timer prompt's last words. Hiding a blocked prompt is right only for the timer's own text; an owner
# message that starts with the SENTINEL (a pasted ping plus a question) is shown back, never lost. A drift
# here only stops the hiding: classification stays on SENTINEL.
TIMER_TAIL = 'read mail or resume anything.'


def block_doc(reason, prompt=''):
    hide = str(prompt).rstrip().endswith(TIMER_TAIL)
    return json.dumps({'decision': 'block', 'reason': f'[keep-warm] {reason}',  # the harness prints its own yellow prefix; ours reads like a status line
                       'hookSpecificOutput': {'hookEventName': 'UserPromptSubmit', 'suppressOriginalPrompt': hide}})


def project_root(cwd):
    """The git rung of the house ladder (session-start.sh, the install command, keep-warm-tool-deny.sh): the
    nearest ancestor holding .git. A session whose cwd is a subdirectory must read the /standby, /pause and
    off markers at the root and write its turn marker where the tool-deny hook looks, never a shadow tree."""
    start = os.path.abspath(cwd if isinstance(cwd, str) and cwd else os.getcwd())
    d = start
    while not os.path.exists(os.path.join(d, '.git')):
        if os.path.dirname(d) == d:
            return start
        d = os.path.dirname(d)
    return d


def compaction_only_prepared(sid, state_dir, tx):
    """True when the pending marker names a compaction the harness only PREPARED and never applied: the
    transcript holds no `compact_boundary` record at or after the recovery floor (the last recovery, else
    the marker's own clock), so no recovery is owed and the ping may pass. The harness precomputes a
    compaction minutes to hours before it applies and writes the pending marker at preparation, so the
    bare marker blocked every ping of a pause whose context was intact (measured 2026-10-07 23:50Z,
    context 684k of 727k, 94%).
    The rule is the deferral script's own
    `rule()` (scripts/post-compact-deferral.py, loaded by path from this file's repo, so both always run the
    same checkout's copy; its signature and its verdict words are a contract that only
    scripts/keep-warm-gate-test.py § 5b pins — a drift there fails CLOSED, which restores the bug silently).
    `rule()` is read-only — `decide()` writes the deferred file and is never called from a gate.
    Returns (prepared, verdict). Anything but DEFERRED reads False and the block stands: an applied
    boundary (RECOVER), an unreadable transcript (NO-TRANSCRIPT), a missing or broken script, any
    exception — fail closed, and the verdict rides into the block reason so a drift is visible in the log."""
    try:
        import importlib.util
        here = os.path.dirname(os.path.abspath(__file__))
        script = os.path.join(os.path.dirname(os.path.dirname(here)), 'scripts', 'post-compact-deferral.py')
        spec = importlib.util.spec_from_file_location('post_compact_deferral', script)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        verdict, _info = mod.rule(sid, state_dir, tx)
        return verdict == 'DEFERRED', str(verdict)
    except Exception as e:  # noqa: BLE001 — a broken rule must never pass a ping
        return False, f'ERROR {type(e).__name__}'   # the verdict slot's own word form: no parentheses


def main(inp):
    sid = str(inp.get('session_id') or '')
    sid8 = sid.lower()[:8]
    prompt = str(inp.get('prompt') or '').lstrip()
    if not sid8 or not sid8.replace('-', '').isalnum():
        if prompt.startswith(SENTINEL):
            raise ValueError('no usable session_id')   # the __main__ handler blocks: fail closed
        return 0
    root = os.environ.get('CLAUDE_PROJECT_DIR') or project_root(inp.get('cwd'))
    state_dir = os.environ.get('FF_STATE_DIR') or os.path.join(root, '.claude', 'state')
    state_path = os.path.join(state_dir, f'keep-warm-{sid8}.json')
    turn_marker = os.path.join(state_dir, f'keep-warm-turn-{sid8}')
    try:
        state = json.load(open(state_path))
        if not isinstance(state, dict):
            state = {}
    except (OSError, ValueError):
        state = {}
    t = now()

    def save():
        os.makedirs(state_dir, exist_ok=True)
        tmp = state_path + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(state, f)
        os.replace(tmp, state_path)

    def clear_turn_marker():
        try:
            os.remove(turn_marker)
        except OSError:
            pass

    if not prompt.startswith(SENTINEL):
        clear_turn_marker()                      # whatever this turn is, it is not a keep-alive
        if not prompt.startswith(HARNESS_PREFIXES):  # the owner spoke
            state.update(last_owner=t, pings_since_owner=0)
            state.pop('stopped', None)
            state.pop('stop_reason', None)
            save()
        return 0

    # ── sentinel path: every exit below is a decision, and every decision is logged ──
    log = {'ts': datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
           'sid8': sid8}

    def decide(decision, reason, stop=False, **extra):
        log.update(decision=decision, reason=reason, **extra)
        state['last_fire'] = t
        if stop:
            state['stopped'], state['stop_reason'] = True, reason
        save()
        try:
            logp = os.environ.get('KEEP_WARM_LOG') or os.path.join(root, '.claude', 'logs', 'keep-warm-fires.jsonl')
            os.makedirs(os.path.dirname(logp), exist_ok=True)
            with open(logp, 'a') as f:
                f.write(json.dumps(log) + '\n')
        except OSError:
            pass
        if decision == 'block':
            clear_turn_marker()
            print(block_doc(reason, prompt))
        else:
            os.makedirs(state_dir, exist_ok=True)
            with open(turn_marker, 'w') as f:
                f.write(f'{int(t)}\n')
        return 0

    def marker(name):
        return os.path.exists(os.path.join(state_dir, f'{name}-{sid8}'))

    if os.environ.get('SKIP_KEEP_WARM') == '1':
        return decide('block', 'disabled by SKIP_KEEP_WARM=1')
    # The fleet switch is also the live kill switch: removing keep-warm-enabled blocks every armed timer at once.
    # Unwiring the gate instead turns each tick of every armed timer into a paid turn.
    if not (os.path.exists(os.path.join(state_dir, 'keep-warm-enabled')) or marker('keep-warm-pilot')):
        return decide('block', 'not switched on, no keep-warm-enabled file and no pilot marker for this session')
    if marker('keep-warm-off'):
        return decide('block', 'turned off for this session with /keep-warm off')
    if marker('session-standby'):
        return decide('block', 'session is on /standby')
    pause_until = read_epoch(os.path.join(state_dir, f'keep-warm-pause-{sid8}'))
    # The window counts only while the session is paused: a keep-warm-pause file left behind by a resume must not
    # keep lifting the stop rule after the owner is back.
    pause_window = pause_until is not None and pause_until > t and marker('session-pause')
    if marker('session-pause') and not pause_window:
        return decide('block', 'session is paused with no keep-warm window, by /pause --cold or because its window ended')
    if sid and os.path.exists(os.path.join(state_dir, f'post-compact-pending-{sid}')):
        prepared, verdict = compaction_only_prepared(sid, state_dir, inp.get('transcript_path'))
        if not prepared:
            return decide('block', f'a post-compact recovery is pending, deferral rule says {verdict}')
        log['pending_marker'] = 'hook fired, no compaction landed (deferral rule: DEFERRED) — not a pending recovery'
    if state.get('stopped'):
        return decide('block', 'stopped, ' + str(state.get('stop_reason')))

    try:
        reqs = main_requests(inp['transcript_path'])
    except (KeyError, OSError, ValueError, TypeError) as e:
        return decide('block', f'transcript unreadable, {type(e).__name__}, failing closed')
    real = [r for r in reqs if not r['err']]    # a refused request neither touched the cache nor measured it
    if not real:
        return decide('block', 'no main-conversation request in the transcript tail, failing closed')
    last = real[0]
    gap = t - last['t']
    tier = next(('1h' if r['w1h'] else '5m' for r in real if r['w1h'] or r['w5m']), None)
    prefix = last['read'] + last['write']
    log.update(gap_s=int(gap), tier=tier, prefix_tokens=prefix)

    # Outcome of the previous ping: the first main request at or after it. A re-cache = the prefix was gone.
    lp = state.get('last_ping')
    if lp:
        after = [r for r in reqs if r['t'] >= lp - 1]
        if after:
            first = after[-1]
            state.pop('last_ping', None)
            if first['err']:
                log['prev_ping_refused'] = True   # refused before it reached the cache: says nothing about the cache
            elif first['read'] < first['write'] and compacted_between(inp['transcript_path'], lp - 1, first['t']):
                # The ping carried the session over the compact point, and the first request
                # after a compaction re-caches by design (661 of 703 measured), so it says nothing about the cache.
                log['prev_ping_compacted'] = True
            elif first['read'] < first['write']:
                log['prev_ping_hit'] = False
                return decide('block', 'the last ping found the cache gone, from an account switch or expiry', stop=True)
            else:
                log['prev_ping_hit'] = True

    if tier != '1h':
        return decide('block', f'cache tier is {tier}, no keep-alive on 5m: usage credits, an API key, or no cache seen')

    # The status line writes this file on every refresh (~30 s). Stale or absent -> the countdown and usage
    # guards cannot run (and the fire line carries no compact_left), and the transcript gap rule decides
    # instead (a missing status line must not disable the feature).
    st = {}
    try:
        sp = os.path.join(state_dir, f'statusline-{sid8}.json')
        if t - os.path.getmtime(sp) <= STATUS_FRESH_S:
            st = json.load(open(sp))
            if not isinstance(st, dict):
                st = {}
    except (OSError, ValueError):
        st = {}
    expires = st.get('cache_expires_at')
    if isinstance(expires, (int, float)) and not isinstance(expires, bool):
        left = expires - t
        log['left_s'] = int(left)
        if left <= 0:
            return decide('block', 'cache countdown already at zero')
        if left > MAX_LEFT_S:
            return decide('block', f'cache fresh, {int(left // 60)} min left on the countdown')
        if left < MIN_LEFT_S:
            return decide('block', f'too close to expiry, {int(left)} s left')
    else:
        if gap >= MAX_GAP_S:
            return decide('block', f'cache already cold or nearly, {int(gap // 60)} min since the last request')
        if gap < MIN_GAP_S:
            return decide('block', f'cache fresh, {int(gap // 60)} min since the last request')
    pct = st.get('five_hour_pct')
    if isinstance(pct, (int, float)):
        log['five_hour_pct'] = pct
        resets = st.get('five_hour_resets_at')
        reset_passed = isinstance(resets, (int, float)) and not isinstance(resets, bool) and resets <= t
        if pct >= USAGE_CEILING and not reset_passed:   # a reading from before the window reset is not the limit
            return decide('block', f'5-hour limit reached at {pct:g}%, a ping would be refused')
    context = prefix + last['inp'] + last['out']   # the next request carries the last reply too
    log['context_tokens'] = context
    thr = st.get('compact_threshold')
    if isinstance(thr, (int, float)) and not isinstance(thr, bool) and thr > 0:
        log['compact_left'] = int(thr - context)    # under a ping's size: this ping crosses the point and compacts

    if pause_window:
        state['last_ping'] = t
        return decide('pass', f'ping at {int(gap // 60)}m (/pause keep-warm window)')
    n = int(state.get('pings_since_owner') or 0)
    if n >= STOP_PINGS:
        return decide('block', f'{STOP_PINGS} pings in a row with no owner message, stop rule', stop=True)
    state['pings_since_owner'] = n + 1
    state['last_ping'] = t
    return decide('pass', f'ping {n + 1}/{STOP_PINGS} at {int(gap // 60)}m')


if __name__ == '__main__':
    try:
        INP = json.load(sys.stdin)
    except ValueError:
        sys.exit(0)                      # unparseable payload: never block an unknown prompt
    if not isinstance(INP, dict):
        sys.exit(0)
    try:
        sys.exit(main(INP))
    except Exception as e:  # noqa: BLE001 — fail closed on the sentinel path only
        if str(INP.get('prompt') or '').lstrip().startswith(SENTINEL):
            print(block_doc(f'gate error, {type(e).__name__}, failing closed', INP.get('prompt') or ''))
        sys.exit(0)
