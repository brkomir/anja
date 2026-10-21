#!/usr/bin/env node
/**
 * rules-tier-split.mjs — split `.claude/skills/meta/RULES.md` into a ROUTER plus
 * section-keyed SHARDS, the same two-tier shape `memory-tier-split.mjs` gives the
 * expert memories: a full two-tier split, matching the memory files, made after the
 * file's own re-open trigger fired.
 *
 * WHY NOW. `meta/SKILL.md` closed the RULES split on 2026-08-06 ON MEASUREMENT —
 * "38 sections, ZERO over the partial-view band, largest 35,622 B" — and made the
 * premise, not the file size, the thing to re-check. Re-derived 2026-09-04: still 38
 * sections, but `## AH. Session procedure` is 77,255 B, over the ~58,800 B band, while
 * the second-largest is 35,885 B (+1 B in eleven days). All growth is in one section.
 * The closure condition is false, so the split re-opens exactly as the spec prescribes.
 *
 * WHAT THE SPLIT BUYS, precisely — two different failures, only one of which is new:
 *   1. RULES.md is 458,660 B, past the Read tool's ~262,144 B hard-error ceiling, so a
 *      bare Read returns NOTHING. Known since 2026-07-11 and handled by the grep
 *      contract; the router now makes `Read RULES.md` work again.
 *   2. NEW: section AH cannot be read whole even by grep-then-offset — a Read of it
 *      returns a PARTIAL view with is_error FALSE. That is the failure the band exists
 *      to prevent, and it is why this is not cosmetic.
 *
 * DESIGN. Deterministic, no judgement:
 *   - Cut ONLY at `## ` boundaries, in file order.
 *   - ROUTER-RESIDENT sections (ROUTER_SECTIONS below) stay in RULES.md: the Hot Tier
 *     is scanned at every composition, and the three governance sections are read when
 *     EDITING the file, which is when you already have the router open.
 *   - Everything else packs greedily into shards <= MAX_SHARD_BYTES so every shard
 *     reads WHOLE. That is stricter than the memory-file precedent, where 17 of 21
 *     shards sit over the band.
 *   - A section that alone exceeds MAX_SHARD_BYTES is split at TABLE-ROW boundaries
 *     into N parts, each carrying the heading (suffixed "(part i of N)") and a repeat
 *     of the table header + separator. Only AH needs this today.
 *
 * CONSERVATION — two independent checks, both must pass before anything is written,
 * because neither alone is sufficient (the same pair `memory-tier-split.mjs` learned
 * the hard way: a multiset is blind to ORDER, a sequence check is blind to LOSS):
 *   1. PER-SECTION BYTE IDENTITY. Every non-split section's full text must be
 *      byte-identical in its destination. For a split section, the DATA ROWS must
 *      concatenate back to the original data rows, in order, byte for byte.
 *   2. GLOBAL ROW MULTISET. Every `|`-leading row in the original must appear exactly
 *      as many times across router+shards, minus the structural repeats this split
 *      deliberately introduces (one table header + one separator per extra part).
 * Any mismatch ABORTS with a diff and writes nothing.
 *
 * USAGE
 *   node scripts/rules-tier-split.mjs --check    # measure + plan, write nothing
 *   node scripts/rules-tier-split.mjs --apply    # write router + shards
 */

