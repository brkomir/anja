# Agent-Mode Cross-Cutting Discipline — READ FIRST

**You are a specialist subagent. Your SKILL.md + MEMORY.md cover your expertise.** This primer covers the cross-cutting discipline that prevents common failures — lessons distilled from orchestrator-observed recurrences across many sessions. Every rule is a sub-15-second check.

## Verification before editing / citing

### Preservation verification before contract changes (invented nonexistent KEEP)
**Trigger:** about to widen a type union, rename a symbol, change a function signature, or modify any exported contract.
**Action:** grep repo for consumers before editing. `rg -l "<symbol-name>" src/` — inspect each consumer. Fix all touched sites in the same edit OR surface a `**ORCHESTRATOR CONSUMER SWEEP NEEDED**` section.
**Evidence:** an agent widened `checkUsernameAvailability` return-union to include `rate_limited`, fixed one site in a consumer file but missed a second in the same file — a later tsc run surfaced the error.

### Factual-claim verification before citing named symbols (factual-claim verification)
**Trigger:** about to write "file X uses function Y", "the API is `acquireSlot()`", or similar named-symbol claim.
**Action:** grep cited location FIRST. `rg "symbol-name" path/`. Fictional/hallucinated APIs sneak in when authors infer from brief context instead of verifying.
**Evidence:** an agent wrote a concurrency-limiter test against `acquireSlot`/`releaseSlot` (does not exist — a sibling agent shipped `acquireConcurrencySlot`/`withConcurrencySlot`). The first agent had to rewrite the test.

### KEEP/PRESERVE instructions require verification
**Trigger:** your brief says "KEEP the X call" or "PRESERVE Y's behavior" for code you're modifying.
**Action:** verify X/Y exists in the pre-edit file before following the instruction. Bad briefs cause agents to ADD something that never existed.

## Test discipline

### No source-grep tests
**Trigger:** about to write `const src = readFileSync(file); expect(src).toContain(...)` or similar.
**Action:** DON'T. Invoke the function, assert on output. Source-grep tests break on trivial refactors (formatting, import re-ordering, constant extraction) and prove nothing about behavior.
**Narrow exception:** wiring-contract assertions (e.g., "parent renders child component") with explicit comment documenting they're format-stable regex patterns.

### No e2e for unit-testable logic
**Trigger:** about to write a Playwright spec to test logic that Vitest + `vi.mock` could cover 1:1.
**Action:** write the unit test. E2E budget is for user-journey smoke tests; burning it on mock-reducible logic is waste.

### `vi.mock` factories need importActual OR silently drop exports
**Trigger:** `vi.mock("@/some/module", () => ({ foo: mockFoo }))` — replaces the ENTIRE module surface.
**Action:** spread `importActual` unless you actually want to kill all other exports:
```ts
vi.mock("@/x", async () => {
  const actual = await vi.importActual<typeof import("@/x")>("@/x");
  return { ...actual, foo: mockFoo };
});
```

### `vi.mock` factories referencing module-scope vars need `vi.hoisted`
**Trigger:** `const mockFoo = vi.fn(); vi.mock("@/x", () => ({ foo: mockFoo }))` — ReferenceError at test load because `vi.mock` hoists above `const`.
**Action:** `const { mockFoo } = vi.hoisted(() => ({ mockFoo: vi.fn() }));`

### Integration-test loop seeding needs UNIQUE-constraint awareness
**Trigger:** inserting N rows in a for-loop via `db.insert()` in integration tests.
**Action:** grep `supabase/migrations/*.sql` for UNIQUE/PRIMARY KEY on the target table FIRST. Loop-seeded rows with repeated `email`/`slug`/composite keys fail on iteration 2 with constraint violation.

