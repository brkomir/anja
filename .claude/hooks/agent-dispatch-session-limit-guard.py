#!/usr/bin/env python3
"""PreToolUse hook (Agent|SendMessage matcher) — no new helper agents, and no batch of cold resumes, once the
session limit is above 90%.

Prevents: NEW class — helper launches past the owner's session-limit line, made silently.

The rule: above 90% of the session limit, launch no helper agents unless the owner explicitly ordered it,
and tell the owner of that decision in one line (e.g. "not launching helpers: the session limit is at N%").

What it reads: `.claude/state/statusline-<sid8>.json`, which scripts/statusline.py rewrites on every
status-line refresh (every 30 s) with the five-hour window's `five_hour_pct` and `five_hour_resets_at`
from Claude Code's own `rate_limits` input. That is the only place the percentage exists on disk.

What it does: when this session's reading is fresh (at most MAX_AGE_S old), its window has not reset,
and the share is above THRESHOLD_PCT, it DENIES the Agent call. The deny reason tells the seat to tell
the owner, in one line, that it is holding helpers back and why. The per-call escape is the owner's
explicit order: a line in the dispatch prompt starting `OWNER-ORDERED:` followed by the owner's words — the
quote is what makes the escape checkable, and a hook cannot see an order any other way.

Fails OPEN on everything it cannot read (no state file, a stale or unparseable one, a window already
reset, a malformed hook input): silence, exit 0. Every error path exits 0, never 2, so a bug here can
never refuse the fleet's dispatches. One JSON document on stdout when it denies, nothing otherwise.
Fires (deny and escape) are appended to .claude/logs/session-limit-dispatch-fires.jsonl
(…fires.smoke.jsonl under CLAUDE_HOOK_SMOKE).

Resumes: above 90% a resume of a dead helper goes ahead when its cache is still warm, or when it is not one of
a batch of helpers resumed at the same time. A `SendMessage` whose `to` is the id of one of
this session's dead helpers (the ones `/limit-recovery` would resume: its own scan, read through
scripts/limit-recovery.py in this repo, banked ones and ones marked fresh or dropped left out) is a resume.
Above 90% it goes ahead when the helper's cache is still warm (that tool's CACHE_WARM_MINUTES) OR when fewer
than BATCH_OTHERS other dead helpers of this session are waiting on a resume — the other rows the scan reads
RESUME, since a WAIT or FRESH row is not resumed now and so is not one of the batch; a cold resume that is one of a
batch is denied like a launch, with the same `OWNER-ORDERED:` escape in the message. A `SendMessage` to anything
else (a live agent, a peer session, "main") is not a resume and passes. Every allowed resume above 90% is logged.

Escape for the whole session (owner-authorized only): SKIP_AGENT_SESSION_LIMIT_GUARD=1 in the
settings env block. Tests point FF_STATE_DIR at a throwaway state directory.
"""
import contextlib
import json
import math
import os
import sys
import time

THRESHOLD_PCT = 90  # the guard's setting: deny ABOVE it, never at it
MAX_AGE_S = 600     # a reading older than this says nothing about now
ESCAPE = "OWNER-ORDERED:"
# The guard's setting, read literally: a cold resume waits when 10 or more OTHER dead helpers of this session are
# waiting on a resume at the same time. Change it here, nowhere else.
BATCH_OTHERS = 10
# scripts/limit-recovery.py is found beside this file's repo, never under CLAUDE_PROJECT_DIR, so a test that points
# the project directory at a scratch folder still reads the real scan (and a missing file fails open).
LIMIT_RECOVERY = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir, "scripts", "limit-recovery.py")


def main():
    if os.environ.get("SKIP_AGENT_SESSION_LIMIT_GUARD") == "1":
        return
    try:
        data = json.loads(sys.stdin.read() or "{}")
    except ValueError:
        return
    if not isinstance(data, dict) or data.get("tool_name") not in (None, "Agent", "SendMessage"):
        return
    tool = data.get("tool_name") or "Agent"
    sid8 = str(data.get("session_id") or os.environ.get("CLAUDE_CODE_SESSION_ID") or "").lower()[:8]
    if not (len(sid8) == 8 and sid8.isalnum()):
        return
    root = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    state_dir = os.environ.get("FF_STATE_DIR") or os.path.join(root, ".claude", "state")
    try:
        with open(os.path.join(state_dir, f"statusline-{sid8}.json")) as fh:
            rec = json.load(fh)
    except (OSError, ValueError):
        return
    if not isinstance(rec, dict):
        return
    now = time.time()
    ts, pct, reset = rec.get("ts"), rec.get("five_hour_pct"), rec.get("five_hour_resets_at")
    if not isinstance(ts, (int, float)) or not 0 <= now - ts <= MAX_AGE_S:
        return
    if not isinstance(pct, (int, float)) or isinstance(pct, bool) or not math.isfinite(pct) or pct <= THRESHOLD_PCT:
        return
    if isinstance(reset, (int, float)) and reset <= now:
        return
    ti = data.get("tool_input") if isinstance(data.get("tool_input"), dict) else {}
    prompt = str(ti.get("message" if tool == "SendMessage" else "prompt") or "")
    # An order is the escape token FOLLOWED BY the owner's words; a bare token quotes nothing and is not one. The
    # words (not the token) are logged, so a fire can be checked against what the owner actually said.
    order = next((ln.strip()[len(ESCAPE):].strip() for ln in prompt.splitlines()
                  if ln.lstrip().startswith(ESCAPE) and ln.strip()[len(ESCAPE):].strip()), "")
    ordered = bool(order)
    reset_txt = time.strftime("%H:%MZ", time.gmtime(reset)) if isinstance(reset, (int, float)) else "unknown"
    if tool == "SendMessage":
        return resume_gate(data, ti, root, sid8, now, pct, reset, reset_txt, order)
    log(root, {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)), "sid8": sid8, "pct": pct,
               "resets_at": reset, "decision": "allow-owner-ordered" if ordered else "deny",
               "agent": str(ti.get("description") or "")[:80], "order": order[:300]})
    if ordered:
        return
    reason = (
        f"Session limit at {pct:g}% (above {THRESHOLD_PCT}%, resets {reset_txt}): do not launch helper agents now "
        "unless the owner explicitly ordered this launch. Tell the owner in one line that "
        f"you are holding helpers back and why — e.g. \"not launching helpers: the session limit is at {pct:g}%\" — "
        "and do the work inline, defer it, or wait for the reset. If you are a helper yourself, say so in your hand-back. "
        f"If the owner did order this launch, re-issue it with a line in the prompt starting `{ESCAPE}` followed by the "
        "owner's words, verbatim."
    )
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                             "permissionDecisionReason": reason}}))


