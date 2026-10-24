#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
owner-words.py — the owner's own words from one or more session transcripts, verbatim.

WHY: panel briefs carried the host session's reading of the owner instead of his words. Two
premises in one brief steered all five seats of a panel: one was the host's reading of an owner
remark that the remark's own stated reason contradicted, the other a "ruling:" line calling a test parked
that had in fact been approved, with only its setup steps parked. The fix /expert-review now runs: a fresh agent writes the brief from
THIS script's output plus the files, and a second fresh agent checks it. The host never
paraphrases him into a brief.

WHAT: every owner record, in transcript order, with its timestamp and population tag, using the
SAME classifier /post-compact uses (scripts/post-compact-recovery-index.py classify_record), so
the populations match its Step 4 table: (a) typed, (b) queued, (b2) accepted suggestion,
(c) queued-command attachment, (e) slash command, (f) answered question, (g) refused tool call,
(d) local slash command. Machine-originated look-alikes (e-machine) and the two bookkeeping
populations (d-out, f-none) are left out; any OTHER population the classifier's POP_ORDER does
not list prints as UNKNOWN POPULATION, never as his words (an allow-list, so a machine shape
added to the classifier later cannot pass as him).

A message that opens by quoting the assistant and then rules on it ("<my text>" - approved) is
split by the classifier's quote_rulings: the quoted part prints as THE ASSISTANT'S WORDS, never
as his, and only the part after the dash is his. When the split is not clean (a quote inside my
quote, or his words left outside every pair) the classifier gives no pairs and this script
prints the message whole as UNSPLIT, so nothing of mine can print as HIS ANSWER. A line opening
with ">" inside his message is text he pasted or quoted, and HE SAID is labelled so.

USAGE
  python3 scripts/owner-words.py                         # this session (CLAUDE_CODE_SESSION_ID)
  python3 scripts/owner-words.py --sid <sid8> --sid <sid8>
  python3 scripts/owner-words.py --grep 'reach|outreach|ads?\\b' --since 2026-10-20
  python3 scripts/owner-words.py --self-test             # also run by the project's test suite

