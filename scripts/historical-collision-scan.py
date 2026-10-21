#!/usr/bin/env python3
"""historical-collision-scan.py — forensic detector for past parallel-session clobbers.

Phase 0 of parallel-session collision prevention. One-time owner-invocable scan.

For each pair of overlapping session jsonls in ~/.claude/projects/<key>/, runs
`git log` on shared coordination files within the overlap window and flags
candidate clobber events: consecutive commits within 10 min from concurrent
sessions touching the same path. Owner triages — no auto-fix.

Value: calibrates whether the collision-prevention priority is right (0 candidates →
overestimated; many → confirmed) AND identifies live damage worth restoring
from git history.

Usage:
  python3 scripts/historical-collision-scan.py                  # all pairs
  python3 scripts/historical-collision-scan.py --since 2026-05-01
  python3 scripts/historical-collision-scan.py --verbose        # +diff snippets
  python3 scripts/historical-collision-scan.py --threshold 5    # tighter window
"""

import argparse
import fnmatch
import glob
import json
import os
import subprocess
from collections import defaultdict
from datetime import datetime, timezone

SESSIONS_DIR = os.path.expanduser('~/.claude/projects/<project-key>')
REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

COORDINATION_GLOBS = [
    'BACKLOG.md',
    'todo.txt',
    'DECISIONS.md',
    'QA_TESTING_PLAN.md',
    'QA_TESTING_PLAN_ARCHIVE.md',
    '.claude/skills/*/MEMORY.md',
    '.claude/skills/*/CHANGELOG.md',
    '.claude/skills/meta/RULES.md',
    '.claude/project-memory/*.md',
]


def parse_iso(ts):
    if ts.endswith('Z'):
        ts = ts[:-1] + '+00:00'
    return datetime.fromisoformat(ts).timestamp()


def session_window(jsonl_path):
    """Returns (start_ts, end_ts, session_id_short, path, commit_tool_ts_list) or None.

    commit_tool_ts_list is the list of unix timestamps where this session's jsonl
    has a Bash tool_use whose command contains `git commit` — used for tight
    attribution of git commits to sessions.
    """
    start = end = None
    commit_ts = []
    sid = os.path.basename(jsonl_path).replace('.jsonl', '')[:8]
    with open(jsonl_path, errors='ignore') as f:
        for line in f:
            try:
                d = json.loads(line)
            except Exception:
                continue
            ts = d.get('timestamp')
            if not ts:
                continue
            try:
                ts_unix = parse_iso(ts)
            except Exception:
                continue
            if start is None:
                start = ts_unix
            end = ts_unix
            # Detect git commit tool_use
            if d.get('type') == 'assistant':
                content = d.get('message', {}).get('content', [])
                if isinstance(content, list):
                    for c in content:
                        if (isinstance(c, dict) and c.get('type') == 'tool_use'
                                and c.get('name') == 'Bash'):
                            cmd = c.get('input', {}).get('command', '')
                            if 'git commit' in cmd:
                                commit_ts.append(ts_unix)
    if start is None:
        return None
    return (start, end, sid, jsonl_path, commit_ts)


def is_coordination_path(p):
    return any(fnmatch.fnmatch(p, g) for g in COORDINATION_GLOBS)


