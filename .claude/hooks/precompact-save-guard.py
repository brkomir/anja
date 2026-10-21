#!/usr/bin/env python3
"""PreCompact hook — refuse ONE owner-typed /compact while the /pre-compact save the owner asked for has not landed yet.

Prevents: NEW class — the /pre-compact -> /compact race. An owner `/compact` typed seconds after `/pre-compact`
interrupts the save before the model has made a single call, so the compaction lands with no bank and the recovery
rebuilds from the transcript alone. Founding instance: 2026-10-14T18:48:07Z, `/pre-compact
--disarm` then `/compact` 6 s later, no assistant record between them.

An early `/compact` is refused while a save the owner asked for is still running.

What it reads (stdin is the PreCompact payload: session_id, trigger):
  * trigger — only `manual` is ever refused; an automatic compaction always proceeds.
  * the request — the newest `pre-compact` record of this session in .claude/logs/skill-invocations.jsonl, if it
    is at most WINDOW_S old: one the owner typed (logged at UserPromptSubmit, before the model acts), or a save the
    model ran for the owner (a FLEET directive, the AUTO hook). Any source counts: a seat running /pre-compact on
    the owner's `--fleet` is as if the owner had typed it there, and the one-refusal-per-WINDOW_S cap below
    is what stops a stray record from holding compactions, so a source filter bought nothing and broke the
    `/pre-compact --fleet` -> `/compact` in each seat workflow.
  * the save — the newest `## PRE-COMPACT — <ISO>Z` heading in this session's working plans
    (plans/session-<sid8>-*.md). A heading at or after the request means the save landed.

What it does: request pending and no save after it -> exit 75 (compact-save.sh maps it to the exit 2 that blocks the
compaction; a bare 2 is also python3's own can't-open-file code) with a plain message, and records WHEN it refused
in <state>/precompact-guard-<sid8>. Any manual /compact within WINDOW_S of that refusal goes through, whatever
request came since, so a save that died can never wedge the session: at most one refusal per WINDOW_S. It writes
only that marker and one fires-log line; never a checkpoint or a post-compact-pending marker (compact-save.sh calls
it before writing either). compact-save.sh runs it on MANUAL compactions only.
Fires: .claude/logs/precompact-save-guard-fires.jsonl (.smoke.jsonl under CLAUDE_HOOK_SMOKE). Off:
PRECOMPACT_SAVE_GUARD_OFF=1 in settings.json env.
Every error path allows the compaction (fail-open: this guard protects a convenience, never data).
"""
import glob
import json
import os
import re
import sys
from datetime import datetime, timezone

WINDOW_S = 600
BANK_RE = re.compile(r"^## PRE-COMPACT — (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)", re.M)


# parse_ts and the log loop are duplicated in fleet_verb.py on purpose: the two readers
# differ (whole log here, a 1 MB tail there). Revisit trigger: a THIRD Python reader of skill-invocations.jsonl.
def parse_ts(s):
    # Same four lines as fleet_verb.py's parse_ts (the writer's ts format); a third Python reader of the log moves
    # both to .claude/hooks/lib/skill_log.py. newest_request's filter is NOT shared:
    # fleet_verb.py also refuses scheduled prompts, which this guard deliberately lets arm it.
    try:
        return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
    except (TypeError, ValueError):
        return None


def newest_request(log_text, session_id):
    newest = None
    for line in log_text.splitlines():
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if not isinstance(r, dict) or r.get("session") != session_id or r.get("skill") != "pre-compact":
            continue
        t = parse_ts(r.get("ts"))
        if t is not None and (newest is None or t > newest):
            newest = t
    return newest


def newest_bank(plan_texts):
    ts = [t for text in plan_texts for t in (parse_ts(m) for m in BANK_RE.findall(text)) if t is not None]
    return max(ts) if ts else None


def decide(now, trigger, request, bank, refused_at):
    """-> (verdict, reason). verdict is 'allow' or 'block'."""
    if trigger != "manual":
        return "allow", "automatic compaction"
    if request is None or now - request > WINDOW_S:
        return "allow", "no /pre-compact in the last %d s" % WINDOW_S
    if bank is not None and bank >= request:
        return "allow", "the save landed"
    if refused_at is not None and -1 <= now - refused_at <= WINDOW_S:
        return "allow", "second /compact after a refusal"
    return "block", "save pending"


