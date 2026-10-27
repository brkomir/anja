# Bash & Shell Environment Rules

Measured facts about **this machine's shell and the Bash tool**, not preferences: each rule is a way a command appears to succeed while doing nothing, or returns a number that is fiction.

Incident records (dates, seat ids, measurements, retraction chains) live in a separate archive — not always-loaded, **not doctrine**; where it disagrees with this file, this file wins.

**Appending here.** A new trap is ONE bullet in the matching subsection — DIRECTIVE + TELL + DISCRIMINATING NUMBER + ARCHIVE ANCHOR — in **one to three sentences, 150-400 bytes**; its incident record goes to the archive. ⛔ **BYTES — and `awk '{print length}'` RETURNS BYTES here, so a seat reporting "chars" from it is right about the number and wrong about the unit** (measured 2026-09-04: `⛔ ×—` reads 9 by awk, 4 characters). It self-corrects while you only compare against this cap and misleads the moment you convert. **A correction REPLACES the rule's sentence; it never appends a paragraph beneath it.** If a case fits no subsection, add a subsection — a new section at end-of-file is the last resort, not the default. The DIRECTIVE+TELL+NUMBER format governs NEW entries; a TRIMMED entry keeps directive + tell + archive anchor, and its number moves to the archive **only where the action does not depend on it** (the test: does the surviving text still determine what to do?). Before trimming ANY span, grep the archive for a `restored:` marker naming it — a restored span is ADJUDICATED, and re-cutting needs an explicit override citing the marker (measured: one wave re-cut three spans its own session had restored 12h earlier, across a compaction). MERGES are conservation targets exactly like trims — archive the absorbed section verbatim. And check whether a live guard already DELIVERS the story in its deny text (grep `.claude/hooks/`) — a guard-delivered narration is the ideal home, since the decision moment already has it.

