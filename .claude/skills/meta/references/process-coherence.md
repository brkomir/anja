Cross-check user preferences (from `user_profile.md` + all `feedback_*.md`) against actual skill-spec behavior. Surfaces drift between "user said they prefer X" and "skills actually implement X." Read-only; output is a compliance matrix. Companion to `/me` (which runs 2–3-probe shallow spot-checks on default invocation) — this is the exhaustive sweep.

**When to run:** monthly; OR after major skill-spec edits (verify new spec didn't override a user preference); OR when user asks "is my preference being honored consistently?".

**Steps:**

1. **Extract user preferences.** Read `user_profile.md` + every `feedback_*.md` in the project memory directory. Build a list of discrete, concrete preferences — each one a ≤15-word phrase (e.g., reports go inline rather than to a file; consult the customer persona proactively on UX; translate internal codes on first use; never use git stash; destructive hygiene ops trigger late rather than preventively). Skip identity claims (business entity, stack) — these aren't behavioral preferences.

2. **Map preferences to target skill specs.** For each preference, curate the small list of skills where it *should* apply. Example mappings:
   - inline reports, not files → observations, meta, orient, status, flows, features, ops, backlog
   - customer persona consulted proactively on UX → expert-review, ux-design-pro routing
   -  internal codes translated on first use → observations, orient, /wrap, any report-producing skill
   - no git stash / no git add -A → wrap, audit-check, agent-work, and the .claude/hooks/bash-safety-warn.sh hook
   - destructive hygiene triggers late → meta (distill), observations (hygiene section)
   - recommend AND execute for <15 LOC → every command skill
   Not every preference has a target — some are orchestrator-level (applied inline, not codified in a spec). Those get flagged as "orchestrator-enforced" with no matrix row.

3. **Classify each target skill per preference:**
   - **COMPLIES** — spec explicitly references the preference OR mirrors it in output format / procedure
   - **SILENT** — spec doesn't address the preference (may or may not comply in practice; no drift but no signal)
   - **CONTRADICTS** — spec explicitly states opposite behavior (real drift; high-priority finding)
   - **N/A** — preference doesn't apply to this skill's scope

4. **Build the output matrix + gap analysis.** One section per preference:
   ```
   ### Preference: reports go inline, not to a file
   COMPLIES (N):   observations, meta
   SILENT (M):     orient, status, flows, features
   CONTRADICTS (K): — none
   ```
   After the per-preference matrix, aggregate:
   - **Red flags:** every CONTRADICTS entry (name the skill + quote the contradicting sentence + propose a 1-line fix).
   - **Amber flags:** SILENT entries where the preference plausibly applies (the skill produces reports but doesn't state format discipline).
   - **Green:** preferences where every target skill COMPLIES.

5. **Propose fixes for CONTRADICTS only.** SILENT entries do not auto-propose edits — they're observations, not drift. Propose edits inline for the user to approve; do NOT auto-apply (this subcommand is read-only).

6. **Summary footer:**
   ```
   Preferences scanned: N (from user_profile.md + M feedback files)
   Target skills scanned: K
   CONTRADICTS: {total}
   SILENT-but-relevant: {total}
   Overall coherence score: {COMPLIES / (COMPLIES + SILENT + CONTRADICTS)} — informational only
   ```

**Output shape:** see [`references/report-formats.md`](references/report-formats.md) § Coherence (the prior inline render — a dated 2026-04-19 snapshot — was extracted + de-dated 2026-06-22 to stop it rotting on every `/meta` load).

**Scope boundary:** read-only. No writes to skills, no writes to memory. Output is the matrix + fix proposals for user approval. Applied edits go through the user's explicit "yes, apply X" + Edit tool.

**Revisit:** if `/meta coherence` runs 3× with 0 CONTRADICTS and 0 actionable SILENT findings, the cross-audit is over-engineered — prune or relax. If it consistently surfaces 3+ CONTRADICTS, preference propagation discipline is weak — propose scaffolding (e.g., a hook that greps new skill-spec commits against preference keywords).
