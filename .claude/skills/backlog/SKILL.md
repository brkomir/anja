---
name: backlog
description: Show + maintain the ranked feature/improvement queue in BACKLOG.md. Use when the user asks "what should I build next?", when promoting an idea into a ranked tier, or when refining priority on an existing one. (Unranked idea CAPTURE lives in /ideas → IDEAS.md; promotion happens here.)
---

# Backlog — What to Build Next

A lightweight viewer + writing convention for the project's ranked build queue. The file `BACKLOG.md` (project root) is the single source of truth; this skill exists to format, add, and refine.

## The four-file roles (memorize this split)

| File | Role | Test |
|---|---|---|
| `BACKLOG.md` | **WHEN/PRIORITY** — ranked queue of features + improvements to build | "What's next to ship?" |
| `IDEAS.md` | **PIPELINE/DISPOSITION** — unranked idea capture + fate (💡/🔬/🅿️/⬆️/❌), incl. ideation-run corpora index (`/ideas` skill) | "What have we thought of, and what did we decide about it?" |
| `todo.txt` | **PENDING OPS** — ops checklists, bugs, monitoring, legal/docs, test-writing, blocked items | "What operational tasks + bugs + monitoring do I owe?" |
| `plans/*.md` | **HOW/WHY** — design docs for specific features | "If I were the engineer, would I want to read this before building?" |

An item lives in **exactly one** of these. Cross-referenced, not duplicated. (Ideas split out of BACKLOG.md 2026-07-10 — same dedicated-surface-per-concern pattern as the original BACKLOG/todo split.)

