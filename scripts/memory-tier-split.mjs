#!/usr/bin/env node
/**
 * memory-tier-split.mjs — split an oversized expert MEMORY.md into a HOT file
 * (preamble + banner + complete digest index + newest-backward full entries)
 * and a COLD sibling MEMORY-ARCHIVE.md (full bodies of everything else).
 *
 * WHY: the harness truncates an always-loaded MEMORY.md past its cap. It DOES
 * announce that with a banner — "silently" here was refuted 2026-08-25 — but it
 * never names WHICH rows it dropped, so the enforcement you lost is unattributable.
 * A 400 KB expert memory is not "big", it is PARTLY INVISIBLE — and THAT is the
 * quieter failure of the two: a Read returns a partial view with is_error FALSE and
 * discloses the truncation only in an attachment, so every seat reading one has been
 * reasoning off a prefix without knowing where it ended. Splitting keeps the whole corpus
 * greppable while making the always-read half fit under the ceiling.
 *
 * DETERMINISM: no judgment anywhere. The digest is (first sentence of the body)
 * + (any `Revisit:`-shaped line), mechanically extracted and mechanically
 * truncated — a leading numbered-list marker skipped, and any bold, italic or
 * code marker whose partner a cut left behind dropped (`digestOf`, `renderDigest`).
 * Two runs over the same bytes produce identical output.
 *
 * CONSERVATION: every date-heading lands in exactly one of {hot recent-full,
 * archive}, and the md5 of all entry bodies concatenated in ORIGINAL DOCUMENT
 * ORDER is identical before and after. Any mismatch ABORTS before writing.
 *
 * ⛔ THAT GUARANTEE IS SCOPED TO HEADINGS + BODIES, AND INDEX ROWS ARE NEITHER.
 * `conservation: OK` is therefore a TRUE statement about a NARROWER set than a
 * reader naturally hears. Measured twice: one roll's commit records this check passing
 * while 71 `- ` INDEX ROWS were dropped; the 2026-08-14 uncle-bob roll dropped
 * 124 lines (123 index rows + the replaced `## Memory index` header) with the
 * same clean print. Nothing was LOST either time — the router re-renders those
 * rows in its generated digest index — but you cannot learn that from here.
 *
 * SO A ROLL NEEDS TWO INDEPENDENT CHECKS, AND NEITHER ALONE IS SUFFICIENT:
 *   1. MULTISET over non-blank lines (count-preserving), old pair vs new pair.
 *      Closes TRUNCATION and LOSS. Blind to ORDER by construction — a reordered
 *      body has an identical multiset. A DISTINCT-line diff is weaker still: a
 *      set cannot see multiplicity loss (a line dropped in one place, surviving
 *      elsewhere, reads as preserved).
 *   2. SEQUENCE over `## ` heading order + per-entry body extents. Closes
 *      REORDERING, which (1) cannot reach.
 * Run both at the COMMIT BOUNDARY (`<sha>^` vs `<sha>`), never against the
 * worktree — on this repo a peer appends to a skill memory within the hour and
 * a genuinely-new entry then reads as "content moved".
 * Verified together (both instruments run
 * independently and agreeing). 14 classic dirs remain as of 2026-08-14.
 *
 * ── SHARDED MODE (added 2026-08-06)
 * The single-archive shape above does not scale to `.claude/skills/meta/MEMORY.md`
 * (3.14 MB — 11.96x the Read tool's ~262144 B hard-error ceiling). Applied there it
 * yields a ~2.9 MB archive: it MOVES the unreadability rather than fixing it. The
 * sharded mode instead cuts the corpus at `## ` boundaries IN FILE ORDER into
 * date-named shards each <= 200 KB, routes two LIVE registers to their own files,
 * cuts the closed legacy list-form era into Read-able halves, and rewrites the hot
 * file as a ROUTER (manifest + current-shard digests) <= 57.5 KB.
 *
 * FILE ORDER IS NEVER REORDERED. `L#` is NOT monotonic in file order (16 descending
 * steps measured 2026-08-06), so an L#-ranged shard name would require physically
 * reordering the ledger — destroying append-order provenance and making the
 * reconstruction check impossible. Shards are named by DATE range for that reason.
 *
 * Usage:
 *   node scripts/memory-tier-split.mjs <skill-name|path>   apply the split
 *   node scripts/memory-tier-split.mjs <target> --dry-run  report, write nothing
 *   node scripts/memory-tier-split.mjs --all-over <bytes>  every skill over N bytes
 *   node scripts/memory-tier-split.mjs --sanitize <target> strip task-notification XML
 *   node scripts/memory-tier-split.mjs --self-test         fixture + RED control
 *   node scripts/memory-tier-split.mjs --shard <target> --out <dir> [--dry-run]
 *                                                          sharded router+shards split
 *   node scripts/memory-tier-split.mjs --roll <dir> [--dry-run]
 *                                                          re-derive the layout; cuts a
 *                                                          new shard once the current one
 *                                                          crosses --shard-cap. Idempotent.
 *   flags: --target N --hard-cap N (classic) · --shard-cap N --router-cap N (sharded)
 *          --trailing-date (classic: also treat `## Title (YYYY-MM-DD)` as dated)
 *
 * `.claude/skills/meta/MEMORY.md` is EXCLUDED from --all-over by design
 * (it is a keyed-retrieval store, not a chronological log). The --shard mode is
 * always EXPLICIT about its target, so the exclusion does not apply to it.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { isMain as isMainModule } from "./lib/is-main.mjs";
// The AUTHORITY on what counts as an `L#` declaration. Imported rather than
// re-implemented: a hand-built heading pattern measured 80.7% blind over this
// corpus (`.claude/rules/active-recall.md`), and the router MUST provably carry
// zero declarations or the union-scan double-counts every archived lesson.
// Safe to import — check-lesson-numbers.mjs carries a realpath-hardened
// entrypoint guard precisely so `import { scan }` does not run its CLI.
import { scan } from "./check-lesson-numbers.mjs";

// ---------------------------------------------------------------- constants

export const TARGET_BYTES = 40_000; // fill recent-full up to here
export const HARD_CAP_BYTES = 48_000; // never exceed
const RESERVE_BYTES = 1_500; // headroom left free when sizing the index
const MAX_TITLE = 140;
/** Descending digest-length ladder. The largest value whose index still fits
 *  under (HARD_CAP - RESERVE) wins. A 255-entry file cannot afford a 240-char
 *  digest; a 35-entry file can. Same rule, different outcome — no per-file knob. */
const DIGEST_LADDER = [240, 180, 140, 110, 85, 65, 50, 38, 28, 20, 0];

const DATE_HEADING = /^## (20\d\d-\d\d-\d\d)/;
const ANY_H2 = /^## /;
const FENCE = /^\s*(```|~~~)/;
/**
 * LEGACY BULLET ERA. A few older expert memory files (ux-copywriter and ux-design-pro among them)
 * predate the `## YYYY-MM-DD` heading convention and record
 * entries as dated top-level bullets under a `## Per-Audit Entries` umbrella:
 *   - [2026-04-16] Share dialog final audit …
 *   - **2026-04-07 — Homepage Audit (panel):** Approved with fixes …
 *   - **2026-04-14 | Final Audit — …** — PASS WITH FINDINGS …
 * Treated naively these are ONE 44-60 KB "non-date section" that must stay hot,
 * which breaches the cap on its own AND leaves ~90 real entries out of the
 * index — i.e. absent from the retrieval contract the banner promises.
 * They are dated entries, so they are parsed as entries.
 * Deliberately does NOT match the undated principles bullets in the same files
 * ("- Tone: peer mentor…"), which stay hot verbatim.
 */
const LEGACY_ENTRY = /^[-*]\s+(?:\[)?(?:\*\*)?(20\d\d-\d\d-\d\d)(?:\*\*)?(?:\])?/;
/** Tolerant on purpose: the corpus carries `Revisit:`, `**Revisit**:`,
 *  `Revisit/trigger:`, `Revisit (2026-08-01):`. Widening capture can only
 *  improve the index; it cannot make a row wrong. */
const REVISIT_LINE = /^\s*(?:[-*+]\s+)?(?:\*\*)?Revisit\b[^:\n]{0,28}?(?:\*\*)?\s*:/i;

const SKILLS_DIR = ".claude/skills";
const EXCLUDED_SKILLS = new Set(["meta"]);

/**
 * The fleet-standard cold-store header. Hoisted out of splitMemory (2026-08-06) so
 * the sharded mode reuses the SAME bytes rather than a retyped copy. Verified
 * byte-identical against all 24 on-disk `MEMORY-ARCHIVE.md` files; the parity check
 * is a test arm, not a comment, so a future
 * reword of this constant REDs instead of silently forking the convention.
 */
export const ARCHIVE_HEADER =
  "<!-- MEMORY-ARCHIVE — APPEND-ONLY COLD STORE. Full bodies of entries whose digests\n" +
  "     appear in MEMORY.md's index. Nothing here is distilled, summarized or deleted;\n" +
  "     entries move here VERBATIM as MEMORY.md's recent window rolls forward.\n" +
  "     This file is NOT auto-loaded — grep it explicitly before claiming absence.\n" +
  // The TAIL clause (2026-08-06, a catch on the write path). Appends land at the TAIL;
  // a partial Read shows the file from the START. So the NEWEST entries — the ones a seat is most
  // likely hunting — are exactly the bytes a bare Read drops, and it drops them SILENTLY. Measured
  // on the live shard the hour this was written: the newest entry sat at line 860 of 872 in a 131,687 B file.
  // Worded to hold at ANY size (the ordering fact is unconditional, the truncation is size-gated)
  // so it never becomes a false alarm on a small archive that genuinely Reads whole.
  "     ⛔ NEWEST ENTRIES ARE AT THE TAIL (append-only). Once this file passes the Read\n" +
  "     tool's partial-view band (~58-64 KB of prose), a BARE READ RETURNS THE OLDEST\n" +
  "     CONTENT HERE and gives NO signal that newer entries exist — recency and\n" +
  "     truncation-vulnerability are the same position in the file. grep it, or Read\n" +
  "     with an offset near the end. -->";

/**
 * TRAILING-DATE HEADINGS. `DATE_HEADING` is leading-anchored, so the pre-convention
 * spelling `## Billing System Final Audit v2 (2026-04-14)` parses as a NON-date
 * section and is pinned HOT forever. Measured 2026-08-06 across all 24 skills: 2 live
 * instances — `saas-engineer` (5,261 B stranded, and its hot file is 49,121 B, i.e.
 * already OVER HARD_CAP_BYTES=48,000) and `saas-economist` (1,788 B). Both are already
 * split, so the idempotence guard means this changes nothing for them today; it only
 * affects a future or deliberate re-split.
 *
 * OPT-IN (`opts.trailingDate`), default OFF, so the 24 shipped splits keep byte-identical
 * behaviour. The sharded mode always enables it — it needs a date per section to name
 * shards at all.
 */
export function headingDate(headingLine, trailingDate = false) {
  const lead = DATE_HEADING.exec(headingLine);
  if (lead) return { date: lead[1], kind: "leading" };
  if (!trailingDate) return null;
  // FIRST date in the heading, not the last: `## … (2026-04-14 through 2026-04-19,
  // compressed 2026-05-21)` is an entry ABOUT 04-14, filed later. Shard names take the
  // min/max across a shard anyway, so the choice only shifts a range edge.
  const any = /20\d\d-\d\d-\d\d/.exec(headingLine);
  return any ? { date: any[0], kind: "embedded" } : null;
}

/**
 * IDEMPOTENCE GUARD. Re-running the split over an ALREADY-SPLIT file is
 * DESTRUCTIVE, not merely wasteful, and it fails silently-looking:
 *   1. every index row (`- 2026-07-31 — title … → ARCHIVE`) matches
 *      LEGACY_ENTRY, so the index is re-parsed as ~N new "entries";
 *   2. MEMORY-ARCHIVE.md is written with `writeFileSync`, so the previous
 *      archive is OVERWRITTEN — permanently destroying every body already
 *      moved there (measured: a 2nd run on one expert's memory reported
 *      49 entries instead of 35 and would have dropped 21 real bodies);
 *   3. conservation still reports OK, because it only checks the run's OWN
 *      inputs against its own outputs — it cannot see the archive it clobbered.
 * (3) is why this needs a guard rather than care: the safety check that would
 * otherwise catch a mistake is structurally blind to this one.
 */
const SPLIT_MARKER = "TWO-TIER MEMORY";
// The generated router's self-identification. SHARED with renderRouter's banner below so the two
// cannot drift — a hand-typed copy here would rot the moment the banner is reworded, and the
// thing that reads it (scanRouters) would then silently stop finding routers.
// NOT the bare SPLIT_MARKER: measured 2026-08-10, that matches 27 files under .claude/skills
// (the use-vs-mention heuristic, since removed) while this full sentence matches exactly
// the 10 real routers.
const ROUTER_BANNER_MARK = "this file is a ROUTER, not the ledger";

/**
 * ⛔ THE CORPUS-SIDE CONTROL. The guard above documents that a re-split
 * of an already-split file re-parses every index row as a new entry, and that
 * `checkLineConservation` CANNOT SEE IT ("it only checks the run's OWN inputs against its own
 * outputs"). That is the exact hazard the classic-shape adapter most risks, and the tool has
 * no instrument for it — conservation.ok returns TRUE over the corrupted set.
 *
 * Measured on three over-band experts: feeding an already-split hot file
 * to parseMemory yields parsed-dated == index-rows + real-bodies, EXACTLY —
 *   qa 255+13=268 · pe 111+13=124 · fd 165+9=174
 * and the run "successfully" produced a 487,083 B archive for qa-expert against a real
 * 426,160 B: 255 digest stubs duplicating bodies already present.
 *
 * This control compares the PARSE against the CORPUS rather than against itself. It is
 * deliberately independent of every existing check — a bookkeeping oracle cannot detect a
 * corrupt input set, because the corrupt set is what it books.
 */
export const DATED_HEADING_RE = /^## 20\d\d-\d\d-\d\d/;
// ⛔ THE STRANDED-ENTRY GUARD MUST MATCH EVERY ENTRY SPELLING THE FLEET WRITES, not just dates.
// Found 2026-08-30 (reproduced with a control): a "## L<n>" entry below a sharded
// router's marker was DELETED by --roll with rc=0 and "conservation: OK" — the dated form was
// refused, the fleet's commonest heading (a numbered lesson; meta carries 284 "## L<n>" against
// 884 dated) was not. Mirror of dup-durable-append-warn.sh's ENTRY_HEADING_RE, which always
// covered both but only WARNS — the enforcing layer was the narrow one. Used ONLY by the
// below-marker stray check; countDatedHeadings and the classic-archive first-entry find keep
// date semantics deliberately.
export const STRANDED_ENTRY_RE = /^## (20\d\d-\d\d-\d\d|L\d+)/;

/**
 * Count `## YYYY-MM-DD` headings in raw text. The corpus's own answer to "how many entries".
 *
 * ⛔ REVERTED 2026-08-09 — a commit widened this to also count LEGACY_ENTRY bullets outside a
 * `## Memory index` section, to clear a FALSE POSITIVE on one expert's memory (+48). Both halves
 * were wrong and a peer caught it at HEAD before it reached another dir:
 *
 *   (a) THE PREMISE WAS TOO BROAD. `parseMemory` promotes a legacy bullet to `isDated` ONLY
 *       inside a NON-DATED `## ` section — the dated branch `continue`s before the bullet scan.
 *       Where legacy bullets sit UNDER a dated heading the parser never promotes them, so a flat
 *       counter over-counts and the delta goes NEGATIVE. Measured:
 *       ux-copywriter -28, ux-design-pro -27, one more expert's memory -36. Three dirs that passed before, refusing after.
 *
 *   (b) THE INDEX-SKIP KEYED ON THE WRONG LITERAL, and this half is silent. It matched
 *       `## Memory index`; that expert's archive index is `## Archived index` — a name
 *       THIS TOOL'S OWN PRIOR ROLL produced. So on the very file the fix was written for, the 48
 *       rows counted on BOTH sides, agreed, and the guard returned ok:true. It stopped firing
 *       exactly where it was needed.
 *
 * ⚠️ AND THE SUITE WAS 79/79 GREEN THROUGH ALL OF IT — every arm reads the HOT file while both
 * deltas live in the ARCHIVE, which the block uses only as an existence predicate and never
 * parses. My own three-arm verification had the same blind spot: I measured the control on the
 * hot file, where `## Memory index` is the correct literal. The pass count never moved.
 *
 * ⛔ AND THAT LINE ORIGINALLY READ "a real fix must key on the parser's OWN promotion rule".
 * THAT IS ALSO WRONG — third wrong prescription on this function in one session, and it would
 * have been the worst of the three. Read the premise 30 lines above: this counter is
 * DELIBERATELY INDEPENDENT, and its crudeness IS the mechanism. The guard catches an
 * already-split file because the counter does not know what a bullet is while the parser does;
 * the disagreement is the entire signal. A counter that mirrors the parser's promotion rule
 * agrees with it BY CONSTRUCTION — including on the index-re-parsed corpus — so it can never
 * fire. That is precisely the "bookkeeping oracle cannot detect a corrupt input set" failure
 * this control exists to avoid, reached from the other side.
 *
 * THE TENSION IS STRUCTURAL AND DOES NOT LIVE IN THIS FUNCTION:
 *   counter dumb about bullets  -> catches the index case, false-positives on legacy corpora
 *   counter smart about bullets -> no false positive, BLIND to the index case (fatal)
 * All three of my attempts tuned the counter, which cannot resolve that. Candidate directions,
 * neither attempted: excise index sections STRUCTURALLY (a generation marker or position, never
 * a name — the name is generated by this same tool and already has two spellings) before either
 * side counts, so the dumb counter keeps working; or accept the legacy-corpus false positive as
 * a documented per-dir exemption and leave the guard alone.
 *
 * ⛔ AND THE SENTENCE THAT USED TO CLOSE THIS BLOCK — "the test arms must read the ARCHIVE.
 * Every arm reads the hot file" — IS ITSELF FALSE, and it is the most dangerous thing I wrote
 * today because it would pass a review while re-shipping the hole. That commit's own
 * message records "VERIFIED, three arms: archive 167==167 PASS". The archive arm EXISTED. Its
 * defect was POLARITY, not absence.
 *
 * THE DECISIVE MEASUREMENT (reproduced): on that expert's archive, the shipped
 * counter with the wrong literal reads delta 0 (the "PASS" I banked); the shipped counter with
 * the CORRECTED literal reads delta +48 and STILL REFUSES. So the fix's success criterion was
 * satisfiable ONLY BY ITS OWN BUG — "clear the +48" and "index rows must not count" are jointly
 * unsatisfiable inside any counter-side change, because parseMemory promotes those 48 rows no
 * matter what the counter skips. The passing arm was the bug's output.
 *
 * THE GENERAL FORM, which is the transferable part: an arm whose expected value was derived
 * from the WISH ("the false positive clears") rather than from the MECHANISM'S ARITHMETIC is a
 * member of the blind population by construction — it passes when the wish comes true for any
 * reason, including the bug. parsedDated is INVARIANT under a counter-side fix, so the design
 * itself predicted counter=119 vs parsed=167 => REFUSE +48. Reading the observed AGREE as
 * success required never having made that prediction. Pre-derive the expected delta per corpus
 * SHAPE before running anything; a REFUSE→AGREE flip means the counter newly counted exactly
 * |delta| lines, so name them and ask whether they are the class that must not count.
 *
 * ⚠️ AND THE CRUDENESS IS A SAFETY PROPERTY, which settles the design question categorically:
 * on an unenumerated index spelling the dumb heading-counter fails CLOSED (+K, refuses) and the
 * widened one fails OPEN (agrees, blind). The spelling set is OPEN — `## Archived index` was
 * hand-minted by a commit ("deviation ratified in-file"), not emitted by this tool — so no
 * name-keyed widening is safe at any literal. Keep the dumb counter.
 *
 * ⛔ AND THE +48 IS A TRUE POSITIVE, not a false one. Measured: all 48 sit in the
 * `## Archived index` region and 48/48 have a body-twin heading in
 * the same file; 0 orphans; 0 legacy bullets elsewhere in that archive. They are PROJECTIONS of
 * entries. Rolling would have written 48 digest-stub duplicates into the shards — the qa-expert
 * 487,083-vs-426,160 B corruption recorded above. Every counter-side fix silences a true
 * positive; a per-dir exemption authorizes the corruption.
 *
 * THE REAL FIX is upstream in reconstructClassic: the HOT side is index-excised before its
 * parity call and the ARCHIVE side is not — that asymmetry is the bug. Excise both, keyed on the
 * SEMANTIC property (every legacy row in the section has a date+title-prefix body-twin in the
 * same corpus), and REFUSE below 100% rather than silently reclassify.
 */
export function countDatedHeadings(text) {
  return text.split("\n").filter((l) => DATED_HEADING_RE.test(l)).length;
}

/**
 * Does the PARSE agree with the CORPUS about how many dated entries exist?
 *
 * ⚠️ AGREE is the expected reading, which makes this an expected-zero control — and an
 * expected-zero with no proof it can fire measures nothing (a peer caught exactly
 * this and it is the reason the positive-control arm exists in the test file). The needle is
 * free and already in the repo: run this against an UN-EXCISED already-split hot file and it
 * MUST disagree by exactly that file's index-row count. If that arm does not RED, this
 * function is decoration.
 */
export function checkEntryParity(rawText, opts = {}) {
  const { blocks } = parseMemory(rawText, { trailingDate: opts.trailingDate ?? false });
  const parsedDated = blocks.filter((b) => b.isDated).length;
  const headings = countDatedHeadings(rawText);
  return { ok: parsedDated === headings, parsedDated, headings, delta: parsedDated - headings };
}

/** Throwing wrapper — the shape the adapter will call before it writes anything. */
export function assertEntryParity(label, res) {
  if (!res.ok) {
    throw new Error(
      `ENTRY PARITY FAILED for ${label}: parse found ${res.parsedDated} dated entries but the ` +
      `corpus has ${res.headings} dated headings (delta ${res.delta > 0 ? "+" : ""}${res.delta}). ` +
      `A positive delta on an already-split file is the index being re-parsed as entries — ` +
      `excise [## Memory index .. next ## heading] before parsing. conservation.ok will NOT ` +
      `catch this; it books the corrupt set rather than detecting it.`,
    );
  }
}

// ---------------------------------------------------------------- utilities

const md5 = (s) => crypto.createHash("md5").update(s, "utf8").digest("hex");
const bytes = (s) => Buffer.byteLength(s, "utf8");

/**
 * Truncate at a word boundary, deterministically. cap<=0 ⇒ empty string.
 * `balanced` (digest cells only, never titles): also drop any emphasis or code marker whose
 * partner the cut left behind, so `with **bold phrase…` reads `with bold phrase…`.
 */
function truncate(text, cap, balanced = false) {
  const t = text.replace(/\s+/g, " ").trim();
  if (cap <= 0) return "";
  if (t.length <= cap) return t;
  const cut = t.slice(0, cap);
  const sp = cut.lastIndexOf(" ");
  const kept = (sp > cap * 0.6 ? cut.slice(0, sp) : cut).trimEnd();
  return (balanced ? sliceBalanced(t, 0, kept.length).trimEnd() : kept) + "…";
}

// ---------------------------------------------------------------- sanitizer

/**
 * Strip embedded task-notification XML that leaked into MEMORY files when an
 * agent's return envelope was appended verbatim. Uniform 3-part shape:
 *   <content line>...</result>      ← trailing tag glued to real prose
 *   <usage><subagent_tokens>…</usage>
 *   </task-notification>
 * Only these exact shapes are touched; surrounding entries are legitimate.
 */
export function sanitizeTaskNotificationXml(raw) {
  const lines = raw.split("\n");
  const out = [];
  let strippedTags = 0;
  let deletedLines = 0;
  for (const line of lines) {
    if (/^<usage><subagent_tokens>\d+<\/subagent_tokens>.*<\/usage>$/.test(line)) {
      deletedLines++;
      continue;
    }
    if (/^<\/task-notification>$/.test(line)) {
      deletedLines++;
      continue;
    }
    if (/<\/result>$/.test(line) && !/^\s*```/.test(line)) {
      out.push(line.replace(/<\/result>$/, ""));
      strippedTags++;
      continue;
    }
    out.push(line);
  }
  return { text: out.join("\n"), strippedTags, deletedLines };
}

// ------------------------------------------------------------------- parser

/**
 * Split a MEMORY.md into { preamble, blocks[] }.
 * A block starts at a top-level `## ` heading that is NOT inside a code fence.
 * Date blocks carry .date; everything else is a non-date section that stays
 * in the hot file verbatim.
 */
export function parseMemory(raw, opts = {}) {
  const trailingDate = opts.trailingDate ?? false;
  const lines = raw.split("\n");
  const heads = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) inFence = !inFence;
    if (!inFence && ANY_H2.test(lines[i])) heads.push(i);
  }
  const preamble = lines.slice(0, heads.length ? heads[0] : lines.length).join("\n");
  const blocks = [];
  const push = (b) => blocks.push({ ...b, idx: blocks.length });

  for (let h = 0; h < heads.length; h++) {
    const start = heads[h];
    const end = h + 1 < heads.length ? heads[h + 1] : lines.length;
    const headingLine = lines[start];
    const hd = headingDate(headingLine, trailingDate);

    if (hd) {
      push({
        isDated: true,
        legacy: false,
        date: hd.date,
        heading: headingLine,
        title:
          hd.kind === "leading"
            ? headingLine
                .slice(3)
                .replace(/^20\d\d-\d\d-\d\d/, "")
                .replace(/^\s*[—–\-:•|]?\s*/, "")
            : // Embedded form: the date is already the row's first column, so drop a
              // trailing `(YYYY-MM-DD)` rather than echoing it back inside the title.
              headingLine.slice(3).replace(/\s*\(20\d\d-\d\d-\d\d\)\s*$/, "").trim(),
        text: lines.slice(start, end).join("\n"),
        body: lines.slice(start + 1, end).join("\n"),
      });
      continue;
    }

    // Non-date section: split off any LEGACY dated bullets it contains.
    const secLines = lines.slice(start, end);
    const bulletAt = [];
    let fence = false;
    for (let i = 0; i < secLines.length; i++) {
      if (FENCE.test(secLines[i])) fence = !fence;
      if (!fence && LEGACY_ENTRY.test(secLines[i])) bulletAt.push(i);
    }

    const residueEnd = bulletAt.length ? bulletAt[0] : secLines.length;
    const residue = secLines.slice(0, residueEnd).join("\n").replace(/\s+$/, "");
    if (residue.length) {
      push({
        isDated: false,
        legacy: false,
        date: null,
        heading: headingLine,
        title: headingLine.slice(3).trim(),
        text: residue,
        body: residue,
      });
    }

    for (let k = 0; k < bulletAt.length; k++) {
      const bStart = bulletAt[k];
      const bEnd = k + 1 < bulletAt.length ? bulletAt[k + 1] : secLines.length;
      const body = secLines.slice(bStart, bEnd).join("\n").replace(/\s+$/, "");
      const date = body.match(LEGACY_ENTRY)[1];
      const { title, rest } = splitLegacyBullet(body, date);
      const heading = `## ${date} — ${title}`;
      push({
        isDated: true,
        legacy: true,
        date,
        heading,
        title,
        // The synthesized heading is a NAVIGATION container only; `body` stays
        // byte-verbatim, so the conservation md5 is unaffected by it.
        text: `${heading}\n${body}`,
        body,
        digestText: rest,
      });
    }
  }
  return { preamble, blocks };
}

/**
 * Derive a title from a legacy dated bullet, deterministically: drop the bullet
 * marker + date prefix, then cut at the first `**` or `:` past position 8
 * (the shapes all close their title with one of those), else fall back to a
 * fixed-width slice. `rest` becomes the digest source so the index row does not
 * repeat the title back to itself.
 */
function splitLegacyBullet(body, date) {
  const firstLine = body.split("\n")[0];
  const after = firstLine
    .replace(LEGACY_ENTRY, "")
    .replace(/^\s*[\]]*\s*/, "")
    .replace(/^\s*[—–\-|:•]\s*/, "")
    .trim();
  const cand = [after.indexOf("**", 8), after.indexOf(":", 8)].filter((i) => i > 0);
  const cut = cand.length ? Math.min(...cand) : Math.min(after.length, MAX_TITLE);
  const title = after.slice(0, cut).replace(/[\s*—–\-|:]+$/, "").trim() || after.slice(0, MAX_TITLE);
  const rest = after.slice(cut).replace(/^[\s*:—–\-|]+/, "").trim();
  return { title, rest: rest || after };
}

/**
 * What a digest skips before its first sentence: bullets, quote and heading marks (the original
 * class, which also takes the `*`/`**` an emphasis opener shares with a bullet), then a numbered
 * list marker — `1.`, `1)`, a range `1-3.` — which the sentence cut below would otherwise return
 * as the WHOLE digest (`— 1-3.`).
 * A line with no numbered marker strips exactly as before.
 */
const DIGEST_LEAD = /^(?:[-*+>#\s]+|\d+(?:[-–]\d+)?[.)]\s+)+/;

/**
 * Pair the inline markers on ONE line: backtick code spans first (a run of N closes at the next
 * run of exactly N, CommonMark), then `*` / `_` emphasis runs outside code by the CommonMark
 * flanking rules, so an intraword `_` (snake_case) and a spaced `5 * 3` stay literal. Returns a
 * Map from a marker character's index to its partner's index; a marker absent from the map is
 * literal — the author's own unpaired `_DSC5535`, `utm_*` or `count(*)`, which no cut made — and so
 * is a backslash-escaped marker (`\*`), which CommonMark never reads as a delimiter.
 */
function markerPairs(line) {
  const partner = new Map();
  const pair = (a, b) => { partner.set(a, b); partner.set(b, a); };
  const escaped = (i) => { let n = 0; while (line[i - 1 - n] === "\\") n++; return n % 2 === 1; };
  const inCode = new Uint8Array(line.length);
  for (let i = 0; i < line.length; ) {
    if (line[i] !== "`" || escaped(i)) { i++; continue; }
    let j = i;
    while (line[j] === "`") j++;
    let k = j;
    let close = -1;
    while (k < line.length) {
      if (line[k] !== "`") { k++; continue; }
      let m = k;
      while (line[m] === "`") m++;
      if (m - k === j - i) { close = k; break; }
      k = m;
    }
    if (close === -1) { i = j; continue; }
    for (let n = 0; n < j - i; n++) pair(i + n, close + n);
    inCode.fill(1, i, close + (j - i));
    i = close + (j - i);
  }
  const ws = (c) => c === undefined || /\s/u.test(c);
  const punct = (c) => c !== undefined && /[\p{P}\p{S}]/u.test(c);
  const stack = [];
  for (let i = 0; i < line.length; ) {
    const ch = line[i];
    if ((ch !== "*" && ch !== "_") || inCode[i] || escaped(i)) { i++; continue; }
    let e = i;
    while (line[e] === ch && !inCode[e]) e++;
    const prev = line[i - 1];
    const next = line[e];
    const left = !ws(next) && (!punct(next) || ws(prev) || punct(prev));
    const right = !ws(prev) && (!punct(prev) || ws(next) || punct(next));
    const canOpen = ch === "*" ? left : left && (!right || punct(prev));
    const canClose = ch === "*" ? right : right && (!left || punct(next));
    const len = e - i;
    let at = i;
    if (canClose) {
      for (let k = stack.length - 1; k >= 0 && at < e; ) {
        const o = stack[k];
        const rule3 = (o.both || (canOpen && canClose)) && (o.len + len) % 3 === 0 && !(o.len % 3 === 0 && len % 3 === 0);
        if (o.ch !== ch || rule3) { k--; continue; }
        const n = e - at >= 2 && o.rem >= 2 ? 2 : 1;
        for (let x = 0; x < n; x++) pair(o.s + o.rem - 1 - x, at + x);
        o.rem -= n;
        at += n;
        stack.length = o.rem > 0 ? k + 1 : k; // openers between the pair are literal now
        k = stack.length - 1;
      }
    }
    if (at < e && canOpen) stack.push({ ch, s: at, rem: e - at, len, both: canOpen && canClose });
    i = e;
  }
  return partner;
}

/** `line.slice(from, to)` minus every marker whose partner the slice cut off. */
function sliceBalanced(line, from, to) {
  const partner = markerPairs(line);
  let out = "";
  for (let i = from; i < to; i++) {
    const p = partner.get(i);
    if (p !== undefined && (p < from || p >= to)) continue;
    out += line[i];
  }
  return out;
}

/** 1 at every index inside a paired backtick code span — a `.`/`?` there (`x ?? y`) ends no sentence. */
function codeMask(line) {
  const partner = markerPairs(line);
  const mask = new Uint8Array(line.length);
  for (let i = 0; i < line.length; i++) {
    const p = partner.get(i);
    if (line[i] === "`" && p > i) { mask.fill(1, i, p + 1); i = p; }
  }
  return mask;
}

/**
 * A first line that is ONE `_…_` span is a provenance aside, never the subject: it was the digest
 * of 199 of 2,078 rows in the regenerated routers ("_Returned by agent `…` on …_").
 */
const isProvenanceLine = (t) => t[0] === "_" && t.length > 2 && markerPairs(t).get(0) === t.length - 1;

/**
 * Deterministic digest: first sentence of the body + any Revisit-shaped line. Every cut it makes
 * — the lead strip, the sentence end, the `**Revisit**:` label — can leave half of a `**…**` or a
 * code span behind (`Context read.** Previous …`), so each part is sliced with `sliceBalanced`:
 * a marker whose partner fell outside is dropped, the convention the lead strip already follows.
 */
export function digestOf(block) {
  // Legacy bullets carry their title INSIDE the body, so digesting the raw body
  // would echo the title column back at itself; `digestText` is the remainder.
  const lines = (block.digestText ?? block.body).split("\n");
  let firstLine = "";
  let aside = "";
  let inFence = false;
  for (const l of lines) {
    if (FENCE.test(l)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (l.trim().length === 0) continue;
    if (isProvenanceLine(l.trim())) { aside ||= l.trim(); continue; }
    firstLine = l.trim();
    break;
  }
  firstLine ||= aside; // a body that is ONLY its provenance line still digests to it
  const lead = DIGEST_LEAD.exec(firstLine)?.[0].length ?? 0;
  const stripped = firstLine.slice(lead);
  const inCode = codeMask(firstLine);
  const ends = [...stripped.matchAll(/[.!?](?=\s|$)/g)].filter((m) => !inCode[lead + m.index]);
  const cut = ends.length ? stripped.slice(0, ends[0].index + 1) : stripped;
  const sentence = sliceBalanced(firstLine, lead, lead + cut.length);
  const revisit = lines
    .filter((l) => REVISIT_LINE.test(l))
    .map((l) => {
      const t = l.trim();
      return sliceBalanced(t, REVISIT_LINE.exec(t)[0].length, t.length).trim();
    })
    .join(" ");
  return { sentence, revisit };
}

/**
 * The digest cell of one index row — sentence, then `Revisit:` — each truncated to `cap` with any
 * marker the truncation orphaned dropped. Exported, and the ONLY renderer: the classic index row
 * and the router digest row both call it, so the self-test exercises the shipping path.
 */
export function renderDigest(d, cap) {
  const parts = [truncate(d.sentence, cap, true)];
  if (d.revisit) parts.push(`Revisit: ${truncate(d.revisit, cap, true)}`);
  return parts.filter(Boolean).join(" | ");
}

function indexRow(block, cap, where) {
  const digest = renderDigest(digestOf(block), cap);
  const title = truncate(block.title, MAX_TITLE) || "(untitled)";
  return `- ${block.date} — ${title}${digest ? ` — ${digest}` : ""} → ${where}`;
}

// -------------------------------------------------------------------- split

/**
 * THE conservation oracle. Exported and called by BOTH splitMemory and the
 * self-test's RED control, so the control exercises the shipping code rather
 * than a copy of it — a re-implemented guard proves only that the copy works.
 *
 * `before` = every dated block parsed from the input.
 * `after`  = every dated block the split placed somewhere (hot ∪ archive).
 */
export function checkConservation(before, after) {
  const key = (b) => `${b.idx} ${b.heading}`;
  const originalHeadings = before.map(key);
  const splitHeadings = after.map(key);
  const setOrig = new Set(originalHeadings);
  const setSplit = new Set(splitHeadings);
  const duplicated = splitHeadings.length !== setSplit.size;
  const missing = originalHeadings.filter((h) => !setSplit.has(h)).length;
  const extra = splitHeadings.filter((h) => !setOrig.has(h)).length;

  // Bodies concatenated in ORIGINAL DOCUMENT ORDER on both sides, so a
  // chronological re-ordering in the output cannot mask a lost or edited body.
  const cat = (arr) => [...arr].sort((a, b) => a.idx - b.idx).map((b) => b.body).join("\n \n");
  const md5Before = md5(cat(before));
  const md5After = md5(cat(after));

  return {
    ok: !duplicated && missing === 0 && extra === 0 && md5Before === md5After,
    duplicated,
    missing,
    extra,
    md5Before,
    md5After,
    entriesTotal: before.length,
  };
}

/** Throws unless conservation holds. The single gate every write passes through. */
export function assertConservation(label, c) {
  if (c.ok) return;
  throw new Error(
    `CONSERVATION FAILED for ${label}: missing=${c.missing} extra=${c.extra} ` +
      `duplicated=${c.duplicated} md5 ${c.md5Before} != ${c.md5After}`,
  );
}

/**
 * Pure function: raw text in, { hot, archive, stats } out. Writes nothing.
 * Exported so --self-test exercises the REAL code path, not a re-implementation.
 */
export function splitMemory(raw, opts = {}) {
  const target = opts.target ?? TARGET_BYTES;
  const hardCap = opts.hardCap ?? HARD_CAP_BYTES;
  const { preamble, blocks } = parseMemory(raw, { trailingDate: opts.trailingDate ?? false });
  const dated = blocks.filter((b) => b.isDated);
  const nonDated = blocks.filter((b) => !b.isDated);

  if (dated.length === 0) throw new Error("no dated entries found — refusing to split");

  // Chronological presentation order; original index breaks same-day ties so
  // the file's own ordering is preserved within a date.
  const chrono = [...dated].sort((a, b) =>
    a.date === b.date ? a.idx - b.idx : a.date < b.date ? -1 : 1,
  );

  const banner =
    "<!-- TWO-TIER MEMORY — full bodies of older entries live in MEMORY-ARCHIVE.md (same dir).\n" +
    "     The index below covers EVERY entry; a row marked → ARCHIVE has its full body there.\n" +
    "     Grep BOTH files (or the whole skill dir) before citing absence. -->";

  const fixedHead = [preamble.replace(/\s+$/, ""), banner, ...nonDated.map((b) => b.text.replace(/\s+$/, ""))]
    .filter((s) => s.length > 0)
    .join("\n\n");

  // --- pick the digest cap: largest ladder rung whose full index still fits.
  const indexHeading = "## Memory index — every entry, oldest first";
  let cap = 0;
  let indexBytesAt = 0;
  for (const candidate of DIGEST_LADDER) {
    const rows = chrono.map((b) => indexRow(b, candidate, "ARCHIVE"));
    const size = bytes(`${fixedHead}\n\n${indexHeading}\n\n${rows.join("\n")}\n`);
    if (size <= hardCap - RESERVE_BYTES) {
      cap = candidate;
      indexBytesAt = size;
      break;
    }
    cap = candidate; // keep descending; last rung (0) is the floor
    indexBytesAt = size;
  }

  // --- fill recent-full newest-backward while the WHOLE hot file fits target.
  const recentHeading = "## Recent entries (full text)";
  const keptIdx = new Set();
  let running = indexBytesAt + bytes(`\n${recentHeading}\n`);
  for (let i = chrono.length - 1; i >= 0; i--) {
    const cost = bytes(`\n${chrono[i].text.replace(/\s+$/, "")}\n`);
    if (running + cost > target) break;
    running += cost;
    keptIdx.add(chrono[i].idx);
  }

  const kept = chrono.filter((b) => keptIdx.has(b.idx));
  const archived = chrono.filter((b) => !keptIdx.has(b.idx));

  const rows = chrono.map((b) => indexRow(b, cap, keptIdx.has(b.idx) ? "below" : "ARCHIVE"));

  const hotParts = [fixedHead, `${indexHeading}\n\n${rows.join("\n")}`];
  if (kept.length) {
    hotParts.push(`${recentHeading}\n\n${kept.map((b) => b.text.replace(/\s+$/, "")).join("\n\n")}`);
  }
  const hot = `${hotParts.join("\n\n")}\n`;

  const archive = archived.length
    ? `${ARCHIVE_HEADER}\n\n${archived.map((b) => b.text.replace(/\s+$/, "")).join("\n\n")}\n`
    : `${ARCHIVE_HEADER}\n`;

  // ------------------------------------------------------- conservation check
  const conservation = {
    ...checkConservation(dated, [...kept, ...archived]),
    entriesHot: kept.length,
    entriesArchived: archived.length,
  };

  return {
    hot,
    archive,
    dated,
    kept,
    archived,
    conservation,
    stats: {
      beforeBytes: bytes(raw),
      hotBytes: bytes(hot),
      archiveBytes: bytes(archive),
      digestCap: cap,
      nonDatedSections: nonDated.length,
      ...conservation,
    },
  };
}

// =======================================================================
// SHARDED MODE — router + date-named shards + extracted live registers
// =======================================================================

// ⛔ SHARD_CAP clears the 256 KB Read HARD-ERROR cap and does NOT clear the
// partial-view band named on the very next line — 3.4x over it. A shard at this
// cap is REFUSED by warn-large-tracker-read.sh ARM B, which hands back paging
// coordinates rather than a silent oldest-first prefix. The comment here
// read "every archive-side file must fit a whole Read" until 2026-08-06, with its
// own refutation on the following line the entire time; that false property then
// propagated verbatim into both routers, meta/SKILL.md and always-loaded
// active-recall.md. ⛔ NOTHING MAY CLAIM A SHARD READS WHOLE — the directive STANDS,
// and so does the CAP. What was WRONG is the REASON written
// here to justify it, which is the half the next reader inherits.
//
// ⛔ THE STRUCK ARGUMENT, AND ITS ONE CAUSE. This note read "Across 242 session
// transcripts, NONE does ... with zero unbounded ATTEMPTS", concluding the cap "costs
// nothing, because nothing wants to" and that band-compliance "buys a property nothing
// consults". All of that is false, by a single mechanism: sub-agent transcripts do not
// live in `projects/<project>/*.jsonl`. They live one directory down, at
// `projects/<session-id>/subagents/agent-*.jsonl`, which a `*.jsonl` glob cannot reach.
// Re-measured 2026-09-13 — top-level 242 files / 6.8 GB, the EXCLUDED plane 11,266
// files / 7.7 GB: MORE BYTES than the population that was sampled. The same Read
// predicate over that plane returns 349 shard-family Read blocks — 309 bounded and
// 40 UNBOUNDED, of which ARM B DENIED 14 and 26 were SERVED. So the attempts exist;
// the defence that a denial still leaves a tool_use record was CORRECT; the records
// were simply off-plane. (A wider family predicate reads 384 / 56 / 42 served, and the two
// agree to the unit on the 14 denials, which is the load-bearing one.)
// Those 14 ARE consultation of single-Read-ability — a seat asking and being refused —
// so "nothing consults" was refuted by the very instrument it appealed to. Sharding
// WATCH-TIER to the band the same day refuted it again.
//
// ⛔ AND THE DEMAND IS DOCTRINE-GENERATED, SO IT WILL NOT DECAY. `_agent-primer.md:111`
// instructs every dispatched sub-agent: "Attempt the WHOLE-FILE `Read` first ... do not
// pre-emptively page." The always-loaded dispatch primer MANUFACTURES the behaviour the
// struck sentence said did not exist, on the one plane the probe could not see.
//
// ⭐ WHY THE CAP ACTUALLY STAYS — the inverse of what was written. The premise is not
// self-sustaining; it is PINNED by ARM B's hand-maintained case list (the
// `KIND=skillmem` arms near warn-large-tracker-read.sh:238), and that list has already
// lost coverage once, for three of the four families — the hook says so itself at :219,
// "the CHANGELOG/WATCH-TIER/ADOPTION-QUEUE siblings lost coverage the moment they left
// MEMORY.md." So the margin does not insure against an absent appetite. It insures an
// ARM-B COVERAGE REGRESSION against a MEASURED STANDING DEMAND — a better argument for
// keeping the cap than the one it replaces.
//
// ⚠️ TWO FLOORS, BOTH UNDER-COUNTING, NEITHER NAMED HERE BEFORE. (1) The Bash leg:
// 8,744 shard-naming command lines, 0 whole-file reads, and that zero is not vacuous —
// the same predicate finds 1,763 bare `cat <file>` reads elsewhere and never one on a
// shard — but ~331 open a file through a VARIABLE, so their targets are unresolvable.
// (2) The predicate is name-keyed on shards that exist NOW, while THIS FILE renames
// shards on every roll (8 in one roll, an April one among them), so every read of a
// since-renamed shard is invisible to it.
//
// ⛔ THE COST FIGURE WAS FOUR-FOLD STALE. "~54 shards" was derived on a ~3 MB corpus.
// Re-derived 2026-09-13 across the four families: 94 shards, 12,891,894 B. Re-packing
// per family group at ROUTER_CAP_BYTES gives a FLOOR of 242, and ~295 at the under-fill
// this corpus actually shows — the same computation predicts 77 against today's real
// 94. So the RATIO the note claimed survives at ~2.6-3.1x; only its absolute number
// rotted, and each added boundary still re-flows on the next roll. DERIVE it before
// citing it — it has rotted once. ⛔ AND NAME THE PREDICATE WHEN YOU RE-DERIVE: "the four
// families" is a description, not a predicate, and the gap is measurable. An
// ad-hoc prefix match over the same four names read 103 / 13,162,023 B against this note's
// 94 / 12,891,894 B ON THE SAME DAY — a membership delta, not corpus drift, and without the
// predicate written down the next re-derivation reads its own membership delta as fresh rot,
// which is the failure this paragraph exists to prevent. The figures above are:
//   find .claude/skills -type f \( -name 'MEMORY-ARCHIVE-*.md' -o -name 'CHANGELOG-ARCHIVE-*.md'
//        -o -name 'RULES-SHARD-*.md' -o -name 'WATCH-TIER*.md' \)
// grouped by (directory, family) for the re-pack arithmetic — packing is PER-FAMILY, never one
// global pack, and a global division under-reports (floor 225 vs the per-group 242).
// *This note once called the cap an open question and barred any claim that a shard Reads
// whole until it was settled: the QUESTION is closed, the DIRECTIVE is not.*
export const SHARD_CAP_BYTES = 200_000; // under the 256 KB hard-error cap; OVER the read band
export const ROUTER_CAP_BYTES = 57_500; // SKILL_CEILING_BYTES — the silent-truncation band
/** Header budget reserved per shard so packing cannot overshoot the cap via its own header. */
const SHARD_HEADER_RESERVE = 1_200;
// Growth headroom for a LIVE register's parts, on top of the header reserve. Archive shards do
// not need this — they are closed and never grow — but a register is appended to daily, so a part
// packed to the read cap is one edit away from being deniable. Sized against the register's own
// recorded ~4 KB/day: ~6 KB buys a day and a half rather than an hour.
const REGISTER_MIN_HEADROOM = 6_000;

/**
 * THE BOUNDARY BETWEEN GENERATED AND VERBATIM BYTES, in-band and machine-readable.
 *
 * Every reconstruction check in this mode reduces to "strip the generated header, concatenate
 * what is left in document order". That strip must be EXACT and it must be performable by a
 * reader that does not trust this tool — so the boundary is an explicit sentinel LINE rather
 * than a byte count the tool reports about itself.
 *
 * Two shapes, because the two sides put their verbatim region on opposite ends:
 *   archive-side (shards / registers / legacy halves) — generated header FIRST, then
 *                 GEN_END, then exactly ONE blank line, then verbatim to EOF.
 *   router        — verbatim preamble FIRST, then ROUTER_END, then everything generated.
 * A `## `-anchored rule was rejected: the second legacy half legitimately begins mid-list
 * (`152. **…**`) with no heading of its own, so "first `## ` line" would eat 71 real entries.
 */
const GEN_END = "<!-- GENERATED HEADER ENDS — every line below is VERBATIM from the source MEMORY.md -->";
const GEN_END_RE = /^<!-- GENERATED HEADER ENDS/;
const ROUTER_END = "<!-- ROUTER PREAMBLE ENDS — every line above is VERBATIM from the source MEMORY.md; everything below is GENERATED -->";
const ROUTER_END_RE = /^<!-- ROUTER PREAMBLE ENDS/;
/**
 * Document-order key, carried in-band.
 *
 * ⛔ IT DELIBERATELY DOES NOT CARRY THE PART **TOTAL**. The first version wrote
 * `PART 03/20`, which made every file's header a function of the layout SIZE: adding one
 * shard bumped `/20` -> `/25` and rewrote all 20 existing files byte-for-byte. Measured on
 * the roll test — 19 "changed" files whose CONTENT was identical. On a git-tracked tree that
 * is a multi-MB diff on every roll, which destroys the one property greedy file-order
 * packing exists to buy: an append must not touch anything before the current shard.
 * The authoritative ordered file list lives in the ROUTER's manifest (regenerated every
 * roll anyway), and `loadLayout` validates against it — strictly stronger than a total,
 * because it also catches a missing TAIL file, a rename, and an extra file.
 */
const PART_RE = /^<!-- PART (\d+) · (\S+) /;
/**
 * The owning-router declaration, read BACKWARD-TOLERANTLY: a header written before this field existed has
 * no `· router:` field, so this returns null and the caller falls back to the sibling scan.
 * Anchored on ` -->` so a descriptor containing the word cannot be mistaken for the field.
 */
const PART_ROUTER_RE = /· router: (\S+) -->\s*$/;
export function partRouterOf(text) {
  const line = text.split("\n").find((l) => PART_RE.test(l));
  if (!line) return null;
  const m = PART_ROUTER_RE.exec(line);
  return m ? m[1] : null;
}
/** The router's manifest row — the authoritative document order. */
const MANIFEST_ROW_RE = /^\| (\d+) \| `([^`]+)` \|/;

/** Declaration-position L# read (display only — the authoritative count is `scan()`). */
const L_IN_HEADING = /^## (?:20\d\d-\d\d-\d\d\s*[—–-]\s*)?L(\d+)/;

const byteLenOfLines = (arr) => bytes(arr.join("\n"));

/**
 * The DEFAULT meta layout.
 * Passed as an option so the unit fixture can exercise the same code with its own
 * section names instead of a parallel implementation.
 */
export const META_LAYOUT = {
  named: [
    {
      headingPrefix: "## Watch-tier register",
      file: "WATCH-TIER.md",
      note: "LIVE REGISTER — working state, not history. Entries are added and promoted here directly.",
      // ⛔ SHARDED SINCE 2026-09-13, reversing the earlier rule that a named live register is
      // kept WHOLE and the REGISTER-OVER-CAP refusal built on top of it.
      // That exemption was right about the COST of cutting a live register and wrong about the
      // alternative it assumed: it left `--heal` refusing the WHOLE meta router for as long as
      // the register sat over cap, and the prescribed exit (the AGE RULE prune) had already
      // returned ZERO cuttable rows once — 267 rows, every one either promote-due
      // (`occurrences:` >= 2, never age-retired) or inside the 60-day horizon — so the refusal
      // had no reachable exit and the router stayed frozen AND stale. Measured at the change:
      // 217,764 B against a 200,000 B cap.
      //
      // ⛔ `partCap` IS `ROUTER_CAP_BYTES`, NOT `SHARD_CAP_BYTES`, AND THE GAP IS THE POINT.
      // A 200,000 B part would clear the roll gate and still be DENIED by
      // `warn-large-tracker-read.sh` ARM B on an unbounded read — cap satisfied, file still
      // unreadable, i.e. exactly the state this split exists to end. An archive shard may sit
      // over the read band — and the note at SHARD_CAP_BYTES says why that is INSURANCE and
      // not a free ride: 40 unbounded shard reads on the sub-agent plane, 14 of them refused.
      // A LIVE register differs in KIND, not degree — it is read and edited BY HAND at a known
      // path, so its parts are sized to READ WHOLE rather than to be paged. Same reasoning the
      // RULES split used when it packed to a fill cap.
      rowRe: /^- /,
      partCap: ROUTER_CAP_BYTES,
    },
    {
      headingPrefix: "## Adoption Queue",
      file: "ADOPTION-QUEUE.md",
      note: "LIVE REGISTER — the shipping roadmap. Rows are edited in place as items ship.",
    },
  ],
  legacy: [
    {
      headingPrefix: "## Lessons (generalized rules",
      basename: "MEMORY-ARCHIVE-legacy-lessons",
      entryRe: /^(\d+)\.\s+\*\*/,
      parts: 2,
      note: "CLOSED ERA — the legacy list-form lessons. Never appended to.",
    },
  ],
};

// ------------------------------------------------------------ exact parser

/**
 * Byte-exact `## ` segmentation. Distinct from `parseMemory`, which trims trailing
 * whitespace and re-shapes legacy bullets for the DIGEST — lossy by design and therefore
 * unusable as the basis of a conservation proof. Here nothing is trimmed and nothing is
 * re-shaped, so the invariant is an ARRAY identity:
 *     [...preambleLines, ...sections.flatMap(s => s.lines)]  ===  raw.split("\n")
 */
export function parseSectionsExact(raw) {
  const lines = raw.split("\n");
  const heads = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) inFence = !inFence;
    if (!inFence && ANY_H2.test(lines[i])) heads.push(i);
  }
  const preambleLines = lines.slice(0, heads.length ? heads[0] : lines.length);
  const sections = heads.map((start, i) => {
    const end = i + 1 < heads.length ? heads[i + 1] : lines.length;
    return {
      idx: i,
      startLine: start + 1,
      endLine: end,
      heading: lines[start],
      lines: lines.slice(start, end),
    };
  });
  return { lines, preambleLines, sections };
}

