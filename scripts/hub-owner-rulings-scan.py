#!/usr/bin/env python3
"""Owner speech across EVERY session, for the hub's queue.

Why this exists (2026-09-16): the queue's other four instruments
(review-request-closure-scan.mjs, hub-unfinished-loops.py, hub-open-promises.py,
review-queue.py) are ALL mail- or sha-keyed. Not one reads owner speech, in any
transcript. The owner types into ONE seat at a time, so a ruling that binds the hub
routinely lands in a PEER's transcript and is invisible to every probe the hub runs
over its own. Measured that day: an open product question was ruled in a peer
session and reported to the owner as still-pending TWICE in
one turn, ~30 minutes after the fact. Fourth error of that shape in a day.

Read-only. Prints a WORKLIST you read, never a verdict: a message here may be an
answer to a peer's question that has nothing to do with the hub's queue. The point
is that you SEE it before you tell the owner an item still needs the owner.

Populations walked (the /post-compact Step 4 owner-speech table -- re-read it there; this
line said five while (f) was implemented, then six while the table grew (b2) and (g)):
  (a) user records, promptSource == "typed"
  (b) user records, promptSource == "queued"
  (b2) user records, promptSource == "suggestion_accepted" (an accepted suggested prompt)
  (g) a tool call the owner REJECTED, keyed on toolDenialKind == "user-rejected" -- a STOP
  (c) attachments, commandMode == "prompt" AND origin.kind == "human"
  (d) system records, subtype == "local_command"
  (e) user records with no promptSource carrying <command-name> (slash commands,
      whose ARGUMENTS are the owner's own words)
  (f) answered AskUserQuestion, keyed on toolUseResult.answers -- see the leg

usage: hub-owner-rulings-scan.py [--hours N] [--since ISO8601] [--all-sessions]
"""
import argparse, glob, json, os, sys, datetime as dt

ROOT = os.path.expanduser("~/.claude/projects/<project-key>")
# cheap pre-filter: these substrings gate which LINES get parsed at all.
# (f) DISPLAY TEXT ONLY -- NOT THE KEY. ⛔ DO NOT DELETE THESE AS DEAD STRINGS.
# The (f) leg keys on `toolUseResult.answers`; these two constants only pick the
# human-readable line to show in a worklist, where the raw content string beats a
# serialized map for someone scanning. A constant that cannot decide MEMBERSHIP
# cannot cause the failure this file's history is about -- and that history is why
# the obvious tidy-up here is wrong: a string key WAS the key once and was wrong in
# both directions at once (see the leg). BOTH shapes are live: 428 and 63 across
# this machine's 513 AskUserQuestion calls (measured 2026-09-21).
ASKED = ("Your questions have been answered:", "The user answered:")
PREFILTER = ('"promptSource"', '"local_command"', '"commandMode"', "<command-name>",
             '"answers"', '"toolDenialKind"') + ASKED


