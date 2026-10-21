---
paths: ["src/**", "scripts/**", "tests/**", "tsconfig.json", "*.config.ts", "*.config.mjs"]
---

# TypeScript Rules

⛔ **PATH-SCOPED — NOT always-loaded (scoped after a matching-read probe).** Loads on reading a file matching the `paths:` globs above; absent on a fresh session until then, and a compaction does NOT re-inject it — `CLAUDE.md`'s router table is the only always-loaded carrier. **About to write TypeScript or an .mjs script with no matching file read? READ THIS FILE FIRST.**

Past the conventions, each section name is a way `tsc --noEmit` returns GREEN over nothing — except § A COMMENT THAT TURNS tsc RED OVER EVERYTHING, the one way a comment turns it RED over everything, kept apart so the silent-failure catalog stays one.

Incident records (shas, per-file measurement narration, provenance) live in
a separate archive file — not always-loaded, **not doctrine**; where it
disagrees with this file, this file wins. `docs` sorts before `rules`, so when a grep lands you
there check here for the same heading first; sweep live doctrine with
`rg --hidden --glob '!.claude/docs/rules-ARCHIVE/**'`.

**Appending here.** A new trap is ONE `###` rule in the matching section — DIRECTIVE + TELL +
DISCRIMINATING NUMBER + ARCHIVE ANCHOR — in **one to three sentences, 150-400 bytes**; its incident
record goes to the archive. **A correction REPLACES the rule's sentence; it never appends a
paragraph beneath it.** If a case fits no section, add a section — a new section at end-of-file is
the last resort, not the default.

## CONVENTIONS

- Strict mode. No `any`, and no `// @ts-ignore`, without a comment saying why.
- `interface` for object shapes, `type` for unions/intersections.
- `z.infer<typeof schema>` for anything derived from a Zod schema — never a hand-duplicated twin.
- `const` over `let`; never `var`. Optional chaining `?.` and `??` over manual null checks.
- No unused imports or variables. Async functions handle their errors — no unhandled rejections.
- No `console.log` in production code, except structured logging in server actions.

## A COMPILE-TIME GUARD THAT CANNOT FIRE

### PUT EVERY TYPE-LEVEL SENTINEL IN `src/`, NEVER `tests/` — tsconfig EXCLUDES `tests/`

