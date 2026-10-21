#!/usr/bin/env python3
"""session_status.py — THE fleet's session-lifecycle status derivation. Single source of truth.

Not a CLI. An importable module, deliberately: it is the ONE place that answers
"is this session EXITED / WRAPPED / ACTIVE?" for every consumer in the repo.

WHY THIS FILE EXISTS.
The same derivation had been hand-written at THREE sites and had already diverged
on FIVE independent axes:

  site                                   predicate   marker clock   inferred-resume arm   stale-marker→?
  session-manifest.py:lifecycle_status   jsonl mtime  file mtime    absent                short-circuit ACTIVE
  session-lifecycle.py:derive_status     RECORDS      content epoch present               fall through to WRAPPED
  parallel-session-scan.py:lifecycle_status  jsonl mtime  file mtime    absent            short-circuit ACTIVE

Every one of those rows was defensible in isolation, and the set of them meant
`/peers`, `/expert-review`'s injected brief, and the overlap gate could disagree
about whether a seat was alive. Hand-synced twins were the defect; a shared
module is the only shape that cannot drift.

⚠️ THE "WITHOUT RE-IMPORTING IT" CONSTRAINT IS HONOURED, NOT BYPASSED.
`session-manifest.py:lifecycle_status` documented that it derives status from
session-lifecycle.py's MARKERS "WITHOUT re-importing it". That constraint names a
specific module boundary — manifest → `session-lifecycle.py`, which is a CLI with
argparse, git subprocesses and a SessionStart sweep that no reader should pull in
(and whose hyphenated filename is not importable anyway). This module is the other
direction: no CLI, no argparse, no side effects at import (one git call, in `repo_root`,
made only when invoked), no dependency on any of its consumers. The manifest still does not import
session-lifecycle.py; every consumer now imports a leaf.

────────────────────────────────────────────────────────────────────────────────
THE TWO RECONCILED DECISIONS. Both are POLICY, not accident. Read before editing.

(1) THE PREDICATE IS TRANSCRIPT **RECORDS**, NOT jsonl MTIME.
    A jsonl mtime moves for write-class operations that are not a session turn —
    `touch`/`os.utime` (this repo's own smoke fixtures did exactly that), a
    copy-back or restore, a sync tool re-materializing the file, a harness flush.
    A RECORD is appended only when the session takes a turn, so nobody can forge
    one. (Corrected 2026-07-30: an earlier justification claimed
    a READER bumps mtime — that is false, POSIX reads bump atime. The record
    preference stands on the write-without-a-turn class, not on readers.)

    ⛔ AND THE DOMINANT MOVER TURNED OUT NOT TO BE ANY OF THOSE — IT IS THE EXIT
    SEQUENCE ITSELF, WHICH MADE THE mtime PREDICATE FIRE ON **20% OF LIVE MARKERS**
    (measured 2026-08-02 at the unification, over all 35 marker-bearing sessions).
    The SessionEnd hook writes the finished marker while the
    harness is still flushing the transcript's LAST record, so the jsonl lands
    0.14–0.92s AFTER the marker with NO new turn in it. The mtime comparison reads
    that sub-second lead as "the session kept working after its own exit" and
    returns ACTIVE. Seven sessions — every one carrying a real `prompt_input_exit`,
    every one silent for 32–102h — were reported ACTIVE by the manifest + scan
    replicas and EXITED by the record predicate. The stale-marker guard was firing
    on the exit it exists to distinguish resumption FROM.
    The record predicate is immune because it compares TURNS: the newest record is
    at or before the marker (verified against a full-file scan, not just the tail
    window, on files up to 90 MB — the tail read agreed with ground truth 7/7).
    Note the flip direction is ACTIVE→EXITED, i.e. TOWARD the error decision (2)
    calls costly, which is why it was verified three ways before being accepted:
    exit reason, record-vs-marker ordering, and 32–102h of silence.

(2) FAIL SAFE TOWARD **ACTIVE** — CODIFIED, NOT A PREFERENCE.
    From `session-manifest.py`'s STALE-MARKER GUARD (2026-07-13):
    "a false EXITED makes a peer ADOPT work someone is still holding (data loss,
    collision); a false ACTIVE merely makes a peer over-defend a corpse
    (harmless). Never resolve a contradiction in the label's favour."
    Concretely, here: an ABSENT measurement is not a NEGATIVE one. When no record
    can be read (a single transcript record can exceed the tail window — image
    payloads measured to ~6.2 MB — on precisely the busiest, i.e. most-alive,
    sessions) we fall back to the weaker mtime signal, NEVER to EXITED.

Both were live incidents, not theory. One session wrote its jsonl +2960s AFTER its
own exit marker, was mid-turn, and was labelled EXITED; a hub broadcast a
"stranded verdict" and two further sessions moved to adopt work it still held —
four sessions, one false label.

────────────────────────────────────────────────────────────────────────────────
Public API (each consumer passes its OWN directories — see `lifecycle_status`):
  read_finished(path)                        -> (epoch:int, reason:str)
  read_wrapped(path)                         -> (sha:str, epoch:int)
  jsonl_mtime(sid, sessions_dir)             -> float | None
  last_record_epoch(sid, sessions_dir)       -> int   | None
  exit_marker_superseded(...)                -> bool
  wrapped_mode(path)                         -> 'checkpoint' | 'wrap'
  standby_marker(state_dir, sid)             -> path of the /standby marker
  read_standby(path)                         -> (epoch:int, sha:str)
  lifecycle_status(sid, state_dir, sessions_dir) -> 'EXITED' | 'STANDBY' | 'CHECKPOINT' | 'WRAPPED' | 'ACTIVE'
  project_key(root)                          -> the harness's <key> for a root (per UTF-16 unit; >200 suffixed)
  repo_root(cwd=None)                        -> the MAIN checkout's root, as the harness keys it
  project_key_dir(root=None, cwd=None)       -> ~/.claude/projects/<key>
"""

