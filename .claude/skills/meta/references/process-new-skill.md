# Process — Add new skill/expert

Codified procedure for adding a single new skill/expert to the existing system. Distinct from `expert-system-bootstrap` skill (which bootstraps the WHOLE system on a fresh project — Phase 1-6 covering meta architecture + skill roster + memory layer). This procedure adds ONE skill to an existing system.

**When to use:** when a recurring gap surfaces that an existing expert doesn't cover — panel synthesis identifies it / recurring audit miss / user request.

**Anti-scope (when NOT to add a new skill):**

- **Domain already covered** by an existing expert — consult `.claude/skills/expert-review/references/department-directory.md` BEFORE drafting. If an existing skill's scope can absorb the gap with a small spec edit, do that instead.
- **Gap is sentinel-shaped** (mechanical CI tooling, not judgment-required) — Capture → Curate → Enforce framing applies. Sentinels go to test infrastructure (`tests/integration/*sentinel*.test.ts`) or hooks (`.githooks/pre-push`), NOT to a skill. A 5-expert review explicitly framed this split: "sentinel-shaped gaps go to mechanical CI; design-judgment-shaped gaps go to a skill."
- **One-time consultation need** — use `general-purpose` agent with explicit brief, or compose an existing expert with a wrapper prompt. New skill = ongoing maintenance cost; one-time questions don't earn that cost.
- **SC-1 budget violation** — max 3 meta-system commits per session per `.claude/rules/session-cadence.md`. If at cap, defer OR get explicit user override (log the override in meta MEMORY header).
- **Speculative gap** — if you can't cite ≥2 concrete instances where the gap produced actionable findings that an existing expert missed, the gap may be hypothetical. Wait for evidence.

---

## 6-phase procedure

### Phase 1: Gap definition

**Output:** 1-line gap statement + evidence count + skill-vs-sentinel classification.

Write a single-sentence gap statement citing evidence:
- Panel synthesis finding (which audit, which expert flagged the gap)
- Recurring audit miss (count + audit references)
- User-named gap (cite the conversation)

Verify the gap is:
1. **Real** — ≥2 concrete instances where it produced actionable-but-missed findings
2. **Skill-shaped** — judgment required, cross-context, not mechanical
3. **Not redundant** — consult `department-directory.md`; no existing expert covers it
4. **Stable** — not a one-time question that resolves with one consultation

If any of 1-4 fails, abort. Either fix the existing expert's scope OR ship a sentinel/hook instead.

### Phase 2: Shape decision

**Output:** shape classification (pure-domain / pure-persona / hybrid) + skepticism level + routing posture + contrarian eligibility.

Decide skill shape:
- **Pure domain expert** (like `saas-architect`) — neutral voice, rubric-driven, professional register
- **Pure persona** — opinionated voice, persona-driven, project-specific identity
- **Hybrid** (like `uncle-bob`) — persona voice + concrete rubric + anti-scope clauses with primary-source citations

Decide skepticism level (frontmatter `skepticism: high|medium|low`):
- **HIGH** — designed to find problems (qa-expert, security-expert, uncle-bob)
- **MEDIUM** — balanced (most domain experts: saas-engineer, saas-architect, frontend-developer)
- **LOW** — designed to find what to add/improve (ux-copywriter, CRO experts, engagement-psychologist)

Decide routing:
- **Default audit member?** Rare — qa-expert is the canonical example because tests-with-fixes is launch-blocker every audit. Most new skills are on-demand, routed by question type.
- **Routing-table trigger phrases** — what questions should always include this expert? Draft 1-3 row additions to `.claude/skills/expert-review/SKILL.md` routing-rules table.
- **Contrarian eligible?** HIGH-skepticism = typically NO (they already find problems by default; assigning as contrarian is double-skeptical and produces all-critique-no-construction). MEDIUM/LOW skepticism = yes, can rotate into contrarian pool.

### Phase 3: Online research (research-heavy skills only)

**Output:** research synthesis with canonical positions + critics + voice signatures + URLs.

Skip this phase for purely-project-specific skills (e.g., persona built from in-house user research).

⛔ **An `external-*` expert does not take this phase's web research: its body is read from a FULL CLONE at a pinned sha by a catalog seat — `.claude/skills/scout/SKILL.md` § CLONE BEFORE YOU CATALOG. WebSearch, WebFetch and contents-API reads are register depth only.**

For research-heavy skills (domain experts, frameworks-based personas):

1. **WebSearch canonical positions** — 3-5 searches: core definitions / methodology / recent updates. Examples for uncle-bob bootstrap:
   - `"Robert C Martin SOLID principles canonical definition"`
   - `"Uncle Bob clean code named smells god class long method"`
   - `"Uncle Bob clean coder blog recent posts functional programming"`

