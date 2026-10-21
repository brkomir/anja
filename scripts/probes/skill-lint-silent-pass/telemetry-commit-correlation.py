# Can any of the 332 unparsed-class check events be tied to a pre-commit run (= via skill-lint)?
# A pre-commit hook runs skill-lint, which runs `check`, seconds BEFORE the commit object is written.
# Test: fraction of events with a commit timestamp in [ts, ts+W], for the 332 set vs the whole check
# population (the baseline). If the two rates match, the window cannot discriminate and the claim is
# UNMEASURED; if the 332 rate is clearly above baseline, that excess is a floor.
import json, sys, datetime, bisect
epochs = sorted(int(x) for x in open(sys.argv[1]) if x.strip())
rows = []
for line in open(".claude/logs/architecture-doc-drift.jsonl", encoding="utf-8"):
    line = line.strip()
    if not line: continue
    try: r = json.loads(line)
    except Exception: continue
    if r.get("command") != "check": continue
    ts = datetime.datetime.fromisoformat(r["ts"].replace("Z", "+00:00")).timestamp()
    rows.append((ts, r))
g = lambda r, k: int(r.get(k) or 0)
allc = rows
gap = [(ts, r) for ts, r in rows if g(r,"drift_count")==0 and g(r,"banner_drift_count")==0 and g(r,"listing_finding_count")==0 and (g(r,"coverage_finding_count")>0 or g(r,"anchor_rot_count")>0)]
clean = [(ts, r) for ts, r in rows if all(g(r,k)==0 for k in ("drift_count","banner_drift_count","listing_finding_count","coverage_finding_count","anchor_rot_count"))]
def rate(evs, W):
    hit = 0
    for ts, _ in evs:
        i = bisect.bisect_left(epochs, int(ts))
        if i < len(epochs) and epochs[i] - ts <= W: hit += 1
    return hit, len(evs), (hit/len(evs) if evs else 0)
print("check events", len(allc), "| unparsed-only", len(gap), "| fully clean", len(clean), "| commits", len(epochs))
for W in (3, 5, 10, 20):
    a = rate(allc, W); u = rate(gap, W); c = rate(clean, W)
    print(f"W={W:>2}s  all {a[0]}/{a[1]} = {a[2]:.2f}   unparsed-only {u[0]}/{u[1]} = {u[2]:.2f}   clean {c[0]}/{c[1]} = {c[2]:.2f}")
