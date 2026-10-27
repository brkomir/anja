# Process — Maintain (subcommand: `maintain`)

Sequenced runner for the meta maintenance family. One invocation runs the full member family in canonical order, batching all approval-level findings into a single consolidated table at the end. It exists so the several meta maintenance commands run in one sequence rather than one at a time. **The due-check GATE was retired 2026-07-19** (3 consecutive all-due runs — see Revisit record); a non-gating context-read preamble replaces it.

**Distinct from bare `/meta` (Full Review):** Full Review is ONE deep process (project-memory audit + expert roster + health report). Maintain is a DISPATCHER over the codified maintenance subcommands — including ones Full Review never touches (corrections scan, architecture-audit, self-audit, coherence, telemetry). They compose: bare `/meta` can be thought of as the deep-dive; `/meta maintain` as the periodic service run.

**Distinct from `/meta review --flags`:** review composes the four audit MODES (hygiene/patterns/self/coherence) unconditionally when flagged. Maintain covers the wider family (+corrections, +architecture-audit, +telemetry, +status); its former due-check gate is retired (2026-07-19).

## Args

- *(none)* — run ALL members in canonical order, preceded by the context-read preamble.
- `--all` — legacy alias of the default (kept for muscle memory; the gate it used to bypass is retired).
- `--only <a,b,...>` — run exactly the named members (canonical order), e.g. `/meta maintain --only self-audit,coherence`.
- `--dry-run` — emit the context-read preamble + planned member list; execute nothing.

## Member subcommands + own-cadence reference

The per-member triggers below are each member's ORGANIC trigger (unchanged — they still govern when a member fires on its own outside maintain, per Anti-scope) and feed the context-read preamble; they no longer gate the maintain run. Ground truth for "last run" = the most recent `meta/CHANGELOG.md` entry mentioning that subcommand.

