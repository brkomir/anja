#!/usr/bin/env python3
"""Recalibrate the agent-dispatch memory guard. OWNER-RUN, one line, idempotent.

    python3 scripts/memguard-recalibrate.py --check    # preview, writes nothing
    python3 scripts/memguard-recalibrate.py            # apply
    python3 scripts/memguard-recalibrate.py --owner-ruled='<his words>'   # apply past the headroom refusal (single quotes: the shell must not expand his words)
    python3 scripts/memguard-recalibrate.py --self-test  # fixture regression, reads/writes nothing

WHY (investigated 2026-09-19):

  1. The guard gates on swap + compressor. Those are different resources - swap is
     disk, the compressor is RAM - and their sum has read 51.5 GB on a 36 GB machine.
     No measure of RAM scarcity can exceed the RAM.
  2. Its denial text quoted p50 ~9.0 / p95 ~17.2 / max ~20.7 over 611 samples and
     said it was crash-class-only (both removed 2026-10-26, at the hook's 24, with
     this script's OLD re-anchored). Those figures match the COMPRESSOR ALONE (its
     all-time max is exactly 20.7), so the calibration was measured on one term and
     applied to the sum.
  3. The 115 GB incidents the text blames on agent fan-out were traced 2026-08-01
     to runaway ugrep (single processes at 19.78 / 21.71 / 57.66 GB). A guard for
     that shipped and fires daily; the deep-pass agent ceiling was RAISED 3->10 the
     same day because agent count was never the control.

  The live distribution is RE-DERIVED ON EVERY RUN and printed before anything is
  written - see step 0. A baked figure rots fast here: the observed max moved from
  27.3 to 28.9 inside two hours on 2026-09-19, pushed by one session's own lens
  fan-out, so any max in prose is a FLOOR and never a bound.

⛔ REVIEW HISTORY - this script shipped BROKEN on 2026-09-19 and a fresh-context
review caught it before any run. Both defects were fail-OPEN on a fleet-wide guard:

  (a) The replacement text carried backticks around a command name. The hook's deny
      block is `cat <<EOF` - UNQUOTED - so those were command substitution, not
      markdown. One line of output silently rewrote the deny text; two lines made the
      JSON invalid, and the harness discards a hook's stdout wholesale unless it is
      exactly one JSON document. The guard would have stopped denying, with no error,
      at exactly the moment the machine was over threshold.
      GUARD NOW: assert_heredoc_safe() below refuses any replacement carrying a
      backtick, dollar, double quote or backslash, and step 3 renders the patched
      deny arm and parses it as JSON. Both run BEFORE anything is written.
  (b) settings.json was written BEFORE the hook anchor was validated, and the
      anchor failure then printed "NOTHING WRITTEN" - false in exactly the case it
      printed in, leaving the threshold raised and the stale text in place.
      FIXED: this script is now two-phase. Nothing is written until every check
      on BOTH files has passed.

UNDO: git checkout -- .claude/settings.json .claude/hooks/agent-dispatch-memory-guard.sh

HEADROOM OVERRIDE (2026-10-26): the headroom check dies when the observed max exceeds
THRESHOLD, because a number picked without that figure in front of the owner would
still deny real work. Once the owner has re-decided WITH the figure,
`--owner-ruled='<his words>'` turns that
die into a printed warning and, on apply, records his words beside the figures in
.claude/logs/memguard-recalibrate-overrides.jsonl. It overrides the HEADROOM check
only: the data, numeric, anchor, dirty-tree and read-back checks still refuse.

NOTE: the threshold is read at SESSION LAUNCH. Existing sessions keep using 24
until restarted. A shell `export` does NOT reach this hook - the settings `env`
block is the only channel that does.
"""
import json
import math
import os
import re
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

THRESHOLD = "30"
ROOT = Path(__file__).resolve().parent.parent
SETTINGS = ROOT / ".claude/settings.json"
HOOK = ROOT / ".claude/hooks/agent-dispatch-memory-guard.sh"
LOG = ROOT / ".claude/logs/agent-dispatch-memory.jsonl"
ENV_KEY = "FF_AGENT_MEMGUARD_THRESHOLD_GB"
OVERRIDE_LOG = ROOT / ".claude/logs/memguard-recalibrate-overrides.jsonl"
OWNER_FLAG = "--owner-ruled="
SINCE = "2026-09-01"

