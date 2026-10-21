#!/usr/bin/env python3
"""hub-unfinished-loops.py — per-peer CONVERSATION-AXIS check: whose last word was theirs?

WHY THIS EXISTS, and why it is not a second copy of an instrument we already have.
`review-request-closure-scan.mjs` (and `hub-stale-request-poll.sh`, which wraps it) key on
the SHA: a request closes when some outbound names it. That predicate is correct for what it
measures and it is BLIND to three real shapes, all of which cost the hub a dropped loop on
2026-09-06:

  1. A HOLD, an ACK or an INTERIM that names the sha reads as ANSWERED. The hub's own
     deploy-hold broadcast named the request's sha, so the scan reported that request closed while
     no verdict had been written. The scan's own header records this: "ANSWERED IS NOT
     HANDLED".
  2. An inbound that names NO sha — a ping, a question, a correction, an owner directive
     relayed by a peer — is not in the scan's request set at all, so it cannot ever read open.
  3. A loop that went quiet across a COMPACTION leaves no in-context trace, and the scan
     reports the same zero it reported before.

Measured the morning this was written: the scan reported every request answered while FIVE
peers were holding the last word, one of them for 25 hours, and a sixth had to be prompted
to chase the hub. This tool answers a DIFFERENT question — *for each peer, is their
newest message to me newer than my newest message to them?* — so it is CROSS-BLIND to the sha
predicate rather than a louder version of it. Run BOTH; a loop either can see is a real loop.

⛔ WHAT IT IS NOT. A peer holding the last word is not proof that anything is owed — they may
have sent a courtesy ack, or closed the thread themselves. This prints a WORKLIST, never a
verdict, and the worklist is a FLOOR: see BLIND SPOTS below. Read the rows.

BLIND SPOTS, stated because an unstated exclusion is itself an unchecked claim:
  · BROADCASTS (`all__<ts>__<sender>`) are EXCLUDED — a broadcast is not addressed to you, so
    "you did not reply" is not a defect. The count is reported separately so the exclusion is
    visible rather than silent. An owner directive relayed by broadcast WILL be missed here.
  · It reads the mail plane ONLY. A loop closed in a commit body, a tracker row, or a channel
    is invisible to it and reads as open.
  · Filenames carry the clock; a peer whose seat wrote a bad timestamp sorts wrong.
  · A reply you sent that the peer has not yet read still counts as your last word. That is
    correct for "did I answer", wrong for "did they see it".

Usage:
    python3 scripts/hub-unfinished-loops.py [--sid <8hex>] [--json] [--min-age-min N]
    python3 scripts/hub-unfinished-loops.py --self-test

Exits 0 with the report; 2 on a usage/soundness failure (no seat id, unreadable store).
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import time

MAIL_DIR = ".claude/state/session-mail"
BROADCAST_RECIPIENT = "all"


def parse_name(basename: str):
    """<recipient>__<ts>__<sender>.md[.read|.read-by-<sid>] -> (recipient, ts_ns, sender).

    Returns None when the name does not carry all three fields. Split on the FULL '__'
    delimiter: a single-'_' split counts the empty field between the doubled separators and
    silently returns the wrong column (the mail store's own off-by-one).
    """
    parts = basename.split("__")
    if len(parts) < 3:
        return None
    recipient, ts_raw, sender_raw = parts[0], parts[1], parts[2]
    if not ts_raw.isdigit():
        return None
    sender = sender_raw.split(".")[0]
    if not recipient or not sender:
        return None
    return recipient, int(ts_raw), sender


def scan(mail_dir: str, me: str):
    """Return (loops, stats). A loop is a peer whose newest inbound postdates my newest outbound."""
    inbound: dict[str, int] = {}
    outbound: dict[str, int] = {}
    broadcasts = 0
    unparsed = 0

    for path in glob.glob(os.path.join(mail_dir, "*")):
        parsed = parse_name(os.path.basename(path))
        if parsed is None:
            unparsed += 1
            continue
        recipient, ts, sender = parsed
        if recipient == me:
            inbound[sender] = max(inbound.get(sender, 0), ts)
        elif sender == me:
            if recipient == BROADCAST_RECIPIENT:
                broadcasts += 1
                continue
            outbound[recipient] = max(outbound.get(recipient, 0), ts)
        elif recipient == BROADCAST_RECIPIENT:
            broadcasts += 1

    loops = []
    for peer in sorted(set(inbound) | set(outbound)):
        theirs = inbound.get(peer, 0)
        mine = outbound.get(peer, 0)
        if theirs > mine:
            loops.append({"peer": peer, "their_newest_ns": theirs, "my_newest_ns": mine})
    loops.sort(key=lambda r: r["their_newest_ns"])
    now_ns = time.time() * 1e9
    for r in loops:
        r["waited_min"] = int((now_ns - r["their_newest_ns"]) / 6e10)

    stats = {
        "peers_seen": len(set(inbound) | set(outbound)),
        "broadcasts_excluded": broadcasts,
        "unparsed_filenames": unparsed,
    }
    return loops, stats


def peek_headers(mail_dir: str, me: str, peer: str, ts_ns: int):
    """subject + signal from the peer's newest inbound. Header read only — never the body.

    Returns ("", "") when the file cannot be found or read: a missing subject must degrade to a
    blank cell, never to a fabricated one. The caller prints the blank."""
    for suffix in ("", ".read"):
        path = os.path.join(mail_dir, f"{me}__{ts_ns}__{peer}.md{suffix}")
        if not os.path.exists(path):
            continue
        subject = signal = ""
        try:
            with open(path, encoding="utf-8", errors="replace") as fh:
                for _ in range(15):
                    line = fh.readline()
                    if not line:
                        break
                    if line.startswith("subject:"):
                        subject = line[8:].strip()
                    elif line.startswith("signal:"):
                        signal = line[7:].strip()
        except OSError:
            return "", ""
        return subject, signal
    return "", ""


def _fmt_z(ts_ns: int) -> str:
    if not ts_ns:
        return "(never)"
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts_ns / 1e9))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sid", help="8-hex seat id; defaults to CLAUDE_CODE_SESSION_ID's prefix")
    ap.add_argument("--dir", default=MAIL_DIR, help="mail store (default: %(default)s)")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--min-age-min", type=int, default=0, help="only report loops older than N minutes")
    ap.add_argument("--table", action="store_true",
                    help="condensed owner-facing queue table: peer, status, one-liner subject")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()

    me = args.sid or (os.environ.get("CLAUDE_CODE_SESSION_ID") or "").split("-")[0]
    if not me:
        print("ABORT: no seat id — pass --sid or set CLAUDE_CODE_SESSION_ID", file=sys.stderr)
        return 2
    if not os.path.isdir(args.dir):
        print(f"ABORT: mail store not readable at {args.dir}", file=sys.stderr)
        return 2

    loops, stats = scan(args.dir, me)
    now_ns = time.time() * 1e9
    if args.min_age_min:
        cutoff = args.min_age_min * 60 * 1e9
        loops = [r for r in loops if now_ns - r["their_newest_ns"] >= cutoff]

    if args.json:
        print(json.dumps({"seat": me, "loops": loops, "stats": stats}, indent=2))
        return 0

    if args.table:
        # Owner-facing. Status is DERIVED from the mail's own `signal:` field plus age — never
        # from what I remember doing. A blank subject prints blank rather than inventing one.
        if not loops:
            print("Review queue: nothing owed — every peer who wrote to you has heard back since.")
            return 0
        print(f"| peer | waiting | status | what they last sent |")
        print(f"|---|---|---|---|")
        for r in loops:
            subj, sig = peek_headers(args.dir, me, r["peer"], r["their_newest_ns"])
            mins = r["waited_min"]
            age = f"{mins}m" if mins < 90 else f"{mins//60}h{mins%60:02d}m"
            status = {
                "review-request": "⏳ review owed",
                "fold-report": "⏳ fold-verify owed",
                "deploy-hold": "🔴 hold — reply owed",
                "correction": "⏳ correction unread",
            }.get(sig, "⏳ reply owed")
            if mins >= 240:
                status = "🔴 STRANDED"
            subj = (subj[:72] + "…") if len(subj) > 73 else subj
            print(f"| `{r['peer']}` | {age} | {status} | {subj} |")
        print()
        print(f"_{len(loops)} open · FLOOR (mail plane only; a loop closed in a commit body or "
              f"tracker row reads OPEN here) · {stats['broadcasts_excluded']} broadcasts excluded_")
        return 0

    print(f"UNFINISHED LOOPS for seat {me} — peers holding the last word")
    print(f"  (conversation axis; CROSS-BLIND to review-request-closure-scan.mjs's sha predicate)")
    print()
    if not loops:
        print("  none — every peer who wrote to you has heard back since.")
    else:
        print(f"  {'peer':<10} {'their newest':<22} {'my newest':<22} {'waited':>9}")
        for r in loops:
            print(
                f"  {r['peer']:<10} {_fmt_z(r['their_newest_ns']):<22} "
                f"{_fmt_z(r['my_newest_ns']):<22} {r['waited_min']:>6} min"
            )
    print()
    print(f"  {len(loops)} open of {stats['peers_seen']} peers seen · "
          f"{stats['broadcasts_excluded']} broadcast(s) EXCLUDED (not addressed to you) · "
          f"{stats['unparsed_filenames']} unparsed name(s)")
    print("  FLOOR, not a count: mail plane only, and a loop closed in a commit body or a")
    print("  tracker row reads OPEN here. Read the rows before acting on any of them.")
    return 0


def self_test() -> int:
    """Fixtures consume the REAL scan()/parse_name(), and every claim class carries a
    control that must read the OTHER way. A control that merely passes proves nothing."""
    import tempfile

    fails = []

    def check(label, got, want):
        ok = got == want
        print(f"  {'PASS' if ok else 'FAIL'}  {label}: got {got!r}, want {want!r}")
        if not ok:
            fails.append(label)

    print("parse_name:")
    check("full name", parse_name("<seat-a>__1700000000000000000__<seat-b>.md"),
          ("<seat-a>", 1700000000000000000, "<seat-b>"))
    check("read suffix strips", parse_name("<seat-a>__1700000000000000000__<seat-b>.md.read"),
          ("<seat-a>", 1700000000000000000, "<seat-b>"))
    check("read-by suffix strips", parse_name("all__1700000000000000000__<seat-b>.md.read-by-<seat-c>"),
          ("all", 1700000000000000000, "<seat-b>"))
    # DISCRIMINATING control: single-underscore names and non-numeric ts must be REJECTED,
    # not silently mis-columned. A permissive parser would return a tuple here and the whole
    # report would be built over the wrong field.
    check("single-underscore rejected", parse_name("a_1700_b.md"), None)
    check("non-numeric ts rejected", parse_name("<seat-a>__notanumber__<seat-b>.md"), None)

    print("scan:")
    with tempfile.TemporaryDirectory() as d:
        me = "<seat-me>"
        peer_open = "<seat-open>"       # they spoke last  -> MUST appear
        peer_closed = "<seat-closed>"   # I spoke last     -> MUST NOT appear
        peer_never = "<seat-never>"     # they wrote, I never replied -> MUST appear
        def touch(name):
            open(os.path.join(d, name), "w").close()

        touch(f"{me}__100__{peer_open}.md")
        touch(f"{peer_open}__50__{me}.md")          # my reply is OLDER -> open
        touch(f"{me}__100__{peer_closed}.md")
        touch(f"{peer_closed}__200__{me}.md")       # my reply is NEWER -> closed
        touch(f"{me}__100__{peer_never}.md")        # no outbound at all -> open
        touch(f"all__300__{me}.md")                 # my broadcast -> excluded, not an outbound
        touch(f"{me}__400__{peer_closed}.md.read")  # read suffix still counts as inbound

        loops, stats = scan(d, me)
        names = [r["peer"] for r in loops]
        check("open peer present", peer_open in names, True)
        check("never-replied peer present", peer_never in names, True)
        # This is the control that must come out the OTHER way. peer_closed is re-opened by
        # the .read inbound at 400 > my 200, so it MUST appear — proving the .read suffix is
        # not silently dropped. If the parser ignored `.read`, this reads False and the whole
        # instrument would under-report exactly the messages a peer HAS read.
        check("read-suffix inbound re-opens the loop", peer_closed in names, True)
        check("broadcast not counted as an outbound", stats["broadcasts_excluded"], 1)
        check("no unparsed names in a clean fixture", stats["unparsed_filenames"], 0)

        # NEGATIVE control drawn from a population the predicate CAN flag: remove the
        # re-opening inbound and peer_closed must VANISH. Same fixture, one file different.
        os.remove(os.path.join(d, f"{me}__400__{peer_closed}.md.read"))
        loops2, _ = scan(d, me)
        check("closed peer absent once the later inbound is gone",
              peer_closed in [r["peer"] for r in loops2], False)

    print()
    if fails:
        print(f"SELF-TEST FAILED: {len(fails)} assertion(s): {', '.join(fails)}")
        return 1
    print("SELF-TEST PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