### Integration / e2e tests run via the project HARNESS, never bare vitest/playwright
**Trigger:** about to run an integration test (`tests/integration/**`) or an e2e spec — OR about to report "Docker down" / "DB unreachable" / "can't run the integration suite" / "environment broken."
**Action:** use the canonical harness — `npm run test:integration -- <file>` (boots the Docker postgres container on :5433, applies migrations, runs, tears down) and `./scripts/e2e-local.sh` for e2e. Running `npx vitest run tests/integration/...` DIRECTLY hits no DB → "connection refused" — that is a WRONG-INVOCATION error, NOT a broken environment. NEVER report the environment/tooling as down/unavailable from a bare-tool failure; if you genuinely must, first run `docker info` (daemon check) + the harness, and report the harness result.
**Evidence:** audit 2026-06-11 — an agent ran bare `npx vitest run` on an integration-test file (no DB → connection refused), concluded "Docker down," and the orchestrator propagated it into the tracker as a false gate. Docker was up (29.2.1); the harness ran 10/10 PASS.

### UUID v4 test-seed fixtures need hex + variant nibble
**Trigger:** hand-writing UUID string literal for a test fixture.
**Action:** format is `xxxxxxxx-xxxx-4xxx-Nxxx-xxxxxxxxxxxx` where N ∈ {8,9,a,b} and all other chars are 0-9 or a-f. **`-8xxx-` works for everything** — easy mnemonic. Zod `.uuid()` rejects variants `0-7` or `c-f` in the 4th-block-first position.

### Interface changes mandate call-site updates OR TEST-CONTRACT SWEEP flag (interface change)
**Trigger:** your scope changes a function signature, exported type, or extracts a constant/literal.
**Action:**
1. `rg --type ts 'funcName\(' src/ tests/` to enumerate call sites.
2. Update callers in YOUR ownership.
3. For callers in files NOT in your ownership (typically tests), surface a `**ORCHESTRATOR TEST-CONTRACT SWEEP NEEDED**` section in your output with exact substitution patterns. Orchestrator runs the sweep post-wave.

### Constant/literal extraction breaks source-grep tests in unrelated files (extraction)
**Trigger:** factor-out refactor — moving a constant/literal/symbol from file A to file B.
**Action:** grep `tests/` for the extracted symbol. Surface broken test-expectations via `**ORCHESTRATOR TEST-CONTRACT SWEEP NEEDED**` (same format as the interface-change rule above).

### New i18n namespace requires allowlist update (i18n namespace)
**Trigger:** adding a new top-level key to `messages/en.json` (e.g., `"Critique": {...}`).
**Action:** `rg -l "pickMessages as pick" src/app/` to locate the 6 allowlists (the `pick(` call sites are multi-line, so a `pick(messages,` pattern matches NOTHING). Update the ones corresponding to surfaces where the namespace is consumed, OR flag `**ORCHESTRATOR I18N ALLOWLIST SWEEP NEEDED**`. Missing allowlist = runtime `MISSING_MESSAGE` on every render.

## Command / shell discipline

### Avoid compound/chained bash in agent tool calls (2026-04-20)
**Trigger:** writing a single Bash tool call that chains multiple commands with `&&` / newline / `||` / `;` where at least one command varies per invocation (e.g., `echo "progress" >> /tmp/X.txt\nnpm run test:integration -- tests/integration/<different-file>.test.ts`).
**Action:** emit EACH command as a separate Bash tool call. Claude Code's "always allow" approval matches exact compound-command strings — every new compound variant re-prompts even when both parts are individually allowlisted.
**Why:** an agent's heartbeat + test-command compound pattern produced 30+ approval prompts for 4 test-file runs. Time cost: ~15 min of user click-through.
**If you must compound** (single shell operation requires it): document the exact pattern in your output so orchestrator can pre-add to allowlist on next wave.

### Long-running commands get `tee`, not pipe-filter (2026-04-20)
**Trigger:** running a command with wall-clock >30s whose output might need follow-up filtering (test suites, builds, `git log --all`, long greps).
**Action:** `<cmd> 2>&1 | tee /tmp/<descriptor>.log | tail -20` — capture raw first, filter inline for preview, re-grep the file for any follow-up queries.
**Why:** filtering-at-pipe on first run is irreversible. If your filter was wrong, recovery = re-execution. For a 4-min integration suite, that's 4+ min waste per mistake. `tee` is cheap insurance.
**Evidence:** integration pass 2026-04-20 — unit tests re-run 4× (8 min waste) + integration re-run 1× (267s waste) because first-run output was `| tail`'d.

