# Department Directory

Full expert roster organized by department. Reference extracted from expert-review/SKILL.md (v2.8.3 progressive disclosure).

### Engineering (7 experts)

| Expert | Focus | When to Include |
|--------|-------|-----------------|
| **saas-engineer** | Full-stack implementation, deployment, billing, monitoring | Any feature build, infrastructure decision, integration question |
| **saas-architect** | System design, data flow, scaling, trade-offs | New features that touch multiple systems, database schema changes |
| **frontend-developer** | React/Next.js component architecture, hooks, server/client boundaries, base-ui, forms, state | Component refactoring, large client files, server vs client decisions, new UI primitives, form handling patterns |
| **performance-expert** | Core Web Vitals, bundle size, image optimization, caching | Page speed issues, new page designs, heavy component additions |
| **devops-deploy-expert** | CI/CD, Vercel config, environment management | Deployment changes, environment setup, pipeline modifications |
| **security-expert** | OWASP, auth, RLS, secrets, upload validation, rate limiting | Any user-facing feature, auth changes, new API endpoints, file uploads |
| **uncle-bob** | Code-design judgment — SOLID, named smells, Clean Architecture dependency rule, with anti-dogmatism guards | File audits >1500 LOC (god-class candidates), service decomposition, module-boundary placement, shared-helper accretion, refactor justification stress-test, design-coherence contrarian on saas-architect-led panels |

**How they interact:** saas-architect designs the system, frontend-developer architects the components, saas-engineer builds the backend, security-expert reviews, performance-expert validates speed, devops-deploy-expert ships it, uncle-bob applies SOLID + named-smell rubric to code-design judgment. On component architecture questions, start with frontend-developer + ux-design-pro. On infrastructure questions, start with architect + engineer. Add security for anything touching auth/data. Add frontend-developer when splitting large components or deciding server vs client boundaries. Add uncle-bob when the question is "should this large file decompose / is this abstraction premature / which smell is this" — pair him with saas-engineer for pragmatism check, not in isolation.

### Design & UX (4 experts)

| Expert | Focus | When to Include |
|--------|-------|-----------------|
| **ux-design-pro** | UX principles, component patterns, interaction design, accessibility | Any UI change, new feature UX, flow design |
| **web-designer** | Visual design, Tailwind, layout composition, dark mode, spacing | Page layouts, card design, visual polish, responsive design |
| **ux-copywriter** | Microcopy, button labels, error messages, empty states, tone | Any user-facing text, onboarding copy, error messages |
| **accessibility-expert** | Keyboard nav, screen readers, ARIA, reduced motion, color contrast | New interactive components, form design, modal/dialog additions |

**How they interact:** ux-design-pro sets the interaction pattern, web-designer implements the visual design, ux-copywriter writes the words, accessibility-expert validates inclusivity. For any UI feature, include at least ux-design-pro. Add web-designer for visual decisions. Add ux-copywriter when text matters. Add accessibility for interactive components.

### CRO — Haines Method (5 experts)

| Expert | Focus | When to Include |
|--------|-------|-----------------|
| **haines-page-cro** | Landing page conversion, hero copy, social proof, CTA placement | Landing page changes, marketing page design |
| **haines-signup-flow-cro** | Registration friction, form design, social login, trust signals | Signup flow changes, auth page design |
| **haines-onboarding-cro** | First-run experience, activation, time-to-value, progressive disclosure | Welcome flow, first critique experience, empty states |
| **haines-paywall-upgrade-cro** | Upgrade triggers, plan comparison, trial-to-paid, credit pack upsells | Pricing page, upgrade prompts, limit-hit experiences |
| **haines-churn-prevention** | Retention hooks, re-engagement, cancellation flow, win-back | Churn analysis, cancellation UX, engagement features |

**How they interact:** These cover the full conversion funnel in sequence: page-cro (awareness) -> signup-flow-cro (acquisition) -> onboarding-cro (activation) -> paywall-upgrade-cro (revenue) -> churn-prevention (retention). For funnel questions, include the relevant stage + one adjacent stage. For pricing/monetization, always include paywall-upgrade-cro + churn-prevention + saas-economist.

### Product & Business (7 experts)

| Expert | Focus | When to Include |
|--------|-------|-----------------|
| **saas-economist** | Pricing, margins, unit economics, LTV/CAC, credit systems | Pricing decisions, new plan features, cost analysis, monetization |
| **growth-analyst** | Growth loops, viral mechanics, activation metrics, experiments | Growth features, referral programs, engagement metrics |
| **saas-metrics-analyst** | KPI dashboards, cohort analysis, funnel metrics, data quality, schema design for analytics | Measurement strategy, success criteria, analytics setup, data modeling for aggregation fields, AI output schema decisions |
| **market-researcher** | Competitive analysis, market sizing, user research methods | Positioning decisions, new market entry, competitive response |
| **saas-launch-marketing** | Launch strategy, positioning, messaging, channel strategy | Launch planning, marketing page copy, campaign design |
| **user-researcher** | User interviews, feedback synthesis, beta programs, persona validation | Post-launch qualitative signal, beta testing, persona validation against real users |
| **ab-testing** | Experiment design, statistical significance, feature flags, low-traffic strategies | A/B test design, sample size calculation, result interpretation, PostHog feature flags |

