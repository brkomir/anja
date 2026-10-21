#!/usr/bin/env node
// band-directive-preservation.mjs — guard for the always-loaded band DISPLACEMENT pass.
//
// ⛔ NECESSARY, NOT SUFFICIENT (2026-08-25): this gate preserves backticked tokens,
// bold spans and L#### cites — it is STRUCTURALLY BLIND to an unbolded prose HEDGE, and the one
// measured displacement review found 7 dropped hedges with 0 caught here (zero directive losses).
// Pair every displacement pass with a HAND-READ of hedges/qualifiers beside this gate.
//
// WHY: compressing the band (incident narrative → an archive or the L# body each row cites) risks
// deleting a DIRECTIVE while it looks like a story. That is the one regression class no instrument
// sees — `.claude/rules/active-recall.md`'s own maintenance note says it outright: deleting an
// anchor deletes fires. This makes the invisible half mechanically checkable.
//
// WHAT IT PRESERVES (the load-bearing surface, not the prose):
//   · every backticked token — file paths, symbols, commands, env vars, test names
//   · every **bold span** — the directive leads that make a rule scannable
//   · every L#### citation — the pointer to the body the narrative is displaced INTO
// Prose between those anchors is free to compress. A token that disappears is reported.
// Wrap-tolerant since 2026-08-13: the extractors were line-bounded, which silently
// excluded every span that soft-wraps across lines — 28.1% of bash-environment.md's bold spans,
// fail-OPEN on exactly the file being displaced. See softJoin() below; the self-test's wrapped
// DELETION arm fails on the pre-fix code (narrowed: 1 of the 3 wrap arms is
// the load-bearing pre-fix RED; the re-wrap/archive arms are identity controls that pass either way).
//
// ── ARCHIVE-AWARE, AND IT IS THE DEFAULT (2026-08-13) ─────────────────────────────────────────
// The original guard compared anchors STRICTLY PER FILE, which made it structurally unable to
// express the very operation it exists to protect: a MOVE. Measured — the largest
// displacement this corpus has executed (bash-environment.md 156,924 → 118,108 B, −38,816 B, every
// directive kept) — the per-file comparison REDs by the hundreds while the band∪archive union
// reads ~0: the guard RED-ed on a textbook execution of the method, and an always-noisy gate is
// a disabled gate.
//
// ⚠️ FIGURE PROVENANCE, reconciled 2026-08-13 after a review flagged that this header said
// "316 lost" while the shipping commit said 296 — both were true of DIFFERENT extractor stages,
// and neither survives the wrap fix below: 316 = a dev-stage line-bounded read; 296 = the
// commit-time line-bounded read; **389** = the wrap-tolerant extractor on the same diff. And the
// union "~0" was measured crediting the ON-DISK archive: a pure REF-PAIR run
// (`--base '<commit-id>^' --head <commit-id>`) correctly REDs at 389, because that move was SPLIT
// ACROSS COMMITS — the archive file + pointer landed later, in a separate commit. Single-commit
// validation of a split move reds honestly; the reproducible conservation claim is cumulative
// (`--base '<commit-id>^' --head <today>`), whose residuals on 2026-08-13 were adjudicated REWORDS
// (deliberate edits by their own authors), not deletions.
//
// An anchor missing from a band file therefore PASSES iff ALL THREE hold:
//   (a) it resolves VERBATIM, same anchor class, in a `.claude/docs/rules-ARCHIVE/*.md` file, AND
//   (b) the band file RETAINS A POINTER to that archive (the archive path appears in its text), AND
//   (c) the anchor ARRIVED in the archive within the compared range — credit is
//       anchors(archive@HEAD) MINUS anchors(archive@BASE), never the whole archive (the delta credit,
//       2026-08-13: a time-of-read pool credits a stale copy from a PREVIOUS displacement against a
//       present-day deletion, and in reword mode the stale copy keeps the anchor "present" so the
//       mapping gate is never even consulted — the reviewed control bypassed before it is reached.
//       An archive file ABSENT at BASE credits in full: that is the legitimate first-move case, and
//       it is what keeps the cumulative conservation claim reproducible).
// Anchor absent from both → still a loss, still exit 1.
//
// (b) is not decoration and it is not checked separately from discovery — the archive set IS
// derived from the pointers in the post-edit band file. A move that strips the pointer leaves the
// reader with no route to the displaced record, so every anchor it took reads as LOST, which is
// the correct verdict: an unreachable archive is a deletion with extra steps. This is the same
// false-refutation hazard a sharded-memory split fights (grep the dir, not the file) — the pointer
// is what keeps `grep .claude/rules/` from silently under-reporting.
// `--strict-per-file` restores the pre-2026-08-13 behaviour for a pure in-place compression pass.
//
// PLANES: `--base` names the BEFORE ref; the AFTER side is the worktree by default, or a ref via
// `--head`. Pre-push passes BOTH as committed refs (`--base origin/main --head HEAD`) because a
// worktree-vs-commit comparison is not a comparison — it fails OPEN when the worktree carries
// uncommitted additions, the same mixed-plane defect documented at length in the sibling gate
// `check-band-budget.mjs`. Interactive use keeps the worktree default.
//
// ⛔ WHAT THIS GUARD DOES NOT COVER, AND IT IS HALF OF EVERY REAL PASS (2026-08-24, measured on
// the 23-move pass). A "displacement" is TWO operations, not one:
//   (i)  a VERBATIM COPY into the archive  — fails by dropping BYTES     -> THIS GUARD CATCHES IT
//   (ii) a REWRITE of what stays live      — fails by dropping a QUALIFIER -> STRUCTURALLY INVISIBLE
// The live line is condensed prose, not the original minus a tail. A scope qualifier like
// "the marker was absent when measured, so this is LATENT, not live" carries NO backtick, NO bold
// span and NO L# — it is not an anchor, so no anchor-based instrument can miss it. In that pass
// nothing was lost because the dropped qualifiers went TO THE ARCHIVE (checked by hand, live 0 /
// archive 1-2 on four of them); on the next pass that may not hold and this guard would still
// print ✅. **A green run proves the ARCHIVE is faithful. It says nothing about whether the
// rewritten live rule kept the scope it had.** Cheapest closure, if you want one: per rewritten
// line, diff the SET of parenthetical and ⚠️-clause qualifiers before vs after and confirm every
// missing one has an archive home.
//
// ⭐ AND THE CRITERION FOR *WHAT MAY BE COMPRESSED AT ALL* — the question this guard cannot ask,
// from the same pass: **a block is compressible when it ARGUES FOR a directive, and NOT
// compressible when it SEPARATES TWO STATES that would otherwise be confused. Byte pressure does
// not change which kind a block is.** Worked example, both correctly LEFT: the
// `--drift-ok` three-causes block exists because cause (c) satisfies cause (a) WORD-FOR-WORD, so a
// seat that verifies every clause carefully still destroys work — compress the narration and you
// destroy the discrimination, because there the narration IS the mechanism. Same for the GATE-1
// dead end, whose value is that it enumerates four prohibitions AND names the fifth option, and
// which says in its own text that a four-prohibition list with no fifth option is what turns a
// wrong sentence into a guaranteed outcome: compressing it to the directive leaves exactly the
// shape it warns about.
//
// ⛔ THAT CRITERION IS NECESSARY AND NOT SUFFICIENT — IT MISSED A LIVE REGRESSION IN THAT PASS,
// and the sharper form (earned by a reviewer under a FORBIDDEN-TO-OPEN-THE-ARCHIVES constraint,
// 2026-08-24) is: **A LIST OF OBSERVABLE->CAUSE MAPPINGS IS A SEPARATOR EVEN WHEN EACH ROW LOOKS
// LIKE A DATUM, AND MAY ONLY BE SHORTENED IF THE BLOCK ALSO CARRIES A RULE FOR WHAT TO DO WHEN
// NOTHING IN THE LIST FITS.** What was dropped was the `2 1` no-trailing-newline row — the FIFTH
// cause in a four-cause list. It ARGUED nothing, so it did not read as a separator; rows read as
// compressible in a way prose does not. The commit row's own default ("if it refuses, the delta is
// somebody else's — investigate it") then aims a reader at a phantom peer, which is the exact
// failure the row exists to prevent, produced by the row. Restored as (v).
//
// ⭐ AND THE INSTRUMENT LESSON, which generalises to this whole programme: CONSERVATION AND
// USABILITY ARE DIFFERENT PROPERTIES, and no conservation oracle can test the second. The dropped
// line PASSED conservation (1722/1722 fragments homed) because it is sitting in the archive right
// now — but the archive is not always-loaded and the rule is, so a reader carrying only the live
// band had lost a discriminator the corpus still "contains". **Every displacement pass passes a
// conservation check BY CONSTRUCTION, since displacement is what it does.** The check that can fail
// is the EXECUTABILITY one, and its only instrument is a reader given ONLY the live text and made
// to actually DO the thing.
//
// USAGE
//   node scripts/band-directive-preservation.mjs                       # worktree vs HEAD
//   node scripts/band-directive-preservation.mjs --base origin/main --head HEAD
//   node scripts/band-directive-preservation.mjs --strict-per-file     # no archive credit
//   node scripts/band-directive-preservation.mjs --self-test           # RED control per branch
//   node scripts/band-directive-preservation.mjs --reword-mode <mapping.md>   # consolidation gate
//
// ── REWORD MODE (consolidation tier) ──────────────────────────────────────────────────────────
// The default (displacement) comparison is a verbatim MULTISET check — correct for a move, and
// measured ALWAYS-RED on a correct consolidation (a review counted 70/34 multiset alarms on rewrites that
// preserved every obligation; an always-noisy gate is a disabled gate). `--reword-mode` swaps the
// semantics to the panel-composed set:
//   · code + L# anchors: PRESENCE (≥1 in hot∪archive pool). A fully-vanished anchor must match a
//     row in the committed mapping file (adjudicated residual) or the run exits 1.
//   · bold spans: COUNTED, never compared — a reword re-draws directive leads by construction;
//     the count delta is reported for the reviewer, exit-neutral.
//   · TRIGGER CELLS (first column of any markdown table row): FROZEN. Multiset identity, HOT file
//     only — no archive credit, no mapping disposition. Checked in BOTH modes: a trigger-set
//     change is a behavioral edit that gets its own commit, never rides a reword or a relocation
//     (the pilot silently WIDENED one while its mapping claimed "unchanged" — this check exists
//     because of that).
// Mapping rows are `- `-prefixed lines; an anchor is dispositioned iff some row contains it
// verbatim (whitespace-normalized). Stated limit: the match is mention-blind — a row QUOTING an
// anchor credits it; the mapping is a committed, reviewed artifact, which is the control.
//
// EXIT 1 if any anchor was lost. Displacement moves NARRATIVE; an anchor that vanishes is a
// deleted rule. Wired WARN-mode in `.githooks/pre-push` (never blocks; escape SKIP_BAND_PRESERVATION=1),
// and appends ONE JSONL line per run that reaches a verdict, clean runs included, to `.claude/logs/band-preservation-fires.jsonl`
// (redirect with BAND_PRESERVATION_LOG=<path>) — a RATE over it reads ONE filtered population, never the whole file or its line count; the filter is at the logFire call at the end.
//
// ── SCOPING (re-derive; do NOT cite these digits) ─────────────────────────────────────────────
// `node scripts/check-band-budget.mjs --check` prints the live band total and ceiling. Measured
// 2026-08-13: 740,437 B against an 825,000 B ceiling. The previous version of this header carried
// a budget model calibrated when the band was 250,596 B — a third of today's — and its per-line
// compression arithmetic ("~164 edits") described a pass that is no longer the sanctioned method:
// the corpus now DISPLACES to `.claude/docs/rules-ARCHIVE/<file>-cases.md` rather than compressing
// prose in place, which is why this guard needed the archive union at all. A dated number in an
// always-loaded-adjacent header rots silently; the command above is the instrument.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVE_DIR = join(".claude", "docs", "rules-ARCHIVE");
// The archive dir was `.claude/docs/rules-cases/` until it was renamed (2026-08-12).
// A pointer at a PRE-RENAME ref carries the old spelling, so a regex anchored on the new one
// finds no pointer there, withholds ALL archive credit, and reports a displacement as mass
// deletion (measured: 389 false-lost, 2026-08-13). Both
// spellings must match; resolution at a ref then reads whichever path that ref actually holds.
const LEGACY_ARCHIVE_DIR = join(".claude", "docs", "rules-cases");
// Matches both spellings the corpus uses for a pointer: backticked and bare.
// 2026-09-03: a pointer at .claude/orchestrator/<name>.md is a MOVE destination too — orchestrator-only
// doctrine relocated there is credited exactly like an archive.
const ARCHIVE_REF_RE = /(?:\.claude\/docs\/rules-(?:ARCHIVE|cases)\/|\.claude\/orchestrator\/|\.claude\/traps\/)[A-Za-z0-9._-]+\.md/g;

