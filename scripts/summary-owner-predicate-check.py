#!/usr/bin/env python3
"""Regression sentinel for the /summary §5 owner-field predicate.

WHY THIS EXISTS. That predicate decides which open tracker rows a seat reports to the
owner as "mine to do". It has been wrong EIGHT measured times (see the failure table in
`.claude/skills/summary/SKILL.md` §5), twice on 2026-08-30 alone, and the failure direction
is always the expensive one: a row somebody ELSE owns lands in a seat's own column, where
it is either done twice or silently dropped from the handoff meant to carry it. Every one
of those eight was found by a human noticing a wrong answer. There was no test.

A missing test was the only finding whose fix would have
caught failures 5 through 8 alike. This is that fix.

WHAT IT TESTS, AND WHY IT IS NOT A REPLICA. The predicate has no module to import — it
lives as a Python block inside the skill spec, because the spec IS the implementation. So
this sentinel EXTRACTS the live regexes from the spec and exercises those. A replica would
be structurally unfailable: it would pass while the shipped predicate rotted (the class
codified at `/meta self-audit` Check 13 — "a self-test whose assertions consume the REAL
exported symbol").

TWO MODES.
  --self-test  fixture regression over the EXTRACTED regexes, plus a MUTATION arm that
               swaps in each historical broken form and demands the fixtures go RED. The
               mutation arm is what proves the assertions are live rather than decorative.
  (default)    scan the live tracker and report open rows that would land in a seat's
               "mine" column while a genuine owner field names a different seat.

READ-ONLY. Writes nothing, anywhere, in either mode.
"""

import re
import textwrap
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SPEC = REPO / ".claude" / "skills" / "summary" / "SKILL.md"
TODO = REPO / "todo.txt"

# ── extraction ────────────────────────────────────────────────────────────────────────
# Pull the two shipped regexes out of the spec by their assignment lines. If either is
# missing the sentinel ABORTS LOUD rather than silently testing nothing — an extraction
# that quietly yields no pattern is the vacuous control this file exists to prevent.

def extract_predicates():
    if not SPEC.is_file():
        die(f"spec not found at {SPEC}")
    text = SPEC.read_text(encoding="utf-8", errors="replace")
    out = {}
    for sym in ("owner_line", "owner_pipe"):
        m = re.search(rf"^{sym} = re\.compile\((r'.*?')(?:, re\.M)?\)", text, re.M)
        if not m:
            die(
                f"EXTRACTION FAILED: no `{sym} = re.compile(...)` in {SPEC.name}.\n"
                f"  Either the predicate was renamed or its shape changed. This sentinel\n"
                f"  cannot test what it cannot find, and a silent pass here is exactly the\n"
                f"  failure mode it exists to catch. Update the extractor deliberately."
            )
        flags = re.M if ", re.M)" in m.group(0) else 0
        out[sym] = re.compile(eval(m.group(1)), flags)  # noqa: S307 - literal from our own spec
    return out["owner_line"], out["owner_pipe"]


def die(msg):
    print(f"summary-owner-predicate-check: {msg}", file=sys.stderr)
    sys.exit(2)


def read_owner(body, line_re, pipe_re):
    """The shipped resolution order: a line-anchored field is AUTHORITATIVE, an inline
    field after a separator is only a FALLBACK. Reversing these two lines re-opens
    failure 8."""
    m = line_re.search(body) or pipe_re.search(body)
    return m.group(1) if m else None


# ── fixtures — one per historical failure, each named for the failure it locks ─────────
# Every fixture states the value the predicate MUST return. A fixture whose expectation a
# broken form also satisfies is worthless, so each is chosen to DISCRIMINATE: the historical
# broken form returns something different, which the mutation arm below asserts.

