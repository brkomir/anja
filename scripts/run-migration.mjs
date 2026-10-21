import dotenv from "dotenv";
import postgres from "postgres";
import { writeSync } from "fs";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { isMain } from "./lib/is-main.mjs";
import { checkMigrationReview } from "./lib/migration-review-gate.mjs";

// ⛔ EVERYTHING WITH A SIDE EFFECT LIVES INSIDE main() BELOW, AND THAT IS NOT TIDYING.
// `dotenv.config()` reads the local env file and `postgres()` parses a credential; both used to run at
// MODULE SCOPE, so importing this file — which is the only way to unit-test the guard added below
// — loaded a database connection string into the importing process. The executable half is now
// behind `isMain(import.meta.url)` (the same shape a sibling script uses so its rules array can be
// imported inert). `isMain` resolves symlinks: see its header for why the naive
// argv[1] compare silently turns a gate into a no-op. The CLI contract:
// `node scripts/run-migration.mjs <file> [--reapply] [--owner-ordered="<the owner's words>"]
// [--owner-destructive-yes="<the owner's words>"]` applies exactly one COMMITTED, REVIEW-APPROVED file and
// exits (§ THE SQL APPLIED IS THE COMMITTED BLOB and § THE REVIEW GATE below; a destructive file also needs
// the owner's yes; flags in any position, the owner's words as ONE argument each).

