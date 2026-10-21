#!/usr/bin/env python3
"""session-cache-usage.py — where this project's Claude Code sessions spend prompt-cache tokens.

Reads every transcript under ~/.claude/projects/<project-key>/ (main sessions at the top level,
sub-agents under <session>/subagents/) for the last --days and prints four read-only reports:

  totals    write / read / uncached split, hit rate, cost weights, by model and by chain kind
  rewrites  every full-prefix (re)write >= --big tokens classified by cause: first request,
            compaction, model switch, account switch (the credential_org changed — the prompt
            cache is per organization), usage-limit pause, remote-control change, idle > 1h
            (cache TTL), 5-60 min gap, or unexplained. Sub-agents write on the 5-minute TTL
            (measured 2026-09-25: 100% of agent writes, 0.5% of main-session writes), so an
            agent "gap 5-60 min" is its own TTL expiring, not an anomaly.
  hooks     bytes our hooks append (attachment records), and how much of the per-command
            shell-trap injection is a repeat of a trap already delivered to that context
  startup   what is delivered before a session's or agent's first request, by attachment type
            and by instruction file (the "always-loaded block"), medians

Every request is deduplicated on requestId (a streamed reply is several jsonl lines carrying the
same usage). Synthetic and API-error lines carry no usage and are skipped. Token figures that
come from BYTES divide by --bytes-per-token (default 4) and are FLOORS: a main session's first
request measures ~183k tokens for ~456 KB of delivered text (2.5 B/token on this markdown).
Cost weights use the Claude prompt-caching multipliers: 1h write 2x, 5m write 1.25x, read
0.025x (Fable) / 0.1x (Opus 5) of base input — pass --read-mult to change the read side.

Written 2026-09-23 from the cache-write investigation; numbers from the
first run are in the trap-dedupe commit.
"""
import argparse, collections, glob, json, os, re, statistics, sys, time
from datetime import datetime

def ts(d):
    try: return datetime.fromisoformat(d.get("timestamp").replace("Z", "+00:00")).timestamp()
    except Exception: return None

def load(root, cut):
    top = [f for f in glob.glob(root + "/*.jsonl") if os.path.getmtime(f) >= cut]
    sub = [f for f in glob.glob(root + "/**/*.jsonl", recursive=True) if f not in top and os.path.getmtime(f) >= cut]
    return top, sub

def chains(files, top, cut=None, reader=None):
    """(file, who) -> ordered list of request records; who = 'main' | agent id.
    reader: f -> a context manager yielding lines; defaults to opening the path. The seam exists so
    --self-test can feed in-memory fixtures through this SAME function (2026-09-26).
    cut: epoch seconds — records with a timestamp before it are skipped, so a transcript that is
    merely MODIFIED inside the window does not bring its older requests along (measured 2026-09-23:
    38% of "this week's" main requests were older than the week; agents were unaffected)."""
    out = collections.defaultdict(list); before = {}
    reader = reader or (lambda f: open(f, errors="replace"))
    for f in files:
        seen, pending_compact = set(), False
        org, pending_limit, pending_remote = None, False, False  # 2026-09-25: the three causes behind most "unexplained" rewrites
        # Per FILE, not per (file, who): safe only while a top-level transcript carries no isSidechain/agentId assistant
        # records (0 of 209,132 in the 7 days to 2026-09-25). If they return, key these flags by who.
        with reader(f) as fh:
            for line in fh:
                try: d = json.loads(line)
                except Exception: continue
                t = d.get("type"); a = d.get("attachment")
                if isinstance(a, dict) and a.get("type") == "credential_org": org = a.get("organizationUuid")
                if isinstance(a, dict) and a.get("type") == "remote_session_change": pending_remote = True
                if t == "system" and "Usage limit reached" in str(d.get("content")): pending_limit = True
                if t == "user":
                    c = (d.get("message") or {}).get("content")
                    s = c if isinstance(c, str) else (c[0].get("text", "") if isinstance(c, list) and c and isinstance(c[0], dict) else "")
                    if isinstance(s, str) and s.startswith("This session is being continued"): pending_compact = True
                    continue
                if t != "assistant": continue
                m = d.get("message") or {}; u = m.get("usage")
                if not u or m.get("model") == "<synthetic>" or d.get("isApiErrorMessage"): continue
                key = d.get("requestId") or m.get("id")
                if key in seen: continue
                seen.add(key)
                who = "main" if (f in top and not d.get("isSidechain") and not d.get("agentId")) else (d.get("agentId") or "side")
                cc = u.get("cache_creation") or {}
                rec = (dict(t=ts(d), w=u.get("cache_creation_input_tokens") or 0, r=u.get("cache_read_input_tokens") or 0,
                                          i=u.get("input_tokens") or 0, o=u.get("output_tokens") or 0, w5=cc.get("ephemeral_5m_input_tokens") or 0,
                                          w1=cc.get("ephemeral_1h_input_tokens") or 0, model=m.get("model"), comp=pending_compact, who=who,
                                          org=org, limit=pending_limit, remote=pending_remote))
                pending_compact = pending_limit = pending_remote = False
                if cut is not None and rec["t"] is not None and rec["t"] < cut: before[(f, who)] = rec; continue
                out[(f, who)].append(rec)
    for seq in out.values(): seq.sort(key=lambda r: r["t"] or 0)
    for k, p in before.items():  # a chain resumed inside the window: classify its first in-window request against its real predecessor
        if out.get(k): out[k][0]["prev"] = p
    return out

