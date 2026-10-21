#!/usr/bin/env python3
"""
defer-trigger-scan.py — deterministic evaluator for todo.txt revisit-trigger `meta:` blocks.

Turns the one-time 8-agent LLM scan of 651 deferred items into a sub-second grep/git
check for the repo-state-checkable subset. Surfaces items whose revisit-trigger
condition has become TRUE (and whose work is not yet done), plus already-done items
that were never checked off (reconcile candidates).

WARN/SURFACE ONLY — never edits todo.txt, never blocks (warn-before-block).

Schema (extends the /orient Step 8 `meta:` block — backward-compatible with the
existing 67 tagged items; new kinds + `done-when:`/`status:` are additive):

  - [ ] DEFER-ID — title
    meta:
      trigger-type: <kind>      # see KINDS below
      trigger: <args>           # args for the kind
      done-when: <kind> <args>  # OPTIONAL — kind-prefixed; item is DONE when TRUE
      status: pending|fired|done  # OPTIONAL — default pending; non-pending skipped
      blocked-on: ...
      loc-estimate: ...

Auto-evaluable kinds (deterministic repo-state):
  date | file-exists | dep-version | lines | git-clean | git-dirty
  | grep-present | grep-absent | commit-touches | on-ref
Not auto-evaluable (counted in coverage, never guessed):
  prod-data-count | manual | external   <- prod-signal-gated; fire from Sentry/PostHog, not here

Predicate `args` formats:
  date           2026-07-21
  file-exists    src/app/api/cron/foo/route.ts
  dep-version    sharp >= 0.35.1
  lines          <path> > 4000
  git-clean      src/services/admin/
  grep-present   <pattern> :: <pathspec> [:: i]     (ERE; i = case-insensitive)
  grep-absent    <pattern> :: <pathspec> [:: i]
  on-ref         <commit-id> [origin/main]          (TRUE iff <commit-ish> has REACHED <ref>; the
                 only kind that can ask "did this LEAVE this machine". Every other kind reads the
                 worktree or local history, so a row whose real finish line is a DEPLOY had no
                 honest predicate and its author picked one that goes TRUE the moment the work is
                 WRITTEN. TWO RESIDUES, both stated: the ref is LOCAL and nothing here fetches, so
                 a stale ref reads FALSE — it fails toward NOT-DONE, the safe direction for an
                 alarm; and on-a-ref is not LIVE, since a deploy can fail after a push. A row that
                 needs PRODUCTION truth still wants `manual` or `prod-data-count`.)
  commit-touches src/components/foo/**              (default: fired iff the path changed AFTER the item's own git-blame date — no window; --since <sha|date> narrows to recent fires)
                 ^^ AUTHORING CAUTION: this predicate is MONOTONIC. The anchor is fixed and commits
                 only accumulate, so once it reads TRUE it can never read FALSE again. On a HOT SHARED
                 path — safe-commit.sh, session-manifest.py, a .claude/rules/ file, anything the fleet
                 edits weekly — it therefore latches TRUE within days and stops carrying any timing
                 information at all: it answers "has anyone touched this since I filed?", never "is my
                 precondition met?". Measured 2026-08-25: 57 of 59 fired triggers were commit-touches,
                 median fired-row age 21 days (max 36), and FOUR separate rows keyed on
                 scripts/safe-commit.sh alone. That is the DECORATED-NEVER shape inverted — an
                 always-fireable trigger is as empty as an unfireable one, and it degrades the scan by
                 filling it with rows nobody reads.
                 ⛔ The remedy is NOT a time window on this predicate. No such number should exist: a
                 trigger that has fired must be visible immediately on /triggers, never behind a special
                 flag for some arbitrary number of hours.
                 A fired trigger is STATE. Comparing
                 against "the last time the scan ran" is that same window wearing a self-resetting
                 costume, and worse: it is invisible, and two seats running the scan get different
                 answers depending on who ran it last.
                 ⇒ Reach for commit-touches ONLY when the watched path is COLD (rarely touched, so a
                 touch is genuinely news). When the path is hot, key the trigger on the thing you are
                 actually waiting for — grep-present/grep-absent on the symbol, file-exists on the
                 artifact, exit-zero on the guard — so the predicate can still go FALSE.
                 Since 2026-09-07 the scan ROUTES a fired commit-touches row into its own LATCHED
                 bucket once the watched path has LATCH_COMMITS distinct commits since the row's
                 anchor — still on the bare scan, never behind a window, but labelled as a row to
                 re-key rather than work to pick up.
  exit-zero      python3 scripts/x.py --self-test   (RUNS it; TRUE on exit 0; opt-in --run-exit-zero;
                                                     the command must be an EXACT member of the curated
                                                     EXIT_ZERO_TARGETS read-only-verified allowlist)

Surface logic per open `- [ ]` item with a meta: block (status==pending):
  RECONCILE  : done-when present AND done-when TRUE              -> propose [x] (work already done)
  DOABLE-NOW : trigger TRUE AND (no done-when OR done-when FALSE) -> the precondition fired, do it
  STALE      : a predicate references a missing path/dep/file    -> loud warning (never a silent no-fire)

Usage:
  python3 scripts/defer-trigger-scan.py [--since <sha|date>] [--include-manual] [--run-exit-zero] [--json]
  python3 scripts/defer-trigger-scan.py --self-test
"""
import os, re, sys, json, subprocess, fnmatch, shlex, signal, time, bisect, tempfile, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TODO = os.path.join(ROOT, "todo.txt")

AUTO_KINDS = {"date","file-exists","dep-version","lines","git-clean","git-dirty",
              "grep-present","grep-absent","commit-touches","exit-zero","on-ref"}
NONAUTO_KINDS = {"prod-data-count","manual","external"}

# LATCHED: a fired
# commit-touches trigger whose watched path has been committed to at least this many DISTINCT times
# since the row's own anchor is a one-way latch that stopped carrying information — it answers
# "has anyone edited this directory?", never "is my precondition met?" (the AUTHORING CAUTION in the
# docstring). Such a row is routed OUT of DOABLE-NOW into its own LATCHED bucket: still on the bare
# scan (a fired trigger is STATE, never behind a window), but labelled as a
# row to RE-KEY rather than work to pick up. The measure is distinct commits since the row's anchor —
# a property of the row and the path, so two seats get the same answer; it is NOT a wall-clock
# window and does not decay — and n is MONOTONE, so a row moves DOABLE -> LATCHED by age alone and
# never back (five of today's 14 doable commit-touches rows cross within ~2 weeks untouched):
# that is intended, since a time window is the rejected alternative. Measured
# 2026-09-07: of 72 doable-now rows, 70 were commit-touches, and the per-ROW commits-since-anchor
# distribution is a CONTINUUM around this value, not bimodal — 16 latched rows sat at n = 10..19 and
# 9 doable rows at 5..9 (the 1,170-commits-in-seven-days figure this comment once cited is the
# per-PATH rate, a different quantity). So the constant matters at the margin:
# the self-test pins it with rows at exactly LATCH_COMMITS and LATCH_COMMITS - 1, and the LATCHED
# banner prints its resolved value, so a reader sees it rather than restating it.
LATCH_COMMITS = 10

# exit-zero: an OPT-IN "run a repo self-test" done-when (TRUE iff the command exits 0). The one
# done-when class a comment cannot satisfy — a state-probe (`grep-present`) can't tell "the guard
# FIRES" from "a token sits in a comment" (the false-RECONCILE). It RUNS a
# command, so THREE fences:
#   (1) OPT-IN — evaluated ONLY under --run-exit-zero; count-not-execute on the default + /orient
#       auto-fire scan (same shape as commit-touches without --since). The scanner's subprocess runs
#       BENEATH any hook that screens the agent's own shell commands (such a hook never sees a Python
#       grandchild), so an unrestricted command would bypass that screening entirely.
#   (2) INJECTION guard — EXIT_ZERO_SHAPE: one scripts/ script + one flag, no shell metachars
#       (shell=False + shlex.split neuter any that slip). Bounds WHICH string can run.
#   (3) SIDE-EFFECT guard — EXIT_ZERO_TARGETS: an EXACT-command allowlist of VERIFIED-PURE self-tests.
#       A flag NAME is NOT a read-only proxy (verified at source): a shape-valid command
#       can still mutate — `node scripts/sentry-provision-alerts.mjs --verify` gates its LIVE Sentry
#       POST on `--dry-run` ONLY, so --verify/--check/--self-test fire a real external write;
#       `backfill-audit-tiers.mjs --check` writes the tracker; `e2e-local.sh --check` docker-rm's a
#       peer's DB + docker-run-d's a detached container that SURVIVES killpg. The shape guard bounds
#       injection, NOT behaviour — only an exact-command allowlist does. Adding a member REQUIRES
#       verifying the target is read-only UNDER THAT EXACT FLAG (grep its arg-handling: is anything
#       but --dry-run gating its writes?). This curation IS the fence — the substitute for the
#       worktree isolation the scanner lacks (it runs on the live tree).
# STRUCK as load-bearing-false: "no network / no writes" (unenforceable in a subprocess) AND "the
# shape allowlist is read-only" (a flag name is not a behaviour proxy). Honest fence = the curated
# exact-command set + timeout. Failure -> None+STALE (loud "inconclusive"), NEVER a silent False.
# exit0 is ground truth only if the target can't go green while broken -> a mutation-valid --self-test.
EXIT_ZERO_TIMEOUT = 10
EXIT_ZERO_SHAPE = re.compile(
    r"^(?:\./scripts/[\w.-]+\.sh|python3 scripts/[\w.-]+\.py|node scripts/[\w.-]+\.mjs)"
    r" (?:--self-test|--check|--dry-run|--verify)$"
)
# EXACT-command allowlist — the side-effect fence. Each member VERIFIED read-only under its exact
# flag (2026-07-16): defer-trigger-scan.py --self-test writes nothing (reads + sys.executable -c);
# wrap-reconcile.mjs --self-test only read-only execSyncs git/ls/head/tail/cat + asserts. Grow ONLY
# after the same per-member verification — a flag that "sounds" read-only is not proof (see above).
EXIT_ZERO_TARGETS = frozenset({
    "python3 scripts/defer-trigger-scan.py --self-test",
    "node scripts/wrap-reconcile.mjs --self-test",
    # VERIFIED-PURE 2026-07-19: reads the always-loaded band files +
    # prints + exits — zero writeFileSync/appendFile/unlink/execSync/spawn (grepped). The
    # `--check` flag is ignored by the script (only --self-test branches) — it exists to
    # satisfy the EXIT_ZERO_SHAPE flag requirement. Consumer: a tracker row's
    # done-when (exit 0 = band back under its byte ceiling).
    "node scripts/check-band-budget.mjs --check",
    # VERIFIED-PURE 2026-08-14 per the per-member contract above, under THIS EXACT FLAG:
    # imports are json/os/glob/sys/math/re/datetime — no subprocess, no shutil, no network
    # module; exactly ONE open() call (`:139`, default read mode); zero write/rename/unlink/
    # makedirs/chmod/os.system/popen/exec/eval. --check globs ~/.claude/projects/*.jsonl,
    # reads each, and exits 0 iff a human should look. Consumer: a tracker row.
    # NOTE its real firing path is .claude/hooks/session-start.sh, which needs no flag
    # — this entry only makes `/triggers --run-exit-zero` agree instead of printing a refusal.
    "python3 scripts/band-o-echo-scan.py --check",
})


def _run(cmd):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)


def _exec_exit_zero(parts):
    """Run an allowlisted command in its OWN process group (start_new_session) so a timeout kills
    grandchildren too, not just the direct child. exit 0 -> (True, not-stale); exit N -> (False,
    not-stale); exec-failure / timeout -> (None, STALE) — the loud 'inconclusive', never a silent
    False. `parts` is already shape-validated + shlex-split by the caller; run with shell=False."""
    try:
        proc = subprocess.Popen(parts, cwd=ROOT, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, start_new_session=True)
    except OSError as e:
        return None, True, f"exit-zero exec error: {e}"
    try:
        proc.communicate(timeout=EXIT_ZERO_TIMEOUT)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)  # whole group, not just the child
        except (ProcessLookupError, PermissionError):
            proc.kill()
        proc.communicate()
        return None, True, f"exit-zero timeout (>{EXIT_ZERO_TIMEOUT}s): {' '.join(parts)}"
    return (proc.returncode == 0), False, f"exit {proc.returncode}: {' '.join(parts)}"


def _cmp_semver(a, b):
    pa = [int(x) for x in re.findall(r"\d+", a)[:3]]
    pb = [int(x) for x in re.findall(r"\d+", b)[:3]]
    pa += [0] * (3 - len(pa)); pb += [0] * (3 - len(pb))
    return (pa > pb) - (pa < pb)


def _cmp_op(left, op, right):
    return {">":left>right, ">=":left>=right, "<":left<right, "<=":left<=right,
            "==":left==right, "=":left==right, "!=":left!=right}.get(op)


def _grep(kind, args):
    parts = [p.strip() for p in args.split("::")]
    if len(parts) < 2:
        return None, True, f"bad grep args: {args}"
    pattern, pathspec = parts[0], parts[1]
    flags = parts[2] if len(parts) > 2 else ""
    paths = pathspec.split()
    missing = [p for p in paths if not os.path.exists(os.path.join(ROOT, p))]
    if missing:
        return None, True, f"missing path(s): {missing}"
    cmd = ["grep", "-rE"] + (["-i"] if "i" in flags else []) + ["-l", "--", pattern] + paths
    r = _run(cmd)
    if r.returncode == 2:
        return None, True, f"grep error: {r.stderr.strip()[:60]}"
    present = (r.returncode == 0)
    state = present if kind == "grep-present" else (not present)
    # Display in the INPUT grammar, not a prose paraphrase: authors demonstrably learn the
    # done-when syntax from scan output (2026-08-02: four rows filed with `done-when: none` /
    # `done-when: absent: /X/ in Y` — the OLD display form — all STALE on the next scan). A
    # pretty-printer that emits copy-pasteable source kills the mimicry class at zero cost.
    return state, False, (f"{'present' if present else 'absent'} "
                          f"(source form: `{kind} {pattern} :: {pathspec}`)")


