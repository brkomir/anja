#!/usr/bin/env node
// memory-graph-check — the resolver + linter + reverse-index the project-memory
// `[[wikilink]]` layer never had. Wired into the pre-push hook.
//
// THE GAP IT CLOSES:
//   The harness memory prompt tells us to cross-link memories with `[[name]]`,
//   but (a) NOTHING resolves them — no hook, no tool reads them; (b) authors use
//   3 inconsistent slug forms (full-filename `[[project_example_topic]]`,
//   stem-minus-prefix `[[example-rule]]`, frontmatter-name `[[example-topic-decisions]]`);
//   (c) the `name:` frontmatter they're meant to resolve against is itself
//   non-normalized (Title-Case "Example rule" vs kebab "example-topic-decisions").
//   So links rot silently and there is no orphan/reverse-index check answering
//   "is this memory file reachable by anything?"
//
//   This script gives `[[name]]` an actual READER. It normalizes all three slug
//   forms to one canonical key, so a link written in ANY form resolves if a real
//   target exists — and reports the genuinely-dangling residue precisely. It also
//   emits the reverse-index / orphan report (a file reachable by NEITHER an index
//   NOR an inbound link is invisible to everything but full-text grep).
//
// MODES:
//   node scripts/memory-graph-check.mjs            human report, exit 0 (warn-mode)
//   node scripts/memory-graph-check.mjs --strict   exit 1 if any DANGLING or ORPHAN
//   node scripts/memory-graph-check.mjs --json      machine-readable
//
// WIRED: .githooks/pre-push (warn-mode, fires on .claude/project-memory/**).
//        Escape: SKIP_MEMORY_GRAPH_CHECK=1.
//
// Stdlib-only (fs/path) — matches scripts/{architecture-counts,skill-lint,memory-config-drift}.mjs.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = ".claude/project-memory";
const INDEX_FILES = ["MEMORY.md", "MEMORY-INDEX.md"]; // the two reachability indices
const TYPE_PREFIX = /^(feedback|project|reference)_/; // user_ deliberately NOT stripped
const STRICT = process.argv.includes("--strict");
const JSON_OUT = process.argv.includes("--json");

