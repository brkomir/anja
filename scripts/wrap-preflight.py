#!/usr/bin/env python3
"""wrap-preflight — measure OOM risk BEFORE a /wrap deep-pass spawns agents.

WHY THIS EXISTS
  2026-07-27: an OS-level OOM crash killed a live /wrap. The first diagnosis put it on
  transcript BYTES (base64 lines inflating line-based slices) and the fix changed the
  slicing: strip base64, slice by bytes, clamp concurrency to 6.

  2026-07-29 measurement says that diagnosis is HALF the mechanism, and not the
  dominant half. On the machine measured:

      stripped slice per agent .......   7.8 MB
      agent CONTEXT per agent ........ ~646 MB   (a full `claude` process)

  The slice is ~1% of what an agent actually costs. The term that dominates is
  AGENT COUNT x CONTEXT SIZE, and it is multiplied by a baseline nobody measured:
  10 concurrent `claude` processes already resident (6.31 GB) plus a 19h-old dev
  server (1.28 GB), with swap 87.5% consumed.

  So the clamp 14 -> 6 is the fix that mattered, and it is justified in the
  spec by the wrong variable. The strip is still correct and still worth doing
  (it is free); it is simply not what stands between a wrap and an OOM.

WHAT THIS MEASURES
  transcript  : raw bytes, base64 bytes, stripped bytes, widest residual line
  slicing     : slices at 2MB, after the hard clamp, bytes per agent
  machine     : free+inactive RAM, swap free, resident `claude` count + RSS
  projection  : agents x observed mean context vs available headroom

  Emits GO / CAUTION / ABORT. Read-only: measures, never kills or edits.

USAGE
  python3 scripts/wrap-preflight.py [--sid <session-id>] [--agents N] [--json]
  python3 scripts/wrap-preflight.py --self-test
"""
import argparse, json, os, re, subprocess, sys

PROJECT_DIR = os.path.expanduser("~/.claude/projects/<project-key>")
SLICE_TARGET = 2_000_000      # spec: ~2 MB NET window-fit slice (wrap SKILL.md)
AGENT_CLAMP = 10              # spec: concurrency ceiling 10 (raised from 6; this constant once sat stale at 6)
GB = 1073741824


# The deep-pass strip BLANKS each image payload and keeps the line (wrap/SKILL.md and
# deep-pass/SKILL.md, blankBase64Payloads in scripts/wrap-reconcile.mjs). This function used the
# older DELETE model (the whole base64-bearing line counted as stripped) until 2026-09-15, so on an
# image-heavy session it under-reported the stripped corpus: measured 62.6 MB against a true 149.9 MB on a
# transcript with 370 base64 lines, failing toward GO on the instrument meant to stop an OOM. The payload
# sits under TWO keys, `source.data` and `toolUseResult.file.base64`.
B64_PAYLOAD = re.compile(rb'"(data|base64)":"[^"]{200,}"')


def transcript_bytes(path):
    """(raw, base64_bytes_removed, widest_residual_line). Streams — never loads the file.

    base64_bytes_removed is what blanking the payloads takes out; a blanked line is still
    a residual line and counts toward widest."""
    raw = b64 = widest = 0
    with open(path, "rb") as fh:
        for line in fh:
            n = len(line)
            raw += n
            kept = n
            if b'"type":"base64"' in line:
                kept = len(B64_PAYLOAD.sub(rb'"\1":"<stripped>"', line))
                b64 += n - kept
            if kept > widest:
                widest = kept
    return raw, b64, widest


def machine():
    total = int(subprocess.check_output(["sysctl", "-n", "hw.memsize"]).strip())
    vm = subprocess.check_output(["vm_stat"]).decode()
    ps = int(re.search(r"page size of (\d+)", vm).group(1))

    def pages(key):
        m = re.search(rf"{key}:\s+(\d+)", vm)
        return int(m.group(1)) * ps if m else 0

    avail = pages("Pages free") + pages("Pages inactive") + pages("Pages speculative")
    swap = subprocess.check_output(["sysctl", "-n", "vm.swapusage"]).decode()
    sfree = float(re.search(r"free\s*=\s*([\d.]+)M", swap).group(1)) * 1048576
    stotal = float(re.search(r"total\s*=\s*([\d.]+)M", swap).group(1)) * 1048576
    return total, avail, sfree, stotal


