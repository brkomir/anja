# Repository map

This page is an index to look things up in, not a tour: read the table below, then jump to the directory you are about to open. To set up your own project, read [the start page](start-a-new-project.md). If you open only a few files, open `.claude/settings.json` (what runs, on which event), the hooks section below, `.claude/rules/session-cadence.md` (how a guard is proposed, counted and promoted from warn to block) and `scripts/smoke-test-hooks.sh` (how each guard is tested).

The page covers every directory the copy ships, says what each one holds, and gives one line per file wherever a line helps. Anja grew inside one application, the source project, a photography critique application built and shipped with Anja. That application's own code is not part of the copy. Every count on this page is taken from the committed copy, which lists 425 files.

| Directory | Files shipped | What it holds |
|---|---|---|
| `.claude/` (top level) | 6 | Harness settings, the ignore file for run-time state, the byte pins for always-loaded files, the pins for moved trigger rows, and the third-party notice and origin record |
| `.claude/agents/` | 34 | Sub-agent definitions, one per expert, plus the primer every agent reads first |
| `.claude/skills/` | 129 | 87 skills (expert knowledge and workflow commands), their reference files and an authoring cheatsheet |
| `.claude/hooks/` | 71 | Harness hooks, the shared libraries they source, and three test fixtures |
| `.claude/rules/` | 9 | Rule files: always-loaded or path-scoped, plus two that are parked |
| `.claude/orchestrator/` | 4 | Rules meant only for the main session, never for a sub-agent |
| `.claude/commands/` | 5 | Older slash-command files, kept as redirects or short procedures |
| `.claude/templates/` | 8 | Fill-in templates for audits, specs, panels and migrations |
| `.claude/docs/` | 3 | The architecture guide, a short overview, and the current-state record |
| `.claude/traps/` | 1 | Shell traps, delivered one command at a time |
| `scripts/` (top level) | 100 | Gates, scanners, test suites, session tooling and generators |
| `scripts/lib/` | 13 | Shared modules that scripts and git hooks source or import |
| `scripts/probes/` | 5 | One investigation rig, kept with its probes |
| `scripts/band/` | 4 | The tools from one compression pass over the always-loaded rule corpus |
| `scripts/fixtures/` | 1 | A test fixture for the hook payload harness |
| `.githooks/` | 2 | How the project's git hooks are wired, and the pre-commit hook |

The table's rows add up to 395 files. It does not count the root files and what sits under `docs/` (the pages, the starter registers, the diagrams and the logo), 30 files that make up the rest of the 425. They are listed at the end.

## `.claude/` (top-level files)

There are six files at this level.

- `settings.json`: the harness settings. It holds environment switches, worktree behaviour, permissions, per-skill overrides, the hook wiring and the status line. The wiring runs 56 of the 63 shipped hook scripts through 109 hook commands on nine events; the hooks section below names the seven it does not wire, two of which other hooks call. One of its environment switches turns the per-turn orchestrator rule injection off.
- `.gitignore`: keeps the run-time state, the logs, helper worktrees, the local settings file and the memory roll's lock and staging files out of git.
- `band-pins.json`: a byte size for each always-loaded file. `hooks/check-memory-budget.sh` reads these pins and warns, without blocking, when an edit grows a file past its pin.
- `band-trigger-relocation-pins.json`: a hash for each trigger row whose move out of an always-loaded rules file into an orchestrator file was approved. `scripts/band-directive-preservation.mjs` counts a moved trigger row as kept only when its hash is listed here, and only that script's pin mode writes the file.
- `NOTICE`: third-party notices for files copied or adapted from public repositories under the MIT and Apache 2.0 licences, with each licence text.
- `third-party-origins.md`: the record for each of those files: where it came from, under what licence, and how the copy differs from its source.

## `.claude/agents/`

There are 34 files: 33 agent definitions and the primer.

- `_agent-primer.md`: the discipline every specialist agent reads before it starts. It asks the agent to verify a symbol before citing it, to check the consumers of a contract before changing it, to test behaviour rather than grep source, and covers similar habits.
- **Expert agents.** There are 33 of them. `scripts/generate-expert-agents.mjs` generates each one as a thin wrapper. The wrapper names the agent's tools and leaves its model to the session that launches it (`model: inherit`), sets a working posture (quantify in lines of code rather than hours, give a concrete trigger for any deferral, take a position inside your domain, never commit), and points the agent to its own skill file and memory file. For each of the 33, the matching skill ships in `.claude/skills/`.
- **Agents that model an outside system.** The copy ships none. The generator reads their descriptions only when their skill files exist, and uses its own table when they do not.
- Five `haines-*` agents carry description lines shortened from an upstream MIT-licensed skill library. `NOTICE` covers them.

## `.claude/skills/`

There are 129 files: 87 skills, each with a `SKILL.md`, plus 41 reference files and one authoring cheatsheet. The groups below follow each skill's own `description:` line.

**Expert knowledge (33 skills)**, each paired with an agent of the same name:

| Purpose | Skills |
|---|---|
| Engineering, architecture and AI | saas-architect, saas-engineer, frontend-developer, performance-expert, security-expert, devops-deploy-expert, uncle-bob (code-design judgment), prompt-engineer, ai-vision-expert, context-architect (how always-loaded rules and agent memory are delivered and structured) |
| Design, copy and accessibility | ux-design-pro, web-designer, ux-copywriter, accessibility-expert, brand-naming-expert |
| Growth, research and economics | growth-analyst, saas-metrics-analyst, ab-testing, market-researcher, user-researcher, seo-content-strategist, saas-launch-marketing, engagement-psychologist, saas-economist |
| Conversion (adapted from an upstream MIT library) | haines-churn-prevention, haines-onboarding-cro, haines-page-cro, haines-paywall-upgrade-cro, haines-signup-flow-cro |
| Operations and legal | launch-ops-expert, ops-monitor, qa-expert, legal-advisor |

**Workflow commands (54 skills)**, invoked by name:

