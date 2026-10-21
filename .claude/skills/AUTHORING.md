# Skill Authoring — Cheatsheet

> One-screen reference for authoring `.claude/skills/*/` entries. Companion to `scripts/skill-lint.mjs` (tooling enforces; this doc explains).

**Source of conventions:** distilled from v2.6.4-v2.6.7 skill-lint work + wshobson/agents' PluginEval detectors + alirezarezvani's 10-pattern SKILL-AUTHORING-STANDARD (3 patterns adopted, 2 already conventions here; §10b).

---

## 1. File shape (minimum)

```
.claude/skills/<slug>/
├── SKILL.md       ← always required. Description + scope + process.
├── MEMORY.md      ← domain experts: past decisions. Orchestration skills: optional.
├── CHANGELOG.md   ← history of spec edits. One line per change: date + commit + WHY.
├── RULES.md       ← optional. Trigger→action lookup table for heavy skills (meta / audit-check / expert-review pattern).
└── references/    ← optional. ONLY when SKILL.md exceeds 500 lines (progressive disclosure).
```

Orchestration skills (`/meta`, `/orient`, `/wrap`, `/fix`, `/verify`, `/status`, `/flows`, `/features`, `/deploy-check`, `/launch-check`, `/hanging-work`, `/session-memory`, `/audit-check`, `/expert-review`, `/agent-work`, `/expert-system-bootstrap`, `/test-gap`) intentionally have NO agent file and NO MEMORY.md — they operate in the main conversation with full session context.

---

## 2. SKILL.md frontmatter (MANDATORY)

```yaml
---
name: slug-matches-folder
description: One-sentence expertise description. Use when [trigger conditions].
---

# Display Title

Main body...
```

**Both fields required** — skill-lint flags `MISSING_FRONTMATTER` without them.

**Description must include a trigger framing:**
- `Use when [conditions]` — most common
- `Use at [moment]` — for session-lifecycle skills
- `Use before/after [event]` — for gate skills
- `Use for [purpose]` — for mode-based skills
- `When the user [phrase]` — for user-request-triggered skills

skill-lint's MISSING_TRIGGER detector enforces this. The harness uses `description:` for natural-language skill-match at invocation time — descriptions without trigger framing reduce match accuracy.

---

## 3. Anti-patterns to avoid

Enforced by `scripts/skill-lint.mjs`:

| Code | Trigger | Fix |
|---|---|---|
| `MISSING_FRONTMATTER` | No `---\n...---` block at top of SKILL.md | Add YAML frontmatter with `name:` + `description:` |
| `MISSING_TRIGGER` | Description lacks "Use when/at/before/as/…" framing (skipped for a `disable-model-invocation: true` skill, whose description no model reads) | Reword description to include trigger |
| `EMPTY_DESCRIPTION` | `description:` field <20 chars | Expand to a meaningful sentence |
| `BLOATED_SKILL` | SKILL.md >800 lines (fires even WITH `references/` — the router itself is too big; two-tier since 2026-06-22), or >600 lines without `references/` | Extract long subsection into `references/<topic>.md`, replace with pointer |
| `SPEC_OVER_READ_BAND` | SKILL.md BYTES exceed the read guard's band (`TRACKER_THRESHOLD` in `.claude/hooks/warn-large-tracker-read.sh`, read at lint time — unreadable ⇒ an UNSCANNED finding, never a pass). The byte axis: bytes per line span >3× across the corpus, so BLOATED_SKILL is silent on most of the largest specs | Extract to `references/` — past the band an unbounded Read returns a prefix and says so only in a trailing reminder |
| `ORPHAN_REFERENCE` | SKILL.md links a `references/<file>.md` (resolved against the OWNING skill; full `.claude/skills/<x>/references/…` paths resolved cross-skill; `external-*` skills exempt from the bare form — they quote foreign repo layouts) or a `.claude/skills/<x>/` that doesn't exist | Create the referenced file/skill OR fix the path (file-level clause implemented 2026-07-11 — it was documented here but unimplemented for ~3 months) |

**Run before committing:** `node scripts/skill-lint.mjs` — the summary's `Total findings:` line should read 0, and its `Unscanned units:` line must read 0 too: a marked unit is one the linter could NOT check (an absent doc, a crashed sub-process, an unparseable `checks:` list — `scripts/skill-lint.mjs` header § THE UNSCANNED CONVENTION), never a clean one.

**Intentionally NOT enforced:** `OVER_CONSTRAINED` (>15 MUST/ALWAYS/NEVER directives). Our skills are rule-heavy by design — we encode 140+ codified lessons across the expert system.

---

