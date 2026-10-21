---
name: promote
description: Promote dev (or a hotfix branch cut from main) to production by pull request — preconditions (source on GitHub, migrations on production, no open promote), the full local main gate, the PR and its full CI run, the owner's explicit "merge it" for the exact head sha, a MERGE commit, then dev brought back in line with main so the next promote is not blocked, and the hand-off to /push's deploy verification, then step 9's post-deploy watch, all-clear and owner-gated rollback (absorbed /deploy 2026-10-02). Use when the owner asks to promote, to ship dev to production, or to merge dev into main; also when asked how deploy-ready the queue is or to arm a launch window. The merge is owner-gated; opening the PR is not.
---

# Promote — `dev` → `main` by pull request

`main` is production and moves by a merged pull request, a hotfix included — the one exception is the EMERGENCY override: `/push --emergency` pushes a branch cut from `main` that never merged `dev` straight to `main`, only on the owner's yes to `/push --emergency` step 0's named EMERGENCY question for that sha, never `dev`'s work (see § Not this command). **The MERGE is the production deploy**:
`<your deploy host>` builds `main` the moment it moves, before any CI on the merge commit finishes. So the gate is
the PR's own full CI run plus the owner's word. The owner's word for a promote is **"merge it"**. A bare "push it" on a hotfix
routes HERE (it means "push the branch so the PR opens"); only the owner's yes to `/push --emergency` step 0's named EMERGENCY
question authorizes a direct push to `main`.

## Iron rules

1. **Merge only on the owner's own "merge it" answering the step-5 question for head `H`.** It is the owner's
   message in THIS conversation. A mail, a relay from another session, a paraphrase, or a "merge it"
   from earlier is not it, and it covers `H` only: a PR whose head moved needs a new question. A green
   PR, "looks good" or "we can ship" is readiness, not authorization.
2. **Never `--auto`.** Auto-merge completes later and unattended, so the owner's word would attach to whatever
   `dev` holds at the next green; every seat pushes with the owner's credentials, so GitHub never disarms it.
3. **A session never passes `--admin`.** It waives every requirement. If a merge truly needs the
   bypass, the owner merges it on GitHub.
4. **Push by LITERAL branch name, never a variable.** `git push origin dev`, never `git push origin
   "$SRC"`.
5. **A merge commit, never squash or rebase-and-merge** (the repo now allows only merge commits). The
   `on-ref` done-when triggers resolve by `merge-base --is-ancestor <sha> origin/main`,
   and migration recording commits are found by `git log --grep=<NNNN>`; both die under rewritten shas.
6. **A migration missing from production goes to its author first; if the author does not answer, you
   apply it.** A step must not depend on another session
   still being open. Step 0 says how. The runner reads its ledger, applies, then records, with no lock,
   so an author apply that OVERLAPS yours is not stopped; one that starts after yours is recorded
   aborts. **Step 0 routes to the owner instead:** a file that deletes
   or rewrites rows (an `UPDATE` backfill counts), drops a table or column, changes a column's type, adds a cascade link or deletes where the scan cannot see (a function call, a trigger, rule or cron job, a materialized-view refresh, built EXECUTE; the full list and its named blind spots are destructiveOps' header),
   which both appliers refuse without the owner's `--owner-destructive-yes` (`migrations.md` § A DESTRUCTIVE
   SHARED-DB OP NEEDS EXPLICIT OWNER AUTHORIZATION), or one carrying a gate ⚠ (READ it); and a file
   staging lacks goes to staging first, `<your database apply command for staging> <file>`, because
   `<your database apply command for production>` would otherwise record staging+prod. A REMOVAL-only migration is never applied before the deploy, by anyone. A file whose
   last commit has no APPROVING review on record goes to REVIEW, not to the owner: both appliers refuse
   it (§ NO APPROVING REVIEW ON RECORD, NO APPLY), so send that commit for `--code` and apply after the verdict.
7. **Opening the PR costs a full CI run** (166 job-minutes; the merge into
   `main` then runs the full set again, 184 — measured 2026-10-04). Open one only to merge it.
   ⛔ **"Only to merge it" is about INTENT, not permission: opening the PR is NOT owner-gated — only the
   MERGE is.** Once the push has landed and you
   mean to promote, open it (step 3), let CI run, and ask "merge it?" for the exact head (step 5). Do not
   stop before step 3 to ask whether to open it.
8. **The review gate refuses; only the owner's word passes it** — `PROMOTE_REVIEW_PROCEED` is set only on the owner's
   explicit "proceed" naming step 1's refusing list, to one `<sha>:<reasons>` entry for each commit the owner named, carrying
   the reasons the owner passed it for, each bound to its source (and one `unmeasured:<items>` entry naming each refusal that
   is not a commit the owner passed); a refusing commit outside it, or one with a reason or a source the owner did not pass, refuses
   by itself, and the gate re-runs under the same go at step 5 before it asks "merge it?" and inside step 6's merge
   call.

## Not this command

- **An EMERGENCY direct push of a hotfix branch to `main`** → `/push --emergency`, only on the owner's yes to its step-0 named question for that sha.
  `dev`'s work never takes a direct push, before or after the first promote.
- **A hotfix branch cut from `main` — this command's normal route for it, from its OWN `git worktree
  add`**, never by switching the shared checkout (that carries every peer's dirty file onto the hotfix
  branch and lands their next commits there). **Not until `main` has the `ci-gate` job:** check
  `git show origin/main:.github/workflows/test.yml | grep -c ci-gate`. While it reads 0, a PR from such
  a branch can never report the required `ci-gate (main)` check (a pull-request run uses the workflow at
  the PR's merge ref, which is `main`'s file) and sits BLOCKED; the owner merges it past the check
  or calls the emergency override. **The source check** — the branch was cut from `main` and
  never merged `dev`: no commit in `origin/main..<branch>` is on `origin/dev`, and there are no merges:
  `ODEV=$(git rev-parse --verify -q refs/remotes/origin/dev); [ "$(git rev-list --count origin/main..<branch>
  ${ODEV:+^$ODEV} ^refs/heads/dev)" = "$(git rev-list --count origin/main..<branch>)" ] && [ -z "$(git log
  origin/main..<branch> --merges --format=%h)" ]` (the `ODEV` form checks against the local `dev` alone
  while `dev` has never been pushed, as `/push` 0b does).
  Cut the branch by name: `git worktree add -b hotfix/<topic> <path> origin/main` (a bare `git worktree
  add` cuts from HEAD, the shared `dev`). ⛔ The old form (`merge-base` is its fork commit, no merges)
  PASSES `dev` ITSELF once `dev` has stayed linear since a promote, and a branch cut from `dev`
  (scratch repo); and `^origin/dev` without `^refs/heads/dev` passes `dev`'s UNPUSHED commits
  right after a promote merge, while `origin/dev` is contained in `origin/main` (7 arms).

