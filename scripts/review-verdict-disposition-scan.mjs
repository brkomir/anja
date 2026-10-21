#!/usr/bin/env node
// review-verdict-disposition-scan.mjs — the close-out net's REVIEW-PLANE eye.
//
// WHY THIS EXISTS (the gap it closes). Every other close-out check —
// /hanging-work's 12 checks, /wrap's `mail-check --peek`, Step 5e — scans the
// DURABLE plane (git, todo.txt, trackers). A cross-session `--code` VERDICT lives
// on the EPHEMERAL mail plane: TTL-pruned, archived-on-read (`*.md.read`), and
// git-IGNORED (never committed). So a verdict's recommended-but-un-dispositioned
// findings have exactly ONE bridge to the durable plane — orchestrator memory at
// the read moment (possession≠application). When a session pivots mid-arc
// that memory scrolls/compacts out and the follow-up strands. This is
// the machine reason a hub-reviewed session — the one that CORRECTLY delegates its
// review — is the MOST exposed: the review's existence satisfies Step 5e while its
// findings sit on a plane the net never reads. Evidence: one verdict's recommended folds
// landed only via a manual double-check, not the net.
//
// WHAT IT DOES (deterministic, zero-LLM — the computed-not-asserted shape).
// Enumerates every surviving review-plane mail addressed to THIS session, lists
// each verdict's finding tokens, and prints a DISPOSITION HINT across TWO planes:
//   · DURABLE — does a recent commit or a todo.txt row DISPOSITION the review-id?
//     Not merely NAME it: a clause citing the id must also carry review vocabulary,
//     or a commit that merely writes ABOUT the backlog disposes of everything it
//     lists (see citesDisposition, 2026-09-02).
//   · MAIL — for a REQUEST this session received, did this session's own outbound
//     answer it? A request's disposition is the verdict mail sent back, which no
//     commit trace can ever see (see answeredState, 2026-09-02).
// It does NOT auto-resolve finding↔commit mapping (fuzzy — same accepted-FP posture
// as Check 12); it SURFACES the checklist for the orchestrator to cite a disposition
// per finding. The structural value is the ENUMERATION: you WILL see every verdict
// this session received, regardless of whether anyone remembered it.
//
// KNOWN HOLE (documented, not hidden). The read-TTL prunes a verdict's drop file;
// `mail-events.jsonl` (the durable denominator) records only ts/event/recipient/
// filename/sender — NO signal, NO subject — so a pruned verdict is detectable as
// "a hub mail was received earlier" but its findings are NOT recoverable from the
// log. The companion TTL bump in session-manifest.py (signal-bearing mails keep the
// 72h unread-TTL even after read) shrinks this window; anything still pruned is
// surfaced as a "disposition from transcript/memory" advisory, never silently.
//
// Usage:
//   node scripts/review-verdict-disposition-scan.mjs [--sid <sid8>] [--hours N]
//   node scripts/review-verdict-disposition-scan.mjs --self-test
// Wired at: /hanging-work Check 13 (→ fires at /wrap Step 1 automatically).

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";  // REPO anchors on this module, not argv[1] — see below

// ⛔ ANCHOR ON THE MODULE, NEVER ON argv[1]. This read `path.resolve(process.argv[1], "..", "..")`
// until 2026-08-30, so through a symlinked invocation REPO pointed at the symlink's directory, the
// mail store was not found, and this check printed a confident "Clean." over 29 real verdicts —
// one of them undispositioned. Silence would have invited suspicion; a clean verdict does not.
// Same class as check-lesson-numbers.mjs's third fail-open ("anchor to the SCRIPT's own location,
// never the caller's cwd"). Surfaced by a later sweep, which turned the silent no-op into the
// false clean and so made it visible.
const REPO = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const MAIL_DIR = process.env.FF_MAIL_DIR || path.join(REPO, ".claude", "state", "session-mail");
const EVENTS_LOG = path.join(REPO, ".claude", "logs", "mail-events.jsonl");
const STATE_DIR = path.join(REPO, ".claude", "state");

// ── frontmatter parse (from/to/subject/signal/created) ─────────────────────────
function parseMail(raw) {
  const fm = {};
  const lines = raw.split("\n");
  let inFm = false;
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "---") {
      if (!inFm) { inFm = true; continue; }
      bodyStart = i + 1; break; // second --- closes frontmatter
    }
    if (inFm) {
      const m = l.match(/^(\w[\w-]*):\s?(.*)$/);
      if (m) fm[m[1].toLowerCase()] = m[2].trim();
    }
  }
  return { fm, body: lines.slice(bodyStart).join("\n") };
}

// Typed signals that are review-plane but do NOT start with `deploy-`. Measured against
// a hub's live outbound traffic (60 mails, 2026-08-12): deploy-clear 11 +
// deploy-hold 15 PASSED the plane test, while fold-verify 11 + review-ack 7 +
// review-update 16 = 34 of 60 FAILED it. `fold-verify` is the one that MATTERS, because
// it IS the loop-closing confirmation — and it was being excluded by the PLANE test at
// scan() before `isConfirmation` ever ran, so every loop the hub closed by fold-verify
// still read as un-dispositioned.
//
// NAMED-REJECT of the wider fix the review offered as an alternative ("accept any typed
// signal: and let isConfirmation discriminate"): `review-ack` and `review-update` are
// engagement, not verdicts — admitting them to the plane would enumerate 23 more mails
// as verdicts each needing a disposition, inflating 🔴 with things that carry no
// findings. They are correctly NOT confirmations either, so excluding them costs the
// confirmation path nothing. Narrow set, stated reason.
const REVIEW_PLANE_SIGNALS = new Set(["fold-verify"]);
// ⛔ DO NOT ADD `writehold` / `writehold-lifted` HERE. `isConfirmation` reads TRUE for a
// `writehold-lifted` mail whose subject contains "write-hold lifted" — the hyphen supplies
// the word boundary its regex needs. Today that is UNREACHABLE, because the signal is not
// review-plane and this gate runs first; under the OLD `deploy-quiet*` names it WAS
// reachable, so the rename closed it rather than introducing it. Adding either token to
// this set re-opens it silently — a fleet write-hold would score as a hub confirmation and
// self-disposition.

// A mail is REVIEW-PLANE if it carries a typed deploy-* / review signal OR its subject
// reads as a verdict / fold-verify / --code result (the fallback for non-hub reviewers).
function isReviewPlane(fm) {
  const sig = (fm.signal || "").toLowerCase();
  if (sig.startsWith("deploy-")) return true;
  if (REVIEW_PLANE_SIGNALS.has(sig)) return true;
  const subj = (fm.subject || "");
  // `--code` is pulled OUT of the \b…\b group: a leading \b before "--code" can NEVER
  // match (after a space, "-" is a non-word char → no word boundary), which silently
  // dropped the non-hub-reviewer fallback (a bare `--code` subject with no deploy-*
  // signal) from the scan entirely. Match it literally instead.
  return /\b(VERDICT|CHANGES-REQUESTED|fold-verify|DEPLOY-(?:CLEAR|HOLD))\b/i.test(subj)
    || /--code/i.test(subj);
}

// A verdict whose subject reads as a hub CONFIRMATION (the hub verified a fold and
// signed off) is informational — its disposition IS the PASS. An ACTIONABLE verdict
// carries findings or recommended folds the session must still disposition.
function isConfirmation(fm) {
  const subj = fm.subject || "";
  const sig = (fm.signal || "").toLowerCase();
  // An active hold / changes-requested is NEVER a confirmation (guard first).
  if (sig === "deploy-hold" || /\bCHANGES-REQUESTED\b/i.test(subj)) return false;
  // A TYPED `signal: fold-verify` declares the confirmation directly — do not make this
  // depend on the subject happening to contain "VERIFIED"/"PASS". Both live samples
  // measured live ("LOOP CLOSED … claim 4 VERIFIED at source", "record fix VERIFIED at
  // source") pass the subject regex only by LUCK of wording; the signal is the contract.
  if (sig === "fold-verify") return true;
  // A fold-verify / hold-lifted / verified / PASS result is a pure confirmation — its
  // disposition IS the pass.
  return /\b(fold-verify|hold LIFTED|verified|PASS)\b/i.test(subj);
  // NOTE on APPROVED (resolved as a NAMED-REJECT of the naive fix): one
  // proposal was to also class "APPROVED · deploy-clear" as a confirmation. It is NOT,
  // because APPROVED verdicts split two ways — clean (nothing to disposition) vs
  // APPROVED-with-recommended-folds (real follow-ups) — and there is no
  // ROBUST subject/body signal to tell them apart: a body check false-🟢s on negation
  // ("Nothing to fold" contains "fold"); a finding-token check false-🟢s on "zero
  // P0/P1". A false-🟢 HIDES a verdict — the exact strand this net exists to catch.
  // So APPROVED routes through the disposition trace instead: traced → 🟡, untraced →
  // 🔴. The rare false-🔴 (a clean APPROVED with no commit/todo trace) is the SAFE
  // direction (surface it, orchestrator confirms clean — Check-12's accepted-FP
  // posture), never the dangerous one.
}

