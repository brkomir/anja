---
paths: ["tests/e2e/**"]
---

# E2E Test Rules

⛔ **PATH-SCOPED — NOT always-loaded (2026-08-18).** It loads when you read a file under
`tests/e2e/**`. **Writing or editing a Playwright spec? READ THIS FILE FIRST** — on a fresh session
it is absent until you read a matching file, and the vendor spec says a compaction does NOT
re-inject it (`code.claude.com/docs/en/memory` § *Instructions seem lost after `/compact`*), so
treat every post-compaction turn as a fresh one. ⚠️ **This body text is the only channel that can
tell you any of that** — the harness strips YAML frontmatter and block-level HTML comments before
injection (documented, deliberate), so a scoped file cannot announce its own scoping, and
`CLAUDE.md`'s router is the only always-loaded carrier. *(The scope declaration lived in an HTML
comment here from 2026-08-01, verified inert by a review panel and kept as "future path-trigger
config"; this is that wiring, 17 days later.)*

Playwright specs run against a REAL browser + a prod build (`./scripts/e2e-local.sh`), separate from the unit and integration tiers — `npm test` is BLIND to this one.

Every rule here is a way the DRIVER lies: the app worked and the driver says it didn't, the driver clicked something else and calls it success, or a partial run reports as a complete one. None of it reproduces on an idle local machine, which is why a green local suite is the default reading and it hides all of them.

Incident records (dates, seat ids, shas, measurement narration, retraction chains) live in a separate archive file — not always-loaded, **not doctrine**; where it disagrees with this file, this file wins.

**Appending here.** A new trap is ONE bullet in the matching section — DIRECTIVE + TELL + DISCRIMINATING NUMBER + ARCHIVE ANCHOR — in **one to three sentences, 150-400 bytes**; its incident record goes to the archive. **A correction REPLACES the rule's sentence; it never appends a paragraph beneath it.** ⛔ **Cite a rendered string by its i18n KEY and RENDER SITE, and a source location by its SYMBOL — never by the literal or the line number.** Both rot in hours here and neither fails when it does; two line cites in the pre-rewrite file were already stale.

## UPLOAD AND HYDRATION

### USE `robustSetInputFiles`, NEVER A BARE `setInputFiles` AFTER `page.goto`

`goto` returns BEFORE React attaches its delegated `change` listener — `domcontentloaded` and the default `load` alike — so the native `change` fires at an un-wired input and the file is SILENTLY ignored: no preview, no error, an empty dropzone. CI load widens the window, which is exactly why it passes locally and flakes on CI.

### THE RETRY MUST CLEAR — A SAME-FILE RE-FIRE IS A NO-OP, SO A NAIVE `toPass` IS INERT

Playwright does not re-dispatch `change` when `input.files` is unchanged (measured: the `createObjectURL` counter stays `0` on a same-file re-fire, `1` on a clear+set), so iteration 1 drops the change AND sets `input.files` and every later retry no-ops → the ready element never appears → 15s timeout. `setInputFiles([])` before each set makes every attempt a real `[]→[file]`; both uploaders early-return on an empty FileList, so the clear is a benign no-op.

### THE `ready` ARG IS THE ACCEPTED-STATE ELEMENT — VERIFY THE ANCHOR AGAINST THE REAL DOM

`ready` is whatever appears once the file is ACCEPTED (preview `img[alt]`, a lane radiogroup, a crop modal) and is the retry loop's only success signal. **The helper's documented anchor is not universal:** on `/critique/new` the lanes are BUTTONS (`radiogroups: 0`), so the radiogroup it names does not exist there.

### THE HELPER IS NOT REUSABLE WHERE THE INPUT UNMOUNTS ON ACCEPT

`/critique/new`'s input is `class="hidden"` (`display:none`) and UNMOUNTS once a file is accepted, so the clear-and-set retry has no element to target on the second pass. One page-level `setInputFiles` + a `waitFor` on the accepted-state element is the working shape there.

### WHEN NOT TO HARDEN — THREE EXCLUSIONS, VERIFY DON'T BLANKET-APPLY

- **Not racy** — a `setInputFiles` PRECEDED by an interaction requiring hydration (a `.click()` opening an upload panel, menu or tab) is already post-hydration. Grep the lines above it: a prior real click ⇒ safe; goto-then-immediate-upload ⇒ harden.
- **Dead test** — the upload sits inside `test.skip(true, …)`, so the race cannot fire; hardening dead code is pure churn.
- **An exemption is a claim about a PREMISE, and it lapses when the premise moves.** The third exemption ("cannot exercise it, the test skips on every local run") died the moment that test was un-skipped, and the bare `setInputFiles` was correctly re-flagged. Re-check every exemption you inherit rather than honoring it.