FIXTURES = [
    (
        "F7 inline: an owner field after ` | ` must be read",
        "  filed: 2026-08-30 by <session-id> (/meta learn) | owner: <owner>\n",
        "<owner>",
    ),
    (
        "F8 shadowing: prose after a pipe must NOT beat a real field line",
        "  ran /audit-check | owner: bbbbbbbb | /orient\n  owner: aaaaaaaa\n",
        "aaaaaaaa",
    ),
    (
        "F8b newline: the fallback arm must not reach across a row boundary",
        "  loc: 2 |\n  owner: peer0001\n",
        "peer0001",  # reached by the LINE arm; the pipe arm alone must not cross
    ),
    (
        "line-anchored still read (the form that worked before 7)",
        "  owner: <session-id>\n",
        "<session-id>",
    ),
    (
        "no owner field at all -> None, never a guess",
        "  filed: 2026-08-30 by <session-id>\n  loc-estimate: ~6 LOC\n",
        None,
    ),
]

# ⛔ THE ARM THIS FILE CALLS "THE LOAD-BEARING HALF" COULD BE DELETED WHOLE AND EVERYTHING
# STILL PASSED — re-measured 2026-09-10 and STILL LIVE at that point.
# `ARM 2 — MUTATION` prints its banner BEFORE the loop, so emptying this dict left the loop
# body unreached, `failures` empty, rc=0, and every smoke assertion green. The mutant even
# announced itself in the line the assertion reads — "1 mutation arms" instead of 3 — and
# nothing looked at that number.
#
# ⛔ THE FIX IS MEMBERSHIP, NOT A COUNT. `session-cadence.md` § A DECLARED COUNT CAN BE
# SATISFIED; A REFUSAL CANNOT: a count's only power is making someone LOOK, so a matching
# number releases exactly the attention it was supposed to buy. Membership has no satisfying
# input — delete an arm and its own name is what goes missing. A count would also have passed
# the partial trim measured here (3 -> 1), which is the shape a real edit takes.
#
# Adding a genuine new arm? Add its key here in the SAME edit. That is the point: the required
# set is the ledger, and it is meant to cost one line.
REQUIRED_MUTATION_ARMS = ("F7 form", "F8 form")

# The historical broken forms. Each MUST fail at least one fixture; if one passes them all,
# that fixture set no longer discriminates and this sentinel has gone decorative.
HISTORICAL_BROKEN = {
    "F7 form (^-anchored only — blind to the inline field)": (
        re.compile(r"^\s*owner: *(\S+)", re.M),
        re.compile(r"(?!)"),  # never matches: the F7 form had no fallback arm at all
    ),
    "F8 form (one alternation — prose after a pipe shadows)": (
        re.compile(r"(?:^|\|)\s*owner: *(\S+)", re.M),
        re.compile(r"(?!)"),
    ),
}


# ── row LABEL (failure 9, 2026-08-31) ─────────────────────────────────────────────────
# §4/§5 used `^- \[ \] ([A-Z0-9-]+)` to read a row's name. That capture stops at the first
# lowercase letter, so `- [ ] Founder's own test purchase` became a row named `F` and
# reached an owner-facing list. ALLCAPS-hyphenated is a CONVENTION: measured on the live
# tracker at filing time, 620 of 1871 rows (33%) do not follow it, and old-vs-new disagree
# on 481 OPEN rows. The two sites failed OPPOSITELY — §4's bare `.group(1)` would crash on
# a lowercase-initial row, §5's `if mm:` silently DROPPED it — which is why one fix and one
# fixture set has to cover both.

