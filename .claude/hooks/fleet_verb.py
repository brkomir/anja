#!/usr/bin/env python3
"""Fleet verbs: `/pause --fleet` and `/pre-compact --fleet` typed in one session reach every other open session.

Prevents: NEW class — the owner typing the same lifecycle command into 2-5 sessions within minutes (75 of 500
same-command clusters, 2026-10-08..15; lifecycle commands were 381 of the owner's 578 typed slash commands that week).

Commands that act on every session at once are an opt-in addition: the per-session forms stay, `--fleet` is
opt-in per invocation, and the per-session listener rule stands.

How it travels (no new hook registration; this module is called by auto-precompact-trigger.py, which already runs
on every PostToolUse and UserPromptSubmit of the main session):
  * the AUTHORITY is the owner's own typed command: a record in .claude/logs/skill-invocations.jsonl with
    source "user-prompt" (written by log-user-slash-commands.sh at UserPromptSubmit, never by a seat's Skill call),
    skill pause or pre-compact, and `--fleet` among its words, AND the same typed command in the origin session's
    own transcript (typed_in_origin: main chain, a human turn origin, within 10 s). A mail or a marker from another
    seat is never enough on its own.
  * the WAKE is a broadcast mail the origin seat sends (pause/SKILL.md § Fleet): it wakes idle seats through their
    mail listener, and the turn it starts runs the hooks that call this module.
  * each other seat runs the same command once, without `--fleet`: the newest qualifying record from ANOTHER
    session, at most WINDOW_S old, newer than the seat's handled mark (.claude/state/fleet-handled-<sid8>) and not
    older than the seat itself (a session opened after the command is left alone).
  * a seat parked by /standby is marked handled and told nothing: it stays deaf, as /standby promises.
  * two fleet commands inside one window: the NEWER one is delivered and the older is superseded, whatever its verb
    (the owner's latest word is the one that stands); a seat that takes no turn inside the window is not reached at all.
"""
import json
import os
import re
from datetime import datetime, timezone

VERBS = ("pause", "pre-compact")
WINDOW_S = 600
LOG_TAIL = 1_048_576        # the window is 10 minutes; the log grows ~31 KB a day
ORIGIN_TAIL = 8_388_608     # the origin's typed record is at most WINDOW_S old
# The args travel as typed, flags or plain words alike ("--resume 15m", "and resume in 58 minutes from now"):
# the earlier filter (at most 6 words of [-A-Za-z0-9:.]{1,16}) refused plain-English wording, and 14 typed /pause
# commands would not have travelled. Only the command itself travels: the line is cut at the first `&&` or `;`
# (FLEET_CUT), so "--resume && /explain ..." reaches the other seats as "--resume" and the rest stays in the seat
# it was typed in (otherwise every seat would act on the whole line). A slash word does NOT cut: a slash-bearing
# line such as "--resume as /wrap ..." would have travelled as "--resume as", which pause/SKILL.md reads as the
# resume signal, and the slash cut also cut absolute paths ("after /tmp/x lands").
# Refused (relay_refuses): a backtick in the part that travels (it would break the code spans that show it; the rest
# of the line is never shown), a line break or other control character anywhere in the line (one typed line only),
# more than ARG_MAX characters in the part that travels, --fleet included. The authority is still typed_in_origin,
# never the shape of the words.
ARG_MAX = 300
ARG_CTRL = re.compile(r"[\x00-\x08\x0a-\x1f\x7f]")
FLEET_CUT = re.compile(r"&&|;")


def fleet_part(args):
    """The part of the owner's typed args that travels: everything before the first `&&` or `;`."""
    a = str(args or "")
    m = FLEET_CUT.search(a)
    return " ".join((a[:m.start()] if m else a).split())


def is_fleet(args):
    """--fleet among the words of the part that travels; after the cut it belongs to the second command. The one
    test of "is this a fleet command", for the relay and --who-missed alike."""
    return "--fleet" in fleet_part(args).split()


def relay_refuses(args):
    """True when the relay will not send this typed line: a backtick in the part that travels (it would break the
    code spans that show it), a control byte anywhere (one typed line only), or a travelling part over ARG_MAX."""
    part = fleet_part(args)
    return "`" in part or bool(ARG_CTRL.search(str(args or ""))) or len(part) > ARG_MAX