def tally(ch):
    """(total, by model, by kind) Counters of n / w / r / i / o / w5 / w1 over every request in ch."""
    tot = collections.Counter(); bym = collections.defaultdict(collections.Counter); byk = collections.defaultdict(collections.Counter)
    for (f, who), seq in ch.items():
        for r in seq:
            for C in (tot, bym[r["model"]], byk["main" if who == "main" else "agent"]):
                C["n"] += 1; C["w"] += r["w"]; C["r"] += r["r"]; C["i"] += r["i"]; C["o"] += r["o"]; C["w5"] += r["w5"]; C["w1"] += r["w1"]
    return tot, bym, byk

def hit_rate(C):
    """read / (read + write + uncached), or None when there was no input at all."""
    tin = C["w"] + C["r"] + C["i"]
    return C["r"] / tin if tin else None

def cost_weighted(tot, read_mult):
    """(write, read) cost in base-input-token equivalents: 1h write 2x, 5m write 1.25x, write tokens the
    usage record did not split by TTL 2x, read x read_mult."""
    wc = tot["w1"] * 2 + tot["w5"] * 1.25 + max(0, tot["w"] - tot["w1"] - tot["w5"]) * 2; rc = tot["r"] * read_mult
    return wc, rc

def report_totals(ch, read_mult):
    tot, bym, byk = tally(ch)
    print(f"requests={tot['n']:,}  write={tot['w']:,} (5m {tot['w5']:,} / 1h {tot['w1']:,})  read={tot['r']:,}  uncached={tot['i']:,}  output={tot['o']:,}")
    hr = hit_rate(tot)
    print(f"hit rate read/(read+write+uncached) = {hr:.1%}" if hr is not None else "no input")
    wc, rc = cost_weighted(tot, read_mult); spend = wc + rc + tot["i"]
    # An empty window (or --read-mult 0 over a reads-only window) used to die here on ZeroDivisionError.
    # Guard the share only: the per-kind / per-model rows below carry their own zero guard.
    if spend: print(f"cost-weighted (base-input-token equivalents, read x{read_mult}): writes {wc:,.0f} · reads {rc:,.0f} · uncached {tot['i']:,} -> writes are {wc/spend:.0%} of input spend")
    for label, C in list(byk.items()) + sorted(bym.items(), key=lambda kv: -kv[1]["w"]):
        t = C["w"] + C["r"] + C["i"]
        print(f"  {str(label):26s} n={C['n']:7,} write={C['w']:>14,} read={C['r']:>15,} hit={C['r']/t if t else 0:.1%}")