_BLAME_TS = None   # {todo.txt line_no: committer-time} — the item's own filing/last-write date
_TOUCH = None      # {repo-relative file: newest commit-time} since the oldest todo.txt line
_COMMITS = None    # [(sha, commit-time, [files])] from the SAME git-log pass — per-commit, for the LATCH count
_LATCH_CACHE = {}  # {pathspec-tuple: sorted commit-times touching it} — one pass per distinct pathspec


def _blame_line_ts():
    """Per-line committer-time of todo.txt via ONE `git blame --line-porcelain` pass.
    An uncommitted line blames to the 0000000 boundary with a now-ish time -> reads
    'filed just now' -> its commit-touches trigger is NOT fired yet (correct)."""
    global _BLAME_TS
    if _BLAME_TS is None:
        _BLAME_TS = {}
        r = _run(["git", "blame", "--line-porcelain", "--", TODO])
        if r.returncode == 0:
            sha_ts, cur_sha, cur_line = {}, None, None
            for ln in r.stdout.split("\n"):
                m = re.match(r"^([0-9a-f]{40}) \d+ (\d+)", ln)
                if m:
                    cur_sha, cur_line = m.group(1), int(m.group(2))
                    if cur_sha in sha_ts:
                        _BLAME_TS[cur_line] = sha_ts[cur_sha]
                elif ln.startswith("committer-time ") and cur_sha is not None:
                    sha_ts[cur_sha] = int(ln.split()[1])
                    _BLAME_TS[cur_line] = sha_ts[cur_sha]
    return _BLAME_TS


def _touch_map():
    """{file: newest commit-time} from ONE `git log --name-only` pass bounded by the
    OLDEST surviving todo.txt line (a safe superset of every item's anchor). First
    occurrence wins (log is newest-first)."""
    global _TOUCH, _COMMITS
    if _TOUCH is None:
        _TOUCH, _COMMITS = {}, []
        _LATCH_CACHE.clear()
        blame = _blame_line_ts()
        oldest = min(blame.values()) if blame else int(time.time())
        # %H beside %ct so the SAME pass also yields a per-commit file list (_COMMITS) for the
        # LATCH count — a file-level map cannot count commits, and a second log pass over the
        # same range would double the scan's dominant cost for nothing. `@epoch`, never a bare
        # local date: a bare date means that date at the CURRENT clock time (bash-environment.md),
        # so the oldest anchor's own day was cut at the wall clock.
        # `oldest` is a real blame time (>= this repo's first commit), which matters: git returns
        # NOTHING for `--since=@<epoch>` below ~10^9 (measured 2026-09-07; the self-test fixture notes it).
        r = _run(["git", "log", f"--since=@{oldest}", "--pretty=format:%H %ct", "--name-only"])
        if r.returncode == 0:
            _TOUCH, _COMMITS = _parse_touch_log(r.stdout)
    return _TOUCH


def _parse_touch_log(text):
    """Parse `git log --pretty=format:%H %ct --name-only` output into ({file: newest commit-time},
    [(sha, ts, [files])]). Split out of _touch_map so the self-test can drive it with a synthetic
    log AND with a real one from a scratch repo (the self-test stubs the
    caches, so _touch_map's body — this parse and the ledger — never ran under it, and a
    one-character change to the header regex took the live corpus from 71 doable-now to 1 with
    --self-test printing 100/100 at rc=0)."""
    touch, commits, cur = {}, [], None
    for ln in text.split("\n"):
        s = ln.strip()
        m = re.fullmatch(r"([0-9a-f]{40}) (\d{9,})", s)
        if m:
            cur = int(m.group(2))
            commits.append((m.group(1), cur, []))
        elif s and cur is not None:
            touch.setdefault(s, cur)
            commits[-1][2].append(s)
    return touch, commits


def _commits_since(pats, ts0):
    """DISTINCT commits after ts0 that touched ANY path matching pats — the LATCH measure.
    A commit touching six files under `plans/` counts ONCE; a file-level count would read one
    sweep commit as six latches. Per distinct pathspec the matching commit-times are collected
    once and bisected, so 70 fired rows over ~30 distinct pathspecs cost ~30 passes, not 70."""
    _touch_map()
    key = tuple(pats)
    if key not in _LATCH_CACHE:
        _LATCH_CACHE[key] = sorted(
            t for _sha, t, files in (_COMMITS or [])
            if any(_path_matches(f, p) for f in files for p in pats))
    ts = _LATCH_CACHE[key]
    return len(ts) - bisect.bisect_right(ts, ts0)


def _item_anchor_ts(item_line, item_span):
    """MIN git-blame timestamp across an item's whole block — the SAME anchor the
    commit-touches predicate computes inline (see eval_predicate), reused here so the
    doable-now bucket can be aged and sorted without changing eval_predicate's return
    signature (it is called from ~a dozen sites). Returns None when blame has no date.

    ⚠️ This is the row's OWN last-written date, NOT when its trigger fired. A trigger
    fires at the first watched-path touch AFTER this anchor, which is strictly later.
    Render it as "row last written N days ago" and never as "fired N days ago" — the
    two differ by however long the row sat before something touched its watched path.
    """
    bm = _blame_line_ts()
    tss = [t for t in (bm.get(l) for l in range(item_line, item_line + max(item_span, 1)))
           if t is not None]
    return min(tss) if tss else None


def _path_matches(f, p):
    """Match a changed path F against a todo trigger pathspec P.

    Two corpus-specific corrections over bare fnmatch, both MEASURED dead 2026-08-26
    (13 of 131 commit-touches triggers matched ZERO of 6,529 tracked files while
    passing the shape validator above, i.e. read as coverage and could never fire):

    1. BRACKETS ARE LITERAL HERE. This is a Next.js App Router tree, so dynamic-route
       segments (`[locale]`, `[id]`, `[token]`) appear in real paths — but fnmatch reads
       `[locale]` as a CHARACTER CLASS matching one char of {l,o,c,a,e}. The failure is
       total and silent: even an EXACT literal path fails to match itself
       (`fnmatch("src/app/[locale]/x.tsx", "src/app/[locale]/x.tsx")` is False).
       No trigger in this corpus wants a character class, so `[` is escaped to `[[]`.
    2. A GLOB-FREE PATTERN IS A PATH OR A DIRECTORY PREFIX, never a pattern. `messages/`
       and `src/lib/email` are how authors write "anything under here"; fnmatch matches
       neither, because a changed path is always `messages/en.json`, never `messages/`.
    """
    if "*" not in p and "?" not in p:
        # LITERAL branch: compare the RAW pattern. (Escaping before this compare was the
        # first version of this fix and it silently changed nothing — an escaped pattern
        # never equals the raw path it names. Caught only because the dead-trigger count
        # moved 13 -> 8 instead of 13 -> 0; partial movement reads as confirmation.)
        d = p.rstrip("/")
        return f == d or f.startswith(d + "/")
    return fnmatch.fnmatch(f, p.replace("[", "[[]"))

def eval_predicate(kind, args, since=None, run_checks=False, item_line=None, item_span=1):
    """returns (state: True/False/None, stale: bool, detail: str).
    run_checks gates the exit-zero kind (execution) — off on the default/auto-fire scan.
    item_line anchors commit-touches to the item's own blame date on the default scan."""
    args = (args or "").strip()
    # FAIL-CLOSED on a malformed row. Every AUTO kind needs args; without this guard an
    # empty `args` reaches the predicate and can evaluate TRUE by accident — `date` was the
    # live case: `today >= ""` is True for every date, so a row whose args failed to parse
    # reported DOABLE-NOW forever, on any date, including dates in the future.
    # How args go missing: the schema key is `trigger:`, but three tracker rows wrote
    # `trigger date: <value>`, which parses as the key `trigger date` -> `mf.get("trigger")`
    # returns "". All three happen to be CLOSED rows, so the bug never fired on a live one —
    # the next author to copy that shape would have been the first, and would have seen the
    # trigger appear in the scan output and read the false positive as proof it worked.
    # MALFORMED must be visibly STALE, never silently TRUE. (2026-07-30)
    #
    # ⚠️ `git-clean` WAS EXEMPTED HERE AND THE EXEMPTION IS GONE (same day, refuted twice).
    # Its stated rationale — "the one AUTO kind whose predicate needs no argument; empty args
    # means the whole repo" — is FALSE. Measured: `git status --porcelain -- ""` →
    # `fatal: empty string is not a valid pathspec. please use . instead` (git 2.50.1). The
    # author's absolution stopped at `os.path.exists(ROOT + "")`, which passes because it
    # resolves to the repo root, and never asked what git does with the empty pathspec one
    # line later. The exemption was harmless only by ACCIDENT of git erroring into the stale
    # branch — never by design. It was also asymmetric: `git-dirty`, its identical sibling on
    # THIS SAME code branch, was never exempted, and nobody could say why.
    # A fresh-context breaker proved it decorative (delete it → self-test still green: presence
    # and absence both green) and showed the exemption's own stated rationale, if
    # actually implemented, would REOPEN silent-TRUE on a clean repo — the exact class this
    # guard closes. An empty pathspec IS malformed; it now reads that way.
    if not args and kind in AUTO_KINDS:
        return None, True, f"MALFORMED: `trigger-type: {kind}` with empty args — the schema key is `trigger:` (a `trigger {kind}:` line parses as a different key and yields no args)"
    try:
        if kind == "date":
            today = _run(["date", "+%Y-%m-%d"]).stdout.strip()
            return (today >= args), False, f"today {today} >= {args}"
        if kind == "file-exists":
            return os.path.exists(os.path.join(ROOT, args)), False, args
        if kind == "lines":
            toks = args.rsplit(None, 2)
            if len(toks) != 3:
                return None, True, f"bad lines args: {args}"
            path, op, n = toks
            fp = os.path.join(ROOT, path)
            if not os.path.exists(fp):
                return None, True, f"missing path: {path}"
            cnt = sum(1 for _ in open(fp, encoding="utf-8", errors="ignore"))
            return _cmp_op(cnt, op, int(n)), False, f"{cnt} lines {op} {n}"
        if kind == "dep-version":
            toks = args.split()
            if len(toks) != 3:
                return None, True, f"bad dep-version args: {args}"
            mod, op, ver = toks
            pj = os.path.join(ROOT, "node_modules", mod, "package.json")
            if not os.path.exists(pj):
                return None, True, f"dep not installed: {mod}"
            cur = json.load(open(pj)).get("version", "0")
            return _cmp_op(_cmp_semver(cur, ver), op, 0), False, f"{mod} {cur} {op} {ver}"
        if kind in ("git-clean", "git-dirty"):
            if not os.path.exists(os.path.join(ROOT, args)):
                return None, True, f"missing pathspec: {args}"
            r = _run(["git", "status", "--porcelain", "--", args])
            if r.returncode != 0:  # non-repo / corrupt index: don't read empty stdout as "clean"
                return None, True, f"git error: {r.stderr.strip()[:60]}"
            clean = (r.stdout.strip() == "")
            return (clean if kind == "git-clean" else not clean), False, ("clean" if clean else "dirty")
        if kind == "on-ref":
            # "has this commit REACHED the shared branch" — the one question no other kind can ask.
            # Every existing kind reads the WORKTREE or LOCAL history, so a row whose real finish
            # line is a DEPLOY had no honest predicate and its author picked one that goes TRUE the
            # moment the work is WRITTEN, staying TRUE through the entire deploy gap the row exists
            # to police. One tracker row hit that THREE times, and the third attempt was
            # worse than early: it SUPPRESSED the row's own date alarm, because scan() evaluates the
            # RECONCILE branch before the fired-trigger branch, so a TRUE done-when short-circuits
            # DOABLE-NOW. Hence this kind (`/push`'s verify-landed step already runs this
            # exact predicate — it simply was not a kind).
            #
            # ⚠️ TWO RESIDUES, stated here rather than discovered later. This kind is strictly better
            # than any existing one for a deploy row and is still NOT a truth-claim about production:
            #   (1) the ref is LOCAL and nothing here fetches — the scanner runs on the bare /orient
            #       and /wrap path and a network call per scan is not acceptable. A stale ref reads
            #       NOT-an-ancestor -> FALSE -> the row stays OPEN. It fails toward NOT-DONE, which
            #       is the safe direction for an alarm.
            #   (2) on-a-ref is not LIVE. A deploy can fail after a push. A row that needs PRODUCTION
            #       truth still wants `manual` or `prod-data-count`.
            toks = args.split()
            if len(toks) not in (1, 2):
                return None, True, (f"bad on-ref args: expected '<commit-ish> [<ref>=origin/main]', "
                                    f"got: {args[:60]}")
            sha, ref = toks[0], (toks[1] if len(toks) == 2 else "origin/main")
            # Resolve BOTH sides BEFORE asking the question. `merge-base --is-ancestor` exits 128 on
            # an unknown rev, so reading a bare rc!=0 as "not an ancestor" would turn a rotted sha
            # into a confident FALSE that can never fire — an alarm silently welded shut. Classified
            # as the ROW's own rot (STALE), not an instrument failure, on the same call as `:429`'s
            # `missing path:` for a rotted exit-zero target: one bad row must not void a whole run.
            for label, rev in (("commit", sha), ("ref", ref)):
                if _run(["git", "cat-file", "-e", rev + "^{commit}"]).returncode != 0:
                    return None, True, (f"missing {label}: {rev} — on-ref names a commit-ish this "
                                        f"repo cannot resolve")
            r = _run(["git", "merge-base", "--is-ancestor", sha, ref])
            if r.returncode not in (0, 1):  # 0=ancestor, 1=not; anything else is a real git failure
                return None, True, f"git error: {r.stderr.strip()[:60]}"
            on = (r.returncode == 0)
            # The staleness caveat belongs ONLY on a remote-tracking ref — that is the one whose
            # freshness depends on a fetch this scanner deliberately does not perform. Appending it
            # to every FALSE would state it of a plain sha too, where it is simply untrue.
            caveat = " (LOCAL remote-tracking ref — only as fresh as the last fetch)" if ref.startswith("origin/") else ""
            return on, False, (f"{sha} is on {ref}" if on else f"{sha} NOT on {ref}{caveat}")
        if kind in ("grep-present", "grep-absent"):
            return _grep(kind, args)
        if kind == "commit-touches":
            # Pattern hygiene (found by the 2026-07-30 negative control): a
            # prose-bearing trigger value fnmatches NOTHING and dies silently-forever. Accept
            # one or more space-separated PATHSPEC-looking tokens (multi-path = fires on ANY,
            # same convention as grep-present); anything else is a rotted meta block -> STALE.
            pats = args.split()
            if not all(re.fullmatch(r"[A-Za-z0-9_.()\[\]*/-]+", p) for p in pats):
                return None, True, f"prose in commit-touches trigger — use bare pathspec(s): {args[:60]}"
            # REACHABILITY, not shape (2026-08-26). The old second clause was `("/" in p or
            # "." in p)` — a SHAPE test standing in for a reachability test, and it admitted
            # 13 of 131 triggers that matched ZERO of 6,529 tracked files. It also REJECTED
            # `plans`, a real directory, as prose. A glob-free token must name something that
            # exists; a globbed one cannot be checked cheaply and is accepted as before.
            missing = [p for p in pats
                       if "*" not in p and "?" not in p
                       and not os.path.exists(os.path.join(ROOT, p.rstrip("/")))]
            if missing:
                return None, True, f"pathspec does not exist: {' '.join(missing)[:60]}"
            if not since:
                # DEFAULT (a fired trigger is STATE — visible on the
                # bare scan, no arbitrary window): fired iff a watched path changed AFTER the
                # item's OLDEST surviving block line (MIN git-blame across the whole block).
                # Anchoring on the TITLE line alone let any title edit — dominantly bulk-triage
                # rewrites, not author re-evaluation — zero the item's history and silently
                # un-fire it (two rows had their history erased that way).
                # Calls the SAME helper the doable-now age uses, so the fire decision and the
                # reported age cannot disagree. An earlier version shipped this derivation duplicated
                # byte-for-byte, on the reasoning that the anchor had to flow OUT of here to the
                # new consumer. It flows the other way — the helper is called BY eval_predicate,
                # so no call site learns anything changed.
                ts0 = _item_anchor_ts(item_line, item_span)
                if ts0 is None:
                    return None, True, "no blame date for item block (blame failed?)"
                hits = sorted((t, f) for f, t in _touch_map().items()
                              if t > ts0 and any(_path_matches(f, p) for p in pats))
                anchored = time.strftime("%Y-%m-%d", time.localtime(ts0))
                if hits:
                    return True, False, f"{args} touched after item anchor {anchored} (e.g. {hits[-1][1]})"
                return False, False, f"{args} untouched since item anchor {anchored} (oldest block line)"
            # explicit --since = a NARROWING view (e.g. the /wrap "did-this-window-unblock"
            # delta) — accept a SHA/ref (rev range) OR an ISO date / "N days ago"
            if re.match(r"^\d{4}-\d{2}-\d{2}$", since) or "ago" in since:
                gitlog = ["git", "log", f"--since={since}", "--name-only", "--pretty=format:"]
            else:
                gitlog = ["git", "log", f"{since}..HEAD", "--name-only", "--pretty=format:"]
            r = _run(gitlog)
            if r.returncode != 0:  # a bad --since SHA errors to empty stdout: don't read as "no match"
                return None, True, f"git error: {r.stderr.strip()[:60]}"
            files = [f for f in r.stdout.split("\n") if f.strip()]
            # NOTE: fnmatch `*` CROSSES `/` (POSIX) — `src/*.ts` also matches nested files.
            # Write `dir/**` for recursive intent (the schema examples' convention); a bare
            # single-`*` pattern expecting non-recursive will over-match (a false DOABLE, which
            # is then human-verified — surface-only). Keep patterns `dir/**`-shaped.
            return any(_path_matches(f, p) for f in files for p in pats), False, f"{args} since {since}"
        if kind == "exit-zero":
            # RUNS a command -> three fences (see EXIT_ZERO_TARGETS header). Fence 1: opt-in.
            if not run_checks:
                return None, False, "needs --run-exit-zero (opt-in; not run on the default scan)"
            # Fence 2 (INJECTION): shape guard — one scripts/ target + one flag, no shell.
            if ".." in args or not EXIT_ZERO_SHAPE.match(args):
                return None, True, ("unsafe exit-zero shape — allowed: '<./scripts/x.sh|python3 "
                                    "scripts/x.py|node scripts/x.mjs> "
                                    "--self-test|--check|--dry-run|--verify': " + args[:70])
            # Fence 3 (SIDE-EFFECT): the flag name is NOT a read-only proxy — only an EXACT verified-
            # pure target runs (a shape-valid --check/--verify can POST live / write; see header).
            if args not in EXIT_ZERO_TARGETS:
                return None, True, ("not an allowlisted exit-zero target — add to EXIT_ZERO_TARGETS "
                                    "ONLY after verifying it is read-only under this exact flag: " + args[:70])
            parts = shlex.split(args)
            script_rel = parts[1] if parts[0] in ("python3", "node") else parts[0]
            script_abs = os.path.realpath(os.path.join(ROOT, script_rel))
            scripts_dir = os.path.realpath(os.path.join(ROOT, "scripts"))
            if not script_abs.startswith(scripts_dir + os.sep) or not os.path.exists(script_abs):
                # ⛔ PREFIXED `missing path:`, AND THE PREFIX IS THE CLASSIFICATION. This used to
                # read "exit-zero target missing / escapes scripts/", which the family key
                # `exit-zero ` then swept into INSTRUMENT FAILURE — a bucket whose whole meaning
                # is "no reading below this line is valid". But this branch fires when the row's
                # own predicate names a script that is not there, which is exactly what `:333`
                # calls `missing path:` and routes to STALE. Identical situation, opposite
                # severity, decided by nothing but which words the string happened to start with.
                # The family key would also catch this branch, as a bonus; that is
                # an over-capture, and one rotted row should not void a whole scan.
                return None, True, (f"missing path: {script_rel} (an allowlisted exit-zero target "
                                    f"that is absent from scripts/ or escapes it)")
            # TOCTOU: exec the RESOLVED inode, not the un-resolved parts[0] (check + use same file).
            exec_parts = ([parts[0], script_abs] + parts[2:]
                          if parts[0] in ("python3", "node") else [script_abs] + parts[1:])
            return _exec_exit_zero(exec_parts)
        if kind in NONAUTO_KINDS:
            return None, False, "not auto-evaluable"
    except Exception as e:  # noqa: BLE001 — eval must never crash the scan
        return None, True, f"eval error: {e}"
    return None, True, f"unknown kind: {kind}"


