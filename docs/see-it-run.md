# See it run

This page is one real session on a fresh copy of Anja, recorded on 28 October 2026. You type four things: `/orient`, one small change to commit, `/expert-review --code --last 1`, and `/working-plan`. For each, the page says what the session did and quotes its reply as it wrote it. It is the path [start-a-new-project.md](start-a-new-project.md) calls the minimum first success, recorded from start to finish so you can see it before you copy anything.

## How it was recorded

- **The repository.** A new repository holding a ten-line Python script, `app/greet.py`, and a two-line README. Then steps 1 to 4 of the minimum first success: `.claude/`, `.githooks/` and `scripts/` copied in with `LICENSE`, `NOTICE` and `docs/starters/`; `CLAUDE.md` copied from `docs/starters/CLAUDE.starter.md` and left unfilled; `git config core.hooksPath .githooks`; `.claude/project-memory/MEMORY.md` created. One part of step 4 was skipped: `scripts/setup-project-memory.sh` was not run, because it links a folder under the home directory of whoever runs it. Two commits, no remote, no `todo.txt` and no trackers.
- **Claude Code and the model.** Claude Code 2.1.312, the Opus 5.5 model, in auto permission mode: Claude Code's own safety check approved each command. In your session you approve them yourself, or pick the mode you prefer.
- **No personal setup.** The session was launched with `--setting-sources project,local --strict-mcp-config --no-chrome`, so no user settings, global instructions, user plugins or connectors took part; Claude Code's three built-in plugins loaded as usual. The copy's hooks ran as shipped. Its 12 permission allow-list entries did not: Claude Code ignores them in a folder that has never been opened interactively and trusted, so auto mode's own check approved every command.
- **Headless.** The first turn started the session and each later turn resumed it, each as one non-interactive call (`claude -p`), and each call ended on its own, after 71, 75, 171 and 35 seconds. Claude Code tells the hooks when nobody is at the keyboard, so the start-up hook told this session not to arm the mail listener or the keep-warm timer. An interactive session arms the listener on its first turn, and the keep-warm timer too once you switch keep-warm on; it ships off (see [saving-the-cache.md](saving-the-cache.md)). A headless one that armed the listener would never end: each time the listener expired it would wake the session, and the session would arm it again.
- **Takes.** This is the fourth take, and the first made after the copy learned to tell a headless session not to arm the listener. The first take never ended, for exactly that reason. In the second, the first take's session was still running and `/orient` reported it as a peer. The third was recorded before that change. None of them is shown here.
- **Cost.** Claude Code's own estimate, at API prices: about $1.12 for turn 1, which carries the start-up context, $0.85 for turn 2, $2.03 for turn 3 with its two reviewers, and $0.28 for turn 4, about $4.27 in all.
- **What was edited.** The session's tool calls are summarised. Its replies are quoted whole and unchanged, except that the session's 8-character id is shown as `<id>`: the copy's release check refuses any session id on a published page.

## Turn 1: `/orient`

Before your first request runs, the start-up hooks give the session its standing directives. Two of them act on this turn. Because nobody was at the keyboard, the first is the unattended line, which the session gets instead of the mail-listener directive:

> 🤖 UNATTENDED RUN (CLAUDE_CODE_SESSION_ATTENDED=0: claude -p or the SDK): do NOT arm the mail listener or the keep-warm timer in this session, whatever another directive or doctrine says. A headless session that arms either never exits: the listener's expiry wakes it and it re-arms. The working plan and every other directive still apply.
>
> 📋 WORKING PLAN (standing directive): on your FIRST turn — before the user's task, exactly like the mail-listener — open plans/session-&lt;id&gt;-$(date +%Y-%m-%d).md: …

The unattended line is quoted as this recording printed it. The copy you download words it a little more fully: it adds that a missing listener is the correct state in such a run, so no later check that re-arms a dead listener should arm it.

What the session did:

1. Read the branch, the last commits and the uncommitted files, and checked which of the scripts `/orient` runs are in the copy. Two are not.
2. Recorded itself in the session list and looked for a review hub. There was none.
3. Ran the orient checks. The three audit-tracker counts and two drift checks stopped because the tracker files do not exist yet, the deferred-item scan crashed on the missing `todo.txt`, and the recurring-mistake spotlight had no history to read. The migration and deploy checks were skipped: there is no database and no production domain.
4. Read the README, the script and the last commit, then wrote this session's working plan, `plans/session-<id>-2026-10-28.md`, and left it uncommitted.

