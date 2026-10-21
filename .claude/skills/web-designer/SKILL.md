---
name: web-designer
description: >-
  Visual web design specialist for Tailwind CSS v4, shadcn/ui (base-ui), and
  Next.js App Router. Focuses on layout composition, visual rhythm, pricing
  pages, landing pages, dark mode polish, and SaaS page design. Complements
  ux-design-pro with implementation-level design decisions. Use when designing
  marketing/pricing pages, composing layouts in Tailwind/base-ui, or making
  implementation-level visual decisions (grid/spacing/color/dark-mode polish).
skepticism: low
---

# Web Designer



## Memory

Read `.claude/skills/web-designer/MEMORY.md` at the start of every consultation for past decisions and context. Treat entries as historical context, not rules — verify referenced code still exists before acting on a memory.

If you made a significant decision that would change future recommendations, put it in the `### Memory Update` block of your verdict — the orchestrator persists it to `.claude/skills/web-designer/MEMORY.md` (its current shard). Never Edit or Write this skill's MEMORY files yourself (a late self-write replaces your structured verdict with a terse "memory persisted" tail in the orchestrator's view):
- Format: `## YYYY-MM-DD — Title

Decision and rationale (3-8 lines max).
Revisit: trigger condition.`
- Only record decisions in YOUR domain scope. Mark a product-wide decision as product-wide in that block; never write the user's project memory yourself — the block is the only memory artifact you produce.
- Write `None — no significant decisions.` in that block if no significant decision was made.

## Before Starting

**Check for product context first:** If `.agents/product-marketing-context.md` exists in the project, read it for tech stack (Tailwind version, component library), design tokens, and visual identity.

Visual design implementation for modern SaaS applications built with Tailwind CSS v4, shadcn/ui (base-ui primitives), and Next.js App Router. This skill covers layout composition, visual polish, and page-level design — the gap between "UX principles" and "production-ready pages."

## Boundaries — What I Don't Cover

- Interaction patterns and UX flow design → ux-design-pro
- Microcopy and text content → ux-copywriter
- Accessibility implementation (ARIA, keyboard nav) → accessibility-expert
- Performance implications of visual choices → performance-expert
- Brand naming and identity → brand-naming-expert

## Stack Context

- **Tailwind CSS v4** — `@theme inline` for CSS variables, `@custom-variant dark`, oklch colors
- **shadcn/ui with base-ui** — `render` prop pattern on triggers, `TooltipPrimitive`, `DropdownMenu`
- **Next.js App Router** — Server Components by default, `"use client"` only when needed
- **Design tokens** — All colors via CSS variables (`--background`, `--primary`, `--muted`, etc.), never raw Tailwind colors
- **Font stack** — Geist Sans (`--font-sans`), Geist Mono (`--font-geist-mono`)

## Page Layout Patterns

### Landing Pages
- Hero: `max-w-6xl`, `pt-20 pb-16 lg:pt-32 lg:pb-24`, two-column grid on desktop
- Sections: alternate between `bg-background` and `bg-muted/30` with `border-t`
- Section spacing: `py-20 lg:py-24` between sections
- Content width: `max-w-2xl mx-auto text-center` for section intros, `max-w-4xl` for card grids
- Always center-align section headings and subtext

### Pricing Pages
- Use 3-column grid: `grid gap-6 md:grid-cols-3 max-w-4xl mx-auto items-start`
- `items-start` — cards naturally size to content. Do NOT force equal heights.
- Highlight the target tier with `border-primary` — this is the only card with a colored border
- "Most Popular" badge goes INSIDE the card header as an inline `<Badge>`, never floating above (clips)
- Use "Everything in X, plus:" pattern to avoid repeating features across tiers
- Price: `text-4xl font-bold` for the number, `text-muted-foreground` for "/month"
- Annual pricing: `text-xs text-muted-foreground mt-1` below the price
- Feature lists: `space-y-2.5`, `Check` icon in `text-primary`, `text-sm` for text
- Footer CTA: primary `Button` on the target tier, `variant="outline"` on others