# Exact anchor from the hook's deny heredoc. It is `cat <<EOF`, NOT printf, so a
# literal % stays a single %. Doubling it would ship "%%" to every blocked seat.
# Re-anchored 2026-10-26: the deny text's opening was corrected at the hook's 24
# (the crash-class-only claim and the 611-sample figures removed), so OLD is now
# the sentence that followed ${THRESHOLD_GB} after that correction, and NEW opens
# with " GB." because the text no longer carries the "(swap ..." parenthesis.
OLD = (
    " GB. This threshold fires on ordinary multi-agent waves, and swap+compressor "
    "LAGS real pressure, so a fire is not by itself evidence the machine is short of "
    "memory: read memory_pressure -Q before reporting it as one. An agent fan-out "
    "under real pressure is how the /wrap deep-pass took the machine to 115 GB twice."
)
# ⛔ NO BACKTICK, NO $, NO ", NO BACKSLASH - the consuming heredoc is UNQUOTED.
# assert_heredoc_safe() enforces this; do not relax it to "improve" the wording.
NEW = (
    " GB. Re-derived over the flight record since {since}: {dist}. The max MOVES - it "
    "rose 27.3 to 28.9 inside two hours on 2026-09-19 as one session's own lens "
    "fan-out pushed it - so read it as a floor, never a bound. WARNING - THIS SUM IS "
    "NOT A RAM-SCARCITY MEASURE: swap is disk, the compressor is RAM, and the sum has "
    "exceeded this machine's physical memory. A high compressor reading means the "
    "kernel is SUCCEEDING at squeezing idle apps, so check free pages with vm_stat "
    "and look at the largest process before treating this as real. The 115 GB "
    "incidents once cited here were traced 2026-08-01 to runaway ugrep, not agent "
    "fan-out, and are guarded at that command."
)


def die(msg):
    print("⛔ %s" % msg, file=sys.stderr)
    sys.exit(1)


def assert_heredoc_safe(text, label):
    """The deny block is an UNQUOTED heredoc, so these four characters are live:
    a backtick or $( runs a command, a " can break the JSON string, a backslash
    escapes. Any of them here is the (a) defect recurring."""
    bad = {c: text.count(c) for c in ("`", "$", '"', "\\") if c in text}
    if bad:
        die("%s carries shell-active characters %r - the deny heredoc is UNQUOTED, "
            "so these EXECUTE or corrupt the JSON. Reword without them." % (label, bad))


def write_preserving_mode(path: Path, data: str):
    """Temp + replace so a throw cannot truncate the original; chmod because
    mkstemp creates 0600 with no execute bit and this hook must stay runnable."""
    mode = stat.S_IMODE(path.stat().st_mode)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(data)
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


# ---- the computation: flight-record lines -> the numbers step 0 prints --------
# Extracted 2026-09-26 from the module-level step 0, with no behaviour change, so
# --self-test exercises the SAME functions main() calls (never an inline copy).

def load_pressure_samples(lines, since):
    """Real pressure samples from JSONL lines, in file order. Skips blank and
    unparseable lines, records with synthetic IS True (only the boolean - a string
    "true" is kept), and records whose ts sorts before `since` (a missing ts reads
    as "" and is excluded). The FIRST present key of pressure_gb / pressureGb /
    pressure is the sample; a non-numeric value there drops the record rather than
    falling through to the next key."""
    vals = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        if not isinstance(r, dict):  # a bare JSON scalar or array line is malformed too
            continue
        if r.get("synthetic") is True:
            continue
        if str(r.get("ts", "")) < since:
            continue
        for k in ("pressure_gb", "pressureGb", "pressure"):
            if k in r:
                try:
                    vals.append(float(r[k]))
                except (TypeError, ValueError):
                    pass
                break
    return vals


def percentile(sorted_vals, p):
    """Nearest-rank percentile over an ASCENDING list - no interpolation, so p50 of
    1..20 is 10, not the median 10.5."""
    if not sorted_vals:
        raise ValueError("percentile of an empty distribution")
    return sorted_vals[min(len(sorted_vals) - 1, int(math.ceil(p / 100 * len(sorted_vals))) - 1)]