// Band-O IS in this set (2026-08-13): `check-band-budget.mjs` excludes the
// orchestrator band from the BYTE budget on cost-curve grounds (per-turn injection vs cached
// prefix) — a fair reason to skip a byte budget that does NOT transfer to ANCHOR PRESERVATION,
// where an anchor is an anchor regardless of delivery channel. Measured unguarded before this:
// 74 backticked tokens, 19 bold spans, 62 L# cites, 29 trigger cells, injected every turn.
const BAND_O_FILE = join(".claude", "orchestrator", "active-recall-orchestrator.md");

function bandFiles() {
  const files = ["CLAUDE.md", "AGENTS.md"];
  const rel = join(".claude", "rules");
  const dir = join(ROOT, rel);
  if (existsSync(dir)) {
    // RECURSIVE: the sibling gates' membership predicates disagree on subdirectories
    // (the pre-push regex matches them, the budget regex does not) — a rules file in a subdir would
    // TRIGGER gates while being MEASURED by neither. No subdir exists today; recursive is the
    // fail-safe direction (over-covering is harmless, under-measuring is not).
    const walk = (d, prefix) => {
      for (const e of readdirSync(d, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
        if (e.isDirectory()) walk(join(d, e.name), join(prefix, e.name));
        else if (e.name.endsWith(".md")) files.push(join(prefix, e.name));
      }
    };
    walk(dir, rel);
  }
  // 2026-09-03 (the dispatch-payload relocation):
  // the orchestrator-only doctrine now lives in SEVERAL files under .claude/orchestrator/ — Band-O
  // (per-turn injected) plus conventions / commit-doctrine / session-doctrine (SessionStart-injected).
  // Walk the DIRECTORY, recursively, for the same fail-safe reason as .claude/rules/ above: a span
  // relocated there is PRESENT in HEAD, and a single hard-coded path read it as 1,096 anchors LOST.
  const orch = join(".claude", "orchestrator");
  const orchDir = join(ROOT, orch);
  if (existsSync(orchDir)) {
    const walkO = (d, prefix) => {
      for (const e of readdirSync(d, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
        if (e.isDirectory()) walkO(join(d, e.name), join(prefix, e.name));
        else if (e.name.endsWith(".md")) files.push(join(prefix, e.name));
      }
    };
    walkO(orchDir, orch);
  }
  return files;
}

// The trigger-cell FREEZE binds only files whose tables ARE trigger indexes — the firing surface.
// 44% of all band-wide table first-cells are ILLUSTRATIVE (AGENTS.md prefix table, i18n allowlist
// table, bash-environment modifier tables); freezing those REDs legitimate edits with a message
// asserting a class they are not in, and in reword mode they would have no legal disposition
// (2026-08-13). Derived from the obligation (which files' first cells fire rules), not
// from table shape.
const TRIGGER_INDEX_FILES = new Set([join(".claude", "rules", "active-recall.md"), BAND_O_FILE]);

// Soft-wrap join (2026-08-13): the original extractors were line-bounded, so a bold/code
// span that WRAPS across lines was never enrolled — measured 28.1% of bash-environment.md's bold
// spans, i.e. the guard was fail-OPEN on a quarter of the spans in the one file it had been
// pointed at in anger. Joining intra-block newlines (blocks = blank-line separated) makes wrapped
// spans single-line so the SAME extractors enroll them; a span cannot cross a blank line, which
// bounds the mis-pairing radius to one block (content balanced per line is balanced
// per block). Identity is whitespace-NORMALIZED on all three sides (base, head, archive), so the
// same span re-wrapped at a different column still resolves verbatim.
function softJoin(text) {
  return text
    .split(/\n[ \t]*\n/)
    // Strip blockquote continuation markers at the join point too, or a `> `-wrapped span's
    // anchor carries "> " mid-text and its identity breaks when the span leaves the blockquote.
    .map((block) => block.replace(/\s*\n[ \t]*(?:>[ \t]*)*/g, " "))
    .join("\n\n");
}

// Anchors = the surface a reader/scanner keys off. Prose is everything else.
function anchors(text) {
  const joined = softJoin(text);
  const norm = (s) => s.trim().replace(/\s+/g, " ");
  const out = { code: [], bold: [], lessons: [] };
  for (const m of joined.matchAll(/`([^`\n]+)`/g)) out.code.push(norm(m[1]));
  // ⛔ THE CLASS `[^*]` CANNOT HOLD: `**bold with *italic* inside**`. That span never matches at
  // its own opener, so its CLOSER pairs with the NEXT span"s OPENER and extraction flips to the
  // COMPLEMENT — narration in, directives out. softJoin() collapses a block to one line, so the
  // desync runs to end-of-block until a stray `*` re-syncs it. A one-line reproduction
  // shows the COLLATERAL better than the prose does:
  //     input    `**a *b* c** text **real directive** tail`
  //     shipped  [" text "]                       <- the NARRATION, and BOTH directives lost
  //     fixed    ["a *b* c", "real directive"]
  // The span carrying the italics is not the only casualty. Measured over 545
  // real bold leads in one band file: 10 SILENT — a clean GREEN over a DELETED always-loaded
  // directive (1.8%). Tolerant form: any run of non-newline chars up to the next `**`.
  for (const m of joined.matchAll(/\*\*((?:(?!\*\*)[^\n])+)\*\*/g)) out.bold.push(norm(m[1]));
  for (const m of joined.matchAll(/\bL\d{1,4}\b/g)) out.lessons.push(m[0]);
  return out;
}

// Every rules-ARCHIVE path the post-edit band file still points at. THIS IS CONDITION (b):
// no pointer ⇒ empty set ⇒ nothing to credit a missing anchor against.
function archivePointers(text) {
  return [...new Set((text.match(ARCHIVE_REF_RE) || []))];
}

// TRIGGER CELLS — the firing surface. First cell of every markdown table row, separator rows
// excluded. Frozen in BOTH modes, HOT file only: the archive is not a place a trigger can live,
// and a mapping row cannot adjudicate one away.
// Identity of a trigger cell for the relocation PIN: sha1 over the whitespace-normalized cell text
// (exactly what triggerCells() emits). A hash, not the text, because a cell can be 3 KB.
function triggerHash(cell) {
  return createHash("sha1").update(cell).digest("hex");
}

function triggerCells(text) {
  const cells = [];
  for (const line of text.split("\n")) {
    if (!/^\s*\|/.test(line)) continue;
    const parts = line.split("|");
    if (parts.length < 3) continue;
    const cell = parts[1].trim().replace(/\s+/g, " ");
    if (!cell || /^[-: ]+$/.test(cell)) continue; // table separator row
    cells.push(cell);
  }
  return cells;
}

// Reword-mode mapping: `- `-prefixed lines are disposition rows. An anchor is dispositioned iff
// some row contains it as a BOUNDED token after whitespace normalization (mention-blind by design
// — a row QUOTING an anchor credits it; the committed, reviewed mapping is the control for that).
// ⛔ BOUNDED, not bare substring (2026-08-13): a bare `.includes()` let a row mentioning a longer
// lesson number adjudicate a deleted one nested inside it, and a row saying `--only` adjudicate a deleted
// `-o` — rows that never mention the anchor at all. The corpus is dense with exactly these
// colliding shapes (short flags, nested lesson numbers), so the match requires a non-word
// character (or string edge) on BOTH sides of the anchor. The prefix-collision class from
// tests-unit.md (`<key>`/`<key>Note`), reappearing at the adjudication surface.
function parseMappingRows(text) {
  const norm = (s) => s.trim().replace(/\s+/g, " ");
  return text.split("\n").filter((l) => l.trim().startsWith("- ")).map(norm);
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function dispositioned(anchor, rows) {
  const a = anchor.trim().replace(/\s+/g, " ");
  const re = new RegExp("(^|[^\\w])" + escapeRe(a) + "([^\\w]|$)");
  return rows.some((r) => re.test(r));
}

// Multiset difference: an anchor present N times before and N-1 times after IS a loss.
function lost(before, after) {
  const seen = new Map();
  for (const a of after) seen.set(a, (seen.get(a) ?? 0) + 1);
  const missing = [];
  for (const b of before) {
    const n = seen.get(b) ?? 0;
    if (n === 0) missing.push(b);
    else seen.set(b, n - 1);
  }
  return missing;
}

function atRef(ref, file) {
  try {
    return execFileSync("git", ["show", `${ref}:${file}`],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null; // absent at that ref — a new file has nothing to preserve
  }
}

// ⛔ THE AFTER-SIDE IS THE WORKTREE BY DEFAULT, SO A LOST ANCHOR HAS TWO CAUSES AND THEY NEED
// OPPOSITE ACTIONS — and until 2026-09-07 this gate reported them identically, which is the whole
// defect. A peer's UNCOMMITTED edit to any band file reads as a lost anchor that NO COMMIT OF
// YOURS CAN CLEAR, and it re-fires on every future run until somebody commits or reverts it; a
// COMMITTED reword is a real change with a sha you can chase. Measured cost of not splitting them:
// 15 invocations, 9 `anchor(s) lost` readings and 3
// re-adjudications across 54 minutes, each re-reading an instrument that structurally could not
// answer the question being asked of it.
//
// THE DISCRIMINATOR IS PRESENCE AT HEAD, PER ANCHOR: still extractable from the HEAD blob ⇒ the
// loss lives only in the worktree; gone at HEAD too ⇒ it is committed. Only meaningful when the
// after-side IS the worktree — with `--head <ref>` both sides are commits and the question does
// not arise, so the caller passes headRef===null to enable it.
// `readHead` / `runGit` are injectable for the same reason `readArchive` is: the self-test
// exercises THIS function rather than a mirror of it. Production passes neither.
// The per-anchor suffix printed beside each lost anchor. Lifted out of the report loop so the
// self-test can reach it: as a closure its FALLTHROUGH guard was unreachable by any arm, and a
// mutant that deleted the guard scored 48/48 PASS — an unguarded guard on the one line that names
// a sha to a reader.
//
// Indexed, not value-keyed: the same anchor text can be lost twice with different causes.
// ⛔ AND THE UNRESOLVED MESSAGE NAMES ITS ACTUAL CAUSE. One string blamed normalisation for three
// different routes — a genuine normalised span, the resolve cap, and a multi-hit pickaxe — so the
// message was true of one and false of the other two. `why` carries the real reason.
function lossTag(cz, cls, i, a) {
  if (!cz.available) return "";
  const lab = (cz.label[cls] || [])[i];
  if (lab === "worktree") return "  <- WORKTREE-ONLY (uncommitted; NO sha exists and no commit of yours clears it)";
  if (lab !== "committed") return "";           // no label ⇒ say nothing, never assume COMMITTED
  const s = cz.shas.get(a);
  if (s) return `  <- COMMITTED ${s}`;
  const w = cz.why.get(a) || "not-resolved";
  if (w === "empty") return "  <- COMMITTED (anchor normalises to empty — not resolvable, and not attempted)";
  if (w === "no-count-change") return "  <- COMMITTED (no commit in range changed this anchor's count — likely a normalised multi-line span)";
  if (w.startsWith("ambiguous:")) return `  <- COMMITTED (${w.split(":")[1].split(",").length} commits verified as removing it: ${w.slice(10)})`;
  if (w.startsWith("unverified:")) return `  <- COMMITTED (count-changing, NOT verified as removing: ${w.slice(11)} — -S matches substrings)`;
  if (w === "pickaxe-failed") return "  <- COMMITTED (sha lookup failed — use the chase set above)";
  return "  <- COMMITTED (sha not resolved)";
}

function classifyLosses(file, lostByClass, { base, headRef, beforeText = null, compareOpts = null, readHead = null, runGit = null }) {
  const out = { worktreeOnly: new Set(), committed: new Set(), shas: new Map(), why: new Map(), chase: [], label: {}, counts: {}, available: false };
  if (headRef !== null) return out;                 // both sides are refs — nothing to split
  const headText = readHead ? readHead(file) : atRef("HEAD", file);
  if (headText === null || beforeText === null) return out;   // cannot classify — the caller says so out loud
  out.available = true;
  // ⛔ THE BASELINE IS COMPUTED BY CALLING compare(), NOT BY RE-DERIVING IT FROM anchors().
  // `lostByClass` IS compare()'s output — archive-credited, reword-adjudicated, trigger-frozen.
  // A budget built from raw anchors() answers a NARROWER question, so wherever the two disagree
  // it over-counts committed removals and the label goes confidently COMMITTED. Reproduced
  // end-to-end: a commit legitimately MOVES an anchor hot -> archive (credited, no loss), a peer
  // then uncommitted-deletes it from the ARCHIVE, the hot file is byte-identical to HEAD — and the
  // raw-anchor budget printed `<- COMMITTED <sha>` naming the commit that PRESERVED it, while the
  // ref-vs-ref control reported every anchor preserved. Same shape in reword mode.
  // THE GENERAL RULE, which is the part worth keeping: when code classifies the output of a
  // function, compute the classifier's baseline BY CALLING THAT FUNCTION, never with a cheaper
  // formula that happens to be in reach.
  const headLost = compare(beforeText, headText, compareOpts || {});
  const count = (arr) => { const m = new Map(); for (const x of arr || []) m.set(x, (m.get(x) ?? 0) + 1); return m; };
  // TRIGGER is in the class list because it is the class this whole change exists for: trigger
  // cells come from triggerCells(), not anchors(), so a raw-anchor budget could not see them and
  // a lost trigger cell printed BARE — committed and worktree-only indistinguishable.
  for (const cls of ["code", "bold", "lessons", "trigger"]) {
    const budget = count(headLost[cls]);            // instances compare() says are gone AT HEAD
    const arr = lostByClass[cls] || [];
    const labels = [];
    for (const a of arr) {
      const left = budget.get(a) ?? 0;
      if (left > 0) { budget.set(a, left - 1); labels.push("committed"); out.committed.add(a); }
      else { labels.push("worktree"); out.worktreeOnly.add(a); }
    }
    out.label[cls] = labels;
  }
  // ⛔ HEADER COUNTS ARE OCCURRENCE COUNTS OVER THE LABELS, NOT Set SIZES. The Sets are keyed by
  // anchor TEXT and `n` is an occurrence count, so a Set-sized header contradicts its own
  // itemisation whenever an anchor repeats. RE-DERIVE, never cite from here (cite a
  // spec, never a number a grep can answer) — count per file with the anchors() above: at
  // 2026-09-07 08:5xZ, 663 distinct code anchors repeat inside a single band file, covering 1,800
  // of 5,563 occurrences (32.4%). Same set-vs-multiset defect one level up, in the summary
  // instead of the classifier.
  const all = Object.values(out.label).flat();
  out.counts = { worktree: all.filter((x) => x === "worktree").length, committed: all.filter((x) => x === "committed").length };
  if (out.counts.committed > 0) {
    try {
      out.chase = (runGit ? runGit(["log", "--format=%h", `${base}..HEAD`, "--", file])
        : execFileSync("git", ["log", "--format=%h", `${base}..HEAD`, "--", file],
            { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))
        .split("\n").filter(Boolean);
    } catch { out.chase = []; }
    // ⛔ RESOLVE EXACTLY WHAT THE ITEMISATION PRINTS — 20 PER CLASS, not 20 across all classes.
    // A single cap over one Set starved whichever class came last in insertion order (always
    // `lessons`, the one pointing at the displaced body) and then blamed the miss on
    // normalisation. The cap and the print must be the same set or the message lies about why.
    const wanted = [];
    for (const cls of ["code", "bold", "lessons", "trigger"])
      for (const [i, a] of (lostByClass[cls] || []).slice(0, 20).entries())
        if (out.label[cls][i] === "committed" && !wanted.includes(a)) wanted.push(a);
    for (const a of wanted) {
      // An EMPTY normalised anchor makes `-S` consume the range as its own value and walk the
      // whole file history. 10 exist in the corpus today.
      if (!a) { out.why.set(a, "empty"); continue; }
      let hits = [];
      try {
        hits = (runGit ? runGit(["log", "--format=%h", `-S${a}`, `${base}..HEAD`, "--", file])
          : execFileSync("git", ["log", "--format=%h", `-S${a}`, `${base}..HEAD`, "--", file],
              { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))
          .split("\n").filter(Boolean);
      } catch { out.why.set(a, "pickaxe-failed"); continue; }
      // ⛔ `-S` IS COUNT-BASED AND MATCHES SUBSTRINGS, so a commit touching only unrelated prose
      // that happens to contain the anchor as a substring can be the SINGLE hit while the real
      // removing commit — which removed the anchor and added another substring containing it —
      // leaves the count unchanged and never appears. Taking hits.length===1 on trust printed a
      // confident wrong sha: a reader opens it, finds nothing touching the anchor, and dismisses
      // a real committed loss. Reachability, band-wide distinct code anchors, re-derived
      // 2026-09-07 08:5xZ: 1,011 of 3,672 are a substring of another and 246 are <=3 chars — the
      // figures drift by ones as peers commit, so re-run rather than quote. A hit is a CANDIDATE
      // and gets VERIFIED —
      // re-extract at sha^ and sha and require the count to have actually dropped there.
      const verified = [];
      for (const h of hits.slice(0, 4)) {
        try {
          const at = (ref) => {
            const txt = runGit ? runGit(["show", `${ref}:${file}`])
              : execFileSync("git", ["show", `${ref}:${file}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
            const x = anchors(txt); x.trigger = triggerCells(txt);
            return ["code", "bold", "lessons", "trigger"].reduce((s, c) => s + (x[c] || []).filter((y) => y === a).length, 0);
          };
          if (at(`${h}^`) > at(h)) verified.push(h);
        } catch { /* unreachable ref — cannot verify, so it is not a verified candidate */ }
      }
      if (verified.length === 1) out.shas.set(a, verified[0]);
      else if (verified.length > 1) out.why.set(a, `ambiguous:${verified.join(",")}`);
      else if (hits.length > 0) out.why.set(a, `unverified:${hits.slice(0, 3).join(",")}`);
      else out.why.set(a, "no-count-change");
    }
  }
  return out;
}

