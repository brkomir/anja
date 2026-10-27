#!/usr/bin/env node
// review-request-closure-scan.mjs — the HUB-SIDE mirror of
// review-verdict-disposition-scan.mjs.
//
// ⛔ KNOWN AND KNOWINGLY UNHANDLED: A **DECLINED** SHA RENDERS IDENTICALLY TO AN UNANSWERED ONE.
// This scan keys on the sha, so a commit whose request explicitly asked NOT to be reviewed stays
// OPEN forever. Measured 2026-09-05: 3
// shas cited, 2 answered, and the 1 "unanswered" was a sha the request's own prose
// had declined — "NOT ASKING YOU TO REVIEW … tracker rows plus two plans documents, zero code".
//
// WHY IT IS NOT FIXED, AND WHY THAT IS THE RIGHT CALL. The bind is structural: correct reviewer
// behaviour is exactly what keeps the row open, because a hub must not name a verdict on a commit
// it was asked not to review. Closing it in code means parsing intent out of prose — "a parser for
// 'NOT ASKING YOU TO REVIEW' is a worse idea than the problem", and no fix was proposed. A prose
// parser would be a new false-positive surface on a
// gate whose whole value is that its positives are trustworthy.
//
// THE CHEAP DISPOSITION, which costs the requester one line: name the declined sha in a follow-up
// so it resolves as answered. That keeps the scan's predicate simple and puts the one bit of
// intent where a human already is.
//
// WHY THIS EXISTS. The disposition scan answers "a verdict came to me and I never
// folded its findings." Nothing answered the OTHER direction: "a REQUEST came to me
// and I never sent a verdict." That is the review hub's characteristic failure, and
// it is invisible to every existing net:
//   - the mail LISTENER surfaces on ARRIVAL and never marks consumption, so the
//     unread marker is not a disposition signal (measured 2026-08-07: 11 direct +
//     24 broadcast read as "unread" on a hub that had served every one).
//   - `mail-check` shows unread only — a read-but-unanswered request is invisible.
//   - recall substitutes the waves you REMEMBER serving for the store's inbound
//     (measured twice: a retiring hub reported an empty queue with an unopened
//     request in the store; its successor did the same four times).
//
// KEYED ON SHA, NOT SUBJECT. An ad-hoc matcher written 2026-08-07 keyed on subject
// keywords and produced a FALSE POSITIVE: the final verdict's subject led with the
// finding ("FINAL — 4/4 lenses. Found INDEPENDENTLY...") instead of the SHA, so
// the request looked unanswered. A SHA appears in both the request and any verdict
// about it, and does not vary with how the verdict is titled.
//
// REPORTS, NEVER CONCLUDES. Output is a per-request row with the evidence. A row is
// a prompt to look, not a verdict about your own queue.
//
// ⛔ ADDRESSED-TO IS PART OF THE KEY (instance #2, 2026-08-11).
// The `answered` index used to be a FLAT SET OF SHAS built from the whole outbound
// stream, so the CONTAMINATION SURFACE WAS EVERY MAIL THIS SEAT HAD EVER SENT — a
// message to a DIFFERENT peer on a DIFFERENT subject closed a review request merely
// by naming its sha. Reproduced from the store at the moment the scan ran: request
// (<requester-session-id> -> <recipient-session-id>) was closed by <recipient-session-id>'s mail to **<third-party-session-id>**
// titled "Escaped-quote correction VERIFIED and applied to all 8 agent surfaces",
// whose only ANSWERS token was one instance of the word "verdict". A sibling mail in
// the same thread closed it via the sentence *"Separately I have 1 of 4 lenses back
// on <requester-session-id>'s <commit-id>"* — literal content: THIS REVIEW HAS NOT HAPPENED YET.
//
// The index is now keyed (sha -> recipients), and a request closes only when some
// answering outbound went to THE REQUESTER (or was a broadcast). This is the
// STRUCTURAL axis the row asked for, deliberately NOT a tightening of ANSWERS — see
// the DO-NOT-NARROW note on that regex below; a use-vs-mention split inside one mail
// body is the residue a string matcher cannot remove, and it is untouched here.
//
// ⛔ THAT RESIDUE HAS TWO **OVER-REPORTING** SYMPTOMS, EACH PUNISHING A DIFFERENT HALF OF GOOD
// PRACTICE. They are the SAFE direction. ⚠️ THIS BLOCK READ "TWO SYMMETRIC SYMPTOMS ... BOTH ARE
// OVER-REPORTS" UNTIL 2026-08-22, WHICH IS A CLOSED ENUMERATION THIS SAME FILE REFUTES 50 LINES
// DOWN: the ANSWERS DO-NOT-NARROW note at :98 documents a THIRD symptom of the same residue in
// the UNDER-reporting direction and calls it "the dangerous direction" — one token anywhere in a
// mail body marks EVERY sha in it answered, so a sentence that explicitly says a verdict has NOT
// been delivered still closes the row. A reader who stops at this banner (it sits ABOVE that note)
// carries away "this instrument only cries wolf", so a false CLOSE never gets hunted. MEASURED
// COST, 2026-08-22: a fresh-context agent reading this file rediscovered the under-report as a
// novel gap, from scratch, because this block told it the taxonomy was complete. Read :98 before
// reasoning about this instrument's failure direction. The two below are NOT the whole set, and
// neither is fixable by a string matcher:
//   OMIT the sha from a verdict  -> the REQUEST-HOLDER's scan reports the answered request OPEN
//                                   (the verdict never enters the ledger; measured
//                                   on two shas answered in full and cited in neither mail).
//   CITE the sha in a verdict    -> the RECIPIENT's scan reads the citation as a REQUEST, so a
//                                   sha you name to say "this one is CLOSED" becomes an open
//                                   obligation on them (measured: a sha cited as closed
//                                   in the same mail the scan then flagged it unanswered from).
// So a thorough verdict manufactures rows by being thorough, and a terse one strands its own.
//   CITE a CONTEXT sha in a REQUEST -> the whole request reads OPEN forever, because ANY unmatched
//                                   sha anywhere in the body flags it. The REQUESTER-side twin of
//                                   the two above, and the fourth symptom of this one residue
//                                   (2026-08-26: the subject named the one
//                                   target, the body cited two other shas to explain what
//                                   the change was correcting, and the row read OPEN on a loop
//                                   that had closed with three verdicts and a fold-verify).
// ⭐ AND THAT ROW NAMES THE DISCRIMINATING FIELD THE OTHER THREE DO NOT: it is the SUBJECT line's
// sha, never the body's. If this scan is ever tightened, that is the field to key on — and note
// what the four symptoms have in common, because it is the reason "be more careful" cannot fix
// any of them: EVERY ONE OF THE FOUR BEHAVIOURS IS CORRECT IN ITS OWN TERMS. A verdict SHOULD
// lead with the finding. A request SHOULD explain its context. The instrument punishes good
// practice on both sides of the wire, which is why the remedy is a field choice and never a
// discipline.
// READ THE THREAD before acting on any row here — the footer already says so, and that is what
// caught both of these. Do NOT tighten ANSWERS to chase either symptom (see the DO-NOT-NARROW
// note); the discriminator is intent, and intent is not in the string.
//
// ⚠️ WHAT THIS DOES NOT CLOSE. Contamination from a mail to the REQUESTER that names
// the sha non-dispositionally (an ACK, a heads-up, a progress note) still closes the
// row — measured on this same thread, where the heads-up disclosing the false close
// was itself ANSWERS-matching, addressed to the requester, and naming the sha. The
// fix removes the CROSS-THREAD surface (every other peer's thread), not the
// same-thread one. And REQUESTER SESSION-ROTATION: `m.from` pins the sending sid, so
// a requester who /clears to a fresh session leaves their row OPEN permanently —
// the safe direction (over-report), absorbable via DISMISS_FILE when it fires.
//
// BROADCASTS ANSWER ONLY WHEN SIGNAL-TYPED `deploy-*`. An earlier revision indexed
// EVERY `to: all` mail, justified by "16 of 154 mails are to:all; excluding them
// would strand every broadcast verdict OPEN" — a count of BROADCASTS offered as
// evidence about broadcast VERDICTS. Measured on the live store (2026-08-12):
// 0 of 18 broadcasts carry a deploy-* signal, 0 rows close via broadcast alone, and
// one ANSWERS-matching broadcast literally reads "This is a HOLD, not a verdict"
// while naming two real shas — so the unsigned-broadcast leg was a FLEET-scoped
// contamination surface with zero legitimate closures behind it. It fired live the
// same day: the hub's own queue read 18/18 answered while a Paddle-legal commit
// had never been reviewed. The discriminator reuses the store's own
// convention: a `--code` VERDICT carries `signal: deploy-*` frontmatter
// (review-hub/SKILL.md; `_is_verdict_mail` in session-manifest.py keys the pruner's
// 72h verdict carve-out on exactly this). This gates a FRONTMATTER KEY — it does
// NOT narrow the ANSWERS body matcher, which the DO-NOT-NARROW note below governs.
//
// ⛔ THIS SCAN IS SESSION-SCOPED, SO TWO SEATS RUNNING IT READ DISJOINT POPULATIONS —
// AND "IT DOES NOT REPRODUCE ON MY RUN" THEREFORE CARRIES NO INFORMATION IN EITHER
// DIRECTION. Identity comes from `CLAUDE_CODE_SESSION_ID` (sliced to 8 hex below);
// main() REFUSES rather than guessing without it; parseMailDir admits direct inbound
// only when `to === self`; and the DISMISS_FILE is sid-keyed too. What prints is ONE
// SEAT'S queue, never the fleet's. Measured on this store the same day this note was
// written — same command, same minute, three identities:
//     <seat-a-session-id> -> 120 requests   <seat-b-session-id> -> 30   <seat-c-session-id> -> 3
//
// IT HAS ALREADY COST A FALSE REFUTATION (2026-09-02). <seat-b-session-id> reported a sha reading
// as an unanswered TARGET on their run; <seat-a-session-id> ran the scan, saw that sha credited as
// answered, and replied "does not reproduce here". BOTH READINGS WERE CORRECT — they
// were reading different mails. <seat-b-session-id>'s row was a HANDOVER addressed to THEM;
// <seat-a-session-id>'s was a separate `--code request` addressed to IT. Neither run can see the
// other's inbound BY CONSTRUCTION, so the check was vacuous before it was run.
//
// ⭐ SO TO CHECK ANOTHER SEAT'S READING, RUN IT AS THEM — the whole remedy is one env:
//     CLAUDE_CODE_SESSION_ID=<their-sid8> node scripts/review-request-closure-scan.mjs
// This is the vacuous-control shape moved from probe DESIGN to CLAIM VERIFICATION: the
// codified ways all ask whether a probe could have returned the OTHER answer, and this
// one asks whether the POPULATION could have contained the phenomenon at all.

