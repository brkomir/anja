#!/usr/bin/env bash
# write-scope-inject.sh — PreToolUse(Edit|Write|MultiEdit).
#
# ⛔ WHAT GAP THIS CLOSES, AND WHY IT IS THE *ONLY* ONE LEFT ON THIS AXIS. `.claude/rules/*.md`
# files carry a `paths:` glob and the harness delivers them when you READ a matching file. The
# remaining first-touch gap is CREATION-only — a glob cannot fire on a file being written fresh —
# and it is not fixable by scoping: there is no read to hang the delivery on. So a seat writing a
# BRAND-NEW unit test receives none of the 80 KB of unit-test doctrine, while a seat editing an
# existing one receives all of it.
#
# ⭐ THE MECHANISM IS THE SHELL-TRAP INJECTOR'S, ONE MOMENT OVER. That one keys on the COMMAND about
# to run; this keys on the PATH about to be created. Same contract: read the payload, match, emit ONE
# JSON document, exit 0 on every path.
#
# ⛔ CREATION ONLY, DELIBERATELY. An Edit requires a prior Read by tool contract, and that Read is
# what fires the glob — so injecting on an edit would duplicate what the harness already delivered,
# on the commonest tool call in the fleet. Existence is the discriminator and it is one stat().
#
# ⛔ IT SHIPS POINTERS, NOT RULE TEXT. Copying doctrine here would create a second copy of a corpus
# that is corrected constantly, and a stale copy of a safety rule is worse than no copy. The
# authoritative file is named; the model reads it. Payload is a few hundred bytes.
#
# ⛔ rc=2 IS THE PreToolUse BLOCK CODE. Every path here must exit 0 — including a bash PARSE error,
# which is why this file carries no heredoc inside `$( )` (bash here is 3.2.57 and mis-parses that;
# measured 2026-09-21, it denied Bash fleet-wide for ~1 minute).
#
# Escape: SKIP_WRITE_SCOPE_INJECT=1
set -u

