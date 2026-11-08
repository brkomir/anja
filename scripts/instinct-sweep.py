#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
instinct-sweep.py — the instrument behind /instinct-sweep v2.

Contract: .claude/skills/instinct-sweep/SKILL.md (v2.1.1). This script does the spec's SCRIPT steps; the
judgment steps (3 prose clusters, 4 verification, 6 the cap) stay with the model that reads its draft.

  0  coverage table and two controls, printed before anything else; exit 2 if either control fails
  1  the owner ledger, .claude/state/instinct-owner-ledger.jsonl (gitignored): one row per owner act,
     keyed by record uuid (a resumed session copies records under its own id; the copy is dropped)
  2  exact counts: command pairs and triples within one session and 30 minutes (built-ins included),
     flags and arguments he types on most runs of a command, free text he appends to a command, exact
     repeats of HIS PART, and re-explanation requests (/summary /eli5 /explain whose argument is quoted
     text, counted as a defect of the system's readout, never as his habit); the weekly trend with the
     spec's action rule
  5  the codified-corpus search for every candidate, with a known-codified control and a file count per
     area (exit 3 when the control misses or a required area is empty), and the ledger.md "no" rule

His acts are read only through the shared classifier (classify_record, quote_rulings, unsplit_quote and
the constants QUOTE_OPEN, MACHINE_TURN_ORIGINS, POP_NAMES, POP_ORDER in
scripts/post-compact-recovery-index.py, the module scripts/owner-words.py uses), imported, never copied.
The self-test plants one record of every population it reads (a e d f g i) and a mutation renames each
key it reads from classify_record's entries, so a change to that return shape turns this self-test red;
a unit-tier test runs it. Top-level transcripts only, never */subagents/**;
streamed line by line, never loaded whole.

HIS PART / QUOTED / PASTED. "<my text>" - his answer is split by quote_rulings and the quoted half is
QUOTED. A message that opens with a quote and has no clean split is UNSPLIT, and all of it is QUOTED.
Lines opening with ">", <pasted_content> blocks and the side-agent note header are PASTED. Only HIS PART
is counted as his words; an act counts as a turn whatever its words.

Acts: typed (populations a b b2 c), command (d e, built-ins included), answer (f), refusal (g) and
interrupt (i: "[Request interrupted by user...]", a harness record with no promptSource). Turns are
typed + command + answer + refusal; interrupts are counted beside them.

USAGE
  python3 scripts/instinct-sweep.py run [--since YYYY-MM-DD] [--workers N]
  python3 scripts/instinct-sweep.py maintain                 # /meta maintain member 11
  python3 scripts/instinct-sweep.py --self-test              # planted fixtures, then a mutation table

Writes only .claude/state/instinct-owner-ledger.jsonl, .claude/state/instinct-sweep-candidates-<date>.json
and (run) plans/instinct-sweep/<date>-draft.md; the two state files are mode 600 (they hold his text).
Never a .claude/logs/ file. Exit: 0 ok, 1 usage or no transcript directory (an argparse error too, never
its own 2), 2 a control failed, 3 corpus search void, 4 the secret gate refused the draft.

plans/instinct-sweep/ledger.md is written by the judgment step after his answer; this script only reads
its table rows:  | key | proposed | sessions | status | answered | his words | report |
key is a candidate key printed here; status is pending, yes or no. A "no" key is held back until its
distinct sessions reach twice the recorded count; pending and yes keys are held back as already proposed.
"""
import argparse
import bisect
import collections
import contextlib
import datetime
import glob
import hashlib
import importlib.util
import io
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)


def _load_index():
    """The shared classifier. Its top level is defs and constants; its main() sits behind __main__."""
    spec = importlib.util.spec_from_file_location(
        "pc_index", os.path.join(HERE, "post-compact-recovery-index.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


IDX = _load_index()

POP_KIND = {"a": "typed", "b": "typed", "b2": "typed", "c": "typed", "d": "command", "e": "command",
            "f": "answer", "g": "refusal", "i": "interrupt"}
TURN_KINDS = ("typed", "command", "answer", "refusal")
REEXPLAIN = ("summary", "eli5", "explain")
SESSION_BAR = 3            # distinct sessions a candidate needs (spec step 4)
DAY_BAR = 2                # distinct calendar days, UTC
PAIR_WINDOW_S = 30 * 60    # a pair or triple lies within one session and 30 minutes
HABIT_SHARE = 0.5          # "on most runs of a command"
REPORT_MAX_AGE_DAYS = 30   # /meta maintain re-runs the steps when the newest report is older
MAINTAIN_PENDING_CAP = 3   # pending proposals /meta maintain puts in its approval table (spec)
EXCLUDE_ALWAYS = ("70000000",)   # the panel session that redefined this command (a placeholder id)
CONTROL_I46 = ("10000000", "2026-10-14T15:11:23", "usage patterns")   # his record that first asked for
                                                                      # this command (a placeholder id)
CORPUS_CONTROL = ("skills", ("/pre-compact", "--disarm"))             # codified in pre-compact, pause
TEXT_CAP = 4000            # per ledger text field; the full byte length is recorded beside it
QUOTE_CAP = 200            # characters of any one owner record in the draft (spec)
SHOW_PER_KIND = 12
SIDE_NOTE_HEAD = "Here is a note offered by a side agent:"
PASTED_LINE = re.compile(r"^[ \t]*>.*$", re.M)
PASTED_BLOCK = re.compile(r"<pasted_content\b.*?(?:</pasted_content>|\Z)", re.S)
FLAG_TOKEN = re.compile(r"^--?[A-Za-z][\w-]*$")
# Credential shapes (the spec's list; his messages can carry such strings). Applied at the SOURCE: an owner
# record whose text matches is never quoted and its text never enters the ledger; it is counted and cited by
# uuid. The rendered draft and candidates file are scanned again before writing (the second net).
# Prefix shapes only at a token start, so "task-" or "pre_" never trips it; an escape that ends in a letter
# or digit (a JSON-escaped \n, \t, \r, \b or \f, a \xNN or \uNNNN, a URL-encoded %NN, in pasted log or API
# text) also starts a token. The vendor list follows .githooks/pre-push's push scan. A connection string
# matches from user:pass on, with or without its @ and in any case, so a truncated one still trips it, as
# does a password in its query string, or with a password that starts with a slash. Each vendor key also
# matches anywhere at its full
# length, since the scan holds six of them with no boundary and a key can follow any text: a colour code, a
# double-encoded escape, a word it was pasted onto.
# One entry per shape, so the self-test can drop each one alone and see its planted value leak.
_ESC = r"(?<=\\[ntr])|(?<=\\[bf])|(?<=%[0-9A-Fa-f]{2})|(?<=\\x[0-9a-fA-F]{2})|(?<=\\u[0-9a-fA-F]{4})"
_SB = r"(?:(?<![A-Za-z0-9])|" + _ESC + ")"
_SBU = r"(?:(?<![A-Za-z0-9_])|" + _ESC + ")"
_DB = r"(?i:(?:postgres(?:ql)?|mysql|mongodb|rediss?)(?:\+\w+)?)://"
SECRET_SHAPES = (r"eyJ", _SB + r"sk-", r"sb_secret_", _SB + r"pdl_", _SBU + r"re_[A-Za-z0-9]",
                 _DB + r"[^\s/@]*:[^\s@]", r"X-Amz-",
                 r"-----BEGIN [A-Z ]*PRIVATE KEY", _SBU + r"sbp_[a-f0-9]", _SBU + r"gh[pousr]_[A-Za-z0-9]",
                 r"github_pat_", _SB + r"AKIA[0-9A-Z]{8}", r"sntrys_", _SBU + r"phx_[A-Za-z0-9]", r"whsec_",
                 r"(?i:pgpassword)\s*[=:]", _DB + r"\S{0,2048}?[?&](?i:password)=", r"discord(?:app)?\.com/api/webhooks/[0-9]",
                 r"sk-ant-[a-zA-Z0-9_-]{40,}", r"sk-proj-[a-zA-Z0-9_-]{20,}", r"sk-(?:svcacct|admin)-[a-zA-Z0-9_-]{20,}",
                 r"sk-[a-zA-Z0-9]{40,}", r"AKIA[A-Z0-9]{16}", r"gh[pousr]_[a-zA-Z0-9]{36,}",
                 r"pdl_(?:live|sdbx)_apikey_[a-zA-Z0-9]{20,}", r"pdl_ntfset_[a-zA-Z0-9]{20,}",
                 r"re_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}", r"sbp_[a-f0-9]{40}", r"phx_[A-Za-z0-9]{30,}")
SECRET_SHAPE = re.compile("|".join(SECRET_SHAPES))
# Shape firsts that mark a LOGGING change (a field or record kind the harness began writing), never a
# behaviour of his: the first answered question or refusal is his act, not a logging change.
LOGGING_FIRSTS = ("pop b", "pop b2", "pop c", "pop d", "promptSource field", "turnOrigin field",
                  "interruptedMessageId field", "side-agent note")
# A metric that counts a command cannot move before the command exists: when one of these was created
# inside a run's baseline-to-end weeks, the run is an era change, not a movement.
ERA_COMMANDS = {"reexpl_100": REEXPLAIN, "recovered_pct": ("post-compact",)}
SEARCH_PER_KIND = 150      # candidates searched in the corpus per kind, ranked by distinct sessions
SHORT_REPEAT = 20          # characters: a shorter exact repeat is listed on one line, not tabled
CORPUS_AREAS = (
    ("skills", (".claude/skills/*/SKILL.md", ".claude/skills/*/references/*.md", ".claude/commands/*.md",
                ".claude/orchestrator/conventions.md")),
    ("ideas", ("IDEAS.md",)),
    ("backlog", ("BACKLOG.md",)),
    ("todo", ("todo*.txt",)),
    ("decisions", ("DECISIONS*.md",)),
    ("memory", (".claude/project-memory/*.md",)),
    ("corrections", (".claude/meta-corrections-registry.md",)),
    ("meta", (".claude/skills/meta/**/*",)),
    ("ledger", ("plans/instinct-sweep/ledger.md",)),
)
OPTIONAL_AREAS = ("ledger",)
# This command's own spec names candidates as EXAMPLES (/model, /effort, /pre-compact --disarm), which
# would read as codification; it is left out of the corpus and the draft says so.
CORPUS_SKIP = os.path.join(".claude", "skills", "instinct-sweep") + os.sep


def paths(repo=REPO, projects=None, git=True):
    return {"repo": repo, "git": git,
            "projects": projects or os.path.expanduser(
                "~/.claude/projects/" + re.sub(r"[^A-Za-z0-9]", "-", repo)),
            "skill_log": os.path.join(repo, ".claude", "logs", "skill-invocations.jsonl"),
            "dispatch_log": os.path.join(repo, ".claude", "logs", "subagent-dispatch.jsonl"),
            "state": os.path.join(repo, ".claude", "state"),
            "out": os.path.join(repo, "plans", "instinct-sweep")}


