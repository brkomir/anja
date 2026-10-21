#!/usr/bin/env python3
"""Has a compaction actually APPLIED since the last recovery? One answer for every consumer.

  python3 scripts/post-compact-deferral.py decide --sid <session-uuid>   # /post-compact Step 1
  python3 scripts/post-compact-deferral.py status --sid <session-uuid>   # hook + wrap-reconcile
  python3 scripts/post-compact-deferral.py --self-test
  .claude/hooks/keep-warm-gate.py imports this file by path and calls rule(sid, state_dir, tx) -> (verdict, info);
  renaming rule(), its arguments or the word DEFERRED fails that gate CLOSED (scripts/keep-warm-gate-test.py § 5b reds).
  scripts/post-compact-recovery-index.py imports it the same way; there the same rename fails OPEN (the index
  runs on a prepared-not-applied compaction, the pre-2026-10-11 bug) and only its --self-test ARMs 8p and 8p2 red.

WHY: recovery waits for the real compaction, never the early one. Claude Code's PreCompact hook can
fire with trigger=auto while the context is still UNDER the compact point, so the pending marker exists
while no compaction has happened — measured 2026-10-18: one session at 625,473 of 727,000 tokens at the
fire; over the fleet since 2026-10-01, 26 of 119 automatic compactions fired 10 min to 3.4 h before they
applied and 37 of 242 fires had no compaction within 12 h; the summary is computed at the apply (median
3 s after the fire when it is not early), so it is never stale — only the hook is early. A recovery run
on the early fire covers nothing and clears the net before the real compaction lands. (Until 2026-10-18
this read "a PRECOMPUTED compaction … PREPARED, minutes to hours before it applies"; nothing is prepared,
the hook is early.) A manual /compact refused at the session limit leaves the same marker with
trigger=manual (measured 2026-10-19).

THE RULE: recover only when a `compact_boundary` record is NEWER than the last recovery (the time
in post-compact-cleared-<sid>; no recovery yet means any boundary counts). Otherwise no
compaction has landed since the hook fired: DEFERRED, no recovery, marker stays.

⛔ COMPARE NORMALISED, NEVER RAW. The three clocks are written three ways — the marker's
`compacted=YYYY-MM-DD HH:MM:SS UTC`, the cleared file's `YYYY-MM-DDTHH:MM:SSZ`, the boundary's
`YYYY-MM-DDTHH:MM:SS.mmmZ` — and a raw string compare of a space form against a `T` form reads
"older" on every same-date pair (a space sorts before `T`), so the rule goes silently inert in the
direction of the old behaviour. Every value is cut to 19 chars `YYYY-MM-DDTHH:MM:SS`,
all UTC. A boundary in the SAME SECOND as the last recovery counts as NEWER: the recovery's cleared
file is written after the work it covers, so a same-second boundary is a later one whose sub-second
was cut by the normalisation (0 of 2,198 same-second pairs today).

decide: prints RECOVER or DEFERRED (or NO-MARKER; NO-TRANSCRIPT with exit 1 when the transcript
cannot be opened — never DEFERRED, the silent direction). With no post-compact-cleared file the floor
is the marker's own time, so a boundary older than the current marker never recovers early.
On DEFERRED it writes
  .claude/state/post-compact-deferred-<sid>  (the marker line, then `deferred_at=<ISO19>`; the hook
  post-compact-pending-check.sh appends one `said=<marker>` line once it has printed its once-only line,
  and this rewrite drops them, so a re-run of Step 1 says it once more)
so the hook and the reconcile can tell "Step 1 looked and deferred" from "nobody looked yet".
On RECOVER it removes a stale deferral breadcrumb.
status: exit 0 and prints DEFERRED when the breadcrumb exists AND the rule still says DEFERRED;
exit 1 (OWED) otherwise, including when the marker is absent or the transcript unreadable. Read-only.
"""
import argparse, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# The harness keys a project's transcripts by its absolute path with every non-alphanumeric
# character turned into "-" (the derivation parallel-session-scan.py and wrap-reconcile.mjs use).
PROJ = os.path.expanduser("~/.claude/projects/" + re.sub(r"[^a-zA-Z0-9]", "-", ROOT))
SID_SHAPE = re.compile(r"^[A-Za-z0-9_-]+$")


def norm(ts):
    """Any of the three clock spellings -> 19-char `YYYY-MM-DDTHH:MM:SS`, or "" when unreadable."""
    if not ts:
        return ""
    m = re.search(r"(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})", ts)
    return "%sT%s" % (m.group(1), m.group(2)) if m else ""