--grep is case-insensitive over everything in the record, including my quoted half, so a ruling
on a quoted line about the topic is kept; a hit found ONLY in my quoted half is labelled as such.
Read-only: writes nothing.
"""
import argparse, glob, importlib.util, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
# The harness keys a project's transcripts by its absolute path with every non-alphanumeric
# character turned into "-" (the same derivation session-manifest.py uses).
PROJECTS = os.path.expanduser("~/.claude/projects/" + re.sub(r"[^a-zA-Z0-9]", "-", os.path.dirname(HERE)))
SKIP_POPS = {"e-machine", "d-out", "f-none"}
PASTED_BLOCK = re.compile(r"^\s*>", re.M)


def _load_index():
    spec = importlib.util.spec_from_file_location(
        "pc_index", os.path.join(HERE, "post-compact-recovery-index.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def resolve(sid):
    """A full or 8-hex session id -> its top-level transcript path, or None."""
    if not sid:
        return None
    exact = os.path.join(PROJECTS, sid + ".jsonl")
    if os.path.isfile(exact):
        return exact
    hits = sorted(glob.glob(os.path.join(PROJECTS, sid + "*.jsonl")))
    return hits[0] if len(hits) == 1 else None


def records(path, idx_mod):
    """Yield owner entries from one transcript, in order. One streaming pass: an
    AskUserQuestion tool_use precedes its answer in every transcript checked (336),
    so the (f) link builds as it goes; nothing written down guarantees that order."""
    ask_ids, tool_names = {}, {}
    his_pops = set(idx_mod.POP_ORDER)
    with open(path, "rb") as fh:
        for n, raw in enumerate(fh, 1):
            try:
                r = json.loads(raw.decode("utf-8", errors="replace"))
            except Exception:
                continue
            if not isinstance(r, dict):
                continue
            if r.get("type") == "assistant":
                for b in (r.get("message") or {}).get("content") or []:
                    if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("id"):
                        tool_names[b["id"]] = b.get("name") or ""
                        if b.get("name") == "AskUserQuestion":
                            ask_ids[b["id"]] = n
                continue
            if r.get("isCompactSummary") is True:
                continue
            for e in idx_mod.classify_record(r, ask_ids, tool_names):
                if e["pop"] in SKIP_POPS:
                    continue
                e["his"] = e["pop"] in his_pops
                e["unsplit"] = idx_mod.unsplit_quote(e)
                e["ts"] = r.get("timestamp", "") or ""
                e["record"] = n
                yield e


def haystack(e):
    # "text" is the whole message, my quoted half included, so a ruling's two halves need no
    # separate entry here (a rulings loop added nothing).
    parts = [e.get("text") or "", e.get("command") or "", e.get("args") or "",
             e.get("user_said") or ""]
    for a in e.get("answers") or []:
        parts += [str(a.get("question")), json.dumps(a.get("value"), ensure_ascii=False)]
    return "\n".join(parts)


def keep(e, since, rx):
    """The --since / --grep filter, out of main() so the self-test reaches it."""
    if since and e["ts"] and e["ts"] < since:
        return False
    return not rx or bool(rx.search(haystack(e)))


def render(e, sid8, rx=None):
    head = "[%s %s #%d] (%s)" % (sid8, e["ts"][:19] + "Z" if e["ts"] else "no-timestamp",
                                  e["record"], e["pop"])
    out = [head]
    text = e.get("text") or ""
    if not e.get("his", False):
        out.append("  UNKNOWN POPULATION — NOT known to be his words; read record #%d whole: %s"
                   % (e["record"], text or e.get("args") or ""))
        return "\n".join(out)
    if e["pop"] in ("d", "e"):
        # The command name prints first, whatever its argument holds: an /eli5 "<my line>" or
        # /explain "<my line>" argument is labelled below, never printed in the command's place
        # (measured over 500 records).
        out.append("  COMMAND: /%s %s" % ((e.get("command") or "").lstrip("/"),
                                          text or e.get("args") or ""))
    if e.get("rulings"):
        for q, a in e["rulings"]:
            out.append("  QUOTING THE ASSISTANT (not his words): \"%s\"" % q)
            out.append("  HIS ANSWER%s: %s" % (
                " (lines opening with > are text he pasted or quoted, not his words)"
                if PASTED_BLOCK.search(a) else "", a))
        if rx and not any(rx.search(a) for _, a in e["rulings"]):
            out.append("  (--grep matched only the assistant's quoted text, not his answer)")
    elif e.get("unsplit") and e["pop"] == "e":
        out.append("  UNSPLIT — the command's argument opens with a quote and has no clean "
                   "quote-then-rule split; the quoted part is most likely the assistant's text")
    elif e.get("unsplit"):
        out.append("  UNSPLIT — opens with a quote and has no clean quote-then-rule split; the quoted part "
                   "is most likely the assistant's text. Read it whole and cite only what follows "
                   "the quote: %s" % text)
    elif e["pop"] in ("d", "e"):
        pass
    elif e["pop"] == "f":
        for a in e.get("answers") or []:
            out.append("  QUESTION (the assistant's): %s" % a.get("question"))
            out.append("  HIS ANSWER [%s]: %s" % (a.get("kind"),
                                                  json.dumps(a.get("value"), ensure_ascii=False)))
    elif e["pop"] == "g":
        out.append("  REFUSED: %s" % e.get("refused"))
        if e.get("user_said"):
            out.append("  HE SAID: %s" % e["user_said"])
    else:
        tag = (" (lines opening with > are text he pasted or quoted, not his words)"
               if PASTED_BLOCK.search(text) else "")
        out.append("  HE SAID%s: %s" % (tag, text))
    return "\n".join(out)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--sid", action="append", default=[])
    ap.add_argument("--grep")
    ap.add_argument("--since", help="ISO date or datetime (UTC); records before it are left out")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args(argv)
    if a.self_test:
        return self_test()
    sids = a.sid or [os.environ.get("CLAUDE_CODE_SESSION_ID", "")]
    idx_mod = _load_index()
    rx = re.compile(a.grep, re.I) if a.grep else None
    total = 0
    for sid in sids:
        path = resolve(sid)
        if not path:
            print("NO-TRANSCRIPT: %r resolves to no single transcript under %s" % (sid, PROJECTS),
                  file=sys.stderr)
            return 1
        sid8 = os.path.basename(path)[:8]
        shown = 0
        for e in records(path, idx_mod):
            if not keep(e, a.since, rx):
                continue
            print(render(e, sid8, rx))
            shown += 1
        print("— %s: %d owner record(s)%s" % (sid8, shown, " matching --grep" if rx else ""))
        total += shown
    return 0 if total else 3


def self_test():
    import tempfile
    global PROJECTS
    idx_mod = _load_index()
    recs = [
        {"type": "user", "promptSource": "typed", "timestamp": "2026-10-23T09:00:00Z",
         "message": {"content": "run the reach panel now"}},
        {"type": "user", "promptSource": "typed", "timestamp": "2026-10-23T09:01:00Z",
         "message": {"content": "\"The ad test: back on the table?\" - yes why not"}},
        {"type": "user", "timestamp": "2026-10-23T09:02:00Z", "turnOrigin": "peer",
         "message": {"content": "<command-name>/pause</command-name><command-args>resume</command-args>"}},
        {"type": "assistant", "message": {"content": [
            {"type": "tool_use", "id": "q1", "name": "AskUserQuestion", "input": {}}]}},
        {"type": "user", "timestamp": "2026-10-23T09:03:00Z",
         "message": {"content": [{"type": "tool_result", "tool_use_id": "q1"}]},
         "toolUseResult": {"questions": [{"question": "Which?", "options": [{"label": "A (Recommended)"}, {"label": "B"}]}],
                           "answers": {"Which?": "B"}}},
        {"type": "user", "promptSource": None, "isMeta": True, "message": {"content": "meta"}},
        # Records are numbered by their 1-based line in the fixture file (the by_rec key).
        # record 7: a quote inside my quote, then a second ruling — the classifier refuses the split
        {"type": "user", "promptSource": "typed", "timestamp": "2026-10-23T09:04:00Z",
         "message": {"content": "\"Pick \"fast\" - cheaper but riskier\" - slow \"x\" - y"}},
        # record 8: an en/em dash, so no hyphen ruling at all
        {"type": "user", "promptSource": "typed", "timestamp": "2026-10-23T09:05:00Z",
         "message": {"content": "\"Run the German arm?\" — not yet"}},
        # record 9: a pasted side-agent block under his words
        {"type": "user", "promptSource": "typed", "timestamp": "2026-10-23T09:06:00Z",
         "message": {"content": "a side agent says:\n> the step you approved costs a lot\n\nkeep it"}},
        # record 10: his words continue past the pair, ending in a quote of his own
        {"type": "user", "promptSource": "typed", "timestamp": "2026-10-23T09:07:00Z",
         "message": {"content": "\"Call it the reach plan?\" - no, call it \"growth plan\""}},
        # record 11: a queued message (b); record 12: his own slash command (e)
        {"type": "user", "promptSource": "queued", "timestamp": "2026-10-23T09:08:00Z",
         "message": {"content": "hold the commit"}},
        {"type": "user", "timestamp": "2026-10-23T09:09:00Z",
         "message": {"content": "<command-name>/eli5</command-name><command-args>the ads</command-args>"}},
        # record 13: a slash command whose argument is a quote of my line, no ruling (/eli5 "<line>")
        {"type": "user", "timestamp": "2026-10-23T09:10:00Z",
         "message": {"content": "<command-name>/eli5</command-name><command-args>\"Your 4 reach questions are still open.\"</command-args>"}},
        # record 14: a slash command whose argument is a quote-then-rule (/explain "<line>" - why?)
        {"type": "user", "timestamp": "2026-10-23T09:11:00Z",
         "message": {"content": "<command-name>/explain</command-name><command-args>\"Expect very little.\" - why?</command-args>"}},
        # record 15: a clean ruling whose answer carries a pasted > block
        {"type": "user", "promptSource": "typed", "timestamp": "2026-10-23T09:12:00Z",
         "message": {"content": "\"Ship the fold?\" - yes, the side agent agrees:\n> the fold is clean"}},
    ]
    results = []

    def arm(name, ok, detail=""):
        results.append((name, bool(ok)))
        print(("ok   %s" % name) if ok else ("FAIL %s: %s" % (name, detail)))

    stub = type("Stub", (), {"POP_ORDER": idx_mod.POP_ORDER, "unsplit_quote": staticmethod(
        idx_mod.unsplit_quote), "classify_record": staticmethod(
        lambda r, a, t: [{"pop": "zz-machine", "text": "PEER SAYS: approve the spend"}]
        if r.get("type") == "user" else [])})
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "t.jsonl")
        with open(p, "w") as fh:
            for r in recs:
                fh.write(json.dumps(r) + "\n")
        got = list(records(p, idx_mod))
        unknown = list(records(p, stub))

    def lines(e, **kw):
        return render(e, "t", **kw).splitlines() if e else []

    def his_lines(e):
        return [ln for ln in lines(e) if ln.startswith(("  HIS ANSWER", "  HE SAID"))]

    pops = [e["pop"] for e in got]
    want = ["a", "a", "f", "a", "a", "a", "a", "b", "e", "e", "e", "a"]
    arm("populations", pops == want, "got %r, want %r (peer slash command and meta left out)" % (pops, want))
    by_rec = {e["record"]: e for e in got}
    out = lines(by_rec.get(2))
    arm("clean-split", "  HIS ANSWER: yes why not" in out and not any(
        "The ad test" in ln and not ln.startswith("  QUOTING THE ASSISTANT") for ln in out),
        "a clean quote-then-rule did not split, or my quote leaked out of its line: %r" % out)
    bad = []
    for rec, word in ((7, "riskier"), (8, "German arm"), (10, "growth")):
        o = lines(by_rec.get(rec))
        if not any(ln.startswith("  UNSPLIT") for ln in o) or len(o) != 2 or \
                any(word in ln for ln in his_lines(by_rec.get(rec))):
            bad.append((rec, o))
    arm("unclean-split-whole", not bad, "a quote the split cannot cut cleanly printed as his words: %r" % bad)
    arm("pasted-block-label", any(ln.startswith("  HE SAID (lines opening with >") for ln in lines(by_rec.get(9))),
        "a pasted > block printed as plain HE SAID")
    o15 = lines(by_rec.get(15))
    arm("pasted-block-in-answer", any(ln.startswith("  HIS ANSWER (lines opening with >") for ln in o15),
        "a pasted > block inside his answer was not labelled: %r" % o15)
    arm("answered-question", '"B"' in render(by_rec[5], "t") if 5 in by_rec else False,
        "answered question lost his choice")
    u_out = lines(unknown[0]) if unknown else []
    arm("unknown-population", any(ln.startswith("  UNKNOWN POPULATION") for ln in u_out) and not any(
        ln.startswith(("  HE SAID", "  HIS ANSWER")) for ln in u_out),
        "a population POP_ORDER does not list was printed as his words: %r" % u_out)
    o12, o13, o14 = lines(by_rec.get(12)), lines(by_rec.get(13)), lines(by_rec.get(14))
    # o12 pins render's d/e "pass" branch: a plain command prints its COMMAND line and nothing else.
    arm("command-quote-keeps-name",
        o12[1:] == ["  COMMAND: /eli5 the ads"]
        and len(o13) == 3 and o13[1].startswith("  COMMAND: /eli5 ") and o13[2].startswith("  UNSPLIT — the command's argument")
        and o14[1:2] == ['  COMMAND: /explain "Expect very little." - why?']
        and "  HIS ANSWER: why?" in o14 and not his_lines(by_rec.get(13)),
        "a slash command lost its name, printed its argument twice, or printed my quote as his: %r %r %r"
        % (o12, o13, o14))
    rx = re.compile("ad test", re.I)
    kept = ([e["record"] for e in got if keep(e, "2026-10-23T09:06:30", None)],
            [e["record"] for e in got if keep(e, None, rx)])
    arm("since-grep-filter", kept == ([10, 11, 12, 13, 14, 15], [2]),
        "kept %r, want ([10, 11, 12, 13, 14, 15], [2])" % (kept,))
    g_out = lines(by_rec.get(2), rx=rx)
    arm("grep-half-label", "  (--grep matched only the assistant's quoted text, not his answer)" in g_out
        and not any("(--grep matched only" in ln for ln in lines(by_rec.get(2), rx=re.compile("why not"))),
        "a --grep hit only in my quoted half was not labelled, or one in his answer was: %r" % g_out)
    import contextlib, io
    saved = PROJECTS
    with tempfile.TemporaryDirectory() as d:
        PROJECTS = d
        for n in ("abcd1234-1", "abcd1234-2"):
            open(os.path.join(d, n + ".jsonl"), "w").close()
        with open(os.path.join(d, "ef015678-1.jsonl"), "w") as fh:
            for r in recs:
                fh.write(json.dumps(r) + "\n")
        arm("resolve-prefix", resolve("abcd1234") is None and resolve("deadbeef") is None
            and (resolve("ef015678") or "").endswith("ef015678-1.jsonl"),
            "an ambiguous or missing prefix must give None, a unique one its file")
        buf, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(err):
            rcs = (main(["--sid", "ef015678", "--grep", "German arm"]), main(["--sid", "ef015678", "--grep", "zzz-none"]),
                   main(["--sid", "abcd1234"]))
        printed = buf.getvalue()
        arm("main-end-to-end", rcs == (0, 3, 1) and "  UNSPLIT" in printed
            and "1 owner record(s) matching --grep" in printed,
            "want rc (0, 3, 1) and the UNSPLIT record printed, got %r %r" % (rcs, printed[:300]))
    PROJECTS = saved
    passed = sum(1 for _, ok in results if ok)
    print("arms: %s" % " ".join(n for n, _ in results))
    print("self-test: %d/%d %s" % (passed, len(results), "PASS" if passed == len(results) else "FAIL"))
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