**How they interact:** market-researcher provides the landscape, saas-economist models the business, saas-launch-marketing positions the product, growth-analyst designs the loops, saas-metrics-analyst measures the results, user-researcher validates with qualitative signal, ab-testing validates with experiments. For pricing questions, always include saas-economist. For launch decisions, include saas-launch-marketing + market-researcher. For a reach or channel plan, include saas-launch-marketing + growth-analyst. For experiment design, include ab-testing + growth-analyst. For post-launch user insight, include user-researcher.

### AI & Prompts (3 experts)

| Expert | Focus | When to Include |
|--------|-------|-----------------|
| **prompt-engineer** | System prompt design, structured outputs, vision prompting, hallucination reduction, token costs | Any AI prompt change, new AI feature, cost optimization, output quality |
| **ai-vision-expert** | Vision model capabilities/limits, image preprocessing, what models can/can't see, downscaling impact | Scoring calibration, deciding what data to feed vs. let model see, debugging AI vs. photographer disagreements, image pipeline design |
| **context-architect** | META-SYSTEM scope: LLM context-consumption physics, always-loaded rule-corpus structure, bands/digests/archives, delivery planes, dispatch tax | Memory-structure proposals, band/digest/scoping changes, always-loaded budget design, displacement program design |

**How they interact:** prompt-engineer designs the prompt structure and output schema. context-architect owns the META-system's memory architecture (how the fleet's own rules reach agents) — hand product-prompt questions to prompt-engineer and rules-delivery questions to context-architect. ai-vision-expert advises on what the model can perceive visually vs. what needs supplementary data. For critique quality issues, include both. For image pipeline decisions (what to compute, what to feed), include ai-vision-expert + prompt-engineer.

**Connections:** Works closely with saas-economist (token cost impact) and engagement-psychologist (critique tone).

### Content & Brand (2 experts)

| Expert | Focus | When to Include |
|--------|-------|-----------------|
| **seo-content-strategist** | SEO, metadata, structured data, content strategy, AI-citable content | New pages, metadata changes, content architecture |
| **brand-naming-expert** | Naming, brand identity, linguistic analysis, trademark awareness | Feature naming, product naming, marketing terminology |
**How they interact:** seo-content-strategist ensures discoverability, brand-naming-expert ensures memorability. For new features visible to the public, include seo-content-strategist. For naming decisions, include brand-naming-expert + ux-copywriter.

> **Note:** `newsletter-draft` is a content generation skill, not a consultation expert. Do NOT include it in `/expert-review` panels. Invoke it directly when drafting newsletter content.

### Legal (1 expert)

| Expert | Focus | When to Include |
|--------|-------|-----------------|
| **legal-advisor** | GDPR, privacy, terms, IP, content moderation, compliance | Privacy features, data handling, legal page changes, content policies |

**Connections:** Works closely with saas-economist (pricing and payment changes) and security-expert (data handling). For pricing/payment changes, include legal-advisor + saas-economist. Tax, VAT and merchant-of-record questions have no dedicated seat in this roster: route them to legal-advisor + saas-economist and name the gap in the synthesis.

### Operations (3 experts)

| Expert | Focus | When to Include |
|--------|-------|-----------------|
| **launch-ops-expert** | Launch checklists, go-live coordination, rollback plans, post-launch monitoring | Pre-launch reviews, deployment planning, incident response |
| **qa-expert** | Test strategy, edge cases, regression testing, cross-browser, accessibility testing | New features, refactors, pre-launch validation |
| **ops-monitor** | Production observability, Sentry alerting, error budgets, AI cost tracking, cron health, email deliverability | Monitoring setup, alerting design, production incidents, cost analysis |

**How they interact:** qa-expert validates before launch, launch-ops-expert coordinates the launch, ops-monitor ensures observability is in place. For pre-launch reviews, include all three + security-expert. For production incidents, start with ops-monitor + saas-engineer.

### Psychology (1 expert)

| Expert | Focus | When to Include |
|--------|-------|-----------------|
| **engagement-psychologist** | Behavioral design, motivation, habit loops, gamification, emotional design | Engagement features, retention mechanics, reward systems, critique tone |

**Connections:** Works closely with haines-onboarding-cro (activation), haines-churn-prevention (retention), and prompt-engineer (critique tone impact on engagement).

---

