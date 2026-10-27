#!/usr/bin/env python3
"""review-queue.py — the review hub's status and its queue table, DERIVED every run.

WHY THIS EXISTS. The hub's own spec says a queue claim must be re-derived before every
assertion, and then documents twice that the re-derivation is expensive enough that it
silently degrades into RESTATING the last one (review-hub/SKILL.md, occurrence 2,
2026-08-25: forty minutes of "one open hold, everything else clear" that was true of the
hub's model and false of the store). A ledger was the answer to WHERE the state lives; this
is the answer to HOW MUCH IT COSTS TO READ. One command, no recall.

⛔ ONE PREDICATE, NOT TWO. Which requests exist,
which shas are their targets, and which of those are answered all come from
`review-request-closure-scan.mjs --json --sid <seat>` — the hub's closure oracle, which also reads
the tracked review ledger. This file used to re-derive "answered" from its own outbound scan, and
the two answered differently for the same hub at the same minute (1 of 4 flagged shas common). What
stays HERE is presentation: the hub status, the ACK-ONLY split of an open sha (an outbound of mine
named it but the scan counted no answer), the plan-file ledger rows and the cross-check.

⛔ WHAT IT DOES NOT DO. It reads the MAIL PLANE and the tracked review ledger (both through the
closure scan) only. A loop closed in a commit body, a
tracker row, or a channel reads OPEN here — the same bound `hub-unfinished-loops.py` carries
and for the same reason. Every count it prints over that plane is a FLOOR.

⛔ THE `<session-id>` HAZARD, and it is why sha detection is not a regex. An 8-hex session id is
indistinguishable from an abbreviated sha by PATTERN. This repo's own migration rules record
the same collision biting a `git log --grep` (a `<session-id>` containing `0093` vs migration
0093, 7 hits, zero true positives). So a hex token becomes a sha here only when `git cat-file -e <tok>^{commit}`
CONFIRMS it — the object database is the discriminator, never the shape.

Usage:  review-queue.py [--sid <sid8>] [--json] [--no-owed]
        review-queue.py --self-test
"""
import glob
import json
import os
import re
import subprocess
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))

# Reuse the SHIPPED resolver rather than writing a second one. It returns None — never a
# guess — on an ambiguous 8-hex prefix, which is the property that matters: the owner
# addresses seats by these names, so a wrong name mis-routes real work.
#
# ⛔ `session-manifest.py` CARRIES A HYPHEN, so a plain `import` cannot reach it — the name
# is not a legal Python identifier and the failure is a bare ModuleNotFoundError that reads
# like a missing dependency rather than a naming rule. Load it by PATH.
import importlib.util as _ilu  # noqa: E402

_spec = _ilu.spec_from_file_location("_ff_session_manifest",
                                     os.path.join(_HERE, "session-manifest.py"))
SM = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(SM)

MAIL_DIR = SM.MAIL_DIR
STATE_DIR = SM.STATE_DIR
REPO_DIR = SM.REPO_DIR

# ⛔ THREE CLASSES, NOT TWO — AND THE MIDDLE ONE IS THE POINT. The hub's own spec says
# "ANSWERED IS NOT HANDLED": an ACK names the sha and disposes of nothing, so a scan that
# scores any outbound as an answer reports a queue that is cleaner than it is. The
# requester cannot tell QUEUED from FORGOTTEN, and those demand opposite actions from
# them — so ACK-ONLY gets its own state rather than being folded into either neighbour.
# An outbound REQUEST of my own naming a sha is me ASKING, never me answering — so it does not
# make an open sha ACK ONLY either.
NON_ANSWER_SIGNALS = {"review-request", "deploy-review"}
HEX_RE = re.compile(r"\b([0-9a-f]{7,40})\b")
LEDGER_ROW_RE = re.compile(r"^###\s+`([^`]+)`\s*(.*)$")
REBROADCAST_HOURS = 48.0
# The durable review record, tracked in git; the closure scan reads it through the ONE parser
# (scripts/lib/review-ledger.mjs) and hands its per-sha rows over in the JSON document.
LEDGER_DOC_REL = ".claude/docs/review-ledger.md"
CLOSURE_SCAN = os.path.join(_HERE, "review-request-closure-scan.mjs")


# ---------------------------------------------------------------- mail store