import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isMain as isMainModule } from "./lib/is-main.mjs";
import { parseLedgerShas, lookupSha } from "./lib/review-ledger.mjs";
// FF_MAIL_DIR mirrors the sibling scan's override so a fixture store can be pointed
// at without touching the real one.
const MAIL = process.env.FF_MAIL_DIR || ".claude/state/session-mail";
// The seat whose queue this reads: `--sid <sid8>` names it, else the environment's identity.
const ENV_ME = (process.env.CLAUDE_CODE_SESSION_ID || "").slice(0, 8);

const SHA = /\b[0-9a-f]{7,12}\b/g;
// A request ASKS. Matched on the body+subject, deliberately broad — a missed
// request is the expensive direction; a false request row costs one glance.
// `review[- ]request` (hyphen tolerated): the typed `signal: review-request` subject form
// was INVISIBLE here — the space-only literal missed it, and a real money-touching arm
// (2026-08-25) was never enumerated by this predicate.
const ASKS = /--code|review[- ]request(ed)?|refute mandate|please review|re-review/i;
// A verdict ANSWERS. Also broad, and it does not need to be well-formed: any
// outbound mail naming the SHA in a dispositional way counts as having answered.
// ⛔ KNOWN LIMIT, MEASURED 2026-08-09, AND IT FAILS IN THE UNDER-REPORTING DIRECTION.
// This tests the WHOLE mail body, so ONE token match marks EVERY sha in that mail answered —
// including a sha cited merely as EVIDENCE for something else. Live instance: a reply about a
// safe-commit tooling defect cited a commit as the rename example, and the only ANSWERS token
// in the whole mail was the word "Verdict" in the sentence *"Verdict follows when both land."* —
// a sentence that explicitly says the verdict has NOT been delivered. It closed the row anyway.
// This is the dangerous direction: the over-report side merely cries wolf, this one STRANDS work
// silently, which is the exact failure this scan was built to catch.
// DO NOT "fix" it by narrowing ANSWERS against that one instance — a not-yet-phrasing blocklist
// derived from a single mail is the corpus-shaped guard this repo keeps re-learning. The
// hypothesis worth TESTING (against the 400+ outbound mails already on disk, which is a free
// labelled corpus) is structural: a real verdict announces itself in the SUBJECT, an
// evidence-citing mail does not. Measure that before changing anything.
// ⛔ RETIRED 2026-09-03 — the body matcher is GONE, not narrowed. It lived here and was
// tested against the WHOLE MAIL, which is the fourth failure mode: 21 of 25 ACK-shaped mails
// credited shas because their bodies said "verdict" while discussing something else. The
// DO-NOT-NARROW note above was right that a keyword blocklist was the wrong answer, and it
// named the right one — a real verdict announces itself in the SUBJECT. That hypothesis is
// now measured and shipped as ANSWER_CLASS_SUBJ / ANSWER_CLASS_SIG at buildAnsweredIndex.
// The prose above is kept as the history of three symptoms of one residue; the const is not,
// because a dead regex that reads as the governing predicate is worse than no regex.

// ── TARGET vs CONTEXT: which cited shas are actually work owed ────────────────
// Residual mechanism (1), measured 2026-09-02 on a live hub queue ~19
// min after a commit landed: every sha-shaped token in a request body was treated
// as a review target, so a GDPR request citing a sha as BACKGROUND ("Since <sha>
// a suspended…") read OPEN on an already-verdicted request. The header
// block above named the discriminating field years before it was used — "it is the
// SUBJECT line's sha, never the body's" — and that field choice is HALF right.
//
// ⛔ SUBJECT-ONLY IS REFUTED, MEASURED, AND IT FAILS IN THE EXPENSIVE DIRECTION.
// Over the 1,441-mail store: 17 of <seat-a-session-id>'s 119 ASKS-matching inbound name NO sha
// in the subject, and they are the BATCH class — "--code BATCH: 8 commits from this
// session no reviewer has seen", "BATCH-10 — 15 unsent risk-bearing commits". Those
// are the highest-value requests in the corpus and subject-only keying DROPS every
// one. Pure subject-PREFERENCE (subject when present, body otherwise) is refuted
// too, one step further in: it demoted 4 real targets of "the alias-dedupe arc, 5
// commits, <commit-id> is the load-bearing one" and 6 of "comparison go-round --code
// request: SIX commits", whose subjects name one sha and whose bodies list the rest.
//
// SO THE UNION IS THE PREDICATE: a target is announced either in the SUBJECT or at
// the HEAD OF ITS OWN LINE. House style already assumes the second — stripExcluded's
// lookahead below has keyed on a line-leading sha since it was written.
//
// ⛔ DO NOT ENUMERATE BULLET GLYPHS. The first version of this anchor listed
// `-*+•`, digits and checkboxes, and went blind to `== <sha> — prompt(...)`,
// silencing a genuine six-commit request in full (the predicate was one
// spelling of the obligation). Derived from the store instead — the leading runs
// that actually occur are `` ` `` · `**` · `- ` · `## ` · `=== ` · `== ` · `| ` ·
// `(` · `⭐ **` · `⛔ **` · `· ` · bare indentation — and the property they share is
// that MARKUP IS NON-ALPHANUMERIC while prose is not. One rule, no list to rot, and
// it still excludes the word-led prose lines (`Since <sha> a suspended…`).
//
// ⛔ PLUS ONE LABEL FORM, AND IT IS NOT COSMETIC: `Commit: <sha>` is a live
// target-announcing spelling in this store, and one of its instances is
// THE GENUINE DROP THIS WHOLE ROW WAS FILED FOR. A markup-only anchor
// reads it as prose. The colon is what keeps the label form from swallowing the
// founding false positive: `Commit: <sha>` is admitted, `Since <sha> a suspended…` is
// not, and the difference is one character. (`Commit <sha>` without the colon exists
// too, once, and falls to context — it still PRINTS there, which is the whole reason
// this predicate is allowed to be imperfect.)
//
// ⚠️ KNOWN RESIDUAL, MEASURED, AND IT FAILS SAFE: a line-oriented reader cannot tell a
// list item from a WRAPPED prose line. In the handover mail below, "…the three that
// arrived in the final half hour: `<sha> +\n<sha>`…" puts the second sha at a line
// head purely because the sentence wrapped, so it reads as a target. Same limitation
// stripExcluded already carries and names ("WRAPPED PROSE STILL OVER-REPORTS"), same
// direction: an extra row costs a glance. Not closed, deliberately — separating a wrap
// from a list needs a second predicate with its own blind spots.
// Leading markup run · then AT MOST ONE list-or-label marker · then markup again · sha.
// The marker leg carries the two ALPHANUMERIC-LED spellings the markup run cannot see:
// `1. <sha>` (59 occurrences, live in a `--code request (BATCH of 8)`) and `Commit:
// <sha>`. Both were missed by the markup-only version and both were caught by an
// arm in the test rather than by reading — which is why the ANCHOR VOCABULARY arm
// asserts a SET and prints the missing spellings instead of pinning one example.
const TARGET_ANCHOR = /^[^0-9a-zA-Z]*(?:(?:\d+[.)]|[A-Za-z]+:)[^0-9a-zA-Z]*)?([0-9a-f]{7,12})\b/;

// ⚠️ NOTHING IS HIDDEN BY THIS SPLIT. A context sha is REPORTED on its own line and
// a row carrying only unanswered context shas still PRINTS, under a separate
// lower-confidence heading — the same posture as the phantom, dismissed and
// foreign-dismissal lines below. The split moves the OPEN *classification*; it never
// removes a sha from the output, so a mis-classified target costs a glance, never a
// missed request. That is what makes the predicate safe to be wrong.
export function classifyCitedShas(text, subject) {
  const body = String(text || "");
  const subjectLine = String(subject || "");
  const subj = new Set((subjectLine.match(SHA) || []).map((s) => s.slice(0, 7)));
  const anchored = new Set();
  for (const ln of body.split("\n")) {
    const m = ln.match(TARGET_ANCHOR);
    if (m) anchored.add(m[1].slice(0, 7));
  }
  // ⛔ THE CANDIDATE SET IS BODY *UNION* SUBJECT. Deriving it from the body alone
  // typechecks, reads fine, and is correct ONLY because main() happens to pass the raw
  // mail with its `subject:` header still attached — so a subject-named target that the
  // body never repeats would vanish the moment any caller passed a clean body. That is
  // the highest-confidence target there is, dropped by an incidental coupling.
  const all = [...new Set((`${body}\n${subjectLine}`.match(SHA) || []).map((s) => s.slice(0, 7)))];
  return {
    targets: all.filter((s) => subj.has(s) || anchored.has(s)),
    context: all.filter((s) => !subj.has(s) && !anchored.has(s)),
  };
}

// ── A LEDGER-ONLY COMMIT IS CONTEXT, NEVER A TARGET ─────────
// A commit whose diff touches ONLY the review ledger is a hub's record of review state. A
// requester cites one as a BASE ("the ledger row at X") and no verdict will ever name it, so as
// a target it reads OPEN forever: a hub's own `ledger(...)` arrival-row
// commit, read OPEN here, in review-queue.py and in the poller for 54 h (2026-10-24..26). It is
// MOVED to the context tier, never dropped — the same no-silent-filter posture as the split above.
// Pure over the commit's file list against its FIRST parent (`git show --diff-merges=first-parent
// --name-only --format=`): the default combined diff lists only a merge's conflict-resolved files, so a
// merge whose one conflict was the ledger read ledger-only while it brought a branch of code. An
// unreadable sha lists nothing and is NOT ledger-only: the safe direction, it stays a target.
export const LEDGER_DOC_REL = ".claude/docs/review-ledger.md";
export function isLedgerOnlyNameList(names) {
  const n = (names || []).map((x) => String(x).trim()).filter(Boolean);
  return n.length === 1 && n[0] === LEDGER_DOC_REL;
}

