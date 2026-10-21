// The ONE parser for the review ledger. Two instruments read that file —
// `summary-plan-sync.mjs` (the /summary plan fence) and `review-request-closure-scan.mjs`
// (the hub's queue) — and until 2026-09-22 each carried its own parser with its own defect:
//
//   · the scan kept the OLDEST row per sha (`if (!out.has(k))`), the exact first-wins bug the
//     summary parser had already fixed on 2026-09-13; and
//   · BOTH classified on "a verdict word appears ANYWHERE in the cell", which the ledger's
//     prose state column defeats: an arrival row narrates other verdicts ("ARRIVED … FOLD-VERIFY
//     OWED", "QUEUED … APPROVED last round"), so a review that had not started read FINISHED.
//
// A review measured both: the existing parser read six real arrival rows as dispositive, and
// the reviewed commit's own QUEUED row as a
// dispositive CHANGES-REQUESTED. The remedy: one shared parser, newest row wins, classified on
// the row's LEADING disposition with an explicit arrival-word list. The ledger also keeps
// the invariant this rests on — the first bold token of the state column IS the disposition —
// so reading the leading window is reading a convention, not guessing at prose.
//
// Lives in `lib/` because summary-plan-sync imports FROM the closure scan; a direct import back
// would be a cycle.

/** Verdict vocabulary, DERIVED from the ledger's own state column rather than guessed
 *  (2026-09-13: 53 CHANGES-REQUESTED, 31 APPROVED, 21+21 FOLD-VERIFY/FOLD-VERIFIED, 12
 *  APPROVED-WITH-FINDINGS, then a tail). Order no longer decides a match — position does, see
 *  `classifyVerdictCell` — but the list is kept longest-first so a reader can see which words
 *  contain which. UNRESOLVED keeps its leading slot for the same reason it had one: it is a
 *  terminal state whose cell narrates the verdicts before it. */
export const VERDICT_WORDS = [
  "UNRESOLVED",
  "APPROVED-WITH-FINDINGS", "APPROVE-WITH-FINDINGS", "RETROACTIVE-BACKFILL", "CHANGES-REQUESTED", "TERMINAL-VERDICT",
  "SELF-RETRACTION", "NO-REVIEW-OWED", "FOLD-VERIFIED", "HOLD-LIFTED", "ALTERNATIVE", "DISCHARGED",
  "FOLD-VERIFY", "APPROVED", "ANSWERED", "APPROVE", "REFUTED", "INTERIM", "REJECTED", "REJECT", "LIFTED", "CLOSED", "ACKED", "HOLD", "KEEP",
];

/** Which of those words actually DISPOSE of a review. `FOLD-VERIFY`/`FOLD-VERIFIED` close a loop
 *  and belong here (46 shas at 2026-09-13). INTERIM, ACKED, HOLD and KEEP settle nothing.
 *  ANSWERED, RETROACTIVE-BACKFILL and TERMINAL-VERDICT were added 2026-09-22:
 *  15 real verdict rows opening "TERMINAL VERDICT SENT …" read OPEN without them. HOLD-LIFTED,
 *  NO-REVIEW-OWED and DISCHARGED were added the same day off this seat's own old-vs-new diff over the
 *  whole ledger: without them "HOLD LIFTED …", "NO REVIEW OWED — FYI, ACKED …" and "SHIP GATE
 *  DISCHARGED …" read as HOLD / ACKED / unparsed, i.e. finished reviews reading open. */
export const DISPOSITIVE_VERDICTS = new Set([
  "UNRESOLVED", "APPROVED-WITH-FINDINGS", "APPROVE-WITH-FINDINGS", "RETROACTIVE-BACKFILL", "CHANGES-REQUESTED",
  "TERMINAL-VERDICT", "SELF-RETRACTION", "NO-REVIEW-OWED", "FOLD-VERIFIED", "HOLD-LIFTED",
  "ALTERNATIVE", "DISCHARGED", "FOLD-VERIFY", "APPROVED", "ANSWERED", "APPROVE", "REFUTED", "REJECTED", "REJECT", "LIFTED", "CLOSED",
]);

/** ⛔ ARRIVAL WORDS — a row that OPENS with one of these records that a request ARRIVED or is in
 *  flight, whatever verdict words its prose goes on to mention. This list was derived
 *  from the live ledger; `HOLD-NOT` is there because its first draft lacked it and falsely
 *  closed a "HOLD NOT DISCHARGED" row. Written against the NORMALISED text, where every
 *  whitespace run is a single `-`. At the same position an arrival phrase beats a verdict word,
 *  which is what makes "FOLD-VERIFY REQUESTED" an arrival and "FOLD-VERIFIED" a verdict. */
