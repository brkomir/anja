# External Audit — External-System Calibration Panel

Audit our workspace / meta system using the external-system expert skills (`.claude/skills/external-*`, kept in the source project, not shipped) as a calibration panel. Each expert brings an outside-system baseline — what THEIR system does differently — and surfaces (a) gaps, (b) over-engineering, (c) strengths in ours worth keeping.

> Renamed from `/expert-audit` (2026-06-17): the salient feature is *external-system* calibration; "expert" carried no signal and collided with `/expert-review` (which is also expert-run). `/expert-audit` still resolves as a deprecated alias.

**Subject:** whatever follows `/external-audit` (e.g., `/external-audit claude-system`, `/external-audit memory-architecture`, `/external-audit hooks`). If no subject, default to "our entire `.claude/` workspace infrastructure."

## When to invoke

**Legitimate:**
- Once 30 days of product data exist (main cadence)
- After adopting patterns from a new external system → audit surface once to calibrate
- Quarterly rhythm check (every 3-4 months during active meta development)
- Architectural decision surfaces ("should we keep/change approach X?")

**Do NOT invoke for:**
- Workspace-subject audits before a product has traffic — displacement activity; product work is higher-leverage. Use `/expert-review` for flow/feature audits instead.
- Minor infrastructure tweaks — ship directly via `/meta queue` + CHANGELOG edit.
- Non-workspace product/UX subjects (pricing, onboarding) — use `/expert-review` with domain experts. The external-* experts are specifically workspace-infrastructure calibrators.

## Preflight: refresh stale stat-blocks FIRST (mandatory before the panel)

The panel reasons against each `external-*/SKILL.md` + MEMORY stat-block. A stale block means the panel **cannot surface findings in data it didn't re-fetch** — so a "low yield / 0 new" verdict over a partially-refreshed roster is an artifact of staleness, not a real result.

1. `node scripts/external-staleness-check.mjs` — tier every system GREEN / YELLOW / RED.
2. For each **YELLOW/RED** system: run a `/scout` self-refresh (live-fetch the primary source; verify stars/version/structure **and scan for new patterns since `last-fetched`**; update the stat-block; bump `last-fetched`). Dispatch one agent per system in parallel; hard rule against training-memory fills. ⛔ **EXCEPT a system whose `upstream-status` frontmatter reads ARCHIVED / frozen: there is no source left to fetch, so it gets no seat, no refresh, and its RED tier is PERMANENT rather than a work item** — `external-vinicius91carvalho-claude` (ARCHIVED-IN-PLACE 2026-08-12; re-point REFUTED, not merely unverified). Step 1 tiers every system on disk, so the roster below — not the tier list — is what decides who gets refreshed.
   ⛔ **Paste `.claude/skills/scout/SKILL.md` § THE RETURN CONTRACT into every refresh or re-catalog brief** — `## UNVERIFIED` split into *could not check* and *checked, and it was wrong* (the second kind leaves as a patch or a named work item), and every PROPOSED EDIT either literal old→new text or a labelled WORK ITEM, so a builder never has to ask which kind of cell it is holding.
   ⛔ **A deep re-catalog, or a NEW-expert build after the audit, reads a FULL CLONE — never the contents API alone: the repository is downloaded and analysed whole, so the expert is built properly.** The orchestrator clones into the session scratchpad at a pinned sha and hands the seat the absolute path; the seat executes nothing from the clone. Mechanics and the brief's seven asks: `.claude/skills/scout/SKILL.md` § CLONE BEFORE YOU CATALOG. A stat-block self-refresh stays on `gh api` (stars, forks, pushed date, published release: GitHub metadata a clone does not carry); a pattern or structure change the refresh surfaces is body depth, so it leaves as a WORK ITEM for a clone read, never as a body PATCH written from API reads.
3. **Only THEN** judge yield. If a refresh surfaces a new adoptable pattern, that IS the audit's yield — it was invisible to the stale read.

Evidence (2026-06-17): the audit concluded "0 new" against 05-18 snapshots for 4 of 7 systems; a post-hoc refresh found 3 had moved materially (ECC v2.0.0, Superpowers v6, wshobson 5-tier) + 2 adoption candidates. The staleness gate was built as that audit's OUTPUT, so it couldn't gate it — this preflight fixes the ordering.