def extract_label_predicates():
    text = SPEC.read_text(encoding="utf-8", errors="replace")
    out = {}
    for sym in ("row_name", "row_id"):
        m = re.search(rf"^{sym} = re\.compile\((r'.*?')\)", text, re.M)
        if not m:
            die(
                f"EXTRACTION FAILED: no `{sym} = re.compile(...)` in {SPEC.name}.\n"
                f"  Failure 9's fix was removed or renamed. A silent pass here would restore\n"
                f"  the one-letter row name failure 9 produced."
            )
        out[sym] = re.compile(eval(m.group(1)))  # noqa: S307 - literal from our own spec
    # ⛔ THIS ARM COMPARED ONLY THE TWO REGEXES UNTIL 2026-08-31, AND THE ALGORITHM AROUND
    # THEM WAS RE-TYPED IN THREE PLACES — §4, §5, and this file. A review lens mutated the
    # spec two ways (both copies 60->40, then §4 and §5 made algorithmically divergent) and
    # got `rc=0 SELF-TEST PASSED` both times. It was worse than unproven: §4 and §5 had
    # ALREADY diverged on an empty label (`- [ ] ` -> '' vs '(unparseable row)').
    # Now the WHOLE FUNCTION is compared and then EXECUTED, so the fixtures below exercise
    # the spec's real code and a replica cannot exist to drift from.
    # ⛔ INDENTATION-BOUNDED, NOT A GREEDY REGEX. A `(?:[ \t]+.*\n)+` body capture swallowed
    # the CALLER line that follows the def inside §5's loop (`print(row_label(r[0]))`, also
    # indented), so the two extracts differed by one line and the arm reported DRIFT on
    # identical functions — a false alarm on its first run. A Python block ends at the first
    # line indented no further than its `def`; slice on that, which is what the language does.
    fns = []
    lines = text.split("\n")
    for i, ln in enumerate(lines):
        if ln.lstrip().startswith("def row_label(first_line):"):
            base = len(ln) - len(ln.lstrip())
            body = [ln]
            for nxt in lines[i + 1:]:
                if nxt.strip() and (len(nxt) - len(nxt.lstrip())) <= base:
                    break
                body.append(nxt)
            fns.append("\n".join(body).rstrip() + "\n")
    if len(fns) != 2:
        die(f"expected exactly 2 `row_label` definitions in {SPEC.name}, found {len(fns)}.\n"
            f"  §4 and §5 must each carry the SAME function; an inline restatement in either\n"
            f"  place is what let them diverge unnoticed.")
    norm = [textwrap.dedent(f).strip() for f in fns]
    if norm[0] != norm[1]:
        die("`row_label` DRIFTED between §4 and §5 (compared as whole functions):\n"
            f"--- §4 ---\n{norm[0]}\n--- §5 ---\n{norm[1]}")
    ns = {"re": re, "row_name": out["row_name"], "row_id": out["row_id"]}
    exec(compile(norm[0], "<spec row_label>", "exec"), ns)  # noqa: S102 - our own spec text
    return out["row_name"], out["row_id"], ns["row_label"]


def extract_filed_predicate():
    """EXTRACT §4/§5's `FILED_BY` rather than replicate it.

    ⛔ THIS FILE CARRIED A REPLICA OF THE GREEDY FORM UNTIL 2026-09-03 — `scan()` had
    `filed:[^|\\n]*by ([0-9a-f]{8})` hard-coded, so the sentinel built to catch
    misattribution shared the exact bug that CAUSES it, and its own MISATTRIBUTION
    report was computed with a filer regex that could name the wrong seat. Extract,
    compare both spec copies, execute. A replica cannot drift if it does not exist.
    """
    text = SPEC.read_text(encoding="utf-8", errors="replace")
    fns, lines = [], text.split("\n")
    for i, ln in enumerate(lines):
        if ln.lstrip().startswith("def FILED_BY(sid):"):
            base = len(ln) - len(ln.lstrip())
            body = [ln]
            for nxt in lines[i + 1:]:
                if nxt.strip() and (len(nxt) - len(nxt.lstrip())) <= base:
                    break
                body.append(nxt)
            fns.append("\n".join(body).rstrip() + "\n")
    if len(fns) != 2:
        die(f"expected exactly 2 `FILED_BY` definitions in {SPEC.name}, found {len(fns)}.\n"
            f"  §4 and §5 must each carry the SAME predicate. Failure 9 (2026-09-03) was a\n"
            f"  greedy span that put a PEER's row in the reader's column; a silent pass here\n"
            f"  would restore it.")
    norm = [textwrap.dedent(f).strip() for f in fns]
    if norm[0] != norm[1]:
        die("`FILED_BY` DRIFTED between §4 and §5:\n"
            f"--- §4 ---\n{norm[0]}\n--- §5 ---\n{norm[1]}")
    ns = {"re": re}
    exec(compile(norm[0], "<spec FILED_BY>", "exec"), ns)  # noqa: S102 - our own spec text
    return ns["FILED_BY"]


