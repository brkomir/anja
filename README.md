<img src="docs/images/anja-logo.svg" alt="Anja" width="112">

# Anja

**One developer. An entire engineering team, on Claude Code.**

Anja is an engineering organization built on Claude Code: a lead session you talk to, 33 specialists it brings in, reviewers who did not write the changes they review, memory that outlives a conversation, and guards that refuse or warn at the moment of a costly action.

I built Anja because one person working with coding agents on the same codebase, month after month, needs more than a good prompt. Work must survive sessions and context compactions. Corrections must become lasting knowledge. Independent review must challenge completed work. And consequential actions must remain under human control.

Anja grew alongside [FinalFrame](https://finalframe.photo), a photography critique application I developed and shipped to production as a solo developer between March and October 2026. Its workflows, agents, review procedures, memory architecture, and safeguards evolved through the demands of building that product. This repository contains the resulting engineering system, extracted from FinalFrame and cleaned of project-specific and private material, for other developers to study, use, and adapt.

Claude Code already provides sub-agents, skills, hooks, and memory. **What Anja adds is the discipline between them:** who delegates to whom, how sessions coordinate on one branch, who reviews what, how a session recovers its state, and how a correction becomes something that lasts.

## Where to start

1. **See how it works:** [A working day with Anja](docs/a-working-day.md), with its diagrams.
2. **Get started:** [Start a new project](docs/start-a-new-project.md), the first run and what you supply.
3. **Inspect the implementation and the evidence:** [the repository map](docs/repository-map.md) and [what was measured](docs/evidence.md).

Anja is a working example to copy and adapt. There is no plugin or installer. You take the parts you want into your own repository and edit them: project paths, domain specialists, rules and a few dependencies are yours to change before it runs well on your project.

## What it gives you

- **Specialists do the work.** You describe the work to the lead session; it briefs the specialists the work touches, runs them in parallel, integrates what they return and commits.
- **Independent scrutiny.** A change is reviewed by agents that did not write it. A second session running `/review-hub` takes commits from every other session, seats a fresh panel on each batch, checks every finding at its file and line, and sends back a verdict with patches.
- **Memory that lasts.** Corrections and decisions survive the conversation they happened in. A lesson that keeps failing can become a rule every relevant session reads, and a rule that still fails can become a tested guard.
- **Work that survives sessions.** Plans, mail, reviews and commits stay coordinated across sessions and across compactions; a session that compacts rebuilds its state from a plan on disk and its own record.
- **Safeguards, with the decisions left to you.** Hooks warn about or refuse defined risky actions as they happen. A push to production, a paid run or a migration that rewrites data waits for your word.

## Why Anja, when Claude Code already has sub-agents, skills, hooks, memory and agent teams?

Claude Code is the foundation and supplies the primitives. Anja is the operating model on top of them: conventions for delegation, a commit discipline for several sessions in one checkout, review separated from authorship, a recovery procedure after every compaction, guards that have earned the right to refuse, and a loop that turns your corrections into lessons, rules and guards. Where a native feature now does part of the same job, [Anja beside Claude Code's own features](docs/beside-native-features.md) says so, row by row.

## One piece of work, end to end

This is a typical run, described rather than transcribed.

You open a session and run `/orient`: it shows the branch, the last commits, uncommitted work and which other sessions are active. You say what you want in a sentence or two. `/expert-review` seats a panel of the specialists the question touches; each reads the codebase in a fresh context with its own knowledge file and memory, and the panel comes back with a position, the trade-offs and the findings that can be fixed in code. You confirm what ships and what waits, and the panel's hand-off is a ready `/agent-work` brief. `/agent-work` then gives the files to between one and five specialists working in parallel, each editing its own part. The lead session integrates the parts, runs the tests and commits through a tool that refuses if anything besides the files it named is staged.

![A feature, from request to done: you ask for a feature; for a real design choice a panel weighs it first and you pick an option; agents build it in parallel and none commits; your session commits it once the tests pass; a fresh panel reads it, in a second session or in this one; if changes are requested, the fixes you accept land in one commit, and a review hub checks them again; only if you keep a tracker, the feature is marked complete after a final check; then it is done and the next piece starts.](docs/images/a-feature-from-request-to-done.svg)

A second session running `/review-hub` picks the commits up. It seats a panel that does not include the agent that wrote them, with a code-design expert on any code, verifies each finding at its file and line, and mails back a verdict with patches. You choose which fixes land; the lead session commits them; the hub verifies the fix and closes the loop.

When you correct the agent along the way, `/wrap` and `/meta learn` write the correction down at the end of the session, so the next session starts with it. `/summary` tells you at any point where the session stands and what is waiting on you, and a working plan on disk carries the session through a compaction.

[A working day with Anja](docs/a-working-day.md) walks through all of this step by step, with more diagrams: a session from first message to last, a second session reviewing the work, what survives a compaction, and what each session leaves for the next.

## A correction becomes a lesson, a rule, then a guard

The name spells the loop: **Act, Note, Judge, Apply.** You correct the agent; the correction is noted as a lesson in memory that survives the session; when the same mistake comes back, the lesson is judged worth more, and a rule is written that every session it applies to reads; when the rule still fails, a guard is applied: a hook that warns or refuses at the moment of the act, tested like any other code.

Escalation is conditional and curated. Most corrections stay lessons. A lesson becomes a rule when it fails again, and a rule becomes a guard when a measurement shows the rule alone did not hold. I make those calls. The system does not promote on its own.

A guard earns the right to refuse. A new guard only warns, and logs every time it fires. It is promoted to refusing only when that log shows it catches the real act and not text that merely mentions it, decided separately for each pattern it checks ([the promotion rules](.claude/rules/session-cadence.md), [the fire log](.claude/hooks/lib/fires-log.sh)). The guards are tested, and so are their tests: [the smoke suite](scripts/smoke-test-hooks.sh) drives every hook with a case it must stop and a case it must let through, and [the mutation matrix](scripts/smoke-mutation-matrix.sh) breaks the hooks on purpose, one at a time, to see which tests notice.

One example from this repository's own history. Several sessions commit to one branch in one checkout, and a session once committed another session's half-finished lines under its own message, because a plain commit takes whatever is staged. The correction became a lesson, the lesson a rule in the commit doctrine every lead session receives, and the rule a tool: [`safe-commit.sh`](scripts/safe-commit.sh) refuses when anything besides the files you named is staged, and its gate runs in the same process as the commit.

![How a mistake stops repeating: a mistake happens and you correct it; the lesson is written down in memory, which survives the session; if the mistake comes back, the lesson becomes a rule, read by every session it applies to; if it still comes back, it becomes a guard, which refuses or warns at the moment of the act; then it is measured: did the mistake stop?](docs/images/a-mistake-stops-repeating.svg)

## Before you start

**Requirements.** Claude Code, git 2.31 or later, bash, Python 3, jq and Node.js. Built on macOS; the hook tests also ran on Linux; Windows has not been tried.

**Opening it runs its hooks.** Hooks are scripts, and they run with your full user permissions: in an interactive session once you trust the folder; under `claude -p` or the Agent SDK with no prompt at all; and in a repository you have already trusted, with no new prompt, once you copy them in. Read [`.claude/settings.json`](.claude/settings.json) first, or start with `claude --settings '{"disableAllHooks": true}'`.

**Guards are safety checks, not security boundaries.** A hook checks what a command looks like. A push to `main` is refused unless the command carries an approval prefix, and the agent is instructed to add that prefix only after you say yes; the hook cannot verify your consent, and an agent could construct the prefix. The guards catch mistakes and make an unwanted act deliberate. They are not a cryptographic or procedural guarantee, and your word stays the real gate.

**It costs context.** As shipped, the lead session receives about 120 KB of rules at every start, resume, clear and compaction. The two rule files every session and specialist loads add about 54 KB. A session's first commit command brings about 67 KB more, and so does the first one after a compaction or clear; that command is refused once, so the rules arrive before it runs. `SKIP_ORCHESTRATOR_INJECT=1` and `SKIP_COMMIT_DOCTRINE_INJECT=1` in the settings' `env` block turn off the 120 KB and the 67 KB. [Saving the cache](docs/saving-the-cache.md) is the practical guide to the prompt cache.

**What you supply.** A `CLAUDE.md` (start from [the starter](docs/starters/CLAUDE.starter.md)), a project memory directory that [`setup-project-memory.sh`](scripts/setup-project-memory.sh) links into place, the product context file the specialists read, and the trackers (`todo.txt`, `DECISIONS.md`, `BACKLOG.md`, `plans/`) once you use the commands that read them. Some scripts, domain specialists, test entry points and paths still describe the source project. [The start page](docs/start-a-new-project.md#what-you-supply) lists what to replace.

**Start small.** Begin with the hooks and `bash-environment.md`, the rule file of measured facts about the shell and the Bash tool. Add `migrations.md` only if your project applies SQL migrations to a Postgres database. Add a rule when a measurement earns it, and promote a guard to refusing only on its logged fires. If you run one session at a time, seven switches in the settings turn the multi-session plumbing off; [the start page](docs/start-a-new-project.md#one-session-at-a-time) lists them.

## How the pieces fit

![Who does what: you decide and the lead session reports to you; the lead session plans, builds and commits and leaves anything destructive to you; it runs commands, procedures that pick the specialists and decide how the work runs; commands bring in and brief the experts, specialists with their own knowledge and memory who never commit; meta turns your corrections into lessons and keeps the rules, guards, commands and memories current; rules and guards apply at every level.](docs/images/who-does-what.svg)

**You decide.** Anything destructive waits for your word.

**The lead session leads.** (The copy's own files call it the main session.) It plans, builds and commits. Rules that only it can act on reach it alone, through a [session-start hook](.claude/hooks/orchestrator-inject.sh), so specialists start without rules they cannot use.

**Commands run the work.** 53 commands cover the session rhythm (`/orient`, `/summary`, `/wrap`), review (`/expert-review`, `/review-hub`), hand-offs (`/mail`, `/spinoff`), recovery (`/post-compact`, `/circuit-break`) and the system's own upkeep (`/meta`). `/help` maps a task to its command.

**33 specialists bring the depth.** Security, accessibility, performance, QA, architecture, code design, UX design, UX copy, prompt engineering, context and memory architecture, pricing, SEO, launch, legal and more. Each has its own knowledge file and builds a memory as you use it; the copy ships the knowledge, and the memories are yours. Specialists hand their work back to the lead session, which commits it; their primer tells them not to commit, and the lead session writes their memory for them, since [a hook](.claude/hooks/block-subagent-memory-write.sh) refuses a specialist's direct edit of a memory file.

**Several sessions, one branch.** Run more than one session and they share one branch in one checkout. [The commit tool](scripts/safe-commit.sh) stages exactly the paths you name and refuses if anything else is staged. [`session-manifest.py check-overlap`](scripts/session-manifest.py) refuses a change to code another session is already editing. Work that would leave files dirty for the others moves to its own branch in its own worktree and merges back when it is done. Sessions mail each other: a mail waits for a session that is not running, can go to every session at once, and stays on record. Claude Code's agent teams split one task among teammates under one lead; Anja is the structure around every session you run.

![Many sessions, one branch: several sessions commit in turn onto one shared branch in one shared checkout; when a piece of work would leave files dirty for the others, one session steps off onto its own branch in its own worktree while the others keep committing; when that work is done it is merged back onto the shared branch; production is a separate exit, a pull request merged only on your word.](docs/images/many-sessions-one-branch.svg)

## What was measured

[The evidence page](docs/evidence.md) lists, part by part, what was measured, what the measurement found, and what was not measured. Four results carry the most weight:

- **Path scoping.** A rule file whose paths a sub-agent does not touch stays out of that sub-agent's starting context, measured at run time.
- **Lead-session-only rules.** A session-start hook's output reaches the lead session and not a dispatched sub-agent. Before the move, about 101 KB of each sub-agent's starting text was rules only the lead session could use.
- **Mail.** 15,472 of 16,754 direct mails (92.3%) were delivered to a running session between 16 August and 20 October 2026. That is delivery, not reading: whether each was read was not measured.
- **The memory read guard.** When it refuses an oversized read and says where to page, agents paged 68.1% of the time, against 12.7% after a plain size error. An observational comparison, not a randomized one.

The copy's own smoke suite, run in a fresh repository holding only this copy, passed 2,049 arms and failed 169. The red arms are expected on a fresh copy: 125 drive tooling the copy does not ship, and 44 drive what your project supplies: its own files, the git hooks setting, and history; [the start page](docs/start-a-new-project.md#first-run) says what each group needs and which passes hold only because something is missing.

## What is in the copy

461 files:

- **[`.claude/agents/`](.claude/agents/)**: 33 specialist definitions and [the primer](.claude/agents/_agent-primer.md) each one reads first.
- **[`.claude/skills/`](.claude/skills/)**: the 53 commands and each specialist's knowledge file.
- **[`.claude/commands/`](.claude/commands/)**: 4 older command files (`/status`, `/verify`, `/external-audit` and one alias).
- **[`.claude/hooks/`](.claude/hooks/)**: 65 hook scripts that refuse, warn, log or inject on the harness's events. [The settings file](.claude/settings.json) wires 58 of them, and 2 more run when another hook calls them.
- **[`.claude/rules/`](.claude/rules/)**: 9 rule files, about 327 KB in all; 7 carry `paths:` and load only when a session reads, writes or edits a matching file.
- **[`.claude/orchestrator/`](.claude/orchestrator/)**: 4 files of rules for the lead session alone. Two arrive at every start, one with the first commit command, and the fourth only through a hook the shipped settings switch off.
- **[`scripts/`](scripts/)**: the commit tool, sessions and mail, the smoke suite and mutation matrix, self-tests and drift checks.
- **[`.githooks/`](.githooks/)**: the pre-commit hook and the notes on wiring git hooks; the pre-push hook is yours to write.
- **[`docs/starters/`](docs/starters/)**: a `CLAUDE.md` starter and four blank audit registers.

Of the 461, 31 files written for the copy: this readme, the licence, notice, trademark, contributing and code-owner files, the `.claude/.gitignore` that keeps run-time state out of git, the 8 pages under `docs/`, the 5 starters and the 11 images. [The repository map](docs/repository-map.md) says what each file holds. The counts describe the tree; they are not the point.

## Where the ideas came from

Many of Anja's mechanisms have relatives in other projects, some adopted outright, some built here before the native feature or beside it. [The credits page](docs/where-the-ideas-came-from.md) records what was built here, what was adopted, from whom, and when.

## Licence, notices, name

The code and text are under the Apache License, Version 2.0 (`LICENSE`). Text adapted from other projects is credited in `.claude/NOTICE` under its own licence, and the root `NOTICE` points there. Anja™ is a trademark of the maintainer, used as the name of this project; `TRADEMARK.md` says what that does and does not restrict. Contributions are welcome under `CONTRIBUTING.md`: commits signed off under the Developer Certificate of Origin, no contributor agreement, and review by someone who did not write the change. `docs/github-settings.md` is the click-path for the branch protection the project expects.
