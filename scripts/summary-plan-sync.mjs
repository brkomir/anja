#!/usr/bin/env node
/**
 * summary-plan-sync — sync the DERIVED-state fence in this session's working plan.
 *
 * This is the WRITE half of /summary, and it is permitted to override that
 * command's own "No writes" anti-scope, so the boundary is enforced HERE rather than
 * left to prose:
 *
 *   · It rewrites EXACTLY ONE fenced block and never a byte outside it.
 *   · It writes ONLY when the derived block differs from what is on disk (idempotent —
 *     running /summary twice does what running it once does).
 *   · It writes MEASUREMENTS it derived, never judgment. Lessons, decisions and memory
 *     stay /wrap's, which is the distinction the anti-scope was actually guarding.
 *
 * ⛔ WHY THE FENCE CARRIES SEAT-SCOPED ROW STATE AND NOT FLEET NUMBERS. The obvious
 * content — unpushed count, HEAD sha, dirty count — is wrong here and the determinism
 * clause is what exposes it: measured 2026-08-25, this tree took 13 commits in one hour,
 * so a block carrying any fleet number would differ on almost every run. "Write only when
 * changed" would then never fire and the command becomes always-writes, which is the
 * churn the clause exists to prevent. Seat-scoped row state moves only when THIS seat
 * files or closes something. Fleet numbers belong in the READOUT, where they are true at
 * the moment they are read and meaningless later.
 *
 * Usage:  node scripts/summary-plan-sync.mjs [--check] [--sid <8hex>] [--plan <path>]
 *         node scripts/summary-plan-sync.mjs --self-test
 *   --check   report only, never write. Exit 0 = current, 3 = would change.
 *   --help    print this and exit 0. Never writes.
 *   default   sync. Prints one verdict token: CURRENT | UPDATED | NO-PLAN, or REFUSED (exit 1) when
 *             the plan changed while the sync ran.
 *
 * An UNRECOGNISED argument is REJECTED (exit 2), never ignored. Until
 * 2026-08-31 only --self-test and --check were ever tested, so every other
 * token fell through to the write: `--help` WROTE the plan file, and so did a
 * typo'd `--chek`. The typo is the likelier one — a hurried hand produces it
 * while reaching for the read-only mode, which is the exact intent the
 * fall-through inverts.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { isMain as isMainModule } from "./lib/is-main.mjs";
// ⛔ IMPORTED, NOT RE-DERIVED. The disposition predicate here was
// SIGNAL-ONLY and missed more than it caught: re-derived on my own inbox, 34 dispositive
// mails sit outside `review-verdict` against 25 inside it. `answersByClass` is the fleet's
// mature form — subject-shape OR typed signal, with a REJECT-FIRST guard so a mail that is
// both request- and verdict-shaped reads as the request — and its own header records the
// separator fold (`FOLD[- ]VERIF` as a stem) that my review hit independently. Two seats had
// already written this predicate; a third copy would have been the drift, not the fix.
// Probed before adopting: importing it has no side effects (it carries a main guard), and on
// my six real cases it returns true for the three missed dispositions and false for an ack,
// a request and an INTERIM — the last being where a hand-rolled retry measurably failed.
import { answersByClass } from "./review-request-closure-scan.mjs";
// Rolls a plan past 200,000 bytes into `-partN.md` files at this sync (scripts/plan-roll.mjs header).
import { partNumbersOnDisk, rollText, rollWords } from "./plan-roll.mjs";

export const BEGIN = "<!-- SUMMARY-SYNC:BEGIN — derived by /summary. Hand edits INSIDE this fence are overwritten; everything outside it is yours. -->";
export const END = "<!-- SUMMARY-SYNC:END -->";

/** Split todo.txt into row BLOCKS. Row bodies run many lines and the provenance that
 *  names a seat usually sits on a continuation line — a line-scoped scan under-reports
 *  by ~16x (measured; see /summary section 4). */
export function splitRows(todoText) {
  const rows = [];
  let cur = null;
  for (const line of todoText.split("\n")) {
    // `[^]]*` not `[ x]`: todo.txt carries SIX checkbox forms, not two — 1553 `[ ]`, 728 `[x]`,
    // 14 `[~]`, 2 `[REJECTED <date>]`, 1 `[note]`, 1 `[P3]` (measured 2026-09-05). A `[ x]`-only
    // anchor is not merely blind to the other 18: this is a row SPLITTER, so an unmatched row's
    // lines are appended to the PREVIOUS row's block and its `filed:`/`owner:` fields are
    // attributed to the wrong row. Reaches 2281 of 2299 before this fix, 2299 after.
    if (/^- \[[^\]]*\] /.test(line)) {
      if (cur) rows.push(cur);
      cur = [line];
    } else if (cur) cur.push(line);
  }
  if (cur) rows.push(cur);
  return rows.map((r) => r.join("\n"));
}

/** Rows whose BLOCK names this seat as filer or owner.
 *  ⛔ FAILURE 9 (`/summary` SKILL.md §4/§5 shipped the same fix first, 2026-09-03). The retired
 *  `filed:[^|\n]*by <sid>\b` form was greedy ACROSS the row line: it also matched a row a PEER
 *  filed whose provenance line merely CREDITS this seat later in a parenthetical
 *  (`filed: … by <peer> (reported by <this-seat> …)`), claiming a row that is not ours. The
 *  shaped form below says what the field IS — the filer is the token right after the date —
 *  instead of budgeting characters; because it admits only `\s`/digits/hyphens between `filed:`
 *  and `by`, it also subsumes the earlier multi-line-crossing fix (measured 2026-08-19) with no
 *  negated-newline class — unrelated prose in between breaks the digit/hyphen run and the match
 *  fails on its own. */
export function rowsNamingSeat(todoText, sid) {
  if (!/^[0-9a-f]{8}$/.test(sid || "")) throw new Error(`bad sid: ${JSON.stringify(sid)}`);
  const esc = sid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // ⛔ ONLY THE `owner:` ARM IS BOUNDED AT BOTH ENDS — this comment claimed BOTH were until
  // 2026-09-08 and that was false against the regex three lines below it.
  // The `owner:` arm has a leading AND trailing `\b`: without the trailing one a sid is a PREFIX
  // match (`owner: aaaa1111ff` claims `aaaa1111`), and without the leading one the substring
  // inside `downer:` matches. The `filed:` arm carries the TRAILING `\b` only, so `refiled:`,
  // `unfiled:`, `re-filed:` and `not-filed:` all claim the row. Latent, not live — all four
  // spellings exist in the corpus and none is followed by `by <8hex>` — and pre-existing rather
  // than introduced here, but the comment sat directly above the lines this commit rewrote,
  // which is how a false claim survives a diff that touches it. Fix it by anchoring the `filed:`
  // arm, not by re-widening the comment.
  const pat = new RegExp(`filed:\\s*[0-9-]*\\s*by ${esc}\\b|\\bowner: *${esc}\\b`);
  // ⛔ NOT `([A-Z0-9-]+)` — that capture stops at the first lowercase letter, so a row named
  // in prose reads as its first ALLCAPS-ish fragment: `THE CELL CLAUSE FIRES…` -> `THE`,
  // `ONE OBLIGATION STATED…` -> `ONE`. Measured 2026-09-01 on this seat's own fence: 4 of 6
  // labels came out as `ONE` / `THE` / `TWO` / `SHOULD`, which name nothing. The spec
  // (`summary/SKILL.md` §4) documents the same bug and carries the corrected `row_label`;
  // this is that function. ⛔ **AND `scripts/summary-owner-predicate-check.py` DOES NOT STOP THE
  // TWO DRIFTING — this comment said it did until 2026-09-08.** Measured:
  // that checker contains ZERO references to `summary-plan-sync` and ZERO to `.mjs` (positive
  // control: `FILED_BY` returns 7). It extracts both predicate definitions from the SPEC's two
  // sections and compares them TO EACH OTHER — spec-section versus spec-section. SPEC versus
  // SCRIPT is guarded by nothing, so editing the predicate here alone leaves every instrument
  // green while the two diverge, which is precisely the drift this file's FAILURE 9 fix repaired.
  // Take a real row ID when there is one, else truncate the prose.
  // ⚠️ NO `$` ANCHOR. `splitRows` yields the whole multi-LINE row block, and without the `m`
  // flag `$` means end-of-STRING while `.` never crosses a newline — so an anchored form
  // matches NOTHING and every label reads `(none)`. Caught by a self-test
  // (4 FAILED) on the first attempt at this fix, 2026-09-01. `.*` stops at the newline anyway.
  const rowName = /^- \[[^\]]*\] (.*)/;   // six checkbox forms — see splitRows
  const rowId = /^[A-Z0-9][A-Z0-9-]{3,}(?=\s|$)/;
  const name = (r) => {
    const m = r.match(rowName);
    if (!m) return null;
    const rest = m[1].trim();
    if (!rest) return null;
    const t = rest.match(rowId);
    return t ? t[0] : rest.slice(0, 60) + (rest.length > 60 ? "..." : "");
  };
  const open = [], closed = [];
  for (const r of splitRows(todoText)) {
    if (!pat.test(r)) continue;
    const n = name(r);
    if (!n) continue;
    (r.startsWith("- [ ] ") ? open : closed).push(n);
  }
  return { open: [...new Set(open)].sort(), closed: [...new Set(closed)].sort() };
}

// The ledger parser — vocabulary, normalisation, sha extraction, newest-row-wins parse and the
// prefix lookup — moved to `lib/review-ledger.mjs` on 2026-09-22 so this file and the closure scan
// read the ledger ONE way. Re-exported so every existing caller and self-test arm is unchanged.
// ⛔ It also changed HOW a row is classified: on its LEADING disposition, with an arrival-word list,
// never on a verdict word found anywhere in the cell. That fixes
// this file's plan fence too: an "ARRIVED … FOLD-VERIFY OWED" row used to render as LEDGERED.
export { VERDICT_WORDS, DISPOSITIVE_VERDICTS, ARRIVAL_WORDS, normalizeVerdictText, extractShas,
         parseLedgerShas, lookupSha, classifyVerdictCell } from "./lib/review-ledger.mjs";
import { extractShas, parseLedgerShas, lookupSha } from "./lib/review-ledger.mjs";

