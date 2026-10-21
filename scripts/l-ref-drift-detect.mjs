#!/usr/bin/env node
/**
 * l-ref-drift-detect.mjs
 *
 * Detects L# reference drift across `.claude/`: cited inline topic-tag
 * disagrees with the canonical lesson title in `meta/MEMORY.md`. Closes
 * the failure mode formerly catalogued at architecture.md Lecture 11.5 §7;
 * after the 2026-05-23 split, see `.claude/docs/state.md` Part 2 entry #7
 * ("L-number reference drift").
 *
 * v1 (2026-05-23): operates at 43.7% topic-tag coverage (per
 * scripts/tag-l-refs.mjs first-run output). Skips bare L# refs (no topic
 * to verify against canonical) — those need the topic-tag push extended.
 *
 * Canonical-source extraction from meta/MEMORY.md:
 *  - Numbered lesson list: `<idx>. **L<N>: <title>.** ...` OR
 *    `<idx>. **L<N> <suffix>** ...` (where <suffix> may include description)
 *  - Dated section header: `## YYYY-MM-DD — L<N>: <title>`
 *  - Bare header: `## L<N> (<tag>)` or `## L<N>: <title>`
 *
 * Match scoring: tokenize cited topic + canonical title (lowercase, strip
 * punctuation, drop tokens < 3 chars), compute intersection / min-set-size.
 * PASS if score ≥ 0.3 (at least one third of the smaller set overlaps).
 *
 * Usage:
 *   node scripts/l-ref-drift-detect.mjs           # default report (top 20 drifts)
 *   node scripts/l-ref-drift-detect.mjs --all     # list every drift
 *   node scripts/l-ref-drift-detect.mjs --threshold=0.5  # stricter match
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = ".claude";
const MEMORY = ".claude/skills/meta/MEMORY.md";
const RULES = ".claude/skills/meta/RULES.md";
const MAX_LESSON_N = 300;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const THRESHOLD = parseFloat(args.threshold ?? "0.3");
const SHOW_ALL = args.all === "true";

// Tokenize + normalize: lowercase, strip non-alphanumeric, drop short tokens
function tokens(s) {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9 -]/g, " ")
      .split(/[\s-]+/)
      .filter((t) => t.length >= 3),
  );
}

function jaccardLike(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size);
}

// === Build canonical N → title map from meta/MEMORY.md ===

// TIER UNION (2026-08-06, the meta archive split). MEASURED REGRESSION this fixes:
// after the split this printed `Canonical map: 89 lessons (0 from meta/MEMORY.md, 89 from
// meta/RULES.md)` — the router carries digests as LIST ROWS, deliberately, so it has zero
// `## L###` declaration headings and this file's primary source went silent. The detector kept
// running and kept reporting; it simply had nothing canonical to check against, which is the
// fail-OPEN direction. Union `MEMORY*.md` (same glob as check-lesson-numbers.mjs → memoryTierPaths
// and architecture-counts.mjs → readMetaMemoryTiers; three consumers, one rule).
const memContent = readdirSync(".claude/skills/meta")
  .filter((f) => /^MEMORY.*\.md$/.test(f))
  .sort()
  .map((f) => readFileSync(join(".claude/skills/meta", f), "utf8"))
  .join("\n");
const canonical = new Map(); // N → { title, source }

// Pattern 1: numbered list `\d+\. \*\*L(\d+)[: ](.*?)\*\*`
for (const m of memContent.matchAll(/^\d+\.\s+\*\*L(\d+)[\s:]+(.+?)\*\*/gm)) {
  const n = m[1];
  const title = m[2].trim().replace(/\.$/, "");
  if (!canonical.has(n)) canonical.set(n, { title, source: "numbered-list" });
}

// Pattern 2: dated section header `## YYYY-MM-DD — L<N>: <title>`
for (const m of memContent.matchAll(/^##\s+\d{4}-\d{2}-\d{2}\s+—\s+L(\d+):\s+(.+)$/gm)) {
  const n = m[1];
  if (!canonical.has(n)) canonical.set(n, { title: m[2].trim(), source: "dated-header" });
}

// Pattern 3: bare header `## L<N> (<tag>)` or `## L<N>: <title>`
for (const m of memContent.matchAll(/^##\s+L(\d+)\s*(?:\((.+?)\)|:\s+(.+))$/gm)) {
  const n = m[1];
  const title = (m[2] ?? m[3] ?? "").trim();
  if (!canonical.has(n) && title) canonical.set(n, { title, source: "bare-header" });
}

// Pattern 4: meta/RULES.md table rows — `| L<N> (topic) | rule text | section |`
// Concatenate parenthetical topic + rule-text → use as canonical title.
// This is the denormalized index — covers ~192 lessons.
const rulesContent = readFileSync(RULES, "utf8");
let rulesAdded = 0;
for (const m of rulesContent.matchAll(/^\|\s*L(\d+)(?:\s*\(([^)]+)\))?\s*\|\s*(.+?)\s*\|/gm)) {
  const n = m[1];
  if (canonical.has(n)) continue;
  const topic = (m[2] ?? "").trim();
  const ruleText = m[3].trim();
  // Combine topic + rule-text for title — gives more keyword coverage.
  const title = topic ? `${topic} — ${ruleText}` : ruleText;
  canonical.set(n, { title, source: "rules-table" });
  rulesAdded++;
}

console.log(`# L# reference drift report`);
console.log(`Canonical map: ${canonical.size} lessons (${canonical.size - rulesAdded} from meta/MEMORY.md, ${rulesAdded} from meta/RULES.md)`);

// === Walk .claude/ for tagged L# refs ===

function walkMd(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walkMd(p, out);
    else if (entry.endsWith(".md")) out.push(p);
  }
  return out;
}

