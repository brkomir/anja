---
name: orient
description: Quick orientation at the beginning of a work session. Use at session start to see what's happening, what's pending, and where to start.
---

# Orient — Session Start

Quick orientation at the beginning of a work session. Shows what's happening, what's pending, and where to start.

## When to Use
Start of every session, or when returning after a break.

## Process
1. Show git branch + last 3 commits
2. Check for uncommitted changes (warn if parallel session files present)

   **2a. Session manifest write + peer-summary surface (MANDATORY at session start).** Run:

   ```bash
   python3 scripts/session-manifest.py prune       # delete manifests for sessions stale >24h
   python3 scripts/session-manifest.py write       # write own manifest from current jsonl
   python3 scripts/session-manifest.py read          # own session id + peer-session summaries
   python3 scripts/session-manifest.py hub-discover  # surface any LIVE review-hub (PULL discovery) + GC dead markers
   ```

   Output is a `You are \`<sid8>\`.` identity line followed by a markdown block under `## Peer sessions (from cached manifests)` — include BOTH verbatim in the /orient report so the owner sees, at session start, **which session this terminal is** and which other sessions are active and what they're touching. The identity line matters because every cross-session primitive (`mail-send --to`, `whose-edit`, a peer citation) is keyed on that 8-hex id, and `read` otherwise lists only PEERS — leaving the owner to run `/peers` just to learn which terminal they're looking at. **`hub-discover`** additionally surfaces any live `--code` review-hub (a `🎧 live` block) so this session delegates its Step-2b reviews there instead of self-reviewing — the durable PULL complement to the hub's 48h push re-broadcast (which staleable mail can't guarantee reaches a peer that booted mid-hub). The SessionStart hook fires the same `hub-discover` automatically; this is the manual/mid-session mirror. Sensitive-surface refs (Meta system / ToS / migrations / content moderation / email registry hygiene / PRICING) are surfaced first to flag codified-policy domain overlap. Cost: ~150ms (manifest reads are O(1) per peer vs jsonl re-scan).
3. Count open todo items from todo.txt
4. Show system stats — read live from the filesystem, never hardcode:
   - Skill count: `ls .claude/skills | wc -l`
   - Memory index lines: `wc -l < ~/.claude/projects/<project-key>/memory/MEMORY.md`
   - Latest meta version: first `## v*` heading in `.claude/skills/meta/CHANGELOG.md`
5. Check flow/feature tracker for next audit target — count Status column directly in `project_critical_flows*.md` + `project_feature_audits*.md` + `project_ops_register*.md`. ⛔ **THREE DEFECTS FIXED HERE 2026-09-09, ALL SILENT: (a) the GLOB — `project_critical_flows` is a router plus 11 shards, so a bare-router count reads ZERO; (b) the command ended in a bare `<tracker>` placeholder, which fails as an empty `---` with no error; (c) `$4` IS NOT THE STATUS COLUMN in every row — 14 of 69 flow rows use `| # | Flow | Tier | Status |`, so a fixed index reports PRIORITY as STATUS.** Key the column off each file's own header instead:
   ```bash
   node scripts/tracker-list.mjs flows    --counts
   node scripts/tracker-list.mjs features --counts
   node scripts/tracker-list.mjs ops      --counts
   ```
   ⛔ **THE AWK THAT STOOD HERE FOR ONE DAY WAS WRONG ON A TRACKER THIS STEP ITSELF PRESCRIBES IT
   FOR, AND NOT BY EMPTYING — BY REPORTING PLAUSIBLE GARBAGE.** Against `project_feature_audits.md`
   it returned **16 ✅ COMPLETE** and 11 buckets that were audit-tier DATE TOKENS, where the truth
   is **24 COMPLETE of 32**: that tracker has a FOURTH table header carrying no Status column, so
   rows under it were scored against a stale column index. **The `unkeyed` guard shipped beside it
   read `0`** — it counted only inside the id predicate, so a header miss never reached it. Each of
   these three commands exits `rc=1` naming the row ids instead, and `flows` reproduces the
   canonical pointer byte-for-byte (`69 flows (64 COMPLETE / 4 RESEARCH_GAP / 1 NOT AUDITED)`).
   ⚠️ **Run it PER TRACKER — the id class and status vocabulary differ** (the ops register uses `O1`-style ids, outside `[0-9F]+`, and returns EMPTY here, which reads as "nothing to reconcile"). A non-zero `unkeyed` means a file's header was not found: investigate, do not report the count. **Do NOT quote count summaries from MEMORY.md tracker-pointer index lines** — those are written-once and never auto-recomputed when the underlying tracker mutates (drift hazard). Always verify against the canonical Status column before reporting counts.
