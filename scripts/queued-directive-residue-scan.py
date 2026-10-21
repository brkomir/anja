#!/usr/bin/env python3
"""queued-directive-residue-scan.py — find owner messages that were QUEUED but never DELIVERED.

WHY THIS EXISTS (measured 2026-09-06):
The owner typed two messages at 23:28:26.300Z and 23:28:49.333Z. Both exist in the transcript
ONLY as `type:"queue-operation"` records; no `type:"user"` record ever carried either, so no turn
was ever composed against them. Four minutes later that session's closer read "Next - me: nothing
queued." Another pass found them ~40 minutes later, by reading the raw transcript.

A queue-operation carries no `promptSource` and is invisible to every owner-speech probe keyed on
`type:"user"` — which is every probe this repo had. So the detector keys on the queue plane itself
and asks whether each queued utterance ever ARRIVED.

⛔ TWO SENTENCES THAT STOOD HERE WERE FALSE AND ARE REPLACED, NOT ANNOTATED (2026-09-07):

  "There is NO in-session tell."  FALSE. There are at least two, both on the queue plane this
  script already reads. `operation` (enqueue / popAll / remove) is now carried and printed; and
  `remove` records carry a `reason` field, with "absorbed_mid_turn" appearing 5,815 times
  corpus-wide and 550 times on owner content.

  "whether the harness dropped a message or the owner cleared the owner's own queue … both produce an
  identical residue."  FALSE as stated — they do not, and this script was discarding the field
  that distinguishes them. What IS genuinely unsettled is narrower: the founding rows were
  enqueued, drained by popAll and never absorbed, and it is OPEN whether popAll means the owner
  pulled the owner's queue back into the editor (not a loss) or the harness dropped them. That
  discriminator is a harness-internals claim nobody has verified.

⚠️ ON REAL DATA SO FAR THIS TOOL HAS SURFACED ZERO CONFIRMED HARNESS DROPS. A lens broke down the
15 rows this session's first run produced: 8 pop-to-edit, 6 slash-command false positives (fixed
below), 1 harness refusal of a typo'd command, 0 drops. Treat the output as a worklist of
candidates, never as a loss count, and do not word it as a harness-fault claim.

FALSE-DELIVERY GUARD (the defect this would otherwise ship):
A `type:"user"` record is NOT automatically a delivery. Task notifications, hook injections and
skill-spec payloads are all `type:"user"`, and a sub-agent report QUOTING the lost directive would
make it read as delivered — the self-contaminating-probe class, arriving through the one channel
that found the bug in the first place. So a delivery must be OWNER-SHAPED: promptSource in
{typed, queued, suggestion_accepted}, or a `<command-message>` block. `promptSource:"system"` and
`isMeta` records are explicitly NOT deliveries.

⛔ DELIVERED IS NOT REACHED — THE UNRUN ARM (added 2026-10-06). Everything above asks whether a
queued utterance ARRIVED. A slash command can arrive, have its skill body delivered, and still never
get a turn: founding shape, a skill command and its body (`isMeta`, opening "Base directory for this
skill:"), then a local command and a typed message inside the same minute; the turn answered the
typed message, the command's own turn started 78 minutes later, and this scan and its sibling
(`orphaned-prompt-scan.py`) both read CLEAN. So a slash command whose skill body was delivered is
REACHED only if a non-sidechain assistant record follows the body, IN FILE ORDER, before the next
owner-shaped record (the owner-shaped definition above). Otherwise it is reported with verdict
UNRUN (unrun_skill_commands). Out of scope: a command whose expansion does not open with that
prefix (not a skill), and a mid-turn `queued_command` attachment, which is delivered INTO a running
turn and is never a boundary. ⛔ A local command (`system` record, subtype `local_command`) is NOT
a boundary: the harness runs one inside the skill's own turn before its first assistant record,
and counting it made 19 of 83 corpus rows false (measured 2026-10-06 over 313 transcripts).
A compaction summary that quotes a `<command-message>` block is not a command either.
The sibling `orphaned-prompt-scan.py` docstring carries what the rows turned out to be and what
this arm still misses.

Usage:
  python3 scripts/queued-directive-residue-scan.py              # this session (CLAUDE_CODE_SESSION_ID)
  python3 scripts/queued-directive-residue-scan.py --sid <uuid>
  python3 scripts/queued-directive-residue-scan.py --self-test

Exit: 0 clean, 3 residue found (a worklist, not a failure), 1 instrument failure.
"""
import io
import json
import os
import re
import sys

