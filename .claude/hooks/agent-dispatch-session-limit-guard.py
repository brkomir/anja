#!/usr/bin/env python3
"""PreToolUse hook (Agent|SendMessage matcher) — no new helper agents, and no batch of cold resumes, once the
session limit is above 90%; at or above 97% of the weekly limit the same calls wait for the owner's yes, asked
without blocking.

Prevents: NEW class — helper launches past the session-limit line, made silently.

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

The weekly line: at 97% of the weekly limit a new helper asks the owner instead of refusing, without
blocking, since a question nobody is looking at would hold the session and let the cache go cold. 97 is the
same number the review hub's weekly pause line uses (scripts/hub-usage-watch.py WEEKLY_PAUSE_AT). When the
reading's `seven_day_pct` is at or above WEEKLY_THRESHOLD_PCT, a launch, or a cold resume that is one of a batch
(the session line's resume rule), still does not run. A cold resume in a batch asks too. Its reason is a confirmation request, not a refusal. The seat asks the owner once, in
its reply text (never AskUserQuestion, never a prompt that waits), and says what it wanted and why, what it
recommends, and what it does if he says nothing. It keeps working, and launches only on his yes, carrying the same
`OWNER-ORDERED:` escape. It stays a deny rather than `permissionDecision: "ask"`, because "ask" opens a permission
prompt that holds the session until someone answers, and a question that blocks the session is what this guard exists to avoid.
One account at a time: every working
session on this machine follows the one logged-in account, and a switch moves all of them, so the reason says
"switch accounts", never "switch this session". Each account has its own weekly reset time, so a fire after a
switch that still shows the same reset time is the old account's reading, not yet re-rendered. The figure is the
all-models weekly row; the status line's separate Fable-only weekly row is NOT watched.
These fires log `ask-weekly` and `ask-weekly-resume-batch`, and every weekly row carries `"limit": "weekly"`.
Trust works as on the five-hour line, with the weekly fields: `ts` is fresh, the share is a finite non-boolean
number, and `seven_day_resets_at` (scripts/statusline.py writes it beside the share) is not a number already past.
It needs no five-hour field, so a reading taken right at a five-hour reset (five_hour_pct None, seven_day_pct live)
still decides on the week. A test holds the two scripts' weekly trust to one fixture table.

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
WEEKLY_THRESHOLD_PCT = 97  # ask AT or above it, never refuse: the guard's weekly setting (docstring)
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
    ts = rec.get("ts")
    if not isinstance(ts, (int, float)) or not 0 <= now - ts <= MAX_AGE_S:
        return
    pct, reset = rec.get("five_hour_pct"), rec.get("five_hour_resets_at")
    weekly = not (live(pct, reset, now) and pct > THRESHOLD_PCT)
    if weekly:  # the session line holds; the weekly line decides alone, five-hour fields or not
        pct, reset = rec.get("seven_day_pct"), rec.get("seven_day_resets_at")
        if not (live(pct, reset, now) and pct >= WEEKLY_THRESHOLD_PCT):
            return
    ti = data.get("tool_input") if isinstance(data.get("tool_input"), dict) else {}
    prompt = str(ti.get("message" if tool == "SendMessage" else "prompt") or "")
    # An order is the escape token FOLLOWED BY the owner's words; a bare token quotes nothing and is not one. The
    # words (not the token) are logged, so a fire can be checked against what the owner actually said.
    order = next((ln.strip()[len(ESCAPE):].strip() for ln in prompt.splitlines()
                  if ln.lstrip().startswith(ESCAPE) and ln.strip()[len(ESCAPE):].strip()), "")
    ordered = bool(order)
    if weekly:
        try:
            reset_txt = time.strftime("%a %H:%MZ", time.gmtime(reset)) if isinstance(reset, (int, float)) else "unknown"
        except (OverflowError, OSError, ValueError):  # a reset no writer produces must not cost the question
            reset_txt = "unknown"
    else:
        reset_txt = time.strftime("%H:%MZ", time.gmtime(reset)) if isinstance(reset, (int, float)) else "unknown"
    if tool == "SendMessage":
        return resume_gate(data, ti, root, sid8, now, pct, reset, reset_txt, order, weekly)
    log(root, {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)), "sid8": sid8, "pct": pct,
               "resets_at": reset,
               "decision": "allow-owner-ordered" if ordered else "ask-weekly" if weekly else "deny",
               "agent": str(ti.get("description") or "")[:80], "order": order[:300],
               **({"limit": "weekly"} if weekly else {})})
    if ordered:
        return
    if weekly:
        reason = (
            f"{weekly_head(pct, reset_txt)}. {ONE_ACCOUNT} This is a confirmation request, not a refusal (at the "
            "weekly line a new helper waits for the owner's yes, asked without blocking). This launch did "
            f"not run. {ASK_ONCE}: name the helper you wanted to launch and why, what you recommend, and what you will "
            "do if the owner says nothing (defer it, or do it inline if it is small; inline work spends the same weekly "
            "budget). The owner's answers: yes (launch on this account), switch accounts (one switch moves every session on "
            "this machine, so it answers this in all of them: re-issue the call as it was after your next reply; if "
            "this fires again with the same reset time, the reading is still the old account's, so re-issue it once "
            "more after the reply after that), or no (carry out your default). If you already asked the owner about a launch "
            "at this reset time and no answer came, do not ask again: carry out your default. Keep working on anything "
            f"else meanwhile, and carry out your default if no yes comes. Launch on the owner's yes by re-issuing it with a line in the prompt starting `{ESCAPE}` followed "
            "by the owner's words, verbatim. If you are a helper yourself, put the question in your hand-back for the seat "
            "that launched you."
        )
    else:
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


# The weekly reasons' shared sentences (docstring). The head names the all-models row, since
# the status line also shows a Fable-only weekly row this guard does not watch.
ONE_ACCOUNT = "Every working session on this machine shares this account."
ASK_ONCE = ("Ask the owner once, in your reply text, never with AskUserQuestion or any prompt that waits for an "
            "answer")


def weekly_head(pct, reset_txt):
    return (f"Weekly limit (all models) at {pct:g}% on the account this session is using now "
            f"({WEEKLY_THRESHOLD_PCT}% or more; that account's week resets {reset_txt})")


def live(pct, reset, now):
    """A finite, non-boolean share whose window has not already reset (a reset that is a number at or before now;
    the five-hour line's rule since 2026-10-12, used for both lines). A share too large for a float is not live."""
    try:
        return (isinstance(pct, (int, float)) and not isinstance(pct, bool) and math.isfinite(pct)
                and not (isinstance(reset, (int, float)) and reset <= now))
    except OverflowError:
        return False


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


def resume_gate(data, ti, root, sid8, now, pct, reset, reset_txt, order, weekly=False):
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
                else "allow-owner-ordered" if order else "ask-weekly-resume-batch" if weekly else "deny-resume-batch")
    log(root, {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)), "sid8": sid8, "pct": pct,
               "resets_at": reset, "decision": decision, "tool": "SendMessage",
               "agent": str(row.get("description") or "")[:80], "others": others, "order": order[:300],
               **({"limit": "weekly"} if weekly else {})})
    if decision not in ("deny-resume-batch", "ask-weekly-resume-batch"):
        return
    if weekly:
        reason = (
            f"{weekly_head(pct, reset_txt)}, and this is a cold resume in a batch: {others} other dead helpers of this "
            f"session are waiting on a resume ({BATCH_OTHERS} or more is a batch). {ONE_ACCOUNT} This is a "
            "confirmation request, not a refusal (at the weekly line helpers wait for the owner's yes, "
            "asked without blocking, and a cold resume in a batch asks too; the batch rule is the session line's: "
            "a resume goes ahead only when the helper's cache is warm or it is not one of a "
            f"batch). This resume did not run. {ASK_ONCE}: say you are holding {others + 1} helper resumes and what "
            "they are for, what you recommend, and what you will do if the owner says nothing (resume them after a switch or "
            "the weekly reset, or do the work inline if it is small; inline work spends the same weekly budget). The owner's "
            "answers: yes (resume on this account), switch accounts (one switch moves every session on this machine, "
            "so it answers this in all of them: re-send the message as it was after your next reply; if this fires "
            "again with the same reset time, the reading is still the old account's, so re-send it once more after the "
            "reply after that), or no (carry out your default). If you already asked the owner about these resumes at this "
            "reset time and no answer came, do not ask again: carry out your default. Keep working on anything else "
            f"meanwhile, and carry out your default if no yes comes. Resume on the owner's yes by re-sending with a line in the message starting `{ESCAPE}` followed by the owner's "
            "words, verbatim. This is a hold, not a failed resume: do not seat it fresh. If a /limit-recovery mark is "
            "already written for this helper, the mark hides it from the hook and from `scan`: note it in the working "
            "plan and resume it after a switch or the weekly reset (`scan --all` lists it)."
        )
    else:
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
