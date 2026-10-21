# Process — Executing-Triage (subcommand: `triage <rules-file>`)

Codified 2026-08-26 at N=3 (codification waited for one more run), after three runs:
`bash-environment.md` (4 dead facts + ~5 KB narration displaced), `active-recall.md` (11 broken
facts; a 5-seat review then refuted the cut list's own arithmetic), `behavioral-anti-patterns.md`
(12+ broken facts incl. a coverage count blind to its own instrument). The program's yield is
FACTUAL REFUTATIONS first, byte relief second — expect that shape, not the reverse.

**What it is:** a verify-by-RUNNING triage of ONE always-loaded rules file. Agents do not grade
prose; they EXECUTE the file's checkable claims and classify every unit on the result.
**Owner-invoked.** Corrections ship immediately; cuts are ALWAYS owner-gated.

## Phase 1 — dispatch (2 read-only agents)

Two background **opus** agents, file split by section/entry ranges (balance bytes, not lines).
UNIT = one table row / one `##` entry; a giant entry (a commit-row, a #9) triages per sub-block.
Briefs carry, non-negotiably:

- **READ-ONLY**: no writes, no commits, no mail, no mutating commands; deliverable = return message.
- **Disk, not context**: the loaded copy is a per-session memo re-read from disk whenever a compaction clears it (⛔ read "session-start snapshot" until 2026-09-09; refuted — the directive is unchanged, the mechanism was wrong); locate by HEADING/row NAME,
  never line numbers (the file moves under you — measured 3 commits in one morning).
- **CLASSES**: KEEP · DISPLACE · DUP · DEAD · LOW-SEV · STALE-NUMBER (+ KEEP-ADJUDICATED).
- **THE EXECUTING MANDATE**: run every cited command/script/grep the unit prescribes; existence-
  check cited files/hooks/todo-rows/sections; re-derive every inline figure; ADDRESS≠CONTENT —
  verify the claim sits INSIDE the cited container.
- **L# existence**: `lesson-mint.mjs status` enumerates only its OWN ledger (measured: 59 of 350
  in-range IDs absent; zeros prove nothing at ANY number) — use the exported `scan()` from
  `scripts/check-lesson-numbers.mjs` or an anchored `\bL<n>\b` grep over `.claude/skills/meta/`
  (the DIR) + `.claude/rules/`.
- **THE DUP TEST**: DUP only if another ALWAYS-LOADED carrier delivers the same ACTION to the
  same AUDIENCE at the same MOMENT. Mention ≠ dup; trigger-moment splits (shell-operating vs
  claim-composing) are BY-DESIGN double-carries; a when+what / why split between files is design.
- **BYTE DISCIPLINE**: never top-down targets. Per DISPLACE candidate measure bottom-up:
  total B · anchored B (backticks/bold/L#### — what the preservation gate can hold) ·
  genuinely-narrative B. Free prose ≠ narration: unbolded directives/qualifiers are NOT cuttable.
  (Round 2's "~4.7 KB of narration" measured as 50% of the rows' ENTIRE action column.)
- **ARC PROTECTIONS**: (1) grep every relevant `rules-ARCHIVE` file for `restored:` markers —
  AND check `git log` for owner-ruled restorations that PREDATE the marker convention (one
  false-zeroed a panel sweep); (2) same-day corrected/adjudicated spans are skip-class for cuts;
  (3) grep `.claude/hooks/` deny/warn texts — a live guard already delivering a story strengthens
  displacement; (4) the ACTION TEST governs number-drops (does the surviving text still determine
  the action?); (5) probe discipline: `-F` for metacharacter literals, `-i` on prose, no caps on
  characterized output, positive controls on zeros.
- END WITH: bucket counts · per-unit byte table · FACTUAL REFUTATIONS · 3 least-confident calls
  with a skeptic's check each. No Memory Update blocks.

## Phase 2 — orchestrator verification + corrections

- **Re-derive EVERY refutation yourself before applying.** An agent claim is a candidate.
- Corrections REPLACE the sentence they correct; ship immediately (the correction law), commit
  via `safe-commit.sh`, then **hub review** of the corrections commit (builder≠breaker).
- ⛔ **A correction that installs a SCOPE WORD — below/above/only/all/every — has made a NEW
  claim, and it is the one nobody probes** (round-2 review: a "below the base" boundary was
  itself false). Probe the boundary you introduce, both sides, before shipping.
- A pointer correction is TWO edits or it is a loop — check what the new landing site points at.

## Phase 3 — the cut wave (owner-gated, ALWAYS)

Present candidates via AskUserQuestion with a decision-instrument option (panel-review). If ruled:

- Fresh archive writes **byte-verbatim, in the SAME commit** as the band edit (a stale
  prior copy credits nothing), under a dated `§ WAVE-<date>` heading with SOURCE sha.
- A per-row **pointer** to the archive section lands in each cut row.
- Panel/self-named **kept-sentences stay live and get BOLDED** (the gate protects bold).
- **Trigger cells frozen**; row deletions never ride a displacement.
- Verify: `band-directive-preservation.mjs --base <pre-sha> --head HEAD` on committed refs —
  read the VERDICT LINE, never rc (rc=2 refusals exist; pipes eat rc); its green is
  ARCHIVE-faithfulness only — pair the 5-item HAND-READ (qualifier diff per rewritten line ·
  unbolded-hedge sweep · ARGUES-FOR vs SEPARATES-TWO-STATES · pointer retention · executability).
- ⛔ **Diff the SET of bold spans before/after** — a compressed clause that MOVED INTO bold was
  promoted from EVIDENCE to DIRECTIVE, and an anchor gate cannot see it (the anchor is present in
  both states; measured ×2 in one hour, 2026-08-26). Tense/quantifier deltas ride the same check.
  Archive section names must be FILE-UNIQUE, or every pointer names its file.
- Pin refresh ratchets DOWN only; **band `--ratchet` and pin hand-raises are OWNER-only.**
- Hub review of the wave commit closes the round.

## Anti-scope

- Never run on a file the owner adjudicated the same day (verify claims only).
- Never hold a factual correction for the cut ruling — different laws, different gates.
- Not for product code or skills — always-loaded rules files (and their governance) only.

**Revisit:** after 3 more runs, check the refutations-per-run trend — if it approaches zero the
corpus is converging and the cadence stretches; if byte yield stays under ~1 KB/run, drop Phase 3
from the default shape and keep the verification passes.