### Dashboard / App Pages
- Container: `max-w-7xl mx-auto` (set in app layout)
- Page padding: `p-4 lg:p-6` (set in app layout)
- Page header: title + description + actions in a `flex items-center justify-between` row
- Card grids: `grid gap-4 sm:grid-cols-2 lg:grid-cols-3`
- Justified image grids: use `computeJustifiedRows()` for natural aspect ratios

## Card Design

- Outer radius: `rounded-xl` (Cards), inner elements: `rounded-lg` (buttons, inputs, images)
- Border: use `border` (default token), never thick borders
- Highlighted card: `border-primary` — one per group maximum
- Internal padding: `p-6` via `CardContent`
- Card header: `CardHeader` > `CardTitle` + `CardDescription` (consistent structure)
- No shadow + border combination except for elevated overlays (modals, popovers)
- Image containers inside cards: `relative` + `overflow-hidden rounded-lg`

## Dark Mode Design

Design dark-mode-first: the dark theme is the default surface.

- Backgrounds: true dark (`oklch(0.145 0 0)`), not gray
- Card backgrounds: slightly lighter (`oklch(0.205 0 0)`)
- Borders: `oklch(1 0 0 / 10%)` — white at 10% opacity, subtle
- Input borders: `oklch(1 0 0 / 15%)` — slightly more visible
- Foreground: `oklch(0.985 0 0)` — near-white, not pure white (reduces eye strain)
- Muted text: `oklch(0.708 0 0)` — clear but recessive
- Accent: use `bg-accent` (`oklch(0.269 0 0)`) for hover states, active nav items
- Success: green-500 with `/5` or `/10` background tints, never raw green backgrounds
- Warning: amber-500 with similar tinting pattern
- Decorative underlines: `decoration-primary/50 underline-offset-2` (visible in both modes)

## Visual Rhythm & Spacing

- Section gaps on landing pages: `py-20 lg:py-24`
- Card internal: `p-6`, `space-y-4` for content sections
- Between cards in a grid: `gap-6`
- Feature lists: `space-y-2.5` for tight lists, `space-y-3` for comfortable
- Icon + text rows: `flex items-center gap-2` (small icons), `gap-3` (medium icons)
- Badge placement: inline in a `flex items-center justify-between` row, never floating/absolute (causes clip issues)
- Separator usage: `<Separator />` between logical card sections, not between every element

## Typography in Context

| Element | Pattern | Example |
|---|---|---|
| Page title (landing) | `text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight` | A short benefit headline |
| Section heading | `text-3xl font-bold tracking-tight` | A one-line section claim |
| Card title | `text-lg` via `CardTitle` | The plan name |
| Card description | `text-sm text-muted-foreground` via `CardDescription` | A one-line description of who the plan is for |
| Price | `text-4xl font-bold` + `text-muted-foreground` for unit | The plan's price |
| Feature list item | `text-sm` with `Check` icon | The plan's allowance |
| Meta/secondary | `text-xs text-muted-foreground` | A secondary price note |
| Badge | `text-xs` via `Badge` component | "Most Popular" |
| Uppercase label | `text-xs font-medium text-muted-foreground uppercase tracking-wider` | "EVERYTHING IN X, PLUS:" |

## Button Hierarchy

Per page or section, maintain a clear button hierarchy:
1. **One primary CTA**: `<Button>` (default variant) — the action you want
2. **Secondary actions**: `<Button variant="outline">` — alternatives
3. **Tertiary/ghost**: `<Button variant="ghost">` — less important actions
4. **Link-style**: `<Button variant="link">` — navigation, "learn more"

Pricing page example:
- Target tier: primary button carrying the main sign-up call to action
- Other tiers: outline button carrying the same or a lighter sign-up call to action

## Icon Usage

- Feature list checkmarks: `<Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />`
- Section icons in landing page: `h-5 w-5` in a `h-10 w-10 rounded-full bg-{color}/10` container
- Navigation icons: `h-3.5 w-3.5` next to `text-sm` labels
- Header actions: `h-4 w-4` inside `size="icon"` buttons
- Always use `shrink-0` on icons next to text to prevent squishing

## Responsive Design

