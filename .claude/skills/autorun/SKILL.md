---
name: autorun
description: Schedule a scoped work-order (or a /wrap --checkpoint + work-order) to run AUTONOMOUSLY at a future time via an in-session local cron. Use when the owner asks for work to run after N hours or at a set time, for /wrap plus a work-order at a set time, or for a later retry of something that may not get done manually first. The CronCreate-LOCAL counterpart to /schedule (cloud routines) — for work that needs local state (unpushed commits, local environment secrets, integration verify, commit-local-for-review).
---

# Autorun — scheduled autonomous LOCAL work-order run

Codifies the recurring "run this work-order autonomously at a future time" procedure (it recurred twice in one session — a run and its later retry — before codification). Fires an **in-session `CronCreate` one-shot** that executes a self-contained work-order under HARD guardrails (never push, commit-local, verify-local, stop-if-unsafe). The **LOCAL-state counterpart to `/schedule`** (cloud routines).

## When to use
- The owner asks for a `<work-order>` to run in N hours, for `/wrap` + a `<work-order>` at a set `<time>`, or for a later retry of a `<work-order>` in case it is not done manually first.
- The work needs LOCAL state: unpushed commits, secrets from the local environment file, integration verification, or commit-local-for-review.
- **Use `/schedule` INSTEAD when** the work is GitHub-state and should open a PR — a cloud routine gets a fresh sandbox (clones GitHub, no local commits/secrets, output strands in an ephemeral sandbox only a PR surfaces). `/autorun` is the local-state answer; `/schedule` is the cloud-state answer.

## Usage
- `/autorun <work-order> in <N hours> | at <HH:MM>` — persist the work-order + arm the one-shot cron.
- `/autorun status` — show what's scheduled: each pending one-shot's fire time + time-until-fire + the work-order it runs + the session-alive reminder. (`list` is an alias.)
- `/autorun cancel [<id>]` — `CronDelete` the pending autorun.

## Process — arm (`/autorun <work-order> in <when>`)

1. **Persist a self-contained work-order to `plans/<wo>.md` FIRST + commit it (explicit pathspec).** ⛔ **When the WO is derived from a panel synthesis, tick every `[CONVERGED …]` row against a WO item one-to-one** — a converged panel item (the dead score-delta badge: DELETE, do not implement) once fell out of a WO because a WO item named the same FILE, and it was re-found hours later as a fresh defect. The fired prompt may run in a fresh/compacted context — it needs the brief ON DISK: what · why · caller-audit/reconnaissance · approach · verification · the HARD guardrails. Bank any reconnaissance already done so the fired run goes straight to implementation. ⛔ **When the ask carries a fire time, run step 2 and step 4 BEFORE this step** — arm the one-shot against the `plans/<wo>.md` path first, then reconnoitre and write it (two slots were lost to work that ran before the arm). (If a work-order file already exists, reuse it.)

2. **Re-compute the fire time against a FRESH `date`.** Run `date` NOW — a long conversation drifts the anchor, so an "in 3 hours" said an hour ago is a PAST time. Add the offset; if the resolved time is already past, CONFIRM with the owner, never silently roll forward. Use an OFF-minute (avoid `:00`/`:30` — the fleet lands there; one-shots on those fire up to 90s early) for an approximate "in N hours."

3. **Confirm the session-alive tradeoff before arming.** `CronCreate` is session-scoped — it fires ONLY while THIS terminal is open + idle. Resuming the session restores its scheduled tasks (the vendor page "Run prompts on a schedule", read 2026-10-21), except a one-shot whose time has already passed and a recurring task past its seven-day expiry — so a one-shot that comes due while the session is closed never fires. Tell the owner: keep this session open until it fires; a one-shot due while it is closed never fires (and the cloud path has the blockers).

4. **`CronCreate` one-shot (`recurring: false`)** with the cron from step 2 + the guarded prompt below. **Fire the `CronCreate` FIRST, ceremony after — and VERIFY it exists** (read the tool ack or `CronList`) before reporting "armed": a classifier outage at arming time once refused BOTH the CronCreate and the work-order commit, the session limit landed before any retry, and the tombstone read "supersedes the 05:21 cron, WHICH WAS NEVER CREATED". An "armed" claim off a refused call is a decorated never.