/** Shas this seat has FOLDED, read off its own commit SUBJECTS. PURE — subjects injected.
 *
 *  ⛔ ANCHOR ON `on <sha>`, NEVER ON LOOSE HEX IN THE PARENTHETICAL. The house subject is
 *  `fold(hub <reviewer-sid> verdict on <sha>): …` and that parenthetical carries TWO hex
 *  tokens — the reviewer's 8-hex SESSION ID and the sha. A bare `[0-9a-f]{7,40}` sweep takes
 *  both, and `gitCommitFilter` cannot always reject the session id because an 8-hex prefix
 *  can resolve to a real commit; it would surface as an ambiguous-prefix row at best and a
 *  wrong sha at worst. The `on ` anchor removes the collision by construction.
 *
 *  ⚠️ It is a FLOOR, like every other input to this section: a fold whose subject does not
 *  follow the convention is not counted. That is the same trade the mail-subject scan makes
 *  one function down, for the same reason — a body scan answers a different question. */
export function parseFoldShas(subjects = []) {
  const out = [];
  for (const s of subjects) {
    if (!s.startsWith("fold(")) continue;
    // NO HEAD TRUNCATION. The `on ` anchor removes the session-id collision BY
    // CONSTRUCTION -- fleet-wide 396 captured tokens, 396 resolve, 0 ambiguous. Slicing at the
    // close paren bought nothing and dropped the house form `fold(<scope>): ... on <sha>`:
    // 36 distinct tokens recovered, 36 of 36 real commits, ZERO false positives, three
    // independent measurements. It also un-vacuums the guard arm below, whose fixture paren
    // used to eat its own sha (0 with the guard and 0 without it = a decorative arm).
    for (const m of s.matchAll(/\bon\s+([0-9a-f]{7,40})\b/g)) out.push(m[1]);
  }
  return out;
}

/** The review-state rows. PURE — every IO is injected, so the self-test never touches
 *  the mail store, the ledger, or git.
 *
 *  Precedence is the whole point, and state 2 is why this function exists. The failure it
 *  was built for (2026-09-12): a hand-typed plan cell read "with the hub" 37
 *  minutes after the verdict had landed in this seat's own mail store, and a reader acted
 *  on the stale row. That is state 2 — the verdict exists, the durable ledger has not
 *  caught up, and a human writing the cell from memory cannot see the gap.
 *
 *  State 3 is the doctrine's named trap: an ACK names the sha and disposes of NOTHING, so
 *  every sha-keyed instrument scores it answered. It gets its own state rather than being
 *  folded into either neighbour.
 */
export function deriveReviewRows({ requestShas = [], verdictShas = [], ackShas = [], foldShas = [], ledger = new Map(), isCommit = () => true }) {
  const V = new Set(verdictShas), A = new Set(ackShas), F = new Set(foldShas);
  const rows = [];
  // ⛔ THE FOLD SET IS UNIONED INTO THE CANDIDATES, NOT JUST CONSULTED — otherwise the case this
  // exists for is unreachable. A request whose mail aged out of the store is ABSENT from
  // `requestShas`, so it gets no row at all and the section reads CLEAN by omission. Measured
  // 2026-09-21: request sent 08:33Z, verdict folded 52 minutes
  // later, and 25 h on BOTH trackers had lost it — the hub kept an INTERIM ledger row and lost
  // the answer to the TTL, this fence dropped the request to the same TTL, and the hub filed a
  // false failure against itself and re-dispatched a four-lens panel. git is the one plane the
  // TTL cannot reach.
  // THE FOLD PLANE IS A RECOVERY SOURCE, NEVER AN ADDITIONAL EVIDENCE SOURCE (a review
  // REFUTED the "it is additive" belief I shipped in this file's own commit message).
  // `mergeMonotone` retires a row by its ABSENCE from the fresh derivation, and a fold sha is
  // durable by design, so it is present on EVERY run and the retirement below is structurally
  // unreachable for exactly the rows it was written for. Measured on the heaviest reviewer seat:
  // 18 already-APPROVED loops pinned permanently into a section whose whole job is what is still
  // OUTSTANDING. MY OWN SEAT IS THE FLEET'S BEST CASE BY CONSTRUCTION -- zero of my fold shas are
  // dispositively ledgered, so the pin cannot bite here and one-seat measurement could not see it.
  const foldRecoverable = foldShas.filter((f) => !lookupSha(ledger, f)?.dispositive);
  for (const sha of [...new Set([...requestShas, ...foldRecoverable])].sort()) {
    if (!isCommit(sha)) continue;                       // git is the oracle, not the regex
    const led = lookupSha(ledger, sha);
    // The fold is the one evidence kind where ADDING it used to LOWER the row and erase
    // itself. The RE-RANK below is the load-bearing half; this note keeps the two planes'
    // DISAGREEMENT visible, which is the most valuable bit in the row. `detail` is not ranked.
    const foldNote = F.has(sha) ? " · a fold commit of mine also names it" : "";
    // ⛔ A LEDGER ROW IS NOT A DISPOSITION. An INTERIM / ACKED / KEEP / unparsed row
    // means the loop is still OPEN and someone wrote it down — 11 of 192 live shas — so it gets
    // its own cell rather than borrowing LEDGERED's, which reads as closed. If the mail plane
    // shows a real verdict for such a sha, that OUTRANKS the non-dispositive row.
    if (led && !led.dispositive && (V.has(sha) || A.has(sha))) {
      rows.push({ sha, state: V.has(sha) ? "VERDICT-ON-MAIL-ONLY" : "LEDGERED-NO-DISPOSITION",
                  detail: (V.has(sha) ? `ledger row says ${led.verdict}; a verdict is on the mail plane`
                                      : `${led.verdict} · ${led.reviewer} — settles nothing`) + foldNote });
    }
    else if (led && !led.dispositive) rows.push({ sha, state: "LEDGERED-NO-DISPOSITION", detail: `${led.verdict} · ${led.reviewer} — settles nothing${foldNote}` });
    else if (led) rows.push({ sha, state: "LEDGERED", detail: `${led.verdict} · ${led.reviewer}` });
    else if (V.has(sha)) rows.push({ sha, state: "VERDICT-ON-MAIL-ONLY", detail: "answered, NOT yet in the ledger" });
    else if (A.has(sha)) rows.push({ sha, state: "ACKED-NOT-DISPOSED", detail: "an ack names it and disposes of nothing" });
    // A fold commit is THIS SEAT asserting it received and folded a verdict, on a plane no TTL
    // prunes — you cannot fold a verdict you never got. Weaker than LEDGERED (that is the
    // REVIEWER's record) and stronger than a mail-plane verdict that will expire.
    else if (F.has(sha)) rows.push({ sha, state: "FOLDED-IN-COMMIT", detail: "a fold commit of mine names it — durable, survives the mail TTL" });
    else rows.push({ sha, state: "PENDING", detail: "sent, nothing back on either plane" });
  }
  return rows;
}

/** The fence body. The TRACKER half is DETERMINISTIC BY CONSTRUCTION: no timestamps, no
 *  relative dates, no fleet counts — only sorted, de-duplicated seat-scoped row names. Two
 *  runs with no intervening change produce byte-identical output, which is what makes the
 *  write-only-when-changed clause real rather than decorative.
 *
 *  ⚠️ THE REVIEW HALF IS DETERMINISTIC ONLY WITHIN THE MAIL STORE'S TTL, AND THAT IS A REAL
 *  WEAKENING OF THE CONTRACT ABOVE RATHER THAN AN ASTERISK ON IT. Mail expires at 24 h once
 *  read and 72 h unread, so a request whose mail has aged out simply stops appearing — the
 *  block changes with no tracked change anywhere. The ledger half does not decay, because
 *  the ledger is committed. Stated here rather than discovered later as a flaky diff. */
/** State rank. Monotone merging needs an ORDER, and the order is "how much is settled".
 *  A non-dispositive ledger row outranks a bare ack (someone wrote it down) and is outranked
 *  by a real verdict on the mail plane, which is the thing it is still waiting for. */
export const STATE_RANK = {
  "PENDING": 0,
  "ACKED-NOT-DISPOSED": 1,
  // RE-RANKED (for the SUPPRESSION direction, which an earlier remedy left open):
  // at rank 4 a FOLDED-IN-COMMIT row made an INTERIM ledger row saying the loop REOPENED
  // unrenderable -- the author's own assertion suppressing the reviewer's record, on the instrument
  // built because a reviewer's record was lost. This order now mirrors the branch chain exactly.
  "FOLDED-IN-COMMIT": 2,
  "LEDGERED-NO-DISPOSITION": 3,
  "VERDICT-ON-MAIL-ONLY": 4,
  "LEDGERED": 5,
};

/** The render regex, used in BOTH directions — it writes the row and it reads the row back.
 *  Keeping one definition is what stops the parser drifting from the renderer. */
const ROW_RE = /^- `([0-9a-f]{7,40})` — \*\*([A-Z-]+)\*\* · (.*)$/;

/** Rows already inside the fence, so an aged-out mail does not silently delete history.
 *  ⛔ HAZARD 1 (their own caution): re-absorbing the fence can resurrect hand-typed junk.
 *  Only lines matching the RENDER regex are re-absorbed, and the caller additionally requires
 *  each sha to still pass the git oracle — so a hand-edited line has to be a byte-perfect
 *  forgery of machine output AND name a real commit to survive. */
export function parseFenceRows(planText) {
  const out = [];
  const body = String(planText);
  const i = body.indexOf(BEGIN), j = body.indexOf(END);
  if (i < 0 || j < i) return out;
  for (const line of body.slice(i, j).split("\n")) {
    const m = line.match(ROW_RE);
    if (m && STATE_RANK[m[2]] !== undefined) out.push({ sha: m[1], state: m[2], detail: m[3] });
  }
  return out;
}

/** MONOTONE MERGE — the answer to a TRACKED fence fed by a GITIGNORED, EXPIRING store
 *  (a reviewer's recommendation rather than either option I offered).
 *
 *  The problem their measurement exposed: my 24 sha-bearing request mails have a median age of
 *  48.3 hours against a 24 h read / 72 h unread prune, so within about a day most of the
 *  COMMITTED fence would simply disappear — and `git log -p` on a tracked file reads a deletion
 *  as an event. Nothing in the artifact would distinguish *the review closed* from *the mail
 *  expired*. A caption saying "absence is not evidence" does not survive contact with a diff.
 *
 *  ⛔ I did NOT take the other option on the table. `--check`-only was mine, and they rejected it
 *  outright for the right reason: the founding failure was a HUMAN reading a stale cell, so
 *  moving the derived state into a terminal verdict nobody runs reinstates the hand-typed cell
 *  and the bug with it.
 *
 *  Rules: upgrades only, never a downgrade, never a delete.
 *  ⛔ HAZARD 2: rows must be able to retire, or the fence grows forever. A row RETIRES once it
 *  reaches LEDGERED — safe precisely because the ledger is committed and re-derives itself on
 *  every run, so nothing is carried that can be recomputed. */
