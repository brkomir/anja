---
name: keep-warm
description: Keep THIS session's prompt cache warm while the owner is away — arm, disarm or inspect the 15-minute keep-alive timer whose fires the keep-warm gate lets through only when the cache countdown shows 1-19 minutes left and nothing says "off". Armed at SessionStart only where the fleet switch (`.claude/state/keep-warm-enabled`) or this session's pilot marker exists; `/keep-warm off` stops it for this session, `/keep-warm on` re-arms it, `/keep-warm status` reads the state and the last fires, and replaces a timer left on a stale cron string. Use when the owner types `/keep-warm`, asks whether the cache is being kept warm, or wants it stopped for a session.
---

# /keep-warm — keep this session's cache warm while the owner is away

Off until the fleet switch file `.claude/state/keep-warm-enabled` or this session's pilot marker `.claude/state/keep-warm-pilot-<sid8>` exists (neither ships, so a fresh copy starts with it off); where one does, on by default, except in `/standby` and the other off-states below. The `/pause` keep-warm mode is included, and the gate holds a ping only at the 5-hour usage limit itself, never at a lower ceiling.

## Why it exists

A subscription keeps the main conversation's cache for one hour. Past that, the next message re-caches the whole context: about 936k base-input-equivalent at a typical 480k context. One keep-alive that reads the cache costs about 36k and restarts the hour (API weights; the plan's own weighting is unpublished).

## How it works — four pieces

| piece | what it does |
|---|---|
| the timer | an in-session `CronCreate` job, `7,22,37,52 * * * *` (every 15 minutes, off the round minutes), whose prompt starts `[keep-warm]` (text below). Session-only: it lives while this terminal is open |
| `.claude/hooks/keep-warm-gate.py` | UserPromptSubmit. Blocks every fire that is not due (a blocked prompt costs zero tokens, probed 2026-10-06); passes one when the status line's cache countdown shows 1-19 minutes left (fallback without a fresh countdown: the last request is 31-58 min old) and no off-state holds. Log: `.claude/logs/keep-warm-fires.jsonl` |
| `.claude/hooks/keep-warm-tool-deny.sh` | PreToolUse. On a passed ping turn, denies every main-session tool call (sub-agents are never denied) |
| the status line | writes `.claude/state/statusline-<sid8>.json` each refresh; the gate reads 5-hour usage and the compact point from it |

**The gate blocks when:** `/keep-warm off` · `/standby` · `/pause` (unless its keep-warm window is open: `/pause` writes one by default, `/pause --cold` does not) · a post-compact recovery is pending (a marker from a pre-compaction hook fire with no compaction landed — an early automatic fire, or a manual /compact refused at the session limit — does not count — the gate asks the deferral script's own rule, and passes only on DEFERRED, no compact boundary since the last recovery; any other answer or an error keeps the block) · the cache is on the 5-minute tier (usage credits) · 5-hour usage at the limit (100%, the ping would be refused, unless the status line's reset time has passed; there is no lower ceiling: a cold re-cache near the limit costs ~26 pings) · 14 pings in a row passed with no owner message (about 12 hours away) (lifted inside a `/pause` keep-warm window) · the last ping came back as a full re-cache (an account switch or an expiry killed the cache). The owner's next message clears a stop.