## WAITING AND READINESS

### NEVER `waitForLoadState("networkidle")` ON A PAGE CARRYING AN ALWAYS-CONNECTED WIDGET

Turnstile · PostHog · SWR polling · any open socket holds a connection open, so `networkidle` NEVER settles and the spec goes deterministically RED. Anchor on CONTENT — the element whose appearance means the page is ready. **Enumerate the widget-bearing set FROM SOURCE, never from memory:** `grep -rlF 'Turnstile' src/app`.

### THE `.catch(() => {})` FORM IS NOT A SAFE FALLBACK — IT CONVERTS A RED INTO A SILENT FULL-TIMEOUT STALL

A swallowed `networkidle` burns the entire wait on every run, reports green, and tells nobody; a bare unbounded one is worse. If a bounded settle is genuinely wanted, pass an explicit short `{ timeout: 3000 }` and say in a comment why the bound is safe.

### DELETE A REDUNDANT WAIT — REDUNDANT-THEN-HARMFUL IS THE SHAPE NOBODY REMOVES

Every `networkidle` call site is followed by an assertion carrying its own timeout, so the wait bought nothing for months; then a PRODUCT change (a widget mounting on that page) made it fatal, and the rule kept prescribing it. **A wait that buys nothing today is a latent RED, not neutral** — and an in-file comment is a fix for ONE file: this class was learned four times in four specs' comments and promoted zero times.

### `locator.isVisible({ timeout })` IGNORES THE TIMEOUT — USE `waitFor({ state: "visible", timeout })`

`isVisible` is a SYNCHRONOUS poll, not a wait (Playwright 1.61.1), so a readiness gate built on it reads `false` before React paints and keeps reading `false` at any timeout you pass — the driver reports "the app never accepted the upload" about an app that already accepted it.

### WHEN TWO INSTRUMENTS DISAGREE, THE ARTIFACT OUTRANKS THE PREDICATE

Read the screenshot / DOM dump BEFORE forming a third hypothesis. Measured: five wrong hypotheses over ~11 turns while the failure screenshot showed `createObjectURLCalls: 1`, `imgAlts: ["Upload preview"]` and the full lane row — i.e. success. Kin: two tool calls disagreeing IS the signal.

### A URL-PATTERN ASSERTION IS SATISFIED BY THE QUERY STRING OF THE PAGE YOU NEVER LEFT

⛔ **Assert the PATHNAME through a RETRYING matcher against an ANCHORED pattern naming the optional locale segment — `await expect(page).toHaveURL(url => /^(\/[a-z]{2})?\/pricing$/.test(url.pathname))`.** Three defects, one line. A whole-URL pattern is satisfied by a `next=`/`redirect=` query string over a click that never navigated — measured green with `history.length` stuck at 2, and the false green argued a PRODUCT premise had been refuted. **`waitForURL(/re/)` and `toHaveURL(/re/)` share that BY CONSTRUCTION — the RegExp overload tests `url.href` — so grep for BOTH; naming one lets a seat holding the other read zero.** And a `toMatch` over `page.url()` NEVER RETRIES, while `click()` waits only for a LOAD to begin, which a client-side `push()` never is: it reads the pre-click URL and REDs on CI as *"the CTA does not navigate"*. ⚠️ `[a-z]{2}` holds for all 12 locales TODAY and breaks silently on the first regional one (`pt-BR`) — as a failure that reads like a routing bug. **TELL: your fixture's param names the path you assert.** 1.63.0 source lines + the retrying longhand: archive.

## LOCATORS

### ANCHOR EXACTLY — A LOOSE ALTERNATION WITH `.first()` CLICKS SOMETHING ELSE AND REPORTS SUCCESS

`{ name: /get my critique|critique|analyze|submit/i }` looks defensive; the bare `|critique|` branch matched the nav link "New Critique", which sorts ahead of any button, so the driver navigated away and reported success while the account balance never moved. No timeout, no "element not found", no exception. **Each `|` is a guess and the widest branch wins** — adding alternatives to "make it robust" strictly increases the chance of the wrong element.

### HALT AND INVENTORY WHEN THE EXACT MATCH IS ABSENT — NEVER `.first()` A LOOSE PATTERN