def classify(ch, big):
    ev = collections.Counter(); tok = collections.Counter()
    for (f, who), seq in ch.items():
        for i, rec in enumerate(seq):
            p = seq[i - 1] if i else rec.get("prev")
            if p is None: c = "first request"
            else:
                prev = p["r"] + p["w"]; gap = (rec["t"] - p["t"]) if rec["t"] and p["t"] else 0
                if rec["comp"]: c = "after compaction"
                elif p["model"] != rec["model"]: c = "model switch"
                elif prev >= 20000 and rec["r"] / prev < 0.1:
                    # Checked before the gap buckets: a limit pause or an account switch CAUSES the gap it sits in.
                    # Most sub-agent transcripts log no credential_org (one-off split: 606.8M of 759.9M agent write tokens, 7 days to
                    # 2026-09-25), so most of their account switches still land in the gap/unexplained buckets — measured clustering
                    # 4x around fleet switch moments. The limit label carries its gap: a pause over 1h would also have expired the cache.
                    if rec.get("org") and p.get("org") and rec["org"] != p["org"]: c = "account switch"
                    elif rec.get("limit"): c = "usage-limit pause (gap > 1h)" if gap > 3600 else "usage-limit pause (gap <= 1h)"
                    elif rec.get("remote"): c = "remote-control change"
                    else: c = "idle > 1h (TTL expired)" if gap > 3600 else ("gap 5-60 min" if gap > 300 else "unexplained mid-session")
                else: c = None
            if c is None or rec["w"] < big: continue
            k = ("main" if who == "main" else "agent", c); ev[k] += 1; tok[k] += rec["w"]
    return ev, tok

def report_rewrites(ch, big):
    ev, tok = classify(ch, big); total = sum(tok.values())
    print(f"full-prefix (re)writes >= {big:,} tokens: {sum(ev.values()):,} events, {total:,} write tokens")
    for (who, c), n in sorted(ev.items(), key=lambda kv: -tok[kv[0]]):
        print(f"  {who:5s} {c:31s} n={n:5d}  {tok[(who, c)]:>14,} tok  {tok[(who,c)]/total:5.1%}")

def report_hooks(files, cut=None):
    by_b = collections.Counter(); by_n = collections.Counter(); trap = collections.Counter()
    for f in files:
        seen = set()
        with open(f, errors="replace") as fh:
            for line in fh:
                if '"attachment"' not in line[:300]: continue
                try: d = json.loads(line)
                except Exception: continue
                if d.get("type") != "attachment": continue
                if cut is not None and (ts(d) or cut) < cut: continue
                a = d.get("attachment") or {}; t = a.get("type")
                c = a.get("content"); txt = c if isinstance(c, str) else "".join((x.get("text", "") if isinstance(x, dict) else str(x)) for x in (c or []))
                n = len(txt) if t == "hook_additional_context" else len(a.get("stdout") or "")
                key = f"{t}:{a.get('hookName') or ''}"; by_b[key] += n; by_n[key] += 1
                if t == "hook_additional_context" and a.get("hookName") == "PreToolUse:Bash" and "SHELL TRAPS" in txt:
                    trap["fires"] += 1; new = 0
                    for p in re.split(r"\n(?=- |## )", txt):
                        p = p.strip()
                        if not p or p.startswith("SHELL TRAPS"): continue
                        k = p[:60]
                        if k in seen: trap["repeat_b"] += len(p)
                        else: seen.add(k); trap["first_b"] += len(p); new += 1
                    if new == 0: trap["empty_fires"] += 1
    print("hook-delivered bytes by source (top 12):")
    for k, n in by_b.most_common(12): print(f"  {by_n[k]:7,}x  {n:>13,} B  avg {n // max(1, by_n[k]):>6,} B  {k}")
    if trap["fires"]:
        tb = trap["first_b"] + trap["repeat_b"]
        print(f"shell-trap injection: {trap['fires']:,} fires, {trap['empty_fires']:,} ({trap['empty_fires']/trap['fires']:.0%}) carried nothing new; repeat bytes {trap['repeat_b']:,} of {tb:,} ({trap['repeat_b']/tb:.0%})")