import datetime
import glob
import json
import os
import subprocess
import unicodedata


def wrapped_marker(state_dir, sid):
    return os.path.join(state_dir, f'session-wrapped-{sid}')


def finished_marker(state_dir, sid):
    return os.path.join(state_dir, f'session-finished-{sid}')


def standby_marker(state_dir, sid):
    """The /standby marker: the seat is ALIVE and DELIBERATELY DEAF —
    its mail listener was disarmed by the owner and nothing but the owner's next message wakes it.
    Written by `session-lifecycle.py standby`, removed by `session-lifecycle.py resume`."""
    return os.path.join(state_dir, f'session-standby-{sid}')


def read_standby(path):
    """(epoch, sha) from a standby marker '<epoch> <HEAD-sha>'; tolerant of malformed files.
    Epoch-first like the finished marker (the sha is informational). mtime fallback keeps its
    precision for the same reason read_finished's does."""
    try:
        parts = open(path).read().split()
        ts = int(parts[0]) if parts else os.path.getmtime(path)
        sha = parts[1] if len(parts) > 1 else ''
        return ts, sha
    except Exception:
        try:
            return os.path.getmtime(path), ''
        except OSError:
            return 0, ''


def read_wrapped(path):
    """(sha, epoch) from a wrapped marker '<HEAD-sha> <epoch>'; tolerant of malformed files.

    ⚠️ THE mtime FALLBACK IS NOT TRUNCATED TO int — see read_finished for the measured
    reason (a sub-second truncation silently inverts a same-second comparison)."""
    try:
        parts = open(path).read().split()
        sha = parts[0] if parts else ''
        ts = int(parts[1]) if len(parts) > 1 else os.path.getmtime(path)
        return sha, ts
    except Exception:
        try:
            return '', os.path.getmtime(path)
        except OSError:
            return '', 0


