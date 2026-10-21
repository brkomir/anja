#!/usr/bin/env python3
"""Print the Band-O digest's live metrics by running the hook's OWN build_digest().

Why this exists: every figure describing the digest (rows truncated, action-char share,
headroom) was hand-maintained in three places and wrong in two of them by 2026-08-14 —
"27 of 29 rows … ~20%" counted the table header+separator as data rows and quoted the
per-row median as the pooled share. A bare figure in prose rots silently; this
re-derives it in one command.

It does NOT reimplement the parser. Reimplementing is how you get a number that describes
your model of the hook instead of the hook (the whole failure this file was written after).
It extracts the hook's embedded python verbatim, up to `def decide`, and calls the real
build_digest(). If the hook's structure changes such that the extraction fails, this exits
non-zero and says so rather than printing a plausible number.

Read-only: the extracted region contains no writes except emit()'s print, which is never
called. Nothing touches the log, the state dir, or the band file.

`--log` adds the HEALTH read the hook only ever described in comments. The hook's own
prose at :87/:228/:356 refers to a "pre-registered digest_rate<50% alarm" as though it
were an instrument; measured 2026-08-14, all three mentions are COMMENTS and
`check-band-budget.mjs` — the thing that actually reads this log — has zero occurrences of
the token. Nothing computed it and nothing surfaced it, which is exactly why the headroom
cliff is silent: the digest can die fleet-wide and the only trace is a log nobody reads.
The alarm was wired-but-inert, in the hook's own margin.

DENOMINATOR, and it is the whole correctness of the rate: eligible turns EXCLUDE EVERY
forced-full mode (`FORCED_FULL`, six of them), NEVER all injections and NEVER just
`full_typed`. A typed prompt is never digest-eligible by design, so an all-injection rate
measures how much the owner is TYPING and trips the low alarm on a perfectly healthy hook —
but excluding only `full_typed` is the SECOND wrong denominator, not the fix: it leaves the
other five forced-fulls in, read 85.1% where the true rate is 99.2%, and so HID a ceiling
breach. See the FORCED_FULL comment below; the `--self-test` at the bottom pins every mode
against exactly that regression. Era-scoped on the presence of the `budget` KEY, which
entered with a later fold — a timestamp would straddle that boundary.
⚠️ This paragraph read `mode != full_typed` until 2026-08-17, i.e. the docstring prescribed
the regression its own self-test exists to catch — no code path ever used that form (grep
`!= "full_typed"` → 0), so the defect was prose-only and bounded, but it argued for
"correcting" the code toward the outcome-changing version.

Usage:  python3 scripts/band-o-digest-metrics.py [--json]
        python3 scripts/band-o-digest-metrics.py --log [--json]
        python3 scripts/band-o-digest-metrics.py --self-test
"""
import ast
import json
import os
import re
import statistics
import sys
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(ROOT, ".claude", "hooks", "band-o-inject.sh")
BAND = os.path.join(ROOT, ".claude", "orchestrator", "active-recall-orchestrator.md")

# The chunk cap build_digest() measures itself against. Read from the hook rather than
# restated, for the same reason this script exists at all.
# ⛔ THE CAP IS READ FROM THE EXECUTED MODULE, NOT SCRAPED FROM THE SOURCE. This was
# `re.compile(r"if len\(dg\) <= (\d+):")` until 2026-08-14, and it broke the moment the hook
# replaced its literal with the derived `DIGEST_CAP` — a regex over source can only match the
# spelling it was written for, while the hook is free to refactor. It failed in the DESIGNED
# direction (rc=2, "could not read the chunk cap") rather than printing a plausible number,
# which is the only reason this was a two-minute fix. Same lesson as the predicate search in
# _min_draw_n(): evaluate the thing, do not restate it.
CAP_SYMBOL = "DIGEST_CAP"
TRUNC_MARK = "…⟶READ-FULL-ROW"


def fail(msg):
    sys.stderr.write("band-o-digest-metrics: %s\n" % msg)
    sys.exit(2)