## Process

Every step's commands run in ONE Bash call per step; shell variables do not survive between calls,
so each step re-derives what it needs. The source below is `dev`. **For a hotfix source**, first run
`/push` 0c in its worktree (packages and `.env.local`; without them `promote-precheck.sh` dies at config
load), and copy the shared checkout's `<your deploy host's project-link file>` into the worktree's `<your deploy host's project-link directory>` (a fresh
worktree has none, so `<your deploy host's CLI>` cannot find the project and step 2's production-variable check
reads `PROD-ENV: NOT-CHECKED`, which only warns; reasoned from the code, not yet
run on a real hotfix), then run every step from that worktree with each literal `dev` replaced by the branch name —
except step 0's migration gate, which runs from the shared checkout (the bullet under step 0).

### 0. Preconditions — read, never assume. Any failure stops the promote.

```bash
SRC=$(git branch --show-current)
case "$SRC" in ""|main) echo "STOP: /promote never runs from main or a detached HEAD"; exit 1;; esac
git fetch origin
git rev-parse --verify -q refs/remotes/origin/dev >/dev/null || echo "STOP: dev is not on GitHub"
git rev-list --left-right --count origin/dev...dev                 # "0 0" = GitHub has exactly your tip
git merge-base --is-ancestor origin/main dev && echo "dev contains main" || echo "STOP: dev lacks main's tip"
gh pr list --base main --head dev --state open --json number,url   # must be []
gh api "repos/{owner}/{repo}" --jq '{delete_branch_on_merge, allow_merge_commit}'   # false, true
gh api "repos/{owner}/{repo}/branches/main/protection" --jq '.required_status_checks' 2>&1
node scripts/promote-migration-gate.mjs --base origin/main --head dev --db
```

- **`dev` not on GitHub, or local ahead** → `git push origin dev` (literal), in its own background call
  as `/push` D2 runs it. A promote's own `dev` pushes are part of the owner's promote request.
  The pre-push LIGHT gate runs.
  The FIRST push of `dev` was put to the owner as a yes/no. If GitHub's
  `dev` is ever deleted, re-creating it is the same yes/no (the STOP lines in the blocks below).
- **`dev` lacks `main`'s tip** → bring it in line first (step 7's procedure); strict protection
  otherwise spends the full PR run and then sits BLOCKED. If what `main` carries is a REVERT of
  content `dev` holds (an emergency revert), ask `/push` 7b's keep-or-take question before step 7:
  step 7's hotfix path takes the revert onto `dev`, and it STOPs on a detected revert until the owner answers.
- **Hotfix source** → the migration gate line above runs from the SHARED checkout, WITHOUT `--db`,
  with `--head hotfix/<topic>` (`/push` 0b says why `--db` is wrong there).
- **`delete_branch_on_merge` true** → STOP; the merge would delete `dev` on GitHub.
- **Protection** — the target is `strict: true` with the one check `ci-gate (main)`. A 404 means nothing
  but you gates the merge; say so in step 5, never call such a merge "CI-gated".
- **Migration gate ✗** → STOP. For each failing file find who committed it:
  `git log --diff-filter=A --format='%h %s' -- <your migration file's path>`, then read the BODY
  (`git log -1 --format=%B <h> | grep -i 'Claude-Session:'` — a blank line before `Co-Authored-By`
  hides it from `%(trailers)`) and take the first 8 hex. A URL, no line, or several add-commits is
  UNRESOLVED. The adding commit names who COMMITTED the file, not necessarily who wrote it.
  **First, read the file** — iron rule 6's exclusions (destructive, a gate ⚠, missing
  from staging) go to the OWNER, never to the author-or-me route below; a file with no approving review
  on record goes for `--code` review first (iron rule 6), since both appliers refuse it.
  **Resolved author** → mail it: `<your database apply command for production> <file>` writes the record the gate reads. Check it is
  alive first (`python3 scripts/session-manifest.py who`); wait up to 10 minutes for its answer (a
  working default, not an owner number), and not at all if it is gone, or alive with its listener down
  (`kill -0 $(cat .claude/state/mail-listen-<sid8>.pid)` fails). **No answer, or UNRESOLVED** →
  apply it yourself with `<your database apply command for production> <file>` (iron rule 6), and in the SAME turn mail the author,
  when there is one, a de-queue notice (`migrations.md` § DE-QUEUE ANY PEER SESSION HOLDING THE SAME
  APPLY). Then re-run the gate. The gate's printed remedy says the same.

### 1. The full main gate, locally — and a fleet hold on `dev` pushes

`/push` § 1b's write-hold applies: ARM early, GO-QUIET for the run, and ask the fleet for **no `dev`
push until the ALL-CLEAR after the merge, or 3 hours, whichever comes first** (a push moves the PR head
and restarts its CI). The hold only saves CI restarts; `--match-head-commit` at step 6 is what protects
correctness, so a lapsed hold costs a re-run, never a wrong merge. Then:

```bash
O=<scratch>/promote-precheck.txt
# env -u: the precheck refuses (rc 2) while a SKIP_* variable its gate reads is set.
# Unset it for this one command.
env -u SKIP_BAND_BUDGET_CHECK scripts/promote-precheck.sh > "$O" 2>&1; RC=$?; cat "$O"; echo "rc=$RC"
H_PRE=$(sed -n 's/^promote-precheck: gating [^ ]* (\([0-9a-f]\{40\}\)).*/\1/p' "$O"); echo "H_PRE=$H_PRE"
```