## Refactoring & scope discipline

### Separate structural changes from behavioral changes (Beck *Tidy First?* — uncle-bob §Tidy First)
**Trigger:** about to braid a structural change (refactor / rename / move / extract — doesn't alter behavior) into the SAME commit as a behavioral change (feature / bug-fix).
**Action:** ship the tidying in its OWN commit, before or after — never inside the behavioral diff. A braided diff buries the behavioral change in mechanical noise, so review misses regressions and a revert can't isolate the cause. If the tidying isn't worth its own commit, it's tidy-**later** (don't drive-by it into the feature). Kent Beck's structural-vs-behavioral hard split.

### Don't build speculative abstraction — Rule of Three (uncle-bob §Clause 1 / saas-architect §simplest-thing)
**Trigger:** about to add a shared helper / base class / generic interface / config-driven branch / parameterization to handle a case with fewer than 3 concrete instances, OR a "might need it later" hypothetical variant.
**Action:** build the CONCRETE version now; extract the abstraction at the 3rd real instance. Test: name the concrete flexibility the abstraction buys *today* — "might need it" → don't. The wrong abstraction is more expensive to unwind than duplication (Metz).
**⚠️ Direction guard (this project specifically):** this blocks SPECULATIVE generality ONLY. It is NOT license to under-build, hack, or ship "minimum viable" — quality-first applies to the concrete thing, and under-scoping is one of this project's most repeated corrections. Build the concrete feature properly; just don't pre-generalize it.

## An unverified claim says so IN the sentence — the 🟢🟡🔴 tag slot is retired (2026-10-09)

**Source:** adapted, in this repository's own words, from the Confidence Tagging rule of the alirezarezvani/claude-skills skill-authoring standard; no sentence copied (its 🟢 verified / 🔴 assumed labels were kept until the tag slot was retired; the in-sentence form below replaces them).

**Trigger:** composing your structured return containing a load-bearing factual claim — "X exists", "Y is wired", "N/N pass", "file Z does W".
**Action:** a claim you verified THIS task carries its instrument in the same sentence (the command run, or `path:line`) — the orchestrator can re-run an instrument, never a grade; a claim you did not verify says so in that sentence ("not checked this run" / "from my MEMORY entry of <date>, not re-read") and, in a panel return, also lands under `### Could not check`. No self-graded tag: self-graded confidence tags were measured and refuted on the mail-relay channel (111 fires, 0 of 4 wrong claims tagged); this slot shares that mechanism and was never measured on returns, so the obligation sits in the sentence itself (`.claude/orchestrator/conventions.md` § Say an unverified claim is unverified IN the sentence).

## Memory read protocol (2026-08-01)

**Trigger:** the start of every dispatch — you are about to read `.claude/skills/<you>/MEMORY.md`.
**Action:**
1. **Attempt the WHOLE-FILE `Read` first.** Most skill MEMORYs fit in one call; do not pre-emptively page.
2. **If — and only if — you get a truncation banner or a size/token error** (`Read` caps at ~25,000 tokens per call; files over 262,144 B hard-error), recover rather than give up:
   - `rg -n '<your consult topic>' .claude/skills/<you>/MEMORY.md` to get line offsets for what THIS task needs, then `Read` those regions with `offset`/`limit`.
   - Then page the **TAIL** (`Read` with an `offset` ~150 lines back from the end). Newest entries are last and are the most likely to have superseded older ones. **~150 lines, not 200** — these files run 139-318 B/line, so 200 dense lines can bust the per-call token cap and you lose the call.
3. **NEVER answer from page 1 alone.** A head-only read is systematically biased toward the OLDEST, most-superseded decisions — the exact failure the file exists to prevent.
4. **Report what you actually got** in the `### Memory-load:` field of your structured return (`FULL` / `PARTIAL(lines A–B of N)` / `FAILED(<error>)` / `NOT-READ`), pasting the verbatim tool notice for PARTIAL/FAILED. An honest PARTIAL is useful to the orchestrator; a silent partial is not.

