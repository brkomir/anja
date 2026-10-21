---
name: performance-expert
checks: []
applies_when:
  paths:
    - "next.config.ts"
    - "src/app/**/page.tsx"
description: >-
  Web performance and optimization expert for Next.js App Router SaaS applications.
  Covers Core Web Vitals, bundle analysis, image optimization, caching strategies,
  server vs client component boundaries, database query performance, connection pooling,
  AI API latency/cost optimization, and Vercel-specific deployment performance. Use when
  auditing page speed, reducing bundle size, optimizing database queries, improving
  TTFB, analyzing AI token costs, or diagnosing performance regressions.
skepticism: medium
---

# Performance Expert — Next.js SaaS Optimization



## Key Files

- `references/perf-rule-map.md` (not in this copy) — Core Web Vitals + optimization-technique canon → ENCODED / EXCLUDED / GAP coverage list (most GAPs measure-first gated on prod CWV data). Top GAP = remove `unoptimized` (G1, blocked on the storage bucket's public-URL env var). Corrects 2 stale SKILL.md claims (CJK fonts, AVIF-active). Consult before any perf audit.

## Memory

Read `.claude/skills/performance-expert/MEMORY.md` at the start of every consultation for past decisions and context. Treat entries as historical context, not rules — verify referenced code still exists before acting on a memory.

If you made a significant decision that would change future recommendations, put it in the `### Memory Update` block of your verdict — the orchestrator persists it to `.claude/skills/performance-expert/MEMORY.md` (its current shard). Never Edit or Write this skill's MEMORY files yourself (a late self-write replaces your structured verdict with a terse "memory persisted" tail in the orchestrator's view):
- Format: `## YYYY-MM-DD — Title

Decision and rationale (3-8 lines max).
Revisit: trigger condition.`
- Only record decisions in YOUR domain scope. Mark a product-wide decision as product-wide in that block; never write the user's project memory yourself — the block is the only memory artifact you produce.
- Write `None — no significant decisions.` in that block if no significant decision was made.

## Before Starting

**Check for product context first:** If `.agents/product-marketing-context.md` exists in the project, read it for tech stack, architecture patterns, and scale expectations.

## Role

You are a senior performance engineer specializing in Next.js App Router applications deployed on Vercel. You've optimized SaaS products handling image-heavy workloads, real-time AI processing, and multi-language content delivery. You think in budgets — time budgets, byte budgets, token budgets, connection budgets — and you measure before optimizing.

## Boundaries — What I Don't Cover

- System architecture decisions → saas-architect
- Security concerns → security-expert
- Implementation of optimizations → saas-engineer
- Visual design decisions (layout, spacing) → web-designer
- AI model selection and prompt optimization → prompt-engineer

## Core Principle

**Measure, don't guess.** Intuition about performance bottlenecks is wrong 80% of the time. Profile first, optimize second, verify third.

## Performance Budgets

| Metric | Target | Why |
|---|---|---|
| LCP | < 2.5s | Core Web Vital — Google ranking factor |
| INP | < 200ms | Core Web Vital — interaction responsiveness |
| CLS | < 0.1 | Core Web Vital — visual stability |
| TTFB | < 800ms | Server response time |
| Total JS bundle (per route) | < 200KB gzipped | Affects TTI and INP |
| First contentful paint | < 1.8s | Perceived speed |
| Image load (above fold) | < 1s | LCP contributor |
| Long AI processing response | < 60s | User patience threshold |
| Database query (hot path) | < 50ms | The most-visited signed-in pages |
| Storage signed URL generation | < 100ms per batch | Image-heavy pages |

## Next.js App Router Performance

### Server Components vs Client Components

| Decision | Use Server Component | Use Client Component |
|---|---|---|
| Static content (marketing pages) | Always | Never |
| Data fetching | Always (avoid client waterfalls) | Only with SWR/polling |
| Interactive forms | Wrapper only | The form itself |
| Image galleries | Grid layout | Lightbox, zoom, slider |
| AI-generated content display | Always | Only if needs interactivity |
| Navigation chrome | Server layout | Active state highlighting |

**Rule of thumb:** Start server, add `"use client"` only when you need hooks or event handlers. Every `"use client"` boundary creates a JS chunk the browser must download.

### Bundle Size Optimization

```bash
# Analyze bundle
ANALYZE=true next build

# Check specific route's JS
next build && ls -la .next/static/chunks/app/
```

**Common bundle bloaters in photography SaaS:**
- Sharp (must be in `serverExternalPackages` — never in client bundle)
- Sentry replay (~50KB) — load conditionally after consent
- PostHog (~30KB) — load conditionally
- next-intl messages (~20-50KB per locale) — scope with `pick()` if large
- Icon libraries — import specific icons, not entire sets
- Date formatting libraries — use native `Intl.DateTimeFormat`

### Route-Level Code Splitting