`H_PRE` is the sha the precheck itself gated, read from its own `gating … (<sha>)` line — never a
`git rev-parse HEAD` run after it. It names the COMMIT, and since 2026-10-06 the precheck's hook gates a clean copy of it (tsc, unit and
build never see peers' uncommitted files; under `SKIP_PREPUSH_SNAPSHOT=1` they read the working tree as
before), so it certifies that sha itself — which is why a later sha is a different, ungated claim: `dev` takes a peer commit every ~90 seconds, and a sha read later
can be one the gate never checked. rc 0 with a 40-hex `H_PRE` ⇒ go on. rc 3 ⇒ "nothing to promote"
ONLY together with the precheck's own line saying so; rc 3 alone is not unique under `set -euo
pipefail`. Empty `H_PRE`, or anything else but rc 4 ⇒ fix first; the hook's code wins when both arms fail.

**rc 4 ⇒ the review gate REFUSED** — ONLY together with a `REVIEW-COVERAGE-GATE: REFUSED` line (the
precheck's precedence then says the hook and the migration gate passed). rc 4 beside any other
`REVIEW-COVERAGE-GATE` token is a hook or migration-gate failure (the hook runs under `set -euo pipefail`, so a
child's own rc reaches here raw, exactly as with rc 3): fix first, never ask the owner. A `REVIEW-COVERAGE-GATE:
REFUSED — nothing was measured` line is an instrument failure, not a verdict on commits: say so to the owner and
fix the measurement first when you can; the owner's go passes it through an `unmeasured:nothing` entry in it, since no sha can name it, and
the PROCEEDING line names the unmeasured range. Show
the owner the `REVIEW-COVERAGE-GATE` line and every refusing commit (its `REFUSES` line): short sha, date, the
`Claude-Session` trailer's 8-hex when present, and never sent past the grace (the hours its line prints, `REFUSAL_GRACE_HOURS`), or an uncleared verdict open
(CHANGES-REQUESTED, UNRESOLVED, ALTERNATIVE, REJECT(ED), SELF-RETRACTION, REFUTED, with no verified fold; v1.25) with its `NOT DISPOSED` reading and the Note-cell ledger line when the report names one, or HOLD open with the tracker row
or ledger row its line names (an open `HUB-HOLD-*` row in `todo.txt` or a newest-row HOLD in the
review ledger refuses any in-range commit, src/ or not; an unreadable `todo.txt` refuses too). Then STOP. The promote
continues only on the owner's explicit "proceed" naming that list (a bare "ok" to an unrelated question is not it); then
write the go to `<scratch>/promote-go.txt` and re-run this step as `PROMOTE_REVIEW_PROCEED="$(cat <scratch>/promote-go.txt)"
env -u SKIP_BAND_BUDGET_CHECK scripts/promote-precheck.sh > "$O" 2>&1; …`, the file holding the refusal's `GO FOR WHAT IS SHOWN` value cut to exactly the commits the owner named:
one `<sha>:<reasons>` entry per commit, its reasons joined by `+`, each with its source: `unsent`, `changes-requested:r<id>`
or `unresolved:r<id>`, and since v1.25 `alternative:r<id>`, `reject:r<id>`, `rejected:r<id>`, `self-retraction:r<id>`
or `refuted:r<id>` (one per uncleared verdict word, lowercased; the ledger row it reads, by its content id: 8 hex over the row's date, commit, verdict and mail
cells, plus its note cell only when another ledger row shares those four, so a note appended to that row keeps it
whatever its mail cell holds, a new verdict row changes it, and a corrected mail cell re-asks once), and one `hold:<source>` per
row holding it (the tracker row's full name, or the ledger HOLD row's `r<id>`) — so a second hold row or a newer verdict
is a reason the owner has not passed,
plus one `unmeasured:<items>` entry only if the owner passed a refusal that is not a commit, its items as the line prints them
(`nothing` for nothing measured, `todo` for an unreadable `todo.txt`, a hold row's name for a row naming no commit); the go names the commits and why the owner passed each. That
file is the go steps 5 and 6 read back, so they read exactly the value this run passed; empty it when step 1 passes
with no go, so a go from an earlier promote is never
read back (the re-run overwrites `$O`, and its PROCEEDING line prints the reasons as words, not as the go's tokens, so
after a compaction that file is the only copy). Read its `REVIEW-COVERAGE-GATE: PROCEEDING ON THE
OWNER'S GO` line, which lists every commit it passed with its reasons, and the new `H_PRE`, and quote the owner's words
in § Report. A refusing commit the owner did not name, such as one that appeared after the owner answered, and a named commit that has
gained a reason or a source since (passed as never sent, now also held; held by one row, now by two) refuse the re-run
by themselves, each with a
`NOT IN YOUR GO` line: show the owner those lines and the new `GO FOR WHAT IS SHOWN` line and ask again. A bare sha, an
unknown reason, the bare word `unmeasured` or an unknown item in its entry, and the old value `1` refuse with the
format: a `GO REFUSED` line, and `YOUR GO IS MALFORMED` on the token line. That is your transcription, not the owner's answer:
rebuild the go from the `GO FOR WHAT IS SHOWN` value cut to what the owner named and re-run, without asking the owner again; when the
run prints no `GO FOR WHAT IS SHOWN` line, nothing in the range refuses, so empty the file and re-run with the variable unset.
If the value copied from that line refuses again as malformed, the line cannot be fed back: a `HUB-HOLD-*` row name
carrying `+` or `,` splits the go, and no go can pass it. Stop and tell the owner which row; renaming it is the fix. Only a
refusal still standing once the go matches what the owner named goes back to the owner. `IN FLIGHT`
commits (never sent, inside the grace) refuse nothing and go into step 5's message.

