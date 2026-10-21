#!/usr/bin/env python3
"""hub-open-promises — the THIRD queue plane: what I said I would do.

WHY THIS EXISTS (measured 2026-09-06, after three promises went undelivered in one
night).

The hub has two queue instruments and they are cross-blind to each other:

  review-request-closure-scan.mjs   SHA axis   — does an outbound of mine name this sha?
  hub-unfinished-loops.py           LOOP axis  — does the peer hold the last word?

Both read PEER state. A PROMISE ("it is next from me", an ETA) lives INSIDE an outbound,
so the sha scan scores the request ANSWERED and replying hands me the last word, so the
loop check drops the peer. The sentence that makes the item NOT done is invisible to both
BY CONSTRUCTION. This tool reads the one store nobody reads: my own sent mail.

MEASURED, and it is why this is a detector rather than a convention. session-cadence.md
§ MEASURE THE BASE RATE kills a guard under a few percent, with recorded kills at 1.5%
and 0.085%. Here: of the forward promises in one night's outbound, at least THREE went
undelivered -- a failure rate in the tens of percent on a shape
that recurred several times in a single session. The delivery log is what settles it:
eleven verdicts and fold-verifies went out between 03:52Z and 04:24Z, every one a reply
to a fresh arrival, while three older promises sat. New arrivals are PUSHED at me by a
notification; my own promises are PULLED, and nothing pulled them.

WHAT IT IS NOT. It does not decide whether work is owed -- it reports that I SAID it was
owed and cannot find where I delivered it. Read the rows. A promise I discharged in a
commit body, a channel, or by the peer withdrawing the request reads OPEN here, the same
FLOOR the loop checker carries.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time

MAIL_DIR = ".claude/state/session-mail"

# Fixed lowercase substrings. A phrase earns a place here only if it commits ME to a
# FUTURE act. Deliberately excluded: a bare "is next" -- it reads 24 times in one night's
# outbound and is dominated by ordinary prose ("the next fold", "the next reader"), so it
# is a topic word, not a commitment. The sha-proximity requirement below is what keeps
# the looser members of this list honest.
PROMISE_PHRASES = (
    "next from me",
    "next in my queue",
    "not queued indefinitely",
    "eta on",
    "still tonight",
    "i will get to",
    "i'll get to",
    "will send",
    "coming next",
    "queued behind",
    "is next up",
    # Added 2026-09-11 after both MISSED a live promise: the hub told a peer seat
    # "<sha> + <sha> stay queued at position 2" and "I have it",
    # and this tool read a clean queue while both sat unanswered for hours.
    # Base rates measured on the hub's own outbound
    # before adding, per this list's own discipline: "stay queued at" 1 genuine
    # instance (a 2nd hit was the write-up ABOUT this defect -- self-contamination,
    # excluded), "i have it" 3 occurrences / 2 genuine / 1 prose ("I have it in front
    # of the owner"). Both are far below the "is next" noise floor this comment rejects, and
    # the sha-proximity requirement is what keeps the prose case from firing.
    # ⛔ REJECTED in the same pass, measured: "position 1" (57 files) and "position 2"
    # (26 files) -- every ack carries one, so they are topic words, not commitments.
    "stay queued at",
    "i have it",
)

# A mail DELIVERS a sha when its SUBJECT names the sha and carries one of these. This is
# the discriminator the closure scan's own ledger recommends: spell the sha in the verdict
# subject so the row closes on the sender's record rather than the recipient's.
# DERIVED from this seat's own outbound subjects, not guessed (2026-09-06, first word of
# every `*__<me>.md*` subject): VERDICT 185 · ACK 97 · FOLD-VERIFIED 84 · FOLD-VERIFY 55 ·
# INTERIM 47. Two things that population settles and a guess did not:
#   · "fold-verif" must be a PREFIX -- FOLD-VERIFIED (84) outnumbers FOLD-VERIFY (55), and
#     a "fold-verify" token misses every one of the 84. Measured: it left delivered rows
#     showing as open on the first live run.
#   · ACK and INTERIM are deliberately ABSENT. An ack is not a disposition -- the staleness
#     poller says so in its own words -- and an interim is by definition partial. Adding
#     either would let the tool close a row on the very message that promises the work.
VERDICT_TOKENS = (
    "verdict",
    "fold-verif",
    "fold verif",
    "approved",
    "changes-requested",
    "alternative",
    "closed",
    # Added 2026-09-15 after a row sat OPEN for 1,608 minutes on a promise discharged
    # 26 hours earlier. Cause was NOT wording -- it was that this tool and
    # review-request-closure-scan.mjs carry TWO DIFFERENT answer vocabularies, and
    # "waived" was in that one's ANSWER_CLASS_SUBJ and missing from this one's. A
    # disposition written to satisfy the closure scan therefore flipped that instrument
    # and left this one complaining, which is exactly the "verify against the tool that
    # is COMPLAINING, not the one that is quiet" trap -- run in reverse.
    # Base rate measured on this seat's own outbound before adding, per this list's
    # discipline: 3 occurrences of "waived" in the first 40 chars across 547 outbound
    # subjects, 3 of 3 genuine dispositions, 0 prose. (One of the three already
    # delivered via "VERDICT" in the same subject, so the marginal gain is 2 rows.)
    # ⚠️ The two instruments now agree on "waived" ONLY -- their vocabularies still differ.
    # Measured 2026-09-28 over 154 hub outbound mails: 99 count as answers
    # there, 60 as deliveries here, 39 closure-only. Only there: deploy-(clear|hold|ok),
    # stand down, declin, retract, and the whole SIGNAL leg (~30 of the 39 are
    # "TERMINAL <sha>: CHANGES REQUESTED" subjects the 40-char window below cuts short).
    # Only here: bare "closed", and an unanchored fold-verif. Cost 0 OPEN rows that day.
    "waived",
)

SHA_RE = re.compile(r"\b[0-9a-f]{7,40}\b")
PROXIMITY = 200  # chars between a phrase and a sha for the pair to count


def parse_name(basename: str):
    """<recipient>__<ts>__<sender>.md[.read|.read-by-<sid>] -> (recipient, ts_ns, sender).

    Returns None when the name does not carry all three fields. Split on the FULL '__'
    delimiter: a single-'_' split counts the empty field between the doubled separators
    and silently returns the wrong column (the mail store's own off-by-one).
    """
    parts = basename.split("__")
    if len(parts) < 3:
        return None
    recipient, ts_raw, sender_raw = parts[0], parts[1], parts[2]
    if not ts_raw.isdigit():
        return None
    sender = sender_raw.split(".")[0]
    if not recipient or not sender:
        return None
    return recipient, int(ts_raw), sender


def read_mail(path: str):
    """-> (subject, body). Missing headers yield '', never a fabricated value."""
    try:
        with open(path, "r", errors="replace") as fh:
            text = fh.read()
    except OSError:
        return "", ""
    subject = ""
    for line in text.split("\n")[:15]:
        low = line.lower()
        if low.startswith("subject:"):
            subject = line.split(":", 1)[1].strip()
            break
    return subject, text


def short(sha: str) -> str:
    return sha[:7]


def find_promises(subject: str, body: str):
    """Shas promised in this mail: a commitment phrase with a sha within PROXIMITY."""
    hay = (subject + "\n" + body).lower()
    out = set()
    for phrase in PROMISE_PHRASES:
        # Word-bounded, never a plain substring: "eta on" fired inside "/meta only" and
        # opened a false row (2026-09-28 -- the only OPEN row
        # this tool printed for one seat that night was that one).
        for pm in re.finditer(r"\b" + re.escape(phrase) + r"\b", hay):
            i = pm.start()
            lo = max(0, i - PROXIMITY)
            hi = min(len(hay), i + len(phrase) + PROXIMITY)
            for m in SHA_RE.finditer(hay[lo:hi]):
                out.add(short(m.group(0)))
    return out


def find_deliveries(subject: str):
    """Shas this mail DELIVERS: named in the SUBJECT of a verdict-SHAPED mail.

    ⛔ THE TOKEN MUST FALL IN THE FIRST 40 CHARACTERS, not anywhere in the subject. An
    unbounded substring test reads 'ETA on abc1234: next, after one blocking verdict' as a
    DELIVERY of abc1234 -- the exact inversion this tool exists to catch, and my own
    self-test caught it on the first run (2026-09-06). A real verdict announces itself
    early; prose about a verdict does not.
    """
    low = subject.lower().lstrip("*_ ")
    head = low[:40]
    # CONTAINS-within-the-first-40, not startswith. startswith was measured too strict on
    # the second live run: "CONSOLIDATED VERDICT — 5 lenses, CHANGES REQUESTED"
    # is a delivery and does not START with a token. The 40-char window is what keeps the
    # founding counter-example out: in "ETA on abc1234: next, after one blocking verdict"
    # the word "verdict" begins at index 40, outside the window, so that subject is still
    # correctly read as a PROMISE. Both are self-test arms.
    if not any(tok in head for tok in VERDICT_TOKENS):
        return set()
    return {short(m.group(0)) for m in SHA_RE.finditer(low)}


def real_commits(candidates, repo_root: str | None = None):
    """Keep only candidates git resolves to a commit.

    Session ids are 8-hex and match a sha regex exactly, so without this every seat id in
    the fleet reads as a promised commit -- measured on the first live run: 4 of the top 5
    rows were seat ids. `git cat-file -e <sha>^{commit}` is the discriminator, and it also
    drops ordinary hex prose. Returns candidates unchanged when git is unavailable, so the
    tool degrades to noisier rather than silently empty.
    """
    import subprocess
    keep = set()
    for c in candidates:
        try:
            r = subprocess.run(["git", "cat-file", "-e", f"{c}^{{commit}}"],
                               cwd=repo_root, capture_output=True, timeout=10)
        except (OSError, subprocess.SubprocessError):
            return set(candidates)
        if r.returncode == 0:
            keep.add(c)
    return keep


def scan(mail_dir: str, me: str, verify_commits: bool = True):
    """-> list of open promises, newest promise first.

    verify_commits=False skips the git resolution so the pairing LOGIC can be tested with
    synthetic shas; real_commits has its own arm against live shas.
    """
    promised: dict[str, tuple[int, str, str]] = {}   # sha -> (ts_ns, peer, subject)
    delivered: dict[str, int] = {}                   # sha -> newest delivery ts_ns
    try:
        names = os.listdir(mail_dir)
    except OSError:
        return []
    for name in names:
        parsed = parse_name(name)
        if not parsed:
            continue
        recipient, ts_ns, sender = parsed
        if sender != me:            # my OUTBOUND only -- this is the store nobody reads
            continue
        subject, body = read_mail(os.path.join(mail_dir, name))
        for sha in find_deliveries(subject):
            if ts_ns > delivered.get(sha, 0):
                delivered[sha] = ts_ns
        for sha in find_promises(subject, body) - find_deliveries(subject):
            prev = promised.get(sha)
            if prev is None or ts_ns > prev[0]:
                promised[sha] = (ts_ns, recipient, subject)

    # Session ids are 8-hex and match a sha regex exactly. Drop anything git cannot
    # resolve to a commit -- measured on the first live run, 4 of the top 5 rows were
    # seat ids, not work.
    if promised and verify_commits:
        live = real_commits(set(promised))
        promised = {s: v for s, v in promised.items() if s in live}

    now_ns = time.time_ns()
    rows = []
    for sha, (ts_ns, peer, subject) in promised.items():
        # ANY delivery closes the sha, regardless of order. The first version required the
        # delivery to POSTDATE the promise, which is the tidier model and was measured
        # WRONG on the first live run: a later mail that merely MENTIONS an
        # already-verdicted sha near a promise phrase re-opened it. Spot-checking three
        # rows found 3 of 3 false that way (each already carried a FOLD-VERIFY or a
        # VERDICT of its own), i.e. the ordering rule
        # was the dominant source of noise.
        # STATED BOUND: a genuine SECOND round on a sha I already verdicted reads CLOSED
        # here. That is the deliberate trade -- a re-review arrives as its own new request
        # and the sha-axis scan carries it, whereas noise at this rate makes the tool
        # unreadable, which is how an instrument dies.
        if delivered.get(sha, 0):
            continue
        rows.append({
            "sha": sha,
            "peer": peer,
            "promised_at": ts_ns,
            "age_min": int((now_ns - ts_ns) / 60_000_000_000),
            "subject": subject,
        })
    rows.sort(key=lambda r: r["promised_at"], reverse=True)
    return rows


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sid", help="8-hex seat id; defaults to CLAUDE_CODE_SESSION_ID's prefix")
    ap.add_argument("--dir", default=MAIL_DIR, help="mail store (default: %(default)s)")
    ap.add_argument("--min-age-min", type=int, default=0,
                    help="only report promises older than N minutes")
    ap.add_argument("--table", action="store_true", help="markdown table")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()

    sid = args.sid or (os.environ.get("CLAUDE_CODE_SESSION_ID") or "").split("-")[0]
    if not sid:
        print("hub-open-promises: no seat id (pass --sid or set CLAUDE_CODE_SESSION_ID)",
              file=sys.stderr)
        return 2

    rows = [r for r in scan(args.dir, sid) if r["age_min"] >= args.min_age_min]
    if not rows:
        print("Open promises: none — every sha I committed to has a later verdict "
              "or fold-verify from me naming it.")
        return 0

    if args.table:
        print("| sha | promised to | waiting | what I said |")
        print("|---|---|---|---|")
        for r in rows:
            said = r["subject"][:64] + ("…" if len(r["subject"]) > 64 else "")
            print(f"| `{r['sha']}` | `{r['peer']}` | {r['age_min']}m | {said} |")
    else:
        print(f"⚠️  {len(rows)} OPEN PROMISE(S) — I said these were coming and cannot "
              f"find where I delivered them:")
        for r in rows:
            print(f"  · {r['sha']}  to={r['peer']}  {r['age_min']}m ago")
            print(f"      said: {r['subject'][:100]}")
    print()
    print("  FLOOR, not a count: mail plane only. A promise discharged in a commit body, "
          "a channel,")
    print("  or by the peer withdrawing it reads OPEN here. Read the rows.")
    return 0


def self_test() -> int:
    import shutil
    import tempfile

    d = tempfile.mkdtemp(prefix="promises-")
    me = "aaaa1111"
    fails = []

    def w(name: str, subject: str, body: str = ""):
        with open(os.path.join(d, name), "w") as fh:
            fh.write(f"from: x\nto: y\nsubject: {subject}\n---\n{body}\n")

    arms = [0]

    def ck(cond: bool, label: str):
        arms[0] += 1
        if not cond:
            fails.append(label)

    # --- parse_name -------------------------------------------------------
    ck(parse_name(f"peer__100__{me}.md") == ("peer", 100, me), "parse: basic")
    ck(parse_name(f"peer__100__{me}.md.read") == ("peer", 100, me), "parse: .read")
    ck(parse_name("peer_100_x.md") is None, "parse: single-underscore REJECTED")
    ck(parse_name("peer__notanum__x.md") is None, "parse: non-numeric ts rejected")

    # --- a promise with no delivery is OPEN (the positive control) ---------
    w(f"bob__1000__{me}.md", "ETA on abc1234: next, after one blocking verdict")
    rows = scan(d, me, verify_commits=False)
    ck(len(rows) == 1 and rows[0]["sha"] == "abc1234", "open promise reported")
    ck(rows and rows[0]["peer"] == "bob", "promise carries its peer")

    # --- DISCRIMINATING: a later delivery CLOSES it (must vanish) ---------
    w(f"bob__2000__{me}.md", "VERDICT abc1234 — APPROVED")
    ck(scan(d, me, verify_commits=False) == [], "later verdict CLOSES the promise")

    # --- a delivery BEFORE the promise does NOT close it ------------------
    shutil.rmtree(d)
    d = tempfile.mkdtemp(prefix="promises-")
    # FLIPPED 2026-09-06 by the first live run, and the flip is the finding. This arm used
    # to assert that an EARLIER verdict leaves a LATER promise open -- the tidier model.
    # Live, that rule produced 3-of-3 false rows, because a mail mentioning an
    # already-verdicted sha near a promise phrase re-opened it. Any delivery now closes.
    w(f"bob__1000__{me}.md", "VERDICT def5678 — APPROVED")
    w(f"bob__2000__{me}.md", "ETA on def5678: next")
    ck(scan(d, me, verify_commits=False) == [],
       "ANY delivery closes the sha, even one predating the promise")

    # --- DISCRIMINATING: a sha with no promise phrase is NOT tracked -------
    shutil.rmtree(d)
    d = tempfile.mkdtemp(prefix="promises-")
    w(f"bob__1000__{me}.md", "notes on 9999abc", "just discussing 9999abc, no commitment")
    ck(scan(d, me, verify_commits=False) == [], "a bare sha mention is NOT a promise")

    # --- DISCRIMINATING: a far-away sha does not pair with the phrase ------
    shutil.rmtree(d)
    d = tempfile.mkdtemp(prefix="promises-")
    w(f"bob__1000__{me}.md", "status", "next from me is the audit." + ("x" * 400) + " 1234abc")
    ck(scan(d, me, verify_commits=False) == [], "sha beyond PROXIMITY does not pair")

    # --- INBOUND is ignored (the store is MY outbound) --------------------
    shutil.rmtree(d)
    d = tempfile.mkdtemp(prefix="promises-")
    w(f"{me}__1000__bob.md", "ETA on abc1234: next")
    ck(scan(d, me, verify_commits=False) == [], "inbound mail is not my promise")

    # --- promise in the BODY, not the subject, is caught ------------------
    shutil.rmtree(d)
    d = tempfile.mkdtemp(prefix="promises-")
    w(f"bob__1000__{me}.md", "unrelated subject",
      "one more thing: c0ffee1 still not reviewed. It is next from me, not queued indefinitely.")
    ck(len(scan(d, me, verify_commits=False)) == 1, "body-only promise is caught")

    # --- real_commits: the seat-id filter, against LIVE shas -------------
    # Anchored on this repo's own HEAD so the arm cannot rot into a fixture.
    import subprocess
    head = subprocess.run(["git", "rev-parse", "--short=7", "HEAD"],
                          capture_output=True, text=True).stdout.strip()
    if head:
        got = real_commits({head, "0badc0d", "facade1"})
        ck(head in got, "real_commits KEEPS a live sha")
        ck("0badc0d" not in got and "facade1" not in got,
           "real_commits DROPS seat ids (the first live run's top rows)")
    else:
        fails.append("real_commits arm could not resolve HEAD")

    # --- DISCRIMINATING: 'verdict' as PROSE in a promise subject ---------
    # The bug my own first self-test run caught: an unanchored token test read
    # 'ETA on abc1234: next, after one blocking verdict' as a DELIVERY.
    ck(find_deliveries("ETA on abc1234: next, after one blocking verdict") == set(),
       "prose 'verdict' mid-subject is NOT a delivery")
    ck(find_deliveries("VERDICT abc1234 — APPROVED") == {"abc1234"},
       "leading verdict IS a delivery")
    ck(find_deliveries("CONSOLIDATED VERDICT abc1234 — 5 lenses") == {"abc1234"},
       "a token INSIDE the first 40 chars is a delivery (startswith was too strict)")
    ck(find_deliveries(
        "notes on abc1234 and some longer preamble here before the verdict") == set(),
       "a token PAST the 40-char window is prose, not a delivery")

    # --- the three added entries ("stay queued at", "i have it", "waived"),
    # each red ONLY under its own removal. (Before these arms, the tool without
    # those entries and every single-entry removal all read ALL PASS.)
    shutil.rmtree(d)
    d = tempfile.mkdtemp(prefix="promises-")
    w(f"bob__1000__{me}.md", "status", "decaf01 and beef123 stay queued at position 2")
    ck(len(scan(d, me, verify_commits=False)) == 2, "'stay queued at' + sha is a promise")

    shutil.rmtree(d)
    d = tempfile.mkdtemp(prefix="promises-")
    w(f"bob__1000__{me}.md", "status", "on cafe456: I have it.")
    ck(len(scan(d, me, verify_commits=False)) == 1, "'i have it' + sha is a promise")

    shutil.rmtree(d)
    d = tempfile.mkdtemp(prefix="promises-")
    w(f"bob__1000__{me}.md", "status",
      "I have it in front of the owner." + ("x" * 400) + " 3141abc")
    ck(scan(d, me, verify_commits=False) == [],
       "'i have it' as PROSE, sha beyond PROXIMITY, does not pair")

    shutil.rmtree(d)
    d = tempfile.mkdtemp(prefix="promises-")
    w(f"bob__1000__{me}.md", "ETA on abc1234: next")
    w(f"bob__2000__{me}.md", "WAIVED abc1234 — owner-directed")
    ck(scan(d, me, verify_commits=False) == [], "a WAIVED subject closes the promise")

    # --- word-bounded match, never a substring ----------------------------
    shutil.rmtree(d)
    d = tempfile.mkdtemp(prefix="promises-")
    w(f"bob__1000__{me}.md", "TERMINAL feed789: /meta only", "see feed789")
    ck(scan(d, me, verify_commits=False) == [],
       "'eta on' inside '/meta only' is NOT a promise")

    shutil.rmtree(d)
    if fails:
        for f in fails:
            print(f"FAIL: {f}")
        print(f"self-test: {len(fails)} failed")
        return 1
    print(f"self-test: ALL PASS ({arms[0]} arms)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