def report_startup(top, sub, limit, cut=None):
    def strbytes(o):
        if isinstance(o, str): return len(o)
        if isinstance(o, dict): return sum(strbytes(v) for v in o.values())
        if isinstance(o, list): return sum(strbytes(v) for v in o)
        return 0
    def one(f):
        by = collections.Counter(); files = collections.Counter()
        with open(f, errors="replace") as fh:
            for line in fh:
                try: d = json.loads(line)
                except Exception: continue
                if d.get("type") == "assistant": break
                if cut is not None and (ts(d) or cut) < cut: return None, None  # transcript began before the window
                if d.get("type") == "user": by["user message"] += strbytes((d.get("message") or {}).get("content")); continue
                if d.get("type") != "attachment": continue
                a = d.get("attachment") or {}; t = a.get("type")
                if t == "hook_success": by[f"hook_success:{a.get('hookName')}"] += len(a.get("stdout") or "")
                else: by[t] += strbytes({k: v for k, v in a.items() if k not in ("type", "hookName", "hookEvent", "toolUseID")})
                if t == "instructions":
                    for fl in (a.get("files") or []):
                        if isinstance(fl, dict): files[os.path.basename(str(fl.get("path") or fl.get("filename") or "?"))] += strbytes(fl.get("content") or fl.get("text") or "")
        return by, files
    for label, fs in (("MAIN sessions", top), ("SUB-AGENTS", sub[:limit])):
        agg = collections.defaultdict(list); fagg = collections.defaultdict(list); n = 0
        for f in fs:
            by, fl = one(f)
            if by is None: continue
            n += 1
            for k, v in by.items(): agg[k].append(v)
            for k, v in fl.items(): fagg[k].append(v)
        if not n: continue
        print(f"{label}: n={n} · median bytes before the first request ≈ {sum(statistics.median(v) for v in agg.values()):,.0f}")
        for k, v in sorted(agg.items(), key=lambda kv: -statistics.median(kv[1]))[:10]: print(f"   {statistics.median(v):>10,.0f} B  (in {len(v)}/{n})  {k}")
        for k, v in sorted(fagg.items(), key=lambda kv: -statistics.median(kv[1])): print(f"      file {statistics.median(v):>9,.0f} B  (in {len(v)}/{n})  {k}")

