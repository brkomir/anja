---
paths: [".claude/hooks/**", ".claude/rules/**", ".claude/orchestrator/**", ".claude/commands/**", ".claude/skills/meta/**", "scripts/**", ".githooks/**"]
---

# Session Cadence Rules

⛔ **PATH-SCOPED — NOT always-loaded, on a deliberately narrowed glob.** Loads on reading a
file under `.claude/hooks/`, `.claude/rules/`, `.claude/orchestrator/`, `.claude/commands/`, `.claude/skills/meta/`, `scripts/` or
`.githooks/` — the surfaces guard, rule and meta authorship touch (this repo ships its guards in `scripts/`).
⚠️ It read `.claude/**` until 2026-09-03, which matched every expert agent's own `MEMORY.md`, the file each is told to read first.
A compaction does NOT re-inject it, and `CLAUDE.md`'s router table is the only always-loaded carrier. **About to propose a
guard, promote warn→block, count occurrences toward a ship bar, or route a calibration — with no
`.claude/` file read yet? READ THIS FILE FIRST.** ⚠️ *If this scoping ever misbehaves, the evidence arrives as a rule in
this file failing to FIRE — no red test exists for that; treat a should-have-fired miss as a
loading-contract suspect FIRST.*

Two subjects, one law each. **VELOCITY** — a meta-system sprint displaces product work (displacement-activity counterweight), so the session caps itself. **GUARDS** — a meta-session's characteristic output is a new detector, and almost every way one is wrong is invisible from inside the session that proposed it.

**Scope:** meta-system edits (`.claude/skills/meta/**`, `.claude/skills/*/SKILL.md`, `.claude/hooks/*.sh`, `.claude/rules/*.md` additions, `.claude/commands/*.md` additions). Product feature/flow work has NO velocity cap.

Incident records (dates, seat ids, shas, measurement narration, the narrated grep-blowup TP/FP tally, retraction chains) live in a separate archive file — not always-loaded, **not doctrine**; where it disagrees with this file, this file wins.

**Appending here.** A new trap is ONE `###` entry in the matching section — DIRECTIVE + TELL + DISCRIMINATING NUMBER + ARCHIVE ANCHOR — in **one to three sentences, 150-400 bytes MEASURED OVER THE BODY, not the heading**, and its incident record goes to the archive. ⛔ **THE CORPUS HAS TWO FORMS, NOT ONE: `###` entries AND ONE top-level `- ⛔` MIRROR BULLET (under § A HALTING GUARD WITH AN INERT TRIGGER), which is the right form for a clause that inverts the entry directly above it and counts INSIDE THAT PARENT ENTRY BODY for the budget rather than as an entry of its own**. ⚠️ **AND THE BUDGET IS A TARGET FOR WHAT YOU ADD, NEVER A CONFORMANCE CLAIM ABOUT WHAT IS HERE: many bodies exceed 400 B, so a sweep reading it as a rule this file passes will report false breaches.** **A correction REPLACES the rule's sentence; it never appends a paragraph beneath it.** If a case fits no section, add a section — a new section at end-of-file is the last resort, not the default.

## VELOCITY (SC-1)

### RUN THE displacement-activity counterweight ENUMERATION BEFORE THIS SESSION'S 4TH META-SYSTEM COMMIT

A meta-system commit is any of: a meta/CHANGELOG `## v2.X.Y` entry — ⛔ **grep `CHANGELOG*.md`, the GLOB: that file is a two-tier ROUTER too, and `grep -cF '## v2.'` reads 0 on it** — a new SKILL.md, a new hook, a new rule file, a new command. At the 4th, FIRST: (1) grep `todo.txt` + `project_critical_flows*.md` — **the GLOB, not the file: that tracker became a router, so the router alone reads 0 and this STOP cannot fire from that source** + `project_feature_audits.md` for unshipped product gaps; (2) count this session's product commits vs meta commits; (3) if **≥3 launch-blocker items are unshipped AND product-commit-count is 0** → STOP meta work, save the remaining proposals to the Adoption Queue WITH triggers, switch to product.