// afterText's pointers name the archives; `readArchive` supplies their text. Injectable so the
// self-test exercises this real code path instead of a mirror of it.
function compare(beforeText, afterText, { archiveAware = true, readArchive = null, readArchiveBase = null, reword = false, mappingRows = [], freezeTriggers = true, pinnedTriggerHashes = null } = {}) {
  const b = anchors(beforeText);
  const a = anchors(afterText);
  const pointers = archiveAware ? archivePointers(afterText) : [];
  const pool = { code: [...a.code], bold: [...a.bold], lessons: [...a.lessons] };
  const credited = [];
  const fullCredit = [];
  const deltaCredited = [];
  for (const p of pointers) {
    const text = readArchive ? readArchive(p) : null;
    if (text == null) continue;          // pointer names a file we cannot read → credits nothing
    const ar = anchors(text);
    // Delta credit (2026-08-13): credit the DELTA, never the whole archive. An anchor already
    // in the archive at BASE did not move in THIS range, so it cannot absorb a present-day hot
    // deletion — and in reword mode a whole-archive pool kept such anchors "present", bypassing
    // the mapping gate entirely. Archive absent at BASE → full credit (the first-move case; keeps
    // the cumulative conservation claim reproducible). lost(head, base) IS multiset head−base.
    // ⚠ RENAME-LAUNDER residual (2026-08-13): full credit keys on the pointer
    // PATH being absent at BASE, not on content novelty — a commit that COPIES an old archive to
    // a new path re-enters the stale-credit class. At this signature first-move and rename are
    // indistinguishable, so the mitigation is a LOUD per-pointer report (fullCredit below), which
    // the caller prints for the reviewer to verify against a rename/copy.
    // ⚠ RANGE-SENSITIVE (measured 2026-08-13, the 389-false-lost forensics): a TWO-COMMIT
    // displacement — archive lands at commit N-1, hot trim at commit N — reports the trim
    // commit's NARROW range (N-1..N) as mass deletion, because the archive existed at base and
    // its in-range delta is 0. That is the delta credit working as designed (the live pre-push range spans
    // both commits and credits in full); a forensic run must too: --base before the archive-add.
    // deltaCredited below feeds the printed hint for exactly this signature.
    const baseText = readArchiveBase ? readArchiveBase(p) : null;
    const delta = baseText == null
      ? ar
      : (() => { const ab = anchors(baseText); return {
          code: lost(ar.code, ab.code),
          bold: lost(ar.bold, ab.bold),
          lessons: lost(ar.lessons, ab.lessons),
        }; })();
    if (readArchiveBase && baseText == null) {
      fullCredit.push({ pointer: p, n: ar.code.length + ar.bold.length + ar.lessons.length });
    } else if (readArchiveBase) {
      deltaCredited.push({ pointer: p, added: delta.code.length + delta.bold.length + delta.lessons.length });
    }
    pool.code.push(...delta.code);
    pool.bold.push(...delta.bold);
    pool.lessons.push(...delta.lessons);
    credited.push(p);
  }
  // Trigger cells: HOT text only on both sides — deliberately outside the archive-credit pool,
  // deliberately outside the mapping. Both modes, TRIGGER-INDEX files only (caller scopes via
  // freezeTriggers; illustrative tables are not a firing surface). ⚠ ONE-DIRECTIONAL,
  // not multiset identity: lost() gates DELETED/CHANGED cells; an ADDED row is reported
  // exit-neutral via trigAdded (an addition is also its-own-commit material, but blocking it here
  // would make the warn-mode report indistinguishable from a deletion — the reviewer reads both).
  const trigHot = freezeTriggers ? lost(triggerCells(beforeText), triggerCells(afterText)) : [];
  const trigAdded = freezeTriggers ? lost(triggerCells(afterText), triggerCells(beforeText)).length : 0;
  // ORCHESTRATOR RELOCATION CREDIT (introduced with the dispatch-payload relocation): a trigger cell
  // that reappears VERBATIM as a table row's trigger
  // cell in a pointed-to .claude/orchestrator/*.md is credited. That file is a live firing surface for
  // the one seat that can act on those rows (SessionStart-delivered),
  // which an ARCHIVE is not — so the freeze stands unchanged for archives, for a
  // trigger that simply vanishes, and for a trigger merely QUOTED in orchestrator prose
  // (triggerCells() reads table rows only). Multiset: each moved cell is consumed once. The credited
  // set is reported per file so a reviewer sees exactly which triggers left the universal surface.
  const ORCH_PREFIX = join(".claude", "orchestrator") + "/";
  let trigger = trigHot;
  let trigCredited = [];
  if (freezeTriggers && archiveAware && trigHot.length) {
    const orchPool = [];
    for (const p of pointers) {
      if (!p.startsWith(ORCH_PREFIX)) continue;
      const text = readArchive ? readArchive(p) : null;
      if (text == null) continue;
      orchPool.push(...triggerCells(text));
    }
    trigger = lost(trigHot, orchPool);
    trigCredited = lost(trigHot, trigger);
  }
  // THE PIN: a credited relocation is SILENT only
  // when the cell's hash sits in .claude/band-trigger-relocation-pins.json, which records WHO ruled it.
  // A credited cell that is NOT pinned counts as LOST with its own label — a trigger left the universal
  // firing surface and nobody adjudicated it. Exit-neutral would let the next relocation pass silently;
  // warn-always would fire on the seven adjudicated cells forever and train readers to skip the gate
  // (.githooks/pre-push:303). The pin gives the ruling a durable home and the counter-risk a real gate.
  // No pin file ⇒ empty set ⇒ every credited cell is unadjudicated (fail-closed).
  let trigUnadjudicated = [];
  if (trigCredited.length) {
    const pins = pinnedTriggerHashes instanceof Set ? pinnedTriggerHashes : new Set();
    trigUnadjudicated = trigCredited.filter((c) => !pins.has(triggerHash(c)));
    trigCredited = trigCredited.filter((c) => pins.has(triggerHash(c)));
  }
  if (!reword) {
    return {
      code: lost(b.code, pool.code),
      bold: lost(b.bold, pool.bold),
      lessons: lost(b.lessons, pool.lessons),
      trigger,
      trigCredited,
      trigUnadjudicated,
      trigAdded,
      boldDelta: null,
      boldVanished: [],
      adjudicated: [],
      fullCredit,
      deltaCredited,
      pointers,
      credited,
    };
  }
  // REWORD: presence (≥1 in pool), not multiset — a collapse N→1 is the sanctioned operation.
  // Fully-vanished anchors split into adjudicated (a mapping row owns the deletion) vs lost.
  const vanished = (baseArr, poolArr) => {
    const have = new Set(poolArr);
    return [...new Set(baseArr)].filter((x) => !have.has(x));
  };
  const split = (arr) => {
    const adjudicated = [], lostArr = [];
    for (const x of arr) (dispositioned(x, mappingRows) ? adjudicated : lostArr).push(x);
    return [adjudicated, lostArr];
  };
  const [adjCode, lostCode] = split(vanished(b.code, pool.code));
  const [adjL, lostL] = split(vanished(b.lessons, pool.lessons));
  // A NET count cannot see a delete PAIRED WITH AN ADD — and a consolidation IS delete-N-add-M,
  // so the residual sat on this mode's primary use case (reproduced here).
  // Same semantics code + L# anchors already get in reword mode: set-presence over hot∪archive,
  // then mapping-adjudicated. Strictly WEAKER than the multiset identity that measured 70/34
  // always-RED, so that number does not transfer — see the gate below for the six-consolidation
  // measurement. Exit-NEUTRAL, exactly as boldDelta is.
  const [, lostBold] = split(vanished(b.bold, pool.bold));
  return {
    code: lostCode,
    bold: [],                                   // counted, never compared, in reword mode
    lessons: lostL,
    trigger,
    trigCredited,
    trigUnadjudicated,
    trigAdded,
    boldDelta: a.bold.length - b.bold.length,   // hot-file count delta, exit-neutral
    boldVanished: lostBold,                     // set-presence loss the net count cannot see
    adjudicated: [...adjCode, ...adjL],
    fullCredit,
    deltaCredited,
    pointers,
    credited,
  };
}