def owner_records(path, since_iso):
    out = []
    try:
        fh = open(path, errors="ignore")
    except OSError:
        return out
    with fh:
        for line in fh:
            if not any(p in line for p in PREFILTER):
                continue
            try:
                r = json.loads(line)
            except Exception:
                continue
            ts = r.get("timestamp") or ""
            if not ts or ts < since_iso:
                continue
            t, ps = r.get("type"), r.get("promptSource")
            at = r.get("attachment") or {}
            msg = r.get("message") if isinstance(r.get("message"), dict) else {}
            c = msg.get("content")
            txt = c if isinstance(c, str) else (json.dumps(c) if c else "")
            tur = r.get("toolUseResult")
            tur = tur if isinstance(tur, dict) else {}
            kind = None
            if t == "user" and ps in ("typed", "queued", "suggestion_accepted") \
                    and not r.get("isMeta"):
                kind = {"typed": "a", "queued": "b"}.get(ps, "b2")
            elif t == "user" and r.get("toolDenialKind") == "user-rejected":
                kind = "g"  # machine kinds (permission-rule, automode-*) share the field
            elif t == "attachment" and at.get("commandMode") == "prompt" \
                    and (at.get("origin") or {}).get("kind") == "human":
                pr = at.get("prompt")
                kind, txt = "c", pr if isinstance(pr, str) else json.dumps(pr or at)
            elif t == "system" and r.get("subtype") == "local_command":
                kind = "d"
                txt = txt or json.dumps({k: v for k, v in r.items() if k != "message"})
            elif t == "user" and isinstance(tur.get("answers"), dict) and tur["answers"]:
                # ⛔ NON-EMPTY IS LOAD-BEARING. A question that TIMED OUT still carries
                # `toolUseResult.answers` -- as an EMPTY dict -- with the content string
                # "No response after 60s -- the user may be away from keyboard." The owner
                # answered NOTHING. Keying on `isinstance(..., dict)` alone reports that
                # as a ruling, which is this section's own expensive direction: inventing
                # owner speech where there was silence. Measured 2026-09-21 over 513
                # AskUserQuestion calls: 494 records carry the dict, 491 non-empty, 3 empty
                # timeouts. Found by chasing a one-record gap -- which is the
                # shape a missing population makes when you look at it through two prefilters.
                # (f) AskUserQuestion ANSWERS — the SIXTH population, and the one it is
                # worst to be blind to: every owner FORK decision lands here and leaves
                # NO typed record anywhere. It is a type:"user" record with no
                # promptSource, no <command-name>, no attachment and no text block — the owner's
                # choice arrives as a tool_result. All five populations above are correct
                # and all five miss it. Found 2026-09-16 by a seat just reported as
                # unable to show an authorisation: it existed, on this channel, and the
                # blocking question had been answered two hours after it was asked.
                #
                # ⛔ THE KEY IS `toolUseResult.answers`, NOT THE CONTENT STRING, AND THE
                # TWO REASONS PULL IN OPPOSITE DIRECTIONS — both measured 2026-09-21 over
                # every transcript on this machine (513 AskUserQuestion calls):
                #
                #   UNDER-MATCH. There are TWO live content shapes, not one:
                #   "Your questions have been answered:" at 428 and "The user answered:"
                #   at 63. This leg keyed on the first ALONE, so it false-zeroed on
                #   12.8% of the population — including the newest answered question in
                #   the corpus. A zero here reads as "the owner never ruled", which is the
                #   direction that overrules the owner.
                #
                #   OVER-MATCH. `startswith` was documented here as the guard against
                #   this probe's own output, on the reasoning that only a genuine answer
                #   BEGINS with the phrase. That is FALSE and there is a live instance:
                #   a BASH tool_result whose
                #   stdout begins with it — because a probe that greps and prints a
                #   matched answer prints it at offset 0. Position cannot separate a
                #   quotation from an instance.
                #
                # `toolUseResult.answers` is harness-stamped, so nothing this probe runs
                # can forge it. ⛔ CENSUS BY ID-SET FILTER, NOT BY CONTENT STRING -- four
                # successive readings here (492, 494, 495, and a "both are right" bridge
                # clause reconciling two of them) were each bounded by a prefilter that could
                # not see a shape it did not name, and every one of them was published as
                # settled. The prefilter, not the arithmetic, was the question each time.
                # Filtering on the collected tool_use IDS instead: 513 calls, 513 linked
                # results, 0 without one. 491 carry a NON-EMPTY answers dict -- exactly the
                # genuine answers. THE OTHER 22 ARE NOT ANSWERS: 18 owner CANCELLATIONS
                # ("The user doesn't want to proceed with this tool use"), 3 timeouts, 1
                # InputValidationError. ⚠️ SO THE LINK ALONE IS NOT THE PREDICATE EITHER: it
                # admits all 22. Link AND non-empty answers reads 491 of 491, no miss and no
                # over-report. A cancellation carries no toolUseResult at all, so it is
                # excluded INCIDENTALLY rather than by design -- named so the next reader
                # hardening this leg reasons from 22 and not from 4. ASKED is DISPLAY only.
                kind = "f"
                if isinstance(c, list):
                    for b in c:
                        if isinstance(b, dict) and b.get("type") == "tool_result" \
                                and isinstance(b.get("content"), str) \
                                and b["content"].startswith(ASKED):
                            txt = b["content"]
                            break
                else:
                    txt = json.dumps(tur["answers"])
            elif t == "user" and ps is None and not r.get("isMeta") \
                    and not r.get("isCompactSummary") \
                    and isinstance(c, str) and "<command-name>" in c:
                # ⛔ `isCompactSummary` IS THE SECOND GUARD AND IT IS NOT REDUNDANT WITH THE
                # STRING ONE BELOW. A compaction summary is type:"user", has no promptSource,
                # no isMeta, and its content IS a string -- and it QUOTES <command-name>,
                # because the summary reproduces the session's own slash commands. So it
                # satisfies every other clause here. Measured fleet-wide 2026-09-21: the
                # predicate without this guard matches 2,741 records of which 69 (2.5%) are
                # compaction summaries, reported as owner rulings. Found by running
                # a compaction recovery and watching (e) return the recovery's OWN summary record.
                # isinstance(c, str) is LOAD-BEARING, not a type nicety: a genuine slash
                # command arrives as a STRING, while a tool_result arrives as a LIST of
                # blocks — and this probe reads transcripts, so its own output records
                # contain "<command-name>" verbatim. Without it the scan matches itself
                # (measured at authorship: 2 of 15 rows were this seat's own earlier
                # owner-speech probes). Exclude in the QUERY, never in the reading.
                kind = "e"
            if kind:
                # every branch above can still yield a non-str (a content LIST, a structured
                # prompt) — coerce once, here, rather than trusting each branch. Shipped
                # without this and the first wider run died on an attachment whose `prompt`
                # was a list; the authorship control had only reached typed records.
                if not isinstance(txt, str):
                    txt = json.dumps(txt)
                out.append((ts, kind, txt))
    return out