def pending_resumes(sid):
    """This session's dead helpers waiting on a resume, from /limit-recovery's own scan, and the module (for its
    warm-cache test). Banked rows, and rows marked fresh or dropped, are not waiting on a resume."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("limit_recovery_for_guard", LIMIT_RECOVERY)
    lr = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(lr)
    rows = lr.scan(sid, include_handled=True, skip_banked=True)
    return [r for r in rows if r.get("action") != "BANKED"
            and ((r.get("handled") or {}).get("as") not in ("fresh", "dropped"))], lr


def resume_gate(data, ti, root, sid8, now, pct, reset, reset_txt, order):
    sid = str(data.get("session_id") or os.environ.get("CLAUDE_CODE_SESSION_ID") or "")
    target = str(ti.get("to") or "").split(" [")[0].strip()
    if not sid or not target:
        return
    try:
        # imported code runs here: nothing it prints may reach the hook's one JSON document, and nothing it raises
        # (a SystemExit included, which `except Exception` lets through as exit 2, a block) may refuse the call
        with contextlib.redirect_stdout(sys.stderr):
            pending, lr = pending_resumes(sid)
    except BaseException:
        return  # the scan could not run: fail open, as everywhere else
    row = next((r for r in pending if r.get("agent_id") == target), None)
    if row is None:
        return  # not one of this session's dead helpers: a live agent, a peer, "main"
    # the batch is the OTHER rows that will be resumed now (helpers resumed at the same time);
    # a WAIT row (its own model at its limit) or a FRESH row (re-seated by a launch, gated above) is not one of them
    others = sum(1 for r in pending if r is not row and r.get("action") == "RESUME")
    warm = bool(lr.is_warm(row.get("cache_age_min")))
    decision = ("allow-resume-warm" if warm else "allow-resume-not-a-batch" if others < BATCH_OTHERS
                else "allow-owner-ordered" if order else "deny-resume-batch")
    log(root, {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)), "sid8": sid8, "pct": pct,
               "resets_at": reset, "decision": decision, "tool": "SendMessage",
               "agent": str(row.get("description") or "")[:80], "others": others, "order": order[:300]})
    if decision != "deny-resume-batch":
        return
    reason = (
        f"Session limit at {pct:g}% (above {THRESHOLD_PCT}%, resets {reset_txt}), and this is a cold resume in a batch: "
        f"{others} other dead helpers of this session are waiting on a resume ({BATCH_OTHERS} or more is a batch), so it "
        "waits for the reset unless the owner orders it (above 90% a resume goes ahead only when "
        "the helper's cache is warm or it is not one of a batch). Tell the owner in one line that you are holding these "
        f"resumes back and why — e.g. \"holding {others + 1} helper resumes: the session limit is at {pct:g}%\". "
        f"If the owner did order it, re-send with a line in the message starting `{ESCAPE}` followed by the owner's words, verbatim. "
        "This is a hold, not a failed resume: do not seat it fresh. If a /limit-recovery mark is already written for "
        "this helper, the mark hides it from the hook and from `scan`: note it in the working plan and resume it after "
        "the reset (`scan --all` lists it)."
    )
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                             "permissionDecisionReason": reason}}))


def log(root, row):
    name = "session-limit-dispatch-fires.smoke.jsonl" if os.environ.get("CLAUDE_HOOK_SMOKE") else "session-limit-dispatch-fires.jsonl"
    try:
        d = os.path.join(root, ".claude", "logs")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, name), "a") as fh:
            fh.write(json.dumps(row) + "\n")
    except OSError:
        pass


if __name__ == "__main__":
    try:
        main()
    except BaseException:  # fail open: a bug here must never refuse a dispatch (exit 2 is a block)
        pass
    sys.exit(0)
