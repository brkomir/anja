# Saving the cache

This page is about one cost: the prompt cache. Every message you send makes Claude Code re-send the whole session, and the cache is what lets the API read the unchanged start of it instead of processing it again. When the cache is gone, the next message pays to write all of it again, and the vendor's documentation says that turn is slower and more expensive. Here is what makes that happen, and the habits and commands in Anja that avoid it. Claude Code documents no keep-alive for the cache ([beside-native-features.md](beside-native-features.md), the keep-warm row); the copy adds one, `/keep-warm`, which `/pause` also uses and which is off until you switch it on (section 2).

It is for a developer who has read [a-working-day.md](a-working-day.md). Facts about the cache come from the Claude Code documentation page "How Claude Code uses prompt caching", read on 12 October 2026, and are marked as the vendor's. Lifetimes and settings change between Claude Code versions, so check that page before you plan around a number. What each command does comes from its own spec in `.claude/skills/`.

## 1. Know what forces a full re-write

Check the cache before you do any of these, because each makes the next message write the whole session again:

- **Leaving the session idle past the cache lifetime.** The vendor's default for the main conversation is one hour on a Claude subscription within its included usage, and five minutes on usage credits, an API key or a cloud provider. Every request that reads the cache resets the timer, so a session you keep working in stays warm. The `promptCacheTtl` setting chooses between five minutes and one hour.
- **Switching to an account in another organisation.** The vendor says caches are isolated between organisations. After the switch, the next message of every session that carries on rewrites its whole context.
- **Switching model.** Each model has its own cache, so `/model` makes the next request read the whole history with no hits. Claude Code asks you to confirm the switch while the cache is still warm.
- **A few other changes the vendor lists**, among them changing the effort level on most models and connecting an MCP server whose tools load up front.

To see whether the cache is warm right now, run `/usage` (the vendor says it shows a `Prompt cache (main)` line) or wire the status line script the copy ships, `scripts/statusline.py`, which shows a countdown. Helper agents (the sub-agents a session dispatches: the specialists and the reviewers) run on a shorter clock: the vendor gives them five minutes even on a subscription unless you set `subagentPromptCacheTtl` (the `/limit-recovery` script still assumes five), and a helper starts a cache of its own instead of reading yours. Section 4 uses that.

## 2. Stepping away for a few hours: `/pause`

Type `/pause` before you leave a session you want to come back to. It holds the work: nothing new starts, helper agents already running finish and report back, and each report is kept rather than acted on. You can still ask the session questions. `/pause --resume <in N minutes | at HH:MM>` also writes a work order and schedules the resume through `/autorun`. A running helper is not stopped, because a stopped helper resumed after its short cache has gone has to write its whole context again.

Where keep-warm is switched on, `/pause` also keeps the cache warm for a window of hours, so the first message back reads the cache instead of rewriting it. A recurring timer sends a short automated message only when the cache is close to expiring, and each message that reads the cache resets the lifetime. `/pause --cold` skips this, for a break you will not return from soon. Where keep-warm is not switched on, or you turned it off for the session, `/pause` says so and the cache expires like any idle one.

