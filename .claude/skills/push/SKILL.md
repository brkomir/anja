---
name: push
description: Push dev to GitHub so the private staging plane rebuilds, then hand over the staging link (ONLY as the OPTIONAL last step of /wrap, after everything else in the wrap is done, or when the owner asks for one, or inside the owner's /promote — never mid-session on a session's own call, and never while something is mid-promote). `/push --emergency` is the owner-gated direct push of a hotfix branch cut from main straight to production, only on the owner's yes to the named emergency question for that branch and sha. Steps 6-8 (CI-verdict disposition, production smoke, deploy checklist, report) are the shared deploy verification /promote calls after its merge. Production by the normal route is /promote, never /push. Use as /wrap's optional last step, or when the owner asks for a dev push, or (with --emergency) on the owner's yes to the named emergency question.
---

# Push — `dev` to staging (default) · `--emergency` hotfix to production · the shared deploy verification

⭐ **THREE COMMANDS, ONE JOB EACH.**

| command | moves | who decides |
|---|---|---|
| **`/push`** | `dev` → GitHub → the staging build, `<your deploy host's staging URL>` | only as `/wrap`'s OPTIONAL last step, the owner asking, or inside the owner's `/promote`; never mid-promote (§ D0) |
| **`/push --emergency`** | a hotfix branch cut from `main` → production, skipping the PR | the owner's yes to step 0's named question, for that sha only |
| **`/promote`** | `dev` (or a hotfix branch) → production by pull request, then the post-deploy watch and rollback rules that `/deploy` used to hold | the owner's "merge it", for the exact head, or his advance go bound to it (`/promote` iron rule 1b) |

`/deploy` is retired into `/promote` (its watch window, all-clear board, rollback authority and launch mode live there now); the `/deploy` alias stub was since deleted, so the name no longer resolves. **Everything below `§ Direct-push route` is the `--emergency` route** — its own paragraphs still say "push" where they mean the production push.

`git push origin main` is a **production deploy**: push-to-main auto-triggers a `<your deploy host>` prod build that **deploys BEFORE CI completes**. So a push is the highest-stakes, least-reversible action in the workflow — and a dropped step is expensive (the 2026-06-25 push failed at the hook's e2e gate because the pre-verify didn't include e2e → a multi-hour recovery). This skill is the authoritative sequence that turned that freehand-push failure into repeatable, fully-verified pushes.

Absorbs: deploy-support delegation, the `.githooks/pre-push` + `scripts/pre-deploy-check.sh` gate, and the `deploy-check` skill (since retired; the pre-verify is `scripts/pre-deploy-check.sh`, which this skill runs).

## When to Use
- **`/push` (no argument) — `dev` to staging.** When there is something worth seeing on staging (a fix the
  owner wants to look at, a phone check, a sandbox purchase), or before a promote whose precheck needs
  GitHub's `dev` to hold your tip. ⛔ **A session pushes `dev` only as the OPTIONAL last step of its `/wrap`, after everything else in the wrap is done, or when the owner asks for a push — never on its own call mid-session. A `/promote`'s own `dev` pushes (its steps 0, 1 and 7) are part of the owner's promote request and need no separate ask.** A push already running carries only the commits that were on `dev` when it started (the hook's lock refusal says so), never commits made after it. `dev` is shared, so every push carries every session's commits, and on 2026-10-06 one seat needed four tries (51, 6, 28 and 53 minutes) while a second seat's gate ran beside it. A mid-session need to see something on staging goes to the owner as a question. Use it with
  consideration, not per commit: each one runs the pre-push light gate on this box (it also ran the changed
  browser specs, 16+ minutes measured 2026-10-02, until the 2026-10-06 dev skip; since 2026-10-08 the session runs them BESIDE the push, never gating it — D2b) and a CI run on GitHub (a newer `dev` push cancels the older
  run). When nothing is waiting on staging the wrap push is skipped: the default is SKIP (`/wrap` Step 12).
- **`/push --emergency`** — only the case the next bullets describe. A bare "push it" on a hotfix still
  routes to `/promote`.
- **The DEFAULT route to production is the PROMOTE — a pull request from `dev` (or a
  hotfix branch cut from `main`) that the owner merges — and it is its own command,
  `/promote`.** A hotfix's normal route is that pull request too. The direct push in steps 0–5 is the
  **EMERGENCY override** for a hotfix branch cut from `main`; `dev`'s work never takes it, before or after the first promote. Steps 1b (the write-hold) and 6–8
  (CI disposition, smoke, deploy checklist, report) serve both: `/promote` calls them after its merge.
- The owner answers **yes** to the named emergency question at step 0 — *"EMERGENCY direct push of `<branch>` at `<sha>` to main — skips the pull request, deploys before CI. Go?"* A bare "push it" / "push now" / "ship it to main" on a hotfix is NOT that answer: on the normal route it means "push the branch so the PR opens", and it routes to `/promote`.
- NOT on readiness statements ("we can push now" / "looks ready") — those are readiness, **not** authorization. The auto-mode classifier denies an ambiguous push for the same reason.

## Iron rule — the PRODUCTION push is owner-gated; the `dev` push needs no token but has a WHEN
A `dev` push needs no approval TOKEN — `.claude/hooks/block-push-without-approval.sh`
classifies by target and allows `git push origin dev` as typed — but a session runs it only per the
rule above: as `/wrap`'s optional last step, when the owner asks, or inside the owner's `/promote`. **Never prefix it with `ALLOW_PUSH=1`** — the
token approves every gated verb in the same Bash call, so it buys nothing on `dev` and arms a mistake.
**Never `git push origin main` without an explicit, current-turn owner go.** A general task directive, a green gate, or "we can push" is NOT a push authorization. Each direct push needs the owner's yes to step 0's named EMERGENCY question for that sha; a bare "push it" routes the hotfix to `/promote`. (1 push ≈ a full CI Tests run + a live prod deploy.)

## Process

### Default route — `dev` to staging (steps D0–D5; added 2026-10-02)

Run from the shared checkout on `dev`. Nothing here touches `main` and nothing here needs an owner token; WHEN it runs is the rule (§ When to Use).