// review-id = the leading token of the subject, before VERDICT/fold-verify/Lane/--code.
// e.g. "S24 VERDICT: …" → "S24"; "QW#10 fold-verify …" → "QW#10"; "S30/S31 …" → "S30/S31".
// Is this token a commit in THIS repo? Memoized — scan() calls reviewId once per verdict
// and subjects carry 1-2 sha-shaped candidates, so the subprocess count is tens, not
// thousands. Any failure (not a commit, ambiguous prefix, git unavailable) is FALSE, which
// routes to no-rid → SURFACE.
const _commitCache = new Map();
// ⛔ SHA-SHAPED tokens ONLY, tracked separately for the positive control below. A review-id
// is often a LANE LABEL (`S24`, `QW#10`) which is legitimately not a commit, so a control
// over every tested token would fire on a healthy run whose ids are all labels.
const _shaShaped = new Map();
function gitIsCommit(token) {
  if (_commitCache.has(token)) return _commitCache.get(token);
  let ok = false;
  try {
    ok = execSync(`git cat-file -t ${token}`, {
      cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim() === "commit";
  } catch { ok = false; }
  _commitCache.set(token, ok);
  // ⛔ {6,40}, MATCHING THE REVIEW-ID FAMILY — NOT the {7,40} sha-SCANNING family.
  // This file carries BOTH widths on purpose: the sha SCANNERS
  // (`:247`, `:380`, `:628`) require 7+, while the review-id EXTRACTOR accepts 6+ (`:255`,
  // `:291`, `:343`, and `:249` calls that "UNIFORM AUTHORITY"). The tokens reaching
  // `gitIsCommit` come from the EXTRACTOR, so a {7,40} filter here made a 6-hex token
  // sha-shaped enough to be REJECTED as a review-id and not sha-shaped enough to enter the
  // control's population — discarded by one predicate, invisible to the other, which is the
  // one state where the control cannot fire on what was just thrown away.
  // ⚠️ Reachability — and my FIRST measurement of it was of the wrong population, corrected
  // here before shipping. I probed LEADING SUBJECT tokens and read ZERO 6-hex against 57 in
  // the 7-40 range, and was about to record this as prophylactic. But the control's own
  // population moved **58 → 59** on the identical poisoned arm the moment the width changed,
  // which proves exactly one 6-hex token DOES reach `gitIsCommit` — it just does not arrive
  // as a leading subject token. **The instrument's own count is the ground truth about its
  // population; a probe I wrote for it is not.** Live, not prophylactic.
  if (/^[0-9a-f]{6,40}$/i.test(token)) _shaShaped.set(token, ok);
  return ok;
}

// ⛔ POSITIVE CONTROL ON THE GIT RESOLVER — the sibling `review-request-closure-scan.mjs`
// has carried this since it was written and this scan shipped without it, which is the
// asymmetry this closes. `gitIsCommit`'s `catch { ok = false }` folds
// THREE causes into one — not a commit, ambiguous prefix, git unavailable — and every one
// routes to no-rid. Under the third, EVERY sha-shaped id fails at once and this scan then
// prints an exculpating sentence over a wall of reds at rc=0. Measured on the
// shipped script: healthy 1 red, `PATH=/nonexistent-dir` 13 reds, same rc, same wording.
// The direction is what makes it serious — before the note existed a git outage produced an
// UNEXPLAINED wall, which a reader investigates; after it, the wall arrives pre-excused.
function gitResolverControl() {
  const vals = [..._shaShaped.values()];
  if (vals.length && !vals.some(Boolean)) {
    console.log(`\n  \u26d4 RESOLVER CONTROL FAILED: ${vals.length} sha-shaped review-id(s) tested,`);
    console.log(`     ZERO resolved as commits. Suspect git is unreachable, not a store full of`);
    console.log(`     phantoms. Every "trace could not run" note below is then UNRELIABLE — the`);
    console.log(`     ids are present and git could not check them. Do not read this run as clean.`);
    return false;
  }
  return true;
}

function reviewId(subj, isCommit = gitIsCommit) {
  const s = subj || "";
  // ── SHA-ANYWHERE FIRST ─────────────────────────────────────────────────────────
  // I proposed a sha-leading subject convention for senders. Review agreed AND refused
  // to let me ship on it, which was the right call: a sender convention cannot close
  // this, because three of the senders' real shapes have no single leading sha (multi-sha
  // "<sha> + <sha>", a pre-verdict ACK, a sha-less STOP), and every NEW sender
  // re-opens it.
  //
  // The load-bearing fix is here, and it RETIRES a list instead of extending it. The
  // keyword split below is HAND-ENUMERATED, and the comments underneath record it being
  // extended twice — once "one bracket short", once for a shape that then "became the
  // hub's DOMINANT one". `INTERIM`/`PARTIAL`/`LOOP`/`STOP`/`FULL`/`ACK` would make three.
  // A sha needs no keyword: it is self-identifying. So derive from the OBLIGATION ("find
  // the reviewed commit") rather than from the spellings met so far — at this
  // surface, and a reviewer found it by reading my code before answering my question.
  //
  // ⛔ THE DISCRIMINATOR IS NOT CHARSET — IT IS WHETHER GIT RESOLVES IT (2026-08-12).
  // I shipped a charset heuristic here twice, and the second was worse than
  // the thing it "fixed".
  //
  // What happened: an all-digit token resolved as a review-id, I read it as a plain
  // figure, called it a false positive, and required a hex LETTER alongside the digit. Re-measured
  // independently after a review's STOP:
  //     git cat-file -t <sha>       → commit
  //     git log --oneline -1 <sha>  → meta(learn): lessons from the deep-pass …
  // It is a REAL COMMIT, one of the five that verdict reviewed. The digit-only predicate
  // had been RIGHT, and my "regression fix" created a genuine false-NEGATIVE class:
  // measured here, 80 of 5000 short shas are all-digit (1.60%; theoretical (10/16)^9 =
  // 1.46%, so it is structural, not a quirk of this repo — the repo holds other all-digit
  // commits too, one of them from earlier the same night). About one review in
  // sixty would silently lose its rid, failing toward the vacuous trace the review-id rules exist to close.
  //
  // Shape CANNOT separate "9 hex chars" from "9-digit figure", because the first
  // legitimately CONTAINS the second. So shape is a cheap PREFILTER and git is the
  // authority — the obligation is "find the reviewed COMMIT", and git is what knows one.
  // This admits all-digit shas, rejects a stray figure or a hex-spelled word ("defaced")
  // with no charset rule at all, and fails SAFE: an unresolvable token yields no rid, which
  // routes to SURFACE.
  //
  // Both of my attempts failed the same way — reasoning about the SHAPE of the thing
  // instead of asking the system that owns it. Same move as the keyword list this block
  // replaced, one level down. `isCommit` is injectable so the self-test stays disk-
  // decoupled for the shape arms and uses the real resolver for the authority arms.
  //
  // FIRST match, not "ambiguous if two" (the one place I did not take the review's
  // prescription — reasoning in the fold reply): its own multi-sha example is two
  // commits reviewed TOGETHER in one verdict, so the first traces a genuine target and
  // returning empty there would surface a verdict that is perfectly traceable. The case
  // its caveat really names — a subject quoting a FIX sha rather than the reviewed one
  // — is unreachable for that example, because a `signal: fold-verify` mail is
  // classified a CONFIRMATION and never reaches the trace at all.
  const sha = (s.match(/(?<![A-Za-z0-9])[0-9a-f]{7,40}(?![A-Za-z0-9])/gi) || []).find(isCommit);
  if (sha) return sha;
  // UNIFORM AUTHORITY. The keyword fallback below has its own `[0-9a-f]{6,40}` branch, so
  // without this a sha-shaped token the prefilter just REJECTED walks straight back in
  // through the other door — measured: `VERDICT 999999999` returned "999999999" after the
  // git check had already declined it. One invariant, both paths: a sha-SHAPED token is
  // never returned as a rid unless git resolves it to a commit. Non-sha-shaped ids (S24,
  // QW#10, the ALL-CAPS residual) are unaffected — git has no opinion on those.
  const shaShapedNonCommit = (t) => /^[0-9a-f]{6,40}$/i.test(t) && !isCommit(t);
  const head = s.split(/\b(?:VERDICT|fold-verify|Lane|--code|CHANGES|APPROVED)\b/i)[0].trim();
  // Subject-LEADING keyword ("VERDICT <sha> NAME — …", the hub's standard verdict shape):
  // head is EMPTY, and the old code returned "" → the trace grepped an empty string → 0
  // hits → a GUARANTEED false 🔴 on every such verdict (measured 6/6, 2026-07-19 — all six
  // were provably dispositioned via fold commits citing their shas). Take the token AFTER
  // the keyword instead: a sha or the first id-shaped token.
  //
  // ⛔ THE FIX ABOVE WAS ONE BRACKET SHORT, and the shape it missed became the hub's
  // DOMINANT one (2026-07-31). `!head` tests for EMPTY, but the bracketed subject
  // "[VERDICT] <sha> — …" splits to head = "[" — non-empty, truthy, so the fallback
  // never fired and the rid became the literal "[". MEASURED this turn:
  //     "[VERDICT] <sha> — …"   -> "["      (broken)
  //     "[fold-verify] <sha> …" -> "["      (broken)
  //     "VERDICT <sha> — …"     -> "<sha>"  (the shape the fallback was built for)
  // Every verdict in the live scan printed `review-id=[`, i.e. 100% of them, so Check 13
  // could never go green for a bracketed verdict no matter how thoroughly it was folded —
  // a gate that cries wolf every wrap gets read as noise, which is how a REAL
  // undispositioned verdict would slip past. Test for "no id-shaped content" rather than
  // "empty": punctuation-only heads ("[", "[ ", "()") are the same case as empty.
  if (!/[A-Za-z0-9]/.test(head)) {
    // `[\]:\s]+` not `[:\s]+`: the bracketed subject is "[VERDICT] <sha>", so the char
    // right after the keyword is `]`. With the old class the match failed and the rid fell
    // through to the literal "[" EVEN ONCE the head-test above was fixed — two independent
    // defects on the same path, which is why this was measured rather than reasoned: the
    // first fix alone still returned "[" on all four bracketed fixtures.
    const after = s.match(/\b(?:VERDICT|fold-verify)\b[\]:\s]+([0-9a-f]{6,40}|[A-Za-z]+[\w#/.-]*)/i);
    if (after && !isVacuousRid(after[1]) && !shaShapedNonCommit(after[1])) return after[1];
    // Vacuous head token → fall through to the general scan below, which skips it and
    // looks for a real id later in the subject.
  }
  // sha-LEADING subjects ("<sha> S2 spatial gates — …", the hub's dominant fold-verify
  // shape): the letter-leading token match DROPS a sha's leading digit(s) (a
  // digit-leading sha comes back without them → trace misses every commit citing the real
  // sha; ~62% of shas are digit-leading). Try a leading full-sha FIRST, same [0-9a-f]{6,40}
  // shape as the empty-head fallback so both entry-shapes treat a sha identically.
  const tok = head.match(/^[0-9a-f]{6,40}\b/)
    || head.match(/[A-Za-z]+[\w#/.-]*/); // S24, S30/S31, QW#10, F52, Flow#66
  if (tok && !isVacuousRid(tok[0]) && !shaShapedNonCommit(tok[0])) return tok[0];
  // No usable id ⇒ "" — the honest answer, and the SAFE one: an empty rid makes the trace
  // un-runnable, so needsAttention() surfaces the verdict for a human instead of passing
  // it on a vacuous count.
  //
  // ⛔ I BUILT A "RESCUE SCAN" HERE FIRST — walk the whole subject for the first
  // identifier-shaped token — AND EVERY REFINEMENT OF IT PRODUCED A NEW FALSE ID. On the
  // one live subject that motivated the work it returned, in order: "I" (a capitalised
  // pronoun), then "VERDICT" (the scan's own keyword), then "CHANGES-REQUESTED" (id-shaped
  // via its hyphen, 12 commits + 18 rows), then "session-cadence" (a FILE NAME quoted in
  // the prose, 15 + 8). Four tries, four vacuous traces, each one looking more plausible
  // than the last. The subject is PROSE, and prose contains arbitrary identifier-shaped
  // tokens — so the scan was unbounded by construction and no denylist closes it.
  //
  // The tell was that each fix was prompted by the SAME live subject failing again. When a
  // guard needs a new exception per instance, the guard is the wrong shape. Deleted rather
  // than tuned; the cost is a false-🔴 on the hypothetical "VERDICT the fix for S24" shape
  // (which I invented — no measured mail has it), and this file's whole posture is that a
  // false-🔴 is the safe direction and a false-🟢 hides a verdict.
  return "";
}

// ⛔ A REVIEW-ID THAT IS AN ORDINARY WORD MAKES THE TRACE VACUOUS, AND THE FAILURE IS A
// SILENT PASS (reproduced live on this scan's own output 2026-08-12).
// Measured: the subject "VERDICT the 5 I dropped: 2 CHANGES-REQUESTED …" extracted
// rid="the" → `trace: 0 recent commit(s) + 6357 todo.txt row(s)` → rendered 🟡 traced. A
// CHANGES-REQUESTED verdict carrying SIX finding tokens displayed as dispositioned,
// because "the" appears in 6357 tracker rows. That is a false NEGATIVE — the net silently
// passing an open verdict, i.e. precisely the strand this scan exists to catch, and the
// opposite of the safe direction every other guard in this file is tuned toward.
//
// The discriminator is IDENTIFIER-SHAPE, not a stopword list (a list is a guess at the
// vocabulary; shape is a property). A real rid carries a digit (S24, F52, Flow#66), a
// separator (S30/S31, QW#10), sha-hex, or is an uppercase code. An all-lowercase
// alphabetic run is prose.
//
// ⚠️ The sha exemption below is LOAD-BEARING and my first version omitted it, on a comment
// that asserted the opposite: "a genuine lowercase sha is unreachable here, the hex branch
// matches it first." FALSE — the hex branch decides what gets CAPTURED, and the vacuity
// filter then runs on the captured string either way, so `VERDICT deadbeef` had its rid
// eaten. Caught by the control arm, not by re-reading. Comment-vs-code drift, in the
// comment explaining the fix.
//
// RESIDUAL, stated rather than silently left: an ALL-CAPS generic token still passes and
// still inflates — live on this same run, "FULL" traces 12 commits + 345 rows, "STOP" 18 +
// 73, "INTERIM" 2 + 32. Those are deliberate hub prefixes, so rejecting them needs a
// convention call with the hub rather than a predicate here.
function isVacuousRid(t) {
  const s = t || "";
  if (/^[0-9a-f]{6,40}$/i.test(s)) return false; // sha-shaped — an id even when all-lowercase
  return /^[a-z]+$/.test(s);
}


// Finding tokens — the observed hub vocabulary (F-A / F1 / FIX-3 / P0-P3). Heuristic
// by design; a false token is cheap (accepted-FP, like Check 12's generic-keyword FP).
function findingTokens(body) {
  const toks = new Set();
  for (const re of [/\bF-[A-Z]\d?\b/g, /\bF[0-9]\b/g, /\bFIX-[0-9]+\b/g, /\bP[0-3]\b/g]) {
    for (const m of body.matchAll(re)) toks.add(m[0].toUpperCase());
  }
  return [...toks].sort();
}

function sh(cmd) {
  try { return execSync(cmd, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return ""; }
}

// Token-bounded citation test: does `text` cite `id` as a whole token (non-alphanumeric
// on both sides)? A raw substring match inflates the count — "ACK" matches BACKLOG,
// "track", a sha's hex run — which biases the 🔴 flag to a FALSE-NEGATIVE (an inflated
// commit count masks a genuinely undispositioned verdict, the tool's whole reason to
// exist). Used SYMMETRICALLY on both the git-commit and todo.txt planes.
function citesToken(text, id) {
  const esc = id.replace(/[.*+?^${}()|[\]\\/#]/g, "\\$&");
  if (new RegExp("(?<![A-Za-z0-9])" + esc + "(?![A-Za-z0-9])", "i").test(text)) return true;
  // SHA-EMBEDDED review-ids (2026-07-13). The rid is a SUFFIX FRAGMENT of the commit sha
  // (rid `cf8069` <- the sha it was cut from), but commits cite the FULL sha — so a strict token
  // boundary can NEVER match the very sha the rid was derived from. MEASURED: three commits
  // cite the full sha (one of them is literally the fold) and this trace counted ZERO, which
  // made the scan accuse a provably CLOSED loop. The token-bounding (added to kill a
  // falsely-REASSURING substring count) had over-corrected into a false ACCUSATION.
  // Fix: also accept the rid inside an all-hex, git-sha-shaped token — and ONLY there, so
  // no loose substring matching creeps back in (`featurecf8069x` must still NOT count).
  if (/^[0-9a-f]{6,}$/i.test(id)) {
    const shas = text.match(/(?<![A-Za-z0-9])[0-9a-f]{7,40}(?![A-Za-z0-9])/gi) || [];
    if (shas.some((sha) => sha.toLowerCase().includes(id.toLowerCase()))) return true;
  }
  return false;
}

// ⛔ A CITATION IS NOT A DISPOSITION — REQUIRE A DISPOSITION VERB IN THE SAME CLAUSE
// (2026-09-02).
//
// `citesToken` answers "is this id named here", and the trace was reading that as
// "was this id DEALT WITH here". The two diverge on exactly one shape and it is the
// shape a careful hub produces most: a TRIAGE record. Measured — one commit,
// a plan entry listing the backlog, carried the line
//     "The zeros: <four shas>. Three of those four are FOLD notices,"
// and the next scan dropped all four ids off the red list. Two were then handled by
// hand; two were not, and went invisible while still sitting UNREAD with zero replies.
// The instrument's success signal was satisfiable by WRITING ABOUT the problem, so the
// better the triage record, the fewer items the scanner shows — an inversion, not a gap.
//
// ⛔ THE OBVIOUS FIX IS REFUTED BY ITS OWN FIXTURE, WHICH IS WHY THE CLAUSE SPLIT EXISTS.
// The tracker row prescribes "require a disposition token in the citing LINE". Measured on
// the motivating commit: that physical line ENDS "Three of those four are FOLD notices,",
// so a per-LINE token test PASSES on the one instance the row was filed for. A line is not
// the unit of assertion; a CLAUSE is. Split on sentence enders / em-dashes / newlines and
// require the verb to sit in the same clause as the id — then "The zeros: <four ids>." and
// "Three of those four are FOLD notices," are two clauses and neither one qualifies.
//
// VOCABULARY DERIVED FROM THE LIVE CORPUS, NOT INVENTED — AND THE FIRST DRAFT WAS MEASURED
// WRONG (the just-fixed-corpus discipline, tests-unit.md § WIDEN A JUST-FIXED CORPUS, and
// the read-the-hits-never-the-count rule).
//
// Draft 1 was the ACT vocabulary alone — fold / verdict / named-reject / changes-requested /
// deploy-* / disposition. Run over the live store it took 🔴 from 22 to 38, and a hand-read of
// the 16 new flags found real false-🔴: one sha was dispositioned by three commits reading
// "Hub P1 on <sha>, filed as not-theirs-not-mine. It is mine." and "the two <sha> P2s
// nobody had filed", and another by "Hub ALTERNATIVE on <sha>, two lenses." Not one of
// them names a fold. **A disposition is a clause ABOUT THE REVIEW, and the act-verb is only one
// of the ways it says so** — the actor (hub/breaker), the finding token (P1/F-A) and the verdict
// outcome (ALTERNATIVE/APPROVED) are the others, all already first-class vocabulary elsewhere in
// this file (`findingTokens`, `isConfirmation`, `REVIEW_PLANE_SIGNALS`).
//
// ⛔ `refuted` IS DELIBERATELY EXCLUDED and it is the closest call here. It reads like an outcome
// word, and it appears in the corpus — "… refuted its own token test for
// owner-legible table copy at <sha>" — which is a MENTION of an unrelated refutation that
// happens to name a reviewed sha. Admitting it would have kept that sha green on nothing.
//
// ⚠️ This is a keyword set over PROSE and that shape has failed in this file before (the
// review-id keyword list this file's SHA-ANYWHERE block retired). The difference is where the
// error lands: an unmatched spelling reads 🔴 and costs one confirmation, where the retired list
// produced a false ID and a vacuous trace. It is a HINT predicate, not an authority — if it needs
// a new word per instance, it is the wrong shape and should be replaced, not extended.
//
// DIRECTION OF ERROR, STATED. A miss here reads 🔴 — this file's documented safe direction
// (a false-🟢 HIDES a verdict; a false-🔴 costs one confirmation). It is still not free:
// 🔴 that cries wolf is how a real one gets ignored, which is why the ANSWERED arm below
// ships in the same change — it removes the largest false-🔴 class rather than loosening
// this predicate to compensate.
export const DISPOSITION_VOCAB = new RegExp([
  "fold",                                    // fold / folds / folded / folding / fold-verify / fold-report
  "verdict", "named-reject", "changes-requested", "disposition",
  "deploy-(?:clear|hold|review)",
  "\\bhub\\b", "\\bbreaker\\b",              // the actor: "Hub P1 on <sha>", "Security breaker returned …"
  "\\bP[0-3]\\b", "\\bF-[A-Z]\\d?\\b",       // the finding token — same vocabulary as findingTokens()
  "\\bALTERNATIVE\\b", "\\bAPPROVED\\b",     // the verdict outcome
].join("|"), "i");

// Clause split. Sentence enders must be followed by whitespace, so a decimal ("v2.77") and
// an abbreviated sha followed by a period both stay intact; the em-dash arm is load-bearing
// because this fleet's commit subjects put the disposition before it ("… items closed —
// <sha> fold-verified about 28 hours late").
export function dispositionClauses(text) {
  return String(text || "").split(/(?<=[.!?;])\s+|\s+[—–]\s+|\n/);
}

// Does `text` DISPOSITION `id` — cite it in a clause that also carries a disposition verb?
// Used symmetrically on the git-commit and todo.txt planes, exactly as `citesToken` was
// — the measured instance contaminated BOTH planes, and the only todo.txt
// row citing those four ids is the bug report for this very defect.
export function citesDisposition(text, id) {
  for (const c of dispositionClauses(text)) {
    if (citesToken(c, id) && DISPOSITION_VOCAB.test(c)) return true;
  }
  return false;
}

// Disposition trace: does the review-id show up in a recent commit and/or todo.txt IN A
// CLAUSE THAT ALSO DISPOSITIONS IT? Not proof of per-finding disposition — a HINT that
// narrows what to eyeball.
function dispositionTrace(rid) {
  const key = rid.replace(/[^\w#/.-]/g, "");
  if (!key) return { commits: 0, todo: 0 };
  // git: substring `--grep` is a cheap candidate SUPERSET; token-bound the records before
  // counting (symmetric with the todo plane). Recent window keeps it cheap.
  //
  // READ THE FULL MESSAGE, NOT `--oneline`. `--grep` searches the
  // WHOLE commit message; `--oneline` prints only the SUBJECT. So a commit that cites the
  // reviewed sha in its BODY passed the preselect and then failed the count — an
  // instrument-internal PLANE MISMATCH, not a convention problem. MEASURED: both folds of
  // one reviewed sha cite it in the body (subject 0 / body 1 for each),
  // and this trace returned ZERO for both, so a correctly-folded, hub-fold-verified verdict
  // read 🔴 forever. Two sessions diagnosed it from scratch before it was measured.
  // %x1f/%x1e are unit/record separators — they cannot occur in a commit message.
  const gl = sh(`git log --all --since="6 days ago" --grep="${key.replace(/[/#]/g, ".")}" --format=%H%x1f%B%x1e 2>/dev/null`);
  const commits = gl.trim()
    ? gl.split("\x1e").map((r) => r.trim()).filter(Boolean).filter((r) => citesDisposition(r, key)).length
    : 0;
  // todo.txt: same clause-bound predicate (a substring match gave a falsely-reassuring
  // count — dogfood: ACK hit 596 raw).
  let todo = 0;
  try {
    const t = fs.readFileSync(path.join(REPO, "todo.txt"), "utf8");
    todo = t.split("\n").filter((l) => citesDisposition(l, key)).length;
  } catch { /* no todo.txt */ }
  return { commits, todo };
}

function ownSid() {
  const argSid = argOf("--sid");
  if (argSid) return argSid.toLowerCase().slice(0, 8);
  const env = (process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || "").toLowerCase();
  return env ? env.slice(0, 8) : "";
}

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

// Pruned-verdict advisory: hub senders (learned from surviving verdicts + hub
// markers) whose mail to us appears in the events log but no longer on disk.
function prunedHubAdvisory(sid, hubSenders, hours) {
  if (!fs.existsSync(EVENTS_LOG)) return { count: 0, senders: [] };
  const cutoff = Date.now() - hours * 3600 * 1000;
  const onDisk = new Set(fs.existsSync(MAIL_DIR) ? fs.readdirSync(MAIL_DIR).map((f) => f.replace(/\.read(-by-[\w]+)?$/, "")) : []);
  const senders = new Set();
  let count = 0;
  let raw;
  try { raw = fs.readFileSync(EVENTS_LOG, "utf8"); } catch { return { count: 0, senders: [] }; }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.event !== "read" && e.event !== "surfaced-live") continue;
    if (isChannelEvent(e)) continue;
    if (e.recipient !== sid) continue;
    if (!hubSenders.has(e.sender)) continue;
    if (new Date(e.ts).getTime() < cutoff) continue;
    const base = (e.mail || "").replace(/\.read(-by-[\w]+)?$/, "");
    if (onDisk.has(base)) continue; // still enumerable above
    count++; senders.add(e.sender);
  }
  return { count, senders: [...senders] };
}

// fleet-channels: a mail-events row carrying `channel:` is
// channel traffic, NOT default-bus review-plane mail. Extracted as a PURE predicate so the
// self-test can assert BOTH arms against the real symbol — a filter buried inside the
// log-reading function could only be tested by a replica, which is structurally unfailable
// (the instrument standard this repo applies to its own probes).
// Why it matters more here than in mail-stats, which got the same discriminator: this
// scanner is the /hanging-work Check-13 enumeration path — the load-bearing net for
// UNDISPOSITIONED verdicts. Contaminating a stats headline is cosmetic; contaminating the
// net that catches stranded verdicts is not. A channel HARD-REFUSES `signal: deploy-*` at
// write, so a channel drop can never be a real verdict — every hit here is a false positive.
export function isChannelEvent(e) {
  return Boolean(e && e.channel);
}

function hubMarkerSenders() {
  const s = new Set();
  try {
    for (const f of fs.readdirSync(STATE_DIR)) {
      const m = f.match(/^review-hub-active-([\w]+)$/);
      if (m) s.add(m[1].slice(0, 8));
    }
  } catch { /* none */ }
  return s;
}

// ── ANSWERED-SIDE ARM: a review REQUEST I RECEIVED AND SERVED ──────────────────
// WHY (2026-08-31).
//
// The trace below asks whether a COMMIT or a todo.txt ROW dispositions the review-id. That
// is the right question for a VERDICT I received — my fold lands as a commit. It is the
// WRONG question for a REQUEST I received and answered, because the disposition of a
// request is THE VERDICT MAIL I SENT, and until now this scanner read none of its own
// outbound. The sent side already had its mirror (🟡 engaged / 🔴 AWAITING for requests I
// SENT); the received side had no answered arm at all, so every served request read 🔴.
//
// Measured 2026-08-31: 8 of 8 items on the ACTION line were served, each with a verdict mail
// of this session's, several with a fold-verify too — a 100% false-🔴 rate on that class. It
// had grown to 22 by 2026-09-02. The danger is not the noise itself: a REAL 🔴 is
// indistinguishable from these, so the honest response to a known-false-heavy list is to stop
// reading it, and that is the cry-wolf death of the whole net.
//
// ⛔ 🟢 ANSWERED IS NOT SILENCE AND NOT 🟡. It prints its own state with the timestamp of the
// outbound that answered it, exactly as the tracker row requires. Suppressing 🔴 on requests
// as a class was the explicitly named WRONG fix.
//
// ⚠️ ANSWERED IS NOT HANDLED, and the sent-side arm already says why: a reply measures
// did-I-REPLY, never did-I-HANDLE. What it does establish is that this session engaged the
// request ON THE PLANE WHERE A REQUEST IS ANSWERED, which is strictly more than the commit
// trace could ever see.
const BODY_SHA_CAP = 40; // bounds gitIsCommit subprocesses on a 26-sha BATCH; memoized across mails

// What must be cited for this request to count as served. A rid-bearing request is keyed on
// its rid; a BATCH whose subject carries no id-shaped token falls back to the shas ALREADY
// LISTED IN ITS BODY — three of the eight measured items were exactly that shape, and their
// 🔴 was not even a failed trace, it was a trace that could not run.
// ⛔ GIT IS THE AUTHORITY ON WHAT IS A SHA, not charset — this file's own rule, which the reviewId
// block above reached through two retracted charset heuristics. An unresolvable hex token
// yields no target, which drops the request back to 🔴 (the safe direction).
// ⛔ TYPED, NOT PROSE. The senders' own `signal:` frontmatter — never a guess about what a
// subject MEANS. Adopted after four consecutive passes of mine failed at the prose layer;
// a typed field cannot be fooled by phrasing, because it does not read phrasing. A fold
// report cites the folded sha and the verdict it answers as a matter of course; those are
// CONTEXT, not commits it is asking you to review, so it keeps the single-target rid behaviour.
const FOLD_REPORT_SIG = /^(fold-verify|fold-report)\b/i;

export function requestTargets(rid, body, isCommit = gitIsCommit, subject = "", signal = "") {
  // ⛔ `if (rid) return [rid]` MADE A BATCH REQUEST REPORT FULL ON ONE
  // COMMIT. `reviewId` reads the FIRST hex token out of the subject (see its own block, which
  // already names "multi-sha `<sha> + <sha>`" as a shape it cannot key), so a request
  // asking about several commits resolved to exactly one target and `full` went true as soon
  // as that one was cited. Every other commit in the batch was invisible to the answered arm.
  //
  // MEASURED before fixing, because the obvious remedy was worse: of 150 request-shaped
  // subjects on the live store, 56 name more than one sha and ~45 of those are genuine
  // multi-commit asks ("--code request: <sha> + <sha>", "3 commits touching
  // always-loaded rules", "4 follow-up commits"). Naming the batch in the subject is the
  // fleet's NORMAL shape, not an edge case.
  //
  // ⚠️ THE REJECTED FIX IS THE INTERESTING ONE. Unioning the rid with the BODY's shas —
  // the shape the verdict's wording suggests — was refuted by measurement: 232 rid-bearing
  // mails also name shas in their body, and hand-reading them showed the population is
  // dominated by FOLD-VERIFYs, which cite the folded sha and prior verdicts as a matter of
  // course. That union would have demanded citation of all of them and flipped ~232 rows to
  // a false PARTIAL — the same false-red shape measured and refused on the mail arm hours
  // earlier. So the fix reads the SUBJECT only and leaves the body path exactly as it was.
  //
  // Falls back to [rid] when the subject yields no git-resolvable token, so a rid derived
  // from a subject git cannot resolve behaves as before.
  if (rid) {
    // A self-declared fold report is not a multi-commit ask — keep the rid alone.
    if (FOLD_REPORT_SIG.test(String(signal || "").trim())) return [rid];
    const subjToks = [...new Set(
      (String(subject || "").match(/(?<![A-Za-z0-9])[0-9a-f]{7,40}(?![A-Za-z0-9])/gi) || [])
        .map((x) => x.toLowerCase()))];
    const resolved = subjToks.filter(isCommit);
    return resolved.length ? resolved : [rid];
  }
  const all = String(body || "").match(/(?<![A-Za-z0-9])[0-9a-f]{7,40}(?![A-Za-z0-9])/gi) || [];
  const distinct = [...new Set(all.map((s) => s.toLowerCase()))].slice(0, BODY_SHA_CAP);
  return distinct.filter(isCommit);
}

// Every mail THIS session SENT, with subject+body joined for the citation search. Broadcasts
// are included here and excluded by the `o.to === v.from` test in answeredState — a `--to all`
// note that happens to name a sha is not a reply to anyone's request.
function allOutbound(sid, mailDir = MAIL_DIR) {
  const out = [];
  if (!sid || !fs.existsSync(mailDir)) return out;
  for (const f of fs.readdirSync(mailDir)) {
    if (f.endsWith(".tmp")) continue;
    const base = f.replace(/\.read(-by-[\w]+)?$/, "");
    if (!base.endsWith(`__${sid}.md`)) continue; // I am the SENDER
    let raw; try { raw = fs.readFileSync(path.join(mailDir, f), "utf8"); } catch { continue; }
    const { fm, body } = parseMail(raw);
    // subject + signal KEPT: the class gate below needs them, and
    // this line discarded both, so a bare `signal: ack` reply was indistinguishable from
    // a verdict once its text mentioned the sha.
    out.push({ file: f, pickedUp: f !== base, to: base.split("__")[0], created: fm.created || "",
               subject: fm.subject || "", signal: (fm.signal || "").trim(), body,
               text: `${fm.subject || ""}\n${body}` });
  }
  return out;
}

// ⛔ FULL COVERAGE FOR 🟢, PARTIAL PRINTS AND STAYS 🔴 — A NAMED DEVIATION FROM THE ROW.
// The tracker row says to report 🟢 ANSWERED when an outbound "cites the review-id (or the
// request's shas)". Taken as ANY-of, a 26-sha BATCH answered on ONE sha would go green and
// drop off the ACTION line — and that batch's own body says, verbatim, "I need PER-SHA
// DISPOSITION, not a batch verdict", citing the measured shape where "PARTIAL service reads
// as complete". A false-🟢 HIDES a verdict, which is the one direction this file refuses. So
// 🟢 requires every target cited; partial coverage keeps the 🔴 and prints "N of M", which is
// strictly more information than today's bare 🔴 and cannot hide anything. Measured on the
// live store: SIX requests land PARTIAL — 3/12, 1/10, 5/10, 6/10, 6/11, 27/33 — every one of
// which the ANY-of reading would have dropped off the ACTION line.
//
// ⚠️ THE DENOMINATOR IS A CEILING, NOT THE REQUESTED SET. `requestTargets` takes every
// git-resolvable sha in the BODY, and a request body legitimately names shas it is not
// asking about ("your earlier verdict on <sha>"): the 26-sha batch above resolves to 33
// targets, and the printed ratio is a floor on service rather than an exact score. Do not
// "fix" this by parsing the body's list structure; that is a per-sender convention and the
// reviewId block above records two retractions from exactly that move.
//
// ⛔ THIS COMMENT ASSERTED "PARTIAL can over-fire, never under-fire — the error lands on
// 🔴, the safe side" UNTIL 2026-09-03, AND THAT GUARANTEE IS STRUCK. It was refuted twice
// over by a single review verdict: the mail arm could clear a live hold on a bare "ack"
// (an UNDER-fire — the finding in the block below), and the rid path reported FULL on one commit
// of a batch (also an UNDER-fire — see `requestTargets` above). The direction of this
// instrument's error is NOT a property you may assume — MEASURE it per change. Nothing below
// relies on the struck half.
// ⛔ THE MAIL ARM CLEARED A LIVE `deploy-hold` ON A BARE "ack".
// Measured with a single-variable A/B against the shipped script: adding one outbound
// with `signal: ack` and the body "Got it — I will look at it tomorrow. Nothing folded yet"
// flipped a deploy-hold carrying a serious and a moderate finding, with ZERO durable trace, from 🔴 to 🟢 and
// off the ACTION line. Two defects composed: the evidence was a MENTION (`citesToken`, the
// predicate THIS FILE replaced on both durable planes precisely because a mention is not a
// disposition), and the reply was never required to BE a verdict at all.
//
// ⚠️ THE ORDERING IS THIS FILE'S OWN, NOT THE SIBLING'S. `review-request-closure-scan.mjs`
// rejects request-shaped subjects FIRST, then tests subject-or-signal. That is right for its
// units and WRONG here: `REQUEST_MARKERS` contains "fold-verify", so a reject-first pass
// would throw away "FOLD-VERIFY PASS — LOOP CLOSED", which is a disposition. This file
// already measured that exact ambiguity and ruled it — see the note above REQUEST_MARKERS,
// "THE SENDER'S OWN `signal:` OUTRANKS THE KEYWORD MATCH (2026-09-02)". So: signal first.
//
// ⛔ DO NOT REACH FOR `isReviewPlane` — it accepts `--code`, so a REQUEST would answer
// itself. That is the sibling's already-fixed defect.
//
// ⚠️ DELIBERATE COPY, NOT AN EXTRACTION. Rule of Three at N=2, and the two tools have
// different units — per-sha fleet-wide closure vs per-verdict single-session disposition.
// A shared module would couple two fleet instruments so one predicate change breaks both.
const DISPOSITION_SIG = /^(review-verdict|deploy-(?:clear|hold|ok)|fold-report|correction)\b/i;
const REQUEST_SIG = /^(review-request|deploy-review|review-ack|ack|question)\b/i;
const DISPOSITION_SUBJ = /\b(verdict|approved|changes-requested|alternative|fold-verif|loop closed|waived|declin)\b/i;

/** Is this OUTBOUND mail of mine a disposition, rather than an ack, a request, or a mention? */
export function isDispositionMail(o) {
  const sig = ((o && o.signal) || "").trim();
  const subject = (o && o.subject) || "";
  // ⛔ A REQUEST-CLASS SIGNAL MUST NOT HARD-REJECT — MEASURED FALSE RED, 2026-09-03.
  // The first version of this gate returned false on `REQUEST_SIG` before reading the
  // subject. That killed a REAL verdict of mine: subject "VERDICT: content
  // APPROVED as a WITNESS not an endorser", signal `deploy-review`. Signals are only
  // ~71% present on review mail fleet-wide (measured on this store), so a signal is
  // reliable as a POSITIVE and unreliable as a VETO. Reject on the SUBJECT, accept on
  // either — which is the sibling's ordering, arrived at from the opposite direction.
  if (matchesRequestMarker({ subject }, "")) {
    // "fold-verify" is a REQUEST_MARKER, but "FOLD-VERIFY PASS — LOOP CLOSED" is a
    // disposition. The sender's own signal breaks that tie (this file's 2026-09-02 rule).
    if (!DISPOSITION_SIG.test(sig)) return false;
  }
  return DISPOSITION_SUBJ.test(subject) || DISPOSITION_SIG.test(sig);
}

export function answeredState(v, outbound) {
  if (!v || !v.request || !Array.isArray(v.targets) || v.targets.length === 0) return null;
  const replies = outbound.filter((o) => o.to === v.from && (o.created || "") > (v.created || "")
    && isDispositionMail(o));   // an ack is not an answer
  if (replies.length === 0) return null;
  // citesDisposition, not citesToken — the mention/disposition split this commit already
  // applies on both durable planes. It was exported and unused on this plane.
  const cited = v.targets.filter((t) => replies.some((o) => citesDisposition(o.text, t)));
  if (cited.length === 0) return null;
  const at = replies
    .filter((o) => v.targets.some((t) => citesDisposition(o.text, t)))
    .map((o) => o.created || "")
    .sort()[0] || "";
  return { at, cited: cited.length, total: v.targets.length, full: cited.length === v.targets.length };
}

function scan(sid, hours) {
  const verdicts = [];
  if (fs.existsSync(MAIL_DIR)) {
    for (const f of fs.readdirSync(MAIL_DIR)) {
      if (f.endsWith(".tmp")) continue;
      if (!f.startsWith(`${sid}__`)) continue; // addressed to me (broadcasts excluded — a verdict is addressed)
      const p = path.join(MAIL_DIR, f);
      let raw;
      try { raw = fs.readFileSync(p, "utf8"); } catch { continue; }
      const { fm, body } = parseMail(raw);
      if (!isReviewPlane(fm)) continue;
      verdicts.push({
        file: f,
        from: fm.from || "?",
        subject: fm.subject || "(no subject)",
        signal: fm.signal || "",
        created: fm.created || "",
        confirmation: isConfirmation(fm),
        rid: reviewId(fm.subject || ""),
        findings: findingTokens(body),
        request: isReceivedRequest(fm, body),
        body,
      });
    }
  }
  verdicts.sort((a, b) => (a.created || "").localeCompare(b.created || ""));
  for (const v of verdicts) v.trace = dispositionTrace(v.rid);
  // The answered arm: only a REQUEST has a mail-plane disposition to look for, and only an
  // ACTIONABLE one is worth the git resolution — a confirmation never reaches needsAttention.
  const outbound = allOutbound(sid);
  for (const v of verdicts) {
    v.targets = v.request && !v.confirmation ? requestTargets(v.rid, v.body, gitIsCommit, v.subject, v.signal) : [];
    v.answered = answeredState(v, outbound);
  }
  const hubSenders = new Set(verdicts.map((v) => v.from));
  for (const h of hubMarkerSenders()) hubSenders.add(h);
  const pruned = prunedHubAdvisory(sid, hubSenders, hours);
  return { verdicts, pruned };
}

// A verdict NEEDS ATTENTION if it is ACTIONABLE (not a confirmation) AND has no
// disposition trace at all (zero commits + zero todo rows citing its review-id).
// A verdict is DISPOSITIONED BY CONSTRUCTION when the SAME hub later sent a CONFIRMATION
// (FOLD-VERIFY / PASS) carrying the SAME review-id: the hub itself re-verified the fold AT
// SOURCE, which is stronger evidence than any commit-message convention — and, crucially,
// it is convention-INDEPENDENT, so it holds even when the commit plane cannot be matched.
// Added 2026-07-13 after this scan accused a provably CLOSED loop: it raised 🔴 on the
// verdict while printing that verdict's own `<sha> FOLD-VERIFY: PASS — loop
// closed` two lines below it. A verdict scanner that accuses a closed loop teaches exactly
// one behaviour — "🔴 is noise" — which is the cry-wolf death of the net it belongs to.
function hasLaterConfirmation(v, all) {
  if (!v.rid) return false;
  return all.some((o) => o !== v && o.confirmation && o.rid && o.rid === v.rid &&
    o.from === v.from && (o.created || "") > (v.created || ""));
}

// NOTE the gate stays ALIVE: a verdict with no confirmation AND no durable trace still
// ACCUSES. This narrows false accusations; it must never create a silent pass (self-tested).
function needsAttention(v, all = []) {
  if (v.confirmation) return false;
  if (hasLaterConfirmation(v, all)) return false;
  // A request I FULLY served on the mail plane is dispositioned there — see answeredState.
  // PARTIAL coverage deliberately does NOT clear it.
  if (v.answered && v.answered.full) return false;
  return v.trace.commits === 0 && v.trace.todo === 0;
}

// ── SENT-SIDE ARM: a review REQUEST that never came back ───────────────────────
// WHY (the gap the receiver half structurally cannot see). Everything above
// enumerates mail addressed TO this session — `scan()` hard-filters on
// `f.startsWith(sid + "__")`, i.e. the RECEIVER half of a two-sided protocol. The
// SENDER half had no net at all: a `--code` request mailed to a hub that then exits,
// crashes, or simply never reaches it leaves the reviewed work UNREVIEWED while the
// session wraps believing it delegated. That is worse than not delegating, because
// the delegation itself satisfies the "did you get it reviewed?" check.
//
// Measured 2026-08-03: a review hub was holding 16 unread mails including a live
// `--code` request, and that request moved only on a manual ping. The
// diagnosis: it processes from a surface-only listener that never drains the
// queue, so "sent" and "seen" had silently decoupled for ~18h.
//
// TWO SIGNALS, AND THE ASYMMETRY IS THE WHOLE POINT:
//   · a `.read` suffix on MY sent file ⇒ the recipient CONSUMED it. PRESENT
//     certifies; ABSENT PROVES NOTHING — the listener surfaces without marking
//     (measured: a hub read and replied to three mails that all sat unread on disk).
//   · a reply FROM that recipient created AFTER my send ⇒ they engaged. STRONG when
//     it carries the same review-id, WEAK otherwise.
// NEITHER certifies the work was HANDLED. A reviewer flagged that bias against their own
// discriminator — "it measures did-I-REPLY, not did-I-HANDLE" — and produced a false
// positive on exactly the case where they verified something and reported it elsewhere instead
// of replying. So this arm SURFACES, like the rest of Check 13; it never declares a
// loop closed, and `answered-weak` is explicitly not a pass.
const REQUEST_MARKERS = [
  "--code", "review request", "code request", "requesting review", "request review",
  "please review", "builder≠breaker", "builder!=breaker", "claim-or-disclaim",
  "fold-verify", "review queued",
];

// ⛔ THE SENDER'S OWN `signal:` OUTRANKS THE KEYWORD MATCH (2026-09-02).
//
// The marker list cannot separate "FOLD-VERIFY request: <sha>" from "FOLD-VERIFY PASS — LOOP
// CLOSED": both carry `fold-verify`, one asks for work and one reports it, and only the first
// is awaiting a reply. Counting closures as requests is what fed the congestion reopen trigger
// (the REOPEN TRIGGER in report()) 14 firings with no usable congestion sample.
//
// I tried two predicates before this and MEASURED both against a hand-read of 13 real mails:
//   lexical (subject keywords)          11/13 — wrong in BOTH directions
//   structural (a prior inbound on the   9/13 — wrong in ONE direction, because a closure's
//   same review-id precedes my send)            extracted id is MY FOLD's sha, not the
//                                               reviewed sha, so no prior inbound matches
// Neither is fit to gate a fleet-wide instrument. The discriminator already existed in the
// schema: 579 `info`, 97 `fold-verify`, 25 `review-request` across the store, and 81 of 109
// `--code` mails already carry one. On the 13 it separates cleanly — every `review-request` is
// a real request, every `info` is a fold or a correction.
//
// ⚠️ EXCLUSION ONLY, NEVER PROMOTION — IN `isReviewRequest`. A declared non-request signal REMOVES
// a false positive; a missing signal changes nothing and falls through to the markers exactly as
// before, so that residual is a CONVENTION gap (an unset field), not a predicate gap.
// ⛔ "IT CAN NEVER DROP A GENUINE REQUEST" IS REFUTED FOR `info`: two real `--code` requests were
// stamped `info` (2026-10-11), so BOTH sent-side readers call `isSentReviewTraffic`, which
// re-admits `info` on a SUBJECT that names a request. That is the one sanctioned inference — do
// not extend it to another signal or to the body without a hand-read of live sent mail first.
// `deploy-hold` joined 2026-10-12: over the whole live store, 55 mails carry it and every one is a
// verdict-family mail (54 VERDICT / FOLD-VERIFY / CHANGES-REQUESTED subjects, 1 ADDENDUM adding a
// finding to a verdict) — zero requests. Its subjects say "FOLD-VERIFY", a request marker, so before
// this the hub's sent-side list carried its own closures as AWAITING (9 of its 10 rows at the read).
// `review-verdict` joined the same day on the same evidence (frontmatter of the live store): 12 mails,
// all hub VERDICT / FOLD-VERIFIED subjects, zero requests. `fold-verify` stays OUT on purpose: folders
// have stamped their own fold reports with it (the --signal help in session-manifest.py), and such a
// report IS awaiting verification. Both sent-side readers share this predicate, so the zero-delegation
// count moves with it: the hub's read 10 before deploy-hold joined and 1 after (an unsignalled relay).
const NON_REQUEST_SIGNALS = new Set([
  "info", "correction", "ack", "fold-report", "deploy-clear", "deploy-hold", "review-note", "review-ack",
  "review-verdict",
]);

// Literal contains-tests ONLY — no variable-width quantifier before an alternation.
// This file runs at every /wrap, so a backtracking regex here is a fleet-wide hazard
// (the grep-blowup guard exists because one reached 19.78 GB RSS).
function matchesRequestMarker(fm, body) {
  const hay = `${(fm && fm.subject) || ""}\n${(body || "").slice(0, 1500)}`.toLowerCase();
  for (const m of REQUEST_MARKERS) if (hay.includes(m)) return true;
  return false;
}

export function isReviewRequest(fm, body) {
  const sig = ((fm && fm.signal) || "").trim().toLowerCase();
  if (sig && NON_REQUEST_SIGNALS.has(sig)) return false;
  return matchesRequestMarker(fm, body);
}

// ⛔ THE RECEIVE SIDE DROPS THE SIGNAL EXCLUSION, AND THAT IS MEASURED, NOT ASSUMED.
// `NON_REQUEST_SIGNALS` was tuned against THIS seat's own outbound conventions, where the
// sender and the reader are the same session and `signal:` is reliable. Inbound, the sender
// population is every seat in the fleet and the field is measurably NOT reliable for this
// question: live requests reading "--code request <sha> + <sha>", "--code request,
// BATCHED: 8 unreviewed commits" and "--code request (BATCH, 26 shas, backlog)" all
// carry `signal: info`, which `isReviewRequest` excludes by name (the sent side
// re-admits it only on a request SUBJECT, `isSentReviewTraffic`). Using
// it here would make the answered arm silently skip most of the class it exists for.
// The exclusion's own header says it is EXCLUSION-ONLY and can only shrink noise; dropping it
// here can only WIDEN what the answered arm looks at, and every widened item still has to be
// cited by a real outbound of mine before anything turns green.
export function isReceivedRequest(fm, body) {
  return matchesRequestMarker(fm, body);
}

// answered-strong: a reply from that recipient carrying the SAME review-id.
// answered-weak:   any reply from that recipient after the send (engagement, not proof).
//
// ⛔ AN **ACK** CARRIES THE REVIEW-ID, SO IT LANDS IN THE **STRONG** BUCKET AND RENDERS
// `🟢 answered` ON A REVIEW THAT HAS NOT STARTED. The header's weak/strong caveat guards
// the wrong door. Measured twice on 2026-09-04: a `--code request` ACKed at 20:32:25Z
// ("ACKED, queued #2, 4 lenses") reported `🟢 answered … replied in 3.1m`; and a review
// hub reported twice that its own queue was clear while a fold-verify
// sat ~3h, invisible for this exact reason — its ACK named the sha.
//
// ✅ FIXED 2026-09-05 IN `requestState` BELOW — AN ACK-SHAPED REPLY NOW DEMOTES TO
// `answered-weak` (🟡). Read the rest of this block as HISTORY: it explains why the fix was
// refused three times, and why exactly one of those refusals stopped applying.
//
// ⛔ AND READ THE PREVIOUS CLOSURE AS A WARNING. The tracker item for this ack defect was
// closed once on a CONVENTION alone, and that close satisfied the item's own done-when to the
// letter while leaving the defect untouched: rule 2 blesses `ACK <sha> — queued #3`, and the
// predicate keyed on id-presence, so a fleet following the convention PERFECTLY still
// rendered a false 🟢. The
// done-when offered two branches and the close landed on the branch that does not reach the
// defect. **Check a done-when's branches against the DEFECT, not against their own wording.**
//
// ⭐ WHY THE REFUTATIONS NO LONGER BAR IT — a refutation has a SCOPE, and #2's expired.
// Opener-demote was refuted by exactly ONE counter-case: `ACK fold-verify <sha> APPROVED`,
// an opener sharing a subject with a disposition. `mail/SKILL.md` rule 2 now BANS that shape,
// so under the convention it is a violation rather than a legitimate reply, and demoting it
// fails toward 🟡 (safe) instead of silently 🟢 (dangerous) — which is the only thing that
// gives a convention teeth. The convention shipped the precondition for the fix, and the
// sentence that used to sit here forbade the move its own commit had enabled.
//
// THREE FIXES PROPOSED, EACH REFUTED AT THE TIME by the party that did NOT propose it:
//   1. require a verdict token on the strong branch — over 336 sha-bearing replies it
//      fixes 44 false closes and falsely OPENS 68, and that bucket is genuine closures
//      (FOLD-VERIFIED, "ACCEPTED your P3 refutation", a bare "P1 on <sha>").
//      ⚠️ POSTURE, STATED because an earlier revision left it implicit and then reasoned
//      as if the two errors cost the same: this file holds a false-RED to be the SAFE
//      direction and a false-GREEN the dangerous one, so "44 dangerous for 68 safe" is
//      NOT self-evidently a bad trade and calling it "worse than the defect" applied a
//      symmetric-cost reading the file does not hold. It was still declined, on a
//      narrower ground: 68 is an UPPER BOUND with five examples and no hand-read count.
//   2. demote when the subject OPENS with ACK/QUEUED/INTERIM/STARTED/… — 70 demoted /
//      266 kept, 24 hand-read and correct; but 2 of one seat's 4 demotes were FALSE,
//      because it writes `ACK fold-verify <sha> APPROVED …`. **This is the one now
//      SHIPPED, for the scope reason above.**
//   3. the opener rule EXCEPT when the tail carries a disposition token — 21 of 71
//      demoted subjects carry one, and 16 dispose of a DIFFERENT sha than the opener
//      acknowledges, re-introducing the defect the clause was fixing.
//      ⚠️ 70 in #2 against 71 here is the SAME population reported twice with no
//      explanation, and neither figure was re-derived when this was written. Treat the
//      pair as ±1 and do not build an argument on the difference; if one is ever needed
//      exactly, re-derive both rather than picking the one that suits.
// The surviving diagnosis is that THE SUBJECT LINE IS THE WRONG UNIT: a reply routinely
// acknowledges sha A while disposing of sha B, which is efficient for a human and lethal
// for a matcher, and no token-list tuning repairs a unit error. So the fix went to the
// CONVENTION instead — `.claude/skills/mail/SKILL.md` § SUBJECT CONVENTION FOR REVIEW MAIL
// (one review-id per subject; an ACK never shares a subject with a disposition), which is
// cheaper to enforce than to detect — and then the convention made #2 safe, which is how a
// predicate change ended up shipping after all. **#1 and #3 are still measured rather than
// untried: re-propose either only with a NEW measurement, not with an argument.** ⛔ And do
// not read that as barring #2's descendants — the sentence here used to bar all three flatly,
// which forbade the move the convention itself had enabled. The subject line remains the wrong
// UNIT; the demote does not repair that, it only makes the wrong unit fail in the safe
// direction. A real fix is still a per-(reply, sha) parse of each sha's own clause, which is
// design work nobody has done.
// unanswered:      nothing came back — the case this arm exists for.
// The opener set is a MEASURED list — 70 demoted / 266 kept over 336 sha-bearing
// replies, 24 hand-reads correct on both sides. ⛔ DO NOT WIDEN IT CASUALLY. Every word added
// is unmeasured, and a false demote reads a REAL closure as still-open, which sends someone to
// re-review finished work. My own wider probe (adding RE:/RECEIVED/NOTED/TAKING) read 135
// openers where theirs read 106 — a difference of predicate, not of world, and unhand-read.
const ACK_OPENERS = new Set([
  "ACK", "ACKED", "INTERIM", "STARTED", "DISPATCHED", "QUEUED", "PING", "STATUS", "NOTE", "FYI",
]);

// FIRST WORD only, after stripping a leading emoji or punctuation run. A substring test would
// demote "Your feedback on <sha> — CHANGES-REQUESTED" and open the same false reading in the
// other direction; there is a control arm on exactly that.
export function isAckOpener(subject) {
  const m = String(subject || "").replace(/^[^\p{L}]+/u, "").match(/^[A-Za-z]+/);
  return m ? ACK_OPENERS.has(m[0].toUpperCase()) : false;
}

// THE SENDER'S OWN `signal:` OUTRANKS THE SUBJECT WORDING (this file's 2026-09-02 rule, which the
// opener test above never applied). A hub status mail opens with the sha, not an opener word —
// measured 2026-10-14: "<sha>: hold lifted — STARTED now, 2 seats", `signal: review-ack`,
// scored answered-strong, so the sender was told the loop was closed while the review was still
// running and told the owner the session was safe to close.
const ACK_SIGNALS = new Set(["review-ack", "review-update", "ack"]);
// ⛔ BUT A DISPOSITION IN THE LEAD POSITION OUTRANKS THE SIGNAL. Replayed over 2,196 transcript
// requests: the bare signal demote falsely re-opened 2 FOLD-VERIFIED loops ("FOLD-VERIFIED
// … · ACK …", typed review-ack). First word, or the word after a leading sha — the
// position reviewId's first-sha rid points at, never a tail token (mail SKILL's refuted variant).
const DISPOSITION_LEAD = /^(?:[0-9a-f]{7,40}\b[:,]?\s*)?(?:VERDICT|FOLD[- ]VERIFIED|CHANGES-REQUESTED|APPROVED|APPROVE|CLOSED)\b/;
export function isAckReply(m) {
  const sig = String((m && m.signal) || "").trim().toLowerCase();
  const subj = String((m && m.subject) || "").replace(/^[^\p{L}\p{N}]+/u, "");
  return isAckOpener(subj) || (ACK_SIGNALS.has(sig) && !DISPOSITION_LEAD.test(subj));
}

export function requestState(req, inbound) {
  const replies = inbound.filter(
    (m) => m.from === req.to && (m.created || "") > (req.created || ""),
  );
  if (req.rid) {
    const named = replies.filter((m) => m.rid && m.rid === req.rid);
    // ⛔ ID-PRESENCE ALONE WAS THE WHOLE PREDICATE, AND `mail/SKILL.md` RULE 2 EXPLICITLY
    // BLESSES `ACK <sha> — queued #3`, so a fleet following the convention PERFECTLY still
    // produced a false 🟢 on every acknowledgement. The convention was shipped as the closure
    // of the ack-defect tracker item and did not close it; the item was re-opened, then fixed here.
    //
    // WHY THIS IS NOW SAFE WHEN IT WAS MEASURED-REFUTED BEFORE: opener-demote lost on exactly
    // one counter-case, `ACK fold-verify <sha> APPROVED` — an opener sharing a subject with a
    // disposition — which rule 2 now BANS. A refutation has a SCOPE, and that one expired when
    // the convention landed. Under the convention that shape is a violation, so demoting it
    // fails toward 🟡 (safe) rather than silently 🟢 (dangerous), which is the only thing that
    // gives a convention teeth.
    //
    // Per REPLY, not per thread: an ACK followed later by a real verdict is answered-strong.
    //
    // ⚠️ MEASURED ON THE REAL STORE, AND THE FIRST NUMBER WILL MISLEAD YOU. A retrospective
    // scan of this seat's 25 sent requests moved ZERO of them, because every request whose
    // window had opened has SINCE received a real verdict, and the later verdict restores
    // answered-strong. Do not read that 0 as "inert". Replaying each request at the moment
    // only its FIRST rid-bearing reply had arrived: 3 of 20 passed through a false-🟢 window
    // this demote now closes. The defect is a TRANSIENT STATE, which is exactly why it is
    // dangerous — it is true precisely when someone checks early, and invisible to any
    // point-in-time scan run afterwards. A future "it never fires" measurement is almost
    // certainly this artefact; replay the window before concluding anything.
    //
    // ⛔ AND NARROWER STILL, THIRD PASS: THOSE THREE WINDOWS WERE NEVER QUERIED, SO THE 3 IS
    // EXPOSURE AND NOT HARM. A fresh-context review pulled every scan invocation from this
    // seat's transcript and none falls inside any of the three; I re-derived the two anchor
    // facts myself — ZERO invocations on 2026-09-03, earliest at 2026-09-04T16:33:06Z, while
    // the windows sit before that. Nothing invokes the scan from a hook or from
    // `session-manifest.py`, so the transcript is the complete query record.
    // ⛔ **AND THE ONE WINDOW THAT *WAS* QUERIED IS THE FOUNDING INSTANCE, WHICH THIS PREDICATE
    // STILL READS `answered-strong`** (see the block below). So on the HISTORICAL corpus the
    // demote fires on the ACK SHAPE and never on an instance anybody looked at.
    // Say "exposure" here, never "a false green this closed".
    //
    // ✅ **THAT LAST CLAUSE WAS OVERTAKEN THE SAME DAY BY A LIVE TRUE POSITIVE, N=1, QUERIED.**
    // 2026-09-05T01:58:12Z, the hub's own reply to a `--code` request:
    //   subject       "ACK <sha> + <sha> — queued #2 behind a billing panel; 2 lenses…"
    //   isAckOpener   true
    //   requestState  answered-weak   (🟡)      ← this predicate
    //   HEAD's rule   answered-strong (🟢)      ← id-presence alone
    // The review was explicitly QUEUED and unstarted, so 🟡 is correct and 🟢 would have been
    // the exact false close the ack-defect tracker item was filed for. I queried it, so it is experienced rather
    // than replayed. ⚠️ N=1 and it does NOT move the historical 3 (still exposure) or the
    // 0-of-4 fire rate on the `mail-send` warn — which stayed correctly SILENT on that same
    // subject, a rule-2-compliant pure ack. Different corpora, different mechanisms.
    //
    // ⛔ BUT READ THAT 3 NARROWLY — IT IS WINDOWS THAT EXISTED, NOT FALSE GREENS ANYONE
    // EXPERIENCED, and the first version of this comment let those read as the same number.
    // The replay establishes only what the predicate WOULD have returned at that moment; it
    // does not establish that anyone asked. A window nobody queried is not a false green
    // anybody saw.
    //
    // ⛔ AND THE OBSERVED INSTANCE IS NOT COVERED BY THIS FIX EITHER — verified by me against
    // the real stored subject, with both controls behaving, after review found it:
    //
    //   false  "DISCLAIM … — … + <sha> ACKED, …"   THE FOUNDING INSTANCE
    //   true   "ACK <sha> — queued #3"             control, must be true
    //   false  "VERDICT <sha> — APPROVED …"        control, must be false
    //
    // The acknowledgement that produced the false 🟢 rode MID-SUBJECT behind a first word of
    // `DISCLAIM`, so a first-word rule cannot see it. It was genuinely experienced — request
    // 20:29:21Z, that subject 20:32:25Z, my ping at 20:37:43Z saying the ack had made the scan
    // read green, real verdict 21:06:15Z — so it is a real case and this predicate misses it.
    //
    // ⭐ **THEREFORE THIS DEMOTE RESTS ON THE STRUCTURAL ARGUMENT ALONE: id-presence cannot
    // distinguish an acknowledgement from a verdict.** That argument is untouched by any of
    // this and is sufficient. What is NOT true — and was written here twice before being
    // checked — is that a specific observed instance stands behind it. It does not.
    //
    // ⛔ DO NOT "FIX" THIS BY ADDING `DISCLAIM` TO THE OPENER SET. That is exactly the
    // unmeasured widening the warning above forbids, minted from one case, and it does not
    // generalise: the next such subject opens with a different word. The first-word rule is
    // right and THIS IS ITS COST — an ack riding mid-subject behind an unrelated opener. A
    // substring test would buy this case and demote genuine verdicts whose tail happens to
    // contain an opener word, which is the dangerous direction. The real repair is upstream,
    // in the convention: that subject is a rule-1 violation (two subjects in one), and neither
    // this predicate nor the `mail-send` warn catches it, because `DISCLAIM` is not an opener.
    if (named.some((m) => !isAckReply(m))) return "answered-strong";
    if (named.length) return "answered-weak";
  }
  if (replies.length > 0) return "answered-weak";
  return "unanswered";
}

// Minutes from a request to the FIRST reply from that recipient; null if unanswered.
// Separate function rather than widening requestState's return, whose string contract the
// self-test pins — adding a field there would silently loosen three tested assertions.
//
// WHY LATENCY AT ALL (the congestion deferral's instrument half, 2026-08-03). Two independent
// measurements put review latency at a ~3m median with 16/16 answered inside 7 minutes, which
// is why the queue-backpressure and silence-ladder questions were stood DOWN rather than
// built. The conclusion's own author named its limit: both distributions come from ONE hub
// over TWO days of unusually high fleet activity, so they establish the engine held UNDER
// THOSE CONDITIONS — retiring the congestion questions on them is a survivorship argument.
// The agreed disposition is DEFERRED-WITH-TRIGGER, and a trigger a human has to notice is a
// decorated never. This makes it machine-readable: the number surfaces every wrap, and the
// two conditions that would reopen the congestion questions (a latency past the threshold, or two requests in
// flight at once) print themselves.
export const REVIEW_LATENCY_REOPEN_MIN = 30;

// ⛔ PAIR ON THE REVIEW-ID, NOT ON RECIPIENT + TIME ORDER (2026-09-02).
//
// This paired a request with the FIRST inbound from that recipient after it, ignoring `rid`
// entirely — while `requestState` DIRECTLY ABOVE already distinguishes answered-strong (a reply
// carrying the SAME review-id) from answered-weak (any reply). Two functions side by side
// disagreed about what counts as a reply, and this one threw the distinction away.
//
// Consequence, measured on the trigger's own firings:
// in any busy two-way correspondence ANY message back reset the clock, so the instrument was
// wrong in BOTH directions —
//   OVER-fires: a fold-verify closure scored "replied in 500.9m" where the paired
//               mail was an unrelated later message. A phantom, and it reached a reopen trigger.
//   UNDER-reports: a request for one sha scored 12.9m against a verdict on a DIFFERENT sha;
//               the first reply actually naming it came at 29m. A hub that acks fast and
//               verdicts slowly was invisible.
//
// ⚠️ THE RULE IS "EXCLUDE A DIFFERENT REVIEW", NOT "REQUIRE A MATCHING ONE" — and the difference
// is not cosmetic. My first version required a matching rid and returned null otherwise, and that
// was CAUGHT: the four arms below model a reply carrying NO rid, which is a real and common
// shape: a bare queue-position note or a "looking at it" line carrying no sha, which is exactly
// the first reply a
// waiting requester cares about. Requiring a match would have silently stopped counting those —
// under-reporting the very latency this trigger exists to see, in the name of fixing it.
// So: a reply with a DIFFERENT rid is demonstrably about another review and is excluded; a reply
// with NO rid still counts, because time-order is then the best evidence available.
//
// ⚠️ THE OTHER BRANCH — A REQUEST WITH NO RID — IS THE SAME DEFECT POINTED THE OTHER WAY, AND IT
// IS FORCED RATHER THAN CHOSEN. `reviewId` reads the first hex token out of the subject, so a
// request whose subject names no sha has NO identifier to pair on, and `: after` accepts every
// later reply from that peer — including one about a different review. Nothing better exists for
// it: there is no key to match. It is also exactly the pre-existing behaviour, so this change
// cannot make that branch worse. Measured 2026-09-02: 0 of 11 on this seat, 9 of 146 fleet-wide
// (6.2%) — small, real, and not zero. Pinned by the "a request with NO rid accepts any reply"
// control below. ⛔ Do NOT "fix" it by inferring an identifier from the body: the request
// classification above (see NON_REQUEST_SIGNALS) has already refuted two invented predicates
// (lexical 11/13, structural 9/13) and the discriminator that
// worked was one the sender declares, not one the reader guesses.
// (Named at fold-verify — it was pinned by a test but its REASON lived only in the
// arm's label, so a future reader hitting the branch would have found no decision.)
export function replyLatencyMin(req, inbound) {
  const after = inbound.filter(
    (m) => m.from === req.to && (m.created || "") > (req.created || ""),
  );
  const pool = req.rid
    ? after.filter((m) => !m.rid || m.rid === req.rid)
    : after;
  const replies = pool
    .map((m) => Date.parse(m.created))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  const start = Date.parse(req.created);
  if (!replies.length || !Number.isFinite(start)) return null;
  return (replies[0] - start) / 60000;
}

// Exported as a read-only measurement seam: without it the ACK demote below cannot be
// A/B-ed against the real store from outside the module, and a /tmp copy of an older
// revision cannot stand in — REPO anchors on import.meta.url, so every other path it
// resolves points at the copy's own directory and the sent-side section returns nothing.
export function allInbound(sid, mailDir = MAIL_DIR) {
  const out = [];
  if (!sid || !fs.existsSync(mailDir)) return out;
  for (const f of fs.readdirSync(mailDir)) {
    if (f.endsWith(".tmp")) continue;
    if (!f.startsWith(`${sid}__`)) continue;
    let raw; try { raw = fs.readFileSync(path.join(mailDir, f), "utf8"); } catch { continue; }
    const { fm } = parseMail(raw);
    // `subject` is threaded through for the ACK demote in requestState — without it every
    // reply looks like a verdict, which is the defect this scan shipped with. A message with
    // NO subject still reads answered-strong (the pre-existing contract, pinned by the arm
    // above that passes none), so the change only ever demotes a RECOGNISED ack shape.
    out.push({ from: fm.from || "?", created: fm.created || "", rid: reviewId(fm.subject || ""),
               subject: fm.subject || "", signal: fm.signal || "" });
  }
  return out;
}

// Both sent-side readers are ONE definition: countSentReviewTraffic is scanSent's length, so
// scanSent's rows and the zero-delegation count are the same set by construction (one walk,
// one broadcast filter, one predicate — isSentReviewTraffic). They used different predicates
// for one commit, and an UNANSWERED `signal: info` request then got neither an AWAITING row
// nor the banner (a review finding on that commit). Measured before unifying, over the live
// store (490 files, 10 senders): the wider predicate admits 4 more sent mails, all genuine
// (three `--code` requests, one fold-verify request), all answered, zero closures or acks admitted.
export function scanSent(sid, mailDir = MAIL_DIR) {
  return allOutbound(sid, mailDir)
    .filter((o) => o.to !== "all") // a broadcast is not a delegated review awaiting a verdict
    .filter((o) => isSentReviewTraffic(o, o.body))
    .map((o) => ({
      file: o.file, to: o.to, subject: o.subject || "(no subject)", created: o.created,
      rid: reviewId(o.subject), pickedUp: o.pickedUp,
    }))
    .sort((a, b) => (a.created || "").localeCompare(b.created || ""));
}

// ⛔ BOTH SENT-SIDE READERS RELAX THE SIGNAL EXCLUSION FOR ONE CASE — `signal: info` on a subject
// that names a request (`isSentReviewTraffic` below; NOT the receive side's full drop, which
// counted ACKs and verdicts). A `--code request` stamped `signal: info` is a request: measured
// twice on 2026-10-11, in two sessions — each sent a real request with `signal: info`, the hub
// answered it ACK → VERDICT → FOLD-VERIFIED, and the arm still printed "sent ZERO review requests
// all session". Since scanSent reads the same predicate, such a request that goes UNANSWERED is
// an AWAITING row, the alarm the sent-side arm exists for.
export function countSentReviewTraffic(sid, mailDir = MAIL_DIR) {
  return scanSent(sid, mailDir).length;
}

// ⛔ NOT `isReceivedRequest`: a marker anywhere in the first 1,500 body chars, under ANY signal,
// counts a reviewer's ACK or VERDICT, a fold note and a coordination mail that merely mentions
// `--code`, each of which silenced a true zero-delegation (a review finding on the unifying commit).
// It is also a receive-side predicate that may be tightened for receive-side reasons, and this
// sent-side count must not move with it (the same review).
// Widen ONLY `signal: info`, the one signal both founding requests carried, and only on a
// SUBJECT that names a request and is not an ack/reply/verdict.
const SENT_REQUEST_PHRASES = ["code request", "review request", "requesting review", "request review", "please review", "fold-verify request"];
export function isSentReviewTraffic(fm, body) {
  if (isReviewRequest(fm, body)) return true;
  if (((fm && fm.signal) || "").trim().toLowerCase() !== "info") return false;
  const subj = String((fm && fm.subject) || "");
  if (isAckOpener(subj) || /^\s*re:/i.test(subj) || /\b(?:VERDICT|CHANGES-REQUESTED|FOLD-VERIFIED)\b/i.test(subj)) return false;
  const s = subj.toLowerCase();
  return SENT_REQUEST_PHRASES.some((m) => s.includes(m));
}


// ── ZERO-DELEGATION arm (2026-08-12) ───────────────────────────────────────────
// THE HOLE THIS CLOSES: every arm above measures the disposition of reviews that
// EXIST. A session that commits reviewable work and delegates NOTHING read
// "Clean." — zero is the one number a disposition-shaped net cannot see. Measured
// 2026-08-12: a session shipped 9 commits (incl. a 178-site edit to the
// payment-provider-verified legal pages) with ZERO sent review requests while a review-hub
// claim stood, and this scan printed Clean at every /wrap. behavioral-anti-patterns
// #9 was loaded the whole time; possession != application, so the gate is
// COMPUTED here rather than remembered there.
//
// Commit attribution = the creation-record FLOOR (the /summary instrument):
// git's own confirmation line in this session's transcript, intersected with the
// unpushed rev-list. One-directional by design — absence proves nothing, so the
// arm can only UNDER-fire on attribution. Accepted-FP (documented, warn-posture):
// a transcript QUOTING a real unpushed sha's confirmation line counts toward the
// floor; cost = one warn line the orchestrator dispositions per commit.
const ZERO_DELEGATION_COMMIT_FLOOR = 3;
const TRANSCRIPT_SKIP_BYTES = 256 * 1024 * 1024; // past this the floor reads UNKNOWN and the arm stays silent

export function readHubClaim(stateDir = path.join(REPO, ".claude", "state")) {
  try {
    const raw = fs.readFileSync(path.join(stateDir, "fleet-claim-review-hub"), "utf8");
    const m = raw.match(/^session:\s*(\S+)/m);
    return m ? { session: m[1] } : null;
  } catch { return null; }
}

export function creationRecordFloor(sid, { projectsDir, unpushed } = {}) {
  if (!sid) return { floor: 0, skipped: "no sid" };
  const dir = projectsDir ?? path.join(os.homedir(), ".claude", "projects", process.cwd().replace(/[\/.]/g, "-"));
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.startsWith(sid) && f.endsWith(".jsonl")); } catch { return { floor: 0, skipped: "no projects dir" }; }
  if (files.length === 0) return { floor: 0, skipped: "no transcript" };
  let up = unpushed;
  if (!up) {
    // unpushed = vs the SHARED BASELINE (origin/dev once it exists, origin/main before the
    // cutover); resolved, never assumed.
    const base = sh("git rev-parse --verify --quiet origin/dev^{commit}") ? "origin/dev" : "origin/main";
    const out = sh(`git rev-list ${base}..HEAD`);
    if (!out) return { floor: 0, skipped: "git unavailable / nothing unpushed" };
    up = out.trim().split("\n").filter(Boolean);
  }
  // The confirmation-line shape is COMPOSED, never written literally, so this
  // script's own source cannot contaminate a transcript grep (the /summary
  // use-vs-mention rule, applied to the instrument's own body).
  // Same branch set as /summary's extractor: sessions commit on `dev` (main-only read 0 there).
  const CONF = new RegExp("\\[(?:ma" + "in|d" + "ev|hotfix/[^\\] ]+|detached HE" + "AD)(?: \\([^)]*\\))? ([0-9a-f]{7,40})\\]");
  const CHANGED = new RegExp("files? cha" + "nged");
  const hit = new Set();
  for (const f of files) {
    let stat; try { stat = fs.statSync(path.join(dir, f)); } catch { continue; }
    if (stat.size > TRANSCRIPT_SKIP_BYTES) return { floor: 0, skipped: `transcript ${stat.size}B over cap` };
    let raw; try { raw = fs.readFileSync(path.join(dir, f), "utf8"); } catch { continue; }
    for (const line of raw.split("\n")) {
      if (!CHANGED.test(line)) continue;
      const m = CONF.exec(line);
      if (!m) continue;
      const full = up.find((u) => u.startsWith(m[1]));
      if (full) hit.add(full);
    }
  }
  return { floor: hit.size };
}

export function zeroDelegationCheck({ sid, sentCount, mailDir = MAIL_DIR, projectsDir, unpushed, stateDir } = {}) {
  // sentCount is a TEST override only; report() passes none, so the arm reads the widened count.
  const sent = sentCount ?? countSentReviewTraffic(sid, mailDir);
  if (sent > 0) return { fires: false, reason: "delegated", sent };
  const fr = creationRecordFloor(sid, { projectsDir, unpushed });
  if (fr.skipped) return { fires: false, reason: fr.skipped, floor: 0, sent };
  if (fr.floor < ZERO_DELEGATION_COMMIT_FLOOR) return { fires: false, reason: "under floor", floor: fr.floor, sent };
  return { fires: true, floor: fr.floor, hub: readHubClaim(stateDir), sent };
}

function report(sid, hours) {
  const { verdicts, pruned } = scan(sid, hours);
  const sent = scanSent(sid);
  const inbound = allInbound(sid);
  const sentStates = sent.map((r) => ({
    ...r, state: requestState(r, inbound), latency: replyLatencyMin(r, inbound),
  }));
  const awaiting = sentStates.filter((r) => r.state === "unanswered");
  const slow = sentStates.filter((r) => r.latency !== null && r.latency > REVIEW_LATENCY_REOPEN_MIN);
  // The clean-pass must clear BOTH directions. Before the sent-side arm existed this
  // returned 0 while a delegated review sat unanswered — the exact silence it now breaks.
  // `slow` joins the guard for the same reason `awaiting` did: a reopen trigger printed after
  // an early return is a trigger that never fires.
  const zd = zeroDelegationCheck({ sid });
  if (verdicts.length === 0 && pruned.count === 0 && awaiting.length === 0 && slow.length === 0 && !zd.fires) {
    // State the SCANNED COUNT, not just the verdict. A bare "clean" is indistinguishable
    // from an arm that enumerated nothing — the vacuous-control shape this repo keeps
    // measuring. "0 of 0 sent" and "0 of 7 sent" are the same word and very different facts.
    console.log(`Check 13 (review-verdict disposition) — no review-plane mail addressed to \`${sid || "?"}\` survives; ${zd.sent} review mail(s) sent by it, ${sentStates.length} of them tracked as open requests, 0 awaiting a reply. Clean.`);
    if (!sid) console.log("  (note: CLAUDE_CODE_SESSION_ID unset — pass --sid <sid8> to scope; nothing enumerated.)");
    return 0;
  }
  const attn = verdicts.filter((v) => needsAttention(v, verdicts));
  console.log(`## Check 13 — review-verdict disposition sweep (session \`${sid}\`)\n`);
  console.log(`${verdicts.length} review-plane verdict(s) addressed to this session; ${attn.length} with NO disposition trace.\n`);
  for (const v of verdicts) {
    const answeredFull = Boolean(v.answered && v.answered.full);
    const flag = v.confirmation ? "🟢 CONFIRM"
      : answeredFull ? "🟢 ANSWERED"
        : needsAttention(v, verdicts) ? "🔴 DISPOSITION?" : "🟡 traced";
    console.log(`${flag}  [${v.signal || "—"}]  ${v.subject.slice(0, 84)}`);
    console.log(`   from=${v.from} · review-id=${v.rid || "(none — either no id-shaped token in the subject, OR one git could not resolve; the trace cannot run either way, so this surfaces)"} · ${v.created.slice(0, 19)}`);
    if (v.findings.length) console.log(`   finding tokens: ${v.findings.join(", ")}`);
    if (!v.confirmation) {
      if (v.answered) {
        const shape = v.answered.total === 1 ? "the review-id" : `${v.answered.cited}/${v.answered.total} sha(s) named in the request`;
        console.log(`   answered: my outbound to ${v.from} at ${v.answered.at.slice(0, 19)} cites ${shape}` +
          (v.answered.full ? " — a reply is engagement, NOT proof the work was handled." : " — PARTIAL; the rest carry no reply of mine, so this stays 🔴."));
      } else if (v.request && v.targets.length > 0) {
        console.log(`   answered: NO outbound of mine to ${v.from} cites ${v.targets.length === 1 ? "this review-id" : `any of the ${v.targets.length} sha(s) its body names`} — the request may be UNSERVED.`);
      }
      console.log(`   trace: ${v.trace.commits} recent commit(s) + ${v.trace.todo} todo.txt row(s) DISPOSITION "${v.rid}" (a bare mention no longer counts)`);
      if (needsAttention(v, verdicts)) {
        console.log(`   → CITE a disposition per finding (folded <sha> / todo.txt row / named-reject) — nothing on the durable plane yet.`);
        // ⛔ THE MECHANISM THIS HINT ORIGINALLY NAMED WAS FALSE, AND ITS OWN CITED INSTANCE
        // REFUTED IT (2026-08-12). It read: "the trace-grep keys on the
        // REVIEWED sha, but a fold commit cites the FIX." Measured on exactly the reviewed-sha →
        // fold pair it cited: BOTH folds DO cite the reviewed sha — in the BODY
        // (subject 0 / body 1 for each). The RED came from an
        // instrument-internal PLANE MISMATCH — `--grep` reads the full message, `--oneline`
        // prints only the subject — now fixed in dispositionTrace. A convention was blamed for
        // a bug in the reader, and the hint taught that wrong convention to every future reader.
        //
        // The residual below is the NARROW true case that survives the fix: a fold that cites
        // only the FIX sha and never the reviewed one. Gated on a sha-shaped rid because that
        // is the only shape it can apply to — the old hint printed on every RED while only
        // 2 of 12 live verdicts had sha rids, so ~10 of 12 got advice that could not apply.
        if (/^[0-9a-f]{6,}$/i.test(v.rid || "")) {
          console.log(`     ⚠️ sha-shaped review-id: if the fold commit named only the FIX sha and never`);
          console.log(`        ${v.rid}, this reads RED while closed. Check for a later fold-verify mail from ${v.from}.`);
        }
      }
    }
    console.log("");
  }
  if (pruned.count > 0) {
    console.log(`⚠ ${pruned.count} earlier hub mail(s) from ${pruned.senders.map((s) => "`" + s + "`").join(", ")} were received this window but are PRUNED off disk`);
    console.log(`  (events-log has no signal/subject — if any were verdicts, disposition from the transcript/memory). The TTL bump shrinks this next time.\n`);
  }
  if (sentStates.length > 0) {
    console.log(`\n### Sent-side — review requests THIS session delegated (${sentStates.length})\n`);
    for (const r of sentStates) {
      const flag = r.state === "unanswered" ? "🔴 AWAITING"
        : r.state === "answered-strong" ? "🟢 answered" : "🟡 engaged";
      console.log(`${flag}  → ${r.to}  ${r.subject.slice(0, 72)}`);
      const lat = r.latency === null ? "no reply yet" : `replied in ${r.latency.toFixed(1)}m`;
      console.log(`   sent=${r.created.slice(0, 19)} · review-id=${r.rid || "—"} · ${lat} · recipient ${r.pickedUp ? "CONSUMED it (.read)" : "has not marked it read"}`);
      if (r.state === "unanswered") {
        console.log(`   → no reply from \`${r.to}\` after this send. The work you delegated may be UNREVIEWED.`);
        console.log(`     Check the recipient is alive (\`session-manifest.py who\`); if it exited, the review is stranded and is YOURS to run or re-delegate.`);
      } else if (r.state === "answered-weak") {
        console.log(`   → a reply came back but carries no matching review-id — engagement, NOT proof the request was handled.`);
      }
      console.log("");
    }
    console.log(`⚠ "has not marked it read" PROVES NOTHING — a peer working from the surface-only listener reads without marking. Only the .read PRESENCE certifies pickup.`);
  }
  // ⛔ EACH ACTION LINE NAMES THE ARM IT COUNTED, AND THE RECEIVED ARM RE-PRINTS ITS REDS.
  // The word "above" was FALSE for the received arm: the sent-side block renders BETWEEN the
  // verdict rows and this footer, so the rows directly above the line belong to the OTHER arm
  // — and on the measured run (2026-09-14) that arm was 9 🟢 / 2 🟡 / ZERO 🔴 while the footer
  // announced one red. The operator re-ran the script and paged to the head to find it. A
  // positional word cannot carry an arm reference once a second arm can render between them;
  // the arm is named instead, and the reds are restated here so no paging is needed at all.
  const resolverOk = gitResolverControl();
  if (attn.length > 0) {
    const partial = attn.filter((v) => v.answered && !v.answered.full).length;
    const untraceable = attn.filter((v) => !v.rid).length;
    console.log(`ACTION: ${attn.length} RECEIVED verdict(s) marked 🔴 have no durable disposition — disposition each before close.`);
    console.log(`  (counted in the "Check 13 — review-verdict disposition sweep" block at the TOP of this report, NOT the sent-side list directly above this line.)`);
    for (const v of attn) {
      console.log(`   🔴 ${v.rid || "(no review-id)"} · from=${v.from} · ${v.created.slice(0, 19)} · ${v.subject.slice(0, 72)}`);
    }
    if (partial > 0) {
      console.log(`  (${partial} of those ARE answered in part — the printed "N of M" is which shas your outbound named; the rest carry no reply of yours.)`);
    }
    if (untraceable > 0) {
      // Measured 2026-09-14: the one red on that run carried NO sha in its subject, so the
      // trace predicate could not run at all — and the disposition existed (folded twelve
      // minutes after the verdict) and was visible in the SENT arm. An untraceable red is the
      // instrument declining to answer, never a finding that nothing was done.
      // ⛔ BUT THE CAUSE SET IS THREE, NOT ONE, AND THIS SENTENCE NAMED ONE.
      // `gitIsCommit` folds "not a commit", "ambiguous prefix" and "git
      // unavailable" into one FALSE, so under a git outage every sha-shaped id fails at once
      // and this note would exculpate the whole wall. The control decides which sentence the
      // reader gets; do not re-merge them.
      if (resolverOk) {
        console.log(`  ⚠️ ${untraceable} of those carry no id-shaped token in the subject, OR one git could not resolve — either way the trace could not RUN, which is the instrument declining to answer rather than evidence of no disposition. Clear each against the sent-side arm and the commit log before counting it undispositioned.`);
      } else {
        console.log(`  ⛔ ${untraceable} of those are untraceable AND THE RESOLVER CONTROL FAILED ABOVE — do NOT read them as "the instrument declined to answer". The ids are most likely present and git could not check them, so this count is an artifact of a broken resolver, not a finding about dispositions.`);
      }
    }
  }
  if (awaiting.length > 0) {
    console.log(`ACTION: ${awaiting.length} DELEGATED review(s) marked 🔴 have no reply — confirm the reviewer is alive, or take the review back, before close.`);
    console.log(`  (counted in the "Sent-side — review requests THIS session delegated" block above.)`);
  }
  // The congestion reopen trigger, made machine-readable so it does not depend on anyone
  // remembering it. Congestion questions (hub backpressure, requester silence-ladder) were
  // stood DOWN on a ~3m median measured over ONE hub across TWO days — evidence from a window
  // that happened to have no congestion. Either condition below means that window no longer
  // describes reality and the deferral is due for re-opening.
  // "Two in flight AT ONCE" means two SIMULTANEOUSLY UNANSWERED, not two sent across the
  // window. The first draft used sentStates.length >= 2 and would have fired on essentially
  // every wrap — a trigger that always fires teaches "this is noise", which is how the real
  // one gets ignored. Keyed on `awaiting` instead, which is by construction concurrent.
  if (slow.length > 0 || awaiting.length >= 2) {
    if (slow.length > 0) {
      console.log(`\n⚠ REOPEN TRIGGER: ${slow.length} request(s) exceeded ${REVIEW_LATENCY_REOPEN_MIN}m to first reply (slowest ${Math.max(...slow.map((r) => r.latency)).toFixed(0)}m).`);
    }
    if (awaiting.length >= 2) {
      console.log(`⚠ REOPEN TRIGGER: ${awaiting.length} review requests unanswered CONCURRENTLY (the "two in flight at once" condition).`);
    }
    console.log(`  → the deferred congestion questions: the stand-down rested on a no-congestion sample; re-open it.`);
    // ⛔ DIRECTION, PRINTED — not left for the reader to re-derive. Every arm above filters
    // `sentStates`, so this trigger is SENT-SIDE BY CONSTRUCTION and structurally blind to a
    // delay on the RECEIVE side. Prior entries hand-derived that and several published a
    // count before doing so; printing it removes the step where the mistake happens.
    //
    // ⛔ WHAT IS *NOT* A MEASUREMENT IS AN ITEM KIND, NOT A DIRECTION — corrected 2026-09-02.
    // This comment read "14 firings, 0 usable congestion samples,
    // because a sent-side closure or fold-verify needs no reply", and that premise had been
    // STRUCK 57 minutes before this file was committed, by an ancestor of this
    // very commit (11:44 -> 12:41, merge-base confirms the ancestry).
    // The 15th firing WAS a usable sample: a sha-keyed request this seat SENT, 116.8m to
    // first reply, matching review-id, hub live and saturated. So the sent side is not
    // categorically noise. A closure, a fold-verify PASS or an ack is what carries no
    // measurement (a fold-verify REQUEST is a request, and isSentReviewTraffic admits one),
    // and that is a property of the ITEM, not of the direction it travelled.
    //
    // This is the null-run-hardening shape: an unbroken run of empty firings hardens
    // into written evidence ABOUT the instrument, and that sentence then pre-disqualifies the
    // first real sample. Here it was worse than the codified case — the real sample had
    // already arrived and this seat had already struck the premise, and it still got compiled
    // into source an hour later. Re-read a tracker row to its END by RANGE before quoting an
    // accumulated count from it; closures are APPENDED.
    console.log(`  ⚠ DIRECTION: SENT-side only (every arm filters sentStates). A closure, a fold-verify PASS or an ack carries no measurement (a fold-verify REQUEST is a request) — classify each item before it counts as congestion; a request that got a slow reply DOES count. A RECEIVE-side delay cannot appear here at all, and nothing else covers it: review-request-closure-scan.mjs catches received-and-never-answered but computes no latency, so received-and-SLOWLY-answered is measured by nothing in the fleet.`);
  }
  if (zd.fires) {
    console.log(`\n\u26d4 ZERO-DELEGATION: >=${zd.floor} unpushed commit(s) carry this session's creation records while it sent ZERO review requests all session.`);
    console.log(zd.hub
      ? `   A review-hub claim stands (${zd.hub.session}) — behavioral-anti-patterns #9: delegate now (mail-send the shas), or name PER COMMIT why review is not owed.`
      : `   No hub claim found — the #9 carve-out: broadcast for pickup, await an ack, self-run only on real silence.`);
    console.log(`   Zero is the one number a disposition-shaped net cannot otherwise see (a 9-commit session incl. legal pages read Clean here, 2026-08-12).`);
  }
  return 0;
}

// ── self-test (mutation-checked) ───────────────────────────────────────────────
function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rvds-"));
  const mail = path.join(tmp, "session-mail");
  fs.mkdirSync(mail, { recursive: true });
  const SID = "<session-id>";
  const mk = (name, fm, body) => {
    const f = `from: ${fm.from}\nto: ${SID}\nsubject: ${fm.subject}\n${fm.signal ? `signal: ${fm.signal}\n` : ""}created: ${fm.created}`;
    fs.writeFileSync(path.join(mail, name), `---\n${f}\n---\n\n${body}\n`);
  };
  // 1. ACTIONABLE deploy-hold verdict with findings — must be flagged.
  mk(`${SID}__100__hub9999.md.read`,
    { from: "hub9999", subject: "S99 VERDICT: CHANGES-REQUESTED · deploy-hold", signal: "deploy-hold", created: "2026-07-10T01:00:00Z" },
    "F-A P1 logic defect; F-B P2 copy. un-folded → todo.txt with triggers.");
  // 2. CONFIRMATION fold-verify PASS — must be 🟢, never flagged.
  mk(`${SID}__200__hub9999.md.read`,
    { from: "hub9999", subject: "S99 fold-verify PASS: abc1234 all folded — DEPLOY-CLEAR", signal: "deploy-clear", created: "2026-07-10T02:00:00Z" },
    "All folded findings verified at hunk level.");
  // 3. Non-review mail — must be EXCLUDED entirely.
  mk(`${SID}__300__peer5555.md`,
    { from: "peer5555", subject: "heads up: I claimed #18", signal: "", created: "2026-07-10T03:00:00Z" },
    "Just a status ping, no verdict here.");
  // 4. Bare `--code` subject, NO signal — the non-hub-reviewer fallback. Must be
  //    review-plane (the old `\b--code\b` could never match, silently dropping it).
  mk(`${SID}__400__peer7777.md.read`,
    { from: "peer7777", subject: "S30 --code review of a1b2c3d", signal: "", created: "2026-07-10T04:00:00Z" },
    "Looks good, one nit.");
  // 5. APPROVED · deploy-clear WITHOUT recommended folds — a pure confirmation.
  mk(`${SID}__500__hub9999.md.read`,
    { from: "hub9999", subject: "S98 VERDICT: APPROVED · DEPLOY-CLEAR — zero P0/P1", signal: "deploy-clear", created: "2026-07-10T05:00:00Z" },
    "Clean across all lenses. Nothing to fold.");
  // 6. APPROVED · deploy-clear WITH recommended folds — must stay ACTIONABLE (refined:
  //    the recommended-folds class — classing it a confirmation would reintroduce the strand).
  mk(`${SID}__600__hub9999.md.read`,
    { from: "hub9999", subject: "S97 VERDICT: APPROVED · DEPLOY-CLEAR — 6/6 lenses; recommends F-A/F-C folds", signal: "deploy-clear", created: "2026-07-10T06:00:00Z" },
    "Approved. Recommended folds: F-A payout precision, F-C rationale — fold before push.");
  // 7. LIVE-VOCABULARY fold-verify. Fixtures 1-6 above all speak the
  //    scanner's OWN 2026-07 dialect — fixture 2's subject literally contains the token
  //    "fold-verify", so it exercises the SUBJECT path and can never witness the SIGNAL
  //    path. This subject is a REAL hub fold-verify, copied verbatim from measured
  //    traffic, and it matches NOTHING in the subject regex (no VERDICT, no fold-verify,
  //    no DEPLOY-*, no --code) — so the ONLY thing that can classify it is the typed
  //    signal. That is what makes it a positive control for REVIEW_PLANE_SIGNALS rather
  //    than a restatement of fixture 2.
  mk(`${SID}__700__hub9999.md.read`,
    { from: "hub9999", subject: "LOOP CLOSED <commit-id-1> + <commit-id-2> — claim 4 VERIFIED at source", signal: "fold-verify", created: "2026-07-10T07:00:00Z" },
    "Re-derived all four values independently. Nothing to fold.");

  // Assertions run against the PURE helpers (parse/classify/extract) — no disk-
  // coupling, so the self-test can't flake on MAIL_DIR being a module const.
  const raw1 = fs.readFileSync(path.join(mail, `${SID}__100__hub9999.md.read`), "utf8");
  const { fm: fm1, body: b1 } = parseMail(raw1);
  const raw2 = fs.readFileSync(path.join(mail, `${SID}__200__hub9999.md.read`), "utf8");
  const { fm: fm2 } = parseMail(raw2);
  const raw3 = fs.readFileSync(path.join(mail, `${SID}__300__peer5555.md`), "utf8");
  const { fm: fm3 } = parseMail(raw3);
  const { fm: fm4 } = parseMail(fs.readFileSync(path.join(mail, `${SID}__400__peer7777.md.read`), "utf8"));
  const { fm: fm5 } = parseMail(fs.readFileSync(path.join(mail, `${SID}__500__hub9999.md.read`), "utf8"));
  const { fm: fm6 } = parseMail(fs.readFileSync(path.join(mail, `${SID}__600__hub9999.md.read`), "utf8"));
  const { fm: fm7 } = parseMail(fs.readFileSync(path.join(mail, `${SID}__700__hub9999.md.read`), "utf8"));

  const checks = [];
  const assert = (name, cond) => checks.push({ name, ok: !!cond });

  // ── REOPEN-ARM DIRECTION FENCE ────────────────────────
  // The trigger prints "every arm filters sentStates" as a claim a maintainer trusts
  // INSTEAD of re-deriving it. Nothing tested that, so a third arm reading `inbound`
  // would silently make the printed sentence false — the shipped-line-is-right,
  // claim-beside-it-is-wrong shape the same review caught one comment over.
  // This is the drift-sentinel source-read carve-out (tests-unit.md): the assertion
  // TARGET is the source structure, so there is no behavioural surface to call.
  // Region is the ARM BLOCK, not all of report() — report() also filters `verdicts`
  // for an unrelated purpose, and fencing the whole function reds at birth (measured).
  const fenceSrc = fs.readFileSync(new URL(import.meta.url), "utf8");
  const fenceA = fenceSrc.indexOf("const sentStates = sent.map(");
  const fenceB = fenceSrc.indexOf("const zd = zeroDelegationCheck(");
  assert("arm fence: both anchors resolve, in order", fenceA > -1 && fenceB > fenceA);
  const fenceArms = fenceA > -1 && fenceB > fenceA
    ? [...fenceSrc.slice(fenceA, fenceB).matchAll(/(\w+)\.filter\(/g)].map((m) => m[1])
    : [];
  // Positive control: an empty match set would make the next assert vacuously true.
  assert("arm fence: predicate finds arms (not vacuous)", fenceArms.length > 0);
  assert("arm fence: every reopen arm filters sentStates", fenceArms.length > 0 && fenceArms.every((v) => v === "sentStates"));

  assert("frontmatter parses signal", fm1.signal === "deploy-hold");
  assert("review-plane: deploy-hold verdict IS review-plane", isReviewPlane(fm1) === true);
  assert("review-plane: fold-verify PASS IS review-plane", isReviewPlane(fm2) === true);
  assert("review-plane: status ping is NOT review-plane", isReviewPlane(fm3) === false);
  assert("confirmation: fold-verify PASS IS a confirmation", isConfirmation(fm2) === true);
  // ── Measured on 60 live hub mails: 34 failed the plane test ──
  // The assertion PAIR is the point. The first alone would pass even with the fix
  // reverted, because a reader assumes the subject carries it; the second proves the
  // SIGNAL did the work by removing it and demanding the classification collapse.
  assert("LIVE-VOCAB: a real hub fold-verify subject IS review-plane via its typed signal",
    isReviewPlane(fm7) === true);
  assert("LIVE-VOCAB MUTATION: strip the signal and that same subject is NOT review-plane — " +
    "so REVIEW_PLANE_SIGNALS is what classifies it, not the subject regex",
    isReviewPlane({ ...fm7, signal: "" }) === false);
  // Same split for the confirmation half: a subject with NO confirmation vocabulary at
  // all, classified purely by `signal: fold-verify`. Note fm7's own subject says
  // "VERIFIED", so it would pass the subject regex anyway — which is exactly why this
  // arm uses a different subject and fm7 cannot stand in for it.
  assert("LIVE-VOCAB: typed fold-verify signal IS a confirmation with no subject vocabulary",
    isConfirmation({ signal: "fold-verify", subject: "LOOP CLOSED <commit-id-1> + <commit-id-2>" }) === true);
  assert("MUTATION: same subject WITHOUT the signal is NOT a confirmation",
    isConfirmation({ signal: "", subject: "LOOP CLOSED <commit-id-1> + <commit-id-2>" }) === false);
  // The narrow set is deliberate — see the NAMED-REJECT at REVIEW_PLANE_SIGNALS.
  assert("SCOPE: review-ack / review-update stay OFF the plane (engagement, not verdicts)",
    isReviewPlane({ signal: "review-ack", subject: "queued" }) === false &&
    isReviewPlane({ signal: "review-update", subject: "still working" }) === false);
  // ── A prose review-id makes the trace vacuous (measured live on this scan) ──
  // The LIVE subject, verbatim. Before the fix this returned "the".
  assert("LIVE: a prose head token is NOT taken as the review-id",
    reviewId("VERDICT the 5 I dropped: 2 CHANGES-REQUESTED (session-cadence 'first FP' refuted)") !== "the");
  assert("with no id-shaped token anywhere, rid is EMPTY — so the trace cannot run and the " +
    "verdict SURFACES (safe direction) instead of passing on 6357 rows matching 'the'",
    reviewId("VERDICT the 5 I dropped: two changes requested") === "");
  assert("a prose head yields NO rid even when the subject contains other id-shaped " +
    "prose tokens — the rescue scan was deleted, see the comment in reviewId()",
    reviewId("VERDICT the fix for session-cadence — two findings") === "");
  // SHAPE arms pass a stub resolver: these pin the KEYWORD/vacuity paths, and their fixture
  // shas are invented, so the real git authority would (correctly) reject them and the arm
  // would stop measuring what it names. Authority arms below use the REAL resolver.
  const anySha = () => true;
  assert("CONTROL: identifier-shaped rids are untouched by the vacuity filter",
    reviewId("S24 VERDICT: …", anySha) === "S24" &&
    reviewId("QW#10 fold-verify …", anySha) === "QW#10" &&
    reviewId("VERDICT 1a2b3c4d5 — …", anySha) === "1a2b3c4d5" &&
    reviewId("[VERDICT] 5d4c3b2a1 …", anySha) === "5d4c3b2a1");
  assert("CONTROL: an all-lowercase SHA is still a sha, not prose (hex branch wins first)",
    reviewId("VERDICT deadbeef — …", anySha) === "deadbeef");
  assert("RESIDUAL (documented, not fixed): an ALL-CAPS generic token still passes",
    reviewId("FULL VERDICT router-staleness arc: CHANGES-REQUIRED") === "FULL");
  // The full LIVE subject, verbatim — the one that motivated all of this. Four successive
  // rescue-scan designs returned I / VERDICT / CHANGES-REQUESTED / session-cadence for it.
  assert("LIVE (verbatim): the motivating subject yields NO rid, so it SURFACES",
    reviewId("VERDICT the 5 I dropped: 2 CHANGES-REQUESTED (session-cadence 'first FP' refuted by 0/76 clean)") === "");
  // ── SHA-ANYWHERE derivation ──
  // Each arm is a prefix the KEYWORD LIST does not contain — that is the point: the
  // derivation covers spellings nobody has enumerated, including ones not yet invented.
  assert("SHA-ANYWHERE: a non-enumerated prefix still resolves (INTERIM is NOT in the keyword list)",
    reviewId("INTERIM c0ffee123 — conservation clean 7/7", anySha) === "c0ffee123");
  assert("SHA-ANYWHERE: the adopted sha-leading convention resolves",
    reviewId("feedface1 VERDICT — fold verified at source", anySha) === "feedface1");
  assert("SHA-ANYWHERE: a sha buried mid-subject resolves (no leading convention needed)",
    reviewId("LOOP CLOSED on 0ddba11ed — claim 4 verified", anySha) === "0ddba11ed");
  assert("SHA-ANYWHERE multi-sha: takes the FIRST, because co-reviewed commits are one verdict",
    reviewId("1a2b3c4d5 + 5d4c3b2a1 — claim 4 VERIFIED", anySha) === "1a2b3c4d5");
  assert("SHA-ANYWHERE precedence: a sha WINS over a keyword-derived head token",
    reviewId("S24 VERDICT: fold of c0ffee123", anySha) === "c0ffee123");
  assert("SHA-ANYWHERE CONTROL: with no sha present, the keyword path is unchanged",
    reviewId("S24 VERDICT: …", anySha) === "S24" && reviewId("QW#10 fold-verify …", anySha) === "QW#10");

  // ── GIT-AUTHORITY arms — REAL resolver, REAL repo state ──
  // These replace two charset arms I shipped and had to retract. This repo holds a genuine
  // all-digit commit, so the "pure-digit tokens are not shas" arm I wrote was
  // asserting a FALSEHOOD — and it passed, because the predicate under it was equally
  // wrong. An arm and a guard that share a mistaken premise agree with each other forever;
  // only an outside instrument (here `git cat-file`) breaks the tie.
  // The two arms that need that commit are skipped (not failed) where it does not resolve,
  // like the git-backed MENTION twin below.
  const realShaAllDigit = "<all-digit-commit-id>";  // set to an all-digit commit in this repo's history
  const hasAllDigitCommit = /^[0-9]{7,40}$/.test(realShaAllDigit) && gitIsCommit(realShaAllDigit);
  if (hasAllDigitCommit) assert("GIT-AUTHORITY: an ALL-DIGIT token that IS a commit resolves (the arm I got backwards)",
    gitIsCommit(realShaAllDigit) === true &&
    reviewId(`VERDICT the 5 I dropped (refuted by 0/76 clean) ${realShaAllDigit}`) === realShaAllDigit);
  assert("GIT-AUTHORITY: a sha-SHAPED token that is NOT a commit yields no rid (fails SAFE)",
    gitIsCommit("18093200a") === false &&
    reviewId("VERDICT the 5 I dropped 18093200a") === "");
  assert("GIT-AUTHORITY: a hex-spelled English word is rejected without any charset rule",
    gitIsCommit("defaced") === false &&
    reviewId("VERDICT the defaced banner — two findings") === "" &&
    reviewId("STOP effaced copy on /pricing") === "STOP");
  if (hasAllDigitCommit) assert("GIT-AUTHORITY DISCRIMINATION: the SAME shape splits on repo state, not on charset — " +
    "an all-digit commit resolves while an all-digit non-commit does not",
    reviewId(`VERDICT ${realShaAllDigit}`) === realShaAllDigit &&
    reviewId("VERDICT 999999999") === "");
  // Always-on twin of the two arms above: HEAD is a commit in every checkout, so the REAL
  // resolver must answer yes here. Without it, a gitIsCommit that always returns false passes
  // this whole self-test wherever the all-digit commit is absent.
  const headSha = sh("git rev-parse --short=9 HEAD").trim();
  assert("GIT-AUTHORITY: the REAL resolver resolves HEAD, and a commit-sha rid extracts",
    /^[0-9a-f]{9}$/.test(headSha) && gitIsCommit(headSha) === true &&
    reviewId(`VERDICT ${headSha} — fold verified`) === headSha);
  assert("confirmation: CHANGES-REQUESTED is NOT a confirmation", isConfirmation(fm1) === false);
  assert("reviewId: 'S99 VERDICT: …' → S99", reviewId(fm1.subject) === "S99");
  assert("findingTokens: extracts F-A/F-B/P1/P2", (() => {
    const t = findingTokens(b1);
    return t.includes("F-A") && t.includes("F-B") && t.includes("P1") && t.includes("P2");
  })());
  // The bare `--code` subject fallback (was DEAD: \b--code\b can't match after a space).
  assert("review-plane: bare `--code` subject (no signal) IS review-plane", isReviewPlane(fm4) === true);
  assert("MUTATION: the old \\b--code\\b form would NOT match — proves the fix is load-bearing", /\b--code\b/i.test(fm4.subject) === false);
  // Named-reject of the naive fix — APPROVED is NEVER auto-confirmed; it routes
  // through the trace (safe direction). A body/token check to tell clean-APPROVED from
  // APPROVED-with-folds false-🟢s (HIDES a verdict — "Nothing to fold" contains "fold").
  assert("confirmation: clean APPROVED·deploy-clear is NOT auto-confirmed (routes through trace)", isConfirmation(fm5) === false);
  assert("confirmation: APPROVED·deploy-clear WITH recommended folds is NOT confirmed (stays actionable)", isConfirmation(fm6) === false);
  // Token-bounded citation (the git/todo trace core; the exact ACK→BACKLOG false-positive).
  assert("citesToken: 'ACK' does NOT match 'chore(backlog): BACKLOG #59'", citesToken("chore(backlog): BACKLOG #59 dedup", "ACK") === false);
  assert("citesToken: 'S24' matches 'fix(billing): S24 folds'", citesToken("fix(billing): S24 folds", "S24") === true);
  assert("citesToken: 'F5' does NOT match a sha-hex run 'abcf5de fix'", citesToken("abcf5de fix(x): y", "F5") === false);
  assert("MUTATION: raw substring WOULD false-match BACKLOG, bounded does not", "chore: BACKLOG".includes("ACK") === true && citesToken("chore: BACKLOG", "ACK") === false);
  // The fleet-channels discriminator, BOTH arms (a one-sided assertion here would
  // pass on a filter that rejected everything, silently zeroing the Check-13 net).
  assert("a channel-tagged events row IS excluded from the verdict scan",
    isChannelEvent({ event: "read", mail: "all__2__c.md", recipient: SID, sender: "hub9999", channel: "x-ch" }) === true);
  assert("CONTROL: a default-bus events row is NOT excluded (the filter is not blanket)",
    isChannelEvent({ event: "read", mail: `${SID}__1__hub9999.md`, recipient: SID, sender: "hub9999" }) === false);
  assert("an empty/absent channel value does not exclude (falsy is default-bus)",
    isChannelEvent({ event: "read", channel: "" }) === false);
  // needsAttention shape (with a synthetic zero-trace):
  const vActionable = { confirmation: false, trace: { commits: 0, todo: 0 } };
  const vTraced = { confirmation: false, trace: { commits: 2, todo: 0 } };
  const vConfirm = { confirmation: true, trace: { commits: 0, todo: 0 } };
  assert("needsAttention: zero-trace actionable → true", needsAttention(vActionable) === true);
  assert("needsAttention: traced actionable → false", needsAttention(vTraced) === false);
  assert("needsAttention: confirmation → false (never flagged)", needsAttention(vConfirm) === false);
  // MUTATION guard: a broken isReviewPlane that lets the status ping through must fail a test.
  assert("MUTATION: status-ping exclusion is load-bearing", isReviewPlane(fm3) === false && isReviewPlane(fm1) === true);

  // ── SENT-SIDE ARM (must run BEFORE the teardown below — it needs the fixture dir) ──
  const mkSent = (name, to, subject, created, body = "please run a --code review") => {
    fs.writeFileSync(path.join(mail, name),
      `---\nfrom: ${SID}\nto: ${to}\nsubject: ${subject}\ncreated: ${created}\n---\n\n${body}\n`);
  };
  mkSent(`hub7777__900__${SID}.md`, "hub7777", "--code REQUEST deadbeef: the thing", "2026-08-03T10:00:00Z");
  mkSent(`peer5555__901__${SID}.md`, "peer5555", "just an FYI about the tree", "2026-08-03T10:01:00Z", "no ask here");
  mkSent(`all__902__${SID}.md`, "all", "--code broadcast to everyone", "2026-08-03T10:02:00Z");

  const sentFound = scanSent(SID, mail);
  // Asserts only what THIS arm owns — the enumeration. `reviewId` has its own semantics
  // (it splits on `--code`, so a request subject's rid is not the sha) and its own arms
  // above; pinning it here would couple this control to a function it does not test.
  assert("SENT: a --code request I sent IS enumerated",
    sentFound.some((r) => r.to === "hub7777"));
  assert("SENT CONTROL: an ordinary FYI I sent is NOT enumerated (the marker filter is not blanket)",
    sentFound.some((r) => r.to === "peer5555") === false);
  assert("SENT CONTROL: a broadcast to `all` is NOT a delegated review awaiting a verdict",
    sentFound.some((r) => r.to === "all") === false);
  assert("SENT CONTROL: mail addressed TO me is not mistaken for mail I sent",
    sentFound.some((r) => r.to === SID) === false);

  // ZERO-DELEGATION counts a `signal: info` --code request (2026-10-11, two live instances).
  // The fixture is the live frontmatter shape of a real request mail.
  const zdMail = path.join(tmp, "zd-mail");
  fs.mkdirSync(zdMail, { recursive: true });
  fs.writeFileSync(path.join(zdMail, `hub7777__950__${SID}.md.read`),
    `---\nfrom: ${SID}\nto: hub7777\nsubject: architecture.md --code request + refute mandate: <commit-id-1>\nsignal: info\ncreated: 2026-10-11T16:07:29Z\n---\n\nITEMS: 1 commit\n`);
  assert("AWAITING: scanSent now LISTS a `signal: info` --code request",
    scanSent(SID, zdMail).length === 1);
  assert("AWAITING: that request, with no reply from its recipient, reads UNANSWERED — an alarm, not silence",
    (() => { const r = scanSent(SID, zdMail)[0]; return Boolean(r) && requestState(r, []) === "unanswered"; })());
  assert("ZERO-DELEGATION: the same `signal: info` --code request COUNTS as review traffic sent",
    countSentReviewTraffic(SID, zdMail) === 1);
  // THROUGH THE REAL READER (2026-10-14): the signal must survive allInbound, or the
  // isAckReply demote passes its hand-built arms above and does nothing on the live store.
  fs.writeFileSync(path.join(zdMail, `${SID}__952__hub7777.md`),
    `---\nfrom: hub7777\nto: ${SID}\nsubject: <commit-id-1>: hold lifted — STARTED now, 2 seats\nsignal: review-ack\ncreated: 2026-10-11T16:20:00Z\n---\n\nITEMS: 1 status change\n`);
  assert("AWAITING: a hub status mail typed `signal: review-ack`, read through allInbound, is NOT the verdict → answered-weak",
    (() => { const r = scanSent(SID, zdMail)[0]; return Boolean(r) && requestState(r, allInbound(SID, zdMail)) === "answered-weak"; })());
  fs.writeFileSync(path.join(zdMail, `all__951__${SID}.md`),
    `---\nfrom: ${SID}\nto: all\nsubject: --code request to everyone\nsignal: info\ncreated: 2026-10-11T16:08:00Z\n---\n\nx\n`);
  fs.writeFileSync(path.join(zdMail, `peer5555__952__${SID}.md`),
    `---\nfrom: ${SID}\nto: peer5555\nsubject: heads up about the tree\nsignal: info\ncreated: 2026-10-11T16:09:00Z\n---\n\nnothing to do\n`);
  assert("ZERO-DELEGATION CONTROL: a broadcast and a plain FYI do NOT count (still 1, not 3)",
    countSentReviewTraffic(SID, zdMail) === 1);
  // A seat that only ACKs, VERDICTs or mentions `--code` delegated nothing: each must leave the count at 1.
  for (const [i, sig, subj, body] of [
    [943, "ack", "ACK --code request 1234abcde — queued #2", "queued"],
    [944, "review-ack", "ACK 1234abcde: queued pos 2/3", "your --code request is queued"],
    [945, "deploy-clear", "--code VERDICT 1234abcde: APPROVED", "no findings"],
    // A hub closure stamped `deploy-hold`: its subject carries the "fold-verify" request marker.
    [941, "deploy-hold", "FOLD-VERIFY 1234abcde: NOT VERIFIED — two findings stay open", "fold again"],
    [940, "review-verdict", "FOLD-VERIFY 1234abcde: VERIFIED, loop closed", "nothing open"],
    [946, "info", "Re: --code request 1234abcde — thanks, folding now", "no findings"],
    [947, "info", "heads up: shared todo.txt edits", "no --code request needed for these tracker rows"],
    [948, "info", "ACK --code request 1234abcde — queued #3", "queued"],
    [949, "info", "your --code request 1234abcde: VERDICT APPROVED", "no findings"],
    // Only `info` widens: a non-request signal on a request-phrased subject stays out (pins the signal gate).
    [942, "correction", "correction to my --code request 1234abcde: wrong sha", "x"],
  ]) fs.writeFileSync(path.join(zdMail, `peer5555__${i}__${SID}.md`),
    `---\nfrom: ${SID}\nto: peer5555\nsubject: ${subj}\nsignal: ${sig}\ncreated: 2026-10-11T16:10:00Z\n---\n\n${body}\n`);
  assert("ZERO-DELEGATION CONTROL: ACKs, VERDICTs, a Re: reply, a `correction`, a `deploy-hold` and a `review-verdict` closure and a body-only `--code` mention do NOT count (still 1, not 11)",
    countSentReviewTraffic(SID, zdMail) === 1);
  assert("ZERO-DELEGATION CONTROL: none of those ACKs or VERDICTs joins the awaiting list (still only the 950 request)",
    scanSent(SID, zdMail).map((r) => r.file).join() === `hub7777__950__${SID}.md.read`);
  fs.writeFileSync(path.join(zdMail, `${SID}__953__hub7777.md`),
    `---\nfrom: hub7777\nto: ${SID}\nsubject: --code request back to you\nsignal: review-request\ncreated: 2026-10-11T16:10:00Z\n---\n\nx\n`);
  assert("ZERO-DELEGATION CONTROL: a request addressed TO me is not review traffic I sent (still 1)",
    countSentReviewTraffic(SID, zdMail) === 1);
  fs.writeFileSync(path.join(zdMail, `hub7777__954__${SID}.md`),
    `---\nfrom: ${SID}\nto: hub7777\nsubject: one more\nsignal: review-request\ncreated: 2026-10-11T16:11:00Z\n---\n\n--code request: <commit-id-1>\n`);
  // Not `signal: info` — the info widening reads the SUBJECT only (the 947 control above).
  assert("ZERO-DELEGATION: a marker in the BODY only counts too, under a request signal (2)",
    countSentReviewTraffic(SID, zdMail) === 2);

  fs.rmSync(tmp, { recursive: true, force: true });

  // ── 2026-07-13: the two defects that made this scan accuse a provably CLOSED loop ──
  // Each row was authored RED against the pre-fix code (the file's own discipline).

  // FIX B — a sha-embedded review-id. The rid is a SUFFIX of the sha, but commits cite the
  // FULL sha, so the strict token-boundary could never match it. This was the live failure:
  // `fix(hook): fold hub --code on <sha>` counted as ZERO citations of `cf8069`.
  assert("citesToken: rid `cf8069` IS cited by a commit naming the full sha `a5cf8069`",
    citesToken("fix(hook): fold hub --code on a5cf8069 — 3 findings", "cf8069") === true);
  // …and the anti-false-reassurance discipline must SURVIVE the fix: a non-sha token
  // that merely CONTAINS the rid must still NOT count.
  assert("citesToken: rid inside a NON-sha word does NOT count (no loose substring)",
    citesToken("refactor featurecf8069x helper", "cf8069") === false);
  assert("citesToken: an unrelated sha does NOT count",
    citesToken("fix: unrelated work in deadbeef1", "cf8069") === false);

  // FIX A — a later CONFIRMATION on the same rid dispositions the verdict BY CONSTRUCTION.
  const mkV = (rid, from, created, confirmation) => ({ rid, from, created, confirmation, trace: { commits: 0, todo: 0 } });
  const vOpen = mkV("cf8069", "hub9999", "2026-07-12T20:39:22Z", false);
  const vPass = mkV("cf8069", "hub9999", "2026-07-12T20:49:27Z", true);
  assert("needsAttention: a verdict with a LATER fold-verify PASS (same rid+hub) is NOT flagged",
    needsAttention(vOpen, [vOpen, vPass]) === false);
  // THE GATE MUST STAY ALIVE — this is the row that stops the fix from dead-gating the net.
  assert("needsAttention: an UNCONFIRMED, UNTRACED verdict STILL ACCUSES (gate not dead)",
    needsAttention(vOpen, [vOpen]) === true);
  // A confirmation for a DIFFERENT review-id must not launder an open verdict.
  const vOther = mkV("dac2745", "hub9999", "2026-07-12T21:00:00Z", true);
  assert("needsAttention: a confirmation for a DIFFERENT rid does NOT disposition it",
    needsAttention(vOpen, [vOpen, vOther]) === true);
  // An EARLIER confirmation cannot disposition a LATER verdict (ordering is load-bearing).
  const vEarly = mkV("cf8069", "hub9999", "2026-07-12T20:00:00Z", true);
  assert("needsAttention: an EARLIER confirmation does NOT disposition a later verdict",
    needsAttention(vOpen, [vOpen, vEarly]) === true);

  // reviewId on a subject-LEADING keyword ("VERDICT <sha> NAME — …", the hub's standard
  // verdict shape): the pre-fix code returned "" → the trace grepped an empty string →
  // a guaranteed false 🔴 on every such verdict (6/6 measured 2026-07-19, all provably
  // dispositioned). Both directions: the sha extracts, and the legacy leading-id shape
  // still works (mutation: revert the !head fallback → row 1 RED). The shas in the two sha
  // arms are invented, so they pass the stub resolver, as the SHAPE arms above do.
  assert("reviewId: subject-leading 'VERDICT <sha> …' extracts the sha (was '' → false 🔴)",
    reviewId("VERDICT b0a1c2d3e NAME — APPROVED / DEPLOY-CLEAR", anySha) === "b0a1c2d3e");
  assert("reviewId: legacy leading-id shape ('S99 VERDICT: …') still extracts the id",
    reviewId("S99 VERDICT: CHANGES-REQUESTED · deploy-hold") === "S99");
  // sha-LEADING subject: a digit-leading sha must keep its
  // leading digit(s) — the letter-token path alone drops them (mutation: drop the
  // leading-sha alternate → RED).
  assert("reviewId: sha-leading subject keeps a digit-leading sha intact",
    reviewId("8f0e1d2c S2 spatial gates — APPROVED", anySha) === "8f0e1d2c");

  // ── SENT-SIDE ARM ────────────────────────────────────────────────────────────
  // Every assertion below consumes the REAL exported symbol (a replica self-test is
  // structurally unfailable). Each claim class gets a DISCRIMINATING fixture: one
  // where the hypothesis being ruled OUT would read differently from the one ruled IN.
  // requestState — ONE request read against THREE inbound sets. The three readings must
  // DIFFER, or the fixture is not discriminating and a PASS here would mean nothing.
  const req = { to: "hub7777", created: "2026-08-03T10:00:00Z", rid: "deadbeef" };
  const sNone = requestState(req, []);
  const sStrong = requestState(req, [{ from: "hub7777", created: "2026-08-03T11:00:00Z", rid: "deadbeef" }]);
  const sWeak = requestState(req, [{ from: "hub7777", created: "2026-08-03T11:00:00Z", rid: "" }]);
  assert("requestState: no reply → unanswered", sNone === "unanswered");
  assert("requestState: reply carrying the SAME review-id → answered-strong", sStrong === "answered-strong");
  assert("requestState: reply WITHOUT a matching review-id → answered-weak (engagement, not proof)", sWeak === "answered-weak");
  assert("requestState DISCRIMINATION: the three readings are genuinely distinct (a fixture where they coincided would prove nothing)",
    new Set([sNone, sStrong, sWeak]).size === 3);
  assert("requestState: a reply from a DIFFERENT peer does not answer this request",
    requestState(req, [{ from: "someoneelse", created: "2026-08-03T11:00:00Z", rid: "deadbeef" }]) === "unanswered");
  assert("requestState: a reply created BEFORE the send does not answer it (temporal control)",
    requestState(req, [{ from: "hub7777", created: "2026-08-03T09:00:00Z", rid: "deadbeef" }]) === "unanswered");

  // ── THE ACK DEMOTE ──────────
  // These four arms were written and run against the UNPATCHED predicate FIRST, and the two
  // marked DEMOTE failed there (both read answered-strong) — so they are shown capable of
  // failing rather than asserted to be. The two CONTROL arms passed before and after; if a
  // later edit makes all four pass trivially, the demote has stopped discriminating.
  const ackReply = [{ from: "hub7777", created: "2026-08-03T11:00:00Z", rid: "deadbeef",
                     subject: "ACK deadbeef — queued #3 behind the crop panel" }];
  const ackThenVerdict = [
    { from: "hub7777", created: "2026-08-03T11:00:00Z", rid: "deadbeef", subject: "ACK deadbeef — queued #3" },
    { from: "hub7777", created: "2026-08-03T12:00:00Z", rid: "deadbeef", subject: "VERDICT deadbeef — APPROVED" },
  ];
  assert("requestState DEMOTE: an ACK naming the sha is ENGAGEMENT, not a verdict → answered-weak",
    requestState(req, ackReply) === "answered-weak");
  assert("requestState DEMOTE: a leading emoji does not smuggle an ACK past the opener test",
    requestState(req, [{ ...ackReply[0], subject: "📬 ACKED deadbeef — picking it up" }]) === "answered-weak");
  assert("requestState CONTROL: a real verdict naming the sha still reads answered-strong",
    requestState(req, [{ ...ackReply[0], subject: "VERDICT deadbeef — APPROVED, six arms kill" }]) === "answered-strong");
  assert("requestState DEMOTE: a status mail typed `signal: review-ack` is engagement whatever its subject opens with → answered-weak",
    requestState(req, [{ ...ackReply[0], subject: "deadbeef: hold lifted — STARTED now, 2 seats", signal: "review-ack" }]) === "answered-weak");
  assert("requestState CONTROL: a verdict typed `signal: deploy-clear` still reads answered-strong",
    requestState(req, [{ ...ackReply[0], subject: "deadbeef: APPROVED", signal: "deploy-clear" }]) === "answered-strong");
  for (const sig of ["review-update", "ack", "Review-Ack"]) assert(`requestState DEMOTE: \`signal: ${sig}\` on a sha-led status mail → answered-weak`,
    requestState(req, [{ ...ackReply[0], subject: "deadbeef: STARTED now, 2 seats", signal: sig }]) === "answered-weak");
  assert("requestState DEMOTE: a review-ack status mail whose TAIL names a disposition is still engagement → answered-weak",
    requestState(req, [{ ...ackReply[0], subject: "deadbeef: STARTED — hold lifts only on FOLD-VERIFIED", signal: "review-ack" }]) === "answered-weak");
  for (const sig of ["fold-verify", "deploy-hold", "deploy-clear"]) assert(`requestState CONTROL: \`signal: ${sig}\` is a disposition, never demoted → answered-strong`,
    requestState(req, [{ ...ackReply[0], subject: "deadbeef: hold lifted", signal: sig }]) === "answered-strong");
  for (const s of ["FOLD-VERIFIED deadbeef — byte-identical · ACK cafebabe1: seated", "deadbeef CLOSED + ACK cafebabe1"]) assert(`requestState CONTROL: a lead disposition typed review-ack stays answered-strong — "${s.slice(0, 30)}"`,
    requestState(req, [{ ...ackReply[0], subject: s, signal: "review-ack" }]) === "answered-strong");
  assert("requestState CONTROL: an ACK FOLLOWED by a verdict is answered-strong — the demote is per-reply, not per-thread",
    requestState(req, ackThenVerdict) === "answered-strong");
  // Substring control: the opener test is FIRST-WORD, so a subject merely CONTAINING an
  // opener word must not demote. Without this, `feedback` or `acknowledged-elsewhere` in any
  // position would silently open the same false-🟡 hole in the other direction.
  assert("requestState CONTROL: an opener word MID-SUBJECT does not demote (first-word test, not substring)",
    requestState(req, [{ ...ackReply[0], subject: "Your feedback on deadbeef — CHANGES-REQUESTED" }]) === "answered-strong");

  // replyLatencyMin — the congestion reopen trigger's instrument. DISCRIMINATING control: the SAME
  // request read against a fast reply, a slow reply and no reply must give three readings that
  // straddle the threshold in both directions, or the trigger cannot distinguish the state it
  // exists to detect.
  const fast = replyLatencyMin(req, [{ from: "hub7777", created: "2026-08-03T10:03:00Z" }]);
  const slowR = replyLatencyMin(req, [{ from: "hub7777", created: "2026-08-03T11:00:00Z" }]);
  assert("replyLatencyMin: a 3-minute reply measures 3", fast === 3);
  assert("replyLatencyMin: a 60-minute reply measures 60", slowR === 60);
  assert("replyLatencyMin: no reply → null (never 0, which would read as instant)",
    replyLatencyMin(req, []) === null);
  assert("replyLatencyMin STRADDLE: fast is UNDER and slow is OVER the reopen threshold — the trigger discriminates",
    fast < REVIEW_LATENCY_REOPEN_MIN && slowR > REVIEW_LATENCY_REOPEN_MIN);
  assert("replyLatencyMin: takes the EARLIEST reply, not the last (a later follow-up must not inflate it)",
    replyLatencyMin(req, [
      { from: "hub7777", created: "2026-08-03T12:00:00Z" },
      { from: "hub7777", created: "2026-08-03T10:03:00Z" },
    ]) === 3);
  assert("replyLatencyMin: a reply from a DIFFERENT peer does not count",
    replyLatencyMin(req, [{ from: "someoneelse", created: "2026-08-03T10:03:00Z" }]) === null);

  // ── rid PAIRING (2026-09-02) — the two measured failure directions, both as arms.
  // The four arms above carry inbound with NO rid, so they exercise the no-rid fallback and
  // stay green by construction; these are the cases they could not reach.
  assert("replyLatencyMin: prefers the reply NAMING this review over an earlier unrelated one (the UNDER-report fix)",
    replyLatencyMin(req, [
      { from: "hub7777", created: "2026-08-03T10:13:00Z", rid: "cafef00d" },  // 13m, DIFFERENT review
      { from: "hub7777", created: "2026-08-03T10:29:00Z", rid: "deadbeef" },  // 29m, THIS review
    ]) === 29);
  assert("replyLatencyMin: a reply about a DIFFERENT review does not answer this one → null (the OVER-fire fix)",
    replyLatencyMin(req, [
      { from: "hub7777", created: "2026-08-03T18:20:00Z", rid: "cafef00d" },  // 500m later, OTHER review
    ]) === null);
  // ⛔ THE LABEL USED TO SAY "an ACK names no sha", which contradicts the rest of this file:
  // `mail/SKILL.md` rule 2 blesses `ACK <sha>`, and requestState's demote exists BECAUSE an
  // ACK does carry it. The ASSERTION was always right — a rid-less reply is a real first
  // reply — only its justification named the wrong shape.
  assert("replyLatencyMin: a reply carrying NO rid still counts — a rid-less reply is a real first reply",
    replyLatencyMin(req, [{ from: "hub7777", created: "2026-08-03T10:03:00Z" }]) === 3);
  assert("replyLatencyMin CONTROL: a request with NO rid accepts any reply, matching or not",
    replyLatencyMin({ to: "hub7777", created: "2026-08-03T10:00:00Z" },
      [{ from: "hub7777", created: "2026-08-03T10:03:00Z", rid: "cafef00d" }]) === 3);
  // STRADDLE for the rid arm. ⚠️ The first version of this used the row's real numbers, 13m
  // against 29m — and FAILED, because 29 is UNDER the 30m threshold, so that pair cannot
  // straddle anything. The real incident under-reported a latency that was under threshold
  // either way; it proved the READING was wrong, not that the trigger flipped. To show the
  // trigger flipping, the fixture has to cross 30 — so this uses 13m unrelated against 45m
  // matching, which is the same shape at a magnitude that changes the verdict.
  assert("replyLatencyMin STRADDLE, rid arm: excluding a DIFFERENT review's reply moves the reading across the reopen threshold",
    replyLatencyMin(req, [
      { from: "hub7777", created: "2026-08-03T10:13:00Z", rid: "cafef00d" },  // 13m, OTHER review
      { from: "hub7777", created: "2026-08-03T10:45:00Z", rid: "deadbeef" },  // 45m, THIS review
    ]) > REVIEW_LATENCY_REOPEN_MIN);
  assert("replyLatencyMin STRADDLE control: the SAME fixture read the OLD way (time-order) is UNDER the threshold — the fix is what moves it",
    13 < REVIEW_LATENCY_REOPEN_MIN);

  assert("isReviewRequest: a --code subject IS a request", isReviewRequest({ subject: "--code REQUEST abc" }, "") === true);
  assert("isReviewRequest: a marker in the BODY counts (subject may be bare)",
    isReviewRequest({ subject: "(no subject)" }, "could you please review this diff") === true);
  assert("isReviewRequest CONTROL: an ordinary status mail is NOT a request",
    isReviewRequest({ subject: "heads up: I committed x" }, "nothing to do here") === false);

  // ── signal EXCLUSION (2026-09-02). The pair that motivated it: both subjects carry the
  // `fold-verify` marker, only one is awaiting a reply, and the sender already said which.
  assert("isReviewRequest: a declared non-request signal EXCLUDES a closure the markers would match",
    isReviewRequest({ subject: "FOLD-VERIFY PASS — LOOP CLOSED abc1234", signal: "info" }, "") === false);
  assert("isReviewRequest DISCRIMINATING TWIN: the same marker WITH a request signal still counts",
    isReviewRequest({ subject: "FOLD-VERIFY request: abc1234", signal: "review-request" }, "") === true);
  assert("isReviewRequest: an UNSET signal changes nothing — the markers decide, exactly as before",
    isReviewRequest({ subject: "--code request: abc1234" }, "") === true);
  assert("isReviewRequest: exclusion NEVER promotes — a non-request signal on a mail with no marker is still not a request",
    isReviewRequest({ subject: "just so you know", signal: "info" }, "no markers here") === false);
  assert("isReviewRequest: an UNRECOGNISED signal falls through to the markers rather than excluding",
    isReviewRequest({ subject: "--code request: abc1234", signal: "some-new-signal" }, "") === true);

  // ── MENTION vs DISPOSITION (2026-09-02)
  // The fixture is the triage commit's OWN body text, verbatim, because the control must be
  // built from the incident: a commit that lists un-replied ids while triaging the
  // backlog must NOT disposition them.
  const TRIAGE_SPAN =
    "The zeros: <commit-id-1>, <commit-id-2>, <commit-id-3>, <commit-id-4>. Three of those four are FOLD notices,\n" +
    "and a fold owes a fold-verify.\n" +
    "\n" +
    "<commit-id-4> is the one worth naming. I believed it rode inside the comparison go-round I closed\n" +
    "at 23:20 — that belief was recall, and my own sent mail does not contain the sha. Exactly the";
  for (const id of ["<commit-id-1>", "<commit-id-2>", "<commit-id-3>", "<commit-id-4>"]) {
    assert(`MENTION: <triage-commit-id>'s triage line does NOT disposition ${id} (it names it as UNANSWERED)`,
      citesToken(TRIAGE_SPAN, id) === true && citesDisposition(TRIAGE_SPAN, id) === false);
  }
  // ⛔ THE ARM THAT PROVES THE CLAUSE SPLIT IS LOAD-BEARING, AND THE ONE THE TRACKER ROW'S OWN
  // PRESCRIPTION FAILS. The row says "require a disposition token in the citing LINE". That
  // physical line ENDS "…are FOLD notices," — so the token IS on the line, and a per-line test
  // returns TRUE on the exact instance the row was filed for. Only the clause split separates
  // them. Mutation: replace `dispositionClauses` with `(t) => [t]` and all four arms above go RED.
  const TRIAGE_LINE = TRIAGE_SPAN.split("\n")[0];
  assert("MENTION MUTATION: the citing LINE does carry a disposition token, so a per-LINE test " +
    "would pass on the row's own fixture — the CLAUSE split is what makes the fix work",
    DISPOSITION_VOCAB.test(TRIAGE_LINE) === true &&
    citesDisposition(TRIAGE_LINE, "<commit-id-1>") === false);
  // GIT-BACKED TWIN — the same claim against the REAL commit message rather than a transcription,
  // so the fixture cannot drift from the incident. Skipped (not failed) where the commit is absent.
  if (gitIsCommit("<triage-commit-id>")) {
    const realBody = sh("git show -s --format=%B <triage-commit-id>");
    assert("MENTION (git-backed): the real <triage-commit-id> message disposition-traces NONE of its four ids",
      realBody.length > 0 &&
      ["<commit-id-1>", "<commit-id-2>", "<commit-id-3>", "<commit-id-4>"]
        .every((id) => citesToken(realBody, id) && !citesDisposition(realBody, id)));
  }
  // POSITIVE CONTROLS — real disposition lines from the same corpus must STILL count, or the fix
  // is a blanket suppression. Each is a live commit subject/body line, hand-read at 2026-09-02.
  assert("DISPOSITION: an act verb in the id's clause counts ('… items closed — <commit-id-2> fold-verified …')",
    citesDisposition("plan(<session-id>): second of the four zero-reply backlog items closed — <commit-id-2> fold-verified about 28 hours late", "<commit-id-2>") === true);
  assert("DISPOSITION: the hub's standard fold subject counts",
    citesDisposition("fix(scope): fold hub verdict on <commit-id> — one finding folded, one declined", "<commit-id>") === true);
  // ⛔ THE MEASURED FALSE-🔴 THAT KILLED VOCABULARY DRAFT 1 — a disposition that names no fold.
  // The paired assertion is the point: the first alone would pass under the act-verb-only draft
  // if a reader assumed "Hub" implied one; the second removes the actor/finding words and demands
  // the classification collapse, proving THEY carry it.
  assert("DISPOSITION: 'Hub P1 on <sha>, filed as not-theirs-not-mine' counts — actor + finding token",
    citesDisposition("Hub P1 on <commit-id>, filed as not-theirs-not-mine. It is mine. I verified it", "<commit-id>") === true);
  assert("DISPOSITION MUTATION: strip the actor and the finding token and that same clause STOPS " +
    "counting — so the widening is load-bearing, not decoration",
    citesDisposition("Seen at <commit-id>, filed as not-theirs-not-mine. It is mine. I verified it", "<commit-id>") === false);
  assert("DISPOSITION: a verdict outcome word counts ('Hub ALTERNATIVE on <sha>, two lenses.')",
    citesDisposition("Hub ALTERNATIVE on <commit-id>, two lenses. Both findings verified by me at source", "<commit-id>") === true);
  // MENTION CONTROLS — live lines that name a reviewed sha for an unrelated reason.
  assert("MENTION: naming a sha as where a bug was introduced is not a disposition",
    citesDisposition("the substring-sweep claim corrected at <commit-id> an hour ago.", "<commit-id>") === false);
  assert("MENTION: `refuted` is deliberately OUT of the vocabulary — it appears in a live mention " +
    "of an unrelated refutation that names a reviewed sha",
    citesDisposition("<session-id> refuted its own token test for owner-legible table copy at <commit-id-3>, on the", "<commit-id-3>") === false);
  assert("CLAUSE SPLIT: a decimal does not split a clause (a sentence ender needs trailing whitespace)",
    dispositionClauses("v2.77 fold of abc1234 landed").length === 1 &&
    citesDisposition("v2.77 fold of abc1234 landed", "abc1234") === true);

  // ── ANSWERED-SIDE ARM (2026-09-02) ──────
  // requestTargets: shape arms use a stub resolver (their shas are invented, so the real git
  // authority would correctly reject them); the authority arm below uses the real resolver.
  const allCommits = () => true;
  // ⛔ A BATCH REQUEST'S TARGETS COME FROM ITS SUBJECT, NOT ITS FIRST SHA.
  // Measured live: 56 of 150 request-shaped subjects name more than one sha, ~45 of them
  // genuine multi-commit asks. Before this, `full` went true on the FIRST commit alone.
  assert("requestTargets: a multi-sha SUBJECT yields every resolvable sha, not just the rid",
    JSON.stringify(requestTargets("0a1b2c3d4", "body text",
      allCommits, "--code request: 0a1b2c3d4 + 9f8e7d6c5 — two commits")) ===
      JSON.stringify(["0a1b2c3d4", "9f8e7d6c5"]));
  assert("requestTargets CONTROL: a single-sha subject still yields exactly that one",
    JSON.stringify(requestTargets("0a1b2c3d4", "body naming 9f8e7d6c5 elsewhere",
      allCommits, "--code request: 0a1b2c3d4 — one commit")) === JSON.stringify(["0a1b2c3d4"]));
  // ⛔ THE TYPED-SIGNAL NARROWING, AND ITS CONTROL.
  // The multi-target path at full width was REJECTED in favour of the sender's own
  // `signal:` over any prose gate. Both arms are required: the exclusion alone would pass on a
  // predicate that refuses EVERY multi-sha subject, which is the failure a tightening invites.
  assert("requestTargets: a `signal: fold-verify` request keeps the rid alone — the folded sha " +
    "and the verdict it answers are CONTEXT, not commits it asks you to review",
    JSON.stringify(requestTargets("0a1b2c3d4", "body text",
      allCommits, "FOLD-VERIFY 0a1b2c3d4 on your 9f8e7d6c5 verdict", "fold-verify")) ===
      JSON.stringify(["0a1b2c3d4"]));
  assert("requestTargets: `fold-report` is the second member of the exclusion, not an alias",
    JSON.stringify(requestTargets("0a1b2c3d4", "body text",
      allCommits, "FOLD REPORT 0a1b2c3d4 + 9f8e7d6c5", "fold-report")) ===
      JSON.stringify(["0a1b2c3d4"]));
  assert("requestTargets CONTROL: the SAME multi-sha subject under a REQUEST signal still " +
    "expands — so the exclusion is the signal, not a gate that refuses every batch",
    JSON.stringify(requestTargets("0a1b2c3d4", "body text",
      allCommits, "FOLD REPORT 0a1b2c3d4 + 9f8e7d6c5", "review-request")) ===
      JSON.stringify(["0a1b2c3d4", "9f8e7d6c5"]));
  assert("requestTargets CONTROL: an UNSIGNALLED multi-sha subject still expands — the " +
    "exclusion reads the typed field only, and 20 of this inbox's 68-row swing carry no signal",
    JSON.stringify(requestTargets("0a1b2c3d4", "body text",
      allCommits, "--code request: 0a1b2c3d4 + 9f8e7d6c5", "")) ===
      JSON.stringify(["0a1b2c3d4", "9f8e7d6c5"]));
  // ⛔ THE ARM THAT GUARDS THE REJECTED FIX. Unioning the rid with the BODY's shas was the
  // remedy the verdict's wording suggested, and it is REFUTED: 232 rid-bearing mails also name
  // body shas and the population is dominated by FOLD-VERIFYs, which cite the folded sha as a
  // matter of course. That union flips ~232 rows to a false PARTIAL. If a later change makes
  // the body contribute targets to a rid-bearing request, THIS arm goes red first.
  assert("requestTargets: a rid-bearing request does NOT absorb shas that appear only in the BODY " +
    "(the refuted union — it would false-RED every fold-verify)",
    JSON.stringify(requestTargets("0a1b2c3d4", "also mentions 9f8e7d6c5 and 18093200a",
      allCommits, "--code request: 0a1b2c3d4")) === JSON.stringify(["0a1b2c3d4"]));
  assert("requestTargets: a subject whose tokens git cannot resolve falls back to the rid",
    JSON.stringify(requestTargets("0a1b2c3d4", "body",
      () => false, "--code request: 9999999 + 8888888")) === JSON.stringify(["0a1b2c3d4"]));
  assert("requestTargets: a rid-bearing request is keyed on its rid alone",
    JSON.stringify(requestTargets("deadbeef", "body naming aaaaaaa1 and bbbbbbb2", allCommits)) === JSON.stringify(["deadbeef"]));
  assert("requestTargets: a rid-less BATCH falls back to the shas its body names",
    JSON.stringify(requestTargets("", "- `0a1b2c3d4` rules\n- `9f8e7d6c5` more\n- `0a1b2c3d4` dup", allCommits)) === JSON.stringify(["0a1b2c3d4", "9f8e7d6c5"]));
  assert("requestTargets AUTHORITY: a sha-SHAPED body token that git cannot resolve is NOT a target " +
    "(no target ⇒ no answered state ⇒ the request stays 🔴, the safe direction)",
    requestTargets("", "batch of 999999999 and 18093200a").length === 0);
  assert("requestTargets: no rid and no resolvable sha ⇒ empty, never a phantom target",
    requestTargets("", "please review the thing I mentioned", allCommits).length === 0);

  const rq = { request: true, from: "hub7777", created: "2026-08-03T10:00:00Z", targets: ["deadbeef"] };
  // ⚠️ FIXTURES CARRY subject + signal SINCE A REVIEW FINDING'S FOLD. They previously carried only
  // `text`, a shape no real mail has (mail-send requires a subject) — so they passed a
  // gate that did not exist and would have passed the ACK that finding was about.
  const outHit = [{ to: "hub7777", created: "2026-08-03T11:00:00Z", subject: "VERDICT deadbeef — two findings",
                    signal: "review-verdict", text: "VERDICT deadbeef — two findings, both folded" }];
  assert("answeredState: an outbound to the requester citing the rid ⇒ ANSWERED, with its timestamp",
    answeredState(rq, outHit)?.full === true && answeredState(rq, outHit)?.at === "2026-08-03T11:00:00Z");
  assert("answeredState CONTROL: no outbound at all ⇒ null (the request stays 🔴)",
    answeredState(rq, []) === null);
  assert("answeredState CONTROL: an outbound to a DIFFERENT peer does not answer this request",
    answeredState(rq, [{ to: "someoneelse", created: "2026-08-03T11:00:00Z", text: "VERDICT deadbeef" }]) === null);
  assert("answeredState CONTROL: an outbound created BEFORE the request does not answer it",
    answeredState(rq, [{ to: "hub7777", created: "2026-08-03T09:00:00Z", text: "VERDICT deadbeef" }]) === null);
  assert("answeredState CONTROL: an outbound to the right peer that does NOT cite the id ⇒ null",
    answeredState(rq, [{ to: "hub7777", created: "2026-08-03T11:00:00Z", text: "unrelated note" }]) === null);
  assert("answeredState SCOPE: a non-request review-plane mail is never marked answered",
    answeredState({ ...rq, request: false }, outHit) === null);
  // ⛔ THE NAMED DEVIATION FROM THE TRACKER ROW, PINNED. The row says report 🟢 when an outbound
  // "cites the review-id (or the request's shas)". Read as ANY-of, a 26-sha batch served on one
  // sha goes green. This arm demands PARTIAL instead — and the discriminating pair is the point:
  // the same fixture with the second sha cited flips `full` to true.
  const batch = { request: true, from: "hub7777", created: "2026-08-03T10:00:00Z", targets: ["deadbeef", "cafef00d"] };
  const bmail = (text) => [{ to: "hub7777", created: "2026-08-03T11:00:00Z",
                            subject: "VERDICT — batch", signal: "review-verdict", text }];
  const partial = answeredState(batch, bmail("VERDICT deadbeef only — folded"));
  const complete = answeredState(batch, bmail("VERDICT deadbeef folded and cafef00d folded"));
  assert("answeredState PARTIAL: a batch served on 1 of 2 shas is NOT full", partial?.full === false && partial?.cited === 1 && partial?.total === 2);
  assert("answeredState DISCRIMINATION: the SAME fixture with both shas cited IS full — so the " +
    "partial reading is the coverage, not an artefact of the fixture", complete?.full === true);
  // ⛔ THE BARE ACK THAT CLEARED A LIVE DEPLOY-HOLD, PINNED WITH ITS POSITIVE CONTROL. The single-variable A/B:
  // adding ONE outbound with `signal: ack` and the body "Got it — I will look at it tomorrow.
  // Nothing folded yet" cleared a live deploy-hold carrying a serious and a moderate finding, with zero durable
  // trace. Both arms are required — the negative alone would pass on a gate that rejects
  // EVERYTHING, which is the failure mode a tightening invites.
  const ackOnly = [{ to: "hub7777", created: "2026-08-03T11:00:00Z", subject: "ACK deadbeef — queued",
                     signal: "ack", text: "Got it — I will look at it tomorrow. Nothing folded yet. deadbeef" }];
  assert("answeredState: a bare `signal: ack` reply that MENTIONS the sha does NOT answer",
    answeredState(rq, ackOnly) === null);
  assert("answeredState CONTROL: the same fixture as a real verdict DOES answer — so the ack " +
    "rejection is the signal, not a gate that refuses everything",
    answeredState(rq, [{ ...ackOnly[0], subject: "VERDICT deadbeef — CHANGES-REQUESTED",
      signal: "review-verdict", text: "VERDICT deadbeef — CHANGES-REQUESTED, P1 folded at abc1234" }])?.full === true);
  assert("answeredState: a MENTION inside a verdict-class mail is still not a disposition",
    answeredState(rq, [{ to: "hub7777", created: "2026-08-03T11:00:00Z", subject: "VERDICT unrelated",
      signal: "review-verdict", text: "Unrelated to any review: deadbeef is the commit that first introduced the row." }]) === null);
  // ⛔ THE ARM THAT PROVES THE CLASS GATE IS LOAD-BEARING, AND IT WAS MISSING. The
  // ack fixture above is rejected by `citesDisposition` alone (its body carries no disposition
  // vocab), so a mutation disabling the class gate left that arm GREEN — the gate looked like
  // belt-and-braces I could not justify. THIS is the case only the gate catches: an `ack` whose
  // body DOES read as a disposition around the target sha. Measured: citesDisposition=true,
  // isDispositionMail=false, answeredState=null. Both changes are load-bearing, on different
  // inputs; neither alone closes the finding.
  assert("answeredState: an `ack` whose BODY reads as a disposition is still not an answer — " +
    "the class gate catches what citesDisposition cannot",
    answeredState(rq, [{ to: "hub7777", created: "2026-08-03T11:00:00Z",
      subject: "ACK deadbeef — queued behind two lenses", signal: "ack",
      text: "Got it. I folded deadbeef's sibling already; deadbeef itself I will verify tomorrow." }]) === null);
  assert("isDispositionMail: a `--code` REQUEST of mine never answers (the sibling's <commit-id> defect)",
    isDispositionMail({ subject: "--code request: deadbeef", signal: "deploy-review" }) === false);
  assert("isDispositionMail: FOLD-VERIFY PASS is a disposition even though `fold-verify` is a " +
    "REQUEST_MARKER — the sender's signal outranks the keyword (this file's own 2026-09-02 rule)",
    isDispositionMail({ subject: "FOLD-VERIFY PASS — LOOP CLOSED", signal: "review-verdict" }) === true);
  assert("needsAttention: a FULLY answered request is dispositioned on the mail plane",
    needsAttention({ confirmation: false, trace: { commits: 0, todo: 0 }, answered: { full: true } }) === false);
  assert("needsAttention: a PARTIALLY answered request STILL ACCUSES (the gate stays alive)",
    needsAttention({ confirmation: false, trace: { commits: 0, todo: 0 }, answered: { full: false, cited: 1, total: 2 } }) === true);
  // ⛔ THE RECEIVE-SIDE SIGNAL DROP, WITH ITS DISCRIMINATING TWIN. Live inbound requests carry
  // `signal: info` (measured: "--code request <sha> + <sha>", the 26-sha BATCH, and the
  // BATCHED 8-commit request all do), which `isReviewRequest` excludes by name (the sent side
  // reads `isSentReviewTraffic`, which admits it on its `code request` subject).
  assert("isReceivedRequest: an inbound `--code request` stamped `signal: info` IS a request",
    isReceivedRequest({ subject: "--code request: <commit-id-1> + <commit-id-2>", signal: "info" }, "") === true);
  assert("isReceivedRequest TWIN: `isReviewRequest` rejects that SAME mail — so dropping the " +
    "signal exclusion is what reaches the class, and the two predicates differ on purpose",
    isReviewRequest({ subject: "--code request: <commit-id-1> + <commit-id-2>", signal: "info" }, "") === false);
  assert("isReceivedRequest CONTROL: an ordinary status mail is still NOT a request",
    isReceivedRequest({ subject: "heads up: I committed x", signal: "info" }, "nothing to do here") === false);


  // ── ZERO-DELEGATION arm (2026-08-12) ─────────────────────────────────────────
  // Fixtures COMPOSE the confirmation-line shape (never a literal) so neither this
  // source nor the transcript that wrote it can satisfy a later floor grep, and the
  // synthetic shas are intersected against an INJECTED unpushed set — a live run
  // intersects with the real rev-list, so fixture shas can never count there.
  const pdir = path.join(tmp, "projects");
  fs.mkdirSync(pdir, { recursive: true });
  const conf = (sha) => JSON.stringify({ type: "tool_result", content: "[ma" + "in " + sha + "] subj\n 2 files cha" + "nged, 4 insertions(+)" });
  const UP = ["aaaaaaa1".padEnd(40, "0"), "bbbbbbb2".padEnd(40, "0"), "ccccccc3".padEnd(40, "0")];
  fs.writeFileSync(path.join(pdir, `${SID}-fixture.jsonl`),
    [conf("aaaaaaa1"), conf("aaaaaaa1"), conf("bbbbbbb2"), conf("ccccccc3"), conf("ddddddd4")].join("\n"));
  const zdFire = zeroDelegationCheck({ sid: SID, sentCount: 0, projectsDir: pdir, unpushed: UP });
  assert("zero-delegation FIRES: floor 3 distinct unpushed + 0 sent", zdFire.fires === true && zdFire.floor === 3);
  assert("zero-delegation DEDUP: the duplicated sha counted once (floor 3, not 4)", zdFire.floor === 3);
  assert("zero-delegation INTERSECTION discriminates: the sha OUTSIDE the unpushed set did not count",
    zeroDelegationCheck({ sid: SID, sentCount: 0, projectsDir: pdir, unpushed: UP.slice(0, 2) }).floor === 2);
  assert("zero-delegation SILENT when the session delegated (sent 1)",
    zeroDelegationCheck({ sid: SID, sentCount: 1, projectsDir: pdir, unpushed: UP }).fires === false);
  assert("zero-delegation SILENT under the commit floor (2 < 3)",
    zeroDelegationCheck({ sid: SID, sentCount: 0, projectsDir: pdir, unpushed: UP.slice(0, 2) }).fires === false);
  const confDev = (sha) => JSON.stringify({ type: "tool_result", content: "[d" + "ev " + sha + "] subj\n 1 file cha" + "nged" });
  fs.writeFileSync(path.join(pdir, "dev5555-fixture.jsonl"), [confDev("aaaaaaa1"), confDev("bbbbbbb2"), confDev("ccccccc3")].join("\n"));
  assert("zero-delegation reads `dev`-branch confirmation lines (sessions commit on dev; main-only read 0)",
    zeroDelegationCheck({ sid: "dev5555", sentCount: 0, projectsDir: pdir, unpushed: UP }).floor === 3);
  assert("zero-delegation SILENT with no transcript (absence proves nothing — never a false fire)",
    zeroDelegationCheck({ sid: "<other-session-id>", sentCount: 0, projectsDir: pdir, unpushed: UP }).fires === false);
  const zdMail2 = path.join(tmp, "zd-mail2");
  fs.mkdirSync(zdMail2, { recursive: true });
  assert("zero-delegation FIRES by default on an empty mail dir (the check owns its count)",
    zeroDelegationCheck({ sid: SID, mailDir: zdMail2, projectsDir: pdir, unpushed: UP }).fires === true);
  fs.writeFileSync(path.join(zdMail2, `hub7777__960__${SID}.md.read`),
    `---\nfrom: ${SID}\nto: hub7777\nsubject: --code request: <commit-id-1>\nsignal: info\ncreated: 2026-10-11T16:07:29Z\n---\n\nx\n`);
  assert("zero-delegation SILENT by default once a `signal: info` --code request was sent",
    zeroDelegationCheck({ sid: SID, mailDir: zdMail2, projectsDir: pdir, unpushed: UP }).reason === "delegated");
  assert("zero-delegation reports the count it decided on (the clean line prints it, never a narrower one)",
    zeroDelegationCheck({ sid: SID, mailDir: zdMail2, projectsDir: pdir, unpushed: UP }).sent === 1);
  const zdLine = fenceB > -1 ? fenceSrc.slice(fenceB, fenceSrc.indexOf("\n", fenceB)) : "";
  assert("report() passes NO sentCount to the zero-delegation check (the old count cannot ride back in)",
    zdLine.length > 0 && !zdLine.includes("sentCount"));
  const claimDir = path.join(tmp, "state");
  fs.mkdirSync(claimDir, { recursive: true });
  fs.writeFileSync(path.join(claimDir, "fleet-claim-review-hub"), "token: review-hub\nsession: hub7777\nclaimed: 2026-08-06T00:00:00Z\n");
  assert("readHubClaim parses the claimant sid", readHubClaim(claimDir)?.session === "hub7777");
  assert("readHubClaim: missing file reads null, never throws", readHubClaim(path.join(tmp, "nope")) === null);

  fs.rmSync(tmp, { recursive: true, force: true });
  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) console.log(`${c.ok ? "✓" : "✗"} ${c.name}`);
  console.log(`\nself-test: ${checks.length - failed.length}/${checks.length} passed`);
  return failed.length === 0 ? 0 : 1;
}

// ── entry ──────────────────────────────────────────────────────────────────────
// Main-guard (2026-08-12): without it, IMPORTING this module ran a full report and
// process.exit()'d before the importer's first line — measured killing the live
// probe written to exercise the zero-delegation arm.
import { pathToFileURL } from "node:url";
import { isMain as isMainModule } from "./lib/is-main.mjs";
const isMain = isMainModule(import.meta.url);
if (!isMain) {
  // importer: export-only, no side effects
} else if (process.argv.includes("--self-test")) {
  process.exit(selfTest());
} else {
  const sid = ownSid();
  const hours = parseInt(argOf("--hours") || "96", 10);
  process.exit(report(sid, hours));
}