def newest_boundary(tx):
    """Newest `compact_boundary` stamp (19 chars); "" when the transcript holds none; None when the
    transcript cannot be opened — an unreadable transcript is NOT "no boundary yet"."""
    newest = ""
    try:
        fh = open(tx, encoding="utf-8", errors="replace")
    except OSError:
        return None
    with fh:
        for line in fh:
            if '"compact_boundary"' not in line:
                continue
            try:
                r = json.loads(line)
            except Exception:
                continue
            if r.get("subtype") == "compact_boundary":
                t = norm(r.get("timestamp", ""))
                if t > newest:
                    newest = t
    return newest


def paths(sid, state_dir, tx):
    sd = state_dir or os.path.join(ROOT, ".claude", "state")
    return (os.path.join(sd, "post-compact-pending-" + sid),
            os.path.join(sd, "post-compact-cleared-" + sid),
            os.path.join(sd, "post-compact-deferred-" + sid),
            tx or os.path.join(PROJ, sid + ".jsonl"))


def read1(p):
    try:
        return open(p, encoding="utf-8").read().strip()
    except OSError:
        return None


def rule(sid, state_dir=None, tx=None):
    pending, cleared, _, txp = paths(sid, state_dir, tx)
    marker = read1(pending)
    if marker is None:
        return "NO-MARKER", {}
    first = marker.split("\n")[0]
    b = newest_boundary(txp)
    if b is None:
        # The rule cannot be evaluated. Never DEFERRED — that is the silent direction, and a wrong
        # project dir or a moved transcript would otherwise read "prepared, not applied" forever.
        return "NO-TRANSCRIPT", {"transcript": txp, "marker": first}
    last = norm(read1(cleared) or "")
    floor = "cleared"
    if not last:
        # No recovery recorded for this sid: the first compaction, OR the floor file reaped by the 48 h
        # sweep in post-compact-pending-check.sh (a long idle, a session resumed days later). Fall back
        # to the marker's own time: a boundary OLDER than the current marker belongs to an earlier
        # compaction (already recovered) and must not trigger a recovery that clears the net before
        # the pending one applies. Costs only one known edge case, and only until the first Step 8.
        last = norm(first)
        floor = "marker (no post-compact-cleared file)"
    info = {"newest_boundary": b or "none", "last_recovery": last or "none", "floor": floor,
            "marker": first, "transcript": txp}
    return ("RECOVER" if b and b >= last else "DEFERRED"), info


def decide(sid, state_dir=None, tx=None):
    verdict, info = rule(sid, state_dir, tx)
    _, _, deferred, _ = paths(sid, state_dir, tx)
    if verdict == "DEFERRED":
        with open(deferred, "w", encoding="utf-8") as f:
            f.write(info["marker"] + "\n")
            f.write("deferred_at=" + norm(__import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()) + "\n")
    elif verdict == "RECOVER" and os.path.exists(deferred):
        os.remove(deferred)
    return verdict, info


def status(sid, state_dir=None, tx=None):
    verdict, info = rule(sid, state_dir, tx)
    _, _, deferred, _ = paths(sid, state_dir, tx)
    return ("DEFERRED" if verdict == "DEFERRED" and os.path.exists(deferred) else "OWED"), info