def extract_python():
    """Return the hook's embedded python from the heredoc up to `def decide`."""
    try:
        src = open(HOOK, encoding="utf-8").read()
    except OSError as e:
        fail("cannot read hook: %s" % e)
    lines = src.split("\n")
    # Match the heredoc opener anywhere in the line: it currently reads
    #   python3 - "$FILE" "$CHUNK" "${PF:-/dev/null}" "$DIR" <<'PY' || true
    # so an endswith() anchor is wrong (measured — it found 0 and exited 2, correctly).
    # ⛔ SKIP COMMENT LINES. A COMMENT CANNOT BE THE OPENER, AND WITHOUT THIS SKIP A MAINTAINER
    # SENTENCE DISARMS A PUSH GATE. Measured 2026-09-05: a fold comment in the hook explained
    # the exception-handling coupling and quoted the opener verbatim; this scan counted 2, the
    # tool exited 2 with "hook restructured", `smoke-test-hooks.sh:6048` went red, and
    # `.githooks/pre-push` therefore refused every band-touching push in the fleet — from prose.
    # The broad substring match on the CODE line is correct and stays (an `endswith` anchor
    # measured 0 here); what was wrong is scanning a population that includes prose ABOUT the
    # thing. Strictly fewer false positives: a real opener is never a comment, so no restructure
    # this used to catch can now escape.
    starts = [i for i, l in enumerate(lines)
              if "<<'PY'" in l and not l.lstrip().startswith("#")]
    if len(starts) != 1:
        fail("expected exactly 1 python heredoc, found %d — hook restructured" % len(starts))
    ends = [i for i, l in enumerate(lines) if l.strip() == "def decide(state):"]
    if len(ends) != 1:
        fail("expected exactly 1 `def decide(state):`, found %d — hook restructured" % len(ends))
    body = "\n".join(lines[starts[0] + 1:ends[0]])
    # Capture build_digest's function-local `items` so the per-row metrics can be computed
    # from the SAME parse the digest ships from.
    anchor = '    th = sum(1 for t, _ in items if t == "th")'
    # EXACT-LINE match, not body.count(): a raw substring count is comment-blind, so one
    # house-style comment quoting this line inside the heredoc reads 2 and fail()s the
    # fleet push gate. Same class as the <<'PY' opener guard above.
    blines = body.split("\n")
    hits = [i for i, l in enumerate(blines) if l == anchor]
    if len(hits) != 1:
        fail("items-capture anchor not unique (%d) — hook restructured" % len(hits))
    blines[hits[0]] = '    globals()["_CAPTURED_ITEMS"] = items\n' + anchor
    body = "\n".join(blines)
    try:
        ast.parse(body)
    except SyntaxError as e:
        fail("extracted python does not parse: %s" % e)
    return body


LOG = os.path.join(ROOT, ".claude", "logs", "band-o-inject.jsonl")

# ⛔ THE MODE VOCABULARY IS DERIVED FROM `decide()` (band-o-inject.sh:336-378), NOT from what
# happens to appear in the log. Every branch here returns BEFORE build_digest() is called, so
# these turns never had a digest to succeed or fail at — counting them as "eligible" measures
# how often the fleet does something else.
#
# The first version of this file excluded only `full_typed` and the error was OUTCOME-CHANGING,
# not cosmetic: it read 85.1% (comfortably mid-band) where the corrected rate is 99.2%, which
# BREACHES the ceiling. An inflated denominator pulls the rate toward the middle of the healthy
# range, so the defect HIDES the alarm the ceiling exists to raise — the worst direction.
# Caught by running this logic against the real log.
FORCED_FULL = frozenset({
    "full_typed", "full_state", "full_band_changed",
    "full_post_compact", "full_heartbeat", "full_holdout",
})
# The digest was ATTEMPTED on these two and only these two. `fallback_full_digest` belongs in
# the denominator: build_digest() returned None, which is a genuine failure of the path.
DIGEST_ATTEMPTED = frozenset({"digest", "fallback_full_digest"})
# ⛔ THE ZERO-INJECTION ARM IS A THIRD CATEGORY AND BELONGS IN NEITHER SET ABOVE (added to the
# hook 2026-09-04). `none_zeroarm` emits NOTHING: the digest was never ATTEMPTED on it, so
# putting it in DIGEST_ATTEMPTED would depress digest_rate by the arm's own rate and drift a
# healthy system toward the 50% floor; and it is not FORCED_FULL either, because no full band
# was emitted — that name would be a lie a future reader acts on.
NO_EMIT = frozenset({"none_zeroarm"})
KNOWN_MODES = FORCED_FULL | DIGEST_ATTEMPTED | NO_EMIT

# FLOOR answers "does the digest path work?" — denominator = turns where it was attempted.
DIGEST_RATE_FLOOR = 50.0

