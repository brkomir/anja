#!/usr/bin/env python3
"""List the open todo.txt rows filed FOR a /meta maintain run (read-only).

Why: rows carry
`trigger: ... /meta maintain ...`, but nothing read that prose trigger: the
maintain runner does not open the tracker, and scripts/defer-trigger-scan.py
evaluates only `meta:` `trigger-type:` kinds. At filing, 16 open rows relied on
it.

A row is filed for maintain when it is OPEN (`- [ ]`) and a `trigger...:` field
in it names /meta ... maintain (case-insensitive, "/meta telemetry or maintain"
included), read up to the field's end (a `|`, ` done-when:`, ` filed:` or ` owner:`), so a
later mention in a long one-line row does not count. Known misses (measured
2026-10-25): a trigger that wraps onto its next line; a field
labelled `owner:` instead of `trigger`; a checkbox-less item absorbed into the
row above (reported under that row's name); a trigger naming one member
("/meta memory-audit") without "maintain"; `[~]` rows and open sub-rows under a
closed parent (none name maintain today); a triage or disposition note naming
the run rather than a trigger field (e.g. "put it on the next /meta maintain
approval table"). Paths are not matched: "/meta" must be a command followed by
a space, so ".../skills/meta/references/process-maintain.md" is not a hit.

Usage:
  python3 scripts/meta-maintain-filed-rows.py [todo-path]
  python3 scripts/meta-maintain-filed-rows.py --self-test
"""
import os
import re
import sys

TRIGGER = re.compile(
    r"trigger[^:\n]{0,20}:(?:(?!\|| done-when:| filed:| owner:)[^\n])*?(?<![\w./-])/meta(?=\s)(?:(?!\|| done-when:| filed:| owner:)[^\n])*?\bmaintain\b",
    re.I,
)


def filed_rows(lines):
    """[(line_no, head)] for every open row whose trigger names /meta maintain, plus the row count."""
    rows, cur = [], None
    for n, line in enumerate(lines, 1):
        if line.startswith("- ["):
            cur = {"n": n, "open": line.startswith("- [ ]"), "head": line.rstrip("\n"), "body": line}
            rows.append(cur)
        elif cur is not None:
            cur["body"] += line
    hits = [(r["n"], r["head"]) for r in rows if r["open"] and TRIGGER.search(r["body"])]
    return hits, len(rows)


def self_test():
    fixture = [
        "- [ ] OPEN-HIT — something\n",
        "  trigger: next /meta maintain\n",
        "- [x] CLOSED-HIT — done\n",
        "  trigger: next /meta maintain\n",
        "- [ ] OPEN-OTHER — unrelated\n",
        "  trigger: next deploy\n",
        "- [ ] OPEN-MENTION — mentions /meta maintain outside a trigger line\n",
        "- [ ] OPEN-INLINE-HIT — x. Trigger: next /meta self-audit or /meta maintain\n",
        "- [ ] OPEN-CROSSLINE — y\n",
        "  trigger: next deploy\n",
        "  note: then /meta maintain\n",
        "- [ ] OPEN-BACKLOG — z\n",
        "  trigger: the next /backlog maintain\n",
        "- [ ] OPEN-LATE-MENTION — w | trigger: 2026-09-21 | print DUE lines into the /meta maintain due-row\n",
        "- [ ] OPEN-MEMBER-OR — v\n",
        "  trigger: the next /meta telemetry or maintain run\n",
        "- [ ] OPEN-CROSSLINE-2 — u\n",
        "  trigger: next /meta self-audit\n",
        "  note: maintain the list\n",
        "- [ ] OPEN-PROSE-TRIGGER — t. The trigger date passed (see notes). Owner: print into the /meta maintain row\n",
        "- [ ] OPEN-LABEL — s\n",
        "  Trigger to build: the next /meta maintain\n",
        "- [ ] OPEN-DONEWHEN — r\n",
        "  trigger: 2026-09-21 done-when: the /meta maintain row lists it filed: 2026-09-01\n",
        "- [ ] OPEN-FILED — q\n",
        "  trigger: 2026-09-21 filed: by the /meta maintain run\n",
        "- [ ] OPEN-SECONDFIELD — p\n",
        "  trigger: next /meta self-audit | done-when: maintain list\n",
        "- [ ] OPEN-PATH — o\n",
        "  trigger: the next edit to .claude/skills/meta/references/process-maintain.md\n",
        "- [ ] OPEN-LATER-OWNER — n\n",
        "  trigger: next /meta self-audit; owner: maintain it\n",
        "- [ ] OPEN-EARLY-OWNER — m\n",
        "  trigger: next deploy; owner: run /meta maintain\n",
    ]
    want = ["OPEN-HIT", "OPEN-INLINE-HIT", "OPEN-MEMBER-OR", "OPEN-LABEL"]
    hits, total = filed_rows(fixture)
    names = [h.split(" — ")[0][6:] for _, h in hits]
    checks = [
        (names == want, f"expected {want}, got {names}"),
        (total == 18, f"expected 18 rows read, got {total}"),
        ([n for n, _ in hits] == [1, 8, 15, 21], f"expected line numbers [1, 8, 15, 21], got {[n for n, _ in hits]}"),
    ]
    bad = [msg for ok, msg in checks if not ok]
    for msg in bad:
        print("FAIL:", msg)
    print("self-test:", "PASS" if not bad else f"FAIL ({len(bad)})")
    return 1 if bad else 0


def main(argv):
    if "--self-test" in argv:
        return self_test()
    unknown = [a for a in argv if a.startswith("-")]
    if unknown:
        print(f"unknown option(s): {' '.join(unknown)} (see --help)", file=sys.stderr)
        return 2
    default = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "todo.txt"))
    path = next((a for a in argv if not a.startswith("-")), default)
    with open(path, encoding="utf-8") as fh:
        hits, total = filed_rows(fh)
    for n, head in hits:
        print(f"{path}:{n}  {head[6:120]}")
    print(f"{len(hits)} open row(s) filed for /meta maintain (of {total} rows read; known misses: --help)")
    return 0


if __name__ == "__main__":
    if "--help" in sys.argv or "-h" in sys.argv:
        print(__doc__)
        sys.exit(0)
    sys.exit(main(sys.argv[1:]))