# ---------------------------------------------------------------------------
# SELF-TEST. Added (2026-09-21) after two defects landed in a
# file whose only check was that it parses. Written by one seat, reviewed by
# another: the author of a change cannot be its own breaker, so the split is write /
# review, not write / self-approve.
#
# ⛔ EVERY ARM CARRIES A CONTROL THAT MUST READ THE OTHER WAY. A population arm
# that only ever asserts a POSITIVE cannot detect a predicate that matches
# everything, which is exactly the shape both shipped defects had: (e) matched a
# compaction summary, and (f)'s old string key matched a Bash result.
#
# ⛔ AND EVERY FIXTURE LINE IS CHECKED FOR PREFILTER REACHABILITY FIRST. PREFILTER
# decides which lines are parsed at all, so a negative control that fails it is
# excluded for the WRONG REASON and passes vacuously -- the probe's own argument
# disabling the variable under test. The reachability loop is what makes the
# negative arms mean anything.
#
# The expectations below are LITERALS. Nothing is read back from the artifact
# under test, so the oracle and the subject are not the same bytes.

def _fixtures():
    """(label, record, expected_kind_or_None, why) -- one unique ts per record."""
    def ts(n):
        return "2026-09-21T00:%02d:00Z" % n
    f = []
    f.append(("a/typed POSITIVE", {
        "timestamp": ts(1), "type": "user", "promptSource": "typed",
        "message": {"content": "ship it"}}, "a", "the owner's typed words"))
    f.append(("a/typed CONTROL isMeta", {
        "timestamp": ts(2), "type": "user", "promptSource": "typed", "isMeta": True,
        "message": {"content": "injected spec text"}}, None,
        "isMeta is harness-injected, never the owner"))
    f.append(("b/queued POSITIVE", {
        "timestamp": ts(3), "type": "user", "promptSource": "queued",
        "message": {"content": "proceed"}}, "b", "queued is still the owner's"))
    f.append(("c/attachment POSITIVE", {
        "timestamp": ts(4), "type": "attachment",
        "attachment": {"commandMode": "prompt", "origin": {"kind": "human"},
                       "prompt": "do it"}}, "c", "human origin AND prompt mode"))
    f.append(("c/attachment CONTROL task-notification", {
        "timestamp": ts(5), "type": "attachment",
        "attachment": {"commandMode": "task-notification", "origin": {"kind": "human"},
                       "prompt": "Background command completed"}}, None,
        "machine output rides the SAME channel with origin.kind human -- commandMode "
        "is the only discriminator, and it has certified machine output as the owner before"))
    f.append(("d/local_command POSITIVE", {
        "timestamp": ts(6), "type": "system", "subtype": "local_command",
        "message": {"content": "<command-name>/model</command-name>"}}, "d",
        "a slash command as a system record"))
    f.append(("d/local_command CONTROL wrong type", {
        "timestamp": ts(7), "type": "assistant", "subtype": "local_command",
        "message": {"content": "narrating a <command-name> in prose"}}, None,
        "subtype alone is not the predicate -- type must be system"))
    f.append(("e/slash POSITIVE", {
        "timestamp": ts(8), "type": "user",
        "message": {"content": "<command-name>/eli5</command-name>"
                               "<command-args>why is the queue held</command-args>"}}, "e",
        "the ARGUMENTS are the owner's own words"))
    f.append(("e/slash CONTROL compaction summary", {
        "timestamp": ts(9), "type": "user", "isCompactSummary": True,
        "message": {"content": "This session is being continued... the owner ran "
                               "<command-name>/summary</command-name> earlier"}}, None,
        "THE INSTANCE SHIPPED 2026-09-21: a compaction summary is type user, has no "
        "promptSource, no isMeta, its content IS a string, and it quotes <command-name> "
        "because it reproduces the session's own slash commands -- every other clause "
        "satisfied. 69 of 2741 fleet-wide (2.5%) before the guard"))
    f.append(("e/slash CONTROL tool_result carrier", {
        "timestamp": ts(10), "type": "user",
        "message": {"content": [{"type": "tool_result", "tool_use_id": "toolu_x",
                                 "content": "grep output mentioning <command-name>"}]}},
        None, "a tool_result is ALSO type user with no promptSource -- the content "
              "being a LIST is the whole guard, else the scan matches its own output"))
    f.append(("f/answers POSITIVE", {
        "timestamp": ts(11), "type": "user",
        "toolUseResult": {"answers": {"Push now or wait?": "Wait for the translator"}},
        "message": {"content": [{"type": "tool_result", "tool_use_id": "toolu_y",
                                 "content": "The user answered: \"Wait for the translator\""}]}},
        "f", "keyed on the harness-stamped field, and this is the SECOND content shape "
             "-- the old single-shape string key false-zeroed on 12.8% of these"))
    f.append(("f/answers CONTROL probe output at offset 0", {
        "timestamp": ts(12), "type": "user",
        "message": {"content": [{"type": "tool_result", "tool_use_id": "toolu_z",
                                 "content": "Your questions have been answered: "
                                            "\"...\" -- printed by a grep in a Bash call"}]}},
        None, "THE COUNTER-EXAMPLE THAT KILLED `startswith`: a probe that greps and "
              "prints a matched answer prints it at OFFSET 0, so position cannot "
              "separate a quotation from an instance. Live in a real transcript"))
    f.append(("f/answers CONTROL timeout, answers EMPTY", {
        "timestamp": ts(14), "type": "user",
        "toolUseResult": {"answers": {}},
        "message": {"content": [{"type": "tool_result", "tool_use_id": "toolu_t",
                                 "content": "No response after 60s \u2014 the user may be away "
                                            "from keyboard. Proceed using your best judgment."}]}},
        None, "A TIMED-OUT question still carries an answers dict, EMPTY. The owner answered nothing. "
              "Keying on isinstance(dict) alone reports silence as a ruling -- 3 live records. "
              "This arm is why the predicate requires NON-EMPTY"))
    f.append(("f/answers CONTROL answers absent", {
        "timestamp": ts(13), "type": "user",
        "toolUseResult": {"stdout": "some other tool's result"},
        "message": {"content": [{"type": "tool_result", "tool_use_id": "toolu_w",
                                 "content": "Your questions have been answered: nope"}]}},
        None, "toolUseResult present but `answers` absent -- the field must be a dict, "
              "not merely present"))
    f.append(("b2/suggestion POSITIVE", {
        "timestamp": ts(15), "type": "user", "promptSource": "suggestion_accepted",
        "message": {"content": "go with option B"}}, "b2", "a suggested prompt the owner sent"))
    f.append(("g/rejected POSITIVE", {
        "timestamp": ts(16), "type": "user", "toolDenialKind": "user-rejected",
        "message": {"content": [{"type": "tool_result", "tool_use_id": "toolu_r",
                                 "content": "The user doesn't want to proceed"}]}}, "g", "the owner refused the call"))
    f.append(("g/rejected CONTROL hook deny", {
        "timestamp": ts(17), "type": "user", "toolDenialKind": "permission-rule",
        "message": {"content": [{"type": "tool_result", "tool_use_id": "toolu_s",
                                 "content": "denied by a hook"}]}}, None, "a machine deny, not the owner"))
    return f