# --- CITED-PATH VALIDATION (row BODY, not the `meta:` block) -------------------
# The STALE bucket only ever checked the `meta:` block — a path an author wrote AS a
# predicate. A row's BODY cites paths constantly (the evidence, the fix site, the
# sibling) and NOTHING checked those, so a body path could name a file that no longer
# exists and the row read as actionable forever. Measured 2026-08-08: a row cited
# `components/project-card.tsx`, which does not exist (the file is
# `components/dashboard/project-card.tsx`) — the line number was right and the
# directory was not, so the supporting evidence read as unverifiable when it was
# merely mis-addressed.
#
# ⚠️ WARN-SURFACE with an ACCEPTED-FP posture (same as /hanging-work Check 12). A row
# may legitimately cite a path that is gone — a historical reference, a deleted file
# named as history. The negation-marker filter below suppresses the explicit ones
# ("was cited as X, which does not exist"); the residual is read by a human, never
# auto-fixed. This detector CANNOT see line-number drift (`:679` → `:786`) because no
# expected content is recorded to compare against — that half of the class stays human.
_CITE_RE = re.compile(r"`([^`\s]+?)(?::\d+(?:-\d+)?)?`")
_NEG_MARKERS = ("does not exist", "no longer exist", "was cited", "re-derived",
                "corrected", "renamed", "moved to", "deleted", "retired", "removed",
                "drift", "stale",
                # ABSENCE-ASSERTION forms (added 2026-08-19). The markers above all
                # describe a path that USED to exist; a row can equally cite a path to
                # assert it NEVER did — "there is no `supabase/config.toml` and no
                # uploader" is the row DOING its job, and the scanner flagged it on
                # every run. Measured on a tracker row whose
                # three config.toml mentions are all negative. Narrow on purpose: a
                # bare "no " would suppress most of the corpus.
                "there is no", "still no")


def cited_paths(line_text):
    """Repo-relative FILE-path candidates cited in backticks on one line.

    Deliberately narrow — a false NEGATIVE costs nothing (the human still reads the
    row), a false POSITIVE costs attention on every scan. Requires a `/` and a real
    extension; rejects globs, absolute paths, URLs and flags.
    """
    out = []
    for m in _CITE_RE.finditer(line_text):
        tok = m.group(1)
        if "/" not in tok:
            continue
        if tok.startswith(("/", "~", "-", "http", "@/")):   # "@/..." is a TS alias, not a path
            continue
        # ⛔ `[]` IS NOT A GLOB IN THIS REPO — it is the App Router. 156 tracked `src/app`
        # paths carry brackets (`[locale]`, `[id]`, `[token]`), so a filter written for globs
        # made the entire route tree structurally invisible. Same shape as the codified git
        # pathspec trap in bash-environment.md. Keep the true wildcards; drop `[]{}`.
        if any(c in tok for c in "*?{}$ <>\"'"):
            continue
        if "::" in tok:                                  # `file.ts::symbol` is a symbol cite
            continue
        if tok.startswith((".claude/logs/", ".claude/state/", ".next/")):
            continue                                     # runtime artifacts: gitignored, absent by default
        base = tok.rsplit("/", 1)[-1]
        # ⚠️ THE EXTENSION REQUIREMENT STAYS — the review asked me to drop it (correctly noting
        # that tracked extensionless files like `.githooks/pre-push` are excluded) and I MEASURED
        # the drop: flags went 5 -> 13 and every new one was a false positive — App Router ROUTE
        # citations (`gallery/[id]`), error codes (`missing/invalid-input-secret`), scheme-less
        # URLs (`<vendor-docs-host>/build/...`), multi-line cites (`page.tsx:202/423/871`).
        # Losing `.githooks/pre-push` is a false NEGATIVE and those are free here: the human still
        # reads the row. A false POSITIVE is paid on every scan. Finding accepted, remedy declined.
        if "." not in base or base.startswith("."):
            continue
        if len(base.split(".")[0]) <= 1:                 # x.py / a.txt — doc placeholders
            continue
        out.append(tok)
    return out


_TRACKED = None


def _tracked_paths():
    """Every git-tracked path, once. Used for the SUFFIX check below."""
    global _TRACKED
    if _TRACKED is None:
        r = _run(["git", "-C", ROOT, "ls-files"])
        if r.returncode != 0 or not r.stdout.strip():
            # FAIL LOUD, never memoize an empty set: an empty tracked list silently disables
            # every suffix rescue and turns the bucket into a flood of false positives.
            raise RuntimeError("defer-trigger-scan: `git ls-files` returned nothing — "
                               "cannot validate cited paths; refusing to report a dead-path verdict")
        _TRACKED = tuple(r.stdout.split("\n"))
    return _TRACKED


def dead_cited_paths(block_lines):
    """Cited paths in a row body that resolve to NO file on disk.

    ⚠️ THE SUFFIX CHECK IS WHAT MAKES THIS SHIPPABLE, and it was added after measuring.
    A first cut keyed on `os.path.exists` alone flagged 38 rows, of which the large
    majority were one FP class: authors cite a PARTIAL path — `callback/route.ts`,
    `terms/page.tsx`. Those are perfectly good citations; only the prefix is elided. So
    a candidate is DEAD only when no tracked path ENDS with it. An always-noisy gate is
    a disabled gate (`nextjs.md`), and 38-mostly-FP is exactly that.
    """
    dead = []
    tracked = _tracked_paths()
    for l in block_lines:
        low = l.lower()
        if any(mk in low for mk in _NEG_MARKERS):
            continue
        for pth in cited_paths(l):
            if os.path.exists(os.path.join(ROOT, pth)):
                continue
            # ⛔ THE RESCUE MUST BE UNIQUE. `docs/architecture.md` is genuinely dead (no root
            # `docs/architecture.md`) and was silently rescued by `.claude/docs/architecture.md`.
            # Root `docs/` exists with 6 tracked files, so a root-relative `docs/X` is an
            # ordinary citation — the ambiguous-tail class is reachable, not exotic. Requiring
            # exactly one hit keeps all 26 live rescues and flags the ambiguity.
            suffix = "/" + pth
            hits = [t for t in tracked if t == pth or t.endswith(suffix)]
            if len(hits) == 1:
                continue
            dead.append(pth)
    return sorted(set(dead))


def parse_blocks(text):
    lines = text.split("\n")
    n = len(lines)
    is_cb = lambda l: re.match(r"^\s*-\s*\[[ xX✅~]", l)
    is_hdr = lambda l: re.match(r"^#{1,6}\s", l)
    blocks, i = [], 0
    while i < n:
        if re.match(r"^\s*-\s*\[ \]", lines[i]):
            start, j = i, i + 1
            while j < n and not is_cb(lines[j]) and not is_hdr(lines[j]):
                j += 1
            blocks.append((start + 1, lines[start:j]))
            i = j
        else:
            i += 1
    return blocks


def meta_read_lines(block_lines):
    """The indices of the lines meta_fields() actually reads: the first `meta:` line's block, walking
    forward past blanks and stopping at the first line indented no deeper than `meta:`. A
    `trigger-type:` anywhere else in the row is unread."""
    read, mindent = set(), None
    for idx, l in enumerate(block_lines):
        if mindent is None:
            if re.match(r"^\s*meta:\s*$", l):
                mindent = len(l) - len(l.lstrip())
            continue
        if not l.strip():
            continue
        if len(l) - len(l.lstrip()) <= mindent:
            break
        read.add(idx)
    return read