def git_log_during(start_ts, end_ts, buffer_sec=3600):
    """Returns list of commits touching coordination paths within window + buffer."""
    since = datetime.fromtimestamp(start_ts - buffer_sec, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    until = datetime.fromtimestamp(end_ts + buffer_sec, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    cmd = ['git', 'log', f'--since={since}', f'--until={until}',
           '--name-only', '--format=__COMMIT__:%H:%at:%s']
    try:
        result = subprocess.run(cmd, cwd=REPO_DIR, capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired:
        return []
    commits = []
    cur = None
    for line in result.stdout.splitlines():
        if line.startswith('__COMMIT__:'):
            if cur and cur['paths']:
                commits.append(cur)
            parts = line[len('__COMMIT__:'):].split(':', 2)
            if len(parts) < 3:
                cur = None
                continue
            cur = {'hash': parts[0], 'ts': int(parts[1]), 'subj': parts[2], 'paths': []}
        elif cur is not None and line.strip():
            if is_coordination_path(line):
                cur['paths'].append(line)
    if cur and cur['paths']:
        commits.append(cur)
    return commits


def detect_close_commits(commits, threshold_min):
    """Return list of (commit_a, commit_b, shared_path, delta_min)."""
    by_path = defaultdict(list)
    for c in commits:
        for p in c['paths']:
            by_path[p].append(c)
    candidates = []
    for path, cs in by_path.items():
        if len(cs) < 2:
            continue
        cs_sorted = sorted(cs, key=lambda c: c['ts'])
        for i in range(len(cs_sorted) - 1):
            a, b = cs_sorted[i], cs_sorted[i + 1]
            if a['hash'] == b['hash']:
                continue
            delta_min = (b['ts'] - a['ts']) / 60
            if 0 < delta_min <= threshold_min:
                candidates.append((a, b, path, delta_min))
    return candidates


def attribute_to_sessions(commit_ts, windows, tight_sec=180, loose_sec=600):
    """Tight attribution: sessions with a `git commit` tool_use within ±tight_sec of the commit ts.
    Fallback: sessions whose activity-window brackets the commit timestamp (loose)."""
    tight = [sid for (s, e, sid, _, cts) in windows
             if any(abs(t - commit_ts) <= tight_sec for t in cts)]
    if tight:
        return tight, 'tight'
    loose = [sid for (s, e, sid, _, _) in windows if s - loose_sec <= commit_ts <= e + loose_sec]
    return loose, 'loose'


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--since', help='Filter overlap-start by date YYYY-MM-DD')
    p.add_argument('--verbose', action='store_true', help='Include diff snippets')
    p.add_argument('--threshold', type=int, default=10, help='Minutes between commits to flag (default 10)')
    args = p.parse_args()

    jsonls = sorted(glob.glob(os.path.join(SESSIONS_DIR, '*.jsonl')))
    windows = [w for w in (session_window(j) for j in jsonls) if w]
    print(f"Scanned {len(windows)} session jsonls (oldest {datetime.fromtimestamp(min(w[0] for w in windows)).strftime('%Y-%m-%d')}).\n")

    # Overlapping pairs
    pairs = []
    since_cutoff = parse_iso(args.since + 'T00:00:00Z') if args.since else 0
    for i in range(len(windows)):
        for j in range(i + 1, len(windows)):
            a_s, a_e, a_id, *_ = windows[i]
            b_s, b_e, b_id, *_ = windows[j]
            o_start, o_end = max(a_s, b_s), min(a_e, b_e)
            if o_end > o_start and o_start >= since_cutoff:
                pairs.append({'a': a_id, 'b': b_id, 'start': o_start, 'end': o_end,
                              'duration_min': (o_end - o_start) / 60})
    print(f"Found {len(pairs)} concurrent-session pairs.")
    if pairs:
        total_overlap_h = sum(p['duration_min'] for p in pairs) / 60
        print(f"Total concurrent-overlap time: {total_overlap_h:.1f}h.\n")

    if not pairs:
        return

    # Collect candidates across all overlap windows (dedupe via global commit-pair set)
    seen = set()
    all_candidates = []
    for pair in pairs:
        commits = git_log_during(pair['start'], pair['end'])
        for (a, b, path, delta_min) in detect_close_commits(commits, args.threshold):
            key = (a['hash'], b['hash'], path)
            if key in seen:
                continue
            seen.add(key)
            a_sids, a_mode = attribute_to_sessions(a['ts'], windows)
            b_sids, b_mode = attribute_to_sessions(b['ts'], windows)
            # Cross-session: at least one tight-attributed session in A doesn't appear in B (or vice versa).
            # If either attribution is loose-only, we can't say with confidence — flag as 'ambiguous'.
            if a_mode == 'tight' and b_mode == 'tight':
                cross_session = bool(set(a_sids) - set(b_sids) or set(b_sids) - set(a_sids))
                confidence = 'tight'
            else:
                cross_session = False
                confidence = 'loose'
            all_candidates.append({
                'a': a, 'b': b, 'path': path, 'delta_min': delta_min,
                'a_sids': a_sids, 'b_sids': b_sids,
                'cross_session': cross_session, 'confidence': confidence,
            })

    print(f"## Candidate close-commit events ({len(all_candidates)} unique)\n")
    if not all_candidates:
        print("No close-commit events surfaced inside any overlap window.")
        print("Interpretation: the collision-prevention priority is likely overestimated for the *retrospective* damage axis.")
        print("Phase 1 (`/expert-review` brief-injection) remains valuable for *prevention*, but no live restorations to chase.")
        return

    # Sort: cross-session first, then by delta_min ascending
    all_candidates.sort(key=lambda c: (not c['cross_session'], c['delta_min']))

    cross_n = sum(1 for c in all_candidates if c['cross_session'])
    loose_n = sum(1 for c in all_candidates if c['confidence'] == 'loose')
    print(f"Of these: {cross_n} CROSS-SESSION (tight-attributed to different sessions — highest-signal clobber candidates).")
    print(f"          {loose_n} attribution-loose (no `git commit` tool_use found in any session's jsonl within ±3 min — likely pre-2026-04-23 Cursor commits or commits made outside Claude Code).\n")

    print("| ⚠/? | Path | A (hash · subj) | B (hash · subj) | Δ min | A sess | B sess |")
    print("|-----|------|-----------------|-----------------|-------|--------|--------|")
    for c in all_candidates:
        if c['cross_session']:
            marker = '⚠️'
        elif c['confidence'] == 'loose':
            marker = '?'
        else:
            marker = ''
        a_str = f"{c['a']['hash'][:8]} · {c['a']['subj'][:40]}"
        b_str = f"{c['b']['hash'][:8]} · {c['b']['subj'][:40]}"
        a_sess = ','.join(c['a_sids']) or '?'
        b_sess = ','.join(c['b_sids']) or '?'
        print(f"| {marker} | `{c['path']}` | `{a_str}` | `{b_str}` | {c['delta_min']:.1f} | {a_sess} | {b_sess} |")

    print("\n**Triage:**")
    print("- ⚠️ cross-session rows = real candidates for inspection (commits from different sessions).")
    print("- Same-session rows = likely sequential commits in one workflow (e.g., follow-up fix).")
    print("- For each ⚠️ row: `git diff <A>..<B> -- <path>` (use --verbose to include here).")

    if args.verbose:
        print("\n## Diff snippets (verbose mode, ⚠️ cross-session only, top 10)\n")
        for c in [c for c in all_candidates if c['cross_session']][:10]:
            print(f"\n### {c['a']['hash'][:8]}..{c['b']['hash'][:8]} on `{c['path']}`")
            try:
                diff = subprocess.run(
                    ['git', 'diff', f"{c['a']['hash']}..{c['b']['hash']}", '--', c['path']],
                    cwd=REPO_DIR, capture_output=True, text=True, timeout=10)
                snippet = diff.stdout[:2000]
                print('```diff')
                print(snippet)
                if len(diff.stdout) > 2000:
                    print(f"... [truncated, full diff {len(diff.stdout)} chars]")
                print('```')
            except Exception as e:
                print(f"  [diff failed: {e}]")


if __name__ == '__main__':
    main()
