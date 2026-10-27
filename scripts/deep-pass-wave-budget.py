#!/usr/bin/env python3
"""How many deep-pass slices to dispatch in the next wave, read off the five-hour session limit.

The rule: before running any new deep-scan agent, check the session limit.
`/deep-pass` runs this before EVERY wave (its SKILL.md, the SESSION LIMIT bullet of the procedure).

    python3 scripts/deep-pass-wave-budget.py --state <scratchpad>/dp-budget-<run>.json --left <M> --cap <C> [--ran <K>]
    python3 scripts/deep-pass-wave-budget.py --self-test

  --state  this run's own small JSON file; it carries the reading taken before the last wave
  --left   slices not dispatched yet
  --cap    the wave ceiling the spec sets
  --ran    slices actually dispatched in the last wave (default: the number this tool printed last time)

Prints ONE line; read its first word. `DISPATCH <W> — ...` (exit 0): launch W slices. `STOP — <line>` (exit 3):
launch nothing more, and say <line> to the owner as printed. Exit 2 is a usage error.

The reading is `.claude/state/statusline-<sid8>.json`, the same file and the same trust rule as
`.claude/hooks/agent-dispatch-session-limit-guard.py`, whose THRESHOLD_PCT and MAX_AGE_S are imported from it,
never restated here: `ts` at most MAX_AGE_S old, a finite share, a window not already reset. Sizing:

  * wave 1, or no per-slice cost measured yet: the default size, min(cap, left);
  * later waves: per slice = (share now - share before the last wave) / slices it ran, in the same window;
    the wave is the most slices that should END at or below THRESHOLD_PCT, capped by cap and left;
  * a share at or above THRESHOLD_PCT, or a wave of 0: STOP;
  * no trusted reading: the default size, and the line says the limit could not be read (the guard fails
    open the same way);
  * the window reset between two readings: that pair says nothing; the last measured cost is kept.

The limit is the ACCOUNT's, so the difference also counts the seat's own work and any other session's
between the two readings. That over-states a slice's cost, which only makes the next wave smaller.
"""
import importlib.util
import json
import math
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
GUARD = os.path.join(HERE, os.pardir, ".claude", "hooks", "agent-dispatch-session-limit-guard.py")


def _guard():
    spec = importlib.util.spec_from_file_location("session_limit_guard_for_wave_budget", GUARD)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_G = _guard()
THRESHOLD_PCT = _G.THRESHOLD_PCT
MAX_AGE_S = _G.MAX_AGE_S


def read_limit(sid8, state_dir, now):
    """(pct, resets_at) from a trusted reading, else None."""
    try:
        with open(os.path.join(state_dir, "statusline-%s.json" % sid8)) as fh:
            rec = json.load(fh)
    except (OSError, ValueError):
        return None
    if not isinstance(rec, dict):
        return None
    ts = rec.get("ts")
    if not isinstance(ts, (int, float)) or isinstance(ts, bool) or not 0 <= now - ts <= MAX_AGE_S:
        return None
    pct, reset = rec.get("five_hour_pct"), rec.get("five_hour_resets_at")
    if not _G.live(pct, reset, now):
        return None
    return float(pct), (reset if isinstance(reset, (int, float)) and not isinstance(reset, bool) else None)


def reset_words(reset):
    if reset is None:
        return "they run after the session limit resets"
    return "they run after the reset at %s UTC" % time.strftime("%H:%M", time.gmtime(reset))


