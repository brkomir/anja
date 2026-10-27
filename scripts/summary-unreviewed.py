#!/usr/bin/env python3
"""/summary step 7 — what this seat committed that no reviewer has been sent.

Run: python3 scripts/summary-unreviewed.py [--sid <full session id>] [--json]
     test seams: --transcript <path> · --mail-dir <path> · --repo <path>

The executable form of `.claude/skills/summary/references/unreviewed-commits.md` § The block (the
bash+python block that first shipped in SKILL.md and later moved to that file). That
file stays the record of WHY each gate below exists; this file is what a run executes. Tests: scripts/summary-unreviewed-test.py (wired into
scripts/smoke-test-hooks.sh).

STDOUT — the first line is always the state, and there are exactly THREE (one exception: an argparse
error, an unknown flag, prints usage on STDERR with EMPTY stdout at exit 2 — still the failing side):
  STATE: CRASH <why>            instrument failure. Nothing else is printed on stdout, so no reader
                                can mistake it for an empty set. EXIT 2.
  STATE: NOTHING-COMMITTED ...  the transcript holds no git confirmation line: a session that
                                committed nothing, which is NOT "everything was sent". EXIT 0.
  STATE: N commits, M unsent    then, when the mail store was not found, one NOTE: line; then, when a
                                transcript sha is a commit on no shared ref, one UNMERGED: line naming
                                them; then one row per commit, oldest first:
                                  sent:0|1 <sha> <subject> | touches: <path>, <path>, ...
                                then, ONCE, a HINT line when any sent:0 row is older than 3 h. EXIT 0.
A caller reading only the exit code still lands on the failing side: 2 is never a result.
--json prints the same as JSON lines: a state object first, then one object per row.

STEP 1 — this seat's commits come from git's own confirmation lines in the session transcript
(`[dev <sha>]`, `[main (root-commit) <sha>]`, `[hotfix/<topic> <sha>]`, `[detached HEAD <sha>]`), AND
from the house commit tools' own lines (`safe-commit: committed <sha>`, `private-index-commit: committed
<sha>`): both END with that line so the house `| tail -1` / `| grep committed` filters keep
it, and those filters drop git's `[dev <sha>]` line, which private-index-commit (`git commit-tree`) never prints
at all. The block missed every such commit (17 of 29 on one seat, 2026-10-25). The jsonl IS the session boundary, so no base has
to be chosen.
  ⛔ NEVER the `Claude-Session:` trailer — it read 1 of 41 on one seat (three spellings on one
     seat, 12+ fleet-wide in two formats, plus a self-test fixture literal on commits in main).
  ⛔ NEVER the mail store — step 2 already IS the mail store, and it holds no record of a commit
     that was never mailed, which is the population this step exists to find.
  ⛔ The branch alternatives are named explicitly. `main` alone reads ZERO on a detached HEAD, and
     `dev` was missing until 2026-10-11 (every session read clean). The obvious generalisation
     `\\[[^ \\]]+(?: HEAD)? (hex)\\]` fails both ways: it over-matches bracketed prose and misses
     `[main (root-commit) <sha>]`. Prose over-matches are noise: the reachability filter drops them.
  ⚠️ A FLOOR: a commit whose confirmation line never reached the transcript (`git commit -q`, a
     `| tail`, a redirect) is not found, and reads as not committed at all.

THE LOUD GATE — a crash is an instrument failure, never "everything risk-bearing has been sent".
Every step-1 failure mode (wrong path, moved transcript, wrong session id, git unusable, neither
`dev` nor `main` resolving) ends in STATE: CRASH and exit 2. Zero rows with exit 0 is a session that
committed nothing — telling that reader "instrument failure" is a false alarm that trains them to
ignore the real one, so the two are never folded into one condition. Count the SET, not bytes (the
block's `[ -s ]` read a bare newline as one commit).

STEP 2 — each commit is matched against THIS seat's SENT mail, one pass over the store
(`*__<sid8>.md*`: the trailing `*` is load-bearing — it keeps `.md.read` and `.md.read-by-<sid8>`,
the files every read verdict leaves; a glob on `.md` alone reads every reviewed commit as unsent).
A per-sha pass over the store is O(shas x mails) and timed out at the Bash tool's cap on a heavy
seat (the timeout was read as "the store is quiet"); one pass is O(shas + mails).
A mail counts only when BOTH hold (three single-half versions shipped and failed):
  (a) it is a review REQUEST: its frontmatter `subject:` carries `--code`, `review request` or
      `fold-verify`, OR its frontmatter `signal:` is in the ALLOWLIST below. Read from the
      frontmatter block only — a body line that begins `signal:` is not a header.
      ⛔ It STAYS an allowlist (the opposite of session-manifest.py's wake denylist): here an
      unrecognised signal read as not-a-request only over-reports a commit as unsent (safe), while
      read as a request it marks work reviewed that nobody reviewed. `review-verdict`,
      `review-finding`, `review-ack` stay OUT — on the sending side they are you reviewing someone
      else. `deploy-review` is IN (at least one seat requests with it). Known
      under-report: `review-verdict` is overloaded (also used for fold reports) — the fix is the
      `fold-report` convention, not a predicate; a `^FOLD` subject marker was measured and
      rejected (`FOLD-VERIFIED` is a verdict two letters from `FOLD-VERIFY`).
  (b) it names the commit anywhere in the file: a lowercase hex token of 7-40 chars that is a
      PREFIX of the commit's full sha. (The block matched git's current short sha as a substring
      of a token, so a mail naming 7 chars of a sha git auto-abbreviates to 10 here — core.abbrev is unset — read sent:0.)
A sent:0 row can be a PRUNED request: session-manifest.py's mail-prune deletes a read request
MAIL_READ_TTL_HOURS (24) after it was read (a `deploy-*` verdict keeps MAIL_UNREAD_TTL_HOURS, 72), so on a
seat older than a day the unsent count is a CEILING on what was never sent; the durable record of a review
is the hub's ledger, which this script does not read.
Reachability is anchored on the shared refs `dev` then `main`, NEVER `HEAD`: most worktrees here
are detached and behind, and `HEAD` drops reachable commits there and reads them as reviewed.

The rows carry what each commit TOUCHES so the reader triages by SKILL.md step 7's table (a wired
hook, guard, gate, settings.json, an always-loaded file, src/, a migration, a test => OWED;
tracker rows and plan prose => skip). This script classifies nothing and sends nothing.
"""
import argparse
import bisect
import fnmatch
import json
import os
import re
import subprocess
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import session_status  # noqa: E402  (the harness's project key for a root, derived; must follow the sys.path line above)
CONFIRM_RE = re.compile(r'\[(?:main|dev|hotfix/[^\] ]+|detached HEAD)(?: \([^)]*\))? ([0-9a-f]{7,40})\]')
# The house commit tools END with their OWN line (so a `| tail -1` keeps it; safe-commit
# re-prints git's line above it, private-index-commit has none:
# 2026-09-08): `safe-commit: committed <sha>` / `private-index-commit: committed <sha>`.
# safe-commit's fallback line `safe-commit: committed — SHA UNPARSED …` carries no sha (0 live at 2026-10-26),
# so that commit is found only through git's own line above it: this pattern is a FLOOR, not a count.
TOOL_CONFIRM_RE = re.compile(r'(?:safe-commit|private-index-commit): committed ([0-9a-f]{7,40})(?![0-9a-f])')
HEX_RE = re.compile(r'[0-9a-f]{7,40}')
SUBJECT_MARKER_RE = re.compile(r'--code|review request|fold-verify', re.I)
SIGNAL_ALLOWLIST_RE = re.compile(
    r'^signal: *(review-request|review-fold|fold-verify|fold-report|fold|deploy-review) *$', re.I)
