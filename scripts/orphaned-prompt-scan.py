#!/usr/bin/env python3
"""Find owner messages that were DELIVERED into the transcript and never answered.

THE GAP THIS CLOSES. `queued-directive-residue-scan.py` reads QUEUE OPERATIONS
(enqueue -> popAll), so it sees only the messages the harness queued and dropped.
A message that arrives as an ordinary TYPED user record and simply never gets a
turn is invisible to it: there is no queue op to find, the record looks completely
normal, and nothing in-session tells you. Measured on one session, 2026-09-19:
2 of 37 typed owner messages were delivered and never answered — one of them
an explicit authorization to push to production.

THE PREDICATE. A prompt is ANSWERED iff an `assistant` record exists somewhere in
its descendant subtree (records chained by parentUuid). It is ORPHANED otherwise.

⛔ THE OBVIOUS PREDICATE IS A FALSE-NEGATIVE INSTRUMENT AND IT READS CLEAN.
"Is this uuid ever some record's parentUuid?" CANNOT return an orphan: the harness
attaches a `total_tokens_reminder` attachment (and often a file-history-snapshot)
as a child of EVERY user message, answered or not. That predicate was tried first
here and returned 0 orphans on a transcript with 2 real ones, with a control that
looked like it passed. The subtree must be searched for an ASSISTANT record
specifically. The self-test below pins exactly this: FIXTURE_ORPHAN carries an
attachment child, so a parent-existence predicate scores it answered.

OUTPUT IS A WORKLIST, NEVER A COUNT. Read the rows. A prompt can also be
legitimately unanswered because the session was interrupted or killed mid-turn —
this tool cannot separate that from a harness drop, and it does not try. It
surfaces the rows; the operator decides.

⛔ THE GAP THIS DOES NOT CLOSE — AND PRINTS INSTEAD (added 2026-09-25). An owner message sent
WHILE A TURN IS RUNNING arrives as a `queued_command` ATTACHMENT (`attachment.origin.kind ==
"human"`, `commandMode == "prompt"`), injected INTO that turn. It is not a `user` record, it has
no `promptSource`, and the assistant-descendant predicate is VACUOUS for it: everything the turn
produces afterwards is a descendant, so it can never read orphaned. Whether the turn actually
ANSWERED it is a semantic question no structure decides. Measured on one session,
2026-09-24: an owner question asking how much work remained in the session (transcript line 3112)
was delivered this way, never answered in text, and this tool printed CLEAN over 4 typed prompts.
So the scan now PRINTS every such attachment as a separate worklist — DELIVERED MID-TURN, READ
EACH — and changes nothing about the exit code, which still reports the structural population.

⛔ A SLASH COMMAND IS A SECOND POPULATION WITH A DIFFERENT PREDICATE (added 2026-10-06). A typed
slash command arrives as a `user` record with NO `promptSource` (its text is a `<command-message>`
block), so the population above never contained one. And the descendant predicate cannot just be
widened to cover it: for a skill, the harness delivers the skill body as the next record (`isMeta`,
opening "Base directory for this skill:"), the records chain linearly, and so whatever turn answers
the NEXT owner message is a descendant of the command too. A delivered skill body plus somebody
else's turn reads "reached". Founding shape: a skill command and its delivered body, then a local
command and a typed message inside the same minute; the turn answered the typed message, the
command's own turn started 78 minutes later, and this tool and its sibling both read CLEAN.
So a command whose skill body was delivered is REACHED only if a non-sidechain assistant record
follows the body IN FILE ORDER before the next owner record — an owner-source prompt or another
slash command — and is reported with source `slash-command` otherwise (unrun_skill_commands). Out
of scope: a command whose expansion does not open with that prefix (not a skill), and a mid-turn
`queued_command` attachment, which is delivered INTO a running turn and is never a boundary.
⛔ A LOCAL COMMAND IS NOT A BOUNDARY (measured 2026-10-06, 313 transcripts). The
first version counted a `system`/`local_command` record as the owner acting, and the harness runs
one INSIDE the skill's own turn before that turn's first assistant record: 19 of the 83 rows it
printed were /model, /effort, /rename, /color, /mcp or /remote-control with no owner prompt after
them, so the next assistant record WAS the command's turn (one landed 67 ms after the local
command). A local command starts no turn. A compaction summary is not a command either, even when
its prose quotes a `<command-message>` block (1 false row). Arms 11 and 12 pin both.
WHAT THE ROWS ARE (same corpus, 62 rows after that fix): a command the owner sent AGAIN before its
first reply appeared (34), an owner prompt or another skill command that took the turn (17), an
interrupted turn (8), and 3 others. The older user-record form of a local command (a
`<command-name>` block, no promptSource) still classifies as a command: it ended 15 walks, 13 of
them followed by an owner prompt, a re-sent command or an interrupt before any reply.
NOT CAUGHT: a turn that a HARNESS record started. A task notification can take a skill's turn the
same way (one /summary body sat 36 minutes until a notification's turn answered), but the harness
also writes one as a user record INSIDE a running turn, so it is not a boundary (arm 14). And a
synthetic API-error assistant record counts as reached (38 commands on this corpus) — that
failure shows on screen; this arm is for the silent one.

Exit: 0 clean · 3 residue (READ IT) · 1 instrument failure.
"""
import json
import os
import sys
from collections import defaultdict

