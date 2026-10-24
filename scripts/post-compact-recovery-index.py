#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Incremental index for /post-compact.

WHY: every recovery re-walked the whole session transcript from byte zero. On a long
session that is hundreds of megabytes re-read per compaction, and this session has
compacted 164 times. Nothing cached what the previous run had already derived.

WHAT: caches the byte offset it has scanned to, plus the derived positions the recovery
needs, in .claude/state/post-compact-index-<sid8>.json. Each run seeks to the cached
offset and reads only what arrived since.

It also answers the triage question the recovery now asks first: did the window this
compaction ATE contain any owner speech? That window is between the previous compaction
summary and the newest one. Zero owner records in it means the hand-off state was never
in the deleted region, so the recovery can be a short confirmation instead of a full
reconstruction.

⛔ THE CACHE IS AN OPTIMISATION, NEVER AN ORACLE. It rebuilds from zero, and says so in
`rebuilt`, when the file shrank OR when the cached offset does not land on a record
boundary. That boundary check is REAL as of a later review verdict — it was
asserted in this docstring and in SKILL.md and implemented nowhere, which is the
false-all-clear shape. A stale cache must degrade to the old behaviour, never to a wrong
answer.

⛔ THE `triage` VERDICT IS ADVISORY AND AUTHORISES NOTHING. It was built as a gate that
could skip Steps 2-4 of a mandatory recovery; a four-lens review measured both its legs
unsound (leg 2 held 127 of 127 windows — it is a tautology that RATCHETS, because the
recovery it would skip is itself the writer of the file leg 2 reads; leg 1 saw 652 of
~946 owner records, blind to the queued and slash-command shapes). The verdict is now
LOGGED and compared against what the full recovery actually finds
(warn-before-block). It becomes a gate only when the log shows it never disagreed.
"""
import json, os, re, sys, argparse


def deferral_rule(sid, state_dir, tx):
    """Ask post-compact-deferral.py's PURE rule() — never its decide(), which writes a breadcrumb.

    Why the index asks first: Claude Code runs the SessionStart:compact hooks BEFORE it appends the
    compaction's records, and a PRECOMPUTED compaction can sit prepared-but-not-applied across
    prompts, so the newest compaction record in the file can be the PREVIOUS window. Indexing then
    prints that window's owner speech and logs a wrong triage row. Returns (verdict, info); an
    import failure is RULE-UNAVAILABLE, never DEFERRED (the silent direction)."""
    import importlib.util
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "post-compact-deferral.py")
    try:
        spec = importlib.util.spec_from_file_location("post_compact_deferral", here)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod.rule(sid, state_dir, tx)
    except Exception as e:  # noqa: BLE001 — a broken rule must not masquerade as a verdict
        return "RULE-UNAVAILABLE", {"error": str(e)[:200]}

STATE_DIR = ".claude/state"


def cache_path(sid8):
    return os.path.join(STATE_DIR, "post-compact-index-%s.json" % sid8)


# ⛔ BUMP THIS WHEN A FIX CHANGES WHAT GETS CACHED, NOT ONLY WHEN THE SHAPE CHANGES.
# A predicate fix narrowed `is_owner_record` and removed 822 list-shaped false positives
# corpus-wide (a review census, 260 transcripts / 9.04 GB) — but every cache written
# BEFORE that fix still holds its own false positives, and nothing re-derived them, because
# the loader only ever checked that `offset` was an int. Deleting the files by hand reaches
# the machines you remember; a schema gate reaches all of them and cannot race a live run.
# 4: compaction entries carry the summary line's byte `offset` (the owner-speech
# window pass seeks to it), plus `ask_ids` and the whole-transcript (f)/(g)/promptSource controls.
SCHEMA = 4


def load_cache(p):
    try:
        with open(p, encoding="utf-8") as fh:
            c = json.load(fh)
        if not (isinstance(c, dict) and isinstance(c.get("offset"), int)):
            return None
        if c.get("schema") != SCHEMA:
            return None          # stale content, not a stale shape — rebuild
        return c
    except Exception:
        pass
    return None


def blank():
    return {
        "offset": 0,
        "records": 0,
        "compactions": [],      # [{index, ts, offset}]
        "owner_typed": [],      # [{index, ts}] — capped, newest kept
        "last_wrap": None,
        "ask_ids": {},          # AskUserQuestion tool_use id -> record index (the (f) LINK)
        "ask_answered_total": 0,  # linked AND non-empty answers, whole transcript — the (f) control
        "rejected_total": 0,    # toolDenialKind == user-rejected, whole transcript — the (g) control
        "ps_census": {},        # promptSource value -> count over every user record, whole transcript
        "schema": SCHEMA,
    }


OWNER_CAP = 400          # keep the newest N; the triage only needs recent ones
COMPACT_CAP = 200
LOG = ".claude/logs/post-compact-triage.jsonl"
ASK_CAP = 2000           # AskUserQuestion tool_use ids kept for the (f) link; newest kept

# ADOPTED, not invented: scripts/session-manifest.py `_HUMAN_PROMPT_SOURCES`, whose own
# comment carries the measurement — "promptSource=='typed' alone misses the queued channel
# entirely" (2026-07-10). The first cut of this file keyed on 'typed' alone and was blind to
# 652 of ~946 owner records on one transcript.
_HUMAN_PROMPT_SOURCES = ("typed", "queued", "suggestion_accepted")


def is_owner_record(line, r=None):
    """True for a record carrying the OWNER's own words, across the shapes that exist.

    Covers population (a) typed, (b) queued and suggestion_accepted via the house tuple,
    and (e) a slash command landing as a user record with NO promptSource at all, whose
    <command-args> carry the owner's words (`/eli5 <the owner's question>`). Populations (c) and (d) are
    NOT covered here and that is stated rather than implied. Every population IS covered by
    `owner_window` / `classify_record` below, which feeds the Step 4 section of the output and
    the `owner_window_counts` field of the triage log; this predicate stays leg 1's floor.

    And (f), an answered AskUserQuestion, is EXCLUDED BY CONSTRUCTION, not by omission: it
    rides a tool_result carrier whose content is a LIST, which the STRING guard below refuses
    -- correctly, since that same guard is what keeps a probe's own dumped output from scoring
    as owner speech. The two cannot be told apart by content shape; (f) needs the tool_use_id
    LINK, a different pass over a different record pair. So the triage log this predicate feeds
    can never show the one population that carries production-push authorizations, and Step 0b
    holds that log up as the only thing that could ever earn this a gate. Weigh it accordingly.

    This predicate is therefore still a FLOOR, which is why its verdict is advisory.
    """
    if r is None:
        return False
    if r.get("type") != "user" or r.get("isMeta"):
        return False
    ps = r.get("promptSource")
    if ps in _HUMAN_PROMPT_SOURCES:
        return True
    if ps is None:
        # A genuine slash-command user record carries a STRING content. A tool_result is
        # ALSO type=="user" with no promptSource, but its content is a LIST of blocks --
        # and one QUOTING "<command-name>" (an owner-speech probe's own output) matched
        # the old raw-line grep and scored as owner speech. Self-contaminating-probe
        # class: it inflates leg 1 toward "owner present", the SAFE direction, so it
        # never surfaced. Measured 2026-09-21: record 241990 in the eaten window was this
        # very file's probe output, and the recovery reported 1 owner record for 0 real.
        c = (r.get("message") or {}).get("content")
        # turnOrigin (a corpus census): a cron-fired, peer or task-notification slash
        # command has this exact shape. Only a KNOWN machine origin is excluded; an origin
        # never seen before stays the owner (and is censused UNRECOGNISED by the window pass).
        if isinstance(c, str) and "<command-name>" in c \
                and r.get("turnOrigin") not in MACHINE_TURN_ORIGINS:
            return True
    return False


def scan(tx, cache):
    """Read forward from cache['offset']. Returns (cache, rebuilt, bytes_read).

    Streams line by line: the first cut read the whole remainder with one fh.read() and
    peaked at ~5.6 GB RSS on a 908 MB transcript — on the cold path, i.e. exactly when the
    cache is already broken.
    """
    size = os.path.getsize(tx)
    rebuilt = False
    reason = None
    if cache is None:
        cache, rebuilt, reason = blank(), True, "no cache"
    elif cache["offset"] > size:
        cache, rebuilt, reason = blank(), True, "transcript shrank"
    elif cache["offset"] > 0 and not _on_boundary(tx, cache["offset"]):
        # REAL as of a review verdict. This was asserted in two documents and
        # implemented nowhere; an off-boundary seek is otherwise SILENT, because the split
        # record fails json.loads and hits `continue` with idx already incremented.
        cache, rebuilt, reason = blank(), True, "offset off a record boundary"

    start = cache["offset"]
    idx = cache["records"]
    consumed = 0
    with open(tx, "rb") as fh:
        fh.seek(start)
        pending = b""
        while True:
            buf = fh.read(1 << 20)
            if not buf:
                break
            pending += buf
            nl = pending.rfind(b"\n")
            if nl == -1:
                continue
            block, pending = pending[:nl + 1], pending[nl + 1:]
            pos = start + consumed            # byte offset of this block's first line
            consumed += len(block)
            for raw in block.split(b"\n"):
                line_off = pos
                pos += len(raw) + 1
                if not raw:
                    continue
                line = raw.decode("utf-8", errors="replace")
                idx += 1
                flat = line.replace(" ", "")
                if '"AskUserQuestion"' in flat and '"type":"assistant"' in flat:
                    # The (f) LINK, cached because the tool_use can pre-date the window by hours.
                    # Keyed on the tool_use BLOCK's name, never on the string: this spec, Bash
                    # output and probes all carry the word.
                    try:
                        r = json.loads(line)
                    except Exception:
                        r = {}
                    for b in (r.get("message") or {}).get("content") or []:
                        if isinstance(b, dict) and b.get("type") == "tool_use" \
                                and b.get("name") == "AskUserQuestion" and b.get("id"):
                            cache["ask_ids"][b["id"]] = idx
                if '"compact_boundary"' in flat:
                    # A PRECOMPUTED compaction stamps its summary when it was PREPARED, minutes to
                    # hours before it applied. The boundary record
                    # just before the summary carries the apply time, so the entry takes that.
                    try:
                        r = json.loads(line)
                    except Exception:
                        r = {}
                    if r.get("subtype") == "compact_boundary":
                        cache["boundary_ts"] = r.get("timestamp", "")
                        continue
                if '"isCompactSummary":true' in flat:
                    try:
                        r = json.loads(line)
                    except Exception:
                        continue
                    if r.get("isCompactSummary") is True:
                        ts = cache.pop("boundary_ts", "") or r.get("timestamp", "")
                        cache["compactions"].append({"index": idx, "ts": ts, "offset": line_off})
                        continue
                if '"type":"user"' in flat:
                    try:
                        r = json.loads(line)
                    except Exception:
                        continue
                    if r.get("type") == "user":
                        psk = str(r.get("promptSource"))
                        cache["ps_census"][psk] = cache["ps_census"].get(psk, 0) + 1
                        if r.get("toolDenialKind") == "user-rejected":
                            cache["rejected_total"] += 1
                        tur = r.get("toolUseResult")
                        if isinstance(tur, dict) and isinstance(tur.get("answers"), dict) \
                                and tur["answers"] and any(i in cache["ask_ids"] for i in _result_ids(r)):
                            cache["ask_answered_total"] += 1
                    if is_owner_record(line, r):
                        cache["owner_typed"].append({"index": idx, "ts": r.get("timestamp", "")})
                        continue
                if '"skill":"wrap"' in flat:
                    cache["last_wrap"] = idx

    cache["offset"] = start + consumed
    cache["records"] = idx
    cache["compactions"] = cache["compactions"][-COMPACT_CAP:]
    cache["owner_typed"] = cache["owner_typed"][-OWNER_CAP:]
    if len(cache["ask_ids"]) > ASK_CAP:
        cache["ask_ids"] = dict(list(cache["ask_ids"].items())[-ASK_CAP:])
    cache["rebuild_reason"] = reason
    return cache, rebuilt, consumed


def _on_boundary(tx, offset):
    """A cached offset is valid only if the byte before it is a newline."""
    if offset <= 0:
        return True
    try:
        with open(tx, "rb") as fh:
            fh.seek(offset - 1)
            return fh.read(1) == b"\n"
    except Exception:
        return False


# ─────────────────────────────────────────────────────────────────────────────────────────────
# OWNER SPEECH IN THE RECOVERY WINDOW — /post-compact Step 4, moved from prose to code.
# Step 4 used to make every recovery improvise a predicate for "what did the owner say" at the
# worst moment for recall (~1.25 hand-walks per run). The populations below are SKILL.md Step 4's
# (a)-(g) table, implemented once. Every population carries a must-fire AND a must-not-fire
# self-test arm. A record kind this script does not know is CENSUSED and printed, never dropped:
# eight populations is a floor, and every one of them was live for months before it was named.
# ─────────────────────────────────────────────────────────────────────────────────────────────
OWNER_PROMPT_SOURCES = {"typed": "a", "queued": "b", "suggestion_accepted": "b2"}
KNOWN_PROMPT_SOURCES = set(OWNER_PROMPT_SOURCES) | {"None", "system"}
# (origin.kind, commandMode) on a queued_command attachment. Only (human, prompt) is the owner; a
# task-notification once carried origin.kind == human on an older harness, so BOTH fields gate.
OWNER_QUEUED = ("human", "prompt")
KNOWN_QUEUED = {OWNER_QUEUED, ("None", "task-notification"),
                ("task-notification", "task-notification"), ("peer", "prompt")}
# toolDenialKind: only user-rejected is the owner. The other three are a hook deny and the classifier.
KNOWN_DENIALS = {"user-rejected", "permission-rule", "automode-blocked", "automode-unavailable"}
KNOWN_RECORD_TYPES = {
    "attachment", "assistant", "user", "system", "last-prompt", "mode", "permission-mode",
    "atis-latch", "custom-title", "agent-name", "agent-color", "queue-operation",
    "bridge-session", "ai-title", "history-suppression", "file-history-delta",
    "file-history-snapshot", "pr-link", "relocated", "worktree-state", "frame-link",
    "cost-state", "artifact-comment-monitor", "artifact-autoreact-ledger", "continued-in",
    "summary"}
KNOWN_SYSTEM_SUBTYPES = {
    "turn_duration", "stop_hook_summary", "compact_boundary", "local_command", "away_summary",
    "informational", "bridge_status", "scheduled_task_fire", "api_error"}
# turnOrigin on a user record. Absent on older harnesses (then the record predates the field and
# the (e) cell's other guards decide). Corpus census over 122 transcripts: (e)-shaped records came
# from human 357, task_notification 5, scheduled 4, peer 3 — the last three are machines.
# A DENY-list of KNOWN machine origins, never an allow-list of {absent, human}: an allow-list
# prints an origin it has never seen as "NOT THE OWNER" in the same output that lists it UNRECOGNISED,
# and drops it from leg 1. Every other unknown in this file fails toward the owner; so does this.
MACHINE_TURN_ORIGINS = {"task_notification", "peer", "auto_continuation", "scheduled"}
# A user record with NO promptSource and STRING content is keyed by its leading tag. Without this
# key the census reads `promptSource=None` (known) for the owner's `!` shell commands
# (<bash-input>, 60 corpus-wide) and for untagged prose, and prints "UNRECOGNISED: none".
KNOWN_USER_STRING_SHAPES = {"command-message", "command-name", "local-command-stdout",
                            "local-command-stderr", "bash-stdout", "bash-stderr"}
LEAD_TAG = re.compile(r"\s*<([A-Za-z][\w-]*)>")
KNOWN_TURN_ORIGINS = {"None", "human", "task_notification", "peer", "auto_continuation", "scheduled"}
POP_ORDER = ("a", "b", "b2", "c", "d", "e", "f", "g")
POP_NAMES = {"a": "typed", "b": "queued", "b2": "accepted suggestion",
             "c": "queued-command attachment", "d": "local slash command",
             "e": "slash command (user record)", "f": "answered AskUserQuestion",
             "g": "REJECTED tool call"}
TEXT_CAP = 2000          # per record; a cut is ANNOUNCED with the index to read, never silent

# The quote-then-instruct ruling shape (SKILL.md Step 4): DETECT with the anchored greedy form,
# SEGMENT with finditer — one message can carry several rulings.
QUOTE_SHAPE = re.compile(r'^\s*["“](.*)["”]\s*-\s*(\S.*)$', re.DOTALL)
QUOTE_PAIR = re.compile(r'["“](.*?)["”]\s*-\s*(.*?)(?=\s*["“]|\Z)', re.DOTALL)
QUOTE_MARK = re.compile('["“”]')
QUOTE_OPEN = re.compile(r'^\s*["“]')
RULING_END = re.compile(r"[;.!?:)\]]$")   # an answer that ends here can be followed by a new pair
ANSI = re.compile(r"\x1b\[[0-9;]*m")
RECOMMENDED = re.compile(r"\s*\(Recommended\)\s*$")


def _result_ids(r):
    c = (r.get("message") or {}).get("content")
    if not isinstance(c, list):
        return []
    return [b.get("tool_use_id") for b in c
            if isinstance(b, dict) and b.get("type") == "tool_result" and b.get("tool_use_id")]


def _text_of(content):
    if isinstance(content, str):
        return content
    out = []
    for b in content or []:
        if isinstance(b, dict):
            if b.get("type") == "text":
                out.append(b.get("text", ""))
            elif b.get("type") == "image":
                out.append("[image]")
    return "\n".join(out)


def _tag(text, name):
    m = re.search(r"<%s>(.*?)</%s>" % (name, name), text or "", re.DOTALL)
    return m.group(1).strip() if m else None


def quote_rulings(text):
    """[(quoted-my-text, the-owner's-answer)] for the quote-then-instruct shape, else [].

    A split that is not clean returns [] so the record is read whole, never mis-cut: a quoted half
    holding an odd number of quote marks means the lazy pair stopped inside my text
    ('"run the "fast" - path then stop" - yes' cuts at 'run the "fast'), and text outside every
    pair means the owner's words were dropped ('"x" - yes, and "y" too' loses '"y" too'). Measured
    over 336 transcripts: 46 messages carried the first shape, 113 the second.
    A later pair that starts on the same line as an answer with no closing mark (; . ! ? : ) ]) is
    refused too: it is the owner's own quoted word ('- no, call it "launch" - better') or an inch mark
    ('12" - wide or 8" - narrow'), not a new ruling (measured: this refuses 15 of 4,912
    accepted splits in the 336 transcripts, 6 of them the owner's own words printed as the
    assistant's quote; the other 9 print whole as UNSPLIT)."""
    if not text or not QUOTE_SHAPE.match(text):
        return []
    pairs, rest, pos, prev = [], [], 0, None
    for m in QUOTE_PAIR.finditer(text):
        if len(QUOTE_MARK.findall(m.group(1))) % 2:
            return []
        if prev and "\n" not in text[prev.end():m.start()] and not RULING_END.search(prev.group(2)):
            return []
        prev = m
        rest.append(text[pos:m.start()])
        pos = m.end()
        pairs.append((m.group(1).strip(), m.group(2).strip()))
    if ("".join(rest) + text[pos:]).strip():
        return []
    return pairs


QUOTE_TEXT_POPS = ("a", "b", "b2", "c", "e")


def unsplit_quote(e):
    """True for a text record that opens with a quote and got no pairs from quote_rulings (no
    quote-then-rule shape, or a split refused as unclean): read it whole. The ONE definition both
    render_owner and scripts/owner-words.py use, so the two can never disagree on a record."""
    return (e.get("pop") in QUOTE_TEXT_POPS and not e.get("rulings")
            and bool(QUOTE_OPEN.match(e.get("text") or "")))


def classify_answer(question, answer, labels):
    """One (f) answer, per QUESTION: a CHOICE of an offered label, or FREE TEXT in the owner's words."""
    if not labels:
        return {"question": question, "kind": "UNCLASSIFIED",
                "note": "no offered labels on the record — cannot separate a choice from the owner's words",
                "value": answer}
    if isinstance(answer, list):
        parts = [str(x) for x in answer]
    elif isinstance(answer, str) and answer in labels:
        parts = [answer]
    elif isinstance(answer, str) and ", " in answer \
            and all(p in labels for p in answer.split(", ")):
        parts = answer.split(", ")           # multi-select, joined — only when EVERY part is a label
    else:
        return {"question": question, "kind": "FREE TEXT", "value": answer}
    chosen = [RECOMMENDED.sub("", p) for p in parts if p in labels]
    free = [p for p in parts if p not in labels]
    out = {"question": question, "kind": "CHOICE", "value": chosen}
    if free:
        out["free_text"] = free
    return out


def classify_record(r, ask_ids, tool_names):
    """Owner-speech entries for ONE parsed record: [{pop, ...}]. Empty for anything not the owner."""
    t = r.get("type")
    out = []
    if t == "user":
        if r.get("isMeta") or r.get("isCompactSummary"):
            return out            # a compaction summary QUOTES <command-name>; it is not the owner
        ps = r.get("promptSource")
        content = (r.get("message") or {}).get("content")
        if ps in OWNER_PROMPT_SOURCES:
            text = _text_of(content)
            out.append({"pop": OWNER_PROMPT_SOURCES[ps], "text": text,
                        "rulings": quote_rulings(text)})
            return out
        if ps is None and isinstance(content, str) and "<command-name>" in content:
            args = _tag(content, "command-args") or ""
            origin = r.get("turnOrigin")
            if origin in MACHINE_TURN_ORIGINS:
                # A cron-fired /pause resume, a peer's or a task notification's slash command:
                # the same record shape as the owner's, written by a machine. Shown, never counted as the owner.
                out.append({"pop": "e-machine", "command": _tag(content, "command-name"),
                            "text": args, "origin": origin})
                return out
            out.append({"pop": "e", "command": _tag(content, "command-name"), "text": args,
                        "rulings": quote_rulings(args)})
            return out
        if r.get("toolDenialKind") == "user-rejected":
            for i in _result_ids(r) or [None]:
                if i in ask_ids:
                    what = "AskUserQuestion — the owner DISMISSED the question (not a choice)"
                else:
                    what = tool_names.get(i) or "a tool whose tool_use pre-dates the window"
                said = _text_of(content)
                his = said.split("the user said:", 1)[1].strip() if "the user said:" in said else None
                out.append({"pop": "g", "refused": what, "tool_use_id": i, "user_said": his})
            return out
        tur = r.get("toolUseResult")
        linked = [i for i in _result_ids(r) if i in ask_ids]
        if linked and isinstance(tur, dict):
            answers = tur.get("answers")
            if isinstance(answers, dict) and answers:
                labels = {}
                for q in tur.get("questions") or []:
                    if isinstance(q, dict):
                        labels[q.get("question")] = [o.get("label") for o in q.get("options") or []
                                                     if isinstance(o, dict)]
                out.append({"pop": "f", "answers": [classify_answer(q, a, labels.get(q, []))
                                                    for q, a in answers.items()]})
            else:
                out.append({"pop": "f-none", "note": "linked to a question but NO answer "
                            "(timeout / error) — silence, never a ruling"})
        return out
    if t == "attachment":
        a = r.get("attachment") or {}
        if a.get("type") == "queued_command" and \
                ((a.get("origin") or {}).get("kind"), a.get("commandMode")) == OWNER_QUEUED:
            text = a.get("prompt") if isinstance(a.get("prompt"), str) else _text_of(a.get("prompt"))
            out.append({"pop": "c", "text": text, "rulings": quote_rulings(text)})
        return out
    if t == "system" and r.get("subtype") == "local_command":
        c = r.get("content") or ""
        if "<command-name>" in c:
            out.append({"pop": "d", "command": _tag(c, "command-name"),
                        "args": _tag(c, "command-args") or ""})
        elif "<local-command-std" in c:
            o = _tag(c, "local-command-stdout")
            e = _tag(c, "local-command-stderr")
            out.append({"pop": "d-out", "output": ANSI.sub("", o if o is not None else (e or ""))})
    return out


def _census_key(r):
    """(kind, value) pairs for the census, and whether each is one this script knows."""
    t = r.get("type")
    keys = [("record type", str(t), t in KNOWN_RECORD_TYPES)]
    if t == "user":
        ps = str(r.get("promptSource"))
        keys.append(("promptSource", ps, ps in KNOWN_PROMPT_SOURCES))
        to = str(r.get("turnOrigin"))
        keys.append(("turnOrigin", to, to in KNOWN_TURN_ORIGINS))
        c = (r.get("message") or {}).get("content")
        if r.get("promptSource") is None and isinstance(c, str) and not r.get("isMeta") \
                and not r.get("isCompactSummary"):
            m = LEAD_TAG.match(c)
            s = m.group(1) if m else "prose (no leading tag)"
            keys.append(("user string shape", s, s in KNOWN_USER_STRING_SHAPES))
        if "toolDenialKind" in r:
            d = str(r.get("toolDenialKind"))
            keys.append(("toolDenialKind", d, d in KNOWN_DENIALS))
    elif t == "attachment":
        a = r.get("attachment") or {}
        if a.get("type") == "queued_command":
            k = (str((a.get("origin") or {}).get("kind")), str(a.get("commandMode")))
            keys.append(("queued_command origin/mode", "/".join(k), k in KNOWN_QUEUED))
    elif t == "system":
        s = str(r.get("subtype"))
        keys.append(("system subtype", s, s in KNOWN_SYSTEM_SUBTYPES))
    return keys


def owner_window(tx, cache):
    """Every owner record from the PREVIOUS compaction summary to the end of what scan consumed.

    `pre` = inside the window the newest compaction ATE (prev < idx < newest); `post` = after the
    newest summary (what the owner said since). Classification is by record FIELD, per Step 4's table."""
    comps = cache.get("compactions") or []
    if not comps:
        return {"status": "no compaction summary in this transcript — nothing to recover"}
    newest = comps[-1]
    prev = comps[-2] if len(comps) >= 2 else None
    if prev is not None and "offset" not in prev:
        return {"status": "cache lacks compaction offsets — rerun without a stale cache"}
    start = prev["offset"] if prev else 0
    idx = prev["index"] - 1 if prev else 0
    end = cache["offset"]
    ask_ids = cache.get("ask_ids") or {}
    tool_names = {}
    entries, census, unknown, unknown_first = [], {}, {}, {}
    pending_cmd = None
    with open(tx, "rb") as fh:
        fh.seek(start)
        remaining = end - start
        buf = b""
        while remaining > 0:
            chunk = fh.read(min(1 << 20, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            buf += chunk
            nl = buf.rfind(b"\n")
            if nl == -1:
                continue
            block, buf = buf[:nl + 1], buf[nl + 1:]
            for raw in block.split(b"\n"):
                if not raw:
                    continue
                idx += 1
                try:
                    r = json.loads(raw.decode("utf-8", errors="replace"))
                except Exception:
                    continue
                if not isinstance(r, dict):
                    continue
                for kind, val, known in _census_key(r):
                    census.setdefault(kind, {})
                    census[kind][val] = census[kind].get(val, 0) + 1
                    if not known:
                        unknown.setdefault((kind, val), []).append(idx)
                        # The record's own opening text, so nobody re-reads it by hand at a guessed
                        # offset: three hand re-reads landed one record early (1-based numbering).
                        unknown_first.setdefault((kind, val), _record_preview(r))
                if r.get("type") == "assistant":
                    for b in (r.get("message") or {}).get("content") or []:
                        if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("id"):
                            inp = b.get("input") or {}
                            hint = inp.get("command") or inp.get("file_path") or inp.get("description") or ""
                            tool_names[b["id"]] = "%s %s" % (b.get("name"), str(hint)[:160])
                if r.get("isCompactSummary") is True:
                    continue
                where = "pre" if idx < newest["index"] else "post"
                for e in classify_record(r, ask_ids, tool_names):
                    e.update(idx=idx, ts=r.get("timestamp", ""), where=where)
                    if e["pop"] == "d":
                        pending_cmd = e
                        entries.append(e)
                    elif e["pop"] == "d-out":
                        if pending_cmd is not None and "output" not in pending_cmd:
                            pending_cmd["output"] = e["output"]
                            pending_cmd["output_idx"] = idx
                        else:
                            e["pop"] = "d"
                            e["command"] = None
                            entries.append(e)
                    else:
                        entries.append(e)
    counts = {p: {"pre": 0, "post": 0} for p in POP_ORDER}
    for e in entries:
        if e["pop"] in counts:
            counts[e["pop"]][e["where"]] += 1
    return {"status": "ok",
            "window": {"from_compaction_index": prev["index"] if prev else 0,
                       "newest_compaction_index": newest["index"], "to_index": idx},
            "entries": entries, "counts": counts, "census": census,
            "unrecognised": [{"kind": k, "value": v, "count": len(ix), "first_indexes": ix[:5],
                              "first_text": unknown_first.get((k, v), "")}
                             for (k, v), ix in sorted(unknown.items())]}


def _record_preview(r, n=120):
    """The first n characters of a record's own text, type-prefixed, for the UNRECOGNISED lines.
    Never raises: every row it serves is a shape this script does not know."""
    try:
        m = r.get("message")
        c = m.get("content") if isinstance(m, dict) else None
        if c is None:   # a system record carries top-level content; a queued_command its prompt
            c = r.get("content") or (r.get("attachment") or {}).get("prompt")
        if isinstance(c, list):
            c = " ".join(str(b.get("text") or "") for b in c if isinstance(b, dict))
        text = " ".join(str(c or "").split())
    except Exception:  # noqa: BLE001 — a preview must never take the index down with it
        text = ""
    return "%s: %s" % (r.get("type"), text[:n] or "(no text field — read the record whole)")


def _cap(s, idx):
    s = s or ""
    if len(s) <= TEXT_CAP:
        return s
    return s[:TEXT_CAP] + " [… %d more chars NOT SHOWN — read record %d whole]" % (len(s) - TEXT_CAP, idx)


def render_owner(win, cache, bank=None):
    L = ["", "=== OWNER SPEECH IN THE RECOVERY WINDOW (Step 4) ==="]
    if win.get("status") != "ok":
        L.append("status: " + win.get("status", "?"))
        return "\n".join(L)
    fresh = bank if bank and bank.get("status") == "FRESH" else None
    if fresh:
        after = sum(1 for e in win["entries"] if (e.get("ts") or "")[:19] > fresh["ts"])
        # ⛔ BANKED means "said before the save", never "carried by it": a bank copies the owner's words about
        # the save, open questions and the next step, not every ruling in the window. So EVERY record below is
        # still reported.
        L.append("BANK: FRESH — /pre-compact block at %sZ (plan line %d). Report EVERY record below: the %d "
                 "tagged AFTER-BANK came after the save, which cannot know them (read them first); a BANKED one "
                 "was said before it and the save may not quote it, so check each such ruling is in the plan. "
                 "Step 5 starts from the block's items and confirms each" % (fresh["ts"], fresh["line"], after))
    else:
        L.append("BANK: %s — no /pre-compact block for this window; the full recovery, as before"
                 % ((bank or {}).get("status") or "NOT CHECKED"))
    w = win["window"]
    # "before", not "eaten": a precomputed compaction carries the records written between its preparation and its
    # apply into the new context verbatim (measured: 20,946 of 20,980 over 115 of them).
    L.append("window: records %d..%d — pre = before the compaction at %d (eaten, unless a precomputed one carried "
             "them over), post = said since"
             % (w["from_compaction_index"], w["to_index"], w["newest_compaction_index"]))
    L.append("per population (pre/post): " + "  ".join(
        "(%s) %d/%d" % (p, win["counts"][p]["pre"], win["counts"][p]["post"]) for p in POP_ORDER))
    L.append("census (window): " + "; ".join(
        "%s {%s}" % (k, ", ".join("%s: %d" % kv for kv in sorted(v.items(), key=lambda x: -x[1])))
        for k, v in sorted(win["census"].items())))
    L.append("census (whole transcript) promptSource {%s}" % ", ".join(
        "%s: %d" % kv for kv in sorted((cache.get("ps_census") or {}).items(), key=lambda x: -x[1])))
    unk = win["unrecognised"] + [
        {"kind": "promptSource (whole transcript)", "value": v, "count": n, "first_indexes": []}
        for v, n in sorted((cache.get("ps_census") or {}).items())
        if v not in KNOWN_PROMPT_SOURCES and not any(
            u["kind"] == "promptSource" and u["value"] == v for u in win["unrecognised"])]
    if unk:
        L.append("UNRECOGNISED (read these by hand — a ninth population until shown otherwise):")
        for u in unk:
            L.append("  %s = %r ×%d%s" % (u["kind"], u["value"], u["count"],
                                          (" at %s" % u["first_indexes"]) if u["first_indexes"] else ""))
            if u.get("first_text"):
                L.append("      first record (numbered from 1): %s" % u["first_text"])
    else:
        L.append("UNRECOGNISED: none among the censused keys above — a floor, never a closed set")
    L.append("controls (WHOLE transcript): AskUserQuestion uses %d, answered (linked + non-empty) %d; "
             "user-rejected %d — (g) never reaches sub-agent transcripts"
             % (len(cache.get("ask_ids") or {}), cache.get("ask_answered_total", 0),
                cache.get("rejected_total", 0)))
    lo = cache.get("owner_typed") or []
    L.append("positive control: newest (a)/(b)/(b2)/(e) record anywhere = %s — match it to a "
             "message you can cite from context" % (("record %d %s" % (lo[-1]["index"], lo[-1]["ts"])) if lo else "NONE"))
    inwin = [o["index"] for o in lo if w["from_compaction_index"] < o["index"] <= w["to_index"]]
    seen = {e["idx"] for e in win["entries"] if e["pop"] in ("a", "b", "b2", "e")}
    miss = [i for i in inwin if i not in seen]
    L.append(("CONTROL MISMATCH: leg-1 owner record(s) %s sit in the window and are NOT listed "
              "below — the window pass is broken; walk the window by hand" % miss) if miss else
             "window control: %d of %d leg-1 owner record(s) inside the window are listed below"
             % (len(inwin), len(inwin)))
    L.append("--- records, chronological ---")
    if not win["entries"]:
        L.append("(no owner record in the window — a hypothesis until the control above is matched)")
    for e in win["entries"]:
        head = "[%-4s] %d %s (%s)" % (e["where"], e["idx"], e["ts"], e["pop"])
        if fresh:
            head += " AFTER-BANK" if (e.get("ts") or "")[:19] > fresh["ts"] else " BANKED"
        p = e["pop"]
        if p in ("a", "b", "b2", "c"):
            L.append("%s %s: %s" % (head, POP_NAMES[p], _cap(e["text"], e["idx"])))
        elif p == "e":
            L.append("%s %s %s" % (head, e.get("command"), _cap(e["text"], e["idx"])))
        elif p == "d":
            out = e.get("output")
            L.append("%s %s %s -> output: %s" % (
                head, e.get("command") or "(output with no command record)", e.get("args", ""),
                repr(out) if out is not None else "(no output record)"))
        elif p == "f":
            L.append("%s answered AskUserQuestion:" % head)
            for a in e["answers"]:
                if a["kind"] == "CHOICE":
                    s = "the owner chose " + " + ".join(a["value"])
                    if a.get("free_text"):
                        s += " ; plus THE OWNER'S WORDS: %r" % a["free_text"]
                elif a["kind"] == "FREE TEXT":
                    s = "FREE TEXT, the owner's words: %r" % a["value"]
                else:
                    s = "UNCLASSIFIED (%s): %r" % (a["note"], a["value"])
                L.append("        Q %r -> %s" % (a["question"][:200], s))
        elif p == "f-none":
            L.append("%s %s" % (head, e["note"]))
        elif p == "e-machine":
            L.append("%s NOT THE OWNER — %s fired by turnOrigin=%s: %s" % (
                head, e.get("command"), e.get("origin"), _cap(e["text"], e["idx"])[:300]))
        elif p == "g":
            s = "%s REJECTED: %s — a STOP on that call, never a veto of the step" % (head, e["refused"])
            if e.get("user_said"):
                s += " ; after 'the user said:' %r (the owner's words OR harness boilerplate)" % e["user_said"][:400]
            L.append(s)
        for q, a in e.get("rulings") or []:
            L.append("        QUOTE-RULING: the owner answered %r on the item the owner quoted: %r"
                     % (a[:400], q[:200]))
        if unsplit_quote(e):
            L.append("        UNSPLIT-QUOTE: opens with a quote and has no clean quote-then-rule split; the "
                     "quoted part is most likely my text, so read it whole and take his words from after it")
    return "\n".join(L)


def triage(cache, plan=None):
    """ADVISORY measurement of whether the full reconstruction looks owed. AUTHORISES NOTHING.

    ⛔ SHIPPED AS A GATE, DEMOTED TO A MEASUREMENT by a four-lens review verdict.
    Both legs were measured unsound and the demotion is the fix, under the
    warn-before-block discipline: log the verdict, run Steps 2-4 anyway, and record whether they found
    anything the plan lacked. That log is the evidence that would let it become a gate.

      leg 1 — no owner record in the window this compaction ATE. Now uses the HOUSE
              predicate (typed / queued / suggestion_accepted) plus the slash-command user
              shape. Still a FLOOR: the spec names more populations than this reaches —
              the typed one. ⛔ THE LEG IS NAMED `owner_typed` FOR THAT REASON (renamed
              2026-09-21): it reported `owner: absent` over a window holding a genuine
              QUEUED owner directive, and a reader cannot tell that from no owner speech.
              A leg that walks one population must not be named after all of them.
              The first cut used 'typed' alone and saw 652 of ~946.
      leg 2 — the working plan was written after the window CLOSED, not after it opened.
              ⛔ EVEN CORRECTED THIS RATCHETS AND CANNOT GATE. Under LIGHT the recovery
              still runs Step 6, whose plan write is MANDATORY and non-conditional, so the
              mechanism guarantees the write its own next verdict reads. Measured: leg 2
              held 127 of 127 windows. It is reported for the log, never to decide.

    Every unknown returns FULL. A wrong LIGHT would discard reconstruction at the one moment
    the context that would catch it has just been deleted; a wrong FULL costs one recovery.
    """
    comps = cache["compactions"]
    if not comps:
        return {"verdict": "FULL", "advisory": True, "reason": "no compaction summary in this transcript"}
    newest = comps[-1]["index"]
    prev = comps[-2]["index"] if len(comps) >= 2 else 0
    window = [prev, newest]
    base = {"advisory": True, "window": window,
            "authority": "NONE — logged only; Steps 2-4 run regardless"}

    if len(cache["owner_typed"]) >= OWNER_CAP and cache["owner_typed"][0]["index"] > prev:
        return dict(base, verdict="FULL", legs={"owner_typed": "unknown", "plan": "unchecked"},
                    reason="typed-owner-record cap truncates below the eaten window")

    eaten = [o for o in cache["owner_typed"] if prev < o["index"] < newest]
    if eaten:
        # The INDEXES, not just the count. This gate can only ever be earned by a log that
        # shows it never disagreed with a full recovery, and "4 owner records" cannot be
        # audited later while "records 242967, 243256, 243550, 243811" can. The defect this
        # script was fixed for was found by reading the HIT rather than the count, so a log
        # that keeps only counts reproduces it one layer up.
        return dict(base, verdict="FULL", legs={"owner_typed": "present", "plan": "unchecked"},
                    reason="%d TYPED owner record(s) in the eaten window" % len(eaten),
                    owner_in_window=len(eaten),
                    owner_indexes=[o["index"] for o in eaten])

    close_ts = comps[-1]["ts"]
    if not plan or not os.path.exists(plan):
        return dict(base, verdict="FULL", legs={"owner_typed": "absent", "plan": "no readable plan"},
                    reason="leg 1 holds but the plan leg could not be evaluated")
    if len(close_ts) < 19:
        return dict(base, verdict="FULL", legs={"owner_typed": "absent", "plan": "window close ts unusable: %r" % close_ts},
                    reason="leg 1 holds but the plan leg could not be evaluated")
    try:
        import datetime
        pm = datetime.datetime.utcfromtimestamp(os.path.getmtime(plan)).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception as e:
        return dict(base, verdict="FULL", legs={"owner_typed": "absent", "plan": "mtime unreadable: %s" % e},
                    reason="leg 1 holds but the plan leg could not be evaluated")
    if pm >= close_ts[:19] + "Z":
        return dict(base, verdict="LIGHT", owner_in_window=0,
                    legs={"owner_typed": "absent",
                          "plan": "written after the window CLOSED (%s >= %s)" % (pm, close_ts[:19]),
                          "caveat": "leg 2 ratchets — the recovery writes this file; not fit to gate"},
                    reason="ADVISORY ONLY: looks light, but nothing is skipped on it")
    return dict(base, verdict="FULL", legs={"owner_typed": "absent", "plan": "stale (%s < %s)" % (pm, close_ts[:19])},
                reason="leg 1 holds but the plan predates the window close")


BANK_HEAD_RE = re.compile(r"^#{2,3} PRE-COMPACT\b")
BANK_TS_RE = re.compile(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)Z")


def find_bank(plan, comps):
    """The newest /pre-compact bank at or before the newest compaction (else the newest after it), placed against this compaction window.

    When /pre-compact already ran, /post-compact does less work; when it did not, the usual recovery
    applies. FRESH = a `## PRE-COMPACT` heading whose
    first UTC ISO time falls after the PREVIOUS compaction and at or before the newest one, so the
    block was written for the compaction just recovered from; /post-compact then starts Step 5 from
    the block's items and confirms each, while Step 4 still reports every owner record. Every other status (NO-PLAN, NO-COMPACTION, NONE,
    STALE = an older window's bank, LATER = written after this boundary) means today's recovery,
    unchanged. A heading with a date but no time cannot be placed: it is skipped, and NONE counts it as "undated" (four older banks
    carry one). Times compare as UTC strings to the second; a bank without seconds reads as :00.
    """
    if not plan or not os.path.exists(plan):
        return {"status": "NO-PLAN"}
    if not comps:
        return {"status": "NO-COMPACTION"}
    newest = comps[-1]["ts"][:19]
    pick, undated = {"placed": None, "later": None}, 0
    try:
        with open(plan, encoding="utf-8") as fh:
            for n, line in enumerate(fh, 1):
                if not BANK_HEAD_RE.match(line):
                    continue
                m = BANK_TS_RE.search(line)
                if not m:
                    undated += 1
                    continue
                ts = m.group(1) if len(m.group(1)) == 19 else m.group(1) + ":00"
                k = "placed" if ts <= newest else "later"   # a bank past the boundary never hides one before it
                if pick[k] is None or ts >= pick[k]["ts"]:
                    pick[k] = {"ts": ts, "line": n, "heading": line.strip()[:200]}
    except (OSError, UnicodeDecodeError) as e:
        return {"status": "NO-PLAN", "error": str(e)}
    best = pick["placed"] or pick["later"]
    if best is None:
        return {"status": "NONE", "undated": undated}
    prev = comps[-2]["ts"][:19] if len(comps) >= 2 else ""
    if best["ts"] > newest:
        status = "LATER"
    elif prev and best["ts"] <= prev:
        status = "STALE"
    else:
        status = "FRESH"
    return dict(best, status=status)


def log_verdict(sid8, out):
    """Warn-first evidence trail. The gate's sibling in this subsystem is warn-mode with a
    1,154-row fire log; this one shipped with no log at all, which is how a silent wrong
    answer stays invisible."""
    try:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        t = out.get("triage", {})
        row = {"ts": out.get("now"), "sid": sid8, "verdict": t.get("verdict"),
               "legs": t.get("legs"), "window": t.get("window"),
               "reason": t.get("reason"),
               "owner_in_window": t.get("owner_in_window"),
               "owner_indexes": t.get("owner_indexes"),
               "rebuilt": out.get("rebuilt_from_zero"),
               "rebuild_reason": out.get("rebuild_reason"),
               "records": out.get("records"),
               # every population, so the log can show whether leg 1 (a floor) ever disagreed
               # with what the full Step 4 walk found — the evidence a gate would need
               "owner_window_counts": (out.get("owner_window") or {}).get("counts"),
               # the /pre-compact bank this recovery started from: the save->recovery pair's only
               # machine-readable record (FRESH/STALE/LATER/NONE/NO-PLAN/NO-COMPACTION, its UTC time and plan line)
               "bank": {k: (out.get("bank") or {}).get(k) for k in ("status", "ts", "line", "undated")}}
        with open(LOG, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(row) + "\n")
    except Exception:
        pass   # a logging failure must never change the verdict


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sid", default=os.environ.get("CLAUDE_CODE_SESSION_ID", ""))
    ap.add_argument("--transcript", default=None)
    ap.add_argument("--plan", default=None, help="session working plan; leg 2 of the triage")
    ap.add_argument("--no-update", action="store_true", help="derive but do not write the cache")
    ap.add_argument("--no-owner", action="store_true",
                    help="skip the Step 4 owner-speech section (stdout is then pure JSON)")
    ap.add_argument("--state-dir", default=None,
                    help="where the post-compact MARKERS live, for the deferral rule only (default: this checkout's "
                         ".claude/state, as post-compact-deferral.py resolves it); the cache and the triage log "
                         "still go to ./.claude/state")
    ap.add_argument("--force", action="store_true",
                    help="index even when the deferral rule says DEFERRED (the hook fired, no compaction landed)")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()

    if a.self_test:
        return self_test()

    if not a.sid:
        print("post-compact-index: no session id (pass --sid or set CLAUDE_CODE_SESSION_ID)", file=sys.stderr)
        return 1
    sid8 = a.sid.split("-")[0]
    tx = a.transcript or os.path.expanduser(
        "~/.claude/projects/<project-key>/%s.jsonl" % a.sid)
    if not os.path.exists(tx):
        print("post-compact-index: transcript not found: %s" % tx, file=sys.stderr)
        return 1

    # ⛔ DEFERRED means a compaction is PREPARED but not yet APPLIED: the newest compaction record
    # in the file is the PREVIOUS window, so indexing now would print that window's owner speech
    # and log a triage row for it. Stop here — no cache write, no log row. Pinned by ARM 8p + 8p2.
    # Any other verdict rides into the output, so a RULE-UNAVAILABLE fall-through (the pre-gate
    # behaviour) is visible to the reader instead of indistinguishable from NO-MARKER.
    deferral = "SKIPPED (--force)"
    if not a.force:
        verdict, info = deferral_rule(a.sid, a.state_dir, tx)
        deferral = verdict if verdict != "RULE-UNAVAILABLE" else "%s: %s" % (verdict, info.get("error"))
        if verdict == "DEFERRED":
            nob = info.get("newest_boundary") == "none"
            print(json.dumps({"sid": sid8, "deferred": True, "verdict": verdict,
                              "why": ("the transcript holds NO compact_boundary record: either the hook fired "
                                      "for a first compaction that has not landed, or this transcript predates "
                                      "boundary records and will read DEFERRED forever; nothing indexed, "
                                      "nothing logged (--force indexes)") if nob else
                                     "the hook fired for a compaction that has not landed — the newest compaction "
                                     "record in the transcript is the previous window; nothing indexed, "
                                     "nothing logged (--force overrides)",
                              "info": info}, indent=2))
            return 0
        if verdict == "RULE-UNAVAILABLE":
            print("post-compact-index: RULE-UNAVAILABLE — the deferral rule did not load or raised (%s); indexing "
                  "ungated" % info.get("error"), file=sys.stderr)

    p = cache_path(sid8)
    # A schema-triggered rebuild must SAY SO. `load_cache` returns None for both "no file" and
    # "stale schema", so `scan` reports "no cache" for a file that plainly existed — and the
    # fleet-wide re-derivation a bump causes would then be invisible in the very log that is
    # the only thing able to earn this subsystem a gate. Same class as the finding that put
    # `owner_indexes` in the log: keep the evidence, not just the verdict.
    # Pinned by ARM 8m, which runs main() as a subprocess over a planted stale-schema cache.
    prior_schema = None
    if os.path.exists(p):
        try:
            prior_schema = (json.load(open(p, encoding="utf-8")) or {}).get("schema")
        except Exception:
            prior_schema = "unreadable"
    cache = load_cache(p)
    cache, rebuilt, read = scan(tx, cache)
    if rebuilt and cache.get("rebuild_reason") == "no cache" and prior_schema != SCHEMA \
            and os.path.exists(p):
        cache["rebuild_reason"] = "cache schema %r -> %d (content re-derived)" % (prior_schema, SCHEMA)
    t = triage(cache, a.plan)
    bank = find_bank(a.plan, cache["compactions"])

    out = {
        "sid": sid8,
        "records": cache["records"],
        "bytes_read_this_run": read,
        "transcript_bytes": os.path.getsize(tx),
        "rebuilt_from_zero": rebuilt,
        "rebuild_reason": cache.get("rebuild_reason"),
        "now": __import__("datetime").datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "compactions": len(cache["compactions"]),
        "newest_compaction": cache["compactions"][-1] if cache["compactions"] else None,
        "last_owner_typed": cache["owner_typed"][-1] if cache["owner_typed"] else None,
        "triage": t,
        "bank": bank,
        "deferral": deferral,
    }
    win = None
    if not a.no_owner:
        win = owner_window(tx, cache)
        out["owner_window"] = {"status": win.get("status"), "window": win.get("window"),
                               "counts": win.get("counts"),
                               "unrecognised": win.get("unrecognised")}
    if not a.no_update:
        os.makedirs(STATE_DIR, exist_ok=True)
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(cache, fh)
        os.replace(tmp, p)
    log_verdict(sid8, out)
    print(json.dumps(out, indent=2))
    if win is not None:
        print(render_owner(win, cache, bank))
    return 0


def self_test():
    """Controls in BOTH directions, and every arm must be able to FAIL.

    Three arms of the first cut could not fail and a four-lens review found all three:
    ARM 1 took FULL from the no-plan branch as readily as from leg 1, ARM 5 compared a pure
    function against itself, and two mutations deleting leg 1 outright survived the suite.
    Every arm below therefore asserts the DISCRIMINATING string in `legs`, not the verdict —
    that is the method that found them, applied to itself.
    """
    import tempfile, shutil, datetime
    d = tempfile.mkdtemp()
    ok = True
    C1 = "2026-09-20T10:00:00.000Z"
    C2 = "2026-09-20T12:00:00.000Z"

    def rec(**kw):
        return json.dumps(kw)

    def write(path, lines, trailing=True):
        open(path, "w").write("\n".join(lines) + ("\n" if trailing else ""))

    def fail(label, msg, got=None):
        print("  %s FAIL: %s" % (label, msg), got if got is not None else "")
        return False

    try:
        tx = os.path.join(d, "t.jsonl")
        plan_new = os.path.join(d, "plan.md"); open(plan_new, "w").write("x")
        plan_old = os.path.join(d, "old.md"); open(plan_old, "w").write("x"); os.utime(plan_old, (0, 0))

        # ARM 1 — owner INSIDE the eaten window -> FULL *via leg 1*.
        write(tx, [rec(type="user", promptSource="typed", timestamp="2026-09-20T09:00:00Z"),
                   rec(isCompactSummary=True, timestamp=C1),
                   rec(type="user", promptSource="typed", timestamp="2026-09-20T11:00:00Z"),
                   rec(isCompactSummary=True, timestamp=C2)])
        c, _, _ = scan(tx, None)
        t = triage(c, plan_new)                      # plan PASSED, so the no-plan branch cannot supply FULL
        if t["verdict"] != "FULL" or t["legs"].get("owner_typed") != "present":
            ok = fail("ARM 1", "expected FULL via leg 1 (legs.owner=present), got", t)
        else:
            print("  ARM 1 ok: owner in eaten window -> FULL via leg 1")

        # ARM 1p — a PRECOMPUTED compaction: the summary is stamped 40 min BEFORE its boundary.
        # The entry must carry the BOUNDARY time; reading the summary stamp gives the old value.
        # ⛔ OWN FIXTURE FILE. ARM 1b below re-scans `tx` expecting ARM 1's owner-bearing fixture;
        # writing this arm's two-record fixture into `tx` left ARM 1b passing with its mutation
        # neutralised ("owner absent" was true with or without leg 1).
        B = "2026-09-20T12:40:00.000Z"
        txp = os.path.join(d, "tp.jsonl")
        write(txp, [rec(type="system", subtype="compact_boundary", timestamp=B,
                        compactMetadata={"precomputed": True, "durationMs": 5}),
                    rec(isCompactSummary=True, timestamp=C2)])
        cp, _, _ = scan(txp, None)
        got = cp["compactions"][-1]["ts"] if cp["compactions"] else None
        if got != B:
            ok = fail("ARM 1p", "expected the boundary time %s on the compaction entry, got" % B, got)
        else:
            print("  ARM 1p ok: precomputed compaction dated by its boundary, not its summary stamp")

        # ARM 1q — the boundary stamp is consumed ONCE. A later summary with no boundary of its own
        # takes its own stamp, never the previous boundary's. No such summary exists in the corpus
        # today (2,197 boundaries / 2,197 summaries, paired); this pins the pop, which the corpus
        # cannot. Mutation: `cache.pop` -> `cache.get` and this arm goes RED.
        write(txp, [rec(type="system", subtype="compact_boundary", timestamp=B,
                        compactMetadata={"precomputed": True}),
                    rec(isCompactSummary=True, timestamp=C1),
                    rec(isCompactSummary=True, timestamp=C2)])
        cq, _, _ = scan(txp, None)
        got = [x["ts"] for x in cq["compactions"]]
        if got != [B, C2]:
            ok = fail("ARM 1q", "a boundary stamp must be consumed once; expected [B, C2], got", got)
        else:
            print("  ARM 1q ok: a boundary stamp attaches to ONE summary; the next takes its own")

        # ARM 3p — the boundary and its summary split across two INCREMENTAL runs, the cache
        # round-tripped through JSON as main() does. The pending boundary stamp must survive the
        # run boundary, or the split summary is dated by its preparation time again. ARM 3 compares
        # COUNTS only, so a boundary stamp held in a local instead of the cache passes it.
        write(txp, [rec(type="system", subtype="compact_boundary", timestamp=B,
                        compactMetadata={"precomputed": True})])
        c1p, _, _ = scan(txp, None)
        c1p = json.loads(json.dumps(c1p))
        with open(txp, "a") as fh:
            fh.write(rec(isCompactSummary=True, timestamp=C2) + "\n")
        c2p, rebuilt_p, _ = scan(txp, c1p)
        got = [x["ts"] for x in c2p["compactions"]]
        if rebuilt_p or got != [B] or "boundary_ts" in c2p:
            ok = fail("ARM 3p", "split boundary/summary across runs: expected [B], no rebuild, no leftover, got",
                      (got, rebuilt_p, c2p.get("boundary_ts")))
        else:
            print("  ARM 3p ok: boundary stamp survives an incremental run boundary and is consumed")

        # ARM 1b — MUTATION RESISTANCE: blind leg 1 and ARM 1 must go red.
        real = globals()["is_owner_record"]
        try:
            globals()["is_owner_record"] = lambda line, r=None: False
            cm, _, _ = scan(tx, None)
            tm = triage(cm, plan_new)
            if tm["verdict"] == "FULL" and tm["legs"].get("owner_typed") == "present":
                ok = fail("ARM 1b", "leg 1 deleted and ARM 1 still passes — vacuous", tm)
            else:
                print("  ARM 1b ok: deleting leg 1 flips ARM 1 (now %s/%s)" % (tm["verdict"], tm["legs"].get("owner_typed")))
        finally:
            globals()["is_owner_record"] = real

        # ARM 1c — leg 1 must see the QUEUED and slash-command shapes, not just typed.
        for label, r in (("queued", rec(type="user", promptSource="queued", timestamp="2026-09-20T11:00:00Z")),
                         ("slash", json.dumps({"type": "user", "message":
                                               {"content": "<command-name>/eli5</command-name>"},
                                               "timestamp": "2026-09-20T11:00:00Z"}))):
            write(tx, [rec(isCompactSummary=True, timestamp=C1), r,
                       rec(isCompactSummary=True, timestamp=C2)])
            c2, _, _ = scan(tx, None)
            t2 = triage(c2, plan_new)
            if t2["legs"].get("owner_typed") != "present":
                ok = fail("ARM 1c", "leg 1 blind to the %s shape" % label, t2); break
        else:
            print("  ARM 1c ok: leg 1 sees queued and slash-command shapes (house predicate)")

        # ARM 1d — a tool_result QUOTING "<command-name>" must NOT score as owner speech.
        # It is type=="user" with no promptSource, but its content is a LIST of blocks. The
        # pre-2026-09-21 raw-line grep matched it and reported 1 owner record for 0 real
        # (record 241990: this file's own owner-speech probe output). Self-contaminating
        # probe class, and it fails toward "owner present" -- the SAFE direction, which is
        # why it never surfaced. Mutation: restore `ps is None and "<command-name>" in line`
        # and this arm goes RED.
        probe = json.dumps({"type": "user", "message": {"content": [
            {"tool_use_id": "toolu_probe", "type": "tool_result",
             "content": "OWNER RECORDS: <command-name>/compact</command-name>"}]},
            "timestamp": "2026-09-20T11:00:00Z"})
        write(tx, [rec(isCompactSummary=True, timestamp=C1), probe,
                   rec(isCompactSummary=True, timestamp=C2)])
        c2, _, _ = scan(tx, None)
        t2 = triage(c2, plan_new)
        if t2["legs"].get("owner_typed") == "present":
            ok = fail("ARM 1d", "tool_result quoting <command-name> scored as owner speech", t2)
        else:
            print("  ARM 1d ok: tool_result quoting <command-name> is NOT owner speech")

        # ARM 2 — nothing eaten + plan after the window CLOSE -> LIGHT, for that reason.
        write(tx, [rec(isCompactSummary=True, timestamp=C1),
                   rec(type="assistant", timestamp="2026-09-20T11:00:00Z"),
                   rec(isCompactSummary=True, timestamp=C2)])
        c, _, _ = scan(tx, None)
        t = triage(c, plan_new)
        if t["verdict"] != "LIGHT" or not t["legs"]["plan"].startswith("written after"):
            ok = fail("ARM 2", "expected LIGHT for the after-close reason, got", t)
        else:
            print("  ARM 2 ok: clean window + current plan -> LIGHT (advisory=%s)" % t.get("advisory"))

        # ARM 2a — the verdict must carry NO authority.
        if t.get("advisory") is not True or "NONE" not in t.get("authority", ""):
            ok = fail("ARM 2a", "a LIGHT must declare itself advisory with no authority", t)
        else:
            print("  ARM 2a ok: LIGHT declares advisory=True, authority NONE")

        # ARM 2b — stale plan -> FULL *for the stale reason*.
        t = triage(c, plan_old)
        if t["verdict"] != "FULL" or not t["legs"]["plan"].startswith("stale"):
            ok = fail("ARM 2b", "stale plan must force FULL for the stale reason, got", t)
        else:
            print("  ARM 2b ok: stale plan -> FULL (%s)" % t["legs"]["plan"])

        # ARM 2c — every unknown fails toward FULL.
        for label, arg in (("no plan path", None), ("missing file", os.path.join(d, "nope.md"))):
            t = triage(c, arg)
            if t["verdict"] != "FULL":
                ok = fail("ARM 2c", "%s must fail toward FULL, got" % label, t); break
        else:
            print("  ARM 2c ok: unknown plan state fails toward FULL (both cases)")

        # ARM 3 — incremental read == from-zero read.
        p1 = os.path.join(d, "p.jsonl")
        allb = open(tx, "rb").read()
        full, _, _ = scan(tx, None)
        cut = allb.index(b"\n", len(allb) // 2) + 1
        open(p1, "wb").write(allb[:cut]); c1, _, _ = scan(p1, None)
        open(p1, "wb").write(allb);       c2, _, _ = scan(p1, c1)
        if (c2["records"], len(c2["owner_typed"]), len(c2["compactions"])) != \
           (full["records"], len(full["owner_typed"]), len(full["compactions"])):
            ok = fail("ARM 3", "incremental != from-zero", (c2["records"], full["records"]))
        else:
            print("  ARM 3 ok: incremental == from-zero (%d records)" % c2["records"])

        # ARM 4 — a shrunk transcript rebuilds, for the shrink reason.
        open(p1, "wb").write(allb[:cut])
        c3, rebuilt, _ = scan(p1, c2)
        if not rebuilt or c3.get("rebuild_reason") != "transcript shrank":
            ok = fail("ARM 4", "shrunk file must rebuild with the shrink reason", c3.get("rebuild_reason"))
        else:
            print("  ARM 4 ok: shrunk transcript -> rebuilt (%s)" % c3["rebuild_reason"])

        # ARM 5 — a partial trailing line is NOT consumed. Real before/after, not one
        # function compared against itself: scan the complete file, THEN append a torn
        # record and re-scan with that cache.
        open(p1, "wb").write(allb)
        base, _, _ = scan(p1, None)
        before_records, before_offset = base["records"], base["offset"]
        with open(p1, "ab") as fh:
            fh.write(b'{"type":"user","promptSource":"typ')
        after, _, _ = scan(p1, dict(base))
        if after["records"] != before_records or after["offset"] != before_offset:
            ok = fail("ARM 5", "partial tail was consumed (%d->%d records, %d->%d offset)"
                      % (before_records, after["records"], before_offset, after["offset"]))
        else:
            print("  ARM 5 ok: torn trailing record left unconsumed (%d records, offset held)" % after["records"])

        # ARM 6 — an OFF-BOUNDARY cached offset rebuilds. This is the guarantee that was
        # asserted in two documents and implemented in neither.
        open(p1, "wb").write(allb)
        bad = blank(); bad["offset"] = 7; bad["records"] = 1   # mid-record by construction
        c6, rebuilt6, _ = scan(p1, bad)
        if not rebuilt6 or c6.get("rebuild_reason") != "offset off a record boundary":
            ok = fail("ARM 6", "off-boundary offset must rebuild with that reason", c6.get("rebuild_reason"))
        else:
            print("  ARM 6 ok: off-boundary offset -> rebuilt (%s)" % c6["rebuild_reason"])

        # ARM 6b — and the rebuild must RECOVER the record the bad offset would have skipped.
        write(tx, [rec(isCompactSummary=True, timestamp=C1),
                   rec(type="user", promptSource="typed", timestamp="2026-09-20T11:00:00Z"),
                   rec(isCompactSummary=True, timestamp=C2)])
        skipping = blank()
        skipping["offset"] = os.path.getsize(tx) - 5      # past the owner record, mid-line
        skipping["records"] = 2
        c7, rebuilt7, _ = scan(tx, skipping)
        t7 = triage(c7, plan_new)
        if t7["verdict"] != "FULL" or t7["legs"].get("owner_typed") != "present":
            ok = fail("ARM 6b", "a skipping offset must not silently yield LIGHT", t7)
        else:
            print("  ARM 6b ok: skipping offset rebuilt and recovered the owner record -> FULL")

        # ARM 7 — a cache written under an OLDER schema is rejected, so its content is
        # re-derived rather than trusted. Without this the predicate fix reached
        # only transcripts nobody had cached yet: every existing cache kept the 822 list-shaped
        # false positives it was written with. The control is the other half and is what makes
        # the first arm mean anything: a CURRENT-schema cache must still load, or "rejects
        # everything" would pass the first assertion for the wrong reason.
        cp = os.path.join(d, "cache-schema.json")
        cur = blank(); cur["offset"] = 10; cur["records"] = 1
        open(cp, "w", encoding="utf-8").write(json.dumps(cur))
        if load_cache(cp) is None:
            ok = fail("ARM 7 control", "a CURRENT-schema cache must load", SCHEMA)
        else:
            stale = dict(cur); stale["schema"] = SCHEMA - 1
            open(cp, "w", encoding="utf-8").write(json.dumps(stale))
            if load_cache(cp) is not None:
                ok = fail("ARM 7", "a stale-schema cache must be rejected", stale["schema"])
            else:
                print("  ARM 7 ok: schema %d loads, schema %d rejected -> rebuild"
                      % (SCHEMA, SCHEMA - 1))

        # ── ARMS 8x — the Step 4 owner-speech window. ONE fixture, every
        # population with a must-fire record AND a must-not-fire twin that differs from it in
        # exactly the field the predicate keys on. End-to-end through scan() + owner_window(),
        # because the (f) link lives in the CACHE and pre-dates the window.
        T = "2026-09-20T11:00:00Z"

        def u(content, **kw):
            d = {"type": "user", "timestamp": T, "message": {"role": "user", "content": content}}
            d.update(kw)
            return json.dumps(d)

        def tres(tid, content="ok", **kw):
            return u([{"type": "tool_result", "tool_use_id": tid, "content": content}], **kw)

        def tuse(tid, name, inp):
            return json.dumps({"type": "assistant", "timestamp": T, "message": {"role": "assistant",
                               "content": [{"type": "tool_use", "id": tid, "name": name, "input": inp}]}})

        def qc(prompt, kind, mode):
            return json.dumps({"type": "attachment", "timestamp": T, "attachment": {
                "type": "queued_command", "prompt": prompt, "commandMode": mode,
                "origin": {"kind": kind} if kind else None}})

        QS = [{"question": "Q1", "options": [{"label": "Opt A (Recommended)"}, {"label": "Opt B"}]},
              {"question": "Q2", "options": [{"label": "Opt A (Recommended)"}, {"label": "Opt B"}]},
              {"question": "Q3", "multiSelect": True,
               "options": [{"label": "Opt A (Recommended)"}, {"label": "Opt B"}]}]
        ask_in = {"questions": QS}
        txw = os.path.join(d, "w.jsonl")
        write(txw, [
            u("OUTSIDE-THE-WINDOW", promptSource="typed"),                     # before prev compaction
            tuse("toolu_ask1", "AskUserQuestion", ask_in),                     # (f) use PRE-DATES the window
            rec(isCompactSummary=True, timestamp=C1, type="user"),
            qc("C-HIS-WORDS", "human", "prompt"),                              # (c) must fire
            qc("C-TASK-NOTE", "human", "task-notification"),                   # (c) older-harness twin: not the owner
            qc("C-PEER", "peer", "prompt"),                                    # (c) peer: not the owner
            tres("toolu_ask1", "Your questions have been answered", toolUseResult={
                "questions": QS, "answers": {"Q1": "Opt A (Recommended)", "Q2": "F-HIS-OWN-WORDS",
                                             "Q3": "Opt A (Recommended), Opt B"}}),   # (f) must fire
            tuse("toolu_ask2", "AskUserQuestion", ask_in),
            tres("toolu_ask2", "No response after 60s", toolUseResult={"questions": QS, "answers": {}}),
            tres("toolu_bash0", "AskUserQuestion answers", toolUseResult={
                "questions": QS, "answers": {"Q1": "Opt B"}}),                 # unlinked: not (f)
            tuse("toolu_bash1", "Bash", {"command": "G-REFUSED-CMD"}),
            tres("toolu_bash1", "The user doesn't want to proceed", toolDenialKind="user-rejected"),
            tuse("toolu_bash2", "Bash", {"command": "G-HOOK-DENY"}),
            tres("toolu_bash2", "denied by hook", toolDenialKind="permission-rule"),
            tuse("toolu_bash3", "Bash", {"command": "G-CLASSIFIER"}),
            tres("toolu_bash3", "blocked", toolDenialKind="automode-blocked"),
            tres("toolu_bash4", "the tool use was rejected (quoted in output)"),
            tuse("toolu_ask3", "AskUserQuestion", ask_in),
            tres("toolu_ask3", "rejected", toolDenialKind="user-rejected"),    # (g) dismissed question
            json.dumps({"type": "system", "subtype": "local_command", "timestamp": T,
                        "content": "<command-name>/model</command-name><command-args>opus</command-args>"}),
            json.dumps({"type": "system", "subtype": "local_command", "timestamp": T,
                        "content": "<local-command-stdout>Kept model as \x1b[1mOpus\x1b[22m</local-command-stdout>"}),
            u('"my cell one" - ship it; "my cell two" - no', promptSource="typed"),
            rec(isCompactSummary=True, timestamp=C2, type="user",
                message={"content": "summary quoting <command-name>/eli5</command-name>"}),
            u("<command-name>/eli5</command-name><command-args>E-HIS-ARGS</command-args>",
              turnOrigin="human"),                                             # (e) post, must fire
            u("<command-name>/pause</command-name><command-args>E-CRON-ARGS</command-args>",
              turnOrigin="scheduled"),                                         # (e) cron twin: not the owner
            u("x", promptSource="sdk"),                                        # unrecognised kind
            tres("toolu_probe", "dump: <command-name>/compact</command-name>"
                 "<command-args>E-PROBE-DUMP</command-args>"),                 # (e) window twin of ARM 1d
            u("<command-name>/eli5</command-name><command-args>E-UNSEEN-ORIGIN</command-args>",
              turnOrigin="remote"),                                            # unseen origin: the owner + UNRECOGNISED
            u("<bash-input>H-BANG</bash-input>"),                              # `!` command: UNRECOGNISED shape
        ])
        cw, _, _ = scan(txw, None)
        win = owner_window(txw, cw)
        E = win.get("entries") or []
        by = lambda p: [e for e in E if e["pop"] == p]
        texts = json.dumps(E)

        cs = by("c")
        if [e["text"] for e in cs] != ["C-HIS-WORDS"]:
            ok = fail("ARM 8c", "(c) must be exactly the human/prompt attachment, got", [e["text"] for e in cs])
        else:
            print("  ARM 8c ok: (c) fires on origin=human+commandMode=prompt; task-notification and peer twins do not")

        fs = by("f")
        want = [("Q1", "CHOICE", ["Opt A"]), ("Q2", "FREE TEXT", "F-HIS-OWN-WORDS"),
                ("Q3", "CHOICE", ["Opt A", "Opt B"])]
        got = [(a["question"], a["kind"], a["value"]) for e in fs for a in e["answers"]]
        if len(fs) != 1 or got != want or len(by("f-none")) != 1:
            ok = fail("ARM 8f", "(f): one linked answer (choice / free text / multi-select), the timeout "
                      "as f-none, the unlinked result absent; got", (got, len(by("f-none"))))
        else:
            print("  ARM 8f ok: (f) links a pre-window ask, splits choice/free text/multi-select; "
                  "timeout and unlinked answers do not fire")

        gs = by("g")
        refused = [e["refused"] for e in gs]
        if len(gs) != 2 or "G-REFUSED-CMD" not in refused[0] or "DISMISSED" not in refused[1] \
                or "G-HOOK-DENY" in texts or "G-CLASSIFIER" in texts:
            ok = fail("ARM 8g", "(g) must be the user-rejected Bash call + the dismissed question only, got", refused)
        else:
            print("  ARM 8g ok: (g) fires on user-rejected only; hook deny, classifier and a quoted 'rejected' do not")

        es = by("e")
        if [(e["text"], e["where"]) for e in es] != [("E-HIS-ARGS", "post"), ("E-UNSEEN-ORIGIN", "post")] \
                or [e["text"] for e in by("e-machine")] != ["E-CRON-ARGS"] or "E-PROBE-DUMP" in texts \
                or classify_record(json.loads(rec(type="user", isCompactSummary=True, message={
                    "content": "<command-name>/x</command-name>"})), {}, {}) \
                or is_owner_record("", json.loads(u("<command-name>/x</command-name>", turnOrigin="scheduled"))):
            ok = fail("ARM 8e", "(e) human slash only; cron twin as e-machine; summary never; got",
                      ([(e["text"], e["where"]) for e in es], [e["text"] for e in by("e-machine")]))
        else:
            print("  ARM 8e ok: (e) fires post-compaction for a human slash; a scheduled one is NOT the owner; "
                  "the summary quoting <command-name> is neither")

        if "OUTSIDE-THE-WINDOW" in texts or [e["where"] for e in by("a")] != ["pre"]:
            ok = fail("ARM 8w", "window must start at the previous compaction; got", [e["where"] for e in by("a")])
        else:
            print("  ARM 8w ok: window opens at the previous compaction; pre/post labelled")

        unk = [(x["kind"], x["value"]) for x in win.get("unrecognised") or []]
        if ("promptSource", "sdk") not in unk or any(v == "system" for _, v in unk) \
                or ("turnOrigin", "remote") not in unk or ("user string shape", "bash-input") not in unk \
                or any(k == "user string shape" and v != "bash-input" for k, v in unk):
            ok = fail("ARM 8u", "unknown promptSource must be censused, known ones not; got", unk)
        else:
            print("  ARM 8u ok: an unknown promptSource is printed as UNRECOGNISED; a known one is not")
        bi = [x for x in win.get("unrecognised") or [] if x["value"] == "bash-input"]
        if not bi or "H-BANG" not in bi[0].get("first_text", "") or not bi[0]["first_text"].startswith("user: "):
            ok = fail("ARM 8t", "an UNRECOGNISED row must carry its first record's own text; got", bi)
        else:
            print("  ARM 8t ok: an UNRECOGNISED row carries its first record's own opening text")
        t2 = os.path.join(d, "t2.jsonl")   # ARM 8t2: FIRST record wins; no shape raises; no blank preview
        with open(t2, "w", encoding="utf-8") as fh:
            fh.write("\n".join([u("s", isCompactSummary=True), u("P-FIRST one"), u("P-SECOND two"),
                                json.dumps({"type": "brand-new", "message": "a str", "attachment": "a str"}),
                                json.dumps({"type": "system", "subtype": "brand_new", "content": "SYS-BODY"})]) + "\n")
        try:
            ft = {x["value"]: x["first_text"] for x in owner_window(t2, {"compactions": [
                {"index": 1, "ts": "", "offset": 0}], "offset": os.path.getsize(t2)})["unrecognised"]}
        except Exception as e:  # noqa: BLE001
            ft = {"raised": repr(e)}
        if "P-FIRST" not in ft.get("prose (no leading tag)", "") or "SYS-BODY" not in ft.get("brand_new", "") \
                or not ft.get("brand-new", "").startswith("brand-new: ("):
            ok = fail("ARM 8t2", "first record's text, read from every shape, never a raise; got", ft)
        else:
            print("  ARM 8t2 ok: the FIRST record's text, a system body, and an unknown shape that does not raise")

        rul = [r for e in by("a") for r in e.get("rulings") or []]
        if rul != [("my cell one", "ship it;"), ("my cell two", "no")]:   # the spec's regex keeps the ';'
            ok = fail("ARM 8q", "quote-then-instruct must split into two pairs, got", rul)
        else:
            print("  ARM 8q ok: a two-ruling quote message splits into 2 pairs")

        # ARM 8q2 — a split that would cut inside my quote, or drop his words, gives NO pairs:
        # the record is then read whole, never mis-attributed.
        unclean = {
            'quote inside my quote': '"run the "fast" - path then stop" - yes do it',
            'his words after the pair': '"x" - yes, and "y" too',
            'his second quote unanswered': '" the plan" - hold this; " item 12 - what does it cover',
            'his own quoted word': '"Call it the release plan?" - no, call it "launch" - that reads better',
            'two inch marks': '"Print at 12" - wide or 8" - narrow?" - wide',
        }
        bad = {k: quote_rulings(v) for k, v in unclean.items() if quote_rulings(v)}
        clean = quote_rulings('"The second check?" - yes go ahead')
        clean2 = quote_rulings('"A?" - yes\n"B?" - no')   # a line break still starts a new pair
        # unsplit_quote is the shared UNSPLIT signal (this file's render_owner and owner-words.py):
        # a refused split and a quote with no ruling shape are unsplit; a clean split, a message not
        # opening with a quote, and a non-text population are not.
        cases = [({"pop": "a", "text": t, "rulings": quote_rulings(t)}, True) for t in unclean.values()]
        cases += [({"pop": "c", "text": "“just my pasted line”", "rulings": []}, True),
                  ({"pop": "b", "text": '"my line, queued"', "rulings": []}, True),
                  ({"pop": "b2", "text": '"my line, as a suggestion"', "rulings": []}, True),
                  ({"pop": "e", "text": '"my line, as an /eli5 argument"', "rulings": []}, True),
                  ({"pop": "a", "text": '"The second check?" - yes go ahead', "rulings": clean}, False),
                  ({"pop": "a", "text": "no quote here", "rulings": []}, False),
                  ({"pop": "f", "text": '"x"', "rulings": []}, False)]
        wrong = [(e["pop"], e["text"]) for e, want in cases if unsplit_quote(e) is not want]
        if bad or clean != [("The second check?", "yes go ahead")] or clean2 != [("A?", "yes"), ("B?", "no")] or wrong:
            ok = fail("ARM 8q2", "unclean splits must give [] and a clean one its pair, and "
                      "unsplit_quote must mark exactly the unsplit text records, got", (bad, clean, clean2, wrong))
        else:
            print("  ARM 8q2 ok: %d unclean quote splits give no pairs; a clean one still splits; "
                  "unsplit_quote marks the %d unsplit records and none of the %d others"
                  % (len(unclean), sum(w for _, w in cases), sum(not w for _, w in cases)))

        ds = by("d")
        if len(ds) != 1 or ds[0].get("output") != "Kept model as Opus":
            ok = fail("ARM 8d", "(d) must pair command + output into ONE entry, got", ds)
        else:
            print("  ARM 8d ok: (d) command and output records pair into one entry, read by output")

        # ARM 8k — the WHOLE-transcript controls the skill tells a reader to trust before a zero.
        got = (cw["ask_answered_total"], cw["rejected_total"], cw["ps_census"].get("typed"),
               cw["ps_census"].get("sdk"))
        if got != (1, 2, 2, 1):
            ok = fail("ARM 8k", "controls (answered, user-rejected, typed, sdk) expected (1, 2, 2, 1), got", got)
        else:
            print("  ARM 8k ok: controls count linked non-empty answers and user-rejected only")

        # ARM 8r — the RENDERED section: UNRECOGNISED block, positive control, window control.
        txt = render_owner(win, cw)
        bad = render_owner(dict(win, entries=[e for e in E if e["pop"] != "e"]), cw)
        if "UNRECOGNISED (read these by hand" not in txt or "'bash-input'" not in txt \
                or "first record (numbered from 1): user: <bash-input>H-BANG" not in txt \
                or "record %d " % cw["owner_typed"][-1]["index"] not in txt \
                or "window control: 3 of 3" not in txt or "CONTROL MISMATCH" not in bad:
            ok = fail("ARM 8r", "render must list UNRECOGNISED, name the newest owner record and "
                      "cross-check the window; got", txt[-600:])
        else:
            print("  ARM 8r ok: render lists UNRECOGNISED, the positive control, and a window control that can fail")

        # ARM 8r2 — the rendered UNSPLIT-QUOTE line (a mutant deleting it left every arm green). An unclean quote message gets the line under
        # its record; a clean quote-ruling and a plain message do not.
        def _one(text, idx):
            return {"where": "post", "idx": idx, "ts": "2026-10-23T09:00:00.000Z", "pop": "a",
                    "text": text, "rulings": quote_rulings(text)}
        extra = [_one('"x" - yes, and "y" too', 900001), _one('"The second check?" - yes go ahead', 900002),
                 _one("no quote here", 900003)]
        r_lines = render_owner(dict(win, entries=list(win["entries"]) + extra), cw).splitlines()
        flagged = [r_lines[i - 1].split()[1] for i, ln in enumerate(r_lines)
                   if ln.strip().startswith("UNSPLIT-QUOTE:") and i > 0]
        if flagged != ["900001"]:
            ok = fail("ARM 8r2", "UNSPLIT-QUOTE must sit under the unclean record only (900001), got", flagged)
        else:
            print("  ARM 8r2 ok: render prints UNSPLIT-QUOTE under the unclean quote record and nowhere else")

        # ARM 8m — main() itself: prints the section, and names a schema-triggered rebuild.
        os.makedirs(os.path.join(d, STATE_DIR))
        stale = blank(); stale["schema"] = SCHEMA - 1
        open(os.path.join(d, cache_path("<sid8>")), "w").write(json.dumps(stale))
        import subprocess
        r = subprocess.run([sys.executable, os.path.abspath(__file__), "--sid", "<sid8>-selftest",
                            "--transcript", txw, "--no-update"], cwd=d, capture_output=True, text=True)
        if r.returncode != 0 or "=== OWNER SPEECH IN THE RECOVERY WINDOW" not in r.stdout \
                or "cache schema %d -> %d" % (SCHEMA - 1, SCHEMA) not in r.stdout:
            ok = fail("ARM 8m", "main must print the section and name the schema rebuild; got",
                      (r.returncode, r.stdout[:300], r.stderr[-300:]))
        else:
            print("  ARM 8m ok: main prints the owner section and names a schema %d -> %d rebuild"
                  % (SCHEMA - 1, SCHEMA))

        # ARM 8p — a PREPARED-not-APPLIED compaction (pending marker, and txw holds NO boundary record)
        # must stop main() before it indexes: deferred line, no owner section, no triage row.
        # Control: --force indexes anyway. Both arms must be able to fail. The DEFERRED run is NOT
        # --no-update, so the stale cache ARM 8m planted must come back byte-identical (a gate moved
        # below the cache write survived this arm while it ran --no-update).
        sd = os.path.join(d, STATE_DIR)
        cp8 = os.path.join(d, cache_path("<sid8>"))
        cache_before = open(cp8, "rb").read()
        open(os.path.join(sd, "post-compact-pending-<sid8>-selftest"), "w").write(
            "compacted=2026-09-20 13:00:00 UTC trigger=manual focus=no focus_args=<none>\n")
        logp = os.path.join(d, LOG)
        before = open(logp).read().count("\n") if os.path.exists(logp) else 0
        r = subprocess.run([sys.executable, os.path.abspath(__file__), "--sid", "<sid8>-selftest",
                            "--transcript", txw, "--state-dir", sd],
                           cwd=d, capture_output=True, text=True)
        after = open(logp).read().count("\n") if os.path.exists(logp) else 0
        cache_after = open(cp8, "rb").read()
        rf = subprocess.run([sys.executable, os.path.abspath(__file__), "--sid", "<sid8>-selftest",
                             "--transcript", txw, "--no-update", "--state-dir", sd, "--force"],
                            cwd=d, capture_output=True, text=True)
        if r.returncode != 0 or '"deferred": true' not in r.stdout or "NO compact_boundary record" not in r.stdout \
                or "=== OWNER SPEECH IN THE RECOVERY WINDOW" in r.stdout or after != before \
                or cache_after != cache_before \
                or "=== OWNER SPEECH IN THE RECOVERY WINDOW" not in rf.stdout \
                or '"deferral": "SKIPPED (--force)"' not in rf.stdout:
            ok = fail("ARM 8p", "a prepared-not-applied compaction must stop main (deferred line, no "
                      "section, no log row, cache untouched) and --force must index; got",
                      (r.returncode, r.stdout[:200], before, after, rf.returncode, rf.stdout[:120]))
        else:
            print("  ARM 8p ok: DEFERRED stops main with no section, no triage row, cache untouched; --force indexes")

        # ARM 8p2 — the PRODUCTION shapes, on a transcript that carries compact_boundary records (txw
        # carries none, so the arm above reaches DEFERRED only through the no-boundary branch):
        # (i) marker OLDER than the applied boundary = RECOVER, and main must index WITHOUT --force;
        # (ii) DEFERRED without --no-update must leave an existing cache byte- and mtime-identical;
        # (iii) a missing sibling is RULE-UNAVAILABLE: index, say so on stderr, never stop.
        # (i) and (iii) also pin the "deferral" field on the indexing path (8p pins only its --force value).
        txb = os.path.join(d, "wb.jsonl")
        lines = open(txw).read().splitlines()
        c2 = [i for i, l in enumerate(lines) if C2 in l and "isCompactSummary" in l][0]
        lines.insert(c2, rec(type="system", subtype="compact_boundary", timestamp="2026-09-20T12:00:05.000Z"))
        write(txb, lines)
        mk = os.path.join(sd, "post-compact-pending-<sid8b>-selftest")
        args = [sys.executable, os.path.abspath(__file__), "--sid", "<sid8b>-selftest", "--transcript", txb,
                "--state-dir", sd]
        open(mk, "w").write("compacted=2026-09-20 11:30:00 UTC trigger=auto focus=no focus_args=<none>\n")
        rr = subprocess.run(args, cwd=d, capture_output=True, text=True)
        cp = os.path.join(d, cache_path("<sid8b>"))
        snap = (os.stat(cp).st_mtime_ns, open(cp, "rb").read()) if os.path.exists(cp) else None
        open(mk, "w").write("compacted=2026-09-20 13:00:00 UTC trigger=auto focus=no focus_args=<none>\n")
        rd = subprocess.run(args, cwd=d, capture_output=True, text=True)
        same = snap is not None and snap == (os.stat(cp).st_mtime_ns, open(cp, "rb").read())
        lone = os.path.join(d, "lone"); os.makedirs(lone)
        shutil.copy(os.path.abspath(__file__), lone)
        ru = subprocess.run([sys.executable, os.path.join(lone, os.path.basename(__file__))] + args[2:],
                            cwd=d, capture_output=True, text=True)
        if "=== OWNER SPEECH IN THE RECOVERY WINDOW" not in rr.stdout or '"deferred"' in rr.stdout \
                or '"deferred": true' not in rd.stdout or "previous window" not in rd.stdout or not same \
                or "=== OWNER SPEECH IN THE RECOVERY WINDOW" not in ru.stdout or '"deferred"' in ru.stdout \
                or "RULE-UNAVAILABLE" not in ru.stderr \
                or '"deferral": "RECOVER"' not in rr.stdout or '"deferral": "RULE-UNAVAILABLE: ' not in ru.stdout:
            ok = fail("ARM 8p2", "RECOVER must index without --force, DEFERRED must not touch the cache, "
                      "a missing rule must index and say so; got",
                      (rr.stdout[:120], rd.stdout[:80], same, ru.stdout[:80], ru.stderr[-120:]))
        else:
            print("  ARM 8p2 ok: RECOVER indexes, DEFERRED leaves the cache untouched, RULE-UNAVAILABLE indexes and says so")

        # ARM 9 — find_bank places the newest /pre-compact heading against the window (C1 previous,
        # C2 newest). Each case asserts the STATUS and the parsed time, so a mutation that drops the
        # STALE or LATER branch, the newest-wins compare, the no-seconds pad or the heading anchor reds.
        comps = [{"index": 1, "ts": C1}, {"index": 2, "ts": C2}]
        cases = [
            ("FRESH", ["## PRE-COMPACT — 2026-09-20T11:30:00Z (AUTO)"], "FRESH", "2026-09-20T11:30:00"),
            ("STALE", ["## PRE-COMPACT — 2026-09-20T09:30:00Z"], "STALE", "2026-09-20T09:30:00"),
            ("LATER", ["## PRE-COMPACT — 2026-09-20T12:30:00Z"], "LATER", "2026-09-20T12:30:00"),
            # newest in the MIDDLE: keep-first reads 09:30 (STALE), keep-last reads 10:30, only by-time reads 11:30
            ("newest by time, not position", ["## PRE-COMPACT — 2026-09-20T09:30:00Z",
                                              "## PRE-COMPACT — 2026-09-20T11:30:00Z",
                                              "## PRE-COMPACT — 2026-09-20T10:30:00Z"], "FRESH", "2026-09-20T11:30:00"),
            ("no seconds", ["## PRE-COMPACT 2026-09-20T11:30Z — owner typed /pre-compact"], "FRESH", "2026-09-20T11:30:00"),
            ("date-only heading", ["## PRE-COMPACT STATE 2026-09-20 (owner)"], "NONE", None),
            ("prose mention is not a heading", ["the PRE-COMPACT — 2026-09-20T11:45:00Z block said so",
                                                "## PRE-COMPACT — 2026-09-20T09:30:00Z"], "STALE", "2026-09-20T09:30:00"),
            ("level-3 heading", ["### PRE-COMPACT — 2026-09-20T11:00:00Z"], "FRESH", "2026-09-20T11:00:00"),
            # a bank written after this boundary must not hide the one written for it
            ("fresh + later", ["## PRE-COMPACT — 2026-09-20T11:30:00Z",
                               "## PRE-COMPACT — 2026-09-20T12:30:00Z"], "FRESH", "2026-09-20T11:30:00"),
            ("at the boundary beats earlier", ["## PRE-COMPACT — 2026-09-20T11:30:00Z",
                                               "## PRE-COMPACT — 2026-09-20T12:00:00Z"], "FRESH", "2026-09-20T12:00:00"),
        ]
        bank_ok = True
        for label, lines, want, want_ts in cases:
            bp = os.path.join(d, "bank.md")
            write(bp, ["# plan", ""] + lines)
            got = find_bank(bp, comps)
            if got.get("status") != want or got.get("ts") != want_ts:
                bank_ok = fail("ARM 9", "%s: want %s %s, got" % (label, want, want_ts), got)
        write(os.path.join(d, "bank.md"), ["## PRE-COMPACT STATE 2026-09-20 (owner)"])
        if find_bank(os.path.join(d, "bank.md"), [{"index": 2, "ts": C2}]) != {"status": "NONE", "undated": 1}:
            bank_ok = fail("ARM 9", "date-only plan with one compaction should still read NONE and count the undated bank")
        write(os.path.join(d, "bank.md"), ["## PRE-COMPACT — 2026-09-20T08:00:00Z"])
        if find_bank(os.path.join(d, "bank.md"), [{"index": 2, "ts": C2}]).get("status") != "FRESH":
            bank_ok = fail("ARM 9", "first compaction of a session: any bank before it is FRESH")
        if find_bank(os.path.join(d, "missing.md"), comps).get("status") != "NO-PLAN":
            bank_ok = fail("ARM 9", "missing plan should read NO-PLAN")
        # render: the entry after the bank is AFTER-BANK, the one before it BANKED; no bank -> untagged
        win9 = {"status": "ok", "window": {"from_compaction_index": 1, "newest_compaction_index": 2, "to_index": 9},
                "counts": {p: {"pre": 0, "post": 0} for p in POP_ORDER}, "census": {}, "unrecognised": [],
                "entries": [{"where": "pre", "idx": 3, "ts": "2026-09-20T11:00:00.000Z", "pop": "a", "text": "early"},
                            {"where": "pre", "idx": 5, "ts": "2026-09-20T11:45:00.000Z", "pop": "a", "text": "late"}]}
        cache9 = {"owner_typed": [], "ps_census": {}, "ask_ids": {}}
        r_bank = render_owner(win9, cache9, {"status": "FRESH", "ts": "2026-09-20T11:30:00", "line": 3})
        r_none = render_owner(win9, cache9, {"status": "NONE"})
        if not ("3 2026-09-20T11:00:00.000Z (a) BANKED" in r_bank and "5 2026-09-20T11:45:00.000Z (a) AFTER-BANK" in r_bank
                and "Report EVERY record below: the 1 tagged AFTER-BANK" in r_bank
                and "early" in r_bank and "late" in r_bank):     # both records still listed, BANKED included
            bank_ok = fail("ARM 9", "render with a FRESH bank must tag BANKED / AFTER-BANK and count 1 after", r_bank)
        if "BANKED" in r_none or "AFTER-BANK" in r_none or "BANK: NONE" not in r_none:
            bank_ok = fail("ARM 9", "render with no bank must say so and tag nothing", r_none)
        if bank_ok:
            print("  ARM 9 ok: find_bank FRESH/STALE/LATER/NONE/NO-PLAN, newest at or before the boundary, no-seconds pad, heading-only; render tags")
        ok = ok and bank_ok
        # ARM 10: the triage log row carries the bank the recovery started from (#262 family 1:
        # 0 of 1,086 rows did, so the save->recovery pair was measurable only by reading plans by hand).
        # Through main() as ARM 8p2 runs it (cwd=d, so LOG lands at logp): a direct log_verdict call
        # pins the row builder but not main's `"bank": bank`, and dropping that left the arm green.
        # txb's window is C1 .. the 12:00:05 boundary, so an 11:30 bank is FRESH.
        write(os.path.join(d, "bank10.md"), ["# plan", "", "## PRE-COMPACT — 2026-09-20T11:30:00Z (AUTO)"])
        open(mk, "w").write("compacted=2026-09-20 11:30:00 UTC trigger=auto focus=no focus_args=<none>\n")
        n10 = open(logp).read().count("\n") if os.path.exists(logp) else 0
        r10 = subprocess.run(args + ["--no-update", "--plan", os.path.join(d, "bank10.md")],
                             cwd=d, capture_output=True, text=True)
        rows10 = open(logp).read().splitlines() if os.path.exists(logp) else []
        row = json.loads(rows10[-1]) if len(rows10) == n10 + 1 else {}
        rn = subprocess.run(args + ["--no-update"], cwd=d, capture_output=True, text=True)   # no --plan: NO-PLAN row
        rowsn = open(logp).read().splitlines() if os.path.exists(logp) else []
        rown = json.loads(rowsn[-1]) if len(rowsn) == len(rows10) + 1 else {}
        if r10.returncode != 0 or row.get("bank") != {"status": "FRESH", "ts": "2026-09-20T11:30:00", "line": 3, "undated": None} \
                or rn.returncode != 0 or rown.get("bank") != {"status": "NO-PLAN", "ts": None, "line": None, "undated": None}:
            ok = fail("ARM 10", "main's triage row must carry the bank (FRESH with --plan, NO-PLAN without); got",
                      (r10.returncode, len(rows10) - n10, row.get("bank"), r10.stderr[-200:],
                       rn.returncode, len(rowsn) - len(rows10), rown.get("bank"), rn.stderr[-200:]))
        else:
            print("  ARM 10 ok: the triage row main writes carries the bank")
    finally:
        shutil.rmtree(d, ignore_errors=True)
    print("SELF-TEST:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
