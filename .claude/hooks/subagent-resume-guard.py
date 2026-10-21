#!/usr/bin/env python3
"""subagent-resume-guard.py — PreToolUse(SendMessage): a message to one of this session's helper agents that has
been IDLE for more than COLD_AFTER_S seconds is refused, with the price printed, unless the message carries the
marker RESUME-OK. Adopted after the fleet measurement below; the rule that a dead helper is RESUMED, warm or
cold, rather than re-seated fresh is untouched: this hook makes a cold resume a deliberate, priced act, never a forbidden one.

WHY. A helper's prompt cache lives 5 minutes (code.claude.com/docs/en/prompt-caching.md: sub-agents get the
five-minute TTL even on a subscription) and its timer resets only on a model call, so a message that lands after
the helper went idle makes its next call re-read its whole context at the cache-WRITE price, 1.25x base, where a
message delivered while it still runs rides the next tool round at the READ price, 0.1x. Measured 2026-10-19 over
7 days of this repo's sub-agent transcripts (1,494 agents): of 42 real mid-run cache rewrites (~10.4M tokens), 20 were a message
to a helper idle 8-124 minutes (5.27M tokens; 14 of them the 2026-10-12 limit-recovery resumes, 6 incidental
follow-ups incl. a 433k resume of a FINISHED builder for a command replay the sender could have run itself).
A sender sees none of this at the moment of sending; this hook puts the number in front of it.

WHAT IT DECIDES (fail OPEN on anything it cannot read; it never refuses a send it cannot price):
  - `to` is not one of this session's helpers (a peer session, "main", a name with no transcript) -> allow
  - the helper is RUNNING (a tool call in the tail still without a result) -> allow, logged allow-running (the
    message rides the next tool round); its newest record is younger than COLD_AFTER_S -> allow, logged allow-warm
  - the helper's newest record is an API error (it died at a session limit or a logout) -> cold at ANY idle, and
    the price comes from its last REAL usage record (the error record's usage is all zeros); no real usage record
    in the tail -> allow (unpriceable, so never refused)
  - the helper is idle longer than COLD_AFTER_S and the message carries RESUME-OK -> allow, logged as deliberate
  - otherwise -> deny, printing the idle age, the helper's context size (from its last usage record) and the
    re-read cost at 1.25x against a read at 0.1x, and the three ways out (do it yourself / a fresh small seat /
    add RESUME-OK).
COLD_AFTER_S is 240 (4 minutes): the 5-minute window less the time a queued message takes to be delivered and
the next call to start. The helper's transcript is <this session's transcript dir>/subagents/agent-<id>.jsonl,
derived from the payload's transcript_path; only its last TAIL_BYTES are read.
Escape: SKIP_SUBAGENT_RESUME_GUARD=1 (settings env block; a PreToolUse hook does not see an inline prefix).
Fires: .claude/logs/subagent-resume-guard-fires.jsonl (ts, sid8, target, decision, idle_s, context_tokens).
One JSON document on stdout, only on a deny; exit 0 always.
"""
import json, os, sys, time
from datetime import datetime, timezone

COLD_AFTER_S = 240
TAIL_BYTES = 262144
MARKER = "RESUME-OK"
WRITE_X, READ_X = 1.25, 0.1


