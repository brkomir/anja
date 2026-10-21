#!/usr/bin/env python3
"""session-lifecycle.py — session "done-for-now" vs "exited" signal.

Distinguishes WRAPPED (task-done, repeatable — /wrap) from FINISHED/EXITED
(terminal, harness-observed — SessionEnd). 3-expert converged design, 2026-06-03:
  - signal-gated chain (built on vinicius91carvalho/.claude's signal-gated Stop pattern):
    /wrap = intent (authorize) -> SessionEnd = commit (consume)
  - derive-don't-store: status is DERIVED from marker presence, never a stored flag
  - writer-separation: the agent can write WRAPPED, but only the
    harness (SessionEnd hook) can write FINISHED — at exit there is no turn left.

Markers in .claude/state/ (session_id-keyed, normalized to 8 hex chars so the
in-model /wrap writer [CLAUDE_CODE_SESSION_ID env] and the hook reader [stdin
session_id] always agree):
  session-wrapped-<sid>    "<HEAD-sha> <epoch>"   written by /wrap          (intent, repeatable)
  session-finished-<sid>   "<epoch> <reason>"     written by SessionEnd     (terminal)
  session-standby-<sid>    "<epoch> <HEAD-sha>"   written by /standby       (owner-parked; cleared by
                                                  `resume`, which /standby resume runs on the owner's
                                                  next message)

Derived status (NEVER stored): finished marker -> EXITED; else standby -> STANDBY; else
wrapped -> WRAPPED / CHECKPOINT; else ACTIVE (derivation: scripts/session_status.py).

Why SessionEnd is the only true "exited" signal: /wrap is empirically repeatable
(48h evidence: 8/11 sessions worked past their final /wrap, 23 /wraps across 11).

Modes:
  wrapped              stamp WRAPPED for current/--session id          (called by /wrap)
  finished --reason R  stamp FINISHED iff R in exit-reason-class       (called by SessionEnd hook)
  standby              stamp STANDBY — alive, listener disarmed, deaf   (called by /standby)
  resume               clear STANDBY, print how long it was parked     (called by /standby resume)
  gate --source S      resume advisory + GC (no staleness sweep)       (called by SessionStart hook)
  status [--session]   print derived status (read-only; debugging)

Non-blocking by design: every mode exits 0. Blocking a session exit would be wrong.
"""
import argparse
import datetime
import glob
import os
import re
import subprocess
import sys
import time

# The status DERIVATION is not written here — it is imported from the SSOT
# (`scripts/session_status.py`), shared with session-manifest.py +
# parallel-session-scan.py. See `derive_status` below. sys.path is prepended explicitly
# rather than relying on sys.path[0]: this script is invoked from the SessionStart and
# SessionEnd hooks with assorted cwds, and `python3 -c`/`-m` does not put this directory
# on the path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import session_status  # noqa: E402  (must follow the sys.path line above)

REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# FF_STATE_DIR override exists solely for smoke-test isolation (keeps synthetic
# markers out of the live .claude/state). Production always uses the default.
STATE_DIR = os.environ.get('FF_STATE_DIR') or os.path.join(REPO_DIR, '.claude', 'state')

EXIT_REASONS = {'logout', 'prompt_input_exit'}  # SessionEnd 'reason' values that ACTUALLY fire on a
# true exit. NB: /exit + /clear do NOT fire SessionEnd at all (Claude Code #17885 / #6428) — so a
# session closed either way leaves NO marker and reads ACTIVE indefinitely. There is no backstop and
# that is deliberate: this line read "those rely on the jsonl-staleness
# backstop below" until the backstop was removed, which is the dead-mechanism pointer the same
# commit's message warns about. A false EXITED invites a peer to adopt work someone is still
# holding; no marker does not. ('exit' was never a real reason; 'other'/'clear' = non-
# terminal-or-non-firing.) SessionStart's `source` (startup/resume/clear/compact) is a SEPARATE field.
# Calibration-pending constants (review caveat: don't hardcode a guessed
# durable threshold — revisit on real data).
GC_DAYS = 7            # delete markers older than this (housekeeping)
STANDBY_GC_DAYS = 30   # a parked seat is parked ON PURPOSE for as long as the owner likes (parked
                       # seats are resumed by hand when needed); a week is a plausible park, so
                       # the standby marker ages out on a longer horizon than the wrap/exit markers.
                       # Degrades gracefully: past it the seat reads ACTIVE, the arm-reminder nags on
                       # the owner's next message and the listener re-arms through the standard path.
