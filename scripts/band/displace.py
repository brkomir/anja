#!/usr/bin/env python3
"""One displacement move: copy ORIGINAL verbatim into the archive under a dated heading, then
replace ORIGINAL with REPLACEMENT in the live rules file. Every step checks before it writes.

usage: displace.py <spec.py>
  spec.py defines: RULES, ARCHIVE, MOVES = [(label, original, replacement), ...]
  original must occur EXACTLY ONCE in RULES, newline-bounded on both ends (the whole unit).

WRITE ORDER IS LOAD-BEARING AND IS NOT ARBITRARY (a review verdict's serious finding, 2026-09-07).
The archive is written FIRST and both writes are atomic (temp + os.replace). Rules-first,
non-atomically, meant any failure between the two writes deleted the displaced directive from
BOTH files; `git show HEAD:<file>` is the only recovery and this tool runs precisely when a
rules file is mid-edit and uncommitted, so there is often nothing to recover. Archive-first
fails toward DUPLICATION instead, which README.md's own note says loses no anchors.

CHECKS RAISE, THEY DO NOT `assert` (same verdict, a minor finding). `python3 -O` strips every `assert`, and
the entire safety model of a tool that writes `.claude/rules/*.md` cannot live in statements a
flag removes. It is also invisible to `block-subagent-always-loaded-write.sh`, which keys on
`tool_input.file_path` and so cannot see a band path passed to a Bash-invoked script.
"""
import sys, io, os, runpy, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blockcheck import check as _paritycheck

def fail(msg):
    raise SystemExit(f"displace: REFUSED — {msg}")

def write_atomic(path, text):
    """Write via a sibling temp file + os.replace, so a failure mid-write cannot truncate the
    target. os.replace is atomic within a filesystem, and the temp file is a sibling to keep it
    on the same one."""
    tmp = f"{path}.displace-tmp.{os.getpid()}"
    try:
        with io.open(tmp, "w", encoding="utf-8") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise

spec = runpy.run_path(sys.argv[1])
RULES, ARCHIVE, MOVES = spec["RULES"], spec["ARCHIVE"], spec["MOVES"]
SID = os.environ.get("BAND_SID") or "unknown-session"
# UTC, not date.today(): the repo stamps provenance in UTC and a local date is wrong for part of
# every day (same verdict, a minor finding).
DATE = os.environ.get("BAND_DATE") or datetime.datetime.now(datetime.timezone.utc).date().isoformat()

rules = io.open(RULES, encoding="utf-8").read()
arch = io.open(ARCHIVE, encoding="utf-8").read()
if not (ARCHIVE.replace(".claude/docs/rules-ARCHIVE/", "") in rules or ARCHIVE in rules):
    fail(f"{RULES} carries no pointer to {ARCHIVE} — the guard would read every moved anchor as LOST")