⛔ **STEP 1 COUNTS *MENTIONS*, STEP 3 NAMES *UNSHIPPED ITEMS* — NOT THE SAME QUANTITY, SO READ THE ROWS AND NEVER THE COUNT.** **TELL: your gate's number came from a grep.** The glob STAYS.

### CHECK FOR THE OWNER DIRECTIVE **BEFORE** THE ENUMERATION, AND NEVER ESCALATE THE CAP

An explicit user directive to batch-ship beats the cap (SC-1 clause 4), so a session whose meta work the owner NAMED is exempt *before* step 1 — check first, then skip the count entirely. Log it as "override weight" per META-F6; an unlogged override is indistinguishable from a breach at the next audit. ⛔ **The cap is a SELF-check — step 3 says stop-and-queue, it never says "ask the owner", and the escalation is something a seat ADDS on top.** **Running a rule's procedure carefully is not the same as reading its exemptions.** Whether to keep going on meta work or switch to product is the owner's decision, not the cap's.

## BEFORE YOU PROPOSE A GUARD

### A HALTING GUARD WITH AN INERT TRIGGER IS WORSE THAN NO GUARD

The rules below ask whether a detector is the right SHAPE; this asks whether yours can FIRE. **Exercise the trigger on a real instance before shipping; if you cannot, say IN the rule that detection is unverified and name the test.** TELL: the ritual converts silence into ASSERTION — the more disciplined the seat, the more false all-clears. ⛔ **AND THE MINT IS NOT THE SHIP** — a lesson that names its firing surface has not created it. **Name the surface, then GREP it exists, before writing "banked".**

- ⛔ **THE MIRROR — A DETECTOR KEYED ON A NAME CAN NEVER FAIL, AND THE CHECK ABOVE PASSES IT: it matches your real instance and every sentence ABOUT the gate, its own spec included.** **TELL: firing is not discrimination.** Anchor on an ARTIFACT (digits+ext). Mutation-test it (§ MUTATION-TEST THE PREDICATE BEFORE PROMOTING, below).

### A LIMITATION WRITTEN BESIDE A GUARD IS A CLAIM ABOUT THAT GUARD — MUTATION-TEST IT TOO

The entries above test the guard; nothing tests the CAVEAT next to it, and a documented wrong
one is worse than no comment, because it tells the next reader which edits not to bother
checking. **TELL: you are writing "this guard cannot see X" in the same pass
that earned you credit for measuring rather than reasoning.** Run X as an arm, or
write that the bound is unverified.

### A DECLARED COUNT CAN BE SATISFIED; A REFUSAL CANNOT

A count's only power is forcing the operator to LOOK, so a MATCHING number RELEASES that attention: the gate issues a receipt for a reading that never happened. **A refusal has no satisfying input, so its read is unconditional — THAT is the remedy, not a tighter count.** **TELL: the pass condition is an equality the operator supplies.**

### ASK WHETHER THE REMEDY IS A DETECTOR AT ALL, OR A CONVENTION

SC-2 below presumes a detector is the right SHAPE of answer. Measured **5 consecutive times against proposers**: each proposal named a genuine class, each passed SC-2, and each was refuted by its own measurement — the shipped remedy every time was a written convention or ≤5 lines wiring something that already existed. ⭐ **Ask whether the property you are detecting is a JUDGMENT.** This entry is the live carrier of *"no predicate-sharpening reaches an intent question"* (its first home, `active-recall.md`, is parked), so a judgment-valued property needs NO new lesson and NO detector — it needs a convention.

### A SIGNAL THE CAUSING SEAT ALREADY FILED AS NOISE IS A PLACEMENT PROBLEM, NOT A VIGILANCE ONE

Measured channels, none caught by its author: a spill preview, a hook's own fire line, a marker visible only on a second run. ⛔ **"Be more careful" is not an acceptable remedy for this class**, and the corollary binds guard DESIGN: a guard whose deny text lands where its reader has learned to skim has already failed however correct its predicate. **Check where the output is READ, not whether it is EMITTED**.

