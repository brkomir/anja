#!/usr/bin/env python3
"""
extract-closer-baseline.py — snapshot the owner-facing CLOSER corpus before a legibility fix ships.

WHY THIS EXISTS, AND WHY IT IS URGENT RATHER THAN NICE-TO-HAVE.
The owner-illegible-readout class (6 instances / 5 sessions,
2026-08-07..2026-08-12) is about to get a fix. Whether that fix WORKS can only be judged against
what closers looked like BEFORE it. That corpus lives exclusively in `~/.claude/projects/.../*.jsonl`,
which is a ROLLING window (~30 days) — so the pre-fix baseline is not "cheap to get later", it is
UNRECOVERABLE later. Extract before the fix, or every future "this improved" is a delta with no prior.

WHY NOT MEASURE VIA THE CORRECTIONS REGISTRY INSTEAD:
  · every registry entry REQUIRES an "Owner pushback signal" field, so the registry samples
    owner-ASK events = incidence x P(owner bothers to ask). P(asks) is unknown and non-constant.
  · `meta-corrections-scan.py --analyze` withholds a gate verdict until >=15 post-ship events
    CARRYING the measured tag (GATE_MIN_TAG_EVENTS). At this class's ~0.06/day rate that quorum
    fills in ~250 days IF THE GATE DOES NOTHING, and NEVER if the gate works — success and
    no-data print the identical "VERDICT WITHHELD". A control that cannot return the other
    answer measures nothing.
This script's denominator is ALL closers, not just the ones that drew a question, which is what
makes it a two-sided instrument.

WHAT IT DOES NOT DO: it does not GRADE. Legibility is a judgment and the author is the one reader
guaranteed to hold the referents, so self-grading is the vacuous control this whole arc is about.
Grade the output with a FRESH-CONTEXT agent over era-stripped, shuffled rows.

⛔ THE `floor_tokens` FIELD DOES NOT DISCRIMINATE — MEASURED, DO NOT READ IT AS A SIGNAL.
Measured 2026-08-12 over 130 closers: 125-126 flagged across two consecutive runs, i.e. ~96-97%.
(The range is not sloppiness — the corpus is LIVE and rolling, and the extracting session's own
closer is inside it, so the exact count moves between runs. Re-run rather than cite this figure.)
A detector that fires on ~97% of the population carries ~no information about any individual row.
Combined with the
independently-measured 3/6 RECALL against the six known instances, the token approach is capped
from BOTH directions at once: it misses half the real failures and flags nearly everything else.
The misses are ordinary English words carrying project-internal senses ("the roll", "the fleet is
wrapped", "dirty files"), which no token list reaches; the false fires are legitimate git shas,
`HEAD`/`PASS`-class status words, and unit-bearing counts that a closer is SUPPOSED to carry.

The field is retained ONLY as a corpus artifact so a future grader can see why the lexical route
was abandoned. THE INSTRUMENT IS THE FRESH-CONTEXT GRADER, not this field. Anyone tempted to
re-derive a token detector should re-run this script first and look at the 97%.

⛔ `--since` IS WHAT MAKES THE DECISION REACHABLE, and it is not a convenience flag.
The open question this corpus exists to settle ("did the plain-line format obligation actually
fire, or did it lapse like the three prose homes before it?") is only decidable if producing the
POST-fix reading costs one command. Without `--since`, the second half of the comparison is a
rebuild-from-scratch job, and a decision whose evidence nobody can cheaply produce is a deferral
wearing a measurement costume. Both readings must be equally cheap or neither is real.

  BEFORE (this run's baseline): 130 closers, pre-fix
  AFTER  (the deciding read)  : --since 2026-08-13, once ~20 closers have accumulated

Two readings, each of which settles it:
  · post-fix closers lead with a plain line  -> the format obligation fires; no sniff-test
    skip carve-out is needed; the 2-2 panel split is closed on evidence.
  · they do not                              -> it lapsed exactly like the three prose homes,
    and the carve-out ships backed by a measurement instead of a tie.

⛔ DO NOT GRADE THE OUTPUT YOURSELF. The author of a closer is the one reader guaranteed to hold
its referents — self-grading here is the vacuous control this entire arc is about. Hand the rows
to a FRESH-CONTEXT agent, era-stripped and shuffled, so the grader can return "post is worse".

Usage:
  python3 scripts/extract-closer-baseline.py --out plans/closer-baseline-<date>.json
  python3 scripts/extract-closer-baseline.py --since 2026-08-13 --out plans/closer-post-<date>.json
  python3 scripts/extract-closer-baseline.py --self-test
"""
import json
import os
import re
import sys
import glob

PROJECT_DIR = os.path.expanduser("~/.claude/projects/<project-key>")

# Advisory floor only. See module docstring: 3/6 measured recall, structurally capped.
FLOOR_PATTERNS = [
    (r"\brc=\d", "raw tool token"),
    (r"\b\d+(\.\d+)?\s*(-)?\s*(byte|KB|MB|%)\b", "unit-bearing number"),
    (r"\b[a-z_]+\([^)]*\)", "identifier with parens"),
    (r"\b[A-Z]{4,}\b", "ALLCAPS token"),
    (r"\b[a-f0-9]{7,40}\b", "hex id"),
    (r"\b[LH]\d{2,4}\b", "rule id"),
    (r"[\w./-]+\.(mjs|py|ts|tsx|json|md):\d+", "path with line"),
]


def iter_records(path):
    """Yield parsed records. Tolerates partial/corrupt trailing lines."""
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except Exception:
                continue


