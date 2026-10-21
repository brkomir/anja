// The migration REVIEW GATE: a migration reaches a shared database (staging or production) only after the
// commit that last changed its file has an APPROVING review on record. Every remote applier calls it before
// any connection exists: scripts/run-migration.mjs does, through its `reviewGate` wrapper, and any other
// applier (a production template) calls the same function. The approval is the REVIEW's, never a per-apply
// word from the owner; a destructive migration needs the owner's explicit yes on top (THE DESTRUCTIVE HALF,
// below).
//
// THE DESTRUCTIVE HALF. Rows rewritten or deleted (an UPDATE backfill counts), a table or column dropped, a
// column's type changed, and a LINK THAT DELETES OR REWRITES ROWS ON ITS OWN, LATER: a foreign key declared
// ON DELETE CASCADE (or ON UPDATE CASCADE), in a new table or an existing one. A cascade link loses nothing
// on the day it is applied and deletes rows each time a parent row goes (an account deletion), which is
// what migrations.md § RETENTION-BOUND USER-ID FKs forbids on retention-bound rows. Other constraint adds
// pass on the review alone (one that existing rows break makes Postgres reject the whole migration), and so
// does ON DELETE SET NULL, the form that retention rule prescribes. `destructiveOps` reads the SAME committed
// blob the applier executes (git cat-file at the HEAD the SQL was read at), with comments blanked and string
// literals scanned on their own (EXECUTE format('ALTER TABLE … DROP COLUMN …') is dynamic SQL a
// strings-blind scan misses). Function and DO bodies are scanned too: a body that defines rather than runs
// can be called in the same file, and the scan fails toward asking. Deleting the scan CANNOT SEE (a call to
// a function off READ_ONLY_FUNCTIONS, a trigger, rule or scheduled job, EXECUTE of built SQL) counts too;
// the section of that name below. A file needs `--owner-destructive-yes="<the owner's words, verbatim>"` as
// ONE argument, logged like the order below; the owner's order to apply without a review is NOT this yes,
// and this yes is NOT a review. A local database is exempt from both halves.
//
// THE RECORD. One committed file per reviewed commit, `.claude/reviews/<full-commit-sha>.md`, read AS
// COMMITTED at the HEAD the SQL was read at (`git show <head>:.claude/reviews/<sha>.md`), never the working
// tree: a working-tree file could be written, used and reverted with no trace, and the SQL applied is a
// committed blob too. A `--code` review panel writes it (the verdict word on the first line, then the
// findings and the seats; expert-review's references/code-review-and-slice-mode.md) and commits it. The
// decision is that file's FIRST NON-BLANK line: it approves only when it OPENS with APPROVED, APPROVE or
// FOLD-VERIFIED (markdown markup, emoji and a leading "TERMINAL VERDICT" are skipped) and nothing in the
// leading window QUALIFIES it. ⛔ OPENS, NOT CONTAINS: "NOTED — APPROVED" and "IN REVIEW → APPROVED" are
// not approvals here, which fails toward a record the reviewer can re-word, never toward an apply.
//
// A QUALIFIED APPROVAL IS NOT ONE. An approval with open findings, blocking or not, does not close a
// review. So after the approving word the window refuses on WITH ("APPROVED WITH 3 P3"), on another verdict
// ("APPROVED (abc1234) · CHANGES-REQUESTED (def5678, …)"), on a state that is not closed (PARTIAL,
// CONDITIONAL, PENDING, OPEN, INTERIM …), on findings still standing (any P0-P4 / FINDINGS / LOW / NIT after
// APPROVED; a NEW one after FOLD-VERIFIED, whose closed findings are its normal narration), and a verdict
// scoped to one sha ("FOR <sha>", "<sha> ONLY") approves that sha only. A negated term ("0 findings", "no
// P1") is not a qualifier. Past the 70-character window nothing is read: the disposition goes first.
//
// THE FOLD CHAIN. The commit checked is the one that last changed the file at HEAD (`git log -1 HEAD --
// <path>`), i.e. the commit whose blob is applied. A fold that CHANGES the file moves that commit to the
// fold, which then needs its own record; a fold that does not touch the file leaves the original, whose
// record stands.
//
// WHO REVIEWED. The record names its reviewers on a `Reviewed-by:` line below the verdict: the seats of a
// `--code` panel (fresh helper agents, which count as reviewers even inside the session that wrote the commit)
// or a review session's id. The gate refuses a record with no such line, and one whose line names nothing but
// the reviewed commit's own session (the 8-hex prefix of its `Claude-Session:` trailer, the one
// scripts/safe-commit.sh stamps): the author saying it approved its own commit is not a review.
//
// FAILS CLOSED. A missing or unreadable record, an empty one, or a git call that fails is a refusal, never
// a pass: this gate exists to stop an apply, and a gate that opens on a read error is the defect it
// replaces. EXEMPT: a database on a local host (the Docker integration DB, localhost), decided only for a
// postgres(ql):// authority that the gate's URL parser and the driver read alike (one "@" at most and no
// ",", after decoding); anything else, or an unparseable URL, is NOT local. The URL is never printed.
//
// ESCAPE: the owner's explicit order only, carried as `--owner-ordered="<the owner's words, verbatim>"` and
// appended to .claude/logs/migration-review-gate.jsonl with the file, the commit and the words. A bare or
// placeholder order is refused, and so is an order split across arguments (the log would keep its first
// word) or one whose log line cannot be written.
//
// OFF SWITCH, for a project with no review step: MIGRATION_REVIEW_GATE=off (exactly that value, any case)
// in the environment skips the review half — no record is looked for, the runner prints one line saying so,
// and the apply is logged with decision "off". Default ON; any other value leaves it on. It is a project
// setting, not a per-apply escape, which is why no refusal below names it. The destructive half still asks
// for the owner's yes: a project with no review step has nothing else between a DROP and production.
//
// WHAT IT DOES NOT STOP. It is an honesty gate on the sanctioned appliers: it stops an apply that runs
// ahead of its verdict. It authenticates nothing. Any session can commit a record naming reviewers who never sat, type --owner-ordered
// with words the owner never said, or apply through a script that does not call this. Reading the committed
// record makes a forged one a commit with its author's name on it, which is a record, not a prevention.
//
// PORTABLE ON PURPOSE: the record reading is one function (`reviewDecision`) over injected inputs, and
// `checkMigrationReview` takes `decide(commit, authorSid8)`, so a project with another record replaces that one function.

import { appendFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";

export const GATE_REFUSED = "MIGRATION_REVIEW_GATE_REFUSED";
export const REVIEWS_DIR = ".claude/reviews";
export const OFF_SWITCH = "MIGRATION_REVIEW_GATE";
export const FIRES_LOG = ".claude/logs/migration-review-gate.jsonl";
export const ESCAPE_FLAG = "--owner-ordered=";
export const DESTRUCTIVE_FLAG = "--owner-destructive-yes=";
export const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
export const APPROVING_WORDS = ["FOLD-VERIFIED", "APPROVED", "APPROVE"];
const APPROVING_RE = new RegExp(`^(${APPROVING_WORDS.join("|")})(?![A-Z0-9])`);

// The leading window of the record's first line, as the verdict is read: emoji and markdown markup removed,
// trimmed, cut to LEADING_WINDOW characters, upper-cased, every whitespace or underscore run one "-", so
// `APPROVED WITH FINDINGS` and `APPROVED-WITH-FINDINGS` are one spelling.
export const LEADING_WINDOW = 70;
export function leadingWindow(line) {
  const plain = String(line)
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[*_`]/g, "")
    .trim();
  return plain.slice(0, LEADING_WINDOW).toUpperCase().replace(/[\s_]+/g, "-");
}

// The qualifier terms, read on the NORMALISED leading window after the approving word (every whitespace
// run is one "-"). NOT_NEGATED: a term right after NO / NOT / 0 / ZERO / NEVER is a denial, not a qualifier.
const NOT_NEGATED = "(?<![A-Z0-9])(?<!(?<![A-Z0-9])(?:NO|NOT|0|ZERO|NEVER)-)";
const END = "(?![A-Z0-9])";
const term = (alternation) => new RegExp(`${NOT_NEGATED}(${alternation})${END}`);
export const APPROVAL_QUALIFIERS = {
  with: /^-+(WITH)-/,
  verdict: term("CHANGES-REQUESTED|ALTERNATIVE|REJECT(?:ED)?|UNRESOLVED|APPROVED?-WITH"),
  state: term("PARTIAL(?:LY)?|INCOMPLETE|CONDITIONAL|PENDING|OPEN|OUTSTANDING|INTERIM"),
};
// HOLD and FIX are NOT qualifiers: an approving line far more often narrates a hold lifted, a check that
// still holds or a fix that landed than a qualified approval ("APPROVED, KEEP THE CODE, FIX THREE
// SENTENCES"), and a word list cannot tell those apart. So the reviewer opens a record with an approving
// word only when nothing is owed (the record's shape: expert-review's references/code-review-and-slice-mode.md).
// Findings still standing. After APPROVED any finding is one; after FOLD-VERIFIED the closed findings are
// the row's normal narration ("all 3 P2s closed"), so only a NEW one counts ("1 new P3", "13 new (4 P3").
const FINDING = "P[0-4]S?|FINDINGS?|LOWS?|NITS?|MUST-FOLDS?";
const OPEN_FINDING = { APPROVED: term(FINDING), APPROVE: term(FINDING), "FOLD-VERIFIED": term(`NEW-\\(?(?:[A-Z0-9]+-){0,2}(?:${FINDING})`) };
// A verdict scoped to one sha: "APPROVED FOR 1a2b3c4d5 ONLY", "FOLD-VERIFIED FOR 9f8e7d6c5 (…)": the approval
// holds for that sha only, so a record whose scope names another commit does not approve this one.
const SCOPED_SHA = /(?<![A-Z0-9])(?:FOR-([0-9A-F]{7,40})|([0-9A-F]{7,40})-ONLY)(?![A-Z0-9])/;

/** True only for a postgres(ql):// URL whose host is a local one, read alike by WHATWG (the host after the
 *  LAST "@") and by postgres.js 3.4.9 `parseUrl` (the DECODED text after the FIRST "@", split on "," for
 *  multihost, with PGHOST when there is no "//" authority). Never throws, never returns the URL. */
export function databaseHostIsLocal(url) {
  try {
    const auth = /^postgres(?:ql)?:\/\/([^/?#]*)/.exec(String(url));
    if (!auth) return false;
    const decoded = decodeURIComponent(auth[1]);
    if (decoded.includes(",") || decoded.split("@").length > 2) return false;
    // The driver's own cut runs to the first "?" or "/" only, so a "#" or "\" WHATWG stops at still reaches it
    // ("localhost#,remote" dials remote second; "localhost\@remote" dials remote), and no host at all falls
    // back to PGHOST. Each refuses: the host the driver dials must be the one plain host WHATWG read.
    const raw = String(url).slice(String(url).indexOf("://") + 3).split(/[?/]/)[0];
    const driverHost = decodeURIComponent(raw.slice(raw.indexOf("@") + 1));
    if (!driverHost || /[#\\]/.test(raw) || /[#\\,@\s]/.test(driverHost)) return false;
    const host = new URL(String(url).replace(/^postgres(ql)?:/, "https:")).hostname.replace(/^\[|\]$/g, "");
    return LOCAL_HOSTS.has(host);
  } catch {
    return false;
  }
}

// Postgres's scanner reads every byte from \200 up as a letter, so `é$$` is one identifier, not a dollar quote.
const identChar = (ch) => /[A-Za-z0-9_$\u0080-￿]/.test(ch || "");

/** Two views of SQL text, both offset-preserving (every blanked character becomes a space, newlines stay):
 *  `code` with comments and string literals blanked and dollar-quoted bodies kept as code (their own
 *  comments and strings blanked in turn), and `strings`, each literal's text with its offset (`start`, the
 *  opening quote) and `end` (just past the closing quote). `bodies` holds every dollar-quoted body as
 *  { open (its opening tag), start, end (its closing tag) }, nested ones included. Never throws. */
export function sqlViews(sqlText) {
  const src = String(sqlText ?? "");
  const out = src.split("");
  const strings = [];
  const bodies = [];
  const blank = (a, b) => {
    for (let k = a; k < b; k++) if (out[k] !== "\n") out[k] = " ";
  };
  const walk = (from, to) => {
    let i = from;
    while (i < to) {
      const c = src[i];
      const d = src[i + 1];
      if (c === "-" && d === "-") {
        let e = src.indexOf("\n", i);
        if (e === -1 || e > to) e = to;
        blank(i, e);
        i = e;
        continue;
      }
      if (c === "/" && d === "*") {
        let depth = 1;
        let j = i + 2;
        while (j < to && depth > 0) {
          if (src[j] === "/" && src[j + 1] === "*") { depth++; j += 2; continue; }
          if (src[j] === "*" && src[j + 1] === "/") { depth--; j += 2; continue; }
          j++;
        }
        blank(i, Math.min(j, to));
        i = j;
        continue;
      }
      if (c === '"') {
        // A quoted identifier is code; skip it whole so a quote or dash inside cannot open anything.
        let j = i + 1;
        while (j < to && !(src[j] === '"' && src[j + 1] !== '"')) j += src[j] === '"' ? 2 : 1;
        i = j + 1;
        continue;
      }
      const eString = (c === "E" || c === "e") && d === "'" && !identChar(src[i - 1]);
      if (c === "'" || eString) {
        const q = eString ? i + 1 : i;
        let j = q + 1;
        let text = "";
        while (j < to) {
          if (eString && src[j] === "\\") { text += src[j + 1] ?? ""; j += 2; continue; }
          if (src[j] === "'") {
            if (src[j + 1] === "'") { text += "'"; j += 2; continue; }
            break;
          }
          text += src[j];
          j++;
        }
        strings.push({ start: q, end: Math.min(j + 1, to), text });
        blank(i, Math.min(j + 1, to));
        i = j + 1;
        continue;
      }
      if (c === "$" && !identChar(src[i - 1])) {
        const m = /^\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/.exec(src.slice(i, i + 64));
        if (m) {
          const tag = m[0];
          let e = src.indexOf(tag, i + tag.length);
          if (e === -1 || e >= to) e = to;
          bodies.push({ open: i, start: i + tag.length, end: e });
          blank(i, i + tag.length);
          walk(i + tag.length, e);
          if (e < to) blank(e, e + tag.length);
          i = Math.min(to, e + tag.length);
          continue;
        }
      }
      i++;
    }
  };
  walk(0, src.length);
  return { code: out.join(""), strings, bodies };
}

// One identifier (quoted, which may hold spaces, or plain) and a dotted name (Postgres allows space around
// the dot); `fmt_arg` stands in for a format() placeholder in a literal (see destructiveOps).
const IDENT = `(?:"(?:[^"]|"")*"|[A-Za-z_][\\w$]*)`;
const NAME = `${IDENT}(?:\\s*\\.\\s*${IDENT})*`;
// Keyed on statement SHAPE, so GRANT/REVOKE UPDATE, FOR UPDATE, ON UPDATE/DELETE (save a CASCADE action, its own shape), BEFORE UPDATE, a policy's
// FOR DELETE, a privilege list's TRUNCATE and ALTER COLUMN … DROP DEFAULT never match. DROP TABLE is handled
// apart: dropping a table the same file created EARLIER (a scratch table) is not destructive.
const DESTRUCTIVE_SHAPES = [
  ["rows deleted", /\bDELETE\s+FROM\b/gi],
  ["table truncated", new RegExp(`\\bTRUNCATE\\s+(?:TABLE\\s+)?(?:ONLY\\s+)?(?!(?:ON|TO|FROM)\\b)${NAME}`, "gi")],
  ["rows rewritten", new RegExp(`\\bUPDATE\\s+(?:ONLY\\s+)?${NAME}(?:\\s*\\*)?(?:\\s+(?:AS\\s+)?(?!SET\\b)${IDENT})?\\s+SET\\b`, "gi")],
  ["rows rewritten", /\bDO\s+UPDATE\s+SET\b/gi],
  ["rows rewritten", /\bMERGE\s+INTO\b/gi],
  // A link that deletes or rewrites rows on its own, later: whenever a parent row goes or changes key.
  ["cascade link (rows deleted with their parent)", /\bON\s+DELETE\s+CASCADE\b/gi],
  ["cascade link (rows rewritten with their parent)", /\bON\s+UPDATE\s+CASCADE\b/gi],
  ["schema dropped", /\bDROP\s+SCHEMA\b/gi],
  ["column dropped", /\bDROP\s+COLUMN\b/gi],
  // COLUMN is optional in ALTER TABLE … DROP <col>: an action right after the table name, or after a comma.
  ["column dropped", new RegExp(`\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${NAME}(?:\\s*\\*)?\\s+DROP\\s+(?!(?:CONSTRAINT|COLUMN)\\b)(?:IF\\s+EXISTS\\s+)?[A-Za-z_"]`, "gi")],
  ["column dropped", /,\s*DROP\s+(?!(?:CONSTRAINT|COLUMN|DEFAULT|NOT|IDENTITY|EXPRESSION)\b)(?:IF\s+EXISTS\s+)?[A-Za-z_"]/gi],
  // Any DROP … CASCADE drops what depends on the object, a column among them (a generated column over a
  // dropped function, a column of a dropped type or collation). Not TABLE (its own shape, scratch tables
  // exempt), COLUMN, SCHEMA or OWNED (their own shapes), nor CONSTRAINT (CASCADE there drops only the
  // foreign keys that reference it, never a row) or an ALTER COLUMN action (DROP DEFAULT / NOT NULL / …).
  ["column dropped", /\bDROP\s+(?!(?:TABLE|COLUMN|SCHEMA|OWNED|CONSTRAINT|DEFAULT|NOT|IDENTITY|EXPRESSION)\b)[A-Za-z][^;]*?\bCASCADE\b/gi],
  ["table dropped", /\bDROP\s+OWNED\b/gi],
  ["column type changed", new RegExp(`\\bALTER\\s+(?:COLUMN\\s+)?(?!(?:TABLE|TYPE|DOMAIN|DEFAULT|POLICY|FUNCTION|INDEX|SEQUENCE|VIEW|SCHEMA|ROLE)\\b)${IDENT}\\s+(?:SET\\s+DATA\\s+)?TYPE\\b`, "gi")],
];
const DROP_TABLE = new RegExp(`\\bDROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(${NAME}(?:\\s*,\\s*${NAME})*)`, "gi");
const CREATE_TABLE = new RegExp(`\\bCREATE\\s+(?:(?:GLOBAL|LOCAL)\\s+)?(?:TEMP(?:ORARY)?\\s+|UNLOGGED\\s+)?TABLE\\s+(?!IF\\b)(${NAME})`, "gi");
// Postgres folds an unquoted name to lower case and keeps a quoted one as written.
const tableKey = (n) => n.replace(/\s*\.\s*/g, ".").replace(/"((?:[^"]|"")*)"|[^".]+/g, (m, q) => (q !== undefined ? q.replace(/""/g, '"') : m.toLowerCase())).replace(/^public\./, "");
// Dynamic SQL in a literal: a format() placeholder carries the name, and a literal that ENDS on a destructive
// verb is finished by whatever is concatenated after it (`'DROP TABLE ' || t`).
// format()'s spec is %[position][flags][width]type, so %10s, %-1s, %*s and %1$-10s splice as %s does.
const FORMAT_ARG = /%[-\d$*]*[IsL]/g;
const FORMAT_SPLICE = /%[-\d$*]*s/;
const DYNAMIC_TAIL = [
  ["table dropped", /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?$/i],
  ["table truncated", /\bTRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?$/i],
  ["rows rewritten", /\bUPDATE\s+(?:ONLY\s+)?$/i],
  ["column dropped", /(?:^|[\s,])DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?$/i],
  ["cascade link (rows deleted or rewritten with their parent, built at run time)", /\bON\s+(?:DELETE|UPDATE)\s+(?:fmt_arg\b|$)/i],
];

// DELETING THE SCAN CANNOT SEE. A migration that does its deleting inside a function, trigger or scheduled
// job needs the owner's words exactly like a visible DELETE, and the scan fails closed on the SHAPE, never
// on proof of a delete:
// - a call to a function not on READ_ONLY_FUNCTIONS in code the migration RUNS: every top-level statement
//   and every DO-block statement that is not only a definition (`definesOnly`: a table or materialized
//   view filled from a query, and a CHECK added without NOT VALID, run now), a call after FROM or JOIN
//   included, and the text a literal EXECUTE runs (read by this same scan);
// - a trigger or rewrite rule created; a trigger, rule or event trigger enabled; a materialized view
//   refreshed; a scheduled job created or changed (cron.schedule / schedule_in_database / alter_job, bare
//   or quoted, or a row inserted into cron.job); a function created under a read-only built-in's name;
// - EXECUTE of SQL built at run time: anything but literals and quoted names or values (quote_ident /
//   quote_literal / quote_nullable, format() over a lone literal with no %s in any position, flag or width
//   form); a name spliced in as the function called, an E-string carrying an escape and a DO block written
//   as a quoted string count as built.
// A function body the file only DEFINES is not searched for calls: it runs when something calls it, and that
// caller (a call here, a trigger, a scheduled job) is what this flags. EXECUTE is read in every body.
// STILL UNSEEN, named rather than coded: a call in a column
// DEFAULT or in a column's own CHECK added with ADD COLUMN (each run per existing row now), in an index
// expression, or in a policy expression; VALIDATE CONSTRAINT of a CHECK added NOT VALID; a function reached
// through an operator or a cast; a function body this file defines or REPLACES that application code, or a
// trigger, cron job or policy an EARLIER migration created, calls later; and an INSERT, UPDATE or DELETE
// that fires such an earlier trigger. A call inside a comment is not code and passes.
//
// READ_ONLY_FUNCTIONS is an ALLOWLIST: built-ins (and pgcrypto's) that cannot delete or rewrite a row.
// Any function not on it, every user function among them, fails closed. Matched lower-case, bare or
// pg_catalog-qualified only: public.lower() or any other schema's function is user code (`builtInName`).
export const READ_ONLY_FUNCTIONS = new Set([
  // aggregates and window functions
  "count", "sum", "min", "max", "avg", "bool_and", "bool_or", "every", "array_agg", "string_agg", "json_agg",
  "jsonb_agg", "json_object_agg", "jsonb_object_agg", "row_number", "rank", "dense_rank", "lag", "lead",
  "first_value", "last_value",
  // conditionals and comparison
  "coalesce", "nullif", "greatest", "least", "num_nulls", "num_nonnulls",
  // text
  "lower", "upper", "initcap", "length", "char_length", "octet_length", "trim", "btrim", "ltrim", "rtrim",
  "substr", "substring", "left", "right", "lpad", "rpad", "repeat", "replace", "translate", "position",
  "strpos", "starts_with", "split_part", "concat", "concat_ws", "format", "quote_ident", "quote_literal",
  "quote_nullable", "regexp_replace", "regexp_match", "regexp_matches", "regexp_split_to_array",
  "regexp_split_to_table", "md5", "encode", "decode", "to_char", "chr", "ascii", "string_to_array",
  "array_to_string", "normalize", "unaccent",
  // numbers, dates and times
  "abs", "ceil", "ceiling", "floor", "round", "trunc", "mod", "power", "sqrt", "random", "now",
  "clock_timestamp", "statement_timestamp", "transaction_timestamp", "timeofday", "date_trunc", "date_part",
  "extract", "age", "make_interval", "make_date", "make_timestamp", "make_timestamptz", "to_date",
  "to_timestamp", "to_number", "timezone", "isfinite",
  // arrays, json, ranges and sets
  "array_length", "array_position", "array_positions", "array_append", "array_prepend", "array_cat",
  "array_remove", "array_replace", "cardinality", "unnest", "generate_series", "generate_subscripts",
  "to_json", "to_jsonb", "row_to_json", "json_build_object", "jsonb_build_object", "json_build_array",
  "jsonb_build_array", "jsonb_set", "jsonb_insert", "jsonb_strip_nulls", "jsonb_typeof", "json_typeof",
  "jsonb_array_length", "json_array_length", "jsonb_array_elements", "jsonb_array_elements_text",
  "json_array_elements", "jsonb_each", "jsonb_each_text", "jsonb_object_keys", "jsonb_extract_path",
  "jsonb_extract_path_text", "jsonb_pretty", "jsonb_path_exists", "jsonb_path_query", "jsonb_path_query_first",
  "to_tsvector", "to_tsquery", "plainto_tsquery", "websearch_to_tsquery", "ts_rank", "setweight",
  // identifiers, ids and crypto
  "gen_random_uuid", "uuid_generate_v4", "digest", "hmac", "crypt", "gen_salt", "gen_random_bytes",
  // catalog reads, privileges, settings and locks
  "current_setting", "set_config", "has_table_privilege", "has_column_privilege",
  "has_any_column_privilege", "has_schema_privilege", "has_function_privilege", "has_sequence_privilege",
  "has_database_privilege", "pg_has_role", "to_regclass", "to_regproc", "to_regprocedure", "to_regtype",
  "to_regrole", "to_regnamespace", "pg_get_constraintdef", "pg_get_indexdef", "pg_get_functiondef",
  "pg_get_viewdef", "pg_get_triggerdef", "pg_get_expr", "pg_get_userbyid", "pg_get_serial_sequence",
  "obj_description", "col_description", "format_type", "pg_typeof", "pg_column_size", "pg_relation_size",
  "pg_total_relation_size", "current_database", "current_schema", "current_schemas", "version",
  "pg_advisory_lock", "pg_advisory_unlock", "pg_advisory_xact_lock", "pg_try_advisory_lock",
  "pg_try_advisory_xact_lock", "pg_sleep", "pg_notify", "nextval", "currval", "setval", "lastval",
  "aclexplode", "acldefault", "array_upper", "array_lower", "array_dims", "pg_get_function_identity_arguments",
  "pg_get_function_arguments", "pg_get_function_result", "pg_table_is_visible", "unicode_assigned",
]);
// Words followed by "(" that are syntax, a type's precision or an index method, never a call.
const NOT_A_CALL = new Set(["if", "elsif", "while", "exists", "in", "not", "and", "or", "on", "using", "values", "as",
  "check", "returns", "return", "table", "key", "unique", "references", "cast", "any", "all", "some", "array",
  "row", "over", "filter", "group", "partition", "when", "then", "else", "case", "select", "from", "where",
  "into", "by", "with", "insert", "update", "delete", "grant", "revoke", "for", "loop", "raise", "perform",
  "numeric", "decimal", "varchar", "char", "character", "bit", "varbit", "time", "timestamp", "timestamptz",
  "interval", "float", "double", "precision", "btree", "gin", "gist", "hash", "brin", "spgist", "lateral",
  "distinct", "default", "generated", "identity", "include", "language", "set", "conflict", "do", "end", "join",
  "materialized", "recursive"]);
// The word before a name that makes "name (" a definition or a column list, not a call: a table or index
// named, an alias's column list ("AS v(a, b)", or ") v(a, b)" after a sub-select), a CTE's ("WITH x(a) AS").
// Not "from", "join" or "on": `SELECT * FROM purge()`, `JOIN purge() p ON true` and `JOIN u ON purge(u.id)`
// all run purge, and an alias's column list follows AS or ")".
const DEFINES_NAME = new Set(["into", "table", "references", "function", "procedure", "index", "view", "type",
  "exists", "trigger", "constraint", "domain", "sequence", "using", "update", "only", "as", "with"]);
const CALL = new RegExp(`(?<![\\w$."])(${NAME})\\s*\\(`, "g");
const CRON = `(?:\\bcron|"cron")\\s*\\.\\s*`;
const UNSEEN_SHAPES = [
  ["trigger created (its function runs later, unseen)", /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+|EVENT\s+)?TRIGGER\b/gi],
  ["trigger enabled (its function runs later, unseen)", /\bENABLE\s+(?:ALWAYS\s+|REPLICA\s+)?TRIGGER\b/gi],
  ["rewrite rule created (it runs later, unseen)", /\bCREATE\s+(?:OR\s+REPLACE\s+)?RULE\b/gi],
  ["rule or event trigger enabled (it runs later, unseen)", /\bENABLE\s+(?:ALWAYS\s+|REPLICA\s+)?RULE\b|\bALTER\s+EVENT\s+TRIGGER\b[^;]*\bENABLE\b/gi],
  ["materialized view refreshed (its query runs now, unseen)", /\bREFRESH\s+MATERIALIZED\s+VIEW\b/gi],
  // Spelled bare or quoted ("cron"."schedule"), or a job inserted straight into its table.
  ["scheduled job created or changed (it runs later, unseen)", new RegExp(`${CRON}"?(?:schedule|schedule_in_database|alter_job)"?\\s*\\(`, "gi")],
  ["scheduled job created or changed (it runs later, unseen)", new RegExp(`\\bINSERT\\s+INTO\\s+${CRON}"?job"?(?![\\w$])`, "gi")],
];
const bareName = (n) => tableKey(n).replace(/^pg_catalog\./, "");
// Only a plain name, bare or pg_catalog-qualified, can be a built-in or syntax: public.lower() and any other
// schema's function are user code whatever they are called, and a quoted "check"( is a name, never the word.
const builtInName = (raw) => !/\./.test(raw.replace(/^\s*"?pg_catalog"?\s*\.\s*/i, ""));
const BUILT_OP = "SQL built at run time (EXECUTE of a string this scan cannot read)";