const ARRIVAL_ALTERNATION = "QUEUED|PENDING|INTERIM|PANEL-(?:OUT|SEATED|OF)|ARRIVED|ON-ARRIVAL|NOT-YET-STARTED|IN-PROGRESS|IN-REVIEW|DISPATCHED|ACK(?:ED)?|VERDICT-PENDING|RE-OPENED|IN-FLIGHT|NOT-TERMINAL|PARTIAL|HOLD-NOT|FOLD-VERIFY-(?:REQUESTED|OWED|IN-PROGRESS)|LOOP-(?:NOT-CLOSED|STAYS-OPEN)";
// IN-REVIEW and FOLD-VERIFY-IN-PROGRESS were added 2026-10-12: rows opening
// "IN REVIEW (fold-verify: …)" / "IN REVIEW (usage hold lifted …)" / "FOLD-VERIFY IN PROGRESS (…)" read as
// FOLD-VERIFY, HOLD-LIFTED, LIFTED or CLOSED, i.e. a review still running read FINISHED (20 rows measured,
// the newest four FOLD-VERIFY labels among them).
export const ARRIVAL_WORDS = new RegExp(`\\b(${ARRIVAL_ALTERNATION})\\b`, "g");

/** A LEADING run of arrival words joined by arrows that ENDS in "IN REVIEW →" and hands straight to a verdict
 *  word is the row's HISTORY, and its state is that verdict: "IN REVIEW → CHANGES-REQUESTED (…)" and
 *  "QUEUED → IN REVIEW → APPROVED" are finished reviews. Without this, adding IN-REVIEW above
 *  turned that one real verdict non-dispositive. Both ends are load-bearing (a review,
 *  two seats, one rule): the last state before the verdict must be IN-REVIEW, because "QUEUED → FOLD-VERIFY after
 *  the fold lands" names the AWAITED step; and the verdict word must follow the arrow directly, because
 *  "IN REVIEW → qa APPROVED, security pending" is still in flight. Only arrival words are stripped: a
 *  verdict before an arrow ("APPROVED-WITH-FINDINGS → FOLD-VERIFIED") keeps its leading reading, and other arrow
 *  spellings (⇒, "(pos 1/1) →") read as in flight, the safe direction. */
const ARRIVAL_HISTORY = new RegExp(
  `^(?:(?:${ARRIVAL_ALTERNATION})-*(?:→|->)-*)*IN-REVIEW-*(?:→|->)-*(?=(?:${VERDICT_WORDS.join("|")})(?![A-Z0-9]))`);

/** How much of the state cell is the disposition: ~70 chars after stripping emoji
 *  and markup. The house openings (`🔬 **QUEUED`, `✅ **TERMINAL VERDICT — CHANGES REQUESTED**`)
 *  all resolve well inside it, and the prose that narrates OTHER verdicts sits after it. */
export const LEADING_WINDOW = 70;

/** Strip markup and uppercase; every whitespace/underscore run becomes one `-`, so
 *  `APPROVED WITH FINDINGS` and `APPROVED-WITH-FINDINGS` are one spelling (2026-09-13). */
export function normalizeVerdictText(s) {
  return String(s).replace(/[*_`]/g, "").toUpperCase().replace(/[\s_]+/g, "-");
}

/** The leading disposition window: emoji, variation selectors and markup removed, trimmed, then
 *  cut to LEADING_WINDOW characters, then normalised. */
export function leadingWindow(cell) {
  const plain = String(cell)
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[*_`]/g, "")
    .trim();
  return normalizeVerdictText(plain.slice(0, LEADING_WINDOW));
}

const VERDICT_RE = new RegExp(
  `(?<![A-Z0-9])(?<!NOT-)(${VERDICT_WORDS.join("|")})(?![A-Z0-9])`, "g");
// ⛔ `(?<!NOT-)` — a verdict word NEGATED in place ("GATE NOT DISCHARGED", "NOT APPROVED") is not that
// verdict. Without it a newly added word like DISCHARGED would close the row that denies it.

/** Classify one state cell. Earliest match wins; at the same position the LONGER match wins
 *  (so APPROVED-WITH-FINDINGS beats APPROVED, FOLD-VERIFY-REQUESTED beats FOLD-VERIFY); an
 *  arrival phrase at or before the first verdict word makes the row non-dispositive.
 *  TERMINAL-VERDICT is dispositive but says nothing about WHICH verdict, so the label is the next
 *  verdict word in the window when there is one. Returns {verdict, dispositive}. */