before_rules = len(rules.encode())
before_arch = len(arch.encode())
# a unit STARTS with one of these; used on both sides of the original so the check is not
# one-sided. `**` is included to agree with narrative-mass.py's own unit split (same verdict, a minor finding).
UNIT_START = ("- ", "|", "#", "  - ", "* ", "> ", "```", "**")
appends = []
for label, orig, repl in MOVES:
    key = "\n" + orig + "\n"
    n = rules.count(key)
    if n != 1:
        fail(f"[{label}] original occurs {n}x newline-bounded in {RULES} (need exactly 1)")
    if repl in rules:
        fail(f"[{label}] replacement already present in {RULES}")
    if orig in arch:
        fail(f"[{label}] original already present in {ARCHIVE}")
    # the original must be a WHOLE unit: what sits on EITHER side of it is a blank line or a new
    # unit start, never a soft-wrapped continuation of the same paragraph. Checking only the
    # following line let a unit that continues a preceding paragraph through (same verdict, a minor finding).
    _i = rules.index(key)
    _after = rules[_i + len(key):]
    _nxt = _after.split("\n", 1)[0]
    if not (_nxt == "" or _nxt.startswith(UNIT_START)):
        fail(f"[{label}] original is FOLLOWED by a continuation line — the unit is soft-wrapped; "
             f"pass the WHOLE paragraph: {_nxt[:80]!r}")
    _before = rules[:_i]
    _prv = _before.rsplit("\n", 1)[-1] if "\n" in _before else _before
    if not (_prv.strip() == "" or orig.startswith(UNIT_START)):
        fail(f"[{label}] original is PRECEDED by {_prv[:60]!r} and does not itself start a unit — "
             f"it is a continuation; pass the WHOLE paragraph")
    _lost = _paritycheck(rules, orig, repl)
    if _lost:
        fail(f"[{label}] replacement shifts the guard's anchor pairing for {len(_lost)} span(s) on "
             f"UNTOUCHED lines of the same block: {_lost[:2]}")
    rules = rules.replace(key, "\n" + repl + "\n", 1)
    appends.append(
        f"\n## {DATE} band displacement (session {SID}) — {label}\n\n"
        f"Displaced VERBATIM from `{RULES}`; the live rule keeps the directive, the tell, the "
        f"discriminating number and a pointer here. Not doctrine — where this disagrees with the live "
        f"file, the live file wins. Original text:\n\n{orig}\n"
    )
    print(f"  moved [{label}]: {len(orig.encode())} -> {len(repl.encode())} B  (yield {len(orig.encode())-len(repl.encode())})")

if not arch.endswith("\n"):
    arch += "\n"
arch += "".join(appends)

# pre-write checks on the computed content: every replacement present exactly once, every
# original absent (newline-bounded — a replacement may legitimately START with the original's
# first words). These check MEMORY; the post-write block below checks DISK.
for label, orig, repl in MOVES:
    if rules.count("\n" + repl + "\n") != 1:
        fail(f"[{label}] replacement count != 1 in computed content")
    if ("\n" + orig + "\n") in rules:
        fail(f"[{label}] original still present in computed content")

# ARCHIVE FIRST. See the module docstring: this order is the fix for that serious finding, not a style choice.
write_atomic(ARCHIVE, arch)
write_atomic(RULES, rules)

# post-write verification reads DISK, and every branch below EXITS rather than printing.
disk_rules = io.open(RULES, encoding="utf-8").read()
disk_arch = io.open(ARCHIVE, encoding="utf-8").read()
after_rules = len(disk_rules.encode())
after_arch = len(disk_arch.encode())
print(f"{RULES}: {before_rules} -> {after_rules} B  ({after_rules-before_rules:+d})")
print(f"{ARCHIVE}: {before_arch} -> {after_arch} B  ({after_arch-before_arch:+d})")

for label, orig, repl in MOVES:
    if disk_rules.count("\n" + repl + "\n") != 1:
        fail(f"[{label}] POST-WRITE: replacement not present exactly once ON DISK in {RULES}")
    if ("\n" + orig + "\n") in disk_rules:
        fail(f"[{label}] POST-WRITE: original still on disk in {RULES}")
    if orig not in disk_arch:
        fail(f"[{label}] POST-WRITE: original absent from {ARCHIVE} on disk — the displaced text "
             f"exists in NEITHER file; restore from `git show HEAD:{RULES}` before doing anything else")

# README.md calls a non-negative delta on the SOURCE file the only tell for the corruption case:
# duplicated text loses no anchors, so the guard reads a half-written file as fully preserved.
# It is a GATE here, not a print (same verdict, a moderate finding: a check that observes does not gate).
if after_rules >= before_rules:
    fail(f"{RULES} did not shrink ({before_rules} -> {after_rules} B). A displacement always "
         f"shrinks its source; a non-negative delta is the corruption tell the guard cannot see. "
         f"The archive write already landed, so the text is NOT lost — inspect {RULES} by hand.")

print("LANDED: verified against the bytes on disk — every replacement present once in the live "
      "file, every original gone from it and present in the archive, source file shrank")