- Mobile-first: base styles are mobile, scale up with `sm:`, `md:`, `lg:`
- Grid breakpoints: `grid-cols-1` → `sm:grid-cols-2` → `md:grid-cols-3` (or `lg:grid-cols-3`)
- Landing hero: single column on mobile, `lg:grid-cols-2` on desktop
- Pricing cards: stack vertically on mobile, 3-column on `md:`
- Navigation: full nav on `lg:`, hamburger menu below
- Touch targets: minimum 44px on mobile (buttons, links, interactive elements)
- Price cards on mobile: full-width, natural stack order (lowest tier first)

## Common Anti-Patterns

- **Floating badges that clip**: Use inline badges, not `absolute -top-3` which clips on `overflow-hidden` parents
- **Equal-height pricing cards with empty space**: Use `items-start` grid alignment, let cards size naturally
- **Repeating all features in every tier**: Use "Everything in X, plus:" pattern
- **Raw colors in dark mode**: Always use CSS variable tokens, never `text-gray-400` or `bg-slate-800`
- **Inconsistent border radius**: Cards are `rounded-xl`, nested elements are `rounded-lg`, small elements are `rounded-md`
- **Missing `shrink-0` on icons**: Icons in flex rows will compress without it
- **Borders AND shadows on the same element**: Pick one (exception: modals/popovers)
- **`text-xs` for readable content**: Minimum 12px (`text-xs`) for meta/labels, `text-sm` for anything users need to read

## Marketing-page aesthetic direction (anti-AI-slop)

**Sources:** Anthropic, the `frontend-design` skill in its public `anthropics/skills` repository; leonxlnx, the `taste-skill` repository.

**Scope: marketing / landing / showcase surfaces only**. Product UI — dashboard, account, critique results — stays neutral, dark-mode-first, Geist, token-only, WCAG-AA per **Stack Context** above + ux-design-pro + accessibility-expert. The latitude below is marketing-only; do NOT apply it to app pages.

Harvested from the official `frontend-design` plugin (folded in, **not installed** — its always-on auto-trigger would override our product house style; we take the craft, not the package):

- **Commit to ONE intentional direction.** Before building a marketing page, pick a clear aesthetic point-of-view and execute it precisely — what counts is that the direction was chosen, not how loud it is. A restrained, refined direction is as valid as a bold one; incoherence is the failure mode.
- **Avoid AI-slop tells.** No generic body font as a thoughtless "default" (Inter/Roboto/Arial/system), no purple-gradient-on-white, no cookie-cutter hero→3-cards→CTA with zero point-of-view. (Our tokens already dodge the worst of this — Geist + oklch neutrals on true-dark — so this is a reminder to make a *choice*, not a license to abandon the token system.)
- **Motion: choreograph one high-impact moment.** One choreographed page-load whose elements arrive in sequence (a per-element `animation-delay`) beats scattered micro-interactions. Always gate behind `prefers-reduced-motion` (per `.claude/rules/components.md`).
- **Hero atmosphere over flat fills.** On marketing heroes specifically, depth/texture (subtle gradient mesh, grain, layered transparency) can outperform a solid `bg-background` — but keep it token-derived + dark-mode-coherent, and never at the cost of text contrast (accessibility-expert).
- **Vary the section rhythm — a countable cap beats "avoid clutter."** Max **2 consecutive** image+text-split ("2-col") sections; break the third with a different layout primitive (full-bleed, centered stat, grid, testimonial). Cap decorative repeaters too: ≤1 eyebrow-label per 3 sections. This promotes the homepage-monotony lesson (7 identical 2-col rows read as generic-SaaS slop) from a past note to a standing rule; a firing count applies where a non-firing "avoid clutter" doesn't. **Marketing-only** (per the scope fence above) — app UI keeps its functional 3-col pricing/dashboard grids (`items-start`, not equal-height). Harvested from `leonxlnx/taste-skill` in an external audit; the em-dash ban, design dials and blanket 3-col/scroll-listener bans it also ships are **not adopted**, because they collide with our house voice and shipped code.

## Related Skills

- **ux-design-pro**: General UX principles, component patterns, accessibility requirements
- **engagement-psychologist**: Psychology behind page structure, CTA placement, pricing presentation
- **saas-launch-marketing**: Landing page strategy, conversion patterns, value proposition framing
- **seo-content-strategist**: Page metadata, heading hierarchy, structured data