const ORCHESTRATOR_DIR = join(".claude", "orchestrator");   // 2026-09-03: a MOVE destination for orchestrator-only doctrine
// `.claude/traps/` is a MOVE destination too. It is NOT an
// archive — it is LIVE doctrine, delivered per Bash call by .claude/hooks/shell-trap-inject.sh
// instead of carried in context. Crediting it here is what lets the shell-trap split register as a
// MOVE rather than as mass deletion; without it this gate reports every relocated directive lost,
// which is precisely the false alarm the 2026-08-13 archive-awareness work exists to prevent.
const TRAPS_DIR = join(".claude", "traps");
function isArchivePath(relPath) {
  return relPath.startsWith(ARCHIVE_DIR + "/") || relPath.startsWith(LEGACY_ARCHIVE_DIR + "/") || relPath.startsWith(ORCHESTRATOR_DIR + "/") || relPath.startsWith(TRAPS_DIR + "/");
}

function readArchiveFromDisk(relPath) {
  // Pointers are repo-relative by construction; refuse anything that escapes the archive dirs.
  // A legacy-spelled pointer read from the WORKTREE fails closed (the dir no longer exists).
  if (!isArchivePath(relPath)) return null;
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, "utf8");
}

function readArchiveAtRef(ref) {
  return (relPath) => {
    if (!isArchivePath(relPath)) return null;
    return atRef(ref, relPath);
  };
}

function logFire(payload) {
  const target = process.env.BAND_PRESERVATION_LOG || join(ROOT, ".claude", "logs", "band-preservation-fires.jsonl");
  try {
    mkdirSync(dirname(target), { recursive: true });
    appendFileSync(target, JSON.stringify(payload) + "\n");
  } catch (e) { console.error(`band-preservation: fires-log record NOT written to ${target} (${e?.code ?? e}) — this run is missing from the log and from any rate read over it; the verdict and exit code are unaffected.`); /* telemetry must never break the gate */ }
}

