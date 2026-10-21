#!/usr/bin/env python3
"""Post-deploy verification sweep for /push Step 7.

Reports `post-deploy-check:` meta fields in todo.txt TOGETHER WITH THEIR ROW'S CHECKBOX.

⛔ WHY THIS EXISTS. Step 7 swept with `grep -nE '^\\s+post-deploy-check:'` over the tracker. That
anchor is right and stays (it keys on STRUCTURE — the field is an indented meta line, a prose
mention never is — which is what stopped the sweep counting sentences about itself). What it
never did was read the OWNING ROW'S CHECKBOX. Every hit was handed to the owner as outstanding
work regardless of whether the row was closed years ago.

MEASURED 2026-09-08 at a deploy: the sweep returned 3 rows, ALL THREE `[x]` CLOSED,
and every one had been satisfied between 2026-09-01 and 2026-09-02. The whole
published list was already done, and it was handed over twice — once in a durable block, once
in a session closer.

⛔ THE RE-ARM QUESTION, ANSWERED, because the field's own wording invites the wrong answer.
Several of these fields read "after the next deploy, open /admin ...". That phrasing reads as a
STANDING re-arm — as though every deploy re-opens the obligation. It does not. **A
`post-deploy-check:` on a CLOSED row is the RECORD OF HOW THAT ROW WAS VERIFIED, not a
recurring chore.** Reading it as recurring turns every row that ever carried one into permanent
owner work, which is exactly the failure above. If a closed row genuinely needs re-checking
after some later deploy, that needs a real RE-OPENING event — flip the checkbox back with a
dated note saying why — never a field that silently reads as permanent.

So: OPEN rows are the worklist. Closed rows are history, shown only under --all.

Usage:
  python3 scripts/post-deploy-check-sweep.py            # the worklist: OPEN rows only
  python3 scripts/post-deploy-check-sweep.py --all      # every tagged row + its checkbox
  python3 scripts/post-deploy-check-sweep.py --self-test
Exit: 0 = nothing owed (or --all/--self-test ok), 3 = at least one OPEN check is owed.
"""
import os
import re
import sys

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TODO = os.path.join(_REPO, "todo.txt")

ROW_START = re.compile(r'^- \[([^\]]*)\] (.*)$')
# The SAME structural anchor Step 7 has always used — an indented meta field, never prose.
FIELD = re.compile(r'^\s+post-deploy-check:\s*(.*)$')


def sweep(path):
    """Return [{box, name, line, checks:[(lineno, text)]}] for rows carrying the field."""
    rows, cur = [], None
    with open(path, encoding="utf-8", errors="replace") as fh:
        for n, line in enumerate(fh, 1):
            m = ROW_START.match(line)
            if m:
                cur = {"box": m.group(1), "name": m.group(2).strip(), "line": n, "checks": []}
                rows.append(cur)
                continue
            if cur is None:
                continue
            f = FIELD.match(line)
            if f:
                cur["checks"].append((n, f.group(1).strip()))
    return [r for r in rows if r["checks"]]


# ⛔ DERIVED, NOT GUESSED — the MEASURED form set (2026-09-08, 2,519 rows in the tracker):
#   `[ ]` 1639 · `[x]` 862 · `[~]` 14 · `[REJECTED 2026-07-04]` 2 · `[note]` 1 · `[P3]` 1
# Exactly six, and a two-form `^- \[[ x]\] ` class reads 2,501 — it misses 18.
# ⚠️ The first version of this comment illustrated the set as ``[ ]`, `[x]`, `[~]`, `[!]`, ...``.
# **`[!]` does not exist in this tracker and `[REJECTED …]` does — and REJECTED is precisely the
# form that was misclassified.** The trailing `...` kept the sentence technically honest while the
# illustration named a phantom and omitted the live case that bites. If you cite a form
# set, derive it; an illustrative list is read as the set.
_TERMINAL = ("x", "done", "rejected")


def is_open(row):
    # OPEN means "not one of the TERMINAL markers", so an unrecognised marker reads OPEN and
    # SURFACES — the failing side, per bash-environment.md § WRITE A GATE SO INSTRUMENT FAILURE
    # LANDS ON THE FAILING SIDE. A novel marker read as CLOSED would silently hide a real check,
    # which is the bug this script exists to fix.
    # ⛔ `rejected` IS TERMINAL AND WAS MISSING. A REJECTED row is decided — same as
    # done for the question "is action owed here" — and it fell through to OPEN. Latent when
    # found (all 3 real fields sit under `[x]` rows), but a rejected row that ever carried a
    # `post-deploy-check:` would be republished as owed forever: this script's own bug, reached
    # by a different spelling. Matched as a PREFIX because the live form carries a date
    # (`[REJECTED 2026-07-04]`).
    box = row["box"].strip().lower()
    return not (box in _TERMINAL or box.startswith("rejected"))


def main(argv, todo_path=None):
    # ⛔ `todo_path` EXISTS SO THE SELF-TEST CAN REACH THIS FUNCTION. Without it
    # `self_test()` covered `sweep()` and `is_open()` — the data layer — while `main()`'s
    # n_open arithmetic and its rc 0 / rc 3 selection were covered by NOTHING, and that exit
    # code is the only thing `/push` Step 7 reads. Transposing the two returns left
    # `--self-test` printing 6/6 PASS while Step 7 either stopped reporting real owed checks
    # forever or claimed work was owed on every deploy. **The arms certified what the script
    # KNOWS and not what it DECIDES.**
    show_all = "--all" in argv
    hits = sweep(todo_path or TODO)
    shown = hits if show_all else [r for r in hits if is_open(r)]
    for r in shown:
        for n, txt in r["checks"]:
            print(f"  [{r['box']}] row@{r['line']} field@{n}  {r['name'][:58]}")
            print(f"        {txt[:150]}")
    n_open = sum(1 for r in hits if is_open(r))
    n_closed = len(hits) - n_open
    if show_all:
        print(f"\n{len(hits)} tagged row(s): {n_open} OPEN, {n_closed} closed (history, not a chore).")
        return 0
    if n_open == 0:
        print(f"\nNo post-deploy check is owed. ({n_closed} closed row(s) carry the field as the "
              f"record of how they were verified — --all to see them; they are NOT re-armed by a "
              f"new deploy.)")
        return 0
    print(f"\n{n_open} OPEN post-deploy check(s) owed — action or explicitly defer each. "
          f"({n_closed} closed, hidden.)")
    return 3


