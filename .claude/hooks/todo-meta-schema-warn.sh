#!/usr/bin/env bash
# todo-meta-schema-warn.sh — pre-commit WARN: a `meta:` block in the STAGED todo.txt that the
# defer-trigger scanner cannot read, checked only where this commit added or changed lines.
#
# NEW class: the write-time gap — a todo.txt meta block written in a shape the scanner cannot read.
#   Measured 2026-08-07: 4 seats, 3 mechanisms, one evening, each row LOOKING filed and unable to
#   fire — wrong KEY (`trigger date:` for `trigger:`), flow SHAPE (`meta: {...}`, which
#   meta_fields() can never anchor on, one commit + 3 siblings), prose where a done-when KIND goes
#   (`[unknown kind: the]`). scripts/defer-trigger-scan.py already knows all of this, but it runs
#   at /wrap Step 7h and /orient Step 8, long after the write, so the author never sees it. This
#   moves the same reading to the commit that writes the block.
#
# REUSE, NOT RE-DERIVATION. The python below imports scripts/defer-trigger-scan.py and calls its
# own parse_blocks(), meta_fields(), meta_read_lines(), AUTO_KINDS / NONAUTO_KINDS and
# eval_predicate(). eval_predicate() is reached ONLY on two paths that return before any git, grep
# or exec work — an AUTO kind with empty args (the MALFORMED return) and a kind in neither set (the
# `unknown kind:` return; this call does pass the row's args, but an unknown kind reaches only the
# final return) — so the detail text is the scanner's own
# and nothing is evaluated. Two checks are this hook's own, because the scanner is SILENT on them
# by construction: a `meta:` line carrying content (flow form — meta_fields() skips the block, so
# the scan never sees it) and a key-shaped line inside the block that meta_fields() drops (a
# multi-word key like `trigger date:`). Both still ask the scanner: a line is "dropped" iff
# meta_fields() given that line alone returns nothing for it.
#   It mirrors the scanner's dispositions on purpose: a done-when on a NONAUTO row may be prose
#   (the scanner gates it on `dk in AUTO_KINDS`), and `done-when: manual — <prose>` is the
#   sanctioned escape; an unknown TRIGGER-TYPE is counted as nonauto by the scan and never flagged,
#   so it is not flagged here either (free-text trigger-types like `opportunistic` exist). Both
#   bounds are arms in this hook's unit test, not reasoning.
#
# DIFF-SCOPED, NEVER WHOLE-FILE. todo.txt carries pre-existing unreadable rows and an always-noisy
# gate is a disabled gate. A block is checked iff this commit added a line at one of its meta lines
# (the `meta:` line, the lines meta_fields() reads, a flow-form line, a `trigger-type:` line). A
# TRIAGED line appended under a row, or a title edit, does not wake it. It reads the STAGED blob
# (`git show :todo.txt`) and the staged diff, never the worktree, so a peer's unstaged edit can
# neither fire it nor hide a finding.
#
# WARN-MODE: prints findings, exits 0, never blocks a commit. Escape:
# SKIP_TODO_META_SCHEMA_CHECK=1 (its OWN escape; SKIP_SKILL_LINT does not silence it).
# A missing python3 or an unloadable scanner is a LOUD instrument failure, never a silent pass.
# FIRES LOG: one JSONL row per run that had todo.txt staged — clean included, so a calibration has a
# denominator — to .claude/logs/todo-meta-schema-fires.jsonl via lib/fires-log.sh (honours
# HOOK_FIRES_LOG_DIR). Keys: sid, via, outcome (clean | found | void | skipped), findings, kinds.
#
# CALIBRATION IS NOT THE AUTHOR'S: every seat that produced the founding evidence, and the
# seat that built this, is disqualified from reading its false-positive rate. Route it to a seat
# outside the thread once the fires log has rows. Not done here.
#
# MODES
#   (no args)                      pre-commit: staged todo.txt, staged diff, cwd = repo root.
#   --whole-file <path>            read-only calibration aid: every open block of <path>, no diff
#                                  scope, no fires row. Never wired anywhere.
# Wire-up: .githooks/pre-commit, `bash .claude/hooks/todo-meta-schema-warn.sh || true`.

set -u

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SCANNER="$REPO_ROOT/scripts/defer-trigger-scan.py"
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TMS_OUTCOME=""
TMS_N=""
TMS_KINDS=""
_tms_fire() {
  [ -n "$TMS_OUTCOME" ] || return 0
  ( fires_log() { :; }
    . "$HOOK_DIR/lib/fires-log.sh"
    fires_log todo-meta-schema sid "${CLAUDE_CODE_SESSION_ID:-}" via pre-commit outcome "${TMS_OUTCOME:-}" findings "${TMS_N:-}" kinds "${TMS_KINDS:-}"
  ) >/dev/null 2>&1 || true
}