def parse_mail(path):
    """Read ONE mail file's frontmatter.

    ⛔ BOUNDED BY THE CLOSING `---`, NOT BY A WHOLE-FILE GREP. Measured on this store: a
    naive `^[a-z-]+:` sweep over whole files returns `it:`, `verify:`, `myself:`, `yours:`
    and `source:` as frontmatter keys — those are ordinary English sentences in bodies. A
    body line reading `signal: something` would otherwise overwrite the real signal.
    """
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            lines = fh.read().split("\n")
    except OSError:
        return None
    if not lines or lines[0].strip() != "---":
        return None
    meta, body_start = {}, None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            body_start = i + 1
            break
        m = re.match(r"^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$", lines[i])
        if m:
            meta[m.group(1).lower()] = m.group(2).strip()
    if body_start is None:
        return None
    meta["_body"] = "\n".join(lines[body_start:])
    meta["_path"] = path
    meta["_name"] = os.path.basename(path)
    meta["_read"] = ".read" in os.path.basename(path)
    return meta


def load_mail(mail_dir=None):
    d = mail_dir or MAIL_DIR
    out = []
    for p in sorted(glob.glob(os.path.join(d, "*.md"))
                    + glob.glob(os.path.join(d, "*.md.read"))
                    + glob.glob(os.path.join(d, "*.md.read-by-*"))):
        m = parse_mail(p)
        if m and m.get("from") and m.get("to"):
            out.append(m)
    return out


# ---------------------------------------------------------------- sha truth

_SHA_CACHE = {}


def is_commit(tok, repo=None):
    """Object-database membership, never shape. See the module docstring."""
    tok = tok.lower()
    if tok in _SHA_CACHE:
        return _SHA_CACHE[tok]
    try:
        rc = subprocess.run(
            ["git", "cat-file", "-e", tok + "^{commit}"],
            cwd=repo or REPO_DIR,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        ).returncode
        ok = rc == 0
    except Exception:
        ok = False
    _SHA_CACHE[tok] = ok
    return ok


def shas_in(text, repo=None):
    seen, out = set(), []
    for tok in HEX_RE.findall(text or ""):
        t = tok.lower()
        if t in seen:
            continue
        seen.add(t)
        if is_commit(t, repo):
            out.append(t)
    return out


# ---------------------------------------------------------------- formatting

def name_of(sid):
    """`sid` plus its name, or the bare sid when the resolver refuses to guess."""
    if sid == "all":
        return "all (broadcast)"
    try:
        n = SM.session_name(sid)
    except Exception:
        n = None
    return f"{sid} ({n})" if n else sid


def plain_name(sid):
    try:
        n = SM.session_name(sid)
    except Exception:
        n = None
    return n or sid


def ago(iso_or_epoch):
    try:
        if isinstance(iso_or_epoch, (int, float)):
            secs = time.time() - iso_or_epoch
        else:
            t = time.strptime(iso_or_epoch.replace("Z", "").split(".")[0],
                              "%Y-%m-%dT%H:%M:%S")
            import calendar
            secs = time.time() - calendar.timegm(t)
    except Exception:
        return "?"
    if secs < 0:
        return "just now"
    if secs < 90:
        return f"{int(secs)}s ago"
    if secs < 5400:
        return f"{int(secs / 60)}m ago"
    if secs < 172800:
        return f"{secs / 3600:.1f}h ago"
    return f"{secs / 86400:.1f}d ago"


def trim(s, n):
    s = (s or "").replace("|", "/").replace("\n", " ").strip()
    return s if len(s) <= n else s[: n - 1] + "…"


# ---------------------------------------------------------------- hub status

def hub_status(me, state_dir=None):
    markers = sorted(glob.glob(os.path.join(state_dir or STATE_DIR, "review-hub-active-*")))
    hubs = []
    for p in markers:
        base = os.path.basename(p)
        if base.endswith(".retiring"):
            continue
        sid = base[len("review-hub-active-"):]
        hubs.append({
            "sid": sid,
            "is_me": sid == me,
            "retiring": os.path.exists(p + ".retiring"),
            "mtime": os.path.getmtime(p),
            "stale_broadcast": (time.time() - os.path.getmtime(p)) / 3600.0 > REBROADCAST_HOURS,
        })
    return hubs


def listener_alive(sid):
    """`kill -0`, not `[ -f ]` — a stale pid FILE outlives its process."""
    pid_path = os.path.join(STATE_DIR, f"mail-listen-{sid}.pid")
    if not os.path.exists(pid_path):
        return None, "no pid file"
    try:
        pid = int(open(pid_path).read().strip())
    except Exception:
        return None, "unreadable pid file"
    try:
        os.kill(pid, 0)
        return True, f"pid {pid}"
    except OSError:
        return False, f"pid {pid} — STALE FILE, process gone"