A `satisfies` / `@ts-expect-error` / type-level invariant guard ("field X never enters the
verdict-input set", "every enum member has a handler") under `tests/` is never type-checked
(`"exclude": ["node_modules", "tests"]`), so it advertises protection the invariant lacks — worse
than none, because the next reader stops looking for a runtime clamp. **Prove it fires: break the
invariant, run `npx tsc --noEmit`, confirm RED.**
**And the RECEIPT direction: "tsc clean" attached to a diff whose changed files are all under `tests/` is a
VACUOUS control — it typechecked ZERO of them** (measured on a 31-file test-only commit; the
suites are the only typecheck that tier has). Name the suite run as the receipt, never tsc.

### BRAND A USER-DECLARED AND A MODEL-EMITTED VALUE THAT SHARE A VOCABULARY

Keep them as DISTINCT types (`DeclaredGenre` vs `PhotoGenre`) with a compiled-path sentinel
asserting the declared channel never enters the model-verdict input set; an unbranded shared
`string` lets one launder into the other with ZERO tsc signal. A sentinel written as an
`@ts-expect-error` is doubly inert under `tests/`: unchecked, and unable to RED even if checked.

### WRITE `import type` FOR THE FUTURE `verbatimModuleSyntax`, NOT FOR A COST WIN

⛔ MEASURED REFUTATION of the usual advice. Under THIS toolchain (`isolatedModules: true`, **no**
`verbatimModuleSyntax`) esbuild drops an import whose bindings are all type-only after erasure, so a
plain `import { x }` used only in `typeof` position does NOT drag its module into the bundle — two
instruments agree (vitest `import`-phase timing **7 ms both spellings**; an esbuild bundle eliding
the dependency's side-effect marker either way). Still write `import type`: it guards a routine
`verbatimModuleSyntax: true` flip — a different reason from the one usually given.

### MUTATE A MODULE-GRAPH SENTINEL WITH A RUNTIME USE, NEVER BY DROPPING THE `type` KEYWORD

Dropping `type` REDs the static import-shape clause — **1 failed / 2 passed**, which reads exactly
like a working guard — while the RUNTIME clause never fires, because the edge is elided either way.
The discriminating mutation is a genuine runtime use (`typeof upgradeAction === "function"`):
**784 ms and RED**. Kin the substitution-vs-deletion asymmetry in `.claude/rules/tests-unit.md` —
the weak arm proves an assertion exists, the strong arm proves it discriminates.

### DETECT A MODULE EDGE AT RUNTIME — NEVER WITH A MODEL OF THE BUNDLER

An esbuild-metafile walker built for this resolved the `@/` alias INCONSISTENTLY across two runs of
one config and contradicted the pipeline it modelled — a plausible instrument with a working
positive control, and wrong. Use a `vi.mock` factory flag: it runs lazily at genuine load, so a
factory that never ran proves the edge was never emitted. Pair it with a positive control proving
the flag CAN flip. ⛔ **AND A THIRD,
STATIC SPELLING CLAUSE — the runtime detector is BLIND to a TYPE-ONLY import** (elided either way, §
above), which is this repo's house injection pattern. A complete sentinel ships it and calls it NOT
redundant; one sentinel that shipped 1+2 alone was caught in review.

## A RUNTIME GATE THAT ADMITS THE VALUE IT NAMES

### GUARD THE UNDECIDED STATE FIRST — `=== false` / `=== true` PASSES NULL

A `=== false` / `=== true` gate on a NULLABLE field silently PASSES the NULL / not-yet-decided
state. Frame it positively — reject unless POSITIVELY-decided-safe — THEN compare the boolean.
Binds anything nullable during an in-flight window: a moderation flag, an entitlement bool, a
verification flag. tsc and unit are BLIND (three-valued logic, not a type error). For instance, a
`=== false` gate on a safety flag would let a record still being processed through; the fix is a
not-yet-complete reject placed first.

### READ AN OBJECT-LITERAL / `Record` MAP WITH `safeLookup` OR A `Map` — A BARE INDEX PASSES PROTOTYPE KEYS

`if (!MAP[key]) return` / `MAP[key] && …` is passed by `"constructor"` / `"toString"` / `"valueOf"`,
which resolve to truthy NATIVE FUNCTIONS — an off-registry `"constructor"` would have shipped
`function Object() { [native code] }` into user-facing output. ⛔ **THE REMEDY IS `safeLookup(MAP, key)`
(an own-property lookup helper) OR A `Map` — NOT A PER-SITE `Object.hasOwn` TERNARY** (retired
after recurrence: it had been copied to many sites, names the map twice so a rename can
gate one and read another, and CANNOT reach the WRITE face, where `obj["__proto__"] = v` invokes
the inherited setter). Array-`.includes` clamps are sound. **The discriminating fixture is a PROTOTYPE KEY,
never a junk string** — every "bogus"-style fixture passes a bare index too, which is why the suite
stays green.

### SWEEP THE SAME-WAVE SIBLINGS THE MOMENT YOU FIX ONE PROTOTYPE-KEY INDEX

One map was gated; a sibling map, added in the same
wave by the same author, sat un-swept for hours until a re-check caught it.

⛔ **A `RuleTester` FILE PROVES THIS RULE'S *LOGIC*; ONLY A CONFIG-RESOLUTION TEST PROVES IT IS *WIRED*, AND NO OTHER SUITE ARM CAN TELL THE DIFFERENCE.** The rule fires because `eslint.config.mjs` puts it on a glob at severity 2 — drop `tsx` from one glob, or let a later flat-config entry override `rules` for `src/app/api/**`, and every suite stays green while the plane goes dark. The arm is `new ESLint({cwd}).calculateConfigForFile(<path>)` asserting severity per glob, the expected absence off-plane, and `reportUnusedDisableDirectives`. Generalises past ESLint: for anything whose enforcement scope is decided by a RESOLVED config, presence and firing are separate questions with separate instruments (the wired-but-inert class, one plane down). Why this paragraph was missing while the fix shipped: archive.

⛔ **`npm run lint` IS THE SWEEP FOR THE MAPS A FILE DECLARES ITSELF, AND ONLY THOSE.**
`local/no-bare-object-key-lookup` is an ERROR on `src/**/*.{ts,tsx}`, so an un-swept sibling fails CI's
blocking lint job AND the deploying push itself — `scripts/pre-deploy-check.sh` (not in this copy) lints the CHANGED files and
refuses on an eslint error (`scripts/lib/predeploy-lint-verdict.sh`; the pre-push ratchet counts warnings
only and is not reached on a deploying push). Read the blind spots in the rule's own header — the map and key
shapes it cannot resolve are invisible to it (the function-scope map is CLOSED since
2026-09-06: the rule resolves the indexed identifier through the scope manager, so a map declared in a
function, a block or an arrow is seen and a same-named narrower local shadows an outer map; the `in` OPERATOR
is CLOSED since 2026-09-07 — a `BinaryExpression` visitor, ~12 lines, no type information, because the right
operand is an identifier the same resolver already reaches. It exempts a LITERAL key exactly as the read
visitor does: without that it put one error into the blocking gate on a vendor-shape probe) —
and **treat a new `Record` lookup as guilty until it uses `safeLookup` or a `Map`**. ⛔ **A CLEAN `npx eslint` IS
EVIDENCE ABOUT THE RULE, NOT ABOUT THE CLASS:** the populations the rule cannot see need a
GREP keyed on their shape (a heuristic, so hand-read the hits: a sample mixes real sites with
comments). ⛔ **THE `in`-GATE GREP THAT STOOD HERE —
`rg -n '\bin [A-Z_]{3,}\b' src/` — IS STRUCK 2026-09-07 AND ITS DEFECT IS THE REUSABLE PART: it matched
ALLCAPS map names only, so it was blind to every lower-case map** (`"cached_tokens" in promptDetails` is the
live shape it missed), **and its hits were dominated by ENGLISH PROSE — re-measured, the large majority
opened with a comment marker; real gates are a handful.** ⚠️ *Its first count stood for one day,
about twenty times low, and low in the direction that UNDERSTATED its own case, which is why nobody challenged it
(archive).* The rule now answers this population for maps a file
declares; what still needs a hand-read is an `in` gate on a map the rule cannot resolve, which no grep keyed on the map
NAME can separate from prose — key on the file that uses it instead. A residue table derived by
the rule's own predicate enumerates only what the rule can already see — CLOSED for that predicate,
never for the class. ⛔ **A SIZE READ OFF A CENSUS GREP IS A FLOOR UNTIL THE DETECTOR HAS RUN** — the grep
that sized the scope fix read a fraction of the fires the first lint run reported
(a large share of those were the rule's own false positives from a text regex matching the inner `Record<string,` of a nested
type — the predicate is now structural, the type node). A real fire takes one of three dispositions: a read →
`safeLookup`; an accumulator keyed by external strings → `Map` / `Object.fromEntries` (own properties, so no
inherited setter); a key drawn from our own constant lists → a suppression with its reason on the line. **A
detector keyed on an ACCIDENTAL property (where a `const` sits) rather than the ESSENTIAL one (what the key's
type admits) decays under the most ordinary refactor** — co-locating a label map inside its only consumer
silently removes a site from a blocking gate.

### A REQUIRED TWO-VALUE ENUM DELETES THE "UNKNOWN" STATE A FAIL-OPEN BRANCH DEPENDS ON

Inverse-sibling of the undecided-state rule above: a nullable silently PASSES the undecided state, while REQUIRING the enum
makes "undecided" inexpressible — an ambiguous input forces a value, the downstream branch goes
unreachable-live, and a false pick re-opens the failure the field exists to fence. **`.nullable()`
is NOT the reflex fix** — an "unknown" arm re-opens fail-open and buys a branch nobody can calibrate
at small n. State the forced-choice failure mode AT the consuming fence, bound it with the n you
have, put it on the canary watch. ⚠️ **Point at a token to grep,
never a line** — a line pointer that stood here rotted to a docstring in 5 days, then the fence it named was
dissolved.

### CFA NARROWING FROM A MODULE-LEVEL GATE REACHES POST-GATE CLOSURES — NEVER A HOISTED `function`

A top-level `if (X === null) process.exit(1)` narrows `X` inside arrows created AFTER the gate, but
a hoisted `function` below it still sees `X: string | null` — TS18047 at its call sites while
widening the gate changes nothing. Gate on `X_RAW`, then `const X = X_RAW` after it. 3-arm probe,
control armed (archive).

## A SWEEP tsc CANNOT COMPLETE

### A PLAIN-NODE CONSUMER DIES ON ITS FILE'S FIRST `@/` IMPORT — AND EVERY NORMAL GATE IS GREEN THROUGH IT

vitest resolves the `@/` alias and plain `node` does not, so adding a first-ever import to a file a
runner loads under plain node (eval/cert runners load a shared types file) kills that runner with
`ERR_MODULE_NOT_FOUND` while tsc, the full unit suite AND the build stay green — even a hardening
test that IMPORTS the runner is green, because it imports under vitest (61/61 while both runners
were dead). **Node is the only oracle: guard with `execFileSync("node", [runner, "--help"])` rc=0**.
And a no-alias constraint written in ONE file's header
binds every file its consumers load — a file with zero imports is load-bearingly zero-import
(the constraint was read, quoted, and applied to the wrong file).

### A GREEN `tsc` AFTER REMOVING A SCHEMA FIELD PROVES ONLY THE *TYPED* READERS WERE SWEPT

Two reader channels fail SILENTLY AND FOREVER: a cast-laundered read
(`(c as unknown as {…}).field ?? null` → `null` in every row) and an untyped `.mjs` (→ `undefined`).
Measured on the removal of a model-output score field — three readers, tsc could see ONE.
**Blind surface, 2026-08-16: 5 `as unknown as` casts in `scripts/*.ts` · 99 `.mjs` under `scripts/`,
125 tracked repo-wide, none in tsconfig's `include`** (73/98 at the fix sha — re-derive with
`git ls-files '*.mjs' | wc -l`, never restate). Not just `scripts/`:
an `.mjs` module under `src/` imported by a typed pipeline file is in the same position, and a
hand-written `.d.mts` beside it makes it worse — tsc checks the DECLARATION, never the body.

### THE CARRIER MOVES, THE PROSE STAYS — NOTHING TYPECHECKS A COMMENT

Rename or re-scope a symbol and `tsc` follows every typed reader; the JSDoc, the `reason:` string and the fixture `note:` stay put, describing something gone. **TELL: your diff renames a thing and touches no comment.** N=3 in one day. Grep the OLD name over comments and literals in the SAME change. Archive.

### CLASSIFY EACH SWEEP HIT BY THE VALUE'S *SOURCE* — A BARE GREP BOTH UNDER- AND OVER-REPORTS

After removing a shared field, `rg` the name across `scripts/` + `src/` and triage every hit by
where the value COMES FROM — schema-emitted (must change) vs DB column vs locally computed (must
not). Four hits on that removed score field's name read a still-live server-computed database column
of the same name and were rightly left alone. Explicitly open the `.mjs` and cast-bearing sites, which `tsc` cannot report at all. Kin
"A CAST IS NOT A CLAMP" in `.claude/rules/i18n.md` (not in this copy): that governs a cast ADMITTING a bad
value, this one a cast HIDING a missing one.

### `tsc` NEVER OPENS `tests/` — A GREEN TYPECHECK OVER A TESTS-ONLY DIFF IS VACUOUS

`tsconfig.json` excludes `"tests"`, so the compiler never reaches the file you changed — verified
by whole-program enumeration: **5,342 files, ZERO under `tests/`**. ⚠️ `exclude` only
filters what `include` FINDS, so a test file reached by an IMPORT from an included file WOULD be
compiled: 0 today, one `scripts/*.mts` import from false. **TELL: you are citing `npx tsc --noEmit`
on a diff whose paths are all under `tests/`.** ⛔ **AND NOTHING ELSE TYPECHECKS THEM EITHER — not
vitest (esbuild transpiles, never typechecks), not eslint (no `project`/`projectService` key), not
knip**: a tests-including probe config reads **1,084 errors across 241 files** against the normal
run's 0. Run the tier-appropriate suite for BEHAVIOUR; no type claim survives it. Archive.

## A COMMENT THAT TURNS tsc RED OVER EVERYTHING

Every other section here is a way `tsc` stays quiet; this one is the inverse — the way a comment-only edit
turns the whole project's `tsc` RED at once. Filed apart so a reader scanning for silent-green traps is
not routed here, and the one about to paste a schedule into a docblock is.

### NEVER PUT A CRON SCHEDULE OR A GLOB IN *ANY* COMMENT — IN A BLOCK COMMENT IT CLOSES ONE, IN A LINE COMMENT IT OPENS ONE

`/** runs at \`0 */6 * * *\` */` ends the comment at the `*/` inside the schedule; `**/*` globs do the same. **TELL: a syntax error on a line you did not touch, right after the comment you did.** ⚠️ **That tell is POST-HOC — the PRECONDITION is the one you can act on: it is reachable only when a COMMENT-ONLY change ships WITHOUT `tsc`, which is exactly the change on which skipping `tsc` feels safe.** (Restored 2026-09-07: a band-compression fold dropped *"shipped without running tsc"* from the JSDoc-cadence instance listed next, leaving the rule diagnostic instead of preventive.) N=3 in 4.5 months, causally independent (a glob in `eslint.config.mjs`; a `(*/5)` cadence in a JSDoc in a pipeline file that turned whole-project `tsc` and the next build RED from a comment-only change; a cron route's `*/6` that a build agent reported and then left half-fixed on the shared tree after a 429). Base rate: 3 of 8,117 JSDoc openers. No detector is possible **FOR THE tsc-VISIBLE (block-comment) VARIANT** — a live instance there is an unparseable file, so nothing can run over it and the population can never be surveyed — which leaves this count as the only instrument for it, and is why it has to be right. ⛔ **THAT CLAIM WAS UNSCOPED UNTIL 2026-09-14 AND IS FALSE OF THE LINE-COMMENT VARIANT, WHICH IS PERFECTLY PARSEABLE: two detectors ran on the live instance in one turn** — an unmatched-`/*`-opener walk (`1`, naming `:4200`) and a view-size delta (`raw 575,993 → stripped 216,726`). An unscoped *no detector is possible* is the sentence that stops the next reader writing the detector that would have worked. ⛔ **AND THE MIRROR DIRECTION IS THE ONE THIS RULE USED TO PRESCRIBE AS THE FIX: A GLOB IN A `//` LINE COMMENT *OPENS* A BLOCK COMMENT FOR EVERY NAIVE STRIPPER DOWNSTREAM, AND tsc STAYS GREEN THROUGHOUT (2026-09-14).** `scripts/**` contains `/*`; a consumer that strips BLOCK comments before LINE comments — one live test did — has the `//` prefix stripped of protective value, and the non-greedy `/\/\*[\s\S]*?\*\//g` runs to the next `*/` anywhere in the file. Measured on a large eval runner script: **1 unmatched `/*` opener at `:4200`, 359,267 of 575,993 B eaten (62.4%)**, the guard at `:4266` inside the eaten span, the sentinel reporting it MISSING, and `npx tsc --noEmit` **0 errors**. **TELL: a source-grep sentinel reports a string absent that you can see in the file.** **Write the schedule and the glob in WORDS (`every six hours`, `the scripts tier`) in EITHER comment style — the `//` escape this rule used to prescribe is not one.** ⛔ **AND ON THE CONSUMER SIDE THE HOUSE ANSWER ALREADY EXISTS AND OUTRANKS THE OBVIOUS FIX: USE THE HOUSE CODE-ONLY HELPER, NEVER A HAND-ROLLED TWO-REGEX STRIP, AND NEVER THE TEMPTING *run the LINE pass before the BLOCK pass* — that ordering still mis-handles a `/*` inside a STRING literal.** The helper is single-pass and context-aware (line comment / block comment / string / template / regex literal), biases toward UNDER-stripping, and is offset-preserving. Its own docblock measures the same class on the database schema file: a naive strip destroys several table declarations there. ⛔ **NO BYTE FIGURE BELONGS IN THIS SENTENCE — three strippers re-derived that one file's naive-stripped size as 43,550 / 45,996 / 116,974 B on 2026-09-20, so it is UNDEFINED without naming the stripper, and the raw size and `src/` file count this sentence used to carry (170,104 B, 952) had both rotted to 185,570 B and 1,012 because the schema file is under active development. Which declarations a naive strip destroys is the durable evidence; the figures live in the docblock.** ⛔ **AND NAME THE BRANCH — THIS RULE NAMED NEITHER FUNCTION UNTIL 2026-09-20: `codeOnly` KEEPS STRING CONTENTS BY DESIGN, so a presence pin asserting a token that could plausibly appear inside a string literal calls `codeOnlyNoStrings` instead and says why. The helper's own docblock prescribes exactly that, and *use the house helper* without the branch hands that reader the one function documented as wrong for their case.** ⚠️ **This is a meta lesson's ground, reached from the tsc side** — that lesson measures the same defect (naive 63.0% vs correct 55.8%, so 7.2 points / 42,227 B destroyed, costing 7 occurrences) and names the same remedy. What is NEW here is only the AUTHORING direction: nothing in this file told you a glob in a `//` comment was unsafe, and this rule's retired prescription actively recommended it. Dated instances: archive.