# A verdict or ack this seat sent AS A REVIEWER is never its own request, whatever its subject quotes: the hub's
# verdict subjects read `FOLD-VERIFY <sha>: CHANGES-REQUESTED` and its acks `... 3 fold-verify lenses`.
VERDICT_SIGNAL_RE = re.compile(r'^signal: *(review-verdict|review-finding|review-ack|deploy-clear) *$', re.I)
AGED_S = 3 * 3600
SUBJECT_WIDTH = 60


class Crash(Exception):
    pass


def git(repo, *args):
    try:
        p = subprocess.run(['git', '-C', repo] + list(args), capture_output=True, text=True,
                           encoding='utf-8', errors='replace')
    except OSError as e:
        raise Crash('git could not run (%s)' % e)
    return p


def transcript_shas(path):
    """STEP 1. Raises Crash on any read failure — never an empty set."""
    if not os.path.isfile(path):
        raise Crash('transcript not found: %s (wrong session id, or the transcript moved)' % path)
    seen = set()
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            for line in f:
                for rx in (CONFIRM_RE, TOOL_CONFIRM_RE):
                    for m in rx.finditer(line):
                        seen.add(m.group(1))
    except OSError as e:
        raise Crash('transcript unreadable: %s (%s)' % (path, e))
    return seen


