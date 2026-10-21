---
paths: ["tests/*.test.ts", "tests/*.test.tsx", "tests/setup.ts", "tests/unit/**", "tests/components/**", "tests/actions/**", "tests/billing/**", "tests/hooks/**", "tests/lib/**", "tests/routes/**", "tests/scripts/**", "tests/eslint-rules/**", "tests/services/**", "tests/helpers/**", "tests/fixtures/**", "tests/email-i18n-fixtures/**"]
---

# Unit Test Rules

Excludes `tests/integration/**` (see `tests-integration.md`, not in this copy) and `tests/e2e/**`.

⛔ **THIS FILE IS PATH-SCOPED — the first rules file here that is NOT always-loaded.** It loads when
you read a file matching the `paths:` enumeration above — the UNIT tiers only, NOT all of `tests/`.
Three things follow:
1. **Plan for the vendor spec, the pessimistic case: a `paths:` rule is not re-injected after
   `/compact`; it reloads the next time Claude reads a matching file** (`code.claude.com/docs/en/memory`,
   § *Instructions seem lost after `/compact`*). Measurement is more generous — in the
   instruction-load log this file appears under `load_reason:"compact"` as well as
   `path_glob_match`, so a glob that has fired this session can carry it through — and it still DECAYS
   OUT of later compactions in the same session. **The operative rule is unchanged under every reading:
   if you are writing a unit test and have NOT read a file matching the enumeration above this session,
   these rules are not in your context — read this file.** ⚠️ This body text is the only channel that can
   tell you so: the harness strips YAML frontmatter and block-level HTML comments before injection
   (documented, deliberate), so a scoped file cannot announce its own scoping and `CLAUDE.md`'s router is
   the only always-loaded carrier. (Two earlier versions of this item were each confidently wrong in
   opposite directions — never-re-injected, then spec-is-false; archive.)
2. ⛔ **NEVER WIDEN THIS BACK TO `tests/**` — the "over-inclusion is SAFE" argument that stood here
   until 2026-09-04 is RETIRED.** The broad form delivered these unit rules to integration and e2e
   readers on **50 of 285 measured loads**, and re-widening also disarms
   the tree-coverage sentinel silently (its coverage arm stays GREEN while the
   integration and e2e tiers lose all discriminating power) — a fifth arm there now pins the tiers
   disjoint so that repair fails loudly.
3. **Coverage is machine-checked by that sentinel, not by a dated figure** (the 756/756 reading
   over-included 703 files — the 703 is what the narrowing removed).

*Replaces a dead `<!-- globs: tests/**/*.test.ts -->` Cursor-era comment, which was a domain LABEL
and not a predicate: measured, it MISSED 270 `.test.tsx` files — the entire JSDOM AND BASE-UI TRAPS
section below is about exactly those — while wrongly admitting 580 `tests/integration/` files.*

Every rule here is a way a GREEN test proves nothing: the double stopped intercepting, the fixture cannot reach the branch, the mutation missed, the assertion cannot discriminate. A passing suite is the default reading and it is the one that hides all of them.

Incident records (dates, seat ids, shas, measurement narration, retraction chains) live in a separate archive file — not always-loaded, **not doctrine**; where it disagrees with this file, this file wins.

**Appending here.** A new trap is ONE bullet in the matching section — DIRECTIVE + TELL + DISCRIMINATING NUMBER + ARCHIVE ANCHOR — in **one to three sentences, 150-400 bytes**; its incident record goes to the archive. **A correction REPLACES the rule's sentence; it never appends a paragraph beneath it.** If a case fits no section, add a section — a new section at end-of-file is the last resort, not the default.

## MOCKS AND TEST DOUBLES

### `vi.hoisted()` FOR ANY `vi.mock` FACTORY CLOSING OVER A MODULE-SCOPE VAR

`vi.mock` hoists above every top-level `const`/`let`, so a factory closing over `const mockFoo = {...}` crashes with `ReferenceError: Cannot access 'mockFoo' before initialization`. Declare the stub inline when its shape is self-contained; use `vi.hoisted` when the factory AND the tests both need it.

```ts
const { mockFoo } = vi.hoisted(() => ({
  mockFoo: { bar: vi.fn() },
}));
vi.mock("@/some/module", () => ({ default: mockFoo }));
```

### MOCK EVERY DEPENDENCY THE PRODUCTION-PATH HELPERS TOUCH, NOT ONLY THE SUT'S OWN

A helper reached via `after()` consumes from the SAME mock-response queue as the handler — an email module calls `db.select()` at runtime, so an email the handler schedules eats the handler's own queued responses. Mock the email module as a no-op, or mock `next/server.after` so the callback is dropped rather than invoked synchronously.

### RE-GREP EVERY DOUBLE WHEN THE PRODUCTION SIDE MOVES — THE DOUBLE FAILS *OPEN*

Nothing is wrong when either side is written; a later production edit moves the contract underneath a double that no longer satisfies it, surfacing as a `TypeError` several frames away or as a green suite carrying unhandled noise. Three shapes, one grep each, IN THE SAME CHANGE:

- **An import specifier changed ⇒ a path-keyed `vi.mock` stops intercepting**, the real module loads, and a deferred resolver assigned inside the stub never gets assigned. `grep -rn 'vi.mock("<old-specifier>"' tests/`.
- **A field became required on a shared type ⇒ every fixture constructing that shape breaks at RUNTIME**, and tsc cannot see it because `tests/` is excluded from the project tsconfig. `grep -rln '<typeName-or-distinctive-field>' tests/` — derive the sweep FROM THE TYPE. A verdict that RECOMMENDS a required-field change owes the same sweep: citing a rule and applying it are two acts.
- **The production path calls a NEW method on a hand-rolled double** ⇒ unhandled `TypeError`s per full-suite run **while the owning file reports GREEN**, because unhandled errors do not fail a suite. Grep every hand-rolled double of that interface, and treat vitest's `Errors N` line as a first-class failure signal, never cosmetic noise.

### STUB THE OBSERVABLE THE PRODUCTION PATH BRANCHES ON — A SHAPE-ONLY STUB IS THE FAIL-OPEN REMEDY

`abort() {}` silences the `TypeError` and installs a quieter defect: production sets `xhr.onabort = () => reject(new Error(PUT_ABORTED))` and `putWithRetry` branches on that message to make an abort TERMINAL, so an inert `abort()` never rejects, the PUT is left **unsettled**, and the terminal-abort branch is unreachable under the double. The check is never "does the double have the method" — read the production handler for what it rejects, resolves or emits BEFORE writing the stub (the wired-but-inert class at the test-double surface).

### PRE-PLACE A DOUBLE'S UPDATE; DO NOT SEQUENCE IT WITH THE FOLD

Taking the stub additions in the same commit as the sibling fold makes the trap memory-dependent — the fold may land weeks later in a session that never saw the warning, and cross-session mail carries a 24h read-TTL. Landing the update FIRST makes arming structurally impossible and costs nothing. **Say plainly that a pre-placed update is not mutation-provable by construction:** nothing calls the method until the fold lands, so reverting it stays green.

### ENUMERATE DOUBLES FROM THE INTERFACE, NEVER FROM MEMORY

A tracker row naming "four test files stub XMLHttpRequest" was six. Grep the interface name, then check each member for the newly-required method.

### LATENT ≠ FIXED — THE FIX THAT MAKES PRODUCTION CORRECT IS WHAT ARMS THE DOUBLE

A double can be under-implemented and GREEN because the production path does not yet reach it: a call site passing no `signal` never registers the abort listener, so the missing `abort()` never fires. When you defer a sibling-fold, record the doubles it will arm as part of the deferral, or the next author meets a `TypeError` with no trail back to the decision.

### BEFORE REPAIRING A COMPONENT THAT THROWS OR NO-OPS, ENUMERATE WHAT RUNS DOWNSTREAM

Two bugs can mask each other: a component that currently throws holds every downstream defect harmless, so those guards have never executed and have never been wrong. Repairing it is the edit that makes them live, and the failure appears in code your diff did not touch. The production twin of the test-double rules above, and the direction where the cost lands on users.

### WHEN A FINDING CHANGES STATE, SWEEP THE DURABLE LAYER FIRST — UNLESS YOU BROADCAST IT

Mail expires and nobody re-reads a tracker row, but a wrong sentence in an always-loaded file misleads silently and indefinitely, so the ephemeral-first ordering that feels natural is backwards. ⛔ **It INVERTS on a broadcast**, where the mail is the durable surface for every reader except your principal and a 24h TTL is not short against a four-minute propagation window. **The discriminator is WHERE THE ERROR PROPAGATED** — and correcting it to your own principal is not correcting it.

### FEED A WIDENED PRODUCER'S OUTPUT THROUGH THE REAL CONSUMER — ONE ROUND-TRIP ARM

When a producer has only ever emitted the degenerate value, the consumer that parses the rich value is dead code — it cannot be wrong, so nothing tests it and no coverage tool flags it — and your fix activates it in the same stroke. **The tell: the newly-live consumer's failure mode is the SAME SYMPTOM you just fixed, relocated to the far end**, so it reads as "already fixed" to the person best placed to catch it, and every arm an author naturally writes sits on the PRODUCER side. The wired-but-inert rule asks whether the mechanism is wired; this asks whether the *other end* has ever run.

### CALL THE FUNCTION — NO `readFileSync` + `extractFunctionBody` AS A BEHAVIORAL SUBSTITUTE

Assert on output. The one sanctioned exception is the drift-sentinel carve-out below.

### SPREAD `importActual` IN ANY PER-FILE `vi.mock("drizzle-orm")`

Extracting a query into `src/services/*` can add a module-load call like `const { ...cols } = getTableColumns(critiques)`; a literal factory — `() => ({ eq: vi.fn(), ... })` — then throws at IMPORT with `No "getTableColumns" export is defined on the mock`, and the FILE-level error is masked under `--bail`, so read pass/fail COUNTS, never the exit code (the piped-`tee` exit-code trap). If the test ALSO mocks the table object, the real `getTableColumns(mockedTable)` returns `undefined` and the module-load destructure throws `Cannot destructure ... of undefined`, so additionally stub `getTableColumns: vi.fn(() => ({}))` — the test that does not exercise the projection does not care about the value.

```ts
vi.mock("drizzle-orm", async (importActual) => ({
  ...(await importActual<typeof import("drizzle-orm")>()), eq: vi.fn(), /* …other stubs */
}));
```