export function mergeMonotone(prior, fresh, isCommit = () => true) {
  const byS = new Map();
  for (const r of fresh) byS.set(r.sha, r);
  for (const p of prior) {
    if (!isCommit(p.sha)) continue;                 // hazard 1, second half
    const f = byS.get(p.sha);
    if (!f) {
      // hazard 2 -- re-derivable from a COMMITTED plane, so let it retire rather than pin it.
      // FOLDED-IN-COMMIT joins LEDGERED here: both are re-derived on every run.
      if (p.state === "LEDGERED" || p.state === "FOLDED-IN-COMMIT") continue;
      byS.set(p.sha, { ...p, detail: `${p.detail.replace(/ · last observed.*$/, "")} · last observed; mail aged out` });
      continue;
    }
    if ((STATE_RANK[p.state] ?? -1) > (STATE_RANK[f.state] ?? -1)) byS.set(p.sha, p);  // refuse the downgrade
  }
  return [...byS.values()].sort((a, b) => (a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0));
}

function reviewSection(rows) {
  // `null` means the caller did not gather review state at all — say so, rather than
  // rendering an empty table that reads as "nothing outstanding". A missing measurement
  // and a measured zero are different claims and must not print the same.
  if (rows === null) {
    return ["### Derived state — reviews this seat sent", "",
      "*NOT GATHERED this run.*", ""];
  }
  const body = rows.length
    ? rows.map((r) => `- \`${r.sha}\` — **${r.state}** · ${r.detail}`).join("\n")
    : "- (none found in the mail store's live window)";
  return [
    "### Derived state — reviews this seat sent", "",
    "*Derived from the mail store plus `.claude/docs/review-ledger.md`, never hand-typed —",
    "this is the cell that read `⏳ with the hub` 37 minutes after the verdict had landed.*",
    "*`VERDICT-ON-MAIL-ONLY` means the answer exists and the durable ledger is behind;*",
    "*`ACKED-NOT-DISPOSED` means an ack names the sha and settles nothing.*",
    "*`LEDGERED-NO-DISPOSITION` means a ledger row exists and settles nothing — an interim or",
    "an ack — so the loop is still open and somebody wrote that down.*",
    "*`FOLDED-IN-COMMIT` means a fold commit of this seat names the sha — this seat asserting it",
    "received and folded a verdict, on a plane no TTL prunes. It ranks BELOW every reviewer record:",
    "an author's self-report may improve a row and must never cap or suppress one.*",
    "*Rows are MONOTONE: a state can only improve, never regress, and a row whose mail has",
    "aged out of the 24 h / 72 h store is carried with `last observed` rather than deleted,",
    "so a diff of this file cannot read an expiry as a closure. A row retires once it reaches",
    "`LEDGERED` or `FOLDED-IN-COMMIT`, and it then DISAPPEARS rather than being carried — which is",
    "correct, because this section lists what is still OUTSTANDING and a closed loop is not. ⛔ The",
    "reason this caption used to give was FALSE: the ledger is CONSULTED per sha, never enumerated as",
    "a candidate source, so nothing re-derives a retired row. The row is gone because it is done.*",
    "*⚠️ Still a FLOOR, and FOUR causes drop a row, not one: subject convention, trailer spelling,",
    "the commit window, and mail expiry. Fleet-wide the subject anchor alone misses ~47% of 913 fold",
    "commits, and 241 carry a session trailer this reader cannot key on. Per-seat recovery is UNEVEN",
    "— two live seats recover nothing and cannot tell. Absence is never evidence of no outstanding",
    "review.*",
    "", body, "",
  ];
}

export function deriveBlock(todoText, sid, reviewRows = null) {
  const { open, closed } = rowsNamingSeat(todoText, sid);
  const list = (xs) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "- (none)");
  return [
    BEGIN,
    "",
    "### Derived state — this seat's tracker rows",
    "",
    "*Rewritten by `/summary`. Deterministic: seat-scoped row names only, so it changes",
    "when this seat FILES something and not when the fleet commits. ⚠️ Bound, stated",
    "because the caption used to over-claim: the predicate is `filed: … by <sid>` or",
    "`owner: <sid>` — there is NO closure-attribution arm, so a row a PEER filed and",
    "THIS seat closed is absent from both lists. Measured on a peer-filed",
    "row closed by this seat and reading 0",
    "here. Read Closed(N) as a FLOOR.*",
    "",
    `**Open (${open.length})**`,
    list(open),
    "",
    `**Closed (${closed.length})**`,
    list(closed),
    "",
    ...reviewSection(reviewRows),
    END,
  ].join("\n");
}

/** Replace the fence, or append one if absent — and REFUSE anything else.
 *
 * ⛔ THIS FUNCTION FAILED OPEN UNTIL 2026-08-25 AND THE FAILURE WAS SILENT DATA LOSS
 * (reproduced end-to-end by a fresh-context lens).
 * The old body took `indexOf` of each marker and treated EVERY non-canonical state as
 * "append", with no COUNT anywhere. The killing sequence needs only an orphan BEGIN —
 * which a seat writes by MENTIONING the marker in prose above the fence, in exactly the
 * session where it built the fence:
 *
 *   run 1: i set, j unset  -> falls to the append arm -> file now has BEGIN … BEGIN … END
 *   run 2: i = the ORPHAN BEGIN, j = the NEW END
 *          -> slice(0,i) + block + slice(j+len) DELETES EVERYTHING BETWEEN THEM
 *
 * The result is a perfectly well-formed file with one fence and the operator's prose
 * gone, so nothing downstream can notice. Two further states were equally wrong: a stray
 * END (or END-before-BEGIN) appends FOREVER (measured +412 B/run, 250 -> 2310 B over
 * five), and two fences froze fence 2 permanently stale because `indexOf` takes the first
 * of each.
 *
 * The docstring this replaces claimed "NEVER touches a byte outside it" — a guarantee the
 * code did not have. A writer on a many-writer file gets a COUNT and a REFUSAL, never a
 * best guess: exactly 0/0 appends, exactly 1/1 in order splices, everything else throws.
 */
export function spliceFence(planText, block) {
  const nb = planText.split(BEGIN).length - 1;
  const ne = planText.split(END).length - 1;
  if (nb === 0 && ne === 0) {
    const sep = planText.endsWith("\n\n") ? "" : planText.endsWith("\n") ? "\n" : "\n\n";
    return planText + sep + block + "\n";
  }
  if (nb !== 1 || ne !== 1) {
    throw new Error(
      `spliceFence: REFUSING — non-canonical fence (${nb} BEGIN, ${ne} END). ` +
      `Expected 0/0 (append) or 1/1 (splice). Repair the plan file by hand; ` +
      `splicing this shape can delete text between a stray marker and the real one.`);
  }
  const i = planText.indexOf(BEGIN);
  const j = planText.indexOf(END);
  if (j < i) {
    throw new Error("spliceFence: REFUSING — END precedes BEGIN. Repair the plan file by hand.");
  }
  return planText.slice(0, i) + block + planText.slice(j + END.length);
}

export function findPlan(sid, cwd = ".") {
  const dir = path.join(cwd, "plans");
  if (!fs.existsSync(dir)) return null;
  const hits = fs.readdirSync(dir).filter((f) => f.startsWith(`session-${sid}-`) && f.endsWith(".md") && !/-part\d+\.md$/.test(f));
  if (!hits.length) return null;
  hits.sort();
  return path.join(dir, hits[hits.length - 1]);
}

/**
 * Dated block headings (`## ` or `### `, then `YYYY-MM-DD HH:MMZ`, `…THH:MMZ` or `…HH:MM:SSZ`,
 * and since 2026-10-12 the hand-estimated `HH:NxZ` / `HH:xxZ` labels: a measurement at one
 * checkpoint found those labels up to 3 h 20 min ahead of their block's write, and this
 * check could not read them) whose minute is LATER than `nowMs`'s UTC
 * minute — a time typed from impression rather than read off the clock (three
 * self-caught instances in one session,
 * each a minute or more ahead). An `x` reads as 0 — the EARLIEST minute the label can mean —
 * so a label is flagged only when even its earliest reading is ahead. Pure, so the self-test
 * can pin the clock. It sees only the FUTURE direction: a heading typed BEHIND the clock is
 * indistinguishable here from one written late on purpose, so the warning says so rather than
 * implying full coverage.
 */
export function futureHeadings(planText, nowMs) {
  const nowMinute = Math.floor(nowMs / 60000);
  const out = [];
  for (const line of planText.split("\n")) {
    // `##` AND `###`: both are live dated-heading levels (/working-plan step 2), and the `T` and
    // seconds spellings are house forms too. A time with no `Z` is never read as UTC.
    const m = /^#{2,3} (\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}|\dx|xx)(?::\d{2})?Z\b/.exec(line);
    if (!m) continue;
    const minute = +m[5].replace(/x/g, "0");
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], minute) / 60000;
    if (t > nowMinute) out.push(line.slice(0, 40));
  }
  return out;
}

/**
 * The clock finding folded into the ONE stdout verdict line (2026-10-12): callers keep only that
 * line (`… 2>&1 | tail -1` — 101 such reads in one session after the 2026-10-04 check shipped),
 * which cut the stderr block printed above it, so a heading stamped ahead of its write was never
 * corrected. Empty when nothing is ahead, so the bare token callers match on is unchanged; the
 * stderr block stays for a terminal reader.
 */
export function clockSuffix(ahead) {
  return ahead.length ? ` — CLOCK: ${ahead.length} heading(s) ahead of the last write, first: ${ahead[0]}` : "";
}

// ------------------------------------------------------------------ self-test
// Argument vocabulary. EXPORTED and pure so the self-test can exercise rejection
// without going anywhere near `fs.writeFileSync` — a guard whose only test path
// runs the writer is a guard nobody will test.
export const VALUED_FLAGS = new Set(["--sid", "--plan"]);
export const BARE_FLAGS = new Set(["--check", "--self-test", "--help", "-h"]);

/**
 * First unrecognised token in argv, or null. Consumes each valued flag's VALUE,
 * so `--plan --check` reports null: `--check` is that flag's value there, not a
 * flag of its own. Drop the `i++` and the loop still passes every arm that does
 * not exercise a flag-shaped value — which is why the self-test carries one.
 */
export function unknownArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (VALUED_FLAGS.has(t)) { i++; continue; }
    if (!BARE_FLAGS.has(t)) return t;
  }
  return null;
}

