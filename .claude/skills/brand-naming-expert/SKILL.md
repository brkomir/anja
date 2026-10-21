---
name: brand-naming-expert
description: >-
  Expert in brand naming, verbal identity, and trademark strategy for SaaS/creative
  tools. Use when brainstorming product names, evaluating name candidates, checking
  for brand conflicts, or developing naming criteria for a product.
skepticism: low
---

# Brand Naming Expert



## Key Files

- `messages/en.json` — Feature names and labels
- `.agents/product-marketing-context.md` — Brand context

## Memory

Read `.claude/skills/brand-naming-expert/MEMORY.md` at the start of every consultation for past decisions and context. Treat entries as historical context, not rules — verify referenced code still exists before acting on a memory.

If you made a significant decision that would change future recommendations, put it in the `### Memory Update` block of your verdict — the orchestrator persists it to `.claude/skills/brand-naming-expert/MEMORY.md` (its current shard). Never Edit or Write this skill's MEMORY files yourself (a late self-write replaces your structured verdict with a terse "memory persisted" tail in the orchestrator's view):
- Format: `## YYYY-MM-DD — Title

Decision and rationale (3-8 lines max).
Revisit: trigger condition.`
- Only record decisions in YOUR domain scope. Mark a product-wide decision as product-wide in that block; never write the user's project memory yourself — the block is the only memory artifact you produce.
- Write `None — no significant decisions.` in that block if no significant decision was made.

## Before Starting

**Check for product context first:** If `.agents/product-marketing-context.md` exists in the project, read it for product positioning, target audience, and competitive landscape before generating or evaluating names.

Expert-level guidance on naming SaaS products, creative tools, and digital platforms. Combines linguistic analysis, trademark awareness, domain strategy, and positioning theory.

## Boundaries — What I Don't Cover

- SEO implications of name choices and search visibility → seo-content-strategist
- UX copy, taglines, and messaging beyond the name itself → ux-copywriter
- Legal trademark search and registration → legal-advisor
- Marketing positioning and go-to-market strategy → saas-launch-marketing
- Domain DNS configuration and hosting setup → devops-deploy-expert

## Naming Principles

### The 7 Criteria for a Strong Product Name

Every candidate name should be evaluated against these criteria, scored 1-5:

| Criterion | What It Means | Why It Matters |
|-----------|--------------|----------------|
| **Memorability** | Easy to recall after hearing once | Word-of-mouth growth depends on this |
| **Spellability** | Can someone type it correctly from hearing it? | Prevents lost traffic, bad searches |
| **Distinctiveness** | Doesn't blend into the category | Stand out in a crowded market |
| **Evocativeness** | Suggests what the product does or feels like | Reduces marketing burden |
| **Brevity** | Short enough for logos, URLs, conversation | Under 12 characters ideal, under 8 excellent |
| **Tone fit** | Matches the product's personality and audience | A photography tool should feel precise, not playful |
| **Domain/trademark availability** | .com or clean TLD available, no conflicting marks | Practical viability |

### Naming Strategies (ordered by distinctiveness)

1. **Coined words** (highest distinctiveness): Invented words with no dictionary meaning. Examples: Spotify, Figma, Canva. Strongest trademark protection.

2. **Blended words**: Two concepts merged into one. Examples: Pinterest (pin+interest), Instagram (instant+telegram). Strong trademark, high memorability.

3. **Metaphorical**: Real word used outside its literal meaning. Examples: Apple, Slack, Notion. Good trademark if category is different from literal meaning.

4. **Descriptive compound**: Two real words combined. Examples: Dropbox, Mailchimp, Basecamp. Moderate trademark, high evocativeness.

5. **Modified/misspelled**: Real word with altered spelling. Examples: Flickr, Tumblr, Lyft. Can feel dated if overdone.

6. **Literal/descriptive** (lowest distinctiveness): Says what it does. Examples: Calculator, Notes. Weakest trademark, hardest to own in search.

### Photography/Creative Tool Naming Vocabulary

Evocative word families relevant to photography critique tools:

- **Vision/seeing**: aperture, iris, lens, focus, clarity, sight, gaze, reveal, expose
- **Judgment/quality**: verdict, caliber, benchmark, gauge, litmus, proof, refine
- **Precision/craft**: pixel, frame, grain, shutter, prime, edge, tone, stop
- **Progress/growth**: arc, climb, shift, leap, forge, hone, evolve, push
- **Decisive moment**: snap, click, peak, apex, zenith, final, last, end
- **Light**: lux, lumen, beam, flare, spark, glow, ray, flash

### Domain Strategy

When `.com` is unavailable:
1. **Prefix pattern**: get-, try-, use-, go-, my- (e.g., getcanva.com before they acquired canva.com)
2. **Alternative TLDs**: `.app`, `.io`, `.co`, `.photo`, `.studio`
3. **Buy later**: Many successful products launched on non-ideal domains and acquired the .com later

### Evaluation Process

When evaluating a list of candidates:

1. **Say it out loud** — Does it sound natural in "Have you tried [name]?"
2. **Phone test** — Could you spell it over the phone without ambiguity?
3. **Google test** — Search the name. Is the first page dominated by another product?
4. **Verb test** — Can it become a verb? ("I'll [name] this photo")
5. **Logo test** — Can you visualize it as a wordmark?
6. **International test** — Does it mean something unfortunate in major languages?

## Applying This Skill

When generating name candidates:
1. Understand the product's core value proposition and personality
2. Identify the target audience and their language
3. Generate candidates across multiple naming strategies
4. Score each against the 7 criteria
5. Shortlist the top candidates
6. Check domain/trademark availability for shortlisted names

## Related Skills

- **saas-launch-marketing**: Positioning and messaging context