# ── small helpers ───────────────────────────────────────────────────────────────────────────────────
def ts_dt(ts):
    try:
        return datetime.datetime.strptime((ts or "")[:19], "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        return None


def secs(t1, t2):
    a, b = ts_dt(t1), ts_dt(t2)
    return (b - a).total_seconds() if a and b else float("inf")


def week_of(ts):
    y, w, _ = datetime.date(int(ts[:4]), int(ts[5:7]), int(ts[8:10])).isocalendar()
    return "%04d-W%02d" % (y, w)


def week_monday(wk):
    return datetime.datetime.strptime(wk + "-1", "%G-W%V-%u").date()


def blen(s):
    return len((s or "").encode("utf-8", "replace"))


def norm(s):
    return " ".join((s or "").lower().split()).strip(" .,;:!?\"'`\u201c\u201d\u2018\u2019()[]")


def short_hash(s):
    return hashlib.sha1(s.encode("utf-8", "replace")).hexdigest()[:10]


def fn_ref(fn):
    return "%s (scripts/instinct-sweep.py:%d)" % (fn.__name__, fn.__code__.co_firstlineno)


def clip(s):
    """Owner text bound for the draft or the candidates file: one line, at most QUOTE_CAP characters.
    Secret-shaped records never get here (secret_shaped, at the source); secret_gate re-scans the output."""
    s = " ".join((s or "").split())
    return s if len(s) <= QUOTE_CAP else s[:QUOTE_CAP - 1] + "\u2026"


def secret_shaped(text):
    """The source filter: does an owner record's text carry a credential shape?"""
    return bool(SECRET_SHAPE.search(text or ""))


def secret_gate(text):
    """The second net, over a whole rendered output: True means refuse to write it."""
    return bool(SECRET_SHAPE.search(text or ""))


def read_jsonl(path):
    """(rows, bad lines, total lines, exists). A bad line is counted, never fatal."""
    rows, bad, total = [], 0, 0
    if not os.path.isfile(path):
        return rows, 0, 0, False
    with open(path, "rb") as fh:
        for raw in fh:
            total += 1
            try:
                r = json.loads(raw.decode("utf-8", "replace"))
            except ValueError:
                bad += 1
                continue
            if isinstance(r, dict):
                rows.append(r)
            else:
                bad += 1
    return rows, bad, total, True


# ── step 1: extract ─────────────────────────────────────────────────────────────────────────────────
def keep_record(r):
    """A sidechain record is an agent's, never his, whatever its promptSource says."""
    return r.get("isSidechain") is not True


def split_text(text, rulings, unsplit):
    """(HIS PART, QUOTED, PASTED, split) for one message or one command argument."""
    text = text or ""
    if rulings:
        quoted, his, split = "\n".join(q for q, _ in rulings), "\n".join(a for _, a in rulings), "clean"
    elif unsplit:
        return "", text, "", "unsplit"
    else:
        quoted, his, split = "", text, "none"
    pasted = []
    if his.startswith(SIDE_NOTE_HEAD):
        pasted.append(SIDE_NOTE_HEAD)
        his = his[len(SIDE_NOTE_HEAD):]
    pasted += PASTED_BLOCK.findall(his)
    his = PASTED_BLOCK.sub("", his)
    pasted += PASTED_LINE.findall(his)
    his = PASTED_LINE.sub("", his)
    return his.strip(), quoted, "\n".join(pasted), split


def interrupt_text(r):
    """The harness's own record of an interrupt he made: a user record with no promptSource."""
    if r.get("type") != "user" or r.get("isMeta") or r.get("promptSource") is not None:
        return None
    c = (r.get("message") or {}).get("content")
    if isinstance(c, list):
        c = " ".join(b.get("text") or "" for b in c if isinstance(b, dict) and b.get("type") == "text")
    t = (c if isinstance(c, str) else "").strip()
    return t if t.startswith("[Request interrupted by user") else None


def make_act(e, r, n, stem):
    pop = e["pop"]
    a = {"uuid": r.get("uuid") or "%s#%d" % (stem, n), "sid": stem,
         "ts": (r.get("timestamp") or "")[:19], "line": n, "pop": pop, "kind": POP_KIND[pop]}
    if a["kind"] == "command":
        raw = (e.get("text") if pop == "e" else e.get("args")) or ""
        rul = e.get("rulings") if pop == "e" else IDX.quote_rulings(raw)
        his, quoted, pasted, split = split_text(raw, rul, IDX.unsplit_quote(e) if pop == "e" else False)
        a["cmd"] = (e.get("command") or "").strip().lstrip("/") or "?"
        a["quoted_arg"] = bool(raw.strip()) and (bool(IDX.QUOTE_OPEN.match(raw))
                                                 or raw.lstrip().startswith(">"))
        words = his.split()
        a["flags"] = sorted({w.split("=", 1)[0] for w in words if FLAG_TOKEN.match(w.split("=", 1)[0])})
        rest = [w for w in words if not FLAG_TOKEN.match(w.split("=", 1)[0])]
        if 0 < len(rest) <= 2:
            a["argval"] = norm(" ".join(rest))
        elif len(rest) >= 3:
            a["free"] = norm(" ".join(rest))
    elif a["kind"] == "typed":
        text = e.get("text") or ""
        his, quoted, pasted, split = split_text(text, e.get("rulings"), IDX.unsplit_quote(e))
        a["side_note"] = text.startswith(SIDE_NOTE_HEAD)
    elif a["kind"] == "answer":
        free, choices = [], []
        for ans in e.get("answers") or []:
            if ans.get("kind") == "FREE TEXT":
                free.append(str(ans.get("value") or ""))
            elif ans.get("kind") == "CHOICE":
                choices += [str(x) for x in ans.get("value") or []]
                free += [str(x) for x in ans.get("free_text") or []]
        his, quoted, pasted, split = "\n".join(free), "", "", "none"
        a["choices"] = choices
    elif a["kind"] == "refusal":
        his, quoted, pasted, split = e.get("user_said") or "", "", "", "none"
    else:
        his, quoted, pasted, split = "", "", "", "none"
        a["for_tool_use"] = "for tool use" in (e.get("text") or "")
    k = norm(his)
    sizes = (blen(his), blen(quoted), blen(pasted))
    if secret_shaped("\n".join([his, quoted, pasted, a.get("cmd", "")] + a.get("choices", []))):
        # Never quoted and never copied into the ledger: counted, cited by uuid, and still a turn. An exact
        # repeat of it is keyed by a hash of its text, so it can be counted without being shown.
        a["secret"] = True
        for field in ("argval", "free"):
            a.pop(field, None)
        a["flags"] = []                                  # a token-shaped flag is the value itself
        if secret_shaped(a.get("cmd", "")):              # and so is a key sent as a command name
            a["cmd"] = "?"
        if "choices" in a:
            a["choices"] = []
        his = quoted = pasted = ""
        k = "#secret:" + short_hash(k) if k else ""
    elif len(k) > 600:
        k = k[:600] + "#" + short_hash(k)
    if k:
        a["nkey"] = k
    a.update(his=his[:TEXT_CAP], quoted=quoted[:TEXT_CAP], pasted=pasted[:TEXT_CAP], split=split,
             his_b=sizes[0], quoted_b=sizes[1], pasted_b=sizes[2])
    return a


def scan_file(path):
    """One streaming pass over one top-level transcript. A byte prefilter picks the lines worth parsing
    (the panel's shape: all 359 transcripts in ~10 s on 4 workers); a line is never joined to another."""
    stem = os.path.basename(path)[:-len(".jsonl")]
    res = {"stem": stem, "bytes": 0, "lines": 0, "parsed": 0, "parse_fail": 0, "first_ts": "",
           "last_ts": "", "acts": [], "compactions": [], "skill_runs": [], "auto_hooks": [],
           "deleg": collections.Counter(), "census": collections.Counter(), "firsts": {}}
    census, firsts, ask_ids = res["census"], res["firsts"], {}

    def first(key, ts):
        if ts and (key not in firsts or ts < firsts[key]):
            firsts[key] = ts

    with open(path, "rb") as fh:
        for n, raw in enumerate(fh, 1):
            res["lines"] += 1
            res["bytes"] += len(raw)
            if b'"type":"assistant"' in raw:
                if not (b"AskUserQuestion" in raw or b'"name":"Skill"' in raw
                        or b'"name":"Agent"' in raw or b'"name":"Task"' in raw):
                    continue
            elif b'"type":"user"' in raw:
                if b'"tool_use_id"' in raw and b"toolDenialKind" not in raw and b'"answers"' not in raw:
                    continue
            elif not (b'"queued_command"' in raw or b'"local_command"' in raw
                      or b'"compact_boundary"' in raw or b"AUTO PRE-COMPACT" in raw):
                continue
            try:
                r = json.loads(raw.decode("utf-8", "replace"))
            except ValueError:
                res["parse_fail"] += 1
                continue
            if not isinstance(r, dict):
                continue
            res["parsed"] += 1
            ts = (r.get("timestamp") or "")[:19]
            if ts:
                res["first_ts"] = min(res["first_ts"] or ts, ts)
                res["last_ts"] = max(res["last_ts"], ts)
            t = r.get("type")
            if t == "assistant":
                if r.get("isSidechain") is True:
                    continue
                for b in (r.get("message") or {}).get("content") or []:
                    if not (isinstance(b, dict) and b.get("type") == "tool_use"):
                        continue
                    if b.get("name") == "AskUserQuestion" and b.get("id"):
                        ask_ids[b["id"]] = n
                    elif b.get("name") == "Skill":
                        res["skill_runs"].append((n, ts, str((b.get("input") or {}).get("skill") or "")))
                    elif b.get("name") in ("Agent", "Task") and ts:
                        res["deleg"][week_of(ts)] += 1
                continue
            if t == "system" and r.get("subtype") == "compact_boundary":
                res["compactions"].append((n, ts, str((r.get("compactMetadata") or {}).get("trigger"))))
                continue
            if t == "attachment":
                att = r.get("attachment") or {}
                if att.get("type") == "hook_additional_context" and \
                        any("AUTO PRE-COMPACT" in str(x) for x in att.get("content") or []):
                    res["auto_hooks"].append((n, ts))
                    continue
            if r.get("isCompactSummary") is True:
                continue
            if r.get("isSidechain") is True:
                census["sidechain records seen (never his)"] += 1
            if not keep_record(r):
                continue
            entries = IDX.classify_record(r, ask_ids, {})
            if not entries:
                it = interrupt_text(r)
                entries = [{"pop": "i", "text": it}] if it else []
            for e in entries:
                if e["pop"] not in POP_KIND:
                    census["classifier entries not his: " + e["pop"]] += 1
                    continue
                if e["pop"] in ("a", "b", "b2") and r.get("turnOrigin") in IDX.MACHINE_TURN_ORIGINS:
                    census["typed records with a machine turnOrigin"] += 1
                    continue                     # a machine wrote it: counted, never his (spec § Must never)
                first("pop " + e["pop"], ts)
                if t == "user":
                    for field in ("promptSource", "turnOrigin", "interruptedMessageId"):
                        if field in r:
                            first(field + " field", ts)
                v = str(r.get("version") or "")
                if v:
                    first("harness " + ".".join(v.split(".")[:2]), ts)
                res["acts"].append(make_act(e, r, n, stem))
                if res["acts"][-1].get("side_note"):
                    first("side-agent note", ts)
    return res


def gather(P, workers):
    if not os.path.isdir(P["projects"]):
        raise SystemExit("instinct-sweep: no transcript directory at %s" % P["projects"])
    files = [os.path.join(P["projects"], f) for f in os.listdir(P["projects"]) if f.endswith(".jsonl")]
    files.sort(key=lambda p: -os.path.getsize(p))           # the largest first, for the pool's balance
    if workers > 1:
        import multiprocessing
        with multiprocessing.Pool(workers) as pool:
            results = pool.map(scan_file, files, chunksize=1)
    else:
        results = [scan_file(f) for f in files]
    sub = len(glob.glob(os.path.join(P["projects"], "*", "subagents", "*.jsonl")))
    return sorted(results, key=lambda x: x["stem"]), sub


def dedupe(results):
    """Keep each record uuid once. A resumed session copies earlier records under its own session id; the
    copy kept is the one in the session that started first (ties: the lower session id)."""
    seen, dropped = set(), 0
    for res in sorted(results, key=lambda x: (x["first_ts"] or "9999", x["stem"])):
        kept = []
        for a in res["acts"]:
            if a["uuid"] in seen:
                dropped += 1
                continue
            seen.add(a["uuid"])
            kept.append(a)
        res["acts"] = kept
    return dropped


def fold_interrupts(res):
    """An interrupt 'for tool use' right after his refusal of that tool is one act, not two."""
    out, folded = [], 0
    for a in res["acts"]:
        if a["pop"] == "i" and a.get("for_tool_use") and out and out[-1]["pop"] == "g" \
                and abs(secs(out[-1]["ts"], a["ts"])) <= 5:
            folded += 1
            continue
        out.append(a)
    res["acts"] = out
    return folded


def excluded_sids(P, own_sid=None):
    """EXCLUDE_ALWAYS, every session the skill log shows running /instinct-sweep, and (run) this session."""
    ex = set(EXCLUDE_ALWAYS)
    if own_sid:
        ex.add(own_sid[:8])
    for row in read_jsonl(P["skill_log"])[0]:
        if row.get("skill") == "instinct-sweep" and str(row.get("session") or "") not in ("", "unknown"):
            ex.add(str(row["session"])[:8])
    return ex


def write_ledger(P, acts):
    os.makedirs(P["state"], exist_ok=True)
    dest = os.path.join(P["state"], "instinct-owner-ledger.jsonl")
    fd, tmp = tempfile.mkstemp(dir=P["state"], prefix=".instinct-ledger.")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        for a in sorted(acts, key=lambda x: (x["ts"], x["sid"], x["line"])):
            fh.write(json.dumps(a, ensure_ascii=False) + "\n")
    os.replace(tmp, dest)
    return dest


# ── step 0: controls ────────────────────────────────────────────────────────────────────────────────
def control_i46(acts):
    sid8, ts, phrase = CONTROL_I46
    hits = [a for a in acts if a["sid"].startswith(sid8) and a["ts"].startswith(ts)
            and phrase in (a["his"] or "").lower()]
    return {"name": "C1 his record that first asked for this command found", "ok": bool(hits),
            "detail": ("session %s, %sZ, population %s, uuid %s" % (sid8, ts, hits[0]["pop"], hits[0]["uuid"])
                       if hits else "NOT FOUND: session %s at %sZ with '%s' in HIS PART" % (sid8, ts, phrase))}


def control_auto(results, acts):
    """A hook-directed AUTO /pre-compact (the AUTO PRE-COMPACT hook line, then the seat's own Skill call)
    must leave no /pre-compact act of his. Void, so failed, when no AUTO run is found or when no
    /pre-compact of his is seen anywhere (then the instrument could not have seen a leak)."""
    mine = collections.defaultdict(list)
    for a in acts:
        if a["kind"] == "command" and a.get("cmd") == "pre-compact":
            mine[a["sid"]].append(a)
    runs, leaks = 0, []
    for res in results:
        for n, ts, skill in res["skill_runs"]:
            if skill != "pre-compact":
                continue
            prior = [h for h in res["auto_hooks"] if h[0] < n and 0 <= secs(h[1], ts) <= 600]
            if not prior:
                continue
            runs += 1
            leaks += [a["uuid"] for a in mine[res["stem"]] if prior[-1][0] <= a["line"] <= n + 5
                      and secs(prior[-1][1], a["ts"]) >= 0 and secs(ts, a["ts"]) <= 60]
    his = sum(len(v) for v in mine.values())
    ok = runs > 0 and not leaks and his > 0
    return {"name": "C2 a hook-directed AUTO /pre-compact is not his", "ok": ok,
            "detail": "%d AUTO runs found, %d leaked into his acts%s; his own /pre-compact acts: %d" % (
                runs, len(leaks), (" (" + ", ".join(leaks[:3]) + ")") if leaks else "", his)}


# ── step 2: exact counts ────────────────────────────────────────────────────────────────────────────
def by_session(acts):
    out = collections.defaultdict(list)
    for a in acts:
        out[a["sid"]].append(a)
    for v in out.values():
        v.sort(key=lambda a: a["line"])
    return out


def passes(members):
    return len({m["sid"] for m in members}) >= SESSION_BAR and \
        len({m["ts"][:10] for m in members}) >= DAY_BAR


def count_sequences(sessions):
    pairs, triples = collections.defaultdict(list), collections.defaultdict(list)
    for acts in sessions.values():
        cmds = [a for a in acts if a["kind"] == "command"]
        for i in range(len(cmds) - 1):
            if abs(secs(cmds[i]["ts"], cmds[i + 1]["ts"])) <= PAIR_WINDOW_S:
                pairs[(cmds[i]["cmd"], cmds[i + 1]["cmd"])].append(cmds[i])
            if i + 2 < len(cmds) and abs(secs(cmds[i]["ts"], cmds[i + 2]["ts"])) <= PAIR_WINDOW_S:
                triples[(cmds[i]["cmd"], cmds[i + 1]["cmd"], cmds[i + 2]["cmd"])].append(cmds[i])
    return pairs, triples


def count_habits(sessions):
    runs = collections.defaultdict(list)
    flags, argv, free = (collections.defaultdict(list) for _ in range(3))
    for acts in sessions.values():
        for a in acts:
            if a["kind"] != "command":
                continue
            runs[a["cmd"]].append(a)
            for f in a.get("flags") or []:
                flags[(a["cmd"], f)].append(a)
            if a.get("argval"):
                argv[(a["cmd"], a["argval"])].append(a)
            if a.get("free"):
                free[(a["cmd"], a["free"])].append(a)
    return runs, flags, argv, free


def count_repeats(sessions):
    rep = collections.defaultdict(list)
    for acts in sessions.values():
        for a in acts:
            if a["kind"] in ("typed", "answer", "refusal") and a.get("nkey"):
                rep[a["nkey"]].append(a)
    return rep


def count_reexplain(sessions):
    """/summary /eli5 /explain whose argument opens with a quote or a > line: the assistant's own text
    handed back, so a defect of the readout that preceded it. Grouped by his act before it."""
    req, after, plain = collections.defaultdict(list), collections.defaultdict(collections.Counter), \
        collections.Counter()
    for acts in sessions.values():
        prev = None
        for a in acts:
            if a["kind"] == "command" and a["cmd"] in REEXPLAIN:
                if a.get("quoted_arg"):
                    req[a["cmd"]].append(a)
                    after[a["cmd"]]["/" + prev["cmd"] if prev and prev["kind"] == "command"
                                    else ("(a %s turn)" % prev["kind"]) if prev else "(none)"] += 1
                else:
                    plain[a["cmd"]] += 1
                continue                 # a chain of re-explanations keeps the readout that started it
            if a["kind"] in TURN_KINDS:
                prev = a
    return req, after, plain


def make_cand(key, kind, label, members, fn, since, detail=None, quote_of=None):
    sess, days = {m["sid"] for m in members}, sorted({m["ts"][:10] for m in members})
    uu, seen, quotes = [], set(), []
    for m in members:
        if m["sid"] in seen:
            continue
        seen.add(m["sid"])
        if len(uu) < 3:
            uu.append(m["uuid"])
        q = quote_of(m) if quote_of and not m.get("secret") else ""
        if q and len(quotes) < 3:
            quotes.append(q)
    recent = [m for m in members if since and m["ts"] >= since]
    return {"key": key, "kind": kind, "label": label, "occurrences": len(members), "sessions": len(sess),
            "days": len(days), "first": days[0], "last": days[-1], "uuids": uu,
            "since_occurrences": len(recent), "since_sessions": len({m["sid"] for m in recent}),
            "counted_by": fn_ref(fn), "detail": detail or {}, "quotes": quotes}


def build_candidates(live, inventory, since):
    sessions = by_session(live)
    out = []

    def builtin_note(names):
        b = ["/" + x for x in names if x not in inventory]
        return ("not in the skill/command inventory (built-in or retired): " + ", ".join(b)) if b else ""

    pairs, triples = count_sequences(sessions)
    for grams, kind in ((pairs, "seq2"), (triples, "seq3")):
        for k, m in grams.items():
            if not passes(m):
                continue
            notes = [x for x in (builtin_note(k), "a re-explanation command follows: read as a possible "
                                 "defect of the readout before it" if any(x in REEXPLAIN for x in k[1:])
                                 else "") if x]
            out.append(make_cand("%s:%s" % (kind, ">".join("/" + x for x in k)), "sequence",
                                 " \u2192 ".join("/" + x for x in k), m, count_sequences, since,
                                 {"notes": notes},
                                 lambda a: ("/%s %s" % (a["cmd"], a["his"])).strip() if a["his"] else ""))
    runs, flags, argv, free = count_habits(sessions)
    for table, kind in ((flags, "flag"), (argv, "args")):
        for (cmd, val), m in table.items():
            share = len(m) / float(len(runs[cmd]))
            if share > HABIT_SHARE and passes(m):           # "most runs": more than half
                out.append(make_cand("%s:/%s %s" % (kind, cmd, val), kind, "/%s %s" % (cmd, val), m,
                                     count_habits, since, {"share": round(share, 3), "runs": len(runs[cmd]),
                                                           "notes": [builtin_note([cmd])]},
                                     lambda a: ("/%s %s" % (a["cmd"], a["his"])).strip()))
    for (cmd, txt), m in free.items():
        if passes(m):
            out.append(make_cand("freetext:/%s:%s" % (cmd, short_hash(txt)), "free text",
                                 "/%s + \"%s\"" % (cmd, txt), m, count_habits, since,
                                 {"runs": len(runs[cmd])}, lambda a: ("/%s %s" % (a["cmd"], a["his"]))))
    for k, m in count_repeats(sessions).items():
        if passes(m):
            hidden = k.startswith("#secret:")
            out.append(make_cand("repeat:" + short_hash(k), "repeat",
                                 "[withheld: secret-shaped text]" if hidden else k, m, count_repeats, since,
                                 {"short": len(k) < SHORT_REPEAT, "secret": hidden}, lambda a: a["his"]))
    req, after, plain = count_reexplain(sessions)
    for cmd, m in req.items():
        if passes(m):
            out.append(make_cand("reexplain:/" + cmd, "defect",
                                 "/%s with the assistant's own text as its argument" % cmd, m,
                                 count_reexplain, since,
                                 {"after": after[cmd].most_common(6), "runs_without_quote": plain[cmd]}))
    out.sort(key=lambda c: (-c["sessions"], -c["occurrences"], c["key"]))
    return out


# ── the trend ───────────────────────────────────────────────────────────────────────────────────────
TREND_METRICS = (("command share %", "cmd_pct"), ("re-explanations /100 turns", "reexpl_100"),
                 ("interrupts /100 turns", "intr_100"), ("compactions", "compactions"),
                 ("recovered after compaction %", "recovered_pct"), ("delegations /turn", "deleg_turn"))


def _between(sorted_lines, lo, hi):
    i = bisect.bisect_right(sorted_lines, lo)
    return i < len(sorted_lines) and sorted_lines[i] < hi


def build_trend(results, live, git, changes, now, data_start):
    """Weekly rows from the first week with an owner act to the newest. Recovered: of the compactions he
    acted after (before the next compaction), the share with a /post-compact run in that same stretch,
    his or the seat's; a fixed time window miscounts a compaction he comes back to hours later."""
    rows = {}

    def W(wk):
        return rows.setdefault(wk, collections.Counter())

    sess = collections.defaultdict(set)
    lines, post = collections.defaultdict(list), collections.defaultdict(list)
    for a in live:
        w = W(week_of(a["ts"]))
        sess[week_of(a["ts"])].add(a["sid"])
        w["turns"] += a["kind"] in TURN_KINDS
        w["commands"] += a["kind"] == "command"
        w["interrupts"] += a["kind"] == "interrupt"
        w["reexplain"] += a["kind"] == "command" and a["cmd"] in REEXPLAIN and bool(a.get("quoted_arg"))
        lines[a["sid"]].append(a["line"])
        if a["kind"] == "command" and a["cmd"] == "post-compact":
            post[a["sid"]].append(a["line"])
    for res in results:
        if res.get("excluded"):
            continue
        acts = sorted(lines[res["stem"]])
        runs = sorted(post[res["stem"]] + [n for n, _, s in res["skill_runs"] if s == "post-compact"])
        comps = sorted(res["compactions"])
        for i, (n, ts, trig) in enumerate(comps):
            if not ts:
                continue
            nxt = comps[i + 1][0] if i + 1 < len(comps) else float("inf")
            w = W(week_of(ts))
            w["compact_" + (trig if trig in ("auto", "manual") else "other")] += 1
            if _between(acts, n, nxt):
                w["comp_acted"] += 1
                w["recovered"] += _between(runs, n, nxt)
        for wk, k in res["deleg"].items():
            W(wk)["deleg"] += k
    created = collections.defaultdict(list)
    for name, day in (git or {}).get("created", {}).items():
        created[week_of(day)].append(name)
    for wk, kinds in (git or {}).get("weekly", {}).items():
        for k, v in kinds.items():
            W(wk)[k] += v
    if not rows:
        return [], {}
    start, last, out = week_of(data_start.isoformat()), max(rows), []
    pre = {"weeks": sorted(w for w in rows if w < start)}
    pre.update(commands_added=sum(rows[w]["commands_added"] for w in pre["weeks"]),
               hooks_added=sum(rows[w]["hooks_added"] for w in pre["weeks"]))
    wk = start
    while wk <= last:
        w = rows.get(wk, collections.Counter())
        mon = week_monday(wk)
        turns, acted = w["turns"], w["comp_acted"]
        out.append({
            "week": wk, "complete": mon >= data_start and mon + datetime.timedelta(days=7) <= now.date(),
            "turns": turns, "sessions": len(sess[wk]), "commands": w["commands"],
            "cmd_pct": round(100.0 * w["commands"] / turns, 1) if turns else None,
            "reexpl_100": round(100.0 * w["reexplain"] / turns, 2) if turns else None,
            "intr_100": round(100.0 * w["interrupts"] / turns, 2) if turns else None,
            "compact_auto": w["compact_auto"], "compact_manual": w["compact_manual"],
            "compactions": w["compact_auto"] + w["compact_manual"] + w["compact_other"],
            "recovered_pct": round(100.0 * w["recovered"] / acted, 1) if acted else None,
            "deleg": w["deleg"], "deleg_turn": round(float(w["deleg"]) / turns, 3) if turns else None,
            "commands_added": w["commands_added"], "hooks_added": w["hooks_added"],
            "created": sorted(created.get(wk, [])),
            "changes": sorted(k + ("" if tx else " (another log)") for k, tx in changes.get(wk, [])),
            "changes_tx": sorted(k for k, tx in changes.get(wk, []) if tx)})
        wk = week_of((mon + datetime.timedelta(days=7)).isoformat())
    return out, pre


def action_rule(rows, created=None):
    """Spec § Trend: a FINDING needs >= 2 consecutive complete weeks outside the prior 4 complete weeks'
    mean +- 2 SD, in the same direction, with no transcript logging change in those weeks (else HELD for a
    second instrument), and, for a metric that counts a command, that command existing from the first
    baseline week (else HELD as an era change). The candidate cause and the decision it would change are
    judgment, so they are owed."""
    out, comp, created = [], [r for r in rows if r["complete"]], created or {}
    for label, key in TREND_METRICS:
        flags = []
        for i, r in enumerate(comp):
            prior = [x[key] for x in comp[max(0, i - 4):i] if x[key] is not None]
            if i < 4 or len(prior) < 4 or r[key] is None:
                flags.append(None)
                continue
            m, sd = statistics.mean(prior), statistics.stdev(prior)
            d = 1 if r[key] > m + 2 * sd else (-1 if r[key] < m - 2 * sd else 0)
            flags.append((d, m, sd) if d else None)
        i = 0
        while i < len(comp):
            if flags[i] is None:
                i += 1
                continue
            j = i
            while j + 1 < len(comp) and flags[j + 1] is not None and flags[j + 1][0] == flags[i][0]:
                j += 1
            run = comp[i:j + 1]
            changes = sorted({c for r in run for c in r["changes_tx"]})
            lo = week_monday(comp[max(0, i - 4)]["week"]).isoformat()
            hi = (week_monday(comp[j]["week"]) + datetime.timedelta(days=7)).isoformat()
            era = sorted("/%s created %s" % (c, created[c][:10]) for c in ERA_COMMANDS.get(key, ())
                         if c in created and lo <= created[c][:10] < hi)
            if j == i:
                status = "observation (one week)"
            elif era:
                status = "HELD: era change, a command this metric counts did not exist through its baseline (%s)" % (
                    "; ".join(era))
            elif changes:
                status = "HELD: transcript logging change in these weeks (%s); needs a second instrument" % (
                    "; ".join(changes))
            else:
                status = "MOVEMENT: judgment owes a candidate cause and the decision it would change"
            out.append({"metric": label, "weeks": [r["week"] for r in run], "values": [r[key] for r in run],
                        "direction": "up" if flags[i][0] > 0 else "down",
                        "baseline": "%.2f +- %.2f" % (flags[i][1], 2 * flags[i][2]), "status": status})
            i = j + 1
    return out


# ── the system side: git and the typed-command log ──────────────────────────────────────────────────
def git_adds(P):
    """First commit adding each skill or command spec, and hooks added per week, from git (read-only)."""
    if not P.get("git"):
        return {"error": "not read (self-test)", "created": {}, "weekly": {}, "files": 0}
    try:
        out = subprocess.run(
            ["git", "-C", P["repo"], "log", "--no-renames", "--diff-filter=A", "--format=%x1e%cI",
             "--name-only", "--", ".claude/skills/*/SKILL.md", ".claude/commands/*.md", ".claude/hooks/*"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=180)
    except (OSError, subprocess.SubprocessError) as e:
        return {"error": str(e)[:200], "created": {}, "weekly": {}, "files": 0}
    if out.returncode != 0:
        return {"error": out.stderr.strip()[:200], "created": {}, "weekly": {}, "files": 0}
    created, hooks, files = {}, {}, 0
    for block in out.stdout.split("\x1e")[1:]:
        lines = [x for x in block.strip().split("\n") if x]
        if not lines:
            continue
        try:
            when = datetime.datetime.strptime(lines[0][:19], "%Y-%m-%dT%H:%M:%S")
            off = lines[0][19:].replace(":", "")
            if off and off not in ("Z", "+0000"):
                sign = 1 if off[0] == "+" else -1
                when -= sign * datetime.timedelta(hours=int(off[1:3]), minutes=int(off[3:5]))
        except (ValueError, IndexError):
            continue
        day = when.strftime("%Y-%m-%dT%H:%M:%S")
        for p in lines[1:]:
            files += 1
            parts = p.split("/")
            if p.endswith("/SKILL.md") and len(parts) == 4:
                name = parts[2]
            elif p.startswith(".claude/commands/") and p.endswith(".md") and len(parts) == 3:
                name = parts[2][:-3]
            elif p.startswith(".claude/hooks/") and len(parts) == 3:
                hooks[p] = min(hooks.get(p, day), day)
                continue
            else:
                continue
            created[name] = min(created.get(name, day), day)
    weekly = collections.defaultdict(collections.Counter)
    for day in created.values():
        weekly[week_of(day)]["commands_added"] += 1
    for day in hooks.values():
        weekly[week_of(day)]["hooks_added"] += 1
    days = sorted(list(created.values()) + list(hooks.values()))
    return {"error": None, "created": created, "weekly": weekly, "files": files, "hooks": len(hooks),
            "span": "%s → %s" % (days[0][:10], days[-1][:10]) if days else ""}


def inventory(repo):
    names = {os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(repo, ".claude/skills/*/SKILL.md"))}
    return names | {os.path.basename(p)[:-3] for p in glob.glob(os.path.join(repo, ".claude/commands/*.md"))}


def skill_log_stats(P, live, inv, ex, data_start):
    rows, bad, total, exists = read_jsonl(P["skill_log"])
    out = {"exists": exists, "total": total, "bad": bad, "span": "", "user": 0, "firsts": {}}
    if not rows:
        return out
    ts = sorted(r.get("ts") or "" for r in rows if r.get("ts"))
    out["span"] = "%s \u2192 %s" % (ts[0][:10], ts[-1][:10]) if ts else ""
    for r in rows:
        t = (r.get("ts") or "")[:19]
        if "source" in r and t:
            out["firsts"].setdefault("skill log: source field", t)
        if str(r.get("session") or "unknown") != "unknown" and t:
            out["firsts"].setdefault("skill log: session-keyed rows", t)
    user = [r for r in rows if r.get("source") == "user-prompt" and str(r.get("session"))[:8] not in ex]
    out["user"] = len(user)
    lg = collections.Counter((str(r.get("session")), str(r.get("skill"))) for r in user)
    tx = collections.Counter((a["sid"], a["cmd"]) for a in live if a["kind"] == "command" and a["cmd"] in inv)
    both = {s for s, _ in lg} & {s for s, _ in tx}
    out["sessions_both"] = len(both)
    out["tx"] = sum(v for k, v in tx.items() if k[0] in both)
    out["log"] = sum(v for k, v in lg.items() if k[0] in both)
    out["matched"] = sum(min(v, lg.get(k, 0)) for k, v in tx.items() if k[0] in both)
    out["builtins_tx"] = sum(1 for a in live if a["kind"] == "command" and a["cmd"] not in inv)
    # the per-command column compares like with like: log rows inside the transcripts' own span
    out["per_skill"] = collections.Counter(str(r.get("skill")) for r in user if (r.get("ts") or "") >= data_start)
    return out


def dispatch_stats(P, results):
    rows, bad, total, exists = read_jsonl(P["dispatch_log"])
    out = {"exists": exists, "total": total, "bad": bad, "span": "", "first": ""}
    ts = sorted((r.get("ts") or "")[:19] for r in rows if r.get("ts"))
    if not ts:
        return out
    out["span"], out["first"] = "%s \u2192 %s" % (ts[0][:10], ts[-1][:10]), ts[0]
    top = {res["stem"] for res in results if not res.get("excluded")}
    weeks = {week_of(t) for t in ts}
    out["weekly"] = collections.Counter(week_of(r["ts"]) for r in rows
                                        if r.get("ts") and str(r.get("session")) in top)
    out["log_in_top"] = sum(out["weekly"].values())
    out["tx_same_weeks"] = sum(k for res in results if not res.get("excluded")
                               for wk, k in res["deleg"].items() if wk in weeks)
    return out


# ── step 5: the codified corpus ─────────────────────────────────────────────────────────────────────
def load_corpus(repo):
    areas = []
    for name, pats in CORPUS_AREAS:
        files, seen = [], set()
        for pat in pats:
            for p in sorted(glob.glob(os.path.join(repo, pat), recursive=True)):
                rel = os.path.relpath(p, repo)
                if rel in seen or not os.path.isfile(p) or rel.startswith(CORPUS_SKIP):
                    continue
                seen.add(rel)
                try:
                    with open(p, encoding="utf-8", errors="replace") as fh:
                        low = fh.read().lower()
                except OSError:
                    continue
                files.append({"rel": rel, "low": low, "flat": " ".join(low.split()), "bytes": len(low)})
        areas.append((name, files))
    return areas


def term_rx(t):
    if t[:1] in "/-":
        return re.compile(r"(?<![\w/.-])" + re.escape(t) + r"(?![\w-])")
    return re.compile(re.escape(t))


def _coline(low, terms, rxs):
    """1-based line number of the first line carrying every term, walking the rarest term's hits."""
    anchor = min(terms, key=low.count)
    start = 0
    while True:
        i = low.find(anchor, start)
        if i < 0:
            return 0
        a, b = low.rfind("\n", 0, i) + 1, low.find("\n", i)
        b = len(low) if b < 0 else b
        if all(rx.search(low[a:b]) for rx in rxs):
            return low.count("\n", 0, a) + 1
        start = b + 1


def search(areas, terms, mode):
    """Files per area carrying every term on one line (coline) or the phrase whitespace-collapsed
    anywhere (phrase). Prints nothing; the caller reports the file count it searched."""
    terms = [t.lower() for t in terms if t]
    rxs = [term_rx(t) for t in terms]
    found, hits, searched = collections.Counter(), [], 0
    for name, files in areas:
        for f in files:
            searched += 1
            if mode == "phrase":
                if terms[0] not in f["flat"]:
                    continue
                i = f["low"].find(terms[0])
                line = f["low"].count("\n", 0, i) + 1 if i >= 0 else 0
            else:
                if not all(t in f["low"] for t in terms):
                    continue
                line = _coline(f["low"], terms, rxs)
                if not line:
                    continue
            found[name] += 1
            if len(hits) < 3:
                hits.append("%s:%s" % (f["rel"], line or "(spans lines)"))
    return {"files": dict(found), "total": sum(found.values()), "hits": hits, "searched": searched}


def query_for(c):
    if c["key"].startswith(("seq2:", "seq3:")):
        return c["key"].split(":", 1)[1].split(">"), "coline"
    if c["kind"] == "flag":
        cmd, flag = c["label"].split(" ", 1)
        return [cmd, flag], "coline"
    if c["kind"] == "args":
        return [c["label"]], "phrase"
    if c["kind"] == "free text":
        txt = c["label"].split(" + ", 1)[1].strip('"')
        return ([txt], "phrase") if len(txt) >= 12 else (None, "too short to search")
    if c["kind"] == "repeat":
        if c["detail"].get("secret"):
            return None, "secret-shaped: never searched or shown"
        return ([c["label"]], "phrase") if len(c["label"]) >= 12 else (None, "too short to search")
    return None, "a system defect: the readout before it is named in the detail"


def read_ledger(P):
    path = os.path.join(P["out"], "ledger.md")
    rows = []
    if not os.path.isfile(path):
        return rows, False
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if not line.startswith("|"):
                continue
            cells = [x.strip() for x in line.strip().strip("|").split("|")]
            if len(cells) < 4 or cells[0].lower() == "key" or not cells[0].strip("-: "):
                continue
            digits = re.match(r"\s*(\d[\d,]*)", cells[2])
            rows.append({"key": cells[0].strip("`"), "proposed": cells[1],
                         "sessions": int(digits.group(1).replace(",", "")) if digits else 0,
                         "status": cells[3].lower(), "answered": cells[4] if len(cells) > 4 else "",
                         "words": cells[5] if len(cells) > 5 else "", "report": cells[6] if len(cells) > 6 else ""})
    return rows, True


def ledger_hold(c, rows):
    mine = [r for r in rows if r["key"] == c["key"]]
    if not mine:
        return None
    r = mine[-1]
    if r["status"] == "no":
        if c["sessions"] >= 2 * max(1, r["sessions"]):
            return None
        return "ledger: no on %s at %d sessions; now %d, raised again at %d" % (
            r["answered"] or r["proposed"], r["sessions"], c["sessions"], 2 * max(1, r["sessions"]))
    if r["status"] == "yes":
        return "ledger: yes on %s" % (r["answered"] or r["proposed"])
    return "ledger: proposed %s, status %s" % (r["proposed"], r["status"] or "blank")


# ── the pipeline (run and maintain share it; the self-test drives it in-process) ───────────────────
def pipeline(P, workers=4, since=None, own_sid=None, now=None):
    now = now or datetime.datetime.utcnow().replace(microsecond=0)
    t0 = time.time()
    results, subagent_files = gather(P, workers)
    scan_s = time.time() - t0
    dropped = dedupe(results)
    folded = sum(fold_interrupts(res) for res in results)
    ex = excluded_sids(P, own_sid)
    acts = []
    for res in results:
        res["excluded"] = res["stem"][:8] in ex
        for a in res["acts"]:
            a["excluded"] = res["excluded"]
            acts.append(a)
    live = [a for a in acts if not a["excluded"] and a["ts"]]
    controls = [control_i46(acts), control_auto(results, acts)]
    window_start = since or newest_report(P)[1] or ""
    data_start = min((a["ts"] for a in live), default=now.strftime("%Y-%m-%dT%H:%M:%S"))
    inv = inventory(P["repo"])
    git = git_adds(P)
    slog = skill_log_stats(P, live, inv, ex, data_start)
    disp = dispatch_stats(P, results)
    firsts = {}
    for res in results:
        if not res["excluded"]:
            for k, v in res["firsts"].items():
                firsts[k] = min(firsts.get(k, v), v)
    for k, v in list(slog["firsts"].items()) + ([("dispatch log starts", disp["first"])] if disp["first"] else []):
        firsts[k] = min(firsts.get(k, v), v)
    # (label, is a TRANSCRIPT change). The other logs' firsts are shown for context; no trend metric is
    # read from them, so they never hold a transcript movement.
    changes = collections.defaultdict(list)
    for k, v in firsts.items():
        tx = k in LOGGING_FIRSTS or k.startswith("harness ")
        if (tx or k.startswith(("skill log", "dispatch log"))) and v > data_start \
                and week_of(v) != week_of(data_start):
            changes[week_of(v)].append((k, tx))
    trend, trend_pre = build_trend(results, live, git, changes, now, ts_dt(data_start).date())
    cands = build_candidates(live, inv, window_start)
    return {"now": now, "results": results, "acts": acts, "live": live, "excluded": sorted(ex),
            "dropped": dropped, "folded": folded, "subagent_files": subagent_files, "scan_s": scan_s,
            "controls": controls, "window_start": window_start, "inventory": inv, "git": git,
            "slog": slog, "dispatch": disp, "data_start": data_start, "trend": trend, "trend_pre": trend_pre,
            "movements": action_rule(trend, git.get("created")), "candidates": cands}


def corpus_step(P, R):
    """Step 5: search, with the control and the per-area file counts; then the ledger.md holds."""
    areas = load_corpus(P["repo"])
    counts = [(name, len(files), sum(f["bytes"] for f in files)) for name, files in areas]
    area, terms = CORPUS_CONTROL
    ctrl = search(areas, list(terms), "coline")
    empty = [n for n, k, _ in counts if k == 0 and n not in OPTIONAL_AREAS]
    ok = ctrl["files"].get(area, 0) > 0 and not empty
    R["corpus"] = {"areas": counts, "control": {"terms": list(terms), "area": area, "result": ctrl, "ok": ok,
                                               "empty_required_areas": empty}}
    if not ok:
        return False
    ledger_rows, exists = read_ledger(P)
    R["ledger_rows"], R["ledger_exists"] = ledger_rows, exists
    rank = collections.Counter()
    for c in R["candidates"]:                          # sorted by distinct sessions already
        rank[c["kind"]] += 1
        c["held"] = ledger_hold(c, ledger_rows)
        terms, mode = query_for(c)
        if terms is None:
            c["corpus"] = {"note": mode}
        elif rank[c["kind"]] > SEARCH_PER_KIND:
            c["corpus"] = {"note": "not searched: rank %d among %s candidates, past the %d searched per kind" % (
                rank[c["kind"]], c["kind"], SEARCH_PER_KIND)}
        else:
            c["corpus"] = dict(search(areas, terms, mode), terms=terms, mode=mode)
    return True


REPORT_NAME = re.compile(r"\d{4}-\d{2}-\d{2}\.md\Z")   # the spec's report name; a draft, a -draft-v2 re-roll
                                                         # or a dated notes file is never the newest report


def newest_report(P):
    """(path, window-end) of the newest plans/instinct-sweep/YYYY-MM-DD.md, or (None, None)."""
    found = sorted(p for p in glob.glob(os.path.join(P["out"], "*.md")) if REPORT_NAME.match(os.path.basename(p)))
    if not found:
        return None, None
    end = None
    with open(found[-1], encoding="utf-8", errors="replace") as fh:
        for line in fh:
            m = re.match(r"\s*window-end:\s*(\d{4}-\d{2}-\d{2}(?:T[\d:]{8})?)", line)
            if m:
                end = m.group(1)
                break
    return found[-1], end or os.path.basename(found[-1])[:10]


# ── rendering ───────────────────────────────────────────────────────────────────────────────────────
def pct(a, b):
    return "%.1f%%" % (100.0 * a / b) if b else "n/a"


def render_coverage(R):
    res = R["results"]
    read = [x for x in res if not x["excluded"]]
    live = R["live"]
    by_pop = collections.Counter(a["pop"] for a in live)
    census = collections.Counter()
    for x in res:
        census.update(x["census"])
    span = (min((x["first_ts"] for x in read if x["first_ts"]), default=""),
            max((x["last_ts"] for x in read if x["last_ts"]), default=""))
    in_window = [x for x in res if x["last_ts"] and x["last_ts"] >= (R["window_start"] or "")]
    s = R["slog"]
    d = R["dispatch"]
    g = R["git"]
    L = ["## 0. Coverage", "",
         "| stream | span (UTC) | rows | parse failures | coverage against its ground truth |", "|---|---|---|---|---|",
         "| top-level transcripts | %s \u2192 %s | %d files, %s lines, %.2f GiB (%s lines parsed after the byte prefilter) | %d | every top-level file is read; %s sub-agent transcripts under `*/subagents/` are not read, by design |" % (
             span[0][:10], span[1][:10], len(res), format(sum(x["lines"] for x in res), ","),
             sum(x["bytes"] for x in res) / 1024.0 ** 3, format(sum(x["parsed"] for x in res), ","),
             sum(x["parse_fail"] for x in res), format(R["subagent_files"], ",")),
         "| typed-command log, `source: user-prompt` | %s | %s of %s rows | %d | %s |" % (
             s["span"] or "absent", format(s["user"], ","), format(s["total"], ","), s["bad"],
             ("in the %d sessions both carry: transcripts %d skill/command runs, log %d, matched %d (%s of the transcript count); built-ins: %d in transcripts, never in this log" % (
                 s["sessions_both"], s["tx"], s["log"], s["matched"], pct(s["matched"], s["tx"]), s["builtins_tx"]))
             if s.get("sessions_both") is not None else "not compared"),
         "| git, `.claude/` file adds | %s | %s | %s | creation commits found for %d of %d current skills and commands; %s hook files added |" % (
             (g.get("span") or "") if not g["error"] else "unavailable: " + g["error"], g["files"], "n/a",
             len(set(g["created"]) & R["inventory"]), len(R["inventory"]), g.get("hooks", 0)),
         "| sub-agent dispatch log | %s | %s | %d | %s |" % (
             d["span"] or "absent", format(d["total"], ","), d["bad"],
             ("over the weeks it covers: log %d dispatches from top-level sessions, transcripts %d Agent/Task calls" % (
                 d.get("log_in_top", 0), d.get("tx_same_weeks", 0))) if d["span"] else "not compared"),
         ""]
    total = sum(by_pop.values())
    L.append("**Owner acts** (population: %d acts in %d top-level sessions, after the exclusions and uuid dedupe below): %s." % (
        total, len({a["sid"] for a in live}),
        ", ".join("%s %s %d" % (p, IDX.POP_NAMES.get(p, "interrupt"), by_pop[p]) for p in list(IDX.POP_ORDER) + ["i"] if by_pop[p])))
    L.append("")
    for k in ("sidechain records seen (never his)", "typed records with a machine turnOrigin"):
        census[k] += 0                      # printed even at zero: each is an assertion about the corpus
    L.append("**Census**: uuid copies dropped %d; interrupts folded into the refusal they follow %d; %s." % (
        R["dropped"], R["folded"], "; ".join("%s %d" % (k, v) for k, v in sorted(census.items()))))
    L.append("")
    sec = [a for a in R["acts"] if a.get("secret")]
    L.append("**Secret-shaped owner records** (population: every ledger act; text withheld at the source, never "
             "quoted and never in the ledger, still counted as turns): %d%s." % (
                 len(sec), (": " + ", ".join(a["uuid"] for a in sec[:10]) + (
                     ", and %d more listed in the candidates file" % (len(sec) - 10) if len(sec) > 10 else ""))
                 if sec else ""))
    L.append("")
    L.append("**Sessions**: %d top-level files; %d carry a dated record the prefilter keeps, last on or after %s "
             "(the window), and the other %d carry none; %d of the window's are read and %d excluded (%s); %d carry an "
             "owner act." % (len(res), len(in_window), R["window_start"][:10] or "the start of history",
                             len(res) - len(in_window), len([x for x in in_window if not x["excluded"]]),
                             len([x for x in res if x["excluded"]]), ", ".join(R["excluded"]),
                             len({a["sid"] for a in live})))
    L += ["", "Text of typed messages and command arguments, by month (bytes; UNSPLIT counts as QUOTED, never his):", "",
          "| month | turns | sessions | HIS PART | QUOTED (clean split) | UNSPLIT | PASTED |", "|---|---|---|---|---|---|---|"]
    months = collections.defaultdict(collections.Counter)
    msess = collections.defaultdict(set)
    for a in live:
        m = months[a["ts"][:7]]
        msess[a["ts"][:7]].add(a["sid"])
        m["turns"] += a["kind"] in TURN_KINDS
        if a["kind"] == "typed" or a["pop"] == "e":
            m["his"] += a["his_b"]
            m["clean" if a["split"] == "clean" else ("unsplit" if a["split"] == "unsplit" else "none")] += a["quoted_b"]
            m["pasted"] += a["pasted_b"]
    gaps = []
    if months:
        y, mo = int(min(months)[:4]), int(min(months)[5:7])
        while "%04d-%02d" % (y, mo) <= max(months):
            k = "%04d-%02d" % (y, mo)
            m = months.get(k, collections.Counter())
            tot = m["his"] + m["clean"] + m["unsplit"] + m["pasted"]
            if not m["turns"]:
                gaps.append(k)
            L.append("| %s | %d | %d | %s | %s | %s | %s |" % (k, m["turns"], len(msess[k]), pct(m["his"], tot),
                                                          pct(m["clean"], tot), pct(m["unsplit"], tot), pct(m["pasted"], tot)))
            y, mo = (y + 1, 1) if mo == 12 else (y, mo + 1)
    L += ["", "Coverage gaps (a month inside the span with zero owner turns): %s." % (", ".join(gaps) or "none"), "",
          "**Controls**: " + "; ".join("%s: %s (%s)" % (c["name"], "PASS" if c["ok"] else "FAIL", c["detail"]) for c in R["controls"]) + "."]
    return "\n".join(L)


def render_trend(R):
    pre = R.get("trend_pre") or {}
    L = ["## Weekly trend", "",
         "Population: the owner acts above, by ISO week (UTC dates only), from the first week with an owner act. "
         "Turns = typed + command + answer + refusal. Recovered = of the compactions he acted after (before the next "
         "compaction in that session), the share with a /post-compact run in the same stretch, his or the seat's Skill "
         "call. Delegations = Agent/Task tool calls in top-level transcripts. Era = skill and command specs whose first "
         "git add falls in the week (a command's usage counts from it); hooks+ = top-level `.claude/hooks/` files added. "
         "A logging change is the first record of a field or record kind after the first data week; one marked "
         "\"(another log)\" changed a log no trend column reads.", ""]
    if pre.get("weeks"):
        L += ["Before the first owner act (%s to %s): %d skill and command specs and %d hook files were added." % (
            pre["weeks"][0], pre["weeks"][-1], pre["commands_added"], pre["hooks_added"]), ""]
    L += ["| week | complete | turns | sessions | command % | re-expl /100 | interrupts /100 | compactions auto/manual | recovered % | delegations /turn | era (commands created) | hooks+ | logging change |",
          "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    f = lambda v: "\u2014" if v is None else str(v)
    for r in R["trend"]:
        era = ", ".join("/" + c for c in r["created"][:4]) + (" +%d" % (len(r["created"]) - 4) if len(r["created"]) > 4 else "")
        L.append("| %s | %s | %d | %d | %s | %s | %s | %d/%d | %s | %s | %s | %d | %s |" % (
            r["week"], "yes" if r["complete"] else "no", r["turns"], r["sessions"], f(r["cmd_pct"]),
            f(r["reexpl_100"]), f(r["intr_100"]), r["compact_auto"], r["compact_manual"], f(r["recovered_pct"]),
            f(r["deleg_turn"]), era, r["hooks_added"], "; ".join(r["changes"])))
    L += ["", "**Action rule** (spec \u00a7 Trend, applied by `action_rule`): a movement is a FINDING only when it holds for "
          ">= 2 consecutive complete weeks outside the prior 4 complete weeks' mean +- 2 SD, with no transcript logging change "
          "in those weeks unless a second instrument agrees, and with the commands it counts existing through its baseline; "
          "the candidate cause and the decision it would change are judgment.", ""]
    mv = R["movements"]
    weekly = R["dispatch"].get("weekly") or {}
    for m in mv:
        second = ""
        if m["metric"].startswith("delegations") and weekly:
            second = "; second instrument, the dispatch log, rows from top-level sessions: " + ", ".join(
                "%s %d" % (w, weekly.get(w, 0)) for w in m["weeks"])
        L.append("- %s, %s, %s: %s (baseline %s) \u2014 %s%s" % (
            m["metric"], m["direction"], ", ".join(m["weeks"]), ", ".join(str(v) for v in m["values"]), m["baseline"],
            m["status"], second))
    if not mv:
        L.append("- no week left its baseline band.")
    return "\n".join(L)


def render_commands(R):
    live, created = R["live"], R["git"]["created"]
    runs = collections.defaultdict(list)
    for a in live:
        if a["kind"] == "command":
            runs[a["cmd"]].append(a)
    now = R["now"]
    L = ["## Commands he typed (from transcripts; the typed-command log column is a second channel, never the count)", "",
         "| command | runs | sessions | first | last | created (git) | runs/week since created | typed-command log rows |",
         "|---|---|---|---|---|---|---|---|"]
    for cmd, m in sorted(runs.items(), key=lambda x: -len(x[1]))[:30]:
        c = created.get(cmd)
        since = [a for a in m if c and a["ts"] >= c]
        wk = max(1.0, (now - ts_dt(c)).days / 7.0) if c else None
        L.append("| /%s | %d | %d | %s | %s | %s | %s | %s |" % (
            cmd, len(m), len({a["sid"] for a in m}), min(a["ts"] for a in m)[:10], max(a["ts"] for a in m)[:10],
            c[:10] if c else ("built-in or retired" if cmd not in R["inventory"] else "no add commit found"),
            ("%.1f" % (len(since) / wk)) if wk else "\u2014",
            R["slog"].get("per_skill", {}).get(cmd, 0) if cmd in R["inventory"] else "never logged (built-in)"))
    return "\n".join(L)


def render_candidates(R):
    c_all = R["candidates"]
    shown = [c for c in c_all if not c.get("held")]
    L = ["## Candidates (exact counts, step 2) \u2014 not yet verified (step 4) or capped (step 6)", "",
         "Bar: >= %d distinct sessions on >= %d calendar days. %d candidates pass it; %d are held back by the ledger. "
         "Shown: the top %d of each kind by distinct sessions; every candidate is in the candidates file. "
         "Corpus hits are a hint for step 4, never a verdict." % (
             SESSION_BAR, DAY_BAR, len(c_all), len(c_all) - len(shown), SHOW_PER_KIND), ""]
    kinds = ("sequence", "flag", "args", "free text", "repeat", "defect")
    L.append("Per kind: " + ", ".join("%s %d" % (k, sum(1 for c in shown if c["kind"] == k)) for k in kinds) + ".")
    for kind in kinds:
        rows = [c for c in shown if c["kind"] == kind]
        if kind == "repeat":
            short = [c for c in rows if c["detail"].get("short") and not c["detail"].get("secret")]
            rows = [c for c in rows if c not in short]
            if short:
                L += ["", "### repeat, under %d characters (one line, by distinct sessions; the full rows are in the candidates file)" % SHORT_REPEAT,
                      "", "; ".join('"%s" %d sessions' % (clip(c["label"]).replace("|", "¦"), c["sessions"])
                                    for c in short[:30]) + ("; and %d more in the candidates file" % (len(short) - 30)
                                                            if len(short) > 30 else "") + "."]
        rows = rows[:SHOW_PER_KIND]
        if not rows:
            continue
        L += ["", "### %s" % kind, "",
              "| key | what | sessions | days | occurrences | first | last | new since window-start | corpus files (of searched) | 3 uuids |",
              "|---|---|---|---|---|---|---|---|---|---|"]
        for c in rows:
            cp = c.get("corpus") or {}
            corp = ("%d of %d: %s" % (cp["total"], cp["searched"], ", ".join(cp["hits"][:2]) or "none")
                    if "total" in cp else cp.get("note", ""))
            label = clip(c["label"])
            L.append("| `%s` | %s | %d | %d | %d | %s | %s | %s | %s | %s |" % (
                c["key"], label.replace("|", "\u00a6"), c["sessions"], c["days"], c["occurrences"], c["first"], c["last"],
                "%d in %d sessions" % (c["since_occurrences"], c["since_sessions"]) if R["window_start"] else "\u2014",
                corp.replace("|", "\u00a6"), ", ".join(c["uuids"])))
        L.append("")
        for c in rows[:6]:
            bits = ["counted by %s" % c["counted_by"]]
            det = c["detail"]
            if det.get("share") is not None:
                bits.append("on %.0f%% of his %d runs" % (100 * det["share"], det["runs"]))
            if det.get("after"):
                bits.append("his act before it: " + ", ".join("%s %d" % (k, v) for k, v in det["after"]))
                bits.append("runs without a quoted argument: %d" % det.get("runs_without_quote", 0))
            bits += [n for n in det.get("notes") or [] if n]
            if c["quotes"] and kind != "repeat":           # a repeat's label already is his words
                bits.append("his words: " + " / ".join('"%s"' % clip(q).replace("|", "\u00a6") for q in c["quotes"]))
            L.append("- `%s`: %s." % (c["key"], "; ".join(bits)))
    held = [c for c in c_all if c.get("held")]
    L += ["", "## Held back", ""] + (["- `%s` (%d sessions): %s" % (c["key"], c["sessions"], c["held"]) for c in held]
                                     or ["- none: the ledger holds no row for any candidate key."])
    return "\n".join(L)


def render_corpus(R):
    cp = R["corpus"]
    ctl = cp["control"]
    L = ["## Codified-corpus search (step 5)", "",
         "Areas searched (files, bytes): " + ", ".join("%s %d (%s)" % (n, k, format(b, ",")) for n, k, b in cp["areas"]) +
         ". `.claude/skills/instinct-sweep/` is left out: this command's own spec names candidates as examples.",
         "", "Control: `%s` on one line must hit area `%s`: %d files there (%s), %d files in all, of %d searched \u2014 %s." % (
             " + ".join(ctl["terms"]), ctl["area"], ctl["result"]["files"].get(ctl["area"], 0),
             ", ".join(ctl["result"]["hits"]), ctl["result"]["total"], ctl["result"]["searched"],
             "PASS" if ctl["ok"] else "VOID")]
    if ctl.get("empty_required_areas"):
        L.append("Empty required areas: " + ", ".join(ctl["empty_required_areas"]) + ".")
    L.append("Ledger: %s." % ("plans/instinct-sweep/ledger.md, %d rows" % len(R.get("ledger_rows") or [])
                              if R.get("ledger_exists") else "absent (no proposal answered yet)"))
    return "\n".join(L)


def render_draft(R):
    head = ["# /instinct-sweep \u2014 DRAFT %s (script output: steps 0-2 and 5; judgment steps 3, 4 and 6 not run)" % R["now"].date(),
            "", "window-start: %s" % (R["window_start"] or R["data_start"]),
            "window-end: %sZ" % R["now"].strftime("%Y-%m-%dT%H:%M:%S"),
            "generated-by: scripts/instinct-sweep.py run",
            "excluded-sessions: %s" % ", ".join(R["excluded"]), "",
            "The unit is one owner act; only HIS PART counts as his words. Prose clustering (step 3) is OFF "
            "(spec § Build status) and is not in this draft.", ""]
    return "\n\n".join(["\n".join(head), render_coverage(R), render_trend(R), render_candidates(R),
                        render_commands(R), render_corpus(R)]) + "\n"


def candidates_json(R):
    out = []
    for c in R["candidates"]:
        d = dict(c)
        d["quotes"] = [clip(q) for q in c["quotes"]]
        d["label"] = clip(c["label"])
        out.append(d)
    return {"generated": R["now"].strftime("%Y-%m-%dT%H:%M:%SZ"), "window_start": R["window_start"] or R["data_start"],
            "excluded_sessions": R["excluded"], "controls": R["controls"], "trend": R["trend"],
            "movements": R["movements"], "corpus": R.get("corpus"),
            "secret_records": [a["uuid"] for a in R["acts"] if a.get("secret")], "candidates": out}


def write_outputs(P, R, draft=True):
    """The candidates file always; the draft only on run. Each is scanned whole by secret_gate before it
    is written, the second net behind secret_shaped at the source (exit 4, neither written)."""
    text = render_draft(R) if draft else ""
    body = json.dumps(candidates_json(R), ensure_ascii=False, indent=1, default=list)
    if secret_gate(text) or secret_gate(body):
        return 4, None, None
    os.makedirs(P["state"], exist_ok=True)
    day = R["now"].strftime("%Y-%m-%d")
    cj = os.path.join(P["state"], "instinct-sweep-candidates-%s.json" % day)
    fd, tmp = tempfile.mkstemp(dir=P["state"], prefix=".instinct-cands.")    # 600, like the ledger
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(body)
    os.replace(tmp, cj)
    dp = None
    if draft:
        os.makedirs(P["out"], exist_ok=True)
        dp = os.path.join(P["out"], "%s-draft.md" % day)
        with open(dp, "w", encoding="utf-8") as fh:
            fh.write(text)
    return 0, dp, cj


# ── commands ────────────────────────────────────────────────────────────────────────────────────────
def cmd_run(P, a, draft=True, now=None):
    t0 = time.time()
    since = a.since + "T00:00:00" if a.since and len(a.since) == 10 else a.since
    own = a.own_sid if hasattr(a, "own_sid") else os.environ.get("CLAUDE_CODE_SESSION_ID")
    R = pipeline(P, workers=a.workers, since=since, own_sid=own, now=now)
    print(render_coverage(R))
    if not all(c["ok"] for c in R["controls"]):
        print("\nSTOP: a control failed. Nothing written.")
        return 2, R
    led = write_ledger(P, R["acts"])
    if not corpus_step(P, R):
        print("\n" + render_corpus(R) + "\nSTOP: the corpus search is void. The owner ledger was written; nothing else.")
        return 3, R
    rc, dp, cj = write_outputs(P, R, draft=draft)
    if rc:
        print("\nSTOP: the secret shape-grep matched the rendered output; nothing but the owner ledger was written.")
        return rc, R
    print("\nledger: %s (%d acts, %d secret-shaped with their text withheld)\ncandidates: %s (%d candidates, %d held back)" % (
        os.path.relpath(led, P["repo"]), len(R["acts"]), sum(1 for a in R["acts"] if a.get("secret")),
        os.path.relpath(cj, P["repo"]), len(R["candidates"]), sum(1 for c in R["candidates"] if c.get("held"))))
    if dp:
        print("draft: %s" % os.path.relpath(dp, P["repo"]))
    print("wall %.1f s (transcript pass %.1f s, %d workers)" % (time.time() - t0, R["scan_s"], a.workers))
    return 0, R


def cmd_maintain(P, a, now=None):
    """/meta maintain member 11: the pending proposals for its approval table; steps 0-2 and 5 only when
    the newest report is older than REPORT_MAX_AGE_DAYS or absent. Writes no draft and no tracked file."""
    path, end = newest_report(P)
    rows, exists = read_ledger(P)
    pending = sorted((r for r in rows if r["status"] == "pending"), key=lambda r: (-r["sessions"], r["proposed"]))
    end_dt = ts_dt(end if end and "T" in end else (end or "") + "T00:00:00")
    elapsed = ((now or datetime.datetime.utcnow()) - end_dt) if end_dt else None
    age = elapsed.total_seconds() / 86400 if elapsed is not None else None
    print("instinct-sweep (member 11): newest report %s%s; ledger %s" % (
        os.path.relpath(path, P["repo"]) if path else "none",
        " (window-end %s, %.1f days old)" % (end, age) if age is not None else "",
        "%d rows, %d pending" % (len(rows), len(pending)) if exists else "absent"))
    for r in pending[:MAINTAIN_PENDING_CAP]:
        print("  PENDING `%s` \u2014 proposed %s, %d sessions, report %s" % (r["key"], r["proposed"], r["sessions"], r["report"] or "?"))
    if len(pending) > MAINTAIN_PENDING_CAP:
        print("  (%d more pending; at most %d go to the approval table)" % (len(pending) - MAINTAIN_PENDING_CAP,
                                                                         MAINTAIN_PENDING_CAP))
    if path and elapsed is not None and elapsed <= datetime.timedelta(days=REPORT_MAX_AGE_DAYS):
        return 0
    print("\nNewest report is %s: running steps 0-2 and 5.\n" % (
        "absent" if not path else "%.1f days old" % age if age is not None else "undated (window-end unreadable)"))
    a.since = None
    rc, R = cmd_run(P, a, draft=False, now=now)
    if rc:
        return rc
    seq = [c for c in R["candidates"] if c["kind"] == "sequence" and not c.get("held")]
    print("\nNew command-sequence candidates (>= %d sessions on >= %d days; %d in all, top 5):" % (SESSION_BAR, DAY_BAR, len(seq)))
    for c in seq[:5]:
        print("  `%s` %s: %d sessions, %d days, %s \u2192 %s" % (c["key"], c["label"], c["sessions"], c["days"], c["first"], c["last"]))
    return 0


# ── self-test ───────────────────────────────────────────────────────────────────────────────────────
D1, D2, D3 = "2026-10-05", "2026-10-06", "2026-10-08"
FX = {k: "%s-0000-4000-8000-00000000000%d" % (k, i) for i, k in enumerate(
    ("aaaaaaa1", "aaaaaaa2", "aaaaaaa3", "aaaaaaa4", "aaaaaaa5", "aaaaaaa6", "eeeeeee1", "bbbbbbb1"))}
# Planted credential shapes, assembled from parts so this file never carries one as a literal.
PLANTED = ("e" + "yJ" + "hbGciOiJIUzI1NiJ9.cGF5bG9hZHZhbHVl", "s" + "k-" + "proj-" + "Q7r2" * 6)
# One value per remaining SECRET_SHAPES entry, in the same order, each matching that shape alone.
PLANTED_MORE = ("sb_" + "secret_" + "Zx9" * 8, "pd" + "l_" + "Ab3" * 8, "r" + "e_" + "Kp4" * 8,
                "postgres" + "ql://u:" + "Pw9" * 4 + "@db.example.invalid/x", "X-" + "Amz-" + "Sig" + "a1b2" * 8,
                "-----BEG" + "IN RSA PRIVATE " + "KEY-----" + "c3d4" * 4, "sb" + "p_" + "a1b2c3d4" * 2,
                "gh" + "p_" + "Q7r2" * 4, "git" + "hub_" + "pat_" + "Q7r2" * 9, "AK" + "IA" + "QWERTYUI",
                "sn" + "trys_" + "Q7r2" * 9, "ph" + "x_" + "Q7r2" * 4, "wh" + "sec_" + "Q7r2" * 9,
                "PGPASS" + "WORD=" + "Q7r2Q7r2", "postgres" + "ql://h/db?ssl=1&pass" + "word=" + "Q7r2Q7r2",
                "disc" + "ord.com/api/web" + "hooks/" + "1234567890/" + "Q7r2" * 8)
# Boundary variants of shapes above, each of which a narrower pattern missed: a key right
# after a JSON-escaped \n (one per token-start shape, so that arm cannot go from one shape alone), a connection
# string cut before its @, an upper-case scheme, a bare host:port, a driver suffix; then every other escape
# start on one key of each boundary (pdl_ for _SB, re_ for _SBU), so no arm of _ESC can go unseen; then a password
# that starts with a slash, and each full-length shape behind a letter, where its token-start shape cannot see it.
PLANTED_EDGE = ("logs:x\\n" + "s" + "k-" + "Q7r2" * 6, "postgres" + "ql:/" + "/postgres.abcdefghij" + ":" + "Q7r2Q7r2",
                "POSTGRES" + "://u:" + "Q7r2Q7r2" + "@h/db", "pgpass" + "word: " + "Q7r2Q7r2",
                "postgres" + "://host:5432/db", "postgres" + "ql+psycopg2://u:" + "Q7r2Q7r2" + "@h/db") + tuple(
                    "logs:x\\n" + PLANTED_MORE[i] for i in (1, 2, 6, 7, 9, 11)) + tuple(
                    "logs:x" + start + PLANTED_MORE[i] for i in (1, 2)
                    for start in ("\\t", "\\r", "\\b", "\\f", "\\x0a", "\\x0A", "\\u000a", "\\u000A", "%20", "%3D", "%3d")) + (
                    "postgres" + "ql://u:/" + "Q7r2Q7r2" + "@h/db",) + tuple("x" + v for v in (
                        "s" + "k-ant-" + "Q7r2" * 11, "s" + "k-proj-" + "Q7r2" * 6, "s" + "k-admin-" + "Q7r2" * 6,
                        "s" + "k-" + "Q7r2" * 11, "AK" + "IA" + "QWERTYUI" + "ASDF1234", "gh" + "p_" + "Q7r2" * 9,
                        "pd" + "l_live_apikey_" + "Q7r2" * 6, "pd" + "l_ntfset_" + "Q7r2" * 6,
                        "r" + "e_" + "Q7r2Q7r2" + "_" + "Q7r2" * 5, "sb" + "p_" + "a1b2c3d4" * 5, "ph" + "x_" + "Q7r2" * 8))
# One value per alternative inside an entry: a scheme, a spelling or a token family dropped from an entry leaves the
# entry's own planted value matching, so the per-entry rows cannot see it.
PLANTED_ALT = ("mys" + "ql://u:" + "Q7r2Q7r2" + "@h/db", "mongodb" + "+srv://u:" + "Q7r2Q7r2" + "@h/db",
               "redis" + "://:" + "Q7r2Q7r2" + "@h:6379", "rediss" + "://u:" + "Q7r2Q7r2" + "@h:6379",
               "postgres" + "://h/db?pass" + "word=" + "Q7r2Q7r2", "postgres" + "://h/db?a=1&PASS" + "WORD=" + "Q7r2Q7r2",
               "disc" + "ordapp.com/api/web" + "hooks/" + "1234567890/" + "Q7r2" * 8,
               "PGPASS" + "WORD = " + "Q7r2Q7r2") + tuple("gh" + c + "_" + "Q7r2" * 4 for c in "ousr")
SHAPES = PLANTED + PLANTED_MORE + PLANTED_EDGE + PLANTED_ALT
NEAR_MISSES = ("task-list", "pre_compact", "postgres" + "://host/db", "ask-me", "highp_x", "mysql" + "://h/db")


def _fixture(root, hazard=False, drop_i46=False, drop_token=False, drop_area=False, drop_own_pc=False):
    repo, proj = os.path.join(root, "repo"), os.path.join(root, "projects")
    for d in (proj, os.path.join(repo, ".claude", "logs"), os.path.join(repo, ".claude", "skills", "pre-compact"),
              os.path.join(repo, ".claude", "skills", "meta"), os.path.join(repo, ".claude", "project-memory")):
        os.makedirs(d, exist_ok=True)
    recs, seq = collections.defaultdict(list), collections.Counter()

    def put(sid, day, hm, r):
        seq[sid] += 1
        r.setdefault("uuid", "%s-u%03d" % (sid[:8], seq[sid]))
        r.update(timestamp="%sT%s:00.000Z" % (day, hm), sessionId=sid)
        recs[sid].append(r)

    def typed(sid, day, hm, text, **kw):
        r = {"type": "user", "promptSource": "typed", "message": {"role": "user", "content": text}}
        r.update(kw)
        put(sid, day, hm, r)

    def cmd(sid, day, hm, name, args=""):
        put(sid, day, hm, {"type": "user", "message": {"role": "user", "content":
            "<command-name>/%s</command-name>\n<command-message>%s</command-message>\n<command-args>%s</command-args>" % (name, name, args)}})

    s1, s2, s3, s4, s5, s6 = (FX["aaaaaaa%d" % i] for i in range(1, 7))
    sx, sa = FX["eeeeeee1"], FX["bbbbbbb1"]
    for sid, day in ((s1, D1), (s2, D1), (s3, D2)):
        cmd(sid, day, "10:00", "alpha")                                  # case 1: 3 sessions, 2 days
        cmd(sid, day, "10:01", "beta")
        cmd(sid, day, "10:40", "eps2")                                   # case 6's positive twin
        cmd(sid, day, "10:41", "zeta2")
        put(sid, D1, "10:22", {"type": "user", "promptSource": "typed", "uuid": "dup-0001",   # case 5
                               "message": {"role": "user", "content": "copied words travel far"}})
        typed(sid, day, "11:00", "token %s here" % PLANTED[0])           # case 7: two credential shapes
        typed(sid, day, "11:05", "use %s for the run" % PLANTED[1])
        # case 10: one record of every other population this script reads, 3 sessions on 2 days
        put(sid, day, "09:00", {"type": "system", "subtype": "local_command",           # (d) a built-in
                                "content": "<command-name>/model</command-name>\n<command-args>opus</command-args>"})
        cmd(sid, day, "11:30", "explain", '"the readout text" what does it mean')      # (e) UNSPLIT, re-expl.
        typed(sid, day, "11:31", '"UNSPLITPHRASE of the assistant" and then my own words')   # (a) UNSPLIT
        # the header spelled out, never SIDE_NOTE_HEAD: a fixture that reads a global the mutation swaps
        # moves in step with it, and the mutation goes vacuous
        typed(sid, day, "11:32", "Here is a note offered by a side agent:\n> PASTEDPHRASE from the agent\n"
              "my reply under the note")
        typed(sid, day, "11:33", "MACHINEPHRASE a peer wrote", turnOrigin="peer")
        typed(sid, day, "11:34", "long " * 130 + sid[7])                 # case 5: over 600 bytes, one word apart
        put(sid, day, "11:40", {"type": "assistant", "message": {"content": [
            {"type": "tool_use", "id": "toolu_q" + sid[7], "name": "AskUserQuestion", "input": {}}]}})
        put(sid, day, "11:40", {"type": "user", "toolUseResult": {
            "questions": [{"question": "Which?", "options": [{"label": "A"}, {"label": "B"}]}],
            "answers": {"Which?": "use the staging copy instead"}}, "message": {"content": [
                {"type": "tool_result", "tool_use_id": "toolu_q" + sid[7], "content": "answered"}]}})   # (f)
        put(sid, day, "11:50", {"type": "user", "toolDenialKind": "user-rejected", "message": {"content": [
            {"type": "tool_result", "tool_use_id": "toolu_r" + sid[7], "content": "rejected"},
            {"type": "text", "text": "the user said:\nnot that file use the other one"}]}})    # (g)
        put(sid, day, "11:50", {"type": "user", "message": {"content": [
            {"type": "text", "text": "[Request interrupted by user for tool use]"}]}})      # (i), folded
    for i, value in enumerate(PLANTED_MORE + PLANTED_EDGE + PLANTED_ALT):             # case 7: every other shape
        typed(s1, D1, "12:%02d" % i, "here %s it is" % value)
    put(s4, D3, "12:00", {"type": "user", "message": {"content": [
        {"type": "text", "text": "[Request interrupted by user]"}]}})       # (i), standalone
    for sid, day in ((s1, D1), (s3, D2)):
        cmd(sid, day, "10:10", "gamma")                                  # case 2: 2 sessions, 2 days
        cmd(sid, day, "10:11", "delta")
    for sid in (s1, s2):
        cmd(sid, D1, "10:30", "eps")                                     # case 6: + the excluded session
        cmd(sid, D1, "10:31", "zeta")
    for sid in (s1, s2, s6):
        cmd(sid, D1, "10:50", "theta")                                   # case 2b: 3 sessions, 1 day
        cmd(sid, D1, "10:51", "iota")
    cmd(sx, D2, "10:30", "eps")
    cmd(sx, D2, "10:31", "zeta")
    for sid, day in ((s1, D1), (s2, D1), (s3, D2), (s4, D3), (s5, D3)):
        typed(sid, day, "10:20", '"the readout said QUOTEDPHRASE here" - %s' % (
            "Ok  go." if sid == s5 else "ok go"))                       # case 3; case, spacing and outer punctuation fold
    for sid, day in ((s1, D1), (s2, D1), (s3, D2), (s4, D3)):
        typed(sid, day, "10:21", "sidechain words should never count", isSidechain=True)   # case 4
    if not drop_i46:
        typed(FX["aaaaaaa4"], "2026-10-14", "15:11", "a planted ask that names usage patterns and a command")
        recs[FX["aaaaaaa4"]][-1]["timestamp"] = "2026-10-14T15:11:23.000Z"
    # the AUTO run: the hook's line, then the seat's Skill call and its records
    put(sa, D2, "12:00", {"type": "attachment", "attachment": {"type": "hook_additional_context",
                                                                "content": ["\u23f3 AUTO PRE-COMPACT \u2014 context is at 700,000"]}})
    put(sa, D2, "12:01", {"type": "assistant", "message": {"content": [
        {"type": "tool_use", "id": "toolu_x1", "name": "Skill", "input": {"skill": "pre-compact"}}]}})
    put(sa, D2, "12:01", {"type": "user", "message": {"content": [
        {"type": "tool_result", "tool_use_id": "toolu_x1", "content": "Launching skill: pre-compact"}]}})
    put(sa, D2, "12:01", {"type": "user", "isMeta": True, "sourceToolUseID": "toolu_x1",
                          "message": {"content": [{"type": "text", "text": "Base directory for this skill"}]}})
    if hazard:   # what a harness writing the Skill run as a slash-command record would look like
        cmd(sa, D2, "12:01", "pre-compact")
    if not drop_own_pc:                                                  # case C2b: none of his own
        cmd(sa, D2, "15:00", "pre-compact", "--disarm")                  # his own, far from the AUTO run
    put(FX["aaaaaaa5"], D3, "14:00", {"type": "attachment", "attachment": {"type": "hook_additional_context",
                                      "content": ["\u23f3 AUTO PRE-COMPACT \u2014 context is at 700,000"]}})
    put(FX["aaaaaaa5"], D3, "14:01", {"type": "assistant", "isSidechain": True, "message": {"content": [   # C2: a
        {"type": "tool_use", "id": "toolu_x2", "name": "Skill", "input": {"skill": "pre-compact"}}]}})    # sub-agent's
    if not drop_own_pc:                                                  # Skill call is no AUTO run of his seat
        cmd(FX["aaaaaaa5"], D3, "14:01", "pre-compact")
    for sid in ("7000" + "0000-0000-4000-8000-000000000009",):           # case 6: EXCLUDE_ALWAYS
        cmd(sid, D3, "10:30", "eps")
        cmd(sid, D3, "10:31", "zeta")
    for sid, day in ((s1, D1), (s2, D1), (s3, D2)):                      # case 10i: an argument on half
        cmd(sid, day, "16:00", "kappa", "fast")                          # the runs is no habit
        cmd(sid, day, "17:00", "kappa")
        cmd(sid, day, "18:00", "summary", "what changed")                # case 10h: unquoted, no defect
    put(s1, D1, "09:00", {"type": "user", "uuid": "sec-cmd", "message": {"role": "user", "content":   # case 7c
        "<command-name>/foo</command-name>\n<command-message>foo</command-message>\n<command-args>%s</command-args>"
        % PLANTED[1]}})
    put(s1, D1, "09:02", {"type": "user", "uuid": "sec-flag", "message": {"role": "user", "content":  # case 7c
        "<command-name>/foo</command-name>\n<command-message>foo</command-message>\n<command-args>-%s</command-args>"
        % PLANTED[1]}})                                                    # the key typed as a flag
    typed(s1, D1, "09:05", '"your key %s is wrong" - fix it' % PLANTED[0], uuid="sec-quoted")     # case 7c
    put(s1, D1, "09:06", {"type": "user", "uuid": "sec-name", "message": {"role": "user", "content":  # case 7c
        "<command-name>/%s</command-name>\n<command-message>x</command-message>\n<command-args></command-args>"
        % PLANTED[1]}})                                                    # the key sent as a command name
    typed(s1, D1, "09:07", "> the log said %s\nlook at this" % PLANTED[0], uuid="sec-pasted")     # case 7c
    put(s1, D1, "09:08", {"type": "assistant", "message": {"content": [
        {"type": "tool_use", "id": "toolu_qsec", "name": "AskUserQuestion", "input": {}}]}})
    put(s1, D1, "09:08", {"type": "user", "uuid": "sec-choice", "toolUseResult": {                  # case 7c
        "questions": [{"question": "Which?", "options": [{"label": PLANTED[1]}, {"label": "B"}]}],
        "answers": {"Which?": PLANTED[1]}}, "message": {"content": [
            {"type": "tool_result", "tool_use_id": "toolu_qsec", "content": "answered"}]}})
    files = {sid: rs for sid, rs in recs.items()}
    files[FX["aaaaaaa4"].replace("aaaaaaa4", "10000000")] = files.pop(FX["aaaaaaa4"])
    for sid, rs in files.items():
        with open(os.path.join(proj, sid + ".jsonl"), "w") as fh:
            for r in sorted(rs, key=lambda x: x["timestamp"]):          # stable: same-second order kept
                # compact separators, as the harness writes them: the byte prefilter keys on that form
                fh.write(json.dumps(dict(r, sessionId=sid), separators=(",", ":")) + "\n")
    with open(os.path.join(repo, ".claude", "logs", "skill-invocations.jsonl"), "w") as fh:
        fh.write(json.dumps({"ts": D2 + "T10:29:00Z", "skill": "instinct-sweep", "args": "", "session": sx,
                             "source": "user-prompt"}) + "\n")
    corpus = {".claude/skills/pre-compact/SKILL.md": "run it as `/pre-compact%s` before /compact\n" % (
                  "" if drop_token else " --disarm"),
              "IDEAS.md": "I46 usage patterns\n", "todo.txt": "- [ ] ROW-A\n",
              "DECISIONS.md": "## 2026-10-01\n", ".claude/project-memory/x.md": "a memory\n",
              ".claude/meta-corrections-registry.md": "a correction\n", ".claude/skills/meta/MEMORY.md": "router\n"}
    if not drop_area:                                                    # case 11: a required area empty
        corpus["BACKLOG.md"] = "#1 a thing\n"
    for rel, text in corpus.items():
        with open(os.path.join(repo, rel), "w") as fh:
            fh.write(text)
    out = os.path.join(repo, "plans", "instinct-sweep")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "ledger.md"), "w") as fh:
        fh.write("| key | proposed | sessions | status | answered | his words | report |\n|---|---|---|---|---|---|---|\n"
                 "| `seq2:/alpha>/beta` | 2026-10-01 | 2 | No | 2026-10-02 | not now | 2026-10-01.md |\n"   # case 8: held
                 "| `seq2:/eps2>/zeta2` | 2026-10-01 | 1 (2026-10-01) | no | 2026-10-02 | no | 2026-10-01.md |\n")  # doubled: raised
        for i, s in enumerate((6, 9, 8, 7)):                                                   # case 9: 4 pending
            fh.write("| `seq2:/p%d>/q%d` | 2026-10-01 | %d | pending |  |  | 2026-10-01.md |\n" % (i, i, s))
    with open(os.path.join(out, "2026-10-19.md"), "w") as fh:
        fh.write("# /instinct-sweep 2026-10-19\n\nwindow-start: 2026-10-01T00:00:00\nwindow-end: 2026-10-19T00:00:00Z\n")
    with open(os.path.join(out, "2026-11-30-draft.md"), "w") as fh:     # case 9b: a draft is never the newest
        fh.write("# DRAFT\n\nwindow-end: 2026-11-30T00:00:00Z\n")
    return paths(repo, proj, git=False)


