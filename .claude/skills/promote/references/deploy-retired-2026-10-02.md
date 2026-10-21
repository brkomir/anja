# `/deploy` — RETIRED 2026-10-02

`/deploy` folds into `/promote`, whose step 9 carries the watch,
the all-clear board and the rollback rules. Its LAUNCH MODE section is the live reference `/promote` step 9 points to. In § LAUNCH MODE,
"rollback authority" means owning the page-the-owner duty across overlapping windows; the decision is the owner's
(§ ROLLBACK; `/promote` § 9).
Where it says "invoke `/push` end-to-end" for a production push, read `/push --emergency`; where it says
"re-invoke `/deploy`", read `/promote`.

---


# Deploy — production deploy shepherd (+ window-scoped launch mode)

`git push origin main` is a **production deploy that goes live BEFORE CI completes**, so the deploy is immediate and the post-deploy watch is the only safety net. `/deploy` owns that net.

It is **NOT a standing "hub."** The deploy trigger is the owner's "merge it" for a promote head, or the owner's yes to `/push` step 0's named EMERGENCY question, in-session — there is no async cross-session request stream to stand ready for (unlike `/review-hub`, which absorbs a stream of `--code` delegations), and `origin/main..HEAD` already self-aggregates the deploy candidate under commit-direct-to-main. So `/deploy` is a **procedure** — pre-warm → push → watch → all-clear/rollback — run inline and re-entrant. It grows a window-scoped LAUNCH MODE (the standing apparatus) only when launch-density makes that apparatus pay.

**Reason to exist over bare `/push`:** `/push` is the complete owner-gated push action (integrity → fleet write-hold → BLOCKING pre-verify → push → verify-landed → CI-watch → smoke → checklist; ⛔ *this said "pre-verify+e2e" until 2026-09-06 — the second carrier of the same three-week-stale claim corrected in Phase 2 below, and it is why one correction is never enough on a file that states a thing twice*) but **explicitly scopes OUT rollback** and stops at a point-check. `/deploy` adds (a) the cheap-tier **pre-warm** so go-time passes first-try, (b) the **sustained post-deploy monitoring window**, and (c) the **rollback** decision — plus, in launch mode, continuous rollback ownership across overlapping deploys.

## When to use
- **Per-deploy (default):** shepherd a deploy worth owning the watch+rollback for — a native-dep / migration / auth / billing change (the high-blast-radius classes), or any deploy you want pre-warmed + watched rather than a bare `/push`.
- **Launch mode (owner-armed, window-scoped):** the owner arms it for a launch / hotfix / paid-cutover window where deploys cluster (several/day) and rollback ownership must stay continuous.
- NOT for a routine solo push with nothing to watch — run `/push` inline.

## Iron rule — the push is owner-gated
Never `git push origin main` without the owner's current-turn yes to `/push` step 0's named EMERGENCY question for that sha (a bare "push it" routes a hotfix to `/promote`). Readiness ≠ authorization — a green pre-warm is not a go (`/push` iron rule). `.claude/hooks/block-push-without-approval.sh` enforces this at the tool layer (exit 2 unless `ALLOW_PUSH=1`); `/deploy` SATISFIES the gate after the go, never bypasses it.

## Process (per-deploy — the default)

### Phase 1 — PRE-WARM (the cheap tier; the value-add)
Keep the unpushed queue ready so the owner-go is one fast command. This is **early-warning, never a gate** — `/push` re-runs the authoritative full gate at go regardless, so the cheap tier can be coarse / lazy / debounced with ZERO safety loss.
- Reuse `/push` step-1 drift classifier: `git diff --name-only origin/main..HEAD | grep -cE '^(src|tests)/'`. docs/meta-only drift → **no-op** (gate evidence holds; ~77% of commits). `src/`·`tests/` drift → run the cheap tier.
- Cheap tier on src/test drift: `tsc --noEmit` (~15s, on every such drift) + `vitest --changed origin/main` (affected unit only) **debounced to commit-quiescence** (coalesce a burst into one run; skip if HEAD unchanged or a run is in-flight). Track the last-green SHA.
- Do NOT run integration / e2e / `next build` here — they need Docker/build, can't keep up with drift (60-124 commits/day vs ~2 deploys/day → continuous verification burns trees that never ship + contends for the shared dev box), and they run at go-time anyway. The cheap tier is the *pre-warm that makes go-time pass first-try* — strip it and `/deploy` degenerates to "just run `/push`".