def read_finished(path):
    """(epoch, reason) from a finished marker '<epoch> [reason]'.

    Reason is 'sessionend' for a REAL observed exit (written by the SessionEnd hook)
    and 'inferred-idle' / 'inferred-stale' for a crash-recovery GUESS. The distinction
    is load-bearing in `exit_marker_superseded`: a guess must not outrank live evidence.
    Format differs from a wrapped marker (epoch-first, no sha), so this cannot reuse
    read_wrapped — that parse would throw on 'inferred-idle' and fall back to mtime.

    ⚠️ THE MARKER'S **CONTENT** EPOCH IS THE CLOCK, not the file's mtime — and that is
    the FAIL-SAFE direction, which is why this is the unified basis (the manifest and
    scan replicas both used file mtime before unification). A restore/copy/`touch` that
    bumps the marker's mtime makes the marker look NEWER than it is, which biases the
    comparison below toward EXITED — the direction that costs data. The written epoch
    cannot move that way. mtime remains the fallback for a marker with no parsable body
    (e.g. a `: >`-created fixture), where it is the only clock available.

    ⛔ THE mtime FALLBACK MUST NOT BE TRUNCATED TO int, AND THAT IS A MEASURED BUG, NOT A
    STYLE NOTE. Both marker parsers inherited an `int(os.path.getmtime(path))` fallback
    from the pre-unification session-lifecycle.py copy, where it never mattered because
    that file compared it only against other ints. Here it is compared against
    `jsonl_mtime`, a FLOAT — so for a marker written in the SAME SECOND as the transcript
    it reads, truncation moves the marker BACKWARDS by up to 1s and the comparison
    inverts. Measured: marker mtime 1785640700.1736 truncated to ...700 against a jsonl
    mtime of ...700.1734 — an OLDER transcript scoring as newer, i.e. a genuinely-exited
    peer reported ACTIVE. It fails toward ACTIVE (the harmless direction) and it still
    broke two smoke arms. A parsed CONTENT epoch stays int() because it was written as
    one; only the mtime fallback keeps its precision.
    """
    try:
        parts = open(path).read().split()
        ts = int(parts[0]) if parts else os.path.getmtime(path)
        reason = parts[1] if len(parts) > 1 else 'sessionend'
        return ts, reason
    except Exception:
        try:
            return os.path.getmtime(path), 'unparseable'
        except OSError:
            return 0, 'unparseable'


def jsonl_mtime(sid, sessions_dir):
    """Most-recent mtime (epoch) of any transcript jsonl whose name starts with this sid;
    None if none exists. THE WEAKER SIGNAL — see decision (1) in the module docstring. Kept
    because it is the correct fallback when no record can be read, and because a MISSING
    jsonl (returns None) is the one case where the exit marker genuinely stands: the
    transcript was archived or deleted, so the session really is gone."""
    best = None
    for p in glob.glob(os.path.join(sessions_dir, f'{sid}*.jsonl')):
        try:
            m = os.path.getmtime(p)
        except OSError:
            continue
        best = m if best is None else max(best, m)
    return best


def last_record_epoch(sid, sessions_dir):
    """Epoch of the NEWEST transcript RECORD for this sid; None if none/unreadable.

    THE PREDICATE — decision (1) in the module docstring. A record dated after an exit
    marker is positive, unforgeable evidence the session RETURNED, which mtime cannot
    establish. Reads only the file's tail, so cost is O(1) in transcript size — these
    reach hundreds of MB.

    RETURNS None WHEN NOTHING COULD BE READ — never 0. "I read a record and it is old"
    and "I could not read a record" must not collapse, because the caller errs toward
    ACTIVE on an ABSENT measurement (decision (2)). A single record can exceed the tail
    window (8 records >4 MB in the 2026-07-30 corpus scan of 118 files), so an unreadable
    tail is a routine outcome on exactly the biggest, busiest — i.e. most-alive — sessions.
    """
    best = None
    for p in glob.glob(os.path.join(sessions_dir, f'{sid}*.jsonl')):
        try:
            size = os.path.getsize(p)
            # Escalating window: one oversized trailing record would otherwise yield a
            # bare fragment and read as "no record".
            for window in (65536, 4194304):
                with open(p, 'rb') as fh:
                    fh.seek(max(0, size - window))
                    tail = fh.read().decode('utf-8', 'replace')
                found = None
                # Scan backwards for the newest line that parses AND carries a timestamp;
                # the first line of a mid-file seek is usually a fragment, hence the parse.
                for line in reversed(tail.splitlines()):
                    line = line.strip()
                    if not line.startswith('{'):
                        continue
                    try:
                        ts = (json.loads(line) or {}).get('timestamp')
                    except Exception:
                        continue
                    if not ts:
                        continue
                    try:
                        found = int(datetime.datetime.strptime(
                            ts[:19], '%Y-%m-%dT%H:%M:%S'
                        ).replace(tzinfo=datetime.timezone.utc).timestamp())
                    except Exception:
                        continue
                    break
                if found is not None:
                    best = found if best is None else max(best, found)
                    break
                if window >= size:
                    break
        except Exception:
            pass
    return best


