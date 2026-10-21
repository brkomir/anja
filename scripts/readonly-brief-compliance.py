#!/usr/bin/env python3
"""Did the READ-ONLY brief hold? — post-hoc compliance scan over sub-agent transcripts.

WHY THIS EXISTS. The read-only agent class declares `disallowedTools: Write, Edit`, and the
harness may not enforce it: a seat can be delivered Write and Edit anyway and use both. So the
class is enforced by DOCTRINE — rule 4's REVIEW-ONLY branch and the brief text — and doctrine
with no instrument is a claim nobody can check. A seat that dispatches read-only-briefed agents
cannot verify their "no edits" reports from its own seat, so the brief is checked after the fact,
by this script.

It CAN be verified. A sub-agent's own transcript records every tool_use it made, so brief-compliance
is answerable after the fact from data already on disk. That is what this does.

⛔ WHAT IT DOES *NOT* ANSWER, stated because the two get conflated and the difference is the whole
   value: this says whether YOUR AGENTS wrote. It does NOT attribute an already-dirty file to anyone
   (`whose-edit` owns that, and returns UNATTRIBUTED more often than not). The two are different
   questions — but a clean reading here does let a seat CLEAR its own agents, which is most of what
   anyone wanted from the attribution question in the first place.

⛔ THE PREDICATE TRAP, measured on this script's own first run. Keying read-only off phrases in the
   brief ("read-only", "make no edits") matches a brief that merely DISCUSSES read-only work: it
   flagged all three of the build agents whose TASK WAS the read-only class, reporting 3 violations
   that were nothing of the kind. A write dispatch is marked by the `[scope-owns]` file-ownership
   stanza the dispatch protocol mandates, so that stanza — not the prose — is the discriminator.
   This is `bash-environment.md`'s "a predicate matches prose ABOUT the thing" at the brief surface.

Scratchpad writes are excluded deliberately: a read-only seat is expected to tee evidence there.
Bash-route repo writes (`>`, `>>`, `tee`, `sed -i`) are a REPORT-ONLY `bash_writes` bucket, never a
VIOLATION and never the exit code: a regex over a command string cannot tell a write from a mention.

  python3 scripts/readonly-brief-compliance.py [--since YYYY-MM-DD] [--json] [--self-test]
"""
import json, os, re, sys, time

PROJECTS = os.path.expanduser("~/.claude/projects/<project-key>")
def _repo_root():
    """The MAIN checkout, never this file's own location. A worktree copy of this script resolves
    REPO under the worktree, so every main-tree write reads as OUTSIDE and the scan exits 0 clean
    (the same hazard measured on session-manifest.py, 2026-09-07). `--git-common-dir` is
    the one answer every worktree shares; the file location is the fallback when git is absent."""
    here = os.path.dirname(os.path.abspath(__file__))
    try:
        import subprocess
        out = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
                             capture_output=True, text=True, cwd=here, timeout=5)
        common = out.stdout.strip()
        if out.returncode == 0 and os.path.basename(common) == ".git":
            return os.path.dirname(common)
    except Exception:
        pass
    return os.path.dirname(here)


REPO = _repo_root()
ISOLATED_DIR = ".claude/worktrees"   # harness-granted isolation trees live INSIDE the root
REPORT_DEPOSIT_DIR = ".claude/state/review-reports"   # review-hub lens briefs PRESCRIBE this deposit (gitignored)
PATCH_DEPOSIT_DIR = ".claude/state/review-patches"     # the hub's combined-patch deposit, same class (gitignored; 6 of 9 bash_writes hits 2026-10-09)
WRITE_TOOLS = {"Write", "Edit", "MultiEdit", "NotebookEdit"}
RO_RE = re.compile(r"REVIEW[- ]ONLY|read-only|do NOT edit any file|make no edits|surface-only", re.I)
WRITE_DISPATCH_MARKER = "[scope-owns]"


def _under(path, root):
    """True iff `path` resolves INSIDE `root`: a lexical fast path on realpath'd strings, then a
    same-inode ancestor walk — contain a filesystem path by resolved-ancestor walk, never by
    string prefix. The prefix form this replaced read the case alias (<home-dir> with its account
    name upper-cased) and the firmlink spelling (/System/Volumes/Data/...) of a repo file as OUTSIDE
    the repo: six false-CLEANs in a 13-case matrix (2026-09-07), every one in the direction the consumer
    (review-hub/SKILL.md) cannot see. realpath alone leaves both standing, hence the inode walk."""
    if not path or not root:
        return False
    rr = os.path.realpath(root).rstrip(os.sep) or os.sep
    rp = os.path.realpath(path)
    if rp == rr or rp.startswith(rr + os.sep):
        return True
    p = rp
    while True:                      # climb; a new file's deepest EXISTING ancestor is what carries the inode
        if os.path.exists(p):
            try:
                if os.path.samefile(p, rr):
                    return True
            except OSError:
                pass
        parent = os.path.dirname(p)
        if parent == p:
            return False
        p = parent


