# Migration Rules

A file in `supabase/migrations/` is not an applied migration and nothing in the schema records the difference. Every rule here is a way a migration that looks applied, correct or complete is not.

**Appending here.** A new trap is ONE `###` rule in the matching section — DIRECTIVE + the TELL + the discriminating number + the fix — in one to three sentences, 150-400 bytes; its incident record goes to a separate archive. **A correction REPLACES the rule's sentence; it never appends a paragraph beneath it.**

## AUTHORING

### FORWARD-ONLY IN PRODUCTION — NEVER EDIT A PUSHED MIGRATION

Once applied anywhere, a migration's file is history. Fix it forward with a new numbered migration.

### EVERY NEW TABLE GETS RLS ENABLED WITH APPROPRIATE POLICIES

No exceptions. RLS scopes ROWS; COLUMN exposure needs its own REVOKE + GRANT discipline.

### A NEW TABLE ALSO OWES COLUMN-ACL — THE PRE-PUSH CHECK ONLY *SURFACES* IT

`CREATE TABLE` (especially with a jsonb AI-output/snapshot column) or a permissive `CREATE POLICY ... TO authenticated` owes a REVOKE + narrow GRANT. `scripts/migration-column-acl-check.py` (in `.githooks/pre-push`; neither is in this copy) is warn-mode — never blocks, escape `SKIP_COLUMN_ACL_CHECK=1`; as a text-matching check it can produce false negatives. **Authoritative gate: the integration-tier column-privilege drift sentinel**.

### A NEW PREFERENCE COLUMN'S DEFAULT MUST MATCH `DEFAULT_PREFS` TOO

Two sources of truth: the SQL `DEFAULT`, and the service-side `DEFAULT_PREFS`. The row the migration inserts and the row the service path inserts must agree.

### WRAP A CROSS-SCHEMA STUB IN `DO $$ ... EXCEPTION WHEN insufficient_privilege ... END $$`

A stub like `auth.users` (Docker-integration portability) must no-op in production, where `auth.*` belongs to `supabase_admin` and the pooler role holds no CREATE there. **A bare `CREATE TABLE IF NOT EXISTS auth.users` fails the EXISTENCE CHECK before it ever reaches IF NOT EXISTS** — only catching the exception lets one migration apply to both DBs. Pattern: migration 0132.

### A CROSS-SCHEMA STUB'S *COLUMNS* MUST TRACK THE APP'S READS — THE EXCEPTION WRAPPER ABOVE ONLY MAKES THE STUB APPLY

Wrapping the `auth.users` stub makes it portable; it does nothing about what the app SELECTS from it.
Reading a new `auth.*` column in app SQL obliges adding that column to the Docker stub **in the same
commit**, or every integration test TOUCHING THAT QUERY hits a missing column at runtime. Measured: a
static `u.raw_user_meta_data->>'locale'` turned **9 arms in ONE file red** (`expected 500 to be 200`)
out of a tier of **628** files — `tsc`, unit and the build are all blind.

## FOREIGN KEYS AND DESTRUCTIVE OPS

### RETENTION-BOUND USER-ID FKs TAKE `SET NULL`, NEVER `CASCADE`

CASCADE on `user_id` silently destroys the row at GDPR Art. 17 deletion, and billing rows carry a 10-year obligation (Serbian Law on Accounting Art. 28 + ZPPPA Art. 114 — ⛔ **not** the e-Invoicing law + EU OSS Art. 369k, which on the primary source attaches to the merchant of record, not to the seller) — SET NULL, or DEFAULT to a sentinel. RESTRICT is the opposite failure: never block deletion, never destroy history. Non-retention columns (preferences, ephemeral state) MAY cascade. **`grep` the FK target for retention obligations before picking ON DELETE, always.** Patterns: 0158 (+ `deleted_user_email_hash`, tax audits without cleartext), 0159 (audit columns).

### PROBE FK CHILDREN BEFORE A DELETE OR A FORCED CONSTRAINT — REASSIGN, DON'T ORPHAN

A blind delete fires whatever each child FK declares — **SET NULL silently orphans, CASCADE silently destroys** — and forcing a UNIQUE/CHECK constraint past a DO-block abort arrives the same way. Enumerate children first (`grep` the table in `src/db/schema.ts` for `references(() => <table>...)`, read each `onDelete`), count rows per child, then reassign a salvageable child to the surviving twin in the SAME transaction rather than NULL-ing or cascading — lossless (migration 0203). Which ON DELETE to declare is the retention rule; this is cleanup-time delete-safety.

### A DESTRUCTIVE SHARED-DB OP NEEDS EXPLICIT OWNER AUTHORIZATION