A merge on GitHub fires no local hook, so this is the only place the pre-push main arms run for a
promote. If `origin/dev` is not `H_PRE`, push `dev` by name while its tip still IS `H_PRE`, so the PR
head is exactly what was certified — its own call, `run_in_background: true` (the hook's LIGHT gate runs
past the tool's foreground cap, `/push` D2), with the `H_PRE` you read in the `H_PRE=` line:

```bash
[ "$(git rev-parse dev)" = "<H_PRE>" ] || { echo "STOP: dev moved past H_PRE — re-run step 1 at the new tip"; exit 1; }
git push origin dev > <scratch>/dev-push.txt 2>&1; echo "rc=$?" >> <scratch>/dev-push.txt
```

Then `/push` D3's ancestry check on `H_PRE`, and in the same call `git fetch origin && [ "$(git rev-parse
origin/dev)" = "<H_PRE>" ]`: anything else means a commit rode along between the check and the push, so
re-run step 1 BEFORE step 3 opens the PR (step 5's head check catches it only after a full PR CI run). Never the `<H_PRE>:refs/heads/dev` refspec form: auto mode
denied it on the first real promote (2026-09-30, cause not isolated; the plain `git push origin dev`
passed later), the pre-push hook gates HEAD and the working tree, not the sha you name, and an empty paste
turns it into `:refs/heads/dev`, which DELETES `dev` on GitHub and closes the open promote PR.

### 2. What goes live besides code — `node scripts/deploy-env-drift.mjs --domain <your production domain>`

`DEPLOY-ENV: PENDING-REDEPLOY` lists production env values written since the last deploy; this merge
makes them live. Read the verdict token, never the exit code (rc 2 means nothing was measured).

Beside it, `npx tsx scripts/prod-env-presence.mts`: every variable the runtime registry marks as expected
in production must exist in `<your deploy host's production environment>`. `PROD-ENV: MISSING <names>` ⇒ STOP, this merge would
ship code that reads an absent variable; `PROD-ENV: NOT-CHECKED <reason>` (rc 2) means the `<your deploy host's CLI>` read
failed and nothing was measured; only `PROD-ENV: ALL-PRESENT` is a pass.
The full local gate (step 1) runs it too; read it here so the verdict is in front of you at step 3.

### 3. Open the PR

```bash
N=$(git rev-list --count origin/main..origin/dev)
gh pr create --base main --head dev --title "promote: dev → main ($N commits)" --body-file <file>
```

The body: the commit count, `H_PRE`, the migration gate's lines, the env var NAMES going live (never a
value), and one line per risky change area you know of.

### 4. Watch the PR's CI — arm it in the same turn, in the background

```bash
gh pr checks <n> --watch --required --interval 60 > <scratch>/promote-checks.txt 2>&1; echo "rc=$?" >> <scratch>/promote-checks.txt
```