function selfTest() {
  const base =
    "Rule: **always gate** the `foo(bar)` call. See L123.\n" +
    "**NARRATIVE LEAD** the `incident-token` measured L456 at length.\n";

  // The displaced half, verbatim, as it would land in the archive.
  const archiveText = "**NARRATIVE LEAD** the `incident-token` measured L456 at length.\n";
  const POINTER = ".claude/docs/rules-ARCHIVE/demo-cases.md";
  const archives = { [POINTER]: archiveText };
  const readArchive = (p) => (p in archives ? archives[p] : null);

  // A LEGITIMATE MOVE: narrative gone from the band file, pointer retained, archive holds it.
  const moved =
    "Rule: **always gate** the `foo(bar)` call. See L123.\n" +
    `> Full incident record: \`${POINTER}\`.\n`;
  // A TRUE DELETION: byte-identical band file to `moved`, but the archive does NOT hold the
  // anchors. Same input, opposite verdict — so the arm cannot pass for a reason unrelated to
  // the archive lookup.
  const emptyArchive = () => null;

  const cases = [
    // [label, afterText, opts, wantCount, beforeOverride?, exact?] — 6 fields (this
    // comment documented 4 while the loop destructures 6). Semantics: wantCount 0 ⇒ got MUST be 0;
    // wantCount>0 without `exact` ⇒ got >= wantCount (a floor — cannot catch over-reporting);
    // with `exact: true` ⇒ got === wantCount. Newer arms pass `exact`; prefer it.
    ["unchanged → 0 lost (the row whose answer MUST be zero)", base, { readArchive }, 0],
    ["prose compressed, anchors kept → 0 lost",
      "Rule: **always gate** the `foo(bar)` call. See L123. **NARRATIVE LEAD** `incident-token` L456\n",
      { readArchive }, 0],
    ["a backticked symbol dropped → RED", "Rule: **always gate** the call. See L123.\n**NARRATIVE LEAD** `incident-token` L456\n", { readArchive }, 1, undefined, true],
    ["a bold directive dropped → RED", "Rule: always gate the `foo(bar)` call. See L123.\n**NARRATIVE LEAD** `incident-token` L456\n", { readArchive }, 1, undefined, true],
    // ⛔ THE :248 EXTRACTOR CLASS. The shipped `[^*\n]+` cannot match a bold span holding
    // *emphasis*, so it extracted NEITHER before nor after and reported 0 — a clean GREEN over a
    // DELETED always-loaded directive. This arm is the discriminator: it goes RED only with the
    // tolerant form. The rest of the suite is STRUCTURALLY INCAPABLE of exhibiting it — a
    // measurement found ZERO bare asterisks in this file body, so 50/50 was never evidence here.
    ["ITALIC-INSIDE-BOLD: a directive carrying *emphasis*, deleted → RED (the :248 class)",
      "Rule: here. See L123.\n", { readArchive: emptyArchive }, 1,
      "Rule: **gate *every* call** here. See L123.\n", true],
    ["an L# cite dropped → RED", "Rule: **always gate** the `foo(bar)` call.\n**NARRATIVE LEAD** `incident-token` L456\n", { readArchive }, 1, undefined, true],
    ["duplicate collapsed to one → RED (multiset, not set)", "**always gate** `foo(bar)` L123 **NARRATIVE LEAD** `incident-token` L456\n", { readArchive }, 1, undefined, true],

    // ── ARCHIVE-AWARE: both controls. Same `moved` text in all four. ──
    ["MOVE: archive holds the anchors + pointer retained → 0 lost (the legitimate move)",
      moved, { readArchive }, 0],
    ["DELETION: identical band text, archive EMPTY → RED (the archive lookup is load-bearing)",
      moved, { readArchive: emptyArchive }, 3, undefined, true],
    ["MOVE without a pointer → RED (condition (b): an unreachable archive is a deletion)",
      "Rule: **always gate** the `foo(bar)` call. See L123.\n", { readArchive }, 3, undefined, true],
    ["MOVE under --strict-per-file → RED (the opt-out still refuses cross-file credit)",
      moved, { readArchive, archiveAware: false }, 3, undefined, true],
    ["pointer to an archive that does not resolve → RED (a dangling pointer credits nothing)",
      "Rule: **always gate** the `foo(bar)` call. See L123.\n> See `.claude/docs/rules-ARCHIVE/nope-cases.md`.\n",
      { readArchive }, 3, undefined, true],
    // Pre-rename spelling (rules-cases/, the dir's name before the rename): a pointer at a
    // pre-rename REF must be extracted AND resolved, or every historical-range invocation
    // reports displacement as mass deletion (the 389-false-lost bug, 2026-08-13).
    ["LEGACY rules-cases/ pointer + archive holds the anchors → 0 lost (pre-rename ref credit)",
      "Rule: **always gate** the `foo(bar)` call. See L123.\n> Full incident record: `.claude/docs/rules-cases/demo-cases.md`.\n",
      { readArchive: (p) => (p === ".claude/docs/rules-cases/demo-cases.md" ? archiveText : null) }, 0],
    ["LEGACY pointer, archive EMPTY → RED (legacy spelling gets no free pass)",
      "Rule: **always gate** the `foo(bar)` call. See L123.\n> Full incident record: `.claude/docs/rules-cases/demo-cases.md`.\n",
      { readArchive: emptyArchive }, 3, undefined, true],
    // ── TRAPS destination (2026-09-21). `.claude/traps/` is LIVE doctrine delivered per Bash call,
    // not an archive, and it must credit a MOVE exactly like one or the shell-trap split registers
    // as mass deletion. ⚠️ The `.claude/orchestrator/` destination added 2026-09-03 shipped with NO
    // arm at all; these two cover both shapes of the same predicate, so neither can regress silently.
    ["MOVE to .claude/traps/ + pointer retained → 0 lost (the split's legitimate move)",
      "Rule: **always gate** the `foo(bar)` call. See L123.\n> Delivered per command: `.claude/traps/shell-traps.md`.\n",
      { readArchive: (p) => (p === ".claude/traps/shell-traps.md" ? archiveText : null) }, 0],
    ["traps pointer, destination EMPTY → RED (the traps lookup is load-bearing, not a free pass)",
      "Rule: **always gate** the `foo(bar)` call. See L123.\n> Delivered per command: `.claude/traps/shell-traps.md`.\n",
      { readArchive: emptyArchive }, 3, undefined, true],
  ];

  // ── WRAP-TOLERANCE arms (2026-08-13). The first arm is the mutation-proof-by-history:
  // under the pre-fix line-bounded extractor the wrapped span was never ENROLLED, so its deletion
  // scored 0 lost (fail-OPEN) — this arm read the opposite of its expectation on that code.
  const wrappedBase = "Rule: **always gate the\n  upload path** before `put()`. See L88.\n";
  const POINTER2 = ".claude/docs/rules-ARCHIVE/demo2-cases.md";
  const readArchive2 = (p) =>
    p === POINTER2 ? "**always gate the upload\npath** — wrapped differently in the archive.\n" : null;
  cases.push(
    ["WRAPPED bold span DELETED → RED (pre-fix: fail-open, span never enrolled)",
      "Rule: always gate before `put()`. See L88.\n", { readArchive }, 1, wrappedBase, true],
    ["wrapped span RE-WRAPPED at a different column → 0 lost (whitespace-normalized identity)",
      "Rule: **always gate\nthe upload path** before `put()`. See L88.\n", { readArchive }, 0, wrappedBase],
    ["wrapped span MOVED to an archive that wraps it differently → 0 lost",
      `Rule: before \`put()\`. See L88.\n> Full record: \`${POINTER2}\`.\n`,
      { readArchive: readArchive2 }, 0, wrappedBase],
    ["unpaired ** across blocks does NOT pair: deleting the code token loses EXACTLY 1 (no phantom bold)",
      "left ** open\n\nright ** close L9\n", { readArchive }, 1,
      "left ** open\n\nright ** close `tok` L9\n", true],
  );

  // ── REWORD-MODE + TRIGGER-FREEZE arms (consolidation tier). The
  // first two are the discriminating PAIR: identical fixture, opposite verdicts by mode — which
  // is what proves the mode switch is load-bearing rather than decorative (substitution beats
  // deletion, tests-unit.md mutation-strength asymmetry).
  const dupBase = "**always gate** `foo(bar)` L123.\n**always gate** the `foo(bar)` call again, L123.\n";
  const collapsedDup = "**always gate** `foo(bar)` L123.\n";
  const delBase = "keep `kept-token` and `gone-token` here, L123.\n";
  const delAfter = "keep `kept-token` here, L123.\n";
  const dropMapping = parseMappingRows("- DROP `gone-token` — revision-history, deleted with its narrative\n");
  const tblBase = "| trig A | act |\n|---|---|\n| when foo | do bar |\n";
  const tblChanged = "| trig A | act |\n|---|---|\n| when foo AND baz | do bar |\n";
  const trigMapping = parseMappingRows("- REWORD trigger: when foo → when foo AND baz (widened)\n");
  // Fixtures for the orchestrator-relocation credit: the SAME row as a table row in an orchestrator
  // file (credits), as a table row in an archive (does not), and as prose in an orchestrator file (does not).
  const ORCH_PTR = ".claude/orchestrator/demo-doctrine.md";
  const ARCH_TRIG_PTR = ".claude/docs/rules-ARCHIVE/demo-trigger-cases.md";
  const ORCH_PROSE_PTR = ".claude/orchestrator/demo-prose.md";
  archives[ORCH_PTR] = "| trig | act |\n|---|---|\n| when foo | do bar |\n";
  archives[ARCH_TRIG_PTR] = "| trig | act |\n|---|---|\n| when foo | do bar |\n";
  archives[ORCH_PROSE_PTR] = "The old row said: when foo, do bar. No table here.\n";
  const tblMovedOrch = "| trig A | act |\n|---|---|\n" + `> Moved: \`${ORCH_PTR}\`.\n`;
  const tblMovedArch = "| trig A | act |\n|---|---|\n" + `> Moved: \`${ARCH_TRIG_PTR}\`.\n`;
  const tblMovedOrchProse = "| trig A | act |\n|---|---|\n" + `> Moved: \`${ORCH_PROSE_PTR}\`.\n`;
  cases.push(
    ["REWORD: N→1 collapse, no mapping → 0 (presence predicate; the sanctioned operation)",
      collapsedDup, { readArchive, reword: true, mappingRows: [] }, 0, dupBase, true],
    ["PAIR control: the SAME collapse in displacement mode → RED (multiset; modes discriminate)",
      collapsedDup, { readArchive }, 3, dupBase, true],
    ["REWORD: code anchor fully deleted WITH a mapping disposition → 0 (adjudicated residual)",
      delAfter, { readArchive, reword: true, mappingRows: dropMapping }, 0, delBase, true],
    ["REWORD: same deletion WITHOUT a disposition → RED (undispositioned loss gates)",
      delAfter, { readArchive, reword: true, mappingRows: [] }, 1, delBase, true],
    ["REWORD: L# cite deleted without disposition → RED",
      "keep `kept-token` L123.\n", { readArchive, reword: true, mappingRows: [] }, 1,
      "keep `kept-token` L123 L999.\n", true],
    ["REWORD: bold span deleted → 0 gated (counted-not-compared; silence arm)",
      "the `kept-token` line.\n", { readArchive, reword: true, mappingRows: [] }, 0,
      "**directive lead** the `kept-token` line.\n", true],
    ["TRIGGER frozen under reword: cell changed → RED even though a mapping row QUOTES it",
      tblChanged, { readArchive, reword: true, mappingRows: trigMapping }, 1, tblBase, true],
    ["TRIGGER silence arm: identical table across a reword collapse → 0",
      tblBase + collapsedDup, { readArchive, reword: true, mappingRows: [] }, 0, tblBase + dupBase, true],
    ["TRIGGER binds displacement mode too: cell deleted → RED",
      tblChanged, { readArchive }, 1, tblBase, true],
    // ORCHESTRATOR RELOCATION CREDIT (2026-09-04). MEASURED by
    // mutation `if (false && freezeTriggers && …)`: arm 1 RED (lost 1), the three negative
    // controls below still PASS — the mutation removes the CREDIT and leaves the FREEZE intact.
    ["TRIGGER relocated as a TABLE ROW into a pointed-to .claude/orchestrator/ file, PINNED → 0 (credited)",
      tblMovedOrch, { readArchive, pinnedTriggerHashes: new Set([triggerHash("when foo")]) }, 0, tblBase, true],
    ["TRIGGER relocated into an orchestrator file but NOT PINNED → 1 (relocated, unadjudicated)",
      tblMovedOrch, { readArchive }, 1, tblBase, true],
    ["TRIGGER relocated into a pointed-to rules-ARCHIVE file → still 1 (archives never credit a trigger)",
      tblMovedArch, { readArchive }, 1, tblBase, true],
    ["TRIGGER merely QUOTED in orchestrator prose (no table row) → still 1",
      tblMovedOrchProse, { readArchive }, 1, tblBase, true],
    ["TRIGGER gone with NO pointer → still 1",
      "| trig A | act |\n|---|---|\n", { readArchive }, 1, tblBase, true],
  );

  // ── Delta-credit arms, stale archive copy (2026-08-13): credit is the archive
  // DELTA (head − base). A copy archived BEFORE this range cannot absorb a hot deletion — in
  // either mode — and the reword arm proves the mapping gate is REACHED again for that class.
  const P3 = ".claude/docs/rules-ARCHIVE/demo3-cases.md";
  const staleArchive = "old record: `stale-token` from a previous displacement.\n";
  const readArchive3 = (p) => (p === P3 ? staleArchive : null);
  const readArchiveBaseLacks = (p) => (p === P3 ? "unrelated old content.\n" : null);
  const staleBase = "**keep** `stale-token` here.\n> Full record: `" + P3 + "`.\n";
  const staleAfter = "**keep** here.\n> Full record: `" + P3 + "`.\n";
  cases.push(
    ["delta credit: anchor archived at BASE and HEAD alike, deleted from hot → RED (stale copy credits nothing)",
      staleAfter, { readArchive: readArchive3, readArchiveBase: readArchive3 }, 1, staleBase, true],
    ["delta credit control: archive ABSENT at base → 0 (the first-move case still credits in full)",
      staleAfter, { readArchive: readArchive3 }, 0, staleBase, true],
    ["delta credit control: base archive exists but LACKS the anchor → 0 (delta credits the arrival)",
      staleAfter, { readArchive: readArchive3, readArchiveBase: readArchiveBaseLacks }, 0, staleBase, true],
    ["delta credit reword: stale copy + no disposition → RED (the mapping gate is REACHED now)",
      staleAfter, { readArchive: readArchive3, readArchiveBase: readArchive3, reword: true, mappingRows: [] }, 1, staleBase, true],
    ["delta credit reword: stale copy WITH a disposition → 0 (adjudicated residual reachable for this class)",
      staleAfter, { readArchive: readArchive3, readArchiveBase: readArchive3, reword: true,
        mappingRows: parseMappingRows("- DROP `stale-token` — stale archive copy, deletion adjudicated\n") }, 0, staleBase, true],
  );

  // ── ADJUDICATION-COLLISION arms (2026-08-13): the D1/D2 fixtures are the
  // corpus's own colliding shapes — a nested lesson number and a short flag inside a long one.
  // Under the pre-fix bare-substring matcher BOTH pass green (the row "contains" the anchor);
  // bounded matching REDs them and keeps the legitimate backticked disposition green.
  cases.push(
    ["COLLISION D1: deleted L12, mapping row mentions only L123 → RED (not adjudicated)",
      "keep `kept-token` here, L123.\n",
      { readArchive, reword: true, mappingRows: parseMappingRows("- DROP `other-thing` — folded into L123 body\n") },
      1, "keep `kept-token` here, L12 and L123.\n", true],
    ["COLLISION D2: deleted `-o`, mapping row says only `--only` → RED (not adjudicated)",
      "use `--only` here.\n",
      { readArchive, reword: true, mappingRows: parseMappingRows("- KEEP `--only` semantics unchanged\n") },
      1, "use `-o` and `--only` here.\n", true],
    ["COLLISION control: deleted `-o` WITH its own bounded row → 0 (backticks are word boundaries)",
      "use it here.\n",
      { readArchive, reword: true, mappingRows: parseMappingRows("- DROP `-o` — verb retired\n") },
      0, "use `-o` here.\n", true],
  );

  let fail = 0;
  // Every arm prints exactly one `  [PASS]`/`  [FAIL]` line, so counting those lines counts the
  // arms — derived from the run rather than from a formula somebody has to remember to bump.
  let armsRun = 0;
  const rawLog = console.log;
  console.log = (...a) => { if (typeof a[0] === "string" && /^ {2}\[(PASS|FAIL)\]/.test(a[0])) armsRun++; rawLog(...a); };
  console.log("=== band-directive-preservation --self-test ===");
  for (const [name, after, opts, wantCount, beforeOverride, exact] of cases) {
    const before = beforeOverride ?? (name.startsWith("duplicate") ? base + "`incident-token` again\n" : base);
    const r = compare(before, after, opts);
    const got = r.code.length + r.bold.length + r.lessons.length + r.trigger.length + (r.trigUnadjudicated ? r.trigUnadjudicated.length : 0);
    const ok = exact ? got === wantCount : wantCount === 0 ? got === 0 : got >= wantCount;
    if (!ok) fail++;
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}  (lost ${got})`);
  }
  // ── FIELD PINS (hardcoding `adjudicated: []` or `boldDelta: 0` left
  // the whole table GREEN — the two channels a mapping REVIEWER reads were unpinned). Exact
  // CONTENT assertions, not counts, so a hardcode or an over-broad matcher REDs here.
  {
    const r = compare(delBase, delAfter, { readArchive, reword: true, mappingRows: dropMapping });
    const okAdj = r.adjudicated.length === 1 && r.adjudicated[0] === "gone-token";
    if (!okAdj) fail++;
    console.log(`  [${okAdj ? "PASS" : "FAIL"}] PIN: adjudicated list is exactly ["gone-token"]  (got ${JSON.stringify(r.adjudicated)})`);
    const r2 = compare("**directive lead** the `kept-token` line.\n", "the `kept-token` line.\n",
      { readArchive, reword: true, mappingRows: [] });
    const okBold = r2.boldDelta === -1;
    if (!okBold) fail++;
    console.log(`  [${okBold ? "PASS" : "FAIL"}] PIN: boldDelta === -1 on a one-bold deletion  (got ${r2.boldDelta})`);
    // The count-blind case, and the reason the plain-deletion pin above is not enough: a lead
    // destroyed while another is added leaves boldDelta at 0, so the pin above stays GREEN and
    // the run printed "every anchor preserved". BOTH assertions are load-bearing — boldDelta
    // must read 0 (the count really is blind) AND boldVanished must read 1 (the set check is not).
    const r3 = compare("**directive lead** the `kept-token` line.\n",
                       "**UNRELATED FILLER** the `kept-token` line.\n",
                       { readArchive, reword: true, mappingRows: [] });
    const okBlind = r3.boldDelta === 0 && r3.boldVanished.length === 1 && r3.boldVanished[0] === "directive lead";
    if (!okBlind) fail++;
    console.log(`  [${okBlind ? "PASS" : "FAIL"}] PIN: delete+add leaves boldDelta 0 AND boldVanished ["directive lead"]  (got delta=${r3.boldDelta}, vanished=${JSON.stringify(r3.boldVanished)})`);
  }

  // ── classifyLosses: the WORKTREE-vs-COMMITTED split (2026-09-07) ──────────────────────────
  // The after-side is the worktree by default, so a lost anchor has two causes needing OPPOSITE
  // actions; this gate reported them identically. These arms exercise the REAL function through
  // its injection points — a mirror would not have caught the ref-mode early return.
  {
    const baseText = "- **STILL AT HEAD** with `kept-code` and L901.\n- **GONE FROM HEAD** with `gone-code` and L902.\n";
    const headText = "- **STILL AT HEAD** with `kept-code` and L901.\n";   // KEEP=present, GONE=absent
    const readHead = () => headText;
    // The stub answers all THREE call shapes the classifier makes, because the sha resolver now
    // VERIFIES a pickaxe hit by re-extracting either side of it: `log` (the chase list), `log -S`
    // (candidates) and `show <ref>:<file>` (the two bodies it compares). A stub answering only the
    // first two leaves every candidate UNVERIFIABLE, so the arm goes RED for a reason unrelated to
    // the property under test — which is how this fixture behaved the moment the verification change landed.
    const bodies = { "cafe123^": baseText, cafe123: headText, "dead456^": baseText, dead456: baseText };
    const runGit = (args) => {
      if (args[0] === "show") return bodies[String(args[1]).split(":")[0]] ?? "";
      return args.some((a) => a.startsWith("-S")) ? "cafe123\n" : "cafe123\ndead456\n";
    };
    const lostSet = { code: ["kept-code", "gone-code"], bold: ["STILL AT HEAD", "GONE FROM HEAD"], lessons: ["L901", "L902"] };

    const cw = classifyLosses("f.md", lostSet, { base: "B", headRef: null, beforeText: baseText, readHead, runGit });
    const okSplit = cw.available
      && cw.worktreeOnly.has("STILL AT HEAD") && cw.worktreeOnly.has("kept-code") && cw.worktreeOnly.has("L901")
      && cw.committed.has("GONE FROM HEAD") && cw.committed.has("gone-code") && cw.committed.has("L902")
      && cw.worktreeOnly.size === 3 && cw.committed.size === 3;
    if (!okSplit) fail++;
    console.log(`  [${okSplit ? "PASS" : "FAIL"}] classifyLosses: anchors PRESENT at HEAD are WORKTREE-ONLY, absent ones COMMITTED  (got wt=${cw.worktreeOnly.size}, committed=${cw.committed.size})`);

    // A sha is what makes a COMMITTED loss chaseable; without it the label is half the fix.
    const okSha = cw.shas.get("GONE FROM HEAD") === "cafe123" && !cw.shas.has("STILL AT HEAD") && cw.chase.length === 2;
    if (!okSha) fail++;
    console.log(`  [${okSha ? "PASS" : "FAIL"}] classifyLosses: COMMITTED anchor carries its sha, WORKTREE-ONLY carries none  (got sha=${cw.shas.get("GONE FROM HEAD")}, chase=${cw.chase.length})`);

    // ⛔ THE PUSH GATE CALLS THIS WITH --head, i.e. ref-vs-ref, where the question does not arise.
    // Verified byte-identical output against the pre-fix script on a real fixture; this pins the
    // early return so a later edit cannot start doing git work on the path that blocks pushes.
    // ⛔ ASSERT ON THE CALLS, NOT THE RETURN. An empty result is what a BROKEN classifier returns
    // too, so reading `available === false` cannot tell "returned early" from "ran and found
    // nothing" — and the property the push path needs is that NO git work happens at all. The spy
    // makes the arm fail if a later edit starts reading refs on the branch that blocks pushes.
    let refCalls = 0;
    const cr = classifyLosses("f.md", lostSet, { base: "B", headRef: "HEAD", beforeText: baseText,
      readHead: (f) => { refCalls++; return readHead(f); }, runGit: (a) => { refCalls++; return runGit(a); } });
    const okRef = cr.available === false && refCalls === 0;
    if (!okRef) fail++;
    console.log(`  [${okRef ? "PASS" : "FAIL"}] classifyLosses: ref-vs-ref mode (--head) does ZERO git work — the push path is untouched  (got available=${cr.available}, gitCalls=${refCalls})`);

    // ⛔ THE MULTISET ARM. `lost()` is a multiset diff, so ONE anchor text can be lost twice with
    // DIFFERENT causes. A set-membership classifier reads "still at HEAD" and calls BOTH losses
    // worktree-only — labelling a committed removal "no commit of yours clears it", which is the
    // direction that tells you to ignore a real change. Repeats are the common case, not the
    // corner: 32.4% of code-anchor occurrences are of a value that repeats inside its own band
    // file, max 18x (`/wrap` in conventions.md), re-derived 2026-09-07 08:5xZ. ⚠️ An earlier report
    // read "311 repeat, one 32 times" — both numbers wrong, the CLAIM unchanged.
    const dupBase = "`dup` a. `dup` b. `dup` c.\n";   // 3x at base
    const dupHead = "`dup` a. `dup` b.\n";            // 2x at HEAD  → 1 instance removed BY A COMMIT
    const cd = classifyLosses("f.md", { code: ["dup", "dup"], bold: [], lessons: [] },
      { base: "B", headRef: null, beforeText: dupBase, readHead: () => dupHead, runGit });
    const okDup = JSON.stringify(cd.label.code) === JSON.stringify(["committed", "worktree"]);
    if (!okDup) fail++;
    console.log(`  [${okDup ? "PASS" : "FAIL"}] classifyLosses: a DUPLICATED anchor lost twice splits by COUNT, not set membership  (got ${JSON.stringify(cd.label.code)})`);

    // ⛔ THE ARCHIVE-CREDIT ARM — the reason the budget is computed
    // by CALLING compare() instead of re-deriving it from anchors(). Every OTHER fixture in this
    // file is archive-free, so a raw-anchors budget passes all of them and this is the only arm
    // that can go red on it. The scenario, end to end: a commit legitimately MOVES an anchor from
    // the hot file to the archive (pointer retained, so compare() credits it and reports NO loss
    // at HEAD); a peer then deletes it from the ARCHIVE without committing. The hot file is
    // byte-identical to HEAD, so the loss is uncommitted and NO sha exists — but a raw-anchors
    // budget only sees that the token is absent from the hot HEAD text and prints
    // `<- COMMITTED <sha>`, naming the commit that PRESERVED it.
    const acPointer = ".claude/docs/rules-ARCHIVE/demo-cases.md";
    const acBase = "Rule: the `moved-token` gate fires.\n";
    const acHead = "Rule: the gate fires.\n> Full incident record: `" + acPointer + "`.\n";
    const acOpts = { readArchive: (p) => (p === acPointer ? "the `moved-token` gate fires.\n" : null) };
    const ac = classifyLosses("f.md", { code: ["moved-token"], bold: [], lessons: [] },
      { base: "B", headRef: null, beforeText: acBase, compareOpts: acOpts, readHead: () => acHead, runGit });
    const okArch = ac.label.code[0] === "worktree" && !ac.shas.has("moved-token") && ac.counts.committed === 0;
    if (!okArch) fail++;
    console.log(`  [${okArch ? "PASS" : "FAIL"}] classifyLosses: an ARCHIVE-CREDITED anchor deleted in the worktree is WORKTREE-ONLY, not COMMITTED  (got label=${ac.label.code[0]}, sha=${ac.shas.get("moved-token")})`);

    // The header counts are OCCURRENCES, not Set sizes: one anchor lost twice must read 2, or the
    // "⚠ N of these M live ONLY in the worktree" line contradicts the itemisation printed under it.
    const rep = classifyLosses("f.md", { code: ["dup", "dup"], bold: [], lessons: [] },
      { base: "B", headRef: null, beforeText: dupBase, readHead: () => dupBase, runGit });
    const okCnt = rep.counts.worktree === 2 && rep.worktreeOnly.size === 1 && rep.counts.committed === 0;
    if (!okCnt) fail++;
    console.log(`  [${okCnt ? "PASS" : "FAIL"}] classifyLosses: header counts are OCCURRENCES, not Set size  (got counts.worktree=${rep.counts.worktree}, set=${rep.worktreeOnly.size})`);

    // ⛔ THE SUFFIX ITSELF. A lost anchor with NO label must print NOTHING — the fallthrough is
    // what stops an unlabelled anchor inheriting the COMMITTED branch and naming a sha the reader
    // will go and open. It was a closure until now, so no arm could reach it and a mutant that
    // deleted it scored a full-green run.
    const lbl = { available: true, label: { code: ["committed", "worktree"] }, shas: new Map([["a", "beef123"]]), why: new Map() };
    const okTag = lossTag(lbl, "code", 0, "a").includes("COMMITTED beef123")
      && lossTag(lbl, "code", 1, "b").includes("WORKTREE-ONLY")
      && lossTag(lbl, "code", 2, "c") === ""            // index past the labels — the fallthrough
      && lossTag(lbl, "bold", 0, "d") === ""            // class with no labels at all
      && lossTag({ available: false }, "code", 0, "a") === "";
    if (!okTag) fail++;
    console.log(`  [${okTag ? "PASS" : "FAIL"}] lossTag: an UNLABELLED anchor prints nothing — it never falls through to COMMITTED  (got ${JSON.stringify(lossTag(lbl, "code", 2, "c"))})`);

    // The unresolved-sha message names its OWN cause: one string for four routes was true of one.
    const wy = { available: true, label: { code: ["committed", "committed", "committed", "committed"] }, shas: new Map(),
      why: new Map([["e", "empty"], ["n", "no-count-change"], ["m", "ambiguous:aaa1,bbb2"], ["u", "unverified:ccc3"]]) };
    const okWhy = lossTag(wy, "code", 0, "e").includes("normalises to empty")
      && lossTag(wy, "code", 1, "n").includes("no commit in range changed")
      && lossTag(wy, "code", 2, "m").includes("2 commits verified as removing it: aaa1,bbb2")
      && lossTag(wy, "code", 3, "u").includes("NOT verified as removing: ccc3");
    if (!okWhy) fail++;
    console.log(`  [${okWhy ? "PASS" : "FAIL"}] lossTag: each UNRESOLVED cause prints its own message, not one blanket normalisation claim`);
  }

  // ⛔ isArchivePath IS NOT REACHED BY ANY CASE ARM — assert it DIRECTLY (2026-09-21).
  // The MOVE/RED traps arms above exercise ARCHIVE_REF_RE plus an INJECTED readArchive, so they go
  // green with isArchivePath gutted (measured: mutating the predicate left 53/53 PASS). That
  // predicate guards readArchiveFromDisk — the path production actually uses — so without this it
  // ships unguarded, which is how the .claude/orchestrator/ destination shipped in 2026-09-03.
  {
    const okPred =
      isArchivePath(".claude/traps/shell-traps.md") === true &&
      isArchivePath(".claude/docs/rules-ARCHIVE/x-cases.md") === true &&
      isArchivePath(".claude/orchestrator/conventions.md") === true &&
      // the NEGATIVE half: a band file is NOT a credited destination, or the gate would credit
      // a "move" that never left the always-loaded plane.
      isArchivePath(".claude/rules/bash-environment.md") === false &&
      isArchivePath("CLAUDE.md") === false;
    if (!okPred) fail++;
    armsRun++;
    console.log(`  [${okPred ? "PASS" : "FAIL"}] isArchivePath credits traps/archive/orchestrator and REFUSES a band file`);
  }

  // ⛔ COUNT THE ARMS THAT PRINTED, NEVER A FORMULA. `cases.length + <constant>` is maintained by
  // hand and drifts the moment an arm is added: it read 45 against 46 running arms within one
  // commit of the last two being added. The tally below is the artifact's own output, so it
  // cannot disagree with what ran.
  console.log = rawLog;
  console.log(fail === 0 ? `\nself-test: ${armsRun}/${armsRun} PASS` : `\nself-test: ${fail} FAILED of ${armsRun}`);
  return fail === 0 ? 0 : 1;
}

const argv = process.argv.slice(2);
if (argv.includes("--self-test")) process.exit(selfTest());

const flag = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const BASE = flag("--base", "HEAD");
const HEAD_REF = flag("--head", null);            // null → read the worktree
const PIN_MODE = argv.includes("--pin-trigger-relocations");   // write the pin from this run's credited cells; needs --ruled
const RULED = flag("--ruled", null);
const PIN_FILE = join(ROOT, ".claude", "band-trigger-relocation-pins.json");
function loadTriggerPins() {
  try { return JSON.parse(readFileSync(PIN_FILE, "utf8")); } catch { return { adjudicated: [] }; }
}
const TRIGGER_PINS = loadTriggerPins();
const PINNED_TRIGGER_HASHES = new Set((TRIGGER_PINS.adjudicated || []).map((e) => e.sha1));
if (PIN_MODE && !RULED) { console.error("--pin-trigger-relocations needs --ruled \"<who ruled, when, where recorded>\" — an adjudication names its adjudicator."); process.exit(2); }
// CHASEABILITY, not format: a bare sha would be a WEAKER record than
// the first pin written; a bare "approved" is decorative. Accept any --ruled that carries at least one anchor a reader can
// chase — a 7+ hex commit sha or a path (contains "/") — and refuse the rest.
if (PIN_MODE && RULED && !/[0-9a-f]{7,40}/.test(RULED) && !RULED.includes("/")) {
  console.error(`--ruled must carry an anchor a reader can chase — a commit sha (7+ hex) or a file path — got: "${RULED}". One verifiable anchor beats fifteen citations.`);
  process.exit(2);
}
const ARCHIVE_AWARE = !argv.includes("--strict-per-file");

// An unresolvable --base made atRef() return null for EVERY
// file → "✅ 0 band files checked … no cite lost", exit 0 — a vacuous green — while the same typo
// in --head fails CLOSED. Resolve-or-die on both refs up front (the validate-the-flag pattern
// --reword-mode already applies).
const dieUnlessRef = (label, ref) => {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
      { cwd: ROOT, stdio: ["ignore", "ignore", "ignore"] });
  } catch {
    console.error(`${label} '${ref}' does not resolve to a commit — refusing to certify against nothing (exit 2).`);
    process.exit(2);
  }
};
dieUnlessRef("--base", BASE);
if (HEAD_REF) dieUnlessRef("--head", HEAD_REF);
// THE RUN RECORD NAMES COMMITS, NOT SPELLINGS (2026-09-13): pre-push passes
// `--head HEAD` and a `--base` that is either the remote sha or the literal `origin/main` fallback, so a record
// carrying the spelling could not be re-diffed from itself once a ref moved. Resolved once, after both refs are
// validated, and read ONLY by the logFire call at the end — the reads below still resolve each spelling per file,
// so these shas do not pin a ref that moves mid-run. null for the worktree side (no commit) or a ref that stops
// resolving after validation; an unresolvable ref never reaches here (dieUnlessRef exits 2). Telemetry only.
const commitShaOrNull = (ref) => {
  if (!ref) return null;
  try {
    const sha = execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(sha) ? sha : null;
  } catch { return null; }
};
const BASE_SHA = commitShaOrNull(BASE);
const HEAD_SHA = commitShaOrNull(HEAD_REF);
const readArchive = HEAD_REF ? readArchiveAtRef(HEAD_REF) : readArchiveFromDisk;
// Delta credit: the BASE side of the archive delta. BASE is always a ref, so this is always available —
// an archive file absent at BASE simply returns null there, which is the full-credit first-move case.
const readArchiveBaseCli = readArchiveAtRef(BASE);
const REWORD = argv.includes("--reword-mode");
let mappingRows = [];
if (REWORD) {
  const mapPath = flag("--reword-mode", null);
  if (!mapPath || mapPath.startsWith("--")) {
    console.error("--reword-mode requires a mapping file argument (the committed obligation mapping).");
    process.exit(2);
  }
  // An ABSOLUTE --reword-mode path was joined onto ROOT and became nonsense, and the error then
  // printed the INPUT rather than the path actually checked — so it said "not found" about a file
  // sitting right there. Cost a reviewer three arms of misdiagnosis.
  const abs = isAbsolute(mapPath) ? mapPath : join(ROOT, mapPath);
  if (!existsSync(abs)) {
    console.error(`--reword-mode: mapping file not found: ${abs}`);
    process.exit(2);
  }
  mappingRows = parseMappingRows(readFileSync(abs, "utf8"));
}

let totalLost = 0;
const toPin = [];
let checked = 0;
let compared = 0;   // files whose content ACTUALLY differed — see the zero-comparison guard
// REWORD-mode bold deletions. Exit-NEUTRAL by design (:130 — comparing bold spans on a reword
// measured always-RED, 70/34), but the SUCCESS SENTENCE must not claim what the gate did not
// check. See the boldDelta arm below the compared===0 guard.
let totalBoldDeleted = 0;
let totalBoldVanished = 0;
const fired = [];
for (const file of bandFiles()) {
  const before = atRef(BASE, file);
  if (before === null) continue;
  let after;
  if (HEAD_REF) {
    after = atRef(HEAD_REF, file);
  } else {
    const path = join(ROOT, file);
    after = existsSync(path) ? readFileSync(path, "utf8") : null;
  }
  if (after === null) {
    console.log(`✗ ${file} — DELETED (the whole file is an anchor set)`);
    totalLost += 1;
    fired.push({ file, lost: 1, reason: "file deleted" });
    continue;
  }
  checked++;
  if (before === after) continue;
  compared++;
  // Hoisted so classifyLosses budgets against the IDENTICAL configuration rather than a
  // re-derivation — see its doc block for what re-deriving cost.
  const compareOpts = {
    archiveAware: ARCHIVE_AWARE, readArchive, readArchiveBase: readArchiveBaseCli,
    reword: REWORD, mappingRows, freezeTriggers: TRIGGER_INDEX_FILES.has(file),
    pinnedTriggerHashes: PINNED_TRIGGER_HASHES,
  };
  const r = compare(before, after, compareOpts);
  const n = r.code.length + r.bold.length + r.lessons.length + r.trigger.length + r.trigUnadjudicated.length;
  for (const c of r.trigUnadjudicated) toPin.push({ sha1: triggerHash(c), preview: c.slice(0, 96), file });
  const delta = Buffer.byteLength(after) - Buffer.byteLength(before);
  const via = r.credited.length ? ` (credited to ${r.credited.join(", ")})` : "";
  const rw = REWORD
    ? ` [reword: ${r.adjudicated.length} adjudicated, bold Δ${r.boldDelta >= 0 ? "+" : ""}${r.boldDelta}]`
    : "";
  const clipTop = (s) => (s.length > 120 ? s.slice(0, 117) + "…" : s);
  // Rename-launder + adjudication visibility: both channels a mapping reviewer
  // reads must be ITEMIZED, not summarized — an over-broad adjudication or a full-credit rename
  // is invisible in a count.
  for (const fc of r.fullCredit)
    console.log(`  ⚠ ${file}: ${fc.pointer} absent at base — ${fc.n} anchors credited in FULL; verify this is a first move, not a rename/copy of an older archive`);
  // The split-range signature (measured 2026-08-13, 389 false-lost): archive existed at base,
  // added nothing in this range, and the hot file still reads lost. On the live pre-push range
  // that IS a stale-credit denial working as designed; on a narrow forensic range it usually
  // means the archive-add and the hot trim sit in DIFFERENT commits and the range splits them.
  if (r.deltaCredited) for (const dc of r.deltaCredited.filter((d) => d.added === 0))
    console.log(`  ⚠ ${file}: ${dc.pointer} existed at base with ZERO anchor delta in this range — if this range SPLITS an archive-then-trim pair, re-run with --base before the archive-add commit; the delta credit is defined over the invocation range`);
  if (REWORD) for (const ad of r.adjudicated.slice(0, 20))
    console.log(`  adj ${file}: ${clipTop(ad)}  (deletion adjudicated by a mapping row)`);
  if (r.trigAdded > 0)
    console.log(`  ⚠ ${file}: ${r.trigAdded} trigger cell(s) ADDED (exit-neutral here — a trigger-set change is its own behavioral commit)`);
  if (r.trigCredited && r.trigCredited.length > 0)
    console.log(`  ✓ ${file}: ${r.trigCredited.length} trigger cell(s) RELOCATED to an orchestrator file the stub points to and PINNED as adjudicated — credited; they left every sub-agent's firing surface on purpose`);
  if (r.trigUnadjudicated && r.trigUnadjudicated.length > 0) {
    console.log(`  ❌ ${file}: ${r.trigUnadjudicated.length} trigger cell(s) RELOCATED to an orchestrator file but NOT ADJUDICATED — a trigger left the universal firing surface and nobody ruled on it. Say so out loud (owner), then: node scripts/band-directive-preservation.mjs --base ${BASE} ${HEAD_REF ? "--head " + HEAD_REF + " " : ""}--pin-trigger-relocations --ruled "<who, when, where recorded>"`);
    for (const c of r.trigUnadjudicated.slice(0, 20)) console.log(`      trig  | ${clipTop(c)} |  ← RELOCATED, UNADJUDICATED (counts as lost until pinned)`);
  }
  // ⛔ THIRD INSTANCE OF THIS FILE'S OWN FALSE-GREEN CLASS (2026-08-27, measured in a detached
  // worktree): deleting a WHOLE bold directive from AGENTS.md — lead and body — returned rc=0,
  // "every anchor preserved", AND the summary's "no directive, symbol, or L# cite lost", with the
  // only trace a `bold Δ-1` inside the bracket that reads as reviewer colour. The two guards below
  // (checked===0, compared===0) exist because this same shape shipped a false green twice; this is
  // the same shape one level further in, where the gate DID compare and simply does not gate the
  // class. The signal was already computed and correct — per this file's own rule four lines up,
  // "both channels a mapping reviewer reads must be ITEMIZED, not summarized", and per
  // session-cadence.md (a signal filed as noise is a PLACEMENT problem, not a vigilance one).
  // Stays EXIT-NEUTRAL on purpose: flipping it to a refusal re-introduces the measured 70/34
  // always-RED that the counted-not-compared design decision exists to avoid.
  // The count-blind half. Fires ONLY when boldDelta >= 0, i.e. exactly where the warning above
  // CANNOT: a lead destroyed and another added in the same edit. Measured over six real
  // consolidations it changes ZERO verdicts — the one loud file, i18n.md at 120 vanished, was already warning on
  // boldDelta=-75, and the ✅ was already suppressed there. The only verdict that moves is the
  // delete-plus-add fixture, which printed "every anchor preserved" over a destroyed directive.
  if (REWORD && r.boldDelta >= 0 && r.boldVanished.length > 0) {
    totalBoldVanished += r.boldVanished.length;
    console.log(`  ⚠ ${file}: ${r.boldVanished.length} bold directive lead(s) VANISHED while the net count read ${r.boldDelta >= 0 ? "+" : ""}${r.boldDelta} — a delete PAIRED WITH AN ADD, invisible to the count gate. Itemized (the mapping's outside read is still the only check):`);
    for (const s of r.boldVanished.slice(0, 12)) {
      console.log(`      · ${s.length > 140 ? s.slice(0, 137) + "…" : s}`);
    }
    if (r.boldVanished.length > 12) console.log(`      · … and ${r.boldVanished.length - 12} more`);
  }
  if (REWORD && r.boldDelta < 0) {
    totalBoldDeleted += -r.boldDelta;
    console.log(`  ⚠ ${file}: ${-r.boldDelta} bold directive lead(s) NET-DELETED — NOT GATED in reword mode (counted, never compared). This gate CANNOT refuse on a deleted directive here; the mapping's outside read is the only check. Confirm each against the mapping before trusting the green.`);
  }
  if (n === 0) {
    console.log(`✓ ${file}  ${delta >= 0 ? "+" : ""}${delta} B — every anchor preserved${via}${rw}`);
  } else {
    totalLost += n;
    console.log(`✗ ${file}  ${delta} B — ${n} ANCHOR(S) LOST${via}${rw}:`);
    if (ARCHIVE_AWARE && r.pointers.length === 0 && delta < 0) {
      console.log(`      ⚠ no archive pointer in this file (rules-ARCHIVE/ or legacy rules-cases/) — a displaced anchor has nowhere to resolve.`);
    }
    // A "bold span" in this corpus is routinely a whole paragraph; print an identifiable
    // prefix, not the body. The JSONL fire keeps the counts; the diff has the text.
    const clip = (s) => (s.length > 120 ? s.slice(0, 117) + "…" : s);
    // Per-anchor COMMITTED vs WORKTREE-ONLY. The two need opposite actions and this gate printed
    // them identically until 2026-09-07 — see classifyLosses() for the measured cost of that.
    const cz = classifyLosses(file, r, { base: BASE, headRef: HEAD_REF, beforeText: before, compareOpts });
    const tag = (cls, i, a) => lossTag(cz, cls, i, a);
    if (cz.available && cz.counts.worktree > 0)
      console.log(`      \u26a0 ${cz.counts.worktree} of these ${n} live ONLY in the worktree — present at HEAD, absent on disk. Somebody holds UNCOMMITTED edits to this file: committing your own work cannot clear them, and this gate re-fires until that edit is committed or reverted. \`git status --porcelain -- ${file}\` names the state; \`session-manifest.py whose-edit ${file}\` is a FLOOR on who.`);
    if (cz.available && cz.counts.committed > 0 && cz.chase.length > 0)
      console.log(`      \u26a0 ${cz.counts.committed} are COMMITTED — real changes in ${BASE}..HEAD. Commits touching this file in range: ${cz.chase.slice(0, 8).join(" ")}${cz.chase.length > 8 ? ` (${cz.chase.length} total)` : ""}`);
    if (!cz.available && HEAD_REF === null)
      console.log(`      \u26a0 could not classify these losses (file absent at HEAD) — COMMITTED vs WORKTREE-ONLY is UNKNOWN here, which is not the same as clean.`);
    for (const [i, c] of r.code.slice(0, 20).entries()) console.log(`      code  \`${clip(c)}\`${tag("code", i, c)}`);
    for (const [i, b2] of r.bold.slice(0, 20).entries()) console.log(`      bold  **${clip(b2)}**${tag("bold", i, b2)}`);
    for (const [i, l] of r.lessons.slice(0, 20).entries()) console.log(`      cite  ${l}${tag("lessons", i, l)}`);
    for (const [i, tc] of r.trigger.slice(0, 20).entries())
      console.log(`      trig  | ${clip(tc)} |  ← TRIGGER CELL (frozen: not archivable, not dispositionable — a trigger change is its own behavioral commit)${tag("trigger", i, tc)}`);
    if (n > 60) console.log(`      … (${n} total; list truncated at 20 per class)`);
    fired.push({ file, lost: n, code: r.code.length, bold: r.bold.length, cite: r.lessons.length, trig: r.trigger.length, pointers: r.pointers,
      worktreeOnly: cz.available ? cz.counts.worktree : null, committed: cz.available ? cz.counts.committed : null });
  }
}