def self_test():
    import tempfile
    fixture = """- [ ] OPEN-ROW-WITH-CHECK — a live one
  meta:
    post-deploy-check: OPENNEEDLE load /admin and count the lines
- [x] CLOSED-ROW-WITH-CHECK — satisfied months ago
  meta:
    post-deploy-check: CLOSEDNEEDLE after the next deploy, open /admin
- [ ] ROW-WITH-NO-CHECK — must not appear at all
  meta:
    done-when: manual
- [~] NOVEL-MARKER-ROW — an unrecognised checkbox must read OPEN, not closed
  meta:
    post-deploy-check: NOVELNEEDLE check the thing
- [REJECTED 2026-07-04] REJECTED-ROW-WITH-CHECK — terminal, must NOT read as owed
  meta:
    post-deploy-check: REJECTEDNEEDLE do not republish this forever
This prose line mentions post-deploy-check: in running text and is NOT indented.
"""
    fails = 0
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as fh:
        fh.write(fixture)
        p = fh.name
    try:
        hits = sweep(p)
        names = {r["name"].split(" ")[0] for r in hits}
        opens = {r["name"].split(" ")[0] for r in hits if is_open(r)}
        checks = [
            # The bug this script exists to fix: a closed row must not reach the worklist.
            ("a CLOSED row's check is excluded from the worklist",
             "CLOSED-ROW-WITH-CHECK" not in opens),
            # ...and the control in the other direction, or the arm above is satisfied by
            # returning nothing at all.
            ("an OPEN row's check IS in the worklist",
             "OPEN-ROW-WITH-CHECK" in opens),
            ("the closed row is still FOUND (history is not deleted, only filtered)",
             "CLOSED-ROW-WITH-CHECK" in names),
            ("a row with no field never appears",
             "ROW-WITH-NO-CHECK" not in names),
            # Fail on the failing side: an unknown marker must surface, not vanish.
            ("a NOVEL checkbox marker reads OPEN (surfaces) rather than closed (hides)",
             "NOVEL-MARKER-ROW" in opens),
            # The structural anchor Step 7 always had — prose must never match.
            ("an UNINDENTED prose mention of the field is not a hit",
             not any("running text" in t for r in hits for _, t in r["checks"])),
            # REJECTED is a decided state — terminal for "is action owed here".
            ("a REJECTED row is TERMINAL and does not read as owed",
             "REJECTED-ROW-WITH-CHECK" not in opens),
            ("...and it is still FOUND, like any other closed row",
             "REJECTED-ROW-WITH-CHECK" in names),
        ]
        # ── the EXIT CODE, which is the only thing /push Step 7 reads ──────────
        # Everything above tests what the script KNOWS. These test what it DECIDES.
        import io as _io2, contextlib as _ctx2
        def _rc(argv, path):
            _b = _io2.StringIO()
            with _ctx2.redirect_stdout(_b):
                r = main(argv, todo_path=path)
            return r, _b.getvalue()
        _rc_open, _out_open = _rc([], p)
        _rc_all, _ = _rc(["--all"], p)
        import tempfile as _tf2
        with _tf2.NamedTemporaryFile("w", suffix=".txt", delete=False) as _fh2:
            # Same corpus with EVERY open check closed -> nothing owed.
            # ⚠️ Closing only OPEN-ROW-WITH-CHECK is not enough and the first version did exactly
            # that: NOVEL-MARKER-ROW is `[~]`, which reads OPEN by design (that is arm 5), so it
            # still carried an owed check and rc stayed 3. The arm failed for a CORRECT reason —
            # the fixture was wrong, not the code. Close both.
            _fh2.write(fixture
                       .replace("- [ ] OPEN-ROW-WITH-CHECK", "- [x] OPEN-ROW-WITH-CHECK")
                       .replace("- [~] NOVEL-MARKER-ROW", "- [x] NOVEL-MARKER-ROW"))
            _p2 = _fh2.name
        try:
            _rc_none, _out_none = _rc([], _p2)
        finally:
            os.unlink(_p2)
        checks += [
            ("rc is 3 when an OPEN check is owed (the value /push Step 7 branches on)",
             _rc_open == 3),
            ("rc is 0 when nothing is owed", _rc_none == 0),
            ("rc is 0 for --all, which reports history and is never a worklist", _rc_all == 0),
            # Without this the two rc arms pass on a main() that returns the right number for
            # the wrong reason — e.g. by always reporting zero rows.
            ("the rc-3 run actually NAMED the owed row", "OPEN-ROW-WITH-CHECK" in _out_open),
            ("the rc-0 run reports nothing owed rather than printing an empty worklist",
             "No post-deploy check is owed" in _out_none),
        ]
        for lbl, ok in checks:
            if not ok:
                fails += 1
            print(f"  [{'PASS' if ok else 'FAIL'}] {lbl}")
    finally:
        os.unlink(p)
    print(f"\n{'OK' if fails == 0 else 'FAILED'}: {fails} failure(s)")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv else main(sys.argv[1:]))
