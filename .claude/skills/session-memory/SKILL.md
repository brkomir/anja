---
name: session-memory
description: End-of-session command that reviews the conversation for important decisions and ensures they're captured in memory. Use before /wrap to persist product decisions and significant expert calls to memory files.
---

# Session Memory Sync

End-of-session command that reviews the conversation for important decisions and ensures they're captured in memory (both project memory and relevant expert memory files).

## When to Use

When the user types `/session-memory` at the end of a work session, or when they want to verify all important decisions from the session are persisted.

## What to Capture

Only capture **non-obvious decisions** — things that are NOT easily discoverable from:
- Reading the code (patterns, conventions, architecture)
- Git history (what changed, commit messages)
- Existing CLAUDE.md / rules files

**DO capture:**
- Design decisions with rejected alternatives (why X over Y)
- Expert panel conclusions that overrode initial recommendations
- User preferences discovered during the session
- Deferred items with specific revisit triggers
- Cross-cutting decisions that affect multiple features
- Legal/compliance conclusions from expert consultations
- Threshold values or config choices with rationale

**DO NOT capture:**
- What code was written (git log has this)
- Bug fixes (the fix is in the code)
- File paths or architecture (derivable from codebase)
- Anything already in an existing memory file

## Process

1. **Review session work** — Check `git log` for this session's commits to understand scope
2. **Identify decisions** — Scan the conversation for:
   - Expert panel conclusions (especially where experts disagreed or changed position)
   - User decisions on open questions
   - Deferred items with specific triggers
   - Feedback the user gave on approach
3. **Check for duplicates** — Read `~/.claude/projects/<project-key>/memory/MEMORY.md` and relevant expert MEMORY.md files to avoid duplicating existing entries
4. **Draft updates** — For each decision, determine:
   - Does it belong in project memory, feedback memory, or expert memory?
   - Is there an existing memory file to update, or does it need a new one?
4a. **Anti-anchoring filter (v2.8.3).** Before Step 5 presents the proposal, scan each drafted entry for **measured-magnitude claims** — specific numbers describing system behavior that could be different in production (score delta "0.3-0.6pt", tier-boundary crossing rates, divergence magnitudes, error-rate thresholds, latency deltas). For each:
   - **If empirically derived (N≥5 measured data points):** keep as-is.
   - **If from single example / expert narrative / napkin estimate:** rewrite qualitative ("can diverge meaningfully" NOT "0.3-0.6pt") OR tag with evidence-lineage ("<expert> <date>, N=1, <what the evidence is> — first production data points should verify and replace") OR drop the entry entirely if the architectural fact is discoverable from code + process-log.
   - **Scope boundary:** this filter targets **measured-magnitude claims** NOT user-decided thresholds. A user-count target for shipping or a save-rate goal for a cancel flow, set by the user, is authoritative by user-decision, not napkin — skip filter.
   - **Cost:** ~10 sec per proposed entry.
   - **Cost of skipping:** napkin estimates harden into quotable facts future sessions cite back. Evidence: 2026-04-22 — "0.3-0.6pt divergence" proposed for a project memory file; pushback surfaced the anchor risk. Before this filter, the proposal would have reached Step 5 with no flag.
