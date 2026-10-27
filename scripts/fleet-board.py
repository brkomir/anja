#!/usr/bin/env python3
"""fleet-board.py — ONE read-only board of every seat in this repo, derived on every render.

WHY THIS EXISTS. The owner was the fleet's coordination layer, asking each session where it
stood, relaying between seats and resolving contradictory reports by hand. That was a gap, and this
board closes it. Surfaced
as `/peers --board`. It STORES NOTHING: every cell is computed at render time from the instrument
named beside it, with its age, and a quiet fleet is a short table, never an error.

THE THREE DESIGN FORKS THE BRIEF LEFT OPEN, decided here (brief §3):
  1. SUBJECT SOURCE — `session-manifest.py who` has no --json, so this IMPORTS its helpers by
     path (the way review-queue.py loads that module) and reads the newest substantive user
     message from the transcript TAIL through `recent_user_msgs_tail`, which applies the SAME
     message filter as `scan_jsonl` and escalates its budget until a typed (non-fragment) message
     is in hand. No files-touched count: it needs a whole-file parse — 6.6 of the first live
     render's 14.6 s, and the parse also wrote the shared sub-agent cache — and `/peers` already
     shows the file NAMES.
  2. HOLD SOURCE — no `writehold*` / `go-quiet*` marker exists in `.claude/state/` and the promote
     skill writes none (push/SKILL.md steps 1-3 send MAIL signals `writehold-armed` / `writehold` /
     `writehold-lifted` and HOLD / GO-QUIET / ALL-CLEAR subjects, nothing on disk). So holds are read
     from the newest broadcast per sender in the mail store, walked FORWARD from the hold to its lift
     (a lift is time-adjacent to its hold, not to now), and a hold whose body says "lapses HH:MMZ"
     past now renders `lapsed`. Holds are kept per sender AND per plane: a signal-carried hold
     (`writehold-armed` / `writehold` / `deploy-baton`) is the dev-push plane, a subject-only HOLD /
     GO-QUIET is the commit plane; a signal lift clears the push plane, an ALL-CLEAR / HOLD LIFTED
     subject clears both (2026-10-15: a per-sender clear read one lifted hold of two as all
     clear). The one on-disk hold, `promote-inline-hold` in the git dir (/promote step 7, read by
     push/SKILL.md D0), is read too. NOT read: an open promote PR, and the `deploy-clear` /
     `deploy-hold-ack` signals D0 treats as clear. It is a FLOOR: a lift written only in a commit
     body is invisible.
  3. TRAILER JOIN — settled by the brief: `session-labels.py` already reads the 8-hex trailer, the
     URL-form trailer and the sid-scoped subject. This reuses its `read_urls` / `git_rows` / `scope_re`
     / `classify` and builds the fleet-wide URL->seat map from the LIVE seats' transcripts only
     (bounded: the board renders live seats). A commit no live seat claims reads "unattributed".

REVIEW LOOPS AND THE HUB LIST come from review-queue.py and hub-unfinished-loops.py IMPORTED, over
ONE load of the store with every cited sha answered by one `git cat-file --batch-check` — the
per-seat subprocesses re-read the store and spawned one `git cat-file -e` per token (6.0 of 14.6 s).
The hub list is review-queue's `hub_status`, so a `.retiring` companion is a flag, never a hub.
EVERY MAIL-PLANE NUMBER IS A FLOOR (review-queue.py and hub-unfinished-loops.py say so themselves).
ALIVE COMES FROM `claude agents --json`, THE ONLY COMPLETE LIVENESS LIST — never file mtime. A standby
or paused seat reads `idle` there, so lifecycle comes from the markers (session_status.py, the SSOT).

OWNER-PENDING, THE ONE TOKEN. New rows write
`owner-pending: <why — taste call | external fact | irreversible action | spend | merchant-verified page | rule change>`; the older spellings
stay readable through OWNER_PENDING_ALIASES and are never back-migrated (`⏸ owner-deferred` is not one
of them: it is /summary §2's live deferral marker, still written, counted here under its own alias).

Usage:
  fleet-board.py [--json | --table] [--plan-lag-min N] [--git-max-count N]
                 [--agents-json FILE] [--state-dir D] [--sessions-dir D] [--plans-dir D]
                 [--mail-dir D] [--todo FILE] [--repo DIR]
  fleet-board.py --self-test            seeds a wrapped seat + a stale-plan seat; exit 0 iff both render
  fleet-board.py --self-test --break-seed   the RED control: the same run with the stale plan made fresh,
                                            which MUST exit non-zero

Exit 0 on any fleet, 1 on a self-test failure, 2 on an instrument failure (the CLI refusing to answer).
"""
import argparse
import glob
import importlib.util as _ilu
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import session_status  # noqa: E402


def _load(modname, fname):
    """Load a hyphen-named sibling script by path (review-queue.py's precedent)."""
    spec = _ilu.spec_from_file_location(modname, os.path.join(HERE, fname))
    mod = _ilu.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


SM = _load("_ff_session_manifest", "session-manifest.py")
SL = _load("_ff_session_labels", "session-labels.py")
# The mail-plane readers and the /summary §5 owner predicate are IMPORTED, never re-spelled: one
# load of the store and one batched sha check serve every seat, and the owner regexes, their
# resolution order and FILED_BY come from the spec through the extractor that guards them.
RQ = _load("_ff_review_queue", "review-queue.py")
HUL = _load("_ff_hub_unfinished_loops", "hub-unfinished-loops.py")
SOPC = _load("_ff_summary_owner_predicate_check", "summary-owner-predicate-check.py")
HEX8 = re.compile(r"[0-9a-f]{8}")

OWNER_PENDING_TOKEN = "owner-pending:"
# The alias list: the one token first, then the older spellings. A regex proxy over prose, never a
# count (a row that only QUOTES a spelling counts; a spelling outside the list does not). `owner:
# owner` also admits `the owner` / `founder` (36 + 3 open rows at 2026-10-15) and is
# case-insensitive (21 `owner: OWNER` rows, all the human). `owner-deferred`
# is NOT an older spelling: it is /summary §2's live marker for "the owner answered later" and stays
# written at the deferral; the board counts it under its own alias. Re-count before quoting a figure.
OWNER_PENDING_ALIASES = [
    ("owner-pending:", re.compile(r"\bowner-pending:")),
    ("needs-owner", re.compile(r"\bneeds-owner\b")),
    ("owner: owner", re.compile(r"\bowner: *\**(?:the +)?(?:owner|founder)\b", re.I)),
    ("owner-deferred", re.compile(r"\bowner-deferred\b", re.I)),
    ("blocked-on: owner", re.compile(r"\bblocked-on: *owner\b", re.I)),
    ("OWNER-DECISION", re.compile(r"\bOWNER-DECISION\b")),
    ("awaiting owner", re.compile(r"\bawaiting owner\b", re.I)),
]
HUB_HOLD = re.compile(r"^- \[ \] (HUB-HOLD-[A-Z0-9-]+)")