# ⛔ THERE IS NO CEILING ON THAT RATE, AND ADDING ONE WAS A CATEGORY ERROR. Once forced-full
# modes leave the denominator, its only members are {digest, fallback_full_digest}: the rate is
# bounded at 100% and can fall ONLY via build failures, so any ceiling fires forever on a
# perfectly healthy system. The question the old ceiling was reaching for — "is a full-band
# control still happening?" — is not answerable from digest-share at all. The control is the
# HOLDOUT, so it gets its own metric against its own design rate.
#
# `decide()` draws with `md5(...) % 10 == 0`, so the design rate is exactly 1-in-10 over the
# turns that REACH the draw (digest + fallback + holdout). The band is 3 sigma of the binomial,
# derived rather than chosen: sd = sqrt(n * p * (1-p)). MIN_DRAW_N exists so a thin sample
# reports NO-DATA instead of a verdict — at small n the 3-sigma band swallows zero and the
# check would pass vacuously on a draw that has completely stopped.
HOLDOUT_DESIGN_RATE = 0.10
HOLDOUT_SIGMA = 3.0


def _min_draw_n(p=None, sigma=None):
    """Smallest n at which a ZERO-holdout observation can actually trip the band.

    ⛔ THE FIRST VERSION WROTE `MIN_DRAW_N = 30`, A NUMBER I CHOSE. The comment above it stated
    the purpose correctly — "at small n the 3-sigma band swallows zero and the check would pass
    vacuously" — and 30 does not implement it: the band's lower bound stays <= 0 all the way to
    n=81, so between n=30 and n=81 the check returned a verdict while being structurally unable
    to detect a completely dead draw. Exactly the vacuous pass the comment was written against.
    Caught in review and verified here before folding.

    The threshold is DERIVABLE, not pickable. Setting the lower bound to zero,
    n*p = sigma*sqrt(n*p*(1-p))  =>  n* = sigma^2 * (1-p)/p  =  81 at p=0.10, sigma=3.

    ⚠️ THE ALGEBRA IS SOUND; THE FLOAT IS NOT — and it is worth stating in that order, because
    the tempting summary ("no rounding rule works") is FALSE and was offered once in review.
    Squaring the fire condition gives `n > n*` exactly, so the answer is simply the smallest
    integer strictly greater than n*, i.e. `floor(n*) + 1` — verified uniformly correct in
    EXACT arithmetic (Fraction) at p = 0.07, 0.10, 0.11, 0.15, 0.20, 1/3, covering both the
    exact-integer and fractional cases. There is nothing wrong with the rule.

    What breaks is representation: in float, 9*(1-0.10)/0.10 evaluates to 80.99999999999999,
    so `floor(n*) + 1` returns 81 — the blind value this function exists to escape. (`ceil + 1`
    happens to return 82 there and over-shoots whenever n* is genuinely fractional: p=0.11
    gives 74 where 73 is right. It is not a fix.)

    So the closed form is usable only with exact arithmetic. This SEARCHES THE SAME PREDICATE
    the check evaluates instead, which needs no Fraction import, cannot disagree with the check
    (no restatement to drift), and tracks any future change to the rate or the sigma rather
    than stranding a literal beside them.
    """
    p = HOLDOUT_DESIGN_RATE if p is None else p
    sigma = HOLDOUT_SIGMA if sigma is None else sigma
    n = 1
    while n <= 100000:
        if 0 < p * n - sigma * (n * p * (1 - p)) ** 0.5:
            return n
        n += 1
    raise ValueError("no n under 100000 makes a zero-holdout observation detectable at "
                     "p=%r sigma=%r — the band can never fire; fix the parameters" % (p, sigma))


MIN_DRAW_N = _min_draw_n()

# CLIFF floor. ⚠️ A MEDIAN is the wrong statistic when the risk is a row
# not FITTING — the binding quantity is a high percentile or the max. THAT IS NOW MEASURED and
# the floor is DERIVED per run (see derive_row_floor below), so this constant is only the
# FALLBACK for callers that cannot render the rows (the self-test's synthetic logs).
# Measured 2026-08-17 over the 27 live rendered digest rows:
#     min 156 · median 283 · p75 426 · p90 511 · p95 869 · MAX 886
# The old 300 sat between the median and p75 — i.e. it would have passed a spare that CANNOT
# fit ~35% of the corpus's own rows. Derived floor = the LARGEST row, because one row that does
# not fit is exactly the failure; a percentile would knowingly accept a tail that cannot land.
HEADROOM_FLOOR = 300          # fallback only — prefer the derived floor


def derive_row_floor(parts, fallback=HEADROOM_FLOOR):
    """Largest rendered DATA row across the digest parts, +1 for its newline.

    That is the binding quantity for "will the next row fit": pack() refuses when part 2
    exceeds the cap, and the worst single addition is the largest row. Data rows are the
    pipe-delimited lines that are neither the `|---|` separator nor a column header.
    Returns `fallback` when nothing renders, so a parse change degrades to the old constant
    rather than to an unguarded 0."""
    rows = []
    for part in parts or []:
        for l in part.split("\n"):
            if not l.startswith("| ") or l.startswith("|---"):
                continue
            low = l.lower()
            if low.startswith("| if you're about to") or low.startswith("| trigger "):
                continue
            rows.append(len(l) + 1)
    return max(rows) if rows else fallback