// onnotice: a migration's RAISE NOTICE post-checks (0261 section 1b, 0263 (A)/(B)/(C)) are the
// apply's only measurement record; postgres.js's default handler prints each as a JS object, which
// a "NOTICE:" grep cannot find (measured on the 2026-09-05 0261 staging apply). Print them flat.
//
// max: 1 is REQUIRED, not tuning. A migration that wraps itself in its own BEGIN ... COMMIT cannot
// run on a POOLED connection — postgres.js refuses raw transaction control with
//     UNSAFE_TRANSACTION: Only use sql.begin, sql.reserved or max: 1
// Measured 2026-09-12: exactly ONE of the 210 files in the migrations directory self-wraps (0274 — the
// only live BEGIN-semicolon line in the corpus; 0265's own header records the same for the 264
// before it). So this guard can fire on one file. THE HAZARD BELOW IS ALL 210 AND EVERY DEATH MODE.
//
// ⛔ THE ERROR TEXT FROM THIS SCRIPT TELLS YOU NOTHING ABOUT WHAT THE DATABASE DID.
//    These lines carried two successive WRONG mechanisms (2026-09-11 "it fails before the first
//    statement, so nothing partial lands"; 2026-09-12 "postgres.js destroys the socket"), so every
//    claim below is cited at the vendored source — postgres 3.4.9, read 2026-09-12. Cite the line
//    or do not write it.
//
//    1. ONE ROUND TRIP. sql.unsafe(file) with no arguments sets simple: true
//       (src/index.js:119-126, "simple: args.length === 0"), so the WHOLE FILE leaves as a single
//       simple-protocol Query message (src/connection.js:189-190). There is no statement boundary
//       at which this client can interrupt the server.
//    2. WHEN THE GUARD FIRES IT IS ALREADY TOO LATE. It is in the CommandComplete path —
//       result.command === 'BEGIN' && max !== 1 && !connection.reserved, src/connection.js:605-606
//       inside CommandComplete at :590 — so the server has already opened the transaction.
//       ⛔ BUT IT CANNOT FIRE HERE: this script pins max: 1 below, so `max !== 1` is false on
//       every path through it, and the prod template pins it too. §2 and §4 describe the POOLED
//       shape, kept because that is what max: 1 exists to avoid — not this runner's behaviour.
//    3. NOTHING IS TORN DOWN. errored() (src/connection.js:390-394) destroys "stream", and "stream"
//       is the COPY stream: initialised null at :103 and assigned ONLY in CopyInResponse (:857),
//       CopyOutResponse (:877) and CopyBothResponse (:885). For a plain query it is null, so that
//       line is a no-op. The socket is untouched and no Terminate is sent; the backend keeps
//       executing the rest of the string. What ends the apply is the rejected top-level await
//       killing the process (rc=1, measured), which also means sql.end() below never runs.
//    4. THE SERVER'S OWN ERROR WOULD BE SWALLOWED -- BUT NOT HERE; SEE THE END OF THIS ITEM.
//       ErrorResponse only STASHES while a query is active
//       (src/connection.js:812-818); the rejection happens at ReadyForQuery (:535-547), by which
//       time the guard has already settled the promise via queryError's query.reject at :410. A
//       real SQL failure downstream therefore reaches you as UNSAFE_TRANSACTION. The message
//       describes the CLIENT, never the server. ⛔ UNREACHABLE VIA THIS SCRIPT — see §2: with
//       max: 1 the guard never settles the promise, so you receive the REAL PostgresError.
//       THE CONSEQUENCE BELOW DOES NOT REST ON THIS: it stands on §1 + §3 alone (one round
//       trip, nothing torn down), which are what make the state unknowable. §4 was recruited
//       to support a universal it cannot reach; the directive survives without it.
//
// ⛔ CONSEQUENCE: A FULLY-COMMITTED MIGRATION CAN BE REPORTED TO YOU AS AN ERROR. Reproduced live
//    2026-09-12 by a planning seat on a throwaway Postgres 16.13 with this same vendored client
//    (not re-run here): an early NOTICE does not rescue it (5/5 and 3/3 committed), SIGTERM through
//    the max: 1 path committed 3/3, and SIGTERM against a migration with no BEGIN of its own
//    committed 2/2. ⛔ THE LIVE TRIGGER IS THE BASH TOOL'S 2-MINUTE DEFAULT, AND IT DOES NOT
//    ARRIVE AS SIGTERM — IT MOVES THE CALL TO THE BACKGROUND AND SENDS NO SIGNAL AT ALL
//    (measured 2026-09-12, control-armed: 0 handler fires under an explicit 8s timeout with the
//    child still logging 14s past it; a real `kill -TERM` on that pid exited through the same
//    handler). So the apply KEEPS RUNNING, the handler below never runs, the STATE-UNKNOWN
//    banner never prints, and a re-run is CONCURRENT with a live apply rather than after a dead
//    one. PASS AN EXPLICIT LONG timeout ON EVERY INVOCATION — it is what keeps the apply in the
//    FOREGROUND where its verdict is readable. The signal handler still earns its place: it
//    catches a real SIGTERM/SIGINT, which the control arm above demonstrates.
//
// ⛔ SO, ON ANY NON-CLEAN EXIT: THE DATABASE STATE IS UNKNOWN. PROBE BEFORE RE-RUNNING —
//       node scripts/migration-notation-reconcile.mjs --since NNNN --at-apply-gate=prod
//    (doors: staging | prod | both -- pass ONE, literally; a `<a|b>` placeholder is a zsh parse error)
//    The door is REQUIRED (rc=2 without it) and names WHICH APPLY GATE you are standing at. It
//    is not decoration: {staging=true, prod=false} classifies to 🟡 PARTIAL both for a prod apply
//    STILL RUNNING and for one not yet started, so the probe's own output cannot tell them apart
//    and the unflagged remedy ("finish the apply on the missing env") is a second concurrent
//    prod apply. The caller supplies what the database cannot.
//    read-only and SELECT-only, both environments. The 2026-09-11 0274 staging probe that read 0
//    helper functions is NOT evidence against this: it is one observation with at least two other
//    explanations (a pooler returning the backend with a rollback; the backend's reply buffer
//    filling before COMMIT), and 0274 is idempotent, so its re-run was harmless. The next file may
//    not be. Every abnormal exit below prints this instruction, because the runner cannot answer
//    the question and the operator must not guess.
//
// Self-wrapping is a fine shape for a multi-statement DDL change and the runner accommodates it,
// but it is NOT what makes the apply atomic — the old comment saying so was falsified by the same
// 2026-09-12 reproduction, which observed that a multi-statement simple query is already ONE
// implicit transaction with no BEGIN anywhere. That is a SERVER-side claim, so it is attributed,
// not cited: nothing in the vendored client establishes it and this box has no Postgres to re-run
// it on. Consistent with the corpus, at least — 209 of the 210 files here carry no BEGIN at all.
// Pinning to one connection costs nothing: this script applies exactly one file and exits.
// ⛔ WRAPPED — THIS CONSTRUCTION WAS AT MODULE SCOPE WITH NO try ABOVE IT, AND THAT IS
// A CREDENTIAL PATH. postgres.js parses the connection string with `new URL()`, and Node's
// `ERR_INVALID_URL` carries THE WHOLE STRING — password included — in `.input`. Uncaught at module
// scope it goes to stderr and therefore into the agent transcript, which is not fully scrubbable:
// a database credential that lands there must be ROTATED, not deleted. Content guards on the URL
// (which project, which region) cannot catch this shape, because not one
// of them tests PARSEABILITY — an ordinary env slip (a stray space, a doubled `DATABASE_URL=`
// prefix) reaches it.
// ⚠️ The catch prints the error CODE and never the error, never `.input`, never the URL.
// Takes the URL the review gate judged, so the host the gate exempted as local is the host dialled.
function openConnection(url = process.env.DATABASE_URL) {
  return postgres(url, {
    prepare: false,
    max: 1,
    onnotice: (n) => console.log(`NOTICE: ${n.message}${n.detail ? ` — DETAIL: ${n.detail}` : ""}${n.hint ? ` — HINT: ${n.hint}` : ""}`),
  });
}

