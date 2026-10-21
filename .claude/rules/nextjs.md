---
paths: ["src/app/**", "next.config.ts", "src/proxy.ts"]
---

# Next.js App Router Rules

⛔ **PATH-SCOPED — NOT always-loaded (2026-08-18).** It loads when you read a file under
`src/app/**`, or `next.config.ts` / `src/proxy.ts`. **About to add a route, a layout, a metadata
image, or touch locale rewrites? READ THIS FILE FIRST** — on a fresh session it is absent until you
read a matching file, and the vendor spec says a compaction does NOT re-inject it. ⚠️ This body
text is the only channel that can say so — frontmatter and block-level HTML comments are stripped
before injection; `CLAUDE.md`'s router is the only always-loaded carrier.

⚠️ **THE GLOB NEEDS ALL THREE PATTERNS AND THAT IS NOT COSMETIC.** The locale-rewrite rules bind to
`next.config.ts` and `src/proxy.ts`, both at the REPO ROOT — a `src/app/**`-only glob would leave
this file absent for exactly the edit its sharpest rule governs. Any future rule here that binds to
a fourth root file must extend the glob in the same change.

**Why this was judged scopable at all, measured.** A `paths:` glob fires on a READ, so scoping is
unsafe where work starts by CREATING a file — and `src/app` is **27% file-ADDS** over 400 commits,
the highest of the `src/` surfaces (against the database-migrations directory at 95%, the genuine
creation-first case). What makes it acceptable is that the worst first-touch miss is
CI-backstopped: *"a NEW top-level `[locale]` route needs TWO `beforeFiles` entries or its bare URL
404s"* is caught at birth by a rewrite-coverage sentinel test that fails CI (verified present).
⛔ **If that sentinel is ever deleted or weakened, re-open this scoping** — it is the only thing
standing between a cold route-creation and a silent 404, since the file's own text says tsc, unit
and i18n are all blind to it.

**CRITICAL: This project uses Next.js 16+ with breaking changes. ALWAYS read `node_modules/next/dist/docs/` before using any API you're unsure about.**

Every rule here is a way the framework silently does NOTHING: a cache directive that governs nothing, a rewrite that never fires, a `Response` React drops on the floor, a binary the tracer never packs. `tsc`, unit, i18n and `next build` are green for all of them; the request 404s or 500s in prod.

Incident records (dates, shas, flow numbers, deploy post-mortems) live in a separate archive file — not always-loaded, **not doctrine**; where it disagrees with this file, this file wins.

**Appending here.** A new trap is ONE `###` rule in the matching section — DIRECTIVE HEADING + the TELL + the fix — in one to three sentences, 150-400 bytes; its incident record goes to the archive. **A correction REPLACES the rule's sentence; it never appends a paragraph beneath it.**

## SERVER VS CLIENT COMPONENTS

- Default to Server Components. Add `"use client"` only for hooks, event handlers or browser APIs.
- Server Components can `async/await` directly. Client Components cannot.
- `useSearchParams()` requires a `<Suspense>` boundary — wrap it in a thin server-component shell.
- Route segment config (`maxDuration`, `dynamic`) exports ONLY from a Server Component or Route Handler, never a `"use client"` page. Use a `layout.tsx` wrapper.

## DATA FETCHING

- Mutations use server actions (`"use server"`), not API routes.
- Server actions live in `src/actions/`, one file per domain (critique.ts, gallery.ts, account.ts).
- `getAuthUserId()` is the FIRST line of every server action. Never trust client input for auth.
- Include `userId` in every mutation WHERE clause — defense in depth alongside RLS.

## ROUTE HANDLERS, CACHING & METADATA IMAGES

### `export const revalidate` IS INERT ON A DYNAMIC GET ROUTE HANDLER — SET `Cache-Control: s-maxage=...` ON THE `Response`

A `route.ts` reading the request (headers/cookies/searchParams) is ALREADY dynamic, so `revalidate` governs nothing: it binds the full-route render and the `fetch` cache, never a handler's response.