// "Runs now", ONE definition for the top level, a DO block and the text a literal EXECUTE runs: a CREATE /
// ALTER / COMMENT / GRANT / REVOKE / DROP statement DEFINES (a policy's USING expression, an index or a SET
// DEFAULT) and runs no call now, except a table or materialized view filled from a query, and a CHECK added
// without NOT VALID, which Postgres validates against every existing row.
const DEFINITION = /^\s*(?:CREATE|ALTER|COMMENT|GRANT|REVOKE|DROP)\b/i;
const FILLS_NOW = /^\s*CREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?(?:TABLE|MATERIALIZED\s+VIEW)\b[^;]*\bAS\s+(?:SELECT|WITH|VALUES|TABLE)\b/i;
const CHECKS_NOW = new RegExp(`\\bADD\\s+(?:CONSTRAINT\\s+${IDENT}\\s+)?CHECK\\b(?![^;]*\\bNOT\\s+VALID\\b)`, "i");
const definesOnly = (stmt) => DEFINITION.test(stmt) && !FILLS_NOW.test(stmt) && !CHECKS_NOW.test(stmt);
const STATEMENT_START = /;|\b(?:BEGIN|THEN|ELSE|LOOP|DECLARE|EXCEPTION)\b/gi;
// Is `DO` (or `DO LANGUAGE <name>`) the last code before offset `at`? Read backward word by word, with no
// fixed window: a comment or blank run of any length between the keyword and its body is blank in `code`.
function endsWithDo(code, at) {
  const wordBefore = (k) => {
    while (k > 0 && /\s/.test(code[k - 1])) k--;
    let s = k;
    while (s > 0 && /[A-Za-z0-9_]/.test(code[s - 1])) s--;
    return { word: code.slice(s, k).toLowerCase(), start: s, ok: s === 0 || !identChar(code[s - 1]) };
  };
  const w1 = wordBefore(at);
  if (w1.word === "do") return w1.ok;
  const w2 = wordBefore(w1.start);
  if (!w1.word || w2.word !== "language") return false;
  const w3 = wordBefore(w2.start);
  return w3.word === "do" && w3.ok;
}

