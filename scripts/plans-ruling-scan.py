#!/usr/bin/env python3
"""
STATUS: UNWIRED 2026-08-14 — DO NOT RE-WIRE WITHOUT READING THIS.
  Wired into /triggers for ~2h and removed on measurement.
  SENSITIVITY 0/5: five PLANTED genuine unmirrored rulings, run against the real
    668 KB DECISIONS.md, were all MISSED. PRECISION 0/12 on a full hand-triage.
  THIS FILE'S OWN --self-test REPORTS PASS WHILE THE DETECTOR CANNOT FIRE. The two
    fixtures asserting 'unmirrored ruling flagged (positive control)' are suppressed
    at real scale and pass only against the self-test's TWO-LINE fixture DECISIONS.md.
    A control drawn from a scale at which the defect cannot manifest.
  MECHANISM: tok_mirrored = any(t in decisions for t in toks) over tokens sorted by
    LENGTH, not rarity. One ordinary 6+ char word anywhere in 668 KB suppresses the
    line — measured kills on because/ceiling/corner/frames, and on this file's own
    control words (policy 46 hits, cadence 17, forever 6). A line fires only when ALL
    its top-4 tokens are absent, i.e. only if the ruling is written in invented words.
  --since IS ALSO BROKEN: it is mtime-keyed, so a mechanical sweep resets it. An
    em-dash sweep made a months-old ruling report as one day fresh.
  IF YOU REVISIT: the lever is the counterpart CHECK (any() -> rarity-weighted), never
    the token window. Both restored-sensitivity variants land at 39-59 lines/run
    dominated by CITATIONS of rulings, and a presence-keyword check cannot separate a
    citation from a declaration. The class is owned by the session-end deep-pass, which has
    10 recorded recoveries against this script's 0.
plans-ruling-scan — surface RULING-SHAPED lines in plans/*.md that have no DECISIONS.md
counterpart. Read-only TRIAGE instrument (warn-mode by design, like i18n-prose-drift): it
over-flags rather than adjudicates; a human reads the list.

WHY (a tracker row filed 2026-07-30):
plans/*-process.md became a de-facto decision store that NO sweep reaches — /triggers and
/hanging-work scan the trackers, neither scans plans/. Three ruled decisions were found
trapped in ONE doc; a ruling written into a process doc is DURABLE BUT UNFINDABLE. This is
fix (a) from that row: the cheapest, zero-LLM layer.

COUNTERPART CHECK is deliberately WEAK (presence-shaped, and honest about it): a plans/ ruling counts as
"mirrored" if DECISIONS.md contains the plans doc's BASENAME, or ≥1 distinctive long token from
the ruling line. A hit here means "no obvious mirror" — triage by hand, never bulk-file. The
instrument cannot prove a ruling IS mirrored (same limitation as any keyword match); it can only
kill the silent-zero (nothing looked at plans/ at all).

Usage:
  python3 scripts/plans-ruling-scan.py              # scan plans/*.md, print triage list
  python3 scripts/plans-ruling-scan.py --since N    # only docs modified in last N days
  python3 scripts/plans-ruling-scan.py --self-test  # fixture-driven; exits non-zero on fail
Bare invocation with an unknown flag exits 2 (a runner's helpful exit-0 path makes every
gate above it false-green).
"""
import os
import re
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLANS = os.path.join(ROOT, "plans")
DECISIONS = os.path.join(ROOT, "DECISIONS.md")

# Ruling-shaped cues — the vocabulary measured in the three trapped rulings + the row's own
# fix-direction list. Word-boundary, case-sensitive where the convention is (RULED caps).
RULING_RE = re.compile(
    r"owner-ruled|owner ruled|owner-directed ruling|\bRULED\b|\bACCEPTED AS-IS\b"
    r"|\bLEAVE AS IS\b|\bDECIDED\b|\bOWNER CALL RESOLVED\b|owner's ruling"
)
# Lines that MENTION rulings without being one (citations, instructions) — suppress.
MENTION_RE = re.compile(
    r"grep|pattern|ruling-shaped|RULING_RE|counterpart|this row|fix direction", re.I
)
STOPWORDS = frozenset({
    "owner-ruled", "ruled", "decided", "decision", "decisions", "accepted",
    "the", "and", "that", "this", "with", "from", "into", "have", "been",
})