def self_test():
    """Fixture regression over the REAL chains / classify / tally / hit_rate / cost_weighted / report_totals,
    fed in-memory transcripts through chains()'s reader seam. Reads no transcript, writes nothing."""
    import contextlib, io
    failures = []

    def check(name, got, expected):
        ok = got == expected
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}\n         expected {expected!r}, got {got!r}")
        if not ok: failures.append(name)

    T0 = datetime.fromisoformat("2026-09-20T00:00:00+00:00").timestamp()
    iso = lambda sec: datetime.fromtimestamp(T0 + sec, tz=__import__("datetime").timezone.utc).isoformat().replace("+00:00", "Z")
    def asst(req, sec, w=0, r=0, i=0, o=0, w1=None, model="claude-opus-5", **extra):
        u = {"cache_creation_input_tokens": w, "cache_read_input_tokens": r, "input_tokens": i, "output_tokens": o,
             "cache_creation": {"ephemeral_1h_input_tokens": w if w1 is None else w1, "ephemeral_5m_input_tokens": 0 if w1 is None else w - w1}}
        return json.dumps(dict(type="assistant", requestId=req, timestamp=iso(sec), message={"model": model, "usage": u, "id": "m" + req}, **extra))
    org = lambda o: json.dumps({"type": "attachment", "timestamp": iso(0), "attachment": {"type": "credential_org", "organizationUuid": o}})
    H = 3600
    main_t = [
        org("A"),
        asst("q1", 0, w=150000, i=10, o=5),                          # first request
        asst("q1", 0, w=150000, i=10, o=5),                          # streamed duplicate -> deduplicated
        asst("syn", 5, w=999999, model="<synthetic>"),               # synthetic -> skipped
        asst("err", 6, w=999999, isApiErrorMessage=True),            # API error -> skipped
        asst("q2", 60, w=1000, r=150000),                            # warm hit, not a rewrite
        org("B"),
        asst("q3", 2 * H, w=160000),                                 # gap > 1h AND org changed -> account switch wins
        json.dumps({"type": "user", "timestamp": iso(2 * H + 30), "message": {"content": "This session is being continued from a previous conversation"}}),
        asst("q4", 2 * H + 60, w=120000),                            # after compaction
        asst("q5", 2 * H + 120, w=110000, model="claude-sonnet-5"),  # model switch
        asst("q6", 2 * H + 120 + 38 * 60, w=105000, model="claude-sonnet-5"),   # gap 5-60 min
        json.dumps({"type": "system", "timestamp": iso(3 * H), "content": "Usage limit reached"}),
        asst("q7", 2 * H + 180 + 38 * 60, w=104000, model="claude-sonnet-5"),   # usage-limit pause, gap <= 1h
        asst("q8", 2 * H + 240 + 38 * 60, w=50000, model="claude-sonnet-5"),    # a rewrite, but under --big
        asst("q9", 2 * H + 300 + 38 * 60, w=130000, model="claude-sonnet-5"),   # unexplained mid-session
    ]
    resumed_t = [
        asst("a1", -10 * 86400, w=150000),                           # before the cut: not counted, but the predecessor
        asst("a2", 5 * H, w=140000),                                 # first IN-WINDOW request -> idle > 1h, not "first request"
    ]
    agent_t = [asst("g1", 100, w=200000, agentId="x", isSidechain=True)]
    fx = {"/fx/main.jsonl": main_t, "/fx/resumed.jsonl": resumed_t, "/fx/s/subagents/agent-x.jsonl": agent_t,
          "/fx/garbage.jsonl": ["not json", "", '{"type": "assistant", "message": {"model": "m"}}']}
    reader = lambda f: io.StringIO("\n".join(fx[f]) + "\n")
    top = {"/fx/main.jsonl", "/fx/resumed.jsonl"}
    cut = T0 - 5 * 86400

    ch = chains(list(fx), top, cut, reader=reader)
    print("ARM 1 - chains: dedupe on requestId, skip synthetic / API-error / usage-less, split main vs agent, apply the cut")
    check("chain keys", sorted(ch), sorted([("/fx/main.jsonl", "main"), ("/fx/resumed.jsonl", "main"), ("/fx/s/subagents/agent-x.jsonl", "x")]))
    check("main chain request offsets, in time order (q1 once, syn / err absent)",
          [round(r["t"] - T0) for r in ch[("/fx/main.jsonl", "main")]],
          [0, 60, 2 * H, 2 * H + 60, 2 * H + 120, 2 * H + 120 + 38 * 60, 2 * H + 180 + 38 * 60, 2 * H + 240 + 38 * 60, 2 * H + 300 + 38 * 60])
    check("resumed chain keeps only the in-window request, carrying its real predecessor",
          [(r["w"], (r.get("prev") or {}).get("w")) for r in ch[("/fx/resumed.jsonl", "main")]], [(140000, 150000)])

    print("\nARM 2 - classify: every cause bucket, in precedence order, --big 100000")
    ev, tok = classify(ch, 100000)
    check("events", dict(ev), {
        ("main", "first request"): 1, ("main", "account switch"): 1, ("main", "after compaction"): 1,
        ("main", "model switch"): 1, ("main", "gap 5-60 min"): 1, ("main", "usage-limit pause (gap <= 1h)"): 1,
        ("main", "unexplained mid-session"): 1, ("main", "idle > 1h (TTL expired)"): 1, ("agent", "first request"): 1})
    check("tokens: account switch carries q3's write", tok[("main", "account switch")], 160000)
    check("total rewrite tokens", sum(tok.values()), 150000 + 160000 + 120000 + 110000 + 105000 + 104000 + 130000 + 140000 + 200000)

    print("\nARM 3 - totals: counts, hit rate, cost weights")
    tot, bym, byk = tally(ch)
    check("request count (11: a duplicate, synthetic or API-error line would make it 12+)", tot["n"], 11)
    check("main / agent split", (byk["main"]["n"], byk["agent"]["n"]), (10, 1))
    C = collections.Counter(w=1000, w5=400, w1=100, r=10000, i=500)
    check("hit rate = read / (read + write + uncached)", hit_rate(C), 10000 / 11500)
    check("cost weights: 100x2 + 400x1.25 + unsplit 500x2, reads x0.025 (dropping the unsplit remainder gives 700)",
          cost_weighted(C, 0.025), (1700.0, 250.0))

    print("\nARM 4 - empty / malformed input is REPORTED, never turned into a number")
    empty = chains(["/fx/garbage.jsonl"], set(), None, reader=reader)
    check("garbage-only transcript yields no chains", dict(empty), {})
    check("hit rate of nothing is None, not 0", hit_rate(tally(empty)[0]), None)
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf): report_totals(empty, 0.025)
        got = "no input" if "no input" in buf.getvalue() and "writes are" not in buf.getvalue() else buf.getvalue()
    except ZeroDivisionError:
        got = "ZeroDivisionError"
    check("report_totals on an empty window says 'no input' and prints no share", got, "no input")
    ro = {("/fx/r.jsonl", "main"): [dict(t=T0, w=0, r=5000, i=0, o=1, w5=0, w1=0, model="claude-opus-5")]}
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf): report_totals(ro, 0)
    check("reads-only window at --read-mult 0: no share line, per-kind rows still printed",
          ("writes are" in buf.getvalue(), "\n  main " in buf.getvalue()), (False, True))

    print(f"\n{'FAIL' if failures else 'PASS'} - {len(failures)} failure(s)")
    return 1 if failures else 0