function selfTest() {
  let fail = 0;
  const eq = (label, got, want) => {
    if (got === want) { console.log(`  ok   ${label}`); }
    else { console.log(`  FAIL ${label}\n       got:  ${JSON.stringify(got)}\n       want: ${JSON.stringify(want)}`); fail++; }
  };
  const throws = (label, fn) => {
    try { fn(); console.log(`  FAIL ${label} (did not throw)`); fail++; }
    catch { console.log(`  ok   ${label}`); }
  };

  // (f) argv vocabulary — the guard that stops an unknown token reaching the write.
  eq("ARGV: --help is known", unknownArg(["--help"]), null);
  eq("ARGV: --check is known", unknownArg(["--check"]), null);
  eq("ARGV: typo'd read-flag is REJECTED", unknownArg(["--chek"]), "--chek");
  eq("ARGV: bare positional is REJECTED", unknownArg(["plans/x.md"]), "plans/x.md");
  // ⛔ THIS is the arm that catches a dropped `i++`, MEASURED: without the skip,
  // "deadbeef" is read as a token in its own right and returned as unknown.
  eq("ARGV: valued flag consumes its value", unknownArg(["--sid", "deadbeef"]), null);
  // ⚠️ AND THIS ONE IS NOT, THOUGH BOTH I AND THE PEER WHO PROPOSED IT SAID IT
  // WAS. The claim was that dropping `i++` would red it because `--check` is
  // `--plan`'s VALUE here. It does not: `--check` is in BARE_FLAGS, so the loop
  // reads it as a known flag and returns null under the mutation exactly as it
  // does at HEAD. Measured 2026-08-31 — the arm above went RED and this one
  // stayed green, which is the opposite of what the comment claimed.
  //
  // It is still live, for a DIFFERENT mutation: drop "--plan" from VALUED_FLAGS
  // and it returns "--plan" instead of null. Kept and relabelled rather than
  // deleted. Two people asserted which arm discriminates and neither ran it;
  // the mutation cost one command.
  eq("ARGV: a VALUED flag's own name is not reported as unknown", unknownArg(["--plan", "--check"]), null);

  // (e) malformed args rejected explicitly — an unvalidated predicate is fail-OPEN
  throws("MALFORMED: empty sid throws", () => rowsNamingSeat("- [ ] X\n", ""));
  throws("MALFORMED: non-hex sid throws", () => rowsNamingSeat("- [ ] X\n", "notasid!"));

  const todo = [
    "- [ ] ALPHA-ROW — body",
    "  filed: 2026-08-25 by aaaa1111",
    "- [x] BETA-ROW — body",
    "  owner: aaaa1111",
    "- [ ] GAMMA-ROW — a PEER's row",
    "  filed: 2026-08-25 by bbbb2222",
  ].join("\n");

  const r = rowsNamingSeat(todo, "aaaa1111");
  eq("open rows found", r.open.join(","), "ALPHA-ROW");
  eq("closed rows found", r.closed.join(","), "BETA-ROW");
  eq("peer row EXCLUDED", r.open.includes("GAMMA-ROW"), false);

  // ⛔ DISCRIMINATING CONTROL for the newline class. A row this seat appended a line to,
  // where the SEAT id sits below a PEER's `filed:` — the bare `[^|]*` form reports it as
  // ours. Both hypotheses must give DIFFERENT readings or the control is vacuous.
  const spanning = [
    "- [ ] PEER-ROW — filed by someone else",
    "  filed: 2026-08-25 by bbbb2222",
    "  ruled: 2026-08-25 by aaaa1111",
  ].join("\n");
  eq("SPAN CONTROL: a peer row this seat merely annotated is NOT claimed",
     rowsNamingSeat(spanning, "aaaa1111").open.length, 0);
  const naive = new RegExp("filed:[^|]*by aaaa1111");
  eq("SPAN CONTROL is discriminating (the naive form DOES claim it)", naive.test(spanning), true);

  // ⛔ FAILURE 9 CONTROL. A row a PEER filed whose SAME LINE credits this seat in a parenthetical —
  // the retired greedy `filed:[^|\n]*by <sid>\b` form runs PAST the real filer to that later
  // mention and claims it. Both hypotheses must give DIFFERENT readings or the control is vacuous.
  const credited = [
    "- [ ] CREDITED-ROW — filed by a peer, this seat credited later on the SAME line",
    "  filed: 2026-09-08 by bbbb2222 (reported by aaaa1111 and re-run by aaaa1111)",
  ].join("\n");
  eq("FAILURE 9 CONTROL: a peer row crediting this seat in a parenthetical is NOT claimed",
     rowsNamingSeat(credited, "aaaa1111").open.length, 0);
  const greedy9 = new RegExp("filed:[^|\\n]*by aaaa1111\\b");
  eq("FAILURE 9 CONTROL is discriminating (the retired greedy form DOES claim it)",
     greedy9.test(credited), true);

  // ⛔ WRAPPED-FIELD RECOVERY — THE ARM THAT WAS MISSING, AND ITS ABSENCE IS WHY THE COMMENT
  // ABOVE COULD BE DELETED UNNOTICED. The docblock justifies
  // dropping the retired `[^|\n]` negated class by arguing the shaped form's `\s` CROSSES the
  // newline, so a `filed:` field WRAPPED onto the next line is still recovered. That behaviour
  // is the entire justification and it shipped with ZERO arms: a reviewer reproduced the mutation
  // in a detached worktree and killing the newline-crossing (`\s` -> a space class) left all 31
  // arms GREEN. A suite that discriminates elsewhere but not here is worse than one that does
  // not discriminate at all, because its green is quoted.
  // ⚠️ AND THE READER WHO WOULD MAKE THAT MUTATION IS NOT HYPOTHETICAL: `/summary`'s spec, one
  // paragraph above its own copy of this predicate, prescribes `[^\S\n]` for the OWNER arm and
  // explains at length why `\s` is wrong THERE. A future editor harmonising the two arms makes
  // exactly this change, reads 31/31, and ships. The prose that would have stopped them is the
  // comment this commit deleted, so the test has to carry it instead.
  const wrapped = [
    "- [ ] WRAPPED-FIELD-ROW — the filer field wraps onto the next physical line",
    "  filed:",
    "  2026-09-08 by aaaa1111",
  ].join("\n");
  eq("WRAPPED-FIELD RECOVERY: a `filed:` field wrapped across a newline IS still claimed",
     rowsNamingSeat(wrapped, "aaaa1111").open.length, 1);
  // Discriminating control: the newline-KILLING form must MISS it. Without this the arm above
  // passes under both hypotheses and certifies nothing — the vacuous shape this file's own
  // FAILURE 9 arm was written to avoid.
  const noNewline = new RegExp("filed:[^\\S\\n]*[0-9-]*[^\\S\\n]*by aaaa1111\\b");
  eq("WRAPPED-FIELD control is discriminating (a newline-killing class MISSES it)",
     noNewline.test(wrapped), false);
  // And the cross-ROW direction stays closed — structurally, by splitRows, not by the regex:
  // a `filed:` ending one row and a `by <sid>` opening the next land in DIFFERENT blocks and
  // can never be tested together. This is what makes the deleted comment redundant rather than
  // merely unenforced.
  const crossRow = [
    "- [ ] ROW-ONE — trailing filed:",
    "  filed:",
    "- [ ] ROW-TWO — a different row entirely",
    "  2026-09-08 by aaaa1111",
  ].join("\n");
  eq("CROSS-ROW: a `filed:` ending one row never reaches a `by <sid>` opening the next",
     rowsNamingSeat(crossRow, "aaaa1111").open.length, 0);

  // determinism — the whole basis of write-only-when-changed
  eq("DETERMINISM: two derivations are byte-identical",
     deriveBlock(todo, "aaaa1111") === deriveBlock(todo, "aaaa1111"), true);

  // (d) pollution — splice must not alter a byte outside the fence
  const plan = `# Plan\n\nkeep me A\n\n${BEGIN}\nOLD BODY\n${END}\n\nkeep me B\n`;
  const out = spliceFence(plan, deriveBlock(todo, "aaaa1111"));
  eq("POLLUTION: text before the fence untouched", out.includes("keep me A"), true);
  eq("POLLUTION: text after the fence untouched", out.includes("keep me B"), true);
  eq("POLLUTION: old fence body gone", out.includes("OLD BODY"), false);
  eq("IDEMPOTENT: splicing twice is a fixed point",
     spliceFence(out, deriveBlock(todo, "aaaa1111")) === out, true);
  eq("APPEND: a plan with no fence gains exactly one",
     (spliceFence("# Plan\n\nbody\n", deriveBlock(todo, "aaaa1111")).match(/SUMMARY-SYNC:BEGIN/g) || []).length, 1);

  // ⛔ REFUSE ARMS — one RED control per non-canonical marker state. Every one of these
  // returned a WRITE before 2026-08-25; the orphan-BEGIN case is the data-loss one (run 1
  // appends a second fence, run 2 deletes everything between the orphan and the new END).
  const blk = deriveBlock(todo, "aaaa1111");
  throws("REFUSE: orphan BEGIN (1/0) throws instead of appending a second fence",
         () => spliceFence(`# Plan\n\nI mention ${BEGIN} in prose\n`, blk));
  throws("REFUSE: stray END (0/1) throws instead of appending forever",
         () => spliceFence(`# Plan\n\nI mention ${END} in prose\n`, blk));
  throws("REFUSE: END before BEGIN throws",
         () => spliceFence(`# Plan\n\n${END}\nbody\n${BEGIN}\n`, blk));
  throws("REFUSE: two fences (2/2) throws instead of freezing fence 2 stale",
         () => spliceFence(`${BEGIN}\na\n${END}\n\n${BEGIN}\nb\n${END}\n`, blk));
  // DISCRIMINATING control: the two LEGAL shapes must still pass, or "refuse" is just "break".
  eq("REFUSE control: 0/0 still appends",
     (spliceFence("# Plan\n", blk).match(/SUMMARY-SYNC:BEGIN/g) || []).length, 1);
  eq("REFUSE control: 1/1 in order still splices",
     spliceFence(`x\n${BEGIN}\nold\n${END}\ny\n`, blk).includes("old"), false);

  // ⛔ SID BOUNDARY. Both must read 0; before the \b fix both read 1.
  eq("BOUNDARY: a LONGER sid is not claimed as ours",
     rowsNamingSeat("- [ ] PFX-ROW — body\n  owner: aaaa1111ff\n", "aaaa1111").open.length, 0);
  eq("BOUNDARY: `owner:` inside a longer word is not claimed",
     rowsNamingSeat("- [ ] SFX-ROW — body\n  downer: aaaa1111\n", "aaaa1111").open.length, 0);

  // ⛔ MULTI-ROW fixture — with ONE row, .sort() and new Set() are unfalsifiable at birth
  // (both mutants survived a green suite). These need ≥2 and a dup.
  const multi = [
    "- [ ] ZULU-ROW — body", "  filed: 2026-08-25 by aaaa1111",
    "- [ ] ALPHA-ROW — body", "  filed: 2026-08-25 by aaaa1111",
    "- [ ] ALPHA-ROW — a DUPLICATE name", "  owner: aaaa1111",
  ].join("\n");
  eq("SORT is live: rows come back ordered, not in file order",
     rowsNamingSeat(multi, "aaaa1111").open.join(","), "ALPHA-ROW,ZULU-ROW");

  // RED control: a CHANGED corpus must produce a DIFFERENT block, or "only when changed"
  // can never fire and the sync is inert.
  const todo2 = todo + "\n- [ ] DELTA-ROW — new\n  filed: 2026-08-25 by aaaa1111";
  eq("RED CONTROL: a new row CHANGES the block",
     deriveBlock(todo, "aaaa1111") === deriveBlock(todo2, "aaaa1111"), false);

  // ---------------------------------------------------------- review-state derivation
  // Every arm below is paired with the mutation that REDs it, because an arm whose
  // discriminating mutation nobody names is a presence check wearing a discrimination
  // check's clothes (this file already carries one such relabelled arm, above).

  // MUTATION: drop the {7,40} bound to {7,} -> the 41-char token is accepted, arm REDs.
  eq("SHAS: 7..40 hex only",
     extractShas("aaaaaaa deadbeef12 " + "f".repeat(41)).join(","), "aaaaaaa,deadbeef12");
  // NOT a defect — an 8-hex session id IS hex and this file is full of them. The arm
  // PINS the blind spot so nobody "fixes" the regex instead of keeping the git oracle.
  eq("SHAS: a session id is indistinguishable by shape (pinned, not a bug)",
     extractShas("peer cccc3333 replied").join(","), "cccc3333");

  const LED = [
    "| Date | Commit | Verdict | Reviewer | Mail | Note |",
    "|---|---|---|---|---|---|",
    "| 2026-09-12 | `a1b2c3d4e` + `b1b1b1b1b` | ✅ **APPROVED-WITH-FINDINGS** — 3 lenses | `dddd4444` | m.md | n |",
    "| 2026-09-05 | `c2c2c2c2c` | APPROVE | `eeee5555` | m.md | n |",
    "| 2026-09-04 | `1111111aa` | it stays, and the line matters | `eeee5555` | m.md | n |",
  ].join("\n");
  const led = parseLedgerShas(LED);
  // MUTATION: take extractShas(commit)[0] instead of iterating -> the second sha is lost, REDs.
  eq("LEDGER: a multi-sha Commit cell registers BOTH", led.has("b1b1b1b1b"), true);
  // ⛔ THE LONGEST-FIRST ARM. MUTATION: sort VERDICT_WORDS shortest-first, or move
  // "APPROVED" above "APPROVED-WITH-FINDINGS" -> this reads "APPROVED" and REDs.
  eq("LEDGER: APPROVED-WITH-FINDINGS does not read as APPROVED",
     led.get("a1b2c3d4e").verdict, "APPROVED-WITH-FINDINGS");
  // MUTATION: `|| "(unparsed)"` -> `|| flat.trim().split(" ")[0]` -> guesses "IT", REDs.
  eq("LEDGER: a prose-only verdict cell reports (unparsed), never a guess",
     led.get("1111111aa").verdict, "(unparsed)");
  eq("LEDGER: reviewer sid is captured", led.get("c2c2c2c2c").reviewer, "eeee5555");
  // MUTATION: replace lookupSha with map.get -> the 7-char probe misses, REDs.
  eq("LOOKUP: a 7-char probe finds a 9-char ledger entry", !!lookupSha(led, "a1b2c3d"), true);
  eq("LOOKUP: a 6-char probe is BELOW the floor and must miss", lookupSha(led, "a1b2c"), null);

  const R = (o) => deriveReviewRows({ isCommit: () => true, ...o });
  // MUTATION: reorder any two branches in deriveReviewRows -> the matching arm REDs.
  eq("REVIEW: ledger wins over a mail-plane verdict",
     R({ requestShas: ["a1b2c3d4e"], verdictShas: ["a1b2c3d4e"], ledger: led })[0].state, "LEDGERED");
  eq("REVIEW: a verdict with NO ledger row is VERDICT-ON-MAIL-ONLY (the 2026-09-12 failure)",
     R({ requestShas: ["abcdef1"], verdictShas: ["abcdef1"] })[0].state, "VERDICT-ON-MAIL-ONLY");
  eq("REVIEW: an ACK disposes of nothing and gets its own state",
     R({ requestShas: ["abcdef1"], ackShas: ["abcdef1"] })[0].state, "ACKED-NOT-DISPOSED");
  eq("REVIEW: sent with nothing back is PENDING",
     R({ requestShas: ["abcdef1"] })[0].state, "PENDING");
  // MUTATION: drop the isCommit guard -> the session id survives as a row, REDs.
  eq("REVIEW: git is the oracle — a non-commit candidate is dropped",
     deriveReviewRows({ requestShas: ["cccc3333"], isCommit: () => false }).length, 0);

  // ---- FOLDED-IN-COMMIT: the durable plane, added 2026-09-21 after the mail TTL lost a
  // closed loop on BOTH trackers and bought a four-lens re-dispatch. Each arm REDs under the
  // mutation named beside it.
  // MUTATION: drop `on` from the anchor in parseFoldShas -> this REDs (it takes the session id).
  eq("parseFoldShas takes the sha after `on`, NOT the reviewer session id in the same parenthetical",
    JSON.stringify(parseFoldShas(["fold(hub ddddd4444 verdict on f5f5f5f5f): the stale error painted over"])),
    JSON.stringify(["f5f5f5f5f"]));
  // MUTATION: drop the `startsWith("fold(")` guard -> this REDs.
  eq("parseFoldShas ignores a non-fold subject that happens to say `on <sha>`",
    parseFoldShas(["fix(lightbox): a note on f5f5f5f5f and what it changed"]).length, 0);
  // MUTATION: revert the candidate union to `requestShas` alone -> this REDs, and it is the
  // ONLY arm that covers the case the change exists for.
  eq("a sha known ONLY from a fold commit still gets a row — the expired-request case",
    (R({ requestShas: [], foldShas: ["f5f5f5f5f"] })[0] || { state: "NO ROW AT ALL — the union was reverted" }).state, "FOLDED-IN-COMMIT");
  // MUTATION: move the F branch above the `led` branches -> this REDs.
  eq("a dispositive ledger row still OUTRANKS a fold commit",
    R({ requestShas: ["ddddddd44"], foldShas: ["ddddddd44"],
        ledger: new Map([["ddddddd44", { verdict: "APPROVE", reviewer: "dddd4444", dispositive: true }]]) })[0].state,
    "LEDGERED");
  // MUTATION: give FOLDED-IN-COMMIT a rank below PENDING -> mergeMonotone stops improving it.
  eq("FOLDED-IN-COMMIT outranks PENDING and ACKED, and sits below LEDGERED",
    STATE_RANK["PENDING"] < STATE_RANK["FOLDED-IN-COMMIT"] && STATE_RANK["ACKED-NOT-DISPOSED"] < STATE_RANK["FOLDED-IN-COMMIT"]
      && STATE_RANK["FOLDED-IN-COMMIT"] < STATE_RANK["LEDGERED"], true);

  // ---------------------------------------------------------- a review verdict's findings
  // Seven findings, three serious. Every arm below is the one the verdict asked for, and each
  // names the mutation that REDs it.

  // LAST-WINS. MUTATION: restore `if (!out.has(s))` -> this reads INTERIM and REDs.
  const LED2 = [
    "| Date | Commit | Verdict | Reviewer | Mail | Note |", "|---|---|---|---|---|---|",
    "| 2026-09-09 | `d3d3d3d3d` | INTERIM — still reading | `dddd4444` | m.md | n |",
    "| 2026-09-11 | `d3d3d3d3d` | APPROVED | `dddd4444` | m.md | n |",
  ].join("\n");
  eq("an append-ordered ledger yields the LAST verdict, not the first",
     parseLedgerShas(LED2).get("d3d3d3d3d").verdict, "APPROVED");

  // The SEPARATOR, not the order. Fixture drawn from the LIVE corpus spelling, not
  // from the hyphenated one the predicate already handled (that was the vacuous control).
  // MUTATION: drop the `[\s_]+ -> -` normalisation -> this reads APPROVED and REDs.
  const LED3 = ["| D | C | V | R | M | N |", "|---|---|---|---|---|---|",
    "| 2026-09-12 | `e4e4e4e4e` | ✅ **APPROVED WITH FINDINGS** — 3-lens | `dddd4444` | m.md | n |",
    "| 2026-09-12 | `aaaaaaa11` | **CHANGES REQUESTED** — one P1 | `dddd4444` | m.md | n |"].join("\n");
  const led3 = parseLedgerShas(LED3);
  eq("the SPACE spelling does not read as APPROVED",
     led3.get("e4e4e4e4e").verdict, "APPROVED-WITH-FINDINGS");
  eq("CHANGES REQUESTED (spaces) parses at all", led3.get("aaaaaaa11").verdict, "CHANGES-REQUESTED");

  // A ledger row is not a disposition. MUTATION: put INTERIM into
  // DISPOSITIVE_VERDICTS -> this reads LEDGERED and REDs.
  const ledI = parseLedgerShas(["| D | C | V | R | M | N |", "|---|---|---|---|---|---|",
    "| 2026-09-11 | `bbbbbbb22` | INTERIM | `dddd4444` | m.md | n |"].join("\n"));
  eq("an INTERIM ledger row is LEDGERED-NO-DISPOSITION, not LEDGERED",
     R({ requestShas: ["bbbbbbb22"], ledger: ledI })[0].state, "LEDGERED-NO-DISPOSITION");
  eq("a real verdict on the mail plane OUTRANKS a non-dispositive ledger row",
     R({ requestShas: ["bbbbbbb22"], verdictShas: ["bbbbbbb22"], ledger: ledI })[0].state, "VERDICT-ON-MAIL-ONLY");

  // UNRESOLVED — the ledger's non-convergence word gained a producer on 2026-09-13 (review-hub
  // Phase 3), so this, its one code consumer, owes the word. MUTATION: move "UNRESOLVED" below
  // "CHANGES-REQUESTED" in VERDICT_WORDS -> the first arm reads CHANGES-REQUESTED and REDs; delete
  // it from VERDICT_WORDS -> the first arm reads CHANGES-REQUESTED, the bare arm below reads
  // (unparsed), and all three RED.
  const ledU = parseLedgerShas(["| D | C | V | R | M | N |", "|---|---|---|---|---|---|",
    "| 2026-09-13 | `ddddddd44` | ⛔ **UNRESOLVED** — CHANGES-REQUESTED twice, the P1 survived both folds | `dddd4444` | m.md | n |"].join("\n"));
  eq("UNRESOLVED: a cell narrating the verdicts before it still reads UNRESOLVED",
     ledU.get("ddddddd44").verdict, "UNRESOLVED");
  // MUTATION: drop "UNRESOLVED" from DISPOSITIVE_VERDICTS -> LEDGERED-NO-DISPOSITION, REDs.
  eq("UNRESOLVED: the loop ended, so its row disposes of the review (LEDGERED)",
     R({ requestShas: ["ddddddd44"], ledger: ledU })[0].state, "LEDGERED");

  // The BARE cell. The ledger's own append convention makes the Verdict cell ONE token, so
  // this is the shape the producer writes; the narrating arm above covers only the shape it forbids.
  // MUTATION: drop "UNRESOLVED" from DISPOSITIVE_VERDICTS -> the second arm REDs.
  const ledB = parseLedgerShas(["| D | C | V | R | M | N |", "|---|---|---|---|---|---|",
    "| 2026-09-13 | `ddddddd45` | UNRESOLVED | `dddd4444` | m.md | n |"].join("\n")).get("ddddddd45");
  eq("UNRESOLVED: the bare one-token cell the spec prescribes reads UNRESOLVED", ledB.verdict, "UNRESOLVED");
  eq("UNRESOLVED: the bare one-token cell is dispositive", ledB.dispositive, true);

  // The English word AFTER a real verdict must not outrank it. MUTATION: delete the guarding
  // `if` in parseLedgerShas -> all three arms below read UNRESOLVED and RED.
  const ledR = parseLedgerShas(["| D | C | V | R | M | N |", "|---|---|---|---|---|---|",
    "| 2026-09-13 | `eeeeeee46` | APPROVED — one minor point left unresolved | `dddd4444` | m.md | n |",
    "| 2026-09-13 | `eeeeeee47` | FOLD-VERIFIED — loop closed, nothing unresolved | `dddd4444` | m.md | n |",
    "| 2026-09-13 | `eeeeeee48` | INTERIM — still unresolved, CHANGES-REQUESTED likely | `dddd4444` | m.md | n |"].join("\n"));
  eq("`APPROVED — one minor point left unresolved` reads APPROVED", ledR.get("eeeeeee46").verdict, "APPROVED");
  eq("`FOLD-VERIFIED — loop closed, nothing unresolved` reads FOLD-VERIFIED",
     ledR.get("eeeeeee47").verdict, "FOLD-VERIFIED");
  // The bound is EVERY other verdict word, not only the one the list would pick. MUTATION: compare
  // against the position of `others.find(...)` alone (CHANGES-REQUESTED, which follows the mention)
  // -> this reads UNRESOLVED and REDs. What it does read, CHANGES-REQUESTED, is the list's own
  // precedence and not this arm's business.
  eq("a lower-ranked verdict word ahead of UNRESOLVED demotes it too (INTERIM leads here)",
     ledR.get("eeeeeee48").verdict !== "UNRESOLVED", true);

  // ⛔ THE PRECEDENCE PAIR, WHICH WAS ASSERTED BY NOTHING. Measured before fixing:
  // swapping the VERDICT and ACK branches left the suite at rc=0, 54/54 green, because no arm
  // ever put one sha in BOTH lists — and live, 9 of 33 request shas carry both, so the
  // untested branch was the one that fires most. MUTATION: swap those two branches -> REDs.
  eq("a sha in BOTH the verdict and ack lists is VERDICT-ON-MAIL-ONLY",
     R({ requestShas: ["ccccccc33"], verdictShas: ["ccccccc33"], ackShas: ["ccccccc33"] })[0].state,
     "VERDICT-ON-MAIL-ONLY");

  // An ambiguous short prefix must SURFACE, never vanish. MUTATION: drop the stderr
  // read (back to `stdio: [...,"ignore"]` semantics) -> ambiguous reads 0 and this REDs.
  {
    const amb = gitCommitFilter(["abc1234"], () => ({
      stdout: "abc1234^{commit} missing\n",
      stderr: "error: short object ID abc1234 is ambiguous\n" }));
    eq("an ambiguous prefix is counted, not silently dropped", amb.ambiguous, 1);
    eq("and it is NOT admitted as a commit", amb.size, 0);
  }

  // ---- MONOTONE. Hazard 3 is that output now depends on its own prior content, so
  // these three arms are the ones their recommendation explicitly owed.
  const F = (sha, state, detail = "d") => ({ sha, state, detail });
  eq("an aged-out row is CARRIED, not deleted",
     mergeMonotone([F("ddddddd44", "VERDICT-ON-MAIL-ONLY")], []).length, 1);
  eq("and it is marked as last-observed",
     mergeMonotone([F("ddddddd44", "VERDICT-ON-MAIL-ONLY")], [])[0].detail.includes("aged out"), true);
  // MUTATION: drop the rank comparison in mergeMonotone -> the fresh PENDING wins and REDs.
  eq("a DOWNGRADE is refused",
     mergeMonotone([F("ddddddd44", "LEDGERED")], [F("ddddddd44", "PENDING")])[0].state, "LEDGERED");
  eq("an UPGRADE is accepted",
     mergeMonotone([F("eeeeeee55", "PENDING")], [F("eeeeeee55", "LEDGERED")])[0].state, "LEDGERED");
  // Hazard 2 — without this the fence grows forever.
  eq("a LEDGERED row retires instead of being carried (the ledger re-derives it)",
     mergeMonotone([F("fffffff66", "LEDGERED")], []).length, 0);
  // Hazard 1 — a hand-typed line must not be re-absorbed.
  eq("a carried row that no longer resolves to a commit is dropped",
     mergeMonotone([F("9999999aa", "LEDGERED-NO-DISPOSITION")], [], () => false).length, 0);
  eq("parseFenceRows reads back exactly what reviewSection renders",
     parseFenceRows([BEGIN, ...reviewSection([F("1234567", "PENDING", "x")]), END].join("\n"))[0].sha, "1234567");
  eq("parseFenceRows REJECTS a hand-typed line that is not render-shaped",
     parseFenceRows([BEGIN, "- `1234567` — MAYBE — I think this one is fine", END].join("\n")).length, 0);
  // Hazard 3 — idempotence. Merging a result with itself must be a fixed point.
  {
    const once = mergeMonotone([], [F("aaaaaaa77", "PENDING"), F("bbbbbbb88", "LEDGERED")]);
    const twice = mergeMonotone(once, [F("aaaaaaa77", "PENDING"), F("bbbbbbb88", "LEDGERED")]);
    eq("the merge is a FIXED POINT over an unchanged derivation",
       JSON.stringify(twice), JSON.stringify(once));
  }

  // ⛔ THE ORACLE ARM — and it exists because its absence shipped a total false zero.
  // Every arm above INJECTS isCommit, so none of them touches git, and the first version
  // of gitCommitFilter returned an empty Set for every input while all of them stayed
  // green. A positive control must travel the PIPELINE, not the predicate
  // (`.claude/rules/tests-unit.md` § A POSITIVE CONTROL MUST TRAVEL THE PIPELINE).
  // The needle is HEAD, derived here rather than hardcoded, so it cannot rot.
  {
    const head = execFileSync("git", ["rev-parse", "--short=9", "HEAD"], { encoding: "utf8" }).trim();
    const live = gitCommitFilter([head, "cccc3333"]);
    // MUTATION: drop `=%(objecttype) %(rest)` from the batch-check argument -> git prints
    // the full 40-char oid, this Set cannot contain a 9-char candidate, and this arm REDs.
    eq("ORACLE: a real short sha survives the git filter, AS SPELLED", live && live.has(head), true);
    // The session id is hex and 8 chars; only git can tell it is not a commit.
    eq("ORACLE: a session id is rejected by git", live && live.has("cccc3333"), false);
    // MUTATION: `catch { return null }` -> `catch { return new Set(candidates) }` -> REDs.
    eq("ORACLE: an unusable git returns null, never a permissive Set",
       gitCommitFilter(["deadbeef1"], () => { throw new Error("no git"); }), null);
    // The missing-object line ignores the format string and echoes the raw input — if that
    // shape were parsed as a hit, this would come back non-empty.
    eq("ORACLE: the missing-object output shape is not mistaken for a hit",
       gitCommitFilter(["aaaaaaaaa"], () => "aaaaaaaaa^{commit} missing\n").size, 0);
  }

  // ⛔ THE ARM THIS SECTION EXISTS FOR: a MISSING measurement and a measured ZERO are
  // different claims and must not render the same. MUTATION: `if (rows === null)` ->
  // `if (!rows || !rows.length)` -> both print NOT GATHERED and this REDs.
  eq("SECTION: not-gathered says so", reviewSection(null).join("\n").includes("NOT GATHERED"), true);
  eq("SECTION: a measured zero does NOT say not-gathered",
     reviewSection([]).join("\n").includes("NOT GATHERED"), false);
  eq("SECTION: a measured zero states its own floor",
     reviewSection([]).join("\n").includes("FLOOR"), true);

  // (g) future-dated headings. Clock pinned at 2026-10-04 09:21:30Z.
  // MUTATION: `t > nowMinute` -> `t >= nowMinute` REDs the current-minute arm;
  // `out.push(...)` deleted REDs the one-minute-ahead arm.
  const NOW = Date.UTC(2026, 9, 4, 9, 21, 30);
  eq("CLOCK: a heading one minute ahead is flagged",
     futureHeadings("x\n## 2026-10-04 09:22Z — later\n", NOW).length, 1);
  eq("CLOCK: a heading at the current minute is NOT flagged",
     futureHeadings("## 2026-10-04 09:21Z — now\n", NOW).length, 0);
  eq("CLOCK: a heading behind the clock is NOT flagged (the blind direction)",
     futureHeadings("## 2026-10-04 08:15Z — earlier\n", NOW).length, 0);
  eq("CLOCK: a next-day heading at an earlier hour is flagged (the date counts, not just the time)",
     futureHeadings("## 2026-10-05 01:00Z — tomorrow\n", NOW).length, 1);
  eq("CLOCK: a bullet carrying a time is ignored",
     futureHeadings("- note 2026-10-04 23:59Z\n", NOW).length, 0);
  eq("CLOCK: a ### heading, a T-form and a seconds form are each flagged",
     futureHeadings("### 2026-10-04 09:22Z a\n## 2026-10-04T09:22Z b\n## 2026-10-04 09:22:05Z c\n", NOW).length, 3);
  eq("CLOCK: a time with no Z (a local time) is never read as UTC",
     futureHeadings("## 2026-10-04 11:40 CEST\n", NOW).length, 0);
  // The hand-estimated label forms (2026-10-12). MUTATION: drop `|\dx|xx` from the minute
  // group -> the two flagged arms RED (the labels stop parsing); `replace(/x/g, "0")` ->
  // `replace(/x/g, "9")` REDs the same-decade arm (09:2x would read 09:29 > 09:21).
  eq("CLOCK: an HH:Nx label whose earliest minute is ahead is flagged (09:3x at 09:21)",
     futureHeadings("## 2026-10-04 09:3xZ — later\n", NOW).length, 1);
  eq("CLOCK: an HH:Nx label whose decade holds the current minute is NOT flagged (09:2x at 09:21)",
     futureHeadings("## 2026-10-04 09:2xZ — now-ish\n", NOW).length, 0);
  eq("CLOCK: an HH:xx label on a later hour is flagged, in the T form too",
     futureHeadings("## 2026-10-04T10:xxZ — later\n", NOW).length, 1);
  eq("CLOCK: an HH:Nx label with no Z is never read as UTC",
     futureHeadings("## 2026-10-04 11:4x — local\n", NOW).length, 0);
  // The verdict-line suffix (2026-10-12). MUTATION: return "" always -> the second arm REDs;
  // drop the `${ahead[0]}` -> the third arm REDs.
  eq("CLOCK-SUFFIX: nothing ahead leaves the verdict token bare", clockSuffix([]), "");
  eq("CLOCK-SUFFIX: names the count on the verdict line",
     clockSuffix(["## 2026-10-04 09:22Z — later", "## 2026-10-04 09:30Z — x"]).includes("2 heading(s) ahead"), true);
  eq("CLOCK-SUFFIX: names the first heading so the reader can find it",
     clockSuffix(["## 2026-10-04 09:22Z — later"]).includes("## 2026-10-04 09:22Z"), true);
  // The parse must not depend on the runner's zone: a local-time parse passes on a UTC box.
  const tz = process.env.TZ; process.env.TZ = "America/New_York";
  eq("CLOCK: the current-minute arm holds on a non-UTC runner",
     futureHeadings("## 2026-10-04 09:21Z — now\n", NOW).length, 0);
  if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;

  // ⛔ THIS LINE MUST STAY DIRECTLY ABOVE THE EXIT. It sat ~60 lines higher until
  // 2026-09-13, so arms appended after it printed BELOW a "PASS" banner — a failing
  // arm under a green summary is the one shape a reader trusts without looking.
  // Caught by adding arms, not by reading; any future arm goes ABOVE this line.
  console.log(fail === 0 ? "\nself-test: PASS" : `\nself-test: ${fail} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}

/** The IO half. Returns rows, or `null` meaning NOT GATHERED — and the null path is
 *  deliberate in three places below, because a wrong list is worse here than no list:
 *  a missing store, a missing ledger and an unusable git all return null rather than a
 *  best guess. `reviewSection` prints those two states differently on purpose.
 *
 *  ⛔ SPLIT ON THE FULL `__`, NEVER `cut -d_`. The store's names are
 *  `<recipient>__<ts>__<sender>.md`, so a single-underscore split counts the EMPTY field
 *  between the doubled delimiters and lands one index off — codified in
 *  `.claude/rules/bash-environment.md` after it cost ~25 minutes and a false owner-facing
 *  claim that a peer had not replied. Same defect, same fix, in JS. */
function gatherReviewRows(sid, priorRows = []) {
  const dir = path.join(".claude", "state", "session-mail");
  const ledgerPath = path.join(".claude", "docs", "review-ledger.md");
  if (!fs.existsSync(dir) || !fs.existsSync(ledgerPath)) return null;

  const requestShas = [], verdictShas = [], ackShas = [];
  for (const f of fs.readdirSync(dir)) {
    const parts = f.replace(/\.md(\.read(-by-[0-9a-f]+)?)?$/, "").split("__");
    if (parts.length !== 3) continue;
    const [to, , from] = parts;
    const mine = from.startsWith(sid), toMe = to.startsWith(sid);
    if (!mine && !toMe) continue;
    let txt; try { txt = fs.readFileSync(path.join(dir, f), "utf8"); } catch { continue; }
    const sig = (txt.match(/^signal:\s*(\S+)/m) || [, ""])[1];
    // ⛔ SUBJECT ONLY, NEVER THE BODY — the body scan answers a DIFFERENT QUESTION and
    // reads as this one. A request body cites prior art, supersessions and context, so
    // every commit it merely MENTIONS came back as a commit this seat SENT FOR REVIEW:
    // measured 2026-09-13, 47 rows against a true set in the teens, most of them then
    // classified VERDICT-ON-MAIL-ONLY because the reply quoted the same context. House
    // convention puts the shas under review in the subject line, so that is the field
    // that answers "what did I send". The narrowing costs a request whose subject names
    // no sha — which the section already declares as a FLOOR rather than a count.
    const subject = (txt.match(/^subject:\s*(.*)$/m) || [, ""])[1];
    const shas = extractShas(subject);
    // ⛔ THE DISPOSITION TEST IS THE FLEET'S, NOT MINE. It was `sig ===
    // "review-verdict"`, and re-derived on my OWN inbox — the population this predicate
    // actually runs over — that catches 25 dispositive mails and MISSES 34. The carriers:
    // review-response 19, fold-verify 6, review-reply 5, review-fold 2, deploy-hold 1, info 1.
    // ⚠️ My shipped caption blamed `info`, which carries ONE of the 34; the dominant carrier is
    // review-response. A hedge that names the wrong channel is worse than no hedge, because it
    // tells the reader where NOT to look. `answersByClass` rejects requests first, so a mail
    // that is both request- and verdict-shaped reads as the request.
    if (mine && sig === "review-request") requestShas.push(...shas);
    else if (toMe && answersByClass({ subject, signal: sig })) verdictShas.push(...shas);
    else if (toMe && (sig === "review-ack" || sig === "review-interim")) ackShas.push(...shas);
  }

  // ONE git process for the whole candidate set. A per-sha subprocess is the shape that
  // blew the 120 s Bash cap twice on a 34-sha list; `--batch-check` answers all of them in
  // one round trip. The `^{commit}` peel is load-bearing — it dereferences a tag, so an
  // annotated tag reports type `commit` rather than `tag` and is not silently dropped.
  // The oracle covers the PRIOR fence rows too, because hazard 1 of the monotone merge is that
  // a hand-edited line could be re-absorbed — so a carried row must still name a real commit.
  // The durable plane. Scoped to THIS seat's commits by trailer, subject-only, and capped at a
  // window wide enough to outlive the mail TTL by a large margin. Failure here is non-fatal:
  // git being unusable is already handled below by the `live === null` return, and an empty
  // fold set simply means this section behaves exactly as it did before.
  let foldShas = [];
  let labelPlaneDown = false;
  try {
    // ⛔ `separator=` IS LOAD-BEARING. Without it `valueonly` emits a NEWLINE after the value,
    // so every commit spans TWO lines — the trailer alone, then the separator+subject — and a
    // `startsWith(sid)` filter matches the trailer-only line, which carries no subject. The
    // first version of this shipped without it and found ZERO folds while the self-test stayed
    // green, because the self-test covers the PURE parser and not this IO. Codified in
    // `.claude/rules/bash-environment.md` § False non-zeros; I walked into it anyway.
    const raw = execFileSync("git", ["log", "--max-count=2000",
      "--format=%H%x1f%(trailers:key=Claude-Session,valueonly,separator=)%x1f%s"],
      // execFileSync's default maxBuffer is 1 MiB and THROWS on overflow. This call returns
      // 363,400 B at --max-count=2000 and 1,063,652 B at 6000, so widening past ~5,900 commits lands
      // in the catch and renders `foldShas = []` -- byte-identical to THIS SEAT HAS NO FOLDS.
      { encoding: "utf8", maxBuffer: 8 << 20 });
    // THE LOAD-BEARING ARM: six single-token mutations on this IO path revert the fix
    // while the pure self-test stays PASS -- including dropping `separator=`, THIS COMMIT'S OWN FIX
    // (2001 lines with it, 3993 without, both green). One line per commit is the decisive invariant.
    const nCommits = execFileSync("git", ["log", "--max-count=2000", "--format=%H"],
      { encoding: "utf8", maxBuffer: 8 << 20 }).split("\n").filter(Boolean).length;
    const nLines = raw.split("\n").filter(Boolean).length;
    if (nLines !== nCommits) throw new Error(`FOLD-PLANE-FORMAT-BROKEN: ${nLines} lines for ${nCommits} commits`);
    // WHOSE a commit is comes from the ONE classifier (scripts/session-labels.py): a seat's
    // commits carry its 8-hex id, one of its remote URLs, or a sid-closing subject scope, and
    // 2026-09-29 measured 129 of one seat's 189 as URL-form. If the classifier cannot answer,
    // fall back to the 8-hex trailer AND mark the section, never render a partial list silently.
    let mine = null;
    try {
      mine = new Set(execFileSync("python3", ["scripts/session-labels.py", "mine", "--sid", sid.slice(0, 8), "--max-count", "2000"],
        { encoding: "utf8", maxBuffer: 8 << 20, stdio: ["ignore", "pipe", "pipe"] }).split("\n").filter(Boolean));
    } catch {
      labelPlaneDown = true;
      process.stderr.write("summary-plan-sync: session-labels.py failed — fold plane reads 8-hex trailers only\n");
    }
    foldShas = parseFoldShas(raw.split("\n").filter(Boolean)
      .map((l) => l.split("\x1f"))
      .filter(([h, tr]) => (mine ? mine.has(h) : (tr ?? "").startsWith(sid.slice(0, 8))))
      .map(([, , subj]) => subj ?? ""));
  } catch (e) {
    // A FORMAT failure is NOT the durable plane being unavailable, and swallowing it in the same
    // catch is the silent-zero shape this whole commit exists to kill -- measured: the first
    // version of the invariant above threw INSIDE this try and the mutation stayed green.
    if (/FOLD-PLANE-FORMAT-BROKEN/.test(e?.message ?? "")) throw e;
    /* durable plane unavailable — the mail plane still answers */
  }

  const planeDownRow = { sha: "-".repeat(7), state: "PENDING",
    detail: "⚠️ session-labels.py could not answer — fold commits read by 8-hex trailer only, so URL-trailered folds are NOT below" };
  const all = [...new Set([...requestShas, ...verdictShas, ...ackShas, ...foldShas, ...priorRows.map((r) => r.sha)])];
  // The marker rides the EMPTY path too: an empty section with the plane down is not "none found".
  if (!all.length) return labelPlaneDown ? [planeDownRow] : [];
  const live = gitCommitFilter(all);
  if (live === null) return null;  // git unusable ⇒ NOT GATHERED. Never fall through to the
                                   // raw regex: an 8-hex session id is hex, and the mail
                                   // store is full of session ids.
  const ledger = parseLedgerShas(fs.readFileSync(ledgerPath, "utf8"));
  const fresh = deriveReviewRows({ requestShas, verdictShas, ackShas, foldShas, ledger, isCommit: (s) => live.has(s) });
  const rows = mergeMonotone(priorRows, fresh, (s) => live.has(s));
  if (labelPlaneDown) rows.unshift(planeDownRow);
  if (live.ambiguous) rows.unshift({ sha: "-".repeat(7), state: "PENDING",
    detail: `⚠️ ${live.ambiguous} candidate(s) git could not resolve — ambiguous short prefix; those rows are NOT below` });
  return rows;
}

