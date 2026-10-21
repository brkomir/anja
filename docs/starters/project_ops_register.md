---
name: Ops register
description: One row per technical entry point of your project (webhooks, scheduled jobs, background work, API routes), recording how far its audit has got. Read by /ops, /audit-check and scripts/tracker-list.mjs. Starts empty; you define the entries.
type: project
---
## Ops register

This register lists the technical entry points of your project, one row each, and records how far each one has been audited. `/ops` summarises it, `/audit-check` reads a row before it lets you mark that row complete, and `node scripts/tracker-list.mjs ops` prints it as a table. Copy this file, keeping its name, into `.claude/project-memory/`: the commands read it there.

**You define the rows.** The register starts empty on purpose. An ops entry is something that runs without a person walking through it: a webhook a vendor calls, a scheduled job, a background worker, a public API route, an embeddable widget or a utility endpoint. If a person sees the result and its wording or timing matters (a refund, a retry message), it belongs in the flow register instead.

**Numbering.** Entries are `O1`, `O2` and so on, and a number is never reused.

**What an audit asks.** An ops entry does not need the large panel a user journey gets; two or three experts are enough (an engineer, a security reviewer and whoever knows your monitoring). Before an entry counts as complete it should have an authentication gate, protection against running twice if it changes data, alerting when it fails, and one happy-path test.

**One row** has the cells `#`, `Entry`, `Status`, `Audit Tiers`, `Audited?` and `Notes`. Webhooks add `Idempotent?` (safe to receive twice) and `Alerting?` after `Audited?`; scheduled jobs add `Alerting?`. The sections below already have the right columns.
- **Status** is the one cell the commands trust. Use `⏳ PENDING` or `✅ COMPLETE`. `Audited?` and `Notes` are narrative; add to them and never rewrite them.
- **Audit Tiers** is a short token: `prov:<date or via-F<N>> c:YYYY-MM-DD`. `prov` is the date of an independent audit, or `via-F<N>` or `via-Flow<N>` when a feature or flow that is already audited covers this entry. `c` is the date of the last review of a fix wave (`/expert-review --code`). Leave out a key that has not run. A row never audited carries `—`.

**How a row moves from not audited to complete.**
1. Add the row under the section that fits, with Status `⏳ PENDING`, the token `—` and `NOT AUDITED` in `Audited?`.
2. Run a short `/expert-review` on the entry. Write the date and the experts in `Audited?` and stamp `prov:` in the token.
3. Fix what the review found, then check the gates above and fill `Idempotent?` and `Alerting?` where the section has them.
4. Run `/audit-check` on the entry. It is the gate: the row does not become complete until it passes. In the same edit, set Status to `✅ COMPLETE`. `/audit-check` is not a tier of its own; its date folds into the audit it closed.

Keep each section a `###` heading above its own table: the table printer groups rows by that heading. You can rename a section or delete one you do not need, but keep the header rows as they are.

### Webhooks

| # | Entry | Status | Audit Tiers | Audited? | Idempotent? | Alerting? | Notes |
|---|---|---|---|---|---|---|---|

### Crons

| # | Entry | Status | Audit Tiers | Audited? | Alerting? | Notes |
|---|---|---|---|---|---|---|

### Async processing

| # | Entry | Status | Audit Tiers | Audited? | Notes |
|---|---|---|---|---|---|

### Public REST API

| # | Entry | Status | Audit Tiers | Audited? | Notes |
|---|---|---|---|---|---|

### Embed / Utility

| # | Entry | Status | Audit Tiers | Audited? | Notes |
|---|---|---|---|---|---|