def decide(reading, prev, left, cap, ran=None):
    """Pure. Returns (word, wave, line, new_state)."""
    per = prev.get("per_slice") if isinstance(prev, dict) else None
    if reading is not None and isinstance(prev, dict) and isinstance(prev.get("pct"), (int, float)):
        k = ran if ran is not None else prev.get("wave")
        a, b = prev.get("resets_at"), reading[1]
        # one window: the same reset time, give or take a status-line rounding (a new window is hours later)
        same_window = a == b or (isinstance(a, (int, float)) and isinstance(b, (int, float)) and abs(a - b) <= 600)
        if isinstance(k, int) and k > 0 and same_window and reading[0] >= prev["pct"]:
            per = (reading[0] - prev["pct"]) / k
    default = max(0, min(cap, left))
    if reading is None:
        word, wave = "DISPATCH", default
        line = ("session limit could not be read (no status-line reading under %d minutes old); default size"
                % (MAX_AGE_S // 60))
    else:
        pct, reset = reading
        if pct >= THRESHOLD_PCT:
            wave = 0
        elif not per:
            wave = default
        else:
            wave = max(0, min(default, int(math.floor((THRESHOLD_PCT - pct) / per + 1e-9))))
        if wave == 0:
            word = "STOP"
            line = ("Stopping the deep pass at %g%% of the session limit; %d slices left, %s."
                    % (round(pct), left, reset_words(reset)))
        else:
            word = "DISPATCH"
            if not per:
                line = "session limit at %g%%; no per-slice cost measured yet, so the default size" % round(pct)
            else:
                line = ("session limit at %g%%, about %.1f%% per slice in the last wave, so this wave should end "
                        "near %g%%" % (round(pct), per, round(pct + wave * per)))
    new_state = {"pct": reading[0] if reading else None, "resets_at": reading[1] if reading else None,
                 "wave": wave, "per_slice": per}
    return word, wave, line, new_state


def main(argv):
    if "--self-test" in argv:
        return self_test()
    opts, i = {}, 0
    known = {"--state", "--left", "--cap", "--ran", "--sid"}
    while i < len(argv):
        if argv[i] not in known or i + 1 >= len(argv):
            print("deep-pass-wave-budget: unrecognised or valueless argument %r; see the header" % argv[i],
                  file=sys.stderr)
            return 2
        opts[argv[i]] = argv[i + 1]
        i += 2
    try:
        left, cap = int(opts["--left"]), int(opts["--cap"])
        ran = int(opts["--ran"]) if "--ran" in opts else None
        state = opts["--state"]
    except (KeyError, ValueError):
        print("deep-pass-wave-budget: --state, --left and --cap are required; --left, --cap and --ran are whole "
              "numbers", file=sys.stderr)
        return 2
    sid8 = (opts.get("--sid") or os.environ.get("CLAUDE_CODE_SESSION_ID") or "").lower()[:8]
    root = os.environ.get("CLAUDE_PROJECT_DIR") or os.path.join(HERE, os.pardir)
    state_dir = os.environ.get("FF_STATE_DIR") or os.path.join(root, ".claude", "state")
    if left <= 0:
        print("DONE — no slices left to dispatch")
        return 0
    try:
        with open(state) as fh:
            prev = json.load(fh)
    except (OSError, ValueError):
        prev = None
    reading = read_limit(sid8, state_dir, time.time()) if len(sid8) == 8 else None
    word, wave, line, new_state = decide(reading, prev, left, cap, ran)
    try:
        with open(state, "w") as fh:
            json.dump(new_state, fh)
    except OSError as e:
        print("deep-pass-wave-budget: could not write %s (%s); the next wave cannot be sized from this one"
              % (state, e), file=sys.stderr)
    if word == "STOP":
        print("STOP — %s" % line)
        return 3
    print("DISPATCH %d — %s" % (wave, line))
    return 0


def self_test():
    fails = []

    def eq(name, got, want):
        if got != want:
            fails.append("%s: got %r, want %r" % (name, got, want))

    R = 1_800_000_000
    # wave 1: no state, default size whatever the share
    w = decide((20.0, R), None, 30, 12)
    eq("wave 1 takes the default size", (w[0], w[1]), ("DISPATCH", 12))
    eq("wave 1 records its size for the next call", w[3]["wave"], 12)
    eq("wave 1 never invents a per-slice cost", w[3]["per_slice"], None)
    # wave 2: 12 slices moved the share 20 -> 44, 2% each; (90 - 44) / 2 = 23 -> capped at 12
    w2 = decide((44.0, R), w[3], 18, 12)
    eq("wave 2 measured per slice", w2[3]["per_slice"], 2.0)
    eq("wave 2 capped by the ceiling", w2[1], 12)
    # wave 3: 12 more took 44 -> 80; (90 - 80) / 3 = 3.33 -> 3
    w3 = decide((80.0, R), w2[3], 6, 12)
    eq("wave 3 sized to end at or below the line", (w3[0], w3[1]), ("DISPATCH", 3))
    # wave 4: 3 more took 80 -> 89; 3 per slice; (90 - 89) / 3 -> 0 -> STOP with the owner line
    w4 = decide((89.0, R), w3[3], 3, 12)
    eq("a slice that cannot fit stops", w4[0], "STOP")
    eq("the stop line", w4[2], "Stopping the deep pass at 89%% of the session limit; 3 slices left, they run after "
       "the reset at %s UTC." % time.strftime("%H:%M", time.gmtime(R)))
    # exactly at the line, unmeasured: still a stop, since any wave ends above it
    eq("at the line on wave 1 stops", decide((float(THRESHOLD_PCT), R), None, 5, 12)[0], "STOP")
    eq("above the line stops", decide((95.0, R), None, 5, 12)[0], "STOP")
    # left smaller than the cap
    eq("left caps the wave", decide((10.0, R), None, 4, 12)[1], 4)
    # --ran overrides the remembered size: 6 slices moved 20 -> 44 is 4% each; (90-44)/4 = 11.5 -> 11
    eq("--ran overrides the remembered wave", decide((44.0, R), w[3], 30, 12, ran=6)[1], 11)
    # the window reset between readings: the pair is not a cost; the earlier cost is kept
    w5 = decide((5.0, R + 18000), w2[3], 30, 12)
    eq("a reset keeps the last measured cost", w5[3]["per_slice"], 2.0)
    eq("after a reset the kept cost sizes the wave", w5[1], 12)
    # a share that went DOWN in the same window is not a cost either
    eq("a falling share measures nothing", decide((10.0, R), {"pct": 20.0, "resets_at": R, "wave": 12,
                                                                "per_slice": None}, 30, 12)[3]["per_slice"], None)
    # no reading: the default size, said plainly
    w6 = decide(None, w2[3], 30, 12)
    eq("no reading dispatches the default", (w6[0], w6[1]), ("DISPATCH", 12))
    eq("no reading says so", "could not be read" in w6[2], True)
    # a zero cost (the share did not move) does not divide by zero
    eq("a zero cost takes the default", decide((20.0, R), {"pct": 20.0, "resets_at": R, "wave": 12,
                                                            "per_slice": None}, 30, 12)[1], 12)
    eq("no reset time in the reading", decide((95.0, None), None, 2, 12)[2],
       "Stopping the deep pass at 95% of the session limit; 2 slices left, they run after the session limit resets.")

    # the trust rule, through the file
    with tempfile.TemporaryDirectory() as d:
        now = time.time()
        p = os.path.join(d, "statusline-abcd1234.json")

        def put(rec):
            with open(p, "w") as fh:
                json.dump(rec, fh)
        put({"ts": now - 30, "five_hour_pct": 41, "five_hour_resets_at": now + 3600})
        eq("a fresh reading is read", read_limit("abcd1234", d, now), (41.0, now + 3600))
        put({"ts": now - MAX_AGE_S - 1, "five_hour_pct": 41, "five_hour_resets_at": now + 3600})
        eq("a stale reading is not trusted", read_limit("abcd1234", d, now), None)
        put({"ts": now - 30, "five_hour_pct": 41, "five_hour_resets_at": now - 1})
        eq("a window already reset is not trusted", read_limit("abcd1234", d, now), None)
        put({"ts": now - 30, "five_hour_pct": True, "five_hour_resets_at": now + 3600})
        eq("a boolean share is not trusted", read_limit("abcd1234", d, now), None)
        eq("a missing file is not trusted", read_limit("ffff0000", d, now), None)

        # the CLI end to end: wave 1 then a stop, state carried in the file
        import subprocess
        st = os.path.join(d, "dp-budget-x.json")
        rst = time.time() + 3600
        env = dict(os.environ, FF_STATE_DIR=d)
        put({"ts": time.time(), "five_hour_pct": 70, "five_hour_resets_at": rst})
        r1 = subprocess.run([sys.executable, os.path.abspath(__file__), "--state", st, "--left", "20", "--cap", "12",
                             "--sid", "abcd1234"], capture_output=True, text=True, env=env)
        eq("CLI wave 1", (r1.returncode, r1.stdout.split(" ")[:2]), (0, ["DISPATCH", "12"]))
        put({"ts": time.time(), "five_hour_pct": 89, "five_hour_resets_at": rst + 1})  # 19/12 per slice; 1 left
        r2 = subprocess.run([sys.executable, os.path.abspath(__file__), "--state", st, "--left", "8", "--cap", "12",
                             "--sid", "abcd1234"], capture_output=True, text=True, env=env)
        eq("CLI stop", (r2.returncode, r2.stdout.split(" ")[0]), (3, "STOP"))
        eq("CLI stop line names the slices left", "8 slices left" in r2.stdout, True)
        r3 = subprocess.run([sys.executable, os.path.abspath(__file__), "--state", st, "--left", "8", "--cap"],
                            capture_output=True, text=True, env=env)
        eq("CLI usage error", r3.returncode, 2)

    for f in fails:
        print("FAIL " + f)
    print("self-test: %s (%d checks failed)" % ("PASS" if not fails else "FAIL", len(fails)))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