# ---------------------------------------------------------------- the table

def run_closure_scan(me, repo=None, env_extra=None):
    """The closure scan's JSON document for `me`. Raises RuntimeError rather than returning a
    guess: a queue printed without its OPEN set would read as an empty queue."""
    env = dict(os.environ)
    env.setdefault("FF_MAIL_DIR", MAIL_DIR)       # the same store this file reads for ACKs
    env.update(env_extra or {})
    try:
        r = subprocess.run(["node", CLOSURE_SCAN, "--json", "--sid", me], cwd=repo or REPO_DIR,
                           env=env, capture_output=True, text=True, timeout=120)
    except Exception as e:
        raise RuntimeError(f"closure scan did not run: {e}")
    try:
        doc = json.loads(r.stdout)
    except ValueError:
        raise RuntimeError(f"closure scan returned no document (rc={r.returncode}): "
                           f"{(r.stderr or r.stdout).strip().splitlines()[:1]}")
    if doc.get("control") == "filter-control-failed":
        raise RuntimeError("closure scan's git filter control failed: no cited sha resolved as a commit"
                           " — suspect git, not the store")
    return doc


def _names_sha(text, sha7):
    return re.search(r"\b" + re.escape(sha7) + r"[0-9a-f]{0,33}\b", text or "") is not None


def rows_from_scan(doc, mail, me):
    """Map the scan's requests onto this file's row shape. The scan decides targets, context and
    answered; this adds only the ACK-ONLY split: an open sha that an outbound of mine (not a request
    of my own) named, i.e. acknowledged without the scan counting an answer."""
    outbound = [m for m in mail if m.get("from") == me
                and (m.get("signal") or "info").strip() not in NON_ANSWER_SIGNALS]
    rows = []
    # `unanchored` asks cite no commit, so they carry no targets or context and read NO SHA CITED.
    for q in doc.get("requests", []) + doc.get("unanchored", []):
        targets, context, opened = q.get("targets", []), q.get("context", []), q.get("open", [])
        acked = [s for s in opened
                 if any(_names_sha((m.get("subject", "") or "") + "\n" + (m.get("_body", "") or ""), s)
                        for m in outbound)]
        silent = [s for s in opened if s not in acked]
        via = q.get("closedVia", {})
        by = sorted({(via.get(s) or {}).get("path") for s in targets if via.get(s)} - {None})
        if q.get("dismissed"):
            by.append("dismissed")      # a dismissal is not an answer — the scan says so too
        if not targets:
            status = "CONTEXT ONLY" if context else "NO SHA CITED"
        elif not opened:
            status = "DISPOSED"
        elif silent:
            status = "OPEN"
        else:
            status = "ACK ONLY"
        rows.append({
            "from": q.get("from"), "subject": q.get("subject", ""), "created": q.get("when", ""),
            "cited": targets, "context": context, "ledger_context": q.get("ledgerOnly", []),
            "unanswered": opened, "ack_only": acked, "silent": silent,
            "dismissed": q.get("dismissed", []), "answered_by": by, "status": status,
            "ledger_rows": q.get("ledgerRows", {}), "open_context": q.get("openContext", []),
        })
    rows.sort(key=lambda r: r.get("created", ""))
    return rows


# ---------------------------------------------------------------- ledger

def ledger_rows(me, repo=None):
    """Parse the hub's own plan-file ledger. Cross-BLIND to the mail derivation above:
    the ledger drifts when a row goes unwritten, the mail scan drifts on subject phrasing.
    DIVERGENCE IS THE SIGNAL — never reconcile one to the other silently."""
    base = repo or REPO_DIR
    found = []
    for p in sorted(glob.glob(os.path.join(base, "plans", f"session-{me}-*.md"))):
        try:
            lines = open(p, encoding="utf-8", errors="replace").read().split("\n")
        except OSError:
            continue
        for ln in lines:
            m = LEDGER_ROW_RE.match(ln)
            if not m:
                continue
            head, rest = m.group(1), m.group(2)
            toks = shas_in(head, base)
            if not toks:
                # An 8-hex SESSION id heads a section too — the object db said no.
                continue
            status = "OPEN"
            if "CLOSED" in rest.upper():
                status = "CLOSED"
            elif "VERDICT SENT" in rest.upper():
                status = "VERDICT SENT"
            found.append({"shas": toks, "rest": rest.strip(), "status": status,
                          "file": os.path.basename(p)})
    return found