// ⛔ RESIDUAL MECHANISM (3) IS NAMED-REJECTED, NOT FIXED — DO NOT RE-ATTEMPT WITHOUT
// READING THIS. Measured with (1) and (2) on 2026-09-02: a HANDOVER message read as a
// request. The retiring hub's "HANDOVER ACKED … Zero open loops transfer" cited seven
// shas as context and all seven listed as unanswered; ASKS matches because the body
// discusses `--code` routing. Two candidate predicates were built and BOTH are refuted
// on the live store:
//
//   LEXICAL — "when the subject names no sha, require the SUBJECT to ASK." Correctly
//   drops HANDOVER ACKED, "REVIEW HUB IS OPEN AGAIN", "Integration tier GREEN" and an
//   "ACCEPTED — I re-ran your measurement" reply. AND IT DROPS `BATCH-10 — 15 unsent
//   risk-bearing commits, 11 of them 3-4 days old`, a genuine review request whose
//   subject carries no request keyword. 5 of 6 right, and the 6th is a missed request:
//   the one failure direction this instrument may not have.
//
//   STRUCTURAL — "a sha the REQUESTER has themselves verdicted is not owed to them."
//   Kills the handover shas, and also kills a sha out of `--code request <sha>`
//   — a SUBJECT-NAMED target of a genuine request — because a requester who is also a
//   hub issues verdicts constantly. It took seat <seat-c-session-id> from 3 OPEN rows to ZERO.
//   Restricting it to body-fallback shas leaves the founding instance flagging 3 of 7,
//   which is movement on the wrong axis, not a fix.
//
// WHAT (1) DOES BUY IT, since the mechanisms overlap: the target/context split cut the
// handover's blast radius from 7 unanswered shas to 1 (the survivor is a WRAPPED prose
// line, per the anchor's known residual above), and dropped "REVIEW HUB IS OPEN AGAIN"
// out of OPEN entirely into the context tier on two seats. The ROW still prints. That
// is the correct outcome for a non-request that no available predicate can separate
// from BATCH-10, and the per-sha DISMISS_FILE below is the intended escape.

// ── the answered index (PURE, exported — the unit under test) ─────────────────
// sha7 -> Set of recipients this seat has sent an ANSWERS-matching mail naming that
// sha to. Keeping the RECIPIENT is the whole fix: a flat Set cannot tell "I sent a
// verdict to the requester" from "I mentioned this sha to somebody else".
export const BROADCAST = "all";

// ⛔ THE FOURTH FAILURE MODE, AND THE ONLY ONE THAT HIDES REAL WORK. The other three all
// OVER-report — a row reads OPEN when it is closed, which is loud and self-correcting. This
// one UNDER-reports: a commit leaves the queue and nobody looks again.
//
// MECHANISM, measured on this store 2026-09-03: `ANSWERS` was tested against `m.t`, the WHOLE
// MAIL. An acknowledgement ("ACK 9 shas — queued", "STARTED — 2 lenses running", "Position
// CORRECTED") routinely says "verdict" or "alternative" in its BODY while discussing something
// else entirely, so it credited every sha it named as reviewed. **21 of 25 ACK-shaped mails
// from one hub credited.** Found from the receiving side.
//
// ⚠️ AND THE SUBJECT-ONLY TEST SAYS IT DOES NOT REPRODUCE — an ACK subject alone reads clean.
// The predicate ran over the body, so only a body-level test could see it. Do not re-test this
// on subjects.
//
// THE FIX IS CLASS, NOT A NARROWER `ANSWERS`. The header block above (the not-yet-delivered
// instance) already warned that narrowing a keyword list against one mail is the corpus-shaped
// guard this repo keeps re-learning, and it named the structural hypothesis worth testing: a
// real verdict announces itself in the SUBJECT, an evidence-citing mail does not. That is now
// measured and it holds. So: the MAIL must be verdict-class by its SUBJECT or its SIGNAL, and
// the SHAS may then come from anywhere in it.
//
// ⛔ SHAS FROM ANYWHERE IS LOAD-BEARING — do NOT also narrow the sha scan to the subject. A
// subject cannot hold nine shas, so a BATCH verdict necessarily lists them in the body, and
// subject-only sha extraction would miss 100% of batches — the shape carrying the most commits
// per review. Same two-part form the /summary spec's step 7 arrived at independently.
//
// MEASURED DELTA on the live store: crediting mails 872 -> 543, credited shas 818 -> 691.
// 145 shas stop being credited (the hidden work) and 18 START being credited — signal-typed
// verdicts whose subject was quiet, which the old body-test missed. It is not a pure tightening.
// ⛔ `^\s*fold[- ]verif` — THREE CORRECTIONS IN ONE LINE.
// (a) SEPARATOR: it was `fold-verif`, hyphen-only, while the house SUBJECT writes a SPACE. That
//     one character was a false-OPEN on the dominant spelling — ~83% of this seat's fold-verifies
//     (re-derive: one case-insensitive predicate over the store; absolutes rot, the store grows).
// (b) ⛔ ANCHORED, AND THE ANCHOR IS THE POINT: unanchored, this credited subjects that QUOTE a
//     fold-verify instead of announcing one — `re FOLD VERIFIED <sha>: …` (signal `info`) and
//     another carrying `signal: review-ack` were both credited live, crediting 5 and 6 shas that
//     nothing had answered. That is the hiding-work direction and this file's header records the
//     same class ("21 of 25 ACK-shaped mails credited").
//     ⛔ THE COST WAS MEASURED WHERE IT IS SMALLEST, AND BOTH MITIGATING CLAUSES HERE WERE FALSE
//     (2026-09-12 13:05Z; corrected in place).
//     (i) It read "of 9 subjects that lose subject-leg credit, 7 are INBOUND (never in the
//     answered index, which indexes own outbound only)". True FROM THIS SEAT and worthless as a
//     cost bound: THE INDEX IS BUILT PER-SEAT AND EVERY SEAT RUNS THIS SCAN, so an INBOUND mail
//     here is OUTBOUND there. Fleet cost re-derived: 13 sha-credits across 4 seats,
//     one seat -28% (32 -> 23). A per-seat measurement of a fleet-wide predicate is a FLOOR.
//     (ii) It read "a genuine fold-verify that does not lead with the token is carried by
//     `review-fold` on the SIG leg below". FALSE, and the counter-example is the reviewing hub’s
//     own mail: subject `<finding labels> FOLD-VERIFIED — …`, signal `review-response` — the signal
//     THIS SAME COMMIT deliberately keeps OFF the SIG leg two blocks below. Does not lead with
//     the token, not SIG-carried: a real fold-verify DARK ON BOTH LEGS. `<session-id>` loses one the
//     same way. Two individually-correct clauses composing into a hole neither covers.
//     ⚠️ RESIDUE, FILED NOT FIXED — no safe widening exists TODAY and both obvious ones are
//     already refuted in this file: un-anchoring the subject leg is refuted by the PIN below
//     (5 correct dispositions lost to save 2), and adding `review-response` to the SIG leg is
//     refuted by the ⛔ note at that leg (it legitimately carries acks AND questions). The
//     dominant producer is shrinking by PRACTICE, not by predicate: that hub now names target
//     shas in the verdict SUBJECT and leads a fold-verify subject with the token. TRIGGER to
//     revisit: a fold-verify dark on both legs from a seat that has adopted that practice.
// (c) ⚠️ THIS COMMENT ONCE SAID "the signal on those mails is `review-reply`" — wrong for 113 of
//     126. Measured: `review-fold` 45 · `fold-verify` 29 · `review-reply` 13 · none 9 ·
//     `review-response` 6 · nine more. It also said a fold-verify entered NEITHER leg: false for 7
//     (5 `review-verdict` + 2 `deploy-review` always matched the SIG leg).
// ⛔ AND THE SENTENCE STRUCK FROM HERE WAS "the request-shaped reject runs FIRST, so widening this
// cannot credit a request." The ORDER claim is true; the COVERAGE claim it implies is FALSE, and it
// is the same assurance-the-regex-cannot-carry shape this file already records at `answersByClass` below.
// `BROADCAST_REQUEST_RE` is `--code <request|review|sha>` / `review request` ONLY — it has NO
// fold-verify-request spelling, so `FOLD VERIFY REQUEST <sha>` (signal `review-request`) IS
// credited. The hyphen twin is live in this store 4 times. The anchor in (b) does not close that:
// such a subject leads with the token. FILED, not fixed — closing it needs the
// `ASKS`-vs-`BROADCAST_REQUEST_RE` vocabulary gap measured against the 12-genuine-verdicts-carry-
// request-signals reading below, which nobody has done.
// ⚠️ ALSO STRUCK FROM HERE: "68 of one hub's 83 fold-verify outbounds use the space form (82%), 73
// space vs 48 hyphen fleet-wide." Those four absolutes are NOT re-derivable: the
// 68/73 legs were measured case-SENSITIVELY and the 48/15 legs case-INSENSITIVELY, so 83 is a sum
// of two incommensurable counts and no single predicate returns it. Re-derived on one
// case-insensitive predicate: this seat 72 space / 15 hyphen = 82.8%; fleet 78 / 48. The ~83%
// CONCLUSION survives at both measurements; the absolutes do not, and they rot anyway because the
// store prunes on a TTL and grew by 5 mails during the review that caught this. Cite the predicate,
// never the count.
// `retract` added 2026-09-11: a RETRACTION disposes of the sha it names, and the house subject is
// `RETRACTED …` with signal `review-response`, so it matched neither leg. CONTROLLED before adding:
// `retract` appears in ZERO of this seat's `review-ack` subjects, so it cannot credit an ack.
// ⛔ NOT ADDED, and deliberately: bare `verified`, `accepted`, `correction`. Measured on this store,
// all three occur INSIDE ack subjects ("All three verified at source", "Your fold is verified"), so
// adding them would score an ack as an answer — the exact failure this file's header exists to stop.
// ⛔ PINNED ASYMMETRY — ONLY `fold[- ]verif` IS ANCHORED HERE, AND ONLY THIS REGEX ANCHORS AT ALL.
// Its sibling `BROADCAST_VERDICT_RE` (~line 601) carries a bare `\bVERDICT\b` stem, and the word-level
// alternatives in THIS regex (`verdict`, `approved`, `changes-requested`) are unanchored too. That was
// shipped in one commit under one sentence with the asymmetry stated NOWHERE; it was convicted
// in review (2026-09-12 13:05Z) and it is now DELIBERATE AND DOCUMENTED rather than accidental.
// WHAT IT COSTS — a subject NEGATING or REPORTING a verdict scores as one, measured over 17
// subjects naming the four review shas, of which 10 are verdict-shaped:
//     "INTERIM, NOT THE VERDICT (1 of 4 lanes still out) — …"     -> MATCHES
//     "SECOND correction: my RETRACTION was the wrong one — I never verdicted <sha>" -> MATCHES
//     "RE-OPEN … your ledger says OPEN, your scan says answered"          -> MATCHES
// A subject whose literal text is "NOT THE VERDICT" closes the row; so does one saying "I never
// verdicted this"; and the mail REPORTING that this scan is wrong is credited BY this scan.
// Direction is HIDES WORK, which is the expensive one: the row closes, so nobody reads the
// crediting subject the report prints.
// ⛔ AND THE OBVIOUS FIX IS REFUTED BY MEASUREMENT — DO NOT CONVERGE THE TWO. Mirroring `^\s*`
// onto the sibling reds a live arm and re-classifies 17 subjects, LOSING 5 CORRECT QUOTING
// DISPOSITIONS TO SAVE 2 FALSE ONES; 88 of 90 new hits are right. So this is a net-positive
// widening WITH A RESIDUE, never a revert, and the residue is priced rather than closed.
// ⚠️ The asymmetry is also DIRECTIONAL, which is why one anchor cannot serve both: over-matching
// HERE closes a request that nothing answered (hides work), while over-matching in the sibling
// DROPS a mail from the request inbox at `isBroadcastRequest` and `parseMailDir` (a false-CLOSED
// inbox, already carrying its own trigger at that site). Opposite failure directions, so a shared
// anchor would have to be wrong for one of them. Re-read BOTH sites before touching either.

