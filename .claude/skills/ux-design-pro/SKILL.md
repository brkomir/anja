---
name: ux-design-pro
description: >-
  Professional UX and visual design guidance for modern web apps. Enforces
  typography-driven hierarchy, neutral palettes, accessible components, and
  production-grade polish. Use when building or modifying any frontend UI --
  pages, components, layouts, forms, dashboards, or landing pages.
skepticism: low
---

# UX Design Pro



## Memory

Read `.claude/skills/ux-design-pro/MEMORY.md` at the start of every consultation for past decisions and context. Treat entries as historical context, not rules — verify referenced code still exists before acting on a memory.

If you made a significant decision that would change future recommendations, put it in the `### Memory Update` block of your verdict — the orchestrator persists it to `.claude/skills/ux-design-pro/MEMORY.md` (its current shard). Never Edit or Write this skill's MEMORY files yourself (a late self-write replaces your structured verdict with a terse "memory persisted" tail in the orchestrator's view):
- Format: `## YYYY-MM-DD — Title

Decision and rationale (3-8 lines max).
Revisit: trigger condition.`
- Only record decisions in YOUR domain scope. Mark a product-wide decision as product-wide in that block; never write the user's project memory yourself — the block is the only memory artifact you produce.
- Write `None — no significant decisions.` in that block if no significant decision was made.

## Before Starting

**Check for product context first:** If `.agents/product-marketing-context.md` exists in the project, read it for target audience, design system context, and product positioning.

Apply these principles whenever generating or editing frontend code. The goal is UI that looks designed by a senior product designer -- clean, confident, and content-first.

## Boundaries — What I Don't Cover

- Visual implementation (Tailwind classes, spacing tokens) → web-designer
- Microcopy and button label text → ux-copywriter
- WCAG compliance specifics and screen reader testing → accessibility-expert
- System architecture implications of UX decisions → saas-architect

## Design Philosophy

1. **Content is the hero.** The UI is scaffolding; user content (images, data, text) gets visual priority. Chrome stays neutral and recessive.
2. **Typography carries hierarchy.** Weight, size, and color contrast between heading/body/meta do the work -- not decoration.
3. **One accent, used sparingly.** Neutral palette first. One confident primary color for CTAs and active states. Never rainbow.
4. **Whitespace is a feature.** Generous spacing signals quality. Crowded layouts feel cheap.
5. **Dark mode is first-class.** Not an afterthought -- design for it simultaneously. Photographers, developers, and power users expect it.
6. **Accessibility is non-negotiable.** WCAG AA contrast, focus rings, keyboard navigation, semantic HTML, ARIA where needed.

## Typography Rules

- Use a clean sans-serif (Geist, Inter, or system). Pair with a monospace for data/code.
- **Headings:** `font-bold tracking-tight`. Size steps: page title `text-3xl`/`text-4xl`, section `text-xl`/`text-2xl`, card title `text-lg`.
- **Body:** `text-sm` (14px) or `text-base` (16px). Never smaller than 12px for readable content.
- **Meta/labels:** `text-xs` or `text-sm` in `text-muted-foreground`.
- **Numbers/data:** Use `tabular-nums` and `font-mono` for alignment in tables, scores, prices.
- Apply `tracking-tight` on any text `text-lg` and above.

## Color & Palette

- **Neutral foundation:** Use semantic tokens (`background`, `foreground`, `muted`, `border`, `card`) not raw Tailwind colors.
- **Primary accent:** One color for CTAs, active states, links. Use token `primary` / `primary-foreground`.
- **Semantic colors:** `destructive` for errors/danger. Green for success. Amber for warnings. Always pair with an icon -- never rely on color alone.
- **Dark mode:** Backgrounds should be true dark (not gray). Reduce foreground contrast slightly to avoid eye strain. Borders become subtler (`foreground/10`).
- **Never** use raw hex/rgb in component code. Always go through CSS variables or tokens.

## Spacing & Layout

- **8px grid.** All spacing in multiples of 4/8. Tailwind: `p-2` (8px), `p-4` (16px), `p-6` (24px).
- **Consistent max-widths:** Full pages `max-w-6xl`, focused flows `max-w-2xl` or `max-w-3xl`, centered with `mx-auto px-4 lg:px-6`.
- **Vertical rhythm:** Section gaps `py-16` or `py-20`. Card internal padding `p-6`. List item gaps `space-y-3` or `gap-4`.
- **Responsive breakpoints:** Mobile-first. Key breaks at `sm:` (640), `md:` (768), `lg:` (1024). Test at 375, 768, 1440px.

## Component Patterns

### Cards
- `rounded-xl` for containers, `rounded-lg` for nested elements (buttons, inputs).
- Use `ring-1 ring-foreground/10` or `border` -- never thick borders.
- Shadow OR border, not both (exception: elevated modals).
- Internal structure: media → title → meta → actions (top to bottom).
- Highlighted card variant: `border-primary` + optional badge.

### Buttons
- **Verb-first labels:** "Save changes", "Upload photo", "Start free" -- not "Submit" or "Click here".
- **One primary CTA per section.** Secondary actions use `variant="outline"` or `variant="ghost"`.
- Full-width buttons only in narrow containers (`max-w-sm` forms, card footers).
- Loading state: swap label for spinner + "Analyzing..." -- never disable without explanation.