/** Which of these candidates are real commits? Returns a Set of the candidates AS SPELLED,
 *  or null if git could not answer.
 *
 *  ⛔ `%(rest)` IS LOAD-BEARING AND ITS ABSENCE IS A SILENT TOTAL FALSE ZERO. A bare
 *  `--batch-check` prints the FULL 40-char oid and never echoes your input, so a 9-char
 *  candidate can never be found in its own result set: measured 2026-09-13, the first
 *  version of this function returned an empty Set for EVERY input and the section rendered
 *  a clean "(none found)" over a live, ledgered review. Nothing about that output looks
 *  wrong — which is the whole hazard. `%(rest)` echoes the candidate back beside the type.
 *
 *  ⛔ AND THE TWO OUTPUT SHAPES ARE NOT THE SAME FORMAT. A resolved object honours the
 *  format string (`commit <sha>`); a MISSING one ignores it and echoes the raw input
 *  line (`deadbeef^{commit} missing`). Parse for the found shape and drop the rest — do
 *  not assume one grammar. */
export function gitCommitFilter(candidates, runner = null) {
  // ⛔ STDERR IS READ, NOT DISCARDED. This was `stdio: [...,"ignore"]`, and an
  // AMBIGUOUS short prefix is the case that breaks: git prints `<name> missing` on STDOUT —
  // indistinguishable from a genuine non-commit — while the only diagnosis, `error: short
  // object ID … is ambiguous`, goes to STDERR. The row then vanished entirely: not LEDGERED,
  // not PENDING, not rendered. Latent today (0 on the live request leg) but the floor here is
  // 7 chars and there are 10 ambiguous 7-char prefixes in 17,444 commits, so it is one short
  // sha away. The in-repo precedent routes every instrument failure to SURFACE.
  const run = runner || ((input) => {
    const r = spawnSync("git", ["cat-file", "--batch-check=%(objecttype) %(rest)"],
      { input, encoding: "utf8", maxBuffer: 8 << 20 });
    if (r.error) throw r.error;
    return { stdout: r.stdout || "", stderr: r.stderr || "" };
  });
  try {
    const raw = run(candidates.map((s) => `${s}^{commit} ${s}`).join("\n") + "\n");
    // A string runner (the self-test's) is treated as stdout with no stderr, so both shapes work.
    const { stdout, stderr } = typeof raw === "string" ? { stdout: raw, stderr: "" } : raw;
    const live = new Set();
    for (const l of stdout.split("\n")) {
      const m = l.match(/^commit\s+([0-9a-f]{7,40})\s*$/);
      if (m) live.add(m[1]);
    }
    const ambiguous = (stderr.match(/^error: short object ID/gm) || []).length;
    live.ambiguous = ambiguous;     // read by the renderer; 0 on every healthy run
    return live;
  } catch { return null; }
}