### MEASURE THE BASE RATE ON THE REAL CORPUS BEFORE WRITING THE PREDICATE

A detector's value is `hits × cost-per-miss`, and the corpus answers the first factor in one command. **Under a few percent, a convention plus a line in the rule that governs the writing beats any predicate** — and unlike a predicate it cannot false-positive. Measured kills: a dead-citation walker refuted at a **1.5% base rate**; a 2026-08-24 candidate at **0.085%**, whose best predicate read 528 mentions per true positive.

### A CHECK COPIED FROM A SIBLING TOOL INHERITS ITS SHAPE, NOT ITS COVERAGE

**TELL: you reused a check's pattern without re-deriving whether each leg reaches the new corpus.** Enumerate its legs before trusting its OK line.

### A REJECTION RESTING ON A COUNTER-EXAMPLE EXPIRES WHEN YOUR OWN LATER CHANGE BANS IT

The refutation dies and the "do not re-propose" note outlives it, so the next seat reads a live prohibition backed by nothing. **TELL: you rejected a fix on one counter-case, then shipped a convention forbidding that case.** Re-read your own rejections after any convention lands.

### REVERSING YOUR OWN RECENT PROPOSAL ON A NEW AXIS IS CONVERGENCE, NOT OSCILLATION

When the original rested on a COMPARATIVE claim that is still true and the new evidence is an ABSOLUTE yield claim on an axis the original never tested, C does not return to A. Worth stating because the anti-flip-flop instinct (`behavioral-anti-patterns.md` #1) otherwise argues for defending a detector whose own numbers just refuted it.

### COUNT THE CORPUS — A GUARD PROPOSED RIGHT AFTER A SWEEP IS GREEN AT BIRTH

The corpus you reach for is the region you just cleaned, which is BY CONSTRUCTION the one region that can no longer fail. **The timing is the tell — it fires exactly when guards get proposed. A zero means the corpus is wrong, not that the code is clean.**

### MEASURE THE POPULATION BEFORE YOU COUNT OCCURRENCES

Occurrence counting presupposes an EPISODIC defect and never asks the prior question — is this a recurrence, or the steady state? **The failure direction is the expensive one:** the count reads LOW, so it argues wait-for-occurrence-3 while the population is already saturated, and a guard shipped on that reading is RED at birth and gets reverted. Most of the population already in the defect state ⇒ baseline, not recurrence ⇒ fix the population or change the design; a guard is the WRONG default remedy there.

### EXERCISE THE PREDICATE AGAINST THE REAL CORPUS — A GUARD THAT VALIDATES ITS *SHAPE* CERTIFIES DEAD COVERAGE IN BOTH DIRECTIONS

A validator asking whether a predicate LOOKS right (*"contains a `/` or a `.`"*) answers a different question from whether it can ever MATCH, and it fails BOTH ways at once (admitting predicates that match nothing, rejecting real paths as prose). Two measured causes — fnmatch reads a Next.js `[locale]` segment as a CHARACTER CLASS (an exact literal path does not match itself), and a glob-free token was fnmatched rather than treated as a path-or-prefix. **TELL: the validator and the matcher are different functions, so the code judging the pattern never runs the code that uses it.** Replace shape with reachability (a glob-free token must EXIST; the predicate must match ≥1 corpus member), and state the expected post-fix count first — partial movement reads as confirmation.

### NAME THE `Prevents-L{N}`, OR THE HOOK IS SPECULATIVE — DO NOT SHIP (SC-2)

Every new `.claude/hooks/*.sh` entering the Adoption Queue carries either a specific L-number (a recurring pattern being automated) or `NEW class: {name}` with a specific failure-mode description. **"General hygiene" is not a value.**

### A PreToolUse HOOK REACHES A SUB-AGENT'S TOOL CALLS — MEASURED 2026-09-21

SessionStart is main-session-only; **PreToolUse is NOT**. **So the entry below under-states its own blast radius: a bad PreToolUse predicate locks out every DISPATCHED AGENT as well as every seat.** ⚠️ Bound: ONE hook (`grep-blowup-warn.sh`), ONE agent type (`general-purpose`), non-isolated.

### RANK CANDIDATE PLACEMENTS BY THE BLAST RADIUS OF THE GUARD'S OWN FAILURE

Not by coverage, not by convenience — state what breaks when the GUARD is wrong, then rank on that. Measured fork: the same check inside `session-manifest.py mail-send` fails LOUD, CONTAINED, one subsystem; as a `PreToolUse(Bash)` hook it **locks EVERY SEAT out of Bash**, and the `SKIP_*` escape cannot rescue it because the escape is itself a Bash command. `settings.json` is fleet-wide, so it lands on every seat at once including seats mid-wave who did not opt in — a **pre-backstop** change, whose worst case happens BEFORE any gate can catch it. ⛔ **Its `hooks` block is watched, so a hooks change reaches every RUNNING seat within seconds, and its `env` block reached an already-running seat's Bash tool without a relaunch too (whether a running seat's hooks see it is untested) — an installer that calls a hooks or env change "live for new sessions" has misstated its own blast radius.** **A placement whose failure is fleet-wide and self-un-escapable does not ship until the contained one has been tried and proved insufficient.**

