#!/usr/bin/env python3
"""session-labels.py — which commits did THIS session make? One reader for every consumer.

A seat labels its commits THREE ways, and the 8-hex trailer is the minority:
  (1) `Claude-Session: <sid8>`                      (safe-commit.sh stamps it)
  (2) `Claude-Session: <remote-session-URL>`       (the harness attribution block; the
      URL changes on every remote reconnect, and each one is recorded in this session's own
      transcript as an `attachment.type == "remote_session_change"` record)
  (3) a subject scope that ENDS in the sid — `wrap(<sid8>):`, `meta(learn <sid8>):` — or the
      /wrap commit's own sid-first shape `wrap(<sid8> /wrap --light):`. Read ONLY when the
      commit carries no trailer at all: a trailer is stronger evidence than a subject.

Until 2026-09-29 /wrap matched (1) alone and its guard fired only on an EMPTY list, so a
partial list passed silently: 60 of one session's 186 commits. A later run applied the
same classification for every one of 291 transcripts: 42 seats claim commits and 0 commits
are claimed by two seats (3,869 of 3,884 in a 14-day window).

KNOWN LIMIT, measured and not a peer claim: a CONTINUED-IN successor session inherits its
predecessor's LAST remote URL (the harness copies the tail record with its uuid) — on one
predecessor-successor pair, 1 of 91 URLs, 0 commits carry it. Untested: `--fork-session`,
which would copy a LIVE parent's URLs and could then credit the parent's commits to the fork.

Usage:
  session-labels.py mine      [--sid SID8] [WINDOW] [--path P]
      one full hash per line; stderr: the per-leg count line, plus window commits with NO trailer
  session-labels.py partition [--sid SID8] [WINDOW] [--path P]
      one line per commit: MINE | <other sid8> | URL-OTHER | NO-TRAILER, then short sha, subject
  WINDOW is --range A..B, or --max-count N, or --since '<when>' (default '14 days ago', used only
  when neither of the other two is given). --path limits the log to commits touching P.
  session-labels.py urls      [--sid SID8]
      this session's remote URLs, one per line
  session-labels.py --self-test

--sid defaults to $CLAUDE_CODE_SESSION_ID. Exit 2 = instrument failure (no transcript, no sid),
never an empty-but-clean answer.
"""
import glob
import json
import os
import re
import subprocess
import sys

# The transcript-dir derivation is the SSOT's (scripts/session_status.py, `project_key_dir`), shared
# with session-lifecycle.py and mirrored by scripts/lib/project-key.mjs; sys.path is prepended
# explicitly because this script runs from assorted cwds.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import session_status  # noqa: E402  (must follow the sys.path line above)


def _project_dir(cwd=None):
    """The harness keys a project's transcripts by the MAIN checkout's path, even for a seat working
    inside a linked worktree (measured on one session: 5,330 worktree-cwd records, transcript under the
    main-checkout key; no worktree-keyed dir exists). `session_status.project_key_dir` derives it
    from --git-common-dir, never --show-toplevel (which names the worktree and exits 2 there), and
    encodes it as the harness does — per UTF-16 unit, with the over-200 suffix."""
    return session_status.project_key_dir(cwd=cwd)


PROJECT_DIR = _project_dir()
URL_RE = re.compile(r"https://claude\.ai/code/session_[A-Za-z0-9]+")
HEX8 = re.compile(r"^[0-9a-f]{8}")
FMT = "--format=%H%x1f%h%x1f%s%x1f%(trailers:key=Claude-Session,valueonly,separator=%x1e)"


def fail(msg):
    print(f"session-labels: INSTRUMENT FAILURE — {msg}", file=sys.stderr)
    sys.exit(2)


def resolve(sid_arg):
    full = os.environ.get("CLAUDE_CODE_SESSION_ID", "")
    sid8 = (sid_arg or full.split("-")[0]).lower()
    if not HEX8.match(sid8):
        fail("no session id (pass --sid SID8 or set CLAUDE_CODE_SESSION_ID)")
    sid8 = sid8[:8]
    if full.startswith(sid8):
        tx = os.path.join(PROJECT_DIR, f"{full}.jsonl")
    else:
        hits = sorted(glob.glob(os.path.join(PROJECT_DIR, f"{sid8}*.jsonl")))
        tx = hits[0] if hits else os.path.join(PROJECT_DIR, f"{sid8}-<unknown>.jsonl")
    return sid8, tx


def read_urls(lines):
    """Remote URLs from remote_session_change RECORDS only — keyed on the record type, never the
    substring: a tool output can print the word beside another seat's URL."""
    urls = set()
    for line in lines:
        if "remote_session_change" not in line:
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if (rec.get("attachment") or {}).get("type") == "remote_session_change":
            urls.update(URL_RE.findall(line))
    return urls


def transcript_urls(tx):
    if not os.path.exists(tx):
        fail(f"transcript not found: {tx}")
    with open(tx, encoding="utf-8", errors="replace") as fh:
        return read_urls(fh)


def scope_re(sid8):
    s = re.escape(sid8)
    return re.compile(r"^[^(:]*\((?:[^)]*\s)?" + s + r"\):|^wrap\((?:session )?" + s + r"[\s,)]")


