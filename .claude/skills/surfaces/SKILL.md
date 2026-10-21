---
name: surfaces
description: Show the audit-coverage status of the app's surfaces & lenses. Use when asking "which planes have been reviewed / what's stale / what should we audit next?" — the read-interface for project_surface_audits.md (the S# register). Analogue of /flows and /features.
---

# Surface & Lens Audit-Coverage Status

Read-only state-query over the **S# register** (`project_surface_audits.md`) — the 4th tracker namespace (sibling to `/flows` for Flow# and `/features` for F#). Where `/flows` answers "which journeys are audited?" and `/features` "which features?", **`/surfaces` answers "which PLANES of the app have been reviewed, through which LENS, how stale, and what's the biggest un-lensed gap?"**

**Read-only state-query — carries its own marker `[surfaces]`** (every reply is marked; same family as `/flows`, `/features`, `/status`).

## When to Use

When the user types `/surfaces` or asks about audit coverage, stale surfaces, which surface/lens to review next, or the prescribed-lens gaps.

## Subcommands

- **`/surfaces`** (no arg) — the default **coverage dashboard**: the surface×lens matrix + the live-blocker roll + any FIRED re-audit triggers + a "what to audit next" recommendation. *(The 3 scheduled gap-audits S23/S24/S29 were listed here as pending until 2026-08-22; all three completed 2026-07-09 — see Step 3.)*
- **`/surfaces list`** — the full **S# register rows** (each surface/lens: panel/date/plan-doc/findings-rollup/Lenses/Prescribed/Re-audit).
- **`/surfaces gaps`** — the **PRESCRIBED-LENS GAPS** section only (the ranked contextual-specialist gaps + the S23/S24/S29 mapping). "What lenses is each surface missing, and by whom should it be re-lensed?"
- **`/surfaces stale`** — run the freshness scan: which S# re-audit triggers have FIRED (a surface is due for re-review). Thin wrapper over `defer-trigger-scan.py` filtered to `S#-REAUDIT`/`S##-SCHEDULE` items.

## Instructions (default view)

The register is a **prose+matrix markdown file, not a clean pipe-table** like the flow/feature trackers — so read it **in-shell with grep/awk/sed**, not a full `Read` (it grows; a full Read is wasteful). Path: `.claude/project-memory/project_surface_audits.md`.

