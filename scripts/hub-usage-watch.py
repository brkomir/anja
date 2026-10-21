#!/usr/bin/env python3
"""The usage watch behind `/review-hub --pause --when usage>=N` (review-hub/SKILL.md § ⏸).

The hub watches the session limit and pauses itself once the five-hour share reaches a stated threshold
(a parameter of /review-hub), with auto-resume: the pause the limit causes is lifted at that limit's reset; a
pause the owner types still waits for the owner.

READ-ONLY: it reads `<state-dir>/statusline-<sid8>.json` (scripts/statusline.py rewrites it on every
status-line refresh with Claude Code's own `rate_limits`) and, in resume mode, the hub's pause marker
`<state-dir>/review-hub-paused-<sid8>`; it writes nothing. Armed as a Monitor by the hub, so every line it prints
is an event; a decision line is printed once and the process exits 0.

  --sid S --pause-at N                     until a trusted reading has five_hour_pct >= N, then print
                                           `USAGE-PAUSE pct=<p> resets_at=<ISO-UTC>` and exit 0
  --sid S --pause-at N --resume-after E    until now >= E (an epoch, or the ISO the pause line printed), the
                                           pause marker reads `cause=usage` and a trusted reading has
                                           five_hour_pct < N, then print `USAGE-RESUME pct=<p>` and exit 0;
                                           before E, the same on a reading whose reset is not E, or whose
                                           share sits SAME_STEP_MARGIN or more under N (an account switch),
                                           printing `USAGE-RESUME pct=<p> account-switch resets_at=<ISO-UTC>`
  --once                                   one evaluation, print the decision, exit 0 if it fires, 1 if not
  an unexpected fault                      prints `usage watch: internal error (<what>)` and exits 3, so a crash
                                           never reads as the "holding" exit 1 and a Monitor still gets a line

TRUST — the rule .claude/hooks/agent-dispatch-session-limit-guard.py reads by: `ts` at most MAX_AGE_S old and
not in the future, `five_hour_pct` a finite number, `five_hour_resets_at` still ahead. Two differences, on
purpose, both because this watch needs the epoch (it is the resume time) where the guard needs only the
percentage: a reading without a finite reset epoch is not trusted, and neither is one whose reset sits further
ahead than one five-hour window (WINDOW_S, plus MAX_AGE_S of slack) — a milliseconds value would otherwise be
trusted and hand the resume watch a reset tens of thousands of years away. A test drives both scripts over two
fixture tables and fails on any other disagreement.

After E the resume needs no "newer five_hour_resets_at" test of its own: trust needs resets_at > now, so every
trusted reading it sees then already shows a newer window. Before E, one account's open window is the one
resetting at E, so a trusted reading with any other reset is another account's: without this test, switching
accounts would not lift the hub's auto-pause (the usage log showed it). So before E it fires on a trusted reading
whose reset is not E. In the usage log (2026-10-19, 103,271 readings) every reset is a whole multiple of 600 s, and of the 119 per-session reset
changes before the old reset, 98 moved to a later reset and 21 to an earlier one (a "later than E" test would
miss the 21); 117 of the 119 also move the five-hour share 20+ points or the seven-day share 5+, or move the
reset earlier, and the other 2 are the outbound leg of a switch whose return moved it earlier, so none reads as
one account's reset moving. The reset test cannot see a switch to an account whose window resets in E's own
600-s step: of the 23 times the sessions went from 80% or more to below 80% before the old reset, 3 kept the
reset while the seven-day share jumped 35-98 points. So a reading in E's own window also fires when its share
is SAME_STEP_MARGIN or more under N: within one window the log's largest fall of the share is 4 points (a share
above 100 later read as 99), so a fall that deep is another account's window. Replayed through decide() over
the same log at N of 80, 90 and 100, neither rule fires on a reading without a second sign of another account,
and only this one leaves no such switch to wait out the old reset. A paused hub also
sees a switch only after its own next model call: an idle session keeps the old account's figures until then
(on 2026-10-10 an idle session showed the 20:37 switch six minutes late, at its next request).
Both paths test the percentage, so a resume never lands on a reading that meets the pause condition. It also tests the
marker: a pause the owner typed rewrites it to `until=owner`, and such a pause still waits for the owner, so
the watch cannot print the line that lifts one (the hub checks the marker as well, § ⏸ step 8).

No trusted reading never fires either mode. In a loop it prints `usage watch: no trusted reading (<reason>)` at
most once per NOTICE_EVERY_S within one run (a re-armed Monitor is a new run, whose first dead reading prints at
once), so the hub sees a dead feed rather than a quiet one; before E the resume watch reads the file only for an
account switch and reports no dead feed (the old window's reset is still ahead, so a dead feed would only wake
a paused seat for nothing).
"""
import argparse
import calendar
import json
import math
import os
import sys
import time

MAX_AGE_S = 600       # the guard's number: a reading older than this says nothing about now
NOTICE_EVERY_S = 600  # at most one dead-feed line per this many seconds
WINDOW_S = 5 * 3600   # one five-hour window: a reset further ahead than this is not this window's
LAST_ISO_EPOCH = 253402300799  # 9999-12-31T23:59:59Z, the last second the ISO form can spell
SAME_STEP_MARGIN = 5  # points under N that E's own window cannot fall to on one account (the log's largest fall: 4)


def iso(epoch):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch))


def _number(v):
    try:
        return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
    except OverflowError:  # an int too large for a float (statusline.py guards the same case)
        return False


