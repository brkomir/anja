#!/usr/bin/env node
// promote-review-coverage.mjs — which commits in a promote range were NEVER SENT for review.
//
// WHY. A session sends one review request per finished piece of work, so a session
// that dies mid-piece leaves `src/` commits on `dev` that never reached the review hub. Nothing else
// sees them: `review-request-closure-scan.mjs` covers a request with no verdict, and /promote step 5
// lists open DEPLOY-HOLDs, which a never-sent commit cannot carry.
//
// WHAT IT READS. Every non-merge commit in the range that touches `src/` or `supabase/migrations/`,
// checked against the rows of `.claude/docs/review-ledger.md` (a row = a `|` line whose Commit cell
// names at least one sha, the parser's own definition). A commit counts as covered, in this order:
//   1. sha    — a row names it in its Commit, Verdict or Mail cell. The hub also records a verified
//               fold in the Verdict cell ("APPROVED-WITH-FINDINGS -> FOLD-VERIFIED (<sha>)") or the Mail
//               cell, so reading the Commit cell alone listed hub-verified folds among the "never sent".
//               The WHOLE Commit cell is read, not
//               `commitCellShas`' cut form: "`<sha>` (fold of <sha>+<sha>), `<sha>` (fold of
//               <sha>)" names its second sha after the cut. A Commit-cell token may be 7-40 hex; in the
//               other cells it must be 9+, so outside the Commit cell an 8-hex session id ("request from <session id>")
//               cannot resolve to a commit that happens to share its prefix. Every token is resolved by git
//               (`<token>^{commit}`), so a short and a long spelling both match;
//   2. range  — the Commit cell names `A..B` or `A^..B` and the commit is in `git rev-list` of it AND
//               carries the same `Claude-Session:` trailer as B. `dev` is shared, so a range interleaves
//               other sessions' commits the review never looked at (one measured range held 10 commits
//               from 3 sessions); those stay uncovered. Both endpoints are named shas, so they are covered by
//               1 whatever git's `A..B` excludes;
//   3. patch  — `git patch-id --verbatim` equals that of a commit covered by 1 or 2 (a parked commit
//               re-landed under a new sha: the reviewed commit and the landed one share a verbatim
//               patch-id, and with the landed commit's own ledger mention blanked, this route matches it).
//               `--verbatim`, not `--stable`: `--stable` drops every whitespace character, so a patch whose
//               only change is a space inside a string literal ("cancel it" -> "cancelit") would match.
// A commit named only in a row's Note cell is listed apart as NOTE ONLY, with the ledger line: notes
// carry real fold-verifications ("<sha> = <sha> patches byte-exact (hub-checked, loop
// closed)") and also passing mentions, so one read of that line decides it.
//
// THE VERDICT ARM (warn-mode). Covered means NAMED, not disposed.
// For every covered commit it reads the NEWEST ledger row naming it: the lib's parseLedgerShas + lookupSha
// first (newest row wins over the cut Commit cell, the hub's parse), and where that has no entry — a
// commit named past the cut, only in a Verdict or Mail cell, inside a range, or a patch-id twin — the naming
// row's own verdict through `coveredByRow` (the twin's, for a patch); a range row (written before the Commit cell's cut)
// newer than the newest row naming the commit in a cut Commit cell answers before both. A null there is never read as "no
// verdict": it lists. Each covered commit whose newest row is not dispositive prints a NOT DISPOSED line. It
// changes neither the REVIEW-COVERAGE token nor, without --refuse, the exit code; under --refuse
// (THE REFUSAL below) its uncleared-verdict commits refuse (every NON_CLEARING word; a verified fold clears one:
// THE FOLD RULE in analyze(), v1.25). CHANGES-REQUESTED and UNRESOLVED
// list too, as NOT DISPOSED "no later row names it with a clearing verdict": the lib's DISPOSITIVE_VERDICTS holds both
// because the review LOOP reached a terminal state, not because the commit is cleared, so such a verdict clears only
// when a LATER row names the commit in a Commit, Verdict or Mail cell, or through a range, with a dispositive verdict outside that pair (a range row never clears such a row that names the commit in its cut Commit cell: only a later row naming the commit by token does, the hold arm's rule) (a
// row citing it there in passing closes it too), and a pending fold fails closed, never covered-with-debt. A
// Note-cell mention never closes such a verdict (notes also say "loop open").
//
// WHAT IT CANNOT SEE. A request mailed but not yet seated by the hub has no ledger row, so it reads as
// never sent; the mail store is not read (it prunes after 24-72 h). The verdict arm classifies a row by its
// Verdict cell's LEADING words, so a hub row that opens with something other than its verdict word reads
// non-dispositive until the hub's verdict-first backfill lands.
//
// Read-only but for one appended JSONL row per run (.claude/logs/promote-review-coverage-fires.jsonl, end of
// main; PROMOTE_COVERAGE_LOG_DIR=<dir> lands it there instead, for an audit or a test that must not grow the
// shared log): git plumbing and one file read. Without --refuse it exits 0 whatever it finds: read the verdict TOKEN,
// never the exit code — `REVIEW-COVERAGE: CLEAN | UNSENT <n> NOTE-ONLY <k> | NOT-CHECKED`. Exit 2 is an argument it
// does not know.
//
// THE REFUSAL (--refuse; promote-precheck.sh passes it).
// Exit 4 when a never-sent commit's COMMITTER date is older than REFUSAL_GRACE_HOURS (its value and its reason live at the constant; younger ones list as IN
// FLIGHT, excused — a grace for commits plausibly inside the review batch), or a commit's newest verdict
// reads a NON_CLEARING word with no later clearing row and no verified fold (any age), or nothing was measured. NOTE ONLY commits
// and an unparsed newest row list without refusing. Only the owner's go passes it, and only when it names every refusing
// commit with every reason it refuses for (THE OWNER'S GO, below). Its token: `REVIEW-COVERAGE-GATE: PASS | REFUSED |
// PROCEEDING ON THE OWNER'S GO`. 4
// collides with none of promote-precheck.sh's own codes (2, 3, 75).
//
// THE HOLD ARM. The promote refuses to ship while a hold row is open, with an override (the owner's go, below).
// A hold lives in three places and /promote read only the first, which expires: the hold MAIL's `signal:` frontmatter
// (72 h). This arm reads the other two, over EVERY non-merge commit in the range, not only src/ and migrations:
//   1. tracker — an OPEN `- [ ] HUB-HOLD-…` row in todo.txt names the commit, by a hex token in the row's NAME (7-40
//      hex, e.g. HUB-HOLD-<SHA9>-<SHA9>-…) or on its `done-when:` line (9-40 hex, so an 8-hex session id cannot
//      match). Only those two places: a hold row's body also cites fold commits, mail files and other seats' commits.
//   2. ledger  — the newest ledger row naming the commit reads HOLD (or HOLD NOT DISCHARGED) and no later row names it
//      with a clearing verdict.
// Under --refuse each held commit refuses (`HOLD-OPEN n`); the owner's go passes it when its entry for the held commit
// carries one `hold:<source>` reason per row holding it (the tracker row's name, or the ledger HOLD row's content id `r<id>`), and the
// PROCEEDING line names it. An unreadable todo.txt refuses too ("the hold rows could not be read"): an unread hold is
// not an absent one. Stays local: no CI job, no label.
//
// THE OWNER'S GO. The go names the commits the owner passed ("proceed with A and B"): when C appears, the check
// refuses on its own, says C is not something the owner approved, and asks again. The go also records why the owner
// passed each commit ("not reviewed yet", "held", and so on); the check prints the go ready to copy, so it costs
// nothing extra; and /promote re-runs the check just before asking "merge it?", with the same go. A single value that
// passed every refusal at once (the retired PROMOTE_REVIEW_PROCEED=1) let a commit that
// began refusing after the owner answered ride through on the owner's word. PROMOTE_REVIEW_PROCEED holds one `<sha>:<reasons>`
// entry per refusing commit the owner passed, separated by commas and/or spaces. The sha is 7-40 hex and names the commit IN THE
// RANGE whose sha it case-insensitively prefixes: resolved against every non-merge commit in the range, never only the
// ones refusing now, so an entry given for A cannot name B after A clears; an entry that prefixes two range commits
// names neither, and one naming a commit that no longer refuses is listed as refusing nothing.
// The reasons, joined by `+`, are what the owner passed it for, each bound to its SOURCE: `unsent` (a never-sent
// commit has none), `<word>:r<id>` for each NON_CLEARING word lowercased (`changes-requested:`, `unresolved:`, and since
// v1.25 `alternative:`, `reject:`, `rejected:`, `self-retraction:`, `refuted:`; the newest such ledger row's content id, `rowId`:
// 8 hex of sha1 over its Date, Commit, Verdict and Mail cells), and one `hold:<source>` per open hold, the source the
// tracker row's full name (`hold:HUB-HOLD-…`) or the ledger HOLD row's `r<id>`. Kinds alone let a second hold row, a new
// ledger HOLD or a newer CHANGES-REQUESTED row on a commit the owner had passed for that kind ride through. The tracker
// source is the exact row name, never a shortened form: a prefix can rebind to a row filed after
// the owner's answer, the sha-prefix rebinding above one level down, and the full name is also what the REFUSES line prints, so the long go line
// is read against those lines and only ever copied. The ledger source is CONTENT, not a line (v1.21; v1.20 used `L<n>`):
// the hub edits inside the live region (it can rewrite one row in place and insert another a few rows below), which shifts every line
// below and would re-ask for nothing, and a row rewritten in place keeps its line and would pass unseen. A source is the
// hash of a ledger row's date, commit, verdict and mail cells (rowKey; the note cell too where another row shares those
// four): a new verdict is a new row and a new source; a note appended to a row is not; a corrected mail cell re-asks
// once (the ledger is append-only, the Verdict cell is never edited in place). An edit above the row
// moves nothing. The REFUSES line prints the id and the
// line beside it, the line as information only. Two rows in one run sharing an id with different keys (an 8-hex
// collision) refuse as `goCollision`, whatever the go says. A refusing commit passes only when exactly one entry
// names it and that entry carries every reason it refuses for NOW; a commit no entry names, one two entries name, and one
// that gained a reason or a source after the owner answered (passed as never sent, now also held; held by one row, now by two)
// each print a `NOT IN YOUR GO` line, and the run refuses. A reason an entry carries that no longer applies is harmless
// and listed. A refusal that is not a commit
// passes only on one `unmeasured:<items>` entry under the same every-item rule: `nothing` for a run that measured
// nothing, `todo` for an unreadable todo.txt, the row's own name for a hold row naming no commit, so a go that passed
// one of them never passes another. A bare sha, the bare word `unmeasured`, an empty or
// unknown reason or item, a kind without its source (v1.19's `hold`) or with one it cannot carry, the old "1" and any
// other entry refuse with the format (GO_FORMAT), whatever the range holds — over a range where nothing refuses, the line
// adds that the variable comes off; unset or empty, the gate reads as it does without a go. Every refusal
// prints `GO FOR WHAT IS SHOWN`, the go for exactly what it showed, which passes when fed back against the same input,
// except when a hold row's name carries `+` or `,`: the go splits there, refuses as malformed, and no go can pass that row.
// /promote runs this gate three times under one go: at step 1 through promote-precheck.sh (`via: precheck`); alone at
// step 5, just before it asks "merge it?" (`via: promote-step5`), so anything that began refusing during CI stops the
// question; and alone inside step 6's merge call, the merge gated on its PASS / PROCEEDING line
// (`via: promote-step6`), so a hold or verdict landing while the owner was answering stops the merge.
//
// USAGE
//   node scripts/promote-review-coverage.mjs                         # range origin/main..dev
//   node scripts/promote-review-coverage.mjs --range <base>..<head>  # what promote-precheck.sh passes
//   node scripts/promote-review-coverage.mjs --ledger <path>         # default: the shared checkout's ledger
//   node scripts/promote-review-coverage.mjs --refuse                # exit 4 on the refusal above
//   node scripts/promote-review-coverage.mjs --todo <path>           # default: the shared checkout's todo.txt

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { classifyVerdictCell, commitCellShas, extractShas, ledgerRows, lookupSha, parseLedgerShas } from "./lib/review-ledger.mjs";
import { isMain } from "./lib/is-main.mjs";