HOLD_ON_SIGNALS = {"writehold-armed", "writehold", "deploy-baton"}
HOLD_OFF_SIGNALS = {"writehold-lifted"}
HOLD_ON_SUBJECT = re.compile(r"^\s*(HOLD EXTENDED|HOLD|GO-QUIET)\b", re.I)
HOLD_OFF_SUBJECT = re.compile(r"^\s*(ALL-CLEAR|HOLD LIFTED)\b", re.I)
LAPSE_RE = re.compile(r"lapses (\d{1,2}):(\d{2})Z")
PLAN_BLOCK = re.compile(r"^## .*\b(PRE-COMPACT|POST-COMPACT|OWNER PAUSE|▶ RESUMED|CLOSABILITY —)")
PLAN_HEADINGS = ("## Arc", "## Live items", "## Closability")


def fail(msg):
    print(f"fleet-board: INSTRUMENT FAILURE — {msg}", file=sys.stderr)
    sys.exit(2)


def age(now, epoch):
    if not epoch:
        return "?"
    return SM.human_age(max(0.0, now - epoch))


# ── liveness: the CLI, never mtime ──────────────────────────────────────────────────────────
def read_agents(args):
    if args.agents_json:
        with open(args.agents_json, encoding="utf-8") as fh:
            data = json.load(fh)
        src = os.path.basename(args.agents_json)
    else:
        try:
            r = subprocess.run(["claude", "agents", "--json"], capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.TimeoutExpired) as e:
            fail(f"`claude agents --json` did not answer: {e}")
        if r.returncode != 0:
            fail(f"`claude agents --json` rc={r.returncode}: {r.stderr.strip()[:200]}")
        try:
            data = json.loads(r.stdout)
        except ValueError:
            fail("`claude agents --json` returned non-JSON")
        src = "claude agents --json"
    if not isinstance(data, list):
        fail("agents list is not a JSON list")
    repo = os.path.realpath(args.repo)
    seats = []
    for a in data:
        cwd = os.path.realpath(str(a.get("cwd", "")))
        if cwd != repo and not cwd.startswith(repo + os.sep):   # a seat launched in a subdir or .claude/worktrees/* is this repo's too
            continue
        sid = str(a.get("sessionId", ""))[:8].lower()
        seats.append({"sid": sid, "full": str(a.get("sessionId", "")), "status": a.get("status"),
                      "name": a.get("name"), "pid": a.get("pid"),
                      "started": (a.get("startedAt") or 0) / 1000.0})
    seats.sort(key=lambda s: (s["status"] != "busy", -(s["started"] or 0)))
    return seats, src, len(data)


# ── lifecycle: the markers, through the SSOT ────────────────────────────────────────────────
def _first_int(path):
    try:
        parts = open(path).read().split()
        return int(parts[0]) if parts else os.path.getmtime(path)
    except Exception:
        try:
            return os.path.getmtime(path)
        except OSError:
            return 0


def lifecycle(sid, args, now, hubs=()):
    st = session_status.lifecycle_status(sid, args.state_dir, args.sessions_dir)
    bits, epoch = [], 0
    if st in ("WRAPPED", "CHECKPOINT"):
        epoch = session_status.read_wrapped(session_status.wrapped_marker(args.state_dir, sid))[1]
    elif st == "STANDBY":
        epoch = session_status.read_standby(session_status.standby_marker(args.state_dir, sid))[0]
    elif st == "EXITED":
        epoch = session_status.read_finished(session_status.finished_marker(args.state_dir, sid))[0]
    bits.append(st.lower() + (f" {age(now, epoch)}" if epoch else ""))
    pause = os.path.join(args.state_dir, f"session-pause-{sid}")
    if os.path.exists(pause):
        body = open(pause, errors="replace").read()
        m = re.search(r"resume=(\S+)", body)
        bits.append("paused" + (f" (resume {m.group(1)})" if m else "") + f" {age(now, _first_int(pause))}")
    for h in hubs:                      # review-queue's hub_status: `.retiring` read, never listed
        if h["sid"] == sid:
            bits.append("HUB" + (" (retiring)" if h["retiring"] else "")
                        + (" (stale broadcast)" if h["stale_broadcast"] else "") + f" {age(now, h['mtime'])}")
    p = os.path.join(args.state_dir, f"review-hub-paused-{sid}")
    if os.path.exists(p):
        bits.append(f"hub-paused {age(now, os.path.getmtime(p))}")
    return st, " · ".join(bits)


# ── subject: the transcript, through the manifest's own scanner ─────────────────────────────
def _mtime(p):
    """mtime, or -1 for a path that vanished between glob and stat — one seat's race must cost that
    seat's cell, never the whole board (an unguarded getmtime here exited 1 with NO output)."""
    try:
        return os.path.getmtime(p)
    except OSError:
        return -1


def transcript(sid, args):
    hits = [p for p in glob.glob(os.path.join(args.sessions_dir, f"{sid}*.jsonl")) if _mtime(p) >= 0]
    return max(hits, key=_mtime) if hits else None


def subject(tx):
    """The seat's newest substantive user message, read from the transcript TAIL through the
    manifest's own message filter (SM.recent_user_msgs_tail). No files-touched count: that needs
    a whole-file parse (6.6 of 14.6 s on the first live render) and `/peers` shows the file NAMES."""
    if not tx:
        return "— (no transcript)"
    try:
        _ws, msgs, _n = SM.recent_user_msgs_tail(tx)
    except Exception as e:  # a transcript mid-write is not an instrument failure
        return f"— (scan failed: {type(e).__name__})"
    if not msgs:
        return "— (no user message)"
    m = msgs[0].replace("|", "\\|").replace("\n", " ")
    return m[:60] + ("…" if len(m) > 60 else "")