// ------------------------------------------------------------------ main
// ⛔ THIS BLOCK WAS TOP-LEVEL AND UNGUARDED UNTIL 2026-08-25, SO `import`ING THIS MODULE
// RAN IT AND WROTE TO DISK (a bare importer produced
// "PLAN-SYNC: UPDATED" before its own first line executed). Two consequences, both real
// on this tree: the exports below were unusable from a test file — with no plan present
// main reached NO-PLAN and process.exit(0), killing the importer before its body ran —
// and sub-agents SHARE this worktree, so any node process rooted here that imported this
// file wrote plans/session-<sid8>-*.md. A module with an export surface gets a main
// guard; the guard is what makes the exports testable at all.
function main() {
  const argv = process.argv.slice(2);

  // ⛔ BOTH CHECKS SIT ABOVE EVERY OTHER BRANCH, AND THE ORDER IS LOAD-BEARING:
  // this function's only other exits are a write and a self-test run, so an
  // argument that reaches past here has already chosen one of them.
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("Usage: node scripts/summary-plan-sync.mjs [--check] [--sid <8hex>] [--plan <path>]");
    console.log("       node scripts/summary-plan-sync.mjs --self-test");
    console.log("  --check   report only, never write. Exit 0 = current, 3 = would change.");
    console.log("  --help    print this and exit 0. Never writes.");
    console.log("  default   sync. Prints one verdict token: CURRENT | UPDATED | NO-PLAN, or REFUSED (exit 1) when the plan changed while the sync ran.");
    process.exit(0);
  }
  const bad = unknownArg(argv);
  if (bad !== null) {
    console.error(`summary-plan-sync: unrecognised argument ${JSON.stringify(bad)} — refusing rather than falling through to the write. See --help.`);
    process.exit(2);
  }

  if (argv.includes("--self-test")) selfTest();

  const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const sid = flag("--sid") || (process.env.CLAUDE_CODE_SESSION_ID || "").split("-")[0];
  if (!/^[0-9a-f]{8}$/.test(sid || "")) {
    console.error(`summary-plan-sync: no usable session id (got ${JSON.stringify(sid)}). Pass --sid <8hex>.`);
    process.exit(2);
  }
  const planPath = flag("--plan") || findPlan(sid);
  if (!planPath || !fs.existsSync(planPath)) { console.log("PLAN-SYNC: NO-PLAN"); process.exit(0); }

  const todoPath = "todo.txt";
  if (!fs.existsSync(todoPath)) { console.error("summary-plan-sync: todo.txt not found"); process.exit(2); }

  // ⛔ THE PLAN IS READ BEFORE THE BLOCK IS BUILT, because the monotone merge needs the rows
  // already in the fence. That makes the output depend on its own prior content — hazard 3 of
  // their recommendation — which is why the self-test owes an IDEMPOTENCE arm and a
  // REFUSED-DOWNGRADE arm, and has both.
  const before = fs.readFileSync(planPath, "utf8");
  // Stderr, so the one stdout verdict token callers read is unchanged; runs on every path,
  // --check included, because it reads and never writes.
  // Compare with the plan's LAST WRITE, not now: /summary and /post-compact sync BEFORE the
  // prose is written, so a heading a minute ahead is checked only at the next run, by when the
  // clock has passed it. mtime is never earlier than the write that typed the heading.
  const asOf = Math.min(Date.now(), fs.statSync(planPath).mtimeMs);
  const ahead = futureHeadings(before, asOf);
  const clock = clockSuffix(ahead);
  if (ahead.length) {
    console.error(`PLAN-SYNC WARN: ${ahead.length} dated heading(s) are AHEAD of the plan's last write (${new Date(asOf).toISOString().slice(11, 16)}Z) — re-derive the time from \`date -u\` and fix the heading:`);
    for (const h of ahead) console.error(`  · ${h}`);
    console.error("  (Only FUTURE times are caught; a heading typed behind the clock is not.)");
  }
  const block = deriveBlock(fs.readFileSync(todoPath, "utf8"), sid, gatherReviewRows(sid, parseFenceRows(before)));
  const spliced = spliceFence(before, block);
  // A plan past 200,000 bytes moves its oldest dated blocks to part files here; the parts are written
  // first (rollText), so a failure between the two writes leaves a duplicate, never a loss.
  const check = argv.includes("--check");
  // A second sync of this plan that wrote between our read and here would be undone by our write, and a roll
  // from the stale read would leave the other sync's part file pointed at by nothing. Refuse instead.
  if (!check && fs.readFileSync(planPath, "utf8") !== before) {
    console.log(`PLAN-SYNC: REFUSED ${planPath} — the plan changed while this sync ran; run it again`);
    process.exit(1);
  }
  const roll = rollText(spliced, planPath, { write: !check });
  const after = roll.status === "rolled" ? roll.live : spliced;
  const rolled = rollWords(roll, { check });
  // On every run, not only the one that rolls: a part file left untracked is how a plan commit ends up
  // holding stubs whose text is in no commit.
  const partsNote = untrackedPartsNote(untrackedParts(planPath));

  if (after === before) { console.log(`PLAN-SYNC: CURRENT ${planPath}${clock}${rolled}${partsNote}`); process.exit(0); }
  if (check) { console.log(`PLAN-SYNC: WOULD-UPDATE ${planPath}${clock}${rolled}${partsNote}`); process.exit(3); }
  fs.writeFileSync(planPath, after);
  console.log(`PLAN-SYNC: UPDATED ${planPath}${clock}${rolled}${partsNote}`);
}

/** The plan's `-partN.md` files on disk that HEAD does not hold (a staged part counts as missing). The check runs in the plan's own
 *  directory, so it asks the repository the plan lives in, whatever the cwd. */
export function untrackedParts(planPath) {
  const dir = path.dirname(path.resolve(planPath));
  return partNumbersOnDisk(planPath).sort((a, b) => a - b)
    .map((n) => planPath.replace(/\.md$/, `-part${n}.md`))
    .filter((p) => !spawnSync("git", ["ls-tree", "--name-only", "HEAD", "--", path.resolve(p)], { cwd: dir, encoding: "utf8" }).stdout?.trim());
}

export function untrackedPartsNote(paths) {
  return paths.length ? ` — part file(s) NOT TRACKED: ${paths.join(", ")}; commit them with the plan` : "";
}

// Symlink-safe: `pathToFileURL(argv[1])` keeps the typed spelling while `import.meta.url` is
// canonicalised, so the naive compare ran NOTHING through a symlink (measured 56 B real, 0 B
// symlinked, both rc=0). SSOT: scripts/lib/is-main.mjs.
if (isMainModule(import.meta.url)) main();