def frontmatter(text):
    lines = text.split('\n')
    if not lines or lines[0].strip() != '---':
        return []
    out = []
    for l in lines[1:]:
        if l.strip() == '---':
            break
        out.append(l)
    return out


def names_commit(full, tokens):
    """Half (b) of the sent rule: one of the tokens this seat's review requests carry is a 7-to-40-char PREFIX of the full sha."""
    return any(full[:k] in tokens for k in range(7, 41))


def is_request(fm):
    sig0 = next((l for l in fm if l.startswith('signal:')), None)
    if sig0 is not None and VERDICT_SIGNAL_RE.match(sig0):
        return False
    subj = next((l for l in fm if l.startswith('subject:')), None)
    if subj is not None and SUBJECT_MARKER_RE.search(subj):
        return True
    sig = next((l for l in fm if l.startswith('signal:')), None)
    return sig is not None and bool(SIGNAL_ALLOWLIST_RE.match(sig))


def sent_tokens(mail_dir, sid8):
    """STEP 2, one pass. Returns (set of hex tokens named by this seat's review requests, files read)."""
    tokens = set()
    n = 0
    pattern = '*__%s.md*' % sid8
    try:
        names = sorted(os.listdir(mail_dir))
    except OSError as e:
        raise Crash('mail store unreadable: %s (%s)' % (mail_dir, e))
    for name in names:
        full = os.path.join(mail_dir, name)
        if not fnmatch.fnmatchcase(name, pattern) or not os.path.isfile(full):
            continue
        try:
            with open(full, encoding='utf-8', errors='replace') as f:
                text = f.read()
        except OSError:
            continue
        n += 1
        if is_request(frontmatter(text)):
            tokens.update(HEX_RE.findall(text))
    return tokens, n


def reachable(repo):
    refs = []
    for ref in ('dev', 'main'):
        p = git(repo, 'rev-parse', '--verify', '-q', ref + '^{commit}')
        if p.returncode == 0:
            refs.append(ref)
    if not refs:
        raise Crash('neither dev nor main resolves in %s — reachability cannot be measured' % repo)
    p = git(repo, 'rev-list', *refs)
    if p.returncode != 0:
        raise Crash('git rev-list %s failed: %s' % (' '.join(refs), p.stderr.strip()[:200]))
    return sorted(p.stdout.split()), refs


def resolve(cands, reach_sorted):
    """Each transcript sha -> the reachable commits it is a prefix of. Unreachable / not-a-commit
    tokens (amended or reset shas, `[word deadbeef]` prose) drop here; an ambiguous prefix keeps
    every match, which can only over-report."""
    full, dropped = set(), []
    for c in cands:
        i = bisect.bisect_left(reach_sorted, c)
        hit = False
        while i < len(reach_sorted) and reach_sorted[i].startswith(c):
            full.add(reach_sorted[i])
            hit = True
            i += 1
        if not hit:
            dropped.append(c)
    return full, dropped


def commit_info(repo, shas):
    p = git(repo, 'log', '--no-walk=unsorted', '--format=%x00%H%x09%h%x09%ct%x09%s', '--name-only', *shas)
    if p.returncode != 0:
        raise Crash('git log over %d commits failed: %s' % (len(shas), p.stderr.strip()[:200]))
    info = {}
    for chunk in p.stdout.split('\x00')[1:]:
        head, _, rest = chunk.partition('\n')
        full, short, ct, subject = head.split('\t', 3)
        info[full] = {'sha': short, 'full': full, 'ts': int(ct), 'subject': subject,
                      'touches': [l for l in rest.split('\n') if l.strip()]}
    missing = [s for s in shas if s not in info]
    if missing:
        raise Crash('git log returned no record for %d commit(s), e.g. %s' % (len(missing), missing[0]))
    return info


def emit_crash(why, as_json):
    why = ' '.join(why.splitlines())  # one stdout line, whatever the message carries
    print(json.dumps({'state': 'CRASH', 'why': why}) if as_json else 'STATE: CRASH ' + why)
    print('summary-unreviewed: INSTRUMENT FAILURE, not "everything risk-bearing has been sent". '
          'Do not report step 7 from this run. %s' % why, file=sys.stderr)
    return 2