def self_test():
    ok = True

    def t(name, cond):
        nonlocal ok
        ok &= bool(cond)
        print(("PASS  " if cond else "FAIL  ") + name)

    req = 1000.0
    t("an automatic compaction is never refused", decide(req + 5, "auto", req, None, None)[0] == "allow")
    t("a manual /compact 6 s after /pre-compact with no save is refused", decide(req + 6, "manual", req, None, None)[0] == "block")
    t("a save written at or after the request lets it through", decide(req + 40, "manual", req, req + 30, None)[0] == "allow"
      and decide(req + 40, "manual", req, req, None)[0] == "allow")
    t("an older save (before this request) does not", decide(req + 40, "manual", req, req - 1, None)[0] == "block")
    t("a /compact within the window after a refusal goes through, even after a newer request; a later one can be refused",
      decide(req + 20, "manual", req, None, req + 6)[0] == "allow"
      and decide(req + 40, "manual", req + 30, None, req + 6)[0] == "allow"
      and decide(req + 900, "manual", req + 890, None, req + 6)[0] == "block")
    t("a request older than the window is ignored", decide(req + WINDOW_S + 1, "manual", req, None, None)[0] == "allow")
    sid = "s-a"
    log = "\n".join([
        json.dumps({"ts": "2026-10-16T20:00:00Z", "skill": "pre-compact", "session": sid, "source": "user-prompt"}),
        json.dumps({"ts": "2026-10-16T20:04:00Z", "skill": "pre-compact", "session": sid, "source": "skill-tool"}),
        json.dumps({"ts": "2026-10-16T20:05:00Z", "skill": "pre-compact", "session": "s-b", "source": "user-prompt"}),
        json.dumps({"ts": "2026-10-16T20:03:00Z", "skill": "summary", "session": sid}),
        "not json",
    ])
    t("the request is this session's newest pre-compact record of any source (typed, fleet, AUTO), never a peer's or another skill's",
      newest_request(log, sid) == parse_ts("2026-10-16T20:04:00Z"))
    plan = "## PRE-COMPACT — 2026-10-16T19:00:00Z (AUTO)\ntext\n## PRE-COMPACT — 2026-10-16T20:01:00Z\n  ## PRE-COMPACT — 2026-10-16T23:00:00Z\n"
    t("the save is the newest bank heading at line start; an indented mention does not count",
      newest_bank([plan]) == parse_ts("2026-10-16T20:01:00Z"))
    print("\nself-test: ALL PASS" if ok else "\nself-test: FAILURES")
    return 0 if ok else 1


def main():
    if os.environ.get("PRECOMPACT_SAVE_GUARD_OFF") == "1":
        return 0
    # Runs only when compact-save.sh calls it, first and in series: a refused /compact must leave no checkpoint
    # and no post-compact-pending marker, and hooks on one event may run in parallel. Any other caller (a direct
    # PreCompact registration in settings.json) is a no-op, so a second registration can never race the first.
    if os.environ.get("PRECOMPACT_GUARD_CALLER") != "compact-save.sh":
        return 0
    try:
        payload = json.load(sys.stdin)
        sid = payload.get("session_id") or ""
        trigger = payload.get("trigger") or ""
        if not sid:
            return 0
        root = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
        sid8 = sid[:8]
        try:
            with open(os.path.join(root, ".claude/logs/skill-invocations.jsonl"), encoding="utf-8", errors="replace") as f:
                request = newest_request(f.read(), sid)
        except OSError:
            request = None
        plans = []
        for p in glob.glob(os.path.join(root, "plans", "session-%s-*.md" % sid8)):
            try:
                with open(p, encoding="utf-8", errors="replace") as f:
                    plans.append(f.read())
            except OSError:
                pass
        bank = newest_bank(plans)
        state_dir = os.environ.get("COMPACT_STATE_DIR") or os.path.join(root, ".claude/state")
        marker = os.path.join(state_dir, "precompact-guard-%s" % sid8)
        try:
            with open(marker) as f:
                refused_at = float(f.read().strip())
        except (OSError, ValueError):
            refused_at = None
        now = datetime.now(timezone.utc).timestamp()
        verdict, reason = decide(now, trigger, request, bank, refused_at)
        if trigger == "manual" and request is not None:
            logname = "precompact-save-guard-fires.smoke.jsonl" if os.environ.get("CLAUDE_HOOK_SMOKE") else \
                "precompact-save-guard-fires.jsonl"
            try:
                with open(os.path.join(root, ".claude/logs", logname), "a") as f:
                    f.write(json.dumps({"ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "session": sid8,
                                        "verdict": verdict, "reason": reason, "request_age_s": round(now - request)}) + "\n")
            except OSError:
                pass
        if verdict != "block":
            return 0
        os.makedirs(state_dir, exist_ok=True)
        with open(marker, "w") as f:
            f.write("%.3f" % now)   # never rounded: a rounded-up stamp would read as a refusal in the future
        asked = datetime.fromtimestamp(request, timezone.utc).strftime("%H:%M:%SZ")
        sys.stderr.write(
            "Compaction held: the save you asked for with /pre-compact at %s hasn't been written yet. "
            "When the session says it's ready, type /compact again. If no reply comes, type /pre-compact again "
            "to restart the save, or /compact again to compact without it: any /compact in the next 10 minutes goes through.\n" % asked)
        return 75   # BLOCK_RC: compact-save.sh maps it to 2; python's own loader exits 2 on an unreadable or vanished file
    except Exception:  # fail open
        return 0


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        sys.exit(self_test())
    sys.exit(main())