def claude_processes():
    """(count, total_rss_bytes, mean_rss_bytes) for resident `claude` processes."""
    out = subprocess.check_output(["ps", "-axo", "rss,comm"]).decode().splitlines()
    rss = [int(l.split(None, 1)[0]) * 1024 for l in out[1:]
           if l.split(None, 1)[1:] and l.split(None, 1)[1].strip() == "claude"]
    if not rss:
        return 0, 0, 0
    return len(rss), sum(rss), sum(rss) // len(rss)


def assess(stripped, agents, avail, sfree, stotal, mean_ctx):
    """Return (verdict, reasons). ABORT > CAUTION > GO. Pure — self-testable.

    ⚠️ KNOWN DEFECT (2026-07-29):
    mean_ctx is sampled at PRE-DISPATCH IDLE and multiplied by agent count. A
    dispatched agent loads a slice and grows well past idle, so this projection
    systematically UNDER-states and skews toward GO — which is what it did for
    the 6-agent wave that preceded an OOM. A separate measurement found 6.30 GB for one
    process where this box currently shows 1.31 GB max, so the true multiplier
    is unpinned in BOTH directions; neither figure is a constant.
    Until a dispatch-time RSS sampler lands, treat GO here as NECESSARY, NOT
    SUFFICIENT, and honor the /wrap SKILL.md concurrency ceiling (now 10) as the
    binding limit rather than this verdict.
    """
    reasons = []
    projected = agents * mean_ctx
    swap_used_pct = (1 - sfree / stotal) * 100 if stotal else 0

    if projected > avail:
        reasons.append(("ABORT", f"projected agent cost {projected/GB:.1f} GB exceeds "
                                 f"available {avail/GB:.1f} GB"))
    elif projected > avail * 0.5:
        reasons.append(("CAUTION", f"projected {projected/GB:.1f} GB is >50% of "
                                   f"available {avail/GB:.1f} GB"))

    if swap_used_pct >= 85:
        reasons.append(("CAUTION", f"swap {swap_used_pct:.0f}% consumed — the machine "
                                   f"is already paging; an OOM kill lands here first"))

    if stripped > 100_000_000:
        reasons.append(("CAUTION", f"stripped transcript {stripped/1048576:.0f} MB is "
                                   f"large even after the base64 strip"))

    verdict = "GO"
    for level, _ in reasons:
        if level == "ABORT":
            verdict = "ABORT"
            break
        verdict = "CAUTION"
    return verdict, reasons