| Purpose | Skills |
|---|---|
| Session lifecycle | orient (where to start), summary (mid-session state readout), eli5 (plain-English account of where the work stands, or of one topic), explain (expand one compressed line the session wrote into what it means and how it is known), circuit-break (stop a line of work that has drifted and re-derive what is actually true), working-plan (show and update the session plan), post-compact (recovery brief after a context compaction), deep-pass (parallel agents over a very long transcript), hanging-work (quick check for anything left undone before the wrap), session-memory (capture the session's decisions in memory before the wrap), decisions (keep the human-readable decisions log, `DECISIONS.md`; the wrap sweeps it at step 3a), wrap (end-of-session checklist), standby (park the session until your next message), pause (let running agents finish, start nothing new, and hold the work until it is resumed), autorun (schedule a scoped work order for later), spinoff (hand unexpected larger work to a fresh session through a self-contained brief), pre-compact (bank this session's state in its working plan before a compaction, yours or the automatic one), keep-warm (arm, stop or read this session's 15-minute keep-alive timer for its one-hour prompt cache) |
| Coordination between sessions | mail (handoffs between parallel sessions), review-hub (turn one session into the code-review hub for its peers), review-queue (read-only status of the review hub and what is waiting on it), peers (this session and the parallel sessions, with what each is working on), board (the fleet board: one read-only card per open session, derived on each render; the short form of `peers --board`), whoami (this session's full id), channel (open, join and drive a dedicated channel shared by several sessions), fleet-inquiry (one lead session investigates a question, asking peers only for scoped evidence) |
| Running experts | expert-review (multi-expert consultation), panel (another name for expert-review), agent-work (one to five specialists making code changes in parallel), expert-system-bootstrap (method for setting up the expert and memory system in a new project), limit-recovery (take over the work of helper agents that died at a usage limit: resume each one, wait for its model's reset, or seat a fresh agent over a digest of its work) |
| Audit and quality | audit-check (verify an audit before marking it complete), test-gap (what a file or feature has tested and untested), sniff-test (self-audit of a draft before sending it), sanity-check (a fresh reader that tries to refute one session's whole body of work before it is called done), surfaces, ops, launch and features (status readouts over registers the project keeps), fix (plan a targeted code fix and run the tests it needs), flows (status of the user-flow audits and what is next in that queue) |
| Release | deploy-check (verify types, tests, migrations, environment settings and known blockers before a production push), push (push the working branch so the staging build rebuilds; with `--emergency`, the direct push of a hotfix to production, only on your yes), promote (ship the working branch to production by pull request, merged only on your explicit word, then watch the deploy) |
| Planning | ideas (capture, refine and promote product ideas in an ideas register), triggers (deferred tasks whose revisit condition now holds), backlog (show and maintain the ranked queue of features and improvements) |
| System upkeep | meta (health and evolution of the expert and memory system), scout (survey of outside agent tooling, with each candidate checked before it is reported), instinct-sweep (sweep runtime event logs for recurring patterns to propose as lessons), observations (a narrative read of where the system keeps tripping up and what to fix next), me (show and update what the system has recorded about your working preferences) |
| Output | report (one self-contained HTML page for one topic) |
| Finding a command | help (which command does what, by topic) |

Reference files ship with these skills: expert-review (9: panel sizing, synthesis, code-review slice mode, drift mode, claim support, the department directory, hand-off rules, process notes and the expert prompt template), wrap (7: step bodies read only when their trigger fires, the history of its modes, and notes and evidence for steps 0, 1, 5e, 7 and the closing steps), meta (9: the procedures for lesson extraction, the adoption-queue readout, the status dashboard, maintenance, distilling memory, triaging a rules file, the architecture audit and adding a skill, plus report formats), four of the five haines-* conversion skills (5 upstream playbooks), saas-launch-marketing (2), promote (1: the retired deploy command's text, which its post-deploy step reads), and one each for engagement-psychologist, prompt-engineer, review-hub, saas-economist, saas-engineer, security-expert, uncle-bob and ux-design-pro. `AUTHORING.md`, at the top of the directory, is a one-screen cheatsheet for writing a skill; it explains the conventions that `scripts/skill-lint.mjs` enforces.

## `.claude/hooks/`

There are 71 files: 63 hook scripts, 5 shared libraries and 3 fixtures. Each line below comes from the script's header comment. "Warn" means the hook never blocks. "Block" means it can refuse the tool call. The shipped settings wire 56 of the scripts. Two are not wired on their own because another hook calls them: `auto-precompact-trigger.py` calls `fleet_verb.py`, and `compact-save.sh` calls `precompact-save-guard.py`. Five ship unwired: `agent-dispatch-memory-guard.sh`, `agent-memory-brief-warn.sh` and `grep-blowup-warn.sh` are switched off on purpose (the start page says when to wire each), and `band-governor-framing-warn.sh` and `migration-commit-msg-warn.sh` ran from the source project's `pre-push` git hook, which the copy does not ship. Each line names the event the script runs on.

- `agent-diff-reporter.sh`: after a sub-agent call. Prints the working tree's git status and diff summary when a sub-agent returns, so the main session sees edits an agent made even when its report says it changed nothing. It stays silent when nothing changed.
- `agent-dispatch-memory-guard.sh`: before a sub-agent dispatch. Appends the machine's swap, compressor size and largest processes to a log on every dispatch, and blocks the dispatch when swap plus compressor pass a set threshold, asking for the work to run serially instead.
- `agent-dispatch-session-limit-guard.py`: before a sub-agent dispatch or a message to a sub-agent. Blocks a new helper agent, and a cold resume that is part of a batch, once the session's five-hour usage is above 90%, unless the prompt carries a line starting `OWNER-ORDERED:` with your words. It reads the status line's state file and fails open.
- `agent-memory-brief-warn.sh`: before a sub-agent dispatch. Warns when the brief for an expert agent that keeps a memory file does not name that file's path, since agents whose brief names the path read their memory far more often. It keeps a ledger of every such dispatch.
- `always-loaded-claim-warn.sh`: before an edit, write or shell call. Warns when a write to an always-loaded file states live state or cites a symbol that does not exist.
- `auto-precompact-trigger.py`: after every tool call and on prompt submit. Tells the main session to run `/pre-compact` once when its context comes within 30,000 tokens of the automatic compaction point, which it reads from the status line's state file, so the session's state is banked before the compaction lands. It never fires for a sub-agent or a keep-alive ping, and stays off unless a fleet switch or a per-session pilot marker turns it on. It never blocks, and it also carries the relay in `fleet_verb.py`.
- `band-governor-framing-warn.sh`: run by a pre-push git hook, which the copy does not ship. Warns when a pushed commit edits one of the two trigger-table files and justifies the edit by the row count rather than by a content reason.
- `band-o-inject.sh`: on prompt submit. Injects the orchestrator rule table (`orchestrator/active-recall-orchestrator.md`) into the main session in chunks. Sub-agents never receive it. It is switched off in the shipped settings.
- `bash-safety-warn.sh`: before a shell call. Warns on risky git patterns and adds advisories before a commit.
- `block-dangerous.sh`: before a shell call. Blocks catastrophic, unrecoverable commands, such as deleting the filesystem root, overwriting a disk device, or a fork bomb.
- `block-push-without-approval.sh`: before a shell call. Blocks a push that can reach the `main` branch, a force or delete push, and the `gh` commands that merge a pull request or start a CI run, unless the command carries an `ALLOW_PUSH=1` prefix marking explicit approval. A plain push to any other branch passes.
- `block-subagent-always-loaded-write.sh`: before an edit or write. Blocks a sub-agent from writing an always-loaded file (the rules, the orchestrator files and the entry files). Only the main session writes those.
- `block-subagent-memory-write.sh`: before an edit or write. Blocks an edit or write to a skill memory file, its archives or the meta skill's two registers, for the main session as well, because memory is persisted only by a shell append. A marker file lets the main session through for bulk maintenance.
- `check-memory-budget-post.sh`: after a shell call. Measures the project memory index and the skill memory files after the command and warns when one is past its budget, which covers the shell writes that `check-memory-budget.sh` cannot predict from the command text.
- `check-memory-budget.sh`: before a write. Guards the byte budget of the project memory index and warns when an edit grows a file past its pin.
- `check-memory-size.sh`: after an edit, write or shell append. Warns when a memory file grows past a size threshold: a line count as a readability note, and byte tiers for skill memory files that near the read tool's limits. It never blocks.
- `check-test-exists.sh`: before an edit or write. Warns when a source file under `src/` is edited and no test carrying its name exists under `tests/`. Route files, type declarations and the schema are exempt.
- `commit-doctrine-inject.sh`: before a shell call. On the first commit-shaped command of each context window, it denies that one call and delivers `orchestrator/commit-doctrine.md` in parts, so the doctrine is in context before any commit runs. Later commits in the window pass silently, and sub-agents are skipped.
- `commit-pathspec-warn.sh`: before a shell call. Warns on a `git commit` with no pathspec while two or more files are staged, because such a commit takes whatever peer sessions staged in the shared index, and points to `scripts/safe-commit.sh` instead.
- `commit-review-warn.sh`: after a shell call. After a commit that touches `src/`, reminds the main session to get a code review of the unpushed commits before it reports the work done or discusses a push.
- `compact-save.sh`: before a context compaction. Writes a checkpoint of the branch, HEAD, working-tree counts and recent commits, which `session-start.sh` replays afterwards, and leaves the pending marker that `post-compact-pending-check.sh` reads.
- `defer-loc-check-bash.sh`: after a shell call. Extracts what a shell command writes to your own task list and hands it to `defer-loc-check.sh`, so a deferral written by a heredoc or a redirect is checked too.
- `defer-loc-check.sh`: after an edit or write. Warns when a line newly added to your own task list defers work in vague terms without a lines-of-code estimate.
- `delegate-code-review-warn.sh`: before a sub-agent dispatch. Warns when a dispatch looks like a code review while a peer session is live, so the review can go to the review hub by mail instead of running inline.
- `dup-durable-append-warn.sh`: before an edit or shell call. Warns when an append adds an entry whose heading already exists in the target memory file or decisions log, the sign of re-adding an entry wrongly believed missing. It also warns when an entry is appended into the regenerated part of a memory router.
- `fleet_verb.py`: not wired on its own; `auto-precompact-trigger.py` calls it after every tool call and on prompt submit. When you type `/pause --fleet` or `/pre-compact --fleet` in one session, it has every other open session run the same command once. Its only authority is your own typed command, found in the skill log and in the origin session's transcript; a session parked by `/standby` is left alone. It never blocks.
- `grep-blowup-warn.sh`: before a shell call. Blocks a grep whose pattern puts a variable-width quantifier before an alternation, a shape that has exhausted the machine's memory, and warns on a recursive grep from an absolute path, which also walks every worktree clone. Despite the name, the first arm blocks.
- `help-arg-intercept.sh`: before a skill call. Blocks a command whose only argument is `help`, `--help`, `-h` or `?`, and has the main session show that command's usage instead, so a help argument never runs the command. The help skill itself is exempt.
- `hooks-integrity-check.sh`: at session start. Detects a hook left stubbed on disk by an interrupted mutation run. It works from outside the process that did the mutating.
- `keep-warm-arm-reminder.sh`: on prompt submit. Injects the directive to arm this session's keep-warm timer on every turn until the timer is armed, then falls silent. It stays silent where keep-warm is off for the session or the fleet, or where the gate and tool-deny hooks below are not both wired. Warn mode.
- `keep-warm-armed-marker.sh`: after a CronCreate call. Writes the per-session marker that silences `keep-warm-arm-reminder.sh` once the recurring keep-warm timer is created. A one-shot timer does not count. It never blocks.
- `keep-warm-gate.py`: on prompt submit. Decides whether a keep-alive timer fire becomes a paid turn: it lets a ping through only when the one-hour prompt cache is close to expiring and nothing says keep-warm is off, and blocks every other fire at no cost. It reads the status line's state file for the cache countdown, the usage limit and the context size, and falls back to the transcript's timing without it.
- `keep-warm-tool-deny.sh`: before every tool call. Blocks every main-session tool call during a keep-alive turn, so a ping only reads the cached prompt and cannot act; a sub-agent's call is never blocked.
- `limit-recovery-check.sh`: on prompt submit. Names this session's sub-agents that died at an API usage limit and have no recorded recovery, so the session runs `/limit-recovery` instead of reporting their work as done. Warn mode, read-only.
- `log-instructions-loaded.sh`: when an instruction file loads. Logs every load with its reason, so a path-scoped rule that never loaded shows up as a missing log line. It only logs.
- `log-memory-writes.sh`: before an edit or write. Logs each attempted write to a memory file or an agent definition, and warns when the text carries HTML-escaped characters or stray envelope tags copied from an agent's return. It never blocks.
- `log-skill-invocations.sh`: before a skill call. Logs each skill invocation, so that dormant and most-used skills can be counted.
- `log-subagent-dispatch.sh`: when a sub-agent starts. Logs the agent type of each dispatch and prints nothing, since anything it printed would land in the new agent's context.
- `log-user-slash-commands.sh`: on prompt submit. Logs a slash command you typed to the same log as skill invocations, since a typed command never passes through the skill tool.
- `mail-listen-arm-reminder.sh`: on prompt submit. Injects the directive to arm the inbound-mail listener on every turn until this session has armed it, then falls silent.
- `mail-listen-armed-marker.sh`: after a Monitor call. Writes the per-session marker that silences `mail-listen-arm-reminder.sh` once the mail listener is armed.
- `mail-relay-staleness-warn.sh`: at turn end. Warns when a session-mail block surfaced and no ground-truth check (a git read, an overlap check, a tracker read) followed it, the trace of relaying a mail's state claim unchecked. It writes to stderr only.
- `mail-send-carrier-warn.sh`: before a shell call. Warns when a mail send's body does not open with a finding count and a line telling the reader to read the stored message, because a mail notification is cut from the end.
- `maxl-prose-grep-warn.sh`: before a shell call. Warns when a grep for a generic lesson-number pattern targets the meta docs, where it also matches numbers quoted inside lesson bodies, and points to `scripts/architecture-counts.mjs list` for the true highest number.
- `migration-commit-msg-warn.sh`: run by a pre-push git hook, which the copy does not ship. Warns when a pushed commit touches a database migration file and its message does not say whether the migration has been applied.
- `orchestrator-inject.sh`: at session start. Delivers `orchestrator/conventions.md` and then `orchestrator/session-doctrine.md` to the main session in parts of at most 9,700 characters, one part per registered hook entry. A sub-agent does not receive them at launch.
- `post-compact-pending-check.sh`: on prompt submit. Repeats the post-compaction recovery reminder on every prompt until `/post-compact` clears the marker that `compact-save.sh` left.
- `pre-bash-wrapper-suggest.sh`: before a shell call. Warns when a command bypasses one of the project's wrapper scripts, such as running Playwright directly instead of through the end-to-end wrapper.
- `pre-workflow-agenttype-warn.sh`: before a workflow script runs. Warns when an agent call names no matching expert agent type, so the agent would load no project knowledge.
- `precompact-save-guard.py`: not wired on its own; `compact-save.sh` runs it before a compaction you start by hand. Blocks one `/compact` typed while a `/pre-compact` save asked for in the last ten minutes has not yet landed in the session's working plan, so the compaction cannot cut the save off. It refuses at most once per ten minutes, never holds an automatic compaction, and lets the compaction through on any error.
- `scan-secrets-writes.sh`: after a write or edit. Scans the written file for secret patterns before any git operation.
- `session-end.sh`: at session end. Writes the session's "finished" marker through `scripts/session-lifecycle.py` and stops this session's mail listener. Leaving with `/exit` or `/clear` does not fire it.
- `session-memory-reminder.sh`: at turn end. Prints a reminder to run `/session-memory` when the current git identity has made two or more commits today and no marker shows that it already ran today. It stays a reminder because every session shares that identity.
- `session-start.sh`: at session start. The hook that does the most. It warns when a resumed session has already been wrapped; after a compaction it tells the agent to run `/post-compact` first and replays the checkpoint `compact-save.sh` wrote; it prints a capped summary of unread mail and tells the agent, on its first turn, to arm the mail listener, open a working plan and, where keep-warm is switched on, arm the keep-warm timer; it runs two drift checks and the first-turn echo watch, points to a live review hub if there is one, names any warn-only hook that `lib/run-advisory.sh` caught failing, and garbage-collects old marker files.
- `shell-trap-inject.sh`: before a shell call. Matches the command against the keys in `traps/shell-traps.md` and injects the matching traps, each once per context, sub-agents included. It never blocks.
- `standby-resume-check.sh`: on prompt submit. While `/standby` has parked the session, injects the resume steps on every prompt until `/standby resume` clears the marker.
- `subagent-cache-window-inject.sh`: when a sub-agent starts. Adds one paragraph to the new agent's context, before its first tool call, about its five-minute prompt cache: a foreground call or a wait that outlasts the window makes the agent's next call rewrite its whole context. Advisory text only; it never blocks.
- `subagent-resume-guard.py`: before a message to a sub-agent. Blocks a message to one of this session's helper agents that has been idle for more than four minutes, printing what re-reading its context will cost, unless the message carries `RESUME-OK`. A helper that is running or was active recently, and any send it cannot price, pass.
- `trigger-index-match.sh`: on prompt submit. Matches the prompt against trigger phrases and surfaces the matching memory entries before the answer is composed.
- `validate-no-secrets.sh`: after a shell call. Scans every staged file for secret patterns and prints a warning. It reads the staged content rather than the working tree, so a secret that was staged and then edited out of the file is still caught.
- `warn-large-tracker-read.sh`: before a file read. Warns on a full read of a large tracker, and blocks an unbounded read of a large skill memory file.
- `working-plan-reminder.sh`: on prompt submit. Injects the directive to write the session's working plan on every turn until a plan file for the session exists in your own plans directory, then falls silent.
- `write-scope-inject.sh`: before an edit or write. When the call creates a new file, it names the path-scoped rule files whose `paths:` glob covers that file, since a glob cannot fire on a file that does not exist yet. It names the files and copies no rule text.
- `lib/fires-log.sh`: appends one JSON line per hook fire, the raw material for counting a guard's false positives by hand (the evidence page records where test fixtures polluted such logs).
- `lib/kill-option-order.py`: called by `block-dangerous.sh`. Finds a `pkill`, `pgrep` or `killall` whose option comes after its pattern, which the BSD tools read as more patterns, so a kill meant to be narrow matches far more processes.
- `lib/pg-secret.sh`: the shared check for a Postgres connection URL that holds a real password. It exists so the two secret scanners cannot drift apart.
- `lib/run-advisory.sh`: the launcher the settings put in front of every warn-only shell hook on prompt submit, before a tool call and at turn end. It turns a hook's exit 2, which is bash's code for a syntax error and the harness's code for a block, into a non-blocking 1, logs the event, and leaves a marker that `session-start.sh` names at every session start until the hook is fixed. Hooks that block on purpose never run through it.
- `lib/warn-emit.sh`: the shared helper that lets a warn-only hook's message reach the model rather than vanishing into stderr.
- `fixtures/skill-memory-dense.md`: a synthetic skill memory file of long lines, so that a short line window still exceeds the one-read byte limit. The hook test suite uses it for the bounded-read arm of `warn-large-tracker-read.sh`.
- `fixtures/skill-memory-oversized.md`: a synthetic skill memory file of about 61 KB, just past the size ceiling, that the hook test suite copies in to exercise the size and read guards.
- `fixtures/skill-memory-small.md`: a tiny skill memory file the hook test suite uses as input.

## `.claude/rules/`

There are 9 rule files. The vendor's memory page says a rule file with a `paths:` header loads when Claude reads, writes or edits a matching file; the source project found that a write which creates the file does not load it, which is why `write-scope-inject.sh` (above) names the matching rule files for a new file. The others load into every turn.

- `bash-environment.md` (always loaded): measured facts about the shell and the harness's shell tool. Each rule is a way a command appears to succeed while doing nothing.
- `migrations.md` (always loaded): database migration rules. Each rule is a way a migration that looks applied, correct or complete is not.
- `session-cadence.md` (path-scoped to hooks, rules, orchestrator files, commands, the meta skill, scripts and git hooks): how to propose a guard, count its occurrences, promote it from warn to block, and read its fires.
- `typescript.md` (path-scoped to source, scripts, tests and config files): TypeScript conventions, and the ways `tsc --noEmit` passes while checking nothing.
- `nextjs.md` (path-scoped to the app directory and the Next.js config): App Router rules for server and client components, data fetching, route handlers, metadata, locale routing and build caches.
- `tests-unit.md` (path-scoped to the unit test tiers): mocks, isolation, coverage claims, the Vitest runner, mutation testing and fixture design.
- `tests-e2e.md` (path-scoped to the end-to-end tests): uploads and hydration, waiting, locators, seeds, and how to read the runner.
- `active-recall.md` (parked): a trigger-to-action lookup table. It is scoped to a rules archive the copy does not ship, so it never loads in practice.
- `behavioral-anti-patterns.md` (parked): a catalogue of non-negotiable rules, each with the excuses used to bypass it. It is parked the same way as `active-recall.md`.

## `.claude/orchestrator/`

There are 4 files. They hold rules that only the main session can act on, kept out of every sub-agent's context.

- `conventions.md`: dispatch, response format and event-arrival conventions for the main session, the command index, and the trigger-index rows that `hooks/trigger-index-match.sh` must be kept in sync with by hand. `hooks/orchestrator-inject.sh` delivers it at session start; the shipped settings wire it.
- `session-doctrine.md`: main-session rules for attributing work to peer sessions, certifying a wrap, questions left open for you, reading peer-state labels, rolling memory shards, the dispatch memory guard, counting and marking mail, and naming which session made a commit. `hooks/orchestrator-inject.sh` delivers it at session start, after `conventions.md`.
- `commit-doctrine.md`: how to commit safely on a worktree that other sessions share. It covers commit verbs, pathspecs and splitting structural from behavioural changes. `hooks/commit-doctrine-inject.sh` delivers it on the first commit-shaped shell command of each context window; the shipped settings wire it.
- `active-recall-orchestrator.md`: the main-session trigger table that `hooks/band-o-inject.sh` injects every turn while that hook is switched on.

## `.claude/commands/`

There are 5 files.

- `expert-review.md`: a redirect to the expert-review skill.
- `expert-audit.md`: a deprecated alias that runs `external-audit.md` with the same subject.
- `external-audit.md`: a calibration panel that audits the agent system against experts who each model an outside agent system, to find gaps, over-engineering and strengths worth keeping, and to queue the patterns worth adopting. Those outside-system experts are not in this copy, so the panel needs your own before it can run.
- `status.md`: a quick project status procedure covering git status, uncommitted work and recent commits.
- `verify.md`: a verification loop to run before a commit: type check, lint, a security scan, a diff review, and the changed-scope end-to-end tests when the diff touches the interface or its tests, then a pass/fail report.

## `.claude/templates/`

There are 8 files: `audit-finding.md`, `feature-spec.md`, `expert-panel-brief.md`, `expert-relaunch-api-500.md`, `flow-audit-report.md`, `final-audit-checklist.md`, `migration-plan.md`, and `e2e-debug-spec.ts`. `expert-relaunch-api-500.md` is the brief for re-running one panel expert whose answer an API error cut off: it hands that expert the other experts' findings, so it fills the gap instead of starting over. `e2e-debug-spec.ts` is a disposable Playwright spec for diagnosing a failing end-to-end test.

## `.claude/docs/`

There are 3 files.

- `architecture.md`: the long-form architecture reference. It covers foundations, primitives, patterns, a comparison with other systems, and maintenance discipline.
- `architecture-overview.md`: the short version: the core mental model, the primitives, and worked examples.
- `state.md`: the system's current health and known failure modes, curated by hand.

## `.claude/traps/`

There is 1 file.

- `shell-traps.md`: shell traps keyed by command fragments. `hooks/shell-trap-inject.sh` matches each shell command against the keys and injects only the matching entries, so the table never sits in context as a whole. The shipped settings wire it.

## `scripts/`

There are 100 files at the top level. Each line below comes from the script's header comment or docstring.

**Commit and shared-worktree safety**
- `safe-commit.sh`: stages, gates and commits on a shared worktree. It refuses and never repairs.
- `private-index-commit.sh`: commits declared paths through a private git index. It uses a compare-and-swap that fails rather than overwrite a peer's commit.
- `shared-commit-gate.mjs`: before committing a file that peers also write, asks whether the commit holds a deletion you cannot account for.
- `staged-parse-check.mjs`: a syntax-only parse gate over the blobs being committed, not the working tree.
- `stage-own-hunks.mjs`: stages only your own changed hunks of a file another session is also editing, chosen by text keys you pass, and never touches the worktree. Its `--expect` count refuses when the kept hunks add or remove a different number of lines than your edit did.
- `subagent-commit-scan.py`: scans sub-agent transcripts for a commit, stage or push verb run at command position, since sub-agents never commit. Read-only; it exits 1 on any hit so a caller can gate on it.

**Always-loaded corpus and memory budgets**
- `check-band-budget.mjs`: the byte budget for the always-loaded instruction band.
- `band-ratchet.json`: the ratchet state `check-band-budget.mjs` reads: the lowest band total recorded, the margin, and a history of every move. The tool only ever lowers it; a raise is a hand edit with a history entry, and the tool refuses a raise whose entry quotes no approval.
- `band-directive-preservation.mjs`: when the band is compressed, checks that directives (backticked tokens, bold spans, citations) survive. Its header warns that it cannot see a dropped hedge.
- `band-growth-decomposition.mjs`: splits every band commit's byte change into growth and cuts and reports the two separately, so a standing policy can rest on the per-commit growth rate instead of a net level that depends on the window chosen.
- `band-overlap.mjs`: intersects the lesson numbers cited by the two always-loaded recall tables, `.claude/rules/active-recall.md` and its main-session counterpart in `.claude/orchestrator/`. Its output is a candidate list for hand review, never a saving. In this copy both tables carry no lesson numbers, so its self-test's live-corpus control fails until your own tables cite some.
- `band-o-digest-metrics.py`: prints the live metrics of the main-session band's digest by running the injecting hook's own digest builder, not a copy of it. `--log` adds the digest's health rate, and it exits non-zero rather than print a number when the hook's structure has changed.
- `band-o-echo-scan.py`: checks whether a session opened by emitting an invented band-shaped rules document instead of running the typed command. It reads only each session's first two replies and counts a rendered chunk-boundary marker, never a bare mention.
- `memory-tier-split.mjs`: splits an oversized expert memory file into a hot file and a cold archive.
- `rules-tier-split.mjs`: splits the meta skill's rules file, or with `--target flows` the flow register, into a router and section shards.
- `watch-tier-retire-sweep.mjs`: reads the `retire-if:` date on every row of the meta skill's watch-tier register and, with `--apply`, moves the due rows to its archive. The default is a read-only check, and rows it cannot classify are reported rather than skipped.
- `check-lesson-numbers.mjs`: a hard gate against a duplicate or reused number in the meta lesson ledger.
- `lesson-mint.mjs`: allocates the next lesson number on a shared ledger without collisions. Each mint is one atomic append to a state file, and the number is the line the append landed on. It and its self-test need your own lesson ledger, the meta skill's memory files, which this copy does not ship.
- `l-ref-drift-detect.mjs`: flags a lesson-number reference whose inline topic tag no longer agrees with that lesson's title in the meta lesson ledger.
- `tag-l-refs.mjs`: adds the canonical topic tag to bare lesson-number references across `.claude/`, skipping code blocks, inline code, frontmatter and the ledger's own headings, so the drift check above has tags to verify.
- `gloss-span-census.py`: counts lesson-number glosses inside inline code spans across the files at a git ref.
- `architecture-counts.mjs`: the single source for the count claims in `architecture.md`. It can check, list or fix them.
- `rules-trigger-firerate.mjs`: measures how often the trigger phrases in the always-loaded rule files actually appear in session transcripts over a window, to find triggers that never fire.
- `memory-graph-check.mjs`: resolves the `[[name]]` links between your own project memory files, reports dangling links and files nothing links to, and builds the reverse index. Warn-mode by default; `--strict` exits 1.
- `setup-project-memory.sh`: symlinks the harness's per-project memory location to `.claude/project-memory/` in your own repository, so project memory is versioned with the code. Idempotent; run it after a fresh clone or on a new machine.

**Skills, agents and lint**
- `skill-lint.mjs`: quality checks across the skills, such as an empty description, a missing trigger phrase, an oversized skill, or an orphan reference.
- `generate-expert-agents.mjs`: generates the expert agent definitions from the skills. Its `--check` mode compares them with disk and writes nothing.
- `expert-checks.mjs`: reads the skills' `checks:` and `applies_when:` frontmatter and, for a list of changed paths or a diff, suggests the experts and owned checks that apply. Advisory only; it never dispatches anyone.
- `agent-memory-load-audit.mjs`: reads the dispatch transcripts to find out whether each sub-agent actually read its own memory file in full.
- `agent-memory-brief-split.mjs`: tests whether a dispatch brief that names the agent's own memory path predicts that the agent reads it, over the transcript corpus (`--corpus`) or over the nudge hook's fire log (`--ledger`).
- `section-cite-check.mjs`: finds section citations in the rule, skill and doctrine files (a `<file>.md` § heading) that point at a heading the cited file no longer holds. Read-only; it never edits a file.
- `external-staleness-check.mjs`: a freshness gate for your own external-system expert skills. It grades each by the age of its last fetch and of its last deep re-catalogue, and `--strict` exits 1 when any is stale.

**Hook test suites**
- `smoke-test-hooks.sh`: the hook smoke suite. It runs a firing payload and a safe payload against each hook and checks the settings wiring.
- `smoke-assert-lint.mjs`: finds self-grading assertions in that suite, which can never fail.
- `smoke-mutation-matrix.sh`: mutates each hook to find out which assertions can actually fail.
- `smoke-payload-matrix.sh`: drives the block-mode security hooks with an adversarial input corpus, to show which inputs they actually catch.
- `smoke-test-session-mail.sh`: the test suite for the session-mail engine.
- `keep-warm-gate-test.py`: behavioural tests for two keep-warm hooks, each run as a subprocess against a throwaway state directory and a synthetic transcript. The smoke suite calls it.
- `auto-precompact-trigger-test.py`: behavioural tests for `auto-precompact-trigger.py`, run against the real hook file in a subprocess, never a copy of its logic, with a throwaway state directory and synthetic transcripts. The smoke suite calls it.
- `grep-blowup-repro.sh`: reproduces the grep blow-up hook's shape check against the command in `grep-blowup-fixture.txt`, taking its patterns from the hook itself rather than a retyped copy.
- `grep-blowup-design-compare.sh`: compares two candidate fixes for a false positive in that check against the labelled rows of `grep-blowup-cases.txt`. A design passes only if it matches the expected verdict on every row.
- `grep-blowup-ledger-replay.sh`: replays every denial in your own grep blow-up fire log through a candidate fix and counts how many it would now let through.

**Sessions, mail and review**
- `session-manifest.py`: writes and reads session manifests, checks for overlap with peer sessions, and hosts the session-mail engine.
- `session_status.py`: the single importable module that decides whether a session is exited, wrapped or active.
- `session-lifecycle.py`: the "wrapped" and "exited" session markers.
- `session-labels.py`: lists the commits this session made, reading all three ways a session labels them: the short session trailer, the remote-session link trailer, and a subject scope ending in the session id.
- `claude-main.sh`: launches an interactive main session with the orchestrator doctrine in the system prompt instead of the first message, so it is read from the prompt cache across sessions and after a compaction. Non-interactive runs pass straight through.
- `session-cache-usage.py`: reports where this project's sessions spend prompt-cache tokens: totals, full-prefix rewrites by cause, the bytes the hooks append, and what is delivered before the first request. Read-only.
- `post-compact-deferral.py`: decides whether a context compaction has actually applied since the last recovery.
- `post-compact-recovery-index.py`: an incremental index for the post-compaction recovery. It caches how far it has read the transcript so each run reads only what is new, and answers whether the window a compaction removed held any user messages.
- `fleet-board.py`: backs `/board` and `/peers --board`: one read-only card per open session (alive, lifecycle, subject, last commit, review loops, holds, plan currency), every cell derived on each render and nothing stored. Liveness comes from `claude agents --json`; review loops and holds come from the mail store, so they are floors.
- `parallel-session-scan.py`: collects peer-session context to inject into expert-review briefs.
- `queued-directive-residue-scan.py`: finds user messages that were queued but never reached a turn.
- `orphaned-prompt-scan.py`: finds user messages that arrived as ordinary typed records and never got an answer, which the queue scan above cannot see. It prints a worklist, not a count.
- `meta-corrections-scan.py`: finds the moments in session transcripts where you corrected the assistant.
- `calibration-score.mjs`: scores over-caution and under-caution together from your own corrections registry and audit logs, weighting a confident wrong claim more heavily. Report-only; its header forbids feeding the score into any agent prompt.
- `extract-closer-baseline.py`: snapshots the closing summaries sessions wrote to you, from the rolling transcript window, before a legibility fix ships, so the fix has a baseline. It does not grade them; a fresh-context agent does. Its self-test needs your own session transcripts, under the `<project-key>` path you fill in.
- `readonly-brief-compliance.py`: checks after the fact, from their own transcripts, whether sub-agents dispatched with a read-only brief wrote to the repository.
- `mail-stats.py`: retrospective analysis of cross-session mail: read rate, unread mail split by live and exited recipients, read latency, volume, and the sender-to-recipient graph.
- `fleet-mode-a-health.mjs`: computes the health gates for one fleet-inquiry run from the mail event log and the message bodies, never from the lead session's own account of the run.
- `historical-collision-scan.py`: a one-time forensic scan for past clobbers between parallel sessions. For each pair of overlapping sessions it flags commits close together in time that touch the same coordination file, for triage by hand.
- `review-request-closure-scan.mjs`: hub side. Lists the review requests the hub has not answered.
- `review-verdict-disposition-scan.mjs`: requester side. Lists review findings that have no disposition yet.
- `review-queue.py`: derives the review hub's status line and queue table from the mail store on every run. It reads mail only, so every count it prints is a floor.
- `hub-open-promises.py`: lists what the review hub said it would do in its own outbound mail and has not yet done.
- `hub-unfinished-loops.py`: for each peer, asks whether their newest message to the hub is newer than the hub's newest message to them. That catches loops a commit-keyed scan reads as closed; run it alongside that scan.
- `hub-stale-request-poll.sh`: runs as a persistent monitor for the review hub and speaks only when a review request has stayed open past a threshold, 25 minutes by default. It is silent otherwise.
- `hub-usage-watch.py`: the usage watch behind `/review-hub --pause --when usage>=N`. The review hub arms it as a monitor; it reads the status line's state file, prints one line when the five-hour usage share reaches the threshold, and, in resume mode, one line once that limit has reset. Read-only.
- `hub-owner-rulings-scan.py`: collects your messages from every session's transcript, so a ruling typed into a peer session reaches the hub's queue. It prints a worklist to read, never a verdict.
- `summary-plan-sync.mjs`: rewrites the derived-state block of the session working plan, and nothing else in it.
- `summary-owner-predicate-check.py`: a regression test for the rule that decides which open tracker rows belong to a session.
- `wrap-reconcile.mjs`: works out from the transcript and git whether the end-of-session wrap actually finished.
- `git-story-closure.mjs`: at wrap time, classifies the git state (uncommitted, unpushed, an unrecorded migration) from ground truth, so the wrap summary says which loose ends were chosen. Warn-mode; it never blocks the wrap.
- `wrap-preflight.py`: measures out-of-memory risk before a wrap deep-pass spawns agents (transcript size, slicing, free memory, resident sessions) and prints GO, CAUTION or ABORT. Read-only.
- `memguard-recalibrate.py`: recalibrates the agent-dispatch memory guard, its threshold in the settings and its deny text in the hook. It writes nothing until every check on both files has passed; `--check` previews.
- `statusline.py`: a harness status line showing the prompt-cache countdown, context fill, plan usage and sub-agent count. Its Fable weekly row needs a lookup that reads your Claude Code login token, so it is off unless you turn it on (the start page says how).
- `limit-recovery.py`: finds this session's sub-agents that died at an API usage limit, decides for each whether to resume it, wait for its model's reset or seat a fresh agent over its transcript, and writes the digest a fresh agent takes over from.
- `promote-review-coverage.mjs`: lists the commits in a promote range that were never sent for review, never dispositioned, or held. With `--refuse` it exits 4 unless your go-ahead names each refusing commit and every reason; `/promote` runs it before asking to merge and again inside the merge call.

**Trackers and audits**
- `tracker-list.mjs`: renders the per-group audit history of the three audit trackers.
- `audit-tier-drift-check.mjs`: flags tracker rows where an audit demonstrably ran but the row's compact audit-tiers token was never stamped. It never edits; `--strict` exits 1.
- `backfill-audit-tiers.mjs`: a one-shot that seeded the audit-tiers column into the three audit trackers. It is kept only to seed a new tracker or to dry-run a drift check, and its header says not to run it otherwise.
- `backlog-tracker-home-check.mjs`: checks that every ranked backlog entry points at an audit-tracker home, and reports proposed new slots separately. It exits 1 on an entry with no home.
- `defer-trigger-scan.py`: evaluates the revisit triggers on deferred tracker items and surfaces those whose condition is now true. It never edits the tracker.
- `defer-loc-fire-triage.mjs`: replays every line ever added to your own task list through the deferral-estimate hook's current grammar and a proposed one, and labels the hook's archived fires as true or false positives. Read-only.
- `post-deploy-check-sweep.py`: for the post-deploy verification step, reports the `post-deploy-check:` fields in your own task list together with each owning row's checkbox, so a check on a closed row is not handed over as outstanding work.
- `audit-sizing-floor.mjs`: computes the minimum verification effort required to close a flow or feature audit.
- `audit-floor-check.mjs`: after the fact, flags any logged audit whose recorded mode or panel size fell below the floor its stakes require. Read-only; the meta self-audit runs it.
- `audit-yield-metrics.mjs`: prints the deciders and the kill-rule verdict for an audit panel's second, deeper pass, from the two audit ledgers. Advisory; it always exits 0.
- `surface-register-drift.mjs`: reconciles your own surface-audit register. It flags a row whose lens vector disagrees with the coverage matrix, a surface missing from either, and a build item named in a row that no tracker mentions.
- `plans-ruling-scan.py`: flags ruling-shaped lines in plan documents that have no counterpart in your own decisions log. Its header says it is unwired because it missed every planted ruling at real scale while its own self-test passed; read that header before wiring it.
- `code-hotspot-scan.sh`: five code-hotspot signals (size times churn, coupling, untested server actions, schema drift, major-version staleness) for expert-review's code-corpus mode.
- `adp-cycle-scan.mjs`: an import-cycle detector over the `src/` import graph. Its header calls it a throwaway.

**Product tooling** (written for the application's stack; adapt or drop)
- `integration-test.sh`: the local integration test runner. It starts a fresh Postgres, applies migrations, runs the tests and tears everything down.
- `run-migration.mjs`: applies exactly one committed migration file and exits. It has a `--reapply` flag.
- `run-changed-e2e.sh`: picks the end-to-end specs affected since a base ref and hands them to an isolation wrapper that the copy does not ship.
- `focus-visible-staged-check.sh`: an accessibility gate over a unified diff. It flags every added interactive tag that has a hover style and no keyboard-focus style, and was moved out of the pre-push hook, which the copy does not ship, so the smoke suite can run its self-test.
- `deploy-env-drift.mjs`: read-only. Asks whether every production environment value is live or still waiting for a redeploy.

**Fixtures**
- `grep-blowup-cases.txt`: twelve labelled cases for the grep blow-up hook's shape check, six false positives and six true positives, which `grep-blowup-design-compare.sh` reads.
- `grep-blowup-fixture.txt`: one command line that the shape check wrongly flagged, which `grep-blowup-repro.sh` reads.
- `grep-blowup-fixture-positive.txt`: one grep command line with a bounded-window alternation, the shape that a grep blow-up check looks for.

## `scripts/lib/`

There are 13 files.

- `is-main.mjs`: answers "was this module the entry point?" correctly through a symlink. The naive check silently runs nothing.
- `project-key.mjs`: the harness's per-project directory name, under which it keeps a project's transcripts and memory, derived one way for every script that needs it.
- `tracker-shards.mjs`: resolves a tracker to the files that hold its rows, whether or not the tracker has been split into shards.
- `review-ledger.mjs`: the one parser for the review ledger, shared by `summary-plan-sync.mjs` and `review-request-closure-scan.mjs`. The newest row for a commit wins, classified on the row's leading disposition.
- `skill-overrides-pairing.mjs`: the one home for the pairing between expert agents and the skill overrides in settings.
- `hooks-dirt-fingerprint.sh`: one hash of the uncommitted state under `.claude/hooks/`. The mutation matrix uses it to show that its run left the hooks as it found them.
- `prepush-l3-verdict.sh`: the hook-liveness verdict that the pre-push git hook sources. The pre-push hook itself does not ship.
- `hook-liveness-record.sh`: saved hook-liveness results, each keyed by the git ids of the hook, its smoke suite, the mutation matrix and the shared hook code, so a push that changes more than five hooks can be judged on each hook's own saved verdict; one changed byte in any of them voids the record. `smoke-mutation-matrix.sh --record` writes the records and `prepush-l3-verdict.sh` reads them; the pre-push hook that sources it does not ship.
- `predeploy-lint-verdict.sh`: the disposition of the pre-deploy lint-error gate, which refuses when lint reports errors or fails to run. The smoke suite drives its branches with fixture logs; the pre-deploy check that sources it does not ship.
- `predeploy-test-verdict.sh`: one verdict for a test run, PASS, FAIL or NOSUMMARY, taken from both its exit code and its summary lines. It is sourced by the same pre-deploy check, which does not ship.
- `migration-record.mjs`: one predicate, asking whether a commit subject records a migration as applied to both databases. Its two consumers, a migration reconciler and a promotion gate, are not in this copy.
- `migration-review-gate.mjs`: the migration review gate. An apply to a shared database needs a committed approving review record, with a `Reviewed-by:` line, for the commit that last changed the file, and your words on top for a destructive file; `run-migration.mjs` calls it before it connects.
- `wrap-reconcile-smoke-skip.mjs`: decides which `wrap-reconcile.mjs` probes a smoke fixture may skip. A skip list is honoured only for a fixture session id, so it cannot reach a real wrap, and every skipped probe is reported.

## `scripts/probes/`

There are 5 files, all under `skill-lint-silent-pass/`, from one investigation into whether `skill-lint.mjs` can pass silently.

- `rig.mjs`: runs the real `skill-lint.mjs` against a minimal fixture tree, with a positive control beside every silent arm.
- `stub-architecture-counts.mjs`: a stand-in for `architecture-counts.mjs` that the rig runs instead. It prints the real script's output shape for each kind of drift, so the probe tests skill-lint's parser against that vocabulary.
- `probe-corpus-drift.mjs`: checks the corpus routes behind skill-lint's regex-based checks.
- `telemetry-unparsed-classes.py` and `telemetry-commit-correlation.py`: read the drift-check log. They fail without it.

## `scripts/band/`

There are 4 files, the tools from one compression pass over the always-loaded rules. Nothing wires them.

- `README.md`: what each of the three tools answers, why they were kept, and the defect in the directive guard's bold-span matching that `blockcheck.py` compensates for.
- `blockcheck.py`: the parity pre-check for `band-directive-preservation.mjs`. Given a line swap, it returns the anchors the guard would stop extracting from untouched lines of the same block, which the guard would then report as phantom losses.
- `displace.py`: performs one displacement, copying the original text verbatim into its archive and then replacing it in the live rules file. It writes the archive first, both writes are atomic, and it runs `blockcheck.py` before every write.
- `narrative-mass.py`: gives an upper bound on the bytes of incident narrative in the always-loaded rules and entry files, by flagging sentences that carry a date, a commit, a count or a retraction.

## `scripts/fixtures/`

There is 1 file.

- `hooks/corpse-block-push.sh`: a deliberately bypassable variant of a push-blocking hook. The payload harness's self-test runs it to prove the harness can report a failure.

## `.githooks/`

There are 2 files.

- `README.md`: explains that the git hooks live in `.githooks/`, are wired through `core.hooksPath` when dependencies are installed, and go silent if that setting drifts. It also describes the pre-push and pre-commit gates. The pre-commit hook ships; the pre-push hook does not.
- `pre-commit`: the commit-time gate, warn-only in every arm. It warns when staged skill memory shards disagree with their router, typechecks staged TypeScript outside `tests/`, and runs `scripts/skill-lint.mjs` when skill or other `.claude/` files are staged. Each arm has its own skip variable.

## Root files and `docs/`

These 30 files sit at the root of the copy (6) and under `docs/` (24); the table at the top does not count them. They are most of the 31 files written for the copy rather than taken from the source project: the six root files below, `.claude/.gitignore`, the 8 pages under `docs/`, the 5 starters and the 11 images.

- `README.md`: the entry page for the copy.
- `LICENSE`: the copy's licence.
- `NOTICE`: the copy's top-level notice.
- `CONTRIBUTING.md`: how to contribute.
- `CODEOWNERS`: who reviews which paths.
- `TRADEMARK.md`: how the name may be used.
- `docs/start-a-new-project.md`: the start page: what you are taking, what you supply, the first run, and how to begin.
- `docs/evidence.md`: the evidence table, showing for each mechanism family what was measured, what the measurement found, and what was not measured.
- `docs/repository-map.md`: this page.
- `docs/beside-native-features.md`: each mechanism beside the harness's native feature for the same job, and whether that feature replaces it, overlaps it or is what it builds on.
- `docs/where-the-ideas-came-from.md`: the credits: what was adopted from other projects and when, what it became here, and what was built here.
- `docs/a-working-day.md`: a day of work once Anja is in your project: how a session starts and ends, asking for a review and using what comes back, what you decide yourself, what the guards do without being asked, and what changes when a session grows long or a second one joins.
- `docs/saving-the-cache.md`: one cost, the prompt cache: what loses it, what it costs to write it again, and the habits and commands that keep it.
- `docs/github-settings.md`: the repository settings on GitHub.
- `docs/starters/`: four starter registers (critical flows, feature audits, surface audits, the ops register) in the shape the tracker scripts parse, for a project that wants the tracking pattern. Beside them, `CLAUDE.starter.md`: a neutral `CLAUDE.md` holding the table of which rule files load when, built from the copy's own rule files, for you to copy to your root and fill in.
- `docs/images/`: ten diagrams used by the README and the pages above, and the logo the README opens with.

## What you supply

The start page's [What you supply](start-a-new-project.md#what-you-supply) lists every file your own project provides and what in the copy reads it.