def distribution(vals):
    """(sorted values, summary text) - the text is what step 0 prints and what the
    recalibrated deny message bakes in. An empty distribution raises ValueError from
    percentile() - one guard, not two (a second one here was shadowed and untestable)."""
    ordered = sorted(vals)
    text = ("%d real samples, p50 %.1f / p95 %.1f / p99 %.1f / max %.1f GB"
            % (len(ordered), percentile(ordered, 50), percentile(ordered, 95),
               percentile(ordered, 99), ordered[-1]))
    return ordered, text


def denials_at(vals, threshold):
    """How many samples the guard would deny at `threshold` - strictly ABOVE it."""
    return sum(1 for v in vals if v > threshold)


def headroom_verdict(headroom, owner_ruled):
    """The one decision the owner's words can move. Returns (action, message):
    'ok' (nothing to say), 'warn' (under 1 GB, print and continue), 'override'
    (negative headroom, owner words present: print and continue) or 'die'
    (negative headroom, no words). main() and --self-test both call this."""
    if headroom < 0:
        if owner_ruled:
            return ("override",
                    "headroom is NEGATIVE (%.1f GB); the headroom check is overridden on the "
                    "owner's words: %r" % (headroom, owner_ruled))
        return ("die",
                "by %.1f GB - recalibrating would still deny real work. Re-decide the number "
                "with that figure in front of the owner, then re-run with "
                "--owner-ruled='<his words>'." % (-headroom))
    if headroom < 1.0:
        return ("warn", "headroom is under 1 GB and the max has been RISING - consider a higher "
                        "threshold before applying.")
    return ("ok", "")