# After shinpr — the BASH route. The redirect arm is the founding
# probe's predicate with `(`/`)` added so a `>(…)` process substitution is not read as a target; the `cd`
# arm moves the base a relative target resolves against, in command order.
BASH_WRITE_RE = re.compile(r"\bcd\s+([^\s|;&()]+)|(?<![0-9&])>{1,2}\s*([^\s|;&()]+)"
                           r"|\btee\s+(?:-a\s+)?([^\s|;&()]+)|\bsed -i\b([^|;&\n]*)")
QUOTED_RE = re.compile(r"""'[^']*'|"(?:\\.|[^"\\])*\"""")


def bash_writes(cmd, cwd=None, repo=REPO, deposits=False):
    """REPORT-ONLY, never a VIOLATION: the repo paths one Bash command writes by `>`, `>>`, `tee` or
    `sed -i`. A heredoc body is data, so it is dropped; a quoted span keeps its place as one token but
    loses its shell metacharacters, so a pattern QUOTED in a grep or a script is not a redirect (the
    founding probe's 2 self-quote hits). `$VAR` resolves from an assignment in the same command or the
    environment; an unresolved one is skipped, never guessed. Carve-outs as in classify(); `deposits=True`
    drops the two DEPOSIT carve-outs, so a caller can REPORT those writes instead of losing them."""
    lines, delim = [], None
    for ln in (cmd or "").split("\n"):
        if delim is None:
            lines.append(ln)
            m = re.search(r"(?<!<)<<(?!<)-?\s*['\"]?(\w+)", ln)
            delim = m.group(1) if m else None
        elif ln.strip() == delim:
            delim = None
    body = "\n".join(lines)
    env = dict(re.findall(r"\b([A-Za-z_]\w*)=[\"']?([^\s;&|\"']+)", body))
    flat = QUOTED_RE.sub(lambda m: re.sub(r"[\s<>|;&()]", "_", m.group(0)), body)
    base, out = cwd or repo, []
    for m in BASH_WRITE_RE.finditer(flat):
        t = m.group(1) or m.group(2) or m.group(3) or ((m.group(4) or "").split() or [""])[-1]
        t = re.sub(r"\$\{?(\w+)\}?", lambda v: env.get(v.group(1), v.group(0)), t.strip("\"'"))
        p = os.path.join(base, os.path.expanduser(os.path.expandvars(t)))
        if m.group(1):
            base = p                     # an unresolvable `cd $X` leaves a `$` in base, so what follows is skipped
        elif t and not t.startswith("-") and "$" not in p and _under(p, repo) and not any(
                _under(p, os.path.join(repo, d)) for d in ((ISOLATED_DIR,) if deposits else (ISOLATED_DIR, REPORT_DEPOSIT_DIR, PATCH_DEPOSIT_DIR))):
            out.append(p)
    return out


def _write_path(block):
    """The path a write tool_use targets. NotebookEdit carries `notebook_path`, not `file_path` —
    reading only the latter dropped every notebook write as an empty string (2026-09-07)."""
    inp = block.get("input") or {}
    return inp.get("file_path") or inp.get("notebook_path") or ""


def classify(brief, writes, repo=REPO):
    """-> (is_read_only_dispatch, repo_writes, isolated_writes). The marker beats the prose, always.

    A write is a repo write iff it resolves under the repo root (`_under`); nothing outside counts,
    so no scratch-prefix list is needed (the old one was unreachable dead code once the root test
    landed). Writes under the harness's own isolation trees (`<repo>/.claude/worktrees/`) are
    reported SEPARATELY: an isolated lens writing in the worktree it was given is not a breach of
    the main tree, and the consumer's remedy for a breach is a revert (on a peer's tree)."""
    if brief is None:
        return None, [], []
    ro = bool(RO_RE.search(brief)) and WRITE_DISPATCH_MARKER not in brief
    iso = os.path.join(repo, ISOLATED_DIR)
    inside = [w for w in writes if _under(w, repo)]
    isolated = [w for w in inside if _under(w, iso)]
    # A hub lens writing its PRESCRIBED report (the report step in review-hub/SKILL.md) is not a
    # main-tree breach either, and Step 3's
    # remedy for a breach is a revert — so it is reported beside the isolation writes, never as one.
    deps = [os.path.join(repo, d) for d in (REPORT_DEPOSIT_DIR, PATCH_DEPOSIT_DIR)]
    isolated += [w for w in inside if w not in isolated and any(_under(w, dep) for dep in deps)]
    repo_writes = [w for w in inside if w not in isolated]
    return ro, repo_writes, isolated