// Declared HERE, not imported from migration-notation-reconcile.mjs. When this was written that
// module ran a bare process.exit at module scope, so importing it would have TERMINATED this runner;
// it has had an entry guard since, so an import is safe now. The copy stays: this runner
// does not need the 2,400-line reconcile for three words.
const APPLY_GATE_DOORS = ["staging", "prod", "both"];

let applying = false;

// Every abnormal exit prints the SAME block, because every abnormal exit leaves the same question
// open. writeSync(2, ...) rather than console.error: process.exit() can drop a buffered stderr
// write to a pipe, and this block is the whole point of the exit.
export function stateUnknown(file, cause) {
  // null, never a placeholder: the banner below interpolates this into a command it tells the
  // operator to RUN, and `--since NNNN` parses to NaN, scopes to zero files and prints a clean
  // tick. The probe now refuses that argument; this end stops offering it.
  const numberMatch = file.match(/(\d{4})_[^/]*\.sql$/);
  const migrationNumber = numberMatch ? numberMatch[1] : null;
  writeSync(
    2,
    "\n==================== STATE UNKNOWN ====================\n" +
      "Migration: " + file + "\n" +
      "Cause:     " + cause + "\n" +
      "\n" +
      "This runner CANNOT tell you what the database did. The whole file goes out\n" +
      "as ONE simple-protocol message, so the server keeps executing after the\n" +
      "client gives up. A fully-committed migration CAN reach you as an error --\n" +
      "and so can one that aborted and rolled back entirely, which is the more\n" +
      "common outcome. Both look identical from here. That is what UNKNOWN means:\n" +
      "do not read this as 'nothing landed', and do not read it as 'it applied'.\n" +
      "\n" +
      "DO NOT RE-RUN BEFORE PROBING. Read-only probe. Paste the ONE line whose door\n" +
      "matches the DB this run targeted -- these are literal and pasteable on purpose:\n" +
      // \u26d4 NEVER PRINT A `<a|b>` PLACEHOLDER IN A BANNER YOU TELL SOMEONE TO PASTE.
      // `--at-apply-gate=<staging|prod>` is a zsh parse error near `>`, and the natural
      // repair under pressure is to DELETE the flag -- which is the unflagged mode this
      // whole banner exists to prevent. A bare `staging|prod|both` is no better: the `|`
      // pipes to `prod`. Emit each door literally. It also silently omitted `both`.
      // Found by a review lens 2026-09-13; this was the only one of six emitters doing it.
      APPLY_GATE_DOORS.map((d) =>
        "  node scripts/migration-notation-reconcile.mjs" +
        (migrationNumber ? " --since " + migrationNumber : "") +
        " --at-apply-gate=" + d + "\n").join("") +
      "  The door is REQUIRED and is NOT defaulted. Without it the probe prints its\n" +
      "  cross-session remedies, and at a PROD door those say 'finish the apply on\n" +
      "  the missing env' for a verdict a STILL-RUNNING apply also produces -- i.e.\n" +
      "  a SECOND CONCURRENT APPLY, on exactly the non-clean exit this banner is\n" +
      "  reporting. This runner reads DATABASE_URL from the env file and does not\n" +
      "  assume which env that is: pass the door matching the DB THIS run targeted.\n" +
      (migrationNumber
        ? ""
        : "  (no NNNN_ prefix in that filename, so no --since is offered - an\n" +
          "   unparseable one would scan zero migrations and read CLEAN.)\n") +
      "=======================================================\n"
  );
}

