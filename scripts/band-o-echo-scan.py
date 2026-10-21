#!/usr/bin/env python3
"""band-o-echo-scan.py — did a session OPEN by emitting a fabricated Band-O document?

WHAT THIS MEASURES. Six sessions have opened by emitting a Band-O-shaped rules document as
their first reply instead of running the typed command. The rows in those documents are NOVEL
(one invented rule instructs running a script with zero commits ever), so this is CONFABULATION,
not context leakage. The decisive tell is that every one of them RENDERS A CHUNK-BOUNDARY
MARKER -- and band-o-inject.sh STRIPS the real marker before emitting, so nothing echoed can
have come from the delivered text. Three renderings have been observed and two of them have
never existed in any file, which no leakage account explains.

STRONG vs WEAK, and why the split is the whole point. A bare mention of "Band-O" is not the
defect: sessions legitimately discuss this subsystem, and a mention-counting scan inflates the
rate by ~40% (measured 2026-08-14: 7 raw hits, 5 real -- a panel-sizing reply and a
defer-trigger-scan readout both matched on the token alone). Only a RENDERED MARKER counts.
Hand-read anything this reports before quoting a number: a prose-shape proxy is an upper bound.

ORDINAL BOUND IS ALSO THE ANTI-CONTAMINATION GUARD. This file contains the marker literals it
searches for, so writing or discussing it puts them in a transcript. Scanning only the first two
assistant messages keeps the instrument out of its own corpus -- a script's source never appears
in a session's opening reply.

WHY THE INTERVENTION IS THE EXPERIMENT (2026-08-14, measured). Date and CLI
version are THE SAME VARIABLE in this corpus by construction: partitioning all 148 project sessions
by recorded `version` against start date gives ZERO off-diagonal cells (14 at >=2.1.225 all started
on/after 08-08; 134 below it all started before). A CLI upgrade propagates to every NEW session and
never to an existing one, so no observational partition separates them -- not here, not in a larger
slice. The header deletion is therefore the ONLY available discriminator: if echoes stop while CLI
keeps climbing, the version account is refuted BY INTERVENTION. (The sole way to get an off-diagonal
cell is to manufacture one -- pin an old CLI for a fresh session with the header already deleted --
which is judged not worth it against this ladder, recorded so the option stays considered.)

AND THAT MAKES THE NON-CONFOUND ARGUMENT LOAD-BEARING, NOT A NICETY. Two levers shipped: deleting
the band file's header clause, and correcting a second file's description of Band-O. They predict
DIFFERENT observables from ONE emission -- the first predicts the marker token stops being RENDERED
(the second file never mentions that token), the second predicts invented rows stop CLUSTERING on panel
composition. Since observation cannot separate date from version, the readout's only job is to
attribute a change to the RIGHT lever, and that separation is what makes it readable at all.

THE POST-CUTOVER DENOMINATOR IS LIVE AND GROWS WITH EVERY NEW SESSION, so any rate written into
prose is stale on arrival: a mail quoted 5/13 and a re-run minutes later read 5/14 (38.5%
-> 35.7%) because one session started in between. Neither reading was wrong. QUOTE THE TOOL, dated,
never a number carried in a sentence.

  usage:  python3 scripts/band-o-echo-scan.py [--since YYYY-MM-DD] [--self-test]
"""
import json, os, glob, sys, math, re, datetime

CUTOVER = "2026-08-08"          # first observed event
# ERA-SCOPED DENOMINATOR, and getting this wrong cost three passes. A session that predates the
# 2-band split cannot continue a document it was never sent, so counting ALL prior sessions pads
# the clean side with structurally-immune ones and overstates the step change. Report both, and
# label which one the claim rests on.
BAND_O_ERA = "2026-07-12"       # the 2-band split; Band-O did not exist before it
# The readout's denominator is sessions started AFTER the fix, and a DATE cannot express it: the
# last rendered event and the fix landed on the same day, hours apart. Full timestamp.
FIX_TS = "2026-08-14T21:55:33+02:00"
ORDINAL_MAX = 2                 # only the opening reply/replies can be a "session opened by"

# A rendered boundary marker in ANY spelling. The real literal is BAND-O-CHUNK-BOUNDARY inside an
# HTML comment; the observed renderings also include the prefix-less comment form and a markdown
# bold form, neither of which exists anywhere in the repo.
STRONG = re.compile(r"(<!--\s*(BAND-O-)?CHUNK-BOUNDARY\s*-->|\*\*(BAND-O-)?CHUNK-BOUNDARY\*\*)")
# Present but NOT counted: the subsystem's name on its own.
WEAK = ("Orchestrator Band", "Band-O", "BAND-O", "Orchestrator Hot Tier")