Its reply:

> [orient]
>
> ## Orientation report
>
> **Session:** you are `<id>`. There are no other sessions running in this repo, and no review hub is running.
>
> **Branch:** `main`, and nothing is uncommitted. The 2 most recent commits:
> - "Add the Anja copy (steps 1-4 of the minimum first success)"
> - "A tiny greeter"
>
> **What the project is right now:** a one-file Python program that prints "Hello, world!". It now sits under a large copied workflow system: 88 skills, plus agents, hooks and scripts.
>
> **Pending:** I can't count anything yet, because the files the checks read don't exist in this repo:
> - There is no `todo.txt`, so the deferred-work scan crashed on the missing file. It did not find "nothing due".
> - The flow, feature, ops and surface trackers are missing, so all 3 tracker counts and both tracker drift checks failed.
> - Starter versions of those 4 trackers are in `docs/starters/`, but they haven't been moved into place.
> - There is no memory index and no meta changelog, so I couldn't report those stats.
> - The recurring-mistake priming said it has no history to work from.
>
> **Skipped on purpose:**
> - **Migrations:** this repo has no database.
> - **Deploy/env drift:** this repo has no production domain to check.
> - **Translation drift:** that script isn't in this copy.
> - **Saved progress marker:** I didn't update it, because the scan it belongs to didn't run.
> - **Mail listener:** I didn't start it, because this session is running unattended.
>
> **Warning:** `CLAUDE.md` is still the starter template. The project description, stack, key-file descriptions and the opening "copy this file" paragraph are all unfilled `<…>` placeholders. Every session and helper agent loads that file, so filling it in is the most useful next step. Only you can say what the project is and what stack it uses.
>
> **Done this session:** I started this session's working-plan file in `plans/`, as the startup instructions require. I haven't committed it or anything else.
>
> The rest of orientation is blocked on missing files, not on work in progress. I can do either of these next:
> - move the starter trackers into place and create an empty `todo.txt`, so the checks have something to read;
> - help you fill in `CLAUDE.md`.

## Turn 2: a small change, committed

You type:

> In app/greet.py, let greet() take an optional name that defaults to "world", and add a --name option on the command line. Then commit the change.

What the session did:

1. Wrote the change and ran it three ways: with no option, with `--name Ada`, and calling `greet()` and `greet("Bo")` from code.
2. Ran `/verify`. The repository has no TypeScript or ESLint setup, so its type-check and lint steps did not apply. It compiled the file, and the size, leftover-TODO and secrets checks came back clean.
3. Read the top of `scripts/safe-commit.sh`, then ran it, declaring the one file and its line counts (`--add 7 --del 4`). A hook refused that first commit-shaped command and handed the session the commit rules instead:

   > ⛔ COMMIT-DOCTRINE INTERCEPT — NOTHING IN THIS CALL EXECUTED. This is the first commit-shaped command of this context window, so the commit doctrine (.claude/orchestrator/commit-doctrine.md, 9 parts) should have arrived in your context alongside this refusal; if fewer than 9 COMMIT-DOCTRINE part headers are there, Read the source instead. Read it, then RE-ISSUE THE IDENTICAL COMMAND — the second attempt is allowed. …

4. Said it would send the same commit again, ran the identical command, and it went through:

   ```
   safe-commit: staged +7/-4 for app/greet.py
   [main 356794e] greet: optional name (default "world") and a --name option
    1 file changed, 7 insertions(+), 4 deletions(-)
   safe-commit: committed 356794e
   rc=0
   ```

The change it committed:

```diff
diff --git a/app/greet.py b/app/greet.py
index 4826438..47f98ca 100644
--- a/app/greet.py
+++ b/app/greet.py
@@ -1,10 +1,13 @@
 """A tiny command-line greeter."""
-import sys
+import argparse
 
 
-def greet():
-    return "Hello, world!"
+def greet(name="world"):
+    return f"Hello, {name}!"
 
 
 if __name__ == "__main__":
-    print(greet())
+    parser = argparse.ArgumentParser(description=__doc__)
+    parser.add_argument("--name", default="world", help="who to greet (default: world)")
+    args = parser.parse_args()
+    print(greet(args.name))
```

Its reply:

> [main]
>
> I made the change and committed it as `356794e` on `main`. It hasn't been pushed.
>
> **What changed in `app/greet.py`:**
> - `greet()` now takes a `name` that defaults to `"world"`, and returns `Hello, <name>!`.
> - The command line has a `--name` option, also defaulting to `world`. I used Python's standard `argparse`.
> - I replaced the old `import sys`, which nothing used, with `import argparse`.
>
> **How I checked it:**
> - I ran the script both ways: with no option it printed "Hello, world!", and `--name Ada` printed "Hello, Ada!".
> - I also called `greet()` and `greet("Bo")` directly and both returned the right text.
> - The repo has no tests, so these hand runs are all the testing there is.
>
> **Pre-commit checklist:** I ran it, but most of it was written for a TypeScript web app, so only some of it applied here.
> - The type check and lint steps were skipped: the repo has no TypeScript or ESLint setup.
> - The build and browser-test steps were not relevant.
> - The security scan found nothing.
> - The diff check found nothing: 1 file, 7 lines added and 4 removed, no TODO or FIXME notes.
>
> **Not done:**
> - The change wasn't sent for review: no review session is running, and it's a one-file change.
> - The only uncommitted item is this session's working-plan file in `plans/`, which I left out of the commit.

## Turn 3: `/expert-review --code --last 1`

What the session did:

1. Compiled the file and ran it with and without `--name` again, checked for other sessions and a review hub (none), and asked the copy's panel picker which experts the changed path calls for. It suggested none: the copy's experts are mapped to the source project's paths (`src/`, `tests/`, `scripts/`, migrations and a few others), and none to `app/`.
2. Picked two reviewers by hand and started them as helper agents in the background, on Opus: `uncle-bob` for code design and `qa-expert` for behaviour and edge cases. Each was given the commit, your request word for word, a lens and the results of those runs, and was told not to open the session's plan. The testing reviewer was also given kinds of input to try (empty, spaces, unicode, `None`, flag forms, `--help`, unknown options, exit codes) and told to run the script in a way that writes nothing into the repository. Neither saw the session's conversation. Both had tools that could change files, and the repository was unchanged afterwards.
3. The testing reviewer made 24 probes on a copy outside the repository: 18 runs of the script, 5 calls to `greet()` and one import (a 19th run, of `--help`, never started and was redone), among them an empty name, spaces, unicode, `--name` with no value, an unknown option and `greet(None)`. Both reviewers returned APPROVED with high confidence, and each said it had no memory file of its own to check its judgement against, because a fresh copy ships none.
4. Re-ran three of the behaviour notes itself (`greet(None)`, `greet("")` and `--name` with no value), wrote the verdict to `.claude/reviews/<commit>.md`, and committed it.

Its reply, once both reviewers were back:

> [expert-review]
>
> Both reviewers **approved** the `--name` commit (`356794e`). Neither found a defect. I've written the verdict to the review record and committed it as `cf52650`. Neither commit has been pushed.
>
> **Optional suggestions.** All 6 are the lowest severity, none blocks anything, and every one is your call:
>
> | Where | Suggestion | Raised by |
> |---|---|---|
> | `app/greet.py` | "world" is written 3 times: in the function, in the option's default and in its help text. If one is changed later, the command line and the function could disagree. Both reviewers suggested storing it once. | both |
> | `README.md` | It doesn't mention `--name`. What it does say is still true. | both |
> | `app/greet.py` | `greet(None)` prints "Hello, None!" instead of falling back to "world". I re-ran it and that's what happens. | QA |
> | `app/greet.py` | `--name ''` prints "Hello, !". Rejecting blank names would be new behaviour, so it's your choice. | both |
> | `app/greet.py` | Shortened flags such as `--na Ada` are accepted. That's harmless with only one option. | QA |
> | repo | There are no tests. That was already true before this commit. | both |
>
> **Limits of the review:**
> - Both reviewers mentioned the 3 copies of "world". I didn't raise its severity for that, because they were looking at the same 2 lines rather than finding it independently.
> - Neither reviewer had any past review history to draw on, because those files don't exist in this copy. Their verdicts come from reading the code alone.
>
> The QA reviewer ran the script through about 20 command-line and function inputs on a copy outside the repo. I checked that the repo was left untouched. The record says APPROVED with nothing outstanding, so the project's migration review check would accept it.
>
> If you want any of the suggestions done, the simplest is storing "world" once plus a one-line README note. I'd make that one small commit.

The start of the review record it committed:

