#!/usr/bin/env python3
"""smoke-expected-failures.py — sort a smoke run's failures into expected and unexpected.

WHY. Run in a fresh repository that holds only the public copy of this system, scripts/smoke-test-hooks.sh
fails well over a hundred of its arms, every one for want of something the copy does not ship or the
adopting project supplies: a pre-push hook, the project's own files, a record working sessions write, the
git hooks path, more history than one commit. A newcomer met that many red lines with no way to tell those
from a real break. The copy therefore ships an expected-failures list, and the suite's closing summary
runs this script over its failures, so a fresh copy reads "N expected, 0 unexpected" and anything else
stands out.

WHERE IT RUNS. The suite calls it only when scripts/smoke-expected-failures.txt exists. That file lives
only in the copy (its source is scripts/release/smoke-expected-failures.txt), so in a repository without
it the suite's output is unchanged. It never changes the suite's exit code: an expected failure is still a
failure, and it reads as one until its cause is supplied or its arm is dropped.

THE LIST. One failure per line, # comments and blank lines ignored. An entry matches a failure when the
failure equals it, or starts with it followed by " (": the assert helpers append the actual value in
parentheses, and that value carries temporary paths that differ on every run. An entry is taken verbatim
apart from trailing whitespace, since some arm labels begin with spaces.

USAGE  python3 scripts/smoke-expected-failures.py [--partial] <list-file>   (failures on stdin, NUL-separated)
       python3 scripts/smoke-expected-failures.py --self-test
  --partial   a section-filter run: entries that did not fail are not reported as stale, since their arms
              may not have run.
EXIT   0 = classified (whatever the counts) · 1 = a --self-test check failed · 2 = usage, or the list file is missing, unreadable or not UTF-8.
"""
import contextlib
import io
import os
import sys
import tempfile


def read_list(path):
    entries = []
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.rstrip("\r\n").rstrip()
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            entries.append(line)
    return entries


def matches(entry, failure):
    f = failure.rstrip()
    return f == entry or f.startswith(entry + " (")


def classify(entries, failures):
    """Return (expected, unexpected, stale, duplicates): failures split by the list, the list entries
    no failure matched, and entries listed more than once."""
    expected, unexpected, hit = [], [], set()
    for f in failures:
        found = [i for i, e in enumerate(entries) if matches(e, f)]
        if found:
            expected.append(f)
            hit.update(found)
        else:
            unexpected.append(f)
    seen, duplicates = set(), []
    for e in entries:
        if e in seen and e not in duplicates:
            duplicates.append(e)
        seen.add(e)
    # A duplicate entry is reported once as a duplicate, never twice as stale.
    hit_entries = {entries[i] for i in hit}
    stale = []
    for e in entries:
        if e not in hit_entries and e not in stale:
            stale.append(e)
    return expected, unexpected, stale, duplicates


def first_line(s):
    return s.split("\n", 1)[0]


def render(list_name, entries, failures, partial):
    expected, unexpected, stale, duplicates = classify(entries, failures)
    out = []
    out.append("Of %d failure(s): %d expected, %d unexpected. The expected ones are red on a fresh copy for the"
               " reason %s gives beside each; supply what it needs, or drop the arm and its line."
               % (len(failures), len(expected), len(unexpected), list_name))
    if duplicates:
        out.append("Listed more than once in %s (%d):" % (list_name, len(duplicates)))
        out.extend("  * " + e for e in duplicates)
    if partial:
        out.append("Partial run: list entries whose arms did not run are not checked.")
    elif stale:
        out.append("On the list but did not fail this run; remove them from %s (%d):" % (list_name, len(stale)))
        out.extend("  * " + e for e in stale)
    if unexpected:
        out.append("Unexpected: not on the list, read each one before anything else (%d):" % len(unexpected))
        out.extend("  * " + first_line(f) for f in unexpected)
    out.append("  %d expected, %d unexpected" % (len(expected), len(unexpected)))
    return "\n".join(out)


def read_failures(data):
    return [f for f in data.split("\0") if f.strip()]