**Grep the DIR, not just the file.** Older bodies are split out to `MEMORY-ARCHIVE*.md` in the SAME directory, so before you claim a decision was never made — `rg '<topic>' .claude/skills/<you>/` (the directory), never `MEMORY.md` alone. A single-file grep proves absence only from the hot file.

**Why this is in the primer:** a 4,184-dispatch fleet audit (2026-08-01) found 39% of dispatches never ATTEMPTED the read (⛔ **SUPERSEDED 2026-08-26 by a classifier fix: 27.6% + ALT_READ 5.1% over 6,953 dispatches — the stale figure is the more alarming one**) and 87.3% of the byte-capped class never paged past the truncation. Un-read outnumbered un-readable 4.6× — the failure is procedural, not a file-size problem.

## Memory persistence (sub-agent MEMORY blocks)

Your `### Memory Update` block in the structured response IS your persistence artifact. **DO NOT call `Edit`/`Write` on your own `MEMORY.md`** — orchestrator extracts and persists. Calling Edit on your MEMORY.md typically causes truncation: your terminal "Memory persisted" message overwrites the structured verdict in orchestrator context (the truncation pattern, ~20-30% historical rate).

## Commit discipline

You never commit, stage, push, or run a commit tool (`git commit`, `git add`, `git push`, `scripts/safe-commit.sh`, `scripts/private-index-commit.sh`). The worktree is shared with peer sessions and the orchestrator commits; you return the changed-file list plus the diff or a report. The commit doctrine is not in any sub-agent's payload, so do not look for it — the rule is simply: don't.

⛔ **THE BAN IS ON THE VERB, NOT ON THE RISK — a proposal to narrow it to "don't stage content" was declined.** So `git add -N` counts, even though it is transient and you reset it afterwards.

✅ **AND HERE IS THE THING THE TWO RECORDED VIOLATIONS ACTUALLY WANTED, because both were reaching for a legitimate number and only the route was wrong: to count the lines in a file git does not track yet, use `git diff --no-index --numstat /dev/null <file>`.** It never touches the shared index (measured 2026-09-04: `3 0` on a three-line file, which stays `??` afterwards). The `git add -N …; git reset` recipe is the one that trips this rule; this is the permitted route to the same answer.

⛔ **READ THE COUNT, NEVER THE EXIT CODE — THIS COMMAND EXITS 1 ON SUCCESS.** `git diff --no-index` reports *files differ* through its exit status, so the route recommended above returns FAILURE every time it works: measured rc=1 on a three-line file, on an EMPTY file, and on a binary one. `… --numstat /dev/null f && echo ok` prints nothing, and under `set -e` the script aborts. **rc carries no information here, so the ONLY signal is the output: if FIELD 1 DOES NOT PARSE AS AN INTEGER, YOU DID NOT GET A COUNT.** Measured: a normal file gives `3`, a BINARY file gives `-`, and a BAD PATH gives `error:` — all three at rc=1, success and failure alike. Test field 1, never rc. Found on the commit that added the clause above, and the integer test is a generalisation of it; both reproduced here before folding.

## Truncation self-awareness

If your response includes a very long structured verdict + late tool calls (Edit/Write/Read), consider: is the structured block fully rendered before the tool calls? Ending on a tool-call confirmation message has caused verdicts to truncate. Restate key blocks at the end if in doubt.

---

**Revisit:**
- **Promote to primer:** new cross-cutting pattern recurs **2+ times across audits** — promote from the lesson log to this primer via `/meta learn` Step 4. Exception: if a **single occurrence is severe** (launch-blocker, data loss, credit drift, production break, >15-min user time cost like the 30-prompt click-through) → promote **first time**. Judgment call; flag for user decision if borderline.
- **Prune from primer:** specific rule with **3 audits + zero triggered instances** → prune (assume rule became muscle memory OR original pattern disappeared).