def main():
    if os.environ.get("SKIP_SUBAGENT_RESUME_GUARD") == "1":
        return
    try:
        data = json.loads(sys.stdin.read() or "{}")
    except Exception:
        return
    if data.get("tool_name") != "SendMessage":
        return
    ti = data.get("tool_input") or {}
    target = str(ti.get("to") or "").split(" [")[0].strip()
    message = str(ti.get("message") or "")
    tp = str(data.get("transcript_path") or "")
    sid = str(data.get("session_id") or "")
    root = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()
    if not target or not tp.endswith(".jsonl"):
        return
    path = os.path.join(tp[:-len(".jsonl")], "subagents", f"agent-{target}.jsonl")
    if not os.path.isfile(path):
        return  # not one of this session's helpers: a peer session, "main", an unknown name
    state = read_tail(path)
    if state is None or (not state["running"] and state["context"] <= 0):
        return  # unreadable, or no real usage record in the tail: a send it cannot price is never refused
    now = time.time()
    idle = now - state["last_ts"]
    decision = ("allow-running" if state["running"]
                else "allow-warm" if idle <= COLD_AFTER_S and not state["dead"]
                else "allow-marker" if MARKER in message else "deny-cold")
    log(root, {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)), "sid8": sid[:8], "target": target[:17],
               "decision": decision, "idle_s": int(idle), "context_tokens": state["context"]})
    if decision != "deny-cold":
        return
    ctx = state["context"]
    reason = (
        f"Cold resume refused: helper {target} has been idle {idle/60:.1f} min (its last turn was at "
        f"{datetime.fromtimestamp(state['last_ts'], timezone.utc).strftime('%H:%M:%SZ')}), "
        f"{'and its newest record is an API error (it died at a limit or a logout, and such a resume measured cold whatever the idle)' if state['dead'] else 'past its 5-minute prompt cache'}, so this "
        f"message would make it re-read its whole context of about {ctx:,} tokens at the cache-write price "
        f"(~{int(ctx*WRITE_X):,} input-equivalent tokens) where a message delivered while it ran would have cost a read "
        f"(~{int(ctx*READ_X):,}). Three ways out, in order: do the follow-up yourself or in a fresh small seat briefed from the "
        f"helper's hand-back (a fresh seat starts near 62k tokens for an expert type, 85k for general-purpose and 20k for "
        f"Explore before it reads anything, so it is cheaper only when this context is well above that); send what you need WHILE a helper runs "
        f"next time; or, if the resume is worth {int(ctx*WRITE_X):,} tokens, re-send this exact message with the word "
        f"{MARKER} in it, which allows it and logs it as deliberate. A helper that DIED (a usage limit, a logout, an API "
        f"error: any row /limit-recovery reads RESUME) is still resumed under the resume-not-reseat rule, never re-seated: add "
        f"{MARKER}. (subagent-resume-guard.py; escape SKIP_SUBAGENT_RESUME_GUARD=1 in the "
        f"settings env block.)"
    )
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                             "permissionDecisionReason": reason}}))


def read_tail(path):
    """The helper's last meaningful record: its timestamp, whether a tool call is still open, and the context size
    from the newest usage. Reads only the tail; a record cut by the tail boundary is skipped (its line fails to parse)."""
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as fh:
            if size > TAIL_BYTES:
                fh.seek(size - TAIL_BYTES)
                fh.readline()  # drop the partial first line
            lines = fh.read().decode("utf-8", errors="replace").split("\n")
    except Exception:
        return None
    last_ts = None; running = False; context = 0; open_calls = set(); dead = False
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        typ = r.get("type")
        if typ not in ("assistant", "user"):
            continue
        t = parse_ts(r.get("timestamp"))
        if t is None:
            continue
        msg = r.get("message") or {}
        if typ == "assistant" and (r.get("isApiErrorMessage") or msg.get("model") == "<synthetic>"):
            # An API-error record (a session limit, a logged-out CLI) carries all-zero usage and marks a helper that
            # DIED: it neither prices the resume nor restarts the idle clock. Replayed 2026-10-19 over 2,396 sends
            # from 150 main transcripts: 770 of 774 resumes of such a helper missed the cache, 285 inside the bar.
            dead = True
            continue
        dead = False
        content = msg.get("content") if isinstance(msg.get("content"), list) else []
        if typ == "assistant":
            u = msg.get("usage") or {}
            n = (u.get("cache_read_input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0) + (u.get("input_tokens") or 0)
            if n:  # an all-zero usage block is not a context size, flagged as an API error or not
                context = n
            for b in content:
                if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("id"):
                    open_calls.add(b["id"])
        else:
            for b in content:
                if isinstance(b, dict) and b.get("type") == "tool_result":
                    open_calls.discard(b.get("tool_use_id"))
        last_ts = t
    if last_ts is None:
        return None
    running = bool(open_calls)
    return {"last_ts": last_ts, "running": running, "context": context, "dead": dead}


def parse_ts(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def log(root, row):
    try:
        d = os.path.join(root, ".claude", "logs")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "subagent-resume-guard-fires.jsonl"), "a", encoding="utf-8") as fh:
            fh.write(json.dumps(row) + "\n")
    except Exception:
        pass


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # fail open: a guard that cannot price a send never refuses it
    sys.exit(0)