| # | Member | DUE when | How to check (fast) |
|---|---|---|---|
| 1 | `status` | always — it IS the snapshot (cheap, read-only) | — |
| 2 | `corrections --scan` (recent sessions) | always — capture layer; near-zero cost when no candidates | run `scripts/meta-corrections-scan.py`; the `--rule-repeats` read runs in member 9 (patterns step 7) |
| 3 | `memory-audit` | `check-memory-size.sh` WARN fired, OR project index past `WARN_BYTES` (`check-memory-budget.sh`), OR ~10 sessions since last | hook output / `wc -c` project MEMORY.md / CHANGELOG grep |
| 4 | `router-staleness` | always — read-only, ~200 ms over the whole fleet | **BOTH tiers, and they are different tools.** `node scripts/memory-tier-split.mjs --scan-routers` (exit 1 = something needs attention; verdicts `current` / `STALE` / `ROLL-DUE` / `BROKEN`) covers the MEMORY families ONLY. Then `node scripts/rules-tier-split.mjs --check` for the RULES two-tier (`meta/RULES.md` + `RULES-SHARD-*.md`, split 2026-09-04), which the first command cannot see by construction — ⛔ running only the first and reporting the member clean is the measured failure (2026-09-09): its `needs-attention=0` is indistinguishable from coverage it does not have. The scanner now prints a `coverage:` line saying so; report BOTH verdicts. |
| 5 | `self-audit` | ≥5 sessions since last, OR major meta-spec edit since, OR `active-recall.md`/`behavioral-anti-patterns.md` edited since (Check 11 = the `rules-trigger-firerate.mjs` deadness extract re-measures the moved rules) | CHANGELOG grep `self-audit` + `git log --since=<date> -- .claude/rules/active-recall.md .claude/rules/behavioral-anti-patterns.md` |
| 6 | `architecture-audit` | ≥30 days since `architecture.md` `last-reviewed`, OR ≥10 meta-system commits since | frontmatter + `git log --oneline --since=<date> \| grep -cE 'meta\|skill\|hook\|rule'` |
| 7 | `coherence` | ≥30 days since last, OR a batch of skill-spec edits since | CHANGELOG grep `coherence` |
| 8 | `telemetry` | ≥7 days since last (weekly cadence) | CHANGELOG grep `telemetry` |
| 9 | `patterns` | ≥5 experts' MEMORY.md updated since last, OR ≥30 days | `git log --since=<date> --name-only -- '.claude/skills/*/MEMORY.md'` |
| 10 | `cite-check` | always — read-only, seconds | `node scripts/section-cite-check.mjs --quiet` — prints each failing cite (file:line, class, cite) then the summary; exit 1 = a dead section cite (heading-missing / file-missing) in a LIVE file; exit 2 = a usage error, an unreadable root or corpus directory, or an empty corpus. Cites in history files (`MEMORY*.md`, `CHANGELOG*.md`, `.claude/docs/rules-ARCHIVE/`) are reported as `history:<class>`, `## from` provenance headers as `provenance`, and a relative path cited from an external-* skill that names no file here as `upstream`; all three are counted on the summary and never fail. File-missing counts depend on `node_modules` being present: without `node_modules/next/dist/docs` a cite that could be a vendored doc reads unchecked, and the summary prints a warning line with that count. The bare invocation lists live dead cites, then history ones |

**Order rationale:** snapshot first (1 informs everything), capture second (2's owner-triage batches to the end), hygiene writes before doc audits (3 before 5-6 so they read clean state), read-only assessments last (6-10), with `cite-check` (10) after `patterns` as the last of them: it is read-only and writes nothing a later member reads, so it goes last. ⚠️ **THE CLEAN-STATE GUARANTEE IS CONDITIONAL ON THE DELEGATED PATH — INFERRED 2026-09-19, NOT MEASURED.** When member 3 is delegated, the brief this repo writes for it is READ-ONLY, so its edits do not land until the orchestrator applies them; dispatch 5-6 before that and they do not read clean state. **The operative mechanism is the BRIEF, not any hook** — nothing in the harness stops a sub-agent writing, so this holds exactly as far as the brief's read-only mandate does. **Apply member 3's edits before dispatching 5-6 and the guarantee is kept**, which is why this is a condition to satisfy rather than a defect to route around. *(Labelled `measured` for ~20 minutes on 2026-09-19 and corrected: the evidence is a reading of two documents, and an evidence label is the one property a later citer can check, so a measurement stamp on an inference silently converts a hypothesis into a citation. Step 2 — "therefore ALL writes move to the end" — is the part still unentailed by either document.)* `--only` preserves this order regardless of how the owner lists members.

## Execution rules

1. **Context read (replaces the retired due-check gate).** Gather the cheap grounding facts — last-run dates (CHANGELOG), churn since (expert-MEMORY / SKILL.md / meta-commit counts), sizes (project index, meta MEMORY) — and emit them as a short preamble. They SHAPE member briefs (e.g. the patterns window, delegation sizing) but gate nothing. **Then read the rows filed for this run: `python3 scripts/meta-maintain-filed-rows.py`** lists every open `todo.txt` row whose trigger names `/meta maintain` (16 such rows waited when this step was added, because neither this runner nor `defer-trigger-scan.py`, which evaluates only `meta:` `trigger-type:` kinds, reads a prose `trigger:` line naming `/meta maintain`; two of the 16 carry `/meta maintain` as a `meta:` block's own trigger: one as `trigger-type: manual`, which that scanner lists only under `--include-manual`; one as `trigger-type: internal`, an unknown kind it counts and never lists). Each row is handed to its member, whose outcome is an auto-fix, an approval-table row, or a close in the one `meta(maintain):` commit, all under that member's own thresholds; or it is listed as left, with its reason. The list misses some rows (a wrapped trigger, an `owner:`-labelled field, a checkbox-less item absorbed into the row above, a trigger naming one member without "maintain", a triage note naming the run instead of a trigger); the script's docstring lists them. `--dry-run` stops here.
2. **Run all members (or the `--only` subset) in canonical order.** Each member executes per its OWN Process spec — maintain adds no new behavior to members.
3. **Auto-fix rules stay per-member.** Each member's inline auto-fix allowance (≤5-line mechanical edits etc.) applies as codified in that member's spec. Maintain neither widens nor narrows them.
4. **Approval batching.** Everything above a member's auto-fix threshold does NOT pause the sequence — collect into ONE consolidated approval table at the end, grouped by member (corrections triage rows included). Exception: a member surfaces something that materially changes a LATER member's input (rare) → surface immediately.
5. **Context-budget guard.** Before starting: if ≥4 members are due AND context is already heavy (rough read: >60% consumed), say so and recommend either a dedicated maintain session OR dispatching the read-heavy members (coherence, patterns, memory-audit Phase-1 reads) to reading agents — research reads may delegate; curation EDITS stay with the orchestrator (per meta principle "do memory work yourself").
6. **Persist-before-heavy.** If the run will be long, flush any in-flight session state to disk before starting.
7. **One commit.** All maintain-produced edits land in a single `meta(maintain): ...` commit with explicit pathspecs (`git commit -o`), never `-A` (a bare commit sweeps the index). One maintain run = one meta commit for SC-1 counting, regardless of how many members fixed things.
8. **Record.** End with the standard meta self-update: CHANGELOG entry listing which members ran + headline findings; MEMORY note only if something lesson-shaped surfaced (that's `/meta learn`'s job otherwise).

## Output format (inline, no file)

```
## /meta maintain — YYYY-MM-DD

### Context read
Last maintain: YYYY-MM-DD (Nd) · churn since: K expert MEMORYs / M SKILL.md / J meta-commits · sizes: project index N lines/KB, meta MEMORY N lines · notable: <anything shaping a member brief>
Filed for this run: N open rows (meta-maintain-filed-rows.py) · each → member, or left with its reason

### Run results (one block per executed member, that member's own output format, compressed)

### Consolidated approval table
| # | Member | Finding | Proposed action |
|---|---|---|---|

### Footer
Members run: N/10 · auto-fixes applied: K · proposals awaiting approval: M · commit: <hash|pending approval>
```

## Anti-scope

- **NOT in the family:** `learn` (session-end, owned by `/wrap`), `post-compact` (fka `postmortem`; compact-event-triggered), `distill` / `new-skill` (targeted owner-judgment operations). Maintain may RECOMMEND them when a member's output trips their trigger (e.g. memory-audit finds a MEMORY past the 4000-line soft budget → "distill candidate" in the footer) — it never auto-runs them.
- **No bypass of member approval gates.** Batching defers the ask to the end; it never converts propose-level findings into auto-writes.
- **Not auto-scheduled.** Owner-invoked only (monthly-ish). No hook fires it. If a member's trigger fires mid-session organically, the member's own trigger path handles it — maintain is the batch entry point, not a replacement for per-member triggers.
- **No HTML/dashboards.** Inline markdown only.

## Revisit

- **FIRED + RESOLVED 2026-07-19** — the original clause ("3 runs where the due-check selects ALL members every time → recalibrate or drop the gate") fired on its 3rd consecutive all-due run (2026-06-25 / 07-09 / 07-19, all 8/8). Diagnosis: the gate was structurally dead, not mis-tuned — `status`+`corrections` are always-DUE by design, telemetry's 7d cadence beats any monthly-ish invocation gap, and fleet velocity (e.g. 44 expert MEMORYs + 15 SKILL.md edits in the 07-09→07-19 window) saturates every churn trigger within ~a week. Resolution: gate dropped, `--all` semantics by default, fact-gathering kept as the non-gating context read. **Re-open trigger:** 3 consecutive runs where ≥3 non-always members come back trivially clean (zero findings, zero fixes) — evidence velocity dropped enough that the cadences bind again → consider re-introducing a gate.
- If a member consistently produces zero findings across 3 maintain runs, that member's own Revisit clause governs (most have one) — surface it in the footer.