def meta_fields(block_lines):
    out, mi, mindent = {}, None, None
    for idx, l in enumerate(block_lines):
        if re.match(r"^\s*meta:\s*$", l):
            mi, mindent = idx, len(l) - len(l.lstrip()); break
    if mi is None:
        return out
    for l in block_lines[mi + 1:]:
        if not l.strip():
            continue
        if len(l) - len(l.lstrip()) <= mindent:
            break
        m = re.match(r"^\s*([a-z-]+):\s*(.*)$", l)
        if m:
            out[m.group(1)] = m.group(2).strip()
    return out


# ⛔ MODULE SCOPE, NOT NESTED INSIDE scan() — so the self-test can consume the REAL symbol
# rather than a re-typed copy of the tuple. The exit-zero members below are UNREACHABLE from a
# synthetic todo.txt fixture (the kind is opt-in behind --run-exit-zero AND allowlisted to
# EXIT_ZERO_TARGETS), so a scan()-level arm cannot cover them at all; a table over this
# predicate can, and it is the whole census in one place.
#
# THE FAMILY, AND EVERY ADDITION HAS COME FROM SOMEONE ELSE READING THE CODE:
#   git error:       :351 git clean/dirty rc != 0 · :403 commit-touches with a bad --since
#   grep error:      :187 _grep rc == 2
#   eval error:      :437 the blanket `except Exception` — the catch-all, so the most important
#   no blame date    :388 commit-touches on the bare path
#   exit-zero        :149 exec failure · :158 timeout — ADDED 2026-09-07
#
# ⛔ DELIBERATELY OUT OF THE FAMILY, and all three say `exit-zero` in their text, so a
# widening to a bare `exit-zero` substring would sweep every one of them into VOID:
#   :416 unsafe exit-zero shape …          the author wrote a malformed predicate
#   :422 not an allowlisted exit-zero …    the author named an un-allowlisted target
#   :429 missing path: … (exit-zero …)     the row points at a script that is not there
# All three are AUTHOR ERRORS — a rotted `meta:` block, which is what STALE means here.
# ⛔ WHAT KEEPS THEM OUT IS THAT `_is_instrument_failure` IS A **PREFIX** TEST, NOT THE
# TRAILING SPACE. This comment claimed the space was load-bearing and the mutation refuted it
# within a minute: dropping it (`"exit-zero"`) leaves the suite at 79/79, because none of the
# three BEGINS with the token — they say `exit-zero` mid-sentence. The widening that does
# reach them is `startswith` -> a substring test, and that REDs all three. Worth writing down
# because the wrong version reads like the careful one, and the census arms below are pinned
# against the real mutation rather than the plausible-sounding one.
#
# The exit-zero pair is the sharpest of the six because THE CODE ALREADY NAMED THE CLASS AND I
# did not connect it: `_exec_exit_zero`'s own docstring reads "exec-failure / timeout -> (None,
# STALE) — the loud 'inconclusive', never a silent False", and "the loud inconclusive" IS this
# bucket. A TIMEOUT is the worst member — a predicate that RAN and did not finish reported as a
# stale row somebody should go and fix.
#
# The key is the FAMILY prefix `exit-zero `, not the two full strings, and that is safe by
# construction rather than by hope: the success path of `_exec_exit_zero` returns `exit N: …`,
# never `exit-zero …`, verified by running all three branches. Same reasoning as the residue
# scanner's `[Owner-authorized` key — a tuple built from the strings you happen to have seen
# misses the sibling that has not fired yet.
INSTRUMENT_FAILURE_PREFIXES = ("git error:", "grep error:", "eval error:", "no blame date",
                               "exit-zero ")


def _is_instrument_failure(detail):
    """True iff `detail` reports a predicate that could not be EVALUATED (as opposed to one that
    evaluated to a genuine STALE — a missing path, a malformed arg). The distinction decides
    whether a row is a worklist item or evidence the whole run is void."""
    return isinstance(detail, str) and detail.startswith(INSTRUMENT_FAILURE_PREFIXES)


def scan(since=None, include_manual=False, run_checks=False):
    text = open(TODO, encoding="utf-8").read()
    blocks = parse_blocks(text)
    auto = nonauto = unevaluated = dw_auto = 0
    # dw_auto = the RECONCILE-side denominator: open rows whose `done-when` first token is a
    # recognized kind, i.e. the only rows RECONCILE can ever fire on. Counted on BOTH paths
    # below, because a nonauto TRIGGER can still carry a machine-checkable COMPLETION predicate.
    # Added 2026-08-14: render() printed `0 reconcile` against the TRIGGER-side denominator
    # (`auto`) and never computed this one, so a coverage reading read as a health reading.
    # Measured at that commit: 38 of 1136 open rows = 3.3%.
    doable, reconcile, stale = [], [], []
    # INSTRUMENT FAILURE IS NOT A STALE PREDICATE (2026-09-07). A git invocation that
    # ERRORS returns (None, True, "git error: ...") and used to land in `stale`, which reads as
    # "the row's meta: block points at a missing target" — a worklist /wrap Step 7h is told to
    # fix inline. Measured that day: one malformed `--since` moved DOABLE-NOW 71 -> 2 and STALE
    # 0 -> 79 while rc, the `unevaluated` count AND the RECONCILE bucket (the one number 7h
    # reads) all stayed identical. Routing these to their own loud bucket is what makes a broken
    # run distinguishable from a healthy one at the surface where it is actually read.
    instr = []

    # ⛔ THE PREDICATE IS A FAMILY, NOT ONE PREFIX. THE CENSUS
    # LIVES AT `INSTRUMENT_FAILURE_PREFIXES` (module scope) AND NOWHERE ELSE. It used to be
    # duplicated here; the duplicate is struck rather than updated, because the hoist that gave
    # the self-test the real symbol also made this copy the one nobody would re-derive — two
    # censuses is exactly the shape that produces a confident, stale enumeration.
    # What is kept, because it is incident record rather than enumeration: my first version
    # routed TWO of the family, and **both of the ones I missed that are reachable sit on the
    # BARE path — the invocation every consumer actually runs** (7h, /triggers, /surfaces),
    # because both of my validation arms passed `--since` and no arm exercised the default path
    # at all. The `eval error:` member is a deliberate blanket (`except Exception`, "eval must
    # never crash the scan"), so ANY unforeseen failure lands there — the single most important
    # member and the one a hand-written prefix list would have kept missing forever.
    deadpath = []
    outside_meta = []
    standing = []
    latched = []
    for line, bl in blocks:
        # Runs for EVERY open row, BEFORE the meta-block early-continues — a row with no
        # `meta:` block can still cite a dead path, and those rows are the majority.
        _dead = dead_cited_paths(bl)
        if _dead:
            deadpath.append((line, bl[0].strip()[:78], _dead))
        # A `trigger-type:` line meta_fields() does not read is invisible to every bucket below,
        # silently. Three shapes: no `meta:` block at all (34 open rows until 2026-09-30,
        # one 21 days past its date); a trigger at
        # the SAME indent as `meta:`, which ends the block; and a trigger in a SECOND block, since
        # only the first is read. Keyed on the lines meta_fields() reads, so all three are named.
        _read = meta_read_lines(bl)
        if any(i not in _read and re.match(r"^\s*trigger-type:", l) for i, l in enumerate(bl)):
            outside_meta.append((line, bl[0].strip()[:78]))
        mf = meta_fields(bl)
        if not mf:
            continue
        tt, tv = mf.get("trigger-type"), mf.get("trigger", "")
        if mf.get("status", "pending") == "done" or not tt:
            continue
        title = re.sub(r"^\s*-\s*\[ \]\s*", "", bl[0]).strip()[:72]
        if tt not in AUTO_KINDS:
            # NONAUTO_KINDS (prod-data-count/manual/external) AND any free-text
            # trigger-type the existing blocks use ("prod-data-count + behavioral",
            # "opportunistic", "monitor-only"…) are counted, never guessed — never stale.
            nonauto += 1
            # …but `done-when` is kind-prefixed and INDEPENDENT of `trigger-type`: a manual or
            # external TRIGGER can still carry a machine-checkable COMPLETION predicate. Skipping
            # the whole block here made the RECONCILE bucket unreachable for them — and those are
            # exactly the items most likely to be closed by SOMEONE ELSE (a peer's wave, a vendor
            # shipping an API), i.e. the highest-value slice reconcile exists to catch. The module
            # docstring already specifies "RECONCILE: done-when present AND done-when TRUE" with no
            # trigger-type condition; the code contradicted its own spec.
            # Found by dogfooding: two entries filed 2026-07-09
            # both had `trigger-type: manual` + an auto-evaluable `done-when` that went TRUE when a
            # peer closed the work. The scan reported "0 reconcile" for both.
            # GATE on a recognized kind. A nonauto item's `done-when` is often free-text prose
            # ("re-run the eval", "add a fixture") rather than kind-prefixed. Parsing its first
            # word as a kind flags 13 healthy entries as STALE — a false alarm that teaches
            # readers to ignore the stale bucket, which is the one signal that must stay loud.
            # Same "counted, never guessed" discipline the trigger side already applies.
            dw = mf.get("done-when")
            if dw:
                dk, da = (dw.split(None, 1) + [""])[:2]
                if dk in AUTO_KINDS:
                    dw_auto += 1
                    ds, d_stale, d_detail = eval_predicate(dk, da, since, run_checks=run_checks, item_line=line, item_span=len(bl))
                    if d_stale:
                        (instr if _is_instrument_failure(d_detail) else stale).append((line, title, d_detail))
                        continue
                    if ds is True:
                        reconcile.append((line, title, d_detail))
                        continue
            if include_manual and tt == "manual":
                doable.append((line, title, f"{tt} (surfaced via --include-manual)", "", "none", None))
            continue
        auto += 1
        ts, t_stale, t_detail = eval_predicate(tt, tv, since, run_checks=run_checks, item_line=line, item_span=len(bl))
        ds, d_stale, d_detail = None, False, "none"
        dw = mf.get("done-when")
        # `done-when: none` = an explicit no-predicate declaration, not an unknown kind.
        # Authors mimic the scan's own "done-when -> none" display (4 rows measured 2026-08-02,
        # two authors); the display can't stop saying "none", so the parser accepts it.
        if dw and dw.strip().lower() == "none":
            dw = None
        # DELIBERATELY UNGATED - do NOT mirror the NONAUTO `if dk in AUTO_KINDS`
        # gate above. An AUTO row HAS a machine predicate, so an unrecognized kind is
        # overwhelmingly a TYPO, and STALE is the signal this path exists to emit.
        # Measured 2026-08-07: 'grep-presnt' -> stale (the catch) | 'manual' -> "not
        # auto-evaluable" (the sanctioned human-judged encoding) | 'file-exists' ->
        # evaluated (control). Gating here silences the typo. Two seats read this line
        # and diagnosed a defect; the seat that ran a discriminating fixture did not.
        # The rationale had lived only on the 24h mail bus, which is why it is here.
        if dw:
            dk, da = (dw.split(None, 1) + [""])[:2]
            # COUNT only — the eval below stays DELIBERATELY UNGATED per the block above, so a
            # typo'd kind still reaches eval_predicate and surfaces as STALE. Gating the counter
            # is not gating the evaluation; do not move this test down onto the eval call.
            if dk in AUTO_KINDS:
                dw_auto += 1
            ds, d_stale, d_detail = eval_predicate(dk, da, since, run_checks=run_checks, item_line=line, item_span=len(bl))
        if t_stale or d_stale:
            _d = t_detail if t_stale else d_detail
            (instr if _is_instrument_failure(_d) else stale).append((line, title, _d))
        elif ds is True:
            reconcile.append((line, title, d_detail))
        elif ts is True:
            # class: standing-rule = a permanent read-when-touched reminder (no completion
            # state). Its trigger firing is the POINT — but it is not outstanding work, so
            # it gets its own bucket instead of polluting DOABLE-NOW (2026-08-02 triage: two such
            # rows re-fired on every scan).
            if mf.get("class") == "standing-rule":
                standing.append((line, title, f"{tt}: {tv}", t_detail))
            else:
                _ats = _item_anchor_ts(line, len(bl))
                # LATCH routing — DEFAULT scan only. An explicit --since is a NARROWING view with
                # its own anchor semantics, and the latch is a statement about the row's OWN anchor.
                _n = (_commits_since(tv.split(), _ats)
                      if tt == "commit-touches" and _ats is not None and not since else 0)
                if _n >= LATCH_COMMITS:
                    latched.append((line, title, f"{tt}: {tv}", t_detail, d_detail, _ats, _n))
                else:
                    doable.append((line, title, f"{tt}: {tv}", t_detail, d_detail, _ats))
        elif ts is None:
            # BLIND≠CLEAN: the trigger could NOT be evaluated (the only non-stale None for
            # an auto kind is commit-touches without --since) — count it, don't let the item
            # silently vanish from every bucket while the tail reads "no trigger has fired".
            unevaluated += 1
    # total_open = TOP-LEVEL open checkboxes only. parse_blocks matches any-indent
    # (^\s*-\s*\[ \]), so nested sub-bullets inflate len(blocks); the buckets are unaffected
    # (nested items carry no meta: block) — only this coverage denominator was over-counted.
    top_open = sum(1 for ln in text.split("\n") if re.match(r"^-\s*\[ \]", ln))
    return dict(total_open=top_open, auto=auto, nonauto=nonauto, unevaluated=unevaluated,
                dw_auto=dw_auto,
                doable=doable, reconcile=reconcile, stale=stale, standing=standing,
                latched=latched, instr=instr, deadpath=deadpath, outside_meta=outside_meta)