// Canonical key: lowercase, drop .md, collapse [_ space] → '-', trim dashes.
// This is what unifies the 3 author-slug forms into one comparable key.
const norm = (s) =>
  s
    .toLowerCase()
    .trim()
    .replace(/\.md$/, "")
    .replace(/^["']|["']$/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

// ---- 1. Inventory + parse frontmatter name: ----
const files = readdirSync(DIR).filter((f) => f.endsWith(".md"));
const topical = files.filter((f) => !INDEX_FILES.includes(f)); // index files aren't orphan-candidates

// Canonical link form for THIS project = the filename stem MINUS its type prefix
// (`feedback_example_rule` → `example-rule`). NOT the frontmatter `name:`
// slug the harness convention names: our `name:` fields drifted to descriptive
// sentences ("Example rule", "Challenge \"some quoted\" labels…"),
// which normalize to unusable keys. The filename is the stable identifier — every
// index references `file.md` — so the prefix-stripped stem is the clean, unique,
// already-most-common link form. `name:` is kept only as an extra resolution key.
/** stem -> { stem, file, name (raw|null), canonical } */
const meta = new Map();
for (const file of files) {
  const stem = file.replace(/\.md$/, "");
  const body = readFileSync(join(DIR, file), "utf8");
  let name = null;
  const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    const m = fm[1].match(/^name:\s*(.+?)\s*$/m);
    if (m) name = m[1].replace(/^["']|["']$/g, "").trim();
  }
  meta.set(stem, { stem, file, name, canonical: norm(stem.replace(TYPE_PREFIX, "")) });
}

// ---- 2. Build resolution map: every key form -> set(stem) ----
const keyToStems = new Map();
const addKey = (key, stem) => {
  if (!key) return;
  if (!keyToStems.has(key)) keyToStems.set(key, new Set());
  keyToStems.get(key).add(stem);
};
for (const { stem, name } of meta.values()) {
  addKey(norm(stem), stem); // full filename form:        [[project_example_topic]]
  addKey(norm(stem.replace(TYPE_PREFIX, "")), stem); // stem-minus-prefix form:    [[example-rule]]
  if (name) addKey(norm(name), stem); // frontmatter-name (canonical): [[example-topic-decisions]]
}

// ---- 3. Scan every file for [[links]], resolve each ----
const dangling = []; // {from, line, raw}            — true rot: fix or convert to plain text
const ambiguous = []; // {from, line, raw, targets}   — key maps to 2+ files: disambiguate
const nonCanonical = []; // {from, raw, target, canonical} — resolves, but not via canonical name-slug
const inDegree = new Map(); // targetStem -> count of resolved inbound links
topical.concat(INDEX_FILES).forEach((file) => {
  const lines = readFileSync(join(DIR, file), "utf8").split("\n");
  lines.forEach((text, i) => {
    // Ignore [[...]] inside inline code spans — a bracketed example in backticks
    // (e.g. this script's own convention note) is a literal, not a real link.
    const scrubbed = text.replace(/`[^`]*`/g, "");
    const matches = scrubbed.matchAll(/\[\[([^\]]+)\]\]/g);
    for (const mt of matches) {
      const raw = mt[1];
      const key = norm(raw);
      const hit = keyToStems.get(key);
      if (!hit || hit.size === 0) {
        dangling.push({ from: file, line: i + 1, raw });
      } else if (hit.size > 1) {
        ambiguous.push({ from: file, line: i + 1, raw, targets: [...hit] });
      } else {
        const target = [...hit][0];
        if (target !== file.replace(/\.md$/, "")) {
          inDegree.set(target, (inDegree.get(target) || 0) + 1);
        }
        const canonical = meta.get(target).canonical;
        if (key !== canonical) nonCanonical.push({ from: file, raw, target, canonical });
      }
    }
  });
});

// ---- 4. Orphan / reverse-index: reachable by an INDEX (filename in MEMORY*.md) or an inbound link? ----
const indexText = INDEX_FILES.map((f) => readFileSync(join(DIR, f), "utf8")).join("\n");
const indexReachable = (stem) => indexText.includes(`${stem}.md`);
const orphans = topical
  .map((f) => f.replace(/\.md$/, ""))
  .filter((stem) => !indexReachable(stem) && !(inDegree.get(stem) > 0));

// ---- Report ----
if (JSON_OUT) {
  console.log(JSON.stringify({ counts: { topical: topical.length, dangling: dangling.length, ambiguous: ambiguous.length, nonCanonical: nonCanonical.length, orphans: orphans.length }, dangling, ambiguous, orphans }, null, 2));
} else {
  console.log(`\nmemory-graph-check — ${topical.length} topical files, ${keyToStems.size} resolution keys\n`);

  console.log(`✗ DANGLING (${dangling.length}) — link resolves to no file; fix or convert to plain text:`);
  for (const d of dangling) console.log(`    ${d.from}:${d.line}  [[${d.raw}]]`);
  if (!dangling.length) console.log("    (none)");

  console.log(`\n⚠ AMBIGUOUS (${ambiguous.length}) — normalized key maps to 2+ files; disambiguate:`);
  for (const a of ambiguous) console.log(`    ${a.from}:${a.line}  [[${a.raw}]] → {${a.targets.join(", ")}}`);
  if (!ambiguous.length) console.log("    (none)");

  console.log(`\n● ORPHAN (${orphans.length}) — in NEITHER index NOR any inbound link (only full-text-grep findable):`);
  for (const o of orphans) console.log(`    ${o}.md`);
  if (!orphans.length) console.log("    (none)");

  console.log(`\nℹ non-canonical link form (${nonCanonical.length}) — resolves, but not via the canonical prefix-stripped slug (informational):`);
  for (const n of nonCanonical.slice(0, 8)) console.log(`    ${n.from}: [[${n.raw}]] → canonical [[${n.canonical}]]`);
  if (nonCanonical.length > 8) console.log(`    … +${nonCanonical.length - 8} more`);
  if (!nonCanonical.length) console.log("    (none)");

  console.log(`\nsummary: ${dangling.length} dangling · ${ambiguous.length} ambiguous · ${orphans.length} orphan · ${nonCanonical.length} non-canonical`);
}

if (STRICT && (dangling.length || orphans.length)) process.exit(1);