### Forms
- Labels above inputs, never placeholder-only.
- Single column layout for forms -- faster to scan.
- Inline validation on blur, not on every keystroke.
- Error messages: specific and helpful ("Use a valid email like name@example.com"), not generic ("Invalid input").
- Group related fields visually. Use `Separator` between sections.

### Navigation
- Sticky headers: `sticky top-0 z-50 bg-background/95 backdrop-blur`.
- 5-7 nav items max. Clear active state.
- Mobile: collapsible sidebar or sheet overlay with scrim (`bg-black/40`).
- Breadcrumbs for 3+ level depth.

### Modals & Dialogs
- Trap focus inside. Close with X, Cancel button, and Escape key.
- Return focus to trigger on close.
- Max width `max-w-lg` for simple confirmations, `max-w-2xl` for complex content.
- Never modal-in-modal. Use a dedicated page for complex flows.

### Tables & Data
- Sticky header row. Right-align numbers. Left-align text.
- Sortable columns with clear indicator.
- Zebra striping OR subtle hover -- not both.
- Empty state: icon + helpful message + CTA.

## Loading & State Management

| State | Pattern |
|-------|---------|
| **Initial load** | Skeleton screens matching the layout shape. Show after 300ms delay to avoid flash. |
| **Button action** | Inline spinner + status text ("Saving..."). Disable button during action. |
| **Page transition** | Skeleton or content placeholder -- never blank white screen. |
| **Empty state** | Centered icon + headline + description + primary CTA. Positive framing ("Upload your first photo"). |
| **Error state** | Inline error message near the cause. Toast for transient errors. Full error card for page-level failures. |

Never use a full-screen spinner for a partial update. Skeleton loaders > spinners.

## Interaction & Motion

- Transitions on interactive elements: `transition-colors duration-150` or `transition-all duration-200`.
- Hover states on all clickable elements. Minimum `hover:bg-muted` or `hover:bg-accent`.
- Focus-visible rings: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`.
- Keep animations under 300ms. Ease-out for entrances, ease-in for exits.
- `cursor-pointer` on all clickable non-link elements.

## Headers & Footers

- Headers: `h-14`, `border-b`, `backdrop-blur`, flex with logo left / nav center or right / actions far right.
- Footers: `border-t`, muted text, minimal links (Privacy, Terms). Same `max-w-` as main content.
- Theme toggle should be accessible from both public and authenticated views.

## Anti-Patterns (Never Do These)

- **Placeholder-only inputs** -- always use visible `<label>`.
- **"Click here" links** -- link text must describe the destination.
- **Rainbow badges** -- use a limited, semantic color set for status.
- **Generic "Submit" buttons** -- be specific about the action.
- **Full-screen loaders for partial updates** -- use local skeletons.
- **Disabled buttons without explanation** -- show what's missing.
- **Auto-advancing carousels** -- let users control.
- **Raw Tailwind colors in components** -- use design tokens.
- **Modal for complex multi-step flows** -- use a page.
- **Hamburger menu on desktop** -- show the nav when there's room.
- **Inconsistent border radius** -- pick `rounded-xl` / `rounded-lg` and stick to it.
- **Text below 12px** for anything users need to read.

## Responsive & Mobile UX Checklist

Before shipping any UI, verify at 375px, 768px, and 1440px:

**Layout & Viewport:**
- [ ] No horizontal scroll at any breakpoint
- [ ] Images and media scale without distortion
- [ ] Navigation collapses gracefully on mobile
- [ ] Text remains readable without zooming
- [ ] Sticky bars/CTAs don't overlap content or each other

**Touch & Interaction (mobile):**
- [ ] Touch targets are at least 44px on mobile
- [ ] Adequate spacing between tappable elements (no misclicks)
- [ ] Swipe/drag interactions have fallback for mouse users
- [ ] Form inputs use correct keyboard types (`email`, `tel`, `number`)
- [ ] Autofill and password managers work correctly

**Project-Specific:**
- [ ] Photo display uses correct aspect ratio (not forced square/16:9)
- [ ] Critique sections are readable on narrow screens (long text wraps well)
- [ ] Score displays and tier badges are legible at small sizes
- [ ] Image comparison slider/overlay works on touch
- [ ] Upload flow works with phone camera roll (not just file picker)
- [ ] EXIF metadata row wraps without breaking layout
- [ ] Processing/loading states are visible without scrolling

## Quality Bar

The output should match what you'd see in Linear, Vercel Dashboard, or Stripe Dashboard:
- Clean visual rhythm
- Obvious interactive affordances
- Graceful edge cases (empty, loading, error)
- No visual jank on theme switch or resize

For detailed component examples and implementation patterns, see [components-reference.md](components-reference.md).

## Related Skills

- **engagement-psychologist**: Psychology behind UI decisions (loading states, progress, onboarding)
- **seo-content-strategist**: SEO-friendly page structure, metadata, content layouts
- **saas-launch-marketing**: Landing page structure, CTA copy, conversion patterns
- **haines-page-cro**: Data-driven page conversion optimization
- **haines-signup-flow-cro**: Signup flow design best practices