def scan(since_epoch):
    rows = []
    for root, _dirs, files in os.walk(PROJECTS):
        if os.path.basename(root) != "subagents":
            continue
        seat = os.path.basename(os.path.dirname(root))[:8]
        for fn in files:
            if not (fn.startswith("agent-") and fn.endswith(".jsonl")):
                continue
            path = os.path.join(root, fn)
            try:
                if os.path.getmtime(path) < since_epoch:
                    continue
            except OSError:
                continue
            brief, writes, bash_n, bash_w, bash_d = None, [], 0, [], []
            for line in open(path, encoding="utf-8", errors="replace"):
                if '"type"' not in line:
                    continue
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                msg = rec.get("message") or {}
                content = msg.get("content")
                if brief is None and rec.get("type") == "user":
                    text = content if isinstance(content, str) else " ".join(
                        b.get("text", "") for b in content
                        if isinstance(b, dict) and b.get("type") == "text"
                    ) if isinstance(content, list) else ""
                    if text:
                        brief = text[:8000]
                if isinstance(content, list):
                    for b in content:
                        if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("name") in WRITE_TOOLS:
                            writes.append(_write_path(b))
                        elif isinstance(b, dict) and b.get("type") == "tool_use" and b.get("name") == "Bash":
                            bash_n += 1
                            c = (b.get("input") or {}).get("command") or ""
                            w = bash_writes(c, rec.get("cwd")); bash_w += w
                            bash_d += [p for p in bash_writes(c, rec.get("cwd"), deposits=True) if p not in w]
            ro, repo_writes, isolated = classify(brief, writes)
            if ro is None:
                continue
            rows.append({"seat": seat, "agent": fn[6:-6], "read_only": ro,
                         "repo_writes": repo_writes, "isolated_writes": isolated,
                         "bash_calls": bash_n, "bash_writes": bash_w, "bash_deposit_writes": bash_d})
    return rows