if [ "${1:-}" = "--self-test" ]; then
  # ⛔ ABSOLUTE, because two arms below `cd` away from the repo. With the bare `BASH_SOURCE[0]`
  # spelling (relative whenever the script is invoked by a relative path) those arms could not
  # find the script at all: no output, the needle missing, and the arm reds for a reason that has
  # nothing to do with the thing under test. The runner never started — a VOID reading wearing a
  # RED's clothes, which is the one shape that reads as a real finding.
  SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/$(basename "${BASH_SOURCE[0]}")"; fail=0
  arm() { # arm <label> <stdin> <expect-empty|needle> [needle]
    local label="$1" in="$2" mode="$3" needle="${4:-}"
    local out rc ok=1
    out="$(printf '%s' "$in" | bash "$SELF" 2>/dev/null)"; rc=$?
    [ "$rc" = 0 ] || ok=0
    if [ "$mode" = "expect-empty" ]; then
      [ -z "$out" ] || ok=0
    else
      printf '%s' "$out" | python3 -c 'import sys,json; json.load(sys.stdin)' 2>/dev/null || ok=0
      printf '%s' "$out" | grep -qF "$needle" || ok=0
    fi
    [ "$ok" = 1 ] && echo "  [PASS] $label" || { echo "  [FAIL] $label (rc=$rc)"; fail=$((fail+1)); }
  }
  R="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
  arm "NEW unit test -> names the unit-test rules" \
      "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$R/tests/unit/brand-new-xyz.test.ts\"}}" needle "tests-unit.md"
  arm "NEW db service file -> names the supabase rules" \
      "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$R/src/db/brand-new-xyz.ts\"}}" needle "supabase.md"
  # ⛔ THE EXISTENCE ARM IS THE LOAD-BEARING ONE: without it this fires on every edit in the fleet.
  # ⚠️ THE FIXTURE MUST BE A FILE THAT *MATCHES A SCOPED GLOB*, OR THE ARM IS VACUOUS. It first used
  # `CLAUDE.md`, which matches no `paths:` glob at all — so it passed under a mutation that disabled
  # the existence check entirely, because the matcher dropped it one step later for an unrelated
  # reason. Caught by mutating, not by reading. `src/db/schema.ts` exists AND matches `src/db/**`,
  # so silence here can ONLY come from the existence check.
  arm "EXISTING file that DOES match a glob -> silent (its Read already fired the glob)" \
      "{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$R/src/db/schema.ts\"}}" expect-empty
  arm "path matching no scoped rule -> silent" \
      "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$R/plans/brand-new-xyz.md\"}}" expect-empty
  # ⛔ CWD-INDEPENDENCE. Both arms use a RELATIVE path and run from a directory that
  # is NOT the repo root, so a CWD-relative resolution would give the wrong answer on each:
  # the existing file would look new (fires on an edit), and the new one would resolve outside the
  # repo and go silent. Run from elsewhere, they must still read exactly as the absolute forms do.
  # ⛔ FROM A REPO *SUBDIRECTORY*, NEVER FROM `/`.
  # From `/` a CWD-relative resolution lands OUTSIDE the repo, and on the EXISTING-file arm the unfixed
  # hook then goes silent — the same bytes the fix emits — so that arm coincided with the defect it
  # exists to catch (measured from `/`: PRE 0 B / POST 0 B; from a subdirectory: PRE 587 B / POST 0 B;
  # positive control 584 B on a genuine creation). The NEW-file arm did discriminate from `/` (PRE 0 B,
  # POST the supabase.md pointer), so it moves for symmetry, not repair. Only a subdirectory makes the
  # unfixed hook mis-resolve INSIDE the repo on both: the existing file reads as a creation and fires,
  # and the new file resolves under the wrong prefix and loses its supabase.md match. Measured 2026-09-22
  # by splicing these arms onto the pre-fix body: both RED there, both GREEN at the fix, from anywhere.
  relout="$(cd "$R/src" && printf '%s' '{"tool_name":"Edit","tool_input":{"file_path":"src/db/schema.ts"}}' \
      | CLAUDE_PROJECT_DIR="$R" bash "$SELF" 2>/dev/null)"
  if [ -z "$relout" ]; then
    echo "  [PASS] RELATIVE path to an EXISTING scoped file, from a repo subdirectory -> still silent"
  else
    echo "  [FAIL] RELATIVE existing-file path fired from a foreign cwd (read as a creation)"; fail=$((fail+1))
  fi
  relnew="$(cd "$R/src" && printf '%s' '{"tool_name":"Write","tool_input":{"file_path":"src/db/brand-new-xyz.ts"}}' \
      | CLAUDE_PROJECT_DIR="$R" bash "$SELF" 2>/dev/null)"
  if printf '%s' "$relnew" | grep -qF 'supabase.md'; then
    echo "  [PASS] RELATIVE path to a NEW scoped file, from a repo subdirectory -> still names the rules"
  else
    echo "  [FAIL] RELATIVE new-file path is CWD-dependent ($(printf '%s' "$relnew" | wc -c) B)"; fail=$((fail+1))
  fi
  arm "malformed payload -> rc 0, NEVER 2" 'not json' expect-empty
  arm "no file_path -> silent, rc 0" '{"tool_input":{}}' expect-empty
  # ⛔ SELECTIVITY BY ABSENCE. A presence needle is satisfied under a matcher that injects
  # everything (the TWELFTH vacuous-control way); this arm must read the OTHER way and does.
  o="$(printf '%s' "{\"tool_input\":{\"file_path\":\"$R/src/db/brand-new-xyz.ts\"}}" | bash "$SELF" 2>/dev/null)"
  if printf '%s' "$o" | grep -qF 'tests-unit.md'; then
    echo "  [FAIL] negative control: the unit-test rules leaked into a src/db creation"; fail=$((fail+1))
  else
    echo "  [PASS] negative control: the unit-test rules are ABSENT from a src/db creation"
  fi
  [ "$fail" = 0 ] && { echo "OK: self-test clean"; exit 0; } || { echo "FAILED: $fail"; exit 1; }
fi

[ "${SKIP_WRITE_SCOPE_INJECT:-0}" = "1" ] && exit 0

INPUT="$(cat)" || exit 0
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
[ -d "$ROOT/.claude/rules" ] || exit 0

STI_INPUT="$INPUT" python3 - "$ROOT" <<'PY' || exit 0
import json, os, re, sys, glob