def self_test():
    """RED controls per claim class — each MUST flip the verdict it targets."""
    fails = []

    v, _ = assess(40_000_000, 6, 20 * GB, 6 * GB, 7 * GB, 646 * 1048576)
    if v != "GO":
        fails.append(f"healthy machine should be GO, got {v}")

    v, r = assess(40_000_000, 6, 2 * GB, 6 * GB, 7 * GB, 646 * 1048576)
    if v != "ABORT":
        fails.append(f"agent cost over available should ABORT, got {v}")

    v, r = assess(40_000_000, 6, 20 * GB, 0.5 * GB, 7 * GB, 646 * 1048576)
    if v != "CAUTION" or not any("swap" in m for _, m in r):
        fails.append(f"swap-exhausted should CAUTION with a swap reason, got {v} {r}")

    v, r = assess(200_000_000, 6, 20 * GB, 6 * GB, 7 * GB, 646 * 1048576)
    if v != "CAUTION" or not any("stripped transcript" in m for _, m in r):
        fails.append(f"huge stripped transcript should CAUTION, got {v} {r}")

    # streaming byte-accounting against a known fixture
    # Derive the expectation from the bytes actually written — never hand-count.
    # (Hand-counted constants failed this test on first run: the fixture was
    #  right and my arithmetic was wrong, which is the error class the whole
    #  instrument exists to catch.)
    import tempfile
    # Both payload keys on one record (the tool-result shape), so a `data`-only pattern leaves 500
    # payload bytes behind and fails the b64 figure; the blanked line must survive as the widest.
    pay = b"A" * 500
    b64_line = (b'{"type":"base64","data":"' + pay + b'","toolUseResult":{"file":{"base64":"'
                + pay + b'"}},"text":"owner words"}\n')
    blanked = b'{"type":"base64","data":"<stripped>","toolUseResult":{"file":{"base64":"<stripped>"}},"text":"owner words"}\n'
    txt_line = b'{"type":"text","d":"hello"}\n'
    with tempfile.NamedTemporaryFile("wb", suffix=".jsonl", delete=False) as fh:
        fh.write(b64_line)
        fh.write(txt_line)
        p = fh.name
    raw, b64, widest = transcript_bytes(p)
    os.unlink(p)
    want = (len(b64_line) - len(blanked), len(b64_line) + len(txt_line), max(len(blanked), len(txt_line)))
    if (b64, raw, widest) != want:
        fails.append(f"byte accounting wrong: b64={b64} raw={raw} widest={widest} (expected {want[0]}/{want[1]}/{want[2]})")

    if fails:
        print("SELF-TEST FAILED:")
        for f in fails:
            print("  x", f)
        return 1
    print("self-test: 5/5 PASS (1 GO control, 3 RED controls, 1 byte-accounting fixture)")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sid", default=os.environ.get("CLAUDE_CODE_SESSION_ID"))
    ap.add_argument("--agents", type=int, default=None)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()

    if a.self_test:
        return self_test()

    if not a.sid:
        print("no --sid and CLAUDE_CODE_SESSION_ID unset", file=sys.stderr)
        return 2
    tx = os.path.join(PROJECT_DIR, f"{a.sid}.jsonl")
    if not os.path.exists(tx):
        print(f"transcript not found: {tx}", file=sys.stderr)
        return 2

    raw, b64, widest = transcript_bytes(tx)
    stripped = raw - b64
    slices = -(-stripped // SLICE_TARGET)
    agents = a.agents if a.agents else min(slices, AGENT_CLAMP)
    total, avail, sfree, stotal = machine()
    n_claude, rss_claude, mean_ctx = claude_processes()
    if mean_ctx == 0:
        mean_ctx = 646 * 1048576  # observed fleet mean, fallback only

    verdict, reasons = assess(stripped, agents, avail, sfree, stotal, mean_ctx)

    if a.json:
        print(json.dumps({
            "verdict": verdict, "raw": raw, "base64": b64, "stripped": stripped,
            "widest_line": widest, "slices": slices, "agents": agents,
            "avail": avail, "swap_free": sfree, "claude_procs": n_claude,
            "claude_rss": rss_claude, "mean_ctx": mean_ctx,
            "reasons": [{"level": l, "msg": m} for l, m in reasons],
        }, indent=2))
        return 0

    print("=== TRANSCRIPT ===")
    print(f"  raw            {raw/1048576:8.1f} MB")
    print(f"  base64         {b64/1048576:8.1f} MB  ({b64/raw*100:.1f}% of bytes)")
    print(f"  stripped       {stripped/1048576:8.1f} MB  <- the deep-pass input")
    print(f"  widest line    {widest/1048576:8.2f} MB  (post-strip residual)")
    print("\n=== SLICING ===")
    print(f"  slices @{SLICE_TARGET/1e6:g}MB  {slices}")
    print(f"  agents (clamp {AGENT_CLAMP})  {agents}")
    print(f"  slice/agent    {stripped/agents/1048576:8.1f} MB")
    print("\n=== MACHINE ===")
    print(f"  RAM            {total/GB:8.1f} GB")
    print(f"  free+inactive  {avail/GB:8.1f} GB")
    print(f"  swap free      {sfree/GB:8.2f} GB of {stotal/GB:.1f} GB "
          f"({(1-sfree/stotal)*100:.0f}% used)")
    print(f"  claude procs   {n_claude:8d}  ({rss_claude/GB:.2f} GB, mean {mean_ctx/1048576:.0f} MB)")
    print("\n=== PROJECTION ===")
    print(f"  {agents} agents x {mean_ctx/1048576:.0f} MB context = {agents*mean_ctx/GB:.1f} GB added")
    print(f"  slice bytes contribute {stripped/1048576:.0f} MB total — ~"
          f"{stripped/(agents*mean_ctx)*100:.0f}% of the agent cost")
    print(f"\n=== VERDICT: {verdict} ===")
    for level, msg in reasons:
        print(f"  [{level}] {msg}")
    if verdict == "GO":
        print("  headroom is sufficient for the deep-pass as specced")
    return 0


if __name__ == "__main__":
    sys.exit(main())