/** Calls in `text` (a code-view span) to functions READ_ONLY_FUNCTIONS does not name, as [{ name, at }].
 *  `inBlock`: `text` is a DO block's body, so a statement that only defines is skipped. A cron call is the
 *  scheduled-job shape, reported once there. */
function unknownCalls(text, base, inBlock = false) {
  const out = [];
  for (const m of text.matchAll(CALL)) {
    const name = bareName(m[1]);
    const plain = builtInName(m[1]);
    if ((plain && !m[1].includes('"') && NOT_A_CALL.has(name)) || (plain && READ_ONLY_FUNCTIONS.has(name)) || name.startsWith("cron.")) continue;
    if (inBlock) {
      let from = 0;
      for (const b of text.slice(0, m.index).matchAll(STATEMENT_START)) from = b.index + b[0].length;
      const stmt = text.slice(from, text.indexOf(";", m.index) === -1 ? text.length : text.indexOf(";", m.index));
      if (definesOnly(stmt)) continue;
    }
    const lead = text.slice(Math.max(0, m.index - 40), m.index);
    const before = /([A-Za-z_][\w$]*)\s*$/.exec(lead);
    if (before && DEFINES_NAME.has(before[1].toLowerCase())) continue;
    if (/\)\s*$/.test(lead)) continue;
    out.push({ name, at: base + m.index });
  }
  return out;
}