5b. **Audit-tier token drift check (read-only, warn-mode per warn-before-block discipline).** Run:
   ```bash
   node scripts/audit-tier-drift-check.mjs
   ```
   It flags any flows/features row whose Final-Audit narrative shows an audit marker (a `--code`/builder≠breaker wave OR a `--final-audit` panel) that the compact `Audit Tiers` token is MISSING the matching `c:`/`v2:` key for — the structural net under the process-only stamp-on-audit rule (`flows/SKILL.md` item (d), not in this copy; the drift class reconciled across the flows + features trackers 2026-06-23, after a 5-agent sweep had MISSED one flow's folded-`--code` wave that was caught later). Surface any non-clean finding verbatim; each is a CANDIDATE to VERIFY against git + the narrative before stamping (the detector is a heuristic scoper — a `--code` mention in a non-wave context is a false positive), then stamp the missing key in that row's token. Silent when clean; `--strict` exits non-zero (pre-push/CI candidate after a warn-mode window). Ops uses the `prov:` grammar (no v2/c drift class) → token-coverage report only. **Also auto-fires at every session start** via `session-start.sh` — so a session that skips `/orient` still catches this drift (bounded + silent-when-clean); a manual `/orient` run is a re-check.
5c. **Surface-register SSOT reconcile (read-only, warn-mode per warn-before-block discipline).** Run:
   ```bash
   node scripts/surface-register-drift.mjs
   ```
   `project_surface_audits.md` declares its S# **rows** the source of truth and the coverage **matrix** a derived view ("edit a row's `Lenses:` field, then re-transcribe the matrix cell"). Nothing enforced that, and on 2026-07-09 it had inverted: a security sweep updated the MATRIX cells for five surfaces to its `→S<n>` sweep marker and left their row vectors at `·`. That is not cosmetic — the file's own editing procedure tells the next editor to re-transcribe the matrix FROM the row, which copies the stale `·` back over the sweep marker and **silently erases the record that the sweep ever ran**. tsc/unit/lint are all blind (it's a markdown memory file). The detector reports three classes: **DRIFT** (row ≠ matrix), **NO-SSOT** (a surface in the matrix with no `Lenses:` vector to derive from), **NOT-IN-MATRIX** (a row vector invisible to every matrix reader). Silent when clean. **Do NOT blind-transcribe a DRIFT finding** — check which side is FRESH first (a sweep that touched only the matrix leaves the row stale, so "row wins" would destroy the newer value). `--self-test` covers the parser; `--strict` exits non-zero (pre-push/CI candidate once the baseline is clean — it is not, as of 2026-07-09: 6 open findings). Sibling of `audit-tier-drift-check.mjs` (5b) and `migration-notation-reconcile.mjs` (6). **Also auto-fires at every session start** via `session-start.sh` (same block as 5b) — bounded + silent-when-clean; a manual `/orient` run is a re-check.
5d. **i18n prose-drift sentinel (read-only, warn-mode per warn-before-block discipline).** Run (the script is not in this copy):
   ```bash
   node scripts/i18n-prose-drift.mjs
   ```
   Flags any `messages/*.json` key whose `en.json` value is git-NEWER than its locale values — an EN-only PROSE edit silently stales all 11 locales with **no CI signal**. `translation-untranslated-guard` only catches non-EN==EN (a placeholder); `pricing-copy-constants-drift` only catches NUMBERS. Prose is the uncovered half, and it is where the false *claims* live. **So a reworded condition needs this check, not the numeral suite:** when an EN value is reworded to change when an offer applies, a locale that keeps the old wording states the wrong conditions for the offer, and the drift suite **inspects and passes** it, because it asserts the numeral and is blind to the timing clause. Output is a triage list, not a verdict — **the tool cannot know whether the locale is wrong**, only that the EN source moved after it. Silent when clean; ~244 candidate keys at wiring time (2026-07-10), so expect a list: triage by hand, do NOT bulk-"fix". Sibling of `audit-tier-drift-check.mjs` (5b), `surface-register-drift.mjs` (5c) and `migration-notation-reconcile.mjs` (6). Closes the gap `.claude/rules/i18n.md` (not in this copy) names as "Proposed sentinel (NOT yet built)". **Deliberately NOT in the SessionStart hook** (unlike siblings 5b/5c which were moved there 2026-07-16): this one is ~3.5s (git-timestamps ~1200 keys) + a ~1200-candidate standing backlog with low per-session delta — too slow + noisy for an every-session hook. Held `/orient`-only for now — deferred on the measured 3.5s runtime: of the three sentinels slated for the hook, the 2 fast register checks moved and this one awaits a confirm/override given the latency it adds to every session start.
5e. **Deploy/env drift — is the stored production config actually LIVE? (read-only, warn-mode per warn-before-block discipline).** Run:
   ```bash
   node scripts/deploy-env-drift.mjs --domain <your production domain>
   ```
   Compares the newest production env write against the **SERVING** production deploy — resolved by DOMAIN via `vercel inspect <domain> --json`, **not** by max-`createdAt` over `vercel ls --prod --json`, which carries no serving marker at all (measured 2026-09-07: its deployment objects are exactly `buildingAt, createdAt, creator, meta, name, ready, state, target, url`) and therefore inverts every verdict under a rollback. It also names a rollback when the serving build is not the newest. Prints one verdict token — `DEPLOY-ENV: PENDING-REDEPLOY` (values stored but not live; `NEXT_PUBLIC_*` are baked at BUILD, so they need a rebuild) or `DEPLOY-ENV: ALL-LIVE` (every stored value is deployed, so **any row still saying "waiting on a redeploy" is STALE**). ⛔ **Read the verdict TOKEN, never rc** — exit 2 means the instrument failed and NOTHING was measured; `--strict` exits 1 on pending. **Why it exists, measured 2026-09-07 on the `/backlog` top-tier sweep: of eighteen top-tier entries, four were stale and THREE went stale for this one reason — the blocker cleared OUTSIDE the repo.** One backlog entry asked the owner for a production value that had already been supplied; another entry and a tracker row both sat open behind a redeploy that had landed two days before, one of them for its whole life. Every sweep we own reads FILES — `git log`, `todo.txt`, the trackers, `/triggers`, `/hanging-work` — and a deploy is not a file, so nothing could see it. ⚠️ **Use `--json`, which the script does: the HUMAN `vercel env ls` column is the CREATION date and an in-place `--force` rewrite leaves it untouched** — so for a production value rewritten in place, `--json` shows createdAt and updatedAt apart while the human column shows only the older age. That is why age can look unable to date a value; through `--json` it can. ⛔ **Read the TOKEN, and note that NO TOKEN AT ALL is also a reading** — the two verdict tokens go to stdout while `INSTRUMENT-FAILURE` goes to stderr, so a caller piping stdout alone sees an empty result rather than an error. **Deliberately NOT in the SessionStart hook**, same call 5d made and for the same reason: **~5.3s and THREE network round-trips** (measured 2026-09-07 over three runs: 5.55 / 5.25 / 5.15s; the figure read "~3.6s and two" until the serving-resolution fold added the third call and the number was not re-derived with it), too slow for every session start — `/orient` and `/wrap` only. **It was NOT green at birth** — two feature-flag values written after the last deploy, and therefore not live, turned up on its first run. `--self-test` covers both verdict branches, the tie boundary, and the serving-resolution shape guards — **run it for the count, which the script DERIVES (`${cases.length}`); do not restate one here.** At 2026-09-07 it reads **12/12 PASS**, and inverting the pending comparison reddens **3 of 12**. ⭐ **The interesting part is WHICH arm survives, and it is not the one a subsystem story predicts.** The 12 split **4 / 8** — four call `pendingAfter`, eight call `inspectProblem` — so the mutation leaves an arm standing INSIDE the subsystem it mutates: `tie is not pending`, which survives because a tie has `at === deployAt` and fails BOTH the original `>` and the inverted `<`. That is a property of the BOUNDARY, not of subsystem separation, and it is evidence the tie arm tests the boundary rather than the direction. ⚠️ *Read "3 of 12: the 3 verdict-branch arms, the other 9 exercise `inspectProblem`" until 2026-09-07 — the partition was 3+9 where the array is 4+8, and it left no home for the tie boundary the SAME SENTENCE lists as covered two clauses earlier. Confirmed by counting the array. Third generation of one defect in this one line: a typed number inside a clause written to stop typed numbers. **Derive the split — `grep -c pendingAfter` / `-c inspectProblem` over the `cases` array — do not read it from here.*** ⚠️ *This clause said "4 arms; reddens 3 of 4" until 2026-09-07 — stale by eight arms, and it sat in the SAME SENTENCE as the timing figure corrected one clause earlier. The general shape is worth more than the instance: a line can carry more than one stale number, and fixing the one you were sent after makes the whole line FEEL re-derived.* Sibling of `audit-tier-drift-check.mjs` (5b), `surface-register-drift.mjs` (5c), `i18n-prose-drift.mjs` (5d) and `migration-notation-reconcile.mjs` (6).

6. **Migration applied-notation reconcile (Layer 2 — deterministic, read-only).** Run the reconcile (the script is not in this copy) — it replaces the former manual grep+probe prose with one engine that schema-probes both DBs for any recent migration lacking a `staging+prod applied` notation:
   ```bash
   node scripts/migration-notation-reconcile.mjs
   ```
   It classifies each un-fully-notated recent migration against ground truth: 🟢 **APPLIED-UNRECORDED** (live on both DBs, notation missing → it prints the exact backfill `git commit --allow-empty` line; run it), 🔴 **UNAPPLIED** (absent on both → `/migration <file> --both`), 🟡 **PARTIAL** (one env only → finish the apply), ⚠️ **MANUAL** (no auto-probeable object — DROP/DATA/GRANT — probe by hand). Silent/clean when every recent migration is notated; surface any non-clean output verbatim. **Why a script, not the old prose:** the manual `git log | grep` + schema-probe procedure was re-interpreted each session and missed applied-but-unrecorded drift — **5** such migrations had accumulated by 2026-06-23 — so the deterministic ground-truth check replaced it. **Degrades silently** when the local env file's DB URLs are absent (CI/headless); the manual fallback then stays valid: `git log --oneline --all | grep -iE "<NNNN>.*(applied|staging\|prod)"` per migration (the notation often lands in a SEPARATE `chore(migration): … applied` commit, sometimes `--allow-empty`), **never** `git log -1 -- <file>` (returns the feature commit, false-flags notated-elsewhere migrations). Schema-probe is the truth (read-only `pg_indexes` / `information_schema.columns` / `information_schema.tables` against the staging and prod databases), not the commit log — which is exactly what the script automates. ⚪ **SUPERSEDED** (added 2026-09-08, `migration-notation-reconcile.mjs` temporal pass): a LATER migration drops the probed object, so the absence is EXPECTED and the probe cannot separate applied-then-dropped from never-applied — the verdict WITHDRAWS the remedy; do NOT re-apply, resolve from the recording commits of BOTH numbers.
7. **User profile staleness check.** Grep `last-reviewed:` from `~/.claude/projects/<project-key>/memory/user_profile.md` frontmatter. Compare to today. If >30 days: print one-line flag "⚠️ user profile is N days stale — run `/me check` to refresh (30-day cadence)." If >90 days: upgrade to "🔴 user profile is N days stale — `/me check` strongly recommended before trusting defaults." Otherwise silent.
8. **Defer-triggers-fired scan (added 2026-05-18; deterministic evaluator wired 2026-06-22).** Run the evaluator — it replaces the former inline-prose evaluation (one engine, schema below; on-demand twin = `/triggers`):
   ```bash
   python3 scripts/defer-trigger-scan.py --since "$(cat .claude/state/orient-last-run 2>/dev/null || echo '7 days ago')"
   ```
   It parses every `todo.txt` `meta:` block, deterministically evaluates the auto-kinds (`commit-touches`/`date`/`file-exists`/`dep-version`/`lines`/`git-clean`/`git-dirty`/`grep-present`/`grep-absent`), and prints three buckets + a coverage line. Surface them:

   ⛔ **READ LINE 1 FIRST — THERE IS A FOURTH BUCKET AND IT VOIDS THE OTHER THREE.** If line 1 carries `⛔ N INSTRUMENT FAILURE(S) — THIS RUN IS VOID`, N predicates could not be EVALUATED (a git/grep/eval error, or a `--since` git cannot parse), so every bucket below it is computed over a partial evaluation and none of them is a reading. Fix the instrument and re-run; do NOT triage the buckets. Measured 2026-09-06: one malformed `--since` moved DOABLE-NOW 71 → 2 and STALE 0 → 79 while rc, the unevaluated count and the RECONCILE bucket all stayed identical — every number this spec tells you to read was invariant under a totally broken run. ⭐ **THIS STEP IS THE MOST EXPOSED OF THE FOUR CONSUMERS, BY CONSTRUCTION:** it is the only caller that passes `--since` FROM A FILE, so the argument is whatever `.claude/state/orient-last-run` happens to hold. That watermark currently holds a sha that still resolves — armed, not firing — and a GC, a fresh clone or a rewritten history makes it unresolvable, at which point `/orient` reproduces this bug on a reader following a spec that had no branch for it.
   - **DOABLE-NOW** — trigger fired, work not done → `🔔 DEFER-FIRED: todo.txt:<line> — <title>`. Action: pick up / promote / re-evaluate.
   - **RECONCILE** — `done-when` TRUE but box still `[ ]` (already shipped) → propose `[x]`, owner-confirmed (verify the deliverable first — a narrow `done-when` can cry wolf).
   - **STALE** — a predicate points at a missing path → open the row first: one whose text names the printed STALE detail as its fire is a FIRE, reported to the owner and never re-pointed; otherwise fix the `meta:` block (loud — never a silent no-fire).
   Emit the **coverage line** verbatim so under-coverage stays visible. Then advance the watermark to current HEAD (the `commit-touches` kind re-checks only new commits next session; the stateless kinds ignore it):
   ```bash
   git rev-parse HEAD > .claude/state/orient-last-run
   ```
   Silent if the scan returns nothing. Free-text/unrecognized `trigger-type`s are counted-not-evaluated (never guessed). The watermark migrated from an ISO date to a HEAD sha on 2026-06-22; the evaluator's `--since` accepts either.
9. **Recurring-blindspot priming (enforce-gap intervention, added 2026-06-01 — active-recall before write: possession≠application).** Run `python3 scripts/meta-corrections-scan.py --prime --render --window 14` (windowed — all-time share provably lags/inverts) and **emit its output verbatim** as the session-start spotlight — a labeled block with **#1 in full (pct + count + counter-action) plus a compact secondary line for every OTHER tag ≥10%**, so #2/#3 aren't dropped. The script is the **single source** of both the render and the tag→counter-action map (`PRIME_COUNTER_ACTIONS` in `scripts/meta-corrections-scan.py`) — shared with the SessionStart hook so both paths render identically; **edit counter-actions THERE, not here.** (The labeled render also prevents the raw-TSV PCT-vs-COUNT transpose that bit on 2026-06-09.)

   **The SessionStart hook (`.claude/hooks/session-start.sh`) now auto-emits this block at every session start (added 2026-06-09)** — so a manual `/orient` run is a **re-prime** (after `/compact` clears the session-start context, or before a heavy composition). **Degrade silently** if the script prints `PRIME_UNAVAILABLE` (registry absent/empty). Read-only — never writes.
   **Why session-start, not always-loaded:** `active-recall.md` already carries these rows STATICALLY (flat, unranked, buried among ~30; parked since 2026-09-07, so they load only for the rules archive — and in this copy it never loads, since its `paths:` scope names an archive the copy does not ship). This step adds the DYNAMIC, RANKED spotlight on what is actually firing most right now — priming beats cataloguing for model-default behaviors. **Revisit (falsifiable):** after ~10 sessions of priming, re-run `--analyze`; if the primed pattern's share has NOT dropped, priming doesn't suppress the slip → escalate to a harder intervention rather than keep a ritual that doesn't move the metric.

## todo.txt defer schema

Added 2026-05-18. Opt-in structured fields above the existing free-text body. Existing entries continue to work as free-text; new entries SHOULD use the structured form.

```
- [ ] DEFER-ID — Short title
  meta:
    trigger-type: commit-touches | date | file-exists | dep-version | lines | git-clean | git-dirty | grep-present | grep-absent | prod-data-count | manual | external
    trigger: <see semantics below>
    done-when: <kind> <args>   # OPTIONAL — item is DONE (reconcile → propose [x]) when this predicate is TRUE
    class: standing-rule       # OPTIONAL — a permanent read-when-touched reminder (no completion state): the fired trigger surfaces in its own STANDING-RULES bucket, never DOABLE-NOW (2026-08-02)
    status: pending | fired | done   # OPTIONAL — default pending; non-pending skipped
    blocked-on: <blocker name or "none">
    loc-estimate: small | medium | large | tbd
  Source: <where this came from>
  [free-text body — risk, ship-now slice, etc.]
```

Trigger type semantics:
| Type | `trigger:` value | Auto-evaluated by /orient? |
|---|---|---|
| `commit-touches` | glob pattern (e.g. `src/components/progress/**`) | YES — fires when recent commits touch matching files |
| `date` | ISO date `YYYY-MM-DD` | YES — fires when today ≥ specified date |
| `file-exists` | filesystem path | YES — fires when path exists |
| `dep-version` | `<module> <op> <version>` (e.g. `sharp >= 0.35.1`) | YES — installed `node_modules/<module>/package.json` version compare |
| `lines` | `<path> <op> <N>` (e.g. `docs/notes.md > 4000`) | YES — file line-count threshold |
| `git-clean` / `git-dirty` | pathspec | YES — `git status --porcelain <pathspec>` empty / non-empty |
| `grep-present` / `grep-absent` | `<ERE pattern> :: <pathspec> [:: i]` | YES — pattern present / absent under pathspec |
| `prod-data-count` | free-text rationale (e.g. "first N production reports of a kind") | NO — needs human evaluation |
| `manual` | free-text rationale (e.g. "user picks pricing tier") | NO — surfaces only with `--include-manual-defers` |
| `external` | free-text rationale (e.g. "Paddle ships pause API") | NO — depends on external system |

`done-when:` accepts any of the same kinds, kind-prefixed (e.g. `done-when: grep-absent unlock :: messages/en.json :: i`). An item surfaces as **doable-now** when `trigger` is TRUE and `done-when` is absent/FALSE; as a **reconcile candidate** (already done → propose `[x]`) when `done-when` is TRUE; a `commit-touches` item whose watched path has ≥ `LATCH_COMMITS` distinct commits since the item's own anchor surfaces as **latched** instead of doable-now — its trigger is TRUE by construction and cannot go FALSE, so it is a row to RE-KEY, not work to pick up. A free-text or unrecognized `trigger-type` is counted-not-evaluated (never guessed, never a false "stale").

**Deterministic evaluator: `scripts/defer-trigger-scan.py`** (built 2026-06-22; `--self-test` is floor-guarded inside the script — derive the arm count there, never restate it; plain run prints doable-now + latched + reconcile + stale + a coverage ratio). For the auto-evaluable kinds this is the engine the 8-agent LLM scan is retired in favor of — sub-second, zero-LLM. **Validation phase (SC-3 / warn-before-block discipline):** run it manually for now; wiring it into this Step's auto-fire + a `/wrap` `--since <session-start-sha>` "did-this-session-unblock-anything" delta is the next increment, gated on the manual run proving low-FP across a few sessions. A stale predicate (a check pointing at a missing path) prints LOUD — never a silent no-fire.

Migration policy: new defers SHOULD include the `meta:` block. Existing entries are NOT bulk-migrated — convert opportunistically when touching an entry for any other reason. The ~13 currently-repo-checkable (class-1) triggers are the highest-value backfill target.

## Output
```
Session: {sid8} (you) — {N} peers active
Branch: main (2 ahead of origin)
Last work: [commit messages]
Pending: {N} todo items, Flow #{M} next for final audit
System: {skill_count} skills, {index_lines}-line index, meta {version}
Warnings: [any uncommitted changes, unapplied migrations]
Defer-triggers-fired: [list with action prompt, or silent if none]
Blindspot primed: [⚠️ #1 pattern + counter-action, plus a compact secondary line for any other ≥10% patterns; or silent if registry empty]
```

Values in `{...}` are filled from live commands per Process step 4 — never type them from memory.