**D0. Preconditions — one Bash call; any STOP ends the route.**
```bash
case "$(git branch --show-current)" in dev) ;; *) echo "STOP: /push runs on dev; a hotfix branch is /push --emergency or /promote"; exit 1;; esac
git fetch origin || { echo "STOP: fetch failed"; exit 1; }
git merge-base --is-ancestor origin/dev dev || { echo "STOP: GitHub's dev has commits yours lacks — reconcile first"; exit 1; }
[ "$(git rev-list --count origin/dev..dev)" != 0 ] || { echo "NOTHING TO PUSH — GitHub's dev already holds your tip"; exit 3; }
pgrep -lf 'git push origin dev' >/dev/null && { echo "STOP: a dev push is already in flight — wait for its dev-push.txt"; exit 1; }
PRJ=$(gh pr list --base main --state open --json number,headRefName) || { echo "STOP: gh pr list failed — cannot tell whether a promote is open"; exit 1; }
PR=$(printf '%s' "$PRJ" | jq -r '.[] | "\(.number) \(.headRefName)"' | head -1); [ -z "$PR" ] || { echo "STOP: promote PR #$PR is open — a dev push moves a dev-headed PR's head, voids the owner's merge-it for that sha and restarts its CI; a promoter re-pushes from /promote step 4, never from /push"; exit 1; }
[ ! -f "$(git rev-parse --path-format=absolute --git-common-dir)/promote-inline-hold" ] || { echo "STOP: a promote's step 7 left promote-inline-hold — read it first (/promote step 7)"; exit 1; }
python3 - <<'PY' || exit 1
import glob, os, re, sys
newest = {}                      # PER SENDER: one seat's lift must never mask another seat's live hold
for f in glob.glob(".claude/state/session-mail/all__*.md*"):
    t = open(f, encoding="utf-8", errors="replace").read()
    fm = t.split("\n---", 1)[0] if t.startswith("---") else ""
    m = re.search(r"^signal:\s*(\S+)", fm, re.M)
    if not (m and re.match(r"(writehold|deploy-baton|deploy-clear|deploy-hold-ack)", m.group(1))):
        continue
    parts = os.path.basename(f).split("__")
    ts, sender = int(parts[1]), parts[2].split(".")[0]
    c = re.search(r"^created:\s*(\S+)", fm, re.M)
    if sender not in newest or ts > newest[sender][0]:
        newest[sender] = (ts, m.group(1), c.group(1) if c else "?", os.path.basename(f))
for s, v in sorted(newest.items(), key=lambda kv: kv[1][0]):
    print(s, v[1], v[2], v[3])
live = [s for s, v in newest.items() if v[1] in ("writehold-armed", "writehold", "deploy-baton")]
if live:
    print("STOP: a live hold from " + ", ".join(live) + " — read its file for the lapse time; a lapsed hold is clear")
    sys.exit(1)
print("clear: no sender's newest hold signal is live")
PY
```
- **Mid-promote = ANY open promote PR (dev- or hotfix-headed), a `promote-inline-hold` file, or a sender
  whose newest hold signal is `writehold-armed` / `writehold` / `deploy-baton` and has not lapsed** (a GO-QUIET
  names its lapse time; read the file the line names — a lapsed hold is clear, so a STOP on one is yours to
  overrule after reading it). Any of these ⇒ do not push; say so in one line and leave it for the holder.
  ⛔ **There is no "unless it is yours": every PR opens under one `gh` identity with no session id, and a
  promoter's own `/push` would move the head and void the owner's "merge it" for that sha (`/promote` step 5
  pins `H == H_PRE`, step 6's `--match-head-commit` refuses).** A promoter re-pushes from `/promote` step 4.
  The PR read iterates `.[]`, never `.[0]`: with no open PR `.[0]` is null and jq prints `null null`, a
  non-empty string that STOPs every push (measured 2026-10-02).
  And the list call is checked on its own line: a failed `gh` (offline, logged out) returns rc=1 and an empty
  string, which a single piped call reads as "no open PR" and lets the push through (observation 2026-10-02;
  measured rc=1 with a bogus token).
  The hold reader keys on each SENDER's newest signal: newest-wins across senders let one seat's lift mask
  another's live hold (verified 2026-10-02 against a two-sender fixture, STOP, rc=1).
- `exit 3` (nothing to push) is a normal answer: the staging link is already current — go to D4 for its state.
- `/push` never runs from a worktree branch or `main`. It pushes only by the LITERAL name `dev` (the guard reads
  the literal token, and refuses any `$` in a push command).

**D1. The gate is the pre-push hook — no separate pre-verify, no write-hold.** A `dev` push runs the hook's
LIGHT gate (leak guard, tsc, lint errors, unit; the production-only arms announce their skip) and
NO browser specs: an all-dev push that touches e2e-relevant
paths or a build input (src/, package*.json, next.config.ts, messages/) still runs the lint-warning ratchet
and the gate build, then
skips the local changed-e2e run and says so: the hook never gates a `dev` push on browser specs. The
session runs those specs BESIDE the push instead (D2b), and the promote PR's CI still runs the full suite on desktop + mobile. A feature or
hotfix branch push still runs the changed specs on the desktop project; `PREPUSH_DEFER_SLOW_TIERS=0 git push`
runs them on one dev push AS A GATE (the push waits on them; D2b is the non-gating route) — `.githooks/pre-push`, grep `PUSH_TO_DEV`. The
hook gates a CLEAN detached worktree at the pushed sha, not the shared working tree, so a peer's
dirty file cannot red it and your own edits during the push cannot either; and it takes a one-push-at-a-time
lock in the shared git dir, so a second seat's push is refused in seconds with the running push's session and
sha (grep `ONE PUSH AT A TIME` in the hook). The copy costs about 1.5 minutes per push (worktree plus
hard-linked `node_modules`, measured on a busy box). D0's in-flight check stays: it stops you before the hook
does, with less noise. A red still costs only a re-run, never a wrong deploy (staging is private), which is
why the `--emergency` route's ARM/GO-QUIET/ALL-CLEAR (step 1b) does not apply here. ⛔ **No `SKIP_*`
escape without the owner's words naming it.**

**D2. Push — background, literal name, output to a file.** Measured 16+ minutes in the hook on 2026-10-02, when a
dev push still ran the changed browser specs (skipped since 2026-10-06; the light gate alone is not yet timed), so
it outruns the Bash tool's 10-minute foreground cap; run it with `run_in_background: true` and read the file
when the task notification arrives, never by re-running the push:
```bash
git push origin dev > <scratchpad>/dev-push.txt 2>&1; echo "rc=$?" >> <scratchpad>/dev-push.txt
```
**H** = the sha git's own line names: `grep -E '\.\.[0-9a-f]+ +dev -> dev' <scratchpad>/dev-push.txt`. A red
hook ⇒ read which arm failed, classify it as yours or a peer's dirty file, fix yours, push again; never
`SKIP_*` through it.

**D2b. Run the changed browser specs BESIDE the push — never gating it.** Launch it as a second `run_in_background` call in
the SAME message as D2's push; neither the push nor D5's report waits on it (D5 says it is still running when it
is). Run it in a clean detached worktree at the sha being pushed, never the shared tree, which is void under
peer WIP (`.claude/rules/tests-e2e.md` § RUN E2E AT A CLEAN HEAD), and pin the base to GitHub's `dev` tip read
BEFORE the push: once the push lands `origin/dev` moves and a default-base selection collapses to nothing
(a base at or past the tested sha prints `no changed files … skipping`, rc 0).
```bash
# one call BEFORE D2: pin both shas IN the shell and write what the next call needs to a file
SP=<scratchpad>; git fetch origin || exit 1; O=$(git rev-parse origin/dev); X=$(git rev-parse HEAD); W="$SP/wt-d2b-$X"
git worktree add --detach "$W" "$X" && pax -rwl node_modules "$W/" && rm -rf "$W/node_modules/.vite" "$W/node_modules/.cache" \
  && printf 'O=%s\nX=%s\nW=%s\n' "$O" "$X" "$W" > "$SP/d2b.env" && cat "$SP/d2b.env"
# its own background call, beside D2's push. Shell variables do not cross Bash calls and `cd ""` is rc 0 in the
# CURRENT directory, so the call reads the file and refuses to run anywhere but that worktree at X:
. <scratchpad>/d2b.env && [ -n "$W" ] && cd "$W" && [ "$(git rev-parse HEAD)" = "$X" ] && [ "$(git rev-parse --path-format=absolute --git-dir)" != "$(git rev-parse --path-format=absolute --git-common-dir)" ] && E2E_GATE_PROJECT=desktop E2E_GATE_RETRY=1 PLAYWRIGHT_MAX_FAILURES=0 bash scripts/run-changed-e2e.sh "$O" > <scratchpad>/e2e-run.txt 2>&1; echo "rc=$?" >> <scratchpad>/e2e-run.txt
```
The selection is every session's change since GitHub's `dev`, so it can be most of the suite (115 of 121 spec
files on 2026-10-08, a 728-commit push).
`E2E_GATE_RETRY=1` is the hook's own gate setting (one retry per test, so a flake reports as `N flaky`, which D5
lists; a flaky test is then fixed, or filed with a named blocker, never dropped); `PLAYWRIGHT_MAX_FAILURES=0` lifts `playwright.config.ts`'s stop-after-3, which otherwise leaves the rest
of a large selection as `N did not run` that no confirm run below ever reaches. Read the verdict from
Playwright's summary lines (`N failed`, `N flaky`, `N did not run`, `N passed`), never from rc. `0 specs selected`
or `no changed files` is NOTHING SELECTED, and D5 says so; any other run with no summary line is VOID, never a
green. **H ≠ X:** D2's H is what the push carried; a peer commit between this call and D2 makes H a descendant
of X (187 commits on `dev` on 2026-10-08, median gap 118 s), and the run covers only O..X. When H ≠ X, run the
two calls once more with `O` set to that X and `X` set to H (typed into the first call, written to
`d2b-delta.env`, output to `e2e-run-delta.txt`), so X..H gets its specs too. If the push did not land (lock refusal, red hook), the run still
reads as a run of X. **A red** (a test in `N failed`, i.e. failed twice): fix it (or mail the session that owns
the code), commit, and push `dev` again through D0-D2. Confirm with ONLY the failed spec files plus the specs `E2E_SELECT_DRY_RUN=1 bash scripts/run-changed-e2e.sh <the first run's X>`
lists at the new sha (it also covers the peer commits the re-push carries; the selector matches by NAME, so a fix
under `src/lib/` or `messages/` selects nothing and its covering spec is named by hand),
`E2E_GATE_RETRY=1 scripts/e2e-local.sh --project=desktop <spec paths>` in a fresh worktree at the new sha (the
recipe above), never the whole selection again. **Teardown, on every outcome** (green, red, nothing selected,
VOID, a re-push): once `rc=` is in a run's file, never while it runs, `git worktree remove "$W"` with the `W`
from that run's env file (ignored `node_modules`, `.next-e2e` and `test-results` do not block it). D5 names the
run file and `W`, so a run that outlives its session (a `/wrap` push) can still be read and removed.

**D3. Verify it landed, by ancestry:** `git fetch origin && git merge-base --is-ancestor <H> origin/dev && echo LANDED || echo NOT-LANDED`
(never an `ls-remote == HEAD` equality — a peer pushing on top breaks it within seconds).

**D4. Wait for the staging build, then read its state** — `<your deploy host>` builds every `dev` push at the
branch alias `<your deploy host's staging URL>`:
```bash
git fetch origin && T=$(git rev-parse origin/dev)          # build for GitHub's tip, which may be a peer's push on top of H
git merge-base --is-ancestor <H> "$T" || echo "STOP: GitHub's dev no longer contains H"
<your deploy host's staging-build status command, for the build of "$T">
```
Key on `origin/dev`'s tip, not on H: a peer pushing on top is normal. Before trusting a "none", re-run the first line (a
second peer push supersedes T exactly as T superseded H). Ready ⇒ live at the alias. Building ⇒ wait.
Error ⇒ `<your deploy host's build-log command>` and treat it as a red gate. Canceled ⇒ re-run the first line before calling it a failure (a newer push may have superseded T). The GitHub `Tests` run on `dev` is not this command's wait — a promote reads CI itself.

**D5. Report** — one plain message: the staging link, what changed since the last dev push (the commit count
from git's own `<old>..<new>` line, all sessions'), the build state from D4, anything the hook flagged, and
D2b's browser run: still running, `N passed`, or what failed and what happens next.
Say what to look at and where, as a click path: which page, which control, what correct looks like.

### Promote route — MOVED to `/promote`
The seven steps that stood here (precheck, migrations, PR, owner "merge it", MERGE commit, hand-off to
step 6) live in `.claude/skills/promote/SKILL.md`, which added the migration gate, bringing `dev` back in
line with `main` after each merge, and a report. Do not restate them here; this spec keeps the steps
both routes share (1b, 6–8).

### Direct-push route — `/push --emergency`, the EMERGENCY override for a hotfix branch only (steps 0–5 below)

⚠️ `dev` has been on GitHub since 2026-09-29. If GitHub's `dev` is ever missing, this route can still push
the hotfix, but 7b cannot bring `dev` back in line afterwards: it STOPs and asks the owner's yes/no to
re-create it (`/promote` step 0).

Run every step from the hotfix branch's OWN worktree, cut from production by name —
`git worktree add -b hotfix/<topic> <path> origin/main` (a bare `git worktree add` cuts from HEAD, the shared
`dev`) — never by switching the shared checkout, which sits on `dev`. Every block below re-checks where it
runs, because prose cannot stop a block from running in the wrong directory.

### 0. Precondition — the owner's yes to the named emergency question, for THIS branch and sha
Ask only after step 3's re-freeze passes, naming the sha it froze (step 0b's checks must still hold for it), in these words: **"EMERGENCY direct push of `<branch>` at `<sha>` to main — skips the pull request, deploys before CI. Go?"** Only the owner's yes to that question, THIS turn, authorizes the push, and it covers that sha only. Anything else — "push it", "ship it", readiness — routes the hotfix to `/promote`.
Above the question, in the same message, state two lines: **migrations: none / backward-compatible / NOT (<file>)** — `/promote` § 9 reads rollback safety from this, and this route has no `/promote` step 5 to record it; and **open promote PRs** from step 1's `gh pr list` — the push moves `main`, so under strict protection an open PR goes stale and the owner's "merge it" for its head no longer applies.