# (label, row body, sid, expected-match)
FILED_FIXTURES = [
    ("F10: a row that CREDITS another seat must NOT read as that seat's own",
     "- [ ] A-ROW —\n  filed: 2026-09-03 by aaaaaaaa (grep for prior art run by bbbbbbbb and re-run by me)\n",
     "bbbbbbbb", False),
    ("F10: the row's REAL filer still matches",
     "- [ ] A-ROW —\n  filed: 2026-09-03 by aaaaaaaa (grep for prior art run by bbbbbbbb and re-run by me)\n",
     "aaaaaaaa", True),
    ("F10: a WRAPPED filed: field matches (the greedy form could not cross the newline)",
     "- [ ] A-ROW — text. filed:\n  2026-09-03 by cccccccc\n",
     "cccccccc", True),
    ("F10: an ordinary single-line field matches",
     "- [ ] A-ROW —\n  filed: 2026-08-30 by dddddddd (/meta learn) | owner: <owner>\n",
     "dddddddd", True),
    ("F10: a sid mentioned in PROSE with no filed: field does not match",
     "- [ ] A-ROW — measured by bbbbbbbb and confirmed. owner: bbbbbbbb\n",
     "bbbbbbbb", False),
]


# The shipped-broken greedy form, for the mutation arm.
def broken_filed(sid):
    return r"filed:[^|\n]*by " + re.escape(sid)


LABEL_FIXTURES = [
    ("F9: a lowercase-initial row must NOT truncate to one letter",
     "- [ ] Founder's own test purchase + refund as an end-to-end acceptance check.\n",
     "Founder's own test purchase + refund as an end-to-end accept..."),
    ("F9: an ALLCAPS row still reads as its id",
     "- [ ] SOME-OPEN-ROW-NAME - a grant application\n",
     "SOME-OPEN-ROW-NAME"),
    ("F9: a `Flow #48` row labels with prose, not `F`",
     "- [ ] Flow #48 QA P2: concurrent-request integration tests for the action path\n",
     "Flow #48 QA P2: concurrent-request integration tests for the..."),
    ("F9: a CLOSED row is still labellable (the old form's `\\[ \\]` could not read it)",
     "- [x] SOME-CLOSED-ROW-NAME done\n",
     "SOME-CLOSED-ROW-NAME"),
    ("F9: a backtick-initial row labels with prose",
     "- [ ] `assertPublishable` / `publishToGallery` gate the same read\n",
     "`assertPublishable` / `publishToGallery` gate the same read"),
]

# The shipped-broken form, for the mutation arm. Returns what §4 printed before the fix.
def broken_label(first_line):
    m = re.match(r"^- \[ \] ([A-Z0-9-]+)", first_line)
    return m.group(1) if m else None


