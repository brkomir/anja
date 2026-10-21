---
name: Surface and lens coverage register
description: Which places in your product (surfaces) have been reviewed, through which lens, and when. Read by /surfaces and scripts/surface-register-drift.mjs. Starts empty; you define the surfaces.
type: project
---
## Surface and lens coverage register

This register answers one question: which parts of the product have been reviewed, through which lens, and how long ago. `/surfaces` reads it. It records coverage, not fixes: a finding's fix lives in your backlog or your todo list, and the register carries only a one-line rollup that points to it, never the commit ids. Copy this file, keeping its name, into `.claude/project-memory/`: `/surfaces` and `scripts/surface-register-drift.mjs` read it there.

**You define the rows.** The register starts empty on purpose.
- A **surface** is a place a user sees: a page, a screen, a route family, an email set. Examples: the settings page, the checkout, the onboarding screens.
- A **lens** is a concern that cuts across places: accessibility, copy, performance, security, legal. A review usually covers one surface through several lenses (one row of the matrix). A sweep covers one lens across several surfaces (one column).
- Surfaces are numbered `S1`, `S2` and so on, a number is never reused, and the same `S<N>` numbering holds lens-sweep rows. Re-auditing a surface updates its row in place. Mint a new number only for a place you have not tracked before.

**The ten lens columns** are fixed because `scripts/surface-register-drift.mjs` knows them: `aiqual` (quality of the product's AI-generated output; leave `·` if it has none), `ux`, `frontend`, `a11y`, `copy`, `i18n`, `perf`, `legal`, `security`, `persona` (the surface read as a typical user would). Rename one and the script stops checking it.

**One cell of the matrix** is one of: `✓` reviewed through that lens by the right specialist, `◐` partly or incidentally, `·` not looked at (a gap, not a pass), `→S<N>` covered by a lens-sweep row you cite.

**How coverage grows.** A new surface starts as a heading in the register below and a row in the matrix whose first cell holds its number and name together (`| S1 Settings page |`) and whose other cells are all `·`. Each review of it replaces `·` with `✓`, `◐` or `→S<N>` in the surface's own `Lenses:` line first, then in the matrix. The surface rows are the source of truth; the matrix is a copy. `node scripts/surface-register-drift.mjs` reports where the two disagree.

**One surface row** is a `###` heading and five bullets. The heading reads `### S1 — Settings page · SURFACE` (a lens-sweep row ends `· LENS` instead). The bullets, in order, begin `- **Live-blocker:**` (yes or no, and how severe; add `**Findings:**` with the rollup), `- **Panel:**` (who reviewed it, when, what scope), `- **Lenses:**` (for example `aiqual· ux✓ frontend✓ a11y◐ copy✓ i18n· perf· legal· security· persona✓`, each glyph written directly after its lens name), `- **Prescribed:**` (specialist lenses the surface's scope demands, each marked `✓` covered or `✗` missing) and `- **Re-audit:**` (the event or date that makes the row stale). A row whose live-blocker bullet says yes in capitals appears in the `/surfaces` blocker list.

## COVERAGE MATRIX — surfaces only (a copy of each row's `Lenses:` line)

| Surface \ Lens | aiqual | ux | frontend | a11y | copy | i18n | perf | legal | security | persona |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|

**GAP columns and cells the matrix surfaces (each a candidate audit):**
- None yet. Add a bullet when a column or a cell shows a gap worth auditing.

### PRESCRIBED-LENS GAPS — specialist lenses a surface needs and has not had

The matrix shows the ten common lenses. This section lists the specialist lenses a surface's scope demands that are not matrix columns, such as payments, growth or onboarding. Rank the entries by what a miss would cost.

- None yet.

---

## SURFACE AND LENS ROWS (the source of truth)

Add one `###` row per surface or lens sweep here, in number order.

## Superseded

Rows replaced by a later one move here for the record. Never renumber a live row.