### 0b. Source gate — the branch was cut from `main` and never took `dev`'s work
```bash
B=$(git branch --show-current)
case "$B" in ""|dev|main) echo "STOP: run from the hotfix branch's own worktree, never dev, main or a detached HEAD"; exit 1;; esac
git fetch origin
git rev-parse --verify -q refs/heads/dev >/dev/null || { echo "STOP: no local dev branch — run from the shared repo's worktree"; exit 1; }
ODEV=$(git rev-parse --verify -q refs/remotes/origin/dev) || echo "note: no origin/dev ref (GitHub has no dev branch, or it was never fetched); checking against the local dev alone"
[ "$(git rev-list --count origin/main..HEAD ${ODEV:+^$ODEV} ^refs/heads/dev)" = "$(git rev-list --count origin/main..HEAD)" ] || { echo "STOP: HEAD carries commits that are on dev — dev ships through /promote"; exit 1; }
[ -z "$(git log origin/main..HEAD --merges --format=%h)" ] || { echo "STOP: a merge in origin/main..HEAD"; exit 1; }
echo "SOURCE OK: $B at $(git rev-parse HEAD), $(git rev-list --count origin/main..HEAD) commit(s) on top of main"
```
**Then the migration gate — from the SHARED checkout, against the hotfix branch by name, WITHOUT
`--db`:** `node scripts/promote-migration-gate.mjs --base origin/main --head hotfix/<topic>`. ⛔ **`--db`
is wrong here, not merely weaker:** its schema probe reads `<your migrations directory>` from the WORKING TREE,
which in the shared checkout is `dev`'s, so it reports on `dev`'s migrations instead of the hotfix's, and
in the fresh worktree it reads nothing. The gate then reads commit records alone. ✗ ⇒
STOP: a migration this branch brings has no `chore(migration)` record on production in that range.
**The emergency apply route:** from the HOTFIX worktree, `<your emergency database-apply step: staging, then
production>` — from the shared checkout the hotfix's migration file is not on disk. `<your database apply command>` records the apply on
the hotfix branch, not on `dev`; the sha then changes, so re-run 0b and re-ask.
**Number a hotfix migration ABOVE `dev`'s highest**, never above `main`'s: `dev` holds numbers `main` has
not seen yet, so the next number after `main`'s
collides with a file the next promote brings. Read it with
`git ls-tree --full-tree --name-only dev <your migrations directory>/ | grep -E '/[0-9]{4}_' | tail -1` (`--full-tree`:
without it the paths are cwd-relative and a subdirectory reads nothing) — the local `dev`
(it can be ahead of `origin/dev`).
`^refs/heads/dev` is load-bearing: right after a promote merge `origin/dev` is contained in `origin/main`, so
`^origin/dev` alone subtracts nothing and `dev`'s unpushed commits read as the hotfix (7
arms). The migration gate is the one `/promote` runs.

### 0c. The worktree needs the installed packages and the env file
A fresh worktree has no `node_modules`, so the pre-push gate's tsc, unit and build die at config load and
the override is refused by its own gate. From the worktree root:
```bash
SHARED=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
if git diff --quiet HEAD "$(git -C "$SHARED" rev-parse HEAD)" -- package.json package-lock.json; then
  cp -c -R "$SHARED/node_modules" .      # the hotfix's lockfile = the one those packages came from: an APFS clone, 15 s measured 2026-09-29
else
  npm ci                                 # they differ — dev's lockfile vs main's read +142/-3 lines on 2026-09-29, or the hotfix changed its own
fi
<your step that gives the worktree its env file>
<your step that links the worktree to your deploy host's project, which a fresh worktree lacks>
```
Without that last line `<your gate's production-variable check>` cannot find the project. Reasoned from the
code; not yet run on a real hotfix.
⛔ Not `merge-base main <branch>` = its fork commit: that form PASSES `dev` itself once `dev` has stayed
linear since a promote, and passes a branch cut from `dev` (scratch repo, 2026-09-29).

### 1. Integrity check (snapshot the tree)
```bash
git fetch origin
git rev-parse --short origin/main             # confirm the expected base
git log --oneline origin/main..HEAD | wc -l    # commit count to push
git status --porcelain                         # MUST be clean of YOUR WIP
gh pr list --base main --state open --json number,headRefName   # name the result in step 0's message
```
- A dirty file you didn't create is a **peer's WIP** — it does NOT travel with the push (push moves committed history only). Leave it; never `git add -A`/commit it in.
- **HEAD-drift classification:** if HEAD moved since a prior verify, classify the drift. **The old rule — "`^(src|tests)/` is risky, docs-only is safe" — is WRONG in this repo and cost a push on 2026-07-27** (a `scripts/session-manifest.py` change landed after a commit-hold release, classified as docs-only-safe, and the gate was stale). The gate reads far more than `src/`: ⛔ *this read "tsc + unit + integration + build" until 2026-09-06 and is a pre-2026-08-10 carrier — the BLOCKING push gate is **tsc + unit + build** (`PREPUSH_DEFER_SLOW_TIERS=1`), and integration runs only in CI. The safe-list below is unchanged and still correct; what changed is WHICH gate each entry answers to, and `<your migrations directory>` now answers to CI and to prod rather than to anything that blocks the push.*
  ```bash
  git diff --name-only <verified-sha>..HEAD | grep -cE <your gate-input paths: every tree and file your gate reads>
  ```
  **Non-zero ⇒ STOP, re-verify.** Verified 2026-07-27, each by grep: `scripts/` is read by ≥4 unit tests and is executable besides · `messages/` by ≥4 (the i18n suites) · `<your migrations directory>` is applied by the integration tier — **which is now CI-side, so a migration in the drift set is a POST-push risk, not a gate risk; it still stops the push, because the deploy is what it reaches** · config/lockfile changes move build + resolution.
- **So the safe-list is narrow and must be EARNED per path, not assumed.** Before calling any drift safe, name the file and confirm nothing in `tests/` or `scripts/` reads it. "It's only markdown" is not a classification.

### 1b. Fleet coordination — ARM now, GO-QUIET at the gate, ALL-CLEAR at landing

⛔ **SINCE 2026-10-06 THE GATE RUNS IN A CLEAN COPY, SO THIS PROTOCOL NOW BUYS BOX QUIET, NOT A CORRECT READING — EXCEPT UNDER `SKIP_PREPUSH_SNAPSHOT=1`, WHERE THE GATES READ THE SHARED TREE AGAIN AND IT IS PART OF THE GATE.** The hook gates a detached worktree at the pushed sha with `node_modules` hard-linked, so a peer's dirty file is neither carried nor measured. Before that, `.githooks/pre-push` called `bash scripts/pre-deploy-check.sh` with no stash and no temp checkout, so `npm test` and `next build` read whatever every other seat had dirty at that instant: a peer's dirty file did not travel with the push, and it **was measured**. Codified 2026-09-05 from a 1,241-commit push — the coordination had no home in this spec and was improvised whole.

**Measured cost of skipping it, same session:** three integration reds traced to one peer's uncommitted refactor of the very files those tests import, costing a dispatched classification agent to clear before the push could be called safe.

**THREE BROADCASTS — AND THE ARM/QUIET SPLIT IS THE LOAD-BEARING PART.** Sending one combined "quiet now" mail freezes the fleet for the whole blocker-resolution phase, which is where the time actually goes.