/** The deleting this scan cannot see into, as [{ op, at }] (offsets into the source). */
function unseenOps(src, code, strings, bodies) {
  const found = [];
  for (const [op, re] of UNSEEN_SHAPES) for (const m of code.matchAll(re)) found.push({ op, at: m.index });
  // A name spliced in by quote_ident or format('%I') reads as fmt_arg: the function called is chosen at run time.
  const call = (c) => (c.name === "fmt_arg" ? { op: BUILT_OP, at: c.at } : { op: `a call to ${c.name}() (what it runs is not in this file)`, at: c.at });
  // Code the migration RUNS: DO blocks, and every top-level statement outside every body that is not only a
  // definition (definesOnly, the same rule a DO block's statements are read by).
  const outer = bodies.filter((b) => !bodies.some((o) => o !== b && o.start <= b.open && b.end <= o.end));
  for (const b of outer.filter((b) => endsWithDo(code, b.open))) found.push(...unknownCalls(code.slice(b.start, b.end), b.start, true).map(call));
  // A DO block written as a quoted string ('…' or E'…') is SQL this scan does not read.
  for (const s of strings) if (endsWithDo(code, s.start)) found.push({ op: "SQL built at run time (a DO block in a quoted string, which this scan does not read)", at: s.start });
  // A function given a built-in's name: an unqualified call to it reads as the allowlisted built-in.
  for (const m of code.matchAll(new RegExp(`\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:FUNCTION|PROCEDURE)\\s+(${NAME})\\s*\\(`, "gi"))) {
    if (READ_ONLY_FUNCTIONS.has(bareName(m[1]))) found.push({ op: `a function named like the built-in ${bareName(m[1])}() created (a call to it reads as the built-in)`, at: m.index });
  }
  const top = code.split("");
  for (const b of outer) for (let k = b.open; k < b.end; k++) if (top[k] !== "\n") top[k] = " ";
  const topText = top.join("");
  for (const m of topText.matchAll(/[^;]+/g)) {
    if (!m[0].trim() || definesOnly(m[0])) continue;
    const lead = /^\s*CALL\b/i.exec(m[0]);
    if (lead) {
      const p = new RegExp(`^\\s*CALL\\s+(${NAME})`, "i").exec(m[0]);
      found.push(call({ name: p ? bareName(p[1]) : "a procedure", at: m.index + lead.index }));
    } else found.push(...unknownCalls(m[0], m.index).map(call));
  }
  // EXECUTE of SQL built at run time. Visible: one literal (quoted or dollar-quoted), literals joined with
  // ||, quote_ident/quote_literal/quote_nullable, and format() over a literal with no %s (which can splice
  // any SQL in). The visible text is a statement in its own right, read by this same function (calls,
  // triggers, jobs, rules), and joined pieces are scanned for the visible ops, so 'DEL' || 'ETE …' is a
  // DELETE. EXECUTE ON … or EXECUTE, … is a privilege (GRANT / REVOKE), and EXECUTE FUNCTION / PROCEDURE a
  // trigger's action (flagged above); neither runs a statement.
  for (const m of code.matchAll(/\bEXECUTE\s+(?!(?:FUNCTION|PROCEDURE|ON)\b|,)/gi)) {
    // From right after the word: the match's own \s+ runs on through a literal, which the code view blanks.
    const from = m.index + "EXECUTE".length;
    let depth = 0, end = from;
    for (; end < code.length; end++) {
      const ch = code[end];
      if (ch === "(") depth++;
      else if (ch === ")") { if (depth === 0) break; depth--; }
      else if (depth === 0 && (ch === ";" || /^\s(?:USING|INTO)\b/i.test(code.slice(end, end + 7)))) break;
    }
    let built = false;
    const joined = [];
    for (const piece of splitTopLevel(code, from, end, "||")) {
      // Skip blanks on the SOURCE: in the code view a literal is itself blank and would be skipped whole.
      const a = piece.start + (/^\s*/.exec(src.slice(piece.start, piece.end))[0].length);
      const lit = strings.find((s) => s.start === a || s.start === a + 1);
      const body = bodies.find((b) => b.open === a);
      // Nothing after it but blanks: a second literal (Postgres joins 'DELETE '<newline>'FROM t') is not nothing.
      const rest = (e) => code.slice(e, piece.end).trim() === "" && !strings.some((s) => s.start >= e && s.start < piece.end);
      // An E-string's escapes (E'\x45') are not decoded here, so its text is not what runs.
      const escaped = lit && /^[Ee]$/.test(src[a]) && src.slice(lit.start, lit.end).includes("\\");
      if (lit && !escaped && rest(lit.end)) { joined.push(lit.text); continue; }
      if (body && rest(Math.min(src.length, body.end + (body.start - body.open)))) { joined.push(src.slice(body.start, body.end)); continue; }
      const fn = new RegExp(`^(${NAME})\\s*\\(`).exec(code.slice(a, piece.end));
      const fname = fn && builtInName(fn[1]) ? bareName(fn[1]) : "";
      if (/^quote_(?:ident|literal|nullable)$/.test(fname)) { joined.push(" fmt_arg "); continue; }
      if (fname === "format") {
        const open = a + fn[0].length;
        const tmpl = strings.find((s) => s.start >= open && code.slice(open, s.start).trim() === "");
        const alone = tmpl && /^\s*[,)]/.test(code.slice(tmpl.end, piece.end));
        if (alone && !FORMAT_SPLICE.test(tmpl.text)) { joined.push(tmpl.text.replace(FORMAT_ARG, "fmt_arg")); continue; }
      }
      built = true;
    }
    if (built) {
      found.push({ op: BUILT_OP, at: m.index });
      continue;
    }
    const text = joined.join("");
    const v = sqlViews(text);
    for (const u of unseenOps(text, v.code, v.strings, v.bodies)) found.push({ op: u.op, at: m.index });
    if (joined.length > 1) {
      for (const [op, re] of DESTRUCTIVE_SHAPES) if (new RegExp(re.source, "i").test(text)) found.push({ op, at: m.index });
      // Not dead: '… ON DEL' || 'ETE ' || quote_ident(act) is valid SQL whose cascade link only this reads
      // (pinned; no single literal's tail ends on the verb).
      for (const [op, re] of DYNAMIC_TAIL) if (re.test(text)) found.push({ op, at: m.index });
      if (new RegExp(`\\bDROP\\s+TABLE\\b`, "i").test(text)) found.push({ op: "table dropped", at: m.index });
    }
  }
  return found;
}