def render(r):
    out = []
    # The reconcile denominator rides on LINE 1 deliberately: `/wrap` Step 7h captures this scan
    # with `| head -1` (scripts/wrap-reconcile.mjs), so a denominator on line 2 is invisible at the
    # surface where the bare zero is actually read.
    _dwa = r.get('dw_auto')
    _recl = f"{len(r['reconcile'])} reconcile" + (f" (of {_dwa} done-when-evaluable)" if _dwa is not None else "")
    # The instrument-failure count rides on LINE 1 for the same reason the reconcile denominator
    # does: `/wrap` Step 7h captures this scan with `| head -1`, so a broken run announced on line
    # 40 is invisible at the surface that reads it.
    _instr = len(r.get("instr", []))
    out.append(f"Defer-trigger scan — {len(r['doable'])} doable-now, "
               f"{_recl}, {len(r['stale'])} stale"
               # ADDITIVE on line 1: wrap-reconcile.mjs extracts doable-now / reconcile / stale /
               # INSTRUMENT FAILURE by regex anywhere on the line, so this cannot break them; it
               # rides here because `| head -1` is the only surface /wrap ever reads.
               + f", {len(r.get('latched', []))} latched"
               + (f", ⛔ {_instr} INSTRUMENT FAILURE(S) — THIS RUN IS VOID" if _instr else "")
               + (f", {len(r['outside_meta'])} trigger(s) outside a meta block — unread"
                  if r.get("outside_meta") else "")
               + (f", {len(r.get('standing', []))} standing-rule reminder(s)" if r.get('standing') else ""))
    out.append(f"Coverage: {r['auto']} auto-evaluable / {r['auto']+r['nonauto']} meta-tagged "
               f"/ {r['total_open']} open todo items "
               f"({r['nonauto']} not auto-evaluable: prod-signal / manual / free-text — by design)")
    if _dwa is not None:
        out.append(f"          reconcile side: {_dwa} of {r['total_open']} open rows carry a machine-checkable "
                   f"done-when — the other {r['total_open']-_dwa} cannot produce a RECONCILE at any value. "
                   f"A 0 above is a COVERAGE reading, not a health reading.")
    if r.get("standing"):
        out.append("\nSTANDING RULES (trigger fired — read-when-touched reminders, NOT outstanding work):")
        for line, title, trig, detail in r["standing"]:
            out.append(f"  todo.txt:{line}  {title}")
    if r["reconcile"]:
        out.append("\nRECONCILE (work already done — propose [x]):")
        for line, title, d in r["reconcile"]:
            out.append(f"  todo.txt:{line}  {title}\n      done-when -> TRUE ({d})")
    if r["doable"]:
        out.append("\nDOABLE NOW (trigger fired, not yet done):")
        # OLDEST FIRST. The bucket was unordered and unaged though the anchor was already
        # computed per row, so a row untouched for 25 days across N wraps looked identical to
        # one written this morning — which is what makes the pile unreadable at a glance.
        _now = time.time()
        for line, title, trig, td, dd, ats in sorted(
                r["doable"], key=lambda e: (e[5] is None, e[5])):
            _age = "" if ats is None else f"  [row last written {int((_now-ats)//86400)}d ago]"
            out.append(f"  todo.txt:{line}  {title}{_age}\n      trigger {trig} -> TRUE ({td})  |  done-when -> {dd}")
    if r.get("latched"):
        out.append(f"\nLATCHED (commit-touches on a HOT path — TRUE since the row was filed and it cannot go FALSE "
                   f"again, so this is NOT newly-unblocked work; re-key each row on what it is actually waiting "
                   f"for — grep-present/grep-absent on the symbol, file-exists on the artifact, exit-zero on the "
                   f"guard — so the predicate can carry signal. Threshold LATCH_COMMITS={LATCH_COMMITS} distinct "
                   f"commits since the row's anchor; hottest first):")
        _now = time.time()
        for line, title, trig, td, dd, ats, n in sorted(r["latched"], key=lambda e: -e[6]):
            _age = "" if ats is None else f"row last written {int((_now-ats)//86400)}d ago · "
            out.append(f"  todo.txt:{line}  {title}  [{_age}{n:,} commits to the watched path since]\n"
                       f"      trigger {trig}  |  done-when -> {dd}")
    if r.get("outside_meta"):
        out.append("\nTRIGGER OUTSIDE A META BLOCK (this scan cannot read it, so it never fires — put the "
                   "trigger lines under a `meta:` line, indented deeper than it; warn-only):")
        for line, title in r["outside_meta"]:
            out.append(f"  todo.txt:{line}  {title}")
    if r.get("deadpath"):
        out.append("\nDEAD CITED PATHS (a path in the row BODY resolves to no file — warn-only, accepted-FP):")
        for line, title, paths in r["deadpath"]:
            out.append(f"  todo.txt:{line}  {title}\n      not found: {', '.join(paths)}")
    if r["stale"]:
        out.append("\nSTALE PREDICATES (fix the meta: block — a check points at a missing target):")
        for line, title, d in r["stale"]:
            out.append(f"  todo.txt:{line}  {title}  [{d}]")
    if r.get("instr"):
        out.append(f"\n⛔ INSTRUMENT FAILURE — {len(r['instr'])} predicate(s) could not be EVALUATED, "
                   f"and this is NOT the stale bucket. A git invocation errored, so every bucket above "
                   f"is a VOID reading, not a clean one. Commonest cause: a `--since` value git parsed "
                   f"as a rev (it takes a bare `YYYY-MM-DD` or `N days ago`; anything else is read as a "
                   f"ref). The bare invocation has been complete for commit-touches since 2026-07-30 — "
                   f"re-run WITHOUT --since and read that instead:")
        for line, title, d in r["instr"]:
            out.append(f"  todo.txt:{line}  {title}  [{d}]")
    if r.get("unevaluated"):
        out.append(f"\n⚠️ {r['unevaluated']} trigger(s) unevaluated "
                   f"(exit-zero needs --run-exit-zero — it EXECUTES commands, so it stays opt-in)")
    if not (r["reconcile"] or r["doable"] or r["stale"] or r.get("instr") or r.get("latched")):
        if r.get("unevaluated"):
            out.append("(no EVALUATED trigger has fired — the unevaluated set above is unknown, not clean)")
        else:
            out.append("\n(no auto-evaluable trigger has fired since last scan)")
    return "\n".join(out)