const files = walkMd(ROOT);

// Skip meta/MEMORY.md AND meta/RULES.md themselves — they're the canonical
// sources; comparing inline cites against their own definitions is circular.
const targetFiles = files.filter((f) => f !== MEMORY && f !== RULES);

let totalTagged = 0;
let drifts = []; // { file, line, n, citedTag, canonicalTitle, score }
let skippedNoCanonical = 0;

for (const file of targetFiles) {
  const lines = readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(/\bL(\d+)\s+\(([^)]{2,80})\)/g)) {
      const n = m[1];
      if (parseInt(n, 10) > MAX_LESSON_N) continue; // line-number citation
      const citedTag = m[2].trim();
      totalTagged++;

      const canon = canonical.get(n);
      if (!canon) {
        skippedNoCanonical++;
        continue;
      }
      const score = jaccardLike(tokens(citedTag), tokens(canon.title));
      if (score < THRESHOLD) {
        drifts.push({
          file: file.replace(/^\.\//, ""),
          line: i + 1,
          n,
          citedTag,
          canonicalTitle: canon.title.slice(0, 100),
          score: score.toFixed(2),
        });
      }
    }
  }
}

const checked = totalTagged - skippedNoCanonical;
const drifted = drifts.length;
const pctDrift = checked > 0 ? (100 * drifted / checked).toFixed(1) : "n/a";

console.log(`\n## Summary\n`);
console.log(`- Total tagged L# refs scanned: ${totalTagged}`);
console.log(`- Verifiable against canonical (lesson found in meta/MEMORY.md): ${checked}`);
console.log(`- Skipped (no canonical found for N — needs MEMORY entry): ${skippedNoCanonical}`);
console.log(`- **Drifts detected:** ${drifted} (${pctDrift}% of verifiable refs)`);
console.log(`- Threshold: token-overlap ≥ ${THRESHOLD}`);

if (drifted === 0) {
  console.log(`\n✅ No drift detected. All verifiable tagged refs match canonical lessons.`);
  process.exit(0);
}

// Aggregate drift hotspots by N + cited-tag (which inline tags drift most?)
const byTag = new Map();
for (const d of drifts) {
  const key = `L${d.n} (${d.citedTag})`;
  if (!byTag.has(key)) byTag.set(key, { count: 0, canonical: d.canonicalTitle, hits: [] });
  byTag.get(key).count++;
  byTag.get(key).hits.push(`${d.file}:${d.line}`);
}

const topDrifts = [...byTag.entries()].sort((a, b) => b[1].count - a[1].count);
const showLimit = SHOW_ALL ? topDrifts.length : Math.min(20, topDrifts.length);

console.log(`\n## Top ${showLimit} drift patterns (by occurrence)\n`);
console.log(`| Cited inline | Canonical (meta MEMORY title) | Hits | Sample file:line |`);
console.log(`|---|---|---|---|`);
for (let i = 0; i < showLimit; i++) {
  const [key, info] = topDrifts[i];
  const canonTrunc = info.canonical.length > 70 ? info.canonical.slice(0, 70) + "…" : info.canonical;
  console.log(`| \`${key}\` | ${canonTrunc} | ${info.count} | ${info.hits[0]} |`);
}
if (!SHOW_ALL && topDrifts.length > 20) {
  console.log(`\n*+${topDrifts.length - 20} more drift patterns — re-run with \`--all\` to see them.*`);
}

console.log(`\n## Methodology\n`);
console.log(`- Canonical title parsed from \`meta/MEMORY.md\` (numbered list / dated section header / bare header).`);
console.log(`- Cited topic tokenized (lowercase, alphanumeric, ≥3 chars).`);
console.log(`- Overlap score = |cited ∩ canonical| / min(|cited|, |canonical|).`);
console.log(`- Skipped: line-number citations (N > ${MAX_LESSON_N}), bare L# refs (no topic to verify), meta/MEMORY.md itself.`);
console.log(`- Coverage gap: ${(100 * (1 - checked/totalTagged)).toFixed(0)}% of tagged refs have no canonical entry in MEMORY — extending tag-l-refs.mjs canonical map raises coverage.`);

process.exit(drifted > 0 ? 1 : 0);
