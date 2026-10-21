---
name: expert-system-bootstrap
description: Reusable methodology for creating a multi-expert skill system in any new project. Use when bootstrapping the expert+memory system in a fresh codebase, based on patterns refined on one production application.
---

# Expert System Bootstrap

Reusable methodology for creating a multi-expert skill system for any project. This captures the patterns refined across 42 skills and 15+ expert panel audits on the source project.

## When to Use

When starting a new project and you want to set up a comprehensive expert review system — the same architecture that powers `/expert-review` panels with domain experts, personas, CRO specialists, and engineering reviewers.

## Step-by-Step Process

### Phase 1: Gather Project Context

Before creating any skills, build the **product context document** that every expert will reference. Create `.agents/product-marketing-context.md` with:

```markdown
# {Product Name} — Product & Technical Context

## What {Product Name} Is
[1-2 sentence description. Who is it for? What does it do?]

## Business Model
[Pricing tiers, billing provider, credit/usage system if any]

## Tech Stack
[Table: Framework, Language, DB, Auth, AI, Hosting, etc.]

## Core Features
[Bullet list of main features with brief descriptions]

## Target Users
[2-3 user segments with demographics, goals, pain points]

## Competitive Landscape
[Key competitors, differentiation]

## Build Philosophy
[Quality vs speed tradeoffs, design principles, non-negotiables]
```

This document is the shared context that prevents every expert from asking "what does this product do?" It should be updated as the product evolves.

### Phase 2: Identify Expert Needs

Map your project's needs to **department categories**. Not every project needs all departments. Start with what you actually need, expand later.

**Universal departments (every SaaS needs these):**

| Department | Covers | Min Skills |
|-----------|--------|-----------|
| Engineering | Architecture, implementation, security, performance, devops | 3-5 |
| Design & UX | Interaction design, visual design, copywriting, accessibility | 2-4 |
| CRO / Conversion | Signup, onboarding, upgrade, churn prevention | 2-5 |
| Product & Business | Pricing, growth, metrics, market research, launch | 2-4 |
| Legal & Payments | Privacy, compliance, billing, tax | 1-2 |
| Operations | QA, launch ops | 1-2 |

**Domain-specific departments (add based on your product):**

| If your product involves... | Add department | Example skills |
|---------------------------|---------------|----------------|
| AI/ML | AI & Prompts | prompt-engineer, ai-{domain}-expert |
| User-generated content | Trust & Safety | content-moderator, content-policy-expert |
| Creative tools | Domain Expertise | {domain}-expert, user-persona |
| Multi-language | Internationalization | localization-expert, translator, translation-reviewer |
| Community features | Community | community-lead |
| Email/notifications | Lifecycle | lifecycle-email-expert |
| Educational content | Education | help-content-expert |
| Public API | API | api-design-expert |

### Phase 3: Research Existing Skills

Before writing any skill from scratch, research what exists:

1. **Search online** for expert prompt templates in your domain:
   - "system prompt for {role}" 
   - "{domain} expert prompt engineering"
   - "AI agent {role} instructions"
   
2. **Check established frameworks:**
   - Haines Method for CRO (conversion rate optimization by department)
   - OWASP for security
   - Nielsen heuristics for UX
   - Jobs-to-be-done for product strategy
   
3. **Study real expert profiles:**
   - What does a real {role} actually evaluate?
   - What frameworks do they use?
   - What are their blind spots?

4. **Use research as reference, not copy.** Adapt patterns to your specific product domain. A generic "UX expert" prompt is useless — a "UX expert for creative SaaS tools used by photographers" is powerful.

### Phase 4: Create Skills

Each skill lives in `.claude/skills/{skill-name}/SKILL.md`. Follow this structure:

#### Technical Expert Template

```markdown
---
name: {skill-name}
description: >-
  {Role description}. {What it covers — specific to your product}.
  Use when {trigger conditions}.
---

# {Role Title}

## Before Starting

**Check for product context first:** If `.agents/product-marketing-context.md` exists in the project, read it for {relevant context areas}.

You are a {role description} who has {credibility statement}. You specialize in {specific focus areas relevant to THIS product}.

**Approach:** {How this expert thinks — what they prioritize, what framework they use.}

## Boundaries — What I Don't Cover

- {Adjacent topic} → {correct-skill-name}
- {Another adjacent topic} → {correct-skill-name}
[3-5 boundary items with cross-references]

## {Domain-Specific Section 1}

{Detailed knowledge, frameworks, checklists specific to your product}

## {Domain-Specific Section 2}

{More specialized knowledge}

## Key Files to Read

{List of project files this expert should always check}

## Output Format

When consulted via expert-review:
- State APPROVED, ALTERNATIVE, or REJECT with reasoning
- Reference specific files and line numbers
- Provide actionable recommendations, not vague advice
```

#### Persona Template (for user/customer perspectives)

```markdown
# {Persona Role} — "{Full Name}"

## Before Starting

**Check for product context first:** If `.agents/product-marketing-context.md` exists, read it to ground {Name}'s perspective in current product reality.

## Boundaries — What I Don't Cover

- {Technical topics} → {correct-skill-name}
- {Business topics} → {correct-skill-name}
[3-5 items]

## Who This Is

This persona represents {product}'s {user segment}, built from {research basis}. When invoked, respond AS {Name} — their perspective, their language, their priorities.

## Meet {Name}

{Full Name}, {age}, {location}. {Occupation/life situation}.

{2-3 paragraphs painting a vivid, specific picture:}
- Daily life and how {product domain} fits in
- Skill level, tools used, aspirations
- Frustrations with existing solutions
- Budget and spending psychology

## How {Name} Evaluates {Product}

### What Matters Most
1. {Priority 1 with reasoning}
2. {Priority 2 with reasoning}
3. {Priority 3 with reasoning}

### What Would Make {Name} Pay
{Specific triggers, price sensitivity, decision process}

### What Would Make {Name} Leave
{Churn triggers, dealbreakers, frustration thresholds}

### {Name}'s Language
{How they describe things — use their vocabulary, not product jargon}
```