def analyze_log(records, headroom=None, floor=None):
    floor = HEADROOM_FLOOR if floor is None else floor
    """Classify digest health from log records. Pure — no I/O, so the self-test drives it.

    Returns a dict with a `verdict` in {UNKNOWN-MODE, NO-DATA, DEAD, DRAW-STOPPED, CLIFF,
    HEALTHY}. NO-DATA is its own verdict and is NOT a pass: a zero denominator makes every
    comparison below vacuously true, which is the shape that reports a green on an
    instrument that measured nothing.
    """
    era = [r for r in records if "budget" in r]
    seen = {r.get("mode") for r in era}
    unknown = sorted(m for m in seen if m not in KNOWN_MODES)
    attempted = [r for r in era if r.get("mode") in DIGEST_ATTEMPTED]
    digests = [r for r in attempted if r.get("mode") == "digest"]
    fallbacks = [r for r in attempted if r.get("mode") == "fallback_full_digest"]
    holdouts = [r for r in era if r.get("mode") == "full_holdout"]
    zeros = [r for r in era if r.get("mode") in NO_EMIT]
    # ⛔ ZERO-ARM TURNS **DO** REACH THE HOLDOUT DRAW, so they belong in this denominator. The
    # holdout draw returns FIRST in `decide()`; a zero turn is one that reached that draw and
    # lost it. Omitting them makes holdout_pct read HIGH against its 1-in-10 design rate — the
    # safe direction for the DRAW-STOPPED floor, and still wrong.
    draw_reaching = len(attempted) + len(holdouts) + len(zeros)
    eligible = attempted

    out = {
        "era_records": len(era), "eligible": len(eligible), "digests": len(digests),
        "fallbacks": len(fallbacks), "holdouts": len(holdouts), "zeros": len(zeros),
        "draw_reaching": draw_reaching, "holdout_pct": None, "unknown_modes": unknown,
        "headroom": headroom, "rate": None, "verdict": None, "why": None,
    }
    # An unrecognised mode means `decide()` grew a branch this file does not classify, so it is
    # landing in neither bucket and every rate below is computed over the wrong set. Loud, and
    # FIRST — a wrong denominator must not be reported as a healthy verdict.
    if unknown:
        out["verdict"] = "UNKNOWN-MODE"
        out["why"] = ("log carries mode(s) this file does not classify: %s. decide() grew a branch; "
                      "classify it as forced-full or digest-attempted before trusting any rate."
                      % ", ".join(unknown))
        return out
    if not attempted:
        out["verdict"] = "NO-DATA"
        out["why"] = ("zero turns where the digest was ATTEMPTED in the post-fix era — the rate is "
                      "undefined, not healthy. Nothing has been measured.")
        return out

    rate = 100.0 * len(digests) / len(attempted)
    out["rate"] = round(rate, 1)
    if draw_reaching:
        out["holdout_pct"] = round(100.0 * len(holdouts) / draw_reaching, 1)
    # 3-sigma binomial band around the design rate, over turns that REACH the draw.
    exp = HOLDOUT_DESIGN_RATE * draw_reaching
    sd = (draw_reaching * HOLDOUT_DESIGN_RATE * (1 - HOLDOUT_DESIGN_RATE)) ** 0.5
    lo = exp - HOLDOUT_SIGMA * sd

    if rate < DIGEST_RATE_FLOOR:
        out["verdict"] = "DEAD"
        out["why"] = (f"digest_rate {rate:.1f}% is under the {DIGEST_RATE_FLOOR:.0f}% floor over "
                      f"{len(attempted)} attempted turns — the ladder or the parser is refusing and "
                      f"the saving is silently gone ({len(fallbacks)} fallback_full_digest records).")
    elif draw_reaching >= MIN_DRAW_N and len(holdouts) < lo:
        out["verdict"] = "DRAW-STOPPED"
        out["why"] = (f"holdout share {out['holdout_pct']}% ({len(holdouts)} of {draw_reaching} "
                      f"draw-reaching turns) is below the 3-sigma floor of {lo:.1f} for a "
                      f"{HOLDOUT_DESIGN_RATE:.0%} design rate — the draw appears to have stopped, "
                      f"so there is no full-band control left.")
    elif headroom is not None and headroom < floor:
        out["verdict"] = "CLIFF"
        out["why"] = (f"digest_rate {rate:.1f}% is healthy, but headroom {headroom} is under "
                      f"{floor} (the LARGEST rendered row, derived) — so the next row "
                      f"added makes build_digest() return None fleet-wide, silently. "
                      f"NOTE: headroom is the LAST part's spare (the only part pack() can "
                      f"refuse on); before 2026-08-17 it read the largest part, which cannot "
                      f"fail, so pre-fix CLIFF verdicts measured a boundary artifact.")
    else:
        out["verdict"] = "HEALTHY"
        out["why"] = (f"digest_rate {rate:.1f}% over {len(attempted)} attempted turns; holdout "
                      f"{out['holdout_pct']}% of {draw_reaching} draw-reaching; headroom {headroom}.")
    return out