def distinctive_tokens(line, n=4):
    """Longest distinctive words of a ruling line, DETERMINISTIC tie-break.

    ⚠ The first version sorted a SET by length only — tied-length tokens then took the
    set's hash-randomized order, so the top-n SAMPLE differed per interpreter and the
    flag/suppress verdict flipped with it (measured: back-to-back runs returned 9 and 7
    hits on an unchanged corpus). Fix = lexical tie-break; the mirror CHECK uses exactly
    these printed tokens, so the output line "counterpart-tokens tried" IS the check.
    An all-tokens variant was tried and REJECTED: it suppressed 486 docs down to 1 hit —
    any common ≥6-char token anywhere in DECISIONS.md counted as a mirror, inverting the
    tool's designed failure direction (over-flag, human triages) into silent under-flagging."""
    return all_distinctive_tokens(line)[:n]


def all_distinctive_tokens(line):
    words = re.findall(r"[A-Za-z][A-Za-z0-9_-]{5,}", line)
    words = [w for w in words if w.lower() not in STOPWORDS]
    return sorted(set(words), key=lambda w: (-len(w), w))


def scan(plans_dir=PLANS, decisions_path=DECISIONS, since_days=None):
    try:
        decisions = open(decisions_path, encoding="utf-8", errors="replace").read()
    except OSError as e:
        raise SystemExit(f"cannot read DECISIONS.md: {e}")  # fail LOUD, never empty-green
    hits, scanned = [], 0
    if not os.path.isdir(plans_dir):
        raise SystemExit(f"plans dir missing: {plans_dir}")
    cutoff = time.time() - since_days * 86400 if since_days else None
    # RECURSIVE walk (os.listdir read 326 of 486 docs — 20 subdirs,
    # 160 unread; the printed denominator was the walker's own reach, not the corpus).
    # WRINKLE: the two name uses need DIFFERENT strings — DECISIONS.md cites docs by
    # BASENAME (doc_mirrored keeps basename), while the hit tuple reports a plans-RELATIVE
    # path so triage can find the file (basenames collide across subdirs, e.g. README.md).
    all_md = []
    for dirpath, _dirs, files in os.walk(plans_dir):
        for fn in files:
            if fn.endswith(".md"):
                full = os.path.join(dirpath, fn)
                all_md.append((os.path.relpath(full, plans_dir), fn, full))
    for relname, basename, path in sorted(all_md):
        if cutoff and os.path.getmtime(path) < cutoff:
            continue
        scanned += 1
        doc_mirrored = basename in decisions  # basename cited in DECISIONS at all
        name = relname  # hits report the plans-relative path
        for i, line in enumerate(open(path, encoding="utf-8", errors="replace"), 1):
            if not RULING_RE.search(line):
                continue
            if MENTION_RE.search(line):
                continue
            toks = distinctive_tokens(line)  # top-4, deterministic tie-break
            # mirror check over EXACTLY the printed tokens — deterministic + self-describing
            tok_mirrored = any(t in decisions for t in toks)
            if doc_mirrored or tok_mirrored:
                continue
            hits.append((name, i, line.strip()[:160], toks))
    return hits, scanned