def check_verdict(n_after, n_rendered, clean_bar=7):
    """Has the ladder reached a state a human should look at? Returns (fires, reason).

    PURE so it can be controlled at its boundaries — the branch is the whole instrument and
    an exit code is not testable from outside. Two readings fire, for opposite reasons:

      RECURRENCE  a post-fix session rendered  => the supplier hypothesis is REFUTED, and the
                  remaining account (CLI version) is the one that survives. Act.
      CLEAN BAR   >= clean_bar post-fix sessions, none rendered => the first falsification rung
                  is cleared. Say so; do NOT call it fixed (7 rules out only the measured rate).

    Anything else is "still accumulating", which is not news and must not fire — a trigger that
    fires while nothing has happened trains the reader to ignore it.
    """
    if n_rendered > 0:
        return True, ("RECURRENCE: %d post-fix session(s) rendered a marker. The header-clause "
                      "hypothesis is REFUTED; re-open at the framing layer." % n_rendered)
    if n_after >= clean_bar:
        return True, ("CLEAN BAR: %d post-fix sessions, 0 rendered — rules out the measured rate "
                      "at 95%%. Not 'fixed': %d rules out 20%%, 29 rules out 10%%." % (n_after, 14))
    return False, ("still accumulating: %d post-fix session(s), 0 rendered (bar is %d)"
                   % (n_after, clean_bar))


def _after_fix(ts):
    """Did this session start after the fix? REAL-TIME compare, never a string one.

    ⛔ THE LADDER SHIPPED BROKEN FOR ~40 MINUTES AND FAILED QUIET. Session timestamps carry a
    `Z` suffix; `git log %cI` emits a `+02:00` offset. Compared as STRINGS, `20:30:20Z` sorts
    BEFORE `21:55:33+02:00` while being 35 minutes AFTER it in real time — so the ladder
    reported ZERO post-fix sessions while the first one had already run (and had NOT rendered,
    i.e. it discarded the first clean rung). The failure direction is the dangerous one: it
    reads as "no data yet", which nobody investigates, on the one instrument the whole
    hypothesis rests on. Found while reconciling a 13-vs-14 count with a reviewer, who
    had verified the scanner and did not catch this either, because both of us read the
    ladder's OUTPUT rather than its comparison.
    """
    try:
        a = datetime.datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        b = datetime.datetime.fromisoformat(FIX_TS)
        if a.tzinfo is None or b.tzinfo is None:
            return str(ts) > FIX_TS        # degraded, but never silently: see the caller's note
        return a > b
    except Exception:
        return False                       # unparseable => not counted, never miscounted


def wilson(k, n, z=1.96):
    if n == 0:
        return 0.0, 0.0
    p = k / n
    c = (p + z * z / (2 * n)) / (1 + z * z / n)
    m = z / (1 + z * z / n) * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return 100 * max(0.0, c - m), 100 * min(1.0, c + m)


def scan_text(txt):
    m = STRONG.search(txt)
    if m:
        return "STRONG", m.group(0)
    if any(w in txt for w in WEAK):
        return "weak", ""
    return None, ""


def scan_sessions(root):
    rows = []
    for p in sorted(glob.glob(os.path.join(root, "*.jsonl"))):
        sid, day, ver, verdict, form, n = os.path.basename(p)[:8], None, None, None, "", 0
        ts = None
        try:
            with open(p, encoding="utf-8", errors="replace") as f:
                for line in f:
                    if '"assistant"' not in line and '"version"' not in line:
                        continue
                    try:
                        r = json.loads(line)
                    except Exception:
                        continue
                    if ver is None and isinstance(r.get("version"), str):
                        ver = r["version"]
                    if day is None and isinstance(r.get("timestamp"), str):
                        day, ts = r["timestamp"][:10], r["timestamp"]
                    if r.get("type") != "assistant":
                        continue
                    blocks = ((r.get("message") or {}).get("content")) or []
                    txt = "".join(b.get("text", "") for b in blocks
                                  if isinstance(b, dict) and b.get("type") == "text")
                    if not txt.strip():
                        continue
                    n += 1
                    if n > ORDINAL_MAX:
                        break
                    v, fm = scan_text(txt)
                    if v == "STRONG":
                        verdict, form = v, fm
                        break
                    if v == "weak" and verdict is None:
                        verdict = v
        except Exception:
            continue
        if day:
            rows.append({"day": day, "ts": ts or day, "sid": sid, "cli": ver or "?",
                         "verdict": verdict, "form": form})
    rows.sort(key=lambda r: (r["day"], r["sid"]))
    return rows