def self_test():
    cases = [
        ("a read-only brief with no writes", "This is a REVIEW-ONLY consultation.", [], True, 0),
        ("a read-only brief that wrote to the repo", "REVIEW ONLY — do NOT edit any file.",
         [os.path.join(REPO, "src/x.ts")], True, 1),
        ("a read-only brief writing only to scratch is COMPLIANT",
         "read-only", ["/private/tmp/scratch/out.txt"], True, 0),
        ("a WRITE dispatch that merely discusses read-only work is NOT read-only",
         "[scope-owns]: scripts/x.mjs\nBuild the read-only agent class; make no edits elsewhere.",
         [os.path.join(REPO, "scripts/x.mjs")], False, 1),
        ("an ordinary build brief is NOT read-only", "[scope-owns]: a.ts\nImplement the thing.",
         [os.path.join(REPO, "a.ts")], False, 1),
    ]
    failed = 0
    for name, brief, writes, want_ro, want_n in cases:
        ro, rw, _iso = classify(brief, writes)
        ok = (ro == want_ro) and (len(rw) == want_n)
        print(f"  {'PASS' if ok else 'FAIL'}: {name}")
        failed += 0 if ok else 1
    # the discriminating control: the same prose, with and without the marker, must classify differently
    ro_a, _, _ = classify("REVIEW ONLY. Do not edit.", [])
    ro_b, _, _ = classify("[scope-owns]: x.ts\nREVIEW ONLY. Do not edit.", [])
    ok = ro_a is True and ro_b is False
    print(f"  {'PASS' if ok else 'FAIL'}: the marker FLIPS the classification on identical prose")
    failed += 0 if ok else 1
    # the repo root under a scratch prefix (a detached worktree in $TMPDIR) must still count its
    # own writes; a sibling scratch dir beside it must not — the measured 3/6 shape.
    tmp_repo = "/private/tmp/wt-fixture/source-project"
    _, rw_in, _ = classify("REVIEW ONLY.", [tmp_repo + "/src/x.ts"], repo=tmp_repo)
    _, rw_out, _ = classify("REVIEW ONLY.", ["/private/tmp/scratch/out.txt"], repo=tmp_repo)
    ok = len(rw_in) == 1 and len(rw_out) == 0
    print(f"  {'PASS' if ok else 'FAIL'}: a repo rooted under a scratch prefix still sees its own writes (and not its neighbours)")
    failed += 0 if ok else 1
    # ── the containment arms (2026-09-07): each one pins a shape the
    # string-prefix form got wrong, and the sibling-prefix arm pins the trailing-separator anchor,
    # which a mutation matrix found had ZERO coverage (anchor removed -> suite still green).
    extra = [
        ("a sibling directory sharing the root's name as a PREFIX is OUTSIDE (pins the separator anchor)",
         [REPO + "-sibling/src/x.ts"], 0, 0),
        ("a `..` spelling of a repo path is INSIDE",
         [os.path.join(REPO, "..", os.path.basename(REPO), "src", "x.ts")], 1, 0),
        ("a doubled separator is INSIDE",
         [REPO + "//src/x.ts"], 1, 0),
        ("a hub lens's prescribed report deposit is NOT a repo breach",
         [os.path.join(REPO, REPORT_DEPOSIT_DIR, "abc1234-qa-expert.md")], 0, 1),
        ("a write under the harness's isolation trees is ISOLATED, not a repo breach",
         [os.path.join(REPO, ISOLATED_DIR, "wt-fixture", "src", "a.ts")], 0, 1),
    ]
    alias = REPO.swapcase()                 # any letter-bearing root has a case alias
    if alias != REPO and os.path.exists(alias) and os.path.samefile(alias, REPO):  # case-insensitive volume
        extra.append(("a case-alias spelling of the root is INSIDE (same inode, different string)",
                      [alias + "/package.json"], 1, 0))
    firm = "/System/Volumes/Data" + REPO
    if os.path.exists(firm):                # the macOS firmlink spelling of the same inode
        extra.append(("the firmlink spelling of the root is INSIDE (same inode, different string)",
                      [firm + "/package.json"], 1, 0))
    for name, writes, want_repo, want_iso in extra:
        _, rw, iso = classify("REVIEW ONLY.", writes)
        ok = len(rw) == want_repo and len(iso) == want_iso
        print(f"  {'PASS' if ok else 'FAIL'}: {name}")
        failed += 0 if ok else 1
    ok = _write_path({"input": {"notebook_path": "/x.ipynb"}}) == "/x.ipynb" and _write_path({"input": {"file_path": "/y"}}) == "/y"
    print(f"  {'PASS' if ok else 'FAIL'}: NotebookEdit's notebook_path is read as a write target")
    failed += 0 if ok else 1
    # ── the Bash route (after shinpr, report-only): a repo redirect fires; a `$S` scratchpad one does not.
    ok = bash_writes("echo hi > src/x.ts", REPO) == [os.path.join(REPO, "src/x.ts")]
    print(f"  {'PASS' if ok else 'FAIL'}: a Bash redirect into the repo is a bash_write")
    failed += 0 if ok else 1
    ok = bash_writes('S=/private/tmp/scratch; echo hi > "$S/out.txt"', REPO) == []
    print(f"  {'PASS' if ok else 'FAIL'}: a Bash redirect into a $S scratchpad is NOT a bash_write")
    failed += 0 if ok else 1
    # Every noise filter and carve-out on the Bash route gets an arm (a review lens found that each one
    # removed on a copy left this self-test 17/17). Each pair is (command, cwd, expected repo writes).
    W, X = "/private/tmp/w1-wt", os.path.join(REPO, "tests/x.ts")
    for label, cmd, cwd, want in [
        ("a `cd` OUT of the repo moves the base, so a relative write lands outside", f"cd {W} && echo a > tests/x.ts", REPO, []),
        ("a heredoc BODY is data, not a redirect", "cat <<'E' > /private/tmp/o\necho a > tests/x.ts\nE", REPO, []),
        ("a QUOTED `>` is not a redirect", "grep -c 'a > tests/x.ts' f", REPO, []),
        ("`2>file` is not a write the bucket counts", "ls 2>tests/x.ts", REPO, []),
        ("a write inside a harness isolation tree is carved out", "echo a > .claude/worktrees/w/tests/x.ts", REPO, []),
        ("a lens deposit is carved out of bash_writes", "echo a > .claude/state/review-patches/x.diff", REPO, []),
        ("a repo `tee -a` is a bash_write", "echo a | tee -a tests/x.ts", REPO, [X]),
    ]:
        ok = bash_writes(cmd, cwd) == want
        print(f"  {'PASS' if ok else 'FAIL'}: {label}")
        failed += 0 if ok else 1
    ok = bash_writes("echo a > .claude/state/review-patches/x.diff", REPO, deposits=True) == [
        os.path.join(REPO, ".claude/state/review-patches/x.diff")]
    print(f"  {'PASS' if ok else 'FAIL'}: deposits=True REPORTS the deposit write the default carves out")
    failed += 0 if ok else 1
    total = len(cases) + 13 + len(extra)
    print(f"self-test: {total - failed}/{total} pass")
    return 1 if failed else 0