/**
 * A date for every section, so every shard can be named.
 * leading `## YYYY-MM-DD` -> embedded date anywhere in the heading -> CARRY FORWARD from the
 * previous section -> back-fill the leading run from the first date that resolved.
 * Carry-forward is sound because file order IS append order; measured 2026-08-06, 49 of 934
 * meta sections carry no date in their heading at all.
 */
export function resolveSectionDates(sections) {
  const out = sections.map((s) => headingDate(s.heading, true)?.date ?? null);
  let prev = null;
  for (let i = 0; i < out.length; i++) {
    if (out[i]) prev = out[i];
    else out[i] = prev;
  }
  const firstKnown = out.find((d) => d) ?? "unknown";
  for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = firstKnown;
  return out;
}

// ------------------------------------------------- line-level conservation

/**
 * THE SHARDED-MODE CONSERVATION ORACLE. The single-archive `checkConservation` compares
 * ENTRY BODIES; that cannot see the preamble, non-date sections, or an intra-section cut,
 * all three of which this mode performs. So the unit here is the LINE, and the property is
 * total: every line of the source lands in exactly one output piece, in order, unedited.
 *
 * `pieces` = [{ order: [sectionIdx, partIdx], lines: [...] }]. Sorted by `order`, flattened,
 * the result must be the source line array — checked three ways so one bug cannot pass:
 *   md5 of the joined text (content + order), line COUNT (loss/duplication), and a SORTED
 *   line multiset (a pure reordering that somehow survived the first two).
 */
export function checkLineConservation(sourceLines, pieces) {
  const sorted = [...pieces].sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1]);
  const rebuilt = sorted.flatMap((p) => p.lines);
  const md5Before = md5(sourceLines.join("\n"));
  const md5After = md5(rebuilt.join("\n"));
  const multisetBefore = md5([...sourceLines].sort().join("\n"));
  const multisetAfter = md5([...rebuilt].sort().join("\n"));
  const firstDiff = (() => {
    const n = Math.min(sourceLines.length, rebuilt.length);
    for (let i = 0; i < n; i++) if (sourceLines[i] !== rebuilt[i]) return i;
    return sourceLines.length === rebuilt.length ? -1 : n;
  })();
  return {
    ok: md5Before === md5After && multisetBefore === multisetAfter && sourceLines.length === rebuilt.length,
    md5Before,
    md5After,
    multisetBefore,
    multisetAfter,
    linesBefore: sourceLines.length,
    linesAfter: rebuilt.length,
    firstDivergentLine: firstDiff < 0 ? null : firstDiff + 1,
    pieces: pieces.length,
  };
}

export function assertLineConservation(label, c) {
  if (c.ok) return;
  throw new Error(
    `LINE CONSERVATION FAILED for ${label}: lines ${c.linesBefore} -> ${c.linesAfter}, ` +
      `md5 ${c.md5Before} != ${c.md5After}, multiset ${c.multisetBefore} vs ${c.multisetAfter}, ` +
      `first divergence at source line ${c.firstDivergentLine}`,
  );
}

// ------------------------------------------------------ header / verbatim IO

/**
 * ⛔ THE PART HEADER DECLARES ITS OWNING ROUTER. Before this it
 * named its part number, ITSELF, its dates and its section count — everything except the one
 * fact a reader needs, so `loadLayout` had to INFER ownership by scanning every sibling `.md`
 * for a prose marker. Measured on this repo: 26 files contain SPLIT_MARKER and exactly ONE is
 * a real router (20 manifest rows); the other 25 are classic expert memories that merely
 * MENTION the string. A use-vs-mention heuristic guarding a corpus-destroying operation.
 * `routerName` is REQUIRED — an optional parameter here is what produced the hardcoded
 * "MEMORY.md" that had to be fixed on the write path.
 */
function renderArchiveSide({ head, partNo, file, descriptor, verbatimLines, routerName }) {
  // ⛔ VALIDATE THE ARTIFACT, NOT THE ARGUMENT. The previous version of this
  // guard threw only on a FALSY routerName, which its only caller can never pass — mutation-
  // measured DECORATIVE (deleted -> 44/44 GREEN). Worse, its docblock claimed the optionality
  // had been removed when it had only been RELOCATED one layer up, and that relocated default
  // is exactly what broke `--shard` for every non-MEMORY source. Three separate holes, one
  // cause: the guard checked an input instead of the thing it produces.
  //   (a) `descriptor` interpolates a corpus heading, so a heading containing
  //       "· router: EVIL.md -->" forged the field — partRouterOf returned "EVIL.md".
  //   (b) `(\S+)` cannot capture "My Router.md", so a whitespace name read as
  //       null, which the write guard treats as "legacy, no opinion" and PASSES. `null` was
  //       carrying two meanings — LEGACY and MALFORMED — and only one of them is safe.
  if (typeof routerName !== "string" || !routerName.trim() || /\s/.test(routerName) || routerName.includes("/") || routerName.includes("..")) {
    throw new Error(`renderArchiveSide: routerName must be a bare whitespace-free filename, got ${JSON.stringify(routerName)}`);
  }
  if (/-->/.test(descriptor) || /· router:/.test(descriptor)) {
    throw new Error(`renderArchiveSide: descriptor would forge or truncate the header comment: ${JSON.stringify(descriptor)}`);
  }
  const header = [
    head,
    "",
    `<!-- PART ${String(partNo).padStart(2, "0")} · ${file} · ${descriptor} · router: ${routerName} -->`,
    GEN_END,
    "",
  ];
  const text = [...header, ...verbatimLines].join("\n");
  // ROUND TRIP, asserted where the artifact is MADE: the header must read back as the router we
  // were given. This is what makes the declaration trustworthy downstream; a validated ARGUMENT
  // never could (a better fix than patching the character class).
  const readBack = partRouterOf(text);
  if (readBack !== routerName) {
    throw new Error(`renderArchiveSide: header round-trip FAILED — wrote router ${JSON.stringify(routerName)} but it reads back as ${JSON.stringify(readBack)}`);
  }
  return text;
}

/**
 * Strip the generated header. Deliberately tolerant of NOTHING: an output whose sentinel is
 * missing or mis-shaped throws rather than silently returning a prefix of itself — a lenient
 * reader here would let `--roll` reconstruct a corpus that is quietly short.
 */
export function readVerbatim(fileText) {
  const lines = fileText.split("\n");
  const routerAt = lines.findIndex((l) => ROUTER_END_RE.test(l));
  if (routerAt >= 0) return lines.slice(0, routerAt);
  const genAt = lines.findIndex((l) => GEN_END_RE.test(l));
  if (genAt < 0) throw new Error("readVerbatim: no GENERATED HEADER ENDS / ROUTER PREAMBLE ENDS sentinel");
  if (lines[genAt + 1] !== "") {
    throw new Error(`readVerbatim: expected exactly one blank line after the sentinel, got ${JSON.stringify(lines[genAt + 1])}`);
  }
  return lines.slice(genAt + 2);
}

// --------------------------------------------------------------- the split

/**
 * Pure function: raw text in, a whole multi-file layout out. Writes nothing.
 *
 * Routing, in file order, one pass:
 *   named   -> its own live-register file (short pointer header, NOT the cold-store header)
 *   legacy  -> N Read-able parts cut at an ENTRY boundary nearest each k/N byte mark
 *   default -> greedily packed into date-named shards <= shardCap
 *
 * Greedy packing in file order is what makes the layout APPEND-STABLE: appending at the end
 * cannot change the membership, bytes, or NAME of any earlier shard, so `--roll` renames
 * nothing and citations do not rot. That property is asserted in the unit tests.
 */