Keep-warm is off until you switch it on: run `mkdir -p .claude/state && touch .claude/state/keep-warm-enabled`. Its four hooks (the gate, the one that refuses tool calls on a ping turn, and the pair that reminds the session to arm the timer and records that it did) and the status line script are already wired in the shipped settings; the gate reads the cache countdown and your usage from the status line, so if you replace the status line, keep it writing the same state file ([the start page](start-a-new-project.md#first-run), step 2). The gate passes a ping only when the cache is close to expiring. Among other cases it blocks on the five-minute lifetime, at your plan's usage limit (where the cache then usually goes cold), after a ping finds the cache already gone (an account switch or an expiry), and after many hours with no message from you. A ping is a real request and spends a little of your usage. `/keep-warm status` shows what it did; `/keep-warm off` and `on` stop and re-arm it for one session. The pause window has a fixed length set in the skill; a pause that outlasts it is no longer kept warm.

## 3. Long sessions: compact before the break, recover from the plan

Before you stop for longer than the cache lasts, or switch account or model, run `/pre-compact`, then `/compact`. When the compaction is done, `/post-compact` rebuilds what the summary dropped.

Switch the model only after the compaction, never before. Each model has its own cache, so a compaction sent on the new model reads the whole history uncached. The switch itself sends nothing; the first message on the new model then writes the start of the session (the system prompt, the tools and the files loaded at start) and the short summary, not the whole history. The same order is the cheap way to hand a long procedural command, such as `/wrap`, to a different model, and to switch back afterwards.

The reason is when the compaction's cost lands. The vendor says a compaction sends one more request: your whole history plus an instruction to summarise it. While the cache is warm, that request reads the history from the cache and costs a fraction of what the size suggests. After a break longer than the lifetime there is nothing to read, so it processes the whole history uncached, and the vendor says `/compact` costs the most when you resume an old session. The turn straight after a compaction, on the same model, then writes a cache for only the short summary; after a switch or a break it also writes the start of the session again. So compacting before the break is the cheap version of the step, and the first message after the break is far smaller than the history it replaces.

![Compact first, then switch or step away: a timeline of one long session. While you work on the model that holds the cache, the cache is warm. Write what must carry over into the plan, then compact on that same model, so the compaction reads the cache. Only then switch to a different model or take a break; there the cache is lost. The first message afterwards writes a small new cache, the start of the session and the short summary but not the whole history, and the rest is rebuilt from the plan. The wrong order is to switch first: the compaction then re-reads everything uncached.](images/compact-first-then-switch-or-step-away.svg)

The same vendor page, read again on 20 October 2026, says Claude Code can also compact a long session left idle on the one-hour lifetime shortly before the cache expires, with no `/pre-compact` first; setting `idleCompaction` to `false` turns that off.

A compaction forgets detail, which is why the plan carries the load:

- **`/pre-compact`** writes one dated block into the working plan: helper agents still running, each uncommitted edit with a line you can search for to check it is still in the tree, open mail to other sessions, questions you have not answered, the next steps as a numbered list, and the files to reopen. It syncs the plan, checks that no heading was lost, and says when it is ready. It writes only the plan: no commit, no mail, nothing resumed. `--disarm` also stops the mail listener until the recovery re-arms it. It is for a compaction you run yourself. Before an automatic compaction it runs only where the auto pre-compact switch is on, and the copy ships that switch off, so keep the plan current as you go ([a-working-day.md](a-working-day.md), section 6).
- **`/post-compact`** runs on the first turn after the compaction; the start-up hook tells the agent to. It re-reads what the summary dropped from the plan, the session's saved transcript and the mail store, brings the plan current, reports, and acts on nothing it recovered. A `/pause` survives it.

## 4. Helper agents: resume them, whatever their size

When helper agents die at a usage limit or a login drop, run `/limit-recovery`. Its hook, wired in the shipped settings, names unrecovered deaths on each prompt, and the skill's `scan` step gives one decision per helper. Mind the clock: a helper's cache lasts five minutes by default (section 1) and a limit lasts hours, so a helper stopped by a limit is usually cold by the time you can continue it.

- **Resume it, warm or cold, whatever its size.** The vendor says a resumed run can keep reading the cache the first run warmed, so a warm resume pays only for what is new. A cold resume writes the helper's whole context once and keeps its own work. The skill's spec records a measurement where that cost less than a fresh helper re-reading its way back to the same point, and says quality was not compared. Size is no reason to start fresh: the spec also records that every fresh helper it measured taking over a large one ended up larger still.
- **Start a fresh helper over a digest of the dead one's work only when a resume would fail or run on the wrong model.**

  A helper whose context no longer fits the model's window is not resumed: a resume sends the same context again, and a fresh helper on the same model carries the same instructions and tools and can overflow the same way, so start the fresh one on a model with a larger window.

  A helper that ran on a model the session no longer runs is replaced by a fresh one on its own model: the skill's spec records a resume coming back on the session's current model (the vendor says a model set per dispatch stays through a resume, so check which model yours ran on). When the script cannot read which model the session runs, its row says so: resume only once you have confirmed the session runs the helper's model, and otherwise start fresh on the helper's model.

  A resume that fails is replaced too, on the helper's own model: one that dies again on an error before doing any work. A resume that dies again at a usage limit, at a login drop, or on a passing server-side error such as an overload has not failed: resume it again after the reset, the re-login or the overload.

  One case depends on which limit was hit. The shared session limit stops every model at once, so a helper that died there is resumed after the reset like any other limit death. A helper that died at its own model's limit is never resumed on that model before that limit resets. The script carries a short map from a model with a limit of its own to the next model down (`MODEL_LIMIT_MOVES`; this project maps one model, whose own limit is a weekly one at the time of writing): a helper on a mapped model is replaced at once by a fresh helper on the next model down, which reads the dead one's work and carries on. A helper on a model with no entry, such as the last model down, waits for that model's reset, because the script has nowhere to move it. The script does not check whether the model it moves to has room; a fresh helper that then dies at that model's own limit waits like any other.
- **Before you start a fresh one,** check whether the dead helper already wrote the deliverable its brief asked for. If it did, read that.
- **To learn whether a stopped helper can still be resumed, send it a message.** The helper list is not the test: a dead helper is absent from it and may still resume.

One more habit on the same clock: tell helpers to run any command that could take more than a few minutes in the background and check it in short calls. A helper that sits on one long command past its cache lifetime comes back to a cold cache.

## 5. Review requests: one per finished piece of work

Ask for a review once per finished piece of work: a fix wave, a package, a round of folding in findings. Do not ask once per commit. With one session, run `/expert-review --code --last N` over the finished piece. With a second session running `/review-hub` ([a-working-day.md](a-working-day.md), section 8), send one request that names every commit.

Each request seats a panel of fresh reviewers, and each reviewer starts a cache of its own, as in section 1. One panel over a batch replaces a panel per commit, and the verdicts still come back one per commit. Send early only in the cases the spec lists, among them when another session is about to build on a held commit, when the held commits have waited a few hours, and at `/wrap`.

## Which to reach for

| You are about to | Do this |
|---|---|
| Take a break shorter than the cache lifetime | Nothing. The next message reads the cache and resets the timer. |
| Leave for a few hours and come back to this session | `/pause`, with keep-warm switched on. |
| Leave overnight, or switch account or model | `/pre-compact`, `/compact`, then switch. `/post-compact` when you are back. |
| Find helpers dead at a limit | `/limit-recovery`. |
| Ask for a review | One request per finished piece of work. |

## Where to go next

[a-working-day.md](a-working-day.md) shows where these steps sit in a day, and [beside-native-features.md](beside-native-features.md) says, for each of these mechanisms that has a native counterpart, whether Claude Code's own feature now does the job.