5. **Completion markers must be ANCHORED, never prose-matchable.** The precondition gate greps the work-order file for its completion marker — so a marker string that also appears in the file's own INSTRUCTIONS self-trips the gate at fire time (`grep -c "CHECKPOINT DONE"` returned 2 from the instruction lines; the armed checkpoint would have silently self-skipped — a recurrence of the self-match class after a site-local fix). Rules: the gate greps **line-anchored** (`grep -c '^CHECKPOINT DONE '`), the WO text names the marker in backticks/prose that can never match the anchor, and ALWAYS read the matched lines (`grep -n`) before acting on a count.

## The guarded cron-prompt template (fill the `<slots>`)

```
[Owner-authorized autonomous run — one-shot cron fired ~<TIME> <DATE>, <purpose / "a FALLBACK if the owner didn't do it manually earlier">. Runs in THIS local session with full local state.]

PRECONDITION CHECKS FIRST (do NOT skip):
0. WORK-ORDER PRESENT? plans/<wo>.md missing or empty → STOP + report "armed before the work-order was written; nothing to run."
1. ALREADY DONE? <grep the deliverable already landed / an "IMPLEMENTED" note in plans/<wo>.md> → SKIP + report "already done."
2. SAFE TO PROCEED? <re-check the blocker that would make it unsafe THIS run — peer-dirty files in the target territory, uncommitted migrations, a contended shared tree>. Still unsafe → STOP AGAIN, append a one-line "still-blocked <date>" note to plans/<wo>.md, report, do NOT force it.
3. Clear + not done → PROCEED per plans/<wo>.md (reconnaissance is banked there → go straight to its Approach + Verification).

<STEP 1 (optional): Run /wrap --checkpoint — reconcile trackers, persist decisions, catch hanging work.>
STEP <N>: Implement the work-order per plans/<wo>.md EXACTLY.

GUARDRAILS (non-negotiable):
- NEVER git push / trigger CI / deploy — OWNER-GATED. Build + verify LOCALLY only.
- Commit locally (`git commit -o <paths>`, never `git add -A`; coordinate on shared files first). Leave committed-but-UNPUSHED for owner review.
- Verify locally as the work-order mandates (tsc + unit + integration on touched surfaces; read pass/fail COUNTS, not exit codes).
- Finish with a concise review summary (what changed, test-result counts, residual risk), flagged UNPUSHED awaiting owner review + owner-gated push.
- If ANYTHING makes the change unsafe (tree contested mid-run, a contract you can't preserve), STOP + write up the blocker instead of shipping.
```

## Process — `status` / `cancel`
- `status` (alias `list`) → run `CronList`. For each pending one-shot render: **fire time** · **time-until-fire** (compute vs a FRESH `date` — the anchor drifts) · the **work-order** it runs (`plans/<wo>.md`, from the prompt) · a one-line reminder that it fires **only while this session stays open + idle** (session-only; a one-shot due while the session is closed never fires). If none pending → "no autoruns scheduled." Cheap, read-only.
- `cancel` → `CronDelete <id>` (id from `status`); confirm removed. `/autorun cancel` with no id + exactly one pending → cancel that one; with ≥2 pending → list + ask which.

## Anti-scope
- **NOT `/schedule`.** That's cloud routines (GitHub-state, PR output). `/autorun` is in-session/local-state. Picking the wrong one is the failure — a cloud routine can't see local unpushed commits or the local environment file.
- **Never auto-push.** The fired run commits locally + leaves for owner review; push stays owner-gated.
- **Not durable.** Session-only — if the owner needs it to survive a session close, that's the cloud path's job (with its tradeoffs), not this.
- **Don't skip the precondition gate.** A fallback run must re-check "already done?" + "still safe?" before acting — that is a retry's whole point.

## Why a command (not just the trigger row)
An explicit command is preferred: typing it is no burden, and it is how this procedure is almost always started. The orchestrator band's row (`.claude/orchestrator/active-recall-orchestrator.md`) routes an NL phrasing ("schedule X in an hour") to this command, but that band's per-turn injection is off as shipped (`SKIP_BAND_O_INJECT=1` in the settings), so the command index in `.claude/orchestrator/conventions.md` is the surface that reaches the session; the command is the explicit surface.