def self_test():
    """Positive AND negative control. A detector that cannot return zero measures nothing, and one
    that flags ordinary prose inflates every rate it reports."""
    pos = ["<!-- BAND-O-CHUNK-BOUNDARY -->\n| trigger | action | L1 |",   # the real literal
           "<!-- CHUNK-BOUNDARY -->\n| trigger | action | L1 |",          # never existed
           "**CHUNK-BOUNDARY**\n\n| trigger | action | L1 |"]             # never existed
    neg = ["Band-O dedup is settled; the expensive band is Band-U.",
           "Defer-trigger scan: 73 doable-now. One row concerns the Orchestrator Band.",
           "I'll arm the mail listener first, then run the trigger scan."]
    bad = []
    for t in pos:
        if scan_text(t)[0] != "STRONG":
            bad.append("POSITIVE control not flagged: %r" % t[:40])
    for t in neg:
        if scan_text(t)[0] == "STRONG":
            bad.append("NEGATIVE control flagged STRONG: %r" % t[:40])
    # --check's three branches, each with a control that MUST return the other answer.
    for label, args, want in [
        ("recurrence fires",          (3, 1), True),
        ("clean bar fires at 7",      (7, 0), True),
        ("6 clean does NOT fire",     (6, 0), False),
        ("0 post-fix does NOT fire",  (0, 0), False),
    ]:
        got = check_verdict(*args)[0]
        if got is not want:
            bad.append("check_verdict%s -> %s, expected %s (%s)" % (args, got, want, label))
    for b in bad:
        print("  FAIL  " + b)
    if not bad:
        print("  ok    3 positive controls flagged STRONG, 3 negative controls not (mention != render)")
        print("  ok    --check fires on recurrence AND at the clean bar; silent at 6 clean and at 0")
    return 1 if bad else 0


def main():
    if "--self-test" in sys.argv:
        sys.exit(self_test())
    if "--check" in sys.argv:
        # Trigger mode (`trigger-type: exit-zero`). EXIT 0 = a human should look.
        root = os.path.expanduser("~/.claude/projects/<project-key>")
        rows = scan_sessions(root)
        after = [r for r in rows if _after_fix(r["ts"])]
        fires, reason = check_verdict(len(after), sum(1 for r in after if r["verdict"] == "STRONG"))
        print(reason)
        sys.exit(0 if fires else 1)
    since = None
    if "--since" in sys.argv:
        since = sys.argv[sys.argv.index("--since") + 1]

    root = os.path.expanduser("~/.claude/projects/<project-key>")
    rows = scan_sessions(root)
    if since:
        rows = [r for r in rows if r["day"] >= since]

    pre = [r for r in rows if r["day"] < CUTOVER]
    era = [r for r in rows if BAND_O_ERA <= r["day"] < CUTOVER]
    post = [r for r in rows if r["day"] >= CUTOVER]
    for label, rs in (("all before " + CUTOVER, pre),
                      ("BAND-O ERA (honest)", era),
                      (CUTOVER + " onward", post)):
        k = sum(1 for r in rs if r["verdict"] == "STRONG")
        lo, hi = wilson(k, len(rs))
        print("%-22s n=%-4d rendered=%-3d (%4.1f%%, Wilson 95%% CI %4.1f-%4.1f%%)"
              % (label, len(rs), k, 100 * k / max(len(rs), 1), lo, hi))

    me = os.environ.get("CLAUDE_CODE_SESSION_ID", "")[:8]
    mine = [r for r in rows if me and r["sid"] == me]
    if mine:
        print("\n⚠️  SELF-REFERENTIAL: the scanning session (%s) is IN this corpus%s. Excluding it"
              % (me, ", and RENDERED" if mine[0]["verdict"] == "STRONG" else ""))
        print("    would bias the rate the other way, so it stays in -- but say so in any readout")
        print("    rather than letting a reader find it in the row list.")
    print("\nRENDERED (hand-read each before quoting a count):")
    for r in rows:
        if r["verdict"] == "STRONG":
            print("  %s  %s  cli=%-9s  form=%s" % (r["day"], r["sid"], r["cli"], r["form"]))
    weak = [r for r in post if r["verdict"] == "weak"]
    if weak:
        print("\nmentioned only, NOT counted (%d): %s" % (len(weak), " ".join(r["sid"] for r in weak)))

    after = [r for r in rows if _after_fix(r["ts"])]
    clean = [r for r in after if r["verdict"] != "STRONG"]
    dirty = [r for r in after if r["verdict"] == "STRONG"]
    print("\nFALSIFICATION LADDER — sessions started since the fix (%s): %d, of which %d rendered"
          % (FIX_TS[:16], len(after), len(dirty)))
    print("  a clean run of  7 rules out a 38% rate at 95%;  14 rules out 20%;  29 rules out 10%.")
    print("  Record the CLI version per start: date and CLI version are COLLINEAR in this corpus")
    print("  and it cannot separate them, so a quiet week is not by itself evidence of a fix.")
    if clean:
        print("  most recent clean: " + " ".join("%s(%s)" % (r["sid"], r["cli"]) for r in clean[-6:]))


if __name__ == "__main__":
    main()