export const SCOPE_PATHS = ["src/", "supabase/migrations/"];
const RANGE_RE = /\b([0-9a-f]{7,40})(\^?)\.\.([0-9a-f]{7,40})\b/g;
// Verdicts the lib counts as dispositive (the loop reached a terminal state) that do NOT clear the commit. ALTERNATIVE,
// REJECT(ED), SELF-RETRACTION and REFUTED are here because the migration gate already clears only
// on APPROVED / APPROVE / FOLD-VERIFIED, and 19 commits passed this gate on an ALTERNATIVE row that meant "findings with a
// patch, fold it". Each such commit is cleared by its FOLD (THE FOLD RULE, analyze()), so the change refuses nothing a
// verified fold already closed.
export const NON_CLEARING = new Set(["CHANGES-REQUESTED", "UNRESOLVED", "ALTERNATIVE", "REJECT", "REJECTED", "SELF-RETRACTION", "REFUTED"]);
// THE FOLD RULE's trigger: a commit whose SUBJECT says "fold" / "folds" / "folded" and names another commit by a 9-40 hex
// token folds that commit's review. Subject only, never the body (a body cites shas in passing), and 9+ hex so an 8-hex
// session id ("hub <sid8>") cannot name a commit. Never "fold-verified" / "fold-verify": that is the hub's bookkeeping
// word, and \bfold\b matched it in 197 of 201 hub ledger commits;
// "folds of hub <sid8>" was the plural a bare "fold" missed (a review's finding: 393 dev subjects spell it so).
const FOLD_SUBJECT_RE = /\bfold(?:s|ed)?\b(?!-verif)/i;
// A commit that writes the review ledger is the hub's bookkeeping, never a fold of code, whatever its subject says
// (measured: 777 such commits in range, 0 touching src/ or supabase/migrations/).
const LEDGER_PATH = ".claude/docs/review-ledger.md";
// The verdicts that verify a fold: the fold's OWN row (its cut Commit cell) must open with one of these. NO-REVIEW-OWED,
// CLOSED, LIFTED, TERMINAL-VERDICT and the other dispositive words close a loop without saying the fold was checked
// (a commit once cleared through a NO-REVIEW-OWED row). The lib reads
// "FOLD-VERIFIED-WITH-FINDINGS" as FOLD-VERIFIED.
const FOLD_APPROVALS = new Set(["FOLD-VERIFIED", "APPROVED", "APPROVE", "APPROVED-WITH-FINDINGS", "APPROVE-WITH-FINDINGS"]);
// With two or more reviewed folds that each list single findings, one must say it closes the rest, or the commit is
// partial ("fold hub P2-1 on O" + "fold hub P2-2 on O" once cleared O with its serious finding never folded).
// Phrases, case-sensitive: a bare /last/i read product string "Last billed" as closing (1 of the 2 dev
// subjects it matched), and "remaining" / "closes" also say the opposite ("P1 remaining", "closes P2-3").
const CLOSING_FOLD_RE = /\b(?:the rest|last open|clos(?:es|ing) (?:that|the|this) loop)\b/;
// A fold that says it covers PART of a verdict never clears the commit it folds; the commit refuses as before and the owner
// reads it (raised in a note to the owner on the first build of this rule). Partial is:
//   - a reviewed fold labelled "phase N" or "part N" (PHASE_FOLD_RE): one commit (fifteen findings open, one serious) had one fold,
//     "phase 1", and no phase 2 anywhere in git;
//   - "<n> of <sha>" (COUNT_OF_RE) for THAT sha only: "fold hub … + two of <sha>";
//   - a commit's ONLY reviewed fold listing single findings (FINDING_ID_RE, "P2-3 + P2-4", "P2 1-3");
//   - two or more reviewed folds that ALL list single findings, none saying it closes the rest (CLOSING_FOLD_RE):
//     one commit's second fold is "the last open item … (P3-2)", so it clears.
// Measured 2026-10-14 on one promote range. A count ("P2 5", "0/1/4") is not a finding id, and a hub bookkeeping commit
// is never a reviewed fold. Known limit: on that range the phase rule's precision is 1 of 1 and the
// single-fold-ids rule's 0 of 1 (that commit's only fold disposed of all 14 findings), and a finished "phase 1" + "phase 2"
// pair refuses for good; the owner's go passes such a commit. Revisit on the first refusal whose fold row reads
// "0 findings" or "loop CLOSED".
export const PHASE_FOLD_RE = /\b(?:phase|part) \d+\b/i;
export const FINDING_ID_RE = /\bP[0-3]-\d+\b|\bP[0-3] \d+-\d+\b/;
const COUNT_OF_RE = /\b(?:one|two|three|four|five|six|some) of ([0-9a-f]{9,40})\b/gi;
// Verdicts that put a commit ON HOLD (the hold arm). "HOLD NOT DISCHARGED" classifies as an arrival word, and is a hold.
const HOLD_VERDICTS = new Set(["HOLD", "ARRIVAL:HOLD-NOT"]);
const BIG = 512 * 1024 * 1024;

function git(cwd, args, input) {
  return execFileSync("git", args, {
    cwd, input, encoding: "utf8", maxBuffer: BIG, stdio: ["pipe", "pipe", "pipe"],
  });
}

/** `Claude-Session:` value, normalised: a UUID or an 8-hex id becomes its first 8 hex, anything else
 *  (a claude.ai URL) is kept whole. Read from the full body: a blank line before Co-Authored-By hides
 *  the trailer from `%(trailers)` (/promote step 0). */
export function sessionOf(body) {
  const m = String(body).match(/^Claude-Session:[ \t]*(\S+)/im);
  if (!m) return null;
  const v = m[1].trim();
  return /^[0-9a-f]{8}(?:-|$)/i.test(v) ? v.slice(0, 8).toLowerCase() : v;
}

/** Ledger rows -> the hex tokens they name (Commit/Verdict/Mail cells), the tokens only a Note names
 *  (-> its 1-based line), the ranges the Commit cells name, and `coveredByRow`: each of those tokens and
 *  range texts (`A..B` / `A^..B`) -> {verdict, dispositive, when, line} of the NEWEST row naming it, the
 *  verdict arm's source wherever the lib's cut-Commit-cell parse has no entry. `closingByRow` /
 *  `nonClearingByRow`: each token -> the newest row naming it whose verdict clears (dispositive, outside
 *  NON_CLEARING) / is in NON_CLEARING, range texts included; `holdByRow` the same for a HOLD_VERDICTS row, tokens only. Kept per class because `coveredByRow` holds only the newest row, where an
 *  arrival row would hide an older closing or CHANGES-REQUESTED row from the closure rule. `cutByRow` / `cutNonClearingByRow`:
 *  the same for tokens in the CUT Commit cell (the rows the lib's lookup reads); `cutRangeByRow`: range texts written before
 *  that cut, so a range cited in prose after it never decides a verdict. */