def read_log():
    recs = []
    try:
        with open(LOG, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    recs.append(json.loads(line))
                except ValueError:
                    continue
    except OSError as e:
        fail("cannot read %s: %s" % (LOG, e))
    return recs


def self_test():
    """RED control per verdict class, each differing from HEALTHY in ONE variable.

    ⛔ THE FIRST VERSION OF THIS SELF-TEST COULD NOT HAVE CAUGHT THE DEFECT IT WAS WRITTEN
    BESIDE. It built "eligible but not digest" turns out of `full_state` — a FORCED-FULL mode —
    which is precisely the misclassification the code had. Fixture and code were authored in
    one sitting from one belief, so they agreed with each other and the arms passed while the
    denominator was wrong. That is the premise-half failure, demonstrated rather than argued:
    a mutation-clean, fully-discriminating control set is still only ONE observation when it
    shares its premise with the thing it tests.

    The remedy is not better fixtures. It is that the LIVE LOG is an oracle this file did not
    author — so `oracle_live_log()` below asserts against it, and the mode vocabulary is
    derived from `decide()` rather than from imagination.
    """
    def recs(attempted, digest, holdouts=0, forced=40):
        """`attempted` turns where the digest was tried; the rest are genuine build failures.
        `forced` forced-full turns are added to prove they stay OUT of the denominator."""
        out = [{"budget": 60, "mode": "digest"} for _ in range(digest)]
        out += [{"budget": None, "mode": "fallback_full_digest"} for _ in range(attempted - digest)]
        out += [{"budget": None, "mode": "full_holdout"} for _ in range(holdouts)]
        # every forced-full mode represented, so a regression to "exclude only full_typed"
        # shows up as a changed denominator rather than passing silently
        for i, m in enumerate(sorted(FORCED_FULL - {"full_holdout"})):
            out += [{"budget": None, "mode": m}] * (forced // 5 if i < 5 else 0)
        return out

    cases = [
        # HEALTHY baseline: 100 attempted, 95 digests, holdout at design rate over 105 draw-reaching
        ("HEALTHY", recs(100, 95, holdouts=11), 500),
        # DEAD: differs from HEALTHY ONLY in the digest/fallback split
        ("DEAD", recs(100, 10, holdouts=11), 500),
        # DRAW-STOPPED: differs ONLY in holdout count (0 draws over a denominator past MIN_DRAW_N)
        ("DRAW-STOPPED", recs(100, 95, holdouts=0), 500),
        # CLIFF: differs from HEALTHY ONLY in headroom
        ("CLIFF", recs(100, 95, holdouts=11), 100),
        # NO-DATA: forced-full turns only — a zero denominator must not read as a pass
        ("NO-DATA", recs(0, 0, holdouts=0, forced=40), 500),
        # UNKNOWN-MODE: decide() grew a branch this file does not classify
        ("UNKNOWN-MODE", recs(100, 95, holdouts=11) + [{"budget": None, "mode": "full_brand_new"}], 500),
        # ZERO-ARM: a known mode must NOT trip UNKNOWN-MODE. Differs from HEALTHY only by the arm.
        ("HEALTHY", recs(100, 95, holdouts=11) + [{"budget": None, "mode": "none_zeroarm"}] * 11, 500),
    ]
    bad = 0
    for want, records, hr in cases:
        got = analyze_log(records, hr)["verdict"]
        ok = got == want
        print("  %-13s -> %-13s %s" % (want, got, "ok" if ok else "*** FAIL ***"))
        bad += 0 if ok else 1

    # ZERO-ARM DENOMINATOR ARMS, both directions, because the two sets pull opposite ways.
    _z = analyze_log(recs(100, 95, holdouts=11) + [{"budget": None, "mode": "none_zeroarm"}] * 11, 500)
    if _z["eligible"] != 100:
        print("  *** FAIL *** zero-arm turns leaked into the digest_rate denominator: %d != 100" % _z["eligible"]); bad += 1
    else:
        print("  %-13s -> %-13s ok" % ("zero/eligible", "100"))
    if _z["draw_reaching"] != 122:
        print("  *** FAIL *** zero-arm turns missing from draw_reaching: %d != 122" % _z["draw_reaching"]); bad += 1
    else:
        print("  %-13s -> %-13s ok" % ("zero/draws", "122"))

    # DENOMINATOR: the whole finding. Forced-full turns must not inflate it. Asserting the
    # NUMBER, because the old bug was invisible to a verdict check — it moved 85.1 vs 99.2
    # while every verdict still read HEALTHY.
    h = analyze_log(recs(100, 95, holdouts=11, forced=40), 500)
    if h["eligible"] != 100 or h["rate"] != 95.0:
        print("  denominator   -> eligible=%s rate=%s, expected 100/95.0 *** FAIL ***"
              % (h["eligible"], h["rate"]))
        bad += 1
    else:
        print("  denominator   -> forced-full excluded; 100 attempted, rate 95.0% ok")

    # Pollution: analyze_log is pure. Assert it did not touch the real log.
    before = os.path.getmtime(LOG) if os.path.exists(LOG) else None
    analyze_log(recs(100, 95, holdouts=11), 500)
    after = os.path.getmtime(LOG) if os.path.exists(LOG) else None
    if before != after:
        print("  pollution     -> analyze_log MUTATED the log *** FAIL ***")
        bad += 1
    else:
        print("  pollution     -> log untouched ok")

    # ⛔ THE BOUNDARY ARM — the control that would have caught MIN_DRAW_N = 30. Assert the
    # blind range is CLOSED: a totally dead draw must be undetectable at MIN_DRAW_N - 1 and
    # detectable at MIN_DRAW_N. Without both halves this passes on any large enough constant,
    # which is how a number that misses its own purpose by 2.7x survives a green self-test.
    n = MIN_DRAW_N
    below = analyze_log(recs(n - 1, n - 1, holdouts=0), 500)["verdict"]
    at = analyze_log(recs(n, n, holdouts=0), 500)["verdict"]
    if at == "DRAW-STOPPED" and below != "DRAW-STOPPED":
        print("  draw-boundary -> blind at n=%d, fires at n=%d (MIN_DRAW_N derived, not chosen) ok"
              % (n - 1, n))
    else:
        print("  draw-boundary -> n-1=%s n=%s, expected non-DRAW-STOPPED then DRAW-STOPPED "
              "*** FAIL ***" % (below, at))
        bad += 1

    # And the derivation must track its own parameters, or a future rate change strands it.
    for p, sigma, want in ((0.10, 3.0, 82), (0.11, 3.0, 73), (0.20, 3.0, 37)):
        got = _min_draw_n(p, sigma)
        if got != want:
            print("  draw-derivation -> p=%s sigma=%s gave %d, expected %d *** FAIL ***"
                  % (p, sigma, got, want))
            bad += 1
            break
    else:
        print("  draw-derivation -> tracks p and sigma (82 / 73 / 37) ok")

    bad += oracle_live_log()
    print("self-test: %s" % ("PASS" if bad == 0 else "FAIL (%d)" % bad))
    return 1 if bad else 0


def oracle_live_log():
    """The independent oracle: the live log, which this file did not author.

    Self-authored fixtures share a premise with the code they test. The real log does not —
    it is written by `decide()`, so it is the one corpus that can disagree. This asserts the
    log's mode vocabulary is a SUBSET of what this file classifies; a new `decide()` branch
    therefore fails here rather than silently landing in the wrong bucket.
    """
    if not os.path.exists(LOG):
        print("  live-oracle   -> log absent, SKIPPED (not a pass)")
        return 0
    seen = {r.get("mode") for r in read_log() if "budget" in r}
    seen.discard(None)
    unknown = sorted(m for m in seen if m not in KNOWN_MODES)
    if unknown:
        print("  live-oracle   -> live log carries unclassified mode(s): %s *** FAIL ***"
              % ", ".join(unknown))
        return 1
    print("  live-oracle   -> %d live modes, all classified (%s) ok"
          % (len(seen), ", ".join(sorted(seen))))
    return 0


def main():
    if "--self-test" in sys.argv:
        return self_test()
    body = extract_python()
    mod = types.ModuleType("band_o_extracted")
    mod.__dict__["__name__"] = "band_o_extracted"
    saved = sys.argv
    # argv: band_path, chunk, payload_path, root — payload /dev/null so nothing is read.
    sys.argv = ["band-o-extracted", BAND, "1", os.devnull, ROOT]
    try:
        exec(compile(body, "<band-o-inject.sh:PY>", "exec"), mod.__dict__)
    except Exception as e:  # noqa: BLE001 - any failure here must be loud, not silent
        fail("executing the extracted block raised %s: %s" % (type(e).__name__, e))
    finally:
        sys.argv = saved

    if CAP_SYMBOL not in mod.__dict__:
        fail("the hook no longer defines %s — the chunk cap moved; re-read band-o-inject.sh "
             "rather than trusting any number this script would print" % CAP_SYMBOL)
    cap = int(mod.__dict__[CAP_SYMBOL])
    digest = mod.__dict__["build_digest"]()
    band_bytes = mod.__dict__["band_bytes"]
    h8 = mod.__dict__["h8"]

    if digest is None:
        out = {
            "band_bytes": len(band_bytes), "band_md5_8": h8, "digest": None,
            "verdict": "DEAD — build_digest() returned None; every turn falls back to FULL",
        }
        print(json.dumps(out, indent=2) if "--json" in sys.argv else
              "band %d B (%s)\nDIGEST IS DEAD — build_digest() returned None.\n"
              "Every seat falls back to FULL: safe, but the entire saving is gone."
              % (len(band_bytes), h8))
        return 1

    # ⛔ build_digest() RETURNS A LIST OF CHUNKS since 2026-08-15 (the two-slot
    # digest). It used to return a str. `len()` and `.count()` are legal on BOTH, so this
    # script kept running and reported `digest_chars 2 / HEADROOM 9498` where the truth was
    # 9071 / 429 — i.e. it read MAXIMUM headroom at the moment the digest was nearest its
    # cap, and `truncated_output_side` fell to 0 because .count() on a list compares whole
    # ELEMENTS. A well-formed lie in the reassuring direction, for a day, while an OPEN
    # tracker note pointed the next reader here with "RE-DERIVE, never restate".
    # Its own --self-test returned PASS throughout: every arm exercises analyze_log(), none
    # the render path, so the positive control structurally could not see it.
    # NORMALIZE ONCE, HERE. The cap governs the LARGEST PART, never the join: pack()
    # returns [one] when len(one) <= DIGEST_CAP, else TWO parts each within the cap. So
    # headroom is cap - max(part). Joining and comparing to the per-part cap manufactures a
    # false alarm — measured while fixing this: the join reads 10,965 vs cap 9,500 and
    # reports HEADROOM -1465 on a digest that is delivering fine in two parts.
    _parts = [digest] if isinstance(digest, str) else list(digest)
    # ⛔ THIS READ THE WRONG PART UNTIL 2026-08-17, AND ITS OWN COMMENT ASSERTED THE
    # OPPOSITE. It was `max(_parts, key=len)  # the part the cap actually binds`, which
    # selects part 1 — the ONE PART THAT CANNOT FAIL. pack() greedy-fills part 1 to
    # cap1 and STOPS before the next row would exceed it, so part 1 never trips the cap
    # by construction; its remainder is bounded ABOVE by the size of whichever row did
    # not fit, i.e. a BOUNDARY ARTIFACT, not capacity. The only failure branch is
    # `if len(p2) > DIGEST_CAP: return None` (band-o-inject.sh, pack()). So the binding
    # part is the LAST one. Measured at the fix: parts [9587, 1857] at cap 9800 — the
    # old read announced "headroom 213" and fired CLIFF while the real spare was 7943,
    # about 28 median rows. The alarm was 37x pessimistic and drove a cap raise.
    # ⚠️ ONE-PART CASE: pack() returns [one] when it fits whole. Overflow there SPLITS
    # into two parts rather than failing, so a low reading is not a cliff — it is the
    # split becoming due. The two-part case is the one the floor is about.
    digest = _parts[-1]                    # the part pack() can actually REFUSE on
    _n_parts = len(_parts)
    _joined = "\n".join(_parts)            # for content counts that span parts

    items = mod.__dict__.get("_CAPTURED_ITEMS")
    if not items:
        fail("items capture did not fire — hook restructured")
    rung = mod.__dict__["DIGEST_BUDGET"]["v"]
    # ⛔ EVERY COUNT BELOW IS EXEMPTION-AWARE, AND WAS NOT UNTIL 2026-08-18. An EXEMPT row ships
    # its action WHOLE (see EXEMPT_TRIGGER_PREFIXES in band-o-inject.sh, applied at `apply_exempt`),
    # so `min(len(a), rung)` is simply the wrong shipped-length for it and `len(a) > rung` is the
    # wrong truncation test. Both defects ran in the same direction — UNDERSTATING what ships:
    #   pooled share  13.1% -> 23.6%   (1680 -> 3010 of 12779)      ~1.8x
    #   trunc_src        28 -> 25      (== the marker count; the cross-check MISMATCH was ours)
    # That direction is the expensive one. An open tracker note leans on the
    # pooled figure to argue the digest is DECORATIVE, and instructs the next reader to RE-DERIVE
    # here — so the instrument was handing that argument a number ~1.8x more alarming than the truth.
    # The cross-check was worse than wrong: it printed MISMATCH on healthy state every run, and a
    # cross-check that cries wolf gets learned-ignored, after which it cannot report the render/parse
    # divergence it exists to catch. Exemption count is DERIVED from the hook, never restated here.
    _ex_prefixes = mod.__dict__.get("EXEMPT_TRIGGER_PREFIXES", ())
    def _is_exempt(trig):
        return any(trig.startswith(p) for p in _ex_prefixes)
    _rows = [(v[0], v[1]) for t, v in items if t == "r"]
    acts = [a for _, a in _rows]
    total = sum(len(a) for a in acts)
    shipped = sum(len(a) if _is_exempt(t) else min(len(a), rung) for t, a in _rows)
    trunc_src = sum(1 for t, a in _rows if len(a) > rung and not _is_exempt(t))
    trunc_out = _joined.count(TRUNC_MARK)

    out = {
        "band_bytes": len(band_bytes),
        "band_md5_8": h8,
        "rung": rung,
        # digest_chars is the BINDING part (see the _parts[-1] note above), NOT the whole
        # digest — those differ once the digest splits. Both are reported so a reader
        # cannot mistake the binding part's size for the digest shrinking.
        "digest_chars": len(digest),
        "digest_total_chars": len(_joined),
        "digest_parts": _n_parts,
        "cap": cap,
        "headroom": cap - len(digest),
        "data_rows": len(acts),
        "truncated_source_side": trunc_src,
        "truncated_output_side": trunc_out,
        "median_action_cell": int(statistics.median(len(a) for a in acts)),
        "action_chars_shipped": shipped,
        "action_chars_total": total,
        "pooled_share_pct": round(100.0 * shipped / total, 1),
        # Exemption-aware for the same reason as `shipped` above: an exempt row ships 100% of its
        # action, so scoring it at min(len,rung)/len drags the median down with a fiction.
        "median_per_row_share_pct": round(
            statistics.median(sorted(
                100.0 * (len(a) if _is_exempt(t) else min(len(a), rung)) / len(a)
                for t, a in _rows)), 1),
    }
    # Cross-check: the source-side truncation count and an independent read of the shipped
    # bytes must agree. They are computed by different means on purpose — a disagreement
    # means the render and the parse have diverged, which no single count could reveal.
    out["cross_check"] = "OK" if trunc_src == trunc_out else "MISMATCH"

    if "--log" in sys.argv:
        out["row_floor"] = derive_row_floor(_parts)
        out["health"] = analyze_log(read_log(), out["headroom"], out["row_floor"])

    if "--json" in sys.argv:
        print(json.dumps(out, indent=2))
    else:
        print("band %(band_bytes)d B (%(band_md5_8)s) · rung %(rung)d" % out)
        print("digest %(digest_total_chars)d chars in %(digest_parts)d part(s) · "
              "BINDING part %(digest_chars)d / %(cap)d  ->  HEADROOM %(headroom)d" % out)
        print("rows %(data_rows)d · truncated %(truncated_source_side)d (source) / "
              "%(truncated_output_side)d (shipped bytes) [%(cross_check)s]" % out)
        print("median action cell %(median_action_cell)d chars" % out)
        print("action text shipped %(action_chars_shipped)d of %(action_chars_total)d = "
              "%(pooled_share_pct).1f%% pooled · %(median_per_row_share_pct).1f%% median per row" % out)
        if out["headroom"] < 300:
            print("\n⚠️  HEADROOM %(headroom)d — a median new Band-O row is ~258 chars. The next "
                  "row added\n    makes build_digest() return None and the digest dies "
                  "fleet-wide, SILENTLY\n    (fallback is FULL: safe, saving gone)." % out)
        if "health" in out:
            h = out["health"]
            print("\nLOG HEALTH  [%s]" % h["verdict"])
            print("  era records %(era_records)d · eligible %(eligible)d · digest %(digests)d · "
                  "holdout %(holdouts)d · fallback %(fallbacks)d" % h)
            print("  %s" % h["why"])
    if "health" in out and out["health"]["verdict"] not in ("HEALTHY",):
        return 1
    return 0 if out["cross_check"] == "OK" else 1


if __name__ == "__main__":
    sys.exit(main())