(`run_in_background: true`; ~40-45 min on today's suite.) Then read the ONE verdict that decides:

```bash
V=$(gh pr checks <n> --json name,bucket --jq '[.[] | select(.name == "ci-gate (main)") | .bucket] | first // "absent"')
```

- `pass` → step 5.
- `pending` → wait.
- The watch itself exited rc≠0 with no checks reported ("no required checks reported", seen ~30 s after
  the PR opened on 2026-09-30) → the checks had not registered yet: wait 60 s, re-run the watch.
- `absent` → the check never reported: a hotfix PR before `main` has the job, or a conflicted PR, which
  gets no pull-request run. STOP and say which.
- empty, or any other value → `gh` errored or the shape changed; STOP and re-read, never treat it as
  `absent` or `pending`.
- `fail`, `cancel`, `skipping` → not green. Disposition each red job as `/push` § 6 does for a
  push-to-main run (whose code, known flake or new), fix on `dev`, push `dev`; the PR re-runs, and the
  certified head is now a new one, so go back to step 1.

### 5. Ask the owner — one message, only when `V` is `pass`, then stop

**Before the question, read the tracker for legs due before this merge**, because nothing else in this skill does: step 7b's
tracker scan runs only after the merge. Run `grep -n -i -E 'before (the )?(merge|promote)' todo.txt`, read
each OPEN row a hit belongs to, and put every leg that falls due at this promote into the message below as its own
question. The 2026-10-14 promote lost at least five such legs this way.

First the review gate again, at the PR head and under the SAME go step 1 passed with. CI took 10-30 minutes, and in
that window a hold, a CHANGES-REQUESTED verdict (the hub sends those with `signal: deploy-clear`, so the `DEPLOY-HOLD`
read below never lists one), a new reason on a commit the owner passed, or a new commit can land, and an `IN FLIGHT` commit can pass its grace and refuse
as never sent (a new commit moves the PR head, so the guard below sends you back to step 1). It is the coverage script
alone with the arguments `promote-precheck.sh` hands it (`--range <origin/main>..<head> --refuse`, the shared
checkout's review ledger and `todo.txt` by default), not the whole precheck:

```bash
H=$(gh pr view <n> --json headRefOid --jq .headRefOid)     # must equal H_PRE, else back to step 1
[ "$H" = "<H_PRE>" ] || { echo "STOP: the PR head $H is not H_PRE — back to step 1"; exit 1; }
git fetch -q origin main
R=<scratch>/promote-recheck.txt
PROMOTE_REVIEW_PROCEED="$(cat <scratch>/promote-go.txt)" PROMOTE_COVERAGE_VIA=promote-step5 node scripts/promote-review-coverage.mjs --range "$(git rev-parse origin/main)..$H" --refuse > "$R" 2>&1; RC=$?; cat "$R"; echo "rc=$RC"
```

The go is read straight from `<scratch>/promote-go.txt`, the value step 1's passing run wrote there, exactly as step 6
reads it: nothing is retyped, and an empty file (step 1 passed with no go) is no go. Never rebuild it from the PROCEEDING
line, which prints its reasons as words.
`PROMOTE_COVERAGE_VIA=promote-step5` files the fire row apart from the precheck's. rc 0 with a
`REVIEW-COVERAGE-GATE: PASS` or `REVIEW-COVERAGE-GATE: PROCEEDING ON THE OWNER'S GO` line ⇒ compose the message below,
quoting that line. rc 4 with a `REVIEW-COVERAGE-GATE: REFUSED` line ⇒ do NOT ask "merge it?", and read which refusal it
is, as at step 1: a `GO REFUSED` line (`YOUR GO IS MALFORMED`) means the file no longer holds what step 1 passed, so
rewrite it as step 1 builds it (empty, when the line says nothing in this range refuses) and re-run before you ask the owner anything; `REFUSED — nothing was measured` is the instrument, so fix the measurement when you
can and re-run, and when you cannot it is the owner's call as at step 1, passed only by an `unmeasured:nothing` entry the owner gives
for it. Any other rc 4 + REFUSED is the owner's: show the owner the `REFUSES` and `NOT IN YOUR GO` lines and the `GO FOR WHAT IS SHOWN`
line, and ask again; on the owner's explicit proceed, re-run this block with the go cut to what the owner named, exactly as step 1 sets
it (and write it to `<scratch>/promote-go.txt`), and ask "merge it?" only once it prints a PROCEEDING line. Any other rc,
or rc 4 without that line ⇒ the check itself failed (nothing it printed is a verdict): fix it, never ask. The window
between this run and the owner's answer is closed at step 6, which re-runs the check inside the merge call.

The message: the PR link; `H` (short sha); `ci-gate (main)` passed; the commit count; the migration
gate's lines; each migration in the range marked backward-compatible or NOT (a drop, rename or tightened
constraint is NOT — instant-rollback is then unsafe; name its killswitch); any open review-hub `DEPLOY-HOLD`
on a commit in the range (read the mail's `signal:` frontmatter, never the subject; a hold older than the mail's 72 h
life is still caught by step 1's hold arm, which reads the hub's open `HUB-HOLD-*` rows and the ledger); the re-check's `REVIEW-COVERAGE` line with each `NOT SENT` commit (an in-range `src/` or migration commit no review-ledger row names, so no hold can exist for it — a request mailed but not yet seated by the hub has no row either, so it lists here too), beside them each uncleared-verdict commit (a `NOT DISPOSED` line reading CHANGES-REQUESTED, UNRESOLVED, ALTERNATIVE, REJECT(ED), SELF-RETRACTION or REFUTED with no later clearing row and no verified fold), each `FOLD-CLEARED` commit (one that passes through a fold the hub verified rather than its own row; the gate line counts them as `FOLD-CLEARED n` since v1.26, and each line names the fold path and the ledger line that verified it, so the owner can see why it passed) and the re-check's `REVIEW-COVERAGE-GATE` line, quoted, and each `NOTE ONLY` one (named only in a row's Note: read the ledger line it gives); the env values going
live; whether branch protection gated it. When the range moves the web framework's version (its entry in the lockfile at
`origin/main` and at `H`; `<your deploy host>` installs from the lock), the message also carries a PREVIEW ROUTE CHECK, run during
step 4's CI wait: a framework release can change how the deploy host's own build rewrites the route table (for example, merging a
dynamic route's page, data and prefetch entries into one), and that happens only on the host's builds, so no local gate sees it.
Find `H`'s preview deployment with `<your deploy host's CLI>`, listing `<your deployment project name>`'s deployments for commit `H`
(shared checkout, never against production), then run `<your preview route check> <its url>`, which sends the host's
preview-protection bypass with the secret read at run time (a bare request is redirected to the host's login; never type the secret
on a command line) and the same requests to `<your production domain>` as the control: a representative dynamic page as HTML, as a
data request and as a segment prefetch, its `og:image`, an API route that answers 404 by design and a route miss, comparing status,
content type and the matched-route header, plus, on the preview only, a POST to the page with an unknown server-action id (right
answer: the framework's action-not-found response on the page, 404 or 409). Quote its `PREVIEW-ROUTE-CHECK:` line. Anything but
`PASS` is no "merge it?" until it is fixed (the escape hatch is the framework setting that turns the rewrite off, which moves the
head: back to step 1); `NOT-CHECKED` means unmeasured, never clean. End on the question:
**merge PR #<n> at `<H short>` into production?** Nothing runs until the owner answers.

### 6. Merge — on the owner's "merge it" for that head, in its OWN Bash call

The review gate runs a third time inside the merge call, under the same go, and the merge runs only on its PASS or
PROCEEDING line: a hold or a CHANGES-REQUESTED verdict that lands while the owner is answering "merge it?" is a new reason, and
`--match-head-commit` sees only a moved head. It is step 5's command, the go read straight from
`<scratch>/promote-go.txt` (an empty or missing file is no go, so nothing to retype), filed as `promote-step6`:

```bash
git fetch -q origin main
R6=<scratch>/promote-merge-recheck.txt
PROMOTE_REVIEW_PROCEED="$(cat <scratch>/promote-go.txt)" PROMOTE_COVERAGE_VIA=promote-step6 node scripts/promote-review-coverage.mjs --range "$(git rev-parse origin/main)..<H>" --refuse > "$R6" 2>&1; RC=$?; cat "$R6"; echo "rc=$RC"
[ "$RC" -eq 0 ] && grep -q -E "^REVIEW-COVERAGE-GATE: (PASS|PROCEEDING ON THE OWNER'S GO) " "$R6" && ALLOW_PUSH=1 gh pr merge <n> --merge --match-head-commit <H>
```

Nothing else in that call: the `ALLOW_PUSH=1` prefix approves only the segment it heads, so any other gated verb
added to the call makes the guard deny the whole call, merge included; the fetch and the re-check carry none. The shell reads the verdict, not you: the call's output arrives only after it ends, so a
check you read and then a merge in a later call leaves the window open again. rc 4 with a `REVIEW-COVERAGE-GATE:
REFUSED` line ⇒ nothing merged; go back to step 5 with this output and route it exactly as step 5 does (a `GO REFUSED`
line is your transcription; a `NOT IN YOUR GO` line goes back to the owner with the new `GO FOR WHAT IS SHOWN` line, the owner's new
go is written to `<scratch>/promote-go.txt`, and "merge it?" is asked again only once step 5's re-run prints a
PROCEEDING line — the owner's proceed is not a "merge it"). Any other rc, or rc 0 with neither line ⇒ the check failed and
nothing merged: fix it, never merge around it. A merge refusal
(head moved, check pending) returns to step 4 with a new question. Then, in the next call,
`M=$(gh pr view <n> --json mergeCommit --jq .mergeCommit.oid)` — the production sha, which `/push` § 6
calls `PUSHED`. Read it from GitHub, never from a local ref.

### 7. Bring `dev` back in line with `main` — the same turn

Strict protection refuses a PR whose branch lacks `main`'s tip, and the merge just added a commit only
`main` has. When `main` carries nothing `dev` lacks, the merge changes no file, so it is written without
touching the shared index or working tree (peers keep working through it):

```bash
SRC=$(git branch --show-current)
case "$SRC" in dev) ;; *) echo "STOP: step 7 runs on dev only"; exit 1;; esac
HOLD="$(git rev-parse --path-format=absolute --git-common-dir)/promote-inline-hold"
if [ -f "$HOLD" ]; then HC=$(sed -n 1p "$HOLD"); HB=$(sed -n 2p "$HOLD"); TOP=$(git rev-parse --show-toplevel)
  git rev-parse -q --verify "$HB^{commit}" >/dev/null || { echo "STOP: $HOLD has no pre-hotfix commit on line 2 (a v1.6 marker, or damaged) — compare its paths by hand, then delete it"; exit 1; }
  U=$(tail -n +3 "$HOLD" | while IFS= read -r p; do git -C "$TOP" diff --quiet "$HB" dev -- "$p" && ! git -C "$TOP" diff --quiet "$HC" dev -- "$p" && echo "$p"; done)
  [ -z "$U" ] || { echo "STOP: dev is back at the pre-hotfix content on: $U — restore them from $HC, commit, then re-run this step"; exit 1; }; rm -f "$HOLD"; fi
