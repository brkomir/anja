# Expert Relaunch Template — API 500 Recovery

Use when an expert in a multi-expert `/expert-review` panel hit an Anthropic API 500 mid-response. Distinct from format-failure relaunch and rate-limit recovery (agent-claim drift hook). The retry is a **"fill the gap"** task, not **"redo your solo investigation"**.

See the Evidence section below for the rationale.

## When to use

- The expert's `Agent` result showed `API Error: 500` and the agent is marked `completed` with partial/empty content
- Other experts in the same panel completed successfully — their findings are usable context
- The relaunched expert's scope hasn't changed; only the delivery was truncated

## Template

```
**Context:** (Retry after API 500.) You are re-running as part of a multi-expert panel auditing <topic>. Your previous response was truncated by an API error. Other experts in the panel have completed — their findings are summarized below. Focus on YOUR scope; don't re-derive what they already covered.

**Cross-panel context (do NOT re-investigate; trust the summary):**
- <expert A> (<role>): <1-2 sentence finding summary with P0s called out>
- <expert B> (<role>): <1-2 sentence finding summary with P0s called out>
- <expert C> (<role>): <1-2 sentence finding summary with P0s called out>
- ... (~200 words per expert max; only the experts whose findings inform YOUR scope)

**Your scope (unchanged from original brief):**
<paste the scope paragraph from the original brief — trimmed of context the other experts have already addressed>

**Files to read (beyond your own SKILL.md + MEMORY.md):**
<same as original brief, but remove files that other experts already analyzed and reported on>

**Constraints:**
<same as original — policy assumptions, tech stack, build philosophy>

**Question:** <same as original>

<If the original brief included "Additional role: Devil's Advocate" — keep it>
```

## Token budget guidance

- Relaunched expert's cross-panel preload: aim for ~200 words per peer expert × up to 7 peers = ~1,400 words
- Their scope section: trim by removing context already covered ("what the other agents are doing" block can often be cut — they can infer from findings)
- Their file list: cut files another expert already definitively analyzed (cite that analysis instead)
- Expected output volume: ~65% of original token budget because the expert no longer re-investigates shared territory

## When NOT to use this template

- Expert hit a rate limit (use agent-claim drift hook's git-status recovery, not a relaunch)
- Expert returned complete but malformed output
- Expert returned APPROVED on a scope another expert REJECTED — that's a consensus issue, not a delivery issue
- Panel was solo (1 expert) — no cross-panel context to preload, just relaunch with the original brief

## Evidence

2026-04-15 audit: 3 of 9 experts hit API 500s. All 3 relaunched with this template produced complete structured output at ~65% of original token budget; no expert re-duplicated another's findings.