### RESOLVE A FIRE-AND-FORGET MOCK TO A PROMISE

Production calling `helper(...).catch(...)` without `await` breaks on a bare `vi.fn()`, which returns `undefined` → `undefined.catch()` throws synchronously. Stub `.mockResolvedValue(undefined)` or `.mockReturnValue(Promise.resolve())`. **Symptom: the mock "is called" and the function under test throws immediately after** — a guard's early-exit path failed silently this way.

## ISOLATION

### `vi.clearAllMocks()` IN `beforeEach` — AND RE-INITIALIZE MODULE-LEVEL `let` STATE THERE TOO

Chain helpers and `dbChain` are the usual carriers.

### RE-SET EVERY RETURN STUB IN `beforeEach` — `clearAllMocks` DOES NOT RESET IMPLEMENTATIONS

It clears only call HISTORY (`mock.calls`/`mock.results`), so a `.mockReturnValue()`/`.mockImplementation()` set in ONE test LEAKS into every later test in the file. **Signature: passes in isolation (`-t`), fails in the full run.** Re-set the SPECIFIC stub (`mockHeadersGet.mockReturnValue(null)`) or use `vi.resetAllMocks()`, which clears history AND implementation. The shared-state leak class, mock-return-value flavor.

### `mockClear()` A SHARED SPY IN `beforeEach` — `vi.spyOn` ON AN ALREADY-SPIED METHOD RETURNS THE SAME SPY

`mock.calls` accumulate across tests, so a `.find()` over the uncleared spy can match an EARLIER test's call and a discriminating assertion passes on stale data. Neither `clearAllMocks` nor `resetAllMocks` covers this leg — the hazard is spy IDENTITY: two `vi.spyOn` calls, one spy. Same shared-state leak family.

### PROMOTE TO INTEGRATION WHEN A UNIT TEST IS THE ONLY COVERAGE FOR A P0

Unit tests MAY mock the DB; integration tests MUST NOT (`tests-integration.md`, not in this copy). A P0 billing/auth/safety finding does not stay unit-only.

## COVERAGE CLAIMS

### GREP THE ENTRY POINT, NOT THE SYMBOL — A COVERAGE GREP COUNTS REFERENCES, NOT EXECUTIONS

12 files can name a helper while ZERO run it, and the strength of the unit evidence is what stops anyone checking: `sumCachedInputTokens` shipped with 7 mutation-proven arms while re-introducing `|| null` at its sole production call site left the ENTIRE suite green — `grep -rlE 'sumCachedInputTokens|cachedInputTokens' tests/` → 12 files, `grep -c 'processIteration'` → **0 for all twelve**.

- **The positive control is usually already in the repo.** The one integration test that DOES run the entry point asserted `inputTokens`/`outputTokens` and never the cached field. Find the test exercising the call site's entry point, check WHICH columns it asserts; the omission is the finding.
- ⚠️ **THE DISCRIMINATING FIXTURE IS THE DEGENERATE ONE.** Under `|| null` a nonzero sum is unchanged (`x || null === x`), so a realistic warm-cache arm stays GREEN and only the all-zero case REDs.
- ⚠️ **The `-E` is load-bearing and was MISSING from this rule until 2026-08-16.** `grep -l 'a|b'` is BRE, the pipe is a LITERAL, and the documented form returned **0 files** — a rule about lying coverage greps shipped a grep that counted nothing.

### ASSERT THE SUT WRITES THE MARKER — A PERSISTED-MARKER GUARD NEEDS A PRODUCER TEST

Consumer tests (given a marker, the guard suppresses) all pass when the WRITE is dropped from every call site, so the guard is DEAD in prod while the suite stays green — a bell guard was 14/14 green with its `markBadgeCleared` write untested. Perform the action, then assert the marker exists with a fresh value: a green check proves control-flow ran, never that the value is written.

## JSDOM AND BASE-UI TRAPS

Numbered as they are cited elsewhere. 1-4 concern a persisted-marker producer.

### 1 · `await waitFor(...)` A MARKER WRITTEN ON DROPDOWN-OPEN — base-ui `onOpenChange` FIRES ASYNC

The handler runs a microtask AFTER the click, so a synchronous assertion right after `user.click(trigger)` runs BEFORE it → false RED, which reads as "the guard is defeated". Wrap the marker assertion: `await waitFor(() => expect(...))`.

### 2 · ASSERT THE STORED VALUE, NOT A `setItem` SPY

`vi.spyOn(window.sessionStorage, "setItem")` / `vi.spyOn(Storage.prototype, "setItem")` does NOT hook the store the module writes to under jsdom, so the spy never registers the call. Read `sessionStorage.getItem(KEY)` directly, inside `waitFor`.

### 3 · `sessionStorage.clear()` + `localStorage.clear()` IN `beforeEach` — WEB STORAGE LEAKS ACROSS FILES

A producer test that writes a marker can zero a later test's assertion. The shared-state leak class, web-storage flavor.

### 4 · INSTALL A FULL IN-MEMORY `Storage` SHIM BEFORE THAT RESET

The test env can CLOBBER jsdom's `localStorage` with a partial/read-only stub, so `localStorage.clear()` throws `clear is not a function` or no-ops silently: `Object.defineProperty(window, "localStorage", { value: makeStorageShim(), configurable: true, writable: true })`. **Symptom is a `beforeEach` crash, not an assertion failure** — easy to misread as a component bug.

### 5 · NEVER ASSERT A FIRE-COUNT ON AN ASYNC EMIT UNDER StrictMode

A dynamic `import().then()` inside an effect is SWALLOWED on the SECOND invoke — measured `effectRuns=2, thenCallbacks=1, emits=1` — so the emit count reads `1` **whether or not the fire-once guard exists** and the test is structurally unfailable. Assert on a SYNCHRONOUS proxy inside the same effect body gated by the same `useRef`; if the emit count itself must be asserted, stub the dynamic import to a resolved module at module scope. **Always mutation-check a fire-count test** — delete the guard, confirm RED.

### 6 · ECHO THE RENDERED ITEM IN AN ON-OPEN REFETCH MOCK

A component that refetches on open REPLACES `initialItems` with the mock payload, so a mock resolving `items:[]` empties the assertion target and `findByRole` samples the empty-state node. Non-deterministic full-suite flake, green standalone and on re-run: the `setItems([])` `startTransition` macrotask is not drained by `await user.click`'s `act()`. Fix per test with `mockResolvedValue({ unreadCount: 1, items: [item] })`; keep the `beforeEach` `items:[]` default for count-only tests; do NOT add `vi.resetAllMocks()`, which advertises protection against a non-existent bug. Neither a shared-state leak (per-file isolation is on) nor a pool-startup flake.

| failure text | class | action |
|---|---|---|
| `received null` / wrong href | the refetch-empties race | apply the echo |
| `Unable to find … "menuitem"` | benign base-ui async-open timeout | different class |
| `Found multiple … "menuitem"` | the echo re-lit "Mark all read", itself `role="menuitem"` when unread>0 | filter to the LINK row: `(await findAllByRole("menuitem")).find(el => el.tagName === "A")` |

**Never `findByRole` singular on a bell popup that renders "Mark all read"** — it only passes by racing the transient badge-cleared window.

### 7 · BUILD StrictMode TESTS ON A RENDERED HARNESS, NEVER `renderHook`