git fetch --prune origin || { echo "STOP: fetch failed — every check below would read stale refs; fix the fetch and re-run"; exit 1; }
git rev-parse --verify -q refs/remotes/origin/dev >/dev/null || { echo "STOP: GitHub has no dev branch (after fetch --prune) — the push below would CREATE it, which is the owner's yes/no (/promote step 0); ask it now, since main moved and dev lacks it"; exit 1; }
git merge-base --is-ancestor origin/dev dev || { echo "STOP: GitHub's dev has commits yours lacks — fetch and reconcile first"; exit 1; }
git merge-base --is-ancestor origin/main dev && { echo "ALREADY IN LINE — dev contains main"; git rev-parse --verify -q refs/remotes/origin/dev >/dev/null || { echo "STOP: GitHub has no dev branch (after fetch --prune) — the push below would CREATE it, which is the owner's yes/no"; exit 1; }; git merge-base --is-ancestor origin/main origin/dev || echo "PUSH NEEDED: GitHub's dev lacks main — push dev in its own background call (below)"; exit; }
H0=$(git rev-parse dev)
T=$(git merge-tree --write-tree "$H0" origin/main)             # resulting tree; exit 1 = conflicts
if [ "$T" = "$(git rev-parse "${H0}^{tree}")" ]; then
  C=$(git commit-tree "$T" -p "$H0" -p origin/main -m "merge(promote): bring dev in line with main after <PR url>")
  git update-ref -m "promote: dev in line with main" refs/heads/dev "$C" "$H0" && echo "IN LINE $C — now push dev in its own background call (below)"
else
  echo "main carries content dev lacks (a hotfix, or a REVERT — then /push 7b's keep-or-take question first), or the merge conflicts — use the hotfix path below"
fi
```

**Then push `dev` — its OWN call, `run_in_background: true`**, after this block or the hotfix path below
prints `IN LINE` or `PUSH NEEDED`: the pre-push LIGHT gate plus the changed browser specs (which a dev push
skips since 2026-10-06) ran 16+ minutes on 2026-10-02, past the tool's foreground cap (`/push` D2), so an inline push leaves the report row
"In line … pushed" with no verdict. `/push` D2b's local browser run beside a dev push
does NOT apply to a promote's own `dev` pushes (steps 0, 1 and 7): the promote PR's CI runs the full suite on
desktop and mobile and gates the merge, so a local run beside them repeats that run and loads the box during the
promote. (The owner can overrule.)

```bash
git push origin dev > <scratch>/dev-push.txt 2>&1; echo "rc=$?" >> <scratch>/dev-push.txt
```

Then `/push` D3's ancestry check on the `IN LINE` sha (or on `origin/main` for `PUSH NEEDED`). Do not
route this through `/push`: its D0 STOPs on your own step-1 hold while that hold is live.

`update-ref <new> <old>` fails rather than clobbers if a peer committed in the window; re-run the step.
The index needs no reset: its entries already match the unchanged tree. Tested 2026-09-29 in throwaway
repos (three cases; four more incl. a dirty tree, two merge bases and a mode-only
change).
⛔ **After the hotfix path below stops with "dev moved" or "ROLLBACK REFUSED"**, that STOP writes
`promote-inline-hold` in the shared git dir: the merge commit, the PRE-hotfix `dev` and the hotfix paths.
Both blocks here and `/push` 7b check it first: they STOP while `dev` is back at the pre-hotfix content on
any of those paths (restore them from the merge commit, commit, re-run), and otherwise clear it — so later
legitimate work on those paths does not keep the marker alive. Without it this path would print IN LINE
over a `dev` whose tip undoes the hotfix, and the next promote ships the revert (measured
both ways in scratch repos). A marker whose line 2 is not a commit (the v1.6 two-part format, or damage)
STOPs rather than clearing. **ALREADY IN LINE** still prints `PUSH NEEDED` when GitHub's `dev` lacks
`main` — a re-run after a refused `dev` push must not report the step done.
⛔ **The hotfix path's revert detector is a FLOOR.** It reads git's own `This reverts commit <40-hex>`
line, so a hand-written revert, or one made with `revert.reference` (an abbreviated sha), is not
recognised and this path takes it onto `dev`. Read `git log origin/main ^dev` before running it.

**The hotfix path** — `main` carries content `dev` lacks (after a hotfix promote, or found at step 0):
the merge changes files, so the index and working tree must follow, but only on those files. ONE call:

```bash
cd "$(git rev-parse --show-toplevel)" || exit 1          # the dirty and lock checks below are cwd-relative
SRC=$(git branch --show-current)
case "$SRC" in dev) ;; *) echo "STOP: step 7 runs on dev only"; exit 1;; esac
HOLD="$(git rev-parse --path-format=absolute --git-common-dir)/promote-inline-hold"
if [ -f "$HOLD" ]; then HC=$(sed -n 1p "$HOLD"); HB=$(sed -n 2p "$HOLD"); TOP=$(git rev-parse --show-toplevel)
  git rev-parse -q --verify "$HB^{commit}" >/dev/null || { echo "STOP: $HOLD has no pre-hotfix commit on line 2 (a v1.6 marker, or damaged) — compare its paths by hand, then delete it"; exit 1; }
  U=$(tail -n +3 "$HOLD" | while IFS= read -r p; do git -C "$TOP" diff --quiet "$HB" dev -- "$p" && ! git -C "$TOP" diff --quiet "$HC" dev -- "$p" && echo "$p"; done)
  [ -z "$U" ] || { echo "STOP: dev is back at the pre-hotfix content on: $U — restore them from $HC, commit, then re-run this step"; exit 1; }; rm -f "$HOLD"; fi