const ANSWER_CLASS_SUBJ = /verdict|approved|changes-requested|alternative|^\s*fold[- ]verif|deploy-(clear|hold|ok)|loop closed|waived|stand ?down|declin|retract/i;
// `review-fold` added 2026-09-11. The signal axis is trustworthy ONLY where the signal IS the
// disposition. CONTROLLED by enumeration, not assumption: all 51 `review-fold` outbounds on this
// store are dispositions (FOLD VERIFIED / LOOP CLOSED / ROW CLOSED / Discharged), zero acks.
// ⛔ `review-response` is NOT added — it legitimately carries acks AND questions as well as
// dispositions, so crediting it wholesale is the hiding-work direction. Widen the SUBJECT for those.
const ANSWER_CLASS_SIG = /^(review-verdict|review-fold|deploy-)/i;
/** A mail ANSWERS only if it announces itself as a verdict. Body keywords are not enough. */
export function answersByClass(m) {
  const subject = m.subject || "";
  // ⛔ A REQUEST IS NEVER AN ANSWER, AND THE SIGNAL LEG ALONE SAYS IT IS. `ANSWER_CLASS_SIG`
  // is `^(review-verdict|deploy-)` and `deploy-review` is the signal a `--code request`
  // carries — 151 files in this store — so without this line a request naming eight shas, a
  // mail whose literal content is "nobody has reviewed these", credits all eight to its own
  // recipient. That is the hiding-work direction this whole predicate exists to close, so the
  // 2026-09-03 class fix REOPENED its own defect one leg over.
  //
  // ⚠️ THIS SAID "The clause is not new: the FOREIGN index already applies it
  // (`BROADCAST_REQUEST_RE.test`)" AND THAT WAS AN ASSURANCE THE REGEX COULD NOT CARRY
  // (2026-09-03). The test WAS applied; it just did not match `--code <sha>`,
  // the spelling most requests actually use, so a reader met a sentence saying the sibling leg
  // was covered while the leak was live one function over. TRUE AS OF THE SAME COMMIT that
  // struck this: the regex now matches the hex spelling, so both legs really are covered — but
  // the coverage lives in the PATTERN, not in this sentence, and a future narrowing of
  // `BROADCAST_REQUEST_RE` silently un-covers both. This file's own comment states the
  // asymmetry as "a foreign mail must … NOT be request-shaped". The class fix imported the
  // verdict test and left the request test behind.
  // Demonstrated with an end-to-end flip against the real pipeline: the same fixture
  // read CLOSED post-commit and OPEN pre-commit, and `classifyAnswerPath` labelled it
  // `own-outbound` — indistinguishable from a real verdict.
  //
  // ORDER IS LOAD-BEARING: reject FIRST. A mail can be both request-shaped and verdict-shaped
  // in its subject ("--code request … VERDICT follows"), and on that mail the request reading
  // is the true one.
  if (BROADCAST_REQUEST_RE.test(subject)) return false;
  return ANSWER_CLASS_SUBJ.test(subject) || ANSWER_CLASS_SIG.test((m.signal || "").trim());
}

export function buildAnsweredIndex(outbound) {
  const idx = new Map();
  for (const m of outbound) {
    if (!answersByClass(m)) continue;
    // A broadcast enters the index ONLY as a typed verdict (`signal: deploy-*`).
    // An unsigned broadcast naming a sha dispositionally is fleet-scoped
    // contamination — see the header block for the live instance + measurement.
    if (m.to === BROADCAST && !/^deploy-/i.test(m.signal || "")) continue;
    for (const s of m.t.match(SHA) || []) {
      const k = s.slice(0, 7);
      if (!idx.has(k)) idx.set(k, new Set());
      idx.get(k).add(m.to);
    }
  }
  return idx;
}

// A sha is answered FOR A GIVEN REQUESTER, never in the abstract. A broadcast
// answers everyone; a mail to a third party answers nobody.
export function isAnsweredFor(idx, sha, requester) {
  // SLICE INTERNALLY. buildAnsweredIndex above keys on a 7-char prefix, and house
  // style writes 9-char shas, so a caller passing a raw sha false-OPENs every
  // request that WAS answered. The parameter used to be named `sha7`, which
  // documented a contract nothing enforced: the callers were corrected, and the
  // fail-open stayed exactly one careless caller away. Measured before the caller
  // fix: 11 of 12 rows false-positive on one live run, dismissed twice as tooling
  // noise. The scan's own "CONTROL FAILED: zero requests read as answered" guard
  // is VACUOUS here -- 7-char citations still match, so it stays GREEN either way.
  const to = idx.get(String(sha).slice(0, 7));
  return !!to && (to.has(requester) || to.has(BROADCAST));
}

// ── the FOREIGN verdict index — cross-hub answers ─────────────────────────────
// Residual mechanism (2), the STRUCTURAL one. buildAnsweredIndex above is built from
// the RUNNING session's outbound alone, so a request answered by a PREVIOUS hub before
// a role handover reads OPEN permanently — and the blind spot fires hardest exactly at
// a handover, when the queue is least legible and most consulted. Live instance:
// <seat-a-session-id> -> <requester-session-id>, 08-31 12:21Z, "VERDICT — your two guards are CORRECT",
// which <seat-b-session-id>'s queue could not see at all.
//
// ⭐ SCOPE DECISION — WHOSE OUTBOUND COUNTS: **any session's, gated on verdict SHAPE
// and on the sha appearing in that mail's own SUBJECT.** Not predecessor-hub-only.
// Rejected that because identifying the predecessor needs a hub-lineage oracle that
// does not exist (`fleet-claim` leaves no durable lineage, `.claude/state/` is
// git-ignored and per the foreign-dismissal block below a retiring hub's files go
// stale unseen), and because it would also exclude the LEGITIMATE non-hub answer —
// behavioral-anti-patterns #9 explicitly allows a peer or a self-run review.
//
// ⛔ THIS IS A WIDENING, WHICH IS THE DANGEROUS DIRECTION, AND THE GATE IS WHAT MAKES
// IT AFFORDABLE — say so rather than selling it as free. A false CLOSE strands work
// silently; a false OPEN costs a glance. So a foreign seat gets a STRICTER test than
// your own: your own outbound is now ALSO class-keyed (2026-09-03 — this line read "keeps the
// broad ANSWERS body matcher (unchanged)" and became false the moment that matcher was retired;
// the asymmetry it describes has NARROWED, it has not inverted), while
// a foreign mail must (a) be verdict-SHAPED (`signal: deploy-*` or a VERDICT subject —
// the store's own convention, already relied on for broadcasts), (b) NOT be
// request-shaped, and (c) name the sha in its own SUBJECT, never merely its body.
//
// EVERY CLAUSE IS LOAD-BEARING, MEASURED ON THE LIVE STORE. Without (c) the widening
// closed rows via a mail whose subject was "<sha> ALTERNATIVE …" that merely
// MENTIONED another sha — the use-vs-mention residue, imported across seats — and via a
// handover ASK whose subject read "…handoff ask: open loops, DEPLOY-CL[EAR]". Without
// (b) a `--code request` subject carrying a deploy signal closed its own target. The
// ungated version took seat <seat-c-session-id> from 3 OPEN rows to ZERO; with all three clauses
// the same corpus yields exactly 3 closures, all genuine cross-hub verdicts, and
// <seat-a-session-id>'s row count does not move at all.
export function buildForeignVerdictIndex(foreign) {
  const idx = new Map();
  for (const m of foreign) {
    const subject = m.subject || "";
    const verdictShaped = BROADCAST_VERDICT_RE.test(subject) || /^deploy-/i.test(m.signal || "");
    if (!verdictShaped) continue;
    if (BROADCAST_REQUEST_RE.test(subject)) continue;
    // ⛔ The OWN broadcast leg requires a `deploy-*` signal and this leg did
    // not, so a BROADCAST closed rows for EVERY requester on subject prose alone. Measured: 13
    // foreign broadcasts admitted, 4 carrying no `deploy-*` signal, and one sha closed by an
    // `info` DISCLAIM whose subject merely contained the word "verdict". `to === all` makes that
    // one false close land on every open row at once, which is why the broadcast plane gets the
    // stricter gate rather than the same one.
    if ((m.to || "") === BROADCAST && !/^deploy-/i.test((m.signal || "").trim())) continue;
    // ⚠️ NOT a blanket request-signal reject. That was a proposed one-liner and it is
    // REFUTED by measurement here: 12 genuine verdicts on this store carry `deploy-review` or
    // `review-request` while announcing a real disposition in the subject ("FOLDED —
    // verdict accepted in full"). Rejecting on the signal alone converts a false CLOSE into a
    // false OPEN twice as often as it fixes anything. The subject predicate above does the work.
    for (const s of subject.match(SHA) || []) {
      const k = s.slice(0, 7);
      if (!idx.has(k)) idx.set(k, []);
      // The SUBJECT rides along so the report can PRINT the crediting mail rather than
      // merely counting it. A widening that closes rows anonymously is unauditable from
      // the outside — which is the whole defect this field exists to close.
      idx.get(k).push({ from: m.from, to: m.to, subject });
    }
  }
  return idx;
}

