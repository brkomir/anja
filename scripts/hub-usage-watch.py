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
  --weekly-pause-at W (default 97)         the weekly line, read in every mode: a trusted reading with
                                           seven_day_pct >= W prints `USAGE-PAUSE cause=weekly pct=<w>
                                           resets_at=<ISO-UTC|unknown>` and exits 0. In pause mode it is read before the
                                           five-hour line, whose wait it outlasts; in either resume mode it is
                                           the line printed in place of a resume while the weekly figure is
                                           still at or over W, so a resume never lands on a weekly pause
  --sid S --pause-at N --resume-weekly     until the pause marker reads `cause=usage` and a trusted reading has
                                           seven_day_pct < W, then print `USAGE-RESUME cause=weekly pct=<w>`
                                           and exit 0; if the five-hour line is then at or over N it prints
                                           that line's `USAGE-PAUSE pct=<p> resets_at=<ISO-UTC>` instead
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

THE WEEKLY LINE trusts by the same `ts` rule and a finite, non-boolean `seven_day_pct`, read from the same file
and never needing the five-hour fields: right at a five-hour reset the feed reads five_hour_pct None beside a
live seven_day_pct (22:20Z on 2026-10-21: None and 18), and the weekly line still decides on it while the
five-hour line reports `no trusted reading (no five_hour_pct)` as it always has. `seven_day_resets_at`
(scripts/statusline.py writes it since this line was added) only decides trust when it is a number already
past (a boolean counts, as in the guard), the old window's figure not yet cleared; any other value, absent, a
string, milliseconds or further ahead than seven days, prints `resets_at=unknown` and leaves the reading
trusted, because nothing waits on it. The guard's weekly line (its WEEKLY_THRESHOLD_PCT) trusts by exactly this rule, with no difference.
The weekly resume waits on no epoch, on this evidence from the usage meter's readings (121,638 readings,
to 2026-10-21T22:41Z): no session's seven_day_pct ever fell between two readings within one account's week.
Of its 177 falls, the 13 under 10 points all came with a changed five-hour reset (another account), 133 of
10 or more did too, and the other 31 each land in the same minute in 4 to 6 sessions at once, to 0-3 (a new
week, or a fresh account: 10-08, 10-11, 10-12, 10-21) or to 38-65 (another account: 10-07, 10-10, 10-14).
So a trusted reading under W is itself the reset or the switch, needs no epoch to be told from the old window,
and cannot flap. At the 2026-10-21 weekly reset (18:00:00Z) six sessions read seven_day_pct None within 57 s
of it, the hub's own included, and showed the new week (0 to 3) one to three minutes later, as the five-hour
fields do at their reset; so in weekly resume mode an untrusted reading of a fresh file prints the dead-feed
notice like the five-hour one after E, the line that wakes an idle paused hub, whose figures move only with its
own next model call. A stale file prints it only once that file's own seven_day_resets_at is past (a missing,
unreadable or ts-less file prints at once):
a hub's status line can stop re-rendering while it sits idle or the machine sleeps (one hub's meter log
holds 68 gaps over 10 minutes, to 2026-10-21), and a stale file would wake it for nothing, as before E.
While it waits on a figure at or over W it prints nothing.
The two resume modes each check the other line before printing a resume; the weekly resume ignores the five-hour
line when it is untrusted (a five-hour reset clears its fields every five hours).

No trusted reading never fires any mode. In a loop it prints `usage watch: no trusted reading (<reason>)` at
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
WEEKLY_PAUSE_AT = 97  # the weekly line for the hub
WEEK_S = 7 * 86400    # one weekly window: a seven_day_resets_at further ahead than this prints as unknown


def iso(epoch):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch))


def _number(v):
    try:
        return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
    except OverflowError:  # an int too large for a float (statusline.py guards the same case)
        return False


def load(path, now):
    """(the raw record, None) when the file is an object with a fresh `ts`, else (None, reason)."""
    try:
        with open(path) as fh:
            rec = json.load(fh)
    except FileNotFoundError:
        return None, "no status-line file"
    except (OSError, ValueError, RecursionError):  # RecursionError: json.load on a deeply nested file
        return None, "unreadable status-line file"
    if not isinstance(rec, dict):
        return None, "status-line file is not an object"
    ts = rec.get("ts")
    if not _number(ts):
        return None, "no ts"
    if now - ts > MAX_AGE_S:
        return None, f"stale, {now - ts:.0f}s old"
    if now - ts < 0:
        return None, "ts in the future"
    return rec, None


def reading(path, now):
    """(five-hour record, None) for a trusted reading, else (None, reason)."""
    return five_hour(*load(path, now), now)


def weekly_reading(path, now):
    """(weekly record, None) for a trusted reading, else (None, reason)."""
    return weekly(*load(path, now), now)


def weekly(rec, why, now):
    """The weekly line's trust over a loaded record: {"pct", "reset" (an epoch, or None when unknown)}."""
    if rec is None:
        return None, why
    pct, reset = rec.get("seven_day_pct"), rec.get("seven_day_resets_at")
    if not _number(pct):
        return None, "no seven_day_pct"
    # the guard's test, character for character: any number at or before now, -Infinity and a boolean included
    if isinstance(reset, (int, float)) and reset <= now:
        return None, "weekly window already reset"
    if not (_number(reset) and reset - now <= WEEK_S + MAX_AGE_S):
        reset = None
    return {"pct": pct, "reset": reset}, None


