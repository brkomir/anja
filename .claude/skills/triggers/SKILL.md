---
name: triggers
description: Scan todo.txt revisit-triggers and surface deferred items whose condition just became doable now (+ already-done reconcile candidates). Use when asking "what deferred work is unblocked right now?", after a batch of commits, or before picking up backlog work.
---

# Defer-Trigger Scan

Surface deferred `todo.txt` items whose **revisit-trigger has fired** (the precondition is now TRUE and the work isn't done) plus **already-done items never checked off** (reconcile candidates) — deterministically, in ~50ms, zero-LLM. Replaces the one-time 8-agent LLM scan for the repo-state-checkable (class-1) triggers.

## When to Use

When the user types `/triggers`, or asks "what's unblocked now?" / "did any deferred work just become doable?" / "what can I pick up?" — especially after landing a batch of commits.

## Usage

- **`/triggers`** — full scan: evaluate every `meta:`-tagged class-1 trigger against current repo state. Surfaces DOABLE-NOW + LATCHED + RECONCILE + STALE + a coverage ratio. **`commit-touches` triggers evaluate BY DEFAULT with no window** (a fired trigger is STATE) — fired iff the watched path changed AFTER the item's own git-blame date; a prose-bearing trigger value surfaces as STALE instead of dying silently.
- **`/triggers --since <sha|date>`** — a NARROWING view: only fires from commits since `<ref>` (e.g. the `/wrap` "did this window unblock anything" delta). Never required for completeness.
- **`/triggers --include-manual`** — also list `manual`-type defers (normally suppressed).
- ⛔ **A `done-when:` OPENS WITH ITS *KIND*, SO BARE PROSE IS EVALUATED AS A PREDICATE — AND AN UNRECOGNISED FIRST WORD IS A LOUD STALE AGAINST YOUR OWN ROW.** `scan()` takes the first whitespace-delimited token as the kind and — DELIBERATELY UNGATED, unlike the `trigger-type` branch — passes it to `eval_predicate` regardless. Measured by calling the function (2026-09-08): `every` → `stale=True, "unknown kind: every"`, which is how a row filed this session opening *"every window-sensitive fixture age…"* was reported stale against its own author an hour later. **Open a human-judged `done-when` with `manual`** — it is a real member of `NONAUTO_KINDS` (`{prod-data-count, manual, external}`) and returns `stale=False, "not auto-evaluable"`. ⛔ **It is NOT an arbitrary prefix and any unrecognised word does NOT do the same job: `banana` → `stale=True, "unknown kind: banana"`** (the opposite claim — that the prefix works by accident and `banana-` is equivalent — is refuted by the three-arm call; the scanner's own comment records the same measurement from 2026-08-07). ⚠️ **The quiet hazard is the opposite one: a kind that IS recognised silently evaluates your prose** — `date` + prose returns `stale=False` and the nonsense comparison `today 2026-09-08 >= some prose here`, so it reads as a satisfied predicate. Of the eleven `AUTO_KINDS`, `date` and `lines` are the two that can open an ordinary English sentence — **but only `date` is SILENT.** `lines` + prose returns `stale=True, "missing path: some"`, so it surfaces like any other bad predicate; `date` is the sole shape that fails quietly, which makes it the one to check for by hand. *(Both halves measured 2026-09-08, twice and independently. The failure shape is the reusable part: the `lines` arm was RUN in a seven-arm probe and returned `missing path: some`, then left out of the three-arm write-up — so the datum existed and was dropped at the WRITE-UP, not at the measurement.)*

Run `/triggers help` for this readout without executing.

## Process

1. **Run the deterministic evaluator** (this IS the whole engine — do NOT re-implement it in prose or fan out an LLM scan):
   ```bash
   python3 scripts/defer-trigger-scan.py                          # full scan
   python3 scripts/defer-trigger-scan.py --since <sha-or-date>    # if the user named a ref / "since last X"
   ```
2. **Surface its output inline** (no file — reports-inline preference). The buckets:
   - ⛔ **READ LINE 1 FIRST — THERE IS A FOURTH BUCKET AND IT VOIDS THE OTHER THREE.** If line 1 carries `⛔ N INSTRUMENT FAILURE(S) — THIS RUN IS VOID`, N predicates could not be EVALUATED (a git/grep/eval error, or a `--since` git cannot parse), so every bucket below it is computed over a partial evaluation and none of them is a reading. Fix the instrument and re-run; do NOT triage the buckets. Measured 2026-09-06: one malformed `--since` moved DOABLE-NOW 71 → 2 and STALE 0 → 79 while rc, the unevaluated count and the RECONCILE bucket all stayed identical — every number this spec tells you to read was invariant under a totally broken run.
   - **DOABLE-NOW** — trigger fired, work not done. Each carries a clickable `todo.txt:<line>`. These are the actionable items.
   - **LATCHED** — a `commit-touches` row whose watched path has ≥ `LATCH_COMMITS` distinct commits since the row's OWN anchor. The predicate is TRUE since filing and cannot go FALSE, so the row is NOT newly-unblocked work — it is a row that needs RE-KEYING on what it actually waits for. Not in the doable-now count; hottest first; keyed on git history, never a wall-clock window.
   - **RECONCILE** — `done-when` is TRUE but the box is still `[ ]` (work already shipped, never checked off) → **propose-`[x]`** candidates.
   - **STALE** — a predicate points at a missing path/dep/file (the `meta:` block rotted). Fix the block; never a silent no-fire.
   - The **coverage line** ("N auto-evaluable / M meta-tagged / K open") is load-bearing — it shows how much of the backlog the scan can even see. Surface it; never hide under-coverage.
2b. **Plan-doc rulings — NOT wired, and do NOT re-wire it without reading this.** ⛔ **`scripts/plans-ruling-scan.py` IS MEASURED BLIND (2026-08-14): 0 of 5 planted genuine unmirrored rulings caught, and 0 of 12 live findings genuine on a full hand-triage.** It was wired into step 1 for ~2h today and unwired on that measurement. **Its own `--self-test` reports PASS while the detector cannot fire** — the two fixtures asserting *"unmirrored ruling flagged (positive control)"* are suppressed against the real decisions log, and pass only because the self-test's fixture decisions log is two lines against the real 668 KB — the fixture-SCALE failure: a control drawn from a scale at which the defect cannot manifest.
   **Mechanism, so nobody re-derives it:** `tok_mirrored = any(t in decisions for t in toks)` (`:103`) over tokens sorted by LENGTH, not rarity (`:67`). One ordinary 6+ char word appearing anywhere in a 668 KB prose file suppresses the whole line — measured kills on `because`, `ceiling`, `corner`, `frames`, `policy` (46 hits), `cadence` (17). Sensitivity floor: a line fires only when ALL of its top-4 tokens are absent, i.e. **only if the ruling is written in invented words**. 62 of 179 ruling-shaped lines die here, and `any()` discarded an available absent token in **47 of those 62**.
   **If anyone revisits: the lever is the counterpart CHECK (`any()` → rarity-weighted or `all()`), never the token window** — the proposed top-4→top-6 widen kills 5 of 12 single-handedly, every one incidentally. Both restored-sensitivity variants land at 39-59 lines/run dominated by CITATIONS of prior rulings, so there is no measured operating point that is both sensitive and precise. The base rate in working plan docs is citation-of-ruling, and a presence-keyword check cannot separate a citation from a declaration.
   **Why unwired rather than tuned:** the tune reaches "0 findings" by getting *more* blind, and a wired detector reporting 0 reads as *"the plan docs are clean"*. An unwired gap is known-open; a blind green one is not.
   The original walk-description, retained because the script stays on disk for on-demand use: it walks the plan-doc directory RECURSIVELY (571 docs, vs the 411 a flat glob reaches — the subdirectory gap is real: a swarm-seat sheet holding an open item sits outside the flat glob) and flags ruling-shaped lines with no decisions-log counterpart. It carries its own `--self-test` (7/7, with a positive control planted through the real pipeline) and a `MENTION_RE` suppressor for the use-vs-mention class.
   ⛔ **Do NOT replace it with a marker grep.** A 4-marker predicate (`- [ ]` / `UNRESOLVED` / `Open question` / `Open decision`) was proposed 2026-08-14 and REFUTED by two independent reviews: it scores **0** on the very plan doc whose stranded items motivated the sweep (positive control on a sibling doc: 25). That doc expresses open items as `OWNER-PENDING:` / `awaiting owner sign-off` / `## Owner decision queue` — none of which the markers match, while **this scanner flags it twice** — the guard could not see the thing it was written for. Hand-read precision of the refuted predicate was 50%, with only 17% carrying un-homed new information, and 36% of its hits came from one launch checklist.
   **The write-side remedy is the durable one:** an open item in a `plans/` doc earns a `todo.txt` row IN THE SAME COMMIT, with the plan doc carrying the row name. Already de-facto practice — it simply was not written down. `plans/` stays narrative; `todo.txt` stays the one index every sweep already reads.

3. **Offer to act, never auto-mutate** (warn-only, warn-before-block discipline):
   - DOABLE-NOW → **validate the row's PREMISE before offering it** (trace the stated rationale against shipped code; a row whose rationale predates recent work may be already-done, obviated, or mis-addressed), then offer to pick one up (or hand to `/agent-work`). This is the same verify step RECONCILE already carries, and the cost is inverted: a wrong RECONCILE flips a checkbox early, a wrong DOABLE-NOW sends you to BUILD on a dead premise. Measured 2026-08-08 on 6 hand-picked candidates: **1 premise dead** (fixed weeks earlier, row never closed) and **3 of the 5 survivors carried stale coordinates** — including a pointer row whose own pointer was 148 lines off, and a cited path that did not exist. ⚠️ That sample was SELECTION-BIASED (small-and-quick-looking rows skew old, and old rows rot more), so read it as a reason to check, not as a base rate.
   - The **DEAD CITED PATHS** bucket is the mechanical slice of that check: a backticked path cited in a row BODY that resolves to **no file on disk** AND has **no unique tracked-path tail** (authors elide prefixes constantly, so a single tail-match is treated as that citation). Warn-only, accepted-FP (same posture as `/hanging-work` Check 12).
   - ⚠️ **KNOWN SCOPE BOUNDARIES, all measured — do not read this bucket as covering coordinate rot.** It cannot see **line-number drift** (`:679` → `:786`; no expected content is recorded to compare against). It cannot see a **bare basename** (the extractor requires a `/`, and widening it would flood: every `page.tsx` mention becomes a candidate). It cannot see an **under-specified but resolvable** path, which is what the motivating instance actually was. It cannot separate a **single-hit ambiguous tail** from a legitimate prefix elision — not decidable from the string. And **repair installs a suppressor**: annotating a dead path adds "does not exist" to the line, which is in the negation-marker list, so a *repaired* instance goes invisible.
   - RECONCILE → **verify the deliverable yourself** (the `done-when` is a heuristic, not proof), then flip `[ ]`→`[x]` only with owner go-ahead. An item that bundles a SEPARATE deferral stays surfaced — do NOT auto-flip (a manual reconcile shipped 2 false-RESOLVED out of 35).
   - STALE → propose the `meta:`-block fix.
   - Any `todo.txt` write uses an explicit pathspec + `git commit -o todo.txt` (hot shared file; bare-commit sweeps the index / first-commit-wins).

## What it does NOT do

- Does **not** evaluate prod-signal / manual / free-text triggers (~52 today) — counted in coverage, never guessed. Those fire from Sentry / PostHog / support, not from this scan (the ~63% structurally-not-repo-detectable class).
- Does **not** auto-edit `todo.txt`. Surface + owner-confirmed flips only.
- Does **not** add the `meta:` block to new items — that's authored at defer-creation time (schema: `/orient` SKILL.md § "todo.txt defer schema").

## Relationship to /backlog sweep

This scan evaluates PREDICATES (`meta:` blocks) deterministically. The agentic counterpart —
evidence-verified triage of ALL open items into done/obsolete/promote, including everything with no
`meta:` block — is **`/backlog sweep`** (codified 2026-07-30 from its first run).
Good order: `/triggers` first (drains the mechanically-decidable), then `sweep` for the rest.

## Relationship to /orient + /wrap

This is the **on-demand** entry point (validation phase, SC-3). The same evaluator is destined to auto-fire at `/orient` Step 8 (session-start "what unblocked while I was away") + a `/wrap` `--since <session-sha>` delta ("did this session unblock anything") — wired once a few `/triggers` runs prove low false-positive. Built 2026-06-22 from a 9-expert design panel; predicate kinds live in `.claude/skills/orient/SKILL.md` § "todo.txt defer schema".
