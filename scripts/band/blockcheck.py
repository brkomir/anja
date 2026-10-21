#!/usr/bin/env python3
"""Block-scoped parity pre-check for `scripts/band-directive-preservation.mjs`.

`check(base_text, old_line, new_line)` returns the anchors the guard would STOP extracting from
UNTOUCHED lines of the same block after your swap. Those are phantoms — the guard will report
them as lost anchors on lines you never edited — so a move that produces any must not ship.

ALL THREE OF THE GUARD'S CHANNELS ARE COVERED.
The guard extracts code spans, bold spans and lesson ids; this file checked bold alone, so a
reflow that re-paired BACKTICKS passed clean. The code-channel gap was reported as 0 misses over
274 realistic moves from the real corpus — a contract gap rather than an operational failure — but
⚠️ THAT NUMBER IS THIRD-HAND AND NOBODY IN THE CHAIN RE-RAN IT: one reviewer measured it, a
second read the first, and this file's author read the second, who said plainly that they had
not executed it. Treat it as a reported figure, not as a measurement this repo holds. It
changes nothing here either way, because the channel set belongs to the guard and is not ours to
sample down to the incidence we happen to observe.

Run `python3 blockcheck.py --self-test` for the RED control arms.
"""
import re

# the guard's own three channels, verbatim from band-directive-preservation.mjs:247-249
CHANNELS = {
    "code":    re.compile(r"`([^`\n]+)`"),
    "bold":    re.compile(r"\*\*([^*\n]+)\*\*"),
    "lessons": re.compile(r"\bL\d{1,4}\b"),
}

def soft(block): return re.sub(r"\s*\n[ \t]*(?:>[ \t]*)*", " ", block)
def norm(s):     return re.sub(r"\s+", " ", s.strip())

def block_of(text, line):
    """The blank-line-delimited block containing `line`. A block that starts at the top of the
    file has no preceding blank line: rfind returns -1 and the old `+2` made the block start at
    index 1, silently dropping the first character."""
    i = text.index("\n" + line + "\n")
    r = text.rfind("\n\n", 0, i)
    s = 0 if r < 0 else r + 2
    e = text.find("\n\n", i)
    return text[s:e] if e >= 0 else text[s:]

def _spans(joined, rx):
    """(normalised text, start, end) per match. Group 1 where the channel has one, else group 0 —
    the lessons channel matches a bare token and captures nothing."""
    out = []
    for m in rx.finditer(joined):
        out.append((norm(m.group(1) if m.re.groups else m.group(0)), m.start(), m.end()))
    return out

def check(base_text, old_line, new_line):
    """Every anchor the guard would extract from the block at BASE must still be extracted from
    the block AFTER the swap, except anchors lying ENTIRELY inside the swapped line (those are
    credited from the archive copy). An anchor that crosses from the swapped line into a
    neighbour is NOT inside it. Returns a list of (channel, anchor) pairs."""
    blk = block_of(base_text, old_line)
    j_old = soft(blk)
    jl = soft(old_line)
    a = j_old.index(jl)
    b = a + len(jl)
    j_new = soft(blk.replace(old_line, new_line))
    lost = []
    for name, rx in CHANNELS.items():
        new_sp = set(s for s, _, _ in _spans(j_new, rx))
        for s, st, en in _spans(j_old, rx):
            if not (st >= a and en <= b) and s not in new_sp:
                lost.append((name, s))
    return lost

# ---------------------------------------------------------------------------------------------
def _dangling_line_scoped(line):
    """The RETIRED line-scoped check, kept ONLY as the RED arm's stand-in. This was `parity.py`,
    a standalone 100755 file whose docstring described what it did and never said it was wrong;
    the rule applied to it is that an artifact which does not carry its own refutation is worse
    than either keeping or deleting it, so it lives here, inside the test that demonstrates it
    failing. It compares unconsumed `**` parity within ONE line and cannot see across a
    soft-joined block, which is the whole defect."""
    RE = CHANNELS["bold"]
    last = 0
    for m in RE.finditer(line):
        last = m.end()
    return line[last:].count("**") % 2

def _self_test():
    cases = []
    # ARM 1 — the founding failure: line-scoped says OK, block-scoped correctly flags a loss.
    base = ("intro paragraph\n\n"
            "- **A *B* C** and the rest\n"
            "- untouched **KEEP ME** here\n\n"
            "trailer paragraph\n")
    old = "- **A *B* C** and the rest"
    new = "- **A B C** and the rest"
    lost = check(base, old, new)
    line_scoped_agrees = _dangling_line_scoped(old) == _dangling_line_scoped(new)
    cases.append(("bold reflow: block-scoped flags a loss", bool(lost), True, lost))
    cases.append(("bold reflow: line-scoped says OK (why parity.py was retired)",
                  line_scoped_agrees, True, None))
    # ARM 2 — CODE channel, the one this file did not cover before.
    cbase = ("intro\n\n"
             "- see `foo` and ``bar`` here\n"
             "- untouched `KEEP_CODE` line\n\n"
             "trailer\n")
    cold = "- see `foo` and ``bar`` here"
    cnew = "- see `foo` and `bar` here"
    clost = check(cbase, cold, cnew)
    cases.append(("code channel: a backtick reflow is detected",
                  any(ch == "code" for ch, _ in clost), True, clost))
    # ARM 3 — LESSONS channel: an id inside the swapped line itself is not reported as lost
    # (a neighbour's id cannot be lost here: soft() always joins lines with a space).
    lbase = ("intro\n\n"
             "- first line cites L9001\n"
             "- second line cites L9002\n\n"
             "trailer\n")
    lold = "- first line cites L9001"
    lnew = "- first line trimmed"
    llost = check(lbase, lold, lnew)
    cases.append(("lessons channel: an id INSIDE the swapped line is NOT a loss",
                  all(s != "L9001" for _, s in llost), True, llost))
    # ARM 4 — CONTROL, must be GREEN: an ordinary reword that keeps every neighbour anchor.
    gbase = ("intro\n\n"
             "- **DIRECTIVE** with a long tail that says a great deal\n"
             "- untouched **NEIGHBOUR** and `code` and L9003\n\n"
             "trailer\n")
    gold = "- **DIRECTIVE** with a long tail that says a great deal"
    gnew = "- **DIRECTIVE** trimmed"
    glost = check(gbase, gold, gnew)
    cases.append(("control: a clean reword loses nothing", glost == [], True, glost))
    # ARM 5 — block_of at the very top of the file (no preceding blank line).
    tbase = "- top line **X** here\n- neighbour **Y**\n\ntrailer\n"
    try:
        top_ok = block_of(tbase, "- neighbour **Y**").startswith("- top line")
    except ValueError:
        top_ok = False
    cases.append(("block_of: a top-of-file block keeps its first character", top_ok, True, None))

    bad = 0
    for name, got, want, detail in cases:
        ok = got == want
        bad += 0 if ok else 1
        print(f"  {'PASS' if ok else 'FAIL'}  {name}" + ("" if ok else f"   got={got!r} detail={detail!r}"))
    print(f"blockcheck --self-test: {len(cases)-bad}/{len(cases)} PASS")
    return 1 if bad else 0

if __name__ == "__main__":
    import sys
    if "--self-test" in sys.argv:
        raise SystemExit(_self_test())
    raise SystemExit("blockcheck: a library. Run --self-test, or import check(base, old, new).")