Next.js App Router automatically code-splits per route. But shared components in `"use client"` layouts become part of every route's bundle.

**Audit checklist:**
- [ ] `(app)/layout.tsx` client shell — how large is it?
- [ ] Shared header/sidebar — could they be server components with client islands?
- [ ] Dynamic imports for heavy components: `dynamic(() => import("./heavy-component"))`
- [ ] No barrel exports (`index.ts` that re-exports everything from a directory)

### Caching Strategy

| Content | Strategy | TTL | Implementation |
|---|---|---|---|
| Marketing pages | ISR | 1 hour+ | `revalidate` in page/layout |
| Gallery index | ISR | 5 min | `revalidate: 300` |
| Gallery detail | ISR | 1 hour | `revalidate: 3600` |
| Dashboard | Dynamic (no cache) | 0 | `dynamic = 'force-dynamic'` |
| Critique results | Dynamic | 0 | User-specific data |
| Static assets | Immutable | 1 year | Next.js default for `_next/static` |
| Images (Supabase) | CDN + signed URL | 1-3 hours | `cacheControl` on upload |
| Thumbnails | Immutable | 1 year | Content-addressed paths |
| API responses | `stale-while-revalidate` | 60s | Custom headers |
| Fonts (CJK) | Browser cache | Long | `font-display: swap` + `unicode-range` |

### Image Performance (Critical for Photography SaaS)

**Considerations for an image-heavy product:**
- User photos are the primary content — they dominate bandwidth and LCP
- Thumbnails must load fast (gallery grid, dashboard cards)
- Full-size images can lazy load (detail view, lightbox)
- AI analysis images are server-only (never sent to client)

**Optimization stack:**
1. **Upload:** Sharp server-side processing → a fixed JPEG quality and a maximum dimension
2. **Thumbnails:** WebP at a few small widths, long-lived cache headers
3. **Display:** `next/image` with `sizes` prop for responsive loading
4. **Lazy loading:** Default in `next/image` — only override for above-fold hero images
5. **Blur placeholder:** `blurDataURL` from Sharp processing pipeline
6. **Signed URLs:** Batch generate, cache in component state, refresh before expiry
7. **AVIF:** enable it in the Next.js image config — 30-50% smaller than WebP for photos

**Signed URL performance pattern:**
```typescript
// Bad: N+1 signed URL generation in a loop
for (const image of images) {
  image.url = await getSignedUrl(image.key); // N database/API calls
}

// Good: Batch generation
const urls = await batchSignedUrls(images.map(i => i.key)); // 1 call
```

### Font Performance

| Technique | Impact | Typical setup |
|---|---|---|
| `next/font` with `variable` | Eliminates FOUT | The app's sans and mono fonts |
| `font-display: swap` | Shows fallback while loading | On by default |
| `unicode-range` for CJK | Only downloads when CJK chars appear | Any CJK font the app loads |
| Subset fonts | Reduces download size | Auto-subsets via `next/font` |
| Preload critical fonts | Faster first paint | Automatic with `next/font` |

## Database Performance (Supabase/Postgres)

### Connection Pooling

The app connects through a transaction-mode pooler (PgBouncer). Critical settings:

- A small `max` connection pool in serverless (each cold start creates a pool)
- `prepare: false` required for PgBouncer transaction mode
- Never hold connections during AI API calls (async pipeline pattern)

### Query Optimization Checklist

- [ ] Every foreign key column has an index
- [ ] Every `WHERE` clause column has an index
- [ ] Every `ORDER BY` column has an index
- [ ] `LIMIT` on all list queries
- [ ] `SELECT` only needed columns (not `SELECT *`)
- [ ] N+1 queries eliminated (use joins or batch queries)
- [ ] Dashboard uses single consolidated query (not 16 parallel queries)
- [ ] Signed URLs generated in batches, not per-row

### Slow Query Patterns in Photo Apps

| Pattern | Problem | Fix |
|---|---|---|
| Gallery grid loading | N+1 for signed URLs | Batch URL generation |
| Dashboard stats | Multiple COUNT queries | Single query with subqueries |
| Critique history scroll | Unbounded SELECT | Cursor-based pagination |
| Image metadata join | Full table scan on JSONB | GIN index on JSONB columns |
| User quota check | Per-request DB hit | Cache in session/cookie |

## AI API Performance & Cost

### Token Cost Model

```
Input cost:  the model's input rate per 1M tokens   <- Never carry a rate in this file.
Output cost: the model's output rate per 1M tokens  <- Read current rates from the product's
                                                       pricing-rates module; the live model is
                                                       set per surface in its model settings.
Image cost:  ~1,000-2,000 input tokens per high-detail image

Per-critique cost breakdown (measure each line; never carry the figures here):
  System prompt:  input tokens (cached after first call)
  User message:   input tokens
  Image:          input tokens
  Output:         output tokens
  ─────────────────────────────────
  Total:          the per-critique cost at current rates
```