1. **The coverage matrix** — extract + paste it verbatim (it's a markdown table under `## COVERAGE MATRIX`):
   ```bash
   awk '/^## COVERAGE MATRIX/{f=1} f&&/^\*\*GAP/{exit} f' .claude/project-memory/project_surface_audits.md
   ```
   Paste the table into the reply so it renders inline (bash stdout collapses).

2. **Live-blocker roll** — which surfaces have a 🔴/YES live-blocker (build now):
   ```bash
   python3 - <<'PY' | sed 's/^### //; s/ ·.*//'   # python, not awk: a skill invoked WITH arguments has awk's dollar-digit fields replaced by the argument words
   import re
   s = ""
   for l in open(".claude/project-memory/project_surface_audits.md", encoding="utf-8"):
       l = l.rstrip("\n")
       if re.match(r"### S[0-9]", l): s = l
       if re.search(r"Live-blocker:.*YES", l): print(s)
   PY
   ```

3. **Scheduled gap-audits + fired triggers** — the freshness layer (this is what /flows and /features lack). Run the defer-scan filtered to S# items (use `--include-manual` so the never-run `S##-SCHEDULE` items show — they're `manual`-typed; the `grep-present` triggers appear WITHOUT the flag only once FIRED):
   ```bash
   # Two fixed-string filters. ⛔ The old `grep -iE 'S[0-9]+-(REAUDIT|SCHEDULE)'`
   # is DENIED by grep-blowup-warn.sh (block mode): variable-width quantifier
   # before an alternation. Measured 2026-08-22 — this step could not run.
   # SESSION-SCOPED path (cf. wrap/SKILL.md:115) — a fixed /tmp path lets a
   # concurrent seat overwrite this scan between the write and the greps.
   DTS=/tmp/dts-${CLAUDE_CODE_SESSION_ID}.txt
   python3 scripts/defer-trigger-scan.py --include-manual > "$DTS" 2>/dev/null
   head -1 "$DTS"          # ⛔ READ THIS FIRST — the void banner. See the note below.
   grep -inF 'REAUDIT'  "$DTS"
   grep -inF 'SCHEDULE' "$DTS"
   ```
   ⚠️ Verified to RUN; **set-equivalence with the denied original is
   UNVERIFIABLE** (the guard denies the original, so the two forms cannot be
   compared on the same input).
   ⛔ **READ LINE 1 FIRST — THERE IS A FOURTH BUCKET AND IT VOIDS THE OTHER THREE.** If line 1 carries `⛔ N INSTRUMENT FAILURE(S) — THIS RUN IS VOID`, N predicates could not be EVALUATED (a git/grep/eval error, or a `--since` git cannot parse), so every bucket below it is computed over a partial evaluation and none of them is a reading. Fix the instrument and re-run; do NOT triage the buckets. Measured 2026-09-06: one malformed `--since` moved DOABLE-NOW 71 → 2 and STALE 0 → 79 while rc, the unevaluated count and the RECONCILE bucket all stayed identical — every number this spec tells you to read was invariant under a totally broken run. ⛔ **AND THIS STEP CANNOT SEE IT WITHOUT AN EXTRA COMMAND — worse than the other three consumers.** The wrapper sends stderr to `/dev/null` and then greps `$DTS` for exactly two literals (`REAUDIT`, `SCHEDULE`), and the banner contains neither, so a totally void run reads here as *no surfaces are stale*. **The `head -1 "$DTS"` is now IN the block above** — ⚠️ *it was not, for a day: an earlier edit wrote this paragraph's remedy as prose and left the copy-paste block byte-unchanged, so anyone who ran the block still could not see the banner. The reusable half: **a spec fix whose remedy is a command change edits the fenced block, not the paragraph beside it** — a reader copies the block, and prose adjacent to a runnable snippet is not shipped.*

   A `DOABLE-NOW` hit on a `grep-present` trigger = a fired re-audit (surface is stale, re-review it). To tell DOABLE-NOW from STANDING-RULES, compare the hit's line number against the section headers (`grep -n -v '^ ' /tmp/dts.txt`) — the bucket is positional, not labelled per row. The env-flag-gated grep-present triggers stay silent until their flag flips (armed, correctly not firing).

   ⛔ **The `S##-SCHEDULE` items are NOT pending — all three are DONE.** S23 (security), S24 (/pay), S29 (growth/CRO) all completed **2026-07-09**; S29 is `[x]` and S23/S24 are archived `↪`, which is why the scan returns ZERO `SCHEDULE` rows. *(This spec described them as "the never-run audits" until 2026-08-22 — a reader following it recommended three finished audits.)*

4. **What to audit next** — recommend from, in priority order: (a) any surface with a FIRED re-audit trigger, (b) the highest-ranked PRESCRIBED-LENS GAP. *(The old (b) — "the never-run scheduled audits S24 → S23 → S29" — is retired: they ran 2026-07-09, see above.)*

5. **Never eyeball status from memory** — read the row. The `Live-blocker` + `Findings` fields are the source of truth; a re-audit UPDATES a row in place (retirement rule), so the row is always current.

## Process — `list`

Render the full S# rows. The register groups them: SURFACE rows (S1-S12, S24, S26-S28), LENS rows / sweeps (S13/S15-S20/S23/S29), and `## Superseded`. Extract per group:
```bash
# all S# row headers + their one-line status
grep -nE '^### S[0-9]+ —' .claude/project-memory/project_surface_audits.md
# a specific surface's full block:
awk '/^### S7 —/{f=1} f&&/^### S[0-9]/&&!/^### S7 —/{if(seen)exit} /^### S7 —/{seen=1} f' .claude/project-memory/project_surface_audits.md
```
Present grouped by TYPE (SURFACE / LENS / SCHEDULED-not-run / SUPERSEDED). Do NOT full-`Read` the file; awk the block you need.

## Process — `gaps`

Paste the `### PRESCRIBED-LENS GAPS` section + the `Prescribed:` fields:
```bash
awk '/^### PRESCRIBED-LENS GAPS/{f=1} f&&/^---/{exit} f' .claude/project-memory/project_surface_audits.md
```
The value-add vs the matrix: the matrix shows COMMON-lens `·` gaps; `gaps` shows the CONTEXTUAL-specialist gaps (a lens the scope demands that isn't even a matrix column — CRO/growth/engagement/economist/community/ops). End by naming the 3 sweeps that closed the cluster — all three RAN 2026-07-09, so name them as done, not as planned: **S24** (/pay), **S23** (security), **S29** (growth/CRO/engagement).

## Output Format

Concise. Default view: the matrix table (pasted) + a live-blocker bullet list + the scheduled/fired-trigger line + a one-line "audit next: X" recommendation. Mirror the tone of `/flows` / `/features`.

⛔ **A STATUS CELL IN THAT MATRIX IS A CLAIM, NOT EVIDENCE — cross-check against git before RELAYING any of it** (`git log --oneline -- <file>`); a cell reading done/applied/shipped whose commit you have not seen is unverified, and saying so costs nothing. **This line is here rather than in the shared tracker footer because `/surfaces` is the ONE tracker reader that does not go through `scripts/tracker-list.mjs`** — `/ops`, `/flows` and `/features` get it emitted with every listing, and measured 2026-09-19 all four carried the rule zero times while `/backlog` carried it explicitly.

## Coordination with other skills

- **Adding an S# row** (a new panel) → `project_surface_audits.md` (the register is the tracker-home; the tracker convention recognizes S#). Update the matrix + `Lenses:` + `Prescribed:` + `Re-audit:` at synthesis, and add a `todo.txt` `S#-REAUDIT` meta-block if the trigger is machine-evaluable.
- **`/orient`** Step 8 already surfaces fired S# triggers via `defer-trigger-scan.py` — `/surfaces stale` is the on-demand form.
- **`/meta`** cross-tracker validation recognizes `S#` as a tracker-home (`backlog/SKILL.md:25` grep enum).
- **The ranked backlog** holds the BUILD items from these audits; this register holds COVERAGE/provenance. Don't duplicate — the register carries rollup pointers, not SHAs.

## Why this skill exists (2026-07-09)

The 22-panel Fable audit arc built `project_surface_audits.md` (the S# coverage register + surface×lens matrix + `Prescribed:` lens-gap dimension), but there was no read-interface — you'd read the file by hand. `/surfaces` is that interface, completing the tracker-triplet: `/flows` (journeys) · `/features` (features) · `/surfaces` (planes/lenses). Its distinctive value over the other two: it renders the coverage MATRIX + the freshness triggers + the prescribed-lens gaps, none of which the flow/feature trackers have.