def self_test():
    """Fixture regression over the REAL functions above. Reads no log and writes no
    file. Returns a process exit code."""
    failures = []

    def check(name, got, expected):
        ok = got == expected
        print("  [%s] %s\n         expected %r, got %r" % ("PASS" if ok else "FAIL", name, expected, got))
        if not ok:
            failures.append(name)

    print("ARM 1 - load_pressure_samples: which records count")
    lines = [
        '{"ts":"2026-09-02T00:00:00Z","pressure_gb":10}',               # kept
        '{"ts":"2026-08-31T23:59:59Z","pressure_gb":99}',               # before SINCE
        '{"ts":"2026-09-03","pressure_gb":50,"synthetic":true}',        # synthetic
        '{"ts":"2026-09-03","pressure_gb":"n/a","pressure":77}',        # first key wins, then dropped
        '{"ts":"2026-09-03","pressureGb":"12.5"}',                      # numeric string
        'not json {',
        '',
        '{"ts":"2026-09-04","pressure":3}',
        '{"ts":"2026-09-04","synthetic":"true","pressure":4}',          # string synthetic is kept
        '{"pressure_gb":5}',                                            # no ts -> excluded
        '{"ts":"2026-09-05","other":1}',                                # no pressure key
    ]
    check("mixed fixture -> exactly the four real samples, in file order",
          load_pressure_samples(lines, "2026-09-01"), [10.0, 12.5, 3.0, 4.0])

    print("\nARM 2 - percentile / distribution: nearest-rank, sorted, strict denial")
    one_to_twenty = [float(v) for v in range(20, 0, -1)]  # DESCENDING on purpose
    ordered, text = distribution(one_to_twenty)
    check("distribution sorts its input", ordered, sorted(one_to_twenty))
    check("summary text over 1..20",
          text, "20 real samples, p50 10.0 / p95 19.0 / p99 20.0 / max 20.0 GB")
    check("denials strictly above 19 (19 itself is not denied)", denials_at(one_to_twenty, 19.0), 1)
    check("denials above 24", denials_at(one_to_twenty, 24.0), 0)

    print("\nARM 3 - the fixture DISCRIMINATES: plausible wrong percentiles disagree with it")
    wrong = {
        "median (interpolated p50)": lambda v, p: (v[len(v) // 2 - 1] + v[len(v) // 2]) / 2,
        "floor index v[int(p/100*n)]": lambda v, p: v[min(len(v) - 1, int(p / 100 * len(v)))],
        "linear interpolation": lambda v, p: (lambda k: v[int(k)] + (v[min(int(k) + 1, len(v) - 1)] - v[int(k)]) * (k - int(k)))((len(v) - 1) * p / 100),
    }
    for label, fn in wrong.items():
        agrees = all(fn(ordered, p) == percentile(ordered, p) for p in (50, 95))
        check("%s differs from nearest-rank on 1..20" % label, agrees, False)

    print("\nARM 4 - empty / malformed input is REFUSED, never summarised")
    check("all-malformed lines yield no samples",
          load_pressure_samples(["", "garbage", "42", "[1, 2]", '{"ts":"2026-09-09"}', '{"ts":"2026-09-09","pressure":null}'],
                                "2026-09-01"), [])
    for label, fn in (("distribution([])", lambda: distribution([])),
                      ("percentile([], 50)", lambda: percentile([], 50))):
        try:
            got = "returned %r" % (fn(),)
        except ValueError:
            got = "ValueError"
        check("%s raises" % label, got, "ValueError")

    print("\nARM 5 - headroom_verdict: only the owner's words move a negative headroom")
    check("negative headroom, no words -> die", headroom_verdict(-11.6, "")[0], "die")
    check("negative headroom, owner words -> override", headroom_verdict(-11.6, "30")[0], "override")
    check("headroom under 1 GB -> warn, words or not", (headroom_verdict(0.5, "")[0], headroom_verdict(0.5, "30")[0]), ("warn", "warn"))
    check("headroom 1 GB or more -> ok", headroom_verdict(1.0, "")[0], "ok")

    print("\n%s - %d failure(s)" % ("FAIL" if failures else "PASS", len(failures)))
    return 1 if failures else 0


def main(argv):
    if argv == ["--self-test"]:
        return self_test()
    check = "--check" in argv
    owner_ruled = ""

    # ⛔ Unknown flags must not fall through to a WRITE.
    for a in argv:
        if a == "--check":
            continue
        if a.startswith(OWNER_FLAG):
            owner_ruled = a[len(OWNER_FLAG):].strip()
            if not owner_ruled:
                print("⛔ --owner-ruled needs his words after the = (the quote is what gets logged)",
                      file=sys.stderr)
                sys.exit(2)
            continue
        print("⛔ unknown argument %r - only --check, --owner-ruled='<words>' (or --self-test "
              "alone) is accepted" % a, file=sys.stderr)
        sys.exit(2)

    for f in (SETTINGS, HOOK):
        if not f.exists():
            die("missing: %s" % f)

    # ---- 0. RE-DERIVE the distribution live; never trust a baked figure ------
    vals = []
    if LOG.exists():
        with open(LOG, encoding="utf-8") as fh:
            vals = load_pressure_samples(fh, SINCE)
    if not vals:
        die("no real pressure samples since %s in %s - refusing to recalibrate on no "
            "data (a threshold set from an empty distribution is a guess)." % (SINCE, LOG))

    vals, dist = distribution(vals)
    observed_max = vals[-1]
    print("  live distribution (%s, synthetic excluded): %s" % (SINCE, dist))
    for t in (24.0, float(THRESHOLD)):
        n = denials_at(vals, t)
        print("    denials at %g GB: %d (%.2f%%)" % (t, n, 100.0 * n / len(vals)))
    headroom = float(THRESHOLD) - observed_max
    print("    headroom of the proposed %s GB over the observed max: %.1f GB" % (THRESHOLD, headroom))
    action, msg = headroom_verdict(headroom, owner_ruled)
    if action == "die":
        die("the observed max %.1f GB EXCEEDS the proposed threshold %s %s" % (observed_max, THRESHOLD, msg))
    elif action in ("warn", "override"):
        print("  ⚠️  %s" % msg)

    # ---- 1. VALIDATE EVERYTHING. Nothing below this line writes. -------------
    if not re.fullmatch(r"[0-9]+(\.[0-9]+)?", THRESHOLD):
        die("threshold %r is not numeric - the hook would silently fall back to 24" % THRESHOLD)

    new_text = NEW.format(since=SINCE, dist=dist)
    assert_heredoc_safe(new_text, "the replacement text")

    settings_src = SETTINGS.read_text(encoding="utf-8")
    cfg = json.loads(settings_src)
    env = cfg.setdefault("env", {})
    threshold_current = env.get(ENV_KEY)
    threshold_todo = threshold_current != THRESHOLD

    src = HOOK.read_text(encoding="utf-8")
    n = src.count(OLD)
    if n == 0 and new_text[:40] in src:
        text_todo = False
        patched = src
    elif n == 0 and "Re-derived over the flight record" in src:
        # Already recalibrated, but with a different distribution baked in. Refresh it.
        text_todo = False
        patched = src
        print("  denial text already recalibrated (figures from an earlier run retained)")
    elif n != 1:
        die("anchor found %d times in the hook, expected exactly 1 - NOTHING WRITTEN, on "
            "EITHER file. The text moved; re-derive the anchor before forcing this." % n)
    else:
        text_todo = True
        patched = src.replace(OLD, new_text)

    # Render the patched deny arm and prove it is still ONE parseable JSON document.
    # This is the check that would have caught the backtick defect; bash -n cannot,
    # because command substitution is perfectly valid syntax.
    m = re.search(r"cat <<EOF\n(.*?)\nEOF", patched, re.S)
    if not m:
        die("cannot locate the deny heredoc in the patched hook - refusing to write")
    rendered = re.sub(r"\$\{[A-Za-z_][A-Za-z0-9_]*\}", "1", m.group(1))
    try:
        doc = json.loads(rendered)
    except Exception as e:
        die("the patched deny block is NOT valid JSON (%s) - the harness would discard it "
            "wholesale and the guard would stop denying. NOTHING WRITTEN." % e)
    if "hookSpecificOutput" not in doc:
        die("the patched deny block lost its hookSpecificOutput key - NOTHING WRITTEN")
    print("  ✓ patched deny block renders as ONE valid JSON document")

    if not threshold_todo:
        print("✓ threshold already %s" % THRESHOLD)
    else:
        print("  threshold: %s -> %s" % (threshold_current or "(unset, hook default 24)", THRESHOLD))
    if not text_todo:
        print("✓ denial text already corrected")
    else:
        print("  denial text: adding the live distribution and replacing the agent "
              "fan-out claim for the 115 GB incidents")

    if check:
        print("\n--check: nothing was written.")
        return 0

    if not (threshold_todo or text_todo):
        print("\n✅ nothing to do.")
        return 0

    # Never sweep someone else's uncommitted work into this change. Checked here, at
    # the last moment before writing, rather than minutes earlier.
    dirty = subprocess.run(
        ["git", "-C", str(ROOT), "status", "--porcelain", "--", str(SETTINGS), str(HOOK)],
        capture_output=True, text=True,
    ).stdout.strip()
    if dirty:
        die("one of the targets is already modified - commit or revert first, then "
            "re-run:\n" + dirty)

    # ---- 2. WRITE. Every check above has passed. ---------------------------------
    # Pre-write bytes, so a failed verify below can put BOTH files back: the dirty
    # check above just proved these equal HEAD, so restoring them sweeps nobody's work.
    before = {SETTINGS: settings_src, HOOK: src}

    def restore_and_die(msg):
        for p, data in before.items():
            write_preserving_mode(p, data)
        die(msg + "\nBOTH files restored to their pre-run bytes; the override was not logged.")
    if threshold_todo:
        env[ENV_KEY] = THRESHOLD
        write_preserving_mode(SETTINGS, json.dumps(cfg, indent=2) + "\n")
        print("✓ wrote %s=%s" % (ENV_KEY, THRESHOLD))
    if text_todo:
        write_preserving_mode(HOOK, patched)
        print("✓ denial text updated")

    # ---- 3. VERIFY what actually landed ------------------------------------------
    rc = subprocess.run(["bash", "-n", str(HOOK)], capture_output=True, text=True)
    if rc.returncode != 0:
        restore_and_die("the patched hook did not parse:\n" + rc.stderr)
    print("✓ hook still parses")

    back = json.loads(SETTINGS.read_text(encoding="utf-8")).get("env", {}).get(ENV_KEY)
    if back != THRESHOLD:
        restore_and_die("read-back failed: %s is %r, expected %r" % (ENV_KEY, back, THRESHOLD))
    print("✓ read back %s=%s" % (ENV_KEY, back))
    if action == "override":
        OVERRIDE_LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(OVERRIDE_LOG, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"ts": __import__("datetime").datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
                                 "threshold": THRESHOLD, "observed_max": observed_max,
                                 "headroom": round(headroom, 1), "owner_ruled": owner_ruled}) + "\n")
        print("✓ recorded the owner's words beside the figures in %s" % OVERRIDE_LOG.relative_to(ROOT))

    print("\n✅ done. Takes effect on NEW sessions only - restart to pick it up.")
    print("   undo: git checkout -- .claude/settings.json "
          ".claude/hooks/agent-dispatch-memory-guard.sh")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