def _run_fixture(draft=True, **kw):
    """One whole pipeline on fresh planted fixtures in a mktemp -d, in-process (one worker); every output
    it writes lands in that directory, is read back, and the directory is removed."""
    root = tempfile.mkdtemp(prefix="instinct-sweep-selftest-")
    try:
        P = _fixture(root, **kw)
        # workers=1 is load-bearing: the mutation table swaps module globals, which a spawned worker never sees.
        R = pipeline(P, workers=1, own_sid=None, now=datetime.datetime(2026, 10, 20))
        out = {"R": R, "controls_ok": all(c["ok"] for c in R["controls"]), "corpus_ok": None, "rc": None,
               "draft": "", "ledger": "", "cands": ""}
        if out["controls_ok"]:
            with open(write_ledger(P, R["acts"]), encoding="utf-8") as fh:
                out["ledger"] = fh.read()
            out["corpus_ok"] = corpus_step(P, R)
            if out["corpus_ok"]:
                out["rc"], dp, cj = write_outputs(P, R, draft=draft)
                for key, p in (("draft", dp), ("cands", cj)):
                    if p:
                        with open(p, encoding="utf-8") as fh:
                            out[key] = fh.read()
        return out
    finally:
        shutil.rmtree(root, ignore_errors=True)


def _cases(o):
    R = o["R"]
    keys = {c["key"] for c in R["candidates"]}
    his = [a for a in R["acts"]]
    labels = " ".join(c["label"].lower() for c in R["candidates"])
    ok = next((c for c in R["candidates"] if c["kind"] == "repeat" and c["label"] == "ok go"), None)
    sec = [a for a in his if a.get("secret")]
    planted = [p.lower() for p in SHAPES]          # norm() lowercases argval, so compare case-insensitively
    led, out = o["ledger"].lower(), (o["draft"] + o["cands"]).lower()
    reps = {c["label"] for c in R["candidates"] if c["kind"] == "repeat"}
    said = " ".join((a["his"] or "").lower() for a in his)

    def hold(*statuses):                           # the rows of one key, oldest first, against a count of 99
        return ledger_hold({"key": "k", "sessions": 99}, [
            {"key": "k", "status": s, "sessions": 1, "proposed": "2026-10-01", "answered": ""} for s in statuses]) or ""

    return collections.OrderedDict([
        ("1 a sequence in 3 sessions on 2 days is found", "seq2:/alpha>/beta" in keys),
        ("2 the same in 2 sessions is not", "seq2:/gamma>/delta" not in keys),
        ("2b the same in 3 sessions on 1 day is not", "seq2:/theta>/iota" not in keys),
        ("3 a phrase quoted back 5 times is not his", not any("quotedphrase" in (a["his"] or "").lower() for a in his)
         and "quotedphrase" not in labels and bool(ok) and ok["sessions"] == 5),
        ("4 a sidechain record is not his", not any("sidechain words" in (a["his"] or "") for a in his)),
        ("5 a duplicated record uuid counts once", sum(1 for a in his if a["uuid"] == "dup-0001") == 1
         and not any(x.startswith("long long") for x in reps)),
        ("6 a session that ran this command is excluded", "seq2:/eps>/zeta" not in keys and "seq2:/eps2>/zeta2" in keys),
        ("7a a secret-shaped owner record is counted and kept out of the ledger",
         len(sec) == 3 * len(PLANTED) + len(PLANTED_MORE) + len(PLANTED_EDGE) + len(PLANTED_ALT) + 6 and bool(led)
         and not any(p in led for p in planted)),
        ("7b the draft is written and no planted value reaches it", o["rc"] == 0 and bool(o["draft"]) and not any(
            p in out for p in planted) and "[withheld: secret-shaped text]" in o["draft"]),
        ("7c a credential in a command's name, args, flags, a QUOTED or PASTED half or a chosen option is withheld", {a["uuid"] for a in sec} >= {
            "sec-cmd", "sec-flag", "sec-quoted", "sec-name", "sec-pasted", "sec-choice"} and all(PLANTED[i].lower() not in json.dumps(
                [a for a in his if a["uuid"] == u]).lower()
                for i, u in ((1, "sec-cmd"), (1, "sec-flag"), (0, "sec-quoted"), (1, "sec-name"), (0, "sec-pasted"),
                             (1, "sec-choice")))),
        ("7d each credential shape trips both nets; near misses do not", all(
            secret_shaped(x) and secret_gate(x) for x in SHAPES) and not any(secret_shaped(x) for x in NEAR_MISSES)),
        ("8 a key the ledger marks no is held until its sessions double", bool(o["corpus_ok"]) and any(
            c["key"] == "seq2:/alpha>/beta" and (c.get("held") or "").startswith("ledger: no") for c in R["candidates"])
         and any(c["key"] == "seq2:/eps2>/zeta2" and not c.get("held") for c in R["candidates"])
         and hold("pending").startswith("ledger: proposed") and hold("yes").startswith("ledger: yes")
         and hold("yes", "no") == ""),                                  # the newest row of a key decides
        ("C1 control finds the I46 record", R["controls"][0]["ok"]),
        ("C2 control: the AUTO /pre-compact is not his", R["controls"][1]["ok"]),
        ("corpus control hits the planted token", o["corpus_ok"] is True),
        ("10a (d) a built-in command's argument is read", "args:/model opus" in keys),
        ("10b (f) a free-text answer is his", "use the staging copy instead" in reps),
        ("10c (g) the words of a refusal are his", "not that file use the other one" in reps),
        ("10d (i) an interrupt is read, and folded into the refusal it follows", R["folded"] == 3 and sum(
            1 for a in his if a["kind"] == "interrupt") == 1 and sum(r["turns"] for r in R["trend"]) == sum(
                1 for a in R["live"] if a["kind"] != "interrupt")),         # and an interrupt is no turn
        ("10e an UNSPLIT message is QUOTED whole", "unsplitphrase" not in said and sum(
            1 for a in his if a["pop"] == "a" and a["split"] == "unsplit") == 3),
        ("10f PASTED lines and the side-agent header are not his", "pastedphrase" not in said
         and "my reply under the note" in reps),
        ("10g a typed record with a machine turnOrigin is not his", "machinephrase" not in said),
        ("10h a re-explanation of quoted text is filed as a readout defect", "reexplain:/explain" in keys
         and "reexplain:/summary" not in keys),
        ("10i an argument on half the runs of a command is not a habit", "args:/kappa fast" not in keys
         and "fast" not in reps),                                       # and a command's argument is no typed repeat
    ])