def self_test():
    line_re, pipe_re = extract_predicates()
    failures = []

    print("live predicate, extracted from the spec:")
    print(f"  owner_line = {line_re.pattern!r}")
    print(f"  owner_pipe = {pipe_re.pattern!r}\n")

    print("ARM 1 — fixtures against the LIVE predicate (all must pass):")
    for name, body, expected in FIXTURES:
        got = read_owner(body, line_re, pipe_re)
        ok = got == expected
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}\n         expected {expected!r}, got {got!r}")
        if not ok:
            failures.append(name)

    print("\nARM 2 — MUTATION: each historical broken form must go RED on >=1 fixture.")
    print("        (an arm that stays green here proves the fixtures stopped discriminating)")
    # ⛔ PRESENCE FIRST. Everything below this loop is unreachable when the dict is empty, so
    # without this the whole arm deletes silently — measured, twice, including after a peer
    # had grown the suite around it. Membership, not the count printed in the verdict line.
    missing = [k for k in REQUIRED_MUTATION_ARMS
               if not any(k in label for label in HISTORICAL_BROKEN)]
    if missing:
        print(f"  [FAIL] REQUIRED mutation arm(s) ABSENT: {', '.join(missing)}")
        print("         HISTORICAL_BROKEN was emptied or trimmed. The loop below cannot run,")
        print("         and every assertion downstream passes over nothing.")
        failures.extend(f"required mutation arm deleted: {m}" for m in missing)
    else:
        print(f"  [PASS] all {len(REQUIRED_MUTATION_ARMS)} required arms present "
              f"({', '.join(REQUIRED_MUTATION_ARMS)})")
    for label, (bad_line, bad_pipe) in HISTORICAL_BROKEN.items():
        reds = [n for n, b, e in FIXTURES if read_owner(b, bad_line, bad_pipe) != e]
        if reds:
            print(f"  [PASS] {label}\n         goes RED on: {', '.join(reds)}")
        else:
            print(f"  [FAIL] {label}\n         passes every fixture — the fixtures do not discriminate")
            failures.append(f"mutation arm not live: {label}")

    print("\nARM 3 — resolution ORDER is load-bearing, not cosmetic.")
    swapped = read_owner(FIXTURES[1][1], pipe_re, line_re)  # fallback consulted FIRST
    if swapped == FIXTURES[1][2]:
        print("  [FAIL] swapping line/pipe precedence changes nothing — order is untested")
        failures.append("precedence untested")
    else:
        print(f"  [PASS] swapping precedence returns {swapped!r} instead of {FIXTURES[1][2]!r}")

    row_name, row_id, row_label = extract_label_predicates()
    print("\nARM 4 — ROW LABEL fixtures (failure 9). The function is EXTRACTED FROM THE SPEC")
    print("        and executed here — there is no copy in this file to drift from.")
    print(f"        row_name = {row_name.pattern!r}")
    for name, line, expected in LABEL_FIXTURES:
        got = row_label(line)
        ok = got == expected
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}\n         expected {expected!r}, got {got!r}")
        if not ok:
            failures.append(name)

    print("\nARM 5 — MUTATION: the shipped-broken `([A-Z0-9-]+)` form must go RED.")
    print("        It is the form that read `Founder's own test purchase` as `F`.")
    reds = [n for n, l, e in LABEL_FIXTURES if broken_label(l) != e]
    if reds:
        print(f"  [PASS] broken form goes RED on {len(reds)} of {len(LABEL_FIXTURES)}:")
        for n in reds:
            print(f"           - {n}")
    else:
        print("  [FAIL] the broken form passes every label fixture — they do not discriminate")
        failures.append("label mutation arm not live")

    print("\nARM 6 — FILED-BY fixtures (failure 10). The predicate is EXTRACTED FROM THE SPEC")
    print("        and executed, so a replica in this file cannot drift from it.")
    filed_by = extract_filed_predicate()
    print(f"  FILED_BY('<sid>') = {filed_by('<sid>')!r}")
    for name, body, sid, expect in FILED_FIXTURES:
        got = bool(re.search(filed_by(sid), body))
        if got == expect:
            print(f"  [PASS] {name}")
        else:
            print(f"  [FAIL] {name}\n         expected match={expect}, got {got}")
            failures.append(name)

    print("\nARM 7 — MUTATION: the shipped-broken greedy `filed:[^|\\n]*by` form must go RED.")
    print("        It is the form that read a PEER's row as this seat's own because the row")
    print("        credited a collaborator later on the same line.")
    reds = [n for n, b, s, e in FILED_FIXTURES if bool(re.search(broken_filed(s), b)) != e]
    if reds:
        print(f"  [PASS] broken form goes RED on {len(reds)} of {len(FILED_FIXTURES)}:")
        for n in reds:
            print(f"           - {n}")
    else:
        print("  [FAIL] the greedy form passes every filed fixture — they do not discriminate")
        failures.append("filed mutation arm not live")

    print()
    if failures:
        print(f"SELF-TEST FAILED — {len(failures)} problem(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(f"SELF-TEST PASSED — {len(FILED_FIXTURES)} filed fixtures, "
          f"{len(FIXTURES)} owner fixtures, "
          f"{len(LABEL_FIXTURES)} label fixtures, "
          f"{len(HISTORICAL_BROKEN) + 1} mutation arms, 1 precedence arm, 1 drift arm.")
    return 0