// A REQUESTER CANNOT ANSWER THEIR OWN REQUEST. Cheap invariant, and it is not
// theoretical: a requester who is also a reviewer broadcasts verdicts constantly, and
// without this a `to: all` verdict from the requester would close the very row they
// opened. Never fires on the own-outbound index (there `from` is always self, and self
// is never the requester — parseMailDir admits inbound only when `from !== self`).
// ONE predicate, two consumers. `isAnsweredByFleet` decides OPEN-vs-CLOSED and
// `classifyAnswerPath` below decides what the report SAYS about that closure; expressing
// the rule twice would let the verdict and its label drift apart, which on this file is
// the worst available bug — a row printed as "closed by X" while X is not why it closed.
const fleetHit = (idx, sha, requester) =>
  (idx.get(String(sha).slice(0, 7)) || [])
    .find((h) => h.from !== requester && (h.to === requester || h.to === BROADCAST));

export function isAnsweredByFleet(idx, sha, requester) {
  return !!fleetHit(idx, sha, requester);
}

// ── WHICH MECHANISM CLOSED IT ─────────────────────────────────────────────────
// Until 2026-09-02 every path closed a row SILENTLY: `grep -icE 'foreign|cross-hub|
// fleet'` over this scan's own output returned 0 while the source carried 17 `foreign`
// references. From outside there was no way to separate "still open because the fix did
// not fire" from "still open for an unrelated sha" — so a competent reader reported the
// cross-hub mechanism as still broken, CORRECTLY, from the evidence available to them.
//
// ⛔ THIS IS THE SAME FUNCTION THE OPEN/CLOSED DECISION RUNS THROUGH, DELIBERATELY.
// main() asks this and nothing else, so a sha is answered IF AND ONLY IF this returns a
// label: the report cannot claim a path that did not fire, and cannot close a row it
// cannot name a path for. A separate "labeller" beside a separate "decider" is how a
// truthful-looking report starts lying.
//
// PRECEDENCE IS OWN-BEFORE-FOREIGN, AND IT IS THE POINT. The question a reader has is
// "would this row have closed WITHOUT the widening?", so the narrower pre-existing path
// is reported when it applies. Consequence worth stating plainly: a sha labelled
// CROSS_HUB closed ONLY through the foreign-verdict widening, which is exactly the set
// that needs auditing.
export const OWN_DIRECT = "own-outbound";
export const OWN_BROADCAST = "own-broadcast";
export const CROSS_HUB = "cross-hub";
// ── THE DURABLE PLANE ─────────────────────────────────────────────────────────
// Every path above reads the MAIL STORE, which expires (24h read / 72h unread), while
// `.claude/docs/review-ledger.md` is append-only and TRACKED IN GIT. So a request that
// was fully verdicted — panel seated, verdict mailed, ledger row filed — re-read as OPEN
// the moment its closing mail aged off disk, and stayed that way forever.
// MEASURED on 2026-09-22, the same scan twice 90 minutes apart with
// nothing answered and no dismissals removed in between: `with unanswered SHAs` 1 -> 14,
// `closed via own-outbound` 350 -> 316. The count does not merely go stale, it CLIMBS
// with no event, which destroys it as a trend and invites re-reviewing finished work.
export const LEDGER = "ledger";

// ⛔ ORDER IS DELIBERATE AND IS *NOT* "prefer the durable one" READ LITERALLY.
// The four sources are disjunctive, so precedence cannot change WHETHER a sha closes —
// only which label is reported. Consulting the ledger LAST keeps every pre-existing label
// stable while mail is alive, which makes the TTL drift VISIBLE in the counts line
// (own-outbound falls, ledger rises) instead of converting it into false OPENs. Reversing
// this would hide the very decay the source exists to absorb.
export function classifyAnswerPath(idx, fleetIdx, sha, requester, ledgerIdx) {
  if (isAnsweredFor(idx, sha, requester)) {
    const to = idx.get(String(sha).slice(0, 7));
    // Mirrors isAnsweredFor's own disjunction: it closed for the requester directly, or
    // it closed because a deploy-signalled broadcast answers everyone.
    return { path: to.has(requester) ? OWN_DIRECT : OWN_BROADCAST };
  }
  const h = fleetHit(fleetIdx, sha, requester);
  if (h) return { path: CROSS_HUB, from: h.from, to: h.to, subject: h.subject };
  // Optional + last so existing callers and self-test arms keep their arity; a missing
  // index is an empty Map, never a crash, because the ledger is one unguarded read away
  // from aborting an instrument that only ANNOTATES with it.
  // ⛔ Only a DISPOSITIVE newest row closes (see lib/review-ledger.mjs: an arrival row names the
  // sha and settles nothing). And a row whose REVIEWER is the requester closes nothing either —
  // the other three paths refuse a requester answering their own request, and so does this one.
  const l = ledgerIdx ? lookupSha(ledgerIdx, String(sha)) : null;
  if (l && l.dispositive && l.reviewer !== String(requester).slice(0, 8)) {
    return { path: LEDGER, verdict: l.verdict, reviewer: l.reviewer, when: l.when };
  }
  return null;
}

// ⛔ A CLOSURE SOURCE FAILS EXPENSIVELY IN THE *CLOSING* DIRECTION — a false close hides a
// genuinely dropped review, which is the one thing this scan exists to catch. This file's first
// ledger reader got that wrong twice: it kept the OLDEST row per sha, and it closed on
// a verdict word found ANYWHERE in the state cell, so "ARRIVED … FOLD-VERIFY OWED" read finished.
// The parse has since moved to the shared
// `lib/review-ledger.mjs`: newest row wins, classified on the row's LEADING disposition with an
// explicit arrival-word list, sha set read only from the start of the Commit cell.

// A BROADCAST can be a real review request, and until 2026-09-02 one could never
// enter the queue: inbound was built under `to === self` alone, while
// buildAnsweredIndex handled BROADCAST explicitly above. So a `--to all` request
// could be ANSWERED by the index and never COUNTED — the asymmetry was the bug.
// Live instance: a genuine request, broadcast 2026-08-31.
//
// ⛔ ADMIT ON REQUEST SHAPE, NEVER ON `to === BROADCAST` ALONE. A bare widen makes
// every verdict, disclaim, wake-up and state note a queue candidate, against a scan
// deliberately tuned for precision (see the EXCLUDES notes below: "a queue tool that
// cries wolf gets dismissed wholesale"). MEASURED on the live store before writing
// this, which is what made a one-line discriminator defensible rather than a guess:
//   broadcasts in the store   ~200
//   subject matches this RE      2   — and both are unambiguous `--code request <sha>:`
// So the predicate separates 2 from 200 on the real corpus. A VERDICT-shaped subject
// is excluded explicitly, because a verdict naming a sha is the commonest broadcast
// and is the thing this must not mistake for a request.
// ⛔ `--code <sha>` IS THE HOUSE SPELLING AND IT WAS NOT IN THIS PATTERN.
// BOTH legs reject requests through THIS regex (`answersByClass` and `buildForeignVerdictIndex`),
// so the hole was shared: a request goes out `signal: deploy-review`, the signal leg admits it
// structurally, and the subject leg was supposed to catch it back. It caught `--code request`
// and missed `--code <sha>`. Measured on the live store from this seat: 6 admitted mails,
// every one a genuine request, and one requested sha read ANSWERED with no verdict anywhere — credited
// by the request itself, whose requester is this seat. Hand that queue to a successor and they
// read it closed. Fixing the SUBJECT predicate rather than adding a signal reject is deliberate:
// it repairs both call sites at once, and the signal-reject alternative was MEASURED killing 12
// genuine verdicts (a fold-verify legitimately carries `deploy-review`) — see the note in
// buildForeignVerdictIndex. The `\b` after the hex class is load-bearing: without it this also
// matches the leading hex of a longer word.
export const BROADCAST_REQUEST_RE = /--code\s+(?:request|review|[0-9a-f]{7,12}\b)|\breview request\b/i;
// ⛔ `FOLD[- ]VERIF`, A STEM — IT WAS THE WHOLE WORD `FOLD-VERIFY` AND THAT IS A WORSE VERSION
// OF THE `ANSWER_CLASS_SUBJ` HYPHEN BUG, BLIND TO **BOTH** SEPARATORS AND TO THE `-ED` SUFFIX.
// `FOLD VERIFIED` (space) and `FOLD-VERIFIED` (hyphen + ED) both failed; only the bare
// `FOLD-VERIFY` matched. Measured 2026-09-11 over the whole store: 126 fold-verify subjects, 75
// NOT verdict-shaped under the old pattern, all 75 rescued by this stem.
// TWO CONSUMERS, both in the false-OPEN direction: `buildForeignVerdictIndex` never indexed a
// FOREIGN hub's fold-verify, and `parseMailDir`'s direct leg admitted a fold-verify addressed to
// this seat as an inbound REQUEST IT OWED AN ANSWER ON.
// COST MEASURED BEFORE WIDENING, not assumed: 6 mails to this seat are newly dropped from the
// request inbox and all 6 are non-requests (two `re FOLD VERIFIED` replies, an ACK, a STOP, a
// NEITHER-WORD closure, a peer's own fold-verify). ⚠️ RESIDUAL + TRIGGER: a subject that is
// fold-verify-shaped AND a genuine ask would be dropped silently, because `BROADCAST_REQUEST_RE`
// misses five `ASKS` spellings (`re-review`, `please review`, `refute mandate`, …). Measured 0
// such mails today; the FIRST one is the trigger to widen the request leg instead.
// A gap the earlier stem fix did not reach; re-derived here at source.
// ⛔ THE BARE `\bVERDICT\b` STEM IS THE OTHER HALF OF A PINNED ASYMMETRY — READ THE PIN ABOVE
// `ANSWER_CLASS_SUBJ` BEFORE ANCHORING ANYTHING HERE. Mirroring that regex’s `^\s*` onto this one
// is MEASURED-WRONG (reds a live arm, loses 5 correct dispositions to save 2). This regex’s two
// negative consumers below fail in the OPPOSITE direction from that one, so the anchors are not
// interchangeable and "make them consistent" is a regression, not a tidy-up.