git fetch --prune origin || { echo "STOP: fetch failed — every check below would read stale refs; fix the fetch and re-run"; exit 1; }
git rev-parse --verify -q refs/remotes/origin/dev >/dev/null || { echo "STOP: GitHub has no dev branch (after fetch --prune) — the push below would CREATE it, which is the owner's yes/no (/promote step 0); ask it now, since main moved and dev lacks it"; exit 1; }
git merge-base --is-ancestor origin/dev dev || { echo "STOP: GitHub's dev has commits yours lacks"; exit 1; }
H0=$(git rev-parse dev)
[ -n "$TAKE_REVERT" ] || for c in $(git rev-list --no-merges "$H0"..origin/main); do X=$(git log -1 --format=%B "$c" | sed -n 's/^This reverts commit \([0-9a-f]\{40\}\).*/\1/p' | head -1); [ -n "$X" ] && { git merge-base --is-ancestor "$X" "$H0" || git merge-base --is-ancestor "$X^2" "$H0"; } 2>/dev/null && { echo "STOP: $c reverts $X, which dev carries — ask the owner /push 7b's keep-or-take question; on 'take' re-run with TAKE_REVERT=1"; exit 1; }; done
T=$(git merge-tree --write-tree "$H0" origin/main) || { echo "STOP: the merge conflicts — the owner decides"; exit 1; }
CHANGED=$(git -c core.quotePath=false diff --no-renames --name-only "$H0" "$T")
[ -n "$CHANGED" ] || { echo "no file changes — use the plumbing path above"; exit 1; }
[ ! -e "$(git rev-parse --git-path index.lock)" ] || { echo "STOP: a peer holds the index lock — re-run"; exit 1; }
D=$(printf '%s\n' "$CHANGED" | tr '\n' '\0' | xargs -0 git status --porcelain --)
[ -z "$D" ] || { echo "STOP: a path the merge changes is dirty: $D"; exit 1; }
C=$(git commit-tree "$T" -p "$H0" -p origin/main -m "merge(promote): bring dev in line with main (hotfix) after <PR url>")
git update-ref -m "promote: dev in line with main (hotfix)" refs/heads/dev "$C" "$H0" || { echo "STOP: dev moved — re-run"; exit 1; }
if ! git read-tree -m -u "$H0" "$C"; then
  git update-ref -m "promote: roll back after read-tree refused" refs/heads/dev "$H0" "$C" || {
    echo "ROLLBACK REFUSED: dev is at $(git rev-parse dev), expected $C — a peer committed. What dev's tip changed on the hotfix paths:"
    printf '%s\n' "$CHANGED" | tr '\n' '\0' | xargs -0 git diff --stat "$C" dev --
    printf '%s\n' "$C" "$H0" "$CHANGED" > "$HOLD"
    echo "If that undoes the hotfix, restore those paths from $C and commit BEFORE anything pushes dev, then re-run step 7 (it checks $HOLD and clears it)."; exit 2; }
  echo "STOP: read-tree refused; dev rolled back to $H0"; exit 1
fi
[ "$(git rev-parse dev)" = "$C" ] || {
  echo "STOP: dev moved to $(git rev-parse dev) during the merge — do not push. What it changed on the hotfix paths:"
  printf '%s\n' "$CHANGED" | tr '\n' '\0' | xargs -0 git diff --stat "$C" dev --
  printf '%s\n' "$C" "$H0" "$CHANGED" > "$HOLD"
  echo "If that undoes the hotfix, restore those paths from $C and commit BEFORE anything pushes dev, then re-run step 7 (it checks $HOLD and clears it)."; exit 1; }
echo "IN LINE $C — now push dev in its own background call (the block after the plumbing path)"
```

The two-tree `read-tree` moves only the changed paths, so peers' staged, unstaged and untracked files
survive. `--no-renames` lists both ends of a rename, and the `xargs -0` form keeps a path with a space
whole under zsh. If `read-tree` refuses after `dev` moved, `dev` goes back to `H0`, so no peer
`commit -a` can revert the hotfix against a stale index. Tested 2026-09-29: a peer's dirty, staged and
untracked files kept, the hotfix file updated; a dirty hotfix path → STOP, `dev` unmoved. This exact
block re-tested the same day in a scratch repo (normal, dirty STOP, peer files kept, a path with a
space); the rollback branch is UNTESTED here. A lens also saw `read-tree -m -u` on git 2.50.1 OVERWRITE a peer's IGNORED local file at a
force-tracked hotfix path instead of refusing; rare, and no check above catches it. Never `git merge` here with
conflicts possible: a peer's `git commit -a` after a conflicted merge committed conflict markers into a
two-parent merge.

### 7b. Run the trigger scan now, in the same turn

A tracker row can wait on a commit REACHING `main` (`trigger-type: on-ref`, `trigger: <sha> origin/main`),
and the merge is the moment it fires; `/orient` and `/wrap` run the scan, this command did not, so the
step landed a session late. Run `python3 scripts/defer-trigger-scan.py` after step 7 and act on every row
that names `origin/main` as its ref.

### 8. Deploy verification — `/push` § 6, § 7, § 8, unchanged

With `PUSHED=$M`: the CI watch on the merge commit's own run, the post-deploy smoke and the
`deploy-served` run for `M`, the deploy-checklist (post-deploy config flips, `post-deploy-check-sweep.py`,
the env-drift re-read that must now read `ALL-LIVE` and whose SERVING line must name `M`'s sha — a
`THE SERVING BUILD IS NOT THE NEWEST` note means production did not take the merge, § 9's pinned state),
and the report. Run `deploy-env-drift.mjs` from the SHARED checkout: it reads `<your deploy host's project-link file>`,
which is gitignored, so a worktree is not linked to the `<your deploy host>` project. That CI run is the FULL suite
plus meta-hygiene on every push to `main`; production is already serving it, so
a red there is dispositioned per `/push` § 6, never a gate. A migration gate line saying a REMOVAL applies
after this merge deploys is a destructive production change: its author applies it, and only on the owner's explicit authorization
(`migrations.md` § A DESTRUCTIVE SHARED-DB OP NEEDS EXPLICIT OWNER AUTHORIZATION).