PROJ = os.path.expanduser("~/.claude/projects/<project-key>")

# ⛔ THREE SOURCES, NOT ONE. This read `!= "typed"` until 2026-09-19 — while the SIBLING tool this
# file's docstring names as blind to our shape already had the full set written down one file over
# (`queued-directive-residue-scan.py:56`). Review measured the gap over 247 transcripts:
# 549 owner messages on the two excluded sources, 9 of them with NO assistant record anywhere —
# byte-identical in shape to this tool's two founding orphans, and four of the nine are directives.
# Neither tool covered them: the sibling asks whether a QUEUED utterance was delivered, so a
# delivered-but-unanswered one reads CLEAN there and was out of scope here. Exactly the hole this
# tool exists to close, one enum value over.
# ⚠️ WIDENED ON 9 READ ROWS, NOT ON A MEASURED FALSE-POSITIVE RATE. Nobody has characterised how
# often a `suggestion_accepted` legitimately goes unanswered, which is why the source is PRINTED
# per row: an operator should weigh those differently from a typed message.
OWNER_SOURCES = {"typed", "queued", "suggestion_accepted"}
# A user record the HARNESS fired (a cron-fired slash command, a task notification, a peer
# session's prompt, an auto-continuation) is not the owner acting: it is 'other' to the skill-body
# arm, never a command and never a boundary. The test is membership here, never == "human":
# turnOrigin is absent on older records (2,815 of 3,194 command-shaped records at 2026-10-06).
# Same set as scripts/post-compact-recovery-index.py's MACHINE_TURN_ORIGINS.
MACHINE_TURN_ORIGINS = {"task_notification", "peer", "auto_continuation", "scheduled"}

# The skill-body arm (docstring § A SLASH COMMAND IS A SECOND POPULATION).
SKILL_BODY_PREFIX = "Base directory for this skill:"
CMD_SOURCE = "slash-command"


def load(path):
    recs = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                recs.append((i, json.loads(line)))
            except Exception:
                continue
    return recs


def text_of(rec):
    m = rec.get("message") or {}
    c = m.get("content") if isinstance(m, dict) else None
    if isinstance(c, list):
        c = " ".join(
            b.get("text", "")
            for b in c
            if isinstance(b, dict) and b.get("type") == "text"
        )
    return c if isinstance(c, str) else ""


def find_orphans(recs):
    """Return [(line, ts, uuid, text)] for typed user prompts with no assistant descendant.

    `recs` is [(line_no, record_dict)] — the REAL shape load() returns, so the
    self-test exercises this exact function rather than a replica.
    """
    children = defaultdict(list)
    for ln, r in recs:
        pu = r.get("parentUuid")
        if pu:
            children[pu].append(r)

    def answered(uuid):
        stack, seen = [uuid], set()
        while stack:
            u = stack.pop()
            if u in seen:
                continue
            seen.add(u)
            for c in children.get(u, []):
                # NON-SIDECHAIN is load-bearing, not belt-and-braces. A sub-agent's
                # records carry isSidechain=True; if any harness version ever chains
                # them under the prompt, a dispatched agent's assistant record would
                # make an UNANSWERED prompt read answered — a clean CLEAN over a lost
                # owner directive, which is this tool's worst failure direction.
                # Measured 2026-09-19 on a 12,072-record transcript: 0 of 2,943
                # assistant records are sidechain, so this is a no-op on today's data
                # and closes the class by construction rather than by luck.
                if c.get("type") == "assistant" and not c.get("isSidechain"):
                    return True
                cu = c.get("uuid")
                if cu:
                    stack.append(cu)
        return False

    out = []
    for ln, r in recs:
        if r.get("type") != "user":
            continue
        if r.get("promptSource") not in OWNER_SOURCES:
            continue
        if not answered(r.get("uuid")):
            out.append((ln, r.get("timestamp"), r.get("uuid"), text_of(r), r.get("promptSource")))
    # The slash-command population, on its own predicate — NOT the descendant one above, which a
    # linear chain satisfies with the turn that answered somebody else (docstring).
    out.extend(unrun_skill_commands(recs)[0])
    out.sort(key=lambda row: row[0])
    return out