/** The [from, to) span of `code` cut at every top-level (paren depth 0) occurrence of `sep`. */
function splitTopLevel(code, from, to, sep) {
  const out = [];
  let depth = 0, start = from;
  for (let k = from; k < to; k++) {
    if (code[k] === "(") depth++;
    else if (code[k] === ")") depth--;
    else if (depth === 0 && code.startsWith(sep, k)) { out.push({ start, end: k }); start = k + sep.length; k += sep.length - 1; }
  }
  out.push({ start, end: to });
  return out;
}

/**
 * The destructive operations in a migration's SQL, as [{ op, line }] in file order (one entry per match;
 * an empty array means none). Reads the code view and every string literal, and adds the deleting it
 * cannot see into (`unseenOps`); never throws.
 */
export function destructiveOps(sqlText) {
  const src = String(sqlText ?? "");
  const { code, strings, bodies } = sqlViews(src);
  const lineAt = (offset) => src.slice(0, offset).split("\n").length;
  const created = [...code.matchAll(CREATE_TABLE)].map((m) => ({ key: tableKey(m[1]), at: m.index, temp: /\bTEMP(?:ORARY)?\b/i.test(m[0]) }));
  const found = [];
  // A literal's offset is its opening quote; a match inside it is reported at that line.
  const hays = [
    { text: code, base: null },
    ...strings.map((s) => ({ text: s.text.replace(FORMAT_ARG, "fmt_arg"), base: s.start })),
  ];
  const drops = [];
  for (const { text, base } of hays) {
    const at = (i) => (base === null ? i : base);
    for (const [op, re] of DESTRUCTIVE_SHAPES) {
      for (const m of text.matchAll(re)) found.push({ op, at: at(m.index) });
    }
    if (base !== null) for (const [op, re] of DYNAMIC_TAIL) if (re.test(text)) found.push({ op, at: base });
    for (const m of text.matchAll(DROP_TABLE)) drops.push({ at: at(m.index), keys: m[1].split(",").map((n) => ({ key: tableKey(n.trim()), schema: /^\s*"?public"?\s*\./i.test(n) })) });
  }
  // A scratch drop consumes ONE earlier plain CREATE of that name: a second drop of a reused name (or of a
  // table renamed onto it) has no create left to pair with, and CREATE … IF NOT EXISTS may create nothing.
  const used = new Set();
  for (const d of drops.sort((a, b) => a.at - b.at)) {
    // A TEMP table lives in pg_temp, so a drop of `public.<name>` is the real table, never the scratch one.
    const pair = d.keys.map(({ key, schema }) => created.findIndex((c, i) => !used.has(i) && c.key === key && !(c.temp && schema) && c.at < d.at));
    if (pair.every((i) => i !== -1)) pair.forEach((i) => used.add(i));
    else found.push({ op: "table dropped", at: d.at });
  }
  found.push(...unseenOps(src, code, strings, bodies));
  return found.sort((a, b) => a.at - b.at).map(({ op, at }) => ({ op, line: lineAt(at) }));
}