// ── ALREADY-APPLIED GUARD ────────────────────────────────
// Forward-only makes an apply irreversible, and for some files the SECOND apply is DESTRUCTIVE
// rather than idempotent: a migration that backfills a preference column which producers now write
// `false` to on purpose will, on a re-run, silently flip real opt-outs back — including RFC 8058
// one-click unsubscribes (.claude/rules/migrations.md § A DEFAULT-FLIP
// BACKFILL IS INTENT-DESTRUCTIVE ON RE-APPLY). Another may hard-code values since retired. This
// runner — the one /migration actually uses — had no guard at all.
//
// `_migration_history` is NOT a new idea: scripts/apply-all-migrations.mjs creates and reads it
// with exactly this contract (`filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT
// now()`), and production already carries it. This makes the per-file runner write the same ledger
// the bulk runner writes. It does NOT replace the commit-message rule: that is the
// CROSS-ENVIRONMENT record ("staging+prod applied"), this is the per-database one — the only plane
// that can answer "did THIS database already run THIS file".
//
// ⛔ A MISSING TABLE IS A WARN, NEVER AN ABORT. The migration that creates the ledger
// has to be applied BY THIS RUNNER, so the guard cannot
// require its own precondition. A warn also covers the case the guard is worth the least: a
// database nobody has seeded yet.
//
// ⛔ THE LEDGER INSERT IS A SEPARATE STATEMENT AFTER SUCCESS — NEVER APPENDED TO THE MIGRATION
// TEXT. One file opens its own BEGIN and thirteen use CREATE INDEX CONCURRENTLY, which cannot run
// inside a transaction block; appending to the round trip would break both classes.
export const LEDGER_TABLE = "public._migration_history";

/**
 * Default logger for the functions below.
 *
 * ⛔ `error` IS `writeSync(2, …)`, NOT `console.error`, FOR THE SAME REASON
 * `stateUnknown` ABOVE USES IT: the abort path calls `process.exit(1)` on the
 * very next line, and `process.exit()` can drop a BUFFERED stderr write to a
 * pipe. A refusal the operator never sees is worse than no guard — it is rc=1
 * with no reason, which reads as a broken runner and invites a retry with
 * `--reapply`, i.e. exactly the destructive second apply this exists to stop.
 * `warn` and `log` stay on console: nothing exits immediately after them, so
 * their buffers flush normally.
 */
const defaultLog = {
  log: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (message) => writeSync(2, String(message) + "\n"),
};

/**
 * Read this file's row from the ledger.
 * Returns the rows, or `null` when the ledger does not exist on this database (guard INACTIVE).
 */
export async function readLedger(sql, file, log = defaultLog) {
  try {
    return await sql`SELECT applied_at FROM public._migration_history WHERE filename = ${file}`;
  } catch (err) {
    // ONLY a missing table (42P01, undefined_table) means "no ledger on this database". Anything
    // else (a permission error, a timeout, a dropped connection) is a ledger that could not be READ,
    // and reporting it as missing turned the guard off under a message naming the wrong cause.
    if (err?.code !== "42P01") throw err;
    log.warn(
      `WARN: no ${LEDGER_TABLE} on this database — double-apply guard is INACTIVE for this run.`,
    );
    return null;
  }
}

/** Record the apply. Best-effort: a failure here must never turn a successful apply into an error. */
export async function recordApply(sql, file, log = defaultLog) {
  try {
    await sql`INSERT INTO public._migration_history (filename) VALUES (${file}) ON CONFLICT DO NOTHING`;
    return true;
  } catch {
    log.warn(`WARN: could not record this apply in ${LEDGER_TABLE}.`);
    return false;
  }
}