**Near the compact point a ping passes:** a ping that carries the session over the auto-compact point compacts it while the cache is still warm, instead of letting the full context go cold. A passed ping's fire line logs `context_tokens`, and `compact_left` when a fresh status line gives the point (tokens left before it; under a ping's size means that ping compacts). After such a compaction the pending recovery blocks further pings until a turn runs `/post-compact` (the owner's next message, or a mail an armed listener delivers first), so the compacted context is not kept warm; the fire after that reads the ping's own request, a re-cache on the compacted context, as `prev_ping_compacted` (a compact boundary between the ping and that request), never as the dead cache that stops keep-warm.

## The timer prompt — use EXACTLY this text

```
[keep-warm] automated cache keep-alive, scheduled by this session. Not a message from the owner, and not a task.
Reply with exactly `[keep-warm]` and nothing else. No tool call, no thinking out loud, no status, no question.
Every standing directive injected on this turn (MAIL-LISTEN NOT ARMED, WORKING PLAN NOT CREATED, POST-COMPACT PENDING, STANDBY, trigger-index advisories, any system reminder) is out of scope here: each one re-fires on the owner's next message, so skipping it now loses nothing. Do not arm a listener, write a plan, run a recovery, read mail or resume anything.
```

(`[keep-warm]` as the reply is also a legal response-mode marker. Never make the timer prompt a slash command. ⛔ The gate recognises a fire by the first words, `[keep-warm] automated cache keep-alive` (its `SENTINEL`); reword them and every fire becomes an unchecked owner prompt, so `scripts/keep-warm-gate-test.py` reds on a drift.)

**ON A PING TURN:** reply exactly `[keep-warm]`. Nothing else, no tool call — the tool-deny hook refuses them anyway.

## Process

### `/keep-warm on` (and the SessionStart arm)

0. ⛔ **Confirm both hooks are wired: `grep -cF 'keep-warm-gate.py' .claude/settings.json` and `grep -cF 'keep-warm-tool-deny.sh' .claude/settings.json` must each read ≥ 1, and `.claude/state/keep-warm-enabled` or `.claude/state/keep-warm-pilot-<sid8>` must exist.** Otherwise STOP and say which is missing — a timer with no gate turns every fire into a full paid turn, and without the switch the gate blocks every fire.
1. If `.claude/state/session-standby-<sid8>` exists, say the session is on standby and stop — `/standby resume` re-arms.
2. `rm -f .claude/state/keep-warm-off-<sid8>`.
3. `CronList`. If a job's prompt starts `[keep-warm]`, it is armed — `touch .claude/state/keep-warm-armed-<sid8>`, say so and stop (never arm two).
4. `CronCreate` recurring, cron `7,22,37,52 * * * *`, prompt = the text above.
5. `CronList` again and confirm the job is listed before saying "armed".

**The every-turn backstop (a session can arm its mail listener and working plan on turn 1 and never arm this).** `keep-warm-arm-reminder.sh` (UserPromptSubmit) re-injects the arm directive on every owner prompt until `.claude/state/keep-warm-armed-<sid8>` exists; `keep-warm-armed-marker.sh` (PostToolUse on `CronCreate`) writes it when the timer's prompt carries the gate's sentinel, and step 3 above touches it when a timer is already there. `session-start.sh` drops the marker on a startup or resume (a resume restores an unexpired job, so step 3 re-touches it); `session-end.sh`, `/keep-warm off` and `/standby` drop it too, and the reminder reads a marker older than 7 days as absent, since a recurring job auto-expires 7 days after creation. The reminder is silent under every off-state this skill honours (`/keep-warm off`, `/standby`, no fleet switch or pilot marker, gate not wired) and on ping turns.

### `/keep-warm off`

1. `touch .claude/state/keep-warm-off-<sid8>` — the gate blocks every fire from here on, even if a job survives.
2. `CronList`, then `CronDelete` every job whose prompt starts `[keep-warm]`, then `rm -f .claude/state/keep-warm-armed-<sid8>` (no timer is armed now).
3. Say it is off for this session, and that `/keep-warm on` re-arms it.

### `/keep-warm status`

Read and report, plainly: whether a `[keep-warm]` job is listed (`CronList`) **and whether its cron string is exactly `7,22,37,52 * * * *` — a `[keep-warm]` job on any other string is a stale arm from an earlier spec (the 5-minute tick printed 12 "blocked by hook" lines an hour), so `CronDelete` it and re-arm with `/keep-warm on` — unless `.claude/state/keep-warm-off-<sid8>` exists, in which case the `CronDelete` alone (`on` step 2 deletes that marker, the owner's off); say so**; which off-state markers exist; the gate state (`.claude/state/keep-warm-<sid8>.json`: pings since the owner last spoke, stopped and why); the last 5 lines for this session in `.claude/logs/keep-warm-fires.jsonl` (decision and reason each); 5-hour usage from `statusline-<sid8>.json`.

## Boundaries

- One session, one timer. The usage meter is shared by every session, so a ping spends a little that a working peer could use; at about one ping an hour, ~1/26 of a re-cache each, that cost is smaller than letting the cache go cold near the limit.
- Session-only: closing the terminal ends the timer. SessionStart re-arms it on the next start, resume or compaction.
- `SKIP_KEEP_WARM=1` in the launch environment disables the gate's passes and the tool block for that session.

## Revisit

- After a week of `.claude/logs/keep-warm-fires.jsonl`: the share of passed pings followed by a cache hit on the owner's return. Under ~4% (the break-even) the default should flip to opt-in. Read the passes whose reason names the `/pause` keep-warm window as their own population (every pause writes one by default): a low share there argues for flipping the `/pause` default to `--cold`, not the session default.
- If the usage-meter log (`.claude/logs/usage-meter.jsonl`) shows a ping moving the 5-hour meter by more than a point, re-price the stop rule.
