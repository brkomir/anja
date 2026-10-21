#!/usr/bin/env python3
"""parallel-session-scan.py — extract peer-session context for /expert-review brief injection.

Invoked by `/expert-review` Step 1b before
composing per-expert briefs. Output is a markdown block intended to be appended
to every expert's prompt under "## Parallel session context (orchestrator-injected)".

Scans top-level *.jsonl transcripts in ~/.claude/projects/<key>/ modified in the
last N hours (default 6), excluding the current session jsonl, and extracts:
  - inferred work subject (last substantive user message)
  - files touched (Edit/Write tool_use file_path + Bash > / >> / tee redirect targets)
  - sensitive surface refs (codified-policy domains: ToS, Privacy, migrations,
    content policy, BACKLOG/DECISIONS, email registry, RLS)
  - scope markers (`/agent-work` + `/expert-review` Bash invocations)

Caps at the 3 most-recently-active peers. Always emits the markdown header even
when no peers found (so /expert-review can detect "no parallel activity" cleanly).

Usage:
  python3 scripts/parallel-session-scan.py                       # exclude most-recent jsonl
  python3 scripts/parallel-session-scan.py --exclude <sid>       # exclude specific session
  python3 scripts/parallel-session-scan.py --hours 12 --max 5    # tune lookback + cap
  python3 scripts/parallel-session-scan.py --quiet               # suppress header when no peers
"""

import argparse
import glob
import json
import os
import re
import sys
from datetime import datetime, timezone

# The lifecycle-status DERIVATION is not written here — it is imported from the SSOT
# (`scripts/session_status.py`), shared with session-manifest.py + session-lifecycle.py.
# See `lifecycle_status` below. sys.path is prepended explicitly rather than relying on
# sys.path[0]: this script is invoked from /expert-review, /orient and peers' Bash calls
# with assorted cwds, and `python3 -c`/`-m` does not put this directory on the path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import session_status  # noqa: E402  (must follow the sys.path line above)