def exit_marker_superseded(sid, finished_epoch, finished_reason, wrapped_path, sessions_dir):
    """Is the exit marker a STALE CLAIM the session has since outlived? -> bool

    A bare existence check on the finished marker is a ONE-WAY LATCH: a session that
    fires SessionEnd and then RESUMES keeps the marker forever and is classified dead
    for the rest of its life. Two independent ways a marker gets outlived:

    ARM 1 — RE-WRAPPED AFTER AN *INFERRED* EXIT. An inferred marker is a crash-recovery
    GUESS written by session-lifecycle.py's sweep, not an observed SessionEnd. A strictly
    newer wrapped marker is the session demonstrably back at the keyboard, and a stale
    guess must not outrank live evidence. Measured 2026-07-30: one session carried
    'inferred-idle' from the 07-27 memory crash and read EXITED for 2.6 days while
    actively committing and wrapping. A REAL SessionEnd still wins this arm
    unconditionally — hence the `inferred` prefix test.

    ARM 2 — A TURN AFTER THE EXIT. Reaches what arm 1 cannot: a session that REALLY
    exited (logout / prompt_input_exit) and was later RESUMED keeps its SessionEnd
    marker forever, and such a seat often has no wrapped marker at all, so arm 1's
    reason test AND its existence test both miss. Session-limit and crash resumes are
    routine, so this population is plausibly LARGER than the crash-inferred one.
    Measured on the review hub itself: EXITED while holding a live claim, an armed
    listener, and 6 ledger commits in 6 hours — the false-EXITED-invites-adoption
    hazard aimed at the seat the adopt ladder consults most.

    ⚠️ THE FALL-BACK ORDER IN ARM 2 IS THE FAIL-SAFE DIRECTION, AND IT IS POLICY, NOT
    ACCIDENT (module docstring decision (2); `session-manifest.py`'s STALE-MARKER GUARD
    is the codification). A RECORD governs whenever we got one — it is unforgeable. When
    the record measurement is ABSENT we fall back to the weaker mtime signal, NEVER to
    EXITED. An earlier draft fell through to EXITED on an unreadable tail: conservative
    against REGRESSION, but pointed the wrong way on the asymmetry that actually costs
    data, and REACHABLE — one trailing record can exceed the tail window on precisely the
    busiest (most-alive) sessions. Absent ≠ negative.
    """
    if finished_reason.startswith('inferred') and os.path.exists(wrapped_path):
        if read_wrapped(wrapped_path)[1] > finished_epoch:
            return True
    rec = last_record_epoch(sid, sessions_dir)
    if rec is not None:
        return rec > finished_epoch
    jm = jsonl_mtime(sid, sessions_dir)
    # jm is None => jsonl archived/deleted => genuinely gone. Marker stands.
    return jm is not None and jm > finished_epoch


def wrapped_mode(path):
    """'checkpoint' | 'wrap' from a wrapped marker's optional THIRD field.

    A marker written before 2026-08-26 has two fields and yields 'wrap' — the honest
    default, since a legacy marker records no intent either way and 'wrap' is the
    conservative reading (done-for-now). Deliberately a SEPARATE reader rather than a
    third element on read_wrapped's tuple: that function has three call sites across two
    modules and widening its arity would break them for a field only one caller needs.
    """
    try:
        parts = open(path).read().split()
        return 'checkpoint' if len(parts) > 2 and parts[2] == 'checkpoint' else 'wrap'
    except Exception:
        return 'wrap'