# Claude Code keys a project by its directory path with every non-alphanumeric character as "-".
PROJECT_KEY = re.sub(r"[^a-zA-Z0-9]", "-", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OWNER_SOURCES = {"typed", "queued", "suggestion_accepted"}
# A user record the HARNESS fired (a cron-fired slash command, a task notification, a peer
# session's prompt, an auto-continuation) is not the owner acting: it is 'other' to the UNRUN
# arm, never a command and never a boundary. The test is membership here, never == "human":
# turnOrigin is absent on older records (2,815 of 3,194 command-shaped records at 2026-10-06).
# Same set as scripts/post-compact-recovery-index.py's MACHINE_TURN_ORIGINS.
MACHINE_TURN_ORIGINS = {"task_notification", "peer", "auto_continuation", "scheduled"}

# THE QUEUE PLANE CARRIES NO AUTHOR DISCRIMINATOR — measured, not assumed. A queue-operation
# record has exactly {type, operation, timestamp, sessionId, content}; an owner-typed message and
# a task notification are field-identical. So the ONLY available filter is the content's opening
# shape, and that is a DENYLIST, which leaks by construction.
#
# The leak direction is chosen deliberately. Letting a harness record through costs a false
# candidate the owner reads and dismisses; excluding an owner message costs the silent miss this
# whole script exists to catch. So the prefixes below are ANCHORED and NARROW, anything ambiguous
# survives as a candidate, and the run prints what the exclusion removed so the filter is auditable
# (state what your exclusion removes — the delta is the check).
#
# DERIVED 2026-09-07 over one session's 983 unique queued contents:
#   877 <task-notification>  ·  1 usage-limit  ·  105 candidates  ·  0 anything else.
# ⛔ MY MAGNITUDE ARGUMENT HERE WAS WRONG IN THE FLATTERING DIRECTION AND IS REPLACED. It said a
# third harness shape "would arrive silently as 100+ false candidates, which is loud, not silent."
# Measured across 216 transcripts: the three shapes this list still misses —
# cross-session-message, autorun cron, loop timer — produce 30 / 21 / 2 unique contents, i.e.
# ONE TO TEN ROWS PER SESSION. At n=1 a new shape does not announce itself at all, which is
# exactly what happened in this session's own run. RE-DERIVE on a new corpus; do not rely on a
# wrong shape being loud.
# ⛔ EVERY MEMBER IS MEASURED OVER ALL 216 TRANSCRIPTS, AND THE MAGNITUDE ARGUMENT THAT KEPT
# THREE OF THEM OUT WAS WRONG IN THE FLATTERING DIRECTION (2026-09-07). The comment
# here used to reason that a missing shape "would arrive silently as 100+ false candidates,
# which is loud". Measured: 1 to 10 rows per session. At n=1 it does not announce itself — and
# that is exactly what this session's own run did.
#   <task-notification>            47,436 records   harness task/monitor events
#   Your claude.ai usage limit         61 records   harness notice
#   <cross-session-message             43 records   peer mail arriving on the socket
#   [Owner-authorized                  21 records   an /autorun cron firing
#   # Autonomous loop check             1 record    the /loop dynamic-mode timer
#   <agent-message                  2,143 records   sub-agent hand-back (277 transcripts, 2026-09-24;
#                                                   all `<agent-message from="<hex>"`, 0 owner-sourced)
#   # Autonomous loop (widened)       20 records    12 `… tick (dynamic pacing)` + 8 `… check`, all
#                                                   isMeta/promptSource=system, 0 owner-sourced (313
#                                                   transcripts, 2026-10-06)
#   [keep-warm]                         0 records   pre-registered sentinel of the unbuilt keep-alive
#                                                   ping (2026-10-06); nothing to measure
# ⛔ `[Owner-authorized` IS DELIBERATELY SHORTER THAN EITHER FULL PREAMBLE. The family
# has TWO spellings — `[Owner-authorized autonomous run …` (20 unique) and `[Owner-authorized
# <work-order> RETRY …` (1) — so a key built from the common one misses the retry variant by exactly
# the margin that makes a denylist feel finished.
# ⛔ AND NEVER GENERALISE THIS TO A BARE `[` PREFIX. A message opening `[Image #N]` and going on
# in the owner's own words is the OWNER talking with a pasted screenshot; there are dozens of
# them. A bracket means a machine preamble here only for the literals named above, and the
# cheap-looking generalisation silently suppresses owner speech — the one class this tool
# exists to find.
HARNESS_PREFIXES = ("<task-notification>", "Your claude.ai usage limit",
                    "<cross-session-message", "[Owner-authorized",
                    # 2026-10-06: '# Autonomous loop' covers the /loop 'check' AND
                    # 'tick (dynamic pacing)' forms; '[keep-warm]' is the keep-alive ping sentinel.
                    "# Autonomous loop", "[keep-warm]",
                    # 2026-09-23: a sub-agent hand-back delivered
                    # through the queue wears this harness frame; 8 such rows read NOT-DELIVERED in one wrap.
                    "<agent-message")
# Below this, a queued fragment is too short to match distinctively; report it as UNVERIFIABLE
# rather than guessing. (A two-state verdict guesses "delivered".)
MIN_KEY = 24

# The UNRUN arm (docstring § DELIVERED IS NOT REACHED).
SKILL_BODY_PREFIX = "Base directory for this skill:"


def transcript_path(sid):
    return os.path.join(os.path.expanduser("~"), ".claude", "projects", PROJECT_KEY, sid + ".jsonl")


def norm(s):
    """Collapse whitespace so a delivered copy that got re-wrapped still matches.

    Accepts a LIST as well as a string: `attachment.prompt` is a list of content blocks whenever
    the owner pasted an image alongside text (measured — a str-only version crashed on the first
    such record). Non-text blocks contribute nothing, which is correct: the match key is the prose.
    """
    if isinstance(s, list):
        parts = []
        for b in s:
            if isinstance(b, str):
                parts.append(b)
            elif isinstance(b, dict) and b.get("type") == "text":
                parts.append(b.get("text", ""))
        s = " ".join(parts)
    return " ".join((s or "").split())


def user_text(rec):
    """Text of a user record, or None if this record is not an OWNER-SHAPED delivery."""
    if rec.get("type") != "user" or rec.get("isMeta"):
        return None
    ps = rec.get("promptSource")
    msg = rec.get("message") or {}
    content = msg.get("content")
    parts = []
    if isinstance(content, str):
        parts.append(content)
    elif isinstance(content, list):
        for b in content:
            if isinstance(b, dict) and b.get("type") == "text":
                parts.append(b.get("text", ""))
    text = norm(" ".join(parts))
    if ps in OWNER_SOURCES:
        return text
    # A typed slash-command carries no promptSource but does carry <command-message>.
    if ps is None and "<command-message>" in text:
        return text
    return None


def command_line(t):
    """'/name args' rebuilt from a delivered command's <command-name>/<command-args> tags, or None."""
    m = re.search(r"<command-name>\s*/?([^<\s]+)\s*</command-name>", t)
    if not m:
        return None
    args = re.search(r"<command-args>(.*?)</command-args>", t, re.S)
    return norm("/" + m.group(1) + " " + (args.group(1) if args else "")) or None


def turn_kind(rec):
    """Classify one record for the UNRUN arm; None = not part of the sequence at all.

    'command'    an owner-shaped user record with no promptSource (user_text's <command-message> leg)
    'owner'      any other owner-shaped user record
    'skill-body' an isMeta user record opening with SKILL_BODY_PREFIX
    'assistant'  a non-sidechain assistant record
    'other'      any other user record, or a sidechain assistant — present, never decisive
    Attachments, queue-operations, every `system` record (a local command included — it starts
    no turn, docstring § DELIVERED IS NOT REACHED) and the timestampless harness records
    (file-history-snapshot, last-prompt, titles, agent name/colour, mode) return None and are
    skipped. A compaction summary is 'other' even when its prose quotes a <command-message> block,
    and so is a user record the harness fired (turnOrigin in MACHINE_TURN_ORIGINS): a cron-fired
    slash command is neither scanned as the owner's nor a boundary for the command before it.
    """
    t = rec.get("type")
    if t == "assistant":
        return "other" if rec.get("isSidechain") else "assistant"
    if t != "user":
        return None
    if rec.get("isCompactSummary"):
        return "other"
    if rec.get("isMeta"):
        body = norm((rec.get("message") or {}).get("content"))
        return "skill-body" if body.startswith(SKILL_BODY_PREFIX) else "other"
    if rec.get("turnOrigin") in MACHINE_TURN_ORIGINS:
        return "other"
    if user_text(rec) is None:
        return "other"
    return "command" if rec.get("promptSource") is None else "owner"


def unrun_skill_commands(seq):
    """-> (rows, scanned) over scan()'s `seq` of (line, ts, kind, command_text).

    A slash command is in scope when the first decisive record after it ('other' skipped) is its
    skill body. It is REACHED iff an 'assistant' follows that body, in FILE ORDER, before the next
    'owner' or 'command'. Running off the end with neither is reported too — a killed session and
    a harness drop look the same here.
    """
    rows, scanned = [], 0
    for i, (ln, ts, kind, text) in enumerate(seq):
        if kind != "command":
            continue
        j = i + 1
        while j < len(seq) and seq[j][2] == "other":
            j += 1
        if j >= len(seq) or seq[j][2] != "skill-body":
            continue
        scanned += 1
        reached, next_owner = False, None
        for m in range(j + 1, len(seq)):
            k2 = seq[m][2]
            if k2 == "assistant":
                reached = True
                break
            if k2 in ("owner", "command"):
                next_owner = seq[m][0]
                break
        if not reached:
            rows.append({"line": ln, "ts": ts, "verdict": "UNRUN", "body_line": seq[j][0],
                         "next_owner_line": next_owner, "content": command_line(text) or text})
    return rows, scanned


def scan(path):
    """-> (queued, delivered_texts, records_read, unparseable, seq). Raises on an unreadable file.

    `seq` is the UNRUN arm's input: (line, ts, kind, command_text) for every record turn_kind()
    classifies, in file order.

    `unparseable` exists because the bare `continue` below used to swallow a broken line with
    no counter and no floor, so a transcript that failed to parse ENTIRELY returned a clean
    `✅ every queued utterance has a matching later delivery` at rc=0 (2026-09-07).
    Latent rather than live — 0 unparseable lines across all 216 transcripts at that date —
    but the failure direction is the expensive one: total silence read as a total all-clear.
    """
    queued, delivered, n, unparseable, seq = [], [], 0, 0, []
    with open(path, "r", errors="replace") as f:
        for i, line in enumerate(f, 1):
            n += 1
            try:
                rec = json.loads(line)
            except Exception:
                if line.strip():
                    unparseable += 1
                continue
            kind = turn_kind(rec)
            if kind is not None:
                seq.append((i, rec.get("timestamp"), kind,
                            user_text(rec) if kind == "command" else ""))
            if rec.get("type") == "queue-operation":
                c = norm(rec.get("content"))
                if c:
                    # CARRY `operation` — 2026-09-07. The docstring below used to say the
                    # queue plane cannot separate a harness DROP from the owner clearing the owner's own
                    # queue. That was false, and this scan was reading only `content` while the
                    # field that disposes sat one key away. `popAll` in particular is the harness
                    # draining the queue back into the owner's editor, which is not a loss at all.
                    # ⚠️ The two lenses that traced my founding directives AGREE the records were
                    # enqueued, popAll'd and never absorbed, and DISAGREE on what popAll means —
                    # the discriminator is a harness-internals claim nobody here verified. So this
                    # field does not settle disposition either; it makes the distinction VISIBLE
                    # to the owner, which is all the tool is entitled to do.
                    queued.append({"line": i, "ts": rec.get("timestamp"), "content": c,
                                   "op": rec.get("operation")})
                continue
            # THE PRIMARY DELIVERY PLANE, and it is NOT a `type:"user"` record — measured
            # 2026-09-07. A queued message ARRIVES as an attachment record holding a NESTED
            # `queued_command` object with `origin.kind == "human"` and its text at `.prompt`.
            # This is the positive author test the queue plane itself does not carry, so it is
            # what makes the verdict evidence rather than shape-guessing. A probe that looks for
            # deliveries among `type:"user"` records alone reads EVERY queued message as lost.
            if rec.get("type") == "attachment":
                a = rec.get("attachment") or {}
                if a.get("type") == "queued_command" and (a.get("origin") or {}).get("kind") == "human":
                    p = norm(a.get("prompt"))
                    if p:
                        delivered.append({"line": i, "text": p})
                continue
            # THE `last-prompt` PLANE — 2026-09-07, and the CAP is half the finding.
            # 42 of 84 residue rows across 12 transcripts carry one of these, so omitting the
            # plane leaves real deliveries unwitnessed. ⛔ BUT `lastPrompt` IS HARD-TRUNCATED
            # AT 201 CHARACTERS — re-derived here over 25 transcripts: 17,037 records with
            # text, max length exactly 201, 2,522 sitting at the cap. So this plane can clear
            # a short or medium utterance and CAN NEVER CLEAR ANYTHING LONGER THAN 201 CHARS,
            # whatever really happened to it. The residue list therefore stays biased toward
            # LONG messages — safely, in the report-it direction, but invisibly unless it is
            # written down, which is why this comment is as long as it is. The truncation is
            # also shape-selective against this owner's house style (a quoted preamble plus a
            # trailing ask keeps the quotation and loses the ask), so a long directive is
            # exactly the kind this plane cannot rescue.
            if rec.get("type") == "last-prompt":
                lp = norm(rec.get("lastPrompt"))
                if lp:
                    delivered.append({"line": i, "text": lp})
                continue
            t = user_text(rec)
            if t:
                delivered.append({"line": i, "text": t})
                # ⛔ A QUEUED SLASH COMMAND COULD NEVER TEST AS DELIVERED — 2026-09-07,
                # found independently by two lenses on different corpora and verified at source.
                # The harness RE-SHAPES a command on delivery, so the queued string is not a
                # contiguous substring of what arrives:
                #     queued     '/eli5 the open question'
                #     delivered  '<command-message>eli5</command-message>
                #                 <command-name>/eli5</command-name>
                #                 <command-args>the open question</command-args>'
                # The delivery is present, owner-shaped and correctly captured above; only the
                # MATCH fails. Measured cost: ~42% of all NOT-DELIVERED output across 20
                # transcripts, 50 of 56 slash-with-args rows provably delivered.
                # ⛔ AND MY OWN FOUNDING DIRECTIVE IS IN THIS CLASS — it opens with a `/mail` command
                # and its arguments, so the tool's NOT-DELIVERED verdict on the exact row it was
                # built for carried ZERO BITS. It may still be genuinely undelivered; the
                # instrument had not established that and my tracker row said it had.
                # Synthesise the reconstructed form as a SECOND delivery key for the same record.
                recon = command_line(t)
                if recon:
                    delivered.append({"line": i, "text": recon})
    return queued, delivered, n, unparseable, seq


def residue(queued, delivered):
    """A queued utterance is DELIVERED if some owner-shaped user record LATER contains it.

    Returns (rows, excluded_count) — the count is printed so the denylist stays auditable.
    """
    # ⛔ ACCUMULATE THE OPS BEFORE DEDUPING, OR THE FIELD IS A CONSTANT. Caught on my own fold,
    # 2026-09-07, one hour after this exact class had been named: I carried `operation` into the
    # row and the dedup below keeps the FIRST record for a content — which is always the
    # `enqueue`, because a `popAll` re-emits the SAME content later. Every row printed
    # "queue-op: enqueue" (10 of 10), a value that could not have come out any other way. The
    # disposition lives in the LATER record, i.e. precisely the one dedup discards.
    # **Capture side learned, reporting side did not** — the same structural defect, committed
    # again by the reader who had just been warned of it.
    ops_by_content = {}
    for q in queued:
        if q.get("op"):
            ops_by_content.setdefault(q["content"], []).append(q["op"])

    # ⛔ ANCHOR THE DELIVERY WINDOW ON THE *LAST ENQUEUE*, NOT THE FIRST RECORD —
    # 2026-09-07 (1 instance in 1,338, so this is a correctness fix, not a volume one). The
    # dedup below keeps the FIRST record for a content, and the delivery test asks whether any
    # delivery came AFTER it. So a message queued at L1, delivered at L2, then RE-QUEUED at L3
    # and never delivered again reads as cleared: the L2 delivery satisfies the L1 anchor and
    # the genuine L3 loss is invisible.
    #   Why the LAST ENQUEUE and not simply the last record: a `popAll` re-emits the same
    #   content at a LATER line, and it is the harness draining the queue, not the owner
    #   re-queueing. Anchoring on the last record of any kind would put the window after a
    #   popAll that follows a real delivery and manufacture a false NOT-DELIVERED. An
    #   `enqueue` is the only op that restarts the question.
    _first, _last_enq = {}, {}
    for q in queued:
        _first.setdefault(q["content"], q["line"])
        if q.get("op") == "enqueue":
            _last_enq[q["content"]] = q["line"]      # file order, so the last one wins
    def _anchor(c):
        return _last_enq.get(c, _first.get(c, 0))

    seen, out, excluded, weak = set(), [], 0, 0
    for q in queued:
        c = q["content"]
        if c in seen:
            continue          # a popAll re-emits the same content; one utterance, not two
        seen.add(c)
        if c.startswith(HARNESS_PREFIXES):
            excluded += 1
            continue
        # ⛔ LOOK FIRST, THEN DISTRUST — 2026-09-07. `MIN_KEY` used to SHORT-CIRCUIT
        # ahead of the delivery check, so no short message could ever be cleared however
        # obvious its delivery was. The proof, from another session's transcript: one record
        # queues a short owner message, a `promptSource:"queued"` delivery of exactly that text
        # follows TWO RECORDS LATER, and the row still printed UNVERIFIABLE. That made `/wrap`,
        # `/summary`, `/working-plan` and `proceed` permanent residue by construction.
        # MIN_KEY's real job is distrusting a MATCH (a short string collides easily), never
        # refusing to look for one.
        matched = any(d["line"] > _anchor(c) and c in d["text"] for d in delivered)
        if matched:
            if len(c) < MIN_KEY:
                weak += 1     # cleared, but on a key short enough to collide — counted, not hidden
            continue
        if len(c) < MIN_KEY:
            out.append(dict(q, verdict="UNVERIFIABLE", ops=ops_by_content.get(c, [])))
            continue
        out.append(dict(q, verdict="NOT-DELIVERED", ops=ops_by_content.get(c, [])))
    return out, excluded, weak


def skill_fixture(assistant_after_body, typed=True):
    """The delivered-but-unrun slash command, synthetic, in the real record shape (docstring).

    A: the command (user, turnOrigin human, no promptSource, no isMeta, three tag lines) · B: its
    skill body (isMeta, same timestamp) · C: a command_permissions attachment · the timestampless
    harness records · a local command pair · a typed owner message · the reply to THAT message.
    `assistant_after_body` inserts a reply after C: the command reached a turn (positive control).
    `typed=False` drops the typed message so the local command is the only boundary.
    """
    t0, t1, t2 = "2026-01-01T10:00:00.000Z", "2026-01-01T10:00:20.000Z", "2026-01-01T10:00:40.000Z"
    recs = [
        {"type": "user", "turnOrigin": "human", "uuid": "c-cmd", "parentUuid": "c-prev",
         "timestamp": t0, "message": {"role": "user", "content":
            "<command-message>wrap</command-message>\n<command-name>/wrap</command-name>\n"
            "<command-args>--checkpoint --sonnet</command-args>"}},
        {"type": "user", "isMeta": True, "uuid": "c-body", "parentUuid": "c-cmd", "timestamp": t0,
         "message": {"role": "user", "content":
            "Base directory for this skill: ~/.claude/skills/wrap\n\n"
            "# Placeholder skill\n\nStep 1. placeholder step.\nStep 2. placeholder step."}},
        {"type": "attachment", "uuid": "c-perm", "parentUuid": "c-body", "timestamp": t0,
         "attachment": {"type": "command_permissions", "allowedTools": []}},
    ]
    if assistant_after_body:
        recs.append({"type": "assistant", "uuid": "c-run", "parentUuid": "c-perm", "timestamp": t0,
                     "message": {"role": "assistant",
                                 "content": [{"type": "text", "text": "placeholder skill turn"}]}})
    recs += [
        {"type": "file-history-snapshot", "messageId": "c-fhs", "snapshot": {}},
        {"type": "last-prompt", "lastPrompt": "placeholder"},
        {"type": "custom-title", "customTitle": "placeholder"},
        {"type": "ai-title", "aiTitle": "placeholder"},
        {"type": "agent-name", "agentName": "placeholder"},
        {"type": "agent-color", "agentColor": "placeholder"},
        {"type": "mode", "mode": "placeholder"},
        {"type": "system", "subtype": "local_command", "uuid": "c-ctx",
         "parentUuid": recs[-1]["uuid"], "timestamp": t1,
         "content": "<command-name>/context</command-name>"},
        {"type": "system", "subtype": "local_command", "uuid": "c-ctx-out", "parentUuid": "c-ctx",
         "timestamp": t1, "content": "<local-command-stdout>placeholder</local-command-stdout>"},
    ]
    last = "c-ctx-out"
    if typed:
        recs.append({"type": "user", "promptSource": "typed", "uuid": "c-typed", "parentUuid": last,
                     "timestamp": t2, "message": {"role": "user", "content": "placeholder message"}})
        last = "c-typed"
    recs.append({"type": "assistant", "uuid": "c-reply", "parentUuid": last, "timestamp": t2,
                 "message": {"role": "assistant",
                             "content": [{"type": "text", "text": "placeholder reply"}]}})
    return recs


def self_test():
    """Both arms required: the control MUST read the other way, or this test certifies nothing."""
    lost = "please mail this to the other session once the timing allows it"
    got = "please go ahead and land the fix we discussed in the other file"
    recs = [
        {"type": "queue-operation", "content": lost, "timestamp": "T0"},
        {"type": "queue-operation", "content": got, "timestamp": "T1"},
        # DELIVERY for `got` only.
        {"type": "user", "promptSource": "typed", "message": {"content": got}},
        # NOT a delivery for `lost`, though it quotes it verbatim — this is the guard under test.
        {"type": "user", "promptSource": "system", "message": {"content": "agent report: " + lost}},
    ]
    q = [{"line": i, "ts": r.get("timestamp"), "content": norm(r["content"])}
         for i, r in enumerate(recs, 1) if r["type"] == "queue-operation"]
    d = [{"line": i, "text": t} for i, r in enumerate(recs, 1) if (t := user_text(r))]
    res, _, _ = residue(q, d)
    names = [r["content"] for r in res]
    ok = True
    if lost not in names:
        print("FAIL: a queued-and-never-delivered message was not reported")
        ok = False
    if got in names:
        print("FAIL: a queued message that WAS delivered got reported (control read the wrong way)")
        ok = False
    if len(d) != 1:
        print(f"FAIL: promptSource=system counted as a delivery (delivered={len(d)}, expected 1)")
        ok = False
    # ── scan() ARMS — the function the fix actually changed
    # (2026-09-07). Every arm above builds `q` and `d` BY HAND, re-implementing scan()'s
    # extraction inline, so the harness was green over a scan() that had been reverted: the
    # attachment delivery plane, the `operation` carry and the slash-command reconstruction
    # were all untested by the suite that certified them. The fixture below drives the REAL
    # scan() over a REAL file and every assertion is content-keyed, so an emptied fixture
    # goes RED rather than vacuously passing.
    import tempfile
    LOST = "please mail the queue-plane finding to the spinoff session once the timing allows"
    SLASH_ARGS = "the open question we discussed earlier in this session"
    ATT = "go ahead and land the attachment-plane fix in the other file"
    SHORT = "check the residue scanner against the last-prompt plane"
    LONG = ("here is a directive long enough to be truncated by the last-prompt mirror, which "
            "hard-caps at two hundred and one characters, so no amount of correct capture on "
            "that plane can ever clear this row and the code says so out loud in its comment")
    IMG = "[Image #2] here is the screenshot of the page I mentioned a moment ago"
    REQ = "please re-run the reconcile once the peer commit lands and tell me what moved"
    # The `<LOST>` content is enqueued and then popAll'd — the two-op shape the ops carry
    # exists to make visible. The slash row is delivered ONLY in the harness's reshaped form,
    # so it is cleared by the reconstruction or not at all. The `<ATT>` row is delivered ONLY
    # on the attachment plane, so it is cleared by that branch or not at all. The trailing
    # promptSource=system record quotes `<LOST>` verbatim and must clear nothing.
    recs = [
        {"type": "queue-operation", "operation": "enqueue", "timestamp": "T0", "content": LOST},
        {"type": "queue-operation", "operation": "popAll", "timestamp": "T1", "content": LOST},
        {"type": "queue-operation", "operation": "enqueue", "timestamp": "T2", "content": "/eli5 " + SLASH_ARGS},
        {"type": "queue-operation", "operation": "enqueue", "timestamp": "T3", "content": ATT},
        {"type": "user", "promptSource": "typed", "message": {"content":
            "<command-message>eli5</command-message>\n<command-name>/eli5</command-name>\n"
            "<command-args>" + SLASH_ARGS + "</command-args>"}},
        {"type": "attachment", "attachment": {"type": "queued_command",
                                              "origin": {"kind": "human"}, "prompt": ATT}},
        {"type": "user", "promptSource": "system", "message": {"content": "agent report: " + LOST}},
        # ── the last-prompt plane, both directions. SHORT is under the 201-char cap and its
        # mirror carries it whole, so it clears. LONG is over the cap, so the mirror is
        # TRUNCATED and can never contain it — the row stays NOT-DELIVERED whatever really
        # happened to it, which is the bias this plane introduces and the reason the arm below
        # asserts it rather than leaving it to be rediscovered.
        {"type": "queue-operation", "operation": "enqueue", "timestamp": "T4", "content": SHORT},
        {"type": "queue-operation", "operation": "enqueue", "timestamp": "T5", "content": LONG},
        {"type": "last-prompt", "lastPrompt": SHORT},
        {"type": "last-prompt", "lastPrompt": LONG[:201]},
        # ── the three denylist shapes, one record each …
        {"type": "queue-operation", "operation": "enqueue", "timestamp": "T6",
         "content": "<cross-session-message from=\"uds:/tmp/cc-socks/55150.sock\">peer ping</cross-session-message>"},
        {"type": "queue-operation", "operation": "enqueue", "timestamp": "T7",
         "content": "[Owner-authorized WO-N RETRY — one-shot cron fired ~12:01 CET] resume the work order"},
        {"type": "queue-operation", "operation": "enqueue", "timestamp": "T8",
         "content": "# Autonomous loop check You're being invoked on a timer while the user is away"},
        {"type": "queue-operation", "operation": "enqueue", "timestamp": "T8b",
         "content": "<agent-message from=\"<agent-id>\"> [Subagent hand-back] The text below is the final report of a subagent this session delegated to."},
        {"type": "queue-operation", "operation": "enqueue", "timestamp": "T8c",
         "content": "# Autonomous loop tick (dynamic pacing) Run the autonomous check now"},
        {"type": "queue-operation", "operation": "enqueue", "timestamp": "T8d",
         "content": "[keep-warm] automated cache keep-alive, scheduled by this session."},
        # … and the control that must NOT be excluded: an image paste is OWNER SPEECH, and it
        # opens with a bracket exactly like the autorun preamble two rows up.
        {"type": "queue-operation", "operation": "enqueue", "timestamp": "T9", "content": IMG},
        # ── re-queued after a delivery: the L1-delivered / L3-requeued shape that the
        # first-record anchor cleared and the last-enqueue anchor correctly reports.
        {"type": "queue-operation", "operation": "enqueue", "timestamp": "TA", "content": REQ},
        {"type": "user", "promptSource": "typed", "message": {"content": REQ}},
        {"type": "queue-operation", "operation": "enqueue", "timestamp": "TB", "content": REQ},
    ]
    fd, fx = tempfile.mkstemp(prefix="residue-selftest-", suffix=".jsonl")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            for r in recs:
                fh.write(json.dumps(r) + "\n")
            fh.write("{ this line is not json\n")   # the broken line the bare `continue` used to swallow
        sq, sd, sn, sbad, _ = scan(fx)
        srows, sexc, sweak = residue(sq, sd)
        names = {r["content"]: r for r in srows}
        arms = [
            ("scan() read every record, the unparseable one included",
             sn == len(recs) + 1),
            ("scan() carries `operation` — enqueue THEN popAll, not the deduped first one",
             [q["op"] for q in sq if q["content"] == LOST] == ["enqueue", "popAll"]),
            ("scan() reads the ATTACHMENT delivery plane (queued_command/origin.kind==human)",
             any(d["text"] == ATT for d in sd)),
            ("scan() reconstructs a slash command from <command-name>/<command-args>",
             any(d["text"] == "/eli5 " + SLASH_ARGS for d in sd)),
            ("scan() does NOT count promptSource=system as a delivery (control)",
             not any("agent report" in d["text"] for d in sd)),
            ("residue() reports the genuinely undelivered message",
             LOST in names and names[LOST]["verdict"] == "NOT-DELIVERED"),
            ("residue() surfaces its queue-ops, so enqueue->popAll is visible to the owner",
             names.get(LOST, {}).get("ops") == ["enqueue", "popAll"]),
            ("residue() CLEARS the slash command (revert the reconstruction and this REDs)",
             ("/eli5 " + SLASH_ARGS) not in names),
            ("residue() CLEARS the attachment-plane delivery (revert that branch and this REDs)",
             ATT not in names),
            ("scan() reads the last-prompt plane and residue() CLEARS a message under the cap",
             SHORT not in names),
            ("a message OVER the 201-char cap stays NOT-DELIVERED — the mirror is truncated, so "
             "this plane cannot rescue it and the list stays biased toward long messages",
             LONG in names and names[LONG]["verdict"] == "NOT-DELIVERED"),
            ("the six added harness shapes are all excluded (6 of the 7 bracket/tag/heading rows: "
             "the /loop tick form and the [keep-warm] sentinel included)",
             sexc == 6),
            ("an [Image #N] paste is OWNER SPEECH and is NOT excluded — the control that stops "
             "the denylist being generalised to a bare '[' prefix",
             IMG in names),
            ("a message RE-QUEUED after its delivery is reported, not cleared by the earlier "
             "delivery (the last-enqueue anchor)",
             REQ in names and names[REQ]["verdict"] == "NOT-DELIVERED"),
            ("scan() counts unparseable lines rather than swallowing them", sbad == 1),
        ]
        for label, cond in arms:
            if not cond:
                print("FAIL: " + label)
                ok = False
    finally:
        os.unlink(fx)

    # ── THE UNRUN ARM (docstring § DELIVERED IS NOT REACHED). Each fixture goes through the REAL
    # scan() over a REAL file, then unrun_skill_commands() — the pair main() takes its UNRUN rows
    # from. Removing the rule REDs the first arm; the control must read the other way.
    def _unrun(recs2):
        fd2, fx2 = tempfile.mkstemp(prefix="residue-selftest-unrun-", suffix=".jsonl")
        try:
            with os.fdopen(fd2, "w", encoding="utf-8") as fh2:
                for r in recs2:
                    fh2.write(json.dumps(r) + "\n")
            return unrun_skill_commands(scan(fx2)[4])
        finally:
            os.unlink(fx2)
    d_rows, d_scanned = _unrun(skill_fixture(False))
    c_rows, c_scanned = _unrun(skill_fixture(True))
    l_rows, _ = _unrun(skill_fixture(False, typed=False))
    unrun_arms = [
        ("UNRUN arm FLAGS a slash command whose skill body was delivered and whose next record "
         "was the owner acting, with no assistant record between",
         [(r["line"], r["verdict"], r["content"], r["next_owner_line"]) for r in d_rows]
         == [(1, "UNRUN", "/wrap --checkpoint --sonnet", 13)] and d_scanned == 1),
        ("UNRUN control: the same sequence with an assistant record after the skill body is CLEAN",
         c_rows == [] and c_scanned == 1),
        ("UNRUN control: a local command alone is NOT the owner acting — it starts no turn, so the "
         "reply after it is the command's own turn (19 false rows on real data otherwise)",
         l_rows == []),
    ]
    _base = skill_fixture(False, typed=False)[:3]          # command, skill body, permissions
    _reply = [{"type": "assistant", "uuid": "k-reply", "timestamp": "T2", "message": {
        "role": "assistant", "content": [{"type": "text", "text": "placeholder"}]}}]
    _typed = [{"type": "user", "promptSource": "typed", "uuid": "k-typed", "timestamp": "T1",
               "message": {"role": "user", "content": "placeholder message"}}]
    _cmp = [{"type": "system", "subtype": "compact_boundary", "uuid": "k-cb", "timestamp": "T1"},
            {"type": "user", "isCompactSummary": True, "uuid": "k-sum", "timestamp": "T1",
             "message": {"role": "user", "content":
                 "placeholder summary quoting <command-message>summary</command-message>"}}]
    _side = [{"type": "assistant", "isSidechain": True, "uuid": "k-side", "timestamp": "T1",
              "message": {"role": "assistant", "content": [{"type": "text", "text": "placeholder"}]}}]
    _noise = [{"type": "user", "isMeta": True, "uuid": "k-rem", "timestamp": "T1",
               "message": {"role": "user", "content": "<system-reminder>placeholder</system-reminder>"}},
              {"type": "system", "subtype": "informational", "uuid": "k-inf", "timestamp": "T1"},
              {"type": "attachment", "uuid": "k-hook", "timestamp": "T1",
               "attachment": {"type": "hook_additional_context"}},
              {"type": "user", "promptSource": "system", "uuid": "k-note", "timestamp": "T1",
               "message": {"role": "user", "content": "<task-notification>placeholder</task-notification>"}},
              {"type": "user", "uuid": "k-tr", "timestamp": "T1", "message": {"role": "user",
               "content": [{"type": "tool_result", "tool_use_id": "t", "content": "placeholder"}]}}]
    unrun_arms += [
        ("UNRUN control: a compaction summary quoting a <command-message> block is not a command",
         _unrun(_base + _cmp + _reply)[0] == []),
        ("UNRUN arm: a SIDECHAIN assistant after the body does not reach the command",
         [r["line"] for r in _unrun(_base + _side + _typed + _reply)[0]] == [1]),
        ("UNRUN control: non-owner records between the body and the reply decide nothing (a task "
         "notification included — the harness writes one as a user record mid-turn too)",
         _unrun(_base + _noise + _reply)[0] == []),
    ]
    # A MACHINE-fired slash command (turnOrigin in MACHINE_TURN_ORIGINS) is not the owner acting:
    # between a body and its reply it decides nothing; on its own it is not scanned as a command,
    # where the same record fired by a human is (the control). Membership, never == "human".
    _sched = [dict(_base[0], turnOrigin="scheduled", uuid="k-sched", timestamp="T1")]
    _sched_alone = [dict(_base[0], turnOrigin="scheduled")] + _base[1:] + _typed + _reply
    _human_alone = [dict(_base[0], turnOrigin="human")] + _base[1:] + _typed + _reply
    unrun_arms += [
        ("UNRUN control: a machine-fired slash command between the body and the reply is no boundary",
         _unrun(_base + _sched + _reply)[0] == []),
        ("UNRUN control: a machine-fired slash command is not scanned as a command, where the same "
         "record fired by a human is",
         _unrun(_sched_alone) == ([], 0) and [r["line"] for r in _unrun(_human_alone)[0]] == [1]),
    ]
    # PARITY with the orphan scan's copy of turn_kind (orphaned-prompt-scan.py): the skill-body arm
    # is written twice, and a boundary fix landing in one copy only would make the two scans
    # disagree on real data. Both copies run over every fixture record this self-test builds; the
    # sibling is loaded from its path, and a missing sibling is a FAIL.
    import importlib.util
    _sib_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "orphaned-prompt-scan.py")
    _parity = (_base + _noise + _cmp + _side + _sched + _typed + _reply + skill_fixture(False)
               + skill_fixture(False, typed=False) + [dict(_base[0], turnOrigin="human"),
                                                      dict(_base[0], turnOrigin="peer")])
    try:
        _spec = importlib.util.spec_from_file_location("orphan_scan_sibling", _sib_path)
        _sib = importlib.util.module_from_spec(_spec)
        _spec.loader.exec_module(_sib)
        _diff = [(i, turn_kind(r), _sib.turn_kind(r)) for i, r in enumerate(_parity)
                 if turn_kind(r) != _sib.turn_kind(r)]
    except Exception as _e:  # a missing or unloadable sibling is a failure, not a skip
        _diff = [("sibling", type(_e).__name__, str(_e)[:80])]
    unrun_arms += [(f"UNRUN parity: the orphan scan's turn_kind agrees on all {len(_parity)} fixture "
                    f"records (mismatches {_diff})", _diff == [])]
    for label, cond in unrun_arms:
        if not cond:
            print("FAIL: " + label)
            ok = False

    # main()'s argv handling — a bare trailing `--sid` must ABORT cleanly, not raise. The arm
    # asserts rc, so removing the bounds check turns this from a PASS into an exception the
    # harness reports rather than a silent regression.
    import contextlib
    _argv, _err = sys.argv, io.StringIO()
    try:
        sys.argv = ["queued-directive-residue-scan.py", "--sid"]
        try:
            # Capture stderr so the expected ABORT does not print above "SELF-TEST: PASS" and
            # read as a failure — and assert on it, which makes the arm stronger than an rc
            # check alone: a bounds check that returned 1 silently would still be wrong.
            with contextlib.redirect_stderr(_err):
                _rc = main()
        except Exception as _e:
            _rc = f"raised {type(_e).__name__}"
        if _rc != 1 or "--sid needs a value" not in _err.getvalue():
            print(f"FAIL: a bare trailing --sid must ABORT with rc=1 and say why, "
                  f"got rc={_rc!r} stderr={_err.getvalue().strip()[:60]!r}")
            ok = False
    finally:
        sys.argv = _argv

    # main() must take its exit code from the UNRUN rows too. Every arm above stops at
    # unrun_skill_commands(); without this one, `if not res:` in place of `if not res and not
    # unrun:` exits 0 under a ✅ while the count line above it says UNRUN: 1.
    fd3, fx3 = tempfile.mkstemp(prefix="residue-selftest-main-", suffix=".jsonl")
    _tp, _argv3, _out3 = transcript_path, sys.argv, io.StringIO()
    try:
        with os.fdopen(fd3, "w", encoding="utf-8") as fh3:
            for r in skill_fixture(False):
                fh3.write(json.dumps(r) + "\n")
        globals()["transcript_path"] = lambda _sid: fx3
        sys.argv = ["queued-directive-residue-scan.py", "--sid", "selftest"]
        with contextlib.redirect_stdout(_out3):
            _rc3 = main()
        if (_rc3 != 3 or "[UNRUN] line 1 ·" not in _out3.getvalue()
                or "✅ every queued utterance has a matching later delivery." not in _out3.getvalue()):
            print(f"FAIL: main() must exit 3, list the UNRUN row and keep the queued-plane verdict, "
                  f"got rc={_rc3!r}")
            ok = False
    finally:
        globals()["transcript_path"] = _tp
        sys.argv = _argv3
        os.unlink(fx3)

    print("SELF-TEST: PASS" if ok else "SELF-TEST: FAIL")
    return 0 if ok else 1