def _maintain_out(now, drafts=False, end=None):
    """cmd_maintain on fresh fixtures (a report dated 2026-10-19, four pending ledger rows), stdout captured.
    drafts: a newer draft and a -draft-v2 re-roll, each with a window-end, beside that report.
    end: that report's window-end, rewritten."""
    root = tempfile.mkdtemp(prefix="instinct-sweep-selftest-")
    try:
        P = _fixture(root)
        if end:                                                          # the report's window-end, rewritten
            with open(os.path.join(P["out"], "2026-10-19.md"), "w") as fh:
                fh.write("# r\n\nwindow-start: 2026-10-01T00:00:00\nwindow-end: %s\n" % end)
        for name in (("2026-11-30-draft.md", "2026-11-30-draft-v2.md") if drafts else ()):
            with open(os.path.join(P["out"], name), "w") as fh:
                fh.write("# draft\n\nwindow-end: 2026-11-30T00:00:00Z\n")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = cmd_maintain(P, argparse.Namespace(since=None, workers=1, own_sid=None), now=now)
        return rc, buf.getvalue()
    finally:
        shutil.rmtree(root, ignore_errors=True)


def _all_cases(**fx):
    cases = _cases(_run_fixture(**fx))
    rc, out = _maintain_out(datetime.datetime(2026, 10, 20))
    cases["9 maintain lists at most 3 pending and skips the steps under 30 days"] = (
        rc == 0 and out.count("  PENDING ") == 3 and "(1 more pending" in out and "running steps" not in out
        and "seq2:/p0>" not in out)                                     # the cap keeps the most sessions
    rc, out = _maintain_out(datetime.datetime(2026, 12, 1))
    cases["9b maintain runs steps 0-2 and 5 when the newest report is over 30 days old"] = (
        rc == 0 and "running steps" in out and "seq2:/eps2>/zeta2" in out and "seq2:/alpha>/beta" not in out)
    cases["11 an empty required corpus area voids the search"] = _run_fixture(drop_area=True)["corpus_ok"] is False
    rc, out = _maintain_out(datetime.datetime(2026, 12, 1), drafts=True)
    cases["9c a newer draft or -draft-v2 never counts as the newest report"] = (
        rc == 0 and "running steps" in out and "2026-10-19.md" in out)
    rc, made = _cmd_run_files(drop_i46=True)
    cases["12 run stops before any write when a control fails"] = rc == 2 and not made
    rc, made = _cmd_run_files(drop_token=True)
    cases["12b run stops after the owner ledger when the corpus search is void"] = (
        rc == 3 and made == {"instinct-owner-ledger.jsonl 600"})
    rc, made = _cmd_run_files()
    cases["12c run writes the ledger and candidates file (mode 600) and the draft"] = rc == 0 and made == {
        "instinct-owner-ledger.jsonl 600", "instinct-sweep-candidates-2026-10-20.json 600", "2026-10-20-draft.md"}
    return cases


