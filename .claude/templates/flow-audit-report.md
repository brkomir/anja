# Flow Audit Report Template

## Flow #{N}: {Flow Name}

### Expert Summary
| Expert | Verdict | Confidence | One-line |
|--------|---------|:----------:|----------|
| {name} | APPROVED/ALTERNATIVE/REJECT | High/Med/Low | {finding} |

### Finding Checklist
| ID | Finding | Verified By | Status |
|---|---------|------------|--------|
| P0-1 | {description} | {expert} | VERIFIED / ISSUE / NOT CHECKED |

### Grouped Findings (by topic)
#### 1. {Topic Name} ({N} experts)
{Description + recommendation}

#### 2. {Topic Name} ({N} experts)
{Description + recommendation}

### Contrarian Callout
{The devil's advocate finding — must be surfaced separately}

### Single-Expert Findings
| Expert | Finding | Priority |
|--------|---------|----------|

### Implementation Handoff
```
/agent-work {task description}

Agent 1 ({role}):
Files: {list}
Fixes: {numbered list}

Agent 2 ({role}):
Files: {list}
Tests: {numbered list}
```
