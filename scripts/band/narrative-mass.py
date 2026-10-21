#!/usr/bin/env python3
"""Upper-bound the incident-narrative bytes in the gated always-loaded plane.

A sentence is flagged NARRATIVE when it carries a date, a 'measured'/'hub-caught'/'retracted'
marker, a sha, an N= count, or a 'read X until <date>' retraction shape. Flagged bytes are an
UPPER BOUND on displaceable mass: a directive can carry a date too. The hand-read sample decides
the real yield. Output: per-file total / flagged / share, and the top flagged units.
"""
import re, sys, os, glob

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."
files = ["CLAUDE.md", "AGENTS.md"] + sorted(glob.glob(os.path.join(ROOT, ".claude/rules/*.md")))
files = [f if os.path.isabs(f) or f.startswith(ROOT) else os.path.join(ROOT, f) for f in files]

NARR = re.compile(
    r"(2026-\d\d(?:-\d\d)?|\bmeasured\b|\bMeasured\b|\bMEASURED\b|hub-(?:caught|measured|verdict|refuted|proposed|adjudicated)|owner-caught|"
    r"\bretract|\brefuted\b|\bREFUTED\b|\buntil 20\d\d|\bread \"|\bread \*|\bshipped\b|\bstood here\b|\bN=\d|\bcheckpoint-4\b|"
    r"\b[0-9a-f]{7,9}\b(?![-\w])|\bArchive\b\.?|\barchive\b[.:;)]|\bincident record|\bthis (?:row|line|clause|sentence|bullet|paragraph|entry|section|file) (?:read|said|claimed|shipped|stood|carried|named|had)\b|"
    r"\bseat(?:s)?\b(?! id)|\bone seat\b|\btwo seats\b|\bthree seats\b|\bfour seats\b|\bfive seats\b|\bsix seats\b)"
)
# sentence split: end punctuation followed by space and an opener
SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z⛔⚠✅⭐\*`\(\[\"“\d])")

def units(text):
    # a unit = a paragraph / bullet / table row (blank-line or line separated for bullets/rows)
    out, buf = [], []
    for line in text.split("\n"):
        if line.strip() == "" or line.startswith("- ") or line.startswith("|") or line.startswith("#") or line.startswith("  - ") or line.startswith("**"):
            if buf:
                out.append("\n".join(buf)); buf = []
        if line.strip():
            buf.append(line)
    if buf: out.append("\n".join(buf))
    return out

grand_total = grand_flag = 0
rows = []
top_units = []
for f in files:
    if not os.path.exists(f): continue
    t = open(f, encoding="utf-8").read()
    total = len(t.encode()); flag = 0
    for u in units(t):
        uf = 0
        for s in SPLIT.split(u):
            if NARR.search(s):
                uf += len(s.encode())
        flag += uf
        if uf > 600:
            top_units.append((uf, len(u.encode()), os.path.relpath(f, ROOT), u[:110].replace("\n", " ")))
    rows.append((total, flag, os.path.relpath(f, ROOT)))
    grand_total += total; grand_flag += flag

if not grand_total:
    sys.exit(f"narrative-mass: nothing to measure under {ROOT}: CLAUDE.md, AGENTS.md and .claude/rules/*.md are absent or empty")
rows.sort(reverse=True)
print(f"{'total':>8} {'flagged':>8} {'share':>6}  file")
for total, flag, name in rows:
    print(f"{total:>8} {flag:>8} {100*flag/max(total, 1):>5.1f}%  {name}")
print(f"{grand_total:>8} {grand_flag:>8} {100*grand_flag/grand_total:>5.1f}%  GATED PLANE (upper bound on narrative)")
print()
print("top flagged units (flagged B / unit B / file / head):")
for uf, ub, name, head in sorted(top_units, reverse=True)[:40]:
    print(f"  {uf:>5} / {ub:>5}  {name}  {head}")