# ⛔ NO HOUR-BASED INFERENCE. A session is marked finished only by a proper session
# close — whatever actually fires the SessionEnd hook — never by elapsed hours.
#
# STALE_HOURS (18) and JSONL_STALE_HOURS (3) lived here and drove a crash-recovery sweep
# that wrote 'inferred-stale' / 'inferred-idle' into session-finished-<sid>. Both are
# GONE, and so is the sweep. The reason is not that the guess was often wrong — it is
# that it landed in the SAME FILE, with the same shape, as a measured SessionEnd, so
# every downstream reader had to carry a workaround to tell a guess from evidence
# (session_status.py ARM 1 still does, and must, for any legacy marker inside GC_DAYS).
# Measured cost while it was live: one session carried 'inferred-idle' from the
# 2026-07-27 memory crash and read EXITED for 2.6 days while actively committing.
#
# THE CONSEQUENCE, ACCEPTED: a session closed by /exit or /clear leaves NO marker,
# because neither fires SessionEnd at all in this build (Claude Code #17885 / #6428),
# and it therefore reads ACTIVE indefinitely. That is the intended failure direction —
# a false EXITED invites a peer to adopt work someone is still holding, and an honest
# "no evidence" is worth more than a plausible guess. The fix for a reader who cannot
# tell an exited session from an idle one is to SAY SO, not to manufacture a marker.


def norm_sid(raw):
    if not raw:
        return ''
    m = re.search(r'[0-9a-fA-F]{8}', raw)
    return (m.group(0) if m else raw[:8]).lower()


def current_sid(arg):
    return norm_sid(arg or os.environ.get('CLAUDE_CODE_SESSION_ID', ''))