RETRY_S = 30                # a failed origin check on a record this young is looked at again on the next run
# post-compact/SKILL.md Step 4 (e): a slash-command user record from one of these turn origins is a machine, not the owner.
# skill-invocations.jsonl cannot tell: log-user-slash-commands.sh logs a scheduled (CronCreate) slash prompt as
# source user-prompt (2026-10-06T02:43:00Z /pause resume from a session's own one-shot; 9 /review-hub fires in
# another session).
# An AUTHORITY check, so the polarity is the opposite of scripts/post-compact-recovery-index.py's deny-list of
# {"task_notification", "peer", "auto_continuation", "scheduled"} (that one surfaces text and fails toward the owner;
# this one grants a command and must fail toward refusing it): an origin never seen here is not the owner. None = an older
# harness that predates the field.
OWNER_ORIGINS = {None, "human"}


def typed_in_origin(rec, receiver_tp):
    """True only when the origin session's own transcript holds a main-chain, non-machine user record of this
    command with --fleet in its args within 10 s of the log record. A same-uid process can still forge both files;
    this closes the log-only forgery and the scheduled-prompt laundering, nothing more."""
    sess, t = str(rec.get("session") or ""), parse_ts(rec.get("ts"))
    if t is None or not isinstance(receiver_tp, str) or not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f-]{27}", sess):
        return False
    path = os.path.join(os.path.dirname(receiver_tp), sess + ".jsonl")
    needle = ("<command-name>/%s</command-name>" % rec["skill"]).encode()
    try:
        with open(path, "rb") as f:
            f.seek(max(0, os.path.getsize(path) - ORIGIN_TAIL))
            data = f.read()
    except OSError:
        return False
    for raw in data.split(b"\n"):
        if needle not in raw:
            continue
        try:
            r = json.loads(raw)
        except ValueError:
            continue
        if not isinstance(r, dict):
            continue
        c = (r.get("message") or {}).get("content")
        if (r.get("type") != "user" or r.get("isSidechain") or r.get("isMeta") or r.get("isCompactSummary")
                or r.get("turnOrigin") not in OWNER_ORIGINS or not isinstance(c, str)):
            continue
        m = re.search(r"<command-args>(.*?)</command-args>", c, re.S)
        rt = parse_ts(str(r.get("timestamp") or "")[:19] + "Z")
        if m and is_fleet(m.group(1)) and rt is not None and abs(rt - t) <= 10:
            return True
    return False


# parse_ts is duplicated in precompact-save-guard.py on purpose: revisit at a THIRD
# Python reader of skill-invocations.jsonl. The fleet-claim-<sid8>-<ts> files are never pruned: prune when
# `ls .claude/state/fleet-claim-* | wc -l` passes 1000.
def parse_ts(s):
    # The ts format log-user-slash-commands.sh writes (`date -u +%Y-%m-%dT%H:%M:%SZ`). precompact-save-guard.py
    # carries the same four lines; a THIRD Python reader of skill-invocations.jsonl moves this function to
    # .claude/hooks/lib/skill_log.py instead of copying it. The record FILTERS stay
    # apart: this file asks "did the OWNER command it", the guard asks "is a save the owner did not leave to a model in flight".
    try:
        return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
    except (TypeError, ValueError):
        return None


def pending(log_text, my_session, handled, started, now):
    """The newest owner-typed fleet record this session still owes, or None."""
    owed = candidates(log_text, my_session, handled, started, now)
    return owed[0] if owed else None


def candidates(log_text, my_session, handled, started, now):
    """Every owner-typed fleet record this session still owes, newest first. check() authenticates them in
    that order, so an unverifiable newer line can never supersede a verified older one."""
    owed = []
    for line in log_text.splitlines():
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if not isinstance(r, dict) or r.get("source") != "user-prompt" or r.get("skill") not in VERBS:
            continue
        args = str(r.get("args") or "")
        if not is_fleet(args) or r.get("session") == my_session:
            continue
        if relay_refuses(args):
            continue
        t = parse_ts(r.get("ts"))
        if t is None or now - t > WINDOW_S or t > now + 60:
            continue
        if handled is not None and t <= handled:
            continue
        if started is not None and t < started:
            continue
        owed.append((t, r))
    return sorted(owed, key=lambda x: x[0], reverse=True)


