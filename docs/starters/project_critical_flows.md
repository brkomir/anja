---
name: Flow audit register
description: One row per user journey through your product, recording how far its audit has got. Read by /flows, /audit-check and scripts/tracker-list.mjs. Starts empty; you define the flows.
type: project
---
## User flows

This register lists the journeys a user takes through your product, one row each, and records how far each one has been audited. `/flows` summarises it, `/audit-check` reads a row before it lets you mark that row complete, and `node scripts/tracker-list.mjs flows` prints it as a table. Copy this file, keeping its name, into `.claude/project-memory/`: the commands read it there.

**You define the rows.** The register starts empty on purpose. A flow is a path a person walks from start to finish, such as signing up, paying, resetting a password or publishing a page. It crosses screens and systems, which is what separates it from a feature (one system, audited on its own, in the feature register). Put each flow under the tier that matches how much it costs you when it fails.

**Numbering.** Flows are numbered `1`, `2` and so on and written `Flow #N` in output. A number is never reused. `F<N>` always means a feature, never a flow.

**One row** has seven cells, in this order: `#`, `Flow`, `Status`, `Audit Tiers`, `Initial Audit (/expert-review)`, `Fixes (/agent-work)`, `Final Audit`.
- **Status** is the one cell the commands trust. Use `⏳ PENDING` or `✅ COMPLETE`. The three cells on the right are narrative; add to them and never rewrite them. Only the Final Audit cell may say `COMPLETE`.
- **Audit Tiers** is a short token that says when each kind of audit last ran: `v1:YYYY-MM-DD v2:YYYY-MM-DD v3:YYYY-MM-DD v4:YYYY-MM-DD c:YYYY-MM-DD`. `v1` is the first audit, `v2` the final audit, `v3` a re-audit after drift, `v4` a fourth pass after a long gap, `c` a review of a fix wave (`/expert-review --code`). Leave out a key that has not run. A row never audited carries `—`.
- **Initial Audit, Fixes, Final Audit** hold the history. Later audits go at the end of the cell, newest last, so the table printer can read the latest verdict from the tail.

**How a row moves from not audited to complete.**
1. Add the row with Status `⏳ PENDING`, the token `—`, `NOT AUDITED` in the Initial Audit cell and `—` in the other two.
2. Run `/expert-review <flow>`. Write `Done (YYYY-MM-DD, N experts)` in the Initial Audit cell and stamp `v1:` in the token.
3. Fix what the review found, with `/agent-work` or by hand. Write `Done (<short commit id>)` in the Fixes cell.
4. Close the flow with `/audit-check Flow #<N>`, after a fresh `/expert-review --final-audit` panel when a failure would cost users or money. `/audit-check` is the gate: the row does not become complete until it passes. In the same edit, set Status to `✅ COMPLETE`, write `COMPLETE (YYYY-MM-DD, <how it was closed>)` in the Final Audit cell and stamp `v2:` (or `v3:` and `v4:` for later passes). `/audit-check` is not a tier of its own; its date folds into the audit it closed.

A finished row reads like this (an example inside a sentence on purpose, so no reader counts it as a row; delete this paragraph once you have your own): `| 1 | Sign up and first use | ✅ COMPLETE | v1:YYYY-MM-DD v2:YYYY-MM-DD | Done (YYYY-MM-DD, 4 experts) | Done (<short commit id>) | COMPLETE (YYYY-MM-DD, audit-check pass) |`

**One file is enough.** Every reader here accepts this single file. If it grows past about 50 KB, `node scripts/rules-tier-split.mjs --target flows --apply` splits it into a router plus `project_critical_flows-SHARD-NN-*.md` files beside it, and the readers keep working on the split.

Keep the headings below as they are: the table printer finds each table by its tier heading and its header row.

### CRITICAL — a failure here loses users or money

| # | Flow | Status | Audit Tiers | Initial Audit (/expert-review) | Fixes (/agent-work) | Final Audit |
|---|---|---|---|---|---|---|

### HIGH — flows that drive engagement or revenue

| # | Flow | Status | Audit Tiers | Initial Audit (/expert-review) | Fixes (/agent-work) | Final Audit |
|---|---|---|---|---|---|---|

### STANDARD — trust and quality

| # | Flow | Status | Audit Tiers | Initial Audit (/expert-review) | Fixes (/agent-work) | Final Audit |
|---|---|---|---|---|---|---|

### POLISH — refinement

| # | Flow | Status | Audit Tiers | Initial Audit (/expert-review) | Fixes (/agent-work) | Final Audit |
|---|---|---|---|---|---|---|