// The second half of the resolve-or-die guard above: a run that MEASURED NOTHING must not report a green. Reachable even
// with a resolvable base (e.g. a ref predating every band file) — certifying against a tree with
// no band files certifies nothing.
if (checked === 0) {
  console.error(`0 band files checked vs ${BASE} — nothing was measured; refusing to report a green (exit 2).`);
  process.exit(2);
}

// ⛔ THE SAME VACUITY ONE LEVEL IN, AND IT SHIPPED A FALSE GREEN (2026-08-16). The guard above
// counts files REACHED; `checked++` at :625 runs BEFORE the `before === after` skip, so on a
// fully-committed tree every band file increments the counter and then skips its comparison, and
// the success line reports ATTEMPTS as though they were COMPARISONS. Measured: a 22-file
// "✅ no directive, symbol, or L# cite lost" over ZERO comparisons, recorded as
// the evidence for "zero rules lost". Re-run with --base at the
// pre-arc commit it reported 506. The default `--base HEAD` is what makes this the NORMAL case:
// anyone verifying AFTER committing gets it.
if (compared === 0) {
  console.error(
    `${checked} band file(s) reached but 0 COMPARED vs ${BASE} — every file is identical at that ref, ` +
    `so nothing was measured; refusing to report a green (exit 2).\n` +
    `   You are almost certainly verifying a change that is already COMMITTED, against the default ` +
    `--base HEAD. Pass --base <pre-change-sha> to compare the actual change.`,
  );
  process.exit(2);
}