def five_hour(rec, why, now):
    if rec is None:
        return None, why
    pct, reset = rec.get("five_hour_pct"), rec.get("five_hour_resets_at")
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


def five_hour_pause_line(rec):
    """The five-hour line's `USAGE-PAUSE pct=<p> resets_at=<ISO-UTC>`, printed by pause mode and by the weekly
    resume's hand-off: one spelling, because review-hub/SKILL.md § ⏸ reads the same line from either."""
    return f"USAGE-PAUSE pct={rec['pct']:g} resets_at={iso(rec['reset'])}"


def weekly_pause(raw, why, now, weekly_at):
    """The weekly line's `USAGE-PAUSE cause=weekly …` when a trusted reading sits at or over W, else None."""
    wk, _ = weekly(raw, why, now)
    if wk is None or wk["pct"] < weekly_at:
        return None
    reset = iso(wk["reset"]) if wk["reset"] is not None else "unknown"
    return f"USAGE-PAUSE cause=weekly pct={wk['pct']:g} resets_at={reset}"


def decide(path, now, pause_at, resume_after, marker, weekly_at=WEEKLY_PAUSE_AT, resume_weekly=False):
    """(fires, line, dead) — `dead` is the reason when a refusal the hub should see decided it (an untrusted
    reading, or in resume mode a pause marker that is not the limit's)."""
    raw, raw_why = load(path, now)
    if resume_weekly:
        return decide_weekly_resume(raw, raw_why, now, pause_at, weekly_at, marker, path)
    if resume_after is not None and now < resume_after:
        rec, _ = five_hour(raw, raw_why, now)
        switched = rec is not None and (rec["reset"] != resume_after or rec["pct"] <= pause_at - SAME_STEP_MARGIN)
        if switched and rec["pct"] < pause_at and paused_by_usage(marker):
            # the other account's week may be the one at its line: then this is a weekly pause, not a resume
            line = weekly_pause(raw, raw_why, now, weekly_at)
            if line:
                return True, line, None
            return True, f"USAGE-RESUME pct={rec['pct']:g} account-switch resets_at={iso(rec['reset'])}", None
        return False, f"usage watch: waiting for the reset at {iso(resume_after)}", None
    if resume_after is not None and not paused_by_usage(marker):
        why = "the pause marker does not read cause=usage"
        return False, f"usage watch: not resuming ({why})", why
    if resume_after is None:
        line = weekly_pause(raw, raw_why, now, weekly_at)
        if line:
            return True, line, None
    rec, why = five_hour(raw, raw_why, now)
    if rec is None:
        return False, f"usage watch: no trusted reading ({why})", why
    pct = rec["pct"]
    if resume_after is None:
        if pct >= pause_at:
            return True, five_hour_pause_line(rec), None
        return False, f"usage watch: holding, pct={pct:g} below {pause_at:g}, resets_at={iso(rec['reset'])}", None
    if pct < pause_at:
        line = weekly_pause(raw, raw_why, now, weekly_at)
        if line:
            return True, line, None
        return True, f"USAGE-RESUME pct={pct:g}", None
    return False, f"usage watch: holding, post-reset pct={pct:g} still at or above {pause_at:g}", None


def week_reset_since(path, now):
    """Whether the status-line file, fresh or stale, names a seven_day_resets_at already past."""
    try:
        with open(path) as fh:
            reset = json.load(fh).get("seven_day_resets_at")
    except (OSError, ValueError, RecursionError, AttributeError):
        return False
    return isinstance(reset, (int, float)) and not isinstance(reset, bool) and reset <= now


def decide_weekly_resume(raw, raw_why, now, pause_at, weekly_at, marker, path=None):
    """--resume-weekly: lift a weekly pause on a trusted reading under W, unless the five-hour line now binds."""
    if not paused_by_usage(marker):
        why = "the pause marker does not read cause=usage"
        return False, f"usage watch: not resuming ({why})", why
    wk, why = weekly(raw, raw_why, now)
    if wk is None:
        # A stale file (an idle or asleep session stops re-rendering the status line) says nothing about the week,
        # so, as the five-hour watch before E, it wakes the paused hub only once its last reading's own weekly reset
        # has passed; a fresh file whose figure the reset cleared is the dead feed that wakes it, and a missing,
        # unreadable or ts-less file is reported at once, as every other untrusted reading is.
        stale = raw is None and why.startswith("stale")
        dead = why if not stale or (path is not None and week_reset_since(path, now)) else None
        return False, f"usage watch: no trusted reading ({why})", dead
    if wk["pct"] >= weekly_at:
        return False, f"usage watch: holding, weekly pct={wk['pct']:g} still at or above {weekly_at:g}", None
    five, _ = five_hour(raw, raw_why, now)
    if five is not None and five["pct"] >= pause_at:
        return True, five_hour_pause_line(five), None
    return True, f"USAGE-RESUME cause=weekly pct={wk['pct']:g}", None


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
    p.add_argument("--weekly-pause-at", type=_pct, default=float(WEEKLY_PAUSE_AT),
                   help=f"the weekly threshold W, in percent (default {WEEKLY_PAUSE_AT})")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--resume-after", type=_when, help="resume mode: the five-hour reset the pause waits for")
    mode.add_argument("--resume-weekly", action="store_true", help="resume mode for a weekly pause")
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
        fires, line, dead = decide(path, now, a.pause_at, a.resume_after, marker, a.weekly_pause_at, a.resume_weekly)
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