def main():
    args = sys.argv[1:]
    if "--self-test" in args:
        return self_test()
    sid = None
    if "--sid" in args:
        _i = args.index("--sid")
        # A bare trailing `--sid` used to raise IndexError where every other failure in this
        # function prints a clean ABORT (2026-09-07) — a traceback reads as the tool
        # being broken rather than the invocation being wrong.
        if _i + 1 >= len(args):
            print("ABORT: --sid needs a value", file=sys.stderr)
            return 1
        sid = args[_i + 1]
    sid = sid or os.environ.get("CLAUDE_CODE_SESSION_ID")
    if not sid:
        print("ABORT: no session id (pass --sid or set CLAUDE_CODE_SESSION_ID)", file=sys.stderr)
        return 1
    path = transcript_path(sid)
    if not os.path.exists(path):
        print(f"ABORT: no transcript at {path}", file=sys.stderr)
        return 1

    queued, delivered, n, unparseable, seq = scan(path)
    res, excluded, weak = residue(queued, delivered)
    unrun, n_cmds = unrun_skill_commands(seq)
    uniq = len({q["content"] for q in queued})
    # Print the denominators unconditionally: a clean zero over an EMPTY queue plane is a
    # different fact from a clean zero over a busy one, and only the second is reassuring.
    print(f"queued utterances: {uniq} (from {len(queued)} queue records) · "
          f"owner-shaped deliveries: {len(delivered)} · records read: {n}")
    print(f"harness-shaped queued records excluded by prefix: {excluded} "
          f"(candidates after exclusion: {uniq - excluded})"
          + (f" · {weak} cleared on a key under {MIN_KEY} chars (match believed, key short enough to collide)" if weak else ""))
    n_cmd_recs = sum(1 for s in seq if s[2] == "command")
    print(f"slash commands with a delivered skill body: {n_cmds} of {n_cmd_recs} command record(s) · "
          f"with NO assistant record before the next owner record (UNRUN): {len(unrun)}")
    # An unparseable line means the scan did not see the whole transcript, so NO verdict it
    # produces is a verdict about this session — say so before any headline, and never exit 0.
    if unparseable:
        print(f"⛔ {unparseable} UNPARSEABLE LINE(S) — THIS RUN IS INCOMPLETE. The buckets below "
              f"are computed over the records that DID parse, so a clean result here is a "
              f"statement about a partial transcript and nothing more.", file=sys.stderr)
    if not res and not unrun:
        if unparseable:
            return 2
        print("✅ every queued utterance has a matching later delivery.")
        if n_cmds:
            print("✅ every slash command with a delivered skill body reached an assistant record "
                  "before the next owner record.")
        else:
            print("   no slash command here delivered a skill body, so the UNRUN arm checked nothing.")
        return 0
    if unrun:
        print(f"⚠️  {len(unrun)} UNRUN — a slash command whose skill body was DELIVERED, with NO assistant "
              f"record before the next owner record. READ THESE, do not count them:")
        for r in unrun:
            nxt = r["next_owner_line"] if r["next_owner_line"] is not None else "none (end of transcript)"
            print(f"  [UNRUN] line {r['line']} · {r['ts']} · skill body at line {r['body_line']} · "
                  f"next owner record at line {nxt}")
            print(f"    {r['content'][:400]}")
        print("    An interrupted or killed turn produces the same shape; this arm cannot separate them.")
        if not res:
            # The queued plane is still clean: say so, or a run with UNRUN rows drops that verdict.
            if not unparseable:
                print("✅ every queued utterance has a matching later delivery.")
            return 3
    # ⛔ SPLIT THE TWO VERDICTS IN THE HEADLINE — 2026-09-07. `len(res)` includes
    # UNVERIFIABLE rows, and they were printed under the sentence "NO matching delivery",
    # which is a claim UNVERIFIABLE explicitly does not make. Measured across 20 transcripts:
    # 257 rows under that sentence, 98 of them provably delivered; on one session the headline
    # read 96 against a true 46. The two verdicts have opposite meanings and one number.
    nd = [r for r in res if r["verdict"] == "NOT-DELIVERED"]
    uv = [r for r in res if r["verdict"] == "UNVERIFIABLE"]
    print(f"⚠️  {len(nd)} with NO matching delivery · {len(uv)} UNVERIFIABLE (too short to key on — "
          f"NOT a claim that they were dropped). READ THESE, do not count them:")
    for r in res:
        ops = " -> ".join(r.get("ops") or []) or (r.get("op") or "")
        print(f"  [{r['verdict']}] line {r['line']} · {r['ts']}" + (f" · queue-ops: {ops}" if ops else ""))
        print(f"    {r['content'][:400]}")
    # ⛔ THIS PARAGRAPH REPLACES A FALSE ONE. It used to say the queue plane carries no
    # tell at all. It carries at least two: the `operation` field printed above, and `remove`
    # records with reason "absorbed_mid_turn" (5,815 corpus-wide, 550 on owner content). What is
    # genuinely unsettled is narrower and worth stating exactly: these rows were enqueued,
    # drained by popAll and never absorbed, and it is OPEN whether popAll is the owner pulling
    # the owner's queue back into the editor (not a loss) or a harness drop. Nobody has
    # verified the harness-internals claim that would settle it.
    print("\n⚠️  A `popAll` queue-op may be the owner pulling the owner's own queue back into the editor,")
    print("    which is NOT a lost message. On real data so far this list has held ZERO confirmed")
    print("    harness drops — pop-to-edit, slash-command false positives and one harness refusal.")
    print("    Read the rows; do not report the count as a loss figure.")
    return 3


if __name__ == "__main__":
    sys.exit(main())