## Model routing (enforced by skill-lint `AGENT_MODEL_PIN`)

- Every `.claude/agents/*.md` says `model: inherit`, and nothing else: an agent definition does not
  fix a model, because the seat that launches a helper is the one responsible for which model it runs.
  The launching seat names a model on the dispatch when it means one (the model-routing policy's tiers
  and the Fable ladder); a dispatch that names none runs on the session's
  model; the owner's explicit demand overrides both.
- The cost this moves: a helper launched from a Fable session without a named model now runs on Fable.
  The earlier rule (static `opus | sonnet | haiku` pins as a cost ceiling, `inherit` never) and the
  Sonnet tier for six content experts are retired with it; the generator writes `inherit` and
  the lint refuses any other value or a missing line.

---

## 4. MEMORY.md entry shape

For domain-expert skills tracking past decisions:

```markdown
# <skill-name> — Decisions

## YYYY-MM-DD — Title

Decision and rationale (3-8 lines max).

Revisit: [concrete trigger condition — NOT a date. "When X happens" or "If Y exceeds Z"].
```

**Rules:**
- One entry per significant decision. Don't log every change — only decisions that would change future recommendations.
- Revisit trigger is MANDATORY (per the defer-with-trigger discipline). Date-based revisits ("check in 3 months") are forbidden — use observable conditions.
- Entries are historical context, NOT rules. Verify referenced code still exists before acting on a memory (per the active-recall-before-write discipline).
- Keep entries evidence-rich: cite specific file:line references, test names, user pushback verbatim.

---

**Outcome annotation (owner-adjudicated entries — codified 2026-07-19).** When a panel/expert position recorded in a MEMORY entry is later OVERRULED or resolved differently by the owner, append a dated `[OUTCOME YYYY-MM-DD: …]` postscript to that entry citing the decision record — the original position stays as historical record; the postscript marks current state. An un-annotated overruled entry misleads every future read (an eye-flow retirement cluster: 4 expert MEMORYs carried an overruled position with no outcome note until a later sweep caught it). Seven experts were already practicing this organically — this names the convention.

## 5. RULES.md eligibility (3-criteria test)

A rule promotes to `.claude/skills/<name>/RULES.md` if it has ALL three:

1. **Trigger** — concrete textual or structural cue (phrase you're about to write, output you see, file shape)
2. **Action** — concrete sub-15-second check or substitution
3. **Generalizable** — fires across many contexts, not one specific incident

Examples of RULES-eligible:
- "About to run `git add -A`" → "NEVER; list files explicitly"
- "About to write 'wrap this session'" → "run context % check first"

Examples of RULES-INELIGIBLE (stay in MEMORY.md):
- Principles ("the system serves future sessions")
- Post-mortems ("this session's outcome was...")
- Panel playbook entries (audit-specific history)
- Evolution timeline (system history)

**Location:** RULES.md lives alongside SKILL.md + MEMORY.md in the skill dir. Loaded together when the skill fires.

---

## 6. CHANGELOG.md discipline

**Every SKILL.md edit gets a CHANGELOG entry. Same commit.**

Format:
```markdown
# <skill-name> — Changelog

## YYYY-MM-DD
- `<commit-hash>`: <one-sentence WHY — not WHAT>
```

**Rules:**
- One entry per spec edit — not per commit. Related spec edits in one session can share a line.
- WHY, not WHAT — the git diff shows WHAT. The CHANGELOG captures reasoning that gets lost in 6 months.
- Version numbers for meta (v2.6.x): group related changes. Other skills: date-based only.

**Missing CHANGELOG after spec edit → `/meta self-audit` will flag it.** Create the file with standard header if it doesn't exist.

---

## 7. Cross-skill disambiguation

When a new skill's scope overlaps a sibling, the description MUST include a disambiguation clause:

```yaml
description: >-
  ... Use when [scope]. Distinct from [other-skill] (operates at [different-level])
  — [other-skill] is for [different-scope].
```

Example from `saas-architect`:
> "Distinct from saas-engineer (implementation details) — this skill operates at the design and trade-off level."

Example from `haines-paywall-upgrade-cro`:
> "Distinct from public pricing pages (see haines-page-cro) — this focuses on in-product upgrade moments..."

**Why:** harness natural-language match works by keyword similarity — without disambiguation, user requests land on the wrong skill. Disambiguation clauses tell Claude which alternative fires when.

---

## 8. Agent generation (domain experts only)

Domain-expert skills get a companion `.claude/agents/<slug>.md` file for invocation via `Agent(subagent_type: "<slug>")`. Auto-generated from `scripts/generate-expert-agents.mjs`.

**When to regen:** after adding/removing a domain-expert skill, OR after editing a domain-expert SKILL.md description.

```bash
node scripts/generate-expert-agents.mjs
# Should write N agent files (N = entries in the generator's EXPERTS object)
```

**Which skills get agents:** see the hardcoded `EXPERTS` object in `scripts/generate-expert-agents.mjs`. Adding a new domain expert requires:
1. Create `.claude/skills/<slug>/` with SKILL.md + MEMORY.md
2. Add entry to `EXPERTS` object in `generate-expert-agents.mjs` (alphabetically sorted)
3. Run `node scripts/generate-expert-agents.mjs`

**Orchestration skills have NO agent.** See Section 1 for the list — these operate in the main conversation.

---

## 9. Decomposition (when SKILL.md grows)

**Trigger:** SKILL.md line count exceeds 500. (`skill-lint.mjs` flags `BLOATED_SKILL` at 800 — decompose before hitting that ceiling.)

**Pattern (wshobson progressive disclosure):**
1. Identify the longest `## Section` that's self-contained (usually "Implementation Plan" or "Reference Material")
2. Extract lines to `.claude/skills/<slug>/references/<topic>.md`
3. Replace the original section with a 3-line pointer:
   ```markdown
   ## Implementation Plan
   
   See `.claude/skills/<slug>/references/implementation-plan.md` for the full plan. Read on-demand during implementation rather than loading into every session.
   ```

**First canary:** one expert skill decomposed from 908 → 224 lines in v2.6.7. Implementation Plan extracted to `references/implementation-plan.md`.

---

## 10b. External authoring standards — what we adopted, what we rejected

The `Source of conventions` line at top names alirezarezvani's 10-pattern SKILL-AUTHORING-STANDARD — this section spells out which patterns were adopted, which were already conventions here, which were rejected, and why. Codified 2026-05-18 to prevent re-litigating the same evaluation in future sessions.

| # | alirezarezvani pattern | Verdict | Where it lives in our system |
|---|---|---|---|
| 1 | **Context-First** (require domain-context file before asking) | REJECT | Mismatch with our flow — user brings context via session. Our `/orient` covers the same need at session start. |
| 2 | **Proactive Triggers** (description includes when to fire unprompted) | **ALREADY HERE** | Section 2 — "Description must include a trigger framing" with 5 patterns enforced by skill-lint `MISSING_TRIGGER`. Skill descriptions already said when to fire before the standard was read; the lint check came from wshobson/agents. |
| 3 | **Confidence Tagging** (🟢/🟡/🔴 on synthesized findings) | **ADOPT, since retired** | Used on relayed claims and in the agent primer, then retired in favour of saying in the sentence itself whether a claim was checked (`.claude/agents/_agent-primer.md`). |
| 4 | **Bottom Line First** (lead with conclusion, not preamble) | **ADOPT** | Implicit convention across all skill specs + meta-system reports. Not enforced by lint; enforced by review. |
| 5 | **What+Why+How** structure for body content | **PARTIAL** | Our skill specs typically lead with When-to-use + Process, not the strict W/W/H frame. Aligned in spirit, different shape. |
| 6 | **Actions have owners + deadlines** | REJECT | N/A at skill-spec level — applies to project artifacts (audit findings). Not relevant for skill authoring discipline. |
| 7 | **Output Artifacts table** (each skill declares what it produces) | REJECT | Optional per skill. Most of ours are inline-output; adding a mandatory table would be ceremony without payoff. |
| 8 | **Related Skills disambiguation** (description names sibling skills + when to pick alternatives) | **ADOPT** | Section 7 — mandatory when scope overlaps a sibling. Examples: `saas-architect` vs `saas-engineer`, `haines-paywall-upgrade-cro` vs `haines-page-cro`. |
| 9 | **Mode-aware** (one skill with N modes via subcommand or flag, rather than N sibling skills) | **ALREADY HERE** | `/meta` (14 subcommands; several before the standard was read), `/me` (default/check/learn/learn-session), `/audit-check` (13 checks; default and `--v3-drift` modes). Generalize when ≥3 closely-related procedures share state. |
| 10 | **3-tier content hierarchy** (references/ → SKILL.md → scripts/ → assets/) | REJECT | Redundant with wshobson's progressive-disclosure pattern (Section 9 here — extract to `references/` at >500 LOC). |

**Net: 3 adopted (Confidence Tagging, since retired; Bottom Line First; Related Skills disambiguation) + 2 already conventions here (Proactive Triggers, Mode-aware) + 1 partial (What+Why+How).** Reject count: 4 (Context-First, Actions-with-owners, Output-Artifacts-table, 3-tier hierarchy).

**Re-evaluation triggers** — promote any REJECT to ADOPT if its trigger fires:
- *Context-First* — if `/orient` proves insufficient for cold-start context loading AND a contributor reports the gap explicitly.
- *Output-Artifacts table* — if a future skill produces ≥3 distinct artifact types per invocation and the implicit knowledge becomes a tax on consumers.
- *3-tier hierarchy* — N/A (functionally identical to our existing progressive-disclosure rule at 500 LOC).
- *Actions-with-owners* — N/A at skill level by design.

**Where the wshobson standards live** — Section 3 (anti-pattern detectors) covers 5 of wshobson's 6 PluginEval detectors. The 6th (`OVER_CONSTRAINED`) is intentionally NOT enforced — see Section 3 note.

---

## 10. Department placement (for domain experts)

Every domain expert fits one of the departments in `/expert-review`'s department directory (`.claude/skills/expert-review/references/department-directory.md`). Department placement affects:
- Which panels the expert gets composed into
- Which sibling experts it coordinates with
- Routing rules for `/expert-review` panel synthesis

**Current departments** (verify against that directory file — source of truth):
- Engineering (saas-engineer, saas-architect, frontend-developer, performance-expert, devops-deploy-expert, security-expert, uncle-bob)
- Design & UX (ux-design-pro, web-designer, ux-copywriter, accessibility-expert)
- CRO (haines-page-cro, haines-signup-flow-cro, haines-onboarding-cro, haines-paywall-upgrade-cro, haines-churn-prevention)
- Product & Business (saas-economist, growth-analyst, saas-metrics-analyst, market-researcher, saas-launch-marketing, user-researcher, ab-testing)
- AI & Prompts (prompt-engineer, ai-vision-expert, context-architect)
- Content & Brand (seo-content-strategist, brand-naming-expert)
- Legal (legal-advisor)
- Operations (launch-ops-expert, qa-expert, ops-monitor)
- Psychology (engagement-psychologist)

**When adding a new skill:** update the `/expert-review` department directory IF the expert fills a role not covered by existing departments. Otherwise add to the best-fitting existing department.

---

## Skill lifecycle checklist

New skill:
- [ ] Create `.claude/skills/<slug>/SKILL.md` with YAML frontmatter (`name:` + `description:` with trigger framing)
- [ ] Add MEMORY.md (domain experts) or skip (orchestration skills)
- [ ] Create CHANGELOG.md with initial entry
- [ ] If domain expert: add to `EXPERTS` in `scripts/generate-expert-agents.mjs` + run generator
- [ ] Add to `/expert-review` department directory if new department
- [ ] Run `node scripts/skill-lint.mjs` before and after — no finding your change introduced, and `Unscanned units: 0` (a count you moved — ARCH_DOC_DRIFT, COMPARISON_BANNER_DRIFT — is yours)
- [ ] Commit with explicit `git add` (no `git add -A`)

Spec edit to existing skill:
- [ ] Edit SKILL.md
- [ ] Add entry to CHANGELOG.md same commit
- [ ] If description changed + domain expert: update `EXPERTS` in generator + run `node scripts/generate-expert-agents.mjs`
- [ ] Run `node scripts/skill-lint.mjs` before and after — no finding your change introduced, and `Unscanned units: 0` (a count you moved — ARCH_DOC_DRIFT, COMPARISON_BANNER_DRIFT — is yours)
- [ ] Cross-skill lint: grep sibling skills for the same pattern (per meta cross-skill linting principle)
- [ ] Commit explicit files

Decomposition (SKILL.md >500 lines):
- [ ] Identify self-contained long section
- [ ] Extract to `references/<topic>.md`
- [ ] Replace with 3-line pointer in SKILL.md
- [ ] Update CHANGELOG.md noting the decomposition

---

## References

- **External authorship standards surveyed:** wshobson/agents (PluginEval dimensions) + alirezarezvani's SKILL-AUTHORING-STANDARD (10 patterns)
- **skill-lint implementation:** `scripts/skill-lint.mjs`
- **Agent generation:** `scripts/generate-expert-agents.mjs`
- **Meta skill conventions:** `.claude/skills/meta/SKILL.md` Principles section
- **Finding that motivated this doc:** authoring standards pay for themselves at 50-100 skills

## Revisit triggers

- If skill-lint gains a new detector → add to Section 3
- If a new department emerges → update Section 10
- ~~If we cross 100 skills~~ FIRED (117 skill directories) — the monolithic-vs-marketplace packaging question was re-decided on a different trigger: CORE-plugin + per-product overlay
- If an external-system deep-dive surfaces a new authoring pattern → evaluate for inclusion