# ---------------------------------------------------------------- owed

def run_owed():
    out = []
    for label, cmd in (
        ("peers holding the last word", ["python3", "scripts/hub-unfinished-loops.py"]),
        ("my own open promises", ["python3", "scripts/hub-open-promises.py"]),
    ):
        try:
            r = subprocess.run(cmd, cwd=REPO_DIR, capture_output=True, text=True, timeout=90)
            out.append((label, (r.stdout or r.stderr or "").rstrip()))
        except Exception as e:
            out.append((label, f"(could not run: {e})"))
    return out


# ---------------------------------------------------------------- render

def render(me, rows, ledger, hubs, want_owed=True, tracked=None):
    L = []
    L.append(f"review queue — seat `{name_of(me)}`")
    L.append("")

    # --- hub status
    L.append("## Hub status")
    if not hubs:
        L.append("  🚨 NO HUB MARKER ANYWHERE — this is a VACANCY, not a quiet queue.")
        L.append("     Resolve by ELECTION: `session-manifest.py fleet-claim review-hub`.")
    for h in hubs:
        who = "YOU" if h["is_me"] else "peer"
        tag = " ⏸ RETIRING — do NOT delegate" if h["retiring"] else ""
        L.append(f"  {'🎧' if h['is_me'] else '  '} {who}: `{name_of(h['sid'])}`"
                 f" · marker stamped {ago(h['mtime'])}{tag}")
        if h["is_me"]:
            alive, detail = listener_alive(h["sid"])
            state = ("ALIVE" if alive else "DEAD" if alive is False else "UNKNOWN")
            L.append(f"     listener: {state} ({detail}) — checked with kill -0, not [ -f ]")
            if h["stale_broadcast"]:
                L.append(f"     ⏰ RE-BROADCAST DUE — marker older than {REBROADCAST_HOURS:.0f}h;"
                         " a peer booting now may not find you.")
    L.append("")

    # --- the table
    L.append("## The queue")
    if not rows:
        L.append("  No review requests addressed to this seat in the store.")
    else:
        L.append("")
        L.append("| From | What they sent | Arrived | Commits | Status |")
        L.append("|---|---|---|---|---|")
        for r in rows:
            if r["status"] == "OPEN":
                mark = f"🔴 nothing sent — {len(r['silent'])} of {len(r['cited'])}"
            elif r["status"] == "ACK ONLY":
                mark = f"🟡 acknowledged, not answered — {len(r['ack_only'])} of {len(r['cited'])}"
            elif r["status"] == "DISPOSED":
                mark = "✅ " + (", ".join(r["answered_by"][:2]) or "answered")
            elif r["status"] == "CONTEXT ONLY" and r.get("open_context"):
                mark = f"⚪ {len(r['open_context'])} sha(s) cited only mid-prose, unanswered — read it"
            elif r["status"] == "CONTEXT ONLY":
                mark = ("⚪ cites only context (a ledger-record commit), not a review target"
                        if r.get("ledger_context") else "⚪ cites shas only mid-prose — context, not a review target")
            else:
                mark = "⚪ no commit named — cannot be tracked"
            L.append("| {} | {} | {} | {} | {} |".format(
                plain_name(r["from"]),
                trim(r["subject"], 58),
                ago(r["created"]),
                (" ".join(s[:7] for s in r["cited"][:3]) + ("…" if len(r["cited"]) > 3 else ""))
                or "—",
                mark,
            ))
        opens = [r for r in rows if r["status"] == "OPEN"]
        ackonly = [r for r in rows if r["status"] == "ACK ONLY"]
        L.append("")
        L.append(f"  {len(rows)} request(s) · {len(opens)} with nothing sent"
                 f" · {len(ackonly)} acknowledged but not answered.")
        oc = [r for r in rows if r.get("open_context")]
        if oc:
            L.append(f"  ℹ️ {len(oc)} row(s) carry unanswered shas cited only mid-prose — the scan's"
                     " lower-confidence tier; a target it mis-read shows here, not missing.")
        if (tracked or {}).get("control") == "zero-answered":
            L.append("  ⛔ CONTROL: the closure scan read ZERO requests as answered — it cannot report"
                     " success, so it cannot report failure either.")
        if ackonly:
            L.append("  ⛔ AN ACK IS NOT A DISPOSITION. Those rows look answered to every")
            L.append("     sha-keyed instrument and are not — from the requester's side,")
            L.append("     queued and forgotten are indistinguishable.")
    L.append("")
    L.append("  ⚠️ FLOOR, never a count. This reads the MAIL PLANE and the tracked ledger only — a")
    L.append("     loop closed in a commit body, a tracker row or a channel reads OPEN here. And a verdict that")
    L.append("     answered by RANGE rather than by sha leaves its request reading OPEN:")
    L.append("     the scan keys on the sha, so name each one you cover.")
    L.append("")

    # --- ledger cross-check
    L.append("## Ledger cross-check")
    any_tracked = any((r.get("ledger_rows") or {}) for r in rows)
    if tracked:
        L.append(f"  tracked ledger ({LEDGER_DOC_REL}, read by the closure scan): {tracked.get('status')}")
    if not ledger and not any_tracked:
        # ⛔ NO ROWS READ IS "NOT RUN", NEVER DRIFT. Until 2026-10-26 this branch printed a
        # DIVERGENCE alarm whenever the plan file held no `### `<sha>`` headings — and no hub has
        # written that shape since 2026-09-28 (their Review ledgers are tables), so it fired on
        # every hub, every run: 85 records, 0 true.
        L.append("  No `### `<sha>`` heading rows in this seat's plan file and no tracked-ledger")
        L.append("  rows read, so this cross-check did NOT run. That is not drift: re-read the")
        L.append("  tracked ledger status above before calling a request unrowed.")
    else:
        # ⛔ COMPARE AT THE GRAIN OF THE OBLIGATION, WHICH IS ONE ROW PER *REQUEST*.
        # Comparing every-sha-mentioned against ledger-heading-shas is the wrong axis and
        # over-reports ~6x — measured on this store, 53 "missing" against 8 real. Name the
        # binding predicate first, then derive the set from it.
        led = {s for r in ledger for s in r["shas"]}

        def has_row(r):
            return bool(set(r["cited"]) & led) or any((r.get("ledger_rows") or {}).get(s) for s in r["cited"])
        unrowed = [r for r in rows if r["cited"] and not has_row(r)]
        rowed = len(rows) - len(unrowed) - len([r for r in rows if not r["cited"]])
        L.append(f"  plan-file rows: {len(ledger)} · store requests: {len(rows)}"
                 f" · requests WITH a ledger row (tracked or plan-file): {rowed}")
        if not unrowed:
            L.append("  ✅ AGREE — every store request has a ledger row. Two cross-blind")
            L.append("     instruments, same set; that is the strong reading.")
        else:
            L.append(f"  ⛔ {len(unrowed)} request(s) with NO ledger row — the measured drift,")
            L.append("     write each one now (the row is opened ON ARRIVAL, not at classification):")
            for r in unrowed:
                L.append(f"       · {plain_name(r['from'])} — {trim(r['subject'], 58)}"
                         f"  [{' '.join(s[:7] for s in r['cited'][:2])}]")
        orphan = [r for r in ledger if not (set(r["shas"]) & {s for x in rows for s in x["cited"]})]
        if orphan:
            L.append(f"  ⚠️ {len(orphan)} ledger row(s) whose commit no store request names —")
            L.append("     usually a request that arrived by a route the subject-scan misses,")
            L.append("     which is the ledger catching what this scan cannot. Not an error.")
    L.append("")

    if want_owed:
        L.append("## What is owed (cross-blind to everything above)")
        for label, text in run_owed():
            L.append(f"  --- {label} ---")
            for ln in (text or "").split("\n"):
                L.append("  " + ln)
        L.append("")
    return "\n".join(L)