export const BROADCAST_VERDICT_RE = /\bVERDICT\b|APPROVED|CHANGES-REQUESTED|FOLD[- ]VERIF|DEPLOY-(?:CLEAR|HOLD)/i;
export function isBroadcastRequest(subject) {
  const s = subject || "";
  return BROADCAST_REQUEST_RE.test(s) && !BROADCAST_VERDICT_RE.test(s);
}

export function parseMailDir(dir, self) {
  const files = readdirSync(dir).filter(f => f.endsWith(".md") || f.endsWith(".md.read"));
  const read = p => { try { return readFileSync(join(dir, p), "utf8"); } catch { return ""; } };
  // `foreign` is EVERY mail this seat did not send — the plane a cross-hub verdict
  // lives on. A mail from a previous hub to a third-party requester is neither inbound
  // nor outbound here, so before this bucket existed it was not merely unindexed, it
  // was never read at all. Deliberately unfiltered: buildForeignVerdictIndex owns the
  // gate, so the gate is testable in one place instead of split across the parse.
  const inbound = [], outbound = [], foreign = [];
  for (const f of files) {
    const t = read(f); if (!t) continue;
    const from = hdr(t, "from"), to = hdr(t, "to");
    // ⛔ THE TWO PATHS TAKE OPPOSITE RULES, AND THE ASYMMETRY IS THE WHOLE POINT.
    // BROADCAST is opt-IN (must look like a request): ~200 broadcasts, 2 requests, so
    // the default has to be exclude. DIRECT is opt-OUT (only verdicts are removed):
    // measured on the live store 2026-09-02, direct inbound by subject shape —
    //   seat <session-id>          19 total :  6 verdict ·  0 request · 13 NEITHER
    //   seat <seat-a-session-id>  371 total : 82 verdict · 88 request · 201 NEITHER
    // Requiring request-shape here would drop 13 of 19 and 201 of 371, including live
    // findings that carry no request keyword at all ("⛔ ADVANCE P1 on …'s arc").
    // Direct mail is addressed TO you and is relevant by default; a broadcast is not.
    //
    // Excluding VERDICTS from the direct path is the actual fix for the control
    // failure: a verdict mailed to a seat was entering as a REQUEST that seat owes an
    // answer on, so a seat that mostly RECEIVES verdicts read 0 answered and its
    // control fired on a healthy store. Diagnosed by reproducing the control
    // across three identities; the misclassification is the mirror of the broadcast
    // bug fixed directly above.
    // ⛔ REQUEST-WINS ON THE DIRECT LEG (2026-09-06). The verdict exclusion above is
    // right and stays; what it lacked is the precedence rule THIS FILE ALREADY STATES
    // at `answersByClass` (grep `ORDER IS LOAD-BEARING`) and applies in
    // `buildForeignVerdictIndex` — *"A mail can be both request-shaped and
    // verdict-shaped in its subject … and on that mail the request reading is the true
    // one."* This leg was the one place the rule was written down and not applied.
    //
    // The shape it lost is the hub's DOMINANT one: a fold re-review names the verdict
    // it folds, e.g. `--code request: <sha> — your CHANGES-REQUESTED
    // is folded as a REBUILD`. That never entered `inbound` at all — not dropped
    // downstream, never parsed as a request — so it could not appear in the queue, in
    // the unanswered set, or in the control. MEASURED on the live store for seat
    // `<seat-b-session-id>`: 114 direct inbound dropped by the verdict filter, **19 of them
    // request-shaped**, including a `--code request` for a commit
    // that was live in production. This is the file's own header class — "THE FOURTH
    // FAILURE MODE, AND THE ONLY ONE THAT HIDES REAL WORK" — and it hid it worst at a
    // succession, when a queue is inherited rather than remembered.
    //
    // ⚠️ IT DOES NOT REOPEN THE CONTROL FAILURE the exclusion was added for. That
    // failure was a seat which mostly RECEIVES verdicts reading 0 answered; measured on
    // `<session-id>`, exactly such a seat, **0 of 11** verdict-subject drops are
    // request-shaped, so its reading does not move by a single row.
    //
    // ⛔ DO NOT MIRROR THIS ONTO THE BROADCAST LEG. There the asymmetry is deliberate
    // and load-bearing: broadcasts run ~200 verdicts against ~2 requests, so
    // verdict-wins is correct there and request-wins would flood the queue.
    const addressed = to === BROADCAST
      ? isBroadcastRequest(hdr(t, "subject"))
      : to === self &&
        (BROADCAST_REQUEST_RE.test(hdr(t, "subject") || "") || /^--code\b/i.test(hdr(t, "subject") || "") ||
          !BROADCAST_VERDICT_RE.test(hdr(t, "subject") || ""));
    if (addressed && from !== self) inbound.push({ f, t, from, when: hdr(t, "created") });
    // `subject` is carried explicitly so buildAnsweredIndex can key on the mail's CLASS.
    // The `foreign` branch below already did this; outbound did not, which is why the
    // answered-index had nothing to key on but the full body. See ANSWER_CLASS_SUBJ.
    if (from === self) outbound.push({ f, t, to, subject: hdr(t, "subject"), signal: hdr(t, "signal") });
    else foreign.push({ f, t, from, to, subject: hdr(t, "subject"), signal: hdr(t, "signal") });
  }
  return { inbound, outbound, foreign };
}

const hdr = (t, k) => (t.match(new RegExp(`^${k}:\\s*(.+)$`, "mi")) || [, ""])[1].trim();