### A RULE GOES WHERE ITS POPULATION IS — GREP EVERY SIBLING WHOSE `paths:` COVERS THE TREE YOUR MEASUREMENT CAME FROM

The entry above ranks a GUARD's placement by blast radius; this ranks a RULE's by reach, and the
failure is silent rather than loud. A rules file only loads for the trees its `paths:` names, so an
entry filed by SUBJECT lands where the subject sounds right and not where the files are. **TELL: the path in your own `Measured:` clause is not matched by the target file's
`paths:`.** Enumerate the scoped set (`grep -l -F 'paths: [' .claude/rules/*.md`), read the globs,
and file where the measurement lives. ⚠️ **The *grep the file you are appending to on the DIRECTIVE VERB* clause
(§ BEFORE YOU PROPOSE A GUARD, end of the CLASSIFYING F's OUTPUT entry) is the OTHER half and
cannot catch this** — it asks *does a home already exist*, never *is the home I picked in reach*, so
a seat that runs it and gets a clean zero has confirmed nothing about placement. N=1.

### A PARSER THAT LOCATES STRUCTURE BY A LITERAL MUST SKIP THE LINES THAT CAN QUOTE IT

A tool that finds structure in a file by matching a literal — a heredoc opener, `^## `, a fence
marker — will also match that literal inside a COMMENT or a fenced BLOCK in the same file, so a
maintainer sentence can silently disarm it. **TELL: a gate fails naming a
STRUCTURAL change you did not make, on a file where you only edited prose.** Skip comment lines
(`not l.lstrip().startswith("#")`); a real anchor is never a comment, so it is strictly fewer false
positives. ⚠️ **THE EXPOSURE IS PER (parser, file) PAIR — a file-wide or parser-wide count answers
the wrong question.** ⛔ AUDIT THE
EXONERATION PER PAIR, NEVER THE COUNT: each matcher is spared by a DIFFERENT thing (fence guard,
a heading existing, a cap, corpus scope) and a wrong reason survives every re-run of a zero. *(Exemplar to copy:
`scripts/learn-signoff.mts` (not in this copy), fence-aware AND separator-scoped.)*

### A NEW GUARD NO ARM CAN REACH IS SHIPPED APPEARANCE — MUTATE IT OUT, THEN READ THE GREEN TWO WAYS

⛔ **CLOSURE-NESS IS NOT THE VARIABLE:** REACHABILITY is — a guard no arm reaches scores ALL PASS when
deleted. **TELL: you added a guard and ran nothing that could have
gone red.** Mutate every new guard out before you report it, then read the green BOTH ways — the guard
is decorative, **or your mutation missed the path the assertion reads** (`tests-unit.md` § MUTATION
TESTING — WAYS YOUR READING IS VOID; that file has no `scripts/**` in its `paths:`, which is why this
entry exists and also why its warning does not reach you). ⚠️ ***LIFT* MEANS MOVE TO MODULE SCOPE, NEVER
REVOKE**. **Relocating is not the fix: re-run the mutation after the move and require RED**, or
*"assert it directly"* is satisfied by an arm that passes with or without the guard. Kin, both in THIS
file and neither reachable by a subject-word grep: § MUTATION-TEST THE PREDICATE and
§ EXERCISE THE PREDICATE.

### A SELF-TEST CARRYING ITS OWN INLINE COPY OF THE LOGIC GOES **ALL PASS** WHEN THE RUNTIME COPY BREAKS

Two copies means the suite grades the one nobody runs. **Extract to module scope so the gate and its
self-test consume ONE function, then plant a mutation and watch the arms go red.** A warning colocated with the code is not enforcement. **TELL: the self-test's expected value is COMPUTED rather than imported.**

### CLASSIFYING F's OUTPUT? COMPUTE THE BASELINE BY CALLING F, NEVER BY A CHEAPER RE-DERIVATION

A classifier that re-derives its own budget by a simpler route than the function whose output it
labels gets a population mismatch, and the resulting label is confident and wrong. **TELL: two code paths answer
*what was here before* by different routes.** Call F and take its per-class counts. ⚠️ **KIN IN THIS FILE, MISSED BY BOTH HOMELESS-CHECKS: § EXERCISE THE PREDICATE**. Same shape, different vocabulary (*validator/matcher* against *baseline/classify*), which is why a subject-word grep returned a true zero and a wrong conclusion. **Grep the file you are appending to on the DIRECTIVE VERB before claiming anything is homeless.**

## COUNTING OCCURRENCES

### COUNTS START AT 1 — DEFAULT WARN-HOOK SHIP BAR IS OCCURRENCE 2

The FIRST time a situation occurs is occurrence #1, which is usually also when the lesson is codified; there is no occurrence 0, and **occurrence N = recurrence N−1**. Prefer "Nth occurrence" in triggers. Block-mode promotion needs the warn-mode observation window ON TOP of the 2nd occurrence (SC-3 + warn-before-block discipline). A per-lesson Queue trigger MAY set a higher bar when each incident is low-cost.

### TWO ERRORS FROM ONE CAUSAL THREAD ARE ONE OCCURRENCE

The count measures whether a pattern recurs across INDEPENDENT contexts, so the discriminator is CAUSAL INDEPENDENCE, never wall-clock distance. **Tell: same session + same arc + inside ~90 minutes ⇒ presume clustered and count 1** — but the window is the tell, never the test (a genuinely independent instance 30 min later IS occurrence 2; a re-trip of the same unfixed cause three days later is still occurrence 1). Counting a clustered pair as 2 trips the warn-hook bar on evidence of ONE incident. When clustered, file an occurrence-2 TRIGGER rather than promoting. ⚠️ Distinct from the gate below — that asks *whether a promotion is safe*; this asks *whether you have earned the count that authorises one*.

## PROMOTING WARN → BLOCK (SC-3)

### SHIP vX.Y.Z+1 ONLY AFTER vX.Y.Z HAS PRODUCED ONE OBSERVABLE OUTCOME

A hook fired warn, an FP rate was measured, a user invoked the subcommand. Shipping in a chain without intermediate observation is the add-before-validate pattern warn-before-block discipline exists to prevent. Exception: an explicit, logged user directive to batch-ship.

### ASK WHETHER ANYONE EVER WRITES THIS WITHOUT RUNNING IT

The claim that buys a warn→block promotion is *"this shape has no legitimate use, so a false positive costs one rewrite"* — a claim about what people **do**, while a command-string guard enforces a claim about a **string**. They diverge in exactly one place: contexts that MENTION the pattern instead of running it (fixtures, verifiers, briefs, docs, commit messages). **A guard MANUFACTURES those contexts, so its FP rate PEAKS in the documentation burst right after promotion** — the window a short observation samples and a long one misses. Yes, people write it ⇒ stay warn, or accept a recurring unfixable FP cost and say so out loud. No ⇒ block is safe.

### MUTATION-TEST THE PREDICATE BEFORE PROMOTING, NOT ONLY ITS FIRES

The two checks above sample a gate's OUTPUT — FP rate, observable outcome. Neither asks whether the predicate can be satisfied by something that is not the thing. **Under warn a blind predicate is a missed warning; under block or fail it is a FALSE GUARANTEE, and the promotion is what converts it.** **Precondition: delete the real coverage and confirm the gate REDDENS; then feed it prose and confirm it does NOT go green.** A `0` that is true today is not self-certifying going forward.

### CALIBRATE PER ARM, NEVER PER HOOK

A hook's arms can have opposite dispositions and the aggregate hides it: `grep-blowup-warn.sh` took **3/3 of one day's false positives on the `absroot` arm**, so the fix was a mode split, not a revert — and the shape arm's clean companion record was a WINDOW reading, not a property. **Re-derive any per-arm FP count from the ledger before a promote/demote argument leans on it.** ⛔ **A ledger-replay share is a PREDICATE-DIFFERENCE rate, never an FP rate:** the fires ledger carries `ts`/`kinds`/`cmd`/`decision` and ZERO classification fields, so "N% reversed" means only that a fix would DECIDE those differently — both halves of "false positive / safely blocked" are unestablished until a human reads the commands. Say "a fix would decide N differently"; hand-read a sample when the FP question is the one you need. And re-run any replay under `LC_ALL=C` first — an illegal byte sequence empties the `sed` transform into the *reversed* bucket, making the count a CEILING where a tracker row claims a floor.

### A SECOND INDEPENDENT DETECTOR CHANGES THE PATH — LONE-HIT WARNS, CONCURRENCE BLOCKS

If a hazard ever gains a second independent signal, promote the CONCURRENCE, never the single arm. Pre-registered rather than derived under pressure — no current hook has two same-hazard signals.

### PUT A BASH-GUARD'S FIXTURES IN A FILE, AND `bash -n` BEFORE WIRING AND AFTER EVERY EDIT

An INLINE fixture is indistinguishable from the invocation it models, so the guard blocks its own test. And a syntax error in a directly wired `PreToolUse(Bash)` guard with no `|| exit 1` tail refuses **every Bash call that reaches the broken line** — bash parses each top-level command before running it, so a fast-path `exit 0` above it still passes its calls, and the hook's own `SKIP_*` escape runs only if it executes above the broken line and outside the compound command (function body, `if` block) that holds it. A warn-only hook there runs through `run-advisory.sh`, which turns that exit 2 into a non-blocking 1.

### SHIP THE GUARD IN WARN MODE RATHER THAN HOLDING IT FOR ITS CALIBRATOR

A warn-mode guard accrues the very FP data an out-of-thread seat will need, at LOW blast radius. Holding it produces no evidence AND no protection — the worst of both. ⛔ **A warn FP is not free: it costs whatever its OWN nextAction says.** **Cost a warn FP by its nextAction, never by its mode.**

### GIVE A FILE-BASED BYPASS AN EXPIRY — IT CANNOT SELF-EXPIRE, SO THE ESCAPE HATCH IS AN OFF SWITCH WITH A DELAY

A marker-file bypass (forced whenever a harness-spawned hook cannot see your per-command env var) persists until somebody remembers to `rm` it, so the guard's real coverage is 100% minus however long the marker sat there — **ship the TTL with the marker**; a documented cleanup step (*"`touch` … + `rm` after"*) is a coverage gap wearing a procedure. Three measured traps: the bare `stat -f %m` FAILS OPEN on Linux (GNU reads `-f` as file-system, where `%m` is not a directive, so it prints garbage — and `$(A || B)` CONCATENATES the stdout of both arms, so whatever the exit code, the fallback cannot produce a clean number; validate numeric with `case "$mt" in ''|*[!0-9]*)` and fail CLOSED); clamp `age < 0` with its OWN distinct message (a future-dated marker reads LIVE until wall-clock catches up; expired ⇒ re-touch, future ⇒ the clock or the mtime is wrong); and classify bypass CANDIDATES by reading them, never by grep count — the overcount is the direction that feels safe.

## WHO MAY CALIBRATE IT

### THE RULE'S AUTHOR IS DISQUALIFIED — THEIR OWN THREAD IS THE FP CORPUS

A thread that codifies a pattern is a thread that MENTIONS the pattern constantly, which is exactly the mention-class the guard cannot distinguish; the documentation burst that inflates the FP rate IS the author's own output. **Declining on this ground is a REASON — write it down**, or two seats deferring reads as mutual punting.

### DECLINING IS HALF AN ACT — NAME, REACH AND TELL AN OUT-OF-THREAD SEAT

A correctly-applied disqualification ORPHANS the item, because every seat with visibility is inside the thread. The failure looks like diligence from every seat and like neglect from none. `mail-send` the routing in the SAME TURN you decline (no approval needed, though not free — it spends the recipient's context) and say what evidence is already accruing for them. An unrouted decline is a defer whose trigger is "somebody notices", the shape the default-SHIP rule rejects.

### CHECK DELIVERABILITY — ISOLATION QUALIFIES A SEAT AND IS WHAT MAKES IT UNREACHABLE

Out-of-thread is a property of a seat's CONTEXT and says nothing about its CHANNEL, and the two are **inversely correlated**: a seat is out-of-thread because it is insulated, and insulation is implemented by turning the channel off. **Check `.claude/state/mail-listen-<sid8>.pid` before counting a route as made.** The mail is not dead, merely queued to that seat's next `SessionStart` — which on a deliberately-isolated seat is an AMBUSH, not a delivery.

### A FRESH-CONTEXT AGENT SATISFIES THE DISQUALIFICATION — THE AXIS IS CONTEXT, NOT SESSION

"No reachable seat" is almost never the real state. `behavioral-anti-patterns.md` #9: the operative axis is **FRESH CONTEXT + a REFUTE MANDATE, not internal/external** — a dispatched agent has no thread, so it qualifies by construction and costs one dispatch. Brief it NOT to read the author's reasoning; that exclusion is most of what makes it frame-independent.

### BUT ALWAYS-LOADED RULES ARRIVE REGARDLESS OF THE BRIEF

If the pattern under calibration is quoted anywhere in `.claude/rules/`, the agent holds it whatever you exclude. **Name the overlap in the brief and ask it to classify from the EVIDENCE — the fires log, the commit bodies — never from the rule text.** Bounds the remedy; does not void it.

### ASK THE PLAUSIBLE OWNER BEFORE DISPATCHING INTO PEER WORK

The discharge is about DISQUALIFICATION, not OWNERSHIP, and it feels complete the moment you dispatch. Mail the current review hub first to learn whether it has taken the work over, and resume only if it has not. ⚠️ **`fleet-claim --check` returning UNCLAIMED is NOT evidence the work is unowned** — a live arc leaves no token. **Two free checks on the TARGET FILE, never on the roster:** `git log -1 --date=format:'%m-%d %H:%M' -- <target>` (recent commit? does its subject land on this surface?), then ASK by mail.

### ESCALATE TO THE OWNER ONLY FOR JUDGEMENT THEY ALONE HOLD

A decision is the owner's when it is **(a)** a taste call, **(b)** an external fact only the owner holds, **(c)** an irreversible action, **(d)** a spend the owner has not pre-approved, **(e)** a commercial term on a page the payment provider has verified (`copy.md`'s merchant-verified pages section, a file not in this copy — refund, payment-processing, merchant-of-record, VAT, withdrawal, subscription-pricing wording; that gate fails limbs (a) to (d) and binds anyway, because the commercial wording is the owner's), or **(f)** CHANGING a rule or gate the owner set (a pass/fail bar) — applying it, spreading it or correcting text to match it stays yours (the owner-column row in `.claude/orchestrator/conventions.md` carries the same six). **None of the six ⇒ it is yours, including when it has the word *legal* near it, and never merely because no peer SESSION is free.** Data handling is carved OUT of (e); only a commercial term is in it. **TELL: you framed it as engineering-versus-judgement, so judgement silently meant THE OWNER, and the handover felt like caution.** The missing option, in three of the four measured cases: *a question someone can research*.

### PRICE AN OPTION BEFORE YOU PUT IT IN FRONT OF THE OWNER

Different trigger from the test above, which is why it is its own entry: that one fires when you are DECIDING whose a call is, this one when you are COMPOSING an offer you have already decided is the owner's. **TELL: your sentence carries a size estimate you did not derive this turn.**

## BLIND ADJUDICATION

### SEED EVERY BLIND ADJUDICATION PACK WITH ALREADY-SCORED BASELINE UNITS

An unseeded blind re-score cannot separate RATER DRIFT from the effect under test — the reader's calibration moves between sittings. Embed already-banked units in every pack and read their movement as the drift estimate; an unseeded pack supports LEVEL claims, never DELTAS.

## READING A GUARD'S FIRES

### CLASSIFY EVERY FIRE USE-VS-MENTION — *WAS THE FLAGGED TEXT GOING TO RUN?*

"The guard fired at me while I worked" is TWO classes with opposite dispositions, indistinguishable from the outside because both arrive as an interruption: a real hazardous invocation correctly blocked, costing one rewrite (**the guard working**) vs prose ABOUT the pattern, unfixable inside a command-string matcher (**a defect in the guard**). **Counting incidents without the split over-reports the FP rate and argues for weakening a guard that is behaving correctly** — the direction that gets a live gate reverted. A reviewer who only ever experiences the FP class will report the guard as over-firing.

### DERIVE THE DENOMINATOR FROM THE LEDGER — THE NARRATED TALLY IS A CURATED SAMPLE

`grep -cF '"decision":"deny"' .claude/logs/grep-blowup-fires.jsonl`. Seats write up the fires they agreed with and silently rewrite past the rest, so the narration is biased toward keeping a block arm promoted; it runs in the TENS while the ledger runs in the HUNDREDS and the gap widens daily. **Any promotion/demotion argument reads the LOG. Un-narrated fires are UNCLASSIFIED, not TP.** ⚠️ **`wc -l` is not a deny count** — it sums warn+deny+undecided and overstated denies **~5.8×** when measured.

### THE LEDGER HAS NO ATTRIBUTION FIELD — PER-INCIDENT TP/FP IS UNEXECUTABLE AS SHIPPED

Records carry exactly `ts, kinds, cmd, decision`. So `grep -cF '<my-sid>' <log>` returns a false ZERO for your own logged fire, and a false POSITIVE for other seats whenever their sid appears inside a logged `cmd`. **The classification duty above is real and the instrument for it does not exist** — say so rather than reporting a number the log cannot support.

### DO NOT MINT A NEW RUNNING TOTAL — THE HAND-CARRIED TALLY HAS FORKED

Concurrent seats each derived "running total" by reading whichever entry they saw last, so the totals fork rather than accumulate. Any number you add forks it again and looks authoritative. **Reconcile from the ledger or not at all**, and note the asymmetry already baked in (TPs entered, same-day FPs dropped): every ratio is *entered-in-this-tally*, never the arm's history.

### RECORD A CLASSIFIED FIRE AS A COUNT LINE IN THE ARCHIVE — NEVER A NEW NARRATIVE BLOCK

The archive takes count updates only. A newly-classified fire updates the archive's current-total line or adds ONE count-line there; it does not grow this file.

### A USE-DETECTING GUARD FALSE-POSITIVES HARDEST ON THE MOST CAREFUL FILES

A use-detecting guard's only hit can be a comment warning never to call the very symbol it guards — the negative-assertion comment exists BECAUSE the symbol is dangerous. Inverts the usual "FPs are noise" read: here the FP is evidence the file did the right thing, and blanket-suppressing it suppresses the signal.

### "ZERO TRUE POSITIVES IN N DAYS" IS VACUOUS IF THE INSTRUMENT WAS NEVER WIRED

An unwired script produces zero of everything, so the real observation window is ONE RUN. Distinct from wired-but-inert — the mechanism exists and cannot fire; here the ABSENCE OF FINDINGS is read as evidence about quality when it is evidence about wiring.
