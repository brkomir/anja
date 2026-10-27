Owner-curated registry of orchestrator-blindspot events — moments where owner pushed back on a recommendation/assertion/scope-decision AND the response shifted. Closes the gap that the meta lesson store's codification was slow to detect: pattern visibility requires recurrence count crossing threshold, but during the recurrence window the events themselves are lost to memory unless captured at-source.

**Distinct from `/meta learn`** (the most-important distinction since both fire from `/wrap`):

| | `/meta learn` | `/meta corrections` |
|---|---|---|
| **Scope** | full session, all signals | owner-pushback events (regex on user messages) **+ soft-overrides** (v0.6: AskUserQuestion picks where owner chose a non-"(Recommended)" option) |
| **Output** | numbered L# lessons in the meta skill's lesson archive | event entries in `.claude/meta-corrections-registry.md` |
| **Granularity** | LOW-volume, high-formalism (D+I+S scored, evidence-backed, durable) | HIGH-volume, low-formalism (capture-first, triage-tag, append-only) |
| **Per-item format** | ~30-50 lines (Trigger/Action/Evidence/D+I+S/Revisit sections) | ~8 lines (My-proposal/Pushback/Correction/New-ground/Pattern/Codified) |
| **Promotion** | the registry feeds it — patterns recurring ≥3 distinct-sessions become L# candidates | N/A (every owner-triaged-TRUE event lands) |
| **Auto-fire** | `/wrap` Step 2 | `/wrap` Step 7f |

Registry IS the feeder; the meta lesson store IS the codifier. L# entries back-reference the registry via the "Codified as L#?" field.

**Implementation:** `scripts/meta-corrections-scan.py` (currently v0.7). The subcommand is a thin dispatch layer over the script's CLI flags — same functional surface, discoverable via `/meta` skill menu. **v0.6 (2026-06-03)** added `scan_overrides()` (soft-override detection — the (B) capture-gap fix, surfaced alongside pushback candidates in the scan output) + a `⚠️ DRAIN DUE` footer surfacing the uncodified backlog so capture can't outrun curation. Depends on the "(Recommended)" label convention + routing genuine recommendation-forks through AskUserQuestion.

**Subcommands:**