Dump the container's controls (`getByRole("button").allInnerTexts()`, `getByRole("link").allInnerTexts()`) and `process.exit(3)`. A halt costs one run and hands you the DOM; a wrong click costs a paid run and hands you a plausible lie.

### ASSERT A SIDE-EFFECT ON ANY SPEND-BEARING DRIVER

Balance debited, row created, URL changed — check one BEFORE believing a success. A loose locator converts *"I cannot find my target"* into *"I found a different target"*, and the second is indistinguishable from working until you read something the driver never looks at.

### PIN A LOCATOR TO ITS i18n KEY AND RENDER SITE, NEVER TO THE STRING YOU SAW

Re-derive from `messages/en.json` at the moment you write the spec — e.g. `NewCritique.submitButton`. A rendered-string observation has a shelf life of HOURS here: the previous version of this rule told the next author to anchor `exact: true` on a label that had been dead for **28 hours** when it was written, while contrasting it against the one that was by then correct.

### A SUBSTRING LOCATOR'S *PASS* PROVES ONLY THAT THE STRING EXISTS SOMEWHERE IN THE DOM

A case-insensitive `text=/…/i` matches SUMMARY PROSE, so on a paired-element test the sibling that PASSES is the tell, not the control: `/Tonal Separation/i` matched the critique's own summary sentence and would have survived deleting the entire cluster block. Scope to the container (`getByTestId(...).getByText(...)`) or anchor on a role, and before trusting a passing sibling as a control ask what ELSE on the page contains that substring. Kin the mutation-strength asymmetry in `tests-unit.md`: the passing arm has to DISCRIMINATE, not merely fire.

### POLARITY PICKS THE BODY-TEXT TOOL — A POSITIVE ASSERTION ON BODY `textContent` CANNOT FAIL

The serialised bundle is inside it, so `toBeTruthy()` and any length floor pass on a page that painted NOTHING — the one thing they exist to catch. **POSITIVE ⇒ `locator("body").innerText()`; NEGATIVE may keep `textContent`, where the payload only ever makes it fail LOUD — ⛔ UNLESS THE FORBIDDEN STRING IS IN `messages/en.json`, because loud can be FALSELY loud: the negative then matches the BUNDLE and REDs on a page behaving correctly. `grep -c` the string in the bundle before leaving a negative on `textContent`.** Measured 2026-09-04: a same-file sweep of two readers left **three** live elsewhere, one behind a `length > 100` floor the bundle cleared many times over; separately, a retired-copy negative sat on a phrase with **1** bundle hit. Enumerate by the READ, never the file.

### `.filter({ visible: true }).first()` INSIDE ANY DUAL-RENDERED RESPONSIVE COMPONENT

`ScoreCard` renders TWICE — mobile `md:hidden` DOM-first, desktop `hidden md:block` — so a bare `.first()` grabs the HIDDEN mobile copy on a desktop viewport and `toBeVisible()` reports "hidden". Any pill or label inside a dual-render component carries this.

### A SELECTOR LIST RETURNS TREE ORDER — THE COMMA IS NOT A PREFERENCE CASCADE

`querySelectorAll("main h1, …, span")` returns DOCUMENT order, so a header `span` beats the `main h1` listed first — the probe lands wherever the DOM puts it (a header-landed probe certified a BLIND guard live). Query each selector separately, take the first non-empty. AND an `sr-only` host gives a probe a ~1px clipped box that PASSES a `>0`-width filter — assert the box fits the needle you planted.

### `authenticateContext` WIPES EVERY COOKIE — SET LOCALE/STATE COOKIES AFTER AUTH

Its `clearCookies()` is UNSCOPED while the comment claims sb-* only, so a `NEXT_LOCALE` cookie set before auth vanishes and the arm runs in ENGLISH while passing (measured, German arm).

### A base-ui BUTTON WITH A `render` PROP STAMPS `role="button"` ONTO THE ANCHOR — `getByRole("link")` FINDS NOTHING

⛔ **Locate an in-app nav link rendered by base-ui as `getByRole("button")`.** Source, not inference: `useButton`'s `isNativeButton ? {type:'button'} : {role:'button'}`, and our `Button` sets `nativeButton={!render}`. Measured: a 45,000 ms locator timeout that reads exactly like a broken CTA. **TELL: a role query times out on a control the DOM dump shows.**

## RESPONSIVE-OVERFLOW INSTRUMENTS