def self_test():
    # on-ref fixture anchor: THIS REPO'S ROOT COMMIT. Chosen because git history is immutable, so
    # the two structural facts these arms assert can never rot — the root is an ancestor of every
    # ref forever, and HEAD is an ancestor of the root never. Both are asserted against whatever
    # commit the derivation below returns: in a shallow clone (actions/checkout defaults to depth 1)
    # the true root object is absent, but `rev-list --max-parents=0` does not read `missing commit:`
    # there — it returns the shallow BOUNDARY commit (the oldest commit fetched), so the arms run
    # against that commit instead of the real root. At depth 1 with HEAD at origin/main the
    # boundary IS HEAD, so the `HEAD <root>` arm reads True and goes RED; from depth 2 it holds.
    #
    # ⛔ CI REACHABILITY — DERIVED SET, HARDCODED GATE. This file IS already in CI's enforce set and
    # does NOT get its --self-test run, and those are two different mechanisms. `smoke-test-hooks.sh`
    # (CI's `meta-hygiene` job) builds ENFORCE_SCRIPTS by GREPPING .githooks/pre-push, pre-commit and
    # .claude/skills/meta/SKILL.md; measured 2026-09-07, this script is matched by `meta/SKILL.md`
    # ALONE (both githooks read 0), so it takes an ast.parse on every meta-hygiene run. What it does
    # not take is --self-test, because SELFTEST_STEMS is a HARDCODED four-stem list this stem is not
    # in. So the set is derived while the gate is hardcoded — adding a citation anywhere in those
    # three files silently enrolls a script for syntax, never for behaviour.
    #
    # ⚠️ WIRING --self-test INTO CI: `meta-hygiene` is the SAFE target and the only one. It carries
    # `fetch-depth: 0`, so origin/main exists and these arms resolve. A BARE-checkout
    # job (typecheck, lint, knip, audit, integration, e2e, e2e-mobile — actions/checkout defaults to
    # depth 1) is the one to avoid: there the root object is absent and a LIVE row and a TYPO'd sha
    # both read `missing commit:`, byte-identical, so the predicate cannot separate them. Worse on a
    # pull_request trigger, where checkout maps refs/pull/N/merge and refs/remotes/origin/main is
    # never created at all — every on-ref row then fails on the REF side instead.
    #
    # ⛔ AND THE FAILURE IS LOUD ONLY VIA --self-test (rc=1). Via a BARE scan it is SILENT: rows land
    # in `stale`, and wrap-reconcile only VOIDs a run on instr > 0 — `cat-file -e` catches the miss
    # before merge-base can raise, so it classifies STALE, not INSTR, and the VOID gate cannot fire.
    # Derived, not pinned: the root commit of origin/main in whatever repository runs this.
    # Where it cannot be derived (no origin/main) the two arms naming the root as the commit read
    # `missing commit:` and the `HEAD <root>` arm reads `missing ref:`; a shallow clone
    # derives its boundary commit instead (see above).
    _ONREF_ROOT = (subprocess.run(["git", "rev-list", "--max-parents=0", "origin/main"], cwd=ROOT,
                                  capture_output=True, text=True).stdout.split() or ["<root-commit-id>"])[-1]
    cases = [
        ("lines", "todo.txt > 100", True),
        ("lines", "todo.txt > 9999999", False),
        ("file-exists", "package.json", True),
        ("file-exists", "nonexistent-xyz-123", False),
        ("grep-present", '"name" :: package.json', True),
        ("grep-absent", "zzzqqqnotfoundzzz :: package.json", True),
        ("grep-present", "UNLOCK :: package.json :: i", False),
        ("date", "2000-01-01", True),
        ("date", "2099-01-01", False),
        # The fail-closed guard, mutation-PROVEN: delete the `if not args` guard above and
        # this single arm goes RED (33/34) while every other arm stays green. It needs the
        # 2099 arm beside it — a guard that made everything stale would satisfy this one
        # alone. A `("grep-present", "", None)` sibling was written and then DELETED: the
        # mutation showed it passes with or without the guard (an empty pattern is already
        # stale by another path), i.e. it was decorative.
        ("date", "", None, "MALFORMED"),
        # git-clean/git-dirty: the arms that pin the RETIRED exemption. Before 2026-07-30
        # git-clean was exempted from the guard on a false rationale ("empty args means whole
        # repo" — git actually hard-errors on an empty pathspec), and git-dirty, its identical
        # sibling, never was. Both now fail closed. Mutation: restore `and kind != "git-clean"`
        # -> the git-clean arm alone REDs, which is what proves the exemption was doing
        # something rather than being invisible.
        ("git-clean", "", None, "MALFORMED"),
        ("git-dirty", "", None, "MALFORMED"),
        ("lines", "/no/such/path > 5", None),          # stale -> None
        ("dep-version", "sharp >= 0.0.1", True),
        ("git-clean", "no/such/pathspec/xyz", None),    # stale -> None
        # ── on-ref, the DEPLOY predicate (2026-09-07). BOTH polarities are structural facts about
        # an immutable history, so neither arm can go stale with the tree.
        ("on-ref", f"{_ONREF_ROOT} origin/main", True),           # explicit ref
        # ONE-ARG form -> default ref. ⚠️ THE DETAIL ASSERTION IS THE WHOLE ARM, not decoration:
        # the root is an ancestor of `origin/main` AND of `HEAD`, so a STATE-only expectation is
        # TRUE under either default and cannot see the default change. Measured 2026-09-07 —
        # mutating the default to "HEAD" scored 0 RED until this substring was added, and the arm
        # was pure appearance. A behavioural arm (a sha on HEAD but not on origin/main) would
        # discriminate today and RED the moment someone legitimately pushes; pinning the ref NAME
        # in the detail is push-invariant.
        ("on-ref", _ONREF_ROOT, True, "is on origin/main"),
        ("on-ref", f"HEAD {_ONREF_ROOT}", False),                 # HEAD is never an ancestor of the root
        # THREE stale paths, and the detail is REQUIRED on each: all three return None, so a
        # state-only assertion could not tell them apart and would be decorative (the harness note
        # above). `missing commit:`/`missing ref:` also pin the CLASSIFICATION — they are the ROW's
        # rot, not an instrument failure, so they must NOT start with an INSTRUMENT_FAILURE_PREFIX.
        ("on-ref", f"{'0' * 40} origin/main", None, "missing commit:"),
        ("on-ref", "HEAD refs/heads/no-such-branch-xyz-123", None, "missing ref:"),
        ("on-ref", "a b c", None, "bad on-ref args"),             # arity
        ("on-ref", "", None, "MALFORMED"),                        # the fail-closed guard reaches it
    ]
    fails = 0
    # A case may carry an optional 4th element: a substring the DETAIL must contain.
    # REQUIRED whenever two different code paths both return the same STATE — a state-only
    # assertion cannot tell them apart and is decorative. Measured 2026-07-30: an arm pinning
    # the retired git-clean exemption passed WITH and WITHOUT the exemption, because the
    # guarded path returns (None, stale) and the unguarded path ALSO returns (None, stale)
    # via git's own `fatal: empty string is not a valid pathspec`. Same state, different
    # reason; only the detail discriminates.
    for case in cases:
        kind, args, exp = case[0], case[1], case[2]
        want_detail = case[3] if len(case) > 3 else None
        st, stale, detail = eval_predicate(kind, args)
        got = None if stale else st
        ok = (got == exp) and (want_detail is None or want_detail in detail)
        why = "" if ok else (f"  <-- detail lacks {want_detail!r}" if got == exp else "")
        print(f"  [{'PASS' if ok else 'FAIL'}] {kind} {args!r} -> {got} (exp {exp})  {detail}{why}")
        fails += (0 if ok else 1)
    checks = len(cases)
    # exit-zero (opt-in "run a repo self-test" done-when):
    #   guard paths (opt-in gate + shape-allowlist) via eval_predicate — NO execution on any of
    #   these — then the exit-code -> tri-state mapping via the low-level _exec_exit_zero (no
    #   allowlist, no recursion: sys.executable -c is portable + can't fork-bomb the self-test).
    ez_guard = [
        ("opt-in-off", eval_predicate("exit-zero", "./scripts/x.sh --self-test"), (None, False)),
        ("bad-shape", eval_predicate("exit-zero", "/bin/true", run_checks=True), (None, True)),
        ("metachars", eval_predicate("exit-zero", "python3 scripts/x.py; rm -rf /", run_checks=True), (None, True)),
        ("dotdot", eval_predicate("exit-zero", "python3 scripts/../x.py --self-test", run_checks=True), (None, True)),
        # SIDE-EFFECT fence: shape-VALID + REAL scripts that MUTATE must be
        # rejected by EXIT_ZERO_TARGETS membership — loosening back to a flag-name allowlist reds these.
        ("mutating-sentry", eval_predicate("exit-zero", "node scripts/sentry-provision-alerts.mjs --verify", run_checks=True), (None, True)),
        ("mutating-backfill", eval_predicate("exit-zero", "node scripts/backfill-audit-tiers.mjs --check", run_checks=True), (None, True)),
    ]
    for name, (st, stale, _d), (exp_st, exp_stale) in ez_guard:
        checks += 1
        ok = (st == exp_st and stale == exp_stale)
        print(f"  [{'PASS' if ok else 'FAIL'}] exit-zero {name} -> ({st},{stale})  exp ({exp_st},{exp_stale})")
        fails += (0 if ok else 1)
    # membership-presence: the item's own done-when IS allowlisted (feature is not dead), and every
    # member conforms to the injection shape (a malformed member would never run).
    checks += 1
    members_ok = ("python3 scripts/defer-trigger-scan.py --self-test" in EXIT_ZERO_TARGETS
                  and all((".." not in m) and EXIT_ZERO_SHAPE.match(m) for m in EXIT_ZERO_TARGETS))
    print(f"  [{'PASS' if members_ok else 'FAIL'}] exit-zero EXIT_ZERO_TARGETS presence+shape ({len(EXIT_ZERO_TARGETS)} members)")
    fails += (0 if members_ok else 1)
    for name, parts, exp in [
        ("exit0->True", [sys.executable, "-c", "raise SystemExit(0)"], True),
        ("exit1->False", [sys.executable, "-c", "raise SystemExit(1)"], False),
        ("execfail->stale", ["/nonexistent-binary-xyz-123"], None),
    ]:
        checks += 1
        st, stale, _d = _exec_exit_zero(parts)
        got = None if stale else st
        ok = (got == exp)
        print(f"  [{'PASS' if ok else 'FAIL'}] _exec_exit_zero {name} -> {got} (exp {exp})")
        fails += (0 if ok else 1)
    # dead-cited-path arms (2026-08-08). The RED control is the MOTIVATING instance: a row
    # citing `components/project-card.tsx`, which does not exist (the real file is
    # `components/dashboard/project-card.tsx`). Every GREEN arm pins one FP class that the
    # 38-flag first cut actually produced on real data — remove any single filter and its
    # arm alone REDs. Backticks are built via chr(96) so no shell quoting can eat them:
    # the first hand-run of this control was command-substituted by zsh and returned a
    # meaningless [] that read as a clean PASS.
    _bt = chr(96)
    for name, rows, exp in [
        # ⛔ SCOPE PIN, NOT A RED CONTROL — and the distinction cost a review round.
        # The original RED arm cited `components/project-card.tsx`, which I believed was the
        # motivating instance. It was not: that string entered the tracker IN THE FIX COMMIT,
        # inside the annotation "filed as ..., which does not exist". Measured: a fixed-string
        # count of it in the tracker reads 0 at the fix commit's parent and 1 at the fix commit.
        # The REAL pre-fix citation was the bare basename `project-card.tsx:228`, which
        # cited_paths discards (no "/"). So the arm was keyed to prose THE REMEDY WROTE and
        # passed whether or not the detector worked — a known class, with a new sub-mechanism: a fixture
        # drawn from the remedy's own prose. Worse, the corpus's repair mechanism installs its
        # own suppressor — annotating a dead path adds "does not exist" to the line, which is
        # in _NEG_MARKERS, so every REPAIRED instance goes invisible to this detector.
        # This arm now pins the SCOPE HONESTLY: the bare-basename class is NOT covered, and
        # widening cited_paths to catch it would flood (every `page.tsx` mention becomes a
        # candidate) — the "/" requirement is what makes the 38->11 calibration sound.
        ("SCOPE PIN bare basename is out of scope (motivating instance, unreachable)",
         ["- [ ] X — the sibling " + _bt + "project-card.tsx:228" + _bt + " had its raw red converted"], []),
        # The genuine RED control: a slashed, genuinely-dead path.
        ("RED slashed dead path",
         ["- [ ] X — see " + _bt + "src/components/nonexistent-xyz-qqq/widget.tsx" + _bt], 
         ["src/components/nonexistent-xyz-qqq/widget.tsx"]),
        ("live TRACKED path", ["- [ ] X — " + _bt + "src/components/dashboard/project-card.tsx" + _bt], []),
        # os.path.exists had NO arm: every prior fixture was rescued by the suffix check, so
        # deleting that branch changed nothing. node_modules is present-but-UNTRACKED.
        ("live UNTRACKED path pins os.path.exists",
         ["- [ ] X — " + _bt + "node_modules/.package-lock.json" + _bt], []),
        ("negation marker suppresses",
         ["- [ ] X — filed as " + _bt + "a/b/nonexistent-xyz-qqq.ts" + _bt + ", which does not exist"], []),
        # ABSENCE-ASSERTION arms. RED control is the arm directly below them: the SAME
        # dead path with no marker must still be flagged, or these two markers would be
        # suppressing the detector rather than the false positive.
        ("absence-assertion 'there is no' suppresses",
         ["- [ ] X — there is no " + _bt + "a/b/nonexistent-xyz-qqq.ts" + _bt + " and no uploader"], []),
        ("absence-assertion 'still no' suppresses",
         ["- [ ] X — re-measured: still no " + _bt + "a/b/nonexistent-xyz-qqq.ts" + _bt], []),
        ("RED control — same dead path, NO marker, must still flag",
         ["- [ ] X — see " + _bt + "a/b/nonexistent-xyz-qqq.ts" + _bt + " for the shape"],
         ["a/b/nonexistent-xyz-qqq.ts"]),
        ("partial path resolves by UNIQUE suffix", ["- [ ] X — " + _bt + "security-expert/SKILL.md" + _bt], []),
        # ⚠️ ACCEPTED RESIDUAL, measured — the review proposed a unique-rescue rule to close the
        # ambiguous-tail class and it DOES NOT close this instance. `docs/architecture.md` is
        # genuinely dead (no root `docs/`) yet has EXACTLY ONE tail-match
        # (`.claude/docs/architecture.md`), so `len(hits) == 1` rescues it. Uniqueness cannot
        # separate "the author elided a prefix" (the reason the rescue exists at all, 26 live
        # cases) from "a dead file that happens to tail-match" — both look like one hit. The
        # class is NOT mechanically decidable from the string, so this arm pins the residual
        # rather than pretending it is fixed. The unique rule is KEPT because it does close the
        # multi-hit case, which is strictly better than the any-match rule it replaced.
        ("RESIDUAL single-hit ambiguous tail is still rescued (not decidable)",
         ["- [ ] X — " + _bt + "docs/architecture.md" + _bt], []),
        ("TS alias is not a path", ["- [ ] X — " + _bt + "@/lib/storage/nonexistent-xyz.ts" + _bt], []),
        # Discriminating glob fixture: the old one (`.../**`) died on the since-removed
        # extension filter and never reached the glob check it claimed to pin.
        ("glob is not a path", ["- [ ] X — " + _bt + "src/app/**/page.tsx" + _bt], []),
        # App Router brackets must NOT be treated as globs — 156 tracked paths carry them.
        ("App Router bracket path is REACHABLE",
         ["- [ ] X — " + _bt + "src/app/[locale]/nonexistent-xyz-qqq/page.tsx" + _bt],
         ["src/app/[locale]/nonexistent-xyz-qqq/page.tsx"]),
        ("symbol cite is not a path", ["- [ ] X — " + _bt + "signup/page.tsx::loginHref" + _bt], []),
        ("doc placeholder is not a path", ["- [ ] X — " + _bt + "scripts/lib/x.py" + _bt], []),
    ]:
        checks += 1
        got = dead_cited_paths(rows)
        ok = (got == exp)
        print(f"  [{'PASS' if ok else 'FAIL'}] dead_cited_paths {name} -> {got} (exp {exp})")
        fails += (0 if ok else 1)
    # _path_matches: the commit-touches matcher. Measured 2026-08-26 BEFORE this helper
    # existed: 13 of 131 commit-touches triggers matched ZERO of 6,529 tracked files while
    # passing the shape validator, i.e. they read as coverage and could never fire. Two
    # causes, both here. RED arms 5/6/8 are the discriminating half — a prefix match that
    # is too eager is the way this fix fails, and it fails toward FALSE-DOABLE.
    for name, f, p, exp in [
        ("bracket path matches ITSELF (fnmatch reads [locale] as a char class)",
         "src/app/[locale]/(auth)/error.tsx", "src/app/[locale]/(auth)/error.tsx", True),
        ("bracket directory prefix",
         "src/app/[locale]/(auth)/error.tsx", "src/app/[locale]", True),
        ("bare directory, trailing slash", "messages/en.json", "messages/", True),
        ("bare directory, no slash", "src/lib/email/send.ts", "src/lib/email", True),
        ("RED — unrelated path must NOT match a directory", "src/other/x.ts", "messages/", False),
        ("RED — near-miss prefix must NOT match (email vs emails)",
         "src/lib/emails/x.ts", "src/lib/email", False),
        ("glob behaviour preserved", "scripts/a.mjs", "scripts/*.mjs", True),
        ("RED — non-matching glob stays non-matching", "scripts/a.py", "scripts/*.mjs", False),
    ]:
        checks += 1
        got = _path_matches(f, p)
        ok = (got == exp)
        print(f"  [{'PASS' if ok else 'FAIL'}] _path_matches {name} -> {got} (exp {exp})")
        fails += (0 if ok else 1)
    # completeness sentinel: every AUTO_KINDS member must
    # resolve to a real eval_predicate branch — a kind added to the set without a branch falls
    # to "unknown kind" -> loud STALE noise on every scan. Fail at CI the moment that happens.
    for k in sorted(AUTO_KINDS):
        checks += 1
        _, _, d = eval_predicate(k, ".x > 1" if k == "lines" else "x")
        if "unknown kind" in d:
            print(f"  [FAIL] AUTO_KINDS completeness: {k} has no eval_predicate branch")
            fails += 1
    # ── THE INSTRUMENT-FAILURE CENSUS, asserted over the REAL module-scope predicate. This is
    # the census table made executable: every detail string this
    # file can emit with stale=True, and which side of the line it belongs on. It sits here
    # rather than in the fixture below because the two `exit-zero` members are UNREACHABLE from
    # a synthetic todo.txt — that kind is opt-in behind --run-exit-zero and allowlisted to
    # EXIT_ZERO_TARGETS, so no fixture row can drive them without weakening a security fence.
    # The last row is the control that keeps the FAMILY key honest: `_exec_exit_zero`'s SUCCESS
    # return starts `exit N:`, not `exit-zero`, so a prefix on the family cannot over-capture.
    for _detail, _want, _site in [
        ("git error: fatal: bad revision",                     True,  ":351/:403"),
        ("grep error: brackets ([ ]) not balanced",            True,  ":187"),
        ("eval error: something unforeseen",                   True,  ":437 blanket except"),
        ("no blame date for item block at line 12",            True,  ":388 bare path"),
        ("exit-zero exec error: [Errno 2] no such file",       True,  ":149"),
        ("exit-zero timeout (>20s): python3 scripts/x.py",     True,  ":158"),
        ("missing path: no-such-file.txt",                     False, "genuine stale"),
        ("bad grep args: nonsense",                            False, "author error, genuine stale"),
        # on-ref's three stale details (2026-09-07). All THREE are the ROW's own rot, never a broken
        # instrument — one row naming a sha this clone lacks must not void the whole run, the same
        # call `:429` makes for a rotted exit-zero target. If any of these ever starts with an
        # INSTRUMENT_FAILURE_PREFIX, that classification silently inverts and these arms RED.
        ("missing commit: deadbeef — on-ref names a commit-ish this repo cannot resolve",
                                                               False, "on-ref rotted sha"),
        ("missing ref: refs/heads/gone — on-ref names a commit-ish this repo cannot resolve",
                                                               False, "on-ref rotted ref"),
        ("bad on-ref args: expected '<commit-ish> [<ref>=origin/main]', got: a b c",
                                                               False, "on-ref author error"),
        ("exit 0: python3 scripts/x.py --self-test",           False, "SUCCESS — the family-key control"),
        # The three that SAY exit-zero and are NOT instrument failures — what a widening from a
        # PREFIX test to a SUBSTRING test would sweep into VOID. ⛔ NOT "what makes the trailing
        # space mean something", which is what this comment said until the mutation refuted it:
        # measured over all six live details, the trailing space changes ZERO of six answers, so
        # it carries no bits at all. The SUCCESS path is kept out by the HYPHEN — `exit 5:` and
        # `exit-zero` diverge at index 4, space against hyphen — and these three by the prefix
        # test, since none of them BEGINS with the token. The space is a cheap guard against a
        # future `exit-zeroSOMETHING` emitter and nothing more; say that, not more than that.
        ("unsafe exit-zero shape — allowed: '<./scripts/x.sh…", False, ":416 author error"),
        ("not an allowlisted exit-zero target — add to EXIT…",  False, ":422 author error"),
        ("missing path: scripts/gone.sh (an allowlisted exit-zero target that is absent…)",
                                                               False, ":429 rotted meta: block"),
    ]:
        checks += 1
        if _is_instrument_failure(_detail) is not _want:
            print(f"  [FAIL] instrument-failure census ({_site}): "
                  f"{_detail[:44]!r} should be {'INSTR' if _want else 'STALE'}")
            fails += 1

    # ── THE CENSUS ABOVE ASSERTS LITERALS, SO IT CANNOT SEE THE EMITTER MOVE (a mutation run left
    # seven mutants surviving at 93/93, and this closes the two load-bearing
    # ones). Both survivors have the same shape — an assertion whose extent is narrower than the
    # claim it is read as making — and neither is reachable by adding another literal row.
    #
    # M5 · THE EMITTER↔CENSUS GAP. Every row above is a hand-typed string. Mutate `eval_predicate`
    # to emit `git error: missing commit: …` instead of `missing commit: …` and the census stays
    # GREEN — it is still classifying its own literals correctly — while the LIVE path now routes
    # a merely-rotted row into `instr`, and one such row makes render() stamp the whole scan VOID.
    # So the census proves the classifier and proves nothing about what reaches it. These arms run
    # the REAL predicate and feed its REAL return value to the REAL classifier; no literal in the
    # middle. (The just-fixed corpus is the ground truth for whether a predicate recognises
    # a member — here the corpus is the emitter's own output.)
    #
    # M15 · THE FLAG THE RUNNER CANNOT REACH. The `cases` runner computes `got = None if stale
    # else st`, and every rotted on-ref path returns st=None as well — so `(None, True, …)` and
    # a mutated `(None, False, …)` are the SAME `got`, and the arms above pass under both. The
    # consequence is not cosmetic: stale=False on a value of None takes a rotted sha out of the
    # stale bucket and into a DOABLE alarm, i.e. the scanner starts telling someone to action a
    # row whose commit-ish this clone cannot even resolve. Assert the flag itself, positionally.
    for _label, _args, _want_stale, _want_prefix_instr in [
        ("rotted sha",   f"{'0' * 40} origin/main",              True,  False),
        ("rotted ref",   "HEAD refs/heads/no-such-branch-xyz",   True,  False),
        ("author error", "a b c",                                True,  False),
        # The control: a LIVE, resolvable pair must come back not-stale. Without it every arm
        # above is satisfied by a predicate that marks EVERYTHING stale, which is the cheap way
        # to pass a stale-flag test and the reason a same-direction set certifies nothing.
        ("live pair (control — must read the OTHER way)",
         f"{_ONREF_ROOT} origin/main",                           False, False),
    ]:
        checks += 1
        _st, _stale, _detail = eval_predicate("on-ref", _args)
        _instr = _is_instrument_failure(_detail)
        if _stale is not _want_stale:
            print(f"  [FAIL] on-ref stale-flag ({_label}): stale={_stale}, expected {_want_stale} "
                  f"— a rotted row with stale=False leaves the stale bucket and becomes a DOABLE "
                  f"alarm; detail={_detail[:60]!r}")
            fails += 1
        elif _instr is not _want_prefix_instr:
            print(f"  [FAIL] on-ref emitter→classifier ({_label}): the LIVE detail classifies as "
                  f"{'INSTR' if _instr else 'STALE'}, expected "
                  f"{'INSTR' if _want_prefix_instr else 'STALE'} — the emitter's prefix moved out "
                  f"from under the literal census above; detail={_detail[:60]!r}")
            fails += 1

    # ── scan()/render() ARMS — the two functions actually changed (the floor below was the
    # cheap half and this is the half that discriminates). Every arm above calls eval_predicate, _exec_exit_zero, dead_cited_paths
    # or _path_matches; NONE reached scan() or render(), so a mutation run scored the
    # instrument-failure fix **0 RED of 9** — including two that revert it outright and one
    # (dropping `instr` from scan()'s return dict) that is WORSE than pre-fix: the 79 rows
    # vanish from every bucket instead of being mislabelled, and render()'s `r.get("instr", [])`
    # then reads a silent zero. A count floor cannot see any of that.
    global TODO, _BLAME_TS, _TOUCH
    _TODO_REAL, _BLAME_REAL, _TOUCH_REAL = TODO, _BLAME_TS, _TOUCH
    # TWO fixture rows, ONE code path, OPPOSITE buckets — the PAIRING is the test. Row 1's `[`
    # is an invalid ERE, so grep exits 2 and _grep returns "grep error: …" (an INSTRUMENT
    # failure). Row 2 names a path that does not exist, so eval_predicate returns "missing
    # path: …" (a genuine STALE predicate). Narrow the routing and row 1 joins row 2 in
    # `stale`; widen it and row 2 joins row 1 in `instr`. Either direction reddens, which is
    # what a one-sided arm could not do.
    _FIXTURE = (
        "- [ ] SELFTEST-ROW-INSTRUMENT-FAILURE\n"
        "  meta:\n"
        "    trigger-type: grep-present\n"
        "    trigger: [ :: package.json\n"
        "    done-when: none\n"
        "  filed: 2026-09-07 by self-test\n"
        "\n"
        "- [ ] SELFTEST-ROW-PLAIN-STALE\n"
        "  meta:\n"
        "    trigger-type: lines\n"
        "    trigger: no-such-file-selftest-xyz.txt > 1\n"
        "    done-when: none\n"
        "  filed: 2026-09-07 by self-test\n"
        "\n"
        # ⛔ ROWS 3 AND 4 EXIST BECAUSE THE FIRST VERSION OF THIS FIXTURE LEFT A SURVIVING
        # MUTATION. There are TWO routing sites, and the one above reaches only the second:
        # the `done-when` site sits inside the `tt not in AUTO_KINDS` branch, so it needs a
        # NONAUTO trigger-type carrying an AUTO done-when — a shape neither row above has.
        # Reverting that site scored 0 RED against a 66/66 suite until these landed, which is
        # the very gap being closed (that site fires zero times on both real arms)
        # reproducing inside the test written to close it. Both sites now carry the pair.
        "- [ ] SELFTEST-ROW-DONE-WHEN-INSTRUMENT-FAILURE\n"
        "  meta:\n"
        "    trigger-type: manual\n"
        "    trigger: someone asks for it\n"
        "    done-when: grep-present [ :: package.json\n"
        "  filed: 2026-09-07 by self-test\n"
        "\n"
        "- [ ] SELFTEST-ROW-DONE-WHEN-PLAIN-STALE\n"
        "  meta:\n"
        "    trigger-type: manual\n"
        "    trigger: someone asks for it\n"
        "    done-when: lines no-such-file-selftest-xyz.txt > 1\n"
        "  filed: 2026-09-07 by self-test\n"
        "\n"
        # ⛔ ROWS 5 AND 6 REPRODUCE THE DEFECT `on-ref` EXISTS FOR, END TO END THROUGH scan().
        # The eval_predicate arms above prove the PREDICATE; they do not prove the kind reaches
        # the bucketing, and this file's own census records that arms calling eval_predicate
        # "NONE reached scan()". Both rows carry a FIRED date trigger, so the only thing deciding
        # their bucket is the done-when — which is the exact short-circuit that muted
        # a real tracker row: scan() evaluates RECONCILE before the fired-trigger branch,
        # so a done-when that goes TRUE early swallows the alarm. Row 5 is the ALARM FIRING on
        # undeployed work; row 6 is the same row after it lands. Both are structural facts about
        # an immutable history, so the pair is push-invariant and cannot rot with the tree.
        "- [ ] SELFTEST-ROW-ONREF-UNDEPLOYED\n"
        "  meta:\n"
        "    trigger-type: date\n"
        "    trigger: 2000-01-01\n"
        f"    done-when: on-ref HEAD {_ONREF_ROOT}\n"
        "  filed: 2026-09-07 by self-test\n"
        "\n"
        "- [ ] SELFTEST-ROW-ONREF-LANDED\n"
        "  meta:\n"
        "    trigger-type: date\n"
        "    trigger: 2000-01-01\n"
        f"    done-when: on-ref {_ONREF_ROOT} origin/main\n"
        "  filed: 2026-09-07 by self-test\n"
        "\n"
        # Row 7: a FIRED date trigger with no `meta:` line. It must land in outside_meta and in no
        # other bucket; rows 1-6 all carry `meta:` and are the control that must NOT land there.
        "- [ ] SELFTEST-ROW-TRIGGER-OUTSIDE-META\n"
        "  trigger-type: date\n"
        "  trigger: 2000-01-01\n"
        "  filed: 2026-09-30 by self-test\n"
        "\n"
        # Rows 8 and 9: the two shapes that DO carry a `meta:` line and are still unread — a flat
        # block (trigger at the meta: indent) and a trigger in a second block.
        "- [ ] SELFTEST-ROW-FLAT-META\n"
        "  meta:\n"
        "  trigger-type: date\n"
        "  trigger: 2000-01-01\n"
        "\n"
        "- [ ] SELFTEST-ROW-SECOND-META\n"
        "  meta:\n"
        "    trigger-type: manual\n"
        "    trigger: someone asks for it\n"
        "  note\n"
        "  meta:\n"
        "    trigger-type: date\n"
        "    trigger: 2000-01-01\n"
    )
    import tempfile
    _fd, _fx = tempfile.mkstemp(prefix="defer-scan-selftest-", suffix=".txt")
    try:
        with os.fdopen(_fd, "w", encoding="utf-8") as _fh:
            _fh.write(_FIXTURE)
        # The blame/touch caches key on TODO and are module-global, so they MUST be cleared on
        # the way in AND on the way out — a stale cache would silently answer for the wrong file.
        TODO, _BLAME_TS, _TOUCH = _fx, None, None
        _r = scan()
        _titles = lambda bucket: [row[1] for row in bucket]
        # render() returns ONE JOINED STRING, not a list — `render(res)[0]` is the first
        # CHARACTER, and the negative arm below PASSES vacuously on it (a single char never
        # contains "INSTRUMENT FAILURE"). Caught by the positive arm on this suite's first
        # run: the pair is what found it, which is the argument for writing both.
        _line1 = lambda res: render(res).split("\n")[0]
        for _label, _cond in [
            ("scan() returns an `instr` key at all — drop it and 79 real rows vanish from "
             "EVERY bucket while render() reads a silent zero",
             "instr" in _r),
            ("scan() routes a grep-error row into instr at the TRIGGER site",
             any("SELFTEST-ROW-INSTRUMENT-FAILURE" in x for x in _titles(_r.get("instr", [])))),
            ("scan() routes a grep-error row into instr at the DONE-WHEN site (the branch a\n              revert survived until row 3 existed)",
             any("SELFTEST-ROW-DONE-WHEN-INSTRUMENT-FAILURE" in x
                 for x in _titles(_r.get("instr", [])))),
            ("scan() keeps that grep-error row OUT of stale",
             not any("SELFTEST-ROW-INSTRUMENT-FAILURE" in x for x in _titles(_r["stale"]))),
            ("scan() routes a genuine missing-path row into stale at BOTH sites (the control — "
             "it must read the OTHER way, or the pair certifies nothing)",
             any("SELFTEST-ROW-PLAIN-STALE" in x for x in _titles(_r["stale"]))
             and any("SELFTEST-ROW-DONE-WHEN-PLAIN-STALE" in x for x in _titles(_r["stale"]))),
            ("scan() keeps that missing-path row OUT of instr",
             not any("SELFTEST-ROW-PLAIN-STALE" in x for x in _titles(_r.get("instr", [])))),
            ("both sites fired exactly once each — 2 instr, 2 stale (an emptied fixture REDs "
             "here, and so does a routing revert at EITHER site)",
             len(_r.get("instr", [])) == 2 and len(_r["stale"]) == 2),
            # PLACEMENT is the whole design call, so the arm pins LINE 1 specifically: /wrap
            # Step 7h captures this scan with `| head -1` (scripts/wrap-reconcile.mjs), so a
            # void run announced on line 2 is invisible at the only surface that reads it.
            ("render() puts the VOID banner on LINE 1 when instr is non-empty",
             "INSTRUMENT FAILURE" in _line1(_r) and "VOID" in _line1(_r)),
            ("render() says nothing on line 1 when instr is empty (control)",
             "INSTRUMENT FAILURE" not in _line1(dict(_r, instr=[]))),
            # on-ref reachability THROUGH scan() — the pair, and the PAIRING is the test. Either
            # one alone is satisfiable by a broken kind: if on-ref always returned FALSE both rows
            # would be doable and the first arm alone would pass; if it always returned TRUE both
            # would reconcile and the second alone would pass. Only the OPPOSITE buckets, from one
            # code path, show the predicate discriminating where it matters.
            ("scan() puts an on-ref row whose commit has NOT landed into DOABLE — the alarm FIRES "
             "on undeployed work, which is the whole defect this kind was built for",
             any("SELFTEST-ROW-ONREF-UNDEPLOYED" in x for x in _titles(_r["doable"]))),
            ("scan() puts an on-ref row whose commit HAS landed into RECONCILE (the control — it "
             "must read the OTHER way, or the arm above certifies nothing)",
             any("SELFTEST-ROW-ONREF-LANDED" in x for x in _titles(_r["reconcile"]))),
            ("neither on-ref row fell into stale or instr — a rotted fixture sha would land both "
             "there and BOTH arms above would still read as a clean bucketing failure",
             not any("SELFTEST-ROW-ONREF" in x
                     for x in _titles(_r["stale"]) + _titles(_r.get("instr", [])))),
            ("scan() names every row carrying an unread trigger-type — no meta: block, a flat block, "
             "a second block — and ONLY those (rows 1-6 are read and are the control); the no-meta "
             "row reaches no firing bucket",
             sorted(re.search(r"SELFTEST-ROW-[A-Z-]+", t).group(0)
                    for t in _titles(_r.get("outside_meta", []))) ==
             ["SELFTEST-ROW-FLAT-META", "SELFTEST-ROW-SECOND-META", "SELFTEST-ROW-TRIGGER-OUTSIDE-META"]
             and not any("SELFTEST-ROW-TRIGGER-OUTSIDE-META" in x
                         for x in _titles(_r["doable"]) + _titles(_r["stale"]))),
            ("render() carries the outside-meta count on LINE 1 (the only line /wrap reads), and "
             "says nothing there when the list is empty",
             "outside a meta block" in _line1(_r)
             and "outside a meta block" not in _line1(dict(_r, outside_meta=[]))),
        ]:
            checks += 1
            if not _cond:
                print(f"  [FAIL] {_label}")
                fails += 1
    finally:
        TODO, _BLAME_TS, _TOUCH = _TODO_REAL, _BLAME_REAL, _TOUCH_REAL
        os.unlink(_fx)
    # ⛔ A COUNT FLOOR — without it this line is PASS-SHAPED OVER ZERO CASES (empty the table
    # and it prints "self-test: 0/0 passed", rc=0).
    # The sibling `queued-directive-residue-scan.py --self-test` does NOT have
    # this flaw because its assertions are content-keyed, so an emptied fixture goes RED, and
    # its pattern is the one to port here. A floor is the cheap half of that: it cannot tell you
    # the arms are GOOD, only that they EXIST — which is exactly the failure mode a green over
    # an empty suite has. Bump it when arms are added; a DROP below it is the signal.
    _lc, _lf = _self_test_latch()
    checks += _lc; fails += _lf
    _tc, _tf = _self_test_touch_log()
    checks += _tc; fails += _tf
    # 61 -> 71: +2 boundary arms in the latch fixture, +3 synthetic-parse arms, +5 live scratch-repo
    # arms (the stubbed caches had left the header parse and the ledger unrun).
    # 57 -> 61: the four on-ref stale-flag/emitter arms added 2026-09-07.
    # ⛔ DERIVED, NOT PASTED. A review proposed 101, measured on a tree that carried neither
    # the seven LATCH arms (which took the floor 50 -> 57) nor these four, so
    # pasting it would have set an unreachable floor on one baseline and a slack one on the other.
    # The convention this follows is the one set earlier: +N arms -> +N floor. It stays a FLOOR
    # against catastrophic deletion (104 checks run today), never an equality — an exact-count pin
    # is edited on every legitimate change, which trains people to bump it without reading it.
    # --help arm: the flag prints the usage docstring and exits 0 rather than running a scan.
    import io, contextlib
    checks += 1
    _buf, _code = io.StringIO(), None
    with contextlib.redirect_stdout(_buf):
        try:
            main(["--help"])
        except SystemExit as _e:
            _code = _e.code
    help_ok = (_code == 0 and "Usage:" in _buf.getvalue())
    print(f"  [{'PASS' if help_ok else 'FAIL'}] --help prints usage and exits 0 (exit {_code})")
    fails += (0 if help_ok else 1)
    # 71 -> 73: the two outside-meta arms (2026-09-30). 73 -> 74: the --help arm (2026-10-04).
    SELF_TEST_FLOOR = 74
    if checks < SELF_TEST_FLOOR:
        print(f"  [FAIL] self-test floor: only {checks} checks ran, expected >= {SELF_TEST_FLOOR} "
              f"— arms were deleted or the harness short-circuited; a green here would be vacuous")
        fails += 1
    print(f"\nself-test: {checks-fails}/{checks} passed")
    return fails == 0