MODE="staged"
TARGET=""
if [ "${1:-}" = "--whole-file" ]; then
  MODE="whole"
  TARGET="${2:-}"
  [ -f "$TARGET" ] || { echo "todo-meta-schema-warn: --whole-file needs an existing file" >&2; exit 2; }
fi

if [ "$MODE" = "staged" ]; then
  git diff --cached --name-only --diff-filter=ACMR 2>/dev/null | grep -qx 'todo.txt' || exit 0
  trap _tms_fire EXIT
  if [ "${SKIP_TODO_META_SCHEMA_CHECK:-0}" = "1" ]; then
    echo "→ todo meta-schema check SKIPPED (SKIP_TODO_META_SCHEMA_CHECK=1) — staged todo.txt meta blocks NOT checked."
    TMS_OUTCOME="skipped"
    exit 0
  fi
fi

TMS_TMPD="$(mktemp -d "${TMPDIR:-/tmp}/todo-meta-schema.XXXXXX")" || exit 0
TEXT_F="$TMS_TMPD/todo.txt"
ADDED_F="$TMS_TMPD/added"
OUT_F="$TMS_TMPD/out"
: > "$ADDED_F"

if [ "$MODE" = "staged" ]; then
  git show :todo.txt > "$TEXT_F" 2>/dev/null
  # Added line numbers in the NEW file, from the zero-context staged diff: `@@ -a[,b] +c[,d] @@`
  # adds lines c..c+d-1 (d defaults to 1; d=0 is a pure deletion and adds nothing).
  git diff --cached -U0 --no-color --no-ext-diff -- todo.txt 2>/dev/null \
    | sed -n 's/^@@ -[0-9,]* +\([0-9][0-9]*\)\(,\([0-9][0-9]*\)\)\{0,1\} @@.*/\1 \3/p' \
    | while read -r c d; do
        [ -n "$d" ] || d=1
        i=0
        while [ "$i" -lt "$d" ]; do echo $((c + i)); i=$((i + 1)); done
      done > "$ADDED_F"
else
  cp "$TARGET" "$TEXT_F"
fi

set +e
python3 - "$SCANNER" "$TEXT_F" "$ADDED_F" "$MODE" > "$OUT_F" 2>&1 <<'PY'
import sys, re, importlib.util

scanner, text_path, added_path, mode = sys.argv[1:5]
spec = importlib.util.spec_from_file_location("defer_trigger_scan", scanner)
S = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S)
for sym in ("parse_blocks", "meta_fields", "meta_read_lines", "eval_predicate", "AUTO_KINDS", "NONAUTO_KINDS"):
    if not hasattr(S, sym):
        print(f"INSTRUMENT: scanner has no {sym}")
        sys.exit(3)

text = open(text_path, encoding="utf-8").read()
added = None if mode == "whole" else {int(x) for x in open(added_path).read().split()}
PROBE = "  tms-probe: v"

def is_meta_anchor(line):
    # The scanner's own anchor, asked through meta_fields(): a line opens a readable block iff a
    # deeper-indented key after it is read. The probe sits 2 deeper than THIS line: every real
    # `meta:` is indented 2, 4 or 6, and a fixed 2-space probe is not deeper than any of them.
    probe = " " * (len(line) - len(line.lstrip()) + 2) + PROBE.lstrip()
    return S.meta_fields([line, probe]).get("tms-probe") == "v"

def dropped(line):
    # True iff meta_fields() reads nothing from this line placed alone inside a block.
    return not S.meta_fields(["meta:", "  " + line.strip()])

# The keys scan() reads with mf.get(): a dropped line or an inline `meta:` is flagged only when it
# names one of them, so descriptive one-line metadata (`meta: type=bug, surface=S8`) and prose with
# a colon inside a block (`RULE: never ...`) stay silent. Measured over the whole file 2026-11-01
# before this narrowing: 33 inline + 10 dropped lines, most of them descriptive or prose.
SCAN_KEYS = ("trigger-type", "trigger", "done-when", "status")
KEYISH = re.compile(r"^\s*([A-Za-z][A-Za-z0-9_ -]{0,40}):(\s|$)")
FLOW = re.compile(r"^\s*meta:\s*\S")

def names_scan_key(s):
    toks = re.split(r"[^a-z-]+", s.lower().replace("_", "-").replace(" ", "-"))
    flat = "-".join(t for t in toks if t)
    return any(k in flat.split("-") or flat.startswith(k) or ("-" + k) in ("-" + flat) for k in SCAN_KEYS)
TRIG = re.compile(r"^\s*trigger-type:")

def scanner_says(kind, args):
    # Only on eval_predicate's two early returns (MALFORMED; unknown kind) — no git/grep/exec is reached.
    st, stale, detail = S.eval_predicate(kind, args)
    return detail if stale else None