export function splitMemorySharded(raw, opts = {}) {
  const shardCap = opts.shardCap ?? SHARD_CAP_BYTES;
  const routerCap = opts.routerCap ?? ROUTER_CAP_BYTES;
  const layout = opts.layout ?? META_LAYOUT;
  const archiveBase = opts.archiveBasename ?? "MEMORY-ARCHIVE";
  // The shards must be able to name their owner. Defaulted (not required) here because
  // every existing caller splits a MEMORY layout; `writeLayout`/`rollLayout` pass theirs through.
  const routerName = opts.routerName ?? "MEMORY.md";
  // The dir this router will LIVE IN, so its printed roll command names its OWN skill.
  // ⛔ The fallback is a visible placeholder ON PURPOSE. This was a hardcoded
  // `.claude/skills/meta` in the prose template, so all 7 rolled routers instructed their
  // reader to roll META — and a reader lands in the router precisely when working out how to
  // roll. A wrong-but-PLAUSIBLE default is what makes a stale example executable; an obvious
  // placeholder fails loudly at the eyeball instead. (Caught 2026-08-09, verified 7/7.)
  // Normalized, NOT raw: the value lands verbatim in the router's Rolling line, so an
  // absolute-vs-relative invocation would otherwise write two different routers for one
  // directory. See repoRelativeDir's header for the measurement.
  const skillDir = repoRelativeDir(opts.skillDir ?? null);
  /** Re-anchor a legacy spec's hardcoded basename onto the ACTIVE archive base.
   *  Identity when archiveBase is the default — the 24 shipped splits are untouched. */
  const legacyBasename = (specBase, base) =>
    specBase.startsWith("MEMORY-ARCHIVE") ? base + specBase.slice("MEMORY-ARCHIVE".length) : specBase;
  const warnings = [];

  const { lines, preambleLines, sections } = parseSectionsExact(raw);
  if (!sections.length) throw new Error("no `## ` sections found — refusing to shard");
  const dates = resolveSectionDates(sections);

  // ---- route + pack, ONE pass in strict document order -------------------
  //
  // ⛔ EVERY OUTPUT FILE MUST BE A **CONTIGUOUS** RUN OF SECTIONS. An extracted register
  // or legacy block is therefore a hard PACK BOUNDARY: the open shard is FLUSHED before it
  // and a new one starts after it.
  //
  // The first version of this routing skipped extracted sections and kept packing "around"
  // them, which left shard 1 holding sections from both BEFORE and AFTER `## Lessons`.
  // Every per-section check still passed — each line was in exactly one file, and pieces
  // sorted by section index rebuilt the source perfectly — while the property that actually
  // matters was false: concatenating the FILES in part order produced a reordered corpus.
  // `reconstructFromLayout` (and any human doing `cat MEMORY-ARCHIVE-*.md`) would have
  // silently yielded a scrambled ledger, and `--roll` would have written it back.
  // Caught by an independent reconstruction, NOT by the oracle — so the oracle below was
  // re-keyed to FILE-level pieces in PART order, which is the property being relied on.
  const budget = shardCap - SHARD_HEADER_RESERVE;
  const outputs = [];
  let pack = [];
  let packBytes = 0;
  const flushPack = () => {
    if (pack.length) outputs.push({ kind: "shard", sections: pack });
    pack = [];
    packBytes = 0;
  };
  const seenNamed = new Set();
  const seenLegacy = new Set();

  for (const s of sections) {
    const named = layout.named.find((n) => s.heading.startsWith(n.headingPrefix));
    if (named) {
      if (seenNamed.has(named.file)) {
        throw new Error(`named prefix ${JSON.stringify(named.headingPrefix)} matched more than one section — disambiguate the layout`);
      }
      seenNamed.add(named.file);
      flushPack();
      outputs.push({ kind: "register", spec: named, section: s });
      continue;
    }
    const legacy = layout.legacy.find((l) => s.heading.startsWith(l.headingPrefix));
    if (legacy) {
      if (seenLegacy.has(legacy.basename)) {
        throw new Error(`legacy prefix ${JSON.stringify(legacy.headingPrefix)} matched more than one section — disambiguate the layout`);
      }
      seenLegacy.add(legacy.basename);
      flushPack();
      outputs.push({ kind: "legacy", spec: legacy, section: s });
      continue;
    }
    const cost = byteLenOfLines(s.lines) + 1; // +1 for the newline that rejoins it
    if (pack.length && packBytes + cost > budget) flushPack();
    if (!pack.length && cost > budget) {
      // A single section larger than a whole shard. Emit it alone rather than cutting
      // inside it — an intra-section cut would strand a body mid-sentence — and SAY SO.
      warnings.push(`section over shard cap, emitted alone: ${s.heading.slice(0, 90)} (${cost} B)`);
    }
    pack.push(s);
    packBytes += cost;
  }
  flushPack();

  for (const n of layout.named) {
    if (!seenNamed.has(n.file)) warnings.push(`named section not found: ${n.headingPrefix} (no ${n.file} emitted)`);
  }
  for (const l of layout.legacy) {
    if (!seenLegacy.has(l.basename)) warnings.push(`legacy section not found: ${l.headingPrefix}`);
  }

  // ---- materialize files, still in document order ------------------------
  const files = [];
  const usedNames = new Set();
  const claimName = (want) => {
    if (!usedNames.has(want)) {
      usedNames.add(want);
      return want;
    }
    // Deterministic disambiguation. Reachable when two packs share a min AND max date
    // (a single-day burst larger than one shard, or two runs separated by an extracted
    // register) — a numeric suffix keeps names unique without inventing a fake range.
    const stem = want.replace(/\.md$/, "");
    let k = 2;
    while (usedNames.has(`${stem}-${String(k).padStart(2, "0")}.md`)) k++;
    const got = `${stem}-${String(k).padStart(2, "0")}.md`;
    usedNames.add(got);
    warnings.push(`file name collision resolved with a numeric suffix: ${got}`);
    return got;
  };

  for (const out of outputs) {
    if (out.kind === "register") {
      const s = out.section;
      // A register with NO `partCap` is kept whole — the unchanged path, and the one
      // ADOPTION-QUEUE still takes. `cuts` is then [0, len] and this loop runs once, emitting
      // exactly the single file and the exact head text it emitted before this change.
      const cuts =
        out.spec.partCap && byteLenOfLines(s.lines) > out.spec.partCap
          ? registerCutPoints(s, out.spec, warnings)
          : [0, s.lines.length];
      const nParts = cuts.length - 1;
      const stem = out.spec.file.replace(/\.md$/, "");
      for (let p = 0; p < nParts; p++) {
        // ⛔ PART 1 KEEPS THE REGISTER'S OWN FILENAME. Every pointer in the corpus names
        // `WATCH-TIER.md` — 29 arms in `smoke-test-hooks.sh`,
        // `meta/SKILL.md`, `references/process-learn.md`, and this tool's own
        // REGISTER-OVER-CAP text — and the register's first section carries the AGE RULE that
        // those pointers are FOR. Renaming part 1 to `-PART-01` would rot all of them at once
        // to buy naming symmetry, which is the trade the shard-rename incident already priced.
        const file = p === 0 ? out.spec.file : `${stem}-PART-${String(p + 1).padStart(2, "0")}.md`;
        files.push({
          file: claimName(file),
          kind: "register",
          verbatimLines: s.lines.slice(cuts[p], cuts[p + 1]),
          head:
            `<!-- ${file.replace(/\.md$/, "")} — ${out.spec.note}\n` +
            (nParts > 1
              ? `     PART ${p + 1} of ${nParts}.` +
                (p > 0
                  ? ` CONTINUATION — begins mid-list by design; the conventions and the AGE RULE live in ${out.spec.file}.`
                  : "") +
                `\n     ⛔ GREP THE DIR, NEVER ONE PART: \`grep -n '<row>' .claude/skills/meta/${stem}*.md\`.\n` +
                `     A grep of one part returns a clean ZERO for a row that exists.\n`
              : "") +
            `     Extracted from meta/MEMORY.md by the archive split; MEMORY.md is now a ROUTER.\n` +
            `     Grep the whole skill dir before claiming absence. -->`,
          descriptor: nParts > 1 ? `live register — part ${p + 1} of ${nParts}` : "live register",
          // Carried so the per-file cap check below measures a register against the cap that
          // actually governs it. Without this the check reads `shardCap` for every register and
          // a 199,999 B part passes while the read guard denies it.
          partCap: out.spec.partCap ?? null,
          dateFrom: dates[s.idx],
          dateTo: dates[s.idx],
          // Only part 1 counts as THE section, exactly as the legacy path does. Counting each
          // part would double-count the register in every section total downstream.
          sectionCount: p === 0 ? 1 : 0,
        });
      }
      continue;
    }
    if (out.kind === "legacy") {
      const s = out.section;
      const cuts = legacyCutPoints(s, out.spec, warnings);
      const nums = legacyEntryNumbers(s, out.spec);
      for (let p = 0; p < cuts.length - 1; p++) {
        const partLines = s.lines.slice(cuts[p], cuts[p + 1]);
        const inPart = nums.filter((e) => e.at >= cuts[p] && e.at < cuts[p + 1]).map((e) => e.n);
        const lo = inPart.length ? Math.min(...inPart) : 0;
        const hi = inPart.length ? Math.max(...inPart) : 0;
        const pad = (n) => `L${String(n).padStart(3, "0")}`;
        files.push({
          // ⛔ THE SECOND NAME CONSTRUCTOR — the one `--archive-basename` could not reach.
          // `:880` below builds shard names from `archiveBase`; this one built them from the
          // layout spec's hardcoded `basename` ("MEMORY-ARCHIVE-legacy-lessons" in META_LAYOUT).
          // So the flag advertised as THE safety parameter covered one of two constructors, and
          // sharding a non-MEMORY source emitted MEMORY-ARCHIVE-legacy-lessons-*.md straight into
          // the lesson-ledger union glob. Whether the hole opened depended on whether the SOURCE
          // carried a legacy section — i.e. on data, not on the operator's flags, which is exactly
          // the property a safety parameter must not have. Re-anchoring the spec's basename onto
          // archiveBase is identity when archiveBase is the default, so the 24 shipped splits and
          // the 2 live legacy shards stay byte-identical.
          file: claimName(`${legacyBasename(out.spec.basename, archiveBase)}-${pad(lo)}-${pad(hi)}.md`),
          kind: "legacy",
          verbatimLines: partLines,
          head: ARCHIVE_HEADER,
          descriptor:
            `legacy list-form entries ${lo}..${hi}` +
            (p > 0 ? ` — CONTINUATION of \`${s.heading.slice(3).trim()}\`, begins mid-list by design` : ""),
          dateFrom: dates[s.idx],
          dateTo: dates[s.idx],
          sectionCount: p === 0 ? 1 : 0,
          entryRange: [lo, hi],
        });
      }
      continue;
    }
    const ds = out.sections.map((s) => dates[s.idx]).sort();
    files.push({
      file: claimName(`${archiveBase}-${ds[0]}-${ds[ds.length - 1]}.md`),
      kind: "shard",
      verbatimLines: out.sections.flatMap((s) => s.lines),
      head: ARCHIVE_HEADER,
      descriptor: `${ds[0]}..${ds[ds.length - 1]} · ${out.sections.length} sections`,
      dateFrom: ds[0],
      dateTo: ds[ds.length - 1],
      sectionCount: out.sections.length,
      sections: out.sections,
    });
  }

  files.forEach((f, i) => {
    f.partNo = i + 1;
  });
  const partTotal = files.length;

  // FILE-level pieces in PART order — the exact shape `reconstructFromLayout` concatenates.
  const pieces = [
    // Was hardcoded "MEMORY.md" — the same defect fixed on the write path,
    // surviving here in the reconstruction-proof labels because nothing read it back.
    { order: [0, 0], lines: preambleLines, owner: routerName },
    ...files.map((f) => ({ order: [f.partNo, 0], lines: f.verbatimLines, owner: f.file })),
  ];

  // ---- render archive-side files ----------------------------------------
  for (const f of files) {
    f.text = renderArchiveSide({
      head: f.head,
      partNo: f.partNo,
      file: f.file,
      descriptor: f.descriptor,
      verbatimLines: f.verbatimLines,
      routerName,
    });
    f.bytes = bytes(f.text);
    // ROUND-TRIP THE STRIP RULE ON EVERY FILE. The reconstruction proof below is only as
    // good as `readVerbatim`; asserting it here means a header-format change can never
    // silently make the layout unreadable.
    const back = readVerbatim(f.text);
    if (back.join("\n") !== f.verbatimLines.join("\n")) {
      throw new Error(`readVerbatim round-trip FAILED for ${f.file}`);
    }
    const s = scan(f.text);
    f.declCount = s.declared.size;
    const ns = [...s.declared.keys()];
    f.lSpan = ns.length ? `L${Math.min(...ns)}..L${Math.max(...ns)}` : "—";
    if (f.kind !== "register" && f.bytes > shardCap) {
      throw new Error(`SHARD CAP BREACHED for ${f.file}: ${f.bytes} > ${shardCap}`);
    }
    // A register is measured against ITS OWN cap. With a `partCap` the splitter has just cut it
    // to read whole, so anything still over is a real defect in the cut (the single-row-too-big
    // case `registerCutPoints` warns about) and says so; without one it is the kept-whole
    // register, and the message stays exactly what it has always been.
    if (f.kind === "register" && f.partCap && f.bytes > f.partCap) {
      warnings.push(
        `live register PART over its read cap after cutting: ${f.file} ${f.bytes} B > ${f.partCap} B — a single row larger than the part budget is the only way this happens; the row needs splitting by hand`,
      );
    }
    if (f.kind === "register" && !f.partCap && f.bytes > shardCap) {
      warnings.push(`live register over shard cap (kept whole — it is working state): ${f.file} ${f.bytes} B`);
    }
  }

  // ---- router ------------------------------------------------------------
  // COMPUTE the two numbers the router's prose quotes about this corpus. They were literals
  // once, and the overlap figure was ALREADY STALE by the time it was read — measured on a
  // superseded 18-file layout while the file emitting it produced 20. A number baked into
  // GENERATED prose cannot be re-measured by the next reader and never fails; derive it.
  const descendingDateSteps = dates.reduce((n, d, i) => n + (i > 0 && d < dates[i - 1] ? 1 : 0), 0);
  let runningMax = null;
  let overlappingFiles = 0;
  for (const f of files) {
    if (runningMax && f.dateFrom < runningMax) overlappingFiles++;
    if (!runningMax || f.dateTo > runningMax) runningMax = f.dateTo;
  }
  const proseStats = { descendingDateSteps, overlappingFiles, sectionCount: sections.length };
  const router = renderRouter({ preambleLines, files, routerCap, partTotal, stats: proseStats, skillDir, routerName });
  const routerBytes = bytes(router);
  if (routerBytes > routerCap) {
    throw new Error(`ROUTER CAP BREACHED: ${routerBytes} > ${routerCap}`);
  }
  // ⛔ THE DIGEST ROWS MUST NOT BE `## ` HEADINGS. If they were, the union-scan would see
  // every archived lesson TWICE and the duplicate-L# hard gate would RED on ~792 false
  // positives. Asserted with the REAL `scan()` — the same function the gate runs.
  const routerScan = scan(router);
  if (routerScan.declared.size !== 0 || routerScan.annotations.length !== 0) {
    throw new Error(
      `ROUTER DECLARES L#s (${routerScan.declared.size} declarations, ` +
        `${routerScan.annotations.length} annotations) — digest rows must not be \`## \` headings`,
    );
  }
  if (!router.includes(SPLIT_MARKER)) throw new Error("router is missing the idempotence marker");

  // ---- conservation -------------------------------------------------------
  const conservation = checkLineConservation(lines, pieces);

  return {
    router,
    routerBytes,
    files,
    pieces,
    conservation,
    warnings,
    stats: {
      sourceBytes: bytes(raw),
      sourceLines: lines.length,
      sections: sections.length,
      shards: files.filter((f) => f.kind === "shard").length,
      registers: files.filter((f) => f.kind === "register").length,
      legacyParts: files.filter((f) => f.kind === "legacy").length,
      partTotal,
      routerBytes,
      maxFileBytes: Math.max(...files.map((f) => f.bytes)),
      totalOutputBytes: routerBytes + files.reduce((a, f) => a + f.bytes, 0),
      ...conservation,
    },
  };
}

/** Entry-boundary line indices (within the section) + their numbers. */
function legacyEntryNumbers(section, spec) {
  const out = [];
  let inFence = false;
  for (let i = 0; i < section.lines.length; i++) {
    if (FENCE.test(section.lines[i])) inFence = !inFence;
    if (inFence) continue;
    const m = spec.entryRe.exec(section.lines[i]);
    if (m) out.push({ at: i, n: Number(m[1]) });
  }
  return out;
}

/**
 * Cut the closed legacy era into `spec.parts` Read-able pieces at ENTRY boundaries, each
 * boundary the one nearest its k/N byte mark. Returns section-relative slice indices
 * [0, c1, c2, …, len] so the parts are contiguous and lossless by construction.
 */
function legacyCutPoints(section, spec, warnings) {
  const entries = legacyEntryNumbers(section, spec);
  const parts = spec.parts ?? 2;
  if (entries.length < parts) {
    warnings.push(`legacy section has ${entries.length} entries, fewer than the ${parts} parts requested — kept whole`);
    return [0, section.lines.length];
  }
  const total = byteLenOfLines(section.lines);
  const cuts = [0];
  for (let k = 1; k < parts; k++) {
    const want = (total * k) / parts;
    let best = null;
    let bestD = Infinity;
    for (const e of entries) {
      if (e.at <= cuts[cuts.length - 1]) continue; // strictly increasing
      const d = Math.abs(byteLenOfLines(section.lines.slice(0, e.at)) - want);
      if (d < bestD) {
        bestD = d;
        best = e.at;
      }
    }
    if (best == null) break;
    cuts.push(best);
  }
  cuts.push(section.lines.length);
  return cuts;
}

/**
 * Cut an over-cap LIVE REGISTER into Read-able parts at ROW boundaries.
 *
 * Differs from `legacyCutPoints` on the one axis that matters: the part COUNT is DERIVED
 * from the cap, never fixed in the spec. A closed era has a known final size, so `parts: 2`
 * is a fact about it; a live register grows every day, so a fixed count is a number that
 * silently stops being enough — which is precisely how this register reached 217,764 B under
 * a regime that already knew it was too big.
 *
 * Greedy from the front: each cut is the LAST row boundary that keeps the part within budget,
 * so parts are append-stable — adding rows at the end cannot move an earlier boundary, and
 * earlier parts keep their names and their contents across a roll. That is the same property
 * the date-named shards rely on, and it is why this does not cut at k/N byte marks the way
 * the legacy path does: k/N re-flows EVERY boundary whenever the total changes.
 *
 * The AGE RULE rides in part 1 by construction — it sits above the first row, so no cut can
 * precede it.
 */
function registerCutPoints(section, spec, warnings) {
  const cap = spec.partCap;
  const rowRe = spec.rowRe;
  if (!cap || !rowRe) return [0, section.lines.length];
  // Row-boundary indices, fence-aware so a fenced example row cannot become a cut point.
  const rows = [];
  let inFence = false;
  for (let i = 0; i < section.lines.length; i++) {
    if (FENCE.test(section.lines[i])) inFence = !inFence;
    if (inFence) continue;
    if (rowRe.test(section.lines[i])) rows.push(i);
  }
  if (rows.length < 2) {
    warnings.push(
      `register ${spec.file} is over cap but has ${rows.length} row boundary(ies) — kept whole`,
    );
    return [0, section.lines.length];
  }
  // ⛔ PACK TO A FILL CAP, NOT TO THE READ CAP — inherited from the RULES split rather than
  // re-learned. Filling to `cap - SHARD_HEADER_RESERVE` leaves ~1.2 KB of slack against a
  // register measuring ~4 KB/day of growth, i.e.
  // under a day before a part crosses the read threshold with nothing to notice. Measured here
  // the same hour: a 912 B doctrine correction to part 1 took it from 56,525 B to 57,437 B —
  // 63 B under the cap — on the FIRST edit after the first cut. The RULES splitter hit this
  // exactly (one shard left 272 B short against 406 B/day) and answered it with a MIN_HEADROOM;
  // this is that constant, sized for a faster-growing file.
  const budget = cap - SHARD_HEADER_RESERVE - REGISTER_MIN_HEADROOM;
  const cuts = [0];
  let start = 0;
  while (byteLenOfLines(section.lines.slice(start)) > budget) {
    let best = null;
    for (const at of rows) {
      if (at <= start) continue;
      if (byteLenOfLines(section.lines.slice(start, at)) > budget) break;
      best = at;
    }
    if (best == null) {
      // ⛔ ONE ROW ALONE OVERFLOWS THE BUDGET. Take the next boundary anyway and SAY SO —
      // never cut inside a row. A mid-row cut strands that row's `occurrences:` / `retire-if:`
      // tail in a different file, and every instrument that reads this register reads the row
      // to its END (the age rule, the promote check, the retire-if sweep). An over-budget part
      // is a loud, readable defect; a bisected row is a silent wrong answer.
      best = rows.find((at) => at > start);
      if (best == null) break;
      warnings.push(
        `register ${spec.file}: a single row exceeds the ${budget} B part budget — emitted alone, part is over cap`,
      );
    }
    cuts.push(best);
    start = best;
  }
  cuts.push(section.lines.length);
  return cuts;
}

// -------------------------------------------------------------- the router

/**
 * The date column and the UNCUT title a router digest row renders for one section heading.
 * Shared by `routerDigestRows` and `checkRouterRows`, so the below-marker row guard derives a
 * row's title exactly as the renderer does — a second copy of these regexes is how a guard
 * drifts away from the output it judges.
 * ⚠️ Change what it returns and every router already on disk refuses its next roll: measured with
 * the separator left in the title, 2,025 of the 2,097 live rows read unbacked and all 36 routers
 * refused. Ship such a change with its routers regenerated by hand (see checkRouterRows).
 */
function routerRowKey(heading) {
  return {
    date: headingDate(heading, true)?.date ?? "—",
    title: heading.slice(3).replace(/^20\d\d-\d\d-\d\d/, "").replace(/^\s*[—–\-:•|]?\s*/, ""),
  };
}

function routerDigestRows(currentShard, cap) {
  if (!currentShard?.sections) return [];
  return currentShard.sections.map((s) => {
    const lm = L_IN_HEADING.exec(stripEmphasisLocal(s.heading));
    // The row is prefixed with `- [L###]` / `- [·]` on purpose: it keeps the row out of
    // BOTH `DECLARATION_RE` (anchored `^## `) and `LEGACY_ENTRY` (which needs a date
    // immediately after an optional `[`), so no re-parse can mistake a digest for an entry.
    const tag = lm ? `L${lm[1]}` : "·";
    const key = routerRowKey(s.heading);
    const title = truncate(key.title, MAX_TITLE);
    const digest = renderDigest(digestOf({ body: s.lines.slice(1).join("\n") }), cap);
    return `- [${tag}] ${key.date} — ${title}${digest ? ` — ${digest}` : ""}`;
  });
}

const stripEmphasisLocal = (s) => s.replace(/[*_`]/g, "");

/**
 * Normalize a directory to a REPO-RELATIVE spelling, cwd-independently.
 *
 * ⛔ WHY THIS EXISTS: `renderRouter` embeds `skillDir` VERBATIM in the Rolling prose line
 * below, so the SAME logical directory spelled two ways produces two different routers.
 * The absolute prefix `<repo-root>/` is a fixed run of bytes, and every router on disk carries
 * the relative spelling — so an absolute-path invocation regenerates a router differing by
 * that prefix's length on a prose line that describes nothing about the corpus.
 *
 * Harmless while the roll gate never COMPARES the regenerated router to the one on disk.
 * The moment it does (drift as a roll reason), that byte difference reads as staleness and the router
 * ping-pongs between spellings every time a different operator runs it — on a file with
 * many writers. Two bugs masking each other: repairing the gate ARMS this one, which is
 * why it lands FIRST (`tests-unit.md`, the production half of that entry).
 *
 * Measured 2026-08-09 by a review lens: a pristine copy invoked by absolute path reported
 * `changed MEMORY.md` with exactly ONE differing line — this one.
 *
 * Walks up for `.git` rather than using `process.cwd()`, so the answer does not depend on
 * where the operator happens to stand. Falls back to the caller's own spelling outside a
 * repo, which is the only honest answer there.
 */
function repoRelativeDir(p) {
  if (!p) return null;
  const abs = path.resolve(p);
  for (let cur = abs; ; ) {
    if (fs.existsSync(path.join(cur, ".git"))) return path.relative(cur, abs) || ".";
    const up = path.dirname(cur);
    if (up === cur) return p;
    cur = up;
  }
}

function renderRouter({ preambleLines, files, routerCap, partTotal, stats, skillDir, routerName }) {
  const current = [...files].reverse().find((f) => f.kind === "shard");
  const banner =
    `<!-- ${SPLIT_MARKER} — ${ROUTER_BANNER_MARK}.\n` +
    `     Full bodies live in the ${partTotal} sibling files listed in the manifest below.\n` +
    `     Nothing has been distilled, summarized or deleted: every byte moved VERBATIM.\n` +
    `     Grep the whole skill dir (never this file alone) before citing absence. -->`;

  const prose = [
    "## How this file works",
    "",
    `- **Retrieval** — find the entry in the manifest (by date) or grep the skill dir. ⛔ **Do NOT bare-\`Read\` the file it names** — an archive-side file may sit above the ~58-64 KB partial-view band, and an unbounded Read is then REFUSED by the memory-read guard with paging coordinates (newest is at the TAIL). Grep your anchor, then \`Read\` with an \`offset\`.`,
    `- **Appends** — new entries go to the CURRENT shard (\`${current?.file ?? "—"}\`), never to this router.`,
    // ⛔ `--router` MUST be emitted for a non-default router, or this line sends the reader
    // at the WRONG LAYOUT. Measured 2026-08-09: `.claude/skills/meta` holds TWO sharded
    // layouts (MEMORY.md + CHANGELOG.md) and both routers printed the identical
    // `--roll .claude/skills/meta`. Following CHANGELOG's own instruction rolls the MEMORY
    // layout — which was clean — so the operator gets `NO-OP — every file is within cap`
    // and concludes there is nothing to do, while CHANGELOG sits 4 sections behind. A
    // self-CONFIRMING false all-clear, which is worse than silence.
    // Same class as the hardcoded-path defect fixed one commit earlier: that
    // one corrected the DIRECTORY and left the ROUTER NAME, so the fix read as complete
    // ("a wrong-but-PLAUSIBLE default is what makes a stale example executable" — this
    // file's own comment, which the incomplete fix then reproduced).
    `- **Rolling** — \`node scripts/memory-tier-split.mjs --roll ${skillDir ?? "<path/to/this/skill/dir>"}${routerName && routerName !== "MEMORY.md" ? ` --router ${routerName}` : ""}\` cuts a new dated shard once the current one crosses ${SHARD_CAP_BYTES.toLocaleString("en-US")} B, and REPORTS whether this router is still current. It does NOT regenerate a merely-stale router — \`--force\` does that. Conservation-checked; running it again changes nothing.`,
    `- **Navigate by PART ORDER (the \`#\` column). That is append order, and it is the only total order this manifest has.**`,
    `- **Shard names are DATE ranges, not L# ranges** — \`L#\` is not monotonic in file order (${stats.descendingDateSteps} descending date steps across ${stats.sectionCount} sections in this corpus), so an L#-ranged name would require physically reordering the ledger.`,
    `- ⛔ **BOTH the \`dates\` and \`L# span\` columns OVERLAP between files, and are a HINT, not an index.** The ledger's own head region is not chronological (compressed Panel Playbooks and Review History sit above later entries), so a date can appear in more than one file. In THIS layout, ${stats.overlappingFiles} of ${files.length} files start before the previous file's max date. **If you know only a date, grep the dir — do not pick a file off this column.**`,
    "",
  ];

  const manifestHead = [
    "## Shard manifest",
    "",
    "| # | file | dates | L# span | sections | L# decls | bytes |",
    "|---|---|---|---|---|---|---|",
  ];
  const manifestRows = files.map(
    (f) =>
      `| ${f.partNo} | \`${f.file}\` | ${f.dateFrom}…${f.dateTo} | ${f.lSpan} | ${f.sectionCount} | ${f.declCount} | ${f.bytes.toLocaleString("en-US")} |`,
  );

  const fixed = [
    preambleLines.join("\n"),
    ROUTER_END,
    "",
    banner,
    "",
    prose.join("\n"),
    manifestHead.join("\n"),
    manifestRows.join("\n"),
    "",
    `## Current shard — digest index (\`${current?.file ?? "—"}\`)`,
    "",
    // The banner already tells a reader not to conclude ABSENCE from this file. Nothing told them
    // the other direction: this index is a SNAPSHOT from the last roll, so it can UNDERSTATE the
    // shard it names and a reader treating it as a complete listing gets a short answer with no
    // signal. Measured 2026-08-09: 2 rows against 28 sections, and a manifest byte column reading
    // 15,458 for a 25,517 B file. Deliberately a CONSTANT sentence — no count, no timestamp — so
    // it cannot itself rot, and so it adds no per-roll churn to a file every roll rewrites.
    `Digests for the CURRENT shard only, and this index is a SNAPSHOT from the last roll — entries appended to that shard since are NOT listed here. Older entries are reachable through the manifest above.`,
    "",
  ].join("\n");

  // Same descending ladder as the classic mode: the largest digest length whose full index
  // still fits. One rule, no per-file knob.
  let chosen = "";
  for (const candidate of DIGEST_LADDER) {
    const rows = routerDigestRows(current, candidate);
    const text = `${fixed}\n${rows.join("\n")}\n`;
    chosen = text;
    if (bytes(text) <= routerCap - RESERVE_BYTES) break;
  }
  return chosen;
}

// ------------------------------------------------------------- layout / roll

/** Read an existing sharded layout off disk and validate its PART numbering. */
/**
 * ⛔ CLASSIC-SHAPE DETECTION. The 24 expert memories are hot `MEMORY.md` +
 * a single flat `MEMORY-ARCHIVE.md`: no manifest, no PART headers. `loadLayout` throws on all
 * of them, which is why `--roll` reaches exactly ONE directory today and cannot perform the
 * FIRST conversion — the only operation anyone needs it for on a dir that outgrew its file
 * (measured on qa-expert; and a PIPED probe of that reports rc=0 because the rc
 * belongs to `head`, so the failure reads as success).
 *
 * ⚠️ THE DISCRIMINATOR MUST NOT BE "HAS MANIFEST ROWS". Measured 2026-08-06: an ORDINARY
 * memory append put 16 markdown-table rows matching MANIFEST_ROW_RE into that expert's memory
 * (0 -> 18 rows), 40 minutes before this needed the test. A prose table can
 * forge the row SHAPE. What it cannot forge is a contiguous 1..N manifest whose every named
 * file EXISTS ON DISK — that requires the files to be there. Measured on the same corpus:
 * 16 manifest-shaped rows, 0 naming a real file.
 */
export function detectLayoutShape(dir, routerName = "MEMORY.md") {
  const routerPath = path.join(dir, routerName);
  if (!fs.existsSync(routerPath)) return { shape: "absent", reason: `no ${routerName}` };
  const text = fs.readFileSync(routerPath, "utf8");
  const rows = text.split("\n").map((l) => MANIFEST_ROW_RE.exec(l)).filter(Boolean)
    .map((m) => ({ n: Number(m[1]), file: m[2] }));
  const contiguous = rows.length > 0 && rows.every((r, i) => r.n === i + 1);
  // ⛔ PARTITION ON HOW MANY ROWS RESOLVE — not on the ORDER of existence checks. The first
  // version of the broken-branch sat AFTER the classic check and was correct for 6 of 7 layout
  // states; a review lens measured the 7th and it is the expensive one: a lost shard PLUS a
  // stray `<router>-ARCHIVE.md` classified as CLASSIC, because the classic check shadowed the
  // broken one. `MEMORY-ARCHIVE.md` is the conventional name here (16 live dirs), so a
  // hand-archive or a partial checkout produces exactly that. Measured end-to-end: the router
  // was rewritten 25,224 -> 3,597 B, the manifest kept only the new shard, a 199,193 B shard
  // was ORPHANED, and it printed `conservation: OK`.
  // A resolve-COUNT is total and order-independent, so no later editor can reorder it wrong.
  const resolved = rows.filter((r) => fs.existsSync(path.join(dir, r.file))).length;
  if (contiguous && resolved === rows.length) return { shape: "sharded", parts: rows.length };
  const classicArchive = routerName.replace(/\.md$/, "") + "-ARCHIVE.md";
  // SOME rows resolve => a real layout has lost files. Decided BEFORE the classic check, which
  // is the shadow described above; a classic router's forged rows resolve to NOTHING.
  if (resolved > 0) {
    const missing = rows.filter((r) => !fs.existsSync(path.join(dir, r.file))).map((r) => r.file);
    return {
      shape: "broken", parts: rows.length, missing, contiguous, resolved,
      reason: missing.length
        ? `manifest names ${missing.length} file(s) not on disk: ${missing.join(", ")}`
        : `manifest PART numbering is not contiguous (${rows.length} rows)`,
    };
  }
  if (fs.existsSync(path.join(dir, classicArchive))) {
    return { shape: "classic", archive: classicArchive, forgedRows: rows.length };
  }
  // ⛔ A MANIFEST WHOSE FILES ARE NOT THERE IS BROKEN, NEVER "not yet split". Until 2026-08-10
  // this fell through to `unsplit`, so the MOST SEVERE state — a layout that LOST a shard, i.e.
  // content loss — was reported with the same word as the most benign one, and disappeared from
  // any scan gated on `shape === "sharded"`. `memoryCensus` inherited it: the dir showed up as
  // "not yet split" with an archiveFiles count, which reads as work-not-yet-done.
  //
  // Reaching HERE means: rows exist, ZERO of them resolve, and there is no classic archive.
  // That is TOTAL shard loss — the partition above already took every partial case, so this is
  // not an ordering question any more. (It reads like one; it was, until the resolve-count
  // partition replaced it. The 17 classic dirs are caught one branch up by their archive, and a
  // classic router's forged rows resolve to nothing, which is why resolved===0 is not on its own
  // enough to call something classic.)
  //
  // Non-contiguous PART numbering lands here too: a gap means the manifest cannot describe a
  // whole layout, which is the same class of defect as a missing file.
  if (rows.length > 0) {
    const missing = rows.filter((r) => !fs.existsSync(path.join(dir, r.file))).map((r) => r.file);
    return {
      shape: "broken",
      parts: rows.length,
      missing,
      contiguous,
      reason: missing.length
        ? `manifest names ${missing.length} file(s) not on disk: ${missing.join(", ")}`
        : `manifest PART numbering is not contiguous (${rows.length} rows)`,
    };
  }
  return { shape: "unsplit", reason: `no ${classicArchive}` };
}

/**
 * Reconstruct a CLASSIC layout's source text: hot MINUS its generated index region,
 * then the archive's verbatim body. Pure read; writes nothing.
 *
 * ⚠️ THE INDEX REGION MUST BE EXCISED BEFORE PARSING. Every index row matches LEGACY_ENTRY, so
 * a naive re-parse promotes ~N rows to entries — and `conservation.ok` returns TRUE over the
 * corrupt set because it books the run's own inputs (the tool's own IDEMPOTENCE GUARD says so).
 * `checkEntryParity` is the control that actually sees it; this function is the reason it
 * exists. Measured: skipping the excision inflates the parse by exactly the index-row count.
 */
/**
 * ⛔ CENSUS — REPORT AND STOP. Wired into `/meta status` (member #1 of `/meta maintain`).
 *
 * What this adds that the existing instruments do not: `wrap-reconcile` 7e already measures the
 * HOT side every wrap against the same thresholds, and the memory-read guard already covers
 * archives. Neither reports the LAYOUT SHAPE, and that only became worth reporting once `--roll`
 * could act on it — before the adapter, "25 classic" was a number with no action
 * attached. The ARCHIVE side is the other gap: it is measurably worse than the hot side.
 *
 * ⚠️ THIS FUNCTION MUST NOT GROW A REMEDY. Converting a live expert's memory is an OWNER-GATED
 * act deliberately kept out of the adapter's scope, so a census that starts recommending bulk
 * conversion becomes a nag with a destructive suggestion attached. It names `--roll` as
 * now-capable and stops there.
 */