### Phase 2 — GO (owner "merge it" → /promote; or the owner's yes to the named EMERGENCY question → /push)
- **Since 2026-09-08 the GO is normally a MERGE, not a push:** `/promote` (precheck → migrations on
  production → PR → full CI → owner "merge it" → a merge commit → `dev` back in line with `main`; its own
  command since 2026-09-29, it was a section of `/push`). A hotfix's normal route is that pull request too; the direct push below is only the EMERGENCY override, on the owner's yes to `/push` step 0's named question, never for `dev`'s work. The pre-warm, the watch and the rollback are unchanged either way.
- Precondition: the owner's current-turn "merge it" for the promote head (→ `/promote`), or the owner's yes to `/push` step 0's named EMERGENCY question for that sha (→ `/push`). A bare "push it" routes to `/promote`. Readiness ≠ authorization → ask, never self-authorize.
- Invoke `/push` end-to-end — it owns integrity → **fleet write-hold (step 1b)** → the BLOCKING pre-verify → `ALLOW_PUSH=1 git push` → verify-landed → CI watch → auto-smoke → deploy-checklist. The gate runs HERE, ONCE, on the owner-frozen tree. Do NOT re-implement or duplicate `/push`.
  - ⛔ **THIS LINE READ "full pre-verify **incl. e2e** (`scripts/pre-deploy-check.sh` + `scripts/run-changed-e2e.sh`)" AND WAS STALE BY THREE WEEKS — corrected 2026-09-06.** The blocking gate is **tsc + unit + build**, and integration + e2e are DEFERRED to CI. `/push` step 2 has said so since; this sibling did not, so a reader arriving through `/deploy` was told the push carries coverage it does not. **Read the gate's composition out of `/push` step 2, never restated here** — that is the surface the owner rules on.
  - ⚠️ **`verify-landed` is NOT `ls-remote == HEAD` on a shared branch** — a peer pushing on top falsifies it within seconds (measured 30s, 2026-09-05). `/push` step 5 carries the two instruments that do answer it: `merge-base --is-ancestor` for *did my commits land*, and `git reflog show origin/main --date=iso` for *did a push happen, and when*.

### Phase 3 — WATCH (the post-deploy monitoring window — the gap /push leaves)
`/push` step 6 is a *point* smoke; `/deploy` owns the *sustained* watch after. The window stays OPEN until every All-Clear row is green, and NEVER closes before the first live invocation (the cold-start + cron-on-the-hour classes only manifest on first real request — **signal-anchored, NOT a clock**; no human-time floor).
- **Auto smoke:** confirm `<your post-deploy health smoke>` ran GREEN for the SHA: `<your health route>` healthy + `<your smoke pages>` 200; `<your alert channel's alerts>` on failure.
- **Native-dep (the auto-smoke does NOT exercise `<your native image library>`):** `curl` a real `next/og` OG route → 200 `image/png`, zero `ERR_DLOPEN`; one real prod `<your core product operation>`. Treat the first prod deploy after ANY native-dep change as a boundary-exercise event (`nextjs.md`).
- `<your error monitor>`: error rate vs the pre-deploy baseline, release-correlated.
- **Auth (if changed):** one real OAuth round-trip lands `<your post-login landing page>`, NOT localhost (prod `<your database vendor>` project config).
- **Cron (if processing changed):** ≥1 clean `<your scheduled job>` tick.

### Phase 4 — ALL-CLEAR or ROLLBACK
- All-Clear board (below) fully green → stand down.
- A VERIFIED rollback trigger fires → the Rollback procedure (below).

### Phase 5 — RE-ENTRANT close
After all-clear, stand down; re-invoke `/deploy` per the next go ("merge it", or a yes to the emergency question) — this covers back-to-back deploys without any standing machinery.