def classify(sid8, urls, scope, subject, values):
    """-> ('mine', leg) or ('other', label). Legs: sid / url / scope."""
    if any(v.startswith(sid8) for v in values):
        return "mine", "sid"
    if any(v in urls for v in values):
        return "mine", "url"
    if not values and scope.match(subject):
        return "mine", "scope"
    if not values:
        return "other", "NO-TRAILER"
    v = values[0]
    if v.startswith("http"):
        return "other", "URL-OTHER"
    return "other", v[:8] if HEX8.match(v) else "NO-TRAILER"


FULL_SHA = re.compile(r"^[0-9a-f]{40}$")


def parse_rows(out):
    """git log output -> (hash, short, subject, [trailer values]).
    ⛔ split("\\n"), NEVER splitlines(): splitlines() ALSO breaks on \\x1e, the separator between
    two Claude-Session values, so every two-value commit became a phantom row and lost its second
    value (measured 2026-09-29: 3,888 rows for 3,881 commits)."""
    rows = []
    for row in out.split("\n"):
        if not row:
            continue
        parts = (row.split("\x1f") + ["", "", ""])[:4]
        if not FULL_SHA.match(parts[0]):
            fail("git log row is not one commit per line (first field is not a 40-hex sha) — "
                 "FMT's separators are load-bearing")
        vals = [v.strip() for v in parts[3].split("\x1e") if v.strip()]
        rows.append((parts[0], parts[1], parts[2], vals))
    return rows


def git_rows(since, rng, max_count=None, path=None, cwd=None):
    args = ["git", "log", FMT]
    if rng:
        args.append(rng)
    if max_count:
        args.append(f"--max-count={max_count}")
    if not rng and not max_count:
        args.append(f"--since={since}")
    if path:
        args += ["--", path]
    r = subprocess.run(args, capture_output=True, text=True, cwd=cwd)
    if r.returncode != 0:
        fail(f"git log failed ({' '.join(args[3:]) or 'default window'}): {r.stderr.strip()[:200]}")
    return parse_rows(r.stdout)