def turn_kind(rec):
    """Classify one record for the skill-body arm; None = not part of the sequence at all.

    'command'    a typed slash command: user, not isMeta, no promptSource, a <command-message> block
    'skill-body' an isMeta user record opening with SKILL_BODY_PREFIX
    'owner'      an owner-source prompt (typed / queued / suggestion_accepted)
    'assistant'  a non-sidechain assistant record
    'other'      any other user record, or a sidechain assistant — present, never decisive
    Attachments, every `system` record (a local command included — it starts no turn, docstring
    § A LOCAL COMMAND IS NOT A BOUNDARY) and the timestampless harness records (file-history-
    snapshot, last-prompt, titles, agent name/colour, mode) return None and are skipped. A
    compaction summary is 'other' even when its prose quotes a <command-message> block, and so
    is a user record the harness fired (turnOrigin in MACHINE_TURN_ORIGINS): a cron-fired slash
    command is neither scanned as the owner's nor a boundary for the command before it.
    """
    t = rec.get("type")
    if t == "assistant":
        return "other" if rec.get("isSidechain") else "assistant"
    if t != "user":
        return None
    if rec.get("isCompactSummary"):
        return "other"
    txt = text_of(rec)
    if rec.get("isMeta"):
        return "skill-body" if txt.lstrip().startswith(SKILL_BODY_PREFIX) else "other"
    if rec.get("turnOrigin") in MACHINE_TURN_ORIGINS:
        return "other"
    ps = rec.get("promptSource")
    if ps in OWNER_SOURCES:
        return "owner"
    if ps is None and "<command-message>" in txt:
        return "command"
    return "other"


def unrun_skill_commands(recs):
    """-> (rows, scanned). rows are [(line, ts, uuid, text, CMD_SOURCE)], find_orphans' row shape.

    A slash command is in scope when the first decisive record after it ('other' skipped) is its
    skill body. It is REACHED iff a non-sidechain assistant record follows that body, in FILE
    ORDER, before the next owner-shaped record ('owner' or another 'command'). Running off the
    end of the transcript with neither is reported too: a killed session and a harness drop look
    the same here, as they do for a typed prompt.
    """
    seq = [(ln, r, k) for ln, r in recs if (k := turn_kind(r)) is not None]
    rows, scanned = [], 0
    for i, (ln, r, k) in enumerate(seq):
        if k != "command":
            continue
        j = i + 1
        while j < len(seq) and seq[j][2] == "other":
            j += 1
        if j >= len(seq) or seq[j][2] != "skill-body":
            continue
        scanned += 1
        reached = False
        for m in range(j + 1, len(seq)):
            k2 = seq[m][2]
            if k2 == "assistant":
                reached = True
                break
            if k2 in ("owner", "command"):
                break
        if not reached:
            rows.append((ln, r.get("timestamp"), r.get("uuid"), text_of(r), CMD_SOURCE))
    return rows, scanned


def midturn_owner_attachments(recs):
    """[(line, ts, prompt)] — owner text delivered INTO A RUNNING TURN as a queued_command
    attachment. Both discriminators are load-bearing (post-compact/SKILL.md population (c)):
    task notifications ride the same attachment type with commandMode "task-notification", and
    on an older harness they carried origin.kind "human" too."""
    out = []
    for ln, r in recs:
        if r.get("type") != "attachment":
            continue
        a = r.get("attachment") or {}
        if a.get("type") != "queued_command":
            continue
        if (a.get("origin") or {}).get("kind") != "human" or a.get("commandMode") != "prompt":
            continue
        out.append((ln, r.get("timestamp"), prompt_text(a.get("prompt"))))
    return out