⛔ **EVERY EXTERNAL EXPERT HAS TWO DESCRIPTION SURFACES — A REFRESH OR RE-CATALOG THAT UPDATES ONE HAS HALF-SHIPPED (2026-08-11).** `.claude/skills/<name>/SKILL.md` **and** `.claude/agents/<name>.md` each carry their own `description`, and they drift independently: measured 2026-08-11, **5 of 8 external experts had divergent pairs**. **The agent one is the surface that steers DISPATCH** — an orchestrator picks a lens from the Agent listing — so the stale copy is the one doing the work, and a brief written from it inherits an old catalog while freshly-verified numbers sit one file over. Self-demonstrating at the time of writing: one seat held ECC at `236k/64/261/84` from its Agent listing and `239k/68/286/94` from its skills listing, in the same context.

⛔ **AND WHEN A RE-CATALOG CONTRADICTS THE OLD BODY, CHECK THE OLD TAG BEFORE WRITING "WE WERE WRONG" (2026-08-11).** A cached claim about a moving target has two failure modes that read identically at re-catalog time: **stale-but-once-correct** (upstream changed) and **wrong-at-birth** (we mis-catalogued). Measured: a shinpr re-catalog recorded "two claims in our body were FALSE"; the v0.21.1 tag carried an *"Orchestrator's Permitted Tools"* allowlist verbatim, so the old body had been accurate and upstream weakened it. **The two teach opposite behaviour** — "we were wrong" tells the next reader to distrust the catalog, "upstream moved" tells them to re-verify it — and only the second is usually true. **Cost of the check is one raw fetch at the tag the body was cataloged at**, which the frontmatter already records. Attach the observation tag to the claim, not just the file.

**Check: after any refresh or re-catalog that changes a `description`, `git diff --stat` must show BOTH files for that expert** (`node scripts/generate-expert-agents.mjs`; `external-guildhall` by hand). ⛔ **Since 2026-09-23 the description carries NO stats — stars, versions, counts and shas go in the body table and `repo-stars-at-fetch`. A stats-only refresh leaves both descriptions untouched; writing a number back into one re-grows the listing that change cut.** Two of the five divergences were created that same session by re-catalogs that touched only `SKILL.md` — i.e. the defect is produced BY the refresh procedure, not by neglect between refreshes, which is why the check belongs here rather than in a tracker row. Note the two files use different YAML shapes (folded `>-` vs quoted scalar), so they are separate populations for the ~1,535-char listing cap too.

## Anti-correlation block — re-runs / override-runs (2026-06-18)

The Preflight above is one-directional: it guards STALE inputs (don't judge yield on un-refreshed data). The **inverse** failure is **correlated re-derivation** — re-running the full panel against data it was *just* calibrated against. There the 6 agents re-confirm the prior panel's findings and it reads like fresh signal; the panel manufactures phantom yield instead of false-low-yield.

**When this fires (= an override-run):** a prior `/external-audit` process-log for this subject is recent (roster refreshed / same subject audited in the last ~2 weeks), OR the owner explicitly overrode the defer-by-design / extend-cadence posture to re-run.

**What to do — inject this block VERBATIM into EVERY agent brief** (fill `{priors}` + `{net-new surface}`):

> ⚠️ **ANTI-CORRELATION (this is a re-run against recently-audited data).** A prior panel already produced: `{paste the prior C-series convergences + key adoption items}`. **DO NOT re-derive them.** Surface ONLY: (a) a NET-NEW finding, (b) a prior convergence re-pressure-tested WITH NEW EVIDENCE, or (c) an explicit "I confirm `{Cx}`, nothing net-new from my lens." The genuinely-new surface since the prior panel is: `{list the deltas — new commits / features / mechanisms / shipped adoption items}`. **Honesty about low yield is REQUIRED** — manufacturing a finding to justify the re-run is the exact anti-pattern. You are the breaker, not the builder.

**Why codified (not hand-authored):** validated 2026-06-18 — the first override-run hand-wrote this block into all 6 briefs and it held (zero manufactured findings), but it depended on the orchestrator REMEMBERING to write it; a future override-run that forgets re-correlates silently. Symmetric inverse of the Preflight's `last-fetched` staleness gate.

**Auto-detect the override-run (shipped in warn mode; N=1 params + revisit).** PREFLIGHT (orchestrator, BEFORE composing the panel): grep `plans/external-audit-<subject>-process.md` (+ legacy `plans/expert-audit-*`) — if a prior process-log for this subject has mtime **< 14 days**, this run is an OVERRIDE-RUN →
1. **inject the anti-correlation block above into EVERY brief** (no longer dependent on the orchestrator remembering — closes the gap the hand-written block left);
2. emit a **`⚠️ OVERRIDE-YIELD-RISK`** line in the synthesis header ("re-runs data audited <14d ago — honest low yield is the EXPECTED result, not a shortfall");
3. **DEFAULT to a 2-expert spot-check** (the 2 most subject-relevant externals + the block) instead of the full external roster — the owner may scale back up to the full panel.
4. **Reconcile the prior run's adoption ledger against GIT STATE, not ledger text** (added 2026-07-02 from a review-seat finding — this run's ledger reconciliation happened ad hoc, without a written step; codify it). BEFORE composing the panel, classify each prior-ledger item: **SHIPPED** (cite the commit) / **DEFER-trigger-live** (trigger not yet fired) / **TRIGGER-FIRED-unactioned** (= a finding for this run) / **EVAPORATED** (neither shipped nor formally deferred = a finding). The git-not-text clause is load-bearing: the 06-22 ledger's written statuses went stale within hours (four items read DEFER; a same-day defer-gauntlet shipped them un-annotated) — a text reconciler false-flags "evaporations." Feed the result into every brief's `{net-new surface}`.