def _self_test_latch():
    """LATCH routing through scan(): TWO commit-touches rows watching the SAME real path, ONE
    synthetic history, OPPOSITE buckets — the pairing is the test. Returns (checks, fails).
    The three caches are STUBBED, not recomputed: the fixture file is untracked, so a real blame
    would return no anchors and every commit-touches row would read 'no blame date' (stale) —
    which is what the pre-existing fixture rows silently rely on and why none of them is
    commit-touches. Row 1 starts at fixture line 1, row 2 at line 8 (six lines each + a blank)."""
    global TODO, _BLAME_TS, _TOUCH, _COMMITS, LATCH_COMMITS
    _keep = (TODO, _BLAME_TS, _TOUCH, _COMMITS, LATCH_COMMITS)
    _fx_text = (
        "- [ ] SELFTEST-ROW-LATCH-HOT\n"
        "  meta:\n"
        "    trigger-type: commit-touches\n"
        "    trigger: plans\n"
        "    done-when: none\n"
        "  filed: 2026-09-07 by self-test\n"
        "\n"
        "- [ ] SELFTEST-ROW-LATCH-COLD\n"
        "  meta:\n"
        "    trigger-type: commit-touches\n"
        "    trigger: plans\n"
        "    done-when: none\n"
        "  filed: 2026-09-07 by self-test\n"
        "\n"
        "- [ ] SELFTEST-ROW-LATCH-EXACT\n"
        "  meta:\n"
        "    trigger-type: commit-touches\n"
        "    trigger: plans\n"
        "    done-when: none\n"
        "  filed: 2026-09-07 by self-test\n"
        "\n"
        "- [ ] SELFTEST-ROW-LATCH-BELOW\n"
        "  meta:\n"
        "    trigger-type: commit-touches\n"
        "    trigger: plans\n"
        "    done-when: none\n"
        "  filed: 2026-09-07 by self-test\n"
    )
    _fd, _fx = tempfile.mkstemp(prefix="defer-scan-selftest-latch-", suffix=".txt")
    os.write(_fd, _fx_text.encode("utf-8")); os.close(_fd)
    checks = fails = 0
    def _t(bucket): return [e[1] for e in bucket]
    try:
        TODO = _fx
        # 13 synthetic commits at t=1000..1012, every one touching plans/x.md. HOT is anchored at
        # 999 (13 after it, >= LATCH_COMMITS=10); COLD at 1011 (only the t=1012 commit after it).
        # EXACT is anchored at 1002 (1003..1012 = exactly LATCH_COMMITS=10 after it) and BELOW at 1003
        # (9 after it): the boundary pair pins the threshold to its value, where HOT/COLD alone pinned
        # it only to the open interval (1, 13] — `>= LATCH_COMMITS - 8` survived them green.
        _BLAME_TS = {**{l: 999 for l in range(1, 7)}, **{l: 1011 for l in range(8, 14)},
                     **{l: 1002 for l in range(15, 21)}, **{l: 1003 for l in range(22, 28)}}
        _COMMITS = [(f"{i:040x}", 1000 + i, ["plans/x.md"]) for i in range(13)]
        _TOUCH = {"plans/x.md": 1012}
        _LATCH_CACHE.clear()
        _r = scan()
        _line1 = render(_r).split("\n")[0]
        _keepT = LATCH_COMMITS
        LATCH_COMMITS = 10 ** 9            # MUTATION: with an unreachable threshold, HOT must fall back to DOABLE
        _LATCH_CACHE.clear()
        _r_mut = scan()
        LATCH_COMMITS = _keepT
        for _label, _cond in [
            ("scan() routes the HOT commit-touches row (13 commits since anchor) into LATCHED",
             "SELFTEST-ROW-LATCH-HOT" in _t(_r["latched"])),
            ("…and NOT into DOABLE — the whole point is that it leaves the worklist",
             "SELFTEST-ROW-LATCH-HOT" not in _t(_r["doable"])),
            ("scan() keeps the COLD row (1 commit since anchor) in DOABLE — the control, same code path, "
             "opposite bucket; without it a routing that latches EVERYTHING would pass the arm above",
             "SELFTEST-ROW-LATCH-COLD" in _t(_r["doable"])),
            ("…and NOT in LATCHED",
             "SELFTEST-ROW-LATCH-COLD" not in _t(_r["latched"])),
            ("render() line 1 still matches wrap-reconcile's `(\\d+)\\s+doable-now` AND carries the latched count",
             re.search(r"(\d+)\s+doable-now", _line1) is not None and "2 latched" in _line1),
            ("BOUNDARY — a row with EXACTLY LATCH_COMMITS commits since its anchor is LATCHED (>=, not >)",
             "SELFTEST-ROW-LATCH-EXACT" in _t(_r["latched"]) and "SELFTEST-ROW-LATCH-EXACT" not in _t(_r["doable"])),
            ("BOUNDARY — a row with LATCH_COMMITS - 1 stays DOABLE (the pair pins the value, not an interval)",
             "SELFTEST-ROW-LATCH-BELOW" in _t(_r["doable"]) and "SELFTEST-ROW-LATCH-BELOW" not in _t(_r["latched"])),
            # The threshold NAME+VALUE in the banner is the arm, not decoration (a peer's on-ref lesson,
            # 2026-09-07): a state-only assertion cannot see a silently changed constant.
            ("render() LATCHED banner names the resolved threshold, LATCH_COMMITS=10",
             f"LATCH_COMMITS={_keepT}" in render(_r) and _keepT == 10),
            ("MUTATION — an unreachable LATCH_COMMITS sends the HOT row back to DOABLE, so the threshold is "
             "load-bearing and the two arms above are not satisfiable by a routing that ignores it",
             "SELFTEST-ROW-LATCH-HOT" in _t(_r_mut["doable"]) and not _r_mut["latched"]),
        ]:
            checks += 1
            if not _cond:
                print(f"  [FAIL] {_label}")
                fails += 1
    finally:
        TODO, _BLAME_TS, _TOUCH, _COMMITS, LATCH_COMMITS = _keep
        _LATCH_CACHE.clear()
        os.unlink(_fx)
    return checks, fails