import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ⛔ TWO TARGETS SINCE 2026-09-09, AND THE FILENAME IS NOW HISTORICAL. The engine below is
// generic; only this table is target-specific. It was generalised rather than copied because a
// copy of a 500-line conservation-gated tool drifts, and this repo has paid for that before —
// a shared helper once hand-copied into two call sites, which then drifted apart, is the
// standing example.
//
// `--target rules` is the DEFAULT so every existing caller (meta/SKILL.md, the router's own
// "re-run the splitter" instruction, process-maintain.md step 4) keeps working unchanged.
//
// WHAT THE SECOND TARGET NEEDED, and it is one axis: a heading-level SET rather than a single
// level. RULES.md carries its rules under `## `; the flows tracker carries 90% of its bytes under
// FOUR `### ` tier tables nested inside one `## `, so cutting at `## ` alone yields one 360 KB
// unit and shards nothing. Cutting at `##`-or-`###` yields seven natural units. Everything else
// — greedy packing, the table-row part splitter, both conservation legs, the order digest,
// re-assembly — is unchanged and shared.
const TARGETS = {
  rules: {
    name: "rules",
    key: "RULES",
    shardTitle: "Meta — Rules",
    // ⛔ RESTORED BYTE-FOR-BYTE AT THE 2026-09-09 GENERALISATION. The first cut of that change
    // reworded these two blobs to read generically, and a check caught it immediately: every
    // shard drifted +15 B and the router +10 B, i.e. an --apply would have rewritten all 13 live
    // RULES shards for a cosmetic edit. Per-target prose costs a few lines and buys a ZERO-diff
    // generalisation on the tier that was already shipped. Do not "unify" these.
    shardHeader: (i, n) =>
      `# Meta — Rules shard ${i} of ${n}\n\n` +
      "> Generated by `scripts/rules-tier-split.mjs`. **Do not add a section here by hand** — append to\n" +
      "> `RULES.md` and re-run the splitter, or the router's manifest goes stale silently.\n" +
      "> Router + contract: `.claude/skills/meta/RULES.md`. **Grep the DIR, never one shard.**\n\n---\n\n",
    manifestProse: ({ PART_BUDGET, MAX_SHARD_BYTES, MIN_HEADROOM }) =>
      "⛔ **The rows are NOT here any more.** Since 2026-09-04 this file is a ROUTER: the Hot Tier and the\n" +
      "three governance sections below are resident, and every lettered section lives in a shard beside it.\n" +
      "**The contract is unchanged — GREP, and grep the DIR:** `grep -n '<trigger>' .claude/skills/meta/RULES*.md`.\n" +
      "A grep of `RULES.md` ALONE now returns a clean zero for a rule that exists, which is the false\n" +
      "refutation this manifest exists to prevent — the same trap the two-tier MEMORY split documents.\n" +
      "✅ **Every shard reads WHOLE** — packed to a FILL CAP of " +
      PART_BUDGET.toLocaleString() +
      " B, not to the " +
      MAX_SHARD_BYTES.toLocaleString() +
      " B read cap\n(`SKILLMEM_THRESHOLD`, read out of `warn-large-tracker-read.sh` rather than restated), so every shard\ncarries at least ~" +
      MIN_HEADROOM.toLocaleString() +
      " B of headroom. That is deliberate: `pack()` fills in FILE order, so headroom and\ngrowth rate are uncorrelated, and the first cut left one shard **272 B** short against a measured\n**406 B/day** — under a day before this line became false with nothing to notice.\n" +
      "⛔ **After appending a section OR a row, run `node scripts/rules-tier-split.mjs --apply`.** `--check`\nalone reports the PLAN *and* now compares it against what is on disk; only `--apply` writes.\n\n",
    src: ".claude/skills/meta/RULES.md",
    shardDir: ".claude/skills/meta",
    shardPrefix: "RULES-SHARD-",
    routerName: "RULES.md",
    headingRe: /^## /,
    capVar: "SKILLMEM_THRESHOLD",
    // Kept in the router. Hot Tier: scanned at every composition, so a pointer would cost a
    // read on the hottest path. The other three govern EDITING this file — you have the
    // router open at that moment by construction.
    routerSections: [
      "Hot Tier",
      "Inclusion criteria",
      "Cross-reference convention",
      "/meta learn write-target rule",
    ],
    grepGlob: ".claude/skills/meta/RULES*.md",
  },
  flows: {
    name: "flows",
    key: "FLOWS",
    shardTitle: "Critical flows — tier",
    shardHeader: (i, n) =>
      `# Critical flows — tier shard ${i} of ${n}\n\n` +
      "> Generated by `scripts/rules-tier-split.mjs --target flows`. **Do not add a flow row here by hand**\n" +
      "> — append to `project_critical_flows.md` and re-run the splitter, or the router's manifest goes\n" +
      "> stale silently. Router + legend: `.claude/project-memory/project_critical_flows.md`.\n" +
      "> **Grep the DIR, never one shard.**\n\n---\n\n",
    manifestProse: ({ PART_BUDGET, MAX_SHARD_BYTES, MIN_HEADROOM }) =>
      "⛔ **The flow rows are NOT here any more.** Since 2026-09-09 this file is a ROUTER: the legend below\n" +
      "(numbering convention, lifecycle, the stage-to-skill mapping, what COMPLETE means) is resident, and\n" +
      "each tier table lives in a shard beside it. Why: the file reached **368,860 B, which is 106,716 B past\n" +
      "the Read tool's 262,144 B hard-error ceiling** — an unbounded Read returned NOTHING, and the tracker\n" +
      "guard had been warning above 50 KB long before that.\n" +
      "**The contract is GREP, and grep the DIR:** `grep -nE '^\\| <N> \\|' .claude/project-memory/project_critical_flows*.md`.\n" +
      "⛔ **The `grep -n 'Flow #N'` form this manifest generated until 2026-09-09 is REFUTED — rows are keyed\n" +
      "`| N |`, not by the prose string, so it FAILS TO RETURN THE RIGHT ROW FOR 26 OF 69 live flows: 13\n" +
      "return NOTHING, and 13 return a hit inside a DIFFERENT flow's row — a plausible WRONG row, which is\n" +
      "the worse half and the one an obvious zero would at least have surfaced.** Only 43 of 69 carry\n" +
      "`Flow #N` in their own row at all; the row anchor returns exactly 1 for 69 of 69.\n" +
      "Do NOT hand-fix this line in the router: it is GENERATED, and the next\n" +
      "`--apply` — which the maintenance line below tells you to run — machine-reverts it. Fix it HERE.\n" +
      "A grep of `project_critical_flows.md` ALONE now returns a clean zero for a flow that exists, which is\n" +
      "the false refutation this manifest exists to prevent — the same trap the two-tier MEMORY split\n" +
      "documents. The three tools that read this tracker (`audit-drift-detector.py`, `backfill-audit-tiers.mjs`,\n" +
      "`tracker-list.mjs`) read the DIR and are unaffected.\n" +
      "✅ **Every shard reads WHOLE** — packed to a FILL CAP of " +
      PART_BUDGET.toLocaleString() +
      " B, under the " +
      MAX_SHARD_BYTES.toLocaleString() +
      " B warn\nthreshold (`TRACKER_THRESHOLD`, read out of `warn-large-tracker-read.sh` rather than restated), so a\nshard read raises no advisory at all and every shard carries at least ~" +
      MIN_HEADROOM.toLocaleString() +
      " B of headroom.\n" +
      "⛔ **After appending or editing a flow row, run `node scripts/rules-tier-split.mjs --target flows --apply`.**\n`--check` alone reports the PLAN *and* compares it against what is on disk; only `--apply` writes.\n\n",
    src: ".claude/project-memory/project_critical_flows.md",
    shardDir: ".claude/project-memory",
    shardPrefix: "project_critical_flows-SHARD-",
    routerName: "project_critical_flows.md",
    // Cut at `## ` AND `### `: the tier tables are the unit that carries the bytes.
    headingRe: /^#{2,3} /,
    // ⛔ THE TRACKER ARM OF THE GUARD IS ARM A (WARN, 50 KB), NOT ARM B. Sizing these shards to
    // the skill-memory cap would leave every one of them tripping the warn arm on an ordinary
    // read — technically readable, and noisy enough that a reader learns to skim the guard,
    // which is the failure `session-cadence.md` names as a placement problem rather than a
    // vigilance one. Pack to the threshold that governs THIS path.
    capVar: "TRACKER_THRESHOLD",
    // The legend: numbering convention, lifecycle, stage-to-skill mapping. It is what a reader
    // needs BEFORE choosing a shard, so a pointer to it would cost the read it exists to save.
    routerSections: ["User Flows — Audit & Optimization Tracker"],
    grepGlob: ".claude/project-memory/project_critical_flows*.md",
  },
};