A file that rewrites or deletes rows (an `UPDATE` backfill counts), drops a table or column, changes a column's type, declares an `ON DELETE`/`ON UPDATE CASCADE` link (it deletes rows LATER, each time a parent goes), or deletes where the scan cannot see (a call off `READ_ONLY_FUNCTIONS` in a statement the file runs, a trigger, rule or scheduled job, `EXECUTE` of built SQL) needs the owner's words ON TOP of an approving review; the runner refuses it without `--owner-destructive-yes="<the owner's words>"` (logged), and any other constraint passes on the review alone. **TELL: a cleanup script or a hand query has no gate, and "apply migrations" is not that yes; a migration header that prescribes an UPDATE run by hand does not waive the approving review, and the owner's yes to the run is not that review: the review comes BEFORE the run, on the UPDATE with account identities replaced by per-domain counts, plus the dry-run counts; the scan reads SHAPES, so read `destructiveOps`' header (`scripts/lib/migration-review-gate.mjs`) for the full list and for what it still passes before calling a file safe**; the classifier blocking a blind delete is that gate working.

## CODIFYING A VOCABULARY — CHECK / ENUM / DOMAIN / COLUMN-GRANT

### ENUMERATE FROM HISTORY ∪ DRIZZLE ∪ RAW-SQL ∪ FIXTURES

Fires on `CHECK (<col> IN (...))`, `CREATE TYPE ... AS ENUM (...)`, `CREATE DOMAIN ... CHECK`, `GRANT SELECT (<col1>, <col2>, ...) ON <table> TO <role>` — hardest when the comment says *codifying* / *locking* / *preserving pre-existing*, which licenses enumerating from history alone. Four populations, four commands, no substitutions:

- **(a) history** — `grep -rn "<col>" supabase/migrations/`
- **(b) Drizzle / object-literal inserts ONLY** — `rg "<col>:\s*[\"']" src/` — ⛔ **a TERNARY producer (`<col>: cond ? "a" : "b"`) escapes this pattern by construction**: add `rg "<col>:\s*[A-Za-z_(][^,\n]*\?" src/` and READ the hits.
- **(b2) RAW-SQL producers** — `grep -rn "INSERT INTO <table>" src/`
- **(c) fixtures** — `rg "<col>:\s*[\"']" tests/ scripts/`

A value the later legs add and (a) omits is added to the constraint, or retired from `src/` by a same-PR migration first. **The comment MUST show the union-grep result**.

### (b) AND (b2) ARE TWO POPULATIONS — ONE COMMAND CANNOT REACH BOTH

A colon-keyed object-literal pattern never matches raw SQL at any window width, so annotating leg (b) *"Drizzle inserts + direct-SQL"* claims coverage it cannot deliver. Raw-SQL production is the LIVE precedent — a new type arriving that way returns clean from (b), ships the CHECK one verb short, and `23514`s every INSERT into a best-effort `.catch(() => {})`. **Re-read your OWN prose and confirm a command exists for EACH population it names.**

## DEFAULTS AND BACKFILLS

### A DEFAULT THAT DECIDES A SECURITY BRANCH MIS-CLASSIFIES EVERY LEGACY ROW

`ADD COLUMN … DEFAULT <v>` whose value GATES a security/correctness branch (a provenance flag, a tier marker, an `is_*` boolean a read path reads) applies it to every historical row, none of which carries provenance: the flag did not exist when they were written. **Worst when the column's WRITER pre-existed the column.** Backfill from true state in the SAME migration — `UPDATE … WHERE NOT EXISTS (<positive-entitlement set>)`, correlated `NOT EXISTS` and never `NOT IN`, for nullable-FK safety — erring SAFE on ambiguity, then **ask which side the DEFAULT lands legacy rows on.** A comment claiming *"the read path is flag-independent"* is load-bearing-FALSE unless that read path exists; grep it. tsc/unit/integration are ALL BLIND — the leak exists only for pre-migration rows. Confirm a writer's provenance with `git show HEAD~1:<file>`, never `git log -S`, which mis-dates it.

### A DEFAULT-FLIP BACKFILL IS INTENT-DESTRUCTIVE ON RE-APPLY

`UPDATE … SET col = true WHERE col = false AND <safe-guard>` is correct at FIRST apply — every `false` is the dead default, no producer existed yet. A RE-apply cannot tell a user's deliberate post-toggle choice from that dead default, and silently flips real opt-outs back. **Apply exactly once; before re-running any migration, check whether its backfilled column has since gained a producer or a user-facing toggle** — if it has, the backfill is now destructive. (The security-branch DEFAULT rule governs first-apply correctness.)

