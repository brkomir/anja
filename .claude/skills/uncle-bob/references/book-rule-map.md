# Book → Rule Map (Robert C. Martin corpus → uncle-bob rubric)

Forward calibration audit: enumerate the code-design lessons from the Robert C. Martin corpus and map each to how the source project's `uncle-bob` skill currently handles it. This is NOT a rule-expansion exercise — most rows resolve to "we deliberately don't fire on this here," and documenting *why* (the EXCLUDED guard) is the primary value. The skill is theory-complete for our scale; the improvement vector is calibration to this codebase, not theory ingestion. Consult this file during corpus-design passes to check whether a candidate finding sits inside an existing rule, behind a deliberate guard, or in the GAP queue.

**v0.3 addendum (2026-06-08):** a [Kent Beck corpus](#kent-beck-corpus-v03-addendum-2026-06-08) section now extends the map past the Martin corpus. The net-new source is *Tidy First?* (2023); most XP / TDD / simple-design material was already reachable via Martin's re-presentation and is cross-linked there.

## How to read this

Every row gets exactly one verdict:

- **ENCODED** — an existing rule/clause already covers it. Cites the exact rule (e.g. `§SOLID — S`, `God Class smell`, `§Naming rules`, `Clause 1`).
- **EXCLUDED** — we deliberately do NOT fire. **MUST cite a guard:** an anti-scope Clause number, a critic source (Abramov / Metz / Ousterhout / Muratori), an `L#`, another owner (`rules/typescript.md` / qa-expert / frontend-developer / saas-architect), or "framework convention." A row with no citable guard is a GAP, not an EXCLUDED.
- **GAP** — uncovered AND not deliberately excluded. Assigned `P1/P2/P3` + a one-line "validate by" note. **A GAP is a validation candidate held for audit-history confirmation — NOT an active rule and NOT a recommendation to add now.** GAP rows graduate to firing rules only after audit-history validation.

Refinements:
- **PARTIAL** — half-encoded; the row says which half is missing.
- **N/A-Java** — Java-specific heuristic with no TS analog.
- **OUT-OF-SCOPE** — not code-design (conduct / process / professionalism).

## Clean Code Ch.17 — Smells & Heuristics (complete)

### Comments (C1–C5)

| code/name | verdict | citation or priority+validate-note |
|---|---|---|
| C1 — Inappropriate Information (history/metadata in comments) | ENCODED | §Comments (comments explain WHY, not changelog/metadata) |
| C2 — Obsolete Comment | ENCODED | §Comments (most "comments" are smells; rename and delete) |
| C3 — Redundant Comment (restates the code) | ENCODED | §Comments ("WHAT code already explains" is the redundant class) |
| C4 — Poorly Written Comment | ENCODED | §Comments + Boy Scout Rule (fix-in-passing) |
| C5 — Commented-Out Code | EXCLUDED | Boy Scout Rule (delete in passing) + lint; too micro-grain for module-audit firing |

### Environment (E1–E2)

| code/name | verdict | citation or priority+validate-note |
|---|---|---|
| E1 — Build Requires More Than One Step | OUT-OF-SCOPE | build/process, not code-design → saas-engineer (build is `npm run build` single-step by framework convention) |
| E2 — Tests Require More Than One Step | EXCLUDED | owned by qa-expert (`npm run test:integration` auto-Docker is the single-step contract) |

### Functions (F1–F4)

| code/name | verdict | citation or priority+validate-note |
|---|---|---|
| F1 — Too Many Arguments | GAP P3 | ISP is adjacent (field-usage narrowing) but arg-COUNT is not a firing heuristic. Validate by: scan audit history for any finding that would have benefited from an arg-count trigger (expect ~none — TS object-params make this rare). |
| F2 — Output Arguments (mutated params instead of return) | PARTIAL | §Function rules covers the "no hidden side effects / `getX()` shouldn't mutate" half; the explicit "prefer return value over output-arg mutation" half is not named. Missing half = output-argument naming. |
| F3 — Flag Arguments (boolean param splits behavior) | GAP P3 | adjacent to OCP (boolean flag often hides two behaviors) but not named. Validate by: check whether any decomposition finding cited a flag-arg split. |
| F4 — Dead Function (never called) | EXCLUDED | mechanical sentinel (knip) + zombie-vs-placeholder grep protocol owns "unused" classification |

### General (G1–G36)

| code/name | verdict | citation or priority+validate-note |
|---|---|---|
| G1 — Multiple Languages in One Source File | EXCLUDED | owned by frontend-developer (JSX/CSS-in-TS is intended Next.js pattern, not a smell) |
| G2 — Obvious Behavior Is Unimplemented | OUT-OF-SCOPE | correctness/spec-completeness, not design → qa-expert + spec review |
| G3 — Incorrect Behavior at the Boundaries | OUT-OF-SCOPE | edge-case correctness → qa-expert |
| G4 — Overridden Safeties (disabled checks/warnings) | EXCLUDED | `@ts-ignore`/lint-disable owned by `rules/typescript.md` |
| G5 — Duplication | EXCLUDED | Clause 1 — Rule of Three (Abramov "Goodbye Clean Code" / Metz "cost of wrong abstraction"). This is the DRY row. |
| G6 — Code at Wrong Level of Abstraction | ENCODED | §Function rules (descending levels of abstraction; don't mix orchestration with string manipulation) |
| G7 — Base Classes Depending on Their Derivatives | ENCODED | §SOLID — D (Dependency Inversion) + Clean Architecture Dependency Rule (dependencies point inward) |
| G8 — Too Much Information (bloated interface) | ENCODED | §SOLID — I (Interface Segregation) + Clause 3 deep-modules (narrow interface, complex impl) |
| G9 — Dead Code | EXCLUDED | mechanical sentinel (knip) + zombie-vs-placeholder protocol |
| G10 — Vertical Separation (vars/funcs declared far from use) | GAP P3 | locality-of-declaration not a firing heuristic. Validate by: rarely actionable at module-audit grain; expect demotion. |
| G11 — Inconsistency (do similar things the same way) | PARTIAL | Shotgun Surgery + Divergent Change catch the change-ripple symptom; the "naming/structure consistency" half is informal §Naming-adjacent, not named. Missing half = stylistic-consistency heuristic. |
| G12 — Clutter (empty constructors, unused vars) | EXCLUDED | mechanical sentinel (knip / `rules/typescript.md` no-unused) |
| G13 — Artificial Coupling (things that don't belong, bound together) | ENCODED | §SOLID — S (SRP) + Divergent Change smell + Clause 3 (coupling-vs-split tension) |
| G14 — Feature Envy | ENCODED | Feature Envy smell (3+ consecutive `other.field` accesses → move method) |
| G15 — Selector Arguments (≈ flag args, magic selectors) | GAP P3 | same class as F3; not named. Validate by: fold into the F3 validation pass. |
| G16 — Obscured Intent (dense/unreadable expressions) | ENCODED | §Naming rules (intention-revealing) + §Function rules (do one thing) |
| G17 — Misplaced Responsibility (code lives in wrong module) | ENCODED | §SOLID — S (SRP) + Feature Envy + module-boundary-placement (a named invoke trigger) |
| G18 — Inappropriate Static (static method that should be polymorphic) | EXCLUDED | Clause 1 (premature polymorphism) + Modern stance (discriminated unions over inheritance; static-vs-instance is rarely a TS finding) |
| G19 — Use Explanatory Variables | ENCODED | §Naming rules (searchability, intention-revealing) |
| G20 — Function Names Should Say What They Do | ENCODED | §Naming rules (`getActiveUserCount()` not `count()`) |
| G21 — Understand the Algorithm | OUT-OF-SCOPE | comprehension discipline, not a design heuristic |
| G22 — Make Logical Dependencies Physical | GAP P3 | "depend on the thing you assume, make it explicit" — not named. Validate by: borders Primitive Obsession (encoding assumptions in types); check overlap before promoting. |
| G23 — Prefer Polymorphism to If/Else or Switch/Case | ENCODED | §SOLID — O (Open/Closed: switch/if-cascade growth trigger) + anti-scope (3-4 variant sets DON'T need polymorphism) |
| G24 — Follow Standard Conventions | EXCLUDED | owned by `rules/typescript.md` + `rules/nextjs.md` (project conventions are codified elsewhere) |
| G25 — Replace Magic Numbers with Named Constants | ENCODED | Primitive Obsession smell + §Naming (searchability) |
| G26 — Be Precise | OUT-OF-SCOPE | correctness/edge-case discipline → qa-expert |
| G27 — Structure over Convention | PARTIAL | §SOLID — O (enforce via structure) covers the spirit; "prefer enforced structure to naming-convention reliance" not named distinctly. Missing half = convention-vs-structure heuristic. |
| G28 — Encapsulate Conditionals | ENCODED | §Function rules (extract named predicate helper; do one thing) |
| G29 — Avoid Negative Conditionals | GAP P3 | readability micro-heuristic. Validate by: too fine-grained for module-audit; expect permanent demotion. |
| G30 — Functions Should Do One Thing | ENCODED | Long Method smell + §Function rules (do one thing) |
| G31 — Hidden Temporal Couplings | EXCLUDED | **validated DEMOTE 2026-06-01** (judgment) — our load-bearing temporal couplings are NAMED + enforced, the INVERSE of G31's "hidden" precondition: transaction ordering → `rules/processing.md`; side-effect cascade ordering → its own rule; FK-delete order → `rules/migrations.md`; auth-check ordering → `rules/actions.md`; module-init order → §Acyclic Dependencies Principle (ADP). No un-owned hidden-temporal-coupling class remains. |
| G32 — Don't Be Arbitrary (structure should communicate intent) | ENCODED | §SOLID — S + God Class section-divider-density signal (author-drawn dividers reveal conceded structure) |
| G33 — Encapsulate Boundary Conditions | GAP P3 | extract boundary expressions (`+1`/`-1`) to named vars — micro-heuristic. Validate by: too fine-grained; expect demotion. |
| G34 — Functions Should Descend Only One Level of Abstraction | ENCODED | §Function rules (descending levels of abstraction within one function) |
| G35 — Keep Configurable Data at High Levels | ENCODED | §Clean Architecture Dependency Rule (config/constants at the appropriate layer, not buried in low-level modules) |
| G36 — Avoid Transitive Navigation (Law of Demeter / train-wrecks) | EXCLUDED | **validated DEMOTE 2026-06-01** — codebase scan: 142 depth≥3 method chains are 100% fluent-builder (Zod 80 / Drizzle 43 / string 2 — same-type return, NOT LoD); 129 depth≥4 property paths are TS type-namespaces, vendor-SDK navigation, or flat DTO/view-model/config reaching. Zero behavior-object train-wrecks (`order.customer.address.zip`). Architecture (fluent APIs + flat typed-data/DTOs, not deep behavior graphs) structurally neutralizes LoD. |

### Java (J1–J3)

| code/name | verdict | citation or priority+validate-note |
|---|---|---|
| J1 — Avoid Long Import Lists by Using Wildcards | N/A-Java | TS/ESLint forbids wildcard imports; no analog (named imports are mandatory by convention) |
| J2 — Don't Inherit Constants | N/A-Java | TS constants come from module imports, not interface-inheritance; no analog |
| J3 — Constants versus Enums | N/A-Java | TS analog is "string-union vs TS `enum`" — but that's owned by `rules/typescript.md` (project prefers union types / `z.infer`), not a uncle-bob heuristic |

### Names (N1–N7)

| code/name | verdict | citation or priority+validate-note |
|---|---|---|
| N1 — Choose Descriptive Names | ENCODED | §Naming rules (intention-revealing) |
| N2 — Choose Names at the Appropriate Level of Abstraction | ENCODED | §Naming rules + §Function rules (descending abstraction) |
| N3 — Use Standard Nomenclature Where Possible | ENCODED | §Naming rules + Modern stance (discriminated-union / domain vocabulary) |
| N4 — Unambiguous Names | ENCODED | §Naming rules (avoid disinformation — `userList` must be a List/Array) |
| N5 — Use Long Names for Long Scopes | ENCODED | §Naming rules (single-letter names bad except 3-line loop counters) |
| N6 — Avoid Encodings (Hungarian / type prefixes) | EXCLUDED | owned by `rules/typescript.md` (TS type system makes encodings obsolete; project convention) |
| N7 — Names Should Describe Side-Effects | ENCODED | §Function rules (`getX()` shouldn't mutate — name must reveal the side-effect if present) |

### Tests (T1–T9)

| code/name | verdict | citation or priority+validate-note |
|---|---|---|
| T1 — Insufficient Tests | EXCLUDED | owned by qa-expert (every fix needs a test) |
| T2 — Use a Coverage Tool | EXCLUDED | owned by qa-expert (coverage tooling is a test-process concern) |
| T3 — Don't Skip Trivial Tests | EXCLUDED | owned by qa-expert |
| T4 — An Ignored Test Is a Question About an Ambiguity | EXCLUDED | owned by qa-expert + fail-first `ctx.skip` pattern is the codified "ignored test as documented question" |
| T5 — Test Boundary Conditions | EXCLUDED | owned by qa-expert |
| T6 — Exhaustively Test Near Bugs | EXCLUDED | owned by qa-expert |
| T7 — Patterns of Failure Are Revealing | EXCLUDED | owned by qa-expert + phantom-missing-row ladder + dispatch qa-expert on RED |
| T8 — Test Coverage Patterns Can Be Revealing | EXCLUDED | owned by qa-expert |
| T9 — Tests Should Be Fast (FIRST) | EXCLUDED | Clause 6 (no TDD orthodoxy) + qa-expert (FIRST principles are test-design, not code-design) |

## Component Principles (Clean Architecture / PPP)

### Cohesion — REP / CCP / CRP

| code/name | verdict | citation or priority+validate-note |
|---|---|---|
| REP — Reuse/Release Equivalence Principle | GAP P2 | the granule of reuse is the granule of release — package/module versioning cohesion. Validate by: single-deploy Next.js app has no independent release units at this stage; revisit only if/when shared packages or a separately released extraction lands. |
| CCP — Common Closure Principle | ENCODED | **graduated PARTIAL → ENCODED 2026-06-01** (judgment pass, N≥2). Lands as the **decomposition-axis sub-rule** under Divergent Change: split along the CO-CHANGE axis (verified via test-naming topology + call-graph entanglement), NOT a conceptual-purity axis (read/write/layer). Evidence: one module's read/write→domain-vertical near-miss + another module's per-event split. The existing Divergent Change smell said "split" but not the AXIS — that's the gap CCP closes. |
| CRP — Common Reuse Principle | GAP P2 | classes used together belong together; don't depend on a component for a fraction of it (component-grain ISP). Validate by: borders §SOLID — I at file grain; check whether any module-boundary finding would have been sharper with a CRP framing. |

### Coupling — ADP / SDP / SAP

| code/name | verdict | citation or priority+validate-note |
|---|---|---|
| ADP — Acyclic Dependencies Principle (no dependency cycles) | ENCODED | §Acyclic Dependencies Principle — **graduated from GAP P1 → firing rule 2026-06-01**. A validation scan found 4 real cycles: 2 eager/TRUE, 2 lazy-broken (incl. 1 masking inner→outer deps). First GAP to graduate. |
| SDP — Stable Dependencies Principle (depend in direction of stability) | GAP P2 | dependencies should point toward more-stable components. Validate by: overlaps Clean Architecture Dependency Rule (inner = more stable); check whether SDP adds anything the layer-cake rule doesn't already enforce before promoting. |
| SAP — Stable Abstractions Principle (stable components should be abstract) | GAP P2 | a component's abstractness should match its stability. Validate by: largely subsumed by §SOLID — D + Clause 3; likely demotes to "covered by DIP." Confirm against audit history. |

### SOLID (5)

| code/name | verdict | citation or priority+validate-note |
|---|---|---|
| S — Single Responsibility Principle | ENCODED | §SOLID — S + Divergent Change smell + God Class (with fast-path: >10 distinct audit IDs on one file is dispositive) |
| O — Open/Closed Principle | ENCODED | §SOLID — O (switch/if-cascade growth trigger; anti-scope for 3-4 variant sets) |
| L — Liskov Substitution Principle | ENCODED | §SOLID — L (rarely fires — TS discriminated unions over inheritance per Modern stance) |
| I — Interface Segregation Principle | ENCODED | §SOLID — I (function takes large object, uses 2-3 fields → narrow the param type) |
| D — Dependency Inversion Principle | ENCODED | §SOLID — D + Clean Architecture Dependency Rule (anti-scope: single-vendor direct use is pragmatic, NOT a DIP violation) |

## Cross-book lessons (non-Ch.17)

| lesson | book | verdict | maps-to |
|---|---|---|---|
| Intention-revealing names | Clean Code (2008) | ENCODED | §Naming rules |
| Functions small / do one thing | Clean Code (2008) | ENCODED | Long Method smell + §Function rules |
| `getX()` no hidden side effects | Clean Code (2008) | ENCODED | §Function rules (+ N7) |
| DRY / duplication | Clean Code (2008) | EXCLUDED | Clause 1 — Rule of Three (Abramov / Metz) |
| Comments explain WHY not WHAT | Clean Code (2008) | ENCODED | §Comments + a carveout (hidden-constraint comments are valuable) |
| Classes small + cohesive | Clean Code (2008) | ENCODED | §SOLID — S + God Class smell |
| Wrap all third-party at boundaries | Clean Code (2008) | EXCLUDED | §SOLID — D anti-scope (single-vendor direct use is pragmatic — the database, billing and AI-model providers are used directly) |
| Command-Query Separation (CQS) | Clean Code (2008) | GAP P2 | only the "no side effects" half is encoded (§Function rules); the "commands don't return values" half is not. Validate by: check whether any finding hinged on a query that mutated. |
| Law of Demeter / train-wrecks | Clean Code (2008) | EXCLUDED | = G36 — **validated DEMOTE 2026-06-01**: chaining is 100% fluent-builder (Zod/Drizzle); deep property access is type-namespace / SDK-nav / flat-DTO reaching; no behavior-object reaching. See G36 row. |
| Too many arguments (F1) | Clean Code (2008) | GAP P3 | ISP adjacent (field-usage) but not arg-count. See F1 row. |
| Error / null handling (no return-null, Result types) | Clean Code (2008) | EXCLUDED | owned by `rules/typescript.md` (error handling + nullish primitives) |
| Clean tests / FIRST / one-assert | Clean Code (2008) | EXCLUDED | qa-expert + Clause 6 (no TDD orthodoxy) |
| The Dependency Rule | Clean Architecture (2017) | ENCODED | §Clean Architecture Dependency Rule (6-layer cake) |
| SOLID recap | Clean Architecture (2017) | ENCODED | §Core Rubric SOLID |
| Maximize deferred decisions / keep options open | Clean Architecture (2017) | ENCODED-philosophy | aligns Clause 1 (don't abstract until the third instance — keep options open) |
| Screaming Architecture | Clean Architecture (2017) | EXCLUDED | framework convention — our layer cake is intentionally Next.js-framework-shaped (documented) |
| Humble Object | Clean Architecture (2017) | GAP P3 | separate hard-to-test from easy-to-test — borders qa-expert. Validate by: confirm it's not wholly inside qa-expert before any promotion. |
| 4 design smells (Rigidity / Fragility / Immobility / Viscosity) | PPP / Agile SD (2002) | GAP P3 | diagnostic vocabulary behind our named smells — not surfaced as named terms. Validate by: confirm our 7 named smells already cover the symptoms these label; expect documentation-only, not a new firing rule. |
| Package principles | PPP / Agile SD (2002) | — | duplicate of Clean Architecture component principles (see Component Principles section) |
| SOLID origin | PPP / Agile SD (2002) | ENCODED | §Core Rubric SOLID |
| TDD three laws | Clean Craftsmanship (2021) | EXCLUDED | Clause 6 — no TDD orthodoxy |
| 4 Rules of Simple Design (Beck's, via Martin) | Clean Craftsmanship (2021) / XP | ENCODED | **graduated PARTIAL → ENCODED 2026-06-08 (v0.3):** now stated as a single priority-ordered rule in §Tidy First — Beck's Change Economics (1 tests · 2 intent · 3 no-dup · 4 fewest; the ORDER is the rule — never sacrifice a higher rule for a lower). See the Kent Beck corpus section. |
| Refactoring discipline | Clean Craftsmanship (2021) | ENCODED | Boy Scout Rule |
| FP and OO complementary | Functional Design (2023) | ENCODED | Modern stance (complementary organizational tools, not opposed paradigms) |
| Discriminated unions replace inheritance | Functional Design (2023) | ENCODED | Modern stance + Refused Bequest refactor (composition / discriminated union) |
| Immutability / pure functions / referential transparency | Functional Design (2023) | GAP P3 | only the "no side effects" half is present (§Function rules); immutability primitives proper are owned/owed to `rules/typescript.md`. Validate by: confirm `rules/typescript.md` is the right owner before any uncle-bob promotion. |

## Kent Beck corpus (v0.3 addendum, 2026-06-08)

The skill is built on Martin's corpus; this section maps **Kent Beck's** distinct material. Most of what's *associated* with Beck (TDD, simple design, "keep options open") was already reachable via Martin's re-presentation and is cross-linked below. The genuinely net-new source is **_Tidy First?_ (O'Reilly, 2023)**. Sources web-verified 2026-06-08 (published *Tidy First?* summaries; a published write-up of Beck's design rules).

| lesson | book | verdict | maps-to |
|---|---|---|---|
| Structural vs. behavioral change — the hard split (never mix in one commit) | Tidy First? (2023) | ENCODED | **net-new v0.3** → §Tidy First (structural-vs-behavioral) |
| Coupling = "changing one forces changing the other"; cost-of-software = cost-of-change | Tidy First? (2023) | ENCODED | **net-new v0.3** → §Tidy First (coupling/cohesion economic core); substrate under SRP / Divergent Change / CCP |
| Tidy timing: never / later / after / first (DCF + optionality) | Tidy First? (2023) | ENCODED | **net-new v0.3** → Clause 9 (tidy-economics gate); positive complement to Clause 1 |
| Tidying — One Pile (inline-before-resplit) | Tidy First? (2023) | ENCODED | **net-new v0.3** → §Tidy First tidyings; counterweight to extract-method, pairs w/ Clause 3 (Ousterhout) |
| Tidying — Normalize Symmetries (make dups identical before extracting) | Tidy First? (2023) | ENCODED | **net-new v0.3** → §Tidy First tidyings; precursor to Clause 1 Rule-of-Three |
| Tidying — Reading Order / Cohesion Order | Tidy First? (2023) | ENCODED | **net-new v0.3** → §Tidy First; statement-grain CCP / G10-adjacent |
| Tidyings — Guard Clauses / Extract Helper / Explaining Vars+Consts | Tidy First? (2023) | ENCODED | §Function rules + §Naming rules + Long Method (already owned) |
| Tidyings — Dead Code / Explaining + Redundant Comments | Tidy First? (2023) | EXCLUDED | knip (dead code); §Comments + the hidden-constraint carveout (comments) |
| 4 Rules of Simple Design (priority-ordered) | XP / Clean Craftsmanship | ENCODED | §Tidy First (Beck) — see flipped cross-book row above |
| YAGNI ("You Aren't Gonna Need It") | XP (1999) | ENCODED | named in Clause 1 (don't build flexibility you can't name an imminent use for) |
| TDD / red-green-refactor | TDD By Example (2002) | EXCLUDED | Clause 6 (no TDD orthodoxy) — deliberately out |
| Embrace change / incremental design | XP Explained (1999/2004) | ENCODED-philosophy | aligns Clause 1 + Clause 9 (sequence by imminent change; keep options open) |

## Out of scope

| book | verdict | note |
|---|---|---|
| The Clean Coder (2011) | OUT-OF-SCOPE | professionalism / estimation / commitment / saying-no — conduct, not code-design. No mapping. |
| Clean Agile (2019) | OUT-OF-SCOPE | Agile process / team practice / planning — process, not code-design. No mapping. |
| Implementation Patterns (Beck, 2007) | OUT-OF-SCOPE | Java-idiom patterns book; the durable cross-language ideas (intention-revealing names, small methods, symmetry) are already ENCODED via §Naming / §Function rules + Normalize Symmetries. No net-new TS-applicable rule. |

## GAP register (validation queue)

Held for audit-history validation. NOT active rules. Sorted P1 → P3.

| code/name | priority | validate by |
|---|---|---|
| ~~ADP — Acyclic Dependencies~~ **GRADUATED 2026-06-01** | — | validated via `node scripts/adp-cycle-scan.mjs` (4 cycles found, all touching services/lib) → now a firing rule (§Acyclic Dependencies Principle). No longer in queue. First GAP→rule graduation — proves the validation gate works. |
| ~~G36 / Law of Demeter~~ **DEMOTED→EXCLUDED 2026-06-01** | — | validated: 142 method chains all fluent-builder (Zod/Drizzle), 129 deep property paths are type-namespace / SDK-nav / flat-DTO reaching — zero behavior-object train-wrecks. Fluent-API + flat-typed-data architecture neutralizes LoD. No longer in queue. |
| CQS — commands-don't-return half | P2 | scan audit history for any finding that hinged on a query mutating; the "no side effects" half is already encoded. |
| ~~G31 — Hidden Temporal Couplings~~ **DEMOTED→EXCLUDED 2026-06-01** | — | judgment pass: every load-bearing temporal coupling is already NAMED+enforced (processing.md transaction order, side-effect cascade order, migrations.md FK-delete, actions.md auth-check order, ADP module-init) — inverse of G31's "hidden" precondition. No longer in queue. |
| ~~CCP — Common Closure (component grain)~~ **GRADUATED→ENCODED 2026-06-01** | — | judgment pass (N≥2): one module's read/write→domain-vertical near-miss + another module's per-event split. Added as the decomposition-axis sub-rule under Divergent Change (co-change axis, verified via test-naming + call-graph). The file-grain smells said "split" but not the AXIS — genuine gap. No longer in queue. |
| CRP — Common Reuse | P2 | check whether any module-boundary finding would have been sharper with a component-grain ISP framing. |
| REP — Reuse/Release Equivalence | P2 | no independent release units at this stage; revisit only if shared packages / a separately released extraction lands. |
| SDP — Stable Dependencies | P2 | confirm it adds anything beyond the layer-cake Dependency Rule before promoting; likely demotes. |
| SAP — Stable Abstractions | P2 | likely subsumed by §SOLID — D + Clause 3; confirm against audit history. |
| F1 — Too Many Arguments | P3 | scan for any finding that an arg-count trigger would have improved (expect ~none — TS object-params). |
| F3 / G15 — Flag / Selector Arguments | P3 | check whether any decomposition finding cited a boolean/selector flag splitting behavior. |
| G10 — Vertical Separation | P3 | rarely actionable at module-audit grain; expect permanent demotion. |
| G22 — Make Logical Dependencies Physical | P3 | borders Primitive Obsession; check overlap before promoting. |
| G29 — Avoid Negative Conditionals | P3 | too fine-grained for module-audit; expect demotion. |
| G33 — Encapsulate Boundary Conditions | P3 | too fine-grained; expect demotion. |
| Humble Object | P3 | confirm not wholly inside qa-expert before promotion. |
| 4 design smells (Rigidity / Fragility / Immobility / Viscosity) | P3 | confirm our 7 named smells cover the symptoms; expect documentation-only. |
| Immutability / pure functions / referential transparency | P3 | confirm `rules/typescript.md` is the right owner before any uncle-bob promotion. |

## Maintenance

The book catalogs are fixed (Ch.17 is 66 items; component principles are 6; SOLID is 5) — re-touch this file only when a uncle-bob rule/clause changes (an ENCODED citation moves) or when a GAP graduates. GAP rows graduate to firing rules ONLY after audit-history validation confirms the pattern actually recurs in this codebase — never as a speculative theory addition. PARTIAL rows close when the named missing-half lands as a clause. This is a calibration artifact, not a backlog: the point is documenting *why we don't fire*, not accumulating things to add.