# ── scan mode ─────────────────────────────────────────────────────────────────────────

def parse_rows(text):
    rows, cur = [], None
    for line in text.split("\n"):
        # `[^]]*` not `[ x]`: six checkbox forms live in todo.txt (1553 `[ ]`, 728 `[x]`, 14 `[~]`,
        # 2 `[REJECTED <date>]`, 1 `[note]`, 1 `[P3]` — measured 2026-09-05). This is a row
        # SPLITTER, so an unmatched form does not merely go missing: its lines append to the
        # PREVIOUS row and its `filed:`/`owner:` fields are read as that row's. 2281 -> 2299.
        if re.match(r"^- \[[^\]]*\] ", line):
            if cur is not None:
                rows.append(cur)
            cur = [line]
        elif cur is not None:
            cur.append(line)
    if cur is not None:
        rows.append(cur)
    return rows


def scan():
    """Report open rows that would land in a seat's "mine" column while a genuine owner
    field names a DIFFERENT seat. Deliberately narrow: only a row whose own `filed: by`
    seat differs from an 8-hex owner value counts, because that is the only shape that
    actually misattributes. `unassigned` / `unclaimed` are NOT misattributions — nobody
    owns those rows, so the filer seeing them is correct."""
    line_re, pipe_re = extract_predicates()
    if not TODO.is_file():
        die(f"tracker not found at {TODO}")
    rows = parse_rows(TODO.read_text(encoding="utf-8", errors="replace"))
    openrows = [r for r in rows if r and r[0].startswith("- [ ] ")]

    filed_by = extract_filed_predicate()
    hits = []
    for r in openrows:
        body = "\n".join(r)
        if read_owner(body, line_re, pipe_re):
            continue  # the predicate reads an owner — the exclusion arm works here
        # EXTRACTED from the spec, not replicated — see extract_filed_predicate().
        filer = None
        for cand in re.findall(r"\bby ([0-9a-f]{8})\b", body):
            if re.search(filed_by(cand), body):
                filer = cand
                break
        if not filer:
            continue  # no seat claims it, so it cannot land in anyone's column
        for m in re.finditer(r"owner: *\**([0-9a-f]{8})\**", body):
            if m.group(1) != filer:
                name = re.match(r"^- \[ \] (\S+)", r[0])
                hits.append((name.group(1) if name else "?", filer, m.group(1)))
                break

    print(f"scanned {len(openrows)} open rows in {TODO.name}")
    if not hits:
        print("MISATTRIBUTION: none — no open row lands in its filer's column while an "
              "8-hex owner field names another seat.")
        return 0
    print(f"MISATTRIBUTION: {len(hits)} row(s) — the predicate cannot read a peer owner field:")
    for name, f, o in hits:
        print(f"  {name}\n    filed by {f}, but an owner field names {o}")
    print("\nWarn-mode: this reports, it does not block. Each hit is a row a seat will "
          "report to the owner as its own.")
    return 0


def main():
    args = sys.argv[1:]
    if not args:
        return scan()
    if len(args) == 1 and args[0] == "--self-test":
        return self_test()
    if len(args) == 1 and args[0] in ("--scan", "scan"):
        return scan()
    # Explicit rejection: an unvalidated arg must not fall through to a default that
    # looks like success (the fail-OPEN shape codified at self-audit Check 13(e)).
    die(f"unrecognised argument(s): {args!r}\n  usage: summary-owner-predicate-check.py [--self-test | --scan]")


if __name__ == "__main__":
    sys.exit(main())