def _exit_code(argv, entry=None):
    """main(argv), or entry(argv), with its output swallowed; an exit argparse raises itself comes back as its
    code. paths() is refused for the call, so a change to main's modes reds this case and cannot reach the real
    repo."""
    def refuse(*a, **k):
        raise SystemExit("paths() reached from a self-test")
    g, real = globals(), paths
    g["paths"] = refuse
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            try:
                return (entry or main)(argv)
            except SystemExit as e:
                return e.code
    finally:
        g["paths"] = real


def _trend(values, key="cmd_pct", change=None, created=None, incomplete=(), base=(10, 11, 9, 10), field="status"):
    """action_rule over weeks of one metric: 4 baseline weeks, then `values`, each complete unless its position
    is in `incomplete`, and `change` logged in the last week alone. That `field` of each finding."""
    weeks = list(base) + list(values)
    rows = [dict({k: None for _, k in TREND_METRICS}, week="2026-W%02d" % (30 + i), complete=i - 4 not in incomplete,
                 changes_tx=[change] if change and i == len(weeks) - 1 else [], **{key: v}) for i, v in enumerate(weeks)]
    return [m[field] for m in action_rule(rows, created)]


def _once_cases():
    """Cases no mutation row guards, run once beside the unmutated cases, so they add no cost per mutation."""
    cases = collections.OrderedDict()
    skip = _maintain_out(datetime.datetime(2026, 11, 24), end="2026-10-25T00:00:00Z")      # exactly 30 days
    run = _maintain_out(datetime.datetime(2026, 11, 24, 10), end="2026-10-25T00:00:00Z")   # 30 days 10 hours
    cases["9d maintain reads the window-end, not the file name, and 30 days is elapsed time"] = (
        skip[0] == 0 and "running steps" not in skip[1] and run[0] == 0 and "30.4 days old: running steps" in run[1])
    rc, out = _maintain_out(datetime.datetime(2026, 11, 1), end="not a date")
    cases["9f a report with no dated window-end line is dated by its file name"] = (
        rc == 0 and "window-end 2026-10-19, 13.0 days old" in out and "running steps" not in out)
    rc, out = _maintain_out(datetime.datetime(2026, 11, 1), end="2026-13-01")
    cases["9e an unreadable window-end runs the steps, marked undated"] = (
        rc == 0 and "undated" in out and "running steps" in out)
    cases["C2b the AUTO control is void when none of his own /pre-compact is seen"] = not _run_fixture(
        drop_own_pc=True)["R"]["controls"][1]["ok"]
    cases["13 a bad mode or no mode exits 1"] = _exit_code(["bogus"]) == 1 and _exit_code([]) == 1 and _exit_code(
        [], lambda argv: paths()) == "paths() reached from a self-test"
    with tempfile.NamedTemporaryFile("w", suffix=".md") as bad, tempfile.NamedTemporaryFile("w", suffix=".md") as ok:
        bad.write("a report\n%s\n" % PLANTED_MORE[0])
        ok.write("a report\n")
        bad.flush()
        ok.flush()
        cases["13b --gate refuses a shaped report and passes a clean one"] = (
            _exit_code(["--gate", bad.name]) == 4 and _exit_code(["--gate", ok.name]) == 0)
    rc, made = _cmd_run_files(stale=True)
    cases["12d a state file left at 644 comes back 600"] = rc == 0 and made >= {
        "instinct-owner-ledger.jsonl 600", "instinct-sweep-candidates-2026-10-20.json 600"}
    two, era = [20, 40], {"post-compact": "2026-07-20T10:00:00"}                 # the baseline's first day
    cases["14 a trend moves on 2 weeks outside its baseline; a logging change or a new command holds it"] = (
        _trend([11, 11]) == [] and _trend([20]) == ["observation (one week)"]
        and _trend(two)[0].startswith("MOVEMENT")
        and _trend(two, change="pop b")[0].startswith("HELD: transcript logging change")
        and _trend(two, key="recovered_pct", created=era)[0].startswith("HELD: era change")
        and " ".join(_trend([0, -40])).startswith("MOVEMENT")               # downward counts too
        and " ".join(_trend([12, 20])).startswith("MOVEMENT")               # 12 is outside 2 SD, inside 3
        and _trend([20, 1]) == ["observation (one week)"] * 2               # opposite directions are no run
        and _trend(two, incomplete=(1,)) == ["observation (one week)"]      # an incomplete week is no week
        and " ".join(_trend(two, key="recovered_pct", created={"post-compact": "2026-01-05T10:00:00"})
                     ).startswith("MOVEMENT")                               # older than its baseline: no era change
        and _trend(two, key="recovered_pct", created={"post-compact": "2026-08-25T10:00:00"}
                   )[0].startswith("HELD: era change")                      # created in the run's last week
        and _trend(two, key="recovered_pct", change="pop b", created=era)[0].startswith("HELD: era change")
        and _trend([20, 40], base=(10, 11, 9)) == ["observation (one week)"]   # a baseline is 4 weeks, never 3
        and _trend(two, key="recovered_pct", created={"post-compact": "2026-08-30T10:00:00"})[0].startswith("HELD: era")
        and _trend(two, key="recovered_pct", created={"post-compact": "2026-08-31T10:00:00"})[0].startswith("MOVEMENT")
        and _trend(two, created=era)[0].startswith("MOVEMENT")              # this metric counts no such command
        and _trend(two, field="direction") == ["up"] and _trend([0, -40], field="direction") == ["down"]
        and _trend([11.5, 11.5]) == []                                      # inside 2 sample SD, outside 1.8 or 2 pop
        and _trend([12, 12.8]) == ["observation (one week)"]                # outside 5 prior weeks' band, inside 4's
        and _trend([None, 20, 40]) == []                                    # a short baseline flags nothing
        and build_trend([], [{"ts": "2026-10-06T10:00:00", "sid": "s", "line": 1, "kind": "typed"}], None, {},
                        datetime.datetime(2026, 10, 20), datetime.date(2026, 10, 6))[0][0]["complete"] is False)
    return cases


