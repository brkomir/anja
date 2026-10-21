# Vulnerability bypass taxonomy (audit reference)

**What this is:** the *bypass detail* a naive security check misses — for each vuln class, the evasions, the **false-safety signals** (code that LOOKS safe but isn't), and the real fix. Use it as an audit checklist when reviewing a diff that touches the listed sinks. It is NOT a runtime tool and NOT a general OWASP primer (that lives in `SKILL.md` OWASP A01–A10). It complements the OWASP list with the "why the obvious mitigation doesn't actually work" layer.

**Provenance:** adapted (harvested, not installed) from the LLM-review prompt (`hooks/llm.py`) of the `security-guidance` plugin in Anthropic's public `claude-plugins-official` repository — Apache License 2.0; the licence text is in `.claude/NOTICE` in this copy and the origin record names the versions read — 2026-06-05, distilled + scoped to OUR stack: JS/TS + Next.js App Router + Supabase + Sharp image uploads + Paddle webhooks. Off-stack classes (pickle/yaml/torch deserialization, Go `exec`, Django/Flask/Jinja, XXE, Airflow) were dropped. Our SSRF craft already matches the plugin; this captures the classes our docs covered thinly.

**Why it exists:** a security rules file that covers an unsafe HTML sink like `dangerouslySetInnerHTML` in one line leaves the bypass classes uncodified — attribute-context breakout, wrong-threat sanitizers, OAuth state forgery, IDOR sibling-omission. This closes that gap for every future audit.

---

## XSS — the four bypasses

Trigger sinks: `dangerouslySetInnerHTML`, `el.innerHTML`/`outerHTML`/`insertAdjacentHTML`, `document.write`, manual HTML string-building, `react-markdown`, any download/serve endpoint streaming stored bytes.

1. **Attribute-context breakout.** An escaper that encodes `< > &` but NOT `"`/`'` is XSS the moment its output lands in a quoted attribute. The classic false-safe idioms: `div.textContent = s; return div.innerHTML` and `.replace(/[<>&]/g, …)` — both leave quotes intact, so `'<a href="' + esc(url) + '">'` breaks out via `" onmouseover="…`. A protocol allowlist `/^https?:/` does **not** stop attribute breakout (`[x](https://a" onmouseover=alert(1))` still escapes the `href`).
2. **Wrong-threat sanitizer (the misleading-name signal).** A `sanitize*`/`clean*`/`escape*` function whose transform doesn't match the SINK. Example: a CSV-import `sanitizeCsvValue()` that strips formula prefixes (`=@+-`) but does zero HTML encoding, whose output later reaches `dangerouslySetInnerHTML` → stored XSS from the uploaded file. **The reassuring function name is the false-safety signal** — verify the transform matches the destination context, not the name.
3. **Inconsistent manual interpolation.** In hand-built HTML (`` `<li>${s}</li>` ``), audit **each** `${…}` individually — one `escapeHtml()` nearby is NOT proof the sibling interpolations are safe.
4. **Markdown + file-serve.** `react-markdown` with `rehypeRaw` but no `rehypeSanitize`; `marked(x)` → `dangerouslySetInnerHTML` without DOMPurify. **File-serve (relevant wherever user uploads are served back):** a download/serve endpoint streaming stored bytes with a stored `Content-Type` of `text/html`/`image/svg+xml`, `Content-Disposition: inline` (or absent), and no CSP = same-origin stored XSS. Sharp re-encode strips EXIF and forces a raster type, but any path that serves *original* bytes or honors a *stored* content-type must force `Content-Disposition: attachment` or a sandbox CSP and never serve `svg+xml` inline on the app origin.

**JS event-handler attributes:** HTML-escaping is insufficient inside `onclick`/`onchange` etc. — the browser HTML-decodes the attribute before executing JS, so `&#x27;` becomes `'` again. Use `JSON.stringify()` for values entering a JS context.

## SSRF — the 5-vector allowlist-bypass checklist

Use this to audit any NEW user-influenceable URL/host reaching an outbound `fetch`/`axios` (OAuth/OIDC discovery fields like `jwks_uri`, webhook dispatch, link-preview, storage clients keyed by an attacker-authored value). **Our implemented control is `src/lib/security/safe-fetch.ts`** — it already does all five; the job here is to confirm every new outbound call routes through it (or replicates it).

- **(a) Userinfo.** `url.startsWith(prefix)` or comparing `.host`/`netloc` (which include `user:pass@`) lets `https://<trusted-host>@<attacker-host>/x` through. Compare ONLY `new URL(u).hostname`.
- **(b) Base-resolution.** `new URL(userPath, trustedBase)` does NOT pin host: `//evil.com/x` (protocol-relative) and absolute `http://evil.com` ignore the base. Check `result.hostname === expectedHost` AFTER resolution.
- **(c) String-suffix.** `host.endsWith('.trusted.com')` passes `evil.com/.trusted.com` and `evil.com#.trusted.com`.
- **(d) Normalization.** Missing `host.toLowerCase().replace(/\.$/,'')` lets `Trusted.COM.` slip; a falsy-netloc short-circuit lets `http:evil.com` through.
- **(e) Redirect.** `fetch`/`axios` follow 3xx by default, re-introducing SSRF after an allowlisted first hop (attacker serves `302 Location: http://169.254.169.254/`). Fix: `redirect: 'manual'` + re-validate **every** hop against private/loopback/link-local AFTER DNS resolution of all `getaddrinfo` results.

## IDOR / scoping — the sibling-omission signal

A handler returning or mutating an owner-/tenant-/visibility-scoped resource MUST verify the requester is in scope. Missing-authz shapes on OUR stack:
- `db.select().from(x).where(eq(x.id, id))` with no `userId` predicate (our rule: always include `userId` in the WHERE clause, even with RLS).
- A foreign-key ID accepted from the request body without checking the user may reference that related entity.
- **An interaction endpoint (like / comment / rate / bookmark) that skips the visibility check the READ endpoint has.**
- A route under `/[id]` whose handler never references that path param (queries only by `auth.uid()`), so the param is decorative — fine, but confirm it's actually unused, not silently trusted.

**The highest-yield signal: a NEW endpoint omits a check its SIBLING in the same diff/surface has.** This is exactly our codified sibling-gate discipline: when adding a NEW endpoint, audit ALL SIBLINGS in the same surface family for the same gates. Treat IDOR review as a completeness-enumeration over the surface family, not a single-endpoint check.

## OAuth / OIDC callback weaknesses

- **(a) Forgeable state.** An OAuth callback's `state` is CSRF-protective ONLY if unguessable AND bound to the session. A `state` decoded as plain base64 JSON (`JSON.parse(Buffer.from(state,'base64url'))`) is attacker-forgeable — and comparing a field extracted from it (`decoded.email === identity.email`) is a **no-op**, because the attacker writes the victim's value into the forged state. Require `crypto.createHmac` verification, a `cookies.get('oauth_state') === state` compare, or a server-side nonce lookup. **Flag this even when the diff is adding the comparison as a "CSRF fix"** — the comparison itself is the false-safety signal.
- **(b) Unauthenticated token-minting.** A handler returning a bearer credential (`res.json({ sessionId / access_token })`) that reads only `req.query`/`req.body` and never references the authenticated session / auth middleware.

## Open redirect

`redirect(searchParams.get('next'))` without validation lets an attacker bounce users to a malicious site post-login. Fix: parse it, never prefix-match it — `const u = new URL(next, origin)`, refuse unless `u.origin === origin`, then redirect to the absolute `u.href`, or to the relative `u.pathname + u.search + u.hash` only after refusing one that starts with `//` (`/.//evil.com` parses same-origin to the path `//evil.com`). Or an allowlisted host. **False-safety signal:** `url.startsWith('/') && !url.startsWith('//')` alone — `/\evil.com` and `/<TAB>/evil.com` pass it and the browser resolves both to another host.

## Path traversal — the symlink bypass

`path.resolve()` / `normalize()` are **lexical** — they collapse `..` but do NOT dereference symlinks, so `resolved.startsWith(baseDir)` is symlink-bypassable. Call `fs.realpathSync()` FIRST, then check the result starts with the realpath of `baseDir`. Any path built from user input hits this.

## Command injection (scripts that shell out)

Passing user/derived input to a shell (`exec`, `` `${x}` `` in a command string) is injectable even via a single arg that can carry metacharacters. Pass each argument separately without invoking a shell AND validate the input format. Relevant to `scripts/**` that shell out, not the app runtime.

## Insecure file permissions on credential writes

A write that creates a token/secret/lockfile-with-auth at a mode more permissive than owner-only (`0o600` file / `0o700` dir) is a disclosure vector on multi-user hosts (CI runners, shared compute). Three failure shapes: (a) no mode → umask default `0o644`; (b) an explicit permissive mode (`0o644`/`0o666`); (c) write-then-`chmod` (world-readable in the gap). Pass `{ mode: 0o600 }` at write time.

---

## How to use in an audit

When a diff touches a sink above, run the matching bypass checklist and look specifically for the **false-safety signals** (a reassuring sanitizer name, a `startsWith` host check, a `state` comparison, an escaper that forgot quotes, a missing sibling gate). A passing-looking mitigation that matches one of these shapes is the finding. Cross-link the relevant implemented control (your SSRF-safe fetch wrapper for SSRF, the sibling-gate discipline for IDOR) so the fix references our existing pattern rather than reinventing it.