```
APPROVED
Reviewed-by: uncle-bob (Opus, fresh context), qa-expert (Opus, fresh context) — sub-agents of session <id>; no review hub or peer session was live

Commit: 356794e79ff7634539f59353afab49536d536e05 — greet: optional name (default "world") and a --name option
Scope: FULL (both seats) — greet(name="world") and a --name option, as the owner asked; the sys -> argparse import swap is incidental (sys was unused at the parent).
Pre-gate: py_compile OK; `python3 app/greet.py` -> "Hello, world!"; `--name Ada` -> "Hello, Ada!". No test suite exists.
```

## Turn 4: `/working-plan`

The session brought its plan up to date and showed it. The step that refreshes the plan's generated section did not run, because it reads `todo.txt` and this repository does not have one, so the plan is written by hand. Its reply:

> [working-plan]
>
> I brought the plan file up to date first. Its opening section still said "no task from the owner yet", so I rewrote that section and added a dated history of what happened. The plan is short, so this is the whole plan with nothing left out.
>
> The step that refreshes the plan's machine-written section didn't run, because it needs a `todo.txt` this copy doesn't have. That section isn't in the file, so nothing in it is stale.
>
> ## Live items (3 of 3)
> | Item | Status | One-liner |
> |---|---|---|
> | Orientation | done | Most of the startup checks had nothing to read: there's no `todo.txt`, trackers, memory index or changelog yet |
> | CLAUDE.md placeholders | open, yours | `CLAUDE.md` is still the starter template with its `<…>` fields unfilled |
> | `--name` option | committed (`356794e`) | `greet()` takes a name that defaults to "world", and the command line has `--name`; I ran it with and without the option |
>
> ## Review ledger
> | Work unit | State |
> |---|---|
> | `356794e` (`--name` option) | Reviewed and approved by 2 fresh reviewers (design and QA). They left 6 optional low-severity notes for you to decide on. The review record was committed as `cf52650`. |
>
> ## History (newest first)
> - **Review closed:** both reviewers approved. The main optional notes are storing "world" once instead of 3 times, and that the README doesn't mention `--name`.
> - **`--name` committed:** before committing I ran the project's pre-commit checklist. The type-check and lint steps don't apply to Python, so they didn't run.
> - **Orientation:** most checks had nothing to read, and `CLAUDE.md` turned out to be still unfilled.
>
> ## Standing rules this session follows
> - The plan is updated whenever something changes.
> - Commits go through the project's safe-commit script.
> - Code reviews go to a review session if one is running; otherwise to fresh reviewers.
> - Because this session runs unattended, I didn't start the inbox listener.
>
> ## Can the session close?
> Yes, nothing would be lost. There are 2 local commits, not pushed. The plan file itself is the only uncommitted item. This covers the whole plan.
>
> ## What's waiting
> - **On you:** fill in `CLAUDE.md`. Decide whether you want any of the 6 optional review notes done; I'd suggest storing "world" once plus a README line.
> - **On me:** nothing.
> - **Reviews:** I sent no review requests to other sessions, so there are no replies to wait for. The only review this session started was done by its own 2 fresh reviewers and is closed.

## What this shows, and what it does not

It shows the three things the minimum first success is for: a guard acted at the commit, a plan on disk carries the session, and agents that did not write the change reviewed it, briefed by the session that did. It also shows the session saying what it could not check, which is most of what `/orient` runs on a tree with none of your files yet, and a headless run that ends on its own.

It does not show a second session, a review hub, mail between sessions, the mail listener an interactive session arms, the keep-warm timer you can switch on, a compaction, your own rules and experts, or the permission prompts of an interactive session. [a-working-day.md](a-working-day.md) describes those.

Three things a fresh copy does that may surprise you. `/orient` has little to read until your `todo.txt` and trackers exist, and `/working-plan`'s generated section needs `todo.txt`; both are visible above. And a commit that touches the copy's skills, agents, hooks, rules, commands, templates or project memory prints the skill linter's findings: 90 on a fresh copy, 34 of them for expert agents with no memory file and the other 56 about the copy's own files: stale counts, broken references and oversized skill files. The hook prints them and lets the commit through, the 34 marked ERROR included, and no commit on this page touched those folders. Step 7 of [the first run](start-a-new-project.md#first-run) says what each red arm of the smoke suite needs, and `scripts/smoke-test-hooks.sh` ends its run by sorting those arms into the ones expected on a fresh copy and the ones that are not.