def _cmd_run_files(stale=False, **fx):
    """cmd_run itself on fresh fixtures: its rc and the files it created (each state file with its mode).
    stale: both state files already there at 644, as a run from before the 600 rule left them."""
    root = tempfile.mkdtemp(prefix="instinct-sweep-selftest-")
    try:
        P = _fixture(root, **fx)
        before_out = set(os.listdir(P["out"])) if os.path.isdir(P["out"]) else set()
        before_state = set(os.listdir(P["state"])) if os.path.isdir(P["state"]) else set()
        for n in (("instinct-owner-ledger.jsonl", "instinct-sweep-candidates-2026-10-20.json") if stale else ()):
            os.makedirs(P["state"], exist_ok=True)
            with open(os.path.join(P["state"], n), "w") as fh:
                fh.write("old\n")
            os.chmod(os.path.join(P["state"], n), 0o644)
        with contextlib.redirect_stdout(io.StringIO()):
            rc = cmd_run(P, argparse.Namespace(since=None, workers=1, own_sid=None),
                         now=datetime.datetime(2026, 10, 20))[0]
        made = set(n for n in os.listdir(P["out"]) if n not in before_out) if os.path.isdir(P["out"]) else set()
        if os.path.isdir(P["state"]):
            for n in os.listdir(P["state"]):
                if n in before_state:
                    continue
                mode = os.stat(os.path.join(P["state"], n)).st_mode & 0o777
                made.add(n + " 600" if mode == 0o600 else n)
        return rc, made
    finally:
        shutil.rmtree(root, ignore_errors=True)