/** Does this record's first line approve? Only when it OPENS with an approving word that nothing qualifies
 *  (see the header). `scope` is the sha a scoped verdict names (lowercase), or "" — the caller compares it. */
export function gateVerdict(line) {
  const w = leadingWindow(line).replace(/^[^A-Z0-9]+/, "").replace(/^TERMINAL-VERDICT[^A-Z0-9]*/, "");
  const m = APPROVING_RE.exec(w);
  if (!m) return { approving: false, word: w.split(/[^A-Z0-9-]/)[0].replace(/-+$/, "").slice(0, 40) || "(empty)", scope: "" };
  const tail = w.slice(m[1].length);
  if (/^-WITH-FINDINGS(?![A-Z0-9])/.test(tail)) return { approving: false, word: "APPROVED-WITH-FINDINGS", scope: "" };
  for (const re of [...Object.values(APPROVAL_QUALIFIERS), OPEN_FINDING[m[1]]]) {
    const q = re.exec(tail);
    if (q) return { approving: false, word: `${m[1]}, qualified by ${q[1]}`, scope: "" };
  }
  const s = SCOPED_SHA.exec(tail);
  return { approving: true, word: m[1], scope: s ? (s[1] || s[2]).toLowerCase() : "" };
}

function sameCommit(a, b) {
  const n = Math.min(a.length, b.length);
  return n >= 7 && a.slice(0, n) === b.slice(0, n);
}

/** The review record's path for a commit: one committed file per reviewed commit, named by the FULL sha. */
export const reviewRecordPath = (commit) => `${REVIEWS_DIR}/${commit}.md`;

/**
 * The record reading, in one place. `recordText` is the review record's content (as committed), `commit` the
 * full sha of the commit that last changed the file, `authorSid8` that commit's session (the 8-hex prefix of its
 * `Claude-Session:` trailer, or ""). Returns { approved, reason } and never throws. An approval also needs a
 * `Reviewed-by:` line naming someone other than the author's own session.
 */
export function reviewDecision(recordText, commit, authorSid8 = "") {
  const path = reviewRecordPath(commit);
  const first = String(recordText ?? "").split("\n").find((l) => l.trim() !== "");
  if (first === undefined) return { approved: false, reason: `the review record ${path} is empty, so it cannot approve` };
  const v = gateVerdict(first);
  if (!v.approving) {
    return { approved: false, reason: `the review record ${path} opens with ${v.word}, not an approval` };
  }
  // A scope naming another commit withholds the verdict from this one; the same sha, in any length, is narration.
  if (v.scope && !sameCommit(v.scope, commit)) {
    return { approved: false, reason: `the review record ${path} scopes its ${v.word} to ${v.scope}, not to this commit` };
  }
  // The first Reviewed-by line names the reviewers: seat names, agent or session ids, comma- or space-separated.
  const rm = /^\s*Reviewed-by:[ \t]*(.*)$/im.exec(String(recordText ?? ""));
  const names = rm ? rm[1].split(/[\s,;]+/).map((n) => n.trim()).filter(Boolean) : [];
  if (names.length === 0) {
    return { approved: false, reason: `the review record ${path} names no reviewers (a Reviewed-by line), so it cannot be told from the author's say-so` };
  }
  if (authorSid8 && names.every((n) => n.toLowerCase().startsWith(authorSid8))) {
    return { approved: false, reason: `the review record ${path} names only the commit's own session ${authorSid8} as its reviewer, which is not a review` };
  }
  return { approved: true, reason: `${path}: ${v.word}, reviewed by ${names.join(", ")}` };
}

function refusal(message) {
  const err = new Error(message);
  err.code = GATE_REFUSED;
  return err;
}

/** The owner's words carried by `flag` in argv, or "" when there are none. Bare or placeholder words are none. */
export function ownerWordsFrom(argv, flag) {
  const arg = (argv || []).find((a) => String(a).startsWith(flag));
  if (!arg) return "";
  const words = String(arg).slice(flag.length).trim();
  // Words carry a letter or a digit: a zero-width space, a pair of quotes or a lone "=" is none.
  if (!words || /^<.*>$/.test(words) || !/[\p{L}\p{N}]/u.test(words)) return "";
  return words;
}

/** True when the words arrived split across arguments: `--owner-ordered=yes apply it` (unquoted) leaves
 *  "apply" right after the flag, and the log would keep "yes". A following flag or the .sql file is fine. */
export function ownerWordsSplit(argv, flag) {
  const a = argv || [];
  const i = a.findIndex((x) => String(x).startsWith(flag));
  if (i === -1 || i + 1 >= a.length) return false;
  const next = String(a[i + 1]);
  return !next.startsWith("--") && !/\.sql$/.test(next);
}

/** The owner's order to apply without an approving review (`--owner-ordered=`), or "". */
export const ownerOrderFrom = (argv) => ownerWordsFrom(argv, ESCAPE_FLAG);
export const ownerOrderSplit = (argv) => ownerWordsSplit(argv, ESCAPE_FLAG);

function defaultAppendLog(root, row) {
  const path = join(root, FIRES_LOG);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(row) + "\n");
}

/** Is the review gate switched off in this environment? Only the exact value "off" (any case) switches it. */
export const gateIsOff = (env) => String(env?.[OFF_SWITCH] ?? "").trim().toLowerCase() === "off";

/**
 * Pass, or throw a refusal (err.code === GATE_REFUSED). Never connects to anything.
 *   file         bare migration basename (NNNN_name.sql)
 *   head         the HEAD sha the committed SQL was read at
 *   databaseUrl  the target URL: read for its hostname only, never printed
 *   argv         where the owner's words are looked for (the order, and the destructive yes)
 *   git(args)    returns stdout, throws on a non-zero exit (injectable for tests)
 *   root         repository root (the log is resolved against it)
 *   env          where the off switch (MIGRATION_REVIEW_GATE) is read
 *   readSql()    the committed SQL the applier executes; defaults to the blob at `head`
 *   readRecord(commit)   the review record's text as committed at `head`; throws when there is none
 *   decide(commit, authorSid8) / appendLog(row) / now()   injectable (tests; a port)
 * Returns { gate: "local" | "approved" | "owner-ordered" | "off", commit, reason, destructive, destructiveYes }:
 * `destructive` is destructiveOps' list (empty when none), `destructiveYes` the owner's words or "".
 */
