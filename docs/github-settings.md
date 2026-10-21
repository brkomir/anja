# Repository settings for a public copy

This page is about the repository you are reading; apply it to your own only if you want the same review rule. The rules this repository expects from its hosting are few, and they are set by hand in the repository's settings rather than by anything in the tree. This page is the click-path for GitHub; on another host, look for the same four protections under other names.

## Branch protection on `main` (a ruleset)

1. Open the repository on GitHub, then **Settings**, then under **Code, planning, and automation** choose **Rules** → **Rulesets**, then **New ruleset** → **New branch ruleset**. (The labels in these steps follow GitHub's documentation, its pages on creating rulesets for a repository and on the available rules for rulesets, as read on 2026-10-21; the screen may word some of them differently.)
2. Under **Ruleset name**, name it (for example `main`), and set the enforcement status to **Active**.
3. Under **Target branches**, **Add a target** → the default branch.
4. Under **Branch protections**, tick:
   - **Restrict deletions**.
   - **Block force pushes**.
   - **Require a pull request before merging**, with the required approvals set to **1**, **Dismiss stale pull request approvals when new commits are pushed** ticked (so an approval covers the commits that were approved and not ones pushed after it), review from code owners required, and **Require approval of the most recent reviewable push** ticked (so the last push is approved by someone other than whoever pushed it). The `CODEOWNERS` file at the repository root names the maintainer as owner of `.claude/hooks/`, `.claude/settings.json`, `.githooks/` and `scripts/`, so a contributor's change there waits for the maintainer's approval unless an admin merges it through the bypass in step 5. On your own copy, put your own handle in `CODEOWNERS` first ([the start page](start-a-new-project.md#what-to-replace-or-remove-after-copying) says why).
   - **Require status checks to pass before merging** (optional): once the smoke suite runs in your continuous integration, add its check here. To have the `Signed-off-by:` line the contributing guide asks for checked on every pull request, install a GitHub App that checks Developer Certificate of Origin sign-offs and add its check here too.
5. Under **Bypass list**, add **Repository admin** with **For pull requests only**, so a pull request the maintainer opened can be merged without an approval, which GitHub never lets an author give, while a direct push to `main` is still refused. The bypass belongs to whoever holds the admin role, not to the author of a pull request: an admin can merge any pull request through it, a contributor's included. Keep the admin role to the maintainer, and merge a contributor's pull request only once its approval has landed. If you push a commit to a contributor's branch yourself, the ruleset no longer counts your approval of it; ask the contributor to push the change instead.
6. **Create**. From here on nothing reaches `main` without a pull request, and only the maintainer's bypass, as repository admin, can merge one without an approval; direct pushes and force pushes are refused.

Done looks like (as the GitHub screens show it; the documentation does not describe them): pushing a commit straight to `main` is rejected with a message naming the ruleset, and a pull request shows that a review is required until an approval lands.

## The bypass is not a review

The ruleset and the project's review are two different things. The ruleset is GitHub's: it decides whether a pull request can merge. The review is the project's own process, set out in [the contributing guide](../CONTRIBUTING.md#builder-is-not-breaker): someone, or an agent, that did not write the change reads it, runs the smoke suite and names each finding at a file and line. GitHub records an approval; it does not record or check that review.

So a merge through the admin bypass is not independent review. It lets the maintainer merge without meeting this ruleset's merge requirements, the approval and any status check added in step 4 alike, and it does nothing more: it neither performs the project's review nor shows that one happened. The contributing guide still asks for that review on the maintainer's own pull requests, and it happens outside GitHub, through the project's own commands (`/review-hub`, `/expert-review --code`), not through this ruleset. On a contributor's pull request the approval the ruleset requires comes after that review, and for the paths in `CODEOWNERS` it must be the maintainer's.

## Why these and nothing more

The system's own guards run inside each session (the hooks) and at each commit (the pre-commit git hook the copy ships; a `pre-push` hook is yours to write). The hosting rules only make sure a change reaches `main` through a pull request, cannot be force-pushed over or deleted, and, unless the maintainer uses the bypass, waits for an approval.
