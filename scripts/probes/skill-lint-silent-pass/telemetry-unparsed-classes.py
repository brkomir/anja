import json, sys
p = ".claude/logs/architecture-doc-drift.jsonl"
rows = []
with open(p, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try: rows.append(json.loads(line))
        except Exception: pass
checks = [r for r in rows if r.get("command") == "check"]
print("rows", len(rows), "check-events", len(checks), "first", checks[0]["ts"] if checks else None, "last", checks[-1]["ts"] if checks else None)
g = lambda r, k: int(r.get(k) or 0)
parsed_zero = [r for r in checks if g(r,"drift_count")==0 and g(r,"banner_drift_count")==0 and g(r,"listing_finding_count")==0]
gap = [r for r in parsed_zero if g(r,"coverage_finding_count")>0 or g(r,"anchor_rot_count")>0]
exit1 = [r for r in checks if any(g(r,k)>0 for k in ("drift_count","banner_drift_count","listing_finding_count","coverage_finding_count","anchor_rot_count"))]
print("check-events that exited 1 (any category nonzero):", len(exit1))
print("of those, invisible to skill-lint (only coverage/anchor nonzero):", len(gap))
if gap:
    print("  first", gap[0]["ts"], "last", gap[-1]["ts"])
    from collections import Counter
    print("  by (coverage>0, anchor>0):", Counter((g(r,"coverage_finding_count")>0, g(r,"anchor_rot_count")>0) for r in gap))
keys = set(); [keys.update(r.keys()) for r in checks]
print("keys seen on check events:", sorted(keys))