1. **ARM — send the moment you START the route, hours before the gate** (not on the emergency route — the paragraph after item 3). `mail-send --to all --signal writehold-armed`. Send your own held review batch to the hub first — on the no-live-peers path too, which skips this mail. Say a push is coming and that you are **NOT quiet yet**. Ask for exactly four things: **(a) claim or disclaim every untracked file the gate will collect** — name them (`git status --porcelain | grep '^??'`), because a peer's red-first test reds a gate about code that is not being pushed; **(b) reply if you hold a live deploy-hold** on anything in the queue; **(c) derive the queue yourself** (`git rev-list --count origin/main..HEAD`) — on a shared main it is every seat's work, not yours; **(d) send the hub any review batch you are holding**. Then list what you have already measured to be NOT a blocker, so nobody re-chases it. Measured: 50 minutes between ARM (13:41:20Z) and GO-QUIET (14:31:05Z), in which four untracked files were resolved by their authors, two hub deploy-holds were lifted, and the one genuinely load-bearing unapplied migration surfaced and was applied. ⛔ **BOUND THE WAIT AND CHECK LIVENESS FIRST — this is the only step in an owner-gated command that blocks on an external party, and as first shipped it had no wait bound, no default and no exit.** Run `python3 scripts/session-manifest.py who` before the ARM: **no live peers ⇒ skip straight to step 2** (step 2's `Solo → run inline` is the precedent), and with peers, state a deadline in the mail and proceed on it. Silence from a seat that has taken no turn since your mail is an absent measurement, not a disclaim.
2. **GO-QUIET — one line, at the top of step 2.** `--signal writehold`. Ask for **no worktree writes**, **no heavy suite runs** (full unit, integration, e2e, `next build`, paid evals), and **every review batch held since the ARM sent to the hub now** (commits made after the ARM are in a promote's range too). Read-only work, mail and thinking stay fine. The second ask is about the **BOX**, not the tree — a peer's `next build` contends for the same machine.
3. **ALL-CLEAR — the moment the push lands or the gate fails.** `--signal writehold-lifted`. **Not** when the CI verdict is in: the quiet exists to protect the gate's *measurement*, and that is over at push time. Holding it through step 6 freezes the fleet for nothing.

**On `--emergency` the gate runs in the hotfix's OWN worktree, which no peer writes to:** skip the ARM and its wait; send only a GO-QUIET asking for no heavy suites (box contention), with an expiry, then step 2.

⚠️ **WHY A WRITE-HOLD AND NOT THE STRUCTURAL FIX — stated so the next reader does not re-derive it.** The whole protocol exists because the gate measures the shared tree, and the structural answer is to gate in a detached worktree instead. That fix SHIPPED 2026-10-06: the copy hard-links `node_modules` (`pax -rwl`), which is what had blocked it — a bare `git worktree add --detach` tree has none, so `npm test` and `next build` died at config load (`tests-unit.md` § MUTATION TESTING — WAYS YOUR READING IS VOID, the THIRTEENTH way). **The write-hold stays as a box-quiet courtesy, and as the gate's protection only under `SKIP_PREPUSH_SNAPSHOT=1`.**

⛔ **RECORD `who` AT GO-QUIET AND AGAIN AT ALL-CLEAR — TWO NUMBERS, AND THEY ARE WHAT MAKE THE NEXT WINDOW ATTRIBUTABLE.** `python3 scripts/session-manifest.py who | wc -l` at each end, written into the plan. Without them the confound below is disclosed once and then permanently unresolvable, because nothing records the discriminator. **A window with ≥3 live peers and ≤1 commit is the first attributable sample this protocol has ever had.**

⛔ **PUT AN EXPIRY IN THE GO-QUIET AND MAKE IT SELF-RELEASING — A QUIET WINDOW WITH NO EXPIRY IS A FLEET-WIDE STOP WITH A SINGLE POINT OF FAILURE.** Measured, this session: GO-QUIET at 14:31:05Z, this seat hit its session limit at 14:47:45Z, resumed at 17:42:34Z, ALL-CLEAR at 18:02:46Z — **the fleet was asked to hold for 3h31m and the holder was not running for 2h55m of it**, with nothing in the protocol to tell them. Write the lapse time INTO the mail (*"this lapses at HH:MMZ unless I re-broadcast"*) so the failure mode is a quiet that ends early rather than a fleet frozen behind a dead seat.

⛔ **AND THE EXPIRY CREATES THE INVERSE HAZARD, WHICH THIS SESSION MEASURED WITHOUT NOTICING: after a lapse the peers have correctly self-released and the pushing seat does not know.** Five commits landed in the twenty minutes between this seat's resume and its ALL-CLEAR — peers behaving exactly as instructed, against a seat that believed the quiet still held. **On resume from any interruption, re-broadcast the GO-QUIET with a fresh expiry and re-derive the drift (step 1) before trusting a gate result taken before the gap.**

⛔ **AND BOTH CLAUSES ABOVE ASSUME YOU CAN SPEAK — INSIDE A SYNCHRONOUS `git push` YOU CANNOT, AND THE HOOK IS A SUPERSET OF THE GATE SCRIPT (measured 2026-09-08).** `.githooks/pre-push` runs `scripts/pre-deploy-check.sh` PLUS arms of its own, most expensively **`smoke-mutation-matrix.sh --gate`**, a mutation matrix over the repo's own hook scripts in an isolated temporary worktree. **That arm is not in the gate script, so no pre-verify predicts the duration: the 2026-09-08 push sat in its hook for 63 MINUTES.** The seat is blocked inside the push for the whole window and **cannot re-broadcast a lapsing hold even in principle** — so the resume-and-re-broadcast remedy directly above has no branch that covers this. On 2026-09-08 a 30-minute quiet lapsed mid-push and a peer correctly self-released, resuming shared-tree writes at the most sensitive minute of the arc.

⛔ **BUT DO NOT SIZE THE TIMER AGAINST "THE HOOK'S WORST ARM" — THAT WAS THIS CLAUSE'S OWN FIRST PRESCRIPTION AND IT IS STRUCK (2026-09-08).** The cost is not a property of the repo, it is a property of **what you are pushing**, and one $0 command on your own diff settles it before you declare anything: `git diff --name-only <verified-sha>..HEAD | grep -cE '^\.claude/hooks/[^/]+\.sh$'`. Per `.githooks/pre-push` (grep `CHANGED_HOOK_N`) the arm runs iff `SKIP_HOOK_LIVENESS_GATE != 1` **and** that count is **1 to 5**: **0 ⇒ it never runs; more than 5 ⇒ it SKIPS with its own message and defers to the periodic full matrix.** So changing MORE hook files makes the push FASTER, which is the direction a reader will get backwards.

⛔ **63 MINUTES IS NOT A CEILING AND NOT A CONSTANT — IT IS ONE POINT, AND THE POINT IS MEASURED: THAT PUSH CHANGED EXACTLY 5 HOOKS, THE MAXIMUM THE INLINE GATE ACCEPTS.** `--gate` implies `--only` and is KILL-only, so it mutates the NAMED hooks and runs a suite per mutation — cost ≈ your changed-hook count × per-hook suite cost, ≈ 12-13 min/hook at that measurement, and ONE more hook in that diff would have skipped the arm entirely. ⚠️ *The verdict that produced this fix attributed the variability to the matrix "growing with each wired hook" and quoted the script's header for it. **Its ATTRIBUTION is wrong and its CITATION is right, and my own refutation of it was wrong too — recorded because the second error is the more instructive one.** The line is live, verbatim: *"the suite is deterministic (53s measured 2026-07-31 … it grows with each wired hook, so re-measure rather than citing this figure)"*. I published "that string does not exist in the file or anywhere in the repo (0 hits)" into two files off a `grep -rnF`, and **the phrase WRAPS A LINE BREAK with a `#` comment marker at the join, so no line-oriented grep can match it at ANY flag combination** — measured: `grep -F` 0, `--hidden` 0, `--no-ignore` 0, `rg -U` 1, a `[\s#]*`-bridged Python match 1, and the naive `tr '\n' ' '` join **also 0**, because the marker lands between the words. ⛔ **AND THE QUOTE IS ABOUT A THIRD ARM AGAIN:** it governs the hook-infra smoke gate (`smoke-test-hooks.sh`, 53 s), not the Layer-3 mutation gate and not the periodic matrix — so this hook has THREE distinct cost stories and the quote belongs to neither one being argued about. **What survives unchanged is the operative half: the INLINE gate is scoped to your changed CSV and scales with YOUR DIFF, not with the wired hooks.** An absence claim from a line-oriented grep over a comment corpus is a hypothesis, never a finding.*

⛔ **AND AT 1-5 CHANGED HOOKS, REACH FOR THE BINDING PRIMITIVE RATHER THAN A BIGGER NUMBER.** An advisory quiet with a longer timer is still advisory, and this is the exact case the protocol already answers: the quorum of per-sender `mail-await` acknowledgements the launch mode carries (`.claude/skills/promote/references/deploy-retired-2026-10-02.md` § LAUNCH MODE), named below where the routine path deliberately declines it. **An unbounded window you cannot extend from inside is when advisory stops being enough.**

⚠️ **AND SAY WHAT THE HOLD ACTUALLY BUYS, BECAUSE IT IS LESS THAN THIS PROTOCOL IMPLIES.** `smoke-mutation-matrix.sh` runs `git worktree add --detach` (grep `ISOLATING`) and never reads the live tree, and in `.githooks/pre-push` it runs BEFORE the pre-deploy gate — the arm that genuinely does read the shared tree. So for most of those 63 minutes *"no worktree writes"* protected nothing; only *"no heavy suite runs"* (box contention) did. Holding both anyway is a defensible conservative default, since the pusher cannot signal which phase they are in and peers cannot see it — **but ask for it as a conservative default, not as a correctness requirement. Asking the fleet for more than you need spends credibility on the window that does need it.**

⚠️ **AND NEVER TELL ANYONE A GREEN PRE-READ MEANS THE PUSH WILL PASS ITS OWN HOOK** — owner-facing retraction the same day, verbatim: *"I told you the gate pre-read meant the push would pass its own gate. That was true of the gate script, and incomplete."*

⛔ **A REMOTE REF THAT HAS NOT MOVED DOES NOT MEAN NO PUSH HAPPENED — AND THE SAME FACT IS WHAT MAKES A LONG HOOK SAFE.** Git resolves the branch and hands the hook the resolved ref BEFORE invoking it, and advances the remote ref only AFTER the hook exits. Two consequences, opposite signs, **codify them together or the next reader gets one half**: (a) for the whole hook window `git ls-remote` reads unchanged, so a peer's liveness check keyed on it is correct in form and wrong by construction; and (b) the push therefore carries EXACTLY the commit the gate measured, and peer commits landing on the local branch afterwards are excluded and stay queued — correct behaviour, not a gap.

⛔ **HOOK-EXIT IS NECESSARY, NOT SUFFICIENT — THE REF IS UNINFORMATIVE FOR *LONGER* THAN THIS CLAUSE FIRST CLAIMED.** It read *"advances the remote ref only AFTER the hook exits"*; `githooks(5)` supports the two halves that matter (the hook receives `<local-ref> SP <local-object-name> SP <remote-ref> SP <remote-object-name>` on stdin, and a non-zero exit aborts the push without pushing anything) but says nothing about the ref advancing at hook-exit — after a zero exit the object transfer must still complete and the remote's own receive-side hooks must still accept. It errs SAFE, so this is precision rather than correctness; state a precondition as a precondition.

⛔ **AND NOTHING OUTSIDE THE SEAT CAN ANSWER PUSH-LIVENESS DURING THAT WINDOW — TREAT IT AS UNKNOWABLE FROM OUTSIDE AND HOLD ACCORDINGLY.** ⚠️ *This clause first read "ask the seat or read its `tee`'d push log", and BOTH halves are dead. The seat cannot answer: the clause two paragraphs above declares it blocked inside a synchronous push and unable to speak, so the two prescriptions contradicted each other two sentences apart — a reader mid-incident follows the remedy, gets silence, and falls back on the very ref-check this clause exists to discourage. And no log is readable: step 4 captures to `OUT=$(mktemp)`, a random path broadcast to nobody, and THIS FILE had already measured that artifact class failing and designed it out — "a reused capture file → LANDED on an unpushed commit ❌, which is why there is no file handoff", and again "(reflog, tee'd file, rev-parse HEAD) was measured returning a sha that was not yours".*

⚠️ **AND DO NOT READ A QUIET WINDOW AS OBSERVED — THIS ONE'S APPARENT SUCCESS IS UNATTRIBUTABLE.** Seven commits landed inside the declared window: two within five minutes of the GO-QUIET (an advisory broadcast is not in force when you send it — peers read mail on their next turn) and five in the final thirteen minutes. The ~3h of genuine silence in the middle **coincides exactly with a fleet-wide session-limit outage**, so a shared rate limit produces the identical reading and the protocol collects credit it may not have earned. **Re-derive `git log --since='@<quiet-start-epoch>'` before the gate and classify what landed; never assume the quiet took.** If a window must be BINDING rather than advisory, the launch mode (`.claude/skills/promote/references/deploy-retired-2026-10-02.md` § LAUNCH MODE) already carries the primitive — a quorum of per-sender `mail-await` acknowledgements — and this routine path deliberately does not.

### 2. BLOCKING pre-verify — tsc + unit + build. Integration and e2e MUST NOT gate the push.
The invariant is unchanged and it is the only one that matters here: **pre-verify exactly what the hook will run**, so the push does not fail at the hook. What the hook runs changed, so this step changed with it.

**BLOCKS the push** (`scripts/pre-deploy-check.sh`; measured components 2026-10-04: unit 3.6 min, build
1.3 min). Pre-verify from the hotfix worktree with exactly the form the hook uses on a main push:
`PREPUSH_LIGHT=0 PREPUSH_DEFER_SLOW_TIERS=1 PREDEPLOY_LINT_BASE=origin/main bash scripts/pre-deploy-check.sh`
(the hook passes `PREDEPLOY_LINT_BASE=$BASE_REF`, main's remote tip; without it the lint arm diffs against
`origin/dev`, a different file set for a branch cut from `main`). A bare
`bash scripts/pre-deploy-check.sh` defaults `PREPUSH_DEFER_SLOW_TIERS` to `0` and runs integration (Docker),
which the hook does not; an inherited `PREPUSH_LIGHT=1` would make it the light gate:
- `tsc --noEmit`.
- `npm test` — the full unit tier.
- `next build` — **load-bearing for any runtime / native-dep change** (sharp, `edge→node`, `@img/**` tracing; `tsc`/unit are blind to it, and this class took the whole product down once).
- the hook's own arms (secret scan, …).

**DEFERRED to CI — do NOT run these as a push gate:**
- `npm run test:integration`
- `./scripts/run-changed-e2e.sh`

⚠️ **State the trade out loud when you report, because the deploy does not wait for CI.** An integration- or e2e-only regression now **reaches production** and serves users until someone reverts it; CI *reports* it, it does not *prevent* it. That is the accepted cost, not a gap to paper over — and it is why step 6's CI disposition is mandatory rather than advisory.

**Both defaults are deliberately asymmetric** — the hook exports `PREPUSH_DEFER_SLOW_TIERS=1`, `pre-deploy-check.sh` defaults it to `0`. So the push is fast and an interactive `scripts/pre-deploy-check.sh` run keeps **full** coverage; only the push was too slow. Full local gate on demand: `PREPUSH_DEFER_SLOW_TIERS=0 git push`.

- **Delegate the gate-run to a deploy-support peer** when one is available (`mail-send` it the HEAD + the changed-file list) — keeps the build/test logs out of the orchestrator's context; it reports COUNTS + PASS/FAIL. Solo → run inline.
- Read **COUNTS, not exit code** (wrappers pipe; the exit code is the last stage's).

### 3. Re-freeze
Re-derive `origin/main..HEAD` + re-run the step-1 classification against the pre-verified SHA. Zero gate-input matches → re-run 0b's source block AND its migration gate (`--head hotfix/<topic>`) against that sha, and only on both passing is it `H`: ask step 0's question naming it, and step 4 pushes exactly `H`; any match → back to step 2. A new hotfix commit can bring a migration the first 0b never saw, so the loop back never skips the gate. (The old "docs-only → push" shorthand here predated step 1's 2026-07-27 correction — the safe-list is earned per path, never assumed from file type.) (Across the 2026-06-25 pushes the target SHA went stale ~5× as peers settled memories — each re-freeze caught it.)

### 4. Push — AND VERIFY IT LANDED, IN THE SAME BASH CALL

⛔ **THE PUSH AND ITS LANDED-CHECK ARE ONE CALL. That is the fix, and it is not a style preference — it is the only shape measured to fail SAFE (2026-09-07, scratch repo + local bare remote, six arms).** Every Bash call is a fresh shell, so handing the pushed sha to a LATER call needs a carrier, and **every carrier tested reports LANDED on a push that never happened**: the shared reflog (below) and a tee'd capture file re-read later (measured: a stale capture from the previous push returned `LANDED` for a commit that was never pushed). One call needs no carrier.

**Run the block with `timeout: 600000`.** The main-push hook runs tsc, unit, build and its own arms in a cold worktree and can run past the 2-minute default; a timeout moves the call to the background with no verdict in your turn (`bash-environment.md` § Pass `timeout: 300000` PROACTIVELY). If it still runs past 10 minutes, read that background task's output when it completes; never re-run the push. **If the auto-mode classifier refuses the block** (it denied the analogous `<sha>:refs/heads/dev` form on 2026-09-30), do not reshape it: hand the owner this exact block to run with `!`.

```bash
H=<the 40-hex sha named in the question the owner answered yes to>
case "$(git branch --show-current)" in ""|dev|main) echo "STOP: not in the hotfix worktree"; exit 1;; esac
git fetch origin
git rev-parse --verify -q refs/heads/dev >/dev/null || { echo "STOP: no local dev branch"; exit 1; }
ODEV=$(git rev-parse --verify -q refs/remotes/origin/dev) || true
[ "$(git rev-list --count origin/main..HEAD ${ODEV:+^$ODEV} ^refs/heads/dev)" = "$(git rev-list --count origin/main..HEAD)" ] || { echo "STOP: HEAD carries dev's commits"; exit 1; }
[ -z "$(git log origin/main..HEAD --merges --format=%h)" ] || { echo "STOP: a merge in origin/main..HEAD"; exit 1; }
[ "$(git rev-parse HEAD)" = "$H" ] || { echo "STOP: HEAD is not the sha the owner approved"; exit 1; }
BEFORE=$H
OUT=$(mktemp)
ALLOW_PUSH=1 git push origin "$H":refs/heads/main > "$OUT" 2>&1; RC=$?   # the ONE sha every check above tested — never a second paste
cat "$OUT"
# git's OWN report of what moved — the only in-band record of THIS push
ABBR=$(grep -oE '^ *[+*]? *[0-9a-f]+\.\.[0-9a-f]+ +[^ ]+ -> ' "$OUT" | head -1 \
       | sed -E 's/^ *[+*]? *[0-9a-f]+\.\.([0-9a-f]+).*/\1/')
if [ -n "$ABBR" ]; then
  PUSHED=$(git rev-parse "$ABBR")        # git prints ABBREVIATED; rev-parse widens to 40
  [ "$PUSHED" = "$BEFORE" ] || echo "WARNING: pushed $PUSHED, HEAD was $BEFORE before the push — read the output above"
else
  # NO '<old>..<new>' line — which is NOT a failure by itself. FOUR shapes print none:
  # "Everything up-to-date", a first "* [new branch]", "+ a...b (forced update)" (THREE
  # dots) — and a REFUSED PRE-PUSH HOOK, which is the one that is not an rc=0 shape.
  # The question was never "did the push transfer bytes" but "is MY commit on the
  # remote", and BEFORE — captured above, in THIS call — answers it without any carrier.
  git fetch -q origin
  PUSHED="$BEFORE"
fi
# ONE ancestry check for both paths — the branches only decide WHICH sha to ask about.
if git merge-base --is-ancestor "$PUSHED" origin/main; then
  echo "LANDED $PUSHED (push rc=$RC)"
  [ "$RC" -eq 0 ] || echo "⚠️  rc=$RC — the commit IS on the remote, but THIS push did not succeed. A refused pre-push gate prints no '..' line and returns non-zero, and a peer may have pushed your commit for you. Read the output above before calling the step done."
else
  echo "NOT-LANDED $PUSHED (push rc=$RC) — read the push output above"
  rm -f "$OUT"; exit 1
fi
rm -f "$OUT"
```

⚠️ **THE PARSE IS A REGEX OVER SOMEBODY ELSE'S OUTPUT FORMAT, AND THAT IS AN INTERIM, NOT A FOUNDATION.** `ABBR` is scraped from git's human-readable `<old>..<new> <ref> -> <ref>` line, which git has no contract to keep stable and which localises. It is the only in-band record of what THIS push moved, so there is no better source today — but the failure direction if git ever reformats it is a parse that goes EMPTY, which lands in the `else` branch and is answered by the ancestry check on `BEFORE`, i.e. it degrades to the no-dots path rather than to a wrong sha. **That is why the ancestry predicate, not the parse, is what the verdict rests on.**

⭐ **COPY THE 40-CHAR SHA OUT OF THE `LANDED <sha>` LINE — step 6 takes it pasted LITERALLY.** It is not re-derivable in a later call; that is the whole finding.

**Measured arms (scratch repo, local bare remote, no network, no CI):** a real push → the parse recovers the true sha and `rev-parse` widens `3ad79b9` to the full `3ad79b917cef…`, 40 chars ✅ · no capture at all → empty → NOT-LANDED ✅ · a REJECTED push (`! [rejected]`) → empty → NOT-LANDED ✅ · a peer pushing on top → still LANDED by ancestry ✅ · **a reused capture file → LANDED on an unpushed commit ❌**, which is why there is no file handoff.

⛔ **THE `else` BRANCH IS THE 2026-09-07 FOLD, AND THE ARM THAT MOTIVATES IT IS NOT EXOTIC: "Everything up-to-date" IS THE ROUTINE OUTCOME ON A 45-WORKTREE BRANCH.** A peer pushes your commits along with theirs before you push; your push is then a legitimate no-op, git prints no `..` range, and the shipped parse told you **NOT-LANDED while your work was safely on the remote**. Four arms, re-run with a positive control that must read the other way — the earlier run's "control" hit an empty remote, printed `* [new branch]`, parsed empty like every other arm, and therefore measured nothing:

**Arms, re-run against the block extracted verbatim from this fence** (scratch repo, local bare remote, no network, no CI):

| arm | git prints | parse | verdict | block rc |
|---|---|---|---|---|
| fast-forward (**control**) | `de465fd..77a9959  main -> main` | `77a9959` | LANDED (push rc=0) | 0 |
| **up-to-date** | `Everything up-to-date` | empty | LANDED, same sha as the control | 0 |
| **refused gate, commit ON the remote** | hook stderr + `error: failed to push` | empty | **LANDED (push rc=1) + the ⚠️ warning** | 0 |
| **refused gate, commit NOT on remote** (**control**) | same shape as the row above | empty | **NOT-LANDED (push rc=1)** | **1** |
| **rejected / diverged** | `! [rejected] … (fetch first)` | empty | NOT-LANDED (push rc=1) | **1** |
| forced update | `+ aff4445...78c4faa … (forced update)` | empty | LANDED (it IS on the remote) | 0 |
| new branch | `* [new branch]  main -> main` | empty | LANDED | 0 |

**The arms that had to be measured are the ones that move a case TOWARD "landed"** — the branch only ever does that, so the only question worth asking is whether it can do it to a push that genuinely failed. It cannot, and the two control rows are how you know: the same refused-gate shape reads LANDED when the commit is on the remote and NOT-LANDED when it is not, which is the ancestry predicate doing the work rather than the rc.

⛔ **A REFUSED PRE-PUSH GATE IS THE FOURTH NO-`..` SHAPE AND THE ONLY ONE THAT IS NOT AN rc=0 SHAPE (2026-09-07).** Its verdict is still TRUE — the commit really is on the remote, usually because a peer pushed it — but the push was BLOCKED, not a no-op, and the earlier wording asserted the no-op. **Measured on this box: git RUNS the pre-push hook even when the push is up-to-date** — hook stderr, `error: failed to push some refs`, **rc=1, no `..` line** — so the shape is reachable end-to-end, not merely arguable. That is why `rc` now prints on BOTH verdicts: the one line you copy from has to carry the fact that your own gate refused.

⛔ **AND THE BLOCK MUST EXIT NON-ZERO WHEN IT SAYS NOT-LANDED.** The original `[ -n "$ABBR" ] || { …; exit 1; }` was removed correctly — it fired on the up-to-date SUCCESS case, which is the bug above — but the true-failure exit was not put back, so for one commit every arm returned rc=0 including NOT-LANDED, against `bash-environment.md` § WRITE A GATE SO INSTRUMENT FAILURE LANDS ON THE FAILING SIDE. *(The two ancestry checks were merged into one while fixing this — slightly more than the verdict asked for. The branches now only decide WHICH sha to ask about, so the verdict, the rc line and the exit cannot drift between them, which is how the first version grew a failure arm on one path and not the other.)*

- ⛔ **DO NOT CAPTURE `PUSHED` FOR A LATER CALL — AND DO NOT RE-DERIVE IT FROM THE REFLOG EITHER (2026-09-07, REPRODUCED ON THIS SEAT).** The reflog derivation that stood here — `git reflog show origin/main | grep -m1 'update by push'` — rests on *"a peer's push enters your reflog as `fetch origin: fast-forward` and never as `update by push`"*, which is true only for a peer on a DIFFERENT clone. **This repo is ONE clone with 45 worktrees** (`git rev-parse --path-format=absolute --git-dir` == `--git-common-dir`), so every fleet seat's push writes `update by push` into the same reflog and nothing in the entry names the pusher. Measured on a seat that had pushed NOTHING: **VERDICT: LANDED**, sha age **31 hours**, trailer — a different session — against **635** unpushed commits of its own. ⛔ **The direction is the severity, and the commit that shipped it said so: it rejected a file handoff because *"a stale file reports LANDED. That converts a fail-safe defect into a fail-dangerous one."*** The prior defect was a false alarm; this was a false green on the one step whose heading says *not the exit code*. The soundness sentence generalised from a single 2026-09-05 push/fetch pair.

  **The history, kept because each step was right about the thing before it and wrong about the fix.** The original bug was real: every Bash call is a fresh shell, so a `PUSHED=$(git rev-parse HEAD)` captured in step 4 was EMPTY at both consumers — step 5 printed `NOT-LANDED` on a landed push, step 6 burned its full 20-minute wait and exited 3. Both wrong, neither silent. The 2026-09-06 correction was also right that a post-push `git rev-parse HEAD` is unsafe here: every seat commits to the same local branch, and the busiest recent hour on `main` ran **51 commits at a mean interval of 70.6 s**, so HEAD can already be a peer's. **What every one of those fixes shared was the assumption that the sha must reach a LATER call.** It does not have to, and it cannot safely: the carrier is the defect, not the derivation. Push and verify together, then paste the printed sha into step 6 by hand.
- `ALLOW_PUSH=1` is the env gate the pre-push hook checks.
- The hook re-runs the BLOCKING gate (tsc/unit/build) on the pushed tree — your pre-verify makes that pass first-try. It prints `⏭  SLOW TIERS DEFERRED TO CI`; that banner is the evidence the deferral is live, and its **absence** means you are on an older hook and integration/e2e ARE gating.
- **`SKIP_E2E_HOOK=1`:** use ONLY when you already hold complete captured gate-evidence on a frozen tree (e.g. a flake-blocked re-push of an unchanged tree), and **surface it to the owner** — it's a prod-gate bypass. ⛔ **On the EMERGENCY route it needs the owner's own words naming the skip for that exact push, separate from the emergency yes:** there CI runs only after the deploy, so this hook is the one gate before production, and step 2's green carries no check that it ran in this worktree on this sha.
- **Never `--no-verify`.** A hook failure is a real signal — read the full output, diagnose, fix.

### 5. Verify it LANDED (not the exit code)
```bash
git ls-remote origin refs/heads/main           # the ACTUAL remote SHA
git log --oneline origin/main..HEAD | wc -l     # the unpushed REMAINDER
```
⛔ **THOSE TWO LINES CARRIED `must == local HEAD` AND `must be 0`, AND BOTH ARE FALSE ON A SHARED BRANCH THE MOMENT A PEER PUSHES ON TOP — measured 30 SECONDS after the 2026-09-05 push,** when the remote tip was already a peer's commit and this seat read its own landed push as not-landed. **The instruments that actually answer it:**
- **Did MY commits land?** ⛔ **THAT QUESTION IS ANSWERED IN STEP 4, IN THE SAME CALL AS THE PUSH — there is no derivation to run here, and every attempt to put one here has been fail-dangerous.** Step 4 prints `LANDED <40-char sha>`; that line IS the answer. The check is `git merge-base --is-ancestor "$PUSHED" origin/main`, which is ancestry and therefore immune to anything a peer pushes on top (measured: a peer pushed on top in the scratch rig and the seat's own sha still read LANDED). ⚠️ **The `&& echo` is not decoration:** `--is-ancestor` prints NOTHING and signals in rc alone, so under a heading that says *not the exit code* the bare form gives you nothing to read. ⛔ **If you arrive at step 5 in a NEW Bash call with no sha in hand, the honest state is UNVERIFIED — re-run step 4's block against a fresh push, or say it is unverified. Do NOT reach for the reflog, a `tee`'d file, or `git rev-parse HEAD`: all three were measured returning LANDED for a push that did not happen.**
- **Did *I* push, as opposed to anything else?** `git reflog show origin/main --date=iso`. ⛔ **THIS ROW USED TO SAY IT ANSWERS "did a PUSH happen" AND THAT IS BACKWARDS — corrected 2026-09-06 (the always-loaded source in `bash-environment.md` § FOUR GIT PROBES was itself inverted and is fixed).** `update by push` means **THIS CLONE** pushed it; a peer on a **DIFFERENT** clone arrives as `fetch origin: fast-forward`. ⛔ **AND ON THIS REPO THAT BUYS YOU NOTHING, BECAUSE THE CLONE IS NOT THE SEAT — corrected 2026-09-07, same as step 4.** `--git-dir` == `--git-common-dir` with **45 worktrees**, so *this clone* is the whole fleet: every seat's push writes `update by push` here and no field in the entry names the pusher. The measurement this bullet used to cite — *"`… update by push` (mine)"* — was itself wrong: that commit's `Claude-Session` trailer reads a different session. **So it is USELESS for "did a push happen" AND useless for attributing a push to a SEAT; it attributes only to the clone, which is everyone.** For attribution use the `Claude-Session` trailer on the commit. *(Read "STRONGER than advertised for attribution" until 2026-09-07; the sentence below is what survives.)* **USELESS for "did a push happen"** — on a shared branch most pushes are somebody else's, and `origin/main` routinely sits at a sha whose newest entry is a fetch. Read it to confirm *your own* push moved the branch, never to detect the branch moving.
- ⚠️ **An unpushed COUNT cannot discriminate *no push* from *a push, then peers kept committing*** — read it as a remainder, never as a verdict.
Confirm the gate ran in the push output (grep `pre-deploy gate clean` + `main -> main`; confirm `SKIP_E2E` is NOT set). **Do not grep for an e2e summary — there isn't one any more**, and reading its absence as a failed gate is the mirror-image mistake of reading a fast green as full coverage. Do not claim "pushed" off `exit 0` alone.

### 6. Verify the PROD deploy + DISPOSITION the CI verdict (mandatory)
push-to-main deploys prod **before** CI finishes, so the deploy is the immediate concern. **CI is no longer a backstop — for integration and e2e it is now the ONLY tier that runs at all** (step 2). Tracking that lives only in someone's intention is waived by absence. So this step OWNS the tracking, and the agent that pushed owns this step.

Steps 6–8 and `/promote` § 9 run from the SHARED checkout (on `dev`): `<your deploy host's CLI>` and `deploy-env-drift.mjs` need `<your deploy host's project link>`, which is gitignored, so a hotfix worktree is not linked to the `<your deploy host>` project.

- **Prod deploy:** `<your post-deploy health smoke>` — its green says the DOMAIN serves a healthy build, not that it serves THIS one. `<your served-sha check>` (triggered by the push to `main`) is what confirms `<your production domain>` serves the pushed sha. Read both for the SHA.

- **ARM THE WATCHER IN THE SAME TURN AS THE PUSH — do not "check back later".** Launch it with `run_in_background: true` so the harness re-invokes this session when it exits; a poll you intend to run by hand dies with your attention:
  ```bash
  # ⛔ PASTE THE 40-CHAR SHA STEP 4 PRINTED. Do not re-derive it — every derivation tried here
  #    (reflog, tee'd file, rev-parse HEAD) was measured returning a sha that was not yours.
  PUSHED=<paste the 40-char sha from step 4's "LANDED <sha>" line>
  case "$PUSHED" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*)
      [ ${#PUSHED} -eq 40 ] || { echo "CI-WATCH STOP: sha is ${#PUSHED} chars, need 40"; exit 1; } ;;
    *) echo "CI-WATCH STOP: PUSHED is not a sha — paste step 4's value"; exit 1 ;;
  esac
  git cat-file -e "${PUSHED}^{commit}" 2>/dev/null \
    || { echo "CI-WATCH STOP: $PUSHED is 40 hex chars but is not a commit in this repo"; exit 1; }
  # READ THIS LINE. It is the only check on the risk the two guards above CANNOT see —
  # a different, valid, 40-char commit sha. Nothing mechanical can catch that; your eyes can.
  echo "CI-WATCH on $PUSHED — $(git log -1 --format='%s' "$PUSHED")"
  for _ in $(seq 60); do
    git fetch -q origin                            # INSIDE the loop: a peer tip pushed AFTER
                                                   # the loop started must become a local object
    RUN=$(gh run list --workflow=Tests --limit 20 --json databaseId,headSha \
          -q ".[] | select(.headSha==\"$PUSHED\") | .databaseId" | head -1)
    # CONTAINMENT FALLBACK — same fence, ABOVE the exit, or it can never run (see below)
    if [ -z "$RUN" ]; then
      RUN=$(gh run list --workflow=Tests --limit 20 --json databaseId,headSha \
            -q '.[] | "\(.databaseId) \(.headSha)"' \
        | while read -r id sha; do git merge-base --is-ancestor "$PUSHED" "$sha" 2>/dev/null && echo "$id"; done | tail -1)
    fi
    [ -n "$RUN" ] && break; sleep 20
  done
  if [ -z "$RUN" ]; then echo "CI-WATCH: no Tests run CONTAINING $PUSHED after 20min — INVESTIGATE"; exit 3; fi
  while [ "$(gh run view "$RUN" --json status -q .status)" != "completed" ]; do sleep 60; done
  gh run view "$RUN" --json conclusion,jobs \
    -q '.conclusion, (.jobs[] | "\(.conclusion)\t\(.name)")'
  ```
  ⛔ **THOSE GUARDS CHECK SHAPE AND EXISTENCE. THE RISK IS IDENTITY, AND IT IS NOT CLOSABLE HERE — READ THE SUBJECT LINE (2026-09-07).** The sha is carried from step 4 to step 6 by *me*, restating a value between two tool calls, and **a mis-restated sha is itself a valid 40-char commit sha** — so the guard cannot fire on the risk it was added for. It is not useless: it catches the abbreviated paste, which was the real bug. It just must not be read as covering restatement.

    | input | shape guard | `cat-file -e ^{commit}` |
    |---|---|---|
    | the true 40-char sha | PASS | PASS |
    | 9-char abbreviated (**the bug that happened**) | STOP | — |
    | the literal placeholder text | STOP | — |
    | 40 chars, first 10 hex, rest not | **PASS — hole** | **STOP (rc=128)** |
    | a tree sha / any 40-hex non-object | PASS | **STOP (rc=128)** |
    | **a DIFFERENT but valid commit sha** | **PASS** | **PASS** |

  *(`cat-file` column: measured here on the real repo, same five shapes.)* `cat-file` closes the garbled half completely and costs one line. **The identity half has no mechanical answer in a later call, which is exactly why step 4 does its own landed-check in the same call as the push and prints the sha for you to copy.** What is left is the printed commit subject: if it does not read like the commit you just pushed, you pasted the wrong sha. That is an eye check, and saying so is the point — a guard that implied more coverage than it has would be worse than no guard.

  ⛔ **A PEER'S PUSH ON TOP ORPHANS `select(.headSha=="$SHA")`, AND THE FAILURE DIRECTION IS THE BAD ONE.** GitHub produces one run for the NEWER tip — which CONTAINS your commits — so the loop burns 20 minutes and exits 3 "INVESTIGATE" while a perfectly good verdict on your code sits unread, i.e. the push's CI verdict never gets dispositioned, which is the one thing step 6 exists to guarantee. Measured 2026-09-05: a peer pushed two commits ~30s after this push and the only Tests run was on their tip. **Fall back to CONTAINMENT, not equality** — the OLDEST run whose head sha has yours as an ancestor (`gh run list` is newest-first, so `tail -1`):
  **That fallback is already IN the loop above — there is no second block to run.** ⛔ *A duplicate fence stood here until 2026-09-07 and it read `"$SHA"`, a variable assigned NOWHERE in this file (`grep -nE '(^|[^A-Za-z_$])SHA=' .claude/skills/push/SKILL.md` → rc=1). It was byte-indistinguishable from the executable block, so a reader running it got an empty sha at every iteration and the identical 20-minute burn the fallback exists to prevent. The reason it survived the same day's fix is that the sweep grepped `PUSHED` and never the sibling spelling. **Enumerate every sha CONSUMER in the file, not the identifier you changed.***
  **Executed against the real orphaned sha 2026-09-06**, with both controls: the equality form returned EMPTY, and the equality form still returns rows for other shas — so the selector is not broken, the sha was orphaned. A run that CONTAINS your sha is a verdict on your code; dispositioning it discharges step 6.

  ⛔ **THE FALLBACK LIVES INSIDE THE LOOP'S OWN FENCE, ABOVE THE EXIT, AND THAT PLACEMENT IS THE WHOLE FIX (2026-09-06).** It first shipped in a SEPARATE fenced block below this paragraph, guarded by `[ -z "$RUN" ]` — the exact state the `exit 3` line above had already exited on. A seat launching the first block as the background script never reached it, so the mechanism this paragraph correctly diagnoses shipped **inert** and the 20-minute burn stayed fully intact. ⚠️ Two smaller shapes fixed with it: `[ -z "$RUN" ] && RUN=$(…)` as a script's **last line exits 1 on the success path** (use `if … fi`), and a RED on a containment run is **not yet attributed to you** — five runs contained that sha, so read the job list before calling the red yours.

  `gh run watch` has glitched with a false `exit 0` — trust `gh run view`.

- **DISPOSITION EVERY JOB, per job, before you report the push complete.** Not "CI is green" — a per-job read, because a `continue-on-error` job (e.g. `audit`) reports red inside an overall-success run and a whole tier can be red while the summary is not. Each non-success job gets one of exactly three: **fold now** · **`todo.txt` row with a trigger** · **named reject with the reason**. An un-dispositioned red is the shape that strands.

- ⚠️ **If the session cannot survive to the verdict, say so and hand it over** — mail a live peer or tell the owner which run id needs reading. The durable backstop is `/hanging-work` **Check 9**, which derives un-dispositioned CI from `gh run list` at wrap; it is the net, not the plan. The `main-red-alarm` job posts a push-to-`main` run whose `ci-gate` is not green to the deploy channel, so a red reaches the owner with no session alive — it tells, it dispositions nothing.

- **Prod-smoke the class** (the auto smoke does NOT exercise sharp): `curl` a real `next/og` OG route (loads the native deps → 200 image/png, zero `ERR_DLOPEN`), and `<your main surfaces>`. Delegate the functional smoke to deploy-support if available.

### 7. Deploy-checklist (per change-type — config not code, invisible to any test)
- **Auth change** (OAuth callback / login flow) → confirm `<your auth provider's PRODUCTION site URL and redirect allowlist>`. Owner-dashboard glance or a real prod login.
- **Native-dep / runtime change** (sharp re-add, `edge→node`, `outputFileTracingIncludes`) → confirm the route renders on `<your deploy host's production runtime>`.
- **Migration in the push** → confirm it's applied to staging+prod: `<your migration-status command>`.
- **ALWAYS — post-deploy config flips** → read `<your post-deploy config-flip list>` and action or explicitly defer each entry. This branch is unconditional because the flips are `trigger-type: manual`: nothing else in the system surfaces them at the moment a push lands (`active-recall.md` — fireable ≠ consequential; a gate whose only mechanism is a human re-reading a row is waived by absence). This step IS their firing mechanism; deleting it silently reverts them to manual-only.
  - ⛔ **Verify prod env state with `<your deploy host's production env listing>`, NEVER by grepping `<your local production env file>`.** The wrong instrument fails to a plausible zero in the permissive direction.
  - ⛔ **AND `<your deploy host's production env listing>` PROVES PRESENCE, NEVER VALUE.** So the clause above answers *"which vars exist?"* and cannot answer *"is the feature on?"* — two different questions, and only the first has a CLI answer. **When an instrument can only prove presence, obtain certainty by WRITING a known value, not by reading harder.**


- **ALWAYS — post-deploy VERIFICATIONS** → `python3 scripts/post-deploy-check-sweep.py` (rc 0 = nothing owed · rc 3 = at least one OPEN check; `--all` shows closed rows as history, `--self-test` covers the filter) and action or explicitly defer each hit. ⛔ **IT REPORTS OPEN ROWS ONLY, AND THAT IS THE FIX — the bare grep this step used until 2026-09-08 matched the FIELD and never read the owning row's CHECKBOX, so a check satisfied months ago was re-published as a chore on every deploy. Measured at the deploy: 3 hits, ALL THREE `[x]` CLOSED, every one satisfied between 2026-09-01 and 2026-09-02 — the entire published list was already done and the owner was handed it twice, in a durable block and in a session closer.** ⛔ **AND THE RE-ARM QUESTION IS ANSWERED, because the field's own wording invites the wrong answer: several read *"after the next deploy"*, which scans as a standing re-arm. It is not. A `post-deploy-check:` on a CLOSED row is the RECORD OF HOW THAT ROW WAS VERIFIED, never a recurring chore — reading it as recurring turns every row that ever carried one into permanent owner work. A closed row that genuinely needs re-checking gets a real RE-OPENING event (flip the checkbox back, dated, with the reason), never a field that silently reads as permanent.** ⛔ **THE `^\s+` ANCHOR IS LOAD-BEARING, NOT TIDINESS — it moved into the script unchanged and its self-test pins it.** The field is an INDENTED meta line; a prose MENTION of it never is. The bare-token form self-matched twice within an hour of the marker being introduced — first the row annotation explaining the marker, then the sweep row quoting its own measuring command — so the count read 2 where 1 row was tagged, i.e. the instrument counted sentences ABOUT itself. Anchoring on STRUCTURE fixes it permanently and lets the prose say the word freely; sanitizing the prose does not, because the next author writing about the marker re-breaks it, reading the field for what to observe and what each reading MEANS. Distinct from the config-flip branch above and deliberately not merged with it: a flip CHANGES prod state, a verification OBSERVES it. Unconditional for the same structural reason — the scanner's `AUTO_KINDS` (`date` / `file-exists` / `dep-version` / `lines` / `git-clean` / `git-dirty` / `grep-present` / `grep-absent` / `commit-touches` / `exit-zero`) has **no deploy predicate**, so "look at prod once the next deploy lands" is INEXPRESSIBLE as a `done-when` and returns zero lines from `defer-trigger-scan.py` forever. This step is its only firing mechanism.
  - **Write the field so it decides, not so it reminds:** name the observation, and name what EACH reading means. A marker that only says "check X after deploy" reproduces the problem it was added to solve, because the next reader still has to reconstruct the criterion.

- **ALWAYS — post-deploy ENV-DRIFT reconcile.** `node scripts/deploy-env-drift.mjs --domain <your production domain>`, **twice: once BEFORE the push and once AFTER the deploy lands.**
  - **Before** — a `DEPLOY-ENV: PENDING-REDEPLOY` reading is the list of production values this push is about to make LIVE. **Name them in the step-8 report**, because that is the only moment anyone sees the change: an env var written days ago by another seat rides this deploy silently, and the person pushing is rarely the person who wrote it.
  - **After** — the same command must read `DEPLOY-ENV: ALL-LIVE`. Still `PENDING-REDEPLOY` ⇒ the deploy did not pick the values up (a build that failed, a rollback, or a var written during the window) — investigate before reporting the push complete.
  - Read the **VERDICT TOKEN**, never the exit code: rc=2 means the instrument failed and nothing was measured, and the tokens go to stdout while `INSTRUMENT-FAILURE` goes to stderr, so an EMPTY stdout means the instrument broke rather than that nothing drifted.
  - ⛔ **This is the third unconditional branch and it exists for the same reason as the two above: a deploy is not a file, so no sweep in this repo can see it.** `/orient` 5e and `/wrap` 6a run the same read, but they fire at session START and session END — the two moments a deploy provably has not just happened. Measured 2026-09-07: three of eighteen top-tier backlog entries were stale because a deploy or an env write had cleared their blocker and nobody looked; two production values sat stored-but-not-live for 38 hours behind exactly this gap. They ride the next push rather than earning a deploy of their own, and this step is what makes "ride the next push" an event somebody actually observes instead of an intention.

### 7b. After an EMERGENCY push — bring `dev` back in line with `main`, the same turn
`main` now carries the hotfix and `dev` lacks it, so the next promote PR is blocked by strict protection
until `dev` contains `main`. Two cases, told apart by what the pushed commits DO:

- **A fix `dev` should also have** (the normal hotfix): run `/promote` step 7's hotfix path from the shared
  checkout (on `dev`) in the same turn as the push; it moves only the changed paths and stops on a dirty one.
- **A REVERT of content `dev` still carries** (a revert of a promote, or of any commit that came from `dev`):
  ⛔ **the hotfix path is WRONG here — it applies the revert to `dev`**, deleting the feature from `dev` and
  from the shared working tree, and the next promote then cannot bring it back (measured in a
  scratch repo: `IN LINE`, rc 0, feature gone). First ask the owner, in these words: **"The emergency revert
  `<sha>` took `<what>` off production. Keep it on dev, so the next promote ships it again once fixed — or
  take the revert on dev too?"** "Take it" ⇒ the hotfix path above, run with `TAKE_REVERT=1` (without it that path STOPs on the revert). "Keep it" ⇒ this block, which records
  `main` as merged into `dev` while `dev` keeps its own tree (so no file moves and peers keep working):

```bash
SRC=$(git branch --show-current)
case "$SRC" in dev) ;; *) echo "STOP: 7b runs on dev only"; exit 1;; esac
HOLD="$(git rev-parse --path-format=absolute --git-common-dir)/promote-inline-hold"
if [ -f "$HOLD" ]; then HC=$(sed -n 1p "$HOLD"); HB=$(sed -n 2p "$HOLD"); TOP=$(git rev-parse --show-toplevel)
  git rev-parse -q --verify "$HB^{commit}" >/dev/null || { echo "STOP: $HOLD has no pre-hotfix commit on line 2 (a v1.6 marker, or damaged) — compare its paths by hand, then delete it"; exit 1; }
  U=$(tail -n +3 "$HOLD" | while IFS= read -r p; do git -C "$TOP" diff --quiet "$HB" dev -- "$p" && ! git -C "$TOP" diff --quiet "$HC" dev -- "$p" && echo "$p"; done)
  [ -z "$U" ] || { echo "STOP: dev is back at the pre-hotfix content on: $U — restore them from $HC, commit, then re-run this step"; exit 1; }; rm -f "$HOLD"; fi
git fetch --prune origin || { echo "STOP: fetch failed — every check below would read stale refs; fix the fetch and re-run"; exit 1; }
git rev-parse --verify -q refs/remotes/origin/dev >/dev/null || { echo "STOP: GitHub has no dev branch (after fetch --prune) — the push below would CREATE it, which is the owner's yes/no (/promote step 0); ask it now, since main moved and dev lacks it"; exit 1; }
git merge-base --is-ancestor origin/dev dev || { echo "STOP: GitHub's dev has commits yours lacks — fetch and reconcile first"; exit 1; }
git merge-base --is-ancestor origin/main dev && { echo "ALREADY IN LINE — dev contains main"; git merge-base --is-ancestor origin/main origin/dev || echo "PUSH NEEDED: GitHub's dev lacks main — push dev in its own background call (below)"; exit; }
NR=""; for c in $(git rev-list --no-merges dev..origin/main); do X=$(git log -1 --format=%B "$c" | sed -n 's/^This reverts commit \([0-9a-f]\{40\}\).*/\1/p' | head -1); { [ -n "$X" ] && { git merge-base --is-ancestor "$X" dev || git merge-base --is-ancestor "$X^2" dev; } && [ "$(git diff -U0 "$c^" "$c" | git patch-id --stable | cut -c1-40)" = "$(git diff -U0 "$X" "$X^1" | git patch-id --stable | cut -c1-40)" ]; } 2>/dev/null || NR="$NR $c"; done
[ -z "$NR" ] || { echo "STOP: main carries commit(s) dev lacks that are not reverts of dev's content:$NR — keeping dev's tree would drop them, and the next promote would undo them on production"; exit 1; }
H0=$(git rev-parse dev)
C=$(git commit-tree "$(git rev-parse "${H0}^{tree}")" -p "$H0" -p origin/main -m "merge: record main's emergency revert <sha>; dev keeps its work")
git update-ref -m "push 7b: record main's revert, dev keeps its tree" refs/heads/dev "$C" "$H0" || { echo "STOP: dev moved — re-run"; exit 1; }
echo "RECORDED $C — now push dev in its own background call (below)"
```

  **Then push `dev` — its OWN call, `run_in_background: true`** (the LIGHT gate can run past the tool's
  foreground cap, D2), after this block or `/promote` step 7's hotfix path:
  `git push origin dev > <scratchpad>/dev-push.txt 2>&1; echo "rc=$?" >> <scratchpad>/dev-push.txt`, then
  D3's ancestry check on the `RECORDED` / `IN LINE` sha. Not through `/push` itself: D0 STOPs on a live hold.

  The block refuses when anything `main` carries beyond `dev` is NOT a git revert of `dev`'s content (a fix
  pushed alongside, or a second emergency push) — keeping `dev`'s tree would drop it and the next promote
  would undo it on production. The revert test reads git's own "This reverts commit <sha>" line, so it is a
  FLOOR: a hand-written revert without that line is not recognised and STOPs as a non-revert. The
  revert's diff must also be the exact inverse of the commit it names (patch-id), so a revert that
  carries an extra change STOPs too.
  The report then says, in words, that the next promote re-ships the reverted content, so it must be fixed on
  `dev` before that promote — and that if the reverted content carried a migration, production already has
  it: record it with an empty `chore(migration): NNNN … staging+prod applied` commit on `dev` before that
  promote's migration gate (it reports the file as unapplied otherwise).

### 8. Report
Before reporting: run `/promote` § 9 against the pushed sha — the watch, the all-clear board, rollback
triggers, mechanism and authority are the same net for both routes (every production change, an
instant-rollback included, is owner-gated: stop · page the owner · wait).
```
## Push — <SHA> (<N> commits)
| Stage | Result |
|---|---|
| Owner authorization | the owner's yes to the named EMERGENCY question for `<sha>` (verbatim) ✓ |
| Integrity (clean tree, drift) | ... |
| Blocking pre-verify (tsc/unit/build) | ... |
| Deferred to CI (integration, e2e) | ⏭ not run pre-push — see CI row |
| Push landed (`--is-ancestor "$PUSHED" origin/main`) | ✓ |
| CI verdict — PER JOB, each dispositioned | ... |
| Prod deploy + auto-smoke + deploy-served (SERVING = pushed sha) | ... |
| Prod smoke | ... |
| Deploy-checklist (auth/native-dep/migration) | ... |
| dev back in line (7b) | IN LINE / RECORDED <sha>, dev pushed in its own call: LANDED / NOT-LANDED |
| Watch (/promote § 9) | all-clear ✓ <rows> / OPEN: <rows> |
```

## Verify-before-assert (the through-line)
Every load-bearing claim here is checked against ground truth, never an exit code / summary / "done": the remote SHA via `ls-remote`; the gate via the push-output grep; the deploy via `gh run` + a prod `curl`; HEAD-drift via a `git diff` classification. **A peer's "ready to push" mail is a SNAPSHOT** — re-derive the tree before acting.

## Scope boundaries
This skill does NOT:
- Decide WHAT to push (that's the work + commit discipline) or write code.

⛔ **A WHOLE-RUN LOG FETCH IS REFUSED WHILE ANY JOB IS STILL RUNNING; A PER-JOB FETCH IS NOT — AND THE REFUSAL LOOKS LIKE AN EMPTY RESULT (measured 2026-09-09).** `gh run view --job <id> --log-failed` on an in-progress run returns exactly one line — *"run <id> is still in progress; logs will be available when it is complete"* — rc=1, **zero stdout bytes**. That is an instrument reading, not a finding, and reading it as *"no failures found"* is the trap. **`gh api repos/:owner/:repo/actions/jobs/<job-id>/logs` returns the COMPLETED job's full log immediately**, while siblings still run: measured rc=0 at 239,842 / 226,895 / 234,641 bytes on three finished shards of a run whose `status` still read `in_progress`. So a red shard is diagnosable the moment IT finishes, not when the slowest unrelated job does — which on this repo's `Tests` workflow is a difference of about an hour. `grep -rn -F 'actions/jobs'` over `.claude/rules/` and this file returned **0** before this line; `gh run` appears here 10 times, so the corpus was reachable and the fact simply was not in it.
⛔ **AND A JOB THAT REPORTS `success` CAN CARRY A FAILED TEST — READ THE COUNTS LINE, NOT THE CONCLUSION.** Playwright retries: a spec that fails and passes on retry leaves the job green and prints `N flaky` in its own summary. Measured the same run: `e2e (1)` = **success**, and its log carries a genuine `1 flaky` — the notification-bell keyboard test failed `toBeFocused` on the first attempt and passed on the second. Nothing in the run summary shows it. ⚠️ **Beware the use-vs-mention trap when you go looking:** `grep -acF 'flaky'` over that log reads 5-6 per job, and almost all of those hits are the workflow's own reporting SCRIPT (`const emoji = failed === 0 ? (flaky ? …`). Filter the script lines out, or the counts line is buried in its own source.
- Bypass the owner gate (it enforces it).
- Replace `scripts/pre-deploy-check.sh` or the `.githooks/pre-push` gate (it pre-runs + relies on it).
- Handle rollback — `/promote` § 9 owns it for both routes, owner-gated (push is forward-only; a bad deploy → `<your deploy host's rollback>`, or a revert commit — and a revert IS an emergency hotfix: a worktree cut from `origin/main`, steps 0–4 with the named question; never a revert made on `dev` in the shared checkout and pushed, which ships `dev`'s queue with it).

## Revisit triggers
- If `gh run watch` stops glitching (false `exit 0`), simplify step 6 back to it.
- If the deploy-support-delegation pattern proves unnecessary (solo pushes verify cleanly), drop it.
- If a 3rd deploy-checklist branch recurs, extract a checklist matcher.
- If a deferred-tier regression ever reaches prod, that is the trigger to re-gate integration (the cheaper of the two, ~4 min).