try:
    root = sys.argv[1]
    payload = json.loads(os.environ.get("STI_INPUT") or "{}")
    ti = payload.get("tool_input") or {}
    fp = ti.get("file_path")
    if not isinstance(fp, str) or not fp.strip():
        sys.exit(0)

    # ⛔ ANCHOR A RELATIVE PATH TO THE REPO ROOT, NEVER TO CWD.
    # A hook's working directory is NOT guaranteed, and a sub-agent's differs again. Left alone,
    # BOTH checks below silently become CWD-dependent: `os.path.exists` on a relative path would
    # answer "does this exist relative to wherever the hook happens to be", so an EXISTING file
    # read from the wrong CWD looks NEW and the injection fires on an ordinary EDIT — exactly the
    # failure the creation predicate exists to prevent. The Write/Edit tool contract requires an
    # absolute path, so this branch is defensive rather than routine; anchoring to root makes the
    # answer deterministic either way, which a CWD-relative reading can never be.
    if not os.path.isabs(fp):
        fp = os.path.join(root, fp)

    # CREATION ONLY. An existing path means a Read already fired the glob.
    if os.path.exists(fp):
        sys.exit(0)

    rel = os.path.relpath(fp, root)
    if rel.startswith(".."):          # outside the repo — not ours to advise on
        sys.exit(0)
    rel = rel.replace(os.sep, "/")

    def to_re(g):
        out, i = [], 0
        while i < len(g):
            if g.startswith("**/", i):
                out.append("(?:.*/)?"); i += 3
            elif g.startswith("**", i):
                out.append(".*"); i += 2
            elif g[i] == "*":
                out.append("[^/]*"); i += 1
            elif g[i] == "?":
                out.append("[^/]"); i += 1
            else:
                out.append(re.escape(g[i])); i += 1
        return re.compile("^" + "".join(out) + "$")

    hits = []
    for path in sorted(glob.glob(os.path.join(root, ".claude", "rules", "*.md"))):
        try:
            with open(path, encoding="utf-8") as fh:
                head = fh.read(4000)
        except Exception:
            continue
        m = re.search(r'^paths:\s*\[(.*?)\]\s*$', head, re.M | re.S)
        if not m:
            continue
        globs = re.findall(r'"([^"]+)"', m.group(1))
        if any(to_re(g).match(rel) for g in globs):
            # The file's own first `# ` heading is its self-description — never a restated one.
            h = re.search(r'^#\s+(.+)$', head, re.M)
            hits.append((os.path.basename(path), (h.group(1).strip() if h else "")[:70]))

    if not hits:
        sys.exit(0)

    lines = ["You are CREATING a file that a path-scoped rules file governs. Its glob CANNOT have "
             "fired yet — nothing has been read — so this doctrine is NOT in your context:"]
    # ⛔ CAP = 7, NOT 4: the sibling injector's cap rule — find the largest observed count and set
    # the cap two above it — binds here too. MEASURED over all 9,817 tracked paths as creation
    # proxies: the most scoped rules any one path matches is 5 (103 paths do), so 4 SILENTLY DROPPED ONE for every one of them — and the dropped name was routinely
    # `typescript.md`, whose globs are the widest. 5 + 2 = 7, which cannot truncate today and leaves
    # headroom for two more scoped files. Distribution over 16 scoped rules files: 0 rules 6,190
    # paths · 1 → 173 · 2 → 298 · 3 → 528 · 4 → 2,525 · 5 → 103.
    # ⚠ THE DENOMINATOR READ 7,817 UNTIL 2026-09-21 AND MY OWN BUCKETS REFUTED IT: they sum to
    # 9,817, which is what `git ls-files | wc -l` returns. The distribution was right and the
    # sentence above it was wrong — a bucket breakdown is a denominator claim whose only check is
    # addition, and nobody adds. Caught in review.
    # ⚠ That same finding also said the true max is 6, not 5, leaving "headroom for two more" at
    # one. NOT REPRODUCED at HEAD: re-derived with this hook's OWN `to_re` over `git ls-files`,
    # the max is 5 and the distribution is byte-identical to the row above. Re-derive before
    # trusting either reading — `to_re` is the matcher, and a re-implementation is a different
    # function from the one that ships.
    for name, desc in hits[:7]:
        lines.append("   · .claude/rules/%s%s" % (name, (" — " + desc) if desc else ""))
    lines.append("READ the file(s) above BEFORE writing this one. This is a POINTER, not the rules: "
                 "the corpus is corrected constantly and a copy here would go stale.")
    ctx = "\n".join(lines)

    # ⛔ FIRES LEDGER — wired 2026-09-21 on a review finding. Every other warn-mode guard here
    # logs its fires and this one did not, which matters for a specific reason: this hook is warn-mode
    # by design and THE LEDGER IS THE ONLY THING THAT COULD EVER EARN IT A PROMOTION, or retire it.
    # The corpus's own rule is warn-before-block with a measured FP rate, and an FP rate needs records.
    # ⚠️ WHAT TO READ IT FOR, because the useful question is not "how often did it fire": it is
    # whether the rules it NAMED were the ones the author needed. `named` vs `matched` also records
    # whether the 7-cap ever truncates — it cannot today (measured max 5), so a nonzero `dropped`
    # means a new scoped rules file landed and the cap needs re-deriving.
    # Best-effort and swallowed: a logging failure must never change what the hook emits, and rc=2
    # here is the PreToolUse BLOCK code.
    try:
        import time
        rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "sid": (os.environ.get("CLAUDE_CODE_SESSION_ID") or "")[:8],
               "rel": rel, "matched": len(hits), "named": len(hits[:7]),
               "dropped": max(0, len(hits) - 7),
               "rules": [n for n, _ in hits[:7]]}
        logdir = os.path.join(root, ".claude", "logs")
        os.makedirs(logdir, exist_ok=True)
        with open(os.path.join(logdir, "write-scope-inject-fires.jsonl"), "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec) + "\n")
    except Exception:
        pass

    json.dump({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": ctx}}, sys.stdout)
except Exception:
    sys.exit(0)
PY
exit 0