# ---------------------------------------------------------------- self-test

def self_test():
    """RED control per claim class. Each arm must read the OTHER way when the property
    it tests is removed — a control that cannot fail certifies nothing."""
    import io
    import re
    import tempfile
    fails = []
    _ran = [0]
    _src = io.open(__file__, encoding='utf-8').read()

    def check(name, got, want):
        _ran[0] += 1
        ok = got == want
        print(f"  {'PASS' if ok else 'FAIL'}  {name}: got {got!r}, want {want!r}")
        if not ok:
            fails.append(name)

    d = tempfile.mkdtemp(prefix="rq-selftest-")
    # canonicalise: mktemp returns the symlinked spelling on macOS and every path
    # comparison below would then compare two spellings of one directory.
    d = os.path.realpath(d)
    subprocess.run(["git", "init", "-q", d], check=True)
    subprocess.run(["git", "-C", d, "config", "user.email", "t@t"], check=True)
    subprocess.run(["git", "-C", d, "config", "user.name", "t"], check=True)
    open(os.path.join(d, "f.txt"), "w").write("x\n")
    subprocess.run(["git", "-C", d, "add", "f.txt"], check=True)
    subprocess.run(["git", "-C", d, "commit", "-qm", "seed"], check=True)
    real = subprocess.run(["git", "-C", d, "rev-parse", "HEAD"],
                          capture_output=True, text=True).stdout.strip()

    print("CLAIM CLASS 1 — a hex token is a sha only if the object db says so")
    check("real sha is a commit", is_commit(real[:9], d), True)
    # RED CONTROL: a session-id-shaped token that is NOT a commit must be refused.
    check("session-id-shaped token refused", is_commit("dddddddd", d), False)
    check("shas_in keeps only the real one",
          shas_in(f"see {real[:9]} and peer dddddddd", d), [real[:9].lower()])

    print("CLAIM CLASS 2 — frontmatter is bounded by the closing ---")
    p = os.path.join(d, "m.md")
    open(p, "w").write("---\nfrom: aaaaaaaa\nto: bbbbbbbb\nsubject: s\n"
                       "signal: review-request\ncreated: 2026-01-01T00:00:00Z\n---\n"
                       "body text\nsignal: NOT-THE-SIGNAL\n")
    got = parse_mail(p)
    check("body line does not overwrite signal", got["signal"], "review-request")
    # RED CONTROL: a file with no frontmatter at all must be refused, not half-parsed.
    p2 = os.path.join(d, "n.md")
    open(p2, "w").write("no frontmatter here\nsignal: x\n")
    check("frontmatter-less file refused", parse_mail(p2), None)

    print("CLAIM CLASS 3 — the states come from the scan's open set, each flipping on ONE removed input")
    me = "bbbbbbbb"
    s7 = real[:7]

    def doc_of(opened, via=None):
        return {"requests": [{"from": "aaaaaaaa", "when": "2026-01-01T00:00:00Z",
                              "subject": f"--code request {real[:9]}", "targets": [s7], "context": [],
                              "ledgerOnly": [], "open": opened, "dismissed": [], "closedVia": via or {},
                              "ledgerRows": {}}]}
    ack_m = {"from": me, "to": "aaaaaaaa", "subject": f"got it, {real[:9]} is 3rd in queue",
             "signal": "review-ack", "created": "2026-01-02T00:00:00Z", "_body": ""}
    myreq = {"from": me, "to": "cccccccc", "subject": f"--code request {real[:9]}",
             "signal": "review-request", "created": "2026-01-02T00:00:00Z", "_body": ""}
    check("the scan answered it -> DISPOSED",
          rows_from_scan(doc_of([], {s7: {"path": "own-outbound"}}), [], me)[0]["status"], "DISPOSED")
    # RED CONTROL A: the scan says open and my only outbound is an ACK — named, not disposed.
    check("open + only an ack -> ACK ONLY", rows_from_scan(doc_of([s7]), [ack_m], me)[0]["status"], "ACK ONLY")
    # RED CONTROL B: remove every outbound; the SAME request must go fully silent.
    check("open + nothing sent -> OPEN", rows_from_scan(doc_of([s7]), [], me)[0]["status"], "OPEN")
    ua = rows_from_scan({"requests": [], "unanchored": [{"from": "aaaaaaaa", "when": "2026-01-01T00:00:00Z",
                                                          "subject": "--code request, see inside"}]}, [], me)
    check("an ask citing no commit is a NO SHA CITED row, and the mark says so",
          ([r["status"] for r in ua], "no commit named" in render(me, ua, [], [])), (["NO SHA CITED"], True))
    # RED CONTROL C: my OWN outbound request naming the sha is me asking, not acknowledging.
    check("my own request is not an ack", rows_from_scan(doc_of([s7]), [myreq], me)[0]["status"], "OPEN")
    check("answered_by is the scan's closing path",
          rows_from_scan(doc_of([], {s7: {"path": "ledger"}}), [], me)[0]["answered_by"], ["ledger"])
    dd = doc_of([]); dd["requests"][0]["dismissed"] = [s7]
    check("a dismissed sha is named dismissed, never 'answered'", rows_from_scan(dd, [], me)[0]["answered_by"],
          ["dismissed"])

    print("CLAIM CLASS 4 — ledger parsing ignores a session-id heading")
    os.makedirs(os.path.join(d, "plans"), exist_ok=True)
    open(os.path.join(d, "plans", f"session-{me}-2026-01-01.md"), "w").write(
        f"### `{real[:9]}` — a real row, `aaaaaaaa`, 2026-01-01 — VERDICT SENT\n"
        "### `dddddddd`'s finding (g) — not a ledger row at all\n")
    lr = ledger_rows(me, d)
    check("one ledger row, not two", len(lr), 1)
    check("and it is the real sha", lr[0]["shas"], [real[:9].lower()])

    print("CLAIM CLASS 6 — an empty plan ledger reports the cross-check NOT RUN, never drift")
    row = {"from": "aaaaaaaa", "subject": "s", "created": "2026-01-01T00:00:00Z",
           "cited": [real[:9]], "answered_by": [], "status": "DISPOSED",
           "silent": [], "ack_only": [], "fell_back": False}
    out = render(me, [row], [], [], want_owed=False)
    check("no DIVERGENCE claim without ledger rows", "DIVERGENCE" in out, False)
    check("says the cross-check did not run", "did NOT run" in out, True)

    print("CLAIM CLASS 5 + CLAIM CLASS 7 — END TO END through the real closure scan: targets vs context,"
          " the tracked ledger closes, a ledger-only commit is CONTEXT")

    def commit_file(rel, msg):
        os.makedirs(os.path.dirname(os.path.join(d, rel)) or d, exist_ok=True)
        open(os.path.join(d, rel), "w").write(rel + "\n")
        subprocess.run(["git", "-C", d, "add", rel], check=True)
        subprocess.run(["git", "-C", d, "commit", "-qm", msg], check=True)
        return subprocess.run(["git", "-C", d, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    led = commit_file(LEDGER_DOC_REL, "ledger(hub): arrival rows")
    c_sha, u_sha, w_sha = commit_file("h.txt", "h"), commit_file("g.txt", "g"), commit_file("k.txt", "k")
    mdir = os.path.join(d, "mail")
    os.makedirs(mdir)

    def put(n, frm, to, subject, body, signal="", created="2026-01-01T00:00:00Z"):
        sig = f"signal: {signal}\n" if signal else ""
        open(os.path.join(mdir, f"x__{n}__y.md"), "w").write(
            f"---\nfrom: {frm}\nto: {to}\nsubject: {subject}\n{sig}created: {created}\n---\n\n{body}\n")
    put(0, "aaaaaaaa", me, f"--code request {real[:9]}", f"--code request.\nSince {c_sha[:9]} a thing changed.",
        created="2026-01-01T00:00:00Z")
    put(1, "aaaaaaaa", me, f"--code request {led[:9]}", "--code request, the base.", created="2026-01-01T00:01:00Z")
    put(2, "aaaaaaaa", me, f"--code request {u_sha[:9]}", "--code request.", created="2026-01-01T00:02:00Z")
    put(3, "aaaaaaaa", me, f"--code request {w_sha[:9]}", "--code request.", created="2026-01-01T00:03:00Z")
    put(4, "aaaaaaaa", me, "--code request: BATCH of 1", f"--code request\n- {c_sha[:9]} the change",
        created="2026-01-01T00:04:00Z")
    put(5, me, "aaaaaaaa", f"got it, {w_sha[:9]} is 3rd in queue", "queued", signal="review-ack",
        created="2026-01-01T00:05:00Z")
    put(6, "aaaaaaaa", me, "--code request, details inside", f"Please look at the change in {u_sha[:9]} here.",
        created="2026-01-01T00:06:00Z")

    def fx_ledger(verdict, reviewer):
        fp = os.path.join(d, f"fx-ledger-{reviewer}-{len(verdict)}.md")
        open(fp, "w").write("| Date | Commit | Verdict | Reviewer | Mail | Note |\n|---|---|---|---|---|---|\n"
                            f"| 2026-10-26 | `{real[:9]}` | {verdict} | `{reviewer}` | m.md | n |\n")
        return fp

    def scan_rows(ledger_path):
        doc = run_closure_scan(me, repo=d, env_extra={"FF_MAIL_DIR": mdir, "FF_REVIEW_LEDGER": ledger_path})
        return doc, {r["subject"]: r for r in rows_from_scan(doc, load_mail(mdir), me)}
    doc, by = scan_rows(fx_ledger("✅ **FOLD-VERIFIED**", "cccccccc"))
    check("the scan ran clean and handed over every request", (doc.get("control"), len(by)), ("ok", 6))
    ra = by[f"--code request {real[:9]}"]
    check("a FOLD-VERIFIED ledger row closes the request with no mail at all",
          (ra["status"], ra["answered_by"]), ("DISPOSED", ["ledger"]))
    check("CLASS 5: the subject sha is the TARGET, a mid-prose body sha is CONTEXT",
          (ra["cited"], ra["context"]), ([real[:7]], [c_sha[:7]]))
    check("CLASS 5: a subject naming none takes its targets from the body's line heads",
          by["--code request: BATCH of 1"]["cited"], [c_sha[:7]])
    rb = by[f"--code request {led[:9]}"]
    check("a request citing only a ledger-only sha reads 0 open", (rb["status"], rb["silent"]), ("CONTEXT ONLY", []))
    check("and the ledger sha is kept as CONTEXT, never dropped", rb["ledger_context"], [led[:7]])
    check("a sha nobody answered reads OPEN", by[f"--code request {u_sha[:9]}"]["status"], "OPEN")
    check("a sha only my ack named reads ACK ONLY", by[f"--code request {w_sha[:9]}"]["status"], "ACK ONLY")
    rm = by["--code request, details inside"]
    out = render(me, [rm], [], [])
    check("a mid-prose-only request carries its unanswered sha, and the mark AND the footer say so",
          (rm["status"], rm.get("open_context"), "sha(s) cited only mid-prose, unanswered" in out,
           "row(s) carry unanswered shas cited only mid-prose" in out), ("CONTEXT ONLY", [u_sha[:7]], True, True))
    check("a zero-answered control prints its CONTROL line; an ok one does not",
          ("⛔ CONTROL" in render(me, [rm], [], [], tracked={"control": "zero-answered"}),
           "⛔ CONTROL" in render(me, [rm], [], [], tracked={"control": "ok"})), (True, False))
    bad = os.path.join(d, "mail-bad")
    os.makedirs(bad)
    open(os.path.join(bad, "x__9__y.md"), "w").write(
        f"---\nfrom: aaaaaaaa\nto: {me}\nsubject: --code request deadbee12\nsignal: review-request\n"
        "created: 2026-01-01T00:00:00Z\n---\n\nplease\n")
    try:
        run_closure_scan(me, repo=d, env_extra={"FF_MAIL_DIR": bad})
        raised = False
    except RuntimeError:
        raised = True
    check("a failed git-filter control raises, never an empty queue", raised, True)
    # RED CONTROLS: an arrival row settles nothing, and a requester cannot close their own request.
    check("an ARRIVAL row (QUEUED) closes nothing",
          scan_rows(fx_ledger("🔬 **QUEUED — PANEL OUT**", "cccccccc"))[1][f"--code request {real[:9]}"]["status"], "OPEN")
    check("a row whose reviewer is the requester closes nothing",
          scan_rows(fx_ledger("✅ **FOLD-VERIFIED**", "aaaaaaaa"))[1][f"--code request {real[:9]}"]["status"], "OPEN")

    subprocess.run(["rm", "-rf", d])
    print()
    if fails:
        print(f"SELF-TEST FAILED — {len(fails)} arm(s): {', '.join(fails)}")
        return 1
    _nclasses = len(set(re.findall(r"CLAIM CLASS (\d)", _src)))
    print(f"SELF-TEST PASSED — {_ran[0]} assertions, {_nclasses} claim classes,"
          " each flipping on one removed input.")
    return 0


def main():
    args = sys.argv[1:]
    if "--self-test" in args:
        return self_test()
    me = None
    if "--sid" in args:
        me = args[args.index("--sid") + 1]
    if not me:
        env = os.environ.get("CLAUDE_CODE_SESSION_ID", "")
        me = env.split("-")[0] if env else None
    if not me:
        print("review-queue: cannot determine this seat's id — pass --sid <sid8>.",
              file=sys.stderr)
        return 2

    try:
        doc = run_closure_scan(me)
    except RuntimeError as e:
        print(f"review-queue: {e} — no queue printed, because one without its OPEN set reads as empty.",
              file=sys.stderr)
        return 2
    mail = load_mail()
    rows = rows_from_scan(doc, mail, me)
    ledger = ledger_rows(me)
    hubs = hub_status(me)
    tracked = dict(doc.get("ledger") or {}, control=doc.get("control"))

    if "--json" in args:
        print(json.dumps({"seat": me, "hubs": [
            {k: v for k, v in h.items()} for h in hubs], "rows": rows,
            "ledger": ledger, "tracked_ledger": tracked}, indent=2, default=str))
        return 0
    print(render(me, rows, ledger, hubs, want_owed="--no-owed" not in args, tracked=tracked))
    return 0


if __name__ == "__main__":
    sys.exit(main())
