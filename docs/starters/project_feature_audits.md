---
name: Feature audit register
description: One row per technical system in your project, recording how far its audit has got. Read by /features, /audit-check and scripts/tracker-list.mjs. Starts empty; you define the features.
type: project
---
## Feature audits

This register lists the technical systems of your project, one row each, and records how far each one has been audited. `/features` summarises it, `/audit-check` reads a row before it lets you mark that row complete, and `node scripts/tracker-list.mjs features` prints it as a table. Copy this file, keeping its name, into `.claude/project-memory/`: the commands read it there.

**You define the rows.** The register starts empty on purpose. A feature here is a system you could point at and audit on its own, such as sign-in, billing, an upload pipeline or a notification system. Put each one under the tier that matches the damage a defect does.

**Numbering.** Features are `F1`, `F2` and so on, and a number is never reused. The `F` keeps them apart from the numbers in the flow register.

**One row** has seven cells, in this order: `#`, `Feature`, `Status`, `Audit Tiers`, `Audit`, `Fixes`, `Final Audit`.
- **Status** is the one cell the commands trust. Use `⏳ PENDING` (not audited, or audit and fixes still under way), `🔧 IN PROGRESS` or `✅ COMPLETE`. The three cells on the right are narrative; add to them and never rewrite them.
- **Audit Tiers** is a short token that says when each kind of audit last ran: `v1:YYYY-MM-DD v2:YYYY-MM-DD v3:YYYY-MM-DD v4:YYYY-MM-DD c:YYYY-MM-DD`. `v1` is the first audit, `v2` the final audit, `v3` a re-audit after drift, `v4` a fourth pass after a long gap, `c` a review of a fix wave (`/expert-review --code`). Leave out a key that has not run. A row never audited carries `—`.
- **Audit, Fixes, Final Audit** hold the history. Later audits go at the end of the cell, newest last, so the table printer can read the latest verdict from the tail.

**How a row moves from not audited to complete.**
1. Add the row with Status `⏳ PENDING`, the token `—` and `NOT AUDITED` in the Audit cell.
2. Run `/expert-review <feature>`. Write `Done (YYYY-MM-DD, N experts)` in the Audit cell and stamp `v1:` in the token.
3. Fix what the review found. Write `Done (<short commit id>)` in the Fixes cell.
4. Run `/audit-check F<N>`. It is the gate: the row does not become complete until it passes. In the same edit, set Status to `✅ COMPLETE`, write the closing line in the Final Audit cell and stamp `v2:` (or `v3:` and `v4:` for later passes). `/audit-check` is not a tier of its own; its date folds into the audit it closed.

A finished row reads like this (an example inside a sentence on purpose, so no reader counts it as a row; delete this paragraph once you have your own): `| F1 | Sign-in | ✅ COMPLETE | v1:YYYY-MM-DD v2:YYYY-MM-DD | Done (YYYY-MM-DD, 3 experts) | Done (<short commit id>) | COMPLETE (YYYY-MM-DD, audit-check pass) |`

Keep the headings below as they are: the table printer finds each table by its tier heading and its header row.

### CRITICAL — a defect here loses money, leaks data or breaks trust

| # | Feature | Status | Audit Tiers | Audit | Fixes | Final Audit |
|---|---|---|---|---|---|---|

### HIGH — performance, quality and reliability

| # | Feature | Status | Audit Tiers | Audit | Fixes | Final Audit |
|---|---|---|---|---|---|---|

### STANDARD — operational readiness

| # | Feature | Status | Audit Tiers | Audit | Fixes | Final Audit |
|---|---|---|---|---|---|---|
