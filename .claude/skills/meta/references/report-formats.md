# /meta — output-format templates

Render-templates for the inline `/meta` subcommands, extracted from `SKILL.md` (2026-06-22, wshobson progressive-disclosure: an output-format EXAMPLE is what loads on activation only when you're composing that report, so it belongs in `references/`, not in the always-loaded-on-`/meta` router). Each Process section in `SKILL.md` points here for its output shape. Counts/dates below are generic placeholders — never hardcode a dated render back into the spec (that was the rot this extraction removed: a 2-month-stale "Coherence Report — 2026-04-19" snapshot re-loaded every `/meta`).

## Full Review — Expert System Health Report

```
## Expert System Health Report — {date}

### System Stats
- Experts: {N} active, {M} dormant
- Project memories: {N} files, {KB} total
- Feedback memories: {N} files ({M} absorbed into skills)
- Index: {N}/200 lines

### Memory Actions (requires approval)
| Action | File | Reason |
|--------|------|--------|

### Expert System Observations
- [Cross-cutting patterns found]
- [Capability gaps identified]
- [Panel effectiveness insights]

### Growth Recommendations
- [New experts to consider]
- [Skills to merge or split]
- [Process improvements]

### Stale Expert Memories
| Expert | Entry | Issue |
|--------|-------|-------|
```

## Coherence — Coherence Report

```
## Coherence Report — {date}

Preferences scanned: {N} (user_profile.md + {M} feedback files, deduped to {N} behavioral)
Target skills scanned: {K}
CONTRADICTS: {n} · SILENT-but-relevant: {n} · COMPLIES: {n}

### Preference: "{preference phrase}"
COMPLIES ({n}): {skills}
SILENT ({n}): {skills}   ← if they produce reports, worth an explicit format declaration
CONTRADICTS ({n}): {skills, or none}

[... one block per preference ...]

### Red flags (CONTRADICTS): {list, or none}
### Amber flags (SILENT-but-relevant): {count}
  1. {skill} — {the gap} → {proposed 1-line fix}
```

## Telemetry — /meta telemetry report

```
## /meta telemetry — last {N} days

Window: {start} → {end} ({N} days, {total} invocations)

### Top 10 (most-used)
| Skill | Count | First | Last |

### Bottom 10 (least-used, but non-zero)

### Dormant (zero invocations in last {N} days)
| Skill | Last Seen | Reason hint |

### Cooling (>50% drop second-half vs first-half)
| Skill | First half | Second half | Δ |

### Recommendation
- Consider pruning {N} dormant skills (zero invocations > {N} days).
- Cooling skills may need a spec-refresh; check their MEMORY.md last-modified.
```

## Postmortem — Compact recovery brief

The `## Compact recovery` heading and the four bold header lines (triggered, window sizes, time since trigger, the explicit-focus note) go in the session plan's dated block, never the reply (`/post-compact` Step 7); the reply opens with one plain sentence on what the recovery found, then the sections below.

```
## Compact recovery — {YYYY-MM-DD HH:MM local}

**Compact triggered:** {ts}, idx={N}, type=(auto | explicit-bare | explicit-focus)
**Window sizes chosen:** umbrella={M} messages, detailed={K} exchanges
**Time since trigger:** {minutes/hours}
**Note for explicit-focus type:** owner curated cutoff content via focus arg — the post-compact brief may add less marginal value than for auto / explicit-bare events.

### Umbrella work subject
{2-3 sentence description of the multi-step work arc}

**Key state in that arc:**
- {bullet 1 — concrete (commit hash / file path / decision)}
- {bullet 2}
- {bullet 3}

### Detailed context — last {K} exchanges before cutoff

**Exchange T-{K} ({ts}):** {owner ask} → {assistant did X}
**Exchange T-{K-1} ({ts}):** {owner ask} → {assistant did X}
...
**Exchange T (most recent before cutoff):** {owner ask} → {assistant did X — extra detail if cut mid-action}

### Hand-off state

**Owner was last:** {what owner was doing/asking}
**Assistant was last:** {what assistant was doing/about to do}
**Open questions:** {if any, else "none"}

### Recommended continuation

{1-2 sentence: continue with X, wait for owner direction on Y, etc. Read-only — surfaced, not acted on.}
```