# ── last commit: session-labels.py's three legs, fleet-wide ─────────────────────────────────
def commits(seats, args):
    """-> {sid: (short, subject, epoch, leg)} for the newest commit each live seat made."""
    out = {}
    if args.git_max_count <= 0:
        return out
    try:
        rows = SL.git_rows(None, None, max_count=args.git_max_count, cwd=args.repo)  # the SAME repo as the epochs below
        r = subprocess.run(["git", "log", f"--max-count={args.git_max_count}", "--format=%H%x1f%ct"],
                           capture_output=True, text=True, cwd=args.repo)
        epochs = dict(line.split("\x1f") for line in r.stdout.split("\n") if "\x1f" in line)
    except SystemExit:
        return None   # git log failed: the cell must read `?`, never `none` (session-labels printed why)
    urls, scopes = {}, {}
    for s in seats:
        tx = transcript(s["sid"], args)
        try:
            urls[s["sid"]] = SL.transcript_urls(tx) if tx else set()
        except SystemExit:
            urls[s["sid"]] = set()
        scopes[s["sid"]] = SL.scope_re(s["sid"])
    for h, short, subj, vals in rows:
        for s in seats:
            sid = s["sid"]
            if sid in out:
                continue
            kind, leg = SL.classify(sid, urls[sid], scopes[sid], subj, vals)
            if kind == "mine":
                out[sid] = (short, subj, int(epochs.get(h, 0)), leg)
        if len(out) == len(seats):
            break
    return out


# ── review loops: the two mail-plane instruments, both floors ───────────────────────────────
def review_loops(sid, mail, args):
    """review-queue's rows_from_scan over run_closure_scan (one node scan per seat) and hub-unfinished-loops' scan, called in-process over ONE load
    of the store (`mail`); a reader that raises costs its own cell, never the board."""
    res = {"open": None, "ack_only": None, "loops": None, "max_wait": None, "err": None}
    try:
        rows = RQ.rows_from_scan(RQ.run_closure_scan(sid, args.repo, {"FF_MAIL_DIR": args.mail_dir}), mail, sid)
        res["open"] = sum(1 for x in rows if x.get("status") == "OPEN")
        res["ack_only"] = sum(1 for x in rows if x.get("status") == "ACK ONLY")
    except Exception as e:
        res["err"] = f"review-queue: {type(e).__name__}"
    try:
        loops, _stats = HUL.scan(args.mail_dir, sid)
        res["loops"] = len(loops)
        res["max_wait"] = max([int(x.get("waited_min", 0)) for x in loops] or [0])
    except Exception as e:
        res["err"] = (res["err"] + "; " if res["err"] else "") + f"unfinished-loops: {type(e).__name__}"
    return res


# ── holds: the broadcast mail plane, walked forward per sender ──────────────────────────────
def read_mail_header(path):
    hdr = {}
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read(6000)
    except OSError:
        return hdr, ""
    for line in text.split("\n")[:12]:
        m = re.match(r"^(from|to|subject|signal|created):\s*(.*)$", line)
        if m:
            hdr[m.group(1)] = m.group(2).strip()
    return hdr, text


def holds(args, now):
    """-> {sender: {subject, created, lapses, lapsed, age}} for senders holding a HOLD (live or lapsed),
    walked in filename-ts order. Per sender the holds are kept PER PLANE — `push` (a signal-carried
    writehold-armed / writehold / deploy-baton) and `commit` (a subject-only HOLD / GO-QUIET) — so a
    signal-only lift clears the push plane alone and an ALL-CLEAR / HOLD LIFTED subject clears both.
    A `.read-by-<sid>` receipt is an EMPTY file under the mail's own (ts, sender) key: a key is marked
    seen only after a NON-EMPTY header read, or the receipt listed first silently takes the mail's
    place (2026-10-15: the shipped order read 3 of 8 hold mails and said "no holds" with
    one live). OFF is classified before ON because `HOLD\b` also matches `HOLD LIFTED`."""
    seen, events = set(), []
    for p in glob.glob(os.path.join(args.mail_dir, "all__*")):
        parsed = HUL.parse_name(os.path.basename(p))     # the store's filename grammar, one definition
        if not parsed or parsed[0] != HUL.BROADCAST_RECIPIENT:
            continue
        key = (str(parsed[1]), parsed[2])
        if key in seen:
            continue
        hdr, text = read_mail_header(p)
        if not hdr:          # the empty receipt: never let it stand in for the mail it marks
            continue
        seen.add(key)
        sig, subj = hdr.get("signal", ""), hdr.get("subject", "")
        if sig in HOLD_OFF_SIGNALS or (sig not in HOLD_ON_SIGNALS and HOLD_OFF_SUBJECT.match(subj)):
            kind = "off"
        elif sig in HOLD_ON_SIGNALS or HOLD_ON_SUBJECT.match(subj):
            kind = "on"
        else:
            continue
        plane = "push" if (sig in HOLD_ON_SIGNALS or sig in HOLD_OFF_SIGNALS) else "commit"
        if kind == "off" and HOLD_OFF_SUBJECT.match(subj):
            plane = "all"    # an ALL-CLEAR / HOLD LIFTED subject lifts every hold the sender holds
        events.append((parsed[1], parsed[2], kind, subj, hdr.get("created", ""), LAPSE_RE.search(text), plane))
    events.sort(key=lambda e: (e[0], e[1], e[2]))
    planes = {}
    for ts, sender, kind, subj, created, lap, plane in events:
        if kind == "off":
            for pl in (["push", "commit"] if plane == "all" else [plane]):
                planes.get(sender, {}).pop(pl, None)
            continue
        lapses, lapsed = None, False
        if lap and created:
            try:
                c = datetime.fromisoformat(created.replace("Z", "+00:00"))
                t = c.replace(hour=int(lap.group(1)), minute=int(lap.group(2)), second=0)
                if t < c:
                    t += timedelta(days=1)
                lapses = t.strftime("%Y-%m-%dT%H:%MZ")
                lapsed = t.timestamp() < now
            except ValueError:
                pass
        planes.setdefault(sender, {})[plane] = {"subject": subj[:70], "created": created, "lapses": lapses,
                                                "lapsed": lapsed, "age": age(now, ts / 1e9), "ts": ts}
    state = {}
    for sender, held in planes.items():
        if not held:
            continue
        live = [h for h in held.values() if not h["lapsed"]] or list(held.values())
        h = dict(max(live, key=lambda x: x["ts"]))
        if len(held) > 1:
            h["subject"] = f"(+{len(held) - 1} more hold) " + h["subject"]
        h.pop("ts")
        state[sender] = h
    return state


def promote_inline_hold(args, now):
    """The one ON-DISK hold: `<git-common-dir>/promote-inline-hold`, written by /promote step 7 and a
    STOP for push/SKILL.md D0. -> a hold record, or None."""
    try:
        r = subprocess.run(["git", "rev-parse", "--git-common-dir"], capture_output=True, text=True, cwd=args.repo)
        gcd = r.stdout.strip() if r.returncode == 0 else ""
    except OSError:
        gcd = ""
    if not gcd:
        return None
    pih = os.path.join(args.repo, gcd, "promote-inline-hold")
    if not os.path.exists(pih):
        return None
    return {"subject": "promote-inline-hold (git dir, /promote step 7)", "created": "", "lapses": None,
            "lapsed": False, "age": age(now, _mtime(pih))}