> 📁 **PARKED — round three of the exhortation cut.** The instrument-READING layer of this file (13 sections: false zeros, false non-zeros, verifying your own edits, a probe entering its own corpus, excluding your own instrument, reading the result, vacuous controls, the control arm at claim time, an instrument measured failing, read a set's definition, an ad-hoc probe vs a shipped instrument, the dispositive discriminator, a void refutation) moved VERBATIM to an archive file which no session loads (round one scoped whole files in place; a section move lands where the preservation guard credits a move). What stays here is what this shell, this tool and this repo DO. The experiment closed with this park kept, so it is the file's permanent shape.

## Pass `timeout: 300000` PROACTIVELY on any long operation

Image renders, `npm run build`, `test:integration`, e2e, migrations. The Bash tool defaults to 2 minutes — ⛔ **and it MOVES THE CALL TO THE BACKGROUND; it does NOT SIGTERM-kill, which this line asserted until 2026-09-12.** Measured, control-armed: a child trapping SIGTERM/SIGINT/SIGHUP took **0** handler fires and was still logging **14 s** past an explicit 8 s timeout, while a real `kill -TERM` on that same pid exited through the handler — the control is what makes the zero legible rather than a broken trap. **So the work KEEPS RUNNING with no exit code and no verdict in your turn:** on a paid render you are billed and must recover the artifact from disk, and a migration apply is STILL LIVE when you read the timeout — which makes a re-run a concurrent double-apply, not a retry (`migrations.md` § AN ERROR FROM THE RUNNER IS NOT A ROLLBACK). **TELL: the tool says *moved to the background* and names a task id.** Scope: the EXPLICIT-timeout path; session-end and abandoned-task teardown are unmeasured.

## zsh does NOT word-split — an unquoted `$VAR` silently changes what runs

> 📁 9 entries from this section are DELIVERED PER COMMAND, not carried: `.claude/traps/shell-traps.md`. The directive is unchanged; only the delivery moved.
- **A computed list does not split:** `git add $FILES` passes ONE argument, not N paths — use `| xargs` or `${(f)VAR}`. A positive control must travel the SAME expansion; one written with explicit paths certifies a different instrument than a probe written `grep … $D`.
- ⛔ **ONE EMPTY OPERAND IN A MULTI-GLOB *zsh* COMMAND DESTROYS THE OTHER OPERAND'S OUTPUT — THE DEFENSIVE EXTRA GLOB IS THE DEFECT.** Measured **102 → 0** adding a `.read` variant *for completeness*; the survivor is shaped like a real empty set and rode into an owner receipt. **TELL: you widened a glob to be thorough.** ⛔ **One glob per command — NOT `NULL_GLOB`: on a SCANNING command it deletes every operand and falls back to the CWD (`grep -rl 'sk-' missing1* missing2*` → an unrelated file, rc=0 — a false ALARM on a secret sweep).** bash does not abort at all (rc=2, per-operand errors).
## THE HARNESS DISCARDS A HOOK'S STDOUT WHOLESALE UNLESS IT IS EXACTLY ONE JSON DOCUMENT — TWO FINDINGS DELIVER NEITHER

Measured live twice, independently: a hook emitting two `hookSpecificOutput` documents delivered **both canaries absent** and the model answered "NONE"; one document arrives verbatim. **The more a guard has to say, the less the model hears** — so an emit-once flag is a correctness requirement, not tidiness. ⛔ And `cmd | helper` runs the helper in a SUBSHELL, so a flag set inside it does not persist (measured: pipe = 2 docs, heredoc-into-function = 1, process substitution = 1) — and a unit test written in the ARGUMENT form while every caller uses the PIPE is structurally incapable of exhibiting it.

## Generate, THEN assert — an assertion placed before its own generator is green on every warm machine and RED on every clean checkout

Reading an append-only log, cache or fixture dir BEFORE the line that writes it consumes the previous run's copy: green for every box that has run the suite, RED for CI, a fresh clone and a detached worktree. **TELL: two instruments disagreeing at the SAME SHA.** Verify any state-touching suite in `git worktree add --detach <dir> HEAD` against a COLD artifact store.

## Before reading "X did not change" as evidence, check the artifact that changes UNCONDITIONALLY

**TELL: two unchanged files, not one** — `MEMORY.md unchanged` alongside an unchanged `CHANGELOG.md` (which changes on every successful roll) meant the mutant had died on `ERR_MODULE_NOT_FOUND`, stderr suppressed, rc=0 from a pipe. ⛔ The premise fails on a legitimate no-op branch, so the real question is **"did the process REPORT"** — read the return/exit path, not file mtimes. Place a mutant BESIDE its imports and read rc unpiped (`cmd > /tmp/out 2>&1; echo $?`). A no-run that argues AGAINST you is accepted instantly and feels like honesty.

## A token sweep MUST find the file that EMITS the token — a zero is the instrument, not the world

The emitter is a needle you did not have to plant, so a sweep for a string the code prints cannot legitimately return ZERO; confirm the emitting file is in the results before trusting the rest. **Quote your globs** — ⛔ **an unquoted `--include=*.sh` dies by `nomatch` ABORT, not cwd-expansion (this named the wrong symptom until 2026-08-27).** Nothing is named `--include=*.md`, so zsh kills the WHOLE command before grep runs: measured, unquoted → ZERO stdout, `--include='*.md'` → 2. Archive.

## When ONE commit changed N items, COMPARE all N readings — a split reading indicts the instrument

Items deleted, renamed or added together cannot land differently: an unanchored grep read 12 on one co-deleted key (exactly like "the deletion never landed") while its sibling read 0 — the 12 were superstrings (archive: the confirmDeleteCuration case). ⚠️ It certifies nothing when every sibling shares one blind spot.

## After ANY change to how a value is STORED, grep for the instruments anchored to the old form — in the SAME change

Wrapping, folding, renaming, re-pathing and re-encoding all silently invalidate every anchored instrument, and the failure is a NO-OP, not an error: a single-line anchor misses a folded YAML scalar, and — commonest — **a magic literal becomes a named constant and every instrument that scraped it dies** (archive: the `DIGEST_CAP` case, plus the vi.mock/reflow shapes). **Fix a scraped literal by EVALUATING the module and reading the SYMBOL (`ast` + a namespace, the `CAP_SYMBOL` shape), never by widening the regex.** ⛔ **AND AN INTERPOLATED VALUE IS A REPRESENTATION VARIANT TOO: grepping the VALUE cannot see code that carries the VARIABLE.** Measured 2026-08-28: `grep -n 'Pointers <=200'` returned ONE hit, a comment, and was reported to a peer as a discharge — while the live block-mode deny string read `Pointers <=${POINTER_CONVENTION_CHARS} chars` with the constant at 200, stating a RETIRED rule to every blocked seat. **Grep the KEY or the assignment (`Pointers <=`, the constant NAME), never the interpolated value** — and note the clean single hit reads exactly like thoroughness. A case variant is a representation variant: add `-i` to every absence grep over prose — this corpus capitalises for emphasis mid-paragraph — on EVERY pipeline stage.

- ⛔ **A LITERAL-NAME GREP CANNOT ANSWER A QUESTION ABOUT A *CHANNEL* — THE NATURAL CONSUMER IS A WILDCARD QUERY.** Measured 2026-08-26: `grep -rln '<event-name>' scripts/ src/app/` → **0**, written up as *"nothing reads this telemetry channel at all"* and committed as a tracker row's parking rationale; an analytics script had been running a prefix-wildcard query on that channel for three days. The probe was sound and still reads 0. **Grep the PREFIX and the emitting call, never the event name.**

- ⛔ **A GUESSED FIELD NAME OVER SOMEONE ELSE'S ARTIFACT READS "no <field>" AND IMPERSONATES A REFUTATION OF A TRUE FINDING** — six wrong-shape reads preceded the real path (`frameScaleRef.frameMaxAt`); accepting read #1 would have kept a lever review correctly killed (2026-08-27; archive). Dump the artifact's KEYS before probing values.

- ⛔ **A GUESSED DESTINATION *PLANE* IS THAT ZERO ONE AXIS OVER, AND IT READS AS AN ACCUSATION, NOT A MISS.** Grepping `.claude/orchestrator/` alone for a peer's annotations read **0 of 2**; both had landed in `.claude/rules/`. **TELL: an absence probe over a file somebody else chose the home for.** Read the LANDING COMMIT, never the plane you expect (2026-09-07; archive).

## SPELL A CONTROL CODEPOINT (`U+0000`, `U+202E`) — NEVER CARRY THE CHARACTER

A literal control char in a comment is invisible to the editor, `grep`, the diff and review; only `cat -v` / `od -c` see it, and no assertion or mutation reaches a comment. ⛔ **AND INSIDE EXECUTABLE CODE IT IS GREEN UNDER tsc AND THE SUITE** — a composite key built as `${old}\0${new}` (two literal NULs meant as a space) passed 232 tests because both sides used the same byte; the only tell was `grep` returning a clean ZERO on a source file it had silently classed binary. `od -c` the edited line; prefer `JSON.stringify([a, b])` over a separator char when a part is user-controlled. Compose the bytes in code inside a probe FILE (`String.fromCharCode(0)`) — the Bash tool rejects raw control bytes in a command line, and escaping harder is the wrong fix.

## THE `Edit` TOOL STRIPS TRAILING SPACES AND TABS FROM EVERY LINE OF `new_string` — EXCEPT IN A `.md` FILE

`old_string` matches its trailing space literally, but outside `.md` the replacement loses it (`ROW-X — ` wrote `ROW-X —first` in a `.txt` file) and the result reports success. **TELL: a `new_string` line ending in whitespace on a non-`.md` target — end the anchor on a non-space character.** Measured 2026-10-05: identical edits kept the space in `.md`, dropped it in `.txt`.

## A MULTI-FLAG MODE SELECTOR ASSERTS MUTUAL EXCLUSION (`both → usage + exit 1`, ~2 LOC)

A chained `const mode = ...` ternary given `--prep --measure` runs PREP ONLY and exits 0 with prep-shaped output — the measurement you believe ran never did. Otherwise, read the mode BACK out of the output.

## ONE DEFAULT PER GATE — an `export VAR="${VAR:-1}"` inside a conditional PLUS a top-level `${VAR:-1}` IS TWO DEFAULTS

The consumer's `:-` silently BECOMES the behavior on every path the conditional excludes, and it looks like a harmless restatement of the export's own default. **Enumerate the paths reaching the consumer WITHOUT the export and state what the default means there** — a truth table over {enabling-condition} × {unset, 0, 1} costs one command.

## READ A BACKGROUND RUN'S VERDICT FROM THE ARTIFACT, NEVER FROM THE HARNESS'S REPORTED STATUS

> 📁 4 entries from this section are DELIVERED PER COMMAND, not carried: `.claude/traps/shell-traps.md`. The directive is unchanged; only the delivery moved.
- **Drop the inner `&`.** `python3 script.py &` inside a call already `run_in_background: true` double-backgrounds it: the wrapper exits in ~1s, the harness reports `status=completed · exit code 0`, and **no completion notification ever arrives** — the task silently becomes poll-only.
- **A documented exit-code CONTRACT can collapse two OPPOSITE spend states onto one code** — the focus/ceiling runners return rc=2 for "bare invocation, spent nothing" AND "filter-scoped paid run, completed, $N spent", so rc can never separate refusal from completion. **The discriminators are the ARTIFACT (results file present?) and DURATION** — "completed in under a minute, far too fast for 52 paid draws" is what caught a $0 no-op.
- ⛔ **A MULTI-STAGE RUN RE-INVOKING ITS OWN SCRIPT PER STAGE READS THE DISK AT EACH STAGE — an edit during stage 1 IS EXECUTED by stage 2** (a paid arm ran a mid-flight fix; 2026-08-27, archive). Copy the runner to a pinned path before firing, or hold edits until the run drains.

## DATE THE POPULATION AGAINST THE POLICY BEFORE INFERRING A CONVENTION FROM REPOSITORY STATE

Tracked files bypass `.gitignore` permanently, so `git ls-files | wc -l` over a run-output directory mixes two eras — and legacy INFLATES the count of the very category the policy later BANNED, so the instrument argues *for* the retired practice. **`git check-ignore --no-index` is the discriminator** (*would the pattern match if this were untracked* — the question a precedent count is pretending to answer). ⚠️ The fossil layer is NORMAL: the defect is in the INFERENCE, never the tree, so no `git rm --cached`. Enumerate the whole population — a `head -3`-capped `git log --diff-filter=A` returns a stale date.

## STATE A NUMBER'S DENOMINATOR BEFORE IT LEAVES YOUR SESSION

A correctly-computed value can range over a population narrower than your sentence. **The discriminator is never the value, it is the DENOMINATOR.** Each of these fails LOW and reads as reassurance, because a partial count is shaped exactly like a total. ⚠️ **The class fails in EITHER direction — a too-LARGE denominator fails HIGH toward false ALARM, and its cost is different in kind: it tells a future reader to revert a mechanism that is fine** (measured: a /17 where the population was 14 reported a 2.45×-safe margin as a hair's breadth; the safety conclusion INVERTED; archive).

| instrument | the number | the smaller question it answered |
|---|---|---|
| vitest `--bail=10` | `6 failed` | *of the 5 files that ran*, not the 590 collected (true: 7) |
| a `head`-capped grep | a clean top-N | *of the first N*, not of the set |
| `git log -S` (case-sensitive by default) | `0` | *of EXACT-CASE matches*, on an ALLCAPS corpus — `-i` widens it |
| a hand-rolled `<me>__*` mail glob | `N unread` | *of the DIRECT slice only* — `all__*` broadcasts are excluded BY CONSTRUCTION, so it is a FLOOR. Measured 2026-08-26: glob **29**, `--peek` **50**, the gap exactly the **21** broadcasts. ⛔ This row read *"`mail-check` peek total … of one recipient's slice"* until then — **backwards**: peek is the WIDER number. |
| a suite's raw `PASS: N` quoted ACROSS SHAs | `741` vs `744` | *of the suite AS IT EXISTED AT THAT SHA* — **name the SHA beside any pass count that leaves your session; for a before/after pair run BOTH arms at one SHA** (archive: the three-seat incident — each correct at its own SHA, none comparable) |

### AND A STATUS WORD HAS A DENOMINATOR TOO — `clear` / `done` / `green` / `closed` NAME A POPULATION AND CARRY NO NUMBER TO ATTACH ONE TO

The section above fires on a NUMBER, and its whole remedy is *name the denominator beside the
value*. **A status word has no value, so nothing in it invites the question, and the word silently
inherits the population you were last thinking about rather than the one your sentence names.**
Measured 2026-09-18, owner-facing, on a production push: I derived *clear* correctly for the three
review loops I had been tracking, then wrote **"review state on the range — clear, every commit has
a verdict"** over a range of **257** commits of which **7** carried a verdict and **249** had never
reached a reviewer. Every derivation behind the word was right; the word ranged over a population I
never measured. **TELL: the sentence contains a scope noun (*the range*, *the suite*, *everything*,
*all of it*) and no number anywhere near it** — which is exactly why the denominator rule cannot
fire. **Say what the word ranges over and confirm you measured THAT set:** *"the three loops that
were open have closed; the range as a whole was never reviewed."* ⚠️ It fails toward REASSURANCE and
it is asserted as fact, so nobody re-checks it — the expensive half is that a correct derivation is
what makes the sentence feel checked.

### GATE A REASSURANCE ON THE QUANTITY IT MAKES A CLAIM ABOUT

The section above governs a number's denominator; this governs the CAVEAT beside it. `if writes == 0:` guarded a floor-caveat whose claim was about **rows** — and a write-record can extract zero rows, so a single short-line edit printed `MISSING: 0` with the caveat SKIPPED: **the tool at its most confident exactly where it knew least.** **TELL: the guard's variable and the caveat's noun are different words.** Gate on `if not rows:`. Not hypothetical — the tracker lines under the 40-char floor are the DOMINANT case, not the edge. ⛔ **DERIVE THE COUNT, NEVER CITE ONE FROM HERE — and name its population, date and command when you state it.** A bare count once stood here and THREE readers reproducing it got **three different numbers**, because the clause named no population, no date and no command — so each guessed a predicate and each guess was defensible. That is worse than drift: drift means a number aged, this means it was never checkable, in the file whose own § STATE A NUMBER'S DENOMINATOR governs it. ⚠️ *And this clause is now a member of the corpus its own remedy globs — `if not rows:` returns 3 real code hits plus this quotation; count the hits, never the total.*

### EXCESS OVER A CONVENTION IS NOT AVAILABLE HEADROOM — MEASURE THE YIELD ON A SAMPLE FIRST

The gap is mostly load-bearing content the rule never priced. Measured: **59 rows / 4,171 B over a 200-char convention**; nine compressions yielded **82 B (~9 B/row)**, three rows had zero slack. **TELL: you are handing the owner an aggregate excess as the size of a lever.**

### A BUCKET BREAKDOWN IS A DENOMINATOR CLAIM AND ITS ONLY CHECK IS ADDITION

A partition whose parts do not sum to the whole the sentence states them over. Measured twice in one day, one author: `4+12+43+8+4` shipped as *"across the 79"* (**=71**, mailed to a peer who acked it). The buckets counted rows that RETURNED A VERDICT; the denominators counted rows DISPATCHED. **Add them before the sentence leaves your session; a short sum means two questions — say so, never invent the residue.** Archive: 2026-08-26.

### THE INVERSE FAILS HIGH: A SHARED-ARTIFACT BEFORE/AFTER DELTA ATTRIBUTES THE FLEET'S WRITES TO YOU

A `wc -l` bracketing your own command measures **every writer**, so a nonzero delta is the fleet and a zero delta is luck. **THE FIX IS THE PREDICATE, NEVER THE THRESHOLD** (`delta < 5` only makes a wrong question unfalsifiable): scope to members you own, as `grep -cF '"session": "<fixture-id>"'` before/after is exact and immune to peers. Applies to any shared counter you bracket, incl. `git rev-list --count` on a shared branch.

## A CERTIFYING INSTRUMENT'S SCRATCH STATE GOES IN `mktemp` — A FIXED MACHINE-GLOBAL PATH IS CORRUPTED BY ITS OWN OPERATOR

The § above governs a shared artifact a PEER writes; this is the instrument's OWN state file, and the second writer is usually YOU — a hand-run of the same tool while a long run is live. **TELL: a plausible verdict, never an error.** Measured 2026-08-26 on `smoke-mutation-matrix.sh` (`BASE="/tmp/_base_pass.txt"`): two hand-runs under an ~82-min census produced **two false UNGUARDED** and **~6x inflation on every surviving verdict**. Under a uniform padding P, `observed = true + P` — **every item reads HEALTHY regardless of truth, so a healthy verdict in a poisoned era carries ZERO BITS. Discard the run; do not triage it** (the corruption is time-varying within one run and the output records no timestamps). ⚠️ A post-run re-read control catches only the INFLATION direction and an empty-baseline gate only TOTAL emptying — a PARTIAL clobber slips both; the three-arm record + figures: archive.

## A CHECK YOU INTEND TO *READ* CANNOT PRECEDE A MUTATION IN THE SAME BASH CALL — THE TOOL DELIVERS ALL OUTPUT AFTER THE CALL COMPLETES

The section above says put the gate IN THE SAME COMMAND AS THE COMMIT, and that is right; this is the form it must take. One Bash call returns its whole transcript at the end, so a verification line placed before a mutation is not a weak gate — **it is unreadable in time by construction**, its output a post-mortem of a decision already made (measured; archive). **Make the SHELL the reader: MACHINE-gate in that same call (`grep -q … && { echo ABORT; exit 1; }` — measured stopping the mutation, rc=1), or put the check in its own call you read FIRST.** Printing-then-mutating feels like both and is neither. ⛔ **FOR A QUOTED RECEIPT THE MACHINE-GATE REMEDY DOES NOT TRANSFER — the separate-call form is the ONLY valid one:** a number you QUOTE into a mail/commit/readout body cannot be `grep -q`-gated (the body is composed before the call runs) — measured; archive. Verify in a PRIOR call; then compose. ⛔ **AND AN OUTBOUND COMPOSED IN THE MUTATION'S OWN CALL ANNOUNCES STATE THAT NEVER HAPPENED:** a hold-clear mail in the same `;`-chain as a REFUSED commit interpolated `$(git rev-parse HEAD)` and announced a fix at a PEER's sha — a plane with no post-hoc correction. Compose from values verified in a PRIOR call, never a live substitution beside the mutation. ⛔ **AND "LIVE SUBSTITUTION" IS TOO NARROW — A CITATION YOU *TYPED FROM EXPECTATION* FAILS IDENTICALLY AND PASSES EVERY CHECK THIS CLAUSE PRESCRIBES (2026-09-16).** Every clause above describes a shell expansion that RAN and returned a wrong value, so a seat scanning its draft for a `$(…)` beside a mutation passes clean and still ships a fabricated citation. Measured the same night, two seats, neither substituting anything: an index-blob sha typed into a fleet broadcast without being read (the real value differed, and it would have told peers their own staged blob was foreign), and a ledger row naming a mail filename composed in the SAME call as the send, whose timestamp could not have been known when it was typed. **General form: a citation composed BESIDE the act rather than read AFTER it — whether the shell substituted it or you typed it from expectation.** TELL: your sentence names a sha, filename, line number or count you did not read in a PRIOR call.

⛔ **`|| true` ON A GATE'S OWN GREP CONVERTS IT INTO A PRINT — it runs, prints a count, and CANNOT REFUSE.** `N=$(grep -cF '<tok>' f || true)` never exits non-zero, so a `&&`-chained abort after it is unreachable. **TELL: the gate's grep carries `|| true` — no failing branch.** Assign, then TEST. Measured: a peer's line swept into an unrelated commit; archive.

⛔ **THE SAME ATOMICITY BITES FROM THE OTHER END — A BLOCK-MODE `PreToolUse` HOOK DENIES THE WHOLE CALL, NOT THE MATCHED SEGMENT, SO A MUTATION COMPOUNDED WITH A DENIABLE PROBE NEVER RUNS AND THE DENIAL NAMES THE PROBE.** This rests on the CONTRACT, not a fire count: a deny rejects the TOOL CALL, and a compound command is ONE tool call, so a deny triggered by section 3 discards sections 1, 2 and 4 unexecuted — true of every block-mode PreToolUse hook, no observations needed. **The diagnosis is what makes it expensive: the refusal describes the PROBE, so the natural reading is "my grep was wrong" while the write you compounded ahead of it silently did not happen.** ⚠️ It bites hardest on exactly the gate-and-mutate shape this file prescribes — that call is BOTH the thing you must not split and the thing one deniable token voids entirely. **Put a mutation in its own Bash call whenever anything else in the call could match a block-mode hook; after any denial, content-key the mutation (`grep -cF` the token) rather than assuming the denial was scoped to what it named.**

## COMMIT-PLANE AND MAIL-PLANE SECTIONS — RELOCATED

Nine sections only the orchestrator can act on moved, with the copy's edits, to `.claude/orchestrator/commit-doctrine.md` (the commit-verb collision table, the numstat gate in the same command as the commit, the lost-update-in-HEAD bisect, the `:(literal)` safe-commit trap) and `.claude/orchestrator/session-doctrine.md` (shard filename re-resolution, the memory-pressure dispatch denial, counting unread mail, marking one mail read, naming the instrument before a seat's name goes next to a sha). The session doctrine is delivered at SessionStart to the main session; the commit doctrine arrives on the first commit-shaped Bash call of each context window via `.claude/hooks/commit-doctrine-inject.sh` (event-scoped in round two of the exhortation cut; this sentence read "Delivered at SessionStart" for both until then). Neither reaches a sub-agent — sub-agents never commit, mail or roll a shard. The shell traps that any seat can trip stay here.

### WRITE A GATE SO INSTRUMENT FAILURE LANDS ON THE FAILING SIDE

A deletion gate fed an UNSPLIT pathspec (zsh handed it one bogus multi-path argument) reads **0 deletions**: one expecting NON-zero aborts loudly, while `[ "$DEL" = "0" ]` passes VACUOUSLY on the identical bug. **Expect the positive reading; treat 0/empty as "instrument broke", never "nothing to report".**


## VERIFY YOUR OWN PLANE — A BRIEF'S ISOLATION CLAIM IS NOT A MEASUREMENT

`isolation: "worktree"` is a REQUEST, granted at dispatch and not guaranteed to survive a resume. ⛔ **`--path-format=absolute` IS LOAD-BEARING — "any cwd" was FALSE until 2026-09-01, in the PERMISSIVE direction.** The bare form returns two SPELLINGS of one directory from any subdirectory (measured in `scripts/`: `--git-dir` absolute vs `--git-common-dir` `../.git`), so it reads DIFFER and grants you "your own worktree" while you stand in the SHARED repo — lifting this section's own prohibition. Archive. **TELL — identity-free, any cwd, no path matching:**

    git rev-parse --path-format=absolute --git-dir   vs   … --git-common-dir
    EQUAL   (same absolute path)                    -> the SHARED repo
    DIFFER  (`…/.git/worktrees/<n>` vs `…/.git`)    -> your own worktree

`--show-toplevel` does NOT discriminate — inside a worktree it returns the worktree root.

⛔ **NEVER RESOLVE A WORKTREE — OR ANY SHARED-`/tmp` ARTIFACT — BY PATTERN + `tail -1`.** `git worktree list | grep -F '/wt ' | tail -1` matched an OLDER leftover belonging to another seat; two mutations ran inside it and it was `worktree remove --force`d (2026-09-03). The tell was in the output: a file the main tree has was MISSING inside "my" worktree. Save the exact path at creation, guard with a two-file presence check, remove by that path. Same class as the `tee` read-back glob that returned a peer's suite result (2026-08-21) — this is the destructive instance.

**DIRECTIVE.** In the shared repo, on a path you did not create: no state-changing git verb (`checkout` `reset` `clean` `stash` `branch -D` `rebase` `merge` `worktree remove`) and no in-place mutation (`sed -i` `rm` `mv` `>`) — **do not write to a tree you do not own, BY ANY MEANS**; a git-verb-only reading misses a `sed -i` breach. ⭐ **The switch is usually unnecessary: worktrees share ONE object database, so `git show <sha>:<path>` reads any blob from any cwd, including a commit your own tree lacks — read at a ref, and never put a bare `git checkout <sha>` in a fan-out brief.** ⚠️ The check is YOURS: no hook can enforce it (`CLAUDE_CODE_CHILD_SESSION` is `1` for the orchestrator too), and the harness refusal conditions on the agent BEING isolated — `git -C <shared> rev-parse --abbrev-ref HEAD` from an un-isolated agent returns `main`, rc=0.

## FOUR GIT PROBES THAT SILENTLY ANSWER A DIFFERENT QUESTION — a well-formed WRONG answer, not an error

> 📁 5 entries from this section are DELIVERED PER COMMAND, not carried: `.claude/traps/shell-traps.md`. The directive is unchanged; only the delivery moved.
## ASK A VENDOR SOURCE FOR THE EXACT LINE OR SYMBOL, NEVER THE BEHAVIOUR

Two WebFetch reads of the SAME STATIC file in the vendor's open-source auth server inverted each other: "which routes are captcha-wrapped?" said `/token` was NOT wrapped; asking for that route's registration line returned the line itself, and it showed the captcha check wrapped around the token route. The summarizer compresses structure to answer a broad question, **so two seats agreeing licenses nothing — they share the failure mode.** Better still, fetch the raw file and grep it yourself.


## WRITE A `.mts` SCRATCHPAD FILE — `npx tsx -e '<inline>'` TRANSPILES TO CJS AND TOP-LEVEL `await` FAILS

`ERROR: Top-level await is currently not supported with the "cjs" output format`. Write the snippet to `<scratchpad>/*.mts`, then `npx tsx <file>`.

⛔ **`tsx --dry-run` IS NOT A TYPECHECK — it transpiles, so every green after it measures SYNTAX**, and the route in is a config warning read as noise: **TS5112 (`tsconfig is present but will not be loaded if files are specified on commandline`) means your tsconfig was IGNORED.** `npx tsc --noEmit` is the only typecheck. **Treat any "will not be loaded" / "ignored" / "not applied" line in a toolchain's own output as a FINDING.**

⛔ **RE-DERIVE A CHALLENGED "DOES NOT EXIST" CLAIM BY CAPABILITY — the symbol / import / call the thing MUST contain — never by filename pattern.** A filename probe reported a harness missing where a capability grep over `scripts/` found nine runners; **a context-loss story is self-consistent, exculpatory, and retires the investigation before the grep gets run.**

⛔ **A PACKAGE `exports` MAP BLOCKS BOTH ROUTES TO A DEPENDENCY'S `package.json`.** `import(…,{with:{type:"json"}})` and `createRequire(…)('<pkg>/package.json')` BOTH throw `ERR_PACKAGE_PATH_NOT_EXPORTED`; only `readFileSync('node_modules/<pkg>/package.json')` works. **TELL: three probes fail identically, so it reads as a broken script.**

## WHEN THE AUTO-MODE CLASSIFIER IS DOWN, ASSERT NOTHING LANDED

**TELL: `… is temporarily unavailable, so auto mode cannot determine the safety of Bash right now`.** Inverse of every other entry here — the command does not run at all, so the hazard is assuming your write landed. Content-key the target (`grep -c` your token) before re-running; a blind retry after a partial is how you double-apply. **The escape is the dedicated tools: Read / Edit / Write / Glob / Grep do not consult the classifier — IN THE CLASSIFIER-DOWN CASE ONLY. When the classifier is UP and denies a protected TARGET, `Edit` and `Write` on that target are denied too (the gate is on the target, not the method — measured 2026-09-07 on `.claude/settings.json`); the route that worked was the user running the prepared script themselves with the `!` prefix, a route only the user can take.** The always-loaded write marker — per session since 2026-10-25, `/tmp/claude-always-loaded-allow.<full session id>` — is the exception, where the classifier has gated the method: it can deny the `touch`, and Write created the file until 2026-10-25; the guard now refuses a file-tool write of the door. That was never permission — do not create the marker with Write, Edit or any other command; ask the user to run the `! touch` line the guard's deny prints, which names this session's id. ⛔ **THE ESCAPE LIST HAS NO MEMBER FOR `Agent`, SO AN OUTAGE SILENTLY TRUNCATES A FAN-OUT:** 2026-09-13, **2 of a 25-slice wave never dispatched**. **TELL: this section's own headline message ONE WORD OVER — `…cannot determine the safety of Agent right now` — it DOES surface in-turn, so READ IT before counting anything** (three earlier versions of this clause said the loss was invisible; it is not). **DETECTOR: diff the two dispatch ledgers, WAVE-SCOPED** — attempt (`agent-dispatch-memory-guard.sh`, PreToolUse) vs start (`log-subagent-dispatch.sh`) — **35 vs 33**, clean **13/13** control, and it NAMES the slices; ⛔ **day-wide is NOISE — a RESUMED agent starts with no attempt row (one seat read −13).** **ACTION: re-dispatch the gap.** ⚠️ `wrap-reconcile.mjs`'s range check does NOT reach it — the slice `sed` runs in the AGENT's context, so the orchestrator transcript carried **3** wide ranges against a planned 25. Archive.