### COMPUTED `overflowX` RETURNS `auto` FOR AN AUTHORED `visible` WHENEVER `overflow-y` IS NON-VISIBLE

A computed-value ancestor exclusion therefore blinds EVERY subtree under an ordinary vertical scroller — measured 8 needle-blind pages, all via a computed-`auto` ancestor. Key on the AUTHOR-DECLARED class (`overflow-x-auto`), never the computed value.

### A FONT-METRIC OVERFLOW IS CI-ONLY — LOCAL IS GREEN BOTH SIDES OF THE FIX

CI measures 4-15px wider than macOS on the same page, so the overflow never reproduces locally and the spec passes before AND after. ⛔ **The CAUSE is UNSETTLED — do NOT write "Linux faces": `next/font/google` SELF-HOSTS Geist, same `.woff2` on both.** One line discriminates a pre-swap read: `await page.evaluate(() => document.fonts.ready)` before the rAF pair (`document.fonts` = 0 hits repo-wide). Substitute a PAIR — `letter-spacing: Npx` via `addStyleTag`, with and without the fix, **then verify the fix HOLDS at that same N**. ⛔ **N does not transfer between elements:** 0.8px on a 17-char badge left a 40-char button's control at **319 vs 321**, a HOLDS/HOLDS that reads as proof. Raise N until the CONTROL overflows. ⚠️ Two FULL builds — `--no-build` reuses `.next`. Archive.

### PICK WORST-CASE LOCALES BY LONGEST UNBREAKABLE TOKEN → moved to `i18n.md` (not in this copy) § GUARDING AN i18n FIX (2026-09-01)

It is a fact about the 12 bundles, not a Playwright one — `i18n.md`'s glob (not in this copy) is a superset for this audience and reaches the i18n author who never opens an e2e file.

## SEEDS AND CORPSE-HARDENING

### NEVER PUSH A JUST-HARDENED CORPSE WITHOUT A REAL E2E RUN — CLASSIFY THE RED FIRST

A spec that was vacuous-green and is made to assert UNCONDITIONALLY surfaces its hardening-CORRECTNESS only at the first REAL CI run. **wrong-premise** (the seed/state assumption is false) is DETERMINISTIC and fully local-validatable; **load/race flake** reproduces only under CI load, so a green LOCAL run validates the fix NON-BREAKING only, never flake-FIXED.

### A SEED PREMISE ROTS WHEN A QUERY IT DEPENDS ON IS LATER TIGHTENED

`imageKey:null` stopped resolving once a sibling hardening added `isNotNull(imageKey)` to the resolver. Grep sibling corpses of the same class when you fix one — they were written from the same premise and nothing re-checked them.

### KEEP A BACK-DATED SEED INSIDE EVERY PLAN-GATED VISIBILITY WINDOW THE FETCH PATH APPLIES