- `/meta corrections --scan` — scan recent sessions for candidate owner-pushback events. Default: last 10 sessions. Optional: `--session <id>` (specific session by ID-prefix substring) / `--current` (this session's jsonl via `CLAUDE_CODE_SESSION_ID`, falling back to the most-recently-modified jsonl only when that is unset — what /wrap Step 7f runs) / `--days N` (last N days) / `--all` (entire corpus) / `--verbose` (600-char excerpts vs default 400). Output: per-session table of candidates with signal tags + excerpt.
- `/meta corrections --dig <prefix>:<idx>` — resolve one event with proper `ARGUMENTS:` split + adjacent assistant context. **Use whenever a scan excerpt is ambiguous** (quote-and-react patterns where owner pasted my output and reacted; the regex match may be inside the quoted block while owner's reaction sits past the excerpt cap).
- `/meta corrections --analyze` — registry frequency analysis. Outputs pattern-tag distribution (primary + secondary), codification rate (yes/no/pending split), activity-over-time, top-5 codification candidates with distinct-session counts, **+ gate-effectiveness (2026-06-20)** — per gated blindspot-tag, the registry SHARE before vs after its decision-moment gate (sniff-test check / Hot-Tier trigger) shipped. This is the **closed loop** measuring whether a sniff-test check actually drops its blindspot's owner-pushback rate (the effectiveness signal the sniff-test FAIL log never populated). `GATE_SHIP_DATES` in the script is the curated tag→ship-date map — EXTEND it when a new check ships; needs ≥20 post-ship entries before the Δ reads (a just-shipped gate shows ⏳ pending + a locked baseline). **Companion instrument (2026-07-18, guildhall adoption): `node scripts/calibration-score.mjs [--since YYYY-MM-DD]`** — the dual over-/under-caution calibration score (−20 hedge-pole / −30 confident-wrong-pole, over the registry + `audit-findings.jsonl` refuted rows). Run it alongside `--analyze`: the SHARE analysis is one-pole (over-hedge frequency) and therefore gameable — a gate that drops its tag's share while the under-caution pole rises is a net LOSS the share-read alone would score as a win. REPORT-ONLY — never wire the score into any agent-facing prompt/incentive (score⊥incentive until baseline data justifies more; `--self-test` covers parser + scoring).
- `/meta corrections --prime` (top-level shorthand: **`/meta prime`**) — compact session-start blindspot spotlight: the top recurring pattern-tags with ≥10% registry share, rendered as the `/orient` Step-9 ⚠️ spotlight + per-tag counter-actions. Read-only, ~instant. This is what the **SessionStart hook (`session-start.sh`) auto-fires at every session start (wired 2026-06-09)**; invoke `/orient` or `/meta prime` manually to **re-prime mid-session** (e.g. before a heavy composition, or if the prime has scrolled far up a long post-compact stretch — note the SessionStart hook is matcher-less and re-fires the prime on the `compact` source, so a compact itself does NOT drop it). Sibling of `--analyze` (which does the full frequency read) but compact — spotlight only, no distribution/codification breakdown. The script **self-renders** via `--prime --render` (labeled `#1`-in-full + compact secondary for every other ≥10% tag, each with its counter-action; `PRIME_COUNTER_ACTIONS` in the script is the single-source map shared by the hook + `/orient`). Raw `--prime` (TSV) kept for back-compat.
- `/meta corrections --rule-repeats [--since <date> | --window <N>]` — saved rules (`feedback_*`) the registry names again after the rule file was created; mentions, not proven breaks. Read by `/meta patterns` step 7 (`references/process-patterns.md`).
- `/meta corrections --add-entry` — append one entry to registry via CLI flags. Required: `--session --topic --proposal --pushback --correction --new-ground --pattern`. Optional: `--pattern-secondary --date --codified --registry-path`. Used internally by /wrap Step 7f for each approved row.

**When to invoke directly (outside the /wrap auto-flow):**
- `/meta corrections --analyze` — monthly insight read; cross-pattern review after a bulk triage; "what's the dominant blindspot right now?"
- `/meta prime` (= `/meta corrections --prime`) — manual re-prime of the top blindspot mid-session; cheaper than `--analyze` when you only want the spotlight, not the full distribution. Most useful before a heavy composition, or when the session-start prime has scrolled far up a long context (a `/compact` does NOT drop it — the matcher-less SessionStart hook re-fires the prime on the `compact` source).
- `/meta corrections --scan --all` — full-corpus retrospective when investigating a recurring blindspot or after a regex/script update (compare diff against baseline).
- `/meta corrections --dig <prefix>:<idx>` — ambiguous-event resolution during triage.
- `/meta corrections --add-entry ...` — manual entry creation outside /wrap (e.g., owner notices a correction mid-session and wants to capture immediately).

**Auto-invocation:** `/wrap` Step 7f auto-fires `/meta corrections --scan --current` at session-close. If candidates exist, owner triages inline (table-based approval); approved entries land via `/meta corrections --add-entry` per row. Skip silently when zero candidates. See `.claude/skills/wrap/SKILL.md` Step 7f for the full session-end workflow.

**Files:**
- `.claude/meta-corrections-registry.md` — the registry (markdown, git-tracked, PR-reviewable). Header documents pattern-tag taxonomy.
- `scripts/meta-corrections-scan.py` — implementation script (CLI primitives).

**Pattern-tag taxonomy:** the canonical list lives in the registry header (`.claude/meta-corrections-registry.md` → "Pattern-tag taxonomy") — extend it THERE as new patterns surface (this spec no longer re-enumerates the full set, to kill the partial-list drift class). The high-frequency tags driving the session-start prime are `under-justification` / `minimum-viable-scope` / `over-narrowing`, each with a counter-action in `PRIME_COUNTER_ACTIONS` (`scripts/meta-corrections-scan.py`). Any new tag MUST get a matching `PRIME_COUNTER_ACTIONS` entry so `--prime --render` emits a real counter-action instead of the generic fallback. Newest: `preference-violation` (2026-06-09 — codified-preference application gaps, active-recall before write).

**Bulk triage workflow (when manually triaging many candidates, e.g., first registry bootstrap or post-regex-update):**
1. `/meta corrections --scan --all` (or `--days N` for narrower window).
2. Pre-classify each candidate (real / FP / dupe + pattern tag); resolve ambiguous via `--dig`.
3. Present table to owner: `| # | session:idx | excerpt | cls | pattern | new ground |`.
4. Batch-approve per ~10-20 events; entries land via `--add-entry` per row.
5. `/meta corrections --analyze` post-triage to validate distribution.

The 2026-05-24 bulk triage that bootstrapped the initial registry (67 entries from 22 jsonls) demonstrates this workflow.

**Anti-scope:**
- ⛔ **TRIAGE THE CANDIDATES YOURSELF AND WRITE THE REAL ONES — THIS REVERSES THE CLAUSE THAT STOOD HERE.** The retired rule said never auto-write without owner approval, because the regex carries a ~20-30% FP rate — but **an FP rate argues for CAREFUL triage, not for OWNER triage**, and in practice the real ones are almost never overturned. Routing them is a round-trip that returns nothing. ⚠️ **That was once written as "the measured fact" and nothing measured it** — `grep -ciF overturn scripts/meta-corrections-scan.py` → **0**, so the scanner has no overturn field and the registry records none; the sole evidence is one first-hand report, which is good grounds and is not a measurement. The sibling clause in `wrap/SKILL.md` asserted the same proposition BARE — no epistemic marker, which is the STRONGER form, not the honest one; both specs now attribute it to that report.
  **What the FP rate still obliges:** classify every candidate against the registry's own definition — a proposal of MINE, an owner correction, and a SHIFT in response — and drop the rest. The reliable false shapes are REQUESTS ("can you check X?"), DIRECTIVES ("let's codify a rule that…"), QUESTIONS ABOUT THE TOOLING, and DUPLICATE RECORDS OF ONE UTTERANCE (a queued/typed pair is ONE event). Measured when this changed: **13 candidates → 8 real, 5 false**, a 38% FP rate — the triage is real work and it is mine.
  ⚠️ **Still gated: anything that CHANGES A RULE.** Writing a registry event is capture; promoting a pattern to an L# or editing a spec is not.
- Don't bloat the per-entry format. The 8-line shape is intentional — registry is the high-volume capture layer, the meta lesson store is the curated layer. Pushing more structure into entries duplicates the lesson store's purpose.
- Don't run `--analyze` on every `/meta` invocation — cadence is owner-driven (monthly or post-bulk-triage).
- Don't promote registry patterns to L# automatically. Promotion requires D+I+S scoring + evidence assembly + revisit-trigger design — that's a `/meta learn` step, not auto-firable from the registry side.

**Revisit:** if the registry grows beyond ~500 entries without /meta learn codification keeping pace, the feeder→codifier loop is broken — investigate why /meta learn isn't promoting recurring patterns. If `--analyze` shows pattern distribution stays stable across 90 days with no new patterns surfacing, the regex set is calibrated — no further v-bumps needed. If owner consistently skips Step 7f triage with "ship later", registry value isn't being realized — re-evaluate whether the auto-fire trigger is well-placed.
