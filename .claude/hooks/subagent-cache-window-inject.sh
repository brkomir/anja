#!/usr/bin/env bash
# subagent-cache-window-inject.sh — SubagentStart: one paragraph into every sub-agent's context, before its
# first tool call, about the 5-minute prompt cache it runs on. Advisory text only; it decides nothing.
#
# NEW class: sub-agent cache rewrite after a long foreground tool call or wait. A sub-agent's prompt cache
# lives 5 minutes (the main conversation's lives 1 hour on a subscription within plan usage, but sub-agents
# are not covered by that lifetime: they keep the 5-minute one on a subscription too unless a longer one is
# configured; docs: code.claude.com/docs/en/prompt-caching.md), and the timer resets only
# on a model call, so a tool call that outlasts it makes the agent's next call rewrite its whole context.
# Measured 2026-10-19 over 7 days of this repo's sub-agent transcripts (1,491 agents, 78,686 turns, 52,068
# Bash calls):
# 42 real mid-run rewrites, ~10.4M tokens (after dropping the 54,033 assistant records that are per-content-block
# copies of one response — a first pass counted them and read 27 long-call rewrites / 7.1M, the figure the
# first commit of this file quoted): 20 wakes by a MESSAGE after 5+ min idle (5.27M; 14 on the 2026-10-12
# limit-recovery day), 8 after a foreground tool call that outlasted the window (2.21M), 5 after waiting on a
# background task (0.93M), 5 short-gap misses with no visible trigger (1.23M), 3 in-agent compactions (0.68M).
# This text reaches the long-call and background-wait classes (13 events, 3.1M); the message-after-idle class
# is the DISPATCHER's act and is addressed on the orchestrator plane, not here. The founding pair, on 2026-10-18: a
# 6 m 10 s scan of 220 local eval frames (344,716 tokens rewritten) and a 5.5 m matrix wait (475,399).
#
# Why this channel: SubagentStart's hookSpecificOutput.additionalContext "injects context into the
# subagent" once (docs: hooks.md), i.e. BEFORE the first tool call, which is the only moment the advice
# can still change the long call; a PreToolUse note reaches the model with the tool result, after the
# wait already happened. The brief is not the channel: a dispatcher forgets a line, this hook cannot.
# Why not a longer TTL: the API offers 5m and 1h only (subagentPromptCacheTtl / CLAUDE_CODE_SUBAGENT_
# PROMPT_CACHE_TTL / frontmatter experimental.cacheTtl), and a 1h cache write costs 2x base against 1.25x
# for 5m, so 1h on every sub-agent would add ~282M input-equivalent units a week (376M creation tokens
# x 0.75) against ~13M lost to misses (10.4M x 1.25) — about 22x the problem. A per-TYPE 1h via frontmatter stays the
# lever for an agent type that exists to wait on long jobs; none does today.
# Why not a deny on the declared timeout: 512 foreground sub-agent calls declared a timeout of 5 min or
# more in those 7 days and 8 of them ran that long, so a guard on the declared shape would cost ~500
# rewrites a week to stop 8 misses. Re-measure after a week of this text: rerun the scan; if the
# long-call class persists at its rate, a deny keyed on the wait-loop shape (34 of the 512) is next.
#
# Contract: exactly ONE JSON document on stdout (the harness discards a hook's stdout wholesale unless it
# is one document — bash-environment.md); exit 0 always (a SubagentStart hook cannot and must not stop
# a dispatch). Escape: SKIP_SUBAGENT_CACHE_WINDOW_INJECT=1. Fires: .claude/logs/subagent-cache-window-inject.jsonl
# (ts, session, agent_type) — one line per injection, so next week's scan can relate misses to deliveries.
set -u
[ "${SKIP_SUBAGENT_CACHE_WINDOW_INJECT:-0}" = "1" ] && exit 0
INPUT="$(cat 2>/dev/null || true)"
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
LOG="$ROOT/.claude/logs/subagent-cache-window-inject.jsonl"

read -r -d '' TEXT <<'TXT' || true
CACHE WINDOW — read before your first tool call. Your prompt cache lives 5 minutes and is renewed only by a model call; a longer gap makes your next call rewrite your whole context at about 12 times the price of a read. So never give a foreground Bash call a timeout above 180000 (3 minutes); this overrides bash-environment.md's timeout: 300000 / 600000, which is sized for the main session's 1-hour cache. Start longer work with run_in_background: true and keep working. A call that reaches its timeout moves to the background and keeps running: read its output, never re-run it. To wait on a job that ends within about 30 minutes, check it in calls of timeout 180000 at most (a bounded loop: for i in $(seq 17); do [ -e <file> ] && break; sleep 10; done; a command that starts with a long sleep is refused), although the background notice says not to poll: each check costs a twelfth of a rewrite. For a longer job, stop calling tools and let its completion notice wake you: one rewrite is cheaper than that many checks.
TXT

python3 -I - "$TEXT" "$INPUT" "$LOG" <<'PY'
import sys, json, time, os
text, raw, log = sys.argv[1], sys.argv[2], sys.argv[3]
sid = agent_type = ""
try:
    p = json.loads(raw) if raw.strip() else {}
    sid = str(p.get("session_id", ""))[:8]; agent_type = str(p.get("agent_type", ""))
except Exception:
    pass
try:
    os.makedirs(os.path.dirname(log), exist_ok=True)
    with open(log, "a", encoding="utf-8") as fh:
        fh.write(json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "session": sid, "agent_type": agent_type}) + "\n")
except Exception:
    pass
sys.stdout.write(json.dumps({"hookSpecificOutput": {"hookEventName": "SubagentStart", "additionalContext": text}}))
PY
exit 0