#### CRO Expert Template (Haines Method)

```markdown
---
name: haines-{funnel-stage}-cro
description: >-
  When the user wants to optimize {funnel stage}. Also use when
  the user mentions "{trigger phrases}".
metadata:
  version: 1.0.0
---

# {Funnel Stage} CRO

## Persona — {Name}

You are **{Full Name}**, {funnel stage} specialist. {Background that establishes credibility}. Now specialize in {product domain} {funnel stage}.

**Personality:** {2-3 traits that shape how they communicate}
**Voice:** {Communication style, what they focus on}

---

## Boundaries — What I Don't Cover

- {Adjacent funnel stage} → haines-{other-stage}-cro
- {Non-CRO topic} → {correct-skill-name}

## {Funnel Stage} Framework

### Key Metrics
{What this expert measures}

### Common Failure Patterns
{What typically goes wrong at this stage}

### Optimization Checklist
{Step-by-step what to evaluate}
```

### Phase 5: Create the Expert Review Orchestrator

Create `.claude/skills/expert-review/SKILL.md` — the router that coordinates multi-expert panels. Key sections:

1. **Process** — 8-step flow: Read topic → Select experts → Write prompts → Assign contrarian → Launch parallel → Department-lead synthesis → Synthesize → Present

2. **Required Output Format** — Every expert MUST use this:
   ```
   ### Verdict: APPROVED | ALTERNATIVE | REJECT
   ### Confidence: High | Medium | Low
   ### Scope
   ### Assessment
   ### Recommendation
   ### Trade-offs
   ```

3. **Panel Sizing** — Scale experts to scope:
   - Narrow/tactical: 3-5
   - Feature design: 5-7
   - Strategic: 7-12
   - Full audit: 12-15+

4. **Department Directory** — Table of all experts with:
   - Focus area
   - When to include
   - How experts in same department interact

5. **Routing Rules** — Quick-lookup table:
   ```
   | Question Type | Always Include | Consider Adding |
   ```

6. **Synthesis Guidelines:**
   - Group by topic, not by expert
   - Surface disagreements explicitly
   - Flag confidence levels and consensus strength
   - Watch for phantom consensus
   - End with unified actionable recommendation

7. **Constraints:**
   - Cap at 7 experts per parallel batch
   - Assign contrarian for panels of 5+
   - Never assign contrarian to naturally adversarial personas
   - Department leads pre-summarize for waves of 7+

### Phase 6: Wire It Up

1. **CLAUDE.md** — Add the expert-review skill as a slash command:
   ```markdown
   - `/expert-review <topic>` — Consult expert panel
   ```

2. **Product context** — Ensure `.agents/product-marketing-context.md` exists and is current

3. **Memory** — Save audit defaults:
   - Always cover both engineering + UX perspectives
   - Focus on discovering issues, not validation
   - Set effort to max before running audits
   - Every fix needs tests

4. **Test with a small panel first** — Run a 3-expert review on a narrow topic to verify skills work, output format is followed, and synthesis is useful. Iterate on skill content before scaling up.

---

## Quality Markers of a Good Expert System

**Signs it's working:**
- Experts disagree with each other (means they have distinct perspectives)
- Findings are specific (file paths, line numbers, exact copy strings)
- Synthesis surfaces trade-offs, not just a list of approvals
- Personas say things the founder wouldn't have thought of
- Engineering experts find bugs that UX experts missed and vice versa

**Signs it needs work:**
- All experts give nearly identical APPROVED verdicts (phantom consensus)
- Findings are vague ("consider improving the UX")
- Experts drift into each other's domains (boundary violations)
- Personas sound like the founder, not like a real user
- No disagreements in the synthesis

---

## Scaling Guidelines

**Start small, expand based on need:**

| Project Stage | Recommended Skills | Total |
|--------------|-------------------|-------|
| MVP / Prototype | saas-engineer, ux-design-pro, security-expert, 1 domain expert, 1 persona | 5 |
| Pre-launch | + performance, copywriter, 2 CRO, legal, QA, 1 more persona | 12 |
| Growth | + metrics, growth, community, email lifecycle, accessibility | 17 |
| Mature | + market research, launch marketing, API, i18n, trust & safety | 22+ |

**Don't create skills you won't use.** Each skill is a maintenance burden — its product context references and file paths go stale. Better to have 10 well-maintained skills than 40 with outdated information.

---

## Anti-Patterns to Avoid

1. **Generic skills** — "UX Expert" is useless. "UX Expert for creative SaaS tools with image-heavy workflows" is useful. Always specialize to your domain.

2. **Skills without boundaries** — If an expert doesn't know what they DON'T cover, they'll drift into other experts' territory, creating confusion and duplicate findings.

3. **Personas without specifics** — "A typical user" is worthless. "Dana Reyes, 38, Portland, project manager, shoots a mirrorless camera on weekends" is a real person whose reactions you can predict.

4. **Orchestrator without routing rules** — If the expert-review skill doesn't have a routing table mapping question types to expert combinations, the panel selection becomes arbitrary.

5. **No required output format** — Without structured output, synthesis degrades to cherry-picking quotes. Every expert must use the same format.

6. **No contrarian** — Panels of 5+ without a designated devil's advocate produce phantom consensus. Assign the contrarian role to a naturally constructive expert (forcing them to find counter-arguments), not to one who already plays adversarial.