// ── THE SQL APPLIED IS THE COMMITTED BLOB ─────────────
// Both remote appliers (this runner and the prod template in .claude/skills/migration/SKILL.md,
// which imports resolveCommittedSql from here) used to read the migration file from the SHARED
// WORKING TREE with no check that the file was tracked or clean. The session applying a file is
// often not the one that wrote it, so a database could receive an uncommitted review fold, or SQL
// no commit holds at all, while the record read "staging+prod applied" and CI tested the committed
// version. Nothing afterwards can see that divergence: the ledger stores no content hash.
//
// So, BEFORE ANY CONNECTION IS OPENED, refuse when
//   (a) `git status --porcelain -- <path>` is non-empty: modified, staged, deleted or untracked; or
//   (b) `git cat-file -e HEAD:<path>` fails: never committed, misspelled, or untracked AND IGNORED.
//       Status prints nothing for an ignored file (or for any untracked one under
//       status.showUntrackedFiles=no), which is why (b) is not redundant with (a).
// and then execute `git cat-file blob HEAD:<path>`, never the working copy. (a) alone is not enough
// either: under `update-index --assume-unchanged` / `--skip-worktree` status reads CLEAN while the
// working copy differs, and only the blob read makes that case apply the committed SQL.
// `cat-file blob`, not `git show`: the raw blob, with no textconv or filter in between. HEAD is
// resolved to a sha ONCE, so the existence check and the read cannot straddle a peer's commit.
// `--no-optional-locks` keeps status from taking the shared index lock a peer may be holding.
// Every git call is argv-form (no shell) and fails CLOSED: a git error is a refusal, never a
// fallback to the working copy. scripts/apply-all-migrations.mjs is not covered and needs no cover:
// it refuses any host outside LOCAL_HOSTS, so it only ever builds a throwaway local database.
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS_DIR = "supabase/migrations";
export const NOT_COMMITTED = "MIGRATION_NOT_COMMITTED";

function defaultGit(args) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    // An inherited GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE beats cwd, so the check would read
    // another repository's HEAD or another index. Drop every GIT_* variable.
    env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))),
  });
}

function refusal(message) {
  const err = new Error(message);
  err.code = NOT_COMMITTED;
  return err;
}

/**
 * The committed SQL for `file`, or a thrown refusal (err.code === NOT_COMMITTED).
 * `git(args)` returns stdout and throws on a non-zero exit; injectable so the test can point it
 * at a throwaway repository.
 */
export const MIGRATION_FILE_SHAPE = /^[0-9]{4}_[a-z0-9_]+[.]sql$/;
function assertShape(file) {
  if (!MIGRATION_FILE_SHAPE.test(String(file))) {
    throw refusal(`ABORT: ${JSON.stringify(String(file))} is not a bare migration basename (NNNN_name.sql). Nothing was sent.`);
  }
}

export function resolveCommittedSql(file, { git = defaultGit } = {}) {
  assertShape(file);
  const path = `${MIGRATIONS_DIR}/${file}`;
  const refuse = (why) =>
    refusal(
      `ABORT: ${path} ${why}\n` +
        `  The runner executes the COMMITTED blob (HEAD:${path}), never the working copy, so a\n` +
        "  database never receives SQL that no commit holds.\n" +
        "  Commit the migration file first (or discard the uncommitted change), then re-run.\n" +
        "  Nothing was sent: no connection was opened.",
    );
  let head;
  let status;
  try {
    head = git(["rev-parse", "--verify", "HEAD"]).trim();
    status = git(["--no-optional-locks", "status", "--porcelain", "--", path]);
  } catch (e) {
    throw refuse(`could not be checked against HEAD (git exited ${e?.status ?? "with an error"}).`);
  }
  if (status.trim() !== "") {
    throw refuse(`is not committed as-is. git status reports: ${status.trim().split("\n")[0]}`);
  }
  let entry = "";
  try {
    if (git(["rev-parse", "--verify", "HEAD"]).trim() !== head) throw refuse("was checked while HEAD moved; re-run.");
    entry = git(["ls-tree", "--full-tree", head, "--", path]);
  } catch (e) {
    if (e?.code === NOT_COMMITTED) throw e;
  }
  const m = /^100(?:644|755) blob ([0-9a-f]+)\t/.exec(entry);
  const blob = m ? m[1] : "";
  if (!m) {
    throw refuse("is not in HEAD (never committed, misspelled, or untracked and ignored), or is not a regular file there.");
  }
  // `blob` is the content id the two applies of a --both run must share: HEAD moves between them
  // (peers commit), so the HEAD sha cannot say whether the SQL did.
  return { sql: git(["cat-file", "blob", `${head}:${path}`]), head, blob };
}

