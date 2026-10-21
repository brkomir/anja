# Process — Queue (subcommand: `queue`)

Display the Adoption Queue from `.claude/skills/meta/ADOPTION-QUEUE.md`, where the archive split moved the `## Adoption Queue` section. Read-only answer to "what should I ship next for workspace infrastructure?" Complements `/backlog` (product features) and the ops tracker (ops/bugs). Added v2.7.5 after first use of queue section surfaced need for one-command retrieval.

## Steps (all read-only — no writes)

1. **Read queue section.** Extract the `## Adoption Queue — v2.8.x+` block from `.claude/skills/meta/ADOPTION-QUEUE.md`. Parse into two groups: active queue (priority + status ordered) + conditional (trigger-gated) items.

2. **Format summary.** Render as tables grouped by release (v2.8.0 / v2.8.1 / v2.8.2 / v2.8.3 / conditional). Include status column.

3. **Top-3 ready-to-ship callout.** Identify the 3 highest-priority `queued` items from earliest release. Surface as "Next up" block with LOC estimates + 1-line rationale per item.

4. **Statistics footer.** Total queued / total shipped / total conditional. LOC breakdown per priority class (P0/P1/P2).

## Output format

```
## Adoption Queue — {YYYY-MM-DD}

### v2.8.0 (P0 batch — ~150 LOC)
{table rows with status}

### v2.8.1, v2.8.2, v2.8.3
{remaining active queue rows}

### Conditional (trigger-gated)
{shinpr S1-S3 rows with trigger column}

### Next up (top-3 ready-to-ship)
1. {item} — {LOC} ({1-line why-this-first})
2. ...
3. ...

### Stats
- Queued: {N} active + {M} conditional
- Shipped: {K}
- LOC pending: {total} (P0: {n}, P1: {n}, P2: {n})
```

**Scope boundary:** read + format only. Marking items shipped / adding items / reordering → manual edit of `.claude/skills/meta/ADOPTION-QUEUE.md`, moving a shipped item to the record of shipped work. Use `/meta queue` to see state, not to mutate.

**When NOT to use:** if the queue section is empty (nothing to ship) → output "No active queue items." If >20 items → top-3 callout still useful but render compact table.

**Revisit trigger:** after 3 uses, verify utility. If `/meta queue` output is identical to last invocation 3x running → queue is stalling; nudge user to ship or prune. If user always reads it then immediately opens the adoption-queue file anyway → command isn't adding value; deprecate.