# FF_SESSIONS_DIR / FF_STATE_DIR overrides exist solely for smoke-test isolation
# (smoke-test-hooks.sh) — same convention as session-manifest.py:55,68.
# Claude Code keys a project by its directory path with every non-alphanumeric character as "-".
PROJECT_KEY = re.sub(r"[^a-zA-Z0-9]", "-", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SESSIONS_DIR = os.environ.get('FF_SESSIONS_DIR') or os.path.expanduser('~/.claude/projects/' + PROJECT_KEY)
REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_DIR = os.environ.get('FF_STATE_DIR') or os.path.join(REPO_DIR, '.claude', 'state')

# Project-specific: (regex over a repo-relative path, tag). The <...> entries are
# placeholders for the paths where your project keeps each codified-policy domain.
SENSITIVE_PATTERNS = [
    (re.compile(r'<legal-pages-path>'), 'ToS/Privacy'),
    (re.compile(r'<migrations-dir>/'), 'DB migration'),
    (re.compile(r'<content-policy-records>'), 'Content policy'),
    (re.compile(r'^BACKLOG\.md$|/BACKLOG\.md$'), 'BACKLOG'),
    (re.compile(r'^DECISIONS\.md$|/DECISIONS\.md$'), 'DECISIONS'),
    (re.compile(r'<email-sending-path>'), 'Email registry'),
    (re.compile(r'<pricing-constants-path>'), 'Pricing/plan limits'),
    (re.compile(r'<billing-module-path>/'), 'Billing/refund'),
    (re.compile(r'<policy-enforcement-module>/'), 'Policy enforcement'),
    (re.compile(r'\.claude/project-memory/project_'), 'Codified project memory'),
]

SCOPE_COMMAND_NAMES = {'agent-work', 'expert-review', 'audit-check', 'migration',
                       'fix', 'wrap', 'meta', 'decisions', 'session-memory'}
COMMAND_NAME_REGEX = re.compile(r'<command-name>(/?)([\w-]+)</command-name>')


def parse_iso(ts):
    if ts.endswith('Z'):
        ts = ts[:-1] + '+00:00'
    return datetime.fromisoformat(ts).timestamp()


def lifecycle_status(sid):
    """Derive a peer's terminal status from session-lifecycle.py's markers in
    .claude/state/: finished marker -> EXITED (terminal SessionEnd, no future intent);
    wrapped marker -> WRAPPED (on-hold but REPEATABLE — a wrapped peer can resume +
    mutate state, so it is NOT terminal); else ACTIVE.

    ⚠️ NO LONGER A REPLICA. This used to be a hand-copied twin of
    session-manifest.py's version, and the copy is what the file's own history warns
    about: it silently missed the manifest's stale-marker guard for 17 days, badging
    two sessions that had written 0 min ago as "✓ EXITED (edits
    settled in git)" into /expert-review briefs — the adopt rung, firing on live seats.
    The derivation now lives ONCE, in `scripts/session_status.py`, imported by all
    three sites. The old
    "replicated because both filenames are hyphenated and unimportable" rationale is
    dissolved rather than worked around: the SSOT's filename is underscored, so it
    imports.

    This site inherits two changes, both toward the codified fail-safe (a false EXITED
    makes a peer ADOPT work someone still holds — data loss; a false ACTIVE merely
    over-defends a corpse — harmless; never resolve a contradiction in the label's
    favour). Both directions are POLICY, not accident: the predicate is now
    transcript RECORDS rather than jsonl mtime (mtime moves for `touch`/restore/sync —
    write-class ops that are not a turn — while a record cannot be forged; an
    UNREADABLE record is an ABSENT measurement, so it falls back to mtime, never to
    EXITED), and the marker clock is now the marker's CONTENT epoch rather than its
    file mtime (a bumped mtime makes the marker look newer, biasing toward EXITED).
    Full rationale + incident evidence: `scripts/session_status.py`."""
    s = (sid or '').lower()[:8]
    return session_status.lifecycle_status(s, STATE_DIR, SESSIONS_DIR)


def extract_user_text(msg):
    """Same shape as meta-corrections-scan.py — extract user-typed content."""
    content = msg.get('content') if isinstance(msg, dict) else None
    text = ''
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        for c in content:
            if isinstance(c, dict) and c.get('type') == 'text':
                text += c.get('text', '') + ' '
    if not text:
        return None
    if 'ARGUMENTS:' in text:
        text = text.split('ARGUMENTS:', 1)[1].strip()
    if text.startswith('<') or text.startswith('['):
        return None
    if 'system-reminder' in text[:200] or 'command-name' in text[:200]:
        return None
    return text.strip()


def extract_slash_commands(msg):
    """Find <command-name> invocations in a user message. Returns list of command names."""
    content = msg.get('content') if isinstance(msg, dict) else None
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        text = ' '.join(
            c.get('text', '') for c in content
            if isinstance(c, dict) and c.get('type') == 'text'
        )
    else:
        return []
    matches = COMMAND_NAME_REGEX.findall(text[:2000])
    return [name for (_slash, name) in matches if name in SCOPE_COMMAND_NAMES]


def classify_sensitive(path):
    """Return list of sensitivity tags for a path, or empty list."""
    return [tag for (pat, tag) in SENSITIVE_PATTERNS if pat.search(path)]


# `(?<![-=])` so an arrow/operator (`->`, `=>`, `>=`) is NOT read as a redirect;
# `=` excluded from the target so `key=val` junk stops cleanly.
_BASH_WRITE_RE = re.compile(r'(?<![-=])(?:>>?|\btee\s+(?:-a\s+)?)\s*(["\']?)([^\s"\'|;&<>()=]+)\1')
# A real write target looks like a file: it has a path separator OR a file
# extension — rejects bare prose/number/operator tokens the `>`-scan grabs out of
# heredoc bodies (`444->452` → `452`, `falls back` → `falls`). Mirrors session-manifest.py.
_PATHLIKE_RE = re.compile(r'/|\.[A-Za-z0-9_-]{1,8}$')


def extract_bash_write_targets(command, repo_dir):
    """Repo file paths a Bash command WRITES — `>` / `>>` redirects + `tee` — that the
    Edit/Write tool_use parse misses (heredocs `cat >> f <<EOF`, echo-redirects, `tee f`).
    Closes the blind spot where a peer's heredoc write left no `file_path` in any tool_use
    (2026-06-19). Best-effort: skips $VARs and absolute paths outside the repo;
    normalizes absolute repo paths to relative; requires the target to LOOK like a file
    path so prose/operator tokens from heredoc bodies don't leak in (2026-06-20)."""
    out = set()
    for _q, raw in _BASH_WRITE_RE.findall(command or ''):
        if not raw or raw.startswith('$'):
            continue
        if raw.startswith('/'):
            if raw.startswith(repo_dir):
                raw = os.path.relpath(raw, repo_dir)
            else:
                continue
        if raw.startswith('./'):            # strip a leading ./ PREFIX only — NOT a
            raw = raw[2:]                   # char-set lstrip (that ate the dot off .claude/)
        if not _PATHLIKE_RE.search(raw):
            continue                       # bare token (number/word/operator) — not a write
        out.add(raw)
    return out


_SCOPE_OWNS_RE = re.compile(r'\[scope-owns\]:\s*(.+)')


def extract_scope_owns(prompt):
    """Repo paths an `Agent` dispatch ASSIGNS to a subagent's edit-scope via an explicit
    `[scope-owns]: a, b, c` marker — the orchestrator's file-partition decision captured at
    dispatch-time (PRECISE edit-scope only, NOT the read-context or injected peer-warning
    paths also in the prose; a naive grep would mis-attribute those, worst case crediting a
    PEER's file to this session). Folds a wave's delegated scope into files_touched.
    PROSPECTIVE: only marker-emitting dispatches are captured (2026-06-19)."""
    out = set()
    for line in (prompt or '').splitlines():
        m = _SCOPE_OWNS_RE.search(line)
        if not m:
            continue
        for tok in re.split(r'[,\s]+', m.group(1).strip()):
            tok = tok.strip('`"\'.,;')
            if tok and '/' in tok and not tok.startswith(('http', '$', '/dev', '/tmp')):
                out.add(tok)
    return out


def pick_work_subject(user_msgs):
    """Single best one-line work-subject from [(ts, text), ...]. Prefers a real
    directive over a quote-and-react fragment (owner pastes assistant output and
    reacts → the literal last message often describes MY text, not the work).
    Mirrors session-manifest.py:summarize_user_msgs (the /peers surface); kept as
    a small local copy because the two scan scripts don't import each other."""
    def first_line(t):
        return ' '.join(t.split('\n', 1)[0].split())
    FRAG_LEAD = '"‘’“”\'|>•-*#│┌└├─█'
    cleaned = [fl for (_ts, t) in user_msgs if (fl := first_line(t))]
    if not cleaned:
        return '(no recent user message in window)'
    non_frag = [m for m in cleaned if m[0] not in FRAG_LEAD]
    return (non_frag or cleaned)[-1][:200]


def scan_session(jsonl_path, lookback_sec):
    """Extract context summary for a peer session within the lookback window."""
    cutoff = datetime.now(timezone.utc).timestamp() - lookback_sec
    files_touched = set()
    sensitive_refs = {}  # path → list of tags
    scope_invocations = []
    user_msgs = []  # (ts, text) recent substantive user messages
    last_activity = 0

    try:
        with open(jsonl_path, errors='ignore') as f:
            for line in f:
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                ts_raw = d.get('timestamp')
                if not ts_raw:
                    continue
                try:
                    ts = parse_iso(ts_raw)
                except Exception:
                    continue
                if ts < cutoff:
                    continue
                last_activity = max(last_activity, ts)

                t = d.get('type')
                if t == 'user':
                    msg = d.get('message', {})
                    text = extract_user_text(msg)
                    if text and 20 < len(text) < 600:
                        user_msgs.append((ts, text))
                    # Slash-command invocations come from <command-name> tags in user messages
                    for cmd_name in extract_slash_commands(msg):
                        scope_invocations.append(f'/{cmd_name}')
                elif t == 'assistant':
                    content = d.get('message', {}).get('content', [])
                    if not isinstance(content, list):
                        continue
                    for c in content:
                        if not (isinstance(c, dict) and c.get('type') == 'tool_use'):
                            continue
                        name = c.get('name', '')
                        inp = c.get('input', {}) or {}
                        if name in ('Edit', 'Write', 'NotebookEdit'):
                            fp = inp.get('file_path', '') or inp.get('notebook_path', '')
                            if fp:
                                rel = os.path.relpath(fp, REPO_DIR) if fp.startswith(REPO_DIR) else fp
                                files_touched.add(rel)
                                tags = classify_sensitive(rel)
                                if tags:
                                    sensitive_refs.setdefault(rel, []).extend(tags)
                        elif name == 'Bash':
                            for rel in extract_bash_write_targets(inp.get('command', ''), REPO_DIR):
                                files_touched.add(rel)
                                tags = classify_sensitive(rel)
                                if tags:
                                    sensitive_refs.setdefault(rel, []).extend(tags)
                        elif name == 'Agent':
                            for rel in extract_scope_owns(inp.get('prompt', '')):
                                files_touched.add(rel)
                                tags = classify_sensitive(rel)
                                if tags:
                                    sensitive_refs.setdefault(rel, []).extend(tags)
    except (OSError, IOError):
        return None

    if last_activity == 0:
        return None

    # Pick best substantive user msg as work-subject hint (de-noised: prefers a
    # real directive over a quote-and-react fragment)
    work_subject = pick_work_subject(user_msgs)
    return {
        'session_id': os.path.basename(jsonl_path).replace('.jsonl', '')[:8],
        'last_activity': last_activity,
        'files_touched': sorted(files_touched),
        'sensitive_refs': sensitive_refs,
        'scope_invocations': scope_invocations[-5:],  # last 5
        'work_subject': work_subject,
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--exclude', help='Session ID prefix to exclude (default: most-recently-modified jsonl)')
    p.add_argument('--hours', type=int, default=6, help='Lookback window in hours (default 6)')
    p.add_argument('--max', type=int, default=3, help='Max peer sessions to report (default 3)')
    p.add_argument('--quiet', action='store_true', help='Suppress header + body when no peers found')
    args = p.parse_args()

    jsonls = sorted(glob.glob(os.path.join(SESSIONS_DIR, '*.jsonl')),
                    key=os.path.getmtime, reverse=True)
    if not jsonls:
        if not args.quiet:
            print('## Parallel session context (orchestrator-injected)\n\n_No session jsonls found._')
        return

    # Determine current session to exclude. Prefer the deterministic
    # CLAUDE_CODE_SESSION_ID env var (set by Claude Code) over the racy
    # most-recently-modified heuristic: a concurrent peer writing more recently
    # than the current session at scan-instant would otherwise be excluded,
    # surfacing the CURRENT session as a phantom peer. Fall back to
    # most-recent only in headless/cron contexts where the env var is absent.
    if args.exclude:
        excluded = [j for j in jsonls if args.exclude in os.path.basename(j)]
    else:
        env_sid = os.environ.get('CLAUDE_CODE_SESSION_ID', '')
        if env_sid:
            # env set: exclude only MY jsonl (or NOTHING if it's not on disk yet) — never
            # exclude a PEER as phantom-self (the SessionStart misroute).
            excluded = [j for j in jsonls if os.path.basename(j).startswith(env_sid)]
        else:
            excluded = [jsonls[0]]  # env absent (headless/cron): mtime fallback
    peers = [j for j in jsonls if j not in excluded]

    # Filter to peers active within lookback window
    lookback_sec = args.hours * 3600
    cutoff = datetime.now(timezone.utc).timestamp() - lookback_sec
    peers = [j for j in peers if os.path.getmtime(j) >= cutoff]

    if not peers:
        if not args.quiet:
            print('## Parallel session context (orchestrator-injected)\n')
            print(f'_No peer session jsonl files were modified in the last {args.hours}h. Proceed without cross-session coordination concerns._')
        return

    # Scan each peer
    summaries = []
    for j in peers:
        s = scan_session(j, lookback_sec)
        if s:
            summaries.append(s)

    # Sort by recency, cap
    summaries.sort(key=lambda s: s['last_activity'], reverse=True)
    summaries = summaries[:args.max]

    if not summaries:
        if not args.quiet:
            print('## Parallel session context (orchestrator-injected)\n')
            print(f'_No peer activity surfaced in the last {args.hours}h after content scan._')
        return

    now = datetime.now(timezone.utc).timestamp()
    print('## Parallel session context (orchestrator-injected)\n')
    print(f'_Scanned {len(peers)} peer session jsonl(s) MODIFIED in the last {args.hours}h. Reporting top {len(summaries)}._')
    print(f'_NOTE: file-write recency is NOT a liveness signal on its own — but a peer with a terminal SessionEnd marker is now positively flagged "✓ EXITED" in its header below. An un-badged peer (or one "⏸ wrapped") cannot be proven live by recency alone (a wrapped peer can resume); do not restate "modified Nm ago" as "active"/"winding down" without a real liveness check._')
    print(f'_AUTHORITATIVE-TEXT OVERRIDE: if a peer\'s captured "Inferred work subject" below contains an explicit USER/OWNER statement about session state ("X session is done", "no sessions active"), THAT statement is ground truth — it overrides the recency label above. Never infer "active" against it._')
    print(f'_For each peer below: surface overlap with the current audit subject as a verdict-level concern in your Recommendation. Do NOT defer overlap to "later" — flag now or coordinate before /agent-work dispatch. EXCEPTION: a peer badged "✓ EXITED" is terminal — its edits are settled (reconcile via git, not live coordination), so treat it as context, not a race._\n')

    for s in summaries:
        age_min = (now - s['last_activity']) / 60
        status = lifecycle_status(s['session_id'])
        badge = {
            'EXITED': ' · ✓ EXITED (terminal — edits settled in git, NOT a live race)',
            'WRAPPED': ' · ⏸ wrapped (done-for-now but REPEATABLE — can resume; still a coordination risk)',
            'CHECKPOINT': ' · ⏯ checkpoint (wrapped WITH declared intent to CONTINUE — treat as live)',
            'STANDBY': ' · ⏸ standby (owner-parked, listener DISARMED — holds its work, cannot reply until the owner resumes it; still a coordination risk)',
        }.get(status, '')
        print(f'### Peer session `{s["session_id"]}` (last file-write {age_min:.0f} min ago — recency, NOT liveness{badge})')
        print(f'**Inferred work subject:** {s["work_subject"]}')
        if s['files_touched']:
            print(f'**Files touched ({len(s["files_touched"])}):**')
            for fp in s['files_touched'][:20]:
                print(f'  - `{fp}`')
            if len(s['files_touched']) > 20:
                print(f'  - … {len(s["files_touched"]) - 20} more')
        if s['sensitive_refs']:
            print(f'**Sensitive-surface refs (codified-policy domains touched):**')
            for fp, tags in sorted(s['sensitive_refs'].items()):
                uniq_tags = sorted(set(tags))
                print(f'  - `{fp}` — {", ".join(uniq_tags)}')
        if s['scope_invocations']:
            print(f'**Scope-decision invocations (last {len(s["scope_invocations"])}):**')
            for cmd in s['scope_invocations']:
                print(f'  - `{cmd}`')
        print()


if __name__ == '__main__':
    main()