def head_sha():
    try:
        return subprocess.run(
            ['git', '-C', REPO_DIR, 'rev-parse', 'HEAD'],
            capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:
        return ''


def _commits_on(day):
    """Count commits dated YYYY-MM-DD (cheap; mirrors head_sha's git pattern).
    FF_FAKE_COMMITS override = smoke-test determinism only (the FIRE path otherwise
    depends on the live repo having >=2 commits 'today')."""
    fake = os.environ.get('FF_FAKE_COMMITS')
    if fake is not None:
        try:
            return int(fake)
        except ValueError:
            return 0
    try:
        out = subprocess.run(
            ['git', '-C', REPO_DIR, 'log', '--since', day + ' 00:00', '--until', day + ' 23:59', '--oneline'],
            capture_output=True, text=True, timeout=5).stdout
        return len([ln for ln in out.splitlines() if ln.strip()])
    except Exception:
        return 0


def wrapped_path(sid):
    return os.path.join(STATE_DIR, f'session-wrapped-{sid}')


def finished_path(sid):
    return os.path.join(STATE_DIR, f'session-finished-{sid}')


def standby_path(sid):
    return session_status.standby_marker(STATE_DIR, sid)


def cmd_standby(args):
    """/standby: park this seat. The marker is the STATE peers read
    (`who` / `hub-discover` / the scan badge it '⏸ standby'), the SessionStart hook suppresses the
    arm directive on it, the arm-reminder goes silent on it, and post-compact Step 5 stops
    re-arming on it. The listener itself is stopped by the skill (TaskStop / kill), never here —
    a python subprocess cannot reach a harness Monitor task. Idempotent: a second stamp re-dates."""
    sid = current_sid(args.session)
    if not sid:
        print('session-lifecycle: no session id (CLAUDE_CODE_SESSION_ID unset) — skipping STANDBY', file=sys.stderr)
        return 0
    os.makedirs(STATE_DIR, exist_ok=True)
    again = os.path.exists(standby_path(sid))
    with open(standby_path(sid), 'w') as f:
        f.write(f'{int(time.time())} {head_sha()}\n')
    print(f'session-lifecycle: marked STANDBY ({sid}){" — re-stamped, was already parked" if again else ""}', file=sys.stderr)
    return 0


def cmd_resume(args):
    """/standby resume: clear the marker and say how long the seat was parked. The listener
    re-arm and the inbox read are the SKILL's steps (Monitor + /mail check are agent-turn
    primitives); this only flips the state peers read. No marker ⇒ says so, exit 0."""
    sid = current_sid(args.session)
    if not sid:
        print('session-lifecycle: no session id (CLAUDE_CODE_SESSION_ID unset) — nothing to resume', file=sys.stderr)
        return 0
    p = standby_path(sid)
    if not os.path.exists(p):
        print(f'session-lifecycle: no STANDBY marker for {sid} — nothing to clear', file=sys.stderr)
        return 0
    since, _sha = session_status.read_standby(p)
    try:
        os.remove(p)
    except OSError as e:
        print(f'session-lifecycle: could not remove {p}: {e}', file=sys.stderr)
        return 0
    parked = max(0, int(time.time()) - int(since))
    h, m = divmod(parked // 60, 60)
    print(f'session-lifecycle: STANDBY cleared ({sid}) — parked {h}h {m:02d}m '
          f'(since {datetime.datetime.utcfromtimestamp(int(since)).strftime("%Y-%m-%dT%H:%MZ")})', file=sys.stderr)
    return 0


def cmd_wrapped(args):
    sid = current_sid(args.session)
    if not sid:
        print('session-lifecycle: no session id (CLAUDE_CODE_SESSION_ID unset) — skipping WRAPPED', file=sys.stderr)
        return 0
    os.makedirs(STATE_DIR, exist_ok=True)
    # THIRD FIELD = INTENT, so a CHECKPOINT wrap is told apart from a plain WRAPPED.
    # `/wrap` writes 'wrap' (done-for-now); `/wrap --checkpoint` writes
    # 'checkpoint' (the session CONTINUES). Backward-compatible by construction: every
    # existing reader goes through session_status.read_wrapped, which splits on whitespace
    # and reads parts[0..1] only, so a legacy 2-field marker and a new 3-field one parse
    # identically there. Intent is DECLARED here and cannot be derived later — a checkpoint
    # that then goes quiet is byte-identical to a plain wrap without this field.
    mode = 'checkpoint' if getattr(args, 'checkpoint', False) else 'wrap'
    with open(wrapped_path(sid), 'w') as f:
        f.write(f'{head_sha()} {int(time.time())} {mode}\n')
    label = 'CHECKPOINT' if mode == 'checkpoint' else 'WRAPPED'
    print(f'session-lifecycle: marked {label} ({sid})', file=sys.stderr)
    return 0


def cmd_finished(args):
    sid = current_sid(args.session)
    if not sid:
        return 0
    reason = (args.reason or '').strip().lower()
    if reason not in EXIT_REASONS:
        return 0  # clear/other/non-firing = soft boundary, NOT terminal
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(finished_path(sid), 'w') as f:
        f.write(f'{int(time.time())} {reason}\n')
    print(f'session-lifecycle: marked FINISHED ({sid}, {reason})', file=sys.stderr)
    return 0


def _jsonl_dir():
    """Where this repo's session transcripts live. FF_JSONL_DIR overrides for tests.

    NB the manifest + scan resolve the same directory through FF_SESSIONS_DIR. The two
    env names are kept distinct on purpose: the smoke suite drives the lifecycle sweep
    and the peer-scan fixtures independently, and collapsing them would couple two
    unrelated test sections. Resolution therefore stays at each CALLER; only the
    derivation is shared (see session_status.lifecycle_status). The directory NAME is the
    SSOT's too (`session_status.project_key_dir`): the MAIN checkout's root via
    --git-common-dir — so a linked-worktree checkout of this script still finds the
    transcripts the harness wrote under the main key — encoded per UTF-16 unit."""
    return os.environ.get('FF_JSONL_DIR') or session_status.project_key_dir(cwd=REPO_DIR)


# Thin delegation to the SSOT so this file cannot drift from session-manifest.py /
# parallel-session-scan.py. Only `_read_wrap` survives as an alias — cmd_gate's resume
# advisory still reads the wrapped marker here.
# The former `_read_finished` and `_last_record_epoch` aliases were DELETED rather than
# re-exported: after the fold their only caller was the status derivation, which now
# lives in `scripts/session_status.py` (read_finished / last_record_epoch there). A
# re-export with no caller advertises an API this file no longer owns — and worse, it is
# the shape a future edit would hang a second divergent derivation off. The SSOT holds
# the rationale for all three (why a RECORD beats an mtime; why an ABSENT record falls
# back rather than to EXITED; why a marker's CONTENT epoch beats its file mtime).
_read_wrap = session_status.read_wrapped



def cmd_gate(args):
    sid = current_sid(args.session)
    src = (args.source or '').strip().lower()
    now = int(time.time())

    # 1) GC: drop markers older than GC_DAYS (housekeeping; session_id-keyed
    #    markers would otherwise accumulate — staleness hygiene).
    for p in (glob.glob(os.path.join(STATE_DIR, 'session-wrapped-*')) +
              glob.glob(os.path.join(STATE_DIR, 'session-finished-*'))):
        try:
            if now - os.path.getmtime(p) > GC_DAYS * 86400:
                os.remove(p)
        except OSError:
            pass
    #    A standby marker ages out on its own, longer horizon (STANDBY_GC_DAYS) — see the constant.
    for p in glob.glob(os.path.join(STATE_DIR, 'session-standby-*')):
        try:
            if now - os.path.getmtime(p) > STANDBY_GC_DAYS * 86400:
                os.remove(p)
        except OSError:
            pass

    # 2) THE CRASH-RECOVERY SWEEP WAS REMOVED — see the note on
    #    EXIT_REASONS above. It inferred a finished marker from elapsed hours (HEAD
    #    unmoved since wrap, or the transcript silent) and wrote it into the same file a
    #    real SessionEnd writes. Nothing infers an exit any more: the only writer of
    #    session-finished-<sid> is the SessionEnd hook, via `finished --reason R`.

    # 2c) Signal-gated-Stop CONSUME terminus (the end of
    #     the authorize->verify->remind->CONSUME chain, built on vinicius's signal-gated Stop pattern): a PEER that FINISHED in the last
    #     day with NO session-memory-done-<day> marker left its decisions unpersisted. Surface a
    #     one-line backstop at this session's start. The date-keyed marker is coarse (another
    #     session running /session-memory that day suppresses it) — accepted; the marker's own
    #     design is day-granular. Bounded to the fresh-exit window so it can't nag for days.
    for fp in glob.glob(os.path.join(STATE_DIR, 'session-finished-*')):
        osid = os.path.basename(fp)[len('session-finished-'):]
        if osid == sid:
            continue
        try:
            fts = int(os.path.getmtime(fp))
        except OSError:
            continue
        if now - fts > 86400:
            continue  # only the fresh-exit window (GC handles old finished markers)
        day = datetime.datetime.fromtimestamp(fts).strftime('%Y-%m-%d')
        if os.path.exists(os.path.join(STATE_DIR, 'session-memory-done-' + day)):
            continue
        n = _commits_on(day)
        if n >= 2:
            print(f'⚠ session-lifecycle: prior session `{osid}` EXITED ({day}) with no '
                  f'/session-memory run — ~{n} commits that day may carry unpersisted '
                  f'decisions (run /session-memory to capture).', file=sys.stderr)

    # 3) Resume advisory for the CURRENT session — kills the 2-5x re-wrap loop by
    #    telling a resumed session it already wrapped (it's REOPENING, not fresh).
    if sid and src in ('resume', 'startup') and os.path.exists(wrapped_path(sid)) and not os.path.exists(finished_path(sid)):
        _, wts = _read_wrap(wrapped_path(sid))
        when = datetime.datetime.fromtimestamp(wts).strftime('%Y-%m-%d %H:%M') if wts else 'earlier'
        print(f'⏎ session-lifecycle: this session already ran /wrap ({when}). '
              f'You are REOPENING, not starting fresh — restate intent before mutating durable '
              f'state; re-run /wrap when the new work is done.', file=sys.stderr)
    return 0


def derive_status(sid):
    """Derived status for a session id. The verdict comes from the SSOT; this file once
    owned a WRAPPED refinement (on-hold vs reopened), which needed a git call the SSOT
    deliberately has no business making — removed, see below.

    ⚠️ THE DERIVATION USED TO BE HAND-WRITTEN HERE, and had diverged from the two other
    sites that answer the same question.
    It now lives once, in `scripts/session_status.py`. This site was the AHEAD one — it
    already carried both stale-marker arms and the record predicate — so unification
    mostly propagated its behaviour outward rather than changing it here.

    ⚠️ FAIL SAFE TOWARD **ACTIVE**, AND THAT DIRECTION IS POLICY, NOT ACCIDENT. Codified
    at `session-manifest.py`'s STALE-MARKER GUARD (2026-07-13): "a false
    EXITED makes a peer ADOPT work someone is still holding (data loss, collision); a
    false ACTIVE merely makes a peer over-defend a corpse (harmless). Never resolve a
    contradiction in the label's favour." `/peers` and the adopt ladder read
    this status to decide whether a seat is dead, so the asymmetry is real spend. The
    consequence inside the SSOT: an UNREADABLE record is an ABSENT measurement, not a
    negative one — it falls back to the weaker mtime signal, never to EXITED.

    ONE BEHAVIOUR CHANGE LANDS HERE from the reconciliation: when the exit marker is
    stale, a wrapped marker that PRE-DATES the exit no longer speaks. This file used to
    fall straight through to the WRAPPED branch, badging a demonstrably-resumed session
    "on-hold" on the strength of a wrap it had since left twice over; it now reads ACTIVE.
    A wrap stamped AFTER the exit still reads WRAPPED. Note the inferred-exit arm already
    required exactly that ordering, so this makes one existing rule uniform rather than
    inventing a new one — and both branches are non-terminal, so it cannot manufacture
    the false EXITED the policy above exists to prevent.

    ⛔ THE on-hold/reopened REFINEMENT WAS REMOVED 2026-08-07, MEASURED NOT ASSUMED. It
    read `wsha != head_sha()` — a bare repo-GLOBAL compare with NO session term — so on a
    shared `main` any peer's commit flipped every wrapped seat to "reopened — work since
    wrap", an ATTRIBUTION the mechanism could not support. Measured over all 16 live wrap
    markers: 16/16 REOPENED, 0 on-hold.

    THE OBVIOUS REPLACEMENT WAS MEASURED AND IS EQUALLY DEGENERATE — that is why this is a
    delete and not a swap. Re-keying to the session-scoped `last_record_epoch(sid) >
    wrap_epoch` (the SSOT's own predicate for this class, arm 2 of
    `session_status.exit_marker_superseded`) makes the claim TRUE but leaves it
    CONSTANT: `/wrap` stamps its marker at Step 0 and then
    writes records for the rest of the wrap, so every wrapped session has work after its
    stamp. Same corpus, same 16/16, deltas 0.02h (the wrap's own tail) to 37.9h. A binary
    whose on-hold branch is unreachable in practice is decoration whichever predicate
    backs it.

    AND THE QUESTION A READER ACTUALLY HAS — "is this seat parked or still going?" — is
    NOT "did anything happen after the wrap" but "how long since the last record". ⛔ THAT
    QUESTION NOW HAS NO MECHANICAL ANSWER HERE, and that is deliberate: this sentence used
    to point at `JSONL_STALE_HOURS`, which was REMOVED with the whole hour-based
    inference (see the note on EXIT_REASONS). Nothing infers an exit from
    elapsed time any more, so a reader who cannot tell parked from going must SAY they
    cannot, rather than read a number as a verdict. The refinement this docstring rejects
    is still rejected, for the reason above it; only its proposed alternative is gone.

    Cost of keeping it was not zero: a seat read this string, believed it, and built an
    owner-facing recommendation on it the same day it was removed.

    Re-adding needs a predicate that DISCRIMINATES on the live population — demonstrate
    that before restoring the branch, not after."""
    if not sid:
        return 'UNKNOWN (no session id)'
    return session_status.lifecycle_status(sid, STATE_DIR, _jsonl_dir())


def cmd_status(args):
    sid = current_sid(args.session)
    print(f'{sid or "?"}: {derive_status(sid)}')
    return 0


def main():
    p = argparse.ArgumentParser(description='Session done/exited lifecycle markers')
    sub = p.add_subparsers(dest='cmd', required=True)
    for name in ('wrapped', 'finished', 'standby', 'resume', 'gate', 'status'):
        sp = sub.add_parser(name)
        sp.add_argument('--session', help='Session id (default: $CLAUDE_CODE_SESSION_ID)')
        if name == 'wrapped':
            sp.add_argument('--checkpoint', action='store_true',
                            help='Declare INTENT TO CONTINUE (/wrap --checkpoint). Writes CHECKPOINT '
                                 'instead of WRAPPED. Both are non-terminal and identical to every '
                                 'gate; the flag records only that the seat said it was not finished.')
        elif name == 'finished':
            sp.add_argument('--reason', default='', help='SessionEnd reason (logout/prompt_input_exit/clear/other)')
        elif name == 'gate':
            sp.add_argument('--source', default='', help='SessionStart source (startup/resume/clear/compact)')
    args = p.parse_args()
    return {
        'wrapped': cmd_wrapped, 'finished': cmd_finished,
        'standby': cmd_standby, 'resume': cmd_resume,
        'gate': cmd_gate, 'status': cmd_status,
    }[args.cmd](args)


if __name__ == '__main__':
    sys.exit(main() or 0)