def local_args(args):
    return " ".join(w for w in fleet_part(args).split() if w != "--fleet")


def directive(rec):
    verb, here = rec["skill"], local_args(rec.get("args"))
    command = ("/%s %s" % (verb, here)).strip()
    return ("⏳ FLEET %s — the owner typed `/%s %s` in session %s at %s to act on every open session (anything the owner "
            "added after a `&&` or `;` was for that session only and is not shown). Run `%s` "
            "NOW through the Skill tool, before anything else in this turn, exactly as if the owner had typed it here; a "
            "relative time in it counts from when the owner typed it, the time above, not from now. "
            "Verified: an owner-typed record (source user-prompt) in .claude/logs/skill-invocations.jsonl, not a "
            "mail. See pause/SKILL.md § Fleet." % (
                verb.upper(), verb, fleet_part(rec.get("args")), str(rec.get("session") or "")[:8],
                rec.get("ts"), command))


def check(inp, root, state_dir, sid8, now=None):
    """-> the directive text for this seat, or None. Records the handled mark as a side effect."""
    session = str(inp.get("session_id") or "")
    if not session or os.environ.get("FLEET_VERB_OFF") == "1":   # the relay's own off switch, owned here
        return None
    now = now if now is not None else datetime.now(timezone.utc).timestamp()
    try:
        with open(os.path.join(root, ".claude", "logs", "skill-invocations.jsonl"), "rb") as f:
            f.seek(max(0, os.path.getsize(f.name) - LOG_TAIL))
            log_text = f.read().decode("utf-8", errors="replace")
    except OSError:
        return None
    mark = os.path.join(state_dir, "fleet-handled-%s" % sid8)
    try:
        with open(mark) as f:
            handled = float(f.read().strip())
    except (OSError, ValueError):
        handled = None
    started = None
    tp = inp.get("transcript_path")
    if isinstance(tp, str) and os.path.isfile(tp):
        try:
            started = getattr(os.stat(tp), "st_birthtime", None)
        except OSError:
            started = None
    elif isinstance(tp, str):
        started = now       # the harness writes the transcript AFTER the first prompt's hooks: this session is new
    owed = candidates(log_text, session, handled, started, now)
    if not owed:
        return None
    os.makedirs(state_dir, exist_ok=True)
    for t, r in owed:
        # Claim each record for this seat atomically: hook runs overlap (a tool call's PostToolUse and the next
        # prompt), so without the claim 4 overlapping runs delivered one command 4 times (20 of 20
        # trials). The claim is also the record's "examined" mark, so a forged line costs one origin read once it
        # is RETRY_S old.
        claim = os.path.join(state_dir, "fleet-claim-%s-%.0f" % (sid8, t))
        try:
            os.close(os.open(claim, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
        except FileExistsError:
            continue
        standby = os.path.exists(os.path.join(state_dir, "session-standby-%s" % sid8))
        if standby or typed_in_origin(r, tp):
            with open(mark, "w") as f:
                f.write("%.0f" % t)  # only an authenticated (or parked-and-dropped) record supersedes older ones
            return None if standby else directive(r)
        if now - t < RETRY_S:
            # The origin's own transcript record is written after its UserPromptSubmit hooks run (~125 ms measured),
            # so an early check can fail on the owner's genuine command: release the claim and look again next run, or the
            # command is lost here and --who-missed lists this seat as "took it".
            try:
                os.unlink(claim)
            except OSError:
                pass
    return None


def who_missed(sessions, origin, verb_ts, has_claim, is_parked):
    """Sort the other open sessions after a fleet command at verb_ts. sessions: dicts with sessionId, name,
    startedAt (ms), status, and `_unreachable` (cwd under the checkout but not the checkout itself: a worktree or a
    subdirectory, set by the caller). has_claim returns True when this command was DELIVERED there and "newer" when
    only a LATER fleet command was. -> a dict of display-name lists: took, newer, parked, after, unreachable, busy,
    missed (delivery, not the claim, decides took, in the order below)."""
    out = {k: [] for k in ("took", "newer", "parked", "after", "unreachable", "busy", "missed")}
    for r in sessions:
        sid = str(r.get("sessionId") or "")
        if not sid or sid == origin:
            continue
        name = "%s (%s)" % (r.get("name") or "unnamed", sid[:8])
        try:
            started = float(r.get("startedAt")) / 1000.0
        except (TypeError, ValueError):
            started = None
        claim = has_claim(sid[:8])
        if is_parked(sid[:8]):      # first: check() writes the claim BEFORE its standby test, so a parked seat
            out["parked"].append(name)  # that takes any turn in the window holds a claim and was told nothing
        elif claim == "newer":      # it took a LATER fleet command (the owner's newer word supersedes this one)
            out["newer"].append(name)
        elif claim:
            out["took"].append(name)
        elif started is not None and started > verb_ts:   # left alone wherever it runs, as the fleet design says
            out["after"].append(name)
        elif r.get("_unreachable"):  # its transcripts live in another project folder: the command never authenticates
            out["unreachable"].append(name)
        elif str(r.get("status") or "") == "busy":  # mid-turn in the checkout: it takes it at its next tool call
            out["busy"].append(name)
        else:
            out["missed"].append(name)
    return out


def list_agents(run=None):
    """`claude agents --json` -> a list, or None when the CLI failed (no binary, timeout, rc != 0, empty or
    non-list output). None must never read as an empty fleet."""
    import subprocess
    run = run or subprocess.run
    try:
        p = run(["claude", "agents", "--json"], capture_output=True, text=True, timeout=60)
        if p.returncode != 0:
            return None
        v = json.loads(p.stdout)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    return v if isinstance(v, list) else None


def report_who_missed(root, origin, agents):
    """The typing seat's check about a minute after its fleet command: which open sessions in this repo took it,
    and which the owner must type it in."""
    state_dir = os.path.join(root, ".claude", "state")
    try:
        with open(os.path.join(root, ".claude", "logs", "skill-invocations.jsonl"), encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
    except OSError:
        return "who-missed: the command log is unreadable, so nothing can be checked."
    mine = stray = None     # stray: --fleet only after the cut, which candidates() never relays
    typed_at = {}           # whole-second ts -> the owner-typed fleet command logged then (to name a newer one)
    for line in lines:
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if (isinstance(r, dict) and r.get("source") == "user-prompt" and r.get("skill") in VERBS
                and is_fleet(r.get("args")) and parse_ts(r.get("ts")) is not None):
            typed_at["%.0f" % parse_ts(r.get("ts"))] = "/%s %s" % (r["skill"], local_args(r.get("args")))
        if (isinstance(r, dict) and r.get("session") == origin and r.get("source") == "user-prompt"
                and r.get("skill") in VERBS and "--fleet" in FLEET_CUT.sub(" ", str(r.get("args") or "")).split()):
            # the cut is a word boundary here, as in fleet_part: "--fleet;" is the fleet word and "&&--fleet" a stray
            t = parse_ts(r.get("ts"))
            if t is None:
                continue
            if is_fleet(r.get("args")):
                if mine is None or t > mine[0]:
                    mine = (t, r)
            elif stray is None or t > stray[0]:
                stray = (t, r)
    if stray is not None and (mine is None or stray[0] > mine[0]):
        return ("who-missed: in `/%s %s` the --fleet comes after a `&&` or `;`, so no other session was sent "
                "anything. Type the command that carries --fleet on a line of its own." % (
                    stray[1]["skill"], " ".join(str(stray[1].get("args") or "").split())))
    if mine is None:
        return "who-missed: no /pause --fleet or /pre-compact --fleet typed in this session."
    t, rec = mine
    rr = os.path.realpath(root)
    here = []
    for a in agents:        # this checkout or anywhere under it; a session below it is listed, never dropped
        cwd = os.path.realpath(str(a.get("cwd") or ""))
        if cwd == rr or cwd.startswith(rr + os.sep):
            here.append(dict(a, _unreachable=cwd != rr))

    newer_at = {}

    def has_claim(s8):
        # check() writes the claim BEFORE it authenticates, so a claim only says "examined"; the handled mark is
        # written only on delivery (or a parked drop, sorted first), so delivery is read from it.
        try:
            with open(os.path.join(state_dir, "fleet-handled-%s" % s8)) as f:
                handled = float(f.read().strip())
        except (OSError, ValueError):
            return False
        if handled < t:
            return False
        if os.path.exists(os.path.join(state_dir, "fleet-claim-%s-%.0f" % (s8, t))):
            return True
        if handled > t:
            newer_at[s8] = handled
            return "newer"
        return False

    res = who_missed(here, origin, t, has_claim,
                     lambda s8: os.path.exists(os.path.join(state_dir, "session-standby-%s" % s8)))
    # name the newer command each such seat ran, so "took a newer one" says WHAT it ran instead
    res["newer"] = ["%s ran `%s`" % (n, typed_at.get("%.0f" % newer_at.get(n[-9:-1], 0), "an unnamed command").strip())
                    for n in res["newer"]]
    cmd = ("/%s %s" % (rec["skill"], local_args(rec.get("args")))).strip()
    rows = ["who-missed for `/%s %s` typed at %s (%d other open sessions in this repo):" % (
        rec["skill"], fleet_part(rec.get("args")), rec.get("ts"), sum(len(v) for v in res.values()))]
    if relay_refuses(rec.get("args")):
        rows.append("  the relay refused this line (a backtick or over %d characters in the part that travels, or a "
                    "control character), so no session was sent it" % ARG_MAX)
    for key, label in (("missed", "NOT REACHED — type `%s` there yourself" % cmd),
                       ("unreachable", "in a worktree or subdirectory, which no fleet command can reach — type `%s` "
                                       "there yourself" % cmd),
                       ("busy", "busy mid-turn, takes it at its next tool call (run --who-missed again to confirm)"),
                       ("took", "took it"), ("newer", "took a newer fleet command instead"),
                       ("parked", "parked by /standby, skipped on purpose"), ("after", "opened after the command, left alone")):
        if res[key]:
            rows.append("  %s: %s" % (label, ", ".join(res[key])))
    return "\n".join(rows)


def self_test():
    ok = True

    def t(name, cond):
        nonlocal ok
        ok &= bool(cond)
        print(("PASS  " if cond else "FAIL  ") + name)

    def rec(ts, skill="pause", args="--fleet", session="origin", source="user-prompt"):
        return json.dumps({"ts": ts, "skill": skill, "args": args, "session": session, "source": source})

    now = parse_ts("2026-10-17T10:10:00Z")
    base = rec("2026-10-17T10:05:00Z")
    t("an owner-typed /pause --fleet from another session, 5 minutes old, is owed",
      pending(base, "me", None, None, now)[1]["skill"] == "pause")
    t("the origin session itself, a seat's own Skill call, or a command without --fleet is not",
      pending(base, "origin", None, None, now) is None
      and pending(rec("2026-10-17T10:05:00Z", source="skill-tool"), "me", None, None, now) is None
      and pending(rec("2026-10-17T10:05:00Z", args="--resume 15m"), "me", None, None, now) is None)
    t("a word that only contains the flag is not the flag; another skill is not a verb",
      pending(rec("2026-10-17T10:05:00Z", args="--fleetwide"), "me", None, None, now) is None
      and pending(rec("2026-10-17T10:05:00Z", skill="compact"), "me", None, None, now) is None)
    t("older than the window, already handled, or older than this session is not owed",
      pending(rec("2026-10-17T09:59:00Z"), "me", None, None, now) is None
      and pending(base, "me", parse_ts("2026-10-17T10:05:00Z"), None, now) is None
      and pending(base, "me", None, parse_ts("2026-10-17T10:06:00Z"), now) is None)
    two = "\n".join([rec("2026-10-17T10:02:00Z", skill="pre-compact", args="--fleet --disarm"), base, "junk"])
    t("the newest owed record wins", pending(two, "me", None, None, now)[1]["skill"] == "pause")
    t("the local command drops only --fleet",
      local_args("--fleet --disarm") == "--disarm" and local_args("--compact --fleet --resume 15m") == "--compact --resume 15m")
    d = directive({"skill": "pre-compact", "args": "--fleet --disarm", "session": "abcdef12-xx", "ts": "2026-10-17T10:02:00Z"})
    t("the directive names the local command and the origin", "`/pre-compact --disarm`" in d and "abcdef12" in d)
    sess = [{"sessionId": "aaaaaaaa-1", "name": "a", "startedAt": "1000000"},
            {"sessionId": "bbbbbbbb-1", "name": "b", "startedAt": "1000000"},
            {"sessionId": "cccccccc-1", "name": "c", "startedAt": "1000000"},
            {"sessionId": "dddddddd-1", "name": "d", "startedAt": "5000000"},
            {"sessionId": "origin", "name": "o", "startedAt": "1000000"}]
    w = who_missed(sess, "origin", 2000.0, lambda s8: s8 == "aaaaaaaa", lambda s8: s8 == "bbbbbbbb")
    t("who-missed sorts took / parked / opened-after / missed, and never lists the typing seat",
      {k: v for k, v in w.items() if v} == {"took": ["a (aaaaaaaa)"], "parked": ["b (bbbbbbbb)"], "after": ["d (dddddddd)"],
                                             "missed": ["c (cccccccc)"]})
    more = [{"sessionId": "eeeeeeee-1", "name": "e", "startedAt": "1000000", "status": "busy"},
            {"sessionId": "ffffffff-1", "name": "f", "startedAt": "1000000", "_unreachable": True},
            {"sessionId": "99999999-1", "name": "n", "startedAt": "1000000"},
            {"sessionId": "88888888-1", "name": "bu", "startedAt": "1000000", "status": "busy", "_unreachable": True},
            {"sessionId": "77777777-1", "name": "ba", "startedAt": "5000000", "status": "busy", "_unreachable": True}]
    w = who_missed(more, "origin", 2000.0, lambda s8: "newer" if s8 == "99999999" else False, lambda s8: False)
    t("a busy seat, an unreachable seat and a seat that took a newer command each get their own line, never NOT REACHED",
      w["busy"] == ["e (eeeeeeee)"] and w["newer"] == ["n (99999999)"] and w["missed"] == [])
    t("unreachable beats busy (it never takes it), and opened-after beats both (left alone)",
      w["unreachable"] == ["f (ffffffff)", "bu (88888888)"] and w["after"] == ["ba (77777777)"])
    w = who_missed(sess[1:2], "origin", 2000.0, lambda s8: True, lambda s8: True)
    t("a parked seat that holds a claim (check() claims before its standby test) reads parked, not took",
      w["parked"] == ["b (bbbbbbbb)"] and w["took"] == [])
    class P:
        def __init__(self, rc, out): self.returncode, self.stdout = rc, out
    t("a failed `claude agents --json` is None, never an empty fleet",
      list_agents(lambda *a, **k: P(1, "[]")) is None and list_agents(lambda *a, **k: P(0, "")) is None
      and list_agents(lambda *a, **k: P(0, "{}")) is None and list_agents(lambda *a, **k: P(0, "[]")) == [])
    print("\nself-test: ALL PASS" if ok else "\nself-test: FAILURES")
    return 0 if ok else 1


if __name__ == "__main__":
    import sys
    if sys.argv[1:] == ["--self-test"]:
        sys.exit(self_test())
    if sys.argv[1:2] == ["--who-missed"]:
        origin = os.environ.get("CLAUDE_CODE_SESSION_ID", "")
        if not origin:
            print("who-missed: CLAUDE_CODE_SESSION_ID is unset, so this session's own command cannot be found.")
            sys.exit(1)
        # optional: --agents-json <file> stands in for `claude agents --json` (tests)
        if sys.argv[2:3] == ["--agents-json"] and len(sys.argv) > 3:
            with open(sys.argv[3]) as f:
                agents = json.load(f)
            agents = agents if isinstance(agents, list) else None
        else:
            agents = list_agents()
        if agents is None:
            print("who-missed: `claude agents --json` failed, so the open sessions cannot be listed.")
            sys.exit(1)
        root = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
        print(report_who_missed(root, origin, agents))
        sys.exit(0)
    sys.exit(0)