Grep the resolver for entitlement time-predicates (a plan's access-window constant, `windowStart`, any interval gate) BEFORE choosing the base timestamp: a fixed past base picked purely for sort-order isolation (`2024-01-01`) trips the plan's access window and routes all 30 seeds to Archived — zero cards, timeout. Pick a base satisfying BOTH constraints (`now−20d`). **Tell: an empty-state tab beside a populated "Archived N" badge in `test-failed-*.png`.**

### ENUMERATE EVERY TIME-KEYED PREDICATE, NOT THE FIRST ONE (assert the literal the code reads)

The seed above pinned the SORT column (`updated_at`) correctly and missed a SECOND time-keyed predicate on `created_at` in the same query. DETERMINISTIC on both viewports, so it reads as a broad regression while the SUT is fine; tsc, unit and single-thread runs are ALL blind.

## RUNNER, REPORTERS AND COMPLETENESS CLAIMS

### `PLAYWRIGHT_MAX_FAILURES=0` PLUS AN EXECUTED-VS-COLLECTED RECONCILE FOR ANY COMPLETENESS CLAIM

`playwright.config.ts` ships `maxFailures: 3`, and on a bail the run prints what it EXECUTED plus ONE `N did not run` line (Playwright 1.63.0; measured 2026-09-24: `36 did not run`, and the seat still reported "33 green" as if complete — *this sentence said the summary has NO "not reached" line until 2026-09-25; it has one, it is easy to skip, and the pass count is what gets quoted*) — measured **413 executed of 735 collected, 322 never run**, read as a complete run. Compare against the `Total: N tests in M files` collection line; never read the pass count alone. The bail default is right for iterating on a known regression and wrong for certifying. Playwright twin of the vitest `--bail=10` entry in `tests-integration.md` (not in this copy). ⛔ **A failure count CONSTANT across reruns and EQUAL to `maxFailures` is the CAP holding, not the same defects persisting** — the free discriminator is the pass denominator moving under a byte-identical command (measured 10 → 34 accounted-for; "all three failures" reported over a capped set).

### `--no-build` VALIDATES THE PRE-FIX BUNDLE — AND A TAIL CAP EATS THE RUNNER'S OWN SAY-SO

`e2e-local.sh --no-build` reuses `.next`, so a fix in `src/` is INVISIBLE to the run — two specs stayed RED against a bundle predating the fix. The runner prints `Skipping build (--no-build, …)` and a `| tail -8` cut exactly that line (the never-cap-a-side-effect-notice class). After any `src/` edit, rebuild.

### READ THE "N passed" COUNT, NEVER THE EXIT CODE — `--project=desktop` FALSE-GREENS AN OWN-PROJECT SPEC (tee exit-code kin)

`./scripts/e2e-local.sh <spec> --project=desktop` exits **0** with "No tests found" when the spec declares its OWN Playwright project, because its tests live there rather than in `desktop`/`mobile`. Filter with `--locale`, or run unfiltered.

### A SECOND `playwright test` IN ONE CI JOB MUST NOT REUSE THE JSON REPORTER

The second invocation overwrites the artifact the summary step parses, so the first run's results vanish from the summary while both runs "passed". Use `--reporter=list` for the appended invocation, gate it on `!cancelled()`, and reuse the same job — a separate job costs a whole runner VM to save ~30s. Distinct from the false-green above: that is which tests get SELECTED, this is which results get REPORTED.

### A GREEN RE-RUN DOES NOT CLEAR A FLAKE, AND A GREEN LOCAL RUN DOES NOT VALIDATE A LOAD-ONLY FIX

`gh run rerun` overwrites the verdict on the SAME run id — `gh run list` then shows only the latest attempt, and the failing DOM survives solely in `runs/<id>/attempts/1` artifacts. A race that fires only under load never exercises its fix path locally: prove the fix against the MECHANISM (the probe that measured the dropped `change`), not against a green local suite.

### RUN E2E AT A CLEAN HEAD IN A DETACHED WORKTREE WITH A HARD-LINKED `node_modules` — A SYMLINK IS REFUSED, AND THE SHARED-TREE RUN IS VOID UNDER PEER WIP

From the main repo root: `W=<scratchpad>/wt-<name>; git worktree add --detach "$W" HEAD` — ⛔ **`<name>` (and every directory above it) must NOT contain your spec filter: Playwright's positional filter is a regex over the ABSOLUTE spec path, so a worktree under `…e2e-upload-fallback…` selected 891 of 891 tests instead of 2 (rc 0, all green, 24.4 min instead of ~1; measured 2026-09-27); confirm `npx playwright test <filter> --list` ends `Total: N tests in 1 file` before firing** — then **`pax -rwl node_modules "$W/"`** (hard links; `-l` links only "whenever possible", so keep `$W` on the repo's volume or it silently copies ~1.1 GB). ⛔ **The links SHARE file contents with the main tree: an in-place write under `$W/node_modules` (an install, a patch, a cache rewrite) lands in every seat's packages — never install or edit there.** A `ln -s` to the shared `node_modules` dies at build (`Symlink [project]/node_modules is invalid` — Turbopack refuses a link outside the root), and `scripts/run-changed-e2e.sh` in the SHARED tree builds over every peer's uncommitted TS error, emits NO summary line, and the background task still reports exit 0 — a void run shaped like a pass. `.env.local` is optional — without it the run is CI-shaped (`e2e-local.sh` exports CI's env block, and `.env.local` is the documented local/CI split); if you copy it, `chmod 600` and never print it; run from inside the worktree; remove it by its exact path behind a two-file presence guard. **TELL: the changed-files e2e ended with no `N passed` line, or died in seconds on package resolution.**

### TARGET THE PRE-EXISTING SERVER'S PORT WHEN EVERY PROBE READS `HTTP:000`

The next-dev readiness banner prints BEFORE the port-singleton check, so the announced port may never listen. A uniform `HTTP:000` across every probe is the startup-abort tell — a pre-existing server holds the port; re-target that one rather than re-running against the announced port.