### 9. Watch, all-clear, rollback — absorbed from `/deploy`

`/deploy` is retired into this step. Its former text, launch mode
included, is kept at `references/deploy-retired-2026-10-02.md`; the operative rules are here.

**The watch.** Step 8's smoke is a POINT check; the merge deploys before any CI on it finishes, so keep
the window OPEN until every applicable all-clear row is green, and never close it before the first live
use of each changed critical path (cold-start and cron-on-the-hour failures only show on a real request —
signal-anchored, never a clock).
- `<your post-deploy health smoke>` green for `M` (or the emergency push's sha), `<your health route>` healthy, `<your smoke pages>` 200,
  and `deploy-served` green for the same sha. The smoke proves the DOMAIN serves a healthy build, not that
  it serves THIS one; `deploy-served` starts from the push and alarms when `<your production domain>` is not
  serving the pushed commit.
- **Native dependency changed**, `<your native image library and its binary packages>`, an edge→node move: `curl` a real `next/og` OG route →
  200 `image/png`, zero `ERR_DLOPEN`, and one real production `<your core product operation>`.
- `<your error monitor>` error rate against the pre-merge baseline. Auth changed: one real OAuth round-trip lands
  `<your post-login landing page>`, not localhost. Processing changed: one clean `<your scheduled job>` cron tick.

**All-clear board** — stand down only when every applicable row is green: smoke · serving sha = `M`
(`deploy-env-drift.mjs` SERVING line, and `deploy-served` green) · each changed critical
path exercised live once · `<your error monitor>` at baseline through first real traffic · (native dep) the OG route ·
(processing/cron) a clean tick · (auth) a real round-trip · (migration) applied staging+prod and its code
path works live · `/push` § 7's checklist all ✓.

**Rollback — triggers.** Verify against ground truth THIS turn (a direct `curl`, reproduced on ≥2 paths):
`<your health route>` 503 or db:fail past the first probe · `<your post-deploy health smoke>` FAILS · `ERR_DLOPEN_FAILED` on any
route · product-wide down: `<your core product paths>`, OG 500s on ≥2 paths · auth bouncing to localhost or
login 500s · a release-correlated `<your error monitor>` spike mapping to one of these. A single flaky probe is not a trigger.

**Rollback — mechanism.** `<your deploy host's rollback rules: how to point production back at an earlier
deployment and which deployments are eligible, how to list and name the target, what comes back with it and
what does not, how to verify the target is serving, how to undo the rollback, and whether production stays
pinned to the target until you do>`.

**The migration decides whether rollback is safe** — every file in `git diff --name-only <target sha> <M>
-- <your migrations directory>` (step 5's message covers only the last range): none or backward-compatible ⇒
clean; a drop, rename or tightened constraint ⇒ UNSAFE, so the stop-the-bleed is the matching KILLSWITCH
and the fix is a forward migration. A killswitch is an env var, and `<your deploy host's rule for when an
env change goes live, including on a pinned project>`. The database restore is `<your database restore route and the writes it loses>`, owner-only. A code fix no prior
deployment has ⇒ a revert as an EMERGENCY hotfix (`/push --emergency` from a worktree cut from
`origin/main`, then its 7b keep-or-take question) — never a revert made on `dev` and pushed.

**Rollback — authority. Every production change is owner-gated; the autonomous branch was RETIRED.**
On a confirmed outage: **stop · page the owner with what you would do · wait.** If you find yourself
assembling a case for why your production action is covered, the assembly IS the signal to stop and ask.

**Launch mode** (owner-armed, window-scoped: a launch, hotfix or paid-cutover window where deploys cluster)
— the deploy baton, the `deploy-*` signal vocabulary, quorum and retraction rules, continuous rollback
ownership across overlapping deploys: `references/deploy-retired-2026-10-02.md` § LAUNCH MODE. Read it when
the owner arms one; it is never standing between launches.

## Report

```
## Promote — PR #<n> · <N> commits · head <H short> · merge <M short>
| Stage | Result |
|---|---|
| Preconditions | dev on GitHub · contains main · no open promote · migrations ✓ · protection <on/off> |
| Local main gate | promote-precheck rc=0 at H_PRE |
| Review gate | PASS / REFUSED → proceeded on "<the owner's words>" <UTC> for <the go as set, `<sha>:<reasons>` entries and any `unmeasured:<items>` entry> · step 5 re-check PASS / PROCEEDING (a step-5 refusal: the owner's new words and go) · step 6 re-check PASS / PROCEEDING, in the merge call |
| Env going live | <names> / none |
| PR CI | ci-gate (main) pass, <wall time> |
| Owner | "merge it" (verbatim) for <H short> |
| Merge | merge commit <M> |
| In line | dev ⊇ main at <C>, pushed (its own call, LANDED by ancestry) |
| Deploy | /push § 6-8: smoke, deploy-served, CI on <M>, checklist, env drift ALL-LIVE, SERVING = <M short> |
| Rollback-safe | instant-rollback clean / UNSAFE: <file> → <KILLSWITCH> |
| Watch (§ 9) | all-clear ✓ <rows> / OPEN: <rows pending> |
```

## Revisit

- If step 7's plumbing path ever refuses for a reason other than a hotfix, the premise (a promote
  leaves `main`'s tree equal to the source's) is wrong: re-derive before patching it.
- The hotfix-source path has never run end to end. Its old trigger has fired (`main` carries `ci-gate`), and every PR into `main` so far is dev-headed
  or Dependabot (`gh pr list --base main --state all`). A real test costs a full CI run, so it is the
  owner's call; tell the owner the route is untested before relying on it in an incident. Re-test at the first
  hotfix PR.