export function parseLedgerRefs(text) {
  const rowTokens = new Set();
  const noteTokens = new Map();
  const ranges = [];
  const coveredByRow = new Map();
  const closingByRow = new Map();
  const nonClearingByRow = new Map();
  const holdByRow = new Map();
  const noteClosingByRow = new Map(); // token -> the newest row whose Note cell alone names it, with a clearing verdict
  const cutByRow = new Map(); // token -> the newest row naming it in the CUT Commit cell (the rows the lib's lookup reads)
  const cutNonClearingByRow = new Map(); // the same, NON_CLEARING rows only
  const cutRangeByRow = new Map(); // range text -> the newest row naming it before the Commit cell's cut (prose after it never decides)
  let rows = 0;
  const long = (cell) => extractShas(cell ?? "").filter((t) => t.length >= 9);
  // rowKey's four cells per row; a key two rows share takes their Note cells too (rowKey), so the pair stays two sources.
  const prefixRows = new Map();
  for (const r of ledgerRows(text)) {
    if (!extractShas(r.commit).length) continue;
    const p = rowKey(r.date, r.commit, r.verdict, r.mail);
    prefixRows.set(p, (prefixRows.get(p) ?? 0) + 1);
  }
  for (const r of ledgerRows(text)) {
    const toks = extractShas(r.commit);
    if (!toks.length) continue;
    rows++;
    const cells = [r.date, r.commit, r.verdict, r.mail, prefixRows.get(rowKey(r.date, r.commit, r.verdict, r.mail)) > 1 ? r.note : null];
    const row = { ...classifyVerdictCell(r.verdict), when: r.date.trim(), line: r.line, key: rowKey(...cells), id: rowId(...cells) };
    for (const t of [...toks, ...long(r.verdict), ...long(r.mail)]) {
      rowTokens.add(t);
      coveredByRow.set(t, row);
      if (HOLD_VERDICTS.has(row.verdict)) holdByRow.set(t, row);
      if (NON_CLEARING.has(row.verdict)) nonClearingByRow.set(t, row);
      else if (row.dispositive) closingByRow.set(t, row);
    }
    for (const t of commitCellShas(r.commit)) { cutByRow.set(t, row); if (NON_CLEARING.has(row.verdict)) cutNonClearingByRow.set(t, row); }
    for (const t of long(r.note)) {
      if (!noteTokens.has(t)) noteTokens.set(t, r.line);
      if (row.dispositive && !NON_CLEARING.has(row.verdict)) noteClosingByRow.set(t, row);
    }
    const cut = r.commit.search(/ \(| — /);
    for (const m of (cut === -1 ? r.commit : r.commit.slice(0, cut)).replaceAll("`", "").matchAll(RANGE_RE)) cutRangeByRow.set(`${m[1]}${m[2]}..${m[3]}`, row);
    for (const m of r.commit.replaceAll("`", "").matchAll(RANGE_RE)) {
      ranges.push({ base: m[1], caret: m[2] === "^", tip: m[3] });
      const text = `${m[1]}${m[2]}..${m[3]}`; // the key rangeMembers' `via` carries
      coveredByRow.set(text, row);
      if (NON_CLEARING.has(row.verdict)) nonClearingByRow.set(text, row);
      else if (row.dispositive) closingByRow.set(text, row);
    }
  }
  return { rowTokens, noteTokens, ranges, rows, coveredByRow, closingByRow, nonClearingByRow, holdByRow, noteClosingByRow, cutByRow, cutNonClearingByRow, cutRangeByRow };
}

/** The open hold rows of a todo.txt: `- [ ] HUB-HOLD-<…>` rows, each with the hex tokens its NAME carries (7-40) and
 *  its `done-when:` line carries (9-40): an indented continuation line, or the clause after `done-when:` on the row's own
 *  line. A row runs to the next `- [` line. Closed (`- [x]`) rows are skipped. */
export function parseHoldRows(todoText) {
  const lines = todoText.split("\n");
  const rows = [];
  let cur = null;
  lines.forEach((ln, i) => {
    if (/^- \[/.test(ln)) {
      cur = null;
      const m = ln.match(/^- \[ \] (HUB-HOLD-\S+)/);
      if (m) {
        const name = m[1];
        const tokens = new Set(name.split("-").filter((t) => /^[0-9a-f]{7,40}$/i.test(t)).map((t) => t.toLowerCase()));
        rows.push((cur = { name, line: i + 1, tokens }));
        // A one-line row carries its done-when inline (22 of 69 HUB-HOLD rows on 2026-10-14), and the blind refusal tells
        // the hub to "put every held sha on its done-when line": read that clause too, or the instruction cannot be met.
        // The clause ends at the row's next field or appended note (` | `, ` · `, filed:/owner:/trigger:, CLOSED/LIFTED,
        // ✅): that tail is the body the header excludes (one row's tail named its fold,
        // not the two commits it held).
        const clause = ln.match(/\bdone-when:(.*?)(?=\s(?:\||·|filed:|owner:|trigger:|CLOSED\b|LIFTED\b|✅)|$)/)?.[1] ?? "";
        for (const t of clause.match(/\b[0-9a-f]{9,40}\b/g) ?? []) tokens.add(t);
      }
      return;
    }
    if (cur && /^\s+done-when:/.test(ln)) for (const t of ln.match(/\b[0-9a-f]{9,40}\b/g) ?? []) cur.tokens.add(t);
  });
  return rows;
}

/** A ledger row's CONTENT identity: `rowKey` is the parsed row's Date, Commit, Verdict and Mail cells (the ledger parser's
 *  row model, never a hand split), each whitespace-normalised, joined by ` | `, plus the Note cell when it is passed —
 *  which parseLedgerRefs does only for a row whose four cells another row in the ledger shares; `rowId` is the first 8
 *  hex of its sha1. The owner's go names a ledger-sourced
 *  refusal by it (`changes-requested:r<id>`, `hold:r<id>`, THE OWNER'S GO). The ledger is append-only by its own header
 *  (one row per commit per verdict mailed): a new verdict is a new row and a new source; a note
 *  appended to a row's Note cell is not; a corrected Mail cell re-asks once. Reviewer and Note stay out because the Note
 *  cell is where the hub appends in place. The Mail cell should be the verdict mail's filename, unique per verdict, but it
 *  often is not: in a measured ledger more than half of the CHANGES-REQUESTED / UNRESOLVED / HOLD rows carried a session
 *  id, `TERMINAL` or `(same mail)` there, and every recent one did. Date+Commit+Verdict+Mail collided once
 *  (two rows on one commit and one day, Mail `(same mail)`, told apart by their notes), so the Note cell joins the key for
 *  exactly the rows sharing those four cells: those two stay two sources, a third such row is a new source (and re-asks
 *  for the pair once), and a note appended to any other row re-asks for nothing, whatever its Mail cell holds. */
export function rowKey(date, commit, verdict, mail, note = null) {
  const n = (c) => String(c ?? "").replace(/\s+/g, " ").trim();
  return [date, commit, verdict, mail, ...(note === null ? [] : [note])].map(n).join(" | ");
}
export function rowId(date, commit, verdict, mail, note = null) {
  return createHash("sha1").update(rowKey(date, commit, verdict, mail, note)).digest("hex").slice(0, 8);
}

/** token -> full commit sha, via `<token>^{commit}` so git prefers a commit over a same-prefix blob. */
function resolveCommits(cwd, tokens) {
  const list = [...tokens];
  const map = new Map();
  if (!list.length) return map;
  const out = git(cwd, ["cat-file", "--batch-check=%(objectname) %(objecttype)"],
    list.map((t) => `${t}^{commit}`).join("\n") + "\n").split("\n");
  list.forEach((t, i) => {
    const [sha, type] = (out[i] || "").split(" ");
    if (type === "commit" && /^[0-9a-f]{40}$/.test(sha)) map.set(t, sha);
  });
  return map;
}

/** sha -> {date, committedAt, subject, session}, one git call. `committedAt` is the committer date in epoch
 *  seconds (`%ct`), the refusal's grace clock; `date` is its YYYY-MM-DD spelling for the report. */
function commitMeta(cwd, shas) {
  const meta = new Map();
  const list = [...new Set(shas)];
  if (!list.length) return meta;
  const out = git(cwd, ["log", "--no-walk=unsorted", "--stdin", "--format=%H%x1f%cs%x1f%ct%x1f%at%x1f%s%x1f%B%x1e"],
    list.join("\n") + "\n");
  for (const rec of out.split("\x1e")) {
    const [h, date, ct, at, subject, body] = rec.replace(/^\n+/, "").split("\x1f");
    if (/^[0-9a-f]{40}$/.test(h || "")) meta.set(h, { date, committedAt: Number(ct), authoredAt: Number(at), subject, session: sessionOf(body) });
  }
  return meta;
}

/** sha -> sorted, NUL-joined path list (the commit's diff against its first parent). */
function fileSets(cwd, shas) {
  const sets = new Map();
  const list = [...new Set(shas)];
  if (!list.length) return sets;
  const out = git(cwd, ["log", "--no-walk=unsorted", "--stdin", "--format=%x1e%H", "--name-only"],
    list.join("\n") + "\n");
  for (const rec of out.split("\x1e").slice(1)) {
    const [h, ...files] = rec.split("\n").map((s) => s.trim()).filter(Boolean);
    sets.set(h, files.sort().join("\0"));
  }
  return sets;
}

/** sha -> stable patch id. */
function patchIds(cwd, shas) {
  const ids = new Map();
  const list = [...new Set(shas)];
  if (!list.length) return ids;
  const patch = git(cwd, ["log", "--no-walk=unsorted", "--stdin", "-p", "--format=commit %H"],
    list.join("\n") + "\n");
  for (const line of git(cwd, ["patch-id", "--verbatim"], patch).split("\n")) {
    const [pid, h] = line.trim().split(/\s+/);
    if (pid && h) ids.set(h, pid);
  }
  return ids;
}

/** The whole check. Pure over (repository, ledger text); throws only on a git failure. */
export function analyze({ cwd, range, ledgerText, todoText = null }) {
  // Pin both ends to shas once: `dev` takes a peer commit every few minutes, and three rev-lists over a
  // moving ref can disagree about the denominator.
  const ends = range.match(/^([^.]+)\.\.([^.]+)$/);
  const pinned = ends
    ? ends.slice(1).map((r) => git(cwd, ["rev-parse", "--verify", `${r}^{commit}`]).trim()).join("..")
    : range;
  const all = git(cwd, ["rev-list", pinned]).split("\n").filter(Boolean);
  const nonMerge = new Set(git(cwd, ["rev-list", "--no-merges", pinned]).split("\n").filter(Boolean));
  // --full-history: without it a merge that took one parent's version hides the other side's commits.
  const inScope = git(cwd, ["rev-list", "--no-merges", "--full-history", pinned, "--", ...SCOPE_PATHS])
    .split("\n").filter(Boolean).reverse(); // oldest first
  const inScopeSet = new Set(inScope);

  const { rowTokens, noteTokens, ranges, rows, coveredByRow, closingByRow, nonClearingByRow, holdByRow, noteClosingByRow, cutByRow, cutNonClearingByRow, cutRangeByRow } =
    parseLedgerRefs(ledgerText);
  const resolved = resolveCommits(cwd, new Set([...rowTokens, ...noteTokens.keys()]));
  const bySha = new Set([...rowTokens].map((t) => resolved.get(t)).filter(Boolean));
  const noteLine = new Map(); // sha -> first ledger line whose Note names it
  for (const [t, line] of noteTokens) {
    const h = resolved.get(t);
    if (h && (!noteLine.has(h) || line < noteLine.get(h))) noteLine.set(h, line);
  }

  // Ranges: expand, then keep only the members that share the tip's session.
  const rangeMembers = new Map(); // sha -> the NEWEST range text that covers it (ranges are in ledger order)
  const rangeTexts = new Map(); // sha -> every range text that covers it
  let rangesUnresolved = 0;
  const foreignInRanges = new Set();
  const expansions = [];
  for (const r of ranges) {
    const base = resolved.get(r.base);
    const tip = resolved.get(r.tip);
    if (!base || !tip) { rangesUnresolved++; continue; }
    let members;
    try {
      members = git(cwd, ["rev-list", "--no-merges", `${base}${r.caret ? "^" : ""}..${tip}`])
        .split("\n").filter(Boolean);
    } catch { rangesUnresolved++; continue; }
    expansions.push({ r, tip, members });
  }
  const meta = commitMeta(cwd, [...inScope, ...expansions.flatMap((e) => [e.tip, ...e.members])]);
  for (const { r, tip, members } of expansions) {
    const want = meta.get(tip)?.session ?? null;
    for (const m of members) {
      if ((meta.get(m)?.session ?? null) === want) {
        const text = `${r.base}${r.caret ? "^" : ""}..${r.tip}`;
        rangeMembers.set(m, text);
        rangeTexts.set(m, (rangeTexts.get(m) ?? new Set()).add(text));
      } else if (inScopeSet.has(m)) foreignInRanges.add(m);
    }
  }

  const how = new Map(); // in-scope sha -> {kind, via}
  for (const h of inScope) {
    if (bySha.has(h)) how.set(h, { kind: "sha" });
    else if (rangeMembers.has(h)) how.set(h, { kind: "range", via: rangeMembers.get(h) });
  }

  // Patch-id fallback. An identical patch has an identical path list, so only reviewed commits whose
  // path list equals an unmatched commit's are diffed — lossless, and it keeps `git log -p` small.
  const unmatched = inScope.filter((h) => !how.has(h));
  if (unmatched.length) {
    const reviewed = [...new Set([...bySha, ...rangeMembers.keys()])];
    const sets = fileSets(cwd, [...unmatched, ...reviewed]);
    const wanted = new Set(unmatched.map((h) => sets.get(h)).filter((s) => s !== undefined));
    const candidates = reviewed.filter((h) => wanted.has(sets.get(h)));
    if (candidates.length) {
      const ids = patchIds(cwd, [...unmatched, ...candidates]);
      const reviewedById = new Map();
      for (const c of candidates) if (ids.has(c) && !reviewedById.has(ids.get(c))) reviewedById.set(ids.get(c), c);
      for (const h of unmatched) {
        const twin = reviewedById.get(ids.get(h));
        if (twin && twin !== h) how.set(h, { kind: "patch", via: twin });
      }
    }
  }

  // Verdict arm: the newest row naming the commit through a range when it is newer than every row naming it by token,
  // else the lib's newest Commit-cell verdict, then the newest row naming it by token; a patch-id twin answers with the
  // reviewed commit's verdict. Null lists (never clean).
  const shaVerdicts = parseLedgerShas(ledgerText);
  const rowOf = new Map(); // full sha -> newest row naming it in a Commit, Verdict or Mail cell
  const closingRowOf = new Map(); // full sha -> newest such row with a clearing verdict (dispositive, not NON_CLEARING)
  const nonClearingRowOf = new Map(); // full sha -> newest such row reading CHANGES-REQUESTED or UNRESOLVED
  const keepNewest = (map, h, row) => { if (row && !(map.get(h)?.line > row.line)) map.set(h, row); };
  for (const [t, row] of coveredByRow) {
    const h = resolved.get(t);
    if (!h) continue;
    keepNewest(rowOf, h, row);
    keepNewest(closingRowOf, h, closingByRow.get(t));
    keepNewest(nonClearingRowOf, h, nonClearingByRow.get(t));
  }
  // A row naming the commit only through `A..B` feeds the same newest-row maps: read
  // after the token maps, a newer range-only CHANGES-REQUESTED row on a commit an older row names by sha never became its
  // source, so the printed go passed the commit under the older row. The hold arm keeps the token-only clearing map: a
  // range row neither holds a commit there nor releases one.
  const holdClosingRowOf = new Map(closingRowOf);
  const rangeRowOf = new Map(); // full sha -> newest row naming it through a range
  for (const [h, texts] of rangeTexts) {
    for (const t of texts) {
      keepNewest(rangeRowOf, h, cutRangeByRow.get(t));
      keepNewest(closingRowOf, h, closingByRow.get(t));
      keepNewest(nonClearingRowOf, h, nonClearingByRow.get(t));
    }
  }
  const noteClosingRowOf = new Map(); // full sha -> newest row naming it ONLY in its Note cell with a clearing verdict
  for (const [t, row] of noteClosingByRow) { const h = resolved.get(t); if (h) keepNewest(noteClosingRowOf, h, row); }
  // The token arm answers with the lib's cut-Commit-cell row, so the range row is compared against THAT row's line, never a
  // newer Verdict- or Mail-cell mention (which handed the verdict back to an older Commit-cell row).
  const cutRowOf = new Map(), cutNonClearingRowOf = new Map();
  for (const [t, row] of cutByRow) { const h = resolved.get(t); if (h) { keepNewest(cutRowOf, h, row); keepNewest(cutNonClearingRowOf, h, cutNonClearingByRow.get(t)); } }
  const verdictOf = (h) => {
    const range = rangeRowOf.get(h);
    // A tie is one row naming the commit both ways; the range arm returns that row with its line and id.
    if (range && !((cutRowOf.get(h) ?? rowOf.get(h))?.line > range.line)) return range;
    return lookupSha(shaVerdicts, h) ?? rowOf.get(h) ?? coveredByRow.get(rangeMembers.get(h)) ?? null; // a prose-only range: its row
  };
  // THE FOLD RULE. The hub records a fold's verdict on the FOLD commit's own row, so the original's
  // newest row stays CHANGES-REQUESTED / ALTERNATIVE: the 2026-10-14 promote refused 12 commits whose folds were all
  // FOLD-VERIFIED. A non-clearing commit O is cleared by its folds (foldClearance, below): F folds O when F's subject says
  // "fold" and names O (FOLD_SUBJECT_RE), F is a non-merge commit in the range that does not write the review ledger, and
  // F is REVIEWED when a row of its own names it in the cut Commit cell. A bare mention, in a body, a Note cell or another
  // row's Verdict cell, still clears nothing.
  const foldsOf = new Map(); // full sha of O -> the in-range commits whose subject folds it
  const foldSubject = new Map(); // full sha of F -> its subject
  {
    const subj = commitMeta(cwd, [...nonMerge]);
    const ledgerWriters = new Set(git(cwd, ["rev-list", "--no-merges", pinned, "--", LEDGER_PATH]).split("\n").filter(Boolean));
    const folding = [...subj].filter(([h, m]) => FOLD_SUBJECT_RE.test(m.subject ?? "") && !ledgerWriters.has(h));
    const toks = new Set(folding.flatMap(([, m]) => extractShas(m.subject).filter((t) => t.length >= 9)));
    const res = resolveCommits(cwd, toks);
    for (const [f, m] of folding) {
      foldSubject.set(f, m.subject);
      for (const t of extractShas(m.subject)) {
        const o = res.get(t); // only 9+ hex tokens were resolved
        if (o && o !== f) foldsOf.set(o, [...(foldsOf.get(o) ?? []), f]);
      }
    }
  }
  const foldMemo = new Map(); // full sha of F -> the row that clears it, or null; null first, so a cycle clears nothing
  // The row that verifies fold F: F's OWN verdict, as verdictOf picks it for every commit (its cut Commit-cell row, or a
  // newer range row naming it; when the lib's Commit-cell lookup carries no row, the cut row), or a chain clearance through
  // F's own fold (`foldOf`). Never settle()'s substitute, the newest LATER row that only mentions F (closingRowOf), which
  // re-dated a fold past a newer REJECT on the original (a review's finding). It
  // verifies only when it opens with a FOLD_APPROVALS word.
  const clearedBy = (f) => {
    if (foldMemo.has(f)) return foldMemo.get(f);
    foldMemo.set(f, null);
    const mine = verdictOf(f);
    const v = settle(f, mine);
    const row = v?.foldOf ? v : v && v === mine ? (v.line == null ? cutRowOf.get(f) ?? null : v) : null;
    const r = row && row.dispositive && FOLD_APPROVALS.has(row.verdict) ? row : null;
    foldMemo.set(f, r);
    return r;
  };
  // REVIEWED: a row of F's own in the cut Commit cell. NO-REVIEW-OWED drops F from the set every fold of O must clear, so
  // such a fold neither clears nor blocks (f20); as a STOP it is FOLD_APPROVALS that refuses it (f13). (The clause
  // relaxes the set rather than filtering a verdict.)
  const isReviewedFold = (f) => cutRowOf.has(f) && cutRowOf.get(f).verdict !== "NO-REVIEW-OWED";
  // THE FOLD RULE's decision for a non-clearing commit O whose open row is `src`: every REVIEWED fold of O must be
  // verified (clearedBy), the newest of those rows must be NEWER than `src`, and no fold of O may read as partial
  // (PHASE_FOLD_RE, COUNT_OF_RE for that sha, FINDING_ID_RE per the header). Returns { partial: F }, or { cleared: row }
  // carrying the fold path (O's fold first, then the fold that cleared it, for a chain), or null.
  const foldClearance = (h, src, foldedVerdict) => {
    const reviewed = (foldsOf.get(h) ?? []).filter(isReviewedFold);
    if (!reviewed.length) return null;
    const subj = (f) => foldSubject.get(f) ?? "";
    const listsFindings = (f) => FINDING_ID_RE.test(subj(f));
    const partial = reviewed.find((f) => PHASE_FOLD_RE.test(subj(f))
      || [...subj(f).matchAll(COUNT_OF_RE)].some((m) => h.startsWith(m[1].toLowerCase())))
      ?? (reviewed.every(listsFindings) && (reviewed.length === 1 || !reviewed.some((f) => CLOSING_FOLD_RE.test(subj(f))))
        ? reviewed.at(-1) : undefined);
    if (partial) return { partial };
    if (src.line == null) return null;
    const rows = reviewed.map(clearedBy);
    if (!rows.every(Boolean)) return null;
    const i = rows.reduce((best, r, j) => (r.line > rows[best].line ? j : best), 0);
    const newest = rows[i];
    if (!(newest.line > src.line)) return null;
    return { cleared: { ...newest, foldOf: reviewed[i], foldPath: [reviewed[i], ...(newest.foldPath ?? [])], foldedVerdict } };
  };
  // CHANGES-REQUESTED / UNRESOLVED (and since 2026-10-14 every NON_CLEARING verdict) end the review loop without clearing
  // the commit: it is disposed only when a LATER row names it with a clearing verdict, or its fold clears
  // after it (THE FOLD RULE), and that row becomes its verdict; otherwise it lists.
  const settle = (h, verdict) => {
    // An arrival row (FOLD-VERIFY REQUESTED, QUEUED, IN REVIEW) records no verdict, so a CHANGES-REQUESTED / UNRESOLVED
    // row before it, with no clearing row after that, is still the newest VERDICT and the commit stays open.
    const prior = nonClearingRowOf.get(h);
    // A CHANGES-REQUESTED / UNRESOLVED row naming the commit in its cut Commit cell clears only on a LATER row naming it by
    // token, as a hold does: a range's members are computed (ancestry and the tip's session), never named.
    const shaOpen = cutNonClearingRowOf.get(h);
    const pinned = shaOpen && !(holdClosingRowOf.get(h)?.line > shaOpen.line);
    // Pinned: the newest such row, or the pinned row itself once a later range row has cleared every newer one.
    if (pinned) verdict = closingRowOf.get(h)?.line > prior.line ? shaOpen : prior;
    else if (verdict && !verdict.dispositive && !NON_CLEARING.has(verdict.verdict) && prior
      && !(closingRowOf.get(h)?.line > prior.line)) verdict = prior;
    if (!verdict || !NON_CLEARING.has(verdict.verdict)) return verdict;
    const closing = closingRowOf.get(h);
    const open = pinned ? verdict : nonClearingRowOf.get(h); // pinned: the row chosen above is the open reason
    if (!pinned && closing && (!open || closing.line > open.line)) return closing;
    // A later Note-cell mention stays listed (notes also say "loop open"), but names its line: one read decides it.
    const note = noteClosingRowOf.get(h);
    const noteLine = note && (!open || note.line > open.line) ? note.line : null;
    // The SOURCE row: the newest non-clearing row naming it by token or through a range, else the row `verdict` came from
    // (the lib's Commit-cell lookup carries no row). Its content id (`rowId`) is the refusal's source
    // in the owner's go (`changes-requested:r<id>`), so a newer such row, or this row rewritten, is a new reason; its
    // line is carried for the REFUSES line only.
    const src = open && !(verdict.line > open.line) ? open : verdict;
    // THE FOLD RULE (foldClearance): a partial fold lists its subject in the reason and the commit refuses.
    const fold = foldClearance(h, src, verdict.verdict);
    if (fold?.cleared) return fold.cleared;
    const partial = fold?.partial;
    const why = partial
      ? `a fold of it reads as partial (${partial.slice(0, 9)}: "${(foldSubject.get(partial) ?? "").slice(0, 80)}")`
      : "no later row names it with a clearing verdict";
    return { ...verdict, dispositive: false, reason: why, noteLine,
      line: src.line ?? null, id: src.id ?? null, key: src.key ?? null };
  };

  // THE HOLD ARM: every non-merge commit in the range, src/ or not. A commit is held while the newest row naming it with
  // a HOLD verdict (in a Commit, Verdict or Mail cell) has no LATER row naming it with a clearing verdict. Keyed on the
  // hold row's own line rather than on the newest verdict, because a fold-verify often names the held commit only in a
  // later row's Verdict cell ("FOLD-VERIFIED (<sha>)"), which the lib's Commit-cell lookup never sees.
  const holdRowOf = new Map();
  for (const [t, row] of holdByRow) { const h = resolved.get(t); if (h) keepNewest(holdRowOf, h, row); }
  const ledgerHeld = [];
  for (const h of nonMerge) {
    const held = holdRowOf.get(h);
    if (!held || holdClosingRowOf.get(h)?.line > held.line) continue;
    ledgerHeld.push({ sha: h, verdict: held });
  }
  const holdRows = todoText === null ? null : parseHoldRows(todoText);
  const todoHeld = [];
  // An open hold row whose NAME and done-when line resolve to no commit at all holds commits this arm cannot read:
  // in one measured tracker some hub hold rows named a held sha only in the body, a few of them every held sha. It refuses.
  const blindRows = [];
  if (holdRows) {
    const res = resolveCommits(cwd, new Set(holdRows.flatMap((r) => [...r.tokens])));
    for (const r of holdRows) {
      if (![...r.tokens].some((t) => res.has(t))) blindRows.push({ row: r.name, line: r.line });
      for (const t of r.tokens) {
        const h = res.get(t);
        if (h && nonMerge.has(h) && !todoHeld.some((x) => x.sha === h && x.row === r.name)) todoHeld.push({ sha: h, row: r.name, line: r.line });
      }
    }
  }
  const holdMeta = commitMeta(cwd, [...new Set([...ledgerHeld, ...todoHeld].map((x) => x.sha))]);
  const withMeta = (x) => ({ ...(holdMeta.get(x.sha) || {}), ...x });

  const commits = inScope.map((h) => {
    const covered = how.get(h) || null;
    const src = covered?.kind === "patch" ? covered.via : h;
    const verdict = covered
      ? settle(src, verdictOf(src)) ?? { verdict: "(no verdict found)", dispositive: false }
      : null;
    return { sha: h, ...(meta.get(h) || {}), covered, noteLine: noteLine.get(h) ?? null, verdict };
  });
  return {
    range: pinned === range ? range : `${range} (${pinned.split("..").map((h) => h.slice(0, 9)).join("..")})`,
    total: all.length,
    // Every non-merge commit in the range: what a go entry's sha prefix is resolved against (THE OWNER'S GO).
    rangeShas: [...nonMerge],
    merges: all.length - nonMerge.size,
    outOfScope: nonMerge.size - inScope.length,
    commits,
    uncovered: commits.filter((c) => !c.covered && c.noteLine === null),
    noteOnly: commits.filter((c) => !c.covered && c.noteLine !== null),
    undisposed: commits.filter((c) => c.covered && !c.verdict.dispositive),
    foldCleared: commits.filter((c) => c.covered && c.verdict?.foldOf),
    counts: {
      sha: commits.filter((c) => c.covered?.kind === "sha").length,
      range: commits.filter((c) => c.covered?.kind === "range").length,
      patch: commits.filter((c) => c.covered?.kind === "patch").length,
    },
    foreignInRanges: [...foreignInRanges].filter((h) => !how.has(h)).length,
    rangesUnresolved,
    ledger: { rows, commits: bySha.size, ranges: ranges.length },
    holds: { ledger: ledgerHeld.map(withMeta), todo: todoHeld.map(withMeta), blind: blindRows, todoRead: holdRows !== null, todoRows: holdRows?.length ?? 0 },
  };
}

export function formatReport(res) {
  const L = [];
  const s9 = (h) => h.slice(0, 9);
  L.push(`review coverage — range ${res.range}: ${res.total} commits, ${res.commits.length} non-merge touching ${SCOPE_PATHS.join(" or ")}`
    + ` (${res.merges} merge, ${res.outOfScope} other out of scope); ledger ${res.ledger.rows} rows, ${res.ledger.commits} commits named, ${res.ledger.ranges} ranges`);
  for (const c of res.commits.filter((x) => x.covered?.kind === "patch")) {
    L.push(`  patch-id  ${s9(c.sha)}  = reviewed ${s9(c.covered.via)} (identical patch, landed under a new sha)  ${c.subject ?? ""}`.trimEnd());
  }
  const line = (tag, c, extra = "") =>
    `  ${tag}  ${s9(c.sha)}  ${c.date ?? "?"}  ${c.session ?? "(no Claude-Session)"}  ${extra}${(c.subject ?? "").slice(0, 110)}`;
  for (const c of res.noteOnly) L.push(line("NOTE ONLY", c, `ledger line ${c.noteLine}  `));
  for (const c of res.uncovered) L.push(line("NOT SENT ", c));
  for (const c of res.undisposed) {
    const why = c.verdict.reason
      ? `, ${c.verdict.reason}${c.verdict.noteLine ? ` (a Note cell names it with a clearing verdict: ledger line ${c.verdict.noteLine})` : ""}`
      : "";
    L.push(line("NOT DISPOSED", c, `newest row ${c.verdict.when ?? "?"} reads ${c.verdict.verdict}${why} (covered by ${c.covered.kind})  `));
  }
  for (const c of res.foldCleared ?? []) {
    const path = c.verdict.foldPath ?? [c.verdict.foldOf];
    const via = path.length > 1 ? `its fold ${path.map(s9).join(" → folded by ")}, the last of which reads` : `its fold ${s9(path[0])} reads`;
    L.push(line("FOLD-CLEARED", c, `newest own row reads ${c.verdict.foldedVerdict}; ${via} ${c.verdict.verdict} at ledger line ${c.verdict.line}  `));
  }
  for (const x of res.holds?.todo ?? []) L.push(line("HOLD     ", x, `open tracker row ${x.row} (todo line ${x.line})  `));
  for (const x of res.holds?.ledger ?? []) L.push(line("HOLD     ", x, `newest ledger row ${x.verdict.when ?? "?"} reads ${x.verdict.verdict}, no later clearing row  `));
  for (const r of res.holds?.blind ?? []) L.push(`  HOLD       tracker row ${r.row} (todo line ${r.line}) names no commit in its NAME or done-when line`);
  if (res.holds && !res.holds.todoRead) L.push("  (hold arm: todo.txt could not be read, so its open HUB-HOLD rows were NOT checked)");
  const covered = res.commits.length - res.uncovered.length - res.noteOnly.length;
  L.push(`  (verdict arm, warn-mode: ${res.undisposed.length} of ${covered} covered commits' newest naming ledger row is not dispositive,`
    + ` or reads ${[...NON_CLEARING].join(" / ")} with no later row naming the commit with a clearing verdict and no cleared fold`
    + `${res.undisposed.length ? " — the NOT DISPOSED lines" : ""}; until the hub's verdict-first backfill lands, a hub row whose`
    + " Verdict cell does not open with its verdict word reads non-dispositive here)");
  if (res.foreignInRanges) L.push(`  (${res.foreignInRanges} in-scope commits sit inside a ledger range but carry another session's trailer — not counted as covered by it)`);
  if (res.rangesUnresolved) L.push(`  (${res.rangesUnresolved} ledger ranges name a commit this repository cannot resolve — not expanded)`);
  const n = res.uncovered.length;
  const k = res.noteOnly.length;
  const m = res.commits.length;
  L.push(`REVIEW-COVERAGE: ${n || k ? `UNSENT ${n} NOTE-ONLY ${k}` : "CLEAN"} — ${n} of ${m} in-range ${SCOPE_PATHS.join(" + ")} commits`
    + ` are named in no review-ledger row, ${k} more only in a row's Note cell`
    + ` (covered by sha ${res.counts.sha}, by range ${res.counts.range}, by patch-id ${res.counts.patch})`);
  return L;
}

/** The refusal's grace: a never-sent commit younger than this is plausibly inside the coherent-batch review
 *  window (a session sends one request per finished piece of work), so it lists, excused. */
export const REFUSAL_GRACE_HOURS = 6; // a batch is held <=3 h and the hub's queue runs ~1 h, so 6 h covers both with margin
// A committer date further than this ahead of the clock is not trusted as "in flight": a future-dated commit
// would otherwise stay excused until the clock caught up with it.
const FUTURE_SKEW_MS = 10 * 60 * 1000;

/** The id of the go entry that passes the refusals no commit can name (THE OWNER'S GO in the header): `unmeasured:<items>`,
 *  each item `nothing` (nothing was measured), `todo` (todo.txt unreadable) or a hold row's NAME (it names no commit). */
export const GO_UNMEASURED = "unmeasured";
/** A go reason's KIND -> its words, 1:1 with the refusal kinds refusalDecision builds: `unsent` for a never-sent commit
 *  past the grace, one lowercase token per NON_CLEARING verdict left open, `hold` for an open hold. A Map, so a prototype
 *  key ("constructor", "__proto__") is an unknown kind like any other, never a match. */
export const GO_REASON_KINDS = new Map([
  ["unsent", "never sent"],
  ...[...NON_CLEARING].map((v) => [v.toLowerCase(), `${v} open`]),
  ["hold", "HOLD open"],
]);
// A reason's SOURCE (every kind but `unsent` has one): `r<8 hex>`, the content id (rowId) of the ledger row the refusal
// reads, or, for a hold, the open tracker row's full name (parseHoldRows' `HUB-HOLD-\S+`).
const LEDGER_SOURCE_RE = /^r[0-9a-f]{8}$/;
const TRACKER_SOURCE_RE = /^HUB-HOLD-\S+$/;
/** A go reason token -> `{kind, source}`, or null when it is not one: `unsent` bare, every other kind as
 *  `<kind>:<source>` (a ledger row's content id for any of them, a tracker row's name for `hold` only). */
export function parseReason(token) {
  const i = String(token).indexOf(":");
  const kind = i < 0 ? String(token) : String(token).slice(0, i);
  const source = i < 0 ? null : String(token).slice(i + 1);
  if (!GO_REASON_KINDS.has(kind)) return null;
  if (kind === "unsent") return source === null ? { kind, source } : null;
  if (source !== null && (LEDGER_SOURCE_RE.test(source) || (kind === "hold" && TRACKER_SOURCE_RE.test(source)))) return { kind, source };
  return null;
}
/** A reason token as the lines print it: "HOLD open from tracker row HUB-HOLD-…", "CHANGES-REQUESTED open from ledger
 *  line 412", "never sent". */
export function reasonWords(token) {
  const p = parseReason(token);
  if (!p) return String(token);
  const from = p.source === null ? "" : LEDGER_SOURCE_RE.test(p.source) ? ` from ledger row ${p.source}` : ` from tracker row ${p.source}`;
  return `${GO_REASON_KINDS.get(p.kind)}${from}`;
}
/** The one-line format a malformed go prints. */
export const GO_FORMAT = `PROMOTE_REVIEW_PROCEED="<sha>:<reason>+<reason> …" holds one entry per refusing commit the owner passed, as`
  + " the GO FOR WHAT IS SHOWN line prints it: the commit's id (7-40 hex, a prefix of its sha no other commit in the range"
  + " shares), a colon, and every reason the owner passed it for, joined by +: unsent, or <kind>:<source> for"
  + ` ${[...GO_REASON_KINDS.keys()].filter((k) => k !== "unsent").join(", ")}, one reason per source, the source being the`
  + " ledger row the refusal reads, by its content id as the REFUSES line prints it (r<8 hex>), or, for a hold, the tracker"
  + " row's full name (HUB-HOLD-…); commas or spaces"
  + ` between entries, plus one ${GO_UNMEASURED}:<items> entry only if the owner passed a refusal that is not a commit, each item as`
  + " the line prints it (nothing, todo, or the hold row's name)";

/** PROMOTE_REVIEW_PROCEED as read. Unset, empty or nothing but separators: null, no go (the gate as without one).
 *  Otherwise its raw `entries`, `commits` (each `<sha>:<reasons>` entry: `prefix` the 7-40 hex lowercased, `reasons` its
 *  tokens, each `unsent` or `<kind>:<source>` (parseReason); an entry repeating another exactly, case of the sha aside, is
 *  dropped), `unmeasured`: the items of its one `unmeasured:<items>` entry (an exact repeat is one; two distinct ones are
 *  both bad, as two entries for one commit name it by none), and `bad`: every entry that is none of these — a bare sha,
 *  the bare word, an empty or unknown reason, a kind without its source (`hold`, v1.19's form) or a source it cannot
 *  carry, the old "1". A go with a bad entry refuses whatever the range holds. */
export function parseGo(raw) {
  const entries = String(raw ?? "").split(/[\s,]+/).filter(Boolean);
  if (!entries.length) return null;
  const commits = [];
  const bad = [];
  const seen = new Set();
  const unmeasured = new Set();
  const uEntries = new Set(); // distinct unmeasured:<items> entries: more than one is malformed, like two for one commit
  for (const entry of entries) {
    // `unmeasured:<items>`: each item `nothing`, `todo` or a hold row's name (parseHoldRows' `HUB-HOLD-\S+`).
    const u = entry.match(new RegExp(`^${GO_UNMEASURED}:(.+)$`));
    const items = u ? u[1].split("+") : [];
    if (u && items.every((i) => i === "nothing" || i === "todo" || TRACKER_SOURCE_RE.test(i))) {
      for (const i of items) unmeasured.add(i);
      uEntries.add(entry);
      continue;
    }
    const m = entry.match(/^([0-9a-f]{7,40}):(.*)$/i);
    const reasons = m ? [...new Set(m[2].split("+"))] : [];
    if (!m || reasons.some((r) => !parseReason(r))) { bad.push(entry); continue; } // "" (empty reason) is unknown too
    const prefix = m[1].toLowerCase();
    const key = `${prefix}:${[...reasons].sort().join("+")}`;
    if (!seen.has(key)) commits.push({ entry, prefix, reasons });
    seen.add(key);
  }
  if (uEntries.size > 1) { bad.push(...uEntries); unmeasured.clear(); }
  return { entries, commits, unmeasured: [...unmeasured], bad };
}

/** The --refuse decision over analyze()'s result, pure. Refuses on (1) a never-sent commit whose COMMITTER date is
 *  older than `graceHours` (younger: `inFlight`, listed, excused; no readable date fails closed), (2) a commit
 *  whose newest verdict is a NON_CLEARING word with no later clearing row and no verified fold (`verdict.reason` set),
 *  whatever its age: a verdict exists, so it is not in review flight, and (3) a held commit (the hold arm). A NOTE ONLY
 *  commit does not refuse (a ledger note names it; the report lists it), nor does an undisposed commit whose newest row
 *  is merely unparsed. A null `res` (NOT-CHECKED) refuses: nothing was measured.
 *
 *  `go` is PROMOTE_REVIEW_PROCEED as read, never a default (THE OWNER'S GO in the header; parseGo). It passes the
 *  refusal only when exactly one entry names each refusing commit (resolved among every commit in the range, `rangeShas`)
 *  with every reason that commit refuses for now, each with its source (a new source of a kind the owner passed is a new reason), and
 *  carries one `unmeasured:<items>` entry naming each refusal that is not a commit. A null `res` is one of those: the owner's go
 *  passes an unmeasured run, through the entry's `nothing` item, because a commit list cannot name it. The PROCEEDING line names
 *  every commit and refusal it passed, so what
 *  the owner waves through is said out loud; a refusal carries `goShown`, the go for exactly what it shows. */
export function refusalDecision(res, { now = Date.now(), graceHours = REFUSAL_GRACE_HOURS, go = null } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const graceMs = graceHours * 3600 * 1000;
  const inFlight = [];
  const unsentRefusing = [];
  for (const c of res?.uncovered ?? []) {
    // Age runs from the OLDER of committer and author date (a rebase, cherry-pick or amend resets only the committer
    // date and must not re-open the grace); the future test reads the NEWER. NaN for a missing date fails both: refuses.
    const at = c.authoredAt ?? c.committedAt;
    const age = nowMs - Math.min(c.committedAt, at) * 1000;
    const newest = nowMs - Math.max(c.committedAt, at) * 1000;
    (newest > -FUTURE_SKEW_MS && age < graceMs ? inFlight : unsentRefusing).push(c);
  }
  const crOpen = (res?.undisposed ?? []).filter((c) => NON_CLEARING.has(c.verdict?.verdict)); // settle()'s own set, not its prose
  // The hold arm: an open HUB-HOLD row or a newest-row HOLD refuses, whatever the commit touches.
  // A result built without the arm (no `holds` key) reads as checked-and-empty; one whose todo.txt was unreadable refuses.
  const holds = res?.holds ?? { ledger: [], todo: [], todoRead: true };
  const holdBlind = holds.blind ?? [];
  const holdOpen = [...holds.todo.map((x) => ({ ...x, via: "tracker" })), ...holds.ledger.map((x) => ({ ...x, via: "ledger" }))];
  const reason = !res ? "nothing was measured"
    : `UNSENT ${unsentRefusing.length} past the ${graceHours} h grace (${inFlight.length} in flight, listed, excused)`
      + ` · UNCLEARED-VERDICT-OPEN ${crOpen.length} · HOLD-OPEN ${holdOpen.length}`
      + (holdBlind.length ? ` · HOLD-ROW-NAMES-NO-COMMIT ${holdBlind.length}` : "")
      // How many commits cleared through a fold rather than their own row, so the owner sees it on the summary line
      // (26 commits on one range once cleared this way and the token line said nothing).
      + (res.foldCleared?.length ? ` · FOLD-CLEARED ${res.foldCleared.length}` : "")
      + (holds.todoRead ? "" : " · the hold rows could not be read");
  // Every refusing commit once, with each reason it refuses for (a commit can be never sent AND held): `reasons` the go's
  // tokens, `kinds` the same reasons as the lines print them. A reason with a source is one token PER SOURCE — the
  // CHANGES-REQUESTED / UNRESOLVED row's content id, each tracker row's name, the ledger HOLD row's content id — so a
  // second hold row, a new ledger HOLD or a newer non-clearing row on a commit the owner passed is a new reason (content
  // ids since v1.21 — a note the hub appends to a row's Note cell is the same source, a new verdict row
  // is not). A missing id (unreachable: parseLedgerRefs stamps every row) prints `r?`, which no go can carry:
  // it refuses. Two rows in this run with the same id and different keys (an 8-hex collision) refuse as `goCollision`
  // whatever the go says: an id that names two rows names neither.
  const bySha = new Map();
  const add = (c, token) => {
    const r = bySha.get(c.sha) ?? { sha: c.sha, kinds: [], reasons: [] };
    if (!r.reasons.includes(token)) { r.reasons.push(token); r.kinds.push(reasonWords(token)); }
    bySha.set(c.sha, r);
  };
  const rowKeys = new Map(); // ledger source token -> the distinct row keys (rowKey) behind it: one, unless two rows collide
  const ledgerSource = (c, kind, v) => {
    const token = `${kind}:r${v?.id ?? "?"}`;
    if (!rowKeys.has(token)) rowKeys.set(token, new Set());
    rowKeys.get(token).add(String(v?.key ?? ""));
    add(c, token);
  };
  for (const c of unsentRefusing) add(c, "unsent");
  for (const c of crOpen) ledgerSource(c, c.verdict.verdict.toLowerCase(), c.verdict);
  for (const c of holdOpen) (c.via === "tracker" ? add(c, `hold:${c.row}`) : ledgerSource(c, "hold", c.verdict));
  const goCollision = [...rowKeys].filter(([, keys]) => keys.size > 1).map(([token, keys]) => ({ token, keys: [...keys] }));
  const refusing = [...bySha.values()];
  // The refusals that are not a commit, so no sha in the go can name them.
  // `key` is the go item that passes it (the hold row's own name for a nameless row, so a new one is a new item).
  const unmeasuredItems = [...(res ? [] : [{ key: "nothing", text: "nothing was measured" }]),
    ...(holds.todoRead ? [] : [{ key: "todo", text: "the hold rows could not be read" }]),
    ...holdBlind.map((r) => ({ key: r.row, text: `hold row ${r.row} names no commit` }))];
  const unmeasured = unmeasuredItems.map((u) => u.text);
  const wouldRefuse = refusing.length + unmeasured.length > 0;

  // The owner's go: each entry names the ONE commit IN THE RANGE its sha prefixes — every non-merge commit (`rangeShas`),
  // not only the ones refusing now, or an entry given for A would name B once A cleared and B, sharing A's prefix, began
  // refusing. One that prefixes two range commits names neither, since a prefix cannot say which
  // the owner saw; one naming a commit that no longer refuses is unused, not an error. A commit passes only when exactly one entry
  // names it and that entry carries every reason the commit refuses for now: a reason that arrived after the owner answered,
  // including a new source of a kind the owner passed, refuses by itself. A result built without `rangeShas` (a test's literal)
  // resolves against its refusing commits.
  const g = parseGo(go);
  const refusingBy = new Map(refusing.map((r) => [r.sha, r]));
  const rangeShas = [...new Set([...(res?.rangeShas ?? []), ...refusingBy.keys()])];
  const hits = (g?.commits ?? []).map((e) => ({ ...e, matches: rangeShas.filter((h) => h.toLowerCase().startsWith(e.prefix)) }));
  const namedBy = new Map(); // refusing sha -> the entries naming it alone
  for (const h of hits) if (h.matches.length === 1 && refusingBy.has(h.matches[0])) namedBy.set(h.matches[0], [...(namedBy.get(h.matches[0]) ?? []), h]);
  const goAmbiguous = hits.filter((h) => h.matches.length > 1 && h.matches.some((s) => refusingBy.has(s)))
    .map((h) => ({ entry: h.entry, shas: h.matches }));
  const goUnused = [...hits.filter((h) => !h.matches.some((s) => refusingBy.has(s))).map((h) => h.entry),
    ...(g?.unmeasured ?? []).filter((k) => !unmeasuredItems.some((u) => u.key === k)).map((k) => `${GO_UNMEASURED}:${k}`)];
  const goMalformed = g?.bad ?? [];
  const notInGo = []; // each refusing commit the go does not pass, with `why`: unnamed, twice (two entries), newReason
  const goStale = []; // reasons an entry carries that its commit no longer refuses for: harmless, listed
  if (g) {
    for (const r of refusing) {
      const by = namedBy.get(r.sha) ?? [];
      if (!by.length) { notInGo.push({ ...r, why: "unnamed" }); continue; }
      if (by.length > 1) { notInGo.push({ ...r, why: "twice", entries: by.map((e) => e.entry) }); continue; }
      const [e] = by;
      const stale = e.reasons.filter((t) => !r.reasons.includes(t));
      if (stale.length) goStale.push({ entry: e.entry, sha: r.sha, reasons: stale });
      const missing = r.reasons.filter((t) => !e.reasons.includes(t));
      if (missing.length) notInGo.push({ ...r, why: "newReason", missing, passedFor: e.reasons });
    }
  }
  const unmeasuredNotInGo = g ? unmeasuredItems.filter((u) => !g.unmeasured.includes(u.key)).map((u) => u.text) : [];
  const covered = !!g && !goMalformed.length && !notInGo.length && !unmeasuredNotInGo.length && !goCollision.length;
  const refuse = goMalformed.length > 0 || (wouldRefuse && !covered);
  // The go for exactly what a refusal shows, ready to copy: each refusing commit at the shortest prefix of 9+ hex that no
  // other commit in the range shares (so it names that commit alone), with every reason it refuses for, each with its
  // source, plus one unmeasured:<items> entry for the refusals that are not a commit. Fed back against the same input, it
  // passes. Nothing refusing in the range, or a row-id collision (which no go passes): none.
  const goPrefix = (h) => {
    let n = 9;
    while (n < h.length && rangeShas.some((o) => o !== h && o.toLowerCase().startsWith(h.slice(0, n).toLowerCase()))) n++;
    return h.slice(0, n).toLowerCase();
  };
  const goShown = refuse && wouldRefuse && !goCollision.length
    ? [...refusing.map((r) => `${goPrefix(r.sha)}:${r.reasons.join("+")}`), ...(unmeasuredItems.length ? [`${GO_UNMEASURED}:${unmeasuredItems.map((u) => u.key).join("+")}`] : [])].join(" ")
    : null;
  return {
    nowMs, graceHours, go: g, wouldRefuse,
    // The decision carries its own inputs, so formatRefusal and the fire row READ it and never re-derive it.
    refuse,
    proceeded: wouldRefuse && covered,
    unsentRefusing, inFlight, crOpen, holdOpen, holdBlind, refusing, unmeasured, unmeasuredItems,
    notInGo, unmeasuredNotInGo, goMalformed, goAmbiguous, goUnused, goStale, goCollision, goShown, reason,
  };
}

/** The --refuse lines: one per refusing and per in-flight commit, the go's lines, the go for what is shown when it
 *  refuses, then the ONE `REVIEW-COVERAGE-GATE:` token line. A function of the decision alone: the token can never
 *  disagree with `dec.refuse`, which sets the exit code. */
export function formatRefusal(dec) {
  const { nowMs, graceHours } = dec;
  const s9 = (h) => h.slice(0, 9);
  const hours = (c) => (Number.isFinite(c.committedAt) ? `${Math.floor((nowMs - c.committedAt * 1000) / 3_600_000)} h` : "? h");
  const line = (tag, c, what) =>
    `  ${tag}  ${s9(c.sha)}  ${c.date ?? "?"}  ${c.session ?? "(no Claude-Session)"}  ${what}  ${(c.subject ?? "").slice(0, 110)}`;
  const kindsOf = (tokens) => tokens.map(reasonWords).join(", ");
  const L = [];
  for (const c of dec.unsentRefusing) L.push(line("REFUSES  ", c, `never sent, committed ${hours(c)} ago, past the ${graceHours} h grace`));
  for (const c of dec.crOpen) {
    const note = c.verdict.noteLine ? ` (a Note cell names it with a clearing verdict: ledger line ${c.verdict.noteLine})` : "";
    L.push(line("REFUSES  ", c, `${c.verdict.verdict} open: newest row ${c.verdict.when ?? "?"} (ledger row r${c.verdict.id ?? "?"}, line ${c.verdict.line ?? "?"}) reads ${c.verdict.verdict}, ${c.verdict.reason}${note}`));
  }
  for (const c of dec.holdOpen ?? []) {
    L.push(line("REFUSES  ", c, c.via === "tracker" ? `HOLD open: tracker row ${c.row} (todo line ${c.line})`
      : `HOLD open: newest ledger row ${c.verdict.when ?? "?"} (ledger row r${c.verdict.id ?? "?"}, line ${c.verdict.line ?? "?"}) reads ${c.verdict.verdict}, no later clearing row`));
  }
  for (const r of dec.holdBlind ?? []) {
    L.push(`  REFUSES    tracker row ${r.row} (todo line ${r.line}) names no commit in its NAME or done-when line, so what it holds cannot be read: put every held sha on its done-when line`);
  }
  for (const c of dec.inFlight) L.push(line("IN FLIGHT", c, `never sent, committed ${hours(c)} ago, inside the ${graceHours} h grace (listed, excused)`));
  for (const x of dec.goCollision ?? []) {
    L.push(`  REFUSES    ledger row id ${x.token.slice(x.token.indexOf(":") + 1)} belongs to ${x.keys.length} different rows in this run (${x.keys.join(" / ")}), so a go naming it names neither: append a new row for one of them`);
  }
  if (dec.go && dec.goMalformed.length) {
    // Over a range where nothing refuses there is no go to print, so the line says what to do.
    L.push(`  GO REFUSED  PROMOTE_REVIEW_PROCEED carries ${dec.goMalformed.map((e) => JSON.stringify(e)).join(", ")}, which is not a <sha>:<reasons> or ${GO_UNMEASURED}:<items> entry (a bare sha, the bare word ${GO_UNMEASURED} and the go "1" are retired): ${GO_FORMAT}`
      + (dec.wouldRefuse ? "" : " — nothing in this range refuses: run it with PROMOTE_REVIEW_PROCEED unset"));
  } else if (dec.go) {
    for (const a of dec.goAmbiguous) L.push(`  NOT IN YOUR GO: ${a.entry} prefixes ${a.shas.length} commits in this range (${a.shas.map(s9).join(", ")}), so it names none of them: write more of each sha`);
    for (const r of dec.notInGo) {
      L.push(r.why === "newReason"
        ? `  NOT IN YOUR GO: ${s9(r.sha)} (${kindsOf(r.missing)} — you passed it for: ${kindsOf(r.passedFor)}) — a reason the owner did not pass it for: show the owner this line and ask again`
        : r.why === "twice"
          ? `  NOT IN YOUR GO: ${s9(r.sha)} (${r.kinds.join(", ")}) — named by ${r.entries.length} entries of the go (${r.entries.join(", ")}), so by none: one entry per commit, with every reason the owner passed`
          : `  NOT IN YOUR GO: ${s9(r.sha)} (${r.kinds.join(", ")}) — not among the commits the owner named: show the owner this line and ask again`);
    }
    for (const u of dec.unmeasuredNotInGo) {
      const key = dec.unmeasuredItems.find((x) => x.text === u)?.key;
      L.push(`  NOT IN YOUR GO: ${u} — a refusal that is not a commit, so no sha can name it: only an ${GO_UNMEASURED}:<items> entry carrying ${key} passes it, on the owner's word`);
    }
    for (const e of dec.goUnused) L.push(`  (in the go, refusing nothing in this run: ${e})`);
    for (const s of dec.goStale ?? []) L.push(`  (in the go, ${s.entry}: ${s9(s.sha)} no longer refuses for ${s.reasons.join("+")} in this run)`);
  }
  if (dec.goShown) L.push(`  GO FOR WHAT IS SHOWN (set only on the owner's explicit proceed): PROMOTE_REVIEW_PROCEED="${dec.goShown}"`);
  const passed = [...dec.refusing.map((r) => `${s9(r.sha)} (${r.kinds.join(", ")})`),
    ...(dec.unmeasured.length ? [`${GO_UNMEASURED} (${dec.unmeasured.join("; ")})`] : [])].join(", ");
  const tail = !dec.go ? "" : dec.goMalformed.length ? " · YOUR GO IS MALFORMED"
    : ` · NOT IN YOUR GO ${dec.notInGo.length + dec.unmeasuredNotInGo.length}`;
  const collide = dec.goCollision?.length ? ` · LEDGER-ROW-ID-COLLISION ${dec.goCollision.length}` : "";
  L.push(dec.refuse ? `REVIEW-COVERAGE-GATE: REFUSED — ${dec.reason}${collide}${tail}`
    : dec.proceeded ? `REVIEW-COVERAGE-GATE: PROCEEDING ON THE OWNER'S GO — would have REFUSED: ${dec.reason} — passed on the owner's go: ${passed}`
      : `REVIEW-COVERAGE-GATE: PASS — ${dec.reason}`);
  return L;
}

const USAGE = "usage: node scripts/promote-review-coverage.mjs [--range <base>..<head>] [--ledger <path>] [--todo <path>] [--refuse]";

function main() {
  const argv = process.argv.slice(2);
  let range = "origin/main..dev";
  let ledgerPath = null;
  let todoPath = null;
  let refuseMode = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--range" && argv[i + 1]) range = argv[++i];
    else if (a === "--ledger" && argv[i + 1]) ledgerPath = argv[++i];
    else if (a === "--todo" && argv[i + 1]) todoPath = argv[++i];
    else if (a === "--refuse") refuseMode = true;
    else if (a === "--help" || a === "-h") { console.log(USAGE); return 0; }
    else { console.error(`promote-review-coverage: unknown or incomplete argument ${JSON.stringify(a)}\n${USAGE}`); return 2; }
  }
  const cwd = process.cwd();
  let res = null;
  try {
    if (!ledgerPath) {
      // The SHARED checkout's ledger, also from a hotfix worktree whose own copy is main's, i.e. stale.
      const common = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
      ledgerPath = join(dirname(common), ".claude", "docs", "review-ledger.md");
    }
    const ledgerText = readFileSync(ledgerPath, "utf8");
    // The hold rows come from the SHARED checkout's tracker too; an unreadable one is passed as null, which refuses.
    if (!todoPath) todoPath = join(dirname(ledgerPath), "..", "..", "todo.txt");
    let todoText = null;
    try { todoText = readFileSync(todoPath, "utf8"); } catch { /* null: the hold arm reports it and --refuse refuses */ }
    for (const l of formatReport((res = analyze({ cwd, range, ledgerText, todoText })))) console.log(l);
  } catch (e) {
    const why = String(e?.stderr || e?.message || e).split("\n").find(Boolean) || "unknown error";
    console.log(`REVIEW-COVERAGE: NOT-CHECKED — nothing was measured (${why.slice(0, 200)})`);
  }
  // --refuse: the owner's go is PROMOTE_REVIEW_PROCEED in the environment, one `<sha>:<reasons>` entry per commit the owner
  // passed (THE OWNER'S GO), never a default.
  const goRaw = process.env.PROMOTE_REVIEW_PROCEED;
  let dec = null;
  let rc = 0;
  if (refuseMode) {
    dec = refusalDecision(res, { now: Date.now(), go: goRaw });
    for (const l of formatRefusal(dec)) console.log(l);
    if (dec.refuse) rc = 4;
  }
  // One row per run, clean and NOT-CHECKED (null counts) included, in the shared checkout's .claude/logs (beside the
  // ledger it read), so a later warn-to-block bar for the refusal has a denominator. Reporting only.
  // ⚠️ `via` is the bar's population key: promote-precheck.sh sets PROMOTE_COVERAGE_VIA=precheck, /promote step 5's
  // re-check before "merge it?" sets promote-step5, and step 6's re-check inside the merge call sets promote-step6 (the
  // same promote read a second and third time, so a bar counting promotes counts `precheck` rows; a refused
  // `promote-step5` row is something that began refusing during CI, a refused `promote-step6` row something that began
  // refusing while the owner was answering "merge it?"). Every other run —
  // a hand run, a test, a run from a `git worktree add` tree (the common dir resolves to the SAME shared log) — lands as
  // "manual" in the same file. A future warn→block bar counts `via: "precheck"` rows only; a manual row is not a promote
  // and must not inflate the denominator or the fire count.
  // `refused` is the gate's own reading BEFORE the owner's go (null without --refuse); `proceed` says whether the owner's go
  // passed it (false without --refuse), and `go` holds the go's entries as read (null when unset). So refused:true +
  // proceed:true is a range the gate refused and the owner passed; exit 4 iff refused && !proceed, or the go carries an entry
  // that is not a `<sha>:<reasons>` or `unmeasured:<items>` entry.
  try {
    // PROMOTE_COVERAGE_LOG_DIR: an auditor or a fixture run (a panel seat was once told
    // this script was read-only and declined to run it because every run appends here) points the row
    // elsewhere. Unset, the row lands in the shared checkout's log as before.
    const dir = process.env.PROMOTE_COVERAGE_LOG_DIR
      || join(dirname(git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim()), ".claude", "logs");
    const sid = process.env.CLAUDE_CODE_SESSION_ID || null, n = (k) => res?.[k].length ?? null;
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "promote-review-coverage-fires.jsonl"), `${JSON.stringify({ ts: Math.floor(Date.now() / 1000), range: res?.range ?? range,
      commits: n("commits"), unsent: n("uncovered"), noteOnly: n("noteOnly"), undisposed: n("undisposed"), foldCleared: n("foldCleared"),
      holds: res ? res.holds.ledger.length + res.holds.todo.length : null, session: sid?.slice(0, 8) ?? null, sid, via: process.env.PROMOTE_COVERAGE_VIA || "manual",
      refused: dec?.wouldRefuse ?? null, proceed: dec?.proceeded ?? false, go: parseGo(goRaw)?.entries ?? null })}\n`);
  } catch { /* best-effort: a log failure never changes the output or the exit code */ }
  return rc;
}

if (isMain(import.meta.url)) process.exit(main());