### THE SAME INERTNESS ON AN `opengraph-image.tsx` / `icon.tsx` METADATA-IMAGE ROUTE

A `next/og` route returns its `ImageResponse` verbatim, so `revalidate` governs nothing there either — doubly so when it reads `headers()`/`cookies()` (locale/UA ⇒ already dynamic). The social-share preview TTL lives platform-side in the scraper, unreachable from here.

### VERIFY THE ROUTE IS DYNAMIC BEFORE ACCEPTING ANY FINDING BUILT ON A `revalidate` CONSTANT

Reviewer trap: a DEAD `revalidate` reads as LIVE to a security/perf lens grepping for cache amplification — it produced a false "24h amplification" serious finding on the share-OG endpoints. The constant's presence says nothing; the route's dynamism decides.

### PASS THE LOCALE EXPLICITLY INSIDE `ImageResponse` — NOTHING THROWS, SO A WRONG-LOCALE RENDER LOOKS LIKE A WORKING ONE (scope-corrected 2026-08-27, heading re-corrected 2026-08-28)

⛔ **`[locale]` OG ROUTES CAN LOCALIZE — USE THE EXPLICIT-LOCALE OBJECT FORM.** `getLocale()` and a bare `getTranslations("NS")` have no request-locale scope in a `next/og` route and do NOT throw: they fall through to `routing.defaultLocale` (a crawler has no locale cookie), so every non-English card renders in English with no error. The form that works INJECTS the locale — `const { locale } = await params; const t = await getTranslations({ locale, namespace: "NS" })`, rendered INSIDE the `ImageResponse`. ⚠️ A `setRequestLocale` line is DEAD WEIGHT in a metadata-image route; do not copy one in. `export const alt` must be static, so it stays English on every such route — not evidence against this rule. **Re-derive fix-state from `params`, never from prose:** `for f in $(find src/app -name opengraph-image.tsx); do grep -oE 'params: Promise<\{[^}]*\}>' "$f"; done` (at 2026-08-31: `learn/[slug]` untouched; one public route PARTIAL — 1 of its 3 render exits localizes, its `fallback()` emits English and takes no arguments, and that fallback is the route's security-gate card). ⛔ **DO NOT SIZE THIS IN WIRING LINES (3) — THE COST IS THE LITERALS** (8 sites / 5 keys / 3 new × 12 locales for two routes); count literals per route. **A route OUTSIDE `[locale]`** (`s/[token]`, `compare/s/`, `curate/s/`, `progress/s/`, `before-after/s/`, `demo/[token]`) has no locale segment, so there the `NEXT_LOCALE` cookie or an in-file table genuinely is the fallback — check which side of the boundary your route sits on before reaching for an English literal. ⛔ **NO CATCHING LAYER EXISTS — THE CHECK IS MANUAL:** the OG smoke test asserts only `instanceof Response` + content-type, so an all-English render PASSES; unit suite and `next build` are blind too. A real layer must render under a NON-DEFAULT locale and assert the text differs from the English. Three wrong versions of this paragraph preceded this one (2026-08-27→31); the "cannot localize" sentence had licensed every `[locale]` OG route to stay English.

### FIX A METADATA-IMAGE `[locale]` 404 AT THE PROXY'S STRIP BRANCH, NEVER A `config.matcher` EXCLUSION

Next derives the URL relative to the rendering segment (`og:image = /en/opengraph-image-<hash>`); under `localePrefix:"as-needed"` the default-locale strip in `src/proxy.ts` 301s `/en` away, the hashed path matches no route, and it **404**s — non-default locales aren't stripped, so only EN breaks. Guard the strip branch with `isMetadataImagePath()` (trailing `opengraph-image`/`twitter-image`/`icon`/`apple-icon`, hash suffix optional). A `config.matcher` exclusion is WRONG: the same shape also matches API routes ending in the same segment, which then skip the proxy and every gate it applies; anchoring the regex cannot fix that, so test any matcher change with an empirical `node` regex run. The strip branch sits AFTER the proxy's gates, so a false match there is only a cosmetic missed strip.

### AN `after()`-BOUNDED DELAY RUNS IN THE **CALLER'S** `maxDuration`, NOT THE ROUTE IT POSTs TO

Upload server actions are `maxDuration=60` while `/api/process` is 540s, so a backoff `setTimeout` inside a CALLER's `after()` must stay under ~45-55s — past that the function dies first, the re-dispatch silently never fires, and the cron backstop absorbs it (Next `after.md` § Duration). A re-dispatch that needs a longer wait belongs INSIDE `/api/process`'s own `after()`, for exactly this reason. **Fake-timer unit tests are BLIND** (no function-lifetime ceiling); only route-level reasoning or a builder≠breaker `--code` catches it. Carve: `v1/progress/insight` keeps 75s — a synchronous public API whose client honors `Retry-After` on its own clock.

### A `page.tsx` NEVER RETURNS A `Response` — RENDER A NOTICE COMPONENT

React cannot render a `Response` as a child, so `return new Response(...)` on a rate-limit/gate/error branch falls to the error boundary and the visitor gets a generic error page. Render a sync notice instead (`<RateLimitNotice>`, mirroring the page's existing 410 / `shareUnavailable` handling). A `route.ts` HANDLER legitimately returns `Response`; a Page renders a component. tsc/unit are BLIND — jsdom cannot run the RSC branch.

## LOCALE ROUTING & REWRITES

### A NEW TOP-LEVEL `[locale]` ROUTE NEEDS **TWO** `beforeFiles` ENTRIES OR ITS BARE URL 404s

The bare → `/en/*` mapping is a HARDCODED per-route list in `next.config.ts` `rewrites().beforeFiles`, NOT the proxy (which only detects the locale and runs the `/en` strip). Without an entry bare `/newroute` never rewrites, and `/en/newroute` 301s to the same 404. Add BOTH `{source:"/x",…}` and `{source:"/x/:path*",…}` when the route has children. **tsc/unit/i18n are ALL BLIND — that is the trap:** zero type errors, green suites, every request 404s. A rewrite-coverage sentinel test fails CI at birth; still `curl localhost:3000/<path>`, because the sentinel proves the rewrite EXISTS, never that the page RENDERS.

### A ROUTE **MOVED INTO** `[locale]` MUST ALSO LEAVE `NON_LOCALE_PREFIXES` — SAME CHANGE

An entry in `src/proxy.ts` `NON_LOCALE_PREFIXES` skips locale routing entirely, so the route stays reachable and never localizes — the failure is silent English, not a 404. A move is `beforeFiles` ADD **and** `NON_LOCALE_PREFIXES` REMOVE, together.

### ONLY **NEW TOP-LEVEL SEGMENTS** NEED A REWRITE ENTRY — `/x/:path*` ALREADY COVERS CHILDREN

A child route under an existing wildcard (`/learn/:path*`) needs nothing, which is why the rewrite-coverage sentinel is top-level-keyed. Reading the rule the other way once inflated a brief's cost premise.

### KEEP STATIC `public/` ASSETS OUTSIDE EVERY `beforeFiles` `source` PREFIX

`beforeFiles` runs BEFORE the `public/` filesystem lookup, so `/learn/:path* → /en/learn/:path*` also captures `/learn/foo.webp`, rewrites it into the `[slug]` route and **404**s it — the `_next/image` optimizer 404s too. `/images/*` is the safe namespace; NEVER nest an asset dir under a `:path*`-rewritten path.

### RE-DERIVE THE ROBOTS MATCH FOR A NEW CHILD URL — A `$`-ANCHORED `Allow` EXCLUDES CHILDREN

`src/app/robots.ts` deliberately mixes anchored (`Allow: /learn$`) and unanchored allow-forms, so a new child route under a partially-allowed tree is silently Disallowed while the sitemap advertises it. Robots is longest-match-wins: compute the match for the child's EXACT URL. The contradiction surfaced via a crawl-content cross-check, never a test.

## BUILD & DEV-SERVER CACHES — LIVE-ONLY FAILURES

### `rm -rf .next && npm run build` BEFORE TRUSTING ANY BUILD ERROR AFTER A MERGE / `npm ci` / DEP BUMP

The first build after a `git merge`, `npm ci` or dep bump can run against a leftover `.next` and throw a misleading `ENOENT` mid-"Collecting page data" (e.g. `_clientMiddlewareManifest.js`) **even though it reported `✓ Compiled successfully`** — exit 0, so the failure hides behind a green compile. A clean rebuild is ENOENT-free.

### A BUILD THAT DIES IN **EMISSION**, NOT COMPILATION: `ls -la node_modules/node_modules`

A self-referential `node_modules/node_modules -> <repo>/node_modules` kills Turbopack at output emission (`'node_modules/node_modules' is a symlink causes that causes an infinite loop!`, through `read_glob` → `NftJsonAsset` → `emit_assets`) and is invisible to every content gate. Sibling of the rule above in diagnosis, OPPOSITE in remedy: the loop is in the module tree, so deleting `.next` does nothing and a clean rebuild reproduces it exactly. `readlink` to confirm it is genuinely self-referential, then remove — `node_modules` is gitignored, so removal is free and `npm install` restores anything legitimate. ⚠️ **SCOPE — LOCAL-ONLY:** Vercel's fresh checkout never has it and the DEPLOY is not at risk; what it breaks is LOCAL VERIFICATION, the only gate this repo has before a push.

### PROVE A `/public` ASSET SWAP WITH A **URL CHANGE** — THE DEV `next/image` CACHE IS KEYED (URL, width) IN MEMORY

Overwriting an asset at the SAME path keeps serving stale optimized bytes for every width the browser already requested; the swap does not invalidate it, and a `curl ...?w=<N>` at an un-requested width false-positives "it's fixed". Rename (`name.webp` → `name-v2.webp`): it cache-misses every width, so it is the fix AND the proof. Dev-server class, live-request-only.

### REGISTER A NEW BUILD-OUTPUT DIR IN EVERY TOOL THAT WALKS THE TREE

Enumerate by "every tool that walks the tree", never "the file I remembered": `.gitignore`, the `tsconfig.json` **`include`** globs (`<dir>/types/**/*.ts` + `<dir>/dev/types/**/*.ts` — `include`, NOT `exclude`), `eslint.config.mjs` `globalIgnores`, plus knip/prettier where configured. The eslint miss alone produced 7,159 local-only errors invisible to clean-checkout CI, and **an always-noisy gate is a disabled gate**. The dir exists because a prod build into a bare `.next` DELETES files a live dev Turbopack cache references and the dev server panics — so every build entry point sets its own `distDir` via `NEXT_DIST_DIR`.

### A GENERAL MECHANISM WIRED AT 1-OF-N SITES READS AS SHIPPED — COUNT THE SITES

The `distDir` env-switch had 4 call sites and 3 were found by 3 different sessions, each seeing the mechanism present and assuming it was done. Grep the full site set and ask "deliberate scope or oversight?" before treating a mechanism as shipped.

## METADATA

- Every public page exports `metadata` or `generateMetadata` with title, description, OG and `alternates.canonical`.
- Dynamic pages (gallery/[id], photographer/[id]) need server-side `generateMetadata` — extract the client component to a separate file.
- Use the root layout's `title.template` (`%s | <product-name>`); don't repeat the product name in page titles.

## FILE CONVENTIONS

`page.tsx` route entry · `layout.tsx` shared layout (and the home for `maxDuration` on client page routes) · `client.tsx` client component extracted from a server page (for `generateMetadata` compatibility) · `loading.tsx` streaming skeleton · `error.tsx` error boundary · `opengraph-image.tsx` dynamic OG image (edge runtime).

## LAYOUT NESTING & PER-ROUTE CHROME

### A CHILD `layout.tsx` CANNOT UN-WRAP A PARENT'S WRAPPER — BRANCH ON `pathname` INSIDE THE SHARED SHELL

`(app)/layout.tsx` renders `<AppShell>{children}</AppShell>` around ALL descendants, so a nested `projects/[id]/reference/layout.tsx` renders INSIDE it and cannot remove the shell's `flex h-screen overflow-hidden` clamp or the global nav. To give ONE route different chrome (a standalone / print document), branch on `pathname` inside the shared shell component — the `/welcome` bare-main precedent. A `useEffect` declared ABOVE the early return STILL fires (hooks run before the conditional return), so session-watcher/auth invariants survive; re-inject any RENDERED chrome (verifyBanner) explicitly and pad it to the content column (`max-w-2xl mx-auto px-6`) or it renders full-bleed. A 3rd such branch → extract a `STANDALONE_DOCUMENT_ROUTES` matcher (Rule of Three), don't stack a 3rd inline `if`.

## NATIVE DEPENDENCIES & LINT — THE RUNTIME-ONLY P0 CLASS

### TRACE A NATIVE DEP **AND EVERY SIBLING NATIVE PACKAGE** INTO THE DEPLOYED FUNCTION

`serverExternalPackages` plus a green `next build` do NOT bundle a `.so`/`.node`. Any native dep (`sharp`, `canvas`, `bcrypt`, `@napi-rs/*`) needs `outputFileTracingIncludes` in `next.config.ts` under the `"/**"` key — and the SIBLINGS are what gets missed: sharp 0.35's `.so` sits in separate packages reached by a runtime-computed `dlopen` path the static tracer cannot follow, so the live fix is THREE globs — `node_modules/sharp`, `node_modules/@img/sharp-linux-x64`, `node_modules/@img/sharp-libvips-linux-x64`, each `/**/*`. READ that block rather than retyping it: the linux packages are absent from a macOS tree, so the globs are inert locally and bite only on the deployment platform.

### A TRACING MISS IS INVISIBLE LOCALLY — REASON ABOUT THE DEPLOYED FUNCTION, NOT THE HOST

Local dev, `next build`, `tsc`, unit and integration ALL pass, because the host has the `.so`. On Vercel the bundle lacks it and every route touching the dep at module scope 500s at request time with `ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.3: cannot open shared object file`.

### TREAT THE FIRST PROD DEPLOY AFTER ANY NATIVE-DEP CHANGE AS A BOUNDARY-EXERCISE EVENT

A deploy freeze HIDES the regression until the first prod deploy that actually ships the dep — which is how a re-added `sharp` took the ENTIRE product down (uploads, all 4 AI pipelines, OG rendering) 8 days after the commit that caused it. Confirm the binary loads on the real runtime (a deploy plus a single image request); don't trust local green.

### `no-html-link-for-pages` IS CROSS-FILE — ADDING A PAGE CAN RED AN UNTOUCHED LINE

It fires only when an `<a href>` matches a REAL app-router page, so a lint failure in a file your diff never touched, right after a new route lands, is this rule discovering that an existing `<a>` now points at an internal page. Fix = convert it to `<Link>`. Not a phantom regression in the red file.


### A `hover:` WITHOUT `focus-visible:` ANYWHERE IN `src/app/**` BLOCKS AT PUSH

The source project's pre-push focus-visible arm (its hook is not in this copy) covers ALL of `src/app/**`, not just component dirs — and it blocks
on PROSE mentioning the pattern too. Full rule + dispositions: `.claude/rules/components.md` (not in this copy)
§ ANY INTERACTIVE ELEMENT DECLARING `hover:` (deltas relocated there 2026-08-26).
