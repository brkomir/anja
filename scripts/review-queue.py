#!/usr/bin/env python3
"""review-queue.py — the review hub's status and its queue table, DERIVED every run.

WHY THIS EXISTS. The hub's own spec says a queue claim must be re-derived before every
assertion, and then documents twice that the re-derivation is expensive enough that it
silently degrades into RESTATING the last one (review-hub/SKILL.md, occurrence 2,
2026-08-25: forty minutes of "one open hold, everything else clear" that was true of the
hub's model and false of the store). A ledger was the answer to WHERE the state lives; this
is the answer to HOW MUCH IT COSTS TO READ. One command, no recall.

⛔ WHAT IT DOES NOT DO. It reads the MAIL PLANE only. A loop closed in a commit body, a
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

REQUEST_SIGNALS = {"review-request", "deploy-review"}

# ⛔ THREE CLASSES, NOT TWO — AND THE MIDDLE ONE IS THE POINT. The hub's own spec says
# "ANSWERED IS NOT HANDLED": an ACK names the sha and disposes of nothing, so a scan that
# scores any outbound as an answer reports a queue that is cleaner than it is. The
# requester cannot tell QUEUED from FORGOTTEN, and those demand opposite actions from
# them — so ACK-ONLY gets its own state rather than being folded into either neighbour.
DISPOSITION_SIGNALS = {
    "review-verdict", "review-response", "review-finding", "review-fold",
    "fold-verify", "fold-report", "deploy-clear", "deploy-hold", "deploy-hold-ack",
    "correction",
}
ACK_SIGNALS = {"review-ack", "ack", "review-interim", "interim", "info"}
# An outbound REQUEST of my own naming a sha is me ASKING, never me answering.
NON_ANSWER_SIGNALS = {"review-request", "deploy-review"}
HEX_RE = re.compile(r"\b([0-9a-f]{7,40})\b")
LEDGER_ROW_RE = re.compile(r"^###\s+`([^`]+)`\s*(.*)$")
REBROADCAST_HOURS = 48.0


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


def prefill_sha_cache(mail, repo=None):
    """Answer every hex token in `mail` with ONE `git cat-file --batch-check` instead of one
    `git cat-file -e` per token. Same question (`<tok>^{commit}` resolves to a commit), same
    cache, so is_commit's answers do not change — only the process count does (measured
    2026-10-15 on the live store: 627 tokens answered in 0.12 s by one process; 0 of 60 sampled
    tokens answered differently by `-e`)."""
    toks = sorted({t.lower() for m in mail
                   for t in HEX_RE.findall((m.get("subject", "") or "") + "\n" + (m.get("_body", "") or ""))}
                  - set(_SHA_CACHE))
    if not toks:
        return 0
    try:
        r = subprocess.run(["git", "cat-file", "--batch-check=%(objecttype)"], cwd=repo or REPO_DIR,
                           input="".join(f"{t}^{{commit}}\n" for t in toks), capture_output=True, text=True)
    except Exception:
        return 0                  # leave the cache cold; is_commit answers per token as before
    out = r.stdout.split("\n")
    if r.returncode != 0 or len(out) < len(toks):
        return 0
    for t, o in zip(toks, out):
        _SHA_CACHE[t] = o.strip() == "commit"
    return len(toks)


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

def build_rows(mail, me, repo=None):
    inbound = [m for m in mail if m.get("to") == me]
    outbound = [m for m in mail if m.get("from") == me]

    # Every sha this seat has named in an outbound, bucketed by what that outbound DID.
    disposed, acked = {}, {}
    for m in outbound:
        sig = (m.get("signal") or "info").strip()
        if sig in NON_ANSWER_SIGNALS:
            continue          # my own request naming a sha is not an answer to theirs
        text = (m.get("subject", "") or "") + "\n" + (m.get("_body", "") or "")
        bucket = disposed if sig in DISPOSITION_SIGNALS else acked
        for s in shas_in(text, repo):
            bucket.setdefault(s, set()).add(sig)

    rows = []
    for m in inbound:
        sig = (m.get("signal") or "").strip()
        subject = m.get("subject", "")
        body = m.get("_body", "")
        is_request = sig in REQUEST_SIGNALS
        if not is_request:
            # A request can arrive untyped; the SUBJECT is the discriminator the hub's own
            # scanner uses, and its measured failure was keying on phrasing alone.
            low = subject.lower()
            if ("--code" in low or "review request" in low or "review-request" in low
                    or low.startswith("code review")):
                is_request = True
        if not is_request:
            continue
        # ⛔ THE SUBJECT IS THE TARGET; THE BODY IS CONTEXT. A request cites shas mid-prose
        # for background, and treating those as review TARGETS is what makes a queue read
        # 6x worse than it is (measured on this store: 53 body-shas against 8 real targets).
        # The hub's own closure scanner draws the same line and calls the rest CONTEXT.
        targets = shas_in(subject, repo)
        context = [s for s in shas_in(body, repo) if s not in targets]
        if not targets and context:
            targets, context = context, []   # subject named none: fall back, and say so
            fell_back = True
        else:
            fell_back = False
        undisposed = [s for s in targets if s not in disposed]
        ack_only = [s for s in undisposed if s in acked]
        silent = [s for s in undisposed if s not in acked]
        by = sorted({g for s in targets for g in disposed.get(s, set())})
        if not targets:
            status = "NO SHA CITED"
        elif not undisposed:
            status = "DISPOSED"
        elif silent:
            status = "OPEN"
        else:
            status = "ACK ONLY"
        rows.append({
            "from": m.get("from"), "subject": subject,
            "created": m.get("created", ""), "signal": sig or "(untyped)",
            "cited": targets, "context": context, "fell_back": fell_back,
            "unanswered": undisposed, "ack_only": ack_only, "silent": silent,
            "answered_by": by, "status": status, "read": m.get("_read", False),
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

def render(me, rows, ledger, hubs, want_owed=True):
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
        if ackonly:
            L.append("  ⛔ AN ACK IS NOT A DISPOSITION. Those rows look answered to every")
            L.append("     sha-keyed instrument and are not — from the requester's side,")
            L.append("     queued and forgotten are indistinguishable.")
        fb = [r for r in rows if r.get("fell_back")]
        if fb:
            L.append(f"  ⚠️ {len(fb)} row(s) named no commit in the SUBJECT, so their targets")
            L.append("     were taken from the body — a weaker reading than the rest.")
    L.append("")
    L.append("  ⚠️ FLOOR, never a count. This reads the MAIL PLANE only — a loop closed in a")
    L.append("     commit body, a tracker row or a channel reads OPEN here. And a verdict that")
    L.append("     answered by RANGE rather than by sha leaves its request reading OPEN:")
    L.append("     the scan keys on the sha, so name each one you cover.")
    L.append("")

    # --- ledger cross-check
    L.append("## Ledger cross-check")
    if not ledger:
        L.append("  No ledger rows found in this seat's plan file.")
        if rows:
            L.append("  ⛔ DIVERGENCE: the store holds requests and the ledger holds none —")
            L.append("     rows are not being written on arrival, which is the drift the")
            L.append("     ledger exists to prevent.")
    else:
        # ⛔ COMPARE AT THE GRAIN OF THE OBLIGATION, WHICH IS ONE ROW PER *REQUEST*.
        # Comparing every-sha-mentioned against ledger-heading-shas is the wrong axis and
        # over-reports ~6x — measured on this store, 53 "missing" against 8 real. Name the
        # binding predicate first, then derive the set from it.
        led = {s for r in ledger for s in r["shas"]}
        unrowed = [r for r in rows if r["cited"] and not (set(r["cited"]) & led)]
        rowed = len(rows) - len(unrowed) - len([r for r in rows if not r["cited"]])
        L.append(f"  ledger rows: {len(ledger)} · store requests: {len(rows)}"
                 f" · requests WITH a ledger row: {rowed}")
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

    print("CLAIM CLASS 3 — the three states, each flipping on ONE removed input")
    me = "bbbbbbbb"
    req = {"from": "aaaaaaaa", "to": me, "subject": f"--code request {real[:9]}",
           "signal": "review-request", "created": "2026-01-01T00:00:00Z", "_body": ""}
    verdict = {"from": me, "to": "aaaaaaaa", "subject": f"VERDICT {real[:9]} approved",
               "signal": "review-verdict", "created": "2026-01-02T00:00:00Z", "_body": ""}
    ack_m = {"from": me, "to": "aaaaaaaa", "subject": f"got it, {real[:9]} is 3rd in queue",
           "signal": "review-ack", "created": "2026-01-02T00:00:00Z", "_body": ""}
    myreq = {"from": me, "to": "cccccccc", "subject": f"--code request {real[:9]}",
             "signal": "review-request", "created": "2026-01-02T00:00:00Z", "_body": ""}
    check("verdict present -> DISPOSED",
          build_rows([req, verdict], me, d)[0]["status"], "DISPOSED")
    # RED CONTROL A: swap the verdict for an ACK. An ack names the sha and disposes of
    # nothing — the old two-state code scored this ANSWERED, which is the whole defect.
    check("only an ack -> ACK ONLY", build_rows([req, ack_m], me, d)[0]["status"], "ACK ONLY")
    # RED CONTROL B: remove every outbound; the SAME request must go fully silent.
    check("nothing sent -> OPEN", build_rows([req], me, d)[0]["status"], "OPEN")
    # RED CONTROL C: my OWN outbound request naming the sha is me asking, not answering.
    check("my own request does not answer theirs",
          build_rows([req, myreq], me, d)[0]["status"], "OPEN")

    print("CLAIM CLASS 5 — subject shas are TARGETS, body shas are CONTEXT")
    ctx = {"from": "aaaaaaaa", "to": me, "subject": f"--code request {real[:9]}",
           "signal": "review-request", "created": "2026-01-01T00:00:00Z",
           "_body": f"for background see {real} which is unrelated"}
    r5 = build_rows([ctx], me, d)[0]
    check("target taken from the subject", r5["cited"], [real[:9].lower()])
    # RED CONTROL: subject names none -> fall back to body AND flag the weaker reading.
    nosub = dict(ctx, subject="--code request, details inside")
    r5b = build_rows([nosub], me, d)[0]
    check("subject-less request falls back to body", r5b["cited"], [real.lower()])
    check("and the fallback is FLAGGED, not silent", r5b["fell_back"], True)

    print("CLAIM CLASS 4 — ledger parsing ignores a session-id heading")
    os.makedirs(os.path.join(d, "plans"), exist_ok=True)
    open(os.path.join(d, "plans", f"session-{me}-2026-01-01.md"), "w").write(
        f"### `{real[:9]}` — a real row, `aaaaaaaa`, 2026-01-01 — VERDICT SENT\n"
        "### `dddddddd`'s finding (g) — not a ledger row at all\n")
    lr = ledger_rows(me, d)
    check("one ledger row, not two", len(lr), 1)
    check("and it is the real sha", lr[0]["shas"], [real[:9].lower()])

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

    mail = load_mail()
    prefill_sha_cache(mail)
    rows = build_rows(mail, me)
    ledger = ledger_rows(me)
    hubs = hub_status(me)

    if "--json" in args:
        print(json.dumps({"seat": me, "hubs": [
            {k: v for k, v in h.items()} for h in hubs], "rows": rows,
            "ledger": ledger}, indent=2, default=str))
        return 0
    print(render(me, rows, ledger, hubs, want_owed="--no-owed" not in args))
    return 0


if __name__ == "__main__":
    sys.exit(main())