def lifecycle_status(sid, state_dir, sessions_dir):
    """Derive a session's terminal status from its lifecycle markers. THE SSOT.

    -> 'EXITED'  terminal SessionEnd, no future intent — the ONLY status that drops a
                 peer from the overlap gate and licenses adopting its work.
       'WRAPPED' done-for-now but REPEATABLE — /wrap is empirically repeatable (48h
                 evidence: 8/11 sessions worked past their final /wrap), so a wrapped
                 peer can still mutate state. Deliberately NOT terminal.
    'CHECKPOINT' wrapped WITH DECLARED INTENT TO CONTINUE (`/wrap --checkpoint`). A strict
                 SUB-CASE of WRAPPED, never a replacement: it is equally non-terminal, still
                 mutates state, still sends and receives mail, and still counts for the
                 overlap gate. It says only that the seat declared it was not finished.
                 ⚠️ Its ABSENCE proves nothing — a plain `/wrap` followed by hours of work
                 reads WRAPPED, because intent is declared at wrap time and never inferred.
       'ACTIVE'  no marker, or a marker the session has outlived.
       'STANDBY' owner-PARKED (`/standby`, 2026-09-23): alive, holding its work, listener
                 DISARMED on purpose, woken by NOTHING but the owner's next message. Ranks
                 below EXITED (a parked seat can still die) and above WRAPPED / CHECKPOINT
                 whatever their age: a wrap stamped after the park leaves the listener just as
                 disarmed, and every consumer that acts on standby keys on the marker's bare
                 existence, so a newer wrap must not relabel a deaf seat as one that still
                 receives mail. Deliberately NOT demoted by a transcript
                 record: the owner's own message is a record, and the marker must outlive it
                 until `/standby resume` clears it — the UserPromptSubmit net
                 (`standby-resume-check.sh`) re-fires until then, exactly like the
                 post-compact marker. Still IN the overlap gate (it holds uncommitted work).

    `state_dir` / `sessions_dir` are passed IN rather than read from the environment,
    because the consumers use different env overrides for test isolation
    (`FF_STATE_DIR` everywhere; `FF_JSONL_DIR` in session-lifecycle.py vs
    `FF_SESSIONS_DIR` in the manifest + scan) and because session-manifest.py's
    self-test patches those module globals at runtime. Resolution stays at the caller;
    the DERIVATION lives here. `sid` is likewise pre-normalized by the caller — the two
    normalizers differ (8-hex regex vs `.lower()[:8]`) and normalizing here would
    silently change one of them.

    ⚠️ A STALE EXIT MARKER IS IGNORED, NOT INVERTED. When `exit_marker_superseded` says
    the session came back, we do not short-circuit to ACTIVE (what the manifest + scan
    replicas did) nor fall straight through to WRAPPED (what session-lifecycle.py did) —
    we re-read the REMAINING markers, and the wrapped marker only speaks if it POST-DATES
    the exit. A wrap that predates the exit describes a state the session has since left
    twice over; reporting it would badge a demonstrably-working seat "⏸ wrapped". Note
    arm 1 already required exactly this `wts > fts` ordering, so this makes one existing
    rule uniform rather than inventing a new one. Both branches are non-terminal, so
    neither can produce the false EXITED that decision (2) exists to prevent.
    """
    if not sid:
        return 'ACTIVE'
    finished = finished_marker(state_dir, sid)
    wrapped = wrapped_marker(state_dir, sid)
    standby = standby_marker(state_dir, sid)

    # The marker IS the state, with no ordering exception. Every consumer that ACTS on standby
    # keys on its bare existence (session-start.sh, mail-listen-arm-reminder.sh, post-compact
    # Step 5, standby-resume-check.sh), and the listener stays disarmed until `resume` removes
    # it — so a wrap stamped after the park changes what the seat DID, not whether it can HEAR.
    # Readers that need the wrap EVENT (`mail-await --peer-done`) read the wrap marker directly.

    if os.path.exists(finished):
        fts, freason = read_finished(finished)
        if not exit_marker_superseded(sid, fts, freason, wrapped, sessions_dir):
            return 'EXITED'
        if os.path.exists(standby):
            return 'STANDBY'
        if os.path.exists(wrapped) and read_wrapped(wrapped)[1] > fts:
            return 'CHECKPOINT' if wrapped_mode(wrapped) == 'checkpoint' else 'WRAPPED'
        return 'ACTIVE'
    if os.path.exists(standby):
        return 'STANDBY'
    if os.path.exists(wrapped):
        return 'CHECKPOINT' if wrapped_mode(wrapped) == 'checkpoint' else 'WRAPPED'
    return 'ACTIVE'