def _idx_shim(pop=None, old=None, new=None, **attrs):
    """The shared classifier as a change to post-compact-recovery-index.py could leave it: key `old`
    renamed to `new` in its `pop` entries, or a constant replaced. The contract mutations swap it in for IDX."""
    import types
    base = IDX.classify_record
    shim = types.SimpleNamespace(**{k: getattr(IDX, k) for k in dir(IDX) if not k.startswith("__")})
    shim.__dict__.update(attrs)
    if pop:
        shim.classify_record = lambda r, ask_ids, tool_names: [
            dict(((new if k == old else k), v) for k, v in e.items()) if e.get("pop") == pop else e
            for e in base(r, ask_ids, tool_names)]
    return shim


def self_test():
    g = globals()
    base = _all_cases()
    base.update(_once_cases())
    print("CASES (unmutated)")
    for name, ok in base.items():
        print("  %s %s" % ("ok  " if ok else "FAIL", name))
    muts = [
        ("SESSION_BAR 3 -> 2", {"SESSION_BAR": 2}, {}, "2 the same in 2 sessions is not"),
        ("DAY_BAR 2 -> 1", {"DAY_BAR": 1}, {}, "2b the same in 3 sessions on 1 day is not"),
        ("PAIR_WINDOW_S 1800 -> 0", {"PAIR_WINDOW_S": 0}, {}, "1 a sequence in 3 sessions on 2 days is found"),
        ("split_text: no quote split", {"split_text": lambda t, r, u: ((t or "").strip(), "", "", "none")}, {},
         "3 a phrase quoted back 5 times is not his"),
        ("keep_record: sidechains kept", {"keep_record": lambda r: True}, {}, "4 a sidechain record is not his"),
        ("dedupe: off", {"dedupe": lambda results: 0}, {}, "5 a duplicated record uuid counts once"),
        ("excluded_sids: none", {"excluded_sids": lambda P, own_sid=None: set()}, {},
         "6 a session that ran this command is excluded"),
        ("secret_shaped: off (the source filter)", {"secret_shaped": lambda t: False}, {},
         "7a a secret-shaped owner record is counted and kept out of the ledger"),
        ("secret_shaped and secret_gate both off", {"secret_shaped": lambda t: False, "secret_gate": lambda t: False},
         {}, "7b the draft is written and no planted value reaches it"),
        ("fixture: a /pre-compact record inside the AUTO run", {}, {"hazard": True}, "C2 control: the AUTO /pre-compact is not his"),
        ("fixture: the I46 record removed", {}, {"drop_i46": True}, "C1 control finds the I46 record"),
        ("fixture: the planted corpus token removed", {}, {"drop_token": True}, "corpus control hits the planted token"),
        ("ledger_hold: never holds", {"ledger_hold": lambda c, rows: None}, {},
         "8 a key the ledger marks no is held until its sessions double"),
        ("MAINTAIN_PENDING_CAP 3 -> 10", {"MAINTAIN_PENDING_CAP": 10}, {},
         "9 maintain lists at most 3 pending and skips the steps under 30 days"),
        ("REPORT_MAX_AGE_DAYS 30 -> 100", {"REPORT_MAX_AGE_DAYS": 100}, {},
         "9b maintain runs steps 0-2 and 5 when the newest report is over 30 days old"),
        ("REPORT_NAME: any dated .md counts", {"REPORT_NAME": re.compile(r"\d{4}-\d{2}-\d{2}.*\.md\Z")}, {},
         "9c a newer draft or -draft-v2 never counts as the newest report"),
        ("SECRET_SHAPE: no escaped-newline token start", {"SECRET_SHAPE": re.compile("|".join(
            x.replace(r"|(?<=\\[ntr])", "") for x in SECRET_SHAPES))}, {},
         "7d each credential shape trips both nets; near misses do not"),
        ("newest_report: the draft counts", {"newest_report": lambda P: (
            os.path.join(P["out"], "2026-11-30-draft.md"), "2026-11-30T00:00:00")}, {},
         "9b maintain runs steps 0-2 and 5 when the newest report is over 30 days old"),
        ("classifier drift: (d) args renamed", {"IDX": _idx_shim("d", "args", "arguments")}, {},
         "10a (d) a built-in command's argument is read"),
        ("HABIT_SHARE 0.5 -> 1.0", {"HABIT_SHARE": 1.0}, {}, "10a (d) a built-in command's argument is read"),
        ("classifier drift: (f) answers renamed", {"IDX": _idx_shim("f", "answers", "answer_list")}, {},
         "10b (f) a free-text answer is his"),
        ("classifier drift: (g) user_said renamed", {"IDX": _idx_shim("g", "user_said", "said")}, {},
         "10c (g) the words of a refusal are his"),
        ("classifier drift: (a) rulings renamed", {"IDX": _idx_shim("a", "rulings", "splits")}, {},
         "3 a phrase quoted back 5 times is not his"),
        ("classifier drift: (e) text renamed", {"IDX": _idx_shim("e", "text", "argtext")}, {},
         "10h a re-explanation of quoted text is filed as a readout defect"),
        ("interrupt_text: never", {"interrupt_text": lambda r: None}, {},
         "10d (i) an interrupt is read, and folded into the refusal it follows"),
        ("fold_interrupts: off", {"fold_interrupts": lambda res: 0}, {},
         "10d (i) an interrupt is read, and folded into the refusal it follows"),
        ("split_text: UNSPLIT read as his", {"split_text": lambda t, r, u: real["split_text"](t, r, False)}, {},
         "10e an UNSPLIT message is QUOTED whole"),
        ("PASTED_LINE: matches nothing", {"PASTED_LINE": re.compile(r"(?!)")}, {},
         "10f PASTED lines and the side-agent header are not his"),
        ("SIDE_NOTE_HEAD: never matches", {"SIDE_NOTE_HEAD": "(no such header)"}, {},
         "10f PASTED lines and the side-agent header are not his"),
        ("classifier: no machine turnOrigins", {"IDX": _idx_shim(MACHINE_TURN_ORIGINS=frozenset())}, {},
         "10g a typed record with a machine turnOrigin is not his"),
        ("REEXPLAIN: empty", {"REEXPLAIN": ()}, {}, "10h a re-explanation of quoted text is filed as a readout defect"),
        ("EXCLUDE_ALWAYS: empty", {"EXCLUDE_ALWAYS": ()}, {}, "6 a session that ran this command is excluded"),
        ("HABIT_SHARE 0.5 -> 0.0", {"HABIT_SHARE": 0.0}, {}, "10i an argument on half the runs of a command is not a habit"),
        ("OPTIONAL_AREAS: backlog optional", {"OPTIONAL_AREAS": ("ledger", "backlog")}, {},
         "11 an empty required corpus area voids the search"),
    ] + [("SECRET_SHAPE without shape %d (%s)" % (i, s[-12:]), {"SECRET_SHAPE": re.compile(
        "|".join(x for j, x in enumerate(SECRET_SHAPES) if j != i))}, {},
        "7a a secret-shaped owner record is counted and kept out of the ledger") for i, s in enumerate(SECRET_SHAPES)]
    real = {k: g[k] for _, patch, _, _ in muts for k in patch}
    real["secret_shaped"] = g["secret_shaped"]
    print("\nMUTATIONS (each must turn its case red)")
    print("  | mutation | case it guards | that case | verdict |")
    print("  |---|---|---|---|")
    killed = 0
    for name, patch, fx, case in muts:
        g.update(patch)
        try:
            got = _all_cases(**fx)
        finally:
            g.update(real)
        red = not got[case]
        killed += red
        print("  | %s | %s | %s | %s |" % (name, case, "RED" if red else "green", "killed" if red else "SURVIVED"))
    # the second net alone: with the source filter off, secret_gate must refuse to write either output
    g["secret_shaped"] = lambda t: False
    try:
        gate = _run_fixture()
        gate_body = _run_fixture(draft=False)
        gate_rc, gate_made = _cmd_run_files()                 # and cmd_run itself exits 4, the ledger alone written
    finally:
        g.update(real)
    gate_ok = (gate["rc"] == 4 and not gate["draft"] and not gate["cands"] and gate_body["rc"] == 4
               and not gate_body["cands"] and gate_rc == 4 and gate_made == {"instinct-owner-ledger.jsonl 600"})
    print("  | secret_shaped off, secret_gate kept | the second net | %s | %s |" % (
        "refused (rc 4), nothing written" if gate_ok else "rc %r" % gate["rc"], "held" if gate_ok else "FAILED"))
    passed = all(base.values()) and killed == len(muts) and gate_ok
    print("\nself-test: %d/%d cases, %d/%d mutations killed, gate %s \u2014 %s" % (
        sum(base.values()), len(base), killed, len(muts), "held" if gate_ok else "FAILED", "PASS" if passed else "FAIL"))
    return 0 if passed else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description="The instrument behind /instinct-sweep v2.")
    ap.add_argument("mode", nargs="?", choices=("run", "maintain"))
    ap.add_argument("--since", help="YYYY-MM-DD: 'new since' starts here instead of the newest report's window-end")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--gate", metavar="FILE", help="the secret shapes over a finished report: 0 clean, 4 refused; prints no text")
    try:
        a = ap.parse_args(argv)
    except SystemExit as e:              # argparse exits 2, which here means "a control failed"
        return 0 if e.code in (0, None) else 1
    if a.self_test:
        return self_test()
    if a.gate:
        with open(a.gate, encoding="utf-8", errors="replace") as fh:
            hit = secret_gate(fh.read())
        print("secret gate: %s" % ("REFUSED" if hit else "clean"))
        return 4 if hit else 0
    if not a.mode:
        ap.print_help()
        return 1
    P = paths()
    if a.mode == "run":
        return cmd_run(P, a)[0]
    return cmd_maintain(P, a)


if __name__ == "__main__":
    sys.exit(main())