def main(argv=None):
    ap = argparse.ArgumentParser(description='/summary step 7: this seat\'s commits and whether each was sent for review.')
    ap.add_argument('--sid', default=os.environ.get('CLAUDE_CODE_SESSION_ID', ''))
    ap.add_argument('--transcript')
    ap.add_argument('--mail-dir')
    ap.add_argument('--repo', default='.')
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args(argv)
    try:
        sid = a.sid.strip()
        if not sid:
            raise Crash('no session id (pass --sid or set CLAUDE_CODE_SESSION_ID)')
        sid8 = sid.split('-')[0]
        tpath = a.transcript or os.path.join(session_status.project_key_dir(cwd=a.repo), sid + '.jsonl')
        cands = transcript_shas(tpath)
        if not cands:
            line = ('NOTHING-COMMITTED — no git confirmation line in %s; that is a session that committed '
                    'nothing, not every commit having been sent (a -q commit leaves no line: a FLOOR)' % tpath)
            print(json.dumps({'state': 'NOTHING-COMMITTED', 'transcript': tpath}) if a.json else 'STATE: ' + line)
            return 0
        p = git(a.repo, 'rev-parse', '--path-format=absolute', '--git-common-dir')
        if p.returncode != 0:
            raise Crash('not a git repository: %s' % os.path.abspath(a.repo))
        common_dir = p.stdout.strip()
        reach_sorted, refs = reachable(a.repo)
        full, dropped_c = resolve(cands, reach_sorted)
        # A dropped sha that IS a commit sits on no shared ref (an unmerged hotfix or worktree branch): owed, not noise.
        unmerged = sorted(c for c in dropped_c if git(a.repo, 'rev-parse', '--verify', '-q', c + '^{commit}').returncode == 0)
        dropped = len(dropped_c) - len(unmerged)
        info = commit_info(a.repo, sorted(full)) if full else {}
        mail_dir = a.mail_dir or os.path.join(os.path.dirname(common_dir), '.claude', 'state', 'session-mail')
        note = None
        if os.path.isdir(mail_dir):
            tokens, nmail = sent_tokens(mail_dir, sid8)
        else:
            tokens, nmail = set(), 0
            note = 'mail store not found at %s — every row reads sent:0' % mail_dir
        rows = sorted(info.values(), key=lambda r: (r['ts'], r['full']))
        for r in rows:
            r['sent'] = 1 if names_commit(r['full'], tokens) else 0
        unsent = [r for r in rows if not r['sent']]
        now = time.time()
        aged = [r for r in unsent if now - r['ts'] > AGED_S]
        extra = ' (%d transcript sha(s) dropped: not a commit reachable from %s)' % (dropped, ' or '.join(refs)) if dropped else ''
        # Composed first and written ONCE: a failure while building the rows, or an encode error on a
        # non-UTF-8 stdout, then reaches the catch-all below before any byte of a success state is out.
        out = []
        if a.json:
            out.append(json.dumps({'state': 'OK', 'commits': len(rows), 'unsent': len(unsent), 'dropped': dropped,
                                   'refs': refs, 'unmerged': unmerged, 'mail_files': nmail, 'aged_unsent': len(aged), 'note': note}))
            for r in rows:
                out.append(json.dumps({k: r[k] for k in ('sent', 'sha', 'full', 'ts', 'subject', 'touches')}))
        else:
            out.append('STATE: %d commits, %d unsent%s' % (len(rows), len(unsent), extra))
            if note:
                out.append('NOTE: ' + note)
            if unmerged:
                out.append('UNMERGED: %d commit(s) from this transcript sit on no shared ref (%s) — not rows, and not reviewed: %s'
                           % (len(unmerged), ' or '.join(refs), ', '.join(unmerged)))
            for r in rows:
                subj = r['subject'] if len(r['subject']) <= SUBJECT_WIDTH else r['subject'][:SUBJECT_WIDTH] + '…'
                out.append('sent:%d %s %s | touches: %s' % (r['sent'], r['sha'], subj, ', '.join(r['touches']) or '(none)'))
            if aged:
                out.append("HINT: %d sent:0 row(s) older than 3 h — before treating one as a finding, run "
                           "git log --all --grep='<sha>' --format='%%h %%s' (never capped); a clean APPROVAL leaves "
                           "no fold commit, and dismissing a row needs a NAMED ARTIFACT" % len(aged))
        sys.stdout.write('\n'.join(out) + '\n')
    except Crash as e:
        return emit_crash(str(e), a.json)
    except Exception as e:  # noqa: BLE001 — a programming error still answers on line 1; the traceback goes to stderr
        traceback.print_exc()
        return emit_crash('unexpected %s: %s' % (type(e).__name__, e), a.json)
    return 0


if __name__ == '__main__':
    sys.exit(main())