export function checkMigrationReview({
  file,
  head,
  databaseUrl,
  argv = [],
  git,
  root = process.cwd(),
  env = process.env,
  readSql = () => git(["cat-file", "blob", `${head}:supabase/migrations/${file}`]),
  readRecord = (commit) => git(["show", `${head}:${reviewRecordPath(commit)}`]),
  // The record source: a project with another record replaces this one function, (commit, authorSid8) -> decision.
  decide = (commit, authorSid8) => reviewDecision(readRecord(commit), commit, authorSid8),
  appendLog = (row) => defaultAppendLog(root, row),
  now = () => new Date(),
}) {
  if (databaseHostIsLocal(databaseUrl)) {
    return { gate: "local", commit: null, reason: "local database, exempt", destructive: [], destructiveYes: "" };
  }

  const path = `supabase/migrations/${file}`;
  const listOps = (ops) => ops.map((o) => `${o.op} at line ${o.line}`).join("; ");
  const destructiveHow =
    `  A destructive migration (rows rewritten or deleted, a table or column dropped, a column's type changed,\n` +
    "  or a cascade link that deletes or rewrites rows later) also needs the owner's explicit yes: show the owner\n" +
    "  these operations and wait for the words, then re-run with\n" +
    `  ${DESTRUCTIVE_FLAG}"<the owner's words, verbatim>" as ONE argument (logged). The owner's order to apply\n` +
    "  without a review is not this yes, and this yes is not a review.\n";
  const stop = (why, ops = []) =>
    refusal(
      `ABORT: ${file} has no approving review on record, so it is not applied to a shared database.\n` +
        `  ${why}\n` +
        `  An apply needs ${REVIEWS_DIR}/<full-sha>.md for the commit that last changed the file, COMMITTED at HEAD\n` +
        `  (never the working tree), with its first non-blank line OPENING with ${APPROVING_WORDS.join(" / ")},\n` +
        "  unqualified (no WITH, no other verdict, no open finding), and a Reviewed-by line naming who reviewed it.\n" +
        "  Send that commit for --code review and wait for the verdict; a fold that changes the file moves the\n" +
        "  commit, so it needs its own record.\n" +
        `  Only the owner can override: re-run with ${ESCAPE_FLAG}"<the owner's words, verbatim>" as ONE argument (logged).\n` +
        (ops.length ? `  It is also destructive: ${listOps(ops)}.\n${destructiveHow}` : "") +
        "  Nothing was sent: no connection was opened.",
    );
  const stopUnreadable = (why) =>
    refusal(`ABORT: ${file} is not applied to a shared database: its SQL could not be read.\n  ${why}\n` +
      "  Nothing was sent: no connection was opened.");
  const stopDestructive = (why, ops) =>
    refusal(
      `ABORT: ${file} is destructive (${listOps(ops)}), so it is not applied to a shared database without the\n` +
        "  owner's words.\n" +
        `  ${why}\n` +
        destructiveHow +
        "  Nothing was sent: no connection was opened.",
    );

  let commit;
  let author = "";
  try {
    commit = git(["log", "-1", "--format=%H", String(head), "--", path]).trim();
    if (/^[0-9a-f]{40}$/.test(commit)) {
      // The author's session, for the separation check: the 8-hex prefix of the Claude-Session trailer.
      const trailer = git(["log", "-1", "--format=%(trailers:key=Claude-Session,valueonly,separator=%x2C)", commit]).trim();
      const m = /^([0-9a-f]{8})/.exec(trailer);
      author = m ? m[1] : "";
    }
  } catch (e) {
    throw stop(`The commit that last changed ${path} could not be read (git exited ${e?.status ?? "with an error"}).`);
  }
  // Shape, not emptiness: real git exits 128 on an empty revision, which would mislabel "no commit" as a git failure.
  if (!/^[0-9a-f]{40}$/.test(commit)) throw stop(`No commit at HEAD changed ${path}.`);

  // The SQL the applier executes, read at the same HEAD. Unreadable fails closed: a gate that cannot see
  // the operations cannot say they are not destructive.
  let ops;
  try {
    ops = destructiveOps(readSql());
  } catch (e) {
    throw stopUnreadable(`The committed SQL of ${path} could not be read (${e?.code ?? (e?.status != null ? `git exited ${e.status}` : "error")}), so whether it is destructive is unknown.`);
  }

  const off = gateIsOff(env);
  let decision;
  if (off) {
    decision = { approved: false, reason: `${OFF_SWITCH}=off, so no review was looked for` };
  } else {
    try {
      decision = decide(commit, author);
    } catch (e) {
      // `git show` exits 128 on a path the commit does not hold: no record is committed. Any other failure
      // reads the same way, which is the closed direction.
      decision = { approved: false, reason: `no review record ${reviewRecordPath(commit)} is committed at ${String(head).slice(0, 12)} (${e?.code ?? (e?.status != null ? `git exited ${e.status}` : "error")})` };
    }
  }
  const order = ownerOrderFrom(argv);
  const yes = ops.length ? ownerWordsFrom(argv, DESTRUCTIVE_FLAG) : "";
  const base = {
    ts: now().toISOString(),
    file,
    commit: commit.slice(0, 12),
    reason: decision.reason,
    ...(ops.length ? { destructive: [...new Set(ops.map((o) => o.op))] } : {}),
  };
  const best = (row) => {
    try { appendLog(row); } catch { /* a refusal, a plain approval or an off apply stands without its log line */ }
  };

  // THE REVIEW HALF.
  let gate;
  if (off) gate = "off";
  else if (decision.approved) gate = "approved";
  else if (order) {
    if (ownerOrderSplit(argv)) {
      throw stop(`The owner's order arrived split across arguments; pass the words as ONE quoted argument. Underlying: ${decision.reason}.`, ops);
    }
    gate = "owner-ordered";
  } else {
    best({ ...base, decision: "refused" });
    throw stop(`Commit ${commit.slice(0, 12)}: ${decision.reason}.`, ops);
  }

  // THE DESTRUCTIVE HALF. Runs whatever the review half said, the off switch included.
  if (ops.length && !yes) {
    best({ ...base, decision: "refused-destructive" });
    throw stopDestructive("No owner's yes was given for these operations (a bare or placeholder yes is none).", ops);
  }
  if (yes && ownerWordsSplit(argv, DESTRUCTIVE_FLAG)) {
    throw stopDestructive("The owner's yes arrived split across arguments; pass the words as ONE quoted argument.", ops);
  }

  // A plain approval's (or an off apply's) log line is best-effort; any of the owner's words must be logged or
  // the apply stops.
  const row = { ...base, decision: gate, ...(gate === "owner-ordered" ? { order: order.slice(0, 500) } : {}), ...(yes ? { destructiveYes: yes.slice(0, 500) } : {}) };
  if (gate === "owner-ordered" || yes) {
    try {
      appendLog(row);
    } catch (e) {
      const what = gate === "owner-ordered" ? "order" : "yes";
      const err = `The owner's ${what} could not be logged (${e?.code ?? "error"}), and unlogged words are not accepted. Underlying: ${decision.reason}.`;
      throw gate === "owner-ordered" ? stop(err, ops) : stopDestructive(err, ops);
    }
  } else {
    best(row);
  }
  return { gate, commit, reason: decision.reason, destructive: ops, destructiveYes: yes };
}