findings = []
for start, bl in S.parse_blocks(text):
    title = re.sub(r"^\s*-\s*\[ \]\s*", "", bl[0]).strip()[:60]
    read = S.meta_read_lines(bl)
    meta_idx = next((i for i, l in enumerate(bl) if is_meta_anchor(l)), None)
    flow = [i for i, l in enumerate(bl) if FLOW.match(l) and not is_meta_anchor(l)
            and names_scan_key(l.split(":", 1)[1])]
    trig = [i for i, l in enumerate(bl) if TRIG.match(l)]
    rel = set(read) | set(flow) | set(trig) | ({meta_idx} if meta_idx is not None else set())
    if added is not None and not any(start + i in added for i in rel):
        continue
    mf = S.meta_fields(bl)
    if mf.get("status", "pending") == "done":
        continue
    out = []
    for i in flow:
        out.append((i, "FLOW-FORM", "`meta:` carries content on its own line; meta_fields() anchors on `meta:` ALONE, so the scan never reads this block — put each key on its own deeper-indented line"))
    for i in trig:
        if i not in read:
            out.append((i, "UNREAD-TRIGGER", "a `trigger-type:` line meta_fields() does not read (no `meta:` above it, the same indent as `meta:`, or a second block) — the scan's outside-meta bucket"))
    for i in sorted(read):
        l = bl[i]
        m = KEYISH.match(l)
        if m and dropped(l) and names_scan_key(m.group(1)):
            key = m.group(1).strip()
            out.append((i, "WRONG-KEY", f"`{key}:` is not a key meta_fields() parses (keys are lowercase-hyphen, e.g. `trigger:`), so the line is silently dropped"))
    tt = mf.get("trigger-type")
    if mf and not tt and meta_idx is not None:
        out.append((meta_idx, "NO-TRIGGER-TYPE", "the block has no `trigger-type:` the scanner reads, so scan() skips the whole row"))
    if tt and tt in S.AUTO_KINDS and not mf.get("trigger", "").strip():
        d = scanner_says(tt, "")
        if d:
            out.append((meta_idx, "MALFORMED", d))
    dw = mf.get("done-when")
    if tt and dw and dw.strip().lower() != "none":
        dk, da = (dw.split(None, 1) + [""])[:2]
        known = dk in S.AUTO_KINDS or dk in S.NONAUTO_KINDS
        dwi = next((i for i in sorted(read) if bl[i].strip().startswith("done-when:")), meta_idx)
        if dk in S.AUTO_KINDS and not da.strip():
            d = scanner_says(dk, "")
            if d:
                out.append((dwi, "MALFORMED", "done-when: " + d))
        elif not known and tt in S.AUTO_KINDS:
            d = scanner_says(dk, da)
            if d:
                out.append((dwi, "UNKNOWN-KIND", f"done-when: {d} — the first word must be a kind; for a human-judged finish write `done-when: manual — <prose>`"))
    for i, kind, msg in out:
        ln = start + (i if i is not None else 0)
        findings.append((ln, kind, title, msg))

for ln, kind, title, msg in findings:
    print(f"FINDING\t{ln}\t{kind}\t{title}\t{msg}")
print(f"COUNT\t{len(findings)}\t{','.join(sorted({f[1] for f in findings}))}")
PY
PY_RC=$?

COUNT_LINE="$(grep '^COUNT	' "$OUT_F" | tail -1)"
if [ "$PY_RC" -ne 0 ] || [ -z "$COUNT_LINE" ]; then
  echo ""
  echo "⛔ todo meta-schema check INSTRUMENT FAILURE (python rc=$PY_RC) — NOTHING was checked:"
  sed 's/^/  /' "$OUT_F" | head -20
  echo "  This is NOT a clean run. WARN-MODE — commit allowed. Escape: SKIP_TODO_META_SCHEMA_CHECK=1"
  echo ""
  TMS_OUTCOME="void"
  rm -rf "$TMS_TMPD"
  exit 0
fi
TMS_N="$(printf '%s\n' "$COUNT_LINE" | cut -f2)"
TMS_KINDS="$(printf '%s\n' "$COUNT_LINE" | cut -f3)"

if [ "${TMS_N:-0}" -gt 0 ]; then
  TMS_OUTCOME="found"
  echo ""
  echo "⚠️  todo meta-schema warn-mode: $TMS_N meta-block problem(s) in lines this commit wrote to todo.txt."
  echo "   Each is a row that LOOKS filed but that defer-trigger-scan.py cannot fire (it reads the same functions):"
  grep '^FINDING	' "$OUT_F" | while IFS="$(printf '\t')" read -r _f ln kind title msg; do
    echo "   todo.txt:$ln  [$kind]  $title"
    echo "      $msg"
  done
  echo "   Schema: scripts/defer-trigger-scan.py header (trigger-type / trigger / done-when, one per line under a bare meta:)."
  echo "   WARN-MODE — commit allowed. Escape: SKIP_TODO_META_SCHEMA_CHECK=1 git commit."
  echo ""
else
  TMS_OUTCOME="clean"
fi
[ "$MODE" = "whole" ] && TMS_OUTCOME=""
rm -rf "$TMS_TMPD"
exit 0
