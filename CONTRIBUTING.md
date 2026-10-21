# Contributing

This page says how to send a change and how it is reviewed. Contributions are welcome under a few rules that keep the system reviewable. If you are new to the copy, [the README](README.md) says what the system is and [the repository map](docs/repository-map.md) says what each file holds.

## Sign your commits (DCO)

Every commit carries a `Signed-off-by:` line (`git commit -s`), which is your statement under the [Developer Certificate of Origin](https://developercertificate.org/) that you have the right to submit the work under this repository's licence. There is no contributor licence agreement. Section 5 of the Apache License, Version 2.0 governs what you send: unless you say otherwise, a contribution you intentionally submit for inclusion is licensed under the same terms as the project, with no additional terms.

## Builder is not breaker

A change is reviewed by someone who did not write it. The review reads the diff for what it claims and for what it breaks, runs the smoke suite (`scripts/smoke-test-hooks.sh`) and the self-tests of the scripts it touches inside a throwaway clone or container (see the section on reviewing a pull request safely), and names each finding at a file and line. A review that only re-states the pull request's description is not a review. The same rule holds for a change written with an agent: the agent that wrote it does not review it.

## Hooks get the strictest review

Files under `.claude/hooks/`, the hook wiring in `.claude/settings.json` and the scripts under `scripts/` that the hooks and the status line call run on every tool call, prompt or status-line refresh, and the git hooks a project wires under `.githooks/` (this copy ships that directory's readme and its pre-commit hook) run on every commit and push, so a wrong line in any of them fails every session at once. A change to any of them is reviewed like any other change, and the one approval the repository requires must come from the maintainer as code owner (the `CODEOWNERS` file lists `.claude/hooks/`, `.claude/settings.json`, `.githooks/` and the whole of `scripts/`); it also comes with a smoke-test arm that fires on the behaviour it adds and a control arm that stays quiet. A new guard starts in warn mode; it is promoted to block mode only after its logged fires have been read.

## Reviewing a pull request safely

A contributor's branch is code that runs on your machine. Its hooks run as soon as its files are on disk where Claude Code is running: the harness picks up changes to `.claude/settings.json` through its file watcher, and reads each hook script again on every call. The trust prompt does not stop this. Claude Code keys workspace trust on the repository's root, which covers every branch and worktree of it, so hooks that arrive in a repository you have already trusted run with no new prompt, and under `claude -p` or the Agent SDK a repository's hooks run with no prompt at all. Once `core.hooksPath` points at `.githooks`, the branch's pre-commit hook also runs on your next commit.

- Read a pull request without checking it out: with `gh pr diff <number>`, or on GitHub.
- Run its smoke suite and self-tests only in a throwaway clone or container that holds none of your credentials, or in continuous integration, never in the checkout you work in.
- To open Claude Code on a contributor's branch at all, start it with hooks off: `claude --settings '{"disableAllHooks": true}'`. Hooks off does not stop the branch's `CLAUDE.md`, rule, skill and agent files from loading as instructions, so read their diff before that session acts on anything.

## What a pull request carries

- One concern per pull request; a refactor and a behaviour change travel separately.
- A test or a smoke-test arm for every behaviour change, and the suite's pass and fail counts before and after. On the bare copy some arms are red by design, because they drive files the copy does not ship ([the start page](docs/start-a-new-project.md#first-run) explains them); a change must not add a red arm.
- No secrets, no credentials, no personal data, no business information of any project in fixtures or examples; a fixture that must look like a secret is assembled at run time (`scripts/smoke-test-hooks.sh` shows the form: the literal is written in two pieces and joined when the test runs).
- For a new rule or memory entry: the measurement it rests on, with its date, or a plain statement that it is a convention.

## Where discussion happens

Open an issue before a large change; the maintainer answers there. Nothing reaches the main branch without a pull request. A contributor's pull request also waits for an approval, which for the paths in `CODEOWNERS` must be the maintainer's. The maintainer's own pull requests can merge through an admin bypass of that approval and of any required status check; the bypass is not a review, and those changes are still reviewed as described under [Builder is not breaker](#builder-is-not-breaker). [The repository settings](docs/github-settings.md) set out the GitHub rules and how they differ from the review.