def text_of(rec):
    """Extract text from a record.

    ⛔ CONTENT IS A BLOCK ARRAY in most records, not a string. A string-only extractor passes
    every file-level positive control and still returns ZERO messages — codified trap.
    Handle BOTH shapes.
    """
    msg = rec.get("message") or {}
    content = msg.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text") or "")
            elif isinstance(block, str):
                parts.append(block)
        return "\n".join(parts)
    return ""


def floor_flags(text):
    hits = []
    for pat, label in FLOOR_PATTERNS:
        if re.search(pat, text):
            hits.append(label)
    return hits


def extract(paths, since=None):
    rows, scanned, with_closer, filtered = [], 0, 0, 0
    for p in paths:
        scanned += 1
        sid = os.path.basename(p).replace(".jsonl", "")
        saw_wrap = False
        last_assistant, last_ts = "", ""
        for rec in iter_records(p):
            t = rec.get("type")
            if t == "user":
                u = text_of(rec)
                if "/wrap" in u or "/summary" in u:
                    saw_wrap = True
            elif t == "assistant":
                a = text_of(rec).strip()
                if a:
                    last_assistant = a
                    last_ts = rec.get("timestamp") or last_ts
        if saw_wrap and last_assistant:
            with_closer += 1
            # `since` filters on the closer's OWN timestamp, not the file's mtime: a long-running
            # session started pre-fix still emits post-fix closers, and mtime would drop them.
            if since and (not last_ts or last_ts[:10] < since):
                filtered += 1
                continue
            # the CLOSER = trailing prose of the final assistant turn. ⛔ A "does it LEAD with a plain
            # line" grade needs the HEAD: on messages over 12 lines the tail never contains the lead
            # (0 of 92 post-fix `Bottom line:` slots fell inside it). Keep both, grade `lead_text`.
            lines = last_assistant.splitlines()
            tail = "\n".join(lines[-12:])
            rows.append({
                "session": sid[:8],
                "ts": last_ts,
                "n_lines": len(lines),
                "lead_text": "\n".join(lines[:12]),
                "closer_text": tail,
                "floor_tokens": floor_flags(tail),
            })
    return rows, scanned, with_closer, filtered


def self_test():
    """Positive controls. Each arm must be able to return the OTHER answer."""
    fails = []

    # ARM 1 — block-array content MUST extract (the codified zero-return trap)
    block = {"message": {"content": [{"type": "text", "text": "hello"}]}}
    if text_of(block) != "hello":
        fails.append("ARM1 block-array extraction returned %r" % text_of(block))
    # ...and the string shape must ALSO work
    if text_of({"message": {"content": "plain"}}) != "plain":
        fails.append("ARM2 string extraction failed")
    # NEGATIVE control for ARM1/2 — a record with no text must yield ""
    if text_of({"message": {"content": [{"type": "tool_use"}]}}) != "":
        fails.append("ARM3 negative control returned text where none exists")

    # ARM 4 — the floor MUST fire on a known-bad closer and NOT on a known-good one.
    bad = "the only thing closing now costs is the 73-byte index headroom staying un-relieved"
    good = "Safe to stop. Nothing of yours is uncommitted, and the push still needs your approval."
    if not floor_flags(bad):
        fails.append("ARM4a floor did not fire on the measured failing closer")
    if floor_flags(good):
        fails.append("ARM4b floor FALSE-fired on a conforming closer: %s" % floor_flags(good))

    # ARM 5 — the corpus must be reachable at all (an empty glob is an instrument failure,
    # never evidence that no closers exist).
    n = len(glob.glob(os.path.join(PROJECT_DIR, "*.jsonl")))
    if n == 0:
        fails.append("ARM5 transcript dir unreachable or empty: %s" % PROJECT_DIR)

    for f in fails:
        print("  FAIL %s" % f)
    print("self-test: %s (%d transcripts visible)" % ("PASS" if not fails else "FAIL", n))
    return 1 if fails else 0


def main():
    if "--self-test" in sys.argv:
        sys.exit(self_test())
    out = None
    if "--out" in sys.argv:
        out = sys.argv[sys.argv.index("--out") + 1]
    paths = sorted(glob.glob(os.path.join(PROJECT_DIR, "*.jsonl")))
    if not paths:
        print("ABORT: no transcripts at %s — instrument failure, not an empty corpus" % PROJECT_DIR)
        sys.exit(1)
    since = None
    if "--since" in sys.argv:
        since = sys.argv[sys.argv.index("--since") + 1]
    rows, scanned, with_closer, filtered = extract(paths, since)
    flagged = sum(1 for r in rows if r["floor_tokens"])
    print("transcripts scanned      : %d" % scanned)
    print("containing /wrap|/summary: %d" % with_closer)
    if since:
        print("since filter             : %s  (%d closers excluded as pre-cutoff)" % (since, filtered))
    print("closers captured         : %d" % len(rows))
    print("floor-flagged (ADVISORY) : %d of %d  <- a FLOOR (3/6 measured recall), never a verdict"
          % (flagged, len(rows)))
    if out:
        with open(out, "w", encoding="utf-8") as fh:
            json.dump({
                "captured_from": PROJECT_DIR,
                "transcripts_scanned": scanned,
                "with_closer": with_closer,
                "since": since,
                "n": len(rows),
                "floor_flagged": flagged,
                "note": ("POST-FIX READ (--since %s). " % since if since else "PRE-FIX BASELINE. ") + "floor_tokens DOES NOT DISCRIMINATE (measured 97% flag rate "
                        "on this corpus, 3/6 recall on known instances) - it is a corpus artifact, "
                        "NOT a signal. Grade with a fresh-context agent over era-stripped shuffled rows.",
                "rows": rows,
            }, fh, indent=1)
        print("wrote %s" % out)


if __name__ == "__main__":
    main()