def reading(path, now):
    """(record, None) for a trusted reading, else (None, reason)."""
    try:
        with open(path) as fh:
            rec = json.load(fh)
    except FileNotFoundError:
        return None, "no status-line file"
    except (OSError, ValueError, RecursionError):  # RecursionError: json.load on a deeply nested file
        return None, "unreadable status-line file"
    if not isinstance(rec, dict):
        return None, "status-line file is not an object"
    ts, pct, reset = rec.get("ts"), rec.get("five_hour_pct"), rec.get("five_hour_resets_at")
    if not _number(ts):
        return None, "no ts"
    if now - ts > MAX_AGE_S:
        return None, f"stale, {now - ts:.0f}s old"
    if now - ts < 0:
        return None, "ts in the future"
    if not _number(pct):
        return None, "no five_hour_pct"
    if not _number(reset):
        return None, "no five_hour_resets_at"
    if reset <= now:
        return None, "window already reset"
    if reset - now > WINDOW_S + MAX_AGE_S:
        return None, "reset more than five hours ahead"
    return {"pct": pct, "reset": reset}, None


def paused_by_usage(marker):
    """Whether the hub's pause marker is the one the limit caused (`cause=usage`, review-hub/SKILL.md § ⏸ step 7)."""
    try:
        with open(marker, errors="replace") as fh:
            return "cause=usage" in fh.read()
    except OSError:
        return False


def decide(path, now, pause_at, resume_after, marker):
    """(fires, line, dead) — `dead` is the reason when a refusal the hub should see decided it (an untrusted
    reading, or in resume mode a pause marker that is not the limit's)."""
    if resume_after is not None and now < resume_after:
        rec, _ = reading(path, now)
        switched = rec is not None and (rec["reset"] != resume_after or rec["pct"] <= pause_at - SAME_STEP_MARGIN)
        if switched and rec["pct"] < pause_at and paused_by_usage(marker):
            return True, f"USAGE-RESUME pct={rec['pct']:g} account-switch resets_at={iso(rec['reset'])}", None
        return False, f"usage watch: waiting for the reset at {iso(resume_after)}", None
    if resume_after is not None and not paused_by_usage(marker):
        why = "the pause marker does not read cause=usage"
        return False, f"usage watch: not resuming ({why})", why
    rec, why = reading(path, now)
    if rec is None:
        return False, f"usage watch: no trusted reading ({why})", why
    pct = rec["pct"]
    if resume_after is None:
        if pct >= pause_at:
            return True, f"USAGE-PAUSE pct={pct:g} resets_at={iso(rec['reset'])}", None
        return False, f"usage watch: holding, pct={pct:g} below {pause_at:g}, resets_at={iso(rec['reset'])}", None
    if pct < pause_at:
        return True, f"USAGE-RESUME pct={pct:g}", None
    return False, f"usage watch: holding, post-reset pct={pct:g} still at or above {pause_at:g}", None


def _sid(s):
    s = s.strip().lower()
    if len(s) != 8 or not s.isalnum():
        raise argparse.ArgumentTypeError("a sid8 is 8 letters or digits")
    return s


def _pct(s):
    try:
        v = float(s)
    except ValueError:
        raise argparse.ArgumentTypeError("a percentage")
    if not (math.isfinite(v) and 0 < v <= 100):
        raise argparse.ArgumentTypeError("a percentage above 0, at most 100")
    return v


def _when(s):
    try:
        v = float(s)
    except ValueError:
        try:
            return float(calendar.timegm(time.strptime(s, "%Y-%m-%dT%H:%M:%SZ")))
        except ValueError:
            raise argparse.ArgumentTypeError("an epoch, or an ISO-UTC time like 2026-10-19T03:30:00Z")
    if not (math.isfinite(v) and 0 < v <= LAST_ISO_EPOCH):
        raise argparse.ArgumentTypeError("a positive epoch, at most 9999-12-31T23:59:59Z")
    return v


def _poll(s):
    v = float(s)
    if not (math.isfinite(v) and v > 0):
        raise argparse.ArgumentTypeError("a positive number of seconds")
    return v


def main(argv=None):
    p = argparse.ArgumentParser(description="Usage watch for /review-hub --pause --when usage>=N (read-only).")
    p.add_argument("--sid", required=True, type=_sid, help="this session's sid8")
    p.add_argument("--pause-at", required=True, type=_pct, help="the pause threshold N, in percent")
    p.add_argument("--resume-after", type=_when, help="resume mode: the reset the pause waits for")
    p.add_argument("--once", action="store_true", help="one evaluation; exit 0 if it fires, 1 if not")
    p.add_argument("--poll", type=_poll, default=60.0, help="seconds between readings (default 60)")
    p.add_argument("--state-dir", default=os.path.join(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd(),
                                                       ".claude", "state"))
    a = p.parse_args(argv)
    path = os.path.join(a.state_dir, f"statusline-{a.sid}.json")
    marker = os.path.join(a.state_dir, f"review-hub-paused-{a.sid}")
    last_notice = None
    while True:
        now = time.time()
        fires, line, dead = decide(path, now, a.pause_at, a.resume_after, marker)
        if a.once or fires:
            print(line, flush=True)
            return 0 if fires else 1
        if dead is not None and (last_notice is None or now - last_notice >= NOTICE_EVERY_S):
            print(line, flush=True)
            last_notice = now
        time.sleep(a.poll)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as e:  # SystemExit (argparse's 2, main's 0/1) is not an Exception and passes through
        import traceback
        traceback.print_exc()
        print(f"usage watch: internal error ({type(e).__name__}: {e})", flush=True)
        sys.exit(3)