def _self_test_touch_log():
    """The header parse and the commit ledger, driven for real — synthetic text first, then an actual
    `git log` over a scratch repo through _touch_map itself. Returns (checks, fails). Neither runs
    under the stubbed-cache arms above, which is the hole this closes."""
    global ROOT, _BLAME_TS, _TOUCH, _COMMITS
    checks = fails = 0
    def _arms(rows):
        nonlocal checks, fails
        for _label, _cond in rows:
            checks += 1
            if not _cond:
                print(f"  [FAIL] {_label}")
                fails += 1
    # (a) synthetic: two valid headers; a 39-hex line and an 8-digit-timestamp line are NOT headers
    # and attach as files to the commit above them — a loosened regex counts them as commits (RED),
    # a tightened one drops the real headers (RED).
    _sha1, _sha2 = "a" * 40, "c" * 40
    _text = (f"{_sha1} 1700000000\nplans/x.md\nother/y.md\n{'b' * 39} 1700000001\n{'d' * 40} 17000000\n\n"
             f"{_sha2} 1699999000\nplans/x.md\n")
    _touch, _commits = _parse_touch_log(_text)
    _arms([
        ("synthetic log: exactly the two 40-hex + >=9-digit headers become commits (malformed lines do not)",
         [c[0] for c in _commits] == [_sha1, _sha2]),
        ("...files attach to the commit above them, the malformed lines included, in order",
         len(_commits) == 2
         and _commits[0][2] == ["plans/x.md", "other/y.md", f"{'b' * 39} 1700000001", f"{'d' * 40} 17000000"]
         and _commits[1][2] == ["plans/x.md"]),
        ("...and the touch map keeps the FIRST occurrence (newest-first log => newest commit-time)",
         _touch.get("plans/x.md") == 1700000000 and _touch.get("other/y.md") == 1700000000),
    ])
    # (b) live: a scratch repo with four dated commits, read through _touch_map's own git pass.
    _keep = (ROOT, _BLAME_TS, _TOUCH, _COMMITS)
    _d = tempfile.mkdtemp(prefix="defer-scan-selftest-git-")
    try:
        _env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
                "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t", "GIT_CONFIG_NOSYSTEM": "1"}
        def _g(*a, ts=None):
            e = dict(_env)
            if ts is not None:
                e["GIT_AUTHOR_DATE"] = e["GIT_COMMITTER_DATE"] = f"{ts} +0000"
            return subprocess.run(["git", *a], cwd=_d, env=e, capture_output=True, text=True, check=True)
        _g("init", "-q")
        # real-sized epochs: git rejects a tiny raw date, and the header regex needs >= 9 digits.
        _T = 1700000000
        for _i, (_ts, _path) in enumerate([(_T, "plans/x.md"), (_T + 1, "other/y.md"),
                                           (_T + 2, "plans/x.md"), (_T + 3, "plans/x.md")]):
            os.makedirs(os.path.join(_d, os.path.dirname(_path)), exist_ok=True)
            with open(os.path.join(_d, _path), "a", encoding="utf-8") as _fh:
                _fh.write(f"{_i}\n")
            _g("add", "-A"); _g("commit", "-q", "-m", f"c{_i}", ts=_ts)
        # the stubbed "oldest anchor" must be a REAL-SIZED epoch: `git log --since=@<epoch>` returns
        # NOTHING for an epoch below ~10^9 (measured 2026-09-07: @0, @1, @1000 and 1970-01-01 all -> 0
        # commits; @1600000000 -> all) — a fixture anchored at 0 excluded its own commits.
        ROOT, _BLAME_TS, _TOUCH, _COMMITS = _d, {1: _T - 1}, None, None
        _LATCH_CACHE.clear()
        _touch_map()
        _arms([
            ("live: one real `git log` pass through _touch_map yields one ledger entry per commit (4)",
             len(_COMMITS or []) == 4),
            ("...carrying the committer times git recorded (T..T+3) — the %ct half of the format",
             sorted(t for _s, t, _f in (_COMMITS or [])) == [_T, _T + 1, _T + 2, _T + 3]),
            ("...and the touch map holds the NEWEST commit-time per file",
             (_TOUCH or {}).get("plans/x.md") == _T + 3 and (_TOUCH or {}).get("other/y.md") == _T + 1),
            ("_commits_since counts DISTINCT commits touching the pathspec after ts0 (plans, >T -> 2)",
             _commits_since(["plans"], _T) == 2),
            ("...and 0 where nothing touched it after ts0 (other, >T+1 -> 0)",
             _commits_since(["other"], _T + 1) == 0),
        ])
    except Exception as _e:   # a fixture that cannot be built is a FAIL, never a silent skip
        checks += 1; fails += 1
        print(f"  [FAIL] live touch-log fixture could not run: {type(_e).__name__}: {_e}")
    finally:
        ROOT, _BLAME_TS, _TOUCH, _COMMITS = _keep
        _LATCH_CACHE.clear()
        shutil.rmtree(_d, ignore_errors=True)
    return checks, fails


def main(argv):
    # --help / -h print the usage docstring and exit; without this they fell through to a full scan
    # (read-only, so harmless, but a reader asking what the tool does got a report instead).
    if "--help" in argv or "-h" in argv:
        print(__doc__)
        sys.exit(0)
    if "--self-test" in argv:
        sys.exit(0 if self_test() else 1)
    since = None
    if "--since" in argv:
        since = argv[argv.index("--since") + 1]
    r = scan(since=since, include_manual=("--include-manual" in argv),
             run_checks=("--run-exit-zero" in argv))
    if "--json" in argv:
        print(json.dumps(r, indent=2))
    else:
        print(render(r))


if __name__ == "__main__":
    main(sys.argv[1:])