# ────────────────────────────────────────────────────────────────────────────────
# The harness's per-project directory name — ONE derivation for every Python consumer.
#
# Mirror of scripts/lib/project-key.mjs, whose header states the harness's rule in words and says
# where to compare it (the installed harness version, its path and two byte offsets): the root is the
# realpath'd, NFC-normalized cwd; every UTF-16 unit outside [a-zA-Z0-9] becomes "-"; a key over 200
# units is cut to 200 and suffixed with "-" + base36(|h|), h the 32-bit h*31 hash of the ORIGINAL root.
# The two ports are cross-checked on fixtures by session-labels.py --self-test.
# ────────────────────────────────────────────────────────────────────────────────

PROJECT_KEY_MAX = 200   # the harness's `Ipe`


def _utf16_units(s):
    """The string as the harness sees it — a list of UTF-16 code units (`charCodeAt`)."""
    b = s.encode('utf-16-le', 'surrogatepass')
    return [int.from_bytes(b[i:i + 2], 'little') for i in range(0, len(b), 2)]


def harness_string_hash(s):
    """`Use(t)`: h = h*31 + unit, wrapped to a SIGNED int32, over UTF-16 units."""
    h = 0
    for unit in _utf16_units(s):
        h = ((h << 5) - h + unit) & 0xFFFFFFFF
    return h - 0x100000000 if h >= 0x80000000 else h


def _base36(n):
    digits = '0123456789abcdefghijklmnopqrstuvwxyz'
    if n == 0:
        return '0'
    out = []
    while n:
        n, r = divmod(n, 36)
        out.append(digits[r])
    return ''.join(reversed(out))


def project_key(root):
    """`DO(e)`: every UTF-16 unit outside [A-Za-z0-9] becomes '-' — so a character outside the BMP
    becomes TWO dashes, where `re.sub` over code points gave one — and over 200 units the key is cut
    to 200 and suffixed with '-' + base36(|hash(root)|), the hash over the ORIGINAL root, never the
    sanitized key. Pure: no filesystem, no git; pass `repo_root()` output for the harness's own root."""
    key = ''.join(chr(u) if (48 <= u <= 57 or 65 <= u <= 90 or 97 <= u <= 122) else '-'
                  for u in _utf16_units(root))
    if len(key) <= PROJECT_KEY_MAX:
        return key
    return key[:PROJECT_KEY_MAX] + '-' + _base36(abs(harness_string_hash(root)))


_HERE = os.path.dirname(os.path.abspath(__file__))


def repo_root(cwd=None):
    """The MAIN checkout's root as the harness keys it: the parent of `git rev-parse
    --path-format=absolute --git-common-dir` (the main repository even from a linked worktree — the
    harness keys a worktree seat's transcripts under the main checkout, measured), then
    realpath'd and NFC-normalized exactly as the harness resolves its own cwd. Falls back to `cwd`
    (or this file's repository) when git cannot answer. The module's ONE subprocess, run only when called."""
    base = cwd or _HERE  # this file's repository, never the process cwd (callers run from anywhere)
    try:
        common = subprocess.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
                                capture_output=True, text=True, cwd=base).stdout.strip()
    except OSError:
        common = ''
    root = os.path.dirname(common) if common else (cwd or os.path.dirname(_HERE))
    return unicodedata.normalize('NFC', os.path.realpath(root))


def project_key_dir(root=None, cwd=None):
    """`~/.claude/projects/<project_key(root)>`; `root` defaults to `repo_root(cwd)`.

    NOT IMPLEMENTED, by name: the `CLAUDE_CODE_PROJECT_DIR_NAME` override, which the harness honours
    only under a non-default `CLAUDE_CONFIG_DIR` — no caller in this repo sets either."""
    if root is None:
        root = repo_root(cwd)
    return os.path.join(os.path.expanduser('~/.claude/projects'), project_key(root))