export function memoryCensus(skillsDir = SKILLS_DIR) {
  const BAND = 57_500;        // partial-view: Read returns a PREFIX past ~58-64 KB (density-dependent)
  const HARD = 262_144;       // Read HARD-ERRORS: zero content, not a truncation
  const WARN = 46_000;        // approaching
  const rows = [];
  for (const d of fs.readdirSync(skillsDir).sort()) {
    const hotPath = path.join(skillsDir, d, "MEMORY.md");
    if (!fs.existsSync(hotPath)) continue;
    let shape = "unknown";
    try { shape = detectLayoutShape(path.join(skillsDir, d)).shape; } catch { shape = "error"; }
    // ⛔ GLOB, never the single classic filename. Stat-ing exactly "MEMORY-ARCHIVE.md"
    // makes this census BLIND to the sharded layout, which has no such file — so the ONE
    // sharded skill (meta: 18 dated shards, ~1.36 MB, 15 of them over the partial-view
    // band) reported `archive: 0`, and the overBand/overHard lists that
    // references/process-status.md step 2b presents as the archive-side health picture
    // EXCLUDED the entire sharded corpus. Derived from the naming family this function
    // happened to know rather than from the obligation ("which archive files exist?") —
    // the same fixture-blindness class warn-large-tracker-read.sh codifies against, in a
    // function shipped the day after it.
    // ⛔ MAX, never SUM. `archive.overBand`/`overHard` below compare this against the Read
    // caps, and that question is PER FILE — the comment on the overHard line says so
    // ("an unbounded Read of THESE returns NOTHING"). Summing 18 shards reports meta at
    // ~3.0 MB and lands it in overHard while no individual shard is anywhere near the cap,
    // which inverts the meaning of the list: sharding exists precisely so that no single
    // file exceeds it. (Summing was this fix's first draft; the suite caught it.)
    const archFiles = fs
      .readdirSync(path.join(skillsDir, d))
      .filter((f) => /^MEMORY-ARCHIVE.*\.md$/.test(f));
    const archiveMax = archFiles.reduce(
      (mx, f) => Math.max(mx, fs.statSync(path.join(skillsDir, d, f)).size),
      0,
    );
    rows.push({
      skill: d,
      hot: fs.statSync(hotPath).size,
      shape,
      // NAMED `archiveMax`, not `archive`: it is the LARGEST archive file, and the bare name
      // read as "the archive" — fine when a skill had exactly one, actively misleading once a
      // sharded skill has 18. NOTE the sibling key on the
      // returned object, `archive: { count, overBand, overHard }`, is the AGGREGATE and is
      // deliberately unchanged — two different things that were both called "archive".
      archiveMax,
      archiveFiles: archFiles.length,
    });
  }
  const shapes = {};
  for (const r of rows) shapes[r.shape] = (shapes[r.shape] ?? 0) + 1;
  return {
    total: rows.length,
    shapes,
    hot: {
      overBand: rows.filter((r) => r.hot >= BAND).map((r) => r.skill),
      approaching: rows.filter((r) => r.hot >= WARN && r.hot < BAND).map((r) => r.skill),
      overHard: rows.filter((r) => r.hot >= HARD).map((r) => r.skill),
    },
    archive: {
      // ⛔ COUNT FILES, NOT BYTES. `r.archiveMax > 0` makes a skill with a 0-byte archive
      // INVISIBLE to this census — the file exists, the tier is in use, and the count says
      // no. `archiveFiles > 0` is the true predicate for "does this skill have an archive".
      count: rows.filter((r) => r.archiveFiles > 0).length,
      overBand: rows.filter((r) => r.archiveMax >= BAND).map((r) => r.skill),
      // The finding that motivated the census: an unbounded Read of these returns NOTHING.
      overHard: rows.filter((r) => r.archiveMax >= HARD).map((r) => r.skill),
    },
    rows: rows.sort((a, b) => b.hot - a.hot),
    thresholds: { WARN, BAND, HARD },
  };
}

export function reconstructClassic(dir, routerName = "MEMORY.md") {
  const shape = detectLayoutShape(dir, routerName);
  if (shape.shape !== "classic") throw new Error(`${dir}: not a classic layout (${shape.shape})`);
  const hotRaw = fs.readFileSync(path.join(dir, routerName), "utf8");
  const lines = hotRaw.split("\n");
  const s = lines.findIndex((l) => l.startsWith("## Memory index"));
  let hot = hotRaw;
  if (s >= 0) {
    let e = s + 1;
    while (e < lines.length && !lines[e].startsWith("## ")) e++;
    hot = [...lines.slice(0, s), ...lines.slice(e)].join("\n");
  }
  const archiveRaw = fs.readFileSync(path.join(dir, shape.archive), "utf8");
  // The classic archive carries ARCHIVE_HEADER, not a PART header; strip to its first entry.
  const aLines = archiveRaw.split("\n");
  const aStart = aLines.findIndex((l) => DATED_HEADING_RE.test(l));
  const archiveBody = aStart >= 0 ? aLines.slice(aStart).join("\n") : "";
  // ⛔ REFUSE RATHER THAN DISCARD. This slice drops everything above the first dated heading, and
  // the WHOLE archive when there is none. That was harmless while the flat archive survived the
  // conversion as an accidental backup — a read-truncation. Once rollLayout RETIRES the archive
  // (`isClassic && shape.archive`), the same truncation becomes a DELETION: measured at HEAD as
  // needle 1 -> 0, archive gone, rc=0, "conservation: OK", and an identical clean --dry-run plan.
  // The PARENT commit refused this input; this one destroyed it. Neither cited guard can see it:
  // assertLineConservation books `raw` (which never contained the dropped text) and
  // checkEntryParity compares entries to headings INSIDE the same string, so an emptied archive
  // is trivially 0 === 0. The shape is native here — `MEMORY-ARCHIVE-legacy-lessons-*.md` carry
  // NO dated heading at all, and other archives hold hundreds of lines above the first one.
  // The predicate is "does the discarded region contain ENTRIES", not "is it non-empty" — an
  // archive legitimately opens with ARCHIVE_HEADER or a `# Archive` title, and refusing on those
  // would refuse every conversion. What may never be dropped is a BODY: an `## ` heading, or the
  // legacy bullet form LEGACY_ENTRY exists for (`MEMORY-ARCHIVE-legacy-lessons-*.md` carry 320 and
  // 157 lines of exactly that, with no dated heading anywhere, so `aStart < 0` discards all of it).
  const droppedLines = aStart >= 0 ? aLines.slice(0, aStart) : aLines;
  const orphanEntries = droppedLines.filter((l) => l.startsWith("## ") || LEGACY_ENTRY.test(l));
  if (orphanEntries.length > 0) {
    throw new Error(
      `${dir}/${shape.archive}: ${orphanEntries.length} ENTR${orphanEntries.length === 1 ? "Y" : "IES"} sit ` +
        `${aStart < 0 ? "in an archive with NO dated heading" : `above the first dated heading`}, and reconstructClassic ` +
        `would DISCARD them while the roll RETIRES this file — i.e. delete them. Refusing. ` +
        `First: ${JSON.stringify(orphanEntries[0].slice(0, 80))}`,
    );
  }
  // PARITY ON BOTH SIDES, before anything downstream trusts this text.
  assertEntryParity(`${dir}/${routerName} (hot, index excised)`, checkEntryParity(hot));
  assertEntryParity(`${dir}/${shape.archive} (archive)`, checkEntryParity(archiveBody));
  return { text: `${hot.replace(/\n+$/, "")}\n\n${archiveBody}`, shape };
}

export function loadLayout(dir, routerName = "MEMORY.md") {
  if (routerName.includes("/") || routerName.includes("..")) {
    throw new Error(`routerName must be a bare filename, got ${JSON.stringify(routerName)}`);
  }
  const routerPath = path.join(dir, routerName);
  if (!fs.existsSync(routerPath)) throw new Error(`no ${routerName} in ${dir}`);
  const routerText = fs.readFileSync(routerPath, "utf8");
  if (!routerText.includes(SPLIT_MARKER)) {
    throw new Error(`${routerPath} is not a router (no ${JSON.stringify(SPLIT_MARKER)} marker) — run --shard first`);
  }
  // The ROUTER's manifest is the authoritative document order. Deriving it from the router
  // (rather than from a total stamped into each file) is what lets an append leave every
  // earlier file byte-identical — and it catches strictly more: a missing TAIL file, a
  // renamed file, and a stray extra file all fail here instead of silently truncating the
  // reconstructed corpus.
  const manifest = routerText
    .split("\n")
    .map((l) => MANIFEST_ROW_RE.exec(l))
    .filter(Boolean)
    .map((m) => ({ n: Number(m[1]), file: m[2] }));
  if (!manifest.length) throw new Error(`${routerPath}: no manifest rows found — cannot determine document order`);
  manifest.forEach((row, i) => {
    if (row.n !== i + 1) throw new Error(`router manifest is not 1..N contiguous (saw ${row.n} at position ${i + 1})`);
  });

  // ⛔ SIBLING LAYOUTS SHARE A DIRECTORY (2026-08-06). Before this, a stray was ANY .md
  // carrying a PART header that this manifest did not list — which is right for a dir with
  // ONE layout and wrong the moment a second lands. `.claude/skills/meta` holds both the
  // MEMORY layout and the CHANGELOG layout, so --roll THREW on every invocation
  // ("CHANGELOG-ARCHIVE-… carries a PART header but is absent from the router manifest"),
  // i.e. the recurrence mechanism both routers advertise in their own prose was DEAD from
  // the moment the second layout shipped. A file claimed by a SIBLING router is not a
  // stray; a file claimed by NOBODY still is, so the truncated-layout guarantee is intact.
  // (That second half held for the SCAN and briefly did NOT for the declared owner —
  //  a self-asserted claim needs its claimant to exist. Restored by `realRouters` below.)
  // ⛔ 2026-08-06 — THE DECLARED OWNER REPLACES THE PROSE SCAN, where one exists.
  // The scan below asks "does this file MENTION the marker?", and the answer is yes for 26
  // files in this repo of which exactly ONE is a real router (measured: the other 25 are
  // classic expert memories quoting the string in prose). That is use-vs-mention guarding a
  // corpus-destroying operation. A shard written since the `· router:` field was added declares its router in its own
  // PART header, so ownership is READ, not inferred.
  //
  // The scan is KEPT, strictly narrowed, for headers written BEFORE that field existed: those return null
  // from partRouterOf and must still be resolvable, or this change would orphan every shard
  // shipped to date. It also now requires the candidate to have real manifest rows — merely
  // containing the marker no longer makes a file a router.
  const siblingClaimed = new Set();
  const realRouters = new Set();
  for (const n of fs.readdirSync(dir)) {
    if (!n.endsWith(".md") || n === routerName) continue;
    let t;
    try { t = fs.readFileSync(path.join(dir, n), "utf8"); } catch { continue; }
    if (!t.includes(SPLIT_MARKER)) continue;          // not a router (necessary, NOT sufficient)
    const rows = t.split("\n").map((l) => MANIFEST_ROW_RE.exec(l)).filter(Boolean);
    // ⚠️ THIS EARLY-CONTINUE IS A NO-OP AND IS LABELLED AS ONE (mutation-measured 2026-08-06:
    // removing it leaves 44/44 GREEN). An earlier revision of this comment claimed it closed
    // the mention-only hazard; it does not — `for (const m of [])` already adds nothing, so a
    // marker-mentioning file with no rows was ALWAYS harmless. Kept for legibility only.
    // THE REAL RESIDUAL, unclosed here: a STALE ROUTER (marker AND real manifest rows) still
    // claims files, and its claims still suppress the stray check. That is what the declared
    // owner above fixes for any shard that declares one, and what remains open for legacy
    // headers. Do not read this line as a guard.
    if (!rows.length) continue;
    realRouters.add(n);                               // this file IS a router (marker + rows)
    for (const m of rows) siblingClaimed.add(m[2]);
  }
  /** A file is owned ELSEWHERE if it says so itself; else fall back to the narrowed scan. */
  const ownedElsewhere = (name, text) => {
    const declared = partRouterOf(text);
    if (declared !== null) {
      if (declared === routerName) return false;      // ours; the manifest loop will place it
      // ⛔ 2026-08-06 — A CLAIM NEEDS A CLAIMANT. The OLD path could
      // not produce one without: `siblingClaimed` is built by READING real sibling routers, so
      // an unclaimed file was always a stray. The declared owner is SELF-ASSERTED, and without
      // this check a shard naming a router that does not exist escaped the stray scan instead
      // of erroring — silently tolerating exactly the truncated layout the scan exists to catch,
      // reachable by rename / delete / cross-dir copy during a migration. Measured, one variable:
      //   orphan declaring a NON-EXISTENT router : old THROW -> new LOADED OK
      //   same orphan, legacy header (control)   : old THROW -> new THROW
      return realRouters.has(declared);
    }
    return siblingClaimed.has(name);
  };
  const onDisk = new Set(
    fs.readdirSync(dir).filter((n) => {
      if (n === routerName || !n.endsWith(".md")) return false;
      let t;
      try { t = fs.readFileSync(path.join(dir, n), "utf8"); } catch { return false; }
      return !ownedElsewhere(n, t);
    }),
  );
  const parts = [];
  for (const row of manifest) {
    const p = path.join(dir, row.file);
    if (!fs.existsSync(p)) throw new Error(`manifest lists ${row.file} but it is not on disk — refusing to roll a truncated layout`);
    const text = fs.readFileSync(p, "utf8");
    const line = text.split("\n").find((l) => PART_RE.test(l));
    if (!line) throw new Error(`${row.file}: no PART header`);
    const m = PART_RE.exec(line);
    if (m[2] !== row.file) throw new Error(`PART header names ${m[2]} but the file on disk is ${row.file} — refusing to roll a renamed file`);
    if (Number(m[1]) !== row.n) throw new Error(`${row.file}: PART ${m[1]} but the manifest places it at ${row.n}`);
    // This loop validated the PART number and the filename and IGNORED
    // the newly added router field — so a manifest-listed shard stamped for ANOTHER
    // router loaded silently as ours. With the (now-fixed) fail-open stray check that was the
    // detachment path. A declaration nobody reads is not a declaration.
    const declaredHere = partRouterOf(text);
    if (declaredHere !== null && declaredHere !== routerName) {
      throw new Error(`${row.file}: the ${routerName} manifest lists it, but it declares 'router: ${declaredHere}' — refusing to load a cross-stamped shard`);
    }
    parts.push({ file: row.file, n: row.n, text });
    onDisk.delete(row.file);
  }
  // A shard-NAMED file with no PART header is a stale-name append (a writer using the
  // pre-roll filename after --heal renamed it): nothing carries its content forward, and the
  // old check ignored it — reported `current`. Refuse loudly instead.
  const shardPrefix = manifest.length ? manifest[0].file.replace(/\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.md$/, "") : null;
  for (const stray of onDisk) {
    const text = fs.readFileSync(path.join(dir, stray), "utf8");
    if (text.split("\n").some((l) => PART_RE.test(l))) {
      throw new Error(`${stray} carries a PART header but is absent from the router manifest — resolve by hand before rolling`);
    }
    if (shardPrefix && shardPrefix !== manifest[0].file && stray.startsWith(shardPrefix)) {
      throw new Error(`${stray} is named like a shard of this layout but carries no PART header — a stale-name append after a roll? Nothing carries it forward: fold its content into the current shard by hand, then re-run`);
    }
  }
  return { dir, routerPath, routerText, parts };
}

/** Rebuild the exact source text from a layout on disk. The inverse of splitMemorySharded. */
export function reconstructFromLayout(layout) {
  const out = [...readVerbatim(layout.routerText)];
  for (const p of layout.parts) out.push(...readVerbatim(p.text));
  return out.join("\n");
}

/**
 * ⛔ THE ROW HALF OF THE BELOW-MARKER GUARD. `STRANDED_ENTRY_RE` refuses a misplaced
 * `## <date>|L#` BLOCK below a router's marker, but a hand-appended ROW there is shaped exactly
 * like this tool's own digest output, so `--heal` and `--roll` re-rendered the router from the
 * shards, discarded the row and printed a clean verdict. Measured at a session's wrap: one
 * post-commit `--heal` dropped 37 Memory Update rows from 11 expert routers while printing
 * `CLEAN — 14 repaired`; the rows were re-homed by hand.
 *
 * A row is BACKED when a section heading in this layout's own corpus renders to it: the same date
 * column (`—` for an undated heading), then that heading's title — whole, followed by the end of
 * the row or ` — <digest>`; or, where the renderer cut the title with `…`, a prefix of it. Both
 * sides go through `routerRowKey`, whitespace-collapsed and emphasis-stripped, so a re-cut
 * MAX_TITLE never reads as a missing entry. The DIGEST is never compared (it follows the body and
 * the ladder cap), so a STALE router passes by construction — its rows are a subset of the corpus —
 * and only a row with NO heading behind it refuses. Every `- [` row is examined, as is every
 * LEGACY_ENTRY spelling (`- 2026-…`, `- **2026-…`): the renderer emits none of them below the
 * marker except its own `[·]`/`[L#]` rows, so any other one there was written by hand.
 * ⚠️ The price of keying on the title: a change to `routerRowKey` that alters titles leaves every
 * row rendered under the old derivation unbacked, and this then refuses the roll that would
 * re-render them. Such a change regenerates its routers by hand — delete their digest rows, then
 * `--force`.
 */
const ROUTER_ROW_TAG_RE = /^[-*]\s+\[(?:·|L\d+)\]\s*/;
// The only headings renderRouter emits below the marker. Any other one there (an undated `## Title`
// block, a `### …`) was written by hand and is discarded by the same regeneration; STRANDED_ENTRY_RE
// sees only the dated / L# `## ` spelling, and 386 shard headings carried no date when measured.
const RENDERED_HEADING_RE = /^## (?:How this file works$|Shard manifest$|Current shard — digest index \()/;
export function checkRouterRows(routerText, corpusRaw) {
  const norm = (s) => s.replace(/[*_`]/g, "").replace(/\s+/g, " ");
  const titlesByDate = new Map();
  for (const s of parseSectionsExact(corpusRaw).sections) {
    const key = routerRowKey(s.heading);
    if (!titlesByDate.has(key.date)) titlesByDate.set(key.date, []);
    titlesByDate.get(key.date).push(norm(key.title).trim());
  }
  // The row's text after its date column renders from title `t`: whole, or cut at a `…`. A cut
  // keeps more than 0.6 × MAX_TITLE characters (`truncate`), so a shorter prefix is no render of
  // `t`: without this floor a one-word `First… — x` row passed against any same-date title.
  const cutFloor = Math.floor(MAX_TITLE * 0.6);
  const rendersFrom = (r, t) =>
    r === t ||
    r.startsWith(`${t} — `) ||
    [...r.matchAll(/…/g)].some(
      ({ index: i }) => i >= cutFloor && t.startsWith(r.slice(0, i)) && (i + 1 === r.length || r.startsWith(" — ", i + 1)),
    );
  const lines = routerText.split("\n");
  const mAt = lines.findIndex((l) => ROUTER_END_RE.test(l));
  const unbacked = [];
  let rows = 0;
  for (let i = mAt < 0 ? lines.length : mAt + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) {
      if (!RENDERED_HEADING_RE.test(lines[i])) (rows++, unbacked.push({ line: i + 1, text: lines[i] }));
      continue;
    }
    const legacy = LEGACY_ENTRY.exec(lines[i]);
    if (!legacy && !/^[-*]\s+\[/.test(lines[i])) continue;
    rows++;
    const tag = ROUTER_ROW_TAG_RE.exec(lines[i]);
    const m = tag
      ? /^(\S+) —(?: ([\s\S]*))?$/.exec(lines[i].slice(tag[0].length))
      : legacy && [null, legacy[1], lines[i].slice(legacy[0].length).replace(/^[\s\]*]*(?:[—–\-|:•]\s*)?/, "")];
    const r = m ? norm(m[2] ?? "").trimEnd() : null;
    if (r === null || !(titlesByDate.get(m[1]) ?? []).some((t) => rendersFrom(r, t))) {
      unbacked.push({ line: i + 1, text: lines[i] });
    }
  }
  return { rows, unbacked };
}

/** Throws unless every examined row is backed (checkRouterRows). ONE line on purpose: a scan or
 *  heal verdict keeps only an error's first line, and the remedy must survive that cut. */
export function assertRouterRows(routerName, res) {
  const n = res.unbacked.length;
  if (!n) return;
  const [it, s] = n === 1 ? ["it", ""] : ["them", "S"];
  const at = res.unbacked.slice(0, 12).map((u) => u.line).join(", ") + (n > 12 ? ` +${n - 12} more` : "");
  throw new Error(
    `${routerName}: ${n} ROW${s} BELOW the ROUTER PREAMBLE ENDS marker with no entry behind ${it} in any shard ` +
      `(line${s.toLowerCase()} ${at}; ${n} of ${res.rows} examined; first: ${JSON.stringify(res.unbacked[0].text.slice(0, 90))}). Everything below ` +
      `that marker is REGENERATED from the shards, so rolling would discard ${it} and still report conservation OK. ` +
      `Move each into the current shard (the file this router's **Appends** line names) as a "## <date> — <title>" ` +
      `block (body and Revisit kept), then re-run — ` +
      `or, if its entry IS in a shard under a since-reworded heading, delete the stale row. If MOST rows read ` +
      `unbacked, suspect a change to routerRowKey/headingDate, not hand-written rows: moving them duplicates entries.`,
  );
}

/**
 * AUTO-ROLL — the recurrence mechanism. Re-derives the WHOLE layout from
 * the reconstructed corpus rather than surgically appending a file, which buys three things
 * a surgical roll cannot: it is idempotent by construction, it inherits the conservation
 * oracle unchanged, and it round-trips the layout it is about to replace (so a corrupted
 * or hand-edited shard is caught HERE, not silently carried forward).
 *
 * Because packing is greedy in file order, re-deriving does NOT churn: every shard before
 * the current one is byte-identical and keeps its name. Only the tail moves.
 */
export function rollLayout(dir, opts = {}) {
  const shardCap = opts.shardCap ?? SHARD_CAP_BYTES;
  const routerName = opts.routerName ?? "MEMORY.md";
  // ⛔ SHAPE-AGNOSTIC ENTRY. `--roll` used to call loadLayout unconditionally, which
  // THROWS on the classic hot+single-archive shape ("no manifest rows found", loadLayout).
  // So the roll could only ever roll an ALREADY-SHARDED directory and could not perform the
  // FIRST conversion — the one operation anyone needs on a dir that has outgrown its file.
  // It reached exactly ONE directory (meta); the other 24 threw. Measured on
  // qa-expert, and note the second finding: a PIPED probe of that failure reports rc=0
  // because the rc belongs to `head`, so on this tool the failure reads as "the roll is fine".
  const shape = detectLayoutShape(dir, routerName);
  const isClassic = shape.shape === "classic";
  // An EMPTY layout rather than null: every downstream `layout.parts` then reads [] naturally,
  // which is true (a classic dir has no shards) instead of a null every call site must guard.
  // Patching those one at a time is how a null-check gets missed on the fourth site.
  let layout = { parts: [], routerText: "" };
  let raw;
  if (isClassic) {
    // reconstructClassic excises the index region and asserts entry parity on BOTH sides
    // before returning — the control that `conservation.ok` structurally cannot provide.
    raw = reconstructClassic(dir, routerName).text;
  } else {
    layout = loadLayout(dir, routerName);
    // ⛔ REFUSE while the ROUTER carries a MISPLACED dated entry below its preamble marker.
    // `readVerbatim` keeps only the lines ABOVE that marker, so an entry appended below it is
    // DISCARDED by the roll — and `checkConservation` is structurally blind to it, because the
    // router's tail never enters the parsed-block set it compares. MEASURED 2026-08-07 on a
    // throwaway copy: a dated entry appended to MEMORY.md vanished from every file in the dir
    // while this command printed `conservation: OK (13910 lines)`. Not exotic — MOST skill
    // dirs are classic-shape, where MEMORY.md IS the correct append target, so appending to the
    // router is the DEFAULT habit and meta is the one place it destroys the entry.
    const rLines = layout.routerText.split("\n");
    const mAt = rLines.findIndex((l) => ROUTER_END_RE.test(l));
    const strayAt = mAt < 0 ? -1 : rLines.slice(mAt + 1).findIndex((l) => STRANDED_ENTRY_RE.test(l));
    if (strayAt >= 0) {
      throw new Error(
        `${routerName}: a dated or L# entry sits BELOW the ROUTER PREAMBLE ENDS marker ` +
          `(line ${mAt + 2 + strayAt}: ${JSON.stringify(rLines[mAt + 1 + strayAt].slice(0, 70))}). ` +
          `Everything below that marker is REGENERATED, so rolling would discard it and still ` +
          `report conservation OK. Move it to the current shard, then re-run.`,
      );
    }
    raw = reconstructFromLayout(layout);
    // ⛔ …and the same discard for a hand-written ROW, which the heading test above cannot see
    // (37 rows in 11 routers, one `--heal`, printed CLEAN). Here, on the one function every
    // regenerating path calls (`--roll`, `--roll --force`, `--heal` via scanRouters), so the
    // read-only `--scan-routers` and the pre-commit staleness hook report it as ERROR too.
    assertRouterRows(routerName, checkRouterRows(layout.routerText, raw));
  }
  // ⛔ DERIVE the archive basename from the layout on disk; do NOT let it default.
  // `archiveBase = opts.archiveBasename ?? "MEMORY-ARCHIVE"` is correct for a fresh shard and
  // ACTIVELY WRONG for a roll: rolling the CHANGELOG layout under the default would emit
  // MEMORY-ARCHIVE-*.md shards straight into the lesson-ledger glob. The existing shard names
  // already state the answer, so asking the operator for a flag is asking them to re-supply
  // a fact the directory holds. Undated legacy shards are ignored for the derivation.
  // On the CLASSIC path there are no shards to derive from, so the basename comes from the
  // router's own name (MEMORY.md -> MEMORY-ARCHIVE), which is exactly what the classic archive
  // is already called. Nothing is inferred that the directory does not already state.
  // On the CLASSIC path the basename is STATED by the directory — the existing flat archive is
  // literally named `<router>-ARCHIVE.md` — so it is derived, not defaulted. The fail-closed
  // guard below stays intact for the sharded path, where a wrong basename would name shards
  // into the lesson-ledger glob.
  const classicBase = isClassic ? shape.archive.replace(/\.md$/, "") : null;
  const derivedBases = new Set(
    classicBase ? [classicBase] : layout.parts
      .map((p) => /^(.*)-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.md$/.exec(p.file))
      .filter(Boolean)
      .map((m) => m[1]),
  );
  if (derivedBases.size > 1) {
    throw new Error(`${dir}: shards disagree on archive basename (${[...derivedBases].join(", ")}) — resolve by hand`);
  }
  // ⛔ FAIL CLOSED, DO NOT FALL BACK (2026-08-06, raised in review). The obvious tail here is
  // `?? "MEMORY-ARCHIVE"` — and that is the exact value this file elsewhere calls ACTIVELY
  // DANGEROUS, because it enrols the emitted shards in the lesson-ledger union glob. Measured
  // when it was raised: rollLayout reaches exactly ONE live directory (meta, 16 of 20 parts
  // dated, derives correctly); the other 55 skill dirs are classic-shape and throw in loadLayout
  // long before this line. So the silent fallback is UNREACHABLE today and would become the
  // default path the moment the expert-shape adapter lands — the review's severity was right about
  // the hazard and early by one commit. Closing it now costs 4 lines; closing it after the
  // adapter means finding it again with live inputs.
  if (!opts.archiveBasename && derivedBases.size === 0) {
    throw new Error(
      `${dir}: cannot derive an archive basename — no shard matches <base>-<from>-<to>.md and ` +
        `no archiveBasename was supplied. Refusing to default to "MEMORY-ARCHIVE": that would ` +
        `name these shards into the lesson-ledger glob. Pass --archive-basename explicitly.`,
    );
  }
  // ⛔ THE FLAG MUST NOT SILENTLY WIN OVER A DISAGREEING DERIVATION.
  // `--archive-basename` is advertised at the CLI as THE safety parameter, so an operator who
  // learned yesterday's safety rule reaches for it — and passing MEMORY-ARCHIVE at a CHANGELOG
  // layout silently RENAMED the corpus: measured 3 MEMORY-named files emitted from a CHANGELOG
  // corpus with no error, and in a real roll the genuine shards are rmSync'd first, so ~1 MB of
  // changelog lands in the lesson-ledger union glob. The previous fix TRAINED this habit, which
  // is why it is a throw and not a doc note. Consistent with the two rules already in this
  // function: it throws when the shards disagree with EACH OTHER, and strFlag's own docstring
  // says a silent fallback is the hazard. A size-0 derivation with an explicit flag is still
  // allowed — that is the legitimate fresh-shard case.
  const derived = [...derivedBases][0];
  if (opts.archiveBasename && derivedBases.size === 1 && opts.archiveBasename !== derived) {
    throw new Error(
      `${dir}: --archive-basename ${JSON.stringify(opts.archiveBasename)} disagrees with the ` +
        `basename derived from the shards on disk (${JSON.stringify(derived)}). Refusing: a roll ` +
        `removes the existing shards and would rewrite this corpus under the supplied name. ` +
        `Drop the flag to keep ${JSON.stringify(derived)}, or rename the layout deliberately.`,
    );
  }
  const archiveBasename = opts.archiveBasename ?? derived;
  opts = { ...opts, archiveBasename };

  // The "already within cap, nothing to do" short-circuit is a SHARDED-layout question.
  // A classic dir has no shards to measure, and the conversion itself is the point — so the
  // roll is always warranted there. Guarding on `layout` rather than inventing a cap reading.
  // ⛔ NAMED LIVE REGISTERS ARE EXEMPT FROM THE ROLL TRIGGER. The
  // splitter one code path over already ruled on this exact fact ("live register over shard cap
  // (kept whole — it is working state)"), so counting a named register into `over` here made the
  // SAME TOOL assert ROLL-DUE about a file its own splitter refuses to cut: a permanent false
  // alarm whose prescribed remedy (--roll) is a verified no-op against it, training operators to
  // ignore needs-attention. The register's real remedy is CURATION (its own ~60d prune horizon,
  // plus the archive's revival rule) — surfaced below as REGISTER-OVER-CAP so
  // the SIGNAL survives while the false prescription dies. This is deliberately NOT the rejected
  // alternative of dropping the signal entirely.
  // ⛔ NARROWED — the exemption above survives ONLY for a register
  // the splitter still cannot cut. For any register carrying `partCap` the founding premise is
  // now FALSE: the splitter DOES cut it, at row boundaries, into parts that read whole. So for
  // those an over-cap reading is a REAL roll trigger and `--roll` is the real remedy, which
  // inverts the exemption instead of weakening it. The false-alarm argument is unharmed —
  // it turned on the prescription being a no-op, and here it is not.
  const namedSpecs = (opts.layout ?? META_LAYOUT).named ?? [];
  // ⛔ RESOLVE A FILE TO ITS SPEC BY STEM, NOT BY EXACT FILENAME. A register's parts are named
  // `WATCH-TIER-PART-02.md`, so an exact-name test classifies every part after the first as an
  // ORDINARY SHARD — measured against `shardCap` (200,000) instead of the register's own
  // `partCap` (57,500). That reads clean on a part four times past the size at which the read
  // guard denies it: the register's own rule would apply to one part and not to the rest of
  // itself, which is the shape a caps check cannot recover from by being stricter.
  const specFor = (file) =>
    namedSpecs.find(
      (n) => n.file === file || file.startsWith(`${n.file.replace(/\.md$/, "")}-PART-`),
    ) ?? null;
  // Two populations, split by whether the splitter CAN cut the thing.
  const registerOver = []; // cannot be cut — the surviving 2026-08-25 exemption + its signal
  const registerRollDue = []; // can be cut, and is over its OWN part cap — a genuine trigger
  for (const p of layout.parts) {
    const spec = specFor(p.file);
    if (!spec) continue;
    if (spec.partCap) {
      if (bytes(p.text) > spec.partCap) registerRollDue.push(p.file);
    } else if (bytes(p.text) > shardCap) {
      registerOver.push(p.file);
    }
  }
  // The register clause rides BOTH exits. The roll path previously DROPPED it for one cycle:
  // rolled dirs returned a bare rollReason, so a dir that was
  // both roll-due and register-over deferred the register question invisibly.
  const regNote = registerOver.length
    ? ` — ⚠ REGISTER-OVER-CAP: ${registerOver.join(", ")} exceeds the shard cap and a roll CANNOT cut THIS register — it carries no \`partCap\` in the layout, so it is kept whole by design; the remedy is CURATION (its AGE RULE + the archive's revival rule). A register WITH a \`partCap\` is sharded by the roll instead and never reaches this message.`
    : "";
  const over = layout.parts
    .filter((p) => !specFor(p.file) && bytes(p.text) > shardCap)
    .map((p) => p.file)
    .concat(registerRollDue);
  // A classic dir has no shards to be "within cap" — the CONVERSION is the point, so the roll
  // is always warranted there and must not short-circuit.
  const routerOver = isClassic || bytes(layout.routerText) > (opts.routerCap ?? ROUTER_CAP_BYTES);

  // ⛔ THE NO-OP USED TO CERTIFY A WEAKER PROPERTY THAN IT SOUNDED LIKE. "every file is within
  // cap" is a claim about BYTES; the operator reads it as "nothing to do". Those come apart,
  // because the router is a PROJECTION of the corpus regenerated only when a roll runs — so
  // entries appended between rolls are absent from its digest index while every byte-cap is
  // satisfied. A grep of the router then MISSES a lesson that exists in the dir, which is the
  // false-refutation hazard `.claude/rules/active-recall.md` documents.
  //
  // Measured 2026-08-09: a sharded router carried 10 digest rows against 14
  // sections in the shard it declared current, its manifest byte column read 15,458 for a
  // 25,517 B file, and `--roll --dry-run` reported `NO-OP — every file is within cap`.
  //
  // The comparison that detects this ALREADY EXISTS in this function — `layout.routerText ===
  // res.router`, computed for the `changes` table AFTER this gate returns. It was simply on the
  // wrong side of the early return. This hoists a read-only copy so the no-op can say what it
  // actually checked.
  //
  // ⚠️ DISCLOSE, NOT HEAL — deliberately. Making a drifted router a ROLL REASON (so plain
  // `--roll` regenerates) is the obvious next step and is NOT taken here: it converts a command
  // people run to CHECK into one that WRITES the staged layout, on a tree with concurrent
  // writers. Two of five review lenses wanted it; three did not. Disclosure carries the entire
  // DETECTION value — the remaining difference is only whether the operator must then type
  // `--force` — so the write is severable and is being decided separately, against the
  // maintain-cadence sweep that would actually exercise it. Do not "finish" this by adding
  // `!routerStale` to the conjunction below without that decision.
  const withinCaps = !isClassic && !over.length && !routerOver && !opts.force;
  if (withinCaps) {
    // try/catch, because the whole point of this branch is that it does not write and does not
    // throw. A corpus this projection cannot process is a real finding, but surfacing it as an
    // exception here would make a previously-silent read-only invocation start failing.
    let note = " and the router is current";
    let routerStale = false;
    try {
      const projected = splitMemorySharded(raw, { ...opts, routerName, skillDir: dir });
      if (projected.router !== layout.routerText) {
        routerStale = true;
        const flag = routerName === "MEMORY.md" ? "" : ` --router ${routerName}`;
        // A renderer change (a digest-format fix) makes EVERY router differ with every entry still
        // indexed; saying "entries are absent" then hides the routers that really are missing rows.
        const a = projected.router.split("\n"), b = layout.routerText.split("\n");
        const formOnly = a.length === b.length && a.every((l, i) => l === b[i] || (l.startsWith("- [") && b[i].startsWith("- [")));
        note =
          `, but THE ROUTER IS STALE — the regenerated projection differs from ${routerName} on disk, ` +
          (formOnly
            ? `in digest TEXT only (every entry still has its row: a renderer change, nothing is missing). `
            : `so entries appended since the last roll are absent from its digest index and a grep of ` +
              `${routerName} alone will MISS them. `) +
          `Refresh: node scripts/memory-tier-split.mjs --roll ${repoRelativeDir(dir)}${flag} --force`;
      }
    } catch (err) {
      routerStale = null; // UNKNOWN — distinct from false, and must not read as "current"
      note = `, but THE ROUTER'S FRESHNESS COULD NOT BE DETERMINED: ${String(err?.message ?? err).split("\n")[0]}`;
    }
    note += regNote;
    return { rolled: false, reason: `every file is within cap${note}`, routerStale, layout, raw, over, registerOver, changes: [] };
  }

  // A sibling defect: rollLayout resolved `routerName` above and then passed bare `opts`, so
  // splitMemorySharded re-derived its OWN default. They agree today only because both default
  // to "MEMORY.md" — agreement by coincidence, not by construction, which is what the shardedMain
  // defect was before a non-MEMORY source reached it. Thread the resolved name.
  const res = splitMemorySharded(raw, { ...opts, routerName, skillDir: dir });
  assertLineConservation(`${dir} (roll)`, res.conservation);

  const before = new Map(layout.parts.map((p) => [p.file, p.text]));
  // ⛔ A CLASSIC CONVERSION MUST RETIRE THE FLAT ARCHIVE, OR EVERY BODY SHIPS TWICE.
  // `layout.parts` is [] on the classic path (rollLayout hands it an empty layout by design), so
  // `before` was empty, nothing was ever marked "removed", and the old `MEMORY-ARCHIVE.md` survived
  // beside the new dated shards carrying the same bodies. Measured on one expert's memory:
  // 140,085 B archive + a 158,608 B shard, with the same dated entry heading
  // present in BOTH. The prescribed retrieval is "grep the DIR", so every hit doubles — and the two
  // copies DIVERGE the moment anyone appends. On a `## L`-numbered ledger it is worse: both copies
  // enter the lesson-ledger union and every lesson becomes a duplicate-L# pre-push block.
  // Safe to retire because `reconstructClassic` folds hot+archive into `raw` and the
  // assertLineConservation above proves the new shards carry all of it.
  // ⚠️ LATENT UNTIL THIS BATCH: the classic path could never reach the write, so this never fired.
  // The :2256 re-read fix shipping alongside is exactly what makes it reachable — repairing a
  // component that throws is what arms whatever runs after it.
  if (isClassic && shape.archive) before.set(shape.archive, "");
  const changes = [];
  for (const f of res.files) {
    const prev = before.get(f.file);
    changes.push({ file: f.file, status: prev === undefined ? "created" : prev === f.text ? "unchanged" : "changed", bytes: f.bytes });
    before.delete(f.file);
  }
  for (const file of before.keys()) changes.push({ file, status: "removed", bytes: 0 });
  changes.push({
    file: routerName,
    status: layout.routerText === res.router ? "unchanged" : "changed",
    bytes: res.routerBytes,
  });

  // ⛔ REPORT THE REASON THAT ACTUALLY FIRED. This was `over.length ? … : "router over cap"`, a
  // two-way split over a FOUR-way gate — so every roll that was NOT a shard-cap breach announced
  // "router over cap", including a `--force` on a dir whose router is 7,926 B against a 57,500 B
  // cap, and including a classic dir's first CONVERSION. A false reason is worse here than a
  // missing one: this string is what `--dry-run` prints, so an operator checking WHY a roll is
  // about to happen was told a cap was breached when none was.
  // isClassic is tested BEFORE routerOver because routerOver is defined as `isClassic || …`.
  const rollReason = over.length
    ? `over cap: ${over.join(", ")}`
    : isClassic
      ? "classic layout — first conversion"
      : bytes(layout.routerText) > (opts.routerCap ?? ROUTER_CAP_BYTES)
        ? "router over cap"
        : "forced (--force) — no cap was breached";
  return { rolled: true, reason: rollReason + regNote, layout, raw, over, registerOver, res, changes };
}

/**
 * The roll's pre-swap race test: has the layout moved since `r` (a rollLayout result) was planned?
 * Same reconstruction the plan used, so the md5 compares like with like. The ROUTER is also compared
 * WHOLE: its tail is outside that reconstruction (readVerbatim keeps only the preamble), so a row or
 * entry appended below the marker AFTER rollLayout's below-marker refusals ran was overwritten by
 * the swap with no trace — the race twin of those refusals. Exported so the self-test drives it.
 */
export function rollRaced(dir, routerName, r) {
  const fresh = detectLayoutShape(dir, routerName).shape === "classic" ? null : loadLayout(dir, routerName);
  const now = fresh ? reconstructFromLayout(fresh) : reconstructClassic(dir, routerName).text;
  return md5(now) !== md5(r.raw) || (fresh !== null && fresh.routerText !== r.layout.routerText);
}

/**
 * ⛔ The roll re-packs
 * greedily in document order, so an uncommitted edit in any part but the last pushes rows
 * forward into parts the roller then commits: another session's rows land under the roller's
 * message. `--heal` gates on dirt; a direct `--roll` gated on nothing.
 *
 * Returns the files this roll would REWRITE or REMOVE that were already dirty, minus the two a
 * roll's own operator legitimately holds dirty: the router, and the pre-roll current (last)
 * part, which is where an append goes. Scoped to the roll's own files, NOT the directory: the
 * meta dir holds four families plus references/, so a dir-wide refusal blocks every /meta learn
 * (which dirties process-learn.md in the same pass) and the heal's second router in a
 * two-router dir. Accepted residual: a peer edit in the current part or the router is not seen
 * (in a classic single-archive dir the router, the hot MEMORY.md, is the append target).
 * Exported so --self-test exercises this function, not a copy of it.
 */
export function foreignDirtyForRoll(r, routerName, dirtyNames) {
  const parts = r.layout?.parts ?? [];
  const current = parts.length ? parts[parts.length - 1].file : null;
  return r.changes
    .filter((c) => c.status === "changed" || c.status === "removed")
    .map((c) => c.file)
    .filter((f) => f !== routerName && f !== current && dirtyNames.has(f));
}

/**
 * Basenames of dirty paths directly inside `dir`, or null when git cannot say. A dir outside any
 * git repo returns an EMPTY set, not null: no other session can hold a file there dirty in git's
 * sense, and refusing there broke every fixture roll in a plain temp dir (3 suite arms).
 */
function dirtyNamesIn(dir) {
  // The question is "what is dirty in THIS dir's repo", so discovery starts at `dir` on disk. An
  // inherited GIT_DIR / GIT_WORK_TREE / GIT_CEILING_DIRECTORIES redirects git away from it and a
  // RELATIVE GIT_DIR (`.git`) does not survive `-C`: git then says "not a git repository" INSIDE
  // the repo, which the branch below would read as the not-a-repo all-clear. Strip them.
  const env = { ...process.env };
  // A caller that REDIRECTED git (absolute GIT_DIR + GIT_WORK_TREE, the detached layout with no
  // `.git` ancestor) loses that redirection to the strip below; "not a git repository" then
  // means "cannot tell", not "nothing to protect", so the no-repo branch refuses for such a caller.
  const redirected = Boolean(process.env.GIT_DIR || process.env.GIT_WORK_TREE);
  for (const k of Object.keys(env)) {
    if (/^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|CEILING_DIRECTORIES|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES)$/.test(k)) delete env[k];
  }
  const git = (...args) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", env });
  const inside = git("rev-parse", "--is-inside-work-tree");
  if (inside.status !== 0 && /not a git repository/i.test(inside.stderr || "")) {
    // Trust "no repo" only when the filesystem agrees — no `.git` in any ancestor. If one exists
    // and git still cannot see it, that is a git failure, and the caller refuses on null.
    let d = fs.realpathSync(dir);
    for (;;) {
      if (fs.existsSync(path.join(d, ".git"))) return null;
      const up = path.dirname(d);
      if (up === d) return redirected ? null : new Set();
      d = up;
    }
  }
  const top = git("rev-parse", "--show-toplevel");
  // -z: NUL-separated and NEVER quoted — the default form octal-escapes any path with a byte
  // outside printable ASCII (`"skill-\305\276/…"`) and that spelling matches no real path.
  const out = git("status", "--porcelain", "-z", "--", ".");
  if (top.status !== 0 || out.status !== 0) return null;
  // Porcelain paths are repo-root-relative wherever git runs. "Directly inside dir" is then
  // decided by INODE, never by spelling: git prints a path as the INDEX stores it (on-disk case,
  // NFC-precomposed on macOS) while realpathSync keeps the CALLER's spelling, so a string compare
  // matched nothing for `--roll skills/Meta` on a dir stored as skills/meta, or for the NFD
  // spelling of a dir git stores NFC (what readdir hands --heal for an NFD-created dir) — and the
  // roll PROCEEDED over the dirty part. A stat of each
  // record's parent asks the filesystem, which resolves every spelling to the one directory.
  const root = fs.realpathSync(top.stdout.trim());
  const hereSt = fs.statSync(dir);
  const parentIsHere = (full) => {
    try {
      const st = fs.statSync(path.dirname(full));
      return st.dev === hereSt.dev && st.ino === hereSt.ino;
    } catch {
      return false;
    }
  };
  const names = new Set();
  const recs = out.stdout.split("\0");
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    if (!rec) continue;
    const paths = [rec.slice(3)];
    // A rename or copy record (R/C in either status column) is followed by the ORIGINAL path
    // as its own NUL-terminated field.
    if (/^[RC]/.test(rec) || /^.[RC]/.test(rec)) paths.push(recs[++i] ?? "");
    for (const p of paths) {
      if (!p) continue;
      const full = path.resolve(root, p);
      if (parentIsHere(full)) names.add(path.basename(full));
    }
  }
  return names;
}