function pickTarget() {
  const i = process.argv.indexOf("--target");
  const name = i !== -1 ? process.argv[i + 1] : "rules";
  const t = TARGETS[name];
  if (!t) {
    throw new Error(
      `unknown --target ${JSON.stringify(name)} — known: ${Object.keys(TARGETS).join(", ")}`
    );
  }
  return t;
}
const T = pickTarget();
const SRC = join(ROOT, T.src);
const SHARD_DIR = join(ROOT, T.shardDir);
const SHARD_PREFIX = T.shardPrefix;
const ROUTER_NAME = T.routerName;
const HEADING_RE = T.headingRe;

// ⛔ DERIVE THE CAP FROM THE GUARD THAT ENFORCES IT — never restate the number.
// `warn-large-tracker-read.sh` DENIES an unbounded skill-memory Read past
// SKILLMEM_THRESHOLD, so a shard over that is not "readable whole" whatever the
// partial-view band says: the guard refuses it before the harness ever truncates it.
// Measured 2026-09-04: a hand-picked 58,000 produced a 57,708 B shard against a 57,500
// threshold — 208 B over, and the router would have advertised "every shard reads WHOLE"
// while one of them was deniable. Two constants for one obligation is how that happens.
const GUARD = join(ROOT, ".claude/hooks/warn-large-tracker-read.sh");
function guardThreshold(varName) {
  try {
    const m = readFileSync(GUARD, "utf8").match(new RegExp(`^${varName}=(\\d+)`, "m"));
    if (m) return Number(m[1]);
  } catch {}
  throw new Error(
    `cannot read ${varName} from ${GUARD} — refusing to guess a cap the guard enforces`
  );
}
const MAX_SHARD_BYTES = guardThreshold(T.capVar);
// Every shard carries a generated file header. Budget for it, or a part sized exactly to
// MAX_SHARD_BYTES produces a FILE over it — measured: AH part 1 packed to 58,000 and the
// file landed at 58,154. The cap that matters is the one on the artifact a reader Reads.
const SHARD_HEADER_BUDGET = 420;
// ⛔ PACK TO A FILL CAP, NOT TO THE READ CAP. `pack()` fills in file order, so headroom and
// growth rate are uncorrelated by construction — the first version left shard 08 with 272 B
// against a measured 406 B/day, i.e. **0.7 days** before the router's own "every shard reads
// WHOLE" became false with nothing to notice. And the premise that
// licensed growth-blind packing was wrong: 12 sections grew 11,581 B in the same 9-day window,
// so "every byte of growth was in one section" generalised from a single datum (Q at +1 B,
// which had grown +262 B the window before). Headroom costs shards and buys time; the trade is
// explicit here rather than accidental.
const MIN_HEADROOM = 6000;
const PART_BUDGET = MAX_SHARD_BYTES - SHARD_HEADER_BUDGET - MIN_HEADROOM;

