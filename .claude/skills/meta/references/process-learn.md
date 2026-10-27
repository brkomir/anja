# Process — Session Learn (subcommand: `learn`)

End-of-session lesson extraction. Distinct from Full Review (which audits current state) — this synthesizes what just happened. Run before `/wrap`.

**When NOT to use:** sessions with <5 messages, no decisions made, no skill/expert MEMORY edits, or pure read/explore sessions. The signal-to-noise floor matters — a quick lookup session has nothing to learn from.

## Step 1: Conversation scan

First run `python3 scripts/meta-corrections-scan.py --current` (read-only, about 1 s; it resolves THIS session by `CLAUDE_CODE_SESSION_ID`) and carry each candidate event into the walk as a User-pushback row: the scan sees phrasing, the walk sees meaning, and `/wrap` Step 7f still owns the registry write. Name the highest `idx` you carried in your output; on `/wrap` Step 9's targeted run (wrap-execution window only) carry only events above that `idx`. Then walk the session looking for these signals (each is a candidate lesson):

| Signal | What to extract |
|---|---|
| User pushback ("are you sure", "are we sure", "no, do X instead") | Why the default was wrong — almost always a real lesson |
| **Praise / validation (added 2026-05-18):** explicit approval of non-default choice ("perfect, that was the right move", "keep doing that", "do this from now on") OR silent acceptance of clearly non-obvious approach with no pushback. Distinct from courtesy ("thanks", "nice" alone) — must be attached to a specific decision OR be acceptance-of-non-default. | Why this approach worked — captures validated-judgment-call patterns that would otherwise drift back to default next session. Symmetric to pushback signal (one says "did wrong", other says "did right"). Without capture, validated approaches regress to default. |
| Inline fixes during audit-check | Heuristic about when inline fix beats finding |
| Agents launched | Was the right tool chosen? (agent-work vs spot vs lean vs full) |
| Audit-check failures | Pattern that the formal checks didn't catch on first pass |
| Defer-with-trigger added | New trigger condition worth codifying |
| Skill spec edits | Why the spec changed — reasoning belongs in skill CHANGELOG.md |
| Stale-file deletes / smoke-test labels | Decision rule for when each applies |
| Tracker drift caught | Whether process upstream needs to prevent it |
| Re-investigations that flipped a verdict | Add to "user pushback signal" tally |
| New expert added / removed | System evolution; `.claude/agents/` must be regenerated via `node scripts/generate-expert-agents.mjs` |
| `.claude/rules/*.md` edits | New coding standard surfaced; check if it should be a project-wide rule vs skill-specific |
| `.claude/templates/*.md` edits or usage | Artifact templating opportunity or template drift |
| `.claude/hooks/*.sh` additions | Automation gap being filled via hook — note why the skill-level alternative was rejected |
| "We should add X" or "we need to track Y" stated but no action taken | Surface as unrealized session intent — propose follow-up todo |
| **LARP markers:** agent output contains "~Nh", "N days", "N weeks", "post-launch", "monitor after launch", "acceptable for launch", "takes N min per item", OR ALTERNATIVE-verdict followed by orchestrator having to re-launch with narrower scope | Flag as expert-LARP regression. Check `.claude/agents/{name}.md` for the "Agent-mode operating posture" preamble — if missing, run `node scripts/generate-expert-agents.mjs`. If present, this is a **training-data override failure** — re-run the task with an explicit "apply posture rule N" callout. Root cause: LLM inherits human-consultant incentive layer from training data; preamble is the correction. |
| **Agent registry miss:** `Agent(subagent_type: "X")` tool error `Agent type 'X' not found` with `.claude/agents/X.md` confirmed on disk via `ls`, OR orchestrator fell back to `general-purpose` subagent because X was created mid-session | The miss is LAG, not restart-only: the harness refreshes the registry mid-session with an `agent_listing_delta` attachment (measured 2026-10-09: ~21 min after the file landed, ~7 after the miss). Extract as a lesson only if the type is still absent long after its file. Fallback pattern: `general-purpose` + skill-loading preamble ("Read `.claude/skills/{expert}/SKILL.md` + MEMORY.md first"). Check `/meta status` Step 5 mid-session agent check surfaces it. |
| **Privacy-tag candidate (added 2026-05-20, pre-open-source discipline):** lesson body references a private other-project, a sensitive business decision (a payment provider's fee calibration, supplier relationships, customer-specific churn data), customer-specific or named-user info, or pricing details that aren't public on the website | Append `<!-- PRIVATE: scrub before publish -->` marker inline at the reference. Future publish-sprint greps for these markers and decides: keep-rewritten / drop / generalize. Avoids retroactive 20-40-hour scrub sweep when open-source decision triggers. **Trigger condition** for the publish-sprint itself: an explicit publish decision. |

## Step 2: Diff against existing knowledge

For each candidate lesson:
1. Read the meta lessons corpus — ⛔ **`grep .claude/skills/meta/` THE DIRECTORY, NEVER `MEMORY.md` ALONE.** That file has been a two-tier ROUTER since 2026-08-06 and the bodies live in `MEMORY-ARCHIVE-*` / `RULES-SHARD-*` shards beside it, so a router-only grep returns a clean, plausible ZERO for a live lesson. **Measured, control first: one live, heavily cited lesson reads `MEMORY.md` 0 and the DIR 13; another reads 0 and 9.** Both zeros are the instrument, not the corpus, and this step prescribed the router by name until 2026-09-07 — so a seat following it literally ran the novelty check through a probe that cannot see a body. *(Found while re-deriving a figure a peer could not reproduce; the peer's flag is what surfaced it.)* Check the lessons count against the parser, not a number embedded in this spec; `/meta self-audit` re-syncs if drifted. ⛔ **AND THE DIR IS ONE OF FOUR HOMES, WHICH THIS STEP ALSO NAMED ALONE UNTIL 2026-09-07 — so the CONTENT-collision check ran over a strictly smaller corpus than the NUMBER-collision check two sections below, which has known about the other homes since.** A body can live as `## L<n>` in the meta corpus, as the legacy `141. **…**` form, **in the `.claude/rules/` file it governs** (house pattern since 2026-08-16), or **in an always-loaded ROOT spec** (`AGENTS.md` / `CLAUDE.md` / a `.claude/orchestrator/` band). Diff against ALL FOUR — `rg --hidden --no-ignore -i '<subject words>' .claude/skills/meta/ .claude/rules/ .claude/orchestrator/ AGENTS.md CLAUDE.md` — and grep the SUBJECT, never the number, since you do not know the twin's L# in advance. **Measured 2026-09-07: on two same-day duplicates, one twin read 0 in the always-loaded set and the other read 1 — so a single-corpus check finds at most one of them.** ⛔ **AND GREP THE LEDGER FIRST, BEFORE ANY OF THIS: `grep -inF '<one distinctive subject token>' .claude/state/lesson-seq`.** It is a flat file of one-line subjects — the only cheaply greppable corpus of the five — and one such grep returned **FOUR** lessons on a single subject spanning three weeks, two of them that same duplicate pair, which four seats had missed while `lesson-mint.mjs status` printed all **653** slugs on every run. ⚠️ The `rg` above is LINE-ORIENTED and `<subject words>` is plural: **8.0%** of four-word windows straddle a newline across these corpora and **22.3%** inside `.claude/rules/`, so pass `-U` or key on ONE distinctive token. *An earlier version of this sentence claimed each twin was invisible in the corpus that caught the other, at 0/1 and 5/0. Both halves were retracted the same day — the 5 reproduces under no path set (it is 1), and the `meta/MEMORY.md` leg was a router-instead-of-directory probe that reads 0 for a live lesson. The surviving leg is the one stated above, and it is sufficient on its own.*
2. Is this lesson genuinely new? (Not a restatement of an existing one with different examples.)
3. If new → add to lessons list with concrete evidence from session, AND classify RULES-eligible per criteria below.
4. ⛔ **Before calling a hit reinforcement, ask whether the candidate REVERSES or NARROWS it** — one side says never / don't / stop where the other says do / always, or one side is unconditional where the other adds an unless / except / only-when. Opposite directives share most of their words, so a subject grep returns them as twins. A reversal or a narrowing REPLACES the old rule's sentence; it is never counted as evidence under it. If reinforcement → **count instances within current session.** If ≥3 → don't append as new lesson body; propose operational scaffolding per **reinforcement counting** (the meta-rule about repeat-firing). Output format: "Reinforcement count for L{N}: {count}. Scaffolding required per reinforcement counting. Proposed scaffolding: {concrete preamble / hook / RULES.md row / SKILL.md edit}." Otherwise append evidence under existing lesson.

### Step 2a: Comprehensive L# lookup (race-condition mitigation, added 2026-05-21 from memory-cap dedup collision chain)

**CANONICAL — use the parser, NEVER a prose grep over `meta/MEMORY.md`.** The latest L# is:

```bash
node scripts/architecture-counts.mjs list | grep '"maxL"'   # → e.g. "maxL": 522,
```

**Do NOT pick `maxL + 1` — MINT the number (Step 2b).** `maxL` is for reading the corpus's current top, never for allocating (the paragraph below is why).

⛔ **`maxL + 1` IS NOT A DEGRADED-BUT-SOUND FALLBACK — IT IS A DIFFERENT ALLOCATOR OVER A STRICTLY SMALLER CORPUS, AND IT COLLIDES DETERMINISTICALLY (measured 2026-08-14).** Step 2b below frames the residual hazard as a RACE WINDOW ("~64s → ~0.17s"). That framing is wrong for the dominant failure and it is what hides it: **there is no window.**

`maxL` parses ONLY the meta MEMORY corpus. Three things are therefore invisible to it:
1. **The minter's ledger** (`.claude/state/lesson-seq`) — a number minted seconds ago is not in MEMORY, so `maxL` cannot see the claim.
2. **The HOME** — and this is the one nobody predicts: **a lesson whose body lives in `.claude/rules/` never raises `maxL`, not even after it is committed.** It is correctly written, always-loaded, and permanently invisible to this allocator.
3. **A CITATION WITH NO BODY ANYWHERE YET (measured 2026-09-02):** `maxL` read one number while **the next two L-numbers were already cited in committed rules with zero shard bodies**. ⚠️ **This is NOT case 2, and the difference is what makes it evade the fix** — case 2 says the body is in the wrong corpus, so a reader who has internalised it goes looking for a BODY and correctly finds none, then proceeds onto a taken number. Here there is no body to find; the claim exists only as a citation. **The cross-read below still catches it, because a citation is a grep hit — so the prescription was right and only its rationale was one shape short.** Treat ANY `L<candidate>` hit in **any corpus `lesson-mint.mjs status` prints under `in-use corpus`** as TAKEN, body or not — `.claude/rules/` is ONE of eight, and naming it alone here is exactly the defect corrected below.

Measured: a peer minted three consecutive numbers and homed the bodies in `copy.md` + `bash-environment.md`; `grep -rc` returned **0 0 0** in the meta corpus against **1 1 1** in `.claude/rules/`, so `maxL` read the number just below them and handed the next seat the first of the three — already minted, already shipped. Both seats were fully compliant with this spec. The duplicate stood for ~2h across always-loaded files, and no gate can see it: the push gate checks collisions INSIDE the meta corpus and one of the two homes is outside it.

**So: MINT. If the minter is genuinely unavailable, `maxL + 1` requires TWO cross-reads before you use it — `lesson-mint.mjs status` (the ledger) AND a citation grep over EVERY path that command PRINTS under `in-use corpus`. Neither one alone answers the question.** ⛔ **DO NOT RESTATE THAT PATH LIST HERE — THIS LINE SAID `.claude/rules/` ALONE UNTIL 2026-09-07 AND THAT IS HOW THE CLASS RECURS.** The allocator was widened to the orchestrator plane; this fallback was not, so within **eight hours** the NUMBER check was narrower than the CONTENT check one section above it: two lesson numbers read **0** in `.claude/rules/` and **1** in `.claude/orchestrator/`, i.e. FREE to this documented fallback while live in `commit-doctrine.md` and `session-doctrine.md` — the re-issue class measured above, one plane over, arriving through the SPEC rather than the code. The printed list sits beside the code that computes it and cannot silently disagree with it; a restatement here can and did.

> ⛔ **NEVER find the max L# with `grep -oE "L[0-9]+"` (or any loose `^## .*L[0-9]+`) over `meta/MEMORY.md`.** The file's PROSE discusses L#-citations — notably the phantom tokens that live in the bug-note AND in the header's parenthetical suffix at the very lines documenting this trap — so a prose-grep false-matches in-prose tokens and reports an inflated max in the **700-800 range**. This exact trap has fired **3× (2026-06-17 / 06-20 / 06-21)** — the self-reference makes it perpetual (the warning text contains the poison tokens). `architecture-counts.mjs` `maxL` parses the actual lesson structure and is the ONLY safe source. If you must cross-check, anchor to the lesson-number SLOT only: `grep -oE "^## [0-9]{4}-[0-9]{2}-[0-9]{2} — L[0-9]+:" meta/MEMORY.md` (the trailing colon excludes prose suffixes) — never the loose form.

### Step 2b: Re-grep RIGHT BEFORE Bash heredoc append (race-window closure)

✅ **PREFERRED PATH SINCE 2026-07-31 — ALLOCATE, DO NOT DERIVE (structural fix):**

```bash
node scripts/lesson-mint.mjs mint --sid <your-sid8> --slug "<one line on what you are writing>"

⛔ **ONE SLUG PER INVOCATION — `--count N` WITH N `--slug` FLAGS ALLOCATES ONLY THE FIRST, AND
PRINTS ONLY THAT ONE NUMBER, SO IT READS EXACTLY LIKE A SUCCESSFUL BATCH.** Measured 2026-09-02:
`mint --sid <s> --count 7` plus seven `--slug` flags returned a single bare number and the ledger showed
ONE allocation. Loop the mint, one slug per call, and read the ledger back (`mint status`) before
writing any body. `--sid` is REQUIRED; omitting it fails loud, which is the safe direction.

⛔ **DRAFT FIRST, MINT SECOND, SUBSTITUTE A PLACEHOLDER — the number MOVES while you write.**
Measured the same session: peers took four numbers during drafting and the body still carried a stale number when
the mint returned. Write `@@A@@` (the recipe below already substitutes it) and never type a
literal L-number into a body you have not yet minted. Write the heading in the house form
`## YYYY-MM-DD — L@@A@@: TITLE`; an undated `## L####` heading leaves the router digest's date
cell empty.
```

Everything below this block narrows a race; the minter **removes** it. The whole family of
failures here comes from allocating by READING a counter — so the minter never reads one. A mint
is a single atomic `O_APPEND` line to `.claude/state/lesson-seq`, and your L# is the POSITION that
line landed in. Two concurrent mints land on two different lines, so they cannot receive the same
number — not "unlikely", impossible by construction. **Measured 2026-07-31, 30 concurrent
processes: 30 returned / 30 distinct / 0 collisions; the read-then-write protocol under identical
load returned 30 / 18 distinct / 12 collisions.** `--self-test` carries a RED control that fails
if that property ever becomes trivial.

**The `--slug` is mandatory and is the point.** A NUMBER collision is caught by the push gate; a
CONTENT collision is not — twice on 2026-07-31 two seats wrote the *same lesson* minutes apart from
one incident, gate-green under different numbers. Claiming is the only moment a peer can see WHAT
you are about to write. Run `node scripts/lesson-mint.mjs status` before minting and read
**EVERY slug it prints, `landed` ones included — NOT only the in-flight set.**

⛔ **THIS SAID "read the in-flight slugs" UNTIL 2026-09-07, AND THAT SCOPING EXCLUDES THE COMMONEST
TWIN BY CONSTRUCTION.** A slug reads `IN-FLIGHT` only while its body is undeclared; a twin minted
hours earlier has landed, so it reads `landed` and an in-flight-scoped read never sees it. Measured
2026-09-07: the duplicated lesson had been minted **11h18m** before its twin, by a different seat,
off the same live incident — outside the in-flight set the entire time. The number gate stayed
green because the numbers differed, which is exactly the case this slug read exists to catch.

⚠️ **Honest limits.** `.claude/state/` is gitignored, so the sequence is LOCAL — it coordinates
concurrent sessions on one machine (the actual collision population), not across clones. It
self-heals: delete it and `init` re-derives the base from the ledger. And it allocates a number; it
does not write your lesson — steps 2-4 below still govern the APPEND, and step 3 still governs a
renumber.

---

**Fallback (no minter available), and still the rule for the append itself.** Concurrent /wrap sessions running /meta learn can both pick the same L# between their initial Step 2a check and their `cat >> MEMORY.md <<EOF` append. To collapse the race window from minutes to seconds:

1. Choose L# via Step 2a as normal.
2. ⛔ **SUBSTITUTE, DO NOT PRINT — compute `maxL` INSIDE THE SAME Bash invocation as the append and interpolate it into the payload.** Re-running the lookup as a *separate* step and reading the number is NOT sufficient and is the measured failure mode: on 2026-07-31 all three colliding seats DID re-derive (51s / 76s / 64s before their appends) and then baked the printed literal into a heredoc composed in a LATER turn. Write the lesson body with `@@A@@` placeholders so the number never exists as a literal until the append runs:
   ```bash
   MAX=$(node scripts/architecture-counts.mjs list | grep '"maxL"' | grep -oE '[0-9]+')
   A=$((MAX + 1))
   # Current shard by MAX END-DATE. NEVER `ls -t` (mtime order — measurably picks a stale
   # shard).
   # RULE: .claude/orchestrator/session-doctrine.md § RE-RESOLVE A SHARD FILENAME AT WRITE TIME
   # (relocated there 2026-09-03; this comment said `bash-environment.md`, where it greps
   # ZERO, until 2026-09-06. ⚠ The title is kept on ONE line ON PURPOSE: the first fix
   # wrapped it after "AT", which made this very citation invisible to the line-oriented
   # sweep that finds these — do not re-wrap it.)
   # ⚠ The `-20*` anchor is load-bearing, not tidiness: meta also carries
   # two MEMORY-ARCHIVE-legacy-lessons-*.md shards, which have no
   # parseable date, and a lexical sort puts `legacy` AFTER `2026` and returns one.
   SHARD=$(ls .claude/skills/meta/MEMORY-ARCHIVE-20*.md \
     | sed -E 's/.*-([0-9]{4}-[0-9]{2}-[0-9]{2})\.md$/\1\t&/' | sort -r | head -1 | cut -f2)
   [ -n "$SHARD" ] && [ -f "$SHARD" ] || { echo "no dated shard resolved" >&2; exit 1; }
   sed -e "s/@@A@@/$A/g" /tmp/lesson-body.md >> "$SHARD"
   ```
   ⛔ **THE TARGET IS THE SHARD, NOT `MEMORY.md` — this recipe appended to `MEMORY.md` until
   2026-08-27 and that is meta's ROUTER**, whose region below `ROUTER PREAMBLE ENDS` is
   REGENERATED: a lesson body written there survives only until the next roll, which discards it
   **while reporting conservation OK**. meta carries 21 shards, so every mint run through the old
   form was writing into regenerated space. Then roll as the ⛔ block below prescribes and
   stage the refreshed router WITH the shard — a shard entry is grep-invisible from a stale
   router.
   ⛔ **THAT `--heal` CANNOT REFRESH THIS ROUTER AFTER A LEARN; THE ROUTE IT SENDS YOU TO NOW
   REFUSES ON UNCOMMITTED EDITS IT WOULD RE-PACK (measured 2026-10-02; refusal shipped the
   same day).** Bare `--heal` after only your own append prints `HEAL SKIPPED … BLOCKED BY` the
   current shard; `--heal .claude/skills/meta` scans nothing and tells you to run `--roll
   .claude/skills/meta --force`. That roll packs greedily, so an edit in any part except the last
   would push committed rows forward into later parts — and so it exits 3 naming any file it would
   rewrite or remove that was dirty before it ran, other than the router and the current part
   (`--dry-run` prints `WOULD REFUSE`). **That includes your own edits:** a watch-tier row this
   learn adds or promotes dirties `WATCH-TIER.md`, the register's head, and every new row re-cuts
   all its parts. On a refusal, check whether each named file is yours first (`git diff HEAD -- <dir>/<file>`;
   HEAD, because a staged edit reads clean to a bare `git diff`): yours ⇒ commit it,
   or re-run with `--allow-dirty <file>[,<file>]`, which overrides ONLY the files it names, so
   another session's part in the same refusal still blocks; theirs ⇒ leave it and re-run once its
   holder commits, or mail the holder. It cannot see an edit inside the current part or the
   router, so still read `git status --porcelain -- .claude/skills/meta/` before staging: your
   append dirties the current shard (and the router once rolled), and a watch-tier row also
   dirties `WATCH-TIER.md`. **A HEAD-based scratch roll is NOT the way around
   it:** committing its re-packed parts while a peer holds one dirty orphans their edits (the
   mirror failure, promoted into a lesson on 2026-10-02; this clause prescribed it for one commit).
   After any roll, assert the router's "Rolling" line names the real folder:
   ``git grep -cF -- '--roll .claude/skills/meta`' HEAD -- .claude/skills/meta/MEMORY.md`` = 1.
   Measured window: ~64s → ~0.17s. The residual 0.2s race is deliberately NOT locked — see Anti-scope.
3. **This governs a collision RENUMBER exactly as it governs a first mint.** No mint protocol as usually scoped covers a renumber, and that is where the third 2026-07-31 collision happened: a hand-picked in-place renumber re-derived nothing and collided into a protocol-perfect atomic mint 24 seconds old. If you are renumbering to resolve a collision, re-derive in the same command exactly as above.
4. Loop max **3 iterations**. If still colliding after 3 bumps, STOP and surface to user — that indicates either a deeper concurrency issue OR the comprehensive lookup itself has a gap worth investigating.

**Worked example (the collision this rule prevents):** 2026-05-21 collision chain. Initial /meta learn grep was `^L[0-9]+ ` — caught format #1 only, missed formats #2 and #3. Picked a number for the defer-gauntlet lesson, but a parallel session had already committed a lesson under it, format #3 header. Renumbered via sed to the next number — collided with the parallel's format #2 dated header. Bumped again — collided with another of the parallel's lessons, format #2 dated header, shipped during /wrap. Final memory-cap dedup succeeded only after a 3rd renumber. With Steps 2a + 2b in place, the initial lookup would have caught the occupied range and gone straight to the first free number for memory-cap dedup.

**Anti-scope:** this is procedural-only. Hook-layer atomic L# reservation (PreToolUse hook on Bash for MEMORY.md appends) is DEFERRED per warn-mode-before-block-mode discipline (warn-mode first) until 3+ session recurrence of the collision pattern. Atomic counter file (`.claude/state/meta-lnum-counter.txt` with flock) is the intermediate option between Steps 2a/2b and a hook — promote if Steps 2a/2b prove insufficient (≥2 collision incidents despite re-grep).

> **⚠️ THE ESCALATION LADDER ABOVE WAS RE-READ AND CORRECTED 2026-07-31 (4-lens review). Three corrections, all measured:**
>
> **(a) `flock(1) DOES NOT EXIST ON MACOS`** — measured on this box (`flock` → rc=1; `/usr/bin/lockf` + `/usr/bin/shlock` present). The counter-file option is unimplementable *as written*. `lockf(1)` is the correct portable replacement and the kernel releases its lock on process death, so a crashed holder cannot deadlock the fleet. `shlock` is a TRAP: its man page advertises stale-PID reclaim, and Apple's build detects the dead PID and then refuses to reclaim anyway (reproduced for 4 distinct PIDs); it is also deprecated in its own man page.
>
> **(b) THE TRIGGER'S PREDICATE IS "≥2 incidents DESPITE re-grep" AND IT HAS SCORED 1, NOT 3.** 2026-07-31 produced three collisions and the fleet read the ladder as fired. Measured per-seat, they are three DIFFERENT mechanisms wearing one symptom: a wrong instrument (a colon-anchored hand-grep, structurally blind to ~81% of the ledger's headings); a genuine turn-boundary race (the print-vs-substitute failure, now closed by step 2 above); and a hand-picked renumber that re-derived nothing (now closed by step 3). Only the second is a candidate for "insufficient despite re-grep". **A pre-registered trigger firing is a permission slip, not an argument** — grouping by symptom rather than by mechanism is the wrong-axis error.
>
> **(c) THE CONCRETE DEFEATER, so this is a real deferral and not a decorated "never":** build the lock the first time two seats collide while **BOTH** used the in-command read-and-substitute form of step 2. That measurement does not exist. If it lands, prefer `lockf(1)` around a read-`maxL`-then-append critical section with the number substituted at append time — **never a claim held across composition**, which would trade a collision problem for a stale-claim/gap problem on a fleet whose liveness machinery deliberately fails safe toward ACTIVE (`session-lifecycle.py:348-362`) and therefore cannot confidently report a dead holder.

**RULES.md write-target classification (applied to every new lesson at write-time):**

A new lesson promotes to **`.claude/skills/meta/RULES.md`** if it has ALL three — and know what the promotion buys: since `SKIP_BAND_O_INJECT=1` (the per-turn injection is parked) no hook or payload delivers a RULES row; it is reached by `grep` of the dir only (30 days to 2026-10-26: 91 rows added, 150 RULES greps in 37 sessions, 97 of them inside the writing wrap). A row's composition-time reach comes from the rule or conventions row that cites its `L{N}`, not from the shard:
- **Trigger** — concrete textual or structural cue (phrase you're about to write, output you see, file shape)
- **Action** — concrete sub-15-second check or substitution
- **Generalizable** — fires across many contexts, not one specific incident

If RULES-eligible:
1. Write the MEMORY.md lesson body (full evidence + revisit trigger)
2. Write a one-line row into the SHARD holding that category — `RULES.md` is a ROUTER since 2026-09-04 and has no lettered sections; look the category up in its manifest, edit the `RULES-SHARD-*.md`, then `node scripts/rules-tier-split.mjs --apply` (cite `L{N}` for evidence). A row put in the router instead is invisible to every check in the system.
3. Both edits land in the same commit

If MEMORY-only (principle / post-mortem / playbook / evolution / gap):
- MEMORY.md only. No RULES.md row needed.

**Cross-skill expansion:** when a lesson belongs in `.claude/rules/*.md` (project-wide coding standard) or in another skill's MEMORY.md/RULES.md, the RULES.md row points to the canonical home with a brief pointer; the canonical home gets the full row.

⛔ **AND IF THAT CANONICAL HOME IS A GATED BAND FILE — `CLAUDE.md`, `AGENTS.md` OR **ANY** `.claude/rules/*.md`, WHETHER OR NOT IT IS ALWAYS-LOADED — THE WRITE IS A PAIR, NOT A ROW — THE INCIDENT RECORD GOES TO THE ARCHIVE IN THE SAME COMMIT, so displacement is part of writing the lesson and the band stops piling up.** *"The canonical home gets the full row"* is the sentence that built the pile: every rules file's own **Appending here** paragraph already says the incident record belongs in its `-cases.md` archive, and every one of them accumulated narration anyway — because the append rule sits in the FILE being written and this procedure, which is what a folding seat actually follows, said `full row` and stopped. **The band plane is `CLAUDE.md` + `AGENTS.md` + `.claude/rules/**`, it is the only plane that BLOCKS A PUSH, and it is the one a lesson lands in without anybody pricing it.**

**The pair, both halves in one commit:**

1. **The band file gets the DIRECTIVE, the TELL, the discriminating NUMBER the action depends on, and an `Archive.` anchor** — inside that file's own stated entry-size contract (`bash-environment.md` says 150-400 B; `migrations.md` says one to three sentences). Not the measurement table, not the retraction chronology, not the seat ids, not the dated story.
2. **`.claude/docs/rules-ARCHIVE/<file>-cases.md` gets the narration VERBATIM** — under a dated `##` section naming the band section it belongs to. ⛔ **Verbatim is load-bearing and not a style note: `scripts/band-directive-preservation.mjs` credits an anchor missing from a band file ONLY if it resolves VERBATIM in an archive file, so a paraphrased archive entry reads to that gate as a DELETED DIRECTIVE.**
3. **Run `node scripts/check-band-budget.mjs` in the same pass and read the verdict whole.** ⚠️ It returns **ALLOW while OVER the ceiling** whenever the push adds 0 B — deliberately, so a cut can land — so a clean-looking line is not a pass. Over the ceiling and your fold GROWS the band ⇒ the fold is what blocks the next push: either pay for it with a displacement in the same commit, or hold the ROW (never the lesson body) in `.claude/skills/meta/BAND-CANDIDATES.md` **and** the `todo.txt` row, which is what that register is for.

⭐ **WHY AT WRITE TIME RATHER THAN IN A PERIODIC PASS, measured 2026-09-19 and this is the number that settles it: a deliberate compression pass over the corpus's largest and densest always-loaded file returned 2,339 B from 21 careful cuts**, and the rest of the rules corpus carries almost no displaceable narration at all (0-10 dated measurements per file). **Displacement after the fact is not a lever that reaches a five-figure gap — it never recovers what a year of folds put in.** The write is the only moment the split is cheap, because it is the only moment somebody holds both halves and knows which is which. A periodic pass is a second-best that this corpus has now exhausted twice.

⚠️ **Scope, so this does not read wider than it is:** a lesson whose home is a skill spec, a `MEMORY.md` shard, an orchestrator file or a tracker row is NOT in the band plane and owes none of this — the pair is owed only by a write into `CLAUDE.md`, `AGENTS.md` or `.claude/rules/**` — the `GATED_PATHSPEC` of `check-band-budget.mjs`, which is the SSOT to key on. ⛔ **DO NOT KEY ON *ALWAYS-LOADED* — THAT WORD EXEMPTS MOST OF THE PLANE'S BYTES: 16 of 19 rules files are `paths:`-scoped and therefore NOT always-loaded, yet all 19 are GATED** — `copy.md`, `i18n.md`, `typescript.md` and `tests-unit.md` among them, which are the files most folds land in. ⚠️ **AND THE EXEMPT PLANES ARE NOT UNGATED, WHICH THIS CLAUSE ASSERTED UNTIL 2026-09-19:** `check-band-budget.mjs:330` puts `.claude/skills/` and `.claude/orchestrator/` in `PER_FILE_PATHSPEC` (`:351` returns `warn` for the orchestrator arm) and MEMORY shards have their own DENY hook. The property that actually unifies the four exemptions is the one written a sentence earlier: the gated plane is the only one that **BLOCKS A PUSH**. ⚠️ `.claude/orchestrator/conventions.md` is ALWAYS-LOADED to the main session (`orchestrator-inject.sh:51`), so a fold there costs zero GATED bytes and non-zero always-loaded ones — say which you mean.

**Durability + Impact + Scope scoring (v2.7.3, adapted from alirezarezvani).** For each candidate lesson, score three dimensions 0-3. Promote to MEMORY.md + maybe RULES.md when total ≥6; watch at 4-5; ignore ≤3. This replaces the previous gut-feel "is it worth codifying?" call with a quantitative rubric. Matches the promotion scoring of alirezarezvani's self-improving-agent subsystem (its `memory-analyst` agent and `reference/promotion-rules.md`), not SKILL-AUTHORING-STANDARD, whose ten patterns carry no scoring rubric *(wrong at birth; corrected 2026-10-09)*.

**Source:** alirezarezvani/claude-skills, `engineering-team/self-improving-agent/reference/promotion-rules.md` (MIT; the notice is in `.claude/NOTICE` and the origin record names this passage) — the scoring table and the three distillation examples below are adapted from it.

| Dimension | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| **Durability** (will this still be true in 30+ days?) | One-time fix | Temporary workaround | Stable pattern | Architectural truth |
| **Impact** (how much does this affect daily work?) | Nice-to-know | Saves 1 minute | Prevents mistakes | Prevents breakage |
| **Scope** (how widely does this apply?) | One file only | One directory | Entire project | All projects |

**Rule:** promote when total ≥6. **Watch when 4-5** — do NOT "note and forget"; record the candidate in the `## Watch-tier register` (`WATCH-TIER.md`) — fields: tag · first-seen date · `occurrences: 1` · D+I+S · a **recurrence signature** = the trigger phrase / failure shape that identifies a re-occurrence in a future session · **`retire-if:` (REQUIRED at filing — default `no recurrence by <first-seen + 60d>`, the register's codified horizon; a recurrence resets it, promotion removes it; a dated retire condition set at admission is what keeps the register drainable without an age sweep that retires real signal)**. Ignore when ≤3 (not worth the MEMORY.md entry cost).

**Watch-tier auto-promote (frequency at the watch→promote gate — the ONE place occurrence-count legitimately enters the rubric; do NOT add a 4th D+I+S dimension).** Runs at the START of every `/meta learn`, BEFORE scoring new candidates:
1. Read the `## Watch-tier register` — ALL of it: since 2026-09-13 it is `WATCH-TIER.md` + `WATCH-TIER-PART-NN.md` (the part count moves with every roll), and part 1 alone held 53 of 404 rows on 2026-10-09, so match each signature with `grep -n --exclude='WATCH-TIER-ARCHIVE.md' '<signature token>' .claude/skills/meta/WATCH-TIER*.md`, never one file (the bare glob also matches the archive, whose rows are revived, never incremented in place) — **AND grep `WATCH-TIER-ARCHIVE.md` in the same dir for the signature** — a recurrence matching an ARCHIVED entry REVIVES it (move back to the live register, `occurrences` incremented, `first-seen` unchanged, per the archive header's revival rule; never re-file it as a fresh `occurrences: 1`). For each live item, check whether THIS session re-triggered its recurrence signature in a session DISTINCT from prior occurrences → if yes, `occurrences += 1` **and add a dated `OCC-N (sid, YYYY-MM-DD)` annotation in the block — the annotation is the source of truth, the header count is a denormalization** (4 header/body mismatches measured 2026-08-25, all under-counting).
2. **On reaching `occurrences: 2` → auto-promote:** re-score D+I+S (a confirmed recurrence usually bumps Durability/Impact ≥6), write the numbered L# (+ RULES.md row if trigger+action+generalizable), and DELETE the item from the register. **Carve-out:** if the recurring pattern is substantially covered by an existing L#, EXTEND that L# (add evidence + bump reinforcement count per reinforcement counting) instead of minting a new number — then delete from the register.
3. **Retirement, and the promote-due residue:** run `node scripts/watch-tier-retire-sweep.mjs` (read-only). If DUE NOW > 0, run it with `--apply` (it moves the due rows verbatim to `WATCH-TIER-ARCHIVE.md`, conservation-checked), then the re-roll its output names (`node scripts/memory-tier-split.mjs --roll .claude/skills/meta --force`; Step 2b's refusal rules govern that roll), and note the retirement in CHANGELOG. Every row in its PROMOTE-DUE list (occurrences ≥ 2 at any date — the HELD count above it is only the date-passed subset) leaves this run PROMOTED, EXTENDED into an existing L#, or carrying `held: <the named missing thing> (<date>)`; every row in its PERMANENTLY UN-RETIRABLE list gains the rubric's default `retire-if:`. ⚠️ Since 2026-10-10 a write to any WATCH-TIER part also runs the sweep's DUE NOW count through the `check-memory-size.sh` register arm, a BACKSTOP that warns; this step remains the routine caller that APPLIES. Before that the arm keyed on 198,000 B on `WATCH-TIER.md` alone, which the 57,500 B part cap had made unreachable since 2026-09-13 — 65 rows were DUE NOW on 2026-10-09, the oldest 25 days past its own date.
4. **Counting started at register establishment (2026-06-01).** Pre-register incidental "we've seen this before" mentions in old lessons are NOT retroactive — a watch candidate enters at `occurrences: 1` even if you recall a prior pre-register sighting.

Distilled output format (alirezarezvani "distillation rules"):
- **Descriptive → prescriptive:** "I noticed the project uses pnpm workspaces..." → "Use `pnpm install`, not npm. Lock: `pnpm-lock.yaml`."
- **Verbose → concise:** remove narrative, keep the command + example.
- **Conditional → absolute:** "Sometimes you need to restart..." → "Restart dev server after any .env change."

Companion to defer-with-trigger (gut-feel) and reinforcement counting. Durability+Impact+Scope scoring is the QUANTITATIVE version of the same judgment call — use it when a lesson feels borderline.

### Step 2c: Mark the lesson your new one SUPERSEDES at its source

When the new lesson SUPERSEDES, REFUTES or WITHDRAWS an existing L# (you found it in Step 2's lookup, or your own body says so), edit THAT lesson's DECLARING heading — its own `## ` line, or the `### ` of a lesson minted under a multi-lesson batch heading (never the batch heading, which would retire its siblings); the first heading carrying its L# (`grep -nE '^###? (20[0-9-]+ — )?L<N>[^0-9]' .claude/skills/meta/MEMORY-ARCHIVE-*.md`; a later `## … L<N> amendment` section is not it; the router carries no bodies) — and append the mark at its END, after an em-dash: ` — SUPERSEDED by L<M>` · ` — REFUTED by L<M>` (when the refutation is itself the new lesson) · ` — WITHDRAWN` (when nothing replaces it; NO date — an ISO date on an undated `## L<N>` or `### L<N>` heading becomes that section's date for `memory-tier-split.mjs`, and the next forced roll renames its shard to end on that date). `<M>` is the number `lesson-mint.mjs mint` returned; a minted number cannot move, so write it as a literal — Step 2b's `@@A@@` `sed` touches only the new body, and an unsubstituted `L@@A@@` reads 0 to the detect command. A legacy lesson (the two `legacy-lessons` shards) is a numbered bullet with no `## ` heading and cannot carry the mark; name it in the new lesson's body instead. Grammar and the detect command: `.claude/skills/meta/RETIRED.md` — run it before and after; it must rise by one. Keep the old lesson's body and its in-place correction — the mark is ADDED to the heading, nothing is cut; the retirement sweep (built once ≥20 headings carry a mark) is what later moves the whole entry to `RETIRED.md`.

**Why the heading and not the body:** the sweep reads headings only. Measured 2026-10-11 before this step existed: 87 lines across the shards carry one of the marker words in capitals, 8 of them on a heading, and about 3 of those mark the lesson itself — the rest sit inside sentences in mixed wording, where no tool can tell a dead lesson from a lesson ABOUT a refutation. A body mention stays legitimate prose; only the heading mark retires.

A heading edit changes that entry's router digest row — `/wrap` Step 6b's memory-router auto-heal re-syncs it; do not hand-edit the router.

## Step 3: Expert MEMORY proposals

For each expert that was consulted or made a decision this session:
1. Identify NEW decisions worth persisting (verdict + rationale + revisit trigger).
2. Identify decisions that AGREE with existing entries (skip — no need to duplicate). **Fork on de-dup:** "agrees with an existing rule" is NOT auto-skip — branch on whether that rule was HONORED or VIOLATED this session. Honored → skip (true duplicate). **Violated despite being codified** → do NOT skip: it's an active-recall possession≠application failure (a loaded rule that didn't fire = highest-value signal), routed to `/meta corrections` `preference-violation` + the watch-register toward an enforce-layer promotion — not a new capture entry (Capture is fine; the gap is Enforce).
3. Identify decisions that CONTRADICT prior entries (flag for resolution — orchestrator decides).
4. Generate a proposed diff per expert, present as a table for user approval before writing.

## Step 3b: Panel playbook auto-update (mandatory when `/expert-review` ran)

If this session invoked `/expert-review` (any mode) at least once, append to the `## Panel Playbook` material in the CURRENT meta shard (resolved by MAX END-DATE, as for lessons — never the `MEMORY.md` router) under a dated sub-heading:

```markdown
### {Audit name} — {YYYY-MM-DD} ({mode: full/lean/spot/final-audit})
- **Contrarian assigned:** {expert-name}
- **Panel size:** estimated {N}, actual {M} ({right-sized | oversized | undersized by K})
- **High-signal finders this audit:** {expert-name (finding-count)}, ...
- **Convergence pair (if 3+ experts agreed):** {expert-A + expert-B} ({topic})
- **Factual-verification catches:** {count} (surfaced by {expert})
- **Deferrals promoted on re-audit:** {N of M} ({percentage})
- **Contrarian rotation state after this session:** {next-pool-candidates; recent-used}
```

Extract these fields from the synthesis output already produced earlier in the session — don't re-compute. If the session had multiple audits, write one block per audit. Auto-write (no approval needed) — the playbook is meta's own scratchpad.

Purpose: evolves the "Contrarian rotation" + "Sizing track record" + "Who finds real bugs" sub-sections with dated evidence instead of aspirational claims. Companion to defer-promotion rate tracking + 30% ceiling warning. First evidence-append landed 2026-04-16.

## Step 4: Skill spec proposals + alt-target check

For each skill that surfaced a gap or rough edge during the session:

1. Identify the gap (e.g., "audit-check Check 3 column was ambiguous").

2. **Choose the right target for the fix** — not every fix belongs in a skill spec:
   - **Skill spec** (`.claude/skills/{name}/SKILL.md`) → the rule is skill-specific (only that skill needs it).
   - **`.claude/rules/*.md`** → the rule is a project-wide coding standard (all code touched needs it). Examples: "every server action calls getAuthUserId first", "no readFileSync in integration tests". If the pattern would apply across multiple skills' work, propose a rules entry instead of (or in addition to) a skill edit.
   - **`.claude/templates/*.md`** → the gap is artifact repetition (multiple sessions producing similar audit reports, finding checklists, etc.). If a session produced an artifact you'd write again next time, propose templating it.
   - **`.claude/hooks/*.sh`** → the gap is automation (manual step that should fire automatically on a tool event). Hooks beat skill edits when the action must run *every time* without orchestrator memory.
   - For each candidate fix, surface the alternative-target option in the proposal table so the user can pick the right level.

3. Propose a minimal spec edit at the chosen target.

4. **CHANGELOG verification:** for every existing skill edited this session, verify `.claude/skills/{name}/CHANGELOG.md` got an entry (date + commit + WHY). If missing, propose adding it. If the file doesn't exist, create it with the standard header (per meta principle).

5. **Cross-skill lint:** check sibling skills for the same gap. Grep `.claude/skills/*/SKILL.md` and `.claude/rules/*.md` for the same pattern.

6. **Agent regen nudge:** if the proposed edit touches a domain-expert SKILL.md (one with a matching `.claude/agents/{name}.md`), output: "After applying, run `node scripts/generate-expert-agents.mjs` to sync the agent." Orchestration-only skills (meta, audit-check, wrap, expert-review, etc.) don't have agents and don't need this.

7. Before presenting, grep the target file name and the edit's subject in your own record (ALL of `DECISIONS.md` and `DECISIONS-ARCHIVE-*.md` — rejected entries can also sit under § Shipped, not only § Rejected — plus `.claude/skills/meta/ADOPTION-QUEUE.md` and `.claude/skills/meta/COMPARISON.md` § REJECTED; not in this copy); drop a proposal that matches a rejection whose revisit trigger has not fired, and say so. Generate proposed diffs, present for user approval; a proposal the owner declines gets one dated line under `DECISIONS.md` § Rejected (target · edit · reason · revisit trigger).

## Step 4b: Non-skill folder health check

While the conversation scan is loaded, do a quick orphan/drift sweep on the rest of `.claude/`:

- **`.claude/commands/*.md` orphan check:** does each command file reference a skill/concept that still exists with current scope? Stale commands actively mislead users. Flag for update or deletion.
- **`.claude/templates/*.md` use check:** were any templates referenced by skills edited this session? If a skill's spec changed and a template still reflects the old shape, flag drift.
- **Skill ancillary files:** for skills with non-SKILL/MEMORY/CHANGELOG content (`prompt-patterns.md`, `pricing-playbook.md`, etc.), spot-check ones touched this session for code/decision references that no longer hold.

This is a "background sweep" — don't propose changes unless you find something. But always run it.

## Step 5: Deferral sweep (mandatory, automated)

Search the session for: `defer`, `post-launch`, `monitor`, `track after launch`, `revisit when`, `acceptable for launch`.

For each match:
1. Verify it's in `todo.txt` with explicit trigger.
2. If missing → propose addition with (defer reason + LOC estimate + trigger condition).
3. If present but trigger missing → propose updating the existing entry to defer-with-trigger format.

This step is non-optional: defer-with-trigger is the gold pattern, and without a deferral sweep at session end untriggered defers slip through.

## Step 6: Structural gaps

Patterns that appeared 2+ times this session without a skill-level rule covering them. Surface these as "potential structural gaps" for user discussion. Don't auto-fix — these need design decisions.

## Output format

```
## /meta learn — Session {date}

### NEW lessons (auto-appended to meta MEMORY)
{N items, each with: lesson statement + concrete evidence}

### Existing lessons reinforced
{lesson # → new evidence}

### Skill spec improvements (user approval)
| Skill | Current | Proposed | Why |

### Expert MEMORY updates (user approval)
| Expert | New entry | Why | Conflicts with existing? |

### Deferral sweep
| Deferred item mentioned | In todo.txt? | Has trigger? | Promoted? |

### Structural gaps (no auto-action)
{Patterns that appeared 2+ times without a rule}

### Updated meta MEMORY
{Confirmation: lessons 17 onwards added, gaps section refreshed}
```

## Scope boundary — what `/meta learn` does NOT do

Explicit non-goals to prevent scope creep:

| Concern | Out of scope, use this instead |
|---|---|
| Project memory persistence (decisions about the product) | `/session-memory` (separate skill) |
| `.claude/settings.json` / hooks config edits | `update-config` skill |
| Skill spec markdown lint / structural validation | Not currently automated; orchestrator visual review |
| Long-term system health (>1 session lookback) | `/meta` Full Review (sibling subcommand) |
| Code-quality metrics (coverage, bundle, complexity) | CI tooling |
| Git history / commit cleanup | `/wrap` + manual git workflow |

If a finding falls into one of these, point at the right tool instead of doing the work in `/meta learn`.

**Project-memory index hot/cold split (2026-06-01).** If `/meta learn` ever reads or proposes a project-memory index entry, respect the split: the always-loaded `MEMORY.md` (hard-capped min(200 lines, **25 KB** — the harness SILENTLY truncates the tail past it) holds ONLY Trigger-Index rows + vendor `reference_*` pointers; all `project_*`/`feedback_*` topical pointers live in the COLD `MEMORY-INDEX.md` (not auto-loaded; Read/rg). A new topical pointer NEVER goes in `MEMORY.md`; pointers ≤200 chars, no per-event changelog. Canonical routing + rationale: `/session-memory` Step 4b; enforced at the write boundary by `.claude/hooks/check-memory-budget.sh`.

## Coordination with `/wrap`

`/meta learn` runs BEFORE `/wrap`. It produces the lesson extraction; `/wrap` produces the session summary + git state check. Recommended end-of-session sequence: `/meta learn` → review proposals → `/wrap`.

## Principles specific to learn mode

- **Don't extract noise.** A lesson must be a generalizable rule, not an incident log. "Today I forgot to check X" → not a lesson. "Always check X because skipping it costs Y minutes per session" → lesson.
- **Concrete evidence is mandatory.** Every new lesson cites a specific moment in the session. Without evidence, it's speculation.
- **One lesson per insight, not one lesson per incident.** Three incidents that share a root cause → one lesson.
- **Approval before persistence for skill/expert edits, auto-write for meta MEMORY.** Meta MEMORY is the system's own scratchpad; skill specs and expert memories are higher-stakes.
- **Bound the work.** If a session has 8+ candidate lessons, prioritize top 5 by impact. Don't over-fit.

## Defaults for borderline decisions

These were flagged "needs design discussion" earlier; resolved with overridable defaults:

- **Verify-after-edit:** after any SKILL.md edit, re-Read the changed section. Check (1) markdown headers parse, (2) cross-references mention real files. No external-tool dependency. Override if you want stricter (markdownlint dep) or looser (skip).
- **`/session-memory` vs `/meta learn` boundary:** the test is "would a future session about a different product still benefit from this lesson?" → `/meta learn`. Else (product-specific decision like a vendor choice, a price point, a persona) → `/session-memory`. Process patterns travel; product decisions don't.
- **Output length cap:** if total proposals exceed 40 rows, render top 20 by impact + "N more — see meta MEMORY for full list." Don't truncate the deferral sweep (Step 5) — always render in full because each unpromoted defer is a future blind spot.
- **Abort-early rule:** Step 5 (deferral sweep) ALWAYS runs — independent of whether lessons surfaced. Steps 2-4 skip if Step 1 returned zero candidate lessons. Step 6 (structural gaps) always runs because patterns can recur even in lesson-light sessions.
- **Re-entry mid-session:** if a previous `/meta learn` ran in the same session, append a `<!-- /meta learn invoked YYYY-MM-DD HH:MM -->` marker to the current meta shard, and on re-run scan only since the latest marker. Avoids re-extracting the same lessons.