# ── plans: newest per seat, headings + dated blocks + lag behind the transcript ──────────────
def plan(sid, tx, args, now):
    # a `-partN.md` file holds blocks plan-roll moved out of the live plan; it is never the seat's plan
    files = [p for p in glob.glob(os.path.join(args.plans_dir, f"session-{sid}-*.md"))
             if _mtime(p) >= 0 and not re.search(r"-part\d+\.md$", p)]
    if not files:
        return {"file": None, "text": "— (no plan file)"}
    files.sort(key=lambda p: -_mtime(p))
    p = files[0]
    pm = _mtime(p)
    heads, last_block = 0, None
    try:
        with open(p, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                s = line.rstrip("\n")
                if s in PLAN_HEADINGS:
                    heads += 1
                m = PLAN_BLOCK.match(s)
                if m:
                    last_block = m.group(1).replace("CLOSABILITY —", "CLOSABILITY (dated)")
    except OSError as e:
        return {"file": os.path.basename(p), "text": f"— (plan unreadable: {type(e).__name__})"}
    behind = None
    if tx and _mtime(tx) >= 0:
        lag = (_mtime(tx) - pm) / 60.0
        if lag > args.plan_lag_min:
            behind = int(lag)
    bits = [f"{heads}/3 headings"]
    if last_block:
        bits.append(f"last block {last_block}")
    bits.append(f"plan behind by {behind} min" if behind is not None else f"current (plan {age(now, pm)})")
    if len(files) > 1:
        bits.append(f"{len(files)} plan files, newest by mtime")
    return {"file": os.path.basename(p), "headings": heads, "last_block": last_block,
            "behind_min": behind, "n_files": len(files), "text": " · ".join(bits)}


# ── tracker: owner-pending per seat, HUB-HOLD rows ──────────────────────────────────────────
def todo_rows(path):
    """Open rows, split by the /summary sentinel's own parse_rows (six checkbox forms)."""
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    except OSError:
        return []
    return ["\n".join(r) for r in SOPC.parse_rows(text) if r and r[0].startswith("- [ ] ")]


def owner_preds():
    """(owner_line, owner_pipe, FILED_BY) EXTRACTED from /summary §5 by the sentinel that guards
    them — no fourth copy. A spec the extractor cannot read exits 2, an instrument failure."""
    line_re, pipe_re = SOPC.extract_predicates()
    return line_re, pipe_re, SOPC.extract_filed_predicate()


def seat_owns(sid, body, preds):
    """Is this row the seat's to carry? NOT /summary §5's "actionable by me": there any owner
    value but the seat (`owner: owner`, `needs-owner-ruling`) drops the row, and those values
    ARE the owner-pending signal here. So only an owner field naming ANOTHER SEAT (8-hex) takes
    the row away from its filer (measured 2026-10-15: the §5 reading attributed 28 of the 77
    alias rows carrying a `filed: by <sid>` to no seat at all). §5's CLAIM arm also credits `owner: <sid>`
    ANYWHERE in a row (its line/pipe fields only decide the OVERRIDE); not adopted here, because on the
    alias rows it changes nothing (1 of 137 has an off-field `owner: <sid>`, and its filer is that seat)."""
    line_re, pipe_re, filed_by = preds
    named = SOPC.read_owner(body, line_re, pipe_re)
    named = named.rstrip(".,;:)*") if named else named   # `owner: <sid>.` names that seat (6 rows)
    if named and HEX8.fullmatch(named):
        return named == sid
    return bool(re.search(filed_by(sid), body))


def owner_pending(open_rows, sid=None, preds=None):
    """Rows carrying the token or an alias: the seat's (sid given) or the fleet's (sid None)."""
    by_alias, n = {}, 0
    for body in open_rows:
        if sid is not None and not seat_owns(sid, body, preds):
            continue
        hit = [name for name, rx in OWNER_PENDING_ALIASES if rx.search(body)]
        if hit:
            n += 1
            for h in hit:
                by_alias[h] = by_alias.get(h, 0) + 1
    return n, by_alias


def hub_hold_rows(open_rows):
    out = []
    for body in open_rows:
        m = HUB_HOLD.match(body)
        if m:
            out.append((m.group(1), body))
    return out


# ── render ──────────────────────────────────────────────────────────────────────────────────
def build(args):
    t0 = time.time()
    now = time.time()
    seats, agents_src, n_all = read_agents(args)
    open_rows = todo_rows(args.todo)
    preds = owner_preds()
    hub_rows = hub_hold_rows(open_rows)
    hold_state = holds(args, now)
    pih = promote_inline_hold(args, now)
    if pih:
        hold_state["(promote)"] = pih
    last = commits(seats, args)
    git_ok, last = last is not None, last or {}
    hubs = RQ.hub_status(None, args.state_dir)
    mail = RQ.load_mail(args.mail_dir)
    fleet_op, fleet_alias = owner_pending(open_rows)
    rows = []
    for s in seats:
        sid = s["sid"]
        tx = transcript(sid, args)
        st, life = lifecycle(sid, args, now, hubs)
        subj = subject(tx)
        rv = review_loops(sid, mail, args)
        pl = plan(sid, tx, args, now)
        op_n, op_alias = owner_pending(open_rows, sid, preds)
        my_hub_rows = [name for name, body in hub_rows if sid in body]
        c = last.get(sid)
        rows.append({
            "sid": sid, "name": s["name"] or SM.session_name(s["full"]) or "", "status": s["status"],
            "started": s["started"], "lifecycle": st, "lifecycle_text": life,
            "transcript_mtime": (_mtime(tx) if tx and _mtime(tx) >= 0 else None),
            "subject": subj,
            "last_commit": {"short": c[0], "subject": c[1], "epoch": c[2], "leg": c[3]} if c else None,
            "review": rv, "hold": hold_state.get(sid), "hub_hold_rows": my_hub_rows,
            "plan": pl, "owner_pending": op_n, "owner_pending_by_alias": op_alias,
        })
    fleet = {
        "rendered_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "agents_source": agents_src, "agents_listed": n_all, "seats_in_repo": len(seats),
        "hub": hubs, "holds": hold_state,
        "hub_hold_rows": [name for name, _ in hub_rows],
        "owner_pending_total": fleet_op, "owner_pending_by_alias": fleet_alias,
        "open_rows": len(open_rows), "git_window": args.git_max_count, "git_ok": git_ok,
        "plan_lag_min": args.plan_lag_min, "render_seconds": None,
    }
    fleet["render_seconds"] = round(time.time() - t0, 2)
    return {"fleet": fleet, "seats": rows}


# The column labels, ONE definition: _cells pairs its values with them and the --table header and
# delimiter are built from them, so neither an empty fleet nor a tenth column can mis-shape the table.
COLUMNS = ("Seat", "Alive (CLI)", "Lifecycle (markers)", "Subject (transcript tail)", "Last commit (git, 3 legs)",
           "Review loops (mail, FLOOR)", "Hold (mail, FLOOR)", "Plan (plans/)", "Owner-pending (todo)")


def _cells(r, f, now):
    """One seat's cells, label -> text. Shared by the card and table renderers."""
    nm = f' "{r["name"]}"' if r["name"] else ""
    alive = f"{r['status']} · up {age(now, r['started'])}"
    subj = r["subject"]
    if r["transcript_mtime"]:
        subj += f" · {age(now, r['transcript_mtime'])}"
    c = r["last_commit"]
    commit = (f"`{c['short']}` {c['subject'][:38]}{'…' if len(c['subject']) > 38 else ''} · {age(now, c['epoch'])} · {c['leg']}"
              if c else (f"none in newest {f['git_window']}" if f.get("git_ok", True) else "? (git log failed)"))
    rv = r["review"]
    if rv.get("err") and rv.get("open") is None:
        review = f"? ({rv['err']})"
    else:
        review = f"{rv['open']} open · {rv['ack_only']} ack-only · {rv['loops']} peer loop(s)"
        if rv.get("max_wait"):
            review += f", oldest {rv['max_wait']} min"
    h = r["hold"]
    hold = (f"{'LAPSED' if h['lapsed'] else 'LIVE'}: {h['subject'][:40]} · {h['age']}" if h else "—")
    if r["hub_hold_rows"]:
        hold += f" · HUB-HOLD: {', '.join(r['hub_hold_rows'])}"
    op = f"{r['owner_pending']}" + (f" ({', '.join(f'{k} {v}' for k, v in r['owner_pending_by_alias'].items())})" if r["owner_pending"] else "")
    values = (f"`{r['sid']}`{nm}", alive, r["lifecycle_text"], subj, commit, review, hold, r["plan"]["text"], op)
    assert len(values) == len(COLUMNS), "a cell was added without its COLUMNS label"
    return list(zip(COLUMNS, values))


def _header(board):
    f = board["fleet"]
    hub = (", ".join(h["sid"] + (" (retiring)" if h["retiring"] else "") + (" (stale broadcast)" if h["stale_broadcast"] else "")
                     for h in f["hub"]) if f["hub"] else "none (no review-hub-active marker)")
    live = [f"{s}: {h['subject']}" + (f" — lapses {h['lapses']}" if h['lapses'] else "") + (" LAPSED" if h['lapsed'] else " LIVE")
            for s, h in f["holds"].items()]
    return [
        f"## Fleet board — {f['rendered_at']} · {f['seats_in_repo']} seat(s) in this repo "
        f"of {f['agents_listed']} the CLI lists ({f['agents_source']}) · rendered in {f['render_seconds']}s",
        f"hub: {hub} (marker) · holds: {'; '.join(live) if live else 'none'} (broadcast mail, floor) · "
        f"open HUB-HOLD rows: {len(f['hub_hold_rows'])} (todo.txt)"
        + (" — " + ", ".join(f["hub_hold_rows"]) if f["hub_hold_rows"] else "")
        + f" · owner-pending rows fleet-wide: {f['owner_pending_total']} of {f['open_rows']} open "
        f"({', '.join(f'{k} {v}' for k, v in sorted(f['owner_pending_by_alias'].items(), key=lambda kv: -kv[1]))})",
        "",
    ]


FOOTER = ("_Every cell names its source in its label and carries its age. Alive is the CLI's word, never a file "
          "mtime; a standby/paused seat reads idle there, so lifecycle comes from the markers. Review loops and "
          "holds read the MAIL PLANE ONLY and are floors: a loop closed in a commit body or a hold lifted there "
          "is invisible; holds also read the git dir's `promote-inline-hold`, and never an open promote PR or a "
          "`deploy-clear` / `deploy-hold-ack` signal. Owner-pending is a regex proxy over prose, never a count: "
          "a row that only quotes a spelling counts, one spelled outside the alias list does not, a row matching "
          "two aliases counts once in the total and once per alias, and per-seat cells cover live seats only. "
          "`plan behind by N min` = transcript written N min after the plan's last save "
          "(threshold {lag} min)._")


def render(board, now=None, table=False):
    """Default: one CARD per seat — `**Label:** value` lines with a rule between seats. The terminal's
    stacked rendering of the wide table is the readable form, so the script emits it itself rather than
    relying on a renderer to flatten a 9-column table. `--table` keeps the markdown table for a wide pane
    or a file."""
    now = now or time.time()
    f = board["fleet"]
    out = _header(board)
    if not board["seats"]:
        out.append(f"_No seat in this repo: the CLI listed {f['agents_listed']}, and a seat counts only when its cwd is "
                   "the repo or a directory under it._")
    if table:
        out.append("| " + " | ".join(COLUMNS) + " |")
        out.append("|" + "---|" * len(COLUMNS))
        for r in board["seats"]:
            out.append("| " + " | ".join(v for _, v in _cells(r, f, now)) + " |")
    else:
        for i, r in enumerate(board["seats"]):
            if i:
                out.append("")
                out.append("─" * 48)
                out.append("")
            for label, value in _cells(r, f, now):
                out.append(f"**{label}:** {value}")
    out.append("")
    out.append(FOOTER.format(lag=f.get("plan_lag_min", "?")))
    return "\n".join(out)


# ── self-test ───────────────────────────────────────────────────────────────────────────────
def self_test(break_seed):
    tmp = tempfile.mkdtemp(prefix="fleet-board-selftest-")
    state, sessions, plans, mail = (os.path.join(tmp, d) for d in ("state", "sessions", "plans", "mail"))
    for d in (state, sessions, plans, mail):
        os.makedirs(d)
    now = time.time()
    # A throwaway git repo is the board's --repo, so the commit and review columns run through the
    # SAME readers the live render uses (nothing here is skipped). GIT_* from an enclosing hook
    # would point git elsewhere; this process is the self-test's own, so drop them.
    for k in [k for k in os.environ if k.startswith("GIT_")]:
        os.environ.pop(k)
    repo = os.path.join(tmp, "repo")
    os.makedirs(repo)
    wrapped, stale, exited = "aaaa1111", "bbbb2222", "dddd4444"
    for cmd in (["init", "-q"], ["config", "user.email", "t@t"], ["config", "user.name", "t"],
                ["commit", "-q", "--allow-empty", "-m", "fixture: wrapped seat's commit", "-m", f"Claude-Session: {wrapped}"]):
        subprocess.run(["git", "-C", repo, *cmd], capture_output=True, text=True, check=True)
    head = subprocess.run(["git", "-C", repo, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    # three NEWER commits by the stale seat: the wrapped seat's only commit now sits under them, and the
    # window must still reach it by its sid trailer (the DEFAULT window is pinned by its own arm below:
    # a 4-commit fixture cannot tell 100000 from 400, which missed 2 of 7 live seats)
    for msg in ("a", "b", "c"):
        subprocess.run(["git", "-C", repo, "commit", "-q", "--allow-empty", "-m", msg, "-m", f"Claude-Session: {stale}"],
                       capture_output=True, text=True, check=True)
    open(os.path.join(repo, ".git", "promote-inline-hold"), "w").close()   # /promote step 7's on-disk hold
    full = {wrapped: f"{wrapped}-0000-4000-8000-000000000001", stale: f"{stale}-0000-4000-8000-000000000002",
            exited: f"{exited}-0000-4000-8000-000000000004"}
    rec = json.dumps({"type": "user", "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                      "message": {"role": "user", "content": "self-test fixture message"}}) + "\n"
    for sid in (wrapped, stale):
        with open(os.path.join(sessions, f"{full[sid]}.jsonl"), "w") as fh:
            fh.write(rec)
    # The wrapped seat's newest user record is a pasted FRAGMENT and its newest typed directive
    # sits behind > 256 KB of assistant output: the subject must escalate past the first tail
    # budget and name the directive, as a whole-file scan would.
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    def urec(text):
        return json.dumps({"type": "user", "timestamp": ts, "message": {"role": "user", "content": text}}) + "\n"
    filler = json.dumps({"type": "assistant", "timestamp": ts,
                         "message": {"content": [{"type": "text", "text": "x" * 1000}]}}) + "\n"
    with open(os.path.join(sessions, f"{full[wrapped]}.jsonl"), "w") as fh:
        fh.write(urec("the older typed directive of the wrapped seat") + filler * 300
                 + urec("> a quoted fragment the owner pasted back"))
    # an EXITED seat: last record 15 min ago, a real SessionEnd marker 1 min ago -> the SSOT says EXITED
    old = datetime.fromtimestamp(now - 900, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    tex = os.path.join(sessions, f"{full[exited]}.jsonl")
    with open(tex, "w") as fh:
        fh.write(json.dumps({"type": "user", "timestamp": old, "message": {"role": "user", "content": "exited fixture"}}) + "\n")
    os.utime(tex, (now - 900, now - 900))
    with open(os.path.join(state, f"session-finished-{exited}"), "w") as fh:
        fh.write(f"{int(now) - 60} sessionend\n")
    # a wrapped seat whose plan AND transcript are fresh -> must render `wrapped`, never `behind`
    with open(os.path.join(state, f"session-wrapped-{wrapped}"), "w") as fh:
        fh.write(f"{'0' * 40} {int(now) - 120} wrap\n")
    with open(os.path.join(plans, f"session-{wrapped}-2026-10-15.md"), "w") as fh:
        fh.write("# plan\n\n## Arc\n\nx\n\n## Live items\n\n| a | b |\n\n## Closability\n\nready: no\n")
    # a live seat whose plan is 25 min older than its transcript -> must render `plan behind by 25 min`
    pstale = os.path.join(plans, f"session-{stale}-2026-10-15.md")
    with open(pstale, "w") as fh:
        fh.write("# plan\n\n## Arc\n\nx\n\n## Live items\n\n| a | b |\n\n## PRE-COMPACT — 2026-10-15T00:00Z\n\ny\n\n## Closability\n\nready: no\n")
    lag = 0 if break_seed else 25 * 60
    os.utime(pstale, (now - lag, now - lag))
    agents = os.path.join(tmp, "agents.json")
    with open(agents, "w") as fh:
        json.dump([{"cwd": repo, "kind": "cli", "name": "wrapped-fixture", "pid": 1, "sessionId": full[wrapped],
                    "startedAt": int((now - 3600) * 1000), "status": "idle"},
                   {"cwd": os.path.join(repo, "sub"), "kind": "cli", "name": "stale-plan-fixture", "pid": 2, "sessionId": full[stale],
                    "startedAt": int((now - 600) * 1000), "status": "busy"},
                   {"cwd": repo, "kind": "cli", "name": "exited-fixture", "pid": 4, "sessionId": full[exited],
                    "startedAt": int((now - 1200) * 1000), "status": "idle"},
                   {"cwd": "/elsewhere", "kind": "cli", "name": "other-repo", "pid": 3, "sessionId": "cccc3333-0",
                    "startedAt": 0, "status": "busy"}], fh)
    todo = os.path.join(tmp, "todo.txt")
    with open(todo, "w") as fh:
        fh.write("- [ ] FIXTURE-ROW — owner-pending: taste call. filed: 2026-10-15 by bbbb2222 | owner: bbbb2222\n"
                 "- [ ] FIXTURE-ROW-2 — needs-owner-ruling. filed: 2026-10-15 by aaaa1111\n"
                 # the alias spelled AS the owner field: 28 of 77 live alias rows with a filer
                 "- [ ] FIXTURE-ROW-3 — owner-pending: spend. filed: 2026-10-15 by aaaa1111\n  owner: owner\n"
                 # a PEER named owner takes the row away from its filer
                 "- [ ] FIXTURE-ROW-4 — OWNER-DECISION. filed: 2026-10-15 by aaaa1111\n  owner: bbbb2222\n"
                 # the widened spellings: `The owner` (needs both `the` and re.I), `**OWNER-DEFERRED` (re.I),
                 # and a peer field with trailing punctuation (`bbbb2222.` still names that seat)
                 "- [ ] FIXTURE-ROW-5 — parked. filed: 2026-10-15 by aaaa1111\n  owner: The owner\n"
                 "- [ ] FIXTURE-ROW-6 — ⏸ **OWNER-DEFERRED 2026-10-15 — \"later\". filed: 2026-10-15 by bbbb2222\n"
                 "- [ ] FIXTURE-ROW-7 — owner-pending: spend. filed: 2026-10-15 by aaaa1111\n  owner: bbbb2222.\n"
                 "- [x] FIXTURE-CLOSED — owner-pending: closed, must not count. filed: 2026-10-15 by bbbb2222\n")
    def bcast(sender, ts, subj, sig=None, created="2026-01-01T00:00:00Z", body=""):
        name = f"all__{int(ts * 1e9)}__{sender}.md"
        with open(os.path.join(mail, name), "w") as fh:
            fh.write(f"---\nfrom: {sender}\nto: all\nsubject: {subj}\n" + (f"signal: {sig}\n" if sig else "")
                     + f"created: {created}\n---\n{body}\n")
        open(os.path.join(mail, name + ".read-by-eeee5555"), "w").close()   # the EMPTY broadcast receipt
    # a GO-QUIET broadcast whose lapse time (01:00Z on its own created date) is long past -> LAPSED
    bcast("aaaa1111", now - 86400 * 30, "GO-QUIET (aaaa1111): gate running, lapses 01:00Z", "writehold", body="body lapses 01:00Z")
    # two concurrent holds from one sender, then ONLY the dev-push one lifted -> the commit hold stays LIVE
    bcast("bbbb2222", now - 3 * 3600, "HOLD (bbbb2222): no COMMITS to hooks until my all-clear")
    bcast("bbbb2222", now - 2 * 3600, "promote resuming (bbbb2222) — no dev push until my ALL-CLEAR", "writehold-armed")
    bcast("bbbb2222", now - 3600, "promote paused (bbbb2222) — dev-push hold LIFTED, push dev freely", "writehold-lifted")
    # a HOLD then a `HOLD LIFTED` subject (no signal) -> that sender holds nothing
    bcast("ffff6666", now - 7200, "HOLD (ffff6666): no COMMITS to hooks")
    bcast("ffff6666", now - 3600, "HOLD LIFTED (ffff6666): hooks open again")
    # two planes held, then ONE signal-carried ALL-CLEAR -> both lifted (the subject, not the signal, decides)
    bcast("abab1212", now - 3 * 3600, "HOLD (abab1212): no COMMITS to hooks")
    bcast("abab1212", now - 2 * 3600, "promote resuming (abab1212) — no dev push", "writehold-armed")
    bcast("abab1212", now - 3600, "ALL-CLEAR (abab1212): both holds lifted", "writehold-lifted")
    # a live commit hold, then a NEWER push hold already lapsed -> the cell shows the LIVE one, never LAPSED
    bcast("cdcd3434", now - 3 * 3600, "HOLD (cdcd3434): no COMMITS to hooks")
    bcast("cdcd3434", now - 3600, "promote resuming (cdcd3434), lapses 01:00Z", "writehold-armed", body="lapses 01:00Z")
    # a review request bbbb2222 -> aaaa1111 naming a REAL commit, unanswered -> OPEN 1 + one peer loop
    with open(os.path.join(mail, f"aaaa1111__{int((now - 300) * 1e9)}__bbbb2222.md"), "w") as fh:
        fh.write(f"---\nfrom: bbbb2222\nto: aaaa1111\nsubject: --code request: {head[:10]}\nsignal: review-request\n"
                 "created: 2026-10-15T00:00:00Z\n---\nplease review\n")
    # a RETIRING hub: the marker and its companion -> ONE hub, flagged, never a `<sid>.retiring` hub
    for name in (f"review-hub-active-{stale}", f"review-hub-active-{stale}.retiring"):
        open(os.path.join(state, name), "w").close()
    # a plan path that vanished between glob and stat (a dangling link stands in for the race)
    os.symlink(os.path.join(tmp, "nowhere.md"), os.path.join(plans, f"session-{stale}-2026-10-16.md"))
    os.symlink(os.path.join(tmp, "nowhere.md"), os.path.join(plans, f"session-{exited}-2026-10-16.md"))
    os.makedirs(os.path.join(repo, "sub"))
    empty = os.path.join(tmp, "empty.json")
    with open(empty, "w") as fh:
        json.dump([], fh)
    args = parse([
        "--agents-json", agents, "--state-dir", state, "--sessions-dir", sessions, "--plans-dir", plans,
        "--mail-dir", mail, "--todo", todo, "--repo", repo, "--git-max-count", "50",
        "--plan-lag-min", "10", "--json"])
    _glob = glob.glob
    glob.glob = lambda pat: sorted(_glob(pat), reverse=True)   # receipts first: the order that hid 5 of 8 hold mails
    try:
        board = build(args)
    finally:
        glob.glob = _glob
    text = render(board)
    by = {r["sid"]: r for r in board["seats"]}
    # a non-repo as --repo: the last-commit reader must report FAILURE, never `none`
    git_fail = commits([{"sid": stale}], parse(["--sessions-dir", sessions, "--repo", tmp, "--git-max-count", "5"]))
    # ...and the board must carry that failure to every cell: build() over a failing reader
    _commits = commits
    globals()["commits"] = lambda *a: None
    try:
        gboard = build(args)
    finally:
        globals()["commits"] = _commits
    # a LINKED worktree as --repo: its `.git` is a file, so the hold is found only through the common dir
    wt = os.path.join(tmp, "wt")
    subprocess.run(["git", "-C", repo, "worktree", "add", "-q", "--detach", wt], capture_output=True, text=True, check=True)
    pih_wt = promote_inline_hold(parse(["--repo", wt]), now)
    eargs = parse(["--agents-json", empty, "--state-dir", state, "--sessions-dir", sessions, "--plans-dir", plans,
                   "--mail-dir", mail, "--todo", todo, "--repo", repo, "--git-max-count", "0"])
    etable = render(build(eargs), table=True).split("\n")
    try:                                    # the seat whose ONLY plan path vanished: its cell, not the board
        vanished = plan(exited, None, args, now)["text"]
    except Exception as e:
        vanished = f"RAISED {type(e).__name__}"
    # a part file plan-roll wrote, touched after the live plan (a checkout, a restore): still the live plan
    ppart = os.path.join(plans, f"session-{wrapped}-2026-10-15-part2.md")
    with open(ppart, "w") as fh:
        fh.write("# Part 2 of the working plan\n")
    os.utime(ppart, (now + 60, now + 60))
    part_pick = plan(wrapped, None, args, now)
    checks = [
        ("the other-repo seat is filtered out; the seat launched in a SUBDIRECTORY of the repo is kept",
         set(by) == {wrapped, stale, exited}),
        ("a SessionEnd-marked seat renders `exited` through the SSOT",
         by.get(exited, {}).get("lifecycle") == "EXITED" and by[exited]["lifecycle_text"].startswith("exited 1m")),
        ("holds are read past the empty receipts listed first: the GO-QUIET is seen at all",
         by.get(wrapped, {}).get("hold") is not None),
        ("one of two holds lifted: the sender's other hold stays LIVE",
         (by.get(stale, {}).get("hold") or {}).get("lapsed") is False),
        ("a `HOLD LIFTED` subject clears its sender", "ffff6666" not in board["fleet"]["holds"]),
        ("the on-disk promote-inline-hold is read as a hold", "(promote)" in board["fleet"]["holds"]),
        ("...and from a linked worktree, through the git COMMON dir", pih_wt is not None),
        ("an ALL-CLEAR subject lifts both planes even when it carries the push-plane signal",
         "abab1212" not in board["fleet"]["holds"]),
        ("a live hold beside a newer LAPSED one renders LIVE (a lapsed cell must not hide a live hold)",
         (board["fleet"]["holds"].get("cdcd3434") or {}).get("lapsed") is False),
        ("a failed git log reads as failure, not `none`", git_fail is None),
        ("...and reaches every rendered cell as `? (git log failed)`",
         gboard["fleet"]["git_ok"] is False and "? (git log failed)" in render(gboard)),
        ("the DEFAULT commit window is the whole history (400 read 2 of 7 live seats as `none`)",
         parse([]).git_max_count >= 100000),
        ("an empty fleet says why, and its --table header has every column, matching the delimiter",
         any(l.startswith("_No seat in this repo") for l in etable)
         and any(l.count(" | ") == len(COLUMNS) - 1 and l.startswith("| Seat |") for l in etable)
         and ("|" + "---|" * len(COLUMNS)) in etable),
        ("a plan path that vanished between glob and stat costs its cell, never the board", not vanished.startswith("RAISED")),
        ("a part file newer than the live plan is never picked as the seat's plan",
         part_pick.get("file") == f"session-{wrapped}-2026-10-15.md" and part_pick.get("n_files") == 1),
        ("the wrapped seat renders `wrapped`", by.get(wrapped, {}).get("lifecycle") == "WRAPPED" and "wrapped" in by[wrapped]["lifecycle_text"]),
        ("the wrapped seat's fresh plan is not `behind`", by.get(wrapped, {}).get("plan", {}).get("behind_min") is None),
        ("the stale-plan seat renders `plan behind by N min`, N >= 20", (by.get(stale, {}).get("plan", {}).get("behind_min") or 0) >= 20
         and "plan behind by" in by[stale]["plan"]["text"]),
        ("the stale seat's PRE-COMPACT block is its newest dated block", by.get(stale, {}).get("plan", {}).get("last_block") == "PRE-COMPACT"),
        ("owner-pending: the one token counts, the alias counts, the closed row does not", by.get(stale, {}).get("owner_pending") == 4
         and board["fleet"]["owner_pending_total"] == 7),
        ("owner-pending: a row whose owner field IS the alias (`owner: owner`, `owner: The owner`) stays its filer's",
         by.get(wrapped, {}).get("owner_pending") == 3),
        ("owner-pending: `owner: The owner` and `**OWNER-DEFERRED` are read; `owner: bbbb2222.` names that seat",
         board["fleet"]["owner_pending_by_alias"].get("owner: owner") == 2
         and board["fleet"]["owner_pending_by_alias"].get("owner-deferred") == 1
         and by.get(stale, {}).get("owner_pending_by_alias", {}).get("owner-pending:") == 2),
        ("a lapsed GO-QUIET renders LAPSED on its sender", (by.get(wrapped, {}).get("hold") or {}).get("lapsed") is True),
        ("review loops: the unanswered request is OPEN 1 with one peer loop, through review-queue + unfinished-loops",
         (by.get(wrapped, {}).get("review") or {}).get("open") == 1 and (by.get(wrapped, {}).get("review") or {}).get("loops") == 1),
        ("last commit: the trailer leg claims each seat's newest commit, the wrapped seat's from UNDER 3 newer ones",
         ((by.get(wrapped, {}).get("last_commit") or {}).get("leg") == "sid")
         and (by.get(stale, {}).get("last_commit") or {}).get("subject") == "c"),
        ("a retiring hub is ONE hub, flagged — its `.retiring` companion is never a hub of its own",
         [(h["sid"], h["retiring"]) for h in board["fleet"]["hub"]] == [(stale, True)]),
        ("subject: the newest TYPED directive, found past the first tail budget, not the newer pasted fragment",
         by.get(wrapped, {}).get("subject") == "the older typed directive of the wrapped seat"),
        ("the cards carry both seeded seats", f"`{wrapped}`" in text and f"`{stale}`" in text),
        ("the --table form carries both seeded seats too", all(f"`{x}`" in render(board, table=True) for x in (wrapped, stale))),
    ]
    bad = 0
    for name, ok in checks:
        bad += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
    print()
    print(text)
    print()
    print(f"self-test{' (RED control: stale plan seeded FRESH)' if break_seed else ''}: "
          f"{'ALL PASS' if not bad else f'{bad} FAILED'}")
    subprocess.run(["rm", "-rf", tmp])
    return 1 if bad else 0


def parse(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", action="store_true", help="machine output instead of the cards")
    ap.add_argument("--table", action="store_true", help="the 9-column markdown table instead of one card per seat (the default)")
    ap.add_argument("--plan-lag-min", type=int, default=10, help="minutes a plan may trail its transcript before `behind` (default 10)")
    ap.add_argument("--git-max-count", type=int, default=100000,
                    help="newest commits scanned for the last-commit column (0 skips). The whole history is the default: 400 covered ~41 h at 237 commits/day and read 2 of 7 live seats as `none`; it adds ~1 s to a render (two whole-history logs, 0.45 s + 0.26 s)")
    ap.add_argument("--agents-json", help="read the liveness list from this file instead of `claude agents --json`")
    ap.add_argument("--state-dir", default=SM.STATE_DIR)
    ap.add_argument("--sessions-dir", default=SM.SESSIONS_DIR)
    ap.add_argument("--plans-dir", default=os.path.join(SM.REPO_DIR, "plans"))
    ap.add_argument("--mail-dir", default=SM.MAIL_DIR)
    ap.add_argument("--todo", default=os.path.join(SM.REPO_DIR, "todo.txt"))
    ap.add_argument("--repo", default=SM.REPO_DIR, help="the cwd the CLI's list is filtered on")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--break-seed", action="store_true", help="with --self-test: the RED control (must exit non-zero)")
    return ap.parse_args(argv)


def main(argv):
    args = parse(argv)
    if args.self_test:
        return self_test(args.break_seed)
    board = build(args)
    if args.json:
        print(json.dumps(board, indent=1, ensure_ascii=False))
    else:
        print(render(board, table=args.table))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