def prompt_text(p):
    """An image paste makes `prompt` a LIST of content blocks carrying base64 image data
    (169 of 2,783 owner attachments, 2026-09-25; one line printed 374,136 chars). Text only."""
    if isinstance(p, str):
        return p
    if not isinstance(p, list):
        return ""
    txt = " ".join(b.get("text", "") for b in p if isinstance(b, dict) and b.get("type") == "text")
    imgs = sum(1 for b in p if isinstance(b, dict) and b.get("type") == "image")
    return txt + (f" [{imgs} image(s) omitted]" if imgs else "")


# ---- fixtures: an ANSWERED prompt and an ORPHANED one that carries an attachment child.
# The attachment on the orphan is load-bearing: it is what makes the naive
# "is it anybody's parent" predicate score this record ANSWERED.
FIXTURE = [
    (1, {"type": "user", "promptSource": "typed", "uuid": "u-ok", "timestamp": "T1",
         "message": {"role": "user", "content": "answered one"}}),
    (2, {"type": "attachment", "parentUuid": "u-ok", "uuid": "a-ok"}),
    (3, {"type": "assistant", "parentUuid": "u-ok", "uuid": "asst-1",
         "message": {"role": "assistant", "content": "reply"}}),
    (4, {"type": "user", "promptSource": "typed", "uuid": "u-orphan", "timestamp": "T2",
         "message": {"role": "user", "content": "dropped one"}}),
    (5, {"type": "attachment", "parentUuid": "u-orphan", "uuid": "a-orphan"}),
    (6, {"type": "user", "promptSource": "typed", "uuid": "u-next", "timestamp": "T3",
         "parentUuid": "asst-1", "message": {"role": "user", "content": "next prompt"}}),
    (7, {"type": "assistant", "parentUuid": "u-next", "uuid": "asst-2",
         "message": {"role": "assistant", "content": "reply 2"}}),
]


