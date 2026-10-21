#!/usr/bin/env node
/**
 * tag-l-refs.mjs
 *
 * Mass topic-tag push for L# references across `.claude/`.
 *
 * Closes the pre-condition gate for the L# reference drift detector
 * (architecture.md:1040 — "Detector promotion deferred until ≥50% of L-refs
 * are topic-tagged"). Builds a canonical N→topic-tag map from already-tagged
 * refs, then applies the canonical tag to every bare `L<N>` reference whose N
 * has a canonical mapping.
 *
 * Safety filters:
 *  - skip fenced code blocks (```...```)
 *  - skip inline code spans (`...`) — a gloss inside one changes what a worked example
 *    points at
 *  - skip YAML frontmatter (--- ... ---)
 *  - skip MEMORY lesson section headers (`## YYYY-MM-DD — L<N>:`, `## L<N> (...)`)
 *  - skip numbered lesson list items (`N. **L<N>:**`)
 *  - **bound N ≤ MAX_LESSON_N (300)** — `L<N>` patterns in code-citation contexts
 *    (e.g., `L<N>` where N is a file line number in commit/audit prose) would
 *    otherwise be tagged with whatever description happened to follow them in
 *    THAT context, then sprayed across unrelated sites in the corpus.
 *    Bound prevents the cross-context contamination.
 *
 * Usage:
 *   node scripts/tag-l-refs.mjs --dry-run   # report only, no writes
 *   node scripts/tag-l-refs.mjs --apply     # apply changes + show diff stats
 *   (bare, --help, or any unrecognised flag -> usage on stderr, exit 2, no writes.
 *    2026-09-05: a script-inventory sweep ran every scripts/*.mjs with --help and this
 *    one rewrote 241 files under .claude/ in one second; a mutating default is a hazard
 *    to any sweep that executes scripts in order to probe them.)
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const ROOT = ".claude";
const KNOWN_FLAGS = new Set(["--dry-run", "--apply", "--no-skip-dirty"]);
const ARGS = process.argv.slice(2);
const UNKNOWN = ARGS.filter((a) => !KNOWN_FLAGS.has(a));
const APPLY = ARGS.includes("--apply");
if (UNKNOWN.length || (!APPLY && !ARGS.includes("--dry-run"))) {
  console.error(
    `tag-l-refs.mjs: ${UNKNOWN.length ? `unrecognised argument(s): ${UNKNOWN.join(" ")}` : "no mode given"}\n` +
      "usage: node scripts/tag-l-refs.mjs --dry-run | --apply [--no-skip-dirty]\n" +
      "refusing without writing: a bare run, --help, or an unknown flag never mutates .claude/ (exit 2).",
  );
  process.exit(2);
}
const DRY = !APPLY;
const NO_SKIP_DIRTY = ARGS.includes("--no-skip-dirty");
const MAX_LESSON_N = 300; // upper bound on meta lesson L#s; above this = line-number citation

// Skip files currently dirty in git (parallel-session protection).
// Override with --no-skip-dirty if you want to edit dirty files anyway.
const dirtyFiles = new Set();
if (!NO_SKIP_DIRTY) {
  try {
    const out = execSync("git status --porcelain", { encoding: "utf8" });
    for (const line of out.split("\n")) {
      const path = line.slice(3).trim();
      if (path.endsWith(".md")) dirtyFiles.add(path);
    }
  } catch (e) {
    console.warn("git status failed — proceeding without dirty-skip:", e.message);
  }
}

function walkMd(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === ".git" || entry === "node_modules" || entry.startsWith(".")) {
      // allow .claude itself but skip subdirs starting with .
      if (dir !== "." || entry !== ROOT) continue;
    }
    const p = join(dir, entry);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walkMd(p, out);
    else if (entry.endsWith(".md")) out.push(p);
  }
  return out;
}

const allFiles = walkMd(ROOT);
const files = allFiles.filter((f) => !dirtyFiles.has(f));
const skippedDirty = allFiles.length - files.length;
console.log(`Scanning ${files.length} .md files in ${ROOT}/ (${skippedDirty} dirty files skipped for parallel-session protection)`);

// Pass 1: build N → canonical-tag map from existing tagged refs
const tagFreq = new Map(); // N → Map<tag, count>
for (const f of files) {
  const content = readFileSync(f, "utf8");
  for (const m of content.matchAll(/\bL(\d+) \(([^)]{2,80})\)/g)) {
    const n = m[1];
    if (parseInt(n, 10) > MAX_LESSON_N) continue; // skip line-number citations
    const tag = m[2].trim();
    if (!tagFreq.has(n)) tagFreq.set(n, new Map());
    const fmap = tagFreq.get(n);
    fmap.set(tag, (fmap.get(tag) || 0) + 1);
  }
}

// Sanity filters for canonical tag quality. Reject if any fires.
// Driver: 2026-05-23 first-run dry-run uncovered date-tags (L<N>
// "2026-04-15"), edit-summary tags ("35 → 14 lines"), recursive L#
// citations ("L<N> ...; L<M> (...)"), and over-long compound tags.
const MIN_COUNT = 2;       // require ≥2 occurrences (= at least 2 writers agreed)
const MAX_TAG_LEN = 50;    // longer = compound thought / parenthetical leak
function isTagSafe(tag) {
  // Date patterns (YYYY-MM-DD or YYYY-MM-) — timestamps, not topics.
  if (/^\d{4}-/.test(tag) || /\b\d{4}-\d{2}-\d{2}\b/.test(tag)) return false;
  // Numeric edit-summary arrow ("2052 → 1294", "35 → 14 lines", "400→600").
  if (/\d+\s*→\s*\d+/.test(tag)) return false;
  // Nested L# citation — tag describes another lesson, not this one.
  if (/\bL\d+\b/.test(tag)) return false;
  // Bold markup leak (`**...**`) indicates parenthetical text was captured.
  if (tag.includes("**")) return false;
  // Length cap. Em-dash + semicolon allowed for short tags (under cap).
  if (tag.length > MAX_TAG_LEN) return false;
  return true;
}

const canonical = new Map();
const rejected = []; // {n, reason, sampleTag, count}
for (const [n, fmap] of tagFreq) {
  const variants = [...fmap.entries()].sort((a, b) => b[1] - a[1]);
  // Find first variant that passes both min-count and sanity filters
  const winner = variants.find(([tag, count]) => count >= MIN_COUNT && isTagSafe(tag));
  if (winner) {
    canonical.set(n, winner[0]);
  } else {
    const top = variants[0];
    rejected.push({ n, sampleTag: top[0], count: top[1], variants: variants.length });
  }
}
console.log(`Built canonical map: ${canonical.size} L#s pass filters (rejected ${rejected.length} N's — see end of report).`);

// Pass 2: count BEFORE — bounded to lesson range (N ≤ MAX_LESSON_N)
function countRefs(content) {
  let total = 0, tagged = 0;
  for (const m of content.matchAll(/\bL(\d+)\b/g)) {
    if (parseInt(m[1], 10) <= MAX_LESSON_N) total++;
  }
  for (const m of content.matchAll(/\bL(\d+) \([^)]+\)/g)) {
    if (parseInt(m[1], 10) <= MAX_LESSON_N) tagged++;
  }
  return { total, tagged };
}
let totalBefore = 0, taggedBefore = 0;
for (const f of files) {
  const { total, tagged } = countRefs(readFileSync(f, "utf8"));
  totalBefore += total;
  taggedBefore += tagged;
}
const pctBefore = (100 * taggedBefore / totalBefore).toFixed(1);
console.log(`Before: ${taggedBefore} / ${totalBefore} (${pctBefore}%) tagged (lesson L1-L${MAX_LESSON_N} only)`);

// Pass 3: apply substitution with safety filters
let totalEdits = 0;
let filesEdited = 0;
const perFileEdits = new Map();

for (const f of files) {
  const lines = readFileSync(f, "utf8").split("\n");
  let inFence = false;
  let inFrontmatter = false;
  let edits = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // YAML frontmatter (only at top-of-file)
    if (i === 0 && line.trim() === "---") { inFrontmatter = true; continue; }
    if (inFrontmatter) {
      if (line.trim() === "---") inFrontmatter = false;
      continue;
    }

    // Code-fence toggle
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;

    // Skip MEMORY lesson headers: "## YYYY-MM-DD — L<N>:" / "## L<N> ("
    if (/^##\s+\d{4}-\d{2}-\d{2}.*—\s*L\d+/.test(line)) continue;
    if (/^##\s+L\d+(\s|\(|:|$)/.test(line)) continue;
    // Skip numbered lesson list items: "N. **L<N>:**"
    if (/^\s*\d+\.\s+\*\*L\d+/.test(line)) continue;

    // Apply: bare L<N> not already followed by " (" → L<N> (canonical-tag)
    // Only substitute when N has a canonical entry.
    //
    // Exclusion lookaheads:
    //  - `(?! \()` — already tagged
    //  - `(?!-)` — L#-range syntax (`L<N>-L<M>`); splitting breaks range
    //  - `(?!:)` — file-line citation (`file.ts:L<N>`); line numbers ≠ lessons
    //  - `(?!\/L)` — slash-joined list (`L<N>/L<M>`); want both tagged or neither
    // Never tag INSIDE an inline code span: a gloss there changes what a worked example
    // points at (`grep L<N>` in a false-hit example
    // became `grep L<N> (<gloss>)`). Fenced blocks are skipped above; this is the inline
    // half. Odd segments of the split are the spans and pass through untouched.
    // ⛔ EVERY EXCLUSION ABOVE IS A LOOKAHEAD, SO NOTHING LOOKED LEFT — and a SPEC LEVEL is
    // spelled exactly like a lesson ref. Measured 2026-09-07:
    // `CSS Text L3 §2.1` became `CSS Text L3 (unbounded poll) §2.1` in BOTH tests-unit.md and
    // i18n.md, so two rules files asserted that a W3C spec level is a defer-discipline lesson.
    // The gloss is real (that lesson IS "unbounded poll"), which is what makes the output plausible.
    // ⚠️ The `-9`-style annotator check CANNOT see this class: it strips glosses before
    // comparing, so it answers "was anything DELETED" and is blind to "was anything FALSE
    // ADDED". Three seats ran it on that commit and all three readings were correct and inert.
    // Guard on the PRECEDING text rather than a lookbehind — the callback already has the
    // offset, and it stays readable and testable where a variable-length lookbehind does not.
    // ⚠️ THE TWO DIRECTIONS ARE NOT SYMMETRIC, SO THIS LIST IS DELIBERATELY SHORT. A missed
    // block is cheap — the corpus is clean today and both instances were also fixed at the
    // SOURCE by spelling the spec out ("CSS Text Module Level 3"), which carries no L-token
    // at all and so is immune by construction. A false block is expensive: it SILENTLY drops
    // a real gloss, and nothing downstream would report the absence. So: unambiguous spec
    // acronyms only. `ES` and `Level` were in the first draft and are OUT — both are ordinary
    // English here, and a probe showed `ES` blocking a genuine ref.
    // ⚠️ KNOWN AND DELIBERATE BOUNDARY, so nobody "fixes" it in the expensive direction: the
    // connector class admits no `.`, so a spec noun carrying a DOTTED version (`WCAG 2.2`,
    // `TLS 1.3`, `HTTP/1.1`) breaks the run before the anchor and the guard does not fire.
    // A review probed this 8 ways and swept live doctrine for the shape — ZERO instances,
    // positive control confirming the probe finds the two real ones — and declined to file it.
    // Adding `.` would buy a measured-zero miss at the price of blocking a genuine ref that
    // merely FOLLOWS a spec mention ("WCAG 2.2 AA … per L<N> …"), which drops a real gloss with
    // nothing reporting the absence. Leave it: the miss is the cheap side, and it is measured.
    const SPEC_NOUN = /\b(?:CSS|HTML|SVG|HTTP|HTTPS|TLS|SSL|OAuth|WCAG|ARIA|Unicode|ECMAScript|IEEE|RFC|OpenGL|Vulkan|PCIe)\b[A-Za-z0-9 ]{0,24}$/;
    const tagSegment = (seg) => seg.replace(/\bL(\d+)\b(?! \()(?!-)(?!:)(?!\/L)/g, (match, n, offset) => {
      if (parseInt(n, 10) > MAX_LESSON_N) return match; // line-number citation, not a lesson ref
      // A spec noun to the LEFT means this is a spec LEVEL (`CSS Text L3`), not a lesson ref.
      if (SPEC_NOUN.test(seg.slice(Math.max(0, offset - 32), offset))) return match;
      if (canonical.has(n)) {
        edits++;
        return `L${n} (${canonical.get(n)})`;
      }
      return match;
    });
    const newLine = line.split(/(`[^`\n]+`)/).map((seg, k) => (k % 2 === 1 ? seg : tagSegment(seg))).join("");
    if (newLine !== line) lines[i] = newLine;
  }

  if (edits > 0) {
    if (!DRY) writeFileSync(f, lines.join("\n"));
    totalEdits += edits;
    filesEdited++;
    perFileEdits.set(f, edits);
  }
}

console.log(`${DRY ? "[DRY] Would apply" : "Applied"} ${totalEdits} tag additions across ${filesEdited} files.`);

// Pass 4: count AFTER — same bound as Pass 2
let totalAfter = 0, taggedAfter = 0;
for (const f of files) {
  const { total, tagged } = countRefs(readFileSync(f, "utf8"));
  totalAfter += total;
  taggedAfter += tagged;
}
const pctAfter = (100 * taggedAfter / totalAfter).toFixed(1);
console.log(`After:  ${taggedAfter} / ${totalAfter} (${pctAfter}%) tagged (lesson L1-L${MAX_LESSON_N} only)`);

// Report files with most edits
const topFiles = [...perFileEdits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
if (topFiles.length > 0) {
  console.log(`\nTop ${topFiles.length} files by edit count:`);
  for (const [f, n] of topFiles) console.log(`  ${n.toString().padStart(4)}  ${f}`);
}

// Report L#s with no canonical tag (owner-curation candidates).
// Bounded to lesson range to exclude line-number citations.
const allN = new Set();
for (const f of files) {
  const c = readFileSync(f, "utf8");
  for (const m of c.matchAll(/\bL(\d+)\b/g)) {
    const n = parseInt(m[1], 10);
    if (n <= MAX_LESSON_N) allN.add(n);
  }
}
const untagged = [...allN].filter(n => !canonical.has(String(n))).sort((a, b) => a - b);
console.log(`\nL#s with no canonical tag in L1-L${MAX_LESSON_N} (${untagged.length} need owner-curation):`);
console.log(`  ${untagged.join(", ")}`);

if (rejected.length > 0) {
  console.log(`\nRejected from canonical (sample tag shown — needs owner curation):`);
  rejected.sort((a, b) => parseInt(a.n) - parseInt(b.n));
  for (const r of rejected.slice(0, 20)) {
    console.log(`  L${r.n}: "${r.sampleTag}" (count=${r.count}, variants=${r.variants})`);
  }
  if (rejected.length > 20) console.log(`  ... +${rejected.length - 20} more`);
}

if (DRY) console.log(`\n[DRY-RUN] No files modified. Re-run with --apply to apply.`);