def self_test():
    import tempfile
    fx = _fixtures()
    tmpd = tempfile.mkdtemp(prefix="hub-owner-rulings-selftest-")
    path = os.path.join(tmpd, "fixture.jsonl")
    lines = [json.dumps(rec) for _, rec, _, _ in fx]
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")

    fails = []
    # REACHABILITY FIRST -- a control PREFILTER drops is vacuous, not passing.
    for (label, _, _, _), line in zip(fx, lines):
        if not any(p in line for p in PREFILTER):
            fails.append("%s: VACUOUS -- line does not survive PREFILTER, so this arm "
                         "cannot fire either way" % label)
    print("  reachability: %d/%d fixture lines survive PREFILTER" %
          (sum(1 for l in lines if any(p in l for p in PREFILTER)), len(lines)))

    got = {}
    for ts, kind, _txt in owner_records(path, "2020-01-01T00:00:00Z"):
        got[ts] = kind

    for label, rec, expect, why in fx:
        actual = got.get(rec["timestamp"])
        ok = actual == expect
        print("  %-44s %-9s %s" % (label, "ok" if ok else "FAIL",
                                   "-> %r (%s)" % (actual, why[:96])))
        if not ok:
            fails.append("%s: expected %r, got %r -- %s" % (label, expect, actual, why))

    # A positive and a negative must EXIST in every population, or the matrix lies.
    for k in ("a", "b", "b2", "c", "d", "e", "f", "g"):
        pos = [x for x in fx if x[2] == k]
        if not pos:
            fails.append("population (%s) has no POSITIVE arm" % k)
    if not [x for x in fx if x[2] is None]:
        fails.append("no negative control in the whole matrix")

    try:
        os.remove(path); os.rmdir(tmpd)
    except OSError:
        pass

    if fails:
        print("\nSELF-TEST: FAIL (%d)" % len(fails))
        for f in fails:
            print("  - %s" % f)
        return 1
    print("\nSELF-TEST: PASS (%d arms, %d of them controls that must read the other way)"
          % (len(fx), sum(1 for x in fx if x[2] is None)))
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=float, default=6.0)
    ap.add_argument("--since")
    ap.add_argument("--all-sessions", action="store_true",
                    help="scan every transcript, not just those touched in the window")
    ap.add_argument("--self-test", action="store_true",
                    help="fixture arms for every population the post-compact table names, each with a control")
    a = ap.parse_args()
    if a.self_test:
        return self_test()
    since = a.since or (dt.datetime.now(dt.timezone.utc)
                        - dt.timedelta(hours=a.hours)).strftime("%Y-%m-%dT%H:%M:%SZ")
    cutoff = dt.datetime.now().timestamp() - a.hours * 3600 - 7200

    files = sorted(glob.glob(os.path.join(ROOT, "*.jsonl")))
    if not a.all_sessions:
        files = [f for f in files if os.path.getmtime(f) >= cutoff]
    rows = []
    for f in files:
        seat = os.path.basename(f)[:8]
        for ts, kind, txt in owner_records(f, since):
            rows.append((ts, seat, kind, " ".join(txt.split())[:300]))
    rows.sort()

    print(f"OWNER SPEECH since {since} — {len(rows)} record(s) across "
          f"{len(files)} transcript(s) touched in the window")
    print("  ⛔ A WORKLIST, NEVER A VERDICT: a message here may answer a peer's question and")
    print("     not touch your queue at all. Read it before telling the owner an item still needs the owner.")
    print("  ⚠️  FLOOR: a session whose file was not written in the window is not scanned")
    print("     unless you pass --all-sessions.\n")
    if not rows:
        print("  none — and an empty result is NOT proof the owner has said nothing; widen --hours")
        print("  or pass --all-sessions before reading it that way.")
        return 0
    for ts, seat, kind, txt in rows:
        print(f"  {ts}  seat={seat}  ({kind})  {txt}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