`renderHook(cb, { wrapper: <StrictMode> })` does NOT double-invoke effects in this env (measured EFFECT_RUNS=1, React 19.2.7, NODE_ENV=test), so the regression test is vacuously green; `render(<StrictMode><Harness/></StrictMode>)` DOES (EFFECT_RUNS=2). Two resilient-effect patterns from the same arc: set a "consumed" guard only on TERMINAL paths, never in the returned cleanup (StrictMode's first cleanup otherwise marks work done that never happened); and capture-and-rewind mutated refs in cleanup.

### 8 · ANY ASSERTION ABOUT RENDERED CASING BELONGS IN `tests/e2e/` — jsdom HAS NO `text-transform`

`innerText`/`textContent` return the SOURCE literal whether or not `uppercase` applies, so the assertion is decorative BY CONSTRUCTION and no mutation can make it fail — the property does not exist in the environment. CSS casing is locale-aware (CSS Text Module Level 3 §2.1): under `lang="tr"`, `uppercase` maps `i` → **`İ`**, so a brand name carrying an `i` paints with a dotted capital. **A casing bug may NOT be dismissed on green unit tests** — five jsdom tests asserted the brand string and all five were blind. The e2e probe must `waitForFunction(() => document.documentElement.lang === "<locale>")` first, or it measures an SSR'd English document and passes with the fix REMOVED. The defect is per-NODE, so a one-surface probe is not a class guard; a per-node source sentinel is. Full rationale: `.claude/rules/i18n.md` (not in this copy) § THE SIXTH failure.

### 9 · RESOLVE ASYNC FUNCTION COMPONENTS BEFORE RENDERING AN APP ROUTER SERVER PAGE

`render(await Page({params}))` renders an EMPTY body — silently, no throw, no warning — because the awaited page returns an element whose `.type` is an async function component and client React drops it. **The symptom impersonates a real bug:** `Unable to find an element with the text: <your key>` over a body containing literally `<div />`, which reads as *"my branch never fired"* and sends you to debug the branch instead of the renderer. Read the printed body before forming a hypothesis — the ARTIFACT outranks the predicate (kin the `isVisible` instrument-lie in `tests-e2e.md`). Fix: `while (typeof node.type === 'function') node = await node.type(node.props)`.

### 10 · ASSERT `getAttribute("tabindex")`, NEVER `node.tabIndex`, FOR A FOCUS-TARGET CONTRACT

On a non-natively-focusable element the property is a computed default and is never absent, so no-attribute and `tabindex="-1"` BOTH report `el.tabIndex === -1` and only the attribute separates them (`null` vs `"-1"`). **Decisive pair on the same broken source: `getAttribute("tabindex")` → RED, `expect(node.tabIndex).toBe(-1)` → GREEN, 2 passed.** The idiomatic, type-safe spelling is the one that cannot fail for the reason it was written. ⚠️ Re-measured 2026-08-16 — the collision is real on `DIV`/`SPAN` and ABSENT on `<button>`/`<a href>`, which read prop **`0`** with no attribute; assert the attribute either way.

### 11 · A FRESH ELEMENT PER `render` / `rerender` — THE SAME ELEMENT OBJECT RE-RUNS NOTHING

React bails out of an element whose props object is `===` the last one, so `render(tree)` then `rerender(tree)` re-runs no component in it (1 render vs 2, React 19.3); only an RTL `wrapper` and its context consumers re-run. **TELL: one `const` element passed to both calls.** Call a factory (`const ui = () => <X/>`) per render; a `memo` component bails even then unless a prop changes. Archive.

## VITEST RUNNER

### CONVERT AN IN-BODY `await import()` OF A HEAVY MODULE TO A STATIC TOP-LEVEL IMPORT

The first lazy transform of a large `"use client"` module and its UI graph is charged to the 5000ms `testTimeout` and can exceed it under forks-pool contention → flakes in the full suite, passes in isolation. **Tell: only the FIRST in-body importer fails** (later imports are worker-cache hits), and sibling files importing the same symbol STATICALLY never flake. A static import pays the cost at COLLECTION, visible as the duration-line phase shift (`tests 892ms` → `import 912ms`/`tests 3ms`). **Never bump the timeout:** a per-test `, 15000` WIDENS the window (the flake migrates on reorder) and OVERRIDES `--testTimeout`, making it unprovable. **Mutation check: clamp `--testTimeout` below the module cost to reproduce deterministically, then confirm the static version passes at the same clamp.** The same move covers ONE-TIME work the arms share (a `src/` walk, a child-process run, a fixture build): compute it once at collection, which no timer covers and every `-t`-filtered run pays, or in a describe-scoped `beforeAll` with an explicit hook timeout when only that describe consumes it. The ban is on bumping an ARM's timeout to absorb first-touch cost, not on bounding inherently long work.

### THAT CONVERSION DISARMS A PLAIN TOP-LEVEL `vi.stubEnv` — PUT THE STUBS IN `vi.hoisted`
`vi.mock` hoists and `vi.stubEnv` does not, so the now-static import binds `tests/setup.ts`'s `http://localhost:3000`, not the file's stub, and the suite stayed 6/6 green. **TELL: a static-import conversion in a file with a `vi.stubEnv` and no arm asserting the stubbed value.** Stub inside `vi.hoisted(() => …)` above the import; assert a value only the stub produces.

### RE-RUN STANDALONE BEFORE CALLING A TIMEOUT BATCH A REGRESSION — READ THE POOL LINE

`Test timed out in 5000ms` ACCOMPANIED by `[vitest-pool]: Failed to start forks worker` / `Timeout waiting for worker to respond` is a worker-STARTUP flake: every file assigned to the dead worker times out together, so it reads like a broad regression. **Tell: an assertion failure names an `expected … to be …`; a worker-start failure names the pool.** Clean standalone ⇒ it was the pool. ⛔ **A vitest STARTUP error yields `rc=1` with ZERO test counts, which a pipe hides. TELL: `rc=1` with NO `Tests N passed` line AT ALL ⇒ the run never started** (measured cause: an unresolvable `--reporter=basic`). The discriminator is the ABSENCE of a counts line, not its value — the pool flake still produces real timeout COUNTS.

### A TIMEOUT CAN SURFACE IN THE NEXT ARM AS `Found multiple elements` — NOT AS A TIMEOUT

A timeout fails the arm but does not stop its body, and `afterEach` (RTL cleanup, auto or explicit) still runs on schedule; an `await` still pending in the timed-out body (an in-body `await import()`, a sleep) resolves DURING the next arm and renders after that cleanup, so the next arm's `getByRole`/`getByText` finds two nodes and fails with a DOM-query error that names neither the timeout nor the pool. **TELL: a `Found multiple elements` failure directly after a `Test timed out` in the same file.** Fix the timeout (§ above) and re-run; do not debug the second arm's query. Archive.

### FIXING A REPORTED RED? RE-RUN BEFORE YOU CALL IT FIXED — THE SAME BODY CAN HIDE MORE

vitest stops a body at the first failure, so every later assertion in it NEVER RAN and is invisible to the run AND to the reporter: a reported count is a FLOOR. ⛔ **Whole-FILE scope does not help — the sibling is in the same `it()`.** Only the re-run after the fix evaluates it. Measured 2026-09-02: a whole-file run collecting 47 tests reported 2 reds; a 3rd assertion sat in one of those same bodies. Archive.

### A PEER'S FIX LANDING MID-RUN VOIDS YOUR RED — CHECK WHO LAST TOUCHED THE FAILED FILE BEFORE REPORTING
`npm test` read `16 failed`, a re-run `0`: the shared-tree run had read a peer's uncommitted edit, committed 3 min after it ended (2026-09-20). **TELL: a failed file or its SUT shows an `M` you did not make, or a peer commits just after your run.** `git status --short -- <file> <SUT>` and `git log --since='<run start>'` over ANY path, then re-run before reporting a red. Archive.

### PICK SUITES BY THE FILE YOU EDITED, NOT THE SUBJECT YOU CHANGED
Before committing a source edit, `grep -rlF '<dir>/<stem>' tests/` — the path WITHOUT its extension, which imports omit — and run those suites. Measured: 53 test files import one shared templates module; its file name with the extension reaches 14 of them, its extensionless `<dir>/<stem>` all 53. ⛔ **`-F` is load-bearing:** without it a bracketed route segment is a character class, so `'projects/[id]/client'` selects 0 files against 20 with `-F` (2026-10-06). Archive.

### A FLAKY TEST IS FIXED ON SIGHT, NEVER LOGGED AS ANOTHER OCCURRENCE
No flaky unit test should exist. Find the cause and fix it in the pass that met it: a slow arm made fast, never a longer timeout. Log it only when the fix is blocked, and name the blocker.

### A `mergeConfig` SCRATCH CONFIG CANNOT NARROW A RUN — IT CONCATENATES `include`
`mergeConfig(base, { test: { include: [oneFile] } })` APPENDS to the base include, so the one-file run executes the whole tier (25,473 tests) and its extra failures read as peer noise. **TELL: a one-file run reports failures in suites you never named.** Pass the file as a CLI filter, or assign `merged.test.include` after the merge; `mergeConfig` joins every array (`exclude` and `setupFiles` too), so a target under the base `exclude` also needs `merged.test.exclude` reassigned, and an empty file list prints no error. Archive.

## MUTATION TESTING — THE CORE DISCIPLINE

### WHEN THE PROPERTY IS *DECOUPLING*, GREEN IS THE PROOF AND RED IS THE FAILURE — THE ONE PLACE THIS SECTION'S DISCIPLINE INVERTS

An assertion that a change must NOT propagate — a reword must not reclassify, a rename must not move a
branch — is proved by mutating the supposedly-irrelevant input and requiring the verdict to STAY THE
SAME. **State the counterfactual or the green is vacuous:** what the UNFIXED code would have done with
that same mutation. Measured: a classifier coupled by
`"We could not cancel…".startsWith("Could not cancel your subscription")` — false by inspection — so any
reword silently flipped the stage to `cascade`. ⚠️ Every other rule here says a green arm that cannot go
red is vacuous, so an author applying THAT correctly will "fix" a working decoupling test by inverting
it; name the property class before reaching for the mutation.

### THE SELF-TEST INLINE-COPY RULE LIVES IN `session-cadence.md`, NOT HERE — ITS POPULATION IS 103 FILES THIS FILE CANNOT REACH

⛔ **It was filed here and that was wrong.** `--self-test` files: **10 inside `tests/`, 103 outside**
(`scripts/`, `.githooks/`, `.claude/hooks/`), and this file's `paths:` are all `tests/…`, so the entry
reached 10 of 113 — its own measured instance, `scripts/wrap-reconcile.mjs`, being in the 103. Moved to
`session-cadence.md`, which is scoped to exactly that tree. **The gap-probe that missed the right home
was a subject NOUN (*"replica"*, *"two copies"*) and returned zero; one DIRECTIVE-VERB grep —
`grep -in 'extract'` — finds it on the first hit.** Grep the verb, and grep every sibling whose `paths:`
covers the tree your measurement came from.

### GREP THE GUARD FOR THE FEATURE'S OWN TOKENS — MUTATION PROVES A PREDICATE *DISCRIMINATES*, NEVER THAT IT *COVERS*

Independent properties; neither implies the other. A predicate can discriminate perfectly over a region that does not contain the feature, and every mutation behaves correctly while proving nothing about the shipped code. **TELL: you mutated your own PREDICATES, not the FEATURE.** Measured 2026-08-30 — a wiring sentinel scored **0 hits for 7 feature tokens** of the 140-line commit it certified; three mutants (dispatch deleted · sides cross-wired · order reversed) passed **5/5**. ⛔ **THE COVERAGE TEST IS PER GUARD-CLASS.** This read *"a guard that never NAMES what it guards covers nothing"* until 2026-08-30 — false, and it condemns every DISCOVERY sentinel, which names nothing BY DESIGN (**77 of 493 unit files walk their corpus**). **NAMED-TARGET guard (certifies one known commit/symbol) ⇒ grep it for the feature's tokens, zero hits ⇒ covers nothing. DISCOVERY guard ⇒ § A POSITIVE CONTROL MUST TRAVEL THE PIPELINE below — which this clause contradicted in its own file.** ⚠️ A cross-wire needs the whole tuple pinned — every token survives it, only the pairing moves. Archive.

### A MUTATION COUNT IS A CLAIM ABOUT THE MUTATIONS, NEVER ABOUT THE ARMS — KEEP AN ARM→MUTATION COLUMN

An honest M1-M13 table can coexist with 6 of 16 arms having NO mutation that REDs them: the table enumerates what you mutated, not what is covered. For any multi-arm guard file, the closing check is per-ARM ("which mutation REDs THIS arm?"), and an arm with no answer is unproven whatever the table's length.

### REVERT EACH ADDED GUARD SEPARATELY AND WATCH IT FAIL

A COMBINED revert of a multi-assertion addition REDs on the one live assertion and greenlights its decorative siblings, so it needs one pin per independent sub-property. **Run the cheap static layers first:** line-coverage exposes an unreachable path (the writer shows 0 hits) and an unasserted guard (lines uncovered) with no revert at all, and `od -c` settles fixture fidelity statically. Reading is UNRELIABLE but not useless — 0 of 6 caught by reading in one measured delegation is a measurement, not a law. **Sweep what you just ADDED, not only what you were sent to check:** a review boundary is drawn at the diff you SENT, so anything added while FOLDING that review is outside every reviewer's window and inside nobody's (reverting a validation guard added minutes earlier left the suite 119/0 GREEN). § FIVE MEASURED WAYS below is the taxonomy.

### A HELPER CLAIMING IDENTITY WITH AN EXISTING COMPUTATION IS TESTED BY HUNTING A DISAGREEING PAIR

Pinning ONE case proves agreement at one point; the claim is identity over the DOMAIN. Search the input
space for pairs where old and new derivations disagree (round-then-subtract vs subtract-pre-rounded
diverged ≤0.10 — enough to render "+0.1" beside "score unchanged") and assert the search returns empty;
a found pair IS the finding.

### SUBSTITUTE THE SIBLING'S LITERAL — DELETION ONLY PROVES THE CALL HAPPENS

For any assertion pinning a value out of a small set (a `tags.source` marker, an enum arm, a variant token), delete-and-watch-RED is the WEAK arm: it REDs as soon as the call disappears, which a bare `expect(fn).toHaveBeenCalled()` would also satisfy. The STRONG arm swaps in the neighbouring value the assertion must reject; GREEN under the sibling's literal means a presence check wearing a discrimination check's clothes. The revert-each-guard rule asks *is this assertion live?*; this asks *is it live for the RIGHT reason?*

### FIVE MEASURED WAYS A GREEN ASSERTION TESTS NOTHING

(1) **one-sided oracle** — fires-when-due pinned on a time-gated DESTRUCTIVE sweep with no fresh-fixture does-NOT-fire arm; (2) **expected-zero with no positive control** — an absence-grep keyed on a literal nothing else pins, so a reword makes it pass forever; (3) **unreachable path** — an upstream gate refuses the input before the writer under test is reached; (4) **malformed fixture** — doubled shell escapes meant `printf` emitted literal backslashes and the attack never happened (verify the bytes with `od -c`); (5) **unasserted guard** — protection shipped with nothing verifying it. **Fixture corollary: reach the guard by the path it DEFENDS, not the convenient one** — routed through the happy-path constructor it is caught by an earlier gate and passes vacuously. PARENT to search before adding a sibling: **`audit-check/SKILL.md` Check 4b(c)**. Cousins: the fire-count rule above, `typescript.md`, the `tests-integration.md` control-arm (not in this copy).

### WRITE THE WEAKER TRUE CLAIM WHEN A MUTATION REFUSES TO FAIL

When removing the guarded code leaves the suite GREEN for a structural reason — a tied-row ordering the DB satisfies anyway — the test proves the behavior is CORRECT, not NECESSARY. Write exactly that in the comment; do NOT retry until the ceremony passes. Reference phrasing: *"MUTATION-VALID for DIRECTION … NOT mutation-valid for PRESENCE"*. (An extension of the revert-each-guard rule — both assume the mutation CAN fail.)

### RUN THE SWEEP ON A QUIET TREE — 100%-RED IS THE TELL, NOT THE TRIUMPH

A sibling editing an imported module mid-sweep makes parity failures mask dead assertions as live: "30/30 RED" contained 4 false reds; the quiet-tree truth was 29/29. `md5`/`stat` the imported modules across the sweep window. ⛔ **A harness that failed N times mid-run makes its PASSING rows suspect too** — whatever broke was equally in force for them, and re-checking a re-run inherits that state. **A sweep with mid-run failures produces ONE reading: unknown.**

### THE SETTLE ANCHOR IS UPSTREAM OF EVERY ASSERTION AND OWNED BY NONE OF THEM

If a multi-arm test's `waitFor` anchor is the same call an arm asserts, a mutation that RELOCATES that call makes the `waitFor` never resolve, so arms unrelated to the mutation ALSO go red and arm 1 reports a false cause. **Tell is the DURATION: a `waitFor` timeout surfaces at the timeout value (1022ms), a real assertion failure in milliseconds (18ms/66ms)** — the summary lines are visually IDENTICAL, so both natural readings ("the properties are coupled" / "arm 1 is broken") are false. The revert-each-guard rule assumes arms are independent and says nothing about what makes them so.

## MUTATION TESTING — WAYS YOUR READING IS VOID

Each produces a well-formed reading of nothing. Ordered by what they assume: **a mutation ran at all**, the edit landed, the file parsed, the arm ran, the mutation was load-bearing, the proposition was true, the detector could return the other answer.

### THE UNRUN HALF — A MUTATION LABEL ASSERTED IN A PROPOSAL SHIPS AS THE RECIPIENT'S COMMENT

Upstream of every half below, which all assume a mutation RAN. **TELL: "the discriminating arm is X" written into a proposal or review, not beside a pasted result.** Measured 2026-08-31: the arm labelled as catching a dropped `i++` stayed GREEN under it, its plain sibling REDs — both live, opposite mutations. Run it, or ship the arm with no claim about what it catches. (archive.)

### THE LANDED CHECK — CONFIRM THE CODE ACTUALLY CHANGED BEFORE YOU READ THE GREEN

A mutation that edits a COMMENT is a mutation that never happened, and its GREEN is indistinguishable from "the assertion is decorative" — **the thing under test is fine and THE MUTATION is the blind instrument**, so you file a FALSE decorative-guard verdict against a live assertion. Diff it or re-count occurrences, THEN run the suite. Same hazard at N>1 occurrences when the edit takes the wrong one.

### THE TREE HALF — A cwd-RELATIVE TEST READS THE TREE YOU RUN FROM, AND `vitest --root` DOES NOT MOVE IT

A test that reads source via `process.cwd()` (`readFileSync(join(process.cwd(), "src/…"))`) ignores `--root`, so a mutant placed in a private worktree and run as `vitest run --root <wt>` from the main tree reads the UNMUTATED file and passes. **TELL: a mutant you expected to RED reads green, and the test resolves paths from cwd.** `cd <wt> &&` in the same call; never repair it by mutating the shared tree instead. Archive.

### THE CONTAINMENT HALF — A SUPERSTRING MUTANT PASSES THE LANDED CHECK

A mutant that renames by APPENDING (`+%FT%TZ` → `+%FT%TZMUT`) lands at every site and the re-count confirms it, yet a `'token' in output` assertion stays green forever because the mutant CONTAINS the asserted substring as a prefix. For a containment assertion the mutation must DESTROY the asserted token, and the landed-check counts the ASSERTED SUBSTRING post-mutation — never the mutated sites. Distinct from a comment TRIPPING a sentinel and from the `git checkout`-on-untracked no-op (`active-recall.md`), which breaks the RESTORE half.

### THE PREFIX-COLLISION HALF — EXACT-MATCH ONLY AT ARGLESS `>=N` ASSERTIONS

A substring count over `<key>` also counts every `<key>Note`, so a `>=N` floor is satisfied by the sibling alone: deleting the ENTIRE badge span left the file 13/13 GREEN, and the same substring sum MASKED a dual-render pin (5 RED → 7 RED once fixed). **The fix is scoped, not blanket:** substring is STRONGER for zero-counts and REQUIRED for argful literals, so a wholesale swap weakens the file.

### THE PARSE-ERROR HALF — THE RED MUST CARRY AN ASSERTION MESSAGE NAMING YOUR PROPERTY

An over-broad anchor breaks the file's syntax, and a parse-error RED is indistinguishable from an assertion RED in the summary — worse than the ORDER half, where at least a message names the wrong line. **No message ⇒ the file did not parse ⇒ your reading is void.** **Mutate a BALANCED CONTIGUOUS block, never a lone closing token:** a closer (`</ul>`, `}`, `)`, `</div>`) occurs N>1 times in any nested structure, so an editor keyed on one silently takes the wrong occurrence.

### THE ORDER HALF — READ THE FAILURE MESSAGE, NOT THE PASS/FAIL COUNT

vitest stops a test body at the FIRST failure, so if your mutation also REDs an earlier assertion the one you are pinning never evaluates and the RED came from a different line. **The summary for the two cases is IDENTICAL** — one failed test, same file, same name. If the message names an earlier assertion, move yours above it or split the arm. Distinct from the settle-anchor rule (an anchor shared ACROSS arms; this is sequence WITHIN one arm).

The TRIAGE direction of this same mechanism is an ACTION, not a reading — it lives in § VITEST RUNNER, where a red gets diagnosed.

### THE AIMING HALF — SINGLE-ARM ATTRIBUTION, AND ASSUME YOU MISSED FIRST

Ask the prior question: **is the statement you mutated on the path the assertion actually reads?** Measured 36/36 GREEN after mutating a `??` fallback tail while the real guard was the `if` block on the line above, which still short-circuited — edit landed, diff confirmed, file parsed, suite completed; the mutation was REAL and not LOAD-BEARING. All-green means the assertion is decorative **or your mutation missed, and the count cannot tell you which.** **This produces a well-formed reading of nothing THAT ARGUES FOR DELETING A LIVE GUARD** — re-aiming is cheap. Not "did I get a RED" but "did the RED name the arm I aimed at, and ONLY that arm?"

### THE SUBJECT HALF — THE ARM YOU MUTATED MUST SIT ON THE PATH YOUR COMMIT SUBJECT CLAIMS TO FIX

The exact inverse of the AIMING half: the mutation HITS a real load-bearing arm and REDs **correctly**, so no existing check fires and the reading banks with full confidence — while certifying a DIFFERENT component than the commit says it fixes. Measured where a commit about an ALLOCATOR mutation-proved an in-flight WARNING count while the allocation floor lived in another script, reached by an `execFileSync` and a stdout parse. **Watch a SHELL-OUT specifically** — where the two paths visibly diverge and an import-graph read cannot follow. A mutation certifies the statement you disabled; a commit message asserts the defect you fixed, and nothing compares the two.

### THE PREMISE HALF — MUTATION NEVER ASKS WHETHER THE PROPOSITION IS TRUE

It measures whether an assertion RUNS and DISCRIMINATES. When the pinned property is false the apparatus certifies the error, because the mutation is evaluated *by the same belief that produced it* and cannot dissent. Measured: "a pure-digit token is NOT a git sha" shipped with a full mutation-pair and passed; `<commit-id>`, all digits, IS a commit here, and all-digit short shas run **80/5000 = 1.60%** against a theoretical `(10/16)^9 = 1.46%` — a mutation-proven guard silently dropped ~1 review in 60, fail-open. **For any assertion about what something IS — a sha, a valid id, a real path, a live route — the oracle must be THE SYSTEM THAT OWNS THE FACT** (`git cat-file`, the parser, the router), never your own shape heuristic. **If your predicate and your fixture were authored in the same sitting from the same intuition, they are one observation, not two.** Distinct from the ORACLE half (broken detector) and from right output with wrong prose on top.

### THE ORACLE HALF — BASELINE-GREEN FIRST, AND READ THE UNPIPED EXIT CODE

In a mutation harness RED is the DESIRED reading, so a green-detector stuck at "fail" produces a flawless-looking run in which every mutation "correctly" REDs. Measured: `("Tests  3 passed" in out or "3 passed" in out) and "failed" not in out.lower()` never returned true, so five *mutated → RED ⇒ live* readings measured nothing; it surfaced only because that harness printed a RESTORE arm (`restored->STILL RED!` on all five rows), and **the ordinary mutate → run → restore → next shape has no restore arm and would have printed "✓ every assertion is live."** Two one-line fixes: a BASELINE GREEN before the first mutation (a positive control on the DETECTOR, not the code), and `r.returncode == 0`, never a substring of human output (the piped-`tee` exit-code trap's callee side).

### RE-MEASURE A MUTATION TABLE, NEVER HAND-EDIT IT, IN THE SAME COMMIT AS ANY ARM CHANGE

A header documenting `mutation → expected failing arms` is a SPEC that any later arm-addition silently invalidates, and the danger is directional: a maintainer who sees **one more failure than promised** "fixes" the extra arm to match the doc, **retiring a live guard**. Nothing in the suite can catch it, because the table is a comment. This binds the INTEGRATION tier too.

### A PROOF EARNED MID-BUILD EXPIRES AT THE NEXT EDIT — INCLUDING THE COMMIT MESSAGE CITING IT

Revert-and-watch-RED is satisfied at a MOMENT against a SHAPE; reshape the arm afterwards (split it, re-anchor it, move an assertion) and nothing re-runs, so the message written from the earlier reading asserts a property of a thing you are no longer shipping. **Nothing in the toolchain re-checks a commit message against the FINAL diff.** Re-run the mutation, or downgrade the claim to what you can still see. Kin the DOCUMENTATION rule — that governs a TABLE falsified by a later arm, this the PROOF and MESSAGE falsified by a later edit to the arm.

### A DELIBERATELY-MINIMAL ARM CARRIES AN IN-FILE "DO NOT STRENGTHEN" NOTE

An arm kept single-assertion on purpose (to avoid order-shadowing) is indistinguishable from an under-written one, so the next reviewer "improves" it and re-arms the defect it was shaped to avoid. Self-document AT the assertion: *"deliberately single — adding the persist assertion re-introduces the shadowing removed at &lt;ref&gt;"*.

### TREAT AN "EQUIVALENT MUTANT" CLAIM AS A MISSING-ARM HYPOTHESIS

"No test can distinguish these two programs" asserts an impossibility rather than a measurement, and it is self-serving — it converts a GREEN you could not explain into a credit. Hold it until an independent instrument refutes it; in a review queue it routes FIRST, with a refute mandate.

### RE-CHECK THE GREEN ROWS OF A MUTATION TABLE, NOT ONLY THE REDS

A GREEN disclosed as "defense-in-depth behind X's own check" proves only that the current fixtures cannot distinguish the two layers; the disclosure is a claim ABOUT X, which the mutation cannot test. **Run X directly against the input class the mutated layer defends** — if X admits it, the green marked a MISSING ARM (measured: both layers admitted `"constructor"`, and every off-registry fixture was a junk string a bare index also rejects, so the green measured the corpus's SHAPE, not the code). Then add the discriminating fixture, and delegate GREEN rows explicitly.

### ONE MUTATION ARM PER INDEPENDENT BRANCH — A MUTANT CAN DELETE ITS OWN PRECONDITION

On a multi-row parity table "mutation-checked" is a PER-ROW claim: a `round→floor` mutant deleted the very overflow that opens the slide branch, so the branch could not fail under it and its row passed coincidentally ("same answer, different route"). Give each branch its own arm with SINGLE-CASE RED attribution, and record semantically INERT mutants (`>`→`>=` at an equality boundary) in the provenance comment so nobody spends a fixture closing a non-gap. **A TWO-AXIS correction (x/y, left/right) built from one fixture set typically reaches ONE axis** — add the symmetric fixture in the same fold.

### WHEN YOU ADD A GUARD, RE-RUN THE MUTATIONS OF EVERYTHING IT NOW SHADOWS

A NEW guard retro-actively over-determines every existing fixture, so the commit that adds protection GROWS the decorative surface it meant to shrink. Measured: a separation fence added upstream of a range guard made the range guard's mutation come back GREEN, because every out-of-range fixture (`1.4`, `-0.1`, `NaN`) was already >0.25 from the elected point. The reading it produces — a GREEN arm on the OLD guard — is exactly the one the revert-each-guard rule teaches you to read as "decorative". **The discriminating fixture for the shadowed guard must violate its property AND satisfy the new one.**

### EXTRACT TO A PURE MODULE AND RE-RUN THE SAME MUTATION BEFORE CALLING AN ARM DECORATIVE

⚠️ **A `scripts/`-SIDE COPY EXISTS AND THEY DIFFER DELIBERATELY: `session-cadence.md` § A NEW GUARD NO ARM CAN REACH IS SHIPPED APPEARANCE.** This file's `paths:` carries no `scripts/**`, so a guard author there cannot reach this entry — and this entry's own trigger presupposes a mutation already run (*before calling an arm decorative*), while theirs fires when NONE was run. Two triggers, one remedy. **Edit them as a pair; a future reader cannot otherwise tell adaptation from drift.**

The first hypothesis on a green feature-kill is a decorative assertion; the SECOND, cheaper to test, is untestable-by-location — the code sits where nothing can observe it. RED after extraction means the extraction WAS the fix (measured: two feature-killing mutations sat GREEN inline and both flipped RED once the derivation moved to a pure module — the harness diagnosed the design). A build agent taking this unbriefed refactor FLAGS the scope deviation. Companion: a guard reachable only through a PAID run gets refactored into a pure export and tested directly; honest disclosure of unreachability is second-best.

## MUTATION TESTING — RESTORE-HALF BREAKERS

Six ways the restore fails while reporting success. **Restore by the INVERSE of the apply mechanism, anchored UNIQUELY PER SITE, content-keyed on BOTH halves — and the content-key is the WHOLE-FILE md5 against a pristine pre-mutation copy, never a token count and never the editor's exit code.** A token COUNT is valid only when the replacement is unique, and it fails BOTH ways — measured same-day, independently: a non-unique `]);` replacement made a CORRECT restore report CONTENT-KEY FAILED and halted a clean sweep (false-FAIL), while an empty-string insert and a substring-of-anchor wrong-occurrence restore both PASSED the count check and only the md5 caught them (false-PASS). On a MANY-WRITER file the md5 comparison must tolerate legitimate peer edits (item 4 below) — scope it or diff instead.

### 1 · A BROAD RESTORE ADDED "JUST IN CASE" IS THE ONE THAT RUNS

A script carrying `git checkout <file>` AND the correct inverse-python restore ran the checkout first and wiped three uncommitted build hunks, with the warning comment on the line below it. DELETE any broad-restore sharing the script (the bare-commit-sweeps-the-index rule codifies belt-and-braces-defeats-isolation for commits; this is the restore side), and pair every restore with a SAME-COMMAND content-key asserting your co-located edits still exist — the restore's own output ("checkout already restored it") reads like success.

### 2 · AN IN-PLACE `perl`/`sed` RESTORE NO-OPS SILENTLY ON A TEMPLATE LITERAL

`${}`/backtick escaping makes it exit 0 with the mutation still live, and the next green you read is the mutated code passing. The restore is itself an edit that can fail to land: hand-restore via Edit, then re-count.

### 3 · THE RESTORE NEVER RUNS AT ALL, BECAUSE THE AGENT HOLDING IT DIED

An API-credit exhaustion, a rate limit or a kill mid-mutation leaves the corruption in the tree and NOTHING announces it: the process is gone, its final message says nothing about outstanding state, and the harness reports `failed` with an API-error summary naming the billing problem, not the tree. **Check, two lines, before ANY reading from a worktree another agent used: `git -C <wt> status --porcelain`, then content-key that agent's mutated files against their `main` md5.** A dirty worktree from a dead mutator is a live false-baseline, not leftover state.

- **Recovery is worth attempting rather than assuming empty.** One dead lens's transcript held **13 completed mutations with verbatim failure messages** while its assistant prose was one line, so an extraction reading only assistant TEXT reports nothing and discards the work. Parse its `tool_use` records.
- ⛔ **`isolation: "worktree"` IS A REQUEST, NOT A GUARANTEE — "so main is safe" is a premise.** Five agents dispatched WITH it: **four had no worktree and ran in the shared repo.** A RESUME is the sharpest edge — dispatched isolated, died, resumed, now shared, brief still asserting isolation. Worktrees are NOT pruned (34 survive spanning Jun 28 → Aug 13), so "no worktree now" IS evidence of "never isolated"; verify your own plane rather than believing a brief. ⭐ **The switch is usually unnecessary: worktrees share ONE object database, so `git show <ref>:<path>` reads any blob from ANY cwd.** Read at a ref; never switch a tree you did not create.

### 4 · A WHOLE-FILE SNAPSHOT RESTORE ON A MANY-WRITER FILE IS A LOST UPDATE

`cp f /tmp/bak` → mutate → `cp /tmp/bak f` is textbook and correct on a private file; on a shared tracker the snapshot is an IMAGE, so the restore does not undo your MUTATION, it undoes the FILE — including every peer commit landed during your experiment (measured: six peer commits reverted for ~4 minutes on a shared tracker file). **The cost is not lost text, it is a RESURRECTED ERROR:** it reinstated a false claim about a peer their own measurement had just corrected, and a restore of a *previous, plausible, wrong* version reads as the file simply being what it was. **Tell: the numstat DELETE column exceeding what your own edit can produce — run it BEFORE, in the same command as the commit (bare-commit sweeps the index).** ⚠️ It earns a slot because the motivating act is GOOD PRACTICE: the hazard is in the RESTORE PRIMITIVE the discipline reaches for, and it fires only on a file with other writers, so it is invisible in every private-file rehearsal.

### 5 · THE INVERSE EDIT LANDS ON THE WRONG OCCURRENCE, AND A COUNT-KEYED CHECK IS SATISFIED BY THE SWAP

A restore that writes two keys EXCHANGED across sibling ternary branches comes back `1/1` — byte-for-byte the same totals as HEAD — while a live defect certifies as restored. **A content COUNT cannot separate "restored" from "swapped".** Require BOTH a post-restore occurrence count == mutated-site count AND the numstat reconciled against your intended edits. **A substitution is not always invertible by substitution:** when the file already holds N legitimate targets the inverse hits all of them, caught only by the script's own site-count guard reading 4 ≠ 2.

### 6 · NEVER USE AN EMPTY STRING AS A MUTANT REPLACEMENT

`s.replace("", old, 1)` INSERTS at position 0 rather than restoring anything — a mutation whose replacement is empty has no invertible form. Use a non-empty sentinel, always. (Measured independently by three agents in one session, which is why it is a flat prohibition rather than a caution.)

### MUTATE IN A `git worktree`, NEVER IN THE TREE THE FLEET IS RUNNING FROM

Every clause above governs whether YOUR READING is sound; none asks who else EXECUTES the file while it sits mutated. `src/` too: a peer's `tsc`, or a `vitest` importing it, compiles your mutant. Archive. For anything the harness re-reads per invocation — a `.claude/hooks/*.sh`, a `settings.json` matcher, a shared script a cron fires — the answer is *every seat, on its next turn*: no build step, no cache, so the mutant IS the live artifact until the restore. **The tell is that there ISN'T one** — suite green, restore md5-identical, reading sound, and the damage lands in transcripts you will never read (a peer received one mutant's output in its own context and reported it back). `git worktree add --detach <dir> HEAD` costs one command; when the harness resolves the target by an absolute path you do not control, the window is unavoidable and must be **DECLARED** rather than hidden, and held to a single run. ⚠️ **The reviewer half was got right in the same hour, on the same file, by the same parties — copy it:** a hub briefed its own lens **not to edit the hook at all**, because *"a review that breaks the thing it is reviewing on a fleet-wide surface is a worse outcome than a missed finding."* **A mutation sweep IS an edit, and a deliberately broken one.** ⛔ **The reverse voids YOUR reading: a scratch root whose `src/` symlinks the live tree IS the shared tree, so a peer's edit lands inside your sweep** (three mutants went 1 → 50+ red). **TELL: a mutant's red count moves with no change of yours.** Use `git worktree add --detach`, never a symlinked `src/` (a `node_modules` symlink is fine). Archive.

### A DISCIPLINE YOU HOLD IS SCOPED TO THE ACT YOU LEARNED IT ON — THE SIBLING ACT INHERITS NOTHING

Two doors, because the two measured instances entered through different ones. **(1) ACROSS ACTS:** name the sibling act you just performed under the same discipline and ask whether you applied it there too. **(2) WITHIN ONE ARTIFACT — the harder door: name the sentences you did NOT treat as claims.** A reviewer verified every FINDING at source and cited each at a line, while its diagnosis (a past-tense act it never observed) and its caveat (an ABSENCE asserted with the file open and no grep run) rode at a lower bar — **context reads as background rather than as assertion, which is why nobody audits it, including its author.** ⚠️ **A BENIGN diagnosis CLOSES an investigation.** Kin `behavioral-anti-patterns.md` #9's VERDICT-WORDING SIDE.

## FIXTURE DESIGN

### AN ABSOLUTE FIXTURE STAMP ROTS AT THE PERIOD BOUNDARY WHEN THE OTHER SIDE IS DERIVED FROM NOW

**TELL: the CONTROL arm fails, so it reads as a product bug and the real assertion never ran.** ⛔ **Ask whether the other side derives from now IN THE CODE UNDER TEST — never whether `Date.now()` appears in the file:** the incident's pre-fix fixture held ZERO clock calls, so a symbol-grep answers NO on the one file known rotten. A deliberately PINNED clock keeps absolute stamps. ⚠️ A whole-month relative anchor re-arms it — `addOneMonth` clamps, so a 60-day anchor sat ON the boundary **5.24%** of days. Copy a surviving sibling. Archive.

### A MACOS-ONLY PATH IN A TEST IS GREEN LOCALLY AND RED ON CI'S LINUX RUNNER

CI tests run on `ubuntu-latest`; `unit` runs on a PR into or push to `main` or a manual dispatch, never a `dev` push, so the red lands at the promote. **TELL: an arm needing `/private/tmp`, `/var/folders` or `/Users/` to exist or be this host's; a string fed to a pure parser is portable.** Build roots from `os.tmpdir()`; such an arm gets its own `skipIf`, never a shared `beforeAll`. Archive.

### A CLOSED DATE WINDOW IS *NOT* AN OBSTACLE IN THIS TIER — DERIVE THE FIXTURE INSTANT FROM THE CONSTANT

Inverse of the entry above, and the cheap half: a future-dated gate does NOT make an assertion uncheckable here — construct the instant inside the window FROM the constant, as an existing sibling test does, and its ten arms go RED today against a shut window. **TELL: you are about to write that a date-gated branch "can't be tested until the date".** ⚠️ An entry claiming exactly that lived here and was refuted in 500 ms in this tier; its evidence was INTEGRATION-tier, so it moved to `tests-integration.md` (not in this copy) § ASSERTIONS THAT PROVE NOTHING. Archive.

### ONE ARM MUST SUPPLY ONLY THE CHANNEL PRODUCTION ACTUALLY GETS

A factory that populates EVERY alternative in a fallback chain (`.digest ?? .message ?? .code`, a config cascade, a header/cookie/query fallback) cannot detect which one the code reads — the suite is green for every possible reader, including the prod-dead one. Measured: `codedActionError` stamps all three, so mutating a dialog's reader to the prod-dead bare-`.code` left its file **5/5 GREEN**, and a digest-only prod-shape fixture turned the same mutation into a single-arm RED. **Too few channels blinds you and too many blinds you as well — and too many is what a realistic factory produces**, so this is the one you meet by default (`api-routes.md`, not in this copy, records the opposite direction). A helper-level pin does not cover a reader that bypasses the helper.

### MAKE BOTH COMPONENTS NON-ZERO IN A SPLIT-METRIC TEST, AND PIN THE COMBINED VALUE

"The decomposed arm passes where the COMBINED metric would fail" is unfalsifiable when the fixture ZEROES the other arm: with one component at 0, combined ≡ the remaining component, so the named contrast is arithmetically unreachable BY THE FIXTURE, not by the assertion. Pin the combined quantity explicitly (`frameMean > budget`) alongside the per-arm pins, or the test proves only that one arm equals itself. Caught by fixture arithmetic before any spend: `verdictFails:0` made "combined would fail legacy" impossible at any budget.

### EXACTLY ONE CONJUNCT DOES THE WORK IN EACH ARM

When a guard is `A && B` and the fixture violates BOTH, deleting either conjunct stays RED via the other — so both pass the delete-mutation while neither is individually proven. Fixture OVER-reach, distinct from the zeroed-arm trap (contrast unreachable) and the substitution asymmetry (assertion discrimination).

### READ THE CONSUMING QUERY'S `ORDER BY` FOR ANY POSITION-DEPENDENT FIXTURE

A tie-break arm seeded rows in the order it wanted the tie resolved, but the consumer reads `recentCritiques` **DESC**, so the seed arrived inverted and the branch under test was never entered — the arm passed for a reason unrelated to the guard. Applies to first-wins, tie-break, last-write and N-th-element fixtures, and to Map/array insertion contracts. Distinct from (3) of § FIVE MEASURED WAYS: there an upstream GATE refuses the input, here the fixture's own ordering assumption is backwards.

### MAKE THE SUPPRESSED PATH EMIT A POSITIVE RECORD — FIX AT THE SUT, NOT THE TEST

An "abstains" / "does not fire" expectation over a branch whose suppression produces NO artifact passes vacuously forever: there is nothing to read, so it cannot distinguish "correctly suppressed" from "never reached" from "suppression logic deleted". Distinct from (2) of § FIVE MEASURED WAYS — here even a positive control cannot help, because the negative branch is artifact-free BY DESIGN. Emit a provenance row with `injected:false`, or a reason-coded skip marker, and assert on that.

### EVERY SUPPRESSION ASSERTION OWES A PRESENCE ASSERTION IN THE SAME RENDER

"X must NOT appear" is satisfied by rendering NOTHING, so a suite of such arms is individually correct, collectively complete-looking, and GREEN over a blank component. **TELL: every assertion in the arm is negative.** Measured 2026-08-27: three suppressions, zero presence checks, green while the block rendered nothing for two whole rounds — and BOTH arms touching that threshold pinned the silence, so nothing could see the gap. ⚠️ NOT the artifact-free case above (there suppression legitimately emits nothing and the fix is at the SUT). Mirror of the vacuous-control family: those cannot FAIL, this cannot DISTINGUISH. Archive.

### BEFORE NARROWING A TWO-SIDED ARM, MUTATE AND SEE WHICH HALF GOES RED — THE "REDUNDANT" HALF MAY BE THE ONLY LIVE ONE
A positive assertion over a whole rendered body is satisfied by any matching substring, so it weakens as the corpus grows, while the negative half stays bound to the defect. Measured: under the drop-separator mutation only the negative half went red. This points the other way from the entry above: keep both halves until a mutation says which one carries the arm. Archive.

### GATING AN EXISTING ROW ON A NEW OPTIONAL PROP INVERTS WHAT ITS PRESENCE ARMS PROVE

The suppression rule above is the mirror; this is the direction where every arm is POSITIVE and the
newly-dominant path has none. Adding an optional prop makes ABSENCE the majority case — measured on
`ShareButton`'s Instagram row, the no-prop path became **10 of 12** render sites with zero assertions
repo-wide, while the two prop-bearing arms stayed loudly RED and read as sufficient coverage. **TELL:
your repair is "add the prop to the two renders that already assert".** The prop-fed arm also degrades
to self-grading — its oracle becomes the fixture it was handed, so it
survives the one mutation that matters, `prop ?? fallback`.

### SPLIT DELIVERY FROM PATH-LIVENESS BEFORE DISCLOSING SOMETHING AS UNTESTABLE

A test env with no DSN still proves a telemetry canary's PATH is live: `vi.mock("@sentry/nextjs")` supplies the module the guard's DYNAMIC `import()` resolves, making `captureException` observable, because the inner `try` then never takes its failure branch. *Delivery* needs a DSN and stays out of scope; *liveness* closes in one arm, mutation-proven. ⚠️ **An excuse that has already been refuted does not stop being load-bearing until you re-read it** — four minutes after that split the same session wrapped a nested `try` around the telemetry call and excused testing it with the same dead premise; deleting that nested try left every arm green. When a caveat you wrote is disproven, sweep the other places you leaned on it (factual-claim verification at the self-authored-caveat surface).

## SENTINELS AND SOURCE PINS

### DRIFT-SENTINEL SOURCE-READ CARVE-OUT — THE SANCTIONED EXCEPTION

The no-`readFileSync`-as-behavioral-substitute rule does NOT apply to a drift sentinel whose assertion TARGET is the source literal itself (count-copy drift, pricing-copy drift): there is no behavioral surface to call for the SOURCE half, so importing the real constant and reading the real copy IS the correct shape. **Bounds: it must still assert against the CONSUMER surface** — message bundle, rendered output — never source-vs-source, and it must name this carve-out in a comment. One count-copy drift sentinel's comment cited the exception before it was written anywhere; **this file is the cited home.**

### PIN THE PREDICATE SEPARATELY FROM THE ARITHMETIC IT FEEDS

A parity sentinel that pins a predicate's CONSUMERS cannot see the predicate weaken. The consumers — midpoints, clamps — are the readable, quotable half, which is why they get pinned; the predicate decides whether they ever run, so when production gained separation clauses upstream of `hasCounterpart` the sentinel stayed green and a paid cert leg certified a crop the product does not ship. **For every mirrored/parity sentinel, name the PREDICATE and pin it separately.**

### STRIP COMMENTS BEFORE MATCHING — A PRESENCE-ONLY SOURCE PIN IS COMMENT-BLIND

⛔ **THE STRIP HAS A POLARITY: it belongs on a PRESENCE pin and never on an ABSENCE sweep.** A dead-palette absence sweep must stay RAW — a retired hex named in a comment is still a straggler, and `codeOnly` would let it through. Read this heading as scoped to presence pins; an absence sweep that strips comments has narrowed itself.

Commenting the call out satisfies `toContain` while disabling the guard. **The defect is per-DESCRIBE, not per-arm**, so fixing the one arm you noticed leaves the block — treat "presence only" in a describe title as naming a whole block's weakness. Assert on an executed observable where you can. Kin: § DERIVE FIXTURES FROM THE OBLIGATION and the use-vs-mention class in `session-cadence.md`.

### AN ASSERTION'S EXTENT MUST EQUAL ITS CLAIM'S — AND THE MISMATCH RUNS THREE WAYS, SO "ASSERT NARROWER" IS THE WRONG LESSON

Three seats, one night (2026-08-25; 1 of 3 verifiable at source, 1 mechanism-only, 1 author-reported), predicate and pipeline CORRECT every time — only the SET the assertion ranged over differed, in a DIFFERENT direction each: **NARROWER** (`smoke-test-hooks.sh:1226` asserts "EACH router" over ONE of two members — a first-write-wins mutant passed all four arms); **WIDER** (a whole-file `toMatch(/demo\.ts/)` satisfied by an unrelated comment in another source file); **COARSER** (arms asserting an advisory PRESENT while two defects sat INSIDE it, 866 green throughout). **Fix: name the region the claim is about, then assert over exactly that** — `src.slice(start,end)` for a block, one arm per member for a quantifier, content-not-presence for correctness. TELL, identical in all three: the arm was written in the SAME PASS as the fix it guards. Kin the comment-blind pin above. Full three-instance narration + provenance split: the archive's 2026-08-25 displacement entry.

### A TEST'S TITLE AND COMMENTS ARE CLAIMS — DIFF THEM AGAINST WHAT IT ASSERTS

The self-description states the OBLIGATION while the assertion pins its VIOLATION, so the arm certifies the defect under a name that denies it. **TELL: you fix something ELSE and an unrelated arm goes RED.** N=2 causally independent, 2026-08-31, two seats, ~1h apart, neither found by looking. Archive.

### UNDER KEEP-BOTH, A PIN NEEDS `toBe` PLUS AN ALT-TOKEN ARM

The keep-both artifact policy leaves the REJECTED variant one path-token away, so a safety swap needs an exact-src pin AND an alt-token pin (`toBe`, not `toContain`) — a presence assertion stays green when the rejected variant walks back in, and one such revert ran green 51/51. Arm the mutation with the DISCRIMINATING fixture: the item that distinguishes the two behaviors, not a representative one.

### REPLACE PAIR-EQUALITY PINS WITH SET-WIDE UNIQUENESS WHEN A SURFACE RENDERS THE REGISTRY AS A SET

Every "A's src ≠ B's src" pin silently converts into a duplication LOCK too weak for the set; use `new Set(srcs).size === srcs.length`. **Defect visibility is dose-dependent (GRID-DOSE)** — a duplicate invisible at 2 instances is glaring at 20.

### MUTATION-PROOF-BY-HISTORY — CITE THE FAILING VALUES *AND* THE INSTRUMENT

A same-commit fix+guard discharges revert-and-watch-RED when the guard PROVABLY fails on the pre-fix values (the pre-fix state IS the mutation); cite those values in the test comment. ⛔ **The discharge is VOID unless the history was measured with the SAME INSTRUMENT the guard uses.** A guard shipped citing a genuinely real defect observed by a probe waiting ~1200ms for a client-side `lang` flip, while the guard read at `domcontentloaded`, *before* the flip: same page, same defect, different instrument → 4/4 green with the fix fully REMOVED. **Tell: guard and historical observation live in different tiers or wait regimes.** The values-check asks whether they WOULD fail, never whether your guard is positioned to OBSERVE them.

### COUPLE A GUARD ACROSS COMMITS WHEN COMMIT N DEPENDS ON COMMIT N−1

A same-commit fix+guard is structurally unguarded against its own revert: `git revert` deletes the guard ATOMICALLY with the fix, so coverage and defect vanish together and nothing notices — measured on a revert that auto-merged clean, passed tsc, ran **8338 passed / 0 failed**, and shipped the inert-remedy dialog to a user cohort at a HIGHER volume than before either commit. The commits were 5 apart, so a targeted single revert or a bisect is the NATURAL operation. **Put the joint assertion in a file a revert of N−1 does NOT touch, IMPORT N−1's symbol, and assert the joint property.** Verify both layers — **VALUE** (flip N−1's value → that arm REDs with a diagnostic naming the remedy) and **SYMBOL** (`git show <N-1>^:<file> | grep -c '<exported symbol>'` → 0, and 1 at `<N-1>`, so after a revert the arm that READS the symbol REDs — never the import itself: vitest resolves a missing named export to `undefined` with NO import-time error, so an import no arm reads couples nothing; measured on vitest 4.1.11, 2 passed with the export deleted). ⚠️ **Its own trap:** if the guarding file `vi.mock`s the module it imports the symbol from, a LITERAL factory returns only what it lists, so the arm's first READ of the symbol THROWS (`No "<symbol>" export is defined on the mock` — at the read, not the import: an arm that never reads it still passes; § SPREAD `importActual` throws at import only because there the SUT reads the export at module load; measured on vitest 4.1.11) and the arm REDs for the mock, not the revert — spread `importActual`. *(Read "silently resolves `undefined` … or passes vacuously" until 2026-09-26, contradicting that section.)*

### XOR COVERAGE-SENTINEL — NEVER-NEITHER, NEVER-BOTH, PLUS A DEAD-LINE CLAUSE

For a registry where every member must have exactly one of two treatments (a weight line XOR a reasoned `DOCUMENTED_GENERIC` entry): assert both directions, and add a clause failing on an entry whose subject has left the registry. Prevents silent omission and contradictory double-coverage.

### WIRE A GUARD INTO A RUNNER — `tests/scripts/*.test.sh` IS EXECUTED BY NOTHING

A guard placed where no runner executes it advertises enforcement it lacks (the wired-but-inert class at the test-home surface). When converting YOUR OWN guard out of a dead location, sweep the SIBLINGS you copied from — the discovering session converted its own and left the money-path sibling dead.

### PIN THE PROPERTY THAT IS SUPPOSED TO BE STABLE, NOT THE ONE THAT LEGITIMATELY MOVES

A SIZE pin on a growing set is edited on every legitimate change — the shape that trains people to update pins without reading them, and that erosion is invisible to every mutation discipline because the pin keeps passing after each rubber-stamp edit. Pin the CLASS VOCABULARY instead: a new class appearing is exactly the event worth a review signal. On RED, register the new class in the set's doc-dict AND update the pin in the same reviewed change.

### A PIN'S REFRESH MUST LIVE IN THE WORKFLOW THAT MOVES THE PINNED SET
A restated count pin meant to "force a re-derive on growth" sat RED for SEVEN consecutive commits (enumerated — the first citation said FOUR, from samples): enrollment grows the set in a workflow that never runs the pin's file, so the forcing function fired where nobody looks. Deleted with tombstone; invariant now derived-vs-derived. Confirm the workflow that moves a pinned set RUNS the file holding the pin.

### ASSERT EACH ANCHOR RESOLVED AND ORDERED BEFORE SLICING SOURCE BETWEEN TWO SYMBOLS

An anchor-pair guard fails ASYMMETRICALLY: the START anchor fails CLOSED, the END anchor fails OPEN. A broken end anchor silently widens the window to EOF (measured 3.3×) and a `toContain` over it keeps passing, so the guard asserts "somewhere in the back half of this file, something does". Check `indexOf > -1` on each anchor AND `end > start`; **a `length > N` proxy stands in for anchor validity — assert the real predicate.**

### ASSERT A MENTION-BLIND PREDICATE'S BLINDNESS IN THE NEGATIVE CONTROL — DO NOT TIGHTEN IT

When a fail-loud arrival-watch's regex would also match a COMMENT mentioning the token, the obvious fix is the wrong one: a declaration-shaped tighter regex re-introduces the trap in the other direction (one spelling of "declares a column"). Flip the control to ASSERT the known blindness, so the next reader meets *"a comment mentioning this token WILL RED this arm; that is accepted"* rather than reading a false RED as arrival.

### VALIDATE A CLASS SENTINEL'S PREDICATE AGAINST THE PRE-FIX FORM OF EVERY SITE YOU JUST FIXED

The just-fixed set is a free, perfectly-labelled positive corpus and the only ground truth for "does my predicate recognise a member when it sees one": `git show <sha>^:<file>` per swept site (or the diff's `-` lines) → run the candidate → any just-fixed site it misses ⇒ widen. Measured: a `SelectValue` sentinel keyed on `/<SelectValue\s*\/>/` was blind to **3 of the 7 sites the same commit had just fixed**, because those carried `placeholder={…}` — the OBLIGATION was "no children render-fn", the PREDICATE was one spelling of it. **⚠️ EVERY EXISTING MUTATION DISCIPLINE PASSES THIS BLIND SPOT:** revert-and-watch-RED proves the assertion live against the CURRENT corpus, and it was — the guard failed only against instances that no longer exist in the tree.

### WIDEN A JUST-FIXED CORPUS WITH SITES YOU DID NOT FIX — YOUR OWN SPELLINGS ARE ALL IT CONTAINS

When YOU authored the fixes the corpus is perfectly-labelled and systematically BIASED: it certifies a predicate blind to every legitimate synonym you never wrote, and it passes N/N doing so. Nine just-fixed entries all spelled a tracker home `→ Tracked under `, validating 9/9 clean, while three OTHERS had said `Tracker-home:` since they were written, were invisible, and were reported to the owner as HOMELESS. **The just-fixed set validates RECOGNITION and never COVERAGE** — grep the obligation's CONCEPT (the noun: "home", "tracker") across the whole corpus and read what the non-matching members say. **Tell: your predicate is one literal, and every positive you have seen for it was typed by you.**

### WHEN ONE SWEEP FIXED TWO DEFECT SHAPES, THE SENTINEL OWES ONE PREDICATE PER SHAPE

The pre-fix-form rule's prescription is literally *"⇒ widen"*, and its worked example is one spelling of one obligation. Counter-case: a just-fixed site had **all five required parts present** and still leaked, because `new AbortController()` sat *after* the first `await`. **Presence and ORDERING are different axes; no spelling-widening on an "are the parts there?" predicate reaches an "are they in the right order?" defect.** Tell that the second predicate is load-bearing: that site flags on the ORDERING check while passing all five presence checks.

### THE JUST-*CLEANED* CORPUS IS A FREE NEGATIVE SET — EVERY HIT IN IT IS A FALSE POSITIVE

After the sweep the bundle contains, by definition, zero true instances, so any hit your candidate returns there is an FP you can count before writing a line of guard code. **Measured: a Turkish register guard designed as a SUFFIX rule scored 1,569 false positives across 476 distinct ordinary words (`için`, `gün`, `sorun`, `uzun`) and was killed on the spot; a politeness-suffix variant scored 0 true positives and 4 false.** The positive half says the predicate RECOGNISES a member and nothing says what else it grabs — and the FP rate is what decides warn-vs-block, curated-list-vs-rule, ship-vs-drop. **Run the candidate over the swept corpus and READ THE HITS, never the count** (`grep -n`, not `grep -c`): the count gives the rate, the hits give the CLASS. A zero is the answer only if the sweep really did clean the corpus.

### A POSITIVE CONTROL MUST TRAVEL THE PIPELINE, NOT THE PREDICATE

An inline `expect(RX.test("<literal/>")).toBe(true)` proves the regex matches a string and leaves walk / extension-filter / read / exemption unproven, so a directory-filtering refactor leaves `offenders=[]` green with the control still green. Plant the needle as a REAL artifact inside the scanned corpus and assert through the same exported scan function the real run uses. Sibling of the rule on deriving the file set — that governs which files you enumerate, this whether the predicate recognises a member. **One control PER PREDICATE:** a sentinel that ORs N predicates, or runs N absence arms, needs a known member for EACH, or one can match nothing and stay green while the rest carry every floor — blinding 37 files found 4 (2026-09-23). Prefer a registered member to a plant, read comment-stripped even where the sweep reads raw.

### DERIVE FIXTURE SEEDS FROM THE SSOT CONSTANT THEY BRACKET

A fixture pair asserting "over the override, under the default" went arithmetically impossible when the default moved 50→15 — and kept passing forever, because the arm never asserts the contrast its name claims. Compute seeds FROM the constant, never as literals; when an SSOT constant moves, grep fixtures for values bracketing the OLD value.

### DERIVE FIXTURES FROM THE OBLIGATION, NEVER FROM THE GUARD'S PATTERN

A guard keyed on a NAME SHAPE (`MEMORY\.md$`, `*-ARCHIVE-*`, a path glob) attracts fixtures named to match, making the arm a tautology: it exercises only the shapes already covered, passes identically before and after the guard's coverage changes, and can never fail for the reason the guard exists. **The fixture set must contain at least one member the guard's PATTERN does not match but the OBLIGATION does** — derive from the obligation ("which files are oversize and get read whole?"). Measured: `dup-durable-append-warn.sh` anchored `MEMORY\.md$` after every lesson body had moved to `MEMORY-ARCHIVE-*.md` shards, silent on **100% of the live append path**, while `smoke-test-hooks.sh` read **568 PASS before the fix and 568 after** because its fixture is named `*-MEMORY.md` and matches the broken regex and the fixed one alike; `warn-large-tracker-read.sh` ARM B keyed `MEMORY*.md` while `CHANGELOG-ARCHIVE-*.md` at **199,661 B — larger than any MEMORY shard** — fell through the `*)` exit ungated. Rationale in-file at the sibling arms in `scripts/smoke-test-hooks.sh`.

### AN UNCHANGED PASS COUNT AFTER A COVERAGE CHANGE IS A FINDING, NOT A RELIEF

If widening a guard's coverage leaves the suite's PASS count where it was, the suite had no arm on the new shape and the fix is unasserted.

### STATE THE EXPECTED POST-CHANGE COUNT BEFORE YOU RUN THE CHANGE

The complementary tell is worse because it FEELS like success: a count that MOVES reads as confirmation, so nobody checks the magnitude. Measured while globbing an ignore list — untracked went **16 → 12 where the obligation required 16 → 9**, and the four-file gap was a second `-partial-` spelling the predicate could not see. **A delta in the right direction is not evidence of the right delta.**

### DERIVE A FIXTURE'S EVENT FROM THE CHANNEL THE OBLIGATION'S WRITES TRAVEL, NOT THE GUARD'S WIRING

The third axis is the event channel, not the filename: a guard wired to a tool MATCHER the sanctioned write path never emits has its fixture certifying it against an event that cannot occur — correct pattern, wrong door. **When a guard's own error text prescribes a workaround, that workaround IS the live path and every arm must cover it** (`block-subagent-memory-write` denies `Edit|Write` on `.claude/skills/*/MEMORY*.md` and prescribes a Bash `>>` append, while `check-memory-size` was wired `PostToolUse` on `Edit|Write` only). ✅ **That INSTANCE is CLOSED; the CLASS stands** — annotated because reading it as live cost a reader exactly that, and because the remedy reproduced the defect: the certifying smoke arm sent `"tool_name":"Edit"`, the one channel the live path never generates.

### BUILD A RED FIXTURE FROM `git show <fix-sha>^:<file>`, NOT FROM THE FIX'S DESCRIPTION OF THE DEFECT

Measured on `dead_cited_paths` (`scripts/defer-trigger-scan.py`): the RED control was keyed to a string that entered *in the fix commit*, inside the annotation "filed as X, which does not exist", while the real pre-fix citation was a BARE BASENAME the extractor discards at `if "/" not in tok` — so the detector returns `[]` on its own motivating instance while the arm goes GREEN on the reconstruction. **The free labelled corpus is `git log -G` over the file's history.** Second-order, and why the class self-perpetuates: annotating a dead path adds "does not exist" to the line, and that phrase is IN the suppression list, so every REPAIRED instance goes invisible and yield is bounded by the instances nobody has noticed yet.

### A FINDING'S REMEDY IS A HYPOTHESIS EVEN WHEN THE FINDING IS AIRTIGHT

Two remedies sent with that finding were measured and DECLINED: "require the rescue to be UNIQUE" cannot flag the demonstrated case (hit count measures AMBIGUITY, not DEADNESS — one class demonstrated, a different one prescribed for), and "drop the extension requirement" took flags **5 → 13, all false**. **On a warn-only advisory tool the asymmetry inverts the usual instinct** — a false negative is free because a human still reads the row, while a false positive is paid on every scan.

### COUNT IN OCCURRENCES, NOT INSTANCES, AND HAND A PEER THE UNIT

Two misses from ONE causal thread are occurrence 1 (`session-cadence.md` co-thread clustering). The derive-fixtures-from-the-obligation class stands at **2 occurrences / 4 instances across 2 independent threads — AT the default warn-hook bar, not past it**; an earlier revision read "at 4 … past the bar", conflating instances with occurrences in the INFLATING direction, which is exactly how a warn-hook ships against a pattern that never recurred.

### STATE THE QUESTION EACH CALL SITE ANSWERS BEFORE UNIFYING SAME-SHAPED CODE

Two sites ran the same category function over DIFFERENT windows — server `cat(V-1)` over {V-1..V-5} vs client `cat(V)` over {V..V-4}, deterministically never-equal — and a dedup keyed on the shared algorithm would have "fixed" one to match the other, breaking the correct one. Same answer ⇒ unify; different (window, denominator, era, direction) ⇒ add an explicit DO-NOT-UNIFY comment naming the difference, or the next sweep re-derives the merge. The OVER-inclusion inverse of the file-set derivation rule and the pre-fix-form rule, which both govern under-enumeration.

### ASSERT THE RESOLVED CLASS, NOT THE PROP NAME, FOR A `variant` / `size` PROP ON A REAL cva COMPONENT

In a file that does NOT stub the button component, `variant="secondary"` reaches the DOM only as `bg-secondary text-secondary-foreground …` (the component's cva table) and `data-variant` reads **null** — so a `toHaveAttribute("data-variant")` assertion never matches, and a coverage grep for `secondary`/`default` returns **zero hits on a file with complete coverage**. **The search term for "is this variant asserted?" is the CLASS.** Assert `className` contains the variant's own bg token and `.not.toContain` the sibling's (`bg-secondary` ⇔ `secondary`, `bg-primary` ⇔ `default`); check `className=` for a hardcoded `bg-*` at the call site before trusting the class as a variant proxy. Stronger than a stub either way — it breaks if the cva mapping changes.