## LAUNCH MODE (owner-armed, WINDOW-SCOPED)
Armed by the owner for a launch / hotfix / cutover window where deploys cluster. It adds the standing apparatus the per-deploy default deliberately omits — and ONLY for the window: armed at window start, torn down at window end, **NEVER standing between launches** (where there is nothing to stand ready for).
- **ARM a persistent listener** — Monitor tool, `timeout_ms: 1800000` (the tool has no `persistent` parameter and caps every watch at 30 minutes — re-arm on each expiry), `python3 scripts/session-manifest.py mail-listen --poll 30`. Window-scoped: `TaskStop` it at window retirement (the orphaned-listener leak).
- **BROADCAST the baton + HOLD-PUSHES** — `mail-send --to all`: this session holds the deploy baton for the window; peers HOLD pushes (`mail-await --signal deploy-clear --from <this-sid>` — blocks only their push step, they keep working). Single-writer-to-prod: a concurrent push races the deploy under observation AND can re-deploy a broken successor over a rollback.
- **SIGNAL PROTOCOL (codified 2026-07-02 from the 06-28→30 window — the semantics live HERE, not in old mail bodies):**
  - **Vocabulary (canonical `signal:` values):** `deploy-baton` (baton claim + hold-pushes ask) · `deploy-ready` (a peer's work is committed + wants in — ALWAYS this literal token; sender identity comes from the mail's `from:`, never a per-sid dialect like `ready-<sid8>`, which broke exact-match awaits in the founding window) · `deploy-hold-ack` (baton stood down) · `deploy-gate-<N>` (owner re-sized the quorum to N; name the member sid8s in the body) · `deploy-clear` (live + healthy; holds released) · **`writehold-armed` / `writehold` / `writehold-lifted`** (added 2026-09-06 — the ROUTINE-push write-hold; see the clause below).
  - ⛔ **TWO DIFFERENT HOLDS, AND THIS SKILL ONLY EVER CARRIED ONE.** `deploy-baton` asks peers to hold **PUSHES** — a single-writer-to-prod concern, and its own text says *"blocks only their push step, they keep working"*. **That working state is exactly what corrupts a push gate**, because `.githooks/pre-push` runs `scripts/pre-deploy-check.sh` in the SHARED WORKING TREE with no stash and no temp checkout, so `npm test` and `next build` measure whatever every seat has dirty at that instant. The write-hold is therefore a different ask with a different vocabulary, it belongs to EVERY push and not just a launch window, and its procedure lives at **`/push` step 1b** (the three-broadcast ARM → GO-QUIET → ALL-CLEAR protocol, its mandatory expiry, and the measured reason a quiet window that LOOKS observed may be a confound).
  - **Quorum:** the owner sets N ready-signals + the membership. Collect via the armed listener + per-sender `mail-await --signal deploy-ready --from <sid8>` (exact-match, single-completion; an N-of-M await primitive is a DEFER until a window's manual collection observably fails — 06-30 collected 3/3 fine).
  - **Retraction = reset-to-0 with void-cascade:** ANY retraction voids ALL dependent ready-signals (a signal gated on retracted work never counted), the count returns to 0, and the eventual push needs fresh signals + the FULL `/push` gate from scratch. No partial credit carries over.
- **CONTINUOUS ROLLBACK OWNERSHIP across clustered deploys** — the one thing per-deploy cannot do: when deploy A's monitoring window is still open as deploy B is prepared, the baton holds rollback authority across the overlap (A's regression surfacing during B's window has an owner). The watch windows stack; the baton spans them.
- Pre-warm + go + watch run per the per-deploy phases above, but the session stays armed across the cluster.
- At window end: `mail-send --to all --signal deploy-clear` (release the holds) + `TaskStop` the listener + a mailed handoff if not fully drained.

## ROLLBACK — triggers · mechanism · authority
**Triggers (revert NOW). VERIFY against ground truth THIS turn** (direct `curl`, reproduced on ≥2 paths) — a real dlopen/down failure is reproducible by nature; a single flaky probe is not a trigger:
- `<your health route>` 503 / db:fail sustained past the first probe · `<your post-deploy health smoke>` FAILS · `ERR_DLOPEN_FAILED` on any route · product-wide down: `<your core product paths>` / OG 500s on ≥2 paths · auth bounces to localhost / login 500s · a release-correlated `<your error monitor>` spike mapping to one of the above.

**Mechanism:**
- `<your deploy host's instant rollback>` — promote the last known-good deploy. Seconds, no rebuild, no downtime. **CODE ONLY — NOT migrations / `<your payment provider>` config / env / external state.**
- **The migration asymmetry decides whether instant-rollback is even safe:** no migration, or backward-compatible (old code runs against new DB) → instant-rollback is clean. NON-backward-compatible (drop/rename/constraint-tighten) → instant-rollback is UNSAFE; stop-the-bleed is the relevant KILLSWITCH, `<your killswitch variables>`, and the fix is a forward-fix migration (forward-only, `migrations.md`) or PITR. Record the backward-compat field at pre-warm time.
- **git revert + re-push** — slower (full rebuild + deploy-before-CI again); only when the fix needs code no prior deploy has. The revert IS an emergency hotfix: a worktree cut from `origin/main`, `/push` steps 0–4 with the named question — never a revert made on `dev` in the shared checkout and pushed, which ships `dev`'s queue with it. Its `/push` 7b is the REVERT case, which asks the owner whether `dev` keeps the reverted content or takes the revert, and never runs the hotfix path by default. Until `dev` has been pushed to GitHub, 7b STOPs on that open first-push question. **PITR** — catastrophic data corruption only.

**Authority (the AUTONOMOUS branch RETIRED):**

**If you find yourself
assembling a case for why your production action is covered, the assembly IS the signal to
stop and ask.** The stronger the case feels, the more this applies.

- **OWNER-GATED (ships new code OR touches the DB):** git revert + re-push (by `/push`'s emergency route from a worktree cut from `origin/main`), any forward-fix migration, PITR / data restore, and any rollback where the bad deploy carried a non-backward-compatible migration.
- The line, as it now stands: **every production change is owner-gated.** The old split (un-ship = autonomous, ship-new-or-DB = owner-gated) described a real difference in blast radius and it is still a useful way to think about RISK — it is no longer a way to think about AUTHORITY.

## ALL-CLEAR criteria (the explicit stand-down board)
Stand down (per-deploy) / release `deploy-clear` (launch mode) ONLY when every applicable row is green:
- [ ] `<your post-deploy health smoke>` GREEN: `<your health route>` healthy + `<your smoke pages>` 200
- [ ] each changed critical-path route exercised live once, no error
- [ ] `<your error monitor>` at the pre-deploy baseline through first real traffic
- [ ] (native-dep) a `<your route that loads the native image library>` → 200 `image/png`, zero `ERR_DLOPEN`
- [ ] (processing/cron) ≥1 clean `<your scheduled job>` tick
- [ ] (auth) one real prod OAuth round-trip lands `<your post-login landing page>`
- [ ] (migration) applied staging+prod confirmed + dependent code path works live
- [ ] `/push` deploy-checklist all ✓

## Disciplines
- **owner-gate is absolute** — ready ≠ pushed; only the owner's "merge it" for the head, or the owner's yes to the named EMERGENCY question for the sha, ships. ⛔ **The autonomous-rollback carve-out is RETIRED, so a confirmed prod outage means STOP, say what you would do, and WAIT for the owner. There is no un-ship exception left; see § ROLLBACK.**
- **pre-warm is early-warning, never a gate** — the full gate is `/push`'s at go-time; never let a green cheap-tier justify skipping any part of it.
- **verify the trigger before rollback** — ground-truth-confirmed (direct curl, ≥2 paths), never a relayed alert.
- **the migration asymmetry decides rollback-availability** — record it at pre-warm; non-backward-compat → killswitch, not code rollback.
- **don't stand down before first live invocation** — signal-anchored, not a clock (the cold-start dlopen + cron-on-the-hour classes manifest on first request).
- **launch-mode standing is WINDOW-SCOPED** — armed for the window, torn down at window end; a listener found running between launches is the orphan-leak bug.
- **read COUNTS, not exit codes** on every gate + the push pre-verify; a peer's "ready" / a `/review-hub` verdict mail is a SNAPSHOT — re-derive before acting.
- **mail the handoff, don't leave it in a wrap** — an un-mailed deploy state orphans the push-hold.

## Related layers
- `/push` (the owner-gated push action it wraps at go) · `/deploy-check` (`scripts/pre-deploy-check.sh`, the pre-verify `/push` runs) · `/preflight` (manual QA gate — a pre-warm input for high-blast-radius changes) · `/migration` + `/migration list` (applied-status + the backward-compat field) · `/review-hub` (the matched READ-ONLY sibling — supplies `DEPLOY-CLEAR` / `DEPLOY-HOLD` verdict tokens `/deploy` consumes as ship gates — read them from the mail's typed `signal:` frontmatter, not the subject line: an observed verdict subject truncated to "…DEPL").
- `<your post-deploy health smoke>` · `scripts/{pre-deploy-check,run-changed-e2e,e2e-local}.sh` · `.githooks/pre-push` · `.claude/hooks/block-push-without-approval.sh` · the `scripts/session-manifest.py mail-listen/mail-await/mail-send` coordination bus.

## Anti-scope / Revisit
- NOT a code review (`/review-hub` + `--code`). NOT a launch-readiness tracker. Does NOT re-implement `/push` / `/deploy-check` / `/preflight` (it sequences them). Does NOT decide WHAT to deploy. Does NOT bypass the owner gate (**the autonomous-rollback carve-out is RETIRED; see § ROLLBACK**).
- Revisit: If `/deploy` runs 3× and the pre-warm/watch loop drifts from this spec, fold the corrections in.

## Origin
Designed 2026-06-27 — a 2-expert design pass (devops-deploy-expert + launch-ops-expert) + a 5-lens decision panel (saas-architect / devops / launch-ops / performance / saas-engineer) on two forks: (1) pre-verify cadence → **tiered/lazy** (continuous full-e2e rejected 5/5: it can't keep up with 60-124 commits/day, ~95-98% verifies trees that never ship, and it contends for the shared dev box); (2) session model → **per-deploy default, NOT a standing hub** (the review-hub standing-service symmetry is false — no async request stream, owner-in-session trigger, HEAD self-aggregates). Formalizes the informal "deploy/push-support" role the fleet enacted ad-hoc (2026-06-25, session retiring as `--code` hub → deploy-support).