def self_test():
    fails = 0

    def check(name, cond):
        nonlocal fails
        print(("  ok   " if cond else "  FAIL ") + name)
        if not cond:
            fails += 1

    entries = [
        "hook A blocks the push",
        "  ...main() folds the clock finding",
        "label with (parens) inside",
        "never fails here",
    ]
    failures = [
        "hook A blocks the push (expected='1' actual='0')",
        "  ...main() folds the clock finding (output missing 'CLOCK')",
        "label with (parens) inside (floor=83 passed='none')",
        "hook A blocks the push harder",
        "a brand new red (got: line one\nline two)",
    ]
    exp, unexp, stale, dup = classify(entries, failures)
    check("an exact label with a varying parenthesised tail is expected", failures[0] in exp)
    check("a label that begins with spaces matches only verbatim", failures[1] in exp)
    check("a label carrying its own parentheses matches at the ' (' after it", failures[2] in exp)
    check("a longer label that merely starts with an entry is NOT expected", failures[3] in unexp)
    check("a failure on no line is unexpected", failures[4] in unexp)
    check("an entry no failure matched is stale", stale == ["never fails here"])
    check("no duplicates in a clean list", dup == [])
    check("exact equality matches without a tail", matches("x y", "x y"))
    check("no boundary, no match", not matches("x y", "x yz (1)"))

    text = render("L.txt", entries, failures, partial=False)
    check("the count line reads N expected, M unexpected", text.splitlines()[-1] == "  3 expected, 2 unexpected")
    check("an unexpected multi-line failure prints its first line only", "  * a brand new red (got: line one" in text
          and "line two" not in text)
    check("the stale entry is named", "  * never fails here" in text)
    check("no bullet starts with '  - ' (smoke-mutation-matrix.sh parses those after 'Failures:')",
          not any(l.startswith("  - ") for l in text.splitlines()))

    ptext = render("L.txt", entries, failures, partial=True)
    check("a partial run names no stale entry", "never fails here" not in ptext and "Partial run" in ptext)
    check("a partial run still names each unexpected failure and counts it",
          "  * a brand new red (got: line one" in ptext and ptext.splitlines()[-1] == "  3 expected, 2 unexpected")
    check("a partial run still names a duplicate entry", "Listed more than once" in render("L.txt", ["a", "a"], [], partial=True))
    check("an entry that begins with spaces does not match the same words unindented", not matches("  x y", "x y (1)"))

    ztext = render("L.txt", entries, [], partial=False)
    check("zero failures: every entry is stale and the count reads 0 expected, 0 unexpected",
          ztext.splitlines()[-1] == "  0 expected, 0 unexpected" and "(4):" in ztext)

    exp2, unexp2, stale2, dup2 = classify(["a", "a", "b"], ["a (1)"])
    check("a duplicate entry is reported once and is not also stale", dup2 == ["a"] and stale2 == ["b"])

    check("NUL-separated input keeps a newline inside one failure",
          read_failures("one (x)\0two\nlines\0\0") == ["one (x)", "two\nlines"])

    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "list.txt")
        with open(p, "w", encoding="utf-8") as fh:
            fh.write("# a group header\n\nhook A blocks the push   \n  ...main() folds the clock finding\n# x\n")
        check("comments, blank lines and trailing spaces are dropped; leading spaces are kept",
              read_list(p) == ["hook A blocks the push", "  ...main() folds the clock finding"])
        sink = io.StringIO()
        with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            rc_missing = main([os.path.join(d, "nope.txt")], "")
            rc_present = main([p], "hook A blocks the push (x)\0")
        check("a missing list file is a usage error (rc 2)", rc_missing == 2 and "cannot read" in sink.getvalue())
        check("a present list file classifies (rc 0)", rc_present == 0 and "  1 expected, 0 unexpected" in sink.getvalue())
        bad = os.path.join(d, "bad.txt")
        with open(bad, "wb") as fh:
            fh.write(b"x\n\xff\n")
        sink2 = io.StringIO()
        with contextlib.redirect_stdout(sink2), contextlib.redirect_stderr(sink2):
            rc_bad = main([bad], "x (y)\0")
        check("a list file that is not UTF-8 is a usage error (rc 2), not a traceback", rc_bad == 2 and "cannot read" in sink2.getvalue())

    print("self-test: %d failed" % fails)
    return 1 if fails else 0


def main(argv, stdin_data=None):
    if argv == ["--self-test"]:
        return self_test()
    partial = False
    args = list(argv)
    if args and args[0] == "--partial":
        partial = True
        args = args[1:]
    if len(args) != 1 or args[0].startswith("-"):
        sys.stderr.write(__doc__.split("USAGE", 1)[1].split("EXIT", 1)[0])
        return 2
    path = args[0]
    try:
        entries = read_list(path)
    except (OSError, UnicodeDecodeError) as e:
        sys.stderr.write("smoke-expected-failures: cannot read %s: %s\n" % (path, getattr(e, "strerror", None) or e))
        return 2
    # Bytes, decoded leniently: a failure's actual value can carry any bytes the arm captured, and one undecodable
    # byte must not turn the whole split into a traceback.
    data = sys.stdin.buffer.read().decode("utf-8", "replace") if stdin_data is None else stdin_data
    name = path
    if os.path.basename(path) == "smoke-expected-failures.txt":
        name = "scripts/smoke-expected-failures.txt"
    print(render(name, entries, read_failures(data), partial))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