// `json`: ONE JSON document on stdout and nothing else — the requests, their open shas and what
// closed each answered one — so review-queue.py takes its OPEN set from THIS predicate instead of
// re-deriving "answered" (the two disagreed on 1 of 4 flagged shas for
// one hub at one minute). The default text report is byte-unchanged: every print below goes through
// `log`, a no-op under --json, and the three exits emit the document with their own `control`.
function main({ sid = ENV_ME, json = false } = {}) {
const me = sid;
const log = json ? () => {} : (...a) => console.log(...a);
if (!me) { console.error("closure-scan: no CLAUDE_CODE_SESSION_ID and no --sid; refusing to guess identity."); process.exit(2); }
const { inbound, outbound, foreign } = parseMailDir(MAIL, me);
const answered = buildAnsweredIndex(outbound);
const fleetAnswered = buildForeignVerdictIndex(foreign);

// A requester who LABELS a sha "context" or "not in scope" is being PRECISE, and
// the scan must not punish that. Measured 2026-08-07: 3 of 8 requests read OPEN
// purely on labeled-context shas. That over-report is not harmless — a queue tool
// that cries wolf gets dismissed wholesale, and the one real row (the <session-id>
// two-commit gap caught the same morning) is dismissed with it.
// LINE-SCOPED, never mail-scoped: an exclusion note must not blind the scan to
// real targets elsewhere in the same request.
// WIDEN ON PRECISION, NOT FREQUENCY. Measured on the mail store 2026-08-15:
//   excluded 32 files  <- MOST common, REFUSED: ~1 is a real descope label
//   out of scope 8     <- MOST common of the members, and SAFE to add
//   descoped 7 · not in scope 3 · the rest 2 each
// So a raw count over prose ranks the WRONG spelling first. Ask P(label|phrase)
// by hand-reading ~5 hits, never how often the phrase appears. This predicate
// fails OPEN -- a false match silently blinds the scan to a real unanswered sha --
// so a low-precision member is not a nuisance here, it is a dropped finding.
const EXCLUDES = /not a review target|not in scope|out of scope|for context only|already reviewed|descoped/i;
// ⚠️ WRAPPED PROSE STILL OVER-REPORTS. This is a line-oriented reader over wrapped
// text, so a marker on line N and its shas on N+1 need the lookahead below; shas
// wrapped 2+ lines past their marker are still counted. Known, not closed —
// over-reporting is the SAFE direction and the footer says so.
const stripExcluded = t => {
  const L = t.split("\n"); const keep = [];
  for (let i = 0; i < L.length; i++) {
    if (EXCLUDES.test(L[i])) { if (/^\s*[0-9a-f]{7,12}\b/.test(L[i + 1] || "")) i++; continue; }
    keep.push(L[i]);
  }
  return keep.join("\n");
};

// A SESSION ID IS 8 HEX CHARS AND SO IS A SHORT SHA - the regex above cannot tell
// them apart, and every seat SIGNS its mail with its own sid (`-- <session-id>`).
// Measured 2026-08-08: one request cited three tokens, of which the SENDER's sid
// and this hub's OWN sid were phantoms. Neither can ever be "answered", so the row
// would have read OPEN forever - the cry-wolf failure the EXCLUDES block above
// exists to prevent, arriving by a different door and never self-clearing.
// Resolve against git rather than denylisting sids: that also catches a THIRD
// party's sid quoted in a body, which a denylist of {sender, me} would miss.
// Phantoms are REPORTED, not silently dropped - a real-but-unresolvable sha would
// otherwise make a row read CLOSED, which is the one unsafe direction here.
const shaCache = new Map();
const isCommit = (sha) => {
  if (shaCache.has(sha)) return shaCache.get(sha);
  let ok = false;
  try { execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" }); ok = true; } catch { ok = false; }
  shaCache.set(sha, ok);
  return ok;
};

// DISPOSITION, because a row that CANNOT close is the cry-wolf shape this file
// already fixed once (phantom shas). A mail can cite a real commit as EVIDENCE of a
// mechanism rather than as a review TARGET — the ASKS matcher is deliberately broad
// ("a missed request is the expensive direction"), so it catches those, and no
// outbound will ever "answer" a sha that was never a request. Measured 2026-08-08:
// one such row re-fired on a 5-minute loop indefinitely after being dispositioned.
// DISMISSED, NOT HIDDEN — the reason is recorded and PRINTED on every run, so a
// dismissal stays auditable and a wrong one is visible rather than silent. That is
// the same posture as the phantom line above: report what the filter removed.
// Format, one per line: <sha7> <reason>
const DISMISS_FILE = `.claude/state/closure-scan-dismissed-${me}.txt`;
const dismissed = new Map();
try {
  for (const ln of readFileSync(DISMISS_FILE, "utf8").split("\n")) {
    const mm = ln.match(/^([0-9a-f]{7,12})\s+(.+)$/);
    if (mm) dismissed.set(mm[1].slice(0, 7), mm[2].trim());
  }
} catch { /* no dismissals recorded */ }

// ⛔ FOREIGN LEDGERS ARE ADVISORY, NEVER SUPPRESSION. The ledger above is sid-keyed and
// `.claude/state/` is git-ignored, so a retiring hub's dismissals vanish from the fleet's view
// without the file being deleted — and the successor re-flags every one, reading a queue that
// looks broken. Two ledgers were already orphaned when this shipped (2026-08-26). But a foreign
// dismissal must NOT mute this session's queue: one hub's "out of scope for --code" is a judgement
// about ITS OWN mandate, and adopting it silently would let a dead seat close a live obligation.
// So these only ANNOTATE a row that stays flagged.
const foreignDismissed = new Map();
// ⛔ `.claude/state` IS GIT-IGNORED, so it does not exist in a fresh clone or a detached
// `git worktree` — and this readdir was UNGUARDED, killing the entire scan with an
// uncaught ENOENT before a single line of report (measured 2026-09-02 in a worktree at
// HEAD: rc=1, `syscall: 'scandir', path: '.claude/state'`). The per-file read below
// already fails soft on exactly this reasoning; the directory read did not, so the most
// ADVISORY block in the file could abort the instrument it only annotates.
let stateFiles = [];
try { stateFiles = readdirSync(".claude/state"); } catch { /* no state dir — no foreign ledgers */ }
for (const f of stateFiles.filter(n => /^closure-scan-dismissed-.+\.txt$/.test(n))) {
  const sid = f.replace(/^closure-scan-dismissed-|\.txt$/g, "");
  if (sid === me) continue;
  try {
    for (const ln of readFileSync(`.claude/state/${f}`, "utf8").split("\n")) {
      const mm = ln.match(/^([0-9a-f]{7,12})\s+(.+)$/);
      if (mm && !dismissed.has(mm[1].slice(0, 7))) {
        foreignDismissed.set(mm[1].slice(0, 7), { sid, reason: mm[2].trim() });
      }
    }
  } catch { /* unreadable sibling ledger — skip, never fail the scan */ }
}

// Tracked in git, so unlike `.claude/state` it DOES exist in a fresh clone and a detached
// worktree — but read soft anyway: an unguarded readdir on the sibling block above once
// killed this whole instrument with an uncaught ENOENT before a single line of report.
// ⛔ ANCHORED ON THIS FILE, NOT THE CWD, AND A MISSING LEDGER SAYS SO. A cwd-relative path read
// inside a silent catch made the source vanish when the scan ran from another directory, while the
// counts line still printed `ledger 0` — a zero the "a zero here is a MEASUREMENT" rule forbids.
// FF_REVIEW_LEDGER points the scan at a fixture ledger, as FF_MAIL_DIR does for the mail store. The
// end-to-end test runs this script with the three newest real commits as its fixture shas, so
// against the LIVE ledger it went red whenever one of them had a finished review row: a flake that
// tracked what the ledger said about recent commits, not anything in this file.
const LEDGER_FILE = process.env.FF_REVIEW_LEDGER
  || fileURLToPath(new URL("../.claude/docs/review-ledger.md", import.meta.url));
let ledgerIdx = new Map();
let ledgerStatus = "NOT FOUND";
try {
  ledgerIdx = parseLedgerShas(readFileSync(LEDGER_FILE, "utf8"));
  const disp = [...ledgerIdx.values()].filter((v) => v.dispositive).length;
  ledgerStatus = `${ledgerIdx.size} shas indexed, ${disp} with a finished verdict`;
} catch { /* no ledger on this checkout — every other closure path still applies */ }

const ledgerOnlyCache = new Map();
const isLedgerOnly = (sha) => {
  if (ledgerOnlyCache.has(sha)) return ledgerOnlyCache.get(sha);
  let names = [];
  try {
    names = execFileSync("git", ["show", "--diff-merges=first-parent", "--name-only", "--format=", sha],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n");
  } catch { names = []; }
  const ok = isLedgerOnlyNameList(names);
  ledgerOnlyCache.set(sha, ok);
  return ok;
};

const rows = [];
const unanchored = [];   // asks that cite no commit at all: carried in --json, never dropped
for (const m of inbound) {
  if (!ASKS.test(m.t)) continue;
  const subject = hdr(m.t, "subject");
  const { targets, context } = classifyCitedShas(stripExcluded(m.t), subject);
  const ledgerOnly = [...targets, ...context].filter(isCommit).filter(isLedgerOnly);
  const shas = targets.filter(isCommit).filter((s) => !ledgerOnly.includes(s));
  const ctx = [...context.filter(isCommit).filter((s) => !ledgerOnly.includes(s)), ...ledgerOnly];
  const phantom = [...targets, ...context].filter((x) => !isCommit(x));
  // No anchor -> nothing to adjudicate, but the ask is CARRIED in --json's `unanchored`, never dropped:
  // review-queue.py shows it as NO SHA CITED.
  if (!shas.length && !ctx.length) { unanchored.push({ from: m.from, when: m.when, file: m.f, subject, phantom }); continue; }
  // m.from is the REQUESTER — the recipient an answer to this request must reach.
  // A sha counts as answered by THIS seat's outbound (broad matcher) or by any
  // FOREIGN seat's subject-named verdict (strict gate) — see buildForeignVerdictIndex.
  // classifyAnswerPath returns WHICH of those fired, and returning a label at all IS
  // the answered verdict, so nothing downstream can print a path the scan did not take.
  const paths = new Map();
  for (const s of [...shas, ...ctx]) {
    const p = classifyAnswerPath(answered, fleetAnswered, s, m.from, ledgerIdx);
    if (p) paths.set(s, p);
  }
  const isAns = (s) => paths.has(s);
  const open = shas.filter(s => !isAns(s) && !dismissed.has(s));
  const shrugged = shas.filter(s => !isAns(s) && dismissed.has(s));
  // Cited mid-prose and never announced as a target. NOT dropped: printed below.
  const openContext = ctx.filter(s => !isAns(s) && !dismissed.has(s));
  rows.push({ from: m.from, when: m.when, shas, ctx, open, phantom, shrugged, openContext, paths, ledgerOnly,
              subj: (subject || "(no subject)").slice(0, 78), subject, file: m.f });
}

// ── THE CLOSURE LEDGER: what each path actually closed ────────────────────────
// Counted over CITED SHAS (targets + context), not over rows: one row can close by two
// different mechanisms, so a per-row count would have to pick one and would misreport
// the other. Say the denominator rather than leaving the reader to infer it.
const pathCounts = { [OWN_DIRECT]: 0, [OWN_BROADCAST]: 0, [CROSS_HUB]: 0, [LEDGER]: 0 };
const crossHub = [];
for (const r of rows) {
  for (const [sha, p] of r.paths) {
    pathCounts[p.path] = (pathCounts[p.path] || 0) + 1;
    if (p.path === CROSS_HUB) {
      crossHub.push({ sha, tier: r.shas.includes(sha) ? "target" : "context",
                      requester: r.from, when: r.when, subj: r.subj,
                      from: p.from, to: p.to, subject: p.subject });
    }
  }
}

// POSITIVE CONTROL ON THE GIT FILTER. If tokens were cited but NOT ONE resolved,
// the likely cause is a broken/absent `git`, not a store full of phantoms - and the
// failure is silent-by-construction: every row drops at `!shas.length` and the scan
// prints a clean "0 requests", which reads identical to a genuinely empty queue.
const ledgerRowOf = (s) => { const v = lookupSha(ledgerIdx, s); return v ? { ...v } : null; };
const emitJson = (control, code) => {
  const closedN = rows.filter((r) => !r.open.length).length;
  process.stdout.write(`${JSON.stringify({
    seat: me, control,
    ledger: { path: LEDGER_FILE, status: ledgerStatus },
    counts: { requests: rows.length, closed: closedN, withUnanswered: rows.length - closedN, closedVia: pathCounts },
    requests: rows.map((r) => ({
      from: r.from, when: r.when, file: r.file, subject: r.subject,
      targets: r.shas, context: r.ctx, ledgerOnly: r.ledgerOnly, phantom: r.phantom,
      open: r.open, openContext: r.openContext, dismissed: r.shrugged,
      closedVia: Object.fromEntries(r.paths),
      ledgerRows: Object.fromEntries([...r.shas, ...r.ctx].map((x) => [x, ledgerRowOf(x)])),
    })),
    unanchored,
  })}\n`);
  process.exit(code);
};

const totCited = [...shaCache.values()];
if (totCited.length && !totCited.some(Boolean)) {
  if (json) emitJson("filter-control-failed", 2);
  log(`\n  \u26d4 FILTER CONTROL FAILED: ${totCited.length} sha-shaped token(s) cited,`);
  log(`     zero resolved as commits. Suspect git, not the store. Not a clean queue.`);
  process.exit(2);
}

// POSITIVE CONTROL on the DETECTOR, not on the queue. If nothing is answered, the
// scan cannot distinguish "clean" from "broken" — the oracle-half trap.
const closed = rows.filter(r => !r.open.length).length;
log(`review-request closure scan — session ${me}`);
log(`  requests found ......... ${rows.length}`);
log(`  fully answered ......... ${closed}`);
log(`  with unanswered SHAs ... ${rows.length - closed}`);
// ALWAYS PRINTED, ZEROS INCLUDED. A mechanism that is silent when it fires is
// indistinguishable from one that is broken, and that is not a hypothetical here: the
// cross-hub path shipped invisible and was reported as still-broken by a reader with no
// way to see it. A zero on this line is now a MEASUREMENT ("the widening closed nothing
// on this run"), where before it was an absence of evidence.
log(`  closed via ............. ${OWN_DIRECT} ${pathCounts[OWN_DIRECT]}` +
            ` · ${OWN_BROADCAST} ${pathCounts[OWN_BROADCAST]}` +
            ` · ${CROSS_HUB} verdict ${pathCounts[CROSS_HUB]}` +
            ` · ${LEDGER} ${pathCounts[LEDGER]}   (cited SHAs, not rows)`);
// The ledger count MIXES three populations — this seat's own verdicts whose mail expired, other
// hubs' expired verdicts, and verdicts that were never on this seat's mail at all — so "own-outbound
// falls, ledger rises" is not a clean trend on its own.
log(`  ledger ................. ${ledgerStatus}` +
            (ledgerIdx.size ? "   (ledger closures include answers never on this seat's mail)" : ""));
  { // TRUTH IN OUTPUT: the target/context split is a JUDGEMENT the scan is making on
    // your behalf, so its size is reported whether or not any row changed tier. A
    // silent filter is the one thing this file has never allowed itself.
    const c = rows.reduce((a, r) => a + r.openContext.length, 0);
    if (c) log(`  cited mid-prose ........ ${c} sha(s) read as CONTEXT, not targets (listed below)`);
    const lo = new Set(rows.flatMap((r) => r.ledgerOnly));
    if (lo.size) log(`  ledger-only commits .... ${lo.size} sha(s) read as CONTEXT: each commit touches only ${LEDGER_DOC_REL}`); }
  { const d = rows.flatMap(r => r.shrugged || []);
    if (d.length) { log(`  DISMISSED (still shown, never hidden):`);
      for (const x of new Set(d)) log(`    ${x} — ${dismissed.get(x)}`); } }
for (const r of rows.filter(x => x.open.length)) {
  log(`\n  ⚠️  OPEN  from=${r.from}  ${r.when}`);
  log(`      ${r.subj}`);
  log(`      unanswered sha(s): ${r.open.join(", ")}   (of ${r.shas.length} cited)`);
  // THE SIBLINGS THAT DID CLOSE, AND BY WHICH MECHANISM. This is the line that answers
  // the question a partially-open row could not: is this row flagged because the fix
  // never fired, or because ONE unrelated sha of N is unanswered? TARGETS only, so the
  // arithmetic on this row is checkable by eye — open + answered + dismissed = cited.
  for (const p of [OWN_DIRECT, OWN_BROADCAST, CROSS_HUB, LEDGER]) {
    const got = r.shas.filter((s) => r.paths.get(s)?.path === p);
    if (!got.length) continue;
    // A ledger closure names its row: which verdict and whose, or it is an unauditable widening.
    const show = p === LEDGER
      ? got.map((s) => { const x = r.paths.get(s); return `${s} (${x.verdict} · ${x.reviewer})`; })
      : got;
    log(`      answered via ${p}: ${show.join(", ")}`);
  }
  for (const s of r.open) {
    const fd = foreignDismissed.get(s);
    // ADVISORY ONLY — the row above stays flagged. See the foreign-ledger block.
    if (fd) log(`      ℹ️  ${s} was dismissed by hub ${fd.sid} (NOT applied here): ${fd.reason}`);
  }
  if (r.openContext.length) log(`      also cited mid-prose, read as CONTEXT: ${r.openContext.join(", ")}`);
  if (r.phantom.length) log(`      ignored, not commits here: ${r.phantom.join(", ")}`);
  if (r.shrugged.length) log(`      dismissed: ${r.shrugged.map(x => `${x} (${dismissed.get(x)})`).join(", ")}`);
}

// ── THE CROSS-HUB TIER: every closure the WIDENING produced, named ───────────
// The foreign-verdict index is a WIDENING, which is the silent-failure direction, and
// the gate is what makes it affordable — not silence. So each closure it produces is
// printed with the crediting seat and that mail's own subject, the same posture the
// DISMISSED lines take: report what the filter did, never merely act on it.
// COMPLETE ON PURPOSE, even though partially-open rows also annotate inline above: one
// `grep -i cross-hub` must return the whole set, or an audit built on it is a floor.
if (crossHub.length) {
  log(`\n  — closed by a CROSS-HUB verdict: ${crossHub.length} sha(s) this session never answered itself —`);
  log(`    (another seat's verdict. Gated: verdict-SHAPED subject, NOT request-shaped, sha in`);
  log(`     that subject. Each one is a row this scan would otherwise still be flagging OPEN.)`);
  for (const c of crossHub) {
    log(`  🔗 ${c.sha} (${c.tier})  requested by ${c.requester}  ${c.when}`);
    log(`      request: ${c.subj}`);
    log(`      closed by ${c.from} -> ${c.to}: ${(c.subject || "(no subject)").slice(0, 78)}`);
  }
}

// THE CONTEXT-ONLY TIER. A row whose every unanswered sha was cited mid-prose is
// PROBABLY background, and the whole point of the target/context split is that it does
// not have to be right about that — the row still prints, one tier down, so a
// mis-classified target costs a glance instead of a dropped review. Do NOT "clean this
// up" by suppressing the tier: that converts a safe over-report into the silent
// under-report this scan exists to catch.
const ctxOnly = rows.filter(r => !r.open.length && r.openContext.length);
if (ctxOnly.length) {
  log(`\n  — lower confidence: ${ctxOnly.length} request(s) whose only unanswered shas are cited mid-prose —`);
  for (const r of ctxOnly) {
    log(`  ℹ️  CONTEXT-ONLY  from=${r.from}  ${r.when}`);
    log(`      ${r.subj}`);
    log(`      unanswered, but never announced as a target: ${r.openContext.join(", ")}`);
  }
}

if (rows.length && closed === 0) {
  if (json) emitJson("zero-answered", 2);
  log(`\n  ⛔ CONTROL FAILED: zero requests read as answered. The detector cannot`);
  log(`     report success, so it cannot report failure either. Fix before trusting.`);
  process.exit(2);
}
if (rows.length === closed) {
  // TRUTH IN OUTPUT: a DISMISSED sha was never answered, and saying "answered" about it
  // is the certifying shape this whole file exists to avoid. Say which it was.
  const anyDismissed = rows.some(r => (r.shrugged || []).length);
  // ...and a CONTEXT-ONLY row is not an answered one either. Claiming "every request
  // is answered" over a tier the scan itself moved would be exactly the certifying
  // shape the dismissal wording above exists to avoid.
  log(ctxOnly.length
    ? `\n  ✅ every request's TARGETS are answered — ${ctxOnly.length} row(s) still carry unanswered CONTEXT shas above.`
    : anyDismissed
      ? `\n  ✅ every request is either answered or explicitly DISMISSED with a reason above.`
      : `\n  ✅ every request with a SHA anchor has an answer naming it.`);
  // ...and "an answer" is not "MY answer". That third branch read "has an OUTBOUND
  // answer naming it" until 2026-09-02, which the cross-hub widening had already made
  // false — a green certifying sentence about work this session never did. Same posture
  // as the DISMISSED wording directly above: name what actually closed it.
  if (crossHub.length) {
    log(`     — ${crossHub.length} of those closed on ANOTHER seat's verdict (listed above), not on anything this session sent.`);
  }
}
log(`\n  NOT a queue verdict — a prompt to look. A request whose verdict named no`);
log(`  SHA reads OPEN here and may be closed; read the thread before acting.`);
log(`  A sha cited mid-prose is reported as CONTEXT, never dropped — if one was`);
log(`  really a target, it is in the context line, not missing.`);
if (json) emitJson("ok", 0);
process.exit(0);
}

// ── entry ─────────────────────────────────────────────────────────────────────
// Main-guard: without it, IMPORTING this module to test the predicate runs a full
// report and process.exit()s before the importer's first assertion. The sibling
// scan shipped exactly that bug and had to fix it 2026-08-12 — copied here rather
// than re-learned.
const isMain = isMainModule(import.meta.url);

// ⛔ UNKNOWN FLAGS FAIL LOUD. This script takes NO arguments, and until 2026-08-26 it silently
// IGNORED every one of them — so `--self-test` ran the live scan and printed a full report, which
// is indistinguishable from a self-test that passed. That makes any gate composed above it
// false-green (a runner's "helpful" path certifies nothing). Measured the same day, by a
// seat that ran `--self-test` on this file and got the live queue back.
// `--sid <sid8>` and `--json` are the two it takes (2026-10-26); anything else still
// refuses, for the reason above.
export function parseScanArgs(argv) {
  const opts = { sid: ENV_ME, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--sid" && argv[i + 1] && !argv[i + 1].startsWith("-")) opts.sid = argv[++i].toLowerCase().slice(0, 8);
    else return { error: a };
  }
  return opts;
}

if (isMain) {
  const argv = process.argv.slice(2);
  const opts = parseScanArgs(argv);
  if (opts.error !== undefined) {
    console.error(`closure-scan: unknown or incomplete argument ${JSON.stringify(opts.error)}; got ${JSON.stringify(argv)}`);
    console.error("  usage: node scripts/review-request-closure-scan.mjs [--sid <sid8>] [--json]");
    console.error("  identity comes from --sid, else CLAUDE_CODE_SESSION_ID (refuses rather than guessing).");
    console.error("  --json prints ONE JSON document (requests, open shas, closed-via) and nothing else.");
    console.error("  SESSION-SCOPED: two seats read DISJOINT populations (measured 120 / 30 / 3 on one");
    console.error("  store), so 'it does not reproduce on my run' means nothing. To check a peer's");
    console.error("  reading, run it as them: node <this file> --sid <their-sid8>.");
    console.error("  to suppress a known false-RED row, add '<sha7> <reason>' (one per line) to");
    console.error("  .claude/state/closure-scan-dismissed-<your-sid8>.txt — documented nowhere else.");
    console.error("");
    console.error("  ⛔ THE HAND WORKAROUND IS BLIND IN ITS OWN DIRECTION. Hitting this scan's");
    console.error("  over-reporting, the natural move is to enumerate verdict SUBJECTS by hand.");
    console.error("  Measured 2026-08-26: that closed 4 of 5 flagged rows and could not close the");
    console.error("  5th. A review that happened INFORMALLY, and a verdict whose SUBJECT led with");
    console.error("  the finding, both read as ZERO. The 5th closed only by reading the commit BODY");
    console.error("  and the LIVE FILE. Two instruments, two blind spots, opposite directions.");
    console.error("  (Folded here, not in the header, on a measurement that the header is");
    console.error("  56% comments and records its own read-failure.)");
    process.exit(2);
  }
  main(opts);
}