2. **WebSearch for criticisms / alternative framings** — **LOAD-BEARING for anti-scope clauses.** You need critics' positions to know when NOT to fire. Examples for uncle-bob:
   - `"Dan Abramov Goodbye Clean Code criticism premature abstraction"`
   - `"Uncle Bob clean code criticism controversy dogmatic"`
   - `"John Ousterhout Philosophy of Software Design deep modules"`

3. **WebFetch primary sources** — get direct quotes and voice signatures from at least 1 canonical source and 1 critic source. Examples:
   - `https://overreacted.io/goodbye-clean-code/` (Abramov's canonical critique)
   - `https://blog.cleancoder.com/uncle-bob/2023/01/18/functional-classes.html` (Uncle Bob's voice + recent evolution)

4. **Compile research synthesis** BEFORE drafting SKILL.md — what's mainstream / what's critic-driven / what's the canonical voice / what's the field's recent evolution. The anti-scope clauses in Phase 4 will draw directly from this synthesis.

### Phase 4: Implementation

**Output:** new skill directory with 3 files + 4 integration edits + 1 generated agent wrapper + meta CHANGELOG entry.

**Create skill directory + 3 files:**
- `.claude/skills/<name>/SKILL.md` — frontmatter (name + description + skepticism) + rubric + anti-scope clauses with primary-source citations from Phase 3 + when-to-invoke + boundaries (handoffs to other experts) + Required Output Format pointer + memory section. Target ~180-280 LOC for hybrid/domain experts; ~120-180 LOC for personas.
- `.claude/skills/<name>/MEMORY.md` — header + any seed entries from Phase 1/2 prep work (e.g., hotspot map for code-review skills, decision context for persona skills). Keep small — MEMORY accumulates from real audits, not from spec authorship.
- `.claude/skills/<name>/CHANGELOG.md` — v0.1 entry citing the panel-synthesis evidence + rubric encoded + anti-scope clauses + revisit triggers.

**Update integrations (4 edited files + 1 generated):**
- `.claude/skills/expert-review/SKILL.md` — add routing-rule row(s) for the trigger phrases from Phase 2.
- `.claude/skills/expert-review/references/department-directory.md` — add to relevant cluster (Engineering / UX / etc.); update cluster count; update interaction note for how this expert pairs with siblings.
- `scripts/generate-expert-agents.mjs` — add to EXPERTS dict with description string. Position alphabetically among siblings.
- Run `node scripts/generate-expert-agents.mjs` — generates `.claude/agents/<name>.md` wrapper file. Verify the new agent file is created (`ls .claude/agents/<name>.md`).
- `.claude/settings.json` `skillOverrides` — add `"<name>": "user-invocable-only"` for a new EXPERT (it has an agent wrapper and is dispatched by the Agent tool, so it is hidden from the model's skill listing like its siblings). The generator does not write this line. A COMMAND skill the model invokes itself gets no entry, and neither does an expert the model invokes through the Skill tool.

**Note on agent dispatch in same session as bootstrap:** the agent registry REFRESHES mid-session through an `agent_listing_delta` attachment (2026-10-11) — an "Agent type not found" right after writing a new agent file is LAG, not restart-only, so retry `Agent(subagent_type: "<name>")` once the listing shows it. If it still does not appear, dispatch via `general-purpose` with an explicit "read .claude/skills/<name>/SKILL.md and MEMORY.md first, then act as <name>" wrapper for the Phase 5 test-fires. *(Read "NOT directly dispatchable … until next session" until 2026-10-11.)*

**Update meta CHANGELOG:**
- `.claude/skills/meta/CHANGELOG.md` — entry documenting the skill add + rubric encoded + integration touched + revisit trigger + SC-1 count.

### Phase 5: Test-fire validation

**Output:** 1-3 audit results showing the rubric + anti-scope clauses fire correctly.

**CRITICAL — without this, skill ships uncalibrated.** Speculative anti-scope clauses (without real audit evidence) routinely over- or under-fire.

Pick 1-3 target audits that STRESS-TEST the anti-scope clauses:

1. **"Trick" case** — pick a file/surface where the rubric might over-fire (uncle-bob example: a large registry-shaped file that should PASS the registry-carveout, NOT be flagged as god-class). If the trick case fires a false positive, the anti-scope clause needs sharpening.

2. **"Clean" case** — pick a file/surface where the rubric should clearly fire (uncle-bob example: a large file that is an actual god-class with concrete decomposition boundaries). If the clean case doesn't fire, the rubric is too weak.

3. **"Near-miss" case** (optional) — a defer-worthy finding where the rubric should land in the middle. Tests both the rubric AND the demotion-to-`todo.txt` flow.

Dispatch via Agent tool. If the agent file is freshly generated this session, use `general-purpose` with wrapper. Brief should include:
- Read `.claude/skills/<name>/SKILL.md` + MEMORY.md first
- Apply the FULL rubric
- Required Output Format per `/expert-review` spec
- Calibration discipline: be honest if a clause needs sharpening or relaxing

Observe:
- Did the rubric fire on the right files?
- Did anti-scope clauses DEMOTE findings (to `todo.txt`) rather than SILENCE them entirely?
- Did the verdict surface concrete trade-offs?
- Did the voice signatures land (for persona/hybrid skills)?
- Did the Memory Update block contain useful calibration data?

If first test produces obviously-miscalibrated output, iterate BEFORE running the second test — patch SKILL.md anti-scope clauses, re-test. The bootstrap is incomplete until ≥1 stress-test passes cleanly.

### Phase 6: Calibration patches (v0.1.x)

**Output:** ≤3 v0.1.x patches based on real audit evidence + matching CHANGELOG entries.

Each test-fire from Phase 5 may surface sharpening signals → v0.1.x patches:
- Add new detection heuristic from observed audit evidence (e.g., uncle-bob v0.1.2 added "fast-path SRP detection: >10 audit IDs in commit history = Divergent Change proven" from the clean-case audit)
- Sharpen anti-scope clause when over-firing observed
- Add specific carveout when test reveals an edge case
- Reorder Phase 2 "How I Reason" steps when audit shows the order matters (e.g., uncle-bob v0.1.1: "file-shape test FIRST before size threshold")

**Patches are REAL-WORLD-EVIDENCE-DRIVEN, not speculative.** If you find yourself patching without an audit observation, you're over-engineering. Stop and wait for the 3rd audit.

Update for each patch:
- `SKILL.md` — the patch content
- `CHANGELOG.md` — v0.1.x entry citing the audit evidence that surfaced it
- `MEMORY.md` — gets the audit-entry itself (already from Phase 5; the Memory Update block from the test-fire is the source)

---

## Total time / scope estimates

- **Light persona** (no online research, project-specific identity): ~1 hour, ~150 LOC across 3 files
- **Research-heavy domain expert** (Phase 3 substantial): ~2.5 hours, ~250-300 LOC across files + 2-3 commits

(Time estimates here are HUMAN-pace for spec-writing decisions; AI tool-calls run much faster but require human approval at each phase boundary. See LARP markers — never convert these to AI-output time estimates downstream.)

## Worked example: uncle-bob bootstrap (2026-05-26 → 2026-05-27)

| Phase | What happened | Cost |
|---|---|---|
| 1 — Gap definition | A 5-expert review surfaced a qa-expert bucket: "corpus-wide design judgment, only fillable by a skill" | included in panel cost |
| 2 — Shape decision | Hybrid (persona voice + concrete rubric) + HIGH skepticism + on-demand routing + excluded from contrarian pool | ~10 min |
| 3 — Online research | 6 WebSearches + 2 WebFetches on SOLID + named smells + critics (Abramov, Metz, Ousterhout, Muratori) | ~30 min |
| 4 — Implementation | 7 files (3 new + 4 edits) + agent generation | ~280 LOC SKILL.md + ~60 LOC integration |
| 5 — Test-fire (2x) | trick case → APPROVED registry; clean case → ALTERNATIVE god-class | 2 background agent dispatches, ~5 min each |
| 6 — Calibration patches | v0.1.1 (file-shape FIRST) + v0.1.2 (fast-path SRP + section-divider density) | ~32 LOC patches |

**Total artifact:** 1 new skill + 7 files touched + 2 commits + 2 audits + 3 new tracker deferral entries. ~3 hours wall-clock across 2 sessions.

---

## Revisit

This procedure was codified 2026-05-27 with **N=1 evidence** from the uncle-bob bootstrap. After 2 more skill additions (N=3 total), audit which phases consistently add value vs which are ceremony. Likely candidates for pruning if they consistently produce 0 value:
- Phase 3 for project-specific personas (already skip-allowed)
- Phase 6 if calibration patches consistently come from a single audit (collapse 5+6 into one phase)
- Phase 1 sub-test #4 (stability) if it never fires meaningfully

If a future bootstrap reveals a missing phase (e.g., "stress-test against an existing skill's MEMORY for cross-expert conflicts before shipping"), add it explicitly with the new evidence.