**N=1 calibration caveat:** the 14-day threshold + the spot-check-default were set from a SINGLE override-run (2026-06-18). **Revisit-trigger:** tune both on the 2nd override-run — if 14d mis-fires (a legit non-correlated re-run flagged) or the 2-expert spot-check MISSES a real net-new finding, adjust. Warn-mode by construction (every output is orchestrator-overridable) → safe to ship pre-calibration under warn-before-block discipline.

## Panel (fixed, 10 experts: 9 external + 1 contrarian — exceeds the 7/wave cap, so `/expert-review` runs it in 2 even waves of 5; 7 external until 2026-10-09, when a roster widening seated cosmix/loom and, the same evening, fagemx/edda, built from a full clone)

- `external-wan-huiyan-agent-review-panel` — adversarial panel mechanics, sycophancy detection, confidence gating
- `external-wshobson-agents` — marketplace scale, five-tier model strategy, PluginEval
- `external-alirezarezvani-claude-skills` — skill authoring standards, memory curation lifecycle
- `external-guildhall` — measuring a meta system's own outcomes, instruments, gates and policy levers *(took the seat vacated when `external-vinicius91carvalho-claude` was archived in place: that system is FROZEN, gets no seat and no refresh — see its `upstream-status` frontmatter — and was RETIRED 2026-10-09: its agent removed, its skill folder kept as the calibration record, and it is not one of the nine externals the heading counts)*
- `external-shinpr-claude-code-workflows` — phase boundaries, orchestrator discipline, reverse-engineering
- `external-everything-claude-code` — runtime-observed continuous learning (hook-captured instincts), largest-framework scale
- `external-superpowers` — Iron-Law skill authoring, mandatory-phase pipeline with hard gates
- `external-cosmix-loom` — review closure bound to a change fingerprint, hook exemptions keyed on unforgeable payload fields, compaction handoffs, paired before/after measurement *(seated 2026-10-09 in the roster widening; body deep-cataloged from a full clone at a pinned sha)*
- `external-fagemx-edda` — reviewer independence refused in code (author ≠ reviewer, reviewer-model grading), two verdict rules by use (union for PR review, newest-wins for the plan gate), head pinning at merge and a base-window check under `review gate --base`, peer claims with heartbeats, rule lifecycles that decay *(seated 2026-10-09 in the same widening; body deep-cataloged from a full clone at `46bf30ec215546912a1833b3c3b808e53f9e0025`, the clone seat's 28 PATCHes folded)*
- **Contrarian:** `saas-architect` (default; rotate if used within last 3 audits per tracker COMPLETE flip)

## Each expert answers 3 questions for the subject

1. **What gap does your system expose in ours?** Reference your MEMORY.md verdict matrix. Cite specific mechanisms from your external system.
2. **What have we over-engineered relative to your baseline?** Where does our approach exceed what your system achieves with less machinery?
3. **What do we do well that we should defend?** Not every divergence is a gap — credit our correct distinctive choices.

Return findings with severity P0/P1/P2, evidence citation (file paths / line numbers / MEMORY refs), and a recommended adoption target (meta adoption queue / new skill / new hook / `.claude/rules/*.md` / REJECT).

## Synthesis rules (inherit from /expert-review)

- Group findings by topic, not by expert
- Flag cross-system convergence: 2+ experts surfacing same finding → promote severity one step (v2.7.0 Guideline 14)
- Contrarian MUST surface ≥1 concrete concern (v2.7.1 MUST-find rule)
- Correlation notice if ≥50% panel converges on similar verdicts without distinct evidence
- Process log to `plans/external-audit-<subject>-process.md` (v2.7.2 pattern for 6+ expert panels; pre-2026-06-17 logs are named `plans/expert-audit-*`)
- Two waves ⇒ `/expert-review` Step 5's DIRECTIONS clause binds here too: a numbered `## Wave-1 DIRECTIONS for wave 2` block (`D1`…`Dn`) in the process log, and one `D<k>:` disposition line per direction in every wave-2 return (2026-10-09: this command's first 2-wave run carried its directions as unnumbered bullets — 0 such headings, 0 `D<k>:` lines — so a dropped direction reads the same as a declined one)
- Before synthesis, run `python3 scripts/readonly-brief-compliance.py --since <today>` and quote this session's `read-only briefed / wrote` line (2026-10-09: 65 / 0) — a seat's no-edit claim is verified from its own transcript, never from its return