**Audit-tracker contract (mandatory).** Every P0/P1/P2 entry MUST point at an audit-tracker home (Flow#/F#/OPS#/S#) at creation OR carry a `NEW {Flow#|F#|OPS#|S#} proposed:` marker. (`S#` = surface/lens audit-coverage register `project_surface_audits.md`, the 4th namespace, added 2026-07-09. **`AQ` = the meta-system's adoption queue, the 5th namespace, added 2026-08-14 — the home for META-SYSTEM rows, which have no product tracker by construction.** AQ is not an exemption: it is an existing live register whose rows are edited in place and move to the meta changelog with version + SHA on ship — the same receive-the-audit lifecycle the other four provide — and `session-cadence.md` SC-1 already routes deferred meta proposals there. Backfilled onto four entries the day it was added; no validator change was required, since the predicate's first alternative is the bare literal `→ Tracked under `. **Do NOT reach for AQ to dodge a product home** — a row that touches `src/` has a Flow/F/OPS/S home even when it feels infrastructural; AQ is for work whose artifact IS the meta-system.) Without a tracker-home, the item ships invisibly: `/audit-check` writes to the audited Flow/F/OPS row, and silent-debt accumulates when there's no row to receive the audit. Three sub-rules:
- **(A)** NEW P-items declare `→ Tracked under Flow #N / F# / OPS# / S# / AQ` OR `NEW Flow#/F#/OPS#/S#/AQ proposed: <one-line>` at creation.
- **(B)** COMPOSITE shipped items at archive enumerate per-component absorption: each work stream → which Flow/F/OPS row absorbed its audit.
- **(C)** Internal-optimization items (cost/perf of an existing feature) are P-rows INSIDE the F# tracker, not top-level BACKLOG.

**Validation: `node scripts/backlog-tracker-home-check.mjs`.** ⛔ **RUN THE SCRIPT — DO NOT HAND-BUILD THE GREP.** Until 2026-08-25 this gate was prose-only: `grep -rlF 'Tracked under' scripts/ .claude/hooks/ tests/` returned **0**, so every run rebuilt the regex by hand and the predicate drifted from practice in BOTH directions at once — false alarms on 6 entries carrying a real home in an unrecognised form, real silence on 16 with none. The commonest hand-built error is forgetting the `*`-strip below, which mis-flags `**Parent capability:** F#` — a **false alarm on exactly the entries whose authors bothered to mark them**, and it was committed by the author of the row about the drift, the same day. The script also reports **outstanding `NEW <slot> proposed:` markers**, which satisfy the gate and which nothing else will ever surface again (4 live as of 2026-08-25). `--self-test` carries 23 assertions incl. RED controls, mutation-verified on three independent claim classes; `--strict` also fails on an outstanding proposal; a parse yielding zero ranked entries is an ERROR, never a clean pass. **The prose below documents the same forms and the two move together or neither** — the script's `HOME_FORMS` / `BARE_ARROW` / `NEW_SLOT` constants are the SSOT.

The predicate covers every P0/P1/P2 heading BODY (not just the line under the heading — markers sit anywhere in the entry), matching **any** of these, after stripping `*`:

`→ Tracked under ` · `→ Belongs inside ` · `→ Tracked in full: ` · `→ Straddles ` · `→ Full register: ` · `Tracker-home: ` · `Parent capability: ` · `NEW (Flow|F|OPS|S).* proposed:` · a bare arrow reference `→ (Flow #[0-9]|F[0-9]|S[0-9]|O[0-9]|AQ)`

Zero missing markers = clean. ⚠️ **The predicate was WIDENED in a `/backlog maintain` pass, and the prose above IS the regex — they move together or neither** (the AQ warning below is the same hazard from the other side). The pre-widening predicate was `→ Tracked under |→ Belongs inside |NEW (Flow|F|OPS|S).* proposed:` and it **under-matched live practice**: measured at the widening, it flagged 22 ranked headings, of which **6 carried a real, deliberate tracker-home in a form it could not see** — `→ Straddles Flow #N + Flow #M`, `Tracker-home: todo.txt`, `→ Tracked in full: plans/…`, `Parent capability: F#`, `→ Full register: plans/…`. The other 16 were genuine gaps and were backfilled the same day. **So "grep clean" had been unreproducible for weeks in BOTH directions at once** — false alarms on 6, real silence on 16.

⛔ **TWO TRAPS MEASURED WHILE BACKFILLING — do NOT derive a tracker home from an entry's TITLE.** The namespaces collide by prefix: **`F<n>` names a feature audit while Flow #<n> names an unrelated flow with the same number**, and this was met twice. Some titles carry **Flow-#<n>** finding ids written with an `F` prefix (*"… (F<n>-P3-7)"*) — reading them literally files the row against the feature audit. Resolve every home against the register itself (`project_critical_flows.md` / `project_feature_audits.md` / `project_ops_register.md` / `project_surface_audits.md`) before writing the marker.

⚠️ **A range-heading container (`### NN–MM.`) fails a `^### [0-9]+\.` predicate at the en-dash**, so any scan must accept `^### [0-9]+[.–]` or it will silently attribute a container's compact rows to the PRECEDING entry and report that entry as clean. That bug cost this pass a wrong residual count on its first run. **The obligation lives on the compact ROWS, not the container** — measured 2026-08-24: 31 of 55 compact rows carry no home in any form, which is live silent debt. (`S#` = surface/lens audit-coverage register `project_surface_audits.md`, added 2026-07-09 — the 4th tracker-home namespace.)

## Usage

- `/backlog` — show top 10 items (P0 + P1) + tier counts
- `/backlog full` — render entire BACKLOG.md with formatting
- `/backlog add <item description>` — DELEGATES to `/ideas add` (capture lives in `IDEAS.md` since 2026-07-10); kept as an alias
- `/backlog review` — scan `todo.txt` + `plans/*.md` for items that should be promoted to BACKLOG (cheap, single-context, propose-only)
- `/backlog sweep` — the BATCH cleanup+promotion pass over ALL of `todo.txt`: verified multi-agent triage into DONE / OBSOLETE / PROMOTE / UNCERTAIN with per-item evidence, orchestrator adjudication, then apply + commit. Owner-invoked (the invocation IS the founder-gate for the batch)
- `/backlog promote <item or regex>` — move an item from `IDEAS.md` or todo.txt into a ranked tier (prompts for P-level + trigger)
- `/backlog archive <item or regex>` — move a shipped item from ranked tiers to Archive
- `/backlog refine` — walk through current P0/P1/P2 items; prompt for effort/trigger updates
- `/backlog maintain` — the weekly-cadence umbrella pass: git-verify + truth-up statuses → archive the verified-shipped → propose re-ranks for approval (composes `refine` + `archive` in the one workable order; preserves their propose-vs-write split)

## Process — `/backlog` (default view)

1. Read `BACKLOG.md`
2. Count items per tier (P0, P1, P2, Archive) — Ideas counts come from `IDEAS.md` (one line, via `/ideas` conventions)
3. Render condensed view:
   ```
   # BACKLOG status — {date}

   P0 (ship now): {N} items
     1. {title} — {effort} — {trigger}
     2. ...

   P1 (near-term): {N} items
     {condensed list — 1 line each}

   P2 (trigger-gated): {N} items
     {condensed list — 1 line each}

   Ideas: {N} in the `IDEAS.md` pipeline (view: `/ideas`)
   Archive: {N} shipped items
   ```
4. Idea staleness (>60 days unrefined) is `/ideas review`'s job now — do not scan for it here.

## Process — `/backlog add`

Alias — invoke `/ideas add <description>` (appends a `💡` row to the `IDEAS.md` pipeline with auto-date + next I#). No effort/trigger prompting at capture time; refinement happens at promotion.

## Process — `/backlog review` (promote candidates)

Scan for items that belong in BACKLOG but live elsewhere:

1. Read `todo.txt` — look for entries that describe building a feature (not ops/bugs/monitoring):
   - Keywords: "implement", "build", "add feature", "new surface", "user entitlements", "UI for", "new table + page"
   - Anti-keywords: "set env var", "cron", "monitor", "investigate", "legal doc", "runbook", "revert" — these STAY in todo.txt
2. Read `plans/*.md` — each design doc is a candidate if not already in BACKLOG:
   - Check if `BACKLOG.md` OR `IDEAS.md` contains the plan's filename as a link — if in neither, candidate for promotion (or `/ideas add` if not build-ready)
3. Present findings as a proposal table:

   | Source | Item | Suggested tier | Rationale |
   |---|---|---|---|

4. On approval, promote each item — insert into ranked tier (P0/P1/P2; not-yet-rankable candidates go to `IDEAS.md` via `/ideas add`) and flip the source row to a pointer (see promote step 4).

For the full evidence-verified fan-out over the whole file — including the done/obsolete cleanup half `review` doesn't do — use `/backlog sweep` below.

## Process — `/backlog sweep` (batch todo.txt cleanup + promotion)

Codified 2026-07-30 from the first run (4 agents / 1,047 open items / 41 done + 30
obsolete + 27 promoted). Owner-invoked; the invocation authorizes the
batch promotion (BACKLOG.md's founder-gate) and the evidence-backed status flips.

1. **Size + shard.** `wc -l todo.txt` + `grep -c '^- \[ \]'`. Split into ~4 line ranges (~3k lines
   each; scale agent count with file size). Line numbers are for SHARDING only — every later edit is
   string-anchored, so peer commits interleaving mid-run are survivable (measured: they did).
2. **Fan out READ-ONLY triage agents** (`Explore`, background, Opus; explicit "no Edit/Write/git" ⛔ **`Explore`, NOT `general-purpose`: a read-only fan-out runs as Explore.** Explore is read-only and skips CLAUDE.md and the rules corpus at launch, so a slice seat starts ~114k tokens lighter; a `general-purpose` seat pays the whole resident set to do a read-only sweep. Because it holds NO always-loaded doctrine, PASTE into each brief the rules it actually needs rather than naming them by pointer — the corpus fence, the owner-speech-shapes row, and the `2>/dev/null`/`grep -c` false-zero rule (the pattern `wrap/SKILL.md` Step 1b-DEEP already uses). Re-pointed 2026-09-04: the rule covers the whole CLASS and only one site had been wired, which a review lens caught.
   in the brief). Each classifies every OPEN `- [ ]` item in its range into exactly one bucket:
   - `CONFIRMED-DONE` — deliverable verifiably exists NOW; evidence MANDATORY per item (file:line or
     commit SHA via code-grep / `git log --all --grep`). No evidence → not this bucket.
   - `OBSOLETE` — premise rotted (dup of a richer row / superseded-by-shipped / decision-reversed /
     target removed), citing the superseding evidence or the canonical surviving row.
   - `PROMOTE-TO-BACKLOG` — a FEATURE BUILD (todo.txt's domain is ops/bugs/monitoring/legal/process;
     features live in BACKLOG.md). `rg` BACKLOG.md for an existing entry FIRST — a hit reclassifies to
     OBSOLETE-dup with the `#N` pointer. Propose a tier + 1-line rationale.
   - `UNCERTAIN` — a concrete signal exists but couldn't be verified; state exactly what settles it.
   - `KEEP` — the DEFAULT; report only a count. Defers/rejections already ruled on are KEEP, never
     re-litigated. Future-dated / prod-signal / monitoring triggers are KEEP absent done-evidence.
   Brief also carries: skip items in-flight this session; a wrong CONFIRMED-DONE is worse than an
   UNCERTAIN; output as machine-scannable rows + `OPEN ITEMS SCANNED: n` with the pasted count command.
3. **Adjudicate (orchestrator, never delegated).**
   - Spot-check ≥3 evidence citations per slice with fresh commands; one failure → re-verify that
     slice's whole DONE/OBSOLETE set.
   - Settle settleable UNCERTAINs with the cheap instrument NOW (`vercel env ls`, `gh run list`,
     `git merge-base --is-ancestor`, an EXPLAIN-free index read) rather than filing them.
   - **Bundled-deferral rule:** an item whose body carries live residue (sub-gates, a residual owner
     decision) does NOT flip — annotate the shipped part, keep the box open.
   - Small-LOC content/polish items (<~30 LOC) do NOT promote — a ranked feature queue is
     over-ceremony for them; they stay todo-appropriate.
   - check any `done-when`/predicate the sweep relies on (unanchored substrings false-reconcile).
4. **Apply centrally — single writer, string-anchored Edits.**
   - DONE/OBSOLETE: flip `[x]` with the evidence INLINE (`— DONE (triage <date>): <evidence> —`),
     keeping the original title text. Byte-identical duplicate rows need context-anchored edits (the
     following Source line disambiguates); a truncated print is not an old_string — use full lines.
   - PROMOTE: BACKLOG numbering starts strictly ABOVE the max number REFERENCED anywhere in the file.
     ⛔ **THIS FILE HAS THREE ENTRY FORMS AND A SHORT-FORM PREDICATE MINTS A COLLISION SILENTLY.** The form
     prescribed here until 2026-09-06 was `grep -ohE '#[0-9]+' | sort -V | tail`, and it reads
     `### NN. …` as **ZERO** — `#` is not adjacent to the digit — so it cannot see the 69 heading-form
     entries at all, while its tail is polluted by non-entry tokens (a link fragment `#194593` at
     `:1240`). It avoided a collision only by accident until a seat minting from the mirror-image
     bullet predicate landed a duplicate entry number on top of a row that
     `todo.txt` was already citing by that number. **Enumerate ALL THREE forms and take the max:**
     `{ grep -oE '^### [0-9]+\.' BACKLOG.md | grep -oE '[0-9]+'; grep -oE '^- \*\*#[0-9]+ ' BACKLOG.md | grep -oE '[0-9]+'; grep -oE '^- \*\*P[0-9]+ #[0-9]+' BACKLOG.md | grep -oE '#[0-9]+' | grep -oE '[0-9]+'; } | sort -n | tail -1`
     ⛔ **THE THIRD LEG IS THE ARCHIVE FORM, AND THIS CLAUSE SAID *TWO* UNTIL 2026-09-07.**
     `/backlog archive` step 3 moves an entry to `### Shipped` as `- **P<N> #<N> …`, which neither of the
     first two legs matches — measured today: **41 archive entries, every one numbered below the heading and
     bullet maxima**. **LATENT, not live: two-form and three-form both return the same max right now**, because
     everything archived so far was minted below the live max. It goes live the first time a high-numbered
     entry is archived — the archive is explicitly a permanent record (step 4, *"DO NOT delete"*) and other
     trackers cite archived numbers, so an archived `#N` is a live reservation, not a freed one. ⚠️ **This is
     the SAME defect one generation on: the clause exists to fix a rule that named the wrong form set, and it
     named the wrong form set** (`.claude/traps/shell-traps.md`, the bullet under its False-zeros provenance header: *"a rule naming THE defining form of a
     corpus — this one manufactured the false zero it exists to prevent"*). **Re-derive the form set from the
     file before trusting any structural predicate here, including this one** — a bare
     `grep -oE '^[^A-Za-z]*.{0,24}#[0-9]+' BACKLOG.md | sed 's/[0-9][0-9]*/N/g' | sort | uniq -c` prints every
     line-start shape that carries a number in ~1 s, and is how the fourth form (`- **P<N> ` with no `#N`, 10
     lines, sub-component rows carrying no entry number) was ruled OUT rather than guessed at.
     — then also `grep -F 'BACKLOG #' todo.txt`, because a number can be cross-referenced from another
     tracker before this file makes it obvious. A form-anchored max is a FLOOR, never a max. (A skipped
     number may still be a hidden mint.)
     Entries are COMPACT (2–4 lines, `plans/` pointer where one exists) under a dated batch heading;
     tier default is conservative P2 with an explicit owner-re-rank note; safety items, or items needed at this stage, may
     take P1 flagged for re-rank. The todo row flips to `[x] PROMOTED to BACKLOG #NN (<date>)` and
     STAYS — the pointer row IS the detail record (same re-proposal guard as the IDEAS ⬆️ convention).
   - ⛔ **VERIFY THE TARGET ENTRY EXISTS BEFORE THE FLIP LANDS — a promotion into a void is
     WORK DELETED WITH A RECEIPT.** A row flipped to `[x]` leaves *every* net that would
     otherwise resurface it: `/triggers` skips closed rows, `/hanging-work` skips them, the
     next wrap's 7c sweep skips them. So a `PROMOTED to BACKLOG #NN` pointing at an entry
     nobody wrote is not a dangling reference — it is unrecoverable by every normal
     mechanism, *because* the receipt makes it look handled. Grep each minted `#NN` in
     `BACKLOG.md` and reconcile the count against the promote list before committing; and
     commit the todo half and the BACKLOG half **together**, never the todo half first.
     **The grep must match the shape the batch actually uses** — batch promotions land as
     compact `- **#NN` one-liners under a single `### NN–MM.` range heading, so a
     one-heading-per-entry predicate (`^### NN\.`) returns a confident zero on entries that
     exist. Positive-control it against a number you know is present
     before believing any zero. (Codified 2026-08-03: the consequence
     reasoning was raised on a broadcast whose own predicate was blind in
     exactly this way — the risk is real and the check is cheap regardless.)
   - ⛔ **A sentence that says how the product works TODAY carries a `ran:` source** — the command run, or the file and symbol read, in THIS sweep. It binds every sentence the sweep writes (a closing line, an annotation, a promoted BACKLOG entry), and a sentence with no `ran:` does not go in. A todo row's description of the code is a record ABOUT the thing, never the thing: the 2026-10-03 sweep promoted a row into an entry carrying "a yes/no from the histogram", where the code is a four-way judgment the model makes itself; it was retracted and fixed the same day.
   - Dead blockers / fired triggers found en route: annotate the row (UNBLOCKED / NARROWED / NOTE),
     don't silently leave a false `Blocked on:` standing.
4b. **Pre-commit checks — five, run before the commit, each against the thing it names.** A closing line is a claim about the thing it names. On 2026-10-03 one sweep commit and the maintain commit before it carried five closure errors of this one family; a review found four and a later pass found the fifth.
   1. **Done-when, leg by leg.** For every row being closed, read its `done-when` and name each leg met. One unmet leg ⇒ annotate and keep the box open.
   2. **What production serves is read at `origin/main`.** A closing line that says what users or production get is checked after a fetch (`git merge-base --is-ancestor <sha> origin/main`), never at HEAD on `dev`.
   3. **"Carries over to <row>" is true only once the text is ON that row in the same commit.** Read the surviving row's range in the STAGED blob and grep it for a phrase of the carried text, never for the row's name; expect ≥1:
      `N=$(git show :todo.txt | grep -nE '^- \[[^]]*\] <surviving row name>' | head -1 | cut -d: -f1); [ -n "$N" ] || { echo ROW-NOT-FOUND; exit 1; }; END=$(git show :todo.txt | awk -v s="$N" 'NR>s && /^- \[/ {print NR-1; exit}'); git show :todo.txt | sed -n "${N},${END:-\$}p" | grep -cF '<phrase of the carried text>'`
      *(Read `git diff --cached -U0 -- todo.txt | grep -cF '<surviving row name>'` until a 2026-10-03 read: the closing line that says "carries over to <row>" names that row itself, so the count reads 1 whether or not the text was carried.)*
   4. **A backfilled tracker home is OPENED and grepped for what the pointer says it HOLDS** — the artifact's own distinctive words, one `grep -cF` per word, never the entry's topic noun and never an alternation. The gate checks that a home is NAMED, never that it holds the item. *(Read "grepped for the entry's own nouns" until 2026-10-04: on the founding instance that grep read 9 on a home that did not hold the draft.)*
   5. **Check the working notes row by row:** every notes row with a planned action, under any label (an UNCERTAIN row resolved to "annotate" counts), reads ≥1 in `git diff --cached -U0 -- todo.txt | grep -cF '<row name>'`. A 0 means the action was never applied; a nonzero is not proof. *(Read "count per class; a class at zero was never applied" until 2026-10-04: on the founding sweep the KEEP+ANNOTATE class read 3 planned and 3 applied while two annotations filed under UNCERTAIN were dropped.)*
5. **Commit + report.** One commit for `todo.txt` + `BACKLOG.md` with the counts in the message.
   Surface the owner-decision residue (un-settleable UNCERTAINs, tier re-ranks, rulings) as a list —
   never auto-resolve those.

**`sweep` vs its siblings (asked on day one — the distinction is the spec):**

| Subcommand | Operates on | Direction | Writes |
|---|---|---|---|
| `sweep` | `todo.txt` (all of it) | INBOUND — feeds BACKLOG + closes todo rows | todo flips + appended BACKLOG entries; never touches existing entries |
| `review` | `todo.txt` + `plans/` (keyword scan) | inbound, propose-only | nothing without approval |
| `refine` | `BACKLOG.md` existing P0/P1/P2 | GROOMING — effort/trigger metadata, re-rank proposals | metadata only; priority stays a founder write |
| `maintain` | `BACKLOG.md` lifecycle | umbrella (refine + archive) | archive writes; re-ranks propose-only |

Also distinct from `/triggers`: that is the DETERMINISTIC zero-LLM predicate evaluator (fires on
`meta:` blocks); `sweep` is its agentic complement for everything predicates cannot see. `/triggers`
before `sweep` is a good order — it drains the mechanically-decidable items first.

## Process — `/backlog promote`

1. Find the item (fuzzy-match user's input against the `IDEAS.md` pipeline/run-corpora OR `todo.txt` descriptions)
2. Prompt user for:
   - Priority tier (P0 / P1 / P2)
   - Effort estimate (LOC / file-count — human-time units are banned, LARP markers)
   - Trigger condition (concrete date, event, or user-count threshold — NOT "post-launch")
   - **Audit-tracker home:** existing Flow#/F#/OPS# the work will be audited under, OR NEW slot proposal in the same approval ("propose Flow #N: <title>" / "propose F#: <title>" / "propose OPS #: <title>"). For internal optimizations of an existing feature, mark "→ Belongs inside F# (internal optimization)" instead.
3. Insert into chosen tier at next sequential number, including the tracker-home pointer as a bold line below the title:
   ```
   ### N. {title}
   **→ Tracked under {Flow #M | F# | OPS #M | S#M | AQ}** (OR `**NEW {Flow #M | F#} proposed: {one-line description}**`)
   > ⚠️ **AQ is in the VALIDATOR by LOOSENESS, not by design (2026-08-14).** The predicate's first
   > alternative is the unanchored literal `→ Tracked under `, so ANY token after it matches — which is the only
   > reason an `AQ` marker passes. Both prose enumerations now name AQ so the spec agrees with its own regex.
   > **Anyone tightening that alternative to the documented forms silently breaks every AQ marker** — tighten the
   > prose and the regex together, or neither.
   - **Effort:** ...
   ```
   ⛔ **Any sentence in the entry that says how the product works TODAY carries a `ran:` source** — the command run, or the file and symbol read, in this promote; a sentence with no `ran:` does not go in (the measured miss is under `/backlog sweep` step 4).
4. Update the source: an `IDEAS.md` row flips to `⬆️ PROMOTED → P#` and STAYS (row + detail = re-proposal guard; add `Source: IDEAS.md I#` to the BACKLOG entry); a `todo.txt` entry flips to `[x] PROMOTED to BACKLOG #NN (<date>)` and STAYS — the pointer row is the detail record (aligned with `sweep`, 2026-07-30; the old remove-the-row convention lost the item's context and had no re-proposal guard)
5. If NEW slot proposed: add stub row to `project_critical_flows.md` / `project_feature_audits.md` / `project_ops_register.md` with `🔬 RESEARCH_GAP` status — ⛔ **append to the ROUTER (correct: the splitter re-packs it) and then RUN `node scripts/rules-tier-split.mjs --target flows --apply`, or the row sits in the router and its manifest goes stale** + trigger pointer back to this BACKLOG entry. Update MEMORY.md pointer-line count.

## Process — `/backlog archive`

1. Find item in ranked tiers (P0/P1/P2)
2. **For COMPOSITE items (bundling 2+ distinct work streams) — enumerate per-component absorption (sub-rule B).** List each work stream + which Flow/F/OPS row absorbed its audit. Streams with NO existing audit-tracker home → propose v-audit-needed annotation on closest-fit row OR new slot. Silent ship = the gap `/meta` cross-tracker analysis surfaces later.
3. Move to `## Archive (shipped or dropped)` → `### Shipped` with date + commit hash + per-component absorption list (composite items only — single-tracker items get a simple `→ {Flow#|F#|OPS#}` pointer).
4. DO NOT delete — archive is historical record, prevents re-proposing shipped features.
5. Renumber remaining items in the source tier.
6. ⛔ **SWEEP THE WHOLE REPO FOR THE OLD NUMBER, NOT JUST THE PROSE TRACKERS — A RENUMBER'S BLAST RADIUS IS EVERY PLACE THAT NUMBER WAS EVER WRITTEN.** `rg --hidden --no-ignore -n '#<OLD>\b'` (both flags: one alone is a false zero over `.claude/`), then read every hit. **TELL: your sweep named the stores you think in — the backlog, the plan, `todo.txt` — and stopped there.** Source comments and runtime strings do not come to mind and are where the pointer matters most. Measured 2026-09-06: renumbering an entry swept three prose stores and missed **three** live cross-references in a test file, one of them inside an assertion's own failure message — the copy a developer meets in CI with no surrounding context. Caught by a non-author read, not by the sweep. **A stale pointer does not read as broken: the old number still resolved, to an unrelated row.**

## Process — `/backlog refine`

Weekly-ish cadence. Walk through current P0/P1/P2:

1. For each item: "Is the effort estimate still accurate? Is the trigger still valid? Has priority shifted based on recent audits?"
2. Auto-flag items where:
   - Same effort estimate for >4 weeks with no movement (likely underestimated — re-estimate)
   - Trigger condition met but item didn't move up (promote now)
   - Item depends on another item ranked lower (re-order)
3. Propose re-ranking as a diff; user approves.

4. **Prioritization heuristic — the founder's lens, NOT an auto-ranker** (respects the "does not rank for you" boundary: this sharpens the *rationale* of the step-3 proposal; it never auto-writes priority). When two items genuinely compete for the same slot, apply three filters:
   - **Opportunity-cost (founder-hours).** At solo scale the binding constraint is YOUR hours, not money — the real cost of a P1 is the highest-value thing it delays. A cheap item that unblocks three others beats an expensive item that unblocks none.
   - **Reversibility (one-way vs two-way door).** Irreversible / expensive-to-undo calls (pricing, schema, public-API shape, vendor lock) earn more deliberation + earlier slotting — get them right before users depend on them. Reversible calls ship fast and get corrected. Weight one-way doors up.
   - **Reach × Confidence ÷ Effort (the cut-down RICE).** Reach (users/flows touched) × Confidence (how sure the impact is) ÷ Effort (LOC/file-count — never hours, LARP markers). Drop RICE's "Impact" sub-score; at this scale it's guesswork, and Reach×Confidence÷Effort is the honest, cheap version.

   (Surfaced by a 2026-06-17 capability-gap review — a comparison with alirezarezvani's library flagged `/backlog` as having ranking *mechanics* but no strategy *lens*; this is the ~15-line lens, deliberately NOT a new "CPO" skill.)

## Process — `/backlog maintain`

The weekly-cadence umbrella pass. Composes `refine` + `archive` in the **one order that works** — you can't archive what shipped until refine has surfaced it — while preserving their **opposite write-postures**: archive *writes* verified-shipped items; refine only *proposes* re-ranks. (Sibling of `/meta maintain`.)

1. **Git-verify + truth-up (read).** For every P0/P1/P2 item claiming a shipped/DONE status, confirm it against ground truth (`git log -1 <hash>`, the route/symbol on disk, the audit-tracker row) — never the prose alone. Correct stale statuses inline.
2. **Archive the verified-shipped (write).** Run the `/backlog archive` Process on each item whose build is fully drained — OR has graduated to a Flow#/F#/OPS# tracker with only trigger-/data-gated remainder (archive the row, leave a slim pointer for the remainder). A **partial-ship** item whose ranked row still tracks a live remaining increment STAYS — archiving it drops that tracking. Enumerate per-component absorption for composites.
3. **Propose re-ranks (NO write).** Run the `/backlog refine` Process (steps 1-4) over what remains; present re-rank + effort/trigger changes as a proposal table. Do NOT auto-write priority — it stays a founder decision (Boundaries → "Does not rank for you"). Only founder-greenlit re-ranks get written.
4. **Coordinate the write (parallel-session coordination).** BACKLOG.md is shared — check `git status --porcelain` + parallel sessions first; stage the explicit path (`git commit -o BACKLOG.md`), never `-A`. Bundle the step-2 archive writes with any step-3 re-ranks the founder approved into one commit. ⛔ **Before that commit, run `/backlog sweep` step 4b's five pre-commit checks on BACKLOG.md (check 3 as written reads a `todo.txt` row, a shape no BACKLOG.md line has; when a maintain pass carries text onto a BACKLOG entry, read that entry from its heading or bullet to the next one and grep for a phrase of the carried text): they bind every status this pass corrects, every item it archives and every tracker home it names** (the rule covers both commands, and one of the two commits it came from was a maintain commit).
5. **Verify zero silent-debt.** After the writes, the `/meta` cross-tracker grep (`→ Tracked under|→ Belongs inside|NEW … proposed:`) must stay clean on every surviving P0/P1/P2 heading.

`refine` and `archive` remain as granular entry points — use them directly for a targeted single-item pass (e.g. archiving one known-shipped item) without the full walk.

## Principles

- **BACKLOG.md is the truth about PRIORITY — but git-verify a STATUS claim before relaying it.** The queue/ranking is authoritative; the inline STATUS annotations (`✅ shipped` / `🔴 blocked` / `broken` / `done`) ROT. Any view — default, `refine`, `maintain` — that relays such a claim as *current fact* must first confirm it against ground truth (`git log`/`git show`, the file/route on disk, the audit-tracker row). The tracker text you're presenting is the artifact UNDER REVIEW, not a citable source. Evidence: 2026-07-02 — an entry's "🔴 broken end-to-end" status on an auth flow was relayed as current in a default `/backlog` view; a challenge asking how that was known surfaced it was stale (superseded by a later fix through the auth provider's email hook).
- **BACKLOG.md is the truth.** Skill formats the view and helps with CRUD — never invents priority.
- **User edits the file directly** when they want speed — skill is for when they want structure.
- **Archive, don't delete.** Shipped items stay for historical context (prevents duplicate proposals).
- **Don't auto-promote from `IDEAS.md`.** Promotion forces effort/trigger estimation, which is a decision the user makes, not the skill.
- **Don't re-rank without asking.** If `refine` finds something odd, propose, don't write.
- **Trigger-with-concrete-condition is mandatory for P2.** If a P2 item says "post-launch" or "someday" — re-prompt for a concrete condition (user count, event, revenue threshold, date).
- **One item per need.** If two entries would share a spec doc, they're one item. Merge before promoting.
- **Audit-tracker home is mandatory at creation.** Every P0/P1/P2 entry points at Flow#/F#/OPS# or marks "NEW {slot} proposed:". Composite ships enumerate per-component absorption at archive. Internal optimizations belong INSIDE F#, not at top-level BACKLOG. Without this, work ships → `/audit-check` has nowhere to write → silent debt accumulates. A 2026-05-21 cross-scan found 6 invisible features + 2 composite-audit gaps.

## Boundaries — what this skill does NOT do

- **Does not rank for you.** Priority is a founder decision. Skill surfaces candidates, user decides.
- **Does not edit `plans/*.md`.** Those are design docs; skill only links to them.
- **Does not touch `todo.txt` ops entries.** Only moves items that are genuine builds. If it's a env var or a cron, it stays.
- **Does not implement items.** BACKLOG.md is a queue; implementation happens via `/agent-work` or manual work with a backlog item as scope.
- **Does not track velocity/metrics.** Not a JIRA. Just a ranked list.

## Coordination with other skills

- `/expert-review` + `/agent-work` often produce DEFERRED items → go to `todo.txt` if ops/bug, BACKLOG.md if build (per deferrals → todo.txt + this skill's split rule)
- `/ideas` — owns unranked capture + disposition (`IDEAS.md`); `/meta learn` Step 1's "We should add X / we need to track Y — stated but no action taken" signal maps to `/ideas add`.
- `/wrap` — session end. The ranked queue's state should be inspected; Step 7c.3 captures unacted idea signals into the ideas register.
- `/meta` (cross-tracker analysis) — validates the audit-tracker contract on every invocation. Reports Type A (missing tracker-home), Type B (composite without per-component enumeration), Type C (internal optimization at top-level BACKLOG that belongs inside F#). Run after any wave of BACKLOG additions OR shipped archives to verify zero silent-debt accumulation.

## Why this skill exists (codified 2026-04-15)

`todo.txt` grew to 674+ lines mixing 5 concerns: ops checklists, bug fixes, monitoring, feature deferrals, setup procedures. "What to build next?" was invisible — required scanning every section. Meanwhile `plans/` had great specs but no ranked view of which to ship first. Splitting BACKLOG.md off (ranked queue) from todo.txt (pending ops) gives each file one job + makes the roadmap legible. `plans/` keeps its role as the detail layer both reference.

Same pattern as deferrals → todo.txt + manual tests → QA plan: **dedicated surface per concern; avoid dumping-ground drift.**