def self_test():
    import tempfile
    fails = 0

    def check(name, ok):
        nonlocal fails
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
        fails += 0 if ok else 1

    with tempfile.TemporaryDirectory() as td:
        pd = os.path.join(td, "plans")
        os.mkdir(pd)
        dec = os.path.join(td, "DECISIONS.md")
        # DECISIONS mirrors the "spatialgrammar" ruling by token, and cites mirrored-doc.md by name
        open(dec, "w").write("### 2026-08-01 — spatialgrammar entry law ratified\nmirrored-doc.md\n")
        # 1: unmirrored ruling -> MUST flag (positive control travels the real pipeline)
        open(os.path.join(pd, "trap-doc.md"), "w").write(
            "notes\nThe frobnicator cadence was owner-ruled: keep quarterly forever.\n")
        # 2: token-mirrored ruling -> must NOT flag
        open(os.path.join(pd, "ok-doc.md"), "w").write(
            "The spatialgrammar entry law was owner-ruled here first.\n")
        # 3: doc-name-mirrored -> must NOT flag
        open(os.path.join(pd, "mirrored-doc.md"), "w").write(
            "Cadence DECIDED: weekly, owner said so.\n")
        # 4: mention-not-ruling -> must NOT flag
        open(os.path.join(pd, "meta-doc.md"), "w").write(
            "grep plans/ for owner-ruled lines (this row describes the pattern).\n")
        # 5: SUBDIRECTORY fixture (a flat corpus cannot exercise recursion — all four
        # original fixtures were flat, so scanned==4 was satisfiable by a one-level walker).
        os.mkdir(os.path.join(pd, "sub"))
        open(os.path.join(pd, "sub", "nested-trap.md"), "w").write(
            "The nested zephyrblade policy was owner-ruled: forbidden below deck.\n")
        hits, scanned = scan(pd, dec)
        check("scanned all 5 fixture docs (incl. nested)", scanned == 5)
        check("nested unmirrored ruling flagged (recursion positive control)",
              any(h[0] == os.path.join("sub", "nested-trap.md") for h in hits))
        check("unmirrored ruling flagged (positive control)", any(h[0] == "trap-doc.md" for h in hits))
        check("token-mirrored ruling suppressed", not any(h[0] == "ok-doc.md" for h in hits))
        check("doc-name-mirrored ruling suppressed", not any(h[0] == "mirrored-doc.md" for h in hits))
        check("mention line suppressed", not any(h[0] == "meta-doc.md" for h in hits))
        # RED control on the DETECTOR (the oracle half): an empty plans dir must
        # yield zero hits AND zero scanned — a nonzero here means the walker reads outside its dir.
        os.mkdir(os.path.join(td, "empty"))
        h2, s2 = scan(os.path.join(td, "empty"), dec)
        check("empty-dir yields 0/0 (walker containment)", h2 == [] and s2 == 0)
        # malformed: missing DECISIONS must fail LOUD, not return []
        try:
            scan(pd, os.path.join(td, "nope.md"))
            check("missing DECISIONS fails loud", False)
        except SystemExit:
            check("missing DECISIONS fails loud", True)
    print(f"\nself-test: {'PASS' if fails == 0 else f'{fails} FAILURES'}")
    return fails == 0


def main(argv):
    if "--self-test" in argv:
        sys.exit(0 if self_test() else 1)
    since = None
    if "--since" in argv:
        try:
            since = int(argv[argv.index("--since") + 1])
        except (IndexError, ValueError):
            raise SystemExit("--since needs an integer day count")
    unknown = [a for a in argv[1:] if a not in ("--self-test", "--since")
               and not a.isdigit()]
    if unknown:
        print(f"unknown args: {unknown}", file=sys.stderr)
        sys.exit(2)
    hits, scanned = scan(since_days=since)
    print(f"plans-ruling-scan — {len(hits)} unmirrored ruling-shaped line(s) / {scanned} docs scanned")
    print("(TRIAGE list — presence-shaped counterpart check; over-flagging is by design; verify by hand)")
    for name, ln, text, toks in hits:
        print(f"  plans/{name}:{ln}  {text}")
        print(f"      counterpart-tokens tried: {toks}")
    sys.exit(0)


if __name__ == "__main__":
    main(sys.argv)