/** Write a computed layout into `dir`. The ONLY function in this mode that touches disk.
 *
 *  ⛔ `routerName` IS A DATA-LOSS GUARD, not a convenience (2026-08-06, caught pre-apply).
 *  This wrote the router as a hardcoded `MEMORY.md` for ANY source. `--archive-basename` renames
 *  the SHARDS only, so sharding a changelog into a staging dir produced six correctly
 *  named `CHANGELOG-ARCHIVE-*.md` files AND a 5,387 B file called `MEMORY.md` — a CHANGELOG router
 *  wearing the lesson ledger's filename. The natural apply step (`cp <out>/*.md <skill-dir>/`)
 *  would then have OVERWRITTEN the skill's own `MEMORY.md`, destroying the live lesson router
 *  and silently detaching 19 archive shards from any index. Nothing downstream would have
 *  errored: the L# union would simply have gone quiet again.
 *  Default stays "MEMORY.md" so the 24 shipped single-archive splits are untouched. */
/**
 * ⛔ CONTENT LOSS, and the worst thing in this arc. This
 * validation used to live INSIDE `writeLayout`. `shardedMain`'s roll path deletes every removed
 * shard (`fs.rmSync`) and THEN calls `writeLayout` — so a throw there fired AFTER the deletion
 * and before the replacement was written. Measured: content gone, and the layout left
 * permanently unloadable ("manifest lists X but it is not on disk"). Control at the parent
 * commit: same roll, rc=0, content intact.
 *
 * The guard's own comment said "Fails CLOSED". In the WRITE path it does. In the ROLL path it
 * failed HALF-OPEN, after deletion — which is the difference between refusing to act and
 * destroying the thing you were protecting. Hoisting it out means the roll can validate BEFORE
 * it deletes anything.
 *
 * This is the fix-one-thing-arms-the-downstream class: adding a NEW throw site to a function is
 * safe only if every caller reaches it before its irreversible steps.
 */
export function validateLayout(res, routerName) {
  for (const f of res.files) {
    const declared = partRouterOf(f.text);
    if (declared !== null && declared !== routerName) {
      throw new Error(
        `layout: ${f.file} declares 'router: ${declared}' but belongs to ${routerName} — ` +
        `pass --router-name (CLI) or opts.routerName (API) so the shards and the router agree`,
      );
    }
  }
}

/**
 * Read-only fleet scan: which ROUTERS are behind their current shard.
 *
 * ⛔ ROUTER-KEYED, NOT DIRECTORY-KEYED, AND THAT IS THE WHOLE POINT. Every sweep written for
 * this problem before this one — including three review lenses' and two of my own — enumerated
 * DIRECTORIES and resolved `<dir>/MEMORY.md`. `.claude/skills/meta` holds TWO sharded layouts
 * (MEMORY.md and CHANGELOG.md), so all of them reported the fleet clean while CHANGELOG sat 4
 * sections behind its index. The obligation is "every router is current", and the unit of that
 * obligation is a ROUTER; a dir-keyed walk is the wrong axis, exhaustive and green over the
 * wrong set.
 *
 * ⛔ WHY THIS LIVES IN THE TOOL RATHER THAN IN A SKILL-SPEC SHELL LOOP. `--roll` on a CLASSIC
 * dir does not decline — it CONVERTS it (the `isClassic` short-circuit is deliberate; the
 * conversion is the point there). There are 47 classic dirs. A caller-side shell loop over the
 * skills directories is therefore one forgotten `--dry-run` away from converting the fleet.
 * Enumerating here removes that hazard by construction: this function selects sharded layouts
 * and has no write path at all.
 *
 * PURE. `rollLayout` computes and returns; `writeLayout` is the only function in this mode that
 * touches disk and is never called here. The test asserts that with a whole-tree fingerprint —
 * do not let a "just heal it while we're here" convenience in.
 */
export function scanRouters(skillsDir = ".claude/skills", opts = {}) {
  const out = [];
  for (const entry of fs.readdirSync(skillsDir).sort()) {
    const dir = path.join(skillsDir, entry);
    let st;
    try { st = fs.statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;

    // ⛔ DERIVE THE ROUTER SET FROM THE SHARDS' OWN DECLARATIONS — never from a filename, a
    // marker, or "this file has manifest-shaped rows". The first version of this did the last
    // one and produced two FALSE positives on the live corpus: a skill spec
    // (14 ordinary table rows) and a qa-expert SHARD (16). Both are just markdown tables.
    // A SPLIT_MARKER scan is no better and is the heuristic that was deliberately removed:
    // 26 files on this repo contain that string and exactly one was a router. The authoritative
    // link is the one added for this purpose — each shard's generated PART header names
    // its owning router, read by partRouterOf. Verified 2026-08-10: 41 of 41 shards declare one.
    //
    // ⛔ AND THE SHARD DECLARATIONS ARE NOT SUFFICIENT ON THEIR OWN. Routers
    // carry NO PART header (measured: 0 in a router, 1 in a shard), so a dir that has lost
    // EVERY shard declares no owner, is skipped entirely, and the scan reports
    // `scanned=0 needs-attention=0 rc=0`. Measured on a copy, unpiped:
    //     intact but merely stale     scanned=1  needs-attention=1  rc=1
    //     after losing the ONLY shard scanned=0  needs-attention=0  rc=0
    // THE EXIT CODE INVERTED ON SEVERITY — clean on total content loss, dirty on a benign stale
    // index — and one expert has exactly one shard, so for it "lose one" and "lose
    // all" are the same event. Found by a review lens, not by me.
    //
    // So UNION the declarations with the router's own generated banner, which survives total
    // shard loss because it lives in the router. The banner is the FULL generated sentence, not
    // the bare SPLIT_MARKER: measured, the bare string matches 27 files (the use-vs-mention
    // heuristic since removed) and the full line matches exactly the 10 real routers.
    // Contiguity is NOT a usable discriminator here — that skill spec carries 14
    // manifest-shaped rows numbered 1..14, so a contiguity union re-admits the false positive.
    const routers = new Set();
    for (const file of fs.readdirSync(dir).sort()) {
      if (!file.endsWith(".md")) continue;
      let text;
      try { text = fs.readFileSync(path.join(dir, file), "utf8"); }
      catch { continue; /* unreadable sibling — not this scan's business */ }
      const owner = partRouterOf(text);
      if (owner) routers.add(owner);              // a shard naming its router
      if (text.includes(ROUTER_BANNER_MARK)) routers.add(file); // a router naming itself
    }

    for (const file of [...routers].sort()) {
      let shape;
      try { shape = detectLayoutShape(dir, file); } catch { continue; }
      if (shape.shape === "broken") {
        out.push({ dir, router: file, verdict: "BROKEN", detail: shape.reason });
        continue;
      }
      if (shape.shape !== "sharded") continue; // classic / unsplit / absent are not this scan's business
      try {
        // opts THREADED, not defaulted: a caller with explicit caps (a test fixture, a probe)
        // must be measured against ITS caps, or the projection re-shards at production sizes and
        // every router reads STALE. Measured while writing the negative control for this.
        const r = rollLayout(dir, { ...opts, routerName: file });
        // REGISTER-OVER-CAP outranks STALE: a named register past the cap keeps the dir in
        // needs-attention (the signal survives) but names a remedy that EXISTS — curation —
        // instead of the roll that cannot cut it.
        const verdict = r.rolled
          ? "ROLL-DUE"
          : r.registerOver?.length
            ? "REGISTER-OVER-CAP"
            : r.routerStale === true
              ? "STALE"
              : r.routerStale === null
                ? "UNKNOWN"
                : "current";
        out.push({ dir, router: file, verdict, detail: r.reason });
      } catch (err) {
        out.push({ dir, router: file, verdict: "ERROR", detail: String(err?.message ?? err).split("\n")[0] });
      }
    }
  }
  return out;
}

export function writeLayout(dir, res, routerName = "MEMORY.md") {
  if (routerName.includes("/") || routerName.includes("..")) {
    throw new Error(`routerName must be a bare filename, got ${JSON.stringify(routerName)}`);
  }
  // ⛔ THE SHARDS AND THE ROUTER MUST AGREE ON WHO OWNS THEM, AND UNTIL NOW THEY
  // COULD NOT DISAGREE *VISIBLY*. `splitMemorySharded` renders the PART headers and
  // `writeLayout` names the router; they are two sources for ONE fact, and nothing compared
  // them. Caught by an existing self-test arm the moment shards began declaring an
  // owner: a caller that split with the default and wrote as "CHANGELOG.md" produced shards
  // stamped `router: MEMORY.md`, which then read back as MEMORY's strays. Same shape as the
  // flag-wins and two-names-one-concept defects fixed earlier the same day.
  // Fails CLOSED: a mismatch is a caller bug, and writing it would corrupt BOTH layouts.
  validateLayout(res, routerName);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of res.files) fs.writeFileSync(path.join(dir, f.file), f.text);
  fs.writeFileSync(path.join(dir, routerName), res.router);
}

/**
 * Name of the intent record written INSIDE the staging dir before the first rename. It is what
 * turns a torn swap from a hand-repair into a resumable one. Deliberately dot-prefixed and inside
 * the (git-ignored) staging dir, so it can never be mistaken for a layout file: it is not in
 * `res.files`, so the rename loop never moves it, and it dies with the staging dir on success.
 */
export const ROLL_JOURNAL = ".journal.json";

/**
 * md5 of a path's content, or null when it is not a READABLE REGULAR FILE (absent, or a directory
 * squatting the name). Used for the roll journal's pre-swap fingerprints and for re-checking them.
 * A bare `readFileSync` here throws EISDIR on a squatted path and takes the whole journal write
 * down with it — caught at once by a self-test arm that models exactly that squat.
 */