// NO ESCAPE, ON ANY DATABASE. A staging-only working-copy flag
// was written for an ordering rule, but that rule orders the SCHEMA-DEFINITION commit after the
// staging apply, not the SQL file's: commit the file alone first ("created (not yet applied)"),
// apply, then commit the schema definition. And the flag was a divergence channel the ledger
// cannot see: _migration_history keys on filename with no content, so staging could record a working copy and prod later run a
// different committed blob under the same row name, both reading "applied".
/** The SQL this runner will execute, plus where it came from. Throws a refusal; never connects. */
export function loadMigrationSql(file, { git = defaultGit } = {}) {
  const { sql, head, blob } = resolveCommittedSql(file, { git });
  return { sql, head, source: `committed blob ${blob.slice(0, 12)} at HEAD ${head.slice(0, 12)}` };
}

// ── THE REVIEW GATE ──────────────────────────────────────────────────────────────────────────────
// A shared database receives a migration only after the commit that last changed its file has an
// APPROVING review on record (a committed `.claude/reviews/<full-sha>.md` whose first line opens with
// the verdict word), and a destructive one only with the owner's yes on top; a local host is exempt,
// the owner's order is the only per-apply override of the review, and MIGRATION_REVIEW_GATE=off in the
// environment is the project-level switch for a project with no review step. The rules live in
// scripts/lib/migration-review-gate.mjs; this wrapper supplies this runner's git (argv form, GIT_*
// dropped) and the repository root, so the staging runner and the prod template in
// .claude/skills/migration/SKILL.md call the same function. Throws a refusal (err.code ===
// GATE_REFUSED); never connects.
export function reviewGate(file, { head, databaseUrl, argv = process.argv, git = defaultGit, ...rest } = {}) {
  return checkMigrationReview({ file, head, databaseUrl, argv, git, root: REPO_ROOT, ...rest });
}

/**
 * Guard, apply, record. Extracted from module scope so the guard is unit-testable over a
 * `postgres` double without opening a connection.
 *
 * `exit` is injectable for the same reason. In production it is `process.exit`, which never
 * returns; the `return` after every call to it is what makes the test's non-terminating double
 * follow the identical control flow (nothing past the abort runs, in either).
 */
export async function runMigration({
  sql,
  file,
  migration,
  argv = process.argv,
  exit = process.exit,
  log = defaultLog,
}) {
  const ledger = await readLedger(sql, file, log);
  const guardActive = ledger !== null;

  if (ledger && ledger.length > 0 && !argv.includes("--reapply")) {
    const when = ledger[0]?.applied_at;
    log.error(
      `ABORT: ${file} is already recorded in ${LEDGER_TABLE} on THIS database` +
        (when
          ? ` (row written ${when instanceof Date ? when.toISOString() : String(when)}; ` +
            "a row the 0301 backfill wrote dates the backfill, not the apply)"
          : "") +
        ".\n" +
        "  A second apply is not always idempotent — 0227's backfill flips deliberate opt-outs back.\n" +
        "  If the re-apply is intended, re-run with --reapply.",
    );
    exit(1);
    return { status: "already-applied", guardActive, applied: false, recorded: false };
  }

  log.log(`Running migration: ${file}`);
  applying = true;
  try {
    await sql.unsafe(migration);
  } catch (err) {
    // postgres.js error messages carry host:port at worst, never the credential
    // (node_modules/postgres/src/errors.js:16-28 builds "write <code> <host>:<port>"), so this is
    // safe to print under a log-host-only posture.
    const diagnostics = ["detail", "hint", "where", "position"]
      .filter((k) => err && err[k])
      .map((k) => "\n           " + k.toUpperCase() + ": " + err[k])
      .join("");
    stateUnknown(file, (err && err.message ? err.message : String(err)) + diagnostics);
    exit(1);
    return { status: "state-unknown", guardActive, applied: false, recorded: false };
  }
  applying = false;
  log.log("Migration complete.");

  const recorded = await recordApply(sql, file, log);
  return { status: "applied", guardActive, applied: true, recorded };
}