## APPLYING

### NO APPROVING REVIEW ON RECORD, NO APPLY — THE RUNNER REFUSES

The REVIEW approves, not a per-apply word from the owner; a destructive op still needs the owner's yes. The runner refuses a shared DB unless `.claude/reviews/<full-sha>.md` — the sha of the commit that last changed the file — is COMMITTED at HEAD (never the working tree) and its first non-blank line OPENS `APPROVED`/`APPROVE`/`FOLD-VERIFIED`, unqualified (`APPROVED WITH FINDINGS` refuses), and a `Reviewed-by:` line names who reviewed it — the panel's seats or a review session, never only the commit's own session (its `Claude-Session:` trailer); a fold that changes the file moves the commit, so it needs its own record. **TELL: any other apply path — only the runner holds the gate, and no record is authenticated: it stops a careless apply, never a deliberately false record.** Override `--owner-ordered="<the owner's words>"`, logged. A project with no review step sets `MIGRATION_REVIEW_GATE=off` once (the runner prints one line and logs the apply; a destructive file still needs the words); a local database passes without a review.

### APPLY TO BOTH STAGING AND PROD, THEN RE-RUN THE INTEGRATION SUITE

Two environments, two commands — a staging-only apply is a half-applied migration. Run the postgres lib through `node --input-type=module`: not the supabase CLI, not `npx tsx`. Then `npm run test:integration`, because the schema just moved under every seeded fixture.

### AN ERROR FROM THE RUNNER IS NOT A ROLLBACK — AND THE COMMONEST DEATH DELIVERS NO ERROR AT ALL

`sql.unsafe(file)` is ONE simple-protocol round trip and **no file runs outside ONE transaction** (210 of 210 at 2026-09-12; at 2026-11-01, 6 of 265 wrap their whole body in BEGIN…COMMIT, which is equivalent), so the backend keeps executing after the client gives up and a COMMITTED migration CAN reach you as an error. ⚠️ **That is a POSSIBILITY, never the prior — a real SQL error aborts the implicit transaction and NOTHING landed**, which is the far commoner outcome; a one-sided prior here points the expensive way (skip the re-run on a migration that never applied). ⛔ **AND THE TELL IS NOT A SIGTERM: the Bash tool's timeout MOVES THE CALL TO THE BACKGROUND AND SENDS NO SIGNAL, so there is no exit, the STATE-UNKNOWN banner never prints, and a re-run is CONCURRENT WITH A LIVE APPLY**. Keep `timeout: 600000` — it holds the apply in the FOREGROUND where its verdict is readable. ⛔ **AND THE PRESCRIBED PROBE ANSWERS `MANUAL` FOR 66 OF 210 (2026-09-12)** (the corpus has moved to REVOKE/GRANT/CHECK/policy migrations, which create no probeable object). **A `MANUAL` verdict is the instrument declining to answer, NOT an all-clear — read the schema by hand before re-running.** `node scripts/migration-notation-reconcile.mjs --since <NNNN>` (not in this copy); mechanism at `run-migration.mjs`'s header.

### EXPAND BEFORE CODE — THE MIGRATION LANDS BEFORE THE CODE THAT USES IT

A CHECK-widening migration must reach prod first, or the INSERT `23514`s into a best-effort try/catch and the durable row silently drops. The READ direction is worse: a projection naming a column whose migration is unapplied raises Postgres `42703`, and **a Drizzle projection failure fails the WHOLE shared query**. Push-time gate: `.claude/hooks/expand-before-code-warn.sh` (not in this copy), warn-mode, escape `SKIP_EXPAND_BEFORE_CODE=1`.

### A DROP OR RENAME INVERTS EXPAND-BEFORE-CODE — THE CODE THAT STOPS NAMING THE COLUMN DEPLOYS FIRST