if (PIN_MODE) {
  const have = new Set((TRIGGER_PINS.adjudicated || []).map((e) => e.sha1));
  const added = toPin.filter((e) => !have.has(e.sha1)).map((e) => ({ sha1: e.sha1, preview: e.preview, file: e.file, ruled: RULED, pinned: new Date().toISOString().slice(0, 10) }));
  const out = { _: "Trigger cells whose RELOCATION into .claude/orchestrator/*.md was adjudicated. band-directive-preservation.mjs credits a relocated trigger cell ONLY when its sha1 is here; an unpinned relocation counts as lost. Written only by --pin-trigger-relocations --ruled <text>; never by hand.", adjudicated: [...(TRIGGER_PINS.adjudicated || []), ...added] };
  mkdirSync(dirname(PIN_FILE), { recursive: true });
  writeFileSync(PIN_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(`\n📌 pinned ${added.length} relocated trigger cell(s) as adjudicated (${RULED}) → ${PIN_FILE.replace(ROOT + "/", "")}; ${out.adjudicated.length} total. Re-run to see them credited.`);
}
const mode = (REWORD ? "reword+" : "") + (ARCHIVE_AWARE ? "archive-aware" : "strict-per-file");
// Compose the bold clause rather than interpolating both counters unconditionally: a summary
// reading "0 BOLD DIRECTIVE LEAD(S) WERE NET-DELETED and 1 VANISHED" invites a reviewer to file
// the whole line as noise, and a signal read as noise has already failed (session-cadence.md).
const boldClause = [
  totalBoldDeleted > 0 ? `${totalBoldDeleted} BOLD DIRECTIVE LEAD(S) WERE NET-DELETED` : null,
  totalBoldVanished > 0 ? `${totalBoldVanished} BOLD DIRECTIVE LEAD(S) VANISHED under an unchanged net count (a delete PAIRED WITH AN ADD, which a count cannot see)` : null,
].filter(Boolean).join(", and ");
console.log(
  totalLost === 0
    ? (totalBoldDeleted > 0 || totalBoldVanished > 0
        ? `\n⚠️ ${compared} of ${checked} band files COMPARED vs ${BASE} (${mode}) — no CODE anchor, TRIGGER cell or L# cite lost, but ${boldClause}, and this mode does not gate them. NOT a clean conservation result: read the ⚠ lines above against the mapping. A deleted directive is invisible to this gate in reword mode by design.`
        : `\n✅ ${compared} of ${checked} band files COMPARED vs ${BASE} (${mode}) — no directive, symbol, or L# cite lost. [ARCHIVE-faithfulness only — a rewritten live line's hedges/qualifiers are NOT checked; pair with the hand-read.]`)
    : `\n❌ ${totalLost} anchor(s) lost vs ${BASE} (${mode}). This instrument measures VERBATIM identity: a lost anchor is a DELETED rule OR a REWORDED one — it cannot tell them apart, and it fails closed as deletion.\n   If this was a MOVE: write the archive under .claude/docs/rules-ARCHIVE/ and keep a pointer to it in the band file — or, for ORCHESTRATOR-ONLY doctrine, move it under .claude/orchestrator/ (measured by this instrument since 2026-09-03) and leave a stub, or, for a rule that fires only when a COMMAND runs, move it under .claude/traps/ (since 2026-09-21) and leave a pointer.\n   If this was a deliberate REWORD: adjudicate it via --reword-mode <mapping.md> — do not read this count as bytes destroyed.`,
);
// ⛔ ONE RECORD PER RUN THAT REACHES A VERDICT, THE CLEAN RUN INCLUDED (2026-09-13).
// This call sat inside `if (totalLost > 0)`, so a clean
// run left no trace and the log could support a promote-to-block argument but never refute one. The exit-2
// refusals above and `--self-test` still write nothing: they measured nothing, so they are not runs.
// ⛔ A RATE OVER THIS LOG IS A FILTER EXPRESSION, NEVER A FIELD (2026-09-13). Records written before
// `outcome` existed carry none and every one is a finding (no clean run was ever logged beside them), and hand runs
// log clean records too, so the push-path gate's rate reads exactly this population and no other:
//   rows.filter((r) => "outcome" in r && r.origin === "pre-push")   — findings: r.outcome === "finding"
// Never `totalLost > 0` file-wide, never a line count; and a finding is not a false positive until a human says so,
// since no field classifies it. `origin` (BAND_GATE_ORIGIN, default "manual") is the key; unlabeled rows poison it.
// `base` / `head` are full COMMIT SHAS (null when unresolvable; `head` is always null in worktree mode, which has no
// commit) and `baseRef` / `headRef` keep the spellings as passed. Older records carry the SPELLING in `base` / `head`
// and no `*Ref` key, so a re-diff checks `"headRef" in r` before reading either field as a sha.
logFire({ ts: new Date().toISOString(), origin: process.env.BAND_GATE_ORIGIN || "manual", outcome: totalLost > 0 ? "finding" : "clean", base: BASE_SHA, baseRef: BASE, head: HEAD_SHA, headRef: HEAD_REF ?? "worktree", mode, totalLost, files: fired });
process.exit(totalLost === 0 ? 0 : 1);