def self_test():
    # Synthetic fixtures: the session ids are spelled by repetition, and each session URL is
    # assembled from its parts, so no real session id or session URL sits in this source.
    sid, other = "aaaaaaaa", "bbbbbbbb"

    def url(tail):
        return "https://claude.ai/code/" + "session_" + tail

    urls = {url("MINEaaa")}
    sc = scope_re(sid)
    arms = [
        ("8-hex trailer", ("x", [sid]), ("mine", "sid")),
        ("own URL trailer", ("x", [url("MINEaaa")]), ("mine", "url")),
        ("foreign URL trailer", ("x", [url("OTHERbb")]), ("other", "URL-OTHER")),
        ("another seat's sid", (f"wrap({sid}): x", [other]), ("other", other)),
        ("scope never beats a foreign trailer", (f"todo({sid}): x", [other]), ("other", other)),
        ("scope leg, no trailer", (f"meta(learn {sid}): x", []), ("mine", "scope")),
        ("the wrap commit's sid-first shape", (f"wrap({sid} /wrap --light): x", []), ("mine", "scope")),
        ("a hub NAMED in a fold scope is not the author", (f"fold(hub {sid} on <commit-id>): x", []), ("other", "NO-TRAILER")),
        ("generic sid-first stays rejected", (f"fold({sid} batch on <commit-id>): x", []), ("other", "NO-TRAILER")),
        ("sid in the subject body, not the scope", (f"todo({other}): {sid} x", []), ("other", "NO-TRAILER")),
    ]
    bad = 0
    for name, (subj, vals), want in arms:
        got = classify(sid, urls, sc, subj, vals)
        ok = got == want
        bad += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {name}: {got}")
    rec = json.dumps({"type": "attachment", "attachment": {"type": "remote_session_change",
                      "text": "Claude-Session: " + url("REAL1")}})
    noise = json.dumps({"type": "user", "message": {"content": [{"type": "tool_result",
                        "content": "remote_session_change " + url("PEER9")}]}})
    got = read_urls([rec, noise, "not json remote_session_change " + url("X")])
    ok = got == {url("REAL1")}
    bad += not ok
    print(f"{'PASS' if ok else 'FAIL'}  url reader keys on the record type, not the word: {sorted(got)}")
    two = "\n".join([
        "a" * 40 + f"\x1fa1\x1fwrap({sid}): x\x1f{sid}\x1e" + url("MINEaaa"),
        "b" * 40 + "\x1fb1\x1fno trailer here\x1f", ""])
    rows = parse_rows(two)
    ok = len(rows) == 2 and rows[0][3] == [sid, url("MINEaaa")] and rows[1][3] == []
    bad += not ok
    print(f"{'PASS' if ok else 'FAIL'}  parse_rows keeps a two-value trailer on ONE row: {[len(x[3]) for x in rows]}")
    live = git_rows(None, None, max_count=1)
    ok = len(live) == 1 and bool(FULL_SHA.match(live[0][0]))
    bad += not ok
    print(f"{'PASS' if ok else 'FAIL'}  git_rows reads the real log as one commit per line")
    # The project key is the SSOT's port of the harness's DO(): the three arms below pin values the
    # harness's own verbatim code produced on these strings; the fourth cross-checks the .mjs port.
    fx230 = "/tmp/" + "x" * 225
    for name, got, want in [
        ("project-key — a dot becomes a dash", session_status.project_key("/a/b.c"), "-a-b-c"),
        ("project-key — a non-BMP character yields two dashes (UTF-16 units)",
         session_status.project_key("/a/\U0001F4F7b"), "-a---b"),
        ("project-key — a 230-character path takes the oracle's suffix",
         session_status.project_key(fx230), "-tmp-" + "x" * 195 + "-qled2p"),
    ]:
        ok = got == want
        bad += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {name}: {'ok' if ok else got}")
    mjs = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib", "project-key.mjs")
    agree = []
    for p in ("/a/b.c", "/a/\U0001F4F7b", fx230, "/n/" + "z" * 220 + "0", "/a/my_repo x/café", "/a/Шx"):
        r = subprocess.run(["node", mjs, "--key", "--root", p], capture_output=True, text=True)
        agree.append(r.returncode == 0 and r.stdout.strip() == session_status.project_key(p))
    ok = len(agree) == 6 and all(agree)
    bad += not ok
    print(f"{'PASS' if ok else 'FAIL'}  project-key — the Python port agrees with scripts/lib/project-key.mjs on 6 fixtures: {agree}")
    here = os.path.dirname(os.path.abspath(__file__))
    r = subprocess.run([sys.executable, "-c", "import sys; sys.path.insert(0, %r); import session_status as s; print(s.project_key_dir())" % here],
                       capture_output=True, text=True, cwd="/")
    ok = r.returncode == 0 and r.stdout.strip() == session_status.project_key_dir(cwd=here)
    bad += not ok
    print(f"{'PASS' if ok else 'FAIL'}  project-key \u2014 the default root is this repository from any cwd: {r.stdout.strip()[-40:]}")
    import tempfile
    tmp = tempfile.mkdtemp()
    wt = os.path.join(tmp, "w")
    subprocess.run(["git", "worktree", "add", "--no-checkout", "--detach", wt, "HEAD"], capture_output=True, text=True)
    try:
        ok = os.path.isdir(wt) and _project_dir(wt) == _project_dir()
    finally:
        subprocess.run(["git", "worktree", "remove", "--force", wt], capture_output=True, text=True)
        subprocess.run(["rm", "-rf", tmp])
    bad += not ok
    print(f"{'PASS' if ok else 'FAIL'}  a linked worktree resolves to the MAIN checkout's transcript dir")
    r = subprocess.run([sys.executable, __file__, "urls", "--sid", sid], capture_output=True, text=True)
    ok = r.returncode == 2 and "INSTRUMENT FAILURE" in r.stderr and not r.stdout
    bad += not ok
    print(f"{'PASS' if ok else 'FAIL'}  a missing transcript exits 2, never an empty answer")
    print(f"self-test: {'ALL PASS' if not bad else f'{bad} FAILED'}")
    return 1 if bad else 0


def main(argv):
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__)
        return 0
    if argv[0] == "--self-test":
        return self_test()
    cmd, rest = argv[0], argv[1:]
    opts = {"--sid": None, "--since": "14 days ago", "--range": None, "--max-count": None, "--path": None}
    i = 0
    while i < len(rest):
        if rest[i] not in opts or i + 1 >= len(rest):
            fail(f"bad argument {rest[i]!r} (see --help)")
        opts[rest[i]] = rest[i + 1]
        i += 2
    if cmd not in ("mine", "partition", "urls"):
        fail(f"unknown command {cmd!r} (see --help)")
    sid8, tx = resolve(opts["--sid"])
    urls = transcript_urls(tx)
    if cmd == "urls":
        print("\n".join(sorted(urls)))
        return 0
    sc = scope_re(sid8)
    n = {"sid": 0, "url": 0, "scope": 0}
    untrailered = total = 0
    for h, short, subj, vals in git_rows(opts["--since"], opts["--range"], opts["--max-count"], opts["--path"]):
        total += 1
        untrailered += not vals
        kind, label = classify(sid8, urls, sc, subj, vals)
        if kind == "mine":
            n[label] += 1
        if cmd == "mine":
            if kind == "mine":
                print(h)
        else:
            print(f"{'MINE' if kind == 'mine' else label} {short} {subj[:60]}")
    window = (opts["--range"] or (f"last {opts['--max-count']}" if opts["--max-count"] else f"since {opts['--since']}")) \
        + (f" touching {opts['--path']}" if opts["--path"] else "")
    print(f"{sid8}: {sum(n.values())} of {total} commits ({window}) = trailer sid {n['sid']} + "
          f"trailer url {n['url']} ({len(urls)} url(s) read from this transcript) + subject scope "
          f"{n['scope']}; {untrailered} window commit(s) carry NO trailer at all, so a scope miss "
          f"there is invisible", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