/**
 * The CLI. Exported so its order is tested by EFFECT: a refusing gate must
 * leave no connection behind it, and a source-position pin cannot see that (a try/catch swallowing the
 * refusal, or an `if (0)` around the call, both kept the old pin green). Every seam defaults to the real
 * thing and the CLI below passes none, so no seam is reachable from the command line. The test passes a
 * stand-in gate, so no fake refusal lands in the gate's audit log, and a no-op env loader, so the env file is
 * never read into the test process. `exit` never returns in production; the `return` after each call keeps
 * a stub exit on the same control flow (the runMigration convention above).
 */
export async function main({
  argv = process.argv,
  env = process.env,
  loadEnv = () => dotenv.config({ path: ".env.local" }),
  gate = reviewGate,
  open = openConnection,
  exit = process.exit,
  log = defaultLog,
} = {}) {
  loadEnv();

  // Resolved BEFORE open(): a refusal must leave no connection behind it.
  // The first non-flag argument. argv[2] read a leading flag as the filename, and its fallback
  // file is absent from HEAD.
  const file = argv.slice(2).find((a) => !a.startsWith("--"));
  if (!file) {
    log.error(`Usage: node scripts/run-migration.mjs <NNNN_name.sql> [--reapply] [--owner-ordered="<the owner's words, verbatim>"] [--owner-destructive-yes="<the owner's words, verbatim>"]`);
    exit(1);
    return;
  }
  let migration;
  try {
    const loaded = loadMigrationSql(file);
    migration = loaded.sql;
    log.log(`SQL source: ${loaded.source}`);
    // The review gate, before any connection exists (see reviewGate above). It reads DATABASE_URL for
    // its hostname only, to exempt a local database, and MIGRATION_REVIEW_GATE for the off switch; the
    // URL's value is never printed.
    const review = gate(file, { head: loaded.head, databaseUrl: env.DATABASE_URL, argv, env });
    log.log(`Review gate: ${review.gate}${review.commit ? ` (commit ${review.commit.slice(0, 12)}; ${review.reason})` : ""}`);
    if (review.gate === "off") log.error("REVIEW GATE OFF (MIGRATION_REVIEW_GATE=off): applying without a review; this apply is logged as off.");
    if (review.gate === "owner-ordered") log.error(`OWNER-ORDERED: applying without an approving review; the order is logged. Underlying: ${review.reason}.`);
    if (review.destructiveYes) log.error(`DESTRUCTIVE, ON THE OWNER'S YES (logged): ${review.destructive.map((o) => `${o.op} at line ${o.line}`).join("; ")}.`);
  } catch (e) {
    log.error(e?.message ?? String(e));
    exit(1);
    return;
  }

  let sql;
  try {
    sql = open(env.DATABASE_URL);
  } catch (e) {
    log.error(
      `ABORT: DATABASE_URL could not be used to open a connection (${e?.code ?? "unknown"}).\n` +
      `  The value is NOT printed here on purpose: ERR_INVALID_URL carries the entire connection\n` +
      `  string, password included, in its .input field. Check the env file by hand.`
    );
    exit(1);
    return;
  }

  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      // NOT the Bash tool's 2-minute default -- that BACKGROUNDS the call and sends no signal,
      // so this handler never runs for it (see the header). This catches a REAL SIGTERM/SIGINT.
      if (applying) stateUnknown(file, signal + " received mid-apply");
      process.exit(1);
    });
  }

  await runMigration({ sql, file, migration, argv, exit, log });
  await sql.end();
}

if (isMain(import.meta.url)) {
  await main();
}