// Per-target; the rationale for each set sits beside it in TARGETS above.
const ROUTER_SECTIONS = T.routerSections;

// Strip the leading `#`s and the space. `slice(3)` was correct while every heading was `## `
// and is off by one on a `### ` heading — it would leave a `#` on the front of every shard
// label and every router-residency comparison, silently.
const stripH = (h) => h.replace(/^#{1,6}\s+/, "").trim();

const B = (s) => Buffer.byteLength(s, "utf8");

// ⛔ YAML FRONTMATTER IS NOT PREAMBLE PROSE, AND THE TAIL-TRIM BELOW WOULD EAT ITS CLOSING
// DELIMITER. The preamble trim pops trailing blank lines and `---` rules — correct for RULES.md,
// whose preamble genuinely ends in a horizontal rule. A project-memory file's preamble is ONLY
// frontmatter, so the same trim removes the `---` that CLOSES it, and the harness then reads the
// body as frontmatter. Split it off before anything trims. Measured on the flows tracker: the
// preamble is exactly its 6 frontmatter lines, so without this the router ships a broken header.
// ⚠️ ONE NORMALISATION, MEASURED AND STATED: the tracker has no blank line between its closing
// `---` and its first heading, and the reassembler joins blocks with "\n\n", so a round trip is
// 368,069 -> 368,070 B — exactly one inserted blank line. Content-preserving (all three
// conservation legs pass) and STABLE rather than growing: a second --check reports "disk matches
// the plan". Same class as the per-section trailing-blank trim above, which exists for the same
// idempotency reason. Do not chase it as a leak; a growing delta WOULD be one.
function splitFrontmatter(lines) {
  if (lines[0] !== "---") return { fm: [], rest: lines };
  const end = lines.indexOf("---", 1);
  if (end === -1) return { fm: [], rest: lines };
  return { fm: lines.slice(0, end + 1), rest: lines.slice(end + 1) };
}

function parse(text) {
  const { fm: frontmatter, rest } = splitFrontmatter(text.split("\n"));
  const lines = rest;
  const preamble = [];
  const sections = [];
  let cur = null;
  for (const line of lines) {
    if (HEADING_RE.test(line)) {
      if (cur) sections.push(cur);
      cur = { heading: line, body: [] };
    } else if (cur) {
      cur.body.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (cur) sections.push(cur);
  // ⛔ IDEMPOTENCY: strip trailing blank lines from every section body. Without this the
  // pipeline is stable on the FIRST run and fails on the second — a body ending in a
  // blank line, re-joined with "\n\n", grows a third newline on reassembly, and the
  // router's own trailing-newline trim then makes the LAST resident section fail the
  // byte-identity check. Blank lines at a section tail carry no rule content, so
  // normalising here is content-preserving and makes split(reassemble(x)) converge.
  // Found by a later check on the second --apply, not by reading the code.
  for (const s of sections) {
    while (s.body.length && s.body[s.body.length - 1].trim() === "") s.body.pop();
  }
  // Same idempotency problem one level up, and this one GROWS rather than fails: the
  // preamble ends with a `---` rule, the router re-emits its own separators around the
  // manifest block, and reassembly hands the next run a preamble with one more `---`
  // than it started with. Measured before this line: 13,166 -> 13,171 -> 13,176 B, +5 B
  // per re-apply, forever. Canonicalise the tail here and let the router emit exactly one.
  while (
    preamble.length &&
    (preamble[preamble.length - 1].trim() === "" || preamble[preamble.length - 1].trim() === "---")
  ) {
    preamble.pop();
  }
  return { frontmatter, preamble, sections };
}

const secText = (s) => [s.heading, ...s.body].join("\n");
const isRouterSection = (s) => ROUTER_SECTIONS.some((p) => stripH(s.heading).startsWith(p));

// Split one oversized table section at row boundaries.
function splitSection(sec, maxBytes) {
  const body = sec.body;
  const headerIdx = body.findIndex((l) => l.startsWith("|"));
  if (headerIdx === -1) throw new Error(`cannot split non-table section: ${sec.heading}`);
  const tableHeader = body[headerIdx];
  const sep = body[headerIdx + 1];
  if (!/^\|[-\s|:]+\|$/.test(sep)) {
    throw new Error(`expected a table separator under ${sec.heading}, got: ${sep}`);
  }
  const lead = body.slice(0, headerIdx);
  const rows = body.slice(headerIdx + 2);
  const overhead = B(sec.heading) + B(tableHeader) + B(sep) + B(lead.join("\n")) + 64;
  const parts = [];
  let curRows = [];
  let curBytes = overhead;
  for (const r of rows) {
    const rb = B(r) + 1;
    if (curRows.length && curBytes + rb > maxBytes) {
      parts.push(curRows);
      curRows = [];
      curBytes = overhead;
    }
    curRows.push(r);
    curBytes += rb;
  }
  if (curRows.length) parts.push(curRows);
  const n = parts.length;
  // Hand the caller the EXACT population that was partitioned. Deriving the "before"
  // side independently is how the first two runs of this check failed: `| Trigger |
  // Action | L# |` starts with "| " and is not a separator, so a filter over the whole
  // body counts the TABLE HEADER as a data row and reports a phantom loss of 1.
  // Both sides must come off the same slice or the check measures its own predicate.
  sec._partitioned = rows;
  return parts.map((rws, i) => ({
    heading: `${sec.heading} (part ${i + 1} of ${n})`,
    body: [...lead, tableHeader, sep, ...rws],
    _origin: sec.heading,
    _rows: rws,
  }));
}

function pack(units, maxBytes) {
  const shards = [];
  let cur = [];
  let curBytes = 0;
  for (const u of units) {
    const ub = B(secText(u)) + 2;
    if (cur.length && curBytes + ub > maxBytes) {
      shards.push(cur);
      cur = [];
      curBytes = 0;
    }
    cur.push(u);
    curBytes += ub;
  }
  if (cur.length) shards.push(cur);
  return shards;
}

// A split section's parts must get DISTINCT labels, or two shards land on the same
// filename stem (`...-AH-AH.md` twice) and the manifest cannot tell a reader which half
// holds their row — the one thing the manifest exists to do.
const label = (h) => {
  const part = h.match(/\(part (\d+) of \d+\)\s*$/);
  const base = stripH(h).replace(/\s*\(part \d+ of \d+\)\s*$/, "");
  const m = base.match(/^([A-Z]{1,2})\./);
  const stem = m ? m[1] : base.split(/[\s—]/)[0].replace(/[^A-Za-z0-9]/g, "");
  return part ? `${stem}p${part[1]}` : stem;
};

const MANIFEST_BEGIN = `<!-- ${T.key}-SPLIT:MANIFEST-BEGIN -->`;
const MANIFEST_END = `<!-- ${T.key}-SPLIT:MANIFEST-END -->`;
const ORDER_KEY = `${T.key}-SECTION-ORDER:`;
const DIGEST_KEY = `${T.key}-SPLIT:ORDER-DIGEST`;
const orderDigest = (headings) =>
  createHash("sha256").update(headings.join("||")).digest("hex").slice(0, 16);

/**
 * Reconstruct the logical pre-split file from router + shards.
 *
 * ⛔ WITHOUT THIS THE TOOL IS A ONE-SHOT THAT CORRUPTS ON ITS SECOND RUN — it reads
 * RULES.md, and after an --apply that path IS the router, so a re-run would shard the
 * router and throw the real sections away. The router's own text tells a maintainer to
 * re-run `--check` after appending a section, so the second run is not hypothetical.
 *
 * Section ORDER cannot be recovered from the split artifacts: the router-resident
 * sections are grouped at the end while their original positions are interleaved
 * (Hot Tier first, the three governance sections between P and Q). So the router
 * records the original heading order in a comment inside the manifest block, and this
 * reads it back. Round-trip is asserted before any write.
 */
function reassemble() {
  const router = readFileSync(SRC, "utf8");
  if (!router.includes(MANIFEST_BEGIN)) return null; // not split yet
  const b = router.indexOf(MANIFEST_BEGIN);
  const e = router.indexOf(MANIFEST_END) + MANIFEST_END.length;
  const block = router.slice(b, e);
  const orderLine = block.split("\n").find((l) => l.includes(ORDER_KEY));
  if (!orderLine) throw new Error("router manifest carries no section-order record");
  const order = orderLine
    .slice(orderLine.indexOf(ORDER_KEY) + ORDER_KEY.length)
    .replace(/-->\s*$/, "")
    .trim()
    .split("||")
    .filter(Boolean);

  // ⛔ NO GLOBAL BLANK-LINE COLLAPSE. This used to `.replace(/\n{3,}/g, "\n\n")` the whole
  // router plane, which ran UPSTREAM of `src` — so both conservation checks compared the
  // ALREADY-normalised text to the outputs and could never see it.
  // Cosmetic on a table, content-destroying the day a resident section carries
  // a fenced block or a pasted diff. parse() trims trailing blanks per section and per
  // preamble, which is targeted at the actual join seam, so the global pass was redundant
  // as well as unverifiable.
  const routerRest = router.slice(0, b) + router.slice(e);
  const { frontmatter, preamble, sections: routerSecs } = parse(routerRest);

  const shardSecs = [];
  for (const f of readdirSync(SHARD_DIR).filter((n) => n.startsWith(SHARD_PREFIX)).sort()) {
    const t = readFileSync(join(SHARD_DIR, f), "utf8");
    shardSecs.push(...parse(t).sections);
  }

  // Re-merge split parts: part 1 keeps its table header, parts 2..N drop the repeated
  // header + separator that the split introduced.
  const merged = [];
  for (const s of [...routerSecs, ...shardSecs]) {
    const m = s.heading.match(/^(.*) \(part (\d+) of (\d+)\)$/);
    if (!m) { merged.push(s); continue; }
    const [, base, i] = m;
    if (i === "1") { merged.push({ heading: base, body: s.body }); continue; }
    const target = merged.find((x) => x.heading === base);
    if (!target) throw new Error(`part ${i} of ${base} has no part 1`);
    const hi = s.body.findIndex((l) => l.startsWith("|"));
    target.body.push(...s.body.slice(hi + 2));
  }

  // ⛔ THE DOCUMENTED MAINTENANCE PATH MUST NOT THROW. The router and all ten shard headers
  // say "append a section and re-run" — and this threw `order record has 38 sections, found
  // 39` on exactly that. The undocumented step was hand-editing a
  // machine-written comment, which is also the one surface whose corruption nothing checked.
  // An UNRECORDED section is now taken at its discovery position (end of corpus); a RECORDED
  // section that has since been deleted is dropped rather than fatal.
  const byHeading = new Map(merged.map((s) => [s.heading, s]));
  const ordered = [];
  const seen = new Set();
  for (const h of order) {
    const s = byHeading.get(h);
    if (s && !seen.has(h)) { ordered.push(s); seen.add(h); }
  }
  const added = merged.filter((s) => !seen.has(s.heading));
  for (const s of added) ordered.push(s);
  if (added.length) {
    console.log(`(${added.length} unrecorded section(s) adopted at discovery position: ${added.map((s) => s.heading.slice(3).trim().split(/[\s—]/)[0]).join(", ")})`);
  }

  // ⛔ THE ORDER RECORD IS THE ONE PLANE NEITHER CONSERVATION CHECK CAN REACH. Both legs are
  // order-blind by construction — containment has no positional component, and a permutation
  // moves neither the byte total nor the row multiset — so a swapped pair of headings silently
  // changes what a reader retrieves (measured). The record is machine-written,
  // so a mismatch means it was hand-edited: that is loud now instead of silent.
  const digest = orderDigest(order);
  const recorded = (block.split("\n").find((l) => l.includes(DIGEST_KEY)) || "")
    .replace(new RegExp(`^.*?${DIGEST_KEY}\\s*`), "").replace(/-->\s*$/, "").trim();
  if (recorded && recorded !== digest) {
    throw new Error(
      `order record digest mismatch: recorded ${recorded}, computed ${digest}. The section-order ` +
        `comment in ${ROUTER_NAME} is machine-written, so this means it was edited by hand — a reorder ` +
        `there silently changes which shard each section lands in and NEITHER conservation check ` +
        `can see it. If the edit was deliberate, delete the ORDER-DIGEST line and re-run --apply.`
    );
  }
  const head = [frontmatter.join("\n"), preamble.join("\n").replace(/\n+$/, "")]
    .filter((s) => s !== "")
    .join("\n");
  const text = [head, ...ordered.map(secText)].join("\n\n");
  return text.replace(/\n+$/, "") + "\n";
}

function main() {
  const apply = process.argv.includes("--apply");
  const reassembled = reassemble();
  const src = reassembled ?? readFileSync(SRC, "utf8");
  if (reassembled) console.log(`(re-assembled from router + shards: ${B(src).toLocaleString()} B)`);
  const { frontmatter, preamble, sections } = parse(src);

  const routerSecs = sections.filter(isRouterSection);
  const shardSecs = sections.filter((s) => !isRouterSection(s));

  // Expand oversized sections into parts.
  const units = [];
  const splitOrigins = new Map();
  for (const s of shardSecs) {
    if (B(secText(s)) > PART_BUDGET) {
      const parts = splitSection(s, PART_BUDGET);
      splitOrigins.set(s.heading, { original: s, parts });
      units.push(...parts);
    } else {
      units.push(s);
    }
  }

  const shards = pack(units, PART_BUDGET);
  const shardName = (i, group) =>
    `${SHARD_PREFIX}${String(i + 1).padStart(2, "0")}-${label(group[0].heading)}-${label(group[group.length - 1].heading)}.md`;

  // ---- build outputs ----
  const files = new Map();
  const manifest = [];
  shards.forEach((group, i) => {
    const name = shardName(i, group);
    const head =
      T.shardHeader(i + 1, shards.length);
    const bodyText = group.map(secText).join("\n\n").replace(/\n+$/, "") + "\n";
    files.set(name, head + bodyText);
    for (const u of group) {
      manifest.push({
        heading: u.heading.slice(3).trim(),
        file: name,
        bytes: B(secText(u)),
      });
    }
  });

  const manifestTable = [
    "| Section | Shard | bytes |",
    "|---|---|---|",
    ...manifest.map((m) => `| ${m.heading} | \`${m.file}\` | ${m.bytes.toLocaleString()} |`),
  ].join("\n");

  const orderHeadings = sections.map((s) => s.heading);
  const orderRecord =
    `${MANIFEST_BEGIN}\n<!-- ${ORDER_KEY} ` +
    orderHeadings.join("||") +
    ` -->\n<!-- ${DIGEST_KEY} ${orderDigest(orderHeadings)} -->\n`;

  const routerBody =
    (frontmatter.length ? frontmatter.join("\n") + "\n" : "") +
    preamble.join("\n").replace(/\n+$/, "") +
    "\n\n---\n\n" +
    orderRecord +
    "## Shard manifest — WHERE EVERY SECTION LIVES\n\n" +
    T.manifestProse({ PART_BUDGET, MAX_SHARD_BYTES, MIN_HEADROOM }) +
    manifestTable +
    "\n\n" +
    MANIFEST_END +
    "\n\n---\n\n" +
    routerSecs.map(secText).join("\n\n").replace(/\n+$/, "") +
    "\n";

  files.set(ROUTER_NAME, routerBody);

  // ---- CONSERVATION 1: per-section byte identity ----
  const problems = [];
  const allNew = [...files.values()].join("\n");
  for (const s of sections) {
    if (splitOrigins.has(s.heading)) continue;
    if (!allNew.includes(secText(s))) {
      problems.push(`section NOT byte-identical in output: ${s.heading}`);
    }
  }
  for (const [heading, { original, parts }] of splitOrigins) {
    // Compare the SAME predicate on both sides. `_rows` is every line after the
    // separator (blank lines and trailing prose included, so output stays faithful),
    // so the check filters both to data rows or it compares two different populations
    // and reports a loss that is really a filter mismatch.
    const dataRow = (l) => l.startsWith("| ") && !/^\|[-\s|:]+\|$/.test(l);
    const origRows = (original._partitioned || []).filter(dataRow);
    const partRows = parts.flatMap((p) => p._rows).filter(dataRow);
    const oh = origRows.join("\n");
    const ph = partRows.join("\n");
    if (oh !== ph) {
      problems.push(
        `split section rows differ: ${heading} — original ${origRows.length} rows / parts ${partRows.length} rows`
      );
    }
  }

  // ---- CONSERVATION 2: global row multiset ----
  const rowsOf = (t) => t.split("\n").filter((l) => l.startsWith("| "));
  const before = rowsOf(src);
  const after = rowsOf(allNew);
  const count = (arr) => arr.reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
  const cb = count(before);
  const ca = count(after);
  // Structural repeats this split introduces on purpose: one table header per EXTRA part,
  // plus the manifest's own header row. Everything else must match exactly.
  const extraParts = [...splitOrigins.values()].reduce((n, v) => n + v.parts.length - 1, 0);
  for (const [line, n] of cb) {
    const m = ca.get(line) || 0;
    if (m < n) problems.push(`ROW LOST (${n} -> ${m}): ${line.slice(0, 90)}`);
  }

  // ⛔ LOSSES ONLY IS HALF A LEDGER. The loop above tests `m < n`, so DUPLICATION passes
  // silently: a `pack()` boundary carry-forward — the most plausible bug in a greedy packer —
  // duplicated 13 whole sections and this reported `✅ conservation OK` at rows 1042 -> 1602,
  // +560 (measured). The report even printed the surplus and called it
  // "structural", a word carrying a check that did not exist — `extraParts` was computed and
  // used in exactly one console.log.
  //
  // The exact expected total IS derivable, so gate on it rather than on a per-line `m > n`:
  // one manifest row per unit, plus the manifest's own header row, plus one repeated table
  // header per EXTRA part of a split section. A per-line `m > n` leg would RED the control,
  // because `| Trigger | Action | L# |` legitimately gains an occurrence on a split.
  const expectedDrift = manifest.length + 1 + extraParts;
  const actualDrift = after.length - before.length;
  if (actualDrift !== expectedDrift) {
    problems.push(
      `ROW COUNT DRIFT: ${before.length} -> ${after.length} (${actualDrift >= 0 ? "+" : ""}${actualDrift}), ` +
        `expected exactly +${expectedDrift} (${manifest.length} manifest rows + 1 manifest header + ` +
        `${extraParts} repeated table header(s)). A HIGHER number means duplication; a lower one ` +
        `means rows vanished outside the multiset's reach.`
    );
  }

  // ---- report ----
  console.log(`source     : ${B(src).toLocaleString()} B, ${sections.length} sections`);
  console.log(`router     : ${B(routerBody).toLocaleString()} B (${routerSecs.length} resident sections)`);
  console.log(`shards     : ${shards.length}`);
  for (const [name, text] of files) {
    if (name === ROUTER_NAME) continue;
    console.log(`  ${name.padEnd(46)} ${String(B(text)).padStart(7)} B`);
  }
  const maxShard = Math.max(...[...files].filter(([n]) => n !== ROUTER_NAME).map(([, t]) => B(t)));
  console.log(`largest shard: ${maxShard.toLocaleString()} B (band ~58,800; cap ${MAX_SHARD_BYTES.toLocaleString()})`);
  console.log(`split sections: ${splitOrigins.size} (${extraParts} extra part(s))`);
  console.log(`rows before ${before.length} / after ${after.length} (+${after.length - before.length} structural)`);

  if (problems.length) {
    console.error(`\n⛔ CONSERVATION FAILED — ${problems.length} problem(s), nothing written:`);
    for (const p of problems.slice(0, 20)) console.error(`   ${p}`);
    process.exit(1);
  }
  console.log("\n✅ conservation OK — per-section byte identity · row multiset · exact row-count drift");

  if (!apply) {
    // ⛔ `--check` REPORTED THE PLAN, NOT THE DISK. It re-assembles, re-packs and prints
    // maxShard from memory, so after a row is appended to an over-cap shard it silently
    // re-packs the overflow into a neighbour, prints a compliant plan, and leaves the
    // deniable file sitting on disk (`grep -c 'statSync|existsSync'` was 0).
    // The router prescribes exactly this command for exactly that failure, so it has to read
    // what is actually there.
    const drift = [];
    for (const [name, text] of files) {
      const p = join(SHARD_DIR, name);
      if (!existsSync(p)) { drift.push(`${name}: PLANNED but ABSENT on disk`); continue; }
      const onDisk = readFileSync(p, "utf8");
      if (onDisk !== text) {
        drift.push(`${name}: on disk ${B(onDisk).toLocaleString()} B, planned ${B(text).toLocaleString()} B${B(onDisk) > MAX_SHARD_BYTES ? "  ⛔ ON-DISK FILE IS OVER THE READ CAP" : ""}`);
      }
    }
    for (const f of readdirSync(SHARD_DIR)) {
      if (f.startsWith(SHARD_PREFIX) && !files.has(f)) drift.push(`${f}: on disk but NOT in the plan (stale shard)`);
    }
    if (drift.length) {
      console.log(`\n⚠️  DISK DIFFERS FROM PLAN — ${drift.length} file(s). Run --apply:`);
      for (const d of drift) console.log(`   ${d}`);
    } else {
      console.log("disk matches the plan — every shard on disk is byte-identical to what --apply would write");
    }
    console.log("(--check: nothing written; pass --apply to write)");
    return;
  }

  for (const f of readdirSync(SHARD_DIR)) {
    if (f.startsWith(SHARD_PREFIX)) unlinkSync(join(SHARD_DIR, f));
  }
  for (const [name, text] of files) writeFileSync(join(SHARD_DIR, name), text);
  console.log(`\nwrote ${files.size} file(s) to ${T.shardDir}/`);
}

main();