def main():
    args = sys.argv[1:]
    if "--self-test" in args:
        sys.exit(self_test())
    since = "1970-01-01"
    if "--since" in args:
        since = args[args.index("--since") + 1]
    since_epoch = time.mktime(time.strptime(since, "%Y-%m-%d"))
    rows = scan(since_epoch)
    ro = [r for r in rows if r["read_only"]]
    viol = [r for r in ro if r["repo_writes"]]
    wrote_ctrl = [r for r in rows if not r["read_only"] and r["repo_writes"]]
    ctrl_total = [r for r in rows if not r["read_only"]]
    ro_bw = [r for r in ro if r["bash_writes"]]   # REPORT-ONLY: never feeds `viol` or the exit code
    if "--json" in args:
        print(json.dumps({"since": since, "transcripts": len(rows), "read_only": len(ro),
                          "violations": viol, "control_wrote": len(wrote_ctrl),
                          "control_total": len(ctrl_total), "bash_writes": ro_bw}, indent=2))
        sys.exit(1 if viol else 0)
    print(f"read-only brief compliance — sub-agent transcripts active since {since}")
    print(f"  transcripts scanned      : {len(rows)}")
    print(f"  briefed READ-ONLY        : {len(ro)}")
    print(f"  of those, wrote to repo  : {len(viol)}")
    print(f"  CONTROL (write dispatches that did write): {len(wrote_ctrl)} of {len(ctrl_total)}")
    if not ctrl_total or not wrote_ctrl:
        print("  ⚠️  THE CONTROL DID NOT FIRE — a zero above is the instrument, not compliance.")
    print(f"  bash_writes (report-only) : {sum(len(r['bash_writes']) for r in ro)} in {len(ro_bw)} read-only seats"
          f" of {sum(r['bash_calls'] for r in ro)} Bash calls there · all transcripts"
          f" {sum(len(r['bash_writes']) for r in rows)} of {sum(r['bash_calls'] for r in rows)}")
    ro_dep = [r for r in ro if r["bash_deposit_writes"]]
    if ro_dep:   # carved out of bash_writes, never dropped: a lens writes ITS OWN report/patch; read any that is not
        print("\n  DEPOSIT-DIR WRITES by read-only-briefed seats (carved out above; a seat's own report/patch is expected):")
        for r in ro_dep:
            print(f"    seat={r['seat']} agent={r['agent'][:17]}: "
                  + ", ".join(w.replace(REPO + "/", "") for w in r["bash_deposit_writes"][:5]))
    if ro_bw:
        print("\n  BASH-ROUTE REPO WRITES by read-only-briefed seats (report-only — read each; never a VIOLATION):")
        for r in ro_bw:
            print(f"    seat={r['seat']} agent={r['agent'][:17]}: "
                  + ", ".join(w.replace(REPO + "/", "") for w in r["bash_writes"][:5]))
    for r in viol:
        print(f"\n  VIOLATION seat={r['seat']} agent={r['agent'][:17]} writes={len(r['repo_writes'])}")
        for w in r["repo_writes"][:5]:
            print(f"      {w.replace(REPO + '/', '')}")
    seats = {}
    for r in ro:
        seats.setdefault(r["seat"], [0, 0])
        seats[r["seat"]][0] += 1
        seats[r["seat"]][1] += 1 if r["repo_writes"] else 0
    print("\n  per dispatching seat (read-only briefed / of those wrote to repo):")
    for s, (n, v) in sorted(seats.items()):
        print(f"    {s}: {n} / {v}")
    sys.exit(1 if viol else 0)


if __name__ == "__main__":
    main()