## Default posture: defer-by-design

This audit populates the v2.9.x+ adoption queue. **No P0 severity unless:**
- Trigger condition is clearly met (30+ days of product data verify the concern)
- Architectural regression surfaced by 3+ experts independently with distinct evidence
- Direct user-visible consequence documented

Findings default to P1/P2 with trigger conditions for promotion (per the defer-with-trigger gold pattern). Add to the `## Adoption Queue` section of `.claude/skills/meta/ADOPTION-QUEUE.md` (never the `MEMORY.md` router, whose generated section is rewritten) under a new `### v2.9.x+ from /external-audit <subject> YYYY-MM-DD` subsection.

⛔ **TEST EVERY DEFERRAL ONE BY ONE BEFORE THE LIST REACHES THE OWNER — A POSTURE IS NOT A DISPOSITION.** The default above is a rule about SEVERITY and it silently becomes a rule about WORK: an item lands at P1-with-a-trigger because the posture says so, never because anyone asked whether it was ten minutes away from done. **Measured on the 2026-09-13 meta audit: of the deferrals this command's own posture produced, roughly 85% were built the same day — the moment someone asked which of them were legitimate.** Nobody should have to be the instrument that asks.

**So before the queue table is written, walk the deferrals individually and put each in one of three states, named in the output:**
1. **SHIPS NOW** — the change is mechanical, under ~50 LOC, and touches nothing frozen or owner-gated. Build it in this session; the standing ship-now rule already says so, and the posture was overriding it.
2. **GENUINELY DEFERRED** — name the concrete thing that is missing (data that does not exist yet, a frozen file, a dependency not built) and the trigger that would change it. *"Low priority"*, *"post-launch"* and *"needs a design decision"* are not missing things; if you cannot name what is absent, it is state 1.
3. **OWNER'S** — a taste call, an external fact, or an irreversible action. These are the only ones that belong in front of the owner as questions.

⚠️ **The test is per ITEM, not per LIST** — a batch verdict (*"these are all post-launch"*) is the failure restated at a coarser grain, and it is the shape this section's own posture invites. State the count in each state beside the queue table so the split is visible rather than asserted.

## Output

1. Per-expert verbatim output saved to `plans/external-audit-<subject>-process.md` (before topic-grouping collapses it)
2. Topic-grouped synthesis table in response
3. Cross-system convergence callouts (continue C-series numbering from meta MEMORY's current C9)
4. Adoption queue additions (subject-scoped, trigger-gated). **Use explicit per-item labels:** **SHIP** (lands this session) / **DEFER until T** (NOT shipping; T is concrete trigger) / **OBSERVE** (ships but under-observation). Never "queue" — ambiguity between ship-with-trigger-annotation vs defer-until-trigger creates round-trips.
5. "Worth keeping" defense list (things NOT to change — equally important as gap list)
6. **Override log (when applicable):** if this audit ran under explicit user override of the default defer-by-design posture (e.g., an instruction to treat every issue on its merits, or a statement that the session is not displacement), append a one-liner to meta MEMORY under the session's Panel Playbook entry: `**Override log:** YYYY-MM-DD {audit-name} ran under explicit override; {N} findings weighted as override-output.` Makes the override traceable across future audits + calibrates future false-urgency prior.

## Coordination

Invokes `/expert-review` under the hood with the fixed panel above. All `/expert-review` synthesis rules, contrarian mechanics, and Targeted Verification (v2.7.2) apply. The panel playbook auto-updates in the current meta memory shard per `/expert-review` Step 3b.