Deployed code still naming a column fails `42703` the moment its DROP or RENAME lands, on every star `select()` over that table and every `insert()` into it (Drizzle's insert builder names every declared column and sends DEFAULT for each one the caller omits), so the code that stops naming it deploys FIRST and the migration applies after. **TELL: an *applied* notation on a removal is the danger, not the clearance.**

### A NAME-GREP ON A NEWLY-ADDED COLUMN IS A FLOOR ON DEPLOY RADIUS, NEVER A COUNT

Drizzle builds an EXPLICIT column list from the schema, so **adding a column makes every star-select AND every insert name it** — the sites at risk are not the ones that mention the column, they are every `select()` over that table and every `insert()` into it (mechanism: § A DROP OR RENAME INVERTS EXPAND-BEFORE-CODE). **TELL: you sized an expand-before-code risk with `rg <columnName>`.** Enumerate the table's `select()` and `insert()` callers instead.

### DE-QUEUE ANY PEER SESSION HOLDING THE SAME APPLY

Applying a migration AUTHORED BY ANOTHER session (owner-directed cross-session apply) means mailing the author a de-queue notice in the SAME turn. Their queued `/migration <NNNN>` (a command not in this copy) is a live double-apply race and **the notation commit does not defuse it** — a queued command does not read your notation before it runs.

## RECORDING THE APPLY — THE LEDGER REFUSES, THE COMMIT MESSAGE EXPLAINS

### EVERY COMMIT CARRYING A MIGRATION FILE NAMES ITS ENVIRONMENT STATUS

A commit whose diff holds a `supabase/migrations/NNNN_*.sql` file MUST carry exactly one of `migrations NNNN staging+prod applied` / `staging applied (prod pending)` / `created (not yet applied)` — and the commit that ADDS the file can truthfully carry only the last, because the runner executes the committed blob and refuses an uncommitted file. Two records, two jobs: **`public._migration_history` is the PER-DATABASE record — `run-migration.mjs` REFUSES a recorded file without `--reapply` and records each success (a MISSING table only warns)** — and **the commit phrase is the CROSS-ENVIRONMENT record** a per-database ledger cannot express. The database platform's built-in migration ledger exists on NEITHER remote DB, so without the phrase `/orient` and `/migration list` (not in this copy) cannot separate applied from unapplied without a schema-probe. ⛔ **Its `chore(migration):` record is usually an `--allow-empty` commit (whenever nothing is staged), so a path-filtered log misses it, and an `--oneline` read misses a body notation: derive what a promote would bring to production unapplied with `scripts/promote-precheck.sh` / `promote-migration-gate.mjs --db` (neither is in this copy), never from git subjects**.

### NEVER CAP `git log --grep='<NNNN>'` — THE RECORDING COMMIT IS THE OLDEST MATCH

`git log` is reverse-chronological, and the recording commit lands after the feature commit but before every later sweep that merely *mentions* the number. So `git log --grep='<NNNN>' | head -N` drops it by construction, and **the cap's failure probability RISES with how much attention the migration got**. **Never cap this grep.** ⛔ **AND NEVER ANCHOR IT EITHER — AN 8-HEX SESSION ID OR SHA CONTAINING THE MIGRATION NUMBER PRODUCES REAL FALSE HITS, AND THE OBVIOUS FIX IS WORSE THAN THE DEFECT.** **But the natural remedy `--grep='migrations\? *0093'` is REFUTED — measured on `0238` it MISSES BOTH genuine recording commits**, because the canonical subject is `chore(migration): NNNN …` (`):` sits between the word and the number) and a backfill buries the number mid-list. **Keep the bare grep; the DISCRIMINATOR is the SUBJECT, not the pattern — a recording commit reads `chore(migration): NNNN … applied`, so READ the hits instead of tightening the regex.** And **the class is every recency grep**, per-instrument dropping order in `.claude/traps/shell-traps.md` § READ COUNTS, NEVER A PIPED EXIT CODE.

### THE APPLY-BUT-UNRECORDED DROP HAS A 3-LAYER CLOSURE

**Shape A** = committed with no status phrase. **Shape B** = applied to both DBs with no recording commit ever made — the dominant shape, because no push event exists at apply-time to gate. (1) `/migration` (not in this copy) auto-emits the `chore(migration): NNNN … applied` commit as the FINAL STEP OF EVERY APPLY (`--allow-empty` when nothing is staged), the only layer reaching Shape B; (2) `scripts/migration-notation-reconcile.mjs` (not in this copy; read-only, `/orient` Step 6 + `/wrap` Step 6) schema-probes BOTH DBs → 🟢 APPLIED-UNRECORDED (prints the backfill command) / 🔴 UNAPPLIED / 🟡 PARTIAL / ⚪ SUPERSEDED / ⚠️ MANUAL / ⚠️ PROBE-ERROR — **read the set off that script's own `icon` map, never from a list here**; (3) `.claude/hooks/migration-commit-msg-warn.sh` catches Shape A per-commit at push time.

### A MIGRATION NUMBER IS NOT A UNIQUE KEY — IT CAN BE REUSED AFTER A FILE DELETION

Two migrations shared `0250` in ONE day, one deleted pre-apply and one applied, so `git log --grep='0250'` mixes two commit streams and "0250 applied" is ambiguous by construction. Cite `NNNN_<name>.sql`, never the bare number; check for a deleted twin first: `git log --diff-filter=D --oneline -- 'supabase/migrations/<NNNN>_*'`.