def self_test():
    import tempfile, shutil
    d = tempfile.mkdtemp()
    ok = True
    sid = "test-sid"
    tx = os.path.join(d, "t.jsonl")
    pend = os.path.join(d, "post-compact-pending-" + sid)
    clr = os.path.join(d, "post-compact-cleared-" + sid)
    dfr = os.path.join(d, "post-compact-deferred-" + sid)

    def boundary(ts):
        return json.dumps({"type": "system", "subtype": "compact_boundary", "timestamp": ts,
                           "compactMetadata": {"precomputed": True, "durationMs": 5}})

    def setup(lines, marker=True, cleared=None):
        for p in (pend, clr, dfr):
            if os.path.exists(p):
                os.remove(p)
        open(tx, "w").write("\n".join(lines) + ("\n" if lines else ""))
        if marker:
            open(pend, "w").write("compacted=2026-10-02 08:37:16 UTC trigger=auto focus=no focus_args=<none>\n")
        if cleared:
            open(clr, "w").write(cleared + "\n")

    def check(label, got, want):
        nonlocal ok
        if got != want:
            print("  %s FAIL: want %s got %s" % (label, want, got))
            ok = False
        else:
            print("  %s ok: %s" % (label, got))

    try:
        # A — marker, no boundary yet, no recovery ever: only PREPARED.
        setup([])
        check("A no boundary", decide(sid, d, tx)[0], "DEFERRED")
        check("A breadcrumb written", os.path.exists(dfr), True)
        check("A status", status(sid, d, tx)[0], "DEFERRED")
        # B — a boundary, no recovery ever: RECOVER, and a stale breadcrumb is removed.
        setup([boundary("2026-10-02T08:59:25.466Z")])
        open(dfr, "w").write("stale\n")
        check("B first boundary", decide(sid, d, tx)[0], "RECOVER")
        check("B breadcrumb removed", os.path.exists(dfr), False)
        # C — a boundary OLDER than the last recovery (the precomputed case after a recovery):
        # nothing has applied since, so DEFERRED.
        setup([boundary("2026-10-02T08:59:25.466Z")], cleared="2026-10-02T09:10:00Z")
        check("C boundary older than last recovery", decide(sid, d, tx)[0], "DEFERRED")
        # D — a newer boundary after a recovery: RECOVER.
        setup([boundary("2026-10-02T08:59:25.466Z"), boundary("2026-10-02T11:14:06.183Z")],
              cleared="2026-10-02T09:10:00Z")
        check("D newer boundary", decide(sid, d, tx)[0], "RECOVER")
        # E — a boundary in the SAME SECOND as the last recovery counts as newer (it is later by
        # its sub-second, which the 19-char cut drops).
        setup([boundary("2026-10-02T09:10:00.900Z")], cleared="2026-10-02T09:10:00Z")
        check("E same second counts as newer", decide(sid, d, tx)[0], "RECOVER")
        # F — status is OWED when nobody has run Step 1 yet (no breadcrumb), even if DEFERRED.
        setup([])
        check("F status before Step 1", status(sid, d, tx)[0], "OWED")
        # G — status flips to OWED once the real boundary lands after a deferral.
        setup([])
        decide(sid, d, tx)
        open(tx, "a").write(boundary("2026-10-02T08:59:25.466Z") + "\n")
        check("G boundary landed after deferral", status(sid, d, tx)[0], "OWED")
        # H — no marker at all.
        setup([], marker=False)
        check("H no marker", decide(sid, d, tx)[0], "NO-MARKER")
        # I — norm() reads all three spellings to the same 19 chars.
        check("I norm marker", norm("compacted=2026-10-02 08:37:16 UTC"), "2026-10-02T08:37:16")
        check("I norm iso-ms", norm("2026-10-02T08:37:16.123Z"), "2026-10-02T08:37:16")
        check("I norm cleared", norm("2026-10-02T08:37:16Z"), "2026-10-02T08:37:16")
        # J — an UNREADABLE transcript is not "no boundary yet": decide says NO-TRANSCRIPT, writes no
        # breadcrumb, and status reads OWED (the hook keeps nagging; the silent direction is closed).
        setup([])
        os.remove(tx)
        check("J unreadable transcript decide", decide(sid, d, tx)[0], "NO-TRANSCRIPT")
        check("J no breadcrumb written", os.path.exists(dfr), False)
        check("J status", status(sid, d, tx)[0], "OWED")
        # K — no post-compact-cleared file (first recovery, or the floor reaped by the 48 h GC): the
        # floor is the marker's own time (08:37:16). An older boundary is an earlier compaction's and
        # must not recover early; a newer one is the pending compaction applying.
        setup([boundary("2026-10-02T08:00:00.000Z")])
        check("K no floor, boundary older than marker", decide(sid, d, tx)[0], "DEFERRED")
        setup([boundary("2026-10-02T08:00:00.000Z"), boundary("2026-10-02T08:59:25.466Z")])
        check("K no floor, boundary newer than marker", decide(sid, d, tx)[0], "RECOVER")
    finally:
        shutil.rmtree(d, ignore_errors=True)
    print("SELF-TEST:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", nargs="?", choices=["decide", "status"])
    ap.add_argument("--sid")
    ap.add_argument("--state-dir")
    ap.add_argument("--tx")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    if a.self_test:
        sys.exit(self_test())
    if not a.cmd or not a.sid or not SID_SHAPE.match(a.sid):
        ap.error("decide|status --sid <session-uuid> required")
    if a.cmd == "decide":
        verdict, info = decide(a.sid, a.state_dir, a.tx)
        print(verdict, json.dumps(info))
        sys.exit(1 if verdict == "NO-TRANSCRIPT" else 0)
    verdict, info = status(a.sid, a.state_dir, a.tx)
    print(verdict, json.dumps(info))
    sys.exit(0 if verdict == "DEFERRED" else 1)


if __name__ == "__main__":
    main()