export function classifyVerdictCell(cell) {
  const w = leadingWindow(cell).replace(ARRIVAL_HISTORY, "");
  const first = (re) => {
    let best = null;
    for (const m of w.matchAll(re)) {
      if (!best || m.index < best.index || (m.index === best.index && m[0].length > best[0].length)) best = m;
    }
    return best;
  };
  const v = first(VERDICT_RE);
  const a = first(ARRIVAL_WORDS);
  if (a && (!v || a.index < v.index || (a.index === v.index && a[0].length >= v[0].length))) {
    const label = v && v.index === a.index && v[0] === a[0] ? v[0] : `ARRIVAL:${a[0]}`;
    return { verdict: label, dispositive: false };
  }
  if (!v) return { verdict: "(unparsed)", dispositive: false };
  let verdict = v[0];
  if (verdict === "TERMINAL-VERDICT") {
    const rest = [...w.slice(v.index + v[0].length).matchAll(VERDICT_RE)]
      .find((m) => m[0] !== "TERMINAL-VERDICT");
    if (rest) verdict = rest[0];
  }
  return { verdict, dispositive: DISPOSITIVE_VERDICTS.has(verdict) || v[0] === "TERMINAL-VERDICT" };
}

/** Hex tokens that COULD be a sha. Candidates only — a 7-40 hex run also matches an 8-hex
 *  session id and an all-digit token, so the caller validates against git where it matters. */
export function extractShas(text) {
  return [...new Set((String(text).match(/\b[0-9a-f]{7,40}\b/g) || []))];
}

/** The sha SET of a Commit cell: tokens before the first ` (` or ` — ` only. A review
 *  measured 119 Commit cells carrying prose that cites OTHER shas ("the fold of my
 *  terminal verdict"), so reading the whole cell let a fold row close the original target. */
export function commitCellShas(cell) {
  const s = String(cell);
  const cut = s.search(/ \(| — /);
  return extractShas(cut === -1 ? s : s.slice(0, cut));
}

/** The ledger's ROW GRAMMAR, the one place it is written: a line starting `|` that splits into at least
 *  six pieces (Date | Commit | Verdict | Reviewer — older rows end there, so Mail and Note may be empty).
 *  Yields the 1-based line and the named cells, unparsed. `note` re-joins everything after Mail, so a `|`
 *  inside the Note survives; a `|` (escaped or not) inside an EARLIER cell still shifts the columns, for
 *  every reader at once. Each reader decides which cells name a commit — this decides only what a row is. */
export function* ledgerRows(ledgerText) {
  const lines = String(ledgerText).split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("|")) continue;
    const c = lines[i].split("|");
    if (c.length < 6) continue;
    yield { line: i + 1, date: c[1], commit: c[2], verdict: c[3], reviewer: c[4], mail: c[5], note: c.slice(6).join("|") };
  }
}

/** sha -> {verdict, reviewer, dispositive, when}. ⛔ NEWEST ROW WINS: the ledger is append-ordered,
 *  newest at the bottom, so `out.set` on every row is what serves the current state. A first-wins
 *  guard served the superseded verdict in 6 of 6 multi-row disagreements on 2026-09-13 and again
 *  (older FOLD-VERIFIED, newer "DO NOT SHIP …") on 2026-09-22. */
export function parseLedgerShas(ledgerText) {
  const out = new Map();
  for (const r of ledgerRows(ledgerText)) {
    const shas = commitCellShas(r.commit);
    if (!shas.length) continue;
    const { verdict, dispositive } = classifyVerdictCell(r.verdict);
    const reviewer = (extractShas(r.reviewer)[0] || "").slice(0, 8) || "(none)";
    const when = r.date.trim();
    for (const s of shas) out.set(s, { verdict, reviewer, dispositive, when });
  }
  return out;
}

/** Prefix-tolerant lookup: the ledger writes 9 chars and a mail body may write 7 or 40. Compares
 *  on the SHORTER of the two, with a 7-char floor. */
export function lookupSha(map, sha) {
  if (map.has(sha)) return map.get(sha);
  for (const [k, v] of map) {
    const n = Math.min(k.length, sha.length);
    if (n >= 7 && k.slice(0, n) === sha.slice(0, n)) return v;
  }
  return null;
}