REPORTS = ("totals", "rewrites", "hooks", "startup")

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    # No choices= here: with nargs="*" the python 3.9 argparse (/usr/bin/python3 on this machine) checks the
    # whole DEFAULT list against choices and rejects it, so a bare invocation died with "invalid choice"
    # before 2026-09-26. Validated by hand below instead.
    ap.add_argument("reports", nargs="*", metavar="report", help=f"any of {', '.join(REPORTS)} (default: all)")
    ap.add_argument("--days", type=float, default=7); ap.add_argument("--big", type=int, default=100000)
    ap.add_argument("--read-mult", type=float, default=0.025); ap.add_argument("--agent-sample", type=int, default=300)
    ap.add_argument("--root", default=os.path.expanduser("~/.claude/projects/<project-key>"))
    ap.add_argument("--self-test", action="store_true", help="fixture regression over the real functions; reads no transcript")
    a = ap.parse_args()
    if a.self_test: sys.exit(self_test())
    a.reports = a.reports or list(REPORTS)
    bad = [r for r in a.reports if r not in REPORTS]
    if bad: ap.error(f"invalid report(s) {', '.join(bad)} (choose from {', '.join(REPORTS)})")
    cut = time.time() - a.days * 86400
    top, sub = load(a.root, cut)
    print(f"# {a.root} · last {a.days:g} days · {len(top)} main transcripts · {len(sub)} agent transcripts")
    ch = None
    for r in a.reports:
        print(f"\n## {r}")
        if r in ("totals", "rewrites") and ch is None: ch = chains(top + sub, set(top), cut)
        if r == "totals": report_totals(ch, a.read_mult)
        elif r == "rewrites": report_rewrites(ch, a.big)
        elif r == "hooks": report_hooks(top + sub, cut)
        elif r == "startup": report_startup(top, sub, a.agent_sample, cut)

if __name__ == "__main__":
    main()