function fileMd5OrNull(p) {
  try {
    if (!fs.statSync(p).isFile()) return null;
    return md5(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/** fsync a DIRECTORY, so a rename INTO it is durable and not merely visible to this process. */
function fsyncDir(d) {
  const fd = fs.openSync(d, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * ⛔ The lock half of making the roll transactional. O_EXCL directory lock.
 *
 * There is ONE corpus per skill dir and every seat can run `--roll`, so two concurrent rolls are
 * a lost update whose window is the whole operation (seconds), not the write syscall.
 * `openSync(..., "wx")` is O_CREAT|O_EXCL — atomic, with no check-then-act gap of its own.
 *
 * REFUSES; NEVER BREAKS A STALE LOCK. Auto-breaking re-introduces the exact race it exists to
 * close, because two seats can both decide the same lock is stale. The shipped precedent for a
 * shared-state gate in this repo is `safe-commit.sh`: print, exit non-zero, a human repairs.
 * The cost of a wrong refusal is one `rm`; the cost of a wrong break is a torn corpus.
 */
const ROLL_LOCK_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"];

/**
 * ⛔ A RECOVERY PATH MUST NOT DEPEND ON A LOCK THE FAILURE IT RECOVERS FROM LEAVES HELD.
 * SIGKILL, OOM and power loss are untrappable, so `finally` and the signal handlers above all
 * skip — and that is precisely the class the journal exists for. Measured: a real SIGKILL 380 ms
 * into a roll left `.roll.lock` held by the dead pid; the resume then DETECTED the tear, PRINTED
 * ITS PLAN, and threw a raw stack on the lock. The advertised automatic recovery was unreachable
 * for its own headline failure mode.
 * Breaking a stale lock is normally forbidden here (two seats can both decide a lock is stale).
 * It is safe in THIS ONE PLACE because the journal makes the intent explicit and the pid is
 * checked: `kill(pid, 0)` throws ESRCH only when no such process exists. A LIVE pid still refuses.
 */
export function breakDeadRollLock(dir) {
  const lock = path.join(dir, ".roll.lock");
  let held;
  try {
    held = fs.readFileSync(lock, "utf8");
  } catch {
    return null; // no lock — nothing to break
  }
  const pid = Number((held.match(/pid (\d+)/) ?? [])[1]);
  if (!Number.isInteger(pid) || pid <= 0) return null; // unparseable holder — refuse, human repairs
  try {
    process.kill(pid, 0);
    return null; // holder is ALIVE — leave it alone, acquireRollLock will refuse loudly
  } catch (e) {
    if (e.code !== "ESRCH") return null; // EPERM etc: cannot prove it is dead, so do not break it
  }
  fs.rmSync(lock, { force: true });
  return pid;
}

export function acquireRollLock(dir) {
  const lock = path.join(dir, ".roll.lock");
  let fd;
  try {
    fd = fs.openSync(lock, "wx");
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    let held = "";
    try {
      held = fs.readFileSync(lock, "utf8").trim().replace(/\s+/g, " ");
    } catch {
      /* an unreadable holder record is not a reason to proceed */
    }
    throw new Error(
      `${lock} exists — another roll holds this directory (${held || "no holder recorded"}). ` +
        `REFUSING rather than breaking it: two concurrent rolls are a lost update. ` +
        `If that process is gone, remove it yourself: rm ${JSON.stringify(lock)}`,
    );
  }
  try {
    fs.writeFileSync(fd, `pid ${process.pid} started ${new Date().toISOString()}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // ⛔ SIGNAL PATH — `finally` DOES NOT RUN ON SIGINT/SIGTERM, so without this the lock outlives the
  // process (measured: a real SIGINT at 300 ms and at 350 ms into a ~471 ms roll each left
  // `.roll.lock` present plus an orphaned staging dir; at 400 ms the roll had finished and both were
  // clean). Refusing-not-breaking is still the design — the defect is COMPOSITION: an interrupted
  // operator is told to repair, and their next invocation refuses on a lock whose holder is gone,
  // so they face two sequential hand-repairs instead of one. Release, then re-raise so the exit
  // status still reads as a signal death rather than a clean exit.
  const release = function releaseRollLock() {
    for (const sig of ROLL_LOCK_SIGNALS) process.removeListener(sig, onSignal);
    try {
      fs.rmSync(lock, { force: true });
    } catch {
      /* best-effort release — a leftover lock refuses LOUDLY next time, which is the safe way to fail */
    }
  };
  const onSignal = (sig) => {
    release();
    process.kill(process.pid, sig);
  };
  // SIGHUP is a terminal close or an SSH disconnect; SIGQUIT is Ctrl-\\. Both were measured
  // leaving the lock behind (arm-gated probe: signals sent only after acquire returns, so the
  // handlers were provably registered). SIGKILL stays untrappable by construction — that is what
  // the dead-pid break in the resume branch is for.
  for (const sig of ROLL_LOCK_SIGNALS) process.once(sig, onSignal);
  return release;
}

/**
 * ⛔ The durability half of making the roll transactional. DELETE-LAST layout commit.
 *
 * The sequence this replaces was `rmSync(removed…)` then N sequential `writeFileSync`. A kill
 * anywhere in that loop left content DELETED and its replacement unwritten — a torn layout, no
 * backup, and `conservation: OK` already printed (it runs pre-write, in-process). Same family as
 * the `validateLayout` hoist, where a throw AFTER the rmSync loop was the difference between refusing to act and
 * destroying the thing being protected.
 *
 * THE INVARIANT: NOTHING IS DELETED UNTIL EVERY REPLACEMENT IS DURABLE ON DISK. Write the whole
 * new set into a staging dir on the SAME filesystem (so the renames cannot fail for lack of
 * space and are atomic per path), fsync each file and the staging dir, rename each into place,
 * fsync the target dir, and only THEN remove the shards the roll retired.
 *
 * ⚠️ THIS IS NOT AN ATOMIC MULTI-FILE SWAP, and claiming one would be the fail-open remedy this
 * repo keeps measuring. POSIX has no such primitive. A kill mid-rename leaves a MIX of old and
 * new files — acceptable, because the asymmetry runs the right way: the surviving state is always
 * a SUPERSET of the corpus (the old file is still there, or the new one is already in place),
 * never a subset. There is no state in which a body exists nowhere, which is the only property
 * the old sequence could not offer.
 *
 * ⛔ BUT "RE-RUNNING RECOVERS IT" WAS FALSE, AND IT WAS THE SENTENCE PRINTED TO THE OPERATOR AT THE
 * MOMENT OF FAILURE (review find, measured). `loadLayout` enforces a BIJECTION between the router
 * manifest and the on-disk PART-header set — a listed file that is absent throws, and a stray file
 * carrying a PART header that the manifest does not list throws. A partial multi-file swap violates
 * one direction or the other BY CONSTRUCTION, so no rename ordering yields a loadable intermediate
 * and no re-run can converge; `--dry-run` throws too, so the operator cannot even inspect. Measured
 * on a copy of the real meta corpus: kill after rename 5 of 22 re-runs clean (those are same-name
 * overwrites), kill after the first NEW-name rename → rc=1 "carries a PART header but is absent
 * from the router manifest — resolve by hand".
 *
 * The vulnerable window is the first new-name rename through the last delete. The content-safety
 * claim above survived the same experiment intact — 6 lines absent, ALL router-generated, zero
 * entry bodies — so the invariant is right and only the recovery advice was wrong. The remedy is
 * the preserved staging dir plus the explicit repair text in the `finally` below; a resumable
 * journal is the real fix and is filed, not built here.
 */
export function commitLayoutDurably(dir, res, routerName, removed = [], onBeforeSwap = null) {
  validateLayout(res, routerName);
  // ⛔ SECOND DEBT OF THE REORDERING, and I introduced it. `writeLayout` TOLERATED a router that
  // also appeared in res.files — it wrote the file, then wrote the router over it. The rename
  // loop cannot: the first rename consumes the staged path and the second throws ENOENT
  // MID-SWAP (measured), which is precisely the torn state this function exists to prevent.
  // So a shape the old code absorbed silently becomes the new code's worst outcome. Fail CLOSED,
  // before ANYTHING is staged, rather than discovering it half-way through the swap.
  if (res.files.some((f) => f.file === routerName)) {
    throw new Error(
      `layout: ${routerName} appears in res.files AND as the router — refusing before staging, ` +
        `because the rename loop would ENOENT mid-swap`,
    );
  }
  // ⛔ INVARIANT DROPPED IN THE REWRITE (review find). `writeLayout` guards this and
  // `commitLayoutDurably` did not, so an exported API that replaced it silently lost a check the
  // original had: measured, `routerName: "../escaped.md"` wrote OUTSIDE the target dir. Not
  // reachable through today's CLI (loadLayout carries the same guard and runs first) — which is
  // exactly why it would have sat here until some future caller made it reachable.
  if (routerName.includes("/") || routerName.includes("..")) {
    throw new Error(`routerName must be a bare filename, got ${JSON.stringify(routerName)}`);
  }
  // ⛔ FAIL CLOSED ON THE OVERLAP, don't absorb it after the swap (review). The
  // `continue` further down survives as belt-and-braces, but it sits AFTER the renames — throwing
  // there would produce the very torn state this function exists to prevent. Two guards for one
  // upstream bug class must not give opposite dispositions: both refuse, and they refuse HERE,
  // before a single byte is staged. `changes` makes this set empty by construction today.
  const overlap = removed.filter((n) => n === routerName || res.files.some((f) => f.file === n));
  if (overlap.length > 0) {
    throw new Error(
      `layout: ${overlap.join(", ")} appears in BOTH the removed set and the new file set — ` +
        `refusing before staging; the roll's own change-classification should make this impossible`,
    );
  }
  fs.mkdirSync(dir, { recursive: true });
  const staging = fs.mkdtempSync(path.join(dir, ".roll-staging-"));
  // TORN-STATE BOOKKEEPING. `swapStarted` flips at the FIRST rename: before it, the live layout is
  // untouched and staging is disposable; after it, staging holds the only copy of whatever has not
  // landed yet, and deleting it destroys the recovery material. See the `finally`.
  let swapStarted = false;
  let completed = false;
  try {
    const files = [...res.files, { file: routerName, text: res.router }];
    // ⛔ STAGE AND RENAME ONLY WHAT ACTUALLY CHANGES — this narrows the silent peer-loss case.
    // A roll renamed all 22 files when 2 had changed ({"unchanged":20,"created":1,"removed":1,
    // "changed":1}), so every UNCHANGED file spent the swap window being pointlessly replaced by
    // a byte-identical copy — and a peer append landing on one of those in that window was lost
    // with no signal at all (still loads, still conserves, still passes duplicate-L#). Renaming
    // only changed+created+router shrinks the exposed set ~10x. It cannot shrink it to zero: the
    // real fix is a lock the APPEND path also takes, which is a design item, not this.
    // `files` stays the FULL set on purpose — it feeds `keep`, the journal's `final`, and the
    // postcondition, all of which must describe the whole layout, not just the part we touched.
    const toStage = files.filter((f) => fileMd5OrNull(path.join(dir, f.file)) !== md5(f.text));
    for (const f of toStage) {
      const fd = fs.openSync(path.join(staging, f.file), "w");
      try {
        fs.writeFileSync(fd, f.text);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    }
    fsyncDir(staging);
    // ⛔ THE CALLER'S RACE CHECK RUNS HERE — AFTER STAGING, IMMEDIATELY BEFORE THE SWAP.
    // Staging a ~460 KB corpus with an fsync per file is not instant, so a re-read performed
    // before it is already stale by the time the renames land: the peer window would be the
    // whole staging write. Hoisting it to the last possible instant shrinks that window to the
    // rename loop. Throwing from here unwinds through the `finally` below, so a race leaves the
    // staging dir cleaned and NOT ONE byte of the live layout touched.
    if (onBeforeSwap) onBeforeSwap();
    // ⛔ THE JOURNAL IS WRITTEN AND FSYNC'D BEFORE THE FIRST RENAME — this is what makes the swap
    // RESUMABLE, and it is the real remedy for the review's finding. Durability alone was never the
    // gap: content survived every kill. The gap was that `loadLayout` requires manifest and disk
    // to agree in BOTH directions, so a partial swap is unloadable and NO re-run could converge.
    // With the final file set and the retired set recorded here, `findResumableRoll` can detect
    // the tear on the next invocation and `resumeRoll` can finish it deterministically, without
    // having to re-derive anything from a layout that no longer loads.
    const keep = new Set(files.map((f) => f.file));
    const jfd = fs.openSync(path.join(staging, ROLL_JOURNAL), "w");
    try {
      fs.writeFileSync(
        jfd,
        `${JSON.stringify(
          {
            version: 1,
            routerName,
            final: [...keep],
            retired: removed.filter((n) => !keep.has(n)),
            // ⛔ PRE-SWAP FINGERPRINTS — WITHOUT THESE THE RESUME CANNOT BE PEER-SAFE, AND THE
            // OMISSION WAS NOT A MISSING NICETY BUT A REGRESSION OF A GUARANTEE THE FORWARD PATH
            // HOLDS (review find). `onBeforeSwap` md5-re-reads the corpus and aborts
            // with `roll: RACE` because even the ~1s staging window is too wide to trust. The
            // resume re-opens that window to UNBOUNDED — from the tear until whoever next runs
            // --roll, which may be a different session hours later — so it needs the same check.
            // The first journal recorded no content hash of any kind, which made the check not
            // merely omitted but IMPOSSIBLE with what was on disk.
            // Recorded here is the state of `dir` AS THE SWAP BEGINS: for a `final` name, the OLD
            // file it will overwrite (null if it does not exist yet); for a `retired` name, the
            // file that will be deleted. `resumeRoll` refuses on any mismatch.
            preSwap: Object.fromEntries(
              [...keep, ...removed.filter((n) => !keep.has(n))].map((n) => {
                return [n, fileMd5OrNull(path.join(dir, n))];
              }),
            ),
            startedAt: new Date().toISOString(),
            pid: process.pid,
          },
          null,
          2,
        )}\n`,
      );
      fs.fsyncSync(jfd);
    } finally {
      fs.closeSync(jfd);
    }
    fsyncDir(staging);
    for (const f of toStage) {
      swapStarted = true;
      fs.renameSync(path.join(staging, f.file), path.join(dir, f.file));
    }
    fsyncDir(dir);
    // ⛔ THE REORDERING INVERTS THE OLD SEMANTICS, AND THIS SET-GUARD IS WHAT PAYS FOR IT.
    // The previous code deleted BEFORE writing, so a name appearing in BOTH the removed set and
    // the new file set was removed and then re-created — correct, but only by accident of order.
    // Writing first makes the same overlap DESTROY the file just written. The overlap should not
    // occur (such a file classifies as `changed`, not `removed`), and relying on that unstated
    // premise is precisely the shape this file keeps getting burned by, so it is asserted here.
    for (const name of removed) {
      if (keep.has(name)) continue;
      fs.rmSync(path.join(dir, name), { force: true });
    }
    fsyncDir(dir);
    completed = true;
  } finally {
    // ⛔ DO NOT DELETE STAGING ON A TORN SWAP — IT IS THE RECOVERY MATERIAL (review find).
    // This cleanup used to be unconditional, so a `renameSync` failure mid-loop (reproduced with
    // EISDIR against a squatting directory) left the dir half-swapped AND destroyed the only copy
    // of the files that had not landed. Before the first rename there is nothing to preserve and
    // the dot-dir is pure litter; after it, staging is the difference between a hand-repair and a
    // reconstruction. Both states are now git-ignored, so keeping it cannot leak into a commit.
    if (swapStarted && !completed) {
      console.error(
        `\n⛔ TORN SWAP in ${dir} — the layout is PART-WAY between old and new.\n` +
          `   Content is intact: every body exists in one file or the other. But \`loadLayout\`\n` +
          `   requires the manifest and the disk to agree in BOTH directions, so the layout does\n` +
          `   not load right now and any planning read throws.\n` +
          `\n` +
          `   RECOVERY IS AUTOMATIC — re-run the same command:\n` +
          `     node scripts/memory-tier-split.mjs --roll ${dir}\n` +
          `   An intent journal was fsync'd before the first rename, so the next invocation\n` +
          `   detects the tear and finishes the swap deterministically rather than re-deriving\n` +
          `   from a layout that cannot be read. Add --dry-run first to see what it will do.\n` +
          `   The staged remainder is preserved at ${staging} — do NOT delete it.\n` +
          `\n` +
          `   ⚠️ Until it is resumed, the old and new shards BOTH sit in the MEMORY*.md union\n` +
          `   that check-lesson-numbers.mjs reads, so the duplicate-L# pre-push gate blocks\n` +
          `   EVERY session's push.\n`,
      );
    } else {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
}

/**
 * Detect a torn swap left by an interrupted `commitLayoutDurably`.
 *
 * MUST be callable on a layout that does NOT load — that is the entire point. It reads only a
 * directory listing and one JSON file, never `loadLayout`, because on a torn dir `loadLayout`
 * throws in both directions and would take the repair path down with it.
 *
 * An unparseable or unversioned journal returns null rather than guessing: a half-written journal
 * is the one artifact we must not act on, and leaving it for a human is the safe direction.
 */
export function findResumableRoll(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of entries) {
    if (!name.startsWith(".roll-staging-")) continue;
    const staging = path.join(dir, name);
    const jp = path.join(staging, ROLL_JOURNAL);
    if (!fs.existsSync(jp)) continue; // staged but never reached the swap — nothing to finish
    try {
      const journal = JSON.parse(fs.readFileSync(jp, "utf8"));
      if (journal && journal.version === 1 && Array.isArray(journal.final)) return { staging, journal };
    } catch {
      /* half-written journal — refuse to guess */
    }
  }
  return null;
}

/**
 * Finish an interrupted swap from its journal. IDEMPOTENT: every step is existence-checked, so
 * re-running after a second interruption converges rather than compounding.
 *
 * Ordering is the same invariant the forward path holds — every surviving staged file is moved
 * into place BEFORE anything is retired, so an interruption during the resume is itself resumable.
 */
export function resumeRoll(dir, pending) {
  const { staging, journal } = pending;
  const keep = new Set(journal.final);
  const cur = (n) => fileMd5OrNull(path.join(dir, n));
  // ⛔ VERIFY BEFORE DESTROY. Reached independently by two review lenses via two routes.
  // The forward path treats this race as FATAL — `onBeforeSwap` md5-re-reads and aborts with
  // `roll: RACE` because even the ~1s staging window is too wide. The resume re-opens that
  // window to UNBOUNDED (tear -> operator notices -> operator resumes, possibly a different
  // session hours later) and originally checked NOTHING, so a peer append landing in that
  // window was overwritten or deleted and the run still printed "Layout is consistent again"
  // with zero forensic trace. That is a REGRESSION of a guarantee the forward path holds.
  if (!journal.preSwap) {
    throw new Error(
      `resume REFUSED — ${path.join(staging, ROLL_JOURNAL)} predates pre-swap fingerprints, so a ` +
        `peer edit made since the tear cannot be detected. Staging preserved; repair by hand.`,
    );
  }
  const stale = [];
  for (const name of journal.final) {
    // A file still in staging has NOT landed, so `dir` must still hold exactly the pre-swap
    // content the roll read. One that already landed holds the NEW content by design — there is
    // nothing to compare it against, and checking it would false-positive on our own work.
    if (fs.existsSync(path.join(staging, name)) && cur(name) !== (journal.preSwap[name] ?? null)) {
      stale.push(name);
    }
  }
  for (const name of journal.retired ?? []) {
    if (keep.has(name)) continue;
    if (cur(name) !== (journal.preSwap[name] ?? null)) stale.push(name);
  }
  if (stale.length) {
    throw new Error(
      `resume REFUSED — changed on disk since the tear: ${stale.join(", ")}.\n` +
        `  Someone edited these after the interrupted roll read them. Completing the swap would ` +
        `overwrite or delete that work silently.\n` +
        `  NOTHING has been changed and the staged remainder is preserved at ${staging}.\n` +
        `  Reconcile the edit by hand, then delete the staging dir to abandon the resume.`,
    );
  }

  const moved = [];
  for (const name of journal.final) {
    const src = path.join(staging, name);
    if (!fs.existsSync(src)) continue; // already landed before the interruption
    fs.renameSync(src, path.join(dir, name));
    moved.push(name);
  }
  fsyncDir(dir);
  // ⛔ POSTCONDITION BEFORE ANY DESTRUCTION. A `final` name in NEITHER staging nor `dir` was
  // silently skipped above, and the run then retired the old shards and deleted staging —
  // producing a permanently torn, UNRESUMABLE layout while printing success. Assert first:
  // retiring and cleanup are the irreversible half, so nothing may proceed on a broken premise.
  const missing = journal.final.filter((n) => !fs.existsSync(path.join(dir, n)));
  if (missing.length) {
    throw new Error(
      `resume REFUSED — in neither staging nor ${dir}: ${missing.join(", ")}.\n` +
        `  The journal lists these as final, so retiring the old shards now would leave a layout ` +
        `that cannot load and cannot be resumed.\n` +
        `  Nothing retired, staging preserved at ${staging}.`,
    );
  }
  const retired = [];
  for (const name of journal.retired ?? []) {
    if (keep.has(name)) continue;
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) continue;
    fs.rmSync(p, { force: true });
    retired.push(name);
  }
  fsyncDir(dir);
  fs.rmSync(staging, { recursive: true, force: true });
  return { moved, retired };
}

// ------------------------------------------------------------------- driver

function resolveTarget(arg) {
  if (arg.includes("/") || arg.endsWith(".md")) {
    return arg.endsWith(".md") ? arg : path.join(arg, "MEMORY.md");
  }
  return path.join(SKILLS_DIR, arg, "MEMORY.md");
}

function processOne(file, { dryRun, target, hardCap, trailingDate }) {
  const cap = hardCap ?? HARD_CAP_BYTES;
  const raw = fs.readFileSync(file, "utf8");
  const inputMd5 = md5(raw);

  // Idempotence guard — see SPLIT_MARKER. Checked BEFORE any parse so a repeat
  // invocation cannot reach the archive write.
  if (raw.includes(SPLIT_MARKER)) {
    throw new Error(
      `ALREADY SPLIT — refusing to re-split ${file}. Re-running would parse the ` +
        `index rows as entries AND overwrite MEMORY-ARCHIVE.md, destroying every ` +
        `body already archived. To re-split, restore the pre-split file first.`,
    );
  }
  const archivePath = path.join(path.dirname(file), "MEMORY-ARCHIVE.md");
  if (fs.existsSync(archivePath) && fs.statSync(archivePath).size > 0) {
    throw new Error(
      `ARCHIVE EXISTS — refusing to overwrite ${archivePath} (append-only cold store). ` +
        `Move or merge it deliberately before splitting again.`,
    );
  }

  const res = splitMemory(raw, { target, hardCap: cap, trailingDate });

  assertConservation(file, res.conservation);
  if (bytes(res.hot) > cap) {
    throw new Error(`HARD CAP BREACHED for ${file}: ${bytes(res.hot)} > ${cap}`);
  }

  if (!dryRun) {
    // Peer-safety: these are shared many-writer files. Re-read immediately
    // before writing and abort if the bytes moved since we parsed them —
    // a stale parse would silently drop whatever landed in the window.
    const nowMd5 = md5(fs.readFileSync(file, "utf8"));
    if (nowMd5 !== inputMd5) {
      throw new Error(`RACE: ${file} changed between read and write (${inputMd5} → ${nowMd5}) — re-run`);
    }
    fs.writeFileSync(path.join(path.dirname(file), "MEMORY-ARCHIVE.md"), res.archive);
    fs.writeFileSync(file, res.hot);
  }
  return res.stats;
}

function allOver(minBytes) {
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !EXCLUDED_SKILLS.has(d.name))
    .map((d) => path.join(SKILLS_DIR, d.name, "MEMORY.md"))
    .filter((f) => fs.existsSync(f) && fs.statSync(f).size > minBytes)
    .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
}

// ---------------------------------------------------------------- self-test

const FIXTURE = `<!-- preamble line one
     preamble line two -->

## Standing Principles
Never trust a green count.

## 2026-01-02 — First entry title
Body sentence one. Body sentence two continues here.
More body.
Revisit: when the second thing ships.

## 2026-03-04 — Second entry title
A single sentence body with no revisit line.

## 2026-05-06 — Third entry title
Third body first sentence. Trailing detail.
Revisit/trigger: at the third occurrence.
`;

function selfTest() {
  let failures = 0;
  const ok = (label, cond, detail = "") => {
    console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
    if (!cond) failures++;
  };

  console.log("SELF-TEST — GREEN arm (real splitMemory over fixture)");
  // Budget chosen so BOTH tiers are exercised: the hard cap is roomy enough for
  // the ladder to pick a real digest length (a too-tight cap drives it to 0 and
  // silently makes every digest assertion below unfailable), while the target is
  // tight enough that entries actually get archived.
  const green = splitMemory(FIXTURE, { target: 900, hardCap: 4000 });
  ok("both tiers exercised (≥1 archived)", green.conservation.entriesArchived >= 1);
  ok("ladder picked a non-zero digest cap", green.stats.digestCap > 0, `cap=${green.stats.digestCap}`);
  ok("conservation ok", green.conservation.ok, JSON.stringify(green.conservation));
  ok("all 3 entries accounted", green.conservation.entriesTotal === 3);
  ok(
    "hot + archive cover every heading",
    ["2026-01-02", "2026-03-04", "2026-05-06"].every(
      (d) => (green.hot + green.archive).includes(`## ${d} —`),
    ),
  );
  ok("preamble retained verbatim", green.hot.includes("preamble line two"));
  ok("non-date section retained verbatim", green.hot.includes("Never trust a green count."));
  ok("banner present", green.hot.includes("MEMORY-ARCHIVE.md (same dir)"));
  ok("index covers every entry", green.hot.split("\n").filter((l) => /^- 20\d\d-/.test(l)).length === 3);
  ok("digest carries first sentence", green.hot.includes("Body sentence one."));
  ok("digest carries Revisit clause", green.hot.includes("Revisit: when the second thing ships"));
  ok("Revisit/trigger variant captured", green.hot.includes("at the third occurrence"));
  ok("archive marked append-only", green.archive.includes("APPEND-ONLY COLD STORE"));
  ok("archive holds a full body", green.archive.includes("Body sentence two continues here."));

  // ------------------------------------------------------- legacy bullet era
  // Predicate validated against the REAL corpus shapes, not invented ones: all
  // three variants below are copied from the legacy-era expert memory files. The undated principles bullet is the NEGATIVE control —
  // it shares the list-item shape and must NOT be parsed as an entry.
  console.log("\nSELF-TEST — legacy dated-bullet era");
  const LEGACY_FIXTURE = `<!-- preamble -->

## Voice Principles
- Tone: peer mentor, factual, no exclamation marks.
- Copy must work across tiers and all 11 locales.

## Per-Audit Entries

- [2026-04-16] Share dialog final audit — share dialog copy: 10 tasks shipped. Second sentence.

- **2026-04-07 — Homepage Audit (panel):** Approved with fixes. More detail here.

- **2026-04-14 | Final Audit — critique result hierarchy** — PASS WITH FINDINGS. Detail.

## 2026-07-01 — Modern era entry
A modern H2 entry body.
Revisit: never.
`;
  const lg = splitMemory(LEGACY_FIXTURE, { target: 900, hardCap: 4000 });
  ok("legacy conservation ok", lg.conservation.ok, JSON.stringify(lg.conservation));
  ok("3 legacy bullets + 1 H2 parsed as 4 entries", lg.conservation.entriesTotal === 4,
    `got ${lg.conservation.entriesTotal}`);
  const lgRows = lg.hot.split("\n").filter((l) => /^- 20\d\d-/.test(l));
  ok("index has a row per entry", lgRows.length === 4, `${lgRows.length} rows`);
  ok("legacy dates indexed", ["2026-04-16", "2026-04-07", "2026-04-14"].every((d) => lg.hot.includes(d)));
  ok(
    "NEGATIVE control: undated principles bullets stay hot, not parsed as entries",
    lg.hot.includes("Tone: peer mentor") && lg.hot.includes("all 11 locales") && lgRows.length === 4,
  );
  ok("umbrella heading residue stays hot", lg.hot.includes("## Per-Audit Entries"));
  ok(
    "legacy bodies verbatim in archive (bullet marker + date intact)",
    lg.archive.includes("- [2026-04-16] Share dialog final audit") &&
      lg.archive.includes("- **2026-04-07 — Homepage Audit (panel):**"),
  );
  const titleRow = lgRows.find((r) => r.includes("2026-04-07"));
  ok("title cut at the shape's own terminator", /Homepage Audit \(panel\)/.test(titleRow), titleRow);
  ok("digest does NOT echo the title back", !/panel\).*panel\)/.test(titleRow));
  // MUTATION: a legacy body edit must red the md5 arm exactly like an H2 body.
  const lgAll = [...lg.kept, ...lg.archived];
  const lgIdx = lgAll.findIndex((b) => b.legacy);
  ok("a legacy entry exists to mutate", lgIdx >= 0);
  const lgMut = lgAll.map((b, i) => (i === lgIdx ? { ...b, body: `${b.body}Z` } : b));
  ok("mutation landed", lgMut[lgIdx].body !== lgAll[lgIdx].body);
  ok("RED: legacy body edit ⇒ ok:false", checkConservation(lg.dated, lgMut).ok === false);

  // ------------------------------------------- digest extractor: degenerate shapes
  // Both shapes are copied from a rolled router: a body opening with a numbered
  // list digested to "— 1-3.", and a body opening in bold kept the closer of a `**` whose opener
  // the lead strip ate. Driven through digestOf + renderDigest, the pair both index renderers call.
  console.log("\nSELF-TEST — digest extractor (leading list marker, cut-orphaned emphasis)");
  const listD = digestOf({ body: "1-3. The rule reached three skills. Then more.\n4. Next item." });
  ok("ARM list marker: a numbered range is skipped, not returned as the digest",
    listD.sentence === "The rule reached three skills.", JSON.stringify(listD.sentence));
  ok("list marker: a plain `1.` is skipped too",
    digestOf({ body: "1. Plain item. Rest." }).sentence === "Plain item.");
  const boldRow = renderDigest(digestOf({ body: "**Context read.** Previous cycle 2026-09-26 (`<session-id>`). Since then." }), 240);
  ok("ARM unbalanced **: the closer whose opener the lead strip ate is dropped",
    boldRow === "Context read. Previous cycle 2026-09-26 (`<session-id>`).", JSON.stringify(boldRow));
  const revD = digestOf({ body: "Body.\n**Revisit:** when the arm ships" });
  ok("unbalanced **: the closer the Revisit label cut off is dropped",
    revD.revisit === "when the arm ships", JSON.stringify(revD.revisit));
  const truncRow = renderDigest({ sentence: "Did X with **a long bold phrase that runs past the cap** and more.", revisit: "" }, 30);
  ok("unbalanced **: the opener the cap truncation orphaned is dropped",
    truncRow === "Did X with a long bold…", JSON.stringify(truncRow));
  // NEGATIVE control: markers the AUTHOR left unpaired, and pairs the cut kept whole, are text.
  const litRow = renderDigest(digestOf({ body: "_DSC5535 vs utm_* and count(*) stay, as do **bold** and `code`. Next." }), 240);
  ok("NEGATIVE: author literals and intact pairs survive byte-for-byte",
    litRow === "_DSC5535 vs utm_* and count(*) stay, as do **bold** and `code`.", JSON.stringify(litRow));
  // ⛔ THE NEGATIVE ARM ABOVE CANNOT FAIL FOR ANY PAIRING MUTANT: every marker in it sits INSIDE
  // the slice, and sliceBalanced only ever drops a marker whose partner is OUTSIDE. Each arm below
  // puts a would-be partner on the far side of a cut, so a wrong pairing drops a literal. Measured
  // in review: no flanking test at all, or `_` paired like `*`, left all 98 arms
  // green while changing 4 and 7 real routers.
  const snakeD = digestOf({ body: "Keep snake_case here. Then another_name." });
  ok("FLANKING: an intraword `_` stays literal when a later `_` sits past the cut",
    snakeD.sentence === "Keep snake_case here.", JSON.stringify(snakeD.sentence));
  const spacedD = digestOf({ body: "Compute a * b here. Then c * d." });
  ok("FLANKING: a spaced `*` stays literal when a later `*` sits past the cut",
    spacedD.sentence === "Compute a * b here.", JSON.stringify(spacedD.sentence));
  // Since the code-mask fix a SENTENCE cut can no longer
  // land inside a code span, so the cut that can orphan a backtick is the length TRUNCATION.
  const codeCut = renderDigest({ sentence: "Run `git log --oneline --decorate --all` now.", revisit: "" }, 20);
  ok("CODE: a backtick whose partner the truncation removed is dropped",
    codeCut === "Run git log --oneli…", JSON.stringify(codeCut));
  const codeStarD = digestOf({ body: "Run `rg '**'` here. Then `'**'` again." });
  ok("CODE: a `*` inside a code span stays literal when a later `*` sits past the cut",
    codeStarD.sentence === "Run `rg '**'` here.", JSON.stringify(codeStarD.sentence));
  const escD = digestOf({ body: "Escape \\*x here. Then y* z." });
  ok("ESCAPE: a backslash-escaped `*` is text, never a delimiter a cut can orphan",
    escD.sentence === "Escape \\*x here.", JSON.stringify(escD.sentence));
  const revTrunc = renderDigest({ sentence: "S.", revisit: "when **a long bold phrase runs past the cap** ships" }, 30);
  ok("unbalanced **: the opener a Revisit truncation orphaned is dropped",
    revTrunc === "S. | Revisit: when a long bold phrase…", JSON.stringify(revTrunc));
  // WIRING: every arm above calls renderDigest by hand, so an inline copy at either render site
  // passes them all. Drive both shipping renderers with a bold span straddling the 240 cap.
  const straddle = `Lead ${"word ".repeat(44)}**bold phrase that straddles the digest cap by a wide margin** end.`;
  const routerRow = splitMemorySharded(`# Memory\n\npreamble\n\n## 2026-01-01 — wiring entry\n${straddle}\n`, { skillDir: "/tmp/x" })
    .router.split("\n").find((l) => l.startsWith("- [·] 2026-01-01 — wiring entry")) ?? "";
  ok("WIRING router: routerDigestRows truncates through renderDigest (no orphaned **)",
    routerRow.includes("bold phrase…") && !routerRow.includes("**"), JSON.stringify(routerRow.slice(-60)));
  const classicRow = splitMemory(`# M\n\n## 2026-01-01 — wiring entry\n${straddle}\n\n## 2026-02-01 — other\nBody.\n`, { target: 200, hardCap: 4000 })
    .hot.split("\n").find((l) => l.startsWith("- 2026-01-01 — wiring entry")) ?? "";
  ok("WIRING classic: indexRow truncates through renderDigest (no orphaned **)",
    classicRow.includes("bold phrase…") && !classicRow.includes("**"), JSON.stringify(classicRow.slice(-60)));
  const provD = digestOf({ body: "_Returned by agent `a1` on 2026-09-13 to review hub `h1`; persisted later._\n\nThe real subject. More." });
  ok("ARM provenance: a whole-line `_…_` aside is skipped for the next line",
    provD.sentence === "The real subject.", JSON.stringify(provD.sentence));
  ok("provenance: a body that is ONLY the aside still digests to it",
    digestOf({ body: "_Returned by agent `a1`._" }).sentence === "_Returned by agent `a1`._");
  ok("NEGATIVE provenance: a line opening with an emphasis that closes mid-line is the subject",
    digestOf({ body: "_a_ and _b_ both. Next." }).sentence === "_a_ and _b_ both.");
  const qqD = digestOf({ body: "The consumer carried `x ?? y` into the view. Next." });
  ok("ARM code span: a `??` inside a code span ends no sentence",
    qqD.sentence === "The consumer carried `x ?? y` into the view.", JSON.stringify(qqD.sentence));

  console.log("\nSELF-TEST — determinism");
  const again = splitMemory(FIXTURE, { target: 900, hardCap: 4000 });
  ok("re-run byte-identical", again.hot === green.hot && again.archive === green.archive);

  console.log("\nSELF-TEST — roomy budget keeps everything hot");
  const roomy = splitMemory(FIXTURE, { target: TARGET_BYTES, hardCap: HARD_CAP_BYTES });
  ok("conservation ok", roomy.conservation.ok);
  ok("nothing archived", roomy.conservation.entriesArchived === 0);
  ok("recent-full section rendered", roomy.hot.includes("## Recent entries (full text)"));
  ok("full body present in HOT", roomy.hot.includes("Body sentence two continues here."));
  ok("archive is header-only", !/^## 20/m.test(roomy.archive));
  // Test the index ROWS, not the whole file — the banner legitimately contains
  // the literal "→ ARCHIVE" while explaining the convention, so a whole-file
  // substring check reads as a failure on correct output.
  const roomyRows = roomy.hot.split("\n").filter((l) => /^- 20\d\d-/.test(l));
  ok(
    "every index row points 'below' when nothing is archived",
    roomyRows.length === 3 && roomyRows.every((r) => r.endsWith("→ below")),
    `${roomyRows.length} rows`,
  );

  // ---------------------------------------------------------- RED controls
  // Every arm below drives the REAL exported checkConservation/assertConservation
  // — the same functions splitMemory and processOne call. A hand-rolled copy of
  // the guard would prove only that the copy works (tests-unit.md, decorative
  // -assertion class), so nothing here re-implements the oracle.
  console.log("\nSELF-TEST — RED controls (real checkConservation, mangled inputs)");

  // POSITIVE CONTROL FIRST — proves the detector CAN return true. Without this,
  // an oracle stuck at "fail" would make every RED below look like a pass.
  const okCase = checkConservation(green.dated, [...green.kept, ...green.archived]);
  ok("baseline: faithful split ⇒ ok:true (positive control on the ORACLE)", okCase.ok === true);

  // RED 1 — an entry silently DROPPED during re-collection.
  const dropped = checkConservation(green.dated, [...green.kept, ...green.archived].slice(0, -1));
  ok("RED: dropped entry ⇒ ok:false", dropped.ok === false, `missing=${dropped.missing}`);
  console.log(`    ${JSON.stringify(dropped)}`);

  // RED 2 — every heading still present, but ONE BODY altered by one character.
  // The heading-accounting arm PASSES here; only the md5 arm can catch it, so
  // this is the arm the whole check exists for.
  const all = [...green.kept, ...green.archived];
  const bodyEdited = all.map((b, i) => (i === 0 ? { ...b, body: `${b.body}X` } : b));
  // ⛔ ASSERT THE MUTATION LANDED BEFORE READING THE RESULT. A substring-replace
  // mutation here was silently a NO-OP (the selected entry did not contain the
  // token), which is indistinguishable from "the guard is decorative" — the
  // mutation, not the code under test, was the blind instrument.
  ok(
    "mutation landed (body actually differs)",
    bodyEdited[0].body !== all[0].body,
    `${all[0].body.length} → ${bodyEdited[0].body.length} chars`,
  );
  const edited = checkConservation(green.dated, bodyEdited);
  ok(
    "RED: one-character body edit ⇒ ok:false (md5 arm, headings all intact)",
    edited.ok === false && edited.missing === 0 && edited.extra === 0,
    `missing=${edited.missing} extra=${edited.extra}`,
  );
  console.log(`    ${JSON.stringify(edited)}`);

  // RED 3 — a DUPLICATED entry (same body twice) must not read as conserved.
  const dupd = checkConservation(green.dated, [...all, all[0]]);
  ok("RED: duplicated entry ⇒ ok:false", dupd.ok === false, `duplicated=${dupd.duplicated}`);

  // RED 4 — the SHIPPING abort path: assertConservation must THROW, which is
  // what stops processOne before either file is written.
  console.log("\nSELF-TEST — RED control through the SHIPPING abort (assertConservation)");
  let threw = false;
  try {
    assertConservation("<fixture>", edited);
  } catch (e) {
    threw = true;
    console.log(`    RED CONTROL RAISED: ${e.message}`);
  }
  ok("failed conservation THROWS (no file is ever written)", threw);
  // ...and the same call on a good result must NOT throw.
  let threwOnGood = false;
  try {
    assertConservation("<fixture>", okCase);
  } catch {
    threwOnGood = true;
  }
  ok("passing conservation does NOT throw (abort-path positive control)", !threwOnGood);

  console.log("\nSELF-TEST — idempotence guard (re-split is DESTRUCTIVE)");
  // Prove the hazard is real before proving the guard blocks it: a split file's
  // index rows DO match the legacy-entry predicate, so an unguarded 2nd run
  // inflates the entry count. Without this arm the guard could be guarding
  // nothing and still look correct.
  const reparsed = splitMemory(green.hot + "\n" + green.archive, { target: 900, hardCap: 4000 });
  ok(
    "hazard is real: re-parsing a split file inflates the entry count",
    reparsed.conservation.entriesTotal > green.conservation.entriesTotal,
    `${green.conservation.entriesTotal} → ${reparsed.conservation.entriesTotal}`,
  );
  ok(
    "conservation is BLIND to it (why a guard is required, not just care)",
    reparsed.conservation.ok === true,
  );
  ok("split output carries the guard marker", green.hot.includes(SPLIT_MARKER));

  console.log("\nSELF-TEST — sanitizer");
  const dirty = "Real prose line.</result>\n<usage><subagent_tokens>123</subagent_tokens><tool_uses>4</tool_uses></usage>\n</task-notification>\nkeep me";
  const clean = sanitizeTaskNotificationXml(dirty);
  ok("strips trailing </result>", clean.text.startsWith("Real prose line.\n"));
  ok("deletes usage + task-notification lines", clean.deletedLines === 2 && clean.strippedTags === 1);
  ok("preserves surrounding content", clean.text.includes("keep me"));

  // ⛔ REGISTER-OVER-CAP: a named live register past the shard cap must NOT
  // drive `rolled` (the roll cannot cut it — kept whole by design), and MUST surface on
  // `registerOver` + in the reason string, so the scan can say REGISTER-OVER-CAP instead of the
  // permanently-false ROLL-DUE. Fixture = the tool's OWN sharded output written to a temp dir
  // (no hand-built manifest to drift), with a shardCap small enough that the register exceeds it.
  // DISCRIMINATING CONTROL: the same dir under a roomy cap reads clean — without it, any refusal
  // shape would pass the first arm.
  console.log("\nSELF-TEST — REGISTER-OVER-CAP (named register exempt from the roll trigger)");
  {
    const regRaw = [
      "# Memory",
      "## Watch-tier register",
      "- **watched thing** | first-seen 2026-08-01 | occurrences: 1 | " + "x".repeat(1800),
      "## 2026-08-02 — a dated section",
      "body line for the dated shard",
      "",
    ].join("\n");
    const regLayout = { named: [{ headingPrefix: "## Watch-tier register", file: "WATCH-TIER.md", note: "LIVE REGISTER — test" }], legacy: [] };
    const tdir = fs.mkdtempSync("/tmp/mts-regcap-");
    const shardedFx = splitMemorySharded(regRaw, { layout: regLayout, skillDir: tdir });
    fs.writeFileSync(path.join(tdir, "MEMORY.md"), shardedFx.router);
    for (const f of shardedFx.files) fs.writeFileSync(path.join(tdir, f.file), f.text);
    const tight = rollLayout(tdir, { layout: regLayout, shardCap: 1000, dryRun: true });
    ok("register over a tight cap does NOT drive rolled", tight.rolled === false || !tight.over.includes("WATCH-TIER.md"));
    ok("registerOver names the register", (tight.registerOver ?? []).includes("WATCH-TIER.md"));
    ok("reason names CURATION, not a roll", String(tight.reason).includes("REGISTER-OVER-CAP"));
    const roomy = rollLayout(tdir, { layout: regLayout, shardCap: 200000, dryRun: true });
    ok("CONTROL: roomy cap → no registerOver", (roomy.registerOver ?? []).length === 0);
    // FORCED-ROLL arm: when a roll happens while the register is over cap,
    // the rolled reason must CARRY the register clause — the roll path used to drop it for a
    // cycle. `force: true` yields rolled=true on this same fixture without an over-cap dated
    // shard, whose re-pack would THROW (SHARD CAP BREACHED) before the property under test.
    const both = rollLayout(tdir, { layout: regLayout, shardCap: 1000, dryRun: true, force: true });
    ok("forced roll with register-over → rolled", both.rolled === true);
    ok("…and the rolled reason still carries REGISTER-OVER-CAP", String(both.reason).includes("REGISTER-OVER-CAP"));
    fs.rmSync(tdir, { recursive: true, force: true });
  }

  // ⛔ REGISTER SHARDING — the INVERSE of the block above, and it needs
  // its OWN arms: that fixture's layout carries no `partCap`, so it exercises only the kept-whole
  // branch and its green says nothing about this one. Same function, disjoint branch. Both blocks
  // stay — the exemption still governs ADOPTION-QUEUE, which has no `partCap`.
  console.log("\nSELF-TEST — REGISTER SHARDING (a register WITH partCap is cut at row boundaries)");
  {
    const rows = Array.from(
      { length: 40 },
      (_, i) => `- **row ${i}** | first-seen 2026-08-01 | occurrences: 1 | ${"y".repeat(400)}`,
    );
    const shRaw = [
      "# Memory",
      "## Watch-tier register",
      "AGE RULE prose that must ride in part 1 because it sits above the first row.",
      ...rows,
      "## 2026-08-02 — a dated section",
      "body line for the dated shard",
      "",
    ].join("\n");
    const cut = {
      headingPrefix: "## Watch-tier register",
      file: "WATCH-TIER.md",
      note: "LIVE REGISTER — test",
      rowRe: /^- /,
      partCap: 8000,
    };
    const whole = {
      headingPrefix: "## Watch-tier register",
      file: "WATCH-TIER.md",
      note: "LIVE REGISTER — test",
    };
    const sharded = splitMemorySharded(shRaw, { layout: { named: [cut], legacy: [] }, skillDir: "/tmp/x" });
    const regFiles = sharded.files.filter((f) => f.kind === "register");
    ok("register is cut into more than one part", regFiles.length > 1);
    ok("part 1 keeps the register's own filename", regFiles[0].file === "WATCH-TIER.md");
    // ⛔ EVERY `.slice(1)` ARM IS CONJOINED WITH `length > 1`, AND THAT IS NOT BELT-AND-BRACES.
    // `[].every(...)` is TRUE, so under a mutant that never cuts, three of these arms PASSED on
    // an empty continuation set — measured, mutation-tested 2026-09-13: the cut function stubbed
    // to `[0, len]` turned two arms RED and left these three green. A green from an empty
    // population is the ELEVENTH vacuous-control way (the mutation sits outside the predicate's
    // field of view), and here the field of view is the population itself.
    const hasParts = regFiles.length > 1;
    ok(
      "later parts are -PART-NN, in order",
      hasParts &&
        regFiles.slice(1).every((f, i) => f.file === `WATCH-TIER-PART-${String(i + 2).padStart(2, "0")}.md`),
    );
    ok("every part is within the part cap", regFiles.every((f) => f.bytes <= cut.partCap));
    ok("lead prose rides in part 1", regFiles[0].text.includes("AGE RULE prose"));
    ok(
      "no later part carries the lead",
      hasParts && regFiles.slice(1).every((f) => !f.text.includes("AGE RULE prose")),
    );
    // ⛔ NO MID-ROW CUT. Every continuation part's first verbatim line must BE a row start. A
    // bisected row strands its `occurrences:` / `retire-if:` tail in a different file, and every
    // instrument that reads this register reads the row to its END — so that failure is silent
    // and wrong rather than loud, which is the one outcome the cut must make impossible.
    ok(
      "no row is bisected — each continuation begins ON a row boundary",
      hasParts && regFiles.slice(1).every((f) => readVerbatim(f.text)[0].startsWith("- **row ")),
    );
    const rowsIn = shRaw.split("\n").filter((l) => l.startsWith("- **row "));
    const rowsOut = regFiles.flatMap((f) => readVerbatim(f.text)).filter((l) => l.startsWith("- **row "));
    ok(
      `row multiset conserved in ORDER (${rowsIn.length} in / ${rowsOut.length} out)`,
      rowsIn.join("\n") === rowsOut.join("\n"),
    );
    // ⛔ RED CONTROL — the SAME fixture with NO partCap must emit exactly ONE register file.
    // Without it every arm above would pass equally on a tool that ignored `partCap` and split
    // every register unconditionally, which is a different and wrong tool. The control is what
    // makes these greens evidence about `partCap` rather than about splitting in general.
    const kept = splitMemorySharded(shRaw, { layout: { named: [whole], legacy: [] }, skillDir: "/tmp/x" });
    ok(
      "RED CONTROL: no partCap ⇒ register kept WHOLE (exactly 1 file)",
      kept.files.filter((f) => f.kind === "register").length === 1,
    );
    // ROLL TRIGGER, inverted: a CUTTABLE register over its part cap is a REAL trigger now.
    // Under the old rule this dir read NO-OP forever, which is the state this change ended.
    const tdir2 = fs.mkdtempSync("/tmp/mts-regshard-");
    fs.writeFileSync(path.join(tdir2, "MEMORY.md"), kept.router);
    for (const f of kept.files) fs.writeFileSync(path.join(tdir2, f.file), f.text);
    const due = rollLayout(tdir2, { layout: { named: [cut], legacy: [] }, shardCap: 200000, dryRun: true });
    ok("cuttable register over its part cap DRIVES the roll", (due.over ?? []).includes("WATCH-TIER.md"));
    ok("…and does NOT report REGISTER-OVER-CAP", (due.registerOver ?? []).length === 0);
    fs.rmSync(tdir2, { recursive: true, force: true });
  }

  // ⛔ A HAND-WRITTEN ROW BELOW THE ROUTER MARKER REFUSES. The fixture is the tool's own sharded
  // output, so every row the guard must PASS is the renderer's real output, and each pass arm is
  // pinned to a shape PRECONDITION first: a pass over a router that rendered no cut title
  // certifies nothing about cut titles. The refusals drive rollLayout, the one function every
  // regenerating path calls; the CLI arms then replay the incident itself (rows committed, then
  // --heal, which printed CLEAN).
  console.log("\nSELF-TEST — A HAND-WRITTEN ROW BELOW THE ROUTER MARKER REFUSES");
  {
    const selfPath = new URL(import.meta.url).pathname;
    const rowRaw = [
      "# Memory", "", "preamble", "",
      "## 2026-08-01 — first entry", "First body. More.", "",
      "## 2026-08-02 — a title the renderer must cut, because it runs well past the one hundred and forty character cap that the router puts on every row title in this fixture",
      "Second body.", "",
      "## 2026-08-03 — L9001: a numbered lesson — whose title carries a dash", "Lesson body.", "",
      "## Undated section", "Undated body.", "",
    ].join("\n");
    const mkLayout = (d) => {
      const res = splitMemorySharded(rowRaw, { skillDir: d });
      fs.writeFileSync(path.join(d, "MEMORY.md"), res.router);
      for (const f of res.files) fs.writeFileSync(path.join(d, f.file), f.text);
      return res;
    };
    const tdir = fs.mkdtempSync("/tmp/mts-rows-");
    const fx = mkLayout(tdir);
    const routerPath = path.join(tdir, "MEMORY.md");
    const genRows = fx.router.split("\n").filter((l) => /^- \[(?:·|L\d+)\] /.test(l));
    ok("PRECONDITION: the renderer wrote one row per section", genRows.length === 4, `${genRows.length} rows`);
    const cutRow = genRows.find((l) => l.startsWith("- [·] 2026-08-02 — a title the renderer must cut")) ?? "";
    ok("PRECONDITION: one row's title is cut with `…`",
      /… — Second body\.$/.test(cutRow) && !cutRow.includes("fixture"), cutRow.slice(-40));
    ok("PRECONDITION: an `[L#]` row whose title carries ` — `",
      genRows.some((l) => l.startsWith("- [L9001] 2026-08-03 — L9001: a numbered lesson — whose title carries a dash — ")));
    ok("PRECONDITION: an undated `— —` row", genRows.some((l) => l.startsWith("- [·] — — Undated section — ")));
    const res0 = checkRouterRows(fx.router, reconstructFromLayout(loadLayout(tdir)));
    ok("generated rows PASS, every one examined (cut title, [L#], undated)",
      res0.rows === 4 && res0.unbacked.length === 0, JSON.stringify(res0).slice(0, 120));
    const rollMsg = () => {
      try { rollLayout(tdir); return "planned"; } catch (e) { return e.message; }
    };
    ok("CONTROL: the generated router plans a roll without refusing", rollMsg() === "planned", rollMsg().slice(0, 100));
    const shardFile = fx.files.find((f) => f.kind === "shard").file;
    fs.appendFileSync(path.join(tdir, shardFile), "\n## 2026-08-04 — appended to the shard since the last roll\nBody.\n");
    let stale;
    try { stale = rollLayout(tdir); } catch (e) { stale = e; }
    ok("a STALE router (its shard gained an entry since the last roll) does NOT refuse",
      !(stale instanceof Error) && stale.routerStale === true,
      stale instanceof Error ? stale.message.slice(0, 100) : `routerStale=${stale.routerStale}`);
    const base = fs.readFileSync(routerPath, "utf8");
    const withRow = (row) => fs.writeFileSync(routerPath, `${base}${row}\n`);
    const handRow = "- [·] 2026-08-05 — a Memory Update persisted as a router row — its body has no block in any shard";
    withRow(handRow);
    const handLine = base.split("\n").length;
    const fired = rollMsg();
    ok("RED: an unbacked hand-written `- [·]` row REFUSES the roll, naming its line",
      fired.startsWith("MEMORY.md: 1 ROW BELOW the ROUTER PREAMBLE ENDS marker") && fired.includes(`(line ${handLine}; `),
      fired.slice(0, 110));
    const refuses = (row) => (withRow(row), /ROWS? BELOW the ROUTER PREAMBLE ENDS marker/.test(rollMsg()));
    ok("RED: a `…` cut that prefixes no heading refuses — the prefix rule is not a pass for every `…`",
      refuses("- [·] 2026-08-02 — a title the renderer must cut, though not this one… — a hand row dressed as a cut"));
    ok("RED: a short `…` prefix of a real same-date title refuses — a renderer cut keeps > 0.6 × MAX_TITLE",
      refuses("- [·] 2026-08-02 — a title… — a hand row cut after two words"));
    ok("RED: a real row under the WRONG date refuses — the date column is part of the key",
      refuses(cutRow.replace("2026-08-02", "2026-09-02")));
    ok("RED: a LEGACY_ENTRY-shaped row (`- 2026-…`) with no entry behind it refuses",
      refuses("- 2026-08-05 — a classic-index-shaped note → ARCHIVE"));
    ok("RED: any other `- [` row (a checkbox) refuses — the renderer writes none", refuses("- [ ] a to-do parked in the router"));
    // The write path's pre-swap race test. Its corpus md5 cannot see the router's tail, so the arm
    // that matters is a row landing AFTER the plan — the window rollLayout's refusal cannot reach.
    fs.writeFileSync(routerPath, base);
    let planned = null; // a plan that throws is a red arm below, never a crash that hides every later arm
    try { planned = rollLayout(tdir); } catch { /* reported by the CONTROL arm */ }
    ok("rollRaced CONTROL: nothing moved since the plan ⇒ no race",
      planned !== null && rollRaced(tdir, "MEMORY.md", planned) === false);
    withRow(handRow);
    ok("RED rollRaced: a row appended below the marker after the plan IS a race",
      planned !== null && rollRaced(tdir, "MEMORY.md", planned) === true);
    fs.rmSync(tdir, { recursive: true, force: true });

    // The incident's own path, through the CLI: rows COMMITTED below the marker, then a heal. `git
    // init` precedes the layout so the router's Rolling line is rendered repo-relative from the start,
    // or the projection reads STALE for that one line and the CLEAN control below certifies nothing.
    const repo = fs.realpathSync(fs.mkdtempSync("/tmp/mts-rows-heal-"));
    const g = (...a) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });
    const commit = (msg) => { g("add", "-A"); g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", msg); };
    g("init", "-q");
    const skill = path.join(repo, "skill");
    fs.mkdirSync(skill);
    const fx2 = mkLayout(skill);
    commit("base");
    const cli = (...args) => spawnSync(process.execPath, [selfPath, ...args], { encoding: "utf8", cwd: repo });
    const verdict = (res) => res.stdout.split("\n").find((l) => l.startsWith("HEAL VERDICT:")) ?? "";
    const healClean = cli("--heal", repo);
    ok("CLI CONTROL: --heal over the clean committed layout reads CLEAN",
      healClean.status === 0 && verdict(healClean).startsWith("HEAL VERDICT: CLEAN"), `rc=${healClean.status} ${verdict(healClean)}`);
    const r2 = path.join(skill, "MEMORY.md");
    fs.writeFileSync(r2, `${fx2.router}\n${handRow}\n`);
    commit("a Memory Update row appended to the router");
    const committed = fs.readFileSync(r2, "utf8");
    const heal = cli("--heal", repo);
    ok("CLI RED: --heal over a committed hand row reads ATTENTION, never CLEAN (the incident printed CLEAN)",
      heal.status === 1 && verdict(heal).startsWith("HEAL VERDICT: ATTENTION"), `rc=${heal.status} ${verdict(heal).slice(0, 90)}`);
    ok("…and its SKIPPED line carries the remedy", /HEAL SKIPPED .*ROW BELOW the ROUTER PREAMBLE ENDS marker/.test(heal.stdout));
    const force = cli("--roll", skill, "--force");
    ok("CLI RED: --roll --force refuses too, naming the row", force.status !== 0 && force.stderr.includes("1 ROW BELOW the ROUTER PREAMBLE ENDS"),
      `rc=${force.status}`);
    ok("…and neither command rewrote the router: the row survives", fs.readFileSync(r2, "utf8") === committed);
    fs.rmSync(repo, { recursive: true, force: true });
  }

  // ⛔ Two layers: the exported predicate over
  // synthetic plans, then the REAL `--roll` in a throwaway git repo, because the predicate
  // alone cannot show the CLI calls it (removing the wiring left every predicate arm green).
  console.log("\nSELF-TEST — ROLL REFUSES A PART ANOTHER SESSION HOLDS DIRTY");
  {
    const plan = {
      layout: { parts: [{ file: "A-1.md" }, { file: "A-2.md" }, { file: "A-3.md" }] },
      changes: [
        { file: "A-1.md", status: "unchanged" }, { file: "A-2.md", status: "changed" },
        { file: "A-3.md", status: "changed" }, { file: "A-0.md", status: "removed" },
        { file: "A-4.md", status: "created" }, { file: "R.md", status: "changed" },
      ],
    };
    const fd = (names) => foreignDirtyForRoll(plan, "R.md", new Set(names)).join(",");
    ok("a dirty middle part the roll rewrites is reported", fd(["A-2.md"]) === "A-2.md");
    ok("a dirty part the roll removes is reported", fd(["A-0.md"]) === "A-0.md");
    ok("CONTROL: the router and the current part are the operator's own", fd(["R.md", "A-3.md"]) === "");
    ok("CONTROL: a dirty part the roll leaves unchanged is not its business", fd(["A-1.md"]) === "");
    ok("CONTROL: another family's dirty file is not its business", fd(["RULES.md"]) === "");

    const self = new URL(import.meta.url).pathname;
    const secs = Array.from({ length: 9 }, (_, i) => `## 2026-0${i + 1}-01 — entry ${i}\n${"x".repeat(250)}\n`);
    const fixtureRaw = ["# Memory", "", "preamble", "", ...secs].join("\n");
    // The sharded fixture written into `d`; returns its parts, sorted. Each arm below then states
    // only what makes it different (a repo, a hiding env, a dangling .git, no repo at all).
    const writeShards = (d) => {
      const res = splitMemorySharded(fixtureRaw, { shardCap: 1800, skillDir: d });
      fs.writeFileSync(path.join(d, "MEMORY.md"), res.router);
      for (const f of res.files) fs.writeFileSync(path.join(d, f.file), f.text);
      return res.files.map((f) => f.file).sort();
    };
    const mkRepo = () => {
      const d = fs.mkdtempSync("/tmp/mts-dirty-");
      const files = writeShards(d);
      const g = (...a) => spawnSync("git", ["-C", d, ...a], { encoding: "utf8" });
      g("init", "-q");
      g("add", "-A");
      g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
      return { d, files };
    };
    const roll = (d, extra = []) =>
      spawnSync(process.execPath, [self, "--roll", d, "--shard-cap", "1800", ...extra], { encoding: "utf8" });
    const ownEntry = "## 2026-09-15 — own new entry\n" + "z".repeat(700) + "\n";

    const a = mkRepo();
    ok("fixture has at least three parts", a.files.length >= 3, a.files.join(" "));
    fs.appendFileSync(path.join(a.d, a.files[0]), "peer row " + "y".repeat(400) + "\n");
    const before = fs.readFileSync(path.join(a.d, a.files[1]), "utf8");
    const dry = roll(a.d, ["--dry-run"]);
    // The FIRST line, not includes(): the last-line repeat below also says WOULD REFUSE, so
    // includes() stays green with the first-line verdict gone, and the repeat points at it.
    ok("dry run reports WOULD REFUSE on its FIRST line and exits 0",
      dry.status === 0 && dry.stdout.split("\n")[0].startsWith("WOULD REFUSE — "), dry.stdout.split("\n")[0]);
    ok("dry run repeats WOULD REFUSE as its LAST line, so a `| tail` read cannot miss it",
      (dry.stdout.trim().split("\n").pop() || "").startsWith("WOULD REFUSE"), dry.stdout.trim().split("\n").pop());
    const refused = roll(a.d);
    ok("a peer row in the FIRST part refuses the roll (exit 3)", refused.status === 3, `rc=${refused.status}`);
    // Read the REFUSED line itself: every roll prints a change table
    // naming each part, so a whole-stdout includes() stays green when the guard is unwired.
    const refusedLine = (res) => res.stdout.split("\n").find((l) => l.startsWith("REFUSED — ")) ?? "";
    ok("…naming that part on the REFUSED line", refusedLine(refused).includes(a.files[0]), refusedLine(refused).slice(0, 80));
    ok("…and writes nothing", fs.readFileSync(path.join(a.d, a.files[1]), "utf8") === before);
    spawnSync("git", ["-C", a.d, "add", "--", a.files[0]]);
    const staged = roll(a.d);
    ok("a STAGED peer edit (worktree equal to the index) still refuses", staged.status === 3, `rc=${staged.status}`);
    const idx = path.join(a.d, ".git", "index");
    const idxBytes = fs.readFileSync(idx);
    fs.writeFileSync(idx, "garbage");
    const gitFail = roll(a.d);
    const gitFailNamed = roll(a.d, ["--allow-dirty", a.files[0]]);
    fs.writeFileSync(idx, idxBytes);
    ok("git status failing inside a repo refuses (exit 3) and says so", gitFail.status === 3 && gitFail.stdout.includes("git status failed"), `rc=${gitFail.status}`);
    ok("…and naming the dirty part in --allow-dirty cannot override a git failure", gitFailNamed.status === 3 && gitFailNamed.stdout.includes("git status failed"), `rc=${gitFailNamed.status}`);
    // The escape is SCOPED: naming one dirty part must not wave through another.
    fs.appendFileSync(path.join(a.d, a.files[1]), "own row\n");
    const partial = roll(a.d, ["--allow-dirty", a.files[1]]);
    const partialLine = refusedLine(partial);
    ok("--allow-dirty overrides only the files it names: the other part still refuses", partial.status === 3 && partialLine.includes(a.files[0]) && !partialLine.includes(a.files[1]), `rc=${partial.status}`);
    const bare = roll(a.d, ["--allow-dirty"]);
    ok("a bare --allow-dirty is rejected (exit 2): the escape must name its files", bare.status === 2, `rc=${bare.status}`);
    // A value naming no file is a bare flag in disguise.
    const comma = roll(a.d, ["--allow-dirty", ","]);
    ok("an --allow-dirty value naming no file (`,`) is rejected (exit 2)", comma.status === 2, `rc=${comma.status}`);
    const dryBoth = roll(a.d, ["--dry-run", "--allow-dirty", `${a.files[0]},${a.files[1]}`]);
    ok("a comma list naming every blocked file clears the dry run", dryBoth.status === 0 && !dryBoth.stdout.includes("WOULD REFUSE"), `rc=${dryBoth.status}`);
    // Given twice, both values count (strFlag alone kept only the first).
    const forced = roll(a.d, ["--allow-dirty", a.files[0], "--allow-dirty", a.files[1]]);
    ok("--allow-dirty given once per blocked file lets the roll run", forced.status === 0 && forced.stdout.includes("ROLLING"), `rc=${forced.status}`);
    fs.rmSync(a.d, { recursive: true, force: true });

    const b = mkRepo();
    fs.writeFileSync(path.join(b.d, "RULES.md"), "another family, dirty\n");
    fs.appendFileSync(path.join(b.d, b.files[b.files.length - 1]), ownEntry);
    const own = roll(b.d);
    ok("CONTROL: an append to the CURRENT part, plus another family dirty, still rolls", own.status === 0 && own.stdout.includes("ROLLING"), `rc=${own.status}`);
    // Validated after the NO-OP exit, a bare flag on a roll with
    // nothing to do exited 0. The dir has just rolled, so a second roll is a NO-OP.
    const noopPlain = roll(b.d);
    const noopBare = roll(b.d, ["--allow-dirty"]);
    ok("a bare --allow-dirty is rejected even when the roll has nothing to do", noopPlain.stdout.includes("NO-OP") && noopBare.status === 2, `noop=${noopPlain.stdout.includes("NO-OP")} rc=${noopBare.status}`);
    fs.rmSync(b.d, { recursive: true, force: true });

    // One arm for two defects: a non-ASCII skill dir, which
    // porcelain v1 octal-quotes, under GIT_CEILING_DIRECTORIES at the repo root, which made the
    // old reader hear "not a git repository" INSIDE the repo. Both used to read as no dirt.
    const r = fs.mkdtempSync("/tmp/mts-dirty-env-");
    const sub = path.join(r, "skill-ž");
    fs.mkdirSync(sub);
    const firstE = writeShards(sub)[0];
    const ge = (...args) => spawnSync("git", ["-C", r, ...args], { encoding: "utf8" });
    ge("init", "-q");
    ge("add", "-A");
    ge("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
    fs.appendFileSync(path.join(sub, firstE), "peer row " + "y".repeat(400) + "\n");
    const envRun = spawnSync(process.execPath, [self, "--roll", sub, "--shard-cap", "1800"], {
      encoding: "utf8",
      env: { ...process.env, GIT_CEILING_DIRECTORIES: fs.realpathSync(r) },
    });
    ok("a non-ASCII skill dir under a hiding git env still refuses, naming the part", envRun.status === 3 && refusedLine(envRun).includes(firstE), `rc=${envRun.status} ${refusedLine(envRun).slice(0, 60)}`);
    fs.rmSync(r, { recursive: true, force: true });

    // "Directly inside dir" was a STRING compare of
    // realpathSync(dir) against the path git prints, and git prints the index spelling. On
    // case-insensitive APFS a `--roll skills/Meta` for a dir stored as skills/meta, or the NFD
    // spelling of a dir git stores NFC (what readdir hands --heal for an NFD-created dir),
    // matched nothing and the roll PROCEEDED over the dirty part. Each arm needs a filesystem
    // that resolves the alias; where it does not (Linux) the alias is ENOENT and the arm is skipped.
    const mkSub = (root, sub) => {
      const d = path.join(root, sub);
      fs.mkdirSync(d, { recursive: true });
      const res = splitMemorySharded(fixtureRaw, { shardCap: 1800, skillDir: d });
      fs.writeFileSync(path.join(d, "MEMORY.md"), res.router);
      for (const f of res.files) fs.writeFileSync(path.join(d, f.file), f.text);
      const g = (...args) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
      g("init", "-q");
      g("add", "-A");
      g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
      const first = res.files.map((f) => f.file).sort()[0];
      fs.appendFileSync(path.join(d, first), "peer row " + "y".repeat(400) + "\n");
      return first;
    };
    for (const [label, sub, aliasSub] of [
      ["a case-aliased --roll dir (skills/Meta for skills/meta)", "skills/meta", "skills/Meta"],
      ["an NFD-spelled --roll dir for a dir git stores NFC", "skill-\u017e", "skill-z\u030c"],
    ]) {
      const root = fs.mkdtempSync("/tmp/mts-alias-");
      const first = mkSub(root, sub);
      const alias = path.join(root, aliasSub);
      if (fs.existsSync(alias)) {
        const via = roll(alias);
        ok(`${label} still refuses, naming the part`, via.status === 3 && refusedLine(via).includes(first), `rc=${via.status}`);
      } else console.log(`  (skip: this filesystem does not resolve ${aliasSub} — nothing to test)`);
      fs.rmSync(root, { recursive: true, force: true });
    }

    // A caller that redirected git (GIT_DIR + GIT_WORK_TREE, no .git ancestor: the detached
    // layout) must not read as "outside any repo" once the strip removes its redirection —
    // an earlier version refused here; the strip alone made it proceed.
    {
      const w = fs.mkdtempSync("/tmp/mts-detached-");
      const g = fs.mkdtempSync("/tmp/mts-detached-git-");
      const resD = splitMemorySharded(fixtureRaw, { shardCap: 1800, skillDir: w });
      fs.writeFileSync(path.join(w, "MEMORY.md"), resD.router);
      for (const f of resD.files) fs.writeFileSync(path.join(w, f.file), f.text);
      const envD = { ...process.env, GIT_DIR: g, GIT_WORK_TREE: w };
      spawnSync("git", ["init", "-q", "--bare", g], { encoding: "utf8" });
      spawnSync("git", ["add", "-A"], { encoding: "utf8", cwd: w, env: envD });
      spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base"], { encoding: "utf8", cwd: w, env: envD });
      fs.appendFileSync(path.join(w, resD.files.map((f) => f.file).sort()[0]), "row " + "y".repeat(400) + "\n");
      const det = spawnSync(process.execPath, [self, "--roll", w, "--shard-cap", "1800"], { encoding: "utf8", env: envD });
      ok("a GIT_DIR/GIT_WORK_TREE-redirected caller with no .git ancestor refuses as a git failure", det.status === 3 && det.stdout.includes("git status failed"), `rc=${det.status}`);
      fs.rmSync(w, { recursive: true, force: true });
      fs.rmSync(g, { recursive: true, force: true });
    }

    // An --allow-dirty spelling that is not the exact basename matches nothing: the roll still
    // refuses, and the operator is told which names went unmatched instead of reading the
    // same refusal as "the flag was ignored".
    {
      const u = mkRepo();
      fs.appendFileSync(path.join(u.d, u.files[0]), "peer row " + "y".repeat(400) + "\n");
      const un = roll(u.d, ["--allow-dirty", "./" + u.files[0]]);
      ok("an --allow-dirty name that is not the exact basename still refuses and is reported unmatched", un.status === 3 && un.stderr.includes("does not block") && un.stderr.includes("./" + u.files[0]), `rc=${un.status}`);
      fs.rmSync(u.d, { recursive: true, force: true });
    }

    // The ancestor-.git backstop: git says "not a git repository" although a `.git` sits right
    // there (here a .git FILE pointing nowhere). That is a git failure, not "outside any repo",
    // so the roll must refuse rather than proceed. Blinding the backstop left 81/81 green before
    // this arm existed.
    const q = fs.mkdtempSync("/tmp/mts-badgit-");
    const firstQ = writeShards(q)[0];
    fs.writeFileSync(path.join(q, ".git"), "gitdir: /nonexistent-mts-gitdir\n");
    fs.appendFileSync(path.join(q, firstQ), "row " + "y".repeat(400) + "\n");
    // The arm reaches the backstop only if git answers "not a git repository" here; any other
    // wording (a garbage .git reads "invalid gitfile format") refuses through the rc check below
    // the backstop instead, and the arm stays green with the backstop gone. Pin the route.
    const qSays = spawnSync("git", ["-C", q, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" }).stderr || "";
    ok("PRECONDITION: git calls this dangling .git 'not a git repository'", /not a git repository/i.test(qSays), qSays.trim().slice(0, 80));
    const badGit = roll(q);
    ok("a .git that git cannot read refuses as a git failure, never as 'outside any repo'", badGit.status === 3 && badGit.stdout.includes("git status failed"), `rc=${badGit.status}`);
    fs.rmSync(q, { recursive: true, force: true });

    // Outside any git repo there is no other session's dirt to protect: the roll proceeds.
    const c = fs.mkdtempSync("/tmp/mts-nogit-");
    fs.appendFileSync(path.join(c, writeShards(c)[0]), "row " + "y".repeat(400) + "\n");
    const nogit = roll(c);
    ok("CONTROL: a dir outside any git repo rolls (nothing there is another session's)", nogit.status === 0 && nogit.stdout.includes("ROLLING"), `rc=${nogit.status}`);
    fs.rmSync(c, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? "SELF-TEST PASS" : `SELF-TEST FAIL (${failures})`}`);
  return failures === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------- CLI

/** `--flag N` -> Number, or undefined. Rejects a non-finite value loudly rather than
 *  silently falling back to the default — a mistyped cap that silently uses 48,000 on a
 *  3 MB file reads as "the tool refused", not as "your flag was ignored". */
function numFlag(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = Number(argv[i + 1]);
  if (!Number.isFinite(v)) {
    console.error(`${name} needs a number, got ${JSON.stringify(argv[i + 1])}`);
    process.exit(2);
  }
  return v;
}

/* strFlag — the string sibling of numFlag, and it fails the same way on purpose: a flag present
 *  with no value EXITS rather than silently falling back to the default. Silent fallback is how a
 *  `--archive-basename` typo would ship `MEMORY-ARCHIVE-*` names for a non-MEMORY file, which is
 *  the exact enrolment hazard the flag exists to prevent. Guards against the next flag being
 *  swallowed as this one's value (`--archive-basename --dry-run`). */
function strFlag(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (!v || v.startsWith("--")) {
    console.error(`${name} needs a value, got ${JSON.stringify(v)}`);
    process.exit(2);
  }
  return v;
}

function shardedMain(argv, dryRun) {
  const shardIdx = argv.indexOf("--shard");
  const rollIdx = argv.indexOf("--roll");
  const outIdx = argv.indexOf("--out");
  const opts = {
    shardCap: numFlag(argv, "--shard-cap") ?? SHARD_CAP_BYTES,
    routerCap: numFlag(argv, "--router-cap") ?? ROUTER_CAP_BYTES,
    // --archive-basename EXPOSED ON THE CLI (2026-08-06). `splitMemorySharded` already honoured
    // opts.archiveBasename; only the CLI could not reach it, so every shard was forced to be named
    // `MEMORY-ARCHIVE-*`. That default is ACTIVELY DANGEROUS for a non-MEMORY target:
    // check-lesson-numbers.mjs unions `/^MEMORY.*\.md$/`, so sharding any file under the default
    // name silently enrols it in the L#-DECLARATION scanner. For a file full of L# CITATIONS,
    // that manufactures hundreds of false duplicates,
    // precisely the catastrophe the checker's ROW-4 self-test exists to prevent. Naming is a
    // SAFETY parameter here, not a cosmetic one, which is why it gets a flag instead of a rename
    // after the fact.
    archiveBasename: strFlag(argv, "--archive-basename"),
    // --router-name defaults, in shardedMain's `--shard` path, to the SOURCE's own basename —
    // shard CHANGELOG.md, get a CHANGELOG.md router. It used to be hardcoded "MEMORY.md" for every
    // source, which meant a CHANGELOG router landed on the lesson ledger's filename and the
    // obvious apply step would have destroyed it. Deriving beats defaulting: nobody has to
    // remember a flag for the safe case, and the flag exists only for a deliberate rename.
    routerName: strFlag(argv, "--router-name"),
  };

  if (rollIdx >= 0) {
    const dir = argv[rollIdx + 1];
    if (!dir) {
      console.error("usage: --roll <dir> [--router|--router-name <file.md>] [--force] [--dry-run] [--allow-dirty <file>[,<file>]]");
      process.exit(2);
    }
    // ⛔ THE ROUTER NAME MUST REACH BOTH THE READ AND THE WRITE, OR FIXING ONE ARMS THE OTHER.
    // These two holes masked each other until 2026-08-06: loadLayout hardcoded MEMORY.md so
    // --roll THREW on this dir and never reached the write; the write below passed no
    // routerName, so it would have emitted the router as MEMORY.md whatever it had just read.
    // Repairing the read ALONE would have made a CHANGELOG roll overwrite the lesson router —
    // the exact data-loss bug already fixed once. A dead mechanism was the only
    // thing preventing it, which is why "it throws" was never the whole finding.
    // ⛔ ACCEPT BOTH SPELLINGS. The shard path already had `--router-name`
    // (:1663, into opts); the roll path introduced `--router`. Two names for one concept is the
    // defect, and it failed SILENTLY IN THE WORST DIRECTION: `--roll <dir> --router-name X` put
    // X into opts.routerName, then this line defaulted to MEMORY.md, and the explicit key below
    // is spread AFTER ...opts — so it won, and the tool rolled the MEMORY layout while the
    // operator had named the CHANGELOG one. No error, wrong target. Aliasing is safer here than
    // rejecting unknown flags, which would need a complete flag allowlist and can break callers.
    const routerName = strFlag(argv, "--router") ?? strFlag(argv, "--router-name") ?? "MEMORY.md";
    // ⛔ `--allow-dirty` IS PARSED HERE, BEFORE ANY EXIT.
    // Validated after the NO-OP branch, a bare flag exited 0 on a roll with nothing to do.
    // Every occurrence is collected (strFlag keeps only the first), and a value naming no file
    // (`,` or blank) is rejected like a bare flag: an override must say what it overrides.
    const allowed = new Set();
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] !== "--allow-dirty") continue;
      const v = argv[i + 1];
      const names = (v && !v.startsWith("--") ? v : "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!names.length) {
        console.error(`--allow-dirty needs one or more file names, got ${JSON.stringify(v)}`);
        process.exit(2);
      }
      for (const n of names) allowed.add(n);
    }
    // ⛔ RESUME BEFORE PLANNING, AND BEFORE ANYTHING THAT READS THE LAYOUT. `rollLayout` calls
    // `loadLayout` (or `reconstructClassic`) on its first line, and a torn dir makes that throw —
    // so a resume placed anywhere after this point could never run on the state it exists to fix.
    // This is the operator-facing half of the review's finding: the old advice was "repair by hand",
    // which on the fleet's memory corpus meant guessing which shard to delete.
    const pending = findResumableRoll(dir);
    if (pending) {
      const remaining = pending.journal.final.filter((n) => fs.existsSync(path.join(pending.staging, n)));
      const retiring = (pending.journal.retired ?? []).filter((n) => fs.existsSync(path.join(dir, n)));
      console.log(`⛔ TORN SWAP detected in ${dir} (journal from pid ${pending.journal.pid ?? "?"}, ${pending.journal.startedAt ?? "?"})`);
      console.log(`   staged remainder: ${pending.staging}`);
      console.log(`   ${dryRun ? "would move" : "moving"} into place: ${remaining.join(", ") || "(none — all landed)"}`);
      console.log(`   ${dryRun ? "would retire" : "retiring"}: ${retiring.join(", ") || "(none)"}`);
      if (dryRun) {
        console.log("\nDRY RUN — nothing written. Re-run without --dry-run to finish the swap.");
        process.exit(0);
      }
      const brokenPid = breakDeadRollLock(dir);
      if (brokenPid !== null) {
        console.log(`   cleared .roll.lock held by DEAD pid ${brokenPid} (the process that tore this)`);
      }
      const releaseResume = acquireRollLock(dir);
      let done;
      try {
        done = resumeRoll(dir, pending);
      } finally {
        releaseResume();
      }
      console.log(`\nRESUMED — moved ${done.moved.length}, retired ${done.retired.length}. Layout is consistent again.`);
      console.log("Re-run --roll to continue with a normal roll.");
      process.exit(0);
    }
    const r = rollLayout(dir, { ...opts, routerName, force: argv.includes("--force") });
    if (!r.rolled) {
      console.log(`NO-OP — ${r.reason} (${r.layout.parts.length} parts, router ${bytes(r.layout.routerText)} B)`);
      process.exit(0);
    }
    // ⛔ See foreignDirtyForRoll. Checked after planning
    // (only the plan knows which files change) and before anything is written. The escape is
    // SCOPED: `--allow-dirty <name>[,<name>]` overrides only the
    // files it names. A learn that adds or promotes a watch-tier row dirties WATCH-TIER.md, the
    // register's HEAD, which every new row re-cuts — so the roller's own row is refused too, and a
    // global switch would also wave through another session's part named in the same refusal.
    // Kept refusing (not excluded like the current shard): the register head is where
    // the original incident landed. A git failure has no names, so nothing overrides it. `allowed` is parsed
    // above, before the resume and NO-OP exits.
    const dirty = dirtyNamesIn(dir);
    const foreign = dirty === null ? null : foreignDirtyForRoll(r, routerName, dirty);
    const blocked = foreign === null ? null : foreign.filter((f) => !allowed.has(f));
    // The override matches EXACT basenames; a path, a case variant, a trailing slash or a typo
    // matches nothing and the refusal below would otherwise read as if the flag had been ignored.
    const unmatched = foreign === null ? [] : [...allowed].filter((n) => !foreign.includes(n));
    if (unmatched.length) console.error(`note: --allow-dirty names ${unmatched.join(", ")}, which this roll does not block (exact basenames only)`);
    const wouldRefuse = blocked === null || blocked.length > 0;
    if (wouldRefuse) {
      const why =
        blocked === null
          ? `git status failed in ${dir}, so dirt this roll would re-pack cannot be ruled out; fix git first (--allow-dirty cannot override this)`
          : `this roll would rewrite or remove ${blocked.join(", ")}, dirty before it ran (not the router, not the current part). The roll re-packs greedily, so uncommitted rows there would move into parts you then commit. Whose lines: git diff HEAD -- ${blocked.map((f) => path.join(dir, f)).join(" ")}. Yours (a watch-tier row this same learn added or promoted dirties WATCH-TIER.md) => commit it first, or re-run naming ONLY your own files, --allow-dirty <file>[,<file>] (exact basenames; a name this roll does not block is ignored). Another session's => leave it and re-run after they commit`;
      console.log(`${dryRun ? "WOULD REFUSE" : "REFUSED"} — ${why}.`);
      if (!dryRun) process.exit(3);
    }
    console.log(`${dryRun ? "DRY RUN — nothing written" : "ROLLING"} — ${r.reason}\n`);
    if (!dryRun) {
      // The banner this replaces said "delete-then-write, no lock, no temp-and-swap, no fsync"
      // and told the operator to remove it when the transactional-roll fix landed. It has:
      // the write is now staged + fsync'd + renamed into place with the deletes LAST, under an
      // O_EXCL lock. What is NOT closed is stated instead of dropped — a banner that goes silent
      // reads as "fully safe", and the residual here is the one an operator can actually act on.
      // ⛔ THIS BANNER WENT STALE THE MOMENT THE RESUME SHIPPED, AND THREE REVIEW LENSES FOUND IT
      // INDEPENDENTLY. It said NOT RESUMABLE / repair BY HAND / re-running does NOT fix it, all
      // false once the resume landed — and `finally` does not run on SIGKILL, so on the very path
      // this work exists for the torn-state message never prints and THIS is the operator's only
      // guidance. Worse, the hand-repair it invited ends in deleting the staging dir, which is the
      // journal. A stale reassurance is bad; a stale instruction that destroys the recovery
      // material is the dangerous direction.
      console.log("⚠️  DURABLE and RESUMABLE, but NOT ATOMIC: staged write + fsync + rename, deletes");
      console.log("    last, O_EXCL lock, and an intent journal written before the first rename.");
      console.log("    IF THIS IS INTERRUPTED: re-run the same --roll command. It detects the tear and");
      console.log("    finishes the swap; --dry-run shows the plan first. Do NOT hand-repair and do NOT");
      console.log("    delete the .roll-staging-* dir — that dir IS the recovery material.");
      console.log("    A SIGKILL leaves .roll.lock held by the dead pid; the next --roll clears a DEAD");
      console.log("    holder automatically (pid-checked, kill -0) and still refuses a LIVE one.");
      console.log("    ⛔ THE REAL RISK IS A PEER, NOT A CRASH. The lock serializes ROLL vs ROLL only;");
      console.log("    an ordinary append takes no lock, and one landing in the swap window can be lost");
      console.log("    SILENTLY — it still loads, still conserves, still passes duplicate-L#. Land or");
      console.log("    commit peer-shared state FIRST. Never run this unattended.\n");
    }
    for (const c of r.changes) console.log(`  ${c.status.padEnd(9)} ${String(c.bytes).padStart(8)}  ${c.file}`);
    // ⛔ STATE THE DENOMINATOR: this
    // compares the PARSED corpus against what was emitted — bytes the reader discarded (e.g. a
    // below-marker stray the guard didn't recognize) are outside the comparison BY CONSTRUCTION.
    // Measured: a 93-line and a 97-line fixture both printed the old unqualified "OK".
    // "OK" here never means "nothing in this directory was lost"; say so in the sentence.
    // A raw bytes-in/bytes-out compare per directory was considered and deliberately NOT built:
    // with the denominator stated in the sentence itself there is no misled reader left for it to
    // rescue — that option was closed on 2026-08-30.
    console.log(`\nconservation: ${r.res.conservation.ok ? "OK" : "FAILED"} (${r.res.conservation.linesBefore} lines — parsed corpus only; bytes the reader discards are outside this comparison)`);
    if (!dryRun) {
      // A SIGKILLed roll leaves .roll.lock held by a dead pid; until this call the normal path
      // refused on it forever (N=3 consecutive refusals, raw stack). Same helper the
      // torn-swap resume already uses; it refuses on a LIVE pid.
      const stalePid = breakDeadRollLock(dir);
      if (stalePid !== null) console.log(`   cleared .roll.lock held by DEAD pid ${stalePid}`);
      // ⛔ LOCK FIRST — before the re-read, or the read it protects is outside the lock.
      const releaseLock = acquireRollLock(dir);
      let raced = false;
      try {
        // Validate BEFORE deleting. A throw after the rmSync loop destroys content.
        validateLayout(r.res, routerName);
        commitLayoutDurably(
          dir,
          r.res,
          routerName,
          r.changes.filter((c) => c.status === "removed").map((c) => c.file),
          // Peer-safety, same contract as processOne: re-read and abort if the corpus moved.
          // Runs post-staging, pre-swap — see commitLayoutDurably.
          () => {
            // ⛔ SHAPE-AGNOSTIC, MIRRORING rollLayout. The classic-shape adapter made the PLAN path handle the
            // classic hot+single-archive shape and swept exactly one call site; this re-read one
            // function away still called `loadLayout` unconditionally, so it threw on every
            // classic dir — most skill dirs. (Was "55 of 56" until 2026-08-26: REFUTED — 98 skill
            // dirs exist and 26 are sharded, so the classic share is ~73%, not 98%. The
            // correction had reached the derived lesson body and NOT this source comment,
            // so a session read the stale figure out of here and relayed it as current.)
            // Plan succeeded, write could not, and `--dry-run`
            // reported a full plan plus `conservation: OK` for an operation that always died.
            // Same reconstruction the plan used, or the md5 compare is against a different corpus.
            // The test itself lives in `rollRaced`, so the self-test drives it, not a copy.
            if (rollRaced(dir, routerName, r)) {
              raced = true;
              throw new Error("roll: RACE");
            }
          },
        );
      } catch (e) {
        if (!raced) throw e;
      } finally {
        // ⛔ NOT `process.exit()` INSIDE THE TRY — exit() skips `finally`, so aborting there would
        // leak the lock and leave the next roll refusing against a holder that no longer exists.
        releaseLock();
      }
      if (raced) {
        console.error("RACE: the layout changed between read and write — re-run");
        process.exit(1);
      }
    }
    // The refusal prints FIRST, above every per-file row, and a dry run exits 0 — so a dry run read
    // through `| tail` showed only "unchanged" rows (2026-10-02, caught by an uncapped re-run).
    if (dryRun && wouldRefuse) console.log("\nWOULD REFUSE — see the first line; nothing was written.");
    process.exit(0);
  }

  const target = argv[shardIdx + 1];
  if (!target || target.startsWith("--")) {
    console.error("usage: --shard <skill|path> --out <dir> [--dry-run]");
    process.exit(2);
  }
  const file = resolveTarget(target);
  const raw = fs.readFileSync(file, "utf8");
  const inputMd5 = md5(raw);
  if (raw.includes(SPLIT_MARKER)) {
    console.error(`ALREADY SPLIT — ${file} carries the ${JSON.stringify(SPLIT_MARKER)} marker. Use --roll instead.`);
    process.exit(1);
  }
  const outDir = outIdx >= 0 ? argv[outIdx + 1] : null;
  const inPlace = argv.includes("--in-place");
  if (!outDir && !inPlace) {
    console.error("refusing to write in place without --in-place; pass --out <dir> for a dry-run layout");
    process.exit(2);
  }
  const dir = outDir ?? path.dirname(file);

  // ⛔ ONE RESOLUTION, THREADED. This passed bare `opts` (so
  // splitMemorySharded defaulted the router to "MEMORY.md") while the write below derived it
  // from the FILENAME: two independent derivations of one fact — the exact defect the
  // router-agreement guard exists to catch, committed BY that guard. It broke `--shard` for every
  // source not named MEMORY.md. Found independently by BOTH reviewers.
  // Measured: `--shard <d>/CHANGELOG.md --in-place` -> rc=1, 1 file at the commit; rc=0,
  // 2 files at its parent. Fails closed, so no data loss — the workflow was simply dead, and
  // `--shard RULES.md` was the remaining path for the RULES split.
  const resolvedRouter = opts.routerName ?? path.basename(file);
  const res = splitMemorySharded(raw, { ...opts, routerName: resolvedRouter, skillDir: path.dirname(file) });
  assertLineConservation(file, res.conservation);

  const s = res.stats;
  // Say what actually happened, never the intent. `--out` GENERATES a layout beside the
  // source and never touches it; only `--in-place` rewrites the ledger.
  const mode = dryRun
    ? "DRY RUN — nothing written"
    : inPlace
      ? `APPLYING IN PLACE to ${dir} — ${file} will be REPLACED by the router`
      : `GENERATING into ${dir} — ${file} is NOT modified`;
  console.log(`${mode}\n`);
  console.log(`source        ${s.sourceBytes.toLocaleString("en-US")} B · ${s.sourceLines.toLocaleString("en-US")} lines · ${s.sections} sections`);
  console.log(`router        ${s.routerBytes.toLocaleString("en-US")} B (cap ${opts.routerCap.toLocaleString("en-US")})`);
  console.log(`files         ${s.partTotal} = ${s.shards} shards + ${s.registers} registers + ${s.legacyParts} legacy parts`);
  console.log(`max file      ${s.maxFileBytes.toLocaleString("en-US")} B (cap ${opts.shardCap.toLocaleString("en-US")})`);
  console.log(`conservation  ${s.ok ? "OK" : "FAILED"} — ${s.linesBefore} lines, md5 ${s.md5Before}\n`);
  const w = Math.max(...res.files.map((f) => f.file.length));
  console.log(`  ${"part".padEnd(5)}${"file".padEnd(w)}  ${"bytes".padStart(9)}  ${"secs".padStart(5)}  ${"decls".padStart(6)}  L# span`);
  for (const f of res.files) {
    console.log(
      `  ${String(f.partNo).padEnd(5)}${f.file.padEnd(w)}  ${String(f.bytes).padStart(9)}  ` +
        `${String(f.sectionCount).padStart(5)}  ${String(f.declCount).padStart(6)}  ${f.lSpan}`,
    );
  }
  for (const warn of res.warnings) console.log(`\n  WARN  ${warn}`);

  if (!dryRun) {
    const nowMd5 = md5(fs.readFileSync(file, "utf8"));
    if (nowMd5 !== inputMd5) {
      console.error(`RACE: ${file} changed between read and write (${inputMd5} -> ${nowMd5}) — re-run`);
      process.exit(1);
    }
    writeLayout(dir, res, resolvedRouter);
  }
  process.exit(0);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) process.exit(selfTest());

  const dryRun = argv.includes("--dry-run");
  // Read-only. Exits 1 when anything needs attention so a gate can branch on it, and prints a
  // VERDICT TOKEN per row so a composing check never has to read rc alone.
  if (argv.includes("--scan-routers")) {
    const i = argv.indexOf("--scan-routers");
    const arg = argv[i + 1];
    const rows = scanRouters(arg && !arg.startsWith("--") ? arg : undefined);
    for (const r of rows) {
      console.log(`${r.verdict.padEnd(8)} ${path.join(r.dir, r.router)}${r.verdict === "current" ? "" : ` — ${r.detail}`}`);
    }
    const bad = rows.filter((r) => r.verdict !== "current");
    console.log(`scanned=${rows.length} needs-attention=${bad.length}`);
    // ⛔ SAY WHAT THIS CANNOT SEE — a clean exit here read as fleet-wide two-tier coverage and is
    // not. scanRouters walks `<skill>/MEMORY*.md` families. The
    // RULES two-tier (split 2026-09-04) has a
    // DIFFERENT layout and a DIFFERENT tool, so it is invisible here by construction, not by bug —
    // and "0 needs-attention" is exactly the shape of a covered check. The line below is printed
    // UNCONDITIONALLY, on the clean path too, because that is the only path where the false read
    // happens. NOT folded into rc: `.githooks/pre-commit` invokes this against a temp checkout of
    // the STAGED tree, where a repo-wide RULES verdict would be answering a different question,
    // and folding it would silently widen that hook's blast radius.
    console.log(
      "coverage: MEMORY two-tier only. The RULES two-tier is NOT scanned here — run `node scripts/rules-tier-split.mjs --check`.",
    );
    process.exit(bad.length ? 1 : 0);
  }
  // Detect+repair composition for stale routers (/wrap runs this;
  // the .githooks/pre-commit arm only WARNS). Scan, repair each STALE/ROLL-DUE via the roll path
  // in a CHILD process per target — each roll's conservation gate and exit code read individually;
  // an in-process loop would share one exit path and a first failure could mask the rest — then
  // RE-SCAN and print a terminal verdict (the checkmark is computed, never asserted;
  // read the VERDICT line, never rc alone). BROKEN/UNKNOWN/ERROR are surfaced, never auto-touched.
  if (argv.includes("--heal")) {
    const i = argv.indexOf("--heal");
    const arg = argv[i + 1];
    const skillsDir = arg && !arg.startsWith("--") ? arg : undefined;
    // A nonexistent/non-dir path threw a raw ENOENT/ENOTDIR stack
    // at rc=1 BEFORE the scanned==0 guard could give its rc=2 advice — the one message that helps
    // never appeared on the commonest path mistake. Catch it and speak.
    let rows;
    try {
      rows = scanRouters(skillsDir);
    } catch (e) {
      console.log(
        `HEAL VERDICT: ERROR — cannot scan ${skillsDir ?? ".claude/skills"}: ${e?.code ?? e?.message ?? e}. ` +
          `Check the path (it must be a PARENT dir whose children are skill dirs).`,
      );
      process.exit(2);
    }
    // ⛔ AN EMPTY SCAN CAN NEVER BE CLEAN. `--heal <dir>` takes the PARENT skills dir and
    // scans its CHILDREN, so the natural per-skill scoping (`--heal .claude/skills/<one>`)
    // scans that skill's inner folders — zero routers — and used to print
    // `CLEAN — scanned=0, all current` (measured 2026-08-30, both arms). Fail loud and
    // print the correct scoped form instead of a confident false all-clear.
    if (!rows.length) {
      const looksLikeSkillDir = skillsDir && fs.existsSync(path.join(skillsDir, "MEMORY.md"));
      // Verdict line goes to STDOUT: /wrap 6b's contract reads the verdict LINE from
      // stdout — a stderr-only ERROR hands a stdout-capturing consumer an empty string.
      console.log(
        `HEAL VERDICT: ERROR — scanned 0 skill directories under ${skillsDir ?? ".claude/skills"}. ` +
          (looksLikeSkillDir
            ? `That path IS a single skill dir; --heal scans a PARENT dir's children, so scoping it to one skill scans nothing. ` +
              `For one skill use: --roll ${skillsDir} --dry-run (report) or --roll ${skillsDir} --force (regenerate).`
            : `An empty scan is never CLEAN — check the path.`),
      );
      process.exit(2);
    }
    const fixable = rows.filter((r) => r.verdict === "STALE" || r.verdict === "ROLL-DUE");
    const manual = rows.filter((r) => !["current", "STALE", "ROLL-DUE"].includes(r.verdict));
    for (const r of manual) {
      console.log(`HEAL SKIPPED ${path.join(r.dir, r.router)} — ${r.verdict} needs a hand: ${r.detail}`);
    }
    // ⛔ POSITIVE TOKEN, never a phrase a caller can key on while a BROKEN router sits in the same
    // line ("nothing to do — … manual=1" printed over an UNLOADABLE layout,
    // and /wrap 6b keyed its skip on that phrase). CLEAN is emitted only when NOTHING needs a hand.
    if (!fixable.length) {
      if (manual.length) {
        console.log(`HEAL VERDICT: ATTENTION — ${manual.length} router(s) need a hand (BROKEN/UNKNOWN/ERROR, listed above); scanned=${rows.length}`);
        process.exit(1);
      }
      console.log(`HEAL VERDICT: CLEAN — scanned=${rows.length}, all current, nothing written`);
      process.exit(0);
    }
    let refused = 0;
    const skipped = [];
    // ⛔ SNAPSHOT THE PRE-EXISTING DIRT ONCE, BEFORE THE LOOP. The per-router check below asks
    // "is this directory dirty?", and a directory can hold MORE THAN ONE ROUTER —
    // `.claude/skills/meta/` holds both CHANGELOG.md and MEMORY.md. So repairing the first
    // router dirties the directory and the second router is then skipped as
    // "possibly a peer's", by dirt THIS RUN JUST MADE. The heal silently does half its job and
    // reports the other half as somebody else's problem.
    //
    // Baseline-diffing is what separates the two: only dirt that existed BEFORE this run began
    // is a reason to refuse. Paths this run wrote are ours and are not a concurrency hazard.
    const dirtyPathsIn = (dir) => {
      const out = spawnSync("git", ["status", "--porcelain", "--", dir], { encoding: "utf8" });
      if (out.status !== 0) return null; // git failed — caller treats as unknown, not as clean
      return (out.stdout || "")
        .split("\n")
        .map((l) => l.slice(3).trim())
        .filter(Boolean);
    };
    const preExistingDirty = new Set(dirtyPathsIn(".") ?? []);
    // A heal run on a shared tree executes whatever renderer is ON DISK: one heal committed 23
    // routers in a form no committed code produced for 79 s, and named no cause. Say so; never refuse.
    if (preExistingDirty.has("scripts/memory-tier-split.mjs")) {
      console.log("HEAL NOTE: scripts/memory-tier-split.mjs has UNCOMMITTED changes — the routers written below follow that working copy, not HEAD; name it in the heal commit.");
    }
    for (const r of fixable) {
      // ⛔ PEER-DIRTY TARGET → SKIP. The roll's swap window (~41 ms, measured) destroys a
      // concurrent append while printing conservation OK — the hazard the roll header has always
      // named. A dirty memory file is the observable precursor; refuse to roll over it.
      const dirtyNow = dirtyPathsIn(r.dir);
      // Only dirt that predates this run refuses. `null` means git itself failed — treat that as
      // unknown and refuse, which is the safe direction.
      const foreignDirty =
        dirtyNow === null ? null : dirtyNow.filter((f) => preExistingDirty.has(f));
      if (foreignDirty === null || foreignDirty.length > 0) {
        // The null arm is a GIT FAILURE, not measured dirt — right refusal, wrong story
        // when the two shared one message. Say which happened.
        console.log(
          foreignDirty === null
            ? `HEAL SKIPPED ${path.join(r.dir, r.router)} — git status FAILED here, so pre-existing dirt cannot be determined; refusing conservatively (fix git first)`
            : `HEAL SKIPPED ${path.join(r.dir, r.router)} — BLOCKED BY: ${foreignDirty.join(", ")} — ${foreignDirty.length === 1 ? "that path was" : "those paths were"} already dirty in ${r.dir} before this heal began (an uncommitted edit, not one this run made). ⛔ The blocker is NOT the file named above: the gate is DIRECTORY-scoped, so ANY dirty file in that dir refuses the roll, and printing only the heal TARGET sent an operator to commit a file that was already clean. Land or commit the BLOCKED-BY paths — and if they are a peer's, leave them and re-run later`,
        );
        skipped.push(r);
        continue;
      }
      const rollArgs = ["--roll", r.dir];
      if (r.verdict === "STALE") rollArgs.push("--force"); // within-cap: --force re-derives the stale router
      if (r.router !== "MEMORY.md") rollArgs.push("--router", r.router);
      if (dryRun) rollArgs.push("--dry-run");
      console.log(`HEAL ${r.verdict} ${path.join(r.dir, r.router)} -> ${rollArgs.join(" ")}`);
      const res = spawnSync(process.execPath, [process.argv[1], ...rollArgs], { stdio: "inherit" });
      if (res.status !== 0) refused++;
    }
    const after = dryRun ? [] : scanRouters(skillsDir).filter((r) => r.verdict !== "current");
    const repaired = fixable.length - refused - skipped.length;
    const clean = !dryRun && refused === 0 && skipped.length === 0 && manual.length === 0 && after.length === 0;
    console.log(
      dryRun
        ? `HEAL VERDICT: DRY RUN — ${fixable.length - skipped.length} would be repaired, ${skipped.length} skipped (dirty), nothing written`
        : `HEAL VERDICT: ${clean ? "CLEAN" : "ATTENTION"} — ${repaired} repaired · ${refused} refused · ${skipped.length} skipped (dirty) · ${manual.length} manual · needs-attention now ${after.length}`,
    );
    process.exit(dryRun || clean ? 0 : 1);
  }
  if (argv.includes("--shard") || argv.includes("--roll")) return shardedMain(argv, dryRun);

  // Strip value-bearing flags AND their values before positional parsing — otherwise
  // `--target 900 web-designer` reads `900` as a skill name and resolves a nonsense path.
  // `--archive-basename` is consumed only by shardedMain (which returns above), but it is
  // registered here anyway: without it, a caller who passes the flag WITHOUT `--shard` falls
  // through to the classic path and its value is read as a POSITIONAL SKILL NAME — so
  // `--archive-basename CHANGELOG-ARCHIVE` would resolve `.claude/skills/CHANGELOG-ARCHIVE/`.
  // That is the exact failure the comment above this line already describes for `--target`.
  const VALUE_FLAGS = new Set(["--target", "--hard-cap", "--shard-cap", "--router-cap", "--out", "--archive-basename", "--router-name"]);
  const BOOL_FLAGS = new Set(["--dry-run", "--trailing-date", "--in-place", "--force"]);
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (VALUE_FLAGS.has(argv[i])) { i++; continue; }
    if (BOOL_FLAGS.has(argv[i])) continue;
    rest.push(argv[i]);
  }
  // ⛔ A FLAG IS NEVER A SKILL NAME. Before this guard, any unrecognised flag fell through as
  // a POSITIONAL and resolved a nonsense path — `--help` crashed with
  // `ENOENT .claude/skills/--help/MEMORY.md` (measured
  // 2026-08-30). Reject unknowns loudly; --sanitize/--all-over are rest-consumed
  // subcommands and stay.
  const REST_SUBCOMMANDS = new Set(["--sanitize", "--all-over"]);
  const unknownFlags = rest.filter((a) => a.startsWith("--") && !REST_SUBCOMMANDS.has(a));
  if (unknownFlags.length) {
    console.error(
      `ERROR: unrecognised flag(s): ${unknownFlags.join(" ")} — a flag is never a skill name. ` +
        `Known forms: --heal [parent-skills-dir] · --roll <skill-dir> [--dry-run|--force] · --shard … · ` +
        `--scan-routers · --sanitize <path…> · --all-over <n> · --self-test.`,
    );
    process.exit(2);
  }
  const classicOpts = {
    dryRun,
    target: numFlag(argv, "--target"),
    hardCap: numFlag(argv, "--hard-cap"),
    trailingDate: argv.includes("--trailing-date"),
  };

  if (rest[0] === "--sanitize") {
    const files = rest.slice(1).map(resolveTarget);
    if (!files.length) {
      console.error("usage: --sanitize <skill|path> [...]");
      process.exit(2);
    }
    for (const f of files) {
      const raw = fs.readFileSync(f, "utf8");
      const r = sanitizeTaskNotificationXml(raw);
      const changed = r.text !== raw;
      console.log(
        `${changed ? (dryRun ? "WOULD CLEAN" : "CLEANED") : "clean      "}  ${f}  ` +
          `tags-stripped=${r.strippedTags} lines-deleted=${r.deletedLines}`,
      );
      if (changed && !dryRun) fs.writeFileSync(f, r.text);
    }
    process.exit(0);
  }

  let files;
  if (rest[0] === "--all-over") {
    const min = Number(rest[1]);
    if (!Number.isFinite(min)) {
      console.error("usage: --all-over <bytes>");
      process.exit(2);
    }
    files = allOver(min);
  } else if (rest.length) {
    files = rest.map(resolveTarget);
  } else {
    // ⛔ LIST EVERY MODE. This printed only the split modes while `--roll` and `--shard` were both
    // parsed and SIX durable files prescribe `--roll` (active-recall.md and meta/SKILL.md among
    // them, plus four skill memory and changelog files). An
    // always-loaded rule prescribing a flag the tool's own usage omits is how a reader concludes
    // the flag was removed. Any new mode added below belongs in this string in the same change.
    console.error(
      [
        "usage: memory-tier-split.mjs <skill|path|--all-over N> [--dry-run]   split a file into hot+archive",
        "       memory-tier-split.mjs --shard <path> --out <dir> [--dry-run]  cut a file into a sharded layout",
        "       memory-tier-split.mjs --scan-routers [<skills-dir>]            READ-ONLY fleet scan",
        "                                                                     which routers are behind their current shard",
        "         (ROUTER-keyed, not dir-keyed: a dir can hold more than one sharded layout, and a",
        "          dir-keyed sweep misses the second one — that is how a second router sat 4",
        "          sections behind while every sweep reported the fleet clean. Writes nothing;",
        "          exits 1 when any router needs attention. Verdicts: current / STALE / ROLL-DUE /",
        "          BROKEN / UNKNOWN / ERROR.)",
        "       memory-tier-split.mjs --roll <dir> [--router <f.md>] [--force] [--dry-run] [--allow-dirty <file>[,<file>]]",
        "                                                                     cut a new shard when the current one is over cap",
        "         (--force ALSO rebuilds a stale router: the manifest and the current-shard",
        "          digest index are a snapshot frozen at the last cut, and --force re-derives",
        "          them. Measured 2026-08-08 on meta/: digest rows 2 -> 19. --shard-cap CANNOT",
        "          be used for this — any value low enough to trigger a cut breaches the",
        "          168/197 KB legacy shards and throws first.)",
        "         (REFUSES, exit 3, when a file it would rewrite or remove was already dirty,",
        "          other than the router and the current part; --dry-run reports WOULD REFUSE.",
        "          --allow-dirty <file>[,<file>] overrides only the files it names.)",
        "       memory-tier-split.mjs --heal [<skills-dir>] [--dry-run]            scan + REPAIR in one pass",
        "         (STALE -> roll --force re-index · ROLL-DUE -> roll shard cut, each in a child",
        "          process so every conservation gate + exit code is read individually; re-scans",
        "          and prints a terminal HEAL VERDICT. BROKEN/UNKNOWN/ERROR surfaced, not touched.",
        "          The repair half of the stale-router fix; /wrap Step 6b runs it.)",
        "       memory-tier-split.mjs --self-test",
      ].join("\n"),
    );
    process.exit(2);
  }

  const head = ["file", "before", "hot", "archive", "cap", "entries", "hot#", "arch#", "conserved"];
  const rows = [];
  let failed = 0;
  for (const f of files) {
    try {
      const s = processOne(f, classicOpts);
      rows.push([
        f.replace(`${SKILLS_DIR}/`, "").replace("/MEMORY.md", ""),
        s.beforeBytes,
        s.hotBytes,
        s.archiveBytes,
        s.digestCap,
        s.entriesTotal,
        s.entriesHot,
        s.entriesArchived,
        s.ok ? "OK" : "FAIL",
      ]);
    } catch (e) {
      failed++;
      rows.push([f, "-", "-", "-", "-", "-", "-", "-", `ERROR: ${e.message}`]);
    }
  }
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => String(c).padEnd(w[i])).join("  ");
  const tot = rows.filter((r) => r[1] !== "-");
  // Report what actually happened, never the intent: "APPLIED" over a run where
  // every file errored is a false state claim, and this tool's whole job is to
  // not lose data quietly.
  const banner = dryRun
    ? "DRY RUN — nothing written"
    : tot.length === 0
      ? `NOTHING APPLIED — all ${failed} file(s) refused`
      : `APPLIED to ${tot.length} file(s)${failed ? ` — ${failed} refused` : ""}`;
  console.log(`${banner}\n`);
  console.log(line(head));
  console.log(w.map((n) => "-".repeat(n)).join("  "));
  for (const r of rows) console.log(line(r));
  if (tot.length) {
    console.log(
      `\n${tot.length} file(s); hot total ${tot.reduce((a, r) => a + r[2], 0)}B, ` +
        `archive total ${tot.reduce((a, r) => a + r[3], 0)}B, ` +
        `max hot ${Math.max(...tot.map((r) => r[2]))}B (cap ${HARD_CAP_BYTES})`,
    );
  }
  if (failed) console.log(`\n${failed} file(s) FAILED — see ERROR rows above.`);
  process.exit(failed ? 1 : 0);
}

// Realpath both sides: a symlinked invocation path otherwise exits 0 with zero output
// (band-overlap.mjs carries the same fix).
// POLARITY: this realpathed correctly but fell back to `false` on an unresolvable argv[1].
// For a GATE an undecidable entrypoint must never resolve to "don't run" — the SSOT falls back
// to the naive compare instead. SSOT: scripts/lib/is-main.mjs.
if (isMainModule(import.meta.url)) main();