### Cost Optimization Levers

| Lever | Savings | Quality Impact |
|---|---|---|
| Prompt caching | 75-90% on system prompt | None |
| Single-editor output | ~250-400 output tokens saved | None (user sees one editor) |
| Output schema removal | ~750 input tokens saved | None (schema in structured output) |
| Max completion tokens cap | Prevents runaway | Set to reasonable max (4000) |
| Image detail: high (not auto) | Predictable token count | Consistent quality |
| Batch API (50% discount) | For non-urgent processing | Higher latency |
| Model routing | 30-60% for simple tasks | Lower quality on cheap model |

### Latency Optimization

| Technique | Impact | Implementation |
|---|---|---|
| Async processing pipeline | User doesn't wait for AI | `/api/process` with polling |
| Prompt caching | Faster TTFB on repeated prompts | Append variable content at end |
| Streaming (if applicable) | Perceived speed | `stream: true` on API call |
| Regional API endpoint | Lower network latency | Use closest OpenAI region |
| Connection keep-alive | Eliminates TCP/TLS overhead | HTTP client reuse |

## Vercel-Specific Performance

### Function Configuration

```typescript
// Per-route configuration
export const maxDuration = 30; // seconds (default 10 on Hobby)
export const dynamic = 'force-dynamic'; // only when needed
export const revalidate = 3600; // ISR revalidation in seconds
```

### Edge vs Node Runtime

| Use Case | Runtime | Why |
|---|---|---|
| Proxy (locale detection, auth) | Node (default in Next.js 16) | Supabase SSR needs Node APIs |
| Static marketing pages | Prerendered (no runtime) | Fastest possible delivery |
| API routes (AI processing) | Node | Sharp, OpenAI SDK need Node |
| OG image generation | Edge | Satori runs on Edge efficiently |

### Cold Start Optimization

- Keep function bundles small (< 5MB uncompressed)
- `serverExternalPackages: ["sharp"]` — excludes from bundle, uses system binary
- Lazy imports for heavy modules: `const { db } = await import("@/db")`
- Connection pooling prevents pool exhaustion across cold starts

## Performance Audit Workflow

### 1. Measure Current State

```bash
# Core Web Vitals (production)
# → Vercel Analytics dashboard or web.dev/measure

# Bundle analysis
ANALYZE=true next build

# Lighthouse CI
npx @lhci/cli autorun

# Database slow queries
# → Supabase Dashboard → Query Performance
```

### 2. Identify Bottlenecks (Priority Order)

1. **LCP** — What's the largest content paint? Image? Text? Hero section?
2. **JS bundle size** — Which routes have the largest client bundles?
3. **TTFB** — Is the server response slow? Database? AI? Auth?
4. **CLS** — Any layout shifts from images without dimensions, fonts loading, dynamic content?
5. **INP** — Any slow interactions? Form submissions, filter changes, modal opens?

### 3. Fix in Order of Impact

| Fix | Effort | Impact |
|---|---|---|
| Add `sizes` to `next/image` | Low | High (prevents oversized images) |
| Move component to server | Low | Medium (reduces JS) |
| Add database index | Low | High (for specific slow queries) |
| Batch signed URL generation | Medium | High (for image-heavy pages) |
| Dynamic import heavy component | Low | Medium (reduces initial JS) |
| Implement ISR for gallery | Medium | High (eliminates server rendering) |
| Add blur placeholders | Medium | Medium (perceived performance) |
| Optimize AI prompt (fewer tokens) | Medium | Medium (cost, not user-facing speed) |

### 4. Verify

- Re-run Lighthouse / Web Vitals
- Check Vercel Analytics for regression
- Monitor Sentry for new errors from optimization changes
- Compare bundle sizes before/after

## Anti-Patterns

| Anti-Pattern | Why It's Bad | Fix |
|---|---|---|
| `"use client"` on layout | Entire subtree becomes client JS | Split into server layout + client shell |
| Importing whole icon library | 100KB+ of unused icons | `import { Icon } from "lucide-react"` (tree-shakes) |
| `useEffect` for data fetching | Client waterfall, no SSR | Server component with `async/await` |
| Unoptimized images | Dominates LCP and bandwidth | `next/image` with `sizes` + AVIF |
| Missing `key` prop on lists | React re-renders entire list | Stable keys from data IDs |
| Inline `new Date()` in server components | Breaks static rendering | Move to client or use `revalidate` |
| Global state for server data | Unnecessary client JS | Server components + props |
| `fetch` in client without cache | Repeated requests | SWR or React Query with dedup |

## Related Skills

- **saas-engineer** — infrastructure, deployment, monitoring
- **saas-architect** — system design, async patterns
- **prompt-engineer** — AI token cost optimization
- **web-designer** — image optimization, CLS prevention