def skill_fixture(assistant_after_body, typed=True):
    """The delivered-but-unrun slash command, synthetic, in the real record shape (docstring).

    A: the command (user, turnOrigin human, no promptSource, no isMeta, three tag lines) · B: its
    skill body (isMeta, same timestamp) · C: a command_permissions attachment · the timestampless
    harness records · a local command pair · a typed owner message · the reply to THAT message.
    Every record chains to the previous one, as the harness writes them, so the reply is also a
    DESCENDANT of A — the property that makes the descendant predicate read A as answered.
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
            "Base directory for this skill: <home>/.claude/skills/wrap\n\n"
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
    return list(enumerate(recs, 1))


def self_test():
    ok = True

    got = [u for _, _, u, _, _ in find_orphans(FIXTURE)]
    want = ["u-orphan"]
    print(f"  arm 1 (detects the orphan)      : got={got} want={want}")
    ok &= got == want

    # DISCRIMINATING CONTROL: give the orphan an assistant child. If the tool
    # reported orphans for some unrelated reason, this arm would still report one.
    healed = [r for r in FIXTURE] + [
        (8, {"type": "assistant", "parentUuid": "u-orphan", "uuid": "asst-3",
             "message": {"role": "assistant", "content": "late reply"}})
    ]
    got2 = [u for _, _, u, _, _ in find_orphans(healed)]
    print(f"  arm 2 (control: orphan healed)  : got={got2} want=[]")
    ok &= got2 == []

    # The naive predicate scores the orphan ANSWERED — pinned so a future
    # "simplification" back to it fails here instead of in production.
    parents = {r.get("parentUuid") for _, r in FIXTURE if r.get("parentUuid")}
    naive_says_answered = "u-orphan" in parents
    # ⚠️ FIXTURE-INTEGRITY GUARD, NOT A PIN ON THE IMPLEMENTATION — corrected 2026-09-19.
    # This computes the naive predicate INLINE and never calls find_orphans, so it is invariant
    # under the implementation: reverting answered() to the naive form REDs arms 1 and 5 and
    # leaves this GREEN. ARM 1 is what pins the predicate. What this arm does guarantee is that
    # the fixture still EXHIBITS the trap, so arm 1 cannot go vacuous without this going red too.
    print(f"  arm 3 (fixture still exhibits the trap): naive_answered={naive_says_answered} want=True")
    ok &= naive_says_answered is True

    # An assistant DEEPER in the subtree still counts as answered.
    deep = [r for r in FIXTURE] + [
        (8, {"type": "attachment", "parentUuid": "a-orphan", "uuid": "a-deep"}),
        (9, {"type": "assistant", "parentUuid": "a-deep", "uuid": "asst-4",
             "message": {"role": "assistant", "content": "deep reply"}}),
    ]
    got3 = [u for _, _, u, _, _ in find_orphans(deep)]
    print(f"  arm 4 (assistant deeper down)   : got={got3} want=[]")
    ok &= got3 == []

    # A SIDECHAIN assistant must NOT rescue an orphan (sub-agent records are not replies).
    sidechained = [r for r in FIXTURE] + [
        (8, {"type": "assistant", "parentUuid": "u-orphan", "uuid": "asst-sc",
             "isSidechain": True,
             "message": {"role": "assistant", "content": "sub-agent output"}})
    ]
    got4 = [u for _, _, u, _, _ in find_orphans(sidechained)]
    print(f"  arm 5 (sidechain does not rescue): got={got4} want=['u-orphan']")
    ok &= got4 == ["u-orphan"]

    # ⛔ ARM 6 — THE SOURCE SET. Until 2026-09-19 this file contained ZERO `queued` /
    # `suggestion_accepted` literals, so its 5 green arms were structurally incapable of
    # exhibiting the widest blind spot it had: it scanned 1 of 3 owner sources while the
    # sibling tool one file over already defined all 3. A fixture with only `typed` prompts
    # cannot fail that way, which is why the arm count was never the reassurance it looked like.
    multi = [
        (1, {"type": "user", "promptSource": "queued", "uuid": "u-q", "timestamp": "T1",
             "message": {"role": "user", "content": "queued and dropped"}}),
        (2, {"type": "attachment", "parentUuid": "u-q", "uuid": "a-q"}),
        (3, {"type": "user", "promptSource": "suggestion_accepted", "uuid": "u-s", "timestamp": "T2",
             "message": {"role": "user", "content": "suggestion accepted and dropped"}}),
        (4, {"type": "attachment", "parentUuid": "u-s", "uuid": "a-s"}),
        (5, {"type": "user", "promptSource": "system", "uuid": "u-sys", "timestamp": "T3",
             "message": {"role": "user", "content": "machine-generated, NOT an owner source"}}),
        (6, {"type": "attachment", "parentUuid": "u-sys", "uuid": "a-sys"}),
    ]
    got5 = sorted(u for _, _, u, _, _ in find_orphans(multi))
    print(f"  arm 6 (queued + suggestion, not system): got={got5} want=['u-q', 'u-s']")
    ok &= got5 == ["u-q", "u-s"]

    # arm 7 — the SOURCE must reach the row, because an operator weighs a suggestion_accepted
    # differently from a typed message and the widening was made on 9 read rows, not a rate.
    srcs = sorted(r[4] for r in find_orphans(multi))
    print(f"  arm 7 (source carried on the row)     : got={srcs} want=['queued', 'suggestion_accepted']")
    ok &= srcs == ["queued", "suggestion_accepted"]

    # arm 8 — the MID-TURN population is a different record type and must be listed on its own;
    # a task-notification attachment and a peer-origin one must NOT be (owner speech only).
    att = [
        (1, {"type": "attachment", "uuid": "at-h", "timestamp": "T1",
             "attachment": {"type": "queued_command", "commandMode": "prompt",
                            "origin": {"kind": "human"}, "prompt": "how much work is left?"}}),
        (2, {"type": "attachment", "uuid": "at-n", "timestamp": "T2",
             "attachment": {"type": "queued_command", "commandMode": "task-notification",
                            "prompt": "<task-notification>agent finished</task-notification>"}}),
        (3, {"type": "attachment", "uuid": "at-p", "timestamp": "T3",
             "attachment": {"type": "queued_command", "commandMode": "prompt",
                            "origin": {"kind": "peer"}, "prompt": "peer mail body"}}),
        (4, {"type": "attachment", "uuid": "at-oldharness", "timestamp": "T4",
             "attachment": {"type": "queued_command", "commandMode": "task-notification",
                            "origin": {"kind": "human"}, "prompt": "old-harness notification"}}),
        (5, {"type": "attachment", "uuid": "at-nomode", "timestamp": "T5",
             "attachment": {"type": "queued_command",
                            "origin": {"kind": "human"}, "prompt": "no commandMode at all"}}),
        (6, {"type": "attachment", "uuid": "at-img", "timestamp": "T6",
             "attachment": {"type": "queued_command", "commandMode": "prompt",
                            "origin": {"kind": "human"},
                            "prompt": [{"type": "text", "text": "[Image #1] fix this"},
                                       {"type": "image", "source": {"type": "base64",
                                                                    "data": "iVBORw0KGgo"}}]}}),
    ]
    got6 = [p for _, _, p in midturn_owner_attachments(att)]
    want6 = ["how much work is left?", "[Image #1] fix this [1 image(s) omitted]"]
    print(f"  arm 8 (mid-turn owner attachments only): got={got6} want={want6}")
    ok &= got6 == want6

    # ⛔ ARMS 9-11 — THE SKILL-BODY ARM (docstring). Each calls find_orphans, the function main()
    # takes its verdict from, so removing the arm from that function REDs arm 9, and widening the
    # descendant predicate to commands instead REDs it too (the fixture chains linearly, so the
    # reply to the typed message is a descendant of the command).
    got9 = [(r[2], r[4]) for r in find_orphans(skill_fixture(False))]
    want9 = [("c-cmd", CMD_SOURCE)]
    print(f"  arm 9 (skill body delivered, owner acted before any reply): got={got9} want={want9}")
    ok &= got9 == want9

    got10 = [(r[2], r[4]) for r in find_orphans(skill_fixture(True))]
    print(f"  arm 10 (control: a reply follows the skill body)          : got={got10} want=[]")
    ok &= got10 == []

    # arm 11 — a local command alone is NOT the owner acting: it starts no turn, so the reply
    # after it is the command's own turn (docstring § A LOCAL COMMAND IS NOT A BOUNDARY; 19 false
    # rows on real data while this arm asserted the opposite).
    got11 = [(r[2], r[4]) for r in find_orphans(skill_fixture(False, typed=False))]
    print(f"  arm 11 (a local command alone is not a boundary)          : got={got11} want=[]")
    ok &= got11 == []

    # arms 12-14 use the same synthetic shape, built here so each names one record kind.
    def _skill(window, tail):
        recs = [{"type": "user", "uuid": "k-cmd", "parentUuid": "k-prev", "timestamp": "T0",
                 "message": {"role": "user", "content":
                     "<command-message>wrap</command-message>\n<command-name>/wrap</command-name>"}},
                {"type": "user", "isMeta": True, "uuid": "k-body", "parentUuid": "k-cmd",
                 "timestamp": "T0", "message": {"role": "user", "content":
                     SKILL_BODY_PREFIX + " <home>/.claude/skills/wrap\n\nplaceholder"}}]
        return list(enumerate(recs + window + tail, 1))
    reply = [{"type": "assistant", "uuid": "k-reply", "parentUuid": "k-typed", "timestamp": "T2",
              "message": {"role": "assistant", "content": [{"type": "text", "text": "placeholder"}]}}]
    typed_then_reply = [{"type": "user", "promptSource": "typed", "uuid": "k-typed", "timestamp": "T1",
                         "message": {"role": "user", "content": "placeholder message"}}] + reply

    # arm 12 — a compaction summary quoting a <command-message> block is not a command.
    compaction = [{"type": "system", "subtype": "compact_boundary", "uuid": "k-cb", "timestamp": "T1"},
                  {"type": "user", "isCompactSummary": True, "uuid": "k-sum", "timestamp": "T1",
                   "message": {"role": "user", "content":
                       "placeholder summary quoting <command-message>summary</command-message>"}}]
    got12 = [(r[2], r[4]) for r in find_orphans(_skill(compaction, reply))]
    print(f"  arm 12 (a compaction summary is not a command)            : got={got12} want=[]")
    ok &= got12 == []

    # arm 13 — a SIDECHAIN assistant after the body is not the command's turn.
    side = [{"type": "assistant", "isSidechain": True, "uuid": "k-side", "timestamp": "T1",
             "message": {"role": "assistant", "content": [{"type": "text", "text": "placeholder"}]}}]
    got13 = [(r[2], r[4]) for r in find_orphans(_skill(side, typed_then_reply))]
    print(f"  arm 13 (a sidechain assistant does not reach the command) : got={got13} want={[('k-cmd', CMD_SOURCE)]}")
    ok &= got13 == [("k-cmd", CMD_SOURCE)]

    # arm 14 — the WIDE side of the boundary set: records that sit between a skill body and its
    # turn's first assistant record on real data, none of them the owner acting. A task
    # notification is here on purpose: the harness writes one as a user record mid-turn too.
    noise = [{"type": "user", "isMeta": True, "uuid": "k-rem", "timestamp": "T1",
              "message": {"role": "user", "content": "<system-reminder>placeholder</system-reminder>"}},
             {"type": "system", "subtype": "compact_boundary", "uuid": "k-cb2", "timestamp": "T1"},
             {"type": "system", "subtype": "informational", "uuid": "k-inf", "timestamp": "T1"},
             {"type": "attachment", "uuid": "k-hook", "timestamp": "T1",
              "attachment": {"type": "hook_additional_context"}},
             {"type": "user", "promptSource": "system", "uuid": "k-note", "timestamp": "T1",
              "message": {"role": "user", "content": "<task-notification>placeholder</task-notification>"}},
             {"type": "user", "uuid": "k-tr", "timestamp": "T1", "message": {"role": "user",
              "content": [{"type": "tool_result", "tool_use_id": "t", "content": "placeholder"}]}}]
    got14 = [(r[2], r[4]) for r in find_orphans(_skill(noise, reply))]
    print(f"  arm 14 (non-owner records between body and reply)         : got={got14} want=[]")
    ok &= got14 == []

    # arm 15 — a MACHINE-fired slash command (turnOrigin in MACHINE_TURN_ORIGINS: a cron-fired
    # /autorun, a task notification's turn, a peer's prompt, an auto-continuation) is not the
    # owner acting. Between a body and its reply it decides nothing (15a); on its own it is not
    # scanned as a command (15b), where the same record fired by a human is (15c, the control).
    # Membership, never == "human": turnOrigin is absent on older records.
    cmd_rec, body_rec = _skill([], [])[0][1], _skill([], [])[1][1]
    sched = [dict(cmd_rec, turnOrigin="scheduled", uuid="k-sched", timestamp="T1")]
    got15a = [(r[2], r[4]) for r in find_orphans(_skill(sched, reply))]
    got15b = [(r[2], r[4]) for r in find_orphans(list(enumerate(
        [dict(cmd_rec, turnOrigin="scheduled"), body_rec] + typed_then_reply, 1)))]
    got15c = [(r[2], r[4]) for r in find_orphans(list(enumerate(
        [dict(cmd_rec, turnOrigin="human"), body_rec] + typed_then_reply, 1)))]
    print(f"  arm 15 (a machine-fired command is no boundary, not scanned): got={got15a + got15b} want=[] · control={got15c} want={[('k-cmd', CMD_SOURCE)]}")
    ok &= got15a == [] and got15b == [] and got15c == [("k-cmd", CMD_SOURCE)]

    # arm 16 — PARITY with the residue scan's copy of turn_kind (queued-directive-residue-scan.py):
    # the skill-body arm is written twice, and a boundary fix landing in one copy only would make
    # the two scans disagree on real data. Both copies are run over every fixture record this
    # self-test builds; the sibling is loaded from its path, and a missing sibling is a FAIL.
    import importlib.util
    sib_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "queued-directive-residue-scan.py")
    parity_recs = ([r for _, r in _skill(noise + compaction + side + sched, typed_then_reply)]
                   + [r for _, r in skill_fixture(False)] + [r for _, r in skill_fixture(False, typed=False)]
                   + [dict(cmd_rec, turnOrigin="human"), dict(cmd_rec, turnOrigin="peer")])
    try:
        spec = importlib.util.spec_from_file_location("residue_scan_sibling", sib_path)
        sib = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(sib)
        mine = [turn_kind(r) for r in parity_recs]
        theirs = [sib.turn_kind(r) for r in parity_recs]
        diff16 = [(i, m, t) for i, (m, t) in enumerate(zip(mine, theirs)) if m != t]
    except Exception as e:  # a missing or unloadable sibling is a failure, not a skip
        diff16 = [("sibling", type(e).__name__, str(e)[:80])]
    print(f"  arm 16 (parity with the residue scan's turn_kind, {len(parity_recs)} records): mismatches={diff16} want=[]")
    ok &= diff16 == []

    print("SELF-TEST:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def main():
    args = sys.argv[1:]
    if "--self-test" in args:
        return self_test()

    sid = os.environ.get("CLAUDE_CODE_SESSION_ID", "")
    for i, a in enumerate(args):
        if a == "--sid" and i + 1 < len(args):
            sid = args[i + 1]
    if not sid:
        print("INSTRUMENT FAILURE: no session id (set CLAUDE_CODE_SESSION_ID or pass --sid)",
              file=sys.stderr)
        return 1

    path = os.path.join(PROJ, f"{sid}.jsonl")
    if not os.path.exists(path):
        print(f"INSTRUMENT FAILURE: transcript not found: {path}", file=sys.stderr)
        return 1

    recs = load(path)
    if not recs:
        print("INSTRUMENT FAILURE: transcript parsed to zero records", file=sys.stderr)
        return 1

    typed = sum(1 for _, r in recs
                if r.get("type") == "user" and r.get("promptSource") in OWNER_SOURCES)
    if typed == 0:
        print(f"INSTRUMENT FAILURE: zero typed owner prompts in {len(recs)} records — "
              "the promptSource field may have been renamed upstream", file=sys.stderr)
        return 1

    orphans = find_orphans(recs)
    n_cmds = unrun_skill_commands(recs)[1]
    n_cmd_recs = sum(1 for _, r in recs if turn_kind(r) == "command")
    print(f"orphaned-prompt-scan: {len(recs)} records, {typed} owner prompt(s) scanned "
          f"(sources: {', '.join(sorted(OWNER_SOURCES))}) · {n_cmds} of {n_cmd_recs} slash "
          "command record(s) delivered a skill body and were scanned")
    midturn = midturn_owner_attachments(recs)
    unmoded = sum(1 for _, r in recs if r.get("type") == "attachment"
                  and (r.get("attachment") or {}).get("type") == "queued_command"
                  and "commandMode" not in (r.get("attachment") or {}))
    if unmoded:
        print(f"⚠️ {unmoded} queued_command attachment(s) carry NO commandMode — schema drift? "
              "They are NOT in the mid-turn list below (0 of 27,154 lacked it on 2026-09-25).")
    if midturn:
        print(f"📎 {len(midturn)} mid-turn owner prompt(s) delivered as queued_command attachments — "
              "NOT covered by the verdict below (the descendant predicate is vacuous for them):\n"
              "   READ EACH and confirm the turn's reply addressed it; one of these went unanswered\n"
              "   under a CLEAN on 2026-09-24 (docstring).")
        for ln, ts, prompt in midturn:
            print(f"  line {ln} · {ts}")
            print(f"    {prompt!r}")  # UNCAPPED: the owner quotes first and rules LAST
        print()
    if not orphans:
        print("CLEAN — every owner prompt on those sources has a non-sidechain assistant record\n       in its subtree. NOT a proof that nothing was dropped: this answers *did it reach a turn\n       that produced output*, which is weaker than *was it answered*.")
        if n_cmds:
            print("       Every slash command with a delivered skill body was followed by an assistant\n       record before the next owner record.")
        else:
            print("       No slash command here delivered a skill body, so that arm checked nothing.")
        return 0

    n_cmd = sum(1 for o in orphans if o[4] == CMD_SOURCE)
    print()
    print(f"RESIDUE — {len(orphans) - n_cmd} typed owner prompt(s) with NO assistant reply anywhere below them.")
    if n_cmd:
        print(f"          {n_cmd} slash command(s) whose skill body was DELIVERED with NO assistant record\n"
              f"          before the next owner record (source {CMD_SOURCE}).")
    print("This is a WORKLIST. Read every row and decide; do not report the count as a loss figure.")
    print("A session killed or interrupted mid-turn produces the same shape as a harness drop —")
    print("this tool cannot separate them. Surface the rows to the owner; never narrate a fault.")
    print()
    for ln, ts, uuid, text, src in orphans:
        print(f"  line {ln} · {ts} · uuid {str(uuid)[:8]} · source {src}")
        print(f"    {text!r}")
    return 3


if __name__ == "__main__":
    sys.exit(main())