4b. **MEMORY index split discipline (byte-budget fix, 4-expert panel 2026-06-01).** The project auto-memory has TWO index files — route every new index entry to the right one:
   - **`MEMORY.md`** (HOT, always-loaded, hard-capped min(200 lines, **24,985 BYTES** — `CAP_BYTES` in `check-memory-budget.sh` is the SSOT; "25 KB" was 615 ABOVE the real cliff and read GREEN on an already-truncating file). ⛔ **BYTES, NOT CHARACTERS — this clause said CHARACTERS until 2026-08-26 and the two differ by 253 on the live file.** The gate reads `wc -c` for the on-disk size and `utf8bytelength` for every projection (Write/Edit/MultiEdit branches, all three) — so on a file dense with `—`/`⛔`/`→` a reader computing headroom in characters gets a number ~250 too generous and is blocked by a gate they believed they had cleared. Measured 2026-08-26: `wc -c` **24,953** vs `len(str)` **24,700**, i.e. **32 bytes** of real headroom against an apparent 285. *(Whether the HARNESS truncation cliff is itself chars or bytes is a separate, unverified claim — the gate is bytes either way, and it is the thing that stops you.)* — past it the harness truncates the tail, and it DOES announce, but never says WHICH tail content it dropped): Trigger-Index rows (trigger→action→memory) + the ~5 vendor `reference_*` pointers ONLY.
   - **`MEMORY-INDEX.md`** (COLD, NOT auto-loaded; retrieved via Read/rg): all `project_*` / `feedback_*` topical pointers.
   - **Routing:** a new **trigger→action row** → `MEMORY.md` — UNLESS its trigger VERB is one only the main session performs (owner-facing writing, readouts/closers, `/wrap`, `/post-compact`, review-hub turns, commits, dispatch/panel/fleet mail): that row goes to `.claude/orchestrator/conventions.md` § Relocated, with the copy's edits, from the project auto-memory Trigger Index (SessionStart, main session only; `MEMORY.md` reaches every sub-agent). A new **topic-file pointer** → `MEMORY-INDEX.md`. NEVER add a topical pointer to `MEMORY.md`.
   - ⛔ **THAT BINARY IS INCOMPLETE AND IT SILENTLY DISARMS NEW RULES (measured 2026-07-31).** It routes by ARTIFACT TYPE (is this a new file?) when the question that matters is **does this rule have to FIRE at composition time?** An enforcement-shaped memory — one with a concrete trigger-phrase set and a sub-15-sec action — arrives as a NEW FILE, so the binary sends it to `MEMORY-INDEX.md`, which is **COLD: retrieved via Read/rg, never auto-loaded.** It then cannot fire, and nothing reports that. Measured: a feedback memory file was committed at 14:08 with its pointer routed cold; ~6h later a seat committed the exact failure it describes, with the rule on disk and unreachable. **THE FILE AND THE TRIGGER ARE SEPARATE DECISIONS — a new file may need BOTH a cold pointer AND a hot row.** Ask in this order: (1) does it need to fire at composition time? → a `MEMORY.md` Trigger-Index ROW (the body still lives in the topic file); (2) is it a domain/coding standard? → **`.claude/rules/<topic>.md`, which is always-loaded for the orchestrator AND every sub-agent** — the relief route the row-caps exist to point at (`active-recall.md` ladder step 4); (3) reference/state only? → the cold index alone. ⚠️ Do NOT read the hot index's ~24.4 KB character limit as a reason to route cold: it is a **HARNESS truncation cliff**, not a policy cap (`check-memory-budget.sh` header — past it the tail is truncated, announced but never itemised), so it bounds how much can live there but says nothing about what BELONGS there. ⛔ **BUT `.claude/rules/` IS NOT UNCAPPED — this line read "carries NO size gate" and "'no room' is never the true blocker", and both are FALSE.** `scripts/check-band-budget.mjs` **BLOCKS the push** (`.githooks/pre-push`, ratcheted, escape `SKIP_BAND_BUDGET_CHECK=1`), so routing to `.claude/rules/` spends a real, gated, fleet-wide budget. It is still the right home for a domain standard — but choose it on FIT, never on imagined free space. Pointers ≤200 chars, NO per-event changelog (detail lives in the topic file — putting it in the pointer is what breached the cap). Enforced at the write boundary by `.claude/hooks/check-memory-budget.sh` (WARN >18 KB / BLOCK **past `CAP_BYTES` BYTES** or >200 lines — the gate reads bytes; the harness cliff is in characters and only BOUNDED).
5. **Present summary** — Show the user a table of proposed memory updates BEFORE writing anything
6. **Write on disclosure — NOT on approval** — present each proposed entry as ONE plain-register line saying what it teaches, state that you are taking the call, and write. The owner can veto any row after the fact; do not wait. This replaced the approval gate: drafted entries presented as an approval ask were not legible enough to approve, so the ask produced confusion rather than a decision. ⚠️ TWO carve-outs keep the ask: an entry that CHANGES A RULE (spec/policy edits stay propose-and-approve), and anything inside a note that is genuinely the OWNER'S — a product question, a taste fork — which gets pulled OUT and asked as its own question, never buried in a memory entry.
7. **Write done-marker (v2.8.2 signal-gating)** — After completing write (or explicitly concluding "nothing to persist" per Key Rules):
   ```bash
   mkdir -p .claude/state && touch ".claude/state/session-memory-done-$(date +%Y-%m-%d)"
   ```
   This suppresses `session-memory-reminder.sh` Stop-hook fires for the rest of today. Writes an empty marker file; presence is the signal (no content needed). Marker is per-day, not per-session — the hook re-fires tomorrow as expected.

## Output Format

```
## Session Decisions Review

### Proposed Memory Updates

| # | Decision | Type | Target | Status |
|---|----------|------|--------|--------|
| 1 | [decision] | project/feedback/expert | [file] | new/update |

### Expert Memory Updates

| Expert | Decision to Record |
|--------|--------------------|

### Already Captured
- [list items that are already in memory or derivable from code]

Written on disclosure (one plain line per entry above) — veto any row and I revert it.
```

## Key Rules

- NEVER write memory without SHOWING the user what was written (one plain line per entry) — disclosure is mandatory; approval is NOT (the two carve-outs in Step 6 keep the ask)
- Keep each memory entry to 2-3 sentences max
- Include "Why" and "Revisit trigger" for project decisions
- For expert memories, use the expert's existing MEMORY.md format
- If nothing important was decided (routine implementation), say so — don't force memory updates
